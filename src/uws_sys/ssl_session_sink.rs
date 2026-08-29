//! Typed front for uSockets' per-`SSL` session sink (`us_ssl_set_session_sink`).

use core::ffi::c_void;

use bun_boringssl_sys::{SSL, SSL_SESSION, SslSession};

/// Receives every resumable session BoringSSL issues on one `SSL` (its
/// new-session callback), on the thread driving that `SSL`. Dropped when the
/// `SSL` is freed or the sink is replaced.
pub trait SslSessionSink {
    fn on_new_session(&self, session: SslSession);
}

unsafe extern "C" {
    fn us_ssl_set_session_sink(
        ssl: *mut SSL,
        owner: *mut c_void,
        on_new_session: Option<extern "C" fn(*mut c_void, *mut SSL_SESSION)>,
        on_free: Option<extern "C" fn(*mut c_void)>,
    );
}

extern "C" fn on_new_session(owner: *mut c_void, session: *mut SSL_SESSION) {
    // SAFETY: `session` carries the +1 the C side took for us.
    let Some(session) = (unsafe { SslSession::from_raw(session) }) else {
        return;
    };
    // SAFETY: `owner` is the `Box<Box<dyn SslSessionSink>>` `set_session_sink`
    // leaked; live until `on_free`. Called on the SSL's thread only.
    let sink = unsafe { &*owner.cast::<Box<dyn SslSessionSink>>() };
    sink.on_new_session(session);
}

extern "C" fn on_free(owner: *mut c_void) {
    // SAFETY: `owner` is the box `set_session_sink` leaked; freed once, here.
    drop(unsafe { Box::from_raw(owner.cast::<Box<dyn SslSessionSink>>()) });
}

/// Install `sink` on `ssl`; it is dropped when `ssl` is freed.
pub fn set_session_sink(ssl: &mut SSL, sink: Box<dyn SslSessionSink>) {
    let owner = Box::into_raw(Box::new(sink)).cast::<c_void>();
    // SAFETY: `ssl` is live; ownership of `owner` moves to the ex_data slot.
    unsafe { us_ssl_set_session_sink(ssl, owner, Some(on_new_session), Some(on_free)) };
}
