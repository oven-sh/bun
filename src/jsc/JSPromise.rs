use core::ffi::c_void;

use crate::bindgen::JsLocal;
use crate::{JSGlobalObject, JSValue, JsError, JsResult, VM};
// `jsc.Strong.Optional` collides with this module's own `Strong`, so import it under an alias.
use crate::strong::Optional as JscStrong;

bun_opaque::sealed_handle! {
    /// Opaque handle to a `JSC::JSPromise` cell. Always used by reference; never
    /// constructed or owned on the Rust side (GC-managed).
    pub struct JSPromise;
}

#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Status {
    /// Making this 0 so that we can change the status from Pending to others without masking.
    Pending = 0,
    Fulfilled = 1,
    Rejected = 2,
}

// `JSPromise` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles
// (so `&T` is ABI-identical to non-null `*const T` and C++ mutating through
// the pointer is interior mutation invisible to Rust). The shims that take
// only such handles + scalars are declared `safe fn`.
// `ctx` is an opaque round-trip pointer C++ only forwards to `call` (never
// dereferenced as Rust data).
unsafe extern "C" {
    safe fn JSC__JSPromise__create(arg0: &JSGlobalObject) -> Option<&JSPromise>;
    safe fn JSC__JSPromise__rejectedPromise(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> Option<&JSPromise>;
    safe fn JSC__JSPromise__resolvedPromise(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> Option<&JSPromise>;
    safe fn JSC__JSPromise__resolvedPromiseValue(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> JSValue;
    safe fn JSC__JSPromise__wrap(
        arg0: &JSGlobalObject,
        ctx: *mut c_void,
        call: extern "C" fn(*mut c_void, &JSGlobalObject) -> JSValue,
    ) -> JSValue;
    safe fn JSC__JSPromise__settleWith(
        this: &JSPromise,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        call: extern "C" fn(*mut c_void, &JSGlobalObject) -> JSValue,
    );

    safe fn JSC__JSPromise__status(this: &JSPromise) -> u32;
    safe fn JSC__JSPromise__result(this: &JSPromise, vm: &VM) -> JSValue;
    safe fn JSC__JSPromise__setHandled(this: &JSPromise);
    // The resolve/reject/rejectAsHandled shims are `void` on the C side
    // (bindings.cpp) — there is no bool sentinel on the wire; a pending
    // exception is surfaced by checking `global.has_exception()` after the
    // call.
}

// ───────────────────────────── JSPromise.Strong ──────────────────────────────

#[derive(Default)]
pub struct Strong {
    strong: JscStrong,
}

impl Strong {
    pub const fn empty() -> Self {
        Self {
            strong: JscStrong::empty(),
        }
    }

    pub fn reject(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) -> JsResult<()> {
        self.swap(global).reject(global, val)
    }

    /// The one way native code hands a conversion outcome to script: `Ok`
    /// resolves, `Err` rejects with the exception the failed conversion left
    /// pending (see [`JSPromise::resolve`]). Prefer this over
    /// `resolve(v.unwrap_or(..))`.
    pub fn settle(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) -> JsResult<()> {
        self.swap(global).settle(global, val)
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the top
    /// of the event loop (threadpool callback).
    pub fn reject_with_async_stack(
        &mut self,
        global: &JSGlobalObject,
        val: JsResult<JSValue>,
    ) -> JsResult<()> {
        let err = match val {
            Ok(v) => v,
            Err(_) => return self.reject(global, val),
        };
        err.attach_async_stack_from_promise(global, self.get());
        self.swap(global).reject(global, Ok(err))
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, val: JSValue) -> JsResult<()> {
        self.swap(global).resolve(global, val)
    }

    pub fn init(global: &JSGlobalObject) -> Self {
        Self {
            strong: JscStrong::create(JSPromise::create(global).to_js(), global),
        }
    }

    /// `JSPromise.Strong.strong.set` — re-seat the underlying handle slot to a
    /// new promise value (used when a pending load returns a promise that
    /// should replace the placeholder created by [`init`]).
    #[inline]
    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        self.strong.set(global, value);
    }

    /// Borrow the GC-rooted `JSPromise` cell. Panics if the strong slot is
    /// empty (use [`has_value`] to check first).
    pub fn get(&self) -> &JSPromise {
        let value = self.value();
        let promise: *const JSPromise = value.as_promise().unwrap();
        // SAFETY: the slot roots it, and only `&mut self` changes the slot.
        unsafe { &*promise }
    }

    pub fn value(&self) -> JSValue {
        self.strong.get().unwrap()
    }

    pub fn has_value(&self) -> bool {
        self.strong.has()
    }

    /// Releases the root: from here on the result is what keeps the promise alive.
    pub fn swap<'a>(&mut self, global: &'a JSGlobalObject) -> JsLocal<'a, JSPromise> {
        let promise = self.strong.swap().as_promise().unwrap().to_local(global);
        // Release the handle slot now.
        self.strong = JscStrong::empty();
        promise
    }

    pub fn take(&mut self) -> Self {
        core::mem::replace(self, Self::empty())
    }
}

// Cleanup is subsumed by `Drop` on `JscStrong`; no explicit `Drop` impl needed.

// ───────────────────────────── JSPromise methods ─────────────────────────────

extern "C" fn call_once<F>(ctx: *mut c_void, global: &JSGlobalObject) -> JSValue
where
    F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
{
    // SAFETY: `wrap` and `settle_with` pass an `Option<F>` on their stack, which outlives the call into C++.
    let f = unsafe { bun_ptr::callback_ctx::<Option<F>>(ctx) }
        .take()
        .unwrap();
    crate::to_js_host_call(global, move || f(global))
}

impl JSPromise {
    /// Wrap a fallible host call in a Promise: if `f` throws, the promise is
    /// rejected; otherwise it resolves with the returned value.
    //
    // The trampoline routes through `crate::to_js_host_call`, and the
    // surrounding `top_scope!` + `assert_no_exception_except_termination`
    // handle the exception-scope plumbing.
    pub fn wrap<F>(global: &JSGlobalObject, f: F) -> JsResult<JSValue>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        crate::top_scope!(scope, global);

        let mut f = Some(f);
        let promise = JSC__JSPromise__wrap(global, (&raw mut f).cast::<c_void>(), call_once::<F>);
        // JSC__JSPromise__wrap converts any thrown exception into a rejected promise, so the only
        // exception that can be pending here is the termination; it stays pending and unwinds.
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

        if let Some(err) = value.to_error() {
            return Self::rejected_promise(global, err).to_js();
        }

        Self::resolved_promise_value(global, value)
    }

    pub fn status(&self) -> Status {
        match JSC__JSPromise__status(self) {
            0 => Status::Pending,
            1 => Status::Fulfilled,
            2 => Status::Rejected,
            n => unreachable!("invalid JSPromise status {n}"),
        }
    }

    pub fn result(&self, vm: &VM) -> JSValue {
        JSC__JSPromise__result(self, vm)
    }

    pub fn set_handled(&self) {
        JSC__JSPromise__setHandled(self)
    }

    /// Create a new resolved promise resolving to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `resolved_promise_value` instead.
    pub fn resolved_promise(global: &JSGlobalObject, value: JSValue) -> JsLocal<'_, JSPromise> {
        JSC__JSPromise__resolvedPromise(global, value)
            .unwrap()
            .to_local(global)
    }

    /// Create a new promise with an already fulfilled value.
    /// This is the faster function for doing that.
    pub fn resolved_promise_value(global: &JSGlobalObject, value: JSValue) -> JSValue {
        JSC__JSPromise__resolvedPromiseValue(global, value)
    }

    /// Create a new rejected promise rejecting to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `rejected_promise().to_js()` instead.
    pub fn rejected_promise(global: &JSGlobalObject, value: JSValue) -> JsLocal<'_, JSPromise> {
        JSC__JSPromise__rejectedPromise(global, value)
            .unwrap()
            .to_local(global)
    }

    /// Create a new promise rejected with the exception `err` proves is pending,
    /// taking it off the VM. The reason is converted like [`reject`](Self::reject)
    /// does; a termination is propagated instead of becoming a reason.
    pub fn rejected_promise_with_caught_exception(
        global: &JSGlobalObject,
        err: JsError,
    ) -> JsResult<JsLocal<'_, JSPromise>> {
        let promise = Self::create(global);
        promise.reject(global, Err(err))?;
        Ok(promise)
    }

    /// Fulfill an existing promise with the value.
    /// The value can be another Promise.
    /// If you want to create a new Promise that is already resolved, see `resolved_promise_value`.
    // ── the native → promise boundary ─────────────────────────────────────
    //
    // Every settlement native code performs funnels through `resolve` / `reject` below (the `Strong`
    // methods delegate here). Native code that continues the script of a `Bun.ModuleGraph` that was
    // disposed settles nothing: that graph hears no more from the event loop, as a terminated
    // worker does not (`VirtualMachine::reports_to_nobody`). Settling enters JS and can throw (a thenable's `then`, stack overflow,
    // the VM's termination), so these return `JsResult<()>` with the exception pending, like any
    // other call into JS: a host function `?`s it; a loop-level completion folds it
    // (`report_error_or_terminate`). An empty `JSValue` is never a value — it means the producer's
    // conversion threw and left the exception pending; it becomes "reject with that exception",
    // except a pending termination, which is not an outcome to record: it stays pending and unwinds.

    pub fn resolve(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if value.is_empty() {
            debug_assert!(
                global.has_exception(),
                "resolve() with an empty JSValue and no pending exception"
            );
            return self.reject(global, Err(JsError::Thrown));
        }
        if global.bun_vm().reports_to_nobody() {
            return Ok(());
        }
        // `[[ZIG_EXPORT(check_slow)]]`
        crate::cpp::JSC__JSPromise__resolve(self, global, value)
    }

    /// See [`Strong::settle`].
    pub fn settle(&self, global: &JSGlobalObject, value: JsResult<JSValue>) -> JsResult<()> {
        match value {
            Ok(v) => self.resolve(global, v),
            Err(e) => self.reject(global, Err(e)),
        }
    }

    /// Settles with what `f` returns. A throw or an `ErrorInstance` rejects.
    pub fn settle_with<F>(&self, global: &JSGlobalObject, f: F) -> JsResult<()>
    where
        F: FnOnce(&JSGlobalObject) -> JsResult<JSValue>,
    {
        // As `JSPromise::resolve`: nothing is settled for a `Bun.ModuleGraph` that was disposed.
        if global.bun_vm().reports_to_nobody() {
            return Ok(());
        }
        crate::top_scope!(scope, global);

        let mut f = Some(f);
        JSC__JSPromise__settleWith(self, global, (&raw mut f).cast::<c_void>(), call_once::<F>);
        // C++ rejects with what was thrown, so only the termination can be pending: it unwinds.
        scope.assert_no_exception_except_termination()
    }

    pub fn reject(&self, global: &JSGlobalObject, value: JsResult<JSValue>) -> JsResult<()> {
        let err = match value {
            Ok(v) if v.is_empty() => {
                debug_assert!(
                    global.has_exception(),
                    "reject() with an empty JSValue and no pending exception"
                );
                return self.reject(global, Err(JsError::Thrown));
            }
            Ok(v) => v,
            // We can't use `global.take_exception()` because it throws an
            // out-of-memory error when we instead need to take the exception.
            Err(JsError::OutOfMemory) => global.create_out_of_memory_error(),
            // A termination is nothing to settle a promise with: already taken outside script…
            Err(JsError::Terminated) => return Err(JsError::Terminated),
            Err(JsError::Thrown) => {
                let exception = global.take_exception(JsError::Thrown);
                // …or still pending beneath script, where it keeps unwinding.
                if exception.is_termination_exception() {
                    return Err(crate::top_exception_scope::thrown(global));
                }
                exception.to_error().unwrap_or(exception)
            }
        };

        if global.bun_vm().reports_to_nobody() {
            return Ok(());
        }
        // `[[ZIG_EXPORT(check_slow)]]`
        crate::cpp::JSC__JSPromise__reject(self, global, err)
    }

    pub fn reject_as_handled(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        if value.is_empty() {
            self.set_handled();
            return self.reject(global, Ok(value));
        }
        if global.bun_vm().reports_to_nobody() {
            return Ok(());
        }
        // `[[ZIG_EXPORT(check_slow)]]`
        crate::cpp::JSC__JSPromise__rejectAsHandled(self, global, value)
    }

    /// Like `reject` but first attaches async stack frames from this promise's
    /// await chain to the error. Use when rejecting from native code at the top
    /// of the event loop (threadpool callback) where the error would otherwise
    /// have an empty stack trace.
    pub fn reject_with_async_stack(
        &self,
        global: &JSGlobalObject,
        value: JsResult<JSValue>,
    ) -> JsResult<()> {
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
    pub fn create(global: &JSGlobalObject) -> JsLocal<'_, JSPromise> {
        JSC__JSPromise__create(global).unwrap().to_local(global)
    }

    pub fn unwrap(&self, vm: &VM, mode: UnwrapMode) -> Unwrapped {
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
