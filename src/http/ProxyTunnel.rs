use core::ops::ControlFlow::{self, Continue};
use core::sync::atomic::Ordering;

use crate::Error;
use bun_core::scoped_log;
use bun_uws as uws;

use crate::http_cert_error::HTTPCertError;
use crate::http_context::{HTTPSocket, PeerVerification};
use crate::internal_state::HTTPStage;
use crate::ssl_config::SSLConfig;
use crate::ssl_wrapper::{Handler as SSLWrapperHandler, InitError, SSLWrapper};
use crate::{AlpnOffer, HTTPClient, NextStep};

bun_core::declare_scope!(http_proxy_tunnel, visible);

pub struct ProxyTunnel {
    /// `None` while `start` or `receive` runs it. They pass it on as `lent_wrapper`.
    wrapper: Option<SSLWrapper>,
    write_buffer: bun_io::StreamBuffer,
    /// Property of the inner TLS session, not the owning client. Captured from
    /// the client in record_verification() and restored to the next client in adopt()
    /// so the pool's did_have_handshaking_error_while_reject_unauthorized_is_false
    /// flag survives across reuse — otherwise a reject_unauthorized=false reuse
    /// would re-pool with the flag erased, letting a later reject_unauthorized=true
    /// request silently reuse a tunnel whose cert failed validation.
    pub(crate) did_have_handshaking_error: bool,
    /// How the inner TLS peer was authenticated. A CA-valid but wrong-hostname
    /// cert produces error_no=0 so did_have_handshaking_error stays false;
    /// without this, a strict caller could reuse a tunnel where the hostname
    /// was never checked natively.
    pub(crate) verification: PeerVerification,
}

/// TLS failed in a write or a flush. The caller must call [`HTTPClient::on_proxy_tunnel_close`].
pub(crate) struct TunnelClosed;

/// The handler for a call that feeds the wrapper.
struct ClientHandler<'a, 'c, const IS_SSL: bool> {
    client: &'a mut HTTPClient<'c>,
    socket: HTTPSocket<IS_SSL>,
    wrapper: &'a SSLWrapper,
    next_step: ControlFlow<NextStep>,
}

impl<const IS_SSL: bool> ClientHandler<'_, '_, IS_SSL> {
    fn stop_on_break(&mut self, flow: ControlFlow<NextStep>) {
        if flow.is_break() {
            self.next_step = flow;
            if self.client.proxy_tunnel.is_none() || !is_reusable(self.wrapper) {
                self.wrapper.stop();
            }
        }
    }

    fn close(&mut self, err: Error) {
        self.wrapper.stop();
        self.next_step = self.client.on_proxy_tunnel_close(err, self.socket);
    }
}

impl<const IS_SSL: bool> SSLWrapperHandler for ClientHandler<'_, '_, IS_SSL> {
    fn on_open(&mut self) {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
        bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
        self.client.state.response_stage = HTTPStage::ProxyHandshake;
        self.client.state.request_stage = HTTPStage::ProxyHandshake;
        if let Some(ssl) = self.wrapper.ssl() {
            let hostname = crate::get_tls_hostname(self.client, false);
            crate::configure_http_client_with_alpn(ssl, hostname, AlpnOffer::H1);
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        if self.next_step.is_break() {
            return;
        }
        scoped_log!(
            http_proxy_tunnel,
            "ProxyTunnel onData decoded {}",
            decoded_data.len()
        );
        let client = &mut *self.client;
        // While parked waiting for the JS `checkServerIdentity` verdict no request
        // has been written through the tunnel, so any decrypted application data
        // arriving here is unexpected.
        if client.state.flags.is_waiting_for_cert_check {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData while parked");
            return self.close(crate::Error::UnexpectedData);
        }
        // The context that owns the outer socket: its pool is the one that the next request searches.
        let hctx = client.get_ssl_ctx::<IS_SSL>();
        let report_progress = match client.state.response_stage {
            HTTPStage::Body => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body");
                client.handle_response_body(decoded_data, false)
            }
            HTTPStage::BodyChunk => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body_chunk");
                client.handle_response_body_chunked_encoding(decoded_data)
            }
            HTTPStage::ProxyHeaders => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
                let flow = client.handle_on_data_headers(
                    decoded_data,
                    hctx,
                    self.socket,
                    Some(self.wrapper),
                );
                return self.stop_on_break(flow);
            }
            _ => {
                scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
                Err(crate::Error::UnexpectedData)
            }
        };
        match report_progress {
            Ok(true) => {
                let flow = client.progress_update(hctx, self.socket);
                self.stop_on_break(flow);
            }
            Ok(false) => {}
            Err(err) => self.close(err),
        }
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: uws::us_bun_verify_error_t) {
        if self.next_step.is_break() {
            return;
        }
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
        let client = &mut *self.client;
        // Not the first report: a renegotiation, with the request already on its way.
        let first_report = client.state.request_stage == HTTPStage::ProxyHandshake;
        if first_report {
            client.state.response_stage = HTTPStage::ProxyHeaders;
            client.state.request_stage = HTTPStage::ProxyHeaders;
            client.state.rewind_request_head();
        }
        let handshake_error = HTTPCertError::from_verify_error(ssl_error);
        if handshake_success {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake success");
            // handshake completed but we may have ssl errors
            client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            // only reject the connection if reject_unauthorized == true
            if client.flags.reject_unauthorized && client.flags.did_have_handshaking_error {
                return self.close(crate::get_cert_error_from_no(handshake_error.error_no));
            }
            if !first_report {
                return;
            }
            if client.wants_server_identity_check() {
                let Some(ssl) = self.wrapper.ssl() else {
                    return;
                };
                let flow = client.check_server_identity(self.socket, ssl, false);
                if flow.is_break() {
                    scoped_log!(
                        http_proxy_tunnel,
                        "ProxyTunnel onHandshake checkServerIdentity failed"
                    );
                    return self.stop_on_break(flow);
                }
            }

            let flow = client.on_writable::<true, IS_SSL>(self.socket, Some(self.wrapper));
            self.stop_on_break(flow);
        } else {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake failed");
            // The wrapper reports a failed handshake together with the verify
            // result, which is `UNABLE_TO_GET_ISSUER_CERT` by default when the peer
            // never got as far as sending a certificate. Only a certificate that
            // was received can be what is wrong.
            let peer_sent_certificate =
                (self.wrapper.ssl()).is_some_and(|ssl| ssl.peer_certificate().is_some());
            let err = if handshake_error.error_no <= 0
                || (client.flags.reject_unauthorized && peer_sent_certificate)
            {
                crate::handshake_failure(handshake_error.error_no)
            } else {
                crate::Error::TLSHandshakeFailed
            };
            self.close(err);
        }
    }

    fn write(&mut self, encoded_data: &[u8]) {
        if let Some(tunnel) = &mut self.client.proxy_tunnel {
            write_encrypted(&mut tunnel.write_buffer, self.socket, encoded_data);
        }
    }

    fn on_close(&mut self) {
        if self.next_step.is_continue() {
            self.close(crate::Error::ConnectionClosed);
        }
    }

    /// The inner connection's form of `HTTPClient::server_identity`.
    fn server_identity(&mut self, ssl: &bun_boringssl::c::SSL) -> bun_boringssl::ServerIdentity {
        let client = &*self.client;
        let native = client.target_verification() == PeerVerification::Native;
        bun_boringssl::server_identity(ssl, native.then(|| crate::get_tls_hostname(client, false)))
    }
}

/// The handler for a call that does not feed the wrapper, which can then only seal records or fail.
struct EncryptHandler<'a, const IS_SSL: bool> {
    write_buffer: &'a mut bun_io::StreamBuffer,
    socket: HTTPSocket<IS_SSL>,
    result: Result<(), TunnelClosed>,
}

impl<const IS_SSL: bool> SSLWrapperHandler for EncryptHandler<'_, IS_SSL> {
    fn on_open(&mut self) {
        unreachable!();
    }

    fn on_data(&mut self, _: &[u8]) {
        debug_assert!(false, "`receive` left input behind");
        self.on_close();
    }

    fn on_handshake(&mut self, _: bool, _: uws::us_bun_verify_error_t) {
        debug_assert!(false, "the handshake ended without input");
        self.on_close();
    }

    fn write(&mut self, encoded_data: &[u8]) {
        write_encrypted(self.write_buffer, self.socket, encoded_data);
    }

    fn on_close(&mut self) {
        self.result = Err(TunnelClosed);
    }
}

fn write_encrypted<const IS_SSL: bool>(
    write_buffer: &mut bun_io::StreamBuffer,
    socket: HTTPSocket<IS_SSL>,
    encoded_data: &[u8],
) {
    // Preserve TLS record ordering: if any encrypted bytes are buffered,
    // enqueue new bytes and flush them in FIFO via onWritable.
    if write_buffer.is_not_empty() {
        if write_buffer.write(encoded_data).is_err() {
            bun_core::out_of_memory();
        }
        return;
    }
    let written = socket.write(encoded_data);
    let pending = &encoded_data[usize::try_from(written).expect("int cast")..];
    if !pending.is_empty() {
        // lets flush when we are truly writable
        if write_buffer.write(pending).is_err() {
            bun_core::out_of_memory();
        }
    }
}

fn is_reusable(wrapper: &SSLWrapper) -> bool {
    !wrapper.is_shutdown() && !wrapper.flags.fatal_error() && !wrapper.has_pending_data()
}

impl HTTPClient<'_> {
    /// [`ProxyTunnel::write`] for data that does not borrow `self`.
    pub(crate) fn write_to_proxy_tunnel<const IS_SSL: bool>(
        &mut self,
        socket: HTTPSocket<IS_SSL>,
        lent_wrapper: Option<&SSLWrapper>,
        buf: &[u8],
    ) -> ControlFlow<NextStep, Option<usize>> {
        let Some(tunnel) = &mut self.proxy_tunnel else {
            return Continue(None);
        };
        match tunnel.write(socket, lent_wrapper, buf) {
            Ok(written) => Continue(written),
            Err(TunnelClosed) => self
                .on_proxy_tunnel_close(Error::ConnectionClosed, socket)
                .map_continue(|()| None),
        }
    }

    pub(crate) fn on_proxy_tunnel_close<const IS_SSL: bool>(
        &mut self,
        mut err: Error,
        socket: HTTPSocket<IS_SSL>,
    ) -> ControlFlow<NextStep> {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onClose");
        // Mirror `HTTPClient::on_close`:
        // treat connection close as end-of-body for identity transfer when no content-length.
        if !self.state.flags.is_redirect_pending && self.state.is_body_complete_on_close() {
            match self.state.finalize_body_on_eof() {
                Ok(()) => return self.progress_update(self.get_ssl_ctx::<IS_SSL>(), socket),
                Err(e) => err = e,
            }
        }

        // Otherwise, treat as failure.
        self.close_and_fail(err, socket)
    }
}

// ─── ProxyTunnel methods ─────────────────────────────────────────────────────

impl ProxyTunnel {
    pub(crate) fn start<const IS_SSL: bool>(
        this: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        ssl_options: Option<&SSLConfig>,
        start_payload: &[u8],
    ) -> ControlFlow<NextStep> {
        let mut err = uws::create_bun_socket_error_t::none;
        let ssl_ctx = match ssl_options {
            // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
            Some(ssl_options) => ssl_options
                .as_usockets_for_client_verification()
                .create_ssl_context(&mut err),
            // The context a direct connection uses: it holds the thread's CA options (`bun install --ca`).
            None => Some(crate::http_thread().default_ssl_ctx()),
        };
        let Some(ssl_ctx) = ssl_ctx else {
            // Invalid TLS options; the errors a direct request reports for them.
            let error = match err {
                uws::create_bun_socket_error_t::invalid_crl => crate::Error::InvalidCRL,
                _ => crate::Error::FailedToOpenSocket,
            };
            return this.close_and_fail::<IS_SSL>(error, socket);
        };
        let wrapper = match SSLWrapper::init_with_ctx(&ssl_ctx, true) {
            Ok(w) => w,
            Err(e) => {
                if e == InitError::OutOfMemory {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                return this.close_and_fail::<IS_SSL>(crate::Error::FailedToOpenSocket, socket);
            }
        };
        // The inner connection's form of the `set_inline_reject` call in `HTTPClient::configure_tls`.
        if this.flags.reject_unauthorized {
            wrapper.set_inline_reject();
        }
        this.proxy_tunnel = Some(Box::new(ProxyTunnel {
            wrapper: None,
            write_buffer: bun_io::StreamBuffer::default(),
            did_have_handshaking_error: false,
            verification: PeerVerification::None,
        }));
        Self::run_wrapper(this, socket, wrapper, |wrapper, handler| {
            if !start_payload.is_empty() {
                scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
                wrapper.start_with_payload(handler, start_payload);
            } else {
                scoped_log!(http_proxy_tunnel, "proxy tunnel start");
                wrapper.start(handler);
            }
        })
    }

    /// Gives `wrapper` back to the tunnel of `client` afterwards, if it still has one.
    fn run_wrapper<const IS_SSL: bool>(
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        wrapper: SSLWrapper,
        call: impl FnOnce(&SSLWrapper, &mut dyn SSLWrapperHandler),
    ) -> ControlFlow<NextStep> {
        let mut handler = ClientHandler {
            client,
            socket,
            wrapper: &wrapper,
            next_step: Continue(()),
        };
        call(&wrapper, &mut handler);
        let next_step = handler.next_step;
        if let Some(tunnel) = &mut client.proxy_tunnel {
            tunnel.wrapper = Some(wrapper);
        }
        next_step
    }

    fn wrapper_and_encrypt_handler<'a, const IS_SSL: bool>(
        &'a mut self,
        socket: HTTPSocket<IS_SSL>,
        lent_wrapper: Option<&'a SSLWrapper>,
    ) -> (&'a SSLWrapper, EncryptHandler<'a, IS_SSL>) {
        let wrapper = lent_wrapper.or(self.wrapper.as_ref());
        let handler = EncryptHandler {
            write_buffer: &mut self.write_buffer,
            socket,
            result: Ok(()),
        };
        (wrapper.expect("lent by run_wrapper"), handler)
    }

    /// Outer socket became writable.
    pub(crate) fn on_writable<const IS_SSL: bool>(
        &mut self,
        socket: HTTPSocket<IS_SSL>,
        lent_wrapper: Option<&SSLWrapper>,
    ) -> Result<(), TunnelClosed> {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        let encoded_data = self.write_buffer.slice();
        if !encoded_data.is_empty() {
            let written = socket.write(encoded_data);
            let written = usize::try_from(written).expect("int cast");
            if written == encoded_data.len() {
                self.write_buffer.reset();
            } else {
                self.write_buffer.cursor += written;
            }
        }
        let (wrapper, mut handler) = self.wrapper_and_encrypt_handler(socket, lent_wrapper);
        // Cycle to through the SSL state machine
        let _ = wrapper.flush(&mut handler);
        handler.result
    }

    /// Encrypted bytes arrived on the outer socket of `client`, which has a tunnel.
    pub(crate) fn receive<const IS_SSL: bool>(
        client: &mut HTTPClient,
        socket: HTTPSocket<IS_SSL>,
        buf: &[u8],
    ) -> ControlFlow<NextStep> {
        let wrapper = (client.proxy_tunnel.as_mut()).and_then(|tunnel| tunnel.wrapper.take());
        let wrapper = wrapper.expect("given back by run_wrapper");
        Self::run_wrapper(client, socket, wrapper, |wrapper, handler| {
            wrapper.receive_data(handler, buf);
        })
    }

    /// `None` if TLS takes no data now.
    pub(crate) fn write<const IS_SSL: bool>(
        &mut self,
        socket: HTTPSocket<IS_SSL>,
        lent_wrapper: Option<&SSLWrapper>,
        buf: &[u8],
    ) -> Result<Option<usize>, TunnelClosed> {
        let (wrapper, mut handler) = self.wrapper_and_encrypt_handler(socket, lent_wrapper);
        let written = wrapper.write_data(&mut handler, buf);
        handler.result.map(|()| written.ok())
    }

    pub(crate) fn can_pool(&self) -> bool {
        self.write_buffer.is_empty() && self.wrapper.as_ref().is_some_and(is_reusable)
    }

    /// Call before the tunnel moves from `client` to the keep-alive pool.
    pub(crate) fn record_verification(&mut self, client: &HTTPClient) {
        // Capture the handshaking-error flag from the client — this is a property
        // of the inner TLS session, not the client. adopt() restores it to the
        // next client so re-pooling doesn't erase it.
        self.did_have_handshaking_error = client.flags.did_have_handshaking_error;
        // max semantics — a lax client is allowed to reuse a strict tunnel (the
        // existingSocket guard only blocks the reverse). When that lax client
        // pools it, it must not downgrade a hostname-verified TLS session.
        self.verification = self.verification.max(client.target_verification());
    }

    /// Reattach a pooled tunnel to a new HTTPClient. The TLS session
    /// is reused as-is — no CONNECT and no new TLS handshake. The client's
    /// request/response stage is set to .proxy_headers so the next onWritable
    /// writes the HTTP request directly into the tunnel.
    pub(crate) fn adopt(mut self: Box<Self>, client: &mut HTTPClient) {
        scoped_log!(
            http_proxy_tunnel,
            "ProxyTunnel adopt (reusing pooled tunnel)"
        );
        // Discard any stale encrypted bytes from the previous request. A clean
        // request boundary should leave this empty, but an early server response
        // (e.g. HTTP 413) with Connection: keep-alive before the full body was
        // consumed could leave unsent bytes that would corrupt the next request.
        self.write_buffer.reset();
        // Restore the cert-error flag captured in record_verification() — no handshake
        // runs here, so the client's own flag would otherwise stay false and
        // re-pooling would erase the record.
        client.flags.did_have_handshaking_error = self.did_have_handshaking_error;
        client.proxy_tunnel = Some(self);
        client.flags.proxy_tunneling = false;
        client.state.request_stage = HTTPStage::ProxyHeaders;
        client.state.response_stage = HTTPStage::ProxyHeaders;
        client.state.rewind_request_head();
    }
}
