#![warn(unused_must_use)]

// `ThreadLock` and `thread_id` live in `bun_core` (tier-0) so `bun_ptr` /
// `bun_threading` can use them without an upward dep. Re-exported here for
// `bun_safety::*` callers.
pub use bun_core::thread_id;
pub use bun_core::{ThreadLock, ThreadLockGuard};

// ──────────────────────────────────────────────────────────────────────────
// Allocator-identity registry (storage moved DOWN — data, not fn-ptrs).
//
// Low-tier `bun_safety` cannot name higher-tier allocator types
// (`MimallocArena`, `LinuxMemFdAllocator`, `MaxHeapAllocator`,
// `CachedBytecode`, `bundle_v2`, `heap_breakdown::Zone`)
// directly. Instead of an erased fn-ptr hook, those crates push their
// `&'static AllocatorVTable` addresses here at init; `alloc::has_ptr` then
// does a plain pointer-equality scan (vtable identity), with the *data* moved
// down rather than the *code* called up.
// ──────────────────────────────────────────────────────────────────────────
