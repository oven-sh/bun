use core::cell::{Cell, RefCell};
use core::sync::atomic::Ordering;
use std::collections::VecDeque;

use crate::Error;
use bun_core::scoped_log;
use bun_ptr::{BackRef, SelfRoot, ThisPtr};
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::http_context::HTTPSocket;
use crate::internal_state::{HTTPStage, Stage};
use crate::ssl_config::SSLConfig;
use crate::ssl_wrapper::{Handlers as SSLWrapperHandlers, InitError, SSLWrapper, WriteDataError};
use crate::{AlpnOffer, HTTPClient, RequestRef, SniHostname};

bun_core::declare_scope!(http_proxy_tunnel, visible);

/// A counted reference on a [`ProxyTunnel`]; `.deref()` releases it.
pub type RefPtr = bun_ptr::RefPtr<ProxyTunnel>;

/// What the wrapper's callbacks get: the tunnel the wrapper is embedded in
/// (so it trivially outlives them).
type Ctx = BackRef<ProxyTunnel>;
type ProxyTunnelWrapper = SSLWrapper<Ctx>;

/// active socket is the socket that is currently being used
// `HTTPSocket<B>` = `uws::SocketHandler<B>` = `NewSocketHandler<B>`, so the
// canonical 3-arm enum lives in `bun_uws` next to its payload type.
pub use bun_uws::MaybeAnySocket as Socket;

/// Something the inner TLS session reported while the request driving the
/// tunnel was busy further up the stack; replayed by that request once it is
/// free (see [`HTTPClient::drain_tunnel_events`]).
enum TunnelEvent {
    Handshake(bool, uws::us_bun_verify_error_t),
    Data(Vec<u8>),
    Close,
}

#[derive(bun_ptr::CellRefCounted)]
pub struct ProxyTunnel {
    wrapper: ProxyTunnelWrapper,
    pub(crate) shutdown_err: Cell<Error>,
    /// active socket is the socket that is currently being used
    pub(crate) socket: Cell<Socket>,
    write_buffer: RefCell<bun_io::StreamBuffer>,
    /// Property of the inner TLS session, not the owning client. Captured from
    /// the client in detachOwner() and restored to the next client in adopt()
    /// so the pool's did_have_handshaking_error_while_reject_unauthorized_is_false
    /// flag survives across reuse — otherwise a reject_unauthorized=false reuse
    /// would re-pool with the flag erased, letting a later reject_unauthorized=true
    /// request silently reuse a tunnel whose cert failed validation.
    pub(crate) did_have_handshaking_error: Cell<bool>,
    /// Whether the inner TLS session was established with reject_unauthorized=true
    /// (and therefore hostname-verified via checkServerIdentity). A CA-valid but
    /// wrong-hostname cert produces error_no=0 so did_have_handshaking_error stays
    /// false; without this flag, a strict caller could reuse a tunnel where
    /// hostname was never checked.
    pub(crate) established_with_reject_unauthorized: Cell<bool>,
    pub(crate) ref_count: Cell<u32>,
    self_root: SelfRoot<ProxyTunnel>,
    /// The request currently driving this tunnel; `None` while pooled or once
    /// that request has let go of it.
    request: Cell<Option<RequestRef>>,
    deferred: RefCell<VecDeque<TunnelEvent>>,
}

impl ProxyTunnel {
    #[inline]
    fn this_ptr(&self) -> ThisPtr<ProxyTunnel> {
        self.self_root.this_ptr(self)
    }

    fn defer(&self, event: TunnelEvent) {
        self.deferred.borrow_mut().push_back(event);
    }

    fn pop_deferred(&self) -> Option<TunnelEvent> {
        self.deferred.borrow_mut().pop_front()
    }

    /// The request no longer drives this tunnel: nothing it reports reaches
    /// the request from here on.
    pub(crate) fn detach_request(&self) {
        self.request.set(None);
        self.deferred.borrow_mut().clear();
    }

    /// Forget the outer socket. Holders call this before releasing their
    /// handle, so a tunnel that outlives them never retains a dangling socket.
    #[inline]
    pub(crate) fn detach_socket(&self) {
        self.socket.set(Socket::None);
    }

    /// Whether the tunnel can go to the keep-alive pool: request side fully
    /// drained and the inner TLS session still alive.
    pub(crate) fn is_poolable(&self) -> bool {
        let w = &self.wrapper;
        self.write_buffer.borrow().is_empty()
            && !w.is_shutdown()
            && !w.flags.fatal_error()
            && !w.has_pending_data()
    }
}

// ─── SSLWrapper callbacks ────────────────────────────────────────────────────
//
// Each is invoked synchronously from inside an SSLWrapper method. The request
// that owns the tunnel is either free (the wrapper was entered from a socket
// event with no client borrowed) — handle inline — or busy (entered from one
// of the request's own methods) — defer, and that method replays the event
// when the wrapper call returns.

fn on_open(t: Ctx) {
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
    let _ = t;
}

fn on_data(t: Ctx, decoded_data: &[u8]) {
    if decoded_data.is_empty() {
        return;
    }
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onData decoded {}",
        decoded_data.len()
    );
    let Some(req) = t.request.get() else {
        return;
    };
    let Some(mut client) = req.try_client() else {
        t.defer(TunnelEvent::Data(decoded_data.to_vec()));
        return;
    };
    let _guard = t.this_ptr().ref_guard();
    client.tunnel_on_data(&t, decoded_data);
}

fn on_handshake(t: Ctx, handshake_success: bool, ssl_error: uws::us_bun_verify_error_t) {
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
    let Some(req) = t.request.get() else {
        return;
    };
    let Some(mut client) = req.try_client() else {
        t.defer(TunnelEvent::Handshake(handshake_success, ssl_error));
        return;
    };
    let _guard = t.this_ptr().ref_guard();
    client.tunnel_on_handshake(&t, handshake_success, ssl_error);
}

pub(crate) fn write_encrypted(t: Ctx, encoded_data: &[u8]) {
    let mut write_buffer = t.write_buffer.borrow_mut();
    // Preserve TLS record ordering: if any encrypted bytes are buffered,
    // enqueue new bytes and flush them in FIFO via onWritable.
    if write_buffer.is_not_empty() {
        if write_buffer.write(encoded_data).is_err() {
            bun_core::out_of_memory();
        }
        return;
    }
    let written = t.socket.get().write(encoded_data);
    let pending = &encoded_data[usize::try_from(written).expect("int cast")..];
    if !pending.is_empty() {
        // lets flush when we are truly writable
        if write_buffer.write(pending).is_err() {
            bun_core::out_of_memory();
        }
    }
}

fn on_close(t: Ctx) {
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onClose {}",
        if t.request.get().is_none() {
            "tunnel is detached"
        } else {
            "tunnel exists"
        }
    );
    let Some(req) = t.request.get() else {
        return;
    };
    let Some(mut client) = req.try_client() else {
        t.defer(TunnelEvent::Close);
        return;
    };
    client.tunnel_on_close(&t);
}

// ─── the request's side of those callbacks ───────────────────────────────────

impl HTTPClient {
    /// Replay whatever the tunnel reported while this request was busy inside
    /// a call into it. Call after every such call.
    #[inline]
    pub(crate) fn drain_tunnel_events(&mut self) {
        if self.proxy_tunnel.is_none() {
            return;
        }
        self.drain_tunnel_events_slow();
    }

    #[cold]
    fn drain_tunnel_events_slow(&mut self) {
        loop {
            let Some(t) = self.proxy_tunnel.as_ref().map(|p| BackRef::new(&**p)) else {
                return;
            };
            let Some(event) = t.pop_deferred() else {
                return;
            };
            // The handlers may release the request's reference; keep the
            // tunnel alive across each one.
            let _guard = t.this_ptr().ref_guard();
            match event {
                TunnelEvent::Handshake(ok, err) => self.tunnel_on_handshake(&t, ok, err),
                TunnelEvent::Data(data) => self.tunnel_on_data(&t, &data),
                TunnelEvent::Close => self.tunnel_on_close(&t),
            }
        }
    }

    /// Sets `shutdown_err` then drives `wrapper.shutdown()`, whose close
    /// callback comes back to this (busy) request as a deferred event.
    fn tunnel_close(&mut self, t: &ProxyTunnel, err: Error) {
        t.shutdown_err.set(err);
        // fast shutdown the connection
        let _ = t.wrapper.shutdown(true);
        self.drain_tunnel_events();
    }

    fn tunnel_on_data(&mut self, t: &ProxyTunnel, decoded_data: &[u8]) {
        // While parked waiting for the JS `checkServerIdentity` verdict no request
        // has been written through the tunnel, so any decrypted application data
        // arriving here is unexpected.
        if self.state.flags.is_waiting_for_cert_check {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData while parked");
            self.tunnel_close(t, crate::Error::UnexpectedData);
            return;
        }
        match self.state.response_stage {
            HTTPStage::Body => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body");
                if decoded_data.is_empty() {
                    return;
                }
                let report_progress = match self.handle_response_body(decoded_data, false) {
                    Ok(v) => v,
                    Err(err) => {
                        self.tunnel_close(t, err);
                        return;
                    }
                };

                if report_progress {
                    self.progress_update_for_proxy_socket(t);
                    return;
                }
            }
            HTTPStage::BodyChunk => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body_chunk");
                if decoded_data.is_empty() {
                    return;
                }
                let report_progress = match self.handle_response_body_chunked_encoding(decoded_data)
                {
                    Ok(v) => v,
                    Err(err) => {
                        self.tunnel_close(t, err);
                        return;
                    }
                };

                if report_progress {
                    self.progress_update_for_proxy_socket(t);
                    return;
                }
            }
            HTTPStage::ProxyHeaders => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
                // `hctx` is the pool the finished tunnel is released into. It must
                // be the context that owns the outer socket (the per-config custom
                // context when `tls` needs one, see `HTTPThread::connect`), which
                // is also the only pool the next request with that config searches.
                match t.socket.get() {
                    Socket::Ssl(socket) => {
                        let hctx = self.get_ssl_ctx::<true>();
                        self.handle_on_data_headers::<true>(decoded_data, hctx, socket);
                    }
                    Socket::Tcp(socket) => {
                        let hctx = self.get_ssl_ctx::<false>();
                        self.handle_on_data_headers::<false>(decoded_data, hctx, socket);
                    }
                    Socket::None => {}
                }
            }
            _ => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
                self.tunnel_close(t, crate::Error::UnexpectedData);
            }
        }
    }

    fn tunnel_on_handshake(
        &mut self,
        t: &ProxyTunnel,
        handshake_success: bool,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        self.state.response_stage = HTTPStage::ProxyHeaders;
        self.state.request_stage = HTTPStage::ProxyHeaders;
        self.state.request_sent_len = 0;
        let handshake_error = HTTPCertError::from_verify_error(ssl_error);
        if handshake_success {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake success");
            // handshake completed but we may have ssl errors
            self.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if self.flags.reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if self.flags.did_have_handshaking_error {
                    let err = crate::get_cert_error_from_no(handshake_error.error_no);
                    self.tunnel_close(t, err);
                    return;
                }

                // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                let verified = t.wrapper.with_ssl(|ssl| match t.socket.get() {
                    Socket::Ssl(socket) => self.check_server_identity::<true>(socket, ssl, false),
                    Socket::Tcp(socket) => self.check_server_identity::<false>(socket, ssl, false),
                    Socket::None => true,
                });
                match verified {
                    // the wrapper already released its SSL
                    None => return,
                    Some(false) => {
                        scoped_log!(
                            http_proxy_tunnel,
                            "ProxyTunnel onHandshake checkServerIdentity failed"
                        );
                        // checkServerIdentity already called closeAndFail()
                        // → fail() → result callback.
                        return;
                    }
                    Some(true) => {}
                }
            }

            match t.socket.get() {
                Socket::Ssl(socket) => self.on_writable::<true, true>(socket),
                Socket::Tcp(socket) => self.on_writable::<true, false>(socket),
                Socket::None => {}
            }
        } else {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake failed");
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            if self.flags.did_have_handshaking_error && handshake_error.error_no != 0 {
                let err = crate::get_cert_error_from_no(handshake_error.error_no);
                self.tunnel_close(t, err);
                return;
            }
            // if handshake_success it self is false, this means that the connection was rejected
            self.tunnel_close(t, crate::Error::ConnectionRefused);
        }
    }

    fn tunnel_on_close(&mut self, t: &ProxyTunnel) {
        // Not a scoped guard — the matching release is deferred via
        // `schedule_proxy_deref` to avoid freeing within the callback.
        let extra_ref = RefPtr::from_this(t.this_ptr());

        // If a response is in progress, mirror HTTPClient.onClose semantics:
        // treat connection close as end-of-body for identity transfer when no content-length.
        let in_progress = self.state.stage != Stage::Done
            && self.state.stage != Stage::Fail
            && !self.state.flags.is_redirect_pending;
        let mut fail_err: Option<crate::Error> = None;
        if in_progress && self.state.is_body_complete_on_close() {
            match self.state.finalize_body_on_eof() {
                Ok(()) => {
                    self.progress_update_for_proxy_socket(t);
                    self.thread().schedule_proxy_deref(extra_ref);
                    return;
                }
                Err(e) => fail_err = Some(e),
            }
        }

        // Otherwise, treat as failure. `close_and_fail` de-tags the outer socket
        // before `fail()` retires the request (the uSockets ext still points at
        // it until then).
        let err = fail_err.unwrap_or_else(|| t.shutdown_err.get());
        match t.socket.get() {
            Socket::Ssl(socket) => {
                self.close_and_fail::<true>(err, socket);
            }
            Socket::Tcp(socket) => {
                self.close_and_fail::<false>(err, socket);
            }
            Socket::None => {
                if fail_err.is_some() {
                    self.fail(err);
                }
            }
        }
        t.socket.set(Socket::None);
        // Deref after returning to the event loop to avoid lifetime hazards.
        self.thread().schedule_proxy_deref(extra_ref);
    }

    fn progress_update_for_proxy_socket(&mut self, t: &ProxyTunnel) {
        // Same context rule as the ProxyHeaders arm of `on_data`: the tunnel is
        // pooled into whichever context `progress_update` is handed.
        match t.socket.get() {
            Socket::Ssl(socket) => {
                let hctx = self.get_ssl_ctx::<true>();
                self.progress_update::<true>(hctx, socket);
            }
            Socket::Tcp(socket) => {
                let hctx = self.get_ssl_ctx::<false>();
                self.progress_update::<false>(hctx, socket);
            }
            Socket::None => {}
        }
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    pub(crate) fn start<const IS_SSL: bool>(
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        ssl_options: &SSLConfig,
        start_payload: &[u8],
    ) {
        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        let custom_options = ssl_options.as_usockets_for_client_verification();
        let wrapper = match ProxyTunnelWrapper::init_from_options(
            &custom_options,
            true,
            SSLWrapperHandlers {
                on_open,
                on_data,
                on_handshake,
                on_close,
                write: write_encrypted,
                // fetch's proxy tunnel surfaces no 'session'/'keylog' events;
                // opting out keeps its SSL off the parked queues entirely.
                on_session: None,
                on_keylog: None,
                // set once the tunnel exists, before anything can fire
                ctx: BackRef::dangling(),
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                if e == InitError::OutOfMemory {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                client.close_and_fail::<IS_SSL>(crate::Error::ConnectionRefused, socket);
                return;
            }
        };
        // The tunnel's initial reference; the client holds it until
        // `close_proxy_tunnel` or the hand-off to the keep-alive pool.
        let tunnel = RefPtr::new_cyclic(|self_root| ProxyTunnel {
            wrapper,
            shutdown_err: Cell::new(crate::Error::ConnectionClosed),
            socket: Cell::new(Socket::from_generic::<IS_SSL>(socket)),
            write_buffer: RefCell::new(bun_io::StreamBuffer::default()),
            did_have_handshaking_error: Cell::new(false),
            established_with_reject_unauthorized: Cell::new(false),
            ref_count: Cell::new(1),
            self_root,
            request: Cell::new(Some(client.req())),
            deferred: RefCell::new(VecDeque::new()),
        });
        tunnel.wrapper.set_ctx(BackRef::new(&*tunnel));

        // configure SNI/ALPN for the inner session before the first handshake
        let sni = SniHostname::new(client.hostname().unwrap_or_else(|| client.url.hostname()));
        tunnel.wrapper.with_ssl(|ssl| {
            crate::configure_http_client_with_alpn(ssl, sni.as_cstr(), AlpnOffer::H1)
        });
        client.state.response_stage = HTTPStage::ProxyHandshake;
        client.state.request_stage = HTTPStage::ProxyHandshake;

        let t = BackRef::new(&*tunnel);
        client.proxy_tunnel = Some(tunnel);
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            t.wrapper.start_with_payload(start_payload);
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            t.wrapper.start();
        }
        client.drain_tunnel_events();
    }

    pub(crate) fn shutdown(this: &ProxyTunnel) {
        // fast shutdown the connection
        let _ = this.wrapper.shutdown(true);
    }

    /// Outer socket became writable. The flush below can complete or fail the
    /// request, which releases the client's handle; the guard keeps the tunnel
    /// alive until this returns.
    pub(crate) fn on_writable<const IS_SSL: bool>(this: ThisPtr<Self>, socket: HTTPSocket<IS_SSL>) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        let _guard = this.ref_guard();
        {
            let mut write_buffer = this.write_buffer.borrow_mut();
            let encoded_data = write_buffer.slice();
            if !encoded_data.is_empty() {
                let written = socket.write(encoded_data);
                let written = usize::try_from(written).expect("int cast");
                if written == encoded_data.len() {
                    write_buffer.reset();
                } else {
                    write_buffer.cursor += written;
                }
            }
        } // release write_buffer before flush() re-borrows it inside write_encrypted
        // Cycle to through the SSL state machine
        let _ = this.wrapper.flush();
    }

    /// Encrypted bytes arrived on the outer socket. Same contract as
    /// [`Self::on_writable`].
    pub(crate) fn receive(this: ThisPtr<Self>, buf: &[u8]) {
        let _guard = this.ref_guard();
        this.wrapper.receive_data(buf);
    }

    pub(crate) fn write(&self, buf: &[u8]) -> Result<usize, Error> {
        self.wrapper.write_data(buf).map_err(|e| match e {
            WriteDataError::ConnectionClosed => crate::Error::ConnectionClosed,
            WriteDataError::WantRead => crate::Error::WantRead,
            WriteDataError::WantWrite => crate::Error::WantWrite,
        })
    }

    /// Detach the tunnel from its current HTTPClient owner so it can be safely
    /// pooled for keepalive. The inner TLS session is preserved. The tunnel's
    /// refcount is NOT changed — the caller must ensure the ref is transferred
    /// to the pool (or dereffed on failure to pool).
    pub(crate) fn detach_owner(&self, client: &HTTPClient) {
        self.socket.set(Socket::None);
        self.detach_request();
        // Capture the handshaking-error flag from the client — this is a property
        // of the inner TLS session, not the client. adopt() restores it to the
        // next client so re-pooling doesn't erase it.
        self.did_have_handshaking_error
            .set(client.flags.did_have_handshaking_error);
        // OR semantics — a lax client is allowed to reuse a strict tunnel (the
        // existingSocket guard only blocks the reverse). When that lax client
        // detaches, it must not downgrade a hostname-verified TLS session to
        // lax-established; once true, stays true.
        self.established_with_reject_unauthorized.set(
            self.established_with_reject_unauthorized.get() || client.flags.reject_unauthorized,
        );
        // The tunnel is idle in the pool and no callbacks will fire until
        // adopt() reattaches a new owner and socket.
    }

    /// Reattach a pooled tunnel to a new HTTPClient and socket. The TLS session
    /// is reused as-is — no CONNECT and no new TLS handshake. The client's
    /// request/response stage is set to .proxy_headers so the next onWritable
    /// writes the HTTP request directly into the tunnel.
    ///
    /// `tunnel` is the pool's handle; it moves into `client.proxy_tunnel` as
    /// is, so the ref the client later releases is the one the pool held.
    pub(crate) fn adopt<const IS_SSL: bool>(
        tunnel: RefPtr,
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
    ) {
        scoped_log!(
            http_proxy_tunnel,
            "ProxyTunnel adopt (reusing pooled tunnel)"
        );
        // Discard any stale encrypted bytes from the previous request. A clean
        // request boundary should leave this empty, but an early server response
        // (e.g. HTTP 413) with Connection: keep-alive before the full body was
        // consumed could leave unsent bytes that would corrupt the next request.
        tunnel.write_buffer.borrow_mut().reset();
        tunnel.deferred.borrow_mut().clear();
        tunnel.request.set(Some(client.req()));
        tunnel.socket.set(Socket::from_generic::<IS_SSL>(socket));
        // Restore the cert-error flag captured in detachOwner() — no handshake
        // runs here, so the client's own flag would otherwise stay false and
        // re-pooling would erase the record.
        client.flags.did_have_handshaking_error = tunnel.did_have_handshaking_error.get();
        client.proxy_tunnel = Some(tunnel);
        client.flags.proxy_tunneling = false;
        client.state.request_stage = HTTPStage::ProxyHeaders;
        client.state.response_stage = HTTPStage::ProxyHeaders;
        client.state.request_sent_len = 0;
    }
}
