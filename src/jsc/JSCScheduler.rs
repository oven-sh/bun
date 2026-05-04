use core::ffi::{c_int, c_void};

use crate::{ConcurrentTask, ExceptionValidationScope, JsTerminated, Task, VirtualMachine};

/// Opaque FFI handle for a JSC deferred work task (constructed/owned on the C++ side).
#[repr(C)]
pub struct JSCDeferredWorkTask {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__runDeferredWork(task: *mut JSCDeferredWorkTask);
}

impl JSCDeferredWorkTask {
    pub fn run(&mut self) -> Result<(), JsTerminated> {
        let global_this = VirtualMachine::get().global;
        // TODO(port): @src() — pass real source location once ExceptionValidationScope::init signature is settled
        let scope = ExceptionValidationScope::init(global_this);
        // `defer scope.deinit()` → handled by Drop
        // SAFETY: `self` is a live opaque pointer handed to us by C++; Bun__runDeferredWork
        // consumes it on the C++ side.
        unsafe { Bun__runDeferredWork(self as *mut Self) };
        scope.assert_no_exception_except_termination()?;
        Ok(())
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__incrementRefConcurrently(
    jsc_vm: *mut VirtualMachine,
    delta: c_int,
) {
    // TODO(port): jsc.markBinding(@src())
    // SAFETY: caller (C++) guarantees jsc_vm is a valid live VirtualMachine.
    let jsc_vm = unsafe { &mut *jsc_vm };
    if delta > 0 {
        jsc_vm.event_loop.ref_concurrently();
    } else {
        jsc_vm.event_loop.unref_concurrently();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__queueJSCDeferredWorkTaskConcurrently(
    jsc_vm: *mut VirtualMachine,
    task: *mut JSCDeferredWorkTask,
) {
    // TODO(port): jsc.markBinding(@src())
    // SAFETY: caller (C++) guarantees jsc_vm is a valid live VirtualMachine.
    let jsc_vm = unsafe { &mut *jsc_vm };
    let loop_ = jsc_vm.event_loop();
    // TODO(port): verify ConcurrentTask::new signature / `.next = .auto_delete` mapping
    loop_.enqueue_task_concurrent(ConcurrentTask::new(
        Task::init(task),
        ConcurrentTask::AUTO_DELETE,
    ));
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__tickWhilePaused(paused: *mut bool) {
    // TODO(port): jsc.markBinding(@src())
    // SAFETY: caller (C++) guarantees `paused` points to a live bool for the duration of the call.
    let paused = unsafe { &mut *paused };
    VirtualMachine::get().event_loop().tick_while_paused(paused);
}

// Zig `comptime { _ = Bun__... }` force-reference block dropped — Rust links what's `pub`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSCScheduler.zig (50 lines)
//   confidence: medium
//   todos:      5
//   notes:      @src()/markBinding stubbed; ConcurrentTask::new field mapping needs Phase B verification
// ──────────────────────────────────────────────────────────────────────────
