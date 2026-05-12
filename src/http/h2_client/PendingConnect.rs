//! Placeholder registered while a fresh TLS connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_core::strings;

use crate::HTTPClient;
use crate::NewHTTPContext;
// TODO(b0): SSLConfig arrives from move-in
// (MOVE_DOWN bun_runtime::api::server::server_config::SSLConfig → bun_http)
use crate::ssl_config::SSLConfig;

pub struct PendingConnect {
    pub hostname: Box<[u8]>,
    pub port: u16,
    // TODO(port): lifetime — compared by pointer identity only, never derefed/freed here
    pub ssl_config: Option<NonNull<SSLConfig>>,
    // BACKREF: waiters are borrowed HTTP clients owned elsewhere; lifetime-erased.
    pub waiters: Vec<NonNull<HTTPClient<'static>>>,
}

impl Default for PendingConnect {
    fn default() -> Self {
        Self {
            hostname: Box::default(),
            port: 0,
            ssl_config: None,
            waiters: Vec::new(),
        }
    }
}

impl PendingConnect {
    /// Zig: `pub const new = bun.TrivialNew(@This());`
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
    ) -> bool {
        self.port == port
            && self.ssl_config == ssl_config
            && strings::eql_long(&self.hostname, hostname, true)
    }

    /// Remove `this` from `ctx.pending_h2_connects` and hand the owning
    /// `Box<Self>` back to the caller. Associated fn (not `&mut self`) because
    /// the list owns `Box<Self>` — `swap_remove` would otherwise drop the very
    /// allocation `&mut self` borrows from (UAF). Caller holds the returned
    /// Box until scope exit (Zig: `defer pc.deinit()`).
    pub fn unregister_from(this: *const Self, ctx: &mut NewHTTPContext<true>) -> Option<Box<Self>> {
        let list = &mut ctx.pending_h2_connects;
        // PORT NOTE: reshaped for borrowck (was `for + swapRemove + return`)
        list.iter()
            .position(|p| core::ptr::eq(&raw const **p, this))
            .map(|i| list.swap_remove(i))
    }

    // Zig `deinit` freed `hostname`, deinited `waiters`, and `bun.destroy(this)`.
    // In Rust all three are handled by dropping `Box<PendingConnect>` — `Box<[u8]>`
    // and `Vec<_>` fields free themselves, and the Box frees the allocation.
    // No explicit `Drop` impl needed.
}

// ported from: src/http/h2_client/PendingConnect.zig
