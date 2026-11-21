//! Scopes that report the status and failed allocations. They take the OOM flag when they end, so they must not be nested.

use super::CallerMem;
use crate::common::memory;
use crate::common::utypes::*;
use std::marker::PhantomData;

/// `UErrorCode *`: null, or a status. It also provides the `CallerMem` of the call.
#[repr(transparent)]
pub(crate) struct ErrorCode<'c>(*mut UErrorCode, PhantomData<&'c mut CallerMem>);

impl ErrorCode<'_> {
    pub(crate) fn is_null(&self) -> bool {
        self.0.is_null()
    }

    /// Gives access to the caller's memory outside of `run`.
    pub(crate) fn mem(&mut self) -> &mut CallerMem {
        // SAFETY: `&mut self` makes this the only token of the call.
        unsafe { CallerMem::new() }
    }

    pub(crate) fn get(&self) -> Option<UErrorCode> {
        // SAFETY: the pointer is null or valid, and the reference ends here.
        unsafe { self.0.as_ref() }.copied()
    }

    pub(crate) fn set(&mut self, code: UErrorCode) {
        if !self.is_null() {
            // SAFETY: the pointer is valid, and `&mut self` excludes borrows from the `CallerMem`.
            unsafe { self.0.write(code) };
        }
    }

    /// Runs `f` unless the status is null or a failure. After a failed allocation the result is dropped, so it must own what it opened.
    pub(crate) fn run<T>(
        mut self,
        on_failure: T,
        f: impl FnOnce(&mut CallerMem, &mut UErrorCode) -> Result<T, UErrorCode>,
    ) -> T {
        let Some(found) = self.get().filter(|code| code.is_success()) else {
            return on_failure;
        };
        debug_assert!(!memory::is_oom());
        let mut code = found;
        match f(self.mem(), &mut code) {
            Ok(result) => {
                if code != found {
                    self.set(code);
                }
                if memory::any_oom() {
                    self.unless_oom(result, on_failure)
                } else {
                    result
                }
            }
            Err(failure) => {
                self.fail(failure);
                on_failure
            }
        }
    }

    /// `run` for an `f` that never sets the OOM flag: it does not allocate or read a static cache.
    pub(crate) fn run_no_alloc<T>(
        mut self,
        on_failure: T,
        f: impl FnOnce(&mut CallerMem, &mut UErrorCode) -> Result<T, UErrorCode>,
    ) -> T {
        let Some(found) = self.get().filter(|code| code.is_success()) else {
            return on_failure;
        };
        let mut code = found;
        match f(self.mem(), &mut code) {
            Ok(result) => {
                if code != found {
                    self.set(code);
                }
                result
            }
            Err(failure) => {
                debug_assert!(failure.is_failure());
                self.set(failure);
                on_failure
            }
        }
    }

    /// Ends the scope of a `run` that has a result. Perf: a tail call, so the common path saves no register for it.
    #[cold]
    #[inline(never)]
    fn unless_oom<T>(mut self, result: T, on_failure: T) -> T {
        if !memory::take_oom() {
            return result;
        }
        self.set(U_MEMORY_ALLOCATION_ERROR);
        on_failure
    }

    /// Ends the scope of a `run` that has failed. Out of line, because most functions inline `run`.
    #[cold]
    #[inline(never)]
    fn fail(mut self, failure: UErrorCode) {
        debug_assert!(failure.is_failure());
        self.set(if memory::take_oom() {
            U_MEMORY_ALLOCATION_ERROR
        } else {
            failure
        });
    }

    /// Returns null if `f` returns `Err`, but not if it only stores a failure. Perf: an `H` larger than `T` is built in its box.
    pub(crate) fn open<T, H: From<T>>(
        self,
        f: impl FnOnce(&mut CallerMem, &mut UErrorCode) -> Result<T, UErrorCode>,
    ) -> Option<Box<H>> {
        self.run(None, |cx, status| {
            memory::try_box_result(&mut f(cx, status)).map(Some)
        })
    }
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
