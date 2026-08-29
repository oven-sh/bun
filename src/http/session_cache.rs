//! Client-side TLS session cache for `fetch()`.
//!
//! Keyed on the keep-alive pool tuple `(hostname, port, proxy_auth_hash)` and
//! scoped to one [`HTTPContext<true>`] per interned `SSLConfig`. A sink is
//! installed before the handshake and armed only after `checkServerIdentity`
//! passes, so an unverified handshake never inserts: a resumed handshake
//! restores the stored `verify_result` without a Certificate message, and
//! caching an unverified session would launder it into a later strict caller.
//! HTTP-thread-only.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_boringssl_sys::{SSL, SslSession};
use bun_core::strings;
use bun_ptr::BackRef;

use crate::http_context::MAX_KEEPALIVE_HOSTNAME;
use crate::signals;

/// An `SSL_SESSION` retains the peer chain, so keep this well below rustls' 256.
const SESSION_CACHE_CAPACITY: usize = 32;

struct CacheEntry {
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    session: SslSession,
}

#[derive(Default)]
pub(crate) struct SessionCache {
    entries: RefCell<Vec<CacheEntry>>,
}

impl SessionCache {
    /// Remove and return the matching session. TLS 1.3 tickets are
    /// single-use, so a hit consumes the entry.
    pub(crate) fn take(
        &self,
        hostname: &[u8],
        port: u16,
        proxy_auth_hash: u64,
    ) -> Option<SslSession> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }
        let mut entries = self.entries.borrow_mut();
        let idx = entries.iter().position(|e| {
            e.port == port
                && e.proxy_auth_hash == proxy_auth_hash
                && strings::eql_long(&e.hostname, hostname, true)
        })?;
        Some(entries.remove(idx).session)
    }

    fn insert(&self, hostname: &[u8], port: u16, proxy_auth_hash: u64, session: SslSession) {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return;
        }
        let mut entries = self.entries.borrow_mut();
        if let Some(idx) = entries.iter().position(|e| {
            e.port == port
                && e.proxy_auth_hash == proxy_auth_hash
                && strings::eql_long(&e.hostname, hostname, true)
        }) {
            let _ = entries.remove(idx);
        } else if entries.len() >= SESSION_CACHE_CAPACITY {
            let _ = entries.remove(0);
        }
        entries.push(CacheEntry {
            hostname: Box::<[u8]>::from(hostname),
            port,
            proxy_auth_hash,
            session,
        });
    }
}

/// Per-`SSL` sink, shared between the `SSL`'s ex_data slot (which feeds it
/// sessions until `SSL_free`) and the request (which arms it).
pub(crate) struct SessionSink {
    /// The context owning this socket's group; it outlives every SSL attached
    /// to it and every request holding it.
    ctx: BackRef<crate::HttpsContext>,
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    /// Set once `checkServerIdentity` passes. TLS 1.2 delivers the session
    /// inside `SSL_do_handshake`, before `on_handshake` can verify the peer.
    armed: Cell<bool>,
    pending: RefCell<Option<SslSession>>,
}

impl SessionSink {
    fn insert(&self, session: SslSession) {
        self.ctx
            .session_cache
            .insert(&self.hostname, self.port, self.proxy_auth_hash, session);
    }

    /// Flush the parked TLS 1.2 session and admit later TLS 1.3 tickets.
    pub(crate) fn arm(&self) {
        if self.armed.replace(true) {
            return;
        }
        if let Some(session) = self.pending.borrow_mut().take() {
            self.insert(session);
        }
    }
}

struct SinkHandle(Rc<SessionSink>);

impl bun_uws::SslSessionSink for SinkHandle {
    fn on_new_session(&self, session: SslSession) {
        let sink = &self.0;
        if sink.armed.get() {
            sink.insert(session);
        } else {
            *sink.pending.borrow_mut() = Some(session);
        }
    }
}

/// Whether this TLS client should read/write the cache. Lax verification and
/// the JS `checkServerIdentity` path are excluded because [`SessionSink::arm`]
/// only runs after the native identity check in `on_handshake`; neither
/// reaches it.
pub(crate) fn eligible(client: &crate::HTTPClient) -> bool {
    client.flags.reject_unauthorized
        && !client.signals.get(signals::Field::CertErrors)
        && client.unix_socket_path.is_empty()
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE
            .get()
            .unwrap_or(false)
}

/// Offer any cached session for this key to the pre-handshake `ssl` and
/// install an unarmed sink; the returned handle is the request's, to arm.
pub(crate) fn install(
    ssl: &mut SSL,
    ctx: BackRef<crate::HttpsContext>,
    hostname: &[u8],
    port: u16,
    proxy_auth_hash: u64,
) -> Option<Rc<SessionSink>> {
    if let Some(session) = ctx.session_cache.take(hostname, port, proxy_auth_hash) {
        ssl.set_session(&session);
    }
    let sink = Rc::new(SessionSink {
        ctx,
        hostname: Box::<[u8]>::from(hostname),
        port,
        proxy_auth_hash,
        armed: Cell::new(false),
        pending: RefCell::new(None),
    });
    bun_uws::set_session_sink(ssl, Box::new(SinkHandle(Rc::clone(&sink))));
    Some(sink)
}
