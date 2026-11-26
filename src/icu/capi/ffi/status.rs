//! Scopes that report the status and failed allocations. They take the OOM flag when they end, so they must not be nested.

use crate::common::memory;
use crate::common::utypes::*;

/// `UErrorCode *`: null, or a status.
#[repr(transparent)]
pub(crate) struct ErrorCode<'c>(Option<&'c mut UErrorCode>);

impl ErrorCode<'_> {
    /// Runs `f` unless the status is null or a failure. After a failed allocation the result is dropped, so it must own what it opened.
    pub(crate) fn run<T>(
        self,
        on_failure: T,
        f: impl FnOnce(&mut UErrorCode) -> Result<T, UErrorCode>,
    ) -> T {
        let Some(status) = self.0.filter(|status| status.is_success()) else {
            return on_failure;
        };
        debug_assert!(!memory::is_oom());
        match f(status) {
            Ok(result) if memory::any_oom() => unless_oom(status, result, on_failure),
            Ok(result) => result,
            Err(failure) => {
                fail(status, failure);
                on_failure
            }
        }
    }

    /// `run` for an `f` that never sets the OOM flag: it does not allocate or read a static cache.
    pub(crate) fn run_no_alloc<T>(
        self,
        on_failure: T,
        f: impl FnOnce(&mut UErrorCode) -> Result<T, UErrorCode>,
    ) -> T {
        let Some(status) = self.0.filter(|status| status.is_success()) else {
            return on_failure;
        };
        f(status).unwrap_or_else(|failure| {
            debug_assert!(failure.is_failure());
            *status = failure;
            on_failure
        })
    }

    /// Returns null if `f` fails. Perf: an `H` larger than `T` is built in its box.
    pub(crate) fn open<T, H: From<T>>(
        self,
        f: impl FnOnce() -> Result<T, UErrorCode>,
    ) -> Option<Box<H>> {
        self.run(None, |_| memory::try_box_result(&mut f()).map(Some))
    }
}

/// Ends the scope of a `run` that has a result. Perf: a tail call, so the common path saves no register for it.
#[cold]
#[inline(never)]
fn unless_oom<T>(status: &mut UErrorCode, result: T, on_failure: T) -> T {
    if !memory::take_oom() {
        return result;
    }
    *status = U_MEMORY_ALLOCATION_ERROR;
    on_failure
}

/// Ends the scope of a `run` that has failed. Out of line, because most functions inline `run`.
#[cold]
#[inline(never)]
fn fail(status: &mut UErrorCode, failure: UErrorCode) {
    debug_assert!(failure.is_failure());
    *status = if memory::take_oom() {
        U_MEMORY_ALLOCATION_ERROR
    } else {
        failure
    };
}

/// `unwrap_or` that stores the error, where bad arguments and a failed computation return different values.
pub(crate) fn unwrap_or_set<T>(
    result: Result<T, UErrorCode>,
    on_failure: T,
    status: &mut UErrorCode,
) -> T {
    result.unwrap_or_else(|code| {
        *status = code;
        on_failure
    })
}

/// Returns `on_failure` if an allocation fails in `work`. For functions without a status.
pub(crate) fn on_oom<T>(on_failure: T, work: impl FnOnce() -> T) -> T {
    match memory::catch_oom_at_entry(work) {
        (done, false) => done,
        (_, true) => on_failure,
    }
}

/// Discards allocation failures in `work`, whose result allows for them.
pub(crate) fn ignore_oom<T>(work: impl FnOnce() -> T) -> T {
    memory::catch_oom_at_entry(work).0
}
