//! usockets' BoringSSL-side helpers (`crypto/openssl.c`) that operate on a
//! bare `SSL` / cert store rather than a `us_socket_t`.

use core::ffi::c_void;

use bun_boringssl_sys::{OwnedX509Store, SSL, SSL_SESSION, X509_STORE};

use crate::socket::{InternalSocket, NewSocketHandler};

unsafe extern "C" {
    safe fn us_ssl_get_new_session(ssl: &SSL) -> *mut SSL_SESSION;
    safe fn us_internal_ssl_set_inline_reject(ssl: &SSL);
    safe fn us_internal_ssl_loop_state_slots() -> core::ffi::c_int;
    fn us_internal_ssl_loop_state_save(ssl: *const SSL, out: *mut *mut c_void);
    fn us_internal_ssl_loop_state_restore(saved: *mut *mut c_void);
    safe fn us_get_shared_default_ca_store() -> *mut X509_STORE;
}

/// The session most recently delivered to this SSL's new-session callback
/// (the only place BoringSSL surfaces a TLS 1.3 NewSessionTicket), parked on
/// the SSL's ex-data by `openssl.c`.
pub fn ssl_new_session(ssl: &SSL) -> Option<&SSL_SESSION> {
    let p = us_ssl_get_new_session(ssl);
    (!p.is_null()).then(|| SSL_SESSION::opaque_ref(p))
}

/// Install the inline-reject verify recorder on a client SSL: the BIO hook and
/// handshake drive then keep a rejected chain's Finished off the wire and fail
/// the handshake with the X509 verdict.
pub fn ssl_set_inline_reject(ssl: &SSL) {
    us_internal_ssl_set_inline_reject(ssl)
}

/// The process-wide default root store (a new reference), if it could be
/// built.
pub fn shared_default_ca_store() -> Option<OwnedX509Store> {
    // SAFETY: `us_get_shared_default_ca_store` up-refs before returning, so
    // the caller owns the reference.
    unsafe { OwnedX509Store::from_raw(us_get_shared_default_ca_store()) }
}

/// A snapshot of the per-loop BIO routing state (`loop_ssl_data`) of a
/// connected usockets TLS socket, restored on drop. Take one around anything
/// run from inside `SSL_do_handshake`/`SSL_read` that can execute JS touching
/// another TLS socket on the same loop: that JS re-points the loop's current
/// socket / read window, and the interrupted handshake's next `BIO_write`
/// would otherwise land on the other socket's fd.
pub struct SslLoopState([*mut c_void; SslLoopState::SLOTS]);

impl SslLoopState {
    /// `US_SSL_LOOP_STATE_SLOTS` in usockets' internal.h.
    const SLOTS: usize = 6;

    /// A snapshot that restores nothing.
    pub const fn none() -> Self {
        SslLoopState([core::ptr::null_mut(); Self::SLOTS])
    }

    /// Snapshot `socket`'s loop state; [`none`](Self::none) unless it is a
    /// connected usockets socket with an `SSL` (duplex/pipe transports own
    /// memory BIOs whose data is not `loop_ssl_data`).
    pub fn save<const IS_SSL: bool>(socket: &NewSocketHandler<IS_SSL>) -> Self {
        debug_assert_eq!(
            Self::SLOTS as core::ffi::c_int,
            us_internal_ssl_loop_state_slots(),
            "loop-state snapshot size drifted from US_SSL_LOOP_STATE_SLOTS in internal.h"
        );
        let mut saved = Self::none();
        if let InternalSocket::Connected(_) = socket.socket {
            if let Some(ssl) = socket.ssl_mut() {
                // SAFETY: a connected usockets TLS socket's wbio is the custom
                // loop BIO whose data is `loop_ssl_data`; `saved` has `SLOTS` slots.
                unsafe { us_internal_ssl_loop_state_save(ssl, saved.0.as_mut_ptr()) };
            }
        }
        saved
    }
}

impl Drop for SslLoopState {
    fn drop(&mut self) {
        // SAFETY: `self.0` is all-null (a no-op) or exactly what
        // `us_internal_ssl_loop_state_save` produced.
        unsafe { us_internal_ssl_loop_state_restore(self.0.as_mut_ptr()) }
    }
}
