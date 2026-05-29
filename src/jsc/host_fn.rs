//! Host function wrappers — the glue between Rust functions and JSC native callbacks.
//!
//! In the Zig source this module is almost entirely `comptime`/`@typeInfo` reflection
//! that inspects a function's signature and emits an `extern callconv(jsc.conv)` shim.
//! Rust has no equivalent runtime/const reflection, so per PORTING.md §"Comptime
//! reflection" the wrapping machinery (`toJSHostFn`, `wrapN`, `wrapInstanceMethod`,
//! `wrapStaticMethod`, `DOMCall`) becomes the `#[bun_jsc::host_fn]` / `#[bun_jsc::host_call]`
//! proc-macro attributes. This file keeps:
//!   - the runtime result-mapping helpers the macros call into,
//!   - the FFI surface for `JSFunction` creation,
//!   - `DomEffect` (plain data),
//! and stubs the reflection-driven generators with `// TODO(port): proc-macro`.

use core::ffi::c_void;

use bun_core::Environment;
use bun_core::Output;
use bun_core::ZigString;

use crate::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};

// ───────────────────────────── type aliases ──────────────────────────────

#[cfg(all(windows, target_arch = "x86_64"))]
pub type JsHostFn = unsafe extern "sysv64" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue;
#[cfg(not(all(windows, target_arch = "x86_64")))]
pub type JsHostFn = unsafe extern "C" fn(*mut JSGlobalObject, *mut CallFrame) -> JSValue;

/// To allow usage of `?` for error handling, Bun provides `to_js_host_fn` to
/// wrap this type into a `JsHostFn`.
pub type JsHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// Zig: `pub fn JSHostFnZigWithContext(comptime ContextType: type) type`
pub type JsHostFnZigWithContext<C> = fn(&mut C, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// Zig: `pub fn JSHostFunctionTypeWithContext(comptime ContextType: type) type`
#[cfg(all(windows, target_arch = "x86_64"))]
pub type JsHostFunctionTypeWithContext<C> =
    unsafe extern "sysv64" fn(*mut C, *mut JSGlobalObject, *mut CallFrame) -> JSValue;
#[cfg(not(all(windows, target_arch = "x86_64")))]
pub type JsHostFunctionTypeWithContext<C> =
    unsafe extern "C" fn(*mut C, *mut JSGlobalObject, *mut CallFrame) -> JSValue;

#[macro_export]
macro_rules! jsc_host_abi {
    ($(#[$m:meta])* $vis:vis unsafe fn $name:ident($($args:tt)*) -> $ret:ty $body:block) => {
        #[cfg(all(windows, target_arch = "x86_64"))]
        $(#[$m])* $vis unsafe extern "sysv64" fn $name($($args)*) -> $ret $body
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        $(#[$m])* $vis unsafe extern "C" fn $name($($args)*) -> $ret $body
    };
}

// Capitalized re-exports — Zig spells these `JSHostFn*` (acronym-caps); the
// PORTING.md acronym rule lowercases to `Js…`, but enough call sites (and the
// crate-root re-export in lib.rs) use the Zig spelling that both must resolve.
pub use {
    JsHostFn as JSHostFn, JsHostFnZig as JSHostFnZig,
    JsHostFnZigWithContext as JSHostFnZigWithContext,
    JsHostFunctionTypeWithContext as JSHostFunctionTypeWithContext,
};

// ─────────────────────── comptime fn-wrapping → proc-macro ───────────────────────

#[doc(hidden)]
pub const fn to_js_host_fn(_function_to_wrap: JsHostFnZig) -> ! {
    panic!("use #[bun_jsc::host_fn] instead of to_js_host_fn()");
}

// Zig: `pub fn toJSHostFnWithContext(comptime ContextType: type, comptime Function: ...) ...`
// TODO(port): proc-macro — `#[bun_jsc::host_fn(method)]` replaces `toJSHostFnWithContext`.
#[doc(hidden)]
pub const fn to_js_host_fn_with_context<C>(_function: JsHostFnZigWithContext<C>) -> ! {
    panic!("use #[bun_jsc::host_fn(method)] instead of to_js_host_fn_with_context()");
}

/// Map a `JsResult<JSValue>` to the raw `JSValue` a host fn must return
/// (`.zero` when an exception is pending).
pub fn to_js_host_fn_result(global_this: &JSGlobalObject, result: JsResult<JSValue>) -> JSValue {
    // Zig: `if (Environment.allow_assert and Environment.is_canary)`
    if Environment::ALLOW_ASSERT && Environment::IS_CANARY {
        let value = match result {
            Ok(v) => v,
            Err(JsError::Thrown) => JSValue::ZERO,
            Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
            Err(JsError::Terminated) => JSValue::ZERO,
        };
        debug_exception_assertion(global_this, value, "_unknown_");
        return value;
    }
    match result {
        Ok(v) => v,
        Err(JsError::Thrown) => JSValue::ZERO,
        Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
        Err(JsError::Terminated) => JSValue::ZERO,
    }
}

fn debug_exception_assertion(global_this: &JSGlobalObject, value: JSValue, func: &'static str) {
    // Zig passed `comptime func: anytype` and printed its address for `image lookup`.
    // Rust passes the fn name string (the proc-macro supplies `stringify!(fn_name)`).
    if Environment::IS_DEBUG {
        if !value.is_empty() && global_this.has_exception() {
            let mut formatter = jsc::ConsoleObject::Formatter::new(global_this);
            Output::err(
                "Assertion failed",
                "Native function returned a non-zero JSValue while an exception is pending\n\
                 \n\
                 \x20   fn: {s}\n\
                 \x20value: {}\n",
                (
                    func,
                    jsc::console_object::formatter::ZigFormatter::new(&mut formatter, value),
                ),
            );
            Output::flush();
            // `formatter` drops here (Zig: `defer formatter.deinit()`).
        }
    }
    let _ = func;
    assert!(value.is_empty() == global_this.has_exception(), "host fn return/exception state mismatch");
}

pub fn to_js_host_setter_value(global_this: &JSGlobalObject, value: JsResult<()>) -> bool {
    match value {
        Err(JsError::Thrown) => false,
        Err(JsError::OutOfMemory) => {
            let _ = global_this.throw_out_of_memory_value();
            false
        }
        Err(JsError::Terminated) => false,
        Ok(()) => true,
    }
}

/// Normalize a host-fn / getter body's return type to `JsResult<JSValue>`.
pub trait IntoHostFnReturn {
    fn into_host_fn_return(self) -> JsResult<JSValue>;
}
impl IntoHostFnReturn for JSValue {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> { Ok(self) }
}
impl IntoHostFnReturn for JsResult<JSValue> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> { self }
}

/// Normalize a setter body's return type to `JsResult<()>`. Zig setters return
/// `void` or `JSError!void`; both map to `bool` (true on success) at the ABI.
pub trait IntoHostSetterReturn {
    fn into_host_setter_return(self) -> JsResult<()>;
}
impl IntoHostSetterReturn for () {
    #[inline]
    fn into_host_setter_return(self) -> JsResult<()> { Ok(()) }
}
impl IntoHostSetterReturn for JsResult<()> {
    #[inline]
    fn into_host_setter_return(self) -> JsResult<()> { self }
}
impl IntoHostSetterReturn for bool {
    #[inline]
    fn into_host_setter_return(self) -> JsResult<()> {
        if self { Ok(()) } else { Err(JsError::Thrown) }
    }
}
impl IntoHostSetterReturn for JsResult<bool> {
    #[inline]
    fn into_host_setter_return(self) -> JsResult<()> { self.map(|_| ()) }
}

/// Normalize a constructor body's return type to a nullable `*mut c_void`.
pub trait IntoHostConstructReturn {
    fn into_host_construct_return(self) -> JsResult<*mut c_void>;
}
impl<T> IntoHostConstructReturn for *mut T {
    #[inline]
    fn into_host_construct_return(self) -> JsResult<*mut c_void> { Ok(self.cast()) }
}
impl<T> IntoHostConstructReturn for Box<T> {
    #[inline]
    fn into_host_construct_return(self) -> JsResult<*mut c_void> {
        Ok(bun_core::heap::into_raw(self).cast())
    }
}
impl<T> IntoHostConstructReturn for JsResult<*mut T> {
    #[inline]
    fn into_host_construct_return(self) -> JsResult<*mut c_void> { self.map(|p| p.cast()) }
}
impl<T> IntoHostConstructReturn for JsResult<Box<T>> {
    #[inline]
    fn into_host_construct_return(self) -> JsResult<*mut c_void> {
        self.map(|b| bun_core::heap::into_raw(b).cast())
    }
}

/// Codegen thunk entry for prototype fns and getters.
#[track_caller]
#[inline]
pub fn host_fn_result<R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> JSValue {
    to_js_host_call(global, || f().into_host_fn_return())
}

/// Prototype method: `fn(&mut self, &JSGlobalObject, &CallFrame) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_this<T, R: IntoHostFnReturn>(
    this: &mut T,
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&mut T, &JSGlobalObject, &CallFrame) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, callframe))
}

/// Prototype method (passThis): `fn(&mut self, &JSGlobalObject, &CallFrame, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_this_value<T, R: IntoHostFnReturn>(
    this: &mut T,
    global: &JSGlobalObject,
    callframe: &CallFrame,
    js_this: JSValue,
    f: impl FnOnce(&mut T, &JSGlobalObject, &CallFrame, JSValue) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, callframe, js_this))
}

/// Prototype getter: `fn(&mut self, &JSGlobalObject) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_getter<T, R: IntoHostFnReturn>(
    this: &mut T,
    global: &JSGlobalObject,
    f: impl FnOnce(&mut T, &JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global))
}

/// Prototype getter (this: true): `fn(&mut self, JSValue, &JSGlobalObject) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_getter_this<T, R: IntoHostFnReturn>(
    this: &mut T,
    this_value: JSValue,
    global: &JSGlobalObject,
    f: impl FnOnce(&mut T, JSValue, &JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, this_value, global))
}

/// Prototype setter: `fn(&mut self, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_setter<T, R: IntoHostSetterReturn>(
    this: &mut T,
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&mut T, &JSGlobalObject, JSValue) -> R,
) -> bool {
    host_setter_result(global, || f(this, global, value))
}

/// Prototype setter (this: true): `fn(&mut self, JSValue, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_setter_this<T, R: IntoHostSetterReturn>(
    this: &mut T,
    this_value: JSValue,
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&mut T, JSValue, &JSGlobalObject, JSValue) -> R,
) -> bool {
    host_setter_result(global, || f(this, this_value, global, value))
}

/// Static / class method or `call`: `fn(&JSGlobalObject, &CallFrame) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_static<R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> R,
) -> JSValue {
    host_fn_result(global, || f(global, callframe))
}

#[inline]
pub fn host_fn_static_passthrough(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> JSValue,
) -> JSValue {
    f(global, callframe)
}

/// Raw-pointer entry for `host`-shape exports whose `#[no_mangle]` thunk must
/// keep `(*mut JSGlobalObject, *mut CallFrame)` params so the symbol coerces
/// to [`JsHostFn`] when Rust passes it as a callback (e.g. `JSValue::then2`).
/// All other thunks take references directly.
///
/// Both are `opaque_ffi!` ZST handles, so the `*mut → &` conversion is the
/// centralised [`bun_opaque::opaque_deref_nn`] proof (zero-byte deref). JSC's
/// host-call ABI never passes null for either argument — `globalObject` comes
/// from the running VM and `callFrame` is the on-stack frame pointer — so the
/// unchecked `_nn` variant is used to drop the two `testq; je <panic>` pairs
/// from every `HOST_EXPORT` entry (`debug_assert!`ed in debug builds).
///
/// # Safety
/// `global` and `callframe` must be non-null and valid for the duration of the
/// call (guaranteed by the JSC host-function ABI for every `JsHostFn` thunk).
#[track_caller]
#[inline]
pub unsafe fn host_fn_static_raw<R: IntoHostFnReturn>(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> R,
) -> JSValue {
    // SAFETY: JSC host-function ABI — `global`/`callframe` are always non-null.
    let (global, callframe) =
        unsafe { (JSGlobalObject::opaque_ref_nn(global), CallFrame::opaque_ref_nn(callframe)) };
    host_fn_static(global, callframe, f)
}

/// Raw-pointer entry for `host`-shape exports, no exception scope.
/// See [`host_fn_static_raw`].
///
/// # Safety
/// `global` and `callframe` must be non-null and valid for the duration of the
/// call (guaranteed by the JSC host-function ABI for every `JsHostFn` thunk).
#[inline]
pub unsafe fn host_fn_static_passthrough_raw(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> JSValue,
) -> JSValue {
    // SAFETY: JSC host-function ABI — `global`/`callframe` are always non-null.
    let (global, callframe) =
        unsafe { (JSGlobalObject::opaque_ref_nn(global), CallFrame::opaque_ref_nn(callframe)) };
    host_fn_static_passthrough(global, callframe, f)
}

/// Lazy property creator / free getter: `fn(&JSGlobalObject) -> R`. Used by
/// `generate-host-exports.ts` for the `BunObject__createX` / `Process__getX`
/// shape (no `CallFrame`, no `this`).
#[track_caller]
#[inline]
pub fn host_fn_lazy<R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    f: impl FnOnce(&JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(global))
}

/// Lazy property creator, no exception scope (bare-`JSValue` impls).
#[inline]
pub fn host_fn_lazy_passthrough(
    global: &JSGlobalObject,
    f: impl FnOnce(&JSGlobalObject) -> JSValue,
) -> JSValue {
    f(global)
}

/// Static getter: `fn(&JSGlobalObject, JSValue, PropertyName) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_static_getter<P, R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    this_value: JSValue,
    prop: P,
    f: impl FnOnce(&JSGlobalObject, JSValue, P) -> R,
) -> JSValue {
    host_fn_result(global, || f(global, this_value, prop))
}

/// Static setter: `fn(&JSGlobalObject, JSValue, JSValue, PropertyName) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_static_setter<P, R: IntoHostSetterReturn>(
    global: &JSGlobalObject,
    this_value: JSValue,
    value: JSValue,
    prop: P,
    f: impl FnOnce(&JSGlobalObject, JSValue, JSValue, P) -> R,
) -> bool {
    host_setter_result(global, || f(global, this_value, value, prop))
}

/// Constructor: `fn(&JSGlobalObject, &CallFrame) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_construct<R: IntoHostConstructReturn>(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> R,
) -> *mut c_void {
    host_construct_result(global, || f(global, callframe))
}

/// Constructor (constructNeedsThis): `fn(&JSGlobalObject, &CallFrame, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_construct_this<R: IntoHostConstructReturn>(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    this_value: JSValue,
    f: impl FnOnce(&JSGlobalObject, &CallFrame, JSValue) -> R,
) -> *mut c_void {
    host_construct_result(global, || f(global, callframe, this_value))
}

/// `getInternalProperties`: `fn(&mut self, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_internal_props<T, R: IntoHostFnReturn>(
    this: &mut T,
    global: &JSGlobalObject,
    this_value: JSValue,
    f: impl FnOnce(&mut T, &JSGlobalObject, JSValue) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, this_value))
}

/// Prototype method (`sharedThis`): `fn(&self, &JSGlobalObject, &CallFrame) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_this_shared<T, R: IntoHostFnReturn>(
    this: &T,
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&T, &JSGlobalObject, &CallFrame) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, callframe))
}

/// Prototype method (`sharedThis`, passThis):
/// `fn(&self, &JSGlobalObject, &CallFrame, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_this_value_shared<T, R: IntoHostFnReturn>(
    this: &T,
    global: &JSGlobalObject,
    callframe: &CallFrame,
    js_this: JSValue,
    f: impl FnOnce(&T, &JSGlobalObject, &CallFrame, JSValue) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, callframe, js_this))
}

/// Prototype getter (`sharedThis`): `fn(&self, &JSGlobalObject) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_getter_shared<T, R: IntoHostFnReturn>(
    this: &T,
    global: &JSGlobalObject,
    f: impl FnOnce(&T, &JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global))
}

/// Prototype getter (`sharedThis`, this: true):
/// `fn(&self, JSValue, &JSGlobalObject) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_getter_this_shared<T, R: IntoHostFnReturn>(
    this: &T,
    this_value: JSValue,
    global: &JSGlobalObject,
    f: impl FnOnce(&T, JSValue, &JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, this_value, global))
}

/// Prototype setter (`sharedThis`): `fn(&self, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_setter_shared<T, R: IntoHostSetterReturn>(
    this: &T,
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&T, &JSGlobalObject, JSValue) -> R,
) -> bool {
    host_setter_result(global, || f(this, global, value))
}

/// Prototype setter (`sharedThis`, this: true):
/// `fn(&self, JSValue, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_setter_this_shared<T, R: IntoHostSetterReturn>(
    this: &T,
    this_value: JSValue,
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&T, JSValue, &JSGlobalObject, JSValue) -> R,
) -> bool {
    host_setter_result(global, || f(this, this_value, global, value))
}

/// `getInternalProperties` (`sharedThis`):
/// `fn(&self, &JSGlobalObject, JSValue) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_internal_props_shared<T, R: IntoHostFnReturn>(
    this: &T,
    global: &JSGlobalObject,
    this_value: JSValue,
    f: impl FnOnce(&T, &JSGlobalObject, JSValue) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, global, this_value))
}

/// Finalizer: `fn(Box<T>)`. The user impl receives owned `Box<Self>` —
/// ownership is transferred from the C++ JSCell wrapper's `m_ctx` slot.
/// This wrapper provides the panic barrier and the single `Box::from_raw`
/// for the entire generated-classes finalize surface, so the generated thunk
/// body contains zero `unsafe` tokens and user impls need no
/// soundness-laundering `unsafe { heap::take(this) }`.
///
/// For intrusively-refcounted `T` the JS wrapper holds one of N refs; the
/// impl MUST `Box::leak`/`Box::into_raw` as its FIRST step (before any
/// fallible work) so the allocation is not freed by Box drop on panic while
/// other ref holders still alias it.
///
/// # Safety
/// `this` must be the unique GC-owned `m_ctx` pointer originally produced by
/// `Box::into_raw` in the construct path (`IntoHostConstructReturn`), valid
/// and not concurrently accessed.
#[inline]
pub unsafe fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(alloc::boxed::Box<T>)) {
    // SAFETY: `this` is the GC-owned `m_ctx` pointer, valid and not
    // concurrently accessed (mutator-thread sweep). It was produced by
    // `Box::into_raw` in the construct path (`IntoHostConstructReturn`).
    // For intrusively-refcounted `T` other native code may hold raw
    // pointers to the same allocation — see doc comment above re: the
    // impl's obligation to `Box::leak` before doing fallible work.
    let boxed = unsafe { alloc::boxed::Box::from_raw(this) };
    f(boxed)
}

/// Codegen thunk entry for prototype setters.
#[track_caller]
#[inline]
pub fn host_setter_result<R: IntoHostSetterReturn>(
    global: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> bool {
    let mut scope_storage = core::mem::MaybeUninit::uninit();
    let mut scope = jsc::ExceptionValidationScope::init_guard(&mut scope_storage, global);
    let r = to_js_host_setter_value(global, f().into_host_setter_return());
    scope.assert_exception_presence_matches(!r);
    r
}

/// Codegen thunk entry for `${T}Class__construct`.
#[track_caller]
#[inline]
pub fn host_construct_result<R: IntoHostConstructReturn>(
    global: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> *mut c_void {
    let mut scope_storage = core::mem::MaybeUninit::uninit();
    let mut scope = jsc::ExceptionValidationScope::init_guard(&mut scope_storage, global);
    let ptr = match f().into_host_construct_return() {
        Ok(p) => p,
        Err(JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory_value();
            core::ptr::null_mut()
        }
        Err(_) => core::ptr::null_mut(),
    };
    scope.assert_exception_presence_matches(ptr.is_null());
    ptr
}

#[track_caller]
pub fn to_js_host_call(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> JsResult<JSValue>,
) -> JSValue {
    let mut scope_storage = core::mem::MaybeUninit::uninit();
    let mut scope = jsc::ExceptionValidationScope::init_guard(&mut scope_storage, global_this);

    let normal = match f() {
        Ok(v) => v,
        Err(JsError::Thrown) => JSValue::ZERO,
        Err(JsError::OutOfMemory) => global_this.throw_out_of_memory_value(),
        Err(JsError::Terminated) => JSValue::ZERO,
    };
    scope.assert_exception_presence_matches(normal.is_empty());
    normal
}

#[track_caller]
#[inline]
pub fn from_js_host_call(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> JSValue,
) -> Result<JSValue, JsError> {
    // Zig: `if (@TypeOf(value) != JSValue) @compileError(...)` — enforced by the
    // closure return type here. Body is the `[[ZIG_EXPORT(zero_is_throw)]]` shape.
    crate::call_zero_is_throw(global_this, f)
}

#[track_caller]
#[inline]
pub fn from_js_host_call_generic<R>(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> Result<R, JsError> {
    crate::call_check_slow(global_this, f)
}

// ───────────────────────── error-set parsing (comptime) ─────────────────────────

// For when bubbling up errors to functions that require a C ABI boundary
// TODO: make this not need a 'global_this'
pub fn void_from_js_error(err: JsError, global_this: &JSGlobalObject) {
    match err {
        JsError::Thrown => {}
        JsError::OutOfMemory => {
            let _ = global_this.throw_out_of_memory();
        }
        JsError::Terminated => {}
    }
    // TODO: catch exception, declare throw scope, re-throw
    // c++ needs to be able to see that zig functions can throw for BUN_JSC_validateExceptionChecks
}

// ───────────────────────────── FFI: JSFunction creation ──────────────────────────────

mod private {
    use super::*;

    unsafe extern "C" {
        pub(super) safe fn Bun__CreateFFIFunctionWithDataValue(
            global: &JSGlobalObject,
            symbol_name: Option<&ZigString>,
            arg_count: u32,
            // Zig `*const JSHostFn` is a fn *pointer*; `JsHostFn` in Rust is already
            // `unsafe extern "C" fn(...)`, i.e. the pointer type.
            function: JsHostFn,
            data: *mut c_void,
        ) -> JSValue;

        pub(super) safe fn Bun__CreateFFIFunctionValue(
            global_object: &JSGlobalObject,
            symbol_name: Option<&ZigString>,
            arg_count: u32,
            function: JsHostFn,
            add_ptr_field: bool,
            input_function_ptr: *mut c_void, // ?*anyopaque
        ) -> JSValue;

        // safe: `JSValue` is a by-value tagged i64; `data` is an opaque
        // round-trip pointer the C++ side stores in the JSFunction's private
        // slot without dereferencing it as Rust data.
        pub(super) safe fn Bun__FFIFunction_getDataPtr(value: JSValue) -> *mut c_void;
        pub(super) safe fn Bun__FFIFunction_setDataPtr(value: JSValue, data: *mut c_void);
    }
}

#[track_caller]
pub fn new_runtime_function(
    global_object: &JSGlobalObject,
    symbol_name: Option<&ZigString>,
    arg_count: u32,
    function_pointer: JsHostFn,
    add_ptr_property: bool,
    input_function_ptr: Option<*mut c_void>,
) -> JSValue {
    jsc::mark_binding();
    private::Bun__CreateFFIFunctionValue(
        global_object,
        symbol_name,
        arg_count,
        function_pointer,
        add_ptr_property,
        input_function_ptr.unwrap_or(core::ptr::null_mut()),
    )
}

#[track_caller]
pub fn get_function_data(function: JSValue) -> Option<*mut c_void> {
    jsc::mark_binding();
    let p = private::Bun__FFIFunction_getDataPtr(function);
    if p.is_null() { None } else { Some(p) }
}

#[track_caller]
pub fn set_function_data(function: JSValue, value: Option<*mut c_void>) {
    jsc::mark_binding();
    private::Bun__FFIFunction_setDataPtr(function, value.unwrap_or(core::ptr::null_mut()))
}

#[track_caller]
pub fn new_function_with_data(
    global_object: &JSGlobalObject,
    symbol_name: Option<&ZigString>,
    arg_count: u32,
    function: JsHostFn,
    data: *mut c_void,
) -> JSValue {
    jsc::mark_binding();
    // Zig: `toJSHostFn(function)` wrapped a `comptime JSHostFnZig` here. In Rust the
    // caller passes an already-wrapped `JsHostFn` (produced by `#[bun_jsc::host_fn]`).
    // TODO(port): proc-macro — callers must apply `#[bun_jsc::host_fn]` themselves.
    private::Bun__CreateFFIFunctionWithDataValue(
        global_object,
        symbol_name,
        arg_count,
        function,
        data,
    )
}

// ───────────────────────────── DOMEffect ──────────────────────────────

#[derive(Clone, Copy)]
pub struct DomEffect {
    pub reads: [DomEffectId; 4],
    pub writes: [DomEffectId; 4],
}

impl Default for DomEffect {
    fn default() -> Self {
        // Zig: `std.mem.zeroes([4]ID)` — ID(0) == InvalidAbstractHeap.
        Self {
            reads: [DomEffectId::InvalidAbstractHeap; 4],
            writes: [DomEffectId::InvalidAbstractHeap; 4],
        }
    }
}

impl DomEffect {
    pub const TOP: DomEffect = DomEffect {
        reads: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        writes: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
    };

    pub const fn for_read(read: DomEffectId) -> DomEffect {
        DomEffect {
            reads: [read, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
            writes: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        }
    }

    pub const fn for_write(read: DomEffectId) -> DomEffect {
        DomEffect {
            writes: [read, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
            reads: [DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap, DomEffectId::Heap],
        }
    }

    pub const PURE: DomEffect = DomEffect {
        reads: [DomEffectId::InvalidAbstractHeap; 4],
        writes: [DomEffectId::InvalidAbstractHeap; 4],
    };

    pub fn is_pure(self) -> bool {
        matches!(self.reads[0], DomEffectId::InvalidAbstractHeap)
            && matches!(self.writes[0], DomEffectId::InvalidAbstractHeap)
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DomEffectId {
    InvalidAbstractHeap = 0,
    World,
    Stack,
    Heap,
    ButterflyPublicLength,
    ButterflyVectorLength,
    GetterSetterGetter,
    GetterSetterSetter,
    JSCellCellState,
    JSCellIndexingType,
    JSCellStructureID,
    JSCellTypeInfoFlags,
    JSObjectButterfly,
    JSPropertyNameEnumeratorCachedPropertyNames,
    RegExpObjectLastIndex,
    NamedProperties,
    IndexedInt32Properties,
    IndexedDoubleProperties,
    IndexedContiguousProperties,
    IndexedArrayStorageProperties,
    DirectArgumentsProperties,
    ScopeProperties,
    TypedArrayProperties,
    /// Used to reflect the fact that some allocations reveal object identity
    HeapObjectCount,
    RegExpState,
    MathDotRandomState,
    JSDateFields,
    JSMapFields,
    JSSetFields,
    JSWeakMapFields,
    WeakSetFields,
    JSInternalFields,
    InternalState,
    CatchLocals,
    Absolute,
    /// DOMJIT tells the heap range with the pair of integers.
    DOMState,
    /// Use this for writes only, to indicate that this may fire watchpoints. Usually this is never
    /// directly written but instead we test to see if a node clobbers this; it just so happens that
    /// you have to write world to clobber it.
    WatchpointFire,
    /// Use these for reads only, just to indicate that if the world got clobbered, then this
    /// operation will not work.
    MiscFields,
    /// Use this for writes only, just to indicate that hoisting the node is invalid. This works
    /// because we don't hoist anything that has any side effects at all.
    SideState,
}

#[derive(Clone, Copy)]
pub struct DomCall {
    pub class_name: &'static str,
    pub function_name: &'static str,
    /// `<class>__<fn>__put` — generated in `ZigLazyStaticFunctions-inlines.h`.
    pub put: unsafe extern "C" fn(*mut JSGlobalObject, JSValue),
}

// ───────────────────────── instance/static method wrapping ─────────────────────────

// Zig: `pub fn InstanceMethodType(comptime Container: type) type`
pub type InstanceMethodType<C> = fn(&mut C, &JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

// ported from: src/jsc/host_fn.zig
