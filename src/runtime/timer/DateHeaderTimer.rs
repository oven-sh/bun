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
use bun_jsc::virtual_machine::VirtualMachine;
use bun_uws::Loop;

use crate::jsc_hooks::timer_all;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(DateHeaderTimer, visible);

const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;

pub struct DateHeaderTimer {
    pub event_loop_timer: EventLoopTimer,
}

bun_event_loop::impl_timer_owner!(DateHeaderTimer; from_timer_ptr => event_loop_timer);

impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DateHeaderTimer),
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
        debug_assert!(self.event_loop_timer.state != EventLoopTimerState::ACTIVE);

        // PORT NOTE: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub
        // (same {sec,nsec} layout) until bun_event_loop switches to bun_core::Timespec.
        let last_update = Timespec {
            sec: self.event_loop_timer.next.sec,
            nsec: self.event_loop_timer.next.nsec,
        };
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
            vm.uws_loop_mut().update_date();

            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: single JS thread; `All::update` only touches `lock`/`timers`/
            // `fake_timers`, disjoint from `date_header_timer` which `self` aliases.
            unsafe { (*timer_all()).update(elt, &now.add_ms(MS_PER_S)) };
        } else {
            // The date was updated recently, just reschedule for the next second
            bun_output::scoped_log!(DateHeaderTimer, "rescheduling timer");
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: see above — disjoint-field access on `All`.
            unsafe { (*timer_all()).insert(elt) };
        }
    }

    pub fn run(&mut self, vm: &mut VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        let loop_ = vm.uws_loop_mut();
        let now = Timespec::now_allow_mocked_time();

        // Record when we last ran it.
        self.event_loop_timer.next = ElTimespec {
            sec: now.sec,
            nsec: now.nsec,
        };
        bun_output::scoped_log!(DateHeaderTimer, "run");

        // update_date() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count > 0 {
            // Reschedule it automatically for 1 second later.
            let next = now.add_ms(MS_PER_S);
            self.event_loop_timer.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
            // `fake_timers`, disjoint from `date_header_timer` which `self` aliases.
            unsafe { (*timer_all()).insert(elt) };
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut Loop) {
    if let Some(vm_ptr) = VirtualMachine::get_or_null() {
        // SAFETY: loop_ is a valid uws Loop pointer passed from C++ and lives
        // for the call duration.
        let loop_ref = unsafe { &*loop_ };
        // SAFETY: single JS thread; `timer_all()` returns the live per-thread
        // `All` (non-null after init). `update_date_header_timer_if_necessary`
        // takes the VM by raw pointer to avoid aliased-`&mut` (b2-cycle).
        unsafe { (*timer_all()).update_date_header_timer_if_necessary(loop_ref, vm_ptr) };
    }
}

// ported from: src/runtime/timer/DateHeaderTimer.zig
