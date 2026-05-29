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

#[inline]
pub(crate) fn erase_flush_callback<T: HasAutoFlusher>() -> DeferredRepeatingTask {
    extern "C" fn trampoline<T: HasAutoFlusher>(ctx: *mut c_void) -> bool {
        T::on_auto_flush(ctx.cast::<T>())
    }
    trampoline::<T>
}

pub(crate) fn register_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    if this.auto_flusher().registered {
        return;
    }
    register_deferred_microtask_with_type_unchecked(this, deferred);
}

pub(crate) fn unregister_deferred_microtask_with_type<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    if !this.auto_flusher().registered {
        return;
    }
    unregister_deferred_microtask_with_type_unchecked(this, deferred);
}

pub(crate) fn unregister_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    debug_assert!(this.auto_flusher().registered);
    // PORT NOTE: Zig `bun.assert(expr)` evaluates `expr` unconditionally; the
    // *check* is debug-only but the side effect must run in release too.
    let removed =
        deferred.unregister_task(NonNull::new(std::ptr::from_mut::<T>(this).cast::<c_void>()));
    debug_assert!(removed);
    this.auto_flusher().registered = false;
}

pub(crate) fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlusher>(
    this: &mut T,
    deferred: &mut DeferredTaskQueue,
) {
    debug_assert!(!this.auto_flusher().registered);
    this.auto_flusher().registered = true;
    let found_existing = deferred.post_task(
        NonNull::new(std::ptr::from_mut::<T>(this).cast::<c_void>()),
        erase_flush_callback::<T>(),
    );
    debug_assert!(!found_existing);
}

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
}

// ported from: src/event_loop/AutoFlusher.zig
