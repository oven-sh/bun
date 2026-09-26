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
#[cfg(bun_portable)]
pub use bun_alloc::host::{InvalidTestHookValue, init};
pub use bun_alloc::host::{is_linux, is_mac, is_windows};

/// The host whose functions the code calls, which is what picks between bun's code for Windows and its
/// code for POSIX (`crate::host_dispatch`). See `bun_alloc::host::native` for how it can differ from the
/// host of [`os`], in a test.
pub mod native {
    use super::HostOs;
    pub use bun_alloc::host::native::{is_linux, is_mac, is_windows};

    #[cfg(not(bun_portable))]
    #[inline(always)]
    pub const fn os() -> HostOs {
        crate::env::OS
    }

    #[cfg(bun_portable)]
    #[inline(always)]
    pub fn os() -> HostOs {
        match bun_alloc::host::native::code() {
            bun_alloc::host::WINDOWS => HostOs::Windows,
            bun_alloc::host::MAC => HostOs::Mac,
            _ => HostOs::Linux,
        }
    }
}

#[cfg(not(bun_portable))]
#[inline(always)]
pub const fn os() -> HostOs {
    crate::env::OS
}

#[cfg(bun_portable)]
#[inline(always)]
pub fn os() -> HostOs {
    match bun_alloc::host::code() {
        bun_alloc::host::WINDOWS => HostOs::Windows,
        bun_alloc::host::MAC => HostOs::Mac,
        _ => HostOs::Linux,
    }
}
