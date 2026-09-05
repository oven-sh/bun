#![warn(unused_must_use)]
#![forbid(unsafe_code)]

// `ThreadLock` and `thread_id` live in `bun_core` (tier-0) so `bun_ptr` /
// `bun_threading` can use them without an upward dep. Re-exported here for
// `bun_safety::*` callers.
pub use bun_core::thread_id;
pub use bun_core::{ThreadLock, ThreadLockGuard};
