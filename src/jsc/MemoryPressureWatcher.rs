//! Reacts to OS low-memory signals by shrinking the JSC heap and returning
//! mimalloc free segments to the OS. One per process, hooked into the
//! main-thread VM's event loop, never keeps the loop alive.
//!
//! Off by default — opt in with
//! `BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER=1` so downstreams can
//! A/B the change before it becomes default-on.
//!
//! Detection front-ends:
//! - Windows: `CreateMemoryResourceNotification(LowMemoryResourceNotification)`
//!   waited on via `RegisterWaitForSingleObject` (NT threadpool); the callback
//!   `uv_async_send`s the JS thread. Mirrors WebKit PR 63320.
//! - macOS: `dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, …)` on
//!   a global concurrent queue; the handler enqueues a `ConcurrentTask`.
//!   Mirrors `MemoryPressureHandlerCocoa.mm`.
//! - Linux: a PSI trigger (`/proc/pressure/memory`, `POLLPRI`) blocked on by a
//!   dedicated thread which enqueues a `ConcurrentTask`. PSI signals via
//!   POLLPRI which `Async.FilePoll` doesn't yet expose, hence the thread.
//!
//! All three converge on `respond()` running on the JS thread.
//!
//! `WTF::MemoryPressureHandler` was considered but not used: in Bun's JSCOnly
//! WebKit build it is a no-op stub on macOS, has no OS hook on Linux, polls
//! every 60 s on Windows, and `releaseMemory()` does nothing without a
//! Bun-supplied `lowMemoryHandler` anyway — see `PlatformJSCOnly.cmake`.

#![allow(dead_code)]

use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use crate::virtual_machine::VirtualMachine;

bun_core::define_scoped_log!(log, MemoryPressure, visible);

/// At most one `respond()` per holdoff window on platforms whose signal stays
/// asserted while pressure persists (Windows level-triggered handle, Linux PSI
/// re-firing each measurement window). macOS only fires on state transitions
/// so it doesn't need this.
const HOLDOFF_MS: u64 = 30_000;

static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Called from `VirtualMachine::init` once the main-thread VM and its event
/// loop exist. Single-shot; later VMs (workers) skip via `is_main_thread`.
pub fn install_on_event_loop(vm: *mut VirtualMachine) {
    if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_MEMORY_PRESSURE_HANDLER.get()
        != Some(true)
    {
        return;
    }
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    backend::install(vm);
}

/// Called from `VirtualMachine::destroy` for the main-thread VM. Best-effort:
/// process exit will reclaim everything anyway, but this lets the JS-thread
/// `respond()` race against shutdown cleanly.
pub fn uninstall() {
    if !INSTALLED.swap(false, Ordering::SeqCst) {
        return;
    }
    backend::uninstall();
}

/// Test seam — runs the JS-thread response path directly. Debug builds only.
/// Returns the post-increment `analytics.Features.memory_pressure` count.
pub fn simulate(vm: &VirtualMachine) -> usize {
    if !bun_core::Environment::IS_DEBUG {
        return 0;
    }
    respond(vm, true);
    bun_analytics::features::memory_pressure.load(Ordering::Relaxed)
}

/// Test seam — see `darwin::test_uninstall_barrier`. Returns `true` iff
/// `uninstall()` blocked until an in-flight libdispatch event handler
/// finished (the property a barrier in `uninstall()` would guarantee).
/// Debug + macOS only; trivially `true` elsewhere.
pub fn test_uninstall_barrier(_vm: *mut VirtualMachine) -> bool {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        return darwin::test_uninstall_barrier(_vm);
    }
    #[allow(unreachable_code)]
    true
}

/// The platform-agnostic response. Always runs on the JS thread that owns
/// `vm`, so it's safe to touch the JSC heap directly.
fn respond(vm: &VirtualMachine, critical: bool) {
    log!(
        "memory pressure ({}); shrinking footprint",
        if critical { "critical" } else { "warning" }
    );
    bun_analytics::features::memory_pressure.fetch_add(1, Ordering::Relaxed);
    // Synchronous full collection now — reclaims unreachable JS objects
    // immediately, regardless of whether we're inside an entryScope.
    let jsc_vm = vm.global().vm();
    let _ = jsc_vm.run_gc(true);
    // Deferred deeper cleanup: shrinkFootprintWhenIdle() runs `deleteAllCode`
    // (drops JIT'd code) + another sync full GC + releaseFastMallocFreeMemory
    // via VM::whenIdle, i.e. immediately if no JS is on the stack, otherwise
    // when the current entryScope pops.
    jsc_vm.shrink_footprint();
    // Return mimalloc free segments to the OS.
    bun_core::Global::mimalloc_cleanup(critical);
}

/// Global state pointer. Written from `install()`/`uninstall()` on the JS
/// thread; read from off-thread callbacks to detect shutdown races.
static STATE: AtomicPtr<State> = AtomicPtr::new(core::ptr::null_mut());

#[inline]
fn state_ptr() -> *mut State {
    STATE.load(Ordering::Acquire)
}

// ─────────────────────────────── Noop ──────────────────────────────────────

#[cfg(not(any(
    windows,
    target_os = "macos",
    target_os = "linux",
    target_os = "android"
)))]
mod backend {
    use super::*;
    pub(super) type State = ();
    pub(super) fn install(_vm: *mut VirtualMachine) {}
    pub(super) fn uninstall() {}
}

#[cfg(not(any(
    windows,
    target_os = "macos",
    target_os = "linux",
    target_os = "android"
)))]
use backend::State;

// ───────────────────────────────────── Linux ────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
mod backend {
    pub(super) use super::linux::*;
}
#[cfg(any(target_os = "linux", target_os = "android"))]
use linux::State;

#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux {
    use super::*;
    use bun_event_loop::ConcurrentTask::ConcurrentTask;

    /// ≥150 ms some-stall in any 1 s window. "some" rather than "full" so we
    /// react before the whole process is blocked on reclaim.
    const TRIGGER: &[u8] = b"some 150000 1000000\n";

    pub(super) struct State {
        fd: bun_sys::Fd,
        thread: Option<std::thread::JoinHandle<()>>,
        vm: *mut VirtualMachine,
        shutdown: AtomicBool,
    }
    // SAFETY: the PSI watcher thread only uses `fd` (an int), `shutdown`
    // (atomic), and `vm` to post onto the thread-safe concurrent-task queue;
    // `thread` is only touched by the JS thread in install/uninstall.
    unsafe impl Send for State {}
    unsafe impl Sync for State {}

    pub(super) fn install(vm: *mut VirtualMachine) {
        // PSI triggers need O_RDWR | O_NONBLOCK and signal via POLLPRI.
        let fd = match bun_sys::open(
            bun_core::zstr!("/proc/pressure/memory"),
            bun_sys::O::RDWR | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
            0,
        ) {
            Ok(fd) => fd,
            Err(err) => {
                // ENOENT (no PSI), EACCES (some hardened kernels gate
                // unprivileged triggers), …: best-effort, just skip.
                log!(
                    "PSI unavailable (open /proc/pressure/memory: {}); watcher disabled",
                    bstr::BStr::new(err.name())
                );
                return;
            }
        };
        if let Err(err) = bun_sys::write(fd, TRIGGER) {
            // EOPNOTSUPP (psi=0 cmdline), EBUSY, …
            log!(
                "PSI unavailable (write trigger: {}); watcher disabled",
                bstr::BStr::new(err.name())
            );
            let _ = bun_sys::close(fd);
            return;
        }

        let s = bun_core::heap::alloc(State {
            fd,
            thread: None,
            vm,
            shutdown: AtomicBool::new(false),
        });
        STATE.store(s, Ordering::Release);

        // SAFETY: `s` is a fresh heap allocation owned by STATE; sole writer
        // of `thread` until uninstall().
        let thread_slot = unsafe { &mut (*s).thread };
        let s_addr = s as usize;
        match std::thread::Builder::new()
            .name("MemoryPressure".into())
            .stack_size(64 * 1024)
            .spawn(move || run(s_addr as *mut State))
        {
            Ok(handle) => {
                *thread_slot = Some(handle);
                log!("installed (/proc/pressure/memory PSI)");
            }
            Err(_) => {
                log!("PSI watcher thread spawn failed; watcher disabled");
                let _ = bun_sys::close(fd);
                STATE.store(core::ptr::null_mut(), Ordering::Release);
                // SAFETY: no other references — thread was never spawned.
                unsafe { bun_core::heap::destroy(s) };
            }
        }
    }

    /// Dedicated thread. PSI fires POLLPRI which `Async.FilePoll` doesn't yet
    /// expose, so block in poll() here and post a `ConcurrentTask` to the JS
    /// thread when it does — same off-thread→enqueue shape as macOS/Windows.
    ///
    /// On Linux, closing an fd from another thread does NOT wake a poll()
    /// already blocked on it: poll holds its own `struct file` reference via
    /// fdget(), so close() just decrements f_count without reaching
    /// release(). Use a finite timeout so `shutdown` is checked periodically
    /// instead of relying on cross-thread close-as-wakeup.
    fn run(s_ptr: *mut State) {
        // SAFETY: `s_ptr` is the live heap allocation from install(); it
        // outlives this thread because uninstall() joins before destroying.
        let s = unsafe { &*s_ptr };
        let mut fds = [libc::pollfd {
            fd: s.fd.native(),
            events: libc::POLLPRI,
            revents: 0,
        }];
        while !s.shutdown.load(Ordering::Relaxed) {
            // SAFETY: `fds` is a valid 1-element array.
            let n = unsafe { libc::poll(fds.as_mut_ptr(), 1, 200) };
            if s.shutdown.load(Ordering::Relaxed) {
                break;
            }
            if n < 0 {
                // EINTR: a stray signal (e.g. profiler SIGPROF) interrupted
                // the poll — retry. Any other errno is unexpected for a PSI
                // fd and permanently disables the watcher.
                if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                break;
            }
            if n == 0 {
                continue;
            }
            if fds[0].revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
                break;
            }
            if fds[0].revents & libc::POLLPRI == 0 {
                continue;
            }

            // SAFETY: `vm` is the main-thread VM, live for the watcher's
            // lifetime (uninstall() runs before VM destroy). The event
            // loop's concurrent queue is a lock-free MPSC.
            unsafe {
                (*s.vm)
                    .event_loop_shared()
                    .enqueue_task_concurrent(ConcurrentTask::from_callback(s_ptr, on_js_thread));
            }

            // PSI re-fires every measurement window while the stall persists;
            // throttle so we don't sync-GC in a tight loop. Sleep in slices so
            // shutdown is reasonably prompt.
            let mut slept: u64 = 0;
            while slept < HOLDOFF_MS && !s.shutdown.load(Ordering::Relaxed) {
                std::thread::sleep(core::time::Duration::from_millis(200));
                slept += 200;
            }
        }
    }

    /// JS thread.
    fn on_js_thread(s: *mut State) -> bun_event_loop::JsResult<()> {
        if state_ptr().is_null() {
            return Ok(()); // uninstall() raced
        }
        // SAFETY: STATE non-null ⇒ `s` is still the live allocation.
        respond(unsafe { &*(*s).vm }, true);
        Ok(())
    }

    pub(super) fn uninstall() {
        let s = STATE.swap(core::ptr::null_mut(), Ordering::AcqRel);
        if s.is_null() {
            return;
        }
        // SAFETY: `s` was the live STATE allocation; we are the sole owner now.
        unsafe {
            (*s).shutdown.store(true, Ordering::Relaxed);
            // run()'s 200 ms poll timeout picks up the shutdown flag; join
            // first and only then close the fd, so a concurrent fd-table
            // reuse can't make the watcher poll() an unrelated file.
            if let Some(handle) = (*s).thread.take() {
                let _ = handle.join();
            }
            let _ = bun_sys::close((*s).fd);
            bun_core::heap::destroy(s);
        }
    }
}

// ───────────────────────────────────── Darwin ───────────────────────────────

#[cfg(target_os = "macos")]
mod backend {
    pub(super) use super::darwin::*;
}
#[cfg(target_os = "macos")]
use darwin::State;

#[cfg(target_os = "macos")]
mod darwin {
    use super::*;
    use bun_event_loop::ConcurrentTask::ConcurrentTask;
    use core::ffi::{c_long, c_ulong, c_void};

    /// Debug-only instrumentation for `test_uninstall_barrier()` — lets the
    /// test deterministically park a libdispatch-invoked event handler in
    /// the post-`shutting_down`-check / pre-`enqueue_task_concurrent` window
    /// while `uninstall()` runs, then observe whether the handler completed
    /// before `uninstall()` returned.
    #[cfg(debug_assertions)]
    #[derive(Default)]
    pub(super) struct TestHooks {
        in_handler: bun_threading::ResetEvent,
        proceed: bun_threading::ResetEvent,
        after_cancel: bun_threading::ResetEvent,
        handler_done: bun_threading::ResetEvent,
    }

    pub(super) struct State {
        source: *mut c_void,
        /// Signalled by the cancel handler once the last in-flight event
        /// handler has returned. `uninstall()` blocks on this so it doesn't
        /// return to `VirtualMachine::destroy()` until no off-thread enqueue
        /// can happen — same guarantee as Linux's `thread.join()` and
        /// Windows's `UnregisterWaitEx(..., INVALID_HANDLE_VALUE)`.
        drained: *mut c_void,
        vm: *mut VirtualMachine,
        /// Set on the dispatch thread, consumed on the JS thread.
        pending_critical: AtomicBool,
        /// Fast-path bail for an in-flight `on_pressure_dispatch` during
        /// shutdown. Not load-bearing for safety — `drained` is what makes
        /// `uninstall()` block until the handler finishes; this just avoids
        /// an unnecessary enqueue when the handler hasn't started yet.
        shutting_down: AtomicBool,
        #[cfg(debug_assertions)]
        test_hooks: AtomicPtr<TestHooks>,
    }
    // SAFETY: libdispatch worker thread only touches `source` (opaque, for
    // `dispatch_source_get_data`), `drained` (opaque, for semaphore signal),
    // atomics, and `vm` to post onto the thread-safe concurrent-task queue.
    unsafe impl Send for State {}
    unsafe impl Sync for State {}

    pub(super) fn install(vm: *mut VirtualMachine) {
        let mask = DISPATCH_MEMORYPRESSURE_WARN
            | DISPATCH_MEMORYPRESSURE_CRITICAL
            | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN
            | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL;
        let src_type = core::ptr::addr_of!(_dispatch_source_type_memorypressure);
        install_source(vm, src_type, mask, "DISPATCH_SOURCE_TYPE_MEMORYPRESSURE");
    }

    fn install_source(
        vm: *mut VirtualMachine,
        source_type: *const c_void,
        mask: c_ulong,
        name: &str,
    ) {
        // SAFETY: libdispatch C API; all pointers valid or null as documented.
        unsafe {
            let queue = dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
            let source = dispatch_source_create(source_type, 0, mask, queue);
            if source.is_null() {
                log!("dispatch_source_create({}) failed", name);
                return;
            }
            let drained = dispatch_semaphore_create(0);
            if drained.is_null() {
                log!("dispatch_semaphore_create failed");
                dispatch_release(source);
                return;
            }
            let s = bun_core::heap::alloc(State {
                source,
                drained,
                vm,
                pending_critical: AtomicBool::new(true),
                shutting_down: AtomicBool::new(false),
                #[cfg(debug_assertions)]
                test_hooks: AtomicPtr::new(core::ptr::null_mut()),
            });
            STATE.store(s, Ordering::Release);
            dispatch_set_context(source, s.cast());
            dispatch_source_set_event_handler_f(source, on_pressure_dispatch);
            // libdispatch guarantees the cancel handler runs only after the
            // last event handler has returned. on_cancelled signals `drained`;
            // uninstall() waits on it before releasing/destroying.
            dispatch_source_set_cancel_handler_f(source, on_cancelled);
            dispatch_resume(source);
        }
        log!("installed ({})", name);
    }

    /// libdispatch worker thread. The kernel only fires on state
    /// *transitions*, so no holdoff is needed — one task per transition.
    extern "C" fn on_pressure_dispatch(ctx: *mut c_void) {
        let s_ptr = ctx.cast::<State>();
        // SAFETY: `ctx` is the State set via dispatch_set_context in install.
        let s = unsafe { &*s_ptr };
        if s.shutting_down.load(Ordering::Acquire) {
            return;
        }
        #[cfg(debug_assertions)]
        {
            let th = s.test_hooks.load(Ordering::Acquire);
            if !th.is_null() {
                // Park in the race window so test_uninstall_barrier() can run
                // uninstall() while we're between the check and the enqueue.
                // SAFETY: `th` is the stack-local TestHooks in the test seam,
                // kept alive past `handler_done.wait()`.
                unsafe {
                    (*th).in_handler.set();
                    (*th).proceed.wait();
                }
            }
        }
        // SAFETY: `s.source` is the live dispatch source.
        let data = unsafe { dispatch_source_get_data(s.source) };
        let critical = (data
            & (DISPATCH_MEMORYPRESSURE_CRITICAL | DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL))
            != 0;
        s.pending_critical.store(critical, Ordering::Relaxed);
        // SAFETY: `vm` is the main-thread VM, live for the watcher's lifetime
        // (uninstall() runs before VM destroy). Concurrent queue is MPSC.
        unsafe {
            (*s.vm)
                .event_loop_shared()
                .enqueue_task_concurrent(ConcurrentTask::from_callback(s_ptr, on_js_thread));
        }
        #[cfg(debug_assertions)]
        {
            let th = s.test_hooks.load(Ordering::Acquire);
            if !th.is_null() {
                // SAFETY: see above.
                unsafe { (*th).handler_done.set() };
            }
        }
    }

    /// JS thread.
    fn on_js_thread(s: *mut State) -> bun_event_loop::JsResult<()> {
        if state_ptr().is_null() {
            return Ok(()); // uninstall() raced
        }
        // SAFETY: STATE non-null ⇒ `s` is still the live allocation.
        unsafe {
            respond(&*(*s).vm, (*s).pending_critical.load(Ordering::Relaxed));
        }
        Ok(())
    }

    pub(super) fn uninstall() {
        let s = STATE.swap(core::ptr::null_mut(), Ordering::AcqRel);
        if s.is_null() {
            return;
        }
        // SAFETY: `s` was the live STATE allocation; uninstall runs on the JS
        // thread. libdispatch worker may still be in on_pressure_dispatch.
        unsafe {
            (*s).shutting_down.store(true, Ordering::Release);
            dispatch_source_cancel((*s).source);
            #[cfg(debug_assertions)]
            {
                let th = (*s).test_hooks.load(Ordering::Acquire);
                if !th.is_null() {
                    (*th).after_cancel.set();
                }
            }
            // dispatch_source_cancel() is async and does NOT wait for an
            // in-flight event handler — without this barrier,
            // on_pressure_dispatch could be between its shutting_down.load()
            // and enqueue_task_concurrent() while VirtualMachine::destroy()
            // proceeds past us to has_terminated=true (which makes that
            // enqueue panic under debug_assertions). libdispatch guarantees
            // the cancel handler runs only after the last event handler
            // returns, so blocking on `drained` here closes the race. No
            // deadlock risk: we're on the JS thread, the cancel handler runs
            // on a libdispatch worker for the global utility queue. Verified
            // by test_uninstall_barrier().
            let _ = dispatch_semaphore_wait((*s).drained, DISPATCH_TIME_FOREVER);
            dispatch_release((*s).drained);
            dispatch_release((*s).source);
            bun_core::heap::destroy(s);
        }
    }

    /// libdispatch worker thread. Runs after the last `on_pressure_dispatch`
    /// has returned. Must not touch `s` after signalling — `uninstall()` may
    /// destroy it the moment the wait unblocks.
    extern "C" fn on_cancelled(ctx: *mut c_void) {
        let s = ctx.cast::<State>();
        // SAFETY: `s` is the State set via dispatch_set_context; `drained`
        // is the live semaphore. `uninstall()` won't release it until the
        // signal unblocks the wait.
        unsafe {
            let _ = dispatch_semaphore_signal((*s).drained);
        }
    }

    /// Debug-only red/green seam for the `uninstall()` barrier.
    ///
    /// Installs a `DISPATCH_SOURCE_TYPE_DATA_ADD` source (fireable on demand
    /// via `dispatch_source_merge_data`) through the SAME install_source /
    /// on_pressure_dispatch / on_cancelled / uninstall path the real
    /// MEMORYPRESSURE source uses, fires it once, parks the libdispatch
    /// worker in the race window, then calls `uninstall()` and snapshots
    /// `handler_done` immediately after it returns.
    #[cfg(debug_assertions)]
    pub(super) fn test_uninstall_barrier(vm: *mut VirtualMachine) -> bool {
        debug_assert!(state_ptr().is_null()); // don't clobber a real install

        let hooks = bun_core::heap::alloc(TestHooks::default());
        let src_type = core::ptr::addr_of!(_dispatch_source_type_data_add);
        install_source(vm, src_type, 0, "DISPATCH_SOURCE_TYPE_DATA_ADD (test)");
        let s = state_ptr();
        if s.is_null() {
            // install_source failed; nothing to test.
            // SAFETY: sole owner.
            unsafe { bun_core::heap::destroy(hooks) };
            return true;
        }
        // SAFETY: `s` is the fresh State from install_source; sole writer of
        // `test_hooks` on this thread before the source fires.
        unsafe { (*s).test_hooks.store(hooks, Ordering::Release) };

        // Fire the source so libdispatch invokes on_pressure_dispatch on a
        // worker (NOT a direct call — the cancel-handler ordering guarantee
        // only applies to libdispatch-managed invocations).
        // SAFETY: `s.source` is live.
        unsafe {
            dispatch_source_merge_data((*s).source, 1);
            (*hooks).in_handler.wait();
        }

        // Helper thread releases the worker only once uninstall() is past
        // dispatch_source_cancel() — i.e., inside what would be the race
        // window if uninstall() didn't block.
        let hooks_addr = hooks as usize;
        let helper = std::thread::Builder::new().spawn(move || {
            let th = hooks_addr as *mut TestHooks;
            // SAFETY: `hooks` outlives this thread (destroyed after join).
            unsafe {
                (*th).after_cancel.wait();
                (*th).proceed.set();
            }
        });
        let helper = match helper {
            Ok(h) => h,
            Err(_) => {
                // Can't spawn — unblock the worker and tear down so we don't
                // hang; report inconclusive-as-pass.
                // SAFETY: `hooks` live until destroy below.
                unsafe {
                    (*hooks).proceed.set();
                    self::uninstall();
                    (*hooks).handler_done.wait();
                    bun_core::heap::destroy(hooks);
                }
                return true;
            }
        };

        self::uninstall();
        // SAFETY: `hooks` still live; worker signals handler_done before
        // on_cancelled (which in turn precedes uninstall()'s destroy of `s`).
        let blocked = unsafe { (*hooks).handler_done.is_set() };
        // Drain so `hooks` outlives the worker even when uninstall() didn't
        // block (RED). on_cancelled then frees `s` once the worker returns.
        // SAFETY: `hooks` live until destroy.
        unsafe { (*hooks).handler_done.wait() };
        let _ = helper.join();
        // SAFETY: sole owner; worker and helper have both exited.
        unsafe { bun_core::heap::destroy(hooks) };
        blocked
    }

    unsafe extern "C" {
        static _dispatch_source_type_memorypressure: c_void;
        static _dispatch_source_type_data_add: c_void;
        fn dispatch_source_create(
            type_: *const c_void,
            handle: usize,
            mask: c_ulong,
            queue: *mut c_void,
        ) -> *mut c_void;
        fn dispatch_source_set_event_handler_f(
            source: *mut c_void,
            handler: extern "C" fn(*mut c_void),
        );
        fn dispatch_source_set_cancel_handler_f(
            source: *mut c_void,
            handler: extern "C" fn(*mut c_void),
        );
        fn dispatch_source_merge_data(source: *mut c_void, value: c_ulong);
        fn dispatch_set_context(object: *mut c_void, context: *mut c_void);
        fn dispatch_source_get_data(source: *mut c_void) -> c_ulong;
        fn dispatch_get_global_queue(identifier: c_long, flags: c_ulong) -> *mut c_void;
        fn dispatch_resume(object: *mut c_void);
        fn dispatch_source_cancel(source: *mut c_void);
        fn dispatch_release(object: *mut c_void);
        fn dispatch_semaphore_create(value: c_long) -> *mut c_void;
        fn dispatch_semaphore_signal(sema: *mut c_void) -> c_long;
        fn dispatch_semaphore_wait(sema: *mut c_void, timeout: u64) -> c_long;
    }
    const DISPATCH_TIME_FOREVER: u64 = !0u64;
    const DISPATCH_MEMORYPRESSURE_WARN: c_ulong = 0x02;
    const DISPATCH_MEMORYPRESSURE_CRITICAL: c_ulong = 0x04;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_WARN: c_ulong = 0x10;
    const DISPATCH_MEMORYPRESSURE_PROC_LIMIT_CRITICAL: c_ulong = 0x20;
    const QOS_CLASS_UTILITY: c_long = 0x11;
}

// ───────────────────────────────────── Windows ──────────────────────────────

#[cfg(windows)]
mod backend {
    pub(super) use super::windows::*;
}
#[cfg(windows)]
use windows::State;

#[cfg(windows)]
mod windows {
    use super::*;
    use bun_sys::windows::libuv as uv;
    use bun_sys::windows::libuv::UvHandle as _;
    use core::ffi::c_void;
    use core::sync::atomic::AtomicU32;

    type HANDLE = *mut c_void;
    type BOOLEAN = u8;
    type BOOL = core::ffi::c_int;
    type ULONG = core::ffi::c_ulong;
    type WAITORTIMERCALLBACK = Option<unsafe extern "system" fn(*mut c_void, BOOLEAN)>;

    const INFINITE: ULONG = 0xFFFF_FFFF;
    const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as isize as HANDLE;
    const WT_EXECUTEINWAITTHREAD: ULONG = 0x00000004;
    const WT_EXECUTEONLYONCE: ULONG = 0x00000008;
    /// `MEMORY_RESOURCE_NOTIFICATION_TYPE::LowMemoryResourceNotification`.
    const LOW_MEMORY_RESOURCE_NOTIFICATION: core::ffi::c_int = 0;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMemoryResourceNotification(NotificationType: core::ffi::c_int) -> HANDLE;
        fn RegisterWaitForSingleObject(
            phNewWaitObject: *mut HANDLE,
            hObject: HANDLE,
            Callback: WAITORTIMERCALLBACK,
            Context: *mut c_void,
            dwMilliseconds: ULONG,
            dwFlags: ULONG,
        ) -> BOOL;
        fn UnregisterWaitEx(WaitHandle: HANDLE, CompletionEvent: HANDLE) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
        safe fn GetLastError() -> core::ffi::c_ulong;
    }

    pub(super) struct State {
        notification: HANDLE,
        wait: AtomicPtr<c_void>,
        wake: uv::uv_async_t,
        rearm: uv::Timer,
        vm: *mut VirtualMachine,
        /// uv_close is async and close callbacks fire LIFO within a loop
        /// tick, so destroying State from one handle's close cb while the
        /// other's is still pending is a UAF. Count both closes down to 0.
        closing: AtomicU32,
    }
    // SAFETY: the NT threadpool callback only calls `wake.send()` (libuv
    // uv_async_send is thread-safe). Everything else runs on the JS thread.
    unsafe impl Send for State {}
    unsafe impl Sync for State {}

    pub(super) fn install(vm: *mut VirtualMachine) {
        // SAFETY: Win32 API; returns null on failure.
        let notification =
            unsafe { CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION) };
        if notification.is_null() {
            log!(
                "CreateMemoryResourceNotification failed (err={})",
                GetLastError()
            );
            return;
        }

        let s = bun_core::heap::alloc(State {
            notification,
            wait: AtomicPtr::new(core::ptr::null_mut()),
            wake: bun_core::ffi::zeroed(),
            rearm: bun_core::ffi::zeroed(),
            vm,
            closing: AtomicU32::new(0),
        });
        STATE.store(s, Ordering::Release);

        // SAFETY: `s` is a fresh heap allocation; `vm` is the live main-thread
        // VM with an initialised event loop.
        unsafe {
            let uv_loop = (*vm).uv_loop();
            (*s).wake.init(uv_loop, Some(on_wake));
            (*s).wake.unref();
            (*s).wake.set_data(s.cast());
            (*s).rearm.init(uv_loop);
            (*s).rearm.unref();
            (*s).rearm.data = s.cast();
        }

        if !arm(s) {
            log!(
                "RegisterWaitForSingleObject failed (err={}); watcher disabled",
                GetLastError()
            );
            return;
        }
        log!("installed (RegisterWaitForSingleObject)");
    }

    fn arm(s: *mut State) -> bool {
        let mut wait: HANDLE = core::ptr::null_mut();
        // SAFETY: `s` is live; `notification` is a valid kernel handle; the
        // callback receives `s` as its context.
        let ok = unsafe {
            RegisterWaitForSingleObject(
                &mut wait,
                (*s).notification,
                Some(on_low_memory_threadpool),
                s.cast(),
                INFINITE,
                WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE,
            )
        };
        if ok == 0 {
            return false;
        }
        // SAFETY: `s` is live; sole writer on JS thread.
        unsafe { (*s).wait.store(wait, Ordering::Release) };
        true
    }

    /// NT threadpool thread. The notification handle is *level*-triggered: it
    /// stays signalled while memory remains low, so we registered ONLYONCE and
    /// re-arm from the JS thread after the holdoff.
    unsafe extern "system" fn on_low_memory_threadpool(ctx: *mut c_void, _timed_out: BOOLEAN) {
        let s = ctx.cast::<State>();
        // SAFETY: `s` is the live context; uv_async_send is thread-safe.
        unsafe { (*s).wake.send() };
    }

    /// JS thread.
    unsafe extern "C" fn on_wake(handle: *mut uv::uv_async_t) {
        // SAFETY: `handle.data` was set to `s` in install().
        let s = unsafe { (*handle).data.cast::<State>() };
        // WT_EXECUTEONLYONCE only stops the callback re-firing; per MSDN the
        // wait registration must still be UnregisterWaitEx'd to free the NT
        // threadpool object. Safe to do here: we're on the JS thread (via
        // uv_async), not inside the WAITORTIMERCALLBACK.
        // SAFETY: `s` is live (STATE still points at it).
        unsafe {
            let w = (*s).wait.swap(core::ptr::null_mut(), Ordering::AcqRel);
            if !w.is_null() {
                let _ = UnregisterWaitEx(w, core::ptr::null_mut());
            }
            respond(&*(*s).vm, true);
            (*s).rearm.start(HOLDOFF_MS, 0, Some(on_rearm));
            (*s).rearm.unref();
        }
    }

    /// JS thread.
    unsafe extern "C" fn on_rearm(handle: *mut uv::Timer) {
        // SAFETY: `handle.data` was set to `s` in install().
        let s = unsafe { (*handle).data.cast::<State>() };
        if state_ptr().is_null() {
            return; // uninstall() raced
        }
        if !arm(s) {
            log!(
                "RegisterWaitForSingleObject re-arm failed (err={}); watcher disabled",
                GetLastError()
            );
        }
    }

    pub(super) fn uninstall() {
        let s = STATE.swap(core::ptr::null_mut(), Ordering::AcqRel);
        if s.is_null() {
            return;
        }
        // SAFETY: `s` was the live STATE allocation. Runs on the JS thread.
        unsafe {
            let w = (*s).wait.swap(core::ptr::null_mut(), Ordering::AcqRel);
            if !w.is_null() {
                // INVALID_HANDLE_VALUE waits for any in-flight callback to drain.
                let _ = UnregisterWaitEx(w, INVALID_HANDLE_VALUE);
            }
            let _ = CloseHandle((*s).notification);
            (*s).rearm.stop();
            (*s).closing.store(2, Ordering::Release);
            (*s).rearm.close(on_closed_timer);
            (*s).wake.close(on_closed_async);
        }
    }

    unsafe extern "C" fn on_closed_timer(handle: *mut uv::Timer) {
        // SAFETY: `handle.data` is `s`.
        on_closed(unsafe { (*handle).data.cast::<State>() });
    }
    unsafe extern "C" fn on_closed_async(handle: *mut uv::uv_async_t) {
        // SAFETY: `handle.data` is `s`.
        on_closed(unsafe { (*handle).data.cast::<State>() });
    }
    fn on_closed(s: *mut State) {
        // SAFETY: `s` is the live allocation until the counter hits 0.
        if unsafe { (*s).closing.fetch_sub(1, Ordering::AcqRel) } == 1 {
            // SAFETY: both uv handles have fired their close cb; sole owner.
            unsafe { bun_core::heap::destroy(s) };
        }
    }
}

// ported from: src/aio/MemoryPressureWatcher.zig
