#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

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
    fn to_error_instance_with_async_stack(
        &self,
        global: &JSGlobalObject,
        promise: &JSPromise,
    ) -> JSValue {
        marshal(self).to_error_instance_with_async_stack(global, promise)
    }
}

// ported from: src/sys_jsc/{signal_code,error,fd}_jsc.zig
