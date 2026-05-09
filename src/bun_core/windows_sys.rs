//! Minimal Win32 ABI surface for `bun_core`'s `#[cfg(windows)]` paths.
//!
//! `bun_core` is tier-0 and may not depend on `bun_sys` (cycle). Shared Win32
//! POD typedefs/structs and kernel32 externs are re-exported from the tier-0
//! leaf `bun_windows_sys` (which has zero `bun_*` deps, so no cycle); only the
//! `bun_core`-specific console consts and PEB view live here. All declarations
//! are zero-cost FFI (`extern "system"` = `__stdcall`, which on x64 is the
//! same as `extern "C"`).
#![cfg(windows)]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::c_void;

pub use bun_windows_sys::{
    BOOL, COORD, CONSOLE_SCREEN_BUFFER_INFO, DWORD, FALSE, HANDLE, HRESULT, INVALID_HANDLE_VALUE,
    SMALL_RECT, TRUE, WCHAR, WORD,
};
pub type SHORT = i16;

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
    // SAFETY: kernel32 GetStdHandle has no preconditions.
    let h = unsafe { kernel32::GetStdHandle(std_handle) };
    if h == INVALID_HANDLE_VALUE || h.is_null() { None } else { Some(h) }
}

// ──────────────────────────────────────────────────────────────────────────
// PEB access (`std.os.windows.peb()`). `bun_core::output::windows_stdio`
// reads `ProcessParameters.hStd{Input,Output,Error}` to snapshot the console
// handles before libuv touches them.
// ──────────────────────────────────────────────────────────────────────────
/// `UNICODE_STRING` (`ntdef.h`).
pub use bun_windows_sys::UNICODE_STRING as UnicodeString;

// SAFETY: nested `i16`/`u16` POD; all-zero is the documented pre-call state
// for `GetConsoleScreenBufferInfo` out-params. Impl lives here (not in
// `bun_windows_sys`) because the `Zeroable` trait is owned by `bun_core`.
#[cfg(windows)]
unsafe impl crate::ffi::Zeroable for CONSOLE_SCREEN_BUFFER_INFO {}

#[repr(C)]
pub struct ProcessParameters {
    // {MaximumLength, Length, Flags, DebugFlags} — 4 × ULONG.
    _reserved1: [u8; 16],
    // {ConsoleHandle, ConsoleFlags+pad} — 2 × pointer-size.
    _reserved2: [*mut c_void; 2],
    pub hStdInput: HANDLE,
    pub hStdOutput: HANDLE,
    pub hStdError: HANDLE,
    // CURDIR CurrentDirectory — UNICODE_STRING (16) + HANDLE (8).
    _current_directory: [u8; 24],
    pub DllPath: UnicodeString,
    pub ImagePathName: UnicodeString,
    pub CommandLine: UnicodeString,
    // (fields beyond CommandLine are not read here)
}
// `RTL_USER_PROCESS_PARAMETERS` places `StandardInput` at 0x20 and
// `ImagePathName` at 0x60 on x64.
const _: () = assert!(core::mem::offset_of!(ProcessParameters, hStdInput) == 0x20);
const _: () = assert!(core::mem::offset_of!(ProcessParameters, ImagePathName) == 0x60);
#[repr(C)]
pub struct PebView {
    _reserved1: [u8; 2],
    pub BeingDebugged: u8,
    _reserved2: [u8; 1],
    _reserved3: [*mut c_void; 2],
    pub Ldr: *mut c_void,
    pub ProcessParameters: &'static ProcessParameters,
}

/// `std.os.windows.peb()` — reads `gs:[0x60]` (x64) / `__readgsqword(0x60)`.
#[inline]
pub unsafe fn peb() -> &'static PebView {
    #[cfg(target_arch = "x86_64")]
    unsafe {
        let p: *const PebView;
        core::arch::asm!("mov {}, gs:[0x60]", out(reg) p, options(nostack, pure, readonly));
        &*p
    }
    #[cfg(target_arch = "aarch64")]
    unsafe {
        // TEB at x18; PEB at TEB+0x60.
        let teb: *const u8;
        core::arch::asm!("mov {}, x18", out(reg) teb, options(nostack, pure, readonly));
        &*(*(teb.add(0x60) as *const *const PebView))
    }
}

// kernel32 externs are owned by the tier-0 leaf `bun_windows_sys`; re-export
// so existing `crate::windows_sys::kernel32::*` / `c::*` callers resolve.
pub use bun_windows_sys::kernel32;
// `c::` alias used by `output.rs` (Zig's `bun.c` namespace).
pub use kernel32 as c;

/// `bun.windows.libuv` — only `uv_disable_stdio_inheritance` is called from
/// `bun_core`; declared directly to avoid a `bun_libuv_sys` dep at tier-0.
pub mod libuv {
    unsafe extern "C" {
        pub fn uv_disable_stdio_inheritance();
    }
}
