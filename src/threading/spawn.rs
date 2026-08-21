//! Starting the daemon threads bun creates on first use: the HTTP client
//! thread, the bundle thread behind `Bun.build()`, the POSIX IO thread.
//!
//! The OS can refuse a thread. `pthread_create` returns `EAGAIN` when the
//! process is at a thread or pid limit, or cannot map the stack; `CreateThread`
//! fails with `ERROR_COMMITMENT_LIMIT` when the machine cannot commit the
//! stack (bun commits 2 MB per thread, see the `/STACK:` flag in
//! scripts/build/flags.ts). That is a limit of the machine, not a bug in bun,
//! so the callers report it like any other error instead of crashing.

use core::fmt;
use std::time::Duration;

use bun_sys::SystemErrno;

/// The schedule of the Go runtime (`_cgo_try_pthread_create`,
/// `runtime.createThread`): 20 attempts, and a pause of n ms after the n-th
/// failure. The limit is often gone a moment later, when the threads of an
/// exiting process are reaped or Windows has grown the paging file. A limit
/// that stays costs about 190 ms per call before the caller reports it.
const MAX_ATTEMPTS: u64 = 20;

/// Calls `spawn` until it succeeds, per [`MAX_ATTEMPTS`]. Every error is
/// retried: the OS reports the same limit under several codes (`EAGAIN`,
/// `ERROR_ACCESS_DENIED`, `ERROR_COMMITMENT_LIMIT`), and the threads bun starts
/// this way have fixed, valid attributes, so there is no other kind of error to
/// fail fast on. `spawn` builds the thread again on every call, because
/// `std::thread::Builder::spawn` consumes the closure even when it fails.
/// `thread_name` names the thread in the error message.
pub fn spawn_with_retry<T>(
    thread_name: &'static str,
    mut spawn: impl FnMut() -> std::io::Result<T>,
) -> Result<T, SpawnError> {
    let mut attempt = 1;
    loop {
        let error = match spawn() {
            Ok(thread) => return Ok(thread),
            Err(error) => error,
        };
        if attempt == MAX_ATTEMPTS {
            return Err(SpawnError { thread_name, error });
        }
        std::thread::sleep(Duration::from_millis(attempt));
        attempt += 1;
    }
}

/// Every attempt of [`spawn_with_retry`] failed. `Display` gives the full
/// message, with the text of the OS for the last error:
/// `Failed to start the HTTP client thread: The paging file is too small for
/// this operation to complete. (os error 1455)`.
#[derive(Debug)]
pub struct SpawnError {
    thread_name: &'static str,
    error: std::io::Error,
}

impl SpawnError {
    /// The errno for `error.code` and for the error enums that wrap a
    /// `SystemErrno`. A Windows code without an errno of its own, such as
    /// `ERROR_COMMITMENT_LIMIT`, maps to `ENOMEM`.
    pub fn errno(&self) -> SystemErrno {
        #[cfg(windows)]
        const FALLBACK: SystemErrno = SystemErrno::ENOMEM;
        #[cfg(not(windows))]
        const FALLBACK: SystemErrno = SystemErrno::EAGAIN;

        let Some(code) = self.error.raw_os_error() else {
            return FALLBACK;
        };
        #[cfg(not(windows))]
        let code = i64::from(code);
        SystemErrno::init(code).unwrap_or(FALLBACK)
    }

    /// The name of [`errno`](Self::errno), for the `code` of a JS error.
    pub fn code(&self) -> &'static str {
        <&'static str>::from(self.errno())
    }

    /// What the user can do about the error. `None` when the text of the OS
    /// already says it.
    pub fn hint(&self) -> Option<&'static str> {
        #[cfg(windows)]
        const HINT: (SystemErrno, &str) = (
            SystemErrno::ENOMEM,
            "Windows could not commit memory for the stack of the thread. Close other programs, or make the paging file larger.",
        );
        #[cfg(not(windows))]
        const HINT: (SystemErrno, &str) = (
            SystemErrno::EAGAIN,
            "The process is out of memory, or it reached a thread limit (ulimit -u, or the pids limit of its cgroup).",
        );

        (self.errno() == HINT.0).then_some(HINT.1)
    }

    /// Prints the error and its hint to stderr, for the commands that cannot
    /// continue without the thread.
    pub fn print(&self) {
        bun_core::err_generic!("{}", self);
        if let Some(hint) = self.hint() {
            bun_core::note!("{}", hint);
        }
    }
}

impl fmt::Display for SpawnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Failed to start the {} thread: {}",
            self.thread_name, self.error
        )
    }
}

impl core::error::Error for SpawnError {}
