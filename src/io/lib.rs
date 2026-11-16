//! Confusingly, this is the barely used epoll/kqueue event loop
//! This is only used by Bun.write() and Bun.file(path).text() & friends.
//!
//! Most I/O happens on the main thread.

// ════════════════════════════════════════════════════════════════════════════
// Loop / Poll / Waker / Closer / FilePoll-vtable / heap / pipes / MaxBuf /
// openForWriting / PipeReader / PipeWriter compile on POSIX. `source` and the
// Windows*Reader/Writer impls are `#[cfg(windows)]`-gated (libuv-only).
// ════════════════════════════════════════════════════════════════════════════

#![allow(unsafe_op_in_unsafe_fn)]
#![cfg_attr(unix, feature(core_io_borrowed_buf))]
// ── submodules ──────────────────────────────────────────────────────────────

pub mod error;
pub use error::Error;

// ── merged from bun_io ──────────────────────────────────────────────────────
//
// `bun_io`'s `FilePoll`/`EventLoopCtx`/`ParentDeathWatchdog`/`Loop`/`Waker`
// scaffolding now lives here. The two crates were at the same dependency tier
// (both T2, neither reachable from `bun_event_loop`'s upward direction) and
// shared every dep; the only effect of the split was forcing the
// `bun_io::EventLoopHandle = *mut c_void` type-erasure seam between
// `BufferedReader` and `FilePoll`, which let callers smuggle a pointer to the
// wrong enum (`&AnyEventLoop` instead of `&EventLoopHandle`) and reinterpret
// the discriminant — a SIGABRT-at-best bug class. With both halves in one
// crate, `EventLoopHandle` is `EventLoopCtx` (the by-value `{kind, owner}`
// pair) and the seam is type-checked.

// `posix_event_loop` also defines what Windows shares (`js_vm_ctx`, `Owner`, `FileType`).
mod keep_alive;
pub mod posix_event_loop;
pub use keep_alive::{JsKeepAlive, KeepAlive};

// ParentDeathWatchdog: POSIX uses `PR_SET_PDEATHSIG` / `EVFILT_PROC` plus an
// exit-time descendant SIGKILL walk. Windows does both halves via Win32:
//   descendants  — a kill-on-close Job Object self-assigned at `enable()`;
//                  children inherit Job membership (nested jobs, Win8+), so
//                  when this process exits for any reason, including
//                  `TerminateProcess`, the kernel closes our Job handle and
//                  terminates every descendant.
//   parent watch — `RegisterWaitForSingleObject` on a `SYNCHRONIZE` handle to
//                  the original parent; the system thread pool invokes
//                  `on_parent_exit_cb` → `ExitProcess` when the parent's
//                  process object is signaled (i.e. has terminated).
// Downstream code calls `install()` / `enable()` / `is_enabled()`
// unconditionally, so both arms expose the same surface.
#[cfg(unix)]
#[path = "ParentDeathWatchdog.rs"]
pub mod parent_death_watchdog;
#[cfg(windows)]
pub mod parent_death_watchdog {
    use core::ffi::c_void;
    use core::sync::atomic::{AtomicBool, Ordering};
    use std::os::windows::io::{AsRawHandle as _, HandleOrNull, IntoRawHandle as _, OwnedHandle};

    use bun_core::wstr;
    use bun_sys::windows;

    use crate::posix_event_loop::EventLoopCtx;

    pub(crate) const EXIT_CODE: u8 = 128 + 1;

    static ENABLED: AtomicBool = AtomicBool::new(false);

    #[inline]
    pub fn is_enabled() -> bool {
        ENABLED.load(Ordering::Relaxed)
    }

    /// Called from `main()` before the CLI starts. Checks the env var and
    /// enables the watchdog; `bunfig.toml`'s `[run] noOrphans` and the
    /// `--no-orphans` flag call `enable()` directly later in startup.
    #[inline]
    pub fn install() {
        if !bun_core::env_var::BUN_FEATURE_FLAG_NO_ORPHANS
            .get()
            .unwrap_or(false)
        {
            return;
        }
        enable();
    }

    /// Idempotent. Creates an anonymous kill-on-close Job Object and assigns
    /// the current process to it, then registers a thread-pool wait on the
    /// original parent's process handle. Both handles are intentionally
    /// leaked for the process lifetime. Best-effort; on any failure the flag
    /// stays set so `run_command` still propagates the env var to nested Bun
    /// processes.
    #[cold]
    #[inline(never)]
    pub fn enable() {
        if ENABLED.swap(true, Ordering::Relaxed) {
            return;
        }
        // Export so a nested Bun spawned via `Bun.spawn([process.execPath,
        // ...])` self-arms its own Job and parent-watch (POSIX parity).
        let _ = windows::SetEnvironmentVariableW(
            wstr!("BUN_FEATURE_FLAG_NO_ORPHANS"),
            Some(wstr!("1")),
        );
        ensure_kill_on_close_job();
        arm_parent_watch();
    }

    static JOB_ASSIGNED: AtomicBool = AtomicBool::new(false);

    /// Self-assign to a kill-on-close Job Object without `SILENT_BREAKAWAY_OK`,
    /// so membership is inherited by every descendant (unlike libuv's spawn
    /// Job). Idempotent; handle leaked for process lifetime. Used by
    /// `--no-orphans` and unconditionally by `bun --filter`/`--parallel`.
    #[cold]
    #[inline(never)]
    pub fn ensure_kill_on_close_job() {
        if JOB_ASSIGNED.swap(true, Ordering::Relaxed) {
            return;
        }
        let Some(job) = windows::create_kill_on_close_job() else {
            return;
        };
        if windows::AssignProcessToJobObject(&job, windows::GetCurrentProcess()).is_ok() {
            let _ = job.into_raw_handle();
        }
    }

    /// Open a handle on the creating process and register a one-shot
    /// thread-pool wait on it. If the creator is already gone (OpenProcess
    /// reports no such PID, or the PID was recycled), exit immediately,
    /// matching the POSIX race branches in `ParentDeathWatchdog.rs`. If the
    /// creator exists but its DACL denies us (e.g. a SYSTEM service spawned
    /// us via `CreateProcessAsUser`), skip the parent watch best-effort; the
    /// Job Object half already covers descendants.
    fn arm_parent_watch() {
        const ERROR_INVALID_PARAMETER: u32 = 87;
        let ppid = getppid();
        if ppid == 0 {
            return;
        }
        // SAFETY: Win32 FFI; by-value args, failure → NULL. SYNCHRONIZE for
        // the wait, PROCESS_QUERY_LIMITED_INFORMATION for `GetProcessTimes`.
        let parent = unsafe {
            HandleOrNull::from_raw_handle(windows::OpenProcess(
                windows::SYNCHRONIZE | windows::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                ppid,
            ))
        };
        let Ok(parent) = OwnedHandle::try_from(parent) else {
            if windows::GetLastError() == ERROR_INVALID_PARAMETER {
                windows::kernel32::ExitProcess(EXIT_CODE as u32);
            }
            return;
        };
        // PID-reuse guard: `InheritedFromUniqueProcessId` is frozen at our
        // creation, so if the creator already exited and its PID was reused we
        // just opened an unrelated process. A real creator's creation time is
        // no later than ours; a reused PID's is strictly later.
        if !is_original_parent(parent.as_raw_handle()) {
            windows::kernel32::ExitProcess(EXIT_CODE as u32);
        }
        let mut wait: windows::HANDLE = core::ptr::null_mut();
        // SAFETY: `&mut wait` is a valid out-param; `parent` is a valid
        // waitable handle; `on_parent_exit_cb` has the `WAITORTIMERCALLBACK`
        // ABI; `Context` is unused.
        if unsafe {
            windows::RegisterWaitForSingleObject(
                &raw mut wait,
                parent.as_raw_handle(),
                on_parent_exit_cb,
                core::ptr::null_mut(),
                windows::INFINITE,
                windows::WT_EXECUTEONLYONCE,
            )
        } != 0
        {
            let _ = parent.into_raw_handle();
        }
    }

    /// `InheritedFromUniqueProcessId` via direct ntdll call. Not
    /// `uv_os_getppid`: libuv loads `NtQueryInformationProcess` lazily in
    /// `uv__winapi_init`, and `enable()` runs from `main()` before that.
    fn getppid() -> u32 {
        // SAFETY: out-param is a valid `PROCESS_BASIC_INFORMATION`; the pseudo
        // handle needs no access rights.
        unsafe {
            let mut pbi: windows::PROCESS_BASIC_INFORMATION = bun_core::ffi::zeroed_unchecked();
            let rc = windows::ntdll::NtQueryInformationProcess(
                windows::GetCurrentProcess(),
                windows::ProcessBasicInformation,
                core::ptr::from_mut(&mut pbi).cast(),
                core::mem::size_of::<windows::PROCESS_BASIC_INFORMATION>() as u32,
                core::ptr::null_mut(),
            );
            if !windows::NT_SUCCESS(rc) {
                return 0;
            }
            pbi.InheritedFromUniqueProcessId as u32
        }
    }

    fn is_original_parent(parent: windows::HANDLE) -> bool {
        let Ok(parent_times) = windows::GetProcessTimes(parent) else {
            return false;
        };
        let Ok(self_times) = windows::GetProcessTimes(windows::GetCurrentProcess()) else {
            return true;
        };
        parent_times.creation <= self_times.creation
    }

    /// Thread-pool callback: the parent's process object signaled. Matches the
    /// Linux `PR_SET_PDEATHSIG` SIGKILL path (hard exit, no Rust-side
    /// unwinding); the Job Object reaps descendants when our handles close.
    unsafe extern "system" fn on_parent_exit_cb(_ctx: *mut c_void, _timed_out: windows::BOOLEAN) {
        windows::kernel32::ExitProcess(EXIT_CODE as u32);
    }

    #[inline]
    pub fn install_on_event_loop(_handle: EventLoopCtx) {}
}
pub use parent_death_watchdog as ParentDeathWatchdog;

// ─── public surface (was bun_io's crate root) ──────────────────────────────

#[cfg(not(windows))]
pub use posix_event_loop::{FilePoll, Loop, OwnedFilePoll};
/// The raw `uv_loop_t`, which a `WindowsLoop` wraps.
#[cfg(windows)]
pub type Loop = bun_sys::windows::libuv::Loop;

pub use posix_event_loop::{IoEvent, Owner, PollTag, js_vm_ctx};

#[cfg(not(windows))]
pub type OpaqueCallback = unsafe extern "C" fn(*mut core::ffi::c_void);

// At crate root so the per-method `$crate::__EventLoopCtx__*` type aliases the
// macro emits (and the impl-macro reads back) actually resolve from impl
// crates.
//
// `loop_` is typed `&bun_uws_sys::Loop` (the uws
// wrapper — `PosixLoop`/`WindowsLoop`), NOT the cfg-aliased `crate::Loop`
// re-export. On POSIX those coincide, but on Windows `crate::Loop` is the raw
// `uv_loop_t` whereas the impl bodies
// (`VirtualMachine::uws_loop` / `MiniEventLoop::loop_`) hand back the wrapper.
bun_dispatch::link_interface! {
    pub EventLoopCtx[Js, Mini, SpawnSync] {
        fn loop_() -> &'static bun_uws_sys::Loop;
        #[cfg(not(windows))]
        fn file_polls_ptr() -> *const Store;
        fn increment_pending_unref_counter();
        #[cfg(not(windows))]
        fn after_event_loop_callback() -> Option<OpaqueCallback>;
        #[cfg(not(windows))]
        fn set_after_event_loop_callback(
            cb: Option<OpaqueCallback>,
            ctx: Option<core::ptr::NonNull<core::ffi::c_void>>,
        );
        #[cfg(not(windows))]
        fn pipe_read_scratch() -> *const PipeReadScratch;
    }
}

impl EventLoopCtx {
    #[inline]
    #[cfg(not(windows))]
    fn file_polls(&self) -> &Store {
        // SAFETY: owned by the VM/Mini loop, which is live (`EventLoopCtx::new`).
        unsafe { &*self.file_polls_ptr() }
    }
    /// Claims the per-loop pipe-read scratch; `None` while a read further up the stack holds it.
    #[inline]
    #[cfg(not(windows))]
    fn claim_pipe_read_scratch(&self) -> Option<PipeReadScratchGuard<'_>> {
        // SAFETY: as in `file_polls`.
        unsafe { (*self.pipe_read_scratch()).claim() }
    }
    #[inline]
    pub(crate) fn loop_ref(&self) {
        self.loop_().ref_();
    }
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn loop_unref(&self) {
        self.loop_().unref();
    }
    #[inline]
    #[cfg(windows)]
    pub(crate) fn loop_dec(&self) {
        self.loop_().dec();
    }
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn loop_add_active(&self, n: u32) {
        self.loop_().add_active(n);
    }
    #[inline]
    pub(crate) fn loop_sub_active(&self, n: u32) {
        self.loop_().sub_active(n);
    }
}
#[cfg(not(windows))]
pub use posix_event_loop::Store;

/// Mirrors posix_event_loop::Flags.
#[cfg(not(windows))]
pub use posix_event_loop::Flags as PollFlag;
/// Mirrors poll kind enum used by process.rs.
#[cfg(not(windows))]
pub use posix_event_loop::Flags as PollKind;

/// `file_poll` module — real one lives in posix_event_loop.rs.
#[cfg(not(windows))]
pub mod file_poll {
    pub use super::Store;
    pub use super::posix_event_loop::Flags;
}

// ── bun_io original submodules ──────────────────────────────────────────────

#[path = "heap.rs"]
pub mod heap;
// `source.rs` is Windows-only (libuv pipe/tty/file wrappers). On POSIX the
// `Source` type is never constructed; callers are themselves `#[cfg(windows)]`.
#[path = "MaxBuf.rs"]
pub mod max_buf;
#[path = "openForWriting.rs"]
pub mod open_for_writing_mod;
pub mod pipe_read_scratch;
#[path = "PipeReader.rs"]
pub mod pipe_reader;
#[path = "PipeWriter.rs"]
mod pipe_writer;
#[path = "pipes.rs"]
pub mod pipes;
pub use pipe_read_scratch::{PipeReadScratch, PipeReadScratchGuard};
#[cfg(windows)]
#[path = "source.rs"]
pub mod source;
#[path = "write.rs"]
pub mod write;

// ── re-exports for higher tiers ─────────────────────────────────────────────
// Byte-level `Write` trait + helpers. Downstream
// crates name these as `bun_io::Write` / `bun_io::FmtAdapter` /
// `bun_io::Result`.
pub use write::{AsFmt, DiscardingWriter, FixedBufferStream, FmtAdapter, IntLe, Result, Write};

pub use max_buf as MaxBuf;
pub use pipes::{Chunk, FileType, ReadState};

pub use pipe_writer::{
    BufferedWriteHandler, BufferedWriter, StreamBuffer, StreamingWriter, WriteHandler, WriteResult,
    WriteStatus,
};
#[cfg(windows)]
pub use source::{OwnedPipe, Source};

// Stub for never-constructed-on-POSIX `Source` so cross-platform sigs
// (`Option<Source>`) typecheck.

#[cfg(not(windows))]
pub use pipe_reader::PosixFlags;
pub use pipe_reader::{BufferedReader, ReadResult};

pub use open_for_writing_mod::{open_for_writing, open_for_writing_impl};

// ════════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
use core::ffi::c_int;
#[cfg(not(windows))]
use core::sync::atomic::{AtomicBool, Ordering};

pub use crate::closer::Closer;
pub use crate::waker::Waker;
#[cfg(not(windows))]
use bun_sys as sys;
use bun_sys::{E, Fd};

// `loop` is a Rust keyword, so the static is
// named `io_loop` but the runtime tagname is `"loop"` so `BUN_DEBUG_loop=1` works.
#[cfg(not(windows))]
#[allow(non_upper_case_globals)]
pub(crate) static io_loop: bun_core::output::ScopedLogger =
    bun_core::output::ScopedLogger::new("loop", bun_core::output::Visibility::Visible);
// All `log!` call sites are inside epoll/kqueue paths (Linux/macOS/FreeBSD).
#[cfg(not(windows))]
bun_core::define_scoped_log!(log, io_loop); // hand-declared static above (tagname "loop" is a keyword)

// ── libc shims with no preconditions ────────────────────────────────────────
// By-value scalar args only; the kernel validates and reports failure via the
// return value / errno — never UB. Local `safe fn` decls (vs. routing through
// the `libc` crate's raw items) move the proof into the type signature.
// Unused externs do not generate linker references, so per-target `#[cfg]` is
// unnecessary; every caller is gated.
#[cfg(unix)]
mod safe_c {
    use core::ffi::c_int;
    unsafe extern "C" {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub(super) safe fn kqueue() -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(super) safe fn epoll_create1(flags: c_int) -> c_int;
    }
}

// ─── platform type aliases ────────────────────────────────────────────────────

/// `bun_sys` has no `linux` constants module; alias the `libc` constants
/// locally so the call sites below stay terse.
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux {
    pub(crate) use libc::epoll_event;
    pub(crate) const EPOLL_IN: u32 = libc::EPOLLIN as u32;
    pub(crate) const EPOLL_OUT: u32 = libc::EPOLLOUT as u32;
    pub(crate) const EPOLL_ERR: u32 = libc::EPOLLERR as u32;
    pub(crate) const EPOLL_HUP: u32 = libc::EPOLLHUP as u32;
    pub(crate) const EPOLL_ET: u32 = libc::EPOLLET as u32;
    pub(crate) const EPOLL_ONESHOT: u32 = libc::EPOLLONESHOT as u32;
    pub(crate) const EPOLL_CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
    pub(crate) const EPOLL_CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
    pub(crate) const EPOLL_CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
}

/// Kqueue event struct. Darwin's kevent64_s carries a 2-slot ext[] used for
/// the optional generation-number assertion; FreeBSD's plain `struct kevent`
/// has `_ext[4]` but no public accessor, and we don't use it. See
/// `kevent_call` for the syscall difference.
#[cfg(target_os = "freebsd")]
type KEvent = libc::kevent;
#[cfg(target_os = "macos")]
type KEvent = libc::kevent64_s;

/// Thin shim over kevent64() vs kevent(). Darwin's kevent64 takes an extra
/// `flags` arg between nevents and timeout; FreeBSD's kevent does not.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[inline(always)]
fn kevent_call(
    kq: i32,
    changes: *const KEvent,
    nchanges: c_int,
    events: *mut KEvent,
    nevents: c_int,
    timeout: *const libc::timespec,
) -> isize {
    #[cfg(target_os = "freebsd")]
    {
        // SAFETY: thin wrapper over libc kevent; caller upholds invariants.
        return unsafe { libc::kevent(kq, changes, nchanges, events, nevents, timeout) as isize };
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: thin wrapper over libc kevent64; caller upholds invariants.
        return unsafe {
            libc::kevent64(kq, changes, nchanges, events, nevents, 0, timeout) as isize
        };
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
type EventType = linux::epoll_event;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
type EventType = KEvent;

// ─── IoRequestLoop ──────────────────────────────────────────────────────────
// The bare-kqueue/epoll request loop that backs
// `Bun.file(path).text()` / `Bun.write()` & friends (and nothing else; see the
// crate doc above). NOT the main event loop. Renamed from `Loop` so this
// crate's `Loop` (= `posix_event_loop::Loop` = the uws `us_loop_t` everyone
// actually means by "the loop") keeps its short name. Only one external caller
// (`bun_runtime::webcore::blob::io_parking`).

#[cfg(not(windows))]
pub struct IoRequestLoop {
    pub(crate) waker: Waker,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) epoll_fd: Fd,
    /// FreeBSD's `Waker` is `LinuxWaker` (an eventfd), so unlike macOS the
    /// waker fd is NOT itself a kqueue. We create one here and register the
    /// eventfd on it, mirroring how Linux registers the eventfd on epoll_fd.
    #[cfg(target_os = "freebsd")]
    pub(crate) kqueue_fd: Fd,
}

#[cfg(not(windows))]
static LOOP: bun_core::Once<IoRequestLoop> = bun_core::Once::new();
#[cfg(not(windows))]
static IS_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(not(windows))]
static INIT_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

#[cfg(not(windows))]
impl IoRequestLoop {
    /// On failure, closes the fds it opened so a later call can retry.
    fn init() -> sys::Result<Self> {
        #[cfg(not(target_os = "macos"))]
        use bun_sys::FdExt as _;

        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;
        #[cfg(not(target_os = "macos"))]
        let waker_fd = waker.get_fd();

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let epoll_fd = {
            let raw = safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
            if raw < 0 {
                let err = sys::Error::from_code(sys::get_errno(raw), sys::Tag::epoll_create1);
                waker_fd.close();
                return Err(err);
            }
            let epoll_fd = Fd::from_native(raw);

            {
                // No data: `on_update_epoll` skips an event without a `Pollable`.
                let mut epoll: linux::epoll_event = bun_core::ffi::zeroed();
                epoll.events =
                    linux::EPOLL_IN | linux::EPOLL_ET | linux::EPOLL_ERR | linux::EPOLL_HUP;
                // SAFETY: valid epoll fd + waker fd just created.
                let rc = unsafe {
                    libc::epoll_ctl(
                        epoll_fd.native(),
                        linux::EPOLL_CTL_ADD,
                        waker_fd.native(),
                        &raw mut epoll,
                    )
                };
                match sys::get_errno(rc) {
                    E::SUCCESS => {}
                    err => {
                        epoll_fd.close();
                        waker_fd.close();
                        return Err(sys::Error::from_code(err, sys::Tag::epoll_ctl));
                    }
                }
            }
            epoll_fd
        };

        #[cfg(target_os = "freebsd")]
        let kqueue_fd = {
            let kq = safe_c::kqueue();
            if kq < 0 {
                let err = sys::Error::from_code(sys::get_errno(kq), sys::Tag::kqueue);
                waker_fd.close();
                return Err(err);
            }
            let kqueue_fd = Fd::from_native(kq);
            // Register the eventfd waker. `on_update_kqueue` skips udata = 0 (the wakeup just unblocks
            // the kevent() wait so the pending queue gets drained). EV_CLEAR
            // makes it edge-triggered so we never need to read() the eventfd.
            // SAFETY: all-zero is a valid kevent (POD).
            let mut change: KEvent = bun_core::ffi::zeroed();
            change.ident = usize::try_from(waker_fd.native()).expect("int cast");
            change.filter = libc::EVFILT_READ;
            change.flags = libc::EV_ADD | libc::EV_CLEAR;
            // SAFETY: valid kqueue fd just created; passing 1 change, 0 events.
            let rc = unsafe {
                libc::kevent(
                    kqueue_fd.native(),
                    core::ptr::from_ref::<KEvent>(&change),
                    1,
                    core::ptr::null_mut(),
                    0,
                    core::ptr::null(),
                )
            };
            match sys::get_errno(rc as isize) {
                sys::Errno::SUCCESS => {}
                err => {
                    kqueue_fd.close();
                    waker_fd.close();
                    return Err(sys::Error::from_code(err, sys::Tag::kevent));
                }
            }
            kqueue_fd
        };

        Ok(IoRequestLoop {
            waker,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            epoll_fd,
            #[cfg(target_os = "freebsd")]
            kqueue_fd,
        })
    }

    /// Starts the IO thread on first use. If that fails, the next call retries.
    pub fn ensure_init<H: RequestHandler>() -> sys::Result<()> {
        if IS_RUNNING.load(Ordering::Acquire) {
            return Ok(());
        }
        let _guard = INIT_LOCK.lock_guard();
        let this = match LOOP.get() {
            Some(this) => this,
            None => {
                let request_loop = Self::init()?;
                LOOP.get_or_init(|| request_loop)
            }
        };
        if !IS_RUNNING.load(Ordering::Relaxed) {
            // A smaller thread, since it's not doing much. The JoinHandle detaches on drop.
            std::thread::Builder::new()
                .stack_size(1024 * 1024 * 2)
                .spawn(|| this.tick(&mut H::default()))
                .map_err(|err| {
                    sys::Error::from_code_int(
                        err.raw_os_error().unwrap_or(libc::EAGAIN),
                        sys::Tag::pthread_create,
                    )
                })?;
            IS_RUNNING.store(true, Ordering::Release);
        }
        Ok(())
    }

    /// Any thread: makes the IO thread call [`RequestHandler::process_pending`].
    pub fn wake() {
        LOOP.get()
            .expect("ensure_init() succeeded before wake()")
            .waker
            .wake();
    }

    pub(crate) fn tick(&self, handler: &mut impl RequestHandler) {
        let name = bun_core::zstr!("IO Watcher");
        bun_core::Output::Source::configure_named_thread(name);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.tick_epoll(handler);
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.tick_kqueue(handler);
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            panic!("TODO on this platform");
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn tick_epoll(&self, handler: &mut impl RequestHandler) {
        loop {
            handler.process_pending(&mut Changelist {
                watcher_fd: self.pollfd(),
            });

            // Zero-initialised (`epoll_event: Zeroable`) so the post-wait
            // `&events[..rc]` is a safe slice into an initialised array.
            let mut events: [EventType; 256] = [bun_core::ffi::zeroed(); 256];

            // SAFETY: valid epoll fd; events buffer length matches.
            let rc = unsafe {
                libc::epoll_wait(
                    self.pollfd().native(),
                    events.as_mut_ptr(),
                    c_int::try_from(events.len()).expect("int cast"),
                    i32::MAX,
                )
            };

            match sys::get_errno(rc) {
                E::EINTR => continue,
                E::SUCCESS => {}
                e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
            }

            let current_events = &events[..rc as usize];
            if rc != 0 {
                log!("epoll_wait({}) = {}", self.pollfd(), rc);
            }

            for event in current_events {
                Poll::on_update_epoll(*event, handler);
            }
        }
    }

    pub(crate) fn pollfd(&self) -> Fd {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return self.epoll_fd;
        }
        #[cfg(target_os = "freebsd")]
        {
            return self.kqueue_fd;
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            self.waker.get_fd()
        }
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn tick_kqueue(&self, handler: &mut impl RequestHandler) {
        loop {
            let mut changelist = Changelist {
                events_list: Vec::with_capacity(256),
            };
            handler.process_pending(&mut changelist);
            let mut events_list = changelist.events_list;

            let change_count = events_list.len();
            let capacity = events_list.capacity();

            let rc = kevent_call(
                self.pollfd().native(),
                events_list.as_ptr(),
                c_int::try_from(change_count).expect("int cast"),
                // The same array may be used for the changelist and eventlist.
                events_list.as_mut_ptr(),
                // we set 0 here so that if we get an error on
                // registration, it becomes errno
                c_int::try_from(capacity).expect("int cast"),
                core::ptr::null(),
            );

            match sys::get_errno(rc) {
                sys::Errno::EINTR => continue,
                sys::Errno::SUCCESS => {}
                e => bun_core::Output::panic(format_args!(
                    "kevent failed: {}",
                    <&'static str>::from(e)
                )),
            }

            let rc_len = usize::try_from(rc).expect("int cast");
            debug_assert!(rc_len <= capacity);
            // SAFETY: kernel wrote `rc_len` valid `KEvent`s into the Vec's
            // capacity (passed as `nevents` above); `rc_len <= capacity`.
            unsafe { events_list.set_len(rc_len) };

            for event in &events_list {
                Poll::on_update_kqueue(*event, handler);
            }
        }
    }
}

// ─── RequestHandler ───────────────────────────────────────────────────────────

/// Owns what waits on the IO thread, and lives there.
#[cfg(not(windows))]
pub trait RequestHandler: Default {
    /// Called before each wait.
    fn process_pending(&mut self, changelist: &mut Changelist);
    /// `pollable` can be one that was unregistered: epoll cannot remove a closed fd whose file is still open.
    fn on_update(&mut self, pollable: Pollable, result: sys::Result<()>);
}

/// kqueue: the changelist of the next `kevent`. epoll: each change is applied at once.
#[cfg(not(windows))]
pub struct Changelist {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    watcher_fd: Fd,
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    events_list: Vec<EventType>,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Changelist {
    /// One-shot.
    pub fn register(&mut self, pollable: Pollable, poll: &mut Poll, fd: Fd) -> sys::Result<()> {
        let flag = match pollable.tag {
            PollableTag::ReadFile => Flags::PollReadable,
            PollableTag::WriteFile => Flags::PollWritable,
        };
        poll.register_for_epoll(flag, pollable, self.watcher_fd, true, fd)
    }

    pub fn unregister(&mut self, poll: &mut Poll, fd: Fd) {
        log!(
            "close({}, registered={})",
            fd,
            poll.flags.contains(Flags::Registered)
        );
        // Unset if polling for readable/writable failed.
        if poll.flags.contains(Flags::WasEverRegistered) {
            poll.unregister_with_fd(self.watcher_fd, fd);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Changelist {
    /// One-shot. A failure is reported to [`RequestHandler::on_update`].
    pub fn register(&mut self, pollable: Pollable, poll: &mut Poll, fd: Fd) -> sys::Result<()> {
        let action = match pollable.tag {
            PollableTag::ReadFile => ApplyAction::Readable,
            PollableTag::WriteFile => ApplyAction::Writable,
        };
        Poll::apply_kqueue(action, pollable.to_bits(), poll, fd, self.add_one());
        Ok(())
    }

    pub fn unregister(&mut self, poll: &mut Poll, fd: Fd) {
        if poll.flags.contains(Flags::PollReadable) || poll.flags.contains(Flags::PollWritable) {
            // EV_DELETE matches by (ident, filter) alone, and a receipt for it (ENOENT, EBADF) has no receiver.
            Poll::apply_kqueue(ApplyAction::Cancel, 0, poll, fd, self.add_one());
        }
    }

    fn add_one(&mut self) -> &mut EventType {
        self.events_list.push_mut(bun_core::ffi::zeroed())
    }
}

/// For types that embed an
/// intrusive `io_request: uv::fs_t` and recover the parent in
/// `extern "C" fn(*mut uv::fs_t)` libuv callbacks.
///
/// Implement via [`intrusive_uv_fs!`].
///
/// # Safety
/// `UV_FS_OFFSET` MUST equal `core::mem::offset_of!(Self, <io_request field>)`.
#[cfg(windows)]
pub unsafe trait IntrusiveUvFs: Sized {
    /// `core::mem::offset_of!(Self, io_request)`.
    const UV_FS_OFFSET: usize;

    /// Take back the `Box<Self>` that was left to libuv, from the `*mut uv::fs_t` it passes back.
    ///
    /// # Safety
    /// `req` must point to the `fs_t` field at `Self::UV_FS_OFFSET` inside a
    /// leaked `Box<Self>` that nothing else takes back, and the pointer's provenance must cover the
    /// whole allocation.
    #[inline(always)]
    unsafe fn take_from_uv_fs(req: *mut bun_sys::windows::libuv::fs_t) -> Box<Self> {
        // SAFETY: caller upholds the trait safety contract above.
        unsafe { bun_core::heap::take(bun_core::container_of(req, Self::UV_FS_OFFSET)) }
    }
}

/// Implements [`IntrusiveUvFs`] for a struct that embeds an intrusive
/// `io_request: uv::fs_t` field.
#[cfg(windows)]
#[macro_export]
macro_rules! intrusive_uv_fs {
    ($ty:ty, $field:ident) => {
        // SAFETY: `UV_FS_OFFSET` is `offset_of!($ty, $field)`.
        unsafe impl $crate::IntrusiveUvFs for $ty {
            const UV_FS_OFFSET: usize = ::core::mem::offset_of!($ty, $field);
        }
    };
}

// ─── Pollable ─────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PollableTag {
    ReadFile = 1,
    WriteFile = 2,
}

/// What the kernel keeps for a registration, in `epoll_event.data.u64` / `kevent.udata`.
#[cfg(not(windows))]
#[derive(Clone, Copy)]
pub struct Pollable {
    pub tag: PollableTag,
    /// The low 30 bits are kept.
    pub index: u32,
    pub generation: u32,
}

#[cfg(not(windows))]
impl Pollable {
    const TAG_BITS: u32 = 2;

    /// `None` for the waker.
    fn from_bits(bits: u64) -> Option<Pollable> {
        Some(Pollable {
            tag: match bits % (1 << Self::TAG_BITS) {
                1 => PollableTag::ReadFile,
                2 => PollableTag::WriteFile,
                _ => return None,
            },
            index: bits as u32 >> Self::TAG_BITS,
            generation: (bits >> u32::BITS) as u32,
        })
    }

    fn to_bits(self) -> u64 {
        let low = self.index << Self::TAG_BITS | self.tag as u32;
        u64::from(self.generation) << u32::BITS | u64::from(low)
    }
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

#[cfg(all(target_os = "macos", debug_assertions))]
type GenerationNumberInt = u64;

// Only the IO thread touches this, so `Relaxed` is sufficient.
#[cfg(all(target_os = "macos", debug_assertions))]
static GENERATION_NUMBER_MONOTONIC: core::sync::atomic::AtomicU64 =
    core::sync::atomic::AtomicU64::new(0);

#[cfg(not(windows))]
pub struct Poll {
    flags: FlagsSet,
    #[cfg(all(target_os = "macos", debug_assertions))]
    pub(crate) generation_number: GenerationNumberInt,
}

#[cfg(not(windows))]
impl Default for Poll {
    fn default() -> Self {
        Self {
            flags: FlagsSet::empty(),
            #[cfg(all(target_os = "macos", debug_assertions))]
            generation_number: 0,
        }
    }
}

#[cfg(not(windows))]
pub type Tag = PollableTag;

#[cfg(not(windows))]
#[derive(enumset::EnumSetType)]
enum Flags {
    // What are we asking the event loop about?
    /// Poll for readable events
    PollReadable,

    /// Poll for writable events
    PollWritable,

    /// Poll for process-related events
    PollProcess,

    // What did the event loop tell us?
    Process,

    OneShot,
    NeedsRearm,

    WasEverRegistered,

    Registered,
}

#[cfg(not(windows))]
type FlagsSet = enumset::EnumSet<Flags>;

// A runtime parameter rather than a const generic: `adt_const_params`
// is nightly-only and the body never uses ACTION in a type position — it just
// `match`es on it.
// kqueue registration is not hot enough for the lost monomorphization to matter.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[derive(PartialEq, Eq, Clone, Copy)]
enum ApplyAction {
    Readable,
    Writable,
    Cancel,
}

#[cfg(not(windows))]
impl Poll {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    #[inline]
    fn apply_kqueue(
        action: ApplyAction,
        udata: u64,
        poll: &mut Poll,
        fd: Fd,
        kqueue_event: &mut KEvent,
    ) {
        log!(
            "register({}, {})",
            match action {
                ApplyAction::Readable => "readable",
                ApplyAction::Writable => "writable",
                ApplyAction::Cancel => "cancel",
            },
            fd
        );

        let one_shot_flag = libc::EV_ONESHOT;
        let (filter, flags_): (i16, u16) = match action {
            ApplyAction::Readable => (libc::EVFILT_READ, libc::EV_ADD | one_shot_flag),
            ApplyAction::Writable => (libc::EVFILT_WRITE, libc::EV_ADD | one_shot_flag),
            ApplyAction::Cancel => {
                if poll.flags.contains(Flags::PollReadable) {
                    (libc::EVFILT_READ, libc::EV_DELETE)
                } else if poll.flags.contains(Flags::PollWritable) {
                    (libc::EVFILT_WRITE, libc::EV_DELETE)
                } else {
                    unreachable!()
                }
            }
        };
        // SAFETY: all-zero is a valid KEvent (POD).
        *kqueue_event = bun_core::ffi::zeroed();
        // `ident` is `u64` on Darwin's `kevent64_s`, `usize` on FreeBSD `kevent`.
        // Assert so a stray -1 doesn't silently register ident=u64::MAX.
        debug_assert!(fd.native() >= 0, "register: negative fd {:?}", fd);
        kqueue_event.ident = fd.native() as _;
        kqueue_event.filter = filter;
        kqueue_event.flags = flags_;
        kqueue_event.udata = udata as _;
        // Darwin's kevent64_s.ext[0] carries the generation number for the
        // optional sanity assertion (GenerationNumberInt is u0 elsewhere).
        #[cfg(target_os = "macos")]
        {
            #[cfg(debug_assertions)]
            let gen_: u64 = if action == ApplyAction::Cancel {
                poll.generation_number
            } else {
                GENERATION_NUMBER_MONOTONIC.load(core::sync::atomic::Ordering::Relaxed)
            };
            #[cfg(not(debug_assertions))]
            let gen_: u64 = 0;
            kqueue_event.ext = [gen_, 0];
        }

        match action {
            ApplyAction::Readable => {
                poll.flags.insert(Flags::PollReadable);
            }
            ApplyAction::Writable => {
                poll.flags.insert(Flags::PollWritable);
            }
            ApplyAction::Cancel => {
                if poll.flags.contains(Flags::PollReadable) {
                    poll.flags.remove(Flags::PollReadable);
                } else if poll.flags.contains(Flags::PollWritable) {
                    poll.flags.remove(Flags::PollWritable);
                } else {
                    unreachable!();
                }
            }
        }

        // The generation-number sanity check rides in kevent64_s.ext[0],
        // which only exists on Darwin (GenerationNumberInt is u0 elsewhere).
        #[cfg(all(target_os = "macos", debug_assertions))]
        if action != ApplyAction::Cancel {
            // Only the IO thread mutates this counter; Relaxed is sufficient.
            poll.generation_number =
                GENERATION_NUMBER_MONOTONIC.fetch_add(1, core::sync::atomic::Ordering::Relaxed) + 1;
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn unregister_with_fd(&mut self, watcher_fd: Fd, fd: Fd) {
        // SAFETY: valid fds; null event is allowed for CTL_DEL on Linux ≥ 2.6.9.
        unsafe {
            libc::epoll_ctl(
                watcher_fd.native(),
                linux::EPOLL_CTL_DEL,
                fd.native(),
                core::ptr::null_mut(),
            );
        }
        self.flags.remove(Flags::Registered);
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn on_update_kqueue(event: KEvent, handler: &mut impl RequestHandler) {
        #[cfg(target_os = "macos")]
        if event.filter == libc::EVFILT_MACHPORT {
            return;
        }

        // The waker (whose event only exists to unblock kevent() so the pending
        // queue drains) and cancels are submitted with udata=0.
        let Some(pollable) = Pollable::from_bits(event.udata as u64) else {
            return;
        };
        // A changelist entry the kernel could not apply comes back with EV_ERROR
        // set (xnu ORs it into the action bits, FreeBSD replaces them) and the
        // errno in `data`.
        let result = if (event.flags & libc::EV_ERROR) != 0 {
            log!("error({}) = {}", event.ident, event.data);
            // `sys::Errno` may have no variant for it.
            Err(sys::Error::from_code_int(
                event.data as core::ffi::c_int,
                sys::Tag::kevent,
            ))
        } else {
            log!("ready({}) = {}", event.ident, event.data);
            Ok(())
        };
        handler.on_update(pollable, result);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn on_update_epoll(event: linux::epoll_event, handler: &mut impl RequestHandler) {
        // None for the waker, which is edge-triggered: no need to read its counter.
        let Some(pollable) = Pollable::from_bits(event.u64) else {
            return;
        };
        let result = if event.events & linux::EPOLL_ERR != 0 {
            let errno = sys::get_errno(event.events as isize);
            log!("error() = {:?}", errno);
            Err(sys::Error::from_code(errno, sys::Tag::epoll_ctl))
        } else {
            log!("ready()");
            Ok(())
        };
        handler.on_update(pollable, result);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    // `enumset::EnumSetType` cannot be a const generic, so `flag` is a runtime
    // arg. The `match` below preserves the exhaustiveness check.
    fn register_for_epoll(
        &mut self,
        flag: Flags,
        pollable: Pollable,
        watcher_fd: Fd,
        one_shot: bool,
        fd: Fd,
    ) -> sys::Result<()> {
        log!("register: {:?} ({})", flag as u8, fd);

        debug_assert!(fd != Fd::INVALID);

        if one_shot {
            self.flags.insert(Flags::OneShot);
        }

        let one_shot_flag: u32 = if !self.flags.contains(Flags::OneShot) {
            0
        } else {
            linux::EPOLL_ONESHOT
        };

        let flags: u32 = match flag {
            Flags::Process | Flags::PollReadable => {
                linux::EPOLL_IN | linux::EPOLL_HUP | linux::EPOLL_ERR | one_shot_flag
            }
            Flags::PollWritable => {
                linux::EPOLL_OUT | linux::EPOLL_HUP | linux::EPOLL_ERR | one_shot_flag
            }
            _ => unreachable!(),
        };

        let mut event = linux::epoll_event {
            events: flags,
            u64: pollable.to_bits(),
        };

        let op: i32 = if self.flags.contains(Flags::WasEverRegistered)
            || self.flags.contains(Flags::NeedsRearm)
        {
            linux::EPOLL_CTL_MOD
        } else {
            linux::EPOLL_CTL_ADD
        };

        // SAFETY: valid fds + event pointer.
        let ctl = unsafe {
            libc::epoll_ctl(
                watcher_fd.native(),
                op as c_int,
                fd.native(),
                &raw mut event,
            )
        };

        let errno = sys::get_errno(ctl);
        if errno != E::SUCCESS {
            return Err(sys::Error::from_code(errno, sys::Tag::epoll_ctl));
        }
        // Only mark if it successfully registered.
        // If it failed to register, we don't want to unregister it later if
        // it never had done so in the first place.
        self.flags.insert(Flags::Registered);
        self.flags.insert(Flags::WasEverRegistered);

        self.flags.insert(match flag {
            Flags::PollReadable => Flags::PollReadable,
            Flags::PollProcess => {
                if cfg!(any(target_os = "linux", target_os = "android")) {
                    Flags::PollReadable
                } else {
                    Flags::PollProcess
                }
            }
            Flags::PollWritable => Flags::PollWritable,
            _ => unreachable!(),
        });
        self.flags.remove(Flags::NeedsRearm);

        Ok(())
    }
}

pub const RETRY: E = E::EAGAIN;

pub type EventLoopHandle = EventLoopCtx;

#[cfg(not(windows))]
pub type FilePollFlag = posix_event_loop::Flags;

/// Moved from `bun_runtime::webcore::PathOrFileDescriptor`.
/// Owned here so `open_for_writing` has no upward dep; runtime re-exports it.
pub enum PathOrFileDescriptor<'a> {
    Path(&'a [u8]),
    Fd(Fd),
}

// ─── Waker (moved from bun_io) ──────────────────────────────────────────────
//
// io (T2) owns the
// Waker so `IoRequestLoop::init` has no upward dep on bun_io (T3). bun_io re-exports.

pub mod waker {
    #[cfg(not(windows))]
    use bun_sys::Fd;
    #[cfg(windows)]
    use core::sync::atomic::{AtomicPtr, Ordering};

    #[cfg(target_os = "macos")]
    pub type Waker = KEventWaker;
    /// FreeBSD 13+ has eventfd(2), so the Linux waker works as-is.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub type Waker = LinuxWaker;
    #[cfg(windows)]
    pub type Waker = WindowsWaker;

    // ── Linux / FreeBSD ───────────────────────────────────────────────────────

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub struct LinuxWaker {
        pub(crate) fd: Fd,
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    impl LinuxWaker {
        pub fn init() -> crate::error::Result<Self> {
            match bun_sys::eventfd(0, 0) {
                Ok(fd) => Ok(Self::init_with_file_descriptor(fd)),
                Err(err) => Err(bun_errno::SystemErrno::init(i64::from(err.errno))
                    .map(crate::Error::Sys)
                    .unwrap_or(crate::Error::Unexpected)),
            }
        }

        #[inline]
        pub(crate) fn get_fd(&self) -> Fd {
            self.fd
        }

        #[inline]
        fn init_with_file_descriptor(fd: Fd) -> Self {
            Self { fd }
        }

        pub fn wait(&self) {
            // eventfd reads are always exactly 8 bytes (u64 counter).
            let _ = bun_sys::read(self.fd, &mut [0; 8]);
        }

        pub fn wake(&self) {
            // eventfd writes are always exactly 8 bytes (u64 increment).
            let _ = bun_sys::write(self.fd, &1u64.to_ne_bytes());
        }
    }

    // ── macOS (kqueue + machport) ─────────────────────────────────────────────

    #[cfg(target_os = "macos")]
    use core::ffi::{c_int, c_void};

    #[cfg(target_os = "macos")]
    pub struct KEventWaker {
        kq: i32,
        machport: libc::mach_port_t,
        pub machport_buf: Box<[u8]>,
    }

    #[cfg(target_os = "macos")]
    type Kevent64 = libc::kevent64_s;

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        // Defined in src/io/io_darwin.cpp. `mach_port_t` is a by-value `u32`;
        // bad/dead ports are reported by mach return codes, not UB.
        fn io_darwin_create_machport(kq: i32, buf: *mut c_void, len: usize) -> libc::mach_port_t;
        safe fn io_darwin_schedule_wakeup(port: libc::mach_port_t) -> bool;
    }

    #[cfg(target_os = "macos")]
    impl KEventWaker {
        // SAFETY: all-zero is a valid kevent64_s array (POD).
        const ZEROED: [Kevent64; 16] = bun_core::ffi::zeroed();

        pub fn wake(&self) {
            let _ = io_darwin_schedule_wakeup(self.machport);
        }

        #[inline]
        pub(crate) fn get_fd(&self) -> Fd {
            Fd::from_native(self.kq)
        }

        pub fn wait(&self) {
            let mut events = Self::ZEROED;
            // SAFETY: FFI syscall; pointers reference a stack-local array valid for the call.
            unsafe {
                libc::kevent64(
                    self.kq,
                    events.as_ptr(),
                    0,
                    events.as_mut_ptr(),
                    c_int::try_from(events.len()).expect("int cast"),
                    0,
                    core::ptr::null(),
                );
            }
        }

        pub fn init() -> crate::error::Result<Self> {
            let kq = crate::safe_c::kqueue();
            if kq < 0 {
                return Err(
                    bun_errno::SystemErrno::init(bun_errno::posix::errno() as i64)
                        .map(crate::Error::Sys)
                        .unwrap_or(crate::Error::Unexpected),
                );
            }
            Self::init_with_file_descriptor(kq)
        }

        pub(crate) fn init_with_file_descriptor(kq: i32) -> crate::error::Result<Self> {
            debug_assert!(kq > -1);
            // Box<[u8]> owns the buffer for the machport's lifetime.
            let mut machport_buf = vec![0u8; 1024].into_boxed_slice();
            // SAFETY: FFI call; buf outlives the machport (owned by the returned Waker).
            let machport = unsafe {
                io_darwin_create_machport(kq, machport_buf.as_mut_ptr().cast::<c_void>(), 1024)
            };
            if machport == 0 {
                return Err(crate::Error::MachportCreationFailed);
            }
            Ok(Self {
                kq,
                machport,
                machport_buf,
            })
        }
    }

    // ── Windows (uws WindowsLoop wakeup) ──────────────────────────────────────

    #[cfg(windows)]
    pub struct WindowsWaker {
        /// The loop of the thread that called `init`. Other threads only wake it. `AtomicPtr` only to be `Sync`.
        loop_: AtomicPtr<bun_uws_sys::WindowsLoop>,
    }

    #[cfg(windows)]
    impl WindowsWaker {
        pub fn init() -> crate::error::Result<Self> {
            let loop_: &bun_uws_sys::WindowsLoop = bun_uws_sys::WindowsLoop::get();
            Ok(Self {
                loop_: AtomicPtr::new(core::ptr::from_ref(loop_).cast_mut()),
            })
        }

        /// On the thread that called `init`.
        pub fn wait(&self) {
            bun_uws_sys::WindowsLoop::get().run();
        }

        pub fn wake(&self) {
            // Relaxed: only `init` writes it, before the waker is shared.
            let loop_ = self.loop_.load(Ordering::Relaxed);
            // SAFETY: `loop_` came from `WindowsLoop::get()`, which is `&'static`;
            // `us_wakeup_loop` → `uv_async_send` is documented thread-safe.
            unsafe { bun_uws_sys::loop_::us_wakeup_loop(loop_) };
        }
    }
}

// ─── Closer (moved from bun_io) ─────────────────────────────────────────────
//
// Schedules an async fd close on the
// thread pool (POSIX) or via uv_fs_close (Windows). io (T2) owns it so
// `pipes::PipeHandle::close` has no upward dep on bun_io (T3).

pub mod closer {
    use bun_sys::Fd;

    // ── POSIX ────────────────────────────────────────────────────────────────

    #[cfg(not(windows))]
    use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

    #[cfg(not(windows))]
    #[repr(C)]
    pub struct Closer {
        pub(crate) fd: Fd,
        task: WorkPoolTask,
    }

    #[cfg(not(windows))]
    bun_threading::intrusive_work_task!(Closer, task);
    #[cfg(not(windows))]
    impl bun_threading::work_pool::OwnedTask for Closer {
        fn run(self: Box<Self>) {
            use bun_sys::FdExt;
            self.fd.close();
        }
    }

    #[cfg(not(windows))]
    impl Closer {
        /// `_compat`: for signature compatibility with the Windows version.
        pub fn close(fd: Fd, _compat: ()) {
            debug_assert!(fd.is_valid());
            WorkPool::schedule_owned(Box::new(Closer {
                fd,
                task: WorkPoolTask::default(),
            }));
        }
    }

    // ── Windows ──────────────────────────────────────────────────────────────

    #[cfg(windows)]
    use bun_sys::ReturnCodeExt as _;
    #[cfg(windows)]
    use bun_sys::windows::libuv as uv;

    #[cfg(windows)]
    pub struct Closer;

    #[cfg(windows)]
    impl Closer {
        pub fn close(fd: Fd, loop_: &uv::Loop) {
            let req = bun_ptr::AliasableBox::from(bun_core::boxed_zeroed::<uv::fs_t>());
            // SAFETY: `req` stays put until `on_close` takes it.
            let rc = unsafe { uv::uv_fs_close(loop_, req.as_ptr(), fd.uv(), Some(Self::on_close)) };
            if let Some(err) = rc.errno() {
                bun_core::debug_warn!("libuv close() failed = {:?}", err);
                return;
            }
            let _ = req.into_raw();
        }

        extern "C" fn on_close(req: *mut uv::fs_t) {
            // SAFETY: the box `close` gave up.
            let req = unsafe { bun_core::heap::take(req) };
            bun_sys::syslog!(
                "uv_fs_close({}) = {}",
                // SAFETY: `uv_fs_close` populated the `fd` arm of the union.
                Fd::from_uv(unsafe { req.file_fd() }),
                req.result
            );

            #[cfg(debug_assertions)]
            if let Some(err) = req.result.errno() {
                bun_core::debug_warn!("libuv close() failed = {:?}", err);
            }
        }
    }
}
