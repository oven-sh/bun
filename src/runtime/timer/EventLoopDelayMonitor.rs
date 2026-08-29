use bun_jsc::JSValue;

use crate::jsc_hooks::timer_all;

// HOST_EXPORT(Timer_enableEventLoopDelayMonitoring, c)
pub fn enable_event_loop_delay_monitoring(
    vm: &bun_jsc::virtual_machine::VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) {
    let all = timer_all();
    all.event_loop_delay
        .enable(vm, all, histogram, resolution_ms);
}

// HOST_EXPORT(Timer_disableEventLoopDelayMonitoring, c)
pub fn disable_event_loop_delay_monitoring() {
    let all = timer_all();
    all.event_loop_delay.disable(all);
}
