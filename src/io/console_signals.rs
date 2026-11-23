//! Maps console events to the signals that Node.js emits for them.

use core::ffi::c_int;
use core::sync::atomic::{AtomicU32, Ordering};
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
use std::sync::{Once, OnceLock};

use bun_sys::windows::{self as w, BOOL, DWORD, FALSE, TRUE, console};
use bun_threading::Guarded;

const SIGHUP: c_int = 1;
const SIGINT: c_int = 2;
const SIGBREAK: c_int = 21;
const SIGWINCH: c_int = 28;

unsafe extern "C" {
    safe fn Bun__onPosixSignal(signal: c_int);
}

/// One bit per signal that has a listener.
static WATCHED_SIGNALS: AtomicU32 = AtomicU32::new(0);

fn is_watched(signal: c_int) -> bool {
    WATCHED_SIGNALS.load(Ordering::SeqCst) & (1 << signal) != 0
}

fn try_raise_signal(signal: c_int) -> bool {
    let is_watched = is_watched(signal);
    if is_watched {
        Bun__onPosixSignal(signal);
    }
    is_watched
}

extern "system" fn on_control_event(event: DWORD) -> BOOL {
    let is_handled = match event {
        w::CTRL_C_EVENT => try_raise_signal(SIGINT),
        w::CTRL_BREAK_EVENT => try_raise_signal(SIGBREAK),
        // Windows terminates the process when this handler returns, or after a few seconds if it does not.
        w::CTRL_CLOSE_EVENT if try_raise_signal(SIGHUP) => loop {
            std::thread::park();
        },
        _ => return FALSE,
    };
    if !is_handled {
        bun_core::output::source::stdio::restore();
    }
    is_handled.into()
}

/// Handlers run last-registered first, so this one only sees events that no later handler has handled.
#[unsafe(no_mangle)]
extern "C" fn Bun__installConsoleControlHandler() {
    w::SetConsoleCtrlHandler(Some(on_control_event), TRUE);
}

#[unsafe(no_mangle)]
extern "C" fn Bun__watchConsoleSignal(signal: c_int, is_watched: bool) {
    if !is_watched {
        WATCHED_SIGNALS.fetch_and(!(1 << signal), Ordering::SeqCst);
        return;
    }
    WATCHED_SIGNALS.fetch_or(1 << signal, Ordering::SeqCst);
    if signal == SIGWINCH {
        watch_window_size();
    }
}

static LAST_WINDOW_SIZE: Guarded<Option<(u16, u16)>> = Guarded::new(None);

/// Returns `false` if there is no console.
pub(crate) fn check_window_size() -> bool {
    static OUTPUT: OnceLock<Option<OwnedHandle>> = OnceLock::new();
    let output = OUTPUT.get_or_init(|| console::open(bun_core::wstr!("CONOUT$")).ok());
    let mut last_size = LAST_WINDOW_SIZE.lock();
    let size = output
        .as_ref()
        .and_then(|output| console::window_size(output.as_raw_handle()));
    let Some(size) = size else { return false };
    if last_size
        .replace(size)
        .is_some_and(|previous| previous != size)
    {
        try_raise_signal(SIGWINCH);
    }
    true
}

/// A pseudoconsole has no window and only reports a resize through its input records.
fn watch_window_size() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        *LAST_WINDOW_SIZE.lock() = None;
        let has_console = check_window_size();
        if has_console {
            bun_iocp::blocking::try_spawn_dedicated(|| {
                console::run_resize_message_loop(|| _ = check_window_size())
            });
        }
    });
}
