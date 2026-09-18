//! Stack check for the passes that recurse as deep as the source nests: see "Stack depth" in DESIGN.md.

use core::cell::Cell;

use bun_core::StackCheck;

use crate::diagnostics::{CompilerError, ErrorCategory, cold_diagnostic};

thread_local! {
    static OVERFLOWED: Cell<bool> = const { Cell::new(false) };
}

/// Start a new function: forget a refusal that the previous one latched.
pub(crate) fn reset() {
    OVERFLOWED.set(false);
}

/// Whether a check refused since the last [`reset`].
pub(crate) fn overflowed() -> bool {
    OVERFLOWED.get()
}

/// Whether the caller may recurse one level deeper. The first `false` latches until [`reset`].
#[inline]
pub(crate) fn is_safe_to_recurse() -> bool {
    if OVERFLOWED.get() {
        return false;
    }
    if StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    OVERFLOWED.set(true);
    false
}

/// [`is_safe_to_recurse`] for a function that returns `Result`.
#[inline]
pub(crate) fn check() -> Result<(), CompilerError> {
    if is_safe_to_recurse() {
        Ok(())
    } else {
        Err(error())
    }
}

#[cold]
#[inline(never)]
pub(crate) fn error() -> CompilerError {
    cold_diagnostic(
        ErrorCategory::Todo,
        "Function is nested too deeply to compile within the stack limit",
        None,
        None,
    )
}
