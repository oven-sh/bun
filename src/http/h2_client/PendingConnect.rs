//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_core::strings;

use crate::InFlightRequest;
use crate::NewHTTPContext;
use crate::PeerVerification;
use crate::ssl_config::SSLConfig;

#[derive(Default)]
pub struct PendingConnect {
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    // Compared by pointer identity only, never derefed/freed here; lifetime-erased.
    pub(crate) ssl_config: Option<NonNull<SSLConfig>>,
    /// How the client that initiated this in-flight TLS connect will verify
    /// the peer. The eventual `ClientSession` records the same value; mirroring
    /// it here lets the coalescing path apply the guard *before* the session
    /// exists, so a strict caller never waits on a connect started by a lax one.
    pub(crate) verification: PeerVerification,
    pub(crate) pool_id: u64,
    pub(crate) waiters: Vec<InFlightRequest>,
}

impl PendingConnect {
    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<NonNull<SSLConfig>>,
        pool_id: u64,
    ) -> bool {
        self.port == port
            && self.pool_id == pool_id
            && self.ssl_config == ssl_config
            && strings::eql_long(&self.hostname, hostname)
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
}
