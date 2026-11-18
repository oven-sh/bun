use core::alloc::Layout;
use core::cell::{Cell, UnsafeCell};
use core::mem::offset_of;
use core::ops::Deref;
use core::ptr::NonNull;
use std::rc::Rc;

use super::jobs;
use super::microtask::TaskHeader;
use crate::{
    Cx, Exception, Gc, GcFree, GlobalObject, InternalMicrotask, JsResult, QueuedTask, Thrown,
    Value, Visitor, Vm,
};

/// A ring. Positions only grow, and the one of a task is its index in the buffer modulo the capacity.
#[repr(C)]
pub struct MicrotaskQueue {
    buffer: Cell<*mut QueuedTask>,
    /// Zero or a power of two.
    capacity: Cell<usize>,
    start: Cell<usize>,
    end: Cell<usize>,
    /// What the tasks before it refer to has been marked since the marks were last cleared.
    visited_end: Cell<usize>,
    visited_epoch: Cell<u32>,
}

// SAFETY: the `Vm` knows each queue and visits it.
unsafe impl GcFree for MicrotaskQueue {}

impl MicrotaskQueue {
    pub const OFFSET_OF_BUFFER: usize = offset_of!(MicrotaskQueue, buffer);
    pub const OFFSET_OF_CAPACITY: usize = offset_of!(MicrotaskQueue, capacity);
    pub const OFFSET_OF_START: usize = offset_of!(MicrotaskQueue, start);
    pub const OFFSET_OF_END: usize = offset_of!(MicrotaskQueue, end);

    const INITIAL_CAPACITY: usize = 16;
    const RETAINED_CAPACITY: usize = 1024;

    pub(super) const fn new() -> MicrotaskQueue {
        MicrotaskQueue {
            buffer: Cell::new(core::ptr::null_mut()),
            capacity: Cell::new(0),
            start: Cell::new(0),
            end: Cell::new(0),
            visited_end: Cell::new(0),
            visited_epoch: Cell::new(0),
        }
    }

    #[inline(always)]
    pub fn len(&self) -> usize {
        self.end.get() - self.start.get()
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.end.get() == self.start.get()
    }

    pub fn clear(&self) {
        self.start.set(self.end.get());
    }

    /// The capacity is not zero.
    #[inline(always)]
    fn slot(&self, position: usize) -> *mut QueuedTask {
        let index = position & self.capacity.get().wrapping_sub(1);
        self.buffer.get().wrapping_add(index)
    }

    #[inline(always)]
    pub fn enqueue(&self, task: QueuedTask) {
        if self.is_full() {
            self.grow();
        }
        // SAFETY: not any more.
        unsafe { self.enqueue_unchecked(task) }
    }

    #[inline(always)]
    fn is_full(&self) -> bool {
        self.len() == self.capacity.get()
    }

    /// # Safety
    /// It is not full.
    #[inline(always)]
    unsafe fn enqueue_unchecked(&self, task: QueuedTask) {
        let end = self.end.get();
        // SAFETY: in the buffer, and free.
        unsafe { self.slot(end).write(task) };
        self.end.set(end + 1);
    }

    #[inline(always)]
    pub(super) fn dequeue(&self) -> Option<QueuedTask> {
        let start = self.start.get();
        if start == self.end.get() {
            return None;
        }
        self.start.set(start + 1);
        // SAFETY: written by `enqueue`.
        Some(unsafe { QueuedTask::read_words(self.slot(start)) })
    }

    fn peek(&self) -> Option<QueuedTask> {
        // SAFETY: as above.
        (!self.is_empty()).then(|| unsafe { self.slot(self.start.get()).read() })
    }

    fn layout(capacity: usize) -> Layout {
        Layout::array::<QueuedTask>(capacity).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    #[cold]
    #[inline(never)]
    fn grow(&self) {
        let old = self.capacity.get();
        let new = (old * 2).max(Self::INITIAL_CAPACITY);
        // SAFETY: the buffer is full, so a task either stays or moves up by the old capacity, where nothing is yet.
        unsafe {
            let buffer = if old == 0 {
                std::alloc::alloc(Self::layout(new))
            } else {
                let size = Self::layout(new).size();
                std::alloc::realloc(self.buffer.get().cast(), Self::layout(old), size)
            };
            let Some(buffer) = NonNull::new(buffer).map(NonNull::cast::<QueuedTask>) else {
                bun_alloc::out_of_memory()
            };
            if old != 0 {
                let start = self.start.get();
                let first = start & (old - 1);
                let moved = if start & old == 0 {
                    0..first
                } else {
                    first..old
                };
                let source = buffer.add(moved.start);
                source.copy_to_nonoverlapping(source.add(old), moved.len());
            }
            self.buffer.set(buffer.as_ptr());
        }
        self.capacity.set(new);
    }

    fn free_buffer(&self) {
        let capacity = self.capacity.take();
        if capacity != 0 {
            // SAFETY: from `grow`.
            unsafe { std::alloc::dealloc(self.buffer.get().cast(), Self::layout(capacity)) };
        }
    }

    pub(super) fn shrink(&self) {
        if self.is_empty() && self.capacity.get() > Self::RETAINED_CAPACITY {
            self.free_buffer();
        }
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        let (mut first, end) = (self.start.get(), self.end.get());
        if !visitor.is_verifying() {
            let visited_end = self.visited_end.replace(end);
            if self.visited_epoch.replace(visitor.epoch()) == visitor.epoch() {
                first = first.max(visited_end);
            }
        }
        for position in first..end {
            // SAFETY: written by `enqueue`.
            unsafe { &*self.slot(position) }.visit(visitor);
        }
    }

    /// Fails only if execution is terminated.
    ///
    /// # Safety
    /// The caller has the right to run scripts, and keeps the queue alive.
    #[inline(never)]
    unsafe fn run_all(&self, vm: &Vm, is_outermost: bool) -> JsResult<()> {
        while let Some(task) = self.dequeue() {
            let global = task.global();
            if global.discards_microtasks() {
                continue;
            }
            if is_outermost {
                vm.set_entry_global(global);
            }
            // SAFETY: the caller's.
            let cx = unsafe { Cx::from_global(global) };
            if task.is_tracked() {
                let (header, [a, b, c, d]) = task.into_parts();
                run_tracked(cx, header, a, b, c, d)?;
            } else if let Err(thrown) = jobs::run(cx, task) {
                report(cx, thrown)?;
            }
            if let Some(tick) = vm.embedder().microtasks.on_each_tick.get() {
                tick(cx);
                ignore_exception(cx)?;
            }
        }
        Ok(())
    }
}

impl Drop for MicrotaskQueue {
    fn drop(&mut self) {
        self.free_buffer();
    }
}

fn ignore_exception(cx: &Cx) -> JsResult<()> {
    match cx.check_exception() {
        Ok(()) => Ok(()),
        Err(thrown) => cx.catch(thrown).map(drop),
    }
}

#[cold]
#[inline(never)]
fn report(cx: &mut Cx, thrown: Thrown) -> JsResult<()> {
    let exception = cx.catch(thrown)?;
    (cx.global().hooks().report_uncaught_exception)(cx, exception);
    ignore_exception(cx)
}

fn notify_debugger(vm: &Vm, event: MicrotaskEvent, task: &QueuedTask, id: u64) {
    if let Some(debugger) = task.global().debugger() {
        debugger.microtask_event(vm, event, task.job(), id);
    }
}

#[cold]
#[inline(never)]
fn run_tracked(
    cx: &mut Cx,
    header: TaskHeader,
    a: Option<Value>,
    b: Option<Value>,
    c: Option<Value>,
    d: Option<Value>,
) -> JsResult<()> {
    let (task, id) = QueuedTask::from_parts(header, [a, b, c, d]).untracked();
    notify_debugger(cx, MicrotaskEvent::WillRun, &task, id);
    let result = jobs::run_out_of_line(cx, &task).or_else(|thrown| report(cx, thrown));
    notify_debugger(cx, MicrotaskEvent::DidRun, &task, id);
    result
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MicrotaskEvent {
    DidQueue,
    WillRun,
    DidRun,
}

#[derive(Default)]
pub struct MicrotaskHooks {
    pub on_each_tick: Cell<Option<fn(&mut Cx)>>,
    /// For what a `CallInAsyncContext` throws.
    pub report_error: Cell<Option<fn(&mut Cx, Gc<Exception>)>>,
}

/// A counted reference. It is the address of the queue.
#[repr(transparent)]
pub struct MicrotaskQueueRef(NonNull<MicrotaskQueue>);

impl MicrotaskQueueRef {
    pub fn new(vm: &Vm) -> MicrotaskQueueRef {
        let queue = Self::unregistered();
        queue.register(vm);
        queue
    }

    /// # Safety
    /// The address of one that has been forgotten, whose count this takes over.
    pub unsafe fn from_raw(queue: NonNull<MicrotaskQueue>) -> MicrotaskQueueRef {
        MicrotaskQueueRef(queue)
    }

    pub(crate) fn unregistered() -> MicrotaskQueueRef {
        let queue = Rc::into_raw(Rc::new(MicrotaskQueue::new()));
        // SAFETY: not null.
        MicrotaskQueueRef(unsafe { NonNull::new_unchecked(queue.cast_mut()) })
    }

    pub(super) fn register(&self, vm: &Vm) {
        // SAFETY: from `Rc::into_raw`. The count that `self` holds is left alone.
        let queue = core::mem::ManuallyDrop::new(unsafe { Rc::from_raw(self.0.as_ptr()) });
        let mut queues = vm.services.control.queues.borrow_mut();
        queues.push(Rc::downgrade(&queue));
    }

    /// Runs the tasks, and those that they queue. Fails only if execution is terminated, and then drops the rest.
    ///
    /// # Safety
    /// The caller has the right to run scripts, as with a `&mut Cx`.
    pub unsafe fn perform_checkpoint_in(&self, vm: &Vm) -> JsResult<()> {
        if vm.is_execution_forbidden().get() {
            self.clear();
            return Ok(());
        }
        vm.did_enter.set(true);
        let Some(first) = self.peek() else {
            return Ok(());
        };
        let is_outermost = !vm.is_entered();
        if is_outermost {
            vm.will_enter(first.global());
        }
        // SAFETY: the caller's.
        let result = unsafe { self.run_all(vm, is_outermost) };
        if result.is_err() {
            self.clear();
        }
        if is_outermost {
            vm.did_leave();
        }
        result
    }
}

impl Deref for MicrotaskQueueRef {
    type Target = MicrotaskQueue;

    #[inline(always)]
    fn deref(&self) -> &MicrotaskQueue {
        // SAFETY: counted.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for MicrotaskQueueRef {
    fn clone(&self) -> MicrotaskQueueRef {
        // SAFETY: from `Rc::into_raw`, and counted.
        unsafe { Rc::increment_strong_count(self.0.as_ptr()) };
        MicrotaskQueueRef(self.0)
    }
}

impl Drop for MicrotaskQueueRef {
    fn drop(&mut self) {
        // SAFETY: as above.
        unsafe { Rc::decrement_strong_count(self.0.as_ptr()) };
    }
}

/// Where the microtasks of a realm go.
#[repr(transparent)]
pub(crate) struct RealmMicrotaskQueue(UnsafeCell<MicrotaskQueueRef>);

impl RealmMicrotaskQueue {
    pub(crate) fn new(queue: MicrotaskQueueRef) -> RealmMicrotaskQueue {
        RealmMicrotaskQueue(UnsafeCell::new(queue))
    }

    pub(crate) fn get(&self) -> MicrotaskQueueRef {
        // SAFETY: no reference to the content outlives a method of this type.
        unsafe { &*self.0.get() }.clone()
    }

    pub(crate) fn set(&self, queue: MicrotaskQueueRef) {
        // SAFETY: as above.
        unsafe { *self.0.get() = queue };
    }

    #[inline(always)]
    fn enqueue(&self, task: QueuedTask) {
        // SAFETY: as above.
        unsafe { &*self.0.get() }.enqueue(task);
    }

    #[inline(always)]
    fn try_enqueue(&self, task: QueuedTask) -> bool {
        // SAFETY: as above, and only if it is not full.
        unsafe {
            let queue = &*self.0.get();
            !queue.is_full() && {
                queue.enqueue_unchecked(task);
                true
            }
        }
    }
}

/// `global` is that of the task.
impl QueuedTask {
    /// False, having done nothing, if it takes a call.
    #[inline(always)]
    pub(super) fn try_queue_quickly(self, vm: &Vm, global: &GlobalObject) -> bool {
        !vm.has_synchronous_module_queue()
            && !vm.has_debugger()
            && global.realm_microtask_queue().try_enqueue(self)
    }

    #[inline(always)]
    pub(super) fn queue(self, vm: &Vm, global: &GlobalObject) {
        if !self.try_queue_quickly(vm, global) {
            let (header, [a, b, c, d]) = self.into_parts();
            queue_slowly::<false>(vm, header, a, b, c, d);
        }
    }

    /// For the reaction to a promise.
    #[inline(always)]
    pub(super) fn queue_or_divert(self, vm: &Vm, global: &GlobalObject) {
        if !self.try_queue_quickly(vm, global) {
            let (header, [a, b, c, d]) = self.into_parts();
            queue_slowly::<true>(vm, header, a, b, c, d);
        }
    }
}

/// The task comes in registers, so that the callers need no memory for it.
#[cold]
#[inline(never)]
fn queue_slowly<const MAY_DIVERT: bool>(
    vm: &Vm,
    header: TaskHeader,
    a: Option<Value>,
    b: Option<Value>,
    c: Option<Value>,
    d: Option<Value>,
) {
    let task = QueuedTask::from_parts(header, [a, b, c, d]);
    if MAY_DIVERT && vm.divert_to_synchronous_module_queue(&task) {
        return;
    }
    let global = task.global();
    if global.debugger().is_none() {
        return global.realm_microtask_queue().enqueue(task);
    }
    let last_id = &vm.services.control.last_microtask_id;
    last_id.update(|id| id + 1);
    let task = task.tracked(vm, last_id.get());
    global.realm_microtask_queue().enqueue(task);
    notify_debugger(vm, MicrotaskEvent::DidQueue, &task, last_id.get());
}

impl GlobalObject {
    #[inline(always)]
    pub fn queue_microtask(
        &self,
        vm: &Vm,
        job: InternalMicrotask,
        payload: u8,
        arguments: [Value; QueuedTask::MAX_ARGUMENTS],
    ) {
        QueuedTask::new(self.into(), job, payload, arguments.map(Some)).queue(vm, self);
    }
}

impl Vm {
    /// In the default queue, whichever the realm uses.
    #[inline]
    pub fn queue_microtask(&self, task: QueuedTask) {
        self.default_microtask_queue().enqueue(task);
    }

    /// # Safety
    /// As for `MicrotaskQueueRef::perform_checkpoint_in`.
    pub unsafe fn drain_microtasks_unchecked(&self) -> JsResult<()> {
        // SAFETY: the caller's.
        unsafe { self.default_microtask_queue().perform_checkpoint_in(self) }?;
        self.clear_kept_objects();
        Ok(())
    }
}

impl Cx {
    /// Of the default queue. Fails only if execution is terminated.
    pub fn drain_microtasks(&mut self) -> JsResult<()> {
        // SAFETY: borrows the `Cx`.
        unsafe { self.drain_microtasks_unchecked() }
    }
}
