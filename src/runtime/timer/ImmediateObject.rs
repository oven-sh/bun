use core::cell::Cell;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_ptr::{JsCell, RefPtr, ThisPtr};

use super::{EventLoopTimer, IdMap, Kind, Maps, TimerObject, TimerObjectInternals};

// `jsc.Codegen.JSImmediate` — the C++ JSCell wrapper stays generated; this
// struct is the `m_ctx` payload. Struct + `RefCounted`/`Drop` impls + the
// forwarder host-fns (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/
// `get_destroyed`/`dispose`/`constructor`/`finalize`/`init_with`) — see
// `impl_timer_object!` in `super` (timer/mod.rs).
super::impl_timer_object!(ImmediateObject, ImmediateObject, "Immediate");

impl TimerObject for ImmediateObject {
    #[inline]
    fn internals(&self) -> &TimerObjectInternals {
        &self.internals
    }
    #[inline]
    fn event_loop_timer(&self) -> &JsCell<EventLoopTimer> {
        &self.event_loop_timer
    }
    #[inline]
    fn heap_ref(&self) -> &Cell<Option<RefPtr<Self>>> {
        &self.heap_ref
    }
    #[inline]
    fn id_map(maps: &mut Maps, _kind: Kind) -> &mut IdMap<Self> {
        &mut maps.set_immediate
    }
}

impl ImmediateObject {
    pub(crate) fn init(
        global: &JSGlobalObject,
        id: i32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(global, id, Kind::SetImmediate, 0, callback, arguments)
    }

    /// Reached from `bun_jsc::event_loop` via `__bun_run_immediate_task`
    /// (definer in [`crate::dispatch`]). Returns `true` if an exception was
    /// thrown. `this` carries the immediate queue's ref; it may be gone once
    /// this returns.
    #[inline]
    pub(crate) fn run_immediate_task(this: ThisPtr<Self>, vm: &VirtualMachine) -> bool {
        TimerObject::run_immediate_task(this, vm)
    }

    /// Release the immediate queue's ref without running the callback (VM
    /// teardown). `this` may be gone once this returns.
    #[inline]
    pub(crate) fn cancel_pending(this: ThisPtr<Self>, _vm: &VirtualMachine) {
        TimerObject::cancel_pending_immediate(this);
    }
}
