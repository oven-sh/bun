//! The operating system the portable image runs on: what `process.platform` names, and every decision that
//! has to agree with it (the flavour of paths, the rules of environment variable names, which system calls
//! there are).
//!
//! [`crate::env::OS`] and `cfg(windows)` / `cfg(unix)` say what the code is COMPILED for. The portable image
//! (`cfg(bun_portable)`) is compiled for Linux, and a host program runs it on Linux, macOS and Windows. The C
//! library of the image says which one, once, at startup. A build for one OS has no use for this module and
//! does not have it.

pub use crate::env::OperatingSystem as HostOs;
use core::ffi::{CStr, c_ulong};
use core::sync::atomic::{AtomicU8, Ordering};

/// The numbers of `__bun_host_os`. `NOT_READ` is none of them.
const NOT_READ: u8 = 0;
const LINUX: u8 = 1;
const WINDOWS: u8 = 2;
const MAC: u8 = 3;

/// C and C++ read the same byte (`Bun::hostOS()` in BunHostOS.h, the functions of uSockets that pick a
/// backend).
#[unsafe(export_name = "Bun__hostOS")]
static HOST_OS: AtomicU8 = AtomicU8::new(NOT_READ);

unsafe extern "C" {
    /// The C library of the image: 1 Linux, 2 Windows, 3 macOS.
    safe fn __bun_host_os() -> c_ulong;
}

/// Test hook. The tests of the image run on Linux; this variable makes bun take the decisions of another
/// host there. It changes what bun decides, not what the host of the image does.
const TEST_HOOK_HOST_OS: &CStr = c"BUN_PORTABLE_HOST_OS";

/// The value of the test hook, when it is set to something else than `linux`, `darwin` or `win32`.
#[derive(Debug)]
pub struct InvalidTestHookValue(pub &'static [u8]);

fn test_hook_value() -> Option<&'static [u8]> {
    // SAFETY: the name is NUL-terminated. getenv returns null or a NUL-terminated string in the
    // environment block, which lives as long as the process.
    unsafe {
        let value = libc::getenv(TEST_HOOK_HOST_OS.as_ptr());
        if value.is_null() {
            return None;
        }
        Some(core::slice::from_raw_parts(
            value.cast::<u8>(),
            libc::strlen(value),
        ))
    }
}

fn from_libc() -> u8 {
    match __bun_host_os() {
        2 => WINDOWS,
        3 => MAC,
        _ => LINUX,
    }
}

fn read() -> Result<u8, InvalidTestHookValue> {
    match test_hook_value() {
        None => Ok(from_libc()),
        Some(b"linux") => Ok(LINUX),
        Some(b"darwin") => Ok(MAC),
        Some(b"win32") => Ok(WINDOWS),
        Some(other) => Err(InvalidTestHookValue(other)),
    }
}

/// Reads the host OS and keeps it: the first thing `main` does. With an invalid test hook the host is what
/// the C library says, and the caller reports the error once it can print.
pub fn init() -> Result<(), InvalidTestHookValue> {
    let (code, result) = match read() {
        Ok(code) => (code, Ok(())),
        Err(invalid) => (from_libc(), Err(invalid)),
    };
    HOST_OS.store(code, Ordering::Relaxed);
    result
}

/// For a read that comes before `init` (C and C++ call it by this name).
#[cold]
#[unsafe(export_name = "Bun__readHostOS")]
extern "C" fn read_and_keep() -> u8 {
    let code = read().unwrap_or_else(|_| from_libc());
    HOST_OS.store(code, Ordering::Relaxed);
    code
}

#[inline(always)]
pub fn os() -> HostOs {
    let mut code = HOST_OS.load(Ordering::Relaxed);
    if code == NOT_READ {
        code = read_and_keep();
    }
    match code {
        WINDOWS => HostOs::Windows,
        MAC => HostOs::Mac,
        _ => HostOs::Linux,
    }
}

/// The name of the host OS, as `process.platform` has it.
#[inline]
pub fn name() -> &'static str {
    os().name_string()
}

/// Paths have drive letters and `\`, the names of environment variables ignore case, lines end in `\r\n`.
#[inline(always)]
pub fn is_windows() -> bool {
    matches!(os(), HostOs::Windows)
}

#[inline(always)]
pub fn is_mac() -> bool {
    matches!(os(), HostOs::Mac)
}

#[inline(always)]
pub fn is_linux() -> bool {
    matches!(os(), HostOs::Linux)
}
