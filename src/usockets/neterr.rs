//! Network-errno predicates shared by the write path (write.rs), the read
//! path (socket.rs), and UDP (udp.rs). Predicates take the io layer's
//! `-errno` return convention.

use core::ffi::c_int;

#[cfg(windows)]
use bun_windows_sys::ws2_32::WinsockError;

/// R4.7: POSIX checks EWOULDBLOCK ONLY (the `|| EAGAIN` is commented out
/// upstream; equal on all currently-supported POSIX targets).
#[cfg(not(windows))]
#[inline]
pub(crate) fn is_would_block(neg_errno: isize) -> bool {
    neg_errno == -(libc::EWOULDBLOCK as isize)
}
#[cfg(windows)]
#[inline]
pub(crate) fn is_would_block(neg_errno: isize) -> bool {
    neg_errno == -(WinsockError::WSAEWOULDBLOCK.0 as isize)
}

/// R4.2: transient kernel resource exhaustion on a healthy connection —
/// NOT fatal (commit-fc865b39 behavior).
#[cfg(not(windows))]
#[inline]
pub(crate) fn is_transient_send_error(neg_errno: isize) -> bool {
    neg_errno == -(libc::ENOBUFS as isize) || neg_errno == -(libc::ENOMEM as isize)
}
#[cfg(windows)]
#[inline]
pub(crate) fn is_transient_send_error(neg_errno: isize) -> bool {
    neg_errno == -(WinsockError::WSAENOBUFS.0 as isize)
}

/// Thread-local errno as last set by the failing syscall (WSAGetLastError on
/// Windows — std maps it into `last_os_error`).
pub(crate) fn last_errno() -> c_int {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}
