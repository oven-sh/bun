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

#[unsafe(no_mangle)]
pub(super) extern "C" fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop_: *mut Loop) {
    if let Some(vm_ptr) = VirtualMachine::get_or_null() {
        // SAFETY: loop_ is a valid uws Loop pointer passed from C++ and lives
        // for the call duration.
        let loop_ref = unsafe { &*loop_ };
        // SAFETY: single JS thread; `timer_all()` returns the live per-thread
        // `All` (non-null after init). `update_date_header_timer_if_necessary`
        // takes the VM by raw pointer to avoid aliased-`&mut` (jsc/runtime crate cycle).
        unsafe { (*timer_all()).update_date_header_timer_if_necessary(loop_ref, vm_ptr) };
    }
}

// ported from: src/runtime/timer/DateHeaderTimer.zig
