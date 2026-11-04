//! Implements the event loop part of libuv's API for N-API addons on POSIX:
//! `uv_default_loop`, the `uv_async_t`, `uv_idle_t`, `uv_prepare_t`, `uv_check_t`
//! `uv_timer_t` and `uv_udp_t` handles, `uv_queue_work`, and the `uv_handle_t` functions.
//! Every other `uv_*` symbol is a crash stub (uv-posix-stubs.c) or a header-only
//! polyfill (uv-posix-polyfills.c). Bun doesn't run a libuv loop on POSIX, so
//! these functions run on the VM's event loop. They follow libuv's ABI and
//! threading rules:
//!
//! - The addon allocates each handle or request and reads `data`, `loop` and
//!   `type` from it ([`UvHandle`], [`UvReq`]). Bun owns the fields after those.
//! - Only `uv_async_send` may be called off the loop's JS thread. A handle is valid
//!   until its `close_cb` has run, and a request until its `after_work_cb` has run.
//! - A `uv_loop_t*` points to a [`UvLoop`]. Each VM has one. Only its `data` word is ABI.
//! - `uv_async_send` sets the handle's `pending` flag and posts at most one
//!   dispatch task per loop through the VM's [`VmHandle`], where libuv writes to an
//!   eventfd. The task walks the loop's handles on the JS thread like `uv__async_io`.
//! - `auto_tick` (jsc_hooks.rs) runs idle and prepare handles before it polls and
//!   check handles after. It doesn't block while an idle handle is started.
//! - A timer is an [`EventLoopTimer`] in the VM's timer heap. It's too big for the
//!   handle, so it's heap-allocated in a [`UvTimerNode`].
//! - `uv_queue_work` schedules a [`Job`] that runs `work_cb` on the thread pool and
//!   `after_work_cb` when it completes.
//! - A UDP handle's socket is a [`FilePoll`] in the VM's event loop, readable while it
//!   receives and writable while sends wait for their callbacks ([`UvUdpNode`]).
//! - A handle keeps the process alive while it is started and ref'd ([`RefState`]).

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicU8, AtomicU32, Ordering};
use std::collections::VecDeque;

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::{ContextId, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_io::posix_event_loop::{FilePoll, Flags, Owner, PollTag};
use bun_jsc::event_loop::ConcurrentTaskItem as ConcurrentTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    Completion, JSGlobalObject, Job, JobContext, JsCell, JsError, JsPtr, JsResult, JsThread,
    LoopKind, Posted, VmHandle,
};
use bun_sys::Fd;

use crate::jsc_hooks::{RuntimeState, timer_all_mut};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(uv, hidden);

unsafe extern "C" {
    /// Crashes the same way the stubs do. `name` must be static. Never returns.
    fn CrashHandler__unsupportedUVFunction(name: *const c_char);
    /// Returns null while the GC is sweeping. `HandleScopeImpl__close` accepts null.
    safe fn HandleScopeImpl__open(global: &JSGlobalObject) -> *mut c_void;
    fn HandleScopeImpl__close(global: &JSGlobalObject, scope: *mut c_void);
}

#[cold]
fn unsupported(function: &'static CStr) -> ! {
    // SAFETY: `function` is a static NUL-terminated string.
    unsafe { CrashHandler__unsupportedUVFunction(function.as_ptr()) };
    unreachable!("CrashHandler__unsupportedUVFunction returned");
}

/// Holds a handle scope open while an addon's callback runs on the JS thread. Node's
/// headers inline `v8::HandleScope`, so the addon's own scopes keep their handles in
/// the scope Bun opened.
struct CallbackScope<'a> {
    global: &'a JSGlobalObject,
    scope: *mut c_void,
}

impl<'a> CallbackScope<'a> {
    fn open(global: &'a JSGlobalObject) -> CallbackScope<'a> {
        CallbackScope {
            global,
            scope: HandleScopeImpl__open(global),
        }
    }
}

impl Drop for CallbackScope<'_> {
    fn drop(&mut self) {
        // SAFETY: `scope` came from `HandleScopeImpl__open` on `global`, and the addon
        // closed the scopes it opened inside it.
        unsafe { HandleScopeImpl__close(self.global, self.scope) };
    }
}

// `UV_E*` on posix is `-errno` (uv/errno.h).
const UV_EINVAL: c_int = -libc::EINVAL;
const UV_EBUSY: c_int = -libc::EBUSY;
const UV_ECANCELED: c_int = -libc::ECANCELED;
const UV_EAGAIN: c_int = -libc::EAGAIN;
const UV_EALREADY: c_int = -libc::EALREADY;
const UV_EBADF: c_int = -libc::EBADF;
const UV_EDESTADDRREQ: c_int = -libc::EDESTADDRREQ;
const UV_EISCONN: c_int = -libc::EISCONN;
const UV_ENOBUFS: c_int = -libc::ENOBUFS;
const UV_ENOTCONN: c_int = -libc::ENOTCONN;
const UV_ENOTSUP: c_int = -libc::ENOTSUP;

// Indexes into uv.h's `UV_HANDLE_TYPE_MAP` and `UV_REQ_TYPE_MAP`.
const UV_ASYNC: c_uint = 1;
const UV_CHECK: c_uint = 2;
const UV_IDLE: c_uint = 6;
const UV_PREPARE: c_uint = 9;
const UV_TIMER: c_uint = 13;
const UV_UDP: c_uint = 15;
const UV_UDP_SEND: c_uint = 5;
const UV_WORK: c_uint = 7;

// `uv_udp_flags` (uv.h).
const UV_UDP_IPV6ONLY: c_uint = 1;
const UV_UDP_PARTIAL: c_uint = 2;
const UV_UDP_REUSEADDR: c_uint = 4;
const UV_UDP_LINUX_RECVERR: c_uint = 32;
const UV_UDP_REUSEPORT: c_uint = 64;
const UV_UDP_RECVMMSG: c_uint = 256;

// Same `flags` values as libuv (src/uv-common.h).
const UV_HANDLE_CLOSING: c_uint = 0x01;
const UV_HANDLE_CLOSED: c_uint = 0x02;

// `sizeof` each struct on 64-bit unix. The addon allocates them, so Bun's versions can't be bigger.
const UV_ASYNC_T_SIZE: usize = 128;
const UV_WATCHER_T_SIZE: usize = 120;
const UV_TIMER_T_SIZE: usize = 152;
const UV_WORK_T_SIZE: usize = 128;
const UV_UDP_T_SIZE: usize = 216;
const UV_UDP_SEND_T_SIZE: usize = 320;

type UvAsyncCb = unsafe extern "C" fn(*mut UvAsync);
/// `uv_idle_cb`, `uv_prepare_cb` and `uv_check_cb` all have this signature.
type UvWatcherCb = unsafe extern "C" fn(*mut UvWatcher);
type UvTimerCb = unsafe extern "C" fn(*mut UvTimer);
type UvCloseCb = unsafe extern "C" fn(*mut UvHandle);
type UvWorkCb = unsafe extern "C" fn(*mut UvWork);
type UvAfterWorkCb = unsafe extern "C" fn(*mut UvWork, c_int);
type UvAllocCb = unsafe extern "C" fn(*mut UvHandle, usize, *mut UvBuf);
type UvUdpRecvCb =
    unsafe extern "C" fn(*mut UvUdp, isize, *const UvBuf, *const libc::sockaddr, c_uint);
type UvUdpSendCb = unsafe extern "C" fn(*mut UvUdpSend, c_int);

/// Tracks whether a handle keeps the loop alive. Like in libuv, it does while it's
/// both started (`uv_is_active`) and ref'd (`uv_has_ref`, the default).
struct RefState {
    keep_alive: KeepAlive,
    referenced: bool,
    active: bool,
}

impl RefState {
    fn new() -> RefState {
        RefState {
            keep_alive: KeepAlive::default(),
            referenced: true,
            active: false,
        }
    }

    fn set_active(&mut self, active: bool) {
        self.active = active;
        self.sync();
    }

    fn set_referenced(&mut self, referenced: bool) {
        self.referenced = referenced;
        self.sync();
    }

    fn sync(&mut self) {
        if self.active && self.referenced {
            self.keep_alive.ref_(bun_io::js_vm_ctx());
        } else {
            self.keep_alive.unref(bun_io::js_vm_ctx());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// uv_loop_t
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum DispatchState {
    /// No dispatch task is queued.
    Idle = 0,
    /// A dispatch task is queued, or the running one will queue another.
    Pending = 1,
    /// The dispatch task is walking the handles.
    Running = 2,
}

/// Backs `uv_loop_t`. It's a field of the VM's `RuntimeState`, so it lives exactly
/// as long as the VM ([`Self::of_vm`]).
#[repr(C)]
pub(crate) struct UvLoop {
    /// `uv_loop_t.data`. Only the addon reads and writes it. Must be at offset 0 like in uv.h.
    data: Cell<*mut c_void>,
    vm: NonNull<VirtualMachine>,
    /// Lets `uv_async_send` post to the JS thread from any thread.
    handle: VmHandle,
    dispatch_state: AtomicU8,
    /// Async handles that are initialized and not closed. JS thread only.
    asyncs: JsCell<Vec<NonNull<UvAsync>>>,
    /// Handles the running dispatch pass hasn't visited yet, in reverse order.
    /// `uv_close` removes a handle from both lists. JS thread only.
    dispatching: JsCell<Vec<NonNull<UvAsync>>>,
    idles: WatcherList,
    prepares: WatcherList,
    checks: WatcherList,
    /// UDP handles with send callbacks or a read error to deliver on the next turn,
    /// because the poll watch that would have delivered them couldn't be registered.
    /// libuv's pending queue (`uv__io_feed`). `uv_close` removes a handle. JS thread only.
    udp_pending: JsCell<Vec<NonNull<UvUdp>>>,
}

const _: () = assert!(core::mem::offset_of!(UvLoop, data) == 0);

/// Lists the started handles of one watcher type in the order they were started.
/// `walk` is libuv's `uv__run_idle` and friends. JS thread only.
struct WatcherList {
    started: JsCell<Vec<NonNull<UvWatcher>>>,
    /// Handles the running walk hasn't reached yet, in reverse order. Each one moves
    /// back to `started` before its callback runs, so a callback can stop it.
    walking: JsCell<Vec<NonNull<UvWatcher>>>,
    /// True while a walk is on the stack. A nested event loop run skips the walk.
    in_walk: Cell<bool>,
}

impl WatcherList {
    fn new() -> WatcherList {
        WatcherList {
            started: JsCell::new(Vec::new()),
            walking: JsCell::new(Vec::new()),
            in_walk: Cell::new(false),
        }
    }

    fn add(&self, watcher: NonNull<UvWatcher>) {
        self.started.with_mut(|started| started.push(watcher));
    }

    fn remove(&self, watcher: NonNull<UvWatcher>) {
        self.started
            .with_mut(|started| started.retain(|w| *w != watcher));
        self.walking
            .with_mut(|walking| walking.retain(|w| *w != watcher));
    }

    fn is_empty(&self) -> bool {
        self.started.get().is_empty()
    }

    fn walk(&self, vm: &VirtualMachine) {
        if self.is_empty() || self.in_walk.replace(true) {
            return;
        }
        self.started.with_mut(|started| {
            self.walking.with_mut(|walking| {
                debug_assert!(walking.is_empty());
                core::mem::swap(started, walking);
                walking.reverse();
            })
        });
        let global = vm.global();
        while let Some(watcher) = self.walking.with_mut(Vec::pop) {
            self.started.with_mut(|started| started.push(watcher));
            // SAFETY: a started handle is initialized and not closed (`uv_close`
            // stops it first), and the addon keeps it alive until then.
            let Some(cb) = (unsafe { (*watcher.as_ptr()).cb }) else {
                continue;
            };
            {
                let _scope = vm.enter_event_loop_scope();
                let _handles = CallbackScope::open(global);
                // SAFETY: calls the addon's callback on the loop thread with a
                // handle it started.
                unsafe { cb(watcher.as_ptr()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        // Handles only remain here after a termination.
        self.walking.with_mut(|walking| {
            if !walking.is_empty() {
                self.started
                    .with_mut(|started| started.extend(walking.drain(..).rev()));
            }
        });
        self.in_walk.set(false);
    }
}

impl UvLoop {
    /// Called by `init_runtime_state` on the JS thread. `handle` is `vm`'s [`VmHandle`].
    pub(crate) fn new(vm: NonNull<VirtualMachine>, handle: VmHandle) -> UvLoop {
        UvLoop {
            data: Cell::new(core::ptr::null_mut()),
            vm,
            handle,
            dispatch_state: AtomicU8::new(DispatchState::Idle as u8),
            asyncs: JsCell::new(Vec::new()),
            dispatching: JsCell::new(Vec::new()),
            idles: WatcherList::new(),
            prepares: WatcherList::new(),
            checks: WatcherList::new(),
            udp_pending: JsCell::new(Vec::new()),
        }
    }

    /// Runs the idle handles, then the prepare handles. `auto_tick` calls this before
    /// it polls. Returns true if an idle handle is started, so the poll must not block.
    pub(crate) fn before_poll(&self) -> bool {
        if self.idles.is_empty() && self.prepares.is_empty() {
            return false;
        }
        // SAFETY: the VM owns the `RuntimeState` that contains this loop, and this is
        // the JS thread.
        let vm = unsafe { self.vm.as_ref() };
        if !vm.script_allowed() {
            return false;
        }
        self.idles.walk(vm);
        self.prepares.walk(vm);
        !self.idles.is_empty()
    }

    /// Runs the check handles. `auto_tick` calls this after it polls.
    pub(crate) fn after_poll(&self) {
        if self.checks.is_empty() {
            return;
        }
        // SAFETY: same as `before_poll`.
        let vm = unsafe { self.vm.as_ref() };
        if vm.script_allowed() {
            self.checks.walk(vm);
        }
    }

    fn watchers(&self, type_: c_uint) -> &WatcherList {
        match type_ {
            UV_IDLE => &self.idles,
            UV_PREPARE => &self.prepares,
            _ => {
                debug_assert_eq!(type_, UV_CHECK);
                &self.checks
            }
        }
    }

    /// Returns `vm`'s loop. Returns null before `init_runtime_state` and after
    /// `VirtualMachine::destroy`, which clears the field before freeing the state.
    ///
    /// # Safety
    /// `vm` hasn't been freed (the main thread's VM never is). Any thread can call
    /// this because `runtime_state` doesn't change between those two writes, and an
    /// addon stops its threads in its cleanup hooks, which run before the second write.
    pub(crate) unsafe fn of_vm(vm: *const VirtualMachine) -> *mut UvLoop {
        // SAFETY: fn contract.
        let state = unsafe { (*vm).runtime_state }.cast::<RuntimeState>();
        if state.is_null() {
            return core::ptr::null_mut();
        }
        // SAFETY: `runtime_state` is `vm`'s boxed `RuntimeState`, and `&raw mut`
        // doesn't create a reference.
        unsafe { &raw mut (*state).uv_loop }
    }

    /// JS thread only.
    fn global(&self) -> &'static JSGlobalObject {
        // SAFETY: the VM owns the `RuntimeState` that contains this loop, so the VM is alive.
        unsafe { self.vm.as_ref() }.global()
    }

    /// Queues the dispatch task unless one is already queued. Any thread can call this.
    fn schedule_dispatch(&self) {
        let prev = self
            .dispatch_state
            .swap(DispatchState::Pending as u8, Ordering::SeqCst);
        if prev == DispatchState::Idle as u8 {
            self.post_dispatch();
        }
    }

    /// Posts the dispatch task. The state is `Pending`, so no other thread posts one.
    fn post_dispatch(&self) {
        let this: *const UvLoop = self;
        let task = ConcurrentTask::create_from(this.cast_mut());
        if let Posted::Refused(task) = self.handle.post(LoopKind::Regular, task) {
            // The VM is gone, so drop the callback like a closed libuv loop does.
            // SAFETY: a refused task was never queued, so we own it.
            unsafe { ConcurrentTask::release_refused(task) };
            self.dispatch_state
                .store(DispatchState::Idle as u8, Ordering::SeqCst);
        }
    }

    /// Runs the task that `schedule_dispatch` posted, on the JS thread.
    ///
    /// # Safety
    /// `this` is the loop of the VM that dispatched the task.
    pub(crate) unsafe fn dispatch(this: *mut UvLoop) {
        // SAFETY: this loop's VM dispatched the task and owns the `RuntimeState`
        // that contains the loop, so `this` is live. Other threads only use
        // shared references to it.
        let this = unsafe { &*this };
        let global = this.global();
        this.dispatch_state
            .store(DispatchState::Running as u8, Ordering::SeqCst);
        // Don't run callbacks once the VM is stopping. Threadsafe functions do the same.
        if global.bun_vm().script_allowed() {
            this.run_pass(global);
            this.run_udp_pending();
        }
        // A send during the pass sets `Pending` instead of posting a task, and this
        // then fails. The next pass is a new task, so a thread that keeps sending
        // can't hold the event loop back from its timers and sockets.
        if this
            .dispatch_state
            .compare_exchange(
                DispatchState::Running as u8,
                DispatchState::Idle as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_err()
        {
            this.post_dispatch();
        }
    }

    /// Flushes the UDP handles that [`UvUdpNode::defer_flush`] queued. A handle queued
    /// again by its own flush waits for the next pass.
    fn run_udp_pending(&self) {
        let pending = self.udp_pending.with_mut(core::mem::take);
        for udp in pending {
            // SAFETY: `uv_close` takes a handle out of `udp_pending`, and its node is
            // freed only by the close task, which can't run during this pass. A handle
            // closed by an earlier callback in this pass is skipped by `flush`.
            unsafe { UvUdpNode::flush((*udp.as_ptr()).node) };
        }
    }

    /// Calls `async_cb` for every handle that was sent, like libuv's `uv__async_io`.
    /// Each handle moves back to `asyncs` before its callback runs, so `uv_close`
    /// from any callback finds it in one of the two lists. Handles initialized
    /// during the pass wait for the next one.
    fn run_pass(&self, global: &JSGlobalObject) {
        self.asyncs.with_mut(|live| {
            self.dispatching.with_mut(|todo| {
                debug_assert!(todo.is_empty());
                core::mem::swap(live, todo);
                todo.reverse();
            })
        });
        while let Some(async_) = self.dispatching.with_mut(Vec::pop) {
            self.asyncs.with_mut(|live| live.push(async_));
            // SAFETY: a registered handle is initialized and not closed.
            // `uv_close` unregisters it before returning, and libuv's contract
            // requires the addon to keep an unclosed handle's memory alive.
            if !unsafe { UvAsync::take_pending(async_) } {
                continue;
            }
            bun_output::scoped_log!(uv, "uv_async_t {:?}: async_cb", async_);
            // SAFETY: same as above.
            if let Some(async_cb) = unsafe { (*async_.as_ptr()).async_cb } {
                let _handles = CallbackScope::open(global);
                // SAFETY: calls the addon's callback on the loop thread with the
                // handle it initialized.
                unsafe { async_cb(async_.as_ptr()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        // Handles only remain here after a termination.
        self.dispatching.with_mut(|todo| {
            if !todo.is_empty() {
                self.asyncs
                    .with_mut(|live| live.extend(todo.drain(..).rev()));
            }
        });
    }

    /// JS thread only.
    fn register(&self, async_: NonNull<UvAsync>) {
        self.asyncs.with_mut(|live| live.push(async_));
    }

    /// JS thread only. Uses `retain` because a handle that was initialized twice is in
    /// the list twice.
    fn unregister(&self, async_: NonNull<UvAsync>) {
        self.asyncs.with_mut(|live| live.retain(|h| *h != async_));
        self.dispatching
            .with_mut(|todo| todo.retain(|h| *h != async_));
    }
}

/// `schedule_dispatch` posts the loop as a task.
impl Taskable for UvLoop {
    const TAG: TaskTag = task_tag::UvLoopDispatch;
    /// Drops the pending sends like a closed libuv loop does. The VM owns the loop, so
    /// don't free it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract. The VM that releases the task owns the loop.
        unsafe { &(*this).dispatch_state }.store(DispatchState::Idle as u8, Ordering::SeqCst);
    }
    /// The task covers every addon's handles, so it isn't tied to one context.
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

/// Implements `uv_loop_t* uv_default_loop(void)`. Returns the main thread's loop on
/// every thread, even in a Worker, like Node does. `napi_get_uv_event_loop` returns
/// the Worker's loop.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_default_loop() -> *mut UvLoop {
    let Some(vm) = VirtualMachine::get_main_thread_vm() else {
        return core::ptr::null_mut();
    };
    // SAFETY: the main thread's VM is never freed.
    unsafe { UvLoop::of_vm(vm) }
}

/// Returns `vm`'s loop for `node::GetCurrentEventLoop`, the same one
/// `napi_get_uv_event_loop` returns.
///
/// # Safety
/// Same as [`UvLoop::of_vm`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__VirtualMachine__uvLoop(
    vm: *const VirtualMachine,
) -> *mut UvLoop {
    // SAFETY: fn contract.
    unsafe { UvLoop::of_vm(vm) }
}

// ──────────────────────────────────────────────────────────────────────────
// uv_handle_t / uv_async_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `UV_HANDLE_FIELDS` + `UV_HANDLE_PRIVATE_FIELDS` (uv.h, uv/unix.h), which
/// every handle starts with. Addons read `data`, `loop` and `type`. The rest is private.
#[repr(C)]
pub(crate) struct UvHandle {
    data: *mut c_void,
    loop_: *mut UvLoop,
    type_: c_uint,
    close_cb: Option<UvCloseCb>,
    handle_queue: [*mut c_void; 2],
    u: [*mut c_void; 4],
    next_closing: *mut c_void,
    flags: c_uint,
}

const _: () = assert!(core::mem::offset_of!(UvHandle, data) == 0);
const _: () = assert!(core::mem::offset_of!(UvHandle, loop_) == 8);
const _: () = assert!(core::mem::offset_of!(UvHandle, type_) == 16);
const _: () = assert!(core::mem::offset_of!(UvHandle, close_cb) == 24);
const _: () = assert!(core::mem::offset_of!(UvHandle, flags) == 88);
const _: () = assert!(core::mem::size_of::<UvHandle>() == 96);

impl UvHandle {
    /// Same as libuv's `uv__handle_init`. Doesn't touch `data`, which belongs to the addon.
    fn init(this: *mut UvHandle, loop_: *mut UvLoop, type_: c_uint) {
        // SAFETY: `this` is the addon's handle memory, and this is the loop thread.
        // Write field by field because the memory is uninitialized.
        unsafe {
            (&raw mut (*this).loop_).write(loop_);
            (&raw mut (*this).type_).write(type_);
            (&raw mut (*this).close_cb).write(None);
            (&raw mut (*this).handle_queue).write([core::ptr::null_mut(); 2]);
            (&raw mut (*this).u).write([core::ptr::null_mut(); 4]);
            (&raw mut (*this).next_closing).write(core::ptr::null_mut());
            (&raw mut (*this).flags).write(0);
        }
    }
}

/// Matches `struct uv_async_s`. Bun's fields replace `UV_ASYNC_PRIVATE_FIELDS`.
#[repr(C)]
pub(crate) struct UvAsync {
    handle: UvHandle,
    async_cb: Option<UvAsyncCb>,
    /// Active from init until close.
    ref_state: RefState,
    /// Number of senders past their first `pending` check, like libuv's busy counter.
    /// `uv_close` waits for it to reach 0.
    busy: AtomicI32,
    /// A send sets it, the dispatch pass clears it, and `uv_close` sets it permanently.
    pending: AtomicI32,
}

const _: () = assert!(core::mem::offset_of!(UvAsync, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvAsync, async_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvAsync>() <= UV_ASYNC_T_SIZE);

// SAFETY: never create a `&UvAsync` or `&mut UvAsync`. Other threads can be in
// `uv_async_send` on the handle, so access one field at a time through the raw pointer.
impl UvAsync {
    /// Clears `pending` for the dispatch pass. Returns true if the handle was sent.
    ///
    /// # Safety
    /// `this` is initialized and not closed.
    unsafe fn take_pending(this: NonNull<UvAsync>) -> bool {
        // SAFETY: fn contract.
        unsafe { &(*this.as_ptr()).pending }.swap(0, Ordering::SeqCst) != 0
    }

    /// Called by `uv_close`, like libuv's `uv__async_spin`. Makes later sends return
    /// at their first check and waits for the senders already past it, so `close_cb`
    /// can free the handle afterwards.
    ///
    /// # Safety
    /// Same as [`Self::take_pending`].
    unsafe fn stop_sends(this: NonNull<UvAsync>) {
        // SAFETY: fn contract.
        let (pending, busy) = unsafe { (&(*this.as_ptr()).pending, &(*this.as_ptr()).busy) };
        pending.store(1, Ordering::SeqCst);
        let mut spins = 0u32;
        while busy.load(Ordering::SeqCst) != 0 {
            spins += 1;
            if spins.is_multiple_of(1000) {
                std::thread::yield_now();
            } else {
                core::hint::spin_loop();
            }
        }
    }
}

/// Implements `int uv_async_init(uv_loop_t*, uv_async_t*, uv_async_cb)`. The handle
/// starts active and ref'd, like in libuv.
///
/// # Safety
/// `loop_` is null or one of this module's loops. `handle` points to
/// `sizeof(uv_async_t)` bytes that the addon keeps alive until its `close_cb` has run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_init(
    loop_: *mut UvLoop,
    handle: *mut UvAsync,
    async_cb: Option<UvAsyncCb>,
) -> c_int {
    let (Some(loop_ref), Some(async_)) = (NonNull::new(loop_), NonNull::new(handle)) else {
        return UV_EINVAL;
    };
    bun_output::scoped_log!(uv, "uv_async_t {:?}: uv_async_init", handle);
    UvHandle::init(handle.cast::<UvHandle>(), loop_, UV_ASYNC);
    // SAFETY: fn contract. Write field by field because the addon's memory is uninitialized.
    unsafe {
        (&raw mut (*handle).async_cb).write(async_cb);
        (&raw mut (*handle).ref_state).write(RefState::new());
        (&raw mut (*handle).busy).write(AtomicI32::new(0));
        (&raw mut (*handle).pending).write(AtomicI32::new(0));
        (*handle).ref_state.set_active(true);
    }
    // SAFETY: the loop is alive (fn contract), and this is the JS thread.
    unsafe { loop_ref.as_ref() }.register(async_);
    0
}

/// Implements `int uv_async_send(uv_async_t*)`. Any thread can call this. Sends
/// before the next dispatch coalesce into one callback. After `uv_close` it returns
/// at the first check, like libuv's.
///
/// # Safety
/// `handle` was initialized by `uv_async_init` and its `close_cb` has not run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_send(handle: *mut UvAsync) -> c_int {
    // SAFETY: fn contract. The loop thread can be writing the plain fields in
    // `uv_close`, so only read the atomics and `loop`, which nothing writes after init.
    let (pending, busy, loop_) =
        unsafe { (&(*handle).pending, &(*handle).busy, (*handle).handle.loop_) };
    if pending.load(Ordering::SeqCst) != 0 {
        // Already scheduled, or closed.
        return 0;
    }
    let _ = busy.fetch_add(1, Ordering::SeqCst);
    if pending.swap(1, Ordering::SeqCst) == 0 {
        // SAFETY: the loop outlives the handle, and `schedule_dispatch` is thread-safe.
        unsafe { &*loop_ }.schedule_dispatch();
    }
    let _ = busy.fetch_sub(1, Ordering::SeqCst);
    0
}

// ──────────────────────────────────────────────────────────────────────────
// uv_idle_t / uv_prepare_t / uv_check_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `struct uv_idle_s`, `uv_prepare_s` and `uv_check_s`, which have the same
/// layout in uv.h. Bun's state replaces libuv's queue links.
#[repr(C)]
pub(crate) struct UvWatcher {
    handle: UvHandle,
    cb: Option<UvWatcherCb>,
    ref_state: RefState,
}

const _: () = assert!(core::mem::offset_of!(UvWatcher, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvWatcher, cb) == 96);
const _: () = assert!(core::mem::size_of::<UvWatcher>() <= UV_WATCHER_T_SIZE);

impl UvWatcher {
    /// Implements `uv_{idle,prepare,check}_init`. The handle starts stopped.
    ///
    /// # Safety
    /// `loop_` is null or one of this module's loops. `handle` points to memory the
    /// size of its type that the addon keeps alive until its `close_cb` has run.
    unsafe fn init(loop_: *mut UvLoop, handle: *mut UvWatcher, type_: c_uint) -> c_int {
        if loop_.is_null() || handle.is_null() {
            return UV_EINVAL;
        }
        bun_output::scoped_log!(uv, "uv_handle_t {:?}: init as type {}", handle, type_);
        UvHandle::init(handle.cast::<UvHandle>(), loop_, type_);
        // SAFETY: fn contract. Write field by field because the addon's memory is uninitialized.
        unsafe {
            (&raw mut (*handle).cb).write(None);
            (&raw mut (*handle).ref_state).write(RefState::new());
        }
        0
    }

    /// Implements `uv_{idle,prepare,check}_start`. No-op on a started or closing
    /// handle, like in libuv. The callback isn't replaced.
    ///
    /// # Safety
    /// `handle` was initialized by [`Self::init`].
    unsafe fn start(handle: *mut UvWatcher, cb: Option<UvWatcherCb>) -> c_int {
        // SAFETY: fn contract, on the loop thread. The loop outlives its handles.
        unsafe {
            if (*handle).ref_state.active || (*handle).handle.flags & UV_HANDLE_CLOSING != 0 {
                return 0;
            }
            if cb.is_none() {
                return UV_EINVAL;
            }
            (*handle).cb = cb;
            (*(*handle).handle.loop_)
                .watchers((*handle).handle.type_)
                .add(NonNull::new_unchecked(handle));
            (*handle).ref_state.set_active(true);
        }
        0
    }

    /// Implements `uv_{idle,prepare,check}_stop`. `uv_close` calls it too.
    ///
    /// # Safety
    /// Same as [`Self::start`].
    unsafe fn stop(handle: *mut UvWatcher) {
        // SAFETY: fn contract, on the loop thread. The loop outlives its handles.
        unsafe {
            if !(*handle).ref_state.active {
                return;
            }
            (*(*handle).handle.loop_)
                .watchers((*handle).handle.type_)
                .remove(NonNull::new_unchecked(handle));
            (*handle).ref_state.set_active(false);
        }
    }
}

/// Returns true if `handle` has type `type_`. libuv asserts on the wrong type, but
/// the entry points return `UV_EINVAL`.
///
/// # Safety
/// `handle` points to an initialized handle.
unsafe fn watcher_has_type(handle: *mut UvWatcher, type_: c_uint) -> bool {
    // SAFETY: fn contract.
    unsafe { (*handle).handle.type_ == type_ }
}

macro_rules! watcher_entry_points {
    ($type_:expr, $init:ident, $start:ident, $stop:ident) => {
        /// See [`UvWatcher::init`].
        ///
        /// # Safety
        /// Same as [`UvWatcher::init`].
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $init(loop_: *mut UvLoop, handle: *mut UvWatcher) -> c_int {
            // SAFETY: fn contract.
            unsafe { UvWatcher::init(loop_, handle, $type_) }
        }

        /// See [`UvWatcher::start`].
        ///
        /// # Safety
        /// `handle` was initialized by one of this module's `uv_*_init`.
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $start(
            handle: *mut UvWatcher,
            cb: Option<UvWatcherCb>,
        ) -> c_int {
            // SAFETY: fn contract.
            if !unsafe { watcher_has_type(handle, $type_) } {
                return UV_EINVAL;
            }
            // SAFETY: `handle` is a watcher of this type, checked above.
            unsafe { UvWatcher::start(handle, cb) }
        }

        /// See [`UvWatcher::stop`].
        ///
        /// # Safety
        /// `handle` was initialized by one of this module's `uv_*_init`.
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $stop(handle: *mut UvWatcher) -> c_int {
            // SAFETY: fn contract.
            if !unsafe { watcher_has_type(handle, $type_) } {
                return UV_EINVAL;
            }
            // SAFETY: `handle` is a watcher of this type, checked above.
            unsafe { UvWatcher::stop(handle) };
            0
        }
    };
}

watcher_entry_points!(UV_IDLE, uv_idle_init, uv_idle_start, uv_idle_stop);
watcher_entry_points!(
    UV_PREPARE,
    uv_prepare_init,
    uv_prepare_start,
    uv_prepare_stop
);
watcher_entry_points!(UV_CHECK, uv_check_init, uv_check_start, uv_check_stop);

// ──────────────────────────────────────────────────────────────────────────
// uv_timer_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `struct uv_timer_s`. Bun's state replaces libuv's heap node and
/// deadlines. An [`EventLoopTimer`] is too big for that space, so the handle owns a
/// [`UvTimerNode`] from init to close.
#[repr(C)]
pub(crate) struct UvTimer {
    handle: UvHandle,
    timer_cb: Option<UvTimerCb>,
    node: *mut UvTimerNode,
    repeat_ms: u64,
    ref_state: RefState,
}

const _: () = assert!(core::mem::offset_of!(UvTimer, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvTimer, timer_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvTimer>() <= UV_TIMER_T_SIZE);

/// Links a `uv_timer_t` into the timer heap. `dispatch.rs` recovers it from
/// `event_loop_timer` when the timer fires.
pub(crate) struct UvTimerNode {
    pub(crate) event_loop_timer: EventLoopTimer,
    timer: *mut UvTimer,
}

impl UvTimerNode {
    /// Called after the heap pops the timer. Like libuv's `uv__run_timers`, it stops
    /// the timer and re-arms a repeating one before it calls the callback, so the
    /// callback can stop or close the handle.
    ///
    /// # Safety
    /// `this` is a started timer's node, and this is the loop thread.
    pub(crate) unsafe fn on_fire(this: *mut UvTimerNode) -> JsResult<()> {
        // SAFETY: fn contract. `FIRED` tells `update`/`remove` that the node isn't
        // in the heap.
        let timer = unsafe {
            (*this).event_loop_timer.state = EventLoopTimerState::FIRED;
            (*this).timer
        };
        // SAFETY: a started timer is initialized and not closed, and this is the loop thread.
        let (cb, repeat_ms, loop_) = unsafe {
            (*timer).ref_state.set_active(false);
            ((*timer).timer_cb, (*timer).repeat_ms, (*timer).handle.loop_)
        };
        if repeat_ms != 0 {
            // SAFETY: same as above.
            unsafe { UvTimer::arm(timer, repeat_ms) };
        }
        bun_output::scoped_log!(uv, "uv_timer_t {:?}: timer_cb", timer);
        // SAFETY: the loop outlives its handles.
        let vm = unsafe { &*(*loop_).vm.as_ptr() };
        if let Some(cb) = cb {
            let _scope = vm.enter_event_loop_scope();
            let _handles = CallbackScope::open(vm.global());
            // SAFETY: calls the addon's callback on the loop thread with its handle.
            unsafe { cb(timer) };
        }
        if vm.global().has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

impl UvTimer {
    /// Schedules the timer to fire `timeout_ms` from now and marks it started.
    ///
    /// # Safety
    /// `handle` is a timer that's initialized and not closed, and this is the loop thread.
    unsafe fn arm(handle: *mut UvTimer, timeout_ms: u64) {
        let due = Timespec::ms_from_now(
            TimespecMockMode::ForceRealTime,
            i64::try_from(timeout_ms).unwrap_or(i64::MAX),
        );
        // SAFETY: fn contract. A timer owns its node until it's closed.
        unsafe {
            timer_all_mut().update(&raw mut (*(*handle).node).event_loop_timer, &due);
            (*handle).ref_state.set_active(true);
        }
    }

    /// Implements `uv_timer_stop`. Checks the node's state before removing it from the
    /// heap because a fired node is already out, and VM teardown unlinks timers
    /// without telling their owners.
    ///
    /// # Safety
    /// Same as [`Self::arm`].
    unsafe fn stop(handle: *mut UvTimer) {
        // SAFETY: fn contract.
        unsafe {
            if !(*handle).ref_state.active {
                return;
            }
            let event_loop_timer = &raw mut (*(*handle).node).event_loop_timer;
            if (*event_loop_timer).state == EventLoopTimerState::ACTIVE {
                timer_all_mut().remove(event_loop_timer);
            }
            (*handle).ref_state.set_active(false);
        }
    }

    /// Called by `uv_close`. Frees the node here instead of in the close task because
    /// a stopping VM refuses the task. Nothing reads the node once the closing flag is set.
    ///
    /// # Safety
    /// Same as [`Self::arm`], and `handle` is being closed for the first time.
    unsafe fn close(handle: *mut UvTimer) {
        // SAFETY: fn contract. `stop` removes the node from the heap, and
        // `uv_timer_init` allocated `node` with `heap::alloc`.
        unsafe {
            UvTimer::stop(handle);
            bun_core::heap::destroy((*handle).node);
            (*handle).node = core::ptr::null_mut();
        }
    }

    /// Returns true if `handle` is a timer.
    ///
    /// # Safety
    /// `handle` points to an initialized handle.
    unsafe fn check(handle: *mut UvTimer) -> bool {
        // SAFETY: fn contract.
        unsafe { (*handle).handle.type_ == UV_TIMER }
    }
}

/// Implements `int uv_timer_init(uv_loop_t*, uv_timer_t*)`.
///
/// # Safety
/// Same as [`UvWatcher::init`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_init(loop_: *mut UvLoop, handle: *mut UvTimer) -> c_int {
    if loop_.is_null() || handle.is_null() {
        return UV_EINVAL;
    }
    bun_output::scoped_log!(uv, "uv_timer_t {:?}: uv_timer_init", handle);
    UvHandle::init(handle.cast::<UvHandle>(), loop_, UV_TIMER);
    let node = bun_core::heap::alloc(UvTimerNode {
        event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::UvTimer),
        timer: handle,
    });
    // SAFETY: fn contract. Write field by field because the addon's memory is uninitialized.
    unsafe {
        (&raw mut (*handle).timer_cb).write(None);
        (&raw mut (*handle).node).write(node);
        (&raw mut (*handle).repeat_ms).write(0);
        (&raw mut (*handle).ref_state).write(RefState::new());
    }
    0
}

/// Implements `int uv_timer_start(uv_timer_t*, uv_timer_cb, uint64_t timeout,
/// uint64_t repeat)`. Restarts a timer that's already started.
///
/// # Safety
/// `handle` was initialized by one of this module's `uv_*_init`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_start(
    handle: *mut UvTimer,
    cb: Option<UvTimerCb>,
    timeout_ms: u64,
    repeat_ms: u64,
) -> c_int {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } || cb.is_none() {
        return UV_EINVAL;
    }
    // SAFETY: `handle` is a timer, and this is the loop thread.
    unsafe {
        if (*handle).handle.flags & UV_HANDLE_CLOSING != 0 {
            return UV_EINVAL;
        }
        (*handle).timer_cb = cb;
        (*handle).repeat_ms = repeat_ms;
        UvTimer::arm(handle, timeout_ms);
    }
    0
}

/// Implements `int uv_timer_stop(uv_timer_t*)`.
///
/// # Safety
/// Same as [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_stop(handle: *mut UvTimer) -> c_int {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return UV_EINVAL;
    }
    // SAFETY: `handle` is a timer, and this is the loop thread.
    unsafe { UvTimer::stop(handle) };
    0
}

/// Implements `int uv_timer_again(uv_timer_t*)`. Restarts a repeating timer. Returns
/// `UV_EINVAL` if the timer was never started.
///
/// # Safety
/// Same as [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_again(handle: *mut UvTimer) -> c_int {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return UV_EINVAL;
    }
    // SAFETY: `handle` is a timer, and this is the loop thread.
    unsafe {
        if (*handle).timer_cb.is_none() {
            return UV_EINVAL;
        }
        let repeat_ms = (*handle).repeat_ms;
        if repeat_ms != 0 && (*handle).handle.flags & UV_HANDLE_CLOSING == 0 {
            UvTimer::arm(handle, repeat_ms);
        }
    }
    0
}

/// Implements `void uv_timer_set_repeat(uv_timer_t*, uint64_t)`. The new value
/// applies from the next fire or `uv_timer_again`, like in libuv.
///
/// # Safety
/// Same as [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_set_repeat(handle: *mut UvTimer, repeat_ms: u64) {
    // SAFETY: fn contract.
    if unsafe { UvTimer::check(handle) } {
        // SAFETY: `handle` is a timer, and this is the loop thread.
        unsafe { (*handle).repeat_ms = repeat_ms };
    }
}

/// Implements `uint64_t uv_timer_get_repeat(const uv_timer_t*)`.
///
/// # Safety
/// Same as [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_get_repeat(handle: *mut UvTimer) -> u64 {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return 0;
    }
    // SAFETY: `handle` is a timer, and this is the loop thread.
    unsafe { (*handle).repeat_ms }
}

/// Implements `uint64_t uv_timer_get_due_in(const uv_timer_t*)`. Returns 0 if the
/// timer is due or not started.
///
/// # Safety
/// Same as [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_get_due_in(handle: *mut UvTimer) -> u64 {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return 0;
    }
    // SAFETY: `handle` is a timer, and this is the loop thread. A started timer isn't
    // closed, so it owns its node.
    let due = unsafe {
        if !(*handle).ref_state.active {
            return 0;
        }
        (*(*handle).node).event_loop_timer.next
    };
    let now = Timespec::now(TimespecMockMode::ForceRealTime);
    u64::try_from(due.ms().wrapping_sub(now.ms())).unwrap_or(0)
}

/// Implements `uint64_t uv_now(const uv_loop_t*)`. Returns the timer heap's clock in
/// milliseconds. libuv caches it per iteration, but this reads it every time.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_now(_loop: *const UvLoop) -> u64 {
    u64::try_from(Timespec::now(TimespecMockMode::ForceRealTime).ms()).unwrap_or(0)
}

/// Implements `void uv_update_time(uv_loop_t*)`. No-op because `uv_now` isn't cached.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_update_time(_loop: *mut UvLoop) {}

// ──────────────────────────────────────────────────────────────────────────
// uv_udp_t / uv_udp_send_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `uv_buf_t` on unix.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct UvBuf {
    base: *mut c_char,
    len: usize,
}

/// Matches `struct uv_udp_s`. Addons read `send_queue_size` and `send_queue_count`.
/// Bun's fields replace `UV_UDP_PRIVATE_FIELDS`. The rest of the state is in a
/// [`UvUdpNode`] because it has to outlive a callback that closes the handle.
#[repr(C)]
pub(crate) struct UvUdp {
    handle: UvHandle,
    send_queue_size: usize,
    send_queue_count: usize,
    alloc_cb: Option<UvAllocCb>,
    recv_cb: Option<UvUdpRecvCb>,
    node: *mut UvUdpNode,
    /// Active while it's receiving or has sends whose callback hasn't run, like libuv.
    ref_state: RefState,
}

const _: () = assert!(core::mem::offset_of!(UvUdp, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvUdp, send_queue_size) == 96);
const _: () = assert!(core::mem::offset_of!(UvUdp, send_queue_count) == 104);
const _: () = assert!(core::mem::size_of::<UvUdp>() <= UV_UDP_T_SIZE);

/// Matches `struct uv_udp_send_s`. Addons read `handle` and `cb`. Bun's fields
/// replace `UV_UDP_SEND_PRIVATE_FIELDS`.
#[repr(C)]
pub(crate) struct UvUdpSend {
    req: UvReq,
    handle: *mut UvUdp,
    cb: Option<UvUdpSendCb>,
    addr: libc::sockaddr_storage,
    /// 0 on a connected socket.
    addr_len: libc::socklen_t,
    nbufs: c_uint,
    /// `bufsml`, or a heap copy for more than 4 buffers.
    bufs: *mut UvBuf,
    /// Bytes sent, or a negative `UV_E*` code.
    status: isize,
    bufsml: [UvBuf; 4],
}

const _: () = assert!(core::mem::offset_of!(UvUdpSend, req) == 0);
const _: () = assert!(core::mem::offset_of!(UvUdpSend, handle) == 64);
const _: () = assert!(core::mem::offset_of!(UvUdpSend, cb) == 72);
const _: () = assert!(core::mem::size_of::<UvUdpSend>() <= UV_UDP_SEND_T_SIZE);

/// A `uv_udp_t`'s socket and send queues. `uv_udp_init` allocates it and the close
/// task frees it after the canceled sends' callbacks, so it's valid for the whole
/// of any callback, even one that closes the handle. JS thread only.
pub(crate) struct UvUdpNode {
    udp: *mut UvUdp,
    /// -1 until the socket exists. libuv creates it at bind, connect, the first
    /// send or receive, or in `uv_udp_init_ex` when that names a family.
    fd: c_int,
    /// Watches `fd`, null while there is none. Readable while receiving, writable
    /// while there are sends to finish.
    poll: *mut FilePoll,
    ipv6: bool,
    connected: bool,
    reading: bool,
    /// True while send callbacks run. A send from one of them queues behind the
    /// others instead of going out at once, like libuv's `UV_HANDLE_UDP_PROCESSING`.
    processing: bool,
    /// Sends the socket hasn't taken yet, oldest first.
    queued: VecDeque<NonNull<UvUdpSend>>,
    /// Sends whose callback hasn't run, oldest first.
    completed: VecDeque<NonNull<UvUdpSend>>,
    /// The handle is in its loop's `udp_pending`, and this is the error of the failed
    /// `update` that put it there, for `recv_cb` if the read watch was lost.
    flush_pending: bool,
    flush_err: c_int,
}

/// `-errno` for the last failed call, like libuv's `UV__ERR(errno)`.
fn uv_errno() -> c_int {
    -std::io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or(libc::EIO)
}

fn would_block(err: c_int) -> bool {
    err == -libc::EAGAIN || err == -libc::EWOULDBLOCK || err == -libc::ENOBUFS
}

/// Returns the length of an `AF_INET` or `AF_INET6` address, or `None` for any other family.
///
/// # Safety
/// `addr` points to a `sockaddr` at least as long as its family says.
unsafe fn sockaddr_len(addr: *const libc::sockaddr) -> Option<libc::socklen_t> {
    // SAFETY: fn contract.
    let len = match c_int::from(unsafe { (*addr).sa_family }) {
        libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>(),
        libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>(),
        _ => return None,
    };
    Some(len as libc::socklen_t)
}

/// Opens a non-blocking, close-on-exec datagram socket.
fn new_udp_socket(domain: c_int) -> Result<c_int, c_int> {
    #[cfg(not(target_os = "macos"))]
    {
        // SAFETY: plain syscall.
        let fd = unsafe {
            libc::socket(
                domain,
                libc::SOCK_DGRAM | libc::SOCK_NONBLOCK | libc::SOCK_CLOEXEC,
                0,
            )
        };
        if fd < 0 { Err(uv_errno()) } else { Ok(fd) }
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: plain syscall.
        let fd = unsafe { libc::socket(domain, libc::SOCK_DGRAM, 0) };
        if fd < 0 {
            return Err(uv_errno());
        }
        if let Err(err) = set_nonblocking_cloexec(fd) {
            // SAFETY: `fd` is the socket opened above.
            unsafe { libc::close(fd) };
            return Err(err);
        }
        Ok(fd)
    }
}

fn set_nonblocking_cloexec(fd: c_int) -> Result<(), c_int> {
    // SAFETY: plain syscalls on an fd the caller owns.
    unsafe {
        let fl = libc::fcntl(fd, libc::F_GETFL);
        if fl < 0 || libc::fcntl(fd, libc::F_SETFL, fl | libc::O_NONBLOCK) < 0 {
            return Err(uv_errno());
        }
        let fd_flags = libc::fcntl(fd, libc::F_GETFD);
        if fd_flags < 0 || libc::fcntl(fd, libc::F_SETFD, fd_flags | libc::FD_CLOEXEC) < 0 {
            return Err(uv_errno());
        }
    }
    Ok(())
}

fn set_int_option(fd: c_int, level: c_int, name: c_int, value: c_int) -> c_int {
    // SAFETY: `value` is a live c_int of the size passed.
    let r = unsafe {
        libc::setsockopt(
            fd,
            level,
            name,
            (&raw const value).cast::<c_void>(),
            core::mem::size_of::<c_int>() as libc::socklen_t,
        )
    };
    if r < 0 { uv_errno() } else { 0 }
}

/// `sendmsg` with `bufs` to `addr`, or to the connected peer when `addr_len` is 0.
/// Returns the bytes sent or `-errno`.
///
/// # Safety
/// `bufs` points to `nbufs` buffers, and `addr` to `addr_len` bytes.
unsafe fn udp_sendmsg(
    fd: c_int,
    bufs: *const UvBuf,
    nbufs: c_uint,
    addr: *const libc::sockaddr_storage,
    addr_len: libc::socklen_t,
) -> isize {
    // SAFETY: an all-zero msghdr is valid.
    let mut msg: libc::msghdr = unsafe { core::mem::zeroed() };
    if addr_len != 0 {
        msg.msg_name = addr.cast_mut().cast::<c_void>();
        msg.msg_namelen = addr_len;
    }
    // `uv_buf_t` has the same layout as `struct iovec` on unix.
    msg.msg_iov = bufs.cast_mut().cast::<libc::iovec>();
    msg.msg_iovlen = nbufs as _;
    loop {
        // SAFETY: fn contract.
        let n = unsafe { libc::sendmsg(fd, &raw const msg, 0) };
        if n >= 0 {
            return n;
        }
        let err = uv_errno();
        if err != -libc::EINTR {
            return err as isize;
        }
    }
}

fn total_len(bufs: *const UvBuf, nbufs: c_uint) -> usize {
    (0..nbufs as usize)
        // SAFETY: the caller's `bufs` has `nbufs` entries.
        .map(|i| unsafe { (*bufs.add(i)).len })
        .sum()
}

impl UvUdpNode {
    fn loop_ctx(&self) -> bun_io::EventLoopCtx {
        // SAFETY: the handle and its loop outlive the node.
        unsafe { (*(*(*self.udp).handle.loop_).vm.as_ptr()).loop_ctx() }
    }

    /// Takes `fd` and starts watching it, like libuv's `uv__udp_open`.
    fn set_socket(&mut self, fd: c_int) {
        debug_assert!(self.fd == -1);
        let this: *mut UvUdpNode = self;
        self.fd = fd;
        self.poll = FilePoll::init(
            self.loop_ctx(),
            Fd::from_native(fd),
            Default::default(),
            Owner::new(PollTag::UvUdp, this.cast::<()>()),
        );
    }

    /// libuv's `uv__udp_maybe_deferred_bind`: a handle that sends or receives before
    /// it's bound gets a socket of that family, which the kernel binds to the any
    /// address on first use.
    fn ensure_socket(&mut self, domain: c_int) -> c_int {
        if self.fd != -1 {
            return 0;
        }
        match new_udp_socket(domain) {
            Ok(fd) => {
                self.set_socket(fd);
                self.ipv6 = domain == libc::AF_INET6;
                0
            }
            Err(err) => err,
        }
    }

    /// Watches the directions the handle needs, and keeps the process alive while it
    /// needs any, like libuv's `uv__io_start`/`uv__io_stop` and `uv__handle_start`.
    /// Returns 0, or the error from registering with the event loop. Then the read
    /// watch is kept if the handle is receiving and only the write watch failed, and
    /// the queued sends complete with the error, since nothing would tell us when the
    /// socket takes them. A caller outside `on_poll` passes the error to
    /// [`Self::defer_flush`], so their callbacks run on the next turn.
    /// The handle keeps the process alive only if it's still watching for reads.
    ///
    /// # Safety
    /// The handle isn't closing.
    unsafe fn update(&mut self) -> c_int {
        let want_read = self.reading;
        let want_write = !self.queued.is_empty() || !self.completed.is_empty();
        let mut err = 0;
        if !self.poll.is_null() {
            let ctx = self.loop_ctx();
            // SAFETY: this is the JS thread, whose loop lives as long as the VM.
            let uws_loop = unsafe { ctx.platform_event_loop() };
            // SAFETY: the node owns its poll until close, and this is the loop thread.
            let poll = unsafe { &mut *self.poll };
            let mut has_read = poll.flags.contains(Flags::PollReadable);
            let mut has_write = poll.flags.contains(Flags::PollWritable);
            // FilePoll can't drop one direction, so drop both and add back what's wanted.
            if (has_read && !want_read) || (has_write && !want_write) {
                let _ = poll.unregister(uws_loop, false);
                has_read = false;
                has_write = false;
            }
            if want_read && !has_read {
                if let Err(e) = poll.register(uws_loop, Flags::Readable, false) {
                    err = -(e.errno as c_int);
                }
            }
            if err == 0 && want_write && !has_write {
                if let Err(e) = poll.register(uws_loop, Flags::Writable, false) {
                    err = -(e.errno as c_int);
                }
            }
            if err != 0 {
                // epoll and kqueue drop both directions here, so put the read watch back.
                let _ = poll.unregister(uws_loop, false);
                if want_read {
                    let _ = poll.register(uws_loop, Flags::Readable, false);
                }
            }
        }
        if err != 0 {
            while let Some(req) = self.queued.pop_front() {
                // SAFETY: a queued request is alive until its callback has run.
                unsafe { (*req.as_ptr()).status = err as isize };
                self.completed.push_back(req);
            }
        }
        let active = if err == 0 {
            want_read || want_write
        } else {
            self.watching_reads()
        };
        // SAFETY: fn contract.
        unsafe { (*self.udp).ref_state.set_active(active) };
        err
    }

    fn watching_reads(&self) -> bool {
        // SAFETY: the node owns its poll until close, and this is the loop thread.
        !self.poll.is_null() && unsafe { (*self.poll).flags.contains(Flags::PollReadable) }
    }

    /// After `update` failed outside `on_poll`: no poll event may come to deliver what
    /// it left (sends completed with the error, or a read watch it couldn't keep), so
    /// queue the handle to [`Self::flush`] on the next turn, like libuv's `uv__io_feed`.
    ///
    /// # Safety
    /// The handle isn't closing, and this is the loop thread.
    unsafe fn defer_flush(&mut self, err: c_int) {
        self.flush_err = err;
        if self.flush_pending || (self.completed.is_empty() && !(self.reading && !self.watching_reads())) {
            return;
        }
        self.flush_pending = true;
        // SAFETY: fn contract. The loop outlives its handles.
        let loop_ = unsafe { &*(*self.udp).handle.loop_ };
        // SAFETY: `udp` is the node's live handle, so it isn't null.
        let udp = unsafe { NonNull::new_unchecked(self.udp) };
        loop_.udp_pending.with_mut(|pending| pending.push(udp));
        loop_.schedule_dispatch();
    }

    /// Runs what [`Self::defer_flush`] queued: the callbacks of completed sends, then
    /// `recv_cb` with the error if the handle is receiving without a read watch. Then
    /// tries to watch again for what's left.
    ///
    /// # Safety
    /// Same as [`Self::on_poll`].
    unsafe fn flush(this: *mut UvUdpNode) {
        // SAFETY: fn contract. The node outlives the callbacks.
        unsafe {
            (*this).flush_pending = false;
            // A closing handle's sends run in `finish_close`.
            if UvUdpNode::closing(this) {
                return;
            }
            UvUdpNode::run_completed(this);
            if !UvUdpNode::closing(this) && (*this).reading && !(*this).watching_reads() {
                UvUdpNode::fail_reads(this, (*this).flush_err);
            }
            if !UvUdpNode::closing(this) {
                // Sends queued since, or by a callback above.
                let err = (*this).update();
                if err != 0 {
                    (*this).defer_flush(err);
                }
            }
        }
    }

    /// Called by `__bun_run_file_poll` when the socket is readable or writable.
    ///
    /// # Safety
    /// `this` is the owner of `poll`, a live handle's node, and this is the loop thread.
    pub(crate) unsafe fn on_poll(this: *mut UvUdpNode, poll: *mut FilePoll) {
        // SAFETY: fn contract. A callback can close the handle, which frees `poll`,
        // so read the events before calling any.
        let (readable, writable) = unsafe { ((*poll).is_readable(), (*poll).is_writable()) };
        // SAFETY: fn contract. The node outlives the callbacks.
        unsafe {
            if readable && (*this).reading {
                UvUdpNode::receive(this);
            }
            if !UvUdpNode::closing(this) {
                if writable {
                    (*this).send_queued();
                }
                // Also the sends that an earlier failed `update` completed with its error.
                UvUdpNode::run_completed(this);
            }
            let err = if UvUdpNode::closing(this) {
                0
            } else {
                (*this).update()
            };
            if err != 0 {
                // The sends it couldn't watch for completed with the error: report them.
                UvUdpNode::run_completed(this);
                if !UvUdpNode::closing(this) && (*this).reading && !(*this).watching_reads() {
                    UvUdpNode::fail_reads(this, err);
                }
            }
        }
    }

    /// Receiving can't go on without a read watch: stop, and tell the addon through
    /// `recv_cb` with the error, in a buffer from `alloc_cb` like any failed read.
    ///
    /// # Safety
    /// Same as [`Self::on_poll`].
    unsafe fn fail_reads(this: *mut UvUdpNode, err: c_int) {
        // SAFETY: fn contract.
        let (udp, vm) = unsafe {
            let udp = (*this).udp;
            (udp, &*(*(*udp).handle.loop_).vm.as_ptr())
        };
        // SAFETY: fn contract. The callbacks are set while `reading` is.
        let (Some(alloc_cb), Some(recv_cb)) = (unsafe { ((*udp).alloc_cb, (*udp).recv_cb) }) else {
            return;
        };
        // SAFETY: fn contract.
        unsafe {
            (*this).reading = false;
            (*udp).alloc_cb = None;
            (*udp).recv_cb = None;
        }
        let global = vm.global();
        let mut buf = UvBuf {
            base: core::ptr::null_mut(),
            len: 0,
        };
        let _scope = vm.enter_event_loop_scope();
        let _handles = CallbackScope::open(global);
        // SAFETY: calls the addon's callbacks on the loop thread with its handle.
        unsafe {
            alloc_cb(udp.cast::<UvHandle>(), 64 * 1024, &raw mut buf);
            if !UvUdpNode::closing(this) {
                recv_cb(udp, err as isize, &raw const buf, core::ptr::null(), 0);
            }
        }
        if global.has_exception() {
            let _ = bun_jsc::task::report_error_or_terminate(global, JsError::Thrown);
        }
    }

    /// # Safety
    /// `this` is a live handle's node.
    unsafe fn closing(this: *mut UvUdpNode) -> bool {
        // SAFETY: fn contract.
        unsafe { (*(*this).udp).handle.flags & UV_HANDLE_CLOSING != 0 }
    }

    /// Reads up to 32 datagrams, like libuv's `uv__udp_recvmsg`. Each one goes to
    /// `recv_cb` in a buffer from `alloc_cb`. Stops at the first `EAGAIN` (reported
    /// as `nread == 0` with no address so the addon can free the buffer), at an
    /// error, or when a callback stops receiving or closes the handle.
    ///
    /// # Safety
    /// Same as [`Self::on_poll`].
    unsafe fn receive(this: *mut UvUdpNode) {
        // SAFETY: fn contract.
        let (udp, vm) = unsafe {
            let udp = (*this).udp;
            (udp, &*(*(*udp).handle.loop_).vm.as_ptr())
        };
        let global = vm.global();
        for _ in 0..32 {
            // SAFETY: fn contract. The callbacks are set while `reading` is.
            let (Some(alloc_cb), Some(recv_cb)) = (unsafe { ((*udp).alloc_cb, (*udp).recv_cb) })
            else {
                return;
            };
            let mut buf = UvBuf {
                base: core::ptr::null_mut(),
                len: 0,
            };
            let _scope = vm.enter_event_loop_scope();
            let _handles = CallbackScope::open(global);
            // SAFETY: calls the addon's callback on the loop thread with its handle.
            unsafe { alloc_cb(udp.cast::<UvHandle>(), 64 * 1024, &raw mut buf) };
            // alloc_cb may have stopped receiving or closed the handle: read nothing,
            // and give the buffer back through recv_cb ("nothing read") so it's freed.
            // SAFETY: fn contract. The node outlives the callback.
            if unsafe { UvUdpNode::closing(this) || !(*this).reading } {
                if !buf.base.is_null() {
                    // SAFETY: same as the `alloc_cb` call.
                    unsafe { recv_cb(udp, 0, &raw const buf, core::ptr::null(), 0) };
                }
                return;
            }
            if buf.base.is_null() || buf.len == 0 {
                // SAFETY: same as above.
                unsafe {
                    recv_cb(
                        udp,
                        UV_ENOBUFS as isize,
                        &raw const buf,
                        core::ptr::null(),
                        0,
                    )
                };
                return;
            }
            // SAFETY: all-zero sockaddr_storage and msghdr are valid.
            let mut peer: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
            let mut msg: libc::msghdr = unsafe { core::mem::zeroed() };
            msg.msg_name = (&raw mut peer).cast::<c_void>();
            msg.msg_namelen = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
            msg.msg_iov = (&raw mut buf).cast::<libc::iovec>();
            msg.msg_iovlen = 1;
            let nread = loop {
                // SAFETY: `msg` points at `peer` and the addon's buffer. `fd` is open
                // because the handle is receiving.
                let n = unsafe { libc::recvmsg((*this).fd, &raw mut msg, 0) };
                if n >= 0 || uv_errno() != -libc::EINTR {
                    break if n >= 0 { n } else { uv_errno() as isize };
                }
            };
            let done = nread < 0;
            // SAFETY: same as the `alloc_cb` call.
            unsafe {
                if nread == -(libc::EAGAIN as isize) || nread == -(libc::EWOULDBLOCK as isize) {
                    recv_cb(udp, 0, &raw const buf, core::ptr::null(), 0);
                } else if nread < 0 {
                    recv_cb(udp, nread, &raw const buf, core::ptr::null(), 0);
                } else {
                    let flags = if msg.msg_flags & libc::MSG_TRUNC != 0 {
                        UV_UDP_PARTIAL
                    } else {
                        0
                    };
                    recv_cb(udp, nread, &raw const buf, (&raw const peer).cast(), flags);
                }
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                return;
            }
            // SAFETY: fn contract. The node outlives the callback.
            if done || unsafe { UvUdpNode::closing(this) || !(*this).reading } {
                return;
            }
        }
    }

    /// Sends what the socket will take, like libuv's `uv__udp_sendmsg`. A send that
    /// fails with anything but `EAGAIN` or `ENOBUFS` completes with that error.
    fn send_queued(&mut self) {
        while let Some(&req) = self.queued.front() {
            let req = req.as_ptr();
            // SAFETY: a queued request is alive until its callback has run.
            let n = unsafe {
                udp_sendmsg(
                    self.fd,
                    (*req).bufs,
                    (*req).nbufs,
                    &raw const (*req).addr,
                    (*req).addr_len,
                )
            };
            if n < 0 && would_block(n as c_int) {
                return;
            }
            // SAFETY: same as above.
            unsafe { (*req).status = n };
            let req = self.queued.pop_front().unwrap();
            self.completed.push_back(req);
        }
    }

    /// Runs the callbacks of completed sends, like libuv's `uv__udp_run_completed`. If
    /// a callback closes the handle, the canceled sends' callbacks run here too.
    ///
    /// # Safety
    /// Same as [`Self::on_poll`].
    unsafe fn run_completed(this: *mut UvUdpNode) {
        // SAFETY: fn contract.
        let (udp, vm) = unsafe {
            let udp = (*this).udp;
            (udp, &*(*(*udp).handle.loop_).vm.as_ptr())
        };
        let global = vm.global();
        // SAFETY: fn contract.
        unsafe { (*this).processing = true };
        // SAFETY: fn contract. The node outlives the callbacks.
        while let Some(req) = unsafe { (*this).completed.pop_front() } {
            let req = req.as_ptr();
            // SAFETY: the request is alive until its callback has run, and the
            // handle until its close_cb has.
            let (cb, status) = unsafe {
                (*udp).send_queue_size -= total_len((*req).bufs, (*req).nbufs);
                (*udp).send_queue_count -= 1;
                if (*req).bufs != (&raw mut (*req).bufsml).cast::<UvBuf>() {
                    drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                        (*req).bufs,
                        (*req).nbufs as usize,
                    )));
                }
                (*req).bufs = core::ptr::null_mut();
                let status = (*req).status;
                ((*req).cb, if status < 0 { status as c_int } else { 0 })
            };
            if let Some(cb) = cb {
                bun_output::scoped_log!(uv, "uv_udp_send_t {:?}: send_cb({})", req, status);
                let _scope = vm.enter_event_loop_scope();
                let _handles = CallbackScope::open(global);
                // SAFETY: calls the addon's callback on the loop thread with its request.
                unsafe { cb(req, status) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        // SAFETY: fn contract.
        unsafe { (*this).processing = false };
    }
}

impl UvUdp {
    /// Returns true if `handle` is a UDP handle.
    ///
    /// # Safety
    /// `handle` is null or points to an initialized handle.
    unsafe fn check(handle: *mut UvUdp) -> bool {
        // SAFETY: fn contract.
        !handle.is_null() && unsafe { (*handle).handle.type_ == UV_UDP }
    }

    /// Returns the node of a UDP handle that isn't closing.
    ///
    /// # Safety
    /// Same as [`Self::check`], and this is the loop thread.
    unsafe fn open_node<'a>(handle: *mut UvUdp) -> Option<&'a mut UvUdpNode> {
        // SAFETY: fn contract. A handle owns its node until its close task.
        unsafe {
            if !UvUdp::check(handle) || (*handle).handle.flags & UV_HANDLE_CLOSING != 0 {
                return None;
            }
            Some(&mut *(*handle).node)
        }
    }

    /// Called by `uv_close`. Stops receiving, closes the socket, and cancels the
    /// queued sends. Their callbacks run in [`Self::finish_close`], before `close_cb`.
    ///
    /// # Safety
    /// `handle` is a UDP handle being closed for the first time, on the loop thread.
    unsafe fn close(handle: *mut UvUdp) {
        // SAFETY: fn contract.
        let node = unsafe { &mut *(*handle).node };
        node.reading = false;
        if node.flush_pending {
            node.flush_pending = false;
            // SAFETY: fn contract. The loop outlives its handles.
            let loop_ = unsafe { &*(*handle).handle.loop_ };
            loop_.udp_pending.with_mut(|pending| pending.retain(|h| h.as_ptr() != handle));
        }
        if !node.poll.is_null() {
            // SAFETY: the node owns its poll. A poll freed during its own dispatch
            // is recycled after the tick.
            unsafe { (*node.poll).deinit() };
            node.poll = core::ptr::null_mut();
        }
        if node.fd != -1 {
            // SAFETY: the node owns the socket.
            unsafe { libc::close(node.fd) };
            node.fd = -1;
        }
        while let Some(req) = node.queued.pop_front() {
            // SAFETY: a queued request is alive until its callback has run.
            unsafe { (*req.as_ptr()).status = UV_ECANCELED as isize };
            node.completed.push_back(req);
        }
        // SAFETY: fn contract.
        unsafe {
            (*handle).alloc_cb = None;
            (*handle).recv_cb = None;
            (*handle).ref_state.set_active(false);
        }
    }

    /// Called by the close task before `close_cb`, like libuv's `uv__udp_finish_close`.
    /// Runs the callbacks of the sends that completed or were canceled, then frees the node.
    ///
    /// # Safety
    /// `handle` is a closed UDP handle whose close task is running, on the loop thread.
    pub(crate) unsafe fn finish_close(handle: *mut UvUdp) {
        // SAFETY: fn contract.
        unsafe {
            let node = (*handle).node;
            UvUdpNode::run_completed(node);
            debug_assert!((*node).completed.is_empty());
            bun_core::heap::destroy(node);
            (*handle).node = core::ptr::null_mut();
        }
    }
}

/// Implements `int uv_udp_init_ex(uv_loop_t*, uv_udp_t*, unsigned int flags)`. The low
/// 8 bits of `flags` are `AF_INET`, `AF_INET6` (open the socket now) or `AF_UNSPEC`
/// (open it on first use). `UV_UDP_RECVMMSG` is accepted and ignored.
///
/// # Safety
/// `loop_` is null or one of this module's loops. `handle` points to
/// `sizeof(uv_udp_t)` bytes that the addon keeps alive until its `close_cb` has run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_init_ex(
    loop_: *mut UvLoop,
    handle: *mut UvUdp,
    flags: c_uint,
) -> c_int {
    if loop_.is_null() || handle.is_null() {
        return UV_EINVAL;
    }
    let domain = (flags & 0xFF) as c_int;
    if domain != libc::AF_INET && domain != libc::AF_INET6 && domain != libc::AF_UNSPEC {
        return UV_EINVAL;
    }
    if flags & !0xFF & !UV_UDP_RECVMMSG != 0 {
        return UV_EINVAL;
    }
    let fd = if domain == libc::AF_UNSPEC {
        -1
    } else {
        match new_udp_socket(domain) {
            Ok(fd) => fd,
            Err(err) => return err,
        }
    };
    bun_output::scoped_log!(uv, "uv_udp_t {:?}: uv_udp_init_ex", handle);
    UvHandle::init(handle.cast::<UvHandle>(), loop_, UV_UDP);
    let node = bun_core::heap::alloc(UvUdpNode {
        udp: handle,
        fd: -1,
        poll: core::ptr::null_mut(),
        ipv6: false,
        connected: false,
        reading: false,
        processing: false,
        queued: VecDeque::new(),
        completed: VecDeque::new(),
        flush_pending: false,
        flush_err: 0,
    });
    // SAFETY: fn contract. Write field by field because the addon's memory is uninitialized.
    unsafe {
        (&raw mut (*handle).send_queue_size).write(0);
        (&raw mut (*handle).send_queue_count).write(0);
        (&raw mut (*handle).alloc_cb).write(None);
        (&raw mut (*handle).recv_cb).write(None);
        (&raw mut (*handle).node).write(node);
        (&raw mut (*handle).ref_state).write(RefState::new());
        if fd != -1 {
            (*node).set_socket(fd);
            (*node).ipv6 = domain == libc::AF_INET6;
        }
    }
    0
}

/// Implements `int uv_udp_init(uv_loop_t*, uv_udp_t*)`.
///
/// # Safety
/// Same as [`uv_udp_init_ex`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_init(loop_: *mut UvLoop, handle: *mut UvUdp) -> c_int {
    // SAFETY: fn contract.
    unsafe { uv_udp_init_ex(loop_, handle, libc::AF_UNSPEC as c_uint) }
}

/// Implements `int uv_udp_open(uv_udp_t*, uv_os_sock_t)`. The handle takes the
/// socket and makes it non-blocking. Returns `UV_EBUSY` if it already has one.
///
/// # Safety
/// `handle` was initialized by `uv_udp_init` or `uv_udp_init_ex`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_open(handle: *mut UvUdp, sock: c_int) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if node.fd != -1 {
        return UV_EBUSY;
    }
    if let Err(err) = set_nonblocking_cloexec(sock) {
        return err;
    }
    // SAFETY: all-zero sockaddr_storage is valid, and the lengths match the buffers.
    unsafe {
        let mut addr: libc::sockaddr_storage = core::mem::zeroed();
        let mut len = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
        if libc::getsockname(sock, (&raw mut addr).cast(), &raw mut len) == 0 {
            node.ipv6 = c_int::from(addr.ss_family) == libc::AF_INET6;
        }
        len = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
        node.connected = libc::getpeername(sock, (&raw mut addr).cast(), &raw mut len) == 0;
    }
    node.set_socket(sock);
    0
}

/// Implements `int uv_udp_bind(uv_udp_t*, const struct sockaddr*, unsigned int flags)`.
/// `UV_UDP_REUSEADDR` sets `SO_REUSEADDR` on Linux and `SO_REUSEPORT` on the BSDs,
/// like libuv, so several sockets can receive the same multicast datagrams.
///
/// # Safety
/// Same as [`uv_udp_open`], and `addr` is null or a `sockaddr` as long as its family says.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_bind(
    handle: *mut UvUdp,
    addr: *const libc::sockaddr,
    flags: c_uint,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if addr.is_null()
        || flags & !(UV_UDP_IPV6ONLY | UV_UDP_REUSEADDR | UV_UDP_REUSEPORT | UV_UDP_LINUX_RECVERR)
            != 0
    {
        return UV_EINVAL;
    }
    // SAFETY: fn contract.
    let Some(addr_len) = (unsafe { sockaddr_len(addr) }) else {
        return UV_EINVAL;
    };
    // SAFETY: fn contract.
    let family = c_int::from(unsafe { (*addr).sa_family });
    if flags & UV_UDP_IPV6ONLY != 0 && family != libc::AF_INET6 {
        return UV_EINVAL;
    }
    let err = node.ensure_socket(family);
    if err != 0 {
        return err;
    }
    let fd = node.fd;
    if flags & UV_UDP_REUSEADDR != 0 {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let option = libc::SO_REUSEADDR;
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let option = libc::SO_REUSEPORT;
        let err = set_int_option(fd, libc::SOL_SOCKET, option, 1);
        if err != 0 {
            return err;
        }
    }
    if flags & UV_UDP_REUSEPORT != 0 {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let err = set_int_option(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT, 1);
        #[cfg(target_os = "freebsd")]
        let err = set_int_option(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT_LB, 1);
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        let err = UV_ENOTSUP;
        if err != 0 {
            return err;
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if flags & UV_UDP_LINUX_RECVERR != 0 {
        let err = if family == libc::AF_INET6 {
            set_int_option(fd, libc::IPPROTO_IPV6, libc::IPV6_RECVERR, 1)
        } else {
            set_int_option(fd, libc::IPPROTO_IP, libc::IP_RECVERR, 1)
        };
        if err != 0 {
            return err;
        }
    }
    if flags & UV_UDP_IPV6ONLY != 0 {
        let err = set_int_option(fd, libc::IPPROTO_IPV6, libc::IPV6_V6ONLY, 1);
        if err != 0 {
            return err;
        }
    }
    // SAFETY: fn contract.
    if unsafe { libc::bind(fd, addr, addr_len) } < 0 {
        let err = uv_errno();
        // The BSDs fail this way binding an IPv4 socket to an IPv6 address or the reverse.
        return if err == -libc::EAFNOSUPPORT {
            UV_EINVAL
        } else {
            err
        };
    }
    node.ipv6 = family == libc::AF_INET6;
    0
}

/// Implements `int uv_udp_connect(uv_udp_t*, const struct sockaddr*)`. A null
/// `addr` disconnects.
///
/// # Safety
/// Same as [`uv_udp_bind`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_connect(
    handle: *mut UvUdp,
    addr: *const libc::sockaddr,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if addr.is_null() {
        if !node.connected {
            return UV_ENOTCONN;
        }
        // SAFETY: an all-zero sockaddr with family AF_UNSPEC dissolves the association.
        let r = unsafe {
            let mut unspec: libc::sockaddr = core::mem::zeroed();
            unspec.sa_family = libc::AF_UNSPEC as libc::sa_family_t;
            libc::connect(
                node.fd,
                &raw const unspec,
                core::mem::size_of::<libc::sockaddr>() as libc::socklen_t,
            )
        };
        // Linux and the BSDs disconnect but report these.
        if r < 0 {
            let err = uv_errno();
            if err != -libc::EAFNOSUPPORT && err != -libc::EINVAL {
                return err;
            }
        }
        node.connected = false;
        return 0;
    }
    if node.connected {
        return UV_EISCONN;
    }
    // SAFETY: fn contract.
    let Some(addr_len) = (unsafe { sockaddr_len(addr) }) else {
        return UV_EINVAL;
    };
    // SAFETY: fn contract.
    let err = node.ensure_socket(c_int::from(unsafe { (*addr).sa_family }));
    if err != 0 {
        return err;
    }
    loop {
        // SAFETY: fn contract.
        if unsafe { libc::connect(node.fd, addr, addr_len) } == 0 {
            break;
        }
        let err = uv_errno();
        if err != -libc::EINTR {
            return err;
        }
    }
    node.connected = true;
    0
}

/// `getsockname` or `getpeername` into the addon's buffer, like libuv's `uv__getsockpeername`.
///
/// # Safety
/// Same as [`uv_udp_open`]. `name` and `namelen` point to the addon's buffer and its length.
unsafe fn udp_name(
    handle: *mut UvUdp,
    name: *mut libc::sockaddr,
    namelen: *mut c_int,
    peer: bool,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if name.is_null() || namelen.is_null() {
        return UV_EINVAL;
    }
    if node.fd == -1 {
        return UV_EBADF;
    }
    // SAFETY: fn contract.
    unsafe {
        let mut len = *namelen as libc::socklen_t;
        let r = if peer {
            libc::getpeername(node.fd, name, &raw mut len)
        } else {
            libc::getsockname(node.fd, name, &raw mut len)
        };
        if r < 0 {
            return uv_errno();
        }
        *namelen = len as c_int;
    }
    0
}

/// Implements `int uv_udp_getsockname(const uv_udp_t*, struct sockaddr*, int*)`.
///
/// # Safety
/// Same as [`udp_name`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_getsockname(
    handle: *mut UvUdp,
    name: *mut libc::sockaddr,
    namelen: *mut c_int,
) -> c_int {
    // SAFETY: fn contract.
    unsafe { udp_name(handle, name, namelen, false) }
}

/// Implements `int uv_udp_getpeername(const uv_udp_t*, struct sockaddr*, int*)`.
///
/// # Safety
/// Same as [`udp_name`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_getpeername(
    handle: *mut UvUdp,
    name: *mut libc::sockaddr,
    namelen: *mut c_int,
) -> c_int {
    // SAFETY: fn contract.
    unsafe { udp_name(handle, name, namelen, true) }
}

/// Checks a send's address against the handle's connection and opens the socket
/// for its family if needed, like the start of libuv's `uv__udp_send`. Returns the
/// address length (0 on a connected socket) or a `UV_E*` code.
///
/// # Safety
/// `addr` is null or a `sockaddr` as long as its family says.
unsafe fn send_target(
    node: &mut UvUdpNode,
    addr: *const libc::sockaddr,
) -> Result<libc::socklen_t, c_int> {
    if addr.is_null() {
        return if node.connected {
            Ok(0)
        } else {
            Err(UV_EDESTADDRREQ)
        };
    }
    if node.connected {
        return Err(UV_EISCONN);
    }
    // SAFETY: fn contract.
    let len = unsafe { sockaddr_len(addr) }.ok_or(UV_EINVAL)?;
    // SAFETY: fn contract.
    match node.ensure_socket(c_int::from(unsafe { (*addr).sa_family })) {
        0 => Ok(len),
        err => Err(err),
    }
}

/// Implements `int uv_udp_send(uv_udp_send_t*, uv_udp_t*, const uv_buf_t[], unsigned
/// int nbufs, const struct sockaddr*, uv_udp_send_cb)`. Sends at once if nothing is
/// queued. `send_cb` runs on a later iteration either way, like in libuv. The
/// buffers' contents must stay valid until then.
///
/// # Safety
/// `req` points to `sizeof(uv_udp_send_t)` bytes the addon keeps alive until
/// `send_cb` has run. `bufs` points to `nbufs` buffers. Otherwise same as [`uv_udp_bind`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_send(
    req: *mut UvUdpSend,
    handle: *mut UvUdp,
    bufs: *const UvBuf,
    nbufs: c_uint,
    addr: *const libc::sockaddr,
    send_cb: Option<UvUdpSendCb>,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if req.is_null() || nbufs == 0 || bufs.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract.
    let addr_len = match unsafe { send_target(node, addr) } {
        Ok(len) => len,
        Err(err) => return err,
    };
    bun_output::scoped_log!(uv, "uv_udp_send_t {:?}: uv_udp_send", req);
    // SAFETY: fn contract. Write field by field because the addon's memory is
    // uninitialized. Skip `data`, which belongs to the addon.
    unsafe {
        (&raw mut (*req).req.type_).write(UV_UDP_SEND);
        (&raw mut (*req).req.reserved).write([core::ptr::null_mut(); 6]);
        (&raw mut (*req).handle).write(handle);
        (&raw mut (*req).cb).write(send_cb);
        (&raw mut (*req).addr).write(core::mem::zeroed());
        if addr_len != 0 {
            core::ptr::copy_nonoverlapping(
                addr.cast::<u8>(),
                (&raw mut (*req).addr).cast::<u8>(),
                addr_len as usize,
            );
        }
        (&raw mut (*req).addr_len).write(addr_len);
        (&raw mut (*req).nbufs).write(nbufs);
        (&raw mut (*req).status).write(0);
        let copy = if nbufs as usize <= 4 {
            let small = (&raw mut (*req).bufsml).cast::<UvBuf>();
            core::ptr::copy_nonoverlapping(bufs, small, nbufs as usize);
            small
        } else {
            Box::<[UvBuf]>::into_raw(core::slice::from_raw_parts(bufs, nbufs as usize).into())
                .cast::<UvBuf>()
        };
        (&raw mut (*req).bufs).write(copy);
        (*handle).send_queue_size += total_len(bufs, nbufs);
        (*handle).send_queue_count += 1;
    }
    let was_empty = node.queued.is_empty();
    // SAFETY: checked non-null above.
    node.queued
        .push_back(unsafe { NonNull::new_unchecked(req) });
    if was_empty && !node.processing {
        node.send_queued();
    }
    // Still queued means the socket hasn't taken it: if watching fails now, it's
    // failed, and goes back to the addon.
    let unsent = node.queued.iter().any(|r| r.as_ptr() == req);
    // SAFETY: the handle isn't closing (`open_node`).
    let err = unsafe { node.update() };
    if err == 0 {
        return 0;
    }
    let mut failed = false;
    // An unsent one goes back to the addon, as libuv's failed send does: its callback
    // won't run. `update` completed it with the error.
    if unsent {
        if let Some(i) = node.completed.iter().position(|r| r.as_ptr() == req) {
            node.completed.remove(i);
            // SAFETY: the request was set up above and is ours until its callback.
            unsafe {
                (*handle).send_queue_size -= total_len((*req).bufs, (*req).nbufs);
                (*handle).send_queue_count -= 1;
                if (*req).bufs != (&raw mut (*req).bufsml).cast::<UvBuf>() {
                    drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                        (*req).bufs,
                        (*req).nbufs as usize,
                    )));
                }
                (*req).bufs = core::ptr::null_mut();
            }
            failed = true;
        }
    }
    // The rest runs next turn: earlier sends that `update` completed with the error, a
    // read watch it couldn't keep, and this send's callback if the socket already took
    // it. That datagram is out, so for the addon this call succeeded.
    // SAFETY: the handle isn't closing (`open_node`).
    unsafe { node.defer_flush(err) };
    if failed { err } else { 0 }
}

/// Implements `int uv_udp_try_send(uv_udp_t*, const uv_buf_t[], unsigned int nbufs,
/// const struct sockaddr*)`. Returns the bytes sent, or `UV_EAGAIN` if sends are
/// still queued or the socket can't take it now.
///
/// # Safety
/// `bufs` points to `nbufs` buffers. Otherwise same as [`uv_udp_bind`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_try_send(
    handle: *mut UvUdp,
    bufs: *const UvBuf,
    nbufs: c_uint,
    addr: *const libc::sockaddr,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if nbufs == 0 || bufs.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract.
    if unsafe { (*handle).send_queue_count } != 0 {
        return UV_EAGAIN;
    }
    // SAFETY: fn contract.
    let addr_len = match unsafe { send_target(node, addr) } {
        Ok(len) => len,
        Err(err) => return err,
    };
    // SAFETY: an all-zero sockaddr_storage is valid. Copy the address so
    // `udp_sendmsg` can read `addr_len` bytes from it.
    let mut storage: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
    if addr_len != 0 {
        // SAFETY: `send_target` checked that `addr` is `addr_len` bytes.
        unsafe {
            core::ptr::copy_nonoverlapping(
                addr.cast::<u8>(),
                (&raw mut storage).cast::<u8>(),
                addr_len as usize,
            );
        }
    }
    // SAFETY: fn contract.
    let n = unsafe { udp_sendmsg(node.fd, bufs, nbufs, &raw const storage, addr_len) };
    if n < 0 && would_block(n as c_int) {
        return UV_EAGAIN;
    }
    c_int::try_from(n).unwrap_or(c_int::MAX)
}

/// Implements `int uv_udp_recv_start(uv_udp_t*, uv_alloc_cb, uv_udp_recv_cb)`.
/// Opens an IPv4 socket if the handle has none yet, like libuv.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_recv_start(
    handle: *mut UvUdp,
    alloc_cb: Option<UvAllocCb>,
    recv_cb: Option<UvUdpRecvCb>,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if alloc_cb.is_none() || recv_cb.is_none() {
        return UV_EINVAL;
    }
    if node.reading {
        return UV_EALREADY;
    }
    let err = node.ensure_socket(libc::AF_INET);
    if err != 0 {
        return err;
    }
    // SAFETY: fn contract.
    unsafe {
        (*handle).alloc_cb = alloc_cb;
        (*handle).recv_cb = recv_cb;
    }
    node.reading = true;
    // SAFETY: the handle isn't closing (`open_node`).
    let err = unsafe { node.update() };
    if err != 0 {
        node.reading = false;
        // SAFETY: fn contract.
        unsafe {
            (*handle).alloc_cb = None;
            (*handle).recv_cb = None;
            // Drop a read watch it kept. Sends that either `update` completed with
            // its error run their callbacks next turn.
            let again = node.update();
            node.defer_flush(if again != 0 { again } else { err });
        }
        return err;
    }
    0
}

/// Implements `int uv_udp_recv_stop(uv_udp_t*)`.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_recv_stop(handle: *mut UvUdp) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        // Like libuv, stopping a closing handle is fine.
        // SAFETY: fn contract.
        return if unsafe { UvUdp::check(handle) } {
            0
        } else {
            UV_EINVAL
        };
    };
    node.reading = false;
    // SAFETY: fn contract.
    unsafe {
        (*handle).alloc_cb = None;
        (*handle).recv_cb = None;
        // A failure here (putting back the write watch for queued sends) completes
        // those sends with the error; their callbacks run next turn.
        let err = node.update();
        if err != 0 {
            node.defer_flush(err);
        }
    }
    0
}

/// Implements `int uv_udp_using_recvmmsg(const uv_udp_t*)`. Bun reads one datagram
/// per `recvmsg`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_udp_using_recvmmsg(_handle: *const UvUdp) -> c_int {
    0
}

/// Implements `size_t uv_udp_get_send_queue_size(const uv_udp_t*)`.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_get_send_queue_size(handle: *mut UvUdp) -> usize {
    // SAFETY: fn contract.
    unsafe { (*handle).send_queue_size }
}

/// Implements `size_t uv_udp_get_send_queue_count(const uv_udp_t*)`.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_get_send_queue_count(handle: *mut UvUdp) -> usize {
    // SAFETY: fn contract.
    unsafe { (*handle).send_queue_count }
}

/// Sets an IPv4 or IPv6 socket option, whichever matches the socket, like libuv's
/// `uv__setsockopt`. `value` must be in `min..=255`.
///
/// # Safety
/// Same as [`uv_udp_open`].
unsafe fn set_ip_option(
    handle: *mut UvUdp,
    v4: c_int,
    v6: c_int,
    value: c_int,
    min: c_int,
) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if value < min || value > 255 {
        return UV_EINVAL;
    }
    if node.fd == -1 {
        return UV_EBADF;
    }
    if node.ipv6 {
        set_int_option(node.fd, libc::IPPROTO_IPV6, v6, value)
    } else {
        set_int_option(node.fd, libc::IPPROTO_IP, v4, value)
    }
}

/// Implements `int uv_udp_set_ttl(uv_udp_t*, int ttl)`. `ttl` is 1 to 255.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_set_ttl(handle: *mut UvUdp, ttl: c_int) -> c_int {
    // SAFETY: fn contract.
    unsafe { set_ip_option(handle, libc::IP_TTL, libc::IPV6_UNICAST_HOPS, ttl, 1) }
}

/// Implements `int uv_udp_set_multicast_ttl(uv_udp_t*, int ttl)`. `ttl` is 0 to 255.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_set_multicast_ttl(handle: *mut UvUdp, ttl: c_int) -> c_int {
    // SAFETY: fn contract.
    unsafe {
        set_ip_option(
            handle,
            libc::IP_MULTICAST_TTL,
            libc::IPV6_MULTICAST_HOPS,
            ttl,
            0,
        )
    }
}

/// Implements `int uv_udp_set_multicast_loop(uv_udp_t*, int on)`.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_set_multicast_loop(handle: *mut UvUdp, on: c_int) -> c_int {
    // SAFETY: fn contract.
    unsafe {
        set_ip_option(
            handle,
            libc::IP_MULTICAST_LOOP,
            libc::IPV6_MULTICAST_LOOP,
            on,
            0,
        )
    }
}

/// Implements `int uv_udp_set_broadcast(uv_udp_t*, int on)`.
///
/// # Safety
/// Same as [`uv_udp_open`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_udp_set_broadcast(handle: *mut UvUdp, on: c_int) -> c_int {
    // SAFETY: fn contract.
    let Some(node) = (unsafe { UvUdp::open_node(handle) }) else {
        return UV_EINVAL;
    };
    if node.fd == -1 {
        return UV_EBADF;
    }
    set_int_option(node.fd, libc::SOL_SOCKET, libc::SO_BROADCAST, on)
}

/// Reads (`*value == 0`) or sets a socket's buffer size, like libuv's
/// `uv__socket_sockopt`. Bun's only socket handle is `uv_udp_t`.
///
/// # Safety
/// `handle` was initialized by one of this module's `uv_*_init`, and `value` is null
/// or points to an int.
unsafe fn buffer_size(
    handle: *mut UvHandle,
    value: *mut c_int,
    option: c_int,
    function: &'static CStr,
) -> c_int {
    if handle.is_null() || value.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract.
    if unsafe { handle_type(handle, function) } != UV_UDP {
        return UV_ENOTSUP;
    }
    // SAFETY: `handle` is a UDP handle. A closing one has no socket.
    let fd = unsafe {
        let udp = handle.cast::<UvUdp>();
        if (*udp).handle.flags & UV_HANDLE_CLOSING != 0 {
            return UV_EBADF;
        }
        (*(*udp).node).fd
    };
    // SAFETY: `value` points to an int (fn contract).
    let r = unsafe {
        let mut len = core::mem::size_of::<c_int>() as libc::socklen_t;
        if *value == 0 {
            libc::getsockopt(fd, libc::SOL_SOCKET, option, value.cast(), &raw mut len)
        } else {
            libc::setsockopt(fd, libc::SOL_SOCKET, option, value.cast_const().cast(), len)
        }
    };
    if r < 0 { uv_errno() } else { 0 }
}

/// Implements `int uv_send_buffer_size(uv_handle_t*, int* value)`.
///
/// # Safety
/// Same as [`buffer_size`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_send_buffer_size(
    handle: *mut UvHandle,
    value: *mut c_int,
) -> c_int {
    // SAFETY: fn contract.
    unsafe { buffer_size(handle, value, libc::SO_SNDBUF, c"uv_send_buffer_size") }
}

/// Implements `int uv_recv_buffer_size(uv_handle_t*, int* value)`.
///
/// # Safety
/// Same as [`buffer_size`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_recv_buffer_size(
    handle: *mut UvHandle,
    value: *mut c_int,
) -> c_int {
    // SAFETY: fn contract.
    unsafe { buffer_size(handle, value, libc::SO_RCVBUF, c"uv_recv_buffer_size") }
}

/// Implements `int uv_fileno(const uv_handle_t*, uv_os_fd_t*)`. Only a UDP handle has
/// a descriptor. `UV_EBADF` until its socket exists or once it's closing.
///
/// # Safety
/// `handle` was initialized by one of this module's `uv_*_init`, and `fd` is null or
/// points to an int.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_fileno(handle: *mut UvHandle, fd: *mut c_int) -> c_int {
    if handle.is_null() || fd.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract.
    if unsafe { handle_type(handle, c"uv_fileno") } != UV_UDP {
        return UV_EINVAL;
    }
    // SAFETY: `handle` is a UDP handle.
    let Some(node) = (unsafe { UvUdp::open_node(handle.cast::<UvUdp>()) }) else {
        return UV_EBADF;
    };
    if node.fd == -1 {
        return UV_EBADF;
    }
    // SAFETY: fn contract.
    unsafe { *fd = node.fd };
    0
}

// ──────────────────────────────────────────────────────────────────────────
// uv_handle_t (functions that accept any handle type)
// ──────────────────────────────────────────────────────────────────────────

/// Returns `handle`'s type. Crashes like `function`'s stub if Bun doesn't implement
/// that handle type.
///
/// # Safety
/// `handle` points to an initialized handle.
unsafe fn handle_type(handle: *mut UvHandle, function: &'static CStr) -> c_uint {
    // SAFETY: fn contract.
    match unsafe { (*handle).type_ } {
        type_ @ (UV_ASYNC | UV_IDLE | UV_PREPARE | UV_CHECK | UV_TIMER | UV_UDP) => type_,
        _ => unsupported(function),
    }
}

/// Returns the handle's [`RefState`], whose offset depends on the handle type.
///
/// # Safety
/// Same as [`handle_type`]. This is the loop thread, and the caller doesn't use the
/// returned pointer after it calls back into the addon.
unsafe fn ref_state(handle: *mut UvHandle, function: &'static CStr) -> *mut RefState {
    // SAFETY: fn contract. `type` says which struct `handle` is the start of.
    unsafe {
        match handle_type(handle, function) {
            UV_ASYNC => &raw mut (*handle.cast::<UvAsync>()).ref_state,
            UV_TIMER => &raw mut (*handle.cast::<UvTimer>()).ref_state,
            UV_UDP => &raw mut (*handle.cast::<UvUdp>()).ref_state,
            _ => &raw mut (*handle.cast::<UvWatcher>()).ref_state,
        }
    }
}

/// `uv_close` posts the handle as a task.
impl Taskable for UvHandle {
    const TAG: TaskTag = task_tag::UvHandleClose;
    /// Still runs `close_cb` because that's where the addon frees the handle. Any JS
    /// it tries to run is refused.
    unsafe fn release_unrun(this: *mut Self) {
        // On `Err` the exception is still pending, and the release dispatcher handles it.
        // SAFETY: fn contract.
        let _ = unsafe { UvHandle::run_close(this) };
    }
    /// Not tied to one context, like [`UvLoop`]'s task.
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl UvHandle {
    /// Runs `close_cb` one turn after `uv_close`. The callback usually frees the
    /// handle, so don't read it afterwards.
    ///
    /// # Safety
    /// `uv_close` posted the task for `handle`, which the addon keeps alive until
    /// `close_cb` has run. This is the loop thread.
    pub(crate) unsafe fn run_close(handle: *mut UvHandle) -> JsResult<()> {
        // SAFETY: fn contract.
        let (close_cb, loop_) = unsafe {
            (*handle).flags |= UV_HANDLE_CLOSED;
            if (*handle).type_ == UV_UDP {
                UvUdp::finish_close(handle.cast::<UvUdp>());
            }
            ((*handle).close_cb, (*handle).loop_)
        };
        bun_output::scoped_log!(uv, "uv_handle_t {:?}: close_cb", handle);
        // SAFETY: the VM owns the loop, so it outlives its handles.
        let global = unsafe { &*loop_ }.global();
        if let Some(close_cb) = close_cb {
            let _handles = CallbackScope::open(global);
            // SAFETY: calls the addon's callback on the loop thread with its handle.
            unsafe { close_cb(handle) };
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

/// Implements `void uv_close(uv_handle_t*, uv_close_cb)`. Stops the handle immediately
/// and runs `close_cb` on a later turn, like libuv does. A second close is a no-op.
///
/// # Safety
/// `handle` was initialized by one of this module's `uv_*_init`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_close(handle: *mut UvHandle, close_cb: Option<UvCloseCb>) {
    // SAFETY: fn contract.
    let type_ = unsafe { handle_type(handle, c"uv_close") };
    // SAFETY: `handle` is initialized, and only the loop thread uses the plain fields.
    let loop_ = unsafe {
        if (*handle).flags & UV_HANDLE_CLOSING != 0 {
            return;
        }
        (*handle).flags |= UV_HANDLE_CLOSING;
        (*handle).close_cb = close_cb;
        // The loop outlives its handles.
        &*(*handle).loop_
    };
    bun_output::scoped_log!(uv, "uv_handle_t {:?}: uv_close", handle);
    // SAFETY: `handle` was initialized as `type_` and wasn't closed before this call.
    unsafe {
        match type_ {
            UV_ASYNC => {
                let async_ = NonNull::new_unchecked(handle.cast::<UvAsync>());
                UvAsync::stop_sends(async_);
                loop_.unregister(async_);
                (*async_.as_ptr()).ref_state.set_active(false);
            }
            UV_TIMER => UvTimer::close(handle.cast::<UvTimer>()),
            UV_UDP => UvUdp::close(handle.cast::<UvUdp>()),
            _ => UvWatcher::stop(handle.cast::<UvWatcher>()),
        }
    }
    // The queued task keeps the loop alive until `close_cb` has run, like libuv's
    // closing list. If the VM is gone, the task is refused and `close_cb` never runs.
    let task = ConcurrentTask::create_from(handle);
    if let Posted::Refused(task) = loop_.handle.post(LoopKind::Regular, task) {
        // SAFETY: a refused task was never queued, so we own it.
        unsafe { ConcurrentTask::release_refused(task) };
    }
}

/// Implements `void uv_ref(uv_handle_t*)`. Idempotent. Only matters while the handle
/// is active.
///
/// # Safety
/// Same as [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_ref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    unsafe { (*ref_state(handle, c"uv_ref")).set_referenced(true) };
}

/// Implements `void uv_unref(uv_handle_t*)`. Idempotent.
///
/// # Safety
/// Same as [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_unref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    unsafe { (*ref_state(handle, c"uv_unref")).set_referenced(false) };
}

/// Implements `int uv_has_ref(const uv_handle_t*)`.
///
/// # Safety
/// Same as [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_has_ref(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    c_int::from(unsafe { (*ref_state(handle, c"uv_has_ref")).referenced })
}

/// Implements `int uv_is_active(const uv_handle_t*)`. A watcher or timer is active
/// while it's started. An async handle is active until it's closed because libuv
/// starts it in init.
///
/// # Safety
/// Same as [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_active(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    c_int::from(unsafe { (*ref_state(handle, c"uv_is_active")).active })
}

/// Implements `int uv_is_closing(const uv_handle_t*)`. Returns true once `uv_close`
/// has been called.
///
/// # Safety
/// Same as [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_closing(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    unsafe { handle_type(handle, c"uv_is_closing") };
    // SAFETY: `handle` is initialized, and this is the loop thread.
    let flags = unsafe { (*handle).flags };
    c_int::from(flags & (UV_HANDLE_CLOSING | UV_HANDLE_CLOSED) != 0)
}

// ──────────────────────────────────────────────────────────────────────────
// uv_req_t / uv_work_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `UV_REQ_FIELDS` (uv.h), which every request starts with. Addons read
/// `data` and `type`.
#[repr(C)]
pub(crate) struct UvReq {
    data: *mut c_void,
    type_: c_uint,
    reserved: [*mut c_void; 6],
}

const _: () = assert!(core::mem::offset_of!(UvReq, data) == 0);
const _: () = assert!(core::mem::offset_of!(UvReq, type_) == 8);
const _: () = assert!(core::mem::size_of::<UvReq>() == 64);

#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum WorkState {
    /// In the thread pool's queue. `uv_cancel` can still cancel it.
    Queued = 0,
    /// `work_cb` has started or finished, so it's too late to cancel.
    Running = 1,
    /// `uv_cancel` canceled it, so `after_work_cb` gets `UV_ECANCELED`.
    Cancelled = 2,
}

/// Matches `struct uv_work_s`. Addons also read the three fields after `req`. Bun's
/// state replaces libuv's `struct uv__work`.
#[repr(C)]
pub(crate) struct UvWork {
    req: UvReq,
    loop_: *mut UvLoop,
    work_cb: Option<UvWorkCb>,
    after_work_cb: Option<UvAfterWorkCb>,
    /// A [`WorkState`]. The pool thread and `uv_cancel` race to change it from `Queued`.
    state: AtomicU32,
}

const _: () = assert!(core::mem::offset_of!(UvWork, req) == 0);
const _: () = assert!(core::mem::offset_of!(UvWork, loop_) == 64);
const _: () = assert!(core::mem::offset_of!(UvWork, work_cb) == 72);
const _: () = assert!(core::mem::offset_of!(UvWork, after_work_cb) == 80);
const _: () = assert!(core::mem::size_of::<UvWork>() <= UV_WORK_T_SIZE);

/// Runs one `uv_queue_work` request as a [`Job`]. The job's off-thread state is the
/// request, which the addon keeps alive until `after_work_cb` has run. That covers
/// the job's whole lifetime.
///
/// A stopping VM releases the job without calling `after_work_cb`, so the addon's
/// request leaks. Calling it isn't safe then. `work_cb` may never have run, and addons
/// that never call `uv_cancel` ignore the status. The V8 API would also still enter JS.
struct UvWorkJob;

impl JobContext for UvWorkJob {
    type OffThread = JsPtr<UvWork>;
    type Js = ();

    // SAFETY: never create a reference to the whole request, because `run` on the pool
    // thread can overlap `uv_cancel` on the loop thread. Access fields through the raw
    // pointer and borrow only `state`.

    fn run(req: &mut JsPtr<UvWork>, done: Completion<Self>) -> Option<Completion<Self>> {
        let req = req.as_ptr();
        // SAFETY: the request is alive for the job's lifetime (see `UvWorkJob`), and
        // `work_cb` was written before the job was scheduled.
        let started = unsafe { &(*req).state }
            .compare_exchange(
                WorkState::Queued as u32,
                WorkState::Running as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok();
        // SAFETY: same as above.
        if started && let Some(work_cb) = unsafe { (*req).work_cb } {
            // SAFETY: calls the addon's callback on a pool thread, as libuv documents.
            unsafe { work_cb(req) };
        }
        Some(done)
    }

    fn then(req: JsPtr<UvWork>, _: (), cx: &JsThread<'_>) -> JsResult<()> {
        let req = req.as_ptr();
        // SAFETY: same as `run`. `state` doesn't change after the job is posted.
        let (state, after_work_cb) =
            unsafe { ((*req).state.load(Ordering::SeqCst), (*req).after_work_cb) };
        let status = if state == WorkState::Cancelled as u32 {
            UV_ECANCELED
        } else {
            0
        };
        bun_output::scoped_log!(uv, "uv_work_t {:?}: after_work_cb({})", req, status);
        // The callback usually frees the request.
        if let Some(after_work_cb) = after_work_cb {
            let _handles = CallbackScope::open(cx.global());
            // SAFETY: calls the addon's callback on the loop thread.
            unsafe { after_work_cb(req, status) };
        }
        if cx.global().has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

/// Implements `int uv_queue_work(uv_loop_t*, uv_work_t*, uv_work_cb, uv_after_work_cb)`.
/// The request keeps the process alive, like an active request in libuv.
///
/// # Safety
/// `loop_` is null or one of this module's loops. `req` points to `sizeof(uv_work_t)`
/// bytes that the addon keeps alive until its `after_work_cb` has run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_queue_work(
    loop_: *mut UvLoop,
    req: *mut UvWork,
    work_cb: Option<UvWorkCb>,
    after_work_cb: Option<UvAfterWorkCb>,
) -> c_int {
    let (Some(loop_ref), Some(req_ref), Some(_)) = (
        NonNull::new(loop_),
        NonNull::new(req),
        work_cb, // libuv also returns UV_EINVAL
    ) else {
        return UV_EINVAL;
    };
    bun_output::scoped_log!(uv, "uv_work_t {:?}: uv_queue_work", req);
    // SAFETY: fn contract. Write field by field because the addon's memory is
    // uninitialized. Skip `data`, which belongs to the addon.
    unsafe {
        (&raw mut (*req).req.type_).write(UV_WORK);
        (&raw mut (*req).req.reserved).write([core::ptr::null_mut(); 6]);
        (&raw mut (*req).loop_).write(loop_);
        (&raw mut (*req).work_cb).write(work_cb);
        (&raw mut (*req).after_work_cb).write(after_work_cb);
        (&raw mut (*req).state).write(AtomicU32::new(WorkState::Queued as u32));
    }
    // SAFETY: the loop is alive (fn contract), and this is the JS thread.
    let cx = unsafe { loop_ref.as_ref() }.global().js_thread_of_caller();
    // SAFETY: the request outlives the job (fn contract, see `UvWorkJob`).
    Job::<UvWorkJob>::schedule(&cx, unsafe { JsPtr::new(req_ref) }, ());
    0
}

/// Implements `int uv_cancel(uv_req_t*)`. Like in libuv, it runs on the loop thread,
/// so it can't race `after_work_cb`. Returns the same codes as libuv:
/// - `0` if the work was canceled. `after_work_cb` then gets `UV_ECANCELED`.
/// - `UV_EBUSY` if the work already started.
/// - `UV_EINVAL` for any request type other than `uv_work_t`.
///
/// # Safety
/// `req` is null or a queued request whose `after_work_cb` has not returned.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_cancel(req: *mut UvReq) -> c_int {
    if req.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract. `type` is written before the request is queued.
    if unsafe { (*req).type_ } != UV_WORK {
        return UV_EINVAL;
    }
    // SAFETY: `type` says this is a `UvWork`. Only touch its atomic because the pool
    // thread can be in `run`.
    let state = unsafe { &(*req.cast::<UvWork>()).state };
    match state.compare_exchange(
        WorkState::Queued as u32,
        WorkState::Cancelled as u32,
        Ordering::SeqCst,
        Ordering::SeqCst,
    ) {
        Ok(_) => 0,
        Err(_) => UV_EBUSY,
    }
}

pub(crate) fn fix_dead_code_elimination() {
    bun_core::keep_symbols!(
        uv_async_init,
        uv_async_send,
        uv_cancel,
        uv_check_init,
        uv_check_start,
        uv_check_stop,
        uv_close,
        uv_default_loop,
        uv_fileno,
        uv_has_ref,
        uv_idle_init,
        uv_idle_start,
        uv_idle_stop,
        uv_is_active,
        uv_is_closing,
        uv_now,
        uv_prepare_init,
        uv_prepare_start,
        uv_prepare_stop,
        uv_queue_work,
        uv_recv_buffer_size,
        uv_ref,
        uv_send_buffer_size,
        uv_timer_again,
        uv_timer_get_due_in,
        uv_timer_get_repeat,
        uv_timer_init,
        uv_timer_set_repeat,
        uv_timer_start,
        uv_timer_stop,
        uv_udp_bind,
        uv_udp_connect,
        uv_udp_get_send_queue_count,
        uv_udp_get_send_queue_size,
        uv_udp_getpeername,
        uv_udp_getsockname,
        uv_udp_init,
        uv_udp_init_ex,
        uv_udp_open,
        uv_udp_recv_start,
        uv_udp_recv_stop,
        uv_udp_send,
        uv_udp_set_broadcast,
        uv_udp_set_multicast_loop,
        uv_udp_set_multicast_ttl,
        uv_udp_set_ttl,
        uv_udp_try_send,
        uv_udp_using_recvmmsg,
        uv_unref,
        uv_update_time,
    );
}
