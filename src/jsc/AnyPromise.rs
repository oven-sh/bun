use core::ffi::c_void;

use crate::{JSGlobalObject, JSInternalPromise, JSPromise, JSValue, VM};
use crate::js_promise::{Status, UnwrapMode, Unwrapped};
use crate::{JsTerminated, TopExceptionScope};

#[derive(Copy, Clone)]
pub enum AnyPromise<'a> {
    Normal(&'a JSPromise),
    Internal(&'a JSInternalPromise),
}

impl<'a> AnyPromise<'a> {
    pub fn unwrap(self, vm: &VM, mode: UnwrapMode) -> Unwrapped {
        match self {
            AnyPromise::Normal(promise) => promise.unwrap(vm, mode),
            AnyPromise::Internal(promise) => promise.unwrap(vm, mode),
        }
    }

    pub fn status(self) -> Status {
        match self {
            AnyPromise::Normal(promise) => promise.status(),
            AnyPromise::Internal(promise) => promise.status(),
        }
    }

    pub fn result(self, vm: &VM) -> JSValue {
        match self {
            AnyPromise::Normal(promise) => promise.result(vm),
            AnyPromise::Internal(promise) => promise.result(vm),
        }
    }

    pub fn is_handled(self) -> bool {
        match self {
            AnyPromise::Normal(promise) => promise.is_handled(),
            AnyPromise::Internal(promise) => promise.is_handled(),
        }
    }

    pub fn set_handled(self, vm: &VM) {
        let _ = vm;
        match self {
            AnyPromise::Normal(promise) => promise.set_handled(),
            AnyPromise::Internal(promise) => promise.set_handled(),
        }
    }

    pub fn resolve(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        match self {
            AnyPromise::Normal(promise) => promise.resolve(global_this, value),
            AnyPromise::Internal(promise) => promise.resolve(global_this, value),
        }
    }

    pub fn reject(self, global_this: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        match self {
            AnyPromise::Normal(promise) => promise.reject(global_this, value),
            AnyPromise::Internal(promise) => promise.reject(global_this, value),
        }
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the
    /// top of the event loop. JSInternalPromise subclasses JSPromise in C++,
    /// so both variants are handled.
    pub fn reject_with_async_stack(
        self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        value.attach_async_stack_from_promise(global_this, self.as_js_promise());
        self.reject(global_this, value)
    }

    /// JSInternalPromise subclasses JSPromise in C++ — this cast is safe for
    /// any C++ function taking JSPromise*.
    pub fn as_js_promise(self) -> &'a JSPromise {
        match self {
            AnyPromise::Normal(p) => p,
            AnyPromise::Internal(p) => {
                // SAFETY: JSInternalPromise subclasses JSPromise in C++; the
                // pointer reinterpretation is valid for any C++ API taking JSPromise*.
                unsafe { &*(p as *const JSInternalPromise as *const JSPromise) }
            }
        }
    }

    pub fn reject_as_handled(
        self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        match self {
            AnyPromise::Normal(promise) => promise.reject_as_handled(global_this, value),
            AnyPromise::Internal(promise) => promise.reject_as_handled(global_this, value),
        }
    }

    pub fn as_value(self) -> JSValue {
        match self {
            AnyPromise::Normal(promise) => promise.to_js(),
            AnyPromise::Internal(promise) => promise.to_js(),
        }
    }

    // TODO(port): the Zig `wrap` uses `std.meta.ArgsTuple(@TypeOf(Function))`
    // to accept any host function + its argument tuple and forward through
    // `jsc.toJSHostCall`. Rust has no equivalent compile-time fn-signature
    // reflection. Phase B: replace with a `#[bun_jsc::wrap_promise]` proc-macro
    // or accept a closure. The closure form below preserves the FFI shape.
    pub fn wrap<F>(
        self,
        global_object: &JSGlobalObject,
        f: F,
    ) -> Result<(), JsTerminated>
    where
        F: FnMut(&JSGlobalObject) -> JSValue,
    {
        struct Wrapper<F> {
            f: F,
        }

        extern "C" fn call<F>(wrap_: *mut c_void, global: *mut JSGlobalObject) -> JSValue
        where
            F: FnMut(&JSGlobalObject) -> JSValue,
        {
            // SAFETY: `wrap_` is `&mut Wrapper<F>` passed below; `global` is a
            // live JSGlobalObject* supplied by JSC for the duration of the call.
            let wrap_ = unsafe { &mut *(wrap_ as *mut Wrapper<F>) };
            let global = unsafe { &*global };
            // TODO(port): Zig routed through `jsc.toJSHostCall(global, @src(), Fn, args)`
            // which installs the host-call exception handling around the invocation.
            (wrap_.f)(global)
        }

        // TODO(port): @src() source-location plumbing for TopExceptionScope.
        let scope = TopExceptionScope::init(global_object);
        let mut ctx = Wrapper { f };
        // SAFETY: `ctx` lives on the stack for the duration of the FFI call;
        // `call::<F>` matches the expected `extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue` shape.
        unsafe {
            JSC__AnyPromise__wrap(
                global_object as *const _ as *mut JSGlobalObject,
                self.as_value(),
                &mut ctx as *mut Wrapper<F> as *mut c_void,
                call::<F>,
            );
        }
        scope.assert_no_exception_except_termination()
    }
}

// TODO(port): move to jsc_sys
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
//   confidence: medium
//   todos:      4
//   notes:      `wrap` reshaped to closure (Zig used ArgsTuple reflection); JsTerminated error type assumed in crate
// ──────────────────────────────────────────────────────────────────────────
