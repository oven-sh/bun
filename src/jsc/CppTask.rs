use crate::{JSGlobalObject, JsResult};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

unsafe extern "C" {
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
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
}

/// A task created from C++ code that runs inside the workpool (WebCrypto's
/// `PhonyWorkQueue`). Holds the creating VM's ticket: the C++ closure captures
/// context-affine objects and posts its result back by context id.
#[repr(C)]
pub struct ConcurrentCppTask {
    pub(crate) cpp_task: *mut EventLoopTaskNoContext,
    pub(crate) ticket: crate::Ticket,
    pub(crate) workpool_task: WorkPoolTask,
}

bun_threading::owned_task!(ConcurrentCppTask, workpool_task);

impl ConcurrentCppTask {
    #[allow(clippy::boxed_local)] // `owned_task!`'s required signature
    fn run_owned(self: Box<Self>) {
        let ConcurrentCppTask {
            cpp_task, ticket, ..
        } = *self;
        // SAFETY: `cpp_task` is the valid C++ handle stored by `ConcurrentCppTask__createAndRun`;
        // `run` consumes it here.
        unsafe { EventLoopTaskNoContext::run(cpp_task) };
        ticket.unref_keep_alive();
    }
}

/// JS thread (`PhonyWorkQueue::dispatch`).
#[unsafe(no_mangle)]
extern "C" fn ConcurrentCppTask__createAndRun(
    global: &JSGlobalObject,
    cpp_task: *mut EventLoopTaskNoContext,
) {
    crate::mark_binding!();
    let vm = global.bun_vm();
    vm.event_loop_shared().ref_keep_alive();
    let ticket = vm.ticket();
    WorkPool::schedule_new(ConcurrentCppTask {
        cpp_task,
        ticket,
        workpool_task: WorkPoolTask::default(),
    });
}
