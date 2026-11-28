// ════════════════════════════════════════════════════════════════════════════
// Loop / Waker / Closer / FilePoll-vtable / heap / pipes / MaxBuf /
// openForWriting / PipeReader / PipeWriter compile on POSIX. `source` and the
// Windows*Reader/Writer impls are `#[cfg(windows)]`-gated.
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

mod keep_alive;
mod owner;
#[cfg(not(windows))]
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

    use crate::EventLoopCtx;

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
    /// so membership is inherited by every descendant (unlike the spawn
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
pub use posix_event_loop::{FilePoll, OwnedFilePoll};

pub use owner::{IoEvent, Owner, PollTag};

#[cfg(not(windows))]
pub type OpaqueCallback = unsafe extern "C" fn(*mut core::ffi::c_void);

// At crate root so the per-method `$crate::__EventLoopCtx__*` type aliases the
// macro emits (and the impl-macro reads back) actually resolve from impl
// crates.
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

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime::jsc_hooks`.
    safe fn __bun_get_vm_ctx() -> EventLoopCtx;
}

/// JS-thread [`EventLoopCtx`] for `KeepAlive::{ref_,unref}` / `FilePoll`.
#[inline]
pub fn js_vm_ctx() -> EventLoopCtx {
    __bun_get_vm_ctx()
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
    pub(crate) fn loop_unref(&self) {
        self.loop_().unref();
    }
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn loop_add_active(&self, n: u32) {
        self.loop_().add_active(n);
    }
    #[inline]
    #[cfg(not(windows))]
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

#[cfg(windows)]
mod console_signals;
#[cfg(not(windows))]
pub mod fd_wait;
#[path = "heap.rs"]
pub mod heap;
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
pub use source::{Pipe, PipeConnect, PipeServer};

pub use pipe_reader::{BufferedReader, ReadResult, ReaderFlags};

pub use open_for_writing_mod::{open_for_writing, open_for_writing_impl};

// ════════════════════════════════════════════════════════════════════════════

pub use crate::closer::Closer;
pub use crate::waker::Waker;
use bun_sys::Fd;

// ── libc shims with no preconditions ────────────────────────────────────────
// By-value scalar args only; the kernel validates and reports failure via the
// return value / errno — never UB. Local `safe fn` decls (vs. routing through
// the `libc` crate's raw items) move the proof into the type signature.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
mod safe_c {
    use core::ffi::c_int;
    unsafe extern "C" {
        #[cfg(target_os = "macos")]
        pub(super) safe fn kqueue() -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(super) safe fn epoll_create1(flags: c_int) -> c_int;
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

pub mod waker {
    #[cfg(not(windows))]
    use bun_sys::{Fd, File};

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

    // ── Windows ───────────────────────────────────────────────────────────────

    #[cfg(windows)]
    #[derive(Default)]
    pub struct WindowsWaker {
        is_woken: bun_threading::Guarded<bool>,
        condition: bun_threading::Condition,
    }

    #[cfg(windows)]
    impl WindowsWaker {
        pub fn init() -> crate::error::Result<Self> {
            Ok(Self::default())
        }

        pub fn wait(&self) {
            let mut is_woken = self.is_woken.lock();
            while !core::mem::take(&mut *is_woken) {
                self.condition.wait_guarded(&mut is_woken);
            }
        }

        pub fn wake(&self) {
            *self.is_woken.lock() = true;
            self.condition.notify_one();
        }
    }
}

// ─── Closer (moved from bun_io) ─────────────────────────────────────────────
//
// Schedules an async fd close on the thread pool. io (T2) owns it so
// `pipes::PipeHandle::close` has no upward dep on bun_io (T3).

pub mod closer {
    use bun_sys::File;
    use bun_threading::work_pool::FilePool;

    pub struct Closer;

    impl Closer {
        pub fn close(file: File) {
            FilePool::go(move || drop(file));
        }

        #[cfg(windows)]
        pub fn close_pending(file: File, pending: Option<bun_iocp::PendingClose>) {
            FilePool::go(move || drop((file, pending)));
        }
    }
}
