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
//! `bun_threading`, and `bun_crash_handler` — none of which depend back on
//! this crate, so no cycle.

// ──────────────────────────────────────────────────────────────────────────
// Module layout
// ──────────────────────────────────────────────────────────────────────────

/// posix_spawn(2) FFI wrappers (Actions / Attr / spawn_z / wait4).
/// MOVE_DOWN: implementation now lives in `bun_spawn_sys`; re-exported here
/// with the higher-tier `process::*` glue (`Process`/`Status`/`spawn_process`/
/// `sync`) restored so existing `bun_spawn::posix_spawn::bun_spawn::*` paths
/// keep resolving.
pub mod posix_spawn {
    pub use bun_spawn_sys::posix_spawn::*;

    pub mod bun_spawn {
        pub use crate::process;
        pub use crate::process::{
            Process, SpawnOptions, SpawnProcessResult, Status, spawn_process, sync,
        };
        #[cfg(windows)]
        pub use crate::process::{WindowsSpawnOptions, WindowsSpawnResult};
        pub use bun_spawn_sys::posix_spawn::bun_spawn::*;
    }
}

/// Ctrl+C handling for a process acting as a shell for foreground children.
#[path = "ctrl_c.rs"]
pub mod ctrl_c;
/// `Process` / `Poller` / `WaiterThread` / `spawn_process` / `sync` /
/// `Status` / `SpawnOptions` / `SpawnResult`.
#[path = "process.rs"]
pub mod process;

/// Generic `StaticPipeWriter<P>`.
#[path = "static_pipe_writer.rs"]
pub mod static_pipe_writer;

pub mod error;
pub use error::{Error, Result};

// ──────────────────────────────────────────────────────────────────────────
// Public surface — re-exports under the names mid-tier callers already use.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopHandle;

// Raw OS-spawn types from the leaf -sys crate.
pub use bun_spawn_sys::{Argv, CStrPtr, Envp, ffi};

pub use bun_spawn_sys::RusageFields;
pub use process::{
    Dup2, Exited, ExtraPipe, PidT, Poller, Process, ProcessHandle, Rusage, SignalCodeExt, SpawnEnv,
    SpawnOptions, SpawnProcessResult, SpawnResultExt, Status, StdioKind, WaiterThread,
    spawn_process, spawn_process_cstr,
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
        fn on_process_exit(process: &mut Process, status: Status, rusage: &Rusage);
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
        on_process_exit(process, status, rusage) =>
            process::sync::SyncWindowsProcess::on_process_exit(this, process, status, &*rusage),
    }
}
#[cfg(not(windows))]
link_impl_ProcessExit! {
    SyncWindows for process::SyncProcessPosix => |_this| {
        on_process_exit(_process, _status, _rusage) =>
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
#[cfg(windows)]
pub mod windows {
    /// `bun.windows.libuv.Pipe` raw pointer payload of `Stdio::Buffer` /
    /// `Stdio::Ipc`. Erased so this crate stays libuv-agnostic at the type
    /// surface; `bun_runtime` casts it back on consumption.
    pub type UvPipePtr = *mut bun_sys::windows::libuv::Pipe;
}

/// Blocking (synchronous) spawn helpers.
pub mod sync {
    #[cfg(windows)]
    pub use crate::process::WindowsOptions;
    pub use crate::process::sync::{Options, Result, SyncStdio as Stdio, spawn, spawn_with_argv};
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.jsc.Subprocess` cross-tier shapes — `Source`, `StdioResult`,
// `StaticPipeWriter<P>`.
//
// MOVE_DOWN from `bun_runtime::api::bun::subprocess`: `bun_install::
// security_scanner` constructs a `StaticPipeWriter<SecurityScanSubprocess>` to
// stream a JSON blob to the scanner's stdin. The `Source` enum here carries a
// `Box<dyn SourceData>` arm (§Dispatch cold path — vtable travels with the
// value) so the JSC tier can wrap `Blob`/`ArrayBuffer` payloads without this
// crate naming `bun_jsc`/`bun_runtime`.
// ──────────────────────────────────────────────────────────────────────────
pub mod subprocess {
    #[cfg(not(windows))]
    use bun_sys::Fd;

    pub use crate::process::StdioKind;
    pub use crate::static_pipe_writer::{StaticPipeWriter, StaticPipeWriterProcess};

    /// On POSIX this is `Option<Fd>`; on Windows it is the `WindowsStdioResult` union.
    #[cfg(not(windows))]
    pub type StdioResult = Option<Fd>;
    #[cfg(windows)]
    pub type StdioResult = crate::process::WindowsStdioResult;

    #[cfg(not(windows))]
    #[inline]
    pub fn stdio_result_from_fd(fd: Fd) -> StdioResult {
        Some(fd)
    }

    /// The in-memory payload that a
    /// `StaticPipeWriter` drains into the child's stdin/extra-fd.
    ///
    /// `Blob`/`ArrayBuffer` payloads are JSC-owned and unreachable at this
    /// tier, so the high-tier
    /// variants are carried via a `Box<dyn SourceData>` (per-object vtable —
    /// §Dispatch cold path). `bun_install` uses [`Source::from_owned_bytes`].
    pub enum Source {
        OwnedBytes(Box<[u8]>),
        Any(Box<dyn SourceData>),
        Detached,
    }

    /// Type-erased payload for [`Source::Any`]. JSC-tier callers implement it
    /// for `webcore::AnyBlob`. The vtable travels with the value, so no global
    /// hook registration is needed.
    pub trait SourceData {
        fn slice(&self) -> &[u8];
        fn detach(&mut self);
        fn memory_cost(&self) -> usize {
            0
        }
    }

    impl Source {
        #[inline]
        pub fn from_owned_bytes(bytes: Box<[u8]>) -> Self {
            Self::OwnedBytes(bytes)
        }

        pub(crate) fn slice(&self) -> &[u8] {
            match self {
                Source::OwnedBytes(b) => b,
                Source::Any(s) => s.slice(),
                // slice() after detach() is a bug.
                Source::Detached => unreachable!("Source::slice on Detached"),
            }
        }

        /// Release the payload and flip to
        /// `Detached`. Calling `slice()` afterwards is invalid (panics).
        pub fn detach(&mut self) {
            if let Source::Any(s) = self {
                s.detach();
            }
            *self = Source::Detached;
        }

        pub(crate) fn memory_cost(&self) -> usize {
            match self {
                Source::OwnedBytes(b) => b.len(),
                Source::Any(s) => s.memory_cost(),
                Source::Detached => 0,
            }
        }
    }
}
