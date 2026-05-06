use core::ffi::c_void;
use core::ptr::NonNull;

use crate::DeferredTaskQueue::{DeferredRepeatingTask, DeferredTaskQueue};

/// Zig file-level struct: `src/event_loop/AutoFlusher.zig`
#[derive(Debug, Default)]
pub struct AutoFlusher {
    pub registered: bool,
}

/// Zig's free functions take `(comptime Type: type, this: *Type)` and duck-type
/// on `this.auto_flusher` + `Type.onAutoFlush`. In Rust that contract is a trait.
pub trait HasAutoFlusher: Sized {
    fn auto_flusher(&mut self) -> &mut AutoFlusher;
    /// Zig: `Type.onAutoFlush` — the deferred-task callback. Signature matches
    /// `DeferredRepeatingTask` after the `@ptrCast` erasure at `postTask`:
    /// `fn(*anyopaque) bool` ↔ `fn(*mut c_void) -> bool`.
    fn on_auto_flush(this: *mut Self) -> bool;
}

/// Erase a typed `fn(*mut T) -> bool` flush callback to the
/// `DeferredRepeatingTask` ABI (`fn(*mut c_void) -> bool`). Mirrors Zig's
/// `@ptrCast(&Type.onAutoFlush)` at the `postTask` call site — single pointer
/// arg, `bool` return, identical layout.
#[inline]
pub fn erase_flush_callback<T: HasAutoFlusher>() -> DeferredRepeatingTask {
    // SAFETY: `fn(*mut T) -> bool` and `fn(*mut c_void) -> bool` have identical
    // ABI (one pointer-sized arg, bool return). The ctx pointer fed back by
    // `DeferredTaskQueue::run` is exactly the `*mut T` we registered below.
    unsafe {
        core::mem::transmute::<fn(*mut T) -> bool, DeferredRepeatingTask>(
            T::on_auto_flush as fn(*mut T) -> bool,
        )
    }
}

// PORT NOTE (b0): Zig passed `*jsc.VirtualMachine` and reached
// `vm.event_loop().deferred_tasks`. To break the event_loop→jsc upward edge,
// callers now pass the `DeferredTaskQueue` directly (it lives in this crate).
// Higher-tier call sites do `&mut vm.event_loop().deferred_tasks` themselves.
pub fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    if this.auto_flusher().registered {
        return;
    }
    register_deferred_microtask_with_type_unchecked(this, deferred);
}

pub fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    if !this.auto_flusher().registered {
        return;
    }
    unregister_deferred_microtask_with_type_unchecked(this, deferred);
}

pub fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    debug_assert!(this.auto_flusher().registered);
<<<<<<< Updated upstream
    // PORT NOTE: Zig `bun.assert(expr)` evaluates `expr` unconditionally; the
    // *check* is debug-only but the side effect must run in release too.
    let removed = deferred.unregister_task(NonNull::new(this as *mut T as *mut c_void));
    debug_assert!(removed);
||||||| Stash base
    debug_assert!(deferred.unregister_task(NonNull::new(this as *mut T as *mut c_void)));
=======
    // PORT NOTE: Zig `bun.assert(expr)` always evaluates `expr`; Rust
    // `debug_assert!` does NOT in release. Hoist the side-effecting call out so
    // the task is removed in all build modes.
    let removed = deferred.unregister_task(NonNull::new(this as *mut T as *mut c_void));
    debug_assert!(removed);
>>>>>>> Stashed changes
    this.auto_flusher().registered = false;
}

pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    debug_assert!(!this.auto_flusher().registered);
    this.auto_flusher().registered = true;
<<<<<<< Updated upstream
    let found_existing = deferred.post_task(
||||||| Stash base
    debug_assert!(!deferred.post_task(
=======
    // PORT NOTE: Zig `bun.assert(expr)` always evaluates `expr`; Rust
    // `debug_assert!` does NOT in release. Hoist the side-effecting `post_task`
    // out so the task is registered in all build modes.
    let existed = deferred.post_task(
>>>>>>> Stashed changes
        NonNull::new(this as *mut T as *mut c_void),
<<<<<<< Updated upstream
        erase_flush_callback::<T>(),
    );
    debug_assert!(!found_existing);
}

// ─── associated-fn facade ─────────────────────────────────────────────────
// Zig call sites read `AutoFlusher.registerDeferredMicrotaskWithType(Self, this, vm)`
// — i.e. namespaced on the struct. Mirror that as inherent associated fns so
// callers can write `AutoFlusher::register_deferred_microtask_with_type::<T>(…)`.
// These are the *lower-tier* signatures (queue passed directly); the higher-tier
// `vm`-taking wrappers live in `bun_runtime::webcore` to avoid the
// event_loop→jsc upward dependency.
impl AutoFlusher {
    #[inline]
    pub fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &mut T,
        deferred: &mut DeferredTaskQueue,
    ) {
        register_deferred_microtask_with_type(this, deferred);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
        this: &mut T,
        deferred: &mut DeferredTaskQueue,
    ) {
        unregister_deferred_microtask_with_type(this, deferred);
    }

    #[inline]
    pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &mut T,
        deferred: &mut DeferredTaskQueue,
    ) {
        register_deferred_microtask_with_type_unchecked(this, deferred);
    }

    #[inline]
    pub fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
        this: &mut T,
        deferred: &mut DeferredTaskQueue,
    ) {
        unregister_deferred_microtask_with_type_unchecked(this, deferred);
    }
||||||| Stash base
        // SAFETY: Zig `@ptrCast(&Type.onAutoFlush)` — erases the typed fn pointer
        // to the DeferredTaskQueue callback ABI. Layout is identical (single
        // pointer arg, bool return).
        unsafe {
            core::mem::transmute::<fn(*mut T) -> bool, fn(*mut c_void) -> bool>(
                T::on_auto_flush as fn(*mut T) -> bool,
            )
        },
    ));
=======
        // SAFETY: Zig `@ptrCast(&Type.onAutoFlush)` — erases the typed fn pointer
        // to the DeferredTaskQueue callback ABI. Layout is identical (single
        // pointer arg, bool return).
        unsafe {
            core::mem::transmute::<fn(*mut T) -> bool, fn(*mut c_void) -> bool>(
                T::on_auto_flush as fn(*mut T) -> bool,
            )
        },
    );
    debug_assert!(!existed);
>>>>>>> Stashed changes
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AutoFlusher.zig (26 lines)
//   confidence: high
//   todos:      0
//   notes:      duck-typed `this.auto_flusher`/`Type.onAutoFlush` modeled as
//               HasAutoFlusher trait; callback ABI confirmed
//               `fn(*mut c_void) -> bool` (DeferredRepeatingTask). Higher-tier
//               `vm`-taking wrapper lives in bun_runtime::webcore::AutoFlusher.
// ──────────────────────────────────────────────────────────────────────────
