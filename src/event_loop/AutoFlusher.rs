use core::ffi::c_void;

use bun_jsc::VirtualMachine;

/// Zig file-level struct: `src/event_loop/AutoFlusher.zig`
#[derive(Default)]
pub struct AutoFlusher {
    pub registered: bool,
}

/// Zig's free functions take `(comptime Type: type, this: *Type)` and duck-type
/// on `this.auto_flusher` + `Type.onAutoFlush`. In Rust that contract is a trait.
pub trait HasAutoFlusher: Sized {
    fn auto_flusher(&mut self) -> &mut AutoFlusher;
    /// Zig: `Type.onAutoFlush` — the deferred-task callback. Exact signature is
    /// erased via `@ptrCast` at the `postTask` call site.
    // TODO(port): confirm callback signature against DeferredTaskQueue.postTask
    fn on_auto_flush(this: *mut Self) -> bool;
}

pub fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    vm: &VirtualMachine,
) {
    if this.auto_flusher().registered {
        return;
    }
    register_deferred_microtask_with_type_unchecked(this, vm);
}

pub fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    vm: &VirtualMachine,
) {
    if !this.auto_flusher().registered {
        return;
    }
    unregister_deferred_microtask_with_type_unchecked(this, vm);
}

pub fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    vm: &VirtualMachine,
) {
    debug_assert!(this.auto_flusher().registered);
    debug_assert!(vm
        .event_loop()
        .deferred_tasks
        .unregister_task(this as *mut T as *mut c_void));
    this.auto_flusher().registered = false;
}

pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    vm: &VirtualMachine,
) {
    debug_assert!(!this.auto_flusher().registered);
    this.auto_flusher().registered = true;
    debug_assert!(!vm.event_loop().deferred_tasks.post_task(
        this as *mut T as *mut c_void,
        // SAFETY: Zig `@ptrCast(&Type.onAutoFlush)` — erases the typed fn pointer
        // to the DeferredTaskQueue callback ABI. Layout is identical (single
        // pointer arg, bool return).
        unsafe {
            core::mem::transmute::<fn(*mut T) -> bool, fn(*mut c_void) -> bool>(
                T::on_auto_flush as fn(*mut T) -> bool,
            )
        },
    ));
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AutoFlusher.zig (26 lines)
//   confidence: medium
//   todos:      1
//   notes:      duck-typed `this.auto_flusher`/`Type.onAutoFlush` modeled as HasAutoFlusher trait; DeferredTaskQueue callback ABI assumed `fn(*mut c_void) -> bool`
// ──────────────────────────────────────────────────────────────────────────
