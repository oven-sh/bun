//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::{JsResult, Task};

pub struct ManagedTask {
    // TODO(port): lifetime — opaque userdata pointer round-tripped through `new`/`run`
    pub ctx: Option<NonNull<c_void>>,
    pub callback: fn(*mut c_void) -> JsResult<()>,
}

impl ManagedTask {
    pub fn task(this: *mut ManagedTask) -> Task {
        Task::init(this)
    }

    pub fn run(this: *mut ManagedTask) -> JsResult<()> {
        // Zig: @setRuntimeSafety(false) — no Rust equivalent; bounds/overflow checks
        // are already off in release and there is nothing to elide here.

        // SAFETY: `this` was produced by `Box::into_raw` in `new` (Zig:
        // `bun.default_allocator.create`). Reconstituting the Box here mirrors
        // Zig's `defer bun.default_allocator.destroy(this)` — it drops at scope
        // exit on both the Ok and Err paths.
        let this = unsafe { Box::from_raw(this) };
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
    // Zig `pub fn New(comptime Type, comptime Callback) type { return struct { init, wrap } }`
    // cannot be expressed in stable Rust because a fn value is not a valid const-generic
    // parameter. The `wrap` trampoline (which `@ptrCast`/`@alignCast` the opaque ctx back
    // to `*Type` and `@call(bun.callmod_inline, Callback, ...)`) is folded away by storing
    // the type-erased fn pointer directly — `fn(*mut T)` and `fn(*mut c_void)` share ABI.
    // Callers: `ManagedTask.New(T, cb).init(ctx)` → `ManagedTask::new(ctx, cb)`.
    // PERF(port): was comptime monomorphization (callmod_inline) — profile in Phase B
    pub fn new<T>(ctx: *mut T, callback: fn(*mut T) -> JsResult<()>) -> Task {
        let managed = Box::into_raw(Box::new(ManagedTask {
            // SAFETY: `fn(*mut T) -> R` and `fn(*mut c_void) -> R` have identical
            // ABI for all `T: Sized`; `run` passes back the exact pointer stored
            // in `ctx` below, so the callee observes its original `*mut T`.
            callback: unsafe {
                core::mem::transmute::<fn(*mut T) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
            ctx: NonNull::new(ctx.cast::<c_void>()),
        }));
        ManagedTask::task(managed)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/ManagedTask.zig (47 lines)
//   confidence: medium
//   todos:      1
//   notes:      `New(comptime Type, comptime Callback) type` collapsed to generic `new<T>(ctx, cb)`; fn-pointer transmute replaces the `wrap` trampoline. `Task::init(*mut ManagedTask)` assumed on bun_jsc::Task.
// ──────────────────────────────────────────────────────────────────────────
