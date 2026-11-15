//! Lazily-initialised on the HTTP thread. Owns the lsquic
//! client engine and the live-session registry. Never freed — the engine
//! lives for the process, same as the HTTP thread itself.

use bun_uws::Loop as UwsLoop;
use bun_uws::quic;
use bun_uws::quic::context::ConnectResult;

use super::callbacks;
use super::client_session::ClientSession;
use super::pending_connect::PendingConnect;
use crate::http_thread::WriteMessageType;
use crate::registry::Registry;
use crate::{HTTPThread, InFlightRequest};

use crate::h3_client::h3_client;

pub(crate) struct ClientContext {
    pub(super) qctx: &'static mut quic::Context,
    pub(super) sessions: Registry<ClientSession>,
}

static LSQUIC_INIT_ONCE: std::sync::Once = std::sync::Once::new();

impl ClientContext {
    pub(crate) fn get_or_create(thread: &mut HTTPThread) -> Option<&mut ClientContext> {
        if thread.h3_context.is_none() {
            LSQUIC_INIT_ONCE.call_once(quic::global_init);
            // SAFETY: `global_init` ran above. Nothing frees a client context.
            let qctx = unsafe { quic::Context::create_client(UwsLoop::get())?.as_mut() };
            callbacks::register(qctx);
            thread.h3_context = Some(ClientContext {
                qctx,
                sessions: Registry::new(),
            });
        }
        thread.h3_context.as_mut()
    }

    /// Takes the session at `index` out of the registry for `body`.
    pub(super) fn enter(
        thread: &mut HTTPThread,
        index: u32,
        body: impl FnOnce(&mut ClientSession, &mut HTTPThread),
    ) {
        let ctx = thread.h3_context.as_mut().expect("has a session");
        let mut session = ctx.sessions.take(index).expect("registered");
        body(&mut session, thread);
        let ctx = thread.h3_context.as_mut().expect("has a session");
        ctx.sessions.put_back(index, session);
        if !thread.reconnects.is_empty() {
            thread.run_reconnects();
        }
    }

    /// Find or open a connection to `port` on the host of `client` and queue `client` on it.
    pub(crate) fn connect(
        &mut self,
        client: InFlightRequest,
        port: u16,
    ) -> Result<(), InFlightRequest> {
        let hostname = bun_url::strip_ipv6_brackets(client.url.hostname);
        let reject = client.flags.reject_unauthorized;
        for (_, s) in self.sessions.iter_mut() {
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

        // Owned NUL-terminated buffer: copy the bytes
        // verbatim (interior NUL allowed) then append a sentinel; lsquic reads
        // it as a C string so an interior NUL truncates on the C side. This is
        // deliberately not `CString::new`, which would reject interior NUL
        // and diverge by returning `Err`.
        // Resolution and certificate verification name an IPv6 literal without its brackets.
        let mut host_buf = hostname.to_vec();
        host_buf.push(0);
        let host_z = std::ffi::CStr::from_bytes_until_nul(&host_buf).expect("nul appended above");
        let index = self.sessions.vacant_index();
        let mut session =
            ClientSession::new(index, hostname.to_vec(), port, reject, client.pool.id);

        let result = self.qctx.connect(host_z, port, host_z, reject);
        match result {
            ConnectResult::Socket(qs) => {
                session.bind_socket(qs);
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (sync)",
                    bstr::BStr::new(hostname),
                    port,
                );
            }
            ConnectResult::Pending(pending) => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} (dns pending)",
                    bstr::BStr::new(hostname),
                    port,
                );
                PendingConnect::register(index, pending);
            }
            ConnectResult::Err => {
                bun_core::scoped_log!(
                    h3_client,
                    "connect {}:{} failed",
                    bstr::BStr::new(hostname),
                    port,
                );
                return Err(client);
            }
        }
        session.enqueue(client);
        self.sessions.insert(session);
        Ok(())
    }

    pub(super) fn unregister(thread: &mut HTTPThread, index: u32) -> Option<Box<ClientSession>> {
        thread.h3_context.as_mut()?.sessions.remove(index)
    }

    pub(crate) fn abort_by_http_id(thread: &mut HTTPThread, async_http_id: u32) -> bool {
        let Some(client) = thread.h3_context.as_mut().and_then(|ctx| {
            (ctx.sessions.iter_mut()).find_map(|(_, s)| s.detach_by_http_id(async_http_id))
        }) else {
            return false;
        };
        client.fail(thread, crate::Error::Aborted);
        true
    }

    /// Close the connections of fetch session `pool_id` that carry no request.
    pub(crate) fn close_idle_sessions(&mut self, pool_id: u64) {
        for (_, s) in self.sessions.iter_mut() {
            s.close_if_idle(pool_id);
        }
    }

    pub(crate) fn stream_body_by_http_id(
        thread: &mut HTTPThread,
        async_http_id: u32,
        message: WriteMessageType,
    ) {
        let Some(ctx) = &mut thread.h3_context else {
            return;
        };
        if message != WriteMessageType::LengthMismatch {
            let ended = message == WriteMessageType::End;
            for (_, s) in ctx.sessions.iter_mut() {
                if s.stream_body_by_http_id(async_http_id, ended) {
                    break;
                }
            }
            return;
        }
        let client = (ctx.sessions.iter_mut())
            .find_map(|(_, s)| s.detach_streaming_by_http_id(async_http_id));
        if let Some(client) = client {
            client.fail(thread, crate::Error::RequestBodyLengthMismatch);
        }
    }

    pub(crate) fn resume_receive_by_http_id(&mut self, async_http_id: u32) {
        for (_, s) in self.sessions.iter_mut() {
            if s.resume_receive_by_http_id(async_http_id) {
                return;
            }
        }
    }
}
