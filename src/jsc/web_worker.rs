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
    // `BackRef` (not `&'a VirtualMachine`) because the struct is FFI-owned and
    // crosses threads; the backref invariant (parent outlives child via
    // `parent_poll_ref`) is documented above.
    parent: bun_ptr::BackRef<VirtualMachine>,
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
    /// Owned NUL-terminated bytes; Zig was `[:0]const u8`.
    name: bun_core::ZBox,

    // ---- Cross-thread signalling --------------------------------------------
    /// Intrusive node for the process-global `LiveWorkers` list. Registered
    /// before the thread is spawned; removed in `shutdown()` once the worker is
    /// past all process-global resolver access.
    ///
    /// `Cell` because `terminate_all_and_wait` walks the list through
    /// `&WebWorker` while `register`/`unregister` (under `live_workers::MUTEX`)
    /// write these on another thread — the mutex serialises memory ops, but
    /// Rust's aliasing model still requires interior mutability. `*mut T` is
    /// `Copy`, so `Cell` (not `UnsafeCell`) suffices and every read/write is
    /// safe `.get()`/`.set()`.
    // TODO(port): intrusive doubly-linked list node — `bun_collections` has no
    // `IntrusiveList` yet; raw next/prev pointers used directly.
    live_next: Cell<*mut WebWorker>,
    live_prev: Cell<*mut WebWorker>,

    /// Set by the parent (`notifyNeedTermination`) or by the worker itself
    /// (`exit`). The worker loop polls this between ticks.
    requested_terminate: AtomicBool,

    /// The worker's `jsc.VirtualMachine`, or null before `startVM()` / after
    /// `shutdown()` nulls it. Lives inside `arena`. `vm_lock` must be held for
    /// any cross-thread read (see header comment).
    ///
    /// `Cell` because this is read through `&WebWorker` on the parent / main
    /// thread (`notify_need_termination`, `terminate_all_and_wait`, `exit`) and
    /// written on the worker thread (`start_vm`, `shutdown`) — `vm_lock`
    /// serialises the memory ops, but Rust's aliasing model still requires
    /// interior mutability for a field written while a `&WebWorker` may be
    /// live. `*mut T` is `Copy`, so `Cell` gives safe `.get()`/`.set()`/
    /// `.replace()` and no `unsafe` at the access sites.
    vm: Cell<*mut VirtualMachine>,
    vm_lock: Mutex,

    // ---- Parent-thread only -------------------------------------------------
    /// Keep-alive on the parent's event loop. `Async.KeepAlive` is not
    /// thread-safe; it is reffed in `create()`, toggled by `setRef()` (JS
    /// `.ref()`/`.unref()`), and released by `releaseParentPollRef()` from the
    /// close task — all on the parent thread.
    ///
    /// `JsCell` because all parent-thread FFI exports take `*mut WebWorker`
    /// (the worker thread may concurrently hold `&WebWorker`); we mutate this
    /// field through a shared-provenance pointer. Parent-thread-only access
    /// satisfies `JsCell`'s single-owner-thread invariant (same as `arena`
    /// below for the worker thread).
    parent_poll_ref: JsCell<KeepAlive>,

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
    // `JsCell` (not `Cell`) because `Arena` is non-`Copy`; worker-thread-only
    // so the single-owner-thread invariant `JsCell` documents is upheld.
    arena: JsCell<Option<bun_alloc::Arena>>,
    /// Heap-owned cloned env (Map + Loader) for the worker VM. In Zig both
    /// were `allocator.create`'d on the worker arena and bulk-freed by
    /// `arena.deinit()`. Rust's `Arena = bumpalo::Bump` does not run `Drop`
    /// (so the inner `HashTable` would leak), and `clone_with_allocator()` no
    /// longer routes through the arena allocator anyway — own them as `Box`es
    /// here instead. `start_vm()` `heap::alloc`s and stores the pointers;
    /// `shutdown()` step 5 `heap::take`s after `vm.destroy()` (loader
    /// first, then map — `Loader<'static>` borrows `*map`).
    worker_env_map: Cell<*mut bun_dotenv::Map>,
    worker_env_loader: Cell<*mut bun_dotenv::Loader<'static>>,
    /// Set by `exit()` so that `spin()`'s error paths don't clobber an explicit
    /// `process.exit(code)`. Atomic so `exit()` can take `&self` (the struct is
    /// observed concurrently by `terminate_all_and_wait` / parent-thread FFI;
    /// producing `&mut WebWorker` while another thread holds `&WebWorker` is UB).
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

// TODO(port): move to <area>_sys
// `JSGlobalObject` is an opaque FFI handle (ZST); per codebase convention
// (see JSGlobalObject.rs externs) it crosses FFI as `*const` even when C++
// mutates — Rust never reads/writes bytes through it, so no `*mut` needed.
unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to non-null `*const`); C++ mutating VM state through it is
    // interior to the cell.
    safe fn WebWorker__teardownJSCVM(global: &JSGlobalObject);
    // safe: `cpp_worker` is an opaque round-trip pointer owned by C++ (allocated
    // there, stored in `WebWorker.cpp_worker`, and only ever passed back to C++
    // — never dereferenced as Rust data); same contract as `JSC__VM__holdAPILock`'s
    // `ctx`. `&JSGlobalObject` is the non-null handle proof; remaining args are
    // by-value scalars/`#[repr(C)]` PODs.
    safe fn WebWorker__dispatchExit(cpp_worker: *mut c_void, exit_code: i32);
    // Re-declared here (also private in VM.rs) so `thread_main` can take the
    // API lock as a raw FFI call with NO RAII guard — see PORT NOTE there.
    safe fn JSC__VM__getAPILock(vm: &jsc::VM);
    safe fn WebWorker__dispatchOnline(cpp_worker: *mut c_void, global: &JSGlobalObject);
    safe fn WebWorker__fireEarlyMessages(cpp_worker: *mut c_void, global: &JSGlobalObject);
    safe fn WebWorker__dispatchError(
        global: &JSGlobalObject,
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
    // PORTING.md §Global mutable state: list head, every read/write is under
    // `MUTEX` above. `AtomicCell` so the slot itself is `Sync` with safe
    // load/store (the mutex still provides the actual happens-before for the
    // intrusive list walk; Zig: plain `var head: ?*WebWorker`).
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
    // provenance. All writes here go through `Cell` fields
    // (`live_next`/`live_prev`), which is sound via shared provenance.
    pub(super) fn unregister(worker: *const WebWorker) {
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
pub extern "C" fn WebWorker__getParentWorker(vm: &VirtualMachine) -> *mut c_void {
    vm.worker_ref()
        .map(|w| w.cpp_worker)
        .unwrap_or(core::ptr::null_mut())
}

impl WebWorker {
    pub fn has_requested_terminate(&self) -> bool {
        self.requested_terminate.load(Ordering::Acquire)
    }

    /// Raw read of the `vm` cell. Worker-thread-only callers (which are also
    /// the writers) may call this without `vm_lock`; cross-thread callers
    /// (`notify_need_termination`, `terminate_all_and_wait`) must hold
    /// `vm_lock`. The cell itself is `Cell<*mut _>` so the read is a safe
    /// `Copy` load; synchronization (where required) is the caller's
    /// responsibility per the doc above.
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
            parent_context_id,
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

        // Keep the parent's event loop alive until the close task releases this.
        // If the user passed `{ ref: false }` we skip — they've opted out of the
        // worker keeping the process alive. Exception: a nested worker (parent is
        // itself a worker, not joined on exit) must hold the parent-loop keepalive
        // regardless, because the child holds a non-owning `BackRef` to the parent VM.
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
        // `this` is a valid heap allocation owned by C++ `WebCore::Worker`
        // (alive while JSWorker holds its Ref) — `ParentRef` invariant holds.
        // `bun_io::js_vm_ctx()` resolves to this (parent) thread's loop, which
        // IS `this.parent`'s loop.
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
        // `this` is a valid heap allocation owned by C++ `WebCore::Worker`
        // (alive while JSWorker holds its Ref) — `ParentRef` invariant holds.
        // Only atomic / lock-guarded fields are touched cross-thread; never
        // `&mut WebWorker`.
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

    /// Release the keep-alive on the parent's event loop. Called on the parent
    /// thread from the close task posted by `dispatchExit`.
    ///
    /// Takes `*mut` for consistency with the other parent-thread FFI exports
    /// (the worker thread has exited by the time this runs, so `&mut` would be
    /// sound here, but matching signatures avoids surprises).
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

        // PORT NOTE: `start_vm()` may have observed `requested_terminate` and
        // run `shutdown()` itself (which now returns instead of `noreturn`).
        // In that case it returns `Ok(null)` and there is nothing left to do —
        // fall out of `thread_main` so the thread exits cleanly. We must NOT
        // read `self.vm_ptr()` here to make that decision: `shutdown()` has
        // already posted `dispatchExit`, after which `self` may be freed by
        // `~Worker` on the parent thread (the close task drops the
        // thread-held ref; if the JS wrapper has been GC'd, `WebWorker__destroy`
        // races this read — sporadic UAF in worker_threads tests that
        // `terminate()` immediately after `new Worker()`).
        if vm_ptr.is_null() {
            return;
        }

        // `start_vm()` published `vm_ptr` under `vm_lock` AND installed it as
        // this thread's per-thread VM (`VirtualMachine::init` → `VMHolder`), so
        // the safe thread-local accessor returns the same allocation.
        debug_assert!(core::ptr::eq(vm_ptr, VirtualMachine::get_mut_ptr()));
        let global = VirtualMachine::get().global();
        // PORT NOTE: Zig calls `holdAPILock(this, OpaqueWrap(spin))`; the
        // callback ends in `bun.exitThread()` (`pthread_exit`), whose forced
        // unwind cannot walk Zig frames (no unwind tables), so glibc falls
        // back to a longjmp and the C++ `JSLockHolder` destructor never
        // runs — `WebWorker__teardownJSCVM` (called from `shutdown()`)
        // accounts for that abandoned ref by `deref`ing twice.
        //
        // In Rust we cannot use `pthread_exit` (its forced unwind aborts at
        // the first `extern "C"` boundary — see `shutdown` PORT NOTE), so
        // `spin()` returns. To preserve the Zig invariant that the API lock
        // is simply abandoned along with the destroyed VM, take the lock via
        // raw FFI (NOT the `Lock<'_>` RAII guard) and never release it.
        // `WebWorker__teardownJSCVM` correspondingly `deref`s once, since
        // unlike Zig's `JSLockHolder` this path takes no extra `RefPtr<VM>`
        // — see the matching note in `Worker.cpp`.
        //
        // We deliberately do NOT use `get_api_lock()` + `mem::forget(guard)`:
        // the guard holds `vm: &VM`, which would dangle after `spin()` →
        // `shutdown()` destroys the `JSC::VM`, and a live `&T` to freed
        // memory is UB under Rust's validity rules even when never
        // dereferenced. The raw FFI call has no such reference to leak.
        JSC__VM__getAPILock(global.vm());
        self.spin();
    }

    /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
    ///
    /// Returns the published VM pointer so `thread_main` need not re-read it
    /// from `self` — `Ok(null)` means the early-terminate checkpoint already
    /// ran `shutdown()` (after which `self` may be freed by `~Worker` on the
    /// parent thread; touching `self` past that point is the UAF this return
    /// shape exists to prevent).
    fn start_vm(&self) -> Result<*mut VirtualMachine, bun_core::Error> {
        debug_assert!(self.status.get() == Status::Start);
        debug_assert!(self.vm_ptr().is_null());

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");

        // `parent` is a `BackRef` and outlives this worker while
        // `parent_poll_ref` is held (see file header). The parent VM runs
        // concurrently on its own thread, so we must NOT materialise a
        // `&mut VirtualMachine` here — Zig's `*T` aliases freely but a
        // Rust `&mut` would assert uniqueness we don't have. All uses
        // below are read-only (clone of transform_options, locked read of
        // proxy_env_storage / env.map, copy of standalone_module_graph),
        // so a shared reference is sufficient and matches the .zig intent.
        let parent = self.parent.get();
        // Deref-clone out of the `Arc` — worker mutates `allow_addons` below
        // and passes the owned struct as `args` to the new VM.
        let mut transform_options = (*parent.transpiler.options.transform_options).clone();

        if let Some(exec_argv) = self.exec_argv() {
            // Spec web_worker.zig:445-476 — parse `execArgv` with the
            // RunCommand param table. The param table lives in
            // `bun_runtime::cli` (forward-dep), so dispatch through
            // `RuntimeHooks::parse_worker_exec_argv_allow_addons`. Currently
            // only honours `--no-addons`; the hook owns the temporary UTF-8
            // alloc + clap parse + `args.deinit()` (the full `defer` chain in
            // the .zig). `None` ↔ Zig's `catch break :parse_new_args` arm.
            // SAFETY: hook contract.
            if let Some(allow_addons) =
                unsafe { (hooks.parse_worker_exec_argv_allow_addons)(exec_argv) }
            {
                // override the existing even if it was set
                transform_options.allow_addons = Some(allow_addons);
            }
        }

        // worker-thread only field; no other thread reads `arena`.
        self.arena.set(Some(bun_alloc::Arena::new()));

        // Proxy-env values may be RefCountedEnvValue bytes owned by the
        // parent's proxy_env_storage. We need a consistent snapshot of
        // (storage slots + env.map entries) so every slice we copy is backed
        // by a ref we hold. The parent's storage.lock serialises against
        // Bun__setEnvValue on the main thread — it covers both the slot swap
        // and the map.put, so cloneFrom and cloneWithAllocator see the same
        // state.
        let mut temp_proxy_slots = jsc::rare_data::ProxyEnvSlots::default();

        // PORT NOTE: Zig allocated Map/Loader on the worker arena (bulk-freed
        // in shutdown). Rust's `Arena = bumpalo::Bump` doesn't run Drop, so
        // box on the global heap instead and hand ownership to the VM via
        // `transpiler.env`; reclaimed in `vm.destroy()` in `shutdown()`.
        // PERF(port): MimallocArena bulk-free — profile in Phase B.
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

        // `Loader<'static>` borrows `map` for its lifetime. In Zig both lived
        // on the worker arena (bulk-freed); here both are `heap::alloc`'d
        // and stashed on `self` so `shutdown()` step 5 reclaims them on every
        // path — including the early-terminate checkpoint below, which calls
        // `shutdown()` before the VM exists.
        let map_ptr: *mut bun_dotenv::Map = bun_core::heap::into_raw(map);
        // SAFETY: `map_ptr` heap-allocated above; `'static` is the lifetime
        // erasure for the worker-VM-lifetime borrow (Zig: arena-backed).
        let loader = Box::new(bun_dotenv::Loader::init(unsafe { &mut *map_ptr }));
        let loader_ptr: *mut bun_dotenv::Loader<'static> = bun_core::heap::into_raw(loader);
        self.worker_env_map.set(map_ptr);
        self.worker_env_loader.set(loader_ptr);

        // Checkpoint before the expensive part: initWorker builds a full JSC
        // VM. If terminateAllAndWait() fired while we were cloning the env
        // above, bail now rather than spending ~50–100ms (release) creating a
        // VM that will immediately tear down.
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

        // Second checkpoint: initWorker just spent the bulk of startup time;
        // if terminate arrived during it, skip configureDefines() (which
        // walks the resolver's global dir_cache) and entry-point loading.
        // spin() will observe the flag and shutdown() under the API lock.
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

    /// Phase 2: load the entry point, dispatch 'online', run the event loop.
    /// Runs inside `holdAPILock`. Always ends by calling `shutdown()`.
    ///
    /// PORT NOTE: Zig's `spin` is `noreturn` (every path ends in `shutdown`
    /// → `bun.exitThread`). The Rust port returns `()` so the thread can
    /// unwind-free fall out of the `extern "C"` trampoline — see `shutdown`.
    fn spin(&self) {
        log!("[{}] spin start", self.execution_context_id);

        // vm published in start_vm; non-null past this point. Do NOT bind a
        // long-lived `&mut VirtualMachine`: while the event loop runs, the
        // parent / main thread may dereference the same pointer under
        // `vm_lock` (`notify_need_termination`, `terminate_all_and_wait`).
        // Those cross-thread paths only form raw-ptr field reads (never
        // `&mut VirtualMachine`), so holding `&VirtualMachine` here is sound;
        // mutation goes through `vm.as_mut()` which forms a fresh short-lived
        // `&mut` per call (the `JsCell` escape hatch — provenance from the
        // thread-local `*mut`).
        let vm_ptr: *mut VirtualMachine = self.vm_ptr();
        // vm published in `start_vm` under `vm_lock`; non-null and live for the
        // worker thread's duration. This IS the worker thread's per-thread VM
        // (set by `VirtualMachine::init` → `VMHolder`), so the safe
        // thread-local accessor returns the same allocation.
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
        vm.as_mut().preload = self.preloads.clone();

        // Resolve the entry point on the worker thread (the parent only stored
        // the raw specifier). The returned slice is BORROWED — every exit from
        // spin() goes through shutdown() which is noreturn, so a `defer free`
        // here would never run anyway.
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
        // dispatchOnline fires the parent-side 'open' event and flips the C++
        // state to Running (which routes postMessage directly instead of
        // queuing). It is placed after the entry point has loaded so the parent
        // observes 'online' only once the worker's top-level code has completed;
        // moving it earlier would change that observable ordering.
        // `cpp_worker` is the opaque C++-owned handle round-tripped via `safe fn`;
        // `vm.global()` yields the live `&JSGlobalObject` published in start_vm.
        WebWorker__dispatchOnline(self.cpp_worker, vm.global());
        WebWorker__fireEarlyMessages(self.cpp_worker, vm.global());
        self.set_status(Status::Running);

        // don't run the GC if we don't actually need to
        if vm.is_event_loop_alive() || vm.event_loop_mut().tick_concurrent_with_count() > 0 {
            vm.global().vm().release_weak_refs();
            // PERF(port): `vm.arena.gc()` was `MimallocArena.gc()` →
            // `mi_heap_collect`. `Arena = bumpalo::Bump` has no collect;
            // global mimalloc handles reclamation. Profile in Phase B.
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

    /// Phase 3: run exit handlers, tear down the JSC VM, post the close
    /// event, free the arena, exit the thread.
    ///
    /// Ordering constraints (each step is a barrier for the next):
    ///   1. `vm = null` under lock    — a racing notifyNeedTermination() now sees
    ///                                  null and skips wakeup() instead of touching
    ///                                  memory freed in step 5.
    ///   2. `vm.onExit()`             — user 'exit' handlers run; needs the JSC VM.
    ///   3. `teardownJSCVM()`         — collectNow + vm.deref (single — Zig
    ///                                  derefs ×2 because `JSLockHolder` holds
    ///                                  a `RefPtr<VM>`; the Rust API-lock path
    ///                                  takes no extra ref, see `thread_main`
    ///                                  PORT NOTE); can re-enter via
    ///                                  finalizers, so must precede step 5.
    ///   4. `dispatchExit()`          — posts close task → parent releases
    ///                                  parent_poll_ref + thread-held Worker ref.
    ///                                  After this `this` may be freed at any time.
    ///   5. free loop/arena/pools     — no `this.*` dereferences below step 4.
    ///
    /// Does NOT free `this` — see ownership rule in the file header.
    ///
    /// PORT NOTE: Zig's `shutdown` is `noreturn` (ends in `bun.exitThread`).
    /// The Rust port returns `()` and lets the thread fall out of the spawn
    /// closure instead — see the note at the bottom of this fn.
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
            }
            // Embedded socket groups must drain while JSC is still alive —
            // closeAll() fires on_close → JS callbacks. RareData.deinit() runs
            // after teardownJSCVM and only deinit()s (asserts empty in debug).
            if let Some(rare) = vm.rare_data.as_deref_mut() {
                // PORT NOTE: reshaped for borrowck — `close_all_socket_groups`
                // wants `&VirtualMachine` while `rare` is `&mut` borrowed from
                // `vm`. Re-derive `vm` through the raw ptr (sole owner).
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

        // JSC is down; no more resolver/module-loader access past this point.
        // Unregister so the main thread's terminateAllAndWait() can proceed to
        // free process-global resolver state. Must happen before dispatchExit
        // because `this` may be freed once that posts.
        live_workers::unregister(self);

        // ---- 4. Post close task to parent ----------------------------------
        // `cpp_worker` is the opaque C++-owned handle (snapshot taken above).
        WebWorker__dispatchExit(cpp_worker, exit_code);
        // `this` may be freed past this point.

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
        drop(arena.take());

        // PORT NOTE: Zig calls `bun.exitThread()` (`pthread_exit`) here. In
        // Rust we MUST NOT — glibc's `pthread_exit` throws a `__forced_unwind`
        // C++ exception to run destructors, and unwinding that across an
        // `extern "C"` (`nounwind`) Rust frame on the way out to
        // `std::thread`'s entry point makes Rust abort the whole process.
        // Instead return normally: `shutdown()` → `spin()` → `thread_main`
        // (which `forget`s the API-lock guard) → the `std::thread` spawn
        // closure, which then exits the thread cleanly. No `this.*` is
        // touched past `dispatchExit` above, so the `this`-may-be-freed
        // contract still holds across the unwind-free return path.
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
        // worker-thread only; `vm` is read here on the same thread
        // that publishes/unpublishes it, so no lock is needed for the load.
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
        // RAII: Zig's `defer str.deref()` — released on scope exit.
        scopeguard::defer! { str.deref(); }
        let dispatch = jsc::host_fn::from_js_host_call_generic(global, || {
            // `cpp_worker` is the opaque C++-owned handle; `str` reffed for the call.
            WebWorker__dispatchError(global, self.cpp_worker, str, err)
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
        [error_instance].as_ptr(),
        1,
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
    // PORT NOTE: Zig calls `WebWorker__dispatchError` bare here because the
    // very next statement is `worker.shutdown()` (noreturn — `bun.exitThread`
    // longjmps), so the C++ `DECLARE_THROW_SCOPE` inside
    // `SerializedScriptValue::create` (reached via `dispatchErrorWithValue`)
    // never has its simulated-throw bookkeeping validated. Rust RETURNS through
    // the live C++ frames (see PORT NOTE below), so that simulated throw must
    // be checked before unwinding, or the next `TopExceptionScope` ctor on the
    // stack — `performMicrotaskCheckpoint` / NodeTimerObject `call()` — trips
    // `verifyExceptionCheckNeedIsSatisfied`. Wrap in `from_js_host_call_generic`
    // (declares + checks a TopExceptionScope around the FFI call, same as
    // `flush_logs` above) and discard any actual exception: we are already the
    // last-resort error handler and about to arm termination.
    if jsc::host_fn::from_js_host_call_generic(global_object, || {
        // `cpp_worker` is the opaque C++-owned handle round-tripped via `safe fn`.
        WebWorker__dispatchError(
            global_object,
            worker.cpp_worker,
            BunString::clone_utf8(&array),
            error_instance,
        );
    })
    .is_err()
    {
        let _ = global_object.try_take_exception();
    }
    let _ = worker.set_requested_terminate();
    // PORT NOTE: Zig calls `worker.shutdown()` here, which is `noreturn`
    // (`bun.exitThread` longjmps out, abandoning the C++ frames on the
    // stack). In Rust `shutdown()` RETURNS — calling it here would destroy
    // the `JSC::VM`, free the Bun `VirtualMachine` + arena, and post
    // `dispatchExit` (after which `worker` itself may be freed), then return
    // through `VirtualMachine::uncaught_exception` (which writes
    // `is_handling_uncaught_exception = false` on the freed VM), through live
    // JSC C++ frames operating on a destroyed `JSC::VM`, and back into
    // `spin()` which dereferences the freed `*vm` and calls `shutdown()` a
    // second time (double `dispatchExit` → double C++ `Worker` deref).
    //
    // Instead, arm the JSC termination trap so any further JS halts at the
    // next safepoint, and let the stack unwind normally back to `spin()`,
    // whose loop observes `requested_terminate` and reaches the single
    // `shutdown()` call at its bottom with no live JSC frames above it. The
    // promise-rejection path in `spin()` (line ~1044) gets there even sooner:
    // `uncaught_exception` returns `handled == false`, so `spin()` calls
    // `return self.shutdown()` directly — same observable ordering as Zig.
    // `vm.jsc_vm` is the worker's live `JSC::VM*` (we just used it via
    // `global_object`); `notify_need_termination` is documented thread-safe
    // (VMTraps).
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
        //
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

    // `Path::text` borrows the resolver's process-lifetime `dirname_store` /
    // `filename_store` (`Path<'static>`), NOT `resolved_entry_point` itself —
    // copy the slice out and let `resolved_entry_point` drop on the stack,
    // exactly as the Zig spec does.
    match resolved_entry_point.path_const() {
        Some(entry_path) => Some(entry_path.text),
        None => {
            *error_message = BunString::static_(b"Worker entry point is missing");
            None
        }
    }
}

// ported from: src/jsc/web_worker.zig
