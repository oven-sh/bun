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
//!   - `WaiterThread` flag → process.zig `WaiterThread.setShouldUseWaiterThread`

#![allow(dead_code)]

use core::ffi::c_char;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_sys::Fd;

pub use bun_event_loop::EventLoopHandle;

// ──────────────────────────────────────────────────────────────────────────
// WaiterThread force-flag (process.zig `WaiterThread.shouldUseWaiterThread`).
//
// MOVE_DOWN(b0): the static lived in `bun_runtime::api::bun::process`, but
// `bun_install` and `bun_jsc` both need to *set* it during early init
// (`BUN_FEATURE_FLAG_FORCE_WAITER_THREAD`). Hosting the flag here breaks the
// cycle — the high-tier `WaiterThread` reads it via `should_use_waiter_thread`.
// ──────────────────────────────────────────────────────────────────────────
pub mod process {
    use core::sync::atomic::{AtomicBool, Ordering};

    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);

    pub struct WaiterThread;
    impl WaiterThread {
        /// Spec process.zig:929 `setShouldUseWaiterThread`.
        #[inline]
        pub fn set_should_use_waiter_thread() {
            SHOULD_USE_WAITER_THREAD.store(true, Ordering::Relaxed);
        }
        /// Spec process.zig:933 `shouldUseWaiterThread`.
        #[inline]
        pub fn should_use_waiter_thread() -> bool {
            SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MOVE_DOWN(b0): `bun.jsc.Subprocess` data shapes that mid-tier crates
// (`bun_install::security_scanner`, `lifecycle_script_runner`) need to name
// without depending on `bun_runtime`. Only the cross-tier surface lives here;
// the full reader/writer wiring (libuv pipes, BufferedReader hookup) stays in
// `bun_runtime::api::bun::subprocess` and is dispatched at runtime.
// ──────────────────────────────────────────────────────────────────────────
pub mod subprocess {
    use core::ffi::c_void;
    use core::sync::atomic::{AtomicPtr, Ordering};

    use bun_sys::Fd;

    pub use super::StdioKind;

    /// Port of `bun.jsc.Subprocess.StdioResult` (subprocess.zig). On POSIX the
    /// Zig type is `?bun.FD`; on Windows it is a tagged union over `Pipe` /
    /// `Fd` / unavailable. Unified into a single enum here so callers can
    /// construct it cross-platform via [`StdioResult::from_fd`].
    pub enum StdioResult {
        Fd(Fd),
        /// Windows-only: parent end of an overlapped `uv_pipe_t`. Stored as a
        /// type-erased raw pointer so this leaf crate doesn't depend on libuv
        /// bindings; `bun_runtime` casts it back on consumption.
        #[cfg(windows)]
        Buffer(*mut core::ffi::c_void),
        Unavailable,
    }

    impl StdioResult {
        #[inline]
        pub fn from_fd(fd: Fd) -> Self {
            Self::Fd(fd)
        }
    }

    /// Port of `bun.jsc.Subprocess.Source` — the in-memory payload that a
    /// `StaticPipeWriter` streams to the child's stdin/extra-fd. Only the
    /// owned-bytes variant is needed at this tier (security_scanner feeds a
    /// JSON blob); the `Blob`/`ArrayBuffer` variants live in `bun_runtime`.
    ///
    /// `Cell` because Zig's `detach` mutates through an intrusive shared ref
    /// (`this.* = .detached` on a `*Source` field of a refcounted struct).
    pub struct Source {
        bytes: core::cell::Cell<Option<Box<[u8]>>>,
    }

    impl Source {
        #[inline]
        pub fn from_owned_bytes(bytes: Box<[u8]>) -> Self {
            Self { bytes: core::cell::Cell::new(Some(bytes)) }
        }

        /// Zig: `Source.detach()` — drop the owned payload without writing it.
        ///
        /// PORT NOTE: the full `bun_runtime` `Source` is a tagged union over
        /// `Blob`/`ArrayBuffer`/owned-bytes whose `detach` zeroes the active
        /// variant in-place. At this tier only the owned-bytes variant exists;
        /// `Cell::take()` matches the Zig `self.* = .detached;` semantics —
        /// the bytes are released immediately and subsequent `slice()` calls
        /// return `&[]`.
        #[inline]
        pub fn detach(&self) {
            drop(self.bytes.take());
        }

        #[inline]
        pub fn slice(&self) -> &[u8] {
            // SAFETY: `Source` is `!Sync` (Cell) and only ever reached through
            // the single-thread `StaticPipeWriter` `Rc` handle. The returned
            // borrow is never held across a `detach()` — callers use it once
            // to seed the runtime writer's buffer in `create()`.
            unsafe { (*self.bytes.as_ptr()).as_deref().unwrap_or(&[]) }
        }
    }

    /// Trait bound for the owning process type `P` of [`StaticPipeWriter`].
    ///
    /// MOVE_DOWN(b0) from `bun_runtime::api::bun::subprocess::StaticPipeWriter`:
    /// Zig's `NewStaticPipeWriter(comptime ProcessType)` duck-types
    /// `process.onCloseIO(.stdin)`; this trait is the cross-tier surface so
    /// mid-tier parents (e.g. `SecurityScanSubprocess`) can be wired into the
    /// runtime's `BufferedWriter` callback table without naming `bun_runtime`.
    pub trait StaticPipeWriterProcess {
        /// # Safety
        /// `this` must point to a live `Self`.
        unsafe fn on_close_io(this: *mut Self, kind: StdioKind);
    }

    /// §Dispatch cold-path vtable — port of `jsc.Subprocess.NewStaticPipeWriter`'s
    /// `create`/`start`/`deref` body. The real `BufferedWriter` + `FilePoll`
    /// machinery lives in `bun_runtime` (depends on `bun_io`, `bun_aio`,
    /// `bun_jsc`); that crate constructs a `&'static PipeWriterHooks` per
    /// erased-parent shape and calls [`set_pipe_writer_hooks`] at startup.
    ///
    /// All fn-ptrs operate on the runtime's intrusively-refcounted allocation
    /// (returned from `create` as an erased `*mut c_void`).
    pub struct PipeWriterHooks {
        /// Allocate the runtime writer (`Box::into_raw`), wire `on_close_io`
        /// to the parent backref, and seed its buffer from `source`. Returns
        /// the erased `IntrusiveRc<runtime::StaticPipeWriter<_>>` pointer.
        pub create: unsafe fn(
            event_loop: super::EventLoopHandle,
            parent: *mut c_void,
            on_close_io: unsafe fn(*mut c_void, StdioKind),
            stdio_result: &StdioResult,
            source: *const [u8],
        ) -> *mut c_void,
        /// `StaticPipeWriter.start()` — ref-bump + register the fd with the
        /// event loop's `FilePoll`, kick the first write.
        pub start: unsafe fn(inner: *mut c_void) -> bun_sys::Maybe<()>,
        /// Drop one intrusive ref (matches Zig `WriterRefCount.deref`).
        pub deref: unsafe fn(inner: *mut c_void),
    }

    static PIPE_WRITER_HOOKS: AtomicPtr<PipeWriterHooks> =
        AtomicPtr::new(core::ptr::null_mut());

    /// Called once from `bun_runtime::dispatch::install_dispatch_hooks()`.
    pub fn set_pipe_writer_hooks(hooks: &'static PipeWriterHooks) {
        PIPE_WRITER_HOOKS.store(
            hooks as *const PipeWriterHooks as *mut PipeWriterHooks,
            Ordering::Release,
        );
    }

    #[inline]
    fn pipe_writer_hooks() -> &'static PipeWriterHooks {
        let p = PIPE_WRITER_HOOKS.load(Ordering::Acquire);
        debug_assert!(
            !p.is_null(),
            "bun_spawn::subprocess::PIPE_WRITER_HOOKS not installed — \
             bun_runtime must call set_pipe_writer_hooks() at startup",
        );
        // SAFETY: `p` was stored from a `&'static PipeWriterHooks` (see setter).
        unsafe { &*p }
    }

    /// Port of `jsc.Subprocess.NewStaticPipeWriter(ParentType)` — comptime-
    /// parameterized async writer that drains `source` into `stdio_result`.
    ///
    /// LAYERING: the body (`bun_io::BufferedWriter` + `FilePoll`) lives in
    /// `bun_runtime` and is reached via [`PipeWriterHooks`]. This wrapper owns
    /// the `Source` bytes (so mid-tier callers can `.source.detach()` on the
    /// error path) and the erased runtime handle; `Drop` releases both.
    pub struct StaticPipeWriter<P: ?Sized> {
        pub source: Source,
        pub stdio_result: StdioResult,
        /// Erased `IntrusiveRc<bun_runtime::…::StaticPipeWriter<ErasedParent>>`.
        /// `Cell` because `create()` returns `Rc<Self>` and seeds this after
        /// allocation (the source slice borrows `self.source`, so the wrapper
        /// must exist before the runtime writer is built).
        inner: core::cell::Cell<*mut c_void>,
        _parent: core::marker::PhantomData<*const P>,
    }

    impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
        /// Port of `StaticPipeWriter.create` (subprocess/StaticPipeWriter.zig).
        ///
        /// PORT NOTE: Zig returned `*This` (intrusive refcount). The mid-tier
        /// callers store the handle in `Option<Rc<_>>`, so `Rc<Self>` is the
        /// owning wrapper here; the runtime's intrusive ref lives in `inner`
        /// and is balanced by `Drop`.
        pub fn create(
            event_loop: super::EventLoopHandle,
            parent: *const P,
            result: StdioResult,
            source: Source,
        ) -> std::rc::Rc<Self> {
            // Monomorphize the `on_close_io` callback per `P` so the runtime's
            // type-erased writer can dispatch back without naming `P` (Zig:
            // `process.onCloseIO(.stdin)` where `process: *ProcessType`).
            unsafe fn on_close<Q: StaticPipeWriterProcess>(p: *mut c_void, kind: StdioKind) {
                // SAFETY: `p` is the `parent` passed to `create` below; the
                // runtime never outlives the parent (parent's `deinit` calls
                // `writer.deref()` first).
                unsafe { Q::on_close_io(p.cast::<Q>(), kind) }
            }
            let hooks = pipe_writer_hooks();
            // Build the wrapper first so `source.slice()` has a stable address
            // for the runtime to alias (the bytes live in `Rc<Self>` for the
            // writer's lifetime).
            let this = std::rc::Rc::new(Self {
                source,
                stdio_result: result,
                inner: core::cell::Cell::new(core::ptr::null_mut()),
                _parent: core::marker::PhantomData,
            });
            // SAFETY: §Dispatch cold-path — `hooks.create` is the registered
            // runtime ctor; `parent` is a live backref the caller keeps valid
            // until `on_close_io` fires; `source` slice points into `this`
            // which the returned `Rc` keeps alive past the runtime writer.
            let inner = unsafe {
                (hooks.create)(
                    event_loop,
                    parent as *mut c_void,
                    on_close::<P>,
                    &this.stdio_result,
                    this.source.slice() as *const [u8],
                )
            };
            this.inner.set(inner);
            this
        }

        /// Port of `StaticPipeWriter.start` (subprocess/StaticPipeWriter.zig).
        pub fn start(&self) -> bun_sys::Maybe<()> {
            let hooks = pipe_writer_hooks();
            // SAFETY: `inner` was returned by `hooks.create` and is live until
            // `Drop` calls `hooks.deref`.
            unsafe { (hooks.start)(self.inner.get()) }
        }
    }

    impl<P: ?Sized> Drop for StaticPipeWriter<P> {
        fn drop(&mut self) {
            let inner = self.inner.get();
            if inner.is_null() {
                return;
            }
            let p = PIPE_WRITER_HOOKS.load(Ordering::Acquire);
            if p.is_null() {
                // Unit-test / tool builds with no runtime tier linked — `inner`
                // was never populated by a real allocator.
                return;
            }
            // SAFETY: `p` is a `&'static PipeWriterHooks`; `inner` is the
            // intrusive-rc handle returned by `hooks.create`. Zig `deref()`.
            unsafe { ((*p).deref)(inner) };
        }
    }
}

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
pub mod windows {
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

impl core::fmt::Display for Status {
    /// Port of `Status.format` (process.zig).
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Status::Running => f.write_str("running"),
            Status::Exited { code, signal } => {
                write!(f, "exited with code {} and signal {}", code, *signal as u8)
            }
            Status::Signaled(sig) => write!(f, "signaled with {}", *sig as u8),
            Status::Err(err) => write!(f, "{}", err),
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

// ──────────────────────────────────────────────────────────────────────────
// Rusage — resource-usage snapshot returned alongside the exit status.
// Port of process.zig `Rusage` (= `std.posix.rusage` on POSIX, custom struct
// on Windows). Moved down so `bun_install::lifecycle_script_runner` can name
// it without depending on `bun_runtime`.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(all(unix, not(miri)))]
pub type Rusage = libc::rusage;

#[cfg(any(windows, miri))]
#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct Rusage {
    pub utime: TimevalLike,
    pub stime: TimevalLike,
    pub maxrss: u64,
    pub ixrss: u0_,
    pub idrss: u0_,
    pub isrss: u0_,
    pub minflt: u0_,
    pub majflt: u0_,
    pub nswap: u0_,
    pub inblock: u64,
    pub oublock: u64,
    pub msgsnd: u0_,
    pub msgrcv: u0_,
    pub nsignals: u0_,
    pub nvcsw: u0_,
    pub nivcsw: u0_,
}
#[cfg(any(windows, miri))]
pub type u0_ = u8;
#[cfg(any(windows, miri))]
#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct TimevalLike { pub tv_sec: i64, pub tv_usec: i64 }

// ──────────────────────────────────────────────────────────────────────────
// SpawnOptions / SpawnResult — low-tier shapes of `PosixSpawnOptions` /
// `WindowsSpawnOptions` / `SpawnResult` (process.zig). MOVE_DOWN so
// `bun_install::lifecycle_script_runner` can construct a `SpawnOptions` and
// destructure the `SpawnResult` without the `bun_runtime` cycle. The
// `spawn_process` body itself is dispatched at link time (see below).
// ──────────────────────────────────────────────────────────────────────────

pub struct SpawnOptions<'a> {
    pub stdin: Stdio,
    pub stdout: Stdio,
    pub stderr: Stdio,
    pub extra_fds: Vec<Stdio>,
    pub cwd: &'a [u8],
    pub detached: bool,
    pub stream: bool,
    pub argv0: Option<*const c_char>,
    /// macOS only: use `execve(2)` directly so the child re-signs under the
    /// new entitlements (used by `bun run --bun`). No-op elsewhere.
    pub use_execve_on_macos: bool,
    #[cfg(windows)]
    pub windows: sync::WindowsOptions,
    #[cfg(not(windows))]
    pub windows: (),
}

impl<'a> Default for SpawnOptions<'a> {
    fn default() -> Self {
        Self {
            stdin: Stdio::default(),
            stdout: Stdio::default(),
            stderr: Stdio::default(),
            extra_fds: Vec::new(),
            cwd: b"",
            detached: false,
            stream: true,
            argv0: None,
            use_execve_on_macos: false,
            #[cfg(windows)]
            windows: sync::WindowsOptions::default(),
            #[cfg(not(windows))]
            windows: (),
        }
    }
}

/// Port of `WindowsSpawnResult.StdioResult` (process.zig:1196) — the per-stream
/// outcome handed back to mid-tier callers on Windows so they can match the
/// `.buffer` arm without depending on `bun_runtime` (cycle).
///
/// MOVE_DOWN(b0) from `bun_runtime::api::bun::process::WindowsStdioResult`:
/// `bun_install::lifecycle_script_runner` checks `spawned.stdout == .buffer` to
/// decide whether to start the libuv-backed `BufferedReader`; that check must
/// typecheck at this tier.
#[cfg(windows)]
#[derive(Default)]
pub enum SpawnedStdio {
    /// inherit, ignore, path, pipe
    #[default]
    Unavailable,
    Buffer(windows::UvPipePtr),
    BufferFd(Fd),
}

/// Port of `SpawnProcessResult` (process.zig:1221). Platform-split to mirror
/// `PosixSpawnResult` / `WindowsSpawnResult`: POSIX hands back raw `Fd`s +
/// `memfds`; Windows hands back [`SpawnedStdio`] so mid-tier callers can match
/// the `.buffer` arm. Only the fields crossed at this tier are present — the
/// full `WindowsSpawnResult` (with the intrusive `*mut Process`) lives in
/// `bun_runtime` and is bridged into this shape by the dispatch hook.
#[cfg(not(windows))]
#[derive(Default)]
pub struct SpawnResult {
    pub pid: PidT,
    pub pidfd: Option<i32>,
    pub stdin: Option<Fd>,
    pub stdout: Option<Fd>,
    pub stderr: Option<Fd>,
    pub extra_pipes: Vec<Fd>,
    pub memfds: [bool; 3],
}

#[cfg(windows)]
#[derive(Default)]
pub struct SpawnResult {
    pub pid: PidT,
    pub stdin: SpawnedStdio,
    pub stdout: SpawnedStdio,
    pub stderr: SpawnedStdio,
    pub extra_pipes: Vec<SpawnedStdio>,
}

#[cfg(windows)]
pub use sync::WindowsOptions;

impl SpawnResult {
    /// Port of `SpawnProcessResult.toProcess` (process.zig:1241). Builds the
    /// refcounted `Process` handle from the pid; the full `Poller` wiring is
    /// layered on by `bun_runtime` once the event-loop tier is available.
    pub fn to_process(
        self,
        _event_loop: impl Sized,
        _sync: bool,
    ) -> std::sync::Arc<Process> {
        std::sync::Arc::new(Process {
            pid: self.pid,
            status: Status::Running,
            ref_count: core::sync::atomic::AtomicU32::new(1),
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch one-shot hook (PORTING.md): `spawnProcess` body lives in
// `bun_runtime::api::bun::process` (depends on `posix_spawn_bun` FFI + the
// libuv process loop on Windows + `WaiterThread`/`FilePoll` wiring, all of
// which sit above this crate). `bun_install` and `bun_runtime::webview` both
// need to call it without depending on `bun_runtime` (cycle), so the low tier
// owns the data shapes + this hook, and `bun_runtime::dispatch::
// install_dispatch_hooks()` registers the real fn-ptr at startup.
// ──────────────────────────────────────────────────────────────────────────

/// Signature of the high-tier `spawnProcess` body. `for<'a>` because
/// `SpawnOptions` borrows `cwd`/`extra_fds` from the caller's stack.
pub type SpawnProcessFn = for<'a> fn(
    &'a SpawnOptions<'a>,
    *mut *const c_char,
    *const *const c_char,
) -> Result<bun_sys::Maybe<SpawnResult>, bun_core::Error>;

static SPAWN_PROCESS_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// Called once from `bun_runtime` init.
pub fn set_spawn_process_hook(f: SpawnProcessFn) {
    SPAWN_PROCESS_HOOK.store(f as *mut (), Ordering::Release);
}

/// Port of `spawnProcess` (process.zig:1493). Dispatches to
/// `bun_runtime::api::bun::process::spawn_process` via [`SPAWN_PROCESS_HOOK`].
pub fn spawn_process(
    options: &SpawnOptions<'_>,
    argv: *mut *const c_char,
    envp: *const *const c_char,
) -> Result<bun_sys::Maybe<SpawnResult>, bun_core::Error> {
    let p = SPAWN_PROCESS_HOOK.load(Ordering::Acquire);
    debug_assert!(
        !p.is_null(),
        "bun_spawn::SPAWN_PROCESS_HOOK not installed — \
         bun_runtime must call set_spawn_process_hook() at startup",
    );
    // SAFETY: `p` was stored from a `SpawnProcessFn` (same layout — see
    // `set_spawn_process_hook`).
    let f: SpawnProcessFn = unsafe { core::mem::transmute::<*mut (), SpawnProcessFn>(p) };
    f(options, argv, envp)
}


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

    /// Zig: `Process.setExitHandler` — registers the owner that receives
    /// `onProcessExit`. The full body stores `(ptr, vtable)` on the
    /// `bun_runtime` `Process`; at this tier the handle has no `exit_handler`
    /// slot, so the call is recorded as a no-op and the runtime path attaches
    /// it via `to_process` instead. `&self` so `Arc<Process>` callers compile.
    #[inline]
    pub fn set_exit_handler<T>(&self, _owner: *mut T) {
        // TODO(port): blocked_on bun_runtime::api::bun::process::Process —
        // exit-handler slot lives on the higher-tier struct.
    }

    /// Zig: `Process.watchOrReap` — start waiting for exit (pidfd / waiter
    /// thread / kqueue) or, on Linux, reap immediately if the child already
    /// exited before the pidfd was registered. Returns `Ok(true)` when the
    /// process is being watched, `Ok(false)` if it had already exited.
    #[inline]
    pub fn watch_or_reap(&self) -> bun_sys::Maybe<bool> {
        // TODO(port): blocked_on bun_runtime::api::bun::process::Process —
        // dispatch to the real `watch_or_reap` once the runtime registers the
        // poller. Mid-tier callers only inspect `.err`.
        Ok(true)
    }

    /// Zig: `Process.detach` — clear the exit handler so the owner can drop
    /// without a dangling callback, and unref the keep-alive on the event
    /// loop. `&self` because `Arc<Process>` is the canonical handle.
    #[inline]
    pub fn detach(&self) {
        // TODO(port): blocked_on bun_runtime::api::bun::process::Process —
        // poller/keep-alive live on the higher-tier struct.
    }

    /// Zig: `Process.onExit` — record the final status, drop the keep-alive,
    /// and dispatch `exit_handler.call(self, status, rusage)`. `&self` so
    /// `Arc<Process>` callers compile.
    #[inline]
    pub fn on_exit(&self, _status: Status, _rusage: &Rusage) {
        // TODO(port): blocked_on bun_runtime::api::bun::process::Process —
        // status/exit_handler/poller fields live on the higher-tier struct.
    }

    /// Zig: `Process.close` — tear down the poller (pidfd close / waiter
    /// shutdown / `uv_close`). `&self` because `Arc<Process>` is the canonical
    /// handle and Zig's intrusive refcount allows mutation through shared.
    #[inline]
    pub fn close(&self) {
        // TODO(port): blocked_on bun_runtime::api::bun::process::Process —
        // poller lives on the higher-tier struct.
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

    // ──────────────────────────────────────────────────────────────────────
    // §Dispatch one-shot hook (PORTING.md) for `bun.spawnSync`. Body lives in
    // `bun_runtime::api::bun::process::sync::spawn` (depends on
    // `posix_spawn::wait4`, `ParentDeathWatchdog`, `JobControl` tcsetpgrp
    // dance, `bun_crash_handler` SIGCHLD reset — all higher-tier). Registered
    // by `bun_runtime` at startup so `bun_install`/`bun_patch` can block on
    // a child without the dep cycle.
    // ──────────────────────────────────────────────────────────────────────

    pub type SyncSpawnFn =
        fn(&Options) -> core::result::Result<bun_sys::Maybe<Result>, bun_core::Error>;

    static SYNC_SPAWN_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    /// Called once from `bun_runtime` init.
    pub fn set_sync_spawn_hook(f: SyncSpawnFn) {
        SYNC_SPAWN_HOOK.store(f as *mut (), Ordering::Release);
    }

    /// `bun.spawnSync(opts)` (process.zig:2065) — blocking spawn, returns
    /// `!Maybe(sync.Result)`. Dispatches to
    /// `bun_runtime::api::bun::process::sync::spawn` via [`SYNC_SPAWN_HOOK`].
    pub fn spawn(
        opts: &Options,
    ) -> core::result::Result<bun_sys::Maybe<Result>, bun_core::Error> {
        let p = SYNC_SPAWN_HOOK.load(Ordering::Acquire);
        debug_assert!(
            !p.is_null(),
            "bun_spawn::sync::SYNC_SPAWN_HOOK not installed — \
             bun_runtime must call set_sync_spawn_hook() at startup",
        );
        // SAFETY: `p` was stored from a `SyncSpawnFn` (same layout).
        let f: SyncSpawnFn = unsafe { core::mem::transmute::<*mut (), SyncSpawnFn>(p) };
        f(opts)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `std.process.Child.run` shim — port of the blocking `run` helper used by
// `bun_install::repository::exec` (src/install/repository.zig:360). The
// actual subprocess execution lives in `bun_runtime::api::bun::process::sync`
// at a higher tier; this crate only owns the data shapes so `bun_install`
// can name them without a dep cycle (runtime → install → spawn).
// ──────────────────────────────────────────────────────────────────────────

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

/// Port of `std.process.Child.run` — blocking spawn that captures stdout/stderr.
///
/// PORT NOTE: Zig's `repository.exec` called `std.process.Child.run` directly;
/// per `src/CLAUDE.md` ("Prefer Bun APIs over std") and the `std::process` ban
/// in PORTING.md, this is rewritten on top of [`sync::spawn`] (= `bun.spawnSync`).
/// The argv/envp marshalling below mirrors `std.process.Child.spawnPosix`:
/// each arg is NUL-terminated, the array is NULL-terminated, and env entries
/// are flattened to `KEY=VALUE\0`.
pub fn run(opts: RunOptions<'_>) -> core::result::Result<RunResult, bun_core::Error> {
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
    let mut envp: Vec<*const c_char> =
        env_buf.iter().map(|e| e.as_ptr().cast::<c_char>()).collect();
    envp.push(core::ptr::null());

    // ── argv: &[&[u8]] → Vec<Box<[u8]>> (sync::Options owns its argv) ──
    let argv: Vec<Box<[u8]>> = opts.argv.iter().map(|a| Box::<[u8]>::from(*a)).collect();

    let sync_opts = sync::Options {
        argv,
        envp: Some(envp.as_ptr()),
        stdin: sync::Stdio::Ignore,
        stdout: sync::Stdio::Buffer,
        stderr: sync::Stdio::Buffer,
        ..Default::default()
    };

    // `!Maybe(Result)` → outer `Result<_, bun_core::Error>` for the Zig `try`,
    // inner `Maybe` for the syscall error.
    let result = match sync::spawn(&sync_opts)? {
        Ok(r) => r,
        Err(sys_err) => return Err(sys_err.into()),
    };

    // Keep envp backing storage alive until the child has been waited on.
    drop(envp);
    drop(env_buf);

    // Map `bun.spawn.Status` → `std.process.Child.Term` (the subset
    // `repository.exec` matches on — `.Exited`/else).
    let term = match result.status {
        Status::Exited { code, .. } => Term::Exited(u32::from(code)),
        Status::Signaled(sig) => Term::Signal(u32::from(sig as u8)),
        Status::Err(_) | Status::Running => Term::Unknown(0),
    };

    Ok(RunResult {
        term,
        stdout: result.stdout,
        stderr: result.stderr,
    })
}
