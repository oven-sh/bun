//! `jsc.EventLoop` — the JS-thread event loop. Port of `src/jsc/event_loop.zig`.
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

use bun_aio::{self as Async, Waker};
use bun_uws as uws;

use crate::js_promise::Status as PromiseStatus;
use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports (thin re-exports of sibling/neighbor modules — do NOT inline
// bodies). Kept so downstream `bun_jsc::event_loop::Foo` paths match the
// Zig namespace shape (`jsc.EventLoop.Foo` re-exports at file tail).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_event_loop::any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};
pub use bun_event_loop::AnyTask;
pub use bun_event_loop::AnyTaskWithExtraContext;
pub use bun_event_loop::ConcurrentTask::{self, ConcurrentTask as ConcurrentTaskItem, Queue as ConcurrentQueue};
pub use bun_event_loop::DeferredTaskQueue::{self, DeferredRepeatingTask};
pub use bun_event_loop::ManagedTask;
pub use bun_event_loop::MiniEventLoop::{self, AbstractVM, EventLoopKind, JsVM, MiniVM};
pub use bun_event_loop::Task;
pub use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

pub use crate::concurrent_promise_task::ConcurrentPromiseTask;
pub use crate::cpp_task::{ConcurrentCppTask, CppTask};
pub use crate::garbage_collection_controller::GarbageCollectionController;
pub use crate::jsc_scheduler as JSCScheduler;
pub use crate::posix_signal_handle::{PosixSignalHandle, PosixSignalTask};
pub use crate::work_task::{WorkTask, WorkTaskContext};

bun_core::declare_scope!(EventLoop, hidden);

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
    ///
    /// PORT NOTE (§Dispatch): payload is `*mut ()` — the real
    /// `bun_runtime::timer::ImmediateObject` lives in the higher-tier crate
    /// (cycle). Low tier stores the erased pointer; the high-tier hook
    /// (link-time `__bun_run_immediate_task`) casts it back.
    pub immediate_tasks: Vec<*mut ()>,
    pub next_immediate_tasks: Vec<*mut ()>,

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
    /// `std.atomic.Value(?*Timer.WTFTimer)` — atomic nullable pointer.
    ///
    /// PORT NOTE (§Dispatch): payload is `*mut ()` — the real
    /// `bun_runtime::timer::WTFTimer` lives in the higher-tier crate (cycle).
    /// Low tier stores the erased pointer; the high-tier hook installed via
    /// (link-time `__bun_run_wtf_timer`) casts it back.
    pub imminent_gc_timer: AtomicPtr<()>,

    #[cfg(unix)]
    // TODO(port): lifetime — ?*PosixSignalHandle (boxed, process-lifetime)
    pub signal_handler: Option<NonNull<PosixSignalHandle>>,
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

/// RAII pairing for [`Debug::enter`] / [`Debug::exit`] — the Rust spelling of
/// Zig's `loop.debug.enter(); defer loop.debug.exit();`. Holds the raw pointer
/// (not `&mut`) so re-entrant JS callbacks that touch the same loop while the
/// guard is live don't alias a long-lived mutable borrow.
#[must_use = "dropping immediately exits the debug scope"]
pub struct DebugEnterGuard {
    debug: *mut Debug,
}

impl Drop for DebugEnterGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `debug` was live at `enter_scope` and is owned by the
        // process-lifetime `EventLoop`.
        unsafe { (*self.debug).exit() };
    }
}

impl Debug {
    /// `enter()` now, `exit()` on drop.
    ///
    /// # Safety
    /// `debug` must point to a live `Debug` (the `event_loop.debug` field) and
    /// remain valid for the guard's lifetime.
    #[inline]
    pub unsafe fn enter_scope(debug: *mut Debug) -> DebugEnterGuard {
        // SAFETY: caller contract — `debug` is live; short-lived `&mut` only.
        unsafe { (*debug).enter() };
        DebugEnterGuard { debug }
    }
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

/// Zig: `bun.JSTerminated!T` — short alias for `Result<T, JsTerminated>`.
pub type JsTerminatedResult<T> = Result<T, JsTerminated>;

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
// The hook receives the specific `EventLoop` to drain (which may be the
// isolated `SpawnSyncEventLoop`, not `vm.event_loop()`) plus the VM.
unsafe extern "Rust" {
    /// `bun_runtime::dispatch::tick_queue_with_count` — the real per-task
    /// match loop (Zig `tickQueueWithCount`). Link-time resolved.
    fn __bun_tick_queue_with_count(
        el: *mut EventLoop,
        vm: *mut VirtualMachine,
        counter: &mut u32,
    ) -> Result<(), JsTerminated>;
    /// `ImmediateObject::runImmediateTask` — `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject`; returns whether the callback
    /// threw. Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_immediate_task(task: *mut (), vm: *mut VirtualMachine) -> bool;
    /// `WTFTimer::run` — `timer` is an erased `*mut bun_runtime::timer::WTFTimer`.
    /// Defined in `bun_runtime::dispatch`. Link-time resolved.
    fn __bun_run_wtf_timer(timer: *mut (), vm: *mut VirtualMachine);
}

#[inline]
fn tick_queue_with_count(el: &mut EventLoop, vm: *mut VirtualMachine, counter: &mut u32) -> Result<(), JsTerminated> {
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

        if count == 1 && !self.vm_ref().is_inside_deferred_task_queue {
            let _ = self.drain_microtasks();
        }

        self.entered_event_loop_count -= 1;
        self.debug.exit();
        // PORT NOTE: reshaped for borrowck — Zig `defer this.debug.exit()` moved to tail; no early returns
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

    pub fn exit_maybe_drain_microtasks(&mut self, allow_drain_microtask: bool) -> Result<(), JsTerminated> {
        let count = self.entered_event_loop_count;
        bun_core::scoped_log!(EventLoop, "exit() = {}", count - 1);

        let inside_deferred = self.vm_ref().is_inside_deferred_task_queue;
        let result = if allow_drain_microtask && count == 1 && !inside_deferred {
            self.drain_microtasks()
        } else {
            Ok(())
        };

        // PORT NOTE: spec event_loop.zig:92-103 uses `try drainMicrotasksWithGlobal(...)`
        // which returns BEFORE reaching `entered_event_loop_count -= 1`; only
        // `defer this.debug.exit()` runs on the error path. Mirror that here.
        if result.is_ok() {
            self.entered_event_loop_count -= 1;
        }
        self.debug.exit();
        result
    }

    #[inline]
    pub fn get_vm_impl(&self) -> *mut VirtualMachine {
        self.vm()
    }

    /// SAFETY: returns `&mut` into VM-owned scratch; two calls alias the same
    /// buffer. Caller must not hold another live `&mut` to it.
    pub unsafe fn pipe_read_buffer(&self) -> &mut [u8] {
        // SAFETY: vm() is the live owning VM; rare_data() lazily inits the
        // per-VM scratch buffer. Caller contract (see doc): no concurrent &mut.
        unsafe { &mut (*self.vm()).rare_data().pipe_read_buffer()[..] }
    }

    pub fn drain_microtasks_with_global(
        &mut self,
        global_object: &JSGlobalObject,
        jsc_vm: *mut jsc::VM,
    ) -> Result<(), JsTerminated> {
        let vm = self.vm();
        // During spawnSync, the isolated event loop shares the same VM/GlobalObject.
        // Draining microtasks would execute user JavaScript, which must not happen.
        // SAFETY: `vm` is the live owning VM; field reads/writes only.
        if unsafe { (*vm).suppress_microtask_drain } {
            return Ok(());
        }

        jsc::mark_binding();
        // SAFETY: `jsc_vm` is the live JSC::VM for this thread.
        unsafe { (*jsc_vm).release_weak_refs() };

        // SAFETY: global_object is a valid live JSGlobalObject (borrowed from VM)
        match unsafe { JSC__JSGlobalObject__drainMicrotasks(global_object.as_ptr()) } {
            DrainMicrotasksResult::Success => {}
            DrainMicrotasksResult::JsTerminated => return Err(JsTerminated::JSTerminated),
        }

        // SAFETY: `vm` is the live owning VM.
        unsafe { (*vm).is_inside_deferred_task_queue = true };
        self.deferred_tasks.run();
        // SAFETY: `vm` is the live owning VM.
        unsafe { (*vm).is_inside_deferred_task_queue = false };

        // PORT NOTE: spec event_loop.zig:144-146 guards on `event_loop_handle != null`
        // but then calls `this.virtual_machine.uwsLoop().drainQuicIfNecessary()`.
        // On Windows `uwsLoop()` returns `uws.Loop.get()` (NOT `event_loop_handle`,
        // which is the libuv loop). Mirror that here.
        // SAFETY: `vm` is the live owning VM; field read only.
        if unsafe { (*vm).event_loop_handle.is_some() } {
            // SAFETY: `uws_loop()` returns a live uws loop for the VM lifetime.
            unsafe { (*(*vm).uws_loop()).drain_quic_if_necessary() };
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
        let jsc_vm = self.vm_ref().jsc_vm;
        // SAFETY: `global` is set during VM init and outlives EventLoop.
        self.drain_microtasks_with_global(unsafe { &*global }, jsc_vm)
    }

    // should be called after exit()
    pub fn maybe_drain_microtasks(&mut self) {
        if self.entered_event_loop_count == 0 && !self.vm_ref().is_inside_deferred_task_queue {
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

    fn tick_with_count(&mut self, virtual_machine: *mut VirtualMachine) -> u32 {
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
        // Spec event_loop.zig:302-306: `if (swap()) |timer| timer.run(vm)`.
        // The real `WTFTimer` lives in `bun_runtime` (cycle), so the body
        // dispatches through `__bun_run_wtf_timer` (link-time extern).
        let ptr = self.imminent_gc_timer.swap(core::ptr::null_mut(), Ordering::SeqCst);
        if !ptr.is_null() {
            // SAFETY: `ptr` was published by `WTFTimer::update` and remains
            // valid until `run` removes it; `vm()` is the live owning VM.
            unsafe { __bun_run_wtf_timer(ptr, self.vm()) };
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        self.update_counts();

        #[cfg(unix)]
        {
            if let Some(signal_handler) = self.signal_handler {
                // SAFETY: `signal_handler` is the boxed `PosixSignalHandle` installed by
                // `Bun__ensureSignalHandler`; it lives for the process lifetime and is
                // disjoint from `*self`, so passing `&mut *self` alongside is sound.
                unsafe { (*signal_handler.as_ptr()).drain(self) };
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
        // PORT NOTE: spec event_loop.zig:283-284 unwraps `event_loop_handle.?`
        // (panic). Do NOT silently drop the swapped delta when the handle is
        // missing — refs queued via `ref_concurrently()` would be lost forever.
        let loop_ = self.vm_ref().event_loop_handle.expect("event_loop_handle");
        let delta = self.concurrent_ref.swap(0, Ordering::SeqCst);
        // SAFETY: `event_loop_handle` is a live uws/uv loop for the VM lifetime.
        let loop_ = unsafe { &mut *loop_ };
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
                loop_.num_polls += i32::from(delta);
                loop_.active = loop_.active.saturating_add(u32::try_from(delta).expect("int cast"));
            } else {
                loop_.num_polls -= i32::from(-delta);
                loop_.active = loop_.active.saturating_sub(u32::try_from(-delta).expect("int cast"));
            }
        }
    }

    pub fn usockets_loop(&self) -> *mut uws::Loop {
        // Spec event_loop.zig:359-365 unwraps `.?` (panic on null). Preserve
        // that fail-fast contract — callers immediately materialize `&mut *`,
        // so a null return would be instant UB instead of a clean panic.
        #[cfg(windows)]
        {
            return self
                .uws_loop
                .expect("usockets_loop: uws_loop not initialized (call ensure_waker first)")
                .as_ptr();
        }
        #[cfg(not(windows))]
        {
            self.vm_ref().event_loop_handle
                .expect("usockets_loop: event_loop_handle not initialized (call ensure_waker first)")
        }
    }

    pub fn process_gc_timer(&mut self) {
        self.vm_ref().as_mut().gc_controller.process_gc_timer();
    }

    pub fn tick(&mut self) {
        jsc::mark_binding();
        // PORT NOTE: `TopExceptionScope` is placement-constructed into its
        // `bytes` field, so its storage MUST NOT move after init (no NRVO
        // guarantee in Rust). Stack-allocate the slot here and hand `init`
        // its final address.
        let mut scope_storage = core::mem::MaybeUninit::uninit();
        let scope = jsc::TopExceptionScope::init(&mut scope_storage, self.global_ref());
        self.entered_event_loop_count += 1;
        self.debug.enter();
        // PORT NOTE: reshaped for borrowck — Zig
        //   `defer scope.deinit(); defer { entered_event_loop_count -= 1; debug.exit() }`
        // is inlined at each return site below (a scopeguard closure would
        // alias `&mut self`).

        let ctx = self.vm();
        self.tick_concurrent();
        self.process_gc_timer();

        // PORT NOTE: reshaped for borrowck — capture raw ptr; deref per use.
        let global = self.global.unwrap().as_ptr();
        // SAFETY: `ctx` is the VM that owns `self`; field read only.
        let global_vm = unsafe { (*ctx).jsc_vm };

        loop {
            // Zig: while (tickWithCount > 0) : (handleRejectedPromises) { tickConcurrent } else { ... }
            while self.tick_with_count(ctx) > 0 {
                self.tick_concurrent();
                self.global_ref().handle_rejected_promises();
            }
            // Zig while-else: else branch runs whenever the condition becomes false.
            // SAFETY: `global` outlives EventLoop (set during VM init).
            if self.drain_microtasks_with_global(unsafe { &*global }, global_vm).is_err()
                || scope.has_exception()
            {
                self.entered_event_loop_count -= 1;
                self.debug.exit();
                // SAFETY: `scope` was init'd above and not moved.
                unsafe { jsc::TopExceptionScope::destroy(scope) };
                return;
            }
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
        // SAFETY: `scope` was init'd above and not moved.
        unsafe { jsc::TopExceptionScope::destroy(scope) };
    }

    /// Tick the task queue without draining microtasks afterward.
    pub fn tick_tasks_only(&mut self) {
        self.tick_concurrent();

        let vm = self.vm();
        // SAFETY: `vm` is the VM that owns `self`; field reads/writes only.
        let prev = unsafe { (*vm).suppress_microtask_drain };
        // SAFETY: see above.
        unsafe { (*vm).suppress_microtask_drain = true };

        while self.tick_with_count(vm) > 0 {
            self.tick_concurrent();
        }

        // SAFETY: see above.
        unsafe { (*vm).suppress_microtask_drain = prev };
        // PORT NOTE: reshaped for borrowck — `defer vm.suppress_microtask_drain = prev` moved to tail
    }

    pub fn enqueue_task(&mut self, task: Task) {
        let _ = self.tasks.write_item(task);
    }

    pub fn deinit(&mut self) {
        // PORT NOTE: Zig's `tasks.deinit()` / `clearAndFree()` map to dropping
        // the owned buffers; reassigning a fresh value drops the old in place.
        self.tasks = Queue::init();
        self.immediate_tasks = Vec::new();
        self.next_immediate_tasks = Vec::new();
    }

    /// PORT NOTE (§Dispatch): `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject` — see [`RunImmediateFn`].
    pub fn enqueue_immediate_task(&mut self, task: *mut ()) {
        self.immediate_tasks.push(task);
    }

    /// `tickImmediateTasks` — spec event_loop.zig:239-270. Swaps the two
    /// immediate queues, drains the now-current batch, then recycles the
    /// drained Vec as the next-tick buffer.
    ///
    /// PORT NOTE: the real `ImmediateObject` lives in `bun_runtime` (cycle), so
    /// the per-task body dispatches through `__bun_run_immediate_task` (link-
    /// time, definer in `bun_runtime`). The swap always happens — this is
    /// load-bearing for `auto_tick`'s `has_pending_immediate` read, which must
    /// observe the post-swap `immediate_tasks` (next-tick immediates), not the
    /// un-drained current batch (busy-spin hazard, spec Timer.zig:251-256).
    pub fn tick_immediate_tasks(&mut self, virtual_machine: *mut VirtualMachine) {
        let mut to_run_now = core::mem::take(&mut self.immediate_tasks);

        self.immediate_tasks = core::mem::take(&mut self.next_immediate_tasks);

        let mut exception_thrown = false;
        for task in to_run_now.iter() {
            // SAFETY: ImmediateObject pointers are kept alive by the JS heap
            // until `runImmediateTask` consumes them; `virtual_machine` is the
            // live owning VM per caller contract.
            exception_thrown = unsafe { __bun_run_immediate_task(*task, virtual_machine) };
        }

        // make sure microtasks are drained if the last task had an exception
        if exception_thrown {
            self.maybe_drain_microtasks();
        }

        if self.next_immediate_tasks.capacity() > 0 {
            // this would only occur if we were recursively running tickImmediateTasks.
            #[cold]
            fn cold_merge(this: &mut EventLoop) {
                let next = core::mem::take(&mut this.next_immediate_tasks);
                this.immediate_tasks.extend_from_slice(&next);
            }
            cold_merge(self);
        }

        if to_run_now.capacity() > 1024 * 128 {
            // once in a while, deinit the array to free up memory
            to_run_now = Vec::new();
        } else {
            to_run_now.clear();
        }

        self.next_immediate_tasks = to_run_now;
    }

    pub fn ensure_waker(&mut self) {
        jsc::mark_binding();
        let vm = self.vm();
        // SAFETY: `vm` is the live owning VM; field reads/writes only.
        if unsafe { (*vm).event_loop_handle.is_none() } {
            #[cfg(windows)]
            {
                self.uws_loop = NonNull::new(uws::Loop::get());
            }
            // SAFETY: `vm` is the live owning VM.
            unsafe { (*vm).event_loop_handle = Some(Async::Loop::get()) };
            // PORT NOTE: reshaped for borrowck — Zig passes `vm.gc_controller` and
            // `vm` simultaneously; route through raw addr_of to avoid stacked-borrow
            // aliasing of the embedded field with its parent.
            // SAFETY: `vm` is the live owning VM; gc_controller is embedded.
            unsafe {
                let gc: *mut GarbageCollectionController = core::ptr::addr_of_mut!((*vm).gc_controller);
                (*gc).init(&mut *vm);
            }
        }
        #[cfg(windows)]
        {
            if self.uws_loop.is_none() {
                self.uws_loop = NonNull::new(uws::Loop::get());
            }
        }
        // PORT NOTE: `EventLoopHandle` lives in `bun_event_loop` (lower tier),
        // which cannot name `jsc::EventLoop`, so it stores `*mut ()`. The
        // typed `set_parent_event_loop` extension trait in `bun_uws` expects
        // a `ParentEventLoopHandle` impl, but `EventLoopHandle` already
        // exposes `into_tag_ptr()` — go straight to the sys-level setter.
        let (tag, ptr) =
            EventLoopHandle::init(std::ptr::from_mut::<EventLoop>(self).cast::<()>()).into_tag_ptr();
        // SAFETY: `uws::Loop::get()` returns the live process-global uws loop.
        unsafe { (*uws::Loop::get()).internal_loop_data.set_parent_raw(tag, ptr) };
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn perform_gc(&mut self) {
        self.vm_ref().as_mut().gc_controller.perform_gc();
    }

    /// `eventLoop().autoTick()` — bounces through `VirtualMachine::auto_tick`,
    /// which dispatches to the `bun_runtime` hook (needs `Timer::All` for the
    /// poll timeout). The body lives in `bun_runtime::jsc_hooks::auto_tick`.
    #[inline]
    pub fn auto_tick(&mut self) {
        self.vm_ref().as_mut().auto_tick();
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick) but
    /// only sleeps in the uSockets loop while it has active handles
    /// (spec event_loop.zig:455-493). Dispatches through
    /// `VirtualMachine::auto_tick_active` → `RuntimeHooks::auto_tick_active`
    /// (body lives in `bun_runtime::jsc_hooks` — needs `Timer::All`).
    #[inline]
    pub fn auto_tick_active(&mut self) {
        self.vm_ref().as_mut().auto_tick_active();
    }

    /// `eventLoop().waitForPromise(promise)` — spin tick/auto_tick until
    /// `promise` settles or execution is forbidden (spec event_loop.zig:553-576).
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        let jsc_vm = self.vm_ref().jsc_vm();
        if promise.status() != PromiseStatus::Pending {
            return;
        }
        while promise.status() == PromiseStatus::Pending {
            if jsc_vm.execution_forbidden() {
                break;
            }
            self.tick();
            if promise.status() == PromiseStatus::Pending {
                self.auto_tick();
            }
        }
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
            if let Some(loop_) = self.vm_ref().event_loop_handle {
                // SAFETY: `event_loop_handle` is a live loop for the VM lifetime.
                unsafe { (*loop_).wakeup() };
            }
        }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTaskItem) {
        if cfg!(debug_assertions) {
            if self.vm_ref().has_terminated {
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
    //
    // PORT NOTE: returns a raw pointer, NOT `&mut VirtualMachine`. `EventLoop`
    // is a value field of `VirtualMachine`, so materializing `&mut VM` while a
    // `&EventLoop`/`&mut EventLoop` is live would alias (PORTING.md §Forbidden).
    // Callers must dereference per-field at use sites.
    #[inline]
    fn vm(&self) -> *mut VirtualMachine {
        self.virtual_machine.unwrap().as_ptr()
    }
    /// Safe `&'static VirtualMachine` accessor for the owning VM. The VM is the
    /// per-thread singleton (see [`VirtualMachine::get`]); `EventLoop` is a
    /// value field of it, so the pointer is non-null and live for the VM
    /// lifetime. Prefer this over `unsafe { &*self.vm() }` for read-only field
    /// access; whole-struct mutation goes through [`VirtualMachine::as_mut`].
    #[inline]
    fn vm_ref(&self) -> &'static VirtualMachine {
        // SAFETY: `virtual_machine` is set in `VirtualMachine::init()` to the
        // owning per-thread singleton; non-null and outlives `self`.
        unsafe { &*self.virtual_machine.unwrap().as_ptr() }
    }
    #[inline]
    fn global_ref(&self) -> &JSGlobalObject {
        // SAFETY: global is set during VM init and outlives EventLoop
        unsafe { self.global.unwrap().as_ref() }
    }
}

impl EventLoop {
    pub fn tick_while_paused(&mut self, done: &mut bool) {
        while !*done {
            // live uws/uv loop for the VM lifetime.
            unsafe { (*(*self.vm()).event_loop_handle.unwrap()).tick() };
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
        let result = callback.call(global_object, this_value, arguments)?;
        result.ensure_still_alive();
        let jsc_vm = global_object.bun_vm().as_mut().jsc_vm;
        self.drain_microtasks_with_global(global_object, jsc_vm)?;
        Ok(result)
    }

    pub fn tick_possibly_forever(&mut self) {
        let ctx = self.vm();
        let loop_ptr = self.usockets_loop();
        // SAFETY: usockets_loop() returns a live uws loop for the VM lifetime.
        let loop_ = unsafe { &mut *loop_ptr };

        #[cfg(unix)]
        {
            // SAFETY: `ctx` is the live owning VM; field reads/writes only.
            let pending_unref = unsafe { (*ctx).pending_unref_counter };
            if pending_unref > 0 {
                // SAFETY: see above.
                unsafe { (*ctx).pending_unref_counter = 0 };
                loop_.unref_count(pending_unref);
            }
        }

        if !loop_.is_active() {
            if self.forever_timer.is_none() {
                let mut t =
                    uws::Timer::create(loop_, std::ptr::from_mut::<EventLoop>(self).cast::<core::ffi::c_void>());
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

        self.process_gc_timer();
        self.process_gc_timer();
        loop_.tick();

        // SAFETY: `ctx` is the live owning VM.
        unsafe { (*ctx).on_after_event_loop() };
        self.tick_concurrent();
        self.tick();
    }

    pub fn wait_for_promise_with_termination(&mut self, promise: jsc::AnyPromise) {
        // owned by C++ that outlives this VM (BACKREF — see field decl).
        let worker = unsafe {
            &*(*self.vm()).worker.expect("worker is not initialized").cast::<crate::web_worker::WebWorker>()
        };
        match promise.status() {
            PromiseStatus::Pending => {
                while !worker.has_requested_terminate() && promise.status() == PromiseStatus::Pending {
                    self.tick();
                    if !worker.has_requested_terminate() && promise.status() == PromiseStatus::Pending {
                        self.auto_tick();
                    }
                }
            }
            _ => {}
        }
    }

    pub fn enqueue_task_concurrent_batch(
        &self,
        batch: bun_threading::unbounded_queue::Batch<ConcurrentTaskItem>,
    ) {
        if cfg!(debug_assertions) {
            if self.vm_ref().has_terminated {
                panic!("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }
        // Spec event_loop.zig:667 unwraps `batch.front.?`/`batch.last.?` —
        // preserve the panic-on-empty contract; `push_batch`'s first line is
        // `set_next(last, null)`, so a null `last` would be UB, not a clean fail.
        assert!(
            !batch.front.is_null() && !batch.last.is_null(),
            "enqueue_task_concurrent_batch: empty batch",
        );
        self.concurrent_tasks.push_batch(batch.front, batch.last);
        self.wakeup();
    }
}

/// Testing API to expose event loop state
#[bun_jsc::host_fn]
pub fn get_active_tasks(global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // fields and call &-methods on it for the duration of this host fn.
    let vm_ref = global_object.bun_vm();
    // SAFETY: event_loop() returns a non-null raw pointer into the owning VM.
    let event_loop = unsafe { &*vm_ref.event_loop() };
    let result = JSValue::create_empty_object(global_object, 3);
    result.put(global_object, b"activeTasks", JSValue::js_number(vm_ref.active_tasks as f64));
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
    result.put(global_object, b"numPolls", JSValue::js_number(num_polls as f64));
    Ok(result)
}

extern "C" fn noop_forever_timer(_: *mut uws::Timer) {
    // do nothing
}

// HOST_EXPORT(Bun__EventLoop__runCallback1, c)
pub fn event_loop_run_callback1(
    global: &JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
) {
    global.bun_vm().event_loop_mut().run_callback(callback, global, this_value, &[arg0]);
}

// HOST_EXPORT(Bun__EventLoop__runCallback2, c)
pub fn event_loop_run_callback2(
    global: &JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
    arg1: JSValue,
) {
    global.bun_vm().event_loop_mut().run_callback(callback, global, this_value, &[arg0, arg1]);
}

// HOST_EXPORT(Bun__EventLoop__runCallback3, c)
pub fn event_loop_run_callback3(
    global: &JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    arg0: JSValue,
    arg1: JSValue,
    arg2: JSValue,
) {
    global.bun_vm().event_loop_mut().run_callback(callback, global, this_value, &[arg0, arg1, arg2]);
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
// crate and cannot name `jsc::EventLoop`. Zig (`src/event_loop/AnyEventLoop.zig`,
// `src/jsc/EventLoopHandle.zig`) calls these inline because Zig has no crate
// boundaries. Rather than a runtime-registered vtable, the low tier declares
// these as `extern "Rust"` and the bodies live here, resolved at link time —
// hardcoded, single consumer. Each slot casts the erased `*mut ()` owner back
// to `*mut EventLoop` and forwards to the real method.
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
unsafe fn el(owner: *mut ()) -> *mut EventLoop {
    owner.cast::<EventLoop>()
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_iteration_number(owner: *mut ()) -> u64 {
    // SAFETY: `owner` is a live `*mut EventLoop`; `usockets_loop()` returns the
    // live VM-owned uws loop.
    unsafe { (*(*el(owner)).usockets_loop()).iteration_number() }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_file_polls(owner: *mut ()) -> *mut Async::file_poll::Store {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM.
    // Return raw to avoid asserting uniqueness — multiple handles may name the
    // same VM (see `EventLoopHandle::file_polls` doc).
    let vm = unsafe { (*el(owner)).vm() };
    unsafe {
        std::ptr::from_mut((*vm)
            .rare_data()
            .file_polls_
            .get_or_insert_with(|| Box::new(Async::file_poll::Store::init()))
            .as_mut())
    }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_put_file_poll(owner: *mut (), poll: *mut Async::FilePoll, was_ever_registered: bool) {
    // Zig: `vm.rareData().filePolls(vm).put(poll, vm, was_ever_registered)`.
    // `Store::put` only needs the VM as an opaque `EventLoopCtx` (for
    // `after_event_loop_callback` recovery) — reach it via the JS-ctx hook so
    // we don't form a competing `&mut VirtualMachine` while holding the store.
    let store = __bun_js_event_loop_file_polls(owner);
    let ctx = Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js);
    // SAFETY: `store` is the live per-VM FilePoll store (see `vt_file_polls`).
    unsafe { (*store).put(poll, ctx, was_ever_registered) };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_uws_loop(owner: *mut ()) -> *mut uws::Loop {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).usockets_loop() }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_pipe_read_buffer(owner: *mut ()) -> *mut [u8] {
    // SAFETY: `owner` is a live `*mut EventLoop`; `pipe_read_buffer` reaches
    // VM-owned scratch. Return a raw fat ptr — see method SAFETY doc re aliasing.
    unsafe { std::ptr::from_mut::<[u8]>((*el(owner)).pipe_read_buffer()) }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_tick(owner: *mut ()) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).tick() };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_auto_tick(owner: *mut ()) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).auto_tick() };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_auto_tick_active(owner: *mut ()) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).auto_tick_active() };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_global_object(owner: *mut ()) -> *mut () {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).global }.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast())
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_bun_vm(owner: *mut ()) -> *mut () {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).virtual_machine }.map_or(core::ptr::null_mut(), |p| p.as_ptr().cast())
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_stdout(owner: *mut ()) -> *mut () {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM.
    unsafe { (*(*el(owner)).vm()).rare_data().stdout().cast() }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_stderr(owner: *mut ()) -> *mut () {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM.
    unsafe { (*(*el(owner)).vm()).rare_data().stderr().cast() }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_enter(owner: *mut ()) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).enter() };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_exit(owner: *mut ()) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).exit() };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_enqueue_task(owner: *mut (), task: Task) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).enqueue_task(task) };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_enqueue_task_concurrent(owner: *mut (), task: *mut ConcurrentTaskItem) {
    // SAFETY: `owner` is a live `*mut EventLoop`.
    unsafe { (*el(owner)).enqueue_task_concurrent(task) };
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_env(owner: *mut ()) -> *mut bun_dotenv::Loader<'static> {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM.
    unsafe { (*(*el(owner)).vm()).transpiler.env }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_top_level_dir(owner: *mut ()) -> *const [u8] {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM. The
    // `fs.top_level_dir` slice is borrowed for the VM lifetime.
    unsafe { std::ptr::from_ref::<[u8]>((*(*(*el(owner)).vm()).transpiler.fs).top_level_dir) }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_create_null_delimited_env_map(
    owner: *mut (),
) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
    // SAFETY: `owner` is a live `*mut EventLoop`; `vm()` is its owning VM.
    unsafe { (*(*(*el(owner)).vm()).transpiler.env).map.create_null_delimited_env_map() }
}

#[unsafe(no_mangle)]
pub fn __bun_js_event_loop_current() -> *mut () {
    // SAFETY: `VirtualMachine::get()` panics if no VM on this thread;
    // `event_loop()` returns the live `*mut EventLoop` self-pointer.
    VirtualMachine::get().as_mut().event_loop().cast()
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_event_loop::SpawnSyncEventLoop` extern impls
//
// `SpawnSyncEventLoop` lives in the lower-tier `bun_event_loop` crate and
// cannot name `jsc::EventLoop` / `jsc::VirtualMachine`. Zig
// (`SpawnSyncEventLoop.zig`) did inline field access. The bodies live here as
// `#[no_mangle]` Rust-ABI fns, declared `extern "Rust"` on the low-tier side
// and resolved at link time. Each erased `*mut ()` is a `*mut VirtualMachine`
// or `*mut EventLoop`; cast back and forward to the real method/field.
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
unsafe fn vm_cast(vm: *mut ()) -> *mut VirtualMachine {
    vm.cast::<VirtualMachine>()
}

/// Heap-allocate a fresh `EventLoop` bound to `vm`; on Windows, store
/// `uws_loop` in `event_loop.uws_loop`. Spec SpawnSyncEventLoop.zig:62-68.
#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_create_event_loop(vm: *mut (), uws_loop: *mut uws::Loop) -> *mut () {
    let vm = unsafe { vm_cast(vm) };
    let mut el = Box::new(EventLoop::default());
    // SAFETY: `vm` is the live per-thread VM.
    el.global = NonNull::new(unsafe { (*vm).global });
    el.virtual_machine = NonNull::new(vm);
    #[cfg(windows)]
    {
        el.uws_loop = NonNull::new(uws_loop);
    }
    #[cfg(not(windows))]
    {
        let _ = uws_loop;
    }
    Box::into_raw(el).cast()
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_destroy_event_loop(el: *mut ()) {
    // SAFETY: paired with `Box::into_raw` in `__bun_spawn_sync_create_event_loop`.
    drop(unsafe { Box::from_raw(el.cast::<EventLoop>()) });
}

/// Re-bind `event_loop.{global, virtual_machine}` to `vm` (prepare path).
/// Spec SpawnSyncEventLoop.zig:93-95.
#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_event_loop_set_vm(el: *mut (), vm: *mut ()) {
    let el = el.cast::<EventLoop>();
    let vm = unsafe { vm_cast(vm) };
    // SAFETY: `el` is the live heap-owned isolated loop; `vm` is the per-thread VM.
    unsafe {
        (*el).global = NonNull::new((*vm).global);
        (*el).virtual_machine = NonNull::new(vm);
    }
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_event_loop_tick_tasks_only(el: *mut ()) {
    // SAFETY: `el` is the live heap-owned isolated loop.
    unsafe { (*el.cast::<EventLoop>()).tick_tasks_only() };
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_vm_get_event_loop_handle(
    vm: *mut (),
) -> bun_event_loop::SpawnSyncEventLoop::VmEventLoopHandle {
    // SAFETY: `vm` is the live per-thread VM.
    unsafe { (*vm_cast(vm)).event_loop_handle }.and_then(NonNull::new)
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_vm_set_event_loop_handle(
    vm: *mut (),
    h: bun_event_loop::SpawnSyncEventLoop::VmEventLoopHandle,
) {
    // SAFETY: `vm` is the live per-thread VM.
    unsafe { (*vm_cast(vm)).event_loop_handle = h.map(NonNull::as_ptr) };
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_vm_set_event_loop(vm: *mut (), el: *mut ()) {
    // SAFETY: `vm` is the live per-thread VM; `el` is its previous `event_loop`
    // pointer (a `*mut EventLoop` into `regular_event_loop`/`macro_event_loop`).
    unsafe { (*vm_cast(vm)).event_loop = el.cast::<EventLoop>() };
}

#[unsafe(no_mangle)]
pub fn __bun_spawn_sync_vm_swap_suppress_microtask_drain(vm: *mut (), v: bool) -> bool {
    // SAFETY: `vm` is the live per-thread VM.
    let vm = unsafe { vm_cast(vm) };
    unsafe { core::mem::replace(&mut (*vm).suppress_microtask_drain, v) }
}

// ported from: src/jsc/event_loop.zig
