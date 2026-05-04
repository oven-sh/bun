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

use core::cell::Cell;
use core::ffi::c_int;
use core::ptr;

use bun_boringssl as boringssl;
use bun_io::StreamBuffer;
use bun_ptr::IntrusiveRc;
use bun_runtime::socket::ssl_wrapper::SslWrapper;
use bun_str::{strings, ZStr};
use bun_uws::NewSocketHandler;
use bun_uws_sys::us_bun_verify_error_t;

use crate::websocket_client::ErrorCode;
use super::web_socket_upgrade_client::{HttpUpgradeClient, HttpsUpgradeClient, NewHttpUpgradeClient};

// TODO(port): verify exact module path for SSLConfig (jsc.API.ServerConfig.SSLConfig in Zig)
use bun_runtime::api::server_config::SslConfig;

bun_output::declare_scope!(WebSocketProxyTunnel, visible);

/// Union type for upgrade client to maintain type safety.
/// The upgrade client can be either HTTP or HTTPS depending on the proxy connection.
pub enum UpgradeClientUnion {
    Http(*mut HttpUpgradeClient),
    Https(*mut HttpsUpgradeClient),
    None,
}

impl UpgradeClientUnion {
    pub fn handle_decrypted_data(&self, data: &[u8]) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe { (**client).handle_decrypted_data(data) },
            UpgradeClientUnion::Https(client) => unsafe { (**client).handle_decrypted_data(data) },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn terminate(&self, code: ErrorCode) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe { (**client).terminate(code) },
            UpgradeClientUnion::Https(client) => unsafe { (**client).terminate(code) },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn on_proxy_tls_handshake_complete(&self) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe { (**client).on_proxy_tls_handshake_complete() },
            UpgradeClientUnion::Https(client) => unsafe { (**client).on_proxy_tls_handshake_complete() },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, UpgradeClientUnion::None)
    }
}

type WebSocketClient = crate::websocket_client::NewWebSocketClient<false>;

pub struct WebSocketProxyTunnel {
    ref_count: Cell<u32>,
    /// Reference to the upgrade client (WebSocketUpgradeClient) - used during handshake phase
    upgrade_client: UpgradeClientUnion,
    /// Reference to the connected WebSocket client - used after successful upgrade
    connected_websocket: *mut WebSocketClient,
    /// SSL wrapper for TLS inside tunnel
    wrapper: Option<SslWrapperType>,
    /// Socket reference (the proxy connection)
    socket: SocketUnion,
    /// Write buffer for encrypted data (maintains TLS record ordering)
    write_buffer: StreamBuffer,
    /// Hostname for SNI (Server Name Indication)
    sni_hostname: Option<Box<[u8]>>,
    /// Whether to reject unauthorized certificates
    reject_unauthorized: bool,
}

enum SocketUnion {
    Tcp(NewSocketHandler<false>),
    Ssl(NewSocketHandler<true>),
    None,
}

impl SocketUnion {
    pub fn write(&self, data: &[u8]) -> c_int {
        match self {
            SocketUnion::Tcp(s) => s.write(data),
            SocketUnion::Ssl(s) => s.write(data),
            SocketUnion::None => 0,
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            SocketUnion::Tcp(s) => s.is_closed(),
            SocketUnion::Ssl(s) => s.is_closed(),
            SocketUnion::None => true,
        }
    }
}

type SslWrapperType = SslWrapper<*mut WebSocketProxyTunnel>;

impl WebSocketProxyTunnel {
    // Intrusive refcount (bun.ptr.RefCount) — ref/deref delegate to IntrusiveRc machinery.
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: ref_count hit zero; self was allocated via Box::into_raw in `init`.
            // Drop impl handles field cleanup; Box::from_raw frees the allocation.
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }

    /// RAII guard mirroring `this.ref(); defer this.deref();`
    fn ref_scope(&self) -> impl Drop + '_ {
        self.ref_();
        scopeguard::guard((), move |_| self.deref())
        // PORT NOTE: reshaped for borrowck — Zig pattern is ref()+defer deref()
    }

    /// Initialize a new proxy tunnel with all required parameters
    pub fn init<const SSL: bool>(
        upgrade_client: *mut NewHttpUpgradeClient<SSL>,
        socket: NewSocketHandler<SSL>,
        sni_hostname: &[u8],
        reject_unauthorized: bool,
    ) -> Result<IntrusiveRc<WebSocketProxyTunnel>, bun_alloc::AllocError> {
        // TODO(port): const-generic bool → variant selection requires pointer casts in stable Rust;
        // these casts are identity when SSL matches the alias (HttpUpgradeClient = NewHttpUpgradeClient<false>, etc).
        let (upgrade_client, socket) = if SSL {
            (
                UpgradeClientUnion::Https(upgrade_client.cast::<HttpsUpgradeClient>()),
                // SAFETY: NewSocketHandler<true> when SSL == true; transmute is identity
                SocketUnion::Ssl(unsafe { core::mem::transmute_copy(&socket) }),
            )
        } else {
            (
                UpgradeClientUnion::Http(upgrade_client.cast::<HttpUpgradeClient>()),
                // SAFETY: NewSocketHandler<false> when SSL == false; transmute is identity
                SocketUnion::Tcp(unsafe { core::mem::transmute_copy(&socket) }),
            )
        };

        let boxed = Box::new(WebSocketProxyTunnel {
            ref_count: Cell::new(1),
            upgrade_client,
            connected_websocket: ptr::null_mut(),
            wrapper: None,
            socket,
            write_buffer: StreamBuffer::default(),
            sni_hostname: Some(Box::<[u8]>::from(sni_hostname)),
            reject_unauthorized,
        });
        // SAFETY: ref_count initialized to 1; IntrusiveRc takes ownership of the Box allocation.
        Ok(unsafe { IntrusiveRc::from_box(boxed) })
    }

    /// Start TLS handshake inside the tunnel
    /// The ssl_options should contain all TLS configuration including CA certificates.
    pub fn start(&mut self, ssl_options: SslConfig, initial_data: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Allow handshake to complete so we can access peer certificate for manual
        // hostname verification in onHandshake(). The actual reject_unauthorized
        // check uses self.reject_unauthorized field.
        let options = ssl_options.for_client_verification();

        self.wrapper = Some(SslWrapperType::init(
            options,
            true,
            SslWrapperType::Handlers {
                ctx: self as *mut Self,
                on_open: Self::on_open,
                on_data: Self::on_data,
                on_handshake: Self::on_handshake,
                on_close: Self::on_close,
                write: Self::write_encrypted,
            },
        )?);

        if !initial_data.is_empty() {
            self.wrapper.as_mut().unwrap().start_with_payload(initial_data);
        } else {
            self.wrapper.as_mut().unwrap().start();
        }
        Ok(())
    }

    /// SSLWrapper callback: Called before TLS handshake starts
    fn on_open(this: *mut WebSocketProxyTunnel) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { &mut *this };
        let _guard = this.ref_scope();

        bun_output::scoped_log!(WebSocketProxyTunnel, "onOpen");
        // Configure SNI with hostname
        if let Some(wrapper) = this.wrapper.as_mut() {
            if let Some(ssl_ptr) = wrapper.ssl {
                if let Some(hostname) = this.sni_hostname.as_deref() {
                    if !strings::is_ip_address(hostname) {
                        // Set SNI hostname
                        let Ok(hostname_z) = ZStr::from_bytes(hostname) else { return };
                        ssl_ptr.configure_http_client(&hostname_z);
                        // hostname_z dropped here (owned NUL-terminated copy)
                    }
                }
            }
        }
    }

    /// SSLWrapper callback: Called with decrypted data from the network
    fn on_data(this: *mut WebSocketProxyTunnel, decrypted_data: &[u8]) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { &mut *this };
        let _guard = this.ref_scope();

        bun_output::scoped_log!(WebSocketProxyTunnel, "onData: {} bytes", decrypted_data.len());
        if decrypted_data.is_empty() {
            return;
        }

        // If we have a connected WebSocket client, forward data to it
        if !this.connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            unsafe { (*this.connected_websocket).handle_tunnel_data(decrypted_data) };
            return;
        }

        // Otherwise, forward to the upgrade client for WebSocket response processing
        this.upgrade_client.handle_decrypted_data(decrypted_data);
    }

    /// SSLWrapper callback: Called after TLS handshake completes
    fn on_handshake(this: *mut WebSocketProxyTunnel, success: bool, ssl_error: us_bun_verify_error_t) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { &mut *this };
        let _guard = this.ref_scope();

        bun_output::scoped_log!(WebSocketProxyTunnel, "onHandshake: success={}", success);

        if this.upgrade_client.is_none() {
            return;
        }

        if !success {
            this.upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
            return;
        }

        // Check for SSL errors if we need to reject unauthorized
        if this.reject_unauthorized {
            if ssl_error.error_no != 0 {
                this.upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
                return;
            }

            // Verify server identity
            if let Some(wrapper) = this.wrapper.as_ref() {
                if let Some(ssl_ptr) = wrapper.ssl {
                    if let Some(hostname) = this.sni_hostname.as_deref() {
                        if !boringssl::check_server_identity(ssl_ptr, hostname) {
                            this.upgrade_client.terminate(ErrorCode::TlsHandshakeFailed);
                            return;
                        }
                    }
                }
            }
        }

        // TLS handshake successful - notify client to send WebSocket upgrade
        this.upgrade_client.on_proxy_tls_handshake_complete();
    }

    /// SSLWrapper callback: Called when connection is closing
    fn on_close(this: *mut WebSocketProxyTunnel) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { &mut *this };
        let _guard = this.ref_scope();

        bun_output::scoped_log!(WebSocketProxyTunnel, "onClose");

        // If we have a connected WebSocket client, notify it of the close
        if !this.connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            unsafe { (*this.connected_websocket).fail(ErrorCode::Ended) };
            return;
        }

        // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
        if this.upgrade_client.is_none() {
            return;
        }

        // Otherwise notify the upgrade client
        this.upgrade_client.terminate(ErrorCode::Ended);
    }

    /// Set the connected WebSocket client. Called after successful WebSocket upgrade.
    /// This transitions the tunnel from upgrade phase to connected phase.
    /// After calling this, decrypted data will be forwarded to the WebSocket client.
    pub fn set_connected_web_socket(&mut self, ws: *mut WebSocketClient) {
        bun_output::scoped_log!(WebSocketProxyTunnel, "setConnectedWebSocket");
        self.connected_websocket = ws;
        // Clear the upgrade client reference since we're now in connected phase
        self.upgrade_client = UpgradeClientUnion::None;
    }

    /// Clear the connected WebSocket reference. Called before tunnel shutdown during
    /// a clean close so the tunnel's onClose callback doesn't dispatch a spurious
    /// abrupt close (1006) after the WebSocket has already sent a clean close frame.
    pub fn clear_connected_web_socket(&mut self) {
        self.connected_websocket = ptr::null_mut();
    }

    /// Clear the upgrade client reference. Called before tunnel shutdown during
    /// cleanup so that the SSLWrapper's synchronous onHandshake/onClose callbacks
    /// do not re-enter the upgrade client's terminate/clearData path.
    pub fn detach_upgrade_client(&mut self) {
        self.upgrade_client = UpgradeClientUnion::None;
    }

    /// SSLWrapper callback: Called with encrypted data to send to network
    fn write_encrypted(this: *mut WebSocketProxyTunnel, encrypted_data: &[u8]) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { &mut *this };
        bun_output::scoped_log!(WebSocketProxyTunnel, "writeEncrypted: {} bytes", encrypted_data.len());

        // If data is already buffered, queue this to maintain TLS record ordering
        if this.write_buffer.is_not_empty() {
            this.write_buffer.write(encrypted_data);
            return;
        }

        // Try direct write to socket
        let written = this.socket.write(encrypted_data);
        if written < 0 {
            // Write failed - buffer data for retry when socket becomes writable
            this.write_buffer.write(encrypted_data);
            return;
        }

        // Buffer remaining data
        let written_usize = usize::try_from(written).unwrap();
        if written_usize < encrypted_data.len() {
            this.write_buffer.write(&encrypted_data[written_usize..]);
        }
    }

    /// Called when the socket becomes writable - flush buffered encrypted data
    pub fn on_writable(&mut self) {
        let _guard = self.ref_scope();

        // Flush the SSL state machine
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.flush();
        }

        // Send buffered encrypted data
        let to_send = self.write_buffer.slice();
        if !to_send.is_empty() {
            // PORT NOTE: reshaped for borrowck — capture len before re-borrowing write_buffer
            let to_send_len = to_send.len();
            let written = self.socket.write(to_send);
            if written < 0 {
                return;
            }

            let written_usize = usize::try_from(written).unwrap();
            if written_usize == to_send_len {
                self.write_buffer.reset();
            } else {
                self.write_buffer.cursor += written_usize;
                return; // still have backpressure
            }
        }

        // Tunnel drained - let the connected WebSocket flush its send_buffer
        if !self.connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            unsafe { (*self.connected_websocket).handle_tunnel_writable() };
        }
    }

    /// Feed encrypted data from the network to the SSL wrapper for decryption
    pub fn receive(&mut self, data: &[u8]) {
        let _guard = self.ref_scope();

        if let Some(wrapper) = self.wrapper.as_mut() {
            wrapper.receive_data(data);
        }
    }

    /// Write application data through the tunnel (will be encrypted)
    pub fn write(&mut self, data: &[u8]) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(wrapper) = self.wrapper.as_mut() {
            return wrapper.write_data(data);
        }
        Err(bun_core::err!("ConnectionClosed"))
    }

    /// Gracefully shutdown the TLS connection
    pub fn shutdown(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown(true); // Fast shutdown
        }
    }

    /// Check if the tunnel has backpressure
    pub fn has_backpressure(&self) -> bool {
        self.write_buffer.is_not_empty()
    }
}

impl Drop for WebSocketProxyTunnel {
    fn drop(&mut self) {
        // Field cleanup is automatic: wrapper (Option<SslWrapper>), write_buffer (StreamBuffer),
        // sni_hostname (Option<Box<[u8]>>) all impl Drop. The Zig deinit's `bun.destroy(this)`
        // is handled by IntrusiveRc / `deref()` via Box::from_raw.
    }
}

/// C export for setting the connected WebSocket client from C++
#[unsafe(no_mangle)]
pub extern "C" fn WebSocketProxyTunnel__setConnectedWebSocket(
    tunnel: *mut WebSocketProxyTunnel,
    ws: *mut WebSocketClient,
) {
    // SAFETY: called from C++ with a live tunnel pointer
    unsafe { (*tunnel).set_connected_web_socket(ws) };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client/WebSocketProxyTunnel.zig (371 lines)
//   confidence: medium
//   todos:      3
//   notes:      const-generic SSL bool → variant dispatch in init() uses transmute_copy (identity at monomorphization); ref_scope guard borrows &self while body needs &mut — Phase B may need raw-ptr ref/deref; SslConfig/SslWrapper import paths need verification
// ──────────────────────────────────────────────────────────────────────────
