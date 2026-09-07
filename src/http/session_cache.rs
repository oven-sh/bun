//! Client-side TLS session cache for `fetch()`.
//!
//! Keyed on the keep-alive pool tuple `(hostname, port, proxy_auth_hash, unix_path)` and
//! scoped to one [`HTTPContext<true>`] per interned `SSLConfig`. A sink is
//! installed before the handshake and armed only after `checkServerIdentity`
//! passes, so an unverified handshake never inserts: a resumed handshake
//! restores the stored `verify_result` without a Certificate message, and
//! caching an unverified session would launder it into a later strict caller.
//! HTTP-thread-only.

use core::cell::RefCell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_boringssl_sys::{SSL, SSL_SESSION, SSL_SESSION_free, SSL_set_session};
use bun_core::strings;

use crate::http_context::MAX_KEEPALIVE_HOSTNAME;
use crate::signals;

/// An `SSL_SESSION` retains the peer chain, so keep this well below rustls' 256.
const SESSION_CACHE_CAPACITY: usize = 32;

struct CacheEntry {
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    /// AF_UNIX socket path; empty for TCP.
    unix_path: Box<[u8]>,
    /// `Option` so [`SessionCache::take`] can move ownership out.
    session: Option<NonNull<SSL_SESSION>>,
}

impl Drop for CacheEntry {
    fn drop(&mut self) {
        if let Some(s) = self.session.take() {
            // SAFETY: owns one reference from `SSL_SESSION_up_ref` in
            // `us_ssl_new_session_cb`.
            unsafe { SSL_SESSION_free(s.as_ptr()) };
        }
    }
}

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

    /// Remove and return the matching session (+1 ref). TLS 1.3 tickets are
    /// single-use, so a hit consumes the entry.
    pub(crate) fn take(
        &self,
        hostname: &[u8],
        port: u16,
        proxy_auth_hash: u64,
        unix_path: &[u8],
    ) -> Option<NonNull<SSL_SESSION>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }
        let mut entries = self.entries.borrow_mut();
        let idx = entries.iter().position(|e| {
            e.port == port
                && e.proxy_auth_hash == proxy_auth_hash
                && strings::eql_long(&e.hostname, hostname, true)
                && *e.unix_path == *unix_path
        })?;
        entries.remove(idx).session.take()
    }

    /// Takes ownership of `session` (+1 ref).
    fn insert(
        &self,
        hostname: &[u8],
        port: u16,
        proxy_auth_hash: u64,
        unix_path: &[u8],
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
                && *e.unix_path == *unix_path
        }) {
            let _ = entries.remove(idx);
        } else if entries.len() >= SESSION_CACHE_CAPACITY {
            let _ = entries.remove(0);
        }
        entries.push(CacheEntry {
            hostname: Box::<[u8]>::from(hostname),
            port,
            proxy_auth_hash,
            unix_path: Box::<[u8]>::from(unix_path),
            session: Some(session),
        });
    }
}

/// Per-`SSL` sink. Box-allocated; the ex_data slot on the `SSL` holds the raw
/// pointer and its free callback reclaims the Box on `SSL_free`.
pub(crate) struct SessionSink {
    ctx: *const crate::HttpsContext,
    hostname: Box<[u8]>,
    port: u16,
    proxy_auth_hash: u64,
    unix_path: Box<[u8]>,
    /// Set once `checkServerIdentity` passes. TLS 1.2 delivers the session
    /// inside `SSL_do_handshake`, before `on_handshake` can verify the peer.
    armed: bool,
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

extern "C" fn sink_on_new_session(owner: *mut c_void, session: *mut SSL_SESSION) {
    let Some(session) = NonNull::new(session) else {
        return;
    };
    let Some(owner) = NonNull::new(owner.cast::<SessionSink>()) else {
        // SAFETY: +1 reference received from C with no consumer.
        unsafe { SSL_SESSION_free(session.as_ptr()) };
        return;
    };
    // SAFETY: `owner` is the Box interior installed by [`install`]. Runs on
    // the HTTP thread inside `SSL_read`/`SSL_do_handshake`; nothing else
    // holds a borrow of the sink during that call.
    let sink = unsafe { owner.as_ref() };
    if sink.armed {
        // SAFETY: `ctx` is the `HTTPContext<true>` owning this socket's
        // group; it outlives every SSL attached to it.
        unsafe { &*sink.ctx }.session_cache.insert(
            &sink.hostname,
            sink.port,
            sink.proxy_auth_hash,
            &sink.unix_path,
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

extern "C" fn sink_on_free(owner: *mut c_void) {
    if owner.is_null() {
        return;
    }
    // SAFETY: `owner` is the `heap::into_raw` from [`install`]; the ex_data
    // free callback fires exactly once on `SSL_free`.
    unsafe { bun_core::heap::destroy(owner.cast::<SessionSink>()) };
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

/// Whether this TLS client should read/write the cache. Lax verification and
/// the JS `checkServerIdentity` path are excluded because [`arm`] only runs
/// after the native identity check in `on_handshake`; neither reaches it.
pub(crate) fn eligible(client: &crate::HTTPClient<'_>) -> bool {
    client.flags.reject_unauthorized
        && !client.signals.get(signals::Field::CertErrors)
        && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE
            .get()
            .unwrap_or(false)
}

/// Offer any cached session for this key and install an unarmed sink.
///
/// # Safety
/// `ssl` must be a live pre-handshake `SSL*`; `ctx` must outlive `ssl`.
pub(crate) unsafe fn install(
    ssl: *mut SSL,
    ctx: *const crate::HttpsContext,
    hostname: &[u8],
    port: u16,
    proxy_auth_hash: u64,
    unix_path: &[u8],
) {
    debug_assert!(!ssl.is_null());
    debug_assert!(!ctx.is_null());
    // SAFETY: caller contract.
    let cache = unsafe { &(*ctx).session_cache };
    if let Some(session) = cache.take(hostname, port, proxy_auth_hash, unix_path) {
        // SAFETY: `ssl` is live and pre-handshake; `SSL_set_session` takes
        // its own reference, so release ours after.
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
        unix_path: Box::<[u8]>::from(unix_path),
        armed: false,
        pending: None,
    });
    // SAFETY: `ssl` is live; Box ownership moves to the ex_data slot.
    unsafe {
        us_ssl_set_session_sink(
            ssl,
            bun_core::heap::into_raw(sink).cast::<c_void>(),
            Some(sink_on_new_session),
            Some(sink_on_free),
        );
    }
}

/// Flush the parked TLS 1.2 session and admit later TLS 1.3 tickets.
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
        // SAFETY: `ctx` outlives `ssl` per [`install`]'s contract.
        unsafe { &*sink.ctx }.session_cache.insert(
            &sink.hostname,
            sink.port,
            sink.proxy_auth_hash,
            &sink.unix_path,
            session,
        );
    }
}
