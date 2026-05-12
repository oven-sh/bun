#![allow(
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
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
    RangeErrorOptions, SystemError, VM,
};

// ──────────────────────────────────────────────────────────────────────────
// SystemErrorJsc — JSC bridge for the T1 `bun_sys::SystemError` data struct.
//
// In Zig there is one `jsc.SystemError` with `.toErrorInstance()`. The Rust
// port split the *data* (`bun_sys::SystemError`, NOT `#[repr(C)]`) from the
// FFI struct (`bun_jsc::SystemError`, `#[repr(C)]` field-order = C++). This
// trait marshals the former into the latter and forwards to
// `bun_jsc::SystemError::to_error_instance{,_with_async_stack}`.
//
// Ref-count contract: `bun_jsc::SystemError::to_error_instance` does
// `defer this.deref()` (matching SystemError.zig), so the marshalled struct
// must hold exactly the refs `self` held — i.e. a bitwise field copy with NO
// extra `ref_()`. The caller's `bun_sys::SystemError` is consumed (its strings
// reach refcount-0) just as in Zig where `Error.toSystemError()` builds a
// temporary that `.toErrorInstance()` consumes.
// ──────────────────────────────────────────────────────────────────────────
pub trait SystemErrorJsc {
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue;
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue;
}

#[inline]
fn marshal(e: &bun_sys::SystemError) -> bun_jsc::SystemError {
    // `bun_core::String` is `Copy` (intrusive WTF refcount handle); bitwise
    // copy *transfers* the existing ref to the FFI-layout struct. No `ref_()`
    // here — `to_error_instance()` will `deref()` each field exactly once.
    bun_jsc::SystemError {
        errno: e.errno as core::ffi::c_int,
        code: e.code,
        message: e.message,
        path: e.path,
        syscall: e.syscall,
        hostname: e.hostname,
        fd: e.fd as core::ffi::c_int,
        dest: e.dest,
    }
}

impl SystemErrorJsc for bun_sys::SystemError {
    /// `SystemError.toErrorInstance(global)` (SystemError.zig).
    fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        marshal(self).to_error_instance(global)
    }
    /// `SystemError.toErrorInstanceWithAsyncStack(global, promise)`
    /// (SystemError.zig) — `toErrorInstance` then attach the promise's await
    /// chain as async stack frames so threadpool-rejected promises get a
    /// useful trace.
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        marshal(self).to_error_instance_with_async_stack(global, promise)
    }
}

// ported from: src/sys_jsc/{signal_code,error,fd}_jsc.zig
