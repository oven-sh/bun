use core::ptr::NonNull;

use crate::vm_handle::KeepAliveTicket;
use crate::{JSGlobalObject, JsResult};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

unsafe extern "C" {
    safe fn Bun__performTask(global: &JSGlobalObject, task: OwnedCppTask);
    fn Bun__deleteEventLoopTask(task: NonNull<CppTask>);
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
}

bun_opaque::opaque_ffi! {
    /// A task created from C++ code, usually via ScriptExecutionContext.
    pub struct CppTask;
}

/// Deleted on drop.
#[repr(transparent)]
pub struct OwnedCppTask(NonNull<CppTask>);

impl Drop for OwnedCppTask {
    fn drop(&mut self) {
        // SAFETY: `self` is the only owner.
        unsafe { Bun__deleteEventLoopTask(self.0) }
    }
}

impl Taskable for CppTask {
    const TAG: TaskTag = task_tag::CppTask;
    type Payload = OwnedCppTask;
    /// Its captured `Ref`s drop against the still-live heap.
    fn release_unrun(_: OwnedCppTask) {}
    /// A `WebCore::EventLoopTask`: C++ posted it to a context and checks that context there.
    fn context(_: &OwnedCppTask) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl OwnedCppTask {
    pub fn run(self, global: &JSGlobalObject) -> JsResult<()> {
        crate::mark_binding!();
        // The task may declare a throw scope of its own without an enclosing one.
        crate::top_scope!(scope, global);
        Bun__performTask(global, self);
        scope.return_if_exception()
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
    _ticket: KeepAliveTicket,
    pub(crate) workpool_task: WorkPoolTask,
}

bun_threading::owned_task!(ConcurrentCppTask, workpool_task);

impl ConcurrentCppTask {
    #[allow(clippy::boxed_local)] // `owned_task!`'s required signature
    fn run_owned(self: Box<Self>) {
        // SAFETY: `cpp_task` is the valid C++ handle stored by `ConcurrentCppTask__createAndRun`;
        // `run` consumes it here.
        unsafe { EventLoopTaskNoContext::run(self.cpp_task) };
    }
}

/// JS thread (`PhonyWorkQueue::dispatch`).
#[unsafe(no_mangle)]
extern "C" fn ConcurrentCppTask__createAndRun(
    global: &JSGlobalObject,
    cpp_task: *mut EventLoopTaskNoContext,
) {
    crate::mark_binding!();
    WorkPool::schedule_new(ConcurrentCppTask {
        cpp_task,
        _ticket: global.bun_vm().keep_alive_ticket(),
        workpool_task: WorkPoolTask::default(),
    });
}
