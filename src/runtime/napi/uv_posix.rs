//! libuv's loop-backed API for N-API addons on posix: `uv_default_loop`, the
//! `uv_async_t`, `uv_idle_t`, `uv_prepare_t`, `uv_check_t` and `uv_timer_t`
//! handles, `uv_queue_work`, and the `uv_handle_t` functions. Every other
//! `uv_*` symbol is a crash stub (uv-posix-stubs.c) or a header-only polyfill
//! (uv-posix-polyfills.c). Bun has no libuv loop here, so these map onto the
//! VM's event loop and keep libuv's ABI and thread contract:
//!
//! - The addon allocates the handle or request and reads `data`, `loop` and
//!   `type` from it ([`UvHandle`], [`UvReq`]); the fields behind those are Bun's.
//! - Only `uv_async_send` may be called off the loop's JS thread. A handle is
//!   valid until its `close_cb` has run, a request until its `after_work_cb`.
//! - A `uv_loop_t*` is a [`UvLoop`], one per VM; only its `data` word is ABI.
//! - `uv_async_send` sets the handle's `pending` flag and posts at most one
//!   dispatch task per loop through the VM's [`VmHandle`] (libuv: the eventfd).
//!   The task walks the loop's handles on the JS thread (libuv: `uv__async_io`).
//! - `auto_tick` (jsc_hooks.rs) runs idle and prepare handles before its poll
//!   and check handles after it, and does not block while an idle handle is started.
//! - A timer is an [`EventLoopTimer`] in the VM's timer heap, in a heap-allocated
//!   [`UvTimerNode`] because it does not fit in the handle.
//! - `uv_queue_work` is a [`Job`]: `work_cb` on the pool, `after_work_cb` in
//!   its completion.
//! - A handle keeps the process alive while it is started and ref'd ([`RefState`]).

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicU8, AtomicU32, Ordering};

use bun_core::{Timespec, TimespecMockMode};
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
    /// The stubs' crash; keeps `name` by pointer, never returns.
    fn CrashHandler__unsupportedUVFunction(name: *const c_char);
}

#[cold]
fn unsupported(function: &'static CStr) -> ! {
    // SAFETY: `function` is a static NUL-terminated string.
    unsafe { CrashHandler__unsupportedUVFunction(function.as_ptr()) };
    unreachable!("CrashHandler__unsupportedUVFunction returned");
}

// `UV_E*` on posix is `-errno` (uv/errno.h).
const UV_EINVAL: c_int = -libc::EINVAL;
const UV_EBUSY: c_int = -libc::EBUSY;
const UV_ECANCELED: c_int = -libc::ECANCELED;

/// Positions in uv.h's `UV_HANDLE_TYPE_MAP` and `UV_REQ_TYPE_MAP`.
const UV_ASYNC: c_uint = 1;
const UV_CHECK: c_uint = 2;
const UV_IDLE: c_uint = 6;
const UV_PREPARE: c_uint = 9;
const UV_TIMER: c_uint = 13;
const UV_WORK: c_uint = 7;

/// libuv's own `flags` values for these two states (src/uv-common.h).
const UV_HANDLE_CLOSING: c_uint = 0x01;
const UV_HANDLE_CLOSED: c_uint = 0x02;

/// `sizeof` on 64-bit unix; the addon allocates these, so Bun's fields must fit.
const UV_ASYNC_T_SIZE: usize = 128;
const UV_WATCHER_T_SIZE: usize = 120;
const UV_TIMER_T_SIZE: usize = 152;
const UV_WORK_T_SIZE: usize = 128;

type UvAsyncCb = unsafe extern "C" fn(*mut UvAsync);
/// `uv_idle_cb`, `uv_prepare_cb` and `uv_check_cb` have this one shape.
type UvWatcherCb = unsafe extern "C" fn(*mut UvWatcher);
type UvTimerCb = unsafe extern "C" fn(*mut UvTimer);
type UvCloseCb = unsafe extern "C" fn(*mut UvHandle);
type UvWorkCb = unsafe extern "C" fn(*mut UvWork);
type UvAfterWorkCb = unsafe extern "C" fn(*mut UvWork, c_int);

/// libuv's rule: a handle keeps the loop alive while it is both started
/// (`uv_is_active`) and ref'd (`uv_has_ref`, the default). Loop thread.
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
    /// A dispatch task is queued, or the running one will go around again.
    Pending = 1,
    /// The dispatch task is walking the handles.
    Running = 2,
}

/// What a `uv_loop_t*` points at. Lives in the VM's `RuntimeState`, so exactly
/// as long as the VM does ([`Self::of_vm`]).
#[repr(C)]
pub(crate) struct UvLoop {
    /// `uv_loop_t.data`: the addon's, read and written by it (offset 0 as in uv.h).
    data: Cell<*mut c_void>,
    vm: NonNull<VirtualMachine>,
    /// How `uv_async_send` reaches the JS thread from any thread.
    handle: VmHandle,
    dispatch_state: AtomicU8,
    /// The initialised, not yet closed async handles. JS thread.
    asyncs: JsCell<Vec<NonNull<UvAsync>>>,
    /// The handles the running dispatch pass has not visited yet, last first.
    /// `uv_close` removes from both lists. JS thread.
    dispatching: JsCell<Vec<NonNull<UvAsync>>>,
    idles: WatcherList,
    prepares: WatcherList,
    checks: WatcherList,
}

const _: () = assert!(core::mem::offset_of!(UvLoop, data) == 0);

/// The started handles of one watcher kind, in start order (libuv's
/// `uv__run_idle` and friends). JS thread.
struct WatcherList {
    started: JsCell<Vec<NonNull<UvWatcher>>>,
    /// The handles the running walk has not reached yet, last first; each goes
    /// back into `started` before its callback, so a stop from a callback finds it.
    walking: JsCell<Vec<NonNull<UvWatcher>>>,
    /// Set while a walk is on the stack; a nested loop run skips its own.
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
            // SAFETY: a started handle is initialised and not closed (`uv_close`
            // stops it first), and the addon keeps it alive until then.
            let Some(cb) = (unsafe { (*watcher.as_ptr()).cb }) else {
                continue;
            };
            {
                let _scope = vm.enter_event_loop_scope();
                // SAFETY: the addon's callback, on the loop thread, with a handle
                // it started.
                unsafe { cb(watcher.as_ptr()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        // Left over only by a termination.
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
    /// JS thread, from `init_runtime_state`. `handle` is `vm`'s [`VmHandle`].
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

    /// From `auto_tick`, before the poll: runs idle then prepare handles. True
    /// when an idle handle is started, which keeps the poll from blocking.
    pub(crate) fn before_poll(&self) -> bool {
        if self.idles.is_empty() && self.prepares.is_empty() {
            return false;
        }
        // SAFETY: the VM owns the `RuntimeState` this loop lives in; JS thread.
        let vm = unsafe { self.vm.as_ref() };
        if !vm.script_allowed() {
            return false;
        }
        self.idles.walk(vm);
        self.prepares.walk(vm);
        !self.idles.is_empty()
    }

    /// From `auto_tick`, after the poll: runs the check handles.
    pub(crate) fn after_poll(&self) {
        if self.checks.is_empty() {
            return;
        }
        // SAFETY: as in `before_poll`.
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

    /// Null before `init_runtime_state` and after `VirtualMachine::destroy`, which
    /// clears the field before it frees the state.
    ///
    /// # Safety
    /// `vm`'s allocation is still there (the main thread's always is). Any thread:
    /// between those two writes `runtime_state` is constant, and an addon's
    /// cleanup hooks, where it stops its threads, run before the second one.
    pub(crate) unsafe fn of_vm(vm: *const VirtualMachine) -> *mut UvLoop {
        // SAFETY: fn contract.
        let state = unsafe { (*vm).runtime_state }.cast::<RuntimeState>();
        if state.is_null() {
            return core::ptr::null_mut();
        }
        // SAFETY: `runtime_state` is the boxed `RuntimeState` of `vm`;
        // projecting to a field forms no reference.
        unsafe { &raw mut (*state).uv_loop }
    }

    /// JS thread only.
    fn js_thread(&self) -> JsThread<'static> {
        // SAFETY: the VM owns the `RuntimeState` this loop is embedded in, so it
        // is alive; `global()` is the JS-thread accessor every host function uses.
        unsafe { self.vm.as_ref() }.global().js_thread()
    }

    /// Any thread. One queued task however many handles are sent; the state
    /// machine is `ThreadSafeFunction::schedule_dispatch`'s.
    fn schedule_dispatch(&self) {
        let prev = self
            .dispatch_state
            .swap(DispatchState::Pending as u8, Ordering::SeqCst);
        if prev != DispatchState::Idle as u8 {
            // Queued already, or the running pass will go around again.
            return;
        }
        let this: *const UvLoop = self;
        let task = ConcurrentTask::from_callback(this.cast_mut(), UvLoop::dispatch);
        if let Posted::Refused(task) = self.handle.post(LoopKind::Regular, task) {
            // The VM is gone: the callback is lost, as with a closed libuv loop.
            // SAFETY: refused ⇒ the task was never queued and is ours to free.
            unsafe { ConcurrentTask::release_refused(task) };
            self.dispatch_state
                .store(DispatchState::Idle as u8, Ordering::SeqCst);
        }
    }

    /// JS thread, the task `schedule_dispatch` posted.
    fn dispatch(this: *mut UvLoop) -> JsResult<()> {
        // SAFETY: the task was dispatched by this loop's VM, which owns the
        // `RuntimeState` the loop is embedded in, so `this` is live. Other
        // threads only touch `dispatch_state` and `handle` through their own
        // shared references, which this one may coexist with.
        let this = unsafe { &*this };
        let global = this.js_thread().global();
        loop {
            this.dispatch_state
                .store(DispatchState::Running as u8, Ordering::SeqCst);
            // A stopping VM takes no more callbacks (threadsafe functions agree).
            if global.bun_vm().script_allowed() {
                this.run_pass(global);
            }
            // A send during the pass set `Pending` instead of posting a task;
            // then this fails and the next pass picks its handle up.
            if this
                .dispatch_state
                .compare_exchange(
                    DispatchState::Running as u8,
                    DispatchState::Idle as u8,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_ok()
            {
                return Ok(());
            }
        }
    }

    /// libuv's `uv__async_io`: each handle goes back into the live list before
    /// its callback runs, so a `uv_close` from any callback finds it in one of
    /// the two lists. Handles initialised meanwhile are the next pass's.
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
            // SAFETY: a registered handle is initialised and not closed:
            // `uv_close` unregisters it before returning, and the addon keeps an
            // unclosed handle's memory alive (libuv's contract).
            if !unsafe { UvAsync::take_pending(async_) } {
                continue;
            }
            bun_output::scoped_log!(uv, "uv_async_t {:?}: async_cb", async_);
            // SAFETY: as above. `async_cb` is read before the call because the
            // callback may close and free the handle.
            if let Some(async_cb) = unsafe { (*async_.as_ptr()).async_cb } {
                // SAFETY: the addon's callback, on the loop thread, with the
                // handle it initialised.
                unsafe { async_cb(async_.as_ptr()) };
            }
            if global.has_exception()
                && bun_jsc::task::report_error_or_terminate(global, JsError::Thrown).is_err()
            {
                break;
            }
        }
        // Left over only by a termination.
        self.dispatching.with_mut(|todo| {
            if !todo.is_empty() {
                self.asyncs
                    .with_mut(|live| live.extend(todo.drain(..).rev()));
            }
        });
    }

    /// JS thread.
    fn register(&self, async_: NonNull<UvAsync>) {
        self.asyncs.with_mut(|live| live.push(async_));
    }

    /// JS thread. `retain`: a handle an addon initialised twice is in twice.
    fn unregister(&self, async_: NonNull<UvAsync>) {
        self.asyncs.with_mut(|live| live.retain(|h| *h != async_));
        self.dispatching
            .with_mut(|todo| todo.retain(|h| *h != async_));
    }
}

/// `uv_loop_t* uv_default_loop(void)`: the main thread's loop, from any thread,
/// also inside a Worker (as in Node; `napi_get_uv_event_loop` gives its own).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_default_loop() -> *mut UvLoop {
    let Some(vm) = VirtualMachine::get_main_thread_vm() else {
        return core::ptr::null_mut();
    };
    // SAFETY: the main thread's VM is never freed.
    unsafe { UvLoop::of_vm(vm) }
}

// ──────────────────────────────────────────────────────────────────────────
// uv_handle_t / uv_async_t
// ──────────────────────────────────────────────────────────────────────────

/// `UV_HANDLE_FIELDS` + `UV_HANDLE_PRIVATE_FIELDS` (uv.h, uv/unix.h): every
/// handle's prefix. Addons read `data`, `loop` and `type`; the rest is private.
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
    /// libuv's `uv__handle_init`; `data` is the addon's and is left alone.
    fn init(this: *mut UvHandle, loop_: *mut UvLoop, type_: c_uint) {
        // SAFETY: `this` is the addon's handle memory, on the loop thread;
        // field-wise writes because the memory is uninitialised.
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

/// `struct uv_async_s`: the prefix, then Bun's use of `UV_ASYNC_PRIVATE_FIELDS`.
#[repr(C)]
pub(crate) struct UvAsync {
    handle: UvHandle,
    async_cb: Option<UvAsyncCb>,
    /// Active from init until close.
    ref_state: RefState,
    /// libuv's busy counter: senders past their first check; `uv_close` waits it out.
    busy: AtomicI32,
    /// Set by a send, cleared by the dispatch pass, set for good by `uv_close`.
    pending: AtomicI32,
}

const _: () = assert!(core::mem::offset_of!(UvAsync, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvAsync, async_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvAsync>() <= UV_ASYNC_T_SIZE);

// SAFETY: nothing below forms a `&UvAsync` or `&mut UvAsync`: other threads may be
// in `uv_async_send` on the handle, which is fine for its atomics but not under a
// reference covering them. Fields are accessed through the raw pointer, one at a time.
impl UvAsync {
    /// The dispatch pass (libuv's `uv__async_io`): true if the handle was sent.
    ///
    /// # Safety
    /// `this` is an initialised, not yet closed handle.
    unsafe fn take_pending(this: NonNull<UvAsync>) -> bool {
        // SAFETY: fn contract.
        unsafe { &(*this.as_ptr()).pending }.swap(0, Ordering::SeqCst) != 0
    }

    /// `uv_close` (libuv's `uv__async_spin`): later sends return at their first
    /// check, and the senders past it (a flag exchange and a queue push away from
    /// done) are waited out, so afterwards `close_cb` may free the handle.
    ///
    /// # Safety
    /// As [`Self::take_pending`].
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

/// `int uv_async_init(uv_loop_t*, uv_async_t*, uv_async_cb)`. Loop thread. The
/// handle starts active and ref'd, as in libuv.
///
/// # Safety
/// `loop_` is null or one of this module's loops; `handle` is `sizeof(uv_async_t)`
/// bytes the addon keeps until its `close_cb` has run.
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
    // SAFETY: fn contract; field-wise writes into uninitialised addon memory.
    unsafe {
        (&raw mut (*handle).async_cb).write(async_cb);
        (&raw mut (*handle).ref_state).write(RefState::new());
        (&raw mut (*handle).busy).write(AtomicI32::new(0));
        (&raw mut (*handle).pending).write(AtomicI32::new(0));
        (*handle).ref_state.set_active(true);
    }
    // SAFETY: the loop is alive (fn contract); JS thread.
    unsafe { loop_ref.as_ref() }.register(async_);
    0
}

/// `int uv_async_send(uv_async_t*)`. Any thread; sends before the next dispatch
/// coalesce into it. After `uv_close` it returns at the first check, like libuv's.
///
/// # Safety
/// `handle` was initialised by `uv_async_init` and its `close_cb` has not run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_send(handle: *mut UvAsync) -> c_int {
    // SAFETY: fn contract. The loop thread may be in `uv_close` writing the plain
    // fields; these are the atomics and `loop`, which nothing writes after init.
    let (pending, busy, loop_) =
        unsafe { (&(*handle).pending, &(*handle).busy, (*handle).handle.loop_) };
    if pending.load(Ordering::SeqCst) != 0 {
        // Already scheduled, or closed.
        return 0;
    }
    let _ = busy.fetch_add(1, Ordering::SeqCst);
    if pending.swap(1, Ordering::SeqCst) == 0 {
        // SAFETY: the loop outlives the handle; `schedule_dispatch` is any-thread.
        unsafe { &*loop_ }.schedule_dispatch();
    }
    let _ = busy.fetch_sub(1, Ordering::SeqCst);
    0
}

// ──────────────────────────────────────────────────────────────────────────
// uv_idle_t / uv_prepare_t / uv_check_t
// ──────────────────────────────────────────────────────────────────────────

/// `struct uv_idle_s`, `uv_prepare_s` and `uv_check_s`, which uv.h declares
/// alike: the prefix, the callback, then Bun's state in libuv's queue links.
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
    /// `uv_{idle,prepare,check}_init`. Loop thread. The handle starts stopped.
    ///
    /// # Safety
    /// `loop_` is null or one of this module's loops; `handle` is `sizeof` bytes
    /// of its type that the addon keeps until its `close_cb` has run.
    unsafe fn init(loop_: *mut UvLoop, handle: *mut UvWatcher, type_: c_uint) -> c_int {
        if loop_.is_null() || handle.is_null() {
            return UV_EINVAL;
        }
        bun_output::scoped_log!(uv, "uv_handle_t {:?}: init as type {}", handle, type_);
        UvHandle::init(handle.cast::<UvHandle>(), loop_, type_);
        // SAFETY: fn contract; field-wise writes into uninitialised addon memory.
        unsafe {
            (&raw mut (*handle).cb).write(None);
            (&raw mut (*handle).ref_state).write(RefState::new());
        }
        0
    }

    /// `uv_{idle,prepare,check}_start`. Loop thread. A no-op on a started or
    /// closing handle, as in libuv (the callback is not replaced).
    ///
    /// # Safety
    /// `handle` was initialised by [`Self::init`].
    unsafe fn start(handle: *mut UvWatcher, cb: Option<UvWatcherCb>) -> c_int {
        // SAFETY: fn contract; loop thread. The loop outlives its handles.
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

    /// `uv_{idle,prepare,check}_stop`, also from `uv_close`. Loop thread.
    ///
    /// # Safety
    /// As [`Self::start`].
    unsafe fn stop(handle: *mut UvWatcher) {
        // SAFETY: fn contract; loop thread. The loop outlives its handles.
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

/// libuv asserts on a handle of the wrong type; the entry points answer `UV_EINVAL`.
///
/// # Safety
/// `handle` points at an initialised handle.
unsafe fn watcher_of_type(handle: *mut UvWatcher, type_: c_uint) -> bool {
    // SAFETY: fn contract.
    unsafe { (*handle).handle.type_ == type_ }
}

macro_rules! watcher_entry_points {
    ($type_:expr, $init:ident, $start:ident, $stop:ident) => {
        /// See [`UvWatcher::init`].
        ///
        /// # Safety
        /// As [`UvWatcher::init`].
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $init(loop_: *mut UvLoop, handle: *mut UvWatcher) -> c_int {
            // SAFETY: fn contract.
            unsafe { UvWatcher::init(loop_, handle, $type_) }
        }

        /// See [`UvWatcher::start`].
        ///
        /// # Safety
        /// `handle` was initialised by one of this module's `uv_*_init`.
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $start(
            handle: *mut UvWatcher,
            cb: Option<UvWatcherCb>,
        ) -> c_int {
            // SAFETY: fn contract.
            if !unsafe { watcher_of_type(handle, $type_) } {
                return UV_EINVAL;
            }
            // SAFETY: checked to be a watcher of this type.
            unsafe { UvWatcher::start(handle, cb) }
        }

        /// See [`UvWatcher::stop`].
        ///
        /// # Safety
        /// `handle` was initialised by one of this module's `uv_*_init`.
        #[unsafe(no_mangle)]
        pub(crate) unsafe extern "C" fn $stop(handle: *mut UvWatcher) -> c_int {
            // SAFETY: fn contract.
            if !unsafe { watcher_of_type(handle, $type_) } {
                return UV_EINVAL;
            }
            // SAFETY: checked to be a watcher of this type.
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

/// `struct uv_timer_s`: the prefix, the callback, then Bun's state in libuv's
/// heap node and deadlines. The [`EventLoopTimer`] does not fit, so the handle
/// owns a [`UvTimerNode`] from init to close.
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

/// The timer heap's view of a `uv_timer_t`; `dispatch.rs` recovers it from
/// `event_loop_timer` when the heap fires it.
pub(crate) struct UvTimerNode {
    pub(crate) event_loop_timer: EventLoopTimer,
    timer: *mut UvTimer,
}

impl UvTimerNode {
    /// The heap popped the timer. As libuv's `uv__run_timers`: stop it, re-arm a
    /// repeating one, then call back, so the callback may stop or close the handle.
    ///
    /// # Safety
    /// `this` is the node of a started timer; loop thread.
    pub(crate) unsafe fn on_fire(this: *mut UvTimerNode) -> JsResult<()> {
        // SAFETY: fn contract. `FIRED` tells `update`/`remove` the node is out
        // of the heap.
        let timer = unsafe {
            (*this).event_loop_timer.state = EventLoopTimerState::FIRED;
            (*this).timer
        };
        // SAFETY: a started timer is initialised and not closed; loop thread.
        let (cb, repeat_ms, loop_) = unsafe {
            (*timer).ref_state.set_active(false);
            ((*timer).timer_cb, (*timer).repeat_ms, (*timer).handle.loop_)
        };
        if repeat_ms != 0 {
            // SAFETY: as above; `cb` is set, the timer was started with it.
            unsafe { UvTimer::arm(timer, repeat_ms) };
        }
        bun_output::scoped_log!(uv, "uv_timer_t {:?}: timer_cb", timer);
        // SAFETY: the loop outlives its handles.
        let vm = unsafe { &*(*loop_).vm.as_ptr() };
        if let Some(cb) = cb {
            let _scope = vm.enter_event_loop_scope();
            // SAFETY: the addon's callback, on the loop thread, with its handle.
            unsafe { cb(timer) };
        }
        if vm.global().has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

impl UvTimer {
    /// Puts the timer into the heap `timeout_ms` from now and marks it started.
    ///
    /// # Safety
    /// `handle` is an initialised, not closed timer; loop thread.
    unsafe fn arm(handle: *mut UvTimer, timeout_ms: u64) {
        let due = Timespec::ms_from_now(
            TimespecMockMode::ForceRealTime,
            i64::try_from(timeout_ms).unwrap_or(i64::MAX),
        );
        // SAFETY: fn contract; a not closed timer still owns its node.
        unsafe {
            timer_all_mut().update(&raw mut (*(*handle).node).event_loop_timer, &due);
            (*handle).ref_state.set_active(true);
        }
    }

    /// `uv_timer_stop`. The node's own state says whether it is in the heap: a
    /// fired node is out, and the VM's teardown unlinks timers without telling
    /// their owners.
    ///
    /// # Safety
    /// As [`Self::arm`].
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

    /// From `uv_close`. The node is freed here, not in the close task (which a
    /// stopping VM refuses): nothing reads it once the closing flag is set.
    ///
    /// # Safety
    /// As [`Self::arm`], and `handle` is being closed for the first time.
    unsafe fn close(handle: *mut UvTimer) {
        // SAFETY: fn contract; `stop` took the node out of the heap, and `node`
        // is the `heap::alloc` of `uv_timer_init`.
        unsafe {
            UvTimer::stop(handle);
            bun_core::heap::destroy((*handle).node);
            (*handle).node = core::ptr::null_mut();
        }
    }

    /// # Safety
    /// `handle` points at an initialised handle.
    unsafe fn check(handle: *mut UvTimer) -> bool {
        // SAFETY: fn contract.
        unsafe { (*handle).handle.type_ == UV_TIMER }
    }
}

/// `int uv_timer_init(uv_loop_t*, uv_timer_t*)`. Loop thread.
///
/// # Safety
/// As [`UvWatcher::init`].
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
    // SAFETY: fn contract; field-wise writes into uninitialised addon memory.
    unsafe {
        (&raw mut (*handle).timer_cb).write(None);
        (&raw mut (*handle).node).write(node);
        (&raw mut (*handle).repeat_ms).write(0);
        (&raw mut (*handle).ref_state).write(RefState::new());
    }
    0
}

/// `int uv_timer_start(uv_timer_t*, uv_timer_cb, uint64_t timeout, uint64_t
/// repeat)`. Loop thread. A started timer is restarted.
///
/// # Safety
/// `handle` was initialised by one of this module's `uv_*_init`.
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
    // SAFETY: a timer; loop thread.
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

/// `int uv_timer_stop(uv_timer_t*)`. Loop thread.
///
/// # Safety
/// As [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_stop(handle: *mut UvTimer) -> c_int {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return UV_EINVAL;
    }
    // SAFETY: a timer; loop thread.
    unsafe { UvTimer::stop(handle) };
    0
}

/// `int uv_timer_again(uv_timer_t*)`. Loop thread. Restarts a repeating timer;
/// `UV_EINVAL` for one never started.
///
/// # Safety
/// As [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_again(handle: *mut UvTimer) -> c_int {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return UV_EINVAL;
    }
    // SAFETY: a timer; loop thread.
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

/// `void uv_timer_set_repeat(uv_timer_t*, uint64_t)`. Loop thread. Takes effect
/// at the next fire or `uv_timer_again`, as in libuv.
///
/// # Safety
/// As [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_set_repeat(handle: *mut UvTimer, repeat_ms: u64) {
    // SAFETY: fn contract.
    if unsafe { UvTimer::check(handle) } {
        // SAFETY: a timer; loop thread.
        unsafe { (*handle).repeat_ms = repeat_ms };
    }
}

/// `uint64_t uv_timer_get_repeat(const uv_timer_t*)`. Loop thread.
///
/// # Safety
/// As [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_get_repeat(handle: *mut UvTimer) -> u64 {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return 0;
    }
    // SAFETY: a timer; loop thread.
    unsafe { (*handle).repeat_ms }
}

/// `uint64_t uv_timer_get_due_in(const uv_timer_t*)`. Loop thread. 0 once due
/// or when not started.
///
/// # Safety
/// As [`uv_timer_start`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_timer_get_due_in(handle: *mut UvTimer) -> u64 {
    // SAFETY: fn contract.
    if !unsafe { UvTimer::check(handle) } {
        return 0;
    }
    // SAFETY: a timer; loop thread. A started timer is not closed, so it owns its node.
    let due = unsafe {
        if !(*handle).ref_state.active {
            return 0;
        }
        (*(*handle).node).event_loop_timer.next
    };
    let now = Timespec::now(TimespecMockMode::ForceRealTime);
    u64::try_from(due.ms().wrapping_sub(now.ms())).unwrap_or(0)
}

/// `uint64_t uv_now(const uv_loop_t*)`: the timer heap's clock in milliseconds,
/// read live where libuv caches it per iteration.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_now(_loop: *const UvLoop) -> u64 {
    u64::try_from(Timespec::now(TimespecMockMode::ForceRealTime).ms()).unwrap_or(0)
}

/// `void uv_update_time(uv_loop_t*)`: nothing to refresh, `uv_now` is live.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn uv_update_time(_loop: *mut UvLoop) {}

// ──────────────────────────────────────────────────────────────────────────
// uv_handle_t: the functions that take a handle of any type
// ──────────────────────────────────────────────────────────────────────────

/// A `type` no `uv_*_init` of this module writes is a handle type Bun does not
/// implement: crash the way `function`'s stub did.
///
/// # Safety
/// `handle` points at an initialised handle.
unsafe fn handle_type(handle: *mut UvHandle, function: &'static CStr) -> c_uint {
    // SAFETY: fn contract.
    match unsafe { (*handle).type_ } {
        type_ @ (UV_ASYNC | UV_IDLE | UV_PREPARE | UV_CHECK | UV_TIMER) => type_,
        _ => unsupported(function),
    }
}

/// The handle's [`RefState`], wherever its type keeps it.
///
/// # Safety
/// As [`handle_type`]; loop thread, and the returned pointer is used before
/// the addon is called back.
unsafe fn ref_state(handle: *mut UvHandle, function: &'static CStr) -> *mut RefState {
    // SAFETY: fn contract; `type` says which struct `handle` is the prefix of.
    unsafe {
        match handle_type(handle, function) {
            UV_ASYNC => &raw mut (*handle.cast::<UvAsync>()).ref_state,
            UV_TIMER => &raw mut (*handle.cast::<UvTimer>()).ref_state,
            _ => &raw mut (*handle.cast::<UvWatcher>()).ref_state,
        }
    }
}

/// The task `uv_close` posted: `close_cb`, one turn later. The callback usually
/// frees the handle, so nothing reads it afterwards.
fn run_close(handle: *mut UvHandle) -> JsResult<()> {
    // SAFETY: `uv_close` posted this for a handle the addon keeps alive until
    // `close_cb` has run; loop thread.
    let (close_cb, loop_) = unsafe {
        (*handle).flags |= UV_HANDLE_CLOSED;
        ((*handle).close_cb, (*handle).loop_)
    };
    bun_output::scoped_log!(uv, "uv_handle_t {:?}: close_cb", handle);
    if let Some(close_cb) = close_cb {
        // SAFETY: the addon's callback, on the loop thread, with its handle.
        unsafe { close_cb(handle) };
    }
    // SAFETY: the loop outlives its handles (it is the VM's).
    let global = unsafe { &*loop_ }.js_thread().global();
    if global.has_exception() {
        return Err(JsError::Thrown);
    }
    Ok(())
}

/// `void uv_close(uv_handle_t*, uv_close_cb)`. Loop thread. Stops the handle now
/// and runs `close_cb` on a later turn, as libuv does. Closing twice does nothing.
///
/// # Safety
/// `handle` was initialised by a `uv_*_init` of this module.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_close(handle: *mut UvHandle, close_cb: Option<UvCloseCb>) {
    // SAFETY: fn contract.
    let type_ = unsafe { handle_type(handle, c"uv_close") };
    // SAFETY: initialised; the loop thread alone uses the plain fields.
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
    // SAFETY: initialised as `type_` and, until here, not closed.
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
    // The queued task keeps the loop alive until `close_cb` has run (libuv: the
    // closing list). Refused: the VM is gone, and with it that turn.
    let task = ConcurrentTask::from_callback(handle, run_close);
    if let Posted::Refused(task) = loop_.handle.post(LoopKind::Regular, task) {
        // SAFETY: refused ⇒ never queued, ours to free.
        unsafe { ConcurrentTask::release_refused(task) };
    }
}

/// `void uv_ref(uv_handle_t*)`. Loop thread. Idempotent; takes effect while the
/// handle is active.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_ref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    unsafe { (*ref_state(handle, c"uv_ref")).set_referenced(true) };
}

/// `void uv_unref(uv_handle_t*)`. Loop thread. Idempotent.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_unref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    unsafe { (*ref_state(handle, c"uv_unref")).set_referenced(false) };
}

/// `int uv_has_ref(const uv_handle_t*)`. Loop thread.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_has_ref(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    c_int::from(unsafe { (*ref_state(handle, c"uv_has_ref")).referenced })
}

/// `int uv_is_active(const uv_handle_t*)`. Loop thread. Started, for the
/// watchers and timers; not closed, for an async handle (libuv starts it in
/// init).
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_active(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    c_int::from(unsafe { (*ref_state(handle, c"uv_is_active")).active })
}

/// `int uv_is_closing(const uv_handle_t*)`. Loop thread. True from `uv_close` on.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_closing(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    unsafe { handle_type(handle, c"uv_is_closing") };
    // SAFETY: initialised; loop thread.
    let flags = unsafe { (*handle).flags };
    c_int::from(flags & (UV_HANDLE_CLOSING | UV_HANDLE_CLOSED) != 0)
}

// ──────────────────────────────────────────────────────────────────────────
// uv_req_t / uv_work_t
// ──────────────────────────────────────────────────────────────────────────

/// `UV_REQ_FIELDS` (uv.h): every request's prefix. Addons read `data` and `type`.
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
    /// On the pool's queue: `uv_cancel` can still take it.
    Queued = 0,
    /// `work_cb` started (or finished): too late to cancel.
    Running = 1,
    /// `uv_cancel` took it: `after_work_cb` gets `UV_ECANCELED`.
    Cancelled = 2,
}

/// `struct uv_work_s`: the prefix, the three fields uv.h declares after it
/// (addons read them too), then Bun's state where libuv keeps `struct uv__work`.
#[repr(C)]
pub(crate) struct UvWork {
    req: UvReq,
    loop_: *mut UvLoop,
    work_cb: Option<UvWorkCb>,
    after_work_cb: Option<UvAfterWorkCb>,
    /// A [`WorkState`]. The pool thread and `uv_cancel` race for it.
    state: AtomicU32,
}

const _: () = assert!(core::mem::offset_of!(UvWork, req) == 0);
const _: () = assert!(core::mem::offset_of!(UvWork, loop_) == 64);
const _: () = assert!(core::mem::offset_of!(UvWork, work_cb) == 72);
const _: () = assert!(core::mem::offset_of!(UvWork, after_work_cb) == 80);
const _: () = assert!(core::mem::size_of::<UvWork>() <= UV_WORK_T_SIZE);

/// The [`Job`] behind one `uv_queue_work`. Its off-thread half is the request:
/// the addon keeps it alive until `after_work_cb` has run, the job's whole life.
struct UvWorkJob;

impl JobContext for UvWorkJob {
    type OffThread = JsPtr<UvWork>;
    type Js = ();

    // SAFETY: as for the handles, no reference to a whole request is formed: the
    // pool's `run` and the loop thread's `uv_cancel` overlap. Fields are accessed
    // through the raw pointer, `state` borrowed on its own.

    fn run(req: &mut JsPtr<UvWork>, done: Completion<Self>) -> Option<Completion<Self>> {
        let req = req.as_ptr();
        // SAFETY: alive for the job's life (`UvWorkJob`); `work_cb` was written
        // before the job was scheduled.
        let started = unsafe { &(*req).state }
            .compare_exchange(
                WorkState::Queued as u32,
                WorkState::Running as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok();
        // SAFETY: as above.
        if started && let Some(work_cb) = unsafe { (*req).work_cb } {
            // SAFETY: the addon's callback, on a pool thread as documented.
            unsafe { work_cb(req) };
        }
        Some(done)
    }

    fn then(req: JsPtr<UvWork>, _: (), cx: &JsThread<'_>) -> JsResult<()> {
        let req = req.as_ptr();
        // SAFETY: as in `run`; `state` is final once the job has been posted.
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
            // SAFETY: the addon's callback, on the loop thread.
            unsafe { after_work_cb(req, status) };
        }
        if cx.global().has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

/// `int uv_queue_work(uv_loop_t*, uv_work_t*, uv_work_cb, uv_after_work_cb)`.
/// Loop thread. The request keeps the process alive, as an active one does in libuv.
///
/// # Safety
/// `loop_` is null or one of this module's loops; `req` is `sizeof(uv_work_t)`
/// bytes the addon keeps until its `after_work_cb` has run.
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
        work_cb, // libuv: UV_EINVAL too
    ) else {
        return UV_EINVAL;
    };
    bun_output::scoped_log!(uv, "uv_work_t {:?}: uv_queue_work", req);
    // SAFETY: fn contract; field-wise writes into uninitialised addon memory,
    // except `data`, which is the addon's.
    unsafe {
        (&raw mut (*req).req.type_).write(UV_WORK);
        (&raw mut (*req).req.reserved).write([core::ptr::null_mut(); 6]);
        (&raw mut (*req).loop_).write(loop_);
        (&raw mut (*req).work_cb).write(work_cb);
        (&raw mut (*req).after_work_cb).write(after_work_cb);
        (&raw mut (*req).state).write(AtomicU32::new(WorkState::Queued as u32));
    }
    // SAFETY: the loop is alive (fn contract); JS thread.
    let cx = unsafe { loop_ref.as_ref() }.js_thread();
    // SAFETY: the request outlives the job (fn contract, see `UvWorkJob`).
    Job::<UvWorkJob>::schedule(&cx, unsafe { JsPtr::new(req_ref) }, ());
    0
}

/// `int uv_cancel(uv_req_t*)`. Loop thread, as in libuv (so it cannot race the
/// `after_work_cb` that hands the request back). libuv's answers: `0` and
/// `after_work_cb` gets `UV_ECANCELED`; `UV_EBUSY` once the work started;
/// `UV_EINVAL` for a request type it cannot cancel, here every other type.
///
/// # Safety
/// `req` is null or a queued request whose `after_work_cb` has not returned.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_cancel(req: *mut UvReq) -> c_int {
    if req.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract; `type` is written before the request is queued.
    if unsafe { (*req).type_ } != UV_WORK {
        return UV_EINVAL;
    }
    // SAFETY: `type` says this is a `UvWork`; only its atomic is touched, as the
    // pool thread may be in `run`.
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
