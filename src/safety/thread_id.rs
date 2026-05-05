//! OS-native numeric thread ID.
//!
//! MOVE_DOWN (CYCLEBREAK §safety T0): `bun_threading::ThreadId` → `bun_safety::thread_id`.
//! Ground truth is Zig's `std.Thread.Id` / `std.Thread.getCurrentId()` (vendor/zig/lib/std/Thread.zig
//! lines 357-370 / 690-722), reproduced here so tier-0 `safety` does not depend on tier-2
//! `bun_threading`. `bun_threading` re-exports these (`pub use bun_safety::thread_id::ThreadId`).
//!
//! Rust's `std::thread::ThreadId` is intentionally NOT used: it is an opaque, process-local
//! monotonic counter (no `MAX`, no atomic repr, not the kernel TID), whereas every consumer in
//! this crate (`CriticalSection`, `ThreadLock`) needs a plain integer it can store in an atomic
//! and compare against a sentinel — exactly Zig's semantics.

// ── ThreadId width (mirrors Zig `std.Thread.Id` switch) ───────────────────
//   linux / *bsd / haiku / wasi / serenity → u32
//   macOS / iOS / watchOS / tvOS / visionOS → u64
//   Windows                                → DWORD (u32)
//   else                                   → usize
#[cfg(any(
    target_os = "linux",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "dragonfly",
    target_os = "haiku",
    target_os = "wasi",
    target_os = "windows",
))]
pub type ThreadId = u32;

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "watchos",
    target_os = "tvos",
    target_os = "visionos",
))]
pub type ThreadId = u64;

#[cfg(not(any(
    target_os = "linux",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "dragonfly",
    target_os = "haiku",
    target_os = "wasi",
    target_os = "windows",
    target_os = "macos",
    target_os = "ios",
    target_os = "watchos",
    target_os = "tvos",
    target_os = "visionos",
)))]
pub type ThreadId = usize;

// ── Atomic wrapper (Zig: `std.atomic.Value(Thread.Id)`) ───────────────────
// Width-matched alias so `CriticalSection` can `compare_exchange` on it directly.
#[cfg(any(
    target_os = "linux",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "dragonfly",
    target_os = "haiku",
    target_os = "wasi",
    target_os = "windows",
))]
pub type AtomicThreadId = core::sync::atomic::AtomicU32;

#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "watchos",
    target_os = "tvos",
    target_os = "visionos",
))]
pub type AtomicThreadId = core::sync::atomic::AtomicU64;

#[cfg(not(any(
    target_os = "linux",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd",
    target_os = "dragonfly",
    target_os = "haiku",
    target_os = "wasi",
    target_os = "windows",
    target_os = "macos",
    target_os = "ios",
    target_os = "watchos",
    target_os = "tvos",
    target_os = "visionos",
)))]
pub type AtomicThreadId = core::sync::atomic::AtomicUsize;

/// A value that does not alias any other thread ID.
/// See `Thread/Mutex/Recursive.zig` in the Zig standard library.
// Zig: `pub const invalid = std.math.maxInt(std.Thread.Id);`
pub const INVALID: ThreadId = ThreadId::MAX;

/// Returns the platform's notion of the calling thread's ID.
///
/// Port of Zig `std.Thread.getCurrentId()` (`PosixThreadImpl` / `WindowsThreadImpl` /
/// `LinuxThreadImpl`). Attempts to use OS-specific primitives so the value matches what
/// debuggers/tracers report; falls back to `pthread_self()` as a `usize` on unknown targets.
#[inline]
pub fn current() -> ThreadId {
    #[cfg(target_os = "linux")]
    {
        // Zig: `LinuxThreadImpl.getCurrentId()` → `linux.gettid()`.
        // SAFETY: `gettid` takes no arguments and cannot fail.
        return unsafe { libc::gettid() } as ThreadId;
    }
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "watchos",
        target_os = "tvos",
        target_os = "visionos",
    ))]
    {
        // Zig: `pthread_threadid_np(null, &thread_id)`.
        extern "C" {
            fn pthread_threadid_np(
                thread: *mut core::ffi::c_void,
                thread_id: *mut u64,
            ) -> core::ffi::c_int;
        }
        let mut id: u64 = 0;
        // SAFETY: passing null requests the current thread; `id` is a valid out-ptr.
        let rc = unsafe { pthread_threadid_np(core::ptr::null_mut(), &mut id) };
        debug_assert_eq!(rc, 0);
        return id;
    }
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetCurrentThreadId() -> u32; // kernel32 DWORD
        }
        // SAFETY: infallible Win32 intrinsic.
        return unsafe { GetCurrentThreadId() };
    }
    #[cfg(target_os = "freebsd")]
    {
        extern "C" {
            fn pthread_getthreadid_np() -> core::ffi::c_int;
        }
        // SAFETY: infallible.
        return unsafe { pthread_getthreadid_np() } as u32;
    }
    #[cfg(target_os = "netbsd")]
    {
        extern "C" {
            fn _lwp_self() -> core::ffi::c_int;
        }
        return unsafe { _lwp_self() } as u32;
    }
    #[cfg(target_os = "openbsd")]
    {
        extern "C" {
            fn getthrid() -> core::ffi::c_int;
        }
        return unsafe { getthrid() } as u32;
    }
    #[cfg(target_os = "dragonfly")]
    {
        extern "C" {
            fn lwp_gettid() -> core::ffi::c_int;
        }
        return unsafe { lwp_gettid() } as u32;
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd",
        target_os = "dragonfly",
        target_os = "windows",
        target_os = "macos",
        target_os = "ios",
        target_os = "watchos",
        target_os = "tvos",
        target_os = "visionos",
    )))]
    {
        // Zig fallback: `@intFromPtr(c.pthread_self())`.
        extern "C" {
            fn pthread_self() -> usize;
        }
        return unsafe { pthread_self() } as ThreadId;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/thread_id.zig (5 lines)
//               vendor/zig/lib/std/Thread.zig `Id` + `getCurrentId` (MOVE_DOWN from bun_threading)
//   confidence: high
//   todos:      0
//   notes:      Platform-width integer + atomic alias + OS-native `current()`; bun_threading
//               re-exports from here to break the T2→T0 back-edge.
// ──────────────────────────────────────────────────────────────────────────
