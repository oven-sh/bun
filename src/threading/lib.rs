//! bun_threading crate root — thin re-exports mirroring `src/threading/threading.zig`.

#![warn(unreachable_pub)]
pub mod channel;
#[path = "Condition.rs"]
pub mod condition;
#[path = "Futex.rs"]
pub mod futex;
#[path = "Mutex.rs"]
pub mod mutex;
#[path = "ResetEvent.rs"]
pub mod reset_event;
#[path = "RwLock.rs"]
pub mod rwlock;
#[path = "Semaphore.rs"]
pub mod semaphore;
#[path = "ThreadPool.rs"]
pub mod thread_pool;
pub mod work_pool;

pub mod guarded;
pub mod unbounded_queue;
#[path = "WaitGroup.rs"]
pub mod wait_group;

// ─── re-exports ───────────────────────────────────────────────────────────

pub use channel::Channel;
pub use condition::{Condition, Condvar};
/// `Futex` re-exported as a capitalized module alias so callers can write
/// `Futex::wait`, `Futex::wake`, `Futex::Deadline` matching the Zig namespace.
pub use futex as Futex;
pub use guarded::Debug as DebugGuarded;
pub use guarded::RawMutex;
pub use guarded::{Guarded, GuardedBy, GuardedLock};
pub use mutex::{Mutex, MutexGuard};
pub use reset_event::ResetEvent;
pub use rwlock::{RwLock, RwLockReadGuard, RwLockWriteGuard};
pub use semaphore::Semaphore;
/// `parking_lot::Once` parity. Bun has no custom `Once` (Zig also uses
/// `std.once` directly), and `std::sync::Once` has no poisoning concern, so
/// just re-export it for callers migrating off `parking_lot::Once`.
pub use std::sync::Once;
pub use thread_pool::ThreadPool;
pub use unbounded_queue::{Link, Linked, UnboundedQueue};
pub use wait_group::WaitGroup;
/// Zig: `bun.jsc.WorkPoolTask` = `ThreadPool.Task` (work_pool.zig:2).
pub use work_pool::Task as WorkPoolTask;
pub use work_pool::{IntrusiveWorkTask, OwnedTask, WorkPool};

/// Port of `std.Thread.getCurrentId()` — returns a non-zero OS thread id.
/// Used by `Mutex` debug deadlock detection and `Condition` (Windows).
///
/// Delegates to the spec-faithful tier-0 implementation in
/// [`bun_safety::thread_id::current`] (which uses `pthread_threadid_np` on
/// Darwin / `pthread_getthreadid_np` on FreeBSD / `gettid` on Linux, matching
/// Zig `std.Thread.getCurrentId()`), widened to `u64` so callers can store it
/// in an `AtomicU64` regardless of the platform's native `ThreadId` width.
#[inline]
pub fn current_thread_id() -> u64 {
    bun_safety::thread_id::current() as u64
}

// ported from: src/threading/threading.zig
