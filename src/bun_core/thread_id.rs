//! OS-native numeric thread ID — the kernel's notion of "this thread", suitable
//! for storing in an atomic and printing in panics so it lines up with what a
//! debugger / `top -H` / Instruments shows.
//!
//! This is the single per-OS ladder; every other crate re-exports or widens
//! from here:
//!   * `bun_safety::thread_id`       → `pub use bun_core::thread_id::*;`
//!   * `bun_threading::current_thread_id` → `current() as u64`
//!   * `bun_core::util::debug_thread_id`  → `current() as u64` (debug-only)
//!
//! Rust's `std::thread::ThreadId` is intentionally NOT used: it is an opaque,
//! process-local monotonic counter (no `MAX`, no atomic repr, not the kernel
//! TID), whereas every consumer (`ThreadLock`, `ThreadCell`) needs a plain
//! integer it can store in an atomic and compare against a sentinel.

// ── ThreadId width ─────────────────────────────────────────────────────────
#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "windows",
))]
pub type ThreadId = u32;

#[cfg(target_os = "macos")]
pub type ThreadId = u64;

/// Per-thread cache of [`current()`]. Without it, every call paid a syscall
/// (`gettid`/`pthread_threadid_np`/`GetCurrentThreadId`). The
/// bundler's `Worker::get(ctx)` calls `current()` once per scheduled task —
/// parse, line-offset table, quoted source contents, compile-result
/// generation, link step 5 — so a 19 K-module build paid ~109 K `gettid`
/// syscalls (~36 % of total syscall time on the rolldown `apps/10000` bench).
///
/// `0` is the unset sentinel: kernel TIDs / `pthread_threadid_np` IDs /
/// Win32 thread IDs are all nonzero. A bare `#[thread_local]` slot (not the
/// `thread_local!` macro) so this is a single TLS load with no `LocalKey`
/// initialization-state branch or destructor registration.
#[thread_local]
static TLS_THREAD_ID: core::cell::Cell<ThreadId> = core::cell::Cell::new(0);

/// Returns the platform's notion of the calling thread's ID.
///
/// Attempts to use OS-specific primitives so the value matches what
/// debuggers/tracers report.
///
/// Cached per-thread after the first call (see [`TLS_THREAD_ID`]); subsequent
/// calls are a single TLS read with no syscall. Lazy rather than set-at-spawn so threads not started
/// by Bun's pool (FFI callbacks, the main thread) still get a valid ID.
#[inline]
pub fn current() -> ThreadId {
    let cached = TLS_THREAD_ID.get();
    if cached != 0 {
        return cached;
    }
    let id = current_uncached();
    TLS_THREAD_ID.set(id);
    id
}

#[cold]
fn current_uncached() -> ThreadId {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // SAFETY: `gettid` takes no arguments and cannot fail.
        return unsafe { libc::gettid() } as ThreadId;
    }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn pthread_threadid_np(
                thread: *mut core::ffi::c_void,
                thread_id: *mut u64,
            ) -> core::ffi::c_int;
        }
        let mut id: u64 = 0;
        // SAFETY: passing null requests the current thread; `id` is a valid out-ptr.
        let rc = unsafe { pthread_threadid_np(core::ptr::null_mut(), &raw mut id) };
        debug_assert_eq!(rc, 0);
        return id;
    }
    #[cfg(target_os = "windows")]
    {
        unsafe extern "system" {
            // No preconditions; infallible Win32 intrinsic.
            safe fn GetCurrentThreadId() -> u32; // kernel32 DWORD
        }
        return GetCurrentThreadId();
    }
    #[cfg(target_os = "freebsd")]
    {
        unsafe extern "C" {
            // safe: no args; infallible.
            safe fn pthread_getthreadid_np() -> core::ffi::c_int;
        }
        return pthread_getthreadid_np() as u32;
    }
}
