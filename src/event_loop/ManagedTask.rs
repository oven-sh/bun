//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{JsResult, Task};

pub struct ManagedTask {
    // Opaque userdata pointer round-tripped through `new`/`run`; raw by design.
    pub ctx: Option<NonNull<c_void>>,
    pub(crate) callback: fn(*mut c_void) -> JsResult<()>,
    pub cleanup: Option<fn(*mut c_void)>,
}

impl ManagedTask {
    pub(crate) fn task(this: *mut ManagedTask) -> Task {
        // Per §Dispatch (tag+ptr), name the tag explicitly.
        Task::new(crate::task_tag::ManagedTask, this.cast())
    }

    /// # Safety
    /// `this` must be the live `*mut ManagedTask` embedded in a `Task` returned
    /// by `new()`/`new_boxed()`; ownership transfers — `this` is freed (via
    /// `heap::take`) before return on both Ok and Err paths.
    pub unsafe fn run(this: *mut ManagedTask) -> JsResult<()> {
        // SAFETY: `this` was produced by `heap::into_raw` in `new`/`new_boxed`
        // (caller contract). Reconstituting the Box here frees it at scope
        // exit on both the Ok and Err paths.
        let this = unsafe { bun_core::heap::take(this) };
        let callback = this.callback;
        let ctx = this.ctx;
        callback(ctx.unwrap().as_ptr())
    }

    /// Free without running: the owned context (if `new_boxed`) is dropped.
    ///
    /// # Safety
    /// As [`run`](Self::run); the task is not queued anywhere.
    pub unsafe fn release(this: *mut ManagedTask) {
        // SAFETY: fn contract.
        let this = unsafe { bun_core::heap::take(this) };
        if let (Some(cleanup), Some(ctx)) = (this.cleanup, this.ctx) {
            cleanup(ctx.as_ptr());
        }
    }

    // A per-(Type, Callback) trampoline is folded away by storing
    // the type-erased fn pointer directly — `fn(*mut T)` and `fn(*mut c_void)` share ABI.
    pub fn new<T>(ctx: *mut T, callback: fn(*mut T) -> JsResult<()>) -> Task {
        let managed = bun_core::heap::into_raw(Box::new(ManagedTask {
            // SAFETY: `fn(*mut T) -> R` and `fn(*mut c_void) -> R` have identical
            // ABI for all `T: Sized`; `run` passes back the exact pointer stored
            // in `ctx` below, so the callee observes its original `*mut T`.
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(*mut T) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
            ctx: NonNull::new(ctx.cast::<c_void>()),
            cleanup: None,
        }));
        ManagedTask::task(managed)
    }

    /// A task that owns `ctx` until it runs: `callback` gets the box back on
    /// the JS thread, or it is dropped if the task is released unrun.
    pub fn new_boxed<T>(ctx: Box<T>, callback: fn(Box<T>) -> JsResult<()>) -> Task {
        fn drop_ctx<T>(p: *mut c_void) {
            // SAFETY: `p` is the `heap::into_raw(Box<T>)` stored in `ctx` by `new_boxed`.
            unsafe { bun_core::heap::destroy(p.cast::<T>()) };
        }
        let managed = bun_core::heap::into_raw(Box::new(ManagedTask {
            // SAFETY: `Box<T>` (sized `T`) is ABI-compatible with `*mut c_void`;
            // `run` passes back the exact pointer `into_raw` produced below,
            // exactly once, so the callee re-owns the box it was given.
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(Box<T>) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
            ctx: NonNull::new(bun_core::heap::into_raw(ctx).cast::<c_void>()),
            cleanup: Some(drop_ctx::<T>),
        }));
        ManagedTask::task(managed)
    }
}
