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

use crate::jsc_hooks::timer_all_opt;
use bun_jsc::virtual_machine::VirtualMachine;

// HOST_EXPORT(Bun__internal_ensureDateHeaderTimerIsEnabled, c)
pub fn ensure_date_header_timer_is_enabled(loop_: &bun_uws::Loop) {
    if VirtualMachine::get_or_null().is_none() {
        return;
    }
    if let Some(all) = timer_all_opt() {
        all.update_date_header_timer_if_necessary(loop_, VirtualMachine::get());
    }
}
