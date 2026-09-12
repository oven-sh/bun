//! The thread that runs a Worker's global scope.
//!
//! One `WebWorker` per worker thread. It is atomically refcounted and does not
//! belong to either side alone:
//!
//!   - the C++ `WorkerMessagingProxy` (the parent<->worker relationship object,
//!     see WorkerMessagingProxy.h) holds one ref from `create()` until it has
//!     joined the thread (`releaseWorkerThread()`), and
//!   - the running thread holds one for the whole of `thread_main`.
//!
//! `proxy` points back at the messaging proxy, which the thread also holds a
//! ref on, so it is valid for the thread's whole life. Everything the thread
//! wants to tell the parent goes through it by context id; nothing here ever
//! touches the parent's `Worker` object or a thread-affine ref.
//!
//! Thread lifecycle (`thread_main`):
//!   1. `start_vm()`  — arena, env snapshot, `VirtualMachine`, publish its handle (`vm_handle`).
//!   2. `spin()`      — 'online', load the entry point, `workerGlobalScopeStarted`, run the
//!                      event loop until it drains or termination is requested,
//!                      `beforeExit` on a natural drain.
//!   3. `shutdown()`  — 'exit' handlers, stop phase, join own children, JSC VM
//!                      teardown, free per-thread state, `workerGlobalScopeDestroyed`.
//!   Then the thread drops its self-ref and returns; the parent joins it.
//!
//! Children: every worker created on a thread is registered on that thread's
//! `VirtualMachine.child_workers` (parent thread only). When a thread exits —
//! the main thread in `global_exit`, a worker in `shutdown()` — its stop phase
//! has already asked each child to terminate; it then joins each child and
//! performs the parent-side release itself (`parentContextWillDestroy`). This
//! is Node's `stop_sub_worker_contexts()`; there is no process-global list.
//!
//! Threads: everything the worker thread needs from its parent VM (transform
//! options, an env snapshot, the standalone graph) is copied on the parent
//! thread in `create()`, and the thread holds a `Ticket` on the parent for its
//! whole life, so the parent cannot be destroyed under it. The parent (or an
//! exiting ancestor) reaches the worker's VM only through `vm_handle` — the
//! worker VM's uncounted handle, published once the VM exists — never through
//! a pointer to it.

use crate::JsCell;
use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use bun_core::{EncodedSlice, String as BunString, WTFStringImpl};
use bun_io::KeepAlive;

use crate::virtual_machine::{self, VirtualMachine, runtime_hooks};
use crate::{self as jsc, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsError, LogJsc};

bun_core::define_scoped_log!(log, Worker, hidden);

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct WebWorker {
    // ---- Immutable after `create()` (any thread) ----------------------------
    /// The C++ `WorkerMessagingProxy`; the thread holds a ref on it, so it is
    /// valid for as long as this thread runs. Opaque here.
    messaging_proxy: *mut c_void,
    /// The `VirtualMachine` of the thread that created this worker.
    /// **Parent thread only** (`child_workers`, `parent_poll_ref`); the worker
    /// thread never dereferences it — what it needs was copied below.
    parent: *mut VirtualMachine,
    /// The parent's `--hot` / `--watch` mode, inherited by the worker VM.
    hot_reload: crate::virtual_machine::HotReload,
    /// Whether the worker VM arms `bun_jsc::vm_handle`'s test gate (debug
    /// builds, `BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE`, first-level workers only:
    /// a nested worker parked on a post to its worker parent would keep that
    /// parent from ever reaching its own wait).
    arm_test_gate: bool,
    execution_context_id: u32,
    mini: bool,
    eval_mode: bool,
    /// Created by `node:worker_threads`' `Worker` (as opposed to the Web `Worker`
    /// constructor): loads `node:worker_threads` before preloads and the entry point.
    is_node_worker: bool,
    store_fd: bool,
    /// Borrowed from the proxy's `WorkerOptions` (alive as long as the proxy).
    argv_ptr: *const WTFStringImpl,
    argv_len: usize,
    exec_argv_ptr: *const WTFStringImpl,
    exec_argv_len: usize,
    inherit_exec_argv: bool,
    unresolved_specifier: Box<[u8]>,
    preloads: Vec<Box<[u8]>>,
    name: bun_core::ZBox,

    // ---- Cross-thread ----------------------------------------------------------
    ref_count: bun_ptr::ThreadSafeRefCount<WebWorker>,
    /// Set by the parent (`requestTermination`), by an exiting ancestor, or by
    /// the worker itself (`process.exit()`); polled by the worker loop between
    /// ticks and turned into a JSC TerminationException for running script.
    requested_terminate: AtomicBool,
    /// The worker VM's uncounted handle: how the parent (or an exiting
    /// ancestor) asks it to terminate. `None` before `start_vm()` publishes it
    /// and after `shutdown()` unpublishes it.
    vm_handle: bun_threading::Guarded<Option<crate::VmHandle>>,

    // ---- Parent-thread only ---------------------------------------------------
    /// Keep-alive on the parent's event loop: taken in `create()`, toggled by
    /// `.ref()`/`.unref()`, released when the parent releases the thread.
    parent_poll_ref: JsCell<KeepAlive>,
    /// Taken by the parent to join the OS thread.
    join_handle: JsCell<Option<JoinHandle<()>>>,

    // ---- Worker-thread only -----------------------------------------------------
    // Mutated only on the worker thread, but through `&self` because other
    // threads hold `&WebWorker` concurrently; hence the cells.
    /// The worker's `VirtualMachine`; null before `start_vm()` and after
    /// `shutdown()`.
    vm: Cell<*mut VirtualMachine>,
    status: Cell<Status>,
    // The VM's allocator IS this arena.
    arena: JsCell<Option<bun_alloc::Arena>>,
    /// Cloned env for the worker VM; boxed on the global heap because the arena
    /// does not run `Drop`. Reclaimed in `shutdown()`.
    worker_env_loader: Cell<*mut bun_dotenv::Loader>,
    /// `process.exit(code)` ran; later error paths must not overwrite its code.
    exit_called: AtomicBool,
    /// The parent asked this thread to stop (`worker.terminate()` or an exiting
    /// parent) while its VM was live — as opposed to the thread stopping itself,
    /// or being stopped before it started. Written under the `vm_handle` lock.
    terminated_by_parent: AtomicBool,
}

/// Copied from the parent VM on its thread at `new Worker()`; consumed by
/// `start_vm()` on the worker thread.
struct WorkerVmInit {
    transform_options: bun_options_types::schema::api::TransformOptions,
    env_loader: bun_dotenv::Loader,
    proxy_env_slots: jsc::rare_data::ProxyEnvSlots,
}

enum EntryOutcome {
    Continue,
    /// The entry module rejected and no handler took it: the worker exits.
    Stop,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Status {
    /// Thread not yet started / startVM in progress.
    Start,
    /// `spin()` has begun; entry point is loading.
    Starting,
    /// `workerGlobalScopeStarted` has fired; event loop is running.
    Running,
    /// `shutdown()` has begun; no further JS will run.
    Terminated,
}

// `JSGlobalObject` is an opaque FFI handle (ZST); it crosses FFI as `&`/`*const`
// even when C++ mutates through it. `proxy` is the opaque C++ `WorkerMessagingProxy*`
// round-tripped from `create()`; it is only ever handed back to C++.
unsafe extern "C" {
    safe fn WebWorker__workerThreadStarted(proxy: *mut c_void);
    safe fn WebWorker__workerGlobalScopeStarted(proxy: *mut c_void, global: &JSGlobalObject);
    safe fn WebWorker__workerGlobalScopeDestroyed(
        proxy: *mut c_void,
        exit_code: i32,
        stopped_by_parent: bool,
    );
    safe fn WebWorker__parentContextWillDestroy(proxy: *mut c_void);
    safe fn WebWorker__entrySettled(global: &JSGlobalObject);
    /// Loads `node:worker_threads` in this VM (it rebinds process stdio and
    /// registers parentPort). May leave an exception pending.
    safe fn Bun__Worker__loadNodeWorkerThreadsModule(global: &JSGlobalObject);
    safe fn WebWorker__dispatchError(
        global: &JSGlobalObject,
        proxy: *mut c_void,
        message: BunString,
        err: JSValue,
    );
    safe fn Bun__freeSharedHeaderBufferForThreadExit();
    // Raw FFI (no RAII guard) so `thread_main` can take the API lock and abandon
    // it with the VM — see the note there.
    safe fn JSC__VM__getAPILock(vm: &jsc::VM);
}

/// Node's `stop_sub_worker_contexts()`: the calling thread is exiting and its
/// stop phase has already asked every child to terminate. Join each one and do
/// the parent-side release the child's `workerGlobalScopeDestroyed` task would
/// have done (that task can no longer run: this context refuses new tasks).
/// Children created by a child are handled by that child's own `shutdown()`
/// before it can be joined, so this is transitively complete.
pub fn join_child_workers(parent: &mut VirtualMachine) {
    // `child_workers` is only touched on this (the parent) thread: `create()`
    // pushes, `release_parent_poll_ref()` removes, and this takes the rest.
    let children = core::mem::take(&mut parent.child_workers);
    for child in children {
        // SAFETY: registered children are live until the parent releases them
        // (the proxy's ref); this is that release.
        let messaging_proxy = unsafe { (*child).messaging_proxy };
        WebWorker__parentContextWillDestroy(messaging_proxy);
    }
}

/// The messaging proxy of the worker running on `vm`'s thread, or null on the
/// main thread. Used by the worker-side script bindings (parentPort.postMessage,
/// workerData, ...).
#[unsafe(no_mangle)]
extern "C" fn WebWorker__getMessagingProxy(vm: &VirtualMachine) -> *mut c_void {
    vm.worker_ref()
        .map(|w| w.messaging_proxy)
        .unwrap_or(core::ptr::null_mut())
}

impl Drop for WebWorker {
    fn drop(&mut self) {
        log!("[{}] destroy", self.execution_context_id);
        debug_assert!(
            self.join_handle.with_mut(|h| h.is_none()),
            "worker thread was never joined"
        );
    }
}

impl WebWorker {
    pub(crate) fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
    }

    /// Worker thread only.
    #[inline]
    fn vm_ptr(&self) -> *mut VirtualMachine {
        self.vm.get()
    }

    /// Closure-scoped `&mut KeepAlive` accessor for `parent_poll_ref`. The cell
    /// is touched only on the parent thread (`set_ref`,
    /// `release_parent_poll_ref`, `create`) so no lock is required; `JsCell`
    /// provides the interior mutability because `WebWorker` is shared `&self`
    /// across threads.
    #[inline]
    fn with_parent_poll_ref<R>(&self, f: impl FnOnce(&mut KeepAlive) -> R) -> R {
        self.parent_poll_ref.with_mut(f)
    }

    /// Whether this worker was started in eval mode (entry source is a
    /// string, not a file).
    #[inline]
    pub fn eval_mode(&self) -> bool {
        self.eval_mode
    }

    /// Borrowed from the C++ `WorkerOptions` (kept alive by the owning
    /// `WebCore::Worker`).
    #[inline]
    pub fn argv(&self) -> &[WTFStringImpl] {
        // SAFETY: `argv_ptr[..argv_len]` is borrowed from C++ WorkerOptions
        // (BACKREF — kept alive by the owning Worker for `self`'s lifetime).
        // `(null, 0)` is tolerated by `ffi::slice`.
        unsafe { bun_core::ffi::slice(self.argv_ptr, self.argv_len) }
    }

    /// `None` when
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

    /// Allocate the thread object (one ref, owned by the calling proxy), take a
    /// keep-alive on the parent event loop, register as a child of the parent VM,
    /// and spawn the thread. On any failure returns null with `error_message`
    /// set and nothing to clean up.
    #[unsafe(export_name = "WebWorker__create")]
    pub(crate) unsafe extern "C" fn create(
        proxy: *mut c_void,
        parent: *mut VirtualMachine,
        name_str: &BunString,
        specifier_str: &BunString,
        error_message: &mut BunString,
        _parent_context_id: u32,
        this_context_id: u32,
        mini: bool,
        default_unref: bool,
        eval_mode: bool,
        is_node_worker: bool,
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
        let mut temp_log = bun_ast::Log::default();
        // SAFETY: `parent` is the calling thread's live VM (BACKREF); borrows
        // are scoped to each statement.
        let prev_log = unsafe {
            let prev = (*parent).transpiler.log;
            (*parent).transpiler.set_log(&raw mut temp_log);
            prev
        };
        // RAII: log pointer restored and temp log dropped on every return path.
        let mut restore = scopeguard::guard(temp_log, move |log| {
            // SAFETY: `parent` outlives the guard (this call's frame).
            unsafe { (*parent).transpiler.set_log(prev_log) };
            drop(log);
        });
        let temp_log = &mut *restore;

        // SAFETY: caller passed valid (ptr,len) (or `(null,0)`); slice borrowed from C++.
        let preload_modules: &[BunString] =
            unsafe { bun_core::ffi::slice(preload_modules_ptr, preload_modules_len) };

        let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(preload_modules_len);
        for module in preload_modules {
            let utf8_slice = module.to_utf8();
            // node: builtin specifiers skip the file resolver — the worker-side
            // module loader resolves them.
            if utf8_slice.slice().starts_with(b"node:") {
                preloads.push(utf8_slice.slice().to_vec().into_boxed_slice());
                continue;
            }
            // SAFETY: `parent` is the live VM on the calling (parent) thread;
            // `resolve_entry_point_specifier` takes the raw pointer.
            if let Some(preload) = unsafe {
                resolve_entry_point_specifier(parent, utf8_slice.slice(), error_message, temp_log)
            } {
                preloads.push(preload.to_vec().into_boxed_slice());
            }

            if !error_message.is_empty() {
                // preloads dropped by RAII.
                return core::ptr::null_mut();
            }
        }

        // Everything the worker thread needs from this VM is copied here, on
        // its own thread; the worker never dereferences `parent`.
        // SAFETY: `parent` is the calling thread's live VM.
        let parent_ref = unsafe { &*parent };
        let store_fd = parent_ref.transpiler.resolver.store_fd;
        let mut transform_options = (*parent_ref.transpiler.options.transform_options).clone();
        if !inherit_exec_argv {
            let hooks = runtime_hooks().expect("RuntimeHooks not installed");
            // SAFETY: caller passed valid (ptr,len) borrowed from C++ WorkerOptions;
            // the hook only reads the slice.
            let parsed = unsafe {
                (hooks.parse_worker_exec_argv_flags)(bun_core::ffi::slice(
                    exec_argv_ptr,
                    exec_argv_len,
                ))
            };
            if let Some(flags) = parsed {
                let parent_allows_addons = transform_options.allow_addons.unwrap_or(true);
                transform_options.allow_addons = Some(parent_allows_addons && flags.allow_addons);
                let parent_allows_ffi_cc = transform_options.allow_ffi_cc.unwrap_or(true);
                transform_options.allow_ffi_cc = Some(parent_allows_ffi_cc && flags.allow_ffi_cc);
            }
        }
        // The worker's `process.env` starts as a copy of the parent's now (as in
        // Node). Proxy-env values may be RefCountedEnvValue bytes owned by the
        // parent's proxy_env_storage: snapshot slots + map under its lock so
        // every slice copied is backed by a ref the snapshot holds.
        let mut proxy_env_slots = jsc::rare_data::ProxyEnvSlots::default();
        let mut env_loader = {
            let parent_slots = parent_ref.proxy_env_storage.lock();
            proxy_env_slots.clone_from(&parent_slots);
            match parent_ref.env_loader().clone_for_worker() {
                Ok(loader) => loader,
                Err(_) => {
                    *error_message = BunString::static_("Out of memory");
                    return core::ptr::null_mut();
                }
            }
        };
        proxy_env_slots.sync_into(&mut env_loader.map);
        let init = WorkerVmInit {
            transform_options,
            env_loader,
            proxy_env_slots,
        };

        // The construction ref: handed to C++ on success, dropped on failure.
        let worker = bun_ptr::RefPtr::new(WebWorker {
            messaging_proxy: proxy,
            parent,
            hot_reload: parent_ref.hot_reload,
            arm_test_gate: cfg!(debug_assertions)
                && parent_ref.is_main_thread()
                && bun_core::env_var::feature_flag::BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE::get()
                    .unwrap_or(false),
            execution_context_id: this_context_id,
            mini,
            eval_mode,
            is_node_worker,
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
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            requested_terminate: AtomicBool::new(false),
            vm_handle: bun_threading::Guarded::new(None),
            vm: Cell::new(core::ptr::null_mut()),
            parent_poll_ref: JsCell::new(KeepAlive::init()),
            join_handle: JsCell::new(None),
            status: Cell::new(Status::Start),
            arena: JsCell::new(None),
            worker_env_loader: Cell::new(core::ptr::null_mut()),
            exit_called: AtomicBool::new(false),
            terminated_by_parent: AtomicBool::new(false),
        });
        let worker_ref = bun_ptr::ParentRef::from(worker.as_non_null());

        // Keep the parent's event loop alive until the parent releases this
        // thread, unless the user opted out with `{ ref: false }`.
        if !default_unref {
            // `bun_io::js_vm_ctx()` is this (the parent) thread's loop.
            worker_ref.with_parent_poll_ref(|p| p.ref_(bun_io::js_vm_ctx()));
        }

        // The thread's own ref, taken before it exists so it can never observe zero.
        let thread_ref = worker.clone();
        // The thread is something of this VM's on another thread for as long as
        // it runs: the parent joins it before its own teardown's wait, which
        // this ticket would otherwise hold.
        let parent_ticket = parent_ref.ticket();
        /// What the worker thread is handed: its refcounted `WebWorker` (the ref
        /// taken above is the thread's), the parent's snapshot, and a ticket on
        /// the parent VM.
        struct ThreadStart {
            worker: bun_ptr::RefPtr<WebWorker>,
            init: WorkerVmInit,
            _parent_ticket: crate::Ticket,
        }
        // SAFETY: `WebWorker` is shared across threads by design (atomics,
        // `Guarded`, thread-confined cells — see the struct doc) and holds no
        // parent-VM state; `init` is an owned copy — byte buffers, scalars and
        // `Arc<RefCountedEnvValue>`s, no JSC or atom strings; the parent VM
        // itself is kept by `_parent_ticket`.
        unsafe impl Send for ThreadStart {}
        let start = ThreadStart {
            worker: thread_ref,
            init,
            _parent_ticket: parent_ticket,
        };
        let spawn = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || {
                let start = start;
                start.worker.thread_main(start.init);
                // The thread's ref (and the parent ticket) drop here.
            });
        match spawn {
            Ok(handle) => {
                worker_ref.join_handle.set(Some(handle));
                let worker = worker.into_raw();
                // SAFETY: `parent` is the calling thread's VM; parent-thread-only list.
                unsafe { (*parent).child_workers.push(worker) };
                worker
            }
            Err(_) => {
                // The thread's ref went down with the closure; ours drops on return.
                worker_ref.with_parent_poll_ref(|p| p.unref(bun_io::js_vm_ctx()));
                *error_message = BunString::static_("Failed to spawn worker thread");
                core::ptr::null_mut()
            }
        }
    }

    /// Drop one ref; the last one frees the allocation (`Drop` below). Any thread.
    ///
    /// # Safety
    /// `this` came from `create()` and the caller owns one ref on it.
    #[unsafe(export_name = "WebWorker__deref")]
    pub(crate) unsafe extern "C" fn deref(this: *mut WebWorker) {
        // SAFETY: fn contract.
        unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this) };
    }

    /// Block until the OS thread has returned. Parent thread; the worker has
    /// either reported `workerGlobalScopeDestroyed` or been asked to terminate
    /// by an exiting parent. Termination interrupts script, not a native call
    /// the worker is blocked in, so this waits as long as that call does (as
    /// Node's JoinThread does).
    #[unsafe(export_name = "WebWorker__join")]
    pub(crate) extern "C" fn join(this: *mut WebWorker) {
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        if let Some(handle) = this.join_handle.with_mut(Option::take) {
            log!("[{}] join", this.execution_context_id);
            // A panic on the worker thread has already been reported by the panic
            // hook; the join result carries nothing further.
            let _ = handle.join();
        }
    }

    // =========================================================================
    // Parent-thread API (called from C++ via JS)
    // =========================================================================

    /// worker.ref()/.unref(). Parent thread; the proxy holds a ref on `this`
    /// and gates out calls once the keep-alive has been released.
    #[unsafe(export_name = "WebWorker__setRef")]
    pub(crate) extern "C" fn set_ref(this: *mut WebWorker, value: bool) {
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        this.with_parent_poll_ref(|poll| {
            if value {
                poll.ref_(bun_io::js_vm_ctx());
            } else {
                poll.unref(bun_io::js_vm_ctx());
            }
        });
    }

    /// Ask the thread to stop: set `requested_terminate`, raise a
    /// TerminationException in its VM at the next safepoint, wake its loop.
    /// Any thread that holds a ref (the proxy) may call this.
    #[unsafe(export_name = "WebWorker__requestTermination")]
    pub(crate) extern "C" fn request_termination(this: *mut WebWorker) {
        let this = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        // The handle's lock is taken *before* the flag is published: a worker
        // that breaks out of its loop because it saw the flag then blocks in
        // shutdown() (unpublish) until `terminated_by_parent` and the stop are
        // set here, instead of racing past with neither.
        let handle = this.vm_handle.lock();
        if this.set_requested_terminate() {
            return;
        }
        log!("[{}] requestTermination", this.execution_context_id);
        if let Some(handle) = &*handle {
            // Node: being stopped only counts (exit code 1) once the environment
            // exists and before the thread starts tearing it down on its own.
            this.terminated_by_parent.store(true, Ordering::Relaxed);
            // From now on the worker's native code enters no script and settles
            // no promises (Node's `ExitEnv` → `is_stopping`), even before its
            // thread notices; a TerminationException is raised at its next
            // safepoint and its loop woken.
            handle.request_termination();
        }
    }

    /// The parent is releasing this thread: drop the keep-alive on the parent's
    /// loop and forget it as a child. Parent thread.
    #[unsafe(export_name = "WebWorker__releaseParentPollRef")]
    pub(crate) extern "C" fn release_parent_poll_ref(this: *mut WebWorker) {
        let this_ref = bun_ptr::ParentRef::from(NonNull::new(this).expect("WebWorker FFI ptr"));
        this_ref.with_parent_poll_ref(|p| p.unref(bun_io::js_vm_ctx()));
        // SAFETY: parent thread; `parent` outlives its children (it joins them).
        let children = unsafe { &mut (*this_ref.parent).child_workers };
        if let Some(i) = children.iter().position(|&c| core::ptr::eq(c, this)) {
            children.swap_remove(i);
        }
    }

    #[inline]
    pub(crate) fn hot_reload(&self) -> crate::virtual_machine::HotReload {
        self.hot_reload
    }

    #[inline]
    pub(crate) fn arm_test_gate(&self) -> bool {
        self.arm_test_gate
    }

    #[inline]
    pub(crate) fn execution_context_id(&self) -> u32 {
        self.execution_context_id
    }

    /// The C++ `WorkerMessagingProxy`, handed to `Zig__GlobalObject__create` so
    /// the worker's global is born knowing its options (env, argv, workerData).
    #[inline]
    pub(crate) fn messaging_proxy(&self) -> *mut c_void {
        self.messaging_proxy
    }

    #[inline]
    pub(crate) fn mini(&self) -> bool {
        self.mini
    }

    // =========================================================================
    // Worker thread
    // =========================================================================

    // Worker-thread call chain takes `&self` (NOT `&mut self`): the parent /
    // main thread may concurrently hold `&WebWorker` (`request_termination`,
    // an exiting ancestor), so materialising `&mut WebWorker` here would
    // be aliased-&mut UB. Worker-thread-only mutable fields are wrapped in
    // `Cell` / `UnsafeCell` instead.
    fn thread_main(&self, init: WorkerVmInit) {
        bun_analytics::features::workers_spawned.fetch_add(1, Ordering::Relaxed);

        if !self.name.is_empty() {
            bun_core::output::Source::configure_named_thread(self.name.as_zstr());
        } else {
            bun_core::output::Source::configure_named_thread(bun_core::ZStr::from_static(
                b"Worker\0",
            ));
        }

        // Terminated before we even started — straight to shutdown so the
        // parent still gets its close event.
        if self.has_requested_terminate() {
            self.shutdown();
            return;
        }

        let vm_ptr = match self.start_vm(init) {
            Ok(vm) => vm,
            Err(err) => {
                bun_core::output::panic(format_args!(
                    "An unhandled error occurred while starting a worker: {}\n",
                    err.name()
                ));
            }
        };

        // `start_vm()` observed `requested_terminate` and already ran `shutdown()`.
        if vm_ptr.is_null() {
            return;
        }

        // `start_vm()` installed `vm_ptr` as this thread's per-thread VM
        // (`VirtualMachine::init` → `VMHolder`), so the safe thread-local
        // accessor returns the same allocation.
        debug_assert!(core::ptr::eq(vm_ptr, VirtualMachine::get_mut_ptr()));
        let global = VirtualMachine::get().global();
        // Take the API lock for the thread's whole life and abandon it with the
        // VM (`shutdown()` destroys the `JSC::VM`; there is nothing to unlock).
        // Raw FFI rather than the RAII guard, whose `&VM` would dangle.
        JSC__VM__getAPILock(global.vm());
        self.spin();
    }

    /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
    ///
    /// Returns the published VM pointer; `Ok(null)` means the early-terminate
    /// checkpoint already ran `shutdown()`.
    fn start_vm(&self, init: WorkerVmInit) -> Result<*mut VirtualMachine, crate::CrateError> {
        debug_assert!(self.status.get() == Status::Start);
        debug_assert!(self.vm_ptr().is_null());

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        let WorkerVmInit {
            transform_options,
            env_loader,
            proxy_env_slots,
        } = init;

        // worker-thread only field; no other thread reads `arena`.
        self.arena.set(Some(bun_alloc::Arena::new()));

        // `heap::alloc`'d and stashed on `self` so `shutdown()` step 5 reclaims
        // it on every path — including the early-terminate checkpoint below,
        // which calls `shutdown()` before the VM exists.
        let loader_ptr: *mut bun_dotenv::Loader = bun_core::heap::into_raw(Box::new(env_loader));
        self.worker_env_loader.set(loader_ptr);

        // Checkpoint before the expensive part: initWorker builds a full JSC
        // VM. If a parent's request_termination() fired while we were cloning the env
        // above, bail now rather than spending ~50–100ms (release) creating a
        // VM that will immediately tear down.
        if self.has_requested_terminate() {
            self.shutdown();
            return Ok(core::ptr::null_mut());
        }

        let vm = VirtualMachine::init_worker(
            self,
            virtual_machine::Options {
                args: transform_options,
                env_loader: NonNull::new(loader_ptr),
                store_fd: self.store_fd,
                graph: crate::virtual_machine::standalone_module_graph(),
                ..Default::default()
            },
        )?;
        // Scoped `&mut VirtualMachine` for the worker-specific fields; ends
        // before anything else on this thread re-derives access to the VM.
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

            *vm_ref.proxy_env_storage.lock() = proxy_env_slots;

            vm_ref.is_main_thread = false;
            VirtualMachine::set_is_main_thread_vm(false);
            vm_ref.on_unhandled_rejection = on_unhandled_rejection;
        }

        // Publish now (rather than at the end of startVM) so that:
        //   - a concurrent request_termination() (parent, or an exiting ancestor) can
        //     wake us once JS starts running, and
        //   - early returns below reach spin()/shutdown() with this.vm set,
        //     so teardownJSCVM/vm.deinit() run and the just-built JSC::VM
        //     heap is not leaked.
        // We do NOT call shutdown() directly from here: shutdown() with a
        // non-null vm runs vm.onExit() (JS), which requires holdAPILock.
        // Instead we return; threadMain enters holdAPILock(spin) and spin()'s
        // first check observes requested_terminate.
        self.vm.set(vm);
        // SAFETY: `vm` is the live VM just built on this thread.
        *self.vm_handle.lock() = Some(unsafe { (*vm).handle() });

        // SAFETY: `vm` is a valid heap-allocated VM ptr (checked above).
        unsafe {
            let b = &mut (*vm).transpiler;
            b.resolver.env_loader = NonNull::new(b.env);
            b.options.env.behavior =
                bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;

            if let Some(graph) = crate::virtual_machine::standalone_module_graph() {
                (hooks.apply_standalone_runtime_flags)(b, graph);
            }
        }

        // Second checkpoint: initWorker just spent the bulk of startup time;
        // if terminate arrived during it, skip configureDefines() (which
        // walks the resolver's global dir_cache) and entry-point loading.
        // spin() will observe the flag and shutdown() under the API lock.
        if self.has_requested_terminate() {
            return Ok(vm);
        }

        // SAFETY: this thread's live VM; per-expression derefs, no long-lived `&mut`.
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

    /// Phase 2: post 'online', load the entry point, run the event loop.
    /// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
    ///
    /// Returns `()` so the thread can unwind-free fall out of the
    /// `extern "C"` trampoline — see `shutdown`.
    fn spin(&self) {
        log!("[{}] spin start", self.execution_context_id);

        // vm set in start_vm; non-null past this point. Mutation goes through
        // `vm.as_mut()` which forms a fresh short-lived `&mut` per call (the
        // `JsCell` escape hatch — provenance from the thread-local `*mut`).
        let vm_ptr: *mut VirtualMachine = self.vm_ptr();
        // This IS the worker thread's per-thread VM (set by
        // `VirtualMachine::init` → `VMHolder`), so the safe thread-local
        // accessor returns the same allocation.
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

        // 'online' before the entry runs, as in node: it precedes anything the entry posts.
        WebWorker__workerThreadStarted(self.messaging_proxy);

        // `preloads` is owned by `self` (heap `WebWorker` outlives the VM).
        // `preload: Vec<Box<[u8]>>` — clone the boxes (cheap, ≤handful).
        vm.as_mut().preload.clone_from(&self.preloads);

        // Resolve the entry point on the worker thread (the parent only stored
        // the raw specifier). The returned slice is BORROWED — every exit from
        // spin() goes through shutdown() which is noreturn, so a `defer free`
        // here would never run anyway.
        let mut resolve_error = BunString::EMPTY;
        let vm_log = vm.log_mut().unwrap();
        // SAFETY: `vm_ptr` is the live worker-thread VM.
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
                self.flush_logs(vm);
                return self.shutdown();
            }
        };

        // Terminated while resolving — exit code 0, no error.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            return self.shutdown();
        }

        // Node runs its worker bootstrap (parentPort, stdio, process overrides)
        // ahead of user code; ours is node:worker_threads' module body.
        if self.is_node_worker {
            let global = vm.global();
            if let Err(err) = jsc::host_fn::from_js_host_call_generic(global, || {
                Bun__Worker__loadNodeWorkerThreadsModule(global)
            }) {
                let exception = global.take_exception(err);
                let _ = vm.as_mut().uncaught_exception(global, exception, false);
                if !self.exit_called.load(Ordering::Relaxed) {
                    vm.as_mut().exit_handler.exit_code = 1;
                }
                self.flush_logs(vm);
                WebWorker__entrySettled(global);
                return self.shutdown();
            }
        }

        // `path` borrows the resolver's process-lifetime string store, the
        // standalone module graph, or `self.unresolved_specifier` — all of
        // which outlive the worker VM. `vm.main` stores it as a raw BACKREF
        // (see `VirtualMachine::set_main`); no lifetime extension needed.
        let promise = match vm.as_mut().load_entry_point_for_web_worker(path) {
            Ok(p) => p,
            Err(_) => {
                // process.exit() may have run during load; don't clobber its code.
                if !self.exit_called.load(Ordering::Relaxed) {
                    vm.as_mut().exit_handler.exit_code = 1;
                }
                self.flush_logs(vm);
                WebWorker__entrySettled(vm.global());
                return self.shutdown();
            }
        };

        // Fire (and clear) the entryEvaluated hook on EVERY post-evaluation path
        // so buffered postMessageToThread deliveries drain and the sender's
        // Atomics.waitAsync settles. WebWorker__entrySettled re-calls it as a no-op.
        WebWorker__entrySettled(vm.global());

        // The entry's evaluation outcome is checked once now and then after every
        // loop turn: a rejection (immediate, or a top-level await rejecting
        // later) is the entry's uncaught error at that moment — the worker stops
        // unless a handler took it — and is reported exactly once. The loader
        // marks this promise handled, so nothing else would report it.
        let mut entry_rejection_seen = false;
        let mut observe_entry = |vm: &VirtualMachine| -> EntryOutcome {
            // SAFETY: `promise` is a live JSC heap cell, rooted below for the loop's duration.
            unsafe {
                if entry_rejection_seen || (*promise).status() != jsc::js_promise::Status::Rejected
                {
                    return EntryOutcome::Continue;
                }
                entry_rejection_seen = true;
                // Same rule as the main thread (run_command): a CJS worker
                // entry's top-level throw is an uncaughtException; only an
                // ESM entry rejection reports origin "unhandledRejection".
                let is_rejection = !vm.as_mut().entry_point_result.evaluated_as_cjs;
                let handled = vm.as_mut().uncaught_exception(
                    vm.global(),
                    (*promise).result(vm.jsc_vm()),
                    is_rejection,
                );
                if handled {
                    EntryOutcome::Continue
                } else {
                    EntryOutcome::Stop
                }
            }
        };
        if let EntryOutcome::Stop = observe_entry(vm) {
            // exit_code is already 1 from uncaught_exception; re-setting it here
            // would clobber a process.on('exit') change to process.exitCode.
            return self.shutdown();
        }
        // A still-pending entry promise is an unsettled top-level await: as in
        // Node the worker counts as started once its module graph is executing,
        // and the await continues in the normal event loop below — messages,
        // timers and I/O keep flowing meanwhile. Rooted for the loop's duration.
        let entry_promise = crate::Strong::create(
            JSValue::from_cell(promise.cast::<crate::JSCell>()),
            vm.global(),
        );

        self.flush_logs(vm);
        log!("[{}] event loop start", self.execution_context_id);
        // Pending -> Running: messages and tasks queued while the entry loaded are delivered.
        WebWorker__workerGlobalScopeStarted(self.messaging_proxy, vm.global());
        self.set_status(Status::Running);

        // don't run the GC if we don't actually need to
        if vm.standalone_module_graph.is_none()
            && (vm.is_event_loop_alive() || vm.event_loop_mut().tick_concurrent_with_count() > 0)
        {
            vm.global().vm().release_weak_refs();
            // `Arena = bumpalo::Bump` has no collect; global mimalloc
            // handles reclamation.
            let _ = vm.global().vm().run_gc(false);
        }

        // Always do a first tick so we call CppTask without delay after
        // workerGlobalScopeStarted.
        vm.as_mut().tick();
        let mut stopped_by_entry = matches!(observe_entry(vm), EntryOutcome::Stop);

        while !stopped_by_entry && vm.is_event_loop_alive() {
            vm.as_mut().tick();
            if self.has_requested_terminate() {
                break;
            }
            if let EntryOutcome::Stop = observe_entry(vm) {
                stopped_by_entry = true;
                break;
            }
            vm.as_mut().auto_tick_active();
            if self.has_requested_terminate() {
                break;
            }
            if let EntryOutcome::Stop = observe_entry(vm) {
                stopped_by_entry = true;
            }
        }

        log!(
            "[{}] before exit {}",
            self.execution_context_id,
            if self.has_requested_terminate() {
                "(terminated)"
            } else if stopped_by_entry {
                "(entry rejected)"
            } else {
                "(event loop dead)"
            }
        );

        if !self.has_requested_terminate() && !stopped_by_entry {
            // Only emit 'beforeExit' on a natural drain, not on terminate().
            // TODO: is this able to allow the event loop to continue?
            vm.as_mut().on_before_exit();
            // Drained with the entry still pending: an unsettled top-level await,
            // Node's exit 13 (unless the user chose a nonzero exit code).
            // SAFETY: rooted by `entry_promise`.
            if unsafe { (*promise).status() } == jsc::js_promise::Status::Pending
                && vm.exit_handler.exit_code == 0
            {
                vm.as_mut().exit_handler.exit_code = 13;
            }
        }
        drop(entry_promise);

        self.flush_logs(vm);
        self.shutdown();
    }

    /// Phase 3: unpublish the VM's handle (a racing `requestTermination` now
    /// finds none), run the user 'exit' handlers, then the shared
    /// [`VirtualMachine::teardown`] (stop → forbid script → ~VM → loops →
    /// destroy), free the thread's remaining state, and last of all report
    /// `workerGlobalScopeDestroyed` — the parent joins this thread from that
    /// task, so nothing after it may touch the parent.
    fn shutdown(&self) {
        jsc::mark_binding();
        self.set_status(Status::Terminated);
        bun_analytics::features::workers_terminated.fetch_add(1, Ordering::Relaxed);
        log!("[{}] shutdown", self.execution_context_id);

        // worker-thread only field; no other thread reads `arena`.
        let mut arena = self.arena.replace(None);
        let env_loader = self.worker_env_loader.replace(core::ptr::null_mut());

        // ---- 1. Unpublish vm ------------------------------------------------
        drop(self.vm_handle.lock().take());
        let vm_ptr = self.vm.replace(core::ptr::null_mut());

        // ---- 2. User exit handlers -----------------------------------------
        let mut exit_code: i32 = 0;
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr valid; no other thread holds a pointer to it (they
            // only ever held its handle) — `&mut` is exclusive.
            let vm = unsafe { &mut *vm_ptr };
            vm.is_shutting_down = true;
            vm.on_exit();
            exit_code = i32::from(vm.exit_handler.exit_code);
            log!(
                "[{}] shutdown: exit handlers done",
                self.execution_context_id
            );

            // ---- 3–5. Stop, forbid script, wait, ~VM, loops, destroy ----------
            // SAFETY: this thread's VM; sole owner.
            unsafe { VirtualMachine::teardown(vm_ptr, crate::virtual_machine::Teardown::Worker) };

            // `destroy()` deinits the fields; reclaim the storage `init` put on
            // the global heap (worker `init_worker` always passes `log: None`,
            // so the log box is VM-owned here).
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
        log!(
            "[{}] shutdown: VirtualMachine destroyed",
            self.execution_context_id
        );
        // Reclaim the cloned env (`heap::alloc`'d in `start_vm()`; see field doc).
        if !env_loader.is_null() {
            // SAFETY: `heap::alloc`'d in `start_vm`; sole owner; the VM is
            // gone so its raw `transpiler.env` borrow is dead.
            drop(unsafe { bun_core::heap::take(env_loader) });
        }
        // This thread's C++ thread_local destructors are not guaranteed to run
        // before the process exits, so free the HPACK scratch buffer that any
        // http2 session on this thread allocated.
        Bun__freeSharedHeaderBufferForThreadExit();
        drop(arena.take());
        log!(
            "[{}] shutdown: thread state freed",
            self.execution_context_id
        );

        // ---- 6. Report to the parent ------------------------------------------
        // The parent joins this thread from that task, so it must be the last
        // thing here; the thread then returns normally (never `pthread_exit`:
        // its forced unwind would cross `extern "C"` frames and abort).
        // A worker stopped by its parent that never called process.exit() did
        // not choose `exit_code`; the proxy decides what that reads as per kind.
        WebWorker__workerGlobalScopeDestroyed(
            self.messaging_proxy,
            exit_code,
            self.stopped_by_parent(),
        );
    }

    /// worker.terminate() from the parent, and the worker did not also exit on
    /// its own (process.exit / uncaught error) — Node's "stopped" case: no exit
    /// handlers run and the exit code was not the worker's choice.
    pub fn stopped_by_parent(&self) -> bool {
        self.terminated_by_parent.load(Ordering::Relaxed)
            && !self.exit_called.load(Ordering::Relaxed)
    }

    /// process.exit() inside the worker. Worker-thread only.
    ///
    /// Takes `&self` (not `&mut self`) because `request_termination` /
    /// other threads may concurrently hold `&WebWorker` on another
    /// thread; producing `&mut` here would be aliased-&mut UB.
    pub fn exit(&self) {
        self.exit_called.store(true, Ordering::Relaxed);
        let _ = self.set_requested_terminate();
        // Stop subsequent JS at the next safepoint. `this.vm` is null during
        // `vm.onExit()` (shutdown nulls it first), so a re-entrant
        // process.exit() from an exit handler does not re-arm the trap.
        let vm_ptr = self.vm_ptr();
        if !vm_ptr.is_null() {
            // From an immediate this runs before the turn's poll; the wake is what ends it.
            // SAFETY: this thread's live VM.
            unsafe { (*vm_ptr).handle_ref().request_termination() };
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

    /// Report the VM log (entry resolution / load errors) to the parent as the
    /// worker's 'error' event. Nothing is reported once the worker is being
    /// stopped: the parent asked for exactly that, and building the error
    /// object would run into the pending termination.
    fn flush_logs(&self, vm: &VirtualMachine) {
        jsc::mark_binding();
        let vm_log = vm.log_ref().unwrap();
        if vm_log.msgs.is_empty() || !vm.script_allowed() {
            return;
        }
        let global = vm.global();
        let result: jsc::JsResult<(JSValue, BunString)> = (|| {
            let err = vm_log.to_js(global, format_args!("Error in worker"))?;
            let str = err.to_bun_string(global)?;
            Ok((err, str))
        })();
        let (err, str) = match result {
            Ok(pair) => pair,
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(err) => {
                // The worker's start sequence is its outermost frame: building the error from the
                // log threw, and that is reported here instead (a termination just stands down).
                let _ = crate::task::report_error_or_terminate(global, err);
                return;
            }
        };
        let dispatch = jsc::host_fn::from_js_host_call_generic(global, || {
            WebWorker__dispatchError(global, self.messaging_proxy, str, err)
        });
        if let Err(e) = dispatch {
            let _ = crate::task::report_error_or_terminate(global, e);
        }
    }
}

fn on_unhandled_rejection(
    vm: &mut VirtualMachine,
    _: &JSGlobalObject,
    error_instance_or_exception: JSValue,
) {
    // Prevent recursion
    vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;

    // The stop was already requested (terminate(), or the worker's own exit):
    // whatever rejects or throws from here on is a consequence of stopping —
    // a cancelled lookup, an aborted request — and is not the worker's error
    // to report. Node: terminate() wins; no 'error' event.
    if !vm.script_allowed() {
        return;
    }

    // Not the realm the error was raised in: that may be a node:vm context.
    let global_object = vm.global();

    let mut error_instance = error_instance_or_exception
        .to_error()
        .unwrap_or(error_instance_or_exception);

    // A parse failure rejects with a BuildMessage, which doesn't survive structured
    // clone. Node reports a SyntaxError; build a real one from the formatted parse
    // error so the subtype reaches the parent intact.
    if let Some(bm) = error_instance.as_::<crate::BuildMessage>() {
        // SAFETY: as_ returned a live BuildMessage cell, read-only on the
        // worker (JS) thread that owns it.
        let text: &[u8] = unsafe { &(*bm).msg.data.text };
        error_instance = EncodedSlice::utf8(text).to_syntax_error_instance(global_object);
    }

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
        error_instance = global_object.take_exception(err);
    }
    // Formatting ran script; if this worker was terminated meanwhile there is no error to dispatch.
    if error_instance.is_termination_exception() {
        return;
    }
    jsc::mark_binding();
    // We RETURN through
    // the live C++ frames after dispatching (see the note below), so the
    // simulated throw of the C++ `DECLARE_THROW_SCOPE` inside
    // `SerializedScriptValue::create` (reached via `dispatchErrorWithValue`) must
    // be checked before unwinding, or the next `TopExceptionScope` ctor on the
    // stack — `performMicrotaskCheckpoint` / NodeTimerObject `call()` — trips
    // `verifyExceptionCheckNeedIsSatisfied`. Wrap in `from_js_host_call_generic`
    // (declares + checks a TopExceptionScope around the FFI call, same as
    // `flush_logs` above) and discard any actual exception: we are already the
    // last-resort error handler and about to arm termination.
    let error_message = BunString::clone_utf8(&array);
    if jsc::host_fn::from_js_host_call_generic(global_object, || {
        WebWorker__dispatchError(
            global_object,
            worker.messaging_proxy,
            error_message,
            error_instance,
        );
    })
    .is_err()
    {
        let _ = global_object.try_take_exception();
    }
    // node runs the worker's process 'exit' handlers on an uncaught exception (code 1;
    // they may change process.exitCode). Run them before arming termination — a pending
    // termination exception makes dispatchExitInternal skip 'exit' (as terminate() should),
    // and its processIsExiting guard stops shutdown() from running them twice.
    virtual_machine::ExitHandler::dispatch_on_exit(vm);
    let _ = worker.set_requested_terminate();
    // Do NOT call `worker.shutdown()` here —
    // `shutdown()` RETURNS, so calling it here would destroy
    // the `JSC::VM`, free the Bun `VirtualMachine` + arena, and report
    // `workerGlobalScopeDestroyed`, then return through
    // `VirtualMachine::uncaught_exception` (which writes
    // `is_handling_uncaught_exception = false` on the freed VM), through live
    // JSC C++ frames operating on a destroyed `JSC::VM`, and back into
    // `spin()` which dereferences the freed `*vm` and calls `shutdown()` a
    // second time (a second `workerGlobalScopeDestroyed` → double deref of
    // the proxy's thread-held reference).
    //
    // Instead, request the stop as `exit()` does and unwind to `spin()`'s `shutdown()`.
    vm.handle_ref().request_termination();
}

/// Resolve a worker entry-point specifier to a path the module loader can
/// consume. The returned slice is BORROWED — it aliases `str`, the
/// standalone module graph, or the resolver's arena; the caller must NOT
/// free it.
///
/// # Safety
/// `parent` must point at this thread's live `VirtualMachine`. Passed as a raw
/// pointer (not `&mut`) because callers hold other borrows into the VM (its
/// log) across the call; per-use `(*parent)` derefs keep any autoref scoped to
/// the single expression.
unsafe fn resolve_entry_point_specifier<'s>(
    parent: *mut VirtualMachine,
    str: &'s [u8],
    error_message: &mut BunString,
    log: &mut bun_ast::Log,
) -> Option<&'s [u8]> {
    // In a `bun build --compile` executable, a relative specifier names an embedded entry point (relative to the
    // embedded root) before it names a file on disk, and an absolute one may be an embedded path in either syntax
    // (`new URL("./w.ts", import.meta.url)`).
    // SAFETY: per fn contract; `standalone_module_graph` is a read-only field.
    if let Some(graph) = unsafe { (*parent).standalone_module_graph }
        && let Some(name) = graph.resolve(graph.base_public_path_with_default_suffix(), str)
    {
        return Some(name);
    }

    // A `data:` URL is the module itself (the loader decodes it); it never names
    // a path, so it must not go through path resolution (long ones would fail
    // with ENAMETOOLONG there).
    if str.starts_with(b"data:") {
        return Some(str);
    }

    // Spec `bun.webcore.ObjectURLRegistry.isBlobURL(str)` — prefix `"blob:"`
    // AND `len >= specifier_len` (`"blob:".len + UUID.stringLength = 41`).
    // A short `"blob:foo"` must fall through to the resolver below, not enter
    // this arm and report "Blob URL is missing".
    const BLOB_SPECIFIER_LEN: usize = b"blob:".len() + crate::uuid::UUID::STRING_LENGTH;
    if str.len() >= BLOB_SPECIFIER_LEN && str.starts_with(b"blob:") {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        if (hooks.has_blob_url)(&str[b"blob:".len()..]) {
            return Some(str);
        } else {
            *error_message = BunString::static_("Blob URL is missing");
            return None;
        }
    }

    // SAFETY: per fn contract; `global` is a read-only field, and the resolver
    // (`transpiler`) is mutated only on `parent`'s owning thread — both call
    // sites (`create()` on the parent thread, `spin()` on the worker thread)
    // satisfy that.
    let global = unsafe { (*parent).global };
    // SAFETY: same as above — `parent`'s `transpiler` is mutated only on its
    // owning thread (the caller's thread per fn contract).
    let resolved_entry_point = match unsafe { (*parent).transpiler.resolve_entry_point(str) } {
        Ok(r) => r,
        Err(_) => {
            // `global` valid for VM lifetime; safe ZST-handle deref (panics on null).
            let global = JSGlobalObject::opaque_ref(global);
            let out: jsc::JsResult<BunString> = (|| {
                let out = log.to_js(global, format_args!("Error resolving Worker entry point"))?;
                out.to_bun_string(global)
            })();
            match out {
                Ok(out) => {
                    *error_message = out;
                    return None;
                }
                Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(JsError::Thrown | JsError::Terminated) => {
                    *error_message = BunString::static_("unexpected exception");
                    return None;
                }
            }
        }
    };

    // `Path::text` borrows the resolver's process-lifetime `dirname_store` /
    // `filename_store` (`Path<'static>`), NOT `resolved_entry_point` itself —
    // copy the slice out and let `resolved_entry_point` drop on the stack.
    Some(
        resolved_entry_point
            .path_const()
            .expect("resolve_entry_point rejects disabled results")
            .text,
    )
}
