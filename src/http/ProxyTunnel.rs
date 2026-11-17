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

/// The outer socket, for code that only writes to it: the call is the same with and without TLS.
#[derive(Clone, Copy)]
pub(crate) struct OuterSocket(uws::InternalSocket);

impl<const IS_SSL: bool> From<HTTPSocket<IS_SSL>> for OuterSocket {
    fn from(socket: HTTPSocket<IS_SSL>) -> Self {
        Self(socket.socket)
    }
}

impl OuterSocket {
    fn write(self, data: &[u8]) -> usize {
        usize::try_from(uws::SocketTCP::from_any(self.0).write(data)).expect("int cast")
    }
}

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
                self.wrapper.deinit();
            }
        }
    }

    fn close(&mut self, err: Error) {
        self.wrapper.deinit();
        self.next_step = self.client.on_proxy_tunnel_close(err, self.socket);
    }
}

fn on_tunnel_open(client: &mut HTTPClient<'_>, wrapper: &SSLWrapper) {
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onOpen");
    bun_analytics::features::http_client_proxy.fetch_add(1, Ordering::Relaxed);
    client.state.response_stage = HTTPStage::ProxyHandshake;
    client.state.request_stage = HTTPStage::ProxyHandshake;
    if let Some(ssl_ptr) = wrapper.ssl.get() {
        let _hostname = crate::get_tls_hostname(client, false);

        // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's SSLWrapper.
        let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
        if bun_core::ip_address::is_ip_host(_hostname) {
            // SNI is null (IP literal — no SNI).
            crate::configure_http_client_with_alpn(ssl, core::ptr::null(), AlpnOffer::H1);
        } else {
            // SAFETY: TEMP_HOSTNAME is only accessed from the single HTTP thread.
            let temp_hostname = crate::temp_hostname();
            if _hostname.len() < temp_hostname.len() {
                temp_hostname[.._hostname.len()].copy_from_slice(_hostname);
                temp_hostname[_hostname.len()] = 0;
                // `temp_hostname` is NUL-terminated and outlives this call.
                crate::configure_http_client_with_alpn(
                    ssl,
                    temp_hostname.as_ptr().cast(),
                    AlpnOffer::H1,
                );
            } else {
                let mut owned = _hostname.to_vec();
                owned.push(0);
                // `owned` is NUL-terminated and outlives this call.
                crate::configure_http_client_with_alpn(ssl, owned.as_ptr().cast(), AlpnOffer::H1);
            }
        }
    }
}

enum Decrypted {
    Head,
    Body,
    BodyChunk,
    Unexpected,
}

fn classify_decrypted(client: &HTTPClient<'_>, decoded_data: &[u8]) -> Decrypted {
    scoped_log!(
        http_proxy_tunnel,
        "ProxyTunnel onData decoded {}",
        decoded_data.len()
    );
    // While parked waiting for the JS `checkServerIdentity` verdict no request
    // has been written through the tunnel, so any decrypted application data
    // arriving here is unexpected.
    if client.state.flags.is_waiting_for_cert_check {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onData while parked");
        return Decrypted::Unexpected;
    }
    match client.state.response_stage {
        HTTPStage::Body => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body");
            Decrypted::Body
        }
        HTTPStage::BodyChunk => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData body_chunk");
            Decrypted::BodyChunk
        }
        HTTPStage::ProxyHeaders => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData proxy_headers");
            Decrypted::Head
        }
        _ => {
            scoped_log!(http_proxy_tunnel, "ProxyTunnel onData unexpected data");
            Decrypted::Unexpected
        }
    }
}

/// Whether the request is to be sent now.
fn on_tunnel_handshake(
    client: &mut HTTPClient<'_>,
    wrapper: &SSLWrapper,
    handshake_success: bool,
    ssl_error: uws::us_bun_verify_error_t,
) -> Result<bool, Error> {
    scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake");
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
            return Err(crate::get_cert_error_from_no(handshake_error.error_no));
        }
        Ok(first_report)
    } else {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onHandshake failed");
        // The wrapper reports a failed handshake together with the verify
        // result, which is `UNABLE_TO_GET_ISSUER_CERT` by default when the peer
        // never got as far as sending a certificate. Only a certificate that
        // was received can be what is wrong.
        let peer_sent_certificate = wrapper.ssl.get().is_some_and(|ssl| {
            // SAFETY: the live SSL handle of the tunnel's wrapper; the chain is borrowed.
            !unsafe { bun_boringssl_sys::SSL_get_peer_cert_chain(ssl.as_ptr()) }.is_null()
        });
        Err(
            if handshake_error.error_no <= 0
                || (client.flags.reject_unauthorized && peer_sent_certificate)
            {
                crate::handshake_failure(handshake_error.error_no)
            } else {
                crate::Error::TLSHandshakeFailed
            },
        )
    }
}

impl<const IS_SSL: bool> SSLWrapperHandler for ClientHandler<'_, '_, IS_SSL> {
    fn on_open(&mut self) {
        on_tunnel_open(self.client, self.wrapper);
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        if self.next_step.is_break() {
            return;
        }
        let client = &mut *self.client;
        let report_progress = match classify_decrypted(client, decoded_data) {
            Decrypted::Body => client.handle_response_body(decoded_data, false),
            Decrypted::BodyChunk => client.handle_response_body_chunked_encoding(decoded_data),
            Decrypted::Head => {
                let wrapper = Some(self.wrapper);
                let flow = client.handle_on_data_headers(decoded_data, self.socket, wrapper);
                return self.stop_on_break(flow);
            }
            Decrypted::Unexpected => return self.close(crate::Error::UnexpectedData),
        };
        let flow = match report_progress {
            Ok(true) => client.progress_update(self.socket),
            Ok(false) => return,
            Err(err) => client.close_and_fail(err, self.socket),
        };
        self.stop_on_break(flow);
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: uws::us_bun_verify_error_t) {
        if self.next_step.is_break() {
            return;
        }
        match on_tunnel_handshake(self.client, self.wrapper, handshake_success, ssl_error) {
            Ok(true) => {}
            Ok(false) => return,
            Err(err) => return self.close(err),
        }
        let client = &mut *self.client;
        if client.wants_server_identity_check() {
            let Some(ssl_ptr) = self.wrapper.ssl.get() else {
                return;
            };

            // SAFETY: `ssl_ptr` is the live SSL handle from the tunnel's
            // SSLWrapper for the open inner TLS connection (NonNull invariant).
            let ssl = unsafe { &mut *ssl_ptr.as_ptr() };
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
    }

    fn write(&mut self, encoded_data: &[u8]) {
        if let Some(tunnel) = &mut self.client.proxy_tunnel {
            write_encrypted(&mut tunnel.write_buffer, self.socket.into(), encoded_data);
        }
    }

    fn on_close(&mut self) {
        if self.next_step.is_continue() {
            self.close(crate::Error::ConnectionClosed);
        }
    }

    /// The inner connection's form of `HTTPClient::server_identity`.
    fn server_identity(
        &mut self,
        ssl: &mut bun_boringssl::c::SSL,
    ) -> bun_boringssl::ServerIdentity {
        let client = &*self.client;
        let native = client.target_verification() == PeerVerification::Native;
        bun_boringssl::server_identity(ssl, native.then(|| crate::get_tls_hostname(client, false)))
    }
}

/// The handler for a call that does not feed the wrapper, which can then only seal records or fail.
struct EncryptHandler<'a> {
    write_buffer: &'a mut bun_io::StreamBuffer,
    socket: OuterSocket,
    result: Result<(), TunnelClosed>,
}

impl SSLWrapperHandler for EncryptHandler<'_> {
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

fn write_encrypted(
    write_buffer: &mut bun_io::StreamBuffer,
    socket: OuterSocket,
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
    let pending = &encoded_data[socket.write(encoded_data)..];
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
        match tunnel.write(socket.into(), lent_wrapper, buf) {
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
                Ok(()) => return self.progress_update(socket),
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
        let wrapper = match Self::create(this, ssl_options) {
            Ok(wrapper) => wrapper,
            Err(err) => return this.close_and_fail::<IS_SSL>(err, socket),
        };
        Self::run_wrapper(this, socket, wrapper, |wrapper, handler| {
            Self::start_wrapper(wrapper, handler, start_payload);
        })
    }

    /// Gives `this` a tunnel, and returns its wrapper.
    fn create(this: &mut HTTPClient, ssl_options: Option<&SSLConfig>) -> Result<SSLWrapper, Error> {
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
            return Err(error);
        };
        let wrapper = match SSLWrapper::init_with_ctx(ssl_ctx, true) {
            Ok(w) => w,
            Err(e) => {
                if e == InitError::OutOfMemory {
                    bun_core::out_of_memory();
                }

                // invalid TLS Options
                return Err(crate::Error::FailedToOpenSocket);
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
        Ok(wrapper)
    }

    fn start_wrapper(
        wrapper: &SSLWrapper,
        handler: &mut dyn SSLWrapperHandler,
        start_payload: &[u8],
    ) {
        if !start_payload.is_empty() {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start with payload");
            wrapper.start_with_payload(handler, start_payload);
        } else {
            scoped_log!(http_proxy_tunnel, "proxy tunnel start");
            wrapper.start(handler);
        }
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

    fn wrapper_and_encrypt_handler<'a>(
        &'a mut self,
        socket: OuterSocket,
        lent_wrapper: Option<&'a SSLWrapper>,
    ) -> (&'a SSLWrapper, EncryptHandler<'a>) {
        let wrapper = lent_wrapper.or(self.wrapper.as_ref());
        let handler = EncryptHandler {
            write_buffer: &mut self.write_buffer,
            socket,
            result: Ok(()),
        };
        (wrapper.expect("lent by run_wrapper"), handler)
    }

    /// Outer socket became writable.
    pub(crate) fn on_writable(
        &mut self,
        socket: OuterSocket,
        lent_wrapper: Option<&SSLWrapper>,
    ) -> Result<(), TunnelClosed> {
        scoped_log!(http_proxy_tunnel, "ProxyTunnel onWritable");
        let encoded_data = self.write_buffer.slice();
        if !encoded_data.is_empty() {
            let written = socket.write(encoded_data);
            if written == encoded_data.len() {
                self.write_buffer.reset();
            } else {
                self.write_buffer.cursor += written;
            }
        }
        let (wrapper, mut handler) = self.wrapper_and_encrypt_handler(socket, lent_wrapper);
        // Cycle to through the SSL state machine
        wrapper.flush(&mut handler);
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
    pub(crate) fn write(
        &mut self,
        socket: OuterSocket,
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
