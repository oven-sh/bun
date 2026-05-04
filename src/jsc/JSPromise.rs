use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use bun_str::String as BunString;

use crate::{JSGlobalObject, JSValue, JsError, JsResult, VM};
// `jsc.Strong.Optional` and `jsc.Weak(T)` collide with this module's own `Strong`/`Weak`,
// so import them under aliases.
use crate::Strong as JscStrong;
use crate::Weak as JscWeak;
use crate::{JsTerminated, VirtualMachine};

/// Opaque handle to a `JSC::JSPromise` cell. Always used by reference; never
/// constructed or owned on the Rust side (GC-managed).
#[repr(C)]
pub struct JSPromise {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status {
    /// Making this 0 so that we can change the status from Pending to others without masking.
    Pending = 0,
    Fulfilled = 1,
    Rejected = 2,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn JSC__JSPromise__create(arg0: *mut JSGlobalObject) -> *mut JSPromise;
    fn JSC__JSPromise__rejectedPromise(arg0: *mut JSGlobalObject, js_value1: JSValue) -> *mut JSPromise;
    /// **DEPRECATED** This function does not notify the VM about the rejection,
    /// meaning it will not trigger unhandled rejection handling. Use
    /// `JSC__JSPromise__rejectedPromise` instead.
    fn JSC__JSPromise__rejectedPromiseValue(arg0: *mut JSGlobalObject, js_value1: JSValue) -> JSValue;
    fn JSC__JSPromise__resolvedPromise(arg0: *mut JSGlobalObject, js_value1: JSValue) -> *mut JSPromise;
    fn JSC__JSPromise__resolvedPromiseValue(arg0: *mut JSGlobalObject, js_value1: JSValue) -> JSValue;
    fn JSC__JSPromise__wrap(
        arg0: *mut JSGlobalObject,
        ctx: *mut c_void,
        call: extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue,
    ) -> JSValue;

    // Referenced via `bun.cpp.*` in the Zig — declared here for Phase A.
    fn JSC__JSPromise__status(this: *const JSPromise) -> u32;
    fn JSC__JSPromise__result(this: *mut JSPromise, vm: *mut VM) -> JSValue;
    fn JSC__JSPromise__isHandled(this: *const JSPromise) -> bool;
    fn JSC__JSPromise__setHandled(this: *mut JSPromise);
    // TODO(port): these three return `bun.JSError!void` across FFI in Zig (via the
    // generated `bun.cpp` shims). The actual C ABI is a bool/int sentinel — Phase B
    // must confirm the exact return encoding.
    fn JSC__JSPromise__resolve(this: *mut JSPromise, global: *mut JSGlobalObject, value: JSValue) -> bool;
    fn JSC__JSPromise__reject(this: *mut JSPromise, global: *mut JSGlobalObject, value: JSValue) -> bool;
    fn JSC__JSPromise__rejectAsHandled(this: *mut JSPromise, global: *mut JSGlobalObject, value: JSValue) -> bool;
}

// ───────────────────────────── JSPromise.Weak(T) ─────────────────────────────

/// Zig: `pub fn Weak(comptime T: type) type { return struct { ... } }`
pub struct Weak<T> {
    weak: JscWeak<T>,
}

impl<T> Default for Weak<T> {
    fn default() -> Self {
        Self { weak: JscWeak::default() }
    }
}

impl<T> Weak<T> {
    pub fn reject(&mut self, global: &JSGlobalObject, val: JSValue) {
        // TODO(port): Zig discards the `JSTerminated` from `JSPromise::reject` here
        // (return type is `void`). Mirror that by ignoring the Result.
        let _ = self.swap().reject(global, Ok(val));
    }

    /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
    pub fn reject_task(&mut self, global: &JSGlobalObject, val: JSValue) {
        let loop_ = VirtualMachine::get().event_loop();
        loop_.enter();
        let _guard = scopeguard::guard((), |_| loop_.exit());
        // PORT NOTE: `defer loop.exit()` → scopeguard; `exit()` is a side effect, not a free.
        self.reject(global, val);
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, val: JSValue) {
        let _ = self.swap().resolve(global, val);
    }

    /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
    pub fn resolve_task(&mut self, global: &JSGlobalObject, val: JSValue) {
        let loop_ = VirtualMachine::get().event_loop();
        loop_.enter();
        let _guard = scopeguard::guard((), |_| loop_.exit());
        self.resolve(global, val);
    }

    pub fn init(
        global: &JSGlobalObject,
        promise: JSValue,
        ctx: &mut T,
        // PERF(port): was comptime monomorphization — profile in Phase B
        finalizer: fn(&mut T, JSValue),
    ) -> Self {
        Self {
            weak: JscWeak::<T>::create(promise, global, ctx, finalizer),
        }
    }

    pub fn get(&self) -> &mut JSPromise {
        self.weak.get().unwrap().as_promise().unwrap()
    }

    pub fn get_or_null(&self) -> Option<&mut JSPromise> {
        let promise_value = self.weak.get()?;
        promise_value.as_promise()
    }

    pub fn value(&self) -> JSValue {
        self.weak.get().unwrap()
    }

    pub fn value_or_empty(&self) -> JSValue {
        self.weak.get().unwrap_or(JSValue::ZERO)
    }

    pub fn swap(&mut self) -> &mut JSPromise {
        let prom = self.weak.swap().as_promise().unwrap();
        // Zig: `this.weak.deinit()` — drop the underlying weak handle now.
        self.weak = JscWeak::default();
        prom
    }
}

// Zig `deinit` only does `this.weak.clear(); this.weak.deinit();` — both are
// subsumed by `Drop` on `JscWeak<T>`. No explicit `Drop` impl needed.

// ───────────────────────────── JSPromise.Strong ──────────────────────────────

#[derive(Default)]
pub struct Strong {
    strong: JscStrong,
}

impl Strong {
    pub const EMPTY: Self = Self { strong: JscStrong::EMPTY };

    pub fn reject_without_swap(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) {
        let Some(v) = self.strong.get() else { return };
        let val = val.unwrap_or_else(|_| global.try_take_exception().unwrap());
        let _ = v.as_promise().unwrap().reject(global, Ok(val));
    }

    pub fn resolve_without_swap(&mut self, global: &JSGlobalObject, val: JSValue) {
        let Some(v) = self.strong.get() else { return };
        let _ = v.as_promise().unwrap().resolve(global, val);
    }

    pub fn reject(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) -> Result<(), JsTerminated> {
        let val = val.unwrap_or_else(|_| global.try_take_exception().unwrap());
        self.swap().reject(global, Ok(val))
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the top
    /// of the event loop (threadpool callback).
    pub fn reject_with_async_stack(
        &mut self,
        global: &JSGlobalObject,
        val: JsResult<JSValue>,
    ) -> Result<(), JsTerminated> {
        let err = match val {
            Ok(v) => v,
            Err(_) => return self.reject(global, val),
        };
        err.attach_async_stack_from_promise(global, self.get());
        self.swap().reject(global, Ok(err))
    }

    /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
    pub fn reject_task(&mut self, global: &JSGlobalObject, val: JSValue) -> Result<(), JsTerminated> {
        let loop_ = VirtualMachine::get().event_loop();
        loop_.enter();
        let _guard = scopeguard::guard((), |_| loop_.exit());
        self.reject(global, Ok(val))
    }

    // Zig: `pub const rejectOnNextTick = @compileError("...")`
    // TODO(port): @compileError poison-decl has no direct Rust equivalent. Relying on
    // the method simply not existing; callers will fail to compile. Phase B may add a
    // `#[deprecated(note = "...")]` shim if needed for migration error messages.

    pub fn resolve(&mut self, global: &JSGlobalObject, val: JSValue) -> Result<(), JsTerminated> {
        self.swap().resolve(global, val)
    }

    /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
    pub fn resolve_task(&mut self, global: &JSGlobalObject, val: JSValue) -> Result<(), JsTerminated> {
        let loop_ = VirtualMachine::get().event_loop();
        loop_.enter();
        let _guard = scopeguard::guard((), |_| loop_.exit());
        self.resolve(global, val)
    }

    pub fn init(global: &JSGlobalObject) -> Self {
        Self {
            strong: JscStrong::create(JSPromise::create(global).to_js(), global),
        }
    }

    pub fn get(&self) -> &mut JSPromise {
        self.strong.get().unwrap().as_promise().unwrap()
    }

    pub fn value(&self) -> JSValue {
        self.strong.get().unwrap()
    }

    pub fn value_or_empty(&self) -> JSValue {
        self.strong.get().unwrap_or(JSValue::ZERO)
    }

    pub fn has_value(&self) -> bool {
        self.strong.has()
    }

    pub fn swap(&mut self) -> &mut JSPromise {
        let prom = self.strong.swap().as_promise().unwrap();
        // Zig: `this.strong.deinit()` — release the handle slot now.
        self.strong = JscStrong::EMPTY;
        prom
    }

    pub fn take(&mut self) -> Self {
        core::mem::replace(self, Self::EMPTY)
    }
}

// Zig `deinit` only does `this.strong.deinit()` — subsumed by `Drop` on `JscStrong`.

// ───────────────────────────── JSPromise methods ─────────────────────────────

impl JSPromise {
    #[inline]
    pub fn to_js(&self) -> JSValue {
        JSValue::from_cell(self)
    }

    /// Wrap a fallible host call in a Promise: if `f` throws, the promise is
    /// rejected; otherwise it resolves with the returned value.
    ///
    /// Zig signature took `comptime Function: anytype` + `args: ArgsTuple(@TypeOf(Function))`
    /// and built a `callconv(.c)` trampoline via `jsc.toJSHostCall`. That is the
    /// host-fn reflection pattern — in Rust it collapses to a monomorphized closure
    /// + extern-C trampoline.
    // TODO(port): proc-macro — the Zig version threads `@src()` and uses
    // `jsc.toJSHostCall` for exception-scope plumbing. Phase B should verify the
    // closure form below is ABI-equivalent or replace with `#[bun_jsc::host_fn]`.
    pub fn wrap<F>(global: &JSGlobalObject, f: F) -> Result<JSValue, JsTerminated>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        struct Wrapper<F> {
            f: Option<F>,
        }

        extern "C" fn call<F>(this: *mut c_void, g: *mut JSGlobalObject) -> JSValue
        where
            F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
        {
            // SAFETY: `this` is `&mut Wrapper<F>` passed below; `g` is a live JSGlobalObject.
            let this = unsafe { &mut *(this as *mut Wrapper<F>) };
            let g = unsafe { &*g };
            crate::to_js_host_call(g, (this.f.take().unwrap())(g))
        }

        let scope = crate::TopExceptionScope::init(global);
        let mut ctx = Wrapper { f: Some(f) };
        // SAFETY: `ctx` outlives the synchronous FFI call; `call::<F>` matches the
        // expected `extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue` signature.
        let promise = unsafe {
            JSC__JSPromise__wrap(
                global as *const _ as *mut _,
                &mut ctx as *mut _ as *mut c_void,
                call::<F>,
            )
        };
        scope.assert_no_exception_except_termination()?;
        Ok(promise)
    }

    pub fn wrap_value(global: &JSGlobalObject, value: JSValue) -> JSValue {
        if value.is_empty() {
            return Self::resolved_promise_value(global, JSValue::UNDEFINED);
        } else if value.is_empty_or_undefined_or_null() || !value.is_cell() {
            return Self::resolved_promise_value(global, value);
        }

        if value.js_type() == crate::JSType::JSPromise {
            return value;
        }

        if value.is_any_error() {
            return Self::dangerously_create_rejected_promise_value_without_notifying_vm(global, value);
        }

        Self::resolved_promise_value(global, value)
    }

    pub fn status(&self) -> Status {
        // SAFETY: `self` is a valid `*const JSPromise`; result is one of {0,1,2}.
        unsafe { core::mem::transmute::<u32, Status>(JSC__JSPromise__status(self)) }
    }

    pub fn result(&mut self, vm: &mut VM) -> JSValue {
        // SAFETY: both pointers are valid for the duration of the call.
        unsafe { JSC__JSPromise__result(self, vm) }
    }

    pub fn is_handled(&self) -> bool {
        // SAFETY: `self` is a valid `*const JSPromise`.
        unsafe { JSC__JSPromise__isHandled(self) }
    }

    pub fn set_handled(&mut self) {
        // SAFETY: `self` is a valid `*mut JSPromise`.
        unsafe { JSC__JSPromise__setHandled(self) }
    }

    /// Create a new resolved promise resolving to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `resolved_promise_value` instead.
    pub fn resolved_promise(global: &JSGlobalObject, value: JSValue) -> &mut JSPromise {
        // SAFETY: FFI returns a non-null GC-managed cell tied to `global`'s VM.
        unsafe { &mut *JSC__JSPromise__resolvedPromise(global as *const _ as *mut _, value) }
    }

    /// Create a new promise with an already fulfilled value.
    /// This is the faster function for doing that.
    pub fn resolved_promise_value(global: &JSGlobalObject, value: JSValue) -> JSValue {
        // SAFETY: trivial FFI call.
        unsafe { JSC__JSPromise__resolvedPromiseValue(global as *const _ as *mut _, value) }
    }

    /// Create a new rejected promise rejecting to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `rejected_promise().to_js()` instead.
    pub fn rejected_promise(global: &JSGlobalObject, value: JSValue) -> &mut JSPromise {
        // SAFETY: FFI returns a non-null GC-managed cell tied to `global`'s VM.
        unsafe { &mut *JSC__JSPromise__rejectedPromise(global as *const _ as *mut _, value) }
    }

    /// **DEPRECATED** use `rejected_promise` instead.
    ///
    /// Create a new rejected promise without notifying the VM. Unhandled
    /// rejections created this way will not trigger unhandled rejection handling.
    pub fn dangerously_create_rejected_promise_value_without_notifying_vm(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JSValue {
        // SAFETY: trivial FFI call.
        unsafe { JSC__JSPromise__rejectedPromiseValue(global as *const _ as *mut _, value) }
    }

    /// Fulfill an existing promise with the value.
    /// The value can be another Promise.
    /// If you want to create a new Promise that is already resolved, see `resolved_promise_value`.
    pub fn resolve(&mut self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        #[cfg(debug_assertions)]
        {
            let loop_ = VirtualMachine::get().event_loop();
            loop_.debug.js_call_count_outside_tick_queue +=
                (!loop_.debug.is_inside_tick_queue) as usize;
            if loop_.debug.track_last_fn_name && !loop_.debug.is_inside_tick_queue {
                loop_.debug.last_fn_name = BunString::static_("resolve");
            }
        }

        // SAFETY: `self` and `global` are valid; FFI may run JS (microtasks).
        let ok = unsafe { JSC__JSPromise__resolve(self, global as *const _ as *mut _, value) };
        if !ok {
            return Err(JsTerminated);
        }
        Ok(())
    }

    pub fn reject(&mut self, global: &JSGlobalObject, value: JsResult<JSValue>) -> Result<(), JsTerminated> {
        #[cfg(debug_assertions)]
        {
            let loop_ = VirtualMachine::get().event_loop();
            loop_.debug.js_call_count_outside_tick_queue +=
                (!loop_.debug.is_inside_tick_queue) as usize;
            if loop_.debug.track_last_fn_name && !loop_.debug.is_inside_tick_queue {
                loop_.debug.last_fn_name = BunString::static_("reject");
            }
        }

        let err = match value {
            Ok(v) => v,
            // We can't use `global.take_exception()` because it throws an
            // out-of-memory error when we instead need to take the exception.
            Err(JsError::OutOfMemory) => global.create_out_of_memory_error(),
            Err(JsError::Terminated) => return Ok(()),
            Err(_) => 'err: {
                let Some(exception) = global.try_take_exception() else {
                    panic!(
                        "A JavaScript exception was thrown, but it was cleared before it could be read."
                    );
                };
                break 'err exception.to_error().unwrap_or(exception);
            }
        };

        // SAFETY: `self` and `global` are valid; FFI may run JS (microtasks).
        let ok = unsafe { JSC__JSPromise__reject(self, global as *const _ as *mut _, err) };
        if !ok {
            return Err(JsTerminated);
        }
        Ok(())
    }

    pub fn reject_as_handled(&mut self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        // SAFETY: `self` and `global` are valid; FFI may run JS.
        let ok = unsafe { JSC__JSPromise__rejectAsHandled(self, global as *const _ as *mut _, value) };
        if !ok {
            return Err(JsTerminated);
        }
        Ok(())
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the top
    /// of the event loop (threadpool callback) where the error would otherwise
    /// have an empty stack trace.
    pub fn reject_with_async_stack(
        &mut self,
        global: &JSGlobalObject,
        value: JsResult<JSValue>,
    ) -> Result<(), JsTerminated> {
        let err = match value {
            Ok(v) => v,
            Err(_) => return self.reject(global, value),
        };
        err.attach_async_stack_from_promise(global, self);
        self.reject(global, Ok(err))
    }

    /// Create a new pending promise.
    ///
    /// Note: You should use `resolved_promise` or `rejected_promise` if you want
    /// to create a promise that is already resolved or rejected.
    pub fn create(global: &JSGlobalObject) -> &mut JSPromise {
        // SAFETY: FFI returns a non-null GC-managed cell tied to `global`'s VM.
        unsafe { &mut *JSC__JSPromise__create(global as *const _ as *mut _) }
    }

    /// **DEPRECATED** use `to_js` instead.
    pub fn as_value(&self, _global: &JSGlobalObject) -> JSValue {
        self.to_js()
    }

    pub fn unwrap(&mut self, vm: &mut VM, mode: UnwrapMode) -> Unwrapped {
        match self.status() {
            Status::Pending => Unwrapped::Pending,
            Status::Fulfilled => Unwrapped::Fulfilled(self.result(vm)),
            Status::Rejected => {
                if mode == UnwrapMode::MarkHandled {
                    self.set_handled();
                }
                Unwrapped::Rejected(self.result(vm))
            }
        }
    }
}

pub enum Unwrapped {
    Pending,
    Fulfilled(JSValue),
    Rejected(JSValue),
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum UnwrapMode {
    MarkHandled,
    LeaveUnhandled,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/JSPromise.zig (372 lines)
//   confidence: medium
//   todos:      5
//   notes:      `wrap()` reshaped from comptime ArgsTuple+toJSHostCall to FnOnce+trampoline; bun.cpp FFI return encoding (bool vs JSError) needs Phase-B verification; `JsTerminated`/`JscWeak`/`JscStrong` API surface assumed.
// ──────────────────────────────────────────────────────────────────────────
