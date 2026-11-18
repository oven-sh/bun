use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::time::Duration;
use std::sync::Arc;

use bun_engine_macros::export;
use bun_engine_vm::{
    Cx, DeferredTask, EventLoop, Exception, Gc, GlobalObject, InternalMicrotask, InternalReaction,
    JsCell, JsFunction, JsObject, JsPromise, JsResult, MicrotaskQueue, MicrotaskQueueRef,
    PromiseCapability, QueuedTask, Shape, Ticket, Value, Vm, WorkKind,
};

use crate::abi::returned_as_pointer;

returned_as_pointer! {
    MicrotaskQueueRef,
}

unsafe extern "C" {
    safe fn engine_host_did_run_microtask(vm: &Vm);
    safe fn engine_host_report_error_of_microtask(cx: &mut Cx, exception: Gc<Exception>);
    fn engine_host_add_pending_work(timer: *mut c_void, ticket: *const Ticket, kind: WorkKind);
    fn engine_host_schedule_work(
        timer: *mut c_void,
        ticket: *const Ticket,
        task: *mut DeferredTask,
    );
    fn engine_host_cancel_pending_work(timer: *mut c_void, ticket: &Ticket);
    fn engine_host_set_timer(timer: *mut c_void, is_armed: bool, seconds: f64);
}

#[export]
fn promise_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsPromise> {
    JsPromise::create(vm, shape)
}

#[export]
fn promise_resolved(cx: &mut Cx, value: Value) -> JsResult<Gc<JsPromise>> {
    JsPromise::resolved(cx, value)
}

#[export]
fn promise_rejected(cx: &Cx, reason: Value) -> Gc<JsPromise> {
    JsPromise::rejected(cx, reason)
}

#[export]
fn promise_capability_create(cx: &mut Cx, constructor: Value) -> JsResult<Value> {
    Ok(PromiseCapability::new(cx, constructor)?
        .to_object(cx)
        .into())
}

/// It throws nothing but the exception that ends execution, which callers need not look for.
#[export]
fn promise_resolve(promise: &JsPromise, cx: &mut Cx, value: Value) {
    let _ = promise.resolve(cx, value);
}

#[export]
fn promise_fulfill(promise: &JsPromise, vm: &Vm, value: Value) {
    promise.fulfill(vm, value);
}

#[export]
fn promise_reject(promise: &JsPromise, vm: &Vm, reason: Value) {
    promise.reject(vm, reason);
}

#[export]
fn promise_reject_as_handled(promise: &JsPromise, vm: &Vm, reason: Value) {
    promise.reject_as_handled(vm, reason);
}

#[export]
fn promise_pipe_from(promise: &JsPromise, vm: &Vm, source: &JsPromise) {
    promise.pipe_from(vm, source);
}

#[export]
fn promise_create_resolve_function(promise: &JsPromise, cx: &Cx) -> Gc<JsFunction> {
    promise.create_resolve_function(cx)
}

#[export]
fn promise_then(
    promise: &JsPromise,
    cx: &mut Cx,
    on_fulfilled: Value,
    on_rejected: Value,
) -> JsResult<Gc<JsObject>> {
    promise.then(cx, on_fulfilled, on_rejected)
}

#[export]
fn promise_perform_then(
    promise: &JsPromise,
    cx: &Cx,
    on_fulfilled: Value,
    on_rejected: Value,
    result: Value,
) {
    promise.perform_then(cx, on_fulfilled, on_rejected, result);
}

#[export]
fn promise_perform_then_with_context(
    promise: &JsPromise,
    cx: &Cx,
    on_fulfilled: Value,
    on_rejected: Value,
    result: Value,
    context: Value,
) {
    promise.perform_then_with_context(cx, on_fulfilled, on_rejected, result, context);
}

#[export]
fn promise_react(
    promise: &JsPromise,
    vm: &Vm,
    task: InternalMicrotask,
    cell: Option<Gc<JsCell>>,
    context: Value,
) {
    promise.react(vm, InternalReaction::new(task, cell, context));
}

#[export]
fn promise_has_pristine_then(promise: &JsPromise, vm: &Vm) -> bool {
    promise.has_pristine_then(vm)
}

// Microtasks

/// # Safety
/// C++ knows only of queues that are counted.
unsafe fn borrowed(queue: *const MicrotaskQueue) -> ManuallyDrop<MicrotaskQueueRef> {
    // SAFETY: the caller's, and the count stays as it is.
    ManuallyDrop::new(unsafe {
        MicrotaskQueueRef::from_raw(NonNull::new_unchecked(queue.cast_mut()))
    })
}

#[export]
fn microtask_queue_create(vm: &Vm) -> MicrotaskQueueRef {
    MicrotaskQueueRef::new(vm)
}

#[export]
unsafe fn microtask_queue_retain(queue: *const MicrotaskQueue) {
    // SAFETY: from C++.
    let _ = ManuallyDrop::new(MicrotaskQueueRef::clone(&*unsafe { borrowed(queue) }));
}

#[export]
unsafe fn microtask_queue_release(queue: *const MicrotaskQueue) {
    // SAFETY: a reference that C++ holds.
    drop(ManuallyDrop::into_inner(unsafe { borrowed(queue) }));
}

#[export]
fn microtask_queue_clear(queue: &MicrotaskQueue) {
    queue.clear();
}

#[export]
unsafe fn microtask_queue_perform_checkpoint(queue: *const MicrotaskQueue, vm: &Vm) {
    // SAFETY: C++ has the right to run scripts, and lends it for the call. A task may give its realm another queue.
    let _ = unsafe { MicrotaskQueueRef::clone(&borrowed(queue)).perform_checkpoint_in(vm) };
}

#[export]
fn vm_default_microtask_queue(vm: &Vm) -> &MicrotaskQueue {
    vm.default_microtask_queue()
}

#[export]
fn vm_queue_microtask(vm: &Vm, task: &QueuedTask) {
    vm.queue_microtask(*task);
}

#[export]
unsafe fn vm_drain_microtasks(vm: &Vm) {
    // SAFETY: as above.
    let _ = unsafe { vm.drain_microtasks_unchecked() };
}

#[export]
fn vm_set_calls_back_after_microtasks(vm: &Vm, calls_back: bool) {
    let tick: fn(&mut Cx) = |cx| engine_host_did_run_microtask(cx);
    (vm.embedder().microtasks.on_each_tick).set(calls_back.then_some(tick));
}

#[export]
fn vm_has_synchronous_module_queue(vm: &Vm) -> bool {
    vm.has_synchronous_module_queue()
}

#[export]
fn vm_open_synchronous_module_queue(vm: &Vm) {
    vm.open_synchronous_module_queue();
}

#[export]
fn vm_close_synchronous_module_queue(vm: &Vm) {
    vm.close_synchronous_module_queue();
}

#[export]
fn drain_synchronous_module_queue(cx: &mut Cx) -> JsResult<()> {
    cx.drain_synchronous_module_queue()
}

#[export]
fn vm_start_tracking_async_context(vm: &Vm) {
    vm.start_tracking_async_context();
}

#[export]
fn global_microtask_queue(global: &GlobalObject) -> *mut MicrotaskQueue {
    core::ptr::from_ref(&*global.microtask_queue()).cast_mut()
}

#[export]
fn global_set_microtask_queue(global: &GlobalObject, queue: MicrotaskQueueRef) {
    global.set_microtask_queue(queue);
}

// Deferred work

/// The `DeferredWorkTimer` of the `Vm`, which goes after the last call.
struct HostEventLoop(*mut c_void);

// SAFETY: its functions are made for the threads that the trait names.
unsafe impl Send for HostEventLoop {}
// SAFETY: as above.
unsafe impl Sync for HostEventLoop {}

impl EventLoop for HostEventLoop {
    fn add_pending_work(&self, ticket: Arc<Ticket>) {
        let kind = ticket.kind();
        // SAFETY: alive. It takes the reference.
        unsafe { engine_host_add_pending_work(self.0, Arc::into_raw(ticket), kind) }
    }

    fn schedule_work(&self, ticket: Arc<Ticket>, task: DeferredTask) {
        let (ticket, task) = (Arc::into_raw(ticket), Box::into_raw(Box::new(task)));
        // SAFETY: alive. It takes both.
        unsafe { engine_host_schedule_work(self.0, ticket, task) }
    }

    fn cancel_pending_work(&self, ticket: &Ticket) {
        // SAFETY: alive.
        unsafe { engine_host_cancel_pending_work(self.0, ticket) }
    }

    fn set_timer(&self, delay: Option<Duration>) {
        let seconds = delay.unwrap_or_default().as_secs_f64();
        // SAFETY: alive.
        unsafe { engine_host_set_timer(self.0, delay.is_some(), seconds) }
    }
}

#[export]
unsafe fn vm_set_event_loop(vm: &Vm, timer: *mut c_void) {
    (vm.embedder().microtasks.report_error).set(Some(|cx, exception| {
        engine_host_report_error_of_microtask(cx, exception);
    }));
    vm.set_event_loop(Arc::new(HostEventLoop(timer)));
}

#[export]
fn vm_run_due_timers(vm: &Vm) {
    vm.run_due_timers();
}

#[export]
unsafe fn ticket_retain(ticket: *const Ticket) {
    // SAFETY: from `Arc::into_raw`, and counted.
    unsafe { Arc::increment_strong_count(ticket) }
}

#[export]
unsafe fn ticket_release(ticket: *const Ticket) {
    // SAFETY: a reference that C++ holds.
    unsafe { Arc::decrement_strong_count(ticket) }
}

#[export]
fn ticket_is_cancelled(ticket: &Ticket) -> bool {
    ticket.is_cancelled()
}

#[export]
fn ticket_target(ticket: &Ticket) -> *mut JsObject {
    core::ptr::with_exposed_provenance_mut(ticket.target_address())
}

#[export]
fn ticket_script_execution_owner(ticket: &Ticket) -> *mut JsObject {
    core::ptr::with_exposed_provenance_mut(ticket.script_execution_owner_address())
}

#[export]
unsafe fn deferred_task_run(task: *mut DeferredTask, cx: &mut Cx, ticket: &Ticket) -> JsResult<()> {
    // SAFETY: from `schedule_work`, and given back.
    unsafe { Box::from_raw(task) }.run(cx, ticket)
}

#[export]
unsafe fn deferred_task_destroy(task: *mut DeferredTask) {
    // SAFETY: as above.
    drop(unsafe { Box::from_raw(task) });
}
