//! Starting the threads bun creates on first use (the HTTP client thread, the
//! bundle thread, the IO and process waiter threads, the file watcher). A
//! refused thread (`EAGAIN` at a thread limit, `ERROR_COMMITMENT_LIMIT` at the
//! commit limit of the machine) is an error for the caller to report, not a
//! crash.

use core::fmt;
use std::time::Duration;

use bun_sys::SystemErrno;

/// The schedule of the Go runtime: 20 attempts, n ms of sleep after the n-th
/// failure, about 190 ms in total when the limit stays.
const MAX_ATTEMPTS: u64 = 20;

/// Calls `spawn` until it succeeds, per [`MAX_ATTEMPTS`]. `spawn` has to build
/// the thread again on each call: `std::thread::Builder::spawn` consumes the
/// closure even when it fails. `thread_name` goes into the error message.
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

/// Every attempt of [`spawn_with_retry`] failed. `Display` is the message for
/// the user, with the text of the OS for the last error.
#[derive(Debug)]
pub struct SpawnError {
    thread_name: &'static str,
    error: std::io::Error,
}

impl SpawnError {
    /// A Windows code without an errno of its own (`ERROR_COMMITMENT_LIMIT`)
    /// maps to `ENOMEM`.
    pub fn errno(&self) -> SystemErrno {
        #[cfg(windows)]
        const FALLBACK: SystemErrno = SystemErrno::ENOMEM;
        #[cfg(not(windows))]
        const FALLBACK: SystemErrno = SystemErrno::EAGAIN;

        SystemErrno::from_io_error(&self.error).unwrap_or(FALLBACK)
    }

    /// The name of [`errno`](Self::errno), for the `code` of a JS error.
    pub fn code(&self) -> &'static str {
        <&'static str>::from(self.errno())
    }

    /// What the user can do about it, when the text of the OS does not say.
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

    /// Prints the error and its hint to stderr.
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

/// For the callers whose own result type is `bun_sys::Result`. The thread name
/// and the text of the OS are not part of a `bun_sys::Error`.
impl From<SpawnError> for bun_sys::Error {
    fn from(err: SpawnError) -> Self {
        bun_sys::Error::new(err.errno(), bun_sys::Tag::pthread_create)
    }
}
