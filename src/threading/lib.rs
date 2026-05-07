//! bun_threading crate root — thin re-exports mirroring `src/threading/threading.zig`.

#[path = "Mutex.rs"]
pub mod mutex;
#[path = "Futex.rs"]
pub mod futex;
#[path = "Condition.rs"]
pub mod condition;
#[path = "ThreadPool.rs"]
pub mod thread_pool;
pub mod channel;
pub mod work_pool;

pub mod guarded;
#[path = "WaitGroup.rs"]
pub mod wait_group;
pub mod unbounded_queue;

// ─── re-exports ───────────────────────────────────────────────────────────

pub use mutex::{Mutex, MutexGuard};
/// `Futex` re-exported as a capitalized module alias so callers can write
/// `Futex::wait`, `Futex::wake`, `Futex::Deadline` matching the Zig namespace.
pub use futex as Futex;
pub use condition::Condition;
pub use guarded::Guarded;
pub use guarded::GuardedBy;
pub use guarded::Debug as DebugGuarded;
pub use wait_group::WaitGroup;
pub use thread_pool::ThreadPool;
/// Zig: `bun.jsc.WorkPoolTask` = `ThreadPool.Task` (work_pool.zig:2).
pub use work_pool::Task as WorkPoolTask;
pub use channel::Channel;
pub use unbounded_queue::UnboundedQueue;

/// Port of `std.Thread.getCurrentId()` — returns a non-zero OS thread id.
/// Used by `Mutex` debug deadlock detection and `Condition` (Windows).
#[inline]
pub fn current_thread_id() -> u64 {
    // PORT NOTE: stable Rust has no `std::thread::ThreadId::as_u64()`; use the
    // platform tid directly. 0 is reserved as "not locked" sentinel in DebugImpl.
    #[cfg(target_os = "linux")]
    // SAFETY: gettid has no preconditions.
    unsafe {
        libc::gettid() as u64
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    // SAFETY: pthread_self has no preconditions.
    unsafe {
        libc::pthread_self() as u64
    }
    #[cfg(windows)]
    // SAFETY: GetCurrentThreadId has no preconditions.
    unsafe {
        bun_sys::windows::kernel32::GetCurrentThreadId() as u64
    }
    #[cfg(not(any(unix, windows)))]
    {
        0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/threading.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      crate root; #[path] attrs assume sibling .rs filenames match .zig basenames per PORTING.md
// ──────────────────────────────────────────────────────────────────────────
