//! Shared implementation of Web and Node `Worker`.
//!
//! Lifetime / threading model
//! ==========================
//!
//! Three objects, two threads, one ownership rule:
//!
//!   ┌─ PARENT THREAD ───────────────────────────────────────────────────────┐
//!   │  JSWorker (GC'd JSCell) ──Ref──► WebCore::Worker (ThreadSafeRefCounted)│
//!   │                                    └─ impl_ ──owns──► Zig WebWorker    │
//!   └───────────────────────────────────────────────────────┬───────────────┘
//!                                                            │
//!   ┌─ WORKER THREAD ───────────────────────────────────────┴───────────────┐
//!   │  runs threadMain() → spin() → shutdown(); reads this struct directly  │
//!   └───────────────────────────────────────────────────────────────────────┘
//!
//! Ownership rule: this struct is OWNED BY the C++ `WebCore::Worker`. It is
//! allocated in `create()` and freed in `WebCore::Worker::~Worker()` via
//! `WebWorker__destroy`. The worker thread NEVER frees it. Because `JSWorker`
//! holds a `Ref<Worker>`, `impl_` is valid for the entire time JS can call
//! `terminate()`/`ref()`/`unref()` — those calls cannot UAF.
//!
//! Refs on `WebCore::Worker`:
//!   - `JSWorker` wrapper  +1  (dropped at GC)
//!   - worker thread       +1  taken in `Worker::create()` BEFORE the thread is
//!                             spawned, dropped on the PARENT thread inside the
//!                             close task posted by `dispatchExit()`. `~Worker`
//!                             therefore never runs on the worker thread.
//!
//! Lifecycle of the worker thread (`threadMain`):
//!   1. `startVM()`  — build a mimalloc arena, clone env, initialise a
//!      `jsc.VirtualMachine`, publish `vm` under `vm_lock`.
//!   2. `spin()`     — load the entry point, call `dispatchOnline` +
//!      `fireEarlyMessages`, run the event loop until it drains or
//!      `requested_terminate` is observed, run `beforeExit`.
//!   3. `shutdown()` — call `vm.onExit()`, tear down the JSC VM, post
//!      `dispatchExit` (which releases `parent_poll_ref` + the thread ref on
//!      the parent), free the arena, exit the thread. After `dispatchExit`
//!      `this` may be freed at any time; nothing below it dereferences `this`.
//!
//! `vm_lock` exists solely to close the TOCTOU between the parent reading a
//! non-null `vm` (in `notifyNeedTermination`) and the worker freeing the arena
//! that backs it. It is held only while (a) publishing `vm` in `startVM`,
//! (b) nulling `vm` in `shutdown`, (c) reading `vm` + calling `wakeup()` in
//! `notifyNeedTermination`.
//!
//! Every field below is grouped by which thread may touch it.
//!
//! At process exit (`globalExit` under BUN_DESTRUCT_VM_ON_EXIT),
//! `terminateAllAndWait()` stops every live worker and waits for each to
//! reach `shutdown()` before process-global resolver state is freed — the
//! main-thread analogue of Node's `Environment::stop_sub_worker_contexts()`.
//!
//! Known gap vs Node.js: the worker thread is detached, not joined, so
//! `await worker.terminate()` resolves before the OS thread is fully gone;
//! nested workers are not stopped when their WORKER parent's context tears
//! down (only the main thread waits). When a parent context is gone before
//! the close task posts, the thread-held `Worker` ref is intentionally
//! leaked (see `Worker::dispatchExit`).

use crate::JsCell;
use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_core::{String as BunString, WTFStringImpl};
use bun_io::KeepAlive;
use bun_threading::{Futex, Mutex};

use crate::virtual_machine::{self, VirtualMachine, runtime_hooks};
use crate::{self as jsc, JSGlobalObject, JSValue, JsError, LogJsc};

bun_core::define_scoped_log!(log, Worker, hidden);

// ---- Immutable after `create()` (safe from any thread) ----------------------

pub struct WebWorker {
    /// The owning C++ `WebCore::Worker`. Never null; this struct is freed by
    /// `~Worker`, so the pointer cannot dangle.
    cpp_worker: *mut c_void,
    parent: bun_ptr::BackRef<VirtualMachine>,
    execution_context_id: u32,
    mini: bool,
    eval_mode: bool,
    store_fd: bool,
    /// Borrowed from C++ `WorkerOptions` (kept alive by the owning `Worker`).
    // TODO(port): lifetime — borrowed from cpp_worker (BACKREF).
    argv_ptr: *const WTFStringImpl,
    argv_len: usize,
    exec_argv_ptr: *const WTFStringImpl,
    exec_argv_len: usize,
    inherit_exec_argv: bool,
    /// Heap-owned by this struct; freed in `destroy()`.
    unresolved_specifier: Box<[u8]>,
    preloads: Vec<Box<[u8]>>,
    /// Owned NUL-terminated bytes; Zig was `[:0]const u8`.
    name: bun_core::ZBox,

    live_next: Cell<*mut WebWorker>,
    live_prev: Cell<*mut WebWorker>,

    /// Set by the parent (`notifyNeedTermination`) or by the worker itself
    /// (`exit`). The worker loop polls this between ticks.
    requested_terminate: AtomicBool,

    vm: Cell<*mut VirtualMachine>,
    vm_lock: Mutex,

    parent_poll_ref: JsCell<KeepAlive>,

    status: Cell<Status>,
    arena: JsCell<Option<bun_alloc::Arena>>,
    worker_env_map: Cell<*mut bun_dotenv::Map>,
    worker_env_loader: Cell<*mut bun_dotenv::Loader<'static>>,
    exit_called: AtomicBool,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Status {
    /// Thread not yet started / startVM in progress.
    Start,
    /// `spin()` has begun; entry point is loading.
    Starting,
    /// `dispatchOnline` has fired; event loop is running.
    Running,
    /// `shutdown()` has begun; no further JS will run.
    Terminated,
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); C++ mutating VM state through it is
    // interior to the cell.
    safe fn WebWorker__teardownJSCVM(global: &JSGlobalObject);
    safe fn WebWorker__dispatchExit(cpp_worker: *mut c_void, exit_code: i32);
    // Re-declared here (also private in VM.rs) so `thread_main` can take the
    // API lock as a raw FFI call with NO RAII guard — see PORT NOTE there.
    safe fn JSC__VM__getAPILock(vm: &jsc::VM);
    safe fn WebWorker__dispatchOnline(cpp_worker: *mut c_void, global: &JSGlobalObject);
    safe fn WebWorker__fireEarlyMessages(cpp_worker: *mut c_void, global: &JSGlobalObject);
    safe fn WebWorker__dispatchError(
        global: &JSGlobalObject,
        cpp_worker: *mut c_void,
        message: &mut BunString,
        err: JSValue,
    );
}

mod live_workers {
    use super::*;

    // PORT NOTE: `Mutex::new()` is the prevailing const-init spelling across
    // un-gated jsc modules (ConsoleObject.rs, bundler/ThreadPool.rs); the
    // `bun_threading` crate provides it.
    pub(super) static MUTEX: Mutex = Mutex::new();
    pub(super) static HEAD: bun_core::AtomicCell<*mut WebWorker> =
        bun_core::AtomicCell::new(core::ptr::null_mut());
    /// Number of workers registered in `list`. Separate atomic so
    /// `terminateAllAndWait` can futex-wait on it without the mutex.
    pub(super) static OUTSTANDING: AtomicU32 = AtomicU32::new(0);

    pub(super) fn register(worker: *mut WebWorker) {
        MUTEX.lock();
        let head = HEAD.load();
        // SAFETY: MUTEX held; `worker` is a valid heap allocation owned by C++.
        unsafe {
            (*worker).live_prev.set(core::ptr::null_mut());
            (*worker).live_next.set(head);
            if !head.is_null() {
                (*head).live_prev.set(worker);
            }
        }
        HEAD.store(worker);
        OUTSTANDING.fetch_add(1, Ordering::Release);
        // Wake terminateAllAndWait so it re-sweeps and catches this worker
        // (it may have been created by another worker mid-sweep). No-op if
        // nothing is waiting.
        Futex::wake(&OUTSTANDING, 1);
        MUTEX.unlock();
    }

    pub(super) fn unlink(worker: *const WebWorker) {
        MUTEX.lock();
        // SAFETY: MUTEX held; node was registered in `register`.
        unsafe {
            let prev = (*worker).live_prev.get();
            let next = (*worker).live_next.get();
            if !prev.is_null() {
                (*prev).live_next.set(next);
            } else {
                HEAD.store(next);
            }
            if !next.is_null() {
                (*next).live_prev.set(prev);
            }
            (*worker).live_prev.set(core::ptr::null_mut());
            (*worker).live_next.set(core::ptr::null_mut());
        }
        MUTEX.unlock();
    }

    pub(super) fn mark_exited() {
        // Wake any waiter in terminateAllAndWait when we hit zero. Waking
        // unconditionally is fine (spurious wakeups just re-check the
        // counter) and avoids a compare-before-wake race.
        OUTSTANDING.fetch_sub(1, Ordering::Release);
        Futex::wake(&OUTSTANDING, 1);
    }

    pub(super) fn unregister(worker: *const WebWorker) {
        unlink(worker);
        mark_exited();
    }
}

pub fn terminate_all_and_wait(timeout_ms: u64) {
    if live_workers::OUTSTANDING.load(Ordering::Acquire) == 0 {
        return;
    }

    let timer = std::time::Instant::now();
    let deadline_ns: u64 = timeout_ms * 1_000_000; // std.time.ns_per_ms
    loop {
        live_workers::MUTEX.lock();
        // MUTEX held while walking the intrusive list; HEAD load is safe.
        let mut it = live_workers::HEAD.load();
        while let Some(nn) = NonNull::new(it) {
            // Worker valid while registered (removed only in shutdown());
            // MUTEX held — `ParentRef` invariant (pointee outlives borrow) holds.
            let w = bun_ptr::ParentRef::from(nn);
            // live_workers::MUTEX held; list links written only under it.
            it = w.live_next.get();
            if w.requested_terminate.swap(true, Ordering::Release) {
                continue;
            }
            w.vm_lock.lock();
            // vm_lock held; `vm` is published/unpublished under vm_lock.
            let vm_ptr = w.vm_ptr();
            if !vm_ptr.is_null() {
                // SAFETY: vm_ptr published under vm_lock and non-null here.
                // jsc_vm is a valid JSC::VM*; notify_need_termination is
                // documented thread-safe (VMTraps). Cast through the real
                // opaque `crate::VM` (the `crate::VM` stub is layout-only).
                // We deliberately do NOT bind `&VirtualMachine` — the worker
                // thread may hold a live mutable view of the VM; raw-pointer
                // field/method access keeps any autoref scoped to the access.
                unsafe { (*(*vm_ptr).jsc_vm.cast_const()).notify_need_termination() };
                // SAFETY: event_loop() returns the live `*mut EventLoop` self-ptr.
                unsafe { (*(*vm_ptr).event_loop()).wakeup() };
            }
            w.vm_lock.unlock();
        }
        live_workers::MUTEX.unlock();

        let n = live_workers::OUTSTANDING.load(Ordering::Acquire);
        if n == 0 {
            return;
        }
        let elapsed = u64::try_from(timer.elapsed().as_nanos()).unwrap_or(u64::MAX);
        if elapsed >= deadline_ns {
            log!("terminateAllAndWait: timed out with {} outstanding", n);
            return;
        }
        let _ = Futex::wait(&live_workers::OUTSTANDING, n, Some(deadline_ns - elapsed));
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn WebWorker__getParentWorker(vm: &VirtualMachine) -> *mut c_void {
    vm.worker_ref()
        .map(|w| w.cpp_worker)
        .unwrap_or(core::ptr::null_mut())
}

impl WebWorker {
    pub fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
    }

    #[inline]
    fn vm_ptr(&self) -> *mut VirtualMachine {
        self.vm.get()
    }

    #[inline]
    fn with_parent_poll_ref<R>(&self, f: impl FnOnce(&mut KeepAlive) -> R) -> R {
        self.parent_poll_ref.with_mut(f)
    }

    /// Zig: `worker.eval_mode` field — whether this worker was started in
    /// eval mode (entry source is a string, not a file).
    #[inline]
    pub fn eval_mode(&self) -> bool {
        self.eval_mode
    }

    /// Zig: `worker.argv: []const WTFStringImpl` field — borrowed from the C++
    /// `WorkerOptions` (kept alive by the owning `WebCore::Worker`).
    #[inline]
    pub fn argv(&self) -> &[WTFStringImpl] {
        // SAFETY: `argv_ptr[..argv_len]` is borrowed from C++ WorkerOptions
        // (BACKREF — kept alive by the owning Worker for `self`'s lifetime).
        // `(null, 0)` is tolerated by `ffi::slice`.
        unsafe { bun_core::ffi::slice(self.argv_ptr, self.argv_len) }
    }

    /// Zig: `worker.execArgv: ?[]const WTFStringImpl` — `None` when
    /// `inherit_exec_argv` (the worker inherits the parent's execArgv),
    /// otherwise `Some(slice)` (possibly empty) borrowed from C++ WorkerOptions.
    #[inline]
    pub fn exec_argv(&self) -> Option<&[WTFStringImpl]> {
        if self.inherit_exec_argv {
            return None;
        }
        // SAFETY: see `argv()`.
        Some(unsafe { bun_core::ffi::slice(self.exec_argv_ptr, self.exec_argv_len) })
    }

    fn set_requested_terminate(&self) -> bool {
        self.requested_terminate.swap(true, Ordering::Release)
    }

    // =========================================================================
    // Construction (parent thread)
    // =========================================================================

    #[unsafe(export_name = "WebWorker__create")]
    pub unsafe extern "C" fn create(
        cpp_worker: *mut c_void,
        parent: *mut VirtualMachine,
        name_str: BunString,
        specifier_str: BunString,
        error_message: &mut BunString,
        _parent_context_id: u32,
        this_context_id: u32,
        mini: bool,
        default_unref: bool,
        eval_mode: bool,
        argv_ptr: *const WTFStringImpl,
        argv_len: usize,
        inherit_exec_argv: bool,
        exec_argv_ptr: *const WTFStringImpl,
        exec_argv_len: usize,
        preload_modules_ptr: *const BunString,
        preload_modules_len: usize,
    ) -> *mut WebWorker {
        jsc::mark_binding();
        log!("[{}] create", this_context_id);

        let spec_slice = specifier_str.to_utf8();
        // SAFETY: `parent` is the calling thread's live VM (BACKREF).
        let parent_ref = unsafe { &mut *parent };
        let prev_log = parent_ref.transpiler.log;
        let mut temp_log = bun_ast::Log::default();
        parent_ref.transpiler.set_log(&raw mut temp_log);
        // RAII: Zig's `defer parent.transpiler.setLog(prev_log)` +
        // `defer temp_log.deinit()` — restored on every return path.
        let mut restore = scopeguard::guard((parent_ref, temp_log), |(p, log)| {
            p.transpiler.set_log(prev_log);
            drop(log);
        });
        let (parent_ref, temp_log) = &mut *restore;

        // SAFETY: caller passed valid (ptr,len) (or `(null,0)`); slice borrowed from C++.
        let preload_modules: &[BunString] =
            unsafe { bun_core::ffi::slice(preload_modules_ptr, preload_modules_len) };

        let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(preload_modules_len);
        for module in preload_modules {
            let utf8_slice = module.to_utf8();
            // SAFETY: `parent_ref` is the live VM on the calling (parent)
            // thread — its `transpiler` is uniquely owned here.
            if let Some(preload) = unsafe {
                resolve_entry_point_specifier(
                    *parent_ref,
                    utf8_slice.slice(),
                    error_message,
                    temp_log,
                )
            } {
                preloads.push(preload.to_vec().into_boxed_slice());
            }

            if !error_message.is_empty() {
                // preloads dropped by RAII.
                return core::ptr::null_mut();
            }
        }

        let store_fd = parent_ref.transpiler.resolver.store_fd;

        let worker = bun_core::heap::into_raw(Box::new(WebWorker {
            cpp_worker,
            // `parent` is the calling thread's live VM; non-null by FFI contract.
            parent: bun_ptr::BackRef::from(NonNull::new(parent).expect("parent VM")),
            execution_context_id: this_context_id,
            mini,
            eval_mode,
            store_fd,
            argv_ptr,
            argv_len,
            exec_argv_ptr,
            exec_argv_len,
            inherit_exec_argv,
            unresolved_specifier: spec_slice.slice().to_vec().into_boxed_slice(),
            preloads,
            name: if name_str.is_empty() {
                bun_core::ZBox::default()
            } else {
                name_str.to_owned_slice_z()
            },
            live_next: Cell::new(core::ptr::null_mut()),
            live_prev: Cell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
            vm: Cell::new(core::ptr::null_mut()),
            vm_lock: Mutex::new(),
            parent_poll_ref: JsCell::new(KeepAlive::init()),
            status: Cell::new(Status::Start),
            arena: JsCell::new(None),
            worker_env_map: Cell::new(core::ptr::null_mut()),
            worker_env_loader: Cell::new(core::ptr::null_mut()),
            exit_called: AtomicBool::new(false),
        }));
        // `worker` is non-null (just heap-allocated). Wrap once for the safe
        // shared reborrows below; the raw `worker` is still used for
        // `register`/`destroy`/the FFI return value.
        let worker_ref =
            bun_ptr::ParentRef::from(NonNull::new(worker).expect("heap::into_raw is non-null"));

        if !default_unref || parent_ref.worker_ref().is_some() {
            // `worker` is a fresh heap allocation; not yet shared.
            // `bun_io::js_vm_ctx()` resolves to this (parent) thread's loop.
            worker_ref.with_parent_poll_ref(|p| p.ref_(bun_io::js_vm_ctx()));
        }

        // Register BEFORE spawning so terminateAllAndWait() can never miss a
        // worker whose thread is already running.
        live_workers::register(worker);

        // PORT NOTE: Zig's `std.Thread.spawn(.{ .stack_size }, threadMain, .{worker})`.
        // `std::thread` is permitted (only `std::{fs,net,process}` are banned);
        // bun_threading has no generic spawn helper.
        struct SendPtr(*mut WebWorker);
        // SAFETY: `WebWorker` is heap-allocated and the worker thread is the
        // sole writer to its worker-thread-only fields; cross-thread fields are
        // atomic/locked. The pointer is moved into the new thread exactly once.
        unsafe impl Send for SendPtr {}
        let send = SendPtr(worker);
        let spawn = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || {
                let send = send;
                // SAFETY: `send.0` is a valid heap `WebWorker` owned by C++;
                // `&WebWorker` (not `&mut`) — see worker-thread `&self` note.
                unsafe { (*send.0).thread_main() };
            });
        match spawn {
            Ok(handle) => {
                // Detach: see "Known gap" in the file header.
                drop(handle);
                worker
            }
            Err(_) => {
                live_workers::unregister(worker);
                // `worker` not yet shared (spawn failed); parent thread.
                worker_ref.with_parent_poll_ref(|p| p.unref(bun_io::js_vm_ctx()));
                // SAFETY: `worker` is the heap allocation from `heap::into_raw`
                // above; spawn failed so it was never shared with another thread.
                unsafe { Self::destroy(worker) };
                *error_message = BunString::static_(b"Failed to spawn worker thread");
                core::ptr::null_mut()
            }
        }
    }

    #[unsafe(export_name = "WebWorker__destroy")]
    pub unsafe extern "C" fn destroy(this: *mut WebWorker) {
        // SAFETY: this was heap-allocated in create(); C++ owns it and calls
        // destroy exactly once.
        let this = unsafe { bun_core::heap::take(this) };
        log!("[{}] destroy", this.execution_context_id);
        // unresolved_specifier / preloads / name freed by Drop.
        drop(this);
    }

    // =========================================================================
    // Parent-thread API (called from C++ via JS)
    // =========================================================================

    #[unsafe(export_name = "WebWorker__setRef")]
    pub extern "C" fn set_ref(this: *mut WebWorker, value: bool) {
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        // A nested worker (parent is itself a worker) must keep the parent-loop
        // keepalive even on `.unref()`: the child holds a non-owning `BackRef` to
        // the parent VM and worker parents aren't joined on exit.
        let parent_is_worker = this.parent.get().worker_ref().is_some();
        this.with_parent_poll_ref(|poll| {
            if value {
                poll.ref_(bun_io::js_vm_ctx());
            } else if !parent_is_worker {
                poll.unref(bun_io::js_vm_ctx());
            }
        });
    }

    #[unsafe(export_name = "WebWorker__notifyNeedTermination")]
    pub extern "C" fn notify_need_termination(this: *mut WebWorker) {
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        if this.set_requested_terminate() {
            return;
        }
        log!("[{}] notifyNeedTermination", this.execution_context_id);

        // vm_lock serialises against shutdown() nulling `vm` and freeing the
        // arena it lives in.
        this.vm_lock.lock();
        // vm_lock held; `vm` is published/unpublished under vm_lock.
        let vm_ptr = this.vm_ptr();
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr published under vm_lock and non-null here.
            // jsc_vm is a valid JSC::VM*; notify_need_termination is
            // documented thread-safe (VMTraps). Cast through the real opaque
            // `crate::VM` (the `crate::VM` stub is layout-only). No
            // `&VirtualMachine` binding — see `terminate_all_and_wait`.
            unsafe { (*(*vm_ptr).jsc_vm.cast_const()).notify_need_termination() };
            // SAFETY: event_loop() returns the live `*mut EventLoop` self-ptr.
            unsafe { (*(*vm_ptr).event_loop()).wakeup() };
        }
        this.vm_lock.unlock();
    }

    #[unsafe(export_name = "WebWorker__releaseParentPollRef")]
    pub extern "C" fn release_parent_poll_ref(this: *mut WebWorker) {
        // `this` is a valid heap allocation owned by C++ — `ParentRef` invariant
        // holds; parent-thread only.
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        this.with_parent_poll_ref(|p| p.unref(bun_io::js_vm_ctx()));
    }

    /// Non-owning back-reference to the parent VM. See field doc for validity
    /// (`parent_poll_ref` keeps the parent loop alive until the close task
    /// runs).
    #[inline]
    pub fn parent_vm(&self) -> bun_ptr::BackRef<VirtualMachine> {
        self.parent
    }

    #[inline]
    pub fn execution_context_id(&self) -> u32 {
        self.execution_context_id
    }

    #[inline]
    pub fn cpp_worker(&self) -> *mut c_void {
        self.cpp_worker
    }

    #[inline]
    pub fn mini(&self) -> bool {
        self.mini
    }

    // =========================================================================
    // Worker thread
    // =========================================================================

    fn thread_main(&self) {
        bun_analytics::features::workers_spawned.fetch_add(1, Ordering::Relaxed);

        if !self.name.is_empty() {
            bun_core::output::Source::configure_named_thread(self.name.as_zstr());
        } else {
            bun_core::output::Source::configure_named_thread(bun_core::ZStr::from_static(
                b"Worker\0",
            ));
        }

        // Terminated before we even started — skip straight to shutdown so the
        // parent still gets a close event and the thread ref is dropped.
        if self.has_requested_terminate() {
            self.shutdown();
            return;
        }

        let vm_ptr = match self.start_vm() {
            Ok(vm) => vm,
            Err(err) => {
                bun_core::output::panic(format_args!(
                    "An unhandled error occurred while starting a worker: {}\n",
                    err.name()
                ));
            }
        };

        if vm_ptr.is_null() {
            return;
        }

        // `start_vm()` published `vm_ptr` under `vm_lock` AND installed it as
        // this thread's per-thread VM (`VirtualMachine::init` → `VMHolder`), so
        // the safe thread-local accessor returns the same allocation.
        debug_assert!(core::ptr::eq(vm_ptr, VirtualMachine::get_mut_ptr()));
        let global = VirtualMachine::get().global();
        JSC__VM__getAPILock(global.vm());
        self.spin();
    }

    fn start_vm(&self) -> Result<*mut VirtualMachine, bun_core::Error> {
        debug_assert!(self.status.get() == Status::Start);
        debug_assert!(self.vm_ptr().is_null());

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");

        let parent = self.parent.get();
        // Deref-clone out of the `Arc` — worker mutates `allow_addons` below
        // and passes the owned struct as `args` to the new VM.
        let mut transform_options = (*parent.transpiler.options.transform_options).clone();

        if let Some(exec_argv) = self.exec_argv() {
            // SAFETY: `exec_argv` borrows C++ `WorkerOptions` kept alive by the
            // owning `WebCore::Worker` for `self`'s lifetime; the hook only
            // reads the slice and owns its own temporary allocations.
            let parsed = unsafe { (hooks.parse_worker_exec_argv_allow_addons)(exec_argv) };
            if let Some(allow_addons) = parsed {
                // override the existing even if it was set
                transform_options.allow_addons = Some(allow_addons);
            }
        }

        // worker-thread only field; no other thread reads `arena`.
        self.arena.set(Some(bun_alloc::Arena::new()));

        let mut temp_proxy_slots = jsc::rare_data::ProxyEnvSlots::default();

        let mut map = Box::new(bun_dotenv::Map::default());
        {
            let parent_slots = parent.proxy_env_storage.lock();
            temp_proxy_slots.clone_from(&parent_slots);
            // SAFETY: `parent.transpiler.env` is the parent-owned `DotEnv::Loader`
            // set in `Transpiler::init`; valid while `parent` lives. Read-only.
            *map = parent.env_loader().map.clone_with_allocator()?;
        }
        // Ensure map entries point at the exact bytes we hold refs on.
        temp_proxy_slots.sync_into(&mut map);

        let map_ptr: *mut bun_dotenv::Map = bun_core::heap::into_raw(map);
        // SAFETY: `map_ptr` heap-allocated above; `'static` is the lifetime
        // erasure for the worker-VM-lifetime borrow (Zig: arena-backed).
        let loader = Box::new(bun_dotenv::Loader::init(unsafe { &mut *map_ptr }));
        let loader_ptr: *mut bun_dotenv::Loader<'static> = bun_core::heap::into_raw(loader);
        self.worker_env_map.set(map_ptr);
        self.worker_env_loader.set(loader_ptr);

        if self.has_requested_terminate() {
            drop(temp_proxy_slots);
            self.shutdown();
            // `self` may be freed past this point (shutdown posted dispatchExit
            // → parent close task may drop the last Worker ref). Do NOT touch
            // `self`; signal "already shut down" via the null return.
            return Ok(core::ptr::null_mut());
        }

        let vm = VirtualMachine::init_worker(
            self,
            virtual_machine::Options {
                args: transform_options,
                env_loader: NonNull::new(loader_ptr),
                store_fd: self.store_fd,
                graph: parent.standalone_module_graph,
                ..Default::default()
            },
        )?;
        {
            // SAFETY: init_worker returns a valid heap-allocated VM ptr;
            // not yet published, so this `&mut` is exclusive.
            let vm_ref = unsafe { &mut *vm };
            // arena initialised above; worker-thread only field. `with_mut`
            // scopes a `&mut Option<Arena>` to the closure; we extract the raw
            // address (escaping as `*mut`, no borrow) for the VM backref.
            vm_ref.arena = self
                .arena
                .with_mut(|a| NonNull::new(std::ptr::from_mut(a.as_mut().unwrap())));

            // Move the pre-cloned proxy storage into the worker VM.
            *vm_ref.proxy_env_storage.lock() = core::mem::take(&mut temp_proxy_slots);

            vm_ref.is_main_thread = false;
            VirtualMachine::set_is_main_thread_vm(false);
            vm_ref.on_unhandled_rejection = on_unhandled_rejection;
        }

        self.vm_lock.lock();
        // vm_lock held; this is the publish point.
        self.vm.set(vm);
        self.vm_lock.unlock();

        // Post-publish: do NOT re-form `&mut VirtualMachine`. Field/method
        // access goes through the raw `*mut` so any autoref is scoped to the
        // single expression. The parent-thread readers likewise never bind
        // `&VirtualMachine` (see `terminate_all_and_wait`).
        // SAFETY: `vm` is a valid heap-allocated VM ptr (checked above).
        unsafe {
            let b = &mut (*vm).transpiler;
            b.resolver.env_loader = NonNull::new(b.env);

            if let Some(graph) = parent.standalone_module_graph {
                (hooks.apply_standalone_runtime_flags)(b, graph);
            }
        }

        if self.has_requested_terminate() {
            return Ok(vm);
        }

        // SAFETY: see post-publish note above.
        unsafe {
            if (*vm).transpiler.configure_defines().is_err() {
                // Fall through to spin() → shutdown() for full teardown under
                // the API lock (flushLogs runs JS). Set terminate so spin()
                // bails immediately; vm.log carries the error for flushLogs.
                (*vm).exit_handler.exit_code = 1;
                let _ = self.set_requested_terminate();
                return Ok(vm);
            }

            (*vm).load_extra_env_and_source_code_printer();
        }
        Ok(vm)
    }

    fn spin(&self) {
        log!("[{}] spin start", self.execution_context_id);

        let vm_ptr: *mut VirtualMachine = self.vm_ptr();
        debug_assert!(core::ptr::eq(vm_ptr, VirtualMachine::get_mut_ptr()));
        let vm: &VirtualMachine = VirtualMachine::get();
        debug_assert!(self.status.get() == Status::Start);
        self.set_status(Status::Starting);

        // Terminated during startVM() (or startVM() short-circuited here on
        // configureDefines failure) — shut down under the API lock so the
        // JSC::VM built by initWorker is torn down rather than leaked.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            return self.shutdown();
        }

        // `preloads` is owned by `self` (heap `WebWorker` outlives the VM).
        // PORT NOTE: Zig's slice-copy assignment; here `preload: Vec<Box<[u8]>>`
        // so clone the boxes (cheap, ≤handful).
        vm.as_mut().preload.clone_from(&self.preloads);

        let mut resolve_error = BunString::empty();
        let vm_log = vm.log_mut().unwrap();
        // SAFETY: `vm_ptr` is the live worker-thread VM; the fn takes a raw ptr
        // (no `&mut`) because `vm` is already published under `vm_lock` — see
        // `resolve_entry_point_specifier` Safety contract.
        let path = match unsafe {
            resolve_entry_point_specifier(
                vm_ptr,
                &self.unresolved_specifier,
                &mut resolve_error,
                vm_log,
            )
        } {
            Some(p) => p,
            None => {
                vm.as_mut().exit_handler.exit_code = 1;
                if vm_log.errors == 0 && !resolve_error.is_empty() {
                    let err = resolve_error.to_utf8();
                    // `Log::add_error` takes `impl IntoText`; pass an owned
                    // `Vec<u8>` so the `Msg` owns its bytes (no lifetime tie
                    // to `err`, which is dropped immediately after).
                    vm_log.add_error(None, bun_ast::Loc::EMPTY, err.slice().to_vec());
                }
                resolve_error.deref();
                self.flush_logs(vm);
                return self.shutdown();
            }
        };
        resolve_error.deref();

        // Terminated while resolving — exit code 0, no error.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            return self.shutdown();
        }

        let promise = match vm.as_mut().load_entry_point_for_web_worker(path) {
            Ok(p) => p,
            Err(_) => {
                // process.exit() may have run during load; don't clobber its code.
                if !self.exit_called.load(Ordering::Relaxed) {
                    vm.as_mut().exit_handler.exit_code = 1;
                }
                self.flush_logs(vm);
                return self.shutdown();
            }
        };

        // SAFETY: `promise` is a live JSC heap cell.
        unsafe {
            if (*promise).status() == jsc::js_promise::Status::Rejected {
                let handled = vm.as_mut().uncaught_exception(
                    vm.global(),
                    (*promise).result(vm.jsc_vm()),
                    true,
                );
                if !handled {
                    vm.as_mut().exit_handler.exit_code = 1;
                    return self.shutdown();
                }
            } else {
                let _ = (*promise).result(vm.jsc_vm());
            }
        }

        self.flush_logs(vm);
        log!("[{}] event loop start", self.execution_context_id);
        WebWorker__dispatchOnline(self.cpp_worker, vm.global());
        WebWorker__fireEarlyMessages(self.cpp_worker, vm.global());
        self.set_status(Status::Running);

        // don't run the GC if we don't actually need to
        if vm.is_event_loop_alive() || vm.event_loop_mut().tick_concurrent_with_count() > 0 {
            vm.global().vm().release_weak_refs();
            // PERF(port): `vm.arena.gc()` was `MimallocArena.gc()` →
            // `mi_heap_collect`. `Arena = bumpalo::Bump` has no collect;
            // global mimalloc handles reclamation. Profile if it shows up on a hot path.
            let _ = vm.global().vm().run_gc(false);
        }

        // Always do a first tick so we call CppTask without delay after
        // dispatchOnline.
        vm.as_mut().tick();

        while vm.is_event_loop_alive() {
            vm.as_mut().tick();
            if self.has_requested_terminate() {
                break;
            }
            vm.as_mut().auto_tick_active();
            if self.has_requested_terminate() {
                break;
            }
        }

        log!(
            "[{}] before exit {}",
            self.execution_context_id,
            if self.has_requested_terminate() {
                "(terminated)"
            } else {
                "(event loop dead)"
            }
        );

        // Only emit 'beforeExit' on a natural drain, not on terminate().
        if !self.has_requested_terminate() {
            // TODO: is this able to allow the event loop to continue?
            vm.as_mut().on_before_exit();
        }

        self.flush_logs(vm);
        self.shutdown();
    }

    fn shutdown(&self) {
        jsc::mark_binding();
        self.set_status(Status::Terminated);
        bun_analytics::features::workers_terminated.fetch_add(1, Ordering::Relaxed);
        log!("[{}] shutdown", self.execution_context_id);

        // Snapshot everything we'll need after `this` may be freed (step 4).
        let cpp_worker = self.cpp_worker;
        // worker-thread only field; no other thread reads `arena`.
        let mut arena = self.arena.replace(None);
        let env_loader = self.worker_env_loader.replace(core::ptr::null_mut());
        let env_map = self.worker_env_map.replace(core::ptr::null_mut());

        // ---- 1. Unpublish vm ------------------------------------------------
        self.vm_lock.lock();
        // vm_lock held; this is the unpublish point.
        let vm_ptr = self.vm.replace(core::ptr::null_mut());
        self.vm_lock.unlock();
        let mut loop_: Option<*mut bun_uws::Loop> = None;
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr was published under vm_lock; sole owner now.
            loop_ = Some(unsafe { &*vm_ptr }.uws_loop());
        }

        // ---- 2. User exit handlers -----------------------------------------
        let mut exit_code: i32 = 0;
        let mut global_object: Option<*const JSGlobalObject> = None;
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr valid; unpublished above under vm_lock, so no
            // other thread can dereference it now — `&mut` is exclusive.
            let vm = unsafe { &mut *vm_ptr };
            // terminate() set the JSC termination flag to interrupt running JS;
            // clear it so process.on('exit') handlers can run. teardownJSCVM
            // re-sets it for the JSC VM teardown.
            vm.jsc_vm().clear_has_termination_request();
            vm.is_shutting_down = true;
            vm.on_exit();
            if let Some(hooks) = runtime_hooks() {
                (hooks.cron_clear_all_teardown)(vm);
                // Drain `TimeoutObject`s from this worker's timer heap before
                // `close_all_socket_groups` / `WebWorker__teardownJSCVM` so
                // their heap nodes are unlinked while `runtime_state` and the
                // JSC heap are both still alive.
                // SAFETY: `vm_ptr` was unpublished under `vm_lock` above, so
                // this thread is the sole owner; `runtime_state` for this
                // worker thread is still installed (torn down in `destroy()`).
                unsafe { (hooks.cancel_all_timers)(vm_ptr) };
            }
            // Embedded socket groups must drain while JSC is still alive —
            // closeAll() fires on_close → JS callbacks. RareData.deinit() runs
            // after teardownJSCVM and only deinit()s (asserts empty in debug).
            if let Some(rare) = vm.rare_data.as_deref_mut() {
                // PORT NOTE: reshaped for borrowck — `close_all_socket_groups`
                // wants `&VirtualMachine` while `rare` is `&mut` borrowed from
                // `vm`. Re-derive `vm` through the raw ptr (sole owner).

                // SAFETY: `vm_ptr` was unpublished under `vm_lock` above, so this
                // thread is the sole owner; the JSC VM is still alive (teardown
                // is step 3 below).
                rare.close_all_socket_groups(unsafe { &*vm_ptr });
            }
            exit_code = i32::from(vm.exit_handler.exit_code);
            global_object = Some(vm.global);
        }

        // ---- 3. JSC VM teardown --------------------------------------------
        if let Some(global) = global_object {
            // `JSGlobalObject` is an opaque ZST handle; `opaque_ref` is the
            // centralised non-null deref proof (JSC VM still alive here).
            WebWorker__teardownJSCVM(JSGlobalObject::opaque_ref(global));
        }

        live_workers::unlink(self);

        // ---- 4. Post close task to parent ----------------------------------
        // `cpp_worker` is the opaque C++-owned handle (snapshot taken above).
        WebWorker__dispatchExit(cpp_worker, exit_code);
        // `this` may be freed past this point.
        live_workers::mark_exited();

        // ---- 5. Free worker-thread resources -------------------------------
        if let Some(loop_) = loop_ {
            // SAFETY: loop owned by this thread's VM; no concurrent access.
            unsafe { (*loop_).internal_loop_data.jsc_vm = core::ptr::null_mut() };
        }
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr valid; sole owner.
            // Must precede Loop.shutdown so uv_close isn't called twice on the
            // GC timer.
            unsafe { (*vm_ptr).gc_controller.deinit() };
        }
        #[cfg(windows)]
        {
            // Per-thread libuv loop teardown; closes any handles still open on
            // this worker's loop and drops the thread-local pointer.
            bun_sys::windows::libuv::Loop::shutdown();
        }
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr valid; sole owner. `destroy()` is the port of
            // Zig `vm.deinit()`.
            unsafe { (*vm_ptr).destroy() };
            // Reclaim the boxes that Zig bulk-freed via `arena.deinit()`
            // (web_worker.zig:515) but the Rust port allocated on the global
            // heap in `VirtualMachine::init` — `destroy()` only deinits the
            // fields, not the box storage. Worker `init_worker` always passes
            // `log: None`, so the log box is VM-owned here.
            // SAFETY: sole owner; nothing past this point dereferences the VM.
            unsafe {
                let console = core::mem::replace(&mut (*vm_ptr).console, core::ptr::null_mut());
                if !console.is_null() {
                    bun_core::heap::destroy(console);
                }
                if let Some(log) = (*vm_ptr).log.take() {
                    bun_core::heap::destroy(log.as_ptr());
                }
                virtual_machine::VMHolder::set_vm(None);
                // The VM was `alloc_zeroed(Layout::<VirtualMachine>())` in
                // `init`, NOT `Box::new` — dealloc the raw storage directly so
                // field `Drop`s do not re-run on already-`deinit`'d state.
                std::alloc::dealloc(
                    vm_ptr.cast::<u8>(),
                    core::alloc::Layout::new::<VirtualMachine>(),
                );
            }
        }
        // Reclaim the cloned env (loader borrows `*map` — drop loader first).
        // In Zig both lived on the worker arena and were bulk-freed below;
        // here they were `heap::alloc`'d in `start_vm()` (see field doc).
        if !env_loader.is_null() {
            // SAFETY: `heap::alloc`'d in `start_vm`; sole owner; the VM is
            // gone so its raw `transpiler.env` borrow is dead.
            drop(unsafe { bun_core::heap::take(env_loader) });
        }
        if !env_map.is_null() {
            // SAFETY: `heap::alloc`'d in `start_vm`; sole owner.
            drop(unsafe { bun_core::heap::take(env_map) });
        }
        bun_core::delete_all_pools_for_thread_exit();
        bun_uws::on_thread_exit();
        drop(arena.take());
    }

    pub fn exit(&self) {
        self.exit_called.store(true, Ordering::Relaxed);
        let _ = self.set_requested_terminate();
        let vm_ptr = self.vm_ptr();
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr non-null; jsc_vm is a valid JSC::VM*;
            // notify_need_termination is documented thread-safe (VMTraps).
            // Cast through the real opaque `crate::VM`.
            unsafe { (*(*vm_ptr).jsc_vm.cast_const()).notify_need_termination() };
        }
    }

    // =========================================================================
    // Helpers (worker thread)
    // =========================================================================

    fn set_status(&self, status: Status) {
        log!(
            "[{}] status: {}",
            self.execution_context_id,
            <&'static str>::from(status)
        );
        self.status.set(status);
    }

    fn flush_logs(&self, vm: &VirtualMachine) {
        jsc::mark_binding();
        let vm_log = vm.log_ref().unwrap();
        if vm_log.msgs.is_empty() {
            return;
        }
        let global = vm.global();
        let result: jsc::JsResult<(JSValue, BunString)> = (|| {
            let err = vm_log.to_js(global, "Error in worker")?;
            let str = err.to_bun_string(global)?;
            Ok((err, str))
        })();
        let (err, str) = match result {
            Ok(pair) => pair,
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(JsError::Thrown | JsError::Terminated) => panic!("unhandled exception"),
        };
        let mut str = bun_core::OwnedString::new(str);
        let dispatch = jsc::host_fn::from_js_host_call_generic(global, || {
            // `cpp_worker` is the opaque C++-owned handle; `str` reffed for the call.
            WebWorker__dispatchError(global, self.cpp_worker, &mut str, err)
        });
        if let Err(e) = dispatch {
            // Spec web_worker.zig:810 — `.asException(..).?`: `take_exception`
            // on a `JsError` always returns an Exception cell; None is
            // unreachable. Do not silently drop the error.
            let exc = global
                .take_exception(e)
                .as_exception(global.vm().as_mut_ptr())
                .expect("takeException returned non-Exception");
            // `Exception` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
            // centralised non-null-ZST deref proof (`exc` is non-null per the
            // `expect` above).
            let _ = jsc::js_global_object::report_uncaught_exception(
                global,
                jsc::Exception::opaque_ref(exc),
            );
        }
    }
}

fn on_unhandled_rejection(
    vm: &mut VirtualMachine,
    global_object: &JSGlobalObject,
    error_instance_or_exception: JSValue,
) {
    // Prevent recursion
    vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;

    let mut error_instance = error_instance_or_exception
        .to_error()
        .unwrap_or(error_instance_or_exception);

    let mut array: Vec<u8> = Vec::new();

    // `worker_ref()` is the safe BACKREF accessor — `vm.worker` points at the
    // heap `WebWorker` owned by C++ that outlives `vm`. `&WebWorker` (not
    // `&mut`) — see worker-thread `&self` note.
    let worker = vm.worker_ref().expect("Assertion failure: no worker");

    let format_result = jsc::console_object::format2(
        jsc::console_object::MessageLevel::Debug,
        global_object,
        &[error_instance],
        &mut array,
        jsc::console_object::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            max_depth: 32,
            ..Default::default()
        },
    );
    if let Err(err) = format_result {
        match err {
            JsError::Thrown | JsError::Terminated => {}
            JsError::OutOfMemory => {
                let _ = global_object.throw_out_of_memory();
            }
        }
        error_instance = global_object.try_take_exception().unwrap();
    }
    // PORT NOTE: Zig's `writer.flush()` — `Vec<u8>` writer is unbuffered, so
    // there is nothing to flush; the `bun.outOfMemory()` arm is unreachable.
    jsc::mark_binding();
    let mut error_message = bun_core::OwnedString::new(BunString::clone_utf8(&array));
    if jsc::host_fn::from_js_host_call_generic(global_object, || {
        // `cpp_worker` is the opaque C++-owned handle round-tripped via `safe fn`.
        WebWorker__dispatchError(
            global_object,
            worker.cpp_worker,
            &mut error_message,
            error_instance,
        );
    })
    .is_err()
    {
        let _ = global_object.try_take_exception();
    }
    let _ = worker.set_requested_terminate();
    vm.jsc_vm().notify_need_termination();
}

/// Resolve a worker entry-point specifier to a path the module loader can
/// consume. The returned slice is BORROWED — it aliases `str`, the
/// standalone module graph, or the resolver's arena; the caller must NOT
/// free it.
///
/// # Safety
/// `parent` must point at a live `VirtualMachine`. Passed as a raw pointer
/// (not `&mut`) because when called from `spin()` the WORKER's VM has already
/// been published under `vm_lock`; the parent / main thread may concurrently
/// dereference the same allocation in `notify_need_termination` /
/// `terminate_all_and_wait` (`(*vm_ptr).jsc_vm`, `(*vm_ptr).event_loop()`).
/// A live `&mut VirtualMachine` here would be aliased-&mut UB. Per-use
/// `(*parent)` derefs keep any autoref scoped to the single expression — the
/// same pattern `spin()` uses post-publish.
unsafe fn resolve_entry_point_specifier<'s>(
    parent: *mut VirtualMachine,
    str: &'s [u8],
    error_message: &mut BunString,
    log: &mut bun_ast::Log,
) -> Option<&'s [u8]> {
    // SAFETY: per fn contract; read-only field.
    if let Some(graph) = unsafe { (*parent).standalone_module_graph } {
        if graph.find(str).is_some() {
            return Some(str);
        }

        if str.starts_with(b"./") || str.starts_with(b"../") {
            'try_from_extension: {
                let mut pathbuf = bun_paths::path_buffer_pool::get();
                let base_path = graph.base_public_path_with_default_suffix();
                let base = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Loose>(
                    base_path,
                    &mut pathbuf[..],
                    &[str],
                );
                let base_len = base.len();
                let extname_len = bun_paths::extension(base).len();
                // PORT NOTE: reshaped for borrowck — Zig held `extname` as a
                // sub-slice of `pathbuf` while writing into `pathbuf`. Compare
                // by re-slicing after dropping the mutable borrow.
                let extname = &pathbuf[base_len - extname_len..base_len];

                // ./foo -> ./foo.js
                if extname.is_empty() {
                    pathbuf[base_len..base_len + 3].copy_from_slice(b".js");
                    if let Some(js_file) = graph.find(&pathbuf[0..base_len + 3]) {
                        return Some(js_file);
                    }
                    break 'try_from_extension;
                }

                // ./foo.ts -> ./foo.js
                if extname == b".ts" {
                    pathbuf[base_len - 3..base_len].copy_from_slice(b".js");
                    if let Some(js_file) = graph.find(&pathbuf[0..base_len]) {
                        return Some(js_file);
                    }
                    break 'try_from_extension;
                }

                if extname.len() == 4 {
                    const EXTS: [&[u8]; 6] = [b".tsx", b".jsx", b".mjs", b".mts", b".cts", b".cjs"];
                    for ext in EXTS {
                        if extname == ext {
                            let js_len = b".js".len();
                            pathbuf[base_len - ext.len()..base_len - ext.len() + js_len]
                                .copy_from_slice(b".js");
                            let as_js = &pathbuf[0..base_len - ext.len() + js_len];
                            if let Some(js_file) = graph.find(as_js) {
                                return Some(js_file);
                            }
                            break 'try_from_extension;
                        }
                    }
                }
            }
        }
    }

    const BLOB_SPECIFIER_LEN: usize = b"blob:".len() + crate::uuid::UUID::STRING_LENGTH;
    if str.len() >= BLOB_SPECIFIER_LEN && str.starts_with(b"blob:") {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        if (hooks.has_blob_url)(&str[b"blob:".len()..]) {
            return Some(str);
        } else {
            *error_message = BunString::static_(b"Blob URL is missing");
            return None;
        }
    }

    // SAFETY: per fn contract; `global` is a read-only field, and the resolver
    // (`transpiler`) is mutated only on `parent`'s owning thread — both call
    // sites (`create()` on the parent thread, `spin()` on the worker thread)
    // satisfy that. The cross-thread readers under `vm_lock` never touch
    // `transpiler`.
    let global = unsafe { (*parent).global };
    // SAFETY: same as above — `parent`'s `transpiler` is mutated only on its
    // owning thread (the caller's thread per fn contract).
    let resolved_entry_point = match unsafe { (*parent).transpiler.resolve_entry_point(str) } {
        Ok(r) => r,
        Err(_) => {
            // `global` valid for VM lifetime; safe ZST-handle deref (panics on null).
            let global = JSGlobalObject::opaque_ref(global);
            let out: jsc::JsResult<BunString> = (|| {
                let out = log.to_js(global, "Error resolving Worker entry point")?;
                out.to_bun_string(global)
            })();
            match out {
                Ok(out) => {
                    *error_message = out;
                    return None;
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(JsError::Thrown | JsError::Terminated) => {
                    *error_message = BunString::static_(b"unexpected exception");
                    return None;
                }
            }
        }
    };

    match resolved_entry_point.path_const() {
        Some(entry_path) => Some(entry_path.text),
        None => {
            *error_message = BunString::static_(b"Worker entry point is missing");
            None
        }
    }
}

// ported from: src/jsc/web_worker.zig
