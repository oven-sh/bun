//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `on_dns_resolved_threadsafe`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.

use core::ffi::c_void;

use bun_threading::Guarded;
use bun_uws::quic;

use crate::HTTPThread;

pub struct PendingConnect {
    /// `ClientSession::registry_index` of a session with no socket, which only `on_dns_resolved` unregisters.
    session_index: u32,
    pc: quic::OwnedPendingConnect,
}

// SAFETY: `pc` reaches the lsquic engine only in `resolved`, which takes the engine's `quic::Context`.
unsafe impl Send for PendingConnect {}

unsafe extern "Rust" {
    /// Defined in `bun_runtime::dns_jsc::internal`, which this crate cannot depend on.
    safe fn __bun_dns_register_quic(pc: PendingConnect);
}

impl PendingConnect {
    pub(crate) fn register(session_index: u32, pc: quic::OwnedPendingConnect) {
        __bun_dns_register_quic(PendingConnect { session_index, pc });
    }

    pub fn addrinfo(&self) -> *mut c_void {
        self.pc.addrinfo()
    }

    fn on_dns_resolved(self, thread: &mut HTTPThread) {
        let ctx = thread.h3_context.as_mut().expect("has a session");
        let s = ctx
            .sessions
            .get_mut(self.session_index)
            .expect("registered");
        if s.pending.is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            ctx.sessions.remove(self.session_index);
            return;
        }
        let Some(qs) = self.pc.resolved(ctx.qctx) else {
            let mut session = ctx.sessions.remove(self.session_index).expect("registered");
            return session.fail_pending(thread, crate::Error::DNSResolutionFailed);
        };
        s.bind_socket(qs);
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
    /// wake the loop. `drain_resolved` runs from `HTTPThread.drainEvents` on the
    /// next loop iteration after the wakeup.
    pub fn on_dns_resolved_threadsafe(self) {
        RESOLVED.lock().push(self);
        crate::HTTPThread::wakeup();
    }

    pub(crate) fn drain_resolved(thread: &mut HTTPThread) {
        let batch = core::mem::take(&mut *RESOLVED.lock());
        for pc in batch {
            pc.on_dns_resolved(thread);
        }
    }
}

/// Queue of `PendingConnect`s whose DNS resolved off the HTTP thread, drained
/// on the next `HTTPThread::drain_events`.
static RESOLVED: Guarded<Vec<PendingConnect>> = Guarded::new(Vec::new());
