//! `jsc.EventLoop` — the JS-thread event loop.
//!
//! `tick`/`enter`/`exit`/`drain_microtasks`/`run_callback`/concurrent-queue
//! plumbing are real. The two hot dispatch loops (`tickQueueWithCount`'s
//! per-`Task` switch and `ImmediateObject::runImmediateTask`) name
//! `bun_runtime` types and are hoisted to that tier via link-time
//! `extern "Rust"` (`__bun_tick_queue_with_count` / `__bun_run_immediate_task`);
//! `auto_tick`/`auto_tick_active` likewise
//! dispatch through `virtual_machine::RuntimeHooks` (need `Timer::All` for the
//! poll deadline). See PORTING.md §Dispatch.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};

use bun_io::{self as Async, Waker};
use bun_uws as uws;

use crate::js_promise::Status as PromiseStatus;
use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin re-exports of sibling/neighbor modules — do NOT inline
// bodies). Kept so downstream `bun_jsc::event_loop::Foo` paths resolve.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::AnyTaskWithExtraContext;
pub use bun_event_loop::ConcurrentTask::{
    self, ConcurrentTask as ConcurrentTaskItem, Queue as ConcurrentQueue,
};
pub use bun_event_loop::DeferredTaskQueue::{self, DeferredRepeatingTask};
pub use bun_event_loop::ManagedTask;
pub use bun_event_loop::MiniEventLoop;
pub use bun_event_loop::Task;
pub use bun_event_loop::any_event_loop::{AnyEventLoop, EventLoopHandle, EventLoopTask};
pub use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

pub use crate::cpp_task::{ConcurrentCppTask, CppTask};
pub use crate::garbage_collection_controller::GarbageCollectionController;
pub use crate::jsc_scheduler as JSCScheduler;
pub use crate::posix_signal_handle::{PosixSignalHandle, PosixSignalTask};

bun_core::declare_scope!(EventLoop, hidden);

pub type Queue =
    bun_collections::LinearFifo<Task, bun_collections::linear_fifo::DynamicBuffer<Task>>;

pub struct EventLoop {
    pub tasks: Queue,
    /// Set when teardown releases the queue: from then on `enqueue_task`
    /// releases instead of parking (nothing will tick this loop again).
    closed_for_tasks: bool,

    /// setImmediate() gets it's own two task queues
    /// When you call `setImmediate` in JS, it queues to the start of the next tick
    /// This is confusing, but that is how it works in Node.js.
    ///
    /// So we have two queues:
    ///   - next_immediate_tasks: tasks that will run on the next tick
    ///   - immediate_tasks: tasks that will run on the current tick
    ///
    /// Having two queues avoids infinite loops creating by calling `setImmediate` in a `setImmediate` callback.
    ///
    /// Note (§Dispatch): payload is `*mut ()` — the real
    /// `bun_runtime::timer::ImmediateObject` lives in the higher-tier crate
    /// (cycle). Low tier stores the erased pointer; the high-tier hook
    /// (link-time `__bun_run_immediate_task`) casts it back.
    pub immediate_tasks: Vec<*mut ()>,
    pub next_immediate_tasks: Vec<*mut ()>,
    /// Tasks that asked to run on the *next* loop iteration — after I/O and
    /// timers have had a turn — rather than in the current drain, which runs
    /// until the queue is empty (a task that re-posts itself there never lets
    /// the loop poll). Promoted into `tasks` by `auto_tick`, like immediates.
    pub yield_tasks: Vec<Task>,

    pub concurrent_tasks: ConcurrentQueue,
    /// Set only on Bun.spawnSync's isolated loop: how other threads reach *this*
    /// loop's queue (the VM's handle names only the VM's own two loops).
    pub(crate) isolated_poster: Option<std::sync::Arc<crate::vm_handle::IsolatedPosterInner>>,
    // BACKREF — `*JSGlobalObject` owned by the VM; outlives this EventLoop.
    pub global: Option<NonNull<JSGlobalObject>>,
    // BACKREF — owning `*VirtualMachine` (EventLoop is a value field of it).
    pub virtual_machine: Option<NonNull<VirtualMachine>>,
    pub waker: Option<Waker>,
    // see `hold_forever_poll`
    #[cfg(windows)]
    pub forever_timer: Option<NonNull<uws::Timer>>,
    #[cfg(not(windows))]
    pub holds_forever_poll: bool,
    pub deferred_tasks: DeferredTaskQueue::DeferredTaskQueue,
    /// The uws loop this `EventLoop` runs on: the process loop for the VM's
    /// embedded loops, a private one for a spawnSync loop. Set by
    /// `ensure_waker` / `__bun_spawn_sync_create_event_loop`.
    pub uws_loop: Option<NonNull<uws::Loop>>,

    pub entered_event_loop_count: isize,
    pub concurrent_ref: AtomicI32,
    /// Atomic nullable pointer to the next-due `WTFTimer`.
    ///
    /// Note (§Dispatch): payload is `*mut ()` — the real
    /// `bun_runtime::timer::WTFTimer` lives in the higher-tier crate (cycle).
    /// Low tier stores the erased pointer; the high-tier hook installed via
    /// (link-time `__bun_run_wtf_timer`) casts it back.
    pub imminent_gc_timer: AtomicPtr<()>,

    #[cfg(unix)]
    /// Boxed `PosixSignalHandle` ring buffer, leaked once by
    /// `Bun__ensureSignalHandler` and live for the process lifetime. Stored as
    /// a [`bun_ptr::BackRef`] so the per-tick `drain()` / signal-context
    /// `enqueue()` reads go through the single audited `BackRef::deref`
    /// instead of an open-coded `NonNull::as_ref` `unsafe` at each site.
    pub signal_handler: Option<bun_ptr::BackRef<PosixSignalHandle>>,
    #[cfg(not(unix))]
    pub signal_handler: (),
}

impl Default for EventLoop {
    fn default() -> Self {
        Self {
            tasks: Queue::init(),
            closed_for_tasks: false,
            immediate_tasks: Vec::new(),
            next_immediate_tasks: Vec::new(),
            yield_tasks: Vec::new(),
            concurrent_tasks: ConcurrentQueue::default(),
            isolated_poster: None,
            global: None,
            virtual_machine: None,
            waker: None,
            #[cfg(windows)]
            forever_timer: None,
            #[cfg(not(windows))]
            holds_forever_poll: false,
            deferred_tasks: DeferredTaskQueue::DeferredTaskQueue::default(),
            uws_loop: None,
            entered_event_loop_count: 0,
            concurrent_ref: AtomicI32::new(0),
            imminent_gc_timer: AtomicPtr::new(core::ptr::null_mut()),
            #[cfg(unix)]
            signal_handler: None,
            #[cfg(not(unix))]
            signal_handler: (),
        }
    }
}

mod drain_result {
    pub(super) const SUCCESS: u8 = 0;
    pub(super) const STOPPED: u8 = 1;
    /// A (non-termination) exception is pending: no checkpoint ran.
    pub(super) const PENDING_EXCEPTION: u8 = 2;
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; C++ mutating
// the microtask queue through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn JSC__JSGlobalObject__drainMicrotasks(global: &JSGlobalObject) -> u8;
}

impl JSGlobalObject {
    /// Run one microtask checkpoint: `process.nextTick` callbacks, then the
    /// JSC microtask queue, and nothing else. No timers, no I/O, no deferred
    /// tasks, so this cannot re-enter the event loop.
    ///
    /// `Err` means the drain met this VM's termination; it is left pending for the caller's landing frame.
    pub fn drain_microtasks_and_next_ticks(&self) -> Result<(), Stopped> {
        jsc::mark_binding();
        match JSC__JSGlobalObject__drainMicrotasks(self) {
            drain_result::SUCCESS | drain_result::PENDING_EXCEPTION => Ok(()),
            drain_result::STOPPED => Err(Stopped),
            _ => unreachable!(),
        }
    }
}

/// This VM no longer runs script (a worker being terminated, or teardown has begun): what loop-level
/// code -- ticks, task completions, waits, "should I enter JS?" -- returns to say "stand down". Only
/// loop-level code reads the gate (`script_allowed`) and speaks `Stopped`; code inside a JS operation
/// (`JsResult`) only ever sees exceptions. A boundary that entered JS produces `Stopped` when the
/// exception it takes is the termination (WebCore: `isTerminationException(returned)`) -- and takes it:
/// nothing stays pending past a landing frame; the stop itself is the closed gate. The opposite crossing
/// -- a stop that must become a `JsError` -- is [`Stopped::throw`], never an implicit `From`.
#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
#[error("Stopped")]
pub struct Stopped;

impl Stopped {
    /// Cross into a `JsResult` function. Beneath script (a nested wait/drain inside a host function),
    /// throw the VM's TerminationException for real — what `VMTraps` does on trap — so JSC unwinds the
    /// script above and `Err(Thrown)` keeps meaning "an exception is pending". Outside script there is
    /// nothing to unwind: `Terminated`, nothing pending.
    #[cold]
    pub fn throw(self, global: &JSGlobalObject) -> crate::JsError {
        if !global.vm().is_entered() {
            return crate::JsError::Terminated;
        }
        match crate::cpp::JSC__JSGlobalObject__throwTerminationException(global) {
            Err(err) => err,
            Ok(()) => {
                unreachable!("throwTerminationException returned without an exception pending")
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch hot-path — `tick_queue_with_count` is the per-tick dispatch over
// `Task { tag, ptr }`. Per PORTING.md, the *high tier owns the match loop*:
// `bun_runtime` registers the real dispatcher at init; this crate only stores
// `(tag, ptr)` and the hook. The dispatch match lives in
// `bun_runtime::dispatch::run_tasks` (every arm names a `bun_runtime` type).
// ──────────────────────────────────────────────────────────────────────────
// The hook receives the specific `EventLoop` to drain (which may be the
// isolated `SpawnSyncEventLoop`, not `vm.event_loop()`) plus the VM.
unsafe extern "Rust" {
    /// `bun_runtime::dispatch::tick_queue_with_count` — the real per-task
    /// match loop. Link-time resolved.
    fn __bun_tick_queue_with_count(
        el: *mut EventLoop,
        vm: *mut VirtualMachine,
        counter: &mut u32,
    ) -> Result<(), Stopped>;
    /// `ImmediateObject::runImmediateTask` — `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject`; returns whether the callback
    /// threw. Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_immediate_task(task: *mut (), vm: *mut VirtualMachine) -> bool;
    /// Release the event loop's `+1` ref on a still-queued `ImmediateObject`
    /// without running it. Defined in `bun_runtime::dispatch`.
    fn __bun_cancel_pending_immediate(task: *mut (), vm: *mut VirtualMachine);
    /// `WTFTimer::run` — `timer` is an erased `*mut bun_runtime::timer::WTFTimer`.
    /// Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_wtf_timer(timer: *mut (), vm: *mut VirtualMachine);
    /// Free a queued task that will never run, through its type's
    /// `Taskable::release_unrun` (one arm per tag in `bun_runtime::dispatch`).
    /// JS thread, JSC heap alive. Link-time resolved.
    fn __bun_release_task_unrun(task: bun_event_loop::Task);
}

#[inline]
fn tick_queue_with_count(
    el: &mut EventLoop,
    vm: *mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), Stopped> {
    // SAFETY: `el` is the queue to drain (may be the isolated spawnSync loop);
    // `vm` is the live per-thread VM (caller contract).
    unsafe { __bun_tick_queue_with_count(el, vm, counter) }
}

/// RAII pairing for [`EventLoop::enter`] / [`EventLoop::exit`].
///
/// Holds the raw `*mut EventLoop` (not `&mut`) so re-entrant JS callbacks that
/// touch the same loop while the guard is live don't alias a long-lived mutable
/// borrow — the `&mut` is formed only at the enter/exit call sites. Construct
/// via [`EventLoop::enter_scope`].
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EventLoopEnterGuard {
    loop_: *mut EventLoop,
}

impl Drop for EventLoopEnterGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `loop_` was live at `enter_scope` and the VM owns it for the
        // process lifetime; forming a short-lived `&mut` here mirrors the
        // manual `(*loop_).exit()` callers previously wrote.
        unsafe { (*self.loop_).exit() };
    }
}

/// RAII pairing for [`EventLoop::enter`] / [`EventLoop::exit_without_checkpoint`].
///
/// Holds the raw pointer for the same reason as [`EventLoopEnterGuard`].
/// Construct via [`EventLoop::enter_scope_without_checkpoint`].
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EventLoopEnterNoCheckpointGuard {
    loop_: *mut EventLoop,
}

impl Drop for EventLoopEnterNoCheckpointGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: as `EventLoopEnterGuard`: `loop_` was live at
        // `enter_scope_without_checkpoint` and the VM owns it for the process
        // lifetime; short-lived `&mut` only.
        unsafe { (*self.loop_).exit_without_checkpoint() };
    }
}

/// Keeps the platform loop ref'd until dropped; construct via [`EventLoop::ref_loop_scoped`].
#[must_use = "dropping immediately releases the loop ref"]
pub struct LoopRefGuard(*mut uws::Loop);

impl Drop for LoopRefGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the per-thread loop outlives the VM; balances the `ref_()` in `ref_loop_scoped`.
            unsafe { (*self.0).unref() };
        }
    }
}

impl EventLoop {
    /// Before your code enters JavaScript at the top of the event loop, call
    /// `loop.enter()`. If running a single callback, prefer `runCallback` instead.
    ///
    /// When we call into JavaScript, we must drain process.nextTick & microtasks
    /// afterwards (so that promises run). We must only do that once per task in the
    /// event loop. To make that work, we count enter/exit calls and once that
    /// counter reaches 0, we drain the microtasks.
    #[inline]
    pub fn enter(&mut self) {
        bun_core::scoped_log!(EventLoop, "enter() = {}", self.entered_event_loop_count);
        self.entered_event_loop_count += 1;
    }

    /// "exit" a microtask context in the event loop. See `enter`.
    ///
    /// The outermost exit is a microtask checkpoint — unless the frame is
    /// leaving with an exception pending (`drainMicrotasks` sees it and does
    /// nothing): that exception is on its way to a fold, which takes it and
    /// then drains.
    pub fn exit(&mut self) {
        let count = self.entered_event_loop_count;
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        if count == 1 && !self.vm_ref().is_inside_deferred_task_queue.get() {
            let _ = self.drain_microtasks();
        }

        self.entered_event_loop_count -= 1;
    }

    /// `enter()` now, `exit()` on drop. Takes the raw VM-owned pointer so the
    /// guard doesn't hold a long-lived `&mut EventLoop` across re-entrant JS.
    ///
    /// # Safety
    /// `loop_` must be the live `vm.event_loop()` pointer and remain valid for
    /// the guard's lifetime (the VM owns it for the process lifetime).
    #[inline]
    pub unsafe fn enter_scope(loop_: *mut EventLoop) -> EventLoopEnterGuard {
        // SAFETY: caller contract — `loop_` is live; short-lived `&mut` only.
        unsafe { (*loop_).enter() };
        EventLoopEnterGuard { loop_ }
    }

    /// Balance an [`enter`](Self::enter) without the checkpoint [`exit`](Self::exit)
    /// runs at the outermost level. See [`Self::enter_scope_without_checkpoint`].
    #[inline]
    pub fn exit_without_checkpoint(&mut self) {
        bun_core::scoped_log!(
            EventLoop,
            "exit_without_checkpoint() = {}",
            self.entered_event_loop_count - 1
        );
        self.entered_event_loop_count -= 1;
    }

    /// `enter()` now, [`exit_without_checkpoint`](Self::exit_without_checkpoint)
    /// on drop.
    ///
    /// For a dispatcher that runs the checkpoint itself once the callback has
    /// returned, at points of its own choosing: the HTTP request paths drain
    /// explicitly so that they can look at a returned promise that the drain
    /// settled (`RequestContext::on_response`, the node:http dispatch), and a
    /// checkpoint on exit would add an empty one per request.
    ///
    /// What the scope is for is the count. Only while it is above zero is the
    /// callback's frame safe from a checkpoint in the middle of it: a native
    /// call made from inside the callback that dispatches another callback
    /// through `enter()`/`exit()` (`server.upgrade()` running `open()`,
    /// `ws.close()` running `close()`) is then a nested pair, not the outermost
    /// one, so its exit does not run the nextTicks and promise reactions the
    /// callback queued before its next statement. The dispatcher's explicit
    /// drains are unconditional, so the held count does not skip them, and the
    /// continuations they run are covered by it as well.
    ///
    /// # Safety
    /// As [`Self::enter_scope`].
    #[inline]
    pub unsafe fn enter_scope_without_checkpoint(
        loop_: *mut EventLoop,
    ) -> EventLoopEnterNoCheckpointGuard {
        // SAFETY: caller contract — `loop_` is live; short-lived `&mut` only.
        unsafe { (*loop_).enter() };
        EventLoopEnterNoCheckpointGuard { loop_ }
    }

    pub fn exit_maybe_drain_microtasks(
        &mut self,
        allow_drain_microtask: bool,
    ) -> Result<(), Stopped> {
        let count = self.entered_event_loop_count;
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        let inside_deferred = self.vm_ref().is_inside_deferred_task_queue.get();
        let result = if allow_drain_microtask && count == 1 && !inside_deferred {
            self.drain_microtasks()
        } else {
            Ok(())
        };

        // On the error path, `entered_event_loop_count` is intentionally NOT
        // decremented.
        if result.is_ok() {
            self.entered_event_loop_count -= 1;
        }
        result
    }

    pub fn drain_microtasks_with_global(
        &mut self,
        global_object: &JSGlobalObject,
        jsc_vm: &jsc::VM,
    ) -> Result<(), Stopped> {
        // Hoist the VM backref once. LLVM can't CSE the `Option<NonNull>` field
        // load across the FFI calls below (`release_weak_refs`, `JSC__JSGlobalObject__drainMicrotasks`,
        // `deferred_tasks.run`), so each `self.vm_ref()` re-loaded
        // `self.virtual_machine` from memory (5× per call, ~2×/request).
        // SAFETY: `virtual_machine` is set in `VirtualMachine::init()` to the
        // owning per-thread singleton; non-null and outlives `self`.
        let vm = unsafe { self.virtual_machine.unwrap_unchecked().as_ref() };

        // During spawnSync, the isolated event loop shares the same VM/GlobalObject.
        // Draining microtasks would execute user JavaScript, which must not happen.
        if vm.suppress_microtask_drain.get() {
            return Ok(());
        }

        jsc::mark_binding();
        jsc_vm.release_weak_refs();

        match JSC__JSGlobalObject__drainMicrotasks(global_object) {
            drain_result::SUCCESS => {}
            drain_result::STOPPED => return Err(Stopped),
            // The exception is on its way to a fold, which drains after taking
            // it; the deferred tasks wait for that checkpoint too.
            drain_result::PENDING_EXCEPTION => return Ok(()),
            _ => unreachable!(),
        }

        // `Cell` write through `&VirtualMachine` — no `&mut VM` formed (would
        // overlap `&mut self: EventLoop`, which is a value field of the VM).
        vm.is_inside_deferred_task_queue.set(true);
        self.deferred_tasks.run();
        vm.is_inside_deferred_task_queue.set(false);

        // Guard on `event_loop_handle` being set, but drain via `uws_loop_mut()`:
        // on Windows the uSockets loop (`uws::Loop::get()`) is NOT
        // `event_loop_handle` (which is the libuv loop).
        if vm.event_loop_handle.is_some() {
            vm.uws_loop_mut().drain_quic_if_necessary();
        }

        Ok(())
    }

    #[inline(always)]
    pub fn drain_microtasks(&mut self) -> Result<(), Stopped> {
        // Read `this.global` directly via `global_ref()` instead of
        // round-tripping through `virtual_machine` (saves a dependent load on
        // the hot path).
        let global = self.global_ref();
        let jsc_vm = self.vm_ref().jsc_vm();
        self.drain_microtasks_with_global(global, jsc_vm)
    }

    // should be called after exit()
    pub fn maybe_drain_microtasks(&mut self) -> Result<(), Stopped> {
        if self.entered_event_loop_count == 0 && !self.vm_ref().is_inside_deferred_task_queue.get()
        {
            return self.drain_microtasks();
        }
        Ok(())
    }

    /// When you call a JavaScript function from outside the event loop task
    /// queue, it has to be wrapped in `runCallback` to ensure that microtasks
    /// are drained and errors are handled.
    pub fn run_callback(
        &mut self,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) {
        // The gate for native code entering user JS from outside the task
        // queue (all 50+ callers funnel through here): not once teardown has
        // forbidden script (Node's `can_call_into_js`), and not with an
        // exception already pending — a prior callback's microtasks can request
        // termination (worker.terminate()), and entering JS then would trip
        // executeCallImpl's `assertNoException`.
        if global_object.has_exception() {
            return;
        }
        // R-2 noalias mitigation (see PORT_NOTES_PLAN R-2; precedent
        // `b818e70e1c57` NodeHTTPResponse::cork): `&mut self` carries LLVM
        // `noalias`, and `callback.call()` receives nothing derived from
        // `self`, so LLVM is licensed to forward `self.entered_event_loop_count`
        // (written by `enter()`) across the JS call into `exit()`. JS re-enters
        // via host-fns that reach this same `EventLoop` through
        // `vm.event_loop()` and may run nested `enter()/exit()` pairs (or call
        // `drain_microtasks` directly), making the cached count stale. ASM-
        // verified PROVEN_CACHED. Launder `self` so the post-call access goes
        // through an opaque pointer LLVM can't prove is in the noalias scope.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the unique live `EventLoop` (a value field of the
        // process-lifetime `VirtualMachine`); short-lived `&mut` only.
        unsafe { (*this).enter() };
        if let Err(err) = callback.call(global_object, this_value, arguments) {
            // A top-level call: reported (or, for the VM's termination, taken) here; the caller reads
            // the gate, not a pending exception, to know the VM has stopped.
            let _ = crate::task::report_error_or_terminate(global_object, err);
        }
        // Force a re-escape between the JS call and the post-call `exit()` so
        // LLVM cannot forward any `*this` field across `call()`.
        let this: *mut Self = core::hint::black_box(this);
        // SAFETY: as above.
        unsafe { (*this).exit() };
        // Note: reshaped for borrowck — `defer this.exit()` moved to tail; no early returns
    }

    pub fn run_callback_with_result(
        &mut self,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> JSValue {
        // Same gate as `run_callback`.
        if global_object.has_exception() {
            return JSValue::ZERO;
        }
        // R-2 noalias mitigation — see `run_callback` above.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the unique live `EventLoop`; short-lived `&mut`.
        unsafe { (*this).enter() };
        let result = match callback.call(global_object, this_value, arguments) {
            Ok(v) => v,
            Err(err) => {
                let _ = crate::task::report_error_or_terminate(global_object, err);
                JSValue::ZERO
            }
        };
        let this: *mut Self = core::hint::black_box(this);
        // SAFETY: as above.
        unsafe { (*this).exit() };
        // Note: reshaped for borrowck — `defer this.exit()` moved to tail
        result
    }

    /// `None`: a task's fold or the checkpoint after it met the VM's termination and landed it; the
    /// turn is over (`tick()` / `tick_tasks_only()` return rather than run more against that VM).
    fn tick_with_count(&mut self, virtual_machine: *mut VirtualMachine) -> Result<u32, Stopped> {
        let mut counter: u32 = 0;
        tick_queue_with_count(self, virtual_machine, &mut counter)?;
        Ok(counter)
    }

    fn tick_concurrent(&mut self) {
        let _ = self.tick_concurrent_with_count();
    }

    /// Whether a keep-alive delta (`ref_keep_alive`, here or through a
    /// `VmHandle`) has been queued but not yet applied to the loop's `active` count.
    pub fn has_pending_refs(&self) -> bool {
        self.concurrent_ref.load(Ordering::SeqCst) > 0
            || self
                .macro_loop_if_not_running()
                .is_some_and(|m| m.concurrent_ref.load(Ordering::SeqCst) > 0)
    }

    /// Other threads have posted work that this loop's next drain will pick up.
    pub(crate) fn has_concurrent_tasks(&self) -> bool {
        !self.concurrent_tasks.is_empty()
            || self
                .macro_loop_if_not_running()
                .is_some_and(|m| !m.concurrent_tasks.is_empty())
    }

    pub fn run_imminent_gc_timer(&mut self) {
        // The real `WTFTimer` lives in `bun_runtime` (cycle), so the body
        // dispatches through `__bun_run_wtf_timer` (link-time extern).
        let ptr = self
            .imminent_gc_timer
            .swap(core::ptr::null_mut(), Ordering::SeqCst);
        if !ptr.is_null() {
            // SAFETY: `ptr` was published by `WTFTimer::update` and remains
            // valid until `run` removes it; `vm()` is the live owning VM.
            unsafe { __bun_run_wtf_timer(ptr, self.vm()) };
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        self.apply_concurrent_ref_delta();

        #[cfg(unix)]
        {
            if let Some(signal_handler) = self.signal_handler {
                // `signal_handler` is a `BackRef` to the leaked process-lifetime
                // `PosixSignalHandle` (see field doc); the ring-buffer backing is
                // disjoint from `*self`, so the `&PosixSignalHandle` materialised
                // by `BackRef::deref` does not alias the `&mut self` passed here.
                signal_handler.drain(self);
            }
        }

        self.run_imminent_gc_timer();

        let start_count = self.tasks.readable_length();
        if let Some(macro_loop) = self.macro_loop_if_not_running() {
            macro_loop.apply_concurrent_ref_delta();
            let batch = macro_loop.concurrent_tasks.pop_batch();
            self.take_concurrent_tasks(batch);
        }

        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return self.tasks.readable_length() - start_count;
        }

        let mut iter = concurrent.iterator();
        let _ = self.tasks.ensure_unused_capacity(count);

        // Defer destruction of the ConcurrentTask to avoid issues with pointer aliasing
        let mut to_destroy: Option<*mut ConcurrentTaskItem> = None;

        loop {
            let task = iter.next();
            if task.is_null() {
                break;
            }
            if let Some(dest) = to_destroy.take() {
                // SAFETY: dest was returned by iterator and marked auto_delete; uniquely owned here
                let _ = unsafe { bun_core::heap::take(dest) };
            }

            // SAFETY: `task` is non-null (checked above) and owned by this
            // batch; only shared reads follow (`auto_delete`, the `task` copy).
            let task_ref = unsafe { &*task };
            if task_ref.auto_delete() {
                to_destroy = Some(task);
            }

            // LinearFifo's fields are private — `write_item` is the
            // public path (single-slot copy, same complexity).
            let _ = self.tasks.write_item(task_ref.task);
        }

        if let Some(dest) = to_destroy {
            // SAFETY: see above
            let _ = unsafe { bun_core::heap::take(dest) };
        }

        self.tasks.readable_length() - start_count
    }

    /// The macro loop, when this is the regular loop and no macro is running.
    /// Work a macro started (a ticket or weak post of `LoopKind::Macro`) posts
    /// its completion and keep-alive release there, but that loop only ticks
    /// while a macro is being waited on; whatever finishes after the macro
    /// returned is this loop's to run, and the platform loop both share stays
    /// alive for it until then.
    fn macro_loop_if_not_running(&self) -> Option<&EventLoop> {
        let vm = self.vm();
        // SAFETY: `vm` is the live owning VM (set in `init()`). `addr_of!`
        // projects to sibling fields without materializing a
        // `&VirtualMachine` that would alias the `&mut self` callers hold.
        unsafe {
            (core::ptr::addr_of!((*vm).has_enabled_macro_mode).read()
                && !core::ptr::addr_of!((*vm).macro_mode).read()
                && core::ptr::eq(self, core::ptr::addr_of!((*vm).regular_event_loop)))
            .then(|| &*core::ptr::addr_of!((*vm).macro_event_loop))
        }
    }

    /// Fold refs/unrefs queued through `ref_keep_alive`/`unref_keep_alive`
    /// (here, or from another thread through `VmHandle`) into this loop's
    /// keep-alive count. Runs at the top of every tick, and once more from a
    /// worker's shutdown after its stop phase (which unrefs
    /// ports/channels/sockets on a loop that no longer ticks) so the loop is not
    /// torn down still believing something keeps it alive.
    ///
    /// Targets `self.native_loop()`, never `vm.event_loop_handle`: `Bun.spawnSync`
    /// points the latter at its private loop, and a GC inside it still refs
    /// this loop (FinalizationRegistry, MessagePort).
    pub(crate) fn apply_concurrent_ref_delta(&self) {
        let delta = self.concurrent_ref.swap(0, Ordering::SeqCst);
        // SAFETY: `native_loop()` is live for this loop's lifetime; JS thread only.
        let loop_ = unsafe { &mut *self.native_loop() };
        #[cfg(windows)]
        {
            if delta > 0 {
                loop_.add_active(u32::try_from(delta).expect("int cast"));
            } else {
                loop_.sub_active(u32::try_from(-delta).expect("int cast"));
            }
        }
        #[cfg(not(windows))]
        {
            if delta > 0 {
                loop_.num_polls += delta;
                loop_.active = loop_
                    .active
                    .saturating_add(u32::try_from(delta).expect("int cast"));
            } else {
                loop_.num_polls -= -delta;
                loop_.active = loop_
                    .active
                    .saturating_sub(u32::try_from(-delta).expect("int cast"));
            }
        }
    }

    /// The uws loop this `EventLoop` runs on.
    pub fn usockets_loop(&self) -> *mut uws::Loop {
        self.uws_loop
            .expect("usockets_loop: uws_loop not initialized (call ensure_waker first)")
            .as_ptr()
    }

    /// [`usockets_loop`](Self::usockets_loop) as the platform-native loop
    /// (`us_loop_t*` on POSIX, its `uv_loop_t*` on Windows).
    #[inline]
    pub fn native_loop(&self) -> *mut crate::PlatformEventLoop {
        Async::uws_to_native(self.usockets_loop())
    }

    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(&self) -> *mut crate::PlatformEventLoop {
        self.native_loop()
    }

    #[inline]
    pub fn process_gc_timer(&mut self) {
        self.vm_ref().as_mut().gc_controller.process_gc_timer();
    }

    /// How many times one `tick()` refills the task queue from the concurrent
    /// queue before returning to let the loop poll. Other threads can post
    /// faster than this thread runs what they post; without a bound a steady
    /// producer (a worker flooding postMessage) keeps `tick()` from ever
    /// returning and timers / I/O never run. What is left is picked up by the
    /// next `tick()`, after a non-blocking poll (`has_pending_tasks`).
    const CONCURRENT_REFILLS_PER_TICK: u32 = 8;

    /// Work is queued that the next `tick()` will run: the poll before it must
    /// not block.
    pub fn has_pending_tasks(&self) -> bool {
        self.tasks.readable_length() > 0 || self.has_concurrent_tasks()
    }

    pub fn tick(&mut self) {
        jsc::mark_binding();
        crate::top_scope!(scope, self.global_ref());
        self.entered_event_loop_count += 1;
        // `Err(Stopped)`: a fold or checkpoint met the VM's termination; the turn is over.
        let _ = self.tick_turn(&mut scope);
        self.entered_event_loop_count -= 1;
    }

    fn tick_turn(&mut self, scope: &mut crate::TopExceptionScope) -> Result<(), Stopped> {
        let ctx = self.vm();
        self.tick_concurrent();
        self.process_gc_timer();

        // Note: reshaped for borrowck — `vm_ref()` is `&'static`, so the
        // global borrow detaches from `&self` and survives the `&mut self` call.
        let global = self.vm_ref().global();
        let global_vm = self.vm_ref().jsc_vm();

        let mut refills = 0u32;
        'tick: loop {
            loop {
                if self.tick_with_count(ctx)? == 0 {
                    break;
                }
                if refills == Self::CONCURRENT_REFILLS_PER_TICK {
                    break 'tick;
                }
                refills += 1;
                self.tick_concurrent();
                self.global_ref()
                    .handle_rejected_promises()
                    .map_err(|_| Stopped)?;
            }
            self.drain_microtasks_with_global(global, global_vm)?;
            if scope.has_exception() {
                // Every task's exception was folded above; one still pending here escaped whoever
                // produced it.
                debug_assert!(false, "a task returned Ok with a JS exception pending");
                return Ok(());
            }
            if refills == Self::CONCURRENT_REFILLS_PER_TICK {
                break;
            }
            refills += 1;
            self.tick_concurrent();
            if self.tasks.readable_length() > 0 {
                continue;
            }
            break;
        }

        while refills < Self::CONCURRENT_REFILLS_PER_TICK {
            if self.tick_with_count(ctx)? == 0 {
                break;
            }
            refills += 1;
            self.tick_concurrent();
        }

        self.global_ref()
            .handle_rejected_promises()
            .map_err(|_| Stopped)
    }

    /// Tick the task queue without draining microtasks afterward.
    pub fn tick_tasks_only(&mut self) {
        self.tick_concurrent();

        let vm = self.vm();
        // `Cell` swap through `&VirtualMachine` — no `&mut VM` formed (would
        // overlap `&mut self: EventLoop`, which is a value field of the VM).
        let prev = self.vm_ref().suppress_microtask_drain.replace(true);

        while let Ok(1..) = self.tick_with_count(vm) {
            self.tick_concurrent();
        }

        self.vm_ref().suppress_microtask_drain.set(prev);
        // Note: reshaped for borrowck — `defer vm.suppress_microtask_drain = prev` moved to tail
    }

    /// Teardown has released the queue (after forbidding script); tasks arriving now are released on
    /// arrival, never run.
    pub fn is_closed_for_tasks(&self) -> bool {
        self.closed_for_tasks
    }

    pub fn enqueue_task(&mut self, task: Task) {
        if self.closed_for_tasks {
            // Teardown already released the queue and this loop never ticks
            // again: release the task now, as `release_queued_tasks` would have
            // — the queue owns refusal, like `VmHandle::post` does off-thread.
            // SAFETY: JS thread, JSC heap alive (teardown phase B/C).
            unsafe { self.release_task_unrun(task) };
            return;
        }
        let _ = self.tasks.write_item(task);
    }

    /// Release one task that will never run, folding what its release left
    /// pending (a few releases run an addon callback that can enter JS).
    ///
    /// # Safety
    /// JS thread, JSC heap alive; `task` just left (or was refused by) the queue.
    #[cold]
    #[inline(never)]
    unsafe fn release_task_unrun(&mut self, task: Task) {
        // SAFETY: fn contract.
        unsafe { __bun_release_task_unrun(task) };
        if let Some(global) = self.global {
            // SAFETY: set at VM init; live for the loop's lifetime.
            let global = unsafe { global.as_ref() };
            if global.has_exception() {
                let _ = crate::task::report_error_or_terminate(global, crate::JsError::Thrown);
            }
        }
    }

    /// Move a batch other threads posted (`concurrent_tasks`) into
    /// `self.tasks`, freeing the heap `ConcurrentTask` carriers, so one pass
    /// over `self.tasks` releases everything. Called by `release_queued_tasks`
    /// in teardown, after `join_child_workers()` (every child has posted its
    /// close task by then) and before the JSC VM is destroyed (so captured
    /// `Ref<>`s in queued C++ lambdas drop against a live heap).
    fn take_concurrent_tasks(
        &mut self,
        batch: bun_threading::unbounded_queue::Batch<ConcurrentTaskItem>,
    ) {
        let mut iter = batch.iterator();
        loop {
            let node = iter.next();
            if node.is_null() {
                break;
            }
            // SAFETY: `node` is non-null and owned by the popped batch; the
            // iterator advanced past it before returning.
            let task =
                unsafe { ConcurrentTask::ConcurrentTask::into_task(NonNull::new_unchecked(node)) };
            let _ = self.tasks.write_item(task);
        }
    }

    /// Release, without running, every task still queued — what other
    /// threads posted and what this thread enqueued — through each type's
    /// `Taskable::release_unrun`, and refuse (release on arrival) anything
    /// enqueued from here on. Teardown phase B (JS thread, script forbidden,
    /// JSC heap alive, children joined): called on every turn of the wait, and
    /// once more after `Closed`.
    pub fn release_queued_tasks(&mut self) {
        self.closed_for_tasks = true;
        let batch = self.concurrent_tasks.pop_batch();
        self.take_concurrent_tasks(batch);
        let _ = self.promote_yield_tasks();
        while let Some(task) = self.tasks.read_item() {
            // SAFETY: JS thread, heap alive; `task` just left the queue.
            unsafe { self.release_task_unrun(task) };
        }
        // Pending immediates likewise: cancelling one drops its keep-alive on
        // this thread's loop, so it happens now, not after the loop is gone.
        self.release_pending_immediates();
    }

    /// Cancel (never run) every queued ImmediateObject; each cancel drops the
    /// immediate's keep-alive on this loop, so the loop must still exist.
    fn release_pending_immediates(&mut self) {
        let pending = core::mem::take(&mut self.immediate_tasks);
        let next = core::mem::take(&mut self.next_immediate_tasks);
        if !pending.is_empty() || !next.is_empty() {
            let vm = self.vm();
            for task in pending.into_iter().chain(next) {
                // SAFETY: `task` came from `enqueue_immediate_task`; `vm` is the live per-thread VM.
                unsafe { __bun_cancel_pending_immediate(task, vm) };
            }
        }
    }

    pub fn deinit(&mut self) {
        // Everything queued was released by `release_queued_tasks` (which
        // also made later enqueues release on arrival) and refused posts never
        // reach `concurrent_tasks`; nothing can be left to leak with the VM box.
        debug_assert!(
            self.tasks.readable_length() == 0 && self.concurrent_tasks.is_empty(),
            "queued tasks must be released (release_queued_tasks) before the loop is destroyed"
        );
        debug_assert!(
            self.immediate_tasks.is_empty() && self.next_immediate_tasks.is_empty(),
            "pending immediates must be released (release_queued_tasks) while the loop is alive"
        );
        self.tasks = Queue::init();
        // Free the deferred-task map's storage. The tasks must not be run, and an
        // entry owns nothing but a `Copy` ctx pointer whose owner released it when
        // the JSC teardown before this finalized it. A worker's VM box is
        // `dealloc`'d without running `Drop` (WebWorker::shutdown), so nothing
        // else frees it.
        self.deferred_tasks = DeferredTaskQueue::DeferredTaskQueue::default();
    }

    /// Note (§Dispatch): `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject` — see [`RunImmediateFn`].
    pub fn enqueue_immediate_task(&mut self, task: *mut ()) {
        self.immediate_tasks.push(task);
    }

    /// See [`EventLoop::yield_tasks`].
    pub fn enqueue_task_after_yield(&mut self, task: Task) {
        if self.closed_for_tasks {
            return self.enqueue_task(task);
        }
        self.yield_tasks.push(task);
    }

    /// `auto_tick`, before it polls: last iteration's yielded tasks become
    /// runnable. Returns whether there are any, so the poll does not block.
    pub fn promote_yield_tasks(&mut self) -> bool {
        if self.yield_tasks.is_empty() {
            return false;
        }
        for task in core::mem::take(&mut self.yield_tasks) {
            let _ = self.tasks.write_item(task);
        }
        true
    }

    /// `tickImmediateTasks` — swaps the two
    /// immediate queues, drains the now-current batch, then recycles the
    /// drained Vec as the next-tick buffer.
    ///
    /// Note: the real `ImmediateObject` lives in `bun_runtime` (cycle), so
    /// the per-task body dispatches through `__bun_run_immediate_task` (link-
    /// time, definer in `bun_runtime`). The swap always happens — this is
    /// load-bearing for `auto_tick`'s `has_pending_immediate` read, which must
    /// observe the post-swap `immediate_tasks` (next-tick immediates), not the
    /// un-drained current batch (busy-spin hazard).
    ///
    /// # Safety
    /// `virtual_machine` must be the live per-thread VM that owns this `EventLoop`.
    pub unsafe fn tick_immediate_tasks(&mut self, virtual_machine: *mut VirtualMachine) {
        // R-2 noalias mitigation (PORT_NOTES_PLAN R-2; precedent
        // `b818e70e1c57` NodeHTTPResponse::cork): `&mut self` is `noalias`, and
        // the only thing reaching the `__bun_run_immediate_task` extern call is
        // `virtual_machine` — a *separate* pointer parameter that LLVM is told
        // does NOT alias `*self` (even though `EventLoop` is a value field of
        // `*virtual_machine`). JS re-enters via `setImmediate` →
        // `enqueue_immediate_task` and pushes onto `self.next_immediate_tasks`.
        // Without the launder, LLVM may forward the post-`take` empty
        // `next_immediate_tasks` past the loop into the `.capacity() > 0`
        // recursion check and the trailing `= to_run_now` store, dropping any
        // immediates JS queued during this tick. ASM-verified PROVEN_CACHED.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the unique live `EventLoop`; each access below is a
        // short-lived `&mut` that does not overlap re-entry.
        let mut to_run_now = core::mem::take(unsafe { &mut (*this).immediate_tasks });
        // SAFETY: as above.
        unsafe { (*this).immediate_tasks = core::mem::take(&mut (*this).next_immediate_tasks) };

        let mut exception_thrown = false;
        for task in to_run_now.iter() {
            // SAFETY: ImmediateObject pointers are kept alive by the JS heap
            // until `__bun_run_immediate_task` consumes them; `virtual_machine` is the
            // live owning VM per caller contract.
            exception_thrown = unsafe { __bun_run_immediate_task(*task, virtual_machine) };
        }
        // Re-escape `this` after the re-entrant loop so nothing about `*this`
        // is carried across it.
        let this: *mut Self = core::hint::black_box(this);

        // make sure microtasks are drained if the last task had an exception
        if exception_thrown {
            // SAFETY: as above.
            let _ = unsafe { (*this).maybe_drain_microtasks() };
        }

        // SAFETY: as above; this read MUST observe pushes JS made during the
        // loop (the recursion check).
        if unsafe { (*this).next_immediate_tasks.capacity() } > 0 {
            // this would only occur if we were recursively running tickImmediateTasks.
            bun_core::hint::cold();
            // SAFETY: as above.
            let next = core::mem::take(unsafe { &mut (*this).next_immediate_tasks });
            // SAFETY: as above.
            unsafe { (*this).immediate_tasks.extend_from_slice(&next) };
        }

        if to_run_now.capacity() > 1024 * 128 {
            // once in a while, deinit the array to free up memory
            to_run_now = Vec::new();
        } else {
            to_run_now.clear();
        }

        // SAFETY: as above.
        unsafe { (*this).next_immediate_tasks = to_run_now };
    }

    pub fn ensure_waker(&mut self) {
        jsc::mark_binding();
        if self.uws_loop.is_none() {
            // The VM's embedded loops run on the thread's loop, the one
            // `vm.event_loop_handle` names below.
            debug_assert_eq!(Async::uws_to_native(uws::Loop::get()), Async::Loop::get());
            self.uws_loop = NonNull::new(uws::Loop::get());
        }
        if self.vm_ref().event_loop_handle.is_none() {
            let vm = self.vm();
            // SAFETY: `vm` is the live owning VM.
            unsafe { (*vm).event_loop_handle = Some(Async::Loop::get()) };
            // Route through raw addr_of to avoid stacked-borrow
            // aliasing of the embedded field with its parent.
            // SAFETY: `vm` is the live owning VM; gc_controller is embedded.
            unsafe {
                let gc: *mut GarbageCollectionController =
                    core::ptr::addr_of_mut!((*vm).gc_controller);
                (*gc).init(&mut *vm);
            }
        }
        // Note: `EventLoopHandle` lives in `bun_event_loop` (lower tier),
        // which cannot name `jsc::EventLoop`, so it stores `*mut ()`.
        // `EventLoopHandle` already exposes `into_tag_ptr()` — go straight to
        // the sys-level setter.
        // `self` is the live per-thread `jsc::EventLoop` (mut ref) — non-null.
        let self_ptr = core::ptr::from_mut(self).cast::<()>();
        let (tag, ptr) = EventLoopHandle::init(self_ptr).into_tag_ptr();
        // SAFETY: `uws::Loop::get()` returns the live process-global uws loop.
        unsafe {
            (*uws::Loop::get())
                .internal_loop_data
                .set_parent_raw(tag, ptr)
        };
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn perform_gc(&mut self) {
        self.vm_ref().as_mut().gc_controller.perform_gc(false);
    }

    /// `eventLoop().autoTick()` — bounces through `VirtualMachine::auto_tick`,
    /// which dispatches to the `bun_runtime` hook (needs `Timer::All` for the
    /// poll timeout). The body lives in `bun_runtime::jsc_hooks::auto_tick`.
    #[inline]
    pub fn auto_tick(&mut self) {
        self.vm_ref().as_mut().auto_tick();
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick) but
    /// only sleeps in the uSockets loop while it has active handles.
    /// Dispatches through
    /// `VirtualMachine::auto_tick_active` → `RuntimeHooks::auto_tick_active`
    /// (body lives in `bun_runtime::jsc_hooks` — needs `Timer::All`).
    #[inline]
    pub fn auto_tick_active(&mut self) {
        self.vm_ref().as_mut().auto_tick_active();
    }

    /// Ticks until `promise` settles. `Err` when it returns with the promise
    /// still pending because the VM can no longer run the script that would
    /// settle it (execution forbidden, or a stop was requested: a worker being
    /// terminated mid-wait), or because a termination is pending beneath this wait
    /// (a nested wait under a `node:vm` run whose deadline fired: it must unwind to
    /// that run, not tick on over it). Nothing is thrown for it; a caller inside a
    /// `JsResult` function crosses explicitly with [`jsc::Stopped::throw`] (which, with
    /// the termination already pending, is just `Thrown`).
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) -> Result<(), jsc::Stopped> {
        if promise.status() != PromiseStatus::Pending {
            return Ok(());
        }
        while promise.status() == PromiseStatus::Pending {
            if self.must_stand_down() {
                return Err(jsc::Stopped);
            }
            self.tick();
            if promise.status() == PromiseStatus::Pending {
                self.auto_tick();
            }
        }
        Ok(())
    }

    /// [`wait_for_promise`](Self::wait_for_promise) that also returns once nothing is left that could settle `promise`.
    pub fn wait_for_module_promise(
        &mut self,
        promise: *mut jsc::JSInternalPromise,
    ) -> Result<(), jsc::Stopped> {
        while jsc::JSPromise::status_ptr(promise) == PromiseStatus::Pending {
            if self.must_stand_down() {
                return Err(jsc::Stopped);
            }
            self.tick();
            if jsc::JSPromise::status_ptr(promise) != PromiseStatus::Pending
                || !self.vm_ref().has_pending_loop_work()
            {
                break;
            }
            // Ref'd only while parked, so the check above reads the real ref state.
            let _parked = self.ref_loop_scoped();
            self.auto_tick();
        }
        Ok(())
    }

    /// Ref the loop so `auto_tick` parks until the next event or timer instead of polling; unref'd work still wakes it.
    pub fn ref_loop_scoped(&self) -> LoopRefGuard {
        let Some(loop_) = self.uws_loop else {
            return LoopRefGuard(core::ptr::null_mut());
        };
        // SAFETY: the loop this `EventLoop` runs on outlives the VM; released by `LoopRefGuard::drop`.
        unsafe { (*loop_.as_ptr()).ref_() };
        LoopRefGuard(loop_.as_ptr())
    }

    /// The conditions under which a wait returns [`jsc::Stopped`]; see [`wait_for_promise`](Self::wait_for_promise).
    fn must_stand_down(&self) -> bool {
        let vm = self.vm_ref();
        vm.jsc_vm().execution_forbidden()
            || !vm.script_allowed()
            || self.global_ref().has_pending_termination_exception()
    }

    pub fn wakeup(&self) {
        if let Some(loop_) = self.uws_loop {
            // SAFETY: uws_loop is a valid live uws::Loop handle
            unsafe { (*loop_.as_ptr()).wakeup() };
        }
    }

    /// JS thread: the weak poster other threads use to reach the loop this
    /// `EventLoop` is — the VM's handle for its embedded loops, or the isolated
    /// loop's own poster for a spawnSync loop.
    pub fn js_poster(&self) -> bun_event_loop::JsPoster {
        match &self.isolated_poster {
            Some(p) => crate::vm_handle::IsolatedPosterInner::to_js_poster(p),
            None => self.vm_ref().js_poster(),
        }
    }

    /// JS thread: count one more thing keeping this loop alive (the same
    /// counter a `VmHandle::ref_keep_alive` from another thread adjusts).
    pub fn ref_keep_alive(&self) {
        let _ = self.concurrent_ref.fetch_add(1, Ordering::SeqCst);
        // Fold now: JS between the last tick and the poll (an immediate, a
        // promise reaction) must not leave the loop's active count stale.
        self.apply_concurrent_ref_delta();
    }

    /// JS thread: balance a [`Self::ref_keep_alive`].
    pub fn unref_keep_alive(&self) {
        let _ = self.concurrent_ref.fetch_sub(1, Ordering::SeqCst);
        self.apply_concurrent_ref_delta();
    }

    // ──────────── private helpers ────────────
    //
    // `vm()` returns a raw pointer, NOT `&mut VirtualMachine`. `EventLoop` is a
    // value field of `VirtualMachine`, so materializing `&mut VM` while a
    // `&EventLoop`/`&mut EventLoop` is live would alias (PORTING.md §Forbidden).
    // Callers must dereference per-field at use sites.
    #[inline(always)]
    fn vm(&self) -> *mut VirtualMachine {
        // SAFETY: see `vm_ref` below — set in `VirtualMachine::init()`, never None.
        unsafe { self.virtual_machine.unwrap_unchecked().as_ptr() }
    }
    /// Safe `&'static VirtualMachine` accessor for the owning VM. The VM is the
    /// per-thread singleton (see [`VirtualMachine::get`]); `EventLoop` is a
    /// value field of it, so the pointer is non-null and live for the VM
    /// lifetime. Prefer this over `unsafe { &*self.vm() }` for read-only field
    /// access; whole-struct mutation goes through [`VirtualMachine::as_mut`].
    ///
    /// node:http perf showed the `Option::unwrap` (vs a bare field
    /// load) was one of ~200 diffuse ~15-insn idiom-tax sites contributing the
    /// residual +3.3k insn/req. Force-inline so the unwrap collapses to one
    /// load+test; hot loops that straddle FFI calls hoist it to a local.
    #[inline(always)]
    fn vm_ref(&self) -> &'static VirtualMachine {
        // SAFETY: `virtual_machine` is set in `VirtualMachine::init()` to the
        // owning per-thread singleton; non-null and outlives `self`.
        unsafe { self.virtual_machine.unwrap_unchecked().as_ref() }
    }
    #[inline(always)]
    pub fn global_ref(&self) -> &'static JSGlobalObject {
        // `self.global` is always assigned `vm.global` at every write site
        // (`VirtualMachine::init`/`init_bake`, `enable_macro_mode`,
        // `swap_global_for_test_isolation`, `__bun_spawn_sync_*`, bake
        // `production.rs`), so
        // read it directly instead of the vm→global dependent-load chain.
        // `'static` so callers can hold it across `&mut self` (see
        // `drain_microtasks`), matching `vm_ref()`.
        // SAFETY: set alongside `virtual_machine` in `VirtualMachine::init()`
        // before any microtask runs; the JSGlobalObject is GC-rooted and
        // outlives the EventLoop.
        unsafe { self.global.unwrap_unchecked().as_ref() }
    }
}

impl EventLoop {
    /// # Safety
    /// `done` must point to a live `bool`; C++ writes `true` through it from a
    /// callback inside `tick()`, so it cannot be a Rust `&mut` (would alias).
    pub unsafe fn tick_while_paused(&mut self, done: *const bool) {
        // SAFETY: see fn contract — `done` is a live FFI bool written by C++.
        while !unsafe { done.read_volatile() } {
            // SAFETY: `native_loop()` is live for this loop's lifetime; JS thread.
            unsafe { (*self.native_loop()).tick() };
        }
    }

    /// Prefer `runCallbackWithResult` unless you really need to make sure that microtasks are drained.
    pub fn run_callback_with_result_and_forcefully_drain_microtasks(
        &mut self,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        // Same gate as `run_callback`.
        if global_object.has_exception() {
            return Ok(JSValue::UNDEFINED);
        }
        let result = callback.call(global_object, this_value, arguments)?;
        result.ensure_still_alive();
        let jsc_vm = global_object.bun_vm().jsc_vm();
        self.drain_microtasks_with_global(global_object, jsc_vm)
            .map_err(|stopped| stopped.throw(global_object))?;
        Ok(result)
    }

    /// Keep one poll registered with the loop so `us_loop_run_bun_tick` parks
    /// instead of returning immediately on `num_polls == 0`.
    #[cfg(not(windows))]
    fn hold_forever_poll(&mut self, loop_: &mut uws::Loop) {
        if !self.holds_forever_poll {
            loop_.inc();
            self.holds_forever_poll = true;
        }
    }

    #[cfg(windows)]
    fn hold_forever_poll(&mut self, loop_: &mut uws::Loop) {
        if self.forever_timer.is_none() {
            let mut t = uws::Timer::create(
                loop_,
                std::ptr::from_mut::<EventLoop>(self).cast::<core::ffi::c_void>(),
            );
            // SAFETY: t is a fresh non-null timer handle
            unsafe {
                t.as_mut().set(
                    std::ptr::from_mut::<EventLoop>(self).cast::<core::ffi::c_void>(),
                    Some(noop_forever_timer),
                    1000 * 60 * 4,
                    1000 * 60 * 4,
                )
            };
            self.forever_timer = Some(t);
        }
    }

    pub fn tick_possibly_forever(&mut self) {
        let loop_ptr = self.usockets_loop();

        #[cfg(unix)]
        {
            let pending_unref = self.vm_ref().take_pending_unref();
            if pending_unref > 0 {
                // SAFETY: usockets_loop() returns a live uws loop for the VM
                // lifetime; borrow scoped to this call.
                unsafe { (*loop_ptr).unref_count(pending_unref) };
            }
        }

        // SAFETY: as above.
        if !unsafe { (*loop_ptr).is_active() } {
            // SAFETY: as above; `hold_forever_poll` does not re-enter the loop.
            self.hold_forever_poll(unsafe { &mut *loop_ptr });
        }

        self.process_gc_timer();
        // `tick()` below can start work (e.g. a --hot reload) whose only wake
        // source is a cross-thread `wakeup()`; bound the park, same as the GC
        // timerfd used to. libuv's `tick_with_timeout` ignores the argument.
        // SAFETY: as above — the tick runs loop callbacks that reach the loop
        // themselves, so the exclusive borrow is scoped to this call only.
        unsafe {
            (*loop_ptr).tick_with_timeout(
                Some(&bun_core::Timespec { sec: 1, nsec: 0 }),
                uws::NOW_NS_UNKNOWN,
            )
        };

        self.vm_ref().as_mut().on_after_event_loop();
        self.tick_concurrent();
        self.tick();
    }

    /// Drive the loop while a worker's entry module graph is fetched and
    /// linked, until its evaluation has begun (`entry_evaluation_started`, set
    /// by the moduleLoaderEvaluate hook once the linked graph starts executing),
    /// the promise settled, or termination was requested. Parks in `auto_tick`
    /// while imports are still being read/transpiled off-thread; does not wait
    /// for a top-level await.
    pub fn wait_for_worker_entry_evaluation(&mut self, promise: jsc::AnyPromise) {
        loop {
            let vm = self.vm_ref();
            let terminated = vm.worker_ref().is_some_and(|w| w.has_requested_terminate());
            if terminated
                || vm.entry_evaluation_started
                || promise.status() != PromiseStatus::Pending
            {
                break;
            }
            self.tick();
            let vm = self.vm_ref();
            let terminated = vm.worker_ref().is_some_and(|w| w.has_requested_terminate());
            if terminated
                || vm.entry_evaluation_started
                || promise.status() != PromiseStatus::Pending
            {
                break;
            }
            if !vm.is_event_loop_alive() {
                // Nothing in flight can settle the load; let spin() decide.
                break;
            }
            self.auto_tick();
        }
    }
}

/// Testing API to expose event loop state
#[bun_jsc::host_fn]
pub fn get_active_tasks(global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // fields and call &-methods on it for the duration of this host fn.
    let vm_ref = global_object.bun_vm();
    let event_loop = vm_ref.event_loop_shared();
    let result = JSValue::create_empty_object(global_object, 9);
    result.put(
        global_object,
        b"activeTasks",
        JSValue::js_number(vm_ref.active_tasks as f64),
    );
    result.put(
        global_object,
        b"tasks",
        JSValue::js_number(event_loop.tasks.readable_length() as f64),
    );
    result.put(
        global_object,
        b"immediateTasks",
        JSValue::js_number(
            (event_loop.immediate_tasks.len() + event_loop.next_immediate_tasks.len()) as f64,
        ),
    );
    result.put(
        global_object,
        b"concurrentTasksEmpty",
        JSValue::from(event_loop.concurrent_tasks.is_empty()),
    );
    result.put(
        global_object,
        b"loopActive",
        JSValue::from(vm_ref.platform_loop_opt().is_some_and(|h| h.is_active())),
    );
    result.put(
        global_object,
        b"eventLoopAlive",
        JSValue::from(vm_ref.is_event_loop_alive()),
    );
    result.put(
        global_object,
        b"concurrentRef",
        JSValue::js_number(event_loop.concurrent_ref.load(Ordering::SeqCst) as f64),
    );
    #[cfg(windows)]
    // SAFETY: `Loop::get()` returns the live process-global `uv_loop_t`.
    let num_polls: i32 =
        i32::try_from(unsafe { (*bun_sys::windows::libuv::Loop::get()).active_handles })
            .expect("int cast");
    #[cfg(not(windows))]
    // SAFETY: uws::Loop::get() returns a live process-global loop.
    let num_polls: i32 = unsafe { (*uws::Loop::get()).num_polls };
    result.put(
        global_object,
        b"numPolls",
        JSValue::js_number(num_polls as f64),
    );
    result.put(
        global_object,
        b"iteration",
        // SAFETY: usockets_loop() returns the live process-global loop.
        JSValue::js_number(unsafe { (*event_loop.usockets_loop()).iteration_number() } as f64),
    );
    Ok(result)
}

#[cfg(windows)]
extern "C" fn noop_forever_timer(_: *mut uws::Timer) {
    // do nothing
}

// HOST_EXPORT(Bun__EventLoop__runCallback2, c)
pub fn event_loop_run_callback2(
    global: &JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
    arg1: JSValue,
) {
    global
        .bun_vm()
        .event_loop_mut()
        .run_callback(callback, global, this_value, &[arg0, arg1]);
}

// HOST_EXPORT(Bun__EventLoop__enter, c)
pub fn event_loop_enter(global: &JSGlobalObject) {
    global.bun_vm().event_loop_mut().enter();
}

// HOST_EXPORT(Bun__EventLoop__exit, c)
pub fn event_loop_exit(global: &JSGlobalObject) {
    global.bun_vm().event_loop_mut().exit();
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_event_loop::any_event_loop::js` extern impls
//
// `AnyEventLoop` / `EventLoopHandle` live in the lower-tier `bun_event_loop`
// crate and cannot name `jsc::EventLoop`.
// Rather than a runtime-registered vtable, the low tier declares
// these as `extern "Rust"` and the bodies live here, resolved at link time —
// hardcoded, single consumer. Each slot casts the erased `*mut ()` owner back
// to `*mut EventLoop` and forwards to the real method.
// ──────────────────────────────────────────────────────────────────────────

/// SAFETY: vtable contract — `owner` was erased from a live `*mut EventLoop`.
#[inline(always)]
fn el_ref<'a>(owner: *mut ()) -> &'a mut EventLoop {
    // SAFETY: vtable contract — `owner` was erased from a live `*mut EventLoop`.
    unsafe { &mut *owner.cast::<EventLoop>() }
}

// `this: *mut EventLoop` — owner was erased from a live `*mut EventLoop` in
// `__bun_js_event_loop_current` / `EventLoopHandle::js`. All calls run on the
// JS thread.
bun_event_loop::link_impl_JsEventLoop! {
    Jsc for EventLoop => |this| {
        iteration_number() => (&*(*this).usockets_loop()).iteration_number(),
        // Return raw to avoid asserting uniqueness — multiple handles may name the
        // same VM.
        file_polls() => core::ptr::from_mut(
            (*this)
                .vm_ref()
                .as_mut()
                .rare_data()
                .file_polls
                .get_or_insert_with(|| Box::new(Async::file_poll::Store::init()))
                .as_mut(),
        ),
        put_file_poll(poll, was_ever_registered) => {
            // `Store::put` only needs the VM as an opaque `EventLoopCtx`; reach it
            // via the JS-ctx hook so we don't form a competing `&mut VirtualMachine`
            // while holding the store.
            let store = core::ptr::from_mut(
                (*this)
                    .vm_ref()
                    .as_mut()
                    .rare_data()
                    .file_polls
                    .get_or_insert_with(|| Box::new(Async::file_poll::Store::init()))
                    .as_mut(),
            );
            let ctx = Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js);
            // `poll` is a live hive-slot pointer (vtable contract) — non-null.
            (*store).put(core::ptr::NonNull::new_unchecked(poll), ctx, was_ever_registered);
        },
        uws_loop() => (*this).usockets_loop(),
        tick() => (*this).tick(),
        auto_tick() => (*this).auto_tick(),
        auto_tick_active() => (*this).auto_tick_active(),
        global_object() => (*this).global.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast()),
        bun_vm() => (*this).virtual_machine.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast()),
        stdout() => (*this).vm_ref().as_mut().rare_data().stdout().cast(),
        stderr() => (*this).vm_ref().as_mut().rare_data().stderr().cast(),
        enter() => (*this).enter(),
        exit() => (*this).exit(),
        enqueue_task(task) => (*this).enqueue_task(task),
        enqueue_task_after_yield(task) => (*this).enqueue_task_after_yield(task),
        js_poster() => (*this).js_poster(),
        env() => (*this).vm_ref().transpiler.env,
        top_level_dir() => core::ptr::from_ref::<[u8]>((*this).vm_ref().top_level_dir()),
        create_null_delimited_env_map() =>
            (*(*this).vm_ref().transpiler.env).map.create_null_delimited_env_map(),
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_js_event_loop_current() -> *mut () {
    // SAFETY: `VirtualMachine::get()` panics if no VM on this thread;
    // `event_loop()` returns the live `*mut EventLoop` self-pointer.
    VirtualMachine::get().as_mut().event_loop().cast()
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_event_loop::SpawnSyncEventLoop` extern impls
//
// `SpawnSyncEventLoop` lives in the lower-tier `bun_event_loop` crate and
// cannot name `jsc::EventLoop` / `jsc::VirtualMachine`. The bodies live here as
// `#[no_mangle]` Rust-ABI fns, declared `extern "Rust"` on the low-tier side
// and resolved at link time. Each erased `*mut ()` is a `*mut VirtualMachine`
// or `*mut EventLoop`; cast back and forward to the real method/field.
// ──────────────────────────────────────────────────────────────────────────

/// Recover `&mut VirtualMachine` from the erased SpawnSync vtable `vm`.
/// Private — every caller is a `#[no_mangle]` trampoline whose contract
/// guarantees `vm` is the live per-thread `*mut VirtualMachine`.
#[inline(always)]
fn vm_from_ptr<'a>(vm: *mut ()) -> &'a mut VirtualMachine {
    // SAFETY: SpawnSync vtable contract — `vm` is the live per-thread VM.
    unsafe { &mut *vm.cast::<VirtualMachine>() }
}

/// Heap-allocate a fresh `EventLoop` bound to `vm`, running on `uws_loop`.
#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_create_event_loop(vm: *mut (), uws_loop: *mut uws::Loop) -> *mut () {
    let vm = vm_from_ptr(vm);
    let mut el = Box::new(EventLoop::default());
    el.global = NonNull::new(vm.global);
    el.virtual_machine = NonNull::new(std::ptr::from_mut(vm));
    el.uws_loop = NonNull::new(uws_loop);
    let el = bun_core::heap::into_raw(el);
    // SAFETY: `el` is the stable heap address the poster targets until destroy.
    unsafe { (*el).isolated_poster = Some(crate::vm_handle::IsolatedPosterInner::new(el)) };
    el.cast()
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_destroy_event_loop(el: *mut ()) {
    let el = el.cast::<EventLoop>();
    // Refuse (and wait out) posts from other threads before the loop goes.
    // SAFETY: `el` is the live isolated loop; JS thread.
    if let Some(p) = unsafe { (*el).isolated_poster.as_ref() } {
        p.close();
    }
    // SAFETY: paired with `heap::alloc` in `__bun_spawn_sync_create_event_loop`.
    drop(unsafe { bun_core::heap::take(el) });
}

/// Re-bind `event_loop.{global, virtual_machine}` to `vm` (prepare path).
#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_event_loop_set_vm(el: *mut (), vm: *mut ()) {
    let el = el_ref(el);
    let vm = vm_from_ptr(vm);
    el.global = NonNull::new(vm.global);
    el.virtual_machine = NonNull::new(std::ptr::from_mut(vm));
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_event_loop_tick_tasks_only(el: *mut ()) {
    el_ref(el).tick_tasks_only();
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_vm_get_event_loop_handle(
    vm: *mut (),
) -> bun_event_loop::SpawnSyncEventLoop::VmEventLoopHandle {
    vm_from_ptr(vm).event_loop_handle.and_then(NonNull::new)
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_vm_set_event_loop_handle(
    vm: *mut (),
    h: bun_event_loop::SpawnSyncEventLoop::VmEventLoopHandle,
) {
    vm_from_ptr(vm).event_loop_handle = h.map(NonNull::as_ptr);
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm: *mut (), v: bool) -> bool {
    vm_from_ptr(vm).suppress_microtask_drain.replace(v)
}
