//! JSC bridge for `bun.FD`. Keeps `src/sys/` free of JSC types.

use core::ffi::c_int;

#[cfg(windows)]
use bun_sys::FdKind;
use bun_sys::{Fd, FdExt};

use crate::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions};

/// Extension trait wiring `to_js` / `from_js` onto `bun_sys::Fd`;
/// the `*_jsc` crate provides them as trait methods.
pub trait FdJsc: Sized {
    fn from_js(value: JSValue) -> Option<Self>;
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Self>>;
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn to_js_without_making_crt_owned(self) -> JSValue;
}

impl FdJsc for Fd {
    /// fd "fails" if not given an int32, returning null in that case
    fn from_js(value: JSValue) -> Option<Fd> {
        if !value.is_any_int() {
            return None;
        }
        let fd64 = value.to_int64();
        if fd64 < 0 || fd64 > i64::from(i32::MAX) {
            return None;
        }
        let fd: i32 = i32::try_from(fd64).expect("int cast");
        // On Windows, JS-visible fds are CRT fds (see `to_js`). CRT fd 0/1/2
        // already map to stdio, so there is no need to substitute the cached
        // `.system` HANDLE here.
        Some(Fd::from_crt(fd))
    }

    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Fd>> {
        if !value.is_number() {
            return Ok(None);
        }
        let float = value.as_number();
        if float % 1.0 != 0.0 {
            return Err(global.throw_range_error(
                float,
                RangeErrorOptions {
                    field_name: b"fd",
                    msg: b"an integer",
                    ..Default::default()
                },
            ));
        }
        if float < 0.0 || float > i32::MAX as f64 {
            // Node validates fd with validateInt32, which spells the range with "&&".
            // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L126
            let range = format!(">= 0 && <= {}", i32::MAX);
            return Err(global.throw_range_error(
                float,
                RangeErrorOptions {
                    field_name: b"fd",
                    msg: range.as_bytes(),
                    ..Default::default()
                },
            ));
        }
        let int: i64 = float as i64;
        let fd: c_int = c_int::try_from(int).expect("int cast");
        // See `from_js` above for why stdio fds are not remapped to the cached
        // `.system` HANDLE on Windows.
        Ok(Some(Fd::from_crt(fd)))
    }

    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        if !self.is_valid() {
            return JSValue::js_number_from_int32(-1);
        }
        let crt_owned_fd = match self.make_crt_owned() {
            Ok(fd) => fd,
            Err(_) => {
                self.close();
                let err_instance = (bun_jsc::SystemError {
                    message: bun_core::String::static_("EMFILE, too many open files"),
                    code: bun_core::String::static_("EMFILE"),
                    ..Default::default()
                })
                .to_error_instance(global);
                let _ = global.vm().throw_error(global, err_instance);
                return JSValue::ZERO;
            }
        };
        JSValue::js_number_from_int32(crt_owned_fd.crt())
    }

    /// Convert an FD to a JavaScript number without transferring ownership to the C runtime.
    /// Unlike to_js(), this does not call make_crt_owned() on Windows, so the caller
    /// retains ownership and must close the FD themselves.
    /// Returns -1 for invalid file descriptors.
    /// On Windows: returns Uint64 for system handles, Int32 for CRT file descriptors.
    fn to_js_without_making_crt_owned(self) -> JSValue {
        if !self.is_valid() {
            return JSValue::js_number_from_int32(-1);
        }
        #[cfg(windows)]
        {
            return match self.kind() {
                FdKind::System => JSValue::js_number_from_uint64(self.native() as u64),
                FdKind::Crt => JSValue::js_number_from_int32(self.crt()),
            };
        }
        #[cfg(not(windows))]
        {
            JSValue::js_number_from_int32(self.native())
        }
    }
}
