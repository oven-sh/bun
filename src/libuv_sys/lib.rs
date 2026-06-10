#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! Raw libuv FFI (Windows only). Re-exports the `libuv` module's contents at
//! crate root so callers can write `bun_libuv_sys::fs_t` /
//! `bun_sys::windows::libuv::uv_fs_open`.
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

// ──────────────────────────────────────────────────────────────────────────
// libuv synthetic errno literals (uv/errno.h `UV__E*` fallbacks). These are
// platform-invariant ABI constants libuv assigns when the host OS lacks a
// native errno for the condition. On Windows the full `UV_E*` table is
// re-exported from `libuv::*` above; on posix we surface only the synthetic
// subset so `bun_errno`'s per-OS `uv_e` modules can reference a single source
// of truth instead of inlining the magic numbers.
// ──────────────────────────────────────────────────────────────────────────
/// `UV_UNKNOWN` (uv/errno.h `UV__UNKNOWN`): libuv's synthetic "unknown
/// error" code. Lives at crate root (not the Windows-only `libuv` module)
/// because [`uv_raw_errno`] below is compiled on every platform.
pub const UV_UNKNOWN: core::ffi::c_int = -4094;

/// Raw `|UV_E*|` magnitude of a negative libuv result, in the form stored in
/// `bun_sys::Error.errno` alongside `from_libuv: true`. Returns `None` for
/// non-negative (success) results.
///
/// On Windows, libuv's `uv_translate_sys_error` returns already-negative
/// inputs unchanged (vendor/libuv/src/win/error.c), so `req->result` can
/// carry system codes far outside the `UV_E*` range (NTSTATUS-shaped values
/// have been observed in the wild). A magnitude that does not fit the u16
/// errno field maps to `|UV_UNKNOWN|` instead of truncating, because a
/// truncated magnitude aliases a real errno (e.g. `-0x10002` would read back
/// as `ENOENT`).
pub const fn uv_raw_errno(rc: i64) -> Option<u16> {
    if rc >= 0 {
        return None;
    }
    let magnitude = rc.unsigned_abs();
    if magnitude <= u16::MAX as u64 {
        Some(magnitude as u16)
    } else {
        Some(UV_UNKNOWN.unsigned_abs() as u16)
    }
}

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
