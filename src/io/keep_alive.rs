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
    /// `ref_` counted on `Bun.spawnSync`'s isolated loop, not the thread's loop.
    spawn_sync_loop: bool,
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

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        #[cfg(not(windows))]
        event_loop_ctx.loop_unref_for(self.spawn_sync_loop);
        #[cfg(windows)]
        event_loop_ctx.loop_sub_active(1);
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        debug_assert!(
            !self.spawn_sync_loop,
            "deferred unref of a spawnSync loop ref"
        );
        self.status = Status::Inactive;
        // vm.pending_unref_counter +|= 1;
        #[cfg(not(windows))]
        event_loop_ctx.increment_pending_unref_counter();
        #[cfg(windows)]
        event_loop_ctx.loop_dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        self.spawn_sync_loop = event_loop_ctx.is_spawn_sync_loop();
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
