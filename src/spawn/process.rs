#[cfg(any(windows, target_os = "macos"))]
use core::ffi::c_void;
use core::ffi::{c_char, c_int};
#[cfg(unix)]
use core::sync::atomic::AtomicU32;
use core::sync::atomic::Ordering;
// (std::sync::Arc removed — Process is intrusively ref-counted via
// bun_ptr::ThreadSafeRefCount; see SyncWindowsProcess below.)

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
use bun_core::Global;
use bun_core::Output;
use bun_event_loop::EventLoopHandle;
#[cfg(unix)]
use bun_io::ParentDeathWatchdog;
#[cfg(unix)]
use bun_io::{FilePoll, KeepAlive};
#[cfg(windows)]
use bun_iocp::process::{KillError, ProcessHandle as EngineProcessHandle};
#[cfg(windows)]
use bun_sys::windows::{HANDLE, Win32Error, win_error};
use bun_sys::{self, Fd, Maybe};
#[cfg(windows)]
use bun_sys::{E, FdExt as _};

// posix_spawn(2) wrappers — owned by the `bun_spawn_sys` leaf crate.
#[cfg(unix)]
use bun_spawn_sys::posix_spawn::posix_spawn;
/// `posix_spawn::WaitPidResult` — re-exported from `bun_spawn_sys`. `status`
/// is `u32` there; `Status::from` casts before matching.
#[cfg(unix)]
pub use posix_spawn::WaitPidResult;
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WaitPidResult {
    pub pid: PidT,
    pub status: c_int,
}

/// Low-level fd / memfd helpers historically grouped here as `spawn_sys`.
/// MOVE_DOWN: real impls now live in `bun_sys` (lower crate); re-export so
/// higher-tier callers (`bun_runtime::api::bun::spawn::stdio`, `Terminal`)
/// keep their `bun_spawn::process::spawn_sys::*` import path.
pub mod spawn_sys {
    // POSIX-only — memfd / FD_CLOEXEC have no Windows equivalent
    // (`can_use_memfd` is always-false there and `set_close_on_exec` is a
    // no-op since Win32 handles default to non-inheritable). Gated so the
    // re-export resolves without `bun_sys` having to ship Windows stubs.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub use bun_sys::{MemfdFlags, MemfdFlags as MemfdFlag, memfd_create};
    #[cfg(unix)]
    pub use bun_sys::{can_use_memfd, set_close_on_exec};
}

bun_core::declare_scope!(PROCESS, visible);

// ─── Re-exports from `bun_spawn_sys` ─────────────────────────────────────────
// The raw OS spawn layer (option/result structs, `Rusage`, `spawn_process_posix`)
// moved into the leaf `bun_spawn_sys` crate so it has no event-loop dependency.
// Re-export here so existing `bun_spawn::process::*` paths keep resolving.
#[cfg(windows)]
pub use bun_spawn_sys::process_rusage;
pub use bun_spawn_sys::spawn_process::{IoCounters, WinRusage, WinTimeval, rusage_zeroed};
pub use bun_spawn_sys::{
    Argv, CStrPtr, Dup2, Envp, ExtraPipe, FdT, PidFdType, PidT, PosixSpawnOptions,
    PosixSpawnResult, PosixStdio, Rusage, StdioKind,
};

/// Whether the process-exit poll should be registered one-shot.
///
/// On Linux we watch a pidfd via `EPOLLIN`. A pidfd becomes readable when the
/// tracked process exits and stays readable until the fd is closed, so a
/// plain level-triggered watch is sufficient: when the event fires we
/// `wait4(WNOHANG)`, and on success we close the pidfd (which removes it
/// from epoll).
///
/// `EPOLLONESHOT` is actively harmful here: the kernel disarms the fd the
/// instant `epoll_wait` returns it — before user-space has dispatched it.
/// If a poll callback then re-enters `us_loop_run_bun_tick` (e.g.
/// `expect(p).resolves` → `waitForPromise` → `autoTick`, or any other
/// `waitForPromise` path), the inner tick overwrites the shared
/// `loop->ready_polls`/`num_ready_polls`/`current_ready_poll` and the outer
/// dispatch silently skips its remaining events. A dropped one-shot pidfd
/// event is unrecoverable: the fd is disarmed with no re-arm path, so the
/// process's `'exit'` arrives only when the next unrelated timer wakes the
/// loop. Level-triggered makes a dropped slot harmless — the next
/// `epoll_wait` just returns it again. `rewatch_posix` still re-registers
/// defensively if `wait4` returns 0, which is a harmless `CTL_MOD`.
///
/// macOS/FreeBSD watch the pid via `EVFILT_PROC` + `NOTE_EXIT`, which is
/// inherently once-per-process — keep `EV_ONESHOT` there so the kernel
/// auto-removes the filter.
#[cfg(unix)]
const PROCESS_POLL_ONE_SHOT: bool = !cfg!(any(target_os = "linux", target_os = "android"));

pub use crate::{ProcessExit, ProcessExitHandler, ProcessExitKind};

// `opaque_ffi!` emits an inherent `impl` that doesn't carry inner `#[cfg]`
// attrs, so gate the whole macro invocation rather than the struct alone.
#[cfg(not(windows))]
bun_opaque::opaque_ffi! {
    pub struct SyncProcessPosix;
}

#[inline]
pub(crate) fn call_exit_handler(
    h: &ProcessExitHandler,
    process: &mut Process,
    status: Status,
    rusage: &Rusage,
) {
    let Some(h) = h else { return };
    if h.owner.is_null() {
        return;
    }
    h.on_process_exit(process, status, rusage);
}

// bun.ptr.ThreadSafeRefCount → intrusive (FFI-crossing: *mut Process recovered
// via `container_of` in on_exit_uv / on_close_uv). Per PORTING.md §Pointers,
// keep the embedded count; the derive emits `ThreadSafeRefCounted` +
// `AnyRefCounted`. Default `destructor` (`heap::take`) applies — `Drop` below
// handles `poller.deinit()`.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct Process {
    pub pid: PidT,
    pub pidfd: PidFdType,
    pub status: Status,
    pub poller: Poller,
    pub ref_count: bun_ptr::ThreadSafeRefCount<Process>,
    pub exit_handler: ProcessExitHandler,
    pub sync: bool,
    pub event_loop: EventLoopHandle,
}

impl Drop for Process {
    /// The allocation itself is freed by the `heap::take` in `destructor`
    /// above; this `Drop` body covers the `poller.deinit()` call.
    fn drop(&mut self) {
        self.poller.deinit();
    }
}

impl Process {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    pub fn set_exit_handler(&mut self, h: ProcessExit) {
        self.exit_handler = Some(h);
    }

    pub fn set_exit_handler_default(&mut self) {
        self.exit_handler = None;
    }

    pub fn has_exited(&self) -> bool {
        matches!(
            self.status,
            Status::Exited(_) | Status::Signaled(_) | Status::Err(_)
        )
    }

    pub fn has_killed(&self) -> bool {
        matches!(self.status, Status::Exited(_) | Status::Signaled(_))
    }

    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        self.status.signal_code()
    }

    /// Intrusive ref-count helpers. Kept on
    /// `&mut self` to match call-site shape; the actual op is atomic on the
    /// embedded `ThreadSafeRefCount` so the mutable borrow is conservative.
    #[inline]
    pub fn ref_(&mut self) {
        // SAFETY: `self` is a live Process.
        unsafe { bun_ptr::ThreadSafeRefCount::<Process>::ref_(std::ptr::from_mut(self)) };
    }

    /// Drop one ref. Takes `*mut Self`, **not** `&mut self`: on the last ref
    /// the destructor `Box::from_raw`-drops the allocation, and a `&mut self`
    /// argument carries a Stacked-Borrows protector for the call's full
    /// duration — freeing while it's live is UB even though we never touch
    /// `self` afterwards. Same rationale as [`Process::has_exited`] (:215).
    ///
    /// # Safety
    /// `this` must point at a live `Process` with refcount ≥ 1.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `Process` with refcount ≥ 1.
        unsafe { bun_ptr::ThreadSafeRefCount::<Process>::deref(this) };
    }

    /// Bridge `self.event_loop` (`EventLoopHandle`) to `bun_io::EventLoopCtx`
    /// for FilePoll/KeepAlive calls; reconstitutes the aio-level ctx here.
    #[inline]
    fn event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        event_loop_handle_to_ctx(self.event_loop)
    }
}

#[inline]
pub fn event_loop_handle_to_ctx(handle: EventLoopHandle) -> bun_io::EventLoopCtx {
    handle.as_event_loop_ctx()
}

// ─── posix_spawn / FilePoll / engine-backed Process methods ──────────────────
impl Process {
    #[cfg(unix)]
    pub fn init_posix(
        posix: &PosixSpawnResult,
        event_loop: EventLoopHandle,
        sync_: bool,
    ) -> *mut Process {
        let status = 'brk: {
            if posix.has_exited {
                let mut rusage = rusage_zeroed();
                let waitpid_result = posix_spawn::wait4(posix.pid, 0, Some(&mut rusage));
                break 'brk Status::from(posix.pid, &waitpid_result).unwrap_or(Status::Running);
            }
            Status::Running
        };
        // bun.new → heap::alloc (pointer crosses FFI / intrusive refcount)
        bun_core::heap::into_raw(Box::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            pid: posix.pid,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            pidfd: posix.pidfd.unwrap_or(0),
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            pidfd: (),
            event_loop,
            sync: sync_,
            poller: Poller::Detached,
            status,
            exit_handler: ProcessExitHandler::default(),
        }))
    }

    // has_exited / has_killed / signal_code live in the always-on impl above.

    pub fn on_exit(&mut self, status: Status, rusage: &Rusage) {
        // ProcessExitHandler is Copy (owner ptr + &'static vtable), so mirror
        let exit_handler = self.exit_handler;
        self.status = status.clone();
        if self.has_exited() {
            self.detach();
        }
        call_exit_handler(&exit_handler, self, status, rusage);
    }

    #[cfg(unix)]
    pub fn wait_posix(&mut self, sync_: bool) {
        let mut rusage = rusage_zeroed();
        let waitpid_result = posix_spawn::wait4(
            self.pid,
            if sync_ { 0 } else { libc::WNOHANG as u32 },
            Some(&mut rusage),
        );
        self.on_wait_pid(&waitpid_result, &rusage);
    }

    pub fn wait(&mut self, sync_: bool) {
        #[cfg(unix)]
        self.wait_posix(sync_);
        #[cfg(windows)]
        let _ = sync_;
    }

    /// # Safety
    /// `this` carries the +1 ref taken when the waiter-thread task was queued.
    /// `ScopedRef::adopt` releases it on return — which may free `this` — so
    /// this takes `*mut Self`, not `&mut self` (a `&mut` argument's
    /// Stacked-Borrows protector outliving the allocation is UB; see :215).
    #[cfg(unix)]
    pub unsafe fn on_wait_pid_from_waiter_thread(
        this: *mut Self,
        waitpid_result: &bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) {
        // SAFETY: caller contract — adopts the queued +1 ref.
        let _g = unsafe { bun_ptr::ScopedRef::<Process>::adopt(this) };
        // SAFETY: `_g` keeps `this` live for this block.
        let self_ = unsafe { &mut *this };
        if let Poller::WaiterThread(waiter) = &mut self_.poller {
            let ctx = event_loop_handle_to_ctx(self_.event_loop);
            waiter.unref(ctx);
            self_.poller = Poller::Detached;
        }
        self_.on_wait_pid(waitpid_result, rusage);
    }

    /// # Safety
    /// See [`Process::on_wait_pid_from_waiter_thread`].
    #[cfg(unix)]
    pub unsafe fn on_wait_pid_from_event_loop_task(this: *mut Self) {
        // SAFETY: caller contract — adopts the queued +1 ref.
        let _g = unsafe { bun_ptr::ScopedRef::<Process>::adopt(this) };
        // SAFETY: `_g` keeps `this` live.
        unsafe { (*this).wait(false) };
    }

    #[cfg(unix)]
    fn on_wait_pid(&mut self, waitpid_result: &bun_sys::Result<WaitPidResult>, rusage: &Rusage) {
        let pid = self.pid;
        // Mutated only on the macOS ESRCH retry path below.
        #[cfg(target_os = "macos")]
        let mut rusage_result = *rusage;
        #[cfg(not(target_os = "macos"))]
        let rusage_result = *rusage;

        let status: Option<Status> = Status::from(pid, waitpid_result).or_else(|| 'brk: {
            match self.rewatch_posix() {
                Ok(()) => {}
                Err(err_) => {
                    #[cfg(target_os = "macos")]
                    if err_.get_errno() == bun_sys::E::ESRCH {
                        break 'brk Status::from(
                            pid,
                            &posix_spawn::wait4(
                                pid,
                                // Normally we would use WNOHANG to avoid blocking the event loop.
                                // However, there seems to be a race condition where the operating system
                                // tells us that the process has already exited (ESRCH) but the waitpid
                                // call with WNOHANG doesn't return the status yet.
                                // As a workaround, we use 0 to block the event loop until the status is available.
                                // This should be fine because the process has already exited, so the data
                                // should become available basically immediately. Also, testing has shown that this
                                // occurs extremely rarely and only under high load.
                                0,
                                Some(&mut rusage_result),
                            ),
                        );
                    }
                    break 'brk Some(Status::Err(err_));
                }
            }
            None
        });

        let Some(status) = status else { return };
        self.on_exit(status, &rusage_result);
    }

    pub fn watch_or_reap(&mut self) -> bun_sys::Result<bool> {
        if self.has_exited() {
            let zeroed = rusage_zeroed();
            self.on_exit(self.status.clone(), &zeroed);
            return Ok(true);
        }

        match self.watch() {
            Err(err) => {
                #[cfg(unix)]
                if err.get_errno() == bun_sys::E::ESRCH {
                    self.wait(true);
                    return Ok(self.has_exited());
                }
                Err(err)
            }
            Ok(()) => Ok(self.has_exited()),
        }
    }

    pub fn watch(&mut self) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            if let Poller::Engine(p) = &mut self.poller {
                p.ref_();
            }
            return Ok(());
        }

        #[cfg(unix)]
        {
            let ctx = self.event_loop_ctx();
            if WaiterThread::should_use_waiter_thread() {
                self.poller = Poller::WaiterThread(KeepAlive::default());
                if let Poller::WaiterThread(w) = &mut self.poller {
                    w.ref_(ctx);
                }
                self.ref_();
                WaiterThread::append(self);
                return Ok(());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            let watchfd = self.pidfd;
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let watchfd = self.pid;

            let poll: *mut FilePoll = if matches!(self.poller, Poller::Fd(_)) {
                // already have a poll; take the existing pointer out
                core::mem::replace(&mut self.poller, Poller::Detached)
                    .into_fd()
                    .unwrap()
                    .as_ptr()
            } else {
                FilePoll::init(
                    ctx,
                    Fd::from_native(watchfd),
                    bun_io::file_poll::FlagsSet::default(),
                    bun_io::Owner::new(
                        bun_io::posix_event_loop::poll_tag::PROCESS,
                        std::ptr::from_mut::<Process>(self).cast(),
                    ),
                )
            };

            self.poller = Poller::Fd(
                core::ptr::NonNull::new(poll).expect("FilePoll::init returns a live hive slot"),
            );
            // SAFETY: poll is live; exclusive on this thread (event loop).
            let fd = unsafe { &mut *poll };
            fd.enable_keeping_process_alive(ctx);

            // SAFETY: `platform_event_loop` returns the live uws loop.
            let loop_ = unsafe { &mut *self.event_loop.platform_event_loop() };
            match fd.register(loop_, bun_io::PollKind::Process, PROCESS_POLL_ONE_SHOT) {
                Ok(()) => {
                    self.ref_();
                    Ok(())
                }
                Err(err) => {
                    fd.disable_keeping_process_alive(ctx);
                    Err(err)
                }
            }
        }
    }

    #[cfg(unix)]
    pub fn rewatch_posix(&mut self) -> bun_sys::Result<()> {
        let ctx = self.event_loop_ctx();
        if WaiterThread::should_use_waiter_thread() {
            if !matches!(self.poller, Poller::WaiterThread(_)) {
                self.poller = Poller::WaiterThread(KeepAlive::default());
            }
            if let Poller::WaiterThread(w) = &mut self.poller {
                w.ref_(ctx);
            }
            self.ref_();
            WaiterThread::append(self);
            return Ok(());
        }

        if let Some(fd) = self.poller.fd_poll_mut() {
            // SAFETY: `platform_event_loop` returns the live uws loop.
            let loop_ = unsafe { &mut *self.event_loop.platform_event_loop() };
            let maybe = fd.register(loop_, bun_io::PollKind::Process, PROCESS_POLL_ONE_SHOT);
            if maybe.is_ok() {
                self.ref_();
            }
            maybe
        } else {
            panic!(
                "Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report."
            );
        }
    }

    /// Engine exit callback (`bun_iocp::ProcessExitCb`): `exit_status` is the
    /// child's full 32-bit exit code zero-extended, or `-(raw Win32 code)`
    /// when `GetExitCodeProcess` itself failed; `term_signal` is nonzero only
    /// for kills through this handle.
    ///
    /// # Safety
    /// `data` is the `*mut Process` registered at spawn; the engine keeps the
    /// child's HANDLE open across this callback (rusage is queried here).
    #[cfg(windows)]
    unsafe fn on_exit_engine(
        _loop: &mut bun_iocp::Loop,
        data: *mut c_void,
        exit_status: i64,
        term_signal: i32,
    ) {
        // SAFETY: `data` was set to the owning `*mut Process` at spawn; the
        // exit callback fires at most once while the box is pinned.
        let this: &mut Process = unsafe { bun_ptr::callback_ctx::<Process>(data) };
        // Exit-time rusage: the engine holds the process HANDLE open across
        // this callback and closes it eagerly right after (PROC-48).
        let rusage = match &this.poller {
            Poller::Engine(p) => process_rusage(p.raw_handle()),
            _ => rusage_zeroed(),
        };
        let signal_code: Option<u8> =
            if term_signal > 0 && term_signal < bun_core::SignalCode::SIGSYS as i32 {
                Some(term_signal as u8)
            } else {
                None
            };

        bun_core::scoped_log!(
            PROCESS,
            "Process.onExit({}) status: {}, signal: {:?}",
            this.pid,
            exit_status,
            signal_code
        );

        if let Some(sig) = signal_code {
            this.close();
            this.on_exit(Status::Signaled(sig), &rusage);
        } else if exit_status >= 0 {
            this.close();
            this.on_exit(
                Status::Exited(Exited {
                    // Full DWORD: NTSTATUS crash codes (0xC0000005) surface
                    // verbatim like Node, never truncated to a byte.
                    code: exit_status as u32,
                    signal: 0,
                }),
                &rusage,
            );
        } else {
            // Negative carries -(raw Win32 code); map through the general
            // win32→errno table (never the libuv-errno namespace).
            let raw = u16::try_from(-exit_status).unwrap_or(u16::MAX);
            this.on_exit(
                Status::Err(bun_sys::Error::new(
                    win_error::translate(Win32Error(raw)),
                    bun_sys::Tag::waitpid,
                )),
                &rusage,
            );
        }
    }

    /// Engine close callback: the exit slot drained; take the heap-pinned
    /// `ProcessHandle` box out of the poller and free it (the engine never
    /// touches it after this callback).
    #[cfg(windows)]
    unsafe fn on_close_engine(_loop: &mut bun_iocp::Loop, data: *mut c_void) {
        // Stay raw — `ScopedRef::Drop` may free the allocation, so never bind
        // a `&mut Process` whose tag would have to outlive that.
        let this: *mut Process = data.cast();
        // SAFETY: adopts the +1 ref taken in `close()`.
        let _g = unsafe { bun_ptr::ScopedRef::<Process>::adopt(this) };
        // SAFETY: `_g` keeps `this` live for this block.
        unsafe {
            bun_core::scoped_log!(PROCESS, "Process.onClose({})", (*this).pid);
            if matches!((*this).poller, Poller::Engine(_)) {
                // Drops the Box<ProcessHandle> — the only legal free point.
                (*this).poller = Poller::Detached;
            }
        }
    }

    pub fn close(&mut self) {
        #[cfg(unix)]
        {
            let mut stranded_watch_ref = false;
            // Route the `Fd` arm through the centralized `fd_poll_mut()`
            // accessor instead of open-coding `(*poll.as_ptr()).deinit()`.
            if let Some(poll) = self.poller.fd_poll_mut() {
                stranded_watch_ref = poll.is_registered();
                poll.deinit();
            } else if let Poller::WaiterThread(waiter) = &mut self.poller {
                waiter.disable();
            }
            self.poller = Poller::Detached;
            if stranded_watch_ref && !self.has_exited() {
                // SAFETY: callers hold their own +1, so this never drops to zero.
                unsafe { Self::deref(std::ptr::from_mut(self)) };
            }
        }
        #[cfg(windows)]
        {
            // Hoist the closing flag into a local so the `&self.poller`
            // borrow ends before we need `&mut self` for `ref_()`.
            let closing = match &self.poller {
                Poller::Engine(process) => process.is_closing(),
                _ => return,
            };
            if !closing {
                // The +1 is adopted (and the box freed) in `on_close_engine`.
                self.ref_();
                let data: *mut c_void = std::ptr::from_mut(self).cast();
                if let Poller::Engine(process) = &mut self.poller {
                    process.close(Some(Self::on_close_engine), data);
                }
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::FdExt as _;
            if self.pidfd != Fd::INVALID.native() && self.pidfd > 0 {
                Fd::from_native(self.pidfd).close();
                self.pidfd = Fd::INVALID.native();
            }
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self) {
        let ctx = self.event_loop_ctx();
        self.poller.disable_keeping_event_loop_alive(ctx);
    }

    pub fn has_ref(&self) -> bool {
        self.poller.has_ref()
    }

    pub fn enable_keeping_event_loop_alive(&mut self) {
        if self.has_exited() {
            return;
        }
        let ctx = self.event_loop_ctx();
        self.poller.enable_keeping_event_loop_alive(ctx);
    }

    pub fn detach(&mut self) {
        self.close();
        self.exit_handler = ProcessExitHandler::default();
    }

    pub fn kill(&mut self, signal: u8) -> Maybe<()> {
        #[cfg(unix)]
        {
            // Detached is a deliberate no-op: spawnSync's `read_all()` runs
            // before `watch_or_reap()` installs the poller; the first
            // `recv_non_block` returns EAGAIN (yes hasn't written yet) so the
            // maxBuffer overflow fires from the event-loop poll
            // tick *after* the Fd poller is armed. Do not widen this match to
            // mask spawn-maxbuf.test.ts — the async-path hang there has a
            // different root cause (poller is already Fd when `on_max_buffer`
            // fires, so this arm is unreachable on that path).
            match &self.poller {
                Poller::WaiterThread(_) | Poller::Fd(_) => {
                    // All by-value `pid_t`/`c_int`; the kernel validates pid/
                    // signal and returns -1/errno (ESRCH/EINVAL/EPERM) — no
                    // memory-safety preconditions, so `safe fn` discharges the
                    // link-time proof here.
                    unsafe extern "C" {
                        #[link_name = "kill"]
                        safe fn libc_kill(pid: libc::pid_t, sig: c_int) -> c_int;
                    }
                    let err = libc_kill(self.pid, signal as c_int);
                    if err != 0 {
                        let errno_ = bun_sys::get_errno(err as isize);
                        // if the process was already killed don't throw
                        if errno_ != bun_sys::E::ESRCH {
                            return Err(bun_sys::Error::from_code(errno_, bun_sys::Tag::kill));
                        }
                    }
                }
                _ => {}
            }
        }
        #[cfg(windows)]
        {
            match &mut self.poller {
                Poller::Engine(handle) => {
                    if let Err(err) = handle.kill(i32::from(signal)) {
                        return match err {
                            // Already exited — benign, like the POSIX ESRCH
                            // swallow above.
                            KillError::NotFound => Ok(()),
                            KillError::InvalidSignal => {
                                Err(bun_sys::Error::from_code(E::EINVAL, bun_sys::Tag::kill))
                            }
                            KillError::Unsupported => {
                                Err(bun_sys::Error::from_code(E::ENOSYS, bun_sys::Tag::kill))
                            }
                            KillError::Os(w) => Err(bun_sys::Error::new(
                                win_error::translate(w),
                                bun_sys::Tag::kill,
                            )),
                        };
                    }
                    return Ok(());
                }
                _ => {}
            }
        }

        Ok(())
    }
}

// Not `Copy` — `bun_sys::Error` carries `Box<[u8]>` path/dest.
// Callers use `.clone()`.
#[derive(Clone, Default)]
pub enum Status {
    #[default]
    Running,
    Exited(Exited),
    /// Raw signal byte — any `u8` (incl. Linux RT signals 32..=64) is a valid
    /// payload. `bun_core::SignalCode` is exhaustive 1..=31,
    /// so storing it here would force lossy `Signaled→Exited` rewrites for RT
    /// signals — observable as `{exitCode:0, signal:null}` in JS. Carry the raw
    /// byte and range-check in `signal_code()` instead.
    Signaled(u8),
    Err(bun_sys::Error),
}

#[derive(Clone, Copy, Default)]
pub struct Exited {
    /// Full exit code. POSIX stores `WEXITSTATUS` (0..=255); Windows stores
    /// the child's whole DWORD so NTSTATUS crash codes (0xC0000005) surface
    /// as Node does (3221225477), not truncated to a byte.
    pub code: u32,
    /// Raw signal number. `0` means "no signal".
    /// `SignalCode` discriminants are 1..=31; storing it as the
    /// enum and transmuting `0` would be UB. Convert via `Status::signal_code`.
    pub signal: u8,
}

impl Status {
    pub fn is_ok(&self) -> bool {
        matches!(self, Status::Exited(e) if e.code == 0)
    }

    #[cfg(unix)]
    pub fn from(pid: PidT, waitpid_result: &Maybe<WaitPidResult>) -> Option<Status> {
        let mut exit_code: Option<u32> = None;
        let mut signal: Option<u8> = None;

        match waitpid_result {
            Err(err_) => {
                return Some(Status::Err(err_.clone()));
            }
            Ok(result) => {
                if result.pid != pid {
                    return None;
                }
                // `posix_spawn::WaitPidResult.status` is `u32`;
                // libc's W* helpers want `c_int`.
                let status = result.status as c_int;

                if libc::WIFEXITED(status) {
                    // POSIX exit statuses stay byte-ranged (the wide field is
                    // for Windows DWORD codes).
                    exit_code = Some(u32::from(libc::WEXITSTATUS(status) as u8));
                    // True if the process terminated due to receipt of a signal.
                }

                if libc::WIFSIGNALED(status) {
                    signal = Some(libc::WTERMSIG(status) as u8);
                }
                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                // True if the process has not terminated, but has stopped and can
                // be restarted.  This macro can be true only if the wait call spec-ified specified
                // ified the WUNTRACED option or if the child process is being
                // traced (see ptrace(2)).
                else if libc::WIFSTOPPED(status) {
                    signal = Some(libc::WSTOPSIG(status) as u8);
                }
            }
        }

        if let Some(code) = exit_code {
            return Some(Status::Exited(Exited {
                code,
                signal: signal.unwrap_or(0),
            }));
        } else if let Some(sig) = signal {
            // Any byte is valid. Carry the raw byte; `signal_code()` range-checks.
            return Some(Status::Signaled(sig));
        }

        None
    }

    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        let raw = match self {
            Status::Signaled(sig) => *sig,
            Status::Exited(exit) => exit.signal,
            _ => return None,
        };
        bun_core::SignalCode::from_raw(raw)
    }
}

/// Local shim — `bun_core::SignalCode` does not yet expose this.
/// Shell-convention: 128 + signal number for signals 1..=31, else `None`.
pub trait SignalCodeExt {
    fn to_exit_code(self) -> Option<u8>;
}
impl SignalCodeExt for bun_core::SignalCode {
    #[inline]
    fn to_exit_code(self) -> Option<u8> {
        let n = self as u8;
        if (1..=31).contains(&n) {
            Some(128u8.wrapping_add(n))
        } else {
            None
        }
    }
}

impl core::fmt::Display for Status {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if let Some(signal_code) = self.signal_code() {
            if let Some(code) = signal_code.to_exit_code() {
                return write!(writer, "code: {}", code);
            }
        }

        match self {
            Status::Exited(exit) => write!(writer, "code: {}", exit.code),
            Status::Signaled(signal) => write!(writer, "signal: {}", *signal),
            Status::Err(err) => write!(writer, "{}", err),
            _ => Ok(()),
        }
    }
}

#[cfg(unix)]
pub enum PollerPosix {
    /// Hive-allocated `bun_io::FilePoll` slot. Pointer (not `Box`) because the
    /// poll lives in `Store`; freed via `FilePoll::deinit`,
    /// never via Rust `drop`.
    Fd(core::ptr::NonNull<FilePoll>),
    WaiterThread(KeepAlive),
    Detached,
}

#[cfg(unix)]
impl PollerPosix {
    /// NOT `impl Drop`: this enum is reassigned freely (`self.poller =
    /// Poller::Detached`, `Poller::WaiterThread(..)`, etc.) and `close()`
    /// already performs the same teardown explicitly before reassigning. A
    /// `Drop` impl would double-free the hive slot on those reassignments.
    /// Called only from `Process` drop.
    pub fn deinit(&mut self) {
        // Route the `Fd` arm through the centralized `fd_poll_mut()` accessor
        // instead of open-coding the `NonNull` deref here.
        if let Some(poll) = self.fd_poll_mut() {
            poll.deinit();
        } else if let PollerPosix::WaiterThread(w) = self {
            w.disable();
        }
    }

    fn into_fd(self) -> Option<core::ptr::NonNull<FilePoll>> {
        match self {
            PollerPosix::Fd(f) => Some(f),
            _ => None,
        }
    }

    /// Borrow the hive-allocated `FilePoll` slot if this poller is `Fd`.
    ///
    /// Single `unsafe` deref site for the `NonNull<FilePoll>` payload. The slot
    /// lives in the hive `Store` until `deinit` returns it; the only Rust handle
    /// is the `NonNull` inside this enum, so `&self` ⇒ no overlapping `&mut`.
    #[inline]
    fn fd_poll(&self) -> Option<&FilePoll> {
        match self {
            // SAFETY: `Fd` holds the unique handle to a live hive slot, freed
            // only via `deinit` (which consumes the variant). `&self` rules out
            // any concurrent exclusive borrow of the slot.
            PollerPosix::Fd(poll) => Some(unsafe { poll.as_ref() }),
            _ => None,
        }
    }

    /// Mutably borrow the hive-allocated `FilePoll` slot if this poller is `Fd`.
    ///
    /// See [`fd_poll`](Self::fd_poll); `&mut self` additionally guarantees the
    /// returned `&mut FilePoll` is the only live reference to the slot
    /// (event-loop-thread exclusive).
    #[inline]
    pub(crate) fn fd_poll_mut(&mut self) -> Option<&mut FilePoll> {
        match self {
            // SAFETY: see `fd_poll`. `&mut self` ⇒ exclusive access to the
            // unique handle ⇒ exclusive access to the hive slot.
            PollerPosix::Fd(poll) => Some(unsafe { poll.as_mut() }),
            _ => None,
        }
    }

    pub fn enable_keeping_event_loop_alive(&mut self, ctx: bun_io::EventLoopCtx) {
        if let Some(poll) = self.fd_poll_mut() {
            poll.enable_keeping_process_alive(ctx);
        } else if let PollerPosix::WaiterThread(waiter) = self {
            waiter.ref_(ctx);
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, ctx: bun_io::EventLoopCtx) {
        if let Some(poll) = self.fd_poll_mut() {
            poll.disable_keeping_process_alive(ctx);
        } else if let PollerPosix::WaiterThread(waiter) = self {
            waiter.unref(ctx);
        }
    }

    pub fn has_ref(&self) -> bool {
        if let Some(fd) = self.fd_poll() {
            return fd.can_enable_keeping_process_alive();
        }
        match self {
            PollerPosix::WaiterThread(w) => w.is_active(),
            _ => false,
        }
    }
}

#[cfg(unix)]
pub type Poller = PollerPosix;
#[cfg(windows)]
pub type Poller = PollerWindows;

/// The engine handle is heap-pinned (`Box`) from spawn until the close
/// callback frees it in `on_close_engine` — the engine's endgame contract.
#[cfg(windows)]
pub enum PollerWindows {
    Engine(Box<EngineProcessHandle>),
    Detached,
}

#[cfg(windows)]
impl PollerWindows {
    /// Not `Drop` — see `PollerPosix::deinit`. A live engine handle here
    /// means `close()` never ran; freeing the box would leave the loop
    /// referencing dead memory, so leak it instead.
    pub fn deinit(&mut self) {
        if matches!(self, PollerWindows::Engine(_)) {
            debug_assert!(false, "Process dropped with a live engine ProcessHandle");
            let PollerWindows::Engine(h) = core::mem::replace(self, PollerWindows::Detached) else {
                unreachable!()
            };
            Box::leak(h);
        }
    }

    pub fn enable_keeping_event_loop_alive(&mut self, _event_loop: bun_io::EventLoopCtx) {
        if let PollerWindows::Engine(process) = self {
            process.ref_();
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, _event_loop: bun_io::EventLoopCtx) {
        // Exit observation is decoupled from the keep-alive (PROC-45): an
        // unref'd child still reports exit whenever the loop runs.
        if let PollerWindows::Engine(p) = self {
            p.unref();
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            PollerWindows::Engine(p) => p.has_ref(),
            _ => false,
        }
    }
}

#[cfg(unix)]
pub use waiter_thread_posix::WaiterThreadPosix as WaiterThread;

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
#[cfg(unix)]
pub mod waiter_thread_posix {
    use super::*;
    use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, New as AnyTaskNew};
    use bun_event_loop::ConcurrentTask::{ConcurrentTask, Task, TaskTag};
    use bun_event_loop::task_tag;
    use bun_threading::UnboundedQueue;

    pub struct WaiterThreadPosix {
        pub started: AtomicU32,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub eventfd: Fd,
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        pub eventfd: (),
        pub js_process: ProcessQueue,
    }

    pub type ProcessQueue = NewQueue<Process>;

    pub struct NewQueue<T: 'static> {
        pub queue: ConcurrentQueue<T>,
        // The active list holds raw `*T` whose strong ref was taken
        // by the caller before `append()` (Process::watch does `self.ref_()`).
        // The matching `deref()` happens in `on_wait_pid_from_waiter_thread`.
        //
        // `UnsafeCell` so `loop_` can take `&self`: the waiter thread is the
        // *sole* mutator of `active`, but producers concurrently hold `&self`
        // to push onto `queue` — a `&mut self` on the waiter side would alias
        // those producer borrows (forbidden aliased-&mut). With `&self` on
        // both sides the only interior mutation goes through this cell.
        pub active: core::cell::UnsafeCell<Vec<*mut T>>,
    }

    impl<T: 'static> NewQueue<T> {
        pub const fn new() -> Self {
            Self {
                queue: ConcurrentQueue::new(),
                active: core::cell::UnsafeCell::new(Vec::new()),
            }
        }
    }

    impl<T: 'static> Default for NewQueue<T> {
        fn default() -> Self {
            Self::new()
        }
    }

    /// Intrusive node pushed onto `ConcurrentQueue` from the JS thread and
    /// drained on the waiter thread.
    pub struct TaskQueueEntry<T: 'static> {
        pub process: *mut T,
        pub next: bun_threading::Link<TaskQueueEntry<T>>,
    }

    // SAFETY: `next` is the sole intrusive link for `UnboundedQueue<TaskQueueEntry<T>>`.
    unsafe impl<T: 'static> bun_threading::Linked for TaskQueueEntry<T> {
        #[inline]
        unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
            // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
            unsafe { core::ptr::addr_of!((*item).next) }
        }
    }

    pub type ConcurrentQueue<T> = UnboundedQueue<TaskQueueEntry<T>>;

    /// Posted to the JS event loop from the waiter thread when a `wait4()`
    /// resolves. Maps to `task_tag::ProcessWaiterThreadTask` in `jsc::Task`.
    pub struct ResultTask<T: 'static> {
        pub result: bun_sys::Result<WaitPidResult>,
        pub subprocess: *mut T,
        pub rusage: Rusage,
    }

    impl<T: ProcessLike> ResultTask<T> {
        #[inline]
        pub fn new(v: ResultTask<T>) -> *mut ResultTask<T> {
            bun_core::heap::into_raw(Box::new(v))
        }

        pub fn run_from_js_thread(self) {
            self.run_from_main_thread();
        }

        pub fn run_from_main_thread(self) {
            // SAFETY: subprocess strong-ref'd before append(); released by
            // on_wait_pid_from_waiter_thread → deref().
            unsafe {
                T::on_wait_pid_from_waiter_thread(self.subprocess, &self.result, &self.rusage)
            };
        }

        pub fn run_from_main_thread_mini(self, _: *mut ()) {
            self.run_from_main_thread();
        }
    }

    /// Posted to `MiniEventLoop` from the waiter thread. Self-referential via
    /// the embedded intrusive `task: AnyTaskWithExtraContext` (`.ctx == self`).
    #[repr(C)]
    pub struct ResultTaskMini<T: 'static> {
        pub result: bun_sys::Result<WaitPidResult>,
        pub subprocess: *mut T,
        pub task: AnyTaskWithExtraContext,
    }

    impl<T: ProcessLike> ResultTaskMini<T> {
        #[inline]
        pub fn new(v: ResultTaskMini<T>) -> *mut ResultTaskMini<T> {
            bun_core::heap::into_raw(Box::new(v))
        }

        pub fn run_from_main_thread(self) {
            let result = self.result;
            let subprocess = self.subprocess;
            // SAFETY: see ResultTask::run_from_main_thread.
            unsafe { T::on_wait_pid_from_waiter_thread(subprocess, &result, &rusage_zeroed()) };
        }

        /// Stored thunk for `AnyTaskWithExtraContext` (`fn(*mut T, *mut C)`
        /// shape — `C = ()`). Default Rust ABI.
        fn run_from_main_thread_mini(this: *mut Self, _: *mut ()) {
            // SAFETY: `this` was heap-allocated in `loop_()` below; the mini
            // event loop hands ownership back here exactly once.
            unsafe { bun_core::heap::take(this) }.run_from_main_thread();
        }
    }

    /// Trait abstracting `process.pid` / `process.event_loop` /
    /// `process.onWaitPidFromWaiterThread` for generic `T` (only `Process`
    /// today).
    pub trait ProcessLike: 'static {
        /// `jsc::Task` tag for this `T`'s `ResultTask`; callers supply it.
        const TASK_TAG: TaskTag;
        fn pid(&self) -> PidT;
        fn event_loop(&self) -> EventLoopHandle;
        /// # Safety
        /// `this` must be a live, strong-ref'd pointer; callee releases one ref.
        unsafe fn on_wait_pid_from_waiter_thread(
            this: *mut Self,
            result: &bun_sys::Result<WaitPidResult>,
            rusage: &Rusage,
        );
    }

    impl ProcessLike for Process {
        const TASK_TAG: TaskTag = task_tag::ProcessWaiterThreadTask;
        #[inline]
        fn pid(&self) -> PidT {
            self.pid
        }
        #[inline]
        fn event_loop(&self) -> EventLoopHandle {
            self.event_loop
        }
        #[inline]
        unsafe fn on_wait_pid_from_waiter_thread(
            this: *mut Self,
            result: &bun_sys::Result<WaitPidResult>,
            rusage: &Rusage,
        ) {
            // SAFETY: caller contract.
            unsafe { Process::on_wait_pid_from_waiter_thread(this, result, rusage) };
        }
    }

    impl<T: ProcessLike> NewQueue<T> {
        pub fn append(&self, process: *mut T) {
            // freshly boxed `TaskQueueEntry`; `into_raw` yields a valid owned pointer.
            let entry = bun_core::heap::into_raw(Box::new(TaskQueueEntry {
                process,
                next: bun_threading::Link::new(),
            }));
            // SAFETY: `entry` was just `into_raw`'d from a live Box (non-null).
            self.queue
                .push(unsafe { core::ptr::NonNull::new_unchecked(entry) });
        }

        pub fn loop_(&self) {
            // SAFETY: the dedicated waiter thread is the only caller of
            // `loop_` and the only code path that touches `active`; producers
            // (`append`) only touch `self.queue`. No other `&mut` to this Vec
            // can exist concurrently.
            let active = unsafe { &mut *self.active.get() };
            {
                let batch = self.queue.pop_batch();
                active.reserve(batch.count);
                let mut iter = batch.iterator();
                loop {
                    let task = iter.next();
                    if task.is_null() {
                        break;
                    }
                    // SAFETY: task was heap-allocated in append().
                    let task = unsafe { bun_core::heap::take(task) };
                    active.push(task.process);
                }
            }

            let mut i: usize = 0;
            while i < active.len() {
                let mut remove = false;

                let process = active[i];
                // SAFETY: each `*mut T` in `active` was strong-ref'd by the
                // producer (`Process::watch` → `ref_()`) before `append()`;
                // the matching `deref()` is in `on_wait_pid_from_waiter_thread`,
                // so the pointee outlives this shared borrow. Single deref
                // serves both `pid()` and `event_loop()` accessor reads.
                let process_ref = unsafe { &*process };
                let pid = T::pid(process_ref);
                // this case shouldn't really happen
                if pid == 0 {
                    remove = true;
                } else {
                    let mut rusage = rusage_zeroed();
                    let result = posix_spawn::wait4(pid, libc::WNOHANG as u32, Some(&mut rusage));
                    let matched = match &result {
                        Err(_) => true,
                        Ok(r) => r.pid == pid,
                    };
                    if matched {
                        remove = true;

                        match T::event_loop(process_ref) {
                            EventLoopHandle::Js { owner } => {
                                let ct = ConcurrentTask::create(Task::new(
                                    T::TASK_TAG,
                                    ResultTask::<T>::new(ResultTask {
                                        result,
                                        subprocess: process,
                                        rusage,
                                    })
                                    .cast(),
                                ));
                                owner.enqueue_task_concurrent(ct);
                            }
                            EventLoopHandle::Mini(mut mini) => {
                                let out = ResultTaskMini::<T>::new(ResultTaskMini {
                                    result,
                                    subprocess: process,
                                    task: AnyTaskWithExtraContext::default(),
                                });
                                // SAFETY: `out` just produced by heap::alloc — non-null.
                                unsafe {
                                    (*out).task = AnyTaskNew::<ResultTaskMini<T>, ()>::init(
                                        out,
                                        ResultTaskMini::<T>::run_from_main_thread_mini,
                                    );
                                    mini.get_mut().enqueue_task_concurrent(
                                        core::ptr::NonNull::new_unchecked(core::ptr::addr_of_mut!(
                                            (*out).task
                                        )),
                                    );
                                }
                                // `out` is now owned by the mini queue;
                                // freed in `run_from_main_thread_mini`.
                            }
                        }
                    }
                }

                if remove {
                    let _ = active.remove(i);
                } else {
                    i += 1;
                }
            }
        }
    }

    const STACK_SIZE: usize = 512 * 1024;

    // Singleton. The waiter
    // thread is the sole mutator of `js_process.active`; producers only touch
    // the lock-free `queue`. Wrapped so the address is stable for the SIGCHLD
    // handler / waiter loop without taking `&mut` to a `static mut`.
    struct Instance(core::cell::UnsafeCell<WaiterThreadPosix>);
    // SAFETY: see field-level access notes above.
    unsafe impl Sync for Instance {}
    static INSTANCE: Instance = Instance(core::cell::UnsafeCell::new(WaiterThreadPosix {
        started: AtomicU32::new(0),
        #[cfg(any(target_os = "linux", target_os = "android"))]
        eventfd: Fd::INVALID,
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        eventfd: (),
        js_process: ProcessQueue::new(),
    }));

    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[inline]
    fn instance() -> *mut WaiterThreadPosix {
        INSTANCE.0.get()
    }

    /// Shared borrow of the singleton — sole deref site for the set-once
    /// `INSTANCE` cell. All fields are either atomic (`started`),
    /// interior-mutable (`js_process.active` via `UnsafeCell`, `js_process.queue`
    /// lock-free), or write-once-before-spawn (`eventfd`, set in `init()` under
    /// the `started` fetch_max guard before any reader thread exists), so a
    /// shared `&'static` is sound. The lone mutating write (`eventfd` in
    /// `init()`) goes through the raw [`instance()`] pointer; no `&` from this
    /// accessor is live across it.
    #[inline]
    fn instance_ref() -> &'static WaiterThreadPosix {
        // SAFETY: see doc comment — process-lifetime singleton, fields are
        // atomic / interior-mutable / write-once-before-readers.
        unsafe { &*INSTANCE.0.get() }
    }

    impl WaiterThreadPosix {
        #[inline]
        pub fn set_should_use_waiter_thread() {
            bun_spawn_sys::waiter_thread_flag::set();
        }

        #[inline]
        pub fn should_use_waiter_thread() -> bool {
            bun_spawn_sys::waiter_thread_flag::get()
        }

        pub fn append(process: *mut Process) {
            // `js_process.queue` is an MPSC lock-free queue; `append` is the
            // producer half and only touches `queue`, never `active`.
            instance_ref().js_process.append(process);

            init().unwrap_or_else(|_| panic!("Failed to start WaiterThread"));

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                let one: [u8; 8] = (1usize).to_ne_bytes();
                // SAFETY: write(2) is async-signal-safe; eventfd valid after init().
                let n =
                    unsafe { libc::write(instance_ref().eventfd.native(), one.as_ptr().cast(), 8) };
                if n < 0 {
                    panic!("Failed to write to eventfd");
                }
            }
        }

        pub fn reload_handlers() {
            if !bun_spawn_sys::waiter_thread_flag::get() {
                return;
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // SAFETY: sigaction with a valid handler.
                unsafe {
                    let mut current_mask: libc::sigset_t = bun_core::ffi::zeroed();
                    libc::sigemptyset(&raw mut current_mask);
                    libc::sigaddset(&raw mut current_mask, libc::SIGCHLD);
                    let act = libc::sigaction {
                        sa_sigaction: wakeup as *const () as usize,
                        sa_mask: current_mask,
                        sa_flags: libc::SA_NOCLDSTOP,
                        sa_restorer: None,
                    };
                    libc::sigaction(libc::SIGCHLD, &raw const act, core::ptr::null_mut());
                }
            }
        }
    }

    pub fn init() -> Result<(), std::io::Error> {
        debug_assert!(bun_spawn_sys::waiter_thread_flag::get());

        if instance_ref().started.fetch_max(1, Ordering::Relaxed) > 0 {
            return Ok(());
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // All by-value `c_uint`/`c_int` args; the kernel validates flags
            // and returns -1/errno on failure — no memory-safety preconditions,
            // so `safe fn` (Rust 2024) discharges the link-time proof.
            unsafe extern "C" {
                safe fn eventfd(
                    initval: core::ffi::c_uint,
                    flags: core::ffi::c_int,
                ) -> core::ffi::c_int;
            }
            let fd = eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC);
            if fd < 0 {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: single-writer init path (guarded by fetch_max above).
            unsafe { (*instance()).eventfd = Fd::from_native(fd) };
        }

        let thread = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn(loop_)?;
        drop(thread); // detach
        Ok(())
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    extern "C" fn wakeup(_: c_int) {
        let one: [u8; 8] = (1usize).to_ne_bytes();
        // eventfd is write-once in init() before this handler is installed.
        let _ = bun_sys::write(instance_ref().eventfd, &one).unwrap_or(0);
    }

    pub fn loop_() {
        // SAFETY: NUL-terminated literal.
        Output::Source::configure_named_thread(bun_core::ZStr::from_static(b"Waitpid\0"));
        WaiterThreadPosix::reload_handlers();
        // We must NOT materialize a long-lived `&mut WaiterThreadPosix` here:
        // the JS thread's `append()` and the SIGCHLD handler `wakeup()`
        // concurrently form shared borrows of `js_process` / `eventfd` via the
        // same singleton, and a live `&mut` covering those fields would be UB
        // (aliased-&mut). A shared `&'static` is fine — see `instance_ref()`.
        let this: &'static WaiterThreadPosix = instance_ref();

        #[allow(unused_labels)]
        'outer: loop {
            // `loop_` takes `&self`; coexists soundly with producer `&NewQueue`
            // in `append()` (interior mutability via `active: UnsafeCell`).
            this.js_process.loop_();

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // `eventfd` is written once in `init()` before this thread is
                // spawned; read-only thereafter.
                let efd = this.eventfd;
                let mut polls = [libc::pollfd {
                    fd: efd.native(),
                    events: (libc::POLLIN | libc::POLLERR) as _,
                    revents: 0,
                }];

                // Consume the pending eventfd
                let mut buf = [0u8; 8];
                if bun_sys::read(efd, &mut buf).unwrap_or(0) > 0 {
                    continue 'outer;
                }

                // SAFETY: valid pollfd array.
                let _ = unsafe { libc::poll(polls.as_mut_ptr(), 1, i32::MAX) };
            }
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            {
                // SAFETY: sigwait with a valid (empty) mask.
                unsafe {
                    let mut mask: libc::sigset_t = bun_core::ffi::zeroed();
                    libc::sigemptyset(&raw mut mask);
                    let mut signal: c_int = libc::SIGCHLD;
                    let _rc = libc::sigwait(&raw const mask, &raw mut signal);
                }
            }
        }
    }
}

/// Windows stub mirroring the unix `WaiterThreadPosix as WaiterThread` re-export.
/// An uninhabited type with associated fns so callers can use
/// `WaiterThread::should_use_waiter_thread()` uniformly on both platforms.
#[cfg(not(unix))]
pub enum WaiterThread {}

#[cfg(not(unix))]
impl WaiterThread {
    #[inline]
    pub fn should_use_waiter_thread() -> bool {
        false
    }
    pub fn set_should_use_waiter_thread() {}
    pub fn reload_handlers() {}
}

// (PosixSpawnOptions / StdioKind / Dup2 / PosixStdio moved to bun_spawn_sys —
// re-exported above. Windows option/result types stay here: they embed
// `*mut Process` / `EventLoopHandle` and so cannot live in the leaf -sys crate.)

#[cfg(windows)]
pub struct WindowsSpawnResult {
    // Raw intrusive pointer. `Process` is intrusively
    // ref-counted via `bun_ptr::ThreadSafeRefCount` and recovered via the
    // engine callbacks' `data` pointer; allocation is `heap::alloc`
    // and destruction is `heap::take` (see `ThreadSafeRefCounted::destructor`).
    pub process_: Option<*mut Process>,
    pub stdin: WindowsStdioResult,
    pub stdout: WindowsStdioResult,
    pub stderr: WindowsStdioResult,
    pub extra_pipes: Vec<WindowsStdioResult>,
    pub stream: bool,
    pub sync: bool,
}

#[cfg(windows)]
impl Default for WindowsSpawnResult {
    fn default() -> Self {
        Self {
            process_: None,
            stdin: WindowsStdioResult::Unavailable,
            stdout: WindowsStdioResult::Unavailable,
            stderr: WindowsStdioResult::Unavailable,
            extra_pipes: Vec::new(),
            stream: true,
            sync: false,
        }
    }
}

#[cfg(windows)]
#[derive(Default)]
pub enum WindowsStdioResult {
    /// inherit, ignore, path, pipe
    #[default]
    Unavailable,
    /// Parent (server) end of an engine pipe pair, already adopted onto the
    /// spawn loop. Consumers hand it to the io layer
    /// (`PipeSource::from_engine` / `start_with_pipe`) or release it via
    /// [`close_engine_pipe`]; `WindowsSpawnResult::Drop` covers unconsumed
    /// slots.
    Buffer(Box<bun_iocp::PipeHandle>),
}

/// Release an owned engine pipe end: close on its loop and free the box in
/// the close callback (the only legal free point).
#[cfg(windows)]
pub fn close_engine_pipe(pipe: Box<bun_iocp::PipeHandle>) {
    unsafe fn free_cb(_loop: &mut bun_iocp::Loop, data: *mut c_void) {
        // SAFETY: `data` is the raw box leaked below; the engine never
        // touches the handle after this callback.
        drop(unsafe { bun_core::heap::take(data.cast::<bun_iocp::PipeHandle>()) });
    }
    let raw = bun_core::heap::into_raw(pipe);
    // SAFETY: `raw` is the live heap-pinned handle; freed in `free_cb`.
    unsafe { (*raw).close(Some(free_cb), raw.cast::<c_void>()) };
}

#[cfg(windows)]
impl WindowsStdioResult {
    /// Mirrors `Option::<Fd>::take()` on the POSIX `SpawnedStdio` so callers
    /// (`shell::subproc`, `bun_spawn` JS bindings) can pull the handle out by
    /// value without per-platform `mem::replace` at every call site.
    #[inline]
    pub fn take(&mut self) -> Self {
        core::mem::take(self)
    }
}

#[cfg(windows)]
impl Drop for WindowsSpawnResult {
    fn drop(&mut self) {
        // A `Buffer` still held here is an unconsumed engine pipe end: close
        // it through the engine (the child observes EOF; the box is freed in
        // the close callback on the spawn loop's next tick). Slots consumed
        // via `.take()` are `Unavailable` and skip this.
        //
        // `WindowsStdioResult` itself deliberately has no `Drop` so callers
        // can keep destructuring `Buffer(pipe)` by value; the container is
        // the ownership boundary.
        for slot in [&mut self.stdin, &mut self.stdout, &mut self.stderr] {
            if let WindowsStdioResult::Buffer(pipe) = core::mem::take(slot) {
                close_engine_pipe(pipe);
            }
        }
        for slot in self.extra_pipes.drain(..) {
            if let WindowsStdioResult::Buffer(pipe) = slot {
                close_engine_pipe(pipe);
            }
        }
    }
}

#[cfg(windows)]
impl WindowsSpawnResult {
    pub fn to_process(&mut self, _event_loop: impl Sized, sync_: bool) -> *mut Process {
        let process = self.process_.take().unwrap();
        // SAFETY: caller has unique ownership at this point (just spawned)
        unsafe {
            (*process).sync = sync_;
        }
        process
    }

    pub fn close(&mut self) {
        if let Some(proc) = self.process_.take() {
            // SAFETY: proc is a live intrusive-refcounted Process
            unsafe {
                (*proc).close();
                (*proc).detach();
                bun_ptr::ThreadSafeRefCount::<Process>::deref(proc);
            }
        }
    }
}

#[cfg(windows)]
pub struct WindowsSpawnOptions {
    pub stdin: WindowsStdio,
    pub stdout: WindowsStdio,
    pub stderr: WindowsStdio,
    pub ipc: Option<Fd>,
    pub extra_fds: Box<[WindowsStdio]>,
    pub cwd: Box<[u8]>,
    pub detached: bool,
    /// `uv_process_options_t.uid` + `UV_PROCESS_SETUID`; libuv returns
    /// `UV_ENOTSUP` on Windows, exactly like Node.
    pub uid: Option<u32>,
    /// `uv_process_options_t.gid` + `UV_PROCESS_SETGID`; libuv returns
    /// `UV_ENOTSUP` on Windows, exactly like Node.
    pub gid: Option<u32>,
    pub windows: WindowsOptions,
    pub argv0: Option<*const c_char>,
    pub stream: bool,
    pub use_execve_on_macos: bool,
    pub can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool,
    /// Linux-only; placeholder for struct compatibility.
    pub linux_pdeathsig: Option<u8>,
    /// POSIX-only; placeholder for struct compatibility.
    pub new_process_group: bool,
    /// POSIX-only PTY slave fd; void placeholder on Windows.
    pub pty_slave_fd: (),
    /// Windows ConPTY handle. When set, the child is attached to the
    /// pseudoconsole and stdin/stdout/stderr are provided by ConPTY.
    pub pseudoconsole: Option<bun_sys::windows::HPCON>,
}

#[cfg(windows)]
impl Default for WindowsSpawnOptions {
    fn default() -> Self {
        Self {
            stdin: WindowsStdio::Inherit,
            stdout: WindowsStdio::Inherit,
            stderr: WindowsStdio::Inherit,
            ipc: None,
            extra_fds: Box::new([]),
            cwd: Box::new([]),
            detached: false,
            uid: None,
            gid: None,
            windows: WindowsOptions::default(),
            argv0: None,
            stream: true,
            use_execve_on_macos: false,
            can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: false,
            linux_pdeathsig: None,
            new_process_group: false,
            pty_slave_fd: (),
            pseudoconsole: None,
        }
    }
}

#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WindowsOptions {
    pub verbatim_arguments: bool,
    pub hide_window: bool,
    pub loop_: EventLoopHandle,
}

#[cfg(windows)]
impl Default for WindowsOptions {
    fn default() -> Self {
        Self {
            verbatim_arguments: false,
            hide_window: true,
            // A zeroed handle keeps `..Default::default()` usable for the
            // other fields. `spawn_process_windows` asserts non-null at the
            // read site so a forgotten `loop_` panics with a pointed message
            // instead of segfaulting inside `native_loop`.
            // SAFETY: `EventLoopHandle` is a `Copy` enum of raw pointers; the
            // all-zero bit pattern is discriminant 0 with a null payload —
            // valid representation, never dereferenced before assignment.
            loop_: unsafe { bun_core::ffi::zeroed_unchecked() },
        }
    }
}

/// Payload-less `Buffer`/`Ipc`: `spawn_process_windows` creates the engine
/// pipe pair itself and returns the parent end in `WindowsStdioResult` —
/// nothing here needs explicit cleanup (`Path` frees via `Drop`).
#[cfg(windows)]
pub enum WindowsStdio {
    Path(Box<[u8]>),
    Inherit,
    Ignore,
    Buffer,
    Ipc,
    Pipe(Fd),
    Dup2(Dup2),
}

/// Event-loop-aware extension on the raw [`PosixSpawnResult`] from
/// `bun_spawn_sys`. The result type itself lives in the leaf `-sys` crate (no
/// `Process`/`EventLoopHandle` dependency); `to_process` is added here as a
/// trait method so callers keep the `.to_process(loop_, sync)` spelling.
pub trait SpawnResultExt {
    fn to_process(self, event_loop: EventLoopHandle, sync_: bool) -> *mut Process;
}

#[cfg(unix)]
impl SpawnResultExt for PosixSpawnResult {
    fn to_process(self, event_loop: EventLoopHandle, sync_: bool) -> *mut Process {
        Process::init_posix(&self, event_loop, sync_)
    }
}

#[cfg(unix)]
pub type SpawnOptions = PosixSpawnOptions;
#[cfg(windows)]
pub type SpawnOptions = WindowsSpawnOptions;

#[cfg(unix)]
pub type Stdio = PosixStdio;
#[cfg(windows)]
pub type Stdio = WindowsStdio;

#[cfg(unix)]
pub type SpawnProcessResult = PosixSpawnResult;
#[cfg(windows)]
pub type SpawnProcessResult = WindowsSpawnResult;

// ─── spawn_process bodies + sync runner ──────────────────────────────────────

mod spawn_process_body {
    use super::*;
    #[cfg(unix)]
    use bun_sys::FdExt as _;

    #[cfg(unix)]
    pub use bun_spawn_sys::spawn_process_posix;

    /// RAII fd owner — closes the wrapped [`Fd`] on drop iff it is valid.
    /// Used by `sync::spawn_posix` (no-orphans kqueue, ppid pidfd).
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    struct AutoCloseFd(Fd);

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    impl AutoCloseFd {
        #[inline]
        const fn new(fd: Fd) -> Self {
            Self(fd)
        }
        #[inline]
        const fn invalid() -> Self {
            Self(Fd::INVALID)
        }
        #[inline]
        fn fd(&self) -> Fd {
            self.0
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    impl Drop for AutoCloseFd {
        fn drop(&mut self) {
            if self.0 != Fd::INVALID {
                self.0.close();
            }
        }
    }

    /// # Safety
    /// `argv` must point to a null-terminated array of NUL-terminated C
    /// strings with at least one non-null element; `envp` must point to a
    /// null-terminated array of NUL-terminated C strings. Both must remain
    /// valid for the duration of the call.
    pub unsafe fn spawn_process(
        options: &SpawnOptions,
        argv: Argv, // [*:null]?[*:0]const u8
        envp: Envp,
    ) -> Result<bun_sys::Result<SpawnProcessResult>, bun_core::Error> {
        #[cfg(unix)]
        {
            // SAFETY: forwarded from this function's safety contract.
            unsafe { spawn_process_posix(options, argv, envp) }
        }
        #[cfg(not(unix))]
        {
            spawn_process_windows(options, argv, envp)
        }
    }

    #[cfg(windows)]
    pub fn spawn_process_windows(
        options: &WindowsSpawnOptions,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> Result<bun_sys::Result<WindowsSpawnResult>, bun_core::Error> {
        // `WindowsOptions::default()` leaves `loop_` zeroed (every
        // `bun.spawnSync` call site sets it explicitly). A zeroed
        // `EventLoopHandle` is discriminant 0 (`Js`) with a null inner pointer,
        // so `platform_event_loop()` returns null. Catch that with a clear
        // panic instead of an opaque exit-code-3. Release-build assert: this
        // is the contract boundary, not a debug aid.
        assert!(
            !options.windows.loop_.platform_event_loop().is_null(),
            "spawn_process_windows: WindowsSpawnOptions.windows.loop_ was not set. \
         WindowsOptions::default() leaves it zeroed (Zig spec: `= undefined`); \
         every caller must populate it — see src/CLAUDE.md §Spawning Subprocesses \
         (`.loop = jsc.EventLoopHandle.init(jsc.MiniEventLoop.initGlobal(...))`)."
        );
        // The uws wrapper carries the engine loop it runs on.
        // SAFETY: non-null verified above; the wrapper is a live `us_loop_t`.
        let lp = unsafe {
            bun_iocp::usockets::native_loop(
                options.windows.loop_.platform_event_loop().cast::<c_void>(),
            )
        };
        spawn_process_windows_on(lp, options, argv, envp)
    }

    /// Spawn on an explicit engine loop — `spawn_process_windows` resolves it
    /// from `options.windows.loop_`; the sync runner passes its private loop.
    #[cfg(windows)]
    pub(crate) fn spawn_process_windows_on(
        lp: *mut bun_iocp::Loop,
        options: &WindowsSpawnOptions,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> Result<bun_sys::Result<WindowsSpawnResult>, bun_core::Error> {
        use bun_iocp::pipe::{PairOptions, create_pair};
        use bun_iocp::process::Stdio as EngineStdio;

        bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);

        // Borrow argv/envp into byte slices for the engine.
        // SAFETY: caller contract (`spawn_process`) — both are live,
        // NULL-terminated arrays of NUL-terminated C strings, argv[0]
        // non-null; the slices only live for this call.
        let mut args: Vec<&[u8]> = Vec::new();
        let mut envs: Vec<&[u8]> = Vec::new();
        // SAFETY: argv/envp are NUL-terminated arrays of NUL-terminated C
        // strings per the spawn_process contract; the slices die with this call.
        unsafe {
            let mut p = argv;
            while !(*p).is_null() {
                args.push(bun_core::ffi::cstr(*p).to_bytes());
                p = p.add(1);
            }
            let mut e = envp;
            while !(*e).is_null() {
                envs.push(bun_core::ffi::cstr(*e).to_bytes());
                e = e.add(1);
            }
        }
        // SAFETY: argv0 (when set) is a NUL-terminated C string per the
        // `WindowsSpawnOptions` contract; args[0] exists per spawn_process.
        let file: &[u8] = match options.argv0 {
            // SAFETY: argv0 (when set) is NUL-terminated per the options contract.
            Some(p) => unsafe { bun_core::ffi::cstr(p).to_bytes() },
            None => args.first().copied().unwrap_or(b""),
        };
        // Empty cwd means "inherit" — the engine resolves `None` itself.
        let cwd: Option<&[u8]> = if options.cwd.is_empty() {
            None
        } else {
            Some(&options.cwd)
        };

        let mut flags: u32 = 0;
        if options.windows.hide_window {
            flags |= bun_iocp::process::PROCESS_HIDE;
        }
        if options.windows.verbatim_arguments {
            flags |= bun_iocp::process::PROCESS_VERBATIM_ARGUMENTS;
        }
        if options.detached {
            flags |= bun_iocp::process::PROCESS_DETACHED;
        }

        // uid/gid are POSIX-only; report ENOTSUP like Node does on Windows
        // (libuv rejected UV_PROCESS_SETUID/SETGID the same way).
        if options.uid.is_some() || options.gid.is_some() {
            return Ok(Err(bun_sys::Error::new(
                bun_sys::E::NOTSUP,
                bun_sys::Tag::posix_spawn,
            )));
        }

        let slot_count = 3 + options.extra_fds.len();
        let mut engine_stdio: Vec<EngineStdio> = Vec::with_capacity(slot_count);
        // Parent-side outcome per slot: moved into `WindowsSpawnResult` on
        // success, closed on failure.
        let mut parent_ends: Vec<WindowsStdioResult> = Vec::with_capacity(slot_count);
        // Child (client) pipe ends: the engine duplicates them into the
        // child, so OUR copies close right after spawn on BOTH paths.
        let mut client_ends: Vec<HANDLE> = Vec::new();
        // Files opened for `Path` slots: parent copies, closed on both paths.
        let mut files_to_close: Vec<Fd> = Vec::new();
        // The 2>&1 pair's server end; bare until the target slot consumes it
        // (every error exit closes it via `close_on_error`).
        let mut dup_server: Option<Box<bun_iocp::PipeHandle>> = None;

        let close_on_error =
            |parent_ends: &mut Vec<WindowsStdioResult>,
             client_ends: &[HANDLE],
             files: &[Fd],
             dup_server: &mut Option<Box<bun_iocp::PipeHandle>>| {
                // The dup2 pair's server end is a local until the target slot
                // consumes it — release it here so no error exit leaks it.
                if let Some(pipe) = dup_server.take() {
                    close_engine_pipe(pipe);
                }
                for slot in parent_ends.drain(..) {
                    match slot {
                        // Already adopted: async engine close (the caller's loop
                        // ticks it; sync paths drain explicitly).
                        WindowsStdioResult::Buffer(pipe) => close_engine_pipe(pipe),
                        WindowsStdioResult::Unavailable => {}
                    }
                }
                for &c in client_ends {
                    Fd::from_system(c).close();
                }
                for &f in files {
                    f.close();
                }
            };

        // Adopt a fresh pair's server end onto `lp`; on failure both ends die
        // here and the caller unwinds via `close_on_error`.
        let adopt_server = |server: HANDLE| -> Result<Box<bun_iocp::PipeHandle>, Win32Error> {
            // SAFETY: `lp` is the live pinned loop; `server` is the owned
            // overlapped server end (ownership transfers on success).
            match unsafe { bun_iocp::PipeHandle::open(lp, server) } {
                Ok(pipe) => Ok(pipe),
                Err(w) => {
                    Fd::from_system(server).close();
                    Err(w)
                }
            }
        };

        // ConPTY supersedes stdio wholesale (the engine rejects mixing them;
        // libuv silently ignored stdio here — preserve that user-visible
        // behavior by not building any).
        if options.pseudoconsole.is_none() {
            let stdio_options: [&WindowsStdio; 3] =
                [&options.stdin, &options.stdout, &options.stderr];

            // dup2 (`2>&1`): one pair; the synchronous (CRT) write end goes to
            // BOTH child slots, the parent keeps the read end at the target.
            let dup_at_1 = matches!(options.stdout, WindowsStdio::Dup2(_));
            let dup_at_2 = matches!(options.stderr, WindowsStdio::Dup2(_));
            let dup_tgt: Option<usize> = if dup_at_1 {
                Some(2)
            } else if dup_at_2 {
                Some(1)
            } else {
                None
            };
            let mut dup_client: HANDLE = core::ptr::null_mut();
            if dup_at_1 || dup_at_2 {
                match create_pair(&PairOptions {
                    server_readable: true,
                    server_writable: false,
                    client_readable: false,
                    client_writable: true,
                    client_overlapped: false,
                    client_inheritable: false,
                })
                .and_then(|(server, client)| match adopt_server(server) {
                    Ok(pipe) => Ok((pipe, client)),
                    Err(w) => {
                        Fd::from_system(client).close();
                        Err(w)
                    }
                }) {
                    Ok((pipe, client)) => {
                        dup_server = Some(pipe);
                        dup_client = client;
                        client_ends.push(client);
                    }
                    Err(w) => {
                        close_on_error(
                            &mut parent_ends,
                            &client_ends,
                            &files_to_close,
                            &mut dup_server,
                        );
                        return Ok(Err(bun_sys::Error::new(
                            win_error::translate(w),
                            bun_sys::Tag::pipe,
                        )));
                    }
                }
            }

            for i in 0..3usize {
                if dup_tgt == Some(i) {
                    engine_stdio.push(EngineStdio::Raw(dup_client));
                    parent_ends.push(WindowsStdioResult::Buffer(
                        dup_server.take().expect("dup2 pair adopted above"),
                    ));
                    continue;
                }
                match stdio_options[i] {
                    WindowsStdio::Dup2(_) => {
                        // Source slot: same child write end, nothing for the
                        // parent. A Dup2 at slot 0 never created a pair —
                        // `Raw(null)` fails the spawn, like the old `fd -1`.
                        engine_stdio.push(EngineStdio::Raw(dup_client));
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                    WindowsStdio::Inherit => {
                        let std_fd = match i {
                            0 => Fd::stdin(),
                            1 => Fd::stdout(),
                            _ => Fd::stderr(),
                        };
                        // Invalid std handles are forgiven by the engine for
                        // fds 0-2 (GUI parents have no stdio).
                        engine_stdio.push(EngineStdio::InheritFd(std_fd.native()));
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                    // ipc inside stdin/stdout/stderr is not supported.
                    WindowsStdio::Ipc | WindowsStdio::Ignore => {
                        engine_stdio.push(EngineStdio::Ignore);
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                    WindowsStdio::Path(path) => {
                        let rw = if i == 0 {
                            bun_sys::O::RDONLY
                        } else {
                            bun_sys::O::WRONLY
                        };
                        let open_flags = rw | bun_sys::O::CREAT;
                        let path_z = match bun_sys::to_posix_path(path) {
                            Ok(p) => p,
                            Err(e) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Err(e);
                            }
                        };
                        match bun_sys::open(
                            bun_core::ZStr::from_cstr(path_z.as_c_str()),
                            open_flags,
                            0o644,
                        ) {
                            Ok(fd) => {
                                engine_stdio.push(EngineStdio::Raw(fd.native()));
                                files_to_close.push(fd);
                                parent_ends.push(WindowsStdioResult::Unavailable);
                            }
                            Err(err) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Ok(Err(err));
                            }
                        }
                    }
                    WindowsStdio::Buffer => {
                        // Synchronous child end: CRT stdio does plain
                        // Read/WriteFile. Duplex access mirrors the old
                        // READABLE|WRITABLE pipe flags.
                        let made = create_pair(&PairOptions {
                            server_readable: true,
                            server_writable: true,
                            client_readable: true,
                            client_writable: true,
                            client_overlapped: false,
                            client_inheritable: false,
                        })
                        .and_then(|(server, client)| {
                            match adopt_server(server) {
                                Ok(pipe) => Ok((pipe, client)),
                                Err(w) => {
                                    Fd::from_system(client).close();
                                    Err(w)
                                }
                            }
                        });
                        match made {
                            Ok((pipe, client)) => {
                                client_ends.push(client);
                                engine_stdio.push(EngineStdio::Raw(client));
                                parent_ends.push(WindowsStdioResult::Buffer(pipe));
                            }
                            Err(w) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Ok(Err(bun_sys::Error::new(
                                    win_error::translate(w),
                                    bun_sys::Tag::uv_pipe,
                                )));
                            }
                        }
                    }
                    WindowsStdio::Pipe(fd) => {
                        bun_sys::windows::mark_fd_shared_with_child(*fd);
                        engine_stdio.push(EngineStdio::InheritFd(fd.native()));
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                }
            }

            for (j, extra) in options.extra_fds.iter().enumerate() {
                match extra {
                    WindowsStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
                    WindowsStdio::Inherit => {
                        let fd = Fd::from_js_fd(i32::try_from(3 + j).expect("int cast"));
                        bun_sys::windows::mark_fd_shared_with_child(fd);
                        engine_stdio.push(EngineStdio::InheritFd(fd.native()));
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                    WindowsStdio::Ignore => {
                        engine_stdio.push(EngineStdio::Ignore);
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                    WindowsStdio::Path(path) => {
                        let path_z = match bun_sys::to_posix_path(path) {
                            Ok(p) => p,
                            Err(e) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Err(e);
                            }
                        };
                        match bun_sys::open(
                            bun_core::ZStr::from_cstr(path_z.as_c_str()),
                            bun_sys::O::RDWR | bun_sys::O::CREAT,
                            0o644,
                        ) {
                            Ok(fd) => {
                                engine_stdio.push(EngineStdio::Raw(fd.native()));
                                files_to_close.push(fd);
                                parent_ends.push(WindowsStdioResult::Unavailable);
                            }
                            Err(err) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Ok(Err(err));
                            }
                        }
                    }
                    WindowsStdio::Ipc | WindowsStdio::Buffer => {
                        // Extra channels are duplex with an OVERLAPPED child
                        // end (foreign runtimes adopt them into their loops).
                        let made =
                            create_pair(&PairOptions::duplex()).and_then(|(server, client)| {
                                match adopt_server(server) {
                                    Ok(pipe) => Ok((pipe, client)),
                                    Err(w) => {
                                        Fd::from_system(client).close();
                                        Err(w)
                                    }
                                }
                            });
                        match made {
                            Ok((pipe, client)) => {
                                client_ends.push(client);
                                engine_stdio.push(EngineStdio::Raw(client));
                                parent_ends.push(WindowsStdioResult::Buffer(pipe));
                            }
                            Err(w) => {
                                close_on_error(
                                    &mut parent_ends,
                                    &client_ends,
                                    &files_to_close,
                                    &mut dup_server,
                                );
                                return Ok(Err(bun_sys::Error::new(
                                    win_error::translate(w),
                                    bun_sys::Tag::uv_pipe,
                                )));
                            }
                        }
                    }
                    WindowsStdio::Pipe(fd) => {
                        bun_sys::windows::mark_fd_shared_with_child(*fd);
                        engine_stdio.push(EngineStdio::InheritFd(fd.native()));
                        parent_ends.push(WindowsStdioResult::Unavailable);
                    }
                }
            }
        } else {
            parent_ends.resize_with(slot_count, WindowsStdioResult::default);
        }

        let process = bun_core::heap::into_raw(Box::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            event_loop: options.windows.loop_,
            pid: 0,
            pidfd: (),
            status: Status::Running,
            poller: Poller::Detached,
            exit_handler: ProcessExitHandler::default(),
            sync: false,
        }));

        let engine_options = bun_iocp::process::ProcessOptions {
            file,
            args: &args,
            env: Some(&envs),
            cwd,
            flags,
            stdio: &engine_stdio,
            pseudoconsole: options.pseudoconsole,
        };
        // SAFETY: `lp` is the live pinned engine loop (it outlives every
        // handle spawned on it); stdio handles were created above and stay
        // valid through the call; `process` is heap-pinned until the close
        // callback (`on_close_engine`) and is valid whenever the exit
        // callback can run.
        let spawned = unsafe {
            EngineProcessHandle::spawn(
                lp,
                &engine_options,
                Some(Process::on_exit_engine),
                process.cast::<c_void>(),
            )
        };

        let handle = match spawned {
            Ok(h) => h,
            Err(w) => {
                close_on_error(
                    &mut parent_ends,
                    &client_ends,
                    &files_to_close,
                    &mut dup_server,
                );
                // SAFETY: freshly allocated above; poller is Detached so
                // close() is a no-op and deref frees the sole ref.
                unsafe {
                    (*process).close();
                    Process::deref(process);
                }
                return Ok(Err(bun_sys::Error::new(
                    win_error::translate(w),
                    bun_sys::Tag::uv_spawn,
                )));
            }
        };

        // SAFETY: `process` is the live allocation; no engine callback can
        // run before the loop is next ticked, so this write does not race.
        unsafe {
            (*process).pid = handle.pid() as PidT;
            (*process).poller = Poller::Engine(handle);
        }

        // The engine duplicated every child handle: release our copies now,
        // success included.
        for c in client_ends {
            Fd::from_system(c).close();
        }
        for f in files_to_close {
            f.close();
        }

        // No FRU `..Default::default()` here: `WindowsSpawnResult` impls `Drop`,
        // so functional-record-update would have to move fields out of the
        // temporary default — E0509. Spell the defaults out instead.
        let mut result = WindowsSpawnResult {
            // Intrusive raw pointer; refcount lives inside `Process` (see field comment).
            process_: Some(process),
            stdin: WindowsStdioResult::Unavailable,
            stdout: WindowsStdioResult::Unavailable,
            stderr: WindowsStdioResult::Unavailable,
            extra_pipes: Vec::with_capacity(options.extra_fds.len()),
            stream: true,
            sync: false,
        };
        let mut slots = parent_ends.into_iter();
        result.stdin = slots.next().unwrap_or_default();
        result.stdout = slots.next().unwrap_or_default();
        result.stderr = slots.next().unwrap_or_default();
        result.extra_pipes.extend(slots);

        Ok(Ok(result))
    }

    pub mod sync {
        use super::*;
        // `Options.windows` is `WindowsOptions` on Windows; surface it under the
        // `…::process::sync` path. A `pub use super::…`
        // re-export trips E0365 here because the `use super::*` glob has already
        // bound the name privately and rustc treats the explicit re-export as
        // re-exporting that private binding; a type alias sidesteps the conflict.
        #[cfg(windows)]
        pub type WindowsOptions = super::WindowsOptions;

        pub struct Options {
            pub stdin: SyncStdio,
            pub stdout: SyncStdio,
            pub stderr: SyncStdio,
            pub ipc: Option<Fd>,
            pub cwd: Box<[u8]>,
            pub detached: bool,

            pub argv: Vec<Box<[u8]>>,
            /// null = inherit parent env
            pub envp: Option<*const *const c_char>,

            pub use_execve_on_macos: bool,
            pub argv0: Option<*const c_char>,

            #[cfg(windows)]
            pub windows: WindowsOptions,
            #[cfg(not(windows))]
            pub windows: (),
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum SyncStdio {
            Inherit,
            Ignore,
            Buffer,
        }

        impl SyncStdio {
            pub fn to_stdio(self) -> SpawnOptionsStdio {
                match self {
                    SyncStdio::Inherit => SpawnOptionsStdio::Inherit,
                    SyncStdio::Ignore => SpawnOptionsStdio::Ignore,
                    SyncStdio::Buffer => SpawnOptionsStdio::Buffer,
                }
            }
        }

        // Helper alias: SpawnOptions::Stdio differs by platform
        #[cfg(unix)]
        pub type SpawnOptionsStdio = PosixStdio;
        #[cfg(windows)]
        pub type SpawnOptionsStdio = WindowsStdio;

        impl Default for Options {
            fn default() -> Self {
                Self {
                    stdin: SyncStdio::Ignore,
                    stdout: SyncStdio::Inherit,
                    stderr: SyncStdio::Inherit,
                    ipc: None,
                    cwd: Box::default(),
                    detached: false,
                    argv: Vec::new(),
                    envp: None,
                    use_execve_on_macos: false,
                    argv0: None,
                    #[cfg(windows)]
                    windows: Default::default(),
                    #[cfg(not(windows))]
                    windows: (),
                }
            }
        }

        impl Options {
            pub fn to_spawn_options(&self, new_process_group: bool) -> SpawnOptions {
                SpawnOptions {
                    stdin: self.stdin.to_stdio(),
                    stdout: self.stdout.to_stdio(),
                    stderr: self.stderr.to_stdio(),
                    ipc: self.ipc,
                    cwd: self.cwd.clone(),
                    detached: self.detached,
                    use_execve_on_macos: self.use_execve_on_macos,
                    stream: false,
                    argv0: self.argv0,
                    new_process_group,
                    #[cfg(windows)]
                    windows: self.windows,
                    #[cfg(not(windows))]
                    windows: (),
                    ..Default::default()
                }
            }
        }

        pub struct Result {
            pub status: Status,
            pub stdout: Vec<u8>,
            pub stderr: Vec<u8>,
        }

        impl Result {
            pub fn is_ok(&self) -> bool {
                self.status.is_ok()
            }
        }

        /// Read-buffer size per engine completion (copied into `chunks`).
        #[cfg(windows)]
        const SYNC_READ_BUF: usize = 64 * 1024;

        #[cfg(windows)]
        pub struct SyncWindowsPipeReader {
            pub chunks: Vec<Box<[u8]>>,
            /// Fixed read target registered with the engine; must stay valid
            /// until the close callback (it lives in this heap-pinned box).
            buf: Box<[u8]>,
            pub pipe: Box<bun_iocp::PipeHandle>,
            pub err: bun_sys::E,
            pub context: *mut SyncWindowsProcess,
            pub on_done_callback: fn(*mut SyncWindowsProcess, OutFd, Vec<Box<[u8]>>, bun_sys::E),
            pub tag: OutFd,
        }

        #[cfg(windows)]
        impl SyncWindowsPipeReader {
            pub fn new(v: SyncWindowsPipeReader) -> Box<Self> {
                Box::new(v)
            }

            /// Engine read callback: success delivers `n >= 1` bytes into our
            /// registered buffer; any error delivers once and stops reading
            /// (`BROKEN_PIPE` is the raw EOF shape on pipes).
            unsafe fn on_read(
                _loop: &mut bun_iocp::Loop,
                data: *mut c_void,
                buf: *mut u8,
                n: usize,
                err: Win32Error,
            ) {
                let this = data.cast::<SyncWindowsPipeReader>();
                if err == Win32Error::SUCCESS {
                    // SAFETY: `buf[..n]` is the registered read target filled
                    // by the completion; `this` is the heap-pinned reader.
                    unsafe {
                        let chunk = core::slice::from_raw_parts(buf, n);
                        (*this).chunks.push(Box::from(chunk));
                    }
                    return;
                }
                // SAFETY: `this` is live until the close callback below runs.
                unsafe {
                    (*this).err = win_error::translate(err);
                    (*this).pipe.close(Some(Self::on_close), data);
                }
            }

            unsafe fn on_close(_loop: &mut bun_iocp::Loop, data: *mut c_void) {
                let this = data.cast::<SyncWindowsPipeReader>();
                // SAFETY: `this` is valid until we destroy it below.
                let this_ref = unsafe { &mut *this };
                let context = this_ref.context;
                // Move the chunk allocations out *before* dropping `this`.
                let chunks: Vec<Box<[u8]>> = core::mem::take(&mut this_ref.chunks);
                let err = if this_ref.err == bun_sys::E::CANCELED {
                    bun_sys::E::SUCCESS
                } else {
                    this_ref.err
                };
                let tag = this_ref.tag;
                let on_done_callback = this_ref.on_done_callback;
                // SAFETY: heap-allocated in start(); the engine close callback
                // is the contractual point where the pipe box may be freed.
                drop(unsafe { bun_core::heap::take(this) });
                on_done_callback(context, tag, chunks, err);
            }

            pub fn start(self: Box<Self>) -> Maybe<()> {
                // Single-pointer ownership: `heap::into_raw` is the *only* root
                // for this allocation; the engine callbacks and the
                // `heap::take` in `on_close` all go through it.
                let this: *mut SyncWindowsPipeReader = bun_core::heap::into_raw(self);
                // SAFETY: just allocated, sole owner; `buf` lives in the same
                // pinned allocation so it outlives the read registration.
                unsafe {
                    let (buf, len) = {
                        let b = &mut (*this).buf;
                        (b.as_mut_ptr(), b.len())
                    };
                    if let Err(w) = (*this)
                        .pipe
                        .read_start(buf, len, Self::on_read, this.cast())
                    {
                        // Intentionally leak `this`: the pipe handle is live on
                        // the loop and only a close callback may free it. The
                        // sole caller `Output::panic`s on error, so the leak is
                        // bounded.
                        return Err(bun_sys::Error::new(
                            win_error::translate(w),
                            bun_sys::Tag::listen,
                        ));
                    }
                }
                Ok(())
            }
        }

        #[cfg(windows)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum OutFd {
            Stdout,
            Stderr,
        }

        #[cfg(windows)]
        impl OutFd {
            #[inline]
            pub fn as_str(self) -> &'static str {
                match self {
                    OutFd::Stdout => "stdout",
                    OutFd::Stderr => "stderr",
                }
            }
        }

        #[cfg(windows)]
        pub struct SyncWindowsProcess {
            pub stderr: Vec<Box<[u8]>>,
            pub stdout: Vec<Box<[u8]>>,
            pub err: bun_sys::E,
            pub waiting_count: u8,
            /// Intrusive-refcounted. Allocated via
            /// `heap::alloc` in `to_process`; freed when the embedded
            /// `ThreadSafeRefCount` hits zero. Stored raw — `Arc<Process>` would
            /// give only `*const` provenance and make `&mut *` writes UB.
            pub process: *mut Process,
            pub status: Option<Status>,
        }

        #[cfg(windows)]
        impl SyncWindowsProcess {
            pub fn new(v: SyncWindowsProcess) -> Box<Self> {
                Box::new(v)
            }

            /// `process` is the *same* `*mut Process` that was threaded through
            /// `Process::on_exit_uv` → `Process::on_exit` → `ProcessExitHandler::call`
            /// (which holds a protector-guarded `&mut Process` in its frame).
            /// Re-deriving a `&mut Process` from the independent `self.process`
            /// root would pop that protected tag under Stacked Borrows, so we
            /// take the already-live pointer instead.
            // Engine C-ABI callback target: the raw pointers are the
            // heap-pinned roots the engine round-trips (see SAFETY below).
            #[allow(clippy::not_unsafe_ptr_arg_deref)]
            pub fn on_process_exit(
                this: *mut SyncWindowsProcess,
                process: *mut Process,
                status: Status,
                _: &Rusage,
            ) {
                // SAFETY: `this` is the heap::alloc root from spawn_windows_with_pipes;
                // single-threaded uv loop, no overlapping borrow of SyncWindowsProcess.
                unsafe {
                    (*this).status = Some(status);
                    (*this).waiting_count -= 1;
                }
                // SAFETY: `process` carries the provenance of the `&mut Process`
                // already live in `ProcessExitHandler::call`; mutating through it
                // re-uses that tag instead of conflicting with it.
                unsafe {
                    (*process).detach();
                    Process::deref(process);
                }
            }

            // Engine C-ABI callback target: `this` is the heap-pinned root the
            // engine round-trips (see SAFETY below).
            #[allow(clippy::not_unsafe_ptr_arg_deref)]
            pub fn on_reader_done(
                this: *mut SyncWindowsProcess,
                tag: OutFd,
                chunks: Vec<Box<[u8]>>,
                err: bun_sys::E,
            ) {
                // SAFETY: this is valid (back-ref from SyncWindowsPipeReader)
                let this = unsafe { &mut *this };
                match tag {
                    OutFd::Stderr => this.stderr = chunks,
                    OutFd::Stdout => this.stdout = chunks,
                }
                if err != bun_sys::E::SUCCESS {
                    this.err = err;
                }
                this.waiting_count -= 1;
            }
        }

        #[cfg(windows)]
        fn flatten_owned_chunks(chunks: Vec<Box<[u8]>>) -> Vec<u8> {
            let mut total_size: usize = 0;
            for chunk in &chunks {
                total_size += chunk.len();
            }
            let mut result = Vec::with_capacity(total_size);
            for chunk in chunks {
                result.extend_from_slice(&chunk);
            }
            result
        }

        /// Create the per-call private engine loop. SpawnSync never rides a
        /// shared loop: a private one cannot dispatch unrelated work while we
        /// block, and worker threads stop racing one global loop.
        #[cfg(windows)]
        fn private_sync_loop() -> core::result::Result<Maybe<Box<bun_iocp::Loop>>, bun_core::Error>
        {
            match bun_iocp::Loop::new() {
                Ok(lp) => Ok(Ok(lp)),
                Err(w) => Ok(Err(bun_sys::Error::new(
                    win_error::translate(w),
                    bun_sys::Tag::uv_spawn,
                ))),
            }
        }

        /// Run the engine close handshake to completion so the loop can drop
        /// (its `Drop` asserts no live work).
        ///
        /// # Safety
        /// `process` must be live with its poller on `lp`.
        #[cfg(windows)]
        unsafe fn drain_process_close(lp: &mut bun_iocp::Loop, process: *mut Process) {
            // SAFETY: caller contract; detach() is idempotent (close skips
            // when already closing/detached).
            unsafe {
                (*process).detach();
                // The condition mutates through `this` inside tick() (the
                // close callback swaps the poller to Detached).
                #[allow(clippy::while_immutable_condition)]
                while matches!((*process).poller, Poller::Engine(_)) {
                    lp.tick(Some(0));
                }
            }
        }

        /// Tick the private loop until every straggler (unconsumed pipe-end
        /// closes) has drained — required before the loop may drop.
        #[cfg(windows)]
        fn drain_loop(lp: &mut bun_iocp::Loop) {
            while lp.alive() {
                lp.tick(Some(0));
            }
        }

        #[cfg(windows)]
        fn spawn_windows_without_pipes(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            let mut lp = match private_sync_loop()? {
                Err(err) => return Ok(Err(err)),
                Ok(lp) => lp,
            };
            let lp_ptr: *mut bun_iocp::Loop = &raw mut *lp;
            let mut spawned = match spawn_process_windows_on(
                lp_ptr,
                &options.to_spawn_options(false),
                argv,
                envp,
            )? {
                Err(err) => return Ok(Err(err)),
                Ok(proces) => proces,
            };

            // `*mut Process` — intrusive refcount (heap::alloc in to_process).
            let process: *mut Process = spawned.to_process((), true);
            // SAFETY: just allocated; no other borrow live yet.
            unsafe {
                (*process).enable_keeping_event_loop_alive();
            }

            // SAFETY: read-only field access between ticks; the exit
            // callback's `&mut Process` does not overlap this `&Process`.
            while !unsafe { (*process).has_exited() } {
                lp.tick(None);
            }

            // SAFETY: process has exited; no further mutation.
            let status = unsafe { (*process).status.clone() };
            // SAFETY: poller rides `lp`; close completes before the loop drops.
            unsafe {
                drain_process_close(&mut lp, process);
                Process::deref(process);
            }

            Ok(Ok(Result {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }))
        }

        #[cfg(windows)]
        fn spawn_windows_with_pipes(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            let mut lp = match private_sync_loop()? {
                Err(err) => return Ok(Err(err)),
                Ok(lp) => lp,
            };
            let lp_ptr: *mut bun_iocp::Loop = &raw mut *lp;
            let mut spawned = match spawn_process_windows_on(
                lp_ptr,
                &options.to_spawn_options(false),
                argv,
                envp,
            )? {
                Err(err) => {
                    // Failed spawns may have queued engine pipe closes.
                    drain_loop(&mut lp);
                    return Ok(Err(err));
                }
                Ok(process) => process,
            };
            // Single-pointer ownership: the
            // `heap::alloc` result is the *only* root for this allocation. Every
            // field access below — including those inside engine callbacks fired
            // from `tick()` — goes through `this_ptr`, so no Box auto-deref ever
            // reasserts a Unique tag and pops the callbacks' tags under Stacked
            // Borrows.
            let this_ptr: *mut SyncWindowsProcess =
                bun_core::heap::into_raw(SyncWindowsProcess::new(SyncWindowsProcess {
                    process: spawned.to_process((), true),
                    stderr: Vec::new(),
                    stdout: Vec::new(),
                    err: bun_sys::E::SUCCESS,
                    waiting_count: 1,
                    status: None,
                }));
            // SAFETY: `(*this_ptr).process` was just produced by `to_process` (sole
            // owner, mutable provenance from heap::alloc).
            unsafe {
                let p = &mut *(*this_ptr).process;
                p.ref_();
                // SAFETY: `this_ptr` is the live `SyncWindowsProcess` on the
                // caller's stack; `p` is owned by it and dropped before return.
                p.set_exit_handler(ProcessExit::new(ProcessExitKind::SyncWindows, this_ptr));
                p.enable_keeping_event_loop_alive();
            }

            for (tag, stdio) in [
                (OutFd::Stdout, &mut spawned.stdout),
                (OutFd::Stderr, &mut spawned.stderr),
            ] {
                // Take the engine pipe out of `spawned` so its auto-Drop at
                // scope end cannot double-close it.
                let taken = core::mem::replace(stdio, WindowsStdioResult::Unavailable);
                if let WindowsStdioResult::Buffer(pipe) = taken {
                    let reader = SyncWindowsPipeReader::new(SyncWindowsPipeReader {
                        context: this_ptr,
                        tag,
                        pipe,
                        chunks: Vec::new(),
                        buf: vec![0u8; SYNC_READ_BUF].into_boxed_slice(),
                        err: bun_sys::E::SUCCESS,
                        on_done_callback: SyncWindowsProcess::on_reader_done,
                    });
                    // SAFETY: sole owner via `this_ptr`; no callback fired yet.
                    unsafe {
                        (*this_ptr).waiting_count += 1;
                    }
                    // `start` consumes the Box and pins it for the engine
                    // callbacks (heap::into_raw inside).
                    match reader.start() {
                        Err(err) => {
                            // SAFETY: sync spawn — `(*this_ptr).process` is the only
                            // handle and no callback has fired yet.
                            unsafe {
                                let _ = (*(*this_ptr).process).kill(1);
                            }
                            Output::panic(format_args!(
                                "Unexpected error starting {} pipe reader\n{}",
                                tag.as_str(),
                                err
                            ));
                        }
                        Ok(()) => {}
                    }
                }
            }

            // Release the slots we did not wire (e.g. a stdin Buffer): their
            // engine close completes during the ticks below, and the child
            // observes EOF on its end.
            drop(spawned);

            // SAFETY: read-only field access between ticks; callbacks fired
            // inside `tick()` write through the same `this_ptr` root.
            // The count mutates through `this_ptr` inside tick() (exit
            // callbacks decrement it).
            #[allow(clippy::while_immutable_condition)]
            while unsafe { (*this_ptr).waiting_count } > 0 {
                lp.tick(None);
            }

            // SAFETY: loop drained (waiting_count == 0); no further engine
            // callback will touch `this_ptr`.
            let result = unsafe {
                Result {
                    status: (*this_ptr)
                        .status
                        .take()
                        .expect("Expected Process to have exited when waiting_count == 0"),
                    stdout: flatten_owned_chunks(core::mem::take(&mut (*this_ptr).stdout)),
                    stderr: flatten_owned_chunks(core::mem::take(&mut (*this_ptr).stderr)),
                }
            };
            // SAFETY: complete the close handshake (usually already done by
            // `on_process_exit`'s detach), drop the ref taken above, then
            // reclaim the SyncWindowsProcess allocation. Only then may the
            // private loop drop.
            unsafe {
                drain_process_close(&mut lp, (*this_ptr).process);
                Process::deref((*this_ptr).process);
                drop(bun_core::heap::take(this_ptr));
            }
            drain_loop(&mut lp);
            Ok(Ok(result))
        }

        pub fn spawn_with_argv(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            #[cfg(windows)]
            {
                if options.stdin != SyncStdio::Buffer
                    && options.stderr != SyncStdio::Buffer
                    && options.stdout != SyncStdio::Buffer
                {
                    return spawn_windows_without_pipes(options, argv, envp);
                }
                return spawn_windows_with_pipes(options, argv, envp);
            }

            #[cfg(unix)]
            spawn_posix(options, argv, envp)
        }

        pub fn spawn(options: &Options) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            // SAFETY: `bun_sys::environ_ptr` returns the live, NULL-terminated C
            // `environ` array when no envp override is provided.
            let envp: *const *const c_char = options.envp.unwrap_or_else(bun_sys::environ_ptr);
            let argv = &options.argv;
            let mut string_builder = bun_core::StringBuilder::default();
            for arg in argv {
                string_builder.count_z(arg);
            }
            string_builder.allocate()?;

            // Stacked Borrows: `append_z` returns a borrow derived from a fresh
            // `&mut` over the whole buffer, so each call would invalidate the raw
            // pointer saved from the previous one. Instead, copy all strings first
            // (recording offsets), then derive every argv pointer in one pass from
            // the builder's base `NonNull` — those raw pointers share the
            // allocation's original provenance and stay valid until `string_builder`
            // drops after `spawn_with_argv` returns.
            for arg in argv {
                string_builder.append_count_z(arg);
            }
            let base = string_builder
                .ptr
                .expect("allocate() succeeded")
                .as_ptr()
                .cast_const()
                .cast::<c_char>();
            let mut args: Vec<*const c_char> = Vec::with_capacity(argv.len() + 1);
            let mut off = 0usize;
            for arg in argv {
                // SAFETY: `append_count_z` wrote `arg` + NUL at `[off, off+arg.len()+1)`
                // contiguously in append order; `base` has provenance for the whole
                // `cap`-byte buffer.
                args.push(unsafe { base.add(off) });
                off += arg.len() + 1;
            }
            debug_assert_eq!(off, string_builder.len);
            args.push(core::ptr::null());

            spawn_with_argv(options, args.as_ptr(), envp)
        }

        // Forward signals from parent to the child process.
        // FFI decls live in `bun_spawn_sys::ffi` (leaf -sys crate).
        #[cfg(unix)]
        use bun_spawn_sys::ffi::{
            Bun__currentSyncPID, Bun__registerSignalsForForwarding,
            Bun__sendPendingSignalIfNecessary, Bun__unregisterSignalsForForwarding,
        };
        #[cfg(target_os = "macos")]
        use bun_spawn_sys::ffi::{
            Bun__noOrphans_begin, Bun__noOrphans_onExit, Bun__noOrphans_onFork,
            Bun__noOrphans_releaseKq,
        };

        /// RAII guard around `Bun__registerSignalsForForwarding`: registers on
        /// construction, unregisters and restores the crash-handler signal
        /// disposition on drop.
        #[cfg(unix)]
        struct SignalForwarding;
        #[cfg(unix)]
        impl SignalForwarding {
            #[inline]
            fn register() -> Self {
                Bun__registerSignalsForForwarding();
                Self
            }
        }
        #[cfg(unix)]
        impl Drop for SignalForwarding {
            fn drop(&mut self) {
                Bun__unregisterSignalsForForwarding();
                bun_crash_handler::reset_on_posix();
            }
        }

        /// TTY job-control bridge for `--no-orphans` `bun run`. We put the script
        /// in its own pgroup so `kill(-pgid)` reaches every descendant on cleanup,
        /// which makes `bun run` a one-job mini shell on a controlling terminal:
        /// Ctrl-Z stops only the script's pgroup, so we must observe the stop
        /// (WUNTRACED / EVFILT_SIGNAL+SIGCHLD), take the terminal back, stop
        /// *ourselves*, and on `fg` hand the terminal back and SIGCONT the script.
        /// Inert (`prev <= 0`) when stdin is not a TTY — the supervisor/CI case
        /// this feature targets — and the wait loops don't ask for stop reports
        /// then, matching plain `bun run`.
        #[cfg(unix)]
        struct JobControl {
            /// Foreground pgroup we displaced (i.e. the one the user's shell put
            /// `bun run` in). 0 when stdin isn't a TTY, `tcgetpgrp` failed, or we
            /// weren't the foreground pgroup to begin with.
            prev: libc::pid_t,
            script_pgid: libc::pid_t,
        }

        #[cfg(unix)]
        unsafe extern "C" {
            // All by-value c_int/pid_t args; the kernel validates fd/pid/signal —
            // no memory-safety preconditions, so `safe fn` (Rust 2024) discharges
            // the link-time proof here and callers need no unsafe block.
            safe fn tcgetpgrp(fd: c_int) -> libc::pid_t;
            safe fn tcsetpgrp(fd: c_int, pgrp: libc::pid_t) -> c_int;
            safe fn getpgrp() -> libc::pid_t;
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            safe fn getppid() -> libc::pid_t;
            safe fn isatty(fd: c_int) -> c_int;
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            safe fn raise(sig: c_int) -> c_int;
            safe fn kill(pid: libc::pid_t, sig: c_int) -> c_int;
            /// No args; returns -1/errno on failure. macOS-only caller below.
            #[cfg(target_os = "macos")]
            safe fn kqueue() -> c_int;
        }

        #[cfg(unix)]
        impl JobControl {
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            pub(crate) fn is_active(&self) -> bool {
                self.prev > 0
            }

            fn give(&mut self, pgid: libc::pid_t) {
                self.script_pgid = pgid;
                if isatty(0) == 0 {
                    return;
                }
                let fg = tcgetpgrp(0);
                // Only take the terminal if we *are* the foreground pgroup.
                // `bun run --no-orphans dev &` from an interactive shell leaves
                // stdin as the TTY (shells rely on SIGTTIN, not redirection), so
                // `tcgetpgrp` returns the shell's pgid — blocking SIGTTOU and
                // `tcsetpgrp`'ing anyway would steal the terminal from the user.
                // Same gate as `onChildStopped`'s resume path below; real shells
                // (bash `give_terminal_to`, zsh `attachtty`) do the same.
                if fg <= 0 || fg != getpgrp() {
                    return;
                }
                self.prev = fg;
                Self::ttou_blocked(pgid);
            }

            fn restore(&mut self) {
                if self.prev <= 0 {
                    return;
                }
                Self::ttou_blocked(self.prev);
                self.prev = 0;
            }

            /// Called from the wait loop when WIFSTOPPED(child). Takes the terminal
            /// back, stops `bun run` so the user's shell's `waitpid(WUNTRACED)`
            /// returns, and on resume gives the terminal back to the script (only
            /// if the shell `fg`'d us — for `bg` the shell keeps foreground and
            /// the script runs as a background pgroup like any other job).
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            fn on_child_stopped(&self) {
                if self.prev <= 0 {
                    return; // non-TTY: never asked for stop reports
                }
                Self::ttou_blocked(self.prev);
                // SIGTSTP is not in `Bun__registerSignalsForForwarding`'s set, so
                // default disposition (stop) applies and we suspend right here.
                let _ = raise(libc::SIGTSTP);
                // — resumed by the shell's SIGCONT —
                if tcgetpgrp(0) == getpgrp() {
                    Self::ttou_blocked(self.script_pgid);
                }
                let _ = kill(-self.script_pgid, libc::SIGCONT);
            }

            /// `tcsetpgrp` from a background pgroup raises SIGTTOU (default: stop);
            /// block it for the call per the standard job-control idiom.
            fn ttou_blocked(pgid: libc::pid_t) {
                // SAFETY: signal mask manipulation
                unsafe {
                    let mut set: libc::sigset_t = bun_core::ffi::zeroed();
                    let mut old: libc::sigset_t = bun_core::ffi::zeroed();
                    libc::sigemptyset(&raw mut set);
                    libc::sigemptyset(&raw mut old);
                    libc::sigaddset(&raw mut set, libc::SIGTTOU);
                    libc::sigprocmask(libc::SIG_BLOCK, &raw const set, &raw mut old);
                    let _ = tcsetpgrp(0, pgid);
                    libc::sigprocmask(libc::SIG_SETMASK, &raw const old, core::ptr::null_mut());
                }
            }
        }

        #[cfg(unix)]
        fn spawn_posix(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            // --no-orphans: put the script in its own process group so we can
            // `kill(-pgid, SIGKILL)` on every exit path. Pgroup membership is
            // inherited recursively and survives reparenting to launchd/init, so
            // this reaches grandchildren even after the script itself has exited
            // (which the libproc/procfs walk cannot — those are gone from our tree
            // once their parent dies). A `setsid()`+double-fork escapee is caught
            // by PR_SET_CHILD_SUBREAPER (Linux) / the p_puniqueid spawn-graph
            // tracker (macOS) — see `waitMacKqueue` / `waitLinuxSignalfd`.
            //
            // Disabled when `use_execve_on_macos` actually applies (macOS only —
            // see `spawnProcessPosix`): that path is `POSIX_SPAWN_SETEXEC`, which
            // replaces *our own* image and never returns, so there is no parent to
            // run the wait loop or the cleanup defers. Callers
            // (`runBinaryWithoutBunxPath`, `bunx`) set the flag unconditionally;
            // on Linux it's a spawn-side no-op so no-orphans must stay armed there.
            //
            // Also disabled off the watchdog-arming (main) thread: the subreaper
            // toggle is process-wide and `wait4(-1)` reaps *any* child, so
            // concurrent calls from a worker pool (install's `repository::exec`
            // git clones) would race the subreaper flag and steal each other's
            // exit statuses. Those callers fall through to the plain
            // `reap_child(pid)` path below; the inherited PDEATHSIG on the main
            // thread still tears the whole process down if our parent dies.
            let no_orphans = ParentDeathWatchdog::is_enabled()
                && bun_spawn_sys::pdeathsig::is_arming_thread()
                && !(cfg!(target_os = "macos") && options.use_execve_on_macos);

            // Snapshot pre-existing direct children so the disarm defer can tell
            // subreaper-adopted orphans (ppid==us) apart from `Bun.spawn` siblings
            // (also ppid==us). Typically empty — `bun run`/`bunx` have no JS VM —
            // but spawnSync can run inside a live VM (the FFI xcrun probe).
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let mut siblings_buf = [0 as libc::pid_t; 64];
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let siblings: &[libc::pid_t] = if no_orphans {
                ParentDeathWatchdog::snapshot_children(&mut siblings_buf)
            } else {
                &siblings_buf[0..0]
            };
            #[cfg(any(target_os = "linux", target_os = "android"))]
            if no_orphans {
                // Subreaper: arm *before* spawn so a fast-daemonizing script can't
                // reparent its grandchild to init in the gap. Process-wide and
                // only the spawnSync wait loop has a `wait4(-1)` to reap
                // adoptees, so arming it globally from `enable()` would leak
                // zombies in `bun foo.js` / `--filter` / `bun test`. Disarmed by
                // the defer immediately below — registered here (not in the
                // post-spawn `defer if (no_orphans)` block) so spawn-failure
                // early returns don't leave subreaper armed process-wide.
                // SAFETY: prctl
                let _ = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) };
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            scopeguard::defer! {
                if no_orphans {
                    // Kill subreaper-adopted setsid daemons (ppid==us, not in the
                    // pre-arm snapshot) *before* disarming, while we can still find
                    // them. Without this, a daemon whose intermediate parent exits
                    // between disarm and `onProcessExit`→`killDescendants()` escapes
                    // to init.
                    ParentDeathWatchdog::kill_subreaper_adoptees(siblings);
                    // SAFETY: prctl
                    let _ = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 0) };
                }
            }

            // macOS no_orphans: kqueue passed to `waitMacKqueue` for ppid/child
            // NOTE_EXIT and per-descendant NOTE_FORK. NOTE_TRACK (auto-attach to
            // forks) has been ENOTSUP since macOS 10.5 — see sys/event.h:356 — so
            // we cannot get atomic in-kernel descendant tracking. Instead the
            // wait loop reacts to NOTE_FORK by running a `p_puniqueid` scan
            // (`NoOrphansTracker::scan()`) to discover and re-arm new
            // descendants. `p_puniqueid` is the *spawning* parent's per-boot
            // uniqueid — immutable across reparenting — so the scan finds
            // setsid+double-fork escapees as long as each intermediate's uniqueid
            // was recorded before it died. The `begin()` call below seeds the
            // scan root after spawn.
            // LIFO: `no_orphans_kq` drops (closes) LAST — after killSyncScriptTree()
            // (which scans via m_kq) and the releaseKq() defer below.
            #[cfg(target_os = "macos")]
            let mut no_orphans_kq = AutoCloseFd::invalid();
            #[cfg(target_os = "macos")]
            if no_orphans {
                let kq = kqueue();
                if kq >= 0 {
                    no_orphans_kq = AutoCloseFd::new(Fd::from_native(kq));
                }
            }
            // LIFO: runs after killSyncScriptTree() (which needs m_kq live for
            // its NOTE_FORK-drain rescan), before `no_orphans_kq` drops/closes.
            #[cfg(target_os = "macos")]
            scopeguard::defer! {
                if no_orphans_kq.fd() != Fd::INVALID {
                    Bun__noOrphans_releaseKq();
                }
            }

            Bun__currentSyncPID.store(0, core::sync::atomic::Ordering::Relaxed);
            let _signals = SignalForwarding::register();

            // SAFETY: caller-built argv/envp are null-terminated C-string
            // arrays with argv[0] non-null; valid for this call.
            let process = match unsafe {
                spawn_process_posix(&options.to_spawn_options(no_orphans), argv, envp)
            }? {
                Err(err) => return Ok(Err(err)),
                Ok(proces) => proces,
            };
            // Negative → kill() in the C++ signal forwarder targets the pgroup, so
            // a SIGTERM/SIGINT delivered to `bun run` reaches every descendant
            // that hasn't `setsid()`-escaped.
            Bun__currentSyncPID.store(
                if no_orphans {
                    -i64::from(process.pid)
                } else {
                    i64::from(process.pid)
                },
                core::sync::atomic::Ordering::Relaxed,
            );

            let mut jc = JobControl {
                prev: 0,
                script_pgid: 0,
            };
            let pgid_pushed = no_orphans && ParentDeathWatchdog::push_sync_pgid(process.pid);
            if no_orphans {
                // Script is now a background pgroup; if stdin is a TTY hand it the
                // foreground so Ctrl-C / TTY reads behave as before. Ctrl-Z is
                // bridged by `JobControl.onChildStopped` in the wait loop. No-op on
                // non-TTY stdin (the supervisor / CI case this feature targets).
                jc.give(process.pid);
                // `begin()` records the script's `p_uniqueid` as the scan root
                // and stashes kq so `scan()` can EV_ADD NOTE_FORK|NOTE_EXIT on
                // each discovered descendant. waitMacKqueue registers the
                // script's own knote.
                #[cfg(target_os = "macos")]
                if no_orphans_kq.fd() != Fd::INVALID {
                    Bun__noOrphans_begin(no_orphans_kq.fd().native(), process.pid);
                }
            }
            // Move `jc` into the guard so the defer closure owns it (avoids holding
            // a mutable borrow across the wait loop below); access via `&*_jc` deref.
            // `_`-prefixed: on freebsd the guard is held only for its `Drop`
            // (`restore()`); the binding is read only on linux/macos.
            let _jc = scopeguard::guard(jc, move |mut jc| {
                if no_orphans {
                    jc.restore();
                    // pgroup → tracked uniqueids (macOS). Do NOT call the
                    // getpid()-rooted `killDescendants()` here — `spawnSync` can be
                    // reached from inside a live VM (the FFI xcrun probe, etc.) and
                    // that would SIGKILL the user's unrelated `Bun.spawn` children.
                    // The full-tree walk runs from `onProcessExit` when the whole
                    // process is actually exiting.
                    ParentDeathWatchdog::kill_sync_script_tree();
                    if pgid_pushed {
                        ParentDeathWatchdog::pop_sync_pgid();
                    }
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        // One last reap for anything we adopted as subreaper before
                        // the disarm defer above drops it (LIFO: this runs first).
                        loop {
                            match posix_spawn::wait4(-1, libc::WNOHANG as u32, None) {
                                Err(_) => break,
                                Ok(w) => {
                                    if w.pid <= 0 {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            });
            Bun__sendPendingSignalIfNecessary();

            let mut out: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
            let mut out_fds: [Fd; 2] = [
                process.stdout.unwrap_or(Fd::INVALID),
                process.stderr.unwrap_or(Fd::INVALID),
            ];
            let mut success = false;
            // defer cleanup — handled at end / via guards below; error returns
            // run their cleanup manually

            let mut out_fds_to_wait_for: [Fd; 2] = [
                process.stdout.unwrap_or(Fd::INVALID),
                process.stderr.unwrap_or(Fd::INVALID),
            ];

            if process.memfds[1] {
                out_fds_to_wait_for[0] = Fd::INVALID;
            }
            if process.memfds[2] {
                out_fds_to_wait_for[1] = Fd::INVALID;
            }

            // no-orphans: replace the blind `poll()`/`wait4()` with a wait loop
            // that also watches our parent (and on macOS, the script's whole
            // spawn tree via the NOTE_FORK kq + p_puniqueid scan above).
            // Linux/macOS only — other POSIX (FreeBSD) falls through to the
            // original `poll()`+`wait4()` below so buffered stdio still drains;
            // the `defer` above still does the pgroup kill there.
            //
            // Do NOT return from here — Linux backs `.buffer` stdio with memfds
            // that are read *after* the wait, so falling through to the memfd block
            // below is required.
            let status: Status = 'blk: {
                if no_orphans
                    && (cfg!(any(target_os = "linux", target_os = "android"))
                        || cfg!(target_os = "macos"))
                {
                    let ppid = ParentDeathWatchdog::ppid_to_watch().unwrap_or(0);
                    #[cfg(target_os = "macos")]
                    let r: Option<Maybe<Status>> = wait_mac_kqueue(
                        process.pid,
                        ppid,
                        &*_jc,
                        no_orphans_kq.fd(),
                        &mut out,
                        &mut out_fds_to_wait_for,
                        &mut out_fds,
                    );
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    let r: Option<Maybe<Status>> = wait_linux_signalfd(
                        process.pid,
                        ppid,
                        no_orphans,
                        &*_jc,
                        &mut out,
                        &mut out_fds_to_wait_for,
                        &mut out_fds,
                    );
                    #[cfg(not(any(
                        target_os = "linux",
                        target_os = "android",
                        target_os = "macos"
                    )))]
                    let r: Option<Maybe<Status>> = {
                        let _ = ppid;
                        None
                    };
                    if let Some(maybe) = r {
                        match maybe {
                            Err(err) => {
                                cleanup_spawn_posix(&mut out, out_fds, &process, success);
                                return Ok(Err(err));
                            }
                            Ok(st) => break 'blk st,
                        }
                    }
                    // null: kqueue()/kevent-receipt failed — fall through to the
                    // plain poll() loop so `.buffer` stdio still drains instead
                    // of being dropped (or deadlocking) in a blind `wait4()`.
                }
                while out_fds_to_wait_for[0] != Fd::INVALID || out_fds_to_wait_for[1] != Fd::INVALID
                {
                    for i in 0..2 {
                        if let Some(err) =
                            drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i])
                        {
                            cleanup_spawn_posix(&mut out, out_fds, &process, success);
                            return Ok(Err(err));
                        }
                    }

                    let mut poll_fds_buf: [libc::pollfd; 2] =
                    // SAFETY: zeroed pollfd is valid
                    unsafe { bun_core::ffi::zeroed_unchecked() };
                    let mut poll_len: usize = 0;
                    for &fd in &out_fds_to_wait_for {
                        if fd == Fd::INVALID {
                            continue;
                        }
                        poll_fds_buf[poll_len] = libc::pollfd {
                            fd: fd.native(),
                            events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
                            revents: 0,
                        };
                        poll_len += 1;
                    }
                    if poll_len == 0 {
                        break;
                    }

                    // SAFETY: valid pollfd array
                    let rc = unsafe { libc::poll(poll_fds_buf.as_mut_ptr(), poll_len as _, -1) };
                    match bun_sys::get_errno(rc as isize) {
                        bun_sys::E::SUCCESS => {}
                        bun_sys::E::EAGAIN | bun_sys::E::EINTR => continue,
                        err => {
                            cleanup_spawn_posix(&mut out, out_fds, &process, success);
                            return Ok(Err(bun_sys::Error::from_code(err, bun_sys::Tag::poll)));
                        }
                    }
                }
                reap_child(process.pid)
            };

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                for (idx, &memfd) in process.memfds[1..].iter().enumerate() {
                    if memfd {
                        // `out_fds[idx]` is closed by `cleanup_spawn_posix` below;
                        // borrow a non-owning `File` view so the temporary doesn't
                        // close it on drop (which would double-close).
                        out[idx] = bun_sys::File::borrow(&out_fds[idx])
                            .read_to_end()
                            .unwrap_or_default();
                    }
                }
            }

            success = true;
            let stdout = core::mem::take(&mut out[0]);
            let stderr = core::mem::take(&mut out[1]);
            cleanup_spawn_posix(&mut out, out_fds, &process, success);
            Ok(Ok(Result {
                status,
                stdout,
                stderr,
            }))
        }

        #[cfg(unix)]
        fn cleanup_spawn_posix(
            out: &mut [Vec<u8>; 2],
            out_fds: [Fd; 2],
            process: &PosixSpawnResult,
            success: bool,
        ) {
            // If we're going to return an error,
            // let's make sure to clean up the output buffers
            // and kill the process
            if !success {
                for array_list in out.iter_mut() {
                    array_list.clear();
                    array_list.shrink_to_fit();
                }
                let _ = kill(process.pid, 1);
            }

            for fd in out_fds {
                if fd != Fd::INVALID {
                    fd.close();
                }
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if let Some(pidfd) = process.pidfd {
                Fd::from_native(pidfd).close();
            }
        }

        /// no-orphans wait loop for `spawnSync`. Replaces the blind `poll()` +
        /// blocking `wait4()` so that:
        ///   - we notice our parent dying and run cleanup before PDEATHSIG / never
        ///     (macOS) — `Global.exit(129)` → `kill(-pgid)` + deep walk
        ///   - macOS: `NOTE_FORK` on the script (and recursively on each
        ///     discovered descendant) triggers a `p_puniqueid` scan
        ///     (`NoOrphansTracker::scan()`) so `setsid()`+double-fork escapees
        ///     are tracked and killed via `Bun__noOrphans_killTracked()`.
        ///     `NOTE_TRACK` would have made this atomic, but it has been
        ///     ENOTSUP since macOS 10.5.
        ///   - Linux: subreaper (armed in `spawnPosix`) makes those reparent to us,
        ///     so the procfs walk finds them; this loop just needs to run
        ///     cleanup *before* our own SIGKILL-PDEATHSIG fires
        ///
        /// `ppid == 0` means "no parent worth watching" — still run the loop for
        /// the descendant tracking + pgroup cleanup on script exit.
        ///
        /// Returns `null` when kqueue setup fails: the caller falls through to
        /// the plain `poll()`+`wait4()` loop so `.buffer` stdio still drains (a
        /// blind `reapChild()` would drop captured output or deadlock if the
        /// child fills the pipe while we block in `wait4`).
        #[cfg(target_os = "macos")]
        fn wait_mac_kqueue(
            child: libc::pid_t,
            ppid: libc::pid_t,
            jc: &JobControl,
            kq_fd: Fd,
            out: &mut [Vec<u8>; 2],
            out_fds_to_wait_for: &mut [Fd; 2],
            out_fds: &mut [Fd; 2],
        ) -> Option<Maybe<Status>> {
            // kqueue() failed in spawnPosix (EMFILE/ENOMEM): let the caller's
            // plain `poll()` loop drain `.buffer` stdio and reap. The spawnPosix
            // defers (pgroup-kill, killTracked() — empty set) still run.
            if kq_fd == Fd::INVALID {
                return None;
            }

            // udata tag for the ppid PROC filter. Descendant PROC knotes
            // (`child` here, plus any `scan()` adds) use udata=0; EVFILT_READ
            // udata 0/1 are a separate filter, so the dispatch checks `filter`
            // before `udata`.
            const TAG_PPID: usize = 2;

            // SAFETY: zeroed kevent is valid
            let mut changes_buf: [libc::kevent; 5] = bun_core::ffi::zeroed();
            let mut changes_len: usize = 0;
            let add = |list: &mut [libc::kevent; 5],
                       len: &mut usize,
                       ident: usize,
                       filter: i16,
                       fflags: u32,
                       udata: usize| {
                list[*len] = libc::kevent {
                    ident,
                    filter,
                    flags: libc::EV_ADD | libc::EV_RECEIPT | libc::EV_CLEAR,
                    fflags,
                    data: 0,
                    udata: udata as *mut c_void,
                };
                *len += 1;
            };
            if ppid > 1 {
                add(
                    &mut changes_buf,
                    &mut changes_len,
                    usize::try_from(ppid).expect("int cast"),
                    libc::EVFILT_PROC,
                    libc::NOTE_EXIT,
                    TAG_PPID,
                );
            }
            // NOTE_FORK so the wait loop wakes to scan whenever the script (or
            // any registered descendant) forks. NOTE_TRACK would have let xnu
            // auto-attach to the new child atomically, but it returns ENOTSUP on
            // every macOS since 10.5 — which previously made *this* registration
            // fail, the receipt loop below `return null`, and the caller fall
            // through to a plain `wait4()` that watches neither ppid nor
            // descendants (the `runDied=false` failure on darwin in CI).
            add(
                &mut changes_buf,
                &mut changes_len,
                usize::try_from(child).expect("int cast"),
                libc::EVFILT_PROC,
                libc::NOTE_FORK | libc::NOTE_EXIT,
                0,
            );
            // TTY job-control: EVFILT_PROC has no "stopped" note, so wake on
            // SIGCHLD and `wait4(WUNTRACED|WNOHANG)` to catch Ctrl-Z. Only when
            // stdin is a TTY — non-TTY callers never see stops, matching plain
            // `bun run`. EVFILT_SIGNAL coexists with the (default-ignore) SIGCHLD
            // disposition; only direct children raise SIGCHLD, so this fires for
            // `child` alone.
            if jc.is_active() {
                add(
                    &mut changes_buf,
                    &mut changes_len,
                    libc::SIGCHLD as usize,
                    libc::EVFILT_SIGNAL,
                    0,
                    0,
                );
            }
            for (i, &fd) in out_fds_to_wait_for.iter().enumerate() {
                if fd != Fd::INVALID {
                    add(
                        &mut changes_buf,
                        &mut changes_len,
                        usize::try_from(fd.native()).expect("int cast"),
                        libc::EVFILT_READ,
                        0,
                        i,
                    );
                }
            }

            // SAFETY: zeroed kevent is valid
            let mut receipts: [libc::kevent; 5] = bun_core::ffi::zeroed();
            match bun_sys::kevent(
                kq_fd,
                &changes_buf[..changes_len],
                &mut receipts[..changes_len],
                None,
            ) {
                Err(err) => return Some(Err(err)),
                Ok(_) => {}
            }
            for r in &receipts[..changes_len] {
                if r.flags & libc::EV_ERROR == 0 || r.data == 0 {
                    continue;
                }
                if r.udata as usize == TAG_PPID {
                    // ESRCH: parent already gone — treat as fired. Any other
                    // errno (ENOMEM, sandbox EACCES via `mac_proc_check_kqfilter`)
                    // is a best-effort miss — same policy as
                    // `ParentDeathWatchdog.installOnEventLoop`. The
                    // `getppid() != ppid` recheck below is the backstop.
                    if r.data == libc::ESRCH as isize {
                        Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                    }
                    continue;
                }
                // Non-ppid registration (child PROC / EVFILT_SIGNAL / EVFILT_READ)
                // failed — fall through to the caller's `poll()` loop so
                // `.buffer` stdio still drains instead of a blind `reapChild()`
                // that would drop output or deadlock on a full pipe. ESRCH on the
                // child PROC entry is impossible (our own unreaped child —
                // `filt_procattach` finds zombies), so any errno here is a real
                // registration failure. `begin()` has already seeded m_tracked
                // with `child`; prune it so the caller's `reapChild()` doesn't
                // leave a freed pid for `killTracked()` to SIGSTOP.
                Bun__noOrphans_onExit(child);
                return None;
            }
            if ppid > 1 && getppid() != ppid {
                Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
            }
            // Initial scan: `child` may have forked between `posix_spawn`
            // returning (in spawnPosix) and the NOTE_FORK registration above
            // taking effect; that fork produced no event. `begin()` already
            // seeded `m_seen` with `child`'s uniqueid, so this picks them up.
            Bun__noOrphans_onFork();

            // SAFETY: zeroed kevent is valid
            let mut events: [libc::kevent; 16] = bun_core::ffi::zeroed();
            let mut child_exited = false;
            let mut child_status: Option<Status> = None;
            loop {
                let got = match bun_sys::kevent(kq_fd, &[], &mut events[..], None) {
                    Err(err) => return Some(Err(err)),
                    Ok(c) => c,
                };
                let mut saw_fork = false;
                for ev in &events[..got] {
                    if ev.filter == libc::EVFILT_PROC {
                        // ppid is the only PROC knote with udata != 0; descendant
                        // knotes (`child` above + any `scan()` added) use udata 0.
                        if ev.udata as usize == TAG_PPID {
                            if ev.fflags & libc::NOTE_EXIT != 0 {
                                Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                            }
                            continue;
                        }
                        // NOTE_FORK and NOTE_EXIT can share one event (forked and
                        // died between kevent calls) — handle both, no else.
                        if ev.fflags & libc::NOTE_FORK != 0 {
                            saw_fork = true;
                        }
                        if ev.fflags & libc::NOTE_EXIT != 0 {
                            // Drop from the live set (root included — `begin()`
                            // seeded it into `m_tracked`, and `reapChild()` is
                            // about to free its pid before `killTracked()` runs).
                            Bun__noOrphans_onExit(
                                libc::pid_t::try_from(ev.ident).expect("int cast"),
                            );
                            if ev.ident == usize::try_from(child).expect("int cast") {
                                child_exited = true;
                            }
                        }
                    } else if ev.filter == libc::EVFILT_SIGNAL {
                        // SIGCHLD: probe for a stop. May also observe the exit
                        // (racing NOTE_EXIT in this batch) — stash the status so
                        // `reapChild` below doesn't block on an already-reaped pid.
                        let r = posix_spawn::wait4(
                            child,
                            (libc::WNOHANG | libc::WUNTRACED) as u32,
                            None,
                        );
                        if let Ok(ref w) = r {
                            if w.pid == child {
                                if libc::WIFSTOPPED(w.status as i32) {
                                    jc.on_child_stopped();
                                } else {
                                    child_status = Status::from(child, &r);
                                    child_exited = true;
                                    // wait4 just freed `child`'s pid; if NOTE_EXIT for
                                    // it isn't in this batch we'd return with the root
                                    // still in m_tracked and `killTracked()` would
                                    // SIGSTOP a (potentially recycled) freed pid.
                                    // Idempotent with the NOTE_EXIT handler above.
                                    Bun__noOrphans_onExit(child);
                                }
                            }
                        }
                    } else if ev.filter == libc::EVFILT_READ {
                        let i: usize = ev.udata as usize;
                        if let Some(err) =
                            drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i])
                        {
                            return Some(Err(err));
                        }
                    }
                }
                // After the batch so a single scan covers every NOTE_FORK in it.
                // `scan()` walks `proc_listallpids` for any pid whose
                // `p_puniqueid` (immutable spawning-parent uniqueid) is in our
                // seen set, adds it to m_tracked, and EV_ADDs NOTE_FORK|NOTE_EXIT
                // on it (udata 0) so its own forks wake this loop. Race: a
                // fast-exit intermediate (fork+setsid+fork+exit) can die before
                // this scan records its uniqueid, leaving its child's
                // `p_puniqueid` unlinkable. NOTE_TRACK closed that atomically;
                // without it the freeze-then-rescan loop in `killTracked()` is
                // the best-effort backstop.
                if saw_fork {
                    Bun__noOrphans_onFork();
                }
                if child_exited {
                    // Intentionally don't wait for pipe EOF (unlike the `poll()`
                    // path): a grandchild holding the write end is exactly what
                    // no-orphans exists to kill, and the killTracked()/pgroup-kill
                    // defers can't run until we return. drainFd() loops to EAGAIN,
                    // so everything the script itself wrote is captured.
                    for i in 0..2 {
                        let _ = drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i]);
                    }
                    return Some(Ok(child_status.unwrap_or_else(|| reap_child(child))));
                }
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        fn wait_linux_signalfd(
            child: libc::pid_t,
            ppid: libc::pid_t,
            drain_orphans: bool,
            jc: &JobControl,
            out: &mut [Vec<u8>; 2],
            out_fds_to_wait_for: &mut [Fd; 2],
            out_fds: &mut [Fd; 2],
        ) -> Option<Maybe<Status>> {
            // Child-exit: signalfd(SIGCHLD). Works everywhere pidfd doesn't
            // (gVisor, ancient kernels). Subreaper means orphaned grandchildren
            // also reparent to us and fire SIGCHLD here — drain them with
            // waitpid(-1, WNOHANG) and only stop when *our* child is reaped.
            // signalfd takes the *kernel* sigset_t (1 word), sigprocmask the libc
            // one (16 words) — block via libc, build a separate kernel mask for
            // signalfd.
            // SAFETY: signal mask manipulation
            let (chld_fd, _restore_mask): (Fd, scopeguard::ScopeGuard<libc::sigset_t, _>) = unsafe {
                let mut libc_mask: libc::sigset_t = bun_core::ffi::zeroed();
                let mut old_mask: libc::sigset_t = bun_core::ffi::zeroed();
                libc::sigemptyset(&raw mut libc_mask);
                libc::sigemptyset(&raw mut old_mask);
                libc::sigaddset(&raw mut libc_mask, libc::SIGCHLD);
                libc::sigprocmask(libc::SIG_BLOCK, &raw const libc_mask, &raw mut old_mask);
                let restore = scopeguard::guard(old_mask, |old| {
                    libc::sigprocmask(libc::SIG_SETMASK, &raw const old, core::ptr::null_mut());
                });
                let fd = {
                    // SAFETY: POD, zero-valid — sigemptyset overwrites it immediately.
                    let mut kmask: libc::sigset_t = bun_core::ffi::zeroed();
                    libc::sigemptyset(&raw mut kmask);
                    libc::sigaddset(&raw mut kmask, libc::SIGCHLD);
                    let rc = libc::signalfd(
                        -1,
                        &raw const kmask,
                        libc::SFD_CLOEXEC | libc::SFD_NONBLOCK,
                    );
                    if rc >= 0 {
                        Fd::from_native(rc)
                    } else {
                        Fd::INVALID
                    }
                };
                (fd, restore)
            };
            // Shadow as RAII owner *after* `_restore_mask` so LIFO drop order is
            // preserved (close signalfd, then restore the signal mask).
            let chld_fd = AutoCloseFd::new(chld_fd);

            // Child-exit, take 2: pidfd. signalfd only fires if SIGCHLD stays
            // pending — i.e. is blocked on *every* thread. PackageManager / HTTP
            // client threads created before we got here don't block it, so the
            // kernel can hand the signal to one of them and the signalfd never
            // wakes. A pidfd becomes readable on child exit regardless of signal
            // masking, so poll it too. Keep the signalfd for the subreaper-adopted
            // orphans (whose pidfds we don't have) and as the gVisor / pre-5.3
            // fallback when pidfd_open is unavailable.
            let child_pidfd = match bun_sys::pidfd_open(child, 0) {
                Ok(fd) => AutoCloseFd::new(fd),
                Err(_) => AutoCloseFd::invalid(),
            };

            // Parent-death: pidfd when available (instant wake). When not
            // (gVisor, sandboxes, pre-5.3): bound the poll at 100ms and recheck
            // `getppid()`.
            let mut ppid_fd = AutoCloseFd::invalid();
            if ppid > 1 {
                match bun_sys::pidfd_open(ppid, 0) {
                    Ok(fd) => ppid_fd = AutoCloseFd::new(fd),
                    Err(e) => {
                        if e.get_errno() == bun_sys::E::ESRCH {
                            Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                        }
                    }
                }
            }
            // `enable()` armed `PDEATHSIG=SIGKILL` on us. The kernel queues
            // PDEATHSIG to children inside `exit_notify()` *before*
            // `do_notify_pidfd()` wakes pidfd pollers (both under tasklist_lock),
            // and SIGKILL is processed on syscall-return — so `poll()` would never
            // get back to userspace and the cleanup defer never runs. Clear it
            // now that we have a parent watch (pidfd or 100ms-getppid fallback);
            // restore on return so the next caller — or `bun run`'s own
            // post-script lifetime — keeps the backstop.
            if ppid > 1 {
                // SAFETY: prctl
                let _ = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, 0) };
            }
            scopeguard::defer! {
                if ppid > 1 {
                    // SAFETY: prctl
                    let _ = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) };
                }
            }
            if ppid > 1 && getppid() != ppid {
                Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
            }

            let need_ppid_fallback = ppid > 1 && ppid_fd.fd() == Fd::INVALID;
            // Only block forever when we have a wake source for *both* events we
            // care about. signalfd alone is not a reliable child-exit wake (see
            // the `child_pidfd` comment above), so require the pidfd for `-1`.
            let timeout_ms: i32 = if need_ppid_fallback || child_pidfd.fd() == Fd::INVALID {
                100
            } else {
                -1
            };

            let mut child_status: Option<Status> = None;
            loop {
                // Reap *before* poll(). Covers (a) the SIGCHLD-before-block race —
                // child may have exited between spawnProcessPosix and the
                // sigprocmask above, in which case the kernel discarded SIGCHLD
                // (default disposition is ignore) and signalfd will never wake;
                // (b) the no-signalfd fallback; (c) subreaper-adopted orphans that
                // would otherwise re-fire SIGCHLD forever.
                //
                // The `wait4(-1)` orphan drain is only valid when `drain_orphans`
                // (i.e. on the watchdog-arming thread, where subreaper is armed
                // and there is exactly one wait loop in the process). Off-thread
                // callers — install's threadpool `git` clones — run several wait
                // loops concurrently with no subreaper; a `wait4(-1)` there would
                // reap a sibling thread's `git` child, discard its status as an
                // "orphan", and leave that sibling busy-polling a permanently-
                // readable pidfd. Target `child` directly in that case.
                //
                // WUNTRACED only on a TTY: bridges Ctrl-Z via `JobControl`.
                // Non-TTY callers never see stops, matching plain `bun run`.
                let wopts: u32 =
                    (libc::WNOHANG | if jc.is_active() { libc::WUNTRACED } else { 0 }) as u32;
                let wait_target: libc::pid_t = if drain_orphans { -1 } else { child };
                loop {
                    let r = posix_spawn::wait4(wait_target, wopts, None);
                    let w = match &r {
                        Err(_) => break,
                        Ok(w) => *w,
                    };
                    if w.pid <= 0 {
                        break;
                    }
                    if w.pid != child {
                        continue; // subreaper-adopted orphan reaped
                    }
                    if libc::WIFSTOPPED(w.status as i32) {
                        jc.on_child_stopped();
                    } else {
                        child_status = Status::from(child, &r);
                    }
                }
                if child_status.is_some() {
                    break;
                }

                for i in 0..2 {
                    if let Some(err) =
                        drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i])
                    {
                        return Some(Err(err));
                    }
                }

                // SAFETY: zeroed pollfd is valid
                let mut buf: [libc::pollfd; 5] = bun_core::ffi::zeroed();
                let mut pfds_len: usize = 0;
                let push = |l: &mut [libc::pollfd; 5], len: &mut usize, fd: Fd| {
                    l[*len] = libc::pollfd {
                        fd: fd.native(),
                        events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
                        revents: 0,
                    };
                    *len += 1;
                };
                for &fd in out_fds_to_wait_for.iter() {
                    if fd != Fd::INVALID {
                        push(&mut buf, &mut pfds_len, fd);
                    }
                }
                let ppid_idx = pfds_len;
                if ppid_fd.fd() != Fd::INVALID {
                    push(&mut buf, &mut pfds_len, ppid_fd.fd());
                }
                let chld_idx = pfds_len;
                if chld_fd.fd() != Fd::INVALID {
                    push(&mut buf, &mut pfds_len, chld_fd.fd());
                }
                if child_pidfd.fd() != Fd::INVALID {
                    push(&mut buf, &mut pfds_len, child_pidfd.fd());
                }

                // SAFETY: valid pollfd array
                let rc = unsafe { libc::poll(buf.as_mut_ptr(), pfds_len as _, timeout_ms) };
                match bun_sys::get_errno(rc as isize) {
                    bun_sys::E::SUCCESS => {}
                    bun_sys::E::EAGAIN | bun_sys::E::EINTR => {}
                    err => return Some(Err(bun_sys::Error::from_code(err, bun_sys::Tag::poll))),
                }

                if (ppid_fd.fd() != Fd::INVALID && buf[ppid_idx].revents != 0)
                    || (need_ppid_fallback && getppid() != ppid)
                {
                    Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                }

                // Drain the signalfd so the next poll blocks; the actual reap
                // happens at the top of the next iteration.
                if chld_fd.fd() != Fd::INVALID && buf[chld_idx].revents != 0 {
                    // The siginfo payload is discarded — we only need a buffer of
                    // the right size to drain the fd, so a plain byte array avoids
                    // the unsafe struct-as-bytes reinterpret entirely.
                    let mut si_bytes = [0u8; core::mem::size_of::<libc::signalfd_siginfo>()];
                    while bun_sys::read(chld_fd.fd(), &mut si_bytes).unwrap_or(0) == si_bytes.len()
                    {
                    }
                }
            }
            for i in 0..2 {
                let _ = drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i]);
            }
            Some(Ok(child_status.unwrap()))
        }

        /// Non-blocking drain of `fd` into `bytes`. Closes and invalidates both
        /// slots on EOF so the caller's deferred cleanup skips them; returns null
        /// on EOF/retry/EPIPE (caller keeps polling) or the recv/OOM error
        /// otherwise. Shared by the `poll()` path and the no-orphans wait loops.
        #[cfg(unix)]
        fn drain_fd(fd: &mut Fd, out_fd: &mut Fd, bytes: &mut Vec<u8>) -> Option<bun_sys::Error> {
            if *fd == Fd::INVALID {
                return None;
            }
            loop {
                if bytes.try_reserve(16384).is_err() {
                    return Some(bun_sys::Error::from_code(
                        bun_sys::E::ENOMEM,
                        bun_sys::Tag::recv,
                    ));
                }
                // SAFETY: recvNonBlock writes into uninit bytes; we extend len by bytes_read.
                // Keep the fallible `try_reserve` above — do NOT use fill_spare here.
                let spare_slice = unsafe { bun_core::vec::spare_bytes_mut(bytes) };
                match bun_sys::recv_non_block(*fd, spare_slice) {
                    Err(err) => {
                        if err.is_retry() || err.get_errno() == bun_sys::E::EPIPE {
                            return None;
                        }
                        return Some(err);
                    }
                    Ok(bytes_read) => {
                        // SAFETY: recv wrote `bytes_read` bytes into spare capacity
                        unsafe { bun_core::vec::commit_spare(bytes, bytes_read) };
                        if bytes_read == 0 {
                            fd.close();
                            *fd = Fd::INVALID;
                            *out_fd = Fd::INVALID;
                            return None;
                        }
                    }
                }
            }
        }

        /// Blocking `wait4()` until `Status.from` returns a terminal status.
        /// Shared by the `poll()` path and the no-orphans wait loops.
        #[cfg(unix)]
        fn reap_child(child: libc::pid_t) -> Status {
            loop {
                if let Some(stat) = Status::from(child, &posix_spawn::wait4(child, 0, None)) {
                    return stat;
                }
            }
        }
    }
} // mod spawn_process_body

pub use spawn_process_body::spawn_process;
#[cfg(unix)]
pub use spawn_process_body::spawn_process_posix;
#[cfg(windows)]
pub use spawn_process_body::spawn_process_windows;

pub use spawn_process_body::sync;
