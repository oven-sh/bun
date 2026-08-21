//! `NSWindow` with a delegate, typed setters, and a plain container view that
//! the content view is pinned into.

use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use crate::app::App;
use crate::color::Color;
use crate::error::{Error, Result};
use crate::geometry::{Point, Rect, Size};
use crate::objc::appkit::{
    BackingStoreType, LayoutAttribute as Attr, LayoutRelation as Rel, NSColor, NSLayoutConstraint,
    NSView, NSWindow, WindowTitleVisibility,
};
use crate::objc::foundation::NSString;
use crate::objc::{self, AutoreleasePool, Delegate, NsStr, WindowEvents};
use crate::view::{View, WeakView};

// NSWindowStyleMask
const TITLED: usize = 1;
const CLOSABLE: usize = 2;
const MINIATURIZABLE: usize = 4;
const RESIZABLE: usize = 8;
const FULL_SIZE_CONTENT_VIEW: usize = 1 << 15;
/// `NSWindowCollectionBehaviorFullScreenPrimary`.
const FULL_SCREEN_PRIMARY: usize = 1 << 7;
/// The content view's bottom pin: just under default-low hugging (250), so a
/// stack that hugs its content stays compact at the top while a scroll view or
/// `grow` child stretches to fill the window.
const CONTENT_BOTTOM_PRIORITY: f32 = 240.0;

/// Where a window reports what happened to it.
pub trait WindowSink {
    /// The close button (or `performClose:`) was used; return false to keep the window.
    fn should_close(&self) -> bool;
    fn closed(&self);
    /// New content size.
    fn resized(&self, size: Size);
    /// New frame origin in screen coordinates (bottom-left).
    fn moved(&self, origin: Point);
    fn focused(&self);
    fn blurred(&self);
}

/// Per-dimension content-size limits; `None` = no limit.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SizeLimits {
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub max_width: Option<f64>,
    pub max_height: Option<f64>,
}

impl SizeLimits {
    /// AppKit's own "no limit" values are 0 and FLT_MAX, so unset halves need no special casing.
    fn min_size(&self) -> Size {
        Size {
            width: self.min_width.unwrap_or(0.0),
            height: self.min_height.unwrap_or(0.0),
        }
    }

    fn max_size(&self) -> Size {
        Size {
            width: self.max_width.unwrap_or(f64::MAX),
            height: self.max_height.unwrap_or(f64::MAX),
        }
    }
}

/// How to create a [`Window`]. Sizes are content sizes.
#[derive(Clone, Debug)]
pub struct WindowOptions {
    pub title: Option<String>,
    pub width: f64,
    pub height: f64,
    /// Frame origin in screen coordinates; `None` centres.
    pub origin: Option<Point>,
    pub limits: SizeLimits,
    /// 0.0–1.0.
    pub alpha: f64,
    pub resizable: bool,
    pub closable: bool,
    pub minimizable: bool,
    pub full_size_content: bool,
    pub titlebar_transparent: bool,
    pub title_hidden: bool,
    pub background: Option<Color>,
    /// `setFrameAutosaveName:`; the saved frame wins over size and position.
    pub restore_name: Option<String>,
}

impl Default for WindowOptions {
    fn default() -> WindowOptions {
        WindowOptions {
            title: None,
            width: 480.0,
            height: 320.0,
            origin: None,
            limits: SizeLimits::default(),
            alpha: 1.0,
            resizable: true,
            closable: true,
            minimizable: true,
            full_size_content: false,
            titlebar_transparent: false,
            title_hidden: false,
            background: None,
            restore_name: None,
        }
    }
}

struct Shared {
    ns: NSWindow,
    app: &'static App,
    sink: Box<dyn WindowSink>,
    /// Pinned to all edges of AppKit's contentView; content goes in here.
    container: NSView,
    child: RefCell<Option<WeakView>>,
    limits: Cell<SizeLimits>,
    closed: Cell<bool>,
    shown_once: Cell<bool>,
}

impl Shared {
    fn content_size(&self) -> Size {
        self.ns.content_rect_for_frame_rect(self.ns.frame()).size
    }

    /// Bookkeeping for a close, whichever path noticed it first.
    fn finish_close(&self) {
        if self.closed.replace(true) {
            return;
        }
        if let Some(view) = self.child.borrow_mut().take().and_then(|w| w.upgrade()) {
            view.detach_from_parent();
        }
        // A closed NSWindow lives until its wrapper is collected; free the name for the next one now.
        self.ns.set_frame_autosave_name(&nsstring(""));
        self.sink.closed();
    }
}

struct Events {
    shared: Weak<Shared>,
}

impl Events {
    fn with<R>(&self, f: impl FnOnce(&Shared) -> R) -> Option<R> {
        self.shared.upgrade().map(|s| f(&s))
    }
}

impl WindowEvents for Events {
    fn should_close(&self) -> bool {
        self.with(|s| s.sink.should_close()).unwrap_or(true)
    }
    fn will_close(&self) {
        self.with(Shared::finish_close);
    }
    fn did_resize(&self) {
        self.with(|s| s.sink.resized(s.content_size()));
    }
    fn did_move(&self) {
        self.with(|s| s.sink.moved(s.ns.frame().origin));
    }
    fn did_become_key(&self) {
        self.with(|s| s.sink.focused());
    }
    fn did_resign_key(&self) {
        self.with(|s| s.sink.blurred());
    }
}

/// A top-level window.
pub struct Window {
    shared: Rc<Shared>,
    _delegate: Delegate<dyn WindowEvents>,
}

fn constraint(child: &NSView, attr: Attr, parent: &NSView) -> NSLayoutConstraint {
    NSLayoutConstraint::with_items(child, attr, Rel::Equal, Some(parent), attr, 1.0, 0.0)
}

fn pin_edges(parent: &NSView, child: &NSView) {
    child.set_translates_autoresizing_mask(false);
    for attr in [Attr::Leading, Attr::Trailing, Attr::Top, Attr::Bottom] {
        constraint(child, attr, parent).set_active(true);
    }
}

fn nsstring(s: &str) -> NSString {
    NSString::from_str(NsStr::Utf8(s))
}

impl Window {
    /// Creates a hidden window. Call [`Window::show`] to put it on screen.
    pub fn new(
        app: &'static App,
        opts: &WindowOptions,
        sink: Box<dyn WindowSink>,
    ) -> Result<Window> {
        let _pool = AutoreleasePool::new();

        let mut mask = TITLED;
        if opts.closable {
            mask |= CLOSABLE;
        }
        if opts.minimizable {
            mask |= MINIATURIZABLE;
        }
        if opts.resizable {
            mask |= RESIZABLE;
        }
        if opts.full_size_content {
            mask |= FULL_SIZE_CONTENT_VIEW;
        }
        let rect = Rect {
            origin: opts.origin.unwrap_or_default(),
            size: Size {
                width: opts.width,
                height: opts.height,
            },
        };
        let allocated = if app.has_display() {
            objc::alloc::<NSWindow>()
        } else {
            objc::alloc_subclass(objc::delegate::unconstrained_window_class())
        };
        let ns = NSWindow::init_with_content_rect(
            allocated,
            rect,
            mask,
            BackingStoreType::Buffered,
            false,
        );
        // The default (YES) would release the window under our own reference on close.
        ns.set_released_when_closed(false);

        if let Some(title) = &opts.title {
            ns.set_title(&nsstring(title));
        }
        ns.set_content_min_size(opts.limits.min_size());
        ns.set_content_max_size(opts.limits.max_size());
        if opts.titlebar_transparent {
            ns.set_titlebar_appears_transparent(true);
        }
        if opts.alpha < 1.0 {
            ns.set_alpha_value(opts.alpha.clamp(0.0, 1.0));
        }
        if opts.title_hidden {
            ns.set_title_visibility(WindowTitleVisibility::Hidden);
        }
        if opts.resizable {
            ns.set_collection_behavior(FULL_SCREEN_PRIMARY);
        }
        if let Some(color) = &opts.background {
            ns.set_background_color(Some(&color.to_nscolor()));
        }

        let content_view = ns.content_view().expect("NSWindow contentView");
        let container = NSView::init_with_frame(objc::alloc::<NSView>(), Rect::default());
        content_view.add_subview(&container);
        pin_edges(&content_view, &container);

        if opts.origin.is_none() {
            ns.center();
        }
        if let Some(name) = &opts.restore_name
            && !ns.set_frame_autosave_name(&nsstring(name))
        {
            return Err(Error::RestoreNameInUse(name.clone()));
        }

        let shared = Rc::new(Shared {
            ns,
            app,
            sink,
            container,
            child: RefCell::new(None),
            limits: Cell::new(opts.limits),
            closed: Cell::new(false),
            shown_once: Cell::new(false),
        });
        let delegate = Delegate::window(Box::new(Events {
            shared: Rc::downgrade(&shared),
        }));
        shared.ns.set_delegate(Some(delegate.as_nsobject()));
        Ok(Window {
            shared,
            _delegate: delegate,
        })
    }

    /// The NSWindow, unless it has closed. Every mutating or ordering call goes through here.
    fn live(&self) -> Result<&NSWindow> {
        if self.shared.closed.get() {
            Err(Error::WindowClosed)
        } else {
            Ok(&self.shared.ns)
        }
    }

    pub fn set_title(&self, title: NsStr<'_>) -> Result<()> {
        let ns = self.live()?;
        let _pool = AutoreleasePool::new();
        ns.set_title(&NSString::from_str(title));
        Ok(())
    }

    pub fn title(&self) -> Vec<u16> {
        let _pool = AutoreleasePool::new();
        self.shared.ns.title().to_utf16()
    }

    pub fn content_size(&self) -> Size {
        self.shared.content_size()
    }

    pub fn set_content_size(&self, size: Size) -> Result<()> {
        self.live()?.set_content_size(size);
        Ok(())
    }

    /// Frame origin in screen coordinates (bottom-left, as AppKit has it).
    pub fn position(&self) -> Point {
        self.shared.ns.frame().origin
    }

    pub fn set_position(&self, origin: Point) -> Result<()> {
        self.live()?.set_frame_origin(origin);
        Ok(())
    }

    pub fn limits(&self) -> SizeLimits {
        self.shared.limits.get()
    }

    pub fn set_limits(&self, limits: SizeLimits) -> Result<()> {
        let ns = self.live()?;
        ns.set_content_min_size(limits.min_size());
        ns.set_content_max_size(limits.max_size());
        self.shared.limits.set(limits);
        Ok(())
    }

    pub fn is_visible(&self) -> bool {
        !self.shared.closed.get() && self.shared.ns.is_visible()
    }

    pub fn is_key(&self) -> bool {
        !self.shared.closed.get() && self.shared.ns.is_key_window()
    }

    pub fn is_closed(&self) -> bool {
        self.shared.closed.get()
    }

    /// Orders the window front and makes it key; the first call also
    /// activates the application so the window really comes forward.
    pub fn show(&self) -> Result<()> {
        self.live()?.make_key_and_order_front(None);
        if !self.shared.shown_once.replace(true) {
            self.shared.app.activate();
        }
        Ok(())
    }

    pub fn hide(&self) -> Result<()> {
        self.live()?.order_out(None);
        Ok(())
    }

    /// Brings the window forward and makes it key, activating the app.
    pub fn focus(&self) -> Result<()> {
        let ns = self.live()?;
        self.shared.app.activate();
        ns.make_key_and_order_front(None);
        Ok(())
    }

    pub fn center(&self) -> Result<()> {
        self.live()?.center();
        Ok(())
    }

    /// Idempotent. The sink's `closed` runs once, from whichever of this or
    /// the delegate's `windowWillClose:` gets there first.
    pub fn close(&self) {
        if self.shared.closed.get() {
            return;
        }
        // Hold our own reference: `sink.closed()` may drop the owner of `self`.
        let shared = Rc::clone(&self.shared);
        shared.ns.close();
        shared.finish_close();
    }

    /// `None` restores the standard window background.
    pub fn set_background(&self, color: Option<&Color>) -> Result<()> {
        let ns = self.live()?;
        let _pool = AutoreleasePool::new();
        let color = match color {
            Some(c) => c.to_nscolor(),
            None => NSColor::window_background_color(),
        };
        ns.set_background_color(Some(&color));
        Ok(())
    }

    /// Clamped to 0.0–1.0.
    pub fn set_alpha(&self, alpha: f64) -> Result<()> {
        self.live()?.set_alpha_value(alpha.clamp(0.0, 1.0));
        Ok(())
    }

    /// Replaces the single content view. The child is pinned leading, trailing
    /// and top at required priority and bottom at [`CONTENT_BOTTOM_PRIORITY`].
    pub fn set_content(&self, child: Option<&View>) -> Result<()> {
        self.live()?;
        let _pool = AutoreleasePool::new();
        if child.is_some_and(View::has_parent) {
            return Err(Error::ChildHasParent);
        }
        let mut slot = self.shared.child.borrow_mut();
        if let Some(old) = slot.take().and_then(|w| w.upgrade()) {
            old.detach_from_parent();
        }
        if let Some(child) = child {
            let view = child.nsview();
            let container = &self.shared.container;
            container.add_subview(&view);
            view.set_translates_autoresizing_mask(false);
            for attr in [Attr::Leading, Attr::Trailing, Attr::Top] {
                constraint(&view, attr, container).set_active(true);
            }
            let bottom = constraint(&view, Attr::Bottom, container);
            bottom.set_priority(CONTENT_BOTTOM_PRIORITY);
            bottom.set_active(true);
            child.set_has_parent(true);
            *slot = Some(child.downgrade());
        }
        Ok(())
    }

    /// PNG of the content area as currently laid out; `None` if it has no size yet.
    pub fn snapshot_png(&self) -> Option<Vec<u8>> {
        let _pool = AutoreleasePool::new();
        self.shared.ns.layout_if_needed();
        crate::view::snapshot_png(&self.shared.container)
    }
}

impl Drop for Window {
    fn drop(&mut self) {
        self.shared.ns.set_delegate(None);
        if !self.shared.closed.get() {
            self.shared.ns.close();
            self.shared.finish_close();
        }
    }
}
