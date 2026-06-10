// Canonical impl lives in `bun_core::util` (lower-tier; `&self` + atomic shape
// required by `bun_ptr::RefCount` and `bun_threading::RawMutex`). Re-export so
// `bun_safety::ThreadLock` callers keep working.
pub use bun_core::{ThreadLock, ThreadLockGuard};
