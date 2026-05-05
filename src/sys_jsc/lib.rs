#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! JSC bridge crate for `bun_sys`. Adds `to_js`/`from_js` extension surfaces
//! onto `bun_sys::{Fd, Error, SignalCode}` without pulling JSC types into the
//! syscall layer.

// ──────────────────────────────────────────────────────────────────────────
// B-2 un-gate: Phase-A draft modules are now compiled. `bun_jsc` itself does
// not yet build (18 errors), so this crate cannot `use bun_jsc::*` directly.
// Instead, the JSC opaque handle types are shimmed locally below and the
// modules import them from `crate::`. Fn bodies that need real `bun_jsc`
// methods (`JSValue::get_number`, `throw_range_error`, the `#[host_fn]`
// proc-macro, …) are re-gated with `#[cfg(any())]` and a `todo!()` fallback,
// each tagged `// TODO(b2-blocked): bun_jsc::Symbol`.
//
// Once `bun_jsc` is green, swap the shim block for
// `pub use bun_jsc::{JSValue, JSGlobalObject, JSPromise, CallFrame, JsResult, JsError};`
// and drop the per-body gates.
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
