#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge crate for `bun_sys`. Adds `to_js`/`from_js` extension surfaces
//! onto `bun_sys::{Fd, Error, SignalCode}` without pulling JSC types into the
//! syscall layer.

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate: Phase-A draft modules now compile UN-GATED. `bun_jsc` itself
// still does not build (transitive deps `bun_css`/`bun_sourcemap`/`bun_aio`
// fail), so this crate cannot `use bun_jsc::*` directly. Instead, the JSC
// opaque handle types AND the method surface the bodies need are shimmed
// locally below; modules import them from `crate::`. Every shim method is
// `todo!()` and tagged `// TODO(b2-blocked): bun_jsc::Symbol` — the *bodies*
// in the modules are now real and type-checked against signatures that mirror
// `bun_jsc`'s actual API (verified against `src/jsc/{lib,JSGlobalObject,
// CallFrame,VM,SystemError}.rs`).
//
// Once `bun_jsc` is green, replace the entire shim block with
// `pub use bun_jsc::{JSValue, JSGlobalObject, JSPromise, JSString, CallFrame,
// VM, JsResult, JsError, FromJsEnum};` and delete the local impls. The
// `SystemErrorJsc` extension trait stays here (it bridges T1
// `bun_sys::SystemError` → JSC, which is this crate's job).
// ──────────────────────────────────────────────────────────────────────────

pub mod signal_code_jsc;
pub mod error_jsc;
pub mod fd_jsc;

pub use error_jsc::ErrorJsc;
pub use fd_jsc::FdJsc;

// ──────────────────────────────────────────────────────────────────────────
// Crate-local JSC type shims (bun_jsc is not yet a usable dependency).
// These are layout-compatible with bun_jsc's B-1 stub_ty! opaque newtypes so
// downstream callers can switch to `bun_jsc::*` without signature churn.
// ──────────────────────────────────────────────────────────────────────────

/// Stand-in for `bun_jsc::JSValue` (`#[repr(transparent)] i64`, `Copy`, `!Send`).
// TODO(b2-blocked): bun_jsc::JSValue
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSValue(pub usize);

/// Stand-in for `bun_jsc::JSGlobalObject` (always borrowed, never owned).
// TODO(b2-blocked): bun_jsc::JSGlobalObject
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSGlobalObject(pub usize);

/// Stand-in for `bun_jsc::JSPromise`.
// TODO(b2-blocked): bun_jsc::JSPromise
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSPromise(pub usize);

/// Stand-in for `bun_jsc::CallFrame`.
// TODO(b2-blocked): bun_jsc::CallFrame
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct CallFrame(pub usize);

/// Stand-in for `bun_jsc::JsError` (opaque "exception pending" marker).
// TODO(b2-blocked): bun_jsc::JsError
#[derive(Debug, Clone, Copy, Default)]
pub struct JsError;

/// Stand-in for `bun_jsc::JsResult<T>` (= `Result<T, JsError>`).
// TODO(b2-blocked): bun_jsc::JsResult
pub type JsResult<T> = core::result::Result<T, JsError>;

/// Stand-in for `bun_jsc::JSString`.
// TODO(b2-blocked): bun_jsc::JSString
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct JSString(pub usize);

/// Stand-in for `bun_jsc::VM`.
// TODO(b2-blocked): bun_jsc::VM
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Default)]
pub struct VM(pub usize);

/// Stand-in for `bun_jsc`'s range-error options bag. Real type in `bun_jsc` is
/// `bun_core::fmt::OutOfRangeOptions<'a>` (`{min: i64, max: i64, field_name:
/// &[u8], msg: &[u8]}`); kept local so this crate need not depend on
/// `bun_core` directly while `bun_jsc` is unavailable.
// TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_range_error (options type)
#[derive(Default)]
pub struct RangeErrorOptions<'a> {
    pub field_name: &'a [u8],
    pub msg: &'a [u8],
    pub min: i64,
    pub max: i64,
}

/// Stand-in for `bun_jsc::FromJsEnum` (string-JSValue → Rust enum bridge used
/// by `JSValue::to_enum`).
// TODO(b2-blocked): bun_jsc::FromJsEnum
pub trait FromJsEnum: Sized {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self>;
}

// ──────────────────────────────────────────────────────────────────────────
// Shim method surface — mirrors `bun_jsc`'s real signatures so module bodies
// type-check. Every body is `todo!()`.
// ──────────────────────────────────────────────────────────────────────────

impl JSValue {
    pub const ZERO: JSValue = JSValue(0);
    pub const UNDEFINED: JSValue = JSValue(0xa);

    #[inline]
    pub fn is_number(self) -> bool {
        // TODO(b2-blocked): bun_jsc::JSValue::is_number
        todo!("b2-blocked: bun_jsc::JSValue::is_number")
    }
    #[inline]
    pub fn is_string(self) -> bool {
        // TODO(b2-blocked): bun_jsc::JSValue::is_string
        todo!("b2-blocked: bun_jsc::JSValue::is_string")
    }
    #[inline]
    pub fn is_any_int(self) -> bool {
        // TODO(b2-blocked): bun_jsc::JSValue::is_any_int
        todo!("b2-blocked: bun_jsc::JSValue::is_any_int")
    }
    #[inline]
    pub fn is_empty_or_undefined_or_null(self) -> bool {
        // TODO(b2-blocked): bun_jsc::JSValue::is_empty_or_undefined_or_null
        todo!("b2-blocked: bun_jsc::JSValue::is_empty_or_undefined_or_null")
    }
    #[inline]
    pub fn get_number(self) -> Option<f64> {
        // TODO(b2-blocked): bun_jsc::JSValue::get_number
        todo!("b2-blocked: bun_jsc::JSValue::get_number")
    }
    #[inline]
    pub fn as_number(self) -> f64 {
        // TODO(b2-blocked): bun_jsc::JSValue::as_number
        todo!("b2-blocked: bun_jsc::JSValue::as_number")
    }
    #[inline]
    pub fn to_int32(self) -> i32 {
        // TODO(b2-blocked): bun_jsc::JSValue::to_int32
        todo!("b2-blocked: bun_jsc::JSValue::to_int32")
    }
    #[inline]
    pub fn to_int64(self) -> i64 {
        // TODO(b2-blocked): bun_jsc::JSValue::to_int64
        todo!("b2-blocked: bun_jsc::JSValue::to_int64")
    }
    #[inline]
    pub fn as_string(self) -> JSString {
        // TODO(b2-blocked): bun_jsc::JSValue::as_string (returns *mut JSString in bun_jsc; deref at swap time)
        todo!("b2-blocked: bun_jsc::JSValue::as_string")
    }
    #[inline]
    pub fn js_number_from_int32(_i: i32) -> JSValue {
        // TODO(b2-blocked): bun_jsc::JSValue::js_number_from_int32
        todo!("b2-blocked: bun_jsc::JSValue::js_number_from_int32")
    }
    #[inline]
    pub fn js_number_from_uint64(_i: u64) -> JSValue {
        // TODO(b2-blocked): bun_jsc::JSValue::js_number_from_uint64
        todo!("b2-blocked: bun_jsc::JSValue::js_number_from_uint64")
    }
    pub fn to_enum<E: FromJsEnum>(
        self,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<E> {
        E::from_js_value(self, global, property_name)
    }
}

impl JSString {
    pub fn length(&self) -> usize {
        // TODO(b2-blocked): bun_jsc::JSString::length
        todo!("b2-blocked: bun_jsc::JSString::length")
    }
}

impl JSGlobalObject {
    pub fn throw_invalid_arguments(&self, _args: core::fmt::Arguments<'_>) -> JsError {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_invalid_arguments
        todo!("b2-blocked: bun_jsc::JSGlobalObject::throw_invalid_arguments")
    }
    pub fn throw(&self, _args: core::fmt::Arguments<'_>) -> JsError {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw
        todo!("b2-blocked: bun_jsc::JSGlobalObject::throw")
    }
    pub fn throw_range_error<V: core::fmt::Display>(
        &self,
        _value: V,
        _options: RangeErrorOptions<'_>,
    ) -> JsError {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_range_error
        todo!("b2-blocked: bun_jsc::JSGlobalObject::throw_range_error")
    }
    pub fn vm(&self) -> &VM {
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::vm
        todo!("b2-blocked: bun_jsc::JSGlobalObject::vm")
    }
}

impl VM {
    pub fn throw_error(&self, _global: &JSGlobalObject, _value: JSValue) -> JsError {
        // TODO(b2-blocked): bun_jsc::VM::throw_error
        todo!("b2-blocked: bun_jsc::VM::throw_error")
    }
}

impl CallFrame {
    pub fn arguments(&self) -> &[JSValue] {
        // TODO(b2-blocked): bun_jsc::CallFrame::arguments
        todo!("b2-blocked: bun_jsc::CallFrame::arguments")
    }
}

impl FromJsEnum for bun_sys::SignalCode {
    fn from_js_value(
        _v: JSValue,
        _global: &JSGlobalObject,
        _property_name: &'static str,
    ) -> JsResult<Self> {
        // TODO(b2-blocked): bun_jsc::FromJsEnum impl (string→enum lookup via SignalCode name table)
        todo!("b2-blocked: bun_jsc FromJsEnum for SignalCode")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SystemErrorJsc — JSC bridge for the T1 `bun_sys::SystemError` data struct.
//
// In Zig there is one `jsc.SystemError` with `.toErrorInstance()`. The Rust
// port split the data (T1 `bun_sys::SystemError`) from the JSC method
// (`bun_jsc::SystemError::to_error_instance`). Per PORTING.md §"_jsc bridge
// crates", this extension trait is the canonical bridge and STAYS in this
// crate after `bun_jsc` is green (its body becomes a thin call into
// `bun_jsc`).
// ──────────────────────────────────────────────────────────────────────────
pub trait SystemErrorJsc {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue;
}

impl SystemErrorJsc for bun_sys::SystemError {
    fn to_error_instance(&self, _global: &JSGlobalObject) -> JSValue {
        // TODO(b2-blocked): bun_jsc::SystemError::to_error_instance
        todo!("b2-blocked: bun_jsc::SystemError::to_error_instance")
    }
    fn to_error_instance_with_async_stack(
        &self,
        _global: &JSGlobalObject,
        _promise: &JSPromise,
    ) -> JSValue {
        // TODO(b2-blocked): bun_jsc::SystemError::to_error_instance_with_async_stack
        todo!("b2-blocked: bun_jsc::SystemError::to_error_instance_with_async_stack")
    }
}
