//! DateHeaderTimer manages the periodic updating of the "Date" header in Bun.serve().
//!
//! This timer ensures that HTTP responses include an up-to-date Date header by
//! updating the date every second when there are active connections.
//!
//! Behavior:
//! - When sweep_timer_count > 0 (active connections), the timer should be running
//! - When sweep_timer_count = 0 (no connections), the timer doesn't get rescheduled.
//! - If the timer was already running, no changes are made.
//! - If the timer was not running and needs to start:
//!   - If the last update was > 1 second ago, update the date immediately and schedule next update
//!   - If the last update was < 1 second ago, just schedule the next update
//!
//! Note that we only check for potential updates ot this timer once per event loop tick.

use bun_core::Timespec;
use bun_jsc::VirtualMachine;
use bun_jsc::api::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_uws::Loop;

bun_output::declare_scope!(DateHeaderTimer, visible);

const MS_PER_S: u64 = 1000;

pub struct DateHeaderTimer {
    pub event_loop_timer: EventLoopTimer,
}

impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EventLoopTimer {
                tag: EventLoopTimerTag::DateHeaderTimer,
                next: Timespec::EPOCH,
                ..Default::default()
            },
        }
    }
}

impl DateHeaderTimer {
    /// Schedule the "Date" header timer.
    ///
    /// The logic handles two scenarios:
    /// 1. If the timer was recently updated (< 1 second ago), just reschedule it
    /// 2. If the timer is stale (> 1 second since last update), update the date immediately and reschedule
    pub fn enable(&mut self, vm: &mut VirtualMachine, now: &Timespec) {
        debug_assert!(self.event_loop_timer.state != EventLoopTimerState::Active);

        let last_update = self.event_loop_timer.next;
        let elapsed = now.duration(&last_update).ms();

        // If the last update was more than 1 second ago, the date is stale
        // (Zig used `std.time.ms_per_s` as comptime_int — coerces to i64; use literal to avoid bare `as` narrowing)
        if elapsed >= 1000 {
            // Update the date immediately since it's stale
            bun_output::scoped_log!(
                DateHeaderTimer,
                "updating stale timer & rescheduling for 1 second later"
            );

            // update_date() is an expensive function.
            vm.uws_loop().update_date();

            vm.timer.update(&mut self.event_loop_timer, &now.add_ms(MS_PER_S));
        } else {
            // The date was updated recently, just reschedule for the next second
            bun_output::scoped_log!(DateHeaderTimer, "rescheduling timer");
            vm.timer.insert(&mut self.event_loop_timer);
        }
    }

    pub fn run(&mut self, vm: &mut VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::Fired;
        let loop_ = vm.uws_loop();
        // TODO(port): `.allow_mocked_time` is a Zig enum literal arg to timespec.now(); confirm Rust API shape
        let now = Timespec::now_allow_mocked_time();

        // Record when we last ran it.
        self.event_loop_timer.next = now;
        bun_output::scoped_log!(DateHeaderTimer, "run");

        // update_date() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count > 0 {
            // Reschedule it automatically for 1 second later.
            self.event_loop_timer.next = now.add_ms(MS_PER_S);
            vm.timer.insert(&mut self.event_loop_timer);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut Loop) {
    if let Some(vm) = VirtualMachine::get_or_null() {
        // SAFETY: loop_ is a valid uws Loop pointer passed from C++; lives for the call duration
        let loop_ref = unsafe { &mut *loop_ };
        vm.timer.update_date_header_timer_if_necessary(loop_ref, vm);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/DateHeaderTimer.zig (82 lines)
//   confidence: medium
//   todos:      1
//   notes:      EventLoopTimer/Timespec type paths are best-guess; vm.timer aliasing in extern fn may need reshaping
// ──────────────────────────────────────────────────────────────────────────
