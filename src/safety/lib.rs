pub mod alloc;
pub use alloc::CheckedAllocator;

mod critical_section;
pub use critical_section::CriticalSection;

mod thread_lock;
pub use thread_lock::ThreadLock;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/safety.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; sibling modules ported separately
// ──────────────────────────────────────────────────────────────────────────
