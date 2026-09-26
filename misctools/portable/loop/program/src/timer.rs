//! A timer.
//!
//! bun's timers are timers of libuv on Windows (`bun_uws_sys::Timer`). Everywhere else bun keeps its
//! timers itself and gives the loop the time until the next one as the longest it may wait
//! (`Loop::tick_with_timeout`): no timer of the OS is involved.

use bun_core::Timespec;

use crate::Loop;
use crate::json::Report;

const MILLISECONDS: i64 = 30;

pub(crate) fn step(report: &mut Report, event_loop: &Loop) -> bool {
    let started = Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
    let fired = wait(event_loop, started);
    let elapsed = Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns() - started.ns();
    let not_early = elapsed >= (MILLISECONDS as u64) * 1_000_000;
    report.begin("timer");
    report.number("fired", fired);
    report.boolean("not_early", not_early);
    report.end_ok();
    fired == 1 && not_early
}

#[cfg(windows)]
fn wait(event_loop: &Loop, _started: Timespec) -> i64 {
    use bun_sys::windows::libuv as uv;
    use bun_sys::windows::libuv::UvHandle as _;
    use core::cell::Cell;

    unsafe extern "C" fn on_timer(timer: *mut uv::Timer) {
        // SAFETY: `data` is the counter of `wait`, which outlives the timer's start.
        let fired = unsafe { &*(*timer).data.cast::<Cell<i64>>() };
        fired.set(fired.get() + 1);
    }
    unsafe extern "C" fn on_closed(timer: *mut uv::Timer) {
        // SAFETY: the timer was a `Box` until `wait` gave it to the loop.
        drop(unsafe { Box::from_raw(timer) });
    }

    let fired = Cell::new(0i64);
    let timer: *mut uv::Timer = Box::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Timer>()));
    // SAFETY: `timer` is a `uv_timer_t` that lives until libuv has closed it.
    unsafe {
        (*timer).init(uv::Loop::get());
        (*timer).data = (&raw const fired).cast_mut().cast();
        (*timer).start(MILLISECONDS as u64, 0, Some(on_timer));
    }
    event_loop.run_until(|| fired.get() > 0);
    // SAFETY: as above. The loop frees the timer when it has closed it.
    unsafe {
        (*timer).stop();
        (*timer).data = core::ptr::null_mut();
        (*timer).close(on_closed);
    }
    let _ = event_loop.uws();
    fired.get()
}

#[cfg(not(windows))]
fn wait(event_loop: &Loop, started: Timespec) -> i64 {
    let deadline = started.ns() + (MILLISECONDS as u64) * 1_000_000;
    let mut fired = 0;
    loop {
        let now = Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns();
        if now >= deadline {
            fired += 1;
            return fired;
        }
        let remaining = deadline - now;
        let timeout = Timespec {
            sec: (remaining / 1_000_000_000) as i64,
            nsec: (remaining % 1_000_000_000) as i64,
        };
        // SAFETY: the loop of this thread, and nothing here holds a reference into it over the call.
        unsafe { (*event_loop.uws()).tick_with_timeout(Some(&timeout), now) };
    }
}
