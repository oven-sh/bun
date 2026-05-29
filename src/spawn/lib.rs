//! `bun_spawn` — process-spawn implementation extracted from
//! `src/runtime/api/bun/process.zig` so that `bun_install`, `bun_jsc`, and
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
//!
//! Zig source of truth: `src/runtime/api/bun/process.zig`,
//! `src/runtime/api/bun/spawn.zig`,
//! `src/runtime/api/bun/subprocess/StaticPipeWriter.zig`.

use core::ffi::c_char;

// ──────────────────────────────────────────────────────────────────────────
// Module layout
// ──────────────────────────────────────────────────────────────────────────

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
    pub use bun_spawn as BunSpawn;
    pub use bun_spawn_sys::posix_spawn::posix_spawn as PosixSpawn;
}

/// `Process` / `Poller` / `WaiterThread` / `spawn_process` / `sync` /
/// `Status` / `SpawnOptions` / `SpawnResult`. Port of
/// `src/runtime/api/bun/process.zig`.
#[path = "process.rs"]
pub mod process;

/// Generic `StaticPipeWriter<P>` (`jsc.Subprocess.NewStaticPipeWriter`).
/// Port of `src/runtime/api/bun/subprocess/StaticPipeWriter.zig`.
#[path = "static_pipe_writer.rs"]
pub mod static_pipe_writer;

// ──────────────────────────────────────────────────────────────────────────
// Public surface — re-exports under the names mid-tier callers already use.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopHandle;

// Raw OS-spawn types from the leaf -sys crate.
pub use bun_spawn_sys::{Argv, CStrPtr, Envp, ffi};

pub use bun_spawn_sys::RusageFields;
pub use process::{
    Dup2, Exited, ExtraPipe, PidT, Poller, Process, Rusage, SignalCodeExt, SpawnOptions,
    SpawnProcessResult, SpawnResultExt, Status, StdioKind, WaiterThread, spawn_process,
};

// Variant types live in `bun_runtime`/`bun_install`; each provides its body
// via `bun_spawn::link_impl_ProcessExit!`. Adding a handler kind = add a
// variant here + one `link_impl_ProcessExit!` in the owning crate.
bun_dispatch::link_interface! {
    pub ProcessExit[
        Subprocess,
        LifecycleScript,
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
/// Compat re-export: the `process::spawn_sys` shim module was dissolved into
/// `bun_sys` (LAYERING — moved down so non-spawn callers don't depend on
/// `bun_spawn`). Downstream `runtime/api/bun/*` still spells the old path.
pub use bun_sys as spawn_sys;

#[cfg(unix)]
pub use process::{PosixSpawnOptions, PosixSpawnResult, PosixStdio as Stdio, WaitPidResult};
#[cfg(unix)]
pub type SpawnResult = process::PosixSpawnResult;
/// Alias for the per-extra-fd Stdio entry passed in `SpawnOptions::extra_fds`.
#[cfg(unix)]
pub type ExtraFd = process::PosixStdio;

#[cfg(windows)]
pub use process::{
    WindowsOptions, WindowsSpawnOptions, WindowsSpawnResult, WindowsStdio as Stdio,
    WindowsStdioResult as SpawnedStdio,
};
#[cfg(windows)]
pub type SpawnResult = process::WindowsSpawnResult;
#[cfg(windows)]
pub type ExtraFd = process::WindowsStdio;
#[cfg(windows)]
pub mod windows {
    /// `bun.windows.libuv.Pipe` raw pointer payload of `Stdio::Buffer` /
    /// `Stdio::Ipc`. Erased so this crate stays libuv-agnostic at the type
    /// surface; `bun_runtime` casts it back on consumption.
    pub type UvPipePtr = *mut bun_sys::windows::libuv::Pipe;
}

/// `bun.spawnSync` (process.zig `pub const sync`).
pub mod sync {
    #[cfg(windows)]
    pub use crate::process::WindowsOptions;
    pub use crate::process::sync::{Options, Result, SyncStdio as Stdio, spawn, spawn_with_argv};
    #[cfg(not(windows))]
    pub type WindowsOptions = ();
}

pub mod subprocess {
    use bun_sys::Fd;

    pub use crate::process::StdioKind;
    pub use crate::static_pipe_writer::{StaticPipeWriter, StaticPipeWriterProcess};

    /// Port of `bun.jsc.Subprocess.StdioResult` (subprocess.zig). On POSIX the
    /// Zig type is `?bun.FD`; on Windows it is the `WindowsStdioResult` union.
    #[cfg(not(windows))]
    pub type StdioResult = Option<Fd>;
    #[cfg(windows)]
    pub type StdioResult = crate::process::WindowsStdioResult;

    #[cfg(not(windows))]
    #[inline]
    pub fn stdio_result_from_fd(fd: Fd) -> StdioResult {
        Some(fd)
    }
    #[cfg(windows)]
    #[inline]
    pub fn stdio_result_from_fd(fd: Fd) -> StdioResult {
        crate::process::WindowsStdioResult::BufferFd(fd)
    }

    pub enum Source {
        OwnedBytes(Box<[u8]>),
        Any(Box<dyn SourceData>),
        Detached,
    }

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

        /// Zig: `Source.slice()`.
        pub fn slice(&self) -> &[u8] {
            match self {
                Source::OwnedBytes(b) => b,
                Source::Any(s) => s.slice(),
                // Zig: `else => @panic("Invalid source")` — slice() after detach() is a bug.
                Source::Detached => unreachable!("Source::slice on Detached"),
            }
        }

        /// Zig: `Source.detach()` — release the payload and flip to
        /// `.Detached`. Calling `slice()` afterwards is invalid (panics).
        pub fn detach(&mut self) {
            if let Source::Any(s) = self {
                s.detach();
            }
            *self = Source::Detached;
        }

        pub fn memory_cost(&self) -> usize {
            match self {
                Source::OwnedBytes(b) => b.len(),
                Source::Any(s) => s.memory_cost(),
                Source::Detached => 0,
            }
        }
    }
}

/// Port of `std.process.Child.Term`.
#[derive(Clone, Copy, Debug)]
pub enum Term {
    Exited(u32),
    Signal(u32),
    Stopped(u32),
    Unknown(u32),
}

/// Options for [`run`] — port of `std.process.Child.RunOptions` (subset used
/// by `repository.zig`).
#[derive(Clone, Copy)]
pub struct RunOptions<'a> {
    pub argv: &'a [&'a [u8]],
    pub env_map: &'a bun_sys::EnvMap,
}

/// Result of [`run`] — port of `std.process.Child.RunResult`.
pub struct RunResult {
    pub term: Term,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[cfg_attr(windows, allow(unreachable_code, unused_variables, unused_mut))]
pub fn run(opts: RunOptions<'_>) -> core::result::Result<RunResult, bun_core::Error> {
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        // `std.process.Child.spawnWindows` decodes argv as WTF-8 → WTF-16; use
        // the simdutf-backed converter (no slash normalization — argv carries
        // URLs, not just filesystem paths).
        fn to_os(b: &[u8]) -> OsString {
            let mut wbuf = vec![0u16; b.len() + 1];
            let n = bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, b).len();
            OsString::from_wide(&wbuf[..n])
        }

        let mut iter = opts.argv.iter();
        let argv0 = iter.next().ok_or(bun_core::err!("FileNotFound"))?;
        // `Command::new` does PATH/PATHEXT lookup on Windows, matching
        // `std.process.Child.spawnWindows`'s `windowsCreateProcessPathExt`.
        let mut cmd = std::process::Command::new(to_os(argv0));
        for arg in iter {
            cmd.arg(to_os(arg));
        }
        cmd.env_clear();
        for (k, v) in opts.env_map {
            cmd.env(k, v);
        }
        cmd.stdin(std::process::Stdio::null());

        let out = cmd.output().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => bun_core::err!("FileNotFound"),
            std::io::ErrorKind::PermissionDenied => bun_core::err!("AccessDenied"),
            _ => bun_core::err!("Unexpected"),
        })?;

        let term = match out.status.code() {
            Some(code) => Term::Exited(code as u32),
            None => Term::Unknown(0),
        };
        return Ok(RunResult {
            term,
            stdout: out.stdout,
            stderr: out.stderr,
        });
    }

    let mut argv0_buf = bun_core::PathBuffer::uninit();
    let mut argv0_storage: Option<Box<[u8]>> = None;
    'argv0: {
        let Some(&first) = opts.argv.first() else {
            break 'argv0;
        };
        // Only PATH-search bare names — Zig's expandArg0 expands only when no
        // separator is present.
        if first.contains(&b'/') {
            break 'argv0;
        }
        #[cfg(windows)]
        if first.iter().any(|&b| b == b'\\') {
            break 'argv0;
        }
        let path = opts
            .env_map
            .get("PATH")
            .map(|s| s.as_bytes())
            .unwrap_or(b"");
        let Some(resolved) = bun_which::which(&mut argv0_buf, path, b"", first) else {
            break 'argv0;
        };
        // Own a NUL-terminated copy so the pointer outlives the spawn call.
        let mut owned = Vec::with_capacity(resolved.len() + 1);
        owned.extend_from_slice(resolved.as_bytes());
        owned.push(0);
        argv0_storage = Some(owned.into_boxed_slice());
    }
    let argv0_ptr: Option<*const c_char> = argv0_storage
        .as_deref()
        .map(|s| s.as_ptr().cast::<c_char>());

    // ── envp: HashMap<String,String> → `[*:null]?[*:0]const u8` ──
    // Own the `KEY=VALUE\0` backing storage in `env_buf`; `envp` points into it
    // and is kept alive for the duration of the `sync::spawn` call.
    let mut env_buf: Vec<Vec<u8>> = Vec::with_capacity(opts.env_map.len());
    for (k, v) in opts.env_map {
        let mut entry = Vec::with_capacity(k.len() + 1 + v.len() + 1);
        entry.extend_from_slice(k.as_bytes());
        entry.push(b'=');
        entry.extend_from_slice(v.as_bytes());
        entry.push(0);
        env_buf.push(entry);
    }
    let mut envp: Vec<*const c_char> = env_buf
        .iter()
        .map(|e| e.as_ptr().cast::<c_char>())
        .collect();
    envp.push(core::ptr::null());

    // ── argv: &[&[u8]] → Vec<Box<[u8]>> (sync::Options owns its argv) ──
    let argv: Vec<Box<[u8]>> = opts.argv.iter().map(|a| Box::<[u8]>::from(*a)).collect();

    let sync_opts = process::sync::Options {
        argv,
        envp: Some(envp.as_ptr()),
        stdin: process::sync::SyncStdio::Ignore,
        stdout: process::sync::SyncStdio::Buffer,
        stderr: process::sync::SyncStdio::Buffer,
        argv0: argv0_ptr,
        #[cfg(windows)]
        windows: process::sync::WindowsOptions {
            loop_: EventLoopHandle::init_mini(bun_event_loop::MiniEventLoop::init_global(
                None, None,
            )),
            ..Default::default()
        },
        ..Default::default()
    };

    // `!Maybe(Result)` → outer `Result<_, bun_core::Error>` for the Zig `try`,
    // inner `Maybe` for the syscall error.
    let result = process::sync::spawn(&sync_opts)??;

    // Keep envp backing storage alive until the child has been waited on.
    drop(envp);
    drop(env_buf);

    // Map `bun.spawn.Status` → `std.process.Child.Term` (the subset
    // `repository.exec` matches on — `.Exited`/else).
    let term = match result.status {
        Status::Exited(e) => Term::Exited(u32::from(e.code)),
        Status::Signaled(sig) => Term::Signal(u32::from(sig)),
        Status::Err(_) | Status::Running => Term::Unknown(0),
    };

    Ok(RunResult {
        term,
        stdout: result.stdout,
        stderr: result.stderr,
    })
}
