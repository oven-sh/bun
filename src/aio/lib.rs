#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod stub_event_loop;

// ────────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: the Phase-A draft bodies below depend on lower-tier
// symbols that are themselves still gated (bun_sys::windows, bun_sys::linux,
// bun_output, bun_threading::WorkPool, bun_collections::TaggedPtrUnion,
// bun_core::env_var, bun_str). Preserve the drafts behind cfg(any()) and
// expose a minimal stub surface so dependents can name the types. Un-gating
// happens in B-2 once the lower tiers are real.
// ────────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod windows_event_loop;
#[cfg(any())]
#[path = "ParentDeathWatchdog.rs"]
pub mod parent_death_watchdog_draft;
#[cfg(any())]
pub mod posix_event_loop;

// ─── stub surface ───────────────────────────────────────────────────────────

pub use stub_event_loop::{FilePoll, KeepAlive, Loop};

/// TODO(b1): real impl in posix_event_loop / windows_event_loop.
pub struct Closer;
/// TODO(b1): real impl in posix_event_loop.
pub struct Waker;

/// TODO(b1): mirrors posix_event_loop::Flags / FlagsSet.
pub type PollFlag = u32;
/// TODO(b1): mirrors posix_event_loop poll kind enum used by process.rs.
pub type PollKind = u32;

/// Stub `file_poll` module — real one lives in posix_event_loop.rs.
pub mod file_poll {
    pub use super::stub_event_loop::FilePoll;
    /// TODO(b1): HiveArray-backed store of FilePoll.
    pub struct Store;
    /// TODO(b1): bitflags enum (WasEverRegistered, Socket, …).
    pub type Flag = u32;
    pub type Flags = u32;
    pub type FlagsSet = u32;
}

/// Stub `ParentDeathWatchdog` module + type.
pub mod ParentDeathWatchdog {
    pub struct ParentDeathWatchdog;
    pub fn is_enabled() -> bool {
        // TODO(b1): bun_core::env_var missing from lower tier
        false
    }
    pub fn install() {
        todo!("B-2: ParentDeathWatchdog::install")
    }
    pub fn enable() {
        todo!("B-2: ParentDeathWatchdog::enable")
    }
}
pub use ParentDeathWatchdog as parent_death_watchdog;
