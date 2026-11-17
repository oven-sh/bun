#[cfg(windows)]
use core::cell::UnsafeCell;
use core::cell::{Cell, OnceCell};
#[cfg(windows)]
use core::ffi::c_char;
use core::ffi::c_int;
#[cfg(any(windows, target_os = "macos"))]
use core::ffi::c_void;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::sync::atomic::AtomicI32;
#[cfg(unix)]
use core::sync::atomic::AtomicU32;
use core::sync::atomic::Ordering;

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
use bun_core::Global;
use bun_core::{CStrList, CStrRef, CStringList, Output};
use bun_event_loop::EventLoopHandle;
#[cfg(unix)]
use bun_io::ParentDeathWatchdog;
#[cfg(unix)]
use bun_io::{FilePoll, KeepAlive, OwnedFilePoll};
#[cfg(unix)]
use bun_ptr::JsCell;
use bun_ptr::{RefPtr, ThisPtr};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, Maybe};
#[cfg(windows)]
use uv::{UvHandle as _, UvStream as _};

// posix_spawn(2) wrappers — owned by the `bun_spawn_sys` leaf crate.
#[cfg(unix)]
use bun_spawn_sys::posix_spawn::posix_spawn;
/// `posix_spawn::WaitPidResult` — re-exported from `bun_spawn_sys`. `status`
/// is `u32` there; `Status::from` casts before matching.
#[cfg(unix)]
pub use posix_spawn::WaitPidResult;

/// Low-level fd / memfd helpers historically grouped here as `spawn_sys`.
/// MOVE_DOWN: real impls now live in `bun_sys` (lower crate); re-export so
/// higher-tier callers (`bun_runtime::api::bun_spawn::stdio`, `Terminal`)
/// keep their `bun_spawn::process::spawn_sys::*` import path.
pub mod spawn_sys {
    // memfd is Linux; FD_CLOEXEC is POSIX (Win32 handles are non-inheritable unless asked).
    #[cfg(unix)]
    pub use bun_sys::set_close_on_exec;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub use bun_sys::{MemfdFlags, MemfdFlags as MemfdFlag, can_use_memfd, memfd_create};
}

bun_core::declare_scope!(PROCESS, visible);

// ─── Re-exports from `bun_spawn_sys` ─────────────────────────────────────────
// The raw OS spawn layer (option/result structs, `Rusage`, `spawn_process_posix`)
// moved into the leaf `bun_spawn_sys` crate so it has no event-loop dependency.
// Re-export here so existing `bun_spawn::process::*` paths keep resolving.
pub use bun_spawn_sys::spawn_process::rusage_zeroed;
#[cfg(windows)]
use bun_spawn_sys::uv_getrusage;
pub use bun_spawn_sys::{
    Dup2, ExtraPipe, PidT, PosixSpawnOptions, PosixSpawnResult, PosixStdio, Rusage, StdioKind,
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
fn call_exit_handler(h: ProcessExitHandler, status: Status, rusage: &Rusage) {
    let Some(h) = h else { return };
    if h.owner().is_null() {
        return;
    }
    h.on_process_exit(status, rusage);
}

/// Shared borrows only. What may free the process, or hands out its address, takes a `ThisPtr`.
// bun.ptr.ThreadSafeRefCount → intrusive (FFI-crossing: *mut Process recovered
// via `container_of` in on_exit_uv / on_close_uv). Per PORTING.md §Pointers,
// keep the embedded count; the derive emits `ThreadSafeRefCounted` +
// `AnyRefCounted`. Default `destructor` (`heap::take`) applies.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct Process {
    pub pid: PidT,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pidfd: JsCell<Option<bun_sys::File>>,
    /// Empty while it runs.
    status: OnceCell<Status>,
    #[cfg(unix)]
    poller: JsCell<Poller>,
    /// libuv keeps its address, and its `data` points back here.
    #[cfg(windows)]
    handle: UnsafeCell<uv::uv_process_t>,
    #[cfg(windows)]
    handle_has_closed: Cell<bool>,
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<Process>,
    exit_handler: Cell<ProcessExitHandler>,
    #[cfg(unix)]
    event_loop: EventLoopHandle,
    /// How the waiter thread delivers this process's exit to a JS VM
    /// (`None` when owned by a mini event loop, which it posts to directly).
    #[cfg(unix)]
    pub(crate) js_poster: Option<bun_event_loop::JsPoster>,
}

impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(unix)]
        self.detach_poller();
        #[cfg(windows)]
        debug_assert!(self.with_handle(|p| p.is_closed()).unwrap_or(true));
    }
}

/// The exit-handler owner's handle on a [`Process`]: one owned ref, and
/// dropping it detaches the handler before releasing that ref. The owner must
/// stay live until the handle is dropped or the exit has been dispatched —
/// keeping the handle in one of the owner's fields satisfies that.
///
/// The exit handler may drop the handle.
pub struct ProcessHandle(RefPtr<Process>);

impl core::ops::Deref for ProcessHandle {
    type Target = Process;
    #[inline]
    fn deref(&self) -> &Process {
        &self.0
    }
}

impl ProcessHandle {
    /// Dispatch this process's exit to `owner` (see the type-level contract).
    pub fn set_exit_handler<T: crate::ProcessExitOwner>(&self, owner: bun_ptr::ThisPtr<T>) {
        // SAFETY: `owner` is live now (`ThisPtr` invariant) and, per the
        // type-level contract, for every dispatch.
        let h = unsafe { ProcessExit::of(owner.as_ptr()) };
        self.0.set_exit_handler(h);
    }

    pub fn watch(&self) -> bun_sys::Result<()> {
        Process::watch(self.this_ptr())
    }

    /// See [`Process::watch_or_reap`]; may synchronously run the exit handler,
    /// so call this on a handle the handler does not re-borrow (a local, not
    /// the owner's slot).
    pub fn watch_or_reap(&self) -> bun_sys::Result<bool> {
        Process::watch_or_reap(self.this_ptr())
    }

    /// See [`Process::on_exit`]; runs the exit handler (same rule as
    /// [`watch_or_reap`](Self::watch_or_reap)).
    pub fn on_exit(&self, status: Status, rusage: &Rusage) {
        Process::on_exit(self.this_ptr(), status, rusage)
    }

    /// For a call that may run an exit handler which drops or overwrites this handle.
    pub fn this_ptr(&self) -> ThisPtr<Process> {
        self.0.this_ptr()
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        self.detach();
    }
}

impl Process {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    pub fn set_exit_handler(&self, h: ProcessExit) {
        self.exit_handler.set(Some(h));
    }

    pub fn set_exit_handler_default(&self) {
        self.exit_handler.set(None);
    }

    /// `None` while it runs.
    pub fn status(&self) -> Option<&Status> {
        self.status.get()
    }

    pub fn has_exited(&self) -> bool {
        self.status.get().is_some()
    }

    pub fn has_killed(&self) -> bool {
        matches!(self.status(), Some(Status::Exited(_) | Status::Signaled(_)))
    }

    /// Takes the ref that the callback of a closing handle adopts.
    #[cfg(windows)]
    #[inline]
    fn ref_(&self) {
        let this = core::ptr::from_ref(self).cast_mut();
        // SAFETY: `self` is a live Process, and only its atomic count is written.
        unsafe { bun_ptr::ThreadSafeRefCount::<Process>::ref_(this) };
    }

    /// Bridge `self.event_loop` (`EventLoopHandle`) to `bun_io::EventLoopCtx`
    /// for FilePoll/KeepAlive calls; reconstitutes the aio-level ctx here.
    #[cfg(unix)]
    #[inline]
    fn event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        event_loop_handle_to_ctx(self.event_loop)
    }
}

#[inline]
pub fn event_loop_handle_to_ctx(handle: EventLoopHandle) -> bun_io::EventLoopCtx {
    handle.as_event_loop_ctx()
}

// ─── posix_spawn / FilePoll / uv-backed Process methods ──────────────────────
impl Process {
    // has_exited / has_killed live in the always-on impl above.

    /// May free `this`.
    pub fn on_exit(this: ThisPtr<Self>, status: Status, rusage: &Rusage) {
        debug_assert!(!matches!(status, Status::Running));
        let exit_handler = this.exit_handler.get();
        let _ = this.status.set(status.clone());
        this.detach();
        call_exit_handler(exit_handler, status, rusage);
    }

    /// May free `this`. Returns whether it has exited.
    #[cfg(unix)]
    fn wait_posix(this: ThisPtr<Self>, sync_: bool) -> bool {
        let mut rusage = rusage_zeroed();
        let waitpid_result = posix_spawn::wait4(
            this.pid,
            if sync_ { 0 } else { libc::WNOHANG as u32 },
            Some(&mut rusage),
        );
        Self::on_wait_pid(this, &waitpid_result, &rusage)
    }

    /// May free `this`.
    pub fn wait(this: ThisPtr<Self>, sync_: bool) {
        #[cfg(unix)]
        Self::wait_posix(this, sync_);
        #[cfg(windows)]
        let _ = (this, sync_);
    }

    /// May free `this`. Returns whether it has exited.
    #[cfg(unix)]
    fn on_wait_pid(
        this: ThisPtr<Self>,
        waitpid_result: &bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) -> bool {
        // `kill_and_reap` leaves the reaping to a thread on macOS, and its caller has reported the exit by now.
        if this.has_exited() {
            return true;
        }
        let pid = this.pid;
        let mut rusage_result = *rusage;

        let status: Option<Status> = Status::from(pid, waitpid_result).or_else(|| 'brk: {
            match Self::rewatch_posix(this) {
                Ok(()) => {}
                Err(err_) => {
                    #[cfg(target_os = "macos")]
                    if err_.get_errno() == bun_sys::E::ESRCH {
                        // ESRCH with nothing to reap: the child has started to exit (`proc_find` fails from then on)
                        // but isn't a zombie yet. That can last: see `reap_on_thread`.
                        if Self::reap_on_thread(this).is_ok() {
                            break 'brk None;
                        }
                        // No thread could start. Try once more, then report the error rather than block the loop.
                        let retry =
                            posix_spawn::wait4(pid, libc::WNOHANG as u32, Some(&mut rusage_result));
                        break 'brk Status::from(pid, &retry).or(Some(Status::Err(err_)));
                    }
                    break 'brk Some(
                        Self::kill_and_reap(this, &mut rusage_result).unwrap_or(Status::Err(err_)),
                    );
                }
            }
            None
        });

        let Some(status) = status else { return false };
        Self::on_exit(this, status, &rusage_result);
        true
    }

    /// Waits for a child that is exiting on a thread of its own, and delivers the result to this loop.
    ///
    /// A blocking `wait4` here can deadlock. The session leader of a pty drains its controlling terminal while it
    /// exits (`ttywait` in xnu's `proc_exit`), before it can be reaped, and this loop is what reads the pty's master.
    #[cfg(target_os = "macos")]
    fn reap_on_thread(this: ThisPtr<Self>) -> Result<(), std::io::Error> {
        if this.is_on_waiter_thread() {
            return Ok(());
        }
        this.leave_to_waiter_thread();
        waiter_thread_posix::reap_on_thread(RefPtr::from_this(this))
            .inspect_err(|_| this.detach_poller())
    }

    /// May free `this`, if it returns `Ok(true)`.
    pub fn watch_or_reap(this: ThisPtr<Self>) -> bun_sys::Result<bool> {
        if let Some(status) = this.status() {
            let zeroed = rusage_zeroed();
            Self::on_exit(this, status.clone(), &zeroed);
            return Ok(true);
        }

        match Self::watch(this) {
            Err(err) => {
                #[cfg(unix)]
                {
                    if err.get_errno() == bun_sys::E::ESRCH {
                        // Not blocking on macOS, so a child that is still exiting goes to `reap_on_thread`.
                        return Ok(Self::wait_posix(this, cfg!(not(target_os = "macos"))));
                    }
                    let mut rusage = rusage_zeroed();
                    if let Some(status) = Self::kill_and_reap(this, &mut rusage) {
                        Self::on_exit(this, status, &rusage);
                        return Ok(true);
                    }
                    // The pid may be another process's from here on, and `kill` leaves alone what is not watched.
                    this.close();
                }
                Err(err)
            }
            Ok(()) => Ok(false),
        }
    }

    pub fn watch(this: ThisPtr<Self>) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            this.with_handle(|p| p.ref_());
            return Ok(());
        }

        #[cfg(unix)]
        {
            if WaiterThread::should_use_waiter_thread() {
                WaiterThread::start()?;
                this.leave_to_waiter_thread();
                WaiterThread::append(RefPtr::from_this(this));
                return Ok(());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            let Some(watchfd) = this.pidfd.get().as_ref().map(|file| file.fd().native()) else {
                debug_assert!(this.has_exited());
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ESRCH,
                    bun_sys::Tag::pidfd_open,
                ));
            };
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let watchfd = this.pid;

            let poll = match this.poller.replace(Poller::Detached) {
                Poller::Fd(poll) => poll,
                Poller::WaiterThread(_) | Poller::Detached => {
                    let owner = bun_io::Owner::new(bun_io::PollTag::Process, this.as_ptr().cast());
                    let ctx = this.event_loop_ctx();
                    // SAFETY: the poll becomes a field of its owner.
                    unsafe { OwnedFilePoll::new(ctx, Fd::from_native(watchfd), owner) }
                }
            };

            poll.enable_keeping_process_alive();
            let registered = poll
                .register(bun_io::PollKind::Process, PROCESS_POLL_ONE_SHOT)
                .inspect_err(|_| poll.disable_keeping_process_alive());
            this.poller.set(Poller::Fd(poll));
            registered
        }
    }

    #[cfg(unix)]
    fn rewatch_posix(this: ThisPtr<Self>) -> bun_sys::Result<()> {
        if WaiterThread::should_use_waiter_thread() {
            WaiterThread::start()?;
            this.leave_to_waiter_thread();
            WaiterThread::append(RefPtr::from_this(this));
            return Ok(());
        }
        // A `reap_on_thread` thread is waiting for this pid already, and its result will arrive.
        #[cfg(target_os = "macos")]
        if this.is_on_waiter_thread() {
            return Ok(());
        }

        this.with_poll(|fd| fd.register(bun_io::PollKind::Process, PROCESS_POLL_ONE_SHOT))
        .expect(
            "Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.",
        )
    }

    #[cfg(windows)]
    extern "C" fn on_exit_uv(process: *mut uv::uv_process_t, exit_status: i64, term_signal: c_int) {
        // SAFETY: libuv passes the live handle; only reads its POD fields.
        let rusage = uv_getrusage(unsafe { &mut *process });
        // SAFETY: raw read of POD `pid` field on the live handle.
        let _pid = unsafe { (*process).pid };
        // SAFETY: `data` was set to the owning `*mut Process` before
        // `uv_spawn`; libuv never overwrites it.
        let this = unsafe { ThisPtr::new((*process).data.cast::<Process>()) };
        let exit_code: u8 = if exit_status >= 0 {
            (exit_status as u64) as u8
        } else {
            0
        };
        let signal_code: Option<u8> = u8::try_from(term_signal).ok().filter(|&signal| signal != 0);

        bun_sys::windows::libuv::log!(
            "Process.onExit({}) code: {}, signal: {:?}",
            _pid,
            exit_code,
            signal_code
        );

        if let Some(sig) = signal_code {
            this.close();
            Self::on_exit(this, Status::Signaled(sig), &rusage);
        } else if exit_status >= 0 {
            // The check is on the signed libuv `exit_status`, so a negative
            // `-UV_E*` reaches the Err arm.
            this.close();
            Self::on_exit(
                this,
                Status::Exited(Exited {
                    code: exit_code,
                    signal: 0,
                    raw: exit_status as u32,
                }),
                &rusage,
            );
        } else {
            Self::on_exit(
                this,
                Status::Err(bun_sys::Error::from_code(
                    bun_sys::windows::translate_uv_error_to_e(exit_status as c_int),
                    bun_sys::Tag::waitpid,
                )),
                &rusage,
            );
        }
    }

    #[cfg(windows)]
    extern "C" fn on_close_uv(uv_handle: *mut uv::uv_process_t) {
        // SAFETY: libuv passes the live handle.
        let _pid = unsafe { (*uv_handle).pid };
        // SAFETY: adopts the ref that `close` took, through the back-pointer stashed at spawn.
        let this = unsafe { RefPtr::from_raw((*uv_handle).data.cast::<Process>()) };
        bun_sys::windows::libuv::log!("Process.onClose({})", _pid);
        this.handle_has_closed.set(true);
    }

    pub fn close(&self) {
        #[cfg(unix)]
        self.detach_poller();
        #[cfg(windows)]
        self.with_handle(|process| {
            if process.is_closed() {
                self.handle_has_closed.set(true);
            } else if !process.is_closing() {
                self.ref_();
                process.close(Self::on_close_uv);
            }
        });

        #[cfg(any(target_os = "linux", target_os = "android"))]
        self.pidfd.set(None);
    }

    pub fn disable_keeping_event_loop_alive(&self) {
        #[cfg(unix)]
        {
            match self.poller.get() {
                Poller::Fd(poll) => poll.disable_keeping_process_alive(),
                Poller::WaiterThread(keep_alive) => keep_alive.unref(self.event_loop_ctx()),
                Poller::Detached => {}
            }
        }
        // `us_loop_pump` runs `uv_run` without active handles too, so `on_exit_uv` still fires.
        #[cfg(windows)]
        self.with_handle(|p| p.unref());
    }

    pub fn enable_keeping_event_loop_alive(&self) {
        if self.has_exited() {
            return;
        }
        #[cfg(unix)]
        {
            match self.poller.get() {
                Poller::Fd(poll) => poll.enable_keeping_process_alive(),
                Poller::WaiterThread(keep_alive) => keep_alive.ref_(self.event_loop_ctx()),
                Poller::Detached => {}
            }
        }
        #[cfg(windows)]
        self.with_handle(|p| p.ref_());
    }

    pub fn detach(&self) {
        self.close();
        self.exit_handler.set(None);
    }

    #[cfg(unix)]
    fn send_signal(&self, signal: u8) -> Maybe<()> {
        let err = bun_spawn_sys::ffi::kill(self.pid, signal as c_int);
        if err != 0 {
            let errno_ = bun_sys::get_errno(err as isize);
            // if the process was already killed don't throw
            if errno_ != bun_sys::E::ESRCH {
                return Err(bun_sys::Error::from_code(errno_, bun_sys::Tag::kill));
            }
        }
        Ok(())
    }

    /// For a child whose exit nothing is going to report: left alone it would keep running, and never be reaped.
    /// Watched or not, unlike [`Self::kill`]. A child that cannot be signalled (it runs as another user by now)
    /// is left alone after all, since the wait would last until it exits by itself.
    ///
    /// The status, with `rusage`, is that of a child which turns out to have ended by itself. It is for the caller
    /// to report, or else the error that brought it here.
    #[cfg(unix)]
    #[cold]
    #[inline(never)]
    pub fn kill_and_reap(this: ThisPtr<Self>, rusage: &mut Rusage) -> Option<Status> {
        // Reaped already, so the pid may be another process's by now.
        if this.has_exited() {
            return None;
        }
        this.send_signal(libc::SIGKILL as u8).ok()?;
        // Blocking here has the deadlock of `reap_on_thread` too: a killed child drains its terminal like any other.
        #[cfg(target_os = "macos")]
        let Some(status) = Status::from(
            this.pid,
            &posix_spawn::wait4(this.pid, libc::WNOHANG as u32, Some(rusage)),
        ) else {
            let _ = Self::reap_on_thread(this);
            return None;
        };
        #[cfg(not(target_os = "macos"))]
        let status = Status::from(this.pid, &posix_spawn::wait4(this.pid, 0, Some(rusage)))?;
        match status {
            Status::Signaled(signal) if signal == libc::SIGKILL as u8 => None,
            status @ (Status::Exited(_) | Status::Signaled(_)) => Some(status),
            Status::Running | Status::Err(_) => None,
        }
    }

    pub fn kill(&self, signal: u8) -> Maybe<()> {
        #[cfg(unix)]
        {
            // Detached is a deliberate no-op: spawnSync's `read_all()` runs
            // before `watch_or_reap()` installs the poller; the first
            // `recv_non_block_buf` returns EAGAIN (yes hasn't written yet) so the
            // maxBuffer overflow fires from the event-loop poll
            // tick *after* the Fd poller is armed. Do not widen this match to
            // mask spawn-maxbuf.test.ts — the async-path hang there has a
            // different root cause (poller is already Fd when `on_max_buffer`
            // fires, so this arm is unreachable on that path).
            if !matches!(self.poller.get(), Poller::Detached) {
                return self.send_signal(signal);
            }
        }
        #[cfg(windows)]
        {
            let rc = self.with_handle(|p| p.kill(c_int::from(signal)));
            if let Some(err) = rc.and_then(|rc| rc.to_error(bun_sys::Tag::kill)) {
                // if the process was already killed don't throw
                if err.errno != bun_sys::E::ESRCH as u16 {
                    return Err(err);
                }
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
    /// The platform's number (`WTERMSIG`), any `u8`; see `Status::signal` / `Status::signal_code`.
    Signaled(u8),
    Err(bun_sys::Error),
}

#[derive(Clone, Copy, Default)]
pub struct Exited {
    pub code: u8,
    /// The platform's signal number, or `0` for none; see `Status::signal`.
    pub signal: u8,
    /// Untruncated `GetExitCodeProcess` DWORD; `code` is its low byte.
    /// NTSTATUS crash codes only survive here (0xC0000409 → `code` 9).
    #[cfg(windows)]
    pub raw: u32,
}

impl Status {
    pub fn is_ok(&self) -> bool {
        matches!(self, Status::Exited(e) if e.code == 0)
    }

    #[cfg(unix)]
    pub(crate) fn from(pid: PidT, waitpid_result: &Maybe<WaitPidResult>) -> Option<Status> {
        let mut exit_code: Option<u8> = None;
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
                    exit_code = Some(libc::WEXITSTATUS(status) as u8);
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
            return Some(Status::Signaled(sig));
        }

        None
    }

    /// The terminating (or stopping) signal as the platform numbers it: re-raise it or add 128.
    pub fn signal(&self) -> Option<bun_sys::SignalCode> {
        let raw = match self {
            Status::Signaled(sig) => *sig,
            Status::Exited(exit) if exit.signal != 0 => exit.signal,
            _ => return None,
        };
        Some(bun_sys::SignalCode(raw))
    }

    /// `signal()` as a named signal, to name or classify it; `None` also when the platform names none.
    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        self.signal()?.named()
    }
}

impl core::fmt::Display for Status {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if let Some(code) = self.signal().map(bun_sys::SignalCode::to_exit_code) {
            return write!(writer, "code: {}", code);
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
enum Poller {
    Fd(OwnedFilePoll),
    /// Waited for off the loop: by the shared waiter thread (Linux without pidfd) or by a `reap_on_thread` thread (macOS).
    WaiterThread(KeepAlive),
    Detached,
}

#[cfg(unix)]
impl Process {
    fn detach_poller(&self) {
        if let Poller::WaiterThread(keep_alive) = self.poller.replace(Poller::Detached) {
            // Only here: a `Process` dropped on another thread is detached, and must not reach for its loop.
            keep_alive.unref(self.event_loop_ctx());
        }
    }

    fn leave_to_waiter_thread(&self) {
        self.detach_poller();
        let keep_alive = KeepAlive::default();
        keep_alive.ref_(self.event_loop_ctx());
        self.poller.set(Poller::WaiterThread(keep_alive));
    }

    fn is_on_waiter_thread(&self) -> bool {
        matches!(self.poller.get(), Poller::WaiterThread(_))
    }

    /// Runs `f` on the poll, if there is one.
    #[inline]
    fn with_poll<R>(&self, f: impl FnOnce(&FilePoll) -> R) -> Option<R> {
        match self.poller.get() {
            Poller::Fd(poll) => Some(f(poll)),
            Poller::WaiterThread(_) | Poller::Detached => None,
        }
    }
}

#[cfg(windows)]
impl Process {
    /// Runs `f` on the handle, unless it has closed.
    #[inline]
    fn with_handle<R>(&self, f: impl FnOnce(&mut uv::uv_process_t) -> R) -> Option<R> {
        // SAFETY: no `f` in this file runs the loop or gets back here. Off this thread libuv writes
        // only `exit_cb_pending`, which Rust does not read.
        (!self.handle_has_closed.get()).then(|| f(unsafe { &mut *self.handle.get() }))
    }

    /// `None` once the handle has closed.
    pub fn rusage(&self) -> Option<Rusage> {
        self.with_handle(uv_getrusage)
    }

    /// `None` once the handle has closed.
    pub fn os_handle(&self) -> Option<bun_sys::windows::HANDLE> {
        self.with_handle(|p| p.process_handle)
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
    use bun_event_loop::ConcurrentTask::TaskTag;
    use bun_event_loop::task_tag;
    use bun_threading::UnboundedQueue;

    pub struct WaiterThreadPosix {
        pub(crate) started: AtomicU32,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) eventfd: AtomicI32,
        pub(crate) js_process: ProcessQueue,
    }

    type ProcessQueue = NewQueue<Process>;

    pub struct NewQueue<T: ProcessLike> {
        pub(crate) queue: ConcurrentQueue<T>,
        /// Entries in `queue` plus the waiter thread's `active`. Decremented only after the entry's exit is posted.
        pub(crate) watched: AtomicU32,
    }

    impl<T: ProcessLike> NewQueue<T> {
        pub(crate) const fn new() -> Self {
            Self {
                queue: ConcurrentQueue::new(),
                watched: AtomicU32::new(0),
            }
        }
    }

    /// Intrusive node pushed onto `ConcurrentQueue` from the JS thread and
    /// drained on the waiter thread.
    pub struct TaskQueueEntry<T: ProcessLike> {
        pub(crate) process: RefPtr<T>,
        pub(crate) next: bun_threading::Link<TaskQueueEntry<T>>,
    }

    // SAFETY: `next` is the sole intrusive link for `UnboundedQueue<TaskQueueEntry<T>>`.
    unsafe impl<T: ProcessLike> bun_threading::Linked for TaskQueueEntry<T> {
        #[inline]
        unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
            // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
            unsafe { core::ptr::addr_of!((*item).next) }
        }
    }

    pub type ConcurrentQueue<T> = UnboundedQueue<TaskQueueEntry<T>>;

    /// Posted to the JS event loop from the waiter thread when a `wait4()`
    /// resolves. Maps to `task_tag::ProcessWaiterThreadTask` in `jsc::Task`.
    pub struct ResultTask<T: ProcessLike> {
        pub(crate) result: bun_sys::Result<WaitPidResult>,
        pub(crate) subprocess: RefPtr<T>,
        pub(crate) rusage: Rusage,
    }

    impl<T: ProcessLike> bun_event_loop::BoxedTask for ResultTask<T> {
        const TAG: TaskTag = T::TASK_TAG;
        /// An exit status the waiter thread posted whose delivery will not run:
        /// drop it and the strong ref it carried for the JS thread.
        fn release_unrun(self: Box<Self>) {}
        /// A child's exit is delivered to its `Process` whatever became of the script that spawned it
        /// (the child is reaped); what reaches script is the exit handler's to decide.
        fn context(&self) -> bun_event_loop::ContextId {
            bun_event_loop::ContextId::NONE
        }
    }

    impl<T: ProcessLike> ResultTask<T> {
        pub fn run_from_js_thread(self) {
            self.run_from_main_thread();
        }

        pub(crate) fn run_from_main_thread(self) {
            T::on_wait_pid_from_waiter_thread(self.subprocess, &self.result, &self.rusage);
        }
    }

    /// Posted to `MiniEventLoop` from the waiter thread. Self-referential via
    /// the embedded intrusive `task: AnyTaskWithExtraContext` (`.ctx == self`).
    #[repr(C)]
    pub(crate) struct ResultTaskMini<T: ProcessLike> {
        pub(crate) result: bun_sys::Result<WaitPidResult>,
        pub(crate) subprocess: RefPtr<T>,
        pub(crate) task: AnyTaskWithExtraContext,
    }

    impl<T: ProcessLike> ResultTaskMini<T> {
        #[inline]
        pub(crate) fn new(v: ResultTaskMini<T>) -> *mut ResultTaskMini<T> {
            bun_core::heap::into_raw(Box::new(v))
        }

        pub(crate) fn run_from_main_thread(self) {
            T::on_wait_pid_from_waiter_thread(self.subprocess, &self.result, &rusage_zeroed());
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
    pub trait ProcessLike: bun_ptr::AnyRefCounted + 'static {
        /// `jsc::Task` tag for this `T`'s `ResultTask`; callers supply it.
        const TASK_TAG: TaskTag;
        fn pid(&self) -> PidT;
        fn event_loop(&self) -> EventLoopHandle;
        /// The poster for a JS-owned process (see `Process::js_poster`).
        fn js_poster(&self) -> Option<&bun_event_loop::JsPoster>;
        fn on_wait_pid_from_waiter_thread(
            this: RefPtr<Self>,
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
        fn js_poster(&self) -> Option<&bun_event_loop::JsPoster> {
            self.js_poster.as_ref()
        }
        fn on_wait_pid_from_waiter_thread(
            this: RefPtr<Self>,
            result: &bun_sys::Result<WaitPidResult>,
            rusage: &Rusage,
        ) {
            if this.is_on_waiter_thread() {
                this.detach_poller();
            }
            Process::on_wait_pid(this.this_ptr(), result, rusage);
        }
    }

    impl<T: ProcessLike> NewQueue<T> {
        pub(crate) fn append(&self, process: RefPtr<T>) {
            self.watched.fetch_add(1, Ordering::SeqCst);
            self.queue.push(bun_core::heap::alloc_nn(TaskQueueEntry {
                process,
                next: bun_threading::Link::new(),
            }));
        }

        /// `active` is the waiter thread's list of the processes it has taken off the queue and not reaped yet.
        fn loop_(&self, active: &mut Vec<RefPtr<T>>) {
            {
                let batch = self.queue.pop_batch();
                active.reserve(batch.count);
                let mut iter = batch.iterator();
                loop {
                    let task = iter.next();
                    if task.is_null() {
                        break;
                    }
                    // SAFETY: task was heap-allocated in append(). Its process crosses threads here: this one
                    // reads what never changes, and drops a ref only if there is no loop to post to.
                    let task = unsafe { bun_core::heap::take(task) };
                    active.push(task.process);
                }
            }

            let mut i: usize = 0;
            while i < active.len() {
                let pid = active[i].pid();
                // this case shouldn't really happen
                if pid == 0 {
                    // Leaked: the process may be attached to a loop that this thread cannot touch.
                    let _ = active.remove(i).into_raw();
                } else {
                    let mut rusage = rusage_zeroed();
                    let result = posix_spawn::wait4(pid, libc::WNOHANG as u32, Some(&mut rusage));
                    if matches!(&result, Ok(r) if r.pid != pid) {
                        i += 1;
                        continue;
                    }
                    post_wait_result(active.remove(i), result, &rusage);
                }
                self.watched.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }

    /// Posts a `wait4` result to the loop that owns `process`, which runs `T::on_wait_pid_from_waiter_thread` there.
    fn post_wait_result<T: ProcessLike>(
        process: RefPtr<T>,
        result: bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) {
        match process.event_loop() {
            EventLoopHandle::Js { .. } => {
                // Its own: the JS thread may free the process before `post` has returned.
                let poster = (process.js_poster().cloned()).expect("JS-owned process has a poster");
                poster.post_boxed(Box::new(ResultTask {
                    result,
                    subprocess: process,
                    rusage: *rusage,
                }));
            }
            EventLoopHandle::Mini(mini) => {
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
                    mini.enqueue_task_concurrent(core::ptr::NonNull::new_unchecked(
                        core::ptr::addr_of_mut!((*out).task),
                    ));
                }
                // `out` is now owned by the mini queue; freed in `run_from_main_thread_mini`.
            }
        }
    }

    /// The ref that [`reap_on_thread`] moves to its thread.
    #[cfg(target_os = "macos")]
    struct SendPtr(RefPtr<Process>);
    // SAFETY: the pointee is refcounted (`ThreadSafeRefCount`) and the thread touches it only through
    // `post_wait_result`, as the shared waiter thread does with the pointers in its queue.
    #[cfg(target_os = "macos")]
    unsafe impl Send for SendPtr {}

    #[cfg(target_os = "macos")]
    impl SendPtr {
        /// By value, so that a closure captures the `Send` wrapper and not its field.
        fn get(self) -> RefPtr<Process> {
            self.0
        }
    }

    /// Blocks in `wait4(pid, 0)` on a detached thread and posts the result to the owning loop.
    #[cfg(target_os = "macos")]
    pub(crate) fn reap_on_thread(process: RefPtr<Process>) -> Result<(), std::io::Error> {
        let pid = process.pid;
        let process = SendPtr(process);
        let thread = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn(move || {
                Output::Source::configure_named_thread_no_js(bun_core::zstr!("Waitpid"));
                let mut rusage = rusage_zeroed();
                let result = posix_spawn::wait4(pid, 0, Some(&mut rusage));
                post_wait_result(process.get(), result, &rusage);
            })?;
        drop(thread); // detach
        Ok(())
    }

    const STACK_SIZE: usize = 512 * 1024;

    static INSTANCE: WaiterThreadPosix = WaiterThreadPosix {
        started: AtomicU32::new(0),
        #[cfg(any(target_os = "linux", target_os = "android"))]
        eventfd: AtomicI32::new(Fd::INVALID.native()),
        js_process: ProcessQueue::new(),
    };

    impl WaiterThreadPosix {
        #[inline]
        pub fn set_should_use_waiter_thread() {
            bun_spawn_sys::waiter_thread_flag::set();
        }

        #[inline]
        pub(crate) fn should_use_waiter_thread() -> bool {
            bun_spawn_sys::waiter_thread_flag::get()
        }

        /// True while any thread's child has an exit still to post. After `false`, the caller must still check its task queue.
        pub fn is_watching() -> bool {
            INSTANCE.js_process.watched.load(Ordering::SeqCst) > 0
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        fn eventfd(&self) -> Fd {
            Fd::from_native(self.eventfd.load(Ordering::Relaxed))
        }

        /// Starts the thread on first use. If that fails, the next call retries.
        pub(crate) fn start() -> bun_sys::Result<()> {
            debug_assert!(bun_spawn_sys::waiter_thread_flag::get());

            if INSTANCE.started.load(Ordering::Acquire) > 0 {
                return Ok(());
            }
            let _guard = START_LOCK.lock_guard();
            if INSTANCE.started.load(Ordering::Relaxed) > 0 {
                return Ok(());
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if !INSTANCE.eventfd().is_valid() {
                let fd = bun_sys::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC)?;
                INSTANCE.eventfd.store(fd.native(), Ordering::Relaxed);
            }

            // Dropping the JoinHandle detaches the thread.
            std::thread::Builder::new()
                .stack_size(STACK_SIZE)
                .spawn(loop_)
                .map_err(|err| {
                    bun_sys::Error::from_code_int(
                        err.raw_os_error().unwrap_or(libc::EAGAIN),
                        bun_sys::Tag::pthread_create,
                    )
                })?;
            INSTANCE.started.store(1, Ordering::Release);
            Ok(())
        }

        /// Only call this after `start()` returns `Ok`.
        pub(crate) fn append(process: RefPtr<Process>) {
            // `js_process.queue` is an MPSC lock-free queue; `append` is the producer half.
            INSTANCE.js_process.append(process);

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                let one: [u8; 8] = (1usize).to_ne_bytes();
                if bun_sys::write(INSTANCE.eventfd(), &one).is_err() {
                    panic!("Failed to write to eventfd");
                }
            }
        }

        pub(crate) fn reload_handlers() {
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
                        // Not everything retries after EINTR: an addon, `bun:ffi`, LeakSanitizer.
                        sa_flags: libc::SA_NOCLDSTOP | libc::SA_RESTART,
                        sa_restorer: None,
                    };
                    libc::sigaction(libc::SIGCHLD, &raw const act, core::ptr::null_mut());
                }
            }
        }
    }

    static START_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

    #[cfg(any(target_os = "linux", target_os = "android"))]
    extern "C" fn wakeup(_: c_int) {
        let one: [u8; 8] = (1usize).to_ne_bytes();
        // eventfd is write-once in start() before this handler is installed.
        let _ = bun_sys::write(INSTANCE.eventfd(), &one).unwrap_or(0);
    }

    fn loop_() {
        Output::Source::configure_named_thread(bun_core::zstr!("Waitpid"));
        WaiterThreadPosix::reload_handlers();
        let mut active = Vec::new();

        #[allow(unused_labels)]
        'outer: loop {
            INSTANCE.js_process.loop_(&mut active);

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // `eventfd` is written once in `start()` before this thread is
                // spawned; read-only thereafter.
                let efd = INSTANCE.eventfd();
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

                let _ = bun_core::poll_once(&mut polls, i32::MAX);
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

// (PosixSpawnOptions / StdioKind / Dup2 / PosixStdio moved to bun_spawn_sys —
// re-exported above. Windows option/result types stay here: they embed
// `Process` / `EventLoopHandle` and so cannot live in the leaf -sys crate.)

#[cfg(windows)]
#[derive(Default)]
pub struct WindowsSpawnResult {
    process: Option<RefPtr<Process>>,
    pub stdin: WindowsStdioResult,
    pub stdout: WindowsStdioResult,
    pub stderr: WindowsStdioResult,
    pub extra_pipes: Vec<WindowsStdioResult>,
}

#[cfg(windows)]
impl Drop for WindowsSpawnResult {
    fn drop(&mut self) {
        if let Some(process) = &self.process {
            process.close();
        }
    }
}

#[cfg(windows)]
pub enum WindowsStdioResult {
    /// inherit, ignore, path, pipe
    Unavailable,
    Buffer(uv::Owned<uv::Pipe>),
    BufferFd(Fd),
    /// A stdio slot at index >= 3 whose value `Subprocess.stdio` has exposed:
    /// a duplicate of the pipe's HANDLE that the caller owns and closes
    /// (`net.connect({ fd })` adopts it). The `Buffer` it came from is closed
    /// when the slot is downgraded, so nothing here closes this handle. The
    /// counterpart of the POSIX `ExtraPipe::UnownedFd`.
    UnownedFd(Fd),
}

#[cfg(windows)]
impl Default for WindowsStdioResult {
    fn default() -> Self {
        Self::Unavailable
    }
}

#[cfg(windows)]
impl WindowsStdioResult {
    /// Mirrors `Option::take()` on the POSIX `StdioResult` so callers
    /// (`shell::subproc`, `bun_spawn` JS bindings) can pull the handle out by
    /// value without per-platform `mem::replace` at every call site.
    #[inline]
    pub fn take(&mut self) -> Self {
        core::mem::take(self)
    }
}

#[cfg(windows)]
impl WindowsSpawnResult {
    pub fn to_process(&mut self, _event_loop: impl Sized) -> RefPtr<Process> {
        self.process.take().unwrap()
    }

    /// [`to_process`](Self::to_process) as the exit-handler owner's handle.
    pub fn to_process_handle(&mut self, event_loop: impl Sized) -> ProcessHandle {
        ProcessHandle(self.to_process(event_loop))
    }
}

#[cfg(windows)]
pub struct WindowsSpawnOptions<'a> {
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
    pub argv0: Option<CStrRef<'a>>,
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
impl Default for WindowsSpawnOptions<'_> {
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
            // Every `bun.spawnSync` call site sets `loop_` explicitly. A
            // null handle here keeps `..Default::default()` usable
            // for the other fields. `spawn_process_windows` (the sole consumer)
            // asserts non-null at the read site so a forgotten `loop_` panics
            // with a pointed message instead of segfaulting at the `.uv_loop`
            // field offset.
            loop_: EventLoopHandle::init(core::ptr::null_mut()),
        }
    }
}

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
pub trait SpawnResultExt: Sized {
    fn to_process(self, event_loop: EventLoopHandle) -> RefPtr<Process>;

    /// [`to_process`](Self::to_process) as the exit-handler owner's handle.
    fn to_process_handle(self, event_loop: EventLoopHandle) -> ProcessHandle {
        ProcessHandle(self.to_process(event_loop))
    }
}

#[cfg(unix)]
impl SpawnResultExt for PosixSpawnResult {
    fn to_process(self, event_loop: EventLoopHandle) -> RefPtr<Process> {
        let mut status = OnceCell::new();
        if self.has_exited {
            let mut rusage = rusage_zeroed();
            let waitpid_result = posix_spawn::wait4(self.pid, 0, Some(&mut rusage));
            if let Some(reaped) = Status::from(self.pid, &waitpid_result) {
                status = OnceCell::from(reaped);
            }
        }
        RefPtr::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            pid: self.pid,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            pidfd: JsCell::new(self.pidfd),
            js_poster: event_loop.js_poster(),
            event_loop,
            poller: JsCell::new(Poller::Detached),
            status,
            exit_handler: Cell::default(),
        })
    }
}

#[cfg(unix)]
pub type SpawnOptions<'a> = PosixSpawnOptions<'a>;
#[cfg(windows)]
pub type SpawnOptions<'a> = WindowsSpawnOptions<'a>;

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
    use bun_sys::File;

    #[cfg(unix)]
    pub use bun_spawn_sys::spawn_process_posix;

    /// Without `envp`, the child inherits ours. Panics if neither `argv0` nor `argv[0]` is there.
    pub fn spawn_process(
        options: &SpawnOptions<'_>,
        argv: CStrList<'_>,
        envp: Option<CStrList<'_>>,
    ) -> Result<bun_sys::Result<SpawnProcessResult>, crate::Error> {
        #[cfg(unix)]
        {
            spawn_process_posix(options, argv, envp).map_err(Into::into)
        }
        #[cfg(not(unix))]
        {
            spawn_process_windows(options, argv, envp)
        }
    }

    /// [`spawn_process`] for callers holding borrowed strings: builds the `argv` pointer block.
    pub fn spawn_process_z(
        options: &SpawnOptions<'_>,
        argv: &[&bun_core::ZStr],
        envp: Option<CStrList<'_>>,
    ) -> Result<bun_sys::Result<SpawnProcessResult>, crate::Error> {
        let argv = argv.iter().map(|&arg| Some(arg.into()));
        let argv: Vec<_> = argv.chain([None]).collect();
        spawn_process(options, CStrList::new(&argv), envp)
    }

    #[cfg(windows)]
    pub(crate) fn spawn_process_windows(
        options: &WindowsSpawnOptions<'_>,
        argv: CStrList<'_>,
        envp: Option<CStrList<'_>>,
    ) -> Result<bun_sys::Result<WindowsSpawnResult>, crate::Error> {
        bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);

        // SAFETY: all-zero is a valid uv_process_options_t
        let mut uv_process_options: uv::uv_process_options_t =
            unsafe { bun_core::ffi::zeroed_unchecked() };

        uv_process_options.args = argv.as_ptr();
        // libuv: a null `env` inherits the parent's environment.
        uv_process_options.env = envp.map_or(core::ptr::null(), CStrList::as_ptr);
        let argv0 = options.argv0.or_else(|| argv.first());
        uv_process_options.file = argv0.expect("argv[0] is required").as_ptr();
        uv_process_options.exit_cb = Some(Process::on_exit_uv);
        // `WindowsOptions::default()` leaves a null handle, which `uv_loop()` would dereference.
        assert!(
            !matches!(options.windows.loop_, EventLoopHandle::Js { owner } if owner.owner().is_null()),
            "spawn_process_windows: WindowsSpawnOptions.windows.loop_ was not set. \
         WindowsOptions::default() leaves it zeroed (Zig spec: `= undefined`); \
         every caller must populate it — see src/CLAUDE.md §Spawning Subprocesses \
         (`.loop = jsc.EventLoopHandle.init(jsc.MiniEventLoop.initGlobal(...))`)."
        );
        // Non-null verified above; `EventLoopHandle::uv_loop` is the centralized
        // accessor for the set-once `.uv_loop` field of the `uws::WindowsLoop`.
        let loop_ = options.windows.loop_.uv_loop();

        let cwd = match bun_sys::to_posix_path(&options.cwd) {
            Ok(p) => p,
            Err(e) => return Err(crate::Error::Sys(e)),
        };

        // `git_diff_internal` reaches here
        // with `Options::default()` → `cwd = ""`. libuv treats a
        // non-NULL `cwd` as explicit and hands `L""` to `CreateProcessW`, which
        // fails with `ERROR_DIRECTORY` → `UV_ENOENT`. Map empty to NULL so libuv
        // inherits the parent cwd.
        uv_process_options.cwd = if options.cwd.is_empty() {
            core::ptr::null()
        } else {
            cwd.as_ptr().cast::<c_char>()
        };

        let mut opened = OpenedFiles {
            files: Vec::new(),
            loop_,
        };

        if let Some(hpcon) = options.pseudoconsole {
            uv_process_options.pseudoconsole = hpcon;
        }

        if options.windows.hide_window {
            uv_process_options.flags |= uv::UV_PROCESS_WINDOWS_HIDE;
        }

        if options.windows.verbatim_arguments {
            uv_process_options.flags |= uv::UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS;
        }

        if options.detached {
            uv_process_options.flags |= uv::UV_PROCESS_DETACHED;
        }

        // libuv's uv_spawn rejects UV_PROCESS_SETUID/SETGID with UV_ENOTSUP on
        // Windows — the same error Node reports for uid/gid there.
        if let Some(uid) = options.uid {
            uv_process_options.uid = uid as uv::uv_uid_t;
            uv_process_options.flags |= uv::UV_PROCESS_SETUID;
        }
        if let Some(gid) = options.gid {
            uv_process_options.gid = gid as uv::uv_gid_t;
            uv_process_options.flags |= uv::UV_PROCESS_SETGID;
        }

        let mut stdio_containers = vec![
            uv::uv_stdio_container_t {
                flags: uv::UV_IGNORE,
                data: uv::uv_stdio_container_data {
                    stream: core::ptr::null_mut(),
                },
            };
            3 + options.extra_fds.len()
        ];

        let stdio_options: [&WindowsStdio; 3] = [&options.stdin, &options.stdout, &options.stderr];

        // On Windows it seems don't have a dup2 equivalent with pipes
        // So we need to use file descriptors.
        // We can create a pipe with `uv_pipe(fds, 0, 0)` and get a read fd and write fd.
        // We give the write fd to stdout/stderr
        // And use the read fd to read from the output.
        let mut dup_pipe: Option<[bun_sys::File; 2]> = None;
        let mut dup_tgt: Option<usize> = None;

        let mut stdio_results: [WindowsStdioResult; 3] = Default::default();
        let mut extra_pipes = Vec::with_capacity(options.extra_fds.len());
        let new_pipe = |ipc: bool| {
            let mut pipe = uv::Owned::<uv::Pipe>::zeroed();
            pipe.init(loop_, ipc)
                .to_result(bun_sys::Tag::uv_pipe)
                .map(|()| pipe)
        };

        for fd_i in 0..3usize {
            let pipe_flags = uv::UV_CREATE_PIPE | uv::UV_READABLE_PIPE | uv::UV_WRITABLE_PIPE;
            let stdio: &mut uv::uv_stdio_container_t = &mut stdio_containers[fd_i];
            let flag: c_int = if fd_i == 0 {
                uv::O::RDONLY
            } else {
                uv::O::WRONLY
            };

            let mut treat_as_dup: bool = false;

            if fd_i == 1 && matches!(stdio_options[2], WindowsStdio::Dup2(_)) {
                treat_as_dup = true;
                dup_tgt = Some(fd_i);
            } else if fd_i == 2 && matches!(stdio_options[1], WindowsStdio::Dup2(_)) {
                treat_as_dup = true;
                dup_tgt = Some(fd_i);
            } else {
                match stdio_options[fd_i] {
                    WindowsStdio::Dup2(_) => treat_as_dup = true,
                    WindowsStdio::Inherit => {
                        stdio.flags = uv::UV_INHERIT_FD;
                        stdio.data.fd = uv::uv_file::try_from(fd_i).expect("int cast");
                    }
                    // ipc option inside stdin, stderr or stdout is not supported.
                    WindowsStdio::Ipc | WindowsStdio::Ignore => {
                        stdio.flags = uv::UV_IGNORE;
                    }
                    WindowsStdio::Path(path) => {
                        stdio.flags = uv::UV_INHERIT_FD;
                        stdio.data.fd = match opened.open(path, flag)? {
                            Ok(fd) => fd,
                            Err(err) => return Ok(Err(err)),
                        };
                    }
                    WindowsStdio::Buffer => {
                        let pipe = match new_pipe(false) {
                            Ok(pipe) => pipe,
                            Err(err) => return Ok(Err(err)),
                        };
                        stdio.flags = pipe_flags;
                        stdio.data.stream = pipe.as_ptr().cast();
                        stdio_results[fd_i] = WindowsStdioResult::Buffer(pipe);
                    }
                    WindowsStdio::Pipe(fd) => {
                        stdio.flags = uv::UV_INHERIT_FD;
                        stdio.data.fd = fd.uv();
                    }
                }
            }

            if treat_as_dup {
                if fd_i == 1 {
                    match bun_sys::pipe() {
                        Ok(fds) => dup_pipe = Some(fds.map(bun_sys::File::from_fd)),
                        Err(err) => return Ok(Err(err)),
                    }
                }
                stdio.flags = uv::UV_INHERIT_FD;
                stdio.data.fd = dup_pipe.as_ref().map_or(-1, |[_, write]| write.fd().uv());
            }
        }

        for (i, ipc) in options.extra_fds.iter().enumerate() {
            let stdio: &mut uv::uv_stdio_container_t = &mut stdio_containers[3 + i];
            let mut result = WindowsStdioResult::Unavailable;

            match ipc {
                WindowsStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
                WindowsStdio::Inherit => {
                    stdio.flags = uv::UV_INHERIT_FD;
                    stdio.data.fd = uv::uv_file::try_from(3 + i).expect("int cast");
                }
                WindowsStdio::Ignore => {
                    stdio.flags = uv::UV_IGNORE;
                }
                WindowsStdio::Path(path) => {
                    stdio.flags = uv::UV_INHERIT_FD;
                    stdio.data.fd = match opened.open(path, uv::O::RDWR)? {
                        Ok(fd) => fd,
                        Err(err) => return Ok(Err(err)),
                    };
                }
                WindowsStdio::Ipc | WindowsStdio::Buffer => {
                    let pipe = match new_pipe(matches!(ipc, WindowsStdio::Ipc)) {
                        Ok(pipe) => pipe,
                        Err(err) => return Ok(Err(err)),
                    };
                    stdio.flags = uv::UV_CREATE_PIPE
                        | uv::UV_WRITABLE_PIPE
                        | uv::UV_READABLE_PIPE
                        | uv::UV_OVERLAPPED_PIPE;
                    stdio.data.stream = pipe.as_ptr().cast();
                    result = WindowsStdioResult::Buffer(pipe);
                }
                WindowsStdio::Pipe(fd) => {
                    stdio.flags = uv::UV_INHERIT_FD;
                    stdio.data.fd = fd.uv();
                }
            }
            extra_pipes.push(result);
        }

        uv_process_options.stdio = stdio_containers.as_mut_ptr();
        uv_process_options.stdio_count = c_int::try_from(stdio_containers.len()).expect("int cast");
        uv_process_options.exit_cb = Some(Process::on_exit_uv);

        let process = RefPtr::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            pid: 0,
            status: OnceCell::new(),
            // SAFETY: all-zero is valid uv::Process
            handle: UnsafeCell::new(unsafe { bun_core::ffi::zeroed_unchecked() }),
            handle_has_closed: Cell::new(false),
            exit_handler: Cell::default(),
        });

        let uv_proc = process.handle.get();
        // SAFETY: process is freshly allocated. Back-pointer for `on_exit_uv` / `on_close_uv`.
        unsafe { (*uv_proc).data = process.as_ptr().cast::<c_void>() };

        // SAFETY: the zeroed handle of `process`, which nothing else has seen yet.
        let spawn_err = unsafe { (*uv_proc).spawn(loop_, &mut uv_process_options) }
            .to_error(bun_sys::Tag::uv_spawn);
        if let Some(err) = spawn_err {
            process.close();
            return Ok(Err(err));
        }
        // The process handle is open on this thread's loop until `close()`; a
        // thread teardown closes it through us (the child keeps running, as with
        // Node's ProcessWrap), so no exit callback can fire after the VM is gone.
        unsafe fn stop_for_vm_teardown(p: *mut c_void) {
            // SAFETY: recorded for this live Process; the handle leaves the list
            // when `close()` issues its uv_close.
            unsafe { (*p.cast::<Process>()).close() };
        }
        uv::open_handles::set_owner(
            uv_proc.cast(),
            process.as_ptr().cast(),
            Some(stop_for_vm_teardown),
        );

        // SAFETY: process is valid, and nothing borrows it yet
        unsafe {
            (*process.as_ptr()).pid = (*uv_proc).pid;
            // Function pointers compared by address (`as usize`): direct
            // `fn == fn` is unreliable across codegen units and triggers
            // `unpredictable_function_pointer_comparisons`.
            debug_assert_eq!(
                (*uv_proc).exit_cb.map(|cb| cb as usize),
                Some(
                    Process::on_exit_uv as unsafe extern "C" fn(*mut uv::uv_process_t, i64, c_int)
                        as usize,
                ),
            );
        }

        if let (Some(target), Some([read, _write])) = (dup_tgt, dup_pipe) {
            stdio_results[target] = WindowsStdioResult::BufferFd(read.into_raw());
        }
        let [stdin, stdout, stderr] = stdio_results;
        Ok(Ok(WindowsSpawnResult {
            process: Some(process),
            stdin,
            stdout,
            stderr,
            extra_pipes,
        }))
    }

    /// The files opened for a child to inherit.
    #[cfg(windows)]
    struct OpenedFiles {
        files: Vec<uv::uv_file>,
        loop_: *mut uv::uv_loop_t,
    }

    #[cfg(windows)]
    impl OpenedFiles {
        fn open(&mut self, path: &[u8], flag: c_int) -> Result<Maybe<uv::uv_file>, crate::Error> {
            let path_z = bun_sys::to_posix_path(path).map_err(crate::Error::Sys)?;
            let mut req = uv::fs_t::uninitialized();
            // SAFETY: `req` is a fresh `fs_t`, `loop_` is the live uv loop,
            // `path_z` is NUL-terminated and outlives the call (sync).
            let rc = unsafe {
                uv::uv_fs_open(
                    self.loop_,
                    &raw mut req,
                    path_z.as_ptr(),
                    flag | uv::O::CREAT,
                    0o644,
                    None,
                )
            };
            if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                return Ok(Err(err));
            }
            self.files.push(rc.int());
            Ok(Ok(rc.int()))
        }
    }

    #[cfg(windows)]
    impl Drop for OpenedFiles {
        fn drop(&mut self) {
            for &fd in &self.files {
                bun_io::Closer::close(Fd::from_uv(fd), self.loop_);
            }
        }
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

        pub struct Options<'a> {
            pub stdin: SyncStdio,
            pub stdout: SyncStdio,
            pub stderr: SyncStdio,
            pub ipc: Option<Fd>,
            pub cwd: Box<[u8]>,
            pub detached: bool,

            pub argv: Vec<Box<[u8]>>,
            /// `None` = inherit parent env
            pub envp: Option<CStrList<'a>>,

            pub use_execve_on_macos: bool,
            pub argv0: Option<CStrRef<'a>>,

            #[cfg(windows)]
            pub windows: WindowsOptions,
            /// Whether the child gets this process's descriptor `3 + index`, under the same number.
            #[cfg(windows)]
            pub inherited_extra_fds: Box<[bool]>,
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum SyncStdio {
            Inherit,
            Ignore,
            Buffer,
            /// The child gets this descriptor. It stays the caller's to close.
            Pipe(Fd),
        }

        impl SyncStdio {
            pub(crate) fn to_stdio(self) -> SpawnOptionsStdio {
                match self {
                    SyncStdio::Inherit => SpawnOptionsStdio::Inherit,
                    SyncStdio::Ignore => SpawnOptionsStdio::Ignore,
                    SyncStdio::Pipe(fd) => SpawnOptionsStdio::Pipe(fd),
                    SyncStdio::Buffer => SpawnOptionsStdio::Buffer,
                }
            }
        }

        // Helper alias: SpawnOptions::Stdio differs by platform
        #[cfg(unix)]
        pub(crate) type SpawnOptionsStdio = PosixStdio;
        #[cfg(windows)]
        pub(crate) type SpawnOptionsStdio = WindowsStdio;

        impl Default for Options<'_> {
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
                    #[cfg(windows)]
                    inherited_extra_fds: Box::default(),
                }
            }
        }

        impl<'a> Options<'a> {
            pub(crate) fn to_spawn_options(&self, new_process_group: bool) -> SpawnOptions<'a> {
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
                    windows: self.windows.clone(),
                    #[cfg(windows)]
                    extra_fds: self
                        .inherited_extra_fds
                        .iter()
                        .map(|&is_inherited| match is_inherited {
                            true => WindowsStdio::Inherit,
                            false => WindowsStdio::Ignore,
                        })
                        .collect(),
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

        #[cfg(windows)]
        pub(crate) struct SyncWindowsPipeReader {
            pub(crate) chunks: Vec<Box<[u8]>>,
            /// Buffer handed to libuv by `on_alloc`; reclaimed (truncated) by
            /// `on_read`. Prevents the per-read leak that copying `data` into a
            /// fresh Box would cause.
            pending_alloc: Option<Box<[u8]>>,
            pub(crate) pipe: uv::Owned<uv::Pipe>,
            pub(crate) err: bun_sys::E,
            pub(crate) context: *mut SyncWindowsProcess,
            pub(crate) tag: OutFd,
        }

        #[cfg(windows)]
        impl SyncWindowsPipeReader {
            fn on_alloc(this: &mut SyncWindowsPipeReader, suggested_size: usize) -> &mut [u8] {
                // Stash the allocation so `on_read` can reclaim it without copying.
                // If a previous alloc was never consumed (nread == 0 / EAGAIN),
                // dropping the old Box here frees it — no leak.
                let buf = this
                    .pending_alloc
                    .insert(vec![0u8; suggested_size].into_boxed_slice());
                &mut buf[..]
            }

            fn on_read(this: &mut SyncWindowsPipeReader, data: &[u8]) {
                // `data` *is* the buffer
                // `on_alloc` returned, sliced to `nread`. Reclaim that allocation
                // (debug-assert it's the same pointer), truncate to the read
                // length, and push — no copy, no leak.
                let buf = this
                    .pending_alloc
                    .take()
                    .expect("on_read without preceding on_alloc");
                debug_assert_eq!(buf.as_ptr(), data.as_ptr());
                debug_assert!(data.len() <= buf.len());
                let mut v = Vec::from(buf);
                v.truncate(data.len());
                this.chunks.push(v.into_boxed_slice());
            }

            fn on_error(this: &mut SyncWindowsPipeReader, err: bun_sys::E) {
                this.err = err;
                this.pipe.close(Self::on_close);
            }

            // ── libuv C trampolines ──────────────────────────────────────────
            // There is exactly
            // one call site, so we hand-write the wrapper pair against
            // `SyncWindowsPipeReader` and call `on_alloc` / `on_read` / `on_error`
            // *directly* — no runtime fn-ptr stash.
            unsafe extern "C" fn uv_alloc_cb(
                req: *mut uv::uv_handle_t,
                suggested_size: usize,
                buffer: *mut uv::uv_buf_t,
            ) {
                // SAFETY: `req.data` was set to `*mut Self` in `start()`.
                let this: &mut SyncWindowsPipeReader =
                    unsafe { &mut *((*req).data as *mut SyncWindowsPipeReader) };
                let buf = Self::on_alloc(this, suggested_size);
                // SAFETY: `buffer` is a libuv-owned out-parameter. Do NOT route
                // through `uv_buf_t::init(&[u8])` — that reborrows the `&mut [u8]`
                // as shared, so `as_ptr().cast_mut()` yields a SharedReadOnly tag
                // and libuv's subsequent write into `base[..nread]` is
                // Stacked-Borrows UB. Construct from `as_mut_ptr()` directly so the
                // raw pointer carries write provenance.
                unsafe {
                    *buffer = uv::uv_buf_t {
                        len: buf.len() as uv::ULONG,
                        base: buf.as_mut_ptr(),
                    };
                }
            }
            unsafe extern "C" fn uv_read_cb(
                req: *mut uv::uv_stream_t,
                nreads: uv::ReturnCodeI64,
                buffer: *const uv::uv_buf_t,
            ) {
                // SAFETY: `req.data` was set to `*mut Self` in `start()`.
                let this: &mut SyncWindowsPipeReader =
                    unsafe { &mut *((*req).data as *mut SyncWindowsPipeReader) };
                let nreads = nreads.int();
                if nreads == 0 {
                    return;
                } // EAGAIN / EWOULDBLOCK
                if nreads < 0 {
                    this.pipe.read_stop();
                    let e = bun_sys::windows::translate_uv_error_to_e(nreads as core::ffi::c_int);
                    Self::on_error(this, e);
                } else {
                    // SAFETY: libuv guarantees `base[..nreads]` is the slice we
                    // returned from `uv_alloc_cb`, filled to `nreads` bytes.
                    let data = unsafe {
                        core::slice::from_raw_parts((*buffer).base.cast::<u8>(), nreads as usize)
                    };
                    Self::on_read(this, data);
                }
            }

            extern "C" fn on_close(pipe: *mut uv::Pipe) {
                // SAFETY: pipe.data was set to *mut Self in start()
                let this: *mut SyncWindowsPipeReader =
                    unsafe { (*pipe).get_data::<SyncWindowsPipeReader>() };
                assert!(
                    !this.is_null(),
                    "Expected SyncWindowsPipeReader to have data"
                );
                // SAFETY: the box `start` gave up, whose handle libuv is done with.
                let this = *unsafe { bun_core::heap::take(this) };
                let err = if this.err == bun_sys::E::CANCELED {
                    bun_sys::E::SUCCESS
                } else {
                    this.err
                };
                // SAFETY: `context` is the live `SyncWindowsProcess` that owns
                // this reader (set in `spawn_windows_with_pipes`); the callback
                // is non-reentrant field writes only.
                unsafe { &mut *this.context }.on_reader_done(this.tag, this.chunks, err);
            }

            pub(crate) fn start(self) -> Maybe<()> {
                let this = bun_ptr::AliasableBox::new(self);
                // SAFETY: just allocated; nothing else borrows it.
                let pipe = unsafe { &mut (*this.as_ptr()).pipe };
                pipe.set_data(this.as_ptr().cast());
                pipe.ref_();
                pipe.read_start(Some(Self::uv_alloc_cb), Some(Self::uv_read_cb))
                    .to_result(bun_sys::Tag::listen)?;
                let _ = this.into_raw(); // the pipe's until `on_close`
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
            pub(crate) fn as_str(self) -> &'static str {
                match self {
                    OutFd::Stdout => "stdout",
                    OutFd::Stderr => "stderr",
                }
            }
        }

        #[cfg(windows)]
        pub struct SyncWindowsProcess {
            pub(crate) stderr: Vec<Box<[u8]>>,
            pub(crate) stdout: Vec<Box<[u8]>>,
            pub(crate) err: bun_sys::E,
            pub(crate) waiting_count: u8,
            pub(crate) status: Option<Status>,
        }

        #[cfg(windows)]
        impl SyncWindowsProcess {
            pub fn on_process_exit(this: *mut SyncWindowsProcess, status: Status) {
                // SAFETY: `this` is the local of spawn_windows_with_pipes;
                // single-threaded uv loop, no overlapping borrow of SyncWindowsProcess.
                unsafe {
                    (*this).status = Some(status);
                    (*this).waiting_count -= 1;
                }
            }

            pub(crate) fn on_reader_done(
                &mut self,
                tag: OutFd,
                chunks: Vec<Box<[u8]>>,
                err: bun_sys::E,
            ) {
                match tag {
                    OutFd::Stderr => self.stderr = chunks,
                    OutFd::Stdout => self.stdout = chunks,
                }
                if err != bun_sys::E::SUCCESS {
                    self.err = err;
                }
                self.waiting_count -= 1;
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

        #[cfg(windows)]
        fn spawn_windows_without_pipes(
            options: &Options<'_>,
            argv: CStrList<'_>,
            envp: Option<CStrList<'_>>,
        ) -> core::result::Result<Maybe<Result>, crate::Error> {
            // All stdio inherited: the child is the foreground program on our console.
            let _child = crate::ctrl_c::Child::enter();
            let mut spawned =
                match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
                    Err(err) => return Ok(Err(err)),
                    Ok(proces) => proces,
                };

            let loop_ = options.windows.loop_.platform_event_loop();
            let process = spawned.to_process_handle(());
            process.enable_keeping_event_loop_alive();

            let status = loop {
                if let Some(status) = process.status() {
                    break status.clone();
                }
                loop_.run();
            };

            Ok(Ok(Result {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }))
        }

        #[cfg(windows)]
        fn spawn_windows_with_pipes(
            options: &Options<'_>,
            argv: CStrList<'_>,
            envp: Option<CStrList<'_>>,
        ) -> core::result::Result<Maybe<Result>, crate::Error> {
            let loop_: EventLoopHandle = options.windows.loop_;
            let mut spawned =
                match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
                    Err(err) => return Ok(Err(err)),
                    Ok(process) => process,
                };
            let mut this = SyncWindowsProcess {
                stderr: Vec::new(),
                stdout: Vec::new(),
                err: bun_sys::E::SUCCESS,
                waiting_count: 1,
                status: None,
            };
            // The only path to `this` until the callbacks are done.
            let this_ptr = &raw mut this;
            let process = spawned.to_process(());
            // SAFETY: `this` outlives the dispatch of the exit.
            let handler = unsafe { ProcessExit::new(ProcessExitKind::SyncWindows, this_ptr) };
            process.set_exit_handler(handler);
            process.enable_keeping_event_loop_alive();

            for (tag, stdio) in [
                (OutFd::Stdout, &mut spawned.stdout),
                (OutFd::Stderr, &mut spawned.stderr),
            ] {
                if let WindowsStdioResult::Buffer(pipe) = stdio.take() {
                    let reader = SyncWindowsPipeReader {
                        context: this_ptr,
                        tag,
                        pipe,
                        chunks: Vec::new(),
                        pending_alloc: None,
                        err: bun_sys::E::SUCCESS,
                    };
                    // SAFETY: sole owner via `this_ptr`; no uv callback has fired yet.
                    unsafe {
                        (*this_ptr).waiting_count += 1;
                    }
                    match reader.start() {
                        Err(err) => {
                            let _ = process.kill(1);
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

            // SAFETY: read-only field access between uv ticks; callbacks fired
            // inside `tick()` write through the same `this_ptr` root.
            while unsafe { (*this_ptr).waiting_count } > 0 {
                loop_.platform_event_loop().tick();
            }

            Ok(Ok(Result {
                status: this
                    .status
                    .expect("Expected Process to have exited when waiting_count == 0"),
                stdout: flatten_owned_chunks(this.stdout),
                stderr: flatten_owned_chunks(this.stderr),
            }))
        }

        pub fn spawn(options: &Options<'_>) -> core::result::Result<Maybe<Result>, crate::Error> {
            let argv = CStringList::from_parts(options.argv.iter().map(|arg| [&**arg]));
            let argv = argv.as_list();

            #[cfg(windows)]
            {
                let envp = Some(options.envp.unwrap_or_else(|| bun_core::os::environ()));
                if options.stdin != SyncStdio::Buffer
                    && options.stderr != SyncStdio::Buffer
                    && options.stdout != SyncStdio::Buffer
                {
                    return spawn_windows_without_pipes(options, argv, envp);
                }
                return spawn_windows_with_pipes(options, argv, envp);
            }

            #[cfg(unix)]
            spawn_posix(options, argv, options.envp)
        }

        // Forward signals from parent to the child process.
        // FFI decls live in `bun_spawn_sys::ffi` (leaf -sys crate).
        #[cfg(unix)]
        use bun_spawn_sys::ffi::{
            Bun__currentSyncPID, Bun__registerSignalsForForwarding,
            Bun__sendPendingSignalIfNecessary, Bun__unregisterSignalsForForwarding, kill,
        };
        #[cfg(target_os = "macos")]
        use bun_spawn_sys::ffi::{
            Bun__noOrphans_begin, Bun__noOrphans_onExit, Bun__noOrphans_onFork,
            Bun__noOrphans_releaseKq,
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        use bun_sys::linux::{PrctlOp, prctl};

        /// RAII guard around `Bun__registerSignalsForForwarding`: registers on
        /// construction, unregisters on drop.
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
            /// No args; returns -1/errno on failure. macOS-only caller below.
            #[cfg(target_os = "macos")]
            safe fn kqueue() -> c_int;
        }

        #[cfg(unix)]
        impl JobControl {
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            fn is_active(&self) -> bool {
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
            options: &Options<'_>,
            argv: CStrList<'_>,
            envp: Option<CStrList<'_>>,
        ) -> core::result::Result<Maybe<Result>, crate::Error> {
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
            // calls from other threads would race the subreaper flag and steal each other's
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
                let _ = prctl(PrctlOp::SET_CHILD_SUBREAPER, 1);
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
                    let _ = prctl(PrctlOp::SET_CHILD_SUBREAPER, 0);
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
            let mut no_orphans_kq: Option<File> = None;
            #[cfg(target_os = "macos")]
            if no_orphans {
                let kq = kqueue();
                if kq >= 0 {
                    no_orphans_kq = Some(File::from_fd(Fd::from_native(kq)));
                }
            }
            // LIFO: runs after killSyncScriptTree() (which needs m_kq live for
            // its NOTE_FORK-drain rescan), before `no_orphans_kq` drops/closes.
            #[cfg(target_os = "macos")]
            scopeguard::defer! {
                if no_orphans_kq.is_some() {
                    Bun__noOrphans_releaseKq();
                }
            }

            Bun__currentSyncPID.store(0, core::sync::atomic::Ordering::SeqCst);
            let _signals = SignalForwarding::register();

            let process =
                match spawn_process_posix(&options.to_spawn_options(no_orphans), argv, envp)? {
                    Err(err) => return Ok(Err(err)),
                    Ok(proces) => proces,
                };
            // Negative → kill() in the C++ signal forwarder targets the pgroup, so
            // a SIGTERM/SIGINT delivered to `bun run` reaches every descendant
            // that hasn't `setsid()`-escaped.
            // SeqCst pairs with the signal handler (see `Bun__sendPendingSignalIfNecessary`).
            Bun__currentSyncPID.store(
                if no_orphans {
                    -i64::from(process.pid)
                } else {
                    i64::from(process.pid)
                },
                core::sync::atomic::Ordering::SeqCst,
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
                if let Some(kq) = &no_orphans_kq {
                    Bun__noOrphans_begin(kq.fd().native(), process.pid);
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
            let mut out_files = [process.stdout, process.stderr];
            let kill_and_fail = |err| {
                let _ = kill(process.pid, 1);
                Ok(Err(err))
            };

            let mut out_fds_to_wait_for = out_files
                .each_ref()
                .map(|file| file.as_ref().map_or(Fd::INVALID, File::fd));

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
                        no_orphans_kq.as_ref(),
                        &mut out,
                        &mut out_fds_to_wait_for,
                        &mut out_files,
                    );
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    let r: Option<Maybe<Status>> = wait_linux_signalfd(
                        process.pid,
                        ppid,
                        no_orphans,
                        &*_jc,
                        &mut out,
                        &mut out_fds_to_wait_for,
                        &mut out_files,
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
                            Err(err) => return kill_and_fail(err),
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
                            drain_fd(&mut out_fds_to_wait_for[i], &mut out_files[i], &mut out[i])
                        {
                            return kill_and_fail(err);
                        }
                    }

                    let mut poll_fds_buf: [libc::pollfd; 2] = bun_core::ffi::zeroed();
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

                    let rc = bun_core::poll_once(&mut poll_fds_buf[..poll_len], -1);
                    match bun_sys::get_errno(rc as isize) {
                        bun_sys::E::SUCCESS => {}
                        bun_sys::E::EAGAIN | bun_sys::E::EINTR => continue,
                        err => {
                            return kill_and_fail(bun_sys::Error::from_code(
                                err,
                                bun_sys::Tag::poll,
                            ));
                        }
                    }
                }
                reap_child(process.pid)
            };

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                for (idx, &memfd) in process.memfds[1..].iter().enumerate() {
                    if memfd && let Some(file) = &out_files[idx] {
                        out[idx] = file.read_to_end().unwrap_or_default();
                    }
                }
            }

            let [stdout, stderr] = out;
            Ok(Ok(Result {
                status,
                stdout,
                stderr,
            }))
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
            kq: Option<&File>,
            out: &mut [Vec<u8>; 2],
            out_fds_to_wait_for: &mut [Fd; 2],
            out_files: &mut [Option<File>; 2],
        ) -> Option<Maybe<Status>> {
            // kqueue() failed in spawnPosix (EMFILE/ENOMEM): let the caller's
            // plain `poll()` loop drain `.buffer` stdio and reap. The spawnPosix
            // defers (pgroup-kill, killTracked() — empty set) still run.
            let kq_fd = kq?.fd();

            // udata tag for the ppid PROC filter. Descendant PROC knotes
            // (`child` here, plus any `scan()` adds) use udata=0; EVFILT_READ
            // udata 0/1 are a separate filter, so the dispatch checks `filter`
            // before `udata`.
            const TAG_PPID: usize = 2;

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

            let mut receipts: [libc::kevent; 5] = bun_core::ffi::zeroed();
            // SAFETY: the loop below reads `udata` as a number. The one other reader of `kq_fd`,
            // `NoOrphansTracker::killTracked`, throws the events away.
            let registered = unsafe {
                bun_sys::kevent(
                    kq_fd,
                    &changes_buf[..changes_len],
                    &mut receipts[..changes_len],
                    None,
                )
            };
            match registered {
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

            let mut events: [libc::kevent; 16] = bun_core::ffi::zeroed();
            let mut child_exited = false;
            let mut child_status: Option<Status> = None;
            loop {
                let got = match bun_sys::kevent_wait(kq_fd, &mut events[..], None) {
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
                            drain_fd(&mut out_fds_to_wait_for[i], &mut out_files[i], &mut out[i])
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
                        let _ =
                            drain_fd(&mut out_fds_to_wait_for[i], &mut out_files[i], &mut out[i]);
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
            out_files: &mut [Option<File>; 2],
        ) -> Option<Maybe<Status>> {
            // Child-exit: signalfd(SIGCHLD). Works everywhere pidfd doesn't
            // (gVisor, ancient kernels). Subreaper means orphaned grandchildren
            // also reparent to us and fire SIGCHLD here — drain them with
            // waitpid(-1, WNOHANG) and only stop when *our* child is reaped.
            // signalfd takes the *kernel* sigset_t (1 word), sigprocmask the libc
            // one (16 words) — block via libc, build a separate kernel mask for
            // signalfd.
            // SAFETY: signal mask manipulation
            let (_restore_mask, chld_fd) = unsafe {
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
                    let mut kmask: libc::sigset_t = bun_core::ffi::zeroed();
                    libc::sigemptyset(&raw mut kmask);
                    libc::sigaddset(&raw mut kmask, libc::SIGCHLD);
                    let rc = libc::signalfd(
                        -1,
                        &raw const kmask,
                        libc::SFD_CLOEXEC | libc::SFD_NONBLOCK,
                    );
                    (rc >= 0).then(|| File::from_fd(Fd::from_native(rc)))
                };
                // Bound in this order: the signalfd closes, then the signal mask is restored.
                (restore, fd)
            };

            // Child-exit, take 2: pidfd. signalfd only fires if SIGCHLD stays
            // pending — i.e. is blocked on *every* thread. PackageManager / HTTP
            // client threads created before we got here don't block it, so the
            // kernel can hand the signal to one of them and the signalfd never
            // wakes. A pidfd becomes readable on child exit regardless of signal
            // masking, so poll it too. Keep the signalfd for the subreaper-adopted
            // orphans (whose pidfds we don't have) and as the gVisor / pre-5.3
            // fallback when pidfd_open is unavailable.
            let child_pidfd = bun_sys::pidfd_open(child, 0).ok().map(File::from_fd);

            // Parent-death: pidfd when available (instant wake). When not
            // (gVisor, sandboxes, pre-5.3): bound the poll at 100ms and recheck
            // `getppid()`.
            let mut ppid_fd: Option<File> = None;
            if ppid > 1 {
                match bun_sys::pidfd_open(ppid, 0) {
                    Ok(fd) => ppid_fd = Some(File::from_fd(fd)),
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
                let _ = prctl(PrctlOp::SET_PDEATHSIG, 0);
            }
            scopeguard::defer! {
                if ppid > 1 {
                    let _ = prctl(PrctlOp::SET_PDEATHSIG, libc::SIGKILL as _);
                }
            }
            if ppid > 1 && getppid() != ppid {
                Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
            }

            let need_ppid_fallback = ppid > 1 && ppid_fd.is_none();
            // Only block forever when we have a wake source for *both* events we
            // care about. signalfd alone is not a reliable child-exit wake (see
            // the `child_pidfd` comment above), so require the pidfd for `-1`.
            let timeout_ms: i32 = if need_ppid_fallback || child_pidfd.is_none() {
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
                        drain_fd(&mut out_fds_to_wait_for[i], &mut out_files[i], &mut out[i])
                    {
                        return Some(Err(err));
                    }
                }

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
                if let Some(file) = &ppid_fd {
                    push(&mut buf, &mut pfds_len, file.fd());
                }
                let chld_idx = pfds_len;
                if let Some(file) = &chld_fd {
                    push(&mut buf, &mut pfds_len, file.fd());
                }
                if let Some(file) = &child_pidfd {
                    push(&mut buf, &mut pfds_len, file.fd());
                }

                let rc = bun_core::poll_once(&mut buf[..pfds_len], timeout_ms);
                match bun_sys::get_errno(rc as isize) {
                    bun_sys::E::SUCCESS => {}
                    bun_sys::E::EAGAIN | bun_sys::E::EINTR => {}
                    err => return Some(Err(bun_sys::Error::from_code(err, bun_sys::Tag::poll))),
                }

                if (ppid_fd.is_some() && buf[ppid_idx].revents != 0)
                    || (need_ppid_fallback && getppid() != ppid)
                {
                    Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                }

                // Drain the signalfd so the next poll blocks; the actual reap
                // happens at the top of the next iteration.
                if let Some(chld_fd) = &chld_fd
                    && buf[chld_idx].revents != 0
                {
                    // The siginfo payload is discarded — we only need a buffer of
                    // the right size to drain the fd, so a plain byte array avoids
                    // the unsafe struct-as-bytes reinterpret entirely.
                    let mut si_bytes = [0u8; core::mem::size_of::<libc::signalfd_siginfo>()];
                    while chld_fd.read(&mut si_bytes).unwrap_or(0) == si_bytes.len() {}
                }
            }
            for i in 0..2 {
                let _ = drain_fd(&mut out_fds_to_wait_for[i], &mut out_files[i], &mut out[i]);
            }
            Some(Ok(child_status.unwrap()))
        }

        /// Non-blocking drain of `fd` into `bytes`. Closes and invalidates both
        /// slots on EOF, which takes `fd` out of the next poll; returns null
        /// on EOF/retry/EPIPE (caller keeps polling) or the recv/OOM error
        /// otherwise. Shared by the `poll()` path and the no-orphans wait loops.
        #[cfg(unix)]
        fn drain_fd(
            fd: &mut Fd,
            file: &mut Option<File>,
            bytes: &mut Vec<u8>,
        ) -> Option<bun_sys::Error> {
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
                match bun_core::vec::append_with(bytes, usize::MAX, |spare| {
                    bun_sys::recv_non_block_buf(*fd, spare)
                }) {
                    Err(err) => {
                        if err.is_retry() || err.get_errno() == bun_sys::E::EPIPE {
                            return None;
                        }
                        return Some(err);
                    }
                    Ok(bytes_read) => {
                        if bytes_read == 0 {
                            *fd = Fd::INVALID;
                            *file = None;
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
pub use spawn_process_body::spawn_process_z;

pub use spawn_process_body::sync;
