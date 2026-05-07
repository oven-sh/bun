//! Minimal Win32 ABI surface for `bun_core`'s `#[cfg(windows)]` paths.
//!
//! `bun_core` is tier-0 and may not depend on `bun_sys` (cycle), so the
//! handful of kernel32/ntdll types and externs it needs are mirrored here
//! from `vendor/nodejs/` headers / MSDN. All declarations are zero-cost FFI
//! (`extern "system"` = `__stdcall`, which on x64 is the same as `extern "C"`).
#![cfg(windows)]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::{c_int, c_void};

pub type HANDLE = *mut c_void;
pub type HRESULT = i32;
pub type DWORD = u32;
pub type BOOL = c_int;
pub type SHORT = i16;
pub type WORD = u16;
pub type WCHAR = u16;

pub const TRUE: BOOL = 1;
pub const FALSE: BOOL = 0;
pub const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as HANDLE;

pub const STD_INPUT_HANDLE: DWORD = -10i32 as u32;
pub const STD_OUTPUT_HANDLE: DWORD = -11i32 as u32;
pub const STD_ERROR_HANDLE: DWORD = -12i32 as u32;

// Console mode flags (consoleapi.h).
pub const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;
pub const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct COORD {
    pub X: SHORT,
    pub Y: SHORT,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SMALL_RECT {
    pub Left: SHORT,
    pub Top: SHORT,
    pub Right: SHORT,
    pub Bottom: SHORT,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CONSOLE_SCREEN_BUFFER_INFO {
    pub dwSize: COORD,
    pub dwCursorPosition: COORD,
    pub wAttributes: WORD,
    pub srWindow: SMALL_RECT,
    pub dwMaximumWindowSize: COORD,
}

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
#[repr(C)]
pub struct ProcessParameters {
    _reserved1: [u8; 16],
    _reserved2: [*mut c_void; 5],
    pub hStdInput: HANDLE,
    pub hStdOutput: HANDLE,
    pub hStdError: HANDLE,
    // (fields beyond stdio are not read here)
}
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

pub mod kernel32 {
    use super::*;
    unsafe extern "system" {
        pub fn GetStdHandle(nStdHandle: DWORD) -> HANDLE;
        pub fn GetConsoleMode(hConsoleHandle: HANDLE, lpMode: *mut DWORD) -> BOOL;
        pub fn SetConsoleMode(hConsoleHandle: HANDLE, dwMode: DWORD) -> BOOL;
        pub fn GetConsoleOutputCP() -> u32;
        pub fn SetConsoleOutputCP(wCodePageID: u32) -> BOOL;
        pub fn GetConsoleCP() -> u32;
        pub fn SetConsoleCP(wCodePageID: u32) -> BOOL;
        pub fn ExitProcess(uExitCode: u32) -> !;
        pub fn ExitThread(dwExitCode: u32) -> !;
        pub fn GetConsoleScreenBufferInfo(
            hConsoleOutput: HANDLE,
            lpConsoleScreenBufferInfo: *mut CONSOLE_SCREEN_BUFFER_INFO,
        ) -> BOOL;
        pub fn FillConsoleOutputAttribute(
            hConsoleOutput: HANDLE,
            wAttribute: WORD,
            nLength: DWORD,
            dwWriteCoord: COORD,
            lpNumberOfAttrsWritten: *mut DWORD,
        ) -> BOOL;
        pub fn FillConsoleOutputCharacterW(
            hConsoleOutput: HANDLE,
            cCharacter: WCHAR,
            nLength: DWORD,
            dwWriteCoord: COORD,
            lpNumberOfCharsWritten: *mut DWORD,
        ) -> BOOL;
        pub fn SetConsoleCursorPosition(hConsoleOutput: HANDLE, dwCursorPosition: COORD) -> BOOL;
    }
}
// Re-export the console fns at module root under the `c::` alias used by
// `output.rs` (Zig's `bun.c` namespace).
pub use kernel32 as c;

/// `bun.windows.libuv` — only `uv_disable_stdio_inheritance` is called from
/// `bun_core`; declared directly to avoid a `bun_libuv_sys` dep at tier-0.
pub mod libuv {
    unsafe extern "C" {
        pub fn uv_disable_stdio_inheritance();
    }
}
