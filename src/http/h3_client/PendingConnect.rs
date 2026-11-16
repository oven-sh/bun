//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `on_dns_resolved` runs.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ptr::RefPtr;
use bun_threading::Guarded;
use bun_uws::quic;

use super::ClientSession;
use super::client_context::ClientContext;
use super::client_session::{quic_socket_mut, session_mut};
use crate::HTTPThread;

pub struct PendingConnect {
    session: RefPtr<ClientSession>,
    pc: quic::OwnedPendingConnect,
}

// SAFETY: a DNS thread only moves it into `RESOLVED`. The HTTP thread uses and drops it.
unsafe impl Send for PendingConnect {}

unsafe extern "Rust" {
    /// Defined in `bun_runtime::dns_jsc::internal`, which this crate cannot depend on.
    safe fn __bun_dns_register_quic(pc: PendingConnect) -> Option<PendingConnect>;
}

impl PendingConnect {
    pub(crate) fn register(
        thread: &mut HTTPThread,
        session: *mut ClientSession,
        pc: quic::OwnedPendingConnect,
    ) {
        let resolved = __bun_dns_register_quic(PendingConnect {
            // SAFETY: caller passes a live intrusive-refcounted ClientSession.
            session: unsafe { RefPtr::init_ref(session) },
            pc,
        });
        if let Some(resolved) = resolved {
            resolved.on_dns_resolved(thread);
        }
    }

    pub fn addrinfo(&self) -> *mut c_void {
        self.pc.addrinfo()
    }

    fn on_dns_resolved(self, thread: &mut HTTPThread) {
        let session = self.session.as_ptr();

        // session is kept alive by the ref `self` holds for the duration of this
        // fn — `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        if s.closed || s.pending.is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            drop(self.pc);
            if !s.closed {
                Self::fail_session(thread, session, crate::Error::Aborted);
            }
            return;
        }
        let Some(qs) = self.pc.resolved() else {
            Self::fail_session(thread, session, crate::Error::DNSResolutionFailed);
            return;
        };
        s.qsocket = Some(qs);
        // qs.ext() returns the per-socket user storage slot for ClientSession.
        *quic_socket_mut(qs.as_ptr()).ext::<ClientSession>() = NonNull::new(session);
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
    /// wake the loop. `drain_resolved` runs from `HTTPThread.drainEvents` on the
    /// next loop iteration after the wakeup.
    pub fn on_dns_resolved_threadsafe(self) {
        RESOLVED.lock().push(self);
        HTTPThread::wakeup();
    }

    pub(crate) fn drain_resolved(thread: &mut HTTPThread) {
        let batch = core::mem::take(&mut *RESOLVED.lock());
        for pc in batch {
            pc.on_dns_resolved(thread);
        }
    }

    /// Tear down a session that never reached `on_conn_close` (DNS failure or
    /// every waiter aborted while DNS was in flight).
    pub(crate) fn fail_session(
        thread: &mut HTTPThread,
        session: *mut ClientSession,
        err: crate::Error,
    ) {
        // Caller guarantees `session` is live (held by an intrusive ref) —
        // `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        s.closed = true;
        let _registry_ref =
            ClientContext::get().and_then(|ctx| ClientContext::as_mut(ctx).unregister(s));
        while !s.pending.is_empty() {
            let stream = s.pending[0].as_ptr();
            s.fail(thread, stream, err);
        }
    }
}

/// Queue of `PendingConnect`s whose DNS resolved off the HTTP thread, drained
/// on the next `HTTPThread::drain_events`.
static RESOLVED: Guarded<Vec<PendingConnect>> = Guarded::new(Vec::new());
