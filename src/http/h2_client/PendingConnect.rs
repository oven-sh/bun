//! Placeholder registered while a fresh connect is in flight so that
//! concurrent h2-capable requests to the same origin coalesce onto its
//! eventual session instead of each opening a separate socket.

use core::ptr::NonNull;

use bun_core::strings;

use crate::InFlightRequest;
use crate::PeerVerification;
use crate::http_context::Transport;
use crate::ssl_config::SSLConfig;

pub struct PendingConnect {
    pub(crate) hostname: Box<[u8]>,
    pub(crate) port: u16,
    pub(crate) transport: Transport,
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
    /// `client.pending_h2` borrows the result, which the context's `pending_h2_connects` has to own.
    pub(crate) fn led_by(
        client: &mut InFlightRequest,
        hostname: &[u8],
        port: u16,
        transport: Transport,
    ) -> Box<Self> {
        let ssl_config = SSLConfig::raw_ptr(client.tls_props.as_ref());
        let mut this = Box::new(Self {
            hostname: Box::<[u8]>::from(hostname),
            port,
            transport,
            ssl_config: ssl_config.and_then(|it| NonNull::new(it.cast_mut())),
            verification: client.socket_verification(),
            pool_id: client.pool.id,
            waiters: Vec::new(),
        });
        client.pending_h2 = Some(NonNull::from(&mut *this));
        this
    }

    pub(crate) fn abort_waiter(list: &mut [Box<Self>], async_http_id: u32) -> bool {
        for pending in list {
            let mut waiters = pending.waiters.iter();
            if let Some(at) = waiters.position(|it| it.async_http_id == async_http_id) {
                pending.waiters.swap_remove(at).fail(crate::Error::Aborted);
                return true;
            }
        }
        false
    }

    pub(crate) fn matches(
        &self,
        hostname: &[u8],
        port: u16,
        transport: Transport,
        ssl_config: Option<NonNull<SSLConfig>>,
        pool_id: u64,
    ) -> bool {
        self.port == port
            && self.transport == transport
            && self.pool_id == pool_id
            && self.ssl_config == ssl_config
            && strings::eql_long(&self.hostname, hostname)
    }

    /// Remove `this` from a context's `pending_h2_connects` and hand the owning
    /// `Box<Self>` back to the caller. Associated fn (not `&mut self`) because
    /// the list owns `Box<Self>` — `swap_remove` would otherwise drop the very
    /// allocation `&mut self` borrows from (UAF). Caller holds the returned
    /// Box until scope exit.
    #[allow(clippy::vec_box)]
    pub(crate) fn unregister_from(
        this: *const Self,
        list: &mut Vec<Box<Self>>,
    ) -> Option<Box<Self>> {
        // reshaped for borrowck (was `for + swapRemove + return`)
        list.iter()
            .position(|p| core::ptr::eq(&raw const **p, this))
            .map(|i| list.swap_remove(i))
    }
}
