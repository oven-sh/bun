//! Minimal Win32 ABI surface for `bun_core`'s `#[cfg(windows)]` paths.
//!
//! `bun_core` is tier-0 and may not depend on `bun_sys` (cycle). Shared Win32
//! POD typedefs/structs, kernel32 externs, and the TEB→PEB chain are
//! re-exported from the tier-0 leaf `bun_windows_sys` (which has zero `bun_*`
//! deps, so no cycle); only the `bun_core`-specific console consts and the
//! `Zeroable` impls live here. All declarations are zero-cost FFI
//! (`extern "system"` = `__stdcall`, which on x64 is the same as `extern "C"`).
#![cfg(windows)]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

pub use bun_windows_sys::{
    BOOL, CONSOLE_SCREEN_BUFFER_INFO, COORD, DWORD, FALSE, HANDLE, HRESULT, INVALID_HANDLE_VALUE,
    SHORT, SMALL_RECT, TRUE, WCHAR, WORD,
};

pub const STD_INPUT_HANDLE: DWORD = (-10i32) as DWORD;
pub const STD_OUTPUT_HANDLE: DWORD = (-11i32) as DWORD;
pub const STD_ERROR_HANDLE: DWORD = (-12i32) as DWORD;

// Console mode flags (consoleapi.h).
pub const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;
pub const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

/// Wrapper that returns `None` on `INVALID_HANDLE_VALUE` (matches
/// `std.os.windows.GetStdHandle` error-union semantics).
#[inline]
pub fn GetStdHandle(std_handle: DWORD) -> Option<HANDLE> {
    let h = kernel32::GetStdHandle(std_handle);
    if h == INVALID_HANDLE_VALUE || h.is_null() {
        None
    } else {
        Some(h)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PEB access (`std.os.windows.peb()`). `bun_core::output::windows_stdio`
// reads `ProcessParameters.hStd{Input,Output,Error}` to snapshot the console
// handles before libuv touches them. Canonical structs/asm live in the tier-0
// `bun_windows_sys` leaf and are re-exported here for the
// `crate::windows_sys::*` path used by callers.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_windows_sys::UNICODE_STRING as UnicodeString;
pub use bun_windows_sys::{
    CURDIR, Curdir, PEB, PebView, ProcessParameters, RTL_USER_PROCESS_PARAMETERS, TEB, peb, teb,
};

// SAFETY: nested `i16`/`u16` POD; all-zero is the documented pre-call state
// for `GetConsoleScreenBufferInfo` out-params. Impl lives here (not in
// `bun_windows_sys`) because the `Zeroable` trait is owned by `bun_core`.
#[cfg(windows)]
unsafe impl crate::ffi::Zeroable for CONSOLE_SCREEN_BUFFER_INFO {}

// kernel32 externs are owned by the tier-0 leaf `bun_windows_sys`; re-export
// so existing `crate::windows_sys::kernel32::*` / `c::*` callers resolve.
pub use bun_windows_sys::kernel32;
// `c::` alias used by `output.rs` (Zig's `bun.c` namespace).
pub use kernel32 as c;

/// `bun.windows.libuv` — only `uv_disable_stdio_inheritance` is called from
/// `bun_core`; declared directly to avoid a `bun_libuv_sys` dep at tier-0.
pub mod libuv {
    unsafe extern "C" {
        /// No preconditions; walks the CRT fd table and clears HANDLE_FLAG_INHERIT.
        pub safe fn uv_disable_stdio_inheritance();
    }
}
