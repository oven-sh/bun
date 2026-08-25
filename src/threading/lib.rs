//! bun_threading crate root — thin re-exports.
#![feature(thread_local)]

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
pub mod task_group;
pub mod keep_alive;
pub mod thread_bound;
#[path = "ThreadPool.rs"]
pub mod thread_pool;
pub mod thread_slots;
pub mod work_pool;

pub mod guarded;
pub mod job_batch;
pub mod unbounded_queue;
#[path = "WaitGroup.rs"]
pub mod wait_group;

// ─── re-exports ───────────────────────────────────────────────────────────

pub use channel::Channel;
pub use condition::{Condition, Condvar};
/// `Futex` re-exported as a capitalized module alias so callers can write
/// `Futex::wait`, `Futex::wake`, `Futex::Deadline`.
pub use futex as Futex;
pub use guarded::{Guarded, GuardedLock};
pub use job_batch::{BatchJob, JobBatch};
pub use mutex::{Mutex, MutexGuard};
pub use reset_event::ResetEvent;
pub use rwlock::RwLock;
pub use semaphore::Semaphore;
pub use task_group::{GroupTask, GroupedTask, TaskGroup};
pub use keep_alive::KeepAlive;
pub use thread_bound::ThreadBound;
pub use thread_pool::{ThreadPool, ThreadRef};
pub use thread_slots::{SlotGuard, ThreadSlots};
pub use unbounded_queue::{Link, Linked, OwnedDrain, OwnedQueue, UnboundedQueue};
pub use wait_group::WaitGroup;
pub use work_pool::Task as WorkPoolTask;
pub use work_pool::{IntrusiveWorkTask, OwnedTask, WorkPool};

/// Returns a non-zero OS thread id.
/// Used by `Mutex` debug deadlock detection and `Condition` (Windows).
///
/// Delegates to the tier-0 implementation in
/// [`bun_safety::thread_id::current`] (which uses `pthread_threadid_np` on
/// Darwin / `pthread_getthreadid_np` on FreeBSD / `gettid` on Linux),
/// widened to `u64` so callers can store it
/// in an `AtomicU64` regardless of the platform's native `ThreadId` width.
#[inline]
pub fn current_thread_id() -> u64 {
    bun_safety::thread_id::current() as u64
}
