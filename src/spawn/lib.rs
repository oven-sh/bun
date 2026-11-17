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
//! and `bun_threading` — none of which depend back on this crate, so no cycle.

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
    Dup2, Exited, ExtraPipe, PidT, Process, ProcessHandle, Rusage, SpawnOptions,
    SpawnProcessResult, SpawnResultExt, Status, StdioKind, spawn_process, spawn_process_z,
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
        CronRegister,
        CronRemove,
        ChromeProcess,
        HostProcess,
        SyncWindows,
    ] {
        fn on_process_exit(status: Status, rusage: &Rusage);
    }
}

/// `None` = no handler set (the default for `Process::exit_handler`).
pub type ProcessExitHandler = Option<ProcessExit>;

// In-crate `link_impl_*!` calls must be textually after the `link_interface!`
// that emits the macro (`#[macro_export]` is path-addressable from *other*
// crates only; same-crate use is textual-scope). POSIX `spawn_sync` waits
// inline and never installs a handler, so the `SyncWindows` arm is genuinely
// unreachable there — but every variant needs a body or the link fails.
#[cfg(windows)]
link_impl_ProcessExit! {
    SyncWindows for process::sync::SyncWindowsProcess => |this| {
        on_process_exit(status, _rusage) =>
            process::sync::SyncWindowsProcess::on_process_exit(this, status),
    }
}
#[cfg(not(windows))]
link_impl_ProcessExit! {
    SyncWindows for process::SyncProcessPosix => |_this| {
        on_process_exit(_status, _rusage) =>
            unreachable!("SyncWindows exit handler is Windows-only"),
    }
}
#[cfg(unix)]
pub use process::{PosixSpawnOptions, PosixSpawnResult, PosixStdio as Stdio, WaitPidResult};
#[cfg(unix)]
pub type SpawnResult = process::PosixSpawnResult;

#[cfg(windows)]
pub use process::{
    WindowsOptions, WindowsSpawnOptions, WindowsSpawnResult, WindowsStdio as Stdio,
    WindowsStdioResult as SpawnedStdio,
};
#[cfg(windows)]
pub type SpawnResult = process::WindowsSpawnResult;

/// Blocking (synchronous) spawn helpers.
pub mod sync {
    #[cfg(windows)]
    pub use crate::process::WindowsOptions;
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

    #[cfg(not(windows))]
    pub type StdioResult = Option<bun_sys::File>;
    #[cfg(windows)]
    pub type StdioResult = crate::process::WindowsStdioResult;
}
