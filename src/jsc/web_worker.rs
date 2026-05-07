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
//!
//! ──────────────────────────────────────────────────────────────────────────
//! Layering note (PORTING.md §Dispatch): the worker thread bodies reach into
//! `bun_runtime` / `bun_standalone` types (`cli::Command` parse,
//! `bun_js::applyStandaloneRuntimeFlags`, `StandaloneModuleGraph::find`,
//! `api::cron::CronJob`). Those calls are routed through
//! `virtual_machine::RuntimeHooks` slots added for this file
//! (`parse_worker_exec_argv`, `apply_standalone_runtime_flags`,
//! `standalone_graph_find`, `standalone_graph_base_path`,
//! `cron_clear_all_for_vm`); `has_blob_url` was already present. The high tier
//! installs the table at startup via `set_runtime_hooks`.
//! ──────────────────────────────────────────────────────────────────────────

use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::posix_event_loop::get_vm_ctx;
use bun_aio::{AllocatorType, KeepAlive};
use bun_alloc::Arena;
use bun_string::{String as BunString, WTFStringImpl};
use bun_threading::{Futex, Mutex};

use crate::virtual_machine::{runtime_hooks, VirtualMachine};
use crate::{self as jsc, JSGlobalObject, JSValue, JsError, JsResult, LogJsc};

bun_core::declare_scope!(Worker, hidden);

macro_rules! log {
    ($($arg:tt)*) => { bun_core::scoped_log!(Worker, $($arg)*) };
}

// ---- Immutable after `create()` (safe from any thread) ----------------------

pub struct WebWorker {
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
    // TODO(port): lifetime — `&'a VirtualMachine` in Zig; raw ptr here because
    // the struct is FFI-owned and crosses threads.
    parent: *mut VirtualMachine,
    parent_context_id: u32,
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
    // TODO(port): owned NUL-terminated bytes; Zig was `[:0]const u8`.
    name: bun_core::ZBox,

    // ---- Cross-thread signalling --------------------------------------------

    /// Intrusive node for the process-global `LiveWorkers` list. Registered
    /// before the thread is spawned; removed in `shutdown()` once the worker is
    /// past all process-global resolver access.
    ///
    /// `UnsafeCell` because `terminate_all_and_wait` walks the list through
    /// `&WebWorker` while `register`/`unregister` (under `live_workers::MUTEX`)
    /// write these on another thread — the mutex serialises memory ops, but
    /// Rust's aliasing model still requires interior mutability.
    // TODO(port): intrusive doubly-linked list node — `bun_collections` has no
    // `IntrusiveList` yet; raw next/prev pointers used directly.
    live_next: UnsafeCell<*mut WebWorker>,
    live_prev: UnsafeCell<*mut WebWorker>,

    /// Set by the parent (`notifyNeedTermination`) or by the worker itself
    /// (`exit`). The worker loop polls this between ticks.
    requested_terminate: AtomicBool,

    /// The worker's `jsc.VirtualMachine`, or null before `startVM()` / after
    /// `shutdown()` nulls it. Lives inside `arena`. `vm_lock` must be held for
    /// any cross-thread read (see header comment).
    ///
    /// `UnsafeCell` because this is read through `&WebWorker` on the parent /
    /// main thread (`notify_need_termination`, `terminate_all_and_wait`, `exit`)
    /// and written on the worker thread (`start_vm`, `shutdown`) — `vm_lock`
    /// serialises the memory ops, but Rust's aliasing model still requires
    /// interior mutability for a field written while a `&WebWorker` may be live.
    vm: UnsafeCell<*mut VirtualMachine>,
    vm_lock: Mutex,

    // ---- Parent-thread only -------------------------------------------------

    /// Keep-alive on the parent's event loop. `Async.KeepAlive` is not
    /// thread-safe; it is reffed in `create()`, toggled by `setRef()` (JS
    /// `.ref()`/`.unref()`), and released by `releaseParentPollRef()` from the
    /// close task — all on the parent thread.
    ///
    /// `UnsafeCell` because the worker thread holds `&WebWorker` concurrently;
    /// `KeepAlive::ref_/unref` need `&mut`. Only the parent thread touches it.
    parent_poll_ref: UnsafeCell<KeepAlive>,

    // ---- Worker-thread only -------------------------------------------------
    // These are mutated only on the worker thread, but the worker-thread call
    // chain takes `&self` (NOT `&mut self`) because the parent / main thread
    // may concurrently hold `&WebWorker` (`notify_need_termination`,
    // `terminate_all_and_wait`); materialising `&mut WebWorker` on the worker
    // thread while another thread holds `&WebWorker` is aliased-&mut UB. Hence
    // `Cell` / `UnsafeCell` even for single-threaded data.

    status: Cell<Status>,
    // PERF(port): was MimallocArena bulk-free backing the worker VM — keep as
    // explicit arena rather than deleting per §Allocators non-AST rule, because
    // the VM's allocator IS this arena (load-bearing). Profile in Phase B.
    arena: UnsafeCell<Option<Box<Arena>>>,
    /// Set by `exit()` so that `spin()`'s error paths don't clobber an explicit
    /// `process.exit(code)`. Atomic so `exit()` can take `&self` (the struct is
    /// observed concurrently by `terminate_all_and_wait` / parent-thread FFI;
    /// producing `&mut WebWorker` while another thread holds `&WebWorker` is UB).
    exit_called: AtomicBool,
}

// SAFETY: All cross-thread fields are atomic or guarded by `vm_lock` /
// `live_workers::MUTEX`; per-thread `Cell`/`UnsafeCell` fields are touched only
// on their owning thread (see field-group comments). The struct itself never
// moves between threads — it is shared by raw pointer.
unsafe impl Send for WebWorker {}
unsafe impl Sync for WebWorker {}

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
// `JSGlobalObject` is an opaque FFI handle (ZST); per codebase convention
// (see JSGlobalObject.rs externs) it crosses FFI as `*const` even when C++
// mutates — Rust never reads/writes bytes through it, so no `*mut` needed.
unsafe extern "C" {
    fn WebWorker__teardownJSCVM(global: *const JSGlobalObject);
    fn WebWorker__dispatchExit(cpp_worker: *mut c_void, exit_code: i32);
    fn WebWorker__dispatchOnline(cpp_worker: *mut c_void, global: *const JSGlobalObject);
    fn WebWorker__fireEarlyMessages(cpp_worker: *mut c_void, global: *const JSGlobalObject);
    fn WebWorker__dispatchError(
        global: *const JSGlobalObject,
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

    // PORT NOTE: `Mutex::new()` is the prevailing const-init spelling across
    // un-gated jsc modules (ConsoleObject.rs, bundler/ThreadPool.rs); the
    // `bun_threading` crate provides it.
    pub(super) static MUTEX: Mutex = Mutex::new();
    // TODO(port): std.DoublyLinkedList — intrusive, nodes are `WebWorker.live_{next,prev}`
    pub(super) static mut HEAD: *mut WebWorker = core::ptr::null_mut();
    /// Number of workers registered in `list`. Separate atomic so
    /// `terminateAllAndWait` can futex-wait on it without the mutex.
    pub(super) static OUTSTANDING: AtomicU32 = AtomicU32::new(0);

    pub(super) fn register(worker: *mut WebWorker) {
        MUTEX.lock();
        // SAFETY: MUTEX held; `worker` is a valid heap allocation owned by C++.
        unsafe {
            *(*worker).live_prev.get() = core::ptr::null_mut();
            *(*worker).live_next.get() = HEAD;
            if !HEAD.is_null() {
                *(*HEAD).live_prev.get() = worker;
            }
            HEAD = worker;
        }
        // fetch_add and wake MUST happen under MUTEX (matching the Zig
        // `defer mutex.unlock()` ordering) so that `terminate_all_and_wait`
        // can never observe the worker in the list while OUTSTANDING is still
        // at its pre-increment value — otherwise it could sweep B, see
        // OUTSTANDING==0 (A's unregister already ran, B's add hasn't), and
        // return early while B is still starting.
        OUTSTANDING.fetch_add(1, Ordering::Release);
        // Wake terminateAllAndWait so it re-sweeps and catches this worker
        // (it may have been created by another worker mid-sweep). No-op if
        // nothing is waiting.
        Futex::wake(&OUTSTANDING, 1);
        MUTEX.unlock();
    }

    // `*const WebWorker` (not `*mut`): called from `shutdown(&self)` while
    // other threads may hold `&WebWorker`, so the caller only has shared-ref
    // provenance. All writes here go through `UnsafeCell` fields
    // (`live_next`/`live_prev`), which is sound via shared provenance.
    pub(super) fn unregister(worker: *const WebWorker) {
        MUTEX.lock();
        // SAFETY: MUTEX held; node was registered in `register`.
        unsafe {
            let prev = *(*worker).live_prev.get();
            let next = *(*worker).live_next.get();
            if !prev.is_null() {
                *(*prev).live_next.get() = next;
            } else {
                HEAD = next;
            }
            if !next.is_null() {
                *(*next).live_prev.get() = prev;
            }
            *(*worker).live_prev.get() = core::ptr::null_mut();
            *(*worker).live_next.get() = core::ptr::null_mut();
        }
        MUTEX.unlock();
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
    let timer = std::time::Instant::now();
    let deadline_ns: u64 = timeout_ms * 1_000_000; // std.time.ns_per_ms
    loop {
        live_workers::MUTEX.lock();
        // SAFETY: MUTEX held while walking the intrusive list.
        let mut it = unsafe { live_workers::HEAD };
        while !it.is_null() {
            // SAFETY: worker valid while registered (removed only in shutdown()).
            let w = unsafe { &*it };
            // SAFETY: live_workers::MUTEX held; list links written only under it.
            it = unsafe { *w.live_next.get() };
            if w.requested_terminate.swap(true, Ordering::Release) {
                continue;
            }
            w.vm_lock.lock();
            // SAFETY: vm_lock held; `vm` is published/unpublished under vm_lock.
            let vm_ptr = unsafe { *w.vm.get() };
            if !vm_ptr.is_null() {
                // SAFETY: vm_ptr published under vm_lock and non-null here.
                // jsc_vm is a valid JSC::VM*; notify_need_termination is
                // documented thread-safe (VMTraps). We deliberately do NOT
                // bind `&VirtualMachine` — the worker thread may hold a live
                // mutable view of the VM; raw-pointer field/method access
                // keeps any autoref scoped to the access.
                unsafe { (*(*vm_ptr).jsc_vm).notify_need_termination() };
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
pub extern "C" fn WebWorker__getParentWorker(vm: &VirtualMachine) -> *mut c_void {
    match vm.worker {
        // SAFETY: `worker` is a `*const c_void` pointing at a heap `WebWorker`
        // owned by C++ while `vm` lives.
        Some(worker) => unsafe { (*(worker as *mut WebWorker)).cpp_worker },
        None => core::ptr::null_mut(),
    }
}

impl WebWorker {
    pub fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
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
        if self.argv_ptr.is_null() {
            return &[];
        }
        // SAFETY: `argv_ptr[..argv_len]` is borrowed from C++ WorkerOptions
        // (BACKREF — kept alive by the owning Worker for `self`'s lifetime).
        unsafe { core::slice::from_raw_parts(self.argv_ptr, self.argv_len) }
    }

    /// Zig: `worker.execArgv: ?[]const WTFStringImpl` — `None` when
    /// `inherit_exec_argv` (the worker inherits the parent's execArgv),
    /// otherwise `Some(slice)` (possibly empty) borrowed from C++ WorkerOptions.
    #[inline]
    pub fn exec_argv(&self) -> Option<&[WTFStringImpl]> {
        if self.inherit_exec_argv {
            return None;
        }
        if self.exec_argv_ptr.is_null() {
            return Some(&[]);
        }
        // SAFETY: see `argv()`.
        Some(unsafe { core::slice::from_raw_parts(self.exec_argv_ptr, self.exec_argv_len) })
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
    #[unsafe(export_name = "WebWorker__create")]
    pub extern "C" fn create(
        cpp_worker: *mut c_void,
        parent: *mut VirtualMachine,
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
    ) -> *mut WebWorker {
        jsc::mark_binding();
        log!("[{}] create", this_context_id);

        let spec_slice = specifier_str.to_utf8();
        // SAFETY: `parent` is the live per-thread VM on the calling (parent)
        // thread; C++ passes the result of `Bun::vm(globalObject)`.
        let parent_ref = unsafe { &mut *parent };
        let prev_log = parent_ref.transpiler.log;
        let mut temp_log = bun_logger::Log::default();
        parent_ref.transpiler.set_log(&mut temp_log);
        // RAII: restore parent log + drop temp_log on scope exit (Zig `defer`).
        struct RestoreLog<'a> {
            parent: &'a mut VirtualMachine,
            prev: *mut bun_logger::Log,
        }
        impl Drop for RestoreLog<'_> {
            fn drop(&mut self) {
                self.parent.transpiler.set_log(self.prev);
            }
        }
        let _restore = RestoreLog { parent: parent_ref, prev: prev_log };
        let parent_ref = &mut *_restore.parent;

        let preload_modules: &[BunString] = if preload_modules_ptr.is_null() {
            &[]
        } else {
            // SAFETY: caller passed valid (ptr,len); slice borrowed from C++
            // WorkerOptions kept alive by the owning Worker.
            unsafe { core::slice::from_raw_parts(preload_modules_ptr, preload_modules_len) }
        };

        let mut preloads: Vec<Box<[u8]>> = Vec::with_capacity(preload_modules_len);
        for module in preload_modules {
            let utf8_slice = module.to_utf8();
            if let Some(preload) = resolve_entry_point_specifier(
                parent_ref,
                utf8_slice.slice(),
                error_message,
                &mut temp_log,
            ) {
                preloads.push(Box::<[u8]>::from(preload));
            }
            // `defer utf8_slice.deinit()` — ZigStringSlice::Drop.
            drop(utf8_slice);

            if !error_message.is_empty() {
                // preloads freed by Drop.
                return core::ptr::null_mut();
            }
        }

        let name = if !name_str.is_empty() {
            // Zig: `std.fmt.allocPrintSentinel(..., "{f}", .{name_str}, 0)` —
            // i.e. format as UTF-8 + NUL-terminate.
            name_str.to_owned_slice_z()
        } else {
            bun_core::ZBox::default()
        };

        let worker = Box::into_raw(Box::new(WebWorker {
            cpp_worker,
            parent,
            parent_context_id,
            execution_context_id: this_context_id,
            mini,
            eval_mode,
            unresolved_specifier: spec_slice.into_vec().into_boxed_slice(),
            store_fd: parent_ref.transpiler.resolver.store_fd,
            name,
            argv_ptr,
            argv_len,
            exec_argv_ptr: if inherit_exec_argv { core::ptr::null() } else { exec_argv_ptr },
            exec_argv_len: if inherit_exec_argv { 0 } else { exec_argv_len },
            inherit_exec_argv,
            preloads,
            live_next: UnsafeCell::new(core::ptr::null_mut()),
            live_prev: UnsafeCell::new(core::ptr::null_mut()),
            requested_terminate: AtomicBool::new(false),
            vm: UnsafeCell::new(core::ptr::null_mut()),
            vm_lock: Mutex::new(),
            parent_poll_ref: UnsafeCell::new(KeepAlive::default()),
            status: Cell::new(Status::Start),
            arena: UnsafeCell::new(None),
            exit_called: AtomicBool::new(false),
        }));

        // Keep the parent's event loop alive until the close task releases this.
        // If the user passed `{ ref: false }` we skip — they've opted out of the
        // worker keeping the process alive.
        if !default_unref {
            // SAFETY: parent-thread only; no concurrent access yet (thread not
            // spawned). `get_vm_ctx(Js)` resolves the calling thread's
            // VirtualMachine — which is `parent`.
            unsafe { (*(*worker).parent_poll_ref.get()).ref_(get_vm_ctx(AllocatorType::Js)) };
        }

        // Register BEFORE spawning so terminateAllAndWait() can never miss a
        // worker whose thread is already running.
        live_workers::register(worker);

        let worker_send = SendPtr(worker);
        let spawn_result = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || {
                let worker = worker_send;
                // SAFETY: `worker.0` is a valid heap allocation owned by C++;
                // see file-header ownership rule.
                unsafe { (*worker.0).thread_main() };
            });
        match spawn_result {
            Ok(handle) => {
                // Detached — see "Known gap" in file header.
                drop(handle);
                worker
            }
            Err(_) => {
                live_workers::unregister(worker);
                // SAFETY: parent-thread only; thread never spawned.
                unsafe {
                    (*(*worker).parent_poll_ref.get()).unref(get_vm_ctx(AllocatorType::Js));
                }
                Self::destroy(worker);
                *error_message = BunString::static_(b"Failed to spawn worker thread");
                core::ptr::null_mut()
            }
        }
    }

    /// Free the struct and its owned strings. Called from
    /// `WebCore::Worker::~Worker()` (or from `create()` on spawn failure). The
    /// allocator is mimalloc (thread-safe), so the caller's thread doesn't
    /// matter.
    #[unsafe(export_name = "WebWorker__destroy")]
    pub extern "C" fn destroy(this: *mut WebWorker) {
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
    ///
    /// Takes `*mut` (not `&mut`) because the worker thread concurrently
    /// dereferences this struct; materialising `&mut WebWorker` here would be
    /// aliased-&mut UB.
    #[unsafe(export_name = "WebWorker__setRef")]
    pub extern "C" fn set_ref(this: *mut WebWorker, value: bool) {
        // SAFETY: `this` valid (see fn doc). Parent-thread only field;
        // `get_vm_ctx(Js)` resolves the calling thread's VirtualMachine,
        // which is `this.parent` (always called on the parent thread).
        unsafe {
            let poll_ref = &mut *(*this).parent_poll_ref.get();
            if value {
                poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            } else {
                poll_ref.unref(get_vm_ctx(AllocatorType::Js));
            }
        }
    }

    /// worker.terminate() from JS. Sets `requested_terminate`, interrupts
    /// running JS in the worker (TerminationException at the next safepoint),
    /// and wakes the worker loop so it observes the flag. `parent_poll_ref`
    /// stays held until the close task runs so that `await worker.terminate()`
    /// keeps the parent alive until 'close' fires.
    ///
    /// Takes `*mut` (not `&mut`) because the worker thread concurrently
    /// dereferences this struct (polling `requested_terminate`, holding
    /// `vm_lock`, reading `vm`); materialising `&mut WebWorker` on the parent
    /// thread while the worker holds any reference is aliased-&mut UB.
    #[unsafe(export_name = "WebWorker__notifyNeedTermination")]
    pub extern "C" fn notify_need_termination(this: *mut WebWorker) {
        // SAFETY: `this` is a valid heap allocation owned by C++ `WebCore::Worker`
        // (alive while JSWorker holds its Ref). Only atomic / lock-guarded
        // fields are touched cross-thread; never `&mut WebWorker`.
        let this = unsafe { &*this };
        if this.set_requested_terminate() {
            return;
        }
        log!("[{}] notifyNeedTermination", this.execution_context_id);

        // vm_lock serialises against shutdown() nulling `vm` and freeing the
        // arena it lives in.
        this.vm_lock.lock();
        // SAFETY: vm_lock held; `vm` is published/unpublished under vm_lock.
        let vm_ptr = unsafe { *this.vm.get() };
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr published under vm_lock and non-null here.
            // jsc_vm is a valid JSC::VM*; notify_need_termination is
            // documented thread-safe (VMTraps). No `&VirtualMachine` binding
            // — see `terminate_all_and_wait`.
            unsafe { (*(*vm_ptr).jsc_vm).notify_need_termination() };
            // SAFETY: event_loop() returns the live `*mut EventLoop` self-ptr.
            unsafe { (*(*vm_ptr).event_loop()).wakeup() };
        }
        this.vm_lock.unlock();
    }

    /// Release the keep-alive on the parent's event loop. Called on the parent
    /// thread from the close task posted by `dispatchExit`.
    ///
    /// Takes `*mut` for consistency with the other parent-thread FFI exports
    /// (the worker thread has exited by the time this runs, so `&mut` would be
    /// sound here, but matching signatures avoids surprises).
    #[unsafe(export_name = "WebWorker__releaseParentPollRef")]
    pub extern "C" fn release_parent_poll_ref(this: *mut WebWorker) {
        // SAFETY: `this` valid; parent-thread only field. See `set_ref`.
        unsafe {
            (*(*this).parent_poll_ref.get()).unref(get_vm_ctx(AllocatorType::Js));
        }
    }

    /// Raw parent-VM pointer. See field doc for validity (`parent_poll_ref`
    /// keeps the parent loop alive until the close task runs).
    #[inline]
    pub fn parent_vm(&self) -> *mut VirtualMachine {
        self.parent
    }

    #[inline]
    pub fn execution_context_id(&self) -> u32 {
        self.execution_context_id
    }

    /// The owning C++ `WebCore::Worker`. Never null; this struct is freed by
    /// `~Worker`, so the pointer cannot dangle. Passed as `worker_ptr` to
    /// `Zig__GlobalObject__create` so the ZigGlobalObject is born with its
    /// WorkerGlobalScope wired.
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

    // Worker-thread call chain takes `&self` (NOT `&mut self`): the parent /
    // main thread may concurrently hold `&WebWorker` (`notify_need_termination`,
    // `terminate_all_and_wait`), so materialising `&mut WebWorker` here would
    // be aliased-&mut UB. Worker-thread-only mutable fields are wrapped in
    // `Cell` / `UnsafeCell` instead. Zig spec uses `*WebWorker` everywhere,
    // which aliases freely.
    fn thread_main(&self) {
        bun_analytics::features::workers_spawned.fetch_add(1, Ordering::Relaxed);

        if !self.name.is_empty() {
            bun_core::Output::Source::configure_named_thread(self.name.as_zstr());
        } else {
            bun_core::Output::Source::configure_named_thread(bun_core::ZStr::from_static(b"Worker\0"));
        }

        // Terminated before we even started — skip straight to shutdown so the
        // parent still gets a close event and the thread ref is dropped.
        if self.has_requested_terminate() {
            self.shutdown();
        }

        if let Err(err) = self.start_vm() {
            bun_core::Output::panic(format_args!(
                "An unhandled error occurred while starting a worker: {}\n",
                err.name()
            ));
        }

        // SAFETY: start_vm published vm under vm_lock; non-null here. Raw
        // deref — do not bind `&VirtualMachine` (see start_vm publish note).
        let global = unsafe { (*(*self.vm.get())).global };
        // SAFETY: `ctx` is an opaque token — `hold_api_lock` (C++ JSLockHolder)
        // never dereferences it, only passes it back to
        // `opaque_spin_trampoline`, which casts it back to `*const WebWorker`
        // and takes `&WebWorker`. The const→mut cast is signature-only; no
        // write ever occurs through this pointer with mut provenance.
        unsafe {
            (*global).vm().hold_api_lock(
                self as *const WebWorker as *mut c_void,
                opaque_spin_trampoline,
            );
        }
    }

    /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
    fn start_vm(&self) -> Result<(), bun_core::Error> {
        debug_assert!(self.status.get() == Status::Start);
        // SAFETY: worker-thread only; vm is unpublished at this point.
        debug_assert!(unsafe { *self.vm.get() }.is_null());

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");

        // SAFETY: `parent` is non-null and outlives this worker while
        // `parent_poll_ref` is held (see file header). The parent VM runs
        // concurrently on its own thread, so we must NOT materialise a
        // `&mut VirtualMachine` here — Zig's `*T` aliases freely but a
        // Rust `&mut` would assert uniqueness we don't have. All uses
        // below are read-only (clone of transform_options, locked read of
        // proxy_env_storage / env.map, copy of standalone_module_graph),
        // so a shared reference is sufficient and matches the .zig intent.
        let parent = unsafe { &*self.parent };
        let mut transform_options = parent.transpiler.options.transform_options.clone();

        if let Some(exec_argv) = self.exec_argv() {
            // PERF(port): was inline `bun.clap.parseEx` — dispatched through
            // RuntimeHooks because the param table is owned by `bun_cli`
            // (forward dep). The hook reads `--no-addons` etc. and patches
            // `transform_options` in place; parse errors are silently ignored
            // (matches the Zig `catch break :parse_new_args`).
            // SAFETY: hook contract — slice borrowed from C++ WorkerOptions.
            unsafe { (hooks.parse_worker_exec_argv)(exec_argv, &mut transform_options) };
        }

        // PERF(port): Zig `MimallocArena` bulk-free — `bun_alloc::Arena`
        // (= bumpalo::Bump) used here per §Allocators. Boxed so the address
        // stays stable for `vm.arena = NonNull::from(...)`.
        // SAFETY: worker-thread only field; no other thread reads `arena`.
        unsafe { *self.arena.get() = Some(Box::new(Arena::new())) };

        // Proxy-env values may be RefCountedEnvValue bytes owned by the
        // parent's proxy_env_storage. We need a consistent snapshot of
        // (storage slots + env.map entries) so every slice we copy is backed
        // by a ref we hold. The parent's storage.lock serialises against
        // Bun__setEnvValue on the main thread — it covers both the slot swap
        // and the map.put, so cloneFrom and cloneWithAllocator see the same
        // state.
        let mut temp_proxy_storage = jsc::rare_data::ProxyEnvStorage::default();

        let map = Box::leak(Box::new(bun_dotenv::Map::init()));
        {
            let parent_storage = &parent.proxy_env_storage;
            let _g = parent_storage.lock.lock();
            temp_proxy_storage.clone_from(parent_storage);
            // SAFETY: `parent.transpiler.env` is the live per-thread
            // `*mut Loader` set in `init()`; never null after init.
            *map = unsafe { (*parent.transpiler.env).map.clone_with_allocator()? };
        }
        // Ensure map entries point at the exact bytes we hold refs on.
        temp_proxy_storage.sync_into(map);

        let loader = Box::leak(Box::new(bun_dotenv::Loader::init(map)));

        // Checkpoint before the expensive part: initWorker builds a full JSC
        // VM. If terminateAllAndWait() fired while we were cloning the env
        // above, bail now rather than spending ~50–100ms (release) creating a
        // VM that will immediately tear down.
        if self.has_requested_terminate() {
            drop(temp_proxy_storage);
            self.shutdown();
        }

        let vm = VirtualMachine::init_worker(
            self,
            crate::virtual_machine::Options {
                args: transform_options,
                env_loader: NonNull::new(loader),
                store_fd: self.store_fd,
                graph: parent.standalone_module_graph,
                eval: self.eval_mode,
                ..Default::default()
            },
        )?;
        // Pre-publish init: the VM is not yet visible to the parent thread,
        // so a scoped `&mut VirtualMachine` is safe here. The borrow MUST
        // end before the publish below — once `self.vm` is published under
        // `vm_lock`, `notify_need_termination` / `terminate_all_and_wait`
        // may concurrently dereference the same pointer on another thread,
        // and a still-live `&mut VirtualMachine` would be aliased-&mut UB.
        {
            // SAFETY: init_worker returns a valid heap-allocated VM ptr;
            // not yet published, so this `&mut` is exclusive.
            let vm_ref = unsafe { &mut *vm };
            // PORT NOTE: `vm.allocator` dropped per §Allocators (global mimalloc).
            // SAFETY: arena initialised above; worker-thread only field.
            vm_ref.arena =
                NonNull::new(unsafe { (*self.arena.get()).as_deref_mut().unwrap() } as *mut Arena);

            // Move the pre-cloned proxy storage into the worker VM.
            vm_ref.proxy_env_storage = core::mem::take(&mut temp_proxy_storage);

            vm_ref.is_main_thread = false;
            VirtualMachine::set_is_main_thread_vm(false);
            vm_ref.on_unhandled_rejection = on_unhandled_rejection;
        }

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
        self.vm_lock.lock();
        // SAFETY: vm_lock held; this is the publish point.
        unsafe { *self.vm.get() = vm };
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
                (hooks.apply_standalone_runtime_flags)(b as *mut _, graph);
            }
        }

        // Second checkpoint: initWorker just spent the bulk of startup time;
        // if terminate arrived during it, skip configureDefines() (which
        // walks the resolver's global dir_cache) and entry-point loading.
        // spin() will observe the flag and shutdown() under the API lock.
        if self.has_requested_terminate() {
            return Ok(());
        }

        // SAFETY: see post-publish note above.
        unsafe {
            if (*vm).transpiler.configure_defines().is_err() {
                // Fall through to spin() → shutdown() for full teardown under
                // the API lock (flushLogs runs JS). Set terminate so spin()
                // bails immediately; vm.log carries the error for flushLogs.
                (*vm).exit_handler.exit_code = 1;
                let _ = self.set_requested_terminate();
                return Ok(());
            }

            (*vm).load_extra_env_and_source_code_printer();
        }
        Ok(())
    }

    /// Phase 2: load the entry point, dispatch 'online', run the event loop.
    /// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
    fn spin(&self) -> ! {
        log!("[{}] spin start", self.execution_context_id);

        // SAFETY: vm published in start_vm; non-null past this point. Kept
        // as a raw `*mut VirtualMachine` — do NOT bind a long-lived
        // `&mut VirtualMachine`: while the event loop runs, the parent /
        // main thread may dereference the same pointer under `vm_lock`
        // (`notify_need_termination`, `terminate_all_and_wait`). The lock
        // serialises only the pointer LOAD, not a Rust reference lifetime,
        // so a long-lived `&mut` here would be aliased-&mut UB. Per-use
        // `(*vm)` derefs keep any autoref scoped to the single expression.
        let vm: *mut VirtualMachine = unsafe { *self.vm.get() };
        debug_assert!(self.status.get() == Status::Start);
        self.set_status(Status::Starting);

        // Terminated during startVM() (or startVM() short-circuited here on
        // configureDefines failure) — shut down under the API lock so the
        // JSC::VM built by initWorker is torn down rather than leaked.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            self.shutdown();
        }

        // PORT NOTE: reshaped for borrowck — `vm.preload` owns its strings;
        // Zig stored a borrowed slice. Clone the worker's preload list in.
        unsafe { (*vm).preload = self.preloads.clone() };

        // Resolve the entry point on the worker thread (the parent only stored
        // the raw specifier). The returned slice is BORROWED — every exit from
        // spin() goes through shutdown() which is noreturn, so a `defer free`
        // here would never run anyway.
        let mut resolve_error = BunString::empty();
        // SAFETY: vm/global/log valid (post-publish); `log` set in `init()`.
        let log_ptr = unsafe { (*vm).log.unwrap().as_ptr() };
        let path = match resolve_entry_point_specifier(
            unsafe { &mut *vm },
            &self.unresolved_specifier,
            &mut resolve_error,
            unsafe { &mut *log_ptr },
        ) {
            Some(p) => p,
            None => {
                unsafe { (*vm).exit_handler.exit_code = 1 };
                if unsafe { (*log_ptr).errors } == 0 && !resolve_error.is_empty() {
                    let err = resolve_error.to_utf8();
                    // PORT NOTE: `Log::add_error` stores `&'static [u8]`; the
                    // Zig spec passed a heap slice it then freed (the log was
                    // consumed by `flushLogs` first). Use the `_fmt` variant
                    // here so the log owns its copy.
                    bun_core::handle_oom(unsafe {
                        (*log_ptr).add_error_fmt(
                            None,
                            bun_logger::Loc::EMPTY,
                            format_args!("{}", bstr::BStr::new(err.slice())),
                        )
                    });
                }
                resolve_error.deref();
                self.flush_logs(vm);
                self.shutdown();
            }
        };
        resolve_error.deref();

        // Terminated while resolving — exit code 0, no error.
        if self.has_requested_terminate() {
            self.flush_logs(vm);
            self.shutdown();
        }

        let promise = match unsafe { (*vm).load_entry_point_for_web_worker(path) } {
            Ok(p) => p,
            Err(_) => {
                // process.exit() may have run during load; don't clobber its code.
                if !self.exit_called.load(Ordering::Relaxed) {
                    unsafe { (*vm).exit_handler.exit_code = 1 };
                }
                self.flush_logs(vm);
                self.shutdown();
            }
        };

        // SAFETY: `promise` is a live JSC heap cell tracked by the VM.
        if unsafe { (*promise).status() } == jsc::js_promise::Status::Rejected {
            // SAFETY: vm/global/jsc_vm valid; `&*jsc_vm` is opaque interior-mut.
            let result = unsafe { (*promise).result(&*(*vm).jsc_vm) };
            let handled = unsafe { (*vm).uncaught_exception(&*(*vm).global, result, true) };
            if !handled {
                unsafe { (*vm).exit_handler.exit_code = 1 };
                self.shutdown();
            }
        } else {
            // SAFETY: see above.
            let _ = unsafe { (*promise).result(&*(*vm).jsc_vm) };
        }

        self.flush_logs(vm);
        log!("[{}] event loop start", self.execution_context_id);
        // dispatchOnline fires the parent-side 'open' event and flips the C++
        // state to Running (which routes postMessage directly instead of
        // queuing). It is placed after the entry point has loaded so the parent
        // observes 'online' only once the worker's top-level code has completed;
        // moving it earlier would change that observable ordering.
        // SAFETY: cpp_worker valid for the lifetime of this struct;
        // `(*vm).global` is the live `*mut JSGlobalObject` published in start_vm.
        unsafe {
            WebWorker__dispatchOnline(self.cpp_worker, (*vm).global);
            WebWorker__fireEarlyMessages(self.cpp_worker, (*vm).global);
        }
        self.set_status(Status::Running);

        // don't run the GC if we don't actually need to
        unsafe {
            if (*vm).is_event_loop_alive()
                || (*(*vm).event_loop()).tick_concurrent_with_count() > 0
            {
                (*(*vm).global).vm().release_weak_refs();
                // PERF(port): Zig `vm.arena.gc()` — bumpalo has no incremental
                // GC; the mimalloc heap collect is a no-op for now.
                let _ = (*(*vm).global).vm().run_gc(false);
            }

            // Always do a first tick so we call CppTask without delay after
            // dispatchOnline.
            (*vm).tick();

            while (*vm).is_event_loop_alive() {
                (*vm).tick();
                if self.has_requested_terminate() {
                    break;
                }
                (*(*vm).event_loop()).auto_tick_active();
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
            unsafe { (*vm).on_before_exit() };
        }

        self.flush_logs(vm);
        self.shutdown();
    }

    /// Phase 3: run exit handlers, tear down the JSC VM, post the close
    /// event, free the arena, exit the thread.
    ///
    /// Ordering constraints (each step is a barrier for the next):
    ///   1. `vm = null` under lock    — a racing notifyNeedTermination() now
    ///                                  sees null and skips wakeup() instead of
    ///                                  touching memory freed in step 5.
    ///   2. `vm.onExit()`             — user 'exit' handlers run; needs the JSC VM.
    ///   3. `teardownJSCVM()`         — collectNow + vm.deref×2; can re-enter Zig
    ///                                  via finalizers, so must precede step 5.
    ///   4. `dispatchExit()`          — posts close task → parent releases
    ///                                  parent_poll_ref + thread-held Worker ref.
    ///                                  After this `this` may be freed at any time.
    ///   5. free loop/arena/pools     — no `this.*` dereferences below step 4.
    ///
    /// Does NOT free `this` — see ownership rule in the file header.
    fn shutdown(&self) -> ! {
        jsc::mark_binding();
        self.set_status(Status::Terminated);
        bun_analytics::features::workers_terminated.fetch_add(1, Ordering::Relaxed);
        log!("[{}] shutdown", self.execution_context_id);

        // Snapshot everything we'll need after `this` may be freed (step 4).
        let cpp_worker = self.cpp_worker;
        // SAFETY: worker-thread only field; no other thread reads `arena`.
        let mut arena = unsafe { (*self.arena.get()).take() };

        // ---- 1. Unpublish vm ----------------------------------------------
        self.vm_lock.lock();
        // SAFETY: vm_lock held; this is the unpublish point.
        let vm_to_deinit =
            unsafe { core::ptr::replace(self.vm.get(), core::ptr::null_mut()) };
        self.vm_lock.unlock();
        let mut loop_: Option<*mut bun_uws::Loop> = None;
        if !vm_to_deinit.is_null() {
            // SAFETY: vm_to_deinit was published under vm_lock; sole owner now.
            loop_ = Some(unsafe { (*vm_to_deinit).uws_loop() });
        }

        // ---- 2. User exit handlers ----------------------------------------
        let mut exit_code: i32 = 0;
        let mut global_object: Option<*const JSGlobalObject> = None;
        if !vm_to_deinit.is_null() {
            // SAFETY: vm_to_deinit valid; unpublished above under vm_lock, so no
            // other thread can dereference it now — `&mut` is exclusive.
            let vm = unsafe { &mut *vm_to_deinit };
            // terminate() set the JSC termination flag to interrupt running JS;
            // clear it so process.on('exit') handlers can run. teardownJSCVM
            // re-sets it for the JSC VM teardown.
            // SAFETY: `jsc_vm` is the live `*mut VM` for this thread.
            unsafe { (*vm.jsc_vm).clear_has_termination_request() };
            vm.is_shutting_down = true;
            vm.on_exit();
            if let Some(hooks) = runtime_hooks() {
                // SAFETY: hook contract — `vm` is the live per-thread VM.
                unsafe { (hooks.cron_clear_all_for_vm)(vm as *mut _) };
            }
            // Embedded socket groups must drain while JSC is still alive —
            // closeAll() fires on_close → JS callbacks. RareData.deinit() runs
            // after teardownJSCVM and only deinit()s (asserts empty in debug).
            // PORT NOTE: reshaped for borrowck — `close_all_socket_groups`
            // takes `&VirtualMachine`; take the rare_data box out so the
            // `&mut VirtualMachine` borrow doesn't overlap the `&self` it
            // needs.
            if let Some(mut rare) = vm.rare_data.take() {
                rare.close_all_socket_groups(vm);
                vm.rare_data = Some(rare);
            }
            exit_code = i32::from(vm.exit_handler.exit_code);
            global_object = Some(vm.global);
        }

        // ---- 3. JSC VM teardown -------------------------------------------
        if let Some(global) = global_object {
            // SAFETY: global valid; JSC VM still alive.
            unsafe { WebWorker__teardownJSCVM(global) };
        }

        // JSC is down; no more resolver/module-loader access past this point.
        // Unregister so the main thread's terminateAllAndWait() can proceed to
        // free process-global resolver state. Must happen before dispatchExit
        // because `this` may be freed once that posts.
        live_workers::unregister(self);

        // ---- 4. Post close task to parent ---------------------------------
        // SAFETY: cpp_worker valid (snapshot taken above).
        unsafe { WebWorker__dispatchExit(cpp_worker, exit_code) };
        // `this` may be freed past this point.

        // ---- 5. Free worker-thread resources ------------------------------
        if let Some(loop_) = loop_ {
            // SAFETY: loop owned by this thread's VM; no concurrent access.
            unsafe { (*loop_).internal_loop_data.jsc_vm = core::ptr::null_mut() };
        }
        if !vm_to_deinit.is_null() {
            // Must precede Loop.shutdown so uv_close isn't called twice on the
            // GC timer.
            // SAFETY: vm_to_deinit valid; sole owner.
            unsafe { (*vm_to_deinit).gc_controller.deinit() };
        }
        #[cfg(windows)]
        {
            // TODO(port): bun_sys::windows::libuv::Loop::shutdown()
        }
        if !vm_to_deinit.is_null() {
            // SAFETY: vm_to_deinit valid; sole owner.
            unsafe { (*vm_to_deinit).destroy() };
        }
        bun_core::delete_all_pools_for_thread_exit();
        drop(arena.take());

        bun_core::exit_thread();
    }

    /// process.exit() inside the worker. Worker-thread only.
    ///
    /// Takes `&self` (not `&mut self`) because `terminate_all_and_wait` /
    /// `notify_need_termination` may concurrently hold `&WebWorker` on another
    /// thread; producing `&mut` here would be aliased-&mut UB.
    pub fn exit(&self) {
        self.exit_called.store(true, Ordering::Relaxed);
        let _ = self.set_requested_terminate();
        // Stop subsequent JS at the next safepoint. `this.vm` is null during
        // `vm.onExit()` (shutdown nulls it first), so a re-entrant
        // process.exit() from an exit handler does not re-arm the trap.
        // SAFETY: worker-thread only; `vm` is read here on the same thread
        // that publishes/unpublishes it, so no lock is needed for the load.
        let vm_ptr = unsafe { *self.vm.get() };
        if !vm_ptr.is_null() {
            // SAFETY: vm_ptr non-null; jsc_vm is a valid JSC::VM*;
            // notify_need_termination is documented thread-safe (VMTraps).
            unsafe { (*(*vm_ptr).jsc_vm).notify_need_termination() };
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

    fn flush_logs(&self, vm: *mut VirtualMachine) {
        jsc::mark_binding();
        // SAFETY: vm valid (published or just-unpublished on this thread);
        // `log` set in `init()`.
        let vm_ref = unsafe { &mut *vm };
        let Some(log) = vm_ref.log else { return };
        // SAFETY: `log` outlives the VM (see VirtualMachine.log field doc).
        let log = unsafe { log.as_ref() };
        if log.msgs.is_empty() {
            return;
        }
        // SAFETY: `vm.global` is the live opaque FFI handle.
        let global = unsafe { &*vm_ref.global };
        let result: JsResult<(JSValue, BunString)> = (|| {
            let err = log.to_js(global, "Error in worker")?;
            let str = err.to_bun_string(global)?;
            Ok((err, str))
        })();
        let (err, str) = match result {
            Ok(pair) => pair,
            Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
            Err(_) => panic!("unhandled exception"),
        };
        // RAII: Zig's `defer str.deref()` — `OwnedString::Drop` releases the
        // WTF ref on scope exit, including across the `?`-free error arm below.
        let str = bun_string::OwnedString::new(str);
        let cpp_worker = self.cpp_worker;
        // SAFETY: cpp_worker / global valid; `str` borrowed by value.
        let dispatch = jsc::from_js_host_call_generic(global, || unsafe {
            WebWorker__dispatchError(global, cpp_worker, str.get(), err)
        });
        if let Err(e) = dispatch {
            let exc = global.take_exception(e);
            if let Some(exc) = exc.as_exception(vm_ref.jsc_vm) {
                // SAFETY: `exc` is a live `*mut Exception` heap cell.
                let _ = jsc::js_global_object::report_uncaught_exception(global, unsafe {
                    &mut *exc
                });
            }
        }
    }
}

/// `std::thread::spawn` requires `FnOnce: Send`; the closure captures a
/// `*mut WebWorker` which is `!Send` by default. We assert manually that the
/// pointer crosses threads safely (the struct itself is `Send + Sync`; see
/// the unsafe-impl above).
struct SendPtr(*mut WebWorker);
// SAFETY: see WebWorker's `unsafe impl Send` / file-header threading model.
unsafe impl Send for SendPtr {}

extern "C" fn opaque_spin_trampoline(ctx: *mut c_void) {
    // SAFETY: ctx is `*const WebWorker` passed from thread_main via
    // holdAPILock. `&WebWorker` (not `&mut`) — see worker-thread `&self` note.
    let this = unsafe { &*(ctx as *const WebWorker) };
    this.spin();
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

    let worker = vm.worker.expect("Assertion failure: no worker") as *const WebWorker;
    // SAFETY: vm.worker is a valid *const WebWorker owned by C++ while vm
    // lives. `&WebWorker` (not `&mut`) — see worker-thread `&self` note.
    let worker = unsafe { &*worker };

    let values = [error_instance];
    let format_result = jsc::ConsoleObject::format2(
        jsc::ConsoleObject::MessageLevel::Debug,
        global_object,
        values.as_ptr(),
        1,
        &mut array,
        jsc::ConsoleObject::FormatOptions {
            enable_colors: false,
            add_newline: false,
            flush: false,
            max_depth: 32,
            ..Default::default()
        },
    );
    if let Err(err) = format_result {
        if matches!(err, JsError::OutOfMemory) {
            let _ = global_object.throw_out_of_memory();
        }
        error_instance = global_object.try_take_exception().unwrap();
    }
    // PORT NOTE: Zig `writer.flush() catch outOfMemory()` — Vec<u8>::write_all
    // never buffers, so flush is a no-op.
    jsc::mark_binding();
    // SAFETY: cpp_worker valid; global_object is a live opaque FFI handle
    // (`&JSGlobalObject` coerces to `*const JSGlobalObject`).
    unsafe {
        WebWorker__dispatchError(
            global_object,
            worker.cpp_worker,
            BunString::clone_utf8(&array),
            error_instance,
        );
    }
    let _ = worker.set_requested_terminate();
    worker.shutdown();
}

/// Resolve a worker entry-point specifier to a path the module loader can
/// consume. The returned slice is BORROWED — it aliases `str`, the
/// standalone module graph, or the resolver's arena; the caller must NOT
/// free it.
fn resolve_entry_point_specifier(
    parent: &mut VirtualMachine,
    str: &[u8],
    error_message: &mut BunString,
    logger: &mut bun_logger::Log,
) -> Option<&'static [u8]> {
    let hooks = runtime_hooks().expect("RuntimeHooks not installed");
    // SAFETY: `str` is borrowed from caller storage that outlives every use of
    // the returned slice (see fn doc — caller never frees it). The lifetime
    // erase to `'static` mirrors the Zig spec where `[]const u8` carries no
    // lifetime; `load_entry_point_for_web_worker` immediately copies it.
    let str_static: &'static [u8] =
        unsafe { core::slice::from_raw_parts(str.as_ptr(), str.len()) };

    if let Some(graph) = parent.standalone_module_graph {
        // SAFETY: hook contract — `graph` is the opaque `StandaloneModuleGraph*`
        // stored at VM init; valid for VM lifetime.
        if unsafe { (hooks.standalone_graph_find)(graph, str) }.is_some() {
            return Some(str_static);
        }

        // Since `bun build --compile` renames files to `.js` by default, we
        // need to do the reverse of our file extension mapping.
        //
        //   new Worker("./foo")     -> new Worker("./foo.js")
        //   new Worker("./foo.ts")  -> new Worker("./foo.js")
        //   new Worker("./foo.jsx") -> new Worker("./foo.js")
        //   new Worker("./foo.mjs") -> new Worker("./foo.js")
        //   new Worker("./foo.mts") -> new Worker("./foo.js")
        //   new Worker("./foo.cjs") -> new Worker("./foo.js")
        //   new Worker("./foo.cts") -> new Worker("./foo.js")
        //   new Worker("./foo.tsx") -> new Worker("./foo.js")
        if str.starts_with(b"./") || str.starts_with(b"../") {
            'try_from_extension: {
                let mut pathbuf = bun_paths::PathBuffer::uninit();
                let base_len = bun_paths::resolve_path::join_abs_string_buf::<
                    bun_paths::platform::Loose,
                >(
                    hooks.standalone_graph_base_path, &mut pathbuf, &[str]
                )
                .len();
                let extname_len = bun_paths::extension(&pathbuf[..base_len]).len();

                // ./foo -> ./foo.js
                if extname_len == 0 {
                    pathbuf[base_len..base_len + 3].copy_from_slice(b".js");
                    // SAFETY: see graph hook contract above.
                    if let Some(js_file) =
                        unsafe { (hooks.standalone_graph_find)(graph, &pathbuf[0..base_len + 3]) }
                    {
                        return Some(js_file);
                    }
                    break 'try_from_extension;
                }

                let extname = &pathbuf[base_len - extname_len..base_len];

                // ./foo.ts -> ./foo.js
                if extname == b".ts" {
                    pathbuf[base_len - 3..base_len].copy_from_slice(b".js");
                    // SAFETY: see graph hook contract above.
                    if let Some(js_file) =
                        unsafe { (hooks.standalone_graph_find)(graph, &pathbuf[0..base_len]) }
                    {
                        return Some(js_file);
                    }
                    break 'try_from_extension;
                }

                if extname_len == 4 {
                    const EXTS: [&[u8]; 6] =
                        [b".tsx", b".jsx", b".mjs", b".mts", b".cts", b".cjs"];
                    for ext in EXTS {
                        if extname == ext {
                            let js_len = b".js".len();
                            pathbuf[base_len - ext.len()..base_len - ext.len() + js_len]
                                .copy_from_slice(b".js");
                            let as_js = &pathbuf[0..base_len - ext.len() + js_len];
                            // SAFETY: see graph hook contract above.
                            if let Some(js_file) =
                                unsafe { (hooks.standalone_graph_find)(graph, as_js) }
                            {
                                return Some(js_file);
                            }
                            break 'try_from_extension;
                        }
                    }
                }
            }
        }
    }

    if str.starts_with(b"blob:") {
        // SAFETY: hook contract — registry is a process-global singleton.
        if unsafe { (hooks.has_blob_url)(&str[b"blob:".len()..]) } {
            return Some(str_static);
        } else {
            *error_message = BunString::static_(b"Blob URL is missing");
            return None;
        }
    }

    let mut resolved_entry_point: bun_resolver::Result =
        match parent.transpiler.resolve_entry_point(str) {
            Ok(r) => r,
            Err(_) => {
                // SAFETY: `parent.global` is the live opaque FFI handle.
                let global = unsafe { &*parent.global };
                let out: JsResult<BunString> = (|| {
                    let out = logger.to_js(global, "Error resolving Worker entry point")?;
                    out.to_bun_string(global)
                })();
                match out {
                    Ok(out) => {
                        *error_message = out;
                        return None;
                    }
                    Err(JsError::OutOfMemory) => bun_core::out_of_memory(),
                    Err(_) => {
                        *error_message = BunString::static_(b"unexpected exception");
                        return None;
                    }
                }
            }
        };

    let Some(entry_path) = resolved_entry_point.path() else {
        *error_message = BunString::static_(b"Worker entry point is missing");
        return None;
    };
    // SAFETY: `entry_path.text` borrows from the resolver's process-global
    // arena (filename store), not from `resolved_entry_point` itself — Zig
    // returns it across the local's drop. Lifetime erased to `'static` per
    // the fn-level BORROWED contract.
    Some(unsafe { core::slice::from_raw_parts(entry_path.text.as_ptr(), entry_path.text.len()) })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/web_worker.zig (981 lines)
//   confidence: medium
//   notes:      Forward-dep calls (`bun_cli`, `bun_runtime::bun_js`,
//               `bun_standalone`, `bun_runtime::api::cron`,
//               `webcore::ObjectURLRegistry`) routed through
//               `RuntimeHooks` slots (parse_worker_exec_argv,
//               apply_standalone_runtime_flags, standalone_graph_find,
//               standalone_graph_base_path, cron_clear_all_for_vm,
//               has_blob_url). KeepAlive ref/unref via the cycle-break
//               `bun_aio::get_vm_ctx(Js)` (always called on the parent
//               thread, where that resolves to `this.parent`).
// ──────────────────────────────────────────────────────────────────────────
