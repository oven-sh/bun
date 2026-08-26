//! `MetalView`, the one view still built natively: an `MTKView` whose frames
//! JavaScript renders with Metal or, on a machine with no GPU, an empty
//! `NSView` that lays out the same so the rest of the interface still comes
//! up. Where the view sits, its size, `grow` and decoration are JavaScript's,
//! done on the `NSView` through the bridge like for every view it builds
//! itself; this file is the display timer, the clear colour and the drawable.

use core::cell::Cell;
use std::rc::{Rc, Weak};
use std::time::Instant;

use crate::app::has_display;
use crate::error::{Error, Result};
use crate::geometry::{ClearColor, Rect, Size};
use crate::gpu::Gpu;
use crate::objc::appkit::{NSColorSpace, NSView, Orientation, priority};
use crate::objc::metal::{
    CAMetalDrawable, MTKView, MTLRenderPassDescriptor, MTLTexture, PixelFormat,
};
use crate::objc::{self, AutoreleasePool, Delegate, MetalViewEvents};

/// The colour format of every Metal view's drawable, and so the default for
/// a render pipeline's colour attachment 0 and for textures.
pub const PIXEL_FORMAT: PixelFormat = PixelFormat::BGRA8Unorm;
/// Opaque black, `MTKView`'s own default.
const DEFAULT_CLEAR_COLOR: ClearColor = ClearColor {
    r: 0.0,
    g: 0.0,
    b: 0.0,
    a: 1.0,
};
const DEFAULT_PREFERRED_FPS: f64 = 60.0;
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
}

/// Receives a view's events. Called on the main thread from inside AppKit
/// event dispatch: from the view's display timer, from layout, or
/// synchronously from [`View::draw`].
pub trait ViewSink {
    /// The view wants a frame rendered now: [`View::render_target`] and
    /// [`View::frame_timing`] describe it until this returns.
    fn frame(&self);
    /// The drawable changed size (pixels).
    fn drawable_resized(&self, size: Size);
}

enum Backing {
    Metal {
        view: MTKView,
        /// Held so the view's weak delegate pointer stays valid; cleared on drop.
        _delegate: Delegate<dyn MetalViewEvents>,
    },
    /// No GPU (`Error::NoGpu`): an empty view that lays out the same.
    Placeholder(NSView),
}

struct Inner {
    backing: Backing,
    sink: Box<dyn ViewSink>,
    running: Cell<bool>,
    first_frame_at: Cell<Option<Instant>>,
    last_frame_at: Cell<Option<Instant>>,
    /// Seconds since the first frame and since the previous one, for the
    /// frame being drawn.
    timing: Cell<(f64, f64)>,
    /// Last format given to `setDepthStencilPixelFormat:`, which
    /// reallocates on every call, so it is only sent on change.
    depth_format: Cell<Option<PixelFormat>>,
    /// Set around delivering a frame; the drawable is only handed out inside
    /// that window.
    in_frame: Cell<bool>,
    /// Set by the delegate's `drawInMTKView:`; `draw` reads it to tell a
    /// frame from a draw the view swallowed.
    drew: Cell<bool>,
    /// Set while [`View::draw`] is inside `-[MTKView draw]`. MTKView also
    /// draws once of its own accord when the view first reaches a window on
    /// a display or its drawable resizes; those draws present the clear
    /// colour and do not reach the frame handler.
    drawing: Cell<bool>,
}

/// A native Metal view. Cheap to hold; the `NSView` lives as long as this
/// and whatever superview JavaScript put it in.
pub struct View {
    inner: Rc<Inner>,
}

impl View {
    /// Creates a Metal view with default configuration. Events go to `sink`.
    pub fn new(sink: Box<dyn ViewSink>) -> Result<View> {
        crate::objc::main_thread()?;
        crate::objc::load()?;
        let _pool = AutoreleasePool::new();
        let inner = Rc::new_cyclic(|weak: &Weak<Inner>| {
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
                    let delegate = Delegate::metal_view(Box::new(Handler {
                        inner: Weak::clone(weak),
                    }));
                    view.set_delegate(Some(delegate.as_nsobject()));
                    Backing::Metal {
                        view,
                        _delegate: delegate,
                    }
                }
                Err(_) => Backing::Placeholder(NSView::init_with_frame(
                    objc::alloc::<NSView>(),
                    Rect::default(),
                )),
            };
            Inner {
                backing,
                sink,
                running: Cell::new(DEFAULT_RUNNING),
                first_frame_at: Cell::new(None),
                last_frame_at: Cell::new(None),
                timing: Cell::new((0.0, 0.0)),
                depth_format: Cell::new(None),
                in_frame: Cell::new(false),
                drew: Cell::new(false),
                drawing: Cell::new(false),
            }
        });
        let view = inner.nsview();
        view.set_translates_autoresizing_mask(false);
        // No intrinsic size: like a scroll view, it takes whatever room the
        // layout leaves and gives way to everything else.
        for axis in Orientation::BOTH {
            view.set_content_hugging_priority(priority::YIELDING, axis);
            view.set_content_compression_resistance_priority(priority::YIELDING, axis);
        }
        inner.sync_paused();
        Ok(View { inner })
    }

    /// The view's `NSView`, for scripts that message it directly.
    pub fn ns_view_object(&self) -> crate::DynObject {
        crate::DynObject::from_object(self.inner.nsview())
    }

    /// Whether the display timer runs; `None` restores the default (on).
    pub fn set_running(&self, running: Option<bool>) {
        self.inner.running.set(running.unwrap_or(DEFAULT_RUNNING));
        self.inner.sync_paused();
    }

    /// What the drawable is cleared to before each frame, sRGB components in
    /// 0–1; `None` is opaque black.
    pub fn set_clear_color(&self, color: Option<ClearColor>) {
        if let Some(view) = self.inner.mtk() {
            view.set_clear_color(color.unwrap_or(DEFAULT_CLEAR_COLOR));
        }
    }

    /// Frames per second the display timer aims for (clamped to 1–240);
    /// `None` is 60.
    pub fn set_preferred_fps(&self, value: Option<f64>) {
        if let Some(view) = self.inner.mtk() {
            view.set_preferred_frames_per_second(fps(value.unwrap_or(DEFAULT_PREFERRED_FPS)));
        }
    }

    /// Draws one frame now: the sink hears [`ViewSink::frame`] before this
    /// returns. Does nothing without a GPU. `InvalidState` from inside this
    /// view's own frame handler: a frame is one drawable, and it is in use.
    pub fn draw(&self) -> Result<()> {
        let _pool = AutoreleasePool::new();
        if self.inner.in_frame.get() {
            return Err(Error::InvalidState(
                "MetalView.draw() cannot run inside that view's onFrame; schedule it (setImmediate) instead",
            ));
        }
        if let Some(view) = self.inner.mtk() {
            // MTKView draws nothing while its drawable is 0 x 0, which it is
            // until the first layout pass; a window never shown has not had
            // one. It also swallows the first draw after its drawable was
            // resized, so one more is sent when the first did not reach the
            // delegate. And while its display timer runs, `draw` only
            // schedules the next timer frame instead of drawing now, so the
            // view is paused for the sends and the timer restored after.
            match view.window().and_then(|window| window.content_view()) {
                Some(root) => root.layout_subtree_if_needed(),
                None => view.layout_subtree_if_needed(),
            }
            view.set_paused(true);
            self.inner.drew.set(false);
            self.inner.drawing.set(true);
            view.draw();
            if !self.inner.drew.get() {
                view.draw();
            }
            self.inner.drawing.set(false);
            self.inner.sync_paused();
        }
        Ok(())
    }

    /// What the frame in progress renders into; only answers between
    /// [`begin_frame`](View::begin_frame) and [`end_frame`](View::end_frame)
    /// (`InvalidState` otherwise). `depth_format` attaches the view's depth
    /// texture of that format, allocating it on first use or when the format
    /// changes. `NoGpu` for a placeholder view, `NoDrawable` when the view
    /// has no size yet.
    pub fn render_target(&self, depth_format: Option<PixelFormat>) -> Result<MetalSurface> {
        let _pool = AutoreleasePool::new();
        self.inner.current_surface(depth_format)
    }

    /// The glue calls this before handing a frame to JavaScript and
    /// [`end_frame`](View::end_frame) after, marking the span in which
    /// [`render_target`](View::render_target) may fetch the drawable.
    pub fn begin_frame(&self) {
        self.inner.in_frame.set(true);
    }

    pub fn end_frame(&self) {
        self.inner.in_frame.set(false);
    }

    /// `(time, dt)` in seconds as of the latest frame: since the first
    /// frame, and since the previous one (0 for the first).
    pub fn frame_timing(&self) -> (f64, f64) {
        self.inner.timing.get()
    }

    /// The drawable's size in pixels; `None` without a GPU.
    pub fn drawable_size(&self) -> Option<Size> {
        self.inner.mtk().map(MTKView::drawable_size)
    }
}

impl Inner {
    /// The outer `NSView` JavaScript lays out.
    fn nsview(&self) -> &NSView {
        match &self.backing {
            Backing::Metal { view, .. } => view,
            Backing::Placeholder(view) => view,
        }
    }

    fn mtk(&self) -> Option<&MTKView> {
        match &self.backing {
            Backing::Metal { view, .. } => Some(view),
            Backing::Placeholder(_) => None,
        }
    }

    /// The display timer runs only while `running` and a display exists to
    /// pace it; off screen (sandbox, ssh) frames are drawn on request alone.
    fn sync_paused(&self) {
        if let Some(view) = self.mtk() {
            view.set_paused(!(self.running.get() && has_display()));
        }
    }

    fn current_surface(&self, depth_format: Option<PixelFormat>) -> Result<MetalSurface> {
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
        })
    }

    /// `drawInMTKView:`.
    fn frame(&self) {
        let _pool = AutoreleasePool::new();
        let now = Instant::now();
        let first = self.first_frame_at.get().unwrap_or(now);
        self.first_frame_at.set(Some(first));
        let dt = self
            .last_frame_at
            .get()
            .map_or(0.0, |last| now.duration_since(last).as_secs_f64());
        self.last_frame_at.set(Some(now));
        self.timing
            .set((now.duration_since(first).as_secs_f64(), dt));
        self.sink.frame();
    }
}

impl Drop for Inner {
    /// Clears the delegate that points at this before it goes away. The
    /// NSView stays wherever a script put it: being collected is not
    /// observable in the view hierarchy.
    fn drop(&mut self) {
        let _pool = AutoreleasePool::new();
        if let Some(view) = self.mtk() {
            view.set_paused(true);
            view.set_delegate(None);
        }
    }
}

fn fps(value: f64) -> isize {
    value.clamp(1.0, 240.0) as isize
}

/// The [`MetalViewEvents`] receiver behind the `MTKView` delegate.
struct Handler {
    inner: Weak<Inner>,
}

impl MetalViewEvents for Handler {
    fn draw(&self) {
        if let Some(inner) = self.inner.upgrade() {
            inner.drew.set(true);
            if inner.drawing.get() || inner.running.get() {
                inner.frame();
            }
        }
    }
    fn drawable_size_will_change(&self, size: Size) {
        if let Some(inner) = self.inner.upgrade() {
            inner.sink.drawable_resized(size);
        }
    }
}
