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
use core::ptr;
use core::ptr::NonNull;

use bun_boringssl as boringssl;
use bun_io::StreamBuffer;
use bun_ptr::{JsCell, ThisPtr};
use bun_uws::ssl_wrapper::{Handlers as SslHandlers, SslWrapper};
use bun_uws::{NewSocketHandler, us_bun_verify_error_t};

use super::websocket_upgrade_client::{
    HttpUpgradeClient, HttpsUpgradeClient, NewHttpUpgradeClient,
};
use crate::websocket_client::ErrorCode;

use bun_http::ssl_config::SslConfig;

bun_core::declare_scope!(WebSocketProxyTunnel, visible);

/// Union type for upgrade client to maintain type safety.
/// The upgrade client can be either HTTP or HTTPS depending on the proxy connection.
///
/// `Copy` so callbacks can snapshot the value and dispatch on the copy without
/// holding a borrow of the tunnel across the re-entrant call.
#[derive(Clone, Copy)]
pub(crate) enum UpgradeClientUnion {
    Http(*mut HttpUpgradeClient),
    Https(*mut HttpsUpgradeClient),
    None,
}

impl UpgradeClientUnion {
    fn dispatch(
        self,
        http: impl FnOnce(ThisPtr<HttpUpgradeClient>),
        https: impl FnOnce(ThisPtr<HttpsUpgradeClient>),
    ) {
        // The upgrade client resets this to `None` (`detach_upgrade_client`,
        // from `clear_data`) before it can be freed, so a non-`None` variant
        // points at a live client for the duration of this call.
        match self {
            // SAFETY: see above.
            UpgradeClientUnion::Http(client) => http(unsafe { ThisPtr::new(client) }),
            // SAFETY: see above.
            UpgradeClientUnion::Https(client) => https(unsafe { ThisPtr::new(client) }),
            UpgradeClientUnion::None => {}
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

    fn is_none(&self) -> bool {
        matches!(self, UpgradeClientUnion::None)
    }
}

type WebSocketClient = crate::websocket_client::WebSocket<false>;

#[derive(bun_ptr::CellRefCounted)]
pub struct WebSocketProxyTunnel {
    ref_count: Cell<u32>,
    /// Reference to the upgrade client (WebSocketUpgradeClient) - used during handshake phase
    upgrade_client: Cell<UpgradeClientUnion>,
    /// Reference to the connected WebSocket client - used after successful upgrade
    connected_websocket: Cell<*mut WebSocketClient>,
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

type SslWrapperType = SslWrapper<*mut WebSocketProxyTunnel>;

impl WebSocketProxyTunnel {
    /// Initialize a new proxy tunnel with all required parameters
    pub(crate) fn init<const SSL: bool>(
        upgrade_client: ThisPtr<NewHttpUpgradeClient<SSL>>,
        socket: NewSocketHandler<SSL>,
        sni_hostname: &[u8],
        reject_unauthorized: bool,
    ) -> Result<NonNull<WebSocketProxyTunnel>, bun_alloc::AllocError> {
        // const-generic bool → variant selection. The pointer cast is
        // identity when SSL matches the alias (HttpUpgradeClient = NewHttpUpgradeClient<false>,
        // etc); `assume_ssl`/`assume_tcp` rebuild the handler around the same
        // `InternalSocket` so no `unsafe` is needed.
        let (upgrade_client, socket) = if SSL {
            (
                UpgradeClientUnion::Https(upgrade_client.as_ptr().cast::<HttpsUpgradeClient>()),
                SocketUnion::Ssl(socket.assume_ssl()),
            )
        } else {
            (
                UpgradeClientUnion::Http(upgrade_client.as_ptr().cast::<HttpUpgradeClient>()),
                SocketUnion::Tcp(socket.assume_tcp()),
            )
        };

        let boxed = Box::new(WebSocketProxyTunnel {
            ref_count: Cell::new(1),
            upgrade_client: Cell::new(upgrade_client),
            connected_websocket: Cell::new(ptr::null_mut()),
            wrapper: OnceCell::new(),
            socket,
            write_buffer: JsCell::new(StreamBuffer::default()),
            sni_hostname: Some(Box::<[u8]>::from(sni_hostname)),
            reject_unauthorized,
        });
        // ref_count initialized to 1; caller owns the Box allocation via the
        // returned raw pointer (paired with `heap::take` in `deref()`).
        Ok(bun_core::heap::into_raw_nn(boxed))
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
                // Store the Box-provenance pointer directly so callback derefs
                // remain valid regardless of intervening reborrows.
                ctx: this.as_ptr(),
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
                        // SAFETY: `ssl_ptr` is the live SSL handle from the wrapper.
                        unsafe { &mut *ssl_ptr.as_ptr() },
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
    fn on_open(this: *mut WebSocketProxyTunnel) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { ThisPtr::new(this) };
        let _guard = this.ref_guard();
        bun_core::scoped_log!(WebSocketProxyTunnel, "onOpen");
        // SNI configuration is done in `start()` before the wrapper is driven.
    }

    /// SSLWrapper callback: Called with decrypted data from the network
    fn on_data(this: *mut WebSocketProxyTunnel, decrypted_data: &[u8]) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { ThisPtr::new(this) };
        let _guard = this.ref_guard();

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
        if !connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            // No `&`/`&mut WebSocket` is live in this frame across the call.
            unsafe { WebSocketClient::handle_tunnel_data(connected_websocket, decrypted_data) };
            return;
        }

        // Otherwise, forward to the upgrade client for WebSocket response processing
        upgrade_client.handle_decrypted_data(decrypted_data);
    }

    /// SSLWrapper callback: Called after TLS handshake completes
    fn on_handshake(
        this: *mut WebSocketProxyTunnel,
        success: bool,
        ssl_error: us_bun_verify_error_t,
    ) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { ThisPtr::new(this) };
        let _guard = this.ref_guard();

        bun_core::scoped_log!(WebSocketProxyTunnel, "onHandshake: success={}", success);

        // Snapshot the fields we need; `terminate()` / `on_proxy_tls_handshake_complete()`
        // re-enter `tunnel.detach_upgrade_client()` / `tunnel.write()`, so no borrow of
        // `*this` may span the dispatch.
        let (upgrade_client, reject_unauthorized) =
            (this.upgrade_client.get(), this.reject_unauthorized);

        if upgrade_client.is_none() {
            return;
        }

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
                (Some(ssl_ptr), Some(hostname)) => {
                    // SAFETY: ssl_ptr is a live `*mut SSL` owned by the wrapper
                    // (heap-allocated by BoringSSL; disjoint from the tunnel struct).
                    !boringssl::check_server_identity(unsafe { &mut *ssl_ptr.as_ptr() }, hostname)
                }
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
    fn on_close(this: *mut WebSocketProxyTunnel) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { ThisPtr::new(this) };
        let _guard = this.ref_guard();

        bun_core::scoped_log!(WebSocketProxyTunnel, "onClose");

        // Snapshot backref pointers; `fail()`/`terminate()` re-enter
        // `tunnel.clear_connected_web_socket()` / `tunnel.shutdown()` /
        // `tunnel.detach_upgrade_client()`, so no borrow of `*this` may span them.
        let (connected_websocket, upgrade_client) =
            (this.connected_websocket.get(), this.upgrade_client.get());

        // If we have a connected WebSocket client, notify it of the close
        if !connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            unsafe {
                let _ws_guard = bun_ptr::ScopedRef::new(connected_websocket);
                (*connected_websocket).fail(ErrorCode::Ended)
            };
            return;
        }

        // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
        if upgrade_client.is_none() {
            return;
        }

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
        self.connected_websocket.set(ptr::null_mut());
    }

    /// Clear the upgrade client reference. Called before tunnel shutdown during
    /// cleanup so that the SSLWrapper's synchronous onHandshake/onClose callbacks
    /// do not re-enter the upgrade client's terminate/clearData path.
    pub(crate) fn detach_upgrade_client(&self) {
        self.upgrade_client.set(UpgradeClientUnion::None);
    }

    /// SSLWrapper callback: Called with encrypted data to send to network
    fn write_encrypted(this: *mut WebSocketProxyTunnel, encrypted_data: &[u8]) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let this = unsafe { ThisPtr::new(this) };
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
        let _guard = this.ref_guard();

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
        let connected_websocket = this.connected_websocket.get();
        if !connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            // No `&`/`&mut WebSocket` is live in this frame across the call.
            unsafe { WebSocketClient::handle_tunnel_writable(connected_websocket) };
        }
    }

    /// Feed encrypted data from the network to the SSL wrapper for decryption
    ///
    /// Takes `ThisPtr<Self>` because `receive_data()` synchronously dispatches
    /// `on_data`/`on_handshake`/`on_close`/`write_encrypted`, which can reach a
    /// close path that drops a ref on the tunnel.
    pub(crate) fn receive(this: ThisPtr<Self>, data: &[u8]) {
        let _guard = this.ref_guard();

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
        let _guard = this.ref_guard();
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
        let _guard = this.ref_guard();
        if let Some(w) = this.wrapper.get() {
            let _ = w.shutdown(true); // Fast shutdown
        }
    }

    /// Check if the tunnel has backpressure
    pub(crate) fn has_backpressure(&self) -> bool {
        self.write_buffer.get().is_not_empty()
    }

    /// Encrypted bytes still buffered in the tunnel awaiting a writable socket.
    ///
    /// Takes `*const Self` and projects to `write_buffer` via `addr_of!` rather
    /// than forming a whole-struct `&Self`: this is reachable from inside the
    /// SSL-wrapper callbacks (abrupt close during the connected phase), and the
    /// module's Aliasing model doc has callbacks touch only disjoint fields,
    /// never the whole struct (the overlap with the caller's `&SslWrapper` is
    /// shared-over-shared today; field projection keeps the convention).
    ///
    /// # Safety
    /// `this` must point to a live `WebSocketProxyTunnel`.
    pub(crate) unsafe fn buffered_amount(this: *const Self) -> usize {
        // SAFETY: `this` is live; short-lived shared borrow of the disjoint
        // `write_buffer` field only (never touches `wrapper`).
        unsafe { (*ptr::addr_of!((*this).write_buffer)).size() }
    }
}

impl Drop for WebSocketProxyTunnel {
    fn drop(&mut self) {
        // Field cleanup is automatic: wrapper (OnceCell<SslWrapper>), write_buffer (StreamBuffer),
        // sni_hostname (Option<Box<[u8]>>) all impl Drop. Deallocation
        // is handled by IntrusiveRc / `deref()` via heap::take.
    }
}

// `tunnel` must stay `*mut` for the C ABI; C++ guarantees it is live and
// non-null, so the deref is sound — not_unsafe_ptr_arg_deref is a false
// positive at this FFI boundary.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
#[unsafe(no_mangle)]
extern "C" fn WebSocketProxyTunnel__setConnectedWebSocket(
    tunnel: *mut WebSocketProxyTunnel,
    ws: *mut WebSocketClient,
) {
    bun_core::scoped_log!(WebSocketProxyTunnel, "setConnectedWebSocket");
    // SAFETY: C++ guarantees a live, non-null tunnel pointer.
    let tunnel = unsafe { ThisPtr::new(tunnel) };
    tunnel.connected_websocket.set(ws);
    // Clear the upgrade client reference since we're now in connected phase
    tunnel.upgrade_client.set(UpgradeClientUnion::None);
}
