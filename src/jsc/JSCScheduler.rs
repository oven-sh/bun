use core::ffi::c_int;

use bun_event_loop::{task_tag, ConcurrentTask::ConcurrentTask, TaskTag, Taskable};

use crate::event_loop::{EventLoop, JsTerminated};
use crate::virtual_machine::VirtualMachine;
use crate::ExceptionValidationScope;

/// Opaque FFI handle for a JSC deferred work task (constructed/owned on the C++ side).
#[repr(C)]
pub struct JSCDeferredWorkTask {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
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
        let mut scope_storage = core::mem::MaybeUninit::uninit();
        let scope = ExceptionValidationScope::init(&mut scope_storage, global_this);
        // Zig: `defer scope.deinit()` — there is no `Drop` impl for ExceptionValidationScope
        // (it wraps a placement-constructed C++ TopExceptionScope), so register an explicit
        // guard that tears it down on every exit path. Mirrors the JSPromise::wrap pattern.
        let scope_ptr: *mut ExceptionValidationScope = scope;
        let _scope_guard = scopeguard::guard(scope_ptr, |s| {
            // SAFETY: `s` was initialized by `init()` above and is destroyed exactly once here.
            unsafe { ExceptionValidationScope::destroy(s) }
        });
        // SAFETY: `self` is a live opaque pointer handed to us by C++; Bun__runDeferredWork
        // consumes it on the C++ side.
        unsafe { Bun__runDeferredWork(std::ptr::from_mut::<Self>(self)) };
        // Zig: `try scope.assertNoExceptionExceptTermination()` — the only error variant
        // that fn returns is termination, so map the wider `JsError` back down.
        // SAFETY: `scope_ptr` is live; the short-lived `&mut` reborrow ends before
        // `_scope_guard` runs and shares its raw-pointer provenance root.
        unsafe { (*scope_ptr).assert_no_exception_except_termination() }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSCScheduler.zig (50 lines)
//   confidence: high
//   todos:      0
// ──────────────────────────────────────────────────────────────────────────
