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
    use std::os::windows::io::{AsRawHandle as _, IntoRawHandle as _};

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
        let Some(ppid @ 1..) = windows::parent_process_id() else {
            return;
        };
        // For the wait and for `GetProcessTimes`.
        let access = windows::SYNCHRONIZE | windows::PROCESS_QUERY_LIMITED_INFORMATION;
        let parent = match windows::OpenProcess(access, ppid) {
            Ok(parent) => parent,
            Err(windows::Win32Error::INVALID_PARAMETER) => {
                windows::kernel32::ExitProcess(EXIT_CODE as u32)
            }
            Err(_) => return,
        };
        // PID-reuse guard: `InheritedFromUniqueProcessId` is frozen at our
        // creation, so if the creator already exited and its PID was reused we
        // just opened an unrelated process. A real creator's creation time is
        // no later than ours; a reused PID's is strictly later.
        if !is_original_parent(parent.as_raw_handle()) {
            windows::kernel32::ExitProcess(EXIT_CODE as u32);
        }
        let _ = windows::call_when_signaled(parent, on_parent_exit_cb);
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
    extern "system" fn on_parent_exit_cb(_ctx: *mut c_void, _timed_out: windows::BOOLEAN) {
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

/// How a [`Loop`] is handed around: libuv's functions take a pointer.
#[cfg(not(windows))]
pub type LoopRef = &'static Loop;
#[cfg(windows)]
pub type LoopRef = *mut Loop;

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
pub use source::Source;

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
use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::{self as sys, E};

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
// (`bun_runtime::webcore::Blob`).

#[cfg(not(windows))]
pub struct IoRequestLoop {
    pub(crate) pending: RequestQueue,
    pub(crate) waker: Waker,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) epoll_fd: sys::File,
    /// FreeBSD's `Waker` is `LinuxWaker` (an eventfd), so unlike macOS the
    /// waker fd is NOT itself a kqueue. We create one here and register the
    /// eventfd on it, mirroring how Linux registers the eventfd on epoll_fd.
    #[cfg(target_os = "freebsd")]
    pub(crate) kqueue_fd: sys::File,
}

#[cfg(not(windows))]
static LOOP: bun_core::Once<IoRequestLoop> = bun_core::Once::new();
#[cfg(not(windows))]
static IS_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(not(windows))]
static INIT_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

#[cfg(not(windows))]
impl IoRequestLoop {
    fn init() -> sys::Result<Self> {
        let waker = Waker::init().map_err(|err| {
            let errno = match err {
                crate::Error::Sys(errno) => errno,
                _ => E::ENOMEM,
            };
            sys::Error::from_code(errno, sys::Tag::open)
        })?;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let epoll_fd = {
            let raw = safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
            if raw < 0 {
                return Err(sys::Error::from_code(
                    sys::get_errno(raw),
                    sys::Tag::epoll_create1,
                ));
            }
            let epoll_fd = sys::File::from_fd(Fd::from_native(raw));

            {
                // No data: no `Poll` has the ticket 0.
                let mut epoll: linux::epoll_event = bun_core::ffi::zeroed();
                epoll.events =
                    linux::EPOLL_IN | linux::EPOLL_ET | linux::EPOLL_ERR | linux::EPOLL_HUP;
                // SAFETY: valid epoll fd + waker fd just created.
                let rc = unsafe {
                    libc::epoll_ctl(
                        epoll_fd.fd().native(),
                        linux::EPOLL_CTL_ADD,
                        waker.get_fd().native(),
                        &raw mut epoll,
                    )
                };
                match sys::get_errno(rc) {
                    E::SUCCESS => {}
                    err => return Err(sys::Error::from_code(err, sys::Tag::epoll_ctl)),
                }
            }
            epoll_fd
        };

        #[cfg(target_os = "freebsd")]
        let kqueue_fd = {
            let kq = safe_c::kqueue();
            if kq < 0 {
                return Err(sys::Error::from_code(sys::get_errno(kq), sys::Tag::kqueue));
            }
            let kqueue_fd = sys::File::from_fd(Fd::from_native(kq));
            // Register the eventfd waker. udata = 0 → Pollable.tag() == .empty,
            // which onUpdateKQueue treats as a no-op (the wakeup just unblocks
            // the kevent() wait so the pending queue gets drained). EV_CLEAR
            // makes it edge-triggered so we never need to read() the eventfd.
            // SAFETY: all-zero is a valid kevent (POD).
            let mut change: KEvent = bun_core::ffi::zeroed();
            change.ident = usize::try_from(waker.get_fd().native()).expect("int cast");
            change.filter = libc::EVFILT_READ;
            change.flags = libc::EV_ADD | libc::EV_CLEAR;
            // SAFETY: valid kqueue fd just created; passing 1 change, 0 events.
            let rc = unsafe {
                libc::kevent(
                    kqueue_fd.fd().native(),
                    core::ptr::from_ref::<KEvent>(&change),
                    1,
                    core::ptr::null_mut(),
                    0,
                    core::ptr::null(),
                )
            };
            match sys::get_errno(rc as isize) {
                sys::Errno::SUCCESS => {}
                err => return Err(sys::Error::from_code(err, sys::Tag::kevent)),
            }
            kqueue_fd
        };

        Ok(IoRequestLoop {
            pending: RequestQueue::default(),
            waker,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            epoll_fd,
            #[cfg(target_os = "freebsd")]
            kqueue_fd,
        })
    }

    /// Starts the IO thread on first use. If that fails, the next call retries.
    pub fn ensure_init() -> sys::Result<()> {
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
                .spawn(|| this.tick())
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

    /// Enqueue `request` for the IO thread to pick up. Safe to call from any
    /// thread: only touches the lock-free `pending` queue and the
    /// async-signal-safe `waker`. This is the *only* cross-thread entry
    /// point — every other `IoRequestLoop` method is IO-thread-only.
    ///
    /// Callers must call `ensure_init()` and handle its error before scheduling
    /// an operation's first request.
    pub fn schedule(request: &mut Request) {
        let this = LOOP
            .get()
            .expect("ensure_init() succeeded before schedule()");
        debug_assert!(!request.scheduled);
        request.scheduled = true;
        this.pending.push(core::ptr::NonNull::from(request));
        this.waker.wake();
    }

    pub(crate) fn tick(&self) {
        let name = bun_core::zstr!("IO Watcher");
        bun_core::Output::Source::configure_named_thread(name);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.tick_epoll();
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.tick_kqueue();
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
    pub(crate) fn tick_epoll(&self) {
        let mut tickets = Tickets::default();
        loop {
            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                let watcher_fd = self.pollfd();

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() {
                        break;
                    }
                    // SAFETY: pop_batch yields live nodes pushed by `schedule()`.
                    let request = unsafe { &mut *request_ptr };
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            match readable.poll.register_for_epoll(
                                Flags::PollReadable,
                                readable.tag,
                                &mut tickets,
                                watcher_fd,
                                true,
                                readable.fd,
                            ) {
                                Err(err) => {
                                    (readable.on_error)(readable.ctx, &err);
                                }
                                Ok(()) => {}
                            }
                        }
                        Action::Writable(writable) => {
                            match writable.poll.register_for_epoll(
                                Flags::PollWritable,
                                writable.tag,
                                &mut tickets,
                                watcher_fd,
                                true,
                                writable.fd,
                            ) {
                                Err(err) => {
                                    (writable.on_error)(writable.ctx, &err);
                                }
                                Ok(()) => {}
                            }
                        }
                        Action::Close(close) => {
                            log!(
                                "close({}, registered={})",
                                close.fd,
                                close.poll.flags.contains(Flags::Registered)
                            );
                            close.poll.unregister(close.fd);
                            tickets.armed.remove(&close.poll.ticket);
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

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
                // None for the waker too, which is edge-triggered: no need to read its counter.
                if let Some((poll, tag)) = tickets.armed.remove(&{ event.u64 }) {
                    Poll::on_update_epoll(poll, tag, *event);
                }
            }
        }
    }

    pub(crate) fn pollfd(&self) -> Fd {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return self.epoll_fd.fd();
        }
        #[cfg(target_os = "freebsd")]
        {
            return self.kqueue_fd.fd();
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            self.waker.get_fd()
        }
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn tick_kqueue(&self) {
        loop {
            let mut events_list: Vec<EventType> = Vec::with_capacity(256);

            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                events_list.reserve(pending.batch.count);
                // `reserve` above ⇒ no realloc; apply_kqueue
                // fully overwrites the slot so the zero is a safe placeholder.
                #[inline(always)]
                fn add_one(list: &mut Vec<EventType>) -> &mut EventType {
                    debug_assert!(list.len() < list.capacity());
                    list.push(bun_core::ffi::zeroed());
                    list.last_mut().unwrap()
                }

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() {
                        break;
                    }
                    // SAFETY: pop_batch yields live nodes pushed by `schedule()`.
                    let request = unsafe { &mut *request_ptr };
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            Poll::apply_kqueue(
                                ApplyAction::Readable,
                                readable.tag,
                                readable.poll,
                                readable.fd,
                                add_one(&mut events_list),
                            );
                        }
                        Action::Writable(writable) => {
                            Poll::apply_kqueue(
                                ApplyAction::Writable,
                                writable.tag,
                                writable.poll,
                                writable.fd,
                                add_one(&mut events_list),
                            );
                        }
                        Action::Close(close) => {
                            if close.poll.flags.contains(Flags::PollReadable)
                                || close.poll.flags.contains(Flags::PollWritable)
                            {
                                Poll::apply_kqueue(
                                    ApplyAction::Cancel,
                                    close.tag,
                                    close.poll,
                                    close.fd,
                                    add_one(&mut events_list),
                                );
                            }
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

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
                Poll::on_update_kqueue(*event);
            }
        }
    }
}

// ─── Request ──────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub struct Request {
    pub next: bun_threading::Link<Request>,
    pub callback: for<'a> fn(&'a mut Request) -> Action<'a>,
    pub scheduled: bool,
}

#[cfg(not(windows))]
impl Request {
    #[inline]
    pub fn new(callback: for<'a> fn(&'a mut Request) -> Action<'a>) -> Self {
        Self {
            next: bun_threading::Link::new(),
            callback,
            scheduled: false,
        }
    }
}

/// For types that embed an intrusive `io_request: uv::fs_t` and recover the parent in
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

// Intrusive MPSC queue keyed on the `next` field.
//
// `next` is stored as `AtomicPtr<Request>`; the non-atomic accessor
// paths (`get_next`/`set_next`, used only by the batch iterator and the
// debug-mode `pushBatch` reachability assert) lower to `Relaxed` ops.
// SAFETY: `next` is the sole intrusive link for `UnboundedQueue(Request, .next)`.
#[cfg(not(windows))]
unsafe impl bun_threading::Linked for Request {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

#[cfg(not(windows))]
pub(crate) type RequestQueue = bun_threading::UnboundedQueue<Request>;

// ─── Action ───────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub enum Action<'a> {
    Readable(FileAction<'a>),
    Writable(FileAction<'a>),
    Close(CloseAction<'a>),
}

#[cfg(not(windows))]
pub struct FileAction<'a> {
    pub fd: Fd,
    pub poll: &'a mut Poll,
    pub ctx: *mut (),
    pub tag: PollableTag,
    pub on_error: fn(*mut (), &sys::Error),
}

#[cfg(not(windows))]
pub struct CloseAction<'a> {
    pub fd: Fd,
    pub poll: &'a mut Poll,
    pub ctx: *mut (),
    pub tag: PollableTag,
    pub on_done: fn(*mut ()),
}

// ─── Pollable ─────────────────────────────────────────────────────────────────

// Invariant: the repr must fit `bun.TaggedPointer.Tag` (the 15-bit tag packed
// into `Pollable`'s u64 below) — keep `#[repr(u16)]` and values < 2^15.
#[cfg(not(windows))]
#[repr(u16)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PollableTag {
    Empty = 0,
    ReadFile,
    WriteFile,
}

/// §Dispatch (PORTING.md): `bun.ptr.TaggedPointer` should normally be split
/// into `(tag: u8, ptr: *mut ())`. Here the value must round-trip through a
/// single `u64` (`kevent.udata`), so we keep the
/// packed addr:49 + tag:15 layout locally.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[derive(Clone, Copy)]
struct Pollable {
    value: u64,
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const POLLABLE_ADDR_BITS: u64 = 49;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const POLLABLE_ADDR_MASK: u64 = (1u64 << POLLABLE_ADDR_BITS) - 1;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
impl Pollable {
    fn init(t: PollableTag, p: *mut Poll) -> Pollable {
        let addr = p as usize as u64;
        debug_assert!(addr & !POLLABLE_ADDR_MASK == 0);
        Pollable {
            value: (addr & POLLABLE_ADDR_MASK) | ((t as u64) << POLLABLE_ADDR_BITS),
        }
    }

    fn from(int: u64) -> Pollable {
        Pollable { value: int }
    }

    fn poll(self) -> *mut Poll {
        (self.value & POLLABLE_ADDR_MASK) as usize as *mut Poll
    }

    fn tag(self) -> PollableTag {
        // Tag was written by `init` from a valid `PollableTag` discriminant.
        match (self.value >> POLLABLE_ADDR_BITS) as u16 {
            0 => PollableTag::Empty,
            1 => PollableTag::ReadFile,
            2 => PollableTag::WriteFile,
            // Only `init` writes the tag bits, so any other value is memory
            // corruption / a logic bug — trap rather than fabricate a
            // discriminant.
            n => unreachable!("invalid PollableTag {n}"),
        }
    }

    fn ptr(self) -> u64 {
        self.value
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
    pub flags: FlagsSet,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    ticket: u64,
    #[cfg(all(target_os = "macos", debug_assertions))]
    pub(crate) generation_number: GenerationNumberInt,
}

#[cfg(not(windows))]
impl Default for Poll {
    fn default() -> Self {
        Self {
            flags: FlagsSet::empty(),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            ticket: 0,
            #[cfg(all(target_os = "macos", debug_assertions))]
            generation_number: 0,
        }
    }
}

/// What epoll has in place of an address. An entry outlives its `Poll` if script closes the
/// descriptor while a duplicate is open: it can no longer be removed.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[derive(Default)]
struct Tickets {
    last: u64,
    armed: std::collections::BTreeMap<u64, (core::ptr::NonNull<Poll>, PollableTag)>,
}

#[cfg(not(windows))]
pub type Tag = PollableTag;

#[cfg(not(windows))]
unsafe extern "Rust" {
    /// Hot-path dispatch for `Pollable` owners. The concrete owners
    /// (`ReadFile` / `WriteFile`) live in `bun_runtime::webcore::blob` (T6);
    /// io (T2) only knows the embedded `*mut Poll` and the tag. The body is
    /// `#[no_mangle]` in `bun_runtime::dispatch` and recovers the parent
    /// struct via `container_of(io_poll)`.
    /// Cold path — only Bun.write / Bun.file().text() reach this.
    fn __bun_io_pollable_on_ready(tag: PollableTag, poll: *mut Poll);
    fn __bun_io_pollable_on_io_error(tag: PollableTag, poll: *mut Poll, err: &sys::Error);
}

#[cfg(not(windows))]
#[derive(enumset::EnumSetType)]
pub enum Flags {
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
pub type FlagsSet = enumset::EnumSet<Flags>;

// A runtime parameter rather than a const generic: `adt_const_params`
// is nightly-only and the body never uses ACTION in a type position — it just
// `match`es on it.
// Three call sites, each with a literal variant — trivially inlined; kqueue
// registration is not hot enough for the lost monomorphization to matter.
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
    pub(crate) fn apply_kqueue(
        action: ApplyAction,
        tag: PollableTag,
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
        let owner = Pollable::init(tag, std::ptr::from_mut::<Poll>(poll)).ptr() as usize;
        // A cancel carries no udata: its owner is finished (`on_done` runs right
        // after), EV_DELETE matches by (ident, filter) alone, and any receipt for it
        // (knote already fired → ENOENT, fd closed → EBADF) must land on the
        // `PollableTag::Empty` early return, not on the stale owner.
        let (filter, flags_, udata): (i16, u16, usize) = match action {
            ApplyAction::Readable => (libc::EVFILT_READ, libc::EV_ADD | one_shot_flag, owner),
            ApplyAction::Writable => (libc::EVFILT_WRITE, libc::EV_ADD | one_shot_flag, owner),
            ApplyAction::Cancel => {
                if poll.flags.contains(Flags::PollReadable) {
                    (libc::EVFILT_READ, libc::EV_DELETE, 0)
                } else if poll.flags.contains(Flags::PollWritable) {
                    (libc::EVFILT_WRITE, libc::EV_DELETE, 0)
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

    /// The thread that has the job. epoll keeps a one-shot entry that has fired.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn unregister(&mut self, fd: Fd) {
        let (true, Some(io)) = (self.flags.remove(Flags::WasEverRegistered), LOOP.get()) else {
            return;
        };
        // SAFETY: valid fds; null event is allowed for CTL_DEL on Linux ≥ 2.6.9.
        unsafe {
            libc::epoll_ctl(
                io.pollfd().native(),
                linux::EPOLL_CTL_DEL,
                fd.native(),
                core::ptr::null_mut(),
            );
        }
        self.flags.remove(Flags::Registered);
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn on_update_kqueue(event: KEvent) {
        #[cfg(target_os = "macos")]
        if event.filter == libc::EVFILT_MACHPORT {
            return;
        }

        let pollable = Pollable::from(event.udata as u64);
        let tag = pollable.tag();
        // The waker (whose event only exists to unblock kevent() so the pending
        // queue drains) and cancels are submitted with udata=0 → tag=.empty.
        if tag == PollableTag::Empty {
            return;
        }
        let poll = pollable.poll();
        // CYCLEBREAK: owner (ReadFile/WriteFile) is T6; dispatch via link-time
        // `extern "Rust"` defined in `bun_runtime::dispatch`. The
        // container_of(io_poll) recovery happens there.
        // A changelist entry the kernel could not apply comes back with EV_ERROR
        // set (xnu ORs it into the action bits, FreeBSD replaces them) and the
        // errno in `data`.
        if (event.flags & libc::EV_ERROR) != 0 {
            log!("error({}) = {}", event.ident, event.data);
            // SAFETY: poll is the `io_poll` field of a live owner; link-time
            // extern body matches on `tag`.
            unsafe {
                __bun_io_pollable_on_io_error(
                    tag,
                    poll,
                    // `event.data` is a kernel-supplied errno; do NOT transmute into the
                    // closed `sys::Errno` enum (size mismatch on darwin/freebsd where it
                    // is `#[repr(u16)]`, and UB for unmapped discriminants). Store the
                    // raw integer via `from_code_int`.
                    &sys::Error::from_code_int(event.data as core::ffi::c_int, sys::Tag::kevent),
                )
            };
        } else {
            log!("ready({}) = {}", event.ident, event.data);
            // SAFETY: as above.
            unsafe { __bun_io_pollable_on_ready(tag, poll) };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn on_update_epoll(
        poll: core::ptr::NonNull<Poll>,
        tag: PollableTag,
        event: linux::epoll_event,
    ) {
        // ignore empty tags. This case should be unreachable in practice
        if tag == PollableTag::Empty {
            return;
        }
        let poll = poll.as_ptr();
        // CYCLEBREAK: owner (ReadFile/WriteFile) is T6; dispatch via link-time
        // `extern "Rust"` defined in `bun_runtime::dispatch`. The
        // container_of(io_poll) recovery happens there.
        if event.events & linux::EPOLL_ERR != 0 {
            let errno = sys::get_errno(event.events as isize);
            log!("error() = {:?}", errno);
            // SAFETY: poll is the `io_poll` field of a live owner; link-time
            // extern body matches on `tag`.
            unsafe {
                __bun_io_pollable_on_io_error(
                    tag,
                    poll,
                    &sys::Error::from_code(errno, sys::Tag::epoll_ctl),
                )
            };
        } else {
            log!("ready()");
            // SAFETY: as above.
            unsafe { __bun_io_pollable_on_ready(tag, poll) };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    // `enumset::EnumSetType` cannot be a const generic, so `flag` is a runtime
    // arg. The `match` below preserves the exhaustiveness check.
    fn register_for_epoll(
        &mut self,
        flag: Flags,
        tag: PollableTag,
        tickets: &mut Tickets,
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

        tickets.last += 1;
        self.ticket = tickets.last;
        let mut event = linux::epoll_event {
            events: flags,
            u64: self.ticket,
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
            // Not left to the pool: the next job on the descriptor may be faster.
            self.unregister(fd);
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
        tickets.armed.insert(self.ticket, (self.into(), tag));

        Ok(())
    }
}

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
    use bun_sys::{Fd, File};
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
        eventfd: File,
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    impl LinuxWaker {
        pub fn init() -> crate::error::Result<Self> {
            match bun_sys::eventfd(0, 0) {
                Ok(fd) => Ok(Self {
                    eventfd: File::from_fd(fd),
                }),
                Err(err) => Err(bun_errno::SystemErrno::init(i64::from(err.errno))
                    .map(crate::Error::Sys)
                    .unwrap_or(crate::Error::Unexpected)),
            }
        }

        #[inline]
        pub(crate) fn get_fd(&self) -> Fd {
            self.eventfd.fd()
        }

        pub fn wait(&self) {
            let _ = self.eventfd.read(&mut [0; size_of::<u64>()]);
        }

        pub fn wake(&self) {
            let _ = bun_sys::write(self.get_fd(), &1u64.to_ne_bytes());
        }
    }

    // ── macOS (kqueue + machport) ─────────────────────────────────────────────

    #[cfg(target_os = "macos")]
    use core::ffi::{c_int, c_void};

    #[cfg(target_os = "macos")]
    pub struct KEventWaker {
        kq: File,
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
            self.kq.fd()
        }

        pub fn wait(&self) {
            let mut events = Self::ZEROED;
            // SAFETY: FFI syscall; pointers reference a stack-local array valid for the call.
            unsafe {
                libc::kevent64(
                    self.kq.fd().native(),
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
            let kq = File::from_fd(Fd::from_native(kq));
            // Box<[u8]> owns the buffer for the machport's lifetime.
            let mut machport_buf = vec![0u8; 1024].into_boxed_slice();
            // SAFETY: FFI call; buf outlives the machport (owned by the returned Waker).
            let machport = unsafe {
                io_darwin_create_machport(
                    kq.fd().native(),
                    machport_buf.as_mut_ptr().cast::<c_void>(),
                    1024,
                )
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
    use bun_sys::File;

    // ── POSIX ────────────────────────────────────────────────────────────────

    #[cfg(not(windows))]
    use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

    #[cfg(not(windows))]
    #[repr(C)]
    pub struct Closer {
        file: File,
        task: WorkPoolTask,
    }

    #[cfg(not(windows))]
    bun_threading::intrusive_work_task!(Closer, task);
    #[cfg(not(windows))]
    impl bun_threading::work_pool::OwnedTask for Closer {
        fn run(self: Box<Self>) {
            drop(self.file);
        }
    }

    #[cfg(not(windows))]
    impl Closer {
        /// `_compat`: for signature compatibility with the Windows version.
        pub fn close(file: File, _compat: ()) {
            WorkPool::schedule_owned(Box::new(Closer {
                file,
                task: WorkPoolTask {
                    node: Default::default(),
                    callback: <Self as bun_threading::work_pool::OwnedTask>::__callback,
                },
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
        pub fn close(file: File, loop_: *mut uv::Loop) {
            let fd = file.into_raw();
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
                bun_sys::Fd::from_uv(unsafe { req.file_fd() }),
                req.result
            );

            #[cfg(debug_assertions)]
            if let Some(err) = req.result.errno() {
                bun_core::debug_warn!("libuv close() failed = {:?}", err);
            }
        }
    }
}
