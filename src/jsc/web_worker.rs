//! The thread that runs a Worker's global scope.
//!
//! One `WebWorker` per worker thread, shared (`Arc`) between:
//!
//!   - the C++ `WorkerMessagingProxy` (the parent<->worker relationship object,
//!     see WorkerMessagingProxy.h), which is handed a pointer by `create()` and
//!     keeps it until it has joined the thread (`releaseWorkerThread()` →
//!     `WebWorker__deref`); the ref backing that pointer is [`WebWorker::cpp_ref`],
//!   - the running thread, which owns one for the whole of `thread_main`, and
//!   - the parent VM's `child_workers` list while the worker is registered.
//!
//! `proxy` points back at the messaging proxy, which the thread also holds a
//! ref on, so it is valid for the thread's whole life. Everything the thread
//! wants to tell the parent goes through it by context id; nothing here ever
//! touches the parent's `Worker` object or a thread-affine ref.
//!
//! Thread lifecycle (`thread_main`):
//!   1. `start_vm()`  — arena, env snapshot, `VirtualMachine`, publish its handle (`vm_handle`).
//!   2. `spin()`      — load the entry point, `workerGlobalScopeStarted`, run the
//!                      event loop until it drains or termination is requested,
//!                      `beforeExit` on a natural drain.
//!   3. `shutdown()`  — 'exit' handlers, stop phase, join own children, JSC VM
//!                      teardown, free per-thread state, `workerGlobalScopeDestroyed`.
//!   Then the thread drops its ref and returns; the parent joins it.
//!
//! Children: every worker created on a thread is registered on that thread's
//! `VirtualMachine.child_workers` (parent thread only). When a thread exits —
//! the main thread in `global_exit`, a worker in `shutdown()` — its stop phase
//! has already asked each child to terminate; it then joins each child and
//! performs the parent-side release itself (`parentContextWillDestroy`). This
//! is Node's `stop_sub_worker_contexts()`; there is no process-global list.
//!
//! Threads: everything the worker thread needs from its parent VM (transform
//! options, an env snapshot, the standalone graph, argv) is copied on the
//! parent thread in `create()`, and the thread holds a `Ticket` on the parent
//! for its whole life, so the parent cannot be destroyed under it. The parent
//! (or an exiting ancestor) reaches the worker's VM only through `vm_handle` —
//! the worker VM's uncounted handle, published once the VM exists — never
//! through a pointer to it.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use bun_core::{EncodedSlice, String as BunString, Utf8Bytes, strings};
use bun_io::KeepAlive;
use bun_ptr::{BackRef, ThreadBound};
use bun_threading::Guarded;

use crate::virtual_machine::{self, VirtualMachine, WorkerVm, runtime_hooks};
use crate::worker_messaging_proxy::WorkerMessagingProxy;
use crate::{self as jsc, EncodedSliceJsc as _, JSGlobalObject, JSPromise, JSValue, JsError, LogJsc};

bun_core::define_scoped_log!(log, Worker, hidden);

pub struct WebWorker {
    // ---- Immutable after `create()` (any thread) ----------------------------
    /// The C++ `WorkerMessagingProxy`; the thread holds a ref on it, so it
    /// outlives this object (the proxy drops the pointer to us before it drops
    /// that ref, see `releaseWorkerThread()`).
    proxy: BackRef<WorkerMessagingProxy>,
    /// The `VirtualMachine` of the thread that created this worker; only that
    /// thread follows it (`child_workers`, `parent_poll_ref`). What the worker
    /// thread needs was copied below.
    parent: ThreadBound<VirtualMachine>,
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
    argv: Box<[WorkerString]>,
    /// `None`: the worker inherits the parent's `execArgv`.
    exec_argv: Option<Box<[WorkerString]>>,
    unresolved_specifier: Box<[u8]>,
    preloads: Vec<Box<[u8]>>,
    name: bun_core::ZBox,

    // ---- Cross-thread ----------------------------------------------------------
    /// Set by the parent (`requestTermination`), by an exiting ancestor, or by
    /// the worker itself (`process.exit()`); polled by the worker loop between
    /// ticks and turned into a JSC TerminationException for running script.
    requested_terminate: AtomicBool,
    /// The worker VM's uncounted handle: how the parent (or an exiting
    /// ancestor) asks it to terminate. `None` before `start_vm()` publishes it
    /// and after `shutdown()` unpublishes it.
    vm_handle: Guarded<Option<crate::VmHandle>>,
    /// `process.exit(code)` ran; later error paths must not overwrite its code.
    exit_called: AtomicBool,
    /// The parent asked this thread to stop (`worker.terminate()` or an exiting
    /// parent) while its VM was live — as opposed to the thread stopping itself,
    /// or being stopped before it started. Written under the `vm_handle` lock.
    terminated_by_parent: AtomicBool,
    /// The ref behind the pointer `create()` returned to the C++ proxy
    /// (`m_workerThread`); released by `WebWorker__deref`.
    cpp_ref: Guarded<Option<Arc<WebWorker>>>,

    // ---- Parent-thread only ---------------------------------------------------
    /// Keep-alive on the parent's event loop: taken in `create()`, toggled by
    /// `.ref()`/`.unref()`, released when the parent releases the thread.
    parent_poll_ref: Guarded<KeepAlive>,
    /// Taken by the parent to join the OS thread.
    join_handle: Guarded<Option<JoinHandle<()>>>,
}

/// An `argv` / `execArgv` entry copied from the `WorkerOptions` in `create()`
/// in its original width, so the worker builds the same JS string from it.
pub enum WorkerString {
    Latin1(Box<[u8]>),
    Utf16(Box<[u16]>),
    Utf8(Box<[u8]>),
}

impl WorkerString {
    fn new(s: &BunString) -> WorkerString {
        if s.is_utf16() {
            WorkerString::Utf16(s.utf16().into())
        } else if s.is_utf8() {
            WorkerString::Utf8(s.byte_slice().into())
        } else {
            WorkerString::Latin1(s.latin1().into())
        }
    }

    /// A fresh JS-heap-independent string for the calling thread.
    pub fn to_bun_string(&self) -> BunString {
        match self {
            WorkerString::Latin1(b) if b.is_empty() => BunString::EMPTY,
            WorkerString::Utf16(w) if w.is_empty() => BunString::EMPTY,
            WorkerString::Utf8(b) if b.is_empty() => BunString::EMPTY,
            WorkerString::Latin1(b) => BunString::clone_latin1(b),
            WorkerString::Utf16(w) => BunString::clone_utf16(w),
            WorkerString::Utf8(b) => BunString::clone_utf8(b),
        }
    }

    pub fn to_utf8(&self) -> Utf8Bytes<'static> {
        match self {
            WorkerString::Latin1(b) => match strings::allocate_latin1_into_utf8(b) {
                Ok(v) => Utf8Bytes::Owned(v),
                Err(_) => bun_core::out_of_memory(),
            },
            WorkerString::Utf16(w) => Utf8Bytes::Owned(strings::to_utf8_alloc(w)),
            WorkerString::Utf8(b) => Utf8Bytes::Owned(b.to_vec()),
        }
    }
}

/// Copied from the parent VM on its thread at `new Worker()`; consumed by
/// `start_vm()` on the worker thread.
struct WorkerVmInit {
    transform_options: bun_options_types::schema::api::TransformOptions,
    env_loader: bun_dotenv::Loader,
    proxy_env_slots: jsc::rare_data::ProxyEnvSlots,
}

/// What only the worker thread touches, owned by `thread_main`'s frame.
struct WorkerThread {
    /// The worker's `VirtualMachine`; `None` before `start_vm()` and after
    /// `shutdown()`.
    vm: Option<WorkerVm>,
    status: Status,
    /// The VM's allocator IS this arena (`VirtualMachine.arena` points at it).
    arena: Option<Box<bun_alloc::Arena>>,
    /// Cloned env for the worker VM (`VirtualMachine.transpiler.env` points at
    /// it). Dropped in `shutdown()` after the VM.
    env_loader: Option<Box<bun_dotenv::Loader>>,
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

// `JSGlobalObject` is an opaque FFI handle (ZST); it crosses FFI as `&` even
// when C++ mutates through it.
unsafe extern "C" {
    safe fn WebWorker__entrySettled(global: &JSGlobalObject);
    /// Loads `node:worker_threads` in this VM (it rebinds process stdio and
    /// registers parentPort). May leave an exception pending.
    safe fn Bun__Worker__loadNodeWorkerThreadsModule(global: &JSGlobalObject);
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
        child.parent_context_will_destroy();
    }
}

/// The messaging proxy of the worker running on `vm`'s thread, or null on the
/// main thread. Used by the worker-side script bindings (parentPort.postMessage,
/// workerData, ...).
// HOST_EXPORT(WebWorker__getMessagingProxy, c)
pub fn get_messaging_proxy(
    vm: &VirtualMachine,
) -> *mut crate::worker_messaging_proxy::WorkerMessagingProxy {
    vm.worker_ref()
        .map(|w| w.messaging_proxy().as_mut_ptr())
        .unwrap_or(core::ptr::null_mut())
}

// =========================================================================
// Construction (parent thread)
// =========================================================================

/// Allocate the thread object (returning the pointer whose ref the calling
/// proxy owns), take a keep-alive on the parent event loop, register as a
/// child of the parent VM, and spawn the thread. On any failure returns
/// null with `error_message` set and nothing to clean up.
// HOST_EXPORT(WebWorker__create, c)
pub fn create(
    proxy: &crate::worker_messaging_proxy::WorkerMessagingProxy,
    parent: &mut VirtualMachine,
    name_str: &BunString,
    specifier_str: &BunString,
    error_message: &mut BunString,
    _parent_context_id: u32,
    this_context_id: u32,
    mini: bool,
    default_unref: bool,
    eval_mode: bool,
    is_node_worker: bool,
    argv: &[BunString],
    inherit_exec_argv: bool,
    exec_argv: &[BunString],
    preload_modules: &[BunString],
) -> *const crate::web_worker::WebWorker {
    jsc::mark_binding();
    log!("[{}] create", this_context_id);

    let spec_slice = specifier_str.to_utf8();

    let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(preload_modules.len());
    {
        let mut temp_log = bun_ast::Log::default();
        let prev_log = parent.transpiler.log;
        parent.transpiler.set_log(&raw mut temp_log);
        // RAII: log pointer restored on every return path.
        let mut parent = scopeguard::guard(&mut *parent, move |parent| {
            parent.transpiler.set_log(prev_log);
        });
        for module in preload_modules {
            let utf8_slice = module.to_utf8();
            // node: builtin specifiers skip the file resolver — the worker-side
            // module loader resolves them.
            if utf8_slice.slice().starts_with(b"node:") {
                preloads.push(utf8_slice.slice().to_vec().into_boxed_slice());
                continue;
            }
            if let Some(preload) = resolve_entry_point_specifier(
                &mut parent,
                utf8_slice.slice(),
                error_message,
                &mut temp_log,
            ) {
                preloads.push(preload.to_vec().into_boxed_slice());
            }

            if !error_message.is_empty() {
                return core::ptr::null();
            }
        }
    }

    // Everything the worker thread needs from this VM is copied here, on
    // its own thread; the worker never dereferences `parent`.
    let store_fd = parent.transpiler.resolver.store_fd;
    let mut transform_options = (*parent.transpiler.options.transform_options).clone();
    if !inherit_exec_argv {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        // `None` on parse failure keeps the parent's settings.
        if let Some(flags) = (hooks.parse_worker_exec_argv_flags)(exec_argv) {
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
        let parent_slots = parent.proxy_env_storage.lock();
        proxy_env_slots.clone_from(&parent_slots);
        match parent.env_loader().clone_for_worker() {
            Ok(loader) => loader,
            Err(_) => {
                *error_message = BunString::static_(b"Out of memory");
                return core::ptr::null();
            }
        }
    };
    proxy_env_slots.sync_into(&mut env_loader.map);
    let init = WorkerVmInit {
        transform_options,
        env_loader,
        proxy_env_slots,
    };

    let worker = Arc::new(WebWorker {
        // The proxy holds a ref on itself on this worker's behalf until it has
        // joined the thread and dropped its pointer to us (`releaseWorkerThread`).
        proxy: BackRef::new(proxy),
        // The parent VM joins every child (`join_child_workers`) before it is
        // destroyed; followed only on this (the parent's) thread.
        parent: ThreadBound::new(parent),
        hot_reload: parent.hot_reload,
        arm_test_gate: cfg!(debug_assertions)
            && parent.is_main_thread()
            && bun_core::env_var::feature_flag::BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE::get()
                .unwrap_or(false),
        execution_context_id: this_context_id,
        mini,
        eval_mode,
        is_node_worker,
        store_fd,
        argv: argv.iter().map(WorkerString::new).collect(),
        exec_argv: (!inherit_exec_argv).then(|| exec_argv.iter().map(WorkerString::new).collect()),
        unresolved_specifier: spec_slice.slice().to_vec().into_boxed_slice(),
        preloads,
        name: if name_str.is_empty() {
            bun_core::ZBox::default()
        } else {
            name_str.to_owned_slice_z()
        },
        requested_terminate: AtomicBool::new(false),
        vm_handle: Guarded::new(None),
        exit_called: AtomicBool::new(false),
        terminated_by_parent: AtomicBool::new(false),
        cpp_ref: Guarded::new(None),
        parent_poll_ref: Guarded::new(KeepAlive::init()),
        join_handle: Guarded::new(None),
    });

    // Keep the parent's event loop alive until the parent releases this
    // thread, unless the user opted out with `{ ref: false }`.
    if !default_unref {
        // `bun_io::js_vm_ctx()` is this (the parent) thread's loop.
        worker.parent_poll_ref.lock().ref_(bun_io::js_vm_ctx());
    }

    // The thread is something of this VM's on another thread for as long as
    // it runs: the parent joins it before its own teardown's wait, which
    // this ticket would otherwise hold.
    let parent_ticket = parent.ticket();
    let thread_worker = Arc::clone(&worker);
    let spawn = std::thread::Builder::new()
        .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
        .spawn(move || {
            let _parent_ticket = parent_ticket;
            thread_worker.thread_main(init);
        });
    match spawn {
        Ok(handle) => {
            *worker.join_handle.lock() = Some(handle);
            parent.child_workers.push(Arc::clone(&worker));
            let ptr = Arc::as_ptr(&worker);
            let cpp_ref = Arc::clone(&worker);
            *worker.cpp_ref.lock() = Some(cpp_ref);
            ptr
        }
        Err(_) => {
            worker.parent_poll_ref.lock().unref(bun_io::js_vm_ctx());
            *error_message = BunString::static_(b"Failed to spawn worker thread");
            core::ptr::null()
        }
    }
}

/// Drop the ref behind the pointer `create()` returned: the proxy's last use
/// of it, on the thread that owns the parent context.
// HOST_EXPORT(WebWorker__deref, c)
pub fn release_cpp_ref(this: bun_ptr::ThisPtr<crate::web_worker::WebWorker>) {
    let cpp_ref = this.cpp_ref.lock().take();
    drop(cpp_ref);
}

/// Block until the OS thread has returned. Parent thread; the worker has
/// either reported `workerGlobalScopeDestroyed` or been asked to terminate
/// by an exiting parent. Termination interrupts script, not a native call
/// the worker is blocked in, so this waits as long as that call does (as
/// Node's JoinThread does).
// HOST_EXPORT(WebWorker__join, c)
pub fn join(this: &crate::web_worker::WebWorker) {
    let handle = this.join_handle.lock().take();
    if let Some(handle) = handle {
        log!("[{}] join", this.execution_context_id);
        // A panic on the worker thread has already been reported by the panic
        // hook; the join result carries nothing further.
        let _ = handle.join();
    }
}

// =========================================================================
// Parent-thread API (called from C++ via JS)
// =========================================================================

/// worker.ref()/.unref(). Parent thread; the proxy gates out calls once
/// the keep-alive has been released.
// HOST_EXPORT(WebWorker__setRef, c)
pub fn set_ref(this: &crate::web_worker::WebWorker, value: bool) {
    let mut poll = this.parent_poll_ref.lock();
    if value {
        poll.ref_(bun_io::js_vm_ctx());
    } else {
        poll.unref(bun_io::js_vm_ctx());
    }
}

/// Ask the thread to stop: set `requested_terminate`, raise a
/// TerminationException in its VM at the next safepoint, wake its loop.
/// Any thread the proxy is used from may call this.
// HOST_EXPORT(WebWorker__requestTermination, c)
pub fn request_termination(this: &crate::web_worker::WebWorker) {
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
// HOST_EXPORT(WebWorker__releaseParentPollRef, c)
pub fn release_parent_poll_ref(this: &crate::web_worker::WebWorker) {
    this.parent_poll_ref.lock().unref(bun_io::js_vm_ctx());
    let children = &mut this.parent.get().as_mut().child_workers;
    if let Some(i) = children
        .iter()
        .position(|c| core::ptr::eq(Arc::as_ptr(c), this))
    {
        drop(children.swap_remove(i));
    }
}

impl Drop for WebWorker {
    fn drop(&mut self) {
        log!("[{}] destroy", self.execution_context_id);
        debug_assert!(
            self.join_handle.lock().is_none(),
            "worker thread was never joined"
        );
    }
}

impl WebWorker {
    pub(crate) fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
    }

    /// The parent context is exiting: terminate, join and release this worker
    /// (`WorkerMessagingProxy::parentContextWillDestroy`). Parent thread only —
    /// `parent.get()` refuses any other.
    fn parent_context_will_destroy(self: Arc<Self>) {
        let _: &VirtualMachine = self.parent.get();
        let proxy = self.proxy;
        // Ours is not the ref that keeps this alive through its release (the
        // proxy's is); drop it first so the release frees it where it always has.
        drop(self);
        proxy.parent_context_will_destroy();
    }

    /// Whether this worker was started in eval mode (entry source is a
    /// string, not a file).
    #[inline]
    pub fn eval_mode(&self) -> bool {
        self.eval_mode
    }

    #[inline]
    pub fn argv(&self) -> &[WorkerString] {
        &self.argv
    }

    /// `None` when the worker inherits the parent's execArgv, otherwise the
    /// (possibly empty) list it was created with.
    #[inline]
    pub fn exec_argv(&self) -> Option<&[WorkerString]> {
        self.exec_argv.as_deref()
    }

    fn set_requested_terminate(&self) -> bool {
        self.requested_terminate.swap(true, Ordering::Release)
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
    pub(crate) fn messaging_proxy(&self) -> &WorkerMessagingProxy {
        self.proxy.get()
    }

    #[inline]
    pub(crate) fn mini(&self) -> bool {
        self.mini
    }

    // =========================================================================
    // Worker thread
    // =========================================================================

    fn thread_main(self: Arc<Self>, init: WorkerVmInit) {
        bun_analytics::features::workers_spawned.fetch_add(1, Ordering::Relaxed);

        if !self.name.is_empty() {
            bun_core::output::Source::configure_named_thread(self.name.as_zstr());
        } else {
            bun_core::output::Source::configure_named_thread(bun_core::ZStr::from_static(
                b"Worker\0",
            ));
        }

        let mut thread = WorkerThread {
            vm: None,
            status: Status::Start,
            arena: None,
            env_loader: None,
        };

        // Terminated before we even started — straight to shutdown so the
        // parent still gets its close event.
        if self.has_requested_terminate() {
            self.shutdown(&mut thread);
            return;
        }

        match self.start_vm(&mut thread, init) {
            Ok(true) => {}
            // `start_vm()` observed `requested_terminate` and already ran `shutdown()`.
            Ok(false) => return,
            Err(err) => {
                bun_core::output::panic(format_args!(
                    "An unhandled error occurred while starting a worker: {}\n",
                    err.name()
                ));
            }
        }

        let global = VirtualMachine::get().global();
        // Take the API lock for the thread's whole life and abandon it with the
        // VM (`shutdown()` destroys the `JSC::VM`; there is nothing to unlock).
        // Raw FFI rather than the RAII guard, whose `&VM` would dangle.
        JSC__VM__getAPILock(global.vm());
        self.spin(&mut thread);
    }

    /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
    ///
    /// `Ok(false)` means the early-terminate checkpoint already ran `shutdown()`.
    fn start_vm(
        self: &Arc<Self>,
        thread: &mut WorkerThread,
        init: WorkerVmInit,
    ) -> Result<bool, crate::CrateError> {
        debug_assert!(thread.status == Status::Start);
        debug_assert!(thread.vm.is_none());

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        let WorkerVmInit {
            transform_options,
            env_loader,
            proxy_env_slots,
        } = init;

        let arena = thread.arena.insert(Box::new(bun_alloc::Arena::new()));
        let arena = NonNull::from(&mut **arena);

        // Stashed on `thread` so `shutdown()` reclaims it on every path —
        // including the early-terminate checkpoint below, which calls
        // `shutdown()` before the VM exists.
        let env_loader = thread.env_loader.insert(Box::new(env_loader));
        let env_loader = NonNull::from(&mut **env_loader);

        // Checkpoint before the expensive part: initWorker builds a full JSC
        // VM. If a parent's request_termination() fired while we were cloning the env
        // above, bail now rather than spending ~50–100ms (release) creating a
        // VM that will immediately tear down.
        if self.has_requested_terminate() {
            self.shutdown(thread);
            return Ok(false);
        }

        let vm = thread.vm.insert(VirtualMachine::init_worker(
            self,
            virtual_machine::Options {
                args: transform_options,
                env_loader: Some(env_loader),
                store_fd: self.store_fd,
                graph: crate::virtual_machine::standalone_module_graph(),
                ..Default::default()
            },
        )?);
        {
            let vm = vm.as_mut();
            vm.arena = Some(arena);
            *vm.proxy_env_storage.lock() = proxy_env_slots;
            vm.is_main_thread = false;
            VirtualMachine::set_is_main_thread_vm(false);
            vm.on_unhandled_rejection = on_unhandled_rejection;
        }

        // Publish now (rather than at the end of startVM) so that:
        //   - a concurrent request_termination() (parent, or an exiting ancestor) can
        //     wake us once JS starts running, and
        //   - early returns below reach spin()/shutdown() with the VM set,
        //     so teardownJSCVM/vm.deinit() run and the just-built JSC::VM
        //     heap is not leaked.
        // We do NOT call shutdown() directly from here: shutdown() with a
        // VM runs vm.onExit() (JS), which requires holdAPILock.
        // Instead we return; threadMain enters holdAPILock(spin) and spin()'s
        // first check observes requested_terminate.
        *self.vm_handle.lock() = Some(vm.handle());

        {
            let b = &mut vm.as_mut().transpiler;
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
            return Ok(true);
        }

        if vm.as_mut().transpiler.configure_defines().is_err() {
            // Fall through to spin() → shutdown() for full teardown under
            // the API lock (flushLogs runs JS). Set terminate so spin()
            // bails immediately; vm.log carries the error for flushLogs.
            vm.as_mut().exit_handler.exit_code = 1;
            let _ = self.set_requested_terminate();
            return Ok(true);
        }

        vm.as_mut().load_extra_env_and_source_code_printer();
        Ok(true)
    }

    /// Phase 2: load the entry point, dispatch 'online', run the event loop.
    /// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
    fn spin(&self, thread: &mut WorkerThread) {
        log!("[{}] spin start", self.execution_context_id);

        // The VM set in start_vm IS the worker thread's per-thread VM (set by
        // `VirtualMachine::init` → `VMHolder`), so the safe thread-local
        // accessor returns the same allocation. Mutation goes through
        // `vm.as_mut()`, which forms a fresh short-lived `&mut` per call.
        debug_assert!(
            thread
                .vm
                .as_deref()
                .is_some_and(|vm| core::ptr::eq(vm, VirtualMachine::get()))
        );
        let vm: &VirtualMachine = VirtualMachine::get();
        debug_assert!(thread.status == Status::Start);
        self.set_status(thread, Status::Starting);

        // Terminated during startVM() (or startVM() short-circuited here on
        // configureDefines failure) — shut down under the API lock so the
        // JSC::VM built by initWorker is torn down rather than leaked.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            return self.shutdown(thread);
        }

        // `preload: Vec<Box<[u8]>>` — clone the boxes (cheap, ≤handful).
        vm.as_mut().preload.clone_from(&self.preloads);

        // Resolve the entry point on the worker thread (the parent only stored
        // the raw specifier). The returned slice is borrowed; every exit from
        // spin() goes through shutdown().
        let mut resolve_error = BunString::EMPTY;
        let vm_log = vm.log_mut().unwrap();
        let path = match resolve_entry_point_specifier(
            vm.as_mut(),
            &self.unresolved_specifier,
            &mut resolve_error,
            vm_log,
        ) {
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
                return self.shutdown(thread);
            }
        };

        // Terminated while resolving — exit code 0, no error.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            return self.shutdown(thread);
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
                return self.shutdown(thread);
            }
        }

        // `path` borrows the resolver's process-lifetime string store, the
        // standalone module graph, or `self.unresolved_specifier` — all of
        // which outlive the worker VM. `vm.main` stores it as a raw BACKREF
        // (see `VirtualMachine::set_main`); no lifetime extension needed.
        let promise = match vm.as_mut().load_entry_point_for_web_worker(path) {
            Ok(p) => JSPromise::opaque_mut(p),
            Err(_) => {
                // process.exit() may have run during load; don't clobber its code.
                if !self.exit_called.load(Ordering::Relaxed) {
                    vm.as_mut().exit_handler.exit_code = 1;
                }
                self.flush_logs(vm);
                WebWorker__entrySettled(vm.global());
                return self.shutdown(thread);
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
        // `promise` is rooted (`entry_promise`) for the loop's duration.
        let promise_value = promise.to_js();
        let mut entry_rejection_seen = false;
        let mut observe_entry = |vm: &VirtualMachine| -> EntryOutcome {
            if entry_rejection_seen || promise.status() != jsc::js_promise::Status::Rejected {
                return EntryOutcome::Continue;
            }
            entry_rejection_seen = true;
            // Same rule as the main thread (run_command): a CJS worker
            // entry's top-level throw is an uncaughtException; only an
            // ESM entry rejection reports origin "unhandledRejection".
            let is_rejection = !vm.as_mut().entry_point_result.evaluated_as_cjs;
            let handled = vm.as_mut().uncaught_exception(
                vm.global(),
                promise.result(vm.jsc_vm()),
                is_rejection,
            );
            if handled {
                EntryOutcome::Continue
            } else {
                EntryOutcome::Stop
            }
        };
        if let EntryOutcome::Stop = observe_entry(vm) {
            // exit_code is already 1 from uncaught_exception; re-setting it here
            // would clobber a process.on('exit') change to process.exitCode.
            return self.shutdown(thread);
        }
        // A still-pending entry promise is an unsettled top-level await: as in
        // Node the worker counts as started once its module graph is executing,
        // and the await continues in the normal event loop below — messages,
        // timers and I/O keep flowing meanwhile. Rooted for the loop's duration.
        let entry_promise = crate::Strong::create(promise_value, vm.global());

        self.flush_logs(vm);
        log!("[{}] event loop start", self.execution_context_id);
        // Pending -> Running: 'online' is posted to the parent and messages/tasks
        // that arrived while the entry point was loading are delivered. After the
        // entry point on purpose, so the parent observes 'online' only once the
        // worker's top-level code has run (up to its first top-level await).
        self.proxy.worker_global_scope_started(vm.global());
        self.set_status(thread, Status::Running);

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
            if promise.status() == jsc::js_promise::Status::Pending
                && vm.exit_handler.exit_code == 0
            {
                vm.as_mut().exit_handler.exit_code = 13;
            }
        }
        drop(entry_promise);

        self.flush_logs(vm);
        self.shutdown(thread);
    }

    /// Phase 3: unpublish the VM's handle (a racing `requestTermination` now
    /// finds none), run the user 'exit' handlers, then the shared
    /// [`VirtualMachine::teardown`] (stop → forbid script → ~VM → loops →
    /// destroy), free the thread's remaining state, and last of all report
    /// `workerGlobalScopeDestroyed` — the parent joins this thread from that
    /// task, so nothing after it may touch the parent.
    fn shutdown(&self, thread: &mut WorkerThread) {
        jsc::mark_binding();
        self.set_status(thread, Status::Terminated);
        bun_analytics::features::workers_terminated.fetch_add(1, Ordering::Relaxed);
        log!("[{}] shutdown", self.execution_context_id);

        let mut arena = thread.arena.take();
        let env_loader = thread.env_loader.take();

        // ---- 1. Unpublish vm ------------------------------------------------
        drop(self.vm_handle.lock().take());
        let vm = thread.vm.take();

        // ---- 2. User exit handlers -----------------------------------------
        let mut exit_code: i32 = 0;
        if let Some(vm) = vm {
            {
                let vm = vm.as_mut();
                vm.is_shutting_down = true;
                vm.on_exit();
                exit_code = i32::from(vm.exit_handler.exit_code);
            }
            log!(
                "[{}] shutdown: exit handlers done",
                self.execution_context_id
            );

            // ---- 3–5. Stop, forbid script, wait, ~VM, loops, destroy ----------
            vm.teardown_and_free();
        }
        log!(
            "[{}] shutdown: VirtualMachine destroyed",
            self.execution_context_id
        );
        // The VM is gone, so its `transpiler.env` borrow of this is dead.
        drop(env_loader);
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
        self.proxy
            .worker_global_scope_destroyed(exit_code, self.stopped_by_parent());
    }

    /// worker.terminate() from the parent, and the worker did not also exit on
    /// its own (process.exit / uncaught error) — Node's "stopped" case: no exit
    /// handlers run and the exit code was not the worker's choice.
    pub fn stopped_by_parent(&self) -> bool {
        self.terminated_by_parent.load(Ordering::Relaxed)
            && !self.exit_called.load(Ordering::Relaxed)
    }

    /// process.exit() inside the worker. Worker thread.
    pub fn exit(&self) {
        self.exit_called.store(true, Ordering::Relaxed);
        let _ = self.set_requested_terminate();
        // Stop subsequent JS at the next safepoint. The handle is unpublished
        // before `vm.onExit()` (shutdown step 1), so a re-entrant
        // process.exit() from an exit handler does not re-arm the trap.
        // From an immediate this runs before the turn's poll; the wake is what ends it.
        if let Some(handle) = &*self.vm_handle.lock() {
            handle.request_termination();
        }
    }

    // =========================================================================
    // Helpers (worker thread)
    // =========================================================================

    fn set_status(&self, thread: &mut WorkerThread, status: Status) {
        log!(
            "[{}] status: {}",
            self.execution_context_id,
            <&'static str>::from(status)
        );
        thread.status = status;
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
            self.proxy.dispatch_error(global, str, err)
        });
        if let Err(e) = dispatch {
            let _ = crate::task::report_error_or_terminate(global, e);
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

    // The stop was already requested (terminate(), or the worker's own exit):
    // whatever rejects or throws from here on is a consequence of stopping —
    // a cancelled lookup, an aborted request — and is not the worker's error
    // to report. Node: terminate() wins; no 'error' event.
    if !vm.script_allowed() {
        return;
    }

    let mut error_instance = error_instance_or_exception
        .to_error()
        .unwrap_or(error_instance_or_exception);

    // A parse failure rejects with a BuildMessage, which doesn't survive structured
    // clone. Node reports a SyntaxError; build a real one from the formatted parse
    // error so the subtype reaches the parent intact.
    if let Some(bm) = error_instance.as_class_ref::<crate::BuildMessage>() {
        error_instance = EncodedSlice::utf8(&bm.msg.data.text).to_syntax_error_instance(global_object);
    }

    let mut array: Vec<u8> = Vec::new();

    let worker = vm.worker_ref().expect("Assertion failure: no worker");
    let proxy = worker.proxy;

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
        proxy.dispatch_error(global_object, error_message, error_instance);
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
    let worker = vm.worker_ref().expect("Assertion failure: no worker");
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
/// free it. `parent` is the calling thread's VM.
fn resolve_entry_point_specifier<'s>(
    parent: &mut VirtualMachine,
    str: &'s [u8],
    error_message: &mut BunString,
    log: &mut bun_ast::Log,
) -> Option<&'s [u8]> {
    // In a `bun build --compile` executable, a relative specifier names an embedded entry point (relative to the
    // embedded root) before it names a file on disk, and an absolute one may be an embedded path in either syntax
    // (`new URL("./w.ts", import.meta.url)`).
    if let Some(graph) = parent.standalone_module_graph
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

    let resolved_entry_point = match parent.transpiler.resolve_entry_point(str) {
        Ok(r) => r,
        Err(_) => {
            let global = parent.global();
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
