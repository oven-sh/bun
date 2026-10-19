//! Implements the event loop part of libuv's API for N-API addons on POSIX:
//! `uv_default_loop`, the `uv_async_t`, `uv_idle_t`, `uv_prepare_t`, `uv_check_t`
//! and `uv_timer_t` handles, `uv_queue_work`, and the `uv_handle_t` functions.
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
//! - A handle keeps the process alive while it is started and ref'd ([`RefState`]).

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicU8, AtomicU32, Ordering};

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::{ContextId, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::event_loop::ConcurrentTaskItem as ConcurrentTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    Completion, JSGlobalObject, Job, JobContext, JsCell, JsError, JsPtr, JsResult, JsThread,
    LoopKind, Posted, VmHandle,
};

use crate::jsc_hooks::{RuntimeState, timer_all_mut};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(uv, hidden);

unsafe extern "C" {
    /// Crashes the same way the stubs do. `name` must be static. Never returns.
    fn CrashHandler__unsupportedUVFunction(name: *const c_char);
    /// Returns null while the GC is sweeping. `HandleScopeImpl__close` accepts null.
    fn HandleScopeImpl__open(global: *const JSGlobalObject) -> *mut c_void;
    fn HandleScopeImpl__close(global: *const JSGlobalObject, scope: *mut c_void);
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
            // SAFETY: `global` is alive, and this is its JS thread.
            scope: unsafe { HandleScopeImpl__open(global) },
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

// Indexes into uv.h's `UV_HANDLE_TYPE_MAP` and `UV_REQ_TYPE_MAP`.
const UV_ASYNC: c_uint = 1;
const UV_CHECK: c_uint = 2;
const UV_IDLE: c_uint = 6;
const UV_PREPARE: c_uint = 9;
const UV_TIMER: c_uint = 13;
const UV_WORK: c_uint = 7;

// Same `flags` values as libuv (src/uv-common.h).
const UV_HANDLE_CLOSING: c_uint = 0x01;
const UV_HANDLE_CLOSED: c_uint = 0x02;

// `sizeof` each struct on 64-bit unix. The addon allocates them, so Bun's versions can't be bigger.
const UV_ASYNC_T_SIZE: usize = 128;
const UV_WATCHER_T_SIZE: usize = 120;
const UV_TIMER_T_SIZE: usize = 152;
const UV_WORK_T_SIZE: usize = 128;

type UvAsyncCb = unsafe extern "C" fn(*mut UvAsync);
/// `uv_idle_cb`, `uv_prepare_cb` and `uv_check_cb` all have this signature.
type UvWatcherCb = unsafe extern "C" fn(*mut UvWatcher);
type UvTimerCb = unsafe extern "C" fn(*mut UvTimer);
type UvCloseCb = unsafe extern "C" fn(*mut UvHandle);
type UvWorkCb = unsafe extern "C" fn(*mut UvWork);
type UvAfterWorkCb = unsafe extern "C" fn(*mut UvWork, c_int);

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
        type_ @ (UV_ASYNC | UV_IDLE | UV_PREPARE | UV_CHECK | UV_TIMER) => type_,
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
    let cx = unsafe { loop_ref.as_ref() }
        .global()
        .js_thread_of_caller_no_frame();
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
        uv_ref,
        uv_timer_again,
        uv_timer_get_due_in,
        uv_timer_get_repeat,
        uv_timer_init,
        uv_timer_set_repeat,
        uv_timer_start,
        uv_timer_stop,
        uv_unref,
        uv_update_time,
    );
}
