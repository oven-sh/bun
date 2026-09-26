//! What bun's code for macOS finds under the name `libc` in the portable image.
//!
//! A build of bun for macOS has the `libc` crate under that name: the structures, the constants and
//! the functions of macOS. The image has this module in its place wherever it compiles code that is for
//! macOS only, so the same source line serves both. What is here:
//!
//! - the types of macOS (`stat`, `kevent64_s`), laid out as macOS lays them out;
//! - the constants of macOS, with the values of macOS, except the families that shared code handles
//!   too: error numbers, the flags of `open`, the flags of the functions that end in `at`. Those have
//!   the values of the image, so what the code for macOS takes from its callers and what it names
//!   itself are the same numbers;
//! - the functions of macOS, bound through the import table. The ones below take such numbers and hand
//!   them to macOS as macOS has them.
//!
//! After a call the error number is the one of the image, in the numbers of the image
//! (`host_imports::keep_errno`).

pub use core::ffi::{c_char, c_double, c_float, c_int, c_long, c_longlong, c_short, c_uchar, c_uint, c_ulong, c_ulonglong, c_ushort, c_void};

pub use crate::generated::constants_for_bun::*;
pub use crate::generated::functions_for_bun::*;
pub use crate::generated::types::*;

use crate::generated::{constants as macos, functions as bound};
use crate::translate;

/// # Safety
///
/// As `open` of macOS.
#[inline]
pub unsafe fn open(path: *const c_char, oflag: c_int, mode: c_uint) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::open(path, translate::open_flags(oflag), mode as c_int) }
}

/// # Safety
///
/// As `openat` of macOS.
#[inline]
pub unsafe fn openat(dirfd: c_int, path: *const c_char, oflag: c_int, mode: c_uint) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::openat(translate::directory(dirfd), path, translate::open_flags(oflag), mode as c_int) }
}

/// The argument of a call of `fcntl`: an integer, or the address of what the command reads or fills.
pub trait FcntlArgument {
    fn into_argument(self) -> isize;
}
impl FcntlArgument for c_int {
    #[inline]
    fn into_argument(self) -> isize {
        self as isize
    }
}
impl FcntlArgument for isize {
    #[inline]
    fn into_argument(self) -> isize {
        self
    }
}
impl FcntlArgument for i64 {
    #[inline]
    fn into_argument(self) -> isize {
        self as isize
    }
}
impl FcntlArgument for usize {
    #[inline]
    fn into_argument(self) -> isize {
        self as isize
    }
}
impl<T> FcntlArgument for *mut T {
    #[inline]
    fn into_argument(self) -> isize {
        self as isize
    }
}
impl<T> FcntlArgument for *const T {
    #[inline]
    fn into_argument(self) -> isize {
        self as isize
    }
}

/// `fcntl` with the commands of macOS. The flags that `F_SETFL` takes and `F_GETFL` answers are flags of
/// `open`: the ones of the image on this side.
///
/// # Safety
///
/// As `fcntl` of macOS for the command.
#[inline]
pub unsafe fn fcntl(fd: c_int, cmd: c_int, argument: impl FcntlArgument) -> c_int {
    let argument = argument.into_argument();
    if cmd == macos::F_SETFL {
        // SAFETY: the caller's contract.
        return unsafe { bound::fcntl(fd, cmd, translate::open_flags(argument as c_int) as isize) };
    }
    // SAFETY: the caller's contract.
    let result = unsafe { bound::fcntl(fd, cmd, argument) };
    if cmd == macos::F_GETFL && result >= 0 {
        return translate::open_flags_to_image(result);
    }
    result
}

/// # Safety
///
/// As `fstatat` of macOS.
#[inline]
pub unsafe fn fstatat(dirfd: c_int, pathname: *const c_char, buf: *mut stat, flags: c_int) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::fstatat(translate::directory(dirfd), pathname, buf, translate::at_flags(flags)) }
}

/// # Safety
///
/// As `faccessat` of macOS.
#[inline]
pub unsafe fn faccessat(dirfd: c_int, pathname: *const c_char, mode: c_int, flags: c_int) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::faccessat(translate::directory(dirfd), pathname, mode, translate::access_flags(flags)) }
}

/// # Safety
///
/// As `unlinkat` of macOS.
#[inline]
pub unsafe fn unlinkat(dirfd: c_int, pathname: *const c_char, flags: c_int) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::unlinkat(translate::directory(dirfd), pathname, translate::at_flags(flags)) }
}

/// # Safety
///
/// As `mkdirat` of macOS.
#[inline]
pub unsafe fn mkdirat(dirfd: c_int, pathname: *const c_char, mode: mode_t) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::mkdirat(translate::directory(dirfd), pathname, mode) }
}

/// # Safety
///
/// As `renameatx_np` of macOS.
#[inline]
pub unsafe fn renameatx_np(fromfd: c_int, from: *const c_char, tofd: c_int, to: *const c_char, flags: c_uint) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::renameatx_np(translate::directory(fromfd), from, translate::directory(tofd), to, flags) }
}

/// # Safety
///
/// As `clonefileat` of macOS.
#[inline]
pub unsafe fn clonefileat(src_dirfd: c_int, src: *const c_char, dst_dirfd: c_int, dst: *const c_char, flags: u32) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::clonefileat(translate::directory(src_dirfd), src, translate::directory(dst_dirfd), dst, flags) }
}

/// # Safety
///
/// As `fclonefileat` of macOS.
#[inline]
pub unsafe fn fclonefileat(srcfd: c_int, dst_dirfd: c_int, dst: *const c_char, flags: u32) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::fclonefileat(srcfd, translate::directory(dst_dirfd), dst, flags) }
}

/// The result is an error number: the one of the image.
///
/// # Safety
///
/// As `posix_spawn_file_actions_addopen` of macOS.
#[inline]
pub unsafe fn posix_spawn_file_actions_addopen(actions: *mut posix_spawn_file_actions_t, fd: c_int, path: *const c_char, oflag: c_int, mode: mode_t) -> c_int {
    // SAFETY: the caller's contract.
    crate::errno::to_image(unsafe { bound::posix_spawn_file_actions_addopen(actions, fd, path, translate::open_flags(oflag), mode) })
}

/// Where the error number is. In the image there is one, the one of the image's C library.
///
/// # Safety
///
/// None: the address of a value of this thread.
#[inline]
pub unsafe fn __error() -> *mut c_int {
    // SAFETY: the address of the error number of this thread.
    unsafe { ::libc::__errno_location() }
}
