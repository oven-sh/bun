use core::ptr::NonNull;

use crate::job::{Completion, Job, JobContext, JsThread};
use crate::{JSGlobalObject, JsResult};
use bun_event_loop::{TaskTag, Taskable, task_tag};

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
    /// A `WebCore::EventLoopTask`: C++ posted it to a context and checks that context there.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
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

bun_opaque::opaque_ffi! {
    /// WebCrypto's `Bun::WorkQueueTask` (PhonyWorkQueue.h): an operation for the pool and the
    /// completion that takes its result.
    pub struct WorkQueueTask;
}

unsafe extern "C" {
    fn Bun__WorkQueueTask__run(task: *mut WorkQueueTask);
    fn Bun__WorkQueueTask__complete(task: *mut WorkQueueTask);
    fn Bun__WorkQueueTask__destroy(task: *mut WorkQueueTask);
}

/// The C++ half of a [`WorkQueueJob`]. A pool thread runs its operation; the completion in it,
/// and its destructor, stay on the JS thread.
struct OwnedWorkQueueTask(NonNull<WorkQueueTask>);
// SAFETY: off the JS thread only `Bun__WorkQueueTask__run` touches it (the operation and the slot
// for its result, which hold no script state), while the job's ticket keeps the VM alive.
unsafe impl Send for OwnedWorkQueueTask {}
impl Drop for OwnedWorkQueueTask {
    fn drop(&mut self) {
        // SAFETY: owned; a `Job` drops its halves on the JS thread.
        unsafe { Bun__WorkQueueTask__destroy(self.0.as_ptr()) }
    }
}

/// One operation of WebCrypto's work queue (`PhonyWorkQueue::dispatch`).
struct WorkQueueJob;

impl JobContext for WorkQueueJob {
    type OffThread = OwnedWorkQueueTask;
    type Js = ();

    fn run(task: &mut OwnedWorkQueueTask, done: Completion<Self>) -> Option<Completion<Self>> {
        // Script is the only consumer of the result. A VM that is stopping releases the task unrun.
        if done.ticket().script_allowed() {
            // SAFETY: the job is live until its completion is taken on the JS thread.
            unsafe { Bun__WorkQueueTask__run(task.0.as_ptr()) };
        }
        Some(done)
    }

    fn then(task: OwnedWorkQueueTask, (): (), cx: &JsThread<'_>) -> JsResult<()> {
        // SAFETY: JS thread; `task` is dropped after the call.
        crate::from_js_host_call_generic(cx.global(), || unsafe {
            Bun__WorkQueueTask__complete(task.0.as_ptr())
        })
    }
}

/// JS thread (`PhonyWorkQueue::schedule`).
#[unsafe(no_mangle)]
extern "C" fn Bun__WorkQueueTask__schedule(global: &JSGlobalObject, task: NonNull<WorkQueueTask>) {
    crate::mark_binding!();
    // The job carries no realm: the VM's global, whichever global called.
    let cx = global.bun_vm().global().js_thread_of_caller();
    Job::<WorkQueueJob>::schedule(&cx, OwnedWorkQueueTask(task), ());
}
