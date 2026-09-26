//! The functions of macOS that are no points of cancellation (`read$NOCANCEL`), which bun's code for
//! macOS calls in place of the plain ones. `bun_sys` declares them itself in a build for macOS; in the
//! image its module `nocancel` is this one, with the same names and arguments.

use core::ffi::{c_char, c_int, c_uint, c_void};

use crate::translate;
use crate::types::{iovec, pollfd, sockaddr};

mod bound {
    use super::*;

    #[bun_portable_macros::imports(library = "libSystem", host = "macos")]
    unsafe extern "C" {
        /// `openat$NOCANCEL` takes the mode as a variable argument: the host has the function with four.
        #[link_name = "bun_host_darwin_openat_nocancel4"]
        pub fn openat(dirfd: c_int, path: *const c_char, flags: c_int, mode: c_int) -> c_int;
        #[link_name = "read$NOCANCEL"]
        pub fn read(fd: c_int, buf: *mut c_void, count: usize) -> isize;
        #[link_name = "write$NOCANCEL"]
        pub fn write(fd: c_int, buf: *const c_void, count: usize) -> isize;
        #[link_name = "pread$NOCANCEL"]
        pub fn pread(fd: c_int, buf: *mut c_void, count: usize, off: i64) -> isize;
        #[link_name = "pwrite$NOCANCEL"]
        pub fn pwrite(fd: c_int, buf: *const c_void, count: usize, off: i64) -> isize;
        #[link_name = "pwritev$NOCANCEL"]
        pub fn pwritev(fd: c_int, iov: *const iovec, iovcnt: c_int, off: i64) -> isize;
        #[link_name = "preadv$NOCANCEL"]
        pub fn preadv(fd: c_int, iov: *const iovec, iovcnt: c_int, off: i64) -> isize;
        #[link_name = "readv$NOCANCEL"]
        pub fn readv(fd: c_int, iov: *const iovec, iovcnt: c_int) -> isize;
        #[link_name = "writev$NOCANCEL"]
        pub fn writev(fd: c_int, iov: *const iovec, iovcnt: c_int) -> isize;
        #[link_name = "recvfrom$NOCANCEL"]
        pub fn recvfrom(fd: c_int, buf: *mut c_void, len: usize, flags: c_int, addr: *mut sockaddr, alen: *mut u32) -> isize;
        #[link_name = "sendto$NOCANCEL"]
        pub fn sendto(fd: c_int, buf: *const c_void, len: usize, flags: c_int, addr: *const sockaddr, alen: u32) -> isize;
        #[link_name = "poll$NOCANCEL"]
        pub fn poll(fds: *mut pollfd, nfds: c_uint, timeout: c_int) -> c_int;
        #[link_name = "close$NOCANCEL"]
        pub safe fn close(fd: c_int) -> c_int;
    }
}

pub use bound::{close, pread, preadv, pwrite, pwritev, read, readv, write, writev};

/// # Safety
///
/// `path` is a NUL-terminated string.
#[inline]
pub unsafe fn openat(dirfd: c_int, path: *const c_char, flags: c_int, mode: c_uint) -> c_int {
    // SAFETY: the caller's contract.
    unsafe { bound::openat(translate::directory(dirfd), path, translate::open_flags(flags), mode as c_int) }
}

/// # Safety
///
/// `buf` is writable for `len` bytes, `addr` and `alen` are null or as `recvfrom` of macOS asks.
#[inline]
pub unsafe fn recvfrom(fd: c_int, buf: *mut c_void, len: usize, flags: c_int, addr: *mut sockaddr, alen: *mut u32) -> isize {
    // SAFETY: the caller's contract.
    unsafe { bound::recvfrom(fd, buf, len, translate::message_flags(flags), addr, alen) }
}

/// # Safety
///
/// `buf` is readable for `len` bytes, `addr` is null or an address as macOS lays it out.
#[inline]
pub unsafe fn sendto(fd: c_int, buf: *const c_void, len: usize, flags: c_int, addr: *const sockaddr, alen: u32) -> isize {
    // SAFETY: the caller's contract.
    unsafe { bound::sendto(fd, buf, len, translate::message_flags(flags), addr, alen) }
}

/// The bits of `events` and `revents` are the ones of the image. Two of them are other bits on macOS:
/// "a write does not block", for normal and for priority data.
///
/// # Safety
///
/// `fds` points at `nfds` entries.
pub unsafe fn poll(fds: *mut pollfd, nfds: c_uint, timeout: c_int) -> c_int {
    use crate::constants as macos;
    const SAME: i16 = ::libc::POLLIN | ::libc::POLLPRI | ::libc::POLLOUT | ::libc::POLLERR | ::libc::POLLHUP | ::libc::POLLNVAL | ::libc::POLLRDNORM | ::libc::POLLRDBAND;
    const DIFFERENT: i16 = ::libc::POLLWRNORM | ::libc::POLLWRBAND;
    // SAFETY: the caller's contract.
    let entries = unsafe { core::slice::from_raw_parts_mut(fds, nfds as usize) };
    if entries.iter().all(|entry| entry.events & DIFFERENT == 0) {
        // SAFETY: the caller's contract.
        return unsafe { bound::poll(fds, nfds, timeout) };
    }
    // What was asked is kept while the entries hold the bits of macOS.
    let mut few = [0i16; 64];
    let from_the_heap = entries.len() > few.len();
    let asked: &mut [i16] = if !from_the_heap {
        &mut few[..entries.len()]
    } else {
        // SAFETY: `calloc` returns memory for that many `i16`, or null.
        let many = unsafe { ::libc::calloc(entries.len(), size_of::<i16>()) }.cast::<i16>();
        if many.is_null() {
            // SAFETY: the error number of this thread.
            unsafe { ::libc::__errno_location().write(::libc::ENOMEM) };
            return -1;
        }
        // SAFETY: `many` has `entries.len()` zeroed elements.
        unsafe { core::slice::from_raw_parts_mut(many, entries.len()) }
    };
    for (entry, asked) in entries.iter_mut().zip(asked.iter_mut()) {
        *asked = entry.events;
        entry.events = (*asked & SAME)
            | if *asked & ::libc::POLLWRNORM != 0 { macos::POLLWRNORM } else { 0 }
            | if *asked & ::libc::POLLWRBAND != 0 { macos::POLLWRBAND } else { 0 };
    }
    // SAFETY: the caller's contract.
    let ready = unsafe { bound::poll(entries.as_mut_ptr(), nfds, timeout) };
    for (entry, asked) in entries.iter_mut().zip(asked.iter()) {
        let got = entry.revents;
        entry.events = *asked;
        entry.revents = (got & SAME)
            | if got & macos::POLLWRNORM != 0 { *asked & (::libc::POLLWRNORM | ::libc::POLLOUT) } else { 0 }
            | if got & macos::POLLWRBAND != 0 { ::libc::POLLWRBAND } else { 0 };
    }
    if from_the_heap {
        // SAFETY: the memory of `calloc` above.
        unsafe { ::libc::free(asked.as_mut_ptr().cast()) };
    }
    ready
}
