use core::ffi::c_int;

use bun_event_loop::{ConcurrentTask::ConcurrentTask, TaskTag, Taskable, task_tag};

use crate::event_loop::JsTerminated;
use crate::virtual_machine::VirtualMachine;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC deferred work task (constructed/owned on the C++ side).
    pub struct JSCDeferredWorkTask;
}

impl Taskable for JSCDeferredWorkTask {
    const TAG: TaskTag = task_tag::JSCDeferredWorkTask;
}

unsafe extern "C" {
    // safe: `JSCDeferredWorkTask` is an `opaque_ffi!` ZST handle (`!Freeze`
    // via `UnsafeCell`); `&mut` is ABI-identical to a non-null `*mut` and the
    // C++ side consuming it is interior to the opaque cell.
    safe fn Bun__runDeferredWork(task: &mut JSCDeferredWorkTask);
}

impl JSCDeferredWorkTask {
    pub fn run(&mut self) -> Result<(), JsTerminated> {
        // SAFETY: `VirtualMachine::get()` returns the live per-thread VM; `global` is
        // initialized during VM startup and remains valid for the VM's lifetime.
        let global_this = VirtualMachine::get().global();
        crate::validation_scope!(scope, global_this);
        Bun__runDeferredWork(self);
        // The only error variant that fn returns is termination, so map the
        // wider `JsError` back down.
        scope
            .assert_no_exception_except_termination()
            .map_err(|_| JsTerminated::JSTerminated)
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__eventLoop__incrementRefConcurrently(
    jsc_vm: *mut VirtualMachine,
    delta: c_int,
) {
    crate::mark_binding!();
    // Checked: called from JSC helper threads, which can outlive a
    // terminated worker's VM (the counter of a freed loop needs no balancing).
    // Address-only: the pointer was captured by C++ (`JSVMClientData::bunVM`)
    // and carries no generation.
    if delta > 0 {
        VirtualMachine::try_ref_concurrently_addr_only(jsc_vm);
    } else {
        VirtualMachine::try_unref_concurrently_addr_only(jsc_vm);
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    jsc_vm: *mut VirtualMachine,
    task: *mut JSCDeferredWorkTask,
) {
    crate::mark_binding!();
    // Checked: called from JSC concurrent threads, which can outlive a
    // terminated worker's VM. `create_from` heap-allocates with the
    // auto-delete bit set (freed by the checked enqueue when the VM is gone).
    // Address-only: the pointer was captured by C++ (`JSVMClientData::bunVM`)
    // and carries no generation.
    let _ = VirtualMachine::try_enqueue_task_concurrent_addr_only(
        jsc_vm,
        ConcurrentTask::create_from(task),
    );
}

/// # Safety
/// `paused` must point to a live `bool`; C++ writes `true` through it from a
/// callback inside `tick()`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__tickWhilePaused(paused: *mut bool) {
    crate::mark_binding!();
    // SAFETY: see fn contract.
    unsafe {
        VirtualMachine::get()
            .event_loop_mut()
            .tick_while_paused(paused.cast_const());
    }
}
