use std::rc::Rc;

use crate::node::histogram::Interval;

pub(crate) fn enable(interval: &Rc<Interval>) {
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`; single
    // JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe { (*state).timer.event_loop_delay.enable(interval) };
}

pub(crate) fn disable(interval: &Rc<Interval>) {
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: see `enable`.
    unsafe { (*state).timer.event_loop_delay.disable(interval) };
}
