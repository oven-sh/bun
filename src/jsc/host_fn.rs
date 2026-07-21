//! Host function wrappers — the glue between Rust functions and JSC native callbacks.
//!
//! The fn-wrapping machinery lives in the `#[bun_jsc::host_fn]` /
//! `#[bun_jsc::host_call]` proc-macro attributes. This file keeps:
//!   - the runtime result-mapping helpers the macros call into,
//!   - the FFI surface for `JSFunction` creation,
//! and stubs the reflection-driven generators (callers hand-write the
//! equivalent decode/dispatch glue until the proc-macros grow those modes).

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
// directly.

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

/// Safe host-function shape; `#[bun_jsc::host_fn]` wraps it into a `JsHostFn`.
pub type JsHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

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

// Capitalized re-exports — enough call sites (and the crate-root re-export in
// lib.rs) use the acronym-caps `JSHostFn*` spelling that both must resolve.
pub use {JsHostFn as JSHostFn, JsHostFnZig as JSHostFnZig};

// ─────────────────────── host-fn wrapping (proc-macro) ───────────────────────

/// Map a `JsResult<JSValue>` to the raw `JSValue` a host fn must return
/// (`.zero` when an exception is pending).
pub fn to_js_host_fn_result(global_this: &JSGlobalObject, result: JsResult<JSValue>) -> JSValue {
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
    // `func` is the fn name string (the proc-macro supplies `stringify!(fn_name)`).
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
            // `formatter` drops here.
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

/// Normalize a setter body's return type to `JsResult<()>`. Setter bodies
/// return `()` or `JsResult<()>`; both map to `bool` (true on success) at the ABI.
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
// Some setters return `bool` directly (e.g. `Image.setBackend`): at the ABI,
// `false` is the signal for "exception already thrown". The Rust thunk wraps in an
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

pub fn host_fn_getter_this<T, R: IntoHostFnReturn>(
    this: &mut T,
    this_value: JSValue,
    global: &JSGlobalObject,
    f: impl FnOnce(&mut T, JSValue, &JSGlobalObject) -> R,
) -> JSValue {
    host_fn_result(global, || f(this, this_value, global))
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

pub fn host_fn_setter_this<T, R: IntoHostSetterReturn>(
    this: &mut T,
    this_value: JSValue,
    global: &JSGlobalObject,
    value: JSValue,
    f: impl FnOnce(&mut T, JSValue, &JSGlobalObject, JSValue) -> R,
) -> bool {
    host_setter_result(global, || f(this, this_value, global, value))
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

/// Convert the return value of a function returning an error union into a maybe-empty `JSValue`.
///
/// The caller (the proc-macro expansion) passes a closure that performs the call, so this only
/// handles the result mapping + exception-scope assertion.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `ExceptionValidationScope::init`.
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
/// `ExceptionValidationScope::init`.
#[track_caller]
#[inline]
pub fn from_js_host_call(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> JSValue,
) -> Result<JSValue, JsError> {
    // The JSValue-only constraint is enforced by the closure return type here.
    // Body is the `[[ZIG_EXPORT(zero_is_throw)]]` shape.
    crate::call_zero_is_throw(global_this, f)
}

/// Generic variant for wrapped FFI calls whose return value tells you nothing about
/// whether an exception was thrown.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `TopExceptionScope::init`.
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
    // Statically rejecting `R == JSValue` would need a
    // negative trait bound or specialization (neither stable), so this is enforced
    // by convention only.
    crate::call_check_slow(global_this, f)
}

// ───────────────────────── error conversion helpers ─────────────────────────

// For when bubbling up errors to functions that require a C ABI boundary
// TODO: make this not need a 'global_this'

// ───────────────────────────── FFI: JSFunction creation ──────────────────────────────

mod private {
    use super::*;

    // safe fn: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&`
    // is ABI-identical to non-null `*mut`); `Option<&ZigString>` is ABI-identical
    // to a nullable `*const ZigString` via the guaranteed null-pointer
    // optimization (C++ reads `nullptr` as "no name"). `data` /
    // `input_function_ptr` are opaque round-trip pointers C++ only stores into
    // the JSFunction's private slot (never dereferenced as Rust data) — same
    // contract as `Bun__FFIFunction_setDataPtr` below.
    unsafe extern "C" {
        pub(super) safe fn Bun__CreateFFIFunctionWithDataValue(
            global: &JSGlobalObject,
            symbol_name: Option<&ZigString>,
            arg_count: u32,
            // `JsHostFn` is already `unsafe extern "C" fn(...)`, i.e. the
            // fn-pointer type.
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
    // The caller passes an already-wrapped `JsHostFn` (produced by `#[bun_jsc::host_fn]`).
    private::Bun__CreateFFIFunctionWithDataValue(
        global_object,
        symbol_name,
        arg_count,
        function,
        data,
    )
}

// ───────────────────────── DOMCall codegen helpers ─────────────────────────
//
// `DOMCallArgumentType` / `DOMCallArgumentTypeWrapper` / `DOMCallResultType`
// feed the C++ codegen
// (`generate-classes.ts`), not runtime — there is nothing for the Rust side to
// hold; the spec-strings stay in the codegen script.

// The hand-written [`DomCall`] descriptor below is the mechanism for DOMJIT
// entries — call sites write the slow/fast paths and the
// `<class>__<fn>__put` extern themselves.

/// Runtime descriptor for a DOMJIT entry.
///
/// Until the `#[bun_jsc::dom_call]` proc-macro lands,
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

// There is no generic argument-decoding wrapper: each call site hand-writes
// its own argument decoding.
