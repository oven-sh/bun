//! Single cross-platform `KeepAlive`.
//!
//! The few methods that diverge per platform keep their behaviour via
//! `#[cfg]` arms inline below — no caller-visible contract changes (all
//! external users go through `bun_io::KeepAlive` and only touch the
//! identical-signature methods).

use core::cell::Cell;

use crate::EventLoopCtx;
use crate::posix_event_loop::js_vm_ctx;

/// Track if an object whose file descriptor is being watched should keep the
/// event loop alive. This is not reference counted — only Active / Inactive.
#[derive(Default)]
pub struct KeepAlive {
    status: Cell<Status>,
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
        self.status.get() == Status::Active
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(&self) {
        self.unref(js_vm_ctx());
        self.status.set(Status::Done);
    }

    pub fn init() -> KeepAlive {
        KeepAlive::default()
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&self, event_loop_ctx: EventLoopCtx) {
        if self.status.get() != Status::Active {
            return;
        }
        self.status.set(Status::Inactive);
        #[cfg(not(windows))]
        event_loop_ctx.loop_unref();
        #[cfg(windows)]
        event_loop_ctx.loop_sub_active(1);
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&self, event_loop_ctx: EventLoopCtx) {
        if self.status.get() != Status::Active {
            return;
        }
        self.status.set(Status::Inactive);
        // vm.pending_unref_counter +|= 1;
        #[cfg(not(windows))]
        event_loop_ctx.increment_pending_unref_counter();
        #[cfg(windows)]
        event_loop_ctx.loop_dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&self, event_loop_ctx: EventLoopCtx) {
        if self.status.get() != Status::Inactive {
            return;
        }
        self.status.set(Status::Active);
        event_loop_ctx.loop_ref();
    }

    /// Allow a poll to keep the process alive.
    ///
    /// Raw-identifier alias of [`KeepAlive::ref_`]. Callers use both
    /// spellings; this keeps them source-compatible.
    #[inline]
    pub fn r#ref(&self, event_loop_ctx: EventLoopCtx) {
        self.ref_(event_loop_ctx)
    }
}

/// A [`KeepAlive`] on the JS thread's loop, released when it drops.
#[derive(Default)]
pub struct JsKeepAlive(KeepAlive);

impl JsKeepAlive {
    pub fn active() -> Self {
        let this = Self::default();
        this.ref_(js_vm_ctx());
        this
    }
}

impl core::ops::Deref for JsKeepAlive {
    type Target = KeepAlive;
    fn deref(&self) -> &KeepAlive {
        &self.0
    }
}

impl Drop for JsKeepAlive {
    fn drop(&mut self) {
        // An inactive one can drop on any thread.
        if self.is_active() {
            self.unref(js_vm_ctx());
        }
    }
}
