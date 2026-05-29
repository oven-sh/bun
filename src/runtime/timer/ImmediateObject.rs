use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};

use super::{Kind, TimerObjectInternals};

super::impl_timer_object!(ImmediateObject, ImmediateObject, "Immediate");

impl ImmediateObject {
    pub fn init(
        global: &JSGlobalObject,
        id: i32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(global, id, Kind::SetImmediate, 0, callback, arguments)
    }

    /// Spec ImmediateObject.zig `runImmediateTask` — thin forwarder to
    /// `internals.run_immediate_task`. Reached from `bun_jsc::event_loop`
    /// via `__bun_run_immediate_task` (definer in [`crate::dispatch`]).
    ///
    /// Returns `true` if an exception was thrown.
    ///
    /// # Safety
    /// `this` was produced by `enqueue_immediate_task` from a live
    /// heap-allocated `ImmediateObject`; `vm` is the live per-thread VM.
    #[inline]
    pub unsafe fn run_immediate_task(this: *mut Self, vm: *mut VirtualMachine) -> bool {
        // SAFETY: per fn contract — `this` is live; `internals` is an embedded
        // field. Do NOT form `&mut *this` (the body may `deref()` and free).
        // `run_immediate_task` takes `*mut Self` (noalias re-entrancy).
        unsafe {
            TimerObjectInternals::run_immediate_task(core::ptr::addr_of_mut!((*this).internals), vm)
        }
    }

    /// # Safety
    /// `this` must be a live heap-allocated `ImmediateObject`.
    #[inline]
    pub unsafe fn cancel_pending(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: do not form `&mut *this` — the body derefs and may free `*this`.
        unsafe {
            TimerObjectInternals::cancel_pending_immediate(
                core::ptr::addr_of_mut!((*this).internals),
                vm,
            );
        }
    }
}

// ported from: src/runtime/timer/ImmediateObject.zig
