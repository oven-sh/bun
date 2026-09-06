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
    /// `bun_runtime`'s DNS cache: call `bun_http`'s
    /// `H3::PendingConnect::on_dns_resolved[_threadsafe](token)` once
    /// `request` resolves. `token` is opaque to both sides in between.
    fn Bun__addrinfo_registerQuic(request: *mut c_void, token: *mut c_void);
}

impl PendingConnect {
    pub fn addrinfo(&mut self) -> *mut c_void {
        us_quic_pending_connect_addrinfo(self)
    }

    /// Have the DNS layer report this connect's resolution with `token` (an
    /// opaque value it hands back verbatim, never dereferenced).
    pub fn notify_on_resolve(&mut self, token: *mut c_void) {
        let request = self.addrinfo();
        // SAFETY: `request` is this pending connect's live addrinfo request;
        // `token` is only ever passed back, not dereferenced.
        unsafe { Bun__addrinfo_registerQuic(request, token) }
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
