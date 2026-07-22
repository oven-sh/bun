use crate::Error;
use bun_alloc::AllocError;

// "OOM-only" vs "other errors possible" is encoded structurally in the
// `HandleOom` trait impls below — the `AllocError` impls ARE the "OOM-only"
// arm (Output = T / Output = !), and the `crate::Error` impls ARE the
// "other errors possible" arm (Output = Result<T, E> / Output = E).

/// If `error_union_or_set` is `error.OutOfMemory`, calls `bun.outOfMemory`. Otherwise:
///
/// * If that was the only possible error, returns the non-error payload for error unions, or
///   `noreturn` for error sets.
/// * If other errors are possible, returns the same error union or set, but without
///   `error.OutOfMemory` in the error set.
///
/// Prefer this method over `catch bun.outOfMemory()`, since that could mistakenly catch
/// non-OOM-related errors.
///
/// There are two ways to use this function:
///
/// ```ignore
/// // option 1:
/// let thing = bun::handle_oom(allocate_thing());
/// // option 2:
/// let thing = match allocate_thing() { Ok(v) => v, Err(err) => bun::handle_oom(err) };
/// ```
///
/// In Rust, `Vec`/`Box` allocation failure goes through the global
/// allocator's `handle_alloc_error`, which the alloc-error hook installed by
/// `install_hooks()` routes into the same `bun::out_of_memory()` crash report
/// as this function. Per PORTING.md §Allocators, callsites of
/// `bun.handleOom(expr)` translate to bare `expr`. This function remains for
/// the residual cases where a `Result<T, AllocError>` is threaded explicitly.
pub fn handle_oom<A: HandleOom>(error_union_or_set: A) -> A::Output {
    error_union_or_set.handle_oom()
}

/// Output-type selection for [`handle_oom`]: each impl below is one arm of
/// the input-shape × OOM-only matrix (see the section comments).
pub trait HandleOom {
    type Output;
    fn handle_oom(self) -> Self::Output;
}

// ── .error_union, isOomOnlyError == true → union_info.payload ────────────
impl<T> HandleOom for Result<T, AllocError> {
    type Output = T;
    fn handle_oom(self) -> T {
        match self {
            Ok(success) => success,
            Err(AllocError) => crate::out_of_memory(),
        }
    }
}

// ── .error_set, isOomOnlyError == true → noreturn ────────────────────────
// `!` as an associated type requires nightly; use `core::convert::Infallible`
// (uninhabited) so callers can `match x {}`.
impl HandleOom for AllocError {
    type Output = core::convert::Infallible;
    fn handle_oom(self) -> core::convert::Infallible {
        crate::out_of_memory()
    }
}

// ── .error_union, mixed error set → same union with OOM subtracted ───────
// Rust error enums are nominal, not sets — there is no set subtraction. For
// the catch-all `crate::Error` we compare against the interned tag and
// return the same type. Per-crate `thiserror` enums that carry an
// `OutOfMemory` variant should add their own `HandleOom` impl.
impl<T> HandleOom for Result<T, Error> {
    type Output = Result<T, Error>;
    fn handle_oom(self) -> Result<T, Error> {
        match self {
            Ok(success) => Ok(success),
            Err(Error::Alloc(_)) => crate::out_of_memory(),
            Err(other_error) => Err(other_error),
        }
    }
}

// ── .error_set, mixed → same set with OOM subtracted ─────────────────────
impl HandleOom for Error {
    type Output = Error;
    fn handle_oom(self) -> Error {
        if matches!(self, Error::Alloc(_)) {
            crate::out_of_memory()
        } else {
            self
        }
    }
}
