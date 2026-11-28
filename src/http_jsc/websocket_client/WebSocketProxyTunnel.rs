//! WebSocketProxyTunnel handles TLS inside an HTTP CONNECT tunnel for wss:// through HTTP proxy.
//!
//! This is used when connecting to a wss:// WebSocket server through an HTTP proxy.
//! The flow is:
//! 1. HTTP CONNECT request to proxy (handled by WebSocketUpgradeClient)
//! 2. Proxy responds with 200 Connection Established
//! 3. TLS handshake inside the tunnel (handled by this module using SSLWrapper)
//! 4. WebSocket upgrade request through the TLS tunnel
//! 5. WebSocket 101 response
//! 6. Hand off to WebSocket client
//!
//! ## Aliasing model
//!
//! Every public entry that drives the `SslWrapper` (`start`, `receive`, `on_writable`,
//! `write`, `shutdown`) forms a `&SslWrapper` over the `wrapper` field and then
//! synchronously re-enters this struct through its `ssl_wrapper::Handler` impl.
//!
//! All state mutated after construction lives in `Cell` fields, and
//! `wrapper` is a write-once `OnceCell` set in `start()` before it is first
//! driven, so every access — from a driving entry or from a re-entered
//! callback — is a short shared borrow; no `&mut Self` is ever formed.
//!
//! `*WebSocketProxyTunnel` is freely aliased across callbacks.

use core::cell::{Cell, OnceCell};

use bun_ptr::{CellExt, RefPtr, RefPtrCellExt as _};
use bun_uws::ssl_wrapper::{self, SSLWrapper as SslWrapper};
use bun_uws::{NewSocketHandler, us_bun_verify_error_t};

use crate::websocket_client::{CloseMode, ErrorCode};

use bun_boringssl::c::OwnedSslCtx;

bun_core::declare_scope!(WebSocketProxyTunnel, visible);

use super::websocket_upgrade_client::{HttpUpgradeClient, HttpsUpgradeClient};

/// The upgrade client (either transport), until its `WebSocketProxy` drops.
#[derive(Clone)]
pub enum UpgradeClientRef {
    Http(RefPtr<HttpUpgradeClient>),
    Https(RefPtr<HttpsUpgradeClient>),
}

/// Builds the [`UpgradeClientRef`] variant for a concrete `HTTPClient<SSL>`.
pub trait IntoUpgradeClientRef: bun_ptr::AnyRefCounted {
    fn upgrade_client_ref(self: RefPtr<Self>) -> UpgradeClientRef;
}
impl IntoUpgradeClientRef for HttpUpgradeClient {
    fn upgrade_client_ref(self: RefPtr<Self>) -> UpgradeClientRef {
        UpgradeClientRef::Http(self)
    }
}
impl IntoUpgradeClientRef for HttpsUpgradeClient {
    fn upgrade_client_ref(self: RefPtr<Self>) -> UpgradeClientRef {
        UpgradeClientRef::Https(self)
    }
}

impl UpgradeClientRef {
    fn dispatch(
        self,
        http: impl FnOnce(&HttpUpgradeClient),
        https: impl FnOnce(&HttpsUpgradeClient),
    ) {
        match self {
            UpgradeClientRef::Http(client) => http(&client),
            UpgradeClientRef::Https(client) => https(&client),
        }
    }

    fn handle_decrypted_data(self, data: &[u8]) {
        self.dispatch(
            |c| c.handle_decrypted_data(data),
            |c| c.handle_decrypted_data(data),
        );
    }

    fn terminate(self, code: ErrorCode) {
        self.dispatch(|c| c.terminate(code), |c| c.terminate(code));
    }

    fn fail_tls(self, ssl_error: us_bun_verify_error_t, completed: bool) {
        self.dispatch(
            |c| c.fail_tls(ssl_error, completed),
            |c| c.fail_tls(ssl_error, completed),
        );
    }

    fn on_proxy_tls_handshake_complete(self) {
        self.dispatch(
            HttpUpgradeClient::on_proxy_tls_handshake_complete,
            HttpsUpgradeClient::on_proxy_tls_handshake_complete,
        );
    }

    fn tunnel_server_identity(
        self,
        ssl: &mut bun_boringssl::c::SSL,
        hostname: &[u8],
    ) -> bun_boringssl::ServerIdentity {
        match self {
            UpgradeClientRef::Http(client) => client.tunnel_server_identity(ssl, hostname),
            UpgradeClientRef::Https(client) => client.tunnel_server_identity(ssl, hostname),
        }
    }

    fn accepts_tunnel_peer(
        self,
        ssl: Option<&mut bun_boringssl::c::SSL>,
        chain_verified: bool,
        hostname: &[u8],
    ) -> bool {
        match self {
            UpgradeClientRef::Http(client) => {
                client.accepts_tunnel_peer(ssl, chain_verified, hostname)
            }
            UpgradeClientRef::Https(client) => {
                client.accepts_tunnel_peer(ssl, chain_verified, hostname)
            }
        }
    }
}

type WebSocketClient = crate::websocket_client::WebSocket<false>;

#[derive(bun_ptr::CellRefCounted)]
pub struct WebSocketProxyTunnel {
    ref_count: Cell<u32>,
    /// Reference to the upgrade client (WebSocketUpgradeClient) - used during handshake phase
    upgrade_client: Cell<Option<UpgradeClientRef>>,
    /// The connected client, until it drops its `Attached` in `clear_data`.
    connected_websocket: Cell<Option<RefPtr<WebSocketClient>>>,
    /// SSL wrapper for TLS inside tunnel; set once in `start()`.
    wrapper: OnceCell<SslWrapper>,
    /// The proxy connection, until the upgrade client that owns it lets go.
    socket: Cell<SocketUnion>,
    /// Hostname for SNI (Server Name Indication)
    sni_hostname: Option<Box<[u8]>>,
    /// Set by `on_handshake`, for `receive` to retry the writes that were refused during the renegotiation.
    renegotiation_ended: Cell<bool>,
}

use bun_uws::MaybeAnySocket as SocketUnion;

impl WebSocketProxyTunnel {
    /// Initialize a new proxy tunnel with all required parameters
    pub(crate) fn init<const SSL: bool>(
        upgrade_client: UpgradeClientRef,
        socket: NewSocketHandler<SSL>,
        sni_hostname: &[u8],
    ) -> RefPtr<WebSocketProxyTunnel> {
        RefPtr::new(WebSocketProxyTunnel {
            ref_count: Cell::new(1),
            upgrade_client: Cell::new(Some(upgrade_client)),
            connected_websocket: Cell::new(None),
            wrapper: OnceCell::new(),
            socket: Cell::new(SocketUnion::from_generic(socket)),
            sni_hostname: Some(Box::<[u8]>::from(bun_http::strip_ipv6_brackets(
                sni_hostname,
            ))),
            renegotiation_ended: Cell::new(false),
        })
    }

    /// Start TLS handshake inside the tunnel
    pub(crate) fn start(
        self: &RefPtr<Self>,
        ctx: OwnedSslCtx,
        reject_unauthorized: bool,
        initial_data: &[u8],
    ) {
        let wrapper = SslWrapper::init_with_ctx(ctx, true);

        debug_assert!(self.wrapper.get().is_none(), "start() called twice");
        let wrapper = self.wrapper.get_or_init(|| wrapper);
        wrapper.enable_server_identity_check();
        // The inner connection's form of the `set_inline_reject` call in
        // `WebSocketUpgradeClient::handle_open`.
        if reject_unauthorized {
            wrapper.set_inline_reject();
        }
        let ssl = wrapper.ssl();

        // Configure SNI with hostname.
        //
        // This could live inside `onOpen`, which `SslWrapper::start()`
        // invokes immediately before `handle_traffic()`. We hoist it here so
        // the callback never has to read `wrapper` while `start()` holds
        // `&SslWrapper` across the `on_open` dispatch. The observable order vs
        // BoringSSL is identical: SNI is set on the `SSL*` before the handshake
        // is driven.
        if let Some(ssl_ptr) = ssl {
            if let Some(hostname) = self.sni_hostname.as_deref() {
                if !bun_core::ip_address::is_ip_host(hostname) {
                    // Set SNI hostname
                    let hostname_z = bun_core::ZBox::from_vec_with_nul(hostname.to_vec());
                    // Route through bun_http's
                    // tier-neutral helper which does SNI + ALPN(h1) (no
                    // verify-hostname — that is checked manually in
                    // `on_handshake`).
                    bun_http::configure_http_client_with_alpn(
                        // SAFETY: the new wrapper's live `SSL`, used for this one call.
                        unsafe { ssl_ptr.as_ref() },
                        Some(hostname_z.as_zstr().into()),
                        bun_http::AlpnOffer::H1,
                    );
                }
            }
        }

        if !initial_data.is_empty() {
            wrapper.start_with_payload(&mut &**self, initial_data);
        } else {
            wrapper.start(&mut &**self);
        }
    }
}

impl ssl_wrapper::Handler for &WebSocketProxyTunnel {
    /// SSLWrapper callback: the name check inside the handshake. The WebSocket decides.
    fn server_identity(
        &mut self,
        ssl: &mut bun_boringssl::c::SSL,
    ) -> bun_boringssl::ServerIdentity {
        match (self.upgrade_client(), self.sni_hostname.as_deref()) {
            (Some(upgrade_client), Some(hostname)) => {
                upgrade_client.tunnel_server_identity(ssl, hostname)
            }
            _ => bun_boringssl::ServerIdentity::Unchecked,
        }
    }

    /// SSLWrapper callback: Called before TLS handshake starts
    fn on_open(&mut self) {
        bun_core::scoped_log!(WebSocketProxyTunnel, "onOpen");
        // SNI configuration is done in `start()` before the wrapper is driven.
    }

    /// SSLWrapper callback: Called with decrypted data from the network
    fn on_data(&mut self, decrypted_data: &[u8]) {
        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "onData: {} bytes",
            decrypted_data.len()
        );
        if decrypted_data.is_empty() {
            return;
        }

        // If we have a connected WebSocket client, forward data to it
        if let Some(ws) = self.connected_websocket.cloned() {
            ws.handle_data(decrypted_data);
            return;
        }

        // Otherwise, forward to the upgrade client for WebSocket response processing
        if let Some(client) = self.upgrade_client() {
            client.handle_decrypted_data(decrypted_data);
        }
    }

    /// SSLWrapper callback: Called after TLS handshake completes
    fn on_handshake(&mut self, success: bool, ssl_error: us_bun_verify_error_t) {
        bun_core::scoped_log!(WebSocketProxyTunnel, "onHandshake: success={}", success);

        let Some(upgrade_client) = self.upgrade_client() else {
            self.renegotiation_ended.set(success);
            if !success && let Some(ws) = self.connected_websocket() {
                ws.report_tls_error(&ssl_error);
            }
            return;
        };

        if !success {
            upgrade_client.fail_tls(ssl_error, false);
            return;
        }

        let ssl = self
            .wrapper
            .get()
            .and_then(|w| w.ssl())
            // SAFETY: the wrapper's live `SSL`, done with before `tls.checkServerIdentity` runs.
            .map(|mut ssl| unsafe { ssl.as_mut() });
        let accepted = upgrade_client.accepts_tunnel_peer(
            ssl,
            ssl_error.error_no == 0,
            self.sni_hostname.as_deref().unwrap_or_default(),
        );
        // `tls.checkServerIdentity` may have closed the WebSocket, which detaches the client.
        let Some(upgrade_client) = self.upgrade_client() else {
            return;
        };
        if !accepted {
            upgrade_client.fail_tls(ssl_error, true);
            return;
        }

        // TLS handshake successful - notify client to send WebSocket upgrade
        upgrade_client.on_proxy_tls_handshake_complete();
    }

    /// SSLWrapper callback: Called when connection is closing
    fn on_close(&mut self) {
        bun_core::scoped_log!(WebSocketProxyTunnel, "onClose");

        // If we have a connected WebSocket client, notify it of the close
        if let Some(ws) = self.connected_websocket.cloned() {
            ws.handle_tunnel_close();
            return;
        }

        // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
        let Some(upgrade_client) = self.upgrade_client() else {
            return;
        };

        // Otherwise notify the upgrade client
        upgrade_client.terminate(ErrorCode::Ended);
    }

    /// SSLWrapper callback: Called with encrypted data to send to network
    fn write(&mut self, encrypted_data: &[u8]) -> usize {
        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "writeEncrypted: {} bytes",
            encrypted_data.len()
        );

        // A failed write took nothing: the wrapper tries again when the socket is writable.
        usize::try_from(self.socket.get().write(encrypted_data)).unwrap_or(0)
    }
}

impl bun_ptr::Detach for WebSocketProxyTunnel {
    /// Clear the connected WebSocket reference before tunnel shutdown so the
    /// tunnel's onClose callback doesn't call into a client that already finished.
    ///
    /// Can be reached from inside an SSLWrapper callback while the driving
    /// frame holds `&SslWrapper`; the `Cell` write covers only this field.
    fn detach(&self) {
        self.connected_websocket.set(None);
        self.shutdown();
    }
}

impl WebSocketProxyTunnel {
    fn upgrade_client(&self) -> Option<UpgradeClientRef> {
        self.upgrade_client.with_taken(|client| client.clone())
    }

    pub(crate) fn connected_websocket(&self) -> Option<RefPtr<WebSocketClient>> {
        self.connected_websocket.cloned()
    }

    /// Clear the upgrade client reference. Called before tunnel shutdown during
    /// cleanup so that the SSLWrapper's synchronous onHandshake/onClose callbacks
    /// do not re-enter the upgrade client's terminate/clearData path.
    pub(crate) fn detach_upgrade_client(&self) {
        self.upgrade_client.set(None);
        self.socket.set(SocketUnion::None);
    }

    /// Called when the socket becomes writable - flush buffered encrypted data
    pub(crate) fn on_writable(self: RefPtr<Self>) {
        // Sends what the socket refused.
        if let Some(w) = self.wrapper.get() {
            w.flush(&mut &*self);
        }
        if self.has_backpressure() {
            if let Some(ws) = self.connected_websocket.cloned() {
                ws.restart_close_timeout_while_sending();
            }
            return;
        }

        // Tunnel drained - let the connected WebSocket flush its send_buffer.
        if let Some(ws) = self.connected_websocket.cloned() {
            ws.handle_tunnel_writable();
        }
    }

    /// Feed encrypted data from the network to the SSL wrapper for decryption
    pub(crate) fn receive(self: RefPtr<Self>, data: &[u8]) {
        if let Some(w) = self.wrapper.get() {
            w.receive_data(&mut &*self, data);
        }
        // Only now, so that what this read decrypted is delivered first, like openssl.cpp's `ssl_write_wants_read`.
        if self.renegotiation_ended.take()
            && let Some(ws) = self.connected_websocket.cloned()
        {
            ws.handle_tunnel_writable();
        }
    }

    /// Write application data through the tunnel (will be encrypted)
    #[cold]
    pub(crate) fn write(self: RefPtr<Self>, data: &[u8]) -> crate::Result<usize> {
        if let Some(w) = self.wrapper.get() {
            return w
                .write_data(&mut &*self, data)
                .map_err(|_| crate::Error::ConnectionClosed);
        }
        Err(crate::Error::ConnectionClosed)
    }

    /// Gracefully shutdown the TLS connection. The caller holds a ref.
    pub(crate) fn shutdown(&self) {
        if let Some(w) = self.wrapper.get() {
            let _ = w.shutdown(&mut &*self, true); // Fast shutdown
        }
    }

    /// Half-close the TLS session inside the tunnel. Sends our close_notify and keeps reading
    /// until the peer's arrives, which fires `on_close`. The proxy connection stays open.
    pub(crate) fn end(self: RefPtr<Self>) {
        if let Some(w) = self.wrapper.get() {
            let _ = w.shutdown(&mut &*self, false);
        }
    }

    /// False once the proxy connection is closed. After that, `write` still accepts data but
    /// never sends it.
    pub(crate) fn has_socket(&self) -> bool {
        !matches!(self.socket.get(), SocketUnion::None)
    }

    pub(crate) fn remote_address(&self) -> Option<core::net::SocketAddr> {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.remote_endpoint(),
            SocketUnion::Ssl(s) => s.remote_endpoint(),
            SocketUnion::None => None,
        }
    }

    pub(crate) fn us_socket(&self) -> Option<*mut bun_uws_sys::us_socket_t> {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.socket.get(),
            SocketUnion::Ssl(s) => s.socket.get(),
            SocketUnion::None => None,
        }
    }

    /// Check if the tunnel has backpressure
    pub(crate) fn has_backpressure(&self) -> bool {
        self.buffered_amount() > 0
    }

    pub(crate) fn buffered_amount(&self) -> usize {
        self.wrapper.get().map_or(0, |w| w.refused_ciphertext())
    }

    pub(crate) fn pause_stream(&self) -> bool {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.pause_stream(),
            SocketUnion::Ssl(s) => s.pause_stream(),
            SocketUnion::None => false,
        }
    }

    pub(crate) fn resume_stream(self: RefPtr<Self>) -> bool {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.resume_stream(),
            SocketUnion::Ssl(s) => s.resume_stream(),
            SocketUnion::None => false,
        }
    }

    /// The upgrade client's `handle_timeout` closes the proxy connection.
    pub(crate) fn set_timeout(&self, seconds: core::ffi::c_uint) {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.set_timeout(seconds),
            SocketUnion::Ssl(s) => s.set_timeout(seconds),
            SocketUnion::None => {}
        }
    }

    /// Runs the upgrade client's `handle_close`, which drops its ref on the tunnel.
    pub(crate) fn close_socket(self: RefPtr<Self>, mode: CloseMode) {
        match self.socket.replace(SocketUnion::None) {
            SocketUnion::Tcp(s) => mode.close(s),
            SocketUnion::Ssl(s) => mode.close(s),
            SocketUnion::None => {}
        }
    }
}

// HOST_EXPORT(WebSocketProxyTunnel__setConnectedWebSocket, c)
pub fn set_connected_web_socket(
    tunnel: &crate::websocket_client::websocket_proxy_tunnel::WebSocketProxyTunnel,
    ws: RefPtr<crate::websocket_client::WebSocketClient>,
) {
    bun_core::scoped_log!(WebSocketProxyTunnel, "setConnectedWebSocket");
    tunnel.connected_websocket.set(Some(ws));
    // Clear the upgrade client reference since we're now in connected phase
    tunnel.upgrade_client.set(None);
}
