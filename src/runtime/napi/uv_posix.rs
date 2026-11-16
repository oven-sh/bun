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
//! - Only `uv_async_send` and `uv_queue_work` work off the loop's JS thread. A handle is valid
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
use core::ffi::{c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicU8, AtomicU32, Ordering};

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::{ContextId, TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::event_loop::ConcurrentTaskItem as ConcurrentTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    Completion, JSGlobalObject, Job, JobContext, JsError, JsResult, JsThread, LoopKind, Posted,
    VmHandle,
};
use bun_ptr::{AliasableBox, CellExt};
use bun_threading::work_pool::WorkPool;

use crate::jsc_hooks::{RuntimeState, runtime_state, timer_all};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(uv, hidden);

unsafe extern "C" {
    /// Returns null while the GC is sweeping. `HandleScopeImpl__close` accepts null.
    safe fn HandleScopeImpl__open(global: &JSGlobalObject) -> *mut c_void;
    fn HandleScopeImpl__close(global: &JSGlobalObject, scope: *mut c_void);
}

#[cold]
fn unsupported(function: &'static [u8]) -> ! {
    bun_crash_handler::unsupported_uv_function(function)
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

// Indexes into uv.h's `UV_HANDLE_TYPE_MAP` and `UV_REQ_TYPE_MAP`.
const UV_ASYNC: c_uint = 1;
const UV_CHECK: c_uint = 2;
const UV_IDLE: c_uint = 6;
const UV_PREPARE: c_uint = 9;
const UV_TIMER: c_uint = 13;
const UV_WORK: c_uint = 7;

// Same `flags` value as libuv (src/uv-common.h).
const UV_HANDLE_CLOSING: c_uint = 0x01;

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
    referenced: Cell<bool>,
    active: Cell<bool>,
}

impl RefState {
    fn new() -> RefState {
        RefState {
            keep_alive: KeepAlive::default(),
            referenced: Cell::new(true),
            active: Cell::new(false),
        }
    }

    fn set_active(&self, active: bool) {
        self.active.set(active);
        self.sync();
    }

    fn set_referenced(&self, referenced: bool) {
        self.referenced.set(referenced);
        self.sync();
    }

    fn sync(&self) {
        if self.active.get() && self.referenced.get() {
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
    shared: UvLoopShared,
    /// Async handles that are initialized and not closed.
    asyncs: HandleList<AsyncFields>,
    idles: WatcherList,
    prepares: WatcherList,
    checks: WatcherList,
}

const _: () = assert!(core::mem::offset_of!(UvLoop, data) == 0);

/// All that `uv_async_send` uses of the loop, from any thread.
struct UvLoopShared {
    handle: VmHandle,
    dispatch_state: AtomicU8,
}

const fn assert_sync<T: Sync>() {}
const _: () = assert_sync::<UvLoopShared>();

impl UvLoopShared {
    /// Queues the dispatch task unless one is already queued.
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
        let task = ConcurrentTask::create_from(core::ptr::null_mut::<UvLoop>());
        if let Posted::Refused(_) = self.handle.post(LoopKind::Regular, task) {
            // The VM is gone, so drop the callback like a closed libuv loop does.
            self.dispatch_state
                .store(DispatchState::Idle as u8, Ordering::SeqCst);
        }
    }
}

/// Lists handles in the order they were added, for a walk whose callbacks add and remove handles.
struct HandleList<T> {
    listed: Cell<Vec<NonNull<UvHandle<T>>>>,
    /// Handles the running walk hasn't reached yet, in reverse order.
    walking: Cell<Vec<NonNull<UvHandle<T>>>>,
}

impl<T> HandleList<T> {
    fn new() -> Self {
        HandleList {
            listed: Cell::default(),
            walking: Cell::default(),
        }
    }

    /// # Safety
    /// The list belongs to `handle`'s loop, and `handle` is removed before its `close_cb` runs.
    unsafe fn add(&self, handle: &HandleRef<'_, T>) {
        self.listed.with_taken(|listed| listed.push(handle.ptr));
    }

    /// Uses `retain` because a handle that was initialized twice is in the list twice.
    fn remove(&self, handle: &HandleRef<'_, T>) {
        for list in [&self.listed, &self.walking] {
            list.with_taken(|handles| handles.retain(|h| *h != handle.ptr));
        }
    }

    fn is_empty(&self) -> bool {
        self.listed.with_taken(|listed| listed.is_empty())
    }

    /// Handles added from here on wait for the next walk.
    fn begin_walk(&self) {
        let mut listed = self.listed.take();
        listed.reverse();
        let walked = self.walking.replace(listed);
        debug_assert!(walked.is_empty());
        self.listed.set(walked);
    }

    /// # Safety
    /// The caller is done with the handle before the event loop runs another task.
    unsafe fn walk_next(&self) -> Option<HandleRef<'_, T>> {
        let next = self.walking.with_taken(Vec::pop)?;
        // SAFETY: `add`'s contract, and fn contract. The list is not `Sync`: this is its loop's thread.
        unsafe {
            let handle = HandleRef::new(next);
            self.add(&handle);
            Some(handle)
        }
    }

    /// Handles only remain here after a termination.
    fn end_walk(&self) {
        self.walking.with_taken(|walking| {
            if !walking.is_empty() {
                self.listed
                    .with_taken(|listed| listed.extend(walking.drain(..).rev()));
            }
        });
    }
}

/// Lists the started handles of one watcher type. `walk` is libuv's `uv__run_idle` and friends.
struct WatcherList {
    started: HandleList<WatcherFields>,
    /// True while a walk is on the stack. A nested event loop run skips the walk.
    in_walk: Cell<bool>,
}

impl WatcherList {
    fn new() -> WatcherList {
        WatcherList {
            started: HandleList::new(),
            in_walk: Cell::new(false),
        }
    }

    fn is_empty(&self) -> bool {
        self.started.is_empty()
    }

    fn walk(&self, vm: &VirtualMachine) {
        if self.is_empty() || self.in_walk.replace(true) {
            return;
        }
        self.started.begin_walk();
        let global = vm.global();
        // SAFETY: nothing ticks the event loop before the callback, which gets the handle.
        while let Some(watcher) = unsafe { self.started.walk_next() } {
            let Some(cb) = watcher.body.cb.get() else {
                continue;
            };
            {
                let _scope = vm.enter_event_loop_scope();
                let _handles = CallbackScope::open(global);
                // SAFETY: calls the addon's callback on the loop thread with a
                // handle it started.
                unsafe { cb(watcher.into_raw()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        self.started.end_walk();
        self.in_walk.set(false);
    }
}

impl UvLoop {
    /// Called by `init_runtime_state` on the JS thread, with its VM's [`VmHandle`].
    pub(crate) fn new(handle: VmHandle) -> UvLoop {
        UvLoop {
            data: Cell::new(core::ptr::null_mut()),
            shared: UvLoopShared {
                handle,
                dispatch_state: AtomicU8::new(DispatchState::Idle as u8),
            },
            asyncs: HandleList::new(),
            idles: WatcherList::new(),
            prepares: WatcherList::new(),
            checks: WatcherList::new(),
        }
    }

    /// Runs the idle handles, then the prepare handles. `auto_tick` calls this before
    /// it polls. Returns true if an idle handle is started, so the poll must not block.
    pub(crate) fn before_poll(&self, vm: &VirtualMachine) -> bool {
        if self.idles.is_empty() && self.prepares.is_empty() {
            return false;
        }
        if !vm.script_allowed() {
            return false;
        }
        self.idles.walk(vm);
        self.prepares.walk(vm);
        !self.idles.is_empty()
    }

    /// Runs the check handles. `auto_tick` calls this after it polls.
    pub(crate) fn after_poll(&self, vm: &VirtualMachine) {
        if !self.checks.is_empty() && vm.script_allowed() {
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
    /// `VirtualMachine::drop`, which clears the field before freeing the state.
    ///
    /// # Safety
    /// `vm` hasn't been freed (the main thread's VM never is). Any thread can call
    /// this because `runtime_state` doesn't change between those two writes, and an
    /// addon stops its threads in its cleanup hooks, which run before the second write.
    pub(crate) unsafe fn of_vm(vm: *const VirtualMachine) -> *mut UvLoop {
        // SAFETY: fn contract.
        let state = unsafe { (*vm).runtime_state.get() }.cast::<RuntimeState>();
        if state.is_null() {
            return core::ptr::null_mut();
        }
        // SAFETY: `runtime_state` is `vm`'s boxed `RuntimeState`, and `&raw mut`
        // doesn't create a reference.
        unsafe { &raw mut (*state).uv_loop }
    }

    /// Runs the task that `schedule_dispatch` posted.
    pub(crate) fn dispatch(&self, vm: &VirtualMachine) {
        self.shared
            .dispatch_state
            .store(DispatchState::Running as u8, Ordering::SeqCst);
        // Don't run callbacks once the VM is stopping. Threadsafe functions do the same.
        if vm.script_allowed() {
            self.run_pass(vm.global());
        }
        // A send during the pass sets `Pending` instead of posting a task, and this
        // then fails. The next pass is a new task, so a thread that keeps sending
        // can't hold the event loop back from its timers and sockets.
        if self
            .shared
            .dispatch_state
            .compare_exchange(
                DispatchState::Running as u8,
                DispatchState::Idle as u8,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_err()
        {
            self.shared.post_dispatch();
        }
    }

    /// Calls `async_cb` for every handle that was sent, like libuv's `uv__async_io`.
    fn run_pass(&self, global: &JSGlobalObject) {
        self.asyncs.begin_walk();
        // SAFETY: nothing ticks the event loop before the callback, which gets the handle.
        while let Some(async_) = unsafe { self.asyncs.walk_next() } {
            if async_.body.pending.swap(0, Ordering::SeqCst) == 0 {
                continue;
            }
            bun_output::scoped_log!(uv, "uv_async_t {:?}: async_cb", async_.ptr);
            if let Some(async_cb) = async_.body.async_cb {
                let _handles = CallbackScope::open(global);
                // SAFETY: calls the addon's callback on the loop thread with the
                // handle it initialized.
                unsafe { async_cb(async_.into_raw()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        self.asyncs.end_walk();
    }
}

/// `schedule_dispatch` posts a null pointer: the task is for the loop of the VM that gets it.
impl Taskable for UvLoop {
    const TAG: TaskTag = task_tag::UvLoopDispatch;
    /// Drops the pending sends like a closed libuv loop does.
    unsafe fn release_unrun(_: *mut Self) {
        runtime_state()
            .uv_loop
            .shared
            .dispatch_state
            .store(DispatchState::Idle as u8, Ordering::SeqCst);
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
pub(crate) struct UvHandle<T = ()> {
    data: *mut c_void,
    fields: HandleFields<T>,
}

/// What Bun initializes of a handle. `data` belongs to the addon.
#[repr(C)]
pub(crate) struct HandleFields<T> {
    loop_: NonNull<UvLoop>,
    type_: c_uint,
    close_cb: Cell<Option<UvCloseCb>>,
    /// `ref_state` and `reserved` replace `handle_queue`, `u` and `next_closing`.
    ref_state: RefState,
    reserved: [*mut c_void; 6],
    flags: Cell<c_uint>,
    /// The fields of the handle's type.
    body: T,
}

const _: () = assert!(core::mem::offset_of!(UvHandle, data) == 0);
const _: () = assert!(core::mem::offset_of!(UvHandle, fields.loop_) == 8);
const _: () = assert!(core::mem::offset_of!(UvHandle, fields.type_) == 16);
const _: () = assert!(core::mem::offset_of!(UvHandle, fields.close_cb) == 24);
const _: () = assert!(core::mem::offset_of!(UvHandle, fields.flags) == 88);
const _: () = assert!(core::mem::size_of::<UvHandle>() == 96);

/// An initialized handle that the addon lends to its loop's thread. Its callbacks get the pointer it passed.
#[repr(transparent)]
pub(crate) struct HandleRef<'a, T = ()> {
    ptr: NonNull<UvHandle<T>>,
    _marker: PhantomData<&'a HandleFields<T>>,
}

enum AnyHandle<'a> {
    Async(HandleRef<'a, AsyncFields>),
    Timer(HandleRef<'a, TimerFields>),
    Watcher(HandleRef<'a, WatcherFields>),
}

impl<T> HandleRef<'_, T> {
    /// # Safety
    /// `ptr` was initialized as a `T`, and this is its loop's thread. While the result
    /// lives the loop is alive and `close_cb` does not run.
    unsafe fn new(ptr: NonNull<UvHandle<T>>) -> Self {
        HandleRef {
            ptr,
            _marker: PhantomData,
        }
    }

    /// Same as libuv's `uv__handle_init`.
    ///
    /// # Safety
    /// `ptr` points to memory for a handle of type `type_`, whose body is a `T`. The addon
    /// keeps it alive until its `close_cb` has run. `loop_` is this thread's loop.
    unsafe fn init(
        ptr: NonNull<UvHandle<T>>,
        loop_: NonNull<UvLoop>,
        type_: c_uint,
        body: T,
    ) -> Self {
        let fields = HandleFields {
            loop_,
            type_,
            close_cb: Cell::new(None),
            ref_state: RefState::new(),
            reserved: [core::ptr::null_mut(); 6],
            flags: Cell::new(0),
            body,
        };
        // SAFETY: fn contract.
        unsafe {
            (&raw mut (*ptr.as_ptr()).fields).write(fields);
            HandleRef::new(ptr)
        }
    }

    fn uv_loop(&self) -> &UvLoop {
        // SAFETY: `new`'s contract. Other threads use only `shared`.
        unsafe { self.loop_.as_ref() }
    }

    /// For a callback of the addon's, after which the handle can be gone.
    fn into_raw(self) -> *mut UvHandle<T> {
        self.ptr.as_ptr()
    }
}

impl<T> core::ops::Deref for HandleRef<'_, T> {
    type Target = HandleFields<T>;
    fn deref(&self) -> &HandleFields<T> {
        // SAFETY: `new`'s contract. Other threads write only `data` and the atomics of `AsyncFields`.
        unsafe { &(*self.ptr.as_ptr()).fields }
    }
}

impl HandleRef<'_> {
    /// Returns `None` if Bun doesn't implement the handle's type.
    fn downcast(&self) -> Option<AnyHandle<'_>> {
        // Not `self.type_`: an unsupported handle is not a valid `HandleFields`.
        // SAFETY: `init` wrote `type` together with the body.
        unsafe {
            Some(match (*self.ptr.as_ptr()).fields.type_ {
                UV_ASYNC => AnyHandle::Async(HandleRef::new(self.ptr.cast())),
                UV_TIMER => AnyHandle::Timer(HandleRef::new(self.ptr.cast())),
                UV_IDLE | UV_PREPARE | UV_CHECK => {
                    AnyHandle::Watcher(HandleRef::new(self.ptr.cast()))
                }
                _ => return None,
            })
        }
    }

    /// Crashes like `function`'s stub if Bun doesn't implement the handle's type.
    fn downcast_or_crash(&self, function: &'static [u8]) -> AnyHandle<'_> {
        self.downcast().unwrap_or_else(|| unsupported(function))
    }

    /// libuv asserts on the wrong type, but the entry points return `UV_EINVAL`.
    fn as_watcher(&self, type_: c_uint) -> Option<HandleRef<'_, WatcherFields>> {
        match self.downcast() {
            Some(AnyHandle::Watcher(watcher)) if watcher.type_ == type_ => Some(watcher),
            _ => None,
        }
    }

    fn as_timer(&self) -> Option<HandleRef<'_, TimerFields>> {
        match self.downcast() {
            Some(AnyHandle::Timer(timer)) => Some(timer),
            _ => None,
        }
    }
}

impl<T> HandleFields<T> {
    fn is_closing(&self) -> bool {
        self.flags.get() & UV_HANDLE_CLOSING != 0
    }
}

/// Matches `struct uv_async_s`. Active from init until close.
type UvAsync = UvHandle<AsyncFields>;

/// Replaces `UV_ASYNC_PRIVATE_FIELDS`.
#[repr(C)]
pub(crate) struct AsyncFields {
    async_cb: Option<UvAsyncCb>,
    /// Number of senders past their first `pending` check, like libuv's busy counter.
    /// `uv_close` waits for it to reach 0.
    busy: AtomicI32,
    /// A send sets it, the dispatch pass clears it, and `uv_close` sets it permanently.
    pending: AtomicI32,
}

const _: () = assert!(core::mem::offset_of!(UvAsync, fields.body.async_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvAsync>() <= UV_ASYNC_T_SIZE);

impl AsyncFields {
    /// Called by `uv_close`, like libuv's `uv__async_spin`. Makes later sends return
    /// at their first check and waits for the senders already past it, so `close_cb`
    /// can free the handle afterwards.
    fn stop_sends(&self) {
        self.pending.store(1, Ordering::SeqCst);
        let mut spins = 0u32;
        while self.busy.load(Ordering::SeqCst) != 0 {
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
/// Same as [`HandleRef::init`], unless a pointer is null. `async_cb` takes the handle.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_init(
    loop_: *mut UvLoop,
    handle: *mut UvAsync,
    async_cb: Option<UvAsyncCb>,
) -> c_int {
    let (Some(loop_), Some(handle)) = (NonNull::new(loop_), NonNull::new(handle)) else {
        return UV_EINVAL;
    };
    bun_output::scoped_log!(uv, "uv_async_t {:?}: uv_async_init", handle);
    let body = AsyncFields {
        async_cb,
        busy: AtomicI32::new(0),
        pending: AtomicI32::new(0),
    };
    // SAFETY: fn contract.
    let async_ = unsafe { HandleRef::init(handle, loop_, UV_ASYNC, body) };
    async_.ref_state.set_active(true);
    // SAFETY: `uv_close` removes it.
    unsafe { async_.uv_loop().asyncs.add(&async_) };
    0
}

/// Implements `int uv_async_send(uv_async_t*)`. Any thread can call this. Sends
/// before the next dispatch coalesce into one callback. After `uv_close` it returns
/// at the first check, like libuv's.
///
/// # Safety
/// `handle` was initialized by `uv_async_init`, its `close_cb` has not run, and its loop is alive.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_send(handle: *mut UvAsync) -> c_int {
    // SAFETY: fn contract. Nothing writes `loop` or `async_cb` after init.
    let (AsyncFields { pending, busy, .. }, loop_) =
        unsafe { (&(*handle).fields.body, (*handle).fields.loop_) };
    if pending.load(Ordering::SeqCst) != 0 {
        // Already scheduled, or closed.
        return 0;
    }
    let _ = busy.fetch_add(1, Ordering::SeqCst);
    if pending.swap(1, Ordering::SeqCst) == 0 {
        // SAFETY: fn contract.
        unsafe { &(*loop_.as_ptr()).shared }.schedule_dispatch();
    }
    let _ = busy.fetch_sub(1, Ordering::SeqCst);
    0
}

// ──────────────────────────────────────────────────────────────────────────
// uv_idle_t / uv_prepare_t / uv_check_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `struct uv_idle_s`, `uv_prepare_s` and `uv_check_s`, which have the same layout in uv.h.
type UvWatcher = UvHandle<WatcherFields>;

#[repr(C)]
pub(crate) struct WatcherFields {
    cb: Cell<Option<UvWatcherCb>>,
}

const _: () = assert!(core::mem::offset_of!(UvWatcher, fields.body.cb) == 96);
const _: () = assert!(core::mem::size_of::<UvWatcher>() <= UV_WATCHER_T_SIZE);

impl UvWatcher {
    /// Implements `uv_{idle,prepare,check}_init`. The handle starts stopped.
    ///
    /// # Safety
    /// Same as [`HandleRef::init`], unless a pointer is null.
    unsafe fn init(loop_: *mut UvLoop, handle: *mut UvWatcher, type_: c_uint) -> c_int {
        let (Some(loop_), Some(handle)) = (NonNull::new(loop_), NonNull::new(handle)) else {
            return UV_EINVAL;
        };
        bun_output::scoped_log!(uv, "uv_handle_t {:?}: init as type {}", handle, type_);
        let body = WatcherFields {
            cb: Cell::new(None),
        };
        // SAFETY: fn contract.
        unsafe { HandleRef::init(handle, loop_, type_, body) };
        0
    }
}

impl HandleRef<'_, WatcherFields> {
    /// Implements `uv_{idle,prepare,check}_start`. No-op on a started or closing
    /// handle, like in libuv. The callback isn't replaced.
    ///
    /// # Safety
    /// `cb` takes the handle.
    unsafe fn start(&self, cb: Option<UvWatcherCb>) -> c_int {
        if self.ref_state.active.get() || self.is_closing() {
            return 0;
        }
        if cb.is_none() {
            return UV_EINVAL;
        }
        self.body.cb.set(cb);
        // SAFETY: `uv_close` has not been called yet, and it stops the handle.
        unsafe { self.uv_loop().watchers(self.type_).started.add(self) };
        self.ref_state.set_active(true);
        0
    }

    /// Implements `uv_{idle,prepare,check}_stop`. `uv_close` calls it too.
    fn stop(&self) {
        if !self.ref_state.active.get() {
            return;
        }
        self.uv_loop().watchers(self.type_).started.remove(self);
        self.ref_state.set_active(false);
    }
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

        /// See [`HandleRef::start`].
        ///
        /// # Safety
        /// Same as [`HandleRef::start`].
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $start(
            handle: HandleRef<'_>,
            cb: Option<UvWatcherCb>,
        ) -> c_int {
            let Some(watcher) = handle.as_watcher($type_) else {
                return UV_EINVAL;
            };
            // SAFETY: fn contract.
            unsafe { watcher.start(cb) }
        }

        /// See [`HandleRef::stop`].
        #[unsafe(no_mangle)]
        pub(crate) extern "C" fn $stop(handle: HandleRef<'_>) -> c_int {
            let Some(watcher) = handle.as_watcher($type_) else {
                return UV_EINVAL;
            };
            watcher.stop();
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

/// Matches `struct uv_timer_s`.
type UvTimer = UvHandle<TimerFields>;

/// Replaces libuv's heap node and deadlines.
#[repr(C)]
pub(crate) struct TimerFields {
    timer_cb: Cell<Option<UvTimerCb>>,
    /// `Some` from init to close. An [`EventLoopTimer`] is too big for the handle.
    node: Cell<Option<AliasableBox<UvTimerNode>>>,
    repeat_ms: Cell<u64>,
}

const _: () = assert!(core::mem::offset_of!(UvTimer, fields.body.timer_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvTimer>() <= UV_TIMER_T_SIZE);

/// Links a `uv_timer_t` into the timer heap. `dispatch.rs` recovers it from
/// `event_loop_timer` when the timer fires.
pub(crate) struct UvTimerNode {
    pub(crate) event_loop_timer: EventLoopTimer,
    timer: NonNull<UvTimer>,
}

impl UvTimerNode {
    /// Called after the heap pops the timer. Like libuv's `uv__run_timers`, it stops
    /// the timer and re-arms a repeating one before it calls the callback, so the
    /// callback can stop or close the handle.
    ///
    /// # Safety
    /// `this` is a started timer's node, and this is the loop thread.
    pub(crate) unsafe fn on_fire(this: *mut UvTimerNode, vm: &VirtualMachine) -> JsResult<()> {
        // SAFETY: fn contract. A started timer is initialized and not closed.
        let timer = unsafe {
            // `FIRED` tells `update`/`remove` that the node isn't in the heap.
            (*this)
                .event_loop_timer
                .state
                .set(EventLoopTimerState::FIRED);
            HandleRef::new((*this).timer)
        };
        timer.ref_state.set_active(false);
        let repeat_ms = timer.body.repeat_ms.get();
        if repeat_ms != 0 {
            timer.arm(repeat_ms);
        }
        bun_output::scoped_log!(uv, "uv_timer_t {:?}: timer_cb", timer.ptr);
        if let Some(cb) = timer.body.timer_cb.get() {
            let _scope = vm.enter_event_loop_scope();
            let _handles = CallbackScope::open(vm.global());
            // SAFETY: calls the addon's callback on the loop thread with its handle.
            unsafe { cb(timer.into_raw()) };
        }
        if vm.global().has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

impl HandleRef<'_, TimerFields> {
    /// Schedules the timer to fire `timeout_ms` from now and marks it started.
    fn arm(&self, timeout_ms: u64) {
        self.body.node.with_taken(|node| {
            let Some(node) = node else {
                // Closed.
                return;
            };
            let due = Timespec::ms_from_now(
                TimespecMockMode::ForceRealTime,
                i64::try_from(timeout_ms).unwrap_or(i64::MAX),
            );
            timer_all().update(&raw const node.event_loop_timer, &due);
            self.ref_state.set_active(true);
        });
    }

    /// Implements `uv_timer_stop`. Checks the node's state before removing it from the
    /// heap because a fired node is already out, and VM teardown unlinks timers
    /// without telling their owners.
    fn stop(&self) {
        if !self.ref_state.active.get() {
            return;
        }
        self.body.node.with_taken(|node| {
            if let Some(node) = node {
                node.event_loop_timer.disarm();
            }
        });
        self.ref_state.set_active(false);
    }

    /// Called by `uv_close`. Frees the node here because a stopping VM refuses the close task.
    fn close(&self) {
        self.stop();
        self.body.node.set(None);
    }
}

/// Implements `int uv_timer_init(uv_loop_t*, uv_timer_t*)`.
///
/// # Safety
/// Same as [`HandleRef::init`], unless a pointer is null.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_init(loop_: *mut UvLoop, handle: *mut UvTimer) -> c_int {
    let (Some(loop_), Some(handle)) = (NonNull::new(loop_), NonNull::new(handle)) else {
        return UV_EINVAL;
    };
    bun_output::scoped_log!(uv, "uv_timer_t {:?}: uv_timer_init", handle);
    let body = TimerFields {
        timer_cb: Cell::new(None),
        node: Cell::new(Some(AliasableBox::new(UvTimerNode {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::UvTimer),
            timer: handle,
        }))),
        repeat_ms: Cell::new(0),
    };
    // SAFETY: fn contract.
    unsafe { HandleRef::init(handle, loop_, UV_TIMER, body) };
    0
}

/// Implements `int uv_timer_start(uv_timer_t*, uv_timer_cb, uint64_t timeout,
/// uint64_t repeat)`. Restarts a timer that's already started.
///
/// # Safety
/// `cb` takes the handle.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_start(
    handle: HandleRef<'_>,
    cb: Option<UvTimerCb>,
    timeout_ms: u64,
    repeat_ms: u64,
) -> c_int {
    let Some(timer) = handle.as_timer() else {
        return UV_EINVAL;
    };
    if cb.is_none() || timer.is_closing() {
        return UV_EINVAL;
    }
    timer.body.timer_cb.set(cb);
    timer.body.repeat_ms.set(repeat_ms);
    timer.arm(timeout_ms);
    0
}

/// Implements `int uv_timer_stop(uv_timer_t*)`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_timer_stop(handle: HandleRef<'_>) -> c_int {
    let Some(timer) = handle.as_timer() else {
        return UV_EINVAL;
    };
    timer.stop();
    0
}

/// Implements `int uv_timer_again(uv_timer_t*)`. Restarts a repeating timer. Returns
/// `UV_EINVAL` if the timer was never started.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_timer_again(handle: HandleRef<'_>) -> c_int {
    let Some(timer) = handle.as_timer() else {
        return UV_EINVAL;
    };
    if timer.body.timer_cb.get().is_none() {
        return UV_EINVAL;
    }
    let repeat_ms = timer.body.repeat_ms.get();
    if repeat_ms != 0 {
        timer.arm(repeat_ms);
    }
    0
}

/// Implements `void uv_timer_set_repeat(uv_timer_t*, uint64_t)`. The new value
/// applies from the next fire or `uv_timer_again`, like in libuv.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_timer_set_repeat(handle: HandleRef<'_>, repeat_ms: u64) {
    if let Some(timer) = handle.as_timer() {
        timer.body.repeat_ms.set(repeat_ms);
    }
}

/// Implements `uint64_t uv_timer_get_repeat(const uv_timer_t*)`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_timer_get_repeat(handle: HandleRef<'_>) -> u64 {
    handle
        .as_timer()
        .map_or(0, |timer| timer.body.repeat_ms.get())
}

/// Implements `uint64_t uv_timer_get_due_in(const uv_timer_t*)`. Returns 0 if the
/// timer is due or not started.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_timer_get_due_in(handle: HandleRef<'_>) -> u64 {
    let Some(timer) = handle.as_timer() else {
        return 0;
    };
    if !timer.ref_state.active.get() {
        return 0;
    }
    let Some(due) = timer
        .body
        .node
        .with_taken(|node| node.as_ref().map(|node| node.event_loop_timer.next.get()))
    else {
        return 0;
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

/// `uv_close` posts the handle as a task.
impl Taskable for UvHandle {
    const TAG: TaskTag = task_tag::UvHandleClose;
    /// Still runs `close_cb` because that's where the addon frees the handle. Any JS
    /// it tries to run is refused.
    unsafe fn release_unrun(this: *mut Self) {
        // On `Err` the exception is still pending, and the release dispatcher handles it.
        // SAFETY: fn contract.
        let _ = unsafe { UvHandle::run_close(this, VirtualMachine::get().global()) };
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
    pub(crate) unsafe fn run_close(handle: *mut UvHandle, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: fn contract.
        let handle = unsafe { HandleRef::new(NonNull::new_unchecked(handle)) };
        bun_output::scoped_log!(uv, "uv_handle_t {:?}: close_cb", handle.ptr);
        if let Some(close_cb) = handle.close_cb.get() {
            let _handles = CallbackScope::open(global);
            // SAFETY: calls the addon's callback on the loop thread with its handle.
            unsafe { close_cb(handle.into_raw()) };
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
/// `close_cb` takes the handle.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_close(handle: HandleRef<'_>, close_cb: Option<UvCloseCb>) {
    let any = handle.downcast_or_crash(b"uv_close");
    if handle.is_closing() {
        return;
    }
    handle.flags.update(|flags| flags | UV_HANDLE_CLOSING);
    handle.close_cb.set(close_cb);
    let uv_loop = handle.uv_loop();
    bun_output::scoped_log!(uv, "uv_handle_t {:?}: uv_close", handle.ptr);
    match any {
        AnyHandle::Async(async_) => {
            async_.body.stop_sends();
            uv_loop.asyncs.remove(&async_);
            async_.ref_state.set_active(false);
        }
        AnyHandle::Timer(timer) => timer.close(),
        AnyHandle::Watcher(watcher) => watcher.stop(),
    }
    // The queued task keeps the loop alive until `close_cb` has run, like libuv's
    // closing list. If the VM is gone, the task is refused and `close_cb` never runs.
    let task = ConcurrentTask::create_from(handle.ptr.as_ptr());
    let _ = uv_loop.shared.handle.post(LoopKind::Regular, task);
}

/// Implements `void uv_ref(uv_handle_t*)`. Idempotent. Only matters while the handle
/// is active.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_ref(handle: HandleRef<'_>) {
    handle.downcast_or_crash(b"uv_ref");
    handle.ref_state.set_referenced(true);
}

/// Implements `void uv_unref(uv_handle_t*)`. Idempotent.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_unref(handle: HandleRef<'_>) {
    handle.downcast_or_crash(b"uv_unref");
    handle.ref_state.set_referenced(false);
}

/// Implements `int uv_has_ref(const uv_handle_t*)`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_has_ref(handle: HandleRef<'_>) -> c_int {
    handle.downcast_or_crash(b"uv_has_ref");
    c_int::from(handle.ref_state.referenced.get())
}

/// Implements `int uv_is_active(const uv_handle_t*)`. A watcher or timer is active
/// while it's started. An async handle is active until it's closed because libuv
/// starts it in init.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_is_active(handle: HandleRef<'_>) -> c_int {
    handle.downcast_or_crash(b"uv_is_active");
    c_int::from(handle.ref_state.active.get())
}

/// Implements `int uv_is_closing(const uv_handle_t*)`. Returns true once `uv_close`
/// has been called.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_is_closing(handle: HandleRef<'_>) -> c_int {
    handle.downcast_or_crash(b"uv_is_closing");
    c_int::from(handle.is_closing())
}

// ──────────────────────────────────────────────────────────────────────────
// uv_req_t / uv_work_t
// ──────────────────────────────────────────────────────────────────────────

/// Matches `UV_REQ_FIELDS` (uv.h), which every request starts with. Addons read
/// `data` and `type`.
#[repr(C)]
pub(crate) struct UvReq<T = ()> {
    data: *mut c_void,
    fields: ReqFields<T>,
}

/// What Bun initializes of a request. `data` belongs to the addon.
#[repr(C)]
struct ReqFields<T> {
    type_: c_uint,
    reserved: [*mut c_void; 6],
    body: T,
}

const _: () = assert!(core::mem::offset_of!(UvReq, data) == 0);
const _: () = assert!(core::mem::offset_of!(UvReq, fields.type_) == 8);
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

/// Matches `struct uv_work_s`.
pub(crate) type UvWork = UvReq<WorkFields>;

/// Addons also read the first three fields. `state` replaces libuv's `struct uv__work`.
#[repr(C)]
pub(crate) struct WorkFields {
    loop_: NonNull<UvLoop>,
    work_cb: Option<UvWorkCb>,
    after_work_cb: Option<UvAfterWorkCb>,
    /// A [`WorkState`]. The pool thread and `uv_cancel` race to change it from `Queued`.
    state: AtomicU32,
}

const _: () = assert!(core::mem::offset_of!(UvWork, fields.body.loop_) == 64);
const _: () = assert!(core::mem::offset_of!(UvWork, fields.body.work_cb) == 72);
const _: () = assert!(core::mem::offset_of!(UvWork, fields.body.after_work_cb) == 80);
const _: () = assert!(core::mem::size_of::<UvWork>() <= UV_WORK_T_SIZE);

/// The request that `uv_queue_work` queued, which the addon keeps alive until `after_work_cb` has run.
struct WorkRef(NonNull<UvWork>);

// SAFETY: libuv's contract lets a pool thread have the request for `work_cb`.
unsafe impl Send for WorkRef {}

impl WorkRef {
    fn work(&self) -> &WorkFields {
        // SAFETY: `complete` gives up `self` to call `after_work_cb`. Until then only `state` changes.
        unsafe { &(*self.0.as_ptr()).fields.body }
    }

    fn run(&self) {
        let started = self
            .work()
            .state
            .compare_exchange(
                WorkState::Queued as u32,
                WorkState::Running as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok();
        if started && let Some(work_cb) = self.work().work_cb {
            // SAFETY: calls the addon's callback on a pool thread, as libuv documents.
            unsafe { work_cb(self.0.as_ptr()) };
        }
    }

    fn complete(self, global: &JSGlobalObject) -> JsResult<()> {
        let status = if self.work().state.load(Ordering::SeqCst) == WorkState::Cancelled as u32 {
            UV_ECANCELED
        } else {
            0
        };
        let (after_work_cb, req) = (self.work().after_work_cb, self.0.as_ptr());
        bun_output::scoped_log!(uv, "uv_work_t {:?}: after_work_cb({})", req, status);
        // The callback usually frees the request.
        if let Some(after_work_cb) = after_work_cb {
            let _handles = CallbackScope::open(global);
            // SAFETY: calls the addon's callback on the JS thread that queued the request, or else on the loop's.
            unsafe { after_work_cb(req, status) };
        }
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }

    /// For a thread without a VM, which cannot make a [`Job`].
    fn schedule_for(self, vm: &VmHandle) -> c_int {
        let Some(ticket) = vm.try_ticket(LoopKind::Regular) else {
            return UV_ECANCELED;
        };
        vm.add_keep_alive(LoopKind::Regular, 1);
        bun_core::handle_oom(WorkPool::go((self, ticket), |(req, ticket)| {
            req.run();
            ticket.post(ConcurrentTask::create_from(req.0.as_ptr()));
        }));
        0
    }
}

/// [`WorkRef::schedule_for`] posts the request as a task.
impl Taskable for UvWork {
    const TAG: TaskTag = task_tag::UvWorkDone;
    /// Calls nothing, like [`UvWorkJob`].
    unsafe fn release_unrun(_: *mut Self) {
        VirtualMachine::get().event_loop().unref_keep_alive();
    }
    /// Not tied to one context, like [`UvLoop`]'s task.
    unsafe fn context(_: *const Self) -> ContextId {
        ContextId::NONE
    }
}

impl UvWork {
    /// # Safety
    /// [`WorkRef::schedule_for`] posted the task for `req` to `vm`.
    pub(crate) unsafe fn run_done(req: *mut UvWork, vm: &VirtualMachine) -> JsResult<()> {
        vm.event_loop().unref_keep_alive();
        if !vm.script_allowed() {
            return Ok(());
        }
        // SAFETY: fn contract.
        WorkRef(unsafe { NonNull::new_unchecked(req) }).complete(vm.global())
    }
}

/// Runs one `uv_queue_work` request as a [`Job`].
///
/// A stopping VM releases the job without calling `after_work_cb`, so the addon's
/// request leaks. Calling it isn't safe then. `work_cb` may never have run, and addons
/// that never call `uv_cancel` ignore the status. The V8 API would also still enter JS.
struct UvWorkJob;

impl JobContext for UvWorkJob {
    type OffThread = WorkRef;
    type Js = ();

    fn run(req: &mut WorkRef, done: Completion<Self>) -> Option<Completion<Self>> {
        req.run();
        Some(done)
    }

    fn then(req: WorkRef, _: (), cx: &JsThread<'_>) -> JsResult<()> {
        req.complete(cx.global())
    }
}

/// Implements `int uv_queue_work(uv_loop_t*, uv_work_t*, uv_work_cb, uv_after_work_cb)`.
/// The request keeps the process alive, like an active request in libuv. `UV_ECANCELED` once the VM takes no more work.
///
/// # Safety
/// `loop_` is null or one of this module's live loops. `req` points to `sizeof(uv_work_t)`
/// bytes that the addon keeps alive until its `after_work_cb` has run.
/// Both callbacks take `req`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_queue_work(
    loop_: *mut UvLoop,
    req: *mut UvWork,
    work_cb: Option<UvWorkCb>,
    after_work_cb: Option<UvAfterWorkCb>,
) -> c_int {
    let (Some(loop_), Some(req), Some(_)) = (
        NonNull::new(loop_),
        NonNull::new(req),
        work_cb, // libuv also returns UV_EINVAL
    ) else {
        return UV_EINVAL;
    };
    let vm = VirtualMachine::get_or_null();
    // A finalizer can call this during the GC that destroys the heap.
    if vm.is_some_and(VirtualMachine::closed) {
        return UV_ECANCELED;
    }
    bun_output::scoped_log!(uv, "uv_work_t {:?}: uv_queue_work", req);
    let fields = ReqFields {
        type_: UV_WORK,
        reserved: [core::ptr::null_mut(); 6],
        body: WorkFields {
            loop_,
            work_cb,
            after_work_cb,
            state: AtomicU32::new(WorkState::Queued as u32),
        },
    };
    // SAFETY: fn contract.
    unsafe { (&raw mut (*req.as_ptr()).fields).write(fields) };
    let Some(vm) = vm else {
        // SAFETY: fn contract.
        return WorkRef(req).schedule_for(unsafe { &(*loop_.as_ptr()).shared.handle });
    };
    Job::<UvWorkJob>::schedule(&vm.global().js_thread_of_caller(), WorkRef(req), ());
    0
}

/// Implements `int uv_cancel(uv_req_t*)`. Like in libuv, it runs on the thread of `after_work_cb`,
/// so it can't race it. Returns the same codes as libuv:
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
    if unsafe { (*req).fields.type_ } != UV_WORK {
        return UV_EINVAL;
    }
    // SAFETY: `type` says this is a `UvWork`.
    let state = unsafe { &(*req.cast::<UvWork>()).fields.body.state };
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
