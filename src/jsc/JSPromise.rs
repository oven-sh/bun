use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use bun_core::String as BunString;

use crate::{JSGlobalObject, JSValue, JsError, JsResult, VM};
// `jsc.Strong.Optional` and `jsc.Weak(T)` collide with this module's own `Strong`/`Weak`,
// so import them under aliases.
use crate::strong::Optional as JscStrong;
use crate::top_exception_scope::SourceLocation;
use crate::virtual_machine::VirtualMachine;
use crate::weak::{Weak as JscWeak, WeakRefType};
use crate::{JsTerminated, TopExceptionScope};

bun_opaque::opaque_ffi! {
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

// TODO(port): move to jsc_sys
//
// `JSPromise` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles
// (so `&T` is ABI-identical to non-null `*const T` and C++ mutating through
// the pointer is interior mutation invisible to Rust). The shims that take
// only such handles + scalars are declared `safe fn`. `JSC__JSPromise__wrap`'s
// `ctx` is an opaque round-trip pointer C++ only forwards to `call` (never
// dereferenced as Rust data); the `*mut JSPromise`-returning constructors stay
// raw (caller derefs).
unsafe extern "C" {
    safe fn JSC__JSPromise__create(arg0: &JSGlobalObject) -> *mut JSPromise;
    safe fn JSC__JSPromise__rejectedPromise(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> *mut JSPromise;
    /// **DEPRECATED** This function does not notify the VM about the rejection,
    /// meaning it will not trigger unhandled rejection handling. Use
    /// `JSC__JSPromise__rejectedPromise` instead.
    safe fn JSC__JSPromise__rejectedPromiseValue(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> JSValue;
    safe fn JSC__JSPromise__resolvedPromise(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> *mut JSPromise;
    safe fn JSC__JSPromise__resolvedPromiseValue(
        arg0: &JSGlobalObject,
        js_value1: JSValue,
    ) -> JSValue;
    safe fn JSC__JSPromise__wrap(
        arg0: &JSGlobalObject,
        ctx: *mut c_void,
        call: extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue,
    ) -> JSValue;

    // Referenced via `bun.cpp.*` in the Zig — declared here for Phase A.
    safe fn JSC__JSPromise__status(this: &JSPromise) -> u32;
    safe fn JSC__JSPromise__result(this: &mut JSPromise, vm: &VM) -> JSValue;
    safe fn JSC__JSPromise__isHandled(this: &JSPromise) -> bool;
    safe fn JSC__JSPromise__setHandled(this: &mut JSPromise);
    // These three are `void` on the C side (bindings.cpp). The Zig `bun.cpp.*`
    // wrappers (build/debug/codegen/cpp.zig) call the void extern and then do
    // `Bun__RETURN_IF_EXCEPTION(global)` to surface `error.JSError` — there is
    // no bool sentinel on the wire. Mirror that by checking `global.has_exception()`
    // after the call.
    safe fn JSC__JSPromise__resolve(this: &mut JSPromise, global: &JSGlobalObject, value: JSValue);
    safe fn JSC__JSPromise__reject(this: &mut JSPromise, global: &JSGlobalObject, value: JSValue);
    safe fn JSC__JSPromise__rejectAsHandled(
        this: &mut JSPromise,
        global: &JSGlobalObject,
        value: JSValue,
    );
}

// ───────────────────────────── JSPromise.Weak(T) ─────────────────────────────

/// Zig: `pub fn Weak(comptime T: type) type { return struct { ... } }`
pub struct Weak<T> {
    weak: JscWeak<T>,
}

impl<T> Default for Weak<T> {
    fn default() -> Self {
        Self {
            weak: JscWeak::default(),
        }
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
        // RAII for Zig's `loop.enter(); defer loop.exit();` — the safe wrapper
        // funnels through the single audited deref in `enter_event_loop_scope`.
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        self.reject(global, val);
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, val: JSValue) {
        let _ = self.swap().resolve(global, val);
    }

    /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
    pub fn resolve_task(&mut self, global: &JSGlobalObject, val: JSValue) {
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        self.resolve(global, val);
    }

    pub fn init(
        global: &JSGlobalObject,
        promise: JSValue,
        ref_type: WeakRefType,
        ctx: &mut T,
    ) -> Self {
        // PORT NOTE: Zig threaded a `comptime finalizer` fn-ptr; the Rust
        // `Weak<T>` encodes that via `WeakRefType` (one variant per finalizer
        // — see Weak.rs). PERF(port): was comptime monomorphization.
        Self {
            weak: JscWeak::<T>::create(promise, global, ref_type, ctx),
        }
    }

    /// Borrow the GC-rooted `JSPromise` cell. Panics if the weak slot is empty
    /// or no longer a promise.
    ///
    /// Safe because `JSPromise` is an `opaque_ffi!` ZST handle: a `&mut` to it
    /// covers zero bytes (see [`bun_opaque::opaque_deref_mut`] for the proof),
    /// so two callers cannot alias any Rust-visible memory. The pointer comes
    /// from the JSValue payload (not derived from `&self`) and the weak ref
    /// keeps the cell observable while held.
    pub fn get(&self) -> &mut JSPromise {
        JSPromise::opaque_mut(self.weak.get().unwrap().as_promise().unwrap())
    }

    /// See [`get`]; returns `None` instead of panicking when the slot is empty.
    pub fn get_or_null(&self) -> Option<&mut JSPromise> {
        let promise_value = self.weak.get()?;
        promise_value.as_promise().map(JSPromise::opaque_mut)
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
        // `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell;
        // GC-owned, so the resulting `&mut` is a resolver-style accessor (see `get`).
        JSPromise::opaque_mut(prom)
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
    pub const fn empty() -> Self {
        Self {
            strong: JscStrong::empty(),
        }
    }

    pub fn reject_without_swap(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) {
        let Some(v) = self.strong.get() else { return };
        let val = val.unwrap_or_else(|_| global.try_take_exception().unwrap());
        let _ = JSPromise::opaque_mut(v.as_promise().unwrap()).reject(global, Ok(val));
    }

    pub fn resolve_without_swap(&mut self, global: &JSGlobalObject, val: JSValue) {
        let Some(v) = self.strong.get() else { return };
        let _ = JSPromise::opaque_mut(v.as_promise().unwrap()).resolve(global, val);
    }

    pub fn reject(
        &mut self,
        global: &JSGlobalObject,
        val: JsResult<JSValue>,
    ) -> Result<(), JsTerminated> {
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
    pub fn reject_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), JsTerminated> {
        // RAII for Zig's `loop.enter(); defer loop.exit();` — the safe wrapper
        // funnels through the single audited deref in `enter_event_loop_scope`.
        let _guard = VirtualMachine::get().enter_event_loop_scope();
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
    pub fn resolve_task(
        &mut self,
        global: &JSGlobalObject,
        val: JSValue,
    ) -> Result<(), JsTerminated> {
        let _guard = VirtualMachine::get().enter_event_loop_scope();
        self.resolve(global, val)
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

    /// Wrap an existing promise `JSValue` in a fresh Strong handle.
    /// PORT NOTE: Zig copies `JSPromise.Strong` by value (HandleSlot ptr is
    /// shared); Rust `Strong` owns its slot, so a literal copy would
    /// double-free. Callers that need a second owner of the same promise
    /// (e.g. `bake::DevServer::PromiseEnsureRouteBundledCtx::ensurePromise`)
    /// allocate a second slot here instead.
    pub fn from_value(value: JSValue, global: &JSGlobalObject) -> Self {
        // No `as_promise()` debug-check here: this is reached from finalizers
        // (Server::deinit_if_we_can) where JSCell::classInfo() would assert.
        Self {
            strong: JscStrong::create(value, global),
        }
    }

    /// Borrow the GC-rooted `JSPromise` cell. Panics if the strong slot is
    /// empty (use [`has_value`] to check first).
    ///
    /// Safe because `JSPromise` is an `opaque_ffi!` ZST handle: a `&mut` to it
    /// covers zero bytes (see [`bun_opaque::opaque_deref_mut`] for the proof),
    /// so the resolver-style accessor cannot alias any Rust-visible memory.
    /// The pointer is the JSValue payload (not derived from `&self`) and the
    /// `Strong` root keeps the cell alive for the borrow's lifetime.
    pub fn get(&self) -> &mut JSPromise {
        JSPromise::opaque_mut(self.strong.get().unwrap().as_promise().unwrap())
    }

    pub fn value(&self) -> JSValue {
        self.strong.get().unwrap()
    }

    /// Debug-only raw handle pointer for corruption probes (#53265).
    #[doc(hidden)]
    #[inline]
    pub fn handle_ptr(&self) -> *const () {
        self.strong.handle_ptr()
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
        self.strong = JscStrong::empty();
        // `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell;
        // GC-owned, so the resulting `&mut` is a resolver-style accessor (see `get`).
        JSPromise::opaque_mut(prom)
    }

    pub fn take(&mut self) -> Self {
        core::mem::replace(self, Self::empty())
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
            // SAFETY: `this` is `&mut Wrapper<F>` passed below.
            let this = unsafe { bun_ptr::callback_ctx::<Wrapper<F>>(this) };
            // `g` is a live JSGlobalObject; safe ZST-handle deref (panics on null).
            let g = JSGlobalObject::opaque_ref(g);
            let f = this.f.take().unwrap();
            // Zig: `jsc.toJSHostCall(g, @src(), Fn, this.args)` — `@src()` mapped to
            // `Location::caller()` (resolves to this trampoline's call site).
            crate::to_js_host_call(g, move || f(g))
        }

        // Zig: `var scope: jsc.TopExceptionScope = undefined; scope.init(global, @src()); defer scope.deinit();`
        crate::top_scope!(scope, global);

        let mut ctx = Wrapper { f: Some(f) };
        // `ctx` outlives the synchronous FFI call; `call::<F>` matches the expected
        // `extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue` signature.
        let promise = JSC__JSPromise__wrap(global, (&raw mut ctx).cast::<c_void>(), call::<F>);
        // JSC__JSPromise__wrap converts any thrown exception into a rejected promise,
        // so a pending non-termination exception here indicates a bug; assert and
        // surface termination as JsTerminated (matching JSPromise.zig:202-207).
        scope
            .assert_no_exception_except_termination()
            .map_err(|_| JsTerminated::JSTerminated)?;
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
            return Self::dangerously_create_rejected_promise_value_without_notifying_vm(
                global, value,
            );
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

    /// Safe `status()` for the common `*mut JSPromise`-stored case
    /// (`vm.pending_internal_promise` etc.). `JSPromise` is a GC-managed JSC
    /// heap cell; pointers to it are kept alive by the VM's strong-ref slots,
    /// not by Rust ownership. Centralizes the per-call-site
    /// `unsafe { (*p).status() }` deref so callers don't open-code it.
    #[inline]
    pub fn status_ptr(p: *mut JSPromise) -> Status {
        // `p` is a non-null GC-managed cell tracked by the VM (caller obtained
        // it from a strong-ref VM field or a fresh
        // `JSInternalPromise__resolvedPromise` return value).
        JSPromise::opaque_ref(p).status()
    }

    pub fn result(&mut self, vm: &VM) -> JSValue {
        JSC__JSPromise__result(self, vm)
    }

    pub fn is_handled(&self) -> bool {
        JSC__JSPromise__isHandled(self)
    }

    pub fn set_handled(&mut self) {
        JSC__JSPromise__setHandled(self)
    }

    /// Create a new resolved promise resolving to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `resolved_promise_value` instead.
    pub fn resolved_promise(global: &JSGlobalObject, value: JSValue) -> &mut JSPromise {
        // FFI returns a non-null GC-managed cell tied to `global`'s VM.
        JSPromise::opaque_mut(JSC__JSPromise__resolvedPromise(global, value))
    }

    /// Create a new promise with an already fulfilled value.
    /// This is the faster function for doing that.
    pub fn resolved_promise_value(global: &JSGlobalObject, value: JSValue) -> JSValue {
        JSC__JSPromise__resolvedPromiseValue(global, value)
    }

    /// Create a new rejected promise rejecting to a given value.
    ///
    /// Note: If you want the result as a `JSValue`, use `rejected_promise().to_js()` instead.
    pub fn rejected_promise(global: &JSGlobalObject, value: JSValue) -> &mut JSPromise {
        // FFI returns a non-null GC-managed cell tied to `global`'s VM.
        JSPromise::opaque_mut(JSC__JSPromise__rejectedPromise(global, value))
    }

    /// **DEPRECATED** use `rejected_promise` instead.
    ///
    /// Create a new rejected promise without notifying the VM. Unhandled
    /// rejections created this way will not trigger unhandled rejection handling.
    pub fn dangerously_create_rejected_promise_value_without_notifying_vm(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JSValue {
        JSC__JSPromise__rejectedPromiseValue(global, value)
    }

    /// Fulfill an existing promise with the value.
    /// The value can be another Promise.
    /// If you want to create a new Promise that is already resolved, see `resolved_promise_value`.
    pub fn resolve(&mut self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        #[cfg(debug_assertions)]
        {
            // SAFETY: JS-thread singleton; short-lived `&mut EventLoop` reborrow at use site
            // per VirtualMachine::event_loop() contract.
            let loop_ = VirtualMachine::get().event_loop_mut();
            loop_.debug.js_call_count_outside_tick_queue +=
                (!loop_.debug.is_inside_tick_queue) as usize;
            if loop_.debug.track_last_fn_name && !loop_.debug.is_inside_tick_queue {
                loop_.debug.last_fn_name = BunString::static_(b"resolve").into();
            }
        }

        // `[[ZIG_EXPORT(check_slow)]]` — `bun.cpp.JSC__JSPromise__resolve(...) catch return error.JSTerminated`.
        crate::cpp::JSC__JSPromise__resolve(self, global, value)
            .map_err(|_| JsTerminated::JSTerminated)
    }

    pub fn reject(
        &mut self,
        global: &JSGlobalObject,
        value: JsResult<JSValue>,
    ) -> Result<(), JsTerminated> {
        #[cfg(debug_assertions)]
        {
            // SAFETY: JS-thread singleton; short-lived `&mut EventLoop` reborrow at use site
            // per VirtualMachine::event_loop() contract.
            let loop_ = VirtualMachine::get().event_loop_mut();
            loop_.debug.js_call_count_outside_tick_queue +=
                (!loop_.debug.is_inside_tick_queue) as usize;
            if loop_.debug.track_last_fn_name && !loop_.debug.is_inside_tick_queue {
                loop_.debug.last_fn_name = BunString::static_(b"reject").into();
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

        // `[[ZIG_EXPORT(check_slow)]]` — `bun.cpp.JSC__JSPromise__reject(...) catch return error.JSTerminated`.
        crate::cpp::JSC__JSPromise__reject(self, global, err)
            .map_err(|_| JsTerminated::JSTerminated)
    }

    pub fn reject_as_handled(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
    ) -> Result<(), JsTerminated> {
        // `[[ZIG_EXPORT(check_slow)]]`
        crate::cpp::JSC__JSPromise__rejectAsHandled(self, global, value)
            .map_err(|_| JsTerminated::JSTerminated)
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
        // FFI returns a non-null GC-managed cell tied to `global`'s VM.
        JSPromise::opaque_mut(JSC__JSPromise__create(global))
    }

    /// **DEPRECATED** use `to_js` instead.
    pub fn as_value(&self, _global: &JSGlobalObject) -> JSValue {
        self.to_js()
    }

    pub fn unwrap(&mut self, vm: &VM, mode: UnwrapMode) -> Unwrapped {
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

// ported from: src/jsc/JSPromise.zig
