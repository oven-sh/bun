use std::time::{Duration, Instant};

use super::thread;
pub use super::unix::wake;
use super::unix::{self, Pipe, WAKE};
use crate::platform::Platform;

/// Nothing runs a loop of its own.
pub const IS_REENTRANT: bool = false;
pub const RUNS_ON_ANY_THREAD: bool = true;

static WAKE_UI: Pipe = Pipe::new();

pub fn init() {
    WAKE.open();
    WAKE_UI.open();
}

pub fn wake_ui() {
    WAKE_UI.write();
}

fn pipe() -> &'static Pipe {
    if thread::exists() && !thread::is_elsewhere() {
        &WAKE_UI
    } else {
        &WAKE
    }
}

pub fn started() {}

pub fn arm(_: Option<isize>, _: Option<Duration>) {}

pub fn wait(
    platform: Option<&dyn Platform>,
    source: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    let Some(platform) = platform else {
        return unix::poll(pipe(), source, &mut Vec::new(), timeout());
    };
    let until = platform
        .before_waiting()
        .map(|until| until.saturating_duration_since(Instant::now()));
    let mut descriptors = platform.descriptors();
    let is_ready = unix::poll(
        pipe(),
        source,
        &mut descriptors,
        until.into_iter().chain(timeout()).min(),
    );
    platform.dispatch(&descriptors);
    is_ready
}

/// On the thread that runs JavaScript, if that is not the UI's.
pub fn wait_for_events(source: Option<isize>, timeout: Option<Duration>) {
    unix::poll(&unix::WAKE, source, &mut Vec::new(), timeout);
}
