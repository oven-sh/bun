//! ConnectingSocket + happy-eyeballs state machine.
//!
//! `ConnectingSocket` is the safe-field mirror of `us_connecting_socket_t`
//! (`types.rs`): every mutable field is `Cell`-wrapped so a re-entrant callback
//! holding `&ConnectingSocket` may mutate it (set `closed`, rewrite
//! `connecting_head`, bump `error`) without taking `&mut`. Opaque to C++ per
//! the safe-core design, so the layout need only match `types.rs`.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::{self, NonNull};

use crate::core::group::SocketGroup;
use crate::core::list::{Linked, ListLinks};
use crate::core::loop_::Loop;
use crate::core::socket::SocketHeader;
use crate::types::{addrinfo, addrinfo_request, us_connecting_socket_t};

// ═══════════════════════════════════════════════════════════════════════════
// ConnectingBits — the 5-bit state bitfield
// ═══════════════════════════════════════════════════════════════════════════

/// `closed:1, shutdown:1, shutdown_read:1, pending_resolve_callback:1,
/// error_is_dns:1` (LSB-first, matching `us_connecting_socket_t::bits`).
#[repr(transparent)]
pub struct ConnectingBits(Cell<u8>);

impl ConnectingBits {
    const CLOSED: u8 = 1 << 0;
    const SHUTDOWN: u8 = 1 << 1;
    const SHUTDOWN_READ: u8 = 1 << 2;
    const PENDING_RESOLVE_CALLBACK: u8 = 1 << 3;
    const ERROR_IS_DNS: u8 = 1 << 4;

    #[inline]
    pub const fn new() -> Self {
        Self(Cell::new(0))
    }

    #[inline]
    pub fn closed(&self) -> bool {
        self.0.get() & Self::CLOSED != 0
    }
    #[inline]
    pub fn set_closed(&self, v: bool) {
        self.set_bit(Self::CLOSED, v)
    }
    #[inline]
    pub fn shutdown(&self) -> bool {
        self.0.get() & Self::SHUTDOWN != 0
    }
    #[inline]
    pub fn set_shutdown(&self, v: bool) {
        self.set_bit(Self::SHUTDOWN, v)
    }
    #[inline]
    pub fn shutdown_read(&self) -> bool {
        self.0.get() & Self::SHUTDOWN_READ != 0
    }
    #[inline]
    pub fn set_shutdown_read(&self, v: bool) {
        self.set_bit(Self::SHUTDOWN_READ, v)
    }
    #[inline]
    pub fn pending_resolve_callback(&self) -> bool {
        self.0.get() & Self::PENDING_RESOLVE_CALLBACK != 0
    }
    #[inline]
    pub fn set_pending_resolve_callback(&self, v: bool) {
        self.set_bit(Self::PENDING_RESOLVE_CALLBACK, v)
    }
    /// `error` holds a `getaddrinfo(3)` return code, not an errno.
    #[inline]
    pub fn error_is_dns(&self) -> bool {
        self.0.get() & Self::ERROR_IS_DNS != 0
    }
    #[inline]
    pub fn set_error_is_dns(&self, v: bool) {
        self.set_bit(Self::ERROR_IS_DNS, v)
    }

    #[inline(always)]
    fn set_bit(&self, mask: u8, v: bool) {
        let cur = self.0.get();
        self.0.set(if v { cur | mask } else { cur & !mask });
    }
}

impl Default for ConnectingBits {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ConnectingSocket — layout-identical to `us_connecting_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

/// In-flight outbound connect: owns the DNS request + the fan-out of candidate
/// `SocketHeader`s racing to connect (happy-eyeballs). Followed in memory by
/// `socket_ext_size` bytes of handler state copied to the winning candidate.
#[repr(C, align(16))]
pub struct ConnectingSocket {
    pub(crate) addrinfo_req: Cell<*mut addrinfo_request>,
    pub(crate) group: Cell<Option<NonNull<SocketGroup>>>,
    /// Captured at create — stays valid after `group` detaches so the late
    /// after_resolve / free path never derefs into freed owner storage.
    pub(crate) loop_: Cell<Option<NonNull<Loop>>>,
    pub(crate) ssl_ctx: Cell<*mut bun_boringssl_sys::SSL_CTX>,
    /// Singly-linked through `loop.data.dns_ready_head` / `closed_connecting_head`.
    pub(crate) next: Cell<Option<NonNull<ConnectingSocket>>>,
    /// Candidate sockets currently attempting `connect()`.
    pub(crate) connecting_head: Cell<Option<NonNull<SocketHeader>>>,
    pub(crate) options: Cell<c_int>,
    pub(crate) socket_ext_size: Cell<c_int>,
    pub(crate) bits: ConnectingBits,
    pub(crate) timeout: Cell<u8>,
    pub(crate) long_timeout: Cell<u8>,
    pub(crate) kind: Cell<u8>,
    pub(crate) port: Cell<u16>,
    pub(crate) error: Cell<c_int>,
    pub(crate) addrinfo_head: Cell<*mut addrinfo>,
    /// Intrusive `prev`/`next` for [`SocketGroup::connecting`].
    pub(crate) links: ListLinks<ConnectingSocket>,
}

// SAFETY: `links` is an embedded `ListLinks<Self>` used by exactly one list
// (`SocketGroup::connecting`) and lives exactly as long as `*p`.
unsafe impl Linked for ConnectingSocket {
    #[inline(always)]
    fn links(p: NonNull<Self>) -> NonNull<ListLinks<Self>> {
        // SAFETY: field projection into live `*p` per the `Linked` contract.
        unsafe { NonNull::new_unchecked(ptr::addr_of_mut!((*p.as_ptr()).links)) }
    }
}

impl ConnectingSocket {
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.bits.closed()
    }

    #[inline]
    pub fn error(&self) -> c_int {
        self.error.get()
    }

    /// Pointer to the trailing ext area (the bytes immediately after the struct).
    #[inline(always)]
    pub fn ext_ptr(&self) -> *mut c_void {
        // SAFETY: allocated with trailing ext storage; `add(1)` lands on it.
        unsafe { NonNull::from(self).as_ptr().add(1).cast() }
    }

    /// Seconds are bucketed to `LIBUS_TIMEOUT_GRANULARITY` (4s); 0 disables.
    #[inline]
    pub fn set_timeout(&self, seconds: u32) {
        use crate::types::LIBUS_TIMEOUT_GRANULARITY as G;
        self.timeout.set(if seconds != 0 {
            seconds.div_ceil(G).min(u8::MAX as u32) as u8
        } else {
            u8::MAX
        });
    }

    /// Minutes are bucketed to 4-minute ticks; 0 disables.
    #[inline]
    pub fn set_long_timeout(&self, minutes: u32) {
        use crate::types::LIBUS_TIMEOUT_GRANULARITY as G;
        self.long_timeout.set(if minutes != 0 {
            minutes.div_ceil(G).min(u8::MAX as u32) as u8
        } else {
            u8::MAX
        });
    }

    /// Abort the connect, dispatch `on_connecting_error`, and schedule
    /// deferred free. Forwards to the existing `extern "C"` path until the
    /// happy-eyeballs state machine is fully ported to safe-core.
    #[inline]
    pub fn close(&self) {
        // SAFETY: `self` is live; layout-identical to `us_connecting_socket_t`.
        unsafe { us_connecting_socket_close(self.as_c_ptr()) }
    }

    /// Detach from the group and move onto the loop's deferred-free list.
    #[inline]
    pub fn free(&self) {
        // SAFETY: `self` is live; layout-identical to `us_connecting_socket_t`.
        unsafe { us_connecting_socket_free(self.as_c_ptr()) }
    }

    /// `*mut us_connecting_socket_t` view of `self` for the `extern "C"` shims.
    #[inline(always)]
    fn as_c_ptr(&self) -> *mut us_connecting_socket_t {
        NonNull::from(self).as_ptr().cast()
    }
}

unsafe extern "C" {
    fn us_connecting_socket_close(c: *mut us_connecting_socket_t);
    fn us_connecting_socket_free(c: *mut us_connecting_socket_t);
}

// ═══════════════════════════════════════════════════════════════════════════
// Layout assertions — must match `us_connecting_socket_t`
// ═══════════════════════════════════════════════════════════════════════════

const _: () = {
    use core::mem::{align_of, offset_of, size_of};
    assert!(size_of::<ConnectingSocket>() == size_of::<us_connecting_socket_t>());
    assert!(align_of::<ConnectingSocket>() == align_of::<us_connecting_socket_t>());
    assert!(offset_of!(ConnectingSocket, addrinfo_req) == 0);
    assert!(offset_of!(ConnectingSocket, group) == offset_of!(us_connecting_socket_t, group));
    assert!(offset_of!(ConnectingSocket, bits) == offset_of!(us_connecting_socket_t, bits));
    assert!(offset_of!(ConnectingSocket, error) == offset_of!(us_connecting_socket_t, error));
    assert!(
        offset_of!(ConnectingSocket, links) == offset_of!(us_connecting_socket_t, next_pending)
    );
    assert!(size_of::<ConnectingBits>() == 1);
};
