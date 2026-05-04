use bun_core::Timespec;
use bun_jsc::{JSValue, VirtualMachine};

use crate::timer::EventLoopTimer;

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

impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            js_histogram: JSValue::ZERO,
            event_loop_timer: EventLoopTimer {
                next: Timespec::EPOCH,
                tag: EventLoopTimerTag::EventLoopDelayMonitor,
                ..Default::default()
            },
            resolution_ms: 10,
            last_fire_ns: 0,
            enabled: false,
        }
    }
}

impl EventLoopDelayMonitor {
    pub fn enable(&mut self, vm: &mut VirtualMachine, histogram: JSValue, resolution_ms: i32) {
        if self.enabled {
            return;
        }
        self.js_histogram = histogram;
        self.resolution_ms = resolution_ms;

        self.enabled = true;

        // Schedule timer
        let now = Timespec::now(TimespecClock::ForceRealTime);
        self.event_loop_timer.next = now.add_ms(u64::try_from(resolution_ms).unwrap());
        vm.timer.insert(&mut self.event_loop_timer);
    }

    pub fn disable(&mut self, vm: &mut VirtualMachine) {
        if !self.enabled {
            return;
        }

        self.enabled = false;
        self.js_histogram = JSValue::ZERO;
        self.last_fire_ns = 0;
        vm.timer.remove(&mut self.event_loop_timer);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.js_histogram.is_empty()
    }

    pub fn on_fire(&mut self, vm: &mut VirtualMachine, now: &Timespec) {
        if !self.enabled || self.js_histogram.is_empty() {
            return;
        }

        let now_ns = now.ns();
        if self.last_fire_ns > 0 {
            let expected_ns = u64::try_from(self.resolution_ms).unwrap().saturating_mul(1_000_000);
            let actual_ns = now_ns - self.last_fire_ns;

            if actual_ns > expected_ns {
                let delay_ns = i64::try_from(actual_ns.saturating_sub(expected_ns)).unwrap();
                // SAFETY: js_histogram is a live JSValue rooted by the JS closure scope (see field doc).
                unsafe {
                    JSNodePerformanceHooksHistogram_recordDelay(self.js_histogram, delay_ns);
                }
            }
        }

        self.last_fire_ns = now_ns;

        // Reschedule
        self.event_loop_timer.next = now.add_ms(u64::try_from(self.resolution_ms).unwrap());
        vm.timer.insert(&mut self.event_loop_timer);
    }
}

// Record delay to histogram
// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn JSNodePerformanceHooksHistogram_recordDelay(histogram: JSValue, delay_ns: i64);
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
    vm.timer.event_loop_delay.enable(vm, histogram, resolution_ms);
}

#[unsafe(no_mangle)]
pub extern "C" fn Timer_disableEventLoopDelayMonitoring(vm: *mut VirtualMachine) {
    // SAFETY: vm is a valid non-null pointer passed from C++.
    let vm = unsafe { &mut *vm };
    vm.timer.event_loop_delay.disable(vm);
}

// TODO(port): `EventLoopTimerTag` / `TimespecClock` enum paths are guessed; fix imports in Phase B.
use crate::timer::EventLoopTimerTag;
use bun_core::TimespecClock;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/EventLoopDelayMonitor.zig (83 lines)
//   confidence: medium
//   todos:      3
//   notes:      exported C fns borrow vm twice (event_loop_delay is a field of vm.timer) — Phase B may need to reshape for borrowck; bare JSValue field intentionally kept (rooted by JS closure).
// ──────────────────────────────────────────────────────────────────────────
