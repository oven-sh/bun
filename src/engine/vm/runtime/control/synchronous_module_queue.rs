//! While a module is loaded synchronously, the steps of the loader do not wait for their turn among other microtasks.

use core::ptr::NonNull;

use super::jobs;
use crate::{
    Cx, InternalMicrotask, JsAsyncFunctionGenerator, JsResult, MicrotaskQueue, QueuedTask, Vm,
};

/// What is left in the queue at the end is dropped.
pub struct SynchronousModuleQueueScope(NonNull<Vm>);

impl Drop for SynchronousModuleQueueScope {
    fn drop(&mut self) {
        // SAFETY: made and dropped inside a call that has the `Vm`.
        unsafe { self.0.as_ref() }.close_synchronous_module_queue();
    }
}

impl Vm {
    #[inline(always)]
    pub fn has_synchronous_module_queue(&self) -> bool {
        self.services.control.has_synchronous_module_queue.get()
    }

    pub fn synchronous_module_queue_scope(&self) -> SynchronousModuleQueueScope {
        self.open_synchronous_module_queue();
        SynchronousModuleQueueScope(NonNull::from(self))
    }

    pub fn open_synchronous_module_queue(&self) {
        let state = &self.services.control;
        let mut queues = state.synchronous_module_queues.borrow_mut();
        queues.push(MicrotaskQueue::new());
        state.has_synchronous_module_queue.set(true);
    }

    pub fn close_synchronous_module_queue(&self) {
        let state = &self.services.control;
        let mut queues = state.synchronous_module_queues.borrow_mut();
        queues.pop();
        state.has_synchronous_module_queue.set(!queues.is_empty());
    }

    /// Whether the task belongs there.
    pub(super) fn divert_to_synchronous_module_queue(&self, task: &QueuedTask) -> bool {
        let resumes_module = || {
            let generator = task.context().downcast::<JsAsyncFunctionGenerator>();
            generator.is_some_and(|it| it.is_of_module())
        };
        let queues = self.services.control.synchronous_module_queues.borrow();
        match queues.last() {
            Some(queue)
                if task.job().is_of_module_loader()
                    || (task.job() == InternalMicrotask::AsyncFunctionResume
                        && resumes_module()) =>
            {
                queue.enqueue(*task);
                true
            }
            _ => false,
        }
    }

    fn next_synchronous_module_task(&self) -> Option<QueuedTask> {
        let queues = self.services.control.synchronous_module_queues.borrow();
        queues.last()?.dequeue()
    }
}

impl Cx {
    /// The innermost one. If a task throws, the others run as ordinary microtasks.
    pub fn drain_synchronous_module_queue(&mut self) -> JsResult<()> {
        while let Some(task) = self.next_synchronous_module_task() {
            if let Err(thrown) = jobs::run_out_of_line(self.in_realm(task.global()), &task) {
                while let Some(task) = self.next_synchronous_module_task() {
                    task.queue(self, &task.global());
                }
                return Err(thrown);
            }
        }
        Ok(())
    }
}
