#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! Raw libuv FFI (Windows only). Re-exports the `libuv` module's contents at
//! crate root so callers can write `bun_libuv_sys::fs_t` /
//! `bun_sys::windows::libuv::uv_fs_open` (matching the Zig
//! `bun.windows.libuv.*` namespace).
pub mod libuv;
#[cfg(windows)]
pub use libuv::*;

// ──────────────────────────────────────────────────────────────────────────
// `uv_dirent_type_t` (uv.h) — ABI constants for `uv_dirent_t::type`. The
// Windows-only `libuv` module above is `#![cfg(windows)]`, but these tag
// values are platform-invariant integers and are consumed cross-platform by
// `node::types::Dirent::to_js` (which surfaces them to JS as
// `process.binding('constants').fs.UV_DIRENT_*`).
// ──────────────────────────────────────────────────────────────────────────
pub type uv_dirent_type_t = core::ffi::c_uint;
pub const UV_DIRENT_UNKNOWN: core::ffi::c_int = 0;
pub const UV_DIRENT_FILE: core::ffi::c_int = 1;
pub const UV_DIRENT_DIR: core::ffi::c_int = 2;
pub const UV_DIRENT_LINK: core::ffi::c_int = 3;
pub const UV_DIRENT_FIFO: core::ffi::c_int = 4;
pub const UV_DIRENT_SOCKET: core::ffi::c_int = 5;
pub const UV_DIRENT_CHAR: core::ffi::c_int = 6;
pub const UV_DIRENT_BLOCK: core::ffi::c_int = 7;
