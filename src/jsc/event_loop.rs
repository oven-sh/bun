//! `jsc.EventLoop` — the JS-thread event loop. Port of `src/jsc/event_loop.zig`.
//!
//! B-2 un-gate: real `EventLoop` struct + `enter`/`exit`/`tick`/`run_callback`/
//! concurrent-queue plumbing compile against the `lib.rs` stub surface. Bodies
//! that reach into `bun_runtime::api::Timer` (cycle) are `#[cfg(any())]`-gated
//! and replaced with `// TODO(b2-cycle)` stubs that the high-tier crate will
//! override via the registered hook (see §Dispatch hot-path in PORTING.md).

use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};

use bun_aio::{self as Async, Waker};
use bun_uws as uws;

use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin re-exports of sibling/neighbor modules — do NOT inline
// bodies). Siblings still gated in `_gated` are surfaced as `stub_ty!` so
// downstream `bun_jsc::event_loop::Foo` paths keep resolving.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};
pub use bun_event_loop::AnyTask;
pub use bun_event_loop::AnyTaskWithExtraContext;
pub use bun_event_loop::ConcurrentTask::{self, ConcurrentTask as ConcurrentTaskItem, Queue as ConcurrentQueue};
pub use bun_event_loop::DeferredTaskQueue::{self, DeferredRepeatingTask};
pub use bun_event_loop::ManagedTask;
pub use bun_event_loop::MiniEventLoop::{self, EventLoopKind, JsVM, MiniVM};
pub use bun_event_loop::Task;
pub use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

// Siblings still in `_gated` — opaque placeholders so re-exports type-check.
crate::stub_ty!(
    AbstractVM,
    ConcurrentCppTask,
    ConcurrentPromiseTask,
    CppTask,
    GarbageCollectionController,
    PosixSignalHandle,
    PosixSignalTask,
    WorkTask,
);

bun_core::declare_scope!(EventLoop, hidden);

/// `bun_runtime::api::Timer::ImmediateObject` — forward-declared opaque. The
/// real type lives in the higher-tier `bun_runtime` crate (cycle); the queue
/// here only stores raw pointers and never dereferences them at this tier.
#[repr(C)]
pub struct ImmediateObject {
    _opaque: [u8; 0],
}
/// `bun_runtime::api::Timer::WTFTimer` — forward-declared opaque (see above).
#[repr(C)]
pub struct WTFTimer {
    _opaque: [u8; 0],
}

// TODO(port): bun.LinearFifo(Task, .Dynamic) — std.fifo.LinearFifo
pub type Queue = bun_collections::LinearFifo<Task, bun_collections::linear_fifo::DynamicBuffer<Task>>;

pub struct EventLoop {
    pub tasks: Queue,

    /// setImmediate() gets it's own two task queues
    /// When you call `setImmediate` in JS, it queues to the start of the next tick
    /// This is confusing, but that is how it works in Node.js.
    ///
    /// So we have two queues:
    ///   - next_immediate_tasks: tasks that will run on the next tick
    ///   - immediate_tasks: tasks that will run on the current tick
    ///
    /// Having two queues avoids infinite loops creating by calling `setImmediate` in a `setImmediate` callback.
    pub immediate_tasks: Vec<*mut ImmediateObject>,
    pub next_immediate_tasks: Vec<*mut ImmediateObject>,

    pub concurrent_tasks: ConcurrentQueue,
    // TODO(port): lifetime — *JSGlobalObject backref owned by VM
    pub global: Option<NonNull<JSGlobalObject>>,
    // TODO(port): lifetime — *VirtualMachine backref (EventLoop is a field of VirtualMachine)
    pub virtual_machine: Option<NonNull<VirtualMachine>>,
    pub waker: Option<Waker>,
    // TODO(port): lifetime — ?*uws.Timer FFI handle
    pub forever_timer: Option<NonNull<uws::Timer>>,
    pub deferred_tasks: DeferredTaskQueue::DeferredTaskQueue,
    #[cfg(windows)]
    // TODO(port): lifetime — ?*uws.Loop FFI handle
    pub uws_loop: Option<NonNull<uws::Loop>>,
    #[cfg(not(windows))]
    pub uws_loop: (),

    pub debug: Debug,
    pub entered_event_loop_count: isize,
    pub concurrent_ref: AtomicI32,
    // std.atomic.Value(?*Timer.WTFTimer) — atomic nullable pointer
    pub imminent_gc_timer: AtomicPtr<WTFTimer>,

    #[cfg(unix)]
    // TODO(port): lifetime — ?*PosixSignalHandle (gated sibling)
    pub signal_handler: Option<NonNull<c_void>>,
    #[cfg(not(unix))]
    pub signal_handler: (),
}

impl Default for EventLoop {
    fn default() -> Self {
        Self {
            tasks: Queue::init(),
            immediate_tasks: Vec::new(),
            next_immediate_tasks: Vec::new(),
            concurrent_tasks: ConcurrentQueue::default(),
            global: None,
            virtual_machine: None,
            waker: None,
            forever_timer: None,
            deferred_tasks: DeferredTaskQueue::DeferredTaskQueue::default(),
            #[cfg(windows)]
            uws_loop: None,
            #[cfg(not(windows))]
            uws_loop: (),
            debug: Debug::default(),
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

#[cfg(debug_assertions)]
#[derive(Default)]
pub struct Debug {
    pub is_inside_tick_queue: bool,
    pub js_call_count_outside_tick_queue: usize,
    pub drain_microtasks_count_outside_tick_queue: usize,
    pub _prev_is_inside_tick_queue: bool,
    pub last_fn_name: bun_string::String,
    pub track_last_fn_name: bool,
}

#[cfg(debug_assertions)]
impl Debug {
    pub fn enter(&mut self) {
        self._prev_is_inside_tick_queue = self.is_inside_tick_queue;
        self.is_inside_tick_queue = true;
        self.js_call_count_outside_tick_queue = 0;
        self.drain_microtasks_count_outside_tick_queue = 0;
    }

    pub fn exit(&mut self) {
        self.is_inside_tick_queue = self._prev_is_inside_tick_queue;
        self._prev_is_inside_tick_queue = false;
        self.js_call_count_outside_tick_queue = 0;
        self.drain_microtasks_count_outside_tick_queue = 0;
        self.last_fn_name.deref();
        self.last_fn_name = bun_string::String::empty();
    }
}

#[cfg(not(debug_assertions))]
#[derive(Default)]
pub struct Debug;

#[cfg(not(debug_assertions))]
impl Debug {
    #[inline]
    pub fn enter(&mut self) {}
    #[inline]
    pub fn exit(&mut self) {}
}

#[repr(u8)]
enum DrainMicrotasksResult {
    Success = 0,
    JsTerminated = 1,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSGlobalObject__drainMicrotasks(global: *mut JSGlobalObject) -> DrainMicrotasksResult;
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum JsTerminated {
    #[error("JSTerminated")]
    JSTerminated,
}

impl From<JsTerminated> for bun_core::Error {
    fn from(_: JsTerminated) -> Self {
        bun_core::err!("JSTerminated")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch hot-path — `tick_queue_with_count` is the per-tick dispatch over
// `Task { tag, ptr }`. Per PORTING.md, the *high tier owns the match loop*:
// `bun_runtime` registers the real dispatcher at init; this crate only stores
// `(tag, ptr)` and the hook. The Phase-A draft of the match lives in
// `src/jsc/Task.rs` (still gated — every arm names a `bun_runtime` type).
// ──────────────────────────────────────────────────────────────────────────
pub type TickQueueFn =
    fn(&mut EventLoop, &mut VirtualMachine, &mut u32) -> Result<(), JsTerminated>;

static TICK_QUEUE_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// Called by `bun_runtime` at startup to install the real task dispatcher.
pub fn set_tick_queue_hook(f: TickQueueFn) {
    TICK_QUEUE_HOOK.store(f as *mut (), Ordering::Release);
}

#[inline]
fn tick_queue_with_count(
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    let p = TICK_QUEUE_HOOK.load(Ordering::Acquire);
    if p.is_null() {
        // No high-tier dispatcher registered (e.g. unit tests) — drain without
        // running. PERF(port): was inline switch — direct calls per arm in
        // `bun_runtime::run_tasks`; this fallback is cold.
        while el.tasks.read_item().is_some() {
            *counter += 1;
        }
        return Ok(());
    }
    // SAFETY: `p` was stored from a `TickQueueFn` (same layout).
    let f: TickQueueFn = unsafe { core::mem::transmute::<*mut (), TickQueueFn>(p) };
    f(el, vm, counter)
}

impl EventLoop {
    /// Before your code enters JavaScript at the top of the event loop, call
    /// `loop.enter()`. If running a single callback, prefer `runCallback` instead.
    ///
    /// When we call into JavaScript, we must drain process.nextTick & microtasks
    /// afterwards (so that promises run). We must only do that once per task in the
    /// event loop. To make that work, we count enter/exit calls and once that
    /// counter reaches 0, we drain the microtasks.
    pub fn enter(&mut self) {
        bun_core::scoped_log!(EventLoop, "enter() = {}", self.entered_event_loop_count);
        self.entered_event_loop_count += 1;
        self.debug.enter();
    }

    /// "exit" a microtask context in the event loop. See `enter`.
    pub fn exit(&mut self) {
        let count = self.entered_event_loop_count;
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        if count == 1 && !self.vm().is_inside_deferred_task_queue {
            let _ = self.drain_microtasks();
        }

        self.entered_event_loop_count -= 1;
        self.debug.exit();
        // PORT NOTE: reshaped for borrowck — Zig `defer this.debug.exit()` moved to tail; no early returns
    }

    pub fn exit_maybe_drain_microtasks(&mut self, allow_drain_microtask: bool) -> Result<(), JsTerminated> {
        let count = self.entered_event_loop_count;
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        let result = if allow_drain_microtask && count == 1 && !self.vm().is_inside_deferred_task_queue {
            self.drain_microtasks()
        } else {
            Ok(())
        };

        self.entered_event_loop_count -= 1;
        self.debug.exit();
        // PORT NOTE: reshaped for borrowck — `defer` moved to tail; result captured before
        result
    }

    #[inline]
    pub fn get_vm_impl(&self) -> &mut VirtualMachine {
        self.vm()
    }

    pub fn pipe_read_buffer(&self) -> &mut [u8] {
        // TODO(b2-cycle): RareData::pipe_read_buffer — gated until rare_data.rs un-gates.
        todo!("EventLoop::pipe_read_buffer")
    }

    pub fn drain_microtasks_with_global(
        &mut self,
        global_object: &JSGlobalObject,
        jsc_vm: *mut jsc::VM,
    ) -> Result<(), JsTerminated> {
        // During spawnSync, the isolated event loop shares the same VM/GlobalObject.
        // Draining microtasks would execute user JavaScript, which must not happen.
        if self.vm().suppress_microtask_drain {
            return Ok(());
        }

        jsc::mark_binding(core::panic::Location::caller());
        // SAFETY: `jsc_vm` is the live JSC::VM for this thread.
        unsafe { (*jsc_vm).release_weak_refs() };

        // SAFETY: global_object is a valid live JSGlobalObject (borrowed from VM)
        match unsafe { JSC__JSGlobalObject__drainMicrotasks(global_object.as_ptr()) } {
            DrainMicrotasksResult::Success => {}
            DrainMicrotasksResult::JsTerminated => return Err(JsTerminated::JSTerminated),
        }

        self.vm().is_inside_deferred_task_queue = true;
        self.deferred_tasks.run();
        self.vm().is_inside_deferred_task_queue = false;

        if let Some(h) = self.vm().event_loop_handle {
            // SAFETY: `event_loop_handle` is a live uws/uv loop for the VM lifetime.
            unsafe { (*h).drain_quic_if_necessary() };
        }

        #[cfg(debug_assertions)]
        {
            self.debug.drain_microtasks_count_outside_tick_queue +=
                (!self.debug.is_inside_tick_queue) as usize;
        }

        Ok(())
    }

    pub fn drain_microtasks(&mut self) -> Result<(), JsTerminated> {
        // PORT NOTE: reshaped for borrowck — capture raw ptrs before &mut self call.
        let global = self.global.unwrap().as_ptr();
        let jsc_vm = self.vm().jsc_vm;
        // SAFETY: `global` is set during VM init and outlives EventLoop.
        self.drain_microtasks_with_global(unsafe { &*global }, jsc_vm)
    }

    // should be called after exit()
    pub fn maybe_drain_microtasks(&mut self) {
        if self.entered_event_loop_count == 0 && !self.vm().is_inside_deferred_task_queue {
            let _ = self.drain_microtasks();
        }
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
        self.enter();
        if let Err(err) = callback.call(global_object, this_value, arguments) {
            global_object.report_active_exception_as_unhandled(err);
        }
        self.exit();
        // PORT NOTE: reshaped for borrowck — `defer this.exit()` moved to tail; no early returns
    }

    pub fn run_callback_with_result(
        &mut self,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> JSValue {
        self.enter();
        let result = match callback.call(global_object, this_value, arguments) {
            Ok(v) => v,
            Err(err) => {
                global_object.report_active_exception_as_unhandled(err);
                JSValue::ZERO
            }
        };
        self.exit();
        // PORT NOTE: reshaped for borrowck — `defer this.exit()` moved to tail
        result
    }

    fn tick_with_count(&mut self, virtual_machine: &mut VirtualMachine) -> u32 {
        let mut counter: u32 = 0;
        let _ = tick_queue_with_count(self, virtual_machine, &mut counter);
        counter
    }

    fn tick_concurrent(&mut self) {
        let _ = self.tick_concurrent_with_count();
    }

    /// Check whether refConcurrently has been called but the change has not yet been applied to the
    /// underlying event loop's `active` counter
    pub fn has_pending_refs(&self) -> bool {
        self.concurrent_ref.load(Ordering::SeqCst) > 0
    }

    pub fn run_imminent_gc_timer(&mut self) {
        let ptr = self.imminent_gc_timer.swap(core::ptr::null_mut(), Ordering::SeqCst);
        if !ptr.is_null() {
            // TODO(b2-cycle): `(*ptr).run(self.vm())` — `WTFTimer` lives in
            // `bun_runtime::api::Timer` (forward-dep). High tier installs a hook.
            let _ = ptr;
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        self.update_counts();

        #[cfg(unix)]
        {
            if let Some(_signal_handler) = self.signal_handler {
                // TODO(b2-cycle): PosixSignalHandle::drain — gated sibling.
            }
        }

        self.run_imminent_gc_timer();

        let concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.readable_length();
        // PORT NOTE: Zig resets `head = 0` when empty as a micro-opt; LinearFifo
        // realigns internally on grow, so this is folded into `ensure_unused_capacity`.

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
                let _ = unsafe { Box::from_raw(dest) };
            }

            // SAFETY: `task` is non-null (checked above) and owned by this batch.
            let task_ref = unsafe { &mut *task };
            if task_ref.auto_delete() {
                to_destroy = Some(task);
            }

            // PERF(port): Zig wrote into `writable_slice(0)` and bumped `count`
            // directly; LinearFifo's fields are private — `write_item` is the
            // public path (single-slot copy, same complexity).
            let _ = self.tasks.write_item(task_ref.task);
        }

        if let Some(dest) = to_destroy {
            // SAFETY: see above
            let _ = unsafe { Box::from_raw(dest) };
        }

        self.tasks.readable_length() - start_count
    }

    fn update_counts(&mut self) {
        let delta = self.concurrent_ref.swap(0, Ordering::SeqCst);
        let Some(loop_) = self.vm().event_loop_handle else { return };
        // SAFETY: `event_loop_handle` is a live uws/uv loop for the VM lifetime.
        let loop_ = unsafe { &mut *loop_ };
        #[cfg(windows)]
        {
            if delta > 0 {
                loop_.add_active(u32::try_from(delta).unwrap());
            } else {
                loop_.sub_active(u32::try_from(-delta).unwrap());
            }
        }
        #[cfg(not(windows))]
        {
            if delta > 0 {
                loop_.num_polls += i32::from(delta);
                loop_.active = loop_.active.saturating_add(u32::try_from(delta).unwrap());
            } else {
                loop_.num_polls -= i32::from(-delta);
                loop_.active = loop_.active.saturating_sub(u32::try_from(-delta).unwrap());
            }
        }
    }

    pub fn usockets_loop(&self) -> *mut uws::Loop {
        #[cfg(windows)]
        {
            return self.uws_loop.map_or(core::ptr::null_mut(), |p| p.as_ptr());
        }
        #[cfg(not(windows))]
        {
            self.vm().event_loop_handle.unwrap_or(core::ptr::null_mut())
        }
    }

    pub fn process_gc_timer(&mut self) {
        // TODO(b2-cycle): GarbageCollectionController::process_gc_timer — gated sibling.
    }

    pub fn tick(&mut self) {
        jsc::mark_binding(core::panic::Location::caller());
        // TODO(b2): TopExceptionScope::init guard — re-enable once API stabilises.
        self.entered_event_loop_count += 1;
        self.debug.enter();
        // PORT NOTE: reshaped for borrowck — Zig `defer { entered_event_loop_count -= 1; debug.exit() }`
        // is inlined at each return site below (scopeguard would alias &mut self).

        let ctx = self.vm() as *mut VirtualMachine;
        self.tick_concurrent();
        self.process_gc_timer();

        // SAFETY: `ctx` is the VM that owns `self`; both live for the loop.
        let ctx = unsafe { &mut *ctx };
        // PORT NOTE: reshaped for borrowck — capture raw ptr; deref per use.
        let global = self.global.unwrap().as_ptr();
        let global_vm = ctx.jsc_vm;

        loop {
            // Zig: while (tickWithCount > 0) : (handleRejectedPromises) { tickConcurrent } else { ... }
            while self.tick_with_count(ctx) > 0 {
                self.tick_concurrent();
                self.global_ref().handle_rejected_promises();
            }
            // Zig while-else: else branch runs whenever the condition becomes false.
            // SAFETY: `global` outlives EventLoop (set during VM init).
            if self.drain_microtasks_with_global(unsafe { &*global }, global_vm).is_err() {
                self.entered_event_loop_count -= 1;
                self.debug.exit();
                return;
            }
            // TODO(b2): scope.has_exception() — TopExceptionScope re-enable.
            self.tick_concurrent();
            if self.tasks.readable_length() > 0 {
                continue;
            }
            break;
        }

        while self.tick_with_count(ctx) > 0 {
            self.tick_concurrent();
        }

        self.global_ref().handle_rejected_promises();

        self.entered_event_loop_count -= 1;
        self.debug.exit();
    }

    /// Tick the task queue without draining microtasks afterward.
    pub fn tick_tasks_only(&mut self) {
        self.tick_concurrent();

        let vm = self.vm() as *mut VirtualMachine;
        // SAFETY: `vm` is the VM that owns `self`; both live for the loop.
        let vm = unsafe { &mut *vm };
        let prev = vm.suppress_microtask_drain;
        vm.suppress_microtask_drain = true;

        while self.tick_with_count(vm) > 0 {
            self.tick_concurrent();
        }

        vm.suppress_microtask_drain = prev;
        // PORT NOTE: reshaped for borrowck — `defer vm.suppress_microtask_drain = prev` moved to tail
    }

    pub fn enqueue_task(&mut self, task: Task) {
        let _ = self.tasks.write_item(task);
    }

    pub fn enqueue_immediate_task(&mut self, task: *mut ImmediateObject) {
        self.immediate_tasks.push(task);
    }

    pub fn ensure_waker(&mut self) {
        jsc::mark_binding(core::panic::Location::caller());
        if self.vm().event_loop_handle.is_none() {
            #[cfg(windows)]
            {
                self.uws_loop = NonNull::new(uws::Loop::get());
            }
            self.vm().event_loop_handle = Some(Async::Loop::get());
            // TODO(b2-cycle): gc_controller.init(vm) — gated sibling.
        }
        #[cfg(windows)]
        {
            if self.uws_loop.is_none() {
                self.uws_loop = NonNull::new(uws::Loop::get());
            }
        }
        // TODO(b2): uws::Loop::get().internal_loop_data.set_parent_event_loop(EventLoopHandle::init(self))
        // — needs ParentEventLoopHandle impl for jsc::EventLoopHandle.
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn perform_gc(&mut self) {
        // TODO(b2-cycle): GarbageCollectionController::perform_gc — gated sibling.
    }

    pub fn wakeup(&self) {
        #[cfg(windows)]
        {
            if let Some(loop_) = self.uws_loop {
                // SAFETY: uws_loop is a valid live uws::Loop handle
                unsafe { (*loop_.as_ptr()).wakeup() };
            }
            return;
        }
        #[cfg(not(windows))]
        {
            if let Some(loop_) = self.vm().event_loop_handle {
                // SAFETY: `event_loop_handle` is a live loop for the VM lifetime.
                unsafe { (*loop_).wakeup() };
            }
        }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTaskItem) {
        if cfg!(debug_assertions) {
            if self.vm().has_terminated {
                panic!("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }
        self.concurrent_tasks.push(task);
        self.wakeup();
    }

    pub fn ref_concurrently(&self) {
        let _ = self.concurrent_ref.fetch_add(1, Ordering::SeqCst);
        self.wakeup();
    }

    pub fn unref_concurrently(&self) {
        // TODO maybe this should be AcquireRelease
        let _ = self.concurrent_ref.fetch_sub(1, Ordering::SeqCst);
        self.wakeup();
    }

    // ──────────── private helpers (port-only; not in Zig) ────────────
    // TODO(port): lifetime — these unwrap NonNull backrefs. Phase B should
    // replace with proper borrow plumbing.
    #[inline]
    fn vm(&self) -> &mut VirtualMachine {
        // SAFETY: virtual_machine is set during VM init and outlives EventLoop (EventLoop is a field of VM)
        unsafe { self.virtual_machine.unwrap().as_mut() }
    }
    #[inline]
    fn global_ref(&self) -> &JSGlobalObject {
        // SAFETY: global is set during VM init and outlives EventLoop
        unsafe { self.global.unwrap().as_ref() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_runtime`-dependent methods — bodies preserved verbatim from the Phase-A
// draft, gated behind `#[cfg(any())]` until the cycle breaks (high tier owns
// these via the dispatch hook). Un-gate piecewise in B-3.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any())]
impl EventLoop {
    pub fn tick_while_paused(&mut self, done: &mut bool) {
        while !*done {
            self.vm().event_loop_handle.as_mut().unwrap().tick();
        }
    }

    /// Prefer `runCallbackWithResult` unless you really need to make sure that microtasks are drained.
    pub fn run_callback_with_result_and_forcefully_drain_microtasks(
        &mut self,
        callback: JSValue,
        global_object: &JSGlobalObject,
        this_value: JSValue,
        arguments: &[JSValue],
    ) -> Result<JSValue, bun_core::Error> {
        // TODO(port): narrow error set
        let result = callback.call(global_object, this_value, arguments)?;
        result.ensure_still_alive();
        self.drain_microtasks_with_global(global_object, global_object.bun_vm().jsc_vm)?;
        Ok(result)
    }

    pub fn tick_immediate_tasks(&mut self, virtual_machine: &mut VirtualMachine) {
        let mut to_run_now = core::mem::take(&mut self.immediate_tasks);

        self.immediate_tasks = core::mem::take(&mut self.next_immediate_tasks);

        let mut exception_thrown = false;
        for task in to_run_now.iter() {
            // SAFETY: ImmediateObject pointers are kept alive by JS heap until runImmediateTask consumes them
            exception_thrown = unsafe { (**task).run_immediate_task(virtual_machine) };
        }

        if exception_thrown {
            self.maybe_drain_microtasks();
        }

        if self.next_immediate_tasks.capacity() > 0 {
            #[cold]
            fn cold_merge(this: &mut EventLoop) {
                let next = core::mem::take(&mut this.next_immediate_tasks);
                this.immediate_tasks.extend_from_slice(&next);
            }
            cold_merge(self);
        }

        if to_run_now.capacity() > 1024 * 128 {
            to_run_now = Vec::new();
        } else {
            to_run_now.clear();
        }

        self.next_immediate_tasks = to_run_now;
    }

    pub fn auto_tick(&mut self) {
        let loop_ = self.usockets_loop();
        let ctx = self.vm();

        self.tick_immediate_tasks(ctx);
        #[cfg(windows)]
        {
            if !self.immediate_tasks.is_empty() {
                self.wakeup();
            }
        }

        #[cfg(unix)]
        {
            let pending_unref = ctx.pending_unref_counter;
            if pending_unref > 0 {
                ctx.pending_unref_counter = 0;
                loop_.unref_count(pending_unref);
            }
        }

        ctx.timer.update_date_header_timer_if_necessary(loop_, ctx);
        self.run_imminent_gc_timer();

        if loop_.is_active() {
            self.process_gc_timer();
            #[cfg(debug_assertions)]
            let event_loop_sleep_timer = std::time::Instant::now();
            let mut timespec: bun_core::Timespec = if cfg!(debug_assertions) {
                bun_core::Timespec { sec: 0, nsec: 0 }
            } else {
                // SAFETY: only read when get_timeout() returned true and wrote it
                unsafe { core::mem::zeroed() }
            };
            loop_.tick_with_timeout(if ctx.timer.get_timeout(&mut timespec, ctx) {
                Some(&timespec)
            } else {
                None
            });
            #[cfg(debug_assertions)]
            {
                bun_core::scoped_log!(
                    EventLoop,
                    "tick {:?}, timeout: {:?}",
                    event_loop_sleep_timer.elapsed(),
                    timespec.ns()
                );
            }
        } else {
            loop_.tick_without_idle();
            #[cfg(debug_assertions)]
            {
                bun_core::scoped_log!(EventLoop, "tickWithoutIdle");
            }
        }

        #[cfg(unix)]
        {
            ctx.timer.drain_timers(ctx);
        }

        ctx.on_after_event_loop();
        self.global_ref().handle_rejected_promises();
    }

    pub fn tick_possibly_forever(&mut self) {
        let ctx = self.vm();
        let loop_ = self.usockets_loop();

        #[cfg(unix)]
        {
            let pending_unref = ctx.pending_unref_counter;
            if pending_unref > 0 {
                ctx.pending_unref_counter = 0;
                loop_.unref_count(pending_unref);
            }
        }

        if !loop_.is_active() {
            if self.forever_timer.is_none() {
                let t = uws::Timer::create(loop_, self as *mut _ as *mut c_void);
                // SAFETY: t is a fresh non-null timer handle
                unsafe {
                    (*t).set(
                        self as *mut _ as *mut c_void,
                        noop_forever_timer,
                        1000 * 60 * 4,
                        1000 * 60 * 4,
                    )
                };
                self.forever_timer = NonNull::new(t);
            }
        }

        self.process_gc_timer();
        self.process_gc_timer();
        loop_.tick();

        ctx.on_after_event_loop();
        self.tick_concurrent();
        self.tick();
    }

    pub fn auto_tick_active(&mut self) {
        let loop_ = self.usockets_loop();
        let ctx = self.vm();

        self.tick_immediate_tasks(ctx);
        #[cfg(windows)]
        {
            if !self.immediate_tasks.is_empty() {
                self.wakeup();
            }
        }

        #[cfg(unix)]
        {
            let pending_unref = ctx.pending_unref_counter;
            if pending_unref > 0 {
                ctx.pending_unref_counter = 0;
                loop_.unref_count(pending_unref);
            }
        }

        ctx.timer.update_date_header_timer_if_necessary(loop_, ctx);

        if loop_.is_active() {
            self.process_gc_timer();
            // SAFETY: only read when get_timeout() returned true and wrote it
            let mut timespec: bun_core::Timespec = unsafe { core::mem::zeroed() };
            loop_.tick_with_timeout(if ctx.timer.get_timeout(&mut timespec, ctx) {
                Some(&timespec)
            } else {
                None
            });
        } else {
            loop_.tick_without_idle();
        }

        #[cfg(unix)]
        {
            ctx.timer.drain_timers(ctx);
        }

        ctx.on_after_event_loop();
    }

    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        let jsc_vm = self.vm().jsc_vm;
        match promise.status() {
            jsc::PromiseStatus::Pending => {
                while promise.status() == jsc::PromiseStatus::Pending {
                    if jsc_vm.execution_forbidden() {
                        break;
                    }
                    self.tick();
                    if promise.status() == jsc::PromiseStatus::Pending {
                        self.auto_tick();
                    }
                }
            }
            _ => {}
        }
    }

    pub fn wait_for_promise_with_termination(&mut self, promise: jsc::AnyPromise) {
        let worker = self.vm().worker.as_ref().expect("worker is not initialized");
        match promise.status() {
            jsc::PromiseStatus::Pending => {
                while !worker.has_requested_terminate() && promise.status() == jsc::PromiseStatus::Pending {
                    self.tick();
                    if !worker.has_requested_terminate() && promise.status() == jsc::PromiseStatus::Pending {
                        self.auto_tick();
                    }
                }
            }
            _ => {}
        }
    }

    pub fn enqueue_task_concurrent_batch(&self, batch: ConcurrentTask::QueueBatch) {
        if cfg!(debug_assertions) {
            if self.vm().has_terminated {
                panic!("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }
        self.concurrent_tasks.push_batch(batch.front.unwrap(), batch.last.unwrap());
        self.wakeup();
    }

    /// Testing API to expose event loop state
    #[bun_jsc::host_fn]
    pub fn get_active_tasks(global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        let vm = global_object.bun_vm();
        let event_loop = vm.event_loop;
        let result = JSValue::create_empty_object(global_object, 3);
        result.put(global_object, ZigString::static_(b"activeTasks"), JSValue::js_number(vm.active_tasks));
        result.put(
            global_object,
            ZigString::static_(b"concurrentRef"),
            JSValue::js_number(event_loop.concurrent_ref.load(Ordering::SeqCst)),
        );
        #[cfg(windows)]
        let num_polls: i32 = i32::try_from(bun_sys::windows::libuv::Loop::get().active_handles).unwrap();
        #[cfg(not(windows))]
        let num_polls: i32 = uws::Loop::get().num_polls;
        result.put(global_object, ZigString::static_(b"numPolls"), JSValue::js_number(num_polls));
        Ok(result)
    }
}

extern "C" fn noop_forever_timer(_: *mut uws::Timer) {
    // do nothing
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__runCallback1(
    global: *mut JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
) {
    // SAFETY: called from C++ with a valid live global
    let global = unsafe { &*global };
    global.bun_vm().event_loop().run_callback(callback, global, this_value, &[arg0]);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__runCallback2(
    global: *mut JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
    arg1: JSValue,
) {
    // SAFETY: called from C++ with a valid live global
    let global = unsafe { &*global };
    global.bun_vm().event_loop().run_callback(callback, global, this_value, &[arg0, arg1]);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__runCallback3(
    global: *mut JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
    arg1: JSValue,
    arg2: JSValue,
) {
    // SAFETY: called from C++ with a valid live global
    let global = unsafe { &*global };
    global.bun_vm().event_loop().run_callback(callback, global, this_value, &[arg0, arg1, arg2]);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__enter(global: *mut JSGlobalObject) {
    // SAFETY: called from C++ with a valid live global
    unsafe { &*global }.bun_vm().event_loop().enter();
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__EventLoop__exit(global: *mut JSGlobalObject) {
    // SAFETY: called from C++ with a valid live global
    unsafe { &*global }.bun_vm().event_loop().exit();
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/event_loop.zig (748 lines)
//   confidence: medium
//   todos:      14
//   notes:      B-2 un-gate. tick/enter/exit/drain/run_callback/concurrent-queue
//               real; auto_tick*/tick_possibly_forever/wait_for_promise/
//               tick_immediate_tasks gated behind cfg(any()) (bun_runtime cycle).
//               Task dispatch hoisted to high tier via TICK_QUEUE_HOOK.
// ──────────────────────────────────────────────────────────────────────────
