use bun_jsc::JSValue;
use bun_jsc::virtual_machine::VirtualMachine;

// Export functions for C++
#[unsafe(no_mangle)]
pub(super) extern "C" fn Timer_enableEventLoopDelayMonitoring(
    vm: *mut VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    // `vm.timer` is `()` (jsc/runtime crate cycle) — recover `All` via runtime_state().
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`; single
    // JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe {
        (*state)
            .timer
            .event_loop_delay
            .enable(vm, histogram, resolution_ms)
    };
}

#[unsafe(no_mangle)]
pub(super) extern "C" fn Timer_disableEventLoopDelayMonitoring(vm: *mut VirtualMachine) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: see `Timer_enableEventLoopDelayMonitoring`.
    unsafe { (*state).timer.event_loop_delay.disable(vm) };
}
