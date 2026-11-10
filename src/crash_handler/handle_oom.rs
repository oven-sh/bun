use bun_alloc::AllocError;

/// Unwraps a `Result<T, AllocError>`, converting OOM into the controlled
/// `bun.outOfMemory` crash.
pub fn handle_oom<T>(result: Result<T, AllocError>) -> T {
    match result {
        Ok(success) => success,
        Err(AllocError) => crate::out_of_memory(),
    }
}
