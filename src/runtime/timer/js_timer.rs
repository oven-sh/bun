//! What `Timeout` and `Immediate` share.

use bun_jsc::Debugger::{self, AsyncCallType::DOMTimer};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsThread, ScriptExecutionStatus, ScriptTimer};

use crate::jsc_hooks::timer_all_of;

unsafe extern "C" {
    /// Whether the callback threw. `thrown` receives the exception; without it, it is reported as uncaught.
    safe fn Bun__JSTimeout__call(
        global: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        thrown: Option<&mut JSValue>,
    ) -> bool;
}

#[derive(Copy, Clone)]
pub(super) enum WaitsIn {
    Heap,
    ImmediateQueue,
}

/// Keeps the event loop alive until dropped.
pub(super) struct LoopHold(WaitsIn);

impl LoopHold {
    /// For the heap, after the insert: on Windows that creates the handle to ref.
    #[inline]
    pub(super) fn new(vm: &VirtualMachine, waits_in: WaitsIn) -> Self {
        Self::count(vm, waits_in, 1);
        Self(waits_in)
    }

    #[inline]
    fn count(vm: &VirtualMachine, waits_in: WaitsIn, delta: i32) {
        let timers = timer_all_of(vm);
        match waits_in {
            WaitsIn::Heap => timers.increment_timer_ref(delta, vm.uws_loop()),
            WaitsIn::ImmediateQueue => timers.increment_immediate_ref(delta, vm.uws_loop()),
        }
    }
}

impl Drop for LoopHold {
    #[inline]
    fn drop(&mut self) {
        Self::count(VirtualMachine::get(), self.0, -1);
    }
}

#[inline]
pub(super) fn may_run(timer: &ScriptTimer, vm: &VirtualMachine) -> bool {
    vm.script_execution_status() == ScriptExecutionStatus::Running
        && !timer.has_outlived_its_script(vm)
}

#[inline]
pub(super) fn did_schedule(cx: &JsThread<'_>, id: u64, single_shot: bool) {
    if cx.vm().is_inspector_enabled() {
        Debugger::did_schedule_async_call(cx.global(), DOMTimer, id, single_shot);
    }
}

pub(super) fn did_cancel(vm: &VirtualMachine, id: u64) {
    if vm.is_inspector_enabled() {
        Debugger::did_cancel_async_call(vm.global(), DOMTimer, id);
    }
}

/// See [`Bun__JSTimeout__call`].
#[inline]
pub(super) fn call(
    vm: &VirtualMachine,
    id: u64,
    this: JSValue,
    callback: JSValue,
    arguments: JSValue,
    thrown: Option<&mut JSValue>,
) -> bool {
    let global = vm.global();
    if vm.is_inspector_enabled() {
        Debugger::will_dispatch_async_call(global, DOMTimer, id);
    }
    let threw = Bun__JSTimeout__call(global, this, callback, arguments, thrown);
    if vm.is_inspector_enabled() {
        Debugger::did_dispatch_async_call(global, DOMTimer, id);
    }
    threw
}

/// What `callback` threw, or empty.
pub(crate) fn call_catching(
    global: &JSGlobalObject,
    callback: JSValue,
    arguments: JSValue,
) -> JSValue {
    let mut thrown = JSValue::ZERO;
    Bun__JSTimeout__call(
        global,
        JSValue::UNDEFINED,
        callback,
        arguments,
        Some(&mut thrown),
    );
    thrown
}
