//! Single cross-platform `KeepAlive`.
//!
//! The few methods that diverge per platform keep their behaviour via
//! `#[cfg]` arms inline below — no caller-visible contract changes (all
//! external users go through `bun_io::KeepAlive` and only touch the
//! identical-signature methods).

use core::ptr::NonNull;

use crate::EventLoopCtx;
use crate::posix_event_loop::js_vm_ctx;

/// Track if an object whose file descriptor is being watched should keep the
/// event loop alive. This is not reference counted — only Active / Inactive.
///
/// `ref_` records the loop it counted on and `unref` releases on that loop,
/// not on the loop the ctx resolves to at release time. The two differ while
/// `Bun.spawnSync` has its private loop installed as `vm.event_loop_handle`:
/// a GC sweep inside that call can finalize an owner whose keep-alive was
/// taken on the main loop.
#[derive(Default)]
pub struct KeepAlive {
    status: Status,
    /// The loop `ref_` counted on. `None` unless `status == Active`.
    loop_: Option<NonNull<bun_uws_sys::Loop>>,
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

    /// The loop `ref_` counted on, or the ctx's loop if `ref_` did not record
    /// one. Clears the record.
    #[inline]
    fn take_counted_loop(
        &mut self,
        event_loop_ctx: EventLoopCtx,
    ) -> &'static mut bun_uws_sys::Loop {
        let loop_ = self
            .loop_
            .take()
            .map_or(event_loop_ctx.loop_(), NonNull::as_ptr);
        // SAFETY: `ref_` stored the live per-thread loop it counted on; loops
        // outlive every keep-alive taken on them, and this runs on that loop's
        // thread (the ctx is that thread's). Leaf op, like
        // `EventLoopCtx::loop_mut`: the borrow is consumed before returning to
        // the caller's other loop accesses.
        unsafe { &mut *loop_ }
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        let loop_ = self.take_counted_loop(event_loop_ctx);
        #[cfg(not(windows))]
        loop_.unref();
        #[cfg(windows)]
        loop_.sub_active(1);
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unref_on_next_tick(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Active {
            return;
        }
        self.status = Status::Inactive;
        // vm.pending_unref_counter +|= 1;
        #[cfg(not(windows))]
        {
            self.loop_ = None;
            event_loop_ctx.increment_pending_unref_counter();
        }
        #[cfg(windows)]
        self.take_counted_loop(event_loop_ctx).dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.status != Status::Inactive {
            return;
        }
        self.status = Status::Active;
        self.loop_ = NonNull::new(event_loop_ctx.loop_());
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
