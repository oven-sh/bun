#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
#![allow(static_mut_refs)]
// AUTOGEN: mod declarations only — real exports added in B-1.

#![warn(unreachable_pub)]
pub mod stub_event_loop;

// ────────────────────────────────────────────────────────────────────────────
// B-2 un-gated: posix_event_loop + ParentDeathWatchdog compile on unix.
// windows_event_loop is platform-gated (was cfg(any())); it remains blocked
// on bun_sys::windows::libuv on its target platform.
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub mod windows_event_loop;

// ParentDeathWatchdog is POSIX-only (uses `libc::pid_t`, `getppid`, signals);
// Windows handles orphan death via Job Objects in `spawn`.
#[cfg(not(windows))]
#[path = "ParentDeathWatchdog.rs"]
pub mod parent_death_watchdog;
#[cfg(not(windows))]
pub use parent_death_watchdog as ParentDeathWatchdog;

// `posix_event_loop` also defines the *shared* event-loop scaffolding
// (`EventLoopCtx`, `AllocatorType`, `Owner`, `Flags`, `PollTag`, `Store`,
// `OpaqueCallback`); `windows_event_loop` re-uses those types and only
// overrides `FilePoll`/`KeepAlive`/`Closer`/`Loop`/`Waker`. The platform-
// specific bits inside (kqueue/epoll wakers, fd polling) are individually
// `#[cfg(unix)]`-gated so the module still compiles on Windows.
pub mod posix_event_loop;

// ─── public surface ─────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub use posix_event_loop::{Closer, FilePoll, KeepAlive, Loop, Waker};
#[cfg(windows)]
pub use windows_event_loop::{Closer, FilePoll, KeepAlive, Loop, Waker};

pub use posix_event_loop::{
    AllocatorType, EventLoopCtx, EventLoopCtxVTable, OpaqueCallback, Owner, PollTag,
};
#[cfg(not(windows))]
pub use posix_event_loop::Store;
#[cfg(windows)]
pub use windows_event_loop::Store;

/// Mirrors posix_event_loop::Flags.
pub use posix_event_loop::Flags as PollFlag;
/// Mirrors poll kind enum used by process.rs.
pub use posix_event_loop::Flags as PollKind;

/// `file_poll` module — real one lives in {posix,windows}_event_loop.rs.
pub mod file_poll {
    pub use super::FilePoll;
    pub use super::Store;
    pub use super::posix_event_loop::{Flags, Flags as Flag, FlagsSet};
    /// Kqueue/epoll watch kind passed to `FilePoll::register`.
    pub type Pollable = Flags;
}
