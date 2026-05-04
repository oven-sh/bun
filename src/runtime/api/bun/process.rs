use core::ffi::{c_char, c_int, c_void};
use core::mem::offset_of;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::{FilePoll, KeepAlive};
use bun_collections::{TaggedPtrUnion, UnboundedQueue};
use bun_core::{Environment, Global, Output, ParentDeathWatchdog};
use bun_jsc::{self as jsc, EventLoopHandle, Subprocess};
use bun_ptr::IntrusiveArc;
use bun_sys::{self, Fd, Maybe};
use bun_sys::windows::libuv as uv;

// TODO(port): exact crate paths for these cross-crate handler types
use bun_cli::filter_run::ProcessHandle;
use bun_cli::multi_run::ProcessHandle as MultiRunProcessHandle;
use bun_cli::test::parallel_runner::Worker as TestWorkerHandle;
use bun_runtime::api::cron::{CronRegisterJob, CronRemoveJob};
use bun_runtime::api::{ChromeProcess, WebViewHostProcess};
use bun_install::{LifecycleScriptSubprocess, SecurityScanSubprocess};
use bun_shell::ShellSubprocess;

// TODO(port): `bun.spawn` (PosixSpawn) crate path
use bun_spawn as posix_spawn;
use posix_spawn::{Actions as PosixSpawnActions, Attr as PosixSpawnAttr, WaitPidResult};

bun_output::declare_scope!(PROCESS, visible);

#[cfg(unix)]
pub type PidT = libc::pid_t;
#[cfg(not(unix))]
pub type PidT = uv::uv_pid_t;

#[cfg(unix)]
pub type FdT = libc::c_int;
#[cfg(not(unix))]
pub type FdT = i32;

#[derive(Default, Clone, Copy)]
pub struct WinTimeval {
    pub sec: i64,
    pub usec: i64,
}

#[derive(Default, Clone, Copy)]
pub struct WinRusage {
    pub utime: WinTimeval,
    pub stime: WinTimeval,
    pub maxrss: u64,
    // ixrss, idrss, isrss, minflt, majflt, nswap: u0 in Zig — zero-sized, omitted
    pub inblock: u64,
    pub oublock: u64,
    // msgsnd, msgrcv, nsignals, nvcsw, nivcsw: u0 in Zig — zero-sized, omitted
}

#[repr(C)]
#[derive(Default)]
pub struct IoCounters {
    pub ReadOperationCount: u64,
    pub WriteOperationCount: u64,
    pub OtherOperationCount: u64,
    pub ReadTransferCount: u64,
    pub WriteTransferCount: u64,
    pub OtherTransferCount: u64,
}

#[cfg(windows)]
unsafe extern "system" {
    // TODO(port): move to runtime_sys
    fn GetProcessIoCounters(handle: bun_sys::windows::HANDLE, counters: *mut IoCounters) -> c_int;
}

#[cfg(windows)]
pub fn uv_getrusage(process: &mut uv::uv_process_t) -> WinRusage {
    let mut usage_info = Rusage::default();
    let process_pid: *mut c_void = process.process_handle;
    type WinTime = bun_sys::windows::FILETIME;
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut starttime: WinTime = unsafe { core::mem::zeroed() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut exittime: WinTime = unsafe { core::mem::zeroed() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut kerneltime: WinTime = unsafe { core::mem::zeroed() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut usertime: WinTime = unsafe { core::mem::zeroed() };
    // We at least get process times
    // SAFETY: FFI call with valid out-pointers
    if unsafe {
        bun_sys::windows::GetProcessTimes(
            process_pid,
            &mut starttime,
            &mut exittime,
            &mut kerneltime,
            &mut usertime,
        )
    } == 1
    {
        let mut temp: u64 = ((kerneltime.dwHighDateTime as u64) << 32) | kerneltime.dwLowDateTime as u64;
        if temp > 0 {
            usage_info.stime.sec = i64::try_from(temp / 10_000_000).unwrap();
            usage_info.stime.usec = i64::try_from(temp % 1_000_000).unwrap();
        }
        temp = ((usertime.dwHighDateTime as u64) << 32) | usertime.dwLowDateTime as u64;
        if temp > 0 {
            usage_info.utime.sec = i64::try_from(temp / 10_000_000).unwrap();
            usage_info.utime.usec = i64::try_from(temp % 1_000_000).unwrap();
        }
    }
    let mut counters = IoCounters::default();
    // SAFETY: FFI call with valid out-pointer
    let _ = unsafe { GetProcessIoCounters(process_pid, &mut counters) };
    usage_info.inblock = counters.ReadOperationCount;
    usage_info.oublock = counters.WriteOperationCount;

    let Ok(memory) = bun_sys::windows::GetProcessMemoryInfo(process_pid) else {
        return usage_info;
    };
    usage_info.maxrss = memory.PeakWorkingSetSize / 1024;

    usage_info
}

#[cfg(windows)]
pub type Rusage = WinRusage;
// std.posix.rusage has no .freebsd arm; field names also differ
// (ru_* instead of bare). Define a layout-compatible struct so
// ResourceUsage can use the same field names everywhere.
#[cfg(target_os = "freebsd")]
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Rusage {
    pub utime: libc::timeval,
    pub stime: libc::timeval,
    pub maxrss: isize,
    pub ixrss: isize,
    pub idrss: isize,
    pub isrss: isize,
    pub minflt: isize,
    pub majflt: isize,
    pub nswap: isize,
    pub inblock: isize,
    pub oublock: isize,
    pub msgsnd: isize,
    pub msgrcv: isize,
    pub nsignals: isize,
    pub nvcsw: isize,
    pub nivcsw: isize,
}
#[cfg(all(unix, not(target_os = "freebsd")))]
pub type Rusage = libc::rusage;

// TODO(port): provide a uniform `Rusage::zeroed()` helper across cfgs
#[inline]
fn rusage_zeroed() -> Rusage {
    // SAFETY: all-zero is a valid Rusage on every platform (POD C struct / Default-able WinRusage)
    unsafe { core::mem::zeroed() }
}

// const ShellSubprocessMini = bun.shell.ShellSubprocessMini;
pub struct ProcessExitHandler {
    pub ptr: ExitHandlerTaggedPointer,
}

impl Default for ProcessExitHandler {
    fn default() -> Self {
        Self { ptr: ExitHandlerTaggedPointer::NULL }
    }
}

#[cfg(windows)]
type SyncProcess = sync::SyncWindowsProcess;
#[cfg(not(windows))]
#[repr(C)]
pub struct SyncProcessPosix {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
#[cfg(not(windows))]
type SyncProcess = SyncProcessPosix;

pub type ExitHandlerTaggedPointer = TaggedPtrUnion<(
    Subprocess,
    LifecycleScriptSubprocess,
    ShellSubprocess,
    ProcessHandle,
    MultiRunProcessHandle,
    TestWorkerHandle,
    SecurityScanSubprocess,
    WebViewHostProcess,
    ChromeProcess,
    SyncProcess,
    CronRegisterJob,
    CronRemoveJob,
)>;

impl ProcessExitHandler {
    // TODO(port): `anytype` — accept any of the union member pointer types
    pub fn init<T>(&mut self, ptr: *mut T) {
        self.ptr = ExitHandlerTaggedPointer::init(ptr);
    }

    pub fn call(&self, process: &mut Process, status: Status, rusage: &Rusage) {
        if self.ptr.is_null() {
            return;
        }

        // TODO(port): TaggedPtrUnion tag dispatch API — using as_mut::<T>() per type
        match self.ptr.tag() {
            t if t == ExitHandlerTaggedPointer::tag_of::<Subprocess>() => {
                let subprocess = self.ptr.as_mut::<Subprocess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<LifecycleScriptSubprocess>() => {
                let subprocess = self.ptr.as_mut::<LifecycleScriptSubprocess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<ProcessHandle>() => {
                let subprocess = self.ptr.as_mut::<ProcessHandle>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<MultiRunProcessHandle>() => {
                let subprocess = self.ptr.as_mut::<MultiRunProcessHandle>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<TestWorkerHandle>() => {
                let subprocess = self.ptr.as_mut::<TestWorkerHandle>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<ShellSubprocess>() => {
                let subprocess = self.ptr.as_mut::<ShellSubprocess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<SecurityScanSubprocess>() => {
                let subprocess = self.ptr.as_mut::<SecurityScanSubprocess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<WebViewHostProcess>() => {
                let subprocess = self.ptr.as_mut::<WebViewHostProcess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<ChromeProcess>() => {
                let subprocess = self.ptr.as_mut::<ChromeProcess>();
                subprocess.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<CronRegisterJob>() => {
                let cron_job = self.ptr.as_mut::<CronRegisterJob>();
                cron_job.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<CronRemoveJob>() => {
                let cron_job = self.ptr.as_mut::<CronRemoveJob>();
                cron_job.on_process_exit(process, status, rusage);
            }
            t if t == ExitHandlerTaggedPointer::tag_of::<SyncProcess>() => {
                let subprocess = self.ptr.as_mut::<SyncProcess>();
                #[cfg(unix)]
                {
                    let _ = subprocess;
                    panic!("This code should not reached");
                }
                #[cfg(not(unix))]
                subprocess.on_process_exit(status, rusage);
            }
            _ => {
                panic!("Internal Bun error: ProcessExitHandler has an invalid tag. Please file a bug report.");
            }
        }
    }
}

#[cfg(target_os = "linux")]
pub type PidFdType = FdT;
#[cfg(not(target_os = "linux"))]
pub type PidFdType = (); // u0 in Zig

pub struct Process {
    pub pid: PidT,
    pub pidfd: PidFdType,
    pub status: Status,
    pub poller: Poller,
    pub ref_count: AtomicU32, // bun.ptr.ThreadSafeRefCount → IntrusiveArc<Process>
    pub exit_handler: ProcessExitHandler,
    pub sync: bool,
    pub event_loop: EventLoopHandle,
}

// bun.ptr.ThreadSafeRefCount → IntrusiveArc<Process>
// TODO(port): wire IntrusiveArc<Process> ref/deref via bun_ptr; deinit() is the drop callback
impl Process {
    pub fn ref_(&self) {
        IntrusiveArc::<Process>::ref_(self);
    }
    pub fn deref(&self) {
        IntrusiveArc::<Process>::deref(self);
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    pub fn set_exit_handler<T>(&mut self, handler: *mut T) {
        self.exit_handler.init(handler);
    }

    #[cfg(windows)]
    pub fn update_status_on_windows(&mut self) {
        if let Poller::Uv(uv_proc) = &self.poller {
            if !uv_proc.is_active() && matches!(self.status, Status::Running) {
                Self::on_exit_uv(&mut self.poller_uv_mut_unchecked(), 0, 0);
                // TODO(port): re-express on_exit_uv invocation; see below
            }
        }
        // PORT NOTE: reshaped for borrowck — Zig calls onExitUV(&this.poller.uv, 0, 0)
        // which uses @fieldParentPtr to recover `self`. In Rust we keep the
        // extern "C" callback signature but here just call it via raw pointer.
    }

    #[cfg(unix)]
    pub fn init_posix(
        posix: PosixSpawnResult,
        event_loop: impl Into<EventLoopHandle>,
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
        // bun.new → Box::into_raw (pointer crosses FFI / intrusive refcount)
        Box::into_raw(Box::new(Process {
            ref_count: AtomicU32::new(1),
            pid: posix.pid,
            #[cfg(target_os = "linux")]
            pidfd: posix.pidfd.unwrap_or(0),
            #[cfg(not(target_os = "linux"))]
            pidfd: (),
            event_loop: EventLoopHandle::init(event_loop),
            sync: sync_,
            poller: Poller::Detached,
            status,
            exit_handler: ProcessExitHandler::default(),
        }))
    }

    pub fn has_exited(&self) -> bool {
        matches!(self.status, Status::Exited(_) | Status::Signaled(_) | Status::Err(_))
    }

    pub fn has_killed(&self) -> bool {
        matches!(self.status, Status::Exited(_) | Status::Signaled(_))
    }

    pub fn on_exit(&mut self, status: Status, rusage: &Rusage) {
        let exit_handler = core::mem::take(&mut self.exit_handler);
        // PORT NOTE: Zig copies exit_handler by value then assigns status; we take()
        // because detach() resets it anyway. Restore if not exited.
        self.status = status;

        let exited = self.has_exited();
        if exited {
            self.detach();
        } else {
            // restore handler (Zig left it in place)
            // TODO(port): ProcessExitHandler is Copy in Zig; make it Copy in Rust too
        }
        // PORT NOTE: reshaped for borrowck — Zig keeps exit_handler in self while calling
        self.exit_handler = exit_handler;
        let handler_copy = ProcessExitHandler { ptr: self.exit_handler.ptr };
        if exited {
            self.exit_handler = ProcessExitHandler::default();
        }
        handler_copy.call(self, status, rusage);
    }
    // TODO(port): the above on_exit reshaping is ugly; in Phase B make
    // ProcessExitHandler #[derive(Copy)] and mirror Zig exactly:
    //   let exit_handler = self.exit_handler; self.status = status;
    //   if self.has_exited() { self.detach(); }
    //   exit_handler.call(self, status, rusage);

    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        self.status.signal_code()
    }

    #[cfg(unix)]
    pub fn wait_posix(&mut self, sync_: bool) {
        let mut rusage = rusage_zeroed();
        let waitpid_result =
            posix_spawn::wait4(self.pid, if sync_ { 0 } else { libc::WNOHANG }, Some(&mut rusage));
        self.on_wait_pid(&waitpid_result, &rusage);
    }

    pub fn wait(&mut self, sync_: bool) {
        #[cfg(unix)]
        self.wait_posix(sync_);
        #[cfg(windows)]
        let _ = sync_;
    }

    #[cfg(unix)]
    pub fn on_wait_pid_from_waiter_thread(
        &mut self,
        waitpid_result: &bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) {
        if let Poller::WaiterThread(waiter) = &mut self.poller {
            waiter.unref(self.event_loop);
            self.poller = Poller::Detached;
        }
        self.on_wait_pid(waitpid_result, rusage);
        self.deref();
    }

    #[cfg(unix)]
    pub fn on_wait_pid_from_event_loop_task(&mut self) {
        self.wait(false);
        self.deref();
    }

    #[cfg(unix)]
    fn on_wait_pid(&mut self, waitpid_result: &bun_sys::Result<WaitPidResult>, rusage: &Rusage) {
        let pid = self.pid;
        let mut rusage_result = *rusage;

        let status: Option<Status> = Status::from(pid, waitpid_result).or_else(|| 'brk: {
            match self.rewatch_posix() {
                Maybe::Result(()) => {}
                Maybe::Err(err_) => {
                    #[cfg(target_os = "macos")]
                    if err_.get_errno() == bun_sys::E::SRCH {
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
            self.on_exit(self.status, &zeroed);
            return Maybe::Result(true);
        }

        match self.watch() {
            Maybe::Err(err) => {
                #[cfg(unix)]
                if err.get_errno() == bun_sys::E::SRCH {
                    self.wait(true);
                    return Maybe::Result(self.has_exited());
                }
                Maybe::Err(err)
            }
            Maybe::Result(()) => Maybe::Result(self.has_exited()),
        }
    }

    pub fn watch(&mut self) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            if let Poller::Uv(p) = &mut self.poller {
                p.ref_();
            }
            return Maybe::SUCCESS;
        }

        #[cfg(unix)]
        {
            if WaiterThread::should_use_waiter_thread() {
                self.poller = Poller::WaiterThread(KeepAlive::default());
                if let Poller::WaiterThread(w) = &mut self.poller {
                    w.ref_(self.event_loop);
                }
                self.ref_();
                WaiterThread::append(self);
                return Maybe::SUCCESS;
            }

            #[cfg(target_os = "linux")]
            let watchfd = self.pidfd;
            #[cfg(not(target_os = "linux"))]
            let watchfd = self.pid;

            let poll = if let Poller::Fd(fd) = &mut self.poller {
                // already have a poll
                // PORT NOTE: reshaped for borrowck — take existing Box out
                core::mem::replace(&mut self.poller, Poller::Detached)
                    .into_fd()
                    .unwrap()
            } else {
                FilePoll::init(
                    self.event_loop,
                    Fd::from_native(watchfd),
                    Default::default(),
                    self as *mut Process,
                )
            };

            self.poller = Poller::Fd(poll);
            let Poller::Fd(fd) = &mut self.poller else { unreachable!() };
            fd.enable_keeping_process_alive(self.event_loop);

            match fd.register(self.event_loop.loop_(), bun_aio::PollKind::Process, true) {
                Maybe::Result(()) => {
                    self.ref_();
                    Maybe::SUCCESS
                }
                Maybe::Err(err) => {
                    let Poller::Fd(fd) = &mut self.poller else { unreachable!() };
                    fd.disable_keeping_process_alive(self.event_loop);
                    Maybe::Err(err)
                }
            }
        }
    }

    #[cfg(unix)]
    pub fn rewatch_posix(&mut self) -> bun_sys::Result<()> {
        if WaiterThread::should_use_waiter_thread() {
            if !matches!(self.poller, Poller::WaiterThread(_)) {
                self.poller = Poller::WaiterThread(KeepAlive::default());
            }
            if let Poller::WaiterThread(w) = &mut self.poller {
                w.ref_(self.event_loop);
            }
            self.ref_();
            WaiterThread::append(self);
            return Maybe::SUCCESS;
        }

        if let Poller::Fd(fd) = &mut self.poller {
            let maybe = fd.register(self.event_loop.loop_(), bun_aio::PollKind::Process, true);
            if let Maybe::Result(()) = maybe {
                self.ref_();
            }
            maybe
        } else {
            panic!("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    #[cfg(windows)]
    extern "C" fn on_exit_uv(process: *mut uv::uv_process_t, exit_status: i64, term_signal: c_int) {
        // SAFETY: process points to PollerWindows.uv field inside Process.poller
        let poller: *mut PollerWindows = unsafe {
            (process as *mut u8).sub(offset_of!(PollerWindows, uv)).cast::<PollerWindows>()
        };
        // TODO(port): PollerWindows is a Rust enum (tagged union); @fieldParentPtr on
        // a union(enum) payload doesn't map cleanly. Phase B: make PollerWindows a
        // #[repr(C)] struct { tag, uv } so offset_of works, or store backref in uv.data.
        let this: &mut Process = unsafe {
            &mut *(poller as *mut u8).sub(offset_of!(Process, poller)).cast::<Process>()
        };
        let exit_code: u8 = if exit_status >= 0 { (exit_status as u64) as u8 } else { 0 };
        let signal_code: Option<bun_core::SignalCode> =
            if term_signal > 0 && term_signal < bun_core::SignalCode::SIGSYS as c_int {
                // SAFETY: range-checked above
                Some(unsafe { core::mem::transmute::<u8, bun_core::SignalCode>(term_signal as u8) })
            } else {
                None
            };
        let rusage = uv_getrusage(unsafe { &mut *process });

        bun_sys::windows::libuv::log!(
            "Process.onExit({}) code: {}, signal: {:?}",
            unsafe { (*process).pid },
            exit_code,
            signal_code
        );

        if let Some(sig) = signal_code {
            this.close();
            this.on_exit(Status::Signaled(sig), &rusage);
        } else if exit_code >= 0 {
            this.close();
            this.on_exit(
                Status::Exited(Exited {
                    code: exit_code,
                    // SAFETY: 0 is a valid SignalCode discriminant
                    signal: unsafe { core::mem::transmute::<u8, bun_core::SignalCode>(0) },
                }),
                &rusage,
            );
        } else {
            this.on_exit(
                Status::Err(bun_sys::Error::from_code(
                    bun_sys::E::from_raw(i32::try_from(exit_status).unwrap()),
                    bun_sys::Syscall::Waitpid,
                )),
                &rusage,
            );
        }
    }

    #[cfg(windows)]
    extern "C" fn on_close_uv(uv_handle: *mut uv::uv_process_t) {
        // SAFETY: same @fieldParentPtr pattern as on_exit_uv
        let poller: *mut Poller = unsafe {
            (uv_handle as *mut u8).sub(offset_of!(Poller, uv)).cast::<Poller>()
        };
        let this: &mut Process = unsafe {
            &mut *(poller as *mut u8).sub(offset_of!(Process, poller)).cast::<Process>()
        };
        bun_sys::windows::libuv::log!("Process.onClose({})", unsafe { (*uv_handle).pid });

        if matches!(this.poller, Poller::Uv(_)) {
            this.poller = Poller::Detached;
        }
        this.deref();
    }

    pub fn close(&mut self) {
        #[cfg(unix)]
        {
            match &mut self.poller {
                Poller::Fd(_) => {
                    // fd.deinit() handled by Drop on Box<FilePoll>
                    self.poller = Poller::Detached;
                }
                Poller::WaiterThread(waiter) => {
                    waiter.disable();
                    self.poller = Poller::Detached;
                }
                _ => {}
            }
        }
        #[cfg(windows)]
        {
            match &mut self.poller {
                Poller::Uv(process) => {
                    if process.is_closed() {
                        self.poller = Poller::Detached;
                    } else if !process.is_closing() {
                        self.ref_();
                        process.close(Self::on_close_uv);
                    }
                }
                _ => {}
            }
        }

        #[cfg(target_os = "linux")]
        {
            if self.pidfd != bun_sys::INVALID_FD.value().as_system() && self.pidfd > 0 {
                Fd::from_native(self.pidfd).close();
                self.pidfd = bun_sys::INVALID_FD.value().as_system();
            }
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self) {
        self.poller.disable_keeping_event_loop_alive(self.event_loop);
    }

    pub fn has_ref(&self) -> bool {
        self.poller.has_ref()
    }

    pub fn enable_keeping_event_loop_alive(&mut self) {
        if self.has_exited() {
            return;
        }
        self.poller.enable_keeping_event_loop_alive(self.event_loop);
    }

    pub fn detach(&mut self) {
        self.close();
        self.exit_handler = ProcessExitHandler::default();
    }

    fn deinit(this: *mut Process) {
        // SAFETY: called by IntrusiveArc when refcount hits 0; Box::from_raw
        // drops `poller` (whose Drop impl handles waiter.disable() / closed-assert).
        unsafe {
            drop(Box::from_raw(this));
        }
    }

    pub fn kill(&mut self, signal: u8) -> Maybe<()> {
        #[cfg(unix)]
        {
            match &self.poller {
                Poller::WaiterThread(_) | Poller::Fd(_) => {
                    // SAFETY: libc kill
                    let err = unsafe { libc::kill(self.pid, signal as c_int) };
                    if err != 0 {
                        let errno_ = bun_sys::get_errno(err);
                        // if the process was already killed don't throw
                        if errno_ != bun_sys::E::SRCH {
                            return Maybe::Err(bun_sys::Error::from_code(errno_, bun_sys::Syscall::Kill));
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
                    if let Some(err) = handle.kill(signal).to_error(bun_sys::Syscall::Kill) {
                        // if the process was already killed don't throw
                        if err.errno != bun_sys::E::SRCH as i32 {
                            return Maybe::Err(err);
                        }
                    }
                    return Maybe::Result(());
                }
                _ => {}
            }
        }

        Maybe::Result(())
    }
}

#[derive(Clone, Copy)]
pub enum Status {
    Running,
    Exited(Exited),
    Signaled(bun_core::SignalCode),
    Err(bun_sys::Error),
}

impl Default for Status {
    fn default() -> Self {
        Status::Running
    }
}

#[derive(Clone, Copy)]
pub struct Exited {
    pub code: u8,
    pub signal: bun_core::SignalCode,
}

impl Default for Exited {
    fn default() -> Self {
        Self {
            code: 0,
            // SAFETY: 0 is a valid SignalCode discriminant
            signal: unsafe { core::mem::transmute::<u8, bun_core::SignalCode>(0) },
        }
    }
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
            Maybe::Err(err_) => {
                return Some(Status::Err(*err_));
            }
            Maybe::Result(result) => {
                if result.pid != pid {
                    return None;
                }

                if libc::WIFEXITED(result.status) {
                    exit_code = Some(libc::WEXITSTATUS(result.status) as u8);
                    // True if the process terminated due to receipt of a signal.
                }

                if libc::WIFSIGNALED(result.status) {
                    signal = Some(libc::WTERMSIG(result.status) as u8);
                }
                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                // True if the process has not terminated, but has stopped and can
                // be restarted.  This macro can be true only if the wait call spec-ified specified
                // ified the WUNTRACED option or if the child process is being
                // traced (see ptrace(2)).
                else if libc::WIFSTOPPED(result.status) {
                    signal = Some(libc::WSTOPSIG(result.status) as u8);
                }
            }
        }

        if let Some(code) = exit_code {
            return Some(Status::Exited(Exited {
                code,
                // SAFETY: signal byte → SignalCode enum (#[repr(u8)])
                signal: unsafe {
                    core::mem::transmute::<u8, bun_core::SignalCode>(signal.unwrap_or(0))
                },
            }));
        } else if let Some(sig) = signal {
            // SAFETY: signal byte → SignalCode enum (#[repr(u8)])
            return Some(Status::Signaled(unsafe {
                core::mem::transmute::<u8, bun_core::SignalCode>(sig)
            }));
        }

        None
    }

    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        match self {
            Status::Signaled(sig) => Some(*sig),
            Status::Exited(exit) => {
                if (exit.signal as u8) > 0 {
                    Some(exit.signal)
                } else {
                    None
                }
            }
            _ => None,
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
            Status::Signaled(signal) => write!(writer, "signal: {}", *signal as u8),
            Status::Err(err) => write!(writer, "{}", err),
            _ => Ok(()),
        }
    }
}

#[cfg(unix)]
pub enum PollerPosix {
    Fd(Box<FilePoll>),
    WaiterThread(KeepAlive),
    Detached,
}

#[cfg(unix)]
impl Drop for PollerPosix {
    fn drop(&mut self) {
        // Fd arm: Box<FilePoll> drops automatically.
        if let PollerPosix::WaiterThread(w) = self {
            w.disable();
        }
    }
}

#[cfg(unix)]
impl PollerPosix {
    fn into_fd(mut self) -> Option<Box<FilePoll>> {
        // PORT NOTE: reshaped for borrowck — Drop impl forbids partial move out of `self`.
        match core::mem::replace(&mut self, PollerPosix::Detached) {
            PollerPosix::Fd(f) => Some(f),
            _ => None,
        }
    }

    pub fn enable_keeping_event_loop_alive(&mut self, event_loop: EventLoopHandle) {
        match self {
            PollerPosix::Fd(poll) => {
                poll.enable_keeping_process_alive(event_loop);
            }
            PollerPosix::WaiterThread(waiter) => {
                waiter.ref_(event_loop);
            }
            _ => {}
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, event_loop: EventLoopHandle) {
        match self {
            PollerPosix::Fd(poll) => {
                poll.disable_keeping_process_alive(event_loop);
            }
            PollerPosix::WaiterThread(waiter) => {
                waiter.unref(event_loop);
            }
            _ => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            PollerPosix::Fd(fd) => fd.can_enable_keeping_process_alive(),
            PollerPosix::WaiterThread(w) => w.is_active(),
            _ => false,
        }
    }
}

#[cfg(unix)]
pub type Poller = PollerPosix;
#[cfg(not(unix))]
pub type Poller = PollerWindows;

#[cfg(windows)]
pub enum PollerWindows {
    Uv(uv::uv_process_t),
    Detached,
}

#[cfg(windows)]
impl Drop for PollerWindows {
    fn drop(&mut self) {
        if let PollerWindows::Uv(p) = self {
            debug_assert!(p.is_closed());
        }
    }
}

#[cfg(windows)]
impl PollerWindows {
    pub fn enable_keeping_event_loop_alive(&mut self, _event_loop: EventLoopHandle) {
        match self {
            PollerWindows::Uv(process) => {
                process.ref_();
            }
            _ => {}
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, _event_loop: EventLoopHandle) {
        // This is disabled on Windows
        // uv_unref() causes the onExitUV callback to *never* be called
        // This breaks a lot of stuff...
        // Once fixed, re-enable "should not hang after unref" test in spawn.test
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

#[cfg(not(unix))]
pub mod WaiterThread {
    #[inline]
    pub fn should_use_waiter_thread() -> bool {
        false
    }
    pub fn set_should_use_waiter_thread() {}
    pub fn reload_handlers() {}
}

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
#[cfg(unix)]
pub mod waiter_thread_posix {
    use super::*;

    pub struct WaiterThreadPosix {
        pub started: AtomicU32,
        #[cfg(target_os = "linux")]
        pub eventfd: Fd,
        #[cfg(not(target_os = "linux"))]
        pub eventfd: (),
        pub js_process: ProcessQueue,
    }

    impl Default for WaiterThreadPosix {
        fn default() -> Self {
            Self {
                started: AtomicU32::new(0),
                #[cfg(target_os = "linux")]
                eventfd: Fd::INVALID, // undefined in Zig
                #[cfg(not(target_os = "linux"))]
                eventfd: (),
                js_process: ProcessQueue::default(),
            }
        }
    }

    pub type ProcessQueue = NewQueue<Process>;

    // fn NewQueue(comptime T: type) type → generic struct
    pub struct NewQueue<T: 'static> {
        pub queue: ConcurrentQueue<T>,
        pub active: Vec<Arc<T>>,
        // PORT NOTE: LIFETIMES.tsv classifies process as Arc<Process>; the Zig stores
        // *T in the active list. We mirror with Arc<T> for the strong-ref semantics.
        // TODO(port): verify Arc<T> vs *mut T — Zig active list holds raw *T whose
        // strong ref was taken by the caller before append().
    }

    impl<T> Default for NewQueue<T> {
        fn default() -> Self {
            Self { queue: ConcurrentQueue::default(), active: Vec::new() }
        }
    }

    pub struct TaskQueueEntry<T: 'static> {
        pub process: Arc<T>,
        pub next: *mut TaskQueueEntry<T>,
    }

    pub type ConcurrentQueue<T> = UnboundedQueue<TaskQueueEntry<T>>;
    // TODO(port): UnboundedQueue intrusive `.next` field offset wiring

    pub struct ResultTask<T: 'static> {
        pub result: bun_sys::Result<WaitPidResult>,
        pub subprocess: Arc<T>,
        pub rusage: Rusage,
    }

    impl<T: ProcessLike> ResultTask<T> {
        pub fn new(v: ResultTask<T>) -> Box<Self> {
            Box::new(v)
        }

        pub fn run_from_js_thread(self: Box<Self>) {
            self.run_from_main_thread();
        }

        pub fn run_from_main_thread(self: Box<Self>) {
            let result = self.result;
            let subprocess = self.subprocess;
            let rusage = self.rusage;
            // bun.destroy(self) — Box drops at end of scope
            subprocess.on_wait_pid_from_waiter_thread(&result, &rusage);
        }

        pub fn run_from_main_thread_mini(self: Box<Self>, _: &mut ()) {
            self.run_from_main_thread();
        }
    }

    pub struct ResultTaskMini<T: 'static> {
        pub result: bun_sys::Result<WaitPidResult>,
        pub subprocess: Arc<T>,
        pub task: jsc::AnyTaskWithExtraContext,
    }

    impl<T: ProcessLike> ResultTaskMini<T> {
        pub fn new(v: ResultTaskMini<T>) -> Box<Self> {
            Box::new(v)
        }

        pub fn run_from_js_thread(self: Box<Self>) {
            self.run_from_main_thread();
        }

        pub fn run_from_main_thread(self: Box<Self>) {
            let result = self.result;
            let subprocess = self.subprocess;
            // bun.destroy(self) — Box drops at end of scope
            subprocess.on_wait_pid_from_waiter_thread(&result, &rusage_zeroed());
        }

        pub fn run_from_main_thread_mini(self: Box<Self>, _: &mut ()) {
            self.run_from_main_thread();
        }
    }

    // TODO(port): trait to abstract `process.pid`, `process.event_loop`,
    // `process.onWaitPidFromWaiterThread` for generic T (only Process today).
    pub trait ProcessLike {
        fn pid(&self) -> PidT;
        fn event_loop(&self) -> EventLoopHandle;
        fn on_wait_pid_from_waiter_thread(
            &self,
            result: &bun_sys::Result<WaitPidResult>,
            rusage: &Rusage,
        );
    }

    impl<T: ProcessLike + 'static> NewQueue<T> {
        pub fn append(&mut self, process: Arc<T>) {
            self.queue.push(Box::into_raw(Box::new(TaskQueueEntry {
                process,
                next: core::ptr::null_mut(),
            })));
        }

        pub fn loop_(&mut self) {
            {
                let batch = self.queue.pop_batch();
                self.active.reserve(batch.count());
                let mut iter = batch.iterator();
                while let Some(task) = iter.next() {
                    // SAFETY: task was Box::into_raw'd in append()
                    let task = unsafe { Box::from_raw(task) };
                    // PERF(port): was assume_capacity
                    self.active.push(task.process);
                    // task drops here (TrivialDeinit)
                }
            }

            let mut i: usize = 0;
            while i < self.active.len() {
                let mut remove = false;

                let process = &self.active[i];
                let pid = process.pid();
                // this case shouldn't really happen
                if pid == 0 {
                    remove = true;
                } else {
                    let mut rusage = rusage_zeroed();
                    let result = posix_spawn::wait4(pid, libc::WNOHANG, Some(&mut rusage));
                    let matched = match &result {
                        Maybe::Err(_) => true,
                        Maybe::Result(r) => r.pid == pid,
                    };
                    if matched {
                        remove = true;
                        let process = self.active[i].clone();

                        match process.event_loop() {
                            EventLoopHandle::Js(event_loop) => {
                                event_loop.enqueue_task_concurrent(
                                    jsc::ConcurrentTask::create(jsc::Task::init(
                                        ResultTask::<T>::new(ResultTask {
                                            result,
                                            subprocess: process,
                                            rusage,
                                        }),
                                    )),
                                );
                            }
                            EventLoopHandle::Mini(mini) => {
                                // TODO(port): jsc::AnyTaskWithExtraContext::New generic wiring
                                let mut out = ResultTaskMini::<T>::new(ResultTaskMini {
                                    result,
                                    subprocess: process,
                                    task: jsc::AnyTaskWithExtraContext::default(),
                                });
                                out.task = jsc::AnyTaskWithExtraContext::init_for::<
                                    ResultTaskMini<T>,
                                    (),
                                >(&mut *out, ResultTaskMini::<T>::run_from_main_thread_mini);
                                mini.enqueue_task_concurrent(&mut out.task);
                                // PORT NOTE: out is leaked into the task queue; Box::leak semantics
                                Box::leak(out);
                            }
                        }
                    }
                }

                if remove {
                    let _ = self.active.remove(i);
                } else {
                    i += 1;
                }
            }
        }
    }

    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);
    const STACK_SIZE: usize = 512 * 1024;
    // TODO(port): mutable static singleton — wrap in OnceLock/Mutex in Phase B
    pub static mut INSTANCE: WaiterThreadPosix = WaiterThreadPosix {
        started: AtomicU32::new(0),
        #[cfg(target_os = "linux")]
        eventfd: Fd::INVALID,
        #[cfg(not(target_os = "linux"))]
        eventfd: (),
        js_process: ProcessQueue {
            queue: ConcurrentQueue::new(),
            active: Vec::new(),
        },
    };
    // TODO(port): the above static initializer requires const-constructible
    // ConcurrentQueue/Vec; Phase B may switch to lazy_static/OnceLock.

    impl WaiterThreadPosix {
        pub fn set_should_use_waiter_thread() {
            SHOULD_USE_WAITER_THREAD.store(true, Ordering::Relaxed);
        }

        pub fn should_use_waiter_thread() -> bool {
            SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
        }

        pub fn append(process: &mut Process) {
            // SAFETY: single waiter-thread singleton
            unsafe {
                // TODO(port): wrap *mut Process in Arc — caller already ref()'d
                INSTANCE.js_process.append(Arc::from_raw_ref(process));
            }

            init().unwrap_or_else(|_| panic!("Failed to start WaiterThread"));

            #[cfg(target_os = "linux")]
            {
                let one: [u8; 8] = (1usize).to_ne_bytes();
                // SAFETY: eventfd is valid after init()
                let _ = unsafe {
                    libc::write(INSTANCE.eventfd.cast(), one.as_ptr().cast(), 8)
                };
            }
        }

        pub fn reload_handlers() {
            if !SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed) {
                return;
            }

            #[cfg(target_os = "linux")]
            {
                // SAFETY: sigaction with valid handler
                unsafe {
                    let mut current_mask: libc::sigset_t = core::mem::zeroed();
                    libc::sigemptyset(&mut current_mask);
                    libc::sigaddset(&mut current_mask, libc::SIGCHLD);
                    let act = libc::sigaction {
                        sa_sigaction: wakeup as usize,
                        sa_mask: current_mask,
                        sa_flags: libc::SA_NOCLDSTOP,
                        sa_restorer: None,
                    };
                    libc::sigaction(libc::SIGCHLD, &act, core::ptr::null_mut());
                }
            }
        }
    }

    pub fn init() -> Result<(), bun_core::Error> {
        debug_assert!(SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed));

        // SAFETY: singleton access
        if unsafe { INSTANCE.started.fetch_max(1, Ordering::Relaxed) } > 0 {
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            // SAFETY: eventfd syscall
            let fd = unsafe {
                libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC | 0)
            };
            if fd < 0 {
                return Err(bun_core::err!("EventfdFailed"));
            }
            // SAFETY: singleton access
            unsafe { INSTANCE.eventfd = Fd::from_native(fd) };
        }

        // TODO(port): std::Thread::spawn with stack_size — use bun_threading
        let thread = bun_threading::spawn_with_stack(STACK_SIZE, loop_)?;
        thread.detach();
        Ok(())
    }

    #[cfg(target_os = "linux")]
    extern "C" fn wakeup(_: c_int) {
        let one: [u8; 8] = (1usize).to_ne_bytes();
        // SAFETY: eventfd is valid; called from signal handler
        let _ = bun_sys::write(unsafe { INSTANCE.eventfd }, &one).unwrap_or(0);
    }

    pub fn loop_() {
        Output::Source::configure_named_thread("Waitpid");
        WaiterThreadPosix::reload_handlers();
        // SAFETY: singleton access from dedicated thread
        let this = unsafe { &mut INSTANCE };

        'outer: loop {
            this.js_process.loop_();

            #[cfg(target_os = "linux")]
            {
                let mut polls = [libc::pollfd {
                    fd: this.eventfd.cast(),
                    events: libc::POLLIN | libc::POLLERR,
                    revents: 0,
                }];

                // Consume the pending eventfd
                let mut buf = [0u8; 8];
                if bun_sys::read(this.eventfd, &mut buf).unwrap_or(0) > 0 {
                    continue 'outer;
                }

                // SAFETY: valid pollfd array
                let _ = unsafe { libc::poll(polls.as_mut_ptr(), 1, i32::MAX) };
            }
            #[cfg(not(target_os = "linux"))]
            {
                // SAFETY: sigwait with valid mask
                unsafe {
                    let mut mask: libc::sigset_t = core::mem::zeroed();
                    libc::sigemptyset(&mut mask);
                    let mut signal: c_int = libc::SIGCHLD;
                    let _rc = libc::sigwait(&mask, &mut signal);
                }
            }
        }
    }

    use std::sync::Arc;
}

pub struct PosixSpawnOptions {
    pub stdin: PosixStdio,
    pub stdout: PosixStdio,
    pub stderr: PosixStdio,
    pub ipc: Option<Fd>,
    pub extra_fds: Box<[PosixStdio]>,
    pub cwd: Box<[u8]>,
    pub detached: bool,
    pub windows: (),
    pub argv0: Option<*const c_char>,
    pub stream: bool,
    pub sync: bool,
    pub can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool,
    /// Apple Extension: If this bit is set, rather
    /// than returning to the caller, posix_spawn(2)
    /// and posix_spawnp(2) will behave as a more
    /// featureful execve(2).
    pub use_execve_on_macos: bool,
    /// If we need to call `socketpair()`, this
    /// sets SO_NOSIGPIPE when true.
    ///
    /// If false, this avoids setting SO_NOSIGPIPE
    /// for stdout. This is used to preserve
    /// consistent shell semantics.
    pub no_sigpipe: bool,
    /// setpgid(0, 0) in the child so it leads its own process group. The parent
    /// can then `kill(-pid, sig)` to signal the child and all its descendants.
    /// Not exposed to JS yet.
    pub new_process_group: bool,
    /// PTY slave fd for controlling terminal setup (-1 if not using PTY).
    pub pty_slave_fd: i32,
    /// Windows-only ConPTY handle; void placeholder on POSIX.
    pub pseudoconsole: (),
    /// Linux only. When non-null, the child sets PR_SET_PDEATHSIG to this
    /// signal between vfork and exec in posix_spawn_bun, so the kernel kills
    /// it when the spawning thread dies. When null, defaults to SIGKILL if
    /// no-orphans mode is enabled (see `ParentDeathWatchdog`), else 0 (no
    /// PDEATHSIG). Not exposed to JS yet.
    pub linux_pdeathsig: Option<u8>,
}

impl Default for PosixSpawnOptions {
    fn default() -> Self {
        Self {
            stdin: PosixStdio::Ignore,
            stdout: PosixStdio::Ignore,
            stderr: PosixStdio::Ignore,
            ipc: None,
            extra_fds: Box::default(),
            cwd: Box::default(),
            detached: false,
            windows: (),
            argv0: None,
            stream: true,
            sync: false,
            can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: false,
            use_execve_on_macos: false,
            no_sigpipe: true,
            new_process_group: false,
            pty_slave_fd: -1,
            pseudoconsole: (),
            linux_pdeathsig: None,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Dup2 {
    pub out: jsc::subprocess::StdioKind,
    pub to: jsc::subprocess::StdioKind,
}

pub enum PosixStdio {
    Path(Box<[u8]>),
    Inherit,
    Ignore,
    Buffer,
    Ipc,
    Pipe(Fd),
    // TODO: remove this entry, it doesn't seem to be used
    Dup2(Dup2),
}

pub struct WindowsSpawnResult {
    // TODO(port): IntrusiveArc vs Arc<Process> — LIFETIMES.tsv says Arc but Process is intrusive (ref_count field + container_of recovery)
    pub process_: Option<Arc<Process>>,
    pub stdin: WindowsStdioResult,
    pub stdout: WindowsStdioResult,
    pub stderr: WindowsStdioResult,
    pub extra_pipes: Vec<WindowsStdioResult>,
    pub stream: bool,
    pub sync: bool,
}

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

pub enum WindowsStdioResult {
    /// inherit, ignore, path, pipe
    Unavailable,
    Buffer(Box<uv::Pipe>),
    BufferFd(Fd),
}

impl WindowsSpawnResult {
    pub fn to_process(&mut self, _event_loop: impl Sized, sync_: bool) -> Arc<Process> {
        let process = self.process_.take().unwrap();
        // TODO(port): Arc<Process> interior mutability — Process.sync is set here in Zig
        // SAFETY: caller has unique ownership at this point (just spawned)
        unsafe {
            (*(Arc::as_ptr(&process) as *mut Process)).sync = sync_;
        }
        process
    }

    pub fn close(&mut self) {
        if let Some(proc) = self.process_.take() {
            // SAFETY: see to_process note above
            unsafe {
                let p = &mut *(Arc::as_ptr(&proc) as *mut Process);
                p.close();
                p.detach();
            }
            // proc.deref() — Arc drop
        }
    }
}

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

pub struct WindowsOptions {
    pub verbatim_arguments: bool,
    pub hide_window: bool,
    pub loop_: EventLoopHandle,
}

impl Default for WindowsOptions {
    fn default() -> Self {
        Self {
            verbatim_arguments: false,
            hide_window: true,
            // TODO(port): EventLoopHandle has no Default; Phase B must require it as a ctor arg.
            // SAFETY: placeholder — Zig field is `= undefined`; never read before assignment.
            loop_: unsafe { core::mem::zeroed() },
        }
    }
}

pub enum WindowsStdio {
    Path(Box<[u8]>),
    Inherit,
    Ignore,
    Buffer(Box<uv::Pipe>),
    Ipc(Box<uv::Pipe>),
    Pipe(Fd),
    Dup2(Dup2),
}

impl Drop for WindowsStdio {
    fn drop(&mut self) {
        // TODO(port): close_and_destroy consumes the pipe in Zig (frees the heap
        // allocation). With Box<uv::Pipe> ownership this Drop runs the FFI close;
        // revisit ownership model in Phase B.
        match self {
            WindowsStdio::Buffer(pipe) => pipe.close_and_destroy(),
            WindowsStdio::Ipc(pipe) => pipe.close_and_destroy(),
            _ => {}
        }
    }
}

// WindowsSpawnOptions: no explicit Drop — stdin/stdout/stderr/extra_fds are
// `WindowsStdio` fields whose Drop above cascades.

pub struct PosixSpawnResult {
    pub pid: PidT,
    pub pidfd: Option<PidFdType>,
    pub stdin: Option<Fd>,
    pub stdout: Option<Fd>,
    pub stderr: Option<Fd>,
    pub ipc: Option<Fd>,
    pub extra_pipes: Vec<ExtraPipe>,
    pub memfds: [bool; 3],
    // ESRCH can happen when requesting the pidfd
    pub has_exited: bool,
}

impl Default for PosixSpawnResult {
    fn default() -> Self {
        Self {
            pid: 0,
            pidfd: None,
            stdin: None,
            stdout: None,
            stderr: None,
            ipc: None,
            extra_pipes: Vec::new(),
            memfds: [false, false, false],
            has_exited: false,
        }
    }
}

/// Entry in `extra_pipes` for a stdio slot at index >= 3.
pub enum ExtraPipe {
    /// We created this fd (e.g. socketpair for `"pipe"`); expose it via
    /// `Subprocess.stdio[N]` and close it in `finalizeStreams`.
    OwnedFd(Fd),
    /// The caller supplied this fd in the stdio array; expose it via
    /// `Subprocess.stdio[N]` but never close it — the caller retains ownership.
    UnownedFd(Fd),
    /// Nothing to expose for this slot (`"ignore"`, `"inherit"`, a path, or
    /// the IPC channel after ownership has been transferred to uSockets).
    Unavailable,
}

impl ExtraPipe {
    pub fn fd(&self) -> Fd {
        match self {
            ExtraPipe::OwnedFd(f) | ExtraPipe::UnownedFd(f) => *f,
            ExtraPipe::Unavailable => bun_sys::INVALID_FD,
        }
    }
}

impl PosixSpawnResult {
    pub fn close(&mut self) {
        for item in self.extra_pipes.iter() {
            match item {
                ExtraPipe::OwnedFd(f) => f.close(),
                ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
            }
        }
        self.extra_pipes.clear();
        self.extra_pipes.shrink_to_fit();
    }

    #[cfg(unix)]
    pub fn to_process(
        self,
        event_loop: impl Into<EventLoopHandle>,
        sync_: bool,
    ) -> *mut Process {
        Process::init_posix(self, event_loop, sync_)
    }

    #[cfg(target_os = "linux")]
    fn pidfd_flags_for_linux() -> u32 {
        let kernel = bun_analytics::generate_header::generate_platform::kernel_version();
        // pidfd_nonblock only supported in 5.10+
        if kernel
            .order_without_tag(&bun_semver::Version { major: 5, minor: 10, patch: 0 })
            .compare(bun_semver::Order::Gte)
        {
            bun_sys::O::NONBLOCK
        } else {
            0
        }
    }

    #[cfg(target_os = "linux")]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        if WaiterThread::should_use_waiter_thread() {
            return Maybe::Err(bun_sys::Error::from_code(bun_sys::E::NOSYS, bun_sys::Syscall::PidfdOpen));
        }

        let pidfd_flags = Self::pidfd_flags_for_linux();

        loop {
            let attempt = 'brk: {
                let rc = bun_sys::pidfd_open(
                    i32::try_from(self.pid).unwrap(),
                    pidfd_flags,
                );
                if let Maybe::Err(e) = &rc {
                    if e.get_errno() == bun_sys::E::INVAL {
                        // Retry once, incase they don't support PIDFD_NONBLOCK.
                        break 'brk bun_sys::pidfd_open(i32::try_from(self.pid).unwrap(), 0);
                    }
                }
                rc
            };
            match attempt {
                Maybe::Err(err) => {
                    match err.get_errno() {
                        // seccomp filters can be used to block this system call or pidfd's altogether
                        // https://github.com/moby/moby/issues/42680
                        // so let's treat a bunch of these as actually meaning we should use the waiter thread fallback instead.
                        bun_sys::E::NOSYS
                        | bun_sys::E::OPNOTSUPP
                        | bun_sys::E::PERM
                        | bun_sys::E::ACCES
                        | bun_sys::E::INVAL => {
                            WaiterThread::set_should_use_waiter_thread();
                            return Maybe::Err(err);
                        }

                        // No such process can happen if it exited between the time we got the pid and called pidfd_open
                        // Until we switch to CLONE_PIDFD, this needs to be handled separately.
                        bun_sys::E::SRCH => {}

                        // For all other cases, ensure we don't leak the child process on error
                        // That would cause Zombie processes to accumulate.
                        _ => {
                            loop {
                                let mut status: i32 = 0;
                                // SAFETY: libc wait4
                                let rc = unsafe {
                                    libc::wait4(self.pid, &mut status, 0, core::ptr::null_mut())
                                };
                                match bun_sys::get_errno(rc as isize) {
                                    bun_sys::E::SUCCESS => {}
                                    bun_sys::E::INTR => continue,
                                    _ => {}
                                }
                                break;
                            }
                        }
                    }
                    return Maybe::Err(err);
                }
                Maybe::Result(rc) => {
                    return Maybe::Result(rc);
                }
            }
            #[allow(unreachable_code)]
            { unreachable!() }
        }
    }

    #[cfg(not(target_os = "linux"))]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        Maybe::Err(bun_sys::Error::from_code(bun_sys::E::NOSYS, bun_sys::Syscall::PidfdOpen))
    }
}

#[cfg(unix)]
pub type SpawnOptions = PosixSpawnOptions;
#[cfg(not(unix))]
pub type SpawnOptions = WindowsSpawnOptions;

#[cfg(unix)]
pub type SpawnProcessResult = PosixSpawnResult;
#[cfg(not(unix))]
pub type SpawnProcessResult = WindowsSpawnResult;

use std::sync::Arc;

pub fn spawn_process(
    options: &SpawnOptions,
    argv: *const *const c_char, // [*:null]?[*:0]const u8
    envp: *const *const c_char,
) -> Result<bun_sys::Result<SpawnProcessResult>, bun_core::Error> {
    #[cfg(unix)]
    {
        spawn_process_posix(options, argv, envp)
    }
    #[cfg(not(unix))]
    {
        spawn_process_windows(options, argv, envp)
    }
}

#[cfg(unix)]
pub fn spawn_process_posix(
    options: &PosixSpawnOptions,
    argv: *const *const c_char,
    envp: *const *const c_char,
) -> Result<bun_sys::Result<PosixSpawnResult>, bun_core::Error> {
    bun_analytics::Features::spawn_inc();
    let mut actions = PosixSpawnActions::init()?;
    // defer actions.deinit() — Drop

    let mut attr = PosixSpawnAttr::init()?;
    // defer attr.deinit() — Drop

    let mut flags: i32 = bun_sys::c::POSIX_SPAWN_SETSIGDEF | bun_sys::c::POSIX_SPAWN_SETSIGMASK;

    #[cfg(target_os = "macos")]
    {
        flags |= bun_sys::c::POSIX_SPAWN_CLOEXEC_DEFAULT;

        if options.use_execve_on_macos {
            flags |= bun_sys::c::POSIX_SPAWN_SETEXEC;

            if matches!(options.stdin, PosixStdio::Buffer)
                || matches!(options.stdout, PosixStdio::Buffer)
                || matches!(options.stderr, PosixStdio::Buffer)
            {
                Output::panic(
                    "Internal error: stdin, stdout, and stderr cannot be buffered when use_execve_on_macos is true",
                    &[],
                );
            }
        }
    }

    if options.detached {
        // TODO(port): @hasDecl check — assume present on platforms that define it
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            flags |= bun_sys::c::POSIX_SPAWN_SETSID;
        }
        attr.detached = true;
    }

    // Pass PTY slave fd to attr for controlling terminal setup
    attr.pty_slave_fd = options.pty_slave_fd;
    attr.new_process_group = options.new_process_group;

    #[cfg(target_os = "linux")]
    {
        // Explicit per-spawn value wins; otherwise no-orphans mode defaults
        // every child to SIGKILL-on-parent-death so non-Bun descendants are
        // covered without relying on env-var inheritance, and the prctl happens
        // in the vfork child before exec so there's no startup race.
        attr.linux_pdeathsig = if let Some(sig) = options.linux_pdeathsig {
            i32::from(sig)
        } else if ParentDeathWatchdog::should_default_spawn_pdeathsig() {
            libc::SIGKILL
        } else {
            0
        };
    }

    if !options.cwd.is_empty() {
        actions.chdir(&options.cwd)?;
    }
    let mut spawned = PosixSpawnResult::default();
    let mut extra_fds: Vec<ExtraPipe> = Vec::new();
    // errdefer extra_fds.deinit() — Vec drops on ?
    // PERF(port): was stack-fallback allocator (2048)
    let mut to_close_at_end: Vec<Fd> = Vec::new();
    let mut to_set_cloexec: Vec<Fd> = Vec::new();
    let close_at_end_guard = scopeguard::guard((), |_| {
        for fd in to_set_cloexec.iter() {
            let _ = bun_sys::set_close_on_exec(*fd);
        }
        for fd in to_close_at_end.iter() {
            fd.close();
        }
    });
    // TODO(port): scopeguard captures &to_set_cloexec/&to_close_at_end mutably
    // while they're still pushed to below — Phase B: restructure with a single
    // struct holding both vecs inside the guard, or run cleanup manually at fn
    // exit. Leaving // TODO(port): errdefer for now.
    let _ = close_at_end_guard;
    // TODO(port): errdefer — to_close_on_error closed on any `?` after this point
    let mut to_close_on_error: Vec<Fd> = Vec::new();

    let _ = attr.set(flags as _);
    let _ = attr.reset_signals();

    if let Some(ipc) = options.ipc {
        actions.inherit(ipc)?;
        spawned.ipc = Some(ipc);
    }

    let stdio_options: [&PosixStdio; 3] = [&options.stdin, &options.stdout, &options.stderr];
    // PORT NOTE: reshaped for borrowck — Zig holds [3]*?bun.FD into spawned;
    // we index spawned.{stdin,stdout,stderr} via a helper closure instead.
    let mut dup_stdout_to_stderr: bool = false;

    for i in 0..3usize {
        let fileno = Fd::from_native(FdT::try_from(i).unwrap());
        let flag: u32 = if i == 0 { bun_sys::O::RDONLY } else { bun_sys::O::WRONLY };

        match stdio_options[i] {
            PosixStdio::Dup2(dup2) => {
                // This is a hack to get around the ordering of the spawn actions.
                // If stdout is set so that it redirects to stderr, the order of actions will be like this:
                // 0. dup2(stderr, stdout) - this makes stdout point to stderr
                // 1. setup stderr (will make stderr point to write end of `stderr_pipe_fds`)
                // This is actually wrong, 0 will execute before 1 so stdout ends up writing to stderr instead of the pipe
                // So we have to instead do `dup2(stderr_pipe_fd[1], stdout)`
                // Right now we only allow one output redirection so it's okay.
                if i == 1 && dup2.to == jsc::subprocess::StdioKind::Stderr {
                    dup_stdout_to_stderr = true;
                } else {
                    actions.dup2(dup2.to.to_fd(), dup2.out.to_fd())?;
                }
            }
            PosixStdio::Inherit => {
                actions.inherit(fileno)?;
            }
            PosixStdio::Ipc | PosixStdio::Ignore => {
                actions.open_z(fileno, b"/dev/null\0", flag | bun_sys::O::CREAT, 0o664)?;
            }
            PosixStdio::Path(path) => {
                actions.open(fileno, path, flag | bun_sys::O::CREAT, 0o664)?;
            }
            PosixStdio::Buffer => {
                #[cfg(target_os = "linux")]
                'use_memfd: {
                    if !options.stream && i > 0 && bun_sys::can_use_memfd() {
                        // use memfd if we can
                        let label: &[u8] = match i {
                            0 => b"spawn_stdio_stdin",
                            1 => b"spawn_stdio_stdout",
                            2 => b"spawn_stdio_stderr",
                            _ => b"spawn_stdio_generic",
                        };

                        let fd = match bun_sys::memfd_create(label, bun_sys::MemfdFlag::CrossProcess)
                            .unwrap()
                        {
                            Ok(fd) => fd,
                            Err(_) => break 'use_memfd,
                        };

                        let _ = to_close_on_error.push(fd);
                        let _ = to_set_cloexec.push(fd);
                        actions.dup2(fd, fileno)?;
                        set_spawned_stdio(&mut spawned, i, fd);
                        spawned.memfds[i] = true;
                        continue;
                    }
                }

                let fds: [Fd; 2] = 'brk: {
                    let pair = if !options.no_sigpipe {
                        bun_sys::socketpair_for_shell(
                            libc::AF_UNIX,
                            libc::SOCK_STREAM,
                            0,
                            bun_sys::SocketpairMode::Blocking,
                        )
                        .unwrap()?
                    } else {
                        bun_sys::socketpair(
                            libc::AF_UNIX,
                            libc::SOCK_STREAM,
                            0,
                            bun_sys::SocketpairMode::Blocking,
                        )
                        .unwrap()?
                    };
                    break 'brk [pair[if i == 0 { 1 } else { 0 }], pair[if i == 0 { 0 } else { 1 }]];
                };

                // Note: we intentionally do NOT call shutdown() on the
                // socketpair fds. On SOCK_STREAM socketpairs, shutdown(fd, SHUT_WR)
                // sends a FIN to the peer, which causes programs that poll the
                // write end for readability (e.g. Python's asyncio connect_write_pipe)
                // to interpret it as "connection closed" and tear down their transport.
                // The socketpair is already used unidirectionally by convention.
                #[cfg(target_os = "macos")]
                {
                    // macOS seems to default to around 8 KB for the buffer size
                    // this is comically small.
                    // TODO: investigate if this should be adjusted on Linux.
                    let so_recvbuf: c_int = 1024 * 512;
                    let so_sendbuf: c_int = 1024 * 512;
                    // SAFETY: setsockopt with valid fds
                    unsafe {
                        if i == 0 {
                            libc::setsockopt(
                                fds[1].cast(),
                                libc::SOL_SOCKET,
                                libc::SO_RCVBUF,
                                &so_recvbuf as *const _ as *const c_void,
                                core::mem::size_of::<c_int>() as u32,
                            );
                            libc::setsockopt(
                                fds[0].cast(),
                                libc::SOL_SOCKET,
                                libc::SO_SNDBUF,
                                &so_sendbuf as *const _ as *const c_void,
                                core::mem::size_of::<c_int>() as u32,
                            );
                        } else {
                            libc::setsockopt(
                                fds[0].cast(),
                                libc::SOL_SOCKET,
                                libc::SO_RCVBUF,
                                &so_recvbuf as *const _ as *const c_void,
                                core::mem::size_of::<c_int>() as u32,
                            );
                            libc::setsockopt(
                                fds[1].cast(),
                                libc::SOL_SOCKET,
                                libc::SO_SNDBUF,
                                &so_sendbuf as *const _ as *const c_void,
                                core::mem::size_of::<c_int>() as u32,
                            );
                        }
                    }
                }

                to_close_at_end.push(fds[1]);
                to_close_on_error.push(fds[0]);

                if !options.sync {
                    bun_sys::set_nonblocking(fds[0]).unwrap()?;
                }

                actions.dup2(fds[1], fileno)?;
                if fds[1] != fileno {
                    actions.close(fds[1])?;
                }

                set_spawned_stdio(&mut spawned, i, fds[0]);
            }
            PosixStdio::Pipe(fd) => {
                actions.dup2(*fd, fileno)?;
                set_spawned_stdio(&mut spawned, i, *fd);
            }
        }
    }

    if dup_stdout_to_stderr {
        if let PosixStdio::Dup2(d) = stdio_options[1] {
            actions.dup2(d.to.to_fd(), d.out.to_fd())?;
        }
    }

    for (i, ipc) in options.extra_fds.iter().enumerate() {
        let fileno = Fd::from_native(FdT::try_from(3 + i).unwrap());

        match ipc {
            PosixStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
            PosixStdio::Inherit => {
                actions.inherit(fileno)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Ignore => {
                actions.open_z(fileno, b"/dev/null\0", bun_sys::O::RDWR, 0o664)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Path(path) => {
                actions.open(fileno, path, bun_sys::O::RDWR | bun_sys::O::CREAT, 0o664)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Ipc | PosixStdio::Buffer => {
                let is_ipc = matches!(ipc, PosixStdio::Ipc);
                let fds: [Fd; 2] = bun_sys::socketpair(
                    libc::AF_UNIX,
                    libc::SOCK_STREAM,
                    0,
                    if is_ipc {
                        bun_sys::SocketpairMode::Nonblocking
                    } else {
                        bun_sys::SocketpairMode::Blocking
                    },
                )
                .unwrap()?;

                if !options.sync && !is_ipc {
                    bun_sys::set_nonblocking(fds[0]).unwrap()?;
                }

                to_close_at_end.push(fds[1]);
                to_close_on_error.push(fds[0]);

                actions.dup2(fds[1], fileno)?;
                if fds[1] != fileno {
                    actions.close(fds[1])?;
                }
                extra_fds.push(ExtraPipe::OwnedFd(fds[0]));
            }
            PosixStdio::Pipe(fd) => {
                actions.dup2(*fd, fileno)?;
                // The fd was supplied by the caller (a number in the stdio array) and is
                // not owned by us. Record it so `stdio[N]` returns the caller's fd, but
                // mark it unowned so finalizeStreams leaves it open.
                extra_fds.push(ExtraPipe::UnownedFd(*fd));
            }
        }
    }

    // SAFETY: argv is null-terminated, argv[0] is non-null
    let argv0 = options.argv0.unwrap_or_else(|| unsafe { *argv });
    let spawn_result = posix_spawn::spawn_z(argv0, &actions, &attr, argv, envp);
    let mut failed_after_spawn = false;
    let _failed_guard = scopeguard::guard((), |_| {
        if failed_after_spawn {
            for fd in to_close_on_error.iter() {
                fd.close();
            }
        }
    });
    // TODO(port): errdefer — scopeguard captures `failed_after_spawn` by value;
    // Phase B: hoist into a struct or run cleanup inline at each return site.

    match spawn_result {
        Maybe::Err(err) => {
            failed_after_spawn = true;
            // manual cleanup (scopeguard limitation noted above)
            for fd in to_close_on_error.iter() {
                fd.close();
            }
            for fd in to_set_cloexec.iter() {
                let _ = bun_sys::set_close_on_exec(*fd);
            }
            for fd in to_close_at_end.iter() {
                fd.close();
            }
            return Ok(Maybe::Err(err));
        }
        Maybe::Result(pid) => {
            spawned.pid = pid;
            spawned.extra_pipes = extra_fds;

            #[cfg(target_os = "linux")]
            {
                // If it's spawnSync and we want to block the entire thread
                // don't even bother with pidfd. It's not necessary.
                if !options.can_block_entire_thread_to_reduce_cpu_usage_in_fast_path {
                    // Get a pidfd, which is a file descriptor that represents a process.
                    // This lets us avoid a separate thread to wait on the process.
                    match spawned.pifd_from_pid() {
                        Maybe::Result(pidfd) => {
                            spawned.pidfd = Some(pidfd);
                        }
                        Maybe::Err(err) => {
                            // we intentionally do not clean up any of the file descriptors in this case
                            // you could have data sitting in stdout, just waiting.
                            if err.get_errno() == bun_sys::E::SRCH {
                                spawned.has_exited = true;
                                // a real error occurred. one we should not assume means pidfd_open is blocked.
                            } else if !WaiterThread::should_use_waiter_thread() {
                                failed_after_spawn = true;
                                for fd in to_close_on_error.iter() {
                                    fd.close();
                                }
                                for fd in to_set_cloexec.iter() {
                                    let _ = bun_sys::set_close_on_exec(*fd);
                                }
                                for fd in to_close_at_end.iter() {
                                    fd.close();
                                }
                                return Ok(Maybe::Err(err));
                            }
                        }
                    }
                }
            }

            // success-path defer cleanup
            for fd in to_set_cloexec.iter() {
                let _ = bun_sys::set_close_on_exec(*fd);
            }
            for fd in to_close_at_end.iter() {
                fd.close();
            }
            return Ok(Maybe::Result(spawned));
        }
    }
}

#[cfg(unix)]
fn set_spawned_stdio(spawned: &mut PosixSpawnResult, i: usize, fd: Fd) {
    match i {
        0 => spawned.stdin = Some(fd),
        1 => spawned.stdout = Some(fd),
        2 => spawned.stderr = Some(fd),
        _ => unreachable!(),
    }
}

#[cfg(windows)]
pub fn spawn_process_windows(
    options: &WindowsSpawnOptions,
    argv: *const *const c_char,
    envp: *const *const c_char,
) -> Result<bun_sys::Result<WindowsSpawnResult>, bun_core::Error> {
    bun_core::mark_windows_only();
    bun_analytics::Features::spawn_inc();

    // SAFETY: all-zero is a valid uv_process_options_t
    let mut uv_process_options: uv::uv_process_options_t = unsafe { core::mem::zeroed() };

    uv_process_options.args = argv as *mut *mut c_char;
    uv_process_options.env = envp as *mut *mut c_char;
    // SAFETY: argv is null-terminated, argv[0] is non-null
    uv_process_options.file = options.argv0.unwrap_or_else(|| unsafe { *argv });
    uv_process_options.exit_cb = Some(Process::on_exit_uv);
    // PERF(port): was stack-fallback allocator (8192)
    let loop_ = options.windows.loop_.platform_event_loop().uv_loop;

    let mut cwd_buf = bun_paths::PathBuffer::uninit();
    cwd_buf[..options.cwd.len()].copy_from_slice(&options.cwd);
    cwd_buf[options.cwd.len()] = 0;
    // SAFETY: cwd_buf[options.cwd.len()] == 0 written above
    let cwd = unsafe { bun_str::ZStr::from_raw(cwd_buf.as_ptr(), options.cwd.len()) };

    uv_process_options.cwd = cwd.as_ptr() as *const c_char;

    let mut uv_files_to_close: Vec<uv::uv_file> = Vec::new();
    let mut failed = false;

    // defer: close uv_files_to_close — handled at each return site below
    // TODO(port): errdefer failed = true — handled inline

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
    stdio_containers.resize_with(3 + options.extra_fds.len(), || unsafe { core::mem::zeroed() });

    let stdio_options: [&WindowsStdio; 3] = [&options.stdin, &options.stdout, &options.stderr];

    // On Windows it seems don't have a dup2 equivalent with pipes
    // So we need to use file descriptors.
    // We can create a pipe with `uv_pipe(fds, 0, 0)` and get a read fd and write fd.
    // We give the write fd to stdout/stderr
    // And use the read fd to read from the output.
    let mut dup_fds: [uv::uv_file; 2] = [-1, -1];
    let mut dup_src: Option<u32> = None;
    let mut dup_tgt: Option<u32> = None;

    // PORT NOTE: Zig uses `inline for (0..3)` for comptime fd_i; we use a runtime loop.
    // PERF(port): was comptime monomorphization — profile in Phase B
    for fd_i in 0..3usize {
        let pipe_flags = uv::UV_CREATE_PIPE | uv::UV_READABLE_PIPE | uv::UV_WRITABLE_PIPE;
        let stdio: &mut uv::uv_stdio_container_t = &mut stdio_containers[fd_i];
        let flag: u32 = if fd_i == 0 { uv::O::RDONLY } else { uv::O::WRONLY };

        let mut treat_as_dup: bool = false;

        if fd_i == 1 && matches!(stdio_options[2], WindowsStdio::Dup2(_)) {
            treat_as_dup = true;
            dup_tgt = Some(u32::try_from(fd_i).unwrap());
        } else if fd_i == 2 && matches!(stdio_options[1], WindowsStdio::Dup2(_)) {
            treat_as_dup = true;
            dup_tgt = Some(u32::try_from(fd_i).unwrap());
        } else {
            match stdio_options[fd_i] {
                WindowsStdio::Dup2(_) => {
                    treat_as_dup = true;
                    dup_src = Some(u32::try_from(fd_i).unwrap());
                }
                WindowsStdio::Inherit => {
                    stdio.flags = uv::UV_INHERIT_FD;
                    stdio.data.fd = uv::uv_file::try_from(fd_i).unwrap();
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
                    // TODO(port): toPosixPath equivalent
                    let path_z = bun_paths::to_posix_path(path)?;
                    let rc = uv::uv_fs_open(
                        loop_,
                        &mut req,
                        path_z.as_ptr(),
                        (flag | uv::O::CREAT) as c_int,
                        0o644,
                        None,
                    );
                    req.deinit();
                    if let Some(err) = rc.to_error(bun_sys::Syscall::Open) {
                        failed = true;
                        cleanup_uv_files(&uv_files_to_close, loop_);
                        return Ok(Maybe::Err(err));
                    }
                    stdio.flags = uv::UV_INHERIT_FD;
                    let fd = rc.int();
                    uv_files_to_close.push(fd);
                    stdio.data.fd = fd;
                }
                WindowsStdio::Buffer(my_pipe) => {
                    my_pipe.init(loop_, false).unwrap()?;
                    stdio.flags = pipe_flags;
                    stdio.data.stream = my_pipe.as_ref() as *const _ as *mut uv::uv_stream_t;
                }
                WindowsStdio::Pipe(fd) => {
                    stdio.flags = uv::UV_INHERIT_FD;
                    stdio.data.fd = fd.uv();
                }
            }
        }

        if treat_as_dup {
            if fd_i == 1 {
                if let Some(e) = uv::uv_pipe(&mut dup_fds, 0, 0).err_enum() {
                    cleanup_uv_files(&uv_files_to_close, loop_);
                    return Ok(Maybe::Err(bun_sys::Error::from_code(e, bun_sys::Syscall::Pipe)));
                }
            }
            stdio.flags = uv::UV_INHERIT_FD;
            stdio.data.fd = dup_fds[1];
        }
    }

    for (i, ipc) in options.extra_fds.iter().enumerate() {
        let stdio: &mut uv::uv_stdio_container_t = &mut stdio_containers[3 + i];
        let flag: u32 = uv::O::RDWR;

        match ipc {
            WindowsStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
            WindowsStdio::Inherit => {
                stdio.flags = uv::StdioFlags::INHERIT_FD;
                stdio.data.fd = uv::uv_file::try_from(3 + i).unwrap();
            }
            WindowsStdio::Ignore => {
                stdio.flags = uv::UV_IGNORE;
            }
            WindowsStdio::Path(path) => {
                let mut req = uv::fs_t::uninitialized();
                let path_z = bun_paths::to_posix_path(path)?;
                let rc = uv::uv_fs_open(
                    loop_,
                    &mut req,
                    path_z.as_ptr(),
                    (flag | uv::O::CREAT) as c_int,
                    0o644,
                    None,
                );
                req.deinit();
                if let Some(err) = rc.to_error(bun_sys::Syscall::Open) {
                    failed = true;
                    cleanup_uv_files(&uv_files_to_close, loop_);
                    return Ok(Maybe::Err(err));
                }
                stdio.flags = uv::StdioFlags::INHERIT_FD;
                let fd = rc.int();
                uv_files_to_close.push(fd);
                stdio.data.fd = fd;
            }
            WindowsStdio::Ipc(my_pipe) => {
                my_pipe.init(loop_, true).unwrap()?;
                stdio.flags = uv::UV_CREATE_PIPE
                    | uv::UV_WRITABLE_PIPE
                    | uv::UV_READABLE_PIPE
                    | uv::UV_OVERLAPPED_PIPE;
                stdio.data.stream = my_pipe.as_ref() as *const _ as *mut uv::uv_stream_t;
            }
            WindowsStdio::Buffer(my_pipe) => {
                my_pipe.init(loop_, false).unwrap()?;
                stdio.flags = uv::UV_CREATE_PIPE
                    | uv::UV_WRITABLE_PIPE
                    | uv::UV_READABLE_PIPE
                    | uv::UV_OVERLAPPED_PIPE;
                stdio.data.stream = my_pipe.as_ref() as *const _ as *mut uv::uv_stream_t;
            }
            WindowsStdio::Pipe(fd) => {
                stdio.flags = uv::StdioFlags::INHERIT_FD;
                stdio.data.fd = fd.uv();
            }
        }
    }

    uv_process_options.stdio = stdio_containers.as_mut_ptr();
    uv_process_options.stdio_count = c_int::try_from(stdio_containers.len()).unwrap();
    uv_process_options.exit_cb = Some(Process::on_exit_uv);

    let process = Box::into_raw(Box::new(Process {
        ref_count: AtomicU32::new(1),
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
        (*process).poller = Poller::Uv(core::mem::zeroed());
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
        let Poller::Uv(ref mut uv_proc) = (*process).poller else { unreachable!() };
        uv_proc.spawn(loop_, &mut uv_process_options).to_error(bun_sys::Syscall::UvSpawn)
    };
    if let Some(err) = spawn_err {
        failed = true;
        cleanup_dup(true);
        cleanup_uv_files(&uv_files_to_close, loop_);
        // SAFETY: process is valid
        unsafe {
            (*process).close();
            (*process).deref();
        }
        return Ok(Maybe::Err(err));
    }

    // SAFETY: process is valid, poller is Uv
    unsafe {
        let Poller::Uv(ref uv_proc) = (*process).poller else { unreachable!() };
        (*process).pid = uv_proc.pid;
        debug_assert!(uv_proc.exit_cb == Some(Process::on_exit_uv));
    }

    let mut result = WindowsSpawnResult {
        // TODO(port): IntrusiveArc<Process> wrapping raw ptr
        process_: Some(unsafe { Arc::from_raw(process) }),
        extra_pipes: Vec::with_capacity(options.extra_fds.len()),
        ..Default::default()
    };

    for i in 0..3usize {
        let stdio = &stdio_containers[i];
        let result_stdio: &mut WindowsStdioResult = match i {
            0 => &mut result.stdin,
            1 => &mut result.stdout,
            2 => &mut result.stderr,
            _ => unreachable!(),
        };

        if dup_src == Some(u32::try_from(i).unwrap()) {
            *result_stdio = WindowsStdioResult::Unavailable;
        } else if dup_tgt == Some(u32::try_from(i).unwrap()) {
            *result_stdio = WindowsStdioResult::BufferFd(Fd::from_uv(dup_fds[0]));
        } else {
            match stdio_options[i] {
                WindowsStdio::Buffer(_) => {
                    // SAFETY: stdio.data.stream points to the Box<uv::Pipe> we set above
                    *result_stdio = WindowsStdioResult::Buffer(unsafe {
                        Box::from_raw(stdio.data.stream as *mut uv::Pipe)
                    });
                    // TODO(port): ownership transfer — the Box was held by
                    // options.{stdin,stdout,stderr}; here we're aliasing. Phase B:
                    // change WindowsStdio::Buffer to *mut uv::Pipe (FFI-owned).
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
                // SAFETY: see ownership note above
                result.extra_pipes.push(WindowsStdioResult::Buffer(unsafe {
                    Box::from_raw(stdio_containers[3 + i].data.stream as *mut uv::Pipe)
                }));
            }
            _ => {
                result.extra_pipes.push(WindowsStdioResult::Unavailable);
            }
        }
    }

    cleanup_dup(false);
    cleanup_uv_files(&uv_files_to_close, loop_);
    Ok(Maybe::Result(result))
}

#[cfg(windows)]
fn cleanup_uv_files(files: &[uv::uv_file], loop_: *mut uv::uv_loop_t) {
    for &fd in files {
        bun_aio::Closer::close(Fd::from_uv(fd), loop_);
    }
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
        pub fn to_stdio(&self) -> SpawnOptionsStdio {
            match self {
                SyncStdio::Inherit => SpawnOptionsStdio::inherit(),
                SyncStdio::Ignore => SpawnOptionsStdio::ignore(),
                SyncStdio::Buffer => {
                    #[cfg(windows)]
                    {
                        // SAFETY: all-zero is valid uv::Pipe
                        SpawnOptionsStdio::buffer(Box::new(unsafe {
                            core::mem::zeroed::<uv::Pipe>()
                        }))
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

    // TODO(port): unify constructor helpers across the two Stdio enums
    #[cfg(unix)]
    impl PosixStdio {
        fn inherit() -> Self { PosixStdio::Inherit }
        fn ignore() -> Self { PosixStdio::Ignore }
        fn buffer() -> Self { PosixStdio::Buffer }
    }
    #[cfg(windows)]
    impl WindowsStdio {
        fn inherit() -> Self { WindowsStdio::Inherit }
        fn ignore() -> Self { WindowsStdio::Ignore }
        fn buffer(p: Box<uv::Pipe>) -> Self { WindowsStdio::Buffer(p) }
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
    // deinit → Drop (Vec<u8> auto-frees)

    #[cfg(windows)]
    pub struct SyncWindowsPipeReader {
        pub chunks: Vec<Box<[u8]>>,
        pub pipe: Box<uv::Pipe>,
        pub err: bun_sys::E,
        pub context: *mut SyncWindowsProcess,
        pub on_done_callback:
            fn(*mut SyncWindowsProcess, OutFd, &[&[u8]], bun_sys::E),
        pub tag: OutFd,
    }

    #[cfg(windows)]
    impl SyncWindowsPipeReader {
        pub fn new(v: SyncWindowsPipeReader) -> Box<Self> {
            Box::new(v)
        }

        fn on_alloc(_this: &mut SyncWindowsPipeReader, suggested_size: usize) -> Box<[u8]> {
            vec![0u8; suggested_size].into_boxed_slice()
        }

        fn on_read(this: &mut SyncWindowsPipeReader, data: &[u8]) {
            // Zig: append @constCast(data) — the buffer was allocated by on_alloc
            // TODO(port): ownership of `data` — uv hands back a slice of the alloc'd
            // buffer. Phase B: store the Box returned from on_alloc, slice it here.
            this.chunks.push(Box::<[u8]>::from(data));
        }

        fn on_error(this: &mut SyncWindowsPipeReader, err: bun_sys::E) {
            this.err = err;
            this.pipe.close(Self::on_close);
        }

        extern "C" fn on_close(pipe: *mut uv::Pipe) {
            // SAFETY: pipe.data was set to *mut Self in start()
            let this: *mut SyncWindowsPipeReader = unsafe {
                (*pipe).get_data::<SyncWindowsPipeReader>()
                    .expect("Expected SyncWindowsPipeReader to have data")
            };
            // SAFETY: this is valid until we destroy it below
            let this_ref = unsafe { &mut *this };
            let context = this_ref.context;
            let chunks: Vec<&[u8]> =
                this_ref.chunks.iter().map(|c| c.as_ref()).collect();
            let err = if this_ref.err == bun_sys::E::CANCELED {
                bun_sys::E::SUCCESS
            } else {
                this_ref.err
            };
            let tag = this_ref.tag;
            let on_done_callback = this_ref.on_done_callback;
            // bun.default_allocator.destroy(this.pipe) — Box<uv::Pipe> drops with `this`
            // bun.default_allocator.destroy(this)
            // SAFETY: this was Box::into_raw'd; reclaim and drop
            drop(unsafe { Box::from_raw(this) });
            on_done_callback(context, tag, &chunks, err);
            // TODO(port): chunks borrows from `this` which we just dropped — Phase B:
            // move chunks out before dropping, or pass owned Vec<Box<[u8]>>.
        }

        pub fn start(self: &mut Box<Self>) -> Maybe<()> {
            let self_ptr = self.as_mut() as *mut SyncWindowsPipeReader;
            self.pipe.set_data(self_ptr);
            self.pipe.ref_();
            self.pipe.read_start(self_ptr, Self::on_alloc, Self::on_error, Self::on_read)
        }
    }

    #[cfg(windows)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum OutFd {
        Stdout,
        Stderr,
    }

    #[cfg(windows)]
    pub struct SyncWindowsProcess {
        pub stderr: Vec<Box<[u8]>>,
        pub stdout: Vec<Box<[u8]>>,
        pub err: bun_sys::E,
        pub waiting_count: u8,
        // TODO(port): IntrusiveArc vs Arc<Process>
        pub process: Arc<Process>,
        pub status: Option<Status>,
    }

    #[cfg(windows)]
    impl SyncWindowsProcess {
        pub fn new(v: SyncWindowsProcess) -> Box<Self> {
            Box::new(v)
        }

        pub fn on_process_exit(&mut self, status: Status, _: &Rusage) {
            self.status = Some(status);
            self.waiting_count -= 1;
            // SAFETY: unique access during sync spawn
            unsafe {
                let p = &mut *(Arc::as_ptr(&self.process) as *mut Process);
                p.detach();
            }
            // process.deref() — Arc drop happens in caller
            // TODO(port): Zig calls deref() here; with Arc<Process> we'd drop one
            // strong count. Phase B: use IntrusiveArc and call deref() explicitly.
        }

        pub fn on_reader_done(
            this: *mut SyncWindowsProcess,
            tag: OutFd,
            chunks: &[&[u8]],
            err: bun_sys::E,
        ) {
            // SAFETY: this is valid (back-ref from SyncWindowsPipeReader)
            let this = unsafe { &mut *this };
            let owned: Vec<Box<[u8]>> = chunks.iter().map(|c| Box::<[u8]>::from(*c)).collect();
            match tag {
                OutFd::Stderr => this.stderr = owned,
                OutFd::Stdout => this.stdout = owned,
            }
            if err != bun_sys::E::SUCCESS {
                this.err = err;
            }
            this.waiting_count -= 1;
        }
    }

    fn flatten_owned_chunks(chunks: Vec<Box<[u8]>>) -> Vec<u8> {
        let mut total_size: usize = 0;
        for chunk in &chunks {
            total_size += chunk.len();
        }
        let mut result = Vec::with_capacity(total_size);
        for chunk in chunks {
            result.extend_from_slice(&chunk);
            // chunks_allocator.free(chunk) — Box drops
        }
        // chunks_allocator.free(chunks) — Vec drops
        result
    }

    #[cfg(windows)]
    fn spawn_windows_without_pipes(
        options: &Options,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> core::result::Result<Maybe<Result>, bun_core::Error> {
        let loop_ = options.windows.loop_.platform_event_loop();
        let mut spawned = match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
            Maybe::Err(err) => return Ok(Maybe::Err(err)),
            Maybe::Result(proces) => proces,
        };

        let process = spawned.to_process((), true);
        let _detach_guard = scopeguard::guard((), |_| {
            // SAFETY: unique access during sync spawn
            unsafe {
                let p = &mut *(Arc::as_ptr(&process) as *mut Process);
                p.detach();
            }
            // process.deref() — Arc drops
        });
        // SAFETY: unique access during sync spawn
        unsafe {
            (&mut *(Arc::as_ptr(&process) as *mut Process)).enable_keeping_event_loop_alive();
        }

        while !process.has_exited() {
            loop_.run();
        }

        Ok(Maybe::Result(Result {
            status: process.status,
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
        let mut spawned = match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
            Maybe::Err(err) => return Ok(Maybe::Err(err)),
            Maybe::Result(process) => process,
        };
        let mut this = SyncWindowsProcess::new(SyncWindowsProcess {
            process: spawned.to_process((), true),
            stderr: Vec::new(),
            stdout: Vec::new(),
            err: bun_sys::E::SUCCESS,
            waiting_count: 1,
            status: None,
        });
        // this.process.ref() — Arc clone semantics; TODO(port): IntrusiveArc ref
        let this_ptr = this.as_mut() as *mut SyncWindowsProcess;
        // SAFETY: unique access
        unsafe {
            let p = &mut *(Arc::as_ptr(&this.process) as *mut Process);
            p.set_exit_handler(this_ptr);
            p.enable_keeping_event_loop_alive();
        }

        for (tag, stdio) in [(OutFd::Stdout, &spawned.stdout), (OutFd::Stderr, &spawned.stderr)] {
            if let WindowsStdioResult::Buffer(pipe) = stdio {
                // TODO(port): moving Box<uv::Pipe> out of `spawned` — Phase B: take()
                let mut reader = SyncWindowsPipeReader::new(SyncWindowsPipeReader {
                    context: this_ptr,
                    tag,
                    pipe: unsafe {
                        // SAFETY: ownership transfer; spawned.{stdout,stderr} not used after
                        core::ptr::read(pipe as *const Box<uv::Pipe>)
                    },
                    chunks: Vec::new(),
                    err: bun_sys::E::SUCCESS,
                    on_done_callback: SyncWindowsProcess::on_reader_done,
                });
                this.waiting_count += 1;
                match reader.start() {
                    Maybe::Err(err) => {
                        // SAFETY: unique access
                        unsafe {
                            let p = &mut *(Arc::as_ptr(&this.process) as *mut Process);
                            let _ = p.kill(1);
                        }
                        Output::panic(
                            format_args!(
                                "Unexpected error starting {} pipe reader\n{}",
                                <&'static str>::from(tag),
                                err
                            ),
                        );
                    }
                    Maybe::Result(()) => {
                        // reader is now owned by libuv via pipe.data
                        Box::leak(reader);
                    }
                }
            }
        }

        while this.waiting_count > 0 {
            loop_.platform_event_loop().tick();
        }

        let result = Result {
            status: this
                .status
                .expect("Expected Process to have exited when waiting_count == 0"),
            stdout: flatten_owned_chunks(core::mem::take(&mut this.stdout)),
            stderr: flatten_owned_chunks(core::mem::take(&mut this.stderr)),
        };
        // this.process.deref() — Arc drops with `this`
        Ok(Maybe::Result(result))
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
        let envp: *const *const c_char =
            options.envp.unwrap_or_else(|| unsafe { libc::environ as *const *const c_char });
        let argv = &options.argv;
        let mut string_builder = bun_str::StringBuilder::default();
        for arg in argv {
            string_builder.count_z(arg);
        }
        string_builder.allocate()?;

        let mut args: Vec<*const c_char> = Vec::with_capacity(argv.len() + 1);
        for arg in argv {
            // PERF(port): was assume_capacity
            args.push(string_builder.append_z(arg).as_ptr() as *const c_char);
        }
        args.push(core::ptr::null());

        spawn_with_argv(options, args.as_ptr(), envp)
    }

    // Forward signals from parent to the child process.
    // TODO(port): move to runtime_sys
    unsafe extern "C" {
        fn Bun__registerSignalsForForwarding();
        fn Bun__unregisterSignalsForForwarding();

        // macOS p_puniqueid descendant tracker — see NoOrphansTracker.cpp.
        fn Bun__noOrphans_begin(kq: c_int, root: libc::pid_t);
        fn Bun__noOrphans_releaseKq();
        fn Bun__noOrphans_onFork();
        fn Bun__noOrphans_onExit(pid: libc::pid_t);

        // The PID to forward signals to.
        // Set to 0 when unregistering.
        static mut Bun__currentSyncPID: i64;

        // Race condition: a signal could be sent before spawnProcessPosix returns.
        // We need to make sure to send it after the process is spawned.
        fn Bun__sendPendingSignalIfNecessary();
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
        // TODO(port): move to runtime_sys
        fn tcgetpgrp(fd: c_int) -> libc::pid_t;
        fn tcsetpgrp(fd: c_int, pgrp: libc::pid_t) -> c_int;
        fn getpgrp() -> libc::pid_t;
    }

    #[cfg(unix)]
    impl JobControl {
        pub fn is_active(&self) -> bool {
            self.prev > 0
        }

        fn give(&mut self, pgid: libc::pid_t) {
            self.script_pgid = pgid;
            // SAFETY: libc isatty
            if unsafe { libc::isatty(0) } == 0 {
                return;
            }
            // SAFETY: tcgetpgrp/getpgrp
            let fg = unsafe { tcgetpgrp(0) };
            // Only take the terminal if we *are* the foreground pgroup.
            // `bun run --no-orphans dev &` from an interactive shell leaves
            // stdin as the TTY (shells rely on SIGTTIN, not redirection), so
            // `tcgetpgrp` returns the shell's pgid — blocking SIGTTOU and
            // `tcsetpgrp`'ing anyway would steal the terminal from the user.
            // Same gate as `onChildStopped`'s resume path below; real shells
            // (bash `give_terminal_to`, zsh `attachtty`) do the same.
            if fg <= 0 || fg != unsafe { getpgrp() } {
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
        fn on_child_stopped(&self) {
            if self.prev <= 0 {
                return; // non-TTY: never asked for stop reports
            }
            Self::ttou_blocked(self.prev);
            // SIGTSTP is not in `Bun__registerSignalsForForwarding`'s set, so
            // default disposition (stop) applies and we suspend right here.
            // SAFETY: libc raise
            let _ = unsafe { libc::raise(libc::SIGTSTP) };
            // — resumed by the shell's SIGCONT —
            // SAFETY: tcgetpgrp/getpgrp
            if unsafe { tcgetpgrp(0) } == unsafe { getpgrp() } {
                Self::ttou_blocked(self.script_pgid);
            }
            // SAFETY: libc kill
            let _ = unsafe { libc::kill(-self.script_pgid, libc::SIGCONT) };
        }

        /// `tcsetpgrp` from a background pgroup raises SIGTTOU (default: stop);
        /// block it for the call per the standard job-control idiom.
        fn ttou_blocked(pgid: libc::pid_t) {
            // SAFETY: signal mask manipulation
            unsafe {
                let mut set: libc::sigset_t = core::mem::zeroed();
                let mut old: libc::sigset_t = core::mem::zeroed();
                libc::sigemptyset(&mut set);
                libc::sigemptyset(&mut old);
                libc::sigaddset(&mut set, libc::SIGTTOU);
                libc::sigprocmask(libc::SIG_BLOCK, &set, &mut old);
                let _ = tcsetpgrp(0, pgid);
                libc::sigprocmask(libc::SIG_SETMASK, &old, core::ptr::null_mut());
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
        let no_orphans = ParentDeathWatchdog::is_enabled()
            && !(cfg!(target_os = "macos") && options.use_execve_on_macos);

        // Snapshot pre-existing direct children so the disarm defer can tell
        // subreaper-adopted orphans (ppid==us) apart from `Bun.spawn` siblings
        // (also ppid==us). Typically empty — `bun run`/`bunx` have no JS VM —
        // but spawnSync can run inside a live VM (ffi.zig xcrun probe).
        #[cfg(target_os = "linux")]
        let mut siblings_buf = [0 as libc::pid_t; 64];
        #[cfg(target_os = "linux")]
        let siblings: &[libc::pid_t] = if no_orphans {
            ParentDeathWatchdog::snapshot_children(&mut siblings_buf)
        } else {
            &siblings_buf[0..0]
        };
        #[cfg(target_os = "linux")]
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
        #[cfg(target_os = "linux")]
        let _subreaper_guard = scopeguard::guard((), |_| {
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
        });

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
        #[allow(unused_mut)]
        let mut no_orphans_kq: Fd = bun_sys::INVALID_FD;
        #[cfg(target_os = "macos")]
        if no_orphans {
            // SAFETY: kqueue syscall
            let kq = unsafe { libc::kqueue() };
            if kq >= 0 {
                no_orphans_kq = Fd::from_native(kq);
            }
        }
        // LIFO: this runs LAST — after killSyncScriptTree() (which scans via
        // m_kq) and releaseKq().
        #[cfg(target_os = "macos")]
        let _kq_close_guard = scopeguard::guard((), |_| {
            if no_orphans_kq != bun_sys::INVALID_FD {
                no_orphans_kq.close();
            }
        });
        // LIFO: runs after killSyncScriptTree() (which needs m_kq live for
        // its NOTE_FORK-drain rescan), before the close above.
        #[cfg(target_os = "macos")]
        let _kq_release_guard = scopeguard::guard((), |_| {
            if no_orphans_kq != bun_sys::INVALID_FD {
                // SAFETY: FFI
                unsafe { Bun__noOrphans_releaseKq() };
            }
        });

        // SAFETY: extern static
        unsafe {
            Bun__currentSyncPID = 0;
            Bun__registerSignalsForForwarding();
        }
        let _signals_guard = scopeguard::guard((), |_| {
            // SAFETY: FFI
            unsafe { Bun__unregisterSignalsForForwarding() };
            bun_crash_handler::reset_on_posix();
        });

        let process = match spawn_process_posix(&options.to_spawn_options(no_orphans), argv, envp)? {
            Maybe::Err(err) => return Ok(Maybe::Err(err)),
            Maybe::Result(proces) => proces,
        };
        // Negative → kill() in the C++ signal forwarder targets the pgroup, so
        // a SIGTERM/SIGINT delivered to `bun run` reaches every descendant
        // that hasn't `setsid()`-escaped.
        // SAFETY: extern static
        unsafe {
            Bun__currentSyncPID = if no_orphans {
                -i64::from(process.pid)
            } else {
                i64::from(process.pid)
            };
        }

        let mut jc = JobControl { prev: 0, script_pgid: 0 };
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
            if no_orphans_kq != bun_sys::INVALID_FD {
                // SAFETY: FFI
                unsafe { Bun__noOrphans_begin(no_orphans_kq.native(), process.pid) };
            }
        }
        let _no_orphans_guard = scopeguard::guard((), |_| {
            if no_orphans {
                jc.restore();
                // pgroup → tracked uniqueids (macOS). Do NOT call the
                // getpid()-rooted `killDescendants()` here — `spawnSync` can be
                // reached from inside a live VM (ffi.zig xcrun probe, etc.) and
                // that would SIGKILL the user's unrelated `Bun.spawn` children.
                // The full-tree walk runs from `onProcessExit` when the whole
                // process is actually exiting.
                ParentDeathWatchdog::kill_sync_script_tree();
                if pgid_pushed {
                    ParentDeathWatchdog::pop_sync_pgid();
                }
                #[cfg(target_os = "linux")]
                {
                    // One last reap for anything we adopted as subreaper before
                    // the disarm defer above drops it (LIFO: this runs first).
                    loop {
                        match posix_spawn::wait4(-1, libc::WNOHANG, None) {
                            Maybe::Err(_) => break,
                            Maybe::Result(w) => {
                                if w.pid <= 0 {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });
        // TODO(port): errdefer — the above scopeguards capture `jc`/`no_orphans_kq`/
        // `siblings` by reference while still mutated below. Phase B: restructure
        // into a single RAII state struct (or run cleanup inline at each return).

        // SAFETY: FFI
        unsafe { Bun__sendPendingSignalIfNecessary() };

        let mut out: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
        let mut out_fds: [Fd; 2] = [
            process.stdout.unwrap_or(bun_sys::INVALID_FD),
            process.stderr.unwrap_or(bun_sys::INVALID_FD),
        ];
        let mut success = false;
        // defer cleanup — handled at end / via guards below
        // TODO(port): errdefer — manual cleanup at each error return below

        let mut out_fds_to_wait_for: [Fd; 2] = [
            process.stdout.unwrap_or(bun_sys::INVALID_FD),
            process.stderr.unwrap_or(bun_sys::INVALID_FD),
        ];

        if process.memfds[1] {
            out_fds_to_wait_for[0] = bun_sys::INVALID_FD;
        }
        if process.memfds[2] {
            out_fds_to_wait_for[1] = bun_sys::INVALID_FD;
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
            if no_orphans && (cfg!(target_os = "linux") || cfg!(target_os = "macos")) {
                let ppid = ParentDeathWatchdog::ppid_to_watch().unwrap_or(0);
                #[cfg(target_os = "macos")]
                let r: Option<Maybe<Status>> = wait_mac_kqueue(
                    process.pid,
                    ppid,
                    &jc,
                    no_orphans_kq,
                    &mut out,
                    &mut out_fds_to_wait_for,
                    &mut out_fds,
                );
                #[cfg(target_os = "linux")]
                let r: Option<Maybe<Status>> = wait_linux_signalfd(
                    process.pid,
                    ppid,
                    &jc,
                    &mut out,
                    &mut out_fds_to_wait_for,
                    &mut out_fds,
                );
                #[cfg(not(any(target_os = "linux", target_os = "macos")))]
                let r: Option<Maybe<Status>> = {
                    let _ = ppid;
                    None
                };
                if let Some(maybe) = r {
                    match maybe {
                        Maybe::Err(err) => {
                            cleanup_spawn_posix(&mut out, &out_fds, &process, success);
                            return Ok(Maybe::Err(err));
                        }
                        Maybe::Result(st) => break 'blk st,
                    }
                }
                // null: kqueue()/kevent-receipt failed — fall through to the
                // plain poll() loop so `.buffer` stdio still drains instead
                // of being dropped (or deadlocking) in a blind `wait4()`.
            }
            while out_fds_to_wait_for[0] != bun_sys::INVALID_FD
                || out_fds_to_wait_for[1] != bun_sys::INVALID_FD
            {
                for i in 0..2 {
                    if let Some(err) =
                        drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i])
                    {
                        cleanup_spawn_posix(&mut out, &out_fds, &process, success);
                        return Ok(Maybe::Err(err));
                    }
                }

                let mut poll_fds_buf: [libc::pollfd; 2] =
                    // SAFETY: zeroed pollfd is valid
                    unsafe { core::mem::zeroed() };
                let mut poll_len: usize = 0;
                for &fd in &out_fds_to_wait_for {
                    if fd == bun_sys::INVALID_FD {
                        continue;
                    }
                    poll_fds_buf[poll_len] = libc::pollfd {
                        fd: fd.cast(),
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
                    bun_sys::E::AGAIN | bun_sys::E::INTR => continue,
                    err => {
                        cleanup_spawn_posix(&mut out, &out_fds, &process, success);
                        return Ok(Maybe::Err(bun_sys::Error::from_code(err, bun_sys::Syscall::Poll)));
                    }
                }
            }
            reap_child(process.pid)
        };

        #[cfg(target_os = "linux")]
        {
            for (idx, &memfd) in process.memfds[1..].iter().enumerate() {
                if memfd {
                    out[idx] =
                        bun_sys::File::from(out_fds[idx]).read_to_end().bytes;
                    // TODO(port): bun_sys::File::read_to_end() API shape
                }
            }
        }

        success = true;
        let stdout = core::mem::take(&mut out[0]);
        let stderr = core::mem::take(&mut out[1]);
        cleanup_spawn_posix(&mut out, &out_fds, &process, success);
        Ok(Maybe::Result(Result { status, stdout, stderr }))
    }

    #[cfg(unix)]
    fn cleanup_spawn_posix(
        out: &mut [Vec<u8>; 2],
        out_fds: &[Fd; 2],
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
            // SAFETY: libc kill
            let _ = unsafe { libc::kill(process.pid, 1) };
        }

        for &fd in out_fds {
            if fd != bun_sys::INVALID_FD {
                fd.close();
            }
        }

        #[cfg(target_os = "linux")]
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
        if kq_fd == bun_sys::INVALID_FD {
            return None;
        }

        // udata tag for the ppid PROC filter. Descendant PROC knotes
        // (`child` here, plus any `scan()` adds) use udata=0; EVFILT_READ
        // udata 0/1 are a separate filter, so the dispatch checks `filter`
        // before `udata`.
        const TAG_PPID: usize = 2;

        // SAFETY: zeroed kevent is valid
        let mut changes_buf: [libc::kevent; 5] = unsafe { core::mem::zeroed() };
        let mut changes_len: usize = 0;
        let add = |list: &mut [libc::kevent; 5], len: &mut usize, ident: usize, filter: i16, fflags: u32, udata: usize| {
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
            add(&mut changes_buf, &mut changes_len, usize::try_from(ppid).unwrap(), libc::EVFILT_PROC, libc::NOTE_EXIT, TAG_PPID);
        }
        // NOTE_FORK so the wait loop wakes to scan whenever the script (or
        // any registered descendant) forks. NOTE_TRACK would have let xnu
        // auto-attach to the new child atomically, but it returns ENOTSUP on
        // every macOS since 10.5 — which previously made *this* registration
        // fail, the receipt loop below `return null`, and the caller fall
        // through to a plain `wait4()` that watches neither ppid nor
        // descendants (the `runDied=false` failure on darwin in CI).
        add(&mut changes_buf, &mut changes_len, usize::try_from(child).unwrap(), libc::EVFILT_PROC, libc::NOTE_FORK | libc::NOTE_EXIT, 0);
        // TTY job-control: EVFILT_PROC has no "stopped" note, so wake on
        // SIGCHLD and `wait4(WUNTRACED|WNOHANG)` to catch Ctrl-Z. Only when
        // stdin is a TTY — non-TTY callers never see stops, matching plain
        // `bun run`. EVFILT_SIGNAL coexists with the (default-ignore) SIGCHLD
        // disposition; only direct children raise SIGCHLD, so this fires for
        // `child` alone.
        if jc.is_active() {
            add(&mut changes_buf, &mut changes_len, libc::SIGCHLD as usize, libc::EVFILT_SIGNAL, 0, 0);
        }
        for (i, &fd) in out_fds_to_wait_for.iter().enumerate() {
            if fd != bun_sys::INVALID_FD {
                add(&mut changes_buf, &mut changes_len, usize::try_from(fd.cast()).unwrap(), libc::EVFILT_READ, 0, i);
            }
        }

        // SAFETY: zeroed kevent is valid
        let mut receipts: [libc::kevent; 5] = unsafe { core::mem::zeroed() };
        match bun_sys::kevent(kq_fd, &changes_buf[..changes_len], &mut receipts[..changes_len], None) {
            Maybe::Err(err) => return Some(Maybe::Err(err)),
            Maybe::Result(_) => {}
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
                    Global::exit(ParentDeathWatchdog::EXIT_CODE);
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
            // SAFETY: FFI
            unsafe { Bun__noOrphans_onExit(child) };
            return None;
        }
        // SAFETY: libc getppid
        if ppid > 1 && unsafe { libc::getppid() } != ppid {
            Global::exit(ParentDeathWatchdog::EXIT_CODE);
        }
        // Initial scan: `child` may have forked between `posix_spawn`
        // returning (in spawnPosix) and the NOTE_FORK registration above
        // taking effect; that fork produced no event. `begin()` already
        // seeded `m_seen` with `child`'s uniqueid, so this picks them up.
        // SAFETY: FFI
        unsafe { Bun__noOrphans_onFork() };

        // SAFETY: zeroed kevent is valid
        let mut events: [libc::kevent; 16] = unsafe { core::mem::zeroed() };
        let mut child_exited = false;
        let mut child_status: Option<Status> = None;
        loop {
            let got = match bun_sys::kevent(kq_fd, &[], &mut events[..], None) {
                Maybe::Err(err) => return Some(Maybe::Err(err)),
                Maybe::Result(c) => c,
            };
            let mut saw_fork = false;
            for ev in &events[..got] {
                if ev.filter == libc::EVFILT_PROC {
                    // ppid is the only PROC knote with udata != 0; descendant
                    // knotes (`child` above + any `scan()` added) use udata 0.
                    if ev.udata as usize == TAG_PPID {
                        if ev.fflags & libc::NOTE_EXIT != 0 {
                            Global::exit(ParentDeathWatchdog::EXIT_CODE);
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
                        // SAFETY: FFI
                        unsafe { Bun__noOrphans_onExit(libc::pid_t::try_from(ev.ident).unwrap()) };
                        if ev.ident == usize::try_from(child).unwrap() {
                            child_exited = true;
                        }
                    }
                } else if ev.filter == libc::EVFILT_SIGNAL {
                    // SIGCHLD: probe for a stop. May also observe the exit
                    // (racing NOTE_EXIT in this batch) — stash the status so
                    // `reapChild` below doesn't block on an already-reaped pid.
                    let r = posix_spawn::wait4(child, libc::WNOHANG | libc::WUNTRACED, None);
                    if let Maybe::Result(ref w) = r {
                        if w.pid == child {
                            if libc::WIFSTOPPED(w.status) {
                                jc.on_child_stopped();
                            } else {
                                child_status = Status::from(child, &r);
                                child_exited = true;
                                // wait4 just freed `child`'s pid; if NOTE_EXIT for
                                // it isn't in this batch we'd return with the root
                                // still in m_tracked and `killTracked()` would
                                // SIGSTOP a (potentially recycled) freed pid.
                                // Idempotent with the NOTE_EXIT handler above.
                                // SAFETY: FFI
                                unsafe { Bun__noOrphans_onExit(child) };
                            }
                        }
                    }
                } else if ev.filter == libc::EVFILT_READ {
                    let i: usize = ev.udata as usize;
                    if let Some(err) =
                        drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i])
                    {
                        return Some(Maybe::Err(err));
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
                // SAFETY: FFI
                unsafe { Bun__noOrphans_onFork() };
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
                return Some(Maybe::Result(child_status.unwrap_or_else(|| reap_child(child))));
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn wait_linux_signalfd(
        child: libc::pid_t,
        ppid: libc::pid_t,
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
            let mut libc_mask: libc::sigset_t = core::mem::zeroed();
            let mut old_mask: libc::sigset_t = core::mem::zeroed();
            libc::sigemptyset(&mut libc_mask);
            libc::sigemptyset(&mut old_mask);
            libc::sigaddset(&mut libc_mask, libc::SIGCHLD);
            libc::sigprocmask(libc::SIG_BLOCK, &libc_mask, &mut old_mask);
            let restore = scopeguard::guard(old_mask, |old| {
                libc::sigprocmask(libc::SIG_SETMASK, &old, core::ptr::null_mut());
            });
            // TODO(port): kernel sigset_t vs libc sigset_t — Zig uses
            // std.os.linux.sigemptyset/sigaddset for the signalfd mask. Phase B:
            // use the raw syscall with a u64 mask.
            let fd = {
                let mut kmask: libc::sigset_t = core::mem::zeroed();
                libc::sigemptyset(&mut kmask);
                libc::sigaddset(&mut kmask, libc::SIGCHLD);
                let rc = libc::signalfd(-1, &kmask, libc::SFD_CLOEXEC | libc::SFD_NONBLOCK);
                if rc >= 0 {
                    Fd::from_native(rc)
                } else {
                    bun_sys::INVALID_FD
                }
            };
            (fd, restore)
        };
        let _chld_close = scopeguard::guard((), |_| {
            if chld_fd != bun_sys::INVALID_FD {
                chld_fd.close();
            }
        });

        // Parent-death: pidfd when available (instant wake). When not
        // (gVisor, sandboxes, pre-5.3): bound the poll at 100ms and recheck
        // `getppid()`.
        let mut ppid_fd = bun_sys::INVALID_FD;
        if ppid > 1 {
            match bun_sys::pidfd_open(ppid, 0) {
                Maybe::Result(fd) => ppid_fd = Fd::from_native(fd),
                Maybe::Err(e) => {
                    if e.get_errno() == bun_sys::E::SRCH {
                        Global::exit(ParentDeathWatchdog::EXIT_CODE);
                    }
                }
            }
        }
        let _ppid_close = scopeguard::guard((), |_| {
            if ppid_fd != bun_sys::INVALID_FD {
                ppid_fd.close();
            }
        });
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
        let _pdeathsig_restore = scopeguard::guard((), |_| {
            if ppid > 1 {
                // SAFETY: prctl
                let _ = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) };
            }
        });
        // SAFETY: libc getppid
        if ppid > 1 && unsafe { libc::getppid() } != ppid {
            Global::exit(ParentDeathWatchdog::EXIT_CODE);
        }

        let need_ppid_fallback = ppid > 1 && ppid_fd == bun_sys::INVALID_FD;
        let timeout_ms: i32 =
            if need_ppid_fallback || chld_fd == bun_sys::INVALID_FD { 100 } else { -1 };

        let mut child_status: Option<Status> = None;
        loop {
            // Reap *before* poll(). Covers (a) the SIGCHLD-before-block race —
            // child may have exited between spawnProcessPosix and the
            // sigprocmask above, in which case the kernel discarded SIGCHLD
            // (default disposition is ignore) and signalfd will never wake;
            // (b) the no-signalfd fallback; (c) subreaper-adopted orphans that
            // would otherwise re-fire SIGCHLD forever. `wait4(-1)` is safe
            // here: spawnSync callers (`bun run`, `bunx`, CLI subcommands)
            // have no JS event loop and no other `Process` watchers — every
            // pid we see is either `child` or a subreaper-adopted orphan.
            //
            // WUNTRACED only on a TTY: bridges Ctrl-Z via `JobControl`.
            // Non-TTY callers never see stops, matching plain `bun run`.
            let wopts = libc::WNOHANG | if jc.is_active() { libc::WUNTRACED } else { 0 };
            loop {
                let r = posix_spawn::wait4(-1, wopts, None);
                let w = match &r {
                    Maybe::Err(_) => break,
                    Maybe::Result(w) => *w,
                };
                if w.pid <= 0 {
                    break;
                }
                if w.pid != child {
                    continue; // subreaper-adopted orphan reaped
                }
                if libc::WIFSTOPPED(w.status) {
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
                    return Some(Maybe::Err(err));
                }
            }

            // SAFETY: zeroed pollfd is valid
            let mut buf: [libc::pollfd; 4] = unsafe { core::mem::zeroed() };
            let mut pfds_len: usize = 0;
            let push = |l: &mut [libc::pollfd; 4], len: &mut usize, fd: Fd| {
                l[*len] = libc::pollfd {
                    fd: fd.cast(),
                    events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
                    revents: 0,
                };
                *len += 1;
            };
            for &fd in out_fds_to_wait_for.iter() {
                if fd != bun_sys::INVALID_FD {
                    push(&mut buf, &mut pfds_len, fd);
                }
            }
            let ppid_idx = pfds_len;
            if ppid_fd != bun_sys::INVALID_FD {
                push(&mut buf, &mut pfds_len, ppid_fd);
            }
            let chld_idx = pfds_len;
            if chld_fd != bun_sys::INVALID_FD {
                push(&mut buf, &mut pfds_len, chld_fd);
            }

            // SAFETY: valid pollfd array
            let rc = unsafe { libc::poll(buf.as_mut_ptr(), pfds_len as _, timeout_ms) };
            match bun_sys::get_errno(rc as isize) {
                bun_sys::E::SUCCESS => {}
                bun_sys::E::AGAIN | bun_sys::E::INTR => {}
                err => {
                    return Some(Maybe::Err(bun_sys::Error::from_code(err, bun_sys::Syscall::Poll)))
                }
            }

            if (ppid_fd != bun_sys::INVALID_FD && buf[ppid_idx].revents != 0)
                || (need_ppid_fallback && unsafe { libc::getppid() } != ppid)
            {
                Global::exit(ParentDeathWatchdog::EXIT_CODE);
            }

            // Drain the signalfd so the next poll blocks; the actual reap
            // happens at the top of the next iteration.
            if chld_fd != bun_sys::INVALID_FD && buf[chld_idx].revents != 0 {
                // SAFETY: zeroed signalfd_siginfo is valid for read target
                let mut si: libc::signalfd_siginfo = unsafe { core::mem::zeroed() };
                let si_bytes = unsafe {
                    core::slice::from_raw_parts_mut(
                        &mut si as *mut _ as *mut u8,
                        core::mem::size_of::<libc::signalfd_siginfo>(),
                    )
                };
                while bun_sys::read(chld_fd, si_bytes).unwrap_or(0)
                    == core::mem::size_of::<libc::signalfd_siginfo>()
                {}
            }
        }
        for i in 0..2 {
            let _ = drain_fd(&mut out_fds_to_wait_for[i], &mut out_fds[i], &mut out[i]);
        }
        Some(Maybe::Result(child_status.unwrap()))
    }

    /// Non-blocking drain of `fd` into `bytes`. Closes and invalidates both
    /// slots on EOF so the caller's deferred cleanup skips them; returns null
    /// on EOF/retry/EPIPE (caller keeps polling) or the recv/OOM error
    /// otherwise. Shared by the `poll()` path and the no-orphans wait loops.
    #[cfg(unix)]
    fn drain_fd(fd: &mut Fd, out_fd: &mut Fd, bytes: &mut Vec<u8>) -> Option<bun_sys::Error> {
        if *fd == bun_sys::INVALID_FD {
            return None;
        }
        loop {
            if bytes.try_reserve(16384).is_err() {
                return Some(bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Syscall::Recv));
            }
            let spare = bytes.spare_capacity_mut();
            // SAFETY: recvNonBlock writes into uninit bytes; we extend len by bytes_read
            let spare_slice = unsafe {
                core::slice::from_raw_parts_mut(spare.as_mut_ptr() as *mut u8, spare.len())
            };
            match bun_sys::recv_non_block(*fd, spare_slice) {
                Maybe::Err(err) => {
                    if err.is_retry() || err.get_errno() == bun_sys::E::PIPE {
                        return None;
                    }
                    return Some(err);
                }
                Maybe::Result(bytes_read) => {
                    // SAFETY: recv wrote `bytes_read` bytes into spare capacity
                    unsafe { bytes.set_len(bytes.len() + bytes_read) };
                    if bytes_read == 0 {
                        fd.close();
                        *fd = bun_sys::INVALID_FD;
                        *out_fd = bun_sys::INVALID_FD;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/process.zig (2927 lines)
//   confidence: low
//   todos:      45
//   notes:      Heavy defer/errdefer + @fieldParentPtr-on-union(enum) patterns; IntrusiveArc<Process> vs Arc (LIFETIMES.tsv conflict), scopeguard borrow conflicts, and uv::Pipe Box ownership all need Phase B rework. PollerWindows must become #[repr(C)] for offset_of.
// ──────────────────────────────────────────────────────────────────────────
