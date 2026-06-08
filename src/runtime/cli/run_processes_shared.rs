//! Helpers shared by the multi-process script runners: `filter_run`
//! (`bun run --filter`) and `multi_run` (`bun run --parallel`/`--sequential`).

use std::sync::atomic::{AtomicBool, Ordering};

use crate::api::bun::process::{self as spawn, Process, Rusage, Status};

/// Set from a signal handler; polled by the run loops.
pub(crate) static SHOULD_ABORT: AtomicBool = AtomicBool::new(false);

pub(crate) struct AbortHandler;

impl AbortHandler {
    #[cfg(unix)]
    extern "C" fn posix_signal_handler(
        _sig: i32,
        _info: *const bun_sys::posix::siginfo_t,
        _: *const core::ffi::c_void,
    ) {
        SHOULD_ABORT.store(true, Ordering::SeqCst);
    }

    #[cfg(windows)]
    extern "system" fn windows_ctrl_handler(
        dw_ctrl_type: bun_sys::windows::DWORD,
    ) -> bun_sys::windows::BOOL {
        if dw_ctrl_type == bun_sys::windows::CTRL_C_EVENT {
            SHOULD_ABORT.store(true, Ordering::SeqCst);
            return bun_sys::windows::TRUE;
        }
        bun_sys::windows::FALSE
    }

    pub(crate) fn install() {
        #[cfg(unix)]
        {
            // SAFETY: all-zero is a valid `libc::sigaction`; sigemptyset/sigaction are
            // FFI calls with no extra preconditions beyond valid pointers.
            unsafe {
                let mut action: bun_sys::posix::Sigaction = bun_core::ffi::zeroed();
                action.sa_sigaction = Self::posix_signal_handler as *const () as usize;
                libc::sigemptyset(&raw mut action.sa_mask);
                action.sa_flags = (libc::SA_SIGINFO | libc::SA_RESTART | libc::SA_RESETHAND) as _;
                bun_sys::posix::sigaction(libc::SIGINT, &raw const action, core::ptr::null_mut());
            }
        }
        #[cfg(not(unix))]
        {
            let res = bun_sys::windows::SetConsoleCtrlHandler(
                Some(Self::windows_ctrl_handler),
                bun_sys::windows::TRUE,
            );
            if res == 0 {
                if bun_core::env::IS_DEBUG {
                    bun_core::warn!("Failed to set abort handler\n");
                }
            }
        }
    }

    pub(crate) fn uninstall() {
        // only necessary on Windows, as on posix we pass the SA_RESETHAND flag
        #[cfg(windows)]
        {
            // restores default Ctrl+C behavior
            let _ = bun_sys::windows::SetConsoleCtrlHandler(None, bun_sys::windows::FALSE);
        }
    }
}

/// `Process::watch_or_reap` with the shared error fallback: if registration
/// fails and the process has not already exited, synthesize an error exit so
/// the run loop still observes a terminal status.
pub(crate) fn watch_or_reap(process: &mut Process) {
    if let Err(err) = process.watch_or_reap() {
        if !process.has_exited() {
            // SAFETY: all-zero is a valid Rusage (POD C struct)
            let rusage = bun_core::ffi::zeroed::<Rusage>();
            process.on_exit(Status::Err(err), &rusage);
        }
    }
}

/// First non-zero exit code across all spawned handles; signaled/errored
/// processes map to their signal exit code (or 1). 0 when every spawned
/// process exited cleanly.
pub(crate) fn aggregate_exit_code<'h>(statuses: impl Iterator<Item = Option<&'h Status>>) -> u8 {
    for status in statuses.flatten() {
        match status {
            Status::Exited(exited) => {
                if exited.code != 0 {
                    return exited.code;
                }
            }
            Status::Signaled(signal) => {
                return bun_sys::SignalCode(*signal).to_exit_code().unwrap_or(1);
            }
            _ => return 1,
        }
    }
    0
}

/// A `Stdio::Buffer` slot for `SpawnOptions`; on Windows this carries a freshly
/// allocated libuv pipe whose ownership moves into the spawn result.
pub(crate) fn buffered_stdio() -> spawn::Stdio {
    #[cfg(unix)]
    {
        spawn::Stdio::Buffer
    }
    #[cfg(not(unix))]
    {
        spawn::Stdio::Buffer(bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
            bun_sys::windows::libuv::Pipe,
        >())))
    }
}
