//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]` with the ticket it was registered under, at
//! which point the resolved address is handed to lsquic and the resulting
//! `quic.Socket` bound to the waiting `ClientSession`.
//!
//! Lifetime: lives in `ThreadState::h3_dns_pending` and holds one ref on
//! `session` from `register` until the resolution is processed. The
//! `quic.PendingConnect` C handle is consumed by exactly one of `resolved()`
//! or `cancel()`.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_ptr::{RefPtr, ThisPtr};
use bun_uws::quic;

use super::ClientSession;
use crate::http_thread::ThreadState;

pub struct PendingConnect {
    /// The lookup's reference on the session.
    session: RefPtr<ClientSession>,
    /// FFI: opaque C handle owned until exactly one of resolved()/cancel()
    /// consumes it.
    pc: NonNull<quic::PendingConnect>,
}

/// Identifies a queued [`PendingConnect`] (its slot in
/// `ThreadState::h3_dns_pending`). Travels through the DNS layer as an
/// opaque pointer-sized token and is never dereferenced.
#[derive(Clone, Copy)]
pub(crate) struct DnsTicket(usize);

impl PendingConnect {
    #[inline]
    fn pc<'a>(&self) -> &'a mut quic::PendingConnect {
        quic::PendingConnect::opaque_mut(self.pc.as_ptr())
    }

    pub(crate) fn register(
        thread: &ThreadState,
        session: ThisPtr<ClientSession>,
        pc: *mut quic::PendingConnect,
    ) {
        let pc = NonNull::new(pc).expect("quic pending connect");
        let this = Box::new(PendingConnect {
            session: RefPtr::from_this(session),
            pc,
        });
        let ticket = {
            let mut slots = thread.h3_dns_pending.borrow_mut();
            let index = match slots.iter().position(Option::is_none) {
                Some(free) => {
                    slots[free] = Some(this);
                    free
                }
                None => {
                    slots.push(Some(this));
                    slots.len() - 1
                }
            };
            DnsTicket(index)
        };
        quic::PendingConnect::opaque_mut(pc.as_ptr()).notify_on_resolve(ticket.0 as *mut c_void);
    }

    /// DNS resolution finished for the connect registered under `token`
    /// (any thread): queue it for the HTTP thread's next pass.
    pub fn on_dns_resolved_threadsafe(token: *mut c_void) {
        crate::http_thread().schedule_h3_dns_resolved(DnsTicket(token as usize));
    }

    /// Same-thread variant; also queued, so the connect completes from the
    /// thread's event drain rather than inside the resolver's callback.
    pub fn on_dns_resolved(token: *mut c_void) {
        Self::on_dns_resolved_threadsafe(token);
    }

    /// Complete the connect registered under `ticket` on the HTTP thread.
    pub(crate) fn finish(thread: &ThreadState, ticket: DnsTicket) {
        let this = {
            let mut slots = thread.h3_dns_pending.borrow_mut();
            let Some(slot) = slots.get_mut(ticket.0) else {
                return;
            };
            let Some(this) = slot.take() else {
                return;
            };
            this
        };
        let session = this.session.this_ptr();
        ClientSession::enter(session, |s| {
            if s.closed.get() || s.pending.borrow().is_empty() {
                // Every waiter was aborted while DNS was in flight; don't open a
                // connection nobody will use. `cancel()` consumes the C handle.
                this.pc().cancel();
                if !s.closed.get() {
                    s.close_with(|_| crate::Error::Aborted, false);
                }
                return;
            }
            // `resolved()` consumes the C handle and returns the connected quic
            // socket or None on DNS failure.
            let Some(qs) = this.pc().resolved() else {
                s.close_with(|_| crate::Error::DNSResolutionFailed, false);
                return;
            };
            s.qsocket.set(Some(NonNull::from(&mut *qs)));
            // qs.ext() is the per-socket user storage slot for ClientSession.
            *qs.ext::<ClientSession>() = NonNull::new(session.as_ptr());
        });
        // the lookup's reference
        this.session.deref();
    }
}
