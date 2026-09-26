//! `Fd` in the portable image.
//!
//! A build for one OS has one representation of `Fd`: an `int` on POSIX, and on Windows a `u64` that holds
//! a HANDLE or an `int` of libuv (a file descriptor of the C runtime), told apart by bit 63. The portable
//! image runs on both. It has the representation of Windows on every host, and a file descriptor of a
//! POSIX host is the `int` kind: descriptor 0 has bit 63 set, so it is not `Fd::INVALID`, the 0 of Windows.
//!
//! The methods of `Fd` that a build for one OS picks with `cfg` are in `util.rs`, each definition marked
//! with the host it is for. What is here has no single definition to mark: the value that POSIX code
//! takes for an `int` and Windows code for a HANDLE.

use core::ffi::c_void;

use crate::Fd;
use crate::host::native as host;
use crate::host_dispatch::no_definition_for_this_host;

/// What `Fd::native` returns and `Fd::from_native` takes. The code that uses the value says which: an
/// argument of `libc::read` makes it an `int`, an argument of `ReadFile` a HANDLE.
pub trait FdNativeRepr: Copy {
    fn from_fd(fd: Fd) -> Self;
    fn into_fd(self) -> Fd;
}

impl FdNativeRepr for i32 {
    #[inline]
    fn from_fd(fd: Fd) -> i32 {
        if host::is_windows() {
            no_definition_for_this_host("Fd::native as a file descriptor of POSIX");
        }
        fd.posix()
    }

    #[inline]
    fn into_fd(self) -> Fd {
        Fd::from_uv(self)
    }
}

impl FdNativeRepr for *mut c_void {
    #[inline]
    fn from_fd(fd: Fd) -> *mut c_void {
        if !host::is_windows() {
            no_definition_for_this_host("Fd::native as a HANDLE of Windows");
        }
        fd.native__windows()
    }

    #[inline]
    fn into_fd(self) -> Fd {
        Fd::from_system(self)
    }
}

/// The bits of an `Fd`, as Windows code that holds a HANDLE in a `u64` passes them.
impl FdNativeRepr for u64 {
    #[inline]
    fn from_fd(fd: Fd) -> u64 {
        fd.0
    }

    #[inline]
    fn into_fd(self) -> Fd {
        Fd(self)
    }
}

impl Fd {
    #[inline]
    pub fn from_native<T: FdNativeRepr>(value: T) -> Fd {
        value.into_fd()
    }

    /// The `int` of this host's POSIX, or the HANDLE of this host's Windows. Asking for the one the host
    /// does not have is an error in the caller, and does not return.
    #[inline]
    pub fn native<T: FdNativeRepr>(self) -> T {
        T::from_fd(self)
    }
}
