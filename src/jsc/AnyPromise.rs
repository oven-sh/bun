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

// S012: every method body is `match self { Variant(p) => (*p).foo() }` over a
// ZST opaque (`JSPromise` is `bun_opaque::opaque_ffi!`). Route the per-variant
// `*mut → &mut` deref through the const-asserted `opaque_deref_mut` so the
// dispatch site is `unsafe`-free; the soundness proof lives once in
// `bun_opaque`.
macro_rules! any_promise_dispatch {
    ($self:expr, |$p:ident| $body:expr) => {
        match $self {
            Self::Normal(ptr) => {
                let $p = JSPromise::opaque_mut(ptr);
                $body
            }
            Self::Internal(ptr) => {
                let $p = JSInternalPromise::opaque_mut(ptr);
                $body
            }
        }
    };
}

impl AnyPromise {
    #[inline]
    pub fn unwrap(self, vm: &VM, mode: UnwrapMode) -> Unwrapped {
        any_promise_dispatch!(self, |p| p.unwrap(vm, mode))
    }

    #[inline]
    pub fn status(self) -> Status {
        any_promise_dispatch!(self, |p| p.status())
    }

    #[inline]
    pub fn result(self, vm: &VM) -> JSValue {
        any_promise_dispatch!(self, |p| p.result(vm))
    }

    #[inline]
    pub fn is_handled(self) -> bool {
        any_promise_dispatch!(self, |p| p.is_handled())
    }

    #[inline]
    pub fn set_handled(self, vm: &VM) {
        let _ = vm;
        any_promise_dispatch!(self, |p| p.set_handled())
    }

    #[inline]
    pub fn resolve(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        any_promise_dispatch!(self, |p| p.resolve(global_this, value))
    }

    #[inline]
    pub fn reject(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // Zig: `promise.reject(globalThis, value)` — `JSValue` coerces to `JSError!JSValue`
        // implicitly in Zig; map that with `Ok(value)` here.
        any_promise_dispatch!(self, |p| p.reject(global_this, Ok(value)))
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
        value.attach_async_stack_from_promise(
            global_this,
            JSPromise::opaque_ref(self.as_js_promise()),
        );
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
        any_promise_dispatch!(self, |p| p.reject_as_handled(global_this, value))
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

        extern "C" fn call<F>(wrap_: *mut c_void, global: &JSGlobalObject) -> JSValue
        where
            F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
        {
            // SAFETY: `wrap_` is `&mut Wrapper<F>` passed below; `global` is a
            // live JSGlobalObject* supplied by JSC for the duration of the
            // call (`&T` ≡ non-null `*const T` at the C ABI).
            let wrap_ = unsafe { bun_ptr::callback_ctx::<Wrapper<F>>(wrap_) };
            let f = wrap_.f.take().expect("AnyPromise::wrap called twice");
            // Zig: `jsc.toJSHostCall(global, @src(), Fn, wrap_.args)` — installs the
            // host-call exception/return-value validation around the invocation.
            // `to_js_host_call` is `#[track_caller]`, so `@src()` is propagated.
            to_js_host_call(global, move || f(global))
        }

        // Zig: `var scope: jsc.TopExceptionScope = undefined; scope.init(global, @src()); defer scope.deinit();`
        crate::top_scope!(scope, global_object);

        let mut ctx = Wrapper { f: Some(f) };
        // `ctx` lives on the stack for the duration of the synchronous FFI call;
        // `call::<F>` matches the expected `extern "C" fn(*mut c_void, &JSGlobalObject) -> JSValue`
        // shape.
        JSC__AnyPromise__wrap(
            global_object,
            self.as_value(),
            (&raw mut ctx).cast::<c_void>(),
            call::<F>,
        );
        // C++ converts any thrown exception into a rejection, so a pending non-termination
        // exception here indicates a bug; surface termination as JsTerminated.
        scope
            .assert_no_exception_except_termination()
            .map_err(|_| JsTerminated::JSTerminated)
    }
}

unsafe extern "C" {
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to a non-null `*mut` and C++ mutation is interior to the cell);
    // `ctx` is an opaque round-trip pointer C++ only forwards to `f` (never
    // dereferenced as Rust data).
    safe fn JSC__AnyPromise__wrap(
        global: &JSGlobalObject,
        promise: JSValue,
        ctx: *mut c_void,
        f: extern "C" fn(*mut c_void, &JSGlobalObject) -> JSValue,
    );
}

// ported from: src/jsc/AnyPromise.zig
