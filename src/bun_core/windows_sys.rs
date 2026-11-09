//! Minimal Win32 ABI surface for `bun_core`'s `#[cfg(windows)]` paths.
//!
//! `bun_core` is tier-0 and may not depend on `bun_sys` (cycle). Shared Win32
//! POD typedefs/structs, kernel32 externs, and the TEB→PEB chain are
//! re-exported from the tier-0 leaf `bun_windows_sys` (which has zero `bun_*`
//! deps, so no cycle); only the `bun_core`-specific console consts live here. All declarations are zero-cost FFI
//! (`extern "system"` = `__stdcall`, which on x64 is the same as `extern "C"`).
#![cfg(windows)]
#![allow(non_snake_case)]

pub use bun_windows_sys::{
    BOOL, CONSOLE_SCREEN_BUFFER_INFO, COORD, DWORD, FALSE, HANDLE, HRESULT, INVALID_HANDLE_VALUE,
    SHORT, SMALL_RECT, TRUE, WCHAR, WORD,
};

pub const STD_INPUT_HANDLE: DWORD = (-10i32) as DWORD;
pub const STD_OUTPUT_HANDLE: DWORD = (-11i32) as DWORD;
pub const STD_ERROR_HANDLE: DWORD = (-12i32) as DWORD;

// Console mode flags (consoleapi.h).
pub(crate) const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;
pub(crate) const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub(crate) const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;
pub(crate) const DISABLE_NEWLINE_AUTO_RETURN: DWORD = 0x0008;

/// Wrapper that returns `None` on `INVALID_HANDLE_VALUE` or a null handle.
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
// PEB access. `bun_core::output::windows_stdio`
// reads `ProcessParameters.hStd{Input,Output,Error}` to snapshot the console
// handles. Canonical structs/asm live in the tier-0
// `bun_windows_sys` leaf and are re-exported here for the
// `crate::windows_sys::*` path used by callers.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_windows_sys::{
    CURDIR, PEB, ProcessParameters, RTL_USER_PROCESS_PARAMETERS, TEB, peb, teb,
};

// kernel32 externs are owned by the tier-0 leaf `bun_windows_sys`; re-export
// so existing `crate::windows_sys::kernel32::*` callers resolve.
pub use bun_windows_sys::kernel32;

/// Stops children from inheriting what this process was started with: standard handles and C runtime descriptors.
pub(crate) fn disable_stdio_inheritance() {
    const HANDLE_FLAG_INHERIT: DWORD = 1;

    for id in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        if let Some(handle) = GetStdHandle(id) {
            let _ = kernel32::SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
        }
    }

    let mut info = core::mem::MaybeUninit::<bun_windows_sys::STARTUPINFOW>::uninit();
    // SAFETY: `GetStartupInfoW` fills the whole struct and cannot fail.
    let info = unsafe {
        kernel32::GetStartupInfoW(info.as_mut_ptr());
        info.assume_init()
    };
    // `int count; u8 flags[count]; HANDLE handles[count];`, unaligned.
    let size = info.cbReserved2 as usize;
    if info.lpReserved2.is_null() || size < size_of::<i32>() {
        return;
    }
    // SAFETY: the process parameters hold `cbReserved2` bytes at `lpReserved2` for the life of the process.
    let block = unsafe { core::slice::from_raw_parts(info.lpReserved2, size) };
    let (count, rest) = block.split_at(size_of::<i32>());
    let Ok(count) = usize::try_from(i32::from_ne_bytes(count.try_into().unwrap())) else {
        return;
    };
    if rest.len() < count * (1 + size_of::<HANDLE>()) {
        return;
    }
    let (handles, _) = rest[count..].as_chunks::<{ size_of::<HANDLE>() }>();
    for handle in &handles[..count] {
        let handle = usize::from_ne_bytes(*handle) as HANDLE;
        if handle != INVALID_HANDLE_VALUE {
            let _ = kernel32::SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
        }
    }
}
