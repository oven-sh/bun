//! JSC bridge for `bun.FD`. Keeps `src/sys/` free of JSC types.

#[cfg(windows)]
use bun_sys::FdKind;
use bun_sys::{Fd, FdExt};

use crate::{JSGlobalObject, JSValue};

/// `from_js` and `to_js` for `bun_sys::Fd`.
pub trait FdJsc: Sized {
    /// Of a file descriptor that a schema validated.
    fn from_js(fd: i32) -> Self;
    fn to_js(self, global: &JSGlobalObject) -> JSValue;
    fn to_number_without_making_lib_uv_owned(self) -> i64;
}

impl FdJsc for Fd {
    #[inline]
    fn from_js(fd: i32) -> Fd {
        // On Windows, JS-visible fds are libuv/CRT fds (see `to_js`). libuv fd
        // 0/1/2 already map to stdio, so there is no need to substitute the
        // cached `.system` HANDLE here — doing so forces every `sys_uv` call to
        // round-trip through `Fd::uv()`'s stdio-handle comparison, which panics
        // if the process std handle was swapped after startup.
        Fd::from_uv(fd)
    }

    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        if !self.is_valid() {
            return JSValue::js_number_from_int32(-1);
        }
        let uv_owned_fd = match self.make_lib_uv_owned() {
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
        JSValue::js_number_from_int32(uv_owned_fd.uv())
    }

    /// The number JavaScript sees for an FD, without transferring ownership to libuv.
    /// Unlike to_js(), this does not call make_lib_uv_owned() on Windows, so the caller
    /// retains ownership and must close the FD themselves.
    /// Returns -1 for invalid file descriptors.
    /// On Windows: the handle for system handles, the uv file descriptor otherwise.
    fn to_number_without_making_lib_uv_owned(self) -> i64 {
        if !self.is_valid() {
            return -1;
        }
        #[cfg(windows)]
        {
            return match self.kind() {
                FdKind::System => self.native() as i64,
                FdKind::Uv => i64::from(self.uv()),
            };
        }
        #[cfg(not(windows))]
        {
            i64::from(self.native())
        }
    }
}
