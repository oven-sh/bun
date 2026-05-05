//! JSC bridge for `bun.FD`. Keeps `src/sys/` free of JSC types.

use core::ffi::c_int;

use bun_sys::{Fd, FdExt, FdKind};

use crate::{JSGlobalObject, JSValue, JsResult};

/// Extension trait wiring `to_js` / `from_js` onto `bun_sys::Fd`.
/// In Zig these are free functions re-exported onto `bun.FD` via the
/// `*_jsc` alias; in Rust the `*_jsc` crate provides them as trait methods.
pub trait FdJsc: Sized {
    fn from_js(value: JSValue) -> Option<Self>;
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Self>>;
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn to_js_without_making_lib_uv_owned(self) -> JSValue;
}

impl FdJsc for Fd {
    /// fd "fails" if not given an int32, returning null in that case
    fn from_js(value: JSValue) -> Option<Fd> {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::JSValue::{is_any_int,to_int64}
        {
            if !value.is_any_int() {
                return None;
            }
            let fd64 = value.to_int64();
            if fd64 < 0 || fd64 > i64::from(i32::MAX) {
                return None;
            }
            let fd: i32 = i32::try_from(fd64).unwrap();
            // On Windows, JS-visible fds are libuv/CRT fds (see `to_js`). libuv fd
            // 0/1/2 already map to stdio, so there is no need to substitute the
            // cached `.system` HANDLE here — doing so forces every `sys_uv` call to
            // round-trip through `Fd::uv()`'s stdio-handle comparison, which panics
            // if the process std handle was swapped after startup.
            return Some(Fd::from_uv(fd));
        }
        let _ = value;
        todo!("b2-blocked: bun_jsc::JSValue::{{is_any_int,to_int64}}")
    }

    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Fd>> {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::JSValue::{is_number,as_number}
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::throw_range_error
        // TODO(b2-blocked): bun_jsc::RangeErrorOptions
        {
            if !value.is_number() {
                return Ok(None);
            }
            let float = value.as_number();
            if float % 1.0 != 0.0 {
                return Err(global.throw_range_error(float, bun_jsc::RangeErrorOptions {
                    field_name: "fd",
                    msg: Some("an integer"),
                    ..Default::default()
                }));
            }
            if float < 0.0 || float > i32::MAX as f64 {
                return Err(global.throw_range_error(float, bun_jsc::RangeErrorOptions {
                    field_name: "fd",
                    min: Some(0),
                    max: Some(i32::MAX),
                    ..Default::default()
                }));
            }
            let int: i64 = float as i64;
            let fd: c_int = c_int::try_from(int).unwrap();
            // See `from_js` above for why stdio fds are not remapped to the cached
            // `.system` HANDLE on Windows.
            return Ok(Some(Fd::from_uv(fd)));
        }
        let _ = (value, global);
        todo!("b2-blocked: bun_jsc::JSValue/{{throw_range_error,RangeErrorOptions}}")
    }

    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::JSValue::{js_number_from_int32,ZERO}
        // TODO(b2-blocked): bun_jsc::SystemError::to_error_instance
        // TODO(b2-blocked): bun_jsc::JSGlobalObject::vm / bun_jsc::VM::throw_error
        {
            if !self.is_valid() {
                return JSValue::js_number_from_int32(-1);
            }
            let uv_owned_fd = match self.make_lib_uv_owned() {
                Ok(fd) => fd,
                Err(_) => {
                    self.close();
                    let err_instance = (bun_jsc::SystemError {
                        message: bun_string::String::static_(b"EMFILE, too many open files"),
                        code: bun_string::String::static_(b"EMFILE"),
                        ..Default::default()
                    })
                    .to_error_instance(global);
                    return global
                        .vm()
                        .throw_error(global, err_instance)
                        .unwrap_or(JSValue::ZERO);
                }
            };
            return JSValue::js_number_from_int32(uv_owned_fd.uv());
        }
        let _ = (self.is_valid(), global);
        todo!("b2-blocked: bun_jsc::JSValue::js_number_from_int32 / SystemError::to_error_instance")
    }

    /// Convert an FD to a JavaScript number without transferring ownership to libuv.
    /// Unlike to_js(), this does not call make_lib_uv_owned() on Windows, so the caller
    /// retains ownership and must close the FD themselves.
    /// Returns -1 for invalid file descriptors.
    /// On Windows: returns Uint64 for system handles, Int32 for uv file descriptors.
    fn to_js_without_making_lib_uv_owned(self) -> JSValue {
        #[cfg(any())]
        // TODO(b2-blocked): bun_jsc::JSValue::{js_number_from_int32,js_number_from_uint64}
        {
            if !self.is_valid() {
                return JSValue::js_number_from_int32(-1);
            }
            #[cfg(windows)]
            {
                // PORT NOTE: Zig accessed `any_fd.value.as_system` / `.as_uv` directly.
                // `bun_core::Fd` exposes `kind()` / `native()` / `uv()` instead.
                return match self.kind() {
                    FdKind::System => {
                        JSValue::js_number_from_uint64(self.native() as u64)
                    }
                    FdKind::Uv => JSValue::js_number_from_int32(self.uv()),
                };
            }
            #[cfg(not(windows))]
            {
                return JSValue::js_number_from_int32(self.native());
            }
        }
        let _ = self.is_valid();
        todo!("b2-blocked: bun_jsc::JSValue::js_number_from_int32")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys_jsc/fd_jsc.zig (80 lines)
//   confidence: medium (bodies gated on bun_jsc stub surface)
//   blocked:    bun_jsc::{JSValue methods, RangeErrorOptions, SystemError::to_error_instance,
//               JSGlobalObject::{throw_range_error,vm}, VM::throw_error}
// ──────────────────────────────────────────────────────────────────────────
