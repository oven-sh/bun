//! A bug in the engine takes down what it has computed, then the page, and not the process.

#[cfg(unix)]
use core::ffi::c_void;

use crate::boxes::{Boxes, VIEWPORT};
use crate::document::Document;
use crate::tree::DOCUMENT;

#[cfg(unix)]
unsafe extern "C" {
    fn Bun__DesktopRecovery__run(
        run: unsafe extern "C" fn(*mut c_void),
        context: *mut c_void,
    ) -> bool;
    safe fn Bun__DesktopRecovery__isRunning() -> bool;
    fn Bun__DesktopRecovery__abandon() -> !;
}

#[cfg(unix)]
pub(crate) fn install() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let outer = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !Bun__DesktopRecovery__isRunning() {
                return outer(info);
            }
            bun_core::pretty_errorln!(
                "<red>error<r>: the layout engine has panicked: {}",
                info.payload_as_str().unwrap_or_default()
            );
            bun_core::output::flush();
            std::rt::panic_count::decrease();
            // SAFETY: `attempt` is on this thread's stack. The frames above it are Rust's, and leaking is all that
            // skipping them does to what `start_over` keeps using.
            unsafe { Bun__DesktopRecovery__abandon() }
        }));
    });
}

/// `None` if it panics.
#[cfg(unix)]
#[inline]
pub(crate) fn attempt<F: FnOnce() -> R, R>(run: F) -> Option<R> {
    unsafe extern "C" fn call<F: FnOnce() -> R, R>(context: *mut c_void) {
        // SAFETY: what `attempt` passes, which nothing else refers to.
        let (run, result) = unsafe { &mut *context.cast::<(Option<F>, Option<R>)>() };
        *result = run.take().map(|run| run());
    }
    let mut context = (Some(run), None);
    // SAFETY: `context` outlives the call and has the type that `call` expects.
    unsafe { Bun__DesktopRecovery__run(call::<F, R>, (&raw mut context).cast()) };
    context.1
}

#[cfg(not(unix))]
pub(crate) fn install() {}

#[cfg(not(unix))]
pub(crate) fn attempt<R>(run: impl FnOnce() -> R) -> Option<R> {
    Some(run())
}

/// For what recurses as deep as the tree is. A script may have left little.
#[inline]
pub(crate) fn need_stack() {
    assert!(
        bun_core::StackCheck::init().is_safe_to_recurse(),
        "out of stack"
    );
}

impl Document {
    /// Forgets all that follows from the tree and the style sheets. It may be in a state that cannot be dropped.
    pub(crate) fn start_over(&mut self) {
        let _ = core::mem::ManuallyDrop::new(core::mem::replace(
            &mut self.boxes,
            Boxes::new(&self.styles.initial),
        ));
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.pictures));
        let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut self.shaped));
        self.tree.forget_boxes();
        self.tree[DOCUMENT].layout_box = VIEWPORT;
        for boxes in [
            &mut self.doomed,
            &mut self.moved_boxes_in_scrollers,
            &mut self.changed_scrollbars,
        ] {
            boxes.clear();
        }
        self.ordinals.clear();
        self.anchor_index = None;
        self.queries = Default::default();
        self.animations.watched.clear();
        self.measuring = 0;
        (self.is_burying, self.left_behind) = (false, None);
        self.is_measuring_stroke.set(false);
        self.is_measuring_text.set(false);
        self.svg_size_in_layout.set(None);
        self.svg_ids = Default::default();
        self.referenced_svgs.undo_leak();
        self.paths = Default::default();
        self.requests.undo_leak();
        self.images.undo_leak();
        self.styles.start_over();
        self.marks.are_stale = true;
        (self.counters_are_stale, self.needs_layout, self.needs_frame) = (true, true, true);
        self.recascade_everything();
        self.mark_rebuild(DOCUMENT);
    }
}
