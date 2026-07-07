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
    let timer = unsafe { (*vm).timer };
    // SAFETY: `timer` is the live per-VM `All` heap (separate allocation from
    // the VM struct); single JS thread, raw-ptr-per-field re-entry pattern.
    unsafe {
        (*timer)
            .event_loop_delay
            .enable(&mut *vm, histogram, resolution_ms)
    };
}

#[unsafe(no_mangle)]
pub(super) extern "C" fn Timer_disableEventLoopDelayMonitoring(vm: *mut VirtualMachine) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let timer = unsafe { (*vm).timer };
    // SAFETY: see `Timer_enableEventLoopDelayMonitoring`.
    unsafe { (*timer).event_loop_delay.disable(&mut *vm) };
}
