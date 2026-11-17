use bun_event_loop::{TaskTag, Taskable, task_tag};

use crate::virtual_machine::VirtualMachine;
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
    /// `JSCTaskScheduler::runPendingWork` checks the graph that scheduled the work.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
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
    /// The C++ side reports what a job throws at its own boundary; what can
    /// still be pending here is the VM's termination.
    pub fn run(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        crate::call_check_slow(global, || Bun__runDeferredWork(self))
    }
}

/// JSC helper threads (DeferredWorkTimer): deliver a deferred-work job to the
/// VM's `kind` loop (captured by `JSCTaskScheduler::onAddPendingWork` on the JS
/// thread when the work was registered). Returns whether the VM took it.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    r: *const crate::vm_handle::Shared,
    task: *mut JSCDeferredWorkTask,
    kind: crate::LoopKind,
) -> bool {
    crate::mark_binding!();
    // SAFETY: C++ passes the reference its JSVMClientData holds.
    let handle = unsafe { crate::VmHandle::borrow_ref(r) };
    matches!(handle.post(kind, task), crate::Posted::Queued)
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
