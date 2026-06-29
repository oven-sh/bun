//! Single cross-platform `KeepAlive`.
//!
//! The few methods that diverge per platform keep their behaviour via
//! `#[cfg]` arms inline below — no caller-visible contract changes (all
//! external users go through `bun_io::KeepAlive` and only touch the
//! identical-signature methods).

use crate::EventLoopCtx;
use crate::posix_event_loop::js_vm_ctx;

/// Track if an object whose file descriptor is being watched should keep the
/// event loop alive. This is not reference counted — only Active / Inactive.
#[derive(Default)]
pub struct KeepAlive {
    status: Status,
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

    /// Only intended to be used from EventLoop.Pollable
    #[cfg(not(windows))]
    pub fn deactivate(&mut self, loop_: &mut crate::Loop) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        loop_.sub_active(1);
    }
    /// Only intended to be used from EventLoop.Pollable
    #[cfg(windows)]
    pub fn deactivate(&mut self, loop_: &mut crate::Loop) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        loop_.dec();
    }

    /// Only intended to be used from EventLoop.Pollable
    #[cfg(not(windows))]
    pub fn activate(&mut self, loop_: &mut crate::Loop) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        loop_.add_active(1);
    }
    /// Only intended to be used from EventLoop.Pollable
    #[cfg(windows)]
    pub fn activate(&mut self, loop_: &mut crate::Loop) {
        // The Windows arm guards on `!= Active` (vs posix `!= Inactive`);
        // preserved verbatim.
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Active;
        loop_.inc();
    }

    pub fn init() -> KeepAlive {
        KeepAlive::default()
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        #[cfg(not(windows))]
        event_loop_ctx.loop_unref();
        #[cfg(windows)]
        event_loop_ctx.loop_sub_active(1);
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unref_concurrently(&mut self, vm: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        vm.unref_concurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        // vm.pending_unref_counter +|= 1;
        #[cfg(not(windows))]
        event_loop_ctx.increment_pending_unref_counter();
        #[cfg(windows)]
        event_loop_ctx.loop_dec();
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick_concurrently(&mut self, vm: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        // Cross-thread increment: the counter is an `AtomicI32` RMW'd with
        // `Ordering::Relaxed` (see
        // `jsc::VirtualMachine::pending_unref_counter`).
        #[cfg(not(windows))]
        vm.increment_pending_unref_counter();
        // TODO: https://github.com/oven-sh/bun/pull/4410#discussion_r1317326194
        #[cfg(windows)]
        vm.loop_dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
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

    /// Allow a poll to keep the process alive.
    pub fn ref_concurrently(&mut self, vm: EventLoopCtx) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        vm.ref_concurrently();
    }

    pub fn ref_concurrently_from_event_loop(&mut self, loop_: EventLoopCtx) {
        self.ref_concurrently(loop_);
    }

    pub fn unref_concurrently_from_event_loop(&mut self, loop_: EventLoopCtx) {
        self.unref_concurrently(loop_);
    }
}
