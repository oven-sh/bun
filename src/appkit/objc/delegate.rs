//! Objective-C classes defined at run time so AppKit has something to call:
//! the application delegate, a window delegate, a control target that is also
//! a text-field / text-view / table delegate and data source, a flipped
//! `NSClipView`, an `NSWindow` whose frame is never constrained to a screen
//! (headless), and an `MTKViewDelegate`. Delegate instances carry one `owner`
//! ivar pointing at a reference-counted Rust trait object; the `extern "C"`
//! IMPs below do nothing but forward.

use core::ptr;
use std::sync::OnceLock;

use super::appkit::{
    NSClipView, NSMenuItem, NSTableColumn, NSTableView, NSUndoManager, NSView, NSWindow,
};
use super::{
    Bool, ClassBuilder, Delegate, DelegateClass, Obj, Sel, Subclass, This, sel, with_borrowed,
};
use crate::geometry::{Rect, Size};
use crate::objc::foundation::NSObject;

/// What the application delegate reports. All methods run on the main thread
/// inside AppKit event dispatch.
pub(crate) trait AppEvents {
    /// `applicationShouldTerminate:`: true lets AppKit terminate (it then
    /// sends `applicationWillTerminate:` and exits), false cancels.
    fn terminate_requested(&self) -> bool;
    /// `applicationWillTerminate:`: the last callout before AppKit's `exit`.
    fn will_terminate(&self);
    fn did_finish_launching(&self);
    /// `applicationShouldHandleReopen:hasVisibleWindows:` — the Dock icon was clicked while running.
    fn reopened(&self, has_visible_windows: bool);
    /// A menu item built with a callback id was chosen.
    fn menu_item(&self, id: u32);
}

pub(crate) trait WindowEvents {
    fn should_close(&self) -> bool;
    fn will_close(&self);
    fn did_resize(&self);
    fn did_move(&self);
    fn did_become_key(&self);
    fn did_resign_key(&self);
}

/// Target/action plus the delegate and data-source callbacks any control kind
/// might need. The single implementor (`view::Handler`) forwards each to the
/// kind-polymorphic widget.
pub(crate) trait ControlEvents {
    fn action(&self);
    fn double_action(&self);
    /// `controlTextDidChange:` (fields) and `textDidChange:` (text views) both.
    fn text_did_change(&self);
    fn text_did_begin_editing(&self);
    fn text_did_end_editing(&self);
    /// `undoManagerForTextView:`. `None` means the window's shared one.
    fn undo_manager(&self) -> Option<NSUndoManager>;
    fn number_of_rows(&self) -> usize;
    fn view_for_row(
        &self,
        table: &NSTableView,
        column: Option<&NSTableColumn>,
        row: usize,
    ) -> Option<NSView>;
    fn selection_did_change(&self);
}

/// `MTKViewDelegate`. Both run on the main thread: from the view's display
/// timer inside AppKit event dispatch, or synchronously from `-[MTKView draw]`.
pub(crate) trait MetalViewEvents {
    /// `drawInMTKView:`.
    fn draw(&self);
    /// `mtkView:drawableSizeWillChange:`, in pixels.
    fn drawable_size_will_change(&self, size: Size);
}

// SAFETY (every `.method(...)` below): each IMP's signature transcribes the
// named protocol's (or overridden superclass's) declaration of that selector,
// which debug builds assert; `onAction:`, `onDoubleAction:` and `onMenuItem:`
// are target/action selectors of our own, always called as `v@:@`.

fn app_class() -> &'static DelegateClass<dyn AppEvents> {
    static CLASS: OnceLock<DelegateClass<dyn AppEvents>> = OnceLock::new();
    // SAFETY: see above.
    CLASS.get_or_init(|| unsafe {
        ClassBuilder::<NSObject>::new(c"BunAppKitAppDelegate")
            .owned::<dyn AppEvents>()
            .protocol(c"NSApplicationDelegate")
            .method(
                sel!("applicationShouldTerminate:"),
                app_should_terminate as extern "C" fn(App, Sel, Obj) -> usize,
            )
            .method(
                sel!("applicationWillTerminate:"),
                app_will_terminate as extern "C" fn(App, Sel, Obj),
            )
            .method(
                sel!("applicationShouldTerminateAfterLastWindowClosed:"),
                app_no as extern "C" fn(App, Sel, Obj) -> Bool,
            )
            .method(
                sel!("applicationDidFinishLaunching:"),
                app_did_finish_launching as extern "C" fn(App, Sel, Obj),
            )
            .method(
                sel!("applicationShouldHandleReopen:hasVisibleWindows:"),
                app_reopen as extern "C" fn(App, Sel, Obj, Bool) -> Bool,
            )
            .method(
                sel!("applicationSupportsSecureRestorableState:"),
                app_yes as extern "C" fn(App, Sel, Obj) -> Bool,
            )
            .method(
                sel!("onMenuItem:"),
                app_menu_item as extern "C" fn(App, Sel, Obj),
            )
            .register()
    })
}

fn window_class() -> &'static DelegateClass<dyn WindowEvents> {
    static CLASS: OnceLock<DelegateClass<dyn WindowEvents>> = OnceLock::new();
    // SAFETY: see above.
    CLASS.get_or_init(|| unsafe {
        ClassBuilder::<NSObject>::new(c"BunAppKitWindowDelegate")
            .owned::<dyn WindowEvents>()
            .protocol(c"NSWindowDelegate")
            .method(
                sel!("windowShouldClose:"),
                win_should_close as extern "C" fn(Win, Sel, Obj) -> Bool,
            )
            .method(
                sel!("windowWillClose:"),
                win_will_close as extern "C" fn(Win, Sel, Obj),
            )
            .method(
                sel!("windowDidResize:"),
                win_did_resize as extern "C" fn(Win, Sel, Obj),
            )
            .method(
                sel!("windowDidMove:"),
                win_did_move as extern "C" fn(Win, Sel, Obj),
            )
            .method(
                sel!("windowDidBecomeKey:"),
                win_did_become_key as extern "C" fn(Win, Sel, Obj),
            )
            .method(
                sel!("windowDidResignKey:"),
                win_did_resign_key as extern "C" fn(Win, Sel, Obj),
            )
            .register()
    })
}

fn control_class() -> &'static DelegateClass<dyn ControlEvents> {
    static CLASS: OnceLock<DelegateClass<dyn ControlEvents>> = OnceLock::new();
    // SAFETY: see above.
    CLASS.get_or_init(|| unsafe {
        ClassBuilder::<NSObject>::new(c"BunAppKitTarget")
            .owned::<dyn ControlEvents>()
            .protocol(c"NSTextFieldDelegate")
            .protocol(c"NSTextViewDelegate")
            .protocol(c"NSTableViewDataSource")
            .protocol(c"NSTableViewDelegate")
            .method(
                sel!("onAction:"),
                ctl_action as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("onDoubleAction:"),
                ctl_double_action as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("controlTextDidChange:"),
                ctl_text_did_change as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("controlTextDidBeginEditing:"),
                ctl_text_did_begin as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("controlTextDidEndEditing:"),
                ctl_text_did_end as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("textDidChange:"),
                ctl_text_did_change as extern "C" fn(Ctl, Sel, Obj),
            )
            .method(
                sel!("undoManagerForTextView:"),
                ctl_undo_manager as extern "C" fn(Ctl, Sel, Obj) -> Obj,
            )
            .method(
                sel!("numberOfRowsInTableView:"),
                ctl_number_of_rows as extern "C" fn(Ctl, Sel, Obj) -> isize,
            )
            .method(
                sel!("tableView:viewForTableColumn:row:"),
                ctl_view_for_row as extern "C" fn(Ctl, Sel, Obj, Obj, isize) -> Obj,
            )
            .method(
                sel!("tableViewSelectionDidChange:"),
                ctl_selection_did_change as extern "C" fn(Ctl, Sel, Obj),
            )
            .register()
    })
}

fn metal_view_class() -> &'static DelegateClass<dyn MetalViewEvents> {
    static CLASS: OnceLock<DelegateClass<dyn MetalViewEvents>> = OnceLock::new();
    // SAFETY: see above; `MTKViewDelegate` (MTKView.h) declares
    // `drawInMTKView:(MTKView *)` and `mtkView:(MTKView *) drawableSizeWillChange:(CGSize)`.
    CLASS.get_or_init(|| unsafe {
        ClassBuilder::<NSObject>::new(c"BunAppKitMetalDelegate")
            .owned::<dyn MetalViewEvents>()
            .protocol(c"MTKViewDelegate")
            .method(
                sel!("drawInMTKView:"),
                mtk_draw as extern "C" fn(Mtk, Sel, Obj),
            )
            .method(
                sel!("mtkView:drawableSizeWillChange:"),
                mtk_drawable_size_will_change as extern "C" fn(Mtk, Sel, Obj, Size),
            )
            .register()
    })
}

/// The `NSClipView` subclass whose `isFlipped` is YES, so a scroll view's
/// document starts at the top.
pub(crate) fn flipped_clip_view_class() -> Subclass<NSClipView> {
    static CLASS: OnceLock<Subclass<NSClipView>> = OnceLock::new();
    *CLASS.get_or_init(|| {
        let class = ClassBuilder::<NSClipView>::new(c"BunAppKitFlippedClipView");
        // SAFETY: see above; overrides `-[NSView isFlipped]` (`BOOL`, no arguments).
        unsafe { class.method(sel!("isFlipped"), yes0 as extern "C" fn(Obj, Sel) -> Bool) }
            .register()
    })
}

/// The `NSWindow` subclass whose `constrainFrameRect:toScreen:` is the
/// identity. With no screen attached (sandbox, daemon) the inherited one clamps
/// the window to a zero-height "screen" on first order-in, so windows created
/// there use this class instead.
pub(crate) fn unconstrained_window_class() -> Subclass<NSWindow> {
    static CLASS: OnceLock<Subclass<NSWindow>> = OnceLock::new();
    *CLASS.get_or_init(|| {
        let class = ClassBuilder::<NSWindow>::new(c"BunAppKitHeadlessWindow");
        // SAFETY: see above; overrides `-[NSWindow constrainFrameRect:(NSRect) toScreen:(NSScreen *)]`.
        let class = unsafe {
            class.method(
                sel!("constrainFrameRect:toScreen:"),
                win_identity_frame as extern "C" fn(Obj, Sel, Rect, Obj) -> Rect,
            )
        };
        class.register()
    })
}

/// Registers every class this file defines, so the check of each IMP
/// against its protocol or superclass declaration runs now.
pub(super) fn register_all() {
    app_class();
    window_class();
    control_class();
    metal_view_class();
    flipped_clip_view_class();
    unconstrained_window_class();
}

impl Delegate<dyn AppEvents> {
    pub(crate) fn app(handler: Box<dyn AppEvents>) -> Self {
        Delegate::new(app_class(), handler)
    }
}

impl Delegate<dyn WindowEvents> {
    pub(crate) fn window(handler: Box<dyn WindowEvents>) -> Self {
        Delegate::new(window_class(), handler)
    }
}

impl Delegate<dyn ControlEvents> {
    pub(crate) fn control(handler: Box<dyn ControlEvents>) -> Self {
        Delegate::new(control_class(), handler)
    }
}

impl Delegate<dyn MetalViewEvents> {
    pub(crate) fn metal_view(handler: Box<dyn MetalViewEvents>) -> Self {
        Delegate::new(metal_view_class(), handler)
    }
}

type App = This<dyn AppEvents>;
type Win = This<dyn WindowEvents>;
type Ctl = This<dyn ControlEvents>;
type Mtk = This<dyn MetalViewEvents>;

// SAFETY (app/win/ctl/mtk): each `*_class()` above is the only
// `DelegateClass` for its handler, so a `This<H>` can only have come from an
// IMP registered on it. AppKit calls on the main thread; `dispatch` handles a
// cleared owner.

fn app<R>(this: App, f: impl FnOnce(&(dyn AppEvents + 'static)) -> R) -> Option<R> {
    // SAFETY: see above.
    unsafe { app_class().dispatch(this, f) }
}
fn win<R>(this: Win, f: impl FnOnce(&(dyn WindowEvents + 'static)) -> R) -> Option<R> {
    // SAFETY: see above.
    unsafe { window_class().dispatch(this, f) }
}
fn ctl<R>(this: Ctl, f: impl FnOnce(&(dyn ControlEvents + 'static)) -> R) -> Option<R> {
    // SAFETY: see above.
    unsafe { control_class().dispatch(this, f) }
}
fn mtk<R>(this: Mtk, f: impl FnOnce(&(dyn MetalViewEvents + 'static)) -> R) -> Option<R> {
    // SAFETY: see above.
    unsafe { metal_view_class().dispatch(this, f) }
}

extern "C" fn app_should_terminate(this: App, _: Sel, _sender: Obj) -> usize {
    // NSTerminateNow / NSTerminateCancel
    usize::from(app(this, |h| h.terminate_requested()).unwrap_or(false))
}
extern "C" fn app_will_terminate(this: App, _: Sel, _note: Obj) {
    let _ = app(this, |h| h.will_terminate());
}
extern "C" fn app_no(_: App, _: Sel, _: Obj) -> Bool {
    Bool::NO
}
extern "C" fn app_yes(_: App, _: Sel, _: Obj) -> Bool {
    Bool::YES
}
extern "C" fn yes0(_: Obj, _: Sel) -> Bool {
    Bool::YES
}
extern "C" fn win_identity_frame(_: Obj, _: Sel, frame: Rect, _screen: Obj) -> Rect {
    frame
}
extern "C" fn app_did_finish_launching(this: App, _: Sel, _note: Obj) {
    let _ = app(this, |h| h.did_finish_launching());
}
extern "C" fn app_reopen(this: App, _: Sel, _sender: Obj, visible: Bool) -> Bool {
    let _ = app(this, |h| h.reopened(visible.get()));
    Bool::YES
}
extern "C" fn app_menu_item(this: App, _: Sel, sender: Obj) {
    // SAFETY: `sender` is the argument AppKit passed to this IMP.
    let id = unsafe {
        with_borrowed::<NSMenuItem, _>(sender, |item| {
            item.and_then(|i| u32::try_from(i.tag()).ok())
        })
    };
    let Some(id) = id else {
        return;
    };
    let _ = app(this, |h| h.menu_item(id));
}

extern "C" fn win_should_close(this: Win, _: Sel, _: Obj) -> Bool {
    Bool::new(win(this, |h| h.should_close()).unwrap_or(true))
}
extern "C" fn win_will_close(this: Win, _: Sel, _: Obj) {
    let _ = win(this, |h| h.will_close());
}
extern "C" fn win_did_resize(this: Win, _: Sel, _: Obj) {
    let _ = win(this, |h| h.did_resize());
}
extern "C" fn win_did_move(this: Win, _: Sel, _: Obj) {
    let _ = win(this, |h| h.did_move());
}
extern "C" fn win_did_become_key(this: Win, _: Sel, _: Obj) {
    let _ = win(this, |h| h.did_become_key());
}
extern "C" fn win_did_resign_key(this: Win, _: Sel, _: Obj) {
    let _ = win(this, |h| h.did_resign_key());
}

extern "C" fn ctl_action(this: Ctl, _: Sel, _sender: Obj) {
    let _ = ctl(this, |h| h.action());
}
extern "C" fn ctl_double_action(this: Ctl, _: Sel, _sender: Obj) {
    let _ = ctl(this, |h| h.double_action());
}
extern "C" fn ctl_text_did_change(this: Ctl, _: Sel, _note: Obj) {
    let _ = ctl(this, |h| h.text_did_change());
}
extern "C" fn ctl_text_did_begin(this: Ctl, _: Sel, _note: Obj) {
    let _ = ctl(this, |h| h.text_did_begin_editing());
}
extern "C" fn ctl_text_did_end(this: Ctl, _: Sel, _note: Obj) {
    let _ = ctl(this, |h| h.text_did_end_editing());
}
extern "C" fn ctl_undo_manager(this: Ctl, _: Sel, _text_view: Obj) -> Obj {
    ctl(this, |h| h.undo_manager())
        .flatten()
        .map_or(ptr::null_mut(), |undo| undo.autorelease_return())
}
extern "C" fn ctl_number_of_rows(this: Ctl, _: Sel, _table: Obj) -> isize {
    ctl(this, |h| h.number_of_rows()).unwrap_or(0) as isize
}
extern "C" fn ctl_view_for_row(this: Ctl, _: Sel, table: Obj, column: Obj, row: isize) -> Obj {
    if row < 0 {
        return ptr::null_mut();
    }
    // SAFETY: `table` and `column` are the arguments AppKit passed to this IMP.
    let view = unsafe {
        with_borrowed::<NSTableView, _>(table, |table| {
            let table = table?;
            with_borrowed::<NSTableColumn, _>(column, |column| {
                ctl(this, |h| h.view_for_row(table, column, row as usize)).flatten()
            })
        })
    };
    // The table retains the returned view; hand it back autoreleased so our
    // wrapper's reference is balanced.
    view.map_or(ptr::null_mut(), |v| v.autorelease_return())
}
extern "C" fn ctl_selection_did_change(this: Ctl, _: Sel, _note: Obj) {
    let _ = ctl(this, |h| h.selection_did_change());
}

extern "C" fn mtk_draw(this: Mtk, _: Sel, _view: Obj) {
    let _ = mtk(this, |h| h.draw());
}
extern "C" fn mtk_drawable_size_will_change(this: Mtk, _: Sel, _view: Obj, size: Size) {
    let _ = mtk(this, |h| h.drawable_size_will_change(size));
}
