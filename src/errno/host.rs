//! The numbers of errors and signals that JavaScript sees in the portable image.
//!
//! Inside, the image has the numbers of Linux on every host: that is what its C library returns, and what the
//! host program translates the errors of its OS to. Node.js shows the numbers of the OS it runs on
//! (`os.constants`, `err.errno`, the signal of `process.kill(pid, 30)`). The translation is here, and it is
//! applied where a number becomes a JavaScript value or comes from one; nothing below that border knows it.

use core::ffi::c_int;

use bun_core::host;

#[path = "host_tables.rs"]
pub mod tables;

/// `UV_UNKNOWN` of libuv.
const UV_UNKNOWN: c_int = -4094;

/// `err.errno` of an error of the image: libuv's number for it on the host. On Linux and macOS that is the
/// negative errno of the OS, on Windows a `UV_E*`.
pub fn js_errno(errno: u16) -> c_int {
    let negated = c_int::from(errno).wrapping_neg();
    match host::os() {
        host::HostOs::Mac => match tables::DARWIN_ERRNO_OF_LINUX.get(usize::from(errno)) {
            Some(&number) if number != 0 => -c_int::from(number),
            _ => negated,
        },
        host::HostOs::Windows => match tables::UV_ERRNO_OF_LINUX.get(usize::from(errno)) {
            Some(&number) if number != 0 => c_int::from(number),
            Some(_) => negated,
            None => UV_UNKNOWN,
        },
        _ => negated,
    }
}

/// The number that the host has for a signal of the image; 0 where the host does not have the signal.
pub fn signal_to_host(signal: c_int) -> c_int {
    let table: &[u8] = match host::os() {
        host::HostOs::Mac => &tables::DARWIN_SIGNAL_OF_LINUX,
        host::HostOs::Windows => &tables::WINDOWS_SIGNAL_OF_LINUX,
        _ => return signal,
    };
    match usize::try_from(signal).ok().and_then(|i| table.get(i)) {
        Some(&number) => c_int::from(number),
        // A real-time signal, or no signal at all: the host has no other number for it.
        None => signal,
    }
}

/// The signal of the image for a number of the host; `None` where the number names no signal of the host.
pub fn signal_from_host(signal: c_int) -> Option<c_int> {
    let table: &[u8] = match host::os() {
        host::HostOs::Mac => &tables::DARWIN_SIGNAL_OF_LINUX,
        host::HostOs::Windows => &tables::WINDOWS_SIGNAL_OF_LINUX,
        _ => return Some(signal),
    };
    if signal == 0 {
        // kill(pid, 0) asks whether the process exists.
        return Some(0);
    }
    let wanted = u8::try_from(signal).ok()?;
    table
        .iter()
        .position(|&number| number == wanted)
        .and_then(|linux| c_int::try_from(linux).ok())
}

/// For C++ (`Bun::HostConstants` in ProcessBindingConstants.cpp): entry `index` of a table of `os.constants` of
/// the host. `category`: 0 errno, 1 signals, 2 dlopen. False past the end, and for a Linux host, whose numbers
/// are those the image is compiled with.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__hostConstant(
    category: u8,
    index: usize,
    name: &mut *const u8,
    name_len: &mut usize,
    value: &mut i32,
) -> bool {
    let table: &[tables::Entry] = match (host::os(), category) {
        (host::HostOs::Mac, 0) => &tables::DARWIN_ERRNO,
        (host::HostOs::Mac, 1) => &tables::DARWIN_SIGNALS,
        (host::HostOs::Mac, 2) => &tables::DARWIN_DLOPEN,
        (host::HostOs::Windows, 0) => &tables::WINDOWS_ERRNO,
        (host::HostOs::Windows, 1) => &tables::WINDOWS_SIGNALS,
        (host::HostOs::Windows, 2) => &tables::WINDOWS_DLOPEN,
        _ => return false,
    };
    let Some(&(entry_name, entry_value)) = table.get(index) else {
        return false;
    };
    *name = entry_name.as_ptr();
    *name_len = entry_name.len();
    *value = entry_value;
    true
}

/// For C++: [`signal_from_host`], -1 where the number names no signal of the host.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__signalFromHost(signal: c_int) -> c_int {
    signal_from_host(signal).unwrap_or(-1)
}

/// For C++: [`signal_to_host`].
#[unsafe(no_mangle)]
pub extern "C" fn Bun__signalToHost(signal: c_int) -> c_int {
    signal_to_host(signal)
}

/// For C++: [`js_errno`].
#[unsafe(no_mangle)]
pub extern "C" fn Bun__jsErrno(errno: c_int) -> c_int {
    match u16::try_from(errno) {
        Ok(errno) => js_errno(errno),
        Err(_) => errno.wrapping_neg(),
    }
}
