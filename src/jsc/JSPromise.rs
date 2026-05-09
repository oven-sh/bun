use core::ffi::c_void;
use core::marker::{PhantomData, PhantomPinned};

use bun_string::String as BunString;

use crate::{JSGlobalObject, JSValue, JsError, JsResult, VM};
// `jsc.Strong.Optional` and `jsc.Weak(T)` collide with this module's own `Strong`/`Weak`,
// so import them under aliases.
use crate::strong::Optional as JscStrong;
use crate::weak::{Weak as JscWeak, WeakRefType};
use crate::{JsTerminated, TopExceptionScope};
use crate::top_exception_scope::SourceLocation;
use crate::virtual_machine::VirtualMachine;

/// Opaque handle to a `JSC::JSPromise` cell. Always used by reference; never
/// constructed or owned on the Rust side (GC-managed).
#[repr(C)]
pub struct JSPromise {
    // `UnsafeCell` opts out of `Freeze` so `&JSPromise` FFI params are not
    // emitted with `readonly`/`noalias` LLVM attributes (mirrors JSGlobalObject).
    _p: core::cell::UnsafeCell<[u8; 0]>,
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
//
// `JSPromise` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles
// (so `&T` is ABI-identical to non-null `*const T` and C++ mutating through
// the pointer is interior mutation invisible to Rust). The shims that take
// only such handles + scalars are declared `safe fn`. `JSC__JSPromise__wrap`
// keeps a raw `*mut c_void` ctx so it stays `unsafe fn`; the
// `*mut JSPromise`-returning constructors stay raw (caller derefs).
unsafe extern "C" {
    fn JSC__JSPromise__create(arg0: &JSGlobalObject) -> *mut JSPromise;
    fn JSC__JSPromise__rejectedPromise(arg0: &JSGlobalObject, js_value1: JSValue) -> *mut JSPromise;
    /// **DEPRECATED** This function does not notify the VM about the rejection,
    /// meaning it will not trigger unhandled rejection handling. Use
    /// `JSC__JSPromise__rejectedPromise` instead.
    safe fn JSC__JSPromise__rejectedPromiseValue(arg0: &JSGlobalObject, js_value1: JSValue) -> JSValue;
    fn JSC__JSPromise__resolvedPromise(arg0: &JSGlobalObject, js_value1: JSValue) -> *mut JSPromise;
    safe fn JSC__JSPromise__resolvedPromiseValue(arg0: &JSGlobalObject, js_value1: JSValue) -> JSValue;
    fn JSC__JSPromise__wrap(
        arg0: *mut JSGlobalObject,
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
    safe fn JSC__JSPromise__rejectAsHandled(this: &mut JSPromise, global: &JSGlobalObject, value: JSValue);
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
        // SAFETY: `VirtualMachine::get()` returns the JS-thread singleton; `event_loop()`
        // returns the raw VM-owned `*mut EventLoop`, valid for the process lifetime.
        // `enter_scope` calls `enter()` now and `exit()` on drop (RAII for Zig's
        // `loop.enter(); defer loop.exit();`).
        let loop_ = VirtualMachine::get().as_mut().event_loop();
        let _guard = unsafe { crate::event_loop::EventLoop::enter_scope(loop_) };
        self.reject(global, val);
    }

    pub fn resolve(&mut self, global: &JSGlobalObject, val: JSValue) {
        let _ = self.swap().resolve(global, val);
    }

    /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
    pub fn resolve_task(&mut self, global: &JSGlobalObject, val: JSValue) {
        // SAFETY: see `reject_task`.
        let loop_ = VirtualMachine::get().as_mut().event_loop();
        let _guard = unsafe { crate::event_loop::EventLoop::enter_scope(loop_) };
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

    /// SAFETY: returns `&mut JSPromise` derived from a GC-owned cell pointer;
    /// two calls alias the same object. Caller must not hold another live
    /// `&mut JSPromise` to it (resolver-style accessor).
    pub unsafe fn get(&self) -> &mut JSPromise {
        // SAFETY: `as_promise` returns a non-null `*mut JSPromise` for a live promise cell.
        unsafe { &mut *self.weak.get().unwrap().as_promise().unwrap() }
    }

    /// SAFETY: see [`get`].
    pub unsafe fn get_or_null(&self) -> Option<&mut JSPromise> {
        let promise_value = self.weak.get()?;
        // SAFETY: see `get`.
        promise_value.as_promise().map(|p| unsafe { &mut *p })
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
        // SAFETY: `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell;
        // GC-owned, so the resulting `&mut` is a resolver-style accessor (see `get`).
        unsafe { &mut *prom }
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
    pub const fn empty() -> Self { Self { strong: JscStrong::empty() } }

    pub fn reject_without_swap(&mut self, global: &JSGlobalObject, val: JsResult<JSValue>) {
        let Some(v) = self.strong.get() else { return };
        let val = val.unwrap_or_else(|_| global.try_take_exception().unwrap());
        // SAFETY: `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell.
        let _ = unsafe { &mut *v.as_promise().unwrap() }.reject(global, Ok(val));
    }

    pub fn resolve_without_swap(&mut self, global: &JSGlobalObject, val: JSValue) {
        let Some(v) = self.strong.get() else { return };
        // SAFETY: `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell.
        let _ = unsafe { &mut *v.as_promise().unwrap() }.resolve(global, val);
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
        // SAFETY: `&mut self` held; sole `&mut JSPromise` borrow in this scope.
        err.attach_async_stack_from_promise(global, unsafe { self.get() });
        self.swap().reject(global, Ok(err))
    }

    /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
    pub fn reject_task(&mut self, global: &JSGlobalObject, val: JSValue) -> Result<(), JsTerminated> {
        // SAFETY: `VirtualMachine::get()` returns the JS-thread singleton; `event_loop()`
        // returns the raw VM-owned `*mut EventLoop`, valid for the process lifetime.
        // `enter_scope` calls `enter()` now and `exit()` on drop.
        let loop_ = VirtualMachine::get().as_mut().event_loop();
        let _guard = unsafe { crate::event_loop::EventLoop::enter_scope(loop_) };
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
        // SAFETY: see `reject_task`.
        let loop_ = VirtualMachine::get().as_mut().event_loop();
        let _guard = unsafe { crate::event_loop::EventLoop::enter_scope(loop_) };
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
        Self { strong: JscStrong::create(value, global) }
    }

    /// SAFETY: returns `&mut JSPromise` derived from a GC-owned cell pointer;
    /// two calls alias the same object. Caller must not hold another live
    /// `&mut JSPromise` to it (resolver-style accessor).
    pub unsafe fn get(&self) -> &mut JSPromise {
        // SAFETY: `as_promise` returns a non-null `*mut JSPromise` for a live promise cell.
        unsafe { &mut *self.strong.get().unwrap().as_promise().unwrap() }
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
        self.strong = JscStrong::empty();
        // SAFETY: `as_promise()` returns a non-null `*mut JSPromise` for a live promise cell;
        // GC-owned, so the resulting `&mut` is a resolver-style accessor (see `get`).
        unsafe { &mut *prom }
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
            // SAFETY: `this` is `&mut Wrapper<F>` passed below; `g` is a live JSGlobalObject.
            let this = unsafe { &mut *this.cast::<Wrapper<F>>() };
            let g = unsafe { &*g };
            let f = this.f.take().unwrap();
            // Zig: `jsc.toJSHostCall(g, @src(), Fn, this.args)` — `@src()` mapped to
            // `Location::caller()` (resolves to this trampoline's call site).
            crate::to_js_host_call(g, move || f(g))
        }

        // TODO(port): @src() source-location plumbing — provide a `src!()` macro in Phase B.
        // Zig: `var scope: jsc.TopExceptionScope = undefined; scope.init(global, @src()); defer scope.deinit();`
        // `TopExceptionScope::init` is in-place (placement-constructs into `bytes`), so we
        // stack-allocate via `MaybeUninit` and must not move it after `init`.
        //
        // Stacked Borrows: derive a single raw `*mut TopExceptionScope` from the
        // `MaybeUninit` and route every access (init, assert, destroy) through it. We
        // never materialize a long-lived `&mut TopExceptionScope` whose Unique tag
        // could be popped by the guard's parked raw pointer (or vice versa).
        let mut scope = core::mem::MaybeUninit::<TopExceptionScope>::uninit();
        let scope_ptr: *mut TopExceptionScope = scope.as_mut_ptr();
        // SAFETY: `init` writes into `bytes` via FFI without reading prior contents; the
        // `ci_assert`-gated `location` field is set inside `init` itself, so calling `init`
        // on uninit storage is sound (matches the Zig `= undefined; .init()` pattern).
        unsafe {
            (*scope_ptr).init_in_place(global, crate::src!());
        }
        let _scope_guard = scopeguard::guard(scope_ptr, |s| {
            // SAFETY: `s` was initialized by `init()` above and has not been destroyed.
            unsafe { TopExceptionScope::destroy(s) }
        });

        let mut ctx = Wrapper { f: Some(f) };
        // SAFETY: `ctx` outlives the synchronous FFI call; `call::<F>` matches the
        // expected `extern "C" fn(*mut c_void, *mut JSGlobalObject) -> JSValue` signature.
        // `global.as_ptr()` yields the FFI `*mut` for the opaque ZST handle — no
        // Rust-visible bytes are aliased (see JSGlobalObject::as_ptr).
        let promise = unsafe {
            JSC__JSPromise__wrap(
                global.as_ptr(),
                (&raw mut ctx).cast::<c_void>(),
                call::<F>,
            )
        };
        // JSC__JSPromise__wrap converts any thrown exception into a rejected promise,
        // so a pending non-termination exception here indicates a bug; assert and
        // surface termination as JsTerminated (matching JSPromise.zig:202-207).
        // SAFETY: `scope_ptr` was initialized above and `_scope_guard` has not yet
        // dropped; the short-lived `&mut` reborrow here is derived from the same
        // raw root provenance as the guard and ends before the guard runs.
        unsafe { (*scope_ptr).assert_no_exception_except_termination() }
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
            return Self::dangerously_create_rejected_promise_value_without_notifying_vm(global, value);
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
        // SAFETY: `p` is a non-null GC-managed cell tracked by the VM
        // (caller obtained it from a strong-ref VM field or a fresh
        // `JSInternalPromise__resolvedPromise` return value).
        unsafe { (*p).status() }
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
        // SAFETY: FFI returns a non-null GC-managed cell tied to `global`'s VM.
        unsafe { &mut *JSC__JSPromise__resolvedPromise(global, value) }
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
        // SAFETY: FFI returns a non-null GC-managed cell tied to `global`'s VM.
        unsafe { &mut *JSC__JSPromise__rejectedPromise(global, value) }
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
                loop_.debug.last_fn_name = BunString::static_(b"resolve");
            }
        }

        JSC__JSPromise__resolve(self, global, value);
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION(global)` after the void call.
        if global.has_exception() {
            return Err(JsTerminated::JSTerminated);
        }
        Ok(())
    }

    pub fn reject(&mut self, global: &JSGlobalObject, value: JsResult<JSValue>) -> Result<(), JsTerminated> {
        #[cfg(debug_assertions)]
        {
            // SAFETY: JS-thread singleton; short-lived `&mut EventLoop` reborrow at use site
            // per VirtualMachine::event_loop() contract.
            let loop_ = VirtualMachine::get().event_loop_mut();
            loop_.debug.js_call_count_outside_tick_queue +=
                (!loop_.debug.is_inside_tick_queue) as usize;
            if loop_.debug.track_last_fn_name && !loop_.debug.is_inside_tick_queue {
                loop_.debug.last_fn_name = BunString::static_(b"reject");
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

        JSC__JSPromise__reject(self, global, err);
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION(global)` after the void call.
        if global.has_exception() {
            return Err(JsTerminated::JSTerminated);
        }
        Ok(())
    }

    pub fn reject_as_handled(&mut self, global: &JSGlobalObject, value: JSValue) -> Result<(), JsTerminated> {
        JSC__JSPromise__rejectAsHandled(self, global, value);
        // Mirrors cpp.zig wrapper: `Bun__RETURN_IF_EXCEPTION(global)` after the void call.
        if global.has_exception() {
            return Err(JsTerminated::JSTerminated);
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
        unsafe { &mut *JSC__JSPromise__create(global) }
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
