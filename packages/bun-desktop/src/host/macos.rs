use std::cell::Cell;
use std::time::Duration;

pub use super::unix::wake;
use super::{thread, unix};
use crate::diagnostics::trace;
use crate::platform::Platform;
use crate::{bridge, input, window};

pub const IS_REENTRANT: bool = true;
pub const RUNS_ON_ANY_THREAD: bool = false;

unsafe extern "C" {
    safe fn bd_loop_init();
    safe fn bd_loop_wake();
    safe fn bd_loop_observe(wake: i32);
    safe fn bd_loop_arm(source: i32, seconds: f64);
    safe fn bd_loop_run();
    safe fn bd_loop_run_once(seconds: f64);
    safe fn bd_loop_pump(may_block: bool);
    safe fn bd_loop_is_in_next_event() -> bool;
    safe fn bd_loop_post_empty_event();
}

thread_local! {
    static IS_RUNNING: Cell<bool> = const { Cell::new(false) };
    static SOURCE_WAS_READY: Cell<bool> = const { Cell::new(false) };
    static IS_READY: Cell<bool> = const { Cell::new(false) };
}

pub fn wake_ui() {
    bd_loop_wake();
}

pub fn init() {
    unix::WAKE.open();
    bd_loop_init();
}

/// From whichever loop AppKit runs, once it has the thread to itself.
fn turn() {
    if IS_RUNNING.get() {
        super::turn();
        window::layers::flush();
        arm(None, super::time_until_next_turn());
    }
}

/// Runs JavaScript from a loop that `wait` has no control of.
fn tick() {
    if !bd_loop_is_in_next_event()
        && super::CAN_TICK.get()
        && (IS_READY.take() || bridge::has_events())
    {
        super::tick();
        // It was armed before the callbacks ran, which may have set timers.
        if SOURCE_WAS_READY.take() {
            arm(None, Some(Duration::ZERO));
        }
    }
    window::layers::flush();
}

/// An observer or a timer is not called again before it returns, so what may run a loop of its own is left to the source.
fn before_waiting() {
    let is_due = if thread::exists() {
        input::flush_raw_key();
        let timeout = super::time_until_next_turn().filter(|_| IS_RUNNING.get());
        arm(None, timeout);
        timeout == Some(Duration::ZERO)
    } else if bd_loop_is_in_next_event() {
        if IS_READY.get() || super::has_work() {
            return bd_loop_post_empty_event();
        }
        false
    } else {
        super::CAN_TICK.get() && (IS_READY.get() || bridge::has_events())
    };
    match is_due {
        true => bd_loop_wake(),
        false => window::layers::flush(),
    }
}

/// A `BDLoopEvent`.
#[unsafe(no_mangle)]
extern "C" fn bd_loop_event(event: u8) {
    trace!(
        "{}",
        ["jobs", "source", "woken", "timer", "before waiting"][usize::from(event)]
    );
    crate::guard("fatal", (), || match event {
        0 if thread::exists() => turn(),
        0 => tick(),
        1 => {
            IS_READY.set(true);
            SOURCE_WAS_READY.set(true);
        }
        2 => unix::WAKE.clear(),
        3 if thread::exists() => bd_loop_wake(),
        3 => IS_READY.set(true),
        _ => before_waiting(),
    });
}

pub fn started() {
    bd_loop_observe(if thread::exists() {
        -1
    } else {
        unix::WAKE.fd()
    });
}

fn seconds(timeout: Option<Duration>) -> f64 {
    timeout.map_or(-1., |timeout| timeout.as_secs_f64())
}

/// Makes any loop that AppKit runs notice `source` and the time.
pub fn arm(source: Option<isize>, timeout: Option<Duration>) {
    bd_loop_arm(source.map_or(-1, |source| source as i32), seconds(timeout));
}

pub fn wait(
    platform: Option<&dyn Platform>,
    source: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    let is_launched = platform.is_some_and(|platform| platform.name() != "headless");
    if thread::exists() {
        if is_launched {
            IS_RUNNING.set(true);
            turn();
            bd_loop_run();
        } else {
            bd_loop_run_once(seconds(timeout()));
        }
        return false;
    }
    if !is_launched {
        return unix::poll(&unix::WAKE, source, timeout());
    }
    window::layers::flush();
    let timeout = timeout();
    trace!("waits for {timeout:?}");
    arm(source, timeout);
    bd_loop_pump(timeout != Some(Duration::ZERO));
    IS_READY.take()
}

/// On the thread that runs JavaScript, if that is not the UI's.
pub fn wait_for_events(source: Option<isize>, timeout: Option<Duration>) {
    unix::poll(&unix::WAKE, source, timeout);
}
