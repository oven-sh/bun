//! Safe `Poll` — the 16-byte header every uSockets handle starts with.
//!
//! Layout-identical to the per-backend `us_poll_t` (`eventing/*.rs`) so a
//! `*mut Poll` is a valid `*mut us_poll_t` and vice versa. All mutable state
//! lives behind `Cell` because dispatch holds `&Poll` while re-entrant
//! callbacks may call `us_poll_change`/`set_type` on the same poll.

use core::cell::Cell;
use core::ffi::c_int;

use crate::core::sys::Fd;
use crate::eventing::{LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE};
#[cfg(windows)]
use crate::types::LIBUS_SOCKET_DESCRIPTOR;
use crate::types::{
    POLL_TYPE_CALLBACK, POLL_TYPE_KIND_MASK, POLL_TYPE_POLLING_IN, POLL_TYPE_POLLING_OUT,
    POLL_TYPE_SEMI_SOCKET, POLL_TYPE_SOCKET, POLL_TYPE_SOCKET_SHUT_DOWN, POLL_TYPE_UDP,
};

// ═══════════════════════════════════════════════════════════════════════════
// Poll — backend-specific layout
// ═══════════════════════════════════════════════════════════════════════════

/// epoll/kqueue: one packed `u32` (`fd:27 | poll_type:5`), padded to 16 bytes
/// so the trailing ext area of every handle is 16-byte aligned.
#[cfg(not(windows))]
#[repr(C, align(16))]
pub struct Poll {
    state: Cell<u32>,
}

/// libuv: `uv_poll_t*` is held by pointer so `us_poll_resize` can grow the
/// enclosing handle without re-registering with libuv.
#[cfg(windows)]
#[repr(C)]
pub struct Poll {
    uv_p: *mut core::ffi::c_void,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    poll_type: Cell<u8>,
}

#[cfg(not(windows))]
impl Poll {
    /// Bits 5..32 are the fd, sign-extended (so `-1` round-trips).
    #[inline(always)]
    pub fn fd(&self) -> Fd {
        Fd((self.state.get() as i32) >> 5)
    }

    /// Raw 5-bit `poll_type` (kind bits 0..3 ∪ polling-direction bits 3..5).
    #[inline(always)]
    pub fn poll_type(&self) -> c_int {
        (self.state.get() & 0x1F) as c_int
    }

    /// Overwrite all 5 `poll_type` bits; fd is preserved.
    #[inline(always)]
    pub fn set_poll_type(&self, t: c_int) {
        self.state
            .set((self.state.get() & !0x1F) | (t as u32 & 0x1F));
    }
}

#[cfg(windows)]
impl Poll {
    #[inline(always)]
    pub fn fd(&self) -> Fd {
        Fd(self.fd)
    }

    #[inline(always)]
    pub fn poll_type(&self) -> c_int {
        c_int::from(self.poll_type.get())
    }

    #[inline(always)]
    pub fn set_poll_type(&self, t: c_int) {
        self.poll_type.set(t as u8);
    }
}

impl Poll {
    /// Currently-armed direction mask, reconstructed from the polling bits of
    /// `poll_type` (not from the kernel).
    #[inline]
    pub fn events(&self) -> PollEvents {
        let pt = self.poll_type();
        let mut ev = 0;
        if pt & POLL_TYPE_POLLING_IN != 0 {
            ev |= LIBUS_SOCKET_READABLE;
        }
        if pt & POLL_TYPE_POLLING_OUT != 0 {
            ev |= LIBUS_SOCKET_WRITABLE;
        }
        PollEvents(ev)
    }

    /// The 3-bit handle kind (socket/semi/callback/udp), polling bits masked off.
    #[inline]
    pub fn kind(&self) -> PollKind {
        PollKind::from_raw(self.poll_type() & POLL_TYPE_KIND_MASK)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PollKind — the 3-bit handle discriminant
// ═══════════════════════════════════════════════════════════════════════════

/// `POLL_TYPE_*` kind bits (low 3 of `poll_type`). Selects the concrete
/// container in `ReadyPoll::classify`.
#[repr(i32)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PollKind {
    Socket = POLL_TYPE_SOCKET,
    SocketShutDown = POLL_TYPE_SOCKET_SHUT_DOWN,
    SemiSocket = POLL_TYPE_SEMI_SOCKET,
    Callback = POLL_TYPE_CALLBACK,
    Udp = POLL_TYPE_UDP,
}

impl PollKind {
    #[inline]
    pub fn from_raw(raw: c_int) -> Self {
        match raw {
            POLL_TYPE_SOCKET => PollKind::Socket,
            POLL_TYPE_SOCKET_SHUT_DOWN => PollKind::SocketShutDown,
            POLL_TYPE_SEMI_SOCKET => PollKind::SemiSocket,
            POLL_TYPE_CALLBACK => PollKind::Callback,
            POLL_TYPE_UDP => PollKind::Udp,
            // 5..=7 unused; the 3-bit field cannot exceed 7.
            _ => unreachable!("invalid poll kind {raw}"),
        }
    }

    #[inline(always)]
    pub fn raw(self) -> c_int {
        self as c_int
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PollEvents — direction mask
// ═══════════════════════════════════════════════════════════════════════════

/// Backend-native `LIBUS_SOCKET_READABLE|WRITABLE` mask. Transparent over
/// `c_int` so it crosses `extern "C"` unchanged.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PollEvents(pub c_int);

impl PollEvents {
    pub const NONE: PollEvents = PollEvents(0);
    pub const READABLE: PollEvents = PollEvents(LIBUS_SOCKET_READABLE);
    pub const WRITABLE: PollEvents = PollEvents(LIBUS_SOCKET_WRITABLE);

    #[inline(always)]
    pub fn readable(self) -> bool {
        self.0 & LIBUS_SOCKET_READABLE != 0
    }

    #[inline(always)]
    pub fn writable(self) -> bool {
        self.0 & LIBUS_SOCKET_WRITABLE != 0
    }

    #[inline(always)]
    pub fn raw(self) -> c_int {
        self.0
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout assertions — must match the ABI `us_poll_t`
// ═══════════════════════════════════════════════════════════════════════════

const _: () = {
    assert!(core::mem::size_of::<Poll>() == core::mem::size_of::<crate::eventing::us_poll_t>());
    assert!(core::mem::align_of::<Poll>() == core::mem::align_of::<crate::eventing::us_poll_t>());
};
#[cfg(not(windows))]
const _: () = assert!(core::mem::size_of::<Poll>() == 16);
