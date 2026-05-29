//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{JsResult, Task};

pub struct ManagedTask {
    // TODO(port): lifetime — opaque userdata pointer round-tripped through `new`/`run`
    pub ctx: Option<NonNull<c_void>>,
    pub callback: fn(*mut c_void) -> JsResult<()>,
    pub cleanup: Option<fn(*mut c_void)>,
}

impl ManagedTask {
    pub fn task(this: *mut ManagedTask) -> Task {
        // PORT NOTE: Zig `Task.init(this)` mapped variant type → tag at comptime.
        // Per §Dispatch (tag+ptr), name the tag explicitly.
        Task::new(crate::task_tag::ManagedTask, this.cast())
    }

    /// # Safety
    /// `this` must be the live `*mut ManagedTask` returned by `heap::alloc` in
    /// `new()`; ownership transfers — `this` is freed (via `heap::take`) before
    /// return on both Ok and Err paths.
    pub unsafe fn run(this: *mut ManagedTask) -> JsResult<()> {
        // Zig: @setRuntimeSafety(false) — no Rust equivalent; bounds/overflow checks
        // are already off in release and there is nothing to elide here.

        // SAFETY: `this` was produced by `heap::alloc` in `new` (Zig:
        // `bun.default_allocator.create`). Reconstituting the Box here mirrors
        // Zig's `defer bun.default_allocator.destroy(this)` — it drops at scope
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

    pub fn new_owned<T>(ctx: *mut T, callback: fn(*mut T) -> JsResult<()>) -> Task {
        fn drop_ctx<T>(p: *mut c_void) {
            // SAFETY: `p` is the `heap::into_raw(Box<T>)` stored in `ctx` by `new_owned`.
            unsafe { bun_core::heap::destroy(p.cast::<T>()) };
        }
        let managed = bun_core::heap::into_raw(Box::new(ManagedTask {
            // SAFETY: same fn-pointer ABI cast as `new`.
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(*mut T) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
            ctx: NonNull::new(ctx.cast::<c_void>()),
            cleanup: Some(drop_ctx::<T>),
        }));
        ManagedTask::task(managed)
    }
}

// ported from: src/event_loop/ManagedTask.zig
