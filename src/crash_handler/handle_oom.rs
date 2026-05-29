use bun_alloc::AllocError;
use bun_core::Error;

pub fn handle_oom<A: HandleOom>(error_union_or_set: A) -> A::Output {
    error_union_or_set.handle_oom()
}

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

impl<T> HandleOom for Result<T, Error> {
    type Output = Result<T, Error>;
    fn handle_oom(self) -> Result<T, Error> {
        match self {
            Ok(success) => Ok(success),
            Err(err) if err == Error::OUT_OF_MEMORY => crate::out_of_memory(),
            Err(other_error) => Err(other_error),
        }
    }
}

// ── .error_set, mixed → same set with OOM subtracted ─────────────────────
impl HandleOom for Error {
    type Output = Error;
    fn handle_oom(self) -> Error {
        if self == Error::OUT_OF_MEMORY {
            crate::out_of_memory()
        } else {
            self
        }
    }
}

// ported from: src/crash_handler/handle_oom.zig
