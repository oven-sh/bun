use bun_jsc::JSValue;
use bun_jsc::virtual_machine::VirtualMachine;

// Export functions for C++. Both return whether the state changed.
#[unsafe(no_mangle)]
extern "C" fn Timer_enableEventLoopDelayMonitoring(
    vm: *mut VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) -> bool {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    // `vm.timer` is `()` (jsc/runtime crate cycle) — recover `All` via runtime_state().
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`; single
    // JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe {
        let monitor = &mut (*state).timer.event_loop_delay;
        if monitor.enabled {
            return false;
        }
        monitor.enable(vm, histogram, resolution_ms);
    }
    true
}

#[unsafe(no_mangle)]
extern "C" fn Timer_disableEventLoopDelayMonitoring() -> bool {
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: see `Timer_enableEventLoopDelayMonitoring`.
    unsafe {
        let monitor = &mut (*state).timer.event_loop_delay;
        let was_enabled = monitor.enabled;
        monitor.disable();
        was_enabled
    }
}
