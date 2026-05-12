//! This is a slower wrapper around a function pointer.
//! Prefer adding a task type directly to `Task` instead of using this.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::Task;

/// Historical low-tier alias for `bun_jsc::JsError`. The canonical enum now lives in
/// `bun_core` (tier-0), so this is a straight re-export — the old "erased discriminant"
/// split exists only to keep call sites compiling.
pub use bun_core::JsError as ErasedJsError;

/// `bun.JSError!T` for tier-3 callbacks. Same type as `bun_jsc::JsResult<T>`; kept as a
/// local alias so `AnyTask`/`ManagedTask` signatures don't take an upward dep.
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

impl AnyTask {
    /// Zig: `AnyTask.New(T, Callback).init(ctx)`.
    ///
    /// Builds an [`AnyTask`] from a typed `*mut T` context and a typed
    /// callback, erasing both to `c_void` in one place. This is the direct
    /// stable-Rust analogue of Zig's `comptime Callback` generator: instead of
    /// monomorphising a `wrap` shim per `(Type, Callback)` pair, the typed
    /// `fn` pointer itself is reinterpreted as the erased one — `*mut T` and
    /// `*mut c_void` are ABI-identical for all `T: Sized`, so
    /// `fn(*mut T) -> R` and `fn(*mut c_void) -> R` have identical
    /// `extern "Rust"` ABI and the transmute is sound.
    #[inline]
    pub fn from_typed<T>(ctx: *mut T, callback: fn(*mut T) -> JsResult<()>) -> Self {
        Self {
            ctx: NonNull::new(ctx.cast::<c_void>()),
            // SAFETY: `*mut T` and `*mut c_void` are guaranteed identical
            // size/align/ABI (T: Sized), so the two `fn` pointer types are
            // ABI-compatible. `run()` only ever calls back with the exact
            // pointer stored above, which originated as `*mut T`.
            callback: unsafe {
                core::mem::transmute::<fn(*mut T) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
        }
    }
}

// ported from: src/event_loop/AnyTask.zig
