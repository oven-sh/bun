//! `us_quic_pending_connect_s` — DNS-pending client connect. Created when
//! `Context.connect` returns 0 (cache miss); holds the
//! `Bun__addrinfo` request that the caller registers a callback on.
//! Consumed by exactly one of `resolved()` or `cancel()`.

use core::ffi::c_void;

use crate::quic::Socket;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `us_quic_pending_connect_s`.
    pub struct PendingConnect;
}

// `PendingConnect` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`), so
// `&mut PendingConnect` is ABI-identical to a non-null `*mut PendingConnect`
// with no `noalias`/`readonly` attribute — handle-only shims are `safe fn`.
unsafe extern "C" {
    safe fn us_quic_pending_connect_addrinfo(pc: &mut PendingConnect) -> *mut c_void;
    safe fn us_quic_pending_connect_resolved(pc: &mut PendingConnect) -> *mut Socket;
    safe fn us_quic_pending_connect_cancel(pc: &mut PendingConnect);
}

impl PendingConnect {
    pub fn addrinfo(&mut self) -> *mut c_void {
        us_quic_pending_connect_addrinfo(self)
    }

    pub fn resolved(&mut self) -> Option<&mut Socket> {
        // SAFETY: C returns null or a valid `us_quic_socket_t*`; `Socket` is an
        // opaque ZST handle so `&mut` carries no aliasing assumptions.
        unsafe { us_quic_pending_connect_resolved(self).as_mut() }
    }

    pub fn cancel(&mut self) {
        us_quic_pending_connect_cancel(self)
    }
}

// ported from: src/uws_sys/quic/PendingConnect.zig
