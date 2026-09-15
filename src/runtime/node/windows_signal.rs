//! Where `process.on(<signal>)` gets its signals on Windows. Console control
//! events stand in for SIGINT, SIGBREAK and SIGHUP, and a change of the
//! console's size for SIGWINCH. Each is reported through `Bun__onPosixSignal`,
//! so from the signal ring onwards a signal takes the path it takes on POSIX.
//! SIGTERM and SIGQUIT can be listened for and are never raised.

use core::ffi::{c_int, c_void};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};

use bun_jsc::posix_signal_handle::Bun__onPosixSignal;
use bun_sys::windows as win;

// The numbers `os.constants.signals` reports on Windows.
const SIGHUP: c_int = 1;
const SIGINT: c_int = 2;
const SIGBREAK: c_int = 21;
const SIGWINCH: c_int = 28;

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn Sleep(dwMilliseconds: win::DWORD);
    safe fn GetTickCount64() -> u64;
}

/// Bit `n` is set while signal `n`, one a console control event stands for,
/// has a listener.
static WATCHED: AtomicU32 = AtomicU32::new(0);

/// Runs on a thread the system creates for each event. While the event's
/// signal has no listener it is left to the next handler, and in the end to
/// the default one, which terminates the process.
extern "system" fn on_console_ctrl(ctrl_type: win::DWORD) -> win::BOOL {
    let signal = match ctrl_type {
        win::CTRL_C_EVENT => SIGINT,
        win::CTRL_BREAK_EVENT => SIGBREAK,
        win::CTRL_CLOSE_EVENT => SIGHUP,
        // Logoff and shutdown are only sent to services, which have their own
        // notification for them.
        _ => return win::FALSE,
    };
    if WATCHED.load(Ordering::Acquire) & (1 << signal) == 0 {
        return win::FALSE;
    }
    Bun__onPosixSignal(signal);
    if ctrl_type == win::CTRL_CLOSE_EVENT {
        // The system terminates the process when this handler returns, and
        // after about five seconds if it does not. Not returning is what gives
        // the listener that time (libuv: uv__signal_control_handler).
        Sleep(win::INFINITE);
    }
    win::TRUE
}

/// First `process.on(<signal>)` listener for `signum` on the main thread.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__watchWindowsSignal(signum: c_int) {
    match signum {
        SIGINT | SIGBREAK | SIGHUP => {
            static INSTALL: std::sync::Once = std::sync::Once::new();
            INSTALL.call_once(|| {
                let _ = win::SetConsoleCtrlHandler(Some(on_console_ctrl), win::TRUE);
            });
            WATCHED.fetch_or(1 << signum, Ordering::Release);
        }
        SIGWINCH => watch_console_size(),
        _ => {}
    }
}

/// Last listener for `signum` removed.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__unwatchWindowsSignal(signum: c_int) {
    match signum {
        SIGINT | SIGBREAK | SIGHUP => {
            WATCHED.fetch_and(!(1 << signum), Ordering::Release);
        }
        SIGWINCH => unwatch_console_size(),
        _ => {}
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SIGWINCH
// ──────────────────────────────────────────────────────────────────────────

/// `CONOUT$`, opened by the first SIGWINCH listener and kept.
static CONSOLE_OUTPUT: AtomicPtr<c_void> = AtomicPtr::new(core::ptr::null_mut());
/// The size SIGWINCH was last raised for: columns of the screen buffer in the
/// high half, rows of the window in the low half.
static CONSOLE_SIZE: AtomicU64 = AtomicU64::new(0);

fn console_output() -> Option<win::HANDLE> {
    let cached = CONSOLE_OUTPUT.load(Ordering::Acquire);
    if !cached.is_null() {
        return Some(cached);
    }
    // SAFETY: plain Win32 call; the name is NUL-terminated.
    let console = unsafe {
        win::CreateFileW(
            bun_core::w!("CONOUT$\0").as_ptr(),
            win::GENERIC_READ | win::GENERIC_WRITE,
            win::FILE_SHARE_READ | win::FILE_SHARE_WRITE,
            core::ptr::null_mut(),
            win::OPEN_EXISTING,
            0,
            core::ptr::null_mut(),
        )
    };
    if console == win::INVALID_HANDLE_VALUE {
        return None;
    }
    CONSOLE_OUTPUT.store(console, Ordering::Release);
    Some(console)
}

fn console_size() -> Option<u64> {
    let console = console_output()?;
    let mut info: win::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
    // SAFETY: `info` is a live local.
    if unsafe { win::kernel32::GetConsoleScreenBufferInfo(console, &raw mut info) } == 0 {
        return None;
    }
    let columns = info.dwSize.X as u16;
    let rows = (info.srWindow.Bottom - info.srWindow.Top + 1) as u16;
    Some(u64::from(columns) << 32 | u64::from(rows))
}

/// Raise SIGWINCH if the console is not the size it was last raised for. Any
/// thread: the main thread after a wake-up, and whichever loop reads raw
/// console input when the console reports a resize there.
fn raise_if_console_resized() {
    let Some(size) = console_size() else {
        return;
    };
    if CONSOLE_SIZE.swap(size, Ordering::AcqRel) != size {
        Bun__onPosixSignal(SIGWINCH);
    }
}

/// Whether SIGWINCH has a listener and there is a console to compare.
static CONSOLE_SIZE_WATCHED: AtomicBool = AtomicBool::new(false);
/// `GetTickCount64` of the last comparison made after a wake-up.
static CONSOLE_SIZE_CHECKED_MS: AtomicU64 = AtomicU64::new(0);

fn watch_console_size() {
    // No console, nothing to watch.
    let Some(size) = console_size() else {
        return;
    };
    CONSOLE_SIZE.store(size, Ordering::Release);
    bun_io::windows::tty::set_resize_listener(Some(raise_if_console_resized));
    CONSOLE_SIZE_WATCHED.store(true, Ordering::Release);
}

fn unwatch_console_size() {
    CONSOLE_SIZE_WATCHED.store(false, Ordering::Release);
    bun_io::windows::tty::set_resize_listener(None);
}

/// The console reports a resize only to whoever is reading its input in raw
/// mode. For everyone else the main thread compares the size when its loop has
/// woken for something, at most every `INTERVAL_MS`; an idle process is not
/// woken for it.
pub(crate) fn check_console_size_after_wake() {
    const INTERVAL_MS: u64 = 100;
    if !CONSOLE_SIZE_WATCHED.load(Ordering::Relaxed) {
        return;
    }
    let now = GetTickCount64();
    if now.wrapping_sub(CONSOLE_SIZE_CHECKED_MS.load(Ordering::Relaxed)) < INTERVAL_MS {
        return;
    }
    CONSOLE_SIZE_CHECKED_MS.store(now, Ordering::Relaxed);
    raise_if_console_resized();
}
