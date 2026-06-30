//! bun_sync crate root — tier-0 futex + mutex primitives.

#[path = "Futex.rs"]
pub mod futex;
#[path = "Mutex.rs"]
pub mod mutex;

/// `Futex` re-exported as a capitalized module alias so callers can write
/// `Futex::wait`, `Futex::wake`, `Futex::Deadline`.
pub use futex as Futex;
pub use mutex::{Mutex, MutexGuard, ReleaseImpl};

/// Returns a non-zero OS thread id.
/// Used by `Mutex` debug deadlock detection (and `Condition` on Windows).
///
/// This crate sits below `bun_core`, so it cannot reuse
/// `bun_core::thread_id::current`; this is the same per-OS ladder (uncached),
/// widened to `u64` so callers can store it in an `AtomicU64` regardless of
/// the platform's native thread-id width.
#[inline]
pub fn current_thread_id() -> u64 {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // SAFETY: `gettid` takes no arguments and cannot fail.
        return unsafe { libc::gettid() } as u64;
    }
    #[cfg(target_vendor = "apple")]
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
    #[cfg(windows)]
    {
        unsafe extern "system" {
            // No preconditions; infallible Win32 intrinsic.
            safe fn GetCurrentThreadId() -> u32; // kernel32 DWORD
        }
        return u64::from(GetCurrentThreadId());
    }
    #[cfg(target_os = "freebsd")]
    {
        unsafe extern "C" {
            // safe: no args; infallible.
            safe fn pthread_getthreadid_np() -> core::ffi::c_int;
        }
        return pthread_getthreadid_np() as u64;
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_vendor = "apple",
        windows,
        target_os = "freebsd",
    )))]
    {
        // Portable fallback: a process-unique, non-zero per-thread counter.
        use core::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        std::thread_local! {
            static ID: u64 = NEXT.fetch_add(1, Ordering::Relaxed);
        }
        return ID.with(|id| *id);
    }
}
