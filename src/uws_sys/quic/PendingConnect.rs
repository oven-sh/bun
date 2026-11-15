//! `us_quic_pending_connect_s` — DNS-pending client connect. Created when
//! `Context.connect` returns 0 (cache miss); holds the
//! `Bun__addrinfo` request that the caller registers a callback on.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::quic::{Context, Socket};

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `us_quic_pending_connect_s`.
    struct PendingConnect;
}

/// Cancelled on drop.
#[repr(transparent)]
pub struct OwnedPendingConnect(NonNull<PendingConnect>);

unsafe extern "C" {
    safe fn us_quic_pending_connect_addrinfo(pc: &PendingConnect) -> *mut c_void;
    safe fn us_quic_pending_connect_resolved(pc: OwnedPendingConnect) -> Option<NonNull<Socket>>;
    fn us_quic_pending_connect_cancel(pc: NonNull<PendingConnect>);
}

impl OwnedPendingConnect {
    pub fn addrinfo(&self) -> *mut c_void {
        us_quic_pending_connect_addrinfo(PendingConnect::opaque_ref(self.0.as_ptr()))
    }

    /// Takes the context that `self` came from, which does not leave its thread.
    pub fn resolved(self, _: &mut Context) -> Option<&mut Socket> {
        // SAFETY: only a later engine tick can close the socket.
        us_quic_pending_connect_resolved(self).map(|mut qs| unsafe { qs.as_mut() })
    }
}

impl Drop for OwnedPendingConnect {
    fn drop(&mut self) {
        // SAFETY: `self` is the only owner.
        unsafe { us_quic_pending_connect_cancel(self.0) }
    }
}
