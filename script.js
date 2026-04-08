class ImageOverlayApp {
    constructor() {
        this.layers = [];
        this.canvas = document.getElementById('mainCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.layerIdCounter = 0;
        this.currentDraggedElement = null;
        this.currentPlaceholder = null;
        this.dragCounter = 0; // for canvas drag highlight management
        this.zoom = 1; // canvas zoom factor (1 = 100%)
        this.panX = 0; // screen-space pan (px)
        this.panY = 0;
        this.isPanning = false;
        this.panPointerId = null;
        this.lastPointerX = 0;
        this.lastPointerY = 0;
        // Persistent crop clip applied to render/export
        this.appliedCrop = null;

        this.initializeElements();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupLayerDragContainer();
        this.resizeCanvas();
    }

    initializeElements() {
        this.fileInput = document.getElementById('fileInput');
        this.addImageBtn = document.getElementById('addImageBtn');
        this.autoFitBtn = document.getElementById('autoFitBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.saveBtn = document.getElementById('saveBtn');
        this.layersContainer = document.getElementById('layersContainer');
        this.layerCount = document.getElementById('layerCount');
        this.dropZone = document.getElementById('dropZone');
        this.canvasContainer = document.getElementById('canvasContainer');
        this.layerTemplate = document.getElementById('layerTemplate');
        this.sidebar = document.querySelector('.sidebar');
        this.sidebarResizer = document.getElementById('sidebarResizer');
        // Zoom elements
        this.zoomSlider = document.getElementById('zoomSlider');
        this.zoomDisplay = document.getElementById('zoomDisplay');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.zoomResetBtn = document.getElementById('zoomResetBtn');
        // Floating preview elements
        this.previewContainer = document.getElementById('floatingPreview');
        this.previewCanvas = document.getElementById('previewCanvas');
        // Crop elements
        this.cropOverlay = document.getElementById('cropOverlay');
        this.cropRectEl = document.getElementById('cropRect');
        this.applyCropBtn = document.getElementById('applyCropBtn');
        this.cancelCropBtn = document.getElementById('cancelCropBtn');
        // Initialize sidebar resizing after elements are bound
        if (typeof this.setupSidebarResize === 'function') {
            this.setupSidebarResize();
        }
    }

    setupEventListeners() {
        this.addImageBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.autoFitBtn.addEventListener('click', () => this.autoFitLayers());
        this.clearAllBtn.addEventListener('click', () => this.clearAllLayers());
        if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.saveComposite());
        if (this.applyCropBtn) this.applyCropBtn.addEventListener('click', () => this.applyCrop());
        if (this.cancelCropBtn) this.cancelCropBtn.addEventListener('click', () => this.exitCropMode());
        window.addEventListener('resize', () => { this.resizeCanvas(); this.updatePreviewVisibility(); });
        window.addEventListener('scroll', () => this.updatePreviewVisibility(), { passive: true });

        // Global keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            // Ignore when typing in inputs or when modifiers are held
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const target = e.target;
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            const isTyping = tag === 'input' || tag === 'textarea' || (target && target.isContentEditable);
            if (isTyping) return;

            const key = (e.key || '').toLowerCase();
            if (key === 'a') {
                e.preventDefault();
                this.autoFitLayers();
            } else if (key === 'c') {
                e.preventDefault();
                this.clearAllLayers();
            } else if (key === 'i') {
                e.preventDefault();
                this.fileInput.click();
            }
        });

        // Zoom controls
        if (this.zoomSlider) {
            this.zoomSlider.addEventListener('input', (e) => {
                const percent = Number(e.target.value);
                this.setZoom(percent / 100);
            });
        }
        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener('click', () => this.nudgeZoom(0.1));
        }
        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => this.nudgeZoom(-0.1));
        }
        if (this.zoomResetBtn) {
            this.zoomResetBtn.addEventListener('click', () => this.setZoom(1));
        }
        // Ctrl + mouse wheel zooming
        this.canvasContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                this.nudgeZoom(delta);
            }
        }, { passive: false });

        // Pointer-based panning
        this.canvasContainer.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvasContainer.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvasContainer.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvasContainer.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        // Initialize preview visibility state
        this.updatePreviewVisibility();
        // Enable dragging of floating preview (mobile)
        this.setupFloatingPreviewDrag();

        // Crop interactions
        if (this.cropOverlay) {
            this.cropOverlay.addEventListener('pointerdown', (e) => this.onCropPointerDown(e));
            window.addEventListener('pointermove', (e) => this.onCropPointerMove(e));
            window.addEventListener('pointerup', (e) => this.onCropPointerUp(e));
            window.addEventListener('pointercancel', (e) => this.onCropPointerUp(e));
        }
    }

    // Export the current composition (with adjustments) to PNG
    saveComposite() {
        if (!this.layers.length) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
        // Use crop rect if present; default to full canvas
        const crop = (this.cropRect && this.cropRect.w > 0 && this.cropRect.h > 0)
            ? this.cropRect
            : (this.appliedCrop && this.appliedCrop.w > 0 && this.appliedCrop.h > 0
                ? this.appliedCrop
                : { x: 0, y: 0, w: w, h: h });
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(crop.w * dpr));
        off.height = Math.max(1, Math.round(crop.h * dpr));
        const ctx = off.getContext('2d');
        // Render in CSS pixel space scaled up by DPR
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, crop.w, crop.h);
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = 'high'; } catch (_) {}
        // Translate so crop region maps to (0,0)
        ctx.translate(-crop.x, -crop.y);

        // Draw layers bottom -> top (same as renderCanvas)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (!layer.visible) continue;
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            const f = layer.filters || {};
            ctx.filter = [
                `brightness(${f.brightness ?? 100}%)`,
                `contrast(${f.contrast ?? 100}%)`,
                `saturate(${f.saturation ?? 100}%)`,
                `hue-rotate(${f.hue ?? 0}deg)`,
                `blur(${f.blur ?? 0}px)`,
                `grayscale(${f.grayscale ?? 0}%)`
            ].join(' ');
            const t = layer.transform || {};
            const rad = ((t.rotation ?? 0) * Math.PI) / 180;
            const cx = layer.x + layer.width / 2;
            const cy = layer.y + layer.height / 2;
            ctx.translate(cx, cy);
            ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
            ctx.rotate(rad);
            ctx.drawImage(layer.image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
            ctx.restore();
        }

        // Download as PNG
        if (off.toBlob) {
            off.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'image-overlay.png';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            }, 'image/png');
        } else {
            const dataURL = off.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = 'image-overlay.png';
            document.body.appendChild(a);
            a.click();
            a.remove();
        }
    }

    setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, this.preventDefaults, false);
            this.canvasContainer.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        // Highlight overlay (dropZone) on enter/over
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => this.highlight(), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => this.unhighlight(), false);
        });

        // Also support dropping onto the canvas container when overlay is hidden
        this.canvasContainer.addEventListener('dragenter', () => {
            this.dragCounter++;
            this.canvasContainer.classList.add('drag-over');
        });
        this.canvasContainer.addEventListener('dragleave', () => {
            this.dragCounter = Math.max(0, this.dragCounter - 1);
            if (this.dragCounter === 0) {
                this.canvasContainer.classList.remove('drag-over');
            }
        });
        this.canvasContainer.addEventListener('dragover', () => {
            this.canvasContainer.classList.add('drag-over');
        });
        this.canvasContainer.addEventListener('drop', (e) => {
            this.dragCounter = 0;
            this.canvasContainer.classList.remove('drag-over');
            this.handleDrop(e);
        }, false);

        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e), false);

        // Allow tapping/clicking the drop zone to open file picker (mobile-friendly)
        this.dropZone.addEventListener('click', () => {
            this.fileInput && this.fileInput.click();
        });
        // Keyboard accessibility for drop zone
        this.dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.fileInput && this.fileInput.click();
            }
        });
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight() {
        this.dropZone.classList.add('drag-over');
    }

    unhighlight() {
        this.dropZone.classList.remove('drag-over');
    }

    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        this.handleFiles(files);
        // Ensure highlight is removed from both overlay and container
        this.unhighlight();
        this.canvasContainer.classList.remove('drag-over');
    }

    handleFileSelect(e) {
        this.handleFiles(e.target.files);
    }

    handleFiles(files) {
        [...files].forEach(file => {
            if (file.type.startsWith('image/')) {
                this.loadImage(file);
            }
        });
    }

    loadImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.addLayer(img, file.name);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    addLayer(image, name) {
        const layerId = `layer_${this.layerIdCounter++}`;
        const layer = {
            id: layerId,
            name: name || `Layer ${this.layers.length + 1}`,
            image: image,
            opacity: 1,
            visible: true,
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
            scale: 1,
            filters: {
                brightness: 100,
                contrast: 100,
                saturation: 100,
                hue: 0,
                blur: 0,
                grayscale: 0
            },
            transform: {
                rotation: 0, // degrees
                flipH: false,
                flipV: false
            }
        };

        this.layers.push(layer);
        this.createLayerElement(layer);
        this.updateLayerCount();
        this.hideDropZone();
        this.renderCanvas();
    }

    createLayerElement(layer) {
        const template = this.layerTemplate.content.cloneNode(true);
        const layerElement = template.querySelector('.layer-item');
        
        layerElement.setAttribute('data-layer-id', layer.id);
        // Accessibility and keyboard support
        layerElement.setAttribute('role', 'listitem');
        layerElement.setAttribute('tabindex', '0');
        layerElement.querySelector('.layer-name').textContent = layer.name;
        layerElement.querySelector('.layer-preview img').src = layer.image.src;
        
        const opacitySlider = layerElement.querySelector('.opacity-slider');
        const opacityValue = layerElement.querySelector('.opacity-value');
        const visibilityBtn = layerElement.querySelector('.visibility-btn');
        const deleteBtn = layerElement.querySelector('.delete-btn');
        // Adjustments dropdown
        const adjustments = layerElement.querySelector('.adjustments');
        const adjustmentsToggle = layerElement.querySelector('.adjustments-toggle');
        const adjustmentsPanel = layerElement.querySelector('.adjustments-panel');
        // Adjustment controls
        const brightnessSlider = layerElement.querySelector('.brightness-slider');
        const brightnessValue = layerElement.querySelector('.brightness-value');
        const contrastSlider = layerElement.querySelector('.contrast-slider');
        const contrastValue = layerElement.querySelector('.contrast-value');
        const saturationSlider = layerElement.querySelector('.saturation-slider');
        const saturationValue = layerElement.querySelector('.saturation-value');
        const hueSlider = layerElement.querySelector('.hue-slider');
        const hueValue = layerElement.querySelector('.hue-value');
        const blurSlider = layerElement.querySelector('.blur-slider');
        const blurValue = layerElement.querySelector('.blur-value');
        const grayscaleSlider = layerElement.querySelector('.grayscale-slider');
        const grayscaleValue = layerElement.querySelector('.grayscale-value');
        const rotationSlider = layerElement.querySelector('.rotation-slider');
        const rotationValue = layerElement.querySelector('.rotation-value');
        const rotateLeftBtn = layerElement.querySelector('.rotate-left');
        const rotateRightBtn = layerElement.querySelector('.rotate-right');
        const flipHBtn = layerElement.querySelector('.flip-h');
        const flipVBtn = layerElement.querySelector('.flip-v');
        const resetAdjustBtn = layerElement.querySelector('.reset-adjust');
        // Per-control reset buttons
        const resetOpacityBtn = layerElement.querySelector('.reset-opacity');
        const resetBrightnessBtn = layerElement.querySelector('.reset-brightness');
        const resetContrastBtn = layerElement.querySelector('.reset-contrast');
        const resetSaturationBtn = layerElement.querySelector('.reset-saturation');
        const resetHueBtn = layerElement.querySelector('.reset-hue');
        const resetBlurBtn = layerElement.querySelector('.reset-blur');
        const resetGrayscaleBtn = layerElement.querySelector('.reset-grayscale');
        const resetRotationBtn = layerElement.querySelector('.reset-rotation');
        // Crop controls inside panel
        const startCropBtn = layerElement.querySelector('.start-crop');
        const applyCropBtn = layerElement.querySelector('.apply-crop');
        const cancelCropBtn = layerElement.querySelector('.cancel-crop');
        const clearCropBtn = layerElement.querySelector('.clear-crop');

        // Opacity control
        opacitySlider.addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            layer.opacity = opacity;
            opacityValue.textContent = `${e.target.value}%`;
            this.renderCanvas();
        });

        // Setup adjustments dropdown accessibility and toggle
        if (adjustments && adjustmentsToggle && adjustmentsPanel) {
            const panelId = `${layer.id}-adjustments`;
            adjustmentsPanel.id = panelId;
            adjustmentsToggle.setAttribute('aria-controls', panelId);
            adjustmentsToggle.setAttribute('aria-expanded', 'false');

            const animateOpen = () => {
                if (adjustmentsPanel.classList.contains('open')) return;
                adjustmentsPanel.classList.add('open');
                // Measure target height
                const target = adjustmentsPanel.scrollHeight;
                // Start from current height (0 or set value)
                adjustmentsPanel.style.height = '0px';
                // Force reflow to ensure transition starts from 0
                void adjustmentsPanel.offsetHeight;
                // Animate to full height
                adjustmentsPanel.style.height = `${target}px`;
                const onEnd = (e) => {
                    if (e.propertyName !== 'height') return;
                    // Keep open state by setting auto height
                    adjustmentsPanel.style.height = 'auto';
                    adjustmentsPanel.removeEventListener('transitionend', onEnd);
                };
                adjustmentsPanel.addEventListener('transitionend', onEnd);
                adjustmentsToggle.classList.add('open');
                adjustmentsToggle.setAttribute('aria-expanded', 'true');
            };

            const animateClose = () => {
                if (!adjustmentsPanel.classList.contains('open')) return;
                // Set current explicit height to allow transition to 0
                const current = adjustmentsPanel.scrollHeight;
                adjustmentsPanel.style.height = `${current}px`;
                // Force reflow then collapse to 0
                void adjustmentsPanel.offsetHeight;
                adjustmentsPanel.style.height = '0px';
                const onEnd = (e) => {
                    if (e.propertyName !== 'height') return;
                    adjustmentsPanel.classList.remove('open');
                    adjustmentsPanel.style.height = '';
                    adjustmentsPanel.removeEventListener('transitionend', onEnd);
                };
                adjustmentsPanel.addEventListener('transitionend', onEnd);
                adjustmentsToggle.classList.remove('open');
                adjustmentsToggle.setAttribute('aria-expanded', 'false');
            };

            adjustmentsToggle.addEventListener('click', () => {
                const isOpen = adjustmentsPanel.classList.contains('open');
                if (isOpen) animateClose(); else animateOpen();
            });
        }

        // Adjustment listeners
        const updateAndRender = () => this.renderCanvas();
        brightnessSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.brightness = val;
            brightnessValue.textContent = `${val}%`;
            updateAndRender();
        });
        contrastSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.contrast = val;
            contrastValue.textContent = `${val}%`;
            updateAndRender();
        });
        saturationSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.saturation = val;
            saturationValue.textContent = `${val}%`;
            updateAndRender();
        });
        hueSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.hue = val;
            hueValue.textContent = `${val}°`;
            updateAndRender();
        });
        blurSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.blur = val;
            blurValue.textContent = `${val}px`;
            updateAndRender();
        });
        grayscaleSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.filters.grayscale = val;
            grayscaleValue.textContent = `${val}%`;
            updateAndRender();
        });
        rotationSlider.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            layer.transform.rotation = val;
            rotationValue.textContent = `${val}°`;
            updateAndRender();
        });
        rotateLeftBtn.addEventListener('click', () => {
            layer.transform.rotation = (((layer.transform.rotation - 90) % 360) + 360) % 360;
            rotationSlider.value = String(layer.transform.rotation > 180 ? layer.transform.rotation - 360 : layer.transform.rotation);
            rotationValue.textContent = `${rotationSlider.value}°`;
            updateAndRender();
        });
        rotateRightBtn.addEventListener('click', () => {
            layer.transform.rotation = (((layer.transform.rotation + 90) % 360) + 360) % 360;
            rotationSlider.value = String(layer.transform.rotation > 180 ? layer.transform.rotation - 360 : layer.transform.rotation);
            rotationValue.textContent = `${rotationSlider.value}°`;
            updateAndRender();
        });
        const toggleBtnActive = (btn, active) => {
            btn.classList.toggle('active', !!active);
        };
        flipHBtn.addEventListener('click', () => {
            layer.transform.flipH = !layer.transform.flipH;
            toggleBtnActive(flipHBtn, layer.transform.flipH);
            updateAndRender();
        });
        flipVBtn.addEventListener('click', () => {
            layer.transform.flipV = !layer.transform.flipV;
            toggleBtnActive(flipVBtn, layer.transform.flipV);
            updateAndRender();
        });
        resetAdjustBtn.addEventListener('click', () => {
            layer.filters = { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, grayscale: 0 };
            layer.transform = { rotation: 0, flipH: false, flipV: false };
            brightnessSlider.value = '100'; brightnessValue.textContent = '100%';
            contrastSlider.value = '100'; contrastValue.textContent = '100%';
            saturationSlider.value = '100'; saturationValue.textContent = '100%';
            hueSlider.value = '0'; hueValue.textContent = '0°';
            blurSlider.value = '0'; blurValue.textContent = '0px';
            grayscaleSlider.value = '0'; grayscaleValue.textContent = '0%';
            rotationSlider.value = '0'; rotationValue.textContent = '0°';
            flipHBtn.classList.remove('active');
            flipVBtn.classList.remove('active');
            updateAndRender();
        });

        // Per-control resets
        if (resetOpacityBtn) resetOpacityBtn.addEventListener('click', () => {
            layer.opacity = 1; opacitySlider.value = '100'; opacityValue.textContent = '100%'; updateAndRender();
        });
        if (resetBrightnessBtn) resetBrightnessBtn.addEventListener('click', () => {
            layer.filters.brightness = 100; brightnessSlider.value = '100'; brightnessValue.textContent = '100%'; updateAndRender();
        });
        if (resetContrastBtn) resetContrastBtn.addEventListener('click', () => {
            layer.filters.contrast = 100; contrastSlider.value = '100'; contrastValue.textContent = '100%'; updateAndRender();
        });
        if (resetSaturationBtn) resetSaturationBtn.addEventListener('click', () => {
            layer.filters.saturation = 100; saturationSlider.value = '100'; saturationValue.textContent = '100%'; updateAndRender();
        });
        if (resetHueBtn) resetHueBtn.addEventListener('click', () => {
            layer.filters.hue = 0; hueSlider.value = '0'; hueValue.textContent = '0°'; updateAndRender();
        });
        if (resetBlurBtn) resetBlurBtn.addEventListener('click', () => {
            layer.filters.blur = 0; blurSlider.value = '0'; blurValue.textContent = '0px'; updateAndRender();
        });
        if (resetGrayscaleBtn) resetGrayscaleBtn.addEventListener('click', () => {
            layer.filters.grayscale = 0; grayscaleSlider.value = '0'; grayscaleValue.textContent = '0%'; updateAndRender();
        });
        if (resetRotationBtn) resetRotationBtn.addEventListener('click', () => {
            layer.transform.rotation = 0; rotationSlider.value = '0'; rotationValue.textContent = '0°'; updateAndRender();
        });

        // Crop control bindings (global crop, accessible per layer panel)
        const syncCropButtons = () => {
            const is = !!this.isCropping;
            if (startCropBtn) startCropBtn.disabled = is;
            if (applyCropBtn) applyCropBtn.disabled = !is;
            if (cancelCropBtn) cancelCropBtn.disabled = !is;
        };
        if (startCropBtn) startCropBtn.addEventListener('click', () => { this.enterCropMode(); syncCropButtons(); });
        if (applyCropBtn) applyCropBtn.addEventListener('click', () => { this.applyCrop(); syncCropButtons(); });
        if (cancelCropBtn) cancelCropBtn.addEventListener('click', () => { this.exitCropMode(); syncCropButtons(); });
        if (clearCropBtn) clearCropBtn.addEventListener('click', () => { this.clearCropMask(); syncCropButtons(); });
        // Initial state
        syncCropButtons();

        // Visibility toggle
        visibilityBtn.addEventListener('click', () => {
            layer.visible = !layer.visible;
            visibilityBtn.classList.toggle('hidden', !layer.visible);
            visibilityBtn.querySelector('i').className = layer.visible ? 'fas fa-eye' : 'fas fa-eye-slash';
            this.renderCanvas();
        });

        // Delete layer
        deleteBtn.addEventListener('click', () => {
            this.removeLayer(layer.id);
        });

        // Make draggable for reordering (mouse + keyboard)
        this.makeDraggable(layerElement);
        this.enableKeyboardReorder(layerElement);

        // Remove empty state if present
        const empty = this.layersContainer.querySelector('.empty-state');
        if (empty) empty.remove();

        this.layersContainer.appendChild(layerElement);
    }

    makeDraggable(element) {
        const dragArea = element.querySelector('.layer-drag-area');
        let draggedElement = null;
        let placeholder = null;
        const self = this;

        // Helper to begin drag
        const beginDrag = (e) => {
            draggedElement = element;
            element.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';

            // Create placeholder
            placeholder = document.createElement('div');
            placeholder.className = 'layer-placeholder';
            placeholder.style.height = element.offsetHeight + 'px';

            // Drag preview: the element itself
            e.dataTransfer.setDragImage(element, Math.min(50, element.offsetWidth / 2), Math.min(25, element.offsetHeight / 2));

            // Store global refs
            self.currentDraggedElement = draggedElement;
            self.currentPlaceholder = placeholder;
        };

        // Make the drag handle draggable
        dragArea.draggable = true;
        dragArea.addEventListener('dragstart', beginDrag);

        // Also allow dragging from the whole item unless interacting with controls
        const interactiveSelectors = ['.opacity-slider', '.layer-btn', 'input', 'button', 'a', 'label'];
        element.addEventListener('mousedown', (e) => {
            const target = e.target;
            if (interactiveSelectors.some(sel => target.closest(sel))) {
                element.draggable = false;
            } else {
                element.draggable = true;
            }
        });
        element.addEventListener('dragstart', (e) => {
            // If drag originated from allowed area (either not interactive or the drag handle)
            const target = e.target;
            if (interactiveSelectors.some(sel => target.closest(sel)) && !target.closest('.layer-drag-area')) {
                e.preventDefault();
                return;
            }
            beginDrag(e);
        });

        const endDrag = () => {
            element.classList.remove('dragging');

            // Move the dragged element to where the placeholder is
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.insertBefore(element, placeholder);
                placeholder.parentNode.removeChild(placeholder);
            }

            draggedElement = null;
            placeholder = null;
            self.currentDraggedElement = null;
            self.currentPlaceholder = null;

            // Stop any autoscroll
            this.stopAutoscroll();

            // Reorder the layers array to match DOM order
            this.reorderLayers();
        };

        dragArea.addEventListener('dragend', endDrag);
        element.addEventListener('dragend', endDrag);

        // Prevent text selection during drag
        element.addEventListener('selectstart', (e) => {
            if (element.classList.contains('dragging')) e.preventDefault();
        });
    }

    setupLayerDragContainer() {
        // Set ARIA role for accessibility
        this.layersContainer.setAttribute('role', 'list');

        // Add dragover to the layers container for better drop zone handling + autoscroll
        this.layersContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (!this.currentDraggedElement || !this.currentPlaceholder) return;

            // Find the element we're hovering over
            const afterElement = this.getDragAfterElement(this.layersContainer, e.clientY);

            // Determine if the drop would not change position
            const dragged = this.currentDraggedElement;
            const samePosition = (
                (afterElement === dragged?.nextElementSibling) ||
                (afterElement == null && dragged && dragged.nextElementSibling == null)
            );

            if (samePosition) {
                // If placeholder is currently in DOM, remove it to avoid previewing no-op drop
                if (this.currentPlaceholder.parentNode) {
                    this.currentPlaceholder.parentNode.removeChild(this.currentPlaceholder);
                }
            } else {
                if (afterElement == null) {
                    this.layersContainer.appendChild(this.currentPlaceholder);
                } else {
                    this.layersContainer.insertBefore(this.currentPlaceholder, afterElement);
                }
            }

            // Autoscroll when near container edges
            this.handleAutoscroll(e);
        });
    }

    setupSidebarResize() {
        const resizer = this.sidebarResizer;
        const sidebar = this.sidebar;
        if (!resizer || !sidebar) return;

        const MIN = 280; // ensure room for icons/controls
        const MAX = 640;
        let startX = 0;
        let startWidth = 0;
        let isResizing = false;

        // Apply saved width if available
        const savedRaw = localStorage.getItem('sidebarWidth');
        const saved = Number(savedRaw);
        if (!Number.isNaN(saved)) {
            const clamped = Math.max(MIN, Math.min(MAX, Math.round(saved)));
            sidebar.style.width = `${clamped}px`;
            resizer.setAttribute('aria-valuenow', String(clamped));
        } else {
            const current = parseInt(getComputedStyle(sidebar).width, 10) || 300;
            const clamped = Math.max(MIN, Math.min(MAX, current));
            sidebar.style.width = `${clamped}px`;
            resizer.setAttribute('aria-valuenow', String(clamped));
        }

        const onPointerMove = (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const next = Math.max(MIN, Math.min(MAX, Math.round(startWidth + dx)));
            sidebar.style.width = `${next}px`;
            resizer.setAttribute('aria-valuenow', String(next));
            this.resizeCanvas();
        };

        const stopResize = (e) => {
            if (!isResizing) return;
            isResizing = false;
            try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const widthNow = parseInt(getComputedStyle(sidebar).width, 10);
            if (!Number.isNaN(widthNow)) localStorage.setItem('sidebarWidth', String(widthNow));
        };

        resizer.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return; // left button only
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(getComputedStyle(sidebar).width, 10);
            resizer.setPointerCapture(e.pointerId);
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        resizer.addEventListener('pointermove', onPointerMove);
        resizer.addEventListener('pointerup', stopResize);
        resizer.addEventListener('pointercancel', stopResize);

        // Double-click to reset to default width
        resizer.addEventListener('dblclick', () => {
            const def = 300;
            sidebar.style.width = `${def}px`;
            resizer.setAttribute('aria-valuenow', String(def));
            localStorage.setItem('sidebarWidth', String(def));
            this.resizeCanvas();
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.layer-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    reorderLayers() {
        // Get the current DOM order of layer elements
        const layerElements = [...this.layersContainer.querySelectorAll('.layer-item')];
        const newOrder = layerElements.map(el => el.getAttribute('data-layer-id'));

        // Create a new layers array in the DOM order
        const reorderedLayers = [];
        newOrder.forEach(layerId => {
            const layer = this.layers.find(l => l.id === layerId);
            if (layer) {
                reorderedLayers.push(layer);
            }
        });

        // Update the layers array
        this.layers = reorderedLayers;

        // Re-render the canvas
        this.renderCanvas();
    }

    enableKeyboardReorder(element) {
        element.addEventListener('keydown', (e) => {
            const actedOnSelf = e.target === element; // only when the layer item itself is focused

            // Reorder
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && actedOnSelf) {
                e.preventDefault();
                const isUp = e.key === 'ArrowUp';
                const current = element;
                const container = this.layersContainer;
                if (isUp) {
                    const prev = current.previousElementSibling;
                    if (prev) {
                        container.insertBefore(current, prev);
                        this.reorderLayers();
                        current.focus();
                    }
                } else {
                    const next = current.nextElementSibling;
                    if (next) {
                        container.insertBefore(next, current); // swap with next
                        this.reorderLayers();
                        current.focus();
                    }
                }
                return;
            }

            // Delete selected layer
            if ((e.key === 'Delete' || e.key === 'Backspace') && actedOnSelf) {
                e.preventDefault();
                const layerId = element.getAttribute('data-layer-id');
                const focusTarget = element.previousElementSibling || element.nextElementSibling || null;
                this.removeLayer(layerId);
                if (focusTarget) focusTarget.focus();
                return;
            }

            // Toggle visibility on Enter
            if ((e.key === 'Enter' || e.key === 'NumpadEnter') && actedOnSelf) {
                e.preventDefault();
                const btn = element.querySelector('.visibility-btn');
                if (btn) btn.click();
                return;
            }
        });
    }

    handleAutoscroll(e) {
        const container = this.layersContainer;
        const rect = container.getBoundingClientRect();
        const threshold = 40; // px from top/bottom to start scrolling
        const maxSpeed = 16; // px per frame
        let speed = 0;

        if (e.clientY < rect.top + threshold) {
            speed = -((rect.top + threshold - e.clientY) / threshold) * maxSpeed;
        } else if (e.clientY > rect.bottom - threshold) {
            speed = ((e.clientY - (rect.bottom - threshold)) / threshold) * maxSpeed;
        } else {
            speed = 0;
        }

        this.autoscrollSpeed = speed;
        if (!this.autoscrollRAF && speed !== 0) {
            this.autoscrollLoop();
        } else if (speed === 0 && this.autoscrollRAF) {
            this.stopAutoscroll();
        }
    }

    autoscrollLoop() {
        const container = this.layersContainer;
        if (this.autoscrollSpeed && this.autoscrollSpeed !== 0) {
            container.scrollTop += this.autoscrollSpeed;
            this.autoscrollRAF = requestAnimationFrame(() => this.autoscrollLoop());
        } else {
            this.stopAutoscroll();
        }
    }

    stopAutoscroll() {
        if (this.autoscrollRAF) {
            cancelAnimationFrame(this.autoscrollRAF);
            this.autoscrollRAF = null;
        }
        this.autoscrollSpeed = 0;
    }

    removeLayer(layerId) {
        this.layers = this.layers.filter(layer => layer.id !== layerId);
        const layerElement = this.layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        if (layerElement) {
            layerElement.remove();
        }
        
        this.updateLayerCount();
        this.renderCanvas();
        
        if (this.layers.length === 0) {
            this.showDropZone();
        }
    }

    clearAllLayers() {
        this.layers = [];
        this.layersContainer.innerHTML = '<div class="empty-state"><i class="fas fa-images"></i><p>No layers yet</p><p class="empty-subtitle">Add images to get started</p></div>';
        this.updateLayerCount();
        this.showDropZone();
        this.clearCanvas();
        this.appliedCrop = null;
    }

    autoFitLayers() {
        if (this.layers.length === 0) return;

        const canvasWidth = this.viewWidth || this.canvas.width;
        const canvasHeight = this.viewHeight || this.canvas.height;

        // Define target display size (85% of canvas to leave margin)
        const targetDisplayWidth = canvasWidth * 0.85;
        const targetDisplayHeight = canvasHeight * 0.85;

        // Make all images the exact same display size while maintaining their aspect ratios
        this.layers.forEach(layer => {
            const imageAspectRatio = layer.image.width / layer.image.height;
            const targetAspectRatio = targetDisplayWidth / targetDisplayHeight;

            let finalWidth, finalHeight;

            if (imageAspectRatio > targetAspectRatio) {
                // Image is wider than target - fit to width
                finalWidth = targetDisplayWidth;
                finalHeight = targetDisplayWidth / imageAspectRatio;
            } else {
                // Image is taller than target - fit to height
                finalHeight = targetDisplayHeight;
                finalWidth = targetDisplayHeight * imageAspectRatio;
            }

            // Calculate scale and apply
            layer.scale = finalWidth / layer.image.width;
            layer.width = finalWidth;
            layer.height = finalHeight;

            // Center all layers
            layer.x = (canvasWidth - layer.width) / 2;
            layer.y = (canvasHeight - layer.height) / 2;
        });

        this.renderCanvas();

        // Show feedback to user
        this.showNotification('All images auto-fitted to same size');
    }

    showNotification(message) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(99, 102, 241, 0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    resizeCanvas() {
        const container = this.canvasContainer;
        const rect = container.getBoundingClientRect();
        const cssW = Math.max(1, Math.round(rect.width));
        const cssH = Math.max(1, Math.round(rect.height));
        const dpr = Math.min(3, Math.max(1, (window.devicePixelRatio || 1)));
        this.dpr = dpr;

        // Set backing store size in device pixels and CSS size for layout
        this.canvas.width = cssW * dpr;
        this.canvas.height = cssH * dpr;
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';

        // Keep logical view dims in CSS pixels for our math
        this.viewWidth = cssW;
        this.viewHeight = cssH;

        this.clampPan();
        this.renderCanvas();
    }

    renderCanvas() {
        this.clearCanvas();
        const width = this.viewWidth || this.canvas.width;
        const height = this.viewHeight || this.canvas.height;

        // Base DPR so our coordinates are in CSS pixels
        const dpr = this.dpr || 1;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        try { this.ctx.imageSmoothingQuality = 'high'; } catch (_) {}

        // Clip live selection (screen space) BEFORE applying zoom/pan transforms
        const hasLiveClip = !!(this.isCropping && this.cropRect && this.cropRect.w > 0 && this.cropRect.h > 0);
        if (hasLiveClip) {
            const c = this.cropRect;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(c.x, c.y, c.w, c.h);
            this.ctx.clip();
            this.ctx.closePath();
        }

        // Zoom transform around canvas center (content-space)
        this.ctx.save();
        // Apply zoom and pan around canvas center; pan is in screen space
        this.ctx.translate(width / 2 + this.panX, height / 2 + this.panY);
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(-width / 2, -height / 2);

        // Clip applied crop (content space) AFTER transforms
        const hasAppliedClip = !this.isCropping && !!(this.appliedCrop && this.appliedCrop.w > 0 && this.appliedCrop.h > 0);
        if (hasAppliedClip) {
            const c = this.appliedCrop;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(c.x, c.y, c.w, c.h);
            this.ctx.clip();
            this.ctx.closePath();
        }

        // Render layers in reverse order (bottom to top)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (layer.visible) {
                this.ctx.save();
                this.ctx.globalAlpha = layer.opacity;
                // Apply filters
                const f = layer.filters || {};
                const filterStr = [
                    `brightness(${f.brightness ?? 100}%)`,
                    `contrast(${f.contrast ?? 100}%)`,
                    `saturate(${f.saturation ?? 100}%)`,
                    `hue-rotate(${f.hue ?? 0}deg)`,
                    `blur(${f.blur ?? 0}px)`,
                    `grayscale(${f.grayscale ?? 0}%)`
                ].join(' ');
                this.ctx.filter = filterStr;
                // Apply transforms (rotate around center + flips)
                const t = layer.transform || {};
                const rad = ((t.rotation ?? 0) * Math.PI) / 180;
                const cx = layer.x + layer.width / 2;
                const cy = layer.y + layer.height / 2;
                this.ctx.translate(cx, cy);
                this.ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
                this.ctx.rotate(rad);
                this.ctx.drawImage(layer.image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
                this.ctx.restore();
            }
        }

        // Restore applied crop clip (content-space) if used
        if (hasAppliedClip) {
            this.ctx.restore();
        }
        // Restore content transform
        this.ctx.restore();
        // Restore live clip (screen-space) if used
        if (hasLiveClip) {
            this.ctx.restore();
        }

        // Update floating preview after each render
        this.renderPreview();
    }

    clearCanvas() {
        // Clear full backing store
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    updateLayerCount() {
        const count = this.layers.length;
        this.layerCount.textContent = `${count} layer${count !== 1 ? 's' : ''}`;
    }

    hideDropZone() {
        this.dropZone.classList.add('hidden');
    }

    showDropZone() {
        this.dropZone.classList.remove('hidden');
    }

    // Zoom helpers
    setZoom(zoom) {
        const clamped = Math.min(4, Math.max(0.25, zoom));
        this.zoom = clamped;
        // Clamp pan to new zoom bounds and toggle cursor state
        this.clampPan();
        this.canvasContainer.classList.toggle('can-pan', this.zoom > 1);
        // Update UI
        if (this.zoomSlider) {
            const percent = Math.round(clamped * 100);
            if (Number(this.zoomSlider.value) !== percent) this.zoomSlider.value = String(percent);
        }
        if (this.zoomDisplay) {
            this.zoomDisplay.textContent = `${Math.round(clamped * 100)}%`;
        }
        this.renderCanvas();
    }

    nudgeZoom(delta) {
        this.setZoom(this.zoom + delta);
    }

    // (Selection helpers removed per revert)

    // Pan helpers
    clampPan() {
        const width = this.viewWidth || this.canvas.width;
        const height = this.viewHeight || this.canvas.height;
        if (this.zoom <= 1) {
            this.panX = 0;
            this.panY = 0;
            return;
        }
        const maxX = (width * (this.zoom - 1)) / 2;
        const maxY = (height * (this.zoom - 1)) / 2;
        this.panX = Math.max(-maxX, Math.min(maxX, this.panX));
        this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
    }

    onPointerDown(e) {
        if (this.isCropping) return; // disable panning while cropping
        // Start panning on left button (0), middle (1), touch/pen when zoomed in
        const isPrimary = e.isPrimary !== false; // default true for first pointer
        if (!isPrimary) return;
        if (e.target.closest && e.target.closest('.zoom-controls')) return;
        const canPanWithButton = (e.button === 0 || e.button === 1);
        if (this.zoom <= 1 || !canPanWithButton) return;

        this.isPanning = true;
        this.panPointerId = e.pointerId;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.canvasContainer.setPointerCapture(e.pointerId);
        this.canvasContainer.classList.add('panning');
    }

    // ---- Crop Tool ----
    toggleCropMode() {
        if (this.isCropping) {
            this.exitCropMode();
        } else {
            this.enterCropMode();
        }
    }

    enterCropMode() {
        this.isCropping = true;
        // Default rect: centered, 80% of canvas
        const w = this.viewWidth || this.canvas.width;
        const h = this.viewHeight || this.canvas.height;
        const cw = Math.round(w * 0.8);
        const ch = Math.round(h * 0.8);
        const cx = Math.round((w - cw) / 2);
        const cy = Math.round((h - ch) / 2);
        // Prefer existing selection; fall back to appliedCrop; else default
        if (!this.cropRect) {
            if (this.appliedCrop) {
                this.cropRect = { ...this.appliedCrop };
            } else {
                this.cropRect = { x: cx, y: cy, w: cw, h: ch };
            }
        }
        this.updateCropRectEl();
        this.cropOverlay.classList.add('active');
        this.cropOverlay.setAttribute('aria-hidden', 'false');
        this.syncCropUI();
        // Show live crop mask immediately
        this.renderCanvas();
    }

    exitCropMode() {
        this.isCropping = false;
        this.cropDragMode = null;
        this.cropOverlay.classList.remove('active');
        this.cropOverlay.setAttribute('aria-hidden', 'true');
        this.syncCropUI();
    }

    updateCropRectEl() {
        if (!this.cropRectEl || !this.cropRect) return;
        const { x, y, w, h } = this.cropRect;
        this.cropRectEl.style.left = `${x}px`;
        this.cropRectEl.style.top = `${y}px`;
        this.cropRectEl.style.width = `${w}px`;
        this.cropRectEl.style.height = `${h}px`;
    }

    onCropPointerDown(e) {
        if (!this.isCropping) return;
        const target = e.target;
        const rect = this.cropRect;
        if (!rect) return;
        const handle = target.getAttribute && target.getAttribute('data-handle');
        const withinRect = target === this.cropRectEl || (target && this.cropRectEl.contains(target));
        if (!withinRect) return; // only interact with rect/handles
        e.preventDefault();
        e.stopPropagation();
        this.cropPointerId = e.pointerId;
        this.cropStartX = e.clientX;
        this.cropStartY = e.clientY;
        this.cropStartRect = { ...rect };
        this.cropDragMode = handle || 'move';
        this.cropOverlay.setPointerCapture && this.cropOverlay.setPointerCapture(e.pointerId);
    }

    onCropPointerMove(e) {
        if (!this.isCropping || e.pointerId !== this.cropPointerId) return;
        const dx = e.clientX - this.cropStartX;
        const dy = e.clientY - this.cropStartY;
        const minSize = 40;
        // Bounds should be in CSS pixels (same space as cropRect and pointer deltas)
        const boundsW = this.viewWidth || this.canvas.clientWidth || this.canvas.width;
        const boundsH = this.viewHeight || this.canvas.clientHeight || this.canvas.height;
        let { x, y, w, h } = this.cropStartRect;
        const mode = this.cropDragMode;

        const clamp = () => {
            // keep within canvas
            x = Math.max(0, Math.min(boundsW - minSize, x));
            y = Math.max(0, Math.min(boundsH - minSize, y));
            w = Math.max(minSize, Math.min(boundsW - x, w));
            h = Math.max(minSize, Math.min(boundsH - y, h));
        };

        switch (mode) {
            case 'move':
                x += dx; y += dy; clamp(); break;
            case 'n':
                y += dy; h -= dy; clamp(); break;
            case 's':
                h += dy; clamp(); break;
            case 'w':
                x += dx; w -= dx; clamp(); break;
            case 'e':
                w += dx; clamp(); break;
            case 'nw':
                x += dx; w -= dx; y += dy; h -= dy; clamp(); break;
            case 'ne':
                y += dy; h -= dy; w += dx; clamp(); break;
            case 'sw':
                x += dx; w -= dx; h += dy; clamp(); break;
            case 'se':
                w += dx; h += dy; clamp(); break;
        }

        this.cropRect = { x, y, w, h };
        this.updateCropRectEl();
        // Live preview of crop while dragging
        this.renderCanvas();
    }

    onCropPointerUp(e) {
        if (e.pointerId !== this.cropPointerId) return;
        this.cropPointerId = null;
        this.cropDragMode = null;
        try { this.cropOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    applyCrop() {
        if (!this.cropRect) { this.exitCropMode(); return; }
        // Persist crop as a render/export clip without moving images.
        this.appliedCrop = { ...this.cropRect };
        this.exitCropMode();
        this.renderCanvas();
        this.syncCropUI();
    }

    syncCropUI() {
        const is = !!this.isCropping;
        const hasMask = !!this.appliedCrop;
        document.querySelectorAll('.start-crop').forEach(btn => btn.disabled = is);
        document.querySelectorAll('.apply-crop').forEach(btn => btn.disabled = !is || !this.cropRect);
        document.querySelectorAll('.cancel-crop').forEach(btn => btn.disabled = !is);
        document.querySelectorAll('.clear-crop').forEach(btn => btn.disabled = is || !hasMask);
    }

    clearCropMask() {
        this.appliedCrop = null;
        // Keep selection if currently editing; otherwise clear selection too
        if (!this.isCropping) this.cropRect = null;
        this.renderCanvas();
        this.syncCropUI();
    }

    onPointerMove(e) {
        if (!this.isPanning || e.pointerId !== this.panPointerId) return;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.panX += dx;
        this.panY += dy;
        this.clampPan();
        this.renderCanvas();
    }

    onPointerUp(e) {
        if (e.pointerId !== this.panPointerId) return;
        this.isPanning = false;
        this.panPointerId = null;
        try { this.canvasContainer.releasePointerCapture(e.pointerId); } catch (_) {}
        this.canvasContainer.classList.remove('panning');
    }

    // ----- Floating live preview helpers -----
    updatePreviewVisibility() {
        if (!this.previewContainer || !this.canvasContainer) return;
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (!isMobile) {
            this.previewContainer.classList.add('hidden');
            return;
        }
        const rect = this.canvasContainer.getBoundingClientRect();
        // Consider canvas 'in view' when a good portion is visible
        const inView = rect.top < window.innerHeight * 0.75 && rect.bottom > window.innerHeight * 0.25;
        const anyAdjustOpen = !!document.querySelector('.adjustments-panel.open');
        const shouldShow = anyAdjustOpen && !inView;
        this.previewContainer.classList.toggle('hidden', !shouldShow);
    }

    renderPreview() {
        if (!this.previewContainer || this.previewContainer.classList.contains('hidden')) return;
        if (!this.previewCanvas) return;
        const pc = this.previewCanvas;
        const pw = this.previewContainer.clientWidth || 180;
        const ph = this.previewContainer.clientHeight || 120;
        const dpr = Math.min(2, Math.max(1, Math.floor(window.devicePixelRatio || 1)));
        pc.width = Math.max(1, Math.round(pw * dpr));
        pc.height = Math.max(1, Math.round(ph * dpr));
        const pctx = pc.getContext('2d');
        pctx.setTransform(1,0,0,1,0,0);
        pctx.clearRect(0,0,pc.width, pc.height);
        pctx.imageSmoothingEnabled = true;
        try { pctx.imageSmoothingQuality = 'high'; } catch(_) {}

        const canvas = this.canvas;
        const CANW = canvas.width;   // device pixels
        const CANH = canvas.height;  // device pixels
        const baseDpr = this.dpr || 1;
        if (!CANW || !CANH) return;

        // Determine the source region to show in the preview.
        // Prefer an applied crop; otherwise use the tight bounds of visible layers as a best-effort,
        // falling back to the full canvas.
        let srcX = 0, srcY = 0, srcW = CANW, srcH = CANH;
        if (this.appliedCrop && this.appliedCrop.w > 0 && this.appliedCrop.h > 0) {
            // Convert CSS px crop to device px
            const ax = Math.round(this.appliedCrop.x * baseDpr);
            const ay = Math.round(this.appliedCrop.y * baseDpr);
            const aw = Math.round(this.appliedCrop.w * baseDpr);
            const ah = Math.round(this.appliedCrop.h * baseDpr);
            srcX = Math.max(0, Math.min(CANW, ax));
            srcY = Math.max(0, Math.min(CANH, ay));
            srcW = Math.max(1, Math.min(CANW - srcX, aw));
            srcH = Math.max(1, Math.min(CANH - srcY, ah));
        } else if (this.layers && this.layers.length) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < this.layers.length; i++) {
                const L = this.layers[i];
                if (!L || !L.visible) continue;
                // Approximate bounds (ignores rotation for simplicity)
                minX = Math.min(minX, L.x);
                minY = Math.min(minY, L.y);
                maxX = Math.max(maxX, L.x + L.width);
                maxY = Math.max(maxY, L.y + L.height);
            }
            if (minX !== Infinity && minY !== Infinity && maxX > minX && maxY > minY) {
                // Convert layer bounds in CSS px to device px
                const bx = Math.floor(minX * baseDpr);
                const by = Math.floor(minY * baseDpr);
                const bw = Math.ceil((maxX - minX) * baseDpr);
                const bh = Math.ceil((maxY - minY) * baseDpr);
                srcX = Math.max(0, bx);
                srcY = Math.max(0, by);
                srcW = Math.min(CANW - srcX, bw);
                srcH = Math.min(CANH - srcY, bh);
            }
        }

        // Fit the source rect into the preview box (contain)
        const scale = Math.min(pc.width / srcW, pc.height / srcH);
        const drawW = Math.max(1, Math.round(srcW * scale));
        const drawH = Math.max(1, Math.round(srcH * scale));
        const dx = Math.floor((pc.width - drawW) / 2);
        const dy = Math.floor((pc.height - drawH) / 2);
        pctx.drawImage(canvas, srcX, srcY, srcW, srcH, dx, dy, drawW, drawH);
    }

    // ----- Floating preview drag -----
    setupFloatingPreviewDrag() {
        const box = this.previewContainer;
        if (!box) return;

        // Internal state
        let dragging = false;
        let startX = 0, startY = 0;
        let startLeft = null, startTop = null;
        let startW = null, startH = null;
        let pointerId = null;
        let mode = null; // 'move' | 'pending' | 'resize'
        let corner = null; // 'nw' | 'ne' | 'sw' | 'se'
        let holdTimer = null;
        let resizeUnlocked = false;
        const HOLD_MS = 500; // 0.5s long-press to unlock resize
        const MOVE_TOLERANCE = 12; // px - allow a little wiggle while holding

        const ensureLeftTop = () => {
            const style = window.getComputedStyle(box);
            const rect = box.getBoundingClientRect();
            const hasLeft = style.left !== 'auto';
            const hasTop = style.top !== 'auto';
            if (!hasLeft || !hasTop) {
                // Convert existing right/bottom anchoring to left/top
                const left = Math.max(0, Math.round(rect.left));
                const top = Math.max(0, Math.round(rect.top));
                box.style.left = left + 'px';
                box.style.top = top + 'px';
                box.style.right = 'auto';
                box.style.bottom = 'auto';
            }
        };

        const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

        const cornerUnderPointer = (e) => {
            const rect = box.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const cornerPad = 24; // larger corner hit area
            const nearLeft = x <= cornerPad;
            const nearRight = rect.width - x <= cornerPad;
            const nearTop = y <= cornerPad;
            const nearBottom = rect.height - y <= cornerPad;
            if (nearLeft && nearTop) return 'nw';
            if (nearRight && nearTop) return 'ne';
            if (nearLeft && nearBottom) return 'sw';
            if (nearRight && nearBottom) return 'se';
            return null;
        };

        const cursorForCorner = (c) => {
            switch (c) {
                case 'nw':
                case 'se':
                    return 'nwse-resize';
                case 'ne':
                case 'sw':
                    return 'nesw-resize';
                default:
                    return 'grab';
            }
        };

        const onMove = (e) => {
            if (!dragging || e.pointerId !== pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const minW = 120;
            const minH = 80;

            if (mode === 'pending') {
                // If moved too far while holding, cancel pending resize and move instead
                if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
                    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                    mode = 'move';
                } else {
                    return; // still waiting for hold
                }
            }

            if (mode === 'move') {
                const rect = box.getBoundingClientRect();
                const w = rect.width;
                const h = rect.height;
                let nextLeft = clamp(startLeft + dx, 0, vw - w);
                let nextTop = clamp(startTop + dy, 0, vh - h);
                box.style.left = Math.round(nextLeft) + 'px';
                box.style.top = Math.round(nextTop) + 'px';
            } else if (mode === 'resize' && resizeUnlocked) {
                let left = startLeft;
                let top = startTop;
                let width = startW;
                let height = startH;
                switch (corner) {
                    case 'nw':
                        left = startLeft + dx;
                        top = startTop + dy;
                        width = startW - dx;
                        height = startH - dy;
                        break;
                    case 'ne':
                        top = startTop + dy;
                        width = startW + dx;
                        height = startH - dy;
                        break;
                    case 'sw':
                        left = startLeft + dx;
                        width = startW - dx;
                        height = startH + dy;
                        break;
                    case 'se':
                        width = startW + dx;
                        height = startH + dy;
                        break;
                }
                // Clamp to min sizes
                width = Math.max(minW, width);
                height = Math.max(minH, height);
                // Keep within viewport
                left = clamp(left, 0, vw - width);
                top = clamp(top, 0, vh - height);
                // Apply
                box.style.left = Math.round(left) + 'px';
                box.style.top = Math.round(top) + 'px';
                box.style.width = Math.round(width) + 'px';
                box.style.height = Math.round(height) + 'px';
                // Re-render preview at new size
                this.renderPreview();
            }
        };

        const stop = (e) => {
            if (!dragging || (e && e.pointerId !== pointerId)) return;
            dragging = false;
            box.classList.remove('dragging');
            try { if (pointerId != null) box.releasePointerCapture(pointerId); } catch (_) {}
            pointerId = null;
            mode = null;
            corner = null;
            resizeUnlocked = false;
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            box.classList.remove('show-resize-hint');
            box.removeAttribute('data-resize-corner');
            box.style.cursor = 'grab';
            // Prevent generating a click on release
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', stop, true);
            window.removeEventListener('pointercancel', stop, true);
        };

        box.addEventListener('pointerdown', (e) => {
            // Only primary pointer, and ignore if hidden
            if (box.classList.contains('hidden')) return;
            if (e.isPrimary === false) return;
            ensureLeftTop();
            const rect = box.getBoundingClientRect();
            dragging = true;
            pointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            startW = rect.width;
            startH = rect.height;
            // Decide if this is a resize or move based on corner proximity
            corner = cornerUnderPointer(e);
            if (corner) {
                // Start hold-to-resize gesture
                mode = 'pending';
                box.style.cursor = cursorForCorner(corner);
                holdTimer = setTimeout(() => {
                    resizeUnlocked = true;
                    mode = 'resize';
                    box.setAttribute('data-resize-corner', corner);
                    box.classList.add('show-resize-hint');
                    // Auto-remove hint after it plays once
                    setTimeout(() => box.classList.remove('show-resize-hint'), 700);
                }, HOLD_MS);
            } else {
                mode = 'move';
                box.style.cursor = 'grabbing';
            }
            box.classList.add('dragging');
            try { box.setPointerCapture(e.pointerId); } catch (_) {}
            // Capture moves on window so we can drag off the element
            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', stop, true);
            window.addEventListener('pointercancel', stop, true);
            // Don’t let events fall through to underlying buttons
            e.preventDefault();
            e.stopPropagation();
        });

        // Prevent long-press context menu interrupting the hold gesture
        box.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Hover cursor feedback for corners
        box.addEventListener('pointermove', (e) => {
            if (dragging) return;
            const c = cornerUnderPointer(e);
            box.style.cursor = cursorForCorner(c);
        });

        // Defensive: stop drag if visibility toggles while dragging
        const observer = new MutationObserver(() => { if (box.classList.contains('hidden')) stop(); });
        observer.observe(box, { attributes: true, attributeFilter: ['class'] });
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ImageOverlayApp();
});
