//! `MetalView`: an `MTKView` whose frames JavaScript renders with Metal or,
//! on a machine with no GPU, an empty `NSView` that lays out the same so the
//! rest of the interface still comes up.

use core::cell::{Cell, Ref};
use std::time::Instant;

use super::{Cx, Event, Orientation, Prop, View, Widget, priority};
use crate::Named;
use crate::color::Color;
use crate::error::{Error, Result};
use crate::geometry::{ClearColor, Rect, Size};
use crate::gpu::Gpu;
use crate::objc::appkit::{NSColorSpace, NSScreen, NSView};
use crate::objc::metal::{
    CAMetalDrawable, MTKView, MTLRenderPassDescriptor, MTLTexture, PixelFormat,
};
use crate::objc::{self, AutoreleasePool, Delegate, MetalViewEvents};

/// The colour format of every Metal view's drawable. A render pipeline that
/// draws into a view declares this for colour attachment 0.
pub const PIXEL_FORMAT: PixelFormat = PixelFormat::BGRA8Unorm;
/// Opaque black, `MTKView`'s own default.
const DEFAULT_CLEAR_COLOR: ClearColor = ClearColor {
    r: 0.0,
    g: 0.0,
    b: 0.0,
    a: 1.0,
};
const DEFAULT_PREFERRED_FPS: usize = 60;
const DEFAULT_RUNNING: bool = true;

/// What the frame in progress renders into. `descriptor` is a fresh one
/// each time (the pass may adjust its load actions): colour attachment 0 is
/// `color`, the drawable's texture, set to clear to the view's colour, and
/// the depth (and stencil) attachment is `depth` when the view has a depth
/// format. `drawable` is what the command buffer presents once scheduled.
pub struct MetalSurface {
    pub descriptor: MTLRenderPassDescriptor,
    pub color: MTLTexture,
    pub depth: Option<MTLTexture>,
    pub drawable: Option<CAMetalDrawable>,
    /// Pixels.
    pub size: Size,
    pub format: PixelFormat,
}

enum Backing {
    Metal {
        view: MTKView,
        /// Held so the view's weak delegate pointer stays valid; cleared in `detach`.
        _delegate: Delegate<dyn MetalViewEvents>,
    },
    /// No GPU: `error` is why.
    Placeholder { view: NSView, error: Error },
}

pub(crate) struct MetalView {
    backing: Backing,
    running: bool,
    first_frame_at: Option<Instant>,
    last_frame_at: Option<Instant>,
    /// Seconds since the first frame and since the previous one, for the
    /// frame being drawn.
    timing: (f64, f64),
    /// Last format given to `setDepthStencilPixelFormat:`, which
    /// reallocates on every call, so it is only sent on change.
    depth_format: Cell<Option<PixelFormat>>,
    /// Set by the sink around delivering [`Event::Frame`]; the drawable is
    /// only handed out inside that window.
    in_frame: Cell<bool>,
}

impl MetalView {
    pub(crate) fn new(_cx: &Cx<'_>, events: Box<dyn MetalViewEvents>) -> MetalView {
        let backing = match Gpu::shared() {
            Ok(gpu) => {
                let view = MTKView::init_with_frame_device(
                    objc::alloc::<MTKView>(),
                    Rect::default(),
                    Some(gpu.device()),
                );
                view.set_color_pixel_format(PIXEL_FORMAT);
                // Colour-matched like the sRGB colours the other views are
                // given, rather than sent to a wide-gamut display raw.
                if let Some(srgb) = NSColorSpace::srgb().cg_color_space() {
                    view.set_colorspace(Some(&srgb));
                }
                view.set_framebuffer_only(true);
                view.set_auto_resize_drawable(true);
                // Frames come from the display timer or an explicit `draw`,
                // never from `setNeedsDisplay:`; the timer stays off until
                // `sync_paused` decides.
                view.set_enable_set_needs_display(false);
                view.set_paused(true);
                view.set_clear_color(DEFAULT_CLEAR_COLOR);
                view.set_preferred_frames_per_second(fps(DEFAULT_PREFERRED_FPS));
                let delegate = Delegate::metal_view(events);
                view.set_delegate(Some(delegate.as_nsobject()));
                Backing::Metal {
                    view,
                    _delegate: delegate,
                }
            }
            Err(error) => Backing::Placeholder {
                view: NSView::init_with_frame(objc::alloc::<NSView>(), Rect::default()),
                error,
            },
        };
        let this = MetalView {
            backing,
            running: DEFAULT_RUNNING,
            first_frame_at: None,
            last_frame_at: None,
            timing: (0.0, 0.0),
            depth_format: Cell::new(None),
            in_frame: Cell::new(false),
        };
        // No intrinsic size: like a scroll view, it takes whatever room the
        // layout leaves and gives way to everything else.
        for axis in Orientation::BOTH {
            this.view()
                .set_content_hugging_priority(priority::YIELDING, axis);
            this.view()
                .set_content_compression_resistance_priority(priority::YIELDING, axis);
        }
        this.sync_paused();
        this
    }

    fn mtk(&self) -> Option<&MTKView> {
        match &self.backing {
            Backing::Metal { view, .. } => Some(view),
            Backing::Placeholder { .. } => None,
        }
    }

    /// The display timer runs only while `running` and a display exists to
    /// pace it; off screen (sandbox, ssh) frames are drawn on request alone.
    fn sync_paused(&self) {
        if let Some(view) = self.mtk() {
            view.set_paused(!(self.running && has_display()));
        }
    }

    /// Why this view cannot render: it was created without a GPU.
    pub(crate) fn gpu_error(&self) -> Option<&Error> {
        match &self.backing {
            Backing::Metal { .. } => None,
            Backing::Placeholder { error, .. } => Some(error),
        }
    }

    /// `(time, dt)` in seconds for the latest frame: since the first frame,
    /// and since the one before (0 for the first).
    pub(crate) fn frame_timing(&self) -> (f64, f64) {
        self.timing
    }

    /// The drawable's size in pixels; `None` without a GPU.
    pub(crate) fn drawable_size(&self) -> Option<Size> {
        self.mtk().map(MTKView::drawable_size)
    }

    /// The render target for the frame in progress, with the view's depth
    /// texture in `depth_format` attached (`None` for colour only).
    /// `Unsupported` outside a frame; `NoDrawable` for a zero-sized (not yet
    /// laid out) view or when the layer has none free.
    pub(crate) fn current_surface(
        &self,
        depth_format: Option<PixelFormat>,
    ) -> Result<MetalSurface> {
        let view = self.mtk().ok_or(Error::NoGpu)?;
        if !self.in_frame.get() {
            return Err(Error::InvalidState(
                "a MetalView can only be rendered into from inside its onFrame handler",
            ));
        }
        let size = view.drawable_size();
        if size.width < 1.0 || size.height < 1.0 {
            // `currentDrawable` would block for its full timeout before
            // giving up on a layer this size.
            return Err(Error::NoDrawable);
        }
        if let Some(format) = depth_format {
            if !format.is_depth() {
                return Err(Error::Unsupported(
                    "a view's depthFormat must be depth32float or depth32float-stencil8",
                ));
            }
            if self.depth_format.get() != Some(format) {
                view.set_depth_stencil_pixel_format(format);
                self.depth_format.set(Some(format));
            }
        }
        let descriptor = view
            .current_render_pass_descriptor()
            .ok_or(Error::NoDrawable)?;
        let color = descriptor
            .color_attachments()
            .object_at(0)
            .texture()
            .ok_or(Error::NoDrawable)?;
        let depth = if depth_format.is_some() {
            Some(
                descriptor
                    .depth_attachment()
                    .texture()
                    .ok_or(Error::Unsupported(
                        "the view could not allocate a depth texture",
                    ))?,
            )
        } else {
            // The view keeps its depth texture for the next pass that wants
            // it; this pass goes without.
            descriptor.set_depth_attachment(None);
            descriptor.set_stencil_attachment(None);
            None
        };
        Ok(MetalSurface {
            descriptor,
            color,
            depth,
            drawable: view.current_drawable(),
            size,
            format: PixelFormat::from_raw(view.color_pixel_format()).unwrap_or(PIXEL_FORMAT),
        })
    }
}

/// Views are built before `App::start` as often as after, so this asks
/// AppKit directly rather than the app.
fn has_display() -> bool {
    NSScreen::screens().count() > 0
}

fn fps(value: usize) -> isize {
    isize::try_from(value.max(1)).unwrap_or(isize::MAX)
}

/// System colours resolve to their sRGB value for the current appearance,
/// once; Metal has no dynamic colours.
fn clear_color(color: &Color) -> Result<ClearColor> {
    match *color {
        Color::Rgba { r, g, b, a } => Ok(ClearColor {
            r: f64::from(r),
            g: f64::from(g),
            b: f64::from(b),
            a: f64::from(a),
        }),
        Color::System(system) => {
            let ns = system
                .nscolor()
                .color_using_color_space(&NSColorSpace::srgb())
                .ok_or_else(|| Error::BadColor(system.name().to_owned()))?;
            Ok(ClearColor {
                r: ns.red_component(),
                g: ns.green_component(),
                b: ns.blue_component(),
                a: ns.alpha_component(),
            })
        }
    }
}

impl Widget for MetalView {
    fn view(&self) -> &NSView {
        match &self.backing {
            Backing::Metal { view, .. } => view,
            Backing::Placeholder { view, .. } => view,
        }
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::ClearColor(color) => {
                let color = match color {
                    Some(color) => clear_color(&color)?,
                    None => DEFAULT_CLEAR_COLOR,
                };
                if let Some(view) = self.mtk() {
                    view.set_clear_color(color);
                }
            }
            Prop::PreferredFps(v) => {
                if let Some(view) = self.mtk() {
                    view.set_preferred_frames_per_second(fps(v.unwrap_or(DEFAULT_PREFERRED_FPS)));
                }
            }
            Prop::Running(v) => {
                self.running = v.unwrap_or(DEFAULT_RUNNING);
                self.sync_paused();
            }
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn on_frame(&mut self, emit: &mut dyn FnMut(Event)) {
        let now = Instant::now();
        let first = *self.first_frame_at.get_or_insert(now);
        let dt = self
            .last_frame_at
            .map_or(0.0, |last| now.duration_since(last).as_secs_f64());
        self.last_frame_at = Some(now);
        self.timing = (now.duration_since(first).as_secs_f64(), dt);
        emit(Event::Frame);
    }

    fn on_drawable_resized(&mut self, size: Size, emit: &mut dyn FnMut(Event)) {
        emit(Event::DrawableResized(size));
    }

    fn metal(&self) -> Option<&MetalView> {
        Some(self)
    }

    fn attached(&mut self, _axis: Option<Orientation>) {
        self.sync_paused();
    }

    fn detach(&mut self) {
        if let Some(view) = self.mtk() {
            view.set_paused(true);
            view.set_delegate(None);
        }
    }
}

/// Metal view accessors. Each is `None`, or does nothing, for other kinds.
impl View {
    /// Draws one frame now: the view emits [`Event::Frame`] before this
    /// returns. Does nothing without a GPU. `Unsupported` from inside this
    /// view's own frame handler: a frame is one drawable, and it is in use.
    pub fn draw(&self) -> Result<()> {
        let _pool = AutoreleasePool::new();
        let view = {
            let widget = self.inner.widget.borrow();
            let Some(metal) = widget.metal() else {
                return Err(Error::Unsupported("only a MetalView draws frames"));
            };
            if metal.in_frame.get() {
                return Err(Error::InvalidState(
                    "MetalView.draw() cannot run inside that view's onFrame; schedule it (setImmediate) instead",
                ));
            }
            metal.mtk().cloned()
        };
        // The widget borrow has ended: the frame handler runs JavaScript,
        // which may set props on this very view.
        if let Some(view) = view {
            view.draw();
        }
        Ok(())
    }

    /// What the frame in progress renders into; only answers between
    /// [`begin_frame`](View::begin_frame) and [`end_frame`](View::end_frame)
    /// (`Unsupported` otherwise). `depth_format` attaches the view's depth
    /// texture of that format, allocating it on first use or when the format
    /// changes. `NoGpu` for a placeholder view, `NoDrawable` when the view
    /// has no size yet or is not a Metal view.
    pub fn render_target(
        &self,
        depth_format: Option<crate::gpu::PixelFormat>,
    ) -> Result<MetalSurface> {
        let _pool = AutoreleasePool::new();
        match self.inner.widget.borrow().metal() {
            Some(metal) => metal.current_surface(depth_format),
            None => Err(Error::NoDrawable),
        }
    }

    /// The sink calls this before handing [`Event::Frame`] on and
    /// [`end_frame`](View::end_frame) after, marking the span in which
    /// [`render_target`](View::render_target) may fetch the drawable.
    pub fn begin_frame(&self) {
        if let Some(metal) = self.inner.widget.borrow().metal() {
            metal.in_frame.set(true);
        }
    }

    pub fn end_frame(&self) {
        if let Some(metal) = self.inner.widget.borrow().metal() {
            metal.in_frame.set(false);
        }
    }

    /// `(time, dt)` in seconds as of the latest [`Event::Frame`]: since the
    /// first frame, and since the previous one.
    pub fn frame_timing(&self) -> Option<(f64, f64)> {
        Some(self.inner.widget.borrow().metal()?.frame_timing())
    }

    /// The drawable's size in pixels.
    pub fn drawable_size(&self) -> Option<Size> {
        self.inner.widget.borrow().metal()?.drawable_size()
    }

    /// Why a Metal view will never draw: there is no GPU. `None` for a
    /// working Metal view and for other kinds.
    pub fn gpu_error(&self) -> Option<Ref<'_, Error>> {
        Ref::filter_map(self.inner.widget.borrow(), |widget| {
            widget.metal()?.gpu_error()
        })
        .ok()
    }
}
