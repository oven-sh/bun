//! WebSocketUpgradeClient handles the HTTP upgrade process for WebSocket connections.
//!
//! This module implements the client-side of the WebSocket protocol handshake as defined in RFC 6455.
//! It manages the initial HTTP request that upgrades the connection from HTTP to WebSocket protocol.
//!
//! The process works as follows:
//! 1. Client sends an HTTP request with special headers indicating a WebSocket upgrade
//! 2. Server responds with HTTP 101 Switching Protocols
//! 3. After successful handshake, the connection is handed off to the WebSocket implementation
//!
//! This client handles both secure (TLS) and non-secure connections.
//! It manages connection timeouts, protocol negotiation, and error handling during the upgrade process.
//!
//! Note: This implementation is only used during the initial connection phase.
//! Once the WebSocket connection is established, control is passed to the WebSocket client.
//!
//! For more information about the WebSocket handshaking process, see:
//! - RFC 6455 (The WebSocket Protocol): https://datatracker.ietf.org/doc/html/rfc6455#section-1.3
//! - MDN WebSocket API: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
//! - WebSocket Handshake: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#the_websocket_handshake

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr;
use std::io::Write as _;

use bun_boringssl as boringssl;
use bun_collections::StringSet;
use bun_core::ZBox;
use bun_core::fmt::HostFormatter;
use bun_core::strings;
use bun_core::{String as BunString, Utf8Bytes};
use bun_http::{HeaderValueIterator, Headers};
use bun_io::KeepAlive;
use bun_jsc::{JSGlobalObject, VirtualMachineRef};
use bun_picohttp as picohttp;
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};

use super::websocket_proxy_tunnel::IntoUpgradeClientRef;
use bun_uws::{self as uws, SocketHandler, SocketKind};

use super::cpp_websocket::CppWebSocket;
use super::websocket_deflate as WebSocketDeflate;
use super::websocket_proxy::WebSocketProxy;
use super::websocket_proxy_tunnel::WebSocketProxyTunnel;
use crate::websocket_client::ErrorCode;

// LAYERING: SSLConfig was MOVE_DOWN'd from bun_runtime::api::server_config →
// bun_http::ssl_config (data + as_usockets/for_client_verification). The
// JSC-dependent `from_js` constructor stays in bun_runtime; the C-ABI
// `Bun__WebSocket__parseSSLConfig` export therefore lives in
// bun_runtime::socket::SSLConfig and bridges to this lower-tier type via
// `into_http()`.
use bun_http::ssl_config::SSLConfig;

bun_core::define_scoped_log!(log, WebSocketUpgradeClient, visible);
bun_core::declare_scope!(alloc, hidden);

/// Opening-handshake timeout in seconds, normalised for uSockets' timer
/// wheel (short-timeout counter wraps at 240 ticks; `set_timeout` routes
/// larger values onto the minute-granularity long timer). 0 disables.
#[inline]
fn handshake_timeout_seconds() -> core::ffi::c_uint {
    bun_http::normalize_idle_timeout_seconds(
        bun_core::env_var::BUN_CONFIG_WS_HANDSHAKE_TIMEOUT
            .get()
            .unwrap_or(120),
    )
}

/// `uws.NewSocketHandler(ssl)`
type Socket<const SSL: bool> = SocketHandler<SSL>;

#[derive(Default, Clone, Copy)]
pub(crate) struct DeflateNegotiationResult {
    pub enabled: bool,
    pub params: WebSocketDeflate::Params,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Initializing,
    Reading,
    Failed,
    /// Sent CONNECT, waiting for 200
    ProxyHandshake,
    /// WebSocket upgrade complete, forwarding data through tunnel
    Done,
}

enum HeadParse {
    Done {
        full: Vec<u8>,
        status_code: u32,
        head_len: usize,
    },
    Invalid,
    NeedMore,
}

use boringssl::c::OwnedSslCtx;

/// WebSocket HTTP upgrade client, generic over `SSL`. Intrusively refcounted;
/// dropped when the count hits 0.
#[derive(bun_ptr::CellRefCounted)]
pub struct HTTPClient<const SSL: bool> {
    ref_count: Cell<u32>,
    tcp: Cell<Socket<SSL>>,
    /// The ref held on behalf of the TCP socket's userdata pointer; released
    /// in `handle_close` / `handle_connect_error` / `cancel`, or when the
    /// socket is handed to the connected `WebSocket`.
    socket_ref: Cell<Option<RefPtr<Self>>>,
    /// C++ `WebSocket::m_upgradeClient` and the ref held on its behalf;
    /// released together when C++ lets go (`cancel`, `didConnect*`,
    /// `didAbruptClose`).
    outgoing_websocket: JsCell<Option<(BackRef<CppWebSocket>, RefPtr<Self>)>>,
    /// Owned request bytes. Freed via `clear_input`.
    input_body_buf: JsCell<Vec<u8>>,
    // The unsent bytes are always a suffix of `input_body_buf`; stored here as
    // the suffix length so we don't hold a self-referential slice.
    to_send_len: Cell<usize>,
    headers_buf: JsCell<[picohttp::Header; 128]>,
    body: JsCell<Vec<u8>>,
    /// Owned NUL-terminated hostname for SNI; empty when unset.
    hostname: JsCell<ZBox>,
    poll_ref: JsCell<KeepAlive>,
    state: Cell<State>,
    subprotocols: JsCell<StringSet>,

    /// Proxy state (None when not using proxy)
    proxy: JsCell<Option<WebSocketProxy>>,

    /// TLS options (full SSLConfig for complete TLS customization)
    ssl_config: JsCell<Option<Box<SSLConfig>>>,

    /// `SslCtx` built from `ssl_config` when it carries a custom CA.
    /// Heap-allocated because ownership transfers to the connected
    /// `WebSocket` after the upgrade completes (so the `SSL_CTX` outlives
    /// this struct). RAII: dropping the wrapper releases the retained ref.
    secure: JsCell<Option<OwnedSslCtx>>,

    /// Expected Sec-WebSocket-Accept value for handshake validation per RFC 6455 §4.2.2.
    /// This is base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")).
    expected_accept: [u8; 28],

    /// Whether the upgrade request offered `permessage-deflate`. When this is
    /// false (opt-out via `perMessageDeflate: false`) and the server responds
    /// with a `Sec-WebSocket-Extensions` header anyway, `processResponse`
    /// fails the handshake per RFC 6455 §9.1 — matching upstream `ws`.
    offered_permessage_deflate: bool,
}

// Handler set referenced by the dispatch table (kind = `.ws_client_upgrade[_tls]`).
// The `register()` C++ round-trip that previously installed these on a
// shared `us_socket_context_t` is gone — sockets are stamped with the
// kind at connect time and routed via the `RawSocketEvents<SSL>` impl in
// `bun_runtime::socket::uws_handlers`, which forwards to the `pub
// handle_*` methods below.
// The handlers take `ThisPtr<Self>` (not `&mut Self`) because uSockets
// dispatches them from the raw userdata pointer and several can free `Self`
// (`deref` reaching zero) or be re-entered synchronously by `tcp.close()` /
// C++ callbacks; a `&mut Self` argument across either is UB under Stacked
// Borrows (argument protectors / aliased `&mut`). Mutable state lives in
// `Cell`/`JsCell` fields so every access is a short shared borrow.
impl<const SSL: bool> HTTPClient<SSL>
where
    Self: IntoUpgradeClientRef,
{
    /// On error, this returns `None`, which signals to the C++ caller that the
    /// connection failed. On success the returned pointer carries the ref held
    /// in `outgoing_websocket` on C++'s behalf.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn connect(
        global: &JSGlobalObject,
        websocket: &CppWebSocket,
        host: &BunString,
        port: u16,
        pathname: &BunString,
        client_protocol: &BunString,
        header_names: &[BunString],
        header_values: &[BunString],
        // Proxy parameters
        proxy_host: Option<&BunString>,
        proxy_port: u16,
        proxy_authorization: Option<&BunString>,
        proxy_header_names: &[BunString],
        proxy_header_values: &[BunString],
        // TLS options (full SSLConfig for complete TLS customization)
        ssl_config: Option<Box<SSLConfig>>,
        // Whether the target URL is wss:// (separate from ssl template parameter)
        target_is_secure: bool,
        // Target URL authorization (Basic auth from ws://user:pass@host)
        target_authorization: Option<&BunString>,
        // Unix domain socket path for ws+unix:// / wss+unix:// (None for TCP)
        unix_socket_path: Option<&BunString>,
        // Whether to advertise `permessage-deflate` in the upgrade request
        // (ws.WebSocket's `perMessageDeflate` option; true by default).
        offer_permessage_deflate: bool,
    ) -> Option<*mut Self> {
        let vm = global.bun_vm().as_mut();

        debug_assert!(vm.event_loop_handle.is_some());

        // Decode all BunString inputs into UTF-8 slices. The underlying
        // JavaScript strings may be Latin1 or UTF-16; `String.to_utf8()` either
        // borrows the 8-bit ASCII backing (no allocation) or allocates a
        // UTF-8 copy. All slices live until end of scope (Drop).

        let host_slice = host.to_utf8();
        let pathname_slice = pathname.to_utf8();
        let client_protocol_slice = client_protocol.to_utf8();

        let extra_headers = Headers8Bit::init(header_names, header_values);

        let proxy_host_slice: Option<Utf8Bytes> = proxy_host.map(|ph| ph.to_utf8());
        let target_authorization_slice: Option<Utf8Bytes> =
            target_authorization.map(|ta| ta.to_utf8());
        let unix_socket_path_slice: Option<Utf8Bytes> = unix_socket_path.map(|usp| usp.to_utf8());

        let using_proxy = proxy_host.is_some();

        // Check if user provided a custom protocol for subprotocols validation
        let mut protocol_for_subprotocols: &[u8] = client_protocol_slice.slice();
        for (name, value) in extra_headers.iter() {
            if strings::eql_case_insensitive_ascii(name, b"sec-websocket-protocol", true) {
                protocol_for_subprotocols = value;
                break;
            }
        }

        let request_result = match build_request_body(
            vm,
            pathname_slice.slice(),
            target_is_secure,
            host_slice.slice(),
            port,
            client_protocol_slice.slice(),
            &extra_headers,
            target_authorization_slice.as_ref().map(|s| s.slice()),
            offer_permessage_deflate,
        ) {
            Ok(r) => r,
            Err(_) => return None,
        };
        let body = request_result.body;

        // Build proxy state if using proxy.
        // The CONNECT request is built using local variables for proxy_authorization and proxy_headers
        // which are freed immediately after building the request (not stored on the client).
        // Ownership of `body` moves into the proxy; the CONNECT
        // request becomes the initial input_body_buf instead.
        let (proxy_state, input_body_buf): (Option<WebSocketProxy>, Vec<u8>) = if using_proxy {
            // Parse proxy authorization (temporary, freed after building CONNECT request)
            let proxy_auth_decoded: Option<Utf8Bytes> =
                proxy_authorization.map(|auth| auth.to_utf8());
            let proxy_auth_slice: Option<&[u8]> = proxy_auth_decoded.as_ref().map(|s| s.slice());

            // Parse proxy headers (temporary, freed after building CONNECT request)
            let proxy_extra_headers = Headers8Bit::init(proxy_header_names, proxy_header_values);

            let proxy_hdrs: Option<Headers> = if !proxy_header_names.is_empty() {
                Some(proxy_extra_headers.to_headers())
            } else {
                None
            };

            // Build CONNECT request (proxy_auth and proxy_hdrs are dropped after this).
            // build_connect_request only returns AllocError; crash on OOM.
            let connect_request = build_connect_request(
                host_slice.slice(),
                port,
                proxy_auth_slice,
                proxy_hdrs.as_ref(),
            );

            // Duplicate target_host (needed for SNI during TLS handshake).
            let target_host_dup: Box<[u8]> = Box::from(host_slice.slice());

            let proxy = WebSocketProxy::init(
                target_host_dup,
                // Use target_is_secure from C++, not ssl template parameter
                // (ssl may be true for HTTPS proxy even with ws:// target)
                target_is_secure,
                body.into_boxed_slice(),
            );
            (Some(proxy), connect_request)
        } else {
            (None, body)
        };

        let subprotocols = {
            let mut subprotocols = StringSet::new();
            let mut it = HeaderValueIterator::init(protocol_for_subprotocols);
            while let Some(protocol) = it.next() {
                let _ = subprotocols.insert(protocol); // OOM-only Result
            }
            subprotocols
        };

        let display_host: &[u8] = if using_proxy {
            proxy_host_slice.as_ref().unwrap().slice()
        } else {
            host_slice.slice()
        };
        let connect_port = if using_proxy { proxy_port } else { port };

        let mut poll_ref = KeepAlive::init();
        poll_ref.r#ref(vm.loop_ctx());

        log!(
            "connect: ssl={}, has_ssl_config={}, using_proxy={}",
            SSL,
            ssl_config.is_some(),
            using_proxy
        );

        let loop_ = global.bun_vm().uws_loop();
        let group = global
            .bun_vm()
            .as_mut()
            .rare_data()
            .ws_upgrade_group::<SSL>(loop_);
        let kind: SocketKind = if SSL {
            SocketKind::WsClientUpgradeTls
        } else {
            SocketKind::WsClientUpgrade
        };
        // Default-TLS shares the VM-wide client SSL_CTX; a custom CA
        // builds a per-connection one that the connected WebSocket
        // inherits so it isn't rebuilt on adopt.
        //
        // §Dispatch (cycle-break): `RareData.defaultClientSslCtx()` and
        // `RareData.sslCtxCache().getOrCreateOpts()` reach
        // `RuntimeState.ssl_ctx_cache` (high-tier `bun_runtime`); routed
        // through `RuntimeHooks` so this crate stays below `bun_runtime`.
        //
        let mut secure: Option<OwnedSslCtx> = None;
        let secure_ptr: Option<*mut uws::SslCtx> = if SSL {
            'brk: {
                if let Some(config) = &ssl_config {
                    if config.requires_custom_request_ctx {
                        let mut err = uws::create_bun_socket_error_t::none;
                        // Per-VM weak cache: every `new WebSocket(wss://, {tls:{ca}})`
                        // with the same CA shares one CTX with each other and with
                        // any `Bun.connect`/Postgres/etc. that named it.
                        let ctx = vm.ssl_ctx_cache_get_or_create(
                            &config.as_usockets_for_client_verification(),
                            &mut err,
                        );
                        let Some(ctx) = ctx else {
                            // Do NOT fall through to the default trust store — the
                            // user passed an explicit CA/cert and BoringSSL
                            // rejected it. Swapping in system roots would let the
                            // connection succeed against a host the user didn't
                            // trust. The C++ caller emits an `error` event on null.
                            log!("createSSLContext failed for WebSocket: {:?}", err);
                            poll_ref.unref(vm.loop_ctx());
                            return None;
                        };
                        let raw = ctx.as_ptr();
                        secure = Some(ctx);
                        break 'brk Some(raw);
                    }
                }
                Some(vm.default_client_ssl_ctx())
            }
        } else {
            None
        };

        let client = RefPtr::new(HTTPClient::<SSL> {
            ref_count: Cell::new(1),
            tcp: Cell::new(Socket::<SSL>::detached()),
            socket_ref: Cell::new(None),
            outgoing_websocket: JsCell::new(None),
            input_body_buf: JsCell::new(input_body_buf),
            to_send_len: Cell::new(0),
            headers_buf: JsCell::new([picohttp::Header::ZERO; 128]),
            body: JsCell::new(Vec::new()),
            hostname: JsCell::new(ZBox::default()),
            poll_ref: JsCell::new(poll_ref),
            state: Cell::new(State::Initializing),
            proxy: JsCell::new(proxy_state),
            ssl_config: JsCell::new(ssl_config),
            secure: JsCell::new(secure),
            expected_accept: request_result.expected_accept,
            offered_permessage_deflate: offer_permessage_deflate,
            subprotocols: JsCell::new(subprotocols),
        });
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::TYPE_NAME, client.as_ptr());
        let this = client.this_ptr();

        // Unix domain socket path (ws+unix:// / wss+unix://)
        if let Some(usp) = &unix_socket_path_slice {
            let socket = Socket::<SSL>::connect_unix_group(
                group,
                kind,
                secure_ptr,
                usp.slice(),
                client.as_ptr(),
                false,
            )
            .ok()?;
            this.tcp.set(socket);
            if this.state.get() == State::Failed {
                socket.take_ext_owner::<Self>();
                return None;
            }
            bun_analytics::features::web_socket.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

            if SSL {
                // SNI uses the URL host (defaulted to "localhost" in
                // C++ when absent), mirroring the TCP path below. A
                // user-supplied Host header does NOT affect SNI; use
                // `tls: { checkServerIdentity }` or put the hostname
                // in the URL (wss+unix://name/path) to verify against
                // a specific certificate name.
                if !host_slice.slice().is_empty() {
                    this.hostname.set(ZBox::from_bytes(host_slice.slice()));
                }
            }

            socket.set_timeout(handshake_timeout_seconds());
            this.state.set(State::Reading);
            return Some(Self::connected(client, websocket));
        }

        let sock = Socket::<SSL>::connect_group(
            group,
            kind,
            secure_ptr,
            display_host,
            c_int::from(connect_port),
            client.as_ptr(),
            false,
        )
        .ok()?;
        this.tcp.set(sock);
        // I don't think this case gets reached.
        if this.state.get() == State::Failed {
            sock.take_ext_owner::<Self>();
            return None;
        }
        bun_analytics::features::web_socket.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        if SSL {
            // SNI for the outer TLS socket must use the host we actually
            // dialed. For HTTPS proxy connections, that's the proxy host,
            // not the wss:// target.
            if !display_host.is_empty() {
                this.hostname.set(ZBox::from_bytes(display_host));
            }
        }

        sock.set_timeout(handshake_timeout_seconds());
        this.state.set(State::Reading);
        Some(Self::connected(client, websocket))
    }

    /// The socket now holds `client` as its userdata; record that ref and take
    /// one more on behalf of C++'s `m_upgradeClient`, returning its pointer.
    fn connected(client: RefPtr<Self>, websocket: &CppWebSocket) -> *mut Self {
        let this = client.this_ptr();
        this.outgoing_websocket
            .set(Some((BackRef::new(websocket), client.clone())));
        this.socket_ref.set(Some(client));
        this.as_ptr()
    }

    /// C++'s back-reference, while it still holds one.
    fn cpp_websocket(&self) -> Option<BackRef<CppWebSocket>> {
        self.outgoing_websocket.get().as_ref().map(|(ws, _)| *ws)
    }

    /// C++ let go of `m_upgradeClient`: forget the back-reference and release
    /// the ref held on its behalf. May free `self`.
    fn release_cpp_ref(&self) {
        self.outgoing_websocket.set(None);
    }

    /// Release the ref held for the socket's userdata pointer. May free `self`.
    fn release_socket_ref(&self) {
        self.socket_ref.set(None);
    }

    /// Write the unsent suffix of `input_body_buf` via `write` (which returns
    /// bytes written, or `None` on failure) without a cell borrow spanning the
    /// possibly re-entrant write. On failure the client is terminated — which
    /// clears the buffer anyway — and `false` is returned.
    fn write_pending(this: ThisPtr<Self>, write: impl FnOnce(&[u8]) -> Option<usize>) -> bool {
        let buf = this.input_body_buf.replace(Vec::new());
        let pending = this.to_send_len.get().min(buf.len());
        let Some(wrote) = write(&buf[buf.len() - pending..]) else {
            drop(buf);
            Self::terminate(this, ErrorCode::FailedToWrite);
            return false;
        };
        this.to_send_len.set(pending - wrote.min(pending));
        this.input_body_buf.set(buf);
        true
    }

    fn socket_write(socket: Socket<SSL>, buf: &[u8]) -> Option<usize> {
        usize::try_from(socket.write(buf)).ok()
    }

    /// Takes `ThisPtr<Self>` because `tcp.close()` synchronously dispatches
    /// `handle_close` from the socket userdata pointer, and the trailing
    /// `deref` may free `this`.
    pub(crate) fn cancel(this: ThisPtr<Self>) {
        this.clear_data();

        // Either of the below two operations - closing the TCP socket or clearing the C++ reference could trigger a deref
        // Therefore, we need to make sure the `this` pointer is valid until the end of the function.
        // Bumps the intrusive refcount and derefs on Drop (after `tcp.close`
        // below), which may free `this` — no `&`/`&mut Self` is live at that
        // point.
        let _guard = RefPtr::from_this(this);

        // The C++ end of the socket is no longer holding a reference to this, so we must clear it.
        this.release_cpp_ref();

        // Copy `tcp` out so no borrow of `*this` spans the close.
        let tcp = this.tcp.get();
        // Clear the socket's ext slot before closing. `us_socket_close` on a
        // SEMI_SOCKET (TCP connect still in flight — the common case when
        // `ws.close()` is called synchronously after `new WebSocket()`) skips
        // dispatch entirely, so we cannot rely on `handle_close` /
        // `handle_connect_error` to release the socket-userdata ref taken in
        // `connect()`. Take it back here and deref it ourselves; any callback
        // that does fire sees `ext == None` and no-ops via the
        // `RawPtrHandler` guard.
        let had_socket_ref = tcp.take_ext_owner::<Self>();
        tcp.close(uws::CloseCode::Failure);
        if had_socket_ref {
            this.tcp.set(Socket::<SSL>::detached());
            this.release_socket_ref();
        }
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// Takes `ThisPtr<Self>` because `did_abrupt_close` may run JS that
    /// re-enters via `cancel()`, and `tcp.close()` synchronously dispatches
    /// `handle_close`.
    pub(crate) fn fail(this: ThisPtr<Self>, code: ErrorCode) {
        log!("onFail: {}", <&'static str>::from(code));
        bun_jsc::mark_binding!();
        // Copy `tcp` out before dispatch so nothing touches `*this` after the
        // FFI call (which may reenter and pop our tag).
        let tcp = this.tcp.get();
        Self::dispatch_abrupt_close(this, code);

        // A failed upgrade (bad status line, mismatched subprotocol, invalid
        // headers, ...) is an application-level rejection of a healthy TCP
        // connection — close it gracefully (FIN) like Node's ws client does.
        // A Failure close arms SO_LINGER{1,0} and sends an RST, which the
        // server observes as ECONNRESET on a connection it served correctly.
        tcp.close(uws::CloseCode::Normal);
    }

    /// Takes `ThisPtr<Self>` because `did_abrupt_close` runs JS error
    /// handlers and may re-enter via C++ `cancel()`, and the trailing `deref`
    /// may free `this`.
    fn dispatch_abrupt_close(this: ThisPtr<Self>, code: ErrorCode) {
        if let Some((ws, _cpp_ref)) = this.outgoing_websocket.replace(None) {
            ws.did_abrupt_close(code);
        }
    }

    /// Takes `ThisPtr<Self>` because the trailing `deref` releases the socket
    /// ref and on the normal path frees `this`; a `&mut self` argument would
    /// carry a Stacked Borrows protector that makes deallocating it UB.
    pub fn handle_close(this: ThisPtr<Self>, _: Socket<SSL>, _: c_int, _: *mut c_void) {
        log!("onClose");
        bun_jsc::mark_binding!();
        this.clear_data();
        this.tcp.set(Socket::<SSL>::detached());
        Self::dispatch_abrupt_close(this, ErrorCode::Ended);
        this.release_socket_ref();
    }

    /// See `fail`.
    pub(crate) fn terminate(this: ThisPtr<Self>, code: ErrorCode) {
        Self::fail(this, code);
        // We cannot access the pointer after fail is called.
    }

    /// Takes `ThisPtr<Self>` because `fail` may free `this` / be re-entered.
    pub fn handle_handshake(
        this: ThisPtr<Self>,
        socket: Socket<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        log!(
            "onHandshake({}) ssl_error.error_no={}",
            success,
            ssl_error.error_no
        );

        let handshake_success = success == 1;
        let reject_unauthorized = this
            .cpp_websocket()
            .is_some_and(|ws| ws.reject_unauthorized());

        if handshake_success {
            // handshake completed but we may have ssl errors
            if reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    log!(
                        "TLS handshake failed: ssl_error={}, has_custom_ctx={}",
                        ssl_error.error_no,
                        this.secure.get().is_some()
                    );
                    Self::fail(this, ErrorCode::TlsHandshakeFailed);
                    return;
                }
                let Some(ssl) = socket.ssl_mut() else {
                    // No SSL object to verify against — treat as handshake failure.
                    Self::fail(this, ErrorCode::TlsHandshakeFailed);
                    return;
                };
                let identity_ok = {
                    let own_hostname = this.hostname.get();
                    let sni: Vec<u8>;
                    let hostname: &[u8] = if !own_hostname.is_empty() {
                        own_hostname.as_bytes()
                    } else {
                        sni = ssl.servername().map(<[u8]>::to_vec).unwrap_or_default();
                        &sni
                    };
                    !hostname.is_empty() && boringssl::check_server_identity(ssl, hostname)
                };
                if !identity_ok {
                    Self::fail(this, ErrorCode::TlsHandshakeFailed);
                }
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            Self::fail(this, ErrorCode::TlsHandshakeFailed);
        }
    }

    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub fn handle_open(this: ThisPtr<Self>, socket: Socket<SSL>) {
        log!("onOpen");
        this.tcp.set(socket);
        // `us_internal_socket_after_open` zeroes the socket timeout when the
        // SEMI_SOCKET opens, so the value `connect()` armed only covered the
        // TCP connect. Re-arm so an accept-but-never-answer peer times out.
        socket.set_timeout(handshake_timeout_seconds());

        debug_assert!(!this.input_body_buf.get().is_empty());
        debug_assert!(this.to_send_len.get() == 0);

        if SSL {
            let hostname = this.hostname.get();
            if !hostname.is_empty() {
                if let Some(ssl) = socket.ssl_mut() {
                    bun_http::configure_http_client_with_alpn(
                        ssl,
                        if bun_core::ip_address::is_ip_address(hostname.as_bytes()) {
                            core::ptr::null()
                        } else {
                            hostname.as_ptr()
                        },
                        bun_http::AlpnOffer::H1,
                    );
                }
            }
        }

        // If using proxy, set state to proxy_handshake
        if this.proxy.get().is_some() {
            this.state.set(State::ProxyHandshake);
        }

        this.to_send_len.set(this.input_body_buf.get().len());
        Self::write_pending(this, |buf| Self::socket_write(socket, buf));
    }

    pub(crate) fn is_same_socket(&self, socket: Socket<SSL>) -> bool {
        // `InternalSocket` has no `PartialEq`; compare native handles.
        socket.get_native_handle() == self.tcp.get().get_native_handle()
    }

    fn buffer_and_parse_head(&self, data: &[u8]) -> HeadParse {
        let buffered = !self.body.get().is_empty();
        if buffered {
            self.body.with_mut(|b| b.extend_from_slice(data));
        }

        let parsed = {
            let body: &[u8] = if buffered { self.body.get() } else { data };
            self.headers_buf.with_mut(|headers_buf| {
                picohttp::Response::parse(body, headers_buf).map(|response| HeadParse::Done {
                    status_code: response.status_code,
                    head_len: response.bytes_read,
                    full: body.to_vec(),
                })
            })
        };

        match parsed {
            Ok(done) => done,
            Err(picohttp::ParseResponseError::MalformedHttpResponse) => HeadParse::Invalid,
            Err(picohttp::ParseResponseError::ShortRead) => {
                if !buffered {
                    self.body.with_mut(|b| b.extend_from_slice(data));
                }
                // ShortRead means no \r\n\r\n was found, so every byte in
                // `body` is part of an incomplete header — cap that, not
                // total bytes received (which may include pipelined
                // WebSocket frames once the header does complete).
                if self.body.get().len() > bun_http::max_http_header_size() {
                    HeadParse::Invalid
                } else {
                    HeadParse::NeedMore
                }
            }
        }
    }

    /// Takes `ThisPtr<Self>` because `socket.close()` synchronously dispatches
    /// `handle_close`, and `terminate`/`process_response`/the trailing guard
    /// drop may free `this`.
    pub fn handle_data(this: ThisPtr<Self>, socket: Socket<SSL>, data: &[u8]) {
        log!("onData");

        // For tunnel mode after successful upgrade, forward all data to the tunnel
        // The tunnel will decrypt and pass to the WebSocket client
        if this.state.get() == State::Done {
            let tunnel = this.proxy.get().as_ref().and_then(|p| p.get_tunnel());
            if let Some(tunnel) = tunnel {
                WebSocketProxyTunnel::receive(tunnel, data);
            }
            return;
        }

        if this.cpp_websocket().is_none() {
            this.state.set(State::Failed);
            this.clear_data();
            // No borrow of `*this` is live across this call (handle_close reenters).
            socket.close(uws::CloseCode::Failure);
            return;
        }
        // Bumps the intrusive refcount and derefs on Drop at every return path
        // below. No `&`/`&mut Self` is live when the guard drops.
        let _guard = RefPtr::from_this(this);

        debug_assert!(this.is_same_socket(socket));

        debug_assert!(!socket.is_shutdown());

        // Handle proxy handshake response
        if this.state.get() == State::ProxyHandshake {
            Self::handle_proxy_response(this, socket, data);
            return;
        }

        // Route through proxy tunnel if TLS handshake is in progress or complete
        {
            let tunnel = this.proxy.get().as_ref().and_then(|p| p.get_tunnel());
            if let Some(tunnel) = tunnel {
                WebSocketProxyTunnel::receive(tunnel, data);
                return;
            }
        }

        let full = match this.buffer_and_parse_head(data) {
            HeadParse::Done { full, .. } => full,
            HeadParse::Invalid => {
                Self::terminate(this, ErrorCode::InvalidResponse);
                return;
            }
            HeadParse::NeedMore => return,
        };
        Self::process_websocket_upgrade_response(this, &full);
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// Forward the handshake response to C++ as a `'handshake'` event.
    fn dispatch_handshake(ws: BackRef<CppWebSocket>, response: &picohttp::Response, body: &[u8]) {
        let raw_headers: Vec<super::cpp_websocket::RawHeader> = response
            .headers
            .list
            .iter()
            .map(|h| super::cpp_websocket::RawHeader {
                name: h.name().into(),
                value: h.value().into(),
            })
            .collect();
        ws.did_receive_handshake_response(
            u16::try_from(response.status_code).unwrap_or(0),
            response.status,
            &raw_headers,
            body,
        );
    }

    /// Caller holds a `RefPtr` guard and owns `full` (must not borrow `self`).
    fn process_websocket_upgrade_response(this: ThisPtr<Self>, full: &[u8]) {
        let mut scratch = [picohttp::Header::ZERO; 128];
        let Ok(response) = picohttp::Response::parse(full, &mut scratch) else {
            return Self::terminate(this, ErrorCode::InvalidResponse);
        };
        let head_len = response.bytes_read;
        let is_101 = response.status_code == 101;

        // 101: one scope across 'upgrade'+'open' so microtasks drain after open.
        let _scope = is_101
            .then(|| bun_jsc::virtual_machine::VirtualMachine::get().enter_event_loop_scope());

        if let Some(ws) = this.cpp_websocket() {
            Self::dispatch_handshake(ws, &response, if is_101 { &[] } else { &full[head_len..] });
            if this.cpp_websocket().is_none() {
                return;
            }
        }
        Self::process_response(this, response, &full[head_len..]);
    }

    /// Takes `ThisPtr<Self>` because `terminate`/`handle_data` may free `this`.
    fn handle_proxy_response(this: ThisPtr<Self>, socket: Socket<SSL>, data: &[u8]) {
        log!("handleProxyResponse");

        const HTTP_200: &[u8] = b"HTTP/1.1 200 ";
        const HTTP_200_ALT: &[u8] = b"HTTP/1.0 200 ";
        if this.body.get().is_empty()
            && data.len() > HTTP_200.len()
            && !data.starts_with(HTTP_200)
            && !data.starts_with(HTTP_200_ALT)
        {
            // Proxy connection failed
            Self::terminate(this, ErrorCode::ProxyConnectFailed);
            return;
        }

        let (full, status_code, head_len) = match this.buffer_and_parse_head(data) {
            HeadParse::Done {
                full,
                status_code,
                head_len,
            } => (full, status_code, head_len),
            HeadParse::Invalid => {
                Self::terminate(this, ErrorCode::InvalidResponse);
                return;
            }
            HeadParse::NeedMore => return,
        };

        // Proxy returned non-200 status
        if status_code != 200 {
            if status_code == 407 {
                Self::terminate(this, ErrorCode::ProxyAuthenticationRequired);
            } else {
                Self::terminate(this, ErrorCode::ProxyConnectFailed);
            }
            return;
        }

        // Proxy tunnel established
        log!("Proxy tunnel established");

        let remain_buf: Vec<u8> = full[head_len..].to_vec();

        // Clear the body buffer for WebSocket handshake
        this.body.with_mut(|b| b.clear());

        // Proxy state must exist if we're in proxy_handshake state.
        let Some(target_https) = this.proxy.get().as_ref().map(|p| p.is_target_https()) else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };

        // For wss:// through proxy, we need to do TLS handshake inside the tunnel
        if target_https {
            Self::start_proxy_tls_handshake(this, socket, &remain_buf);
            return;
        }

        // For ws:// through proxy, send the WebSocket upgrade request (replaces
        // CONNECT request buffer; old Vec is dropped here).
        let request_buf = this
            .proxy
            .with_mut(|p| {
                p.as_mut()
                    .map(|p| p.take_websocket_request_buf().into_vec())
            })
            .unwrap_or_default();
        this.state.set(State::Reading);
        this.to_send_len.set(request_buf.len());
        this.input_body_buf.set(request_buf);

        // Send the WebSocket upgrade request
        if !Self::write_pending(this, |buf| Self::socket_write(socket, buf)) {
            return;
        }

        // If there's remaining data after the proxy response, process it
        if !remain_buf.is_empty() {
            Self::handle_data(this, socket, &remain_buf);
        }
    }

    /// Start TLS handshake inside the proxy tunnel for wss:// connections
    ///
    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    fn start_proxy_tls_handshake(this: ThisPtr<Self>, socket: Socket<SSL>, initial_data: &[u8]) {
        log!("startProxyTLSHandshake");

        // Get certificate verification setting
        let reject_unauthorized = this
            .cpp_websocket()
            .is_none_or(|ws| ws.reject_unauthorized());

        // Create proxy tunnel with all parameters.
        // Safely unwrap proxy state - it must exist if we're called from handle_proxy_response.
        // The shared borrow of `proxy` spans only `init`, which allocates.
        let tunnel = this.proxy.get().as_ref().map(|p| {
            WebSocketProxyTunnel::init::<SSL>(
                Self::upgrade_client_ref(this),
                socket,
                p.get_target_host(),
                reject_unauthorized,
            )
        });
        let Some(tunnel) = tunnel else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };

        // Use ssl_config if available, otherwise use defaults
        let ssl_options: SSLConfig = match this.ssl_config.get().as_deref() {
            Some(config) => config.clone(),
            None => {
                let mut c = SSLConfig::default();
                c.reject_unauthorized = 0; // We verify manually
                c.request_cert = 1;
                c
            }
        };

        // Start TLS handshake
        if WebSocketProxyTunnel::start(tunnel.this_ptr(), &ssl_options, initial_data).is_err() {
            drop(tunnel);
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        }

        // Re-check proxy state: `start` dispatches SSLWrapper callbacks that
        // can fail the client and take `proxy`.
        let unattached = this.proxy.with_mut(|proxy| match proxy.as_mut() {
            Some(p) => {
                p.set_tunnel(tunnel);
                None
            }
            None => Some(tunnel),
        });
        if let Some(tunnel) = unattached {
            // Nothing else holds the tunnel.
            drop(tunnel);
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        }
        this.state.set(State::Reading);
    }

    /// Called by WebSocketProxyTunnel when TLS handshake completes successfully
    ///
    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub(crate) fn on_proxy_tls_handshake_complete(this: ThisPtr<Self>) {
        log!("onProxyTLSHandshakeComplete");

        // TLS handshake done - free the CONNECT request buffer and send the
        // WebSocket upgrade request through the tunnel.
        this.state.set(State::Reading);
        this.clear_input();

        // Take the WebSocket upgrade request from proxy state (transfers
        // ownership) along with the tunnel to send it through.
        let step = this.proxy.with_mut(|proxy| {
            proxy
                .as_mut()
                .map(|p| (p.take_websocket_request_buf().into_vec(), p.get_tunnel()))
        });
        let Some((request_buf, tunnel)) = step else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };
        if request_buf.is_empty() {
            Self::terminate(this, ErrorCode::FailedToWrite);
            return;
        }
        // Store it in input_body_buf so handle_writable can retry on drain.
        this.to_send_len.set(request_buf.len());
        this.input_body_buf.set(request_buf);

        // Send through the tunnel (will be encrypted). Buffer any unwritten
        // portion in to_send so handle_writable retries when the socket drains.
        let Some(tunnel) = tunnel else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };
        Self::write_pending(this, |buf| WebSocketProxyTunnel::write(tunnel, buf).ok());
    }

    /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
    ///
    /// Takes `ThisPtr<Self>` because `terminate`/`process_response`/the guard
    /// drop may free `this`; see `fail`.
    pub(crate) fn handle_decrypted_data(this: ThisPtr<Self>, data: &[u8]) {
        log!("handleDecryptedData: {} bytes", data.len());
        let _guard = RefPtr::from_this(this);

        // Process as if it came directly from the socket.
        let full = match this.buffer_and_parse_head(data) {
            HeadParse::Done { full, .. } => full,
            HeadParse::Invalid => {
                Self::terminate(this, ErrorCode::InvalidResponse);
                return;
            }
            HeadParse::NeedMore => return,
        };
        Self::process_websocket_upgrade_response(this, &full);
    }

    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub fn handle_end(this: ThisPtr<Self>, _: Socket<SSL>) {
        log!("onEnd");
        Self::terminate(this, ErrorCode::Ended);
    }

    /// Takes `ThisPtr<Self>` because `terminate`/`tcp.close()` may
    /// synchronously dispatch `handle_close`, and the success path's double
    /// `deref` may free `this`.
    pub(crate) fn process_response(
        this: ThisPtr<Self>,
        response: picohttp::Response,
        remain_buf: &[u8],
    ) {
        let mut upgrade_header = picohttp::Header::ZERO;
        let mut connection_header_seen = false;
        let mut connection_has_upgrade = false;
        let mut websocket_accept_header = picohttp::Header::ZERO;
        let mut protocol_header_seen = false;

        // var visited_version = false;
        let mut deflate_result = DeflateNegotiationResult::default();

        if response.status_code != 101 {
            Self::terminate(this, ErrorCode::Expected101StatusCode);
            return;
        }

        for header in response.headers.list {
            match header.name().len() {
                len if len == b"Connection".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Connection",
                    ) {
                        connection_header_seen = true;
                        connection_has_upgrade |=
                            HeaderValueIterator::init(header.value()).any(|t| {
                                strings::eql_case_insensitive_ascii_check_length(t, b"upgrade")
                            });
                    }
                }
                len if len == b"Upgrade".len() => {
                    if upgrade_header.name().is_empty()
                        && strings::eql_case_insensitive_ascii_ignore_length(
                            header.name(),
                            b"Upgrade",
                        )
                    {
                        upgrade_header = *header;
                    }
                }
                len if len == b"Sec-WebSocket-Version".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Sec-WebSocket-Version",
                    ) {
                        if !strings::eql_comptime(header.value(), b"13") {
                            Self::terminate(this, ErrorCode::InvalidWebsocketVersion);
                            return;
                        }
                    }
                }
                len if len == b"Sec-WebSocket-Accept".len() => {
                    if websocket_accept_header.name().is_empty()
                        && strings::eql_case_insensitive_ascii_ignore_length(
                            header.name(),
                            b"Sec-WebSocket-Accept",
                        )
                    {
                        websocket_accept_header = *header;
                    }
                }
                len if len == b"Sec-WebSocket-Protocol".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Sec-WebSocket-Protocol",
                    ) {
                        let valid = 'brk: {
                            // Can't have multiple protocol headers in the response.
                            if protocol_header_seen {
                                break 'brk false;
                            }

                            protocol_header_seen = true;

                            let mut iterator = HeaderValueIterator::init(header.value());

                            let Some(protocol) = iterator.next() else {
                                // Can't be empty.
                                break 'brk false;
                            };

                            // Can't have multiple protocols.
                            if iterator.next().is_some() {
                                break 'brk false;
                            }

                            // Protocol must be in the list of allowed protocols.
                            if !this.subprotocols.get().contains(protocol) {
                                break 'brk false;
                            }

                            if let Some(ws) = this.cpp_websocket() {
                                ws.set_protocol(BunString::clone_latin1(protocol));
                            }
                            true
                        };

                        if !valid {
                            Self::terminate(this, ErrorCode::MismatchClientProtocol);
                            return;
                        }
                    }
                }
                len if len == b"Sec-WebSocket-Extensions".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Sec-WebSocket-Extensions",
                    ) {
                        // Per RFC 6455 §9.1, the server MUST NOT respond with an
                        // extension the client did not offer. Match upstream `ws`
                        // (lib/websocket.js: "Server sent a Sec-WebSocket-Extensions
                        // header but no extension was requested") and fail the
                        // handshake instead of silently accepting it.
                        if !this.offered_permessage_deflate {
                            Self::terminate(this, ErrorCode::InvalidResponse);
                            return;
                        }
                        // This is a simplified parser. A full parser would handle multiple extensions and quoted values.
                        for ext_str in strings::split(header.value(), b",") {
                            let mut ext_it = strings::split(strings::trim(ext_str, b" \t"), b";");
                            let ext_name = strings::trim(ext_it.next().unwrap_or(b""), b" \t");
                            if ext_name == b"permessage-deflate" {
                                deflate_result.enabled = true;
                                for param_str in ext_it {
                                    let mut param_it =
                                        strings::split(strings::trim(param_str, b" \t"), b"=");
                                    let key = strings::trim(param_it.next().unwrap_or(b""), b" \t");
                                    let value =
                                        strings::trim(param_it.next().unwrap_or(b""), b" \t");

                                    if key == b"server_no_context_takeover" {
                                        deflate_result.params.server_no_context_takeover = 1;
                                    } else if key == b"client_no_context_takeover" {
                                        deflate_result.params.client_no_context_takeover = 1;
                                    } else if key == b"server_max_window_bits" {
                                        if !value.is_empty() {
                                            // Remove quotes if present
                                            let trimmed_value = if value.len() >= 2
                                                && value[0] == b'"'
                                                && value[value.len() - 1] == b'"'
                                            {
                                                &value[1..value.len() - 1]
                                            } else {
                                                value
                                            };

                                            if let Ok(bits) =
                                                strings::parse_int::<u8>(trimmed_value, 10)
                                            {
                                                if bits >= WebSocketDeflate::Params::MIN_WINDOW_BITS
                                                    && bits
                                                        <= WebSocketDeflate::Params::MAX_WINDOW_BITS
                                                {
                                                    deflate_result.params.server_max_window_bits =
                                                        bits;
                                                }
                                            }
                                        }
                                    } else if key == b"client_max_window_bits" {
                                        if !value.is_empty() {
                                            // Remove quotes if present
                                            let trimmed_value = if value.len() >= 2
                                                && value[0] == b'"'
                                                && value[value.len() - 1] == b'"'
                                            {
                                                &value[1..value.len() - 1]
                                            } else {
                                                value
                                            };

                                            if let Ok(bits) =
                                                strings::parse_int::<u8>(trimmed_value, 10)
                                            {
                                                if bits >= WebSocketDeflate::Params::MIN_WINDOW_BITS
                                                    && bits
                                                        <= WebSocketDeflate::Params::MAX_WINDOW_BITS
                                                {
                                                    deflate_result.params.client_max_window_bits =
                                                        bits;
                                                }
                                            }
                                        } else {
                                            // client_max_window_bits without value means use default (15)
                                            deflate_result.params.client_max_window_bits = 15;
                                        }
                                    }
                                }
                                break; // Found and parsed permessage-deflate, stop.
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if upgrade_header
            .name()
            .len()
            .min(upgrade_header.value().len())
            == 0
        {
            Self::terminate(this, ErrorCode::MissingUpgradeHeader);
            return;
        }

        if !connection_header_seen {
            Self::terminate(this, ErrorCode::MissingConnectionHeader);
            return;
        }

        if websocket_accept_header
            .name()
            .len()
            .min(websocket_accept_header.value().len())
            == 0
        {
            Self::terminate(this, ErrorCode::MissingWebsocketAcceptHeader);
            return;
        }

        if !protocol_header_seen && !this.subprotocols.get().is_empty() {
            Self::terminate(this, ErrorCode::MissingClientProtocol);
            return;
        }

        if !connection_has_upgrade {
            Self::terminate(this, ErrorCode::InvalidConnectionHeader);
            return;
        }

        if !strings::eql_case_insensitive_ascii(upgrade_header.value(), b"websocket", true) {
            Self::terminate(this, ErrorCode::InvalidUpgradeHeader);
            return;
        }

        if websocket_accept_header.value() != &this.expected_accept[..] {
            Self::terminate(this, ErrorCode::MismatchWebsocketAcceptHeader);
            return;
        }

        // Ownership transfer: `overflow` is handed through C++
        // (`WebSocket__didConnect` → `Bun__WebSocketClient__init`/`_initWithTunnel`)
        // as an opaque box to the connected client's `InitialDataHandler`.
        let overflow =
            || (!remain_buf.is_empty()).then(|| Box::new(super::InitialData(remain_buf.to_vec())));

        // Check if we're using a proxy tunnel (wss:// through HTTP proxy)
        let tunnel = this.proxy.get().as_ref().and_then(|p| p.get_tunnel());
        if let Some(tunnel) = tunnel {
            // wss:// through HTTP proxy: use tunnel mode
            // For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel.
            // The socket continues to call handle_data on the upgrade client, which forwards to tunnel.
            // The tunnel forwards decrypted data to the WebSocket client.
            bun_jsc::mark_binding!();
            let tcp = this.tcp.get();
            let has_ws = this.cpp_websocket().is_some();
            if !tcp.is_closed() && has_ws {
                tcp.set_timeout(0);
                log!("onDidConnect (tunnel mode)");

                // Release the ref that paired with C++'s m_upgradeClient: C++
                // nulls m_upgradeClient inside didConnectWithTunnel() so it will
                // never call cancel() to drop it. The TCP socket's ref (released
                // in handle_close) is what keeps this struct alive to forward
                // socket data to the tunnel after we switch to .done.
                let (ws, _cpp_ref) = this.outgoing_websocket.replace(None).unwrap();

                // Switch to forwarding before entering C++. did_connect_with_tunnel
                // dispatches `open`, and an open handler that spins the event loop
                // (expect().resolves, a debugger pause) delivers socket data to
                // handle_data while this frame is on the stack; with the state
                // still `Reading` and `outgoing_websocket` taken, handle_data
                // would fail the client and close the socket. In `Done` it hands
                // the bytes to the tunnel, whose SSL engine is still inside the
                // pass that decrypted the 101 and so queues them until that pass
                // resumes, by which point C++ has attached the connected WebSocket.
                // Same order as the non-tunnel arm below, which detaches the socket
                // before did_connect.
                this.state.set(State::Done);

                // Create the WebSocket client with the tunnel
                ws.did_connect_with_tunnel(
                    tunnel,
                    overflow(),
                    if deflate_result.enabled {
                        Some(&deflate_result.params)
                    } else {
                        None
                    },
                );
            } else if tcp.is_closed() {
                Self::terminate(this, ErrorCode::Cancel);
            } else if !has_ws {
                // No borrow of `*this` spans this call (handle_close reenters).
                tcp.close(uws::CloseCode::Failure);
            }
            return;
        }

        // Normal (non-tunnel) mode — original code path. Transfer the
        // custom `OwnedSslCtx` to the connected WebSocket (it must outlive
        // the upgrade client because the socket's SSL* still references the
        // SSL_CTX inside it).
        let mut saved_secure = this.secure.replace(None); // prevent clear_data from freeing it
        // Any arm below that doesn't hand `saved_secure` to did_connect must
        // release the ref it took out of `self` (SSL_CTX_free at fn end).
        this.clear_data();
        bun_jsc::mark_binding!();
        let tcp = this.tcp.get();
        let has_ws = this.cpp_websocket().is_some();
        if !tcp.is_closed() && has_ws {
            tcp.set_timeout(0);
            log!("onDidConnect");

            let (ws, cpp_ref) = this.outgoing_websocket.replace(None).unwrap();
            let socket = tcp;

            // Normal mode: pass socket directly to WebSocket client
            this.tcp.set(Socket::<SSL>::detached());
            if let uws::InternalSocket::Connected(native_socket) = socket.socket {
                ws.did_connect(
                    bun_opaque::opaque_deref_mut(native_socket),
                    overflow(),
                    if deflate_result.enabled {
                        Some(&deflate_result.params)
                    } else {
                        None
                    },
                    // Ownership transferred to the connected client.
                    saved_secure.take(),
                );
            } else {
                Self::terminate(this, ErrorCode::FailedToConnect);
            }
            // Two refs are released here (C++'s, then the TCP socket's — the
            // socket now belongs to the connected WebSocket). The second may
            // free `this`.
            drop(cpp_ref);
            this.release_socket_ref();
        } else if tcp.is_closed() {
            Self::terminate(this, ErrorCode::Cancel);
        } else if !has_ws {
            // No borrow of `*this` spans this call (handle_close reenters).
            tcp.close(uws::CloseCode::Failure);
        }
        // Any arm above that didn't transfer ownership to `did_connect` left
        // the retained ref in `saved_secure`; RAII drop releases it now.
        drop(saved_secure);
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<Self>();
        cost += self.body.get().capacity();
        cost += self.to_send_len.get();
        cost
    }

    /// Takes `ThisPtr<Self>` because `terminate` and the trailing guard drop
    /// may free `this`; see `fail`.
    pub fn handle_writable(this: ThisPtr<Self>, socket: Socket<SSL>) {
        debug_assert!(this.is_same_socket(socket));

        // `on_writable`/`write` flush the tunnel and can reach `terminate` →
        // `handle_close`, dropping the socket's ref while this frame still
        // reads `*this`.
        let _guard = RefPtr::from_this(this);

        // Forward to proxy tunnel if active
        let tunnel = this.proxy.get().as_ref().and_then(|p| p.get_tunnel());
        if let Some(tunnel) = tunnel {
            WebSocketProxyTunnel::on_writable(tunnel);
            // In .done state (after WebSocket upgrade), just handle tunnel writes
            if this.state.get() == State::Done {
                return;
            }

            // Flush any unwritten upgrade request bytes through the tunnel
            if this.to_send_len.get() == 0 {
                return;
            }
            Self::write_pending(this, |buf| WebSocketProxyTunnel::write(tunnel, buf).ok());
            return;
        }

        if this.to_send_len.get() == 0 {
            return;
        }

        Self::write_pending(this, |buf| Self::socket_write(socket, buf));
    }

    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub fn handle_timeout(this: ThisPtr<Self>, _: Socket<SSL>) {
        Self::terminate(this, ErrorCode::Timeout);
    }

    /// In theory, this could be called immediately.
    /// In that case, we set `state` to `failed` and return, expecting the parent to call `destroy`.
    ///
    /// Takes `ThisPtr<Self>` because the trailing `deref` releases the socket
    /// ref and may free `this`; a `&mut self` argument would carry a Stacked
    /// Borrows protector that makes deallocating its referent UB.
    pub fn handle_connect_error(this: ThisPtr<Self>, _: Socket<SSL>, _: c_int) {
        this.tcp.set(Socket::<SSL>::detached());

        // For the TCP socket.
        if this.state.get() == State::Reading {
            Self::terminate(this, ErrorCode::FailedToConnect);
        } else {
            this.state.set(State::Failed);
        }

        this.release_socket_ref();
    }
}

impl<const SSL: bool> HTTPClient<SSL> {
    const TYPE_NAME: &'static str = if SSL {
        "http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(true)"
    } else {
        "http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)"
    };

    pub(crate) fn clear_input(&self) {
        self.input_body_buf.set(Vec::new());
        self.to_send_len.set(0);
    }

    pub(crate) fn clear_data(&self) {
        self.poll_ref
            .with_mut(|p| p.unref(VirtualMachineRef::get().loop_ctx()));

        self.subprotocols.with_mut(|s| s.clear_and_free());
        self.clear_input();
        self.body.set(Vec::new());

        if !self.hostname.get().is_empty() {
            self.hostname.set(ZBox::default());
        }

        // Clean up proxy state. Null the field and detach the tunnel's
        // back-reference before deinit so that SSLWrapper shutdown callbacks
        // cannot re-enter clear_data() while the proxy is still reachable.
        if let Some(proxy) = self.proxy.replace(None) {
            if let Some(tunnel) = proxy.get_tunnel() {
                tunnel.detach_upgrade_client();
            }
            drop(proxy);
        }
        // ssl_config: Option<Box<SSLConfig>> — Drop runs SSLConfig::deinit + frees the box.
        self.ssl_config.set(None);
        // secure: Option<OwnedSslCtx> — Drop releases the ref taken in `connect`.
        self.secure.set(None);
    }
}

impl<const SSL: bool> Drop for HTTPClient<SSL> {
    fn drop(&mut self) {
        self.clear_data();
        debug_assert!(self.tcp.get().is_detached());
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::TYPE_NAME, self);
    }
}

/// Header name/value pairs decoded to UTF-8 up front (borrowed when 8-bit
/// ASCII, else transcoded — never raw Latin-1/UTF-16 code units), stored flat
/// (names at even indices, values at odd) and yielded as pairs via `iter()`.
struct Headers8Bit<'a> {
    slices: Vec<Utf8Bytes<'a>>,
}

impl<'a> Headers8Bit<'a> {
    fn init(names_in: &'a [BunString], values_in: &'a [BunString]) -> Self {
        debug_assert_eq!(names_in.len(), values_in.len());
        let mut slices: Vec<Utf8Bytes<'a>> = Vec::with_capacity(names_in.len() * 2);
        for (name, value) in names_in.iter().zip(values_in) {
            slices.push(name.to_utf8());
            slices.push(value.to_utf8());
        }

        Self { slices }
    }

    fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> + '_ {
        self.slices
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (pair[0].slice(), pair[1].slice()))
    }

    /// Convert to `bun_http::Headers`.
    fn to_headers(&self) -> Headers {
        let mut headers = Headers::default();
        for (name, value) in self.iter() {
            headers.append(name, value);
        }
        headers
    }
}

/// Build HTTP CONNECT request for proxy tunneling.
fn build_connect_request(
    target_host: &[u8],
    target_port: u16,
    proxy_authorization: Option<&[u8]>,
    proxy_headers: Option<&Headers>,
) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::new();

    // CONNECT host:port HTTP/1.1\r\n
    write!(
        &mut buf,
        "CONNECT {}:{} HTTP/1.1\r\n",
        bstr::BStr::new(target_host),
        target_port
    )
    .unwrap();

    // Host: host:port\r\n
    write!(
        &mut buf,
        "Host: {}:{}\r\n",
        bstr::BStr::new(target_host),
        target_port
    )
    .unwrap();

    // Proxy-Connection: Keep-Alive\r\n
    buf.extend_from_slice(b"Proxy-Connection: Keep-Alive\r\n");

    // Proxy-Authorization if provided
    if let Some(auth) = proxy_authorization {
        write!(
            &mut buf,
            "Proxy-Authorization: {}\r\n",
            bstr::BStr::new(auth)
        )
        .expect("infallible: in-memory write");
    }

    // Custom proxy headers
    if let Some(hdrs) = proxy_headers {
        use bun_http_types::ETag::HeaderEntryColumns;
        let slice = hdrs.entries.slice();
        let names = slice.items_name();
        let values = slice.items_value();
        debug_assert_eq!(names.len(), values.len());
        for (idx, name_ptr) in names.iter().enumerate() {
            // Skip Proxy-Authorization if user provided one (we already added it)
            let name = hdrs.as_str(*name_ptr);
            if proxy_authorization.is_some()
                && strings::eql_case_insensitive_ascii(name, b"proxy-authorization", true)
            {
                continue;
            }
            write!(
                &mut buf,
                "{}: {}\r\n",
                bstr::BStr::new(name),
                bstr::BStr::new(hdrs.as_str(values[idx]))
            )
            .unwrap();
        }
    }

    // End of headers
    buf.extend_from_slice(b"\r\n");

    buf
}

struct BuildRequestResult {
    body: Vec<u8>,
    expected_accept: [u8; 28],
}

#[allow(clippy::too_many_arguments)]
fn build_request_body(
    vm: &mut VirtualMachineRef,
    pathname: &[u8],
    is_https: bool,
    host: &[u8],
    port: u16,
    client_protocol: &[u8],
    extra_headers: &Headers8Bit<'_>,
    target_authorization: Option<&[u8]>,
    // When false, don't advertise `permessage-deflate` (matches `ws` with
    // `perMessageDeflate: false`). When true, send the default extension
    // offer `permessage-deflate; client_max_window_bits`.
    offer_permessage_deflate: bool,
) -> Result<BuildRequestResult, bun_alloc::AllocError> {
    // Check for user overrides
    let mut user_host: Option<&[u8]> = None;
    let mut user_key: Option<&[u8]> = None;
    let mut user_protocol: Option<&[u8]> = None;
    let mut user_authorization = false;

    for (name_slice, value) in extra_headers.iter() {
        if user_host.is_none() && strings::eql_case_insensitive_ascii(name_slice, b"host", true) {
            user_host = Some(value);
        } else if user_key.is_none()
            && strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-key", true)
        {
            user_key = Some(value);
        } else if user_protocol.is_none()
            && strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-protocol", true)
        {
            user_protocol = Some(value);
        } else if !user_authorization
            && strings::eql_case_insensitive_ascii(name_slice, b"authorization", true)
        {
            user_authorization = true;
        }
    }

    // Validate and use user key, or generate a new one
    use bun_base64::zig_base64::STANDARD as B64_STD;
    let mut encoded_buf = [0u8; 24];
    let key: &[u8] = 'blk: {
        if let Some(k_slice) = user_key {
            let mut decoded_buf = [0u8; 24];
            if B64_STD.decoder.calc_size_for_slice(k_slice) == Ok(16)
                && B64_STD.decoder.decode(&mut decoded_buf, k_slice).is_ok()
            {
                break 'blk k_slice;
            }
        }
        // RFC 6455 §4.1: base64 of a randomly selected 16-byte value.
        B64_STD
            .encoder
            .encode(&mut encoded_buf, vm.rare_data().entropy_slice(16))
    };

    // Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
    // base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
    let expected_accept = compute_accept_value(key);

    let protocol = user_protocol.unwrap_or(client_protocol);

    let host_fmt = HostFormatter {
        is_https,
        host,
        port: Some(port),
    };

    let static_headers = [
        picohttp::Header::new(b"Sec-WebSocket-Key", key),
        picohttp::Header::new(b"Sec-WebSocket-Protocol", protocol),
    ];

    let headers_ = &static_headers[0..1 + (!protocol.is_empty()) as usize];
    let pico_headers = picohttp::Headers { headers: headers_ };

    // Build extra headers string, skipping the ones we handle
    let mut extra_headers_buf: Vec<u8> = Vec::new();

    // Add Authorization header from URL credentials if user didn't provide one
    if !user_authorization {
        if let Some(auth) = target_authorization {
            write!(
                &mut extra_headers_buf,
                "Authorization: {}\r\n",
                bstr::BStr::new(auth)
            )
            .expect("infallible: in-memory write");
        }
    }

    for (name_slice, value) in extra_headers.iter() {
        if strings::eql_any_case_insensitive_ascii(
            name_slice,
            &[
                b"host",
                b"connection",
                b"upgrade",
                b"sec-websocket-version",
                b"sec-websocket-extensions",
                b"sec-websocket-key",
                b"sec-websocket-protocol",
            ],
        ) {
            continue;
        }
        write!(
            &mut extra_headers_buf,
            "{}: {}\r\n",
            bstr::BStr::new(name_slice),
            bstr::BStr::new(value)
        )
        .unwrap();
    }

    let extensions_line: &[u8] = if offer_permessage_deflate {
        b"Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n"
    } else {
        b""
    };

    // Build request with user overrides
    let mut body: Vec<u8> = Vec::new();
    if let Some(h) = user_host {
        write!(
            &mut body,
            "GET {} HTTP/1.1\r\n\
             Host: {}\r\n\
             Connection: Upgrade\r\n\
             Upgrade: websocket\r\n\
             Sec-WebSocket-Version: 13\r\n\
             {}\
             {}\
             {}\
             \r\n",
            bstr::BStr::new(pathname),
            bstr::BStr::new(h),
            bstr::BStr::new(extensions_line),
            pico_headers,
            bstr::BStr::new(&extra_headers_buf),
        )
        .unwrap();
        return Ok(BuildRequestResult {
            body,
            expected_accept,
        });
    }

    write!(
        &mut body,
        "GET {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Connection: Upgrade\r\n\
         Upgrade: websocket\r\n\
         Sec-WebSocket-Version: 13\r\n\
         {}\
         {}\
         {}\
         \r\n",
        bstr::BStr::new(pathname),
        host_fmt,
        bstr::BStr::new(extensions_line),
        pico_headers,
        bstr::BStr::new(&extra_headers_buf),
    )
    .unwrap();
    Ok(BuildRequestResult {
        body,
        expected_accept,
    })
}

/// Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
/// base64(SHA-1(key ++ "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
fn compute_accept_value(key: &[u8]) -> [u8; 28] {
    use bun_sha_hmac::sha::hashers::SHA1;
    const WEBSOCKET_GUID: &[u8] = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = SHA1::init();
    hasher.update(key);
    hasher.update(WEBSOCKET_GUID);
    let mut hash = [0u8; SHA1::DIGEST];
    hasher.r#final(&mut hash);
    let mut result = [0u8; 28];
    let _ = bun_base64::encode(&mut result, &hash);
    result
}

// LAYERING: `Bun__WebSocket__parseSSLConfig` / `Bun__WebSocket__freeSSLConfig`
// live in `bun_runtime::socket::ssl_config` (src/runtime/socket/SSLConfig.rs).
// `SSLConfig::from_js` walks Blob/JSCArrayBuffer/node_fs values (tier-6) and
// `bun_runtime → bun_http_jsc`, so the C-ABI export is hosted upstream where
// `from_js` is defined. The result is bridged to `bun_http::ssl_config::SSLConfig`
// (the type `connect()` consumes) via `into_http()` before boxing. C++ links by
// symbol name; crate of origin is irrelevant at link time.

// ──────────────────────────────────────────────────────────────────────────
// C++ (`WebCore::WebSocket`) entry points for the generic
// `connect`/`cancel`/`memoryCost`, monomorphized for both transports; the
// `extern "C"` thunks are generated from the `HOST_EXPORT` markers.
//
// C-ABI mapping (verified against the declarations in
// src/jsc/bindings/headers.h and the call sites in WebSocket.cpp):
//   - non-null `const BunString*` params (host/path/protocols) → `&BunString`;
//   - nullable `const BunString*` params (proxyHost/proxyAuthorization/
//     targetAuthorization/unixSocketPath, passed as `nullptr` or `&local`)
//     → `Option<&BunString>` (guaranteed null-pointer niche);
//   - `const BunString*` array + `size_t` count → `&[BunString]`
//     (count may be 0 with a dangling/null begin());
//   - `void* sslConfig` (ownership transferred, boxed by
//     `Bun__WebSocket__parseSSLConfig`) → `Option<Box<SSLConfig>>`
//     (null-pointer niche; Box matches the transferred ownership).
// Keep these signatures in sync with headers.h if either side changes.
// ──────────────────────────────────────────────────────────────────────────

// HOST_EXPORT(Bun__WebSocketHTTPClient__connect, c)
#[allow(clippy::too_many_arguments)]
pub fn bun__websockethttpclient__connect(
    global: &JSGlobalObject,
    websocket: &crate::websocket_client::cpp_websocket::CppWebSocket,
    host: &BunString,
    port: u16,
    pathname: &BunString,
    client_protocol: &BunString,
    header_names: &[BunString],
    header_values: &[BunString],
    proxy_host: Option<&BunString>,
    proxy_port: u16,
    proxy_authorization: Option<&BunString>,
    proxy_header_names: &[BunString],
    proxy_header_values: &[BunString],
    ssl_config: Option<Box<bun_http::ssl_config::SSLConfig>>,
    target_is_secure: bool,
    target_authorization: Option<&BunString>,
    unix_socket_path: Option<&BunString>,
    offer_permessage_deflate: bool,
) -> *mut crate::websocket_client::websocket_upgrade_client::HttpUpgradeClient {
    HttpUpgradeClient::connect(
        global,
        websocket,
        host,
        port,
        pathname,
        client_protocol,
        header_names,
        header_values,
        proxy_host,
        proxy_port,
        proxy_authorization,
        proxy_header_names,
        proxy_header_values,
        ssl_config,
        target_is_secure,
        target_authorization,
        unix_socket_path,
        offer_permessage_deflate,
    )
    .unwrap_or(ptr::null_mut())
}

// HOST_EXPORT(Bun__WebSocketHTTPClient__cancel, c)
pub fn bun__websockethttpclient__cancel(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpUpgradeClient>,
) {
    HttpUpgradeClient::cancel(this);
}

// HOST_EXPORT(Bun__WebSocketHTTPClient__memoryCost, c)
pub fn bun__websockethttpclient__memorycost(
    this: &crate::websocket_client::websocket_upgrade_client::HttpUpgradeClient,
) -> usize {
    this.memory_cost()
}

// HOST_EXPORT(Bun__WebSocketHTTPSClient__connect, c)
#[allow(clippy::too_many_arguments)]
pub fn bun__websockethttpsclient__connect(
    global: &JSGlobalObject,
    websocket: &crate::websocket_client::cpp_websocket::CppWebSocket,
    host: &BunString,
    port: u16,
    pathname: &BunString,
    client_protocol: &BunString,
    header_names: &[BunString],
    header_values: &[BunString],
    proxy_host: Option<&BunString>,
    proxy_port: u16,
    proxy_authorization: Option<&BunString>,
    proxy_header_names: &[BunString],
    proxy_header_values: &[BunString],
    ssl_config: Option<Box<bun_http::ssl_config::SSLConfig>>,
    target_is_secure: bool,
    target_authorization: Option<&BunString>,
    unix_socket_path: Option<&BunString>,
    offer_permessage_deflate: bool,
) -> *mut crate::websocket_client::websocket_upgrade_client::HttpsUpgradeClient {
    HttpsUpgradeClient::connect(
        global,
        websocket,
        host,
        port,
        pathname,
        client_protocol,
        header_names,
        header_values,
        proxy_host,
        proxy_port,
        proxy_authorization,
        proxy_header_names,
        proxy_header_values,
        ssl_config,
        target_is_secure,
        target_authorization,
        unix_socket_path,
        offer_permessage_deflate,
    )
    .unwrap_or(ptr::null_mut())
}

// HOST_EXPORT(Bun__WebSocketHTTPSClient__cancel, c)
pub fn bun__websockethttpsclient__cancel(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpsUpgradeClient>,
) {
    HttpsUpgradeClient::cancel(this);
}

// HOST_EXPORT(Bun__WebSocketHTTPSClient__memoryCost, c)
pub fn bun__websockethttpsclient__memorycost(
    this: &crate::websocket_client::websocket_upgrade_client::HttpsUpgradeClient,
) -> usize {
    this.memory_cost()
}

pub type NewHttpUpgradeClient<const SSL: bool> = HTTPClient<SSL>;
pub type HttpUpgradeClient = HTTPClient<false>;
pub type HttpsUpgradeClient = HTTPClient<true>;
