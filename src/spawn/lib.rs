//! `bun_spawn` — process-spawn implementation, extracted so that
//! `bun_install`, `bun_jsc`, and
//! `bun_patch` can construct/track child processes without depending on
//! `bun_runtime` (cycle: `bun_runtime → bun_install`/`bun_jsc`).
//!
//! LAYERING: this crate **owns** the spawn implementation (not just data
//! shapes). `Process`, `Poller`, `WaiterThread`, `spawn_process`, and
//! `sync::spawn` were MOVED DOWN here from `bun_runtime::api::bun::process`;
//! `bun_runtime` re-exports them. The only non-leaf dependencies are
//! `bun_io` (`FilePoll`/`KeepAlive`/`EventLoopCtx`), `bun_ptr`
//! (`ThreadSafeRefCount`), `bun_io` (`BufferedWriter`), `bun_event_loop`,
//! `bun_threading`, and on Windows `bun_iocp` — none of which depend back on this crate, so no cycle.

// ──────────────────────────────────────────────────────────────────────────
// Module layout
// ──────────────────────────────────────────────────────────────────────────

/// Ctrl+C handling for a process acting as a shell for foreground children.
#[path = "ctrl_c.rs"]
pub mod ctrl_c;
/// `Process` / `Poller` / `WaiterThread` / `spawn_process` / `sync` /
/// `Status` / `SpawnOptions` / `SpawnResult`.
#[path = "process.rs"]
pub mod process;

/// Generic `StaticPipeWriter<S>`.
#[path = "static_pipe_writer.rs"]
pub mod static_pipe_writer;

pub mod error;
pub use error::{Error, Result};

// ──────────────────────────────────────────────────────────────────────────
// Public surface — re-exports under the names mid-tier callers already use.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopHandle;

// Raw OS-spawn types from the leaf -sys crate.
pub use bun_spawn_sys::ffi;

pub use bun_spawn_sys::RusageFields;
#[cfg(unix)]
pub use bun_spawn_sys::posix_spawn::posix_spawn::LARGEST_REAPED_CHILD;
pub use process::{
    Dup2, Exited, ExtraPipe, PidT, Process, ProcessHandle, Rusage, SpawnOptions, SpawnResult,
    SpawnResultExt, Status, Stdio, StdioKind, spawn_process, spawn_process_z,
};

// Variant types live in `bun_runtime`/`bun_install`; each provides its body
// via `bun_spawn::link_impl_ProcessExit!`. Adding a handler kind = add a
// variant here + one `link_impl_ProcessExit!` in the owning crate.
bun_dispatch::link_interface! {
    pub ProcessExit[
        Subprocess,
        LifecycleScript,
        InstallGit,
        SecurityScan,
        Shell,
        FilterRunHandle,
        MultiRunHandle,
        TestParallelWorker,
        Cron,
        ChromeProcess,
        HostProcess,
    ] {
        fn on_process_exit(status: Status, rusage: &Rusage);
    }
}

/// `None` = no handler set (the default for `Process::exit_handler`).
pub type ProcessExitHandler = Option<ProcessExit>;

#[cfg(unix)]
pub use process::WaitPidResult;

/// Blocking (synchronous) spawn helpers.
pub mod sync {
    pub use crate::process::sync::{Options, Result, SyncStdio as Stdio, spawn};
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.jsc.Subprocess` cross-tier shapes — `StdioResult`, `StaticPipeWriter<S>`.
//
// MOVE_DOWN from `bun_runtime::api::bun::subprocess`: `bun_install::
// security_scanner` constructs a `StaticPipeWriter<Box<[u8]>>` to
// stream a JSON blob to the scanner's fd 4.
// ──────────────────────────────────────────────────────────────────────────
pub mod subprocess {
    pub use crate::static_pipe_writer::{PipeState, StaticPipeWriter};

    pub type StdioResult = Option<bun_sys::File>;
}
