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

use core::cell::{Cell, OnceCell};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicPtr, AtomicU64, Ordering};

use bun_io as Async;
use bun_uws as uws;

use crate::js_promise::Status as PromiseStatus;
use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, JSGlobalObject, JSValue, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin re-exports of sibling/neighbor modules — do NOT inline
// bodies). Kept so downstream `bun_jsc::event_loop::Foo` paths resolve.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::AnyTaskWithExtraContext;
pub use bun_event_loop::ConcurrentTask::{
    self, ConcurrentTask as ConcurrentTaskItem, Queue as ConcurrentQueue,
};
pub use bun_event_loop::DeferredTaskQueue::{self, DeferredRepeatingTask};
pub use bun_event_loop::MiniEventLoop;
pub use bun_event_loop::Task;
pub use bun_event_loop::any_event_loop::{AnyEventLoop, EventLoopHandle, EventLoopTask};
pub use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

pub use crate::cpp_task::{ConcurrentCppTask, CppTask};
pub use crate::garbage_collection_controller::GarbageCollectionController;
pub use crate::jsc_scheduler as JSCScheduler;
#[cfg(unix)]
pub use crate::posix_signal_handle::PosixSignalHandle;
pub use crate::posix_signal_handle::PosixSignalTask;

bun_core::declare_scope!(EventLoop, hidden);

pub type Queue = bun_collections::FifoCell<Task>;

/// The part of an [`EventLoop`] that other threads and a signal handler reach. They borrow this and
/// never the `EventLoop`, whose other fields belong to the JS thread.
#[derive(Default)]
pub struct Shared {
    pub concurrent_tasks: ConcurrentQueue,
    pub concurrent_ref: AtomicI32,
    /// The uws loop this `EventLoop` runs on: the thread's loop for the VM's
    /// embedded loops, a private one for a spawnSync loop. It outlives the
    /// `EventLoop`. Set by `ensure_waker` / `new_isolated`.
    uws_loop: AtomicPtr<uws::Loop>,
    /// How many times `tasks` was drained. One uws loop iteration drains it several times, so a
    /// `fetch` can start and finish within one iteration. A Worker may read it.
    task_drains: AtomicU64,
    /// Atomic nullable pointer to the next-due `WTFTimer`.
    ///
    /// Note (§Dispatch): payload is `*mut ()` — the real
    /// `bun_runtime::timer::WTFTimer` lives in the higher-tier crate (cycle).
    /// Low tier stores the erased pointer; the high-tier hook installed via
    /// (link-time `__bun_run_wtf_timer`) casts it back.
    pub imminent_gc_timer: AtomicPtr<()>,
    /// The `PosixSignalHandle` ring buffer `Bun__ensureSignalHandler` leaks once.
    #[cfg(unix)]
    signal_handler: AtomicPtr<PosixSignalHandle>,
}

impl Shared {
    /// Any thread, and async-signal-safe.
    pub fn wakeup(&self) {
        let loop_ = self.uws_loop.load(Ordering::Relaxed);
        if !loop_.is_null() {
            // SAFETY: the loop outlives the `EventLoop` (see the field).
            unsafe { uws::us_wakeup_loop(loop_) };
        }
    }

    #[cfg(unix)]
    pub(crate) fn signal_handler(&self) -> Option<&'static PosixSignalHandle> {
        // SAFETY: null, or what `install_signal_handler` leaked.
        unsafe { self.signal_handler.load(Ordering::Acquire).as_ref() }
    }

    #[cfg(unix)]
    pub(crate) fn install_signal_handler(&self, handler: &'static PosixSignalHandle) {
        self.signal_handler
            .store(core::ptr::from_ref(handler).cast_mut(), Ordering::Release);
    }
}

/// Every method takes `&self`: a callback this loop runs can enter JavaScript, which reaches the
/// same loop again through the VM.
///
/// Only this crate makes one, and binds it to its VM and a global before anything else uses it.
pub struct EventLoop {
    pub tasks: Queue,
    /// Set when teardown releases the queue: from then on `enqueue_task`
    /// releases instead of parking (nothing will tick this loop again).
    closed_for_tasks: Cell<bool>,

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
    pub immediate_tasks: bun_collections::VecCell<*mut ()>,
    pub next_immediate_tasks: bun_collections::VecCell<*mut ()>,
    /// Tasks that asked to run on the *next* loop iteration — after I/O and
    /// timers have had a turn — rather than in the current drain, which runs
    /// until the queue is empty (a task that re-posts itself there never lets
    /// the loop poll). Promoted into `tasks` by `auto_tick`, like immediates.
    pub yield_tasks: bun_collections::VecCell<Task>,

    pub shared: Shared,
    /// Set only on Bun.spawnSync's isolated loop: how other threads reach *this*
    /// loop's queue (the VM's handle names only the VM's own two loops).
    isolated_poster: OnceCell<std::sync::Arc<crate::vm_handle::IsolatedPosterInner>>,
    /// This thread's VM: the one that embeds this loop, or owns it (spawnSync's).
    vm: Cell<*const VirtualMachine>,
    /// The VM's current global.
    global: Cell<Option<&'static JSGlobalObject>>,
    // see `hold_forever_poll`
    #[cfg(windows)]
    pub forever_timer: Cell<Option<NonNull<uws::Timer>>>,
    #[cfg(not(windows))]
    holds_forever_poll: Cell<bool>,
    pub deferred_tasks: DeferredTaskQueue::DeferredTaskQueue,

    entered_event_loop_count: Cell<isize>,
    /// Posters, the uws loop's parent pointer and `EventLoopHandle`s hold this address.
    _pinned: core::marker::PhantomPinned,
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
    safe fn __bun_tick_queue_with_count(
        el: &EventLoop,
        vm: &VirtualMachine,
        counter: &mut u32,
    ) -> Result<(), Stopped>;
    /// `ImmediateObject::runImmediateTask` — `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject`; returns whether the callback
    /// threw. Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_immediate_task(task: *mut (), vm: &VirtualMachine) -> bool;
    /// Release the event loop's `+1` ref on a still-queued `ImmediateObject`
    /// without running it. Defined in `bun_runtime::dispatch`.
    fn __bun_cancel_pending_immediate(task: *mut (), vm: &VirtualMachine);
    /// `WTFTimer::run` — `timer` is an erased `*mut bun_runtime::timer::WTFTimer`.
    /// Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_wtf_timer(timer: *mut (), vm: &VirtualMachine);
    /// Free a queued task that will never run, through its type's
    /// `Taskable::release_unrun` (one arm per tag in `bun_runtime::dispatch`).
    /// JS thread, JSC heap alive. Link-time resolved.
    fn __bun_release_task_unrun(task: bun_event_loop::Task);
}

/// RAII pairing for [`EventLoop::enter`] / [`EventLoop::exit`]. Construct via
/// [`EventLoop::enter_scope`].
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EventLoopEnterGuard<'a> {
    loop_: &'a EventLoop,
}

impl Drop for EventLoopEnterGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.loop_.exit();
    }
}

/// RAII pairing for [`EventLoop::enter`] / [`EventLoop::exit_without_checkpoint`].
/// Construct via [`EventLoop::enter_scope_without_checkpoint`].
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EventLoopEnterNoCheckpointGuard<'a> {
    loop_: &'a EventLoop,
}

impl Drop for EventLoopEnterNoCheckpointGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.loop_.exit_without_checkpoint();
    }
}

/// What [`EventLoop::enter_js`] found.
enum EnterJs<'a> {
    /// The callback may be called, inside this scope (none for [`ContextId::NONE`](crate::ContextId::NONE)).
    Entered(Option<crate::virtual_machine::ContextScope<'a>>),
    /// The callback must not be called now.
    CannotEnter,
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
    pub fn enter(&self) {
        let count = self.entered_event_loop_count.get();
        bun_core::scoped_log!(EventLoop, "enter() = {}", count);
        self.entered_event_loop_count.set(count + 1);
    }

    /// "exit" a microtask context in the event loop. See `enter`.
    ///
    /// The outermost exit is a microtask checkpoint — unless the frame is
    /// leaving with an exception pending (`drainMicrotasks` sees it and does
    /// nothing): that exception is on its way to a fold, which takes it and
    /// then drains.
    pub fn exit(&self) {
        let count = self.entered_event_loop_count.get();
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        if count == 1 && !self.vm_ref().is_inside_deferred_task_queue.get() {
            let _ = self.drain_microtasks();
        }

        self.entered_event_loop_count
            .set(self.entered_event_loop_count.get() - 1);
    }

    /// `enter()` now, `exit()` on drop.
    #[inline]
    pub fn enter_scope(&self) -> EventLoopEnterGuard<'_> {
        self.enter();
        EventLoopEnterGuard { loop_: self }
    }

    /// Balance an [`enter`](Self::enter) without the checkpoint [`exit`](Self::exit)
    /// runs at the outermost level. See [`Self::enter_scope_without_checkpoint`].
    #[inline]
    pub fn exit_without_checkpoint(&self) {
        let count = self.entered_event_loop_count.get() - 1;
        bun_core::scoped_log!(EventLoop, "exit_without_checkpoint() = {}", count);
        self.entered_event_loop_count.set(count);
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
    #[inline]
    pub fn enter_scope_without_checkpoint(&self) -> EventLoopEnterNoCheckpointGuard<'_> {
        self.enter();
        EventLoopEnterNoCheckpointGuard { loop_: self }
    }

    pub fn exit_maybe_drain_microtasks(&self, allow_drain_microtask: bool) -> Result<(), Stopped> {
        let count = self.entered_event_loop_count.get();
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
            self.entered_event_loop_count
                .set(self.entered_event_loop_count.get() - 1);
        }
        result
    }

    pub fn drain_microtasks_with_global(
        &self,
        global_object: &JSGlobalObject,
        jsc_vm: &jsc::VM,
    ) -> Result<(), Stopped> {
        // Once: LLVM can't CSE the load across the FFI calls below.
        let vm = self.vm_ref();

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

        vm.is_inside_deferred_task_queue.set(true);
        self.deferred_tasks.run();
        vm.is_inside_deferred_task_queue.set(false);

        // Guard on `event_loop_handle` being set, but drain via `uws_loop()`:
        // on Windows the uSockets loop (`uws::Loop::get()`) is NOT
        // `event_loop_handle` (which is the libuv loop).
        if vm.event_loop_handle.get().is_some() {
            vm.uws_loop().drain_quic_if_necessary();
        }

        Ok(())
    }

    #[inline(always)]
    pub fn drain_microtasks(&self) -> Result<(), Stopped> {
        // Read `this.global` directly via `global_ref()` instead of
        // round-tripping through `virtual_machine` (saves a dependent load on
        // the hot path).
        let global = self.global_ref();
        let jsc_vm = self.vm_ref().jsc_vm();
        self.drain_microtasks_with_global(global, jsc_vm)
    }

    // should be called after exit()
    pub fn maybe_drain_microtasks(&self) -> Result<(), Stopped> {
        if self.entered_event_loop_count.get() == 0
            && !self.vm_ref().is_inside_deferred_task_queue.get()
        {
            return self.drain_microtasks();
        }
        Ok(())
    }

    /// `run_callback*`'s way in: whether a callback may be called at all, and if so the scope it
    /// is called inside of. Not with an exception pending. `context` is entered for
    /// the call; [`ContextId::NONE`](crate::ContextId::NONE) enters nothing.
    #[inline]
    fn enter_js<'a>(context: crate::ContextId, global_object: &'a JSGlobalObject) -> EnterJs<'a> {
        if global_object.has_exception() {
            return EnterJs::CannotEnter;
        }
        EnterJs::Entered(
            (context != crate::ContextId::NONE)
                .then(|| global_object.bun_vm().enter_context(context)),
        )
    }

    /// When you call a JavaScript function from outside the event loop task
    /// queue, it has to be wrapped in `runCallback` to ensure that microtasks
    /// are drained and errors are handled.
    ///
    /// `context`: whose script `callback` continues, as a task says it. The call is made inside
    /// that context (a stopped one is called for nobody: `JSValue::call`). [`ContextId::NONE`](crate::ContextId::NONE): no context of
    /// the caller's to enter (nothing owns the callback, or it carries its own: one stored with
    /// `with_async_context_if_needed`).
    pub fn run_callback(
        &self,
        context: crate::ContextId,
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
        let EnterJs::Entered(_context) = Self::enter_js(context, global_object) else {
            return;
        };
        let _entered = self.enter_scope();
        if let Err(err) = callback.call(global_object, this_value, arguments) {
            // A top-level call: reported (or, for the VM's termination, taken) here; the caller reads
            // the gate, not a pending exception, to know the VM has stopped.
            let _ = crate::task::report_error_or_terminate(global_object, err);
        }
    }

    /// `context`: as for [`run_callback`](Self::run_callback).
    pub fn run_callback_with_result(
        &self,
        context: crate::ContextId,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> JSValue {
        let EnterJs::Entered(_context) = Self::enter_js(context, global_object) else {
            return JSValue::ZERO;
        };
        let _entered = self.enter_scope();
        match callback.call(global_object, this_value, arguments) {
            Ok(v) => v,
            Err(err) => {
                let _ = crate::task::report_error_or_terminate(global_object, err);
                JSValue::ZERO
            }
        }
    }

    /// `None`: a task's fold or the checkpoint after it met the VM's termination and landed it; the
    /// turn is over (`tick()` / `tick_tasks_only()` return rather than run more against that VM).
    fn tick_with_count(&self, virtual_machine: &VirtualMachine) -> Result<u32, Stopped> {
        let mut counter: u32 = 0;
        // Only this thread writes `task_drains`, so a plain load and store is enough.
        let drains = self.shared.task_drains.load(Ordering::Relaxed);
        self.shared.task_drains.store(drains + 1, Ordering::Relaxed);
        __bun_tick_queue_with_count(self, virtual_machine, &mut counter)?;
        Ok(counter)
    }

    fn tick_concurrent(&self) {
        let _ = self.tick_concurrent_with_count();
    }

    /// Whether a keep-alive delta (`ref_keep_alive`, here or through a
    /// `VmHandle`) has been queued but not yet applied to the loop's `active` count.
    pub fn has_pending_refs(&self) -> bool {
        self.shared.concurrent_ref.load(Ordering::SeqCst) > 0
            || self
                .macro_loop_if_not_running()
                .is_some_and(|m| m.shared.concurrent_ref.load(Ordering::SeqCst) > 0)
    }

    /// Other threads have posted work that this loop's next drain will pick up.
    pub(crate) fn has_concurrent_tasks(&self) -> bool {
        !self.shared.concurrent_tasks.is_empty()
            || self
                .macro_loop_if_not_running()
                .is_some_and(|m| !m.shared.concurrent_tasks.is_empty())
    }

    pub fn run_imminent_gc_timer(&self) {
        // The real `WTFTimer` lives in `bun_runtime` (cycle), so the body
        // dispatches through `__bun_run_wtf_timer` (link-time extern).
        let ptr = self
            .shared
            .imminent_gc_timer
            .swap(core::ptr::null_mut(), Ordering::SeqCst);
        if !ptr.is_null() {
            // SAFETY: `ptr` was published by `WTFTimer::update` and remains
            // valid until `run` removes it.
            unsafe { __bun_run_wtf_timer(ptr, self.vm_ref()) };
        }
    }

    pub fn tick_concurrent_with_count(&self) -> usize {
        self.apply_concurrent_ref_delta();

        #[cfg(unix)]
        if let Some(signal_handler) = self.shared.signal_handler() {
            signal_handler.drain(self);
        }

        self.run_imminent_gc_timer();

        let start_count = self.tasks.readable_length();
        if let Some(macro_loop) = self.macro_loop_if_not_running() {
            macro_loop.apply_concurrent_ref_delta();
            let batch = macro_loop.shared.concurrent_tasks.pop_batch();
            self.take_concurrent_tasks(batch);
        }

        let concurrent = self.shared.concurrent_tasks.pop_batch();
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
        let vm = self.vm_ref();
        (vm.has_enabled_macro_mode.get()
            && !vm.macro_mode()
            && core::ptr::eq(self, &raw const vm.regular_event_loop))
        .then_some(&vm.macro_event_loop)
    }

    /// Fold refs/unrefs queued through `ref_keep_alive`/`unref_keep_alive`
    /// (here, or from another thread through `VmHandle`) into this loop's
    /// keep-alive count. Runs at the top of every tick, and once more from a
    /// worker's shutdown after its stop phase (which unrefs
    /// ports/channels/sockets on a loop that no longer ticks) so the loop is not
    /// torn down still believing something keeps it alive.
    ///
    /// Targets `self.native_loop()`, never `vm.event_loop_handle`: on Windows
    /// `Bun.spawnSync` points the latter at its private loop, and a GC inside it
    /// still refs this loop (FinalizationRegistry, MessagePort).
    pub(crate) fn apply_concurrent_ref_delta(&self) {
        let delta = self.shared.concurrent_ref.swap(0, Ordering::SeqCst);
        let loop_ = self.native_loop();
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
            loop_.num_polls.set(loop_.num_polls.get() + delta);
            let active = loop_.active.get();
            loop_.active.set(if delta > 0 {
                active.saturating_add(u32::try_from(delta).expect("int cast"))
            } else {
                active.saturating_sub(u32::try_from(-delta).expect("int cast"))
            });
        }
    }

    /// The uws loop this `EventLoop` runs on.
    pub fn usockets_loop(&self) -> &uws::Loop {
        // SAFETY: null, or a loop that outlives `self` (see the field); JS thread.
        unsafe { self.shared.uws_loop.load(Ordering::Relaxed).as_ref() }
            .expect("usockets_loop: uws_loop not initialized (call ensure_waker first)")
    }

    /// [`usockets_loop`](Self::usockets_loop) as the platform-native loop
    /// (`us_loop_t*` on POSIX, its `uv_loop_t*` on Windows).
    #[inline]
    pub fn native_loop(&self) -> &crate::PlatformEventLoop {
        Async::uws_to_native(self.usockets_loop())
    }

    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(&self) -> &crate::PlatformEventLoop {
        self.native_loop()
    }

    #[inline]
    pub fn process_gc_timer(&self) {
        self.vm_ref().gc_controller.process_gc_timer();
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

    pub fn tick(&self) {
        jsc::mark_binding();
        crate::top_scope!(scope, self.global_ref());
        let _entered = self.enter_scope_without_checkpoint();
        // `Err(Stopped)`: a fold or checkpoint met the VM's termination; the turn is over.
        let _ = self.tick_turn(&mut scope);
    }

    fn tick_turn(&self, scope: &mut crate::TopExceptionScope) -> Result<(), Stopped> {
        let ctx = self.vm_ref();
        self.tick_concurrent();
        self.process_gc_timer();

        let global = ctx.global();
        let global_vm = ctx.jsc_vm();

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
    pub fn tick_tasks_only(&self) {
        self.tick_concurrent();

        let vm = self.vm_ref();
        let prev = vm.suppress_microtask_drain.replace(true);

        while let Ok(1..) = self.tick_with_count(vm) {
            self.tick_concurrent();
        }

        vm.suppress_microtask_drain.set(prev);
    }

    /// Teardown has released the queue (after forbidding script); tasks arriving now are released on
    /// arrival, never run.
    pub fn is_closed_for_tasks(&self) -> bool {
        self.closed_for_tasks.get()
    }

    pub fn enqueue_task(&self, task: Task) {
        if self.closed_for_tasks.get() {
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
    unsafe fn release_task_unrun(&self, task: Task) {
        // SAFETY: fn contract.
        unsafe { __bun_release_task_unrun(task) };
        if let Some(global) = self.global.get() {
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
        &self,
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
    pub fn release_queued_tasks(&self) {
        self.closed_for_tasks.set(true);
        let batch = self.shared.concurrent_tasks.pop_batch();
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
    fn release_pending_immediates(&self) {
        let pending = self.immediate_tasks.take();
        let next = self.next_immediate_tasks.take();
        if !pending.is_empty() || !next.is_empty() {
            let vm = self.vm_ref();
            for task in pending.into_iter().chain(next) {
                // SAFETY: `task` came from `enqueue_immediate_task`.
                unsafe { __bun_cancel_pending_immediate(task, vm) };
            }
        }
    }

    pub fn deinit(&self) {
        // Everything queued was released by `release_queued_tasks` (which
        // also made later enqueues release on arrival) and refused posts never
        // reach `concurrent_tasks`; nothing can be left to leak with the VM box.
        debug_assert!(
            self.tasks.readable_length() == 0 && self.shared.concurrent_tasks.is_empty(),
            "queued tasks must be released (release_queued_tasks) before the loop is destroyed"
        );
        debug_assert!(
            self.immediate_tasks.is_empty() && self.next_immediate_tasks.is_empty(),
            "pending immediates must be released (release_queued_tasks) while the loop is alive"
        );
        self.tasks.clear_and_free();
        // Free the deferred-task map's storage. The tasks must not be run, and an
        // entry owns nothing but a `Copy` ctx pointer whose owner released it when
        // the JSC teardown before this finalized it. A worker's VM box is
        // `dealloc`'d without running `Drop` (WebWorker::shutdown), so nothing
        // else frees it.
        self.deferred_tasks.clear_and_free();
    }

    /// Note (§Dispatch): `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject` — see [`RunImmediateFn`].
    pub fn enqueue_immediate_task(&self, task: *mut ()) {
        self.immediate_tasks.push(task);
    }

    /// See [`EventLoop::yield_tasks`].
    pub fn enqueue_task_after_yield(&self, task: Task) {
        if self.closed_for_tasks.get() {
            return self.enqueue_task(task);
        }
        self.yield_tasks.push(task);
    }

    /// `auto_tick`, before it polls: last iteration's yielded tasks become
    /// runnable. Returns whether there are any, so the poll does not block.
    pub fn promote_yield_tasks(&self) -> bool {
        if self.yield_tasks.is_empty() {
            return false;
        }
        for task in self.yield_tasks.take() {
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
    pub fn tick_immediate_tasks(&self) {
        let virtual_machine = self.vm_ref();
        let mut to_run_now = self.immediate_tasks.take();
        self.immediate_tasks
            .replace(self.next_immediate_tasks.take());

        let mut exception_thrown = false;
        for task in to_run_now.iter() {
            // SAFETY: ImmediateObject pointers are kept alive by the JS heap
            // until `__bun_run_immediate_task` consumes them.
            exception_thrown = unsafe { __bun_run_immediate_task(*task, virtual_machine) };
        }

        // make sure microtasks are drained if the last task had an exception
        if exception_thrown {
            let _ = self.maybe_drain_microtasks();
        }

        if self.next_immediate_tasks.capacity() > 0 {
            // this would only occur if we were recursively running tickImmediateTasks.
            bun_core::hint::cold();
            self.immediate_tasks
                .extend_from_slice(&self.next_immediate_tasks.take());
        }

        if to_run_now.capacity() > 1024 * 128 {
            // once in a while, deinit the array to free up memory
            to_run_now = Vec::new();
        } else {
            to_run_now.clear();
        }

        self.next_immediate_tasks.replace(to_run_now);
    }

    pub fn ensure_waker(&self) {
        jsc::mark_binding();
        let uws_loop = uws::Loop::get();
        if self.shared.uws_loop.load(Ordering::Relaxed).is_null() {
            // The VM's embedded loops run on the thread's loop, the one
            // `vm.event_loop_handle` names below.
            debug_assert!(core::ptr::eq(
                Async::uws_to_native(uws_loop),
                Async::Loop::get()
            ));
            self.shared
                .uws_loop
                .store(uws_loop.as_ptr(), Ordering::Relaxed);
        }
        let vm = self.vm_ref();
        if vm.event_loop_handle.get().is_none() {
            vm.event_loop_handle.set(Some(Async::Loop::get()));
            vm.gc_controller.init(vm);
        }
        let (tag, ptr) = EventLoopHandle::js_tag_ptr(self.as_erased_ptr());
        uws_loop.internal_loop_data.set_parent_raw(tag, ptr);
    }

    /// The loop of one thread's `Bun.spawnSync` calls: this VM's, running on `uws_loop`.
    ///
    /// # Safety
    /// `uws_loop` outlives the result.
    pub(crate) unsafe fn new_isolated(uws_loop: &uws::Loop) -> core::pin::Pin<Box<EventLoop>> {
        let el = Box::pin(EventLoop::unbound());
        let vm = VirtualMachine::get();
        el.bind_vm(vm);
        el.set_global(vm.global());
        el.shared
            .uws_loop
            .store(uws_loop.as_ptr(), Ordering::Relaxed);
        let _ = el
            .isolated_poster
            .set(crate::vm_handle::IsolatedPosterInner::new(
                &raw const el.shared,
            ));
        el
    }

    /// What the lower-tier `EventLoopHandle` stores; `link_impl_JsEventLoop!` below casts it back.
    #[inline]
    pub fn as_erased_ptr(&self) -> *mut () {
        core::ptr::from_ref(self).cast_mut().cast()
    }

    /// This loop, for the tiers that cannot name it.
    #[inline]
    pub fn handle(&'static self) -> EventLoopHandle {
        // SAFETY: `'static` outlives every dispatch.
        unsafe { EventLoopHandle::init(self.as_erased_ptr()) }
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn perform_gc(&self) {
        self.vm_ref().gc_controller.perform_gc(false);
    }

    /// `eventLoop().autoTick()` — bounces through `VirtualMachine::auto_tick`,
    /// which dispatches to the `bun_runtime` hook (needs `Timer::All` for the
    /// poll timeout). The body lives in `bun_runtime::jsc_hooks::auto_tick`.
    #[inline]
    pub fn auto_tick(&self) {
        self.vm_ref().auto_tick();
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick) but
    /// only sleeps in the uSockets loop while it has active handles.
    /// Dispatches through
    /// `VirtualMachine::auto_tick_active` → `RuntimeHooks::auto_tick_active`
    /// (body lives in `bun_runtime::jsc_hooks` — needs `Timer::All`).
    #[inline]
    pub fn auto_tick_active(&self) {
        self.vm_ref().auto_tick_active();
    }

    /// Ticks until `promise` settles. `Err` when it returns with the promise
    /// still pending because the VM can no longer run the script that would
    /// settle it (execution forbidden, or a stop was requested: a worker being
    /// terminated mid-wait), or because a termination is pending beneath this wait
    /// (a nested wait under a `node:vm` run whose deadline fired: it must unwind to
    /// that run, not tick on over it). Nothing is thrown for it; a caller inside a
    /// `JsResult` function crosses explicitly with [`jsc::Stopped::throw`] (which, with
    /// the termination already pending, is just `Thrown`).
    pub fn wait_for_promise(&self, promise: jsc::AnyPromise) -> Result<(), jsc::Stopped> {
        let jsc_vm = self.vm_ref().jsc_vm();
        if promise.status() != PromiseStatus::Pending {
            return Ok(());
        }
        while promise.status() == PromiseStatus::Pending {
            if jsc_vm.execution_forbidden()
                || !self.vm_ref().script_allowed()
                || self.global_ref().has_pending_termination_exception()
            {
                return Err(jsc::Stopped);
            }
            self.tick();
            if promise.status() == PromiseStatus::Pending {
                self.auto_tick();
            }
        }
        Ok(())
    }

    pub fn wakeup(&self) {
        self.shared.wakeup();
    }

    /// The ctx whose loop is the one this `EventLoop` runs on. Windows has none for a spawnSync loop:
    /// a libuv handle knows its loop, and the counters stay on the thread's.
    pub fn event_loop_ctx(&self) -> Async::EventLoopCtx {
        #[cfg(unix)]
        if self.isolated_poster.get().is_some() {
            // SAFETY: the VM owns the spawnSync loop, which outlives what the call makes on it.
            return unsafe {
                Async::EventLoopCtx::new(
                    Async::EventLoopCtxKind::SpawnSync,
                    core::ptr::from_ref(self).cast_mut(),
                )
            };
        }
        self.vm_ref().event_loop_ctx()
    }

    /// JS thread: the weak poster other threads use to reach the loop this
    /// `EventLoop` is — the VM's handle for its embedded loops, or the isolated
    /// loop's own poster for a spawnSync loop.
    pub fn js_poster(&self) -> bun_event_loop::JsPoster {
        match self.isolated_poster.get() {
            Some(p) => crate::vm_handle::IsolatedPosterInner::to_js_poster(p),
            None => self.vm_ref().js_poster(),
        }
    }

    /// JS thread: count one more thing keeping this loop alive (the same
    /// counter a `VmHandle::ref_keep_alive` from another thread adjusts).
    pub fn ref_keep_alive(&self) {
        let _ = self.shared.concurrent_ref.fetch_add(1, Ordering::SeqCst);
        // Fold now: JS between the last tick and the poll (an immediate, a
        // promise reaction) must not leave the loop's active count stale.
        self.apply_concurrent_ref_delta();
    }

    /// JS thread: balance a [`Self::ref_keep_alive`].
    pub fn unref_keep_alive(&self) {
        let _ = self.shared.concurrent_ref.fetch_sub(1, Ordering::SeqCst);
        self.apply_concurrent_ref_delta();
    }

    pub(crate) fn unbound() -> EventLoop {
        EventLoop {
            tasks: Default::default(),
            closed_for_tasks: Cell::new(false),
            immediate_tasks: Default::default(),
            next_immediate_tasks: Default::default(),
            yield_tasks: Default::default(),
            shared: Default::default(),
            isolated_poster: OnceCell::new(),
            vm: Cell::new(core::ptr::null()),
            global: Cell::new(None),
            #[cfg(windows)]
            forever_timer: Cell::new(None),
            #[cfg(not(windows))]
            holds_forever_poll: Cell::new(false),
            deferred_tasks: Default::default(),
            entered_event_loop_count: Cell::new(0),
            _pinned: core::marker::PhantomPinned,
        }
    }

    /// A pointer because `VirtualMachine::init` binds its loops before the VM is whole.
    #[inline]
    pub(crate) fn bind_vm(&self, vm: *const VirtualMachine) {
        self.vm.set(vm);
    }

    #[inline]
    pub fn set_global(&self, global: &'static JSGlobalObject) {
        self.global.set(Some(global));
    }

    #[inline(always)]
    fn vm_ref(&self) -> &'static VirtualMachine {
        // SAFETY: bound when it was made, to the VM that outlives it (see the type).
        unsafe { &*self.vm.get() }
    }
    #[inline(always)]
    pub fn global_ref(&self) -> &'static JSGlobalObject {
        // `self.global` is always assigned `vm.global` at every write site
        // (`VirtualMachine::init`/`init_bake`, `enable_macro_mode`,
        // `swap_global_for_test_isolation`, `new_isolated`, bake
        // `production.rs`), so
        // read it directly instead of the vm→global dependent-load chain.
        // SAFETY: set in `VirtualMachine::init()` before any microtask runs, and never unset.
        unsafe { self.global.get().unwrap_unchecked() }
    }
}

impl EventLoop {
    /// # Safety
    /// `done` must point to a live `bool`; C++ writes `true` through it from a
    /// callback inside `tick()`, so it cannot be a Rust `&mut` (would alias).
    pub unsafe fn tick_while_paused(&self, done: *const bool) {
        // SAFETY: see fn contract — `done` is a live FFI bool written by C++.
        while !unsafe { done.read_volatile() } {
            self.native_loop().tick();
        }
    }

    /// Prefer `runCallbackWithResult` unless you really need to make sure that microtasks are drained.
    /// `context`: as for [`run_callback`](Self::run_callback).
    pub fn run_callback_with_result_and_forcefully_drain_microtasks(
        &self,
        context: crate::ContextId,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let EnterJs::Entered(_context) = Self::enter_js(context, global_object) else {
            return Ok(JSValue::UNDEFINED);
        };
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
    fn hold_forever_poll(&self, loop_: &uws::Loop) {
        if !self.holds_forever_poll.replace(true) {
            loop_.inc();
        }
    }

    #[cfg(windows)]
    fn hold_forever_poll(&self, loop_: &uws::Loop) {
        if self.forever_timer.get().is_none() {
            let ctx = self.as_erased_ptr().cast::<core::ffi::c_void>();
            let mut t = uws::Timer::create(loop_, ctx);
            // SAFETY: t is a fresh non-null timer handle
            unsafe {
                t.as_mut()
                    .set(ctx, Some(noop_forever_timer), 1000 * 60 * 4, 1000 * 60 * 4)
            };
            self.forever_timer.set(Some(t));
        }
    }

    pub fn tick_possibly_forever(&self) {
        let loop_ = self.usockets_loop();

        #[cfg(unix)]
        {
            let pending_unref = self.vm_ref().take_pending_unref();
            if pending_unref > 0 {
                loop_.unref_count(pending_unref);
            }
        }

        if !loop_.is_active() {
            self.hold_forever_poll(loop_);
        }

        self.process_gc_timer();
        // `tick()` below can start work (e.g. a --hot reload) whose only wake
        // source is a cross-thread `wakeup()`; bound the park, same as the GC
        // timerfd used to. libuv's `tick_with_timeout` ignores the argument.
        loop_.tick_with_timeout(
            Some(&bun_core::Timespec { sec: 1, nsec: 0 }),
            uws::NOW_NS_UNKNOWN,
        );

        self.vm_ref().on_after_event_loop();
        self.tick_concurrent();
        self.tick();
    }

    /// Drive the loop while a worker's entry module graph is fetched and
    /// linked, until its evaluation has begun (`entry_evaluation_started`, set
    /// by the moduleLoaderEvaluate hook once the linked graph starts executing),
    /// the promise settled, or termination was requested. Parks in `auto_tick`
    /// while imports are still being read/transpiled off-thread; does not wait
    /// for a top-level await.
    pub fn wait_for_worker_entry_evaluation(&self, promise: jsc::AnyPromise) {
        loop {
            let vm = self.vm_ref();
            let terminated = vm.worker_ref().is_some_and(|w| w.has_requested_terminate());
            if terminated
                || vm.entry_evaluation_started.get()
                || promise.status() != PromiseStatus::Pending
            {
                break;
            }
            self.tick();
            let vm = self.vm_ref();
            let terminated = vm.worker_ref().is_some_and(|w| w.has_requested_terminate());
            if terminated
                || vm.entry_evaluation_started.get()
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

impl Drop for EventLoop {
    fn drop(&mut self) {
        // Refuse (and wait out) posts from other threads before the loop goes.
        if let Some(poster) = self.isolated_poster.get() {
            poster.close();
        }
    }
}

/// Testing API to expose event loop state
pub(crate) fn get_active_tasks(
    heap: &crate::bindgen::JsHeap<'_>,
) -> crate::generated_bindgen::event_loop::ActiveTasks {
    // SAFETY: only the VM is taken from it.
    let vm_ref = unsafe { heap.global() }.bun_vm();
    let event_loop = vm_ref.event_loop();
    #[cfg(windows)]
    let num_polls: i32 =
        i32::try_from(uws::Loop::get().uv().active_handles.get()).expect("int cast");
    #[cfg(not(windows))]
    let num_polls: i32 = uws::Loop::get().num_polls.get();
    crate::generated_bindgen::event_loop::ActiveTasks {
        active_tasks: vm_ref.active_tasks.get(),
        tasks: event_loop.tasks.readable_length(),
        immediate_tasks: event_loop.immediate_tasks.len() + event_loop.next_immediate_tasks.len(),
        concurrent_tasks_empty: event_loop.shared.concurrent_tasks.is_empty(),
        loop_active: vm_ref.platform_loop_opt().is_some_and(|h| h.is_active()),
        event_loop_alive: vm_ref.is_event_loop_alive(),
        concurrent_ref: event_loop.shared.concurrent_ref.load(Ordering::SeqCst),
        num_polls,
        iteration: event_loop.usockets_loop().iteration_number(),
    }
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
    // The webview backends' callbacks: a WebView has no context of its own.
    global.bun_vm().event_loop().run_callback(
        crate::ContextId::NONE,
        callback,
        global,
        this_value,
        &[arg0, arg1],
    );
}

// HOST_EXPORT(Bun__EventLoop__enter, c)
pub fn event_loop_enter(global: &JSGlobalObject) {
    global.bun_vm().event_loop().enter();
}

// HOST_EXPORT(Bun__EventLoop__exit, c)
pub fn event_loop_exit(global: &JSGlobalObject) {
    global.bun_vm().event_loop().exit();
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

// `this: *mut EventLoop` — owner was erased from a live `EventLoop` in
// `__bun_js_event_loop_current` / `EventLoopHandle::init`. All calls run on the
// JS thread.
bun_event_loop::link_impl_JsEventLoop! {
    Jsc for EventLoop => |this| {
        iteration_number() => (*this).usockets_loop().iteration_number()
            + (*this).shared.task_drains.load(Ordering::Relaxed),
        file_polls() => (*this).vm_ref().rare_data().file_polls(),
        put_file_poll(poll, was_ever_registered) => {
            let store = (*this).vm_ref().rare_data().file_polls();
            let ctx = Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js);
            // `poll` is a live hive-slot pointer (vtable contract) — non-null.
            (*store).put(core::ptr::NonNull::new_unchecked(poll), ctx, was_ever_registered);
        },
        uws_loop() => (*this).usockets_loop().as_ptr(),
        event_loop_ctx() => (*this).event_loop_ctx(),
        tick() => (*this).tick(),
        auto_tick() => (*this).auto_tick(),
        auto_tick_active() => (*this).auto_tick_active(),
        global_object() => (*this)
            .global
            .get()
            .map_or(core::ptr::null_mut(), |global| global.as_ptr().cast()),
        stdout() => (*this).vm_ref().rare_data().stdout().cast(),
        stderr() => (*this).vm_ref().rare_data().stderr().cast(),
        enter() => (*this).enter(),
        exit() => (*this).exit(),
        enqueue_task(task) => (*this).enqueue_task(task),
        enqueue_task_after_yield(task) => (*this).enqueue_task_after_yield(task),
        js_poster() => (*this).js_poster(),
        env() => (*this).vm_ref().transpiler().env,
        top_level_dir() => core::ptr::from_ref::<[u8]>((*this).vm_ref().top_level_dir()),
        create_null_delimited_env_map() =>
            (*(*this).vm_ref().transpiler().env).map.create_null_delimited_env_map(),
    }
}

// A spawnSync loop differs from its VM's in the loop alone.
bun_io::link_impl_EventLoopCtx! {
    SpawnSync for EventLoop => |this| {
        platform_event_loop_ptr() => (*this).usockets_loop().as_ptr(),
        file_polls_ptr() => (*this).vm_ref().event_loop_ctx().file_polls_ptr(),
        // The VM takes what it counts off its own loop, and nothing a spawnSync call makes asks for this.
        increment_pending_unref_counter() => unreachable!(),
        after_event_loop_callback() => (*this).vm_ref().event_loop_ctx().after_event_loop_callback(),
        set_after_event_loop_callback(cb, ctx) =>
            (*this).vm_ref().event_loop_ctx().set_after_event_loop_callback(cb, ctx),
        pipe_read_scratch() => (*this).vm_ref().event_loop_ctx().pipe_read_scratch(),
    }
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_js_event_loop_current() -> *mut () {
    VirtualMachine::get().event_loop().as_erased_ptr()
}
