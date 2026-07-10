use core::ptr::NonNull;

use crate::{JSGlobalObject, JsResult, VirtualMachineRef as VirtualMachine};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`CppTask`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `WebCore::EventLoopTask`. `&Self` is ABI-identical to a non-null
        /// `WebCore::EventLoopTask*`, and carries no `noalias`/`readonly` —
        /// C++ runs and destroys the captured `WTF::Function` through it.
        pub struct CppTask;
    }
}

#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
    safe fn Bun__EventLoopTaskNoContext__createdInBunVm(
        task: &EventLoopTaskNoContext,
    ) -> *mut VirtualMachine;
    // safe: C++ `delete task`, without running it. Destroying is not exclusive
    // access in Rust's sense, so the receiver is `&`, matching `UnsafeCell`.
    safe fn Bun__deleteEventLoopTask(task: &sys::CppTask);
}

// The tag describes the C++ pointee stored in `Task.ptr`, not the Rust handle.
impl Taskable for sys::CppTask {
    const TAG: TaskTag = task_tag::CppTask;
}

// C++ `new EventLoopTask` (`ScriptExecutionContext::postTask*`) hands Rust the
// sole owner. `delete` gives it back; so does `performTask` (`delete this`).
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ `WebCore::EventLoopTask` — a task posted from C++,
    /// usually via `ScriptExecutionContext`.
    ///
    /// Holds the sole owner of the heap task; `Drop` deletes it without running.
    /// [`Self::run`] takes `self` instead: `performTask` does `delete this`.
    pub struct CppTask(sys::CppTask) via Bun__deleteEventLoopTask;
}

impl CppTask {
    /// Run the task. Consumes `self`: C++ `performTask` does `delete this`,
    /// on the throwing path too, so the owner is given back exactly once.
    pub fn run(self, global: &JSGlobalObject) -> JsResult<()> {
        crate::mark_binding!();
        let task = self.leak();
        // The task body may open a throw scope with no enclosing one, so go through
        // the generated `cpp::` wrapper, which opens a `TopExceptionScope`.
        // SAFETY: `task` is the live owner we just gave up; C++ deletes it.
        unsafe { crate::cpp::Bun__performTask(global, task.as_ptr().cast()) }
    }
}

bun_opaque::opaque_ffi! { pub struct EventLoopTaskNoContext; }

impl EventLoopTaskNoContext {
    /// Deallocates `this`
    pub unsafe fn run(this: *mut EventLoopTaskNoContext) {
        // SAFETY: caller guarantees `this` is a valid C++ EventLoopTaskNoContext; performTask consumes/frees it.
        unsafe { Bun__EventLoopTaskNoContext__performTask(this) }
    }

    /// Get the VM that created this task. `VirtualMachine` is process-lifetime
    /// (PORTING.md §Global mutable state), so a [`BackRef`] is the right
    /// non-owning handle: callers project `&VirtualMachine` via `Deref` and
    /// route mutation through the VM's safe interior accessors (e.g.
    /// `event_loop_shared()`).
    pub fn get_vm(&self) -> Option<bun_ptr::BackRef<VirtualMachine>> {
        NonNull::new(Bun__EventLoopTaskNoContext__createdInBunVm(self)).map(bun_ptr::BackRef::from)
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
        let maybe_vm = EventLoopTaskNoContext::opaque_ref(cpp_task).get_vm();
        drop(self);
        // SAFETY: `cpp_task` is the valid C++ handle stored by `ConcurrentCppTask__createAndRun`;
        // `opaque_ref` above proved it non-null and it has not yet been freed — `run` consumes it here.
        unsafe { EventLoopTaskNoContext::run(cpp_task) };
        if let Some(vm) = maybe_vm {
            vm.event_loop_shared().unref_concurrently();
        }
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn ConcurrentCppTask__createAndRun(cpp_task: *mut EventLoopTaskNoContext) {
    crate::mark_binding!();
    // `EventLoopTaskNoContext` is an `opaque_ffi!` ZST handle; `opaque_ref` is
    // the centralised non-null deref proof. C++ just handed it over.
    if let Some(vm) = EventLoopTaskNoContext::opaque_ref(cpp_task).get_vm() {
        vm.event_loop_shared().ref_concurrently();
    }
    WorkPool::schedule_new(ConcurrentCppTask {
        cpp_task,
        workpool_task: WorkPoolTask::default(),
    });
}
