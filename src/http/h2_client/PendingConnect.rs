//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_core::strings;

use crate::HTTPClient;
use crate::NewHTTPContext;
use crate::ssl_config::SSLConfig;

pub struct PendingConnect {
    pub hostname: Box<[u8]>,
    pub port: u16,
    // Compared by pointer identity only, never derefed/freed here; lifetime-erased.
    pub ssl_config: Option<NonNull<SSLConfig>>,
    /// Whether the client that initiated this in-flight TLS connect requested
    /// `rejectUnauthorized`. The eventual `ClientSession` records this as
    /// `established_with_reject_unauthorized`; mirroring it here lets the
    /// coalescing path apply the same strictness guard *before* the session
    /// exists, so a strict caller never waits on a connect started by a lax one.
    pub reject_unauthorized: bool,
    pub host_header_hash: u64,
    /// The context whose `pending_h2_connects` list owns this entry, recorded
    /// at registration (`HTTPContext::connect`). `resolve_pending_h2` must
    /// unregister from exactly this list — looking the context up through the
    /// leader's `get_ssl_ctx()` at resolve time would miss (stranding the
    /// entry and its waiters) if the leader's custom context ever changed in
    /// between. BACKREF: the leader's `custom_ssl_ctx` strong ref (or the
    /// static `https_context`) keeps the pointee alive while this entry is
    /// registered.
    pub ctx: NonNull<NewHTTPContext<true>>,
    // BACKREF: waiters are borrowed HTTP clients owned elsewhere; lifetime-erased.
    pub waiters: Vec<NonNull<HTTPClient<'static>>>,
}

impl PendingConnect {
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    /// Upgrade a `waiters` back-ref to `&mut HTTPClient`.
    ///
    /// INVARIANT: every entry in `waiters` is a back-ref to a live
    /// `HTTPClient` embedded in its `AsyncHTTP`, registered via
    /// `HTTPContext::connect` and removed before that client's terminal
    /// callback. HTTP-thread-only, so the returned `&mut` is the sole live
    /// borrow. Routes through the crate-wide
    /// [`HTTPClient::from_erased_backref`] accessor.
    #[inline]
    pub fn waiter_mut<'a>(p: NonNull<HTTPClient<'static>>) -> &'a mut HTTPClient<'static> {
        HTTPClient::from_erased_backref(p)
    }

    pub fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<NonNull<SSLConfig>>,
        host_header_hash: u64,
    ) -> bool {
        self.port == port
            && self.ssl_config == ssl_config
            && self.host_header_hash == host_header_hash
            && strings::eql_long(&self.hostname, hostname, true)
    }

    /// Remove `this` from `ctx.pending_h2_connects` and hand the owning
    /// `Box<Self>` back to the caller. Associated fn (not `&mut self`) because
    /// the list owns `Box<Self>` — `swap_remove` would otherwise drop the very
    /// allocation `&mut self` borrows from (UAF). Caller holds the returned
    /// Box until scope exit.
    pub fn unregister_from(this: *const Self, ctx: &mut NewHTTPContext<true>) -> Option<Box<Self>> {
        let list = &mut ctx.pending_h2_connects;
        // reshaped for borrowck (was `for + swapRemove + return`)
        list.iter()
            .position(|p| core::ptr::eq(&raw const **p, this))
            .map(|i| list.swap_remove(i))
    }

    // Cleanup is handled by dropping `Box<PendingConnect>` — `Box<[u8]>`
    // and `Vec<_>` fields free themselves, and the Box frees the allocation.
    // No explicit `Drop` impl needed.
}
