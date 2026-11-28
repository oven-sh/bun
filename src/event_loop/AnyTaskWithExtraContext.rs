//! Type-erased task carrying two context pointers.
//! Generally, prefer jsc.Task instead of this.

use core::ptr::NonNull;

pub struct AnyTaskWithExtraContext {
    pub(crate) ctx: Option<NonNull<()>>,
    pub(crate) callback: fn(*mut (), *mut ()),
    /// Intrusive link for `UnboundedQueue(AnyTaskWithExtraContext, .next)` (MiniEventLoop).
    pub(crate) next: bun_threading::Link<AnyTaskWithExtraContext>,
}

impl Default for AnyTaskWithExtraContext {
    fn default() -> Self {
        Self {
            ctx: None,
            callback: |_, _| unreachable!("callback was undefined"),
            next: bun_threading::Link::new(),
        }
    }
}

/// A type that is queued on a `MiniEventLoop` as a `Box`.
pub trait MiniTask: 'static {
    /// On the thread of the loop that it was posted to.
    fn run_from_main_thread(self: Box<Self>);
}
