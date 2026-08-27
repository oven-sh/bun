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
//! synchronously re-enters this struct through the `ctx` backref via
//! `on_open`/`on_data`/`on_handshake`/`on_close`/`write_encrypted`.
//!
//! All state mutated after construction lives in `Cell`/`JsCell` fields, and
//! `wrapper` is a write-once `OnceCell` set in `start()` before it is first
//! driven, so every access — from a driving entry or from a re-entered
//! callback — is a short shared borrow; no `&mut Self` is ever formed.
//!
//! `*WebSocketProxyTunnel` is freely aliased across callbacks.

use core::cell::{Cell, OnceCell};

use bun_boringssl as boringssl;
use bun_io::StreamBuffer;
use bun_ptr::{BackRef, JsCell, RefPtr, Root, ThisPtr};
use bun_uws::ssl_wrapper::{Handlers as SslHandlers, SslWrapper};
use bun_uws::{NewSocketHandler, us_bun_verify_error_t};

use crate::websocket_client::ErrorCode;

use bun_http::ssl_config::SslConfig;

bun_core::declare_scope!(WebSocketProxyTunnel, visible);

use super::websocket_upgrade_client::{HttpUpgradeClient, HttpsUpgradeClient};

/// Back-reference to the upgrade client (either transport). The client clears
/// it (`detach_upgrade_client`, from `clear_data`) before it can be freed.
///
/// `Copy` so callbacks can snapshot the value and dispatch on the copy without
/// holding a borrow of the tunnel across the re-entrant call.
#[derive(Clone, Copy)]
pub enum UpgradeClientRef {
    Http(BackRef<HttpUpgradeClient, Root>),
    Https(BackRef<HttpsUpgradeClient, Root>),
}

/// Builds the [`UpgradeClientRef`] variant for a concrete `HTTPClient<SSL>`.
pub trait IntoUpgradeClientRef: Sized {
    fn upgrade_client_ref(this: ThisPtr<Self>) -> UpgradeClientRef;
}
impl IntoUpgradeClientRef for HttpUpgradeClient {
    fn upgrade_client_ref(this: ThisPtr<Self>) -> UpgradeClientRef {
        UpgradeClientRef::Http(this.into())
    }
}
impl IntoUpgradeClientRef for HttpsUpgradeClient {
    fn upgrade_client_ref(this: ThisPtr<Self>) -> UpgradeClientRef {
        UpgradeClientRef::Https(this.into())
    }
}

impl UpgradeClientRef {
    fn dispatch(
        self,
        http: impl FnOnce(ThisPtr<HttpUpgradeClient>),
        https: impl FnOnce(ThisPtr<HttpsUpgradeClient>),
    ) {
        match self {
            UpgradeClientRef::Http(client) => http(client.this_ptr()),
            UpgradeClientRef::Https(client) => https(client.this_ptr()),
        }
    }

    fn handle_decrypted_data(self, data: &[u8]) {
        self.dispatch(
            |c| HttpUpgradeClient::handle_decrypted_data(c, data),
            |c| HttpsUpgradeClient::handle_decrypted_data(c, data),
        );
    }

    fn terminate(self, code: ErrorCode) {
        self.dispatch(
            |c| HttpUpgradeClient::terminate(c, code),
            |c| HttpsUpgradeClient::terminate(c, code),
        );
    }

    fn on_proxy_tls_handshake_complete(self) {
        self.dispatch(
            HttpUpgradeClient::on_proxy_tls_handshake_complete,
            HttpsUpgradeClient::on_proxy_tls_handshake_complete,
        );
    }
}

type WebSocketClient = crate::websocket_client::WebSocket<false>;

#[derive(bun_ptr::CellRefCounted)]
pub struct WebSocketProxyTunnel {
    ref_count: Cell<u32>,
    /// Reference to the upgrade client (WebSocketUpgradeClient) - used during handshake phase
    upgrade_client: Cell<Option<UpgradeClientRef>>,
    /// Back-reference to the connected WebSocket client - used after
    /// successful upgrade. The client clears it (`clear_connected_web_socket`)
    /// before it can be freed.
    connected_websocket: Cell<Option<BackRef<WebSocketClient, Root>>>,
    /// SSL wrapper for TLS inside tunnel; set once in `start()`.
    wrapper: OnceCell<SslWrapperType>,
    /// Socket reference (the proxy connection)
    socket: SocketUnion,
    /// Write buffer for encrypted data (maintains TLS record ordering)
    write_buffer: JsCell<StreamBuffer>,
    /// Hostname for SNI (Server Name Indication)
    sni_hostname: Option<Box<[u8]>>,
    /// Whether to reject unauthorized certificates
    reject_unauthorized: bool,
}

use bun_uws::MaybeAnySocket as SocketUnion;

type SslWrapperType = SslWrapper<ThisPtr<WebSocketProxyTunnel>>;

impl WebSocketProxyTunnel {
    /// Initialize a new proxy tunnel with all required parameters
    pub(crate) fn init<const SSL: bool>(
        upgrade_client: UpgradeClientRef,
        socket: NewSocketHandler<SSL>,
        sni_hostname: &[u8],
        reject_unauthorized: bool,
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
            socket,
            write_buffer: JsCell::new(StreamBuffer::default()),
            sni_hostname: Some(Box::<[u8]>::from(bun_http::strip_ipv6_brackets(
                sni_hostname,
            ))),
            reject_unauthorized,
        })
    }

    /// Start TLS handshake inside the tunnel
    /// The ssl_options should contain all TLS configuration including CA certificates.
    ///
    /// Takes `ThisPtr<Self>` because `start*()` synchronously invokes
    /// `on_open(ctx)` / `on_handshake(ctx)`, which may terminate the upgrade
    /// client.
    pub(crate) fn start(
        this: ThisPtr<Self>,
        ssl_options: &SslConfig,
        initial_data: &[u8],
    ) -> crate::Result<()> {
        // Allow handshake to complete so we can access peer certificate for manual
        // hostname verification in onHandshake(). The actual reject_unauthorized
        // check uses self.reject_unauthorized field.
        let options = ssl_options.for_client_verification();

        // tier-neutral `init_from_options` takes the lowered
        // `BunSocketContextOptions` (= what `SSLConfig.asUSockets()` produces);
        // the `SSLConfig`-taking `init` lives in bun_runtime.
        let wrapper = SslWrapperType::init_from_options(
            &options.as_usockets(),
            true,
            SslHandlers {
                ctx: this,
                on_open: Self::on_open,
                on_data: Self::on_data,
                on_handshake: Self::on_handshake,
                on_close: Self::on_close,
                write: Self::write_encrypted,
                // No JS TLSSocket fronts the tunnel; opting out keeps the
                // SSL off the parked session/keylog queues entirely.
                on_session: None,
                on_keylog: None,
            },
        )
        .map_err(|_| crate::Error::InvalidOptions)?;

        debug_assert!(this.wrapper.get().is_none(), "start() called twice");
        let wrapper = this.wrapper.get_or_init(|| wrapper);
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
            if let Some(hostname) = this.sni_hostname.as_deref() {
                if !bun_core::ip_address::is_ip_address(hostname) {
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

        // `start*()` synchronously fires `on_open(ctx)` / `write_encrypted(ctx)`
        // / etc.; those callbacks mutate only `Cell`/`JsCell` fields.
        if !initial_data.is_empty() {
            wrapper.start_with_payload(initial_data);
        } else {
            wrapper.start();
        }
        Ok(())
    }

    /// SSLWrapper callback: Called before TLS handshake starts
    fn on_open(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        bun_core::scoped_log!(WebSocketProxyTunnel, "onOpen");
        // SNI configuration is done in `start()` before the wrapper is driven.
    }

    /// SSLWrapper callback: Called with decrypted data from the network
    fn on_data(this: ThisPtr<Self>, decrypted_data: &[u8]) {
        let _guard = RefPtr::from_this(this);

        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "onData: {} bytes",
            decrypted_data.len()
        );
        if decrypted_data.is_empty() {
            return;
        }

        // Snapshot backref pointers; the dispatch below may re-enter
        // `tunnel.write/shutdown/clear_connected_web_socket/detach_upgrade_client`,
        // so no borrow of `*this` may be live across it.
        let (connected_websocket, upgrade_client) =
            (this.connected_websocket.get(), this.upgrade_client.get());

        // If we have a connected WebSocket client, forward data to it
        if let Some(ws) = connected_websocket {
            WebSocketClient::handle_tunnel_data(ws.this_ptr(), decrypted_data);
            return;
        }

        // Otherwise, forward to the upgrade client for WebSocket response processing
        if let Some(client) = upgrade_client {
            client.handle_decrypted_data(decrypted_data);
        }
    }

    /// SSLWrapper callback: Called after TLS handshake completes
    fn on_handshake(this: ThisPtr<Self>, success: bool, ssl_error: us_bun_verify_error_t) {
        let _guard = RefPtr::from_this(this);

        bun_core::scoped_log!(WebSocketProxyTunnel, "onHandshake: success={}", success);

        // Snapshot the fields we need; `terminate()` / `on_proxy_tls_handshake_complete()`
        // re-enter `tunnel.detach_upgrade_client()` / `tunnel.write()`, so no borrow of
        // `*this` may span the dispatch.
        let (upgrade_client, reject_unauthorized) =
            (this.upgrade_client.get(), this.reject_unauthorized);

        let Some(upgrade_client) = upgrade_client else {
            return;
        };

        if !success {
            upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
            return;
        }

        // Check for SSL errors if we need to reject unauthorized
        if reject_unauthorized {
            if ssl_error.error_no != 0 {
                upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
                return;
            }

            // Verify server identity.
            let ssl = this.wrapper.get().and_then(|w| w.ssl.get());
            let failed_identity = match (ssl, this.sni_hostname.as_deref()) {
                (Some(ssl_ptr), Some(hostname)) => !boringssl::check_server_identity(
                    bun_opaque::opaque_deref_mut(ssl_ptr.as_ptr()),
                    hostname,
                ),
                _ => false,
            };
            if failed_identity {
                upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
                return;
            }
        }

        // TLS handshake successful - notify client to send WebSocket upgrade
        upgrade_client.on_proxy_tls_handshake_complete();
    }

    /// SSLWrapper callback: Called when connection is closing
    fn on_close(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);

        bun_core::scoped_log!(WebSocketProxyTunnel, "onClose");

        // Snapshot backref pointers; `fail()`/`terminate()` re-enter
        // `tunnel.clear_connected_web_socket()` / `tunnel.shutdown()` /
        // `tunnel.detach_upgrade_client()`, so no borrow of `*this` may span them.
        let (connected_websocket, upgrade_client) =
            (this.connected_websocket.get(), this.upgrade_client.get());

        // If we have a connected WebSocket client, notify it of the close
        if let Some(ws) = connected_websocket {
            let ws = ws.this_ptr();
            let _guard = RefPtr::from_this(ws);
            ws.fail(ErrorCode::Ended);
            return;
        }

        // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
        let Some(upgrade_client) = upgrade_client else {
            return;
        };

        // Otherwise notify the upgrade client
        upgrade_client.terminate(ErrorCode::Ended);
    }

    /// Clear the connected WebSocket reference. Called before tunnel shutdown during
    /// a clean close so the tunnel's onClose callback doesn't dispatch a spurious
    /// abrupt close (1006) after the WebSocket has already sent a clean close frame.
    ///
    /// Can be reached from inside an SSLWrapper callback while the driving
    /// frame holds `&SslWrapper`; the `Cell` write covers only this field.
    pub(crate) fn clear_connected_web_socket(&self) {
        self.connected_websocket.set(None);
    }

    /// Clear the upgrade client reference. Called before tunnel shutdown during
    /// cleanup so that the SSLWrapper's synchronous onHandshake/onClose callbacks
    /// do not re-enter the upgrade client's terminate/clearData path.
    pub(crate) fn detach_upgrade_client(&self) {
        self.upgrade_client.set(None);
    }

    /// SSLWrapper callback: Called with encrypted data to send to network
    fn write_encrypted(this: ThisPtr<Self>, encrypted_data: &[u8]) {
        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "writeEncrypted: {} bytes",
            encrypted_data.len()
        );

        // If data is already buffered, queue this to maintain TLS record ordering
        if this.write_buffer.get().is_not_empty() {
            bun_core::handle_oom(this.write_buffer.with_mut(|b| b.write(encrypted_data)));
            return;
        }

        // Try direct write to socket
        let written = this.socket.write(encrypted_data);
        if written < 0 {
            // Write failed - buffer data for retry when socket becomes writable
            bun_core::handle_oom(this.write_buffer.with_mut(|b| b.write(encrypted_data)));
            return;
        }

        // Buffer remaining data
        let written_usize = usize::try_from(written).expect("int cast");
        if written_usize < encrypted_data.len() {
            bun_core::handle_oom(
                this.write_buffer
                    .with_mut(|b| b.write(&encrypted_data[written_usize..])),
            );
        }
    }

    /// Called when the socket becomes writable - flush buffered encrypted data
    ///
    /// Takes `ThisPtr<Self>` because `flush()` fires `write_encrypted(ctx)` and
    /// `handle_tunnel_writable()` re-enters `tunnel.write()`, either of which
    /// can reach a close path that drops a ref on the tunnel.
    pub(crate) fn on_writable(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);

        // Flush the SSL state machine; no borrow of `*this` other than
        // `wrapper` spans the synchronous `write_encrypted` re-entry.
        if let Some(w) = this.wrapper.get() {
            let _ = w.flush();
        }

        // Send buffered encrypted data (`write_encrypted` above may have
        // appended to it). A raw uws socket write does not re-enter the tunnel.
        let still_backpressured = this.write_buffer.with_mut(|buf| {
            let to_send = buf.slice();
            if to_send.is_empty() {
                return false;
            }
            let to_send_len = to_send.len();
            let written = this.socket.write(to_send);
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
            return;
        }

        // Tunnel drained - let the connected WebSocket flush its send_buffer.
        // `handle_tunnel_writable()` re-enters `tunnel.write()`; snapshot the pointer
        // into a local so no borrow of `*this` is active across the dispatch.
        if let Some(ws) = this.connected_websocket.get() {
            WebSocketClient::handle_tunnel_writable(ws.this_ptr());
        }
    }

    /// Feed encrypted data from the network to the SSL wrapper for decryption
    ///
    /// Takes `ThisPtr<Self>` because `receive_data()` synchronously dispatches
    /// `on_data`/`on_handshake`/`on_close`/`write_encrypted`, which can reach a
    /// close path that drops a ref on the tunnel.
    pub(crate) fn receive(this: ThisPtr<Self>, data: &[u8]) {
        let _guard = RefPtr::from_this(this);

        if let Some(w) = this.wrapper.get() {
            w.receive_data(data);
        }
    }

    /// Write application data through the tunnel (will be encrypted)
    ///
    /// Takes `ThisPtr<Self>` because `write_data()` fires `write_encrypted(ctx)`
    /// and may fire `on_handshake(ctx)`/`on_close(ctx)`.
    pub(crate) fn write(this: ThisPtr<Self>, data: &[u8]) -> crate::Result<usize> {
        // The caller's ref (the client's `proxy`/`proxy_tunnel` field) can be
        // released from inside `write_data` via `on_close`; keep `w` alive.
        let _guard = RefPtr::from_this(this);
        if let Some(w) = this.wrapper.get() {
            return w
                .write_data(data)
                .map_err(|_| crate::Error::ConnectionClosed);
        }
        Err(crate::Error::ConnectionClosed)
    }

    /// Gracefully shutdown the TLS connection
    ///
    /// Takes `ThisPtr<Self>` because `shutdown()` may fire
    /// `on_close(ctx)`/`write_encrypted(ctx)`.
    pub(crate) fn shutdown(this: ThisPtr<Self>) {
        let _guard = RefPtr::from_this(this);
        if let Some(w) = this.wrapper.get() {
            let _ = w.shutdown(true); // Fast shutdown
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
        match &self.socket {
            SocketUnion::Tcp(s) => s.pause_stream(),
            SocketUnion::Ssl(s) => s.pause_stream(),
            SocketUnion::None => false,
        }
    }

    pub(crate) fn resume_stream(&self) -> bool {
        match &self.socket {
            SocketUnion::Tcp(s) => s.resume_stream(),
            SocketUnion::Ssl(s) => s.resume_stream(),
            SocketUnion::None => false,
        }
    }
}

// HOST_EXPORT(WebSocketProxyTunnel__setConnectedWebSocket, c)
pub fn set_connected_web_socket(
    tunnel: &crate::websocket_client::websocket_proxy_tunnel::WebSocketProxyTunnel,
    ws: Option<bun_ptr::ThisPtr<crate::websocket_client::WebSocketClient>>,
) {
    bun_core::scoped_log!(WebSocketProxyTunnel, "setConnectedWebSocket");
    tunnel.connected_websocket.set(ws.map(BackRef::from));
    // Clear the upgrade client reference since we're now in connected phase
    tunnel.upgrade_client.set(None);
}
