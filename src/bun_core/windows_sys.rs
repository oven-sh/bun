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
pub(crate) const ENABLE_PROCESSED_OUTPUT: DWORD = 0x0001;
pub(crate) const ENABLE_WRAP_AT_EOL_OUTPUT: DWORD = 0x0002;
pub(crate) const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

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

// SAFETY: nested `i16`/`u16` POD; all-zero is the documented pre-call state
// for `GetConsoleScreenBufferInfo` out-params. Impl lives here (not in
// `bun_windows_sys`) because the `Zeroable` trait is owned by `bun_core`.
unsafe impl crate::ffi::Zeroable for CONSOLE_SCREEN_BUFFER_INFO {}

// kernel32 externs are owned by the tier-0 leaf `bun_windows_sys`; re-export
// so existing `crate::windows_sys::kernel32::*` callers resolve.
pub use bun_windows_sys::kernel32;

/// Make every handle this process inherited as stdio non-inheritable, so
/// children only receive the handles a spawn passes explicitly: the three std
/// handles, plus the handles of the CRT fd block a parent passes in
/// `STARTUPINFOW.lpReserved2` (`int count; u8 crt_flags[count]; HANDLE
/// os_handle[count]`, unaligned). Failures are ignored — a std handle may be
/// invalid or already closed.
pub(crate) fn disable_stdio_inheritance() {
    use bun_windows_sys::{
        GetStartupInfoW, HANDLE_FLAG_INHERIT, STARTUPINFOW, SetHandleInformation,
    };

    for id in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        if let Some(handle) = GetStdHandle(id) {
            let _ = SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
        }
    }

    let mut si = core::mem::MaybeUninit::<STARTUPINFOW>::zeroed();
    // SAFETY: `si` is a writable STARTUPINFOW, which GetStartupInfoW fills; it
    // cannot fail, and all-zero is a valid STARTUPINFOW regardless.
    let si = unsafe {
        GetStartupInfoW(si.as_mut_ptr());
        si.assume_init()
    };
    let buffer = si.lpReserved2.cast_const();
    let size = usize::from(si.cbReserved2);
    const COUNT_SIZE: usize = core::mem::size_of::<core::ffi::c_int>();
    const HANDLE_SIZE: usize = core::mem::size_of::<HANDLE>();
    if buffer.is_null() || size < COUNT_SIZE {
        return;
    }
    // SAFETY: `buffer` is valid for `size >= COUNT_SIZE` bytes for the life of
    // the process (it is part of the process parameters block).
    let count = unsafe { buffer.cast::<core::ffi::c_uint>().read_unaligned() } as usize;
    if count > 256 || size < COUNT_SIZE + count * (1 + HANDLE_SIZE) {
        return;
    }
    for i in 0..count {
        // SAFETY: in bounds per the size check above; the handle array is
        // unaligned.
        let handle = unsafe {
            buffer
                .add(COUNT_SIZE + count + i * HANDLE_SIZE)
                .cast::<HANDLE>()
                .read_unaligned()
        };
        if handle != INVALID_HANDLE_VALUE {
            let _ = SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
        }
    }
}
