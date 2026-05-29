#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod libuv;
#[cfg(windows)]
pub use libuv::*;

pub type uv_dirent_type_t = core::ffi::c_uint;
pub const UV_DIRENT_UNKNOWN: core::ffi::c_int = 0;
pub const UV_DIRENT_FILE: core::ffi::c_int = 1;
pub const UV_DIRENT_DIR: core::ffi::c_int = 2;
pub const UV_DIRENT_LINK: core::ffi::c_int = 3;
pub const UV_DIRENT_FIFO: core::ffi::c_int = 4;
pub const UV_DIRENT_SOCKET: core::ffi::c_int = 5;
pub const UV_DIRENT_CHAR: core::ffi::c_int = 6;
pub const UV_DIRENT_BLOCK: core::ffi::c_int = 7;

#[cfg(not(windows))]
pub const UV_ECHARSET: core::ffi::c_int = -4080;
#[cfg(not(windows))]
pub const UV_ENONET: core::ffi::c_int = -4056;
#[cfg(not(windows))]
pub const UV_ENOTSUP: core::ffi::c_int = -4049;
#[cfg(not(windows))]
pub const UV_EREMOTEIO: core::ffi::c_int = -4030;
#[cfg(not(windows))]
pub const UV_EFTYPE: core::ffi::c_int = -4028;
#[cfg(not(windows))]
pub const UV_ENODATA: core::ffi::c_int = -4024;
#[cfg(not(windows))]
pub const UV_EUNATCH: core::ffi::c_int = -4023;
