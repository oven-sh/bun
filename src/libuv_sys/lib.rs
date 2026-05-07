#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! Raw libuv FFI (Windows only). Re-exports the `libuv` module's contents at
//! crate root so callers can write `bun_libuv_sys::fs_t` /
//! `bun_sys::windows::libuv::uv_fs_open` (matching the Zig
//! `bun.windows.libuv.*` namespace).
pub mod libuv;
#[cfg(windows)]
pub use libuv::*;
