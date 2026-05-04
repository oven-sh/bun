use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JSGlobalObject, JsResult, VirtualMachine};
use bun_threading::{WorkPool, WorkPoolTask};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    // TODO(port): Zig declares this as `bun.JSError!void` via generated binding; confirm the
    // actual C ABI (likely void with pending exception on the VM) before finalizing.
    pub fn Bun__performTask(global: *mut JSGlobalObject, task: *mut CppTask);
    fn Bun__EventLoopTaskNoContext__performTask(task: *mut EventLoopTaskNoContext);
    fn Bun__EventLoopTaskNoContext__createdInBunVm(
        task: *const EventLoopTaskNoContext,
    ) -> *mut VirtualMachine;
}

/// A task created from C++ code, usually via ScriptExecutionContext.
#[repr(C)]
pub struct CppTask {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl CppTask {
    pub fn run(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        bun_jsc::mark_binding!();
        // SAFETY: self is a valid C++ EventLoopTask; global outlives the call.
        unsafe { Bun__performTask(global as *const _ as *mut _, self as *mut CppTask) };
        // TODO(port): Bun__performTask returns bun.JSError!void in Zig via generated binding;
        // confirm whether the C ABI actually surfaces an error or if this is infallible.
        Ok(())
    }
}

#[repr(C)]
pub struct EventLoopTaskNoContext {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl EventLoopTaskNoContext {
    /// Deallocates `this`
    pub fn run(this: *mut EventLoopTaskNoContext) {
        // SAFETY: `this` is a valid C++ EventLoopTaskNoContext; performTask consumes/frees it.
        unsafe { Bun__EventLoopTaskNoContext__performTask(this) }
    }

    /// Get the VM that created this task
    // TODO(port): VirtualMachine is process-lifetime; revisit `'static` once bun_jsc settles on
    // a borrow convention for VM handles.
    pub fn get_vm(&self) -> Option<&'static mut VirtualMachine> {
        // SAFETY: `self` is a valid C++ EventLoopTaskNoContext; the returned VM (if non-null)
        // outlives this task.
        unsafe { Bun__EventLoopTaskNoContext__createdInBunVm(self as *const _).as_mut() }
    }
}

/// A task created from C++ code that runs inside the workpool, usually via ScriptExecutionContext.
#[repr(C)]
pub struct ConcurrentCppTask {
    pub cpp_task: *mut EventLoopTaskNoContext,
    pub workpool_task: WorkPoolTask,
}

impl ConcurrentCppTask {
    pub fn new(cpp_task: *mut EventLoopTaskNoContext) -> *mut ConcurrentCppTask {
        Box::into_raw(Box::new(ConcurrentCppTask {
            cpp_task,
            workpool_task: WorkPoolTask {
                callback: Self::run_from_workpool,
            },
        }))
    }

    pub fn run_from_workpool(task: *mut WorkPoolTask) {
        // SAFETY: task points to ConcurrentCppTask.workpool_task; recover the parent.
        let this: *mut ConcurrentCppTask = unsafe {
            (task as *mut u8)
                .sub(core::mem::offset_of!(ConcurrentCppTask, workpool_task))
                .cast::<ConcurrentCppTask>()
        };
        // Extract all the info we need from `this` and `cpp_task` before we call functions that
        // free them
        // SAFETY: `this` was allocated via Box::into_raw in `new`/`create_and_run`.
        let this = unsafe { Box::from_raw(this) };
        let cpp_task = this.cpp_task;
        // SAFETY: cpp_task is a valid C++ EventLoopTaskNoContext until `run` consumes it below.
        let maybe_vm = unsafe { (*cpp_task).get_vm() };
        drop(this);
        EventLoopTaskNoContext::run(cpp_task);
        if let Some(vm) = maybe_vm {
            vm.event_loop.unref_concurrently();
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ConcurrentCppTask__createAndRun(cpp_task: *mut EventLoopTaskNoContext) {
    bun_jsc::mark_binding!();
    // SAFETY: cpp_task is a valid C++ EventLoopTaskNoContext freshly handed over from C++.
    if let Some(vm) = unsafe { (*cpp_task).get_vm() } {
        vm.event_loop.ref_concurrently();
    }
    let cpp = ConcurrentCppTask::new(cpp_task);
    // SAFETY: `cpp` is a freshly boxed ConcurrentCppTask; workpool_task is a valid field ptr.
    WorkPool::schedule(unsafe { &mut (*cpp).workpool_task });
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/CppTask.zig (61 lines)
//   confidence: medium
//   todos:      3
//   notes:      Bun__performTask error-ABI unclear; WorkPoolTask shape assumed {callback}; mark_binding! assumed macro; VM lifetime treated as 'static
// ──────────────────────────────────────────────────────────────────────────
