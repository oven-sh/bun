//! Per-handshake certificate selection for `Bun.serve` — the machinery behind
//! node:https `SNICallback`.
//!
//! `Bun.serve`'s static `tls: [{serverName}, …]` array registers contexts in
//! uSockets' SNI tree up front. A `SNICallback` instead picks a context while
//! the ClientHello is being processed, possibly asynchronously, and possibly
//! refusing the connection. uSockets already supports that shape for
//! `Bun.listen`/node:tls (`us_listen_socket_on_server_name` +
//! `us_socket_sni_resolve`); this module is the `Bun.serve` side of the same
//! contract, plus the suspension registry an asynchronous resolution needs.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::collections::HashMap;

use bun_jsc::{JSValue, JsClass as _};
use bun_uws_sys as uws_sys;

use crate::api::bun_secure_context::SecureContext;

thread_local! {
    /// Handshakes parked by an asynchronous `SNICallback`, keyed by the token
    /// handed to JS. The entry is removed when the handshake's `SSL` is freed
    /// (see [`owner_free`]), which always happens before the socket itself is,
    /// so a resolution that outlives its connection resolves into nothing
    /// rather than touching freed memory.
    static SUSPENDED: RefCell<HashMap<u64, *mut uws_sys::us_socket_t>> =
        RefCell::new(HashMap::new());
    /// Never reused, so a late resolution cannot resume an unrelated handshake
    /// that happened to land on a recycled id.
    static NEXT_TOKEN: Cell<u64> = const { Cell::new(1) };
}

/// Allocate the token a suspended handshake is resumed with. Exact as an f64 in
/// JS until 2^53 handshakes have been dispatched on this thread.
pub(crate) fn next_token() -> u64 {
    NEXT_TOKEN.with(|c| {
        let token = c.get();
        c.set(token + 1);
        token
    })
}

/// Park `socket` until JS resolves `token`. Returns false when the handshake
/// could not be parked (the socket died underneath us); the caller must then
/// fall through to the default context rather than suspend.
pub(crate) fn suspend(socket: *mut uws_sys::us_socket_t, token: u64) -> bool {
    if socket.is_null() {
        return false;
    }
    SUSPENDED.with(|map| map.borrow_mut().insert(token, socket));
    // Ownership of the box moves into the SSL's suspension state; `owner_free`
    // reclaims it (and drops the registry entry) when the SSL is freed — or
    // synchronously, right here, when the handshake can no longer be parked.
    let owner = Box::into_raw(Box::new(token)).cast::<c_void>();
    uws_sys::us_socket_t::opaque_mut(socket).sni_attach_resume(owner, owner_free);
    SUSPENDED.with(|map| map.borrow().contains_key(&token))
}

/// uSockets calls this exactly once per attached handle, when the handshake's
/// `SSL` is freed. After it runs the socket the entry names may be freed at any
/// time, so the entry must not survive it.
extern "C" fn owner_free(owner: *mut c_void) {
    if owner.is_null() {
        return;
    }
    // SAFETY: `owner` is the box `suspend()` handed to `sni_attach_resume`,
    // returned here exactly once.
    let token = unsafe { Box::from_raw(owner.cast::<u64>()) };
    SUSPENDED.with(|map| map.borrow_mut().remove(&token));
}

/// `resumeServerSNI(token, contextOrUndefined, isError)` — completes a
/// handshake parked by an asynchronous `SNICallback`. A no-op when the token is
/// unknown: the connection went away, or the resolution already happened.
///
/// `context` is the native `SecureContext` the callback selected; `undefined`
/// or `null` falls through to the server's default context. Any other value is
/// not a usable context, so the handshake is refused rather than silently
/// served the default certificate.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__resumeServerSNI(token: f64, context: JSValue, is_error: bool) {
    let Some(socket) = SUSPENDED.with(|map| map.borrow_mut().remove(&(token as u64))) else {
        return;
    };

    let mut error = is_error;
    let mut ctx: *mut uws_sys::SslCtx = core::ptr::null_mut();
    if !error && !context.is_undefined_or_null() {
        match SecureContext::from_js(context) {
            // SAFETY: `from_js` returned a live SecureContext; `borrow()` hands
            // back an owned SSL_CTX reference that `sni_resolve` consumes.
            Some(sc) => ctx = unsafe { (*sc).borrow() }.cast(),
            None => error = true,
        }
    }

    // SAFETY: the registry entry is dropped before the socket can be freed
    // (`owner_free` runs on SSL free, which precedes the socket's own free), so
    // a token we just took out still names a live socket.
    uws_sys::us_socket_t::opaque_mut(socket).sni_resolve(ctx, error);
}
