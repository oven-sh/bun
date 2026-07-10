//! `us_quic_pending_connect_s` — DNS-pending client connect. Created when
//! `Context.connect` returns 0 (cache miss); holds the
//! `Bun__addrinfo` request that the caller registers a callback on.
//! Consumed by exactly one of `resolved()` or `cancel()`.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::quic::Socket;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `us_quic_pending_connect_s`.
    pub struct PendingConnect;
}

// `PendingConnect` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`), so
// `&PendingConnect` is ABI-identical to a non-null `*mut PendingConnect`
// with no `noalias`/`readonly` attribute — handle-only shims are `safe fn`.
unsafe extern "C" {
    safe fn us_quic_pending_connect_addrinfo(pc: &PendingConnect) -> *mut c_void;
    safe fn us_quic_pending_connect_resolved(pc: &PendingConnect) -> *mut Socket;
    safe fn us_quic_pending_connect_cancel(pc: &PendingConnect);
}

impl PendingConnect {
    pub fn addrinfo(&self) -> *mut c_void {
        us_quic_pending_connect_addrinfo(self)
    }

    /// The connected socket, or `None` if the name lookup failed.
    ///
    /// Returns `NonNull`, not `&mut Socket`: the socket is C-owned, and minting a
    /// `&mut` from `&self` would let two live `&mut Socket` exist (and trips
    /// `clippy::mut_from_ref`). Callers reborrow via `Socket::opaque_mut`.
    pub fn resolved(&self) -> Option<NonNull<Socket>> {
        NonNull::new(us_quic_pending_connect_resolved(self))
    }

    pub fn cancel(&self) {
        us_quic_pending_connect_cancel(self)
    }
}
