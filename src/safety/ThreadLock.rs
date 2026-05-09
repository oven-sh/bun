// Canonical impl lives in `bun_core::util` (lower-tier; `&self` + atomic shape
// required by `bun_ptr::RefCount` and `bun_threading::RawMutex`). Re-export so
// `bun_safety::ThreadLock` callers keep working.
pub use bun_core::{ThreadLock, ThreadLockGuard};

// TODO(port): `bun.Environment.ci_assert` cfg mapping. Spec gates the payload
// on `ci_assert`; the canonical currently gates on `debug_assertions`. Once a
// `ci_assert` feature is plumbed into `bun_core`, switch the gate there and
// have this const follow it.
pub(crate) const ENABLED: bool = cfg!(feature = "ci_assert");

// ported from: src/safety/ThreadLock.zig
