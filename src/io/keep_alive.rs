//! Single cross-platform `KeepAlive`.
//!
//! The few methods that diverge per platform keep their behaviour via
//! `#[cfg]` arms inline below — no caller-visible contract changes (all
//! external users go through `bun_io::KeepAlive` and only touch the
//! identical-signature methods).

use crate::EventLoopCtx;
use crate::posix_event_loop::js_vm_ctx;
#[cfg(not(windows))]
use bun_uws_sys::Loop;

/// Track if an object whose file descriptor is being watched should keep the
/// event loop alive. This is not reference counted — only Active / Inactive.
pub struct KeepAlive {
    status: Status,
    /// The loop `ref_()` counted this on, null while inactive. The ctx passed
    /// to `unref()` names whichever loop is current at that moment, which
    /// during `Bun.spawnSync` is its private loop; the ref has to come off the
    /// loop it was put on (see `FilePoll::counted_loop`).
    #[cfg(not(windows))]
    loop_: *mut Loop,
}

impl Default for KeepAlive {
    fn default() -> Self {
        Self {
            status: Status::default(),
            #[cfg(not(windows))]
            loop_: core::ptr::null_mut(),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum Status {
    Active,
    #[default]
    Inactive,
    Done,
}

impl KeepAlive {
    #[inline]
    pub fn is_active(&self) -> bool {
        self.status == Status::Active
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(&mut self) {
        self.unref(js_vm_ctx());
        self.status = Status::Done;
    }

    pub fn init() -> KeepAlive {
        KeepAlive::default()
    }

    /// The loop `ref_()` used, handed back exactly once per activation.
    #[cfg(not(windows))]
    fn take_refd_loop(&mut self) -> &'static mut Loop {
        let loop_ = core::mem::replace(&mut self.loop_, core::ptr::null_mut());
        debug_assert!(!loop_.is_null(), "KeepAlive active without a loop");
        // SAFETY: set from a live loop in `ref_()` when `status` became
        // `Active`; both the thread's loop and spawnSync's private loop (owned
        // by the VM's RareData) outlive everything ref'd on them. Single
        // event-loop thread, and the callers consume the borrow with one
        // counter adjustment before anything else can reach the loop.
        unsafe { &mut *loop_ }
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        #[cfg(not(windows))]
        {
            let _ = event_loop_ctx;
            self.take_refd_loop().unref();
        }
        #[cfg(windows)]
        event_loop_ctx.loop_sub_active(1);
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        #[cfg(not(windows))]
        {
            let loop_ = self.take_refd_loop();
            // The pending counter is drained by the thread's own loop when it
            // next ticks; a ref that sits on any other loop (spawnSync's
            // private one) has no next tick to wait for.
            if core::ptr::eq(loop_, Loop::get()) {
                event_loop_ctx.increment_pending_unref_counter();
            } else {
                loop_.unref();
            }
        }
        #[cfg(windows)]
        event_loop_ctx.loop_dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        #[cfg(not(windows))]
        {
            self.loop_ = event_loop_ctx.loop_();
        }
        event_loop_ctx.loop_ref();
    }

    /// Allow a poll to keep the process alive.
    ///
    /// Raw-identifier alias of [`KeepAlive::ref_`]. Callers use both
    /// spellings; this keeps them source-compatible.
    #[inline]
    pub fn r#ref(&mut self, event_loop_ctx: EventLoopCtx) {
        self.ref_(event_loop_ctx)
    }
}
