//! bun_threading crate root — thin re-exports mirroring `src/threading/threading.zig`.

// ──────────────────────────────────────────────────────────────────────────
// Phase B-1 gate-and-stub: modules whose Phase-A draft bodies do not yet
// compile on stable are gated behind `#[cfg(any())]` (preserving source) and
// replaced with minimal stub surfaces below. Un-gating happens in B-2.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
#[path = "Mutex.rs"]
pub mod mutex;
#[cfg(any())]
#[path = "Futex.rs"]
pub mod futex;
#[cfg(any())]
#[path = "Condition.rs"]
pub mod condition;
#[cfg(any())]
#[path = "ThreadPool.rs"]
pub mod thread_pool;
#[cfg(any())]
pub mod channel;
#[cfg(any())]
pub mod work_pool;

pub mod guarded;
#[path = "WaitGroup.rs"]
pub mod wait_group;
pub mod unbounded_queue;

// ─── stub modules (B-1) ───────────────────────────────────────────────────

#[cfg(not(any()))]
pub mod mutex {
    /// Stub for `bun_threading::Mutex`. Real impl gated in `Mutex.rs`.
    #[derive(Default)]
    pub struct Mutex(());
    impl Mutex {
        pub fn lock(&self) {
            todo!("b1-stub: Mutex::lock")
        }
        pub fn unlock(&self) {
            todo!("b1-stub: Mutex::unlock")
        }
    }
}

#[cfg(not(any()))]
pub mod futex {
    /// Stub namespace for `bun_threading::Futex`. Real impl gated in `Futex.rs`.
    pub struct Futex;
}

#[cfg(not(any()))]
pub mod condition {
    /// Stub for `bun_threading::Condition`. Real impl gated in `Condition.rs`.
    #[derive(Default)]
    pub struct Condition(());
    impl Condition {
        pub fn wait(&self, _mutex: &crate::Mutex) {
            todo!("b1-stub: Condition::wait")
        }
        pub fn signal(&self) {
            todo!("b1-stub: Condition::signal")
        }
        pub fn broadcast(&self) {
            todo!("b1-stub: Condition::broadcast")
        }
    }
}

#[cfg(not(any()))]
pub mod thread_pool {
    /// Stub for `bun_threading::ThreadPool`. Real impl gated in `ThreadPool.rs`.
    pub struct ThreadPool(());
}

#[cfg(not(any()))]
pub mod channel {
    /// Stub for `bun_threading::Channel`. Real impl gated in `channel.rs`.
    // TODO(b1): bun_collections::LinearFifo / LinearFifoBufferType missing from lower-tier stub surface
    pub struct Channel<T>(core::marker::PhantomData<T>);
}

// ─── re-exports ───────────────────────────────────────────────────────────

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
