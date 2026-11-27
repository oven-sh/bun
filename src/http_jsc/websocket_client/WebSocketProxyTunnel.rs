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
//! All state mutated after construction lives in `Cell`/`JsCell` fields, and
//! `wrapper` is a write-once `OnceCell` set in `start()` before it is first
//! driven, so every access — from a driving entry or from a re-entered
//! callback — is a short shared borrow; no `&mut Self` is ever formed.
//!
//! `*WebSocketProxyTunnel` is freely aliased across callbacks.

use core::cell::{Cell, OnceCell};

use bun_io::StreamBuffer;
use bun_ptr::{CellExt, JsCell, RefPtr, RefPtrCellExt as _};
use bun_uws::ssl_wrapper::{self, SslWrapper};
use bun_uws::{NewSocketHandler, us_bun_verify_error_t};

use crate::websocket_client::{CloseMode, ErrorCode};

use bun_http::ssl_config::SslConfig;

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
    /// Write buffer for encrypted data (maintains TLS record ordering)
    write_buffer: JsCell<StreamBuffer>,
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
        // `assume_ssl`/`assume_tcp` rebuild the handler around the same
        // `InternalSocket`.
        let socket = if SSL {
            SocketUnion::Ssl(socket.assume_ssl())
        } else {
            SocketUnion::Tcp(socket.assume_tcp())
        };

        RefPtr::new(WebSocketProxyTunnel {
            ref_count: Cell::new(1),
            upgrade_client: Cell::new(Some(upgrade_client)),
            connected_websocket: Cell::new(None),
            wrapper: OnceCell::new(),
            socket: Cell::new(socket),
            write_buffer: JsCell::new(StreamBuffer::default()),
            sni_hostname: Some(Box::<[u8]>::from(bun_http::strip_ipv6_brackets(
                sni_hostname,
            ))),
            renegotiation_ended: Cell::new(false),
        })
    }

    /// Start TLS handshake inside the tunnel
    /// The ssl_options should contain all TLS configuration including CA certificates.
    pub(crate) fn start(
        self: &RefPtr<Self>,
        ssl_options: &SslConfig,
        reject_unauthorized: bool,
        initial_data: &[u8],
    ) -> crate::Result<()> {
        // Allow handshake to complete so we can access peer certificate for manual
        // hostname verification in onHandshake(). The actual reject_unauthorized
        // check is the WebSocket's: `CppWebSocket::accepts_tls_peer`.
        let options = ssl_options.for_client_verification();

        // tier-neutral `init_from_options` takes the lowered
        // `BunSocketContextOptions` (= what `SSLConfig.asUSockets()` produces);
        // the `SSLConfig`-taking `init` lives in bun_runtime.
        let wrapper = SslWrapper::init_from_options(&options.as_usockets(), true)
            .map_err(|_| crate::Error::InvalidOptions)?;

        debug_assert!(self.wrapper.get().is_none(), "start() called twice");
        let wrapper = self.wrapper.get_or_init(|| wrapper);
        // The inner connection's form of the `set_inline_reject` call in
        // `WebSocketUpgradeClient::handle_open`.
        if reject_unauthorized {
            wrapper.set_inline_reject();
        }
        let ssl = wrapper.ssl.get();

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
                    // `hostname_z` is a NUL-terminated owned buffer in scope.
                    bun_http::configure_http_client_with_alpn(
                        bun_opaque::opaque_deref_mut(ssl_ptr.as_ptr()),
                        hostname_z.as_ptr(),
                        bun_http::AlpnOffer::H1,
                    );
                    // hostname_z dropped here (owned NUL-terminated copy)
                }
            }
        }

        if !initial_data.is_empty() {
            wrapper.start_with_payload(&mut &**self, initial_data);
        } else {
            wrapper.start(&mut &**self);
        }
        Ok(())
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
            .and_then(|w| w.ssl.get())
            .map(|ssl| bun_opaque::opaque_deref_mut(ssl.as_ptr()));
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
    fn write(&mut self, encrypted_data: &[u8]) {
        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "writeEncrypted: {} bytes",
            encrypted_data.len()
        );

        // If data is already buffered, queue this to maintain TLS record ordering
        if self.write_buffer.get().is_not_empty() {
            bun_core::handle_oom(self.write_buffer.with_mut(|b| b.write(encrypted_data)));
            return;
        }

        // Try direct write to socket
        let written = self.socket.get().write(encrypted_data);
        if written < 0 {
            // Write failed - buffer data for retry when socket becomes writable
            bun_core::handle_oom(self.write_buffer.with_mut(|b| b.write(encrypted_data)));
            return;
        }

        // Buffer remaining data
        let written_usize = usize::try_from(written).expect("int cast");
        if written_usize < encrypted_data.len() {
            bun_core::handle_oom(
                self.write_buffer
                    .with_mut(|b| b.write(&encrypted_data[written_usize..])),
            );
        }
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
        // Flush the SSL state machine
        if let Some(w) = self.wrapper.get() {
            w.flush(&mut &*self);
        }

        // Send buffered encrypted data (`flush` above may have
        // appended to it). A raw uws socket write does not re-enter the tunnel.
        let still_backpressured = self.write_buffer.with_mut(|buf| {
            let to_send = buf.slice();
            if to_send.is_empty() {
                return false;
            }
            let to_send_len = to_send.len();
            let written = self.socket.get().write(to_send);
            if written < 0 {
                return true;
            }
            let written = usize::try_from(written).expect("int cast");
            if written == to_send_len {
                buf.reset();
                false
            } else {
                buf.wrote(written);
                true
            }
        });
        if still_backpressured {
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
        self.write_buffer.get().is_not_empty()
    }

    pub(crate) fn buffered_amount(&self) -> usize {
        self.write_buffer.get().size()
    }

    pub(crate) fn pause_stream(&self) -> bool {
        match self.socket.get() {
            SocketUnion::Tcp(s) => s.pause_stream(),
            SocketUnion::Ssl(s) => s.pause_stream(),
            SocketUnion::None => false,
        }
    }

    /// Closes the socket if it cannot register the poll again.
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
