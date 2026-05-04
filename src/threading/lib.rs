//! bun_threading crate root — thin re-exports mirroring `src/threading/threading.zig`.

#[path = "Mutex.rs"]
pub mod mutex;
#[path = "Futex.rs"]
pub mod futex;
#[path = "Condition.rs"]
pub mod condition;
pub mod guarded;
#[path = "WaitGroup.rs"]
pub mod wait_group;
#[path = "ThreadPool.rs"]
pub mod thread_pool;
pub mod channel;
pub mod unbounded_queue;

pub use mutex::Mutex;
pub use futex::Futex;
pub use condition::Condition;
pub use guarded::Guarded;
pub use guarded::GuardedBy;
pub use guarded::Debug as DebugGuarded;
pub use wait_group::WaitGroup;
pub use thread_pool::ThreadPool;
pub use channel::Channel;
pub use unbounded_queue::UnboundedQueue;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/threading.zig (11 lines)
//   confidence: high
//   todos:      0
//   notes:      crate root; #[path] attrs assume sibling .rs filenames match .zig basenames per PORTING.md
// ──────────────────────────────────────────────────────────────────────────
