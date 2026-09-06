//! Signal-driven abort for the multi-script runners: `bun run --filter` and
//! `bun run --parallel` / `--sequential`.
//!
//! The handler records the signal and wakes the mini event loop. The poll
//! retries on EINTR, so a flag alone is only seen when a child produces an
//! event. The run loop reads [`pending`] between ticks, forwards the signal to
//! the running scripts, and exits with `128 + signal` once they are gone.
//! Linux PDEATHSIG covers the case where the runner cannot do this (SIGKILL).

use core::sync::atomic::{AtomicPtr, AtomicU8, Ordering};

use bun_sys::SignalCode;

/// Signal number that requested the abort. 0 while none did.
static SIGNAL: AtomicU8 = AtomicU8::new(0);

/// Set by [`install`], cleared by [`uninstall`]. The uws loop lives for the
/// whole thread, so a handler that loads it after `uninstall` races nothing.
static LOOP: AtomicPtr<bun_uws::Loop> = AtomicPtr::new(core::ptr::null_mut());

/// Signal context on POSIX; the console control thread on Windows.
fn request_abort(signal: SignalCode) {
    // The first signal wins so the one forwarded to the children stays stable.
    let _ = SIGNAL.compare_exchange(0, signal.0, Ordering::AcqRel, Ordering::Acquire);
    let loop_ = LOOP.load(Ordering::Acquire);
    if !loop_.is_null() {
        // SAFETY: the loop is thread-lifetime, and the raw extern is the
        // thread-safe entry point (no `&mut Loop` formed off the loop thread).
        unsafe { bun_uws::us_wakeup_loop(loop_) };
    }
}

#[cfg(unix)]
extern "C" fn posix_signal_handler(
    sig: i32,
    _: *const bun_sys::posix::siginfo_t,
    _: *const core::ffi::c_void,
) {
    request_abort(SignalCode(sig as u8));
}

#[cfg(windows)]
extern "system" fn windows_ctrl_handler(ctrl: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
    use bun_sys::windows;
    match ctrl {
        windows::CTRL_C_EVENT | windows::CTRL_BREAK_EVENT | windows::CTRL_CLOSE_EVENT => {
            request_abort(SignalCode::SIGINT);
            windows::TRUE
        }
        _ => windows::FALSE,
    }
}

#[cfg(unix)]
const SIGNALS: [i32; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP];

/// `loop_` is the uws loop the run loop ticks. `SA_RESETHAND` and
/// [`uninstall`] together make a second signal kill the runner at once, for
/// a child that does not react to the forwarded signal.
pub(crate) fn install(loop_: *mut bun_uws::Loop) {
    LOOP.store(loop_, Ordering::Release);
    #[cfg(unix)]
    {
        // SAFETY: all-zero is a valid `libc::sigaction`; `sigemptyset` and
        // `sigaction` are FFI calls over valid stack pointers.
        unsafe {
            let mut action: libc::sigaction = bun_core::ffi::zeroed();
            action.sa_sigaction = posix_signal_handler as *const () as usize;
            libc::sigemptyset(&raw mut action.sa_mask);
            action.sa_flags = (libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND) as _;
            for sig in SIGNALS {
                libc::sigaction(sig, &raw const action, core::ptr::null_mut());
            }
        }
    }
    #[cfg(windows)]
    {
        let res = bun_sys::windows::SetConsoleCtrlHandler(
            Some(windows_ctrl_handler),
            bun_sys::windows::TRUE,
        );
        if res == 0 && bun_core::env::IS_DEBUG {
            bun_core::warn!("Failed to set abort handler\n");
        }
    }
}

/// Restores the default disposition so the next signal ends the process at once.
pub(crate) fn uninstall() {
    #[cfg(unix)]
    {
        // SAFETY: all-zero is a valid `libc::sigaction` and means SIG_DFL.
        unsafe {
            let action: libc::sigaction = bun_core::ffi::zeroed();
            for sig in SIGNALS {
                libc::sigaction(sig, &raw const action, core::ptr::null_mut());
            }
        }
    }
    #[cfg(windows)]
    {
        // (None, FALSE) clears the ignore attribute; it does NOT unregister
        // a handler routine. Pass the address.
        let _ = bun_sys::windows::SetConsoleCtrlHandler(
            Some(windows_ctrl_handler),
            bun_sys::windows::FALSE,
        );
    }
    LOOP.store(core::ptr::null_mut(), Ordering::Release);
}

/// The signal that requested an abort, if one arrived.
pub(crate) fn pending() -> Option<SignalCode> {
    match SIGNAL.load(Ordering::Acquire) {
        0 => None,
        sig => Some(SignalCode(sig)),
    }
}
