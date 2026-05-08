//! This is a slower wrapper around a function pointer.
//! Prefer adding a task type directly to `Task` instead of using this.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::Task;

/// Low-tier discriminant for `bun_jsc::JsError`. `event_loop` is tier-3 and may
/// not name `bun_jsc`, so callbacks return this 1-byte tag and the high-tier
/// dispatcher recovers the real enum via `From` (defined in `bun_jsc`). The
/// `#[repr(u8)]` discriminants match `bun_jsc::JsError` exactly so the
/// conversion is a no-op transmute.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum ErasedJsError {
    /// A JavaScript exception is pending in the VM's exception scope.
    Thrown = 0,
    /// Allocation failure; caller must throw an `OutOfMemoryError`.
    OutOfMemory = 1,
    /// The VM is terminating (worker shutdown / `process.exit`).
    Terminated = 2,
}

/// `bun.JSError!T` for tier-3 callbacks. Error payload is [`ErasedJsError`]
/// (layout-identical to `bun_jsc::JsError`) so the discriminant survives the
/// round-trip through `AnyTask`/`ManagedTask` and `report_error_or_terminate`
/// can branch on `Terminated` correctly.
pub type JsResult<T> = core::result::Result<T, ErasedJsError>;

pub struct AnyTask {
    // TODO(port): lifetime — type-erased callback context; raw by design.
    pub ctx: Option<NonNull<c_void>>,
    pub callback: fn(*mut c_void) -> JsResult<()>,
}

impl Default for AnyTask {
    fn default() -> Self {
        // Zig: field defaults to `= undefined`; provide a sentinel that panics
        // if run before being overwritten.
        Self {
            ctx: None,
            callback: |_| unreachable!("AnyTask.callback was undefined"),
        }
    }
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
// `AnyTask` only needs to store one erased fn pointer. Stable Rust cannot take a
// function value as a const generic, so `Callback` is supplied via the
// [`AnyTaskCallback`] trait instead — `New::<T>::wrap` is then a real
// monomorphized `fn(*mut c_void) -> JsResult<()>` storable in
// [`AnyTask::callback`], exactly like Zig's `wrap`.
//
// Call sites that bound a one-off closure in Zig (`AnyTask.New(T, &someFn)`)
// either `impl AnyTaskCallback for T` or build `AnyTask { ctx, callback }`
// directly with a hand-written shim — both are equivalent.

/// Supplies the `comptime Callback` that Zig's `AnyTask.New(Type, Callback)`
/// captured. Implement this on `T` and `New::<T>::wrap` becomes the type-erased
/// trampoline stored in [`AnyTask::callback`].
pub trait AnyTaskCallback {
    /// Zig: `Callback(@as(*Type, @ptrCast(@alignCast(this.?))))`.
    /// `this` is the exact pointer passed to [`New::init`].
    fn run_any_task(this: *mut Self) -> JsResult<()>;
}

pub struct New<T>(PhantomData<fn(*mut T)>);

impl<T: AnyTaskCallback> New<T> {
    pub fn init(ctx: &mut T) -> AnyTask {
        AnyTask {
            callback: Self::wrap,
            ctx: Some(NonNull::from(ctx).cast::<c_void>()),
        }
    }

    pub fn wrap(this: *mut c_void) -> JsResult<()> {
        // SAFETY: `this` was stored from a `*mut T` in `init` above; Zig's
        // `@ptrCast(@alignCast(this.?))` is the same cast.
        let this: *mut T = this.cast::<T>();
        debug_assert!(!this.is_null());
        // PERF(port): was `@call(bun.callmod_inline, Callback, .{this})` — the
        // trait call is statically dispatched and inlines identically.
        <T as AnyTaskCallback>::run_any_task(this)
    }
}

// ported from: src/event_loop/AnyTask.zig
