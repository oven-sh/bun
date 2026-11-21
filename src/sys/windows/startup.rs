//! Process-wide settings, made once on the main thread.

use core::ptr;

use bun_core::windows_sys::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};

use super::{
    HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, file_position, inherited_descriptors, kernel32,
};
use crate::Fd;
use crate::windows_format::crt_descriptors;

type InvalidParameterHandler = extern "C" fn(*const u16, *const u16, *const u16, u32, usize);

unsafe extern "C" {
    safe fn _set_invalid_parameter_handler(
        handler: InvalidParameterHandler,
    ) -> Option<InvalidParameterHandler>;
}

/// Errors come back as errors: no dialogs from the system, and no exit from the C runtime for a bad descriptor.
pub fn report_errors_to_callers() {
    const SEM_FAILCRITICALERRORS: u32 = 0x0001;
    const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;
    const SEM_NOOPENFILEERRORBOX: u32 = 0x8000;
    kernel32::SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);

    extern "C" fn ignore(_: *const u16, _: *const u16, _: *const u16, _: u32, _: usize) {}
    _set_invalid_parameter_handler(ignore);

    #[cfg(bun_debug)]
    debug_runtime::allow_bad_descriptors();
}

#[cfg(bun_debug)]
mod debug_runtime {
    use core::ffi::{c_char, c_int};

    type ReportHook = unsafe extern "C" fn(c_int, *const c_char, *mut c_int) -> c_int;

    unsafe extern "C" {
        safe fn _CrtSetReportHook2(mode: c_int, hook: ReportHook) -> c_int;
    }

    /// SAFETY: `message` is NUL-terminated and `action` is writable.
    unsafe extern "C" fn hook(kind: c_int, message: *const c_char, action: *mut c_int) -> c_int {
        const CRT_ASSERT: c_int = 2;
        // SAFETY: fn contract.
        let message = unsafe { bun_core::ffi::cstr(message) }.to_bytes();
        let handled = kind == CRT_ASSERT && bun_core::strings::contains(message, b"\\lowio\\");
        if handled {
            // SAFETY: fn contract. 0 goes on behind the assertion.
            unsafe { action.write(0) };
        }
        handled.into()
    }

    pub(super) fn allow_bad_descriptors() {
        const CRT_RPTHOOK_INSTALL: c_int = 0;
        _CrtSetReportHook2(CRT_RPTHOOK_INSTALL, hook);
    }
}

/// Keeps what this process inherited from being inherited again.
pub fn disable_stdio_inheritance() {
    let standard = [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE];
    let descriptors = crt_descriptors::handles(inherited_descriptors());
    (standard.into_iter().filter_map(GetStdHandle))
        .chain(descriptors.map(ptr::without_provenance_mut))
        .filter(|&handle| handle != INVALID_HANDLE_VALUE)
        .for_each(|handle| _ = kernel32::SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0));
}

/// Those that the C runtime opened in front of `main`.
pub fn announce_inherited_descriptors() {
    let count = crt_descriptors::handles(inherited_descriptors()).count();
    (0..count.max(3) as i32)
        .filter(|&number| Fd::from_crt(number).native() != INVALID_HANDLE_VALUE)
        .for_each(file_position::opened);
}
