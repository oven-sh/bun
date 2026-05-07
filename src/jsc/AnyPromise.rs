use core::ffi::c_void;

use crate::host_fn::to_js_host_call;
use crate::js_promise::{Status, UnwrapMode, Unwrapped};
use crate::top_exception_scope::{SourceLocation, TopExceptionScope};
use crate::{JSGlobalObject, JSInternalPromise, JSPromise, JSValue, JsResult, JsTerminated, VM};

/// `jsc.AnyPromise` — `JSPromise | JSInternalPromise` (AnyPromise.zig).
///
/// Variants hold raw `*mut` (mirroring Zig's `*JSPromise`): the pointee is a
/// GC-managed JSC heap cell whose lifetime is governed by the VM, not by a
/// Rust borrow. Callers must keep the cell reachable (e.g. via `Strong` or an
/// on-stack `JSValue`) for as long as the `AnyPromise` is used.
#[derive(Debug, Clone, Copy)]
pub enum AnyPromise {
    Normal(*mut JSPromise),
    Internal(*mut JSInternalPromise),
}

impl AnyPromise {
    #[inline]
    pub fn unwrap(self, vm: &VM, mode: UnwrapMode) -> Unwrapped {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).unwrap(vm, mode) },
            Self::Internal(p) => unsafe { (*p).unwrap(vm, mode) },
        }
    }

    #[inline]
    pub fn status(self) -> Status {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).status() },
            Self::Internal(p) => unsafe { (*p).status() },
        }
    }

    #[inline]
    pub fn result(self, vm: &VM) -> JSValue {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).result(vm) },
            Self::Internal(p) => unsafe { (*p).result(vm) },
        }
    }

    #[inline]
    pub fn is_handled(self) -> bool {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).is_handled() },
            Self::Internal(p) => unsafe { (*p).is_handled() },
        }
    }

    #[inline]
    pub fn set_handled(self, vm: &VM) {
        let _ = vm;
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).set_handled() },
            Self::Internal(p) => unsafe { (*p).set_handled() },
        }
    }

    #[inline]
    pub fn resolve(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).resolve(global_this, value) },
            Self::Internal(p) => unsafe { (*p).resolve(global_this, value) },
        }
    }

    #[inline]
    pub fn reject(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // Zig: `promise.reject(globalThis, value)` — `JSValue` coerces to `JSError!JSValue`
        // implicitly in Zig; map that with `Ok(value)` here.
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).reject(global_this, Ok(value)) },
            Self::Internal(p) => unsafe { (*p).reject(global_this, Ok(value)) },
        }
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the
    /// top of the event loop. JSInternalPromise subclasses JSPromise in C++,
    /// so both variants are handled.
    #[inline]
    pub fn reject_with_async_stack(
        self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        // SAFETY: `as_js_promise` yields a non-null GC cell; reborrow is for the FFI call only.
        value.attach_async_stack_from_promise(global_this, unsafe { &*self.as_js_promise() });
        self.reject(global_this, value)
    }

    /// JSInternalPromise subclasses JSPromise in C++ — this cast is safe for
    /// any C++ function taking JSPromise*.
    #[inline]
    pub fn as_js_promise(self) -> *mut JSPromise {
        match self {
            Self::Normal(p) => p,
            // SAFETY: JSInternalPromise subclasses JSPromise in C++; the
            // pointer reinterpretation is valid for any C++ API taking JSPromise*.
            Self::Internal(p) => p.cast::<JSPromise>(),
        }
    }

    #[inline]
    pub fn reject_as_handled(
        self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        // SAFETY: variants hold a live JSC heap cell created via `as_any_promise`.
        match self {
            Self::Normal(p) => unsafe { (*p).reject_as_handled(global_this, value) },
            Self::Internal(p) => unsafe { (*p).reject_as_handled(global_this, value) },
        }
    }

    #[inline]
    pub fn as_value(self) -> JSValue {
        match self {
            Self::Normal(p) => JSValue::from_cell(p),
            Self::Internal(p) => JSValue::from_cell(p),
        }
    }

    /// `AnyPromise.wrap` (AnyPromise.zig:76) — run `f` through the host-call
    /// wrapper so a thrown exception (or returned `ErrorInstance`) is converted
    /// into a rejection of this existing promise; otherwise resolve with the
    /// result. The C++ side (`JSC__AnyPromise__wrap`, bindings.cpp) owns the
    /// resolve/reject decision.
    ///
    /// Zig used `std.meta.ArgsTuple(@TypeOf(Function))` to forward arbitrary
    /// argument tuples through a `callconv(.c)` trampoline. Rust has no
    /// compile-time fn-signature reflection, so this takes a closure that
    /// captures those arguments instead.
    pub fn wrap<F>(self, global_object: &JSGlobalObject, f: F) -> Result<(), JsTerminated>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        struct Wrapper<F> {
            f: Option<F>,
        }

        extern "C" fn call<F>(wrap_: *mut c_void, global: *mut JSGlobalObject) -> JSValue
        where
            F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
        {
            // SAFETY: `wrap_` is `&mut Wrapper<F>` passed below; `global` is a
            // live JSGlobalObject* supplied by JSC for the duration of the call.
            let wrap_ = unsafe { &mut *wrap_.cast::<Wrapper<F>>() };
            let global = unsafe { &*global };
            let f = wrap_.f.take().expect("AnyPromise::wrap called twice");
            // Zig: `jsc.toJSHostCall(global, @src(), Fn, wrap_.args)` — installs the
            // host-call exception/return-value validation around the invocation.
            // `to_js_host_call` is `#[track_caller]`, so `@src()` is propagated.
            to_js_host_call(global, move || f(global))
        }

        // Zig: `var scope: jsc.TopExceptionScope = undefined; scope.init(global, @src()); defer scope.deinit();`
        // The C++ object is placement-constructed into `bytes` and must not move
        // after init, so stack-allocate via `MaybeUninit` and route every access
        // through a single raw pointer (Stacked Borrows: keep one provenance root).
        let mut scope = core::mem::MaybeUninit::<TopExceptionScope>::uninit();
        let scope_ptr: *mut TopExceptionScope = scope.as_mut_ptr();
        // SAFETY: `init_in_place` writes into uninit `bytes` via FFI without reading
        // prior contents (matches the Zig `= undefined; .init()` pattern).
        unsafe {
            (*scope_ptr).init_in_place(
                global_object,
                SourceLocation {
                    fn_name: c"AnyPromise::wrap".as_ptr(),
                    file: c"src/jsc/AnyPromise.rs".as_ptr(),
                    line: line!(),
                },
            );
        }
        let _scope_guard = scopeguard::guard(scope_ptr, |s| {
            // SAFETY: `s` was initialized by `init_in_place` above and has not been destroyed.
            unsafe { TopExceptionScope::destroy(s) }
        });

        let mut ctx = Wrapper { f: Some(f) };
        // SAFETY: `ctx` lives on the stack for the duration of the synchronous FFI call;
        // `call::<F>` matches the expected `extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue`
        // shape. `as_ptr()` routes through JSGlobalObject's UnsafeCell interior so the
        // `*mut` handed to C++ carries write provenance (no `&T -> *mut T` UB).
        unsafe {
            JSC__AnyPromise__wrap(
                global_object.as_ptr(),
                self.as_value(),
                (&raw mut ctx).cast::<c_void>(),
                call::<F>,
            );
        }
        // C++ converts any thrown exception into a rejection, so a pending non-termination
        // exception here indicates a bug; surface termination as JsTerminated.
        // SAFETY: `scope_ptr` was initialized above; the short-lived `&mut` reborrow ends
        // before `_scope_guard` runs `destroy`.
        unsafe { (*scope_ptr).assert_no_exception_except_termination() }
            .map_err(|_| JsTerminated::JSTerminated)
    }
}

unsafe extern "C" {
    fn JSC__AnyPromise__wrap(
        global: *mut JSGlobalObject,
        promise: JSValue,
        ctx: *mut c_void,
        f: extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/AnyPromise.zig (109 lines)
//   confidence: high
//   todos:      0
//   notes:      `wrap` reshaped from comptime ArgsTuple to FnOnce closure (Rust lacks fn-signature reflection); variants hold *mut (Zig *T) — GC-managed cells, not Rust borrows
// ──────────────────────────────────────────────────────────────────────────
