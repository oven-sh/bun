//! Safe syscall helpers shared across the crate.
//!
//! Thin, platform-abstracting wrappers over the bits of `bsd.rs` that every
//! other module re-implements locally (`libus_err`, `would_block`, the fd
//! sentinel). The heavy `bsd_*` syscalls stay in `bsd.rs`; this module only
//! owns the pure predicates and the typed fd newtype.

use core::ffi::c_int;

use crate::types::LIBUS_SOCKET_DESCRIPTOR;

// ═══════════════════════════════════════════════════════════════════════════
// Fd — typed `LIBUS_SOCKET_DESCRIPTOR`
// ═══════════════════════════════════════════════════════════════════════════

/// Transparent newtype over `LIBUS_SOCKET_DESCRIPTOR` (`int` on POSIX,
/// `SOCKET`/`uintptr` on Windows). `#[repr(transparent)]` so it can cross the
/// `extern "C"` boundary wherever the raw descriptor does.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Fd(pub LIBUS_SOCKET_DESCRIPTOR);

impl Fd {
    /// `LIBUS_SOCKET_ERROR` — `-1` on POSIX, `INVALID_SOCKET` (`usize::MAX`) on
    /// Windows.
    #[cfg(not(windows))]
    pub const INVALID: Fd = Fd(-1);
    #[cfg(windows)]
    pub const INVALID: Fd = Fd(usize::MAX);

    /// True when the descriptor is not the platform error sentinel.
    #[inline(always)]
    pub const fn is_valid(self) -> bool {
        // On Windows `LIBUS_SOCKET_DESCRIPTOR` is unsigned, so `!= INVALID` is
        // the only meaningful check; on POSIX `-1` is the sole failure value.
        self.0 != Self::INVALID.0
    }

    /// Unwrap to the raw descriptor.
    #[inline(always)]
    pub const fn raw(self) -> LIBUS_SOCKET_DESCRIPTOR {
        self.0
    }
}

impl From<LIBUS_SOCKET_DESCRIPTOR> for Fd {
    #[inline(always)]
    fn from(fd: LIBUS_SOCKET_DESCRIPTOR) -> Self {
        Fd(fd)
    }
}

impl From<Fd> for LIBUS_SOCKET_DESCRIPTOR {
    #[inline(always)]
    fn from(fd: Fd) -> Self {
        fd.0
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Error predicates
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
const WSAEWOULDBLOCK: c_int = 10035;
#[cfg(windows)]
const WSAENOBUFS: c_int = 10055;

/// C `LIBUS_ERR` — thread-local `errno` on POSIX, `WSAGetLastError()` on
/// Windows. Safe: both accessors read a thread-local slot with no
/// preconditions.
#[inline(always)]
pub fn last_error() -> c_int {
    #[cfg(windows)]
    {
        bun_windows_sys::ws2_32::WSAGetLastError()
    }
    #[cfg(not(windows))]
    {
        bun_core::ffi::errno()
    }
}

/// True when `err` is the non-blocking "try again later" code:
/// `EAGAIN`/`EWOULDBLOCK` on POSIX, `WSAEWOULDBLOCK` on Windows.
#[inline(always)]
pub fn would_block(err: c_int) -> bool {
    #[cfg(windows)]
    {
        err == WSAEWOULDBLOCK
    }
    #[cfg(not(windows))]
    {
        // POSIX allows EAGAIN != EWOULDBLOCK; check both.
        err == libc::EAGAIN || err == libc::EWOULDBLOCK
    }
}

/// True when `err` is a transient kernel-buffer exhaustion on a send path
/// (`ENOBUFS`/`ENOMEM` on POSIX, `WSAENOBUFS` on Windows). Kept separate from
/// [`would_block`] so recv-side EOF-vs-error callers never spin on `ENOBUFS`.
#[inline(always)]
pub fn is_transient_send_err(err: c_int) -> bool {
    #[cfg(windows)]
    {
        err == WSAENOBUFS
    }
    #[cfg(not(windows))]
    {
        err == libc::ENOBUFS || err == libc::ENOMEM
    }
}
