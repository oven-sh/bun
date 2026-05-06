use core::ffi::{c_char, c_int, c_void};
use core::mem::offset_of;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
// (std::sync::Arc removed — Process is intrusively ref-counted via
// bun_ptr::ThreadSafeRefCount; see SyncWindowsProcess below.)

use bun_aio::{FilePoll, KeepAlive};
use bun_core::{Environment, Global, Output};
use bun_aio::ParentDeathWatchdog;
use bun_event_loop::EventLoopHandle;
use bun_sys::{self, Fd, Maybe};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(not(windows))]
mod uv {
    //! libuv shim for non-Windows builds. The Zig source guards every `uv.*`
    //! reference behind `if (Environment.isWindows)`; the Rust draft references
    //! `uv::Pipe` / `uv::uv_process_t` in shared struct shapes. Phase B should
    //! `#[cfg(windows)]`-gate those fields instead.
    pub type Pipe = core::ffi::c_void;
    pub type uv_pid_t = i32;
}

// ─── §Dispatch: cross-tier exit handlers ─────────────────────────────────────
// Zig: `TaggedPointerUnion` of 12 concrete *Handler types living in higher-tier
// crates (cli::filter_run, cli::multi_run, cli::test, install, shell, webview,
// api::cron, api::Subprocess). Per PORTING.md §Dispatch (cold path — called
// once per process exit, callee does real work), the low tier defines a manual
// vtable and the high tier provides static instances. This breaks the import
// cycle without losing inlining where it doesn't matter.
//
// High-tier wiring (Phase B): each handler module defines
//   pub static EXIT_VTABLE: ProcessExitVTable = ProcessExitVTable {
//       on_process_exit: |p, proc, st, ru| unsafe { &mut *p.cast::<Self>() }.on_process_exit(proc, st, ru),
//   };
// and constructs `ProcessExitHandler { owner, vtable: &EXIT_VTABLE }`.

mod _exit_handler_variants {
    // Preserved for diff-pass: the Zig union members. All un-declared in B-2.
    use crate::cli::filter_run::ProcessHandle;
    use crate::cli::multi_run::ProcessHandle as MultiRunProcessHandle;
    use crate::cli::test::parallel_runner::Worker as TestWorkerHandle;
    // crate::api::cron::{CronRegisterJob, CronRemoveJob} — gated behind
    // cron::_jsc_gated (bun_jsc surface); vtable wired from there once un-gated.
    // crate::webview::{ChromeProcess, HostProcess} — `webview` module not yet
    // declared in runtime/lib.rs (blocked on bun_jsc method surface).
    use bun_install::{LifecycleScriptSubprocess, SecurityScanSubprocess};
    use crate::shell::Subprocess as ShellSubprocess;
    use crate::api::bun_subprocess::Subprocess;
}

// posix_spawn(2) wrappers live in the sibling `bun_spawn` module
// (src/runtime/api/bun/spawn.rs → `crate::api::bun_spawn::posix_spawn`).
#[allow(unused_imports)]
use super::bun_spawn::posix_spawn;
#[cfg(unix)]
#[allow(unused_imports)]
use posix_spawn::{Actions as PosixSpawnActions, Attr as PosixSpawnAttr};
/// `posix_spawn::WaitPidResult` — re-exported now that `super::bun_spawn` is
/// un-gated. `status` is `u32` there (Zig `c_int` reinterpreted via the
/// `W*` macros); `Status::from` casts before matching.
#[cfg(unix)]
pub use posix_spawn::WaitPidResult;
#[cfg(not(unix))]
#[derive(Clone, Copy)]
pub struct WaitPidResult {
    pub pid: PidT,
    pub status: c_int,
}

bun_core::declare_scope!(PROCESS, visible);

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

/// §Dispatch cold-path vtable. One static instance per high-tier handler type.
/// Replaces the Zig `TaggedPointerUnion` 12-way `inline switch`.
// PERF(port): was inline switch
#[derive(Clone, Copy)]
pub struct ProcessExitVTable {
    pub on_process_exit:
        unsafe fn(owner: *mut (), process: *mut Process, status: Status, rusage: *const Rusage),
}

#[derive(Clone, Copy)]
pub struct ProcessExitHandler {
    pub owner: *mut (),
    // PORT NOTE: stored by value (one fn ptr, `Copy`) instead of
    // `&'static ProcessExitVTable` so the generic `ProcessExitOwner::exit_vtable`
    // default can synthesise it without a per-type `static` item.
    pub vtable: Option<ProcessExitVTable>,
}

impl Default for ProcessExitHandler {
    fn default() -> Self {
        Self { owner: core::ptr::null_mut(), vtable: None }
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

/// Implemented by high-tier handler types that want to call
/// `Process::set_exit_handler(self_ptr)` Zig-style (no explicit vtable).
/// Replaces the Zig `TaggedPointerUnion` `inline switch` — see `_exit_handler_variants`.
pub trait ProcessExitOwner: Sized {
    /// Thunk invoked when the process exits. `this` is the owner pointer
    /// passed to `set_exit_handler`. Default impls in caller modules forward
    /// to the type's inherent `on_process_exit`.
    unsafe fn on_process_exit_dyn(
        this: *mut Self,
        process: *mut Process,
        status: Status,
        rusage: &Rusage,
    );

    /// Returns the vtable for this owner type. Generated per-`T` via a
    /// generic-monomorphised thunk.
    #[inline]
    fn exit_vtable() -> ProcessExitVTable {
        unsafe fn thunk<T: ProcessExitOwner>(
            owner: *mut (),
            process: *mut Process,
            status: Status,
            rusage: *const Rusage,
        ) {
            // SAFETY: owner was registered as `*mut T`; rusage is a valid
            // pointer for the duration of the call (see `ProcessExitHandler::call`).
            unsafe { T::on_process_exit_dyn(owner.cast::<T>(), process, status, &*rusage) }
        }
        ProcessExitVTable { on_process_exit: thunk::<Self> }
    }
}

impl ProcessExitHandler {
    /// Zig: `init(anytype)` — high-tier callers pass `(&mut self, &SELF_EXIT_VTABLE)`.
    pub fn init(&mut self, owner: *mut (), vtable: ProcessExitVTable) {
        self.owner = owner;
        self.vtable = Some(vtable);
    }

    pub fn call(&self, process: &mut Process, status: Status, rusage: &Rusage) {
        let Some(vt) = self.vtable else { return };
        if self.owner.is_null() {
            return;
        }
        // SAFETY: vtable was registered with a matching owner type by the
        // high-tier static; owner outlives the Process (it holds the strong ref).
        unsafe { (vt.on_process_exit)(self.owner, process, status, rusage) };
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
    pub ref_count: bun_ptr::ThreadSafeRefCount<Process>,
    pub exit_handler: ProcessExitHandler,
    pub sync: bool,
    pub event_loop: EventLoopHandle,
}

// bun.ptr.ThreadSafeRefCount → intrusive (FFI-crossing: *mut Process recovered
// via @fieldParentPtr in on_exit_uv / on_close_uv). Per PORTING.md §Pointers,
// keep the embedded count and impl `bun_ptr::ThreadSafeRefCounted`.
impl bun_ptr::ThreadSafeRefCounted for Process {
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::ThreadSafeRefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Process.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self) {
        // SAFETY: refcount hit 0; allocation came from Box::into_raw in init_posix/spawn.
        unsafe { drop(Box::from_raw(this)) };
    }
}

impl Process {
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    /// Low-level: set the exit handler from an explicit erased owner + vtable.
    pub fn set_exit_handler_raw(&mut self, owner: *mut (), vtable: ProcessExitVTable) {
        self.exit_handler.init(owner, vtable);
    }

    /// Zig: `setExitHandler(anytype)`. Stores `owner` together with a vtable
    /// synthesized from `T: ProcessExitOwner`. Takes `&self` (interior write
    /// through raw ptr) so it can be called through `Arc<Process>` — Process
    /// is intrusively ref-counted and treated as raw-ptr-mutable in Zig.
    pub fn set_exit_handler<T: ProcessExitOwner>(&self, owner: *mut T) {
        // SAFETY: Process is heap-allocated and never moved; exit_handler is a
        // POD (`*mut ()` + `Option<fn>`) so a raw write is sound and matches
        // the Zig single-threaded mutation model.
        unsafe {
            let this = self as *const Self as *mut Self;
            (*this).exit_handler.owner = owner.cast();
            (*this).exit_handler.vtable = Some(T::exit_vtable());
        }
    }

    /// Reset the exit handler to "no handler" (Zig: `exit_handler = .{}`).
    /// `&self` for the same reason as `set_exit_handler` — called via
    /// `Arc<Process>` from `closeProcess`.
    pub fn set_exit_handler_default(&self) {
        // SAFETY: see set_exit_handler.
        unsafe {
            let this = self as *const Self as *mut Self;
            (*this).exit_handler = ProcessExitHandler::default();
        }
    }

    pub fn has_exited(&self) -> bool {
        matches!(self.status, Status::Exited(_) | Status::Signaled(_) | Status::Err(_))
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
        unsafe { bun_ptr::ThreadSafeRefCount::<Process>::ref_(self as *mut _) };
    }

    #[inline]
    pub fn deref(&mut self) {
        // SAFETY: `self` is a live Process; destructor frees the Box if this
        // was the last ref.
        unsafe { bun_ptr::ThreadSafeRefCount::<Process>::deref(self as *mut _) };
    }

    /// Bridge `self.event_loop` (`EventLoopHandle`) to `bun_aio::EventLoopCtx`
    /// for FilePoll/KeepAlive calls. Zig used `anytype` and dispatched at
    /// comptime; the Rust port split this into two erased layers, so we
    /// reconstitute the aio-level ctx here.
    #[inline]
    fn event_loop_ctx(&self) -> bun_aio::EventLoopCtx {
        event_loop_handle_to_ctx(self.event_loop)
    }
}

/// Convert an `EventLoopHandle` to the aio-level `EventLoopCtx`.
///
/// `Mini` constructs the ctx directly from the published vtable. `Js` defers
/// to the `GET_VM_CTX_HOOK` global (registered by `crate::init()`) since
/// the JS event-loop ctx vtable lives in `bun_jsc` (T6) and bun_runtime is the
/// only crate that sees both. Per-thread there is exactly one JS event loop,
/// so the hook lookup is equivalent to dispatching on `owner`.
// TODO(port): once a `JS_EVENT_LOOP_CTX_VTABLE` static lands in bun_runtime,
// build the ctx from `owner` directly instead of the global hook.
#[inline]
pub(crate) fn event_loop_handle_to_ctx(handle: EventLoopHandle) -> bun_aio::EventLoopCtx {
    match handle {
        EventLoopHandle::Js { .. } => {
            bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
        }
        EventLoopHandle::Mini(mini) => bun_aio::EventLoopCtx {
            owner: mini.cast(),
            vtable: bun_event_loop::MINI_EVENT_LOOP_CTX_VTABLE,
        },
    }
}

// ─── posix_spawn / FilePoll / uv-backed Process methods ──────────────────────
// Un-gated: `super::bun_spawn::posix_spawn` (Actions/Attr/wait4) and the
// `bun_aio::FilePoll` method surface are stable. `EventLoopHandle` →
// `EventLoopCtx` bridging is local (`event_loop_handle_to_ctx`) until a
// JS-side ctx vtable lands.
impl Process {
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
        // bun.new → Box::into_raw (pointer crosses FFI / intrusive refcount)
        Box::into_raw(Box::new(Process {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            pid: posix.pid,
            #[cfg(target_os = "linux")]
            pidfd: posix.pidfd.unwrap_or(0),
            #[cfg(not(target_os = "linux"))]
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
        // Zig exactly: snapshot, assign status, detach-if-exited, then call.
        let exit_handler = self.exit_handler;
        self.status = status.clone();
        if self.has_exited() {
            self.detach();
        }
        exit_handler.call(self, status, rusage);
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

    #[cfg(unix)]
    pub fn on_wait_pid_from_waiter_thread(
        &mut self,
        waitpid_result: &bun_sys::Result<WaitPidResult>,
        rusage: &Rusage,
    ) {
        if let Poller::WaiterThread(waiter) = &mut self.poller {
            let ctx = event_loop_handle_to_ctx(self.event_loop);
            waiter.unref(ctx);
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

            #[cfg(target_os = "linux")]
            let watchfd = self.pidfd;
            #[cfg(not(target_os = "linux"))]
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
                    bun_aio::file_poll::FlagsSet::default(),
                    bun_aio::Owner::new(
                        bun_aio::posix_event_loop::poll_tag::PROCESS,
                        (self as *mut Process).cast(),
                    ),
                )
            };

            // SAFETY: `poll` is a live hive slot (just allocated or recycled).
            self.poller = Poller::Fd(unsafe { core::ptr::NonNull::new_unchecked(poll) });
            // SAFETY: poll is live; exclusive on this thread (event loop).
            let fd = unsafe { &mut *poll };
            fd.enable_keeping_process_alive(ctx);

            // SAFETY: `platform_event_loop` returns the live uws loop.
            let loop_ = unsafe { &mut *self.event_loop.platform_event_loop() };
            match fd.register(loop_, bun_aio::PollKind::Process, true) {
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

        if let Poller::Fd(poll) = &mut self.poller {
            // SAFETY: poll is a live hive slot, exclusive on the event-loop thread.
            let fd = unsafe { poll.as_mut() };
            // SAFETY: `platform_event_loop` returns the live uws loop.
            let loop_ = unsafe { &mut *self.event_loop.platform_event_loop() };
            let maybe = fd.register(loop_, bun_aio::PollKind::Process, true);
            if maybe.is_ok() {
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
        // Zig: `if (term_signal > 0) @enumFromInt(...)` on a non-exhaustive enum(u8).
        // Carry the raw byte; `Status::signal_code()` does the range-checked mapping.
        let signal_code: Option<u8> =
            if term_signal > 0 { Some(term_signal as u8) } else { None };
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
                Status::Exited(Exited { code: exit_code, signal: 0 }),
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
            // PORT NOTE: PollerPosix has Drop; match by &mut and disable in
            // place, then assign Detached so the old value is dropped (which
            // performs the same cleanup for Fd).
            match &mut self.poller {
                Poller::Fd(poll) => {
                    // SAFETY: poll is a live hive slot; deinit returns it to the Store.
                    unsafe { (*poll.as_ptr()).deinit() };
                }
                Poller::WaiterThread(waiter) => {
                    waiter.disable();
                }
                Poller::Detached => {}
            }
            self.poller = Poller::Detached;
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
                        let errno_ = bun_sys::get_errno(err as isize);
                        // if the process was already killed don't throw
                        if errno_ != bun_sys::E::ESRCH {
                            // TODO(port): bun_sys::Tag::kill — placeholder until full table.
                            return Err(bun_sys::Error::from_code(errno_, bun_sys::Tag::TODO));
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
                    if let Some(err) = handle.kill(signal).to_error(bun_sys::Tag::TODO) {
                        // if the process was already killed don't throw
                        if err.errno != bun_sys::E::ESRCH as i32 {
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
#[derive(Clone)]
pub enum Status {
    Running,
    Exited(Exited),
    /// Raw signal byte. Zig: `.signaled: bun.SignalCode` where `SignalCode` is a
    /// *non-exhaustive* `enum(u8) { …, _ }`, so any `u8` (incl. Linux RT signals
    /// 32..=64) is a valid payload. `bun_core::SignalCode` is exhaustive 1..=31,
    /// so storing it here would force lossy `Signaled→Exited` rewrites for RT
    /// signals — observable as `{exitCode:0, signal:null}` in JS. Carry the raw
    /// byte and range-check in `signal_code()` instead.
    Signaled(u8),
    Err(bun_sys::Error),
}

impl Default for Status {
    fn default() -> Self {
        Status::Running
    }
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
            return Some(Status::Exited(Exited { code, signal: signal.unwrap_or(0) }));
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
        if raw > 0 && raw <= bun_core::SignalCode::SIGSYS as u8 {
            // SAFETY: range-checked 1..=31; SignalCode is #[repr(u8)] with exactly
            // those discriminants.
            Some(unsafe { core::mem::transmute::<u8, bun_core::SignalCode>(raw) })
        } else {
            None
        }
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
        if (1..=31).contains(&n) { Some(128u8.wrapping_add(n)) } else { None }
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
    /// Hive-allocated `bun_aio::FilePoll` slot. Pointer (not `Box`) because the
    /// poll lives in `Store` (Zig: `*FilePoll`); freed via `FilePoll::deinit`,
    /// never via Rust `drop`.
    Fd(core::ptr::NonNull<FilePoll>),
    WaiterThread(KeepAlive),
    Detached,
}

#[cfg(unix)]
impl Drop for PollerPosix {
    fn drop(&mut self) {
        match self {
            // Zig `PollerPosix.deinit` (process.zig:689-695): `.fd => |fd| fd.deinit()`.
            // Normally `Process::close()` runs first and flips this to `Detached`, but
            // if `watch()`'s `fd.register()` fails (process.rs `watch` Err arm) the
            // poller is left as `Fd(poll)` and the caller may release its ref without
            // ever calling `close()`. Return the hive slot here so we don't leak it.
            PollerPosix::Fd(poll) => {
                // SAFETY: poll is a live hive-allocated `FilePoll` slot, exclusive on
                // the event-loop thread; `deinit()` returns it to the hive store.
                unsafe { (*poll.as_ptr()).deinit() };
            }
            PollerPosix::WaiterThread(w) => {
                w.disable();
            }
            PollerPosix::Detached => {}
        }
    }
}

#[cfg(unix)]
impl PollerPosix {
    fn into_fd(mut self) -> Option<core::ptr::NonNull<FilePoll>> {
        // PORT NOTE: reshaped for borrowck — Drop impl forbids partial move out of `self`.
        match core::mem::replace(&mut self, PollerPosix::Detached) {
            PollerPosix::Fd(f) => Some(f),
            _ => None,
        }
    }

    pub fn enable_keeping_event_loop_alive(&mut self, ctx: bun_aio::EventLoopCtx) {
        match self {
            PollerPosix::Fd(poll) => {
                // SAFETY: poll is a live hive slot, exclusive on the event-loop thread.
                unsafe { poll.as_mut() }.enable_keeping_process_alive(ctx);
            }
            PollerPosix::WaiterThread(waiter) => {
                waiter.ref_(ctx);
            }
            _ => {}
        }
    }

    pub fn disable_keeping_event_loop_alive(&mut self, ctx: bun_aio::EventLoopCtx) {
        match self {
            PollerPosix::Fd(poll) => {
                // SAFETY: see `enable_keeping_event_loop_alive`.
                unsafe { poll.as_mut() }.disable_keeping_process_alive(ctx);
            }
            PollerPosix::WaiterThread(waiter) => {
                waiter.unref(ctx);
            }
            _ => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            PollerPosix::Fd(fd) => {
                // SAFETY: see `enable_keeping_event_loop_alive`.
                unsafe { fd.as_ref() }.can_enable_keeping_process_alive()
            }
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

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
#[cfg(unix)]
pub mod waiter_thread_posix {
    use super::*;
    use bun_event_loop::AnyTaskWithExtraContext::{
        AnyTaskWithExtraContext, New as AnyTaskNew,
    };
    use bun_event_loop::ConcurrentTask::{ConcurrentTask, Task, TaskTag};
    use bun_event_loop::task_tag;
    use bun_threading::UnboundedQueue;
    use core::sync::atomic::AtomicPtr;

    pub struct WaiterThreadPosix {
        pub started: AtomicU32,
        #[cfg(target_os = "linux")]
        pub eventfd: Fd,
        #[cfg(not(target_os = "linux"))]
        pub eventfd: (),
        pub js_process: ProcessQueue,
    }

    pub type ProcessQueue = NewQueue<Process>;

    /// Zig: `fn NewQueue(comptime T: type) type` → generic struct.
    pub struct NewQueue<T: 'static> {
        pub queue: ConcurrentQueue<T>,
        // PORT NOTE: Zig active list holds raw `*T` whose strong ref was taken
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
    /// drained on the waiter thread (`TrivialNew`/`TrivialDeinit` in Zig).
    pub struct TaskQueueEntry<T: 'static> {
        pub process: *mut T,
        pub next: *mut TaskQueueEntry<T>,
    }

    // SAFETY: all four accessors route through the same `next` field; the
    // atomic variants reinterpret it as `AtomicPtr` (same layout/alignment as
    // `*mut TaskQueueEntry<T>`).
    unsafe impl<T: 'static> bun_threading::unbounded_queue::Node for TaskQueueEntry<T> {
        unsafe fn get_next(item: *mut Self) -> *mut Self {
            unsafe { (*item).next }
        }
        unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
            unsafe { (*item).next = ptr };
        }
        unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
            unsafe {
                (*(core::ptr::addr_of!((*item).next) as *const AtomicPtr<Self>)).load(ordering)
            }
        }
        unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
            unsafe {
                (*(core::ptr::addr_of!((*item).next) as *const AtomicPtr<Self>))
                    .store(ptr, ordering)
            };
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
            Box::into_raw(Box::new(v))
        }

        pub fn run_from_js_thread(self: Box<Self>) {
            self.run_from_main_thread();
        }

        pub fn run_from_main_thread(self: Box<Self>) {
            let this = *self;
            // bun.destroy(self) — Box dropped here.
            // SAFETY: subprocess strong-ref'd before append(); released by
            // on_wait_pid_from_waiter_thread → deref().
            unsafe {
                T::on_wait_pid_from_waiter_thread(this.subprocess, &this.result, &this.rusage)
            };
        }

        pub fn run_from_main_thread_mini(self: Box<Self>, _: *mut ()) {
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
            Box::into_raw(Box::new(v))
        }

        pub fn run_from_main_thread(self: Box<Self>) {
            let result = self.result;
            let subprocess = self.subprocess;
            // bun.destroy(self) — Box drops at end of scope.
            // SAFETY: see ResultTask::run_from_main_thread.
            unsafe {
                T::on_wait_pid_from_waiter_thread(subprocess, &result, &rusage_zeroed())
            };
        }

        /// Stored thunk for `AnyTaskWithExtraContext` (`fn(*mut T, *mut C)`
        /// shape — `C = ()`).
        pub extern "Rust" fn run_from_main_thread_mini(this: *mut Self, _: *mut ()) {
            // SAFETY: `this` was Box::into_raw'd in `loop_()` below; the mini
            // event loop hands ownership back here exactly once.
            unsafe { Box::from_raw(this) }.run_from_main_thread();
        }
    }

    /// Trait abstracting `process.pid` / `process.event_loop` /
    /// `process.onWaitPidFromWaiterThread` for generic `T` (only `Process`
    /// today). The Zig `comptime @TypeOf` switch in `append` is the moral
    /// equivalent.
    pub trait ProcessLike: 'static {
        /// `jsc::Task` tag for this `T`'s `ResultTask` — Zig derived this at
        /// comptime via `TaggedPointerUnion`; Rust callers supply it.
        const TASK_TAG: TaskTag;
        fn pid(this: *const Self) -> PidT;
        fn event_loop(this: *const Self) -> EventLoopHandle;
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
        fn pid(this: *const Self) -> PidT {
            // SAFETY: caller holds a strong ref.
            unsafe { (*this).pid }
        }
        #[inline]
        fn event_loop(this: *const Self) -> EventLoopHandle {
            // SAFETY: caller holds a strong ref.
            unsafe { (*this).event_loop }
        }
        #[inline]
        unsafe fn on_wait_pid_from_waiter_thread(
            this: *mut Self,
            result: &bun_sys::Result<WaitPidResult>,
            rusage: &Rusage,
        ) {
            // SAFETY: caller contract.
            unsafe { (*this).on_wait_pid_from_waiter_thread(result, rusage) };
        }
    }

    impl<T: ProcessLike> NewQueue<T> {
        pub fn append(&self, process: *mut T) {
            self.queue.push(Box::into_raw(Box::new(TaskQueueEntry {
                process,
                next: core::ptr::null_mut(),
            })));
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
                    // SAFETY: task was Box::into_raw'd in append().
                    let task = unsafe { Box::from_raw(task) };
                    // PERF(port): was assume_capacity
                    active.push(task.process);
                    // task drops here (TrivialDeinit)
                }
            }

            let mut i: usize = 0;
            while i < active.len() {
                let mut remove = false;

                let process = active[i];
                let pid = T::pid(process);
                // this case shouldn't really happen
                if pid == 0 {
                    remove = true;
                } else {
                    let mut rusage = rusage_zeroed();
                    let result =
                        posix_spawn::wait4(pid, libc::WNOHANG as u32, Some(&mut rusage));
                    let matched = match &result {
                        Err(_) => true,
                        Ok(r) => r.pid == pid,
                    };
                    if matched {
                        remove = true;

                        match T::event_loop(process) {
                            EventLoopHandle::Js { owner, vtable } => {
                                let ct = ConcurrentTask::create(Task::new(
                                    T::TASK_TAG,
                                    ResultTask::<T>::new(ResultTask {
                                        result,
                                        subprocess: process,
                                        rusage,
                                    })
                                    .cast(),
                                ));
                                // SAFETY: vtable contract.
                                unsafe { (vtable.enqueue_task_concurrent)(owner, ct) };
                            }
                            EventLoopHandle::Mini(mini) => {
                                let out = ResultTaskMini::<T>::new(ResultTaskMini {
                                    result,
                                    subprocess: process,
                                    task: AnyTaskWithExtraContext::default(),
                                });
                                // SAFETY: `out` just produced by Box::into_raw.
                                unsafe {
                                    (*out).task = AnyTaskNew::<ResultTaskMini<T>, ()>::init(
                                        out,
                                        ResultTaskMini::<T>::run_from_main_thread_mini,
                                    );
                                    (*mini).enqueue_task_concurrent(
                                        core::ptr::addr_of_mut!((*out).task),
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

    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);
    const STACK_SIZE: usize = 512 * 1024;

    // Singleton — Zig `pub var instance: WaiterThread = .{};`. The waiter
    // thread is the sole mutator of `js_process.active`; producers only touch
    // the lock-free `queue`. Wrapped so the address is stable for the SIGCHLD
    // handler / waiter loop without taking `&mut` to a `static mut`.
    struct Instance(core::cell::UnsafeCell<WaiterThreadPosix>);
    // SAFETY: see field-level access notes above.
    unsafe impl Sync for Instance {}
    static INSTANCE: Instance = Instance(core::cell::UnsafeCell::new(WaiterThreadPosix {
        started: AtomicU32::new(0),
        #[cfg(target_os = "linux")]
        eventfd: Fd::INVALID,
        #[cfg(not(target_os = "linux"))]
        eventfd: (),
        js_process: ProcessQueue::new(),
    }));

    #[inline]
    fn instance() -> *mut WaiterThreadPosix {
        INSTANCE.0.get()
    }

    impl WaiterThreadPosix {
        #[inline]
        pub fn set_should_use_waiter_thread() {
            SHOULD_USE_WAITER_THREAD.store(true, Ordering::Relaxed);
        }

        #[inline]
        pub fn should_use_waiter_thread() -> bool {
            SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
        }

        pub fn append(process: *mut Process) {
            // SAFETY: `js_process.queue` is an MPSC lock-free queue; `append`
            // is the producer half and only touches `queue`, never `active`.
            unsafe { (*instance()).js_process.append(process) };

            init().unwrap_or_else(|_| panic!("Failed to start WaiterThread"));

            #[cfg(target_os = "linux")]
            {
                let one: [u8; 8] = (1usize).to_ne_bytes();
                // SAFETY: eventfd valid after init(); write(2) is async-signal-safe.
                let _ = unsafe {
                    libc::write(
                        (*instance()).eventfd.native(),
                        one.as_ptr().cast(),
                        8,
                    )
                };
            }
        }

        pub fn reload_handlers() {
            if !SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed) {
                return;
            }

            #[cfg(target_os = "linux")]
            {
                // SAFETY: sigaction with a valid handler.
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

    pub fn init() -> Result<(), std::io::Error> {
        debug_assert!(SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed));

        // SAFETY: `started` is atomic; raced fetch_max is fine.
        if unsafe { (*instance()).started.fetch_max(1, Ordering::Relaxed) } > 0 {
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            // SAFETY: eventfd(2) syscall.
            let fd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC | 0) };
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

    #[cfg(target_os = "linux")]
    extern "C" fn wakeup(_: c_int) {
        let one: [u8; 8] = (1usize).to_ne_bytes();
        // SAFETY: eventfd is valid; called from signal handler — write(2) is
        // async-signal-safe.
        let _ = bun_sys::write(unsafe { (*instance()).eventfd }, &one).unwrap_or(0);
    }

    pub fn loop_() {
        // SAFETY: NUL-terminated literal.
        Output::Source::configure_named_thread(unsafe {
            bun_core::ZStr::from_raw(b"Waitpid\0".as_ptr(), 7)
        });
        WaiterThreadPosix::reload_handlers();
        // Keep the singleton as a raw pointer and dereference per-use. We must
        // NOT materialize a long-lived `&mut WaiterThreadPosix` here: the JS
        // thread's `append()` and the SIGCHLD handler `wakeup()` concurrently
        // form shared borrows of `js_process` / `eventfd` via the same
        // singleton, and a live `&mut` covering those fields would be UB
        // (aliased-&mut). The Zig spec uses a raw pointer with no noalias.
        let this: *mut WaiterThreadPosix = instance();

        #[allow(unused_labels)]
        'outer: loop {
            // SAFETY: raw-place field projection then auto-ref to `&NewQueue`;
            // coexists soundly with producer `&NewQueue` in `append()`.
            unsafe { (*this).js_process.loop_() };

            #[cfg(target_os = "linux")]
            {
                // SAFETY: `eventfd` is written once in `init()` before this
                // thread is spawned; read-only thereafter.
                let efd = unsafe { (*this).eventfd };
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
            #[cfg(not(target_os = "linux"))]
            {
                // SAFETY: sigwait with a valid (empty) mask.
                unsafe {
                    let mut mask: libc::sigset_t = core::mem::zeroed();
                    libc::sigemptyset(&mut mask);
                    let mut signal: c_int = libc::SIGCHLD;
                    let _rc = libc::sigwait(&mask, &mut signal);
                }
            }
        }
    }

}


mod waiter_thread_posix_body {
    // Preserved for diff-pass: the old gated draft. Dead — body merged into
    // `waiter_thread_posix` above.
    use super::*;
    pub struct WaiterThreadPosix(());
    static SHOULD_USE_WAITER_THREAD: AtomicBool = AtomicBool::new(false);
    impl WaiterThreadPosix {
        #[inline]
        pub fn should_use_waiter_thread() -> bool {
            SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed)
        }
        /// Intentionally a **no-op** while `waiter_thread_posix_body` is gated.
        ///
        /// The Zig spec flips a global so that subsequent `watch()` calls take
        /// the waiter-thread branch (process.zig:937-949). The body of that
        /// branch — `append()`/`init()`/`reload_handlers()` — is still
        /// ``-gated on `bun_threading::UnboundedQueue` +
        /// `bun_event_loop::ConcurrentTask`. If we let the flag flip now,
        /// `Process::watch()` would `self.ref_()` then call a stub `append()`,
        /// silently leaking the refcount and never reaping the child. Keeping
        /// the flag pinned to `false` forces the pidfd path (which is fully
        /// implemented) to stay in force; `pifd_from_pid` callers see the
        /// original `Err` and handle it.
        // TODO(b2-blocked): restore `SHOULD_USE_WAITER_THREAD.store(true, Relaxed)`
        // once `waiter_thread_posix_body` is un-gated and `append`/`reload_handlers`
        // forward to it.
        #[inline]
        pub fn set_should_use_waiter_thread() {
            let _ = &SHOULD_USE_WAITER_THREAD;
        }
        /// Zig (process.zig:976-991) installs a `SIGCHLD` handler iff the
        /// waiter thread is enabled. With `set_should_use_waiter_thread()` a
        /// no-op above, the flag is always `false`, so the spec-correct
        /// behaviour here is "do nothing".
        // TODO(b2-blocked): forward to `waiter_thread_posix_body::reload_handlers`.
        pub fn reload_handlers() {
            if !SHOULD_USE_WAITER_THREAD.load(Ordering::Relaxed) {
                return;
            }
            unreachable!("WaiterThread::reload_handlers: waiter_thread_posix_body is gated");
        }
        /// Enqueue a `Process` for the waiter thread.
        ///
        /// Unreachable while `set_should_use_waiter_thread()` is a no-op:
        /// every caller is guarded by `should_use_waiter_thread()`. Kept loud
        /// so that if the guard is ever bypassed we crash instead of silently
        /// dropping the registration (which would leak a `Process` ref and
        /// leave a zombie child — see process.zig:937-949).
        // TODO(b2-blocked): forward to `waiter_thread_posix_body::append` once un-gated.
        pub fn append(_process: *mut Process) {
            unreachable!(
                "WaiterThread::append reached while waiter_thread_posix_body is gated; \
                 set_should_use_waiter_thread() must remain a no-op until then"
            );
        }
    }
}

#[cfg(not(unix))]
pub mod WaiterThread {
    #[inline]
    pub fn should_use_waiter_thread() -> bool {
        false
    }
    pub fn set_should_use_waiter_thread() {}
    pub fn reload_handlers() {}
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

/// `bun.jsc.Subprocess.StdioKind` — defined here (not in `subprocess`) to keep
/// `process` leaf. The sibling `subprocess` module re-exports this.
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

#[derive(Clone, Copy)]
pub struct Dup2 {
    pub out: StdioKind,
    pub to: StdioKind,
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
    // Raw intrusive pointer (mirrors Zig `?*Process`). `Process` is intrusively
    // ref-counted via `bun_ptr::ThreadSafeRefCount` and recovered via
    // `@fieldParentPtr` from libuv callbacks; allocation is `Box::into_raw` and
    // destruction is `Box::from_raw` (see `ThreadSafeRefCounted::destructor`).
    // Wrapping a `Box`-allocated pointer in `std::sync::Arc::from_raw` is UB —
    // `Arc` expects an `ArcInner` header before the data — so this stays raw.
    pub process_: Option<*mut Process>,
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

// TODO(b2-blocked): Process is intrusively ref-counted; wire RefPtr<Process>
// once bun_ptr exposes a smart-pointer wrapper. For now process_ is *mut.

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
    #[cfg(windows)]
    pub pseudoconsole: Option<bun_sys::windows::HPCON>,
    #[cfg(not(windows))]
    pub pseudoconsole: Option<*mut c_void>,
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
    /// FFI-owned `uv::Pipe` (allocated via `Box::into_raw` in
    /// `create_zeroed_pipe`). Stored as a raw pointer so `spawn_process_windows`
    /// can transfer sole ownership into `WindowsStdioResult::Buffer` via
    /// `Box::from_raw` without double-freeing when `WindowsSpawnOptions` drops.
    Buffer(*mut uv::Pipe),
    /// See `Buffer` — same FFI ownership model.
    Ipc(*mut uv::Pipe),
    Pipe(Fd),
    Dup2(Dup2),
}

// TODO(b2-blocked): bun_libuv_sys::Pipe::close_and_destroy — Windows-only.

impl Drop for WindowsStdio {
    fn drop(&mut self) {
        // close_and_destroy consumes the pipe in Zig (frees the heap allocation).
        // The raw pointer may already have been transferred to a
        // `WindowsStdioResult`; callers that transfer ownership must replace the
        // variant (e.g. with `Ignore`) or null the pointer first.
        match self {
            WindowsStdio::Buffer(pipe) | WindowsStdio::Ipc(pipe) => {
                if !pipe.is_null() {
                    #[cfg(windows)]
                    // SAFETY: non-null heap allocation from create_zeroed_pipe.
                    unsafe { (**pipe).close_and_destroy() };
                    #[cfg(not(windows))]
                    {
                        // `uv::Pipe` is the c_void shim on non-Windows; this arm
                        // is unreachable (WindowsStdio is never constructed there).
                        let _ = pipe;
                    }
                }
            }
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
            ExtraPipe::Unavailable => Fd::INVALID,
        }
    }
}

impl PosixSpawnResult {
    pub fn close(&mut self) {
        use bun_sys::FdExt as _;
        for item in self.extra_pipes.iter() {
            match item {
                ExtraPipe::OwnedFd(f) => f.close(),
                ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
            }
        }
        self.extra_pipes.clear();
        self.extra_pipes.shrink_to_fit();
    }
}

impl PosixSpawnResult {
    #[cfg(unix)]
    pub fn to_process(self, event_loop: EventLoopHandle, sync_: bool) -> *mut Process {
        Process::init_posix(self, event_loop, sync_)
    }

    #[cfg(target_os = "linux")]
    fn pidfd_flags_for_linux() -> u32 {
        // pidfd_nonblock only supported in 5.10+. The Zig path consults
        // `analytics.kernel_version()` (semver compare); until that helper is
        // ported, optimistically request NONBLOCK and rely on the EINVAL retry
        // below to fall back on older kernels.
        // TODO(port): wire bun_analytics::kernel_version() once available.
        bun_sys::O::NONBLOCK as u32
    }

    #[cfg(target_os = "linux")]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        if WaiterThread::should_use_waiter_thread() {
            return Err(bun_sys::Error::from_code(bun_sys::E::ENOSYS, spawn_sys::TAG_PIDFD_OPEN));
        }

        let pidfd_flags = Self::pidfd_flags_for_linux();

        let attempt = 'brk: {
            let rc = spawn_sys::pidfd_open(
                i32::try_from(self.pid).unwrap(),
                pidfd_flags,
            );
            if let Err(e) = &rc {
                if e.get_errno() == bun_sys::E::EINVAL {
                    // Retry once, incase they don't support PIDFD_NONBLOCK.
                    break 'brk spawn_sys::pidfd_open(i32::try_from(self.pid).unwrap(), 0);
                }
            }
            rc
        };
        match attempt {
            Err(err) => {
                match err.get_errno() {
                    // seccomp filters can be used to block this system call or pidfd's altogether
                    // https://github.com/moby/moby/issues/42680
                    // so let's treat a bunch of these as actually meaning we should use the waiter thread fallback instead.
                    bun_sys::E::ENOSYS
                    // EOPNOTSUPP == ENOTSUP on Linux (both 95).
                    | bun_sys::E::ENOTSUP
                    | bun_sys::E::EPERM
                    | bun_sys::E::EACCES
                    | bun_sys::E::EINVAL => {
                        WaiterThread::set_should_use_waiter_thread();
                        return Err(err);
                    }

                    // No such process can happen if it exited between the time we got the pid and called pidfd_open
                    // Until we switch to CLONE_PIDFD, this needs to be handled separately.
                    bun_sys::E::ESRCH => {}

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
                                bun_sys::E::EINTR => continue,
                                _ => {}
                            }
                            break;
                        }
                    }
                }
                Err(err)
            }
            Ok(rc) => Ok(rc),
        }
    }

    #[cfg(not(target_os = "linux"))]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        Err(bun_sys::Error::from_code(bun_sys::E::ENOSYS, spawn_sys::TAG_PIDFD_OPEN))
    }
}

#[cfg(unix)]
pub type SpawnOptions = PosixSpawnOptions;
#[cfg(not(unix))]
pub type SpawnOptions = WindowsSpawnOptions;

#[cfg(unix)]
pub type Stdio = PosixStdio;
#[cfg(not(unix))]
pub type Stdio = WindowsStdio;

#[cfg(unix)]
pub type SpawnProcessResult = PosixSpawnResult;
#[cfg(not(unix))]
pub type SpawnProcessResult = WindowsSpawnResult;

// ─── spawn_process bodies + sync runner ──────────────────────────────────────
// Missing `bun_sys` surface (POSIX_SPAWN_* flags, set_close_on_exec,
// socketpair_for_shell, memfd helpers, pidfd_open, Syscall tags) is shimmed
// locally in `spawn_sys` so this file stays edit-only while the `bun_sys`
// crate catches up. All shims call straight through to libc / extern "C".
#[allow(dead_code)]
pub(crate) mod spawn_sys {
    use super::*;
    use core::ffi::c_int;

    // ── POSIX_SPAWN_* flags (Zig: bun.c.POSIX_SPAWN_*). ──
    // libc carries the standard ones; the Apple extensions are in `<spawn.h>`
    // but not exported by the `libc` crate, so define them by value.
    pub const POSIX_SPAWN_SETSIGDEF: i32 = libc::POSIX_SPAWN_SETSIGDEF as i32;
    pub const POSIX_SPAWN_SETSIGMASK: i32 = libc::POSIX_SPAWN_SETSIGMASK as i32;
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub const POSIX_SPAWN_SETSID: i32 = libc::POSIX_SPAWN_SETSID as i32;
    #[cfg(target_os = "macos")]
    pub const POSIX_SPAWN_CLOEXEC_DEFAULT: i32 = 0x4000; // _POSIX_SPAWN_CLOEXEC_DEFAULT (Apple <spawn.h>)
    #[cfg(target_os = "macos")]
    pub const POSIX_SPAWN_SETEXEC: i32 = 0x0040; // POSIX_SPAWN_SETEXEC (Apple <spawn.h>)

    // ── bun.sys.Tag aliases used below. The real Tag enum is `bun_sys::Tag`
    //    (opaque u16); until the full table lands, use a single placeholder so
    //    Error::from_code keeps the .syscall slot populated. ──
    pub const TAG_PIDFD_OPEN: bun_sys::Tag = bun_sys::Tag(0);
    pub const TAG_SOCKETPAIR: bun_sys::Tag = bun_sys::Tag(0);
    pub const TAG_FCNTL: bun_sys::Tag = bun_sys::Tag(0);
    pub const TAG_MEMFD_CREATE: bun_sys::Tag = bun_sys::Tag(0);

    pub const INVALID_FD: Fd = Fd::INVALID;

    /// Raw libc `environ` global (null-terminated `char **`). The `libc` crate
    /// doesn't export the `environ` static on all targets, so declare it here.
    /// Unlike `bun_sys::environ()` (which returns a counted slice), this
    /// returns the underlying null-terminated array pointer suitable for
    /// `posix_spawn` envp.
    #[cfg(unix)]
    pub fn raw_environ() -> *const *const c_char {
        unsafe extern "C" { static mut environ: *const *const c_char; }
        // SAFETY: `environ` is the process-global C environment array.
        unsafe { environ }
    }

    // ── set_close_on_exec — fcntl(FD_CLOEXEC). ──
    #[cfg(unix)]
    pub fn set_close_on_exec(fd: Fd) -> Maybe<()> {
        // SAFETY: fcntl(2) on a caller-supplied fd.
        unsafe {
            let prev = libc::fcntl(fd.native(), libc::F_GETFD);
            if prev < 0 {
                return Err(bun_sys::Error::from_code_int(errno_int(), TAG_FCNTL));
            }
            if libc::fcntl(fd.native(), libc::F_SETFD, prev | libc::FD_CLOEXEC) < 0 {
                return Err(bun_sys::Error::from_code_int(errno_int(), TAG_FCNTL));
            }
        }
        Ok(())
    }

    // ── socketpair / socketpair_for_shell (Zig: sys.socketpair / sys.socketpairForShell). ──
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum SocketpairMode { Blocking, Nonblocking }

    #[cfg(unix)]
    pub fn socketpair(
        domain: c_int,
        socktype: c_int,
        protocol: c_int,
        mode: SocketpairMode,
    ) -> Maybe<[Fd; 2]> {
        socketpair_impl(domain, socktype, protocol, mode, false)
    }

    #[cfg(unix)]
    pub fn socketpair_for_shell(
        domain: c_int,
        socktype: c_int,
        protocol: c_int,
        mode: SocketpairMode,
    ) -> Maybe<[Fd; 2]> {
        socketpair_impl(domain, socktype, protocol, mode, true)
    }

    #[cfg(unix)]
    fn socketpair_impl(
        domain: c_int,
        socktype: c_int,
        protocol: c_int,
        mode: SocketpairMode,
        for_shell: bool,
    ) -> Maybe<[Fd; 2]> {
        let mut fds: [c_int; 2] = [0; 2];
        // SAFETY: libc socketpair into a 2-int array.
        // Spec (sys.zig:3144-3166) loops on EINTR for both Linux and libc paths.
        loop {
            let rc = unsafe { libc::socketpair(domain, socktype, protocol, fds.as_mut_ptr()) };
            if rc != 0 {
                let e = errno_int();
                if e == libc::EINTR {
                    continue;
                }
                return Err(bun_sys::Error::from_code_int(e, TAG_SOCKETPAIR));
            }
            break;
        }
        let pair = [Fd::from_native(fds[0]), Fd::from_native(fds[1])];
        // CLOEXEC on the parent-kept end; the child end is dup2'd over.
        let _ = set_close_on_exec(pair[0]);
        let _ = set_close_on_exec(pair[1]);
        if mode == SocketpairMode::Nonblocking {
            let _ = bun_sys::set_nonblocking(pair[0]);
            let _ = bun_sys::set_nonblocking(pair[1]);
        }
        // macOS: spec (sys.zig:3180-3199) — when `for_shell`, set NEITHER fd's
        // SO_NOSIGPIPE (the child must receive SIGPIPE so `yes | head` terminates)
        // and instead bump RCVBUF/SNDBUF to 128 KB. When `!for_shell`, set
        // SO_NOSIGPIPE on BOTH fds.
        #[cfg(target_os = "macos")]
        {
            // SAFETY: setsockopt on freshly-created socketpair fds.
            unsafe {
                if for_shell {
                    let so_recvbuf: c_int = 1024 * 128;
                    let so_sendbuf: c_int = 1024 * 128;
                    libc::setsockopt(
                        fds[1], libc::SOL_SOCKET, libc::SO_RCVBUF,
                        &so_recvbuf as *const _ as *const c_void, core::mem::size_of::<c_int>() as u32,
                    );
                    libc::setsockopt(
                        fds[0], libc::SOL_SOCKET, libc::SO_SNDBUF,
                        &so_sendbuf as *const _ as *const c_void, core::mem::size_of::<c_int>() as u32,
                    );
                } else {
                    let on: c_int = 1;
                    libc::setsockopt(
                        fds[0], libc::SOL_SOCKET, libc::SO_NOSIGPIPE,
                        &on as *const _ as *const c_void, core::mem::size_of::<c_int>() as u32,
                    );
                    libc::setsockopt(
                        fds[1], libc::SOL_SOCKET, libc::SO_NOSIGPIPE,
                        &on as *const _ as *const c_void, core::mem::size_of::<c_int>() as u32,
                    );
                }
            }
        }
        let _ = for_shell;
        Ok(pair)
    }

    // ── memfd helpers (Linux). ──
    #[cfg(target_os = "linux")]
    static MEMFD_ENOSYS: AtomicBool = AtomicBool::new(false);

    #[cfg(target_os = "linux")]
    pub fn can_use_memfd() -> bool {
        !MEMFD_ENOSYS.load(Ordering::Relaxed)
    }

    #[derive(Clone, Copy)]
    pub enum MemfdFlag { CrossProcess, Private }

    #[cfg(target_os = "linux")]
    pub fn memfd_create(name: &[u8], flag: MemfdFlag) -> Maybe<Fd> {
        // CrossProcess → no MFD_CLOEXEC (the child needs to inherit it via dup2);
        // Private → MFD_CLOEXEC.
        let flags: u32 = match flag {
            MemfdFlag::CrossProcess => 0,
            MemfdFlag::Private => libc::MFD_CLOEXEC,
        };
        // name is a static byte string with no interior NUL; build a CString once.
        let cname = std::ffi::CString::new(name).unwrap_or_else(|_| std::ffi::CString::new("bun_memfd").unwrap());
        // SAFETY: libc memfd_create with a NUL-terminated name.
        let rc = unsafe { libc::memfd_create(cname.as_ptr(), flags) };
        if rc < 0 {
            let e = errno_int();
            if e == libc::ENOSYS || e == libc::EPERM || e == libc::EACCES {
                MEMFD_ENOSYS.store(true, Ordering::Relaxed);
            }
            return Err(bun_sys::Error::from_code_int(e, TAG_MEMFD_CREATE));
        }
        Ok(Fd::from_native(rc))
    }

    // ── pidfd_open (Linux). ──
    #[cfg(target_os = "linux")]
    pub fn pidfd_open(pid: libc::pid_t, flags: u32) -> Maybe<PidFdType> {
        // SAFETY: raw Linux syscall; SYS_pidfd_open available since 5.3.
        let rc = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as c_int, flags as c_int) };
        if rc < 0 {
            return Err(bun_sys::Error::from_code_int(errno_int(), TAG_PIDFD_OPEN));
        }
        Ok(rc as PidFdType)
    }

    #[inline]
    pub fn errno_int() -> c_int {
        // SAFETY: errno_location returns thread-local errno pointer.
        unsafe { *bun_sys::c::errno_location() }
    }

    #[inline]
    pub fn get_errno(rc: isize) -> bun_sys::E {
        bun_sys::get_errno(rc)
    }
}

mod spawn_process_body {
use super::*;
use super::spawn_sys;
use core::ffi::CStr;
use bun_sys::FdExt as _;

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

/// RAII fd cleanup matching the Zig `defer` (process.zig:1393-1403) and
/// `errdefer` (process.zig:1407-1411) in `spawnProcessPosix`. The `defer`
/// runs on *every* exit (set CLOEXEC on `to_set_cloexec`, then close
/// `to_close_at_end`); the `errdefer` additionally closes `to_close_on_error`
/// on error returns. `on_error` is disarmed on the success path.
///
/// This exists so that bare `?` on `actions.*` propagates without leaking
/// the parent-side socketpair ends pushed earlier in the loop.
#[cfg(unix)]
struct PosixSpawnFdGuard {
    to_set_cloexec: Vec<Fd>,
    to_close_at_end: Vec<Fd>,
    to_close_on_error: Vec<Fd>,
    on_error: bool,
}

#[cfg(unix)]
impl Drop for PosixSpawnFdGuard {
    fn drop(&mut self) {
        if self.on_error {
            for fd in self.to_close_on_error.iter() {
                fd.close();
            }
        }
        for fd in self.to_set_cloexec.iter() {
            let _ = spawn_sys::set_close_on_exec(*fd);
        }
        for fd in self.to_close_at_end.iter() {
            fd.close();
        }
    }
}

#[cfg(unix)]
pub fn spawn_process_posix(
    options: &PosixSpawnOptions,
    argv: *const *const c_char,
    envp: *const *const c_char,
) -> Result<bun_sys::Result<PosixSpawnResult>, bun_core::Error> {
    bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);
    let mut actions = PosixSpawnActions::init()?;
    // defer actions.deinit() — Drop

    let mut attr = PosixSpawnAttr::init()?;
    // defer attr.deinit() — Drop

    let mut flags: i32 = spawn_sys::POSIX_SPAWN_SETSIGDEF | spawn_sys::POSIX_SPAWN_SETSIGMASK;

    #[cfg(target_os = "macos")]
    {
        flags |= spawn_sys::POSIX_SPAWN_CLOEXEC_DEFAULT;

        if options.use_execve_on_macos {
            flags |= spawn_sys::POSIX_SPAWN_SETEXEC;

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
            flags |= spawn_sys::POSIX_SPAWN_SETSID;
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
    // Zig `defer` + `errdefer` cleanup → owned by an RAII guard so every `?`
    // (and every explicit `return Ok(Err(..))`) runs it. See PosixSpawnFdGuard.
    let mut cleanup = PosixSpawnFdGuard {
        to_set_cloexec: Vec::new(),
        to_close_at_end: Vec::new(),
        to_close_on_error: Vec::new(),
        on_error: true,
    };

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

    'stdio: for i in 0..3usize {
        let fileno = Fd::from_native(FdT::try_from(i).unwrap());
        let flag: u32 = (if i == 0 { bun_sys::O::RDONLY } else { bun_sys::O::WRONLY }) as u32;

        match stdio_options[i] {
            PosixStdio::Dup2(dup2) => {
                // This is a hack to get around the ordering of the spawn actions.
                // If stdout is set so that it redirects to stderr, the order of actions will be like this:
                // 0. dup2(stderr, stdout) - this makes stdout point to stderr
                // 1. setup stderr (will make stderr point to write end of `stderr_pipe_fds`)
                // This is actually wrong, 0 will execute before 1 so stdout ends up writing to stderr instead of the pipe
                // So we have to instead do `dup2(stderr_pipe_fd[1], stdout)`
                // Right now we only allow one output redirection so it's okay.
                if i == 1 && dup2.to == StdioKind::Stderr {
                    dup_stdout_to_stderr = true;
                } else {
                    actions.dup2(dup2.to.to_fd(), dup2.out.to_fd())?;
                }
            }
            PosixStdio::Inherit => {
                actions.inherit(fileno)?;
            }
            PosixStdio::Ipc | PosixStdio::Ignore => {
                actions.open_z(
                    fileno,
                    // SAFETY: literal is NUL-terminated with no interior NUL.
                    unsafe { CStr::from_bytes_with_nul_unchecked(b"/dev/null\0") },
                    flag | bun_sys::O::CREAT as u32,
                    0o664,
                )?;
            }
            PosixStdio::Path(path) => {
                actions.open(fileno, path, flag | bun_sys::O::CREAT as u32, 0o664)?;
            }
            PosixStdio::Buffer => {
                #[cfg(target_os = "linux")]
                'use_memfd: {
                    if !options.stream && i > 0 && spawn_sys::can_use_memfd() {
                        // use memfd if we can
                        let label: &[u8] = match i {
                            0 => b"spawn_stdio_stdin",
                            1 => b"spawn_stdio_stdout",
                            2 => b"spawn_stdio_stderr",
                            _ => b"spawn_stdio_generic",
                        };

                        let fd = match spawn_sys::memfd_create(label, spawn_sys::MemfdFlag::CrossProcess)
                        {
                            Ok(fd) => fd,
                            Err(_) => break 'use_memfd,
                        };

                        cleanup.to_close_on_error.push(fd);
                        cleanup.to_set_cloexec.push(fd);
                        actions.dup2(fd, fileno)?;
                        set_spawned_stdio(&mut spawned, i, fd);
                        spawned.memfds[i] = true;
                        continue 'stdio;
                    }
                }

                let fds: [Fd; 2] = 'brk: {
                    let pair_result = if !options.no_sigpipe {
                        spawn_sys::socketpair_for_shell(
                            libc::AF_UNIX,
                            libc::SOCK_STREAM,
                            0,
                            spawn_sys::SocketpairMode::Blocking,
                        )
                    } else {
                        spawn_sys::socketpair(
                            libc::AF_UNIX,
                            libc::SOCK_STREAM,
                            0,
                            spawn_sys::SocketpairMode::Blocking,
                        )
                    };
                    let pair = match pair_result {
                        Ok(p) => p,
                        Err(e) => return Ok(Err(e)),
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

                cleanup.to_close_at_end.push(fds[1]);
                cleanup.to_close_on_error.push(fds[0]);

                if !options.sync {
                    if let Err(e) = bun_sys::set_nonblocking(fds[0]) {
                        return Ok(Err(e));
                    }
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
                actions.open_z(
                    fileno,
                    // SAFETY: literal is NUL-terminated with no interior NUL.
                    unsafe { CStr::from_bytes_with_nul_unchecked(b"/dev/null\0") },
                    bun_sys::O::RDWR as u32,
                    0o664,
                )?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Path(path) => {
                actions.open(fileno, path, (bun_sys::O::RDWR | bun_sys::O::CREAT) as u32, 0o664)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Ipc | PosixStdio::Buffer => {
                let is_ipc = matches!(ipc, PosixStdio::Ipc);
                let fds: [Fd; 2] = match spawn_sys::socketpair(
                    libc::AF_UNIX,
                    libc::SOCK_STREAM,
                    0,
                    if is_ipc {
                        spawn_sys::SocketpairMode::Nonblocking
                    } else {
                        spawn_sys::SocketpairMode::Blocking
                    },
                ) {
                    Ok(p) => p,
                    Err(e) => return Ok(Err(e)),
                };

                if !options.sync && !is_ipc {
                    if let Err(e) = bun_sys::set_nonblocking(fds[0]) {
                        return Ok(Err(e));
                    }
                }

                cleanup.to_close_at_end.push(fds[1]);
                cleanup.to_close_on_error.push(fds[0]);

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
    // SAFETY: argv0 is a valid NUL-terminated C string (caller contract).
    let argv0_cstr = unsafe { CStr::from_ptr(argv0) };
    let spawn_result = posix_spawn::spawn_z(argv0_cstr, Some(&actions), Some(&attr), argv, envp);

    match spawn_result {
        Err(err) => {
            return Ok(Err(err));
        }
        Ok(pid) => {
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
                        Ok(pidfd) => {
                            spawned.pidfd = Some(pidfd);
                        }
                        Err(err) => {
                            // we intentionally do not clean up any of the file descriptors in this case
                            // you could have data sitting in stdout, just waiting.
                            if err.get_errno() == bun_sys::E::ESRCH {
                                spawned.has_exited = true;
                                // a real error occurred. one we should not assume means pidfd_open is blocked.
                            } else if !WaiterThread::should_use_waiter_thread() {
                                return Ok(Err(err));
                            }
                        }
                    }
                }
            }

            // Disarm `errdefer`; the unconditional `defer` (cloexec +
            // close_at_end) runs from `cleanup`'s Drop on the way out.
            cleanup.on_error = false;
            return Ok(Ok(spawned));
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
    bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);

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
                    // SAFETY: `my_pipe` is a non-null heap allocation from
                    // create_zeroed_pipe (Box::into_raw).
                    unsafe { (&mut **my_pipe).init(loop_, false) }.unwrap()?;
                    stdio.flags = pipe_flags;
                    stdio.data.stream = *my_pipe as *mut uv::uv_stream_t;
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
                // SAFETY: non-null heap allocation from create_zeroed_pipe.
                unsafe { (&mut **my_pipe).init(loop_, true) }.unwrap()?;
                stdio.flags = uv::UV_CREATE_PIPE
                    | uv::UV_WRITABLE_PIPE
                    | uv::UV_READABLE_PIPE
                    | uv::UV_OVERLAPPED_PIPE;
                stdio.data.stream = *my_pipe as *mut uv::uv_stream_t;
            }
            WindowsStdio::Buffer(my_pipe) => {
                // SAFETY: non-null heap allocation from create_zeroed_pipe.
                unsafe { (&mut **my_pipe).init(loop_, false) }.unwrap()?;
                stdio.flags = uv::UV_CREATE_PIPE
                    | uv::UV_WRITABLE_PIPE
                    | uv::UV_READABLE_PIPE
                    | uv::UV_OVERLAPPED_PIPE;
                stdio.data.stream = *my_pipe as *mut uv::uv_stream_t;
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
        // Intrusive raw pointer; refcount lives inside `Process` (see field comment).
        process_: Some(process),
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
                    // SAFETY: stdio.data.stream is the same `*mut uv::Pipe`
                    // produced by `Box::into_raw` in create_zeroed_pipe and
                    // stored in `options.{stdin,stdout,stderr}`. WindowsStdio
                    // holds it as a raw pointer with no Drop, so reconstructing
                    // the Box here is the *sole* ownership transfer.
                    *result_stdio = WindowsStdioResult::Buffer(unsafe {
                        Box::from_raw(stdio.data.stream as *mut uv::Pipe)
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
                // SAFETY: sole ownership transfer of the Box::into_raw'd
                // uv::Pipe; WindowsStdio holds it as raw `*mut` with no Drop.
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

// TODO(b2-blocked): `sync` runner depends on bun_str::StringBuilder,
// bun_crash_handler::reset_on_posix, ParentDeathWatchdog::push_sync_pgid,
// posix_spawn::wait4 shape, and the JobControl tcsetpgrp dance — un-gate
// alongside `bun.spawnSync` callers.

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
                        SpawnOptionsStdio::buffer(Box::into_raw(Box::new(unsafe {
                            core::mem::zeroed::<uv::Pipe>()
                        })))
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
        fn buffer(p: *mut uv::Pipe) -> Self { WindowsStdio::Buffer(p) }
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
    // deinit → Drop (Vec<u8> auto-frees)

    #[cfg(windows)]
    pub struct SyncWindowsPipeReader {
        pub chunks: Vec<Box<[u8]>>,
        pub pipe: Box<uv::Pipe>,
        pub err: bun_sys::E,
        pub context: *mut SyncWindowsProcess,
        pub on_done_callback:
            fn(*mut SyncWindowsProcess, OutFd, Vec<Box<[u8]>>, bun_sys::E),
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
            // Move ownership of the chunk allocations out *before* dropping
            // `this`, otherwise the callback would observe freed buffers.
            // Mirrors Zig process.zig:2009-2011, where `destroy(this)` only
            // frees the struct bytes and the ArrayList items survive to be
            // freed later by `flattenOwnedChunks`.
            let chunks: Vec<Box<[u8]>> = core::mem::take(&mut this_ref.chunks);
            let err = if this_ref.err == bun_sys::E::CANCELED {
                bun_sys::E::SUCCESS
            } else {
                this_ref.err
            };
            let tag = this_ref.tag;
            let on_done_callback = this_ref.on_done_callback;
            // bun.default_allocator.destroy(this.pipe) — Box<uv::Pipe> drops with `this`
            // bun.default_allocator.destroy(this)
            // SAFETY: this was Box::into_raw'd in start(); reclaim and drop
            drop(unsafe { Box::from_raw(this) });
            on_done_callback(context, tag, chunks, err);
        }

        pub fn start(self: Box<Self>) -> Maybe<()> {
            // Single-pointer ownership: `Box::into_raw` is the *only* root for
            // this allocation. Every subsequent access (including the libuv
            // callbacks and the `Box::from_raw` in `on_close`) goes through
            // this pointer, so no Stacked Borrows tag is invalidated by an
            // interleaved Box deref.
            let this: *mut SyncWindowsPipeReader = Box::into_raw(self);
            // SAFETY: just allocated; sole owner.
            unsafe {
                (*this).pipe.set_data(this);
                (*this).pipe.ref_();
                (*this).pipe.read_start(this, Self::on_alloc, Self::on_error, Self::on_read)
            }
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
        /// Intrusive-refcounted (Zig: `*Process`). Allocated via
        /// `Box::into_raw` in `to_process`; freed when the embedded
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
        /// take the already-live pointer instead. Mirrors Zig
        /// `this.process.detach(); this.process.deref();` (process.zig:2037).
        pub fn on_process_exit(
            this: *mut SyncWindowsProcess,
            process: *mut Process,
            status: Status,
            _: &Rusage,
        ) {
            // SAFETY: `this` is the Box::into_raw root from spawn_windows_with_pipes;
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
                (*process).deref();
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

    /// §Dispatch vtable for `SyncWindowsProcess` — forwards the
    /// `(owner, process, status, rusage)` quad straight through so
    /// `on_process_exit` can use the caller-provenance `process` pointer.
    #[cfg(windows)]
    static SYNC_WINDOWS_EXIT_VTABLE: ProcessExitVTable = ProcessExitVTable {
        on_process_exit: |owner, process, status, rusage| unsafe {
            SyncWindowsProcess::on_process_exit(
                owner.cast::<SyncWindowsProcess>(),
                process,
                status,
                &*rusage,
            )
        },
    };

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

        // `*mut Process` — intrusive refcount (Box::into_raw in to_process).
        let process: *mut Process = spawned.to_process((), true);
        let _detach_guard = scopeguard::guard(process, |process| {
            // SAFETY: sole owner during sync spawn; loop has drained, so no
            // uv callback holds a competing `&mut Process`. Mirrors Zig defer
            // `{ process.detach(); process.deref(); }`.
            unsafe {
                (*process).detach();
                (*process).deref();
            }
        });
        // SAFETY: just allocated; no other borrow live yet.
        unsafe {
            (*process).enable_keeping_event_loop_alive();
        }

        // SAFETY: read-only field access between uv ticks; the uv exit
        // callback's `&mut Process` does not overlap this `&Process`.
        while !unsafe { (*process).has_exited() } {
            loop_.run();
        }

        Ok(Maybe::Result(Result {
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
        let mut spawned = match spawn_process_windows(&options.to_spawn_options(false), argv, envp)? {
            Maybe::Err(err) => return Ok(Maybe::Err(err)),
            Maybe::Result(process) => process,
        };
        // Single-pointer ownership (mirrors Zig `bun.TrivialNew`): the
        // `Box::into_raw` result is the *only* root for this allocation. Every
        // field access below — including those inside uv callbacks fired from
        // `tick()` — goes through `this_ptr`, so no Box auto-deref ever
        // reasserts a Unique tag and pops the callbacks' tags under Stacked
        // Borrows.
        let this_ptr: *mut SyncWindowsProcess =
            Box::into_raw(SyncWindowsProcess::new(SyncWindowsProcess {
                process: spawned.to_process((), true),
                stderr: Vec::new(),
                stdout: Vec::new(),
                err: bun_sys::E::SUCCESS,
                waiting_count: 1,
                status: None,
            }));
        // SAFETY: `(*this_ptr).process` was just produced by `to_process` (sole
        // owner, mutable provenance from Box::into_raw). Mirrors Zig:
        // `this.process.ref(); this.process.setExitHandler(this);
        //  this.process.enableKeepingEventLoopAlive();`
        unsafe {
            let p = &mut *(*this_ptr).process;
            p.ref_();
            p.set_exit_handler_raw(this_ptr.cast(), SYNC_WINDOWS_EXIT_VTABLE);
            p.enable_keeping_event_loop_alive();
        }

        for (tag, stdio) in [
            (OutFd::Stdout, &mut spawned.stdout),
            (OutFd::Stderr, &mut spawned.stderr),
        ] {
            // Move ownership of the `Box<uv::Pipe>` out of `spawned` by
            // resetting the slot to `Unavailable`; otherwise `spawned`'s
            // auto-Drop at scope end would double-free the pipe already freed
            // via `SyncWindowsPipeReader::on_close`.
            let taken = core::mem::replace(stdio, WindowsStdioResult::Unavailable);
            if let WindowsStdioResult::Buffer(pipe) = taken {
                let reader = SyncWindowsPipeReader::new(SyncWindowsPipeReader {
                    context: this_ptr,
                    tag,
                    pipe,
                    chunks: Vec::new(),
                    err: bun_sys::E::SUCCESS,
                    on_done_callback: SyncWindowsProcess::on_reader_done,
                });
                // SAFETY: sole owner via `this_ptr`; no uv callback has fired yet.
                unsafe {
                    (*this_ptr).waiting_count += 1;
                }
                // `start` consumes the Box and transfers ownership to libuv
                // via pipe.data (Box::into_raw inside).
                match reader.start() {
                    Maybe::Err(err) => {
                        // SAFETY: sync spawn — `(*this_ptr).process` is the only
                        // handle and no uv callback has fired yet.
                        unsafe {
                            let _ = (*(*this_ptr).process).kill(1);
                        }
                        Output::panic(
                            format_args!(
                                "Unexpected error starting {} pipe reader\n{}",
                                <&'static str>::from(tag),
                                err
                            ),
                        );
                    }
                    Maybe::Result(()) => {}
                }
            }
        }

        // SAFETY: read-only field access between uv ticks; callbacks fired
        // inside `tick()` write through the same `this_ptr` root.
        while unsafe { (*this_ptr).waiting_count } > 0 {
            loop_.platform_event_loop().tick();
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
            (*(*this_ptr).process).deref();
            drop(Box::from_raw(this_ptr));
        }
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
            options.envp.unwrap_or_else(|| spawn_sys::raw_environ());
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
        let mut no_orphans_kq: Fd = spawn_sys::INVALID_FD;
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
            if no_orphans_kq != spawn_sys::INVALID_FD {
                no_orphans_kq.close();
            }
        });
        // LIFO: runs after killSyncScriptTree() (which needs m_kq live for
        // its NOTE_FORK-drain rescan), before the close above.
        #[cfg(target_os = "macos")]
        let _kq_release_guard = scopeguard::guard((), |_| {
            if no_orphans_kq != spawn_sys::INVALID_FD {
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
            Maybe::Ok(proces) => proces,
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
            if no_orphans_kq != spawn_sys::INVALID_FD {
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
                        match posix_spawn::wait4(-1, libc::WNOHANG as u32, None) {
                            Maybe::Err(_) => break,
                            Maybe::Ok(w) => {
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
            process.stdout.unwrap_or(spawn_sys::INVALID_FD),
            process.stderr.unwrap_or(spawn_sys::INVALID_FD),
        ];
        let mut success = false;
        // defer cleanup — handled at end / via guards below
        // TODO(port): errdefer — manual cleanup at each error return below

        let mut out_fds_to_wait_for: [Fd; 2] = [
            process.stdout.unwrap_or(spawn_sys::INVALID_FD),
            process.stderr.unwrap_or(spawn_sys::INVALID_FD),
        ];

        if process.memfds[1] {
            out_fds_to_wait_for[0] = spawn_sys::INVALID_FD;
        }
        if process.memfds[2] {
            out_fds_to_wait_for[1] = spawn_sys::INVALID_FD;
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
                        Maybe::Ok(st) => break 'blk st,
                    }
                }
                // null: kqueue()/kevent-receipt failed — fall through to the
                // plain poll() loop so `.buffer` stdio still drains instead
                // of being dropped (or deadlocking) in a blind `wait4()`.
            }
            while out_fds_to_wait_for[0] != spawn_sys::INVALID_FD
                || out_fds_to_wait_for[1] != spawn_sys::INVALID_FD
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
                    if fd == spawn_sys::INVALID_FD {
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
                        cleanup_spawn_posix(&mut out, &out_fds, &process, success);
                        return Ok(Maybe::Err(bun_sys::Error::from_code(err, bun_sys::Tag::poll)));
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
                        bun_sys::File::from(out_fds[idx]).read_to_end().unwrap_or_default();
                }
            }
        }

        success = true;
        let stdout = core::mem::take(&mut out[0]);
        let stderr = core::mem::take(&mut out[1]);
        cleanup_spawn_posix(&mut out, &out_fds, &process, success);
        Ok(Maybe::Ok(Result { status, stdout, stderr }))
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
            if fd != spawn_sys::INVALID_FD {
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
        if kq_fd == spawn_sys::INVALID_FD {
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
            if fd != spawn_sys::INVALID_FD {
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
                    spawn_sys::INVALID_FD
                }
            };
            (fd, restore)
        };
        let _chld_close = scopeguard::guard((), |_| {
            if chld_fd != spawn_sys::INVALID_FD {
                chld_fd.close();
            }
        });

        // Parent-death: pidfd when available (instant wake). When not
        // (gVisor, sandboxes, pre-5.3): bound the poll at 100ms and recheck
        // `getppid()`.
        let mut ppid_fd = spawn_sys::INVALID_FD;
        if ppid > 1 {
            match spawn_sys::pidfd_open(ppid, 0) {
                Maybe::Ok(fd) => ppid_fd = Fd::from_native(fd),
                Maybe::Err(e) => {
                    if e.get_errno() == bun_sys::E::ESRCH {
                        Global::exit(ParentDeathWatchdog::EXIT_CODE as u32);
                    }
                }
            }
        }
        let _ppid_close = scopeguard::guard((), |_| {
            if ppid_fd != spawn_sys::INVALID_FD {
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

        let need_ppid_fallback = ppid > 1 && ppid_fd == spawn_sys::INVALID_FD;
        let timeout_ms: i32 =
            if need_ppid_fallback || chld_fd == spawn_sys::INVALID_FD { 100 } else { -1 };

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
            let wopts: u32 = (libc::WNOHANG | if jc.is_active() { libc::WUNTRACED } else { 0 }) as u32;
            loop {
                let r = posix_spawn::wait4(-1, wopts, None);
                let w = match &r {
                    Maybe::Err(_) => break,
                    Maybe::Ok(w) => *w,
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
                    fd: fd.native(),
                    events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
                    revents: 0,
                };
                *len += 1;
            };
            for &fd in out_fds_to_wait_for.iter() {
                if fd != spawn_sys::INVALID_FD {
                    push(&mut buf, &mut pfds_len, fd);
                }
            }
            let ppid_idx = pfds_len;
            if ppid_fd != spawn_sys::INVALID_FD {
                push(&mut buf, &mut pfds_len, ppid_fd);
            }
            let chld_idx = pfds_len;
            if chld_fd != spawn_sys::INVALID_FD {
                push(&mut buf, &mut pfds_len, chld_fd);
            }

            // SAFETY: valid pollfd array
            let rc = unsafe { libc::poll(buf.as_mut_ptr(), pfds_len as _, timeout_ms) };
            match bun_sys::get_errno(rc as isize) {
                bun_sys::E::SUCCESS => {}
                bun_sys::E::EAGAIN | bun_sys::E::EINTR => {}
                err => {
                    return Some(Maybe::Err(bun_sys::Error::from_code(err, bun_sys::Tag::poll)))
                }
            }

            if (ppid_fd != spawn_sys::INVALID_FD && buf[ppid_idx].revents != 0)
                || (need_ppid_fallback && unsafe { libc::getppid() } != ppid)
            {
                Global::exit(ParentDeathWatchdog::EXIT_CODE);
            }

            // Drain the signalfd so the next poll blocks; the actual reap
            // happens at the top of the next iteration.
            if chld_fd != spawn_sys::INVALID_FD && buf[chld_idx].revents != 0 {
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
        if *fd == spawn_sys::INVALID_FD {
            return None;
        }
        loop {
            if bytes.try_reserve(16384).is_err() {
                return Some(bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::recv));
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
                        *fd = spawn_sys::INVALID_FD;
                        *out_fd = spawn_sys::INVALID_FD;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/process.zig (2927 lines)
//   confidence: low
//   todos:      48
//   notes:      B-2 un-gate: Process impl (init_posix/on_exit/watch/watch_or_reap/rewatch/close/kill/enable+disable_keeping_event_loop_alive), PollerPosix impl, PosixSpawnResult::to_process now real. PollerPosix::Fd holds NonNull<FilePoll> (hive slot). EventLoopHandle→EventLoopCtx bridged via local event_loop_handle_to_ctx (Js arm uses GET_VM_CTX_HOOK). WaiterThreadPosix full body un-gated: append/reload_handlers/init/loop_ real (UnboundedQueue<TaskQueueEntry> + ConcurrentTask::create + AnyTaskWithExtraContext::New::init). sync runner remains gated. PollerWindows must become #[repr(C)] for offset_of.
// ──────────────────────────────────────────────────────────────────────────
