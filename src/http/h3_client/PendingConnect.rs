//! A QUIC connection that waits for the global DNS cache, which notifies via `on_dns_resolved[_threadsafe]`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `on_dns_resolved` runs.

use core::ffi::c_void;

use bun_ptr::RefPtr;
use bun_threading::Guarded;
use bun_uws::quic::client::Lookup;

use super::ClientSession;
use super::client_context::ClientContext;
use super::client_session::session_mut;

pub struct PendingConnect {
    session: RefPtr<ClientSession>,
    lookup: Lookup,
}

// SAFETY: a DNS thread only moves it into `RESOLVED`. The HTTP thread uses and drops it.
#[cfg_attr(mordant, allow(unsafe_send_covers_more_than_pointers))]
unsafe impl Send for PendingConnect {}

unsafe extern "Rust" {
    /// Defined in `bun_runtime::dns_jsc::internal`, which this crate cannot depend on.
    safe fn __bun_dns_register_quic(pc: PendingConnect);
}

impl PendingConnect {
    pub(crate) fn register(session: *mut ClientSession, lookup: Lookup) {
        __bun_dns_register_quic(PendingConnect {
            // SAFETY: caller passes a live intrusive-refcounted ClientSession.
            session: unsafe { RefPtr::init_ref(session) },
            lookup,
        });
    }

    pub fn addrinfo(&self) -> *mut c_void {
        self.lookup.request()
    }

    pub fn on_dns_resolved(self) {
        let session = self.session.as_ptr();

        // session is kept alive by the ref `self` holds for the duration of this
        // fn — `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        if s.closed || s.pending.is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            drop(self.lookup);
            if !s.closed {
                Self::fail_session(session, crate::Error::Aborted);
            }
            return;
        }
        s.connection = ClientContext::get().and_then(|ctx| {
            let client = &ClientContext::as_mut(ctx).client;
            client.connect_resolved(self.lookup, &s.origin(), session.cast())
        });
        if s.connection.is_none() {
            Self::fail_session(session, crate::Error::DNSResolutionFailed);
        }
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
    /// wake the loop. `drain_resolved` runs from `HTTPThread.drainEvents` on the
    /// next loop iteration after the wakeup.
    pub fn on_dns_resolved_threadsafe(self) {
        RESOLVED.lock().push(self);
        crate::HTTPThread::wakeup();
    }

    pub(crate) fn drain_resolved() {
        let batch = core::mem::take(&mut *RESOLVED.lock());
        for pc in batch {
            pc.on_dns_resolved();
        }
    }

    /// Tear down a session that never got a connection (DNS failure or
    /// every waiter aborted while DNS was in flight).
    pub(crate) fn fail_session(session: *mut ClientSession, err: crate::Error) {
        // Caller guarantees `session` is live (held by an intrusive ref) —
        // `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        s.closed = true;
        let _registry_ref =
            ClientContext::get().and_then(|ctx| ClientContext::as_mut(ctx).unregister(s));
        while !s.pending.is_empty() {
            let stream = s.pending[0].as_ptr();
            s.fail(stream, err);
        }
    }
}

/// Queue of `PendingConnect`s whose DNS resolved off the HTTP thread, drained
/// on the next `HTTPThread::drain_events`. Conceptually a field of
/// [`HTTPThread`](crate::HTTPThread) (there is exactly one), but kept as a
/// module static because `http_thread()` hands out `&'static mut HTTPThread`
/// to the HTTP thread — projecting a shared `&` to an interior field from the
/// DNS worker would alias that exclusive borrow under Stacked Borrows. A
/// dedicated `Sync` static sidesteps that without weakening the singleton
/// accessor's `&mut` contract.
static RESOLVED: Guarded<Vec<PendingConnect>> = Guarded::new(Vec::new());
