//! Test-only definitions of the C/C++ symbols that `bun_threading`'s pool,
//! `bun_core::get_thread_count` and `bun_alloc`'s OOM handler reference
//! unconditionally. The real implementations are object files in the final
//! CMake link, which a `cargo test -p bun_file_index --lib` binary does not
//! include; these behaviorally equivalent no-ops keep the real-`WorkPool`
//! crawl tests linkable. Compiled only into this crate's own test binary,
//! never into Bun.
#![allow(non_snake_case)]

use core::ffi::c_int;

/// mimalloc's "this thread is a pool worker" hint (eager deferred frees).
/// The test binary uses the system allocator, so it is a no-op.
#[unsafe(no_mangle)]
extern "C" fn mi_thread_set_in_threadpool() {}

/// mimalloc heap collection; nothing to collect under the test allocator.
#[unsafe(no_mangle)]
extern "C" fn mi_collect(_force: bool) {}

/// WTF::releaseFastMallocFreeMemoryForThisThread — no bmalloc here.
#[unsafe(no_mangle)]
extern "C" fn WTF__releaseFastMallocFreeMemoryForThisThread() {}

/// WTF::numberOfProcessorCores, used to size the work pool.
#[unsafe(no_mangle)]
extern "C" fn WTF__numberOfProcessorCores() -> c_int {
    std::thread::available_parallelism().map_or(1, |n| c_int::try_from(n.get()).unwrap_or(1))
}

/// `bun_highway`'s SIMD byte scan; same contract as the C++ kernel
/// (`haystack_len` when absent). Reached through `bun_core::output`'s env
/// parsing on worker-thread setup.
///
/// # Safety
/// `haystack` must point to `haystack_len` readable bytes — the same
/// contract `bun_highway::index_of_char` already upholds for its callers.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(
    haystack: *const u8,
    haystack_len: usize,
    needle: u8,
) -> usize {
    // SAFETY: caller (bun_highway) passes a valid `[ptr, ptr+len)` range.
    let bytes = unsafe { core::slice::from_raw_parts(haystack, haystack_len) };
    memchr::memchr(needle, bytes).unwrap_or(haystack_len)
}

/// Per-thread stack-bounds bookkeeping for the recursion guard. The guard
/// reports "safe" until initialized, so an empty init is the conservative
/// behavior for a test binary.
#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {}

/// `bun_crash_handler`'s OOM report. Declared `extern "Rust"` and called by
/// `bun_alloc::out_of_memory`.
#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    // The real handler crash-reports and aborts; an abort is the contract.
    std::process::abort()
}
