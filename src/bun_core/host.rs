//! The operating system this process runs on: what `process.platform` names, and every decision that has to
//! agree with it (the flavour of paths, the rules of environment variable names, the numbers in `os.constants`).
//!
//! [`crate::env::OS`] and `cfg(windows)` / `cfg(unix)` say what the code is COMPILED for: the system call
//! interface, the object format, the size of a path buffer. In every build but one the two are the same thing,
//! and the functions here are constants of the compilation target.
//!
//! The portable image (`cfg(bun_portable)`) is the exception: it is compiled for Linux, and a host program runs
//! it on Linux, macOS and Windows. There the C library of the image says which one, once, at startup.

pub use crate::env::OperatingSystem as HostOs;

#[cfg(not(bun_portable))]
mod imp {
    use super::HostOs;

    #[inline(always)]
    pub const fn os() -> HostOs {
        crate::env::OS
    }
}

#[cfg(bun_portable)]
mod imp {
    use super::HostOs;
    use core::ffi::{CStr, c_ulong};
    use core::sync::atomic::{AtomicU8, Ordering};

    /// The numbers of `__bun_host_os`. `NOT_READ` is none of them.
    const NOT_READ: u8 = 0;
    const LINUX: u8 = 1;
    const WINDOWS: u8 = 2;
    const MAC: u8 = 3;

    /// C++ reads the same byte (`Bun::hostOS()` in BunHostOS.h).
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

    /// For a read that comes before `init` (C++ calls it by this name).
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
}

pub use imp::os;
#[cfg(bun_portable)]
pub use imp::{InvalidTestHookValue, init};

/// Defines `pub const fn $name() -> bool`; in the portable image the same function without `const`.
macro_rules! host_predicate {
    ($(#[$attr:meta])* $name:ident, $os:pat) => {
        $(#[$attr])*
        #[cfg(not(bun_portable))]
        #[inline(always)]
        pub const fn $name() -> bool {
            matches!(os(), $os)
        }
        $(#[$attr])*
        #[cfg(bun_portable)]
        #[inline(always)]
        pub fn $name() -> bool {
            matches!(os(), $os)
        }
    };
}

host_predicate!(
    /// Paths have drive letters and `\`, the names of environment variables ignore case, lines end in `\r\n`.
    is_windows,
    HostOs::Windows
);
host_predicate!(is_mac, HostOs::Mac);
host_predicate!(is_linux, HostOs::Linux);
