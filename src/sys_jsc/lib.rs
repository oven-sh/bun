#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
//! JSC bridge crate for `bun_sys`. Adds `to_js`/`from_js` extension surfaces
//! onto `bun_sys::{Fd, Error, SignalCode}` without pulling JSC types into the
//! syscall layer.
//!
//! Layering: `bun_sys` (T1, no JSC) ← `bun_jsc` (T6) ← `bun_sys_jsc` (this
//! crate). The JSC types are owned by `bun_jsc` and re-exported here so the
//! submodules can name them as `crate::JSValue` / `crate::JSGlobalObject` etc.
//! per the `*_jsc` bridge-crate convention in PORTING.md.

pub mod error_jsc;
pub mod fd_jsc;
pub mod signal_code_jsc;

pub use error_jsc::ErrorJsc;
pub use fd_jsc::FdJsc;

// Re-export the JSC types this crate's API surface needs.
pub use bun_jsc::{
    CallFrame, FromJsEnum, JSGlobalObject, JSPromise, JSString, JSValue, JsError, JsResult,
    RangeErrorOptions, SystemError, SystemErrorJsc, VM,
};
