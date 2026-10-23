//! Host function wrappers — the glue between Rust functions and JSC native callbacks.
//!
//! The fn-wrapping machinery lives in the `#[bun_jsc::host_fn]` /
//! `#[bun_jsc::host_call]` proc-macro attributes. This file keeps:
//!   - the runtime result-mapping helpers the macros call into,
//!   - the FFI surface for `JSFunction` creation,
//! and stubs the reflection-driven generators (callers hand-write the
//! equivalent decode/dispatch glue until the proc-macros grow those modes).

use core::ffi::c_void;

use bun_core::EncodedSlice;
use bun_core::Environment;
use bun_core::Output;

use crate::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};

// ──────────────────────── panic handling ─────────────────────────────────────
//
// The workspace builds with `panic = "abort"`: a Rust `panic!` enters
// `bun_crash_handler`'s `std::panic` hook (trace string + report) and aborts
// before any unwind starts, so `catch_unwind` always returns `Ok` and there is
// no payload to convert into a JS exception. JSC does not throw C++ exceptions
// across its public API, so there is no foreign unwind to catch either. The
// closure-taking helpers below therefore call the user body directly.

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

/// Re-exported for [`jsc_promise_handler!`] expansions so callers need no
/// direct `bun_opaque` dep. Not public API.
#[doc(hidden)]
pub use bun_opaque::opaque_deref as __opaque_deref;

/// Define a `JsHostFn`-shaped promise-reaction shim that forwards to a safe
/// `fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>` body.
///
/// Expands to a [`jsc_host_abi!`] `extern fn` whose signature matches
/// [`JsHostFn`] (so the fn item coerces to the `JSValue::then`/`then2`
/// callback slot and to `Zig::GlobalObject::promiseHandlerID`'s address
/// comparison). The `*mut → &` derefs and `JsResult → JSValue` mapping are
/// centralised here so the caller spells zero `unsafe`.
///
/// Two forms:
///
/// ```ignore
/// // `#[unsafe(export_name = "Link__Symbol")]` on a locally-named shim:
/// bun_jsc::jsc_promise_handler!(
///     pub(crate) fn on_resolve_shim = "Link__Symbol" => on_resolve
/// );
///
/// // `#[unsafe(no_mangle)]` — the shim ident IS the link symbol:
/// bun_jsc::jsc_promise_handler!(
///     pub fn Link__Symbol => on_resolve
/// );
/// ```
#[macro_export]
macro_rules! jsc_promise_handler {
    ($vis:vis fn $shim:ident = $link:literal => $body:path) => {
        $crate::jsc_host_abi! {
            #[unsafe(export_name = $link)]
            $vis unsafe fn $shim(
                g: *mut $crate::JSGlobalObject,
                cf: *mut $crate::CallFrame,
            ) -> $crate::JSValue {
                let g = $crate::host_fn::__opaque_deref(g);
                let cf = $crate::host_fn::__opaque_deref(cf);
                $crate::host_fn::to_js_host_fn_result(g, $body(g, cf))
            }
        }
    };
    ($vis:vis fn $shim:ident => $body:path) => {
        $crate::jsc_host_abi! {
            #[unsafe(no_mangle)]
            $vis unsafe fn $shim(
                g: *mut $crate::JSGlobalObject,
                cf: *mut $crate::CallFrame,
            ) -> $crate::JSValue {
                let g = $crate::host_fn::__opaque_deref(g);
                let cf = $crate::host_fn::__opaque_deref(cf);
                $crate::host_fn::to_js_host_fn_result(g, $body(g, cf))
            }
        }
    };
}

// Capitalized re-exports — enough call sites (and the crate-root re-export in
// lib.rs) use the acronym-caps `JSHostFn*` spelling that both must resolve.
pub use {JsHostFn as JSHostFn, JsHostFnZig as JSHostFnZig};

// ─────────────────────── host-fn wrapping (proc-macro) ───────────────────────

/// Map a `JsResult<JSValue>` to the raw `JSValue` a host fn must return
/// (`.zero` when an exception is pending).
pub fn to_js_host_fn_result(global_this: &JSGlobalObject, result: JsResult<JSValue>) -> JSValue {
    let value = match result {
        Ok(v) => v,
        Err(e) => host_call_error_value(global_this, e),
    };
    if Environment::ALLOW_ASSERT && Environment::IS_CANARY {
        debug_exception_assertion(global_this, value, "_unknown_");
    }
    value
}

/// The `Err` arm of every host-fn trampoline, kept out of line: leaves the matching exception
/// pending and returns what the trampoline hands back to JSC.
#[cold]
#[inline(never)]
pub fn host_call_error_value(global_this: &JSGlobalObject, err: JsError) -> JSValue {
    match err {
        JsError::Thrown => JSValue::ZERO,
        JsError::OutOfMemory => global_this.throw_out_of_memory_value(),
        JsError::Terminated => terminated_beneath_script(global_this),
    }
}

/// `Terminated` reached a host-function trampoline (code shared with loop-level callers took the VM's
/// termination beneath us). Beneath script JSC still needs an exception to unwind what is above:
/// rethrow the VM's and return empty. With no script above (a trampoline C++ drives from the loop —
/// `AnyPromise::wrap` from a work-pool completion) there is nothing to unwind and nothing may be pending:
/// hand back `undefined`; whoever called stands down on the stopped VM.
#[cold]
fn terminated_beneath_script(global_this: &JSGlobalObject) -> JSValue {
    match crate::Stopped.throw(global_this) {
        JsError::Terminated => JSValue::UNDEFINED,
        _ => JSValue::ZERO,
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
    assert!(
        value.is_empty() == global_this.has_exception(),
        "host fn return/exception state mismatch"
    );
}

// ──────────────────────── codegen-thunk dispatch helpers ────────────────────────
//
// The thunks of `#[bun_jsc::host_fn]`, `generate-host-exports.ts`, `generate-js2native.ts` and `generate-jssink.ts` call these.

/// Normalize a host-fn body's return type to `JsResult<JSValue>`.
pub trait IntoHostFnReturn {
    fn into_host_fn_return(self) -> JsResult<JSValue>;
}
impl IntoHostFnReturn for JSValue {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        Ok(self)
    }
}
impl IntoHostFnReturn for JsResult<JSValue> {
    #[inline]
    fn into_host_fn_return(self) -> JsResult<JSValue> {
        self
    }
}

/// Runs the body in an `ExceptionValidationScope`.
#[track_caller]
#[inline]
pub fn host_fn_result<R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    f: impl FnOnce() -> R,
) -> JSValue {
    to_js_host_call(global, || f().into_host_fn_return())
}

// ──────────────────────── safe codegen-thunk entry points ────────────────────────

/// `fn(&JSGlobalObject, &CallFrame) -> R`.
#[track_caller]
#[inline]
pub fn host_fn_static<R: IntoHostFnReturn>(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    f: impl FnOnce(&JSGlobalObject, &CallFrame) -> R,
) -> JSValue {
    host_fn_result(global, || f(global, callframe))
}

/// No exception scope. For `host`-shape exports whose
/// impl returns bare `JSValue` (e.g. `Bun__drainMicrotasksFromJS`) — wrapping
/// these in `to_js_host_call` would trip the return/exception biconditional
/// when the body legitimately leaves an exception pending.
#[inline]
pub(crate) fn host_fn_static_passthrough(
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
    let (global, callframe) = unsafe {
        (
            JSGlobalObject::opaque_ref_nn(global),
            CallFrame::opaque_ref_nn(callframe),
        )
    };
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
    let (global, callframe) = unsafe {
        (
            JSGlobalObject::opaque_ref_nn(global),
            CallFrame::opaque_ref_nn(callframe),
        )
    };
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

/// Finalizer for a `refCounted: true` class: the wrapper held one ref on an
/// intrusively refcounted payload. Runs the type's `&self` hook (clear a
/// `this_value`, mark finalized, …) and drops that ref.
///
/// # Safety
/// `this` is the live pointer the wrapper holds a ref on.
#[inline]
pub unsafe fn host_fn_finalize_ref_counted<T: bun_ptr::AnyRefCounted>(
    this: *mut T,
    f: impl FnOnce(&T),
) {
    // SAFETY: fn contract; other refs may exist, so only `&T` is formed.
    f(unsafe { &*this });
    // SAFETY: fn contract — releases the wrapper's ref.
    unsafe { T::rc_deref(this) };
}

/// Convert the return value of a function returning an error union into a maybe-empty `JSValue`.
///
/// The caller (the proc-macro expansion) passes a closure that performs the call, so this only
/// handles the result mapping + exception-scope assertion.
///
/// `#[track_caller]` propagates the caller's `Location` through to
/// `ExceptionValidationScope::init`.
#[track_caller]
#[inline]
pub fn to_js_host_call(
    global_this: &JSGlobalObject,
    f: impl FnOnce() -> JsResult<JSValue>,
) -> JSValue {
    let mut scope_storage = core::mem::MaybeUninit::uninit();
    let mut scope = jsc::ExceptionValidationScope::init_guard(&mut scope_storage, global_this);

    let normal = match f() {
        Ok(v) => v,
        Err(e) => host_call_error_value(global_this, e),
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
    // is ABI-identical to non-null `*mut`); `Option<&EncodedSlice>` is ABI-identical
    // to a nullable `*const EncodedSlice` via the guaranteed null-pointer
    // optimization (C++ reads `nullptr` as "no name"). `data` /
    // `input_function_ptr` are opaque round-trip pointers C++ only stores into
    // the JSFunction's private slot (never dereferenced as Rust data) — same
    // contract as `Bun__FFIFunction_setDataPtr` below.
    unsafe extern "C" {
        pub(super) safe fn Bun__CreateFFIFunctionWithDataValue(
            global: &JSGlobalObject,
            symbol_name: Option<&EncodedSlice>,
            arg_count: u32,
            // `JsHostFn` is already `unsafe extern "C" fn(...)`, i.e. the
            // fn-pointer type.
            function: JsHostFn,
            data: *mut c_void,
        ) -> JSValue;

        // safe: `JSValue` is a by-value tagged i64; `data` is an opaque
        // round-trip pointer the C++ side stores in the JSFunction's private
        // slot without dereferencing it as Rust data.
        pub(super) safe fn Bun__FFIFunction_getDataPtr(value: JSValue) -> *mut c_void;
        pub(super) safe fn Bun__FFIFunction_setDataPtr(value: JSValue, data: *mut c_void);
    }
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
    symbol_name: Option<&EncodedSlice>,
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
    /// `<class>__<fn>__put`, defined in `ZigGeneratedCode.cpp`.
    pub put: unsafe extern "C" fn(*mut JSGlobalObject, JSValue),
}

// ───────────────────────── instance/static method wrapping ─────────────────────────

// There is no generic argument-decoding wrapper: each call site hand-writes
// its own argument decoding.
