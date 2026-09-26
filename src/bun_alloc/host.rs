//! Which operating system runs this process. `bun_core::host` is the interface and says what it is for; the
//! value is kept here because `bun_alloc` is the lowest crate that decides by it (the separator that a
//! [`crate::BSSMap`] key is trimmed by).

/// The numbers of `__bun_host_os()`, the function of the C library of the portable image.
pub const LINUX: u8 = 1;
pub const WINDOWS: u8 = 2;
pub const MAC: u8 = 3;
/// Not a host of the portable image: what [`code`] is where bun is compiled for FreeBSD.
pub const FREEBSD: u8 = 4;
/// Not a host of the portable image: what [`code`] is where bun is compiled for something else.
pub const OTHER: u8 = 5;

/// The host whose functions the code calls: the system calls of Linux and macOS through the C library, the
/// functions of Windows and of libuv through the addresses that the host of the image resolves.
///
/// It is the host of [`code`] wherever bun really runs. The two are told apart for the tests of the
/// portable image, which run on Linux: `BUN_PORTABLE_HOST_OS` makes bun decide as another host does
/// (paths, names, numbers that JavaScript sees) while its system calls stay the ones of Linux, and
/// `BUN_PORTABLE_HOST_INTERFACE` makes it take its code for the functions of another host, whose first
/// call then stops the image, because the host that could answer it is not there.
pub mod native {
    pub use super::imp::native_code as code;
    use super::{LINUX, MAC, WINDOWS};

    crate::host_fn!(
        #[inline(always)]
        pub fn is_windows() -> bool {
            code() == WINDOWS
        }
    );
    crate::host_fn!(
        #[inline(always)]
        pub fn is_mac() -> bool {
            code() == MAC
        }
    );
    crate::host_fn!(
        #[inline(always)]
        pub fn is_linux() -> bool {
            code() == LINUX
        }
    );
}

#[cfg(not(bun_portable))]
mod imp {
    use super::{FREEBSD, LINUX, MAC, OTHER, WINDOWS};

    #[inline(always)]
    pub const fn native_code() -> u8 {
        code()
    }

    #[inline(always)]
    pub const fn code() -> u8 {
        if cfg!(windows) {
            WINDOWS
        } else if cfg!(target_os = "macos") {
            MAC
        } else if cfg!(any(target_os = "linux", target_os = "android")) {
            LINUX
        } else if cfg!(target_os = "freebsd") {
            FREEBSD
        } else {
            OTHER
        }
    }
}

#[cfg(bun_portable)]
mod imp {
    use super::{LINUX, MAC, WINDOWS};
    use core::ffi::{CStr, c_ulong};
    use core::sync::atomic::{AtomicU8, Ordering};

    const NOT_READ: u8 = 0;

    /// C++ reads the same byte (`Bun::hostOS()` in BunHostOS.h).
    #[unsafe(export_name = "Bun__hostOS")]
    static HOST_OS: AtomicU8 = AtomicU8::new(NOT_READ);

    /// See [`super::native`].
    static NATIVE: AtomicU8 = AtomicU8::new(NOT_READ);

    unsafe extern "C" {
        /// The C library of the image: 1 Linux, 2 Windows, 3 macOS.
        safe fn __bun_host_os() -> c_ulong;
    }

    /// Test hook. The tests of the image run on Linux; this variable makes bun take the decisions of another
    /// host there. It changes what bun decides, not what the host of the image does.
    const TEST_HOOK_HOST_OS: &CStr = c"BUN_PORTABLE_HOST_OS";

    /// Test hook for [`super::native`]: the host whose functions bun's code calls.
    const TEST_HOOK_HOST_INTERFACE: &CStr = c"BUN_PORTABLE_HOST_INTERFACE";

    /// A test hook that is set to something else than `linux`, `darwin` or `win32`: its name and its value.
    #[derive(Debug)]
    pub struct InvalidTestHookValue(pub &'static CStr, pub &'static [u8]);

    fn test_hook_value(name: &'static CStr) -> Option<&'static [u8]> {
        // SAFETY: the name is NUL-terminated. getenv returns null or a NUL-terminated string in the
        // environment block, which lives as long as the process.
        unsafe {
            let value = libc::getenv(name.as_ptr());
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

    fn read(hook: &'static CStr) -> Result<u8, InvalidTestHookValue> {
        match test_hook_value(hook) {
            None => Ok(from_libc()),
            Some(b"linux") => Ok(LINUX),
            Some(b"darwin") => Ok(MAC),
            Some(b"win32") => Ok(WINDOWS),
            Some(other) => Err(InvalidTestHookValue(hook, other)),
        }
    }

    /// Reads the host OS and keeps it: the first thing `main` does. With an invalid test hook the host is what
    /// the C library says, and the caller reports the error once it can print.
    pub fn init() -> Result<(), InvalidTestHookValue> {
        let mut result = Ok(());
        for (hook, kept) in [
            (TEST_HOOK_HOST_OS, &HOST_OS),
            (TEST_HOOK_HOST_INTERFACE, &NATIVE),
        ] {
            let code = match read(hook) {
                Ok(code) => code,
                Err(invalid) => {
                    if result.is_ok() {
                        result = Err(invalid);
                    }
                    from_libc()
                }
            };
            kept.store(code, Ordering::Relaxed);
        }
        result
    }

    /// For a read that comes before `init` (C++ calls it by this name).
    #[cold]
    #[unsafe(export_name = "Bun__readHostOS")]
    extern "C" fn read_and_keep() -> u8 {
        let code = read(TEST_HOOK_HOST_OS).unwrap_or_else(|_| from_libc());
        HOST_OS.store(code, Ordering::Relaxed);
        code
    }

    #[cold]
    fn read_and_keep_native() -> u8 {
        let code = read(TEST_HOOK_HOST_INTERFACE).unwrap_or_else(|_| from_libc());
        NATIVE.store(code, Ordering::Relaxed);
        code
    }

    #[inline(always)]
    pub fn native_code() -> u8 {
        let code = NATIVE.load(Ordering::Relaxed);
        if code == NOT_READ {
            return read_and_keep_native();
        }
        code
    }

    #[inline(always)]
    pub fn code() -> u8 {
        let code = HOST_OS.load(Ordering::Relaxed);
        if code == NOT_READ {
            return read_and_keep();
        }
        code
    }
}

pub use imp::code;
#[cfg(bun_portable)]
pub use imp::{InvalidTestHookValue, init};

/// Defines a `const fn`; in the portable image the same function without `const`, because there the host is
/// known when the program runs.
#[macro_export]
macro_rules! host_fn {
    ($(#[$attr:meta])* $visibility:vis fn $name:ident($($parameters:tt)*) -> $type:ty $body:block) => {
        $(#[$attr])*
        #[cfg(not(bun_portable))]
        $visibility const fn $name($($parameters)*) -> $type $body
        $(#[$attr])*
        #[cfg(bun_portable)]
        $visibility fn $name($($parameters)*) -> $type $body
    };
}

host_fn!(
    /// Paths have drive letters and `\`, the names of environment variables ignore case, lines end in `\r\n`.
    #[inline(always)]
    pub fn is_windows() -> bool {
        code() == WINDOWS
    }
);
host_fn!(
    #[inline(always)]
    pub fn is_mac() -> bool {
        code() == MAC
    }
);
host_fn!(
    #[inline(always)]
    pub fn is_linux() -> bool {
        code() == LINUX
    }
);
