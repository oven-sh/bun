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
/// is `u32` there (Zig `c_int` reinterpreted via the `W*` macros);
/// `Status::from` casts before matching.
#[cfg(unix)]
pub use posix_spawn::WaitPidResult;
#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WaitPidResult {
    pub pid: PidT,
    pub status: c_int,
}

pub mod spawn_sys {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub use bun_sys::{MemfdFlags, MemfdFlags as MemfdFlag, memfd_create};
    #[cfg(unix)]
    pub use bun_sys::{can_use_memfd, set_close_on_exec};
}

bun_core::declare_scope!(PROCESS, visible);

pub use bun_spawn_sys::spawn_process::{IoCounters, WinRusage, WinTimeval, rusage_zeroed};
#[cfg(windows)]
pub use bun_spawn_sys::uv_getrusage;
pub use bun_spawn_sys::{
    Argv, CStrPtr, Dup2, Envp, ExtraPipe, FdT, PidFdType, PidT, PosixSpawnOptions,
    PosixSpawnResult, PosixStdio, Rusage, StdioKind,
};

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
    /// Zig `Process.deinit`: `this.poller.deinit(); bun.destroy(this)`. The
    /// `bun.destroy` half is the `heap::take` in `destructor` above; this
    /// `Drop` body covers the `poller.deinit()` call.
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

    /// Intrusive ref-count helpers (Zig: `ref_count.ref()/deref()`). Kept on
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

    #[inline]
    fn event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        event_loop_handle_to_ctx(self.event_loop)
    }
}

#[inline]
pub fn event_loop_handle_to_ctx(handle: EventLoopHandle) -> bun_io::EventLoopCtx {
    handle.as_event_loop_ctx()
}

impl Process {
    #[cfg(windows)]
    /// SAFETY: `this` must be the live heap-allocated `Process` (the same
    /// pointer stored in `uv_process_t.data`).
    ///
    /// Receiver is `*mut Process`, not `&mut self`: this path synchronously
    /// runs the exit logic, and `on_exit_uv` re-derives `&mut Process` from
    /// the heap-root `data` pointer. A `&mut self` argument carries a
    /// Stacked-Borrows protector for the call's full duration, so that
    /// re-derivation would pop the protected tag → instant UB. Zig used
    /// `@fieldParentPtr` (no aliasing model), so this was sound there.
    pub unsafe fn update_status_on_windows(this: *mut Process) {
        // Zig: `onExitUV(&this.poller.uv, 0, 0)`. Inlined here with
        // exit_status=0 / term_signal=0 (→ `Exited{0,0}`) instead of
        // round-tripping through `on_exit_uv`'s `data`-ptr lookup, which
        // would create a second `&mut Process` aliasing the one below.
        // SAFETY: caller contract — `this` is live and exclusively accessed.
        let p = unsafe { &mut *this };
        if let Poller::Uv(uv_proc) = &mut p.poller {
            if uv_proc.is_active() || !matches!(p.status, Status::Running) {
                return;
            }
            let rusage = uv_getrusage(uv_proc);
            // NLL: `uv_proc`'s borrow of `p.poller` ends here; `p` is free
            // to be reborrowed whole for `close()` / `on_exit()`.
            p.close();
            p.on_exit(Status::Exited(Exited { code: 0, signal: 0 }), &rusage);
        }
    }

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
                            &posix_spawn::wait4(pid, 0, Some(&mut rusage_result)),
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
            if let Poller::Uv(p) = &mut self.poller {
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
                // already have a poll
                // PORT NOTE: reshaped for borrowck — take existing pointer out
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

    #[cfg(windows)]
    extern "C" fn on_exit_uv(process: *mut uv::uv_process_t, exit_status: i64, term_signal: c_int) {
        // Zig recovers `*Process` via `@fieldParentPtr("uv", process)` →
        // `@fieldParentPtr("poller", ..)`. A Rust default-repr `enum` has no
        // stable variant-payload offset, so the back-pointer is stored in
        // `uv_process_t.data` (set in `spawn_process_windows` immediately
        // after the handle is zeroed).
        //
        // Read everything needed from `*process` BEFORE creating
        // `this: &mut Process`. The handle is the inline `Poller::Uv` field,
        // so once `this` exclusively borrows the whole `Process`, any later
        // `&mut *process` (or raw read via `process`) overlaps that borrow
        // and pops `this`'s Unique tag under Stacked Borrows — the
        // subsequent `this.close()` (which touches `self.poller`) would then
        // use an invalidated tag.
        // SAFETY: libuv passes the live handle; only reads its POD fields.
        let rusage = uv_getrusage(unsafe { &mut *process });
        // SAFETY: raw read of POD `pid` field on the live handle.
        let _pid = unsafe { (*process).pid };
        // SAFETY: `data` was set to the owning `*mut Process` before
        // `uv_spawn`; libuv never overwrites it. `process` is not
        // dereferenced again after this point.
        let this: &mut Process = unsafe { bun_ptr::callback_ctx::<Process>((*process).data) };
        let exit_code: u8 = if exit_status >= 0 {
            (exit_status as u64) as u8
        } else {
            0
        };
        // Zig: `if (term_signal > 0 and term_signal < @intFromEnum(SignalCode.SIGSYS))
        //   @enumFromInt(term_signal) else null` — upper-bound exclusive of SIGSYS.
        let signal_code: Option<u8> =
            if term_signal > 0 && term_signal < bun_core::SignalCode::SIGSYS as c_int {
                Some(term_signal as u8)
            } else {
                None
            };

        bun_sys::windows::libuv::log!(
            "Process.onExit({}) code: {}, signal: {:?}",
            _pid,
            exit_code,
            signal_code
        );

        if let Some(sig) = signal_code {
            this.close();
            this.on_exit(Status::Signaled(sig), &rusage);
        } else if exit_status >= 0 {
            // Zig spec compares `exit_code >= 0` (a `u8` tautology) here; the
            // intended check — per the `else` arm's comment — is on the signed
            // libuv `exit_status`, so a negative `-UV_E*` reaches the Err arm.
            this.close();
            this.on_exit(
                Status::Exited(Exited {
                    code: exit_code,
                    signal: 0,
                }),
                &rusage,
            );
        } else {
            this.on_exit(
                // libuv exit_status is negative (a `-UV_E*` code) on this arm;
                // `E::from_raw` takes the unsigned table ordinal, so route
                // through the libuv→bun errno map via the i32 ctor.
                Status::Err(bun_sys::Error::from_code_int(
                    i32::try_from(exit_status).expect("int cast"),
                    bun_sys::Tag::waitpid,
                )),
                &rusage,
            );
        }
    }

    #[cfg(windows)]
    extern "C" fn on_close_uv(uv_handle: *mut uv::uv_process_t) {
        // SAFETY: read POD `pid` first — `uv_handle` points at the inline
        // `Poller::Uv` payload inside `*this` (see `on_exit_uv`).
        let _pid = unsafe { (*uv_handle).pid };
        // SAFETY: `*mut Process` back-pointer stashed in `data` at spawn. Stay
        // raw — `ScopedRef::Drop` may free the allocation, so never bind a
        // `&mut Process` whose tag would have to outlive that.
        let this: *mut Process = unsafe { (*uv_handle).data.cast() };
        // SAFETY: adopts the +1 ref taken at `uv_spawn`.
        let _g = unsafe { bun_ptr::ScopedRef::<Process>::adopt(this) };
        bun_sys::windows::libuv::log!("Process.onClose({})", _pid);
        // SAFETY: `_g` keeps `this` live for this block.
        unsafe {
            if matches!((*this).poller, Poller::Uv(_)) {
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
            // Hoist the libuv handle state into locals so the `&self.poller`
            // borrow ends before we need `&mut self` for `ref_()` /
            // `self.poller = …`. No raw-pointer round-trip needed.
            let (closed, closing) = match &self.poller {
                Poller::Uv(process) => (process.is_closed(), process.is_closing()),
                _ => return,
            };
            if closed {
                self.poller = Poller::Detached;
            } else if !closing {
                self.ref_();
                if let Poller::Uv(process) = &mut self.poller {
                    process.close(Self::on_close_uv);
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
            match &self.poller {
                Poller::WaiterThread(_) | Poller::Fd(_) => {
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
                Poller::Uv(handle) => {
                    if let Some(err) = handle
                        .kill(c_int::from(signal))
                        .to_error(bun_sys::Tag::kill)
                    {
                        // if the process was already killed don't throw
                        if err.errno != bun_sys::E::ESRCH as u16 {
                            return Err(err);
                        }
                    }
                    return Ok(());
                }
                _ => {}
            }
        }

        Ok(())
    }
}

// PORT NOTE: not `Copy` — `bun_sys::Error` carries `Box<[u8]>` path/dest. The
// Zig `union(enum)` is copyable because its `.err` arm borrows the path; the
// Rust port owns it (see Error.rs TODO). Callers use `.clone()`.
#[derive(Clone, Default)]
pub enum Status {
    #[default]
    Running,
    Exited(Exited),
    Signaled(u8),
    Err(bun_sys::Error),
}

#[derive(Clone, Copy, Default)]
pub struct Exited {
    pub code: u8,
    /// Raw signal number. `0` means "no signal" (Zig: `enum(u8) { @"0" = 0, … }`
    /// open enum). `SignalCode` discriminants are 1..=31; storing it as the
    /// enum and transmuting `0` would be UB. Convert via `Status::signal_code`.
    pub signal: u8,
}

impl Status {
    pub fn is_ok(&self) -> bool {
        matches!(self, Status::Exited(e) if e.code == 0)
    }

    #[cfg(unix)]
    pub fn from(pid: PidT, waitpid_result: &Maybe<WaitPidResult>) -> Option<Status> {
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
                // `posix_spawn::WaitPidResult.status` is `u32` (Zig bitcasts);
                // libc's W* helpers want `c_int`.
                let status = result.status as c_int;

                if libc::WIFEXITED(status) {
                    exit_code = Some(libc::WEXITSTATUS(status) as u8);
                    // True if the process terminated due to receipt of a signal.
                }

                if libc::WIFSIGNALED(status) {
                    signal = Some(libc::WTERMSIG(status) as u8);
                } else if libc::WIFSTOPPED(status) {
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
            // Zig: `.{ .signaled = @enumFromInt(signal.?) }` — non-exhaustive enum,
            // any byte is valid. Carry the raw byte; `signal_code()` range-checks.
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

/// Local shim for `bun.SignalCode.toExitCode` (lives in `src/sys/SignalCode.zig`).
/// Upstream `bun_core::SignalCode` does not yet expose this — see SignalCode.zig:53.
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
    /// poll lives in `Store` (Zig: `*FilePoll`); freed via `FilePoll::deinit`,
    /// never via Rust `drop`.
    Fd(core::ptr::NonNull<FilePoll>),
    WaiterThread(KeepAlive),
    Detached,
}

#[cfg(unix)]
impl PollerPosix {
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

#[cfg(windows)]
pub enum PollerWindows {
    Uv(uv::uv_process_t),
    Detached,
}

#[cfg(windows)]
impl PollerWindows {
    /// Zig `PollerWindows.deinit` (process.zig:736). Not `Drop` — see
    /// `PollerPosix::deinit`.
    pub fn deinit(&mut self) {
        if let PollerWindows::Uv(p) = self {
            debug_assert!(p.is_closed());
        }
    }

    pub fn enable_keeping_event_loop_alive(&mut self, _event_loop: bun_io::EventLoopCtx) {
        match self {
            PollerWindows::Uv(process) => {
                process.ref_();
            }
            _ => {}
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, _event_loop: bun_io::EventLoopCtx) {
        match self {
            PollerWindows::Uv(p) => {
                p.unref();
            }
            _ => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            PollerWindows::Uv(p) => p.has_ref(),
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

    /// Zig: `fn NewQueue(comptime T: type) type` → generic struct.
    pub struct NewQueue<T: 'static> {
        pub queue: ConcurrentQueue<T>,
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
    /// drained on the waiter thread (`TrivialNew`/`TrivialDeinit` in Zig).
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

    pub trait ProcessLike: 'static {
        /// `jsc::Task` tag for this `T`'s `ResultTask` — Zig derived this at
        /// comptime via `TaggedPointerUnion`; Rust callers supply it.
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
                    // PERF(port): was assume_capacity
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
                                // PORT NOTE: `out` is now owned by the mini queue;
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
pub enum WindowsStdioResult {
    /// inherit, ignore, path, pipe
    Unavailable,
    Buffer(Box<uv::Pipe>),
    BufferFd(Fd),
}

#[cfg(windows)]
impl Default for WindowsStdioResult {
    fn default() -> Self {
        Self::Unavailable
    }
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
        for slot in [&mut self.stdin, &mut self.stdout, &mut self.stderr] {
            if let WindowsStdioResult::Buffer(pipe) = core::mem::take(slot) {
                // SAFETY: `pipe` is the Box-allocated `uv::Pipe` from
                // `create_zeroed_pipe`; `close_and_destroy` reclaims it via
                // `Box::from_raw` in the close callback (or immediately if
                // never init'd / `loop_ == null`).
                unsafe { uv::Pipe::close_and_destroy(Box::into_raw(pipe)) };
            }
        }
        for slot in self.extra_pipes.drain(..) {
            if let WindowsStdioResult::Buffer(pipe) = slot {
                // SAFETY: see above.
                unsafe { uv::Pipe::close_and_destroy(Box::into_raw(pipe)) };
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
            // Zig spec (process.zig:1172): `loop: jsc.EventLoopHandle = undefined`
            // — every `bun.spawnSync` call site sets it explicitly. Mirroring
            // that with a zeroed handle here keeps `..Default::default()` usable
            // for the other fields. `spawn_process_windows` (the sole consumer)
            // asserts non-null at the read site so a forgotten `loop_` panics
            // with a pointed message instead of segfaulting at the `.uv_loop`
            // field offset.
            // SAFETY: `EventLoopHandle` is a `Copy` enum of raw pointers; the
            // all-zero bit pattern is discriminant 0 with a null payload —
            // valid representation, never dereferenced before assignment.
            loop_: unsafe { bun_core::ffi::zeroed_unchecked() },
        }
    }
}

#[cfg(windows)]
pub enum WindowsStdio {
    Path(Box<[u8]>),
    Inherit,
    Ignore,
    Buffer(*mut uv::Pipe),
    /// See `Buffer` — same FFI ownership model.
    Ipc(*mut uv::Pipe),
    Pipe(Fd),
    Dup2(Dup2),
}

#[cfg(windows)]
impl WindowsStdio {
    pub fn deinit(&mut self) {
        match self {
            WindowsStdio::Buffer(pipe) | WindowsStdio::Ipc(pipe) => {
                if !pipe.is_null() {
                    // SAFETY: non-null heap allocation from create_zeroed_pipe.
                    unsafe { uv::Pipe::close_and_destroy(*pipe) };
                    *pipe = core::ptr::null_mut();
                }
            }
            _ => {}
        }
    }
}

// WindowsSpawnOptions: no Drop. `WindowsStdio` holds FFI-owned `*mut uv::Pipe`
// whose ownership is transferred to `WindowsStdioResult` on success; callers
// must invoke `WindowsSpawnOptions::deinit` explicitly on the error path (Zig spec).
#[cfg(windows)]
impl WindowsSpawnOptions {
    pub fn deinit(&mut self) {
        self.stdin.deinit();
        self.stdout.deinit();
        self.stderr.deinit();
        for stdio in self.extra_fds.iter_mut() {
            stdio.deinit();
        }
    }
}

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
        bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);

        // SAFETY: all-zero is a valid uv_process_options_t
        let mut uv_process_options: uv::uv_process_options_t =
            unsafe { bun_core::ffi::zeroed_unchecked() };

        uv_process_options.args = argv;
        uv_process_options.env = envp;
        // SAFETY: argv is null-terminated, argv[0] is non-null
        uv_process_options.file = options.argv0.unwrap_or_else(|| unsafe { *argv });
        uv_process_options.exit_cb = Some(Process::on_exit_uv);
        assert!(
            !options.windows.loop_.platform_event_loop().is_null(),
            "spawn_process_windows: WindowsSpawnOptions.windows.loop_ was not set. \
         WindowsOptions::default() leaves it zeroed (Zig spec: `= undefined`); \
         every caller must populate it — see src/CLAUDE.md §Spawning Subprocesses \
         (`.loop = jsc.EventLoopHandle.init(jsc.MiniEventLoop.initGlobal(...))`)."
        );
        // Non-null verified above; `EventLoopHandle::uv_loop` is the centralized
        // accessor for the set-once `.uv_loop` field of the `uws::WindowsLoop`.
        let loop_ = options.windows.loop_.uv_loop();

        let mut cwd_buf = bun_core::PathBuffer::uninit();
        cwd_buf[..options.cwd.len()].copy_from_slice(&options.cwd);
        cwd_buf[options.cwd.len()] = 0;
        // SAFETY: cwd_buf[options.cwd.len()] == 0 written above
        let cwd = bun_core::ZStr::from_buf(&cwd_buf[..], options.cwd.len());

        uv_process_options.cwd = if options.cwd.is_empty() {
            core::ptr::null()
        } else {
            cwd.as_ptr().cast::<c_char>()
        };

        let mut uv_files_to_close: Vec<uv::uv_file> = Vec::new();

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

        let mut stdio_containers: Vec<uv::uv_stdio_container_t> =
            Vec::with_capacity(3 + options.extra_fds.len());
        // SAFETY: all-zero is valid uv_stdio_container_t
        stdio_containers.resize_with(3 + options.extra_fds.len(), || unsafe {
            bun_core::ffi::zeroed_unchecked()
        });

        let stdio_options: [&WindowsStdio; 3] = [&options.stdin, &options.stdout, &options.stderr];

        let mut dup_fds: [uv::uv_file; 2] = [-1, -1];
        let mut dup_src: Option<u32> = None;
        let mut dup_tgt: Option<u32> = None;

        // PORT NOTE: Zig uses `inline for (0..3)` for comptime fd_i; we use a runtime loop.
        // PERF(port): was comptime monomorphization — profile if it shows up on a hot path.
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
                dup_tgt = Some(u32::try_from(fd_i).expect("int cast"));
            } else if fd_i == 2 && matches!(stdio_options[1], WindowsStdio::Dup2(_)) {
                treat_as_dup = true;
                dup_tgt = Some(u32::try_from(fd_i).expect("int cast"));
            } else {
                match stdio_options[fd_i] {
                    WindowsStdio::Dup2(_) => {
                        treat_as_dup = true;
                        dup_src = Some(u32::try_from(fd_i).expect("int cast"));
                    }
                    WindowsStdio::Inherit => {
                        stdio.flags = uv::UV_INHERIT_FD;
                        stdio.data.fd = uv::uv_file::try_from(fd_i).expect("int cast");
                    }
                    WindowsStdio::Ipc(_) => {
                        // ipc option inside stdin, stderr or stdout is not supported.
                        // Don't free the pipe here — the caller owns it and will
                        // clean it up via WindowsSpawnOptions Drop.
                        stdio.flags = uv::UV_IGNORE;
                    }
                    WindowsStdio::Ignore => {
                        stdio.flags = uv::UV_IGNORE;
                    }
                    WindowsStdio::Path(path) => {
                        let mut req = uv::fs_t::uninitialized();
                        let path_z = match bun_sys::to_posix_path(path) {
                            Ok(p) => p,
                            Err(e) => {
                                cleanup_uv_files(&uv_files_to_close, loop_);
                                return Err(e);
                            }
                        };
                        // SAFETY: `req` is a fresh `fs_t`, `loop_` is the live uv
                        // loop, `path_z` is NUL-terminated and outlives the call
                        // (sync — no callback).
                        let rc = unsafe {
                            uv::uv_fs_open(
                                loop_,
                                &mut req,
                                path_z.as_ptr(),
                                flag | uv::O::CREAT,
                                0o644,
                                None,
                            )
                        };
                        req.deinit();
                        if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                            cleanup_uv_files(&uv_files_to_close, loop_);
                            return Ok(Err(err));
                        }
                        stdio.flags = uv::UV_INHERIT_FD;
                        let fd = rc.int();
                        uv_files_to_close.push(fd);
                        stdio.data.fd = fd;
                    }
                    WindowsStdio::Buffer(my_pipe) => {
                        // SAFETY: `my_pipe` is a non-null heap allocation from
                        // create_zeroed_pipe (heap::alloc).
                        if let Some(err) = unsafe { (&mut **my_pipe).init(loop_, false) }
                            .to_error(bun_sys::Tag::uv_pipe)
                        {
                            cleanup_uv_files(&uv_files_to_close, loop_);
                            return Ok(Err(err));
                        }
                        stdio.flags = pipe_flags;
                        stdio.data.stream = (*my_pipe).cast::<uv::uv_stream_t>();
                    }
                    WindowsStdio::Pipe(fd) => {
                        stdio.flags = uv::UV_INHERIT_FD;
                        stdio.data.fd = fd.uv();
                    }
                }
            }

            if treat_as_dup {
                if fd_i == 1 {
                    // SAFETY: `dup_fds` is a 2-element out-array; libuv writes both.
                    // `from_uv_rc` sets `from_libuv` so display goes through the
                    // checked uv→errno translator (raw codes are sparse on Windows;
                    // an unchecked `E::from_raw` would be UB for unmapped values).
                    if let Some(err) = bun_sys::Error::from_uv_rc(
                        unsafe { uv::uv_pipe(&mut dup_fds, 0, 0) },
                        bun_sys::Tag::pipe,
                    ) {
                        cleanup_uv_files(&uv_files_to_close, loop_);
                        return Ok(Err(err));
                    }
                }
                stdio.flags = uv::UV_INHERIT_FD;
                stdio.data.fd = dup_fds[1];
            }
        }

        for (i, ipc) in options.extra_fds.iter().enumerate() {
            let stdio: &mut uv::uv_stdio_container_t = &mut stdio_containers[3 + i];
            let flag: c_int = uv::O::RDWR;

            match ipc {
                WindowsStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
                WindowsStdio::Inherit => {
                    stdio.flags = uv::StdioFlags::INHERIT_FD;
                    stdio.data.fd = uv::uv_file::try_from(3 + i).expect("int cast");
                }
                WindowsStdio::Ignore => {
                    stdio.flags = uv::UV_IGNORE;
                }
                WindowsStdio::Path(path) => {
                    let mut req = uv::fs_t::uninitialized();
                    // See stdio loop above: manual cleanup on every exit path.
                    let path_z = match bun_sys::to_posix_path(path) {
                        Ok(p) => p,
                        Err(e) => {
                            cleanup_uv_files(&uv_files_to_close, loop_);
                            return Err(e);
                        }
                    };
                    // SAFETY: `req` is a fresh `fs_t`, `loop_` is the live uv loop,
                    // `path_z` is NUL-terminated and outlives the call (sync).
                    let rc = unsafe {
                        uv::uv_fs_open(
                            loop_,
                            &mut req,
                            path_z.as_ptr(),
                            flag | uv::O::CREAT,
                            0o644,
                            None,
                        )
                    };
                    req.deinit();
                    if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                        cleanup_uv_files(&uv_files_to_close, loop_);
                        return Ok(Err(err));
                    }
                    stdio.flags = uv::StdioFlags::INHERIT_FD;
                    let fd = rc.int();
                    uv_files_to_close.push(fd);
                    stdio.data.fd = fd;
                }
                WindowsStdio::Ipc(my_pipe) => {
                    // SAFETY: non-null heap allocation from create_zeroed_pipe.
                    if let Some(err) = unsafe { (&mut **my_pipe).init(loop_, true) }
                        .to_error(bun_sys::Tag::uv_pipe)
                    {
                        cleanup_uv_files(&uv_files_to_close, loop_);
                        return Ok(Err(err));
                    }
                    stdio.flags = uv::UV_CREATE_PIPE
                        | uv::UV_WRITABLE_PIPE
                        | uv::UV_READABLE_PIPE
                        | uv::UV_OVERLAPPED_PIPE;
                    stdio.data.stream = (*my_pipe).cast::<uv::uv_stream_t>();
                }
                WindowsStdio::Buffer(my_pipe) => {
                    // SAFETY: non-null heap allocation from create_zeroed_pipe.
                    if let Some(err) = unsafe { (&mut **my_pipe).init(loop_, false) }
                        .to_error(bun_sys::Tag::uv_pipe)
                    {
                        cleanup_uv_files(&uv_files_to_close, loop_);
                        return Ok(Err(err));
                    }
                    stdio.flags = uv::UV_CREATE_PIPE
                        | uv::UV_WRITABLE_PIPE
                        | uv::UV_READABLE_PIPE
                        | uv::UV_OVERLAPPED_PIPE;
                    stdio.data.stream = (*my_pipe).cast::<uv::uv_stream_t>();
                }
                WindowsStdio::Pipe(fd) => {
                    stdio.flags = uv::StdioFlags::INHERIT_FD;
                    stdio.data.fd = fd.uv();
                }
            }
        }

        uv_process_options.stdio = stdio_containers.as_mut_ptr();
        uv_process_options.stdio_count = c_int::try_from(stdio_containers.len()).expect("int cast");
        uv_process_options.exit_cb = Some(Process::on_exit_uv);

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

        // defer if failed: process.close(); process.deref(); — handled at error sites

        // SAFETY: process is freshly allocated
        unsafe {
            // SAFETY: all-zero is valid uv::Process
            (*process).poller = Poller::Uv(bun_core::ffi::zeroed_unchecked());
            // Back-pointer for `on_exit_uv` / `on_close_uv` (replaces Zig
            // `@fieldParentPtr`, which has no sound Rust equivalent for default-repr
            // enum variant payloads). Every libuv handle starts with `data: *mut c_void`.
            let Poller::Uv(ref mut uv_proc) = (*process).poller else {
                unreachable!()
            };
            uv_proc.data = process.cast::<c_void>();
        }

        // defer dup_fds cleanup — handled below at each exit
        let cleanup_dup = |failed: bool| {
            if dup_src.is_some() {
                if cfg!(debug_assertions) {
                    debug_assert!(dup_src.is_some() && dup_tgt.is_some());
                }
            }
            if failed && dup_fds[0] != -1 {
                Fd::from_uv(dup_fds[0]).close();
            }
            if dup_fds[1] != -1 {
                Fd::from_uv(dup_fds[1]).close();
            }
        };

        // SAFETY: process.poller was just set to Uv variant
        let spawn_err = unsafe {
            let Poller::Uv(ref mut uv_proc) = (*process).poller else {
                unreachable!()
            };
            uv_proc
                .spawn(loop_, &mut uv_process_options)
                .to_error(bun_sys::Tag::uv_spawn)
        };
        if let Some(err) = spawn_err {
            cleanup_dup(true);
            cleanup_uv_files(&uv_files_to_close, loop_);
            // SAFETY: process is valid
            unsafe {
                (*process).close();
                Process::deref(process);
            }
            return Ok(Err(err));
        }

        // SAFETY: process is valid, poller is Uv
        unsafe {
            let Poller::Uv(ref uv_proc) = (*process).poller else {
                unreachable!()
            };
            (*process).pid = uv_proc.pid;
            // Function pointers compared by address (`as usize`): direct
            // `fn == fn` is unreliable across codegen units and triggers
            // `unpredictable_function_pointer_comparisons`.
            debug_assert_eq!(
                uv_proc.exit_cb.map(|cb| cb as usize),
                Some(
                    Process::on_exit_uv as unsafe extern "C" fn(*mut uv::uv_process_t, i64, c_int)
                        as usize,
                ),
            );
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

        for i in 0..3usize {
            let stdio = &stdio_containers[i];
            let result_stdio: &mut WindowsStdioResult = match i {
                0 => &mut result.stdin,
                1 => &mut result.stdout,
                2 => &mut result.stderr,
                _ => unreachable!(),
            };

            if dup_src == Some(u32::try_from(i).expect("int cast")) {
                *result_stdio = WindowsStdioResult::Unavailable;
            } else if dup_tgt == Some(u32::try_from(i).expect("int cast")) {
                *result_stdio = WindowsStdioResult::BufferFd(Fd::from_uv(dup_fds[0]));
            } else {
                match stdio_options[i] {
                    WindowsStdio::Buffer(_) => {
                        // SAFETY: stdio.data.stream is the same `*mut uv::Pipe`
                        // produced by `heap::alloc` in create_zeroed_pipe and
                        // stored in `options.{stdin,stdout,stderr}`. `WindowsStdio`
                        // has no `Drop` (deinit is explicit, Zig spec), so
                        // reconstructing the Box here is the *sole* ownership
                        // transfer — the borrowed `options` dropping later is a
                        // no-op on the raw pointer.
                        *result_stdio = WindowsStdioResult::Buffer(unsafe {
                            bun_core::heap::take(stdio.data.stream.cast::<uv::Pipe>())
                        });
                    }
                    _ => {
                        *result_stdio = WindowsStdioResult::Unavailable;
                    }
                }
            }
        }

        for (i, input) in options.extra_fds.iter().enumerate() {
            match input {
                WindowsStdio::Ipc(_) | WindowsStdio::Buffer(_) => {
                    // PERF(port): was assume_capacity
                    // SAFETY: sole ownership transfer of the heap-allocated
                    // uv::Pipe; `WindowsStdio` has no Drop (explicit `deinit`).
                    result.extra_pipes.push(WindowsStdioResult::Buffer(unsafe {
                        bun_core::heap::take(stdio_containers[3 + i].data.stream.cast::<uv::Pipe>())
                    }));
                }
                _ => {
                    result.extra_pipes.push(WindowsStdioResult::Unavailable);
                }
            }
        }

        cleanup_dup(false);
        cleanup_uv_files(&uv_files_to_close, loop_);
        Ok(Ok(result))
    }

    #[cfg(windows)]
    fn cleanup_uv_files(files: &[uv::uv_file], loop_: *mut uv::uv_loop_t) {
        for &fd in files {
            bun_io::Closer::close(Fd::from_uv(fd), loop_);
        }
    }

    pub mod sync {
        use super::*;
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
                    SyncStdio::Inherit => SpawnOptionsStdio::inherit(),
                    SyncStdio::Ignore => SpawnOptionsStdio::ignore(),
                    SyncStdio::Buffer => {
                        #[cfg(windows)]
                        {
                            SpawnOptionsStdio::buffer(bun_core::heap::into_raw(Box::new(
                                bun_core::ffi::zeroed::<uv::Pipe>(),
                            )))
                        }
                        #[cfg(not(windows))]
                        {
                            SpawnOptionsStdio::buffer()
                        }
                    }
                }
            }
        }

        // Helper alias: SpawnOptions::Stdio differs by platform
        #[cfg(unix)]
        pub type SpawnOptionsStdio = PosixStdio;
        #[cfg(windows)]
        pub type SpawnOptionsStdio = WindowsStdio;

        // PosixStdio constructor helpers live in `bun_spawn_sys` (inherent impl).
        #[cfg(windows)]
        impl WindowsStdio {
            fn inherit() -> Self {
                WindowsStdio::Inherit
            }
            fn ignore() -> Self {
                WindowsStdio::Ignore
            }
            fn buffer(p: *mut uv::Pipe) -> Self {
                WindowsStdio::Buffer(p)
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
                    windows: self.windows.clone(),
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

        #[cfg(windows)]
        pub struct SyncWindowsPipeReader {
            pub chunks: Vec<Box<[u8]>>,
            /// Buffer handed to libuv by `on_alloc`; reclaimed (truncated) by
            /// `on_read`. Prevents the per-read leak that copying `data` into a
            /// fresh Box would cause (Zig pushes the *same* allocation).
            pending_alloc: Option<Box<[u8]>>,
            pub pipe: Box<uv::Pipe>,
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
                // SAFETY: this is valid until we destroy it below
                let this_ref = unsafe { &mut *this };
                let context = this_ref.context;
                let chunks: Vec<Box<[u8]>> = core::mem::take(&mut this_ref.chunks);
                let err = if this_ref.err == bun_sys::E::CANCELED {
                    bun_sys::E::SUCCESS
                } else {
                    this_ref.err
                };
                let tag = this_ref.tag;
                let on_done_callback = this_ref.on_done_callback;
                // bun.default_allocator.destroy(this)
                // SAFETY: this was heap-allocated in start(); reclaim and drop
                drop(unsafe { bun_core::heap::take(this) });
                on_done_callback(context, tag, chunks, err);
            }

            pub fn start(self: Box<Self>) -> Maybe<()> {
                let this: *mut SyncWindowsPipeReader = bun_core::heap::into_raw(self);
                // SAFETY: just allocated; sole owner.
                unsafe {
                    (*this).pipe.set_data(this.cast());
                    (*this).pipe.ref_();
                    if let Some(err) = (*this)
                        .pipe
                        .read_start(Some(Self::uv_alloc_cb), Some(Self::uv_read_cb))
                        .to_error(bun_sys::Tag::listen)
                    {
                        return Err(err);
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
            pub process: *mut Process,
            pub status: Option<Status>,
        }

        #[cfg(windows)]
        impl SyncWindowsProcess {
            pub fn new(v: SyncWindowsProcess) -> Box<Self> {
                Box::new(v)
            }

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

        #[cfg(windows)]
        fn spawn_windows_without_pipes(
            options: &Options,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
            let loop_ = options.windows.loop_.platform_event_loop();
            let mut spawned =
                match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
                    Err(err) => return Ok(Err(err)),
                    Ok(proces) => proces,
                };

            // `*mut Process` — intrusive refcount (heap::alloc in to_process).
            let process: *mut Process = spawned.to_process((), true);
            let _detach_guard = scopeguard::guard(process, |process| {
                // SAFETY: sole owner during sync spawn; loop has drained, so no
                // uv callback holds a competing `&mut Process`. Mirrors Zig defer
                // `{ process.detach(); process.deref(); }`.
                unsafe {
                    (*process).detach();
                    Process::deref(process);
                }
            });
            // SAFETY: just allocated; no other borrow live yet.
            unsafe {
                (*process).enable_keeping_event_loop_alive();
            }

            // SAFETY: read-only field access between uv ticks; the uv exit
            // callback's `&mut Process` does not overlap this `&Process`.
            while !unsafe { (*process).has_exited() } {
                // SAFETY: `loop_` is the live `uws::WindowsLoop*` from
                // `EventLoopHandle::platform_event_loop`.
                unsafe { (*loop_).run() };
            }

            Ok(Ok(Result {
                // SAFETY: process has exited; no further mutation.
                status: unsafe { (*process).status.clone() },
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
            let loop_: EventLoopHandle = options.windows.loop_;
            let mut spawned =
                match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
                    Err(err) => return Ok(Err(err)),
                    Ok(process) => process,
                };
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
            // owner, mutable provenance from heap::alloc). Mirrors Zig:
            // `this.process.ref(); this.process.setExitHandler(this);
            //  this.process.enableKeepingEventLoopAlive();`
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
                let taken = core::mem::replace(stdio, WindowsStdioResult::Unavailable);
                if let WindowsStdioResult::Buffer(pipe) = taken {
                    let reader = SyncWindowsPipeReader::new(SyncWindowsPipeReader {
                        context: this_ptr,
                        tag,
                        pipe,
                        chunks: Vec::new(),
                        pending_alloc: None,
                        err: bun_sys::E::SUCCESS,
                        on_done_callback: SyncWindowsProcess::on_reader_done,
                    });
                    // SAFETY: sole owner via `this_ptr`; no uv callback has fired yet.
                    unsafe {
                        (*this_ptr).waiting_count += 1;
                    }
                    // `start` consumes the Box and transfers ownership to libuv
                    // via pipe.data (heap::alloc inside).
                    match reader.start() {
                        Err(err) => {
                            // SAFETY: sync spawn — `(*this_ptr).process` is the only
                            // handle and no uv callback has fired yet.
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

            // SAFETY: read-only field access between uv ticks; callbacks fired
            // inside `tick()` write through the same `this_ptr` root.
            while unsafe { (*this_ptr).waiting_count } > 0 {
                // SAFETY: `loop_` wraps a live `uws::WindowsLoop*`.
                unsafe { (*loop_.platform_event_loop()).tick() };
            }

            // SAFETY: loop drained (waiting_count == 0); no further uv callback
            // will touch `this_ptr`.
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
            // SAFETY: drop the ref taken above, then reclaim the SyncWindowsProcess
            // allocation. Mirrors Zig `this.process.deref(); destroy(this);`.
            unsafe {
                Process::deref((*this_ptr).process);
                drop(bun_core::heap::take(this_ptr));
            }
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
            // [*:null]?[*:0]const u8
            // SAFETY: std.c.environ is the C environ array
            let envp: *const *const c_char = options.envp.unwrap_or_else(bun_sys::environ_ptr);
            let argv = &options.argv;
            let mut string_builder = bun_core::StringBuilder::default();
            for arg in argv {
                string_builder.count_z(arg);
            }
            string_builder.allocate()?;

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
            let no_orphans = ParentDeathWatchdog::is_enabled()
                && bun_spawn_sys::pdeathsig::is_arming_thread()
                && !(cfg!(target_os = "macos") && options.use_execve_on_macos);

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
                    ParentDeathWatchdog::kill_subreaper_adoptees(siblings);
                    // SAFETY: prctl
                    let _ = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 0) };
                }
            }

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
                jc.give(process.pid);
                #[cfg(target_os = "macos")]
                if no_orphans_kq.fd() != Fd::INVALID {
                    Bun__noOrphans_begin(no_orphans_kq.fd().native(), process.pid);
                }
            }
            let _jc = scopeguard::guard(jc, move |mut jc| {
                if no_orphans {
                    jc.restore();
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
            // TODO(refactor): errdefer — the above scopeguards capture `jc`/`no_orphans_kq`/
            // `siblings` by reference while still mutated below. Restructure into a single
            // RAII state struct (or run cleanup inline at each return).

            Bun__sendPendingSignalIfNecessary();

            let mut out: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
            let mut out_fds: [Fd; 2] = [
                process.stdout.unwrap_or(Fd::INVALID),
                process.stderr.unwrap_or(Fd::INVALID),
            ];
            let mut success = false;
            // defer cleanup — handled at end / via guards below
            // TODO(port): errdefer — manual cleanup at each error return below

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
            add(
                &mut changes_buf,
                &mut changes_len,
                usize::try_from(child).expect("int cast"),
                libc::EVFILT_PROC,
                libc::NOTE_FORK | libc::NOTE_EXIT,
                0,
            );
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
                    if r.data == libc::ESRCH as isize {
                        Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                    }
                    continue;
                }
                Bun__noOrphans_onExit(child);
                return None;
            }
            if ppid > 1 && getppid() != ppid {
                Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
            }
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
                if saw_fork {
                    Bun__noOrphans_onFork();
                }
                if child_exited {
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
                // TODO(port): kernel sigset_t vs libc sigset_t — Zig uses
                // std.os.linux.sigemptyset/sigaddset for the signalfd mask. Could
                // use the raw syscall with a u64 mask instead.
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

// ported from: src/runtime/api/bun/process.zig
