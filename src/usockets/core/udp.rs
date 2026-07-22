//! UdpSocket.
//!
//! Safe-field mirror of `us_udp_socket_t` (`types.rs`). Opaque to C++; every
//! mutable field is `Cell`-wrapped so dispatch may hold `&UdpSocket` while
//! `on_data`/`on_drain` re-enter and call `close()`/`set_connected()`.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::core::loop_::Loop;
use crate::core::poll::Poll;
use crate::core::sys::Fd;
use crate::types::us_udp_socket_t;

pub type OnData = Option<unsafe extern "C" fn(*mut UdpSocket, *mut c_void, c_int)>;
pub type OnDrain = Option<unsafe extern "C" fn(*mut UdpSocket)>;
pub type OnClose = Option<unsafe extern "C" fn(*mut UdpSocket)>;
pub type OnRecvError = Option<unsafe extern "C" fn(*mut UdpSocket, c_int)>;

/// A bound UDP socket. First field is [`Poll`] so `(&*s as *const Poll)` is
/// valid for dispatch.
#[repr(C, align(16))]
pub struct UdpSocket {
    pub(crate) poll: Poll,
    pub(crate) on_data: Cell<OnData>,
    pub(crate) on_drain: Cell<OnDrain>,
    pub(crate) on_close: Cell<OnClose>,
    /// Surfaces ICMP errors delivered via `IP_RECVERR` on Linux
    /// (`ECONNREFUSED`, etc.). The socket is not closed — caller decides.
    pub(crate) on_recv_error: Cell<OnRecvError>,
    pub(crate) user: Cell<*mut c_void>,
    pub(crate) loop_: Cell<Option<NonNull<Loop>>>,
    /// Cached bound port; used to rebuild a full `sockaddr` per received packet.
    pub(crate) port: Cell<u16>,
    /// `closed:1, connected:1` (LSB-first).
    pub(crate) bits: Cell<u16>,
    /// Singly-linked through `loop.data.closed_udp_head`.
    pub(crate) next: Cell<Option<NonNull<UdpSocket>>>,
}

impl UdpSocket {
    const CLOSED: u16 = 1 << 0;
    const CONNECTED: u16 = 1 << 1;

    #[inline]
    pub fn is_closed(&self) -> bool {
        self.bits.get() & Self::CLOSED != 0
    }
    #[inline]
    pub fn set_closed(&self, v: bool) {
        self.set_bit(Self::CLOSED, v)
    }
    #[inline]
    pub fn is_connected(&self) -> bool {
        self.bits.get() & Self::CONNECTED != 0
    }
    #[inline]
    pub fn set_connected(&self, v: bool) {
        self.set_bit(Self::CONNECTED, v)
    }

    #[inline(always)]
    fn set_bit(&self, mask: u16, v: bool) {
        let cur = self.bits.get();
        self.bits.set(if v { cur | mask } else { cur & !mask });
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.poll.fd()
    }

    #[inline]
    pub fn port(&self) -> u16 {
        self.port.get()
    }

    #[inline]
    pub fn user(&self) -> *mut c_void {
        self.user.get()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout assertions — must match `us_udp_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(offset_of!(UdpSocket, poll) == 0);
    assert!(size_of::<UdpSocket>() == size_of::<us_udp_socket_t>());
    assert!(align_of::<UdpSocket>() == align_of::<us_udp_socket_t>());
    assert!(offset_of!(UdpSocket, user) == offset_of!(us_udp_socket_t, user));
    assert!(offset_of!(UdpSocket, bits) == offset_of!(us_udp_socket_t, bits));
    assert!(offset_of!(UdpSocket, next) == offset_of!(us_udp_socket_t, next));
};
