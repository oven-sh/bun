//! Process-global lazily-initialised on the HTTP thread. Owns the QUIC client
//! and the live-session registry. Never freed, same as the HTTP thread itself.

use core::ptr::NonNull;
use std::rc::Rc;

use bun_ptr::RefPtr;
use bun_uws::Loop as UwsLoop;
use bun_uws::quic;
use bun_uws::quic::client::Connecting;

use super::callbacks;
use super::client_session::{ClientSession, session_mut};
use super::pending_connect::PendingConnect;
use crate::InFlightRequest;
use crate::http_thread::WriteMessageType;

use crate::h3_client::h3_client;

/// That of the timeouts of sockets, for which [`crate::normalize_idle_timeout_seconds`] makes up.
const SWEEP_SECONDS: u32 = 4;

pub(crate) struct ClientContext {
    pub(super) client: Rc<quic::Client>,
    sessions: Vec<RefPtr<ClientSession>>,
}

/// One instance per HTTP-thread loop. Stored as a process global only
/// because `bun.http.http_thread` is itself a process singleton.
// PORTING.md §Global mutable state: HTTP-thread-only singleton. AtomicCell
// over RacyCell because the payload is a pointer-sized `Copy` value
// (`Option<NonNull<_>>` has an `Atom` impl) so load/store are safe; the
// uncontended atomic op is free on the single HTTP client thread.
static INSTANCE: bun_core::AtomicCell<Option<NonNull<ClientContext>>> =
    bun_core::AtomicCell::new(None);

impl ClientContext {
    /// Non-null pointer to the leaked process-lifetime singleton, if created.
    /// Callers reborrow per-access — PORTING.md §Global mutable state.
    pub(crate) fn get() -> Option<NonNull<ClientContext>> {
        INSTANCE.load()
    }

    /// Upgrade the [`get`]/[`get_or_create`] handle to `&mut Self`.
    ///
    /// INVARIANT: `this` is the leaked-`Box` process-lifetime singleton stored
    /// in `INSTANCE`; all access is HTTP-thread-only, so the returned `&mut`
    /// is the sole live borrow for its (caller-chosen) lifetime. Mirrors the
    /// `stream_mut` backref-upgrade helper in `client_session`.
    #[inline]
    pub(crate) fn as_mut<'a>(this: NonNull<Self>) -> &'a mut Self {
        // SAFETY: see INVARIANT above — leaked Box, process-lifetime,
        // HTTP-thread-confined singleton.
        unsafe { &mut *this.as_ptr() }
    }

    pub(crate) fn get_or_create() -> Option<NonNull<ClientContext>> {
        if let Some(i) = INSTANCE.load() {
            return Some(i);
        }
        let self_ = bun_core::heap::alloc_nn(ClientContext {
            client: create_client()?,
            sessions: Vec::new(),
        });
        INSTANCE.store(Some(self_));
        Some(self_)
    }

    /// Find or open a connection to `port` on the host of `client` and queue `client` on it.
    pub(crate) fn connect(
        &mut self,
        client: InFlightRequest,
        port: u16,
    ) -> Result<(), InFlightRequest> {
        let hostname = bun_url::strip_ipv6_brackets(client.url.hostname);
        let reject = client.flags.reject_unauthorized;
        self.client.set_alarm(SWEEP_SECONDS);
        for s in self.sessions.iter().map(RefPtr::as_ptr) {
            // sessions vec holds live ClientSession pointers; removed via
            // unregister() before destroy — `session_mut` centralises that
            // backref upgrade.
            let s = session_mut(s);
            if s.matches(hostname, port, reject, client.pool.id) && s.has_headroom() {
                bun_core::scoped_log!(
                    h3_client,
                    "reuse session {}:{}",
                    bstr::BStr::new(hostname),
                    port,
                );
                s.enqueue(client);
                return Ok(());
            }
        }

        let registry_ref = ClientSession::new(hostname.to_vec(), port, reject, client.pool.id);
        let session = registry_ref.as_ptr();
        // `session` was just allocated by ClientSession::new — `session_mut`
        // upgrades the fresh heap pointer (sole owner) for these set-up writes.
        session_mut(session).registry_index = u32::try_from(self.sessions.len()).expect("int cast");
        self.sessions.push(registry_ref);
        session_mut(session).enqueue(client);

        match (self.client).connect(&session_mut(session).origin(), session.cast()) {
            Some(Connecting::Started(connection)) => {
                session_mut(session).connection = Some(connection);
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (sync)",
                    bstr::BStr::new(hostname),
                    port,
                );
            }
            Some(Connecting::Resolving(lookup)) => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (dns pending)",
                    bstr::BStr::new(hostname),
                    port,
                );
                PendingConnect::register(session, lookup);
            }
            None => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} failed",
                    bstr::BStr::new(hostname),
                    port,
                );
                let s = session_mut(session);
                let client = s.pending[0].client.take().expect("enqueued above");
                s.detach(s.pending[0].as_ptr());
                let _registry_ref = self.unregister(s);
                PendingConnect::fail_session(session, crate::Error::ConnectionRefused);
                return Err(client);
            }
        }
        Ok(())
    }

    /// Returns the registry's ref, which the caller holds while it empties `pending`.
    #[must_use]
    pub(crate) fn unregister(
        &mut self,
        session: &mut ClientSession,
    ) -> Option<RefPtr<ClientSession>> {
        let i = session.registry_index as usize;
        if i >= self.sessions.len() || !core::ptr::eq(self.sessions[i].as_ptr(), session) {
            return None;
        }
        let registry_ref = self.sessions.swap_remove(i);
        if i < self.sessions.len() {
            // The swapped-in element is a live registered session.
            session_mut(self.sessions[i].as_ptr()).registry_index =
                u32::try_from(i).expect("int cast");
        }
        session.registry_index = u32::MAX;
        Some(registry_ref)
    }

    pub(crate) fn abort_by_http_id(async_http_id: u32) -> bool {
        let Some(this) = Self::get() else {
            return false;
        };
        // Leaked Box, process-lifetime; HTTP-thread only — `BackRef` (immortal
        // referent) gives `&ClientContext` for the Vec iter. Each session is a
        // disjoint heap allocation, and `ClientSession::abort_by_http_id` never
        // calls back into `unregister`, so `sessions` is stable across the loop.
        let ctx = bun_ptr::BackRef::from(this);
        for s in ctx.sessions.iter().map(RefPtr::as_ptr) {
            // Registry only holds live sessions — `session_mut` upgrade.
            if session_mut(s).abort_by_http_id(async_http_id) {
                return true;
            }
        }
        false
    }

    fn sweep() {
        let Some(this) = Self::get() else {
            return;
        };
        // See `abort_by_http_id`.
        let ctx = bun_ptr::BackRef::from(this);
        for s in ctx.sessions.iter().map(RefPtr::as_ptr) {
            session_mut(s).sweep(SWEEP_SECONDS);
        }
        if !ctx.sessions.is_empty() {
            ctx.client.set_alarm(SWEEP_SECONDS);
        }
    }

    /// Close the connections of fetch session `pool_id` that carry no request.
    pub(crate) fn close_idle_sessions(pool_id: u64) {
        let Some(this) = Self::get() else {
            return;
        };
        // See `abort_by_http_id` — `BackRef` over the process-lifetime singleton.
        let ctx = bun_ptr::BackRef::from(this);
        for s in ctx.sessions.iter().filter(|it| it.pool_id == pool_id) {
            session_mut(s.as_ptr()).close_if_idle();
        }
    }

    pub(crate) fn stream_body_by_http_id(async_http_id: u32, message: WriteMessageType) {
        let Some(this) = Self::get() else {
            return;
        };
        // See `abort_by_http_id` — `BackRef` over the process-lifetime singleton.
        let ctx = bun_ptr::BackRef::from(this);
        for s in ctx.sessions.iter().map(RefPtr::as_ptr) {
            // Registry only holds live sessions — `session_mut` upgrade.
            if session_mut(s).stream_body_by_http_id(async_http_id, message) {
                return;
            }
        }
    }

    pub(crate) fn resume_receive_by_http_id(async_http_id: u32) {
        let Some(this) = Self::get() else {
            return;
        };
        let ctx = bun_ptr::BackRef::from(this);
        for s in ctx.sessions.iter().map(RefPtr::as_ptr) {
            if session_mut(s).resume_receive_by_http_id(async_http_id) {
                return;
            }
        }
    }
}

#[inline(never)]
fn create_client() -> Option<Rc<quic::Client>> {
    bun_removable_features::removable_definition!(Http3, create_client);
    quic::Client::new(UwsLoop::get(), callbacks::on_event, ClientContext::sweep)
}
