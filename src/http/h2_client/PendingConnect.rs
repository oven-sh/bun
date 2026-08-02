//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_core::strings;

use crate::HTTPClient;
use crate::NewHTTPContext;
use crate::ssl_config::SSLConfig;

#[derive(Default)]
pub struct PendingConnect {
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    // Compared by pointer identity only, never derefed/freed here; lifetime-erased.
    pub(crate) ssl_config: Option<NonNull<SSLConfig>>,
    /// Whether the client that initiated this in-flight TLS connect requested
    /// `rejectUnauthorized`. The eventual `ClientSession` records this as
    /// `established_with_reject_unauthorized`; mirroring it here lets the
    /// coalescing path apply the same strictness guard *before* the session
    /// exists, so a strict caller never waits on a connect started by a lax one.
    pub(crate) reject_unauthorized: bool,
    pub(crate) host_header_hash: u64,
    // BACKREF: waiters are borrowed HTTP clients owned elsewhere; lifetime-erased.
    pub(crate) waiters: Vec<NonNull<HTTPClient<'static>>>,
}

impl PendingConnect {
    pub(crate) fn new(init: Self) -> Box<Self> {
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
    pub(crate) fn waiter_mut<'a>(p: NonNull<HTTPClient<'static>>) -> &'a mut HTTPClient<'static> {
        HTTPClient::from_erased_backref(p)
    }

    pub(crate) fn matches(
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
    pub(crate) fn unregister_from(
        this: *const Self,
        ctx: &mut NewHTTPContext<true>,
    ) -> Option<Box<Self>> {
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
