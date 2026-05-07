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
//! B-2 un-gate status: the type surface (`WebWorker`, `Status`, FFI export
//! signatures, `terminate_all_and_wait` registry) is real and compiles
//! against `bun_jsc`'s available dependency set. The thread-main bodies
//! (`create`, `start_vm`, `spin`, `shutdown`, `resolve_entry_point_specifier`)
//! reach into forward-dep crates (`bun_runtime` for `cli::Command` /
//! `apply_standalone_runtime_flags`, `bun_webcore::ObjectURLRegistry`,
//! `bun_standalone::StandaloneModuleGraph`, `bun_clap` parse-ex, the
//! `RareData::ProxyEnvStorage` clone path) and into `VirtualMachine` fields
//! (`init_worker`, `load_entry_point_for_web_worker`, `arena`,
//! `proxy_env_storage`). Per VirtualMachine.rs §Dispatch those paths belong to
//! the high tier; the FFI exports here route through `RuntimeHooks`.
//! ──────────────────────────────────────────────────────────────────────────

use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_alloc::MimallocArena;
use bun_string::{String as BunString, WTFStringImpl};
use bun_threading::{Futex, Mutex};

use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, JSGlobalObject, JSValue};

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
    name: Box<[u8]>,

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
    parent_poll_ref: KeepAlive,

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
    arena: UnsafeCell<Option<MimallocArena>>,
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
                // documented thread-safe (VMTraps). Cast through the real
                // opaque `crate::VM` (the `crate::VM` stub is layout-only).
                // We deliberately do NOT bind `&VirtualMachine` — the worker
                // thread may hold a live mutable view of the VM; raw-pointer
                // field/method access keeps any autoref scoped to the access.
                unsafe { (*((*vm_ptr).jsc_vm as *const crate::VM)).notify_need_termination() };
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
    ///
    /// B-2: body needs `bun_runtime` / `bun_webcore` / `bun_standalone` /
    /// `bun_clap::parse_ex` / `RareData::ProxyEnvStorage` — dispatched through
    /// `RuntimeHooks` by the high tier. Preserved verbatim under
    /// `__phase_a_body` below.
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
        let _ = (
            cpp_worker,
            parent,
            name_str,
            specifier_str,
            parent_context_id,
            mini,
            default_unref,
            eval_mode,
            argv_ptr,
            argv_len,
            inherit_exec_argv,
            exec_argv_ptr,
            exec_argv_len,
            preload_modules_ptr,
            preload_modules_len,
        );
        // TODO(b2): RuntimeHooks dispatch — full body gated below.
        *error_message =
            BunString::static_(b"WebWorker__create: bun_jsc tier stub (RuntimeHooks not installed)");
        core::ptr::null_mut()
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
        // TODO(b2): `KeepAlive::ref_/unref` take `bun_aio::EventLoopCtx`;
        // `VirtualMachine → EventLoopCtx` conversion lives in the high tier
        // (RuntimeHooks). No-op until that lands — `create()` is itself
        // stubbed so `parent_poll_ref` is never armed at this tier.
        let _ = (this, value);
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
            // documented thread-safe (VMTraps). Cast through the real opaque
            // `crate::VM` (the `crate::VM` stub is layout-only). No
            // `&VirtualMachine` binding — see `terminate_all_and_wait`.
            unsafe { (*((*vm_ptr).jsc_vm as *const crate::VM)).notify_need_termination() };
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
        // TODO(b2): `KeepAlive::unref(EventLoopCtx)` — see `set_ref`.
        let _ = this;
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
            // Cast through the real opaque `crate::VM`.
            unsafe { (*((*vm_ptr).jsc_vm as *const crate::VM)).notify_need_termination() };
        }
    }

    fn set_status(&self, status: Status) {
        log!(
            "[{}] status: {}",
            self.execution_context_id,
            <&'static str>::from(status)
        );
        self.status.set(status);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Phase-A draft body (forward-dep heavy). Preserved for B-2 so the port
// ──────────────────────────────────────────────────────────────────────────

mod __phase_a_body {
    use super::*;
    use bun_logger as logger;
    use core::mem::offset_of;

    impl WebWorker {
        // Worker-thread call chain takes `&self` (NOT `&mut self`): the parent /
        // main thread may concurrently hold `&WebWorker` (`notify_need_termination`,
        // `terminate_all_and_wait`), so materialising `&mut WebWorker` here would
        // be aliased-&mut UB. Worker-thread-only mutable fields are wrapped in
        // `Cell` / `UnsafeCell` instead. Zig spec uses `*WebWorker` everywhere,
        // which aliases freely.
        fn thread_main(&self) {
            bun_analytics::Features::workers_spawned().fetch_add(1, Ordering::Relaxed);

            if !self.name.is_empty() {
                bun_core::Output::Source::configure_named_thread(&self.name);
            } else {
                bun_core::Output::Source::configure_named_thread(b"Worker");
            }

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
            global.vm().hold_api_lock(
                self as *const WebWorker as *mut c_void,
                opaque_spin_trampoline,
            );
        }

        /// Phase 1: build the worker's arena + VirtualMachine and publish `vm`.
        fn start_vm(&self) -> Result<(), bun_core::Error> {
            debug_assert!(self.status.get() == Status::Start);
            // SAFETY: worker-thread only; vm is unpublished at this point.
            debug_assert!(unsafe { *self.vm.get() }.is_null());

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

            if !self.inherit_exec_argv {
                'parse_new_args: {
                    // SAFETY: caller passed valid (ptr,len); slice borrowed from
                    // C++ WorkerOptions kept alive by the owning Worker.
                    let exec_argv: &[WTFStringImpl] = if self.exec_argv_ptr.is_null() {
                        &[]
                    } else {
                        unsafe { core::slice::from_raw_parts(self.exec_argv_ptr, self.exec_argv_len) }
                    };
                    let mut new_args: Vec<Box<[u8]>> = Vec::with_capacity(exec_argv.len());
                    for arg in exec_argv {
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
                            stop_after_positional_at: 1,
                        },
                    ) {
                        Ok(a) => a,
                        Err(_) => break 'parse_new_args,
                    };

                    transform_options.allow_addons = !args.flag("--no-addons");
                    // TODO: currently this only checks for --no-addons.
                }
            }

            // SAFETY: worker-thread only field; no other thread reads `arena`.
            unsafe { *self.arena.get() = Some(MimallocArena::init()) };
            // SAFETY: just initialised above; worker-thread only.
            let allocator = unsafe { (*self.arena.get()).as_ref().unwrap().allocator() };

            let mut temp_proxy_storage = jsc::RareData::ProxyEnvStorage::default();
            let temp_proxy_guard = scopeguard::guard(&mut temp_proxy_storage, |s| {
                drop(core::mem::take(s));
            });

            let map = Box::leak(Box::new(bun_dotenv::Map::default()));
            {
                let parent_storage = &parent.proxy_env_storage;
                parent_storage.lock.lock();
                temp_proxy_guard.clone_from(parent_storage);
                *map = parent.transpiler.env.map.clone_with_allocator(allocator)?;
                parent_storage.lock.unlock();
            }
            temp_proxy_guard.sync_into(map);

            let loader = Box::leak(Box::new(bun_dotenv::Loader::init(map, allocator)));

            if self.has_requested_terminate() {
                let s = scopeguard::ScopeGuard::into_inner(temp_proxy_guard);
                drop(core::mem::take(s));
                self.shutdown();
            }

            let vm = jsc::VirtualMachine::init_worker(
                self,
                jsc::VirtualMachine::InitWorkerOptions {
                    allocator,
                    args: transform_options,
                    env_loader: loader,
                    store_fd: self.store_fd,
                    graph: parent.standalone_module_graph,
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
                vm_ref.allocator = allocator;
                // SAFETY: arena initialised above; worker-thread only field.
                vm_ref.arena = unsafe { (*self.arena.get()).as_mut().unwrap() as *mut _ };

                let s = scopeguard::ScopeGuard::into_inner(temp_proxy_guard);
                vm_ref.proxy_env_storage = core::mem::take(s);

                vm_ref.is_main_thread = false;
                jsc::VirtualMachine::set_is_main_thread_vm(false);
                vm_ref.on_unhandled_rejection = on_unhandled_rejection;
            }

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
                b.resolver.env_loader = b.env;

                if let Some(graph) = parent.standalone_module_graph {
                    bun_runtime::bun_js::apply_standalone_runtime_flags(b, graph);
                }
            }

            if self.has_requested_terminate() {
                return Ok(());
            }

            // SAFETY: see post-publish note above.
            unsafe {
                if (*vm).transpiler.configure_defines().is_err() {
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
            debug_assert!(self.status.get() == Status::Start);
            self.set_status(Status::Starting);

            // SAFETY: vm published in start_vm; non-null past this point. Kept
            // as a raw `*mut VirtualMachine` — do NOT bind a long-lived
            // `&mut VirtualMachine`: while the event loop runs, the parent /
            // main thread may dereference the same pointer under `vm_lock`
            // (`notify_need_termination`, `terminate_all_and_wait`). The lock
            // serialises only the pointer LOAD, not a Rust reference lifetime,
            // so a long-lived `&mut` here would be aliased-&mut UB. Per-use
            // `(*vm)` derefs keep any autoref scoped to the single expression.
            let vm: *mut VirtualMachine = unsafe { *self.vm.get() };

            if self.has_requested_terminate() {
                self.flush_logs(unsafe { &mut *vm });
                self.shutdown();
            }

            unsafe { (*vm).preload = &self.preloads };

            let mut resolve_error = BunString::empty();
            let path = match resolve_entry_point_specifier(
                unsafe { &*vm },
                &self.unresolved_specifier,
                &mut resolve_error,
                unsafe { (*vm).log },
            ) {
                Some(p) => p,
                None => {
                    unsafe { (*vm).exit_handler.exit_code = 1 };
                    if unsafe { (*vm).log.errors } == 0 && !resolve_error.is_empty() {
                        let err = resolve_error.to_utf8();
                        unsafe { (*vm).log.add_error(None, logger::Loc::Empty, err.as_slice()) };
                    }
                    resolve_error.deref();
                    self.flush_logs(unsafe { &mut *vm });
                    self.shutdown();
                }
            };
            resolve_error.deref();

            if self.has_requested_terminate() {
                self.flush_logs(unsafe { &mut *vm });
                self.shutdown();
            }

            let promise = match unsafe { (*vm).load_entry_point_for_web_worker(path) } {
                Ok(p) => p,
                Err(_) => {
                    if !self.exit_called.load(Ordering::Relaxed) {
                        unsafe { (*vm).exit_handler.exit_code = 1 };
                    }
                    self.flush_logs(unsafe { &mut *vm });
                    self.shutdown();
                }
            };

            if promise.status() == jsc::PromiseStatus::Rejected {
                let handled = unsafe {
                    (*vm).uncaught_exception((*vm).global, promise.result((*vm).jsc_vm), true)
                };
                if !handled {
                    unsafe { (*vm).exit_handler.exit_code = 1 };
                    self.shutdown();
                }
            } else {
                let _ = promise.result(unsafe { (*vm).jsc_vm });
            }

            self.flush_logs(unsafe { &mut *vm });
            log!("[{}] event loop start", self.execution_context_id);
            // SAFETY: cpp_worker valid for the lifetime of this struct;
            // `(*vm).global` is the live `*mut JSGlobalObject` published in start_vm.
            unsafe {
                WebWorker__dispatchOnline(self.cpp_worker, (*vm).global);
                WebWorker__fireEarlyMessages(self.cpp_worker, (*vm).global);
            }
            self.set_status(Status::Running);

            unsafe {
                if (*vm).is_event_loop_alive() || (*vm).event_loop().tick_concurrent_with_count() > 0 {
                    (*vm).global.vm().release_weak_refs();
                    let _ = (*vm).arena_gc();
                    let _ = (*vm).global.vm().run_gc(false);
                }

                (*vm).tick();

                while (*vm).is_event_loop_alive() {
                    (*vm).tick();
                    if self.has_requested_terminate() {
                        break;
                    }
                    (*vm).event_loop().auto_tick_active();
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

            if !self.has_requested_terminate() {
                unsafe { (*vm).on_before_exit() };
            }

            self.flush_logs(unsafe { &mut *vm });
            self.shutdown();
        }

        /// Phase 3: run exit handlers, tear down the JSC VM, post the close
        /// event, free the arena, exit the thread.
        fn shutdown(&self) -> ! {
            jsc::mark_binding(core::panic::Location::caller());
            self.set_status(Status::Terminated);
            bun_analytics::Features::workers_terminated().fetch_add(1, Ordering::Relaxed);
            log!("[{}] shutdown", self.execution_context_id);

            let cpp_worker = self.cpp_worker;
            // SAFETY: worker-thread only field; no other thread reads `arena`.
            let mut arena = unsafe { (*self.arena.get()).take() };

            // 1. Unpublish vm
            self.vm_lock.lock();
            // SAFETY: vm_lock held; this is the unpublish point.
            let vm_ptr = unsafe { core::ptr::replace(self.vm.get(), core::ptr::null_mut()) };
            self.vm_lock.unlock();
            let mut loop_: Option<*mut bun_uws::Loop> = None;
            if !vm_ptr.is_null() {
                // SAFETY: vm_ptr was published under vm_lock; sole owner now.
                loop_ = Some(unsafe { (*vm_ptr).uws_loop() });
            }

            // 2. User exit handlers
            let mut exit_code: i32 = 0;
            let mut global_object: Option<*const JSGlobalObject> = None;
            if !vm_ptr.is_null() {
                // SAFETY: vm_ptr valid; unpublished above under vm_lock, so no
                // other thread can dereference it now — `&mut` is exclusive.
                let vm = unsafe { &mut *vm_ptr };
                vm.jsc_vm.clear_has_termination_request();
                vm.is_shutting_down = true;
                vm.on_exit();
                jsc::api::cron::CronJob::clear_all_for_vm(vm, jsc::api::cron::ClearReason::Teardown);
                if let Some(rare) = vm.rare_data.as_mut() {
                    rare.close_all_socket_groups(vm);
                }
                exit_code = vm.exit_handler.exit_code;
                global_object = Some(vm.global);
            }

            // 3. JSC VM teardown
            if let Some(global) = global_object {
                // SAFETY: global valid; JSC VM still alive.
                unsafe { WebWorker__teardownJSCVM(global) };
            }

            live_workers::unregister(self);

            // 4. Post close task to parent
            // SAFETY: cpp_worker valid (snapshot taken above).
            unsafe { WebWorker__dispatchExit(cpp_worker, exit_code) };
            // `this` may be freed past this point.

            // 5. Free worker-thread resources
            if let Some(loop_) = loop_ {
                // SAFETY: loop owned by this thread's VM; no concurrent access.
                unsafe { (*loop_).internal_loop_data.jsc_vm = core::ptr::null_mut() };
            }
            if !vm_ptr.is_null() {
                // SAFETY: vm_ptr valid; sole owner.
                unsafe { (*vm_ptr).gc_controller.deinit() };
            }
            #[cfg(windows)]
            {
                bun_sys::windows::libuv::Loop::shutdown();
            }
            if !vm_ptr.is_null() {
                // TODO(port): vm.deinit() — explicit deinit then arena frees storage.
                // SAFETY: vm_ptr was Box::into_raw'd by init_worker.
                drop(unsafe { Box::from_raw(vm_ptr) });
            }
            bun_core::delete_all_pools_for_thread_exit();
            drop(arena.take());

            bun_core::exit_thread();
        }

        fn flush_logs(&self, vm: &mut VirtualMachine) {
            jsc::mark_binding(core::panic::Location::caller());
            if vm.log.msgs.is_empty() {
                return;
            }
            let result: jsc::JsResult<(JSValue, BunString)> = (|| {
                let err = vm.log.to_js(vm.global, "Error in worker")?;
                let str = err.to_bun_string(vm.global)?;
                Ok((err, str))
            })();
            let (err, str) = match result {
                Ok(pair) => pair,
                Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                Err(_) => panic!("unhandled exception"),
            };
            // RAII: Zig's `defer str.deref()` — `OwnedString::Drop` releases the
            // WTF ref on scope exit, including across the `?`-free error arm below.
            let str = bun_string::OwnedString::new(str);
            let dispatch = jsc::from_js_host_call_generic(
                vm.global,
                core::panic::Location::caller(),
                |g, cpp, s, e| unsafe { WebWorker__dispatchError(g, cpp, s, e) },
                (vm.global, self.cpp_worker, str.get(), err),
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
        vm.on_unhandled_rejection =
            jsc::VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;

        let mut error_instance = error_instance_or_exception
            .to_error()
            .unwrap_or(error_instance_or_exception);

        let mut array: Vec<u8> = Vec::new();

        let worker = vm.worker.expect("Assertion failure: no worker") as *const WebWorker;
        // SAFETY: vm.worker is a valid *const WebWorker owned by C++ while vm
        // lives. `&WebWorker` (not `&mut`) — see worker-thread `&self` note.
        let worker = unsafe { &*worker };

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
            if matches!(err, jsc::JsError::OutOfMemory) {
                let _ = global_object.throw_out_of_memory();
            }
            error_instance = global_object.try_take_exception().unwrap();
        }
        jsc::mark_binding(core::panic::Location::caller());
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
    fn resolve_entry_point_specifier<'s>(
        parent: &VirtualMachine,
        str: &'s [u8],
        error_message: &mut BunString,
        logger: &mut logger::Log,
    ) -> Option<&'s [u8]> {
        if let Some(graph) = parent.standalone_module_graph {
            if graph.find(str).is_some() {
                return Some(str);
            }

            // `bun build --compile` renames files to `.js` by default; do the
            // reverse of our extension mapping.
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
                    let extname = bun_paths::extension(base);

                    if extname.is_empty() {
                        pathbuf[base_len..base_len + 3].copy_from_slice(b".js");
                        if let Some(js_file) = graph.find(&pathbuf[0..base_len + 3]) {
                            return Some(js_file.name);
                        }
                        break 'try_from_extension;
                    }

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
                    let out: jsc::JsResult<BunString> = (|| {
                        let out = logger.to_js(parent.global, "Error resolving Worker entry point")?;
                        out.to_bun_string(parent.global)
                    })();
                    match out {
                        Ok(out) => {
                            *error_message = out;
                            return None;
                        }
                        Err(jsc::JsError::OutOfMemory) => bun_core::out_of_memory(),
                        Err(_) => {
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
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/web_worker.zig (981 lines)
//   confidence: medium
//   todos:      24
//   notes:      B-2 un-gate: type surface + FFI exports + live-worker
//               registry real; thread_main/start_vm/spin/shutdown/
//               resolve_entry_point_specifier gated on RuntimeHooks
//               (forward-dep on bun_runtime/bun_webcore/bun_standalone) and
//               on VirtualMachine fields still stubbed (init_worker, arena,
//               proxy_env_storage).
// ──────────────────────────────────────────────────────────────────────────
