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
//! `write`, `shutdown`) forms a `&mut SslWrapper` over the `wrapper` field and then
//! synchronously re-enters this struct through the `ctx` backref via
//! `on_open`/`on_data`/`on_handshake`/`on_close`/`write_encrypted`.
//!
//! To stay sound under Stacked Borrows:
//! - Driving entries take `*mut Self` and project to `wrapper` via
//!   `ptr::addr_of_mut!` so the `&mut` covers only that field's bytes.
//! - Callbacks **never** form `&Self`/`&mut Self` (whole-struct) and **never** read
//!   `(*ctx).wrapper` — either would touch `wrapper`'s bytes through the
//!   Box-provenance `ctx` and pop the caller's `&mut SslWrapper` Unique tag.
//!   They access only disjoint fields (`ref_count`, `ssl`, `sni_hostname`,
//!   `write_buffer`, `socket`, `upgrade_client`, `connected_websocket`) via
//!   `(*ctx).field` raw projections.
//! - The `*mut SSL` needed by `on_handshake` is snapshotted into `self.ssl` in
//!   `start()` so it can be read without going through `wrapper`.
//!
//! This mirrors the Zig spec, which freely aliases `*WebSocketProxyTunnel` across
//! callbacks.

use core::cell::Cell;
use core::ptr;
use core::ptr::NonNull;

use bun_boringssl as boringssl;
use bun_core::strings;
use bun_io::StreamBuffer;
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
pub enum UpgradeClientUnion {
    Http(*mut HttpUpgradeClient),
    Https(*mut HttpsUpgradeClient),
    None,
}

impl UpgradeClientUnion {
    pub fn handle_decrypted_data(&self, data: &[u8]) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe {
                HttpUpgradeClient::handle_decrypted_data(*client, data)
            },
            UpgradeClientUnion::Https(client) => unsafe {
                HttpsUpgradeClient::handle_decrypted_data(*client, data)
            },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn terminate(&self, code: ErrorCode) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe {
                HttpUpgradeClient::terminate(*client, code)
            },
            UpgradeClientUnion::Https(client) => unsafe {
                HttpsUpgradeClient::terminate(*client, code)
            },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn on_proxy_tls_handshake_complete(&self) {
        match self {
            // SAFETY: BACKREF — caller (WebSocketUpgradeClient) outlives the tunnel during handshake phase
            UpgradeClientUnion::Http(client) => unsafe {
                HttpUpgradeClient::on_proxy_tls_handshake_complete(*client)
            },
            UpgradeClientUnion::Https(client) => unsafe {
                HttpsUpgradeClient::on_proxy_tls_handshake_complete(*client)
            },
            UpgradeClientUnion::None => {}
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, UpgradeClientUnion::None)
    }
}

type WebSocketClient = crate::websocket_client::WebSocket<false>;

#[derive(bun_ptr::CellRefCounted)]
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
    /// Snapshot of `wrapper.ssl` taken in `start()`.
    ///
    /// Callbacks fired from inside `SslWrapper::{start,receive_data,...}` run while
    /// the caller holds a live `&mut SslWrapper`; under Stacked Borrows, *any* read
    /// of `(*ctx).wrapper` bytes through the Box-provenance `ctx` pops that Unique
    /// tag. Snapshotting the `*mut SSL` here lets `on_handshake` read it without
    /// touching `wrapper`'s bytes.
    ssl: Option<NonNull<boringssl::c::SSL>>,
    /// Hostname for SNI (Server Name Indication)
    sni_hostname: Option<Box<[u8]>>,
    /// Whether to reject unauthorized certificates
    reject_unauthorized: bool,
}

use bun_uws::MaybeAnySocket as SocketUnion;

type SslWrapperType = SslWrapper<*mut WebSocketProxyTunnel>;

impl WebSocketProxyTunnel {
    /// Initialize a new proxy tunnel with all required parameters
    pub fn init<const SSL: bool>(
        upgrade_client: *mut NewHttpUpgradeClient<SSL>,
        socket: NewSocketHandler<SSL>,
        sni_hostname: &[u8],
        reject_unauthorized: bool,
    ) -> Result<NonNull<WebSocketProxyTunnel>, bun_alloc::AllocError> {
        // PORT NOTE: const-generic bool → variant selection. The pointer cast is
        // identity when SSL matches the alias (HttpUpgradeClient = NewHttpUpgradeClient<false>,
        // etc); `assume_ssl`/`assume_tcp` rebuild the handler around the same
        // `InternalSocket` so no `unsafe` is needed.
        let (upgrade_client, socket) = if SSL {
            (
                UpgradeClientUnion::Https(upgrade_client.cast::<HttpsUpgradeClient>()),
                SocketUnion::Ssl(socket.assume_ssl()),
            )
        } else {
            (
                UpgradeClientUnion::Http(upgrade_client.cast::<HttpUpgradeClient>()),
                SocketUnion::Tcp(socket.assume_tcp()),
            )
        };

        let boxed = Box::new(WebSocketProxyTunnel {
            ref_count: Cell::new(1),
            upgrade_client,
            connected_websocket: ptr::null_mut(),
            wrapper: None,
            socket,
            write_buffer: StreamBuffer::default(),
            ssl: None,
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
    /// # Safety
    /// `this` must be the Box-provenance pointer returned from `init` /
    /// `IntrusiveRc::as_ptr` and must be live for the duration of the call.
    /// `start*()` synchronously invokes `on_open(ctx)`, so this function must
    /// not hold a `&mut Self` across that call.
    pub unsafe fn start(
        this: *mut Self,
        ssl_options: SslConfig,
        initial_data: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Allow handshake to complete so we can access peer certificate for manual
        // hostname verification in onHandshake(). The actual reject_unauthorized
        // check uses self.reject_unauthorized field.
        let options = ssl_options.for_client_verification();

        // tier-neutral `init_from_options` takes the lowered
        // `BunSocketContextOptions` (= what `SSLConfig.asUSockets()` produces);
        // the `SSLConfig`-taking `init` lives in bun_runtime.
        let wrapper = SslWrapperType::init_from_options(
            options.as_usockets(),
            true,
            SslHandlers {
                // Store the Box-provenance pointer directly so callback derefs
                // remain valid regardless of intervening reborrows.
                ctx: this,
                on_open: Self::on_open,
                on_data: Self::on_data,
                on_handshake: Self::on_handshake,
                on_close: Self::on_close,
                write: Self::write_encrypted,
            },
        )
        .map_err(|_| bun_core::err!("InvalidOptions"))?;

        // Snapshot the `*mut SSL` *before* moving `wrapper` into `*this` and before
        // forming any `&mut SslWrapper`, so callbacks can read it from a tunnel
        // field disjoint from `wrapper` (see `self.ssl` doc).
        let ssl = wrapper.ssl;

        // SAFETY: caller contract — `this` is live. Short-lived raw derefs to assign
        // fields; no `&mut Self` is bound across the re-entrant `start*()` below.
        unsafe {
            (*this).ssl = ssl;
            (*this).wrapper = Some(wrapper);
        }

        // Configure SNI with hostname.
        //
        // PORT NOTE: the Zig spec does this inside `onOpen`, which `SslWrapper::start()`
        // invokes immediately before `handle_traffic()`. We hoist it here because
        // `start()` holds `&mut SslWrapper` across the `on_open` dispatch, and any
        // read of `(*ctx).wrapper` from inside the callback would invalidate that
        // borrow under Stacked Borrows. The observable order vs BoringSSL is
        // identical: SNI is set on the `SSL*` before the handshake is driven.
        if let Some(ssl_ptr) = ssl {
            // SAFETY: `this` is live; field projection covers only `sni_hostname`.
            if let Some(hostname) = unsafe { (*this).sni_hostname.as_deref() } {
                if !strings::is_ip_address(hostname) {
                    // Set SNI hostname
                    let hostname_z = bun_core::ZBox::from_vec_with_nul(hostname.to_vec());
                    // Zig `ssl_ptr.configureHTTPClient(host)` =
                    // SNI + verify-hostname. The boringssl-crate ext-method
                    // hasn't landed yet; route through bun_http's
                    // tier-neutral helper which does SNI + ALPN(h1) (no
                    // verify-hostname — that is checked manually in
                    // `on_handshake`, matching the Zig path).
                    bun_http::configure_http_client_with_alpn(
                        ssl_ptr.as_ptr(),
                        hostname_z.as_ptr(),
                        bun_http::AlpnOffer::H1,
                    );
                    // hostname_z dropped here (owned NUL-terminated copy)
                }
            }
        }

        // SAFETY: raw field projection; `start*()` synchronously fires `on_open(ctx)`
        // / `write_encrypted(ctx)` / etc. Those callbacks touch only fields disjoint
        // from `wrapper` (`ref_count`, `ssl`, `sni_hostname`, `write_buffer`,
        // `socket`, …), so the `&mut SslWrapper` formed here — which covers only
        // the `wrapper` field bytes — is never aliased.
        let wrapper_ptr = unsafe { ptr::addr_of_mut!((*this).wrapper) };
        if !initial_data.is_empty() {
            // SAFETY: deref of field projection; `this` is live.
            unsafe {
                (*wrapper_ptr)
                    .as_mut()
                    .unwrap()
                    .start_with_payload(initial_data)
            };
        } else {
            // SAFETY: deref of field projection; `this` is live.
            unsafe { (*wrapper_ptr).as_mut().unwrap().start() };
        }
        Ok(())
    }

    /// SSLWrapper callback: Called before TLS handshake starts
    fn on_open(this: *mut WebSocketProxyTunnel) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };
        bun_core::scoped_log!(WebSocketProxyTunnel, "onOpen");
        // SNI configuration is done in `start()` before the wrapper is driven;
        // see PORT NOTE there. This callback intentionally does not touch
        // `(*this).wrapper` — the caller (`SslWrapper::start`) holds `&mut self`
        // over those bytes.
        let _ = this;
    }

    /// SSLWrapper callback: Called with decrypted data from the network
    fn on_data(this: *mut WebSocketProxyTunnel, decrypted_data: &[u8]) {
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during callbacks.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "onData: {} bytes",
            decrypted_data.len()
        );
        if decrypted_data.is_empty() {
            return;
        }

        // Snapshot backref pointers via short raw-ptr reads; the dispatch below may
        // re-enter `tunnel.write/shutdown/clear_connected_web_socket/detach_upgrade_client`,
        // so no `&Self`/`&mut Self` may be live across it.
        // SAFETY: ScopedRef guard holds a ref; `this` is live. Reads of `Copy` fields.
        let (connected_websocket, upgrade_client) =
            unsafe { ((*this).connected_websocket, (*this).upgrade_client) };

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
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        bun_core::scoped_log!(WebSocketProxyTunnel, "onHandshake: success={}", success);

        // Snapshot the fields we need; `terminate()` / `on_proxy_tls_handshake_complete()`
        // re-enter `tunnel.detach_upgrade_client()` / `tunnel.write()`, so no borrow of
        // `*this` may span the dispatch.
        // SAFETY: ScopedRef guard holds a ref; `this` is live. Reads of `Copy` fields.
        let (upgrade_client, reject_unauthorized) =
            unsafe { ((*this).upgrade_client, (*this).reject_unauthorized) };

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

            // Verify server identity. Read the `ssl` snapshot + `sni_hostname` via
            // raw field projections — never bind `&*this` (whole-struct), which
            // would overlap `wrapper` and pop the `&mut SslWrapper` held by the
            // `receive_data()` frame that fired us.
            // SAFETY: ScopedRef guard holds a ref; `this` is live. `ssl` is `Copy`;
            // `sni_hostname` autoref covers only that field's bytes.
            let failed_identity = unsafe {
                match ((*this).ssl, (*this).sni_hostname.as_deref()) {
                    (Some(ssl_ptr), Some(hostname)) => {
                        // SAFETY: ssl_ptr is a live `*mut SSL` owned by the wrapper
                        // (heap-allocated by BoringSSL; disjoint from the tunnel struct).
                        !boringssl::check_server_identity(&mut *ssl_ptr.as_ptr(), hostname)
                    }
                    _ => false,
                }
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
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        bun_core::scoped_log!(WebSocketProxyTunnel, "onClose");

        // Snapshot backref pointers; `fail()`/`terminate()` re-enter
        // `tunnel.clear_connected_web_socket()` / `tunnel.shutdown()` /
        // `tunnel.detach_upgrade_client()`, so no borrow of `*this` may span them.
        // SAFETY: ScopedRef guard holds a ref; `this` is live. Reads of `Copy` fields.
        let (connected_websocket, upgrade_client) =
            unsafe { ((*this).connected_websocket, (*this).upgrade_client) };

        // If we have a connected WebSocket client, notify it of the close
        if !connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            unsafe { (*connected_websocket).fail(ErrorCode::Ended) };
            return;
        }

        // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
        if upgrade_client.is_none() {
            return;
        }

        // Otherwise notify the upgrade client
        upgrade_client.terminate(ErrorCode::Ended);
    }

    /// Set the connected WebSocket client. Called after successful WebSocket upgrade.
    /// This transitions the tunnel from upgrade phase to connected phase.
    /// After calling this, decrypted data will be forwarded to the WebSocket client.
    pub fn set_connected_web_socket(&mut self, ws: *mut WebSocketClient) {
        bun_core::scoped_log!(WebSocketProxyTunnel, "setConnectedWebSocket");
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
        // SAFETY: ctx pointer set in `start`; SSLWrapper guarantees it is live during
        // callbacks. The driving frame (`receive`/`on_writable`/`write`/`shutdown`/
        // `start`) holds a live `&mut SslWrapper` derived from `(*this).wrapper`, so
        // a whole-struct `&mut *this` here would alias it (Stacked Borrows UB).
        // Project to the disjoint `write_buffer`/`socket` fields only.
        let (write_buffer, socket) = unsafe {
            (
                &mut *ptr::addr_of_mut!((*this).write_buffer),
                &*ptr::addr_of!((*this).socket),
            )
        };
        bun_core::scoped_log!(
            WebSocketProxyTunnel,
            "writeEncrypted: {} bytes",
            encrypted_data.len()
        );

        // If data is already buffered, queue this to maintain TLS record ordering
        if write_buffer.is_not_empty() {
            bun_core::handle_oom(write_buffer.write(encrypted_data));
            return;
        }

        // Try direct write to socket
        let written = socket.write(encrypted_data);
        if written < 0 {
            // Write failed - buffer data for retry when socket becomes writable
            bun_core::handle_oom(write_buffer.write(encrypted_data));
            return;
        }

        // Buffer remaining data
        let written_usize = usize::try_from(written).expect("int cast");
        if written_usize < encrypted_data.len() {
            bun_core::handle_oom(write_buffer.write(&encrypted_data[written_usize..]));
        }
    }

    /// Called when the socket becomes writable - flush buffered encrypted data
    ///
    /// # Safety
    /// `this` must point to a live tunnel. `flush()` fires `write_encrypted(ctx)`
    /// and `handle_tunnel_writable()` re-enters `tunnel.write()`, so this function
    /// operates on `*mut Self` end-to-end and never binds a whole-struct `&mut`.
    pub unsafe fn on_writable(this: *mut Self) {
        // SAFETY: caller contract — `this` is live.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        // Flush the SSL state machine via raw field projection so no `&mut Self`
        // spans the synchronous `write_encrypted` re-entry.
        // SAFETY: `this` is live; projection covers only `wrapper`.
        let wrapper_ptr = unsafe { ptr::addr_of_mut!((*this).wrapper) };
        // SAFETY: deref of field projection; `write_encrypted`'s `&mut *ctx` derives
        // from the Box-provenance `ctx`, not from this borrow.
        if let Some(w) = unsafe { (*wrapper_ptr).as_mut() } {
            let _ = w.flush();
        }

        // Send buffered encrypted data. Fresh raw-ptr field accesses — `write_encrypted`
        // above may have mutated `write_buffer`, so we must not reuse any earlier borrow.
        // SAFETY: `this` is live; short-lived borrows that do not span re-entrant calls
        // (`socket.write` is a uws send, `write_buffer` ops are local).
        unsafe {
            let to_send = (*this).write_buffer.slice();
            if !to_send.is_empty() {
                // PORT NOTE: reshaped for borrowck — capture len before re-borrowing write_buffer
                let to_send_len = to_send.len();
                let written = (*this).socket.write(to_send);
                if written < 0 {
                    return;
                }

                let written_usize = usize::try_from(written).expect("int cast");
                if written_usize == to_send_len {
                    (*this).write_buffer.reset();
                } else {
                    (*this).write_buffer.cursor += written_usize;
                    return; // still have backpressure
                }
            }
        }

        // Tunnel drained - let the connected WebSocket flush its send_buffer.
        // `handle_tunnel_writable()` re-enters `tunnel.write()`; snapshot the pointer
        // into a local so no `&Self` borrow is active across the dispatch.
        // SAFETY: `this` is live; read of `Copy` field.
        let connected_websocket = unsafe { (*this).connected_websocket };
        if !connected_websocket.is_null() {
            // SAFETY: BACKREF — WebSocket owns tunnel via ref(); cleared before WebSocket frees.
            // No `&`/`&mut WebSocket` is live in this frame across the call.
            unsafe { WebSocketClient::handle_tunnel_writable(connected_websocket) };
        }
    }

    /// Feed encrypted data from the network to the SSL wrapper for decryption
    ///
    /// # Safety
    /// `this` must point to a live tunnel. `receive_data()` synchronously dispatches
    /// `on_data`/`on_handshake`/`on_close`/`write_encrypted`, each of which derefs
    /// `ctx` back into this allocation; this function therefore never holds a
    /// `&mut Self` across the call.
    pub unsafe fn receive(this: *mut Self, data: &[u8]) {
        // SAFETY: caller contract — `this` is live.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };

        // SAFETY: raw field projection; the `&mut Option<SslWrapper>` covers only
        // `wrapper`, and the re-entrant callbacks access tunnel fields via the
        // Box-provenance `ctx`, not through this borrow.
        let wrapper_ptr = unsafe { ptr::addr_of_mut!((*this).wrapper) };
        // SAFETY: deref of field projection; `this` is live.
        if let Some(w) = unsafe { (*wrapper_ptr).as_mut() } {
            w.receive_data(data);
        }
    }

    /// Write application data through the tunnel (will be encrypted)
    ///
    /// # Safety
    /// `this` must point to a live tunnel. `write_data()` fires `write_encrypted(ctx)`
    /// which forms `&mut *ctx`; this function therefore accesses `wrapper` via raw
    /// projection and never holds a `&mut Self` across the call.
    pub unsafe fn write(this: *mut Self, data: &[u8]) -> Result<usize, bun_core::Error> {
        // TODO(port): narrow error set
        // SAFETY: caller contract — `this` is live; projection covers only `wrapper`.
        let wrapper_ptr = unsafe { ptr::addr_of_mut!((*this).wrapper) };
        // SAFETY: deref of field projection; `this` is live.
        if let Some(w) = unsafe { (*wrapper_ptr).as_mut() } {
            return w
                .write_data(data)
                .map_err(|_| bun_core::err!("ConnectionClosed"));
        }
        Err(bun_core::err!("ConnectionClosed"))
    }

    /// Gracefully shutdown the TLS connection
    ///
    /// # Safety
    /// `this` must point to a live tunnel. `shutdown()` may fire
    /// `on_close(ctx)`/`write_encrypted(ctx)`; this function therefore accesses
    /// `wrapper` via raw projection and never holds a `&mut Self` across the call.
    pub unsafe fn shutdown(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; projection covers only `wrapper`.
        let wrapper_ptr = unsafe { ptr::addr_of_mut!((*this).wrapper) };
        // SAFETY: deref of field projection; `this` is live.
        if let Some(w) = unsafe { (*wrapper_ptr).as_mut() } {
            let _ = w.shutdown(true); // Fast shutdown
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
        // is handled by IntrusiveRc / `deref()` via heap::take.
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

// ported from: src/http_jsc/websocket_client/WebSocketProxyTunnel.zig
