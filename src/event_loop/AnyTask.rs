//! This is a slower wrapper around a function pointer.
//! Prefer adding a task type directly to `Task` instead of using this.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

use bun_jsc::{JsResult, Task};

pub struct AnyTask {
    // TODO(port): lifetime — type-erased callback context; raw by design.
    pub ctx: Option<NonNull<c_void>>,
    pub callback: fn(*mut c_void) -> JsResult<()>,
}

impl AnyTask {
    pub fn task(&mut self) -> Task {
        Task::init(self)
    }

    pub fn run(&mut self) -> JsResult<()> {
        // Zig: @setRuntimeSafety(false) — no Rust equivalent; bounds/overflow checks
        // are already off in release and the body has none anyway.
        let callback = self.callback;
        let ctx = self.ctx;
        callback(ctx.expect("ctx").as_ptr())
    }
}

// Zig: `pub fn New(comptime Type: type, comptime Callback: anytype) type { return struct { ... } }`
//
// The Zig version monomorphizes a `wrap` shim per (Type, Callback) pair so that
// `AnyTask` only needs to store one erased fn pointer. Rust cannot take a function
// value as a const generic on stable, so the `Callback` parameter cannot be expressed
// 1:1 here.
//
// TODO(port): Phase B — pick one:
//   (a) require `T: AnyTaskCallback` (trait with `fn run(&mut self) -> JsResult<()>`)
//       so `wrap::<T>` is a real monomorphized fn pointer, or
//   (b) have callers hand-write the `*mut c_void -> JsResult<()>` shim and call
//       `AnyTask { ctx, callback }` directly (most call sites already know their type).
pub struct New<T>(PhantomData<fn(*mut T)>);

impl<T> New<T> {
    pub fn init(ctx: &mut T) -> AnyTask {
        AnyTask {
            callback: Self::wrap,
            ctx: Some(NonNull::from(ctx).cast::<c_void>()),
        }
    }

    pub fn wrap(this: *mut c_void) -> JsResult<()> {
        // SAFETY: `this` was stored from a `*mut T` in `init` above.
        let this: *mut T = this.cast::<T>();
        debug_assert!(!this.is_null());
        // PERF(port): was `@call(bun.callmod_inline, Callback, .{this})` — profile in Phase B
        // TODO(port): invoke the comptime `Callback` here once the trait/const-generic
        // strategy is chosen (see comment on `New` above).
        let _ = this;
        unreachable!("TODO(port): comptime Callback dispatch");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AnyTask.zig (38 lines)
//   confidence: medium
//   todos:      3
//   notes:      `New`'s `comptime Callback: anytype` has no stable Rust const-generic equivalent; Phase B must pick trait-based dispatch or inline shims at call sites.
// ──────────────────────────────────────────────────────────────────────────
