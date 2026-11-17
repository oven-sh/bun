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

use bun_jsc::virtual_machine::VirtualMachine;
use bun_uws::Loop;

use crate::jsc_hooks::timer_all;

// SAFETY (the proof): uSockets is adding a socket to `loop_`, on its thread, which may have no VM. Neither `init` nor
// teardown after `~VM` opens a socket. Only a timer is armed.
#[unsafe(no_mangle)]
extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: &bun_core::Loop<Loop>) {
    if let Some(vm) = VirtualMachine::get_or_null(loop_.as_loop()) {
        timer_all(vm).update_date_header_timer_if_necessary(loop_, vm);
    }
}
