//! `bun_spawn` — low-tier process-spawn types extracted from
//! `src/runtime/api/bun/process.zig` so that `bun_install`, `bun_patch`, and
//! other mid-tier crates can name `SpawnOptions::Stdio`, `sync::Options`, and
//! `sync::Result` without depending on `bun_runtime` (cycle).
//!
//! The full spawn implementation (process tracking, polling, the actual
//! `spawn_process` body) lives in `bun_runtime::api::bun::process` and is
//! wired up in Phase B; this crate owns only the **data shapes** that cross
//! the tier boundary. See PORTING.md §Dispatch.
//!
//! Zig source of truth:
//!   - `Stdio`             → process.zig `PosixSpawnOptions.Stdio` /
//!                                       `WindowsSpawnOptions.Stdio`
//!   - `sync::Options`     → process.zig `sync.Options`
//!   - `sync::Result`      → process.zig `sync.Result`

#![allow(dead_code)]

use core::ffi::c_char;

use bun_sys::Fd;

// ──────────────────────────────────────────────────────────────────────────
// StdioKind — tiny tri-state used only by `Stdio::Dup2`. The Zig original is
// `bun.jsc.Subprocess.StdioKind`; defined here (not re-exported from
// `bun_runtime`) to keep this crate leaf.
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StdioKind {
    Stdin = 0,
    Stdout = 1,
    Stderr = 2,
}

impl StdioKind {
    #[inline]
    pub fn to_fd(self) -> Fd {
        match self {
            StdioKind::Stdin => Fd::stdin(),
            StdioKind::Stdout => Fd::stdout(),
            StdioKind::Stderr => Fd::stderr(),
        }
    }
}

#[derive(Copy, Clone)]
pub struct Dup2 {
    pub out: StdioKind,
    pub to: StdioKind,
}

// ──────────────────────────────────────────────────────────────────────────
// Stdio — `SpawnOptions.Stdio` from process.zig.
//
// Platform-split union: on POSIX `.buffer`/`.ipc` carry `void`; on Windows
// they carry `*uv.Pipe`. Rust expresses this as two cfg'd enums plus a
// `pub type Stdio = …` alias, mirroring `pub const SpawnOptions = if
// (Environment.isWindows) WindowsSpawnOptions else PosixSpawnOptions`.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub use self::posix::Stdio;
#[cfg(windows)]
pub use self::windows::Stdio;

#[cfg(not(windows))]
mod posix {
    use super::*;

    /// `PosixSpawnOptions.Stdio` (process.zig:1067).
    pub enum Stdio {
        Path(Box<[u8]>),
        Inherit,
        Ignore,
        Buffer,
        Ipc,
        Pipe(Fd),
        // TODO: remove this entry, it doesn't seem to be used
        Dup2(Dup2),
    }

    impl Default for Stdio {
        #[inline]
        fn default() -> Self {
            Stdio::Ignore
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;

    // `bun.windows.libuv.Pipe`. The libuv `Pipe` wrapper has not yet landed in
    // `bun_sys::windows::libuv`; until it does, model the pointer payload as an
    // erased `*mut ()` so downstream crates can construct the variant without a
    // tier inversion.
    // TODO(port): replace `*mut ()` with `*mut bun_sys::windows::libuv::Pipe`
    // once that type exists in `bun_sys`.
    pub type UvPipePtr = *mut ();

    /// `WindowsSpawnOptions.Stdio` (process.zig:1149).
    pub enum Stdio {
        Path(Box<[u8]>),
        Inherit,
        Ignore,
        Buffer(UvPipePtr),
        Ipc(UvPipePtr),
        Pipe(Fd),
        Dup2(Dup2),
    }

    impl Default for Stdio {
        #[inline]
        fn default() -> Self {
            Stdio::Ignore
        }
    }

    // PORT NOTE: Zig `Stdio.deinit` calls `pipe.closeAndDestroy()` for the
    // buffer/ipc arms. That requires the libuv `Pipe` wrapper which lives in a
    // higher tier today, so the Drop impl is intentionally omitted here — the
    // owner (`bun_runtime::api::bun::process`) is responsible for cleanup.
    // TODO(port): add Drop once `bun_sys::windows::libuv::Pipe::close_and_destroy`
    // is available at this tier.
}

// ──────────────────────────────────────────────────────────────────────────
// Status — process exit status. Needed by `sync::Result`.
// Port of process.zig `Status`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub enum Status {
    Running,
    Exited { code: u8, signal: bun_core::SignalCode },
    Signaled(bun_core::SignalCode),
    Err(bun_sys::Error),
}

impl Default for Status {
    #[inline]
    fn default() -> Self {
        Status::Running
    }
}

impl Status {
    #[inline]
    pub fn is_ok(&self) -> bool {
        matches!(self, Status::Exited { code: 0, .. })
    }

    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        match *self {
            Status::Signaled(sig) => Some(sig),
            Status::Exited { signal, .. } if (signal as u8) > 0 => Some(signal),
            _ => None,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Process — low-tier shape of `bun.spawn.Process` (process.zig `Process`).
//
// MOVE_DOWN from `bun_runtime::api::bun::process` so that `bun_jsc`
// (ProcessAutoKiller) can name `*mut Process` without the runtime → jsc → spawn
// cycle. Only the fields/methods that cross the tier boundary are ported here:
// `pid`, `status`, intrusive `ref_count`, and `has_exited`/`kill`/`ref_`/`deref`.
// The full `Poller`/`ProcessExitHandler`/event-loop wiring remains owned by
// `bun_runtime` and is layered on top via raw-ptr extension in Phase B.
// ──────────────────────────────────────────────────────────────────────────

/// Zig: process.zig `pid_t` — `std.posix.pid_t` on POSIX, `bun.windows.DWORD`
/// (u32) on Windows.
#[cfg(unix)]
pub type PidT = libc::pid_t;
#[cfg(windows)]
pub type PidT = u32;

pub struct Process {
    pub pid: PidT,
    pub status: Status,
    /// Intrusive thread-safe refcount (Zig: `bun.ptr.ThreadSafeRefCount(Process, …)`).
    /// Stored as a bare atomic at this tier to avoid pulling `bun_ptr`'s
    /// destructor-dispatch (which needs the full `Poller` field) into a leaf
    /// crate; `ref_`/`deref` below match the Zig acquire/release protocol.
    pub ref_count: core::sync::atomic::AtomicU32,
}

impl Process {
    /// Zig: `Process.hasExited`.
    #[inline]
    pub fn has_exited(&self) -> bool {
        matches!(self.status, Status::Exited { .. } | Status::Signaled(_) | Status::Err(_))
    }

    /// Zig: `Process.kill(signal: u8) Maybe(void)`.
    ///
    /// At this tier the `Poller` discriminant is not available, so the POSIX
    /// path issues `kill(2)` unconditionally on `pid` (the Zig guard only
    /// short-circuits for `.detached`, which never reaches the auto-killer).
    pub fn kill(&self, signal: u8) -> bun_sys::Maybe<()> {
        #[cfg(unix)]
        {
            // SAFETY: libc kill(2) on a stored pid.
            let err = unsafe { libc::kill(self.pid, signal as libc::c_int) };
            if err != 0 {
                let errno_ = bun_sys::get_errno(err as isize);
                // if the process was already killed don't throw
                if errno_ != bun_sys::E::ESRCH {
                    return Err(bun_sys::Error::from_code(errno_, bun_sys::Tag::TODO));
                }
            }
            Ok(())
        }
        #[cfg(windows)]
        {
            let _ = signal;
            // TODO(port): blocked_on bun_sys::windows::libuv::Process — the
            // Windows kill path goes through the uv handle owned by `Poller`,
            // which lives in `bun_runtime`. The auto-killer is POSIX-only in
            // practice today; widen once `Poller` moves down.
            Ok(())
        }
    }

    /// Zig: `ref_count.ref()`. Takes `&self` — the count is atomic.
    #[inline]
    pub fn ref_(&self) {
        self.ref_count
            .fetch_add(1, core::sync::atomic::Ordering::AcqRel);
    }

    /// Zig: `ref_count.deref()`. Drops the heap allocation when the count hits
    /// zero (Zig destructor = `Process.deinit` → `bun.destroy`).
    ///
    /// # Safety
    /// `self` must have been allocated via `Box::into_raw` (the spawn entry
    /// points uphold this) and must not be used after this call returns if it
    /// released the last reference.
    #[inline]
    pub fn deref(&self) {
        if self
            .ref_count
            .fetch_sub(1, core::sync::atomic::Ordering::AcqRel)
            == 1
        {
            core::sync::atomic::fence(core::sync::atomic::Ordering::Acquire);
            // SAFETY: see doc — last ref; allocation came from Box::into_raw.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// sync — `process.zig` `pub const sync = struct { … }` (line 1910).
// Blocking spawn options/result used by `bun patch`, `bun install` git
// operations, and CLI helpers.
// ──────────────────────────────────────────────────────────────────────────

pub mod sync {
    use super::*;

    /// `sync.Options.Stdio` — three-state stdio selector for blocking spawns.
    /// Distinct from the top-level [`crate::Stdio`] (which is the full
    /// `SpawnOptions.Stdio` union); this one is the simplified enum that
    /// `sync.Options.toSpawnOptions` expands.
    #[derive(Copy, Clone, PartialEq, Eq, Default)]
    pub enum Stdio {
        Inherit,
        #[default]
        Ignore,
        Buffer,
    }

    impl Stdio {
        /// Port of `sync.Options.Stdio.toStdio`.
        pub fn to_stdio(self) -> crate::Stdio {
            match self {
                Stdio::Inherit => crate::Stdio::Inherit,
                Stdio::Ignore => crate::Stdio::Ignore,
                #[cfg(not(windows))]
                Stdio::Buffer => crate::Stdio::Buffer,
                #[cfg(windows)]
                Stdio::Buffer => {
                    // Zig: `bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(...))`.
                    // TODO(port): allocate a real `uv::Pipe` once the type lands
                    // in `bun_sys::windows::libuv`. Null placeholder for now —
                    // the Windows sync-spawn path is wired up in `bun_runtime`.
                    crate::Stdio::Buffer(core::ptr::null_mut())
                }
            }
        }
    }

    /// `WindowsSpawnOptions.WindowsOptions` (process.zig:1143). Only the
    /// Windows build carries real data; on POSIX the field is `void`.
    #[cfg(windows)]
    #[derive(Clone)]
    pub struct WindowsOptions {
        pub verbatim_arguments: bool,
        pub hide_window: bool,
        pub loop_: bun_event_loop::EventLoopHandle,
    }

    #[cfg(windows)]
    impl Default for WindowsOptions {
        fn default() -> Self {
            Self {
                verbatim_arguments: false,
                hide_window: true,
                // Zig: `loop: jsc.EventLoopHandle = undefined`. Never read
                // before assignment.
                // SAFETY: zero-init placeholder; `EventLoopHandle` is a
                // two-word `Copy` enum and callers always overwrite `loop_`
                // before the struct is consumed (see `bun patch` / `bun
                // install` call sites).
                loop_: unsafe { core::mem::zeroed() },
            }
        }
    }

    #[cfg(not(windows))]
    pub type WindowsOptions = ();

    /// `sync.Options` (process.zig:1911).
    pub struct Options {
        pub stdin: Stdio,
        pub stdout: Stdio,
        pub stderr: Stdio,
        pub ipc: Option<Fd>,
        pub cwd: Box<[u8]>,
        pub detached: bool,

        pub argv: Vec<Box<[u8]>>,
        /// `null` = inherit parent env.
        // PORT NOTE: kept as a raw nul-terminated `envp` array to match the
        // Zig FFI shape (`?[*:null]?[*:0]const u8`). Callers build this with
        // `bun_dotenv::Map::create_null_delimited_env_map`.
        pub envp: Option<*const *const c_char>,

        pub use_execve_on_macos: bool,
        pub argv0: Option<*const c_char>,

        #[cfg(windows)]
        pub windows: WindowsOptions,
        #[cfg(not(windows))]
        pub windows: (),
    }

    impl Default for Options {
        fn default() -> Self {
            Self {
                stdin: Stdio::Ignore,
                stdout: Stdio::Inherit,
                stderr: Stdio::Inherit,
                ipc: None,
                cwd: Box::from(&b""[..]),
                detached: false,
                argv: Vec::new(),
                envp: None,
                use_execve_on_macos: false,
                argv0: None,
                #[cfg(windows)]
                windows: WindowsOptions::default(),
                #[cfg(not(windows))]
                windows: (),
            }
        }
    }

    /// `sync.Result` (process.zig:1963).
    pub struct Result {
        pub status: Status,
        pub stdout: Vec<u8>,
        pub stderr: Vec<u8>,
    }

    impl Default for Result {
        fn default() -> Self {
            Self { status: Status::default(), stdout: Vec::new(), stderr: Vec::new() }
        }
    }

    impl Result {
        #[inline]
        pub fn is_ok(&self) -> bool {
            self.status.is_ok()
        }
    }
    // `deinit` → `Drop` (Vec<u8> auto-frees).
}
