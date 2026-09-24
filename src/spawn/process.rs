#[cfg(target_os = "macos")]
use core::ffi::c_void;
use core::ffi::{c_char, c_int};
#[cfg(unix)]
use core::sync::atomic::AtomicU32;
#[cfg(unix)]
use core::sync::atomic::Ordering;

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
use bun_core::Global;
#[cfg(unix)]
use bun_core::Output;
use bun_event_loop::EventLoopHandle;
#[cfg(unix)]
use bun_io::FilePoll;
use bun_io::KeepAlive;
#[cfg(unix)]
use bun_io::ParentDeathWatchdog;
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, Maybe};
#[cfg(windows)]
use bun_uws_sys::iocp;

// posix_spawn(2) wrappers — owned by the `bun_spawn_sys` leaf crate.
#[cfg(unix)]
use bun_spawn_sys::posix_spawn::posix_spawn;
/// `posix_spawn::WaitPidResult` — re-exported from `bun_spawn_sys`. `status`
/// is `u32` there; `Status::from` casts before matching.
#[cfg(unix)]
pub use posix_spawn::WaitPidResult;

/// The fd / memfd helpers of `bun_sys` that spawning uses, under the path
/// `bun_runtime::api::bun_spawn::stdio` and `Terminal` import them from.
pub mod spawn_sys {
    // POSIX-only: memfd and FD_CLOEXEC have no Windows equivalent.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub use bun_sys::{MemfdFlags, MemfdFlags as MemfdFlag, memfd_create};
    #[cfg(unix)]
    pub use bun_sys::{can_use_memfd, set_close_on_exec};
}

bun_core::declare_scope!(PROCESS, visible);

// ─── Re-exports from `bun_spawn_sys` ─────────────────────────────────────────
// The raw OS spawn layer (option/result structs, `Rusage`, `spawn_process_posix`,
// `spawn_process_windows`) lives in the leaf `bun_spawn_sys` crate so it has no
// event-loop dependency. Re-export here so `bun_spawn::process::*` paths resolve.
#[cfg(windows)]
pub use bun_spawn_sys::WindowsOptions;
pub use bun_spawn_sys::spawn_process::rusage_zeroed;
pub use bun_spawn_sys::{
    Argv, CStrPtr, Dup2, Envp, ExtraPipe, PidFdType, PidT, Rusage, SpawnOptions, SpawnResult,
    Stdio, StdioKind,
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

#[inline]
fn call_exit_handler(
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

// The count is intrusive and atomic: a raw `*mut Process` travels through the
// event loop's poll/wait callbacks and the waiter thread. The derive's default
// destructor frees the box (`heap::take`), which runs `Drop` below.
#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct Process {
    pub pid: PidT,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) pidfd: PidFdType,
    /// Open until `close()`; while it is, the pid cannot be reused.
    #[cfg(windows)]
    pub(crate) process_handle: bun_sys::windows::HANDLE,
    /// The signal `kill()` ended the process with. Windows has no notion of
    /// one, so this is what makes the exit report as signaled.
    #[cfg(windows)]
    pub(crate) exit_signal: u8,
    pub status: Status,
    pub poller: Poller,
    pub(crate) ref_count: bun_ptr::ThreadSafeRefCount<Process>,
    pub exit_handler: ProcessExitHandler,
    pub(crate) event_loop: EventLoopHandle,
    /// How the waiter thread delivers this process's exit to a JS VM
    /// (`None` when owned by a mini event loop, which it posts to directly).
    #[cfg(unix)]
    pub(crate) js_poster: Option<bun_event_loop::JsPoster>,
}

impl Drop for Process {
    fn drop(&mut self) {
        self.poller.deinit();
        #[cfg(windows)]
        self.close_process_handle();
    }
}

/// The exit-handler owner's handle on a [`Process`]: one owned ref, and
/// dropping it detaches the handler before releasing that ref. The owner must
/// stay live until the handle is dropped or the exit has been dispatched —
/// keeping the handle in one of the owner's fields satisfies that.
///
/// Borrows of the `Process` (its own heap allocation, event-loop thread only)
/// are call-scoped. Dropping the handle from inside the exit handler re-enters
/// the `Process` whose `on_exit` is dispatching.
pub struct ProcessHandle(RefPtr<Process>);

impl core::ops::Deref for ProcessHandle {
    type Target = Process;
    #[inline]
    fn deref(&self) -> &Process {
        &self.0
    }
}

impl ProcessHandle {
    /// Call-scoped `&mut` to the process (event-loop thread only).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn process_mut(&self) -> &mut Process {
        // SAFETY: we hold a ref, so the pointee is live; callers keep the
        // borrow call-scoped.
        unsafe { &mut *self.0.as_ptr() }
    }

    /// Dispatch this process's exit to `owner` (see the type-level contract).
    pub fn set_exit_handler<T: crate::ProcessExitOwner>(&self, owner: bun_ptr::ThisPtr<T>) {
        // SAFETY: `owner` is live now (`ThisPtr` invariant) and, per the
        // type-level contract, for every dispatch.
        let h = unsafe { ProcessExit::of(owner.as_ptr()) };
        self.process_mut().set_exit_handler(h);
    }

    /// See [`Process::watch_or_reap`]; may synchronously run the exit handler,
    /// so call this on a handle the handler does not re-borrow (a local, not
    /// the owner's slot).
    pub fn watch_or_reap(&self) -> bun_sys::Result<bool> {
        self.process_mut().watch_or_reap()
    }

    /// See [`Process::on_exit`]; runs the exit handler (same rule as
    /// [`watch_or_reap`](Self::watch_or_reap)).
    pub fn on_exit(&self, status: Status, rusage: &Rusage) {
        self.process_mut().on_exit(status, rusage)
    }

    pub fn kill(&self, signal: u8) -> Maybe<()> {
        self.process_mut().kill(signal)
    }

    /// The process's address, for identity checks in exit callbacks.
    pub fn as_ptr(&self) -> *mut Process {
        self.0.as_ptr()
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        self.process_mut().detach();
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
    /// `self` afterwards.
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
        self.event_loop.as_event_loop_ctx()
    }
}

#[inline]
pub fn event_loop_handle_to_ctx(handle: EventLoopHandle) -> bun_io::EventLoopCtx {
    handle.as_event_loop_ctx()
}

// ─── spawn-result / exit-watch Process methods ───────────────────────────────
impl Process {
    /// Heap-allocates the `Process` for a spawned child with its initial ref.
    pub(crate) fn init(spawned: &mut SpawnResult, event_loop: EventLoopHandle) -> *mut Process {
        #[cfg(unix)]
        let status = 'brk: {
            if spawned.has_exited {
                let mut rusage = rusage_zeroed();
                let waitpid_result = posix_spawn::wait4(spawned.pid, 0, Some(&mut rusage));
                break 'brk Status::from(spawned.pid, &waitpid_result).unwrap_or(Status::Running);
            }
            Status::Running
        };
        #[cfg(windows)]
        let status = Status::Running;
        bun_core::heap::into_raw(Box::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            pid: spawned.pid,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            pidfd: spawned.pidfd.unwrap_or(0),
            #[cfg(windows)]
            process_handle: spawned.process_handle.take(),
            #[cfg(windows)]
            exit_signal: 0,
            #[cfg(unix)]
            js_poster: event_loop.js_poster(),
            event_loop,
            poller: Poller::Detached,
            status,
            exit_handler: ProcessExitHandler::default(),
        }))
    }

    /// The process handle; invalid once the process has exited or `close()` ran.
    #[cfg(windows)]
    #[inline]
    pub fn process_handle(&self) -> bun_sys::windows::HANDLE {
        self.process_handle
    }

    /// Resource usage so far of a process that has not exited yet.
    #[cfg(windows)]
    pub fn rusage(&self) -> Option<Rusage> {
        if self.process_handle == bun_sys::windows::INVALID_HANDLE_VALUE {
            return None;
        }
        Some(bun_spawn_sys::process_rusage(self.process_handle))
    }

    #[cfg(windows)]
    fn close_process_handle(&mut self) {
        if self.process_handle != bun_sys::windows::INVALID_HANDLE_VALUE {
            // SAFETY: the handle is ours and nothing waits on it any more.
            unsafe { bun_spawn_sys::windows::win32::CloseHandle(self.process_handle) };
            self.process_handle = bun_sys::windows::INVALID_HANDLE_VALUE;
        }
    }

    pub fn on_exit(&mut self, status: Status, rusage: &Rusage) {
        let exit_handler = self.exit_handler;
        self.status = status.clone();
        if self.has_exited() {
            self.detach();
        }
        call_exit_handler(&exit_handler, self, status, rusage);
    }

    /// The process handle is signalled: report how the process ended.
    #[cfg(windows)]
    fn on_process_signaled(&mut self) {
        use bun_spawn_sys::windows::win32;
        let rusage = bun_spawn_sys::process_rusage(self.process_handle);
        let mut exit_code: win32::DWORD = 0;
        let status = if win32::GetExitCodeProcess(self.process_handle, &mut exit_code) == 0 {
            Status::Err(win32::last_error(bun_sys::Tag::waitpid))
        } else if self.exit_signal != 0 {
            Status::Signaled(self.exit_signal)
        } else {
            Status::Exited(Exited::from_exit_code(exit_code))
        };
        bun_core::scoped_log!(PROCESS, "Process.onExit({}) {}", self.pid, status);
        self.on_exit(status, &rusage);
    }

    pub fn wait(&mut self, sync_: bool) {
        #[cfg(unix)]
        {
            let mut rusage = rusage_zeroed();
            let waitpid_result = posix_spawn::wait4(
                self.pid,
                if sync_ { 0 } else { libc::WNOHANG as u32 },
                Some(&mut rusage),
            );
            self.on_wait_pid(&waitpid_result, &rusage);
        }
        #[cfg(windows)]
        {
            use bun_spawn_sys::windows::win32;
            if self.has_exited() || self.process_handle == bun_sys::windows::INVALID_HANDLE_VALUE {
                return;
            }
            let timeout = if sync_ { win32::INFINITE } else { 0 };
            if win32::WaitForSingleObject(self.process_handle, timeout) == win32::WAIT_OBJECT_0 {
                self.on_process_signaled();
            }
        }
    }

    /// # Safety
    /// `this` carries the +1 ref taken when the waiter-thread task was queued.
    /// `RefPtr::from_raw` releases it on return — which may free `this` — so
    /// this takes `*mut Self`, not `&mut self` (a `&mut` argument's
    /// Stacked-Borrows protector outliving the allocation is UB).
    #[cfg(unix)]
    pub(crate) unsafe fn on_wait_pid_from_waiter_thread(
        this: *mut Self,
        waitpid_result: &bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) {
        // SAFETY: caller contract — adopts the queued +1 ref.
        let _guard = unsafe { RefPtr::from_raw(this) };
        // SAFETY: `_guard` keeps `this` live; `&mut` scoped to the poller unref.
        unsafe {
            if let Poller::WaiterThread(waiter) = &mut (*this).poller {
                let ctx = (*this).event_loop.as_event_loop_ctx();
                waiter.unref(ctx);
                (*this).poller = Poller::Detached;
            }
        }
        // SAFETY: `_guard` keeps `this` live; `&mut` scoped to this call (which
        // can fire the JS exit handler).
        unsafe { (*this).on_wait_pid(waitpid_result, rusage) };
    }

    /// # Safety
    /// See [`Process::on_wait_pid_from_waiter_thread`].
    #[cfg(unix)]
    pub unsafe fn on_wait_pid_from_event_loop_task(this: *mut Self) {
        // SAFETY: caller contract — adopts the queued +1 ref.
        let _guard = unsafe { RefPtr::from_raw(this) };
        // SAFETY: `_guard` keeps `this` live.
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
            let ctx = self.event_loop_ctx();
            if let Poller::Wait(_, keep_alive) = &mut self.poller {
                keep_alive.ref_(ctx);
                return Ok(());
            }
            if self.process_handle == bun_sys::windows::INVALID_HANDLE_VALUE {
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ESRCH,
                    bun_sys::Tag::waitpid,
                ));
            }

            let loop_ = self.event_loop.loop_();
            // SAFETY: `loop_` is the live loop of this thread.
            let wait = unsafe { iocp::us_iocp_wait_create(loop_) };
            if wait.is_null() {
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::ENOMEM,
                    bun_sys::Tag::waitpid,
                ));
            }
            let exit_wait = bun_core::heap::into_raw(Box::new(ExitWait {
                op: iocp::Op::new(ExitWait::on_packet),
                wait,
                process: std::ptr::from_mut::<Process>(self),
                loop_,
                prev: core::ptr::null_mut(),
                next: core::ptr::null_mut(),
            }));
            // SAFETY: `exit_wait` was just allocated and stays at this address
            // until its packet is dequeued or the wait is stopped. An already
            // signalled handle queues the packet all the same.
            if unsafe {
                iocp::us_iocp_wait_start(wait, self.process_handle, &raw mut (*exit_wait).op)
            } != 0
            {
                // SAFETY: the wait never started; nothing else refers to either.
                unsafe {
                    iocp::us_iocp_wait_free(wait);
                    drop(bun_core::heap::take(exit_wait));
                }
                return Err(bun_sys::Error::from_code(
                    bun_sys::E::EINVAL,
                    bun_sys::Tag::waitpid,
                ));
            }

            // SAFETY: `exit_wait` is live, at its final address and not listed.
            unsafe { ExitWait::link(exit_wait) };
            let mut keep_alive = KeepAlive::default();
            keep_alive.ref_(ctx);
            self.poller = Poller::Wait(
                core::ptr::NonNull::new(exit_wait).expect("heap::into_raw is non-null"),
                keep_alive,
            );
            // Owned by `exit_wait` for as long as its `process` is set.
            self.ref_();
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
            // Borrow scoped to the call.
            unsafe { (*poll).enable_keeping_process_alive(ctx) };

            // SAFETY: poll is live and `platform_event_loop` returns the live
            // uws loop; both `&mut`s are scoped to the `register` call.
            match unsafe {
                (*poll).register(
                    &mut *self.event_loop.platform_event_loop(),
                    bun_io::PollKind::Process,
                    PROCESS_POLL_ONE_SHOT,
                )
            } {
                Ok(()) => {
                    self.ref_();
                    Ok(())
                }
                Err(err) => {
                    // SAFETY: poll is live; borrow scoped to the call.
                    unsafe { (*poll).disable_keeping_process_alive(ctx) };
                    Err(err)
                }
            }
        }
    }

    #[cfg(unix)]
    pub(crate) fn rewatch_posix(&mut self) -> bun_sys::Result<()> {
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
            // SAFETY: `platform_event_loop` returns the live uws loop; borrow
            // scoped to the `register` call.
            let maybe = fd.register(
                unsafe { &mut *self.event_loop.platform_event_loop() },
                bun_io::PollKind::Process,
                PROCESS_POLL_ONE_SHOT,
            );
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

    pub fn close(&mut self) {
        #[cfg(unix)]
        {
            let mut stranded_watch_ref = false;
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
            if let Poller::Wait(exit_wait, mut keep_alive) =
                core::mem::replace(&mut self.poller, Poller::Detached)
            {
                keep_alive.unref(self.event_loop.as_event_loop_ctx());
                let exit_wait = exit_wait.as_ptr();
                // SAFETY: `exit_wait` is live while the poller holds it. Once the
                // wait is stopped nothing refers to it; otherwise its packet is
                // already on its way and it stays allocated for `on_packet`,
                // which frees it.
                unsafe {
                    ExitWait::unlink(exit_wait);
                    if iocp::us_iocp_wait_stop((*exit_wait).wait) != 0 {
                        iocp::us_iocp_wait_free((*exit_wait).wait);
                        drop(bun_core::heap::take(exit_wait));
                    } else {
                        (*exit_wait).process = core::ptr::null_mut();
                    }
                }
                // SAFETY: the watch's ref; callers hold their own +1, so this
                // never drops to zero.
                unsafe { Self::deref(std::ptr::from_mut(self)) };
            }
            self.close_process_handle();
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
            // tick *after* the Fd poller is armed.
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
            if self.has_exited() || self.process_handle == bun_sys::windows::INVALID_HANDLE_VALUE {
                return Ok(());
            }
            match bun_spawn_sys::windows::kill(self.process_handle, c_int::from(signal)) {
                // Signal 0 only probes: it ends nothing, so it is not how the process ended.
                Ok(()) if signal == 0 => {}
                Ok(()) => self.exit_signal = signal,
                // if the process was already killed don't throw
                Err(err) if err.get_errno() == bun_sys::E::ESRCH => {}
                Err(err) => return Err(err),
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

impl Exited {
    /// From a `GetExitCodeProcess` DWORD.
    #[cfg(windows)]
    fn from_exit_code(raw: u32) -> Exited {
        Exited {
            code: raw as u8,
            signal: 0,
            raw,
        }
    }

    /// Ended by the default Ctrl+C handler (`STATUS_CONTROL_C_EXIT`). Never on
    /// POSIX, where that is a `SIGINT` death.
    #[inline]
    pub fn is_ctrl_c_exit(self) -> bool {
        #[cfg(windows)]
        return self.raw == bun_sys::windows::STATUS_CONTROL_C_EXIT;
        #[cfg(not(windows))]
        false
    }
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

pub enum Poller {
    /// Hive-allocated `bun_io::FilePoll` slot. Pointer (not `Box`) because the
    /// poll lives in `Store`; freed via `FilePoll::deinit`,
    /// never via Rust `drop`.
    #[cfg(unix)]
    Fd(core::ptr::NonNull<FilePoll>),
    #[cfg(unix)]
    WaiterThread(KeepAlive),
    /// Watching the process handle through the loop's completion port.
    #[cfg(windows)]
    Wait(core::ptr::NonNull<ExitWait>, KeepAlive),
    Detached,
}

impl Poller {
    /// NOT `impl Drop`: this enum is reassigned freely (`self.poller =
    /// Poller::Detached`, `Poller::WaiterThread(..)`, etc.) and `close()`
    /// already performs the same teardown explicitly before reassigning. A
    /// `Drop` impl would double-free the hive slot on those reassignments.
    /// Called only from `Process` drop. A Windows watch holds a ref on the
    /// `Process`, so none is left by then.
    pub(crate) fn deinit(&mut self) {
        #[cfg(unix)]
        if let Some(poll) = self.fd_poll_mut() {
            poll.deinit();
        } else if let Poller::WaiterThread(w) = self {
            w.disable();
        }
        #[cfg(windows)]
        debug_assert!(matches!(self, Poller::Detached));
    }

    #[cfg(unix)]
    fn into_fd(self) -> Option<core::ptr::NonNull<FilePoll>> {
        match self {
            Poller::Fd(f) => Some(f),
            _ => None,
        }
    }

    /// Mutably borrow the hive-allocated `FilePoll` slot if this poller is `Fd`.
    ///
    /// Single `unsafe` deref site for the `NonNull<FilePoll>` payload. The slot
    /// lives in the hive `Store` until `deinit` returns it; the only Rust handle
    /// is the `NonNull` inside this enum, so `&mut self` ⇒ the returned
    /// `&mut FilePoll` is the only live reference to the slot
    /// (event-loop-thread exclusive).
    #[cfg(unix)]
    #[inline]
    fn fd_poll_mut(&mut self) -> Option<&mut FilePoll> {
        match self {
            // SAFETY: `Fd` holds the unique handle to a live hive slot, freed
            // only via `deinit` (which consumes the variant). `&mut self` ⇒
            // exclusive access to the unique handle ⇒ exclusive access to
            // the hive slot.
            Poller::Fd(poll) => Some(unsafe { poll.as_mut() }),
            _ => None,
        }
    }

    /// The `KeepAlive` a poller without a `FilePoll` carries.
    fn keep_alive_mut(&mut self) -> Option<&mut KeepAlive> {
        match self {
            #[cfg(unix)]
            Poller::WaiterThread(keep_alive) => Some(keep_alive),
            #[cfg(windows)]
            Poller::Wait(_, keep_alive) => Some(keep_alive),
            _ => None,
        }
    }

    pub(crate) fn enable_keeping_event_loop_alive(&mut self, ctx: bun_io::EventLoopCtx) {
        #[cfg(unix)]
        if let Some(poll) = self.fd_poll_mut() {
            poll.enable_keeping_process_alive(ctx);
            return;
        }
        if let Some(keep_alive) = self.keep_alive_mut() {
            keep_alive.ref_(ctx);
        }
    }

    pub(crate) fn disable_keeping_event_loop_alive(&mut self, ctx: bun_io::EventLoopCtx) {
        #[cfg(unix)]
        if let Some(poll) = self.fd_poll_mut() {
            poll.disable_keeping_process_alive(ctx);
            return;
        }
        if let Some(keep_alive) = self.keep_alive_mut() {
            keep_alive.unref(ctx);
        }
    }
}

/// The op a process-exit wait completes with. Heap-allocated on its own: the
/// loop owns it from `us_iocp_wait_start` until its packet is dequeued or
/// `us_iocp_wait_stop` reports the wait removed, whatever happens to the
/// `Process` meanwhile.
#[cfg(windows)]
#[repr(C)]
pub struct ExitWait {
    op: iocp::Op,
    wait: *mut iocp::Wait,
    /// Holds one ref while set; null once the `Process` closed the watch with
    /// the packet already in flight.
    process: *mut Process,
    loop_: *mut bun_uws_sys::Loop,
    /// [`EXIT_WAITS`] links; listed exactly while `process` is set.
    prev: *mut ExitWait,
    next: *mut ExitWait,
}

#[cfg(windows)]
thread_local! {
    /// The exit waits of this thread that still report to a `Process`, so a
    /// loop that is about to be freed can end them ([`close_all_for_loop`]).
    static EXIT_WAITS: core::cell::Cell<*mut ExitWait> =
        const { core::cell::Cell::new(core::ptr::null_mut()) };
}

/// `us_loop_free` starts with this: what is still open on `loop_` caches its
/// pointer and completes through it, so each is closed, which cancels its
/// operations, and the loop then collects those before it goes.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__closeAllForLoop(loop_: *mut bun_uws_sys::Loop) {
    bun_io::windows::close_all_for_loop(loop_);
    close_all_for_loop(loop_);
}

/// Stop watching every process whose exit wait is on `loop_`, which this
/// thread is about to free (a Worker's): [`Process::close`] for each. Their
/// exit handlers never run and the children are left running, as when a POSIX
/// loop goes away with process polls still registered.
#[cfg(windows)]
fn close_all_for_loop(loop_: *mut bun_uws_sys::Loop) {
    let mut cursor = EXIT_WAITS.get();
    while !cursor.is_null() {
        // SAFETY: listed waits are live and their `process` is set; `close`
        // unlinks `cursor` and nothing else, so the next pointer is read
        // first. The extra ref keeps the `Process` allocated across `close`
        // releasing the watch's.
        unsafe {
            let next = (*cursor).next;
            if (*cursor).loop_ == loop_ {
                let process = (*cursor).process;
                (*process).ref_();
                (*process).close();
                Process::deref(process);
            }
            cursor = next;
        }
    }
}

#[cfg(windows)]
impl ExitWait {
    /// # Safety
    /// `this` is live, at its final address and not listed.
    unsafe fn link(this: *mut ExitWait) {
        let head = EXIT_WAITS.get();
        // SAFETY: caller contract; `head` is a listed (live) wait or null.
        unsafe {
            (*this).next = head;
            if !head.is_null() {
                (*head).prev = this;
            }
        }
        EXIT_WAITS.set(this);
    }

    /// # Safety
    /// `this` is live and listed, on the thread that listed it.
    unsafe fn unlink(this: *mut ExitWait) {
        // SAFETY: caller contract; neighbours are listed (live) waits.
        unsafe {
            let (prev, next) = ((*this).prev, (*this).next);
            if prev.is_null() {
                EXIT_WAITS.set(next);
            } else {
                (*prev).next = next;
            }
            if !next.is_null() {
                (*next).prev = prev;
            }
        }
    }

    unsafe extern "C" fn on_packet(
        _loop: *mut bun_uws_sys::Loop,
        op: *mut iocp::Op,
        _entry: *mut iocp::OverlappedEntry,
    ) {
        // SAFETY: `op` is the first field of the `ExitWait` allocated in
        // `Process::watch`; with its packet dequeued the loop is done with it.
        let process = unsafe {
            let this = op.cast::<ExitWait>();
            let process = (*this).process;
            if !process.is_null() {
                ExitWait::unlink(this);
            }
            iocp::us_iocp_wait_free((*this).wait);
            drop(bun_core::heap::take(this));
            process
        };
        if process.is_null() {
            return;
        }
        // SAFETY: adopts the ref `watch()` took. Stay raw — dropping the guard
        // may free the allocation.
        let _guard = unsafe { RefPtr::from_raw(process) };
        // SAFETY: `_guard` keeps `process` live; `&mut` scoped to each statement
        // (`on_process_signaled` can run the exit handler).
        unsafe {
            if let Poller::Wait(_, mut keep_alive) =
                core::mem::replace(&mut (*process).poller, Poller::Detached)
            {
                keep_alive.unref((*process).event_loop.as_event_loop_ctx());
            }
            (*process).on_process_signaled();
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
        pub(crate) started: AtomicU32,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) eventfd: Fd,
        pub(crate) js_process: ProcessQueue,
    }

    type ProcessQueue = NewQueue<Process>;

    pub struct NewQueue<T: 'static> {
        pub(crate) queue: ConcurrentQueue<T>,
        // The active list holds raw `*T` whose strong ref was taken
        // by the caller before `append()` (Process::watch does `self.ref_()`).
        // The matching `deref()` happens in `on_wait_pid_from_waiter_thread`.
        //
        // `UnsafeCell` so `loop_` can take `&self`: the waiter thread is the
        // *sole* mutator of `active`, but producers concurrently hold `&self`
        // to push onto `queue` — a `&mut self` on the waiter side would alias
        // those producer borrows (forbidden aliased-&mut). With `&self` on
        // both sides the only interior mutation goes through this cell.
        pub(crate) active: core::cell::UnsafeCell<Vec<*mut T>>,
    }

    impl<T: 'static> NewQueue<T> {
        pub(crate) const fn new() -> Self {
            Self {
                queue: ConcurrentQueue::new(),
                active: core::cell::UnsafeCell::new(Vec::new()),
            }
        }
    }

    /// Intrusive node pushed onto `ConcurrentQueue` from the JS thread and
    /// drained on the waiter thread.
    pub struct TaskQueueEntry<T: 'static> {
        pub(crate) process: *mut T,
        pub(crate) next: bun_threading::Link<TaskQueueEntry<T>>,
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
        pub(crate) result: bun_sys::Result<WaitPidResult>,
        pub(crate) subprocess: *mut T,
        pub(crate) rusage: Rusage,
    }

    impl<T: ProcessLike> bun_event_loop::Taskable for ResultTask<T> {
        const TAG: TaskTag = T::TASK_TAG;
        /// An exit status the waiter thread posted whose delivery will not run:
        /// drop it and the strong ref it carried for the JS thread.
        unsafe fn release_unrun(this: *mut Self) {
            // SAFETY: fn contract — the box `ResultTask::new` made; `subprocess`
            // holds the ref taken before `append()`.
            unsafe {
                let t = bun_core::heap::take(this);
                T::release_ref_from_waiter_thread(t.subprocess);
            }
        }
        /// A child's exit is delivered to its `Process` whatever became of the script that spawned it
        /// (the child is reaped); what reaches script is the exit handler's to decide.
        unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
            bun_event_loop::ContextId::NONE
        }
    }

    impl<T: ProcessLike> ResultTask<T> {
        #[inline]
        pub(crate) fn new(v: ResultTask<T>) -> *mut ResultTask<T> {
            bun_core::heap::into_raw(Box::new(v))
        }

        pub fn run_from_js_thread(self) {
            self.run_from_main_thread();
        }

        pub(crate) fn run_from_main_thread(self) {
            // SAFETY: subprocess strong-ref'd before append(); released by
            // on_wait_pid_from_waiter_thread → deref().
            unsafe {
                T::on_wait_pid_from_waiter_thread(self.subprocess, &self.result, &self.rusage)
            };
        }
    }

    /// Posted to `MiniEventLoop` from the waiter thread. Self-referential via
    /// the embedded intrusive `task: AnyTaskWithExtraContext` (`.ctx == self`).
    #[repr(C)]
    pub(crate) struct ResultTaskMini<T: 'static> {
        pub(crate) result: bun_sys::Result<WaitPidResult>,
        pub(crate) subprocess: *mut T,
        pub(crate) task: AnyTaskWithExtraContext,
    }

    impl<T: ProcessLike> ResultTaskMini<T> {
        #[inline]
        pub(crate) fn new(v: ResultTaskMini<T>) -> *mut ResultTaskMini<T> {
            bun_core::heap::into_raw(Box::new(v))
        }

        pub(crate) fn run_from_main_thread(self) {
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
        /// The poster for a JS-owned process (see `Process::js_poster`).
        fn js_poster(&self) -> Option<&bun_event_loop::JsPoster>;
        /// Waiter thread, VM gone: release the strong ref the result would have
        /// consumed on the JS thread.
        ///
        /// # Safety
        /// `this` is a live, strong-ref'd pointer; callee releases one ref.
        unsafe fn release_ref_from_waiter_thread(this: *mut Self);
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
        fn js_poster(&self) -> Option<&bun_event_loop::JsPoster> {
            self.js_poster.as_ref()
        }
        #[inline]
        unsafe fn release_ref_from_waiter_thread(this: *mut Self) {
            // SAFETY: fn contract.
            unsafe { Process::deref(this) };
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
        pub(crate) fn append(&self, process: *mut T) {
            // freshly boxed `TaskQueueEntry`; `into_raw` yields a valid owned pointer.
            let entry = bun_core::heap::into_raw(Box::new(TaskQueueEntry {
                process,
                next: bun_threading::Link::new(),
            }));
            // SAFETY: `entry` was just `into_raw`'d from a live Box (non-null).
            self.queue
                .push(unsafe { core::ptr::NonNull::new_unchecked(entry) });
        }

        pub(crate) fn loop_(&self) {
            // The dedicated waiter thread is the only caller of `loop_` and
            // the only code path that touches `active`; producers (`append`)
            // only touch `self.queue`. Move the Vec out and work on it by
            // value so no reference into the cell spans the loop body.
            // SAFETY: sole accessor per above; the swap cannot race or alias.
            let mut active = unsafe { core::ptr::replace(self.active.get(), Vec::new()) };
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
                            EventLoopHandle::Js { .. } => {
                                let rt = ResultTask::<T>::new(ResultTask {
                                    result,
                                    subprocess: process,
                                    rusage,
                                });
                                let ct = ConcurrentTask::create(Task::init(rt));
                                let poster = T::js_poster(process_ref)
                                    .expect("JS-owned process has a poster");
                                if let bun_event_loop::Posted::Refused(ct) = poster.post(ct) {
                                    // VM torn down: nobody will observe this exit. Free the
                                    // task and drop the ref its delivery would have released.
                                    // SAFETY: refused ⇒ we own both boxes; `process` is strong-ref'd.
                                    unsafe {
                                        drop(bun_core::heap::take(ct.as_ptr()));
                                        drop(bun_core::heap::take(rt));
                                        T::release_ref_from_waiter_thread(process);
                                    }
                                }
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

            // Put the (possibly reallocated) Vec back; the placeholder left by
            // the swap above is empty and allocation-free.
            // SAFETY: sole accessor per the comment at the top of this fn.
            unsafe { *self.active.get() = active };
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
        pub(crate) fn should_use_waiter_thread() -> bool {
            bun_spawn_sys::waiter_thread_flag::get()
        }

        pub(crate) fn append(process: *mut Process) {
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
                        // The handler only writes to the eventfd: a system call it
                        // lands in, on whichever thread, carries on instead of
                        // failing with EINTR.
                        sa_flags: libc::SA_NOCLDSTOP | libc::SA_RESTART,
                        sa_restorer: None,
                    };
                    libc::sigaction(libc::SIGCHLD, &raw const act, core::ptr::null_mut());
                }
            }
        }
    }

    pub(crate) fn init() -> Result<(), std::io::Error> {
        debug_assert!(bun_spawn_sys::waiter_thread_flag::get());

        if instance_ref().started.fetch_max(1, Ordering::Relaxed) > 0 {
            return Ok(());
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let fd = bun_sys::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC)
                .map_err(|e| std::io::Error::from_raw_os_error(e.errno as i32))?;
            // SAFETY: single-writer init path (guarded by fetch_max above).
            unsafe { (*instance()).eventfd = fd };
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

    pub(crate) fn loop_() {
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

/// Event-loop-aware extension on the raw [`SpawnResult`] from
/// `bun_spawn_sys`. The result type itself lives in the leaf `-sys` crate (no
/// `Process`/`EventLoopHandle` dependency), so `to_process` is a trait method.
pub trait SpawnResultExt: Sized {
    fn to_process(self, event_loop: EventLoopHandle) -> RefPtr<Process>;

    /// [`to_process`](Self::to_process) as the exit-handler owner's handle.
    fn to_process_handle(self, event_loop: EventLoopHandle) -> ProcessHandle {
        ProcessHandle(self.to_process(event_loop))
    }
}

impl SpawnResultExt for SpawnResult {
    fn to_process(mut self, event_loop: EventLoopHandle) -> RefPtr<Process> {
        // SAFETY: `init` heap-allocates the `Process` with its initial ref.
        unsafe { RefPtr::from_raw(Process::init(&mut self, event_loop)) }
    }
}

// ─── spawn_process bodies + sync runner ──────────────────────────────────────

mod spawn_process_body {
    use super::*;
    use bun_sys::FdExt as _;

    #[cfg(unix)]
    pub use bun_spawn_sys::spawn_process_posix;
    #[cfg(windows)]
    use bun_spawn_sys::spawn_process_windows;

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
    /// null-terminated array of NUL-terminated C strings, or be null on
    /// Windows (the child then inherits this process's environment). Both must
    /// remain valid for the duration of the call.
    pub unsafe fn spawn_process(
        options: &SpawnOptions,
        argv: Argv, // [*:null]?[*:0]const u8
        envp: Envp,
    ) -> Result<bun_sys::Result<SpawnResult>, crate::Error> {
        #[cfg(unix)]
        {
            // SAFETY: forwarded from this function's safety contract.
            unsafe { spawn_process_posix(options, argv, envp) }.map_err(Into::into)
        }
        #[cfg(windows)]
        {
            // SAFETY: forwarded from this function's safety contract.
            unsafe { spawn_process_windows(options, argv, envp) }.map_err(Into::into)
        }
    }

    /// The environment block handed to the child by [`spawn_process_cstr`].
    #[derive(Clone, Copy)]
    pub enum SpawnEnv<'a> {
        /// This process's own `environ`.
        Inherit,
        /// `KEY=VALUE` strings; the null-terminated pointer block is built here.
        Strings(&'a [&'a core::ffi::CStr]),
    }

    /// [`spawn_process`] for callers holding borrowed C strings: builds the
    /// null-terminated `argv`/`envp` pointer blocks for the duration of the call.
    pub fn spawn_process_cstr(
        options: &SpawnOptions,
        argv: &[&core::ffi::CStr],
        env: SpawnEnv<'_>,
    ) -> Result<bun_sys::Result<SpawnResult>, crate::Error> {
        assert!(!argv.is_empty(), "spawn_process_cstr: argv[0] is required");
        let argv: Vec<CStrPtr> = argv
            .iter()
            .map(|s| s.as_ptr())
            .chain(core::iter::once(core::ptr::null()))
            .collect();
        let env_block: Vec<CStrPtr>;
        let envp: Envp = match env {
            #[cfg(windows)]
            SpawnEnv::Inherit => core::ptr::null(),
            #[cfg(unix)]
            SpawnEnv::Inherit => bun_core::c_environ(),
            SpawnEnv::Strings(strings) => {
                env_block = strings
                    .iter()
                    .map(|s| s.as_ptr())
                    .chain(core::iter::once(core::ptr::null()))
                    .collect();
                env_block.as_ptr()
            }
        };
        // SAFETY: `argv` is a null-terminated array of NUL-terminated strings
        // with argv[0] non-null (asserted); `envp` is likewise, or null on
        // Windows for `Inherit`. Both are borrowed for the call.
        unsafe { spawn_process(options, argv.as_ptr(), envp) }
    }

    pub mod sync {
        use super::*;
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
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        pub enum SyncStdio {
            Inherit,
            Ignore,
            Buffer,
        }

        impl SyncStdio {
            pub(crate) fn to_stdio(self) -> Stdio {
                match self {
                    SyncStdio::Inherit => Stdio::Inherit,
                    SyncStdio::Ignore => Stdio::Ignore,
                    SyncStdio::Buffer => Stdio::Buffer,
                }
            }
        }

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
                }
            }
        }

        impl Options {
            pub(crate) fn to_spawn_options(&self, new_process_group: bool) -> SpawnOptions {
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

        /// One output pipe of a synchronously spawned child, drained with
        /// overlapped reads so both pipes and the process can be waited on from
        /// one thread. The handle is never associated with a completion port;
        /// completion is signalled through `event`.
        #[cfg(windows)]
        struct PipeDrain {
            handle: bun_sys::windows::HANDLE,
            event: bun_sys::windows::HANDLE,
            /// Boxed: the kernel writes to it while a read is pending.
            overlapped: Box<bun_spawn_sys::windows::win32::OVERLAPPED>,
            /// The pending read targets this buffer's spare capacity, so it is
            /// not touched until the read completes.
            bytes: Vec<u8>,
            pending: bool,
        }

        #[cfg(windows)]
        impl PipeDrain {
            const CHUNK: usize = 64 * 1024;

            fn new(fd: Option<Fd>) -> Maybe<Self> {
                use bun_spawn_sys::windows::win32;
                let mut this = Self {
                    handle: fd.map_or(win32::INVALID_HANDLE_VALUE, |fd| fd.native()),
                    event: core::ptr::null_mut(),
                    // SAFETY: all-zero is a valid OVERLAPPED.
                    overlapped: Box::new(unsafe { bun_core::ffi::zeroed_unchecked() }),
                    bytes: Vec::new(),
                    pending: false,
                };
                if this.is_open() {
                    // SAFETY: no attributes, no name; manual-reset, as overlapped I/O requires.
                    this.event = unsafe {
                        win32::CreateEventW(core::ptr::null_mut(), 1, 0, core::ptr::null())
                    };
                    if this.event.is_null() {
                        return Err(win32::last_error(bun_sys::Tag::read));
                    }
                    this.overlapped.hEvent = this.event;
                }
                Ok(this)
            }

            fn is_open(&self) -> bool {
                self.handle != bun_sys::windows::INVALID_HANDLE_VALUE
            }

            fn close(&mut self) {
                // SAFETY: the parent end of the pipe is ours.
                unsafe { bun_spawn_sys::windows::win32::CloseHandle(self.handle) };
                self.handle = bun_sys::windows::INVALID_HANDLE_VALUE;
            }

            /// `result` is what `ReadFile`/`GetOverlappedResult` answered for the
            /// read into the spare capacity. Returns whether the pipe is still open.
            fn finish_read(&mut self, ok: bool, bytes_read: u32) -> Maybe<bool> {
                use bun_spawn_sys::windows::win32;
                if ok {
                    // SAFETY: the kernel wrote `bytes_read` bytes into the spare capacity.
                    unsafe { bun_core::vec::commit_spare(&mut self.bytes, bytes_read as usize) };
                    return Ok(true);
                }
                match win32::GetLastError() {
                    // Every write end is closed: end of file.
                    win32::ERROR_BROKEN_PIPE => {
                        self.close();
                        Ok(false)
                    }
                    code => Err(win32::sys_error(code, bun_sys::Tag::read)),
                }
            }

            /// Reads until a read is left pending or the pipe ends.
            fn read(&mut self) -> Maybe<()> {
                use bun_spawn_sys::windows::win32;
                while self.is_open() {
                    if self.bytes.try_reserve(Self::CHUNK).is_err() {
                        return Err(bun_sys::Error::from_code(
                            bun_sys::E::ENOMEM,
                            bun_sys::Tag::read,
                        ));
                    }
                    // SAFETY: only used as the destination of the read below.
                    let spare = unsafe { bun_core::vec::spare_bytes_mut(&mut self.bytes) };
                    let mut bytes_read: u32 = 0;
                    // SAFETY: `spare` and `overlapped` stay valid and unmoved until
                    // the read completes (see `Drop`).
                    let ok = unsafe {
                        win32::ReadFile(
                            self.handle,
                            spare.as_mut_ptr(),
                            spare.len().min(u32::MAX as usize) as u32,
                            &mut bytes_read,
                            (&raw mut *self.overlapped).cast(),
                        )
                    } != 0;
                    if !ok && win32::GetLastError() == win32::ERROR_IO_PENDING {
                        self.pending = true;
                        return Ok(());
                    }
                    self.finish_read(ok, bytes_read)?;
                }
                Ok(())
            }

            /// `event` is signalled: take the pending read's result and read on.
            fn on_event(&mut self) -> Maybe<()> {
                use bun_spawn_sys::windows::win32;
                let mut bytes_read: u32 = 0;
                // SAFETY: `overlapped` is the pending read's; it has completed.
                let ok = unsafe {
                    win32::GetOverlappedResult(
                        self.handle,
                        &raw mut *self.overlapped,
                        &mut bytes_read,
                        0,
                    )
                } != 0;
                self.pending = false;
                self.finish_read(ok, bytes_read)?;
                self.read()
            }
        }

        #[cfg(windows)]
        impl Drop for PipeDrain {
            fn drop(&mut self) {
                use bun_spawn_sys::windows::win32;
                // SAFETY: the handles are ours. A pending read owns `overlapped`
                // and the buffer until it has completed, cancelled or not.
                unsafe {
                    if self.pending {
                        let mut bytes_read: u32 = 0;
                        win32::CancelIoEx(self.handle, &raw mut *self.overlapped);
                        win32::GetOverlappedResult(
                            self.handle,
                            &raw mut *self.overlapped,
                            &mut bytes_read,
                            1,
                        );
                    }
                    if self.is_open() {
                        win32::CloseHandle(self.handle);
                    }
                    if !self.event.is_null() {
                        win32::CloseHandle(self.event);
                    }
                }
            }
        }

        #[cfg(windows)]
        fn spawn_windows(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, crate::Error> {
            use bun_spawn_sys::windows::win32;

            // With no stdio captured the child is the foreground program on our console.
            let _foreground = (options.stdin != SyncStdio::Buffer
                && options.stdout != SyncStdio::Buffer
                && options.stderr != SyncStdio::Buffer)
                .then(crate::ctrl_c::Child::enter);

            // SAFETY: caller-built argv/envp; see `spawn_with_argv`.
            let spawned = match unsafe {
                spawn_process_windows(&options.to_spawn_options(false), argv, envp)
            }? {
                Err(err) => return Ok(Err(err)),
                Ok(spawned) => spawned,
            };

            let process = spawned.process_handle.get();

            // Nothing is written to the child's stdin: end it.
            if let Some(stdin) = spawned.stdin {
                stdin.close();
            }

            let kill_child = || {
                let _ =
                    bun_spawn_sys::windows::kill(process, bun_spawn_sys::windows::kill::SIGKILL);
            };
            let mut drains = match (
                PipeDrain::new(spawned.stdout),
                PipeDrain::new(spawned.stderr),
            ) {
                (Ok(stdout), Ok(stderr)) => [stdout, stderr],
                (Err(err), _) | (_, Err(err)) => {
                    kill_child();
                    return Ok(Err(err));
                }
            };
            let drained: Maybe<()> = (|| {
                for drain in &mut drains {
                    drain.read()?;
                }
                loop {
                    let mut events = [core::ptr::null_mut(); 2];
                    let mut owners = [0usize; 2];
                    let mut count = 0usize;
                    for (i, drain) in drains.iter().enumerate() {
                        if drain.pending {
                            events[count] = drain.event;
                            owners[count] = i;
                            count += 1;
                        }
                    }
                    if count == 0 {
                        return Ok(());
                    }
                    // SAFETY: `events[..count]` are live event handles.
                    let signalled = unsafe {
                        win32::WaitForMultipleObjects(
                            count as u32,
                            events.as_ptr(),
                            0,
                            win32::INFINITE,
                        )
                    } as usize;
                    if signalled >= count {
                        return Err(win32::last_error(bun_sys::Tag::poll));
                    }
                    drains[owners[signalled]].on_event()?;
                }
            })();
            if let Err(err) = drained {
                kill_child();
                return Ok(Err(err));
            }

            if win32::WaitForSingleObject(process, win32::INFINITE) != win32::WAIT_OBJECT_0 {
                return Ok(Err(win32::last_error(bun_sys::Tag::waitpid)));
            }
            let mut exit_code: u32 = 0;
            if win32::GetExitCodeProcess(process, &mut exit_code) == 0 {
                return Ok(Err(win32::last_error(bun_sys::Tag::waitpid)));
            }

            let [stdout, stderr] = &mut drains;
            Ok(Ok(Result {
                status: Status::Exited(Exited::from_exit_code(exit_code)),
                stdout: core::mem::take(&mut stdout.bytes),
                stderr: core::mem::take(&mut stderr.bytes),
            }))
        }

        pub fn spawn_with_argv(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, crate::Error> {
            #[cfg(windows)]
            return spawn_windows(options, argv, envp);

            #[cfg(unix)]
            spawn_posix(options, argv, envp)
        }

        pub fn spawn(options: &Options) -> core::result::Result<Maybe<Result>, crate::Error> {
            // SAFETY: `bun_sys::environ_ptr` returns the live, NULL-terminated C
            // `environ` array when no envp override is provided.
            #[cfg(unix)]
            let envp: *const *const c_char = options.envp.unwrap_or_else(bun_sys::environ_ptr);
            // A null block makes the child inherit this process's environment.
            #[cfg(windows)]
            let envp: *const *const c_char = options.envp.unwrap_or(core::ptr::null());
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
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
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
            process: &SpawnResult,
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
pub use spawn_process_body::{SpawnEnv, spawn_process_cstr};

pub use spawn_process_body::sync;
