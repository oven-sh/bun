use core::ffi::c_void;
use core::ptr::NonNull;

use bun_event_loop::{TaskTag, Taskable, task_tag};

use crate::{JSGlobalObject, JsResult};

/// A JSC deferred work task (constructed on the C++ side). Deleted on drop.
#[repr(transparent)]
pub struct JSCDeferredWorkTask(NonNull<c_void>);

unsafe extern "C" {
    safe fn Bun__runDeferredWork(task: JSCDeferredWorkTask);
    fn Bun__deleteDeferredWorkTask(task: NonNull<c_void>);
}

impl Drop for JSCDeferredWorkTask {
    fn drop(&mut self) {
        // SAFETY: `self` is the only owner.
        unsafe { Bun__deleteDeferredWorkTask(self.0) }
    }
}

impl Taskable for JSCDeferredWorkTask {
    const TAG: TaskTag = task_tag::JSCDeferredWorkTask;
    type Payload = Self;
    /// A cross-thread Atomics.notify / Wasm / FinalizationRegistry completion:
    /// its `Ref<Ticket>` drops before ~VM.
    fn release_unrun(_: Self) {}
    /// `JSCTaskScheduler::runPendingWork` checks the graph that scheduled the work.
    fn context(_: &Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl JSCDeferredWorkTask {
    /// The C++ side reports what a job throws at its own boundary; what can
    /// still be pending here is the VM's termination.
    pub fn run(self, global: &JSGlobalObject) -> JsResult<()> {
        crate::call_check_slow(global, || Bun__runDeferredWork(self))
    }
}

/// JSC helper threads (DeferredWorkTimer): deliver a deferred-work job to the
/// VM's `kind` loop (captured by `JSCTaskScheduler::onAddPendingWork` on the JS
/// thread when the work was registered).
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    r: *const crate::vm_handle::Shared,
    task: JSCDeferredWorkTask,
    kind: crate::LoopKind,
) {
    crate::mark_binding!();
    // SAFETY: C++ passes the reference its JSVMClientData holds.
    let handle = unsafe { crate::VmHandle::borrow_ref(r) };
    drop(handle.post::<JSCDeferredWorkTask>(kind, task));
}
