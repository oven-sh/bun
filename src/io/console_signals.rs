//! The signals that Node.js makes of the events of a console.

use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
use std::sync::OnceLock;

use bun_sys::windows::{self as w, BOOL, DWORD, FALSE, TRUE, console};
use bun_threading::Guarded;

const SIGHUP: c_int = 1;
const SIGINT: c_int = 2;
const SIGBREAK: c_int = 21;
const SIGWINCH: c_int = 28;

unsafe extern "C" {
    safe fn Bun__onPosixSignal(signal: c_int);
}

/// A bit for each signal that has a listener.
static WATCHED: AtomicU32 = AtomicU32::new(0);

fn is_watched(signal: c_int) -> bool {
    WATCHED.load(Ordering::SeqCst) & (1 << signal) != 0
}

fn raise(signal: c_int) -> bool {
    let is_watched = is_watched(signal);
    if is_watched {
        Bun__onPosixSignal(signal);
    }
    is_watched
}

extern "system" fn on_control_event(event: DWORD) -> BOOL {
    let is_handled = match event {
        w::CTRL_C_EVENT => raise(SIGINT),
        w::CTRL_BREAK_EVENT => raise(SIGBREAK),
        // The system ends the process as soon as this returns, or else after some seconds.
        w::CTRL_CLOSE_EVENT if raise(SIGHUP) => loop {
            std::thread::park();
        },
        _ => return FALSE,
    };
    if !is_handled {
        bun_core::output::source::stdio::restore();
    }
    is_handled.into()
}

/// The newest handler is called first, so this one gets what no other wants.
#[unsafe(no_mangle)]
extern "C" fn Bun__installConsoleControlHandler() {
    w::SetConsoleCtrlHandler(Some(on_control_event), TRUE);
}

#[unsafe(no_mangle)]
extern "C" fn Bun__watchConsoleSignal(signal: c_int, is_watched: bool) {
    if !is_watched {
        WATCHED.fetch_and(!(1 << signal), Ordering::SeqCst);
        return;
    }
    WATCHED.fetch_or(1 << signal, Ordering::SeqCst);
    if signal == SIGWINCH {
        poll_window_size();
    }
}

static WINDOW_SIZE: Guarded<Option<(u16, u16)>> = Guarded::new(None);

/// `false` if there is no console.
pub(crate) fn check_window_size() -> bool {
    static OUTPUT: OnceLock<Option<OwnedHandle>> = OnceLock::new();
    let output = OUTPUT.get_or_init(|| console::open(bun_core::wstr!("CONOUT$")).ok());
    let size = (output.as_ref()).and_then(|output| console::window_size(output.as_raw_handle()));
    let Some(size) = size else { return false };
    let last = WINDOW_SIZE.lock().replace(size);
    if last.is_some_and(|last| last != size) {
        raise(SIGWINCH);
    }
    true
}

/// Only a reader of the console's input is told of a new size.
fn poll_window_size() {
    static IS_POLLING: AtomicBool = AtomicBool::new(false);
    if IS_POLLING.swap(true, Ordering::SeqCst) {
        return;
    }
    *WINDOW_SIZE.lock() = None;
    if !check_window_size() {
        return;
    }
    bun_iocp::blocking::spawn(|| {
        loop {
            w::kernel32::Sleep(150);
            if !is_watched(SIGWINCH) {
                IS_POLLING.store(false, Ordering::SeqCst);
                if !is_watched(SIGWINCH) || IS_POLLING.swap(true, Ordering::SeqCst) {
                    return;
                }
            }
            check_window_size();
        }
    });
}
