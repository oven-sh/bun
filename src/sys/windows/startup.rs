//! Process-wide setup, run once on the main thread.

use core::ptr;

use bun_core::windows_sys::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};

use super::{HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, fd_table, inherited_descriptors, kernel32};
use crate::Fd;
use crate::windows_format::crt_descriptors;

type InvalidParameterHandler = extern "C" fn(*const u16, *const u16, *const u16, u32, usize);

unsafe extern "C" {
    safe fn _set_invalid_parameter_handler(
        handler: InvalidParameterHandler,
    ) -> Option<InvalidParameterHandler>;
}

/// Disables system error dialogs, and makes a CRT call on an invalid fd fail instead of terminating the process.
pub fn configure_error_handling() {
    const SEM_FAILCRITICALERRORS: u32 = 0x0001;
    const SEM_NOGPFAULTERRORBOX: u32 = 0x0002;
    const SEM_NOOPENFILEERRORBOX: u32 = 0x8000;
    kernel32::SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);

    extern "C" fn on_invalid_parameter(
        _expression: *const u16,
        _function: *const u16,
        _file: *const u16,
        _line: u32,
        _reserved: usize,
    ) {
    }
    _set_invalid_parameter_handler(on_invalid_parameter);

    #[cfg(bun_debug)]
    debug_crt::suppress_lowio_assertions();
}

#[cfg(bun_debug)]
mod debug_crt {
    use core::ffi::{c_char, c_int};

    type ReportHook = unsafe extern "C" fn(c_int, *const c_char, *mut c_int) -> c_int;

    unsafe extern "C" {
        safe fn _CrtSetReportHook2(mode: c_int, hook: ReportHook) -> c_int;
    }

    /// SAFETY: `message` is NUL-terminated and `return_value` is writable.
    unsafe extern "C" fn on_report(
        report_type: c_int,
        message: *const c_char,
        return_value: *mut c_int,
    ) -> c_int {
        const CRT_ASSERT: c_int = 2;
        // SAFETY: fn contract.
        let message = unsafe { bun_core::ffi::cstr(message) }.to_bytes();
        let is_handled =
            report_type == CRT_ASSERT && bun_core::strings::contains(message, b"\\lowio\\");
        if is_handled {
            // SAFETY: fn contract. 0 continues execution after the assertion.
            unsafe { return_value.write(0) };
        }
        is_handled.into()
    }

    pub(super) fn suppress_lowio_assertions() {
        const CRT_RPTHOOK_INSTALL: c_int = 0;
        _CrtSetReportHook2(CRT_RPTHOOK_INSTALL, on_report);
    }
}

/// Also covers the inherited CRT descriptors above 2.
pub fn disable_stdio_inheritance() {
    let descriptor_handles = crt_descriptors::handles(inherited_descriptors());
    [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]
        .into_iter()
        .filter_map(GetStdHandle)
        .chain(descriptor_handles.map(ptr::without_provenance_mut))
        .filter(|&handle| handle != INVALID_HANDLE_VALUE)
        .for_each(|handle| _ = kernel32::SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0));
}

/// Registers the descriptors that the CRT opened before `main` with `fd_table`.
pub fn register_inherited_descriptors() {
    let inherited_count = crt_descriptors::handles(inherited_descriptors()).count();
    (0..inherited_count.max(3) as i32)
        .filter(|&fd| Fd::from_crt(fd).native() != INVALID_HANDLE_VALUE)
        .for_each(fd_table::register);
}
