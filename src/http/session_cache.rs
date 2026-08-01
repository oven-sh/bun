//! Client-side TLS session cache for `fetch()`.
//!
//! BoringSSL's new-session callback is the only place a resumable TLS 1.3
//! session surfaces, and [`us_ssl_new_session_cb`] discards it for every
//! consumer except `Bun.connect` / `node:tls`. This module gives the HTTP
//! client a sink for those sessions so a second cold connect to an origin can
//! offer the stored ticket via `SSL_set_session` and skip the full handshake
//! (certificate chain walk + signature verification).
//!
//! The cache lives on [`HTTPContext<true>`] — one per interned `SSLConfig` —
//! and is keyed on the same `(hostname, port, proxy_auth_hash)` tuple the
//! keep-alive pool uses for direct TLS, so a cached session never crosses an
//! SNI / Host-override boundary the pool wouldn't. Only handshakes that ran
//! with `rejectUnauthorized=true` and passed `checkServerIdentity` insert,
//! because a resumed handshake restores the stored `verify_result` without
//! re-sending Certificate; caching an unverified session would launder it
//! into a later strict caller.
//!
//! Lifetime: all access is HTTP-thread-only (interior `RefCell`, no locking).
//! Each entry owns one `SSL_SESSION` reference, released on eviction /
//! `Drop`. The per-SSL [`SessionSink`] is heap-allocated, stored in a
//! BoringSSL ex_data slot on the `SSL`, and freed by the ex_data free
//! callback when the socket's `SSL` is freed.

use core::cell::RefCell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_boringssl_sys::{SSL, SSL_SESSION, SSL_SESSION_free, SSL_set_session};
use bun_core::strings;

use crate::http_context::MAX_KEEPALIVE_HOSTNAME;

/// Per-context LRU capacity. An `SSL_SESSION` retains the peer's full cert
/// chain (multi-KB) and there is one `HTTPContext<true>` per interned
/// `SSLConfig`, so this stays well below rustls' 256-entry default.
const SESSION_CACHE_CAPACITY: usize = 32;

/// One owned `SSL_SESSION` reference keyed on the pool tuple. `session` is
/// `Option` so [`SessionCache::take`] can move ownership out and let the
/// entry drop normally.
struct CacheEntry {
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    session: Option<NonNull<SSL_SESSION>>,
}

impl Drop for CacheEntry {
    fn drop(&mut self) {
        if let Some(s) = self.session.take() {
            // SAFETY: the entry owns one reference taken by
            // `us_ssl_new_session_cb` (`SSL_SESSION_up_ref`) before handing
            // the pointer to [`sink_on_new_session`].
            unsafe { SSL_SESSION_free(s.as_ptr()) };
        }
    }
}

/// Move-to-front LRU over a small `Vec`. Lookup is O(n) in `CAPACITY`; with
/// 32 entries this is cheaper than a map and keeps eviction trivial.
#[derive(Default)]
pub(crate) struct SessionCache {
    entries: RefCell<Vec<CacheEntry>>,
}

impl SessionCache {
    pub(crate) const fn new() -> Self {
        Self {
            entries: RefCell::new(Vec::new()),
        }
    }

    /// Remove and return the session for `(hostname, port, hash)`, passing
    /// its +1 reference to the caller. Returns `None` for hostnames longer
    /// than the pool's `MAX_KEEPALIVE_HOSTNAME` (the insert side skips them
    /// too). A TLS 1.3 ticket is single-use, so this consumes the entry.
    pub(crate) fn take(
        &self,
        hostname: &[u8],
        port: u16,
        proxy_auth_hash: u64,
    ) -> Option<NonNull<SSL_SESSION>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }
        let mut entries = self.entries.borrow_mut();
        let idx = entries.iter().position(|e| {
            e.port == port
                && e.proxy_auth_hash == proxy_auth_hash
                && strings::eql_long(&e.hostname, hostname, true)
        })?;
        entries.remove(idx).session.take()
    }

    /// Insert `session` (caller hands over its +1 ref). A matching key
    /// replaces; a full cache evicts the least-recently-inserted entry.
    fn insert(
        &self,
        hostname: &[u8],
        port: u16,
        proxy_auth_hash: u64,
        session: NonNull<SSL_SESSION>,
    ) {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            // SAFETY: caller transferred one reference.
            unsafe { SSL_SESSION_free(session.as_ptr()) };
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
            session: Some(session),
        });
    }
}

/// Per-`SSL` sink installed in `on_open` and torn down by the ex_data free
/// callback on `SSL_free`. Box-allocated; the ex_data slot holds the raw
/// pointer.
pub(crate) struct SessionSink {
    ctx: *const crate::HttpsContext,
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    /// Set once `checkServerIdentity` passes. Sessions delivered earlier
    /// (TLS 1.2 fires inside `SSL_do_handshake`, before `on_handshake`) are
    /// parked in `pending` instead of inserted.
    armed: bool,
    /// Most-recent session delivered before `armed`. Owned +1 reference.
    pending: Option<NonNull<SSL_SESSION>>,
}

impl Drop for SessionSink {
    fn drop(&mut self) {
        if let Some(p) = self.pending.take() {
            // SAFETY: `pending` owns one reference.
            unsafe { SSL_SESSION_free(p.as_ptr()) };
        }
    }
}

/// FFI sink callback: receives one `SSL_SESSION_up_ref`'d session.
extern "C" fn sink_on_new_session(owner: *mut c_void, session: *mut SSL_SESSION) {
    let Some(session) = NonNull::new(session) else {
        return;
    };
    let Some(owner) = NonNull::new(owner.cast::<SessionSink>()) else {
        // SAFETY: +1 reference received from C with no consumer.
        unsafe { SSL_SESSION_free(session.as_ptr()) };
        return;
    };
    // SAFETY: `owner` is the Box interior installed by [`install`]; the
    // new-session callback runs on the HTTP thread inside
    // `SSL_read`/`SSL_do_handshake`, and nothing else holds `&mut` to the
    // sink during that call.
    let sink = unsafe { owner.as_ref() };
    if sink.armed {
        // SAFETY: `ctx` is the live `HTTPContext<true>` owning this socket's
        // group; the context outlives every SSL attached to it (see
        // `HTTPContext::ref_count` doc). `session_cache` is accessed via
        // shared borrow + `RefCell`.
        unsafe { &*sink.ctx }.session_cache.insert(
            &sink.hostname,
            sink.port,
            sink.proxy_auth_hash,
            session,
        );
    } else {
        // SAFETY: unique access on the HTTP thread (see above).
        let sink = unsafe { &mut *owner.as_ptr() };
        if let Some(prev) = sink.pending.replace(session) {
            // SAFETY: `pending` owned one reference.
            unsafe { SSL_SESSION_free(prev.as_ptr()) };
        }
    }
}

/// FFI free callback for the ex_data slot: reclaims the Box.
extern "C" fn sink_on_free(owner: *mut c_void) {
    if owner.is_null() {
        return;
    }
    // SAFETY: `owner` is the `Box::into_raw` from [`install`]; the ex_data
    // free callback fires exactly once on `SSL_free`.
    drop(unsafe { Box::from_raw(owner.cast::<SessionSink>()) });
}

unsafe extern "C" {
    fn us_ssl_set_session_sink(
        ssl: *mut SSL,
        owner: *mut c_void,
        on_new_session: Option<extern "C" fn(*mut c_void, *mut SSL_SESSION)>,
        on_free: Option<extern "C" fn(*mut c_void)>,
    );
    fn us_ssl_get_session_sink_owner(ssl: *mut SSL) -> *mut c_void;
}

pub(crate) fn enabled() -> bool {
    !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE
        .get()
        .unwrap_or(false)
}

/// Look up a cached session on `ctx` for this key and, if found, offer it on
/// `ssl` before the handshake starts. Then install a sink so new tickets from
/// this handshake are captured. `ctx` must be the `HTTPContext<true>` that
/// owns `ssl`'s socket.
///
/// # Safety
/// `ssl` must be a live pre-handshake `SSL*`. `ctx` must be a live
/// `HTTPContext<true>` that outlives `ssl`.
pub(crate) unsafe fn install(
    ssl: *mut SSL,
    ctx: *const crate::HttpsContext,
    hostname: &[u8],
    port: u16,
    proxy_auth_hash: u64,
) {
    debug_assert!(!ssl.is_null());
    debug_assert!(!ctx.is_null());
    // SAFETY: caller contract — `ctx` is live.
    let cache = unsafe { &(*ctx).session_cache };
    if let Some(session) = cache.take(hostname, port, proxy_auth_hash) {
        // SAFETY: `ssl` is live and pre-handshake per caller contract;
        // `SSL_set_session` takes its own reference, so release ours after.
        unsafe {
            SSL_set_session(ssl, session.as_ptr());
            SSL_SESSION_free(session.as_ptr());
        }
    }
    let sink = Box::new(SessionSink {
        ctx,
        hostname: Box::<[u8]>::from(hostname),
        port,
        proxy_auth_hash,
        armed: false,
        pending: None,
    });
    // SAFETY: `ssl` is live; ownership of the Box moves to the ex_data slot
    // whose free callback reclaims it.
    unsafe {
        us_ssl_set_session_sink(
            ssl,
            Box::into_raw(sink).cast::<c_void>(),
            Some(sink_on_new_session),
            Some(sink_on_free),
        );
    }
}

/// Called from `on_handshake` after `checkServerIdentity` passes. Flushes any
/// session parked before verification (TLS 1.2) and lets later tickets
/// (TLS 1.3 post-handshake) go straight to the cache.
///
/// # Safety
/// `ssl` must be a live `SSL*` on the HTTP thread.
pub(crate) unsafe fn arm(ssl: *mut SSL) {
    if ssl.is_null() {
        return;
    }
    // SAFETY: caller contract.
    let owner = unsafe { us_ssl_get_session_sink_owner(ssl) };
    let Some(mut owner) = NonNull::new(owner.cast::<SessionSink>()) else {
        return;
    };
    // SAFETY: `owner` is the Box interior installed by [`install`], live
    // until `SSL_free`; HTTP-thread-only so this `&mut` is unique.
    let sink = unsafe { owner.as_mut() };
    if sink.armed {
        return;
    }
    sink.armed = true;
    if let Some(session) = sink.pending.take() {
        // SAFETY: `ctx` was live at install and outlives `ssl`; see
        // `HTTPContext::ref_count` doc.
        unsafe { &*sink.ctx }.session_cache.insert(
            &sink.hostname,
            sink.port,
            sink.proxy_auth_hash,
            session,
        );
    }
}
