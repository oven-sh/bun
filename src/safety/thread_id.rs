//! Re-export of the canonical OS thread-id ladder, sunk into tier-0
//! `bun_core` so `bun_core::ThreadLock` / `ThreadCell` share the impl.
pub use bun_core::thread_id::{current, AtomicThreadId, ThreadId, INVALID};

// ported from: src/safety/thread_id.zig
