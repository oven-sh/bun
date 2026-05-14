//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{JsResult, Task};

pub struct ManagedTask {
    // TODO(port): lifetime — opaque userdata pointer round-tripped through `new`/`run`
    pub ctx: Option<NonNull<c_void>>,
    pub callback: fn(*mut c_void) -> JsResult<()>,
}

impl ManagedTask {
    pub fn task(this: *mut ManagedTask) -> Task {
        // PORT NOTE: original `Task.init(this)` mapped variant type → tag at compile time.
        // Per §Dispatch (tag+ptr), name the tag explicitly.
        Task::new(crate::task_tag::ManagedTask, this.cast())
    }

    pub fn run(this: *mut ManagedTask) -> JsResult<()> {
        // The original disabled runtime safety checks here; bounds/overflow checks
        // are already off in release and there is nothing to elide here.

        // SAFETY: `this` was produced by `heap::alloc` in `new`.
        // Reconstituting the Box here mirrors
        // the original deferred-destroy — it drops at scope
        // exit on both the Ok and Err paths.
        let this = unsafe { bun_core::heap::take(this) };
        let callback = this.callback;
        let ctx = this.ctx;
        callback(ctx.unwrap().as_ptr())
    }

    pub fn cancel(&mut self) {
        fn noop(_: *mut c_void) -> JsResult<()> {
            Ok(())
        }
        self.callback = noop;
    }

    // PORT NOTE: reshaped for borrowck / const-generics limitation.
    // The original compile-time generator `New(Type, Callback) -> type { init, wrap }`
    // cannot be expressed in stable Rust because a fn value is not a valid const-generic
    // parameter. The `wrap` trampoline (which pointer-cast the opaque ctx back
    // to `*Type` and force-inlined the callback) is folded away by storing
    // the type-erased fn pointer directly — `fn(*mut T)` and `fn(*mut c_void)` share ABI.
    // Callers: `ManagedTask.New(T, cb).init(ctx)` → `ManagedTask::new(ctx, cb)`.
    // PERF(port): was compile-time monomorphization (force-inlined) — profile in Phase B
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
        }));
        ManagedTask::task(managed)
    }
}
