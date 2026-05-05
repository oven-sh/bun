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

use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_alloc::MimallocArena;
use bun_core::Output;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, VirtualMachine};
use bun_logger as logger;
use bun_str::{self as strings, String as BunString, WTFStringImpl};
use bun_threading::{Futex, Mutex};

bun_output::declare_scope!(Worker, hidden);

macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(Worker, $($arg)*) };
}

// ---- Immutable after `create()` (safe from any thread) ----------------------

pub struct WebWorker<'a> {
    /// The owning C++ `WebCore::Worker`. Never null; this struct is freed by
    /// `~Worker`, so the pointer cannot dangle.
    cpp_worker: *mut c_void,
    /// Parent `jsc.VirtualMachine`. Read on the worker thread by `startVM()`
    /// (transform options, env, proxy storage, standalone graph) and on the
    /// parent thread by `setRef()` / `releaseParentPollRef()`.
    ///
    /// Validity: when the parent is the main thread, `globalExit()` calls
    /// `terminateAllAndWait()` before freeing anything, so this stays valid
    /// through `startVM()` even with `{ref:false}`/`.unref()`. When the parent
    /// is itself a worker, nothing joins us on its exit — the nested-worker
    /// "Known gap" in the file header. When `parent_poll_ref` is held (the
    /// default), the parent's loop stays alive until the close task runs.
    parent: &'a jsc::VirtualMachine,
    parent_context_id: u32,
    execution_context_id: u32,
    mini: bool,
    eval_mode: bool,
    store_fd: bool,
    /// Borrowed from C++ `WorkerOptions` (kept alive by the owning `Worker`).
    // TODO(port): lifetime — borrowed from cpp_worker (BACKREF), not `parent`;
    // tied to `'a` here for Phase A only.
    argv: &'a [WTFStringImpl],
    exec_argv: Option<&'a [WTFStringImpl]>,
    /// Heap-owned by this struct; freed in `destroy()`.
    unresolved_specifier: Box<[u8]>,
    preloads: Vec<Box<[u8]>>,
    // TODO(port): owned NUL-terminated bytes; Zig was `[:0]const u8`.
    name: Box<[u8]>,

    // ---- Cross-thread signalling --------------------------------------------

    /// Intrusive node for the process-global `LiveWorkers` list. Registered
    /// before the thread is spawned; removed in `shutdown()` once the worker is
    /// past all process-global resolver access.
    // TODO(port): intrusive doubly-linked list node (std.DoublyLinkedList.Node)
    live_node: bun_collections::IntrusiveListNode,

    /// Set by the parent (`notifyNeedTermination`) or by the worker itself
    /// (`exit`). The worker loop polls this between ticks.
    requested_terminate: AtomicBool,

    /// The worker's `jsc.VirtualMachine`, or null before `startVM()` / after
    /// `shutdown()` nulls it. Lives inside `arena`. `vm_lock` must be held for
    /// any cross-thread read (see header comment).
    vm: Option<Box<jsc::VirtualMachine>>,
    vm_lock: Mutex,

    // ---- Parent-thread only -------------------------------------------------

    /// Keep-alive on the parent's event loop. `Async.KeepAlive` is not
    /// thread-safe; it is reffed in `create()`, toggled by `setRef()` (JS
    /// `.ref()`/`.unref()`), and released by `releaseParentPollRef()` from the
    /// close task — all on the parent thread.
    parent_poll_ref: KeepAlive,

    // ---- Worker-thread only -------------------------------------------------

    status: Status,
    // PERF(port): was MimallocArena bulk-free backing the worker VM — keep as
    // explicit arena rather than deleting per §Allocators non-AST rule, because
    // the VM's allocator IS this arena (load-bearing). Profile in Phase B.
    arena: Option<MimallocArena>,
    /// Set by `exit()` so that `spin()`'s error paths don't clobber an explicit
    /// `process.exit(code)`.
    exit_called: bool,
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

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn WebWorker__teardownJSCVM(global: *mut JSGlobalObject);
    fn WebWorker__dispatchExit(cpp_worker: *mut c_void, exit_code: i32);
    fn WebWorker__dispatchOnline(cpp_worker: *mut c_void, global: *mut JSGlobalObject);
    fn WebWorker__fireEarlyMessages(cpp_worker: *mut c_void, global: *mut JSGlobalObject);
    fn WebWorker__dispatchError(
        global: *mut JSGlobalObject,
        cpp_worker: *mut c_void,
        message: BunString,
        err: JSValue,
    );
}

/// Process-global registry of worker threads that have been spawned and
/// have not yet reached the point in `shutdown()` where they are past all
/// process-global resolver access (BSSMap singletons like `dir_cache`).
/// `globalExit()` uses this to terminate and wait for workers before
/// `transpiler.deinit()` frees those singletons.
///
/// Lock ordering: `LiveWorkers.mutex` → `worker.vm_lock` (never the reverse).
mod live_workers {
    use super::*;

    // TODO(port): mutable statics for intrusive list; Phase B may wrap in a
    // single `static LIVE: Mutex<IntrusiveList>` instead.
    pub(super) static MUTEX: Mutex = Mutex::new();
    // TODO(port): std.DoublyLinkedList — intrusive, nodes are `WebWorker.live_node`
    pub(super) static mut LIST: bun_collections::IntrusiveList = bun_collections::IntrusiveList::new();
    /// Number of workers registered in `list`. Separate atomic so
    /// `terminateAllAndWait` can futex-wait on it without the mutex.
    pub(super) static OUTSTANDING: AtomicU32 = AtomicU32::new(0);

    pub(super) fn register(worker: *mut WebWorker<'_>) {
        let _g = MUTEX.lock();
        // SAFETY: MUTEX held; `worker` is a valid heap allocation owned by C++.
        unsafe { LIST.append(&mut (*worker).live_node) };
        OUTSTANDING.fetch_add(1, Ordering::Release);
        // Wake terminateAllAndWait so it re-sweeps and catches this worker
        // (it may have been created by another worker mid-sweep). No-op if
        // nothing is waiting.
        Futex::wake(&OUTSTANDING, 1);
    }

    pub(super) fn unregister(worker: *mut WebWorker<'_>) {
        {
            let _g = MUTEX.lock();
            // SAFETY: MUTEX held; node was registered in `register`.
            unsafe { LIST.remove(&mut (*worker).live_node) };
        }
        // Wake any waiter in terminateAllAndWait when we hit zero. Waking
        // unconditionally is fine (spurious wakeups just re-check the
        // counter) and avoids a compare-before-wake race.
        OUTSTANDING.fetch_sub(1, Ordering::Release);
        Futex::wake(&OUTSTANDING, 1);
    }
}

/// Request termination of every live worker and block until each has reached
/// `shutdown()` (past all process-global resolver access), or `timeout_ms`
/// elapses. Called from `VirtualMachine.globalExit()` on the main thread
/// before `transpiler.deinit()` frees the process-global BSSMap singletons —
/// without this, a detached worker still in `startVM()`/`spin()` would UAF on
/// `dir_cache` / `dirname_store` etc.
///
/// This is the `Environment::stop_sub_worker_contexts()` equivalent for the
/// main thread; nested workers (a worker's own sub-workers at the worker's
/// exit) remain the documented gap.
///
/// Termination is cooperative: `requested_terminate` is polled at
/// checkpoints throughout `startVM()` and `spin()`, and for a running VM
/// `notifyNeedTermination()` raises a TerminationException at the next JSC
/// safepoint. We do NOT use `thread_suspend`/`SuspendThread` — a worker
/// frozen mid-mimalloc-alloc or holding the `dir_cache` mutex would
/// deadlock/corrupt the very cleanup we're trying to make safe.
pub fn terminate_all_and_wait(timeout_ms: u64) {
    if live_workers::OUTSTANDING.load(Ordering::Acquire) == 0 {
        return;
    }

    // Futex-wait on the counter so we sleep rather than burn a core. Each
    // unregister() wakes us; we re-check and re-wait until zero or deadline.
    // We re-sweep the list on EVERY iteration: a worker A that was mid-
    // `WebWorker__create` for a nested worker B when we first swept will
    // register B after we release the mutex, and B's `requested_terminate`
    // was never set. Sweeping is O(outstanding) and `requested_terminate`
    // is a swap, so re-sweeping already-terminated entries is cheap.
    // TODO(port): std.time.Timer — using core Instant; verify acceptable.
    let timer = std::time::Instant::now();
    let deadline_ns: u64 = timeout_ms * 1_000_000; // std.time.ns_per_ms
    loop {
        {
            let _g = live_workers::MUTEX.lock();
            // SAFETY: MUTEX held while walking the intrusive list.
            let mut it = unsafe { live_workers::LIST.first() };
            while let Some(node) = it {
                // SAFETY: node points to WebWorker.live_node; recover container.
                let worker: *mut WebWorker<'_> = unsafe {
                    (node as *mut _ as *mut u8)
                        .sub(offset_of!(WebWorker<'_>, live_node))
                        .cast::<WebWorker<'_>>()
                };
                it = unsafe { (*node).next() };
                // SAFETY: worker valid while registered (removed only in shutdown()).
                let w = unsafe { &*worker };
                if w.requested_terminate.swap(true, Ordering::Release) {
                    continue;
                }
                let _vm_g = w.vm_lock.lock();
                if let Some(vm) = w.vm.as_deref() {
                    vm.jsc_vm.notify_need_termination();
                    vm.event_loop().wakeup();
                }
            }
        }

        let n = live_workers::OUTSTANDING.load(Ordering::Acquire);
        if n == 0 {
            return;
        }
        let elapsed = u64::try_from(timer.elapsed().as_nanos()).unwrap();
        if elapsed >= deadline_ns {
            log!("terminateAllAndWait: timed out with {} outstanding", n);
            return;
        }
        let _ = Futex::wait(&live_workers::OUTSTANDING, n, deadline_ns - elapsed);
        // (Zig fallback branch for "monotonic clock unavailable" elided —
        // Instant::now() is infallible on supported platforms.)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn WebWorker__getParentWorker(vm: &jsc::VirtualMachine) -> *mut c_void {
    let Some(worker) = vm.worker else {
        return core::ptr::null_mut();
    };
    // SAFETY: worker is a valid `*mut WebWorker` owned by C++ while vm lives.
    unsafe { (*worker).cpp_worker }
}

impl<'a> WebWorker<'a> {
    pub fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
    }

    fn set_requested_terminate(&self) -> bool {
        self.requested_terminate.swap(true, Ordering::Release)
    }

    // =========================================================================
    // Construction (parent thread)
    // =========================================================================

    /// Allocate the struct, take a keep-alive on the parent event loop, and
    /// spawn the worker thread. On any failure returns null with `error_message`
    /// set and nothing to clean up (no keep-alive held, no allocation
    /// outstanding).
    #[export_name = "WebWorker__create"]
    pub extern "C" fn create(
        cpp_worker: *mut c_void,
        parent: &'a jsc::VirtualMachine,
        name_str: BunString,
        specifier_str: BunString,
        error_message: &mut BunString,
        parent_context_id: u32,
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
    ) -> *mut WebWorker<'a> {
        jsc::mark_binding(core::panic::Location::caller());
        log!("[{}] create", this_context_id);

        let spec_slice = specifier_str.to_utf8();
        let prev_log = parent.transpiler.log;
        let mut temp_log = logger::Log::init();
        parent.transpiler.set_log(&mut temp_log);
        let _restore = scopeguard::guard((), |_| {
            parent.transpiler.set_log(prev_log);
        });
        // temp_log dropped at scope exit.

        // SAFETY: caller passes a valid (ptr,len) pair or null.
        let preload_modules: &[BunString] = if preload_modules_ptr.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(preload_modules_ptr, preload_modules_len) }
        };

        let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(preload_modules_len);
        for module in preload_modules {
            let utf8_slice = module.to_utf8();
            if let Some(preload) =
                resolve_entry_point_specifier(parent, utf8_slice.as_slice(), error_message, &mut temp_log)
            {
                preloads.push(Box::<[u8]>::from(preload));
            }

            if !error_message.is_empty() {
                // preloads dropped automatically.
                return core::ptr::null_mut();
            }
        }

        let name: Box<[u8]> = if !name_str.is_empty() {
            // TODO(port): allocPrintSentinel — produce NUL-terminated bytes.
            let mut v = Vec::<u8>::new();
            use std::io::Write;
            let _ = write!(&mut v, "{}", name_str);
            v.push(0);
            v.into_boxed_slice()
        } else {
            Box::default()
        };

        // SAFETY: caller passes a valid (ptr,len) pair or null; slices are
        // borrowed from C++ WorkerOptions kept alive by the owning Worker.
        let argv: &'a [WTFStringImpl] = if argv_ptr.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(argv_ptr, argv_len) }
        };
        let exec_argv: Option<&'a [WTFStringImpl]> = if inherit_exec_argv {
            None
        } else if exec_argv_ptr.is_null() {
            Some(&[])
        } else {
            Some(unsafe { core::slice::from_raw_parts(exec_argv_ptr, exec_argv_len) })
        };

        let worker = Box::into_raw(Box::new(WebWorker {
            cpp_worker,
            parent,
            parent_context_id,
            execution_context_id: this_context_id,
            mini,
            eval_mode,
            unresolved_specifier: spec_slice.into_owned_bytes(),
            store_fd: parent.transpiler.resolver.store_fd,
            name,
            argv,
            exec_argv,
            preloads,
            live_node: bun_collections::IntrusiveListNode::default(),
            requested_terminate: AtomicBool::new(false),
            vm: None,
            vm_lock: Mutex::new(),
            parent_poll_ref: KeepAlive::default(),
            status: Status::Start,
            arena: None,
            exit_called: false,
        }));

        // SAFETY: worker just allocated above; we are sole owner until returned.
        let worker_ref = unsafe { &mut *worker };

        // Keep the parent's event loop alive until the close task releases this.
        // If the user passed `{ ref: false }` we skip — they've opted out of
        // the worker keeping the process alive.
        if !default_unref {
            worker_ref.parent_poll_ref.r#ref(parent);
        }

        // Register BEFORE spawning so terminateAllAndWait() can never miss a
        // worker whose thread is already running.
        live_workers::register(worker);

        // TODO(port): std.Thread.spawn — using std::thread::Builder; verify
        // bun_threading provides a wrapper. Stack size = bun.default_thread_stack_size.
        let spawn_result = std::thread::Builder::new()
            .stack_size(bun_core::DEFAULT_THREAD_STACK_SIZE)
            .spawn(move || {
                // SAFETY: worker outlives the thread (freed by ~Worker only
                // after dispatchExit posts; see file header ownership rule).
                unsafe { (*worker).thread_main() };
            });
        match spawn_result {
            Ok(thread) => {
                // detach: drop the JoinHandle.
                drop(thread);
            }
            Err(_) => {
                live_workers::unregister(worker);
                worker_ref.parent_poll_ref.unref(parent);
                // SAFETY: worker was Box::into_raw'd above and not yet given
                // to anyone (thread spawn failed); reclaim and drop.
                drop(unsafe { Box::from_raw(worker) });
                *error_message = BunString::static_("Failed to spawn worker thread");
                return core::ptr::null_mut();
            }
        }

        worker
    }

    /// Free the struct and its owned strings. Called from
    /// `WebCore::Worker::~Worker()` (or from `create()` on spawn failure). The
    /// allocator is mimalloc (thread-safe), so the caller's thread doesn't
    /// matter.
    #[export_name = "WebWorker__destroy"]
    pub extern "C" fn destroy(this: *mut WebWorker<'a>) {
        // SAFETY: this was Box::into_raw'd in create(); C++ owns it and calls
        // destroy exactly once.
        let this = unsafe { Box::from_raw(this) };
        log!("[{}] destroy", this.execution_context_id);
        // unresolved_specifier / preloads / name freed by Drop.
        drop(this);
    }

    // =========================================================================
    // Parent-thread API (called from C++ via JS)
    // =========================================================================

    /// worker.ref()/.unref() from JS. The struct is guaranteed alive: it's
    /// freed by `~Worker`, which can't run while JSWorker (the caller) holds
    /// its `Ref<Worker>`. `Worker::setKeepAlive()` gates out calls after
    /// terminate() or the close task, so this can unconditionally toggle.
    #[export_name = "WebWorker__setRef"]
    pub extern "C" fn set_ref(this: &mut WebWorker<'a>, value: bool) {
        if value {
            this.parent_poll_ref.r#ref(this.parent);
        } else {
            this.parent_poll_ref.unref(this.parent);
        }
    }

    /// worker.terminate() from JS. Sets `requested_terminate`, interrupts
    /// running JS in the worker (TerminationException at the next safepoint),
    /// and wakes the worker loop so it observes the flag. `parent_poll_ref`
    /// stays held until the close task runs so that `await worker.terminate()`
    /// keeps the parent alive until 'close' fires.
    #[export_name = "WebWorker__notifyNeedTermination"]
    pub extern "C" fn notify_need_termination(this: &mut WebWorker<'a>) {
        if this.set_requested_terminate() {
            return;
        }
        log!("[{}] notifyNeedTermination", this.execution_context_id);

        // vm_lock serialises against shutdown() nulling `vm` and freeing the
        // arena it lives in.
        let _g = this.vm_lock.lock();
        if let Some(vm) = this.vm.as_deref() {
            vm.jsc_vm.notify_need_termination();
            vm.event_loop().wakeup();
        }
    }

    /// Release the keep-alive on the parent's event loop. Called on the parent
    /// thread from the close task posted by `dispatchExit`.
    #[export_name = "WebWorker__releaseParentPollRef"]
    pub extern "C" fn release_parent_poll_ref(this: &mut WebWorker<'a>) {
        this.parent_poll_ref.unref(this.parent);
    }

    // =========================================================================
    // Worker thread
    // =========================================================================

    fn thread_main(&mut self) {
        bun_core::analytics::Features::workers_spawned_inc();

        if !self.name.is_empty() {
            // TODO(port): name is NUL-terminated bytes; configure_named_thread
            // wants &ZStr.
            Output::Source::configure_named_thread(&self.name);
        } else {
            Output::Source::configure_named_thread(b"Worker");
        }

        // Terminated before we even started — skip straight to shutdown so the
        // parent still gets a close event and the thread ref is dropped.
        if self.has_requested_terminate() {
            self.shutdown();
            // unreachable
        }

        if let Err(err) = self.start_vm() {
            Output::panic(format_args!(
                "An unhandled error occurred while starting a worker: {}\n",
                err.name()
            ));
        }

        // SAFETY: start_vm published vm under vm_lock; non-None here.
        let global = self.vm.as_deref().unwrap().global;
        global
            .vm()
            .hold_api_lock(self as *mut _ as *mut c_void, opaque_spin_trampoline);
    }

    /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
    // TODO(port): narrow error set
    fn start_vm(&mut self) -> Result<(), bun_core::Error> {
        debug_assert!(self.status == Status::Start);
        debug_assert!(self.vm.is_none());

        let mut transform_options = self.parent.transpiler.options.transform_options.clone();

        if let Some(exec_argv) = self.exec_argv {
            'parse_new_args: {
                let mut new_args: Vec<Box<[u8]>> = Vec::with_capacity(exec_argv.len());
                for arg in exec_argv {
                    // TODO(port): WTFStringImpl::toOwnedSliceZ → owned NUL-terminated
                    new_args.push(arg.to_owned_slice_z()?);
                }

                let mut diag = bun_clap::Diagnostic::default();
                let mut iter = bun_clap::args::SliceIterator::init(&new_args);

                let args = match bun_clap::parse_ex(
                    bun_clap::Help,
                    bun_runtime::cli::Command::Tag::RunCommand.params(),
                    &mut iter,
                    bun_clap::ParseOptions {
                        diagnostic: &mut diag,
                        // just one for executable
                        stop_after_positional_at: 1,
                    },
                ) {
                    Ok(a) => a,
                    Err(_) => {
                        // ignore param parsing errors
                        break 'parse_new_args;
                    }
                };

                // override the existing even if it was set
                transform_options.allow_addons = !args.flag("--no-addons");

                // TODO: currently this only checks for --no-addons. I think
                // this should go through most flags and update the options.
            }
        }

        self.arena = Some(MimallocArena::init());
        // PERF(port): arena allocator threaded into VM init; in Phase A we
        // keep the arena handle but pass it through opaquely.
        let allocator = self.arena.as_ref().unwrap().allocator();

        // Proxy-env values may be RefCountedEnvValue bytes owned by the parent's
        // proxy_env_storage. We need a consistent snapshot of (storage slots +
        // env.map entries) so every slice we copy is backed by a ref we hold.
        // The parent's storage.lock serialises against Bun__setEnvValue on the
        // main thread — it covers both the slot swap and the map.put, so
        // cloneFrom and cloneWithAllocator see the same state.
        let mut temp_proxy_storage = jsc::RareData::ProxyEnvStorage::default();
        let temp_proxy_guard = scopeguard::guard(&mut temp_proxy_storage, |s| {
            // errdefer temp_proxy_storage.deinit();
            drop(core::mem::take(s));
        });

        // TODO(port): allocator.create(DotEnv.Map) — arena-allocated in Zig.
        let map = Box::leak(Box::new(bun_dotenv::Map::default()));
        {
            let parent_storage = &self.parent.proxy_env_storage;
            let _g = parent_storage.lock.lock();

            temp_proxy_guard.clone_from(parent_storage);
            *map = self.parent.transpiler.env.map.clone_with_allocator(allocator)?;
        }
        // Ensure map entries point at the exact bytes we hold refs on.
        temp_proxy_guard.sync_into(map);

        // TODO(port): allocator.create(DotEnv.Loader) — arena-allocated in Zig.
        let loader = Box::leak(Box::new(bun_dotenv::Loader::init(map, allocator)));

        // Checkpoint before the expensive part: initWorker builds a full JSC
        // VM. If terminateAllAndWait() fired while we were cloning the env
        // above, bail now rather than spending ~50–100ms (release) creating a
        // VM that will immediately tear down.
        if self.has_requested_terminate() {
            // disarm errdefer guard, then explicitly drop
            let s = scopeguard::ScopeGuard::into_inner(temp_proxy_guard);
            drop(core::mem::take(s));
            self.shutdown();
        }

        let mut vm = jsc::VirtualMachine::init_worker(
            self,
            jsc::VirtualMachine::InitWorkerOptions {
                allocator,
                args: transform_options,
                env_loader: loader,
                store_fd: self.store_fd,
                graph: self.parent.standalone_module_graph,
            },
        )?;
        vm.allocator = allocator;
        // TODO(port): vm.arena = &this.arena.? — raw backref into self.arena
        vm.arena = self.arena.as_mut().unwrap() as *mut _;

        // Move the pre-cloned proxy storage into the worker VM.
        let s = scopeguard::ScopeGuard::into_inner(temp_proxy_guard);
        vm.proxy_env_storage = core::mem::take(s);

        vm.is_main_thread = false;
        jsc::VirtualMachine::set_is_main_thread_vm(false);
        vm.on_unhandled_rejection = on_unhandled_rejection;

        // Publish `vm` now (rather than at the end of startVM) so that:
        //   - a concurrent notifyNeedTermination()/terminateAllAndWait() can
        //     wake us once JS starts running, and
        //   - early returns below reach spin()/shutdown() with this.vm set,
        //     so teardownJSCVM/vm.deinit() run and the just-built JSC::VM
        //     heap is not leaked.
        // We do NOT call shutdown() directly from here: shutdown() with a
        // non-null vm runs vm.onExit() (JS), which requires holdAPILock.
        // Instead we return; threadMain enters holdAPILock(spin) and spin()'s
        // first check observes requested_terminate.
        {
            let _g = self.vm_lock.lock();
            self.vm = Some(vm);
        }

        // PORT NOTE: reshaped for borrowck — re-borrow vm through self.vm
        let vm = self.vm.as_deref_mut().unwrap();
        let b = &mut vm.transpiler;
        b.resolver.env_loader = b.env;

        if let Some(graph) = self.parent.standalone_module_graph {
            bun_bun_js::apply_standalone_runtime_flags(b, graph);
        }

        // Second checkpoint: initWorker just spent the bulk of startup time;
        // if terminate arrived during it, skip configureDefines() (which
        // walks the resolver's global dir_cache) and entry-point loading.
        // spin() will observe the flag and shutdown() under the API lock.
        if self.has_requested_terminate() {
            return Ok(());
        }

        if b.configure_defines().is_err() {
            // Fall through to spin() → shutdown() for full teardown under
            // the API lock (flushLogs runs JS). Set terminate so spin()
            // bails immediately; vm.log carries the error for flushLogs.
            vm.exit_handler.exit_code = 1;
            let _ = self.set_requested_terminate();
            return Ok(());
        }

        vm.load_extra_env_and_source_code_printer();
        Ok(())
    }

    /// Phase 2: load the entry point, dispatch 'online', run the event loop.
    /// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
    fn spin(&mut self) -> ! {
        log!("[{}] spin start", self.execution_context_id);

        // PORT NOTE: reshaped for borrowck — vm borrowed mutably through self
        // repeatedly; cannot hold across self.shutdown() calls.
        debug_assert!(self.status == Status::Start);
        self.set_status(Status::Starting);

        // Terminated during startVM() (or startVM() short-circuited here on
        // configureDefines failure) — shut down under the API lock so the
        // JSC::VM built by initWorker is torn down rather than leaked.
        if self.has_requested_terminate() {
            let vm = self.vm.as_deref_mut().unwrap();
            self.flush_logs(vm);
            self.shutdown();
        }

        {
            let vm = self.vm.as_deref_mut().unwrap();
            // TODO(port): vm.preload expects [][]const u8; Phase B reconciles
            // Box<[u8]> vs &[u8].
            vm.preload = &self.preloads;
        }

        // Resolve the entry point on the worker thread (the parent only stored
        // the raw specifier). The returned slice is BORROWED — every exit from
        // spin() goes through shutdown() which is noreturn, so a `defer free`
        // here would never run anyway.
        let mut resolve_error = BunString::empty();
        let path = {
            let vm = self.vm.as_deref_mut().unwrap();
            match resolve_entry_point_specifier(
                vm,
                &self.unresolved_specifier,
                &mut resolve_error,
                vm.log,
            ) {
                Some(p) => p,
                None => {
                    vm.exit_handler.exit_code = 1;
                    if vm.log.errors == 0 && !resolve_error.is_empty() {
                        let err = resolve_error.to_utf8();
                        vm.log.add_error(None, logger::Loc::Empty, err.as_slice());
                    }
                    resolve_error.deref();
                    self.flush_logs(vm);
                    self.shutdown();
                }
            }
        };
        resolve_error.deref();

        // Terminated while resolving — exit code 0, no error.
        if self.has_requested_terminate() {
            let vm = self.vm.as_deref_mut().unwrap();
            self.flush_logs(vm);
            self.shutdown();
        }

        let promise = {
            let vm = self.vm.as_deref_mut().unwrap();
            match vm.load_entry_point_for_web_worker(path) {
                Ok(p) => p,
                Err(_) => {
                    // process.exit() may have run during load; don't clobber
                    // its code.
                    if !self.exit_called {
                        vm.exit_handler.exit_code = 1;
                    }
                    self.flush_logs(vm);
                    self.shutdown();
                }
            }
        };

        {
            let vm = self.vm.as_deref_mut().unwrap();
            if promise.status() == jsc::PromiseStatus::Rejected {
                let handled = vm.uncaught_exception(vm.global, promise.result(vm.jsc_vm), true);

                if !handled {
                    vm.exit_handler.exit_code = 1;
                    self.shutdown();
                }
            } else {
                let _ = promise.result(vm.jsc_vm);
            }
        }

        {
            let vm = self.vm.as_deref_mut().unwrap();
            self.flush_logs(vm);
        }
        log!("[{}] event loop start", self.execution_context_id);
        // dispatchOnline fires the parent-side 'open' event and flips the C++
        // state to Running (which routes postMessage directly instead of
        // queuing). It is placed after the entry point has loaded so the
        // parent observes 'online' only once the worker's top-level code has
        // completed; moving it earlier would change that observable ordering.
        {
            let vm = self.vm.as_deref().unwrap();
            // SAFETY: cpp_worker valid for the lifetime of this struct.
            unsafe {
                WebWorker__dispatchOnline(self.cpp_worker, vm.global as *const _ as *mut _);
                WebWorker__fireEarlyMessages(self.cpp_worker, vm.global as *const _ as *mut _);
            }
        }
        self.set_status(Status::Running);

        {
            let vm = self.vm.as_deref_mut().unwrap();
            // don't run the GC if we don't actually need to
            if vm.is_event_loop_alive() || vm.event_loop().tick_concurrent_with_count() > 0 {
                vm.global.vm().release_weak_refs();
                let _ = vm.arena_gc();
                let _ = vm.global.vm().run_gc(false);
            }

            // Always do a first tick so we call CppTask without delay after
            // dispatchOnline.
            vm.tick();

            while vm.is_event_loop_alive() {
                vm.tick();
                if self.has_requested_terminate() {
                    break;
                }
                vm.event_loop().auto_tick_active();
                if self.has_requested_terminate() {
                    break;
                }
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
            self.vm.as_deref_mut().unwrap().on_before_exit();
        }

        {
            let vm = self.vm.as_deref_mut().unwrap();
            self.flush_logs(vm);
        }
        self.shutdown();
    }

    /// Phase 3: run exit handlers, tear down the JSC VM, post the close event,
    /// free the arena, exit the thread.
    ///
    /// Ordering constraints (each step is a barrier for the next):
    ///   1. `vm = null` under lock    — a racing notifyNeedTermination() now
    ///                                  sees null and skips wakeup() instead of
    ///                                  touching memory freed in step 5.
    ///   2. `vm.onExit()`             — user 'exit' handlers run; needs the JSC VM.
    ///   3. `teardownJSCVM()`         — collectNow + vm.deref×2; can re-enter
    ///                                  Zig via finalizers, so must precede step 5.
    ///   4. `dispatchExit()`          — posts close task → parent releases
    ///                                  parent_poll_ref + thread-held Worker ref.
    ///                                  After this `this` may be freed at any time.
    ///   5. free loop/arena/pools     — no `this.*` dereferences below step 4.
    ///
    /// Does NOT free `this` — see ownership rule in the file header.
    fn shutdown(&mut self) -> ! {
        jsc::mark_binding(core::panic::Location::caller());
        self.set_status(Status::Terminated);
        bun_core::analytics::Features::workers_terminated_inc();
        log!("[{}] shutdown", self.execution_context_id);

        // Snapshot everything we'll need after `this` may be freed (step 4).
        let cpp_worker = self.cpp_worker;
        let mut arena = self.arena.take();

        // ---- 1. Unpublish vm ------------------------------------------------
        let mut vm_to_deinit: Option<Box<jsc::VirtualMachine>> = None;
        let mut loop_: Option<*mut bun_uws::Loop> = None;
        {
            let _g = self.vm_lock.lock();
            if let Some(vm) = self.vm.take() {
                loop_ = Some(vm.uws_loop());
                vm_to_deinit = Some(vm);
            }
        }

        // ---- 2. User exit handlers -----------------------------------------
        let mut exit_code: i32 = 0;
        let mut global_object: Option<*mut JSGlobalObject> = None;
        if let Some(vm) = vm_to_deinit.as_deref_mut() {
            // terminate() set the JSC termination flag to interrupt running JS;
            // clear it so process.on('exit') handlers can run. teardownJSCVM
            // re-sets it for the JSC VM teardown.
            vm.jsc_vm.clear_has_termination_request();
            vm.is_shutting_down = true;
            vm.on_exit();
            jsc::api::cron::CronJob::clear_all_for_vm(vm, jsc::api::cron::ClearReason::Teardown);
            // Embedded socket groups must drain while JSC is still alive —
            // closeAll() fires on_close → JS callbacks. RareData.deinit() runs
            // after teardownJSCVM and only deinit()s (asserts empty in debug).
            if let Some(rare) = vm.rare_data.as_mut() {
                rare.close_all_socket_groups(vm);
            }
            exit_code = vm.exit_handler.exit_code;
            global_object = Some(vm.global as *const _ as *mut _);
        }

        // ---- 3. JSC VM teardown --------------------------------------------
        if let Some(global) = global_object {
            // SAFETY: global valid; JSC VM still alive at this point.
            unsafe { WebWorker__teardownJSCVM(global) };
        }

        // JSC is down; no more resolver/module-loader access past this point.
        // Unregister so the main thread's terminateAllAndWait() can proceed to
        // free process-global resolver state. Must happen before dispatchExit
        // because `this` may be freed once that posts.
        live_workers::unregister(self as *mut _);

        // ---- 4. Post close task to parent ----------------------------------
        // SAFETY: cpp_worker valid (snapshot taken above).
        unsafe { WebWorker__dispatchExit(cpp_worker, exit_code) };
        // `this` may be freed past this point.

        // ---- 5. Free worker-thread resources -------------------------------
        if let Some(loop_) = loop_ {
            // SAFETY: loop owned by this thread's VM; no concurrent access.
            unsafe { (*loop_).internal_loop_data.jsc_vm = core::ptr::null_mut() };
        }
        if let Some(vm) = vm_to_deinit.as_deref_mut() {
            // Must precede Loop.shutdown so uv_close isn't called twice on the
            // GC timer.
            vm.gc_controller.deinit();
        }
        #[cfg(windows)]
        {
            bun_sys::windows::libuv::Loop::shutdown();
        }
        if let Some(vm) = vm_to_deinit {
            // TODO(port): vm.deinit() — Box<VirtualMachine> drop vs explicit
            // deinit; Zig calls vm.deinit() then arena frees the storage.
            drop(vm);
        }
        bun_core::delete_all_pools_for_thread_exit();
        if let Some(arena_) = arena.take() {
            drop(arena_);
        }

        bun_core::exit_thread();
    }

    /// process.exit() inside the worker. Worker-thread only.
    pub fn exit(&mut self) {
        self.exit_called = true;
        let _ = self.set_requested_terminate();
        // Stop subsequent JS at the next safepoint. `this.vm` is null during
        // `vm.onExit()` (shutdown nulls it first), so a re-entrant
        // process.exit() from an exit handler does not re-arm the trap.
        if let Some(vm) = self.vm.as_deref() {
            vm.jsc_vm.notify_need_termination();
        }
    }

    // =========================================================================
    // Helpers (worker thread)
    // =========================================================================

    fn set_status(&mut self, status: Status) {
        log!(
            "[{}] status: {}",
            self.execution_context_id,
            <&'static str>::from(status)
        );
        self.status = status;
    }

    fn flush_logs(&self, vm: &mut jsc::VirtualMachine) {
        jsc::mark_binding(core::panic::Location::caller());
        if vm.log.msgs.is_empty() {
            return;
        }
        // TODO(port): hoisted from labeled block — Zig used `blk: { } catch |e| switch`
        let result: bun_jsc::JsResult<(JSValue, BunString)> = (|| {
            let err = vm.log.to_js(vm.global, "Error in worker")?;
            let str = err.to_bun_string(vm.global)?;
            Ok((err, str))
        })();
        let (err, str) = match result {
            Ok(pair) => pair,
            Err(e) => match e {
                bun_jsc::JsError::Thrown => panic!("unhandled exception"),
                bun_jsc::JsError::OutOfMemory => bun_core::out_of_memory(),
                bun_jsc::JsError::Terminated => panic!("unhandled exception"),
            },
        };
        let _str_guard = scopeguard::guard((), |_| str.deref());
        let dispatch = jsc::from_js_host_call_generic(
            vm.global,
            core::panic::Location::caller(),
            |g, cpp, s, e| unsafe { WebWorker__dispatchError(g, cpp, s, e) },
            (vm.global as *const _ as *mut _, self.cpp_worker, str, err),
        );
        if let Err(e) = dispatch {
            let _ = vm.global.report_uncaught_exception(
                vm.global
                    .take_exception(e)
                    .as_exception(vm.global.vm())
                    .unwrap(),
            );
        }
    }
}

extern "C" fn opaque_spin_trampoline(ctx: *mut c_void) {
    // SAFETY: ctx is `*mut WebWorker` passed from thread_main via holdAPILock;
    // valid for the duration of the API lock callback.
    let this = unsafe { &mut *(ctx as *mut WebWorker<'_>) };
    this.spin();
}

fn on_unhandled_rejection(
    vm: &mut jsc::VirtualMachine,
    global_object: &JSGlobalObject,
    error_instance_or_exception: JSValue,
) {
    // Prevent recursion
    vm.on_unhandled_rejection = jsc::VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;

    let mut error_instance = error_instance_or_exception
        .to_error()
        .unwrap_or(error_instance_or_exception);

    // TODO(port): std.Io.Writer.Allocating → Vec<u8> + io::Write
    let mut array: Vec<u8> = Vec::new();

    let worker = vm.worker.expect("Assertion failure: no worker");
    // SAFETY: vm.worker is a valid *mut WebWorker owned by C++ while vm lives.
    let worker = unsafe { &mut *worker };

    let format_result = jsc::ConsoleObject::format2(
        jsc::ConsoleObject::Kind::Debug,
        global_object,
        &[error_instance],
        1,
        &mut array,
        jsc::ConsoleObject::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            max_depth: 32,
        },
    );
    if let Err(err) = format_result {
        match err {
            bun_jsc::JsError::Thrown => {}
            bun_jsc::JsError::OutOfMemory => {
                let _ = global_object.throw_out_of_memory();
            }
            bun_jsc::JsError::Terminated => {}
        }
        error_instance = global_object.try_take_exception().unwrap();
    }
    // writer.flush() — no-op for Vec<u8>.
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: cpp_worker valid; global_object valid.
    unsafe {
        WebWorker__dispatchError(
            global_object as *const _ as *mut _,
            worker.cpp_worker,
            BunString::clone_utf8(&array),
            error_instance,
        );
    }
    let _ = worker.set_requested_terminate();
    worker.shutdown();
}

/// Resolve a worker entry-point specifier to a path the module loader can
/// consume. The returned slice is BORROWED — it aliases `str`, the standalone
/// module graph, or the resolver's arena; the caller must NOT free it.
fn resolve_entry_point_specifier<'s>(
    parent: &jsc::VirtualMachine,
    str: &'s [u8],
    error_message: &mut BunString,
    logger: &mut logger::Log,
) -> Option<&'s [u8]> {
    // TODO(port): lifetime — return value may alias graph/resolver arena, not
    // just `str`; using 's as a stand-in. Phase B must reconcile.
    if let Some(graph) = parent.standalone_module_graph {
        if graph.find(str).is_some() {
            return Some(str);
        }

        // Since `bun build --compile` renames files to `.js` by
        // default, we need to do the reverse of our file extension
        // mapping.
        //
        //   new Worker("./foo") -> new Worker("./foo.js")
        //   new Worker("./foo.ts") -> new Worker("./foo.js")
        //   new Worker("./foo.jsx") -> new Worker("./foo.js")
        //   new Worker("./foo.mjs") -> new Worker("./foo.js")
        //   new Worker("./foo.mts") -> new Worker("./foo.js")
        //   new Worker("./foo.cjs") -> new Worker("./foo.js")
        //   new Worker("./foo.cts") -> new Worker("./foo.js")
        //   new Worker("./foo.tsx") -> new Worker("./foo.js")
        //
        if str.starts_with(b"./") || str.starts_with(b"../") {
            'try_from_extension: {
                let mut pathbuf = bun_paths::PathBuffer::uninit();
                let base = bun_paths::join_abs_string_buf(
                    bun_standalone::StandaloneModuleGraph::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX,
                    &mut pathbuf,
                    &[str],
                    bun_paths::Platform::Loose,
                );
                let base_len = base.len();
                // TODO(port): std.fs.path.extension → bun_paths::extension
                let extname = bun_paths::extension(base);

                // ./foo -> ./foo.js
                if extname.is_empty() {
                    pathbuf[base_len..base_len + 3].copy_from_slice(b".js");
                    if let Some(js_file) = graph.find(&pathbuf[0..base_len + 3]) {
                        return Some(js_file.name);
                    }
                    break 'try_from_extension;
                }

                // ./foo.ts -> ./foo.js
                if extname == b".ts" {
                    pathbuf[base_len - 3..base_len].copy_from_slice(b".js");
                    if let Some(js_file) = graph.find(&pathbuf[0..base_len]) {
                        return Some(js_file.name);
                    }
                    break 'try_from_extension;
                }

                if extname.len() == 4 {
                    const EXTS: [&[u8]; 6] =
                        [b".tsx", b".jsx", b".mjs", b".mts", b".cts", b".cjs"];
                    for ext in EXTS {
                        if extname == ext {
                            let js_len = b".js".len();
                            pathbuf[base_len - ext.len()..base_len - ext.len() + js_len]
                                .copy_from_slice(b".js");
                            let as_js = &pathbuf[0..base_len - ext.len() + js_len];
                            if let Some(js_file) = graph.find(as_js) {
                                return Some(js_file.name);
                            }
                            break 'try_from_extension;
                        }
                    }
                }
            }
        }
    }

    if bun_webcore::ObjectURLRegistry::is_blob_url(str) {
        if bun_webcore::ObjectURLRegistry::singleton().has(&str[b"blob:".len()..]) {
            return Some(str);
        } else {
            *error_message = BunString::static_("Blob URL is missing");
            return None;
        }
    }

    let mut resolved_entry_point: bun_resolver::Result =
        match parent.transpiler.resolve_entry_point(str) {
            Ok(r) => r,
            Err(_) => {
                // TODO(port): hoisted from labeled block
                let out: bun_jsc::JsResult<BunString> = (|| {
                    let out = logger.to_js(parent.global, "Error resolving Worker entry point")?;
                    out.to_bun_string(parent.global)
                })();
                match out {
                    Ok(out) => {
                        *error_message = out;
                        return None;
                    }
                    Err(bun_jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(bun_jsc::JsError::Thrown) => {
                        *error_message = BunString::static_("unexpected exception");
                        return None;
                    }
                    Err(bun_jsc::JsError::Terminated) => {
                        *error_message = BunString::static_("unexpected exception");
                        return None;
                    }
                }
            }
        };

    let Some(entry_path) = resolved_entry_point.path() else {
        *error_message = BunString::static_("Worker entry point is missing");
        return None;
    };
    Some(entry_path.text)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/web_worker.zig (981 lines)
//   confidence: medium
//   todos:      22
//   notes:      cross-thread struct: BORROW_PARAM 'a on FFI-owned heap struct + intrusive list + arena-backed Box<VirtualMachine> need Phase B redesign; spin()/flush_logs reshaped heavily for borrowck (vm re-borrowed per block)
// ──────────────────────────────────────────────────────────────────────────
