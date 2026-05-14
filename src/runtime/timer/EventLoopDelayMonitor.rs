use bun_core::Timespec;
use bun_jsc::JSValue;
use bun_jsc::virtual_machine::VirtualMachine;

use crate::timer::{ElTimespec, EventLoopTimer};

pub struct EventLoopDelayMonitor {
    /// We currently only globally share the same instance, which is kept alive by
    /// the existence of the src/js/internal/perf_hooks/monitorEventLoopDelay.ts
    /// function's scope.
    ///
    /// I don't think having a single event loop delay monitor histogram instance
    /// /will cause any issues? Let's find out.
    // TODO(port): bare JSValue heap field — kept alive by JS-side closure scope per the
    // comment above; revisit whether this should be a Strong/JsRef in Phase B.
    js_histogram: JSValue,

    event_loop_timer: EventLoopTimer,
    resolution_ms: i32,
    last_fire_ns: u64,
    enabled: bool,
}

bun_event_loop::impl_timer_owner!(EventLoopDelayMonitor; from_timer_ptr => event_loop_timer);

impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            js_histogram: JSValue::ZERO,
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
            resolution_ms: 10,
            last_fire_ns: 0,
            enabled: false,
        }
    }
}

use crate::jsc_hooks::timer_all;

impl EventLoopDelayMonitor {
    pub fn enable(&mut self, _vm: &mut VirtualMachine, histogram: JSValue, resolution_ms: i32) {
        if self.enabled {
            return;
        }
        self.js_histogram = histogram;
        self.resolution_ms = resolution_ms;

        self.enabled = true;

        // Schedule timer
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let next = now.add_ms(i64::from(resolution_ms));
        // PORT NOTE: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub
        // (same {sec,nsec} layout) until bun_event_loop switches to bun_core::Timespec.
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
        // `fake_timers`, disjoint from `event_loop_delay` which `self` may alias.
        unsafe { (*timer_all()).insert(elt) };
    }

    pub fn disable(&mut self, _vm: &mut VirtualMachine) {
        if !self.enabled {
            return;
        }

        self.enabled = false;
        self.js_histogram = JSValue::ZERO;
        self.last_fire_ns = 0;
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*timer_all()).remove(elt) };
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.js_histogram.is_empty()
    }

    pub fn on_fire(&mut self, _vm: &mut VirtualMachine, now: &Timespec) {
        if !self.enabled || self.js_histogram.is_empty() {
            return;
        }

        let now_ns = now.ns();
        if self.last_fire_ns > 0 {
            let expected_ns = u64::try_from(self.resolution_ms)
                .expect("int cast")
                .saturating_mul(1_000_000);
            let actual_ns = now_ns - self.last_fire_ns;

            if actual_ns > expected_ns {
                let delay_ns =
                    i64::try_from(actual_ns.saturating_sub(expected_ns)).expect("int cast");
                JSNodePerformanceHooksHistogram_recordDelay(self.js_histogram, delay_ns);
            }
        }

        self.last_fire_ns = now_ns;

        // Reschedule
        let next = now.add_ms(i64::from(self.resolution_ms));
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*timer_all()).insert(elt) };
    }
}

// Record delay to histogram
// TODO(port): move to runtime_sys
unsafe extern "C" {
    safe fn JSNodePerformanceHooksHistogram_recordDelay(histogram: JSValue, delay_ns: i64);
}

// Export functions for C++
#[unsafe(no_mangle)]
pub extern "C" fn Timer_enableEventLoopDelayMonitoring(
    vm: *mut VirtualMachine,
    histogram: JSValue,
    resolution_ms: i32,
) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    // PORT NOTE (b2-cycle): `vm.timer` is `()` — recover `All` via runtime_state().
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
pub extern "C" fn Timer_disableEventLoopDelayMonitoring(vm: *mut VirtualMachine) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    let state = crate::jsc_hooks::runtime_state();
    // SAFETY: see `Timer_enableEventLoopDelayMonitoring`.
    unsafe { (*state).timer.event_loop_delay.disable(vm) };
}

use crate::timer::EventLoopTimerTag;
use bun_core::TimespecMockMode;

// ported from: src/runtime/timer/EventLoopDelayMonitor.zig
