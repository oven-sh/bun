//! bun_threading crate root — thin re-exports mirroring `src/threading/threading.zig`.

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

#[inline]
pub fn current_thread_id() -> u64 {
    bun_safety::thread_id::current() as u64
}

// ported from: src/threading/threading.zig
