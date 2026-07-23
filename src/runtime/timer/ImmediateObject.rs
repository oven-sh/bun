use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};

use super::{Kind, TimerObjectInternals};

/// Only the cached-property accessors — `callbackGetCached` / `callbackSetCached`
/// etc. per `values` entry in the `Immediate` `.classes.ts` define — are declared
/// here; the rest of the C++ JSCell wrapper is emitted by the `#[JsClass]` derive.
pub mod js {
    bun_jsc::codegen_cached_accessors!(
        "Immediate";
        arguments,
        callback,
    );
}

// `jsc.Codegen.JSImmediate` — the C++ JSCell wrapper stays generated; this
// struct is the `m_ctx` payload. Struct + `RefCounted`/`Default` impls + the
// forwarder host-fns (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/
// `get_destroyed`/`dispose`/`constructor`/`finalize`/`ref_`/`deref`/`deinit`/
// `init_with`) — see `impl_timer_object!` in `super` (timer/mod.rs).
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

    // Cached-property getter/setter — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Mirrors `Timeout::get_on_timeout`/`set_on_timeout` (see `TimeoutObject.rs`).

    pub fn get_on_immediate(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::callback_get_cached(this_value).unwrap()
    }

    pub fn set_on_immediate(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::callback_set_cached(this_value, global, value);
    }

    /// Thin forwarder to
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
