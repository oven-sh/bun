//! Retry budget for the renames that publish a directory into the install
//! cache (extracted tarball, patched package, global virtual store entry).
//!
//! On Windows a directory rename fails with `STATUS_ACCESS_DENIED` or
//! `STATUS_SHARING_VIOLATION` while any process holds a handle without
//! `FILE_SHARE_DELETE` on a file inside it, which is how antivirus and the
//! Search Indexer open freshly written files. Nothing is retried on POSIX,
//! where open handles do not block renames and `EPERM` is a real failure.

use core::fmt;
use core::time::Duration;
use std::time::Instant;

use bun_core::env_var::BUN_INSTALL_WINDOWS_RENAME_RETRY_MS;
use bun_sys as sys;

pub(crate) struct RenameRetry {
    started: Instant,
    budget: Duration,
    /// graceful-fs schedule: +10ms per attempt, capped at 100ms.
    next_backoff: Duration,
    exhausted: bool,
}

impl RenameRetry {
    pub(crate) fn start() -> Self {
        Self {
            started: Instant::now(),
            budget: Duration::from_millis(BUN_INSTALL_WINDOWS_RENAME_RETRY_MS.get().unwrap()),
            next_backoff: Duration::ZERO,
            exhausted: false,
        }
    }

    pub(crate) fn is_transient(err: &sys::Error) -> bool {
        cfg!(windows)
            && matches!(
                err.get_errno(),
                sys::Errno::EPERM | sys::Errno::EACCES | sys::Errno::EBUSY
            )
    }

    /// Sleeps and returns `true` if another attempt fits in the budget.
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

    /// Error-message suffix; displays as nothing unless the budget ran out.
    pub(crate) fn exhausted_hint(&self) -> ExhaustedHint {
        ExhaustedHint {
            waited: self.exhausted.then(|| self.started.elapsed()),
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
                " (gave up after retrying for {}ms; usually another process such as antivirus has a file in the directory open. Set {} to wait longer)",
                waited.as_millis(),
                bstr::BStr::new(BUN_INSTALL_WINDOWS_RENAME_RETRY_MS.key().as_bytes()),
            ),
            None => Ok(()),
        }
    }
}
