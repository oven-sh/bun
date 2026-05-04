use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};

use bun_core as bun;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, VirtualMachine, ZigString};
use bun_runtime::api::Timer;
use bun_str as bun_string;
use bun_uws as uws;
use bun_aio::{self as Async, Waker};

// Re-exports (thin re-exports of sibling/neighbor modules — do NOT inline bodies)
pub use bun_event_loop::any_event_loop::AnyEventLoop;
pub use crate::concurrent_promise_task::ConcurrentPromiseTask;
pub use crate::work_task::WorkTask;
pub use bun_event_loop::any_task as AnyTask;
pub use bun_event_loop::managed_task as ManagedTask;
pub use bun_event_loop::any_task_with_extra_context as AnyTaskWithExtraContext;
pub use crate::cpp_task::{CppTask, ConcurrentCppTask};
pub use crate::jsc_scheduler as JSCScheduler;
pub use crate::task::Task;
pub use bun_event_loop::concurrent_task as ConcurrentTask;
pub use crate::garbage_collection_controller as GarbageCollectionController;
pub use bun_event_loop::deferred_task_queue as DeferredTaskQueue;
pub use DeferredTaskQueue::DeferredRepeatingTask;
pub use crate::posix_signal_handle as PosixSignalHandle;
pub use PosixSignalHandle::PosixSignalTask;
pub use bun_event_loop::mini_event_loop as MiniEventLoop;
pub use MiniEventLoop::{MiniVM, JsVM, EventLoopKind, AbstractVM};
pub use crate::event_loop_handle::{EventLoopHandle, EventLoopTask, EventLoopTaskPtr};
pub use bun_threading::work_pool::{WorkPool, Task as WorkPoolTask};

use crate::task::tick_queue_with_count;

bun_output::declare_scope!(EventLoop, hidden);

// TODO(port): bun.LinearFifo(Task, .Dynamic) — std.fifo.LinearFifo; needs bun_collections::LinearFifo<T>
pub type Queue = bun_collections::LinearFifo<Task>;

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
    pub immediate_tasks: Vec<*mut Timer::ImmediateObject>,
    pub next_immediate_tasks: Vec<*mut Timer::ImmediateObject>,

    pub concurrent_tasks: ConcurrentTask::Queue,
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
    pub imminent_gc_timer: AtomicPtr<Timer::WTFTimer>,

    #[cfg(unix)]
    // TODO(port): lifetime — ?*PosixSignalHandle
    pub signal_handler: Option<NonNull<PosixSignalHandle::PosixSignalHandle>>,
    #[cfg(not(unix))]
    pub signal_handler: (),
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

impl EventLoop {
    /// Before your code enters JavaScript at the top of the event loop, call
    /// `loop.enter()`. If running a single callback, prefer `runCallback` instead.
    ///
    /// When we call into JavaScript, we must drain process.nextTick & microtasks
    /// afterwards (so that promises run). We must only do that once per task in the
    /// event loop. To make that work, we count enter/exit calls and once that
    /// counter reaches 0, we drain the microtasks.
    ///
    /// This function increments the counter for the number of times we've entered
    /// the event loop.
    pub fn enter(&mut self) {
        bun_output::scoped_log!(EventLoop, "enter() = {}", self.entered_event_loop_count);
        self.entered_event_loop_count += 1;
        self.debug.enter();
    }

    /// "exit" a microtask context in the event loop.
    ///
    /// See the documentation for `enter` for more information.
    pub fn exit(&mut self) {
        let count = self.entered_event_loop_count;
        bun_output::scoped_log!(EventLoop, "exit() = {}", count - 1);

        if count == 1 && !self.vm().is_inside_deferred_task_queue {
            let _ = self.drain_microtasks_with_global(self.global_ref(), self.vm().jsc_vm);
        }

        self.entered_event_loop_count -= 1;
        self.debug.exit();
        // PORT NOTE: reshaped for borrowck — Zig `defer this.debug.exit()` moved to tail; no early returns in body
    }

    pub fn exit_maybe_drain_microtasks(&mut self, allow_drain_microtask: bool) -> Result<(), JsTerminated> {
        let count = self.entered_event_loop_count;
        bun_output::scoped_log!(EventLoop, "exit() = {}", count - 1);

        let result = if allow_drain_microtask && count == 1 && !self.vm().is_inside_deferred_task_queue {
            self.drain_microtasks_with_global(self.global_ref(), self.vm().jsc_vm)
        } else {
            Ok(())
        };

        self.entered_event_loop_count -= 1;
        self.debug.exit();
        // PORT NOTE: reshaped for borrowck — `defer this.debug.exit()` + decrement moved to tail; result captured before
        result
    }

    #[inline]
    pub fn get_vm_impl(&self) -> &mut VirtualMachine {
        self.vm()
    }

    pub fn pipe_read_buffer(&self) -> &mut [u8] {
        self.vm().rare_data().pipe_read_buffer()
    }

    pub fn tick_while_paused(&mut self, done: &mut bool) {
        while !*done {
            self.vm().event_loop_handle.as_mut().unwrap().tick();
        }
    }

    pub fn drain_microtasks_with_global(
        &mut self,
        global_object: &JSGlobalObject,
        jsc_vm: &jsc::VM,
    ) -> Result<(), JsTerminated> {
        // During spawnSync, the isolated event loop shares the same VM/GlobalObject.
        // Draining microtasks would execute user JavaScript, which must not happen.
        if self.vm().suppress_microtask_drain {
            return Ok(());
        }

        jsc::mark_binding(core::panic::Location::caller());
        jsc_vm.release_weak_refs();

        // SAFETY: global_object is a valid live JSGlobalObject (borrowed from VM)
        match unsafe { JSC__JSGlobalObject__drainMicrotasks(global_object as *const _ as *mut _) } {
            DrainMicrotasksResult::Success => {}
            DrainMicrotasksResult::JsTerminated => return Err(JsTerminated::JSTerminated),
        }

        self.vm().is_inside_deferred_task_queue = true;
        self.deferred_tasks.run();
        self.vm().is_inside_deferred_task_queue = false;

        if self.vm().event_loop_handle.is_some() {
            self.vm().uws_loop().drain_quic_if_necessary();
        }

        #[cfg(debug_assertions)]
        {
            self.debug.drain_microtasks_count_outside_tick_queue +=
                (!self.debug.is_inside_tick_queue) as usize;
        }

        Ok(())
    }

    pub fn drain_microtasks(&mut self) -> Result<(), JsTerminated> {
        self.drain_microtasks_with_global(self.global_ref(), self.vm().jsc_vm)
    }

    // should be called after exit()
    pub fn maybe_drain_microtasks(&mut self) {
        if self.entered_event_loop_count == 0 && !self.vm().is_inside_deferred_task_queue {
            let _ = self.drain_microtasks_with_global(self.global_ref(), self.vm().jsc_vm);
        }
    }

    /// When you call a JavaScript function from outside the event loop task
    /// queue
    ///
    /// It has to be wrapped in `runCallback` to ensure that microtasks are
    /// drained and errors are handled.
    ///
    /// Otherwise, you will risk a large number of microtasks being queued and
    /// not being drained, which can lead to catastrophic memory usage and
    /// application slowdown.
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
        // PORT NOTE: reshaped for borrowck — `defer this.exit()` moved to tail; no early returns in body
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

    pub fn tick_immediate_tasks(&mut self, virtual_machine: &mut VirtualMachine) {
        let mut to_run_now = core::mem::take(&mut self.immediate_tasks);

        self.immediate_tasks = core::mem::take(&mut self.next_immediate_tasks);
        // self.next_immediate_tasks is now empty (Vec::default())

        let mut exception_thrown = false;
        for task in to_run_now.iter() {
            // SAFETY: ImmediateObject pointers are kept alive by JS heap until runImmediateTask consumes them
            exception_thrown = unsafe { (**task).run_immediate_task(virtual_machine) };
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
                // next dropped here (deinit)
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

    fn tick_concurrent(&mut self) {
        let _ = self.tick_concurrent_with_count();
    }

    /// Check whether refConcurrently has been called but the change has not yet been applied to the
    /// underlying event loop's `active` counter
    pub fn has_pending_refs(&self) -> bool {
        self.concurrent_ref.load(Ordering::SeqCst) > 0
    }

    fn update_counts(&mut self) {
        let delta = self.concurrent_ref.swap(0, Ordering::SeqCst);
        let loop_ = self.vm().event_loop_handle.as_mut().unwrap();
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
                loop_.num_polls += i32::try_from(delta).unwrap();
                loop_.active = loop_.active.saturating_add(u32::try_from(delta).unwrap());
            } else {
                loop_.num_polls -= i32::try_from(-delta).unwrap();
                loop_.active = loop_.active.saturating_sub(u32::try_from(-delta).unwrap());
            }
        }
    }

    pub fn run_imminent_gc_timer(&mut self) {
        let ptr = self.imminent_gc_timer.swap(core::ptr::null_mut(), Ordering::SeqCst);
        if !ptr.is_null() {
            // SAFETY: non-null pointer was stored by WTFTimer scheduling; valid until run() consumes it
            unsafe { (*ptr).run(self.vm()) };
        }
    }

    pub fn tick_concurrent_with_count(&mut self) -> usize {
        self.update_counts();

        #[cfg(unix)]
        {
            if let Some(signal_handler) = self.signal_handler {
                // SAFETY: signal_handler is a valid live PosixSignalHandle owned by VM
                unsafe { signal_handler.as_ptr().as_mut().unwrap().drain(self) };
                // TODO(port): lifetime — overlapping &mut self and signal_handler; may need raw-ptr reshaping
            }
        }

        self.run_imminent_gc_timer();

        let mut concurrent = self.concurrent_tasks.pop_batch();
        let count = concurrent.count;
        if count == 0 {
            return 0;
        }

        let mut iter = concurrent.iterator();
        let start_count = self.tasks.count;
        if start_count == 0 {
            self.tasks.head = 0;
        }

        self.tasks.ensure_unused_capacity(count).expect("unreachable");
        let mut writable = self.tasks.writable_slice(0);

        // Defer destruction of the ConcurrentTask to avoid issues with pointer aliasing
        let mut to_destroy: Option<*mut ConcurrentTask::ConcurrentTask> = None;

        while let Some(task) = iter.next() {
            if let Some(dest) = to_destroy.take() {
                // SAFETY: dest was returned by iterator and marked auto_delete; uniquely owned here
                unsafe { (*dest).deinit() };
            }

            if task.auto_delete() {
                to_destroy = Some(task as *mut _);
            }

            writable[0] = task.task;
            writable = &mut writable[1..];
            self.tasks.count += 1;
            if writable.is_empty() {
                break;
            }
        }

        if let Some(dest) = to_destroy {
            // SAFETY: see above
            unsafe { (*dest).deinit() };
        }

        self.tasks.count - start_count
    }

    pub fn usockets_loop(&self) -> &mut uws::Loop {
        #[cfg(windows)]
        {
            // SAFETY: uws_loop is set in ensure_waker before any caller reaches here
            return unsafe { self.uws_loop.unwrap().as_mut() };
        }
        #[cfg(not(windows))]
        {
            self.vm().event_loop_handle.as_mut().unwrap()
        }
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
        // On POSIX, pending immediates are handled via an immediate timeout in
        // getTimeout() instead of writing to the eventfd, avoiding that overhead.

        #[cfg(unix)]
        {
            // Some tasks need to keep the event loop alive for one more tick.
            // We want to keep the event loop alive long enough to process those ticks and any microtasks
            //
            // BUT. We don't actually have an idle event in that case.
            // That means the process will be waiting forever on nothing.
            // So we need to drain the counter immediately before entering uSockets loop
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
            let mut event_loop_sleep_timer = std::time::Instant::now();
            // TODO(port): std.time.Timer — using Instant; verify equivalent semantics
            // for the printer, this is defined:
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
                bun_output::scoped_log!(
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
                bun_output::scoped_log!(EventLoop, "tickWithoutIdle");
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
        // On POSIX, pending immediates are handled via an immediate timeout in
        // getTimeout() instead of writing to the eventfd, avoiding that overhead.

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

    pub fn process_gc_timer(&mut self) {
        self.vm().gc_controller.process_gc_timer();
    }

    pub fn tick(&mut self) {
        jsc::mark_binding(core::panic::Location::caller());
        let mut scope = jsc::TopExceptionScope::init(self.global_ref(), core::panic::Location::caller());
        // PORT NOTE: TopExceptionScope::deinit handled by Drop
        self.entered_event_loop_count += 1;
        self.debug.enter();
        // PORT NOTE: reshaped for borrowck — Zig `defer { entered_event_loop_count -= 1; debug.exit() }`
        // is inlined at each return site below (scopeguard would alias &mut self).

        let ctx = self.vm();
        self.tick_concurrent();
        self.process_gc_timer();

        let global = ctx.global;
        let global_vm = ctx.jsc_vm;

        loop {
            // Zig: while (tickWithCount > 0) : (handleRejectedPromises) { tickConcurrent } else { ... }
            while self.tick_with_count(ctx) > 0 {
                self.tick_concurrent();
                self.global_ref().handle_rejected_promises();
            }
            // Zig while-else: else branch runs whenever the condition becomes false
            // (including after one or more iterations) — no `entered_body` gate.
            if self.drain_microtasks_with_global(global, global_vm).is_err() {
                self.entered_event_loop_count -= 1;
                self.debug.exit();
                return;
            }
            if scope.has_exception() {
                self.entered_event_loop_count -= 1;
                self.debug.exit();
                return;
            }
            self.tick_concurrent();
            if self.tasks.count > 0 {
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
    /// Used by SpawnSyncEventLoop to process I/O completion tasks (pipe read/write,
    /// process exit) without running user JavaScript via the global microtask queue.
    ///
    /// `tickQueueWithCount` unconditionally calls `drainMicrotasksWithGlobal` after
    /// every task (Task.zig), which drains the shared JSC microtask queue and can
    /// execute arbitrary user JS. This method sets a flag to suppress that drain.
    pub fn tick_tasks_only(&mut self) {
        self.tick_concurrent();

        let vm = self.vm();
        let prev = vm.suppress_microtask_drain;
        vm.suppress_microtask_drain = true;

        while self.tick_with_count(vm) > 0 {
            self.tick_concurrent();
        }

        vm.suppress_microtask_drain = prev;
        // PORT NOTE: reshaped for borrowck — `defer vm.suppress_microtask_drain = prev` moved to tail; no early returns
    }

    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        let jsc_vm = self.vm().jsc_vm;
        match promise.status() {
            jsc::PromiseStatus::Pending => {
                while promise.status() == jsc::PromiseStatus::Pending {
                    // If execution is forbidden (e.g. due to a timeout in vm.SourceTextModule.evaluate),
                    // the Promise callbacks can never run, so we must exit to avoid an infinite loop.
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
        let worker = self
            .vm()
            .worker
            .as_ref()
            .unwrap_or_else(|| panic!("EventLoop.waitForPromiseWithTermination: worker is not initialized"));
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

    pub fn enqueue_task(&mut self, task: Task) {
        self.tasks.write_item(task).expect("unreachable");
    }

    pub fn enqueue_immediate_task(&mut self, task: *mut Timer::ImmediateObject) {
        self.immediate_tasks.push(task);
    }

    pub fn ensure_waker(&mut self) {
        jsc::mark_binding(core::panic::Location::caller());
        if self.vm().event_loop_handle.is_none() {
            #[cfg(windows)]
            {
                self.uws_loop = NonNull::new(uws::Loop::get());
                self.vm().event_loop_handle = Some(Async::Loop::get());
            }
            #[cfg(not(windows))]
            {
                self.vm().event_loop_handle = Some(Async::Loop::get());
            }

            self.vm().gc_controller.init(self.vm());
            // _ = actual.addPostHandler(*jsc.EventLoop, this, jsc.EventLoop.afterUSocketsTick);
            // _ = actual.addPreHandler(*jsc.VM, this.virtual_machine.jsc_vm, jsc.VM.drainMicrotasks);
        }
        #[cfg(windows)]
        {
            if self.uws_loop.is_none() {
                self.uws_loop = NonNull::new(uws::Loop::get());
            }
        }
        uws::Loop::get()
            .internal_loop_data
            .set_parent_event_loop(EventLoopHandle::init(self));
    }

    /// Asynchronously run the garbage collector and track how much memory is now allocated
    pub fn perform_gc(&mut self) {
        self.vm().gc_controller.perform_gc();
    }

    pub fn wakeup(&self) {
        #[cfg(windows)]
        {
            if let Some(loop_) = self.uws_loop {
                // SAFETY: uws_loop is a valid live uws::Loop handle
                unsafe { loop_.as_ref().wakeup() };
            }
            return;
        }
        #[cfg(not(windows))]
        {
            if let Some(loop_) = self.vm().event_loop_handle.as_ref() {
                loop_.wakeup();
            }
        }
    }

    pub fn enqueue_task_concurrent(&self, task: *mut ConcurrentTask::ConcurrentTask) {
        if cfg!(debug_assertions) {
            if self.vm().has_terminated {
                panic!("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }

        #[cfg(debug_assertions)]
        {
            // SAFETY: task is non-null and valid (caller contract)
            bun_output::scoped_log!(
                EventLoop,
                "enqueueTaskConcurrent({})",
                bstr::BStr::new(unsafe { (*task).task.type_name() }.unwrap_or(b"[unknown]"))
            );
        }

        self.concurrent_tasks.push(task);
        self.wakeup();
    }

    pub fn enqueue_task_concurrent_batch(&self, batch: ConcurrentTask::QueueBatch) {
        // TODO(port): ConcurrentTask.Queue.Batch type path — using QueueBatch placeholder
        if cfg!(debug_assertions) {
            if self.vm().has_terminated {
                panic!("EventLoop.enqueueTaskConcurrent: VM has terminated");
            }
        }

        #[cfg(debug_assertions)]
        {
            bun_output::scoped_log!(EventLoop, "enqueueTaskConcurrentBatch({})", batch.count);
        }

        self.concurrent_tasks.push_batch(batch.front.unwrap(), batch.last.unwrap());
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

        // Get num_polls from uws loop (POSIX) or active_handles from libuv (Windows)
        #[cfg(windows)]
        let num_polls: i32 = i32::try_from(bun_sys::windows::libuv::Loop::get().active_handles).unwrap();
        #[cfg(not(windows))]
        let num_polls: i32 = uws::Loop::get().num_polls;
        result.put(global_object, ZigString::static_(b"numPolls"), JSValue::js_number(num_polls));

        Ok(result)
    }

    // ──────────── private helpers (port-only; not in Zig) ────────────
    // TODO(port): lifetime — these unwrap NonNull backrefs. Phase B should replace with proper borrow plumbing.
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
    let vm = global.bun_vm();
    let loop_ = vm.event_loop();
    loop_.run_callback(callback, global, this_value, &[arg0]);
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
    let vm = global.bun_vm();
    let loop_ = vm.event_loop();
    loop_.run_callback(callback, global, this_value, &[arg0, arg1]);
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
    let vm = global.bun_vm();
    let loop_ = vm.event_loop();
    loop_.run_callback(callback, global, this_value, &[arg0, arg1, arg2]);
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
//   todos:      12
//   notes:      LIFETIMES.tsv had no rows — backref ptrs (global/virtual_machine) use NonNull + helper accessors; tick() defer inlined at return sites (Phase B borrowck review for vm()/ctx aliasing); LinearFifo<Task> needs bun_collections impl.
// ──────────────────────────────────────────────────────────────────────────
