use bun_alloc::AllocError;

/// Unwraps a `Result<T, AllocError>`, converting `error.OutOfMemory` into the
/// controlled `bun.outOfMemory` crash.
///
/// In Rust, `Vec`/`Box` allocation already aborts on OOM via the
/// global allocator's `handle_alloc_error`. Per PORTING.md §Allocators,
/// callsites of `bun.handleOom(expr)` translate to bare `expr`. This function
/// remains for the residual cases where a `Result<T, AllocError>` is threaded
/// explicitly.
pub fn handle_oom<A: HandleOom>(error_union_or_set: A) -> A::Output {
    error_union_or_set.handle_oom()
}

pub trait HandleOom {
    type Output;
    fn handle_oom(self) -> Self::Output;
}

impl<T> HandleOom for Result<T, AllocError> {
    type Output = T;
    fn handle_oom(self) -> T {
        match self {
            Ok(success) => success,
            Err(AllocError) => crate::out_of_memory(),
        }
    }
}
