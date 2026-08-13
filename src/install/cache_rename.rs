//! Retry budget shared by the renames that publish a freshly built directory
//! into the install cache: an extracted tarball, a patched package, or a
//! global virtual store entry.
//!
//! On Windows, renaming a directory fails with `STATUS_ACCESS_DENIED` or
//! `STATUS_SHARING_VIOLATION` while any other process holds a handle without
//! `FILE_SHARE_DELETE` on a file inside it. Antivirus, the Search Indexer and
//! endpoint agents open freshly written files exactly that way, typically for
//! tens of milliseconds up to a few seconds, so the rename is retried until
//! `BUN_INSTALL_WINDOWS_RENAME_RETRY_MS` has elapsed. POSIX renames are not
//! affected by open handles and `EPERM`/`EACCES` are real permission failures
//! there, so nothing is ever retried off Windows.

use core::fmt;
use core::time::Duration;
use std::time::Instant;

use bun_sys as sys;

pub(crate) const ENV_VAR_NAME: &str = "BUN_INSTALL_WINDOWS_RENAME_RETRY_MS";

pub(crate) struct RenameRetry {
    started: Instant,
    budget: Duration,
    /// Sleep before the next attempt; grows 10ms per attempt and caps at 100ms,
    /// which is the schedule npm's `graceful-fs` uses for the same failure.
    next_backoff: Duration,
    exhausted: bool,
}

impl RenameRetry {
    pub(crate) fn start() -> Self {
        Self {
            started: Instant::now(),
            budget: Duration::from_millis(
                bun_core::env_var::BUN_INSTALL_WINDOWS_RENAME_RETRY_MS
                    .get()
                    .unwrap_or(5_000),
            ),
            next_backoff: Duration::ZERO,
            exhausted: false,
        }
    }

    /// Whether `err` is one of the errors Windows reports while another process
    /// holds a handle inside the directory being renamed or at its destination.
    pub(crate) fn is_transient(err: &sys::Error) -> bool {
        cfg!(windows)
            && matches!(
                err.get_errno(),
                sys::Errno::EPERM | sys::Errno::EACCES | sys::Errno::EBUSY
            )
    }

    /// Called after a failed attempt. Sleeps and returns `true` while the budget
    /// allows another attempt; returns `false` once it is spent.
    pub(crate) fn wait(&mut self) -> bool {
        if self.started.elapsed() >= self.budget {
            self.exhausted = true;
            return false;
        }
        self.next_backoff =
            (self.next_backoff + Duration::from_millis(10)).min(Duration::from_millis(100));
        std::thread::sleep(self.next_backoff);
        true
    }

    pub(crate) fn exhausted(&self) -> bool {
        self.exhausted
    }

    /// Suffix for the error reported to the user once `wait()` has returned
    /// `false`; displays as nothing otherwise.
    pub(crate) fn exhausted_hint(&self) -> ExhaustedHint {
        ExhaustedHint {
            waited: if self.exhausted {
                Some(self.started.elapsed())
            } else {
                None
            },
        }
    }
}

pub(crate) struct ExhaustedHint {
    waited: Option<Duration>,
}

impl fmt::Display for ExhaustedHint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.waited {
            Some(waited) => write!(
                f,
                " (gave up after retrying for {}ms; another process is holding a file open in the directory. Set {} to wait longer)",
                waited.as_millis(),
                ENV_VAR_NAME,
            ),
            None => Ok(()),
        }
    }
}
