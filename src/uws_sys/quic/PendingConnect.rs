//! `us_quic_pending_connect_s` — DNS-pending client connect. Created when
//! `Context.connect` returns 0 (cache miss); holds the
//! `Bun__addrinfo` request that the caller registers a callback on.
//! Consumed by exactly one of `resolved()` or `cancel()`.

use core::ffi::c_void;

use crate::quic::Socket;

/// Opaque FFI handle for `us_quic_pending_connect_s`.
#[repr(C)]
pub struct PendingConnect {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn us_quic_pending_connect_addrinfo(pc: *mut PendingConnect) -> *mut c_void;
    fn us_quic_pending_connect_resolved(pc: *mut PendingConnect) -> *mut Socket;
    fn us_quic_pending_connect_cancel(pc: *mut PendingConnect);
}

impl PendingConnect {
    pub fn addrinfo(&mut self) -> *mut c_void {
        // SAFETY: self is a valid *mut PendingConnect (opaque FFI handle).
        unsafe { us_quic_pending_connect_addrinfo(self) }
    }

    pub fn resolved(&mut self) -> Option<&mut Socket> {
        // SAFETY: self is a valid *mut PendingConnect; C returns null or a valid Socket*.
        unsafe { us_quic_pending_connect_resolved(self).as_mut() }
    }

    pub fn cancel(&mut self) {
        // SAFETY: self is a valid *mut PendingConnect (opaque FFI handle).
        unsafe { us_quic_pending_connect_cancel(self) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic/PendingConnect.zig (19 lines)
//   confidence: high
//   todos:      0
//   notes:      opaque FFI handle + 3 extern wrappers; Socket = crate::quic::Socket
// ──────────────────────────────────────────────────────────────────────────
