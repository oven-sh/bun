use bun_event_loop::{ConcurrentTask::ConcurrentTask, TaskTag, Taskable, task_tag};

use crate::{JSGlobalObject, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC deferred work task (constructed/owned on the C++ side).
    pub struct JSCDeferredWorkTask;
}

impl Taskable for JSCDeferredWorkTask {
    const TAG: TaskTag = task_tag::JSCDeferredWorkTask;
    /// A cross-thread Atomics.notify / Wasm / FinalizationRegistry completion:
    /// delete the C++ job (its `Ref<Ticket>` drops before ~VM).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; heap-allocated by JSCTaskScheduler::onScheduleWorkSoon.
        unsafe { Bun__deleteDeferredWorkTask(this) }
    }
}

unsafe extern "C" {
    // safe: `JSCDeferredWorkTask` is an `opaque_ffi!` ZST handle (`!Freeze`
    // via `UnsafeCell`); `&mut` is ABI-identical to a non-null `*mut` and the
    // C++ side consuming it is interior to the opaque cell.
    safe fn Bun__runDeferredWork(task: &mut JSCDeferredWorkTask);
    fn Bun__deleteDeferredWorkTask(task: *mut JSCDeferredWorkTask);
}

impl JSCDeferredWorkTask {
    /// Delete the C++ job without running it (its ticket is cancelled with the
    /// DeferredWorkTimer at VM teardown).
    ///
    /// # Safety
    /// `this` is the job handed over by `onScheduleWorkSoon`, not yet run.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Bun__deleteDeferredWorkTask(this) };
    }

    /// The C++ side reports what a job throws at its own boundary; what can
    /// still be pending here is the VM's termination.
    pub fn run(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        crate::call_check_slow(global, || Bun__runDeferredWork(self))
    }
}

/// JSC helper threads (DeferredWorkTimer): deliver a deferred-work job to the
/// VM's `kind` loop (captured by `JSCTaskScheduler::onAddPendingWork` on the JS
/// thread when the work was registered), or run its release path here if the
/// VM is gone.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    r: *const crate::vm_handle::Shared,
    task: *mut JSCDeferredWorkTask,
    kind: crate::LoopKind,
) {
    crate::mark_binding!();
    // SAFETY: C++ passes the reference its JSVMClientData holds.
    let handle = unsafe { crate::VmHandle::borrow_ref(r) };
    // `create_from` heap-allocates with the auto-delete bit set.
    let ct = ConcurrentTask::create_from(task);
    if let crate::vm_handle::Posted::Refused(ct) = handle.post(kind, ct) {
        // SAFETY: refused ⇒ we own the ConcurrentTask box; the C++ job's ticket
        // was already cancelled by the VM teardown (DeferredWorkTimer is shut
        // down before ~VM), so dropping the job pointer here loses nothing.
        drop(unsafe { bun_core::heap::take(ct.as_ptr()) });
        // SAFETY: `task` is the C++ job handed over for exactly one run/destroy.
        unsafe { JSCDeferredWorkTask::destroy(task) };
    }
}
