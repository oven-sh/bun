use core::ptr::NonNull;

use crate::{JSGlobalObject, JsResult, VirtualMachineRef as VirtualMachine};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
    safe fn Bun__EventLoopTaskNoContext__createdInBunVm(
        task: &EventLoopTaskNoContext,
    ) -> *mut VirtualMachine;
    safe fn Bun__EventLoopTaskNoContext__contextIdentifier(task: &EventLoopTaskNoContext) -> u32;
    // safe: u32 in; resolves under the contexts-map lock, no-op if gone/terminating.
    safe fn ScriptExecutionContext__unrefEventLoopConcurrently(id: u32);
}

bun_opaque::opaque_ffi! {
    /// A task created from C++ code, usually via ScriptExecutionContext.
    pub struct CppTask;
}

impl Taskable for CppTask {
    const TAG: TaskTag = task_tag::CppTask;
}

impl CppTask {
    pub fn run(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        crate::mark_binding!();
        // SAFETY: self is a valid C++ EventLoopTask; global outlives the call.
        //
        // `Bun__performTask` is `[[ZIG_EXPORT(check_slow)]]` — the task body
        // (a `ScriptExecutionContext::postTask` lambda) may declare its own
        // throw scope (e.g. `JSUint8Array::create`, `JSC::call`) without an
        // enclosing one, so we must go through the generated `cpp::` wrapper
        // (which opens a `TopExceptionScope` and `return_if_exception`s) rather
        // than the raw FFI. Calling the raw extern left the simulated throw
        // unchecked, which then tripped `drainMicrotasks`'s scope ctor under
        // `BUN_JSC_validateExceptionChecks=1`.
        unsafe { crate::cpp::Bun__performTask(global, std::ptr::from_mut::<CppTask>(self)) }
    }
}

bun_opaque::opaque_ffi! { pub struct EventLoopTaskNoContext; }

impl EventLoopTaskNoContext {
    /// Deallocates `this`
    pub unsafe fn run(this: *mut EventLoopTaskNoContext) {
        // SAFETY: caller guarantees `this` is a valid C++ EventLoopTaskNoContext; performTask consumes/frees it.
        unsafe { Bun__EventLoopTaskNoContext__performTask(this) }
    }

    /// The VM that created this task. Only safe to dereference on that VM's JS
    /// thread; worker VMs are freed by `terminate()`.
    pub fn get_vm(&self) -> Option<bun_ptr::BackRef<VirtualMachine>> {
        NonNull::new(Bun__EventLoopTaskNoContext__createdInBunVm(self)).map(bun_ptr::BackRef::from)
    }

    /// The creating context's `ScriptExecutionContextIdentifier`, for the
    /// pool-thread checked unref in [`ConcurrentCppTask::run_owned`].
    pub fn context_identifier(&self) -> u32 {
        Bun__EventLoopTaskNoContext__contextIdentifier(self)
    }
}

/// A task created from C++ code that runs inside the workpool, usually via ScriptExecutionContext.
#[repr(C)]
pub struct ConcurrentCppTask {
    pub cpp_task: *mut EventLoopTaskNoContext,
    pub workpool_task: WorkPoolTask,
}

bun_threading::owned_task!(ConcurrentCppTask, workpool_task);

impl ConcurrentCppTask {
    fn run_owned(self: Box<Self>) {
        // Extract all the info we need from `self` and `cpp_task` before we call functions that
        // free them.
        let cpp_task = self.cpp_task;
        // `EventLoopTaskNoContext` is an `opaque_ffi!` ZST handle; `opaque_ref`
        // is the centralised non-null deref proof. Valid until `run` consumes it.
        let context_id = EventLoopTaskNoContext::opaque_ref(cpp_task).context_identifier();
        drop(self);
        // SAFETY: `cpp_task` is the valid C++ handle stored by `ConcurrentCppTask__createAndRun`;
        // `opaque_ref` above proved it non-null and it has not yet been freed — `run` consumes it here.
        unsafe { EventLoopTaskNoContext::run(cpp_task) };
        // Checked unref: the creating VM may be a worker freed by terminate()
        // while `run` ran; the contexts-map lock serializes with markTerminating().
        ScriptExecutionContext__unrefEventLoopConcurrently(context_id);
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn ConcurrentCppTask__createAndRun(cpp_task: *mut EventLoopTaskNoContext) {
    crate::mark_binding!();
    // `EventLoopTaskNoContext` is an `opaque_ffi!` ZST handle; `opaque_ref` is
    // the centralised non-null deref proof. Runs on the creating VM's JS
    // thread (only caller is `PhonyWorkQueue::dispatch`), so dereferencing
    // the captured VM here is safe; `run_owned`'s unref is the checked one.
    if let Some(vm) = EventLoopTaskNoContext::opaque_ref(cpp_task).get_vm() {
        vm.event_loop_shared().ref_concurrently();
    }
    WorkPool::schedule_new(ConcurrentCppTask {
        cpp_task,
        workpool_task: WorkPoolTask::default(),
    });
}
