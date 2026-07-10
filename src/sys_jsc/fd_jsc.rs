//! JSC bridge for `bun.FD`. Keeps `src/sys/` free of JSC types.

use core::ffi::c_int;

use bun_sys::Fd;
#[cfg(windows)]
use bun_sys::FdKind;

use crate::{JSGlobalObject, JSValue, JsResult, RangeErrorOptions};

/// Extension trait wiring `to_js` / `from_js` onto `bun_sys::Fd`;
/// the `*_jsc` crate provides them as trait methods.
pub trait FdJsc: Sized {
    fn from_js(value: JSValue) -> Option<Self>;
    fn from_js_validated(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Self>>;
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn to_js_without_minting(self) -> JSValue;
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
        // On Windows, JS-visible fds are libuv/CRT fds (see `to_js`). libuv fd
        // 0/1/2 already map to stdio, so there is no need to substitute the
        // cached `.system` HANDLE here — doing so forces every syscall wrapper to
        // round-trip through `Fd::uv()`'s stdio-handle comparison, which panics
        // if the process std handle was swapped after startup.
        Some(Fd::from_js_fd(fd))
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
            return Err(global.throw_range_error(
                float,
                RangeErrorOptions {
                    field_name: b"fd",
                    min: 0,
                    max: i64::from(i32::MAX),
                    ..Default::default()
                },
            ));
        }
        let int: i64 = float as i64;
        let fd: c_int = c_int::try_from(int).expect("int cast");
        // See `from_js` above for why stdio fds are not remapped to the cached
        // `.system` HANDLE on Windows.
        Ok(Some(Fd::from_js_fd(fd)))
    }

    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        if !self.is_valid() {
            return JSValue::js_number_from_int32(-1);
        }
        let table_fd = match self.make_table_owned() {
            Ok(fd) => fd,
            Err(code) => {
                // make_table_owned closed the handle on any failure; surface
                // the real Win32 code instead of assuming table exhaustion.
                // (POSIX make_table_owned is the identity — this arm only
                // compiles there; `code` maps through the plain errno path.)
                #[cfg(windows)]
                let e = bun_sys::windows::win_error::translate(bun_sys::windows::Win32Error(
                    u16::try_from(code).unwrap_or(u16::MAX),
                ));
                #[cfg(not(windows))]
                let e = bun_sys::E::from_raw(code as u16);
                let err = bun_sys::Error::new(e, bun_sys::Tag::open);
                return match crate::ErrorJsc::to_js(&err, global) {
                    Ok(v) => {
                        let _ = global.vm().throw_error(global, v);
                        JSValue::ZERO
                    }
                    Err(_) => JSValue::ZERO,
                };
            }
        };
        JSValue::js_number_from_int32(table_fd.js_fd())
    }

    /// Convert an FD to a JavaScript number without transferring ownership to
    /// the fd table. Unlike to_js(), this does not mint on Windows, so the
    /// caller retains ownership and must close the FD themselves.
    /// Returns -1 for invalid file descriptors.
    /// On Windows: returns Uint64 for system handles, Int32 for table fds.
    fn to_js_without_minting(self) -> JSValue {
        if !self.is_valid() {
            return JSValue::js_number_from_int32(-1);
        }
        #[cfg(windows)]
        {
            return match self.kind() {
                FdKind::System => JSValue::js_number_from_uint64(self.native() as u64),
                FdKind::Table => JSValue::js_number_from_int32(self.js_fd()),
            };
        }
        #[cfg(not(windows))]
        {
            JSValue::js_number_from_int32(self.native())
        }
    }
}
