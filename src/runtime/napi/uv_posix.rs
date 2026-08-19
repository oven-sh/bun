//! The loop-backed part of libuv's API for N-API addons on posix: `uv_async_t`,
//! `uv_queue_work`, `uv_default_loop`, and the `uv_handle_t` functions for the
//! handle type an addon can create here.
//!
//! Bun does not run a libuv loop on posix. Every other `uv_*` symbol is a crash
//! stub (`src/jsc/bindings/uv-posix-stubs.c`) or a loop-free polyfill
//! (`src/jsc/bindings/uv-posix-polyfills.c`). The functions here keep libuv's
//! ABI and its threading contract, and map the loop onto the VM's event loop:
//!
//! - The addon allocates the `uv_async_t` / `uv_work_t` and reads `data`,
//!   `loop` and `type` from it, so those fields sit where `uv.h` puts them
//!   ([`UvHandle`], [`UvReq`]). The private fields behind them are Bun's.
//! - As in libuv, only `uv_async_send` and `uv_cancel` may be called from any
//!   thread. Everything else runs on the loop's JS thread, the handle memory
//!   stays valid until `close_cb` has run, and the request until
//!   `after_work_cb` has run.
//! - A `uv_loop_t*` is a [`UvLoop`]: one per VM, embedded in its
//!   `RuntimeState`. Only its first word, `data`, is part of the ABI.
//! - `uv_async_send` sets the handle's `pending` flag and posts at most one
//!   dispatch task per loop through the VM's [`VmHandle`], coalescing sends
//!   the way libuv's eventfd does. The task walks the loop's live handles on
//!   the JS thread, as libuv's `uv__async_io` does.
//! - `uv_queue_work` is a [`Job`]: `work_cb` on the work pool, `after_work_cb`
//!   from the job's completion on the JS thread.

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicU8, AtomicU32, Ordering};

use bun_io::KeepAlive;
use bun_jsc::event_loop::ConcurrentTaskItem as ConcurrentTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    Completion, JSGlobalObject, Job, JobContext, JsCell, JsError, JsPtr, JsResult, JsThread,
    LoopKind, Posted, VmHandle,
};

use crate::jsc_hooks::RuntimeState;

bun_output::declare_scope!(uv, hidden);

unsafe extern "C" {
    /// Crashes with the report the stubs in `uv-posix-stubs.c` produce. `name`
    /// is kept by pointer, so it must be static. Does not return.
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

/// `uv_handle_type` / `uv_req_type` members (`UV_HANDLE_TYPE_MAP` /
/// `UV_REQ_TYPE_MAP` in uv.h).
const UV_ASYNC: c_uint = 1;
const UV_WORK: c_uint = 7;

/// The `uv_handle_t.flags` bits libuv itself uses for these states
/// (src/uv-common.h). Whether the handle refs the loop is the [`KeepAlive`]
/// in [`UvAsync`], not a flag.
const UV_HANDLE_CLOSING: c_uint = 0x01;
const UV_HANDLE_CLOSED: c_uint = 0x02;

/// `sizeof(uv_async_t)` and `sizeof(uv_work_t)` on 64-bit unix: the addon
/// allocates both, so Bun's private fields must fit behind the public ones.
const UV_ASYNC_T_SIZE: usize = 128;
const UV_WORK_T_SIZE: usize = 128;

type UvAsyncCb = unsafe extern "C" fn(*mut UvAsync);
type UvCloseCb = unsafe extern "C" fn(*mut UvHandle);
type UvWorkCb = unsafe extern "C" fn(*mut UvWork);
type UvAfterWorkCb = unsafe extern "C" fn(*mut UvWork, c_int);

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

/// What a `uv_loop_t*` points at on posix. One per VM, owned by its
/// `RuntimeState`, so it lives exactly as long as the VM: the main thread's
/// for the whole process (like libuv's default loop), a Worker's until the
/// Worker exits (by when, as in libuv, the addon must have closed its handles).
#[repr(C)]
pub(crate) struct UvLoop {
    /// `uv_loop_t.data`, at offset 0 as in uv.h. The addon reads and writes it,
    /// directly or through `uv_loop_{get,set}_data` (uv-posix-polyfills.c);
    /// Bun never touches it.
    data: Cell<*mut c_void>,
    vm: NonNull<VirtualMachine>,
    /// How `uv_async_send`, on any thread, reaches the JS thread. Uncounted:
    /// the loop is VM-owned, so it must not be something the VM waits for.
    handle: VmHandle,
    dispatch_state: AtomicU8,
    /// The initialised, not yet closed async handles. JS thread.
    asyncs: JsCell<Vec<NonNull<UvAsync>>>,
    /// While a dispatch pass runs, the handles it has not visited yet (in
    /// reverse order). `uv_close` removes from both lists, so a handle closed
    /// by a callback is never visited afterwards. JS thread.
    dispatching: JsCell<Vec<NonNull<UvAsync>>>,
}

const _: () = assert!(core::mem::offset_of!(UvLoop, data) == 0);

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
        }
    }

    /// The loop of `vm`, or null when `vm` has no `RuntimeState` (a `bun_jsc`
    /// unit test, or a Worker's VM after its teardown).
    ///
    /// # Safety
    /// `vm` points at a live or never-freed `VirtualMachine`. Any thread: this
    /// reads one field, `runtime_state`, which is written before the VM runs
    /// any script (so before an addon exists) and again only by a Worker's
    /// teardown, after which no conforming addon uses that Worker's loop.
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

    /// Any thread. Makes sure a dispatch pass runs after this point; at most
    /// one task is queued per loop however many handles are sent
    /// (`ThreadSafeFunction::schedule_dispatch` has the same state machine).
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
            // The VM is gone. As with a send to a closed libuv loop, the
            // callback is lost; stay consistent so a later send does not
            // believe a task is queued.
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
            // A stopping VM takes no more callbacks, like a threadsafe
            // function's; close callbacks still run (`UvAsync::run_close`).
            if global.bun_vm().script_allowed() {
                this.run_pass(global);
            }
            // A send that arrived during the pass found `Running`, so it did not
            // post a task: it set `Pending`, this exchange fails, and the next
            // pass picks its handle up. (A plain store of `Idle` would lose it.)
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

    /// One walk over the handles that were live when it started: libuv's
    /// `uv__async_io`. Like libuv, a handle goes back into the live list before
    /// its callback runs, so a `uv_close` from inside any callback finds it.
    /// A handle initialised by a callback lands in the live list and, if it is
    /// sent, in the next pass. A callback's uncaught exception is reported and
    /// the walk goes on; the VM's termination ends it.
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
        // Only a termination leaves anything here. Put it back, in order.
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

    /// JS thread. A handle may be in either list (a close from inside a
    /// dispatch pass) and, if an addon initialised it twice, more than once.
    fn unregister(&self, async_: NonNull<UvAsync>) {
        self.asyncs.with_mut(|live| live.retain(|h| *h != async_));
        self.dispatching
            .with_mut(|todo| todo.retain(|h| *h != async_));
    }
}

/// `uv_loop_t* uv_default_loop(void)`: the main thread's loop, from any
/// thread, like libuv's process-wide default loop. Null when there is no main
/// JS thread (libuv returns null when the default loop cannot be set up).
///
/// An addon loaded in a Worker gets the main thread's loop from this, as it
/// does in Node; `napi_get_uv_event_loop` is how it gets its own.
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

/// `UV_HANDLE_FIELDS` (uv.h) and `UV_HANDLE_PRIVATE_FIELDS` (uv/unix.h): the
/// common prefix of every handle type, and the view `uv_close` and friends
/// get. `data`, `loop` and `type` are read by addons and must stay where uv.h
/// puts them; the rest is libuv's private state, used here as libuv uses it.
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
    /// Sets up the common prefix as libuv's `uv__handle_init` does. `data` is
    /// the addon's and is left alone: addons commonly set it before init.
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

/// `struct uv_async_s`: the [`UvHandle`] prefix, then libuv's
/// `UV_ASYNC_PRIVATE_FIELDS`, of which Bun keeps `async_cb` and `pending`
/// and uses the rest for its own state.
#[repr(C)]
pub(crate) struct UvAsync {
    handle: UvHandle,
    async_cb: Option<UvAsyncCb>,
    /// Whether the handle keeps the process alive (`uv_ref` / `uv_unref`).
    /// JS thread.
    keep_alive: KeepAlive,
    /// Threads inside `uv_async_send`. libuv's busy counter: `uv_close` waits
    /// for it to reach zero, so once it returns no thread is still reading the
    /// handle and `close_cb` may free it.
    busy: AtomicI32,
    /// Set by `uv_async_send`, taken by the dispatch pass.
    pending: AtomicI32,
}

const _: () = assert!(core::mem::offset_of!(UvAsync, handle) == 0);
const _: () = assert!(core::mem::offset_of!(UvAsync, async_cb) == 96);
const _: () = assert!(core::mem::size_of::<UvAsync>() <= UV_ASYNC_T_SIZE);

// No function below forms a reference to a whole handle: while the loop
// thread is inside one of them, other threads may be in `uv_async_send` on the
// same handle, which is fine for its atomics but not under a `&UvAsync` or
// `&mut UvAsync` covering them. Fields are read and written through the raw
// pointer, and a reference is formed to one field at a time.
impl UvAsync {
    /// Any thread. Clears `pending`; true if it was set. Then, as libuv's
    /// `uv__async_spin`, waits until no thread is inside `uv_async_send` on
    /// this handle. That window is a flag exchange and a queue push, so the
    /// wait is short; the yield is for a sender preempted inside it.
    ///
    /// # Safety
    /// `this` is an initialised, not yet closed handle.
    unsafe fn take_pending(this: NonNull<UvAsync>) -> bool {
        // SAFETY: fn contract.
        let (pending, busy) = unsafe { (&(*this.as_ptr()).pending, &(*this.as_ptr()).busy) };
        let was_pending = pending.swap(0, Ordering::SeqCst) != 0;
        let mut spins = 0u32;
        while busy.load(Ordering::SeqCst) != 0 {
            spins += 1;
            if spins.is_multiple_of(1000) {
                std::thread::yield_now();
            } else {
                core::hint::spin_loop();
            }
        }
        was_pending
    }

    /// JS thread, the task `uv_close` posted: `close_cb`, one loop turn later.
    /// The handle is the addon's again once the callback returns (it usually
    /// frees it), so nothing touches it afterwards.
    fn run_close(this: *mut UvAsync) -> JsResult<()> {
        // SAFETY: `uv_close` posted this for a handle the addon keeps alive
        // until `close_cb` has run.
        let (close_cb, loop_) = unsafe {
            (*this).handle.flags |= UV_HANDLE_CLOSED;
            ((*this).handle.close_cb, (*this).handle.loop_)
        };
        bun_output::scoped_log!(uv, "uv_async_t {:?}: close_cb", this);
        if let Some(close_cb) = close_cb {
            // SAFETY: the addon's callback, on the loop thread, with its handle.
            unsafe { close_cb(this.cast::<UvHandle>()) };
        }
        // SAFETY: the loop outlives its handles (it is the VM's).
        let global = unsafe { &*loop_ }.js_thread().global();
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(())
    }
}

/// `int uv_async_init(uv_loop_t*, uv_async_t*, uv_async_cb)`. Loop thread.
/// The handle starts active and ref'd, as in libuv, so it keeps the process
/// alive until it is unref'd or closed.
///
/// # Safety
/// `loop_` is null or a loop this VM handed out; `handle` points at
/// `sizeof(uv_async_t)` bytes the addon keeps alive until its `close_cb` ran.
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
        (&raw mut (*handle).keep_alive).write(KeepAlive::default());
        (&raw mut (*handle).busy).write(AtomicI32::new(0));
        (&raw mut (*handle).pending).write(AtomicI32::new(0));
        (*handle).keep_alive.ref_(bun_io::js_vm_ctx());
    }
    // SAFETY: the loop is alive (fn contract); JS thread.
    unsafe { loop_ref.as_ref() }.register(async_);
    0
}

/// `int uv_async_send(uv_async_t*)`. Any thread; the first send after a
/// dispatch schedules one, later ones until then are coalesced into it.
/// Legal until `close_cb` runs: after `uv_close` it sets flags nobody reads.
///
/// # Safety
/// `handle` was initialised by `uv_async_init` and its `close_cb` has not run.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_async_send(handle: *mut UvAsync) -> c_int {
    // The loop thread may be in `uv_close` on this handle, writing its plain
    // fields; the ones used here are the atomics and `loop`, which only
    // `uv_async_init` writes, before the handle can reach another thread.
    // SAFETY: fn contract.
    let (pending, busy, loop_) =
        unsafe { (&(*handle).pending, &(*handle).busy, (*handle).handle.loop_) };
    if pending.load(Ordering::SeqCst) != 0 {
        return 0;
    }
    let _ = busy.fetch_add(1, Ordering::SeqCst);
    if pending.swap(1, Ordering::SeqCst) == 0 {
        // SAFETY: the loop outlives the handle (see `UvLoop`); only its
        // thread-safe fields are used here.
        unsafe { &*loop_ }.schedule_dispatch();
    }
    let _ = busy.fetch_sub(1, Ordering::SeqCst);
    0
}

/// The async handle behind a `uv_handle_t*`, for the functions that take any
/// handle type. Only async handles can be initialised on posix, so anything
/// else is memory no `uv_*_init` here wrote: crash the way the stub for
/// `function` did, with its name.
///
/// # Safety
/// `handle` points at an initialised handle.
unsafe fn as_async(handle: *mut UvHandle, function: &'static CStr) -> NonNull<UvAsync> {
    // SAFETY: fn contract.
    if unsafe { (*handle).type_ } != UV_ASYNC {
        unsupported(function);
    }
    // `type` says `uv_async_init` initialised this memory as a `UvAsync`.
    NonNull::new(handle.cast::<UvAsync>()).expect("dereferenced above")
}

/// `void uv_close(uv_handle_t*, uv_close_cb)`. Loop thread. Stops the handle
/// at once (no callback runs after this returns, and no `uv_async_send` is
/// still inside it) and runs `close_cb` from the loop later, as libuv does,
/// since addons free the handle there. Closing twice does nothing.
///
/// # Safety
/// `handle` was initialised by a `uv_*_init` of this module.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_close(handle: *mut UvHandle, close_cb: Option<UvCloseCb>) {
    // SAFETY: fn contract.
    let this = unsafe { as_async(handle, c"uv_close") };
    let async_ = this.as_ptr();
    // SAFETY: initialised (`as_async`); loop thread, so nothing else writes
    // the plain fields or uses the keep-alive.
    let loop_ = unsafe {
        if (*async_).handle.flags & UV_HANDLE_CLOSING != 0 {
            return;
        }
        (*async_).handle.flags |= UV_HANDLE_CLOSING;
        (*async_).handle.close_cb = close_cb;
        (*async_).keep_alive.unref(bun_io::js_vm_ctx());
        // The loop outlives its handles.
        &*(*async_).handle.loop_
    };
    bun_output::scoped_log!(uv, "uv_async_t {:?}: uv_close", handle);
    loop_.unregister(this);
    // SAFETY: initialised and, until this line, not closed.
    let _ = unsafe { UvAsync::take_pending(this) };
    // The queued task keeps the loop alive until `close_cb` has run, as
    // libuv's closing list does. Refused means the VM is already gone, and
    // with it the turn `close_cb` would have run on.
    let task = ConcurrentTask::from_callback(async_, UvAsync::run_close);
    if let Posted::Refused(task) = loop_.handle.post(LoopKind::Regular, task) {
        // SAFETY: refused ⇒ never queued, ours to free.
        unsafe { ConcurrentTask::release_refused(task) };
    }
}

/// `void uv_ref(uv_handle_t*)`. Loop thread. Idempotent; nothing after
/// `uv_close`, whose unref is final.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_ref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    let async_ = unsafe { as_async(handle, c"uv_ref") }.as_ptr();
    // SAFETY: as in `uv_close`.
    unsafe {
        if (*async_).handle.flags & UV_HANDLE_CLOSING == 0 {
            (*async_).keep_alive.ref_(bun_io::js_vm_ctx());
        }
    }
}

/// `void uv_unref(uv_handle_t*)`. Loop thread. Idempotent.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_unref(handle: *mut UvHandle) {
    // SAFETY: fn contract.
    let async_ = unsafe { as_async(handle, c"uv_unref") }.as_ptr();
    // SAFETY: as in `uv_close`.
    unsafe { (*async_).keep_alive.unref(bun_io::js_vm_ctx()) };
}

/// `int uv_has_ref(const uv_handle_t*)`. Loop thread.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_has_ref(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    let async_ = unsafe { as_async(handle, c"uv_has_ref") }.as_ptr();
    // SAFETY: as in `uv_close`.
    c_int::from(unsafe { (*async_).keep_alive.is_active() })
}

/// `int uv_is_active(const uv_handle_t*)`. Loop thread. An async handle is
/// active from `uv_async_init` until `uv_close` (libuv starts it in init).
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_active(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    let async_ = unsafe { as_async(handle, c"uv_is_active") }.as_ptr();
    // SAFETY: as in `uv_close`.
    c_int::from(unsafe { (*async_).handle.flags } & UV_HANDLE_CLOSING == 0)
}

/// `int uv_is_closing(const uv_handle_t*)`. Loop thread. True from `uv_close`
/// on, `close_cb` included.
///
/// # Safety
/// As [`uv_close`].
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_is_closing(handle: *mut UvHandle) -> c_int {
    // SAFETY: fn contract.
    let async_ = unsafe { as_async(handle, c"uv_is_closing") }.as_ptr();
    // SAFETY: as in `uv_close`.
    let flags = unsafe { (*async_).handle.flags };
    c_int::from(flags & (UV_HANDLE_CLOSING | UV_HANDLE_CLOSED) != 0)
}

// ──────────────────────────────────────────────────────────────────────────
// uv_req_t / uv_work_t
// ──────────────────────────────────────────────────────────────────────────

/// `UV_REQ_FIELDS` (uv.h): the common prefix of every request type, and the
/// view `uv_cancel` gets. `data` and `type` are the addon's to read.
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

/// `struct uv_work_s`: the [`UvReq`] prefix and the three fields uv.h
/// declares after it (`loop`, `work_cb`, `after_work_cb` are read by addons),
/// then Bun's state where libuv keeps its `struct uv__work`.
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

/// The [`Job`] behind one `uv_queue_work`. Its off-thread half is the request
/// itself: the addon keeps it alive until `after_work_cb` has run, which is
/// the job's whole life, so the pool may read it through the [`JsPtr`].
struct UvWorkJob;

impl JobContext for UvWorkJob {
    type OffThread = JsPtr<UvWork>;
    type Js = ();

    // As with the handles above, no reference to a whole request is formed:
    // `uv_cancel` may be running against it on another thread. Fields are
    // read through the raw pointer, `state` borrowed on its own.

    fn run(req: &mut JsPtr<UvWork>, done: Completion<Self>) -> Option<Completion<Self>> {
        let req = req.as_ptr();
        // SAFETY: the request is alive for the job's life (see `UvWorkJob`);
        // `work_cb` was written before the job was scheduled.
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
            // SAFETY: the addon's callback, on a pool thread, as uv_queue_work
            // documents.
            unsafe { work_cb(req) };
        }
        Some(done)
    }

    fn then(req: JsPtr<UvWork>, _: (), cx: &JsThread<'_>) -> JsResult<()> {
        let req = req.as_ptr();
        // SAFETY: as in `run`. `state` is final: the pool thread took it, or
        // `uv_cancel` did.
        let (state, after_work_cb) =
            unsafe { ((*req).state.load(Ordering::SeqCst), (*req).after_work_cb) };
        let status = if state == WorkState::Cancelled as u32 {
            UV_ECANCELED
        } else {
            0
        };
        bun_output::scoped_log!(uv, "uv_work_t {:?}: after_work_cb({})", req, status);
        // The request is the addon's again once the callback returns (it
        // usually frees it), so nothing touches it afterwards.
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
/// Loop thread. The request keeps the process alive until `after_work_cb` has
/// run, as an active libuv request does.
///
/// # Safety
/// `loop_` is null or a loop this VM handed out; `req` points at
/// `sizeof(uv_work_t)` bytes the addon keeps alive until `after_work_cb` ran.
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
    // SAFETY: fn contract; field-wise writes into uninitialised addon memory.
    // `data` is the addon's and is left alone, as libuv leaves it.
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

/// `int uv_cancel(uv_req_t*)`. Any thread. Only work requests exist here;
/// libuv also answers `UV_EINVAL` for a request type it cannot cancel.
/// `0` means `work_cb` will not run and `after_work_cb` gets `UV_ECANCELED`;
/// `UV_EBUSY` means the work already started (or finished, or was cancelled).
///
/// # Safety
/// `req` is null or a request queued by `uv_queue_work` whose `after_work_cb`
/// has not returned.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn uv_cancel(req: *mut UvReq) -> c_int {
    if req.is_null() {
        return UV_EINVAL;
    }
    // SAFETY: fn contract; `type` is written before the request is queued.
    if unsafe { (*req).type_ } != UV_WORK {
        return UV_EINVAL;
    }
    // SAFETY: `type` says `uv_queue_work` initialised this memory as a
    // `UvWork`; only its atomic is touched, as the pool thread may be racing.
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
        uv_close,
        uv_default_loop,
        uv_has_ref,
        uv_is_active,
        uv_is_closing,
        uv_queue_work,
        uv_ref,
        uv_unref,
    );
}
