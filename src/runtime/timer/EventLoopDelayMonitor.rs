use bun_jsc::JSValue;
use bun_jsc::virtual_machine::VirtualMachine;

// Export functions for C++. The monitor lives in `runtime_state().timer`, not
// on the VM, so the VM pointer C++ passes is not dereferenced.
#[unsafe(no_mangle)]
extern "C" fn Timer_enableEventLoopDelayMonitoring(
    _vm: *mut VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) {
    // `vm.timer` is `()` (jsc/runtime crate cycle) — recover `All` via runtime_state().
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`; single
    // JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe {
        (*state)
            .timer
            .event_loop_delay
            .enable(histogram, resolution_ms)
    };
}

#[unsafe(no_mangle)]
extern "C" fn Timer_disableEventLoopDelayMonitoring(_vm: *mut VirtualMachine) {
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: see `Timer_enableEventLoopDelayMonitoring`.
    unsafe { (*state).timer.event_loop_delay.disable() };
}
