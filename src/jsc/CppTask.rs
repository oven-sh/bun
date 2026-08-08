use crate::{JSGlobalObject, JsResult};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

#[allow(improper_ctypes)] // `Shared` is opaque to C++ (`BunVmHandleRef`)
unsafe extern "C" {
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
    safe fn Bun__EventLoopTaskNoContext__vmHandle(
        task: &EventLoopTaskNoContext,
    ) -> *const crate::vm_handle::Shared;
}

bun_opaque::opaque_ffi! {
    /// A task created from C++ code, usually via ScriptExecutionContext.
    pub struct CppTask;
}

impl Taskable for CppTask {
    const TAG: TaskTag = task_tag::CppTask;
    /// Delete the `WebCore::EventLoopTask` — its captured `Ref`s drop against
    /// the still-live heap.
    unsafe fn release_unrun(this: *mut Self) {
        unsafe extern "C" {
            fn Bun__deleteEventLoopTask(task: *mut CppTask);
        }
        // SAFETY: fn contract; every CppTask payload is a heap EventLoopTask.
        unsafe { Bun__deleteEventLoopTask(this) }
    }
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

    /// The handle of the VM this task was created in (a reference the C++
    /// task holds for its lifetime).
    pub(crate) fn vm_handle(&self) -> crate::vm_handle::BorrowedRef {
        // SAFETY: C++ stores a `BunVmHandleRef` from `Bun__VmHandle__retainRef`
        // for the task's whole lifetime.
        unsafe { crate::VmHandle::borrow_ref(Bun__EventLoopTaskNoContext__vmHandle(self)) }
    }
}

/// A task created from C++ code that runs inside the workpool, usually via ScriptExecutionContext.
#[repr(C)]
pub struct ConcurrentCppTask {
    pub(crate) cpp_task: *mut EventLoopTaskNoContext,
    pub(crate) workpool_task: WorkPoolTask,
}

bun_threading::owned_task!(ConcurrentCppTask, workpool_task);

impl ConcurrentCppTask {
    fn run_owned(self: Box<Self>) {
        // Extract all the info we need from `self` and `cpp_task` before we call functions that
        // free them.
        let cpp_task = self.cpp_task;
        // `EventLoopTaskNoContext` is an `opaque_ffi!` ZST handle; `opaque_ref`
        // is the centralised non-null deref proof. Valid until `run` consumes it.
        // Clone before `run` consumes (and frees) the C++ task that holds the reference.
        let handle: crate::VmHandle = EventLoopTaskNoContext::opaque_ref(cpp_task)
            .vm_handle()
            .clone();
        drop(self);
        // SAFETY: `cpp_task` is the valid C++ handle stored by `ConcurrentCppTask__createAndRun`;
        // `opaque_ref` above proved it non-null and it has not yet been freed — `run` consumes it here.
        unsafe { EventLoopTaskNoContext::run(cpp_task) };
        handle.unref_keep_alive(crate::LoopKind::Regular);
    }
}

#[unsafe(no_mangle)]
extern "C" fn ConcurrentCppTask__createAndRun(cpp_task: *mut EventLoopTaskNoContext) {
    crate::mark_binding!();
    // `EventLoopTaskNoContext` is an `opaque_ffi!` ZST handle; `opaque_ref` is
    // the centralised non-null deref proof. C++ just handed it over.
    EventLoopTaskNoContext::opaque_ref(cpp_task)
        .vm_handle()
        .ref_keep_alive(crate::LoopKind::Regular);
    WorkPool::schedule_new(ConcurrentCppTask {
        cpp_task,
        workpool_task: WorkPoolTask::default(),
    });
}
