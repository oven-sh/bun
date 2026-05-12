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

// ──────────────────────── panic handling ─────────────────────────────────────
//
// The workspace builds with `panic = "abort"`: a Rust `panic!` enters
// `bun_crash_handler`'s `std::panic` hook (trace string + report) and aborts
// before any unwind starts, so `catch_unwind` always returns `Ok` and there is
// no payload to convert into a JS exception. JSC does not throw C++ exceptions
// across its public API, so there is no foreign unwind to catch either. The
// closure-taking helpers below (`to_js_host_call`, `host_setter_result`,
// `host_construct_result`, `host_fn_finalize`) therefore call the user body
// directly — same end state as Zig `@panic` → `bun.crash_handler`.

// ───────────────────────────── type aliases ──────────────────────────────

/// A host function is the native function pointer type that can be used by a
/// `JSC::JSFunction` to call native code from JavaScript.
///
/// NOTE: `callconv(jsc.conv)` is `"sysv64"` on Windows-x64 and `"C"` elsewhere.
/// Rust does not accept a macro in ABI position, so the canonical encoding is the
/// `#[bun_jsc::host_call]` attribute on the concrete `extern fn`. This alias uses
/// `extern "C"` as the placeholder; the proc-macro rewrites it per-target.
// `jsc.conv` is `"sysv64"` on Windows-x64 (JSC always uses System V there) and
// `"C"` everywhere else. Rust forbids macros in ABI position, so cfg-split the
// alias — the `#[bun_jsc::host_call]` proc-macro emits the matching ABI on
// each target so `JsHostFn`-typed slots accept its output without a cast.
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

/// Expand to the JSC host-function ABI string for the current target. Rust
/// forbids macros in `extern "<abi>"` position, but *does* accept them as the
/// whole `extern` token sequence inside an item — so callers spell:
///
/// ```ignore
/// bun_jsc::jsc_host_abi! {
///     unsafe fn thunk(g: *mut JSGlobalObject, cf: *mut CallFrame) -> JSValue { … }
/// }
/// ```
///
/// and get `extern "sysv64"` on Windows-x64, `extern "C"` elsewhere. Use this
/// for inline thunks that can't carry the `#[bun_jsc::host_call]` proc-macro
/// (e.g. inside `macro_rules!` expansions).
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
#[allow(non_camel_case_types)]
pub use {
    JsHostFn as JSHostFn, JsHostFnZig as JSHostFnZig,
    JsHostFnZigWithContext as JSHostFnZigWithContext,
    JsHostFunctionTypeWithContext as JSHostFunctionTypeWithContext,
};

// ─────────────────────── comptime fn-wrapping → proc-macro ───────────────────────

// Zig: `pub fn toJSHostFn(comptime functionToWrap: JSHostFnZig) JSHostFn`
//
// In Zig this returns a freshly-monomorphized `extern fn` that closes over a
// `comptime` function pointer. Rust cannot mint an `extern "C" fn` item from a
// const fn pointer without a proc-macro (no `const fn` ABI thunks). Callers use
// `#[bun_jsc::host_fn]` instead, which emits the shim and calls
// `to_js_host_fn_result` for the body.
// TODO(port): proc-macro — `#[bun_jsc::host_fn]` replaces `toJSHostFn`.
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
    bun_core::assertf!(value.is_empty() == global_this.has_exception(), "host fn return/exception state mismatch");
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

// ──────────────────────── codegen-thunk dispatch helpers ────────────────────────
//
// `generate-classes.ts::generateRust()` emits per-property `#[no_mangle]` thunks
// of the form `host_fn_result(global, || T::method(&mut *this, …))`. These wrap
// the inherent-method body in an `ExceptionValidationScope` (mirroring
// `toJSHostCall`) and normalize the body's return type — `JSValue` /
// `JsResult<JSValue>` for fns and getters, `()` / `JsResult<()>` for setters,
// `*mut T` / `Box<T>` / `JsResult<_>` for constructors — to the raw C ABI value
// the C++ side expects. Kept in `bun_jsc` (not the proc-macro crate) so the
// generated `bun_runtime::generated_classes` module can name them without a
// crate cycle.

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
// Some Zig setters return `bool` directly (e.g. `Image.setBackend`): the
// generated Zig thunk passes the bool through to C++ with no exception-scope
// wrap, so `false` is the ABI signal for "exception already thrown" (the
// `catch return false` idiom). The Rust thunk *does* wrap in an
// `ExceptionValidationScope` and re-derives the ABI bool from `JsResult`, so
// `false` must round-trip to `Err(Thrown)` here — discarding it (as `Ok(())`)
// makes `host_setter_result` return `true` and trips
// `assert_exception_presence_matches(false)` while an exception is pending.
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

// ──────────────────────── safe codegen-thunk entry points ────────────────────────
//
// `generate-classes.ts::generateRust()` emits per-property `#[no_mangle]` thunks
// whose params are typed as `&mut T` / `&JSGlobalObject` / `&CallFrame` and
// forward straight into these helpers. `&T`/`&mut T` and `*const T`/`*mut T`
// are ABI-identical in `extern "C"` for non-null inputs, and the C++ caller
// (`ZigGeneratedClasses.cpp`) guarantees every pointer it passes is non-null,
// properly aligned, and live for the duration of the call — so the reference
// type *is* the safe spelling of the C ABI contract. The non-null obligation
// is discharged by the type system at the thunk boundary (a `&T` param is a
// `nonnull` `noalias` pointer in LLVM IR), not by an `unsafe { &*ptr }` deref
// inside a safe `pub fn` (which would be a soundness hole — safe Rust could
// otherwise pass null and trigger UB).
//
// The user's inherent method takes safe `&mut self` / `&JSGlobalObject` /
// `&CallFrame`. User methods that need the `VirtualMachine` call
// `global.bun_vm()` (now safe, returns `&'static VirtualMachine`).

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

/// Static / class method, no exception scope. For `host`-shape exports whose
/// impl returns bare `JSValue` (e.g. `Bun__drainMicrotasksFromJS`) — wrapping
/// these in `to_js_host_call` would trip the return/exception biconditional
/// when the body legitimately leaves an exception pending.
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
#[track_caller]
#[inline]
pub fn host_fn_static_raw<R: IntoHostFnReturn>(
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
#[inline]
pub fn host_fn_static_passthrough_raw(
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

// ──────────────────────────────────────────────────────────────────────────
// `_shared` siblings — `&T` receiver instead of `&mut T`.
//
// Emitted by `generate-classes.ts` when a `.classes.ts` definition sets
// `sharedThis: true` (R-2 noalias re-entrancy). `&mut T` carries LLVM
// `noalias`, so a host-fn that re-enters JS while holding `&mut self` lets
// the optimiser cache `*self` fields across the FFI call — proven miscompile
// in `NodeHTTPResponse::cork` (b818e70e1c57). `&T` is `readonly`, not
// `noalias`; aliased shared borrows are sound, and the user impl uses
// `Cell`/`JsCell` for any field it mutates.
//
// The `&mut` originals above are kept until every type has migrated
// (Phase 3 of `R-2-design.md` deletes them and drops the `_shared` suffix).
// ──────────────────────────────────────────────────────────────────────────

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
#[inline]
pub fn host_fn_finalize<T>(this: *mut T, f: impl FnOnce(alloc::boxed::Box<T>)) {
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

/// Convert the return value of a function returning an error union into a maybe-empty `JSValue`.
///
/// Zig signature took `comptime function: anytype` + an args tuple and `@call`'d it; in Rust the
/// caller (the proc-macro expansion) passes a closure that performs the call, so this only handles
/// the result mapping + exception-scope assertion.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `ExceptionValidationScope::init`, replacing Zig's explicit `@src()` argument.
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

/// Convert the return value of a function returning a maybe-empty `JSValue` into an error union.
/// The wrapped function must return an empty `JSValue` if and only if it has thrown an exception.
/// If your function does not follow this pattern (if it can return empty without an exception, or
/// throw an exception and return non-empty), either fix the function or write a custom wrapper with
/// `TopExceptionScope`.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `ExceptionValidationScope::init`, replacing Zig's explicit `@src()` argument.
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

/// Generic variant for wrapped FFI calls whose return value tells you nothing about
/// whether an exception was thrown.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `TopExceptionScope::init`, replacing Zig's explicit `@src()` argument.
#[track_caller]
#[inline]
pub fn from_js_host_call_generic<R>(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> Result<R, JsError> {
    // supporting JSValue would make it too easy to mix up this function with from_js_host_call
    // from_js_host_call has the benefit of checking that the function is correctly returning an
    // empty value if and only if it has thrown.
    // from_js_host_call_generic is only for functions where the return value tells you nothing
    // about whether an exception was thrown.
    //
    // TODO(port): static-assert `R != JSValue` (Zig used @compileError; Rust needs a
    // negative trait bound or specialization — neither stable). Phase B: sealed trait trick.
    crate::call_check_slow(global_this, f)
}

// ───────────────────────── error-set parsing (comptime) ─────────────────────────

#[derive(Default, Clone, Copy)]
struct ParsedHostFunctionErrorSet {
    out_of_memory: bool,
    js_error: bool,
}

// Zig: `inline fn parseErrorSet(T: type, errors: []const std.builtin.Type.Error) ...`
//
// Zig iterated `@typeInfo(ErrorSet)` at comptime; Rust has no error-set reflection, so the
// `#[bun_jsc::host_fn]` proc-macro supplies the variant names as string literals and this
// helper validates them at const-eval time. An unknown name `panic!`s — the const-context
// analogue of Zig's `@compileError`. The `T: type` parameter (used only for the diagnostic
// string in Zig) is dropped; the macro embeds the function name in its own error message.
#[allow(dead_code)]
const fn parse_error_set(errors: &[&str]) -> ParsedHostFunctionErrorSet {
    let mut errs = ParsedHostFunctionErrorSet { out_of_memory: false, js_error: false };
    let mut i = 0;
    while i < errors.len() {
        if bun_collections::const_str_eq(errors[i], "OutOfMemory") {
            errs.out_of_memory = true;
        } else if bun_collections::const_str_eq(errors[i], "JSError") {
            errs.js_error = true;
        } else {
            // Zig: @compileError("Return value from host function '...' can not contain error '...'")
            panic!("Return value from host function can not contain this error");
        }
        i += 1;
    }
    errs
}

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

// ───────────────────────────── wrapN family ──────────────────────────────
//
// Zig `wrap1`..`wrap5` / `wrap4v` each take a `comptime func: anytype`, reflect on
// its parameter list with `@typeInfo`, and return a fresh `extern fn` of matching
// arity that forwards through `toJSHostCall`. This is signature reflection —
// `// TODO(port): proc-macro`. The Rust replacement is a single attribute:
//
//     #[bun_jsc::host_call(wrap)]       // -> extern "C"   (wrap1..wrap5)
//     #[bun_jsc::host_call(wrap, sysv)] // -> jsc.conv ABI (wrap4v)
//
// `checkWrapParams` (arity + first-arg-is-*JSGlobalObject assertion) is enforced by
// the macro at expansion time.
// TODO(port): proc-macro — `wrap1`..`wrap5`, `wrap4v`, `checkWrapParams`.

// ───────────────────────────── FFI: JSFunction creation ──────────────────────────────

mod private {
    use super::*;

    // TODO(port): move to jsc_sys
    //
    // safe fn: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&`
    // is ABI-identical to non-null `*mut`); `Option<&ZigString>` is ABI-identical
    // to a nullable `*const ZigString` via the guaranteed null-pointer
    // optimization (C++ reads `nullptr` as "no name"). `data` /
    // `input_function_ptr` are opaque round-trip pointers C++ only stores into
    // the JSFunction's private slot (never dereferenced as Rust data) — same
    // contract as `Bun__FFIFunction_setDataPtr` below.
    unsafe extern "C" {
        pub safe fn Bun__CreateFFIFunctionWithDataValue(
            global: &JSGlobalObject,
            symbol_name: Option<&ZigString>,
            arg_count: u32,
            // Zig `*const JSHostFn` is a fn *pointer*; `JsHostFn` in Rust is already
            // `unsafe extern "C" fn(...)`, i.e. the pointer type.
            function: JsHostFn,
            data: *mut c_void,
        ) -> JSValue;

        pub safe fn Bun__CreateFFIFunctionValue(
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
        pub safe fn Bun__FFIFunction_getDataPtr(value: JSValue) -> *mut c_void;
        pub safe fn Bun__FFIFunction_setDataPtr(value: JSValue, data: *mut c_void);
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

// ───────────────────────── DOMCall codegen helpers ─────────────────────────
//
// `DOMCallArgumentType` / `DOMCallArgumentTypeWrapper` / `DOMCallResultType` map a
// Zig type to a C++ spec-string at comptime. They feed the C++ codegen
// (`generate-classes.ts`), not runtime. The proc-macro for `#[bun_jsc::dom_call]`
// owns this mapping in Rust.
// TODO(port): proc-macro — DOMCall type→spec-string tables move into the macro crate.

// Zig: `pub fn DOMCall(comptime class_name, comptime Container, comptime functionName,
//                      comptime dom_effect) type`
//
// Returns an `extern struct` that:
//   - `@export`s `<class>__<fn>__slowpath` / `__fastpath` with `callconv(jsc.conv)`,
//   - `@extern`s `<class>__<fn>__put`,
//   - exposes `effect`, `put()`, and `Arguments`.
//
// This is link-name synthesis + signature reflection. Rust replacement:
//
//     #[bun_jsc::dom_call(class = "Foo", effect = DomEffect::PURE)]
//     impl Foo { fn bar(...) -> ... { ... }  fn bar_without_type_checks(...) -> ... { ... } }
//
// TODO(port): proc-macro — `DOMCall` type-generator.

/// Runtime descriptor for a `DOMCall(...)`-generated DOMJIT entry.
///
/// In Zig `DOMCall` returns a comptime-generated `extern struct` type that
/// `@export`s `<class>__<fn>__slowpath`/`__fastpath` and `@extern`s
/// `<class>__<fn>__put`. Until the `#[bun_jsc::dom_call]` proc-macro lands,
/// callers (e.g. `bun:ffi`'s `FFIObject`) hand-write the slow/fast paths and
/// declare the C++-side `*__put` extern themselves; this struct carries just
/// enough to drive `to_js` (the `put(global, obj)` call that installs the
/// DOMJIT-backed property on a JS object).
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

// Zig: `pub fn wrapInstanceMethod(comptime Container, comptime name, comptime auto_protect)
//          InstanceMethodType(Container)`
//
// This is the heaviest reflection in the file: it iterates `@typeInfo(Fn).params`,
// pattern-matches each parameter TYPE (`*JSGlobalObject`, `ZigString`,
// `?jsc.ArrayBuffer`, `*WebCore.Response`, `?HTMLRewriter.ContentOptions`, ...) and
// emits per-param argument-decoding + error-throwing glue, then `@call`s the target.
// There is no value-level translation; the entire body is a type-directed code
// generator. Per PORTING.md §"Comptime reflection":
//
// TODO(port): proc-macro — `#[bun_jsc::host_fn(method, auto_protect)]` replaces
// `wrapInstanceMethod`. The macro must reproduce the per-type decode table:
//   *Container            -> `this`
//   *JSGlobalObject       -> `global`
//   *CallFrame            -> `frame`
//   Node.StringOrBuffer   -> `StringOrBuffer::from_js(global, arena, arg)?` or throw
//   ?Node.StringOrBuffer  -> optional of above (null/undefined -> None)
//   ArrayBuffer           -> `arg.as_array_buffer(global)` or throw "expected TypedArray"
//   ?ArrayBuffer          -> optional of above
//   ZigString             -> `arg.get_zig_string(global)?` (throws on undefined/null)
//   ?HTMLRewriter.ContentOptions -> `{ html: arg.get("html")?.to_boolean() }`
//   *WebCore.Response     -> `arg.as::<Response>()` or throw "Expected Response object"
//   *WebCore.Request      -> `arg.as::<Request>()` or throw "Expected Request object"
//   JSValue               -> required arg or throw "Missing argument"
//   ?JSValue              -> optional arg
//   C.ExceptionRef        -> `&mut exception_slot` (and re-throw on return if set)
//   <else>                -> compile_error!
// `auto_protect` selects `ArgumentsSlice::protect_eat_next` vs `::next_eat`.

// Zig: `pub fn wrapStaticMethod(comptime Container, comptime name, comptime auto_protect)
//          jsc.JSHostFnZig`
//
// Same as `wrapInstanceMethod` minus the `*Container`/`*CallFrame`/`ExceptionRef`
// arms, plus a `Node.BlobOrStringOrBuffer` arm.
// TODO(port): proc-macro — `#[bun_jsc::host_fn(static, auto_protect)]` replaces
// `wrapStaticMethod` (decode table as above + BlobOrStringOrBuffer).

// ported from: src/jsc/host_fn.zig
