use core::ffi::c_int;

use bun_event_loop::{ConcurrentTask::ConcurrentTask, TaskTag, Taskable, task_tag};

use crate::ExceptionValidationScope;
use crate::event_loop::{EventLoop, JsTerminated};
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
        // Zig: `try scope.assertNoExceptionExceptTermination()` — the only error variant
        // that fn returns is termination, so map the wider `JsError` back down.
        scope
            .assert_no_exception_except_termination()
            .map_err(|_| JsTerminated::JSTerminated)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__incrementRefConcurrently(jsc_vm: &VirtualMachine, delta: c_int) {
    crate::mark_binding!();
    // C++ passes a non-null live `VirtualMachine*`; ABI-compatible with `&T`.
    // `event_loop_shared()` is the safe accessor over the VM-owned EventLoop.
    let event_loop: &EventLoop = jsc_vm.event_loop_shared();
    if delta > 0 {
        event_loop.ref_concurrently();
    } else {
        event_loop.unref_concurrently();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    jsc_vm: &VirtualMachine,
    task: *mut JSCDeferredWorkTask,
) {
    crate::mark_binding!();
    // C++ passes a non-null live `VirtualMachine*`; ABI-compatible with `&T`.
    let loop_: &EventLoop = jsc_vm.event_loop_shared();
    // Zig: `ConcurrentTask.new(.{ .task = Task.init(task), .next = .auto_delete })`
    // — `create_from` is exactly that (heap-allocates with the auto-delete bit set).
    loop_.enqueue_task_concurrent(ConcurrentTask::create_from(task));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__tickWhilePaused(paused: *mut bool) {
    crate::mark_binding!();
    // SAFETY: `paused` points to a live bool for the duration of the call.
    VirtualMachine::get()
        .event_loop_mut()
        .tick_while_paused(unsafe { &mut *paused });
}

// Zig `comptime { _ = Bun__... }` force-reference block dropped — Rust links what's `pub`.

// ported from: src/jsc/JSCScheduler.zig
