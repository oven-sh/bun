use core::ffi::c_int;

use bun_event_loop::{task_tag, ConcurrentTask::ConcurrentTask, TaskTag, Taskable};

use crate::event_loop::{EventLoop, JsTerminated};
use crate::virtual_machine::VirtualMachine;
use crate::ExceptionValidationScope;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for a JSC deferred work task (constructed/owned on the C++ side).
    pub struct JSCDeferredWorkTask;
}

impl Taskable for JSCDeferredWorkTask {
    const TAG: TaskTag = task_tag::JSCDeferredWorkTask;
}

unsafe extern "C" {
    fn Bun__runDeferredWork(task: *mut JSCDeferredWorkTask);
}

impl JSCDeferredWorkTask {
    pub fn run(&mut self) -> Result<(), JsTerminated> {
        // SAFETY: `VirtualMachine::get()` returns the live per-thread VM; `global` is
        // initialized during VM startup and remains valid for the VM's lifetime.
        let global_this = VirtualMachine::get().global();
        crate::validation_scope!(scope, global_this);
        // SAFETY: `self` is a live opaque pointer handed to us by C++; Bun__runDeferredWork
        // consumes it on the C++ side.
        unsafe { Bun__runDeferredWork(std::ptr::from_mut::<Self>(self)) };
        // Zig: `try scope.assertNoExceptionExceptTermination()` — the only error variant
        // that fn returns is termination, so map the wider `JsError` back down.
        scope.assert_no_exception_except_termination()
            .map_err(|_| JsTerminated::JSTerminated)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__incrementRefConcurrently(
    jsc_vm: *mut VirtualMachine,
    delta: c_int,
) {
    crate::mark_binding!();
    // SAFETY: caller (C++) guarantees `jsc_vm` is a valid live VirtualMachine and
    // `event_loop` always points at one of the VM's owned EventLoop fields.
    let event_loop: &EventLoop = unsafe { &*(*jsc_vm).event_loop };
    if delta > 0 {
        event_loop.ref_concurrently();
    } else {
        event_loop.unref_concurrently();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    jsc_vm: *mut VirtualMachine,
    task: *mut JSCDeferredWorkTask,
) {
    crate::mark_binding!();
    // SAFETY: caller (C++) guarantees `jsc_vm` is a valid live VirtualMachine.
    let loop_: &EventLoop = unsafe { &*(*jsc_vm).event_loop() };
    // Zig: `ConcurrentTask.new(.{ .task = Task.init(task), .next = .auto_delete })`
    // — `create_from` is exactly that (heap-allocates with the auto-delete bit set).
    loop_.enqueue_task_concurrent(ConcurrentTask::create_from(task));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__tickWhilePaused(paused: *mut bool) {
    crate::mark_binding!();
    // SAFETY: `paused` points to a live bool for the duration of the call.
    VirtualMachine::get().event_loop_mut().tick_while_paused(unsafe { &mut *paused });
}

// Zig `comptime { _ = Bun__... }` force-reference block dropped — Rust links what's `pub`.

// ported from: src/jsc/JSCScheduler.zig
