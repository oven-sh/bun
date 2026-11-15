use bun_event_loop::{BoxedTask, ConcurrentTask::ConcurrentTask, TaskTag, task_tag};

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC deferred work task. A `Box` of it owns the C++ job.
    pub struct JSCDeferredWorkTask;
}

impl BoxedTask for JSCDeferredWorkTask {
    const TAG: TaskTag = task_tag::JSCDeferredWorkTask;
    /// A cross-thread Atomics.notify / Wasm / FinalizationRegistry completion:
    /// delete the C++ job (its `Ref<Ticket>` drops before ~VM).
    fn release_unrun(self: Box<Self>) {}
    /// `JSCTaskScheduler::runPendingWork` checks the graph that scheduled the work.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

unsafe extern "C" {
    fn Bun__runDeferredWork(task: *mut JSCDeferredWorkTask);
    fn Bun__deleteDeferredWorkTask(task: *mut JSCDeferredWorkTask);
}

impl Drop for JSCDeferredWorkTask {
    fn drop(&mut self) {
        // SAFETY: only the box that `onScheduleWorkSoon` handed over drops one.
        unsafe { Bun__deleteDeferredWorkTask(self) };
    }
}

impl JSCDeferredWorkTask {
    /// The C++ side reports what a job throws at its own boundary; what can
    /// still be pending here is the VM's termination.
    pub fn run(self: Box<Self>, global: &JSGlobalObject) -> JsResult<()> {
        // SAFETY: C++ deletes the job that the box owned.
        crate::call_check_slow(global, || unsafe {
            Bun__runDeferredWork(bun_core::heap::into_raw(self))
        })
    }
}

/// JSC helper threads (DeferredWorkTimer): deliver a deferred-work job to the
/// VM's `kind` loop (captured by `JSCTaskScheduler::onAddPendingWork` on the JS
/// thread when the work was registered), or run its release path here if the
/// VM is gone.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    r: *const crate::vm_handle::Shared,
    task: Box<JSCDeferredWorkTask>,
    kind: crate::LoopKind,
) {
    crate::mark_binding!();
    // SAFETY: C++ passes the reference its JSVMClientData holds.
    let handle = unsafe { crate::VmHandle::borrow_ref(r) };
    let ct = ConcurrentTask::create_boxed(task);
    if let crate::Posted::Refused(ct) = handle.post(kind, ct) {
        // SAFETY: the task made above. Its ticket was already cancelled by the VM teardown.
        drop(unsafe { ct.task.into_boxed::<JSCDeferredWorkTask>() });
    }
}

/// # Safety
/// `paused` must point to a live `bool`; C++ writes `true` through it from a
/// callback inside `tick()`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__tickWhilePaused(paused: *mut bool) {
    crate::mark_binding!();
    // SAFETY: see fn contract.
    unsafe {
        VirtualMachine::get()
            .event_loop()
            .tick_while_paused(paused.cast_const());
    }
}
