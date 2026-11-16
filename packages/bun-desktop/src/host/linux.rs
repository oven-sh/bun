use std::cell::{Cell, RefCell};
use std::time::Duration;

use gpui::Platform;

use super::thread;
pub use super::unix::wake;
use super::unix::{self, Pipe, WAKE};

/// calloop cannot be entered from one of its callbacks, and never runs a loop of its own.
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

struct Watch {
    set_enabled: Box<dyn Fn(bool)>,
    is_enabled: bool,
}

thread_local! {
    static WATCH: RefCell<Option<Watch>> = const { RefCell::new(None) };
    static IS_READY: Cell<bool> = const { Cell::new(false) };
}

pub fn started(platform: &dyn Platform) {
    drop(platform.watch_fd(pipe().fd(), Box::new(|| pipe().clear())));
}

pub fn arm(_: Option<isize>, _: Option<Duration>) {}

pub fn wait(
    platform: Option<&dyn Platform>,
    source: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    let Some(platform) = platform else {
        return unix::poll(pipe(), source, timeout());
    };
    WATCH.with_borrow_mut(|watch| match (watch, source) {
        (Some(watch), _) if watch.is_enabled != source.is_some() => {
            watch.is_enabled = source.is_some();
            (watch.set_enabled)(watch.is_enabled);
        }
        (watch @ None, Some(source)) => {
            let set_enabled = platform.watch_fd(source as i32, Box::new(|| IS_READY.set(true)));
            *watch = Some(Watch {
                set_enabled,
                is_enabled: true,
            });
        }
        _ => {}
    });
    platform.pump(timeout);
    IS_READY.take()
}

/// On the thread that runs JavaScript, if that is not the UI's.
pub fn wait_for_events(source: Option<isize>, timeout: Option<Duration>) {
    unix::poll(&unix::WAKE, source, timeout);
}
