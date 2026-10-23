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
use std::borrow::Cow;
use std::io::Write as _;

use bun_boringssl as boringssl;
use bun_collections::StringSet;
use bun_core::ZBox;
use bun_core::fmt::HostFormatter;
use bun_core::strings;
use bun_core::{String as BunString, Utf8Bytes};
use bun_http::header_has_token;
use bun_http::{HeaderValueIterator, Headers};
use bun_io::KeepAlive;
use bun_jsc::{JSGlobalObject, VirtualMachineRef};
use bun_picohttp as picohttp;
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};

use super::websocket_proxy_tunnel::IntoUpgradeClientRef;
use bun_uws::{self as uws, SocketHandler, SocketKind};

use super::cpp_websocket::{CppWebSocket, HandshakeVerdict, TlsHandshake, TlsPeer};
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

/// Opening-handshake timeout in seconds. 0 disables.
#[inline]
fn handshake_timeout_seconds() -> core::ffi::c_uint {
    bun_core::env_var::BUN_CONFIG_WS_HANDSHAKE_TIMEOUT
        .get()
        .map_or(120, |seconds| u32::try_from(seconds).unwrap_or(u32::MAX))
}

/// Max raw size of a response head. `--max-http-header-size` only counts header names, values and
/// the status text (like llhttp), so allow 1 KiB extra for separators and line endings.
#[inline]
fn max_response_head_len() -> usize {
    bun_http::max_http_header_size().saturating_add(1024)
}

/// One slot per line is enough: picohttpparser never emits more than one header per line.
fn header_slots(head: &[u8]) -> Vec<picohttp::Header> {
    vec![picohttp::Header::ZERO; strings::count_char(head, b'\n')]
}

/// `uws.NewSocketHandler(ssl)`
type Socket<const SSL: bool> = SocketHandler<SSL>;

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

/// Matches node:http's (and so `ws`'s) definition of an upgrade response: status 101, a non-empty
/// `Upgrade` header, and `upgrade` listed in `Connection`. The result is passed to ws.ts.
fn is_upgrade(response: &picohttp::Response) -> bool {
    let (mut has_upgrade, mut connection_has_upgrade) = (false, false);
    for header in response.headers.list {
        if strings::eql_case_insensitive_ascii(header.name(), b"upgrade", true) {
            has_upgrade |= !header.value().is_empty();
        } else if strings::eql_case_insensitive_ascii(header.name(), b"connection", true) {
            connection_has_upgrade |= header_has_token(header.value(), b"upgrade");
        }
    }
    response.status_code == 101 && has_upgrade && connection_has_upgrade
}

/// Remaining body of a non-upgrade response, framed per RFC 9112 §6.3.
#[derive(Clone, Copy)]
enum ResponseBody {
    Length(u64),
    Chunked(picohttp::phr_chunked_decoder),
    UntilClose,
}

impl ResponseBody {
    fn from_response(response: &picohttp::Response) -> Self {
        if matches!(response.status_code, 101 | 204 | 304) {
            return Self::Length(0);
        }
        let mut transfer_encoding: Option<bun_http::Encoding> = None;
        let mut content_length: Option<u64> = None;
        for header in response.headers.list {
            if strings::eql_case_insensitive_ascii(header.name(), b"transfer-encoding", true) {
                let coding = transfer_encoding.get_or_insert(bun_http::Encoding::Identity);
                if bun_http::fold_transfer_encoding(header.value(), coding).is_err() {
                    return Self::UntilClose;
                }
            } else if strings::eql_case_insensitive_ascii(header.name(), b"content-length", true) {
                content_length = bun_http_types::parse_content_length_strict(header.value());
            }
        }
        match transfer_encoding {
            Some(bun_http::Encoding::Chunked) => {
                let mut decoder = picohttp::phr_chunked_decoder::default();
                decoder.consume_trailer = 1;
                Self::Chunked(decoder)
            }
            Some(_) => Self::UntilClose,
            None => content_length.map_or(Self::UntilClose, Self::Length),
        }
    }

    /// Strips `data` down to body bytes, in place. Returns true once the body has ended.
    fn decode(&mut self, data: &mut Vec<u8>) -> bool {
        match self {
            Self::Length(remaining) => {
                data.truncate(usize::try_from(*remaining).unwrap_or(usize::MAX));
                *remaining -= data.len() as u64;
                *remaining == 0
            }
            Self::Chunked(decoder) => {
                let mut len = data.len();
                // SAFETY: `data` holds `len` initialized bytes. Decoding is in place and never
                // grows `len`.
                let rc = unsafe {
                    picohttp::phr_decode_chunked(&raw mut *decoder, data.as_mut_ptr(), &raw mut len)
                };
                data.truncate(len);
                // -2: needs more data. -1: malformed, so stop here and leave the body incomplete.
                if rc >= 0 {
                    *self = Self::Length(0);
                }
                rc != -2
            }
            Self::UntilClose => false,
        }
    }

    /// Whether the body counts as fully received if the peer closes the connection now.
    fn is_complete(&self) -> bool {
        matches!(self, Self::Length(0) | Self::UntilClose)
    }
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
    /// `didFail`).
    outgoing_websocket: JsCell<Option<(BackRef<CppWebSocket>, RefPtr<Self>)>>,
    /// Owned request bytes. Freed via `clear_input`.
    input_body_buf: JsCell<Vec<u8>>,
    // The unsent bytes are always a suffix of `input_body_buf`; stored here as
    // the suffix length so we don't hold a self-referential slice.
    to_send_len: Cell<usize>,
    /// Unconsumed bytes received since the last request (CONNECT or upgrade) was sent.
    body: JsCell<Vec<u8>>,
    /// Bytes of interim 1xx responses skipped since the last final response.
    interim_len: Cell<usize>,
    /// Created by the `ws` module, which runs its own handshake timer, validates the 101 itself and
    /// reads the body of a non-upgrade response.
    ws_mode: bool,
    /// `Some` while reading that body.
    response_body: Cell<Option<ResponseBody>>,
    /// Hostname used for SNI and certificate verification: `tls.serverName`, or the URL's host. Empty when unset.
    hostname: JsCell<ZBox>,
    /// The context of the script that made the WebSocket. `checkServerIdentity` runs in it.
    context: bun_jsc::ContextId,
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

    /// False when opted out via `perMessageDeflate: false`. If the server sends
    /// a `Sec-WebSocket-Extensions` header anyway, the handshake fails per
    /// RFC 6455 §9.1.
    offered_deflate: bool,
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
        // `proxy.tls`. With `has_proxy_tls`, the connection to the proxy uses only this config (`None`
        // means the defaults) and the target uses only `ssl_config`. Otherwise both use `ssl_config`.
        proxy_ssl_config: Option<&SSLConfig>,
        has_proxy_tls: bool,
        // Whether the target URL is wss:// (separate from ssl template parameter)
        target_is_secure: bool,
        // Target URL authorization (Basic auth from ws://user:pass@host)
        target_authorization: Option<&BunString>,
        // Unix domain socket path for ws+unix:// / wss+unix:// (None for TCP)
        unix_socket_path: Option<&BunString>,
        // `Sec-WebSocket-Extensions` request header value (a `permessage-deflate` offer), if any.
        extensions: Option<&BunString>,
        // Out param, only set when returning `None`: the errno name for `error.code`, if known.
        connect_error_code: &mut BunString,
    ) -> Option<*mut Self> {
        let vm = global.bun_vm().as_mut();

        debug_assert!(vm.event_loop_handle.is_some());

        let server_name_of = |config: Option<&SSLConfig>| -> Option<Box<[u8]>> {
            config
                .and_then(SSLConfig::server_name_bytes)
                .map(bun_http::strip_ipv6_brackets)
                .filter(|name| !name.is_empty())
                .map(Box::from)
        };
        let server_name = server_name_of(ssl_config.as_deref());
        let proxy_server_name = server_name_of(proxy_ssl_config);

        // These BunString inputs are always ASCII (URL parts, tokens, base64),
        // so `String.to_utf8()` borrows the 8-bit backing without allocating.
        // All slices live until end of scope (Drop).

        let host_slice = host.to_utf8();
        let pathname_slice = pathname.to_utf8();
        let client_protocol_slice = client_protocol.to_utf8();

        let extra_headers = encode_headers(header_names, header_values);

        let proxy_host_slice: Option<Utf8Bytes> = proxy_host.map(|ph| ph.to_utf8());
        let target_authorization_slice: Option<Utf8Bytes> =
            target_authorization.map(|ta| ta.to_utf8());
        let unix_socket_path_slice: Option<Utf8Bytes> = unix_socket_path.map(|usp| usp.to_utf8());
        let extensions_slice: Option<Cow<[u8]>> = extensions.map(isomorphic_encode);

        let using_proxy = proxy_host.is_some();

        // A user-supplied `Sec-WebSocket-Protocol` header overrides the `protocols` argument.
        let protocols: &[u8] = extra_headers
            .get(b"sec-websocket-protocol")
            .unwrap_or(&client_protocol_slice);

        let request_result = build_request_body(
            vm,
            pathname_slice.slice(),
            target_is_secure,
            host_slice.slice(),
            port,
            protocols,
            &extra_headers,
            target_authorization_slice.as_ref().map(|s| s.slice()),
            extensions_slice.as_deref(),
        );
        let body = request_result.body;

        // Build proxy state if using proxy.
        // The CONNECT request is built using local variables for proxy_authorization and proxy_headers
        // which are freed immediately after building the request (not stored on the client).
        // Ownership of `body` moves into the proxy; the CONNECT
        // request becomes the initial input_body_buf instead.
        let (proxy_state, input_body_buf): (Option<WebSocketProxy>, Vec<u8>) = if using_proxy {
            let proxy_auth: Option<Utf8Bytes> = proxy_authorization.map(|auth| auth.to_utf8());
            let mut connect_request: Vec<u8> = Vec::new();
            bun_http::write_connect_request(
                &mut connect_request,
                host_slice.slice(),
                port.to_string().as_bytes(),
                proxy_auth.as_ref().map(|s| s.slice()),
                Some(&encode_headers(proxy_header_names, proxy_header_values)),
            );

            // Duplicate target_host (needed for SNI during TLS handshake).
            let target_host_dup: Box<[u8]> = match &server_name {
                Some(name) => name.clone(),
                None => Box::from(host_slice.slice()),
            };

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
            let mut it = HeaderValueIterator::init(protocols);
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
        let context = websocket.context();
        let group = global
            .bun_vm()
            .as_mut()
            .client_socket_groups_in(context)
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
                // Through a proxy this socket's peer is the proxy.
                let socket_config = if has_proxy_tls {
                    proxy_ssl_config
                } else {
                    ssl_config.as_deref()
                };
                if let Some(config) = socket_config {
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
            body: JsCell::new(Vec::new()),
            interim_len: Cell::new(0),
            ws_mode: websocket.is_ws_mode(),
            response_body: Cell::new(None),
            hostname: JsCell::new(ZBox::default()),
            context: context.id(),
            poll_ref: JsCell::new(poll_ref),
            state: Cell::new(State::Initializing),
            proxy: JsCell::new(proxy_state),
            ssl_config: JsCell::new(ssl_config),
            secure: JsCell::new(secure),
            expected_accept: request_result.expected_accept,
            offered_deflate: extensions_slice.is_some(),
            subprotocols: JsCell::new(subprotocols),
        });
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::TYPE_NAME, client.as_ptr());
        let this = client.this_ptr();

        let sock = match &unix_socket_path_slice {
            // ws+unix:// / wss+unix://. C++ never passes a proxy with these.
            Some(path) => Socket::<SSL>::connect_unix_group(
                group,
                kind,
                secure_ptr,
                path.slice(),
                client.as_ptr(),
                false,
            ),
            None => Socket::<SSL>::connect_group(
                group,
                kind,
                secure_ptr,
                display_host,
                c_int::from(connect_port),
                client.as_ptr(),
                false,
            ),
        }
        .inspect_err(|_| *connect_error_code = last_connect_error_code())
        .ok()?;
        this.tcp.set(sock);
        // I don't think this case gets reached.
        if this.state.get() == State::Failed {
            sock.take_ext_owner::<Self>();
            return None;
        }
        bun_analytics::features::web_socket.fetch_add(1, core::sync::atomic::Ordering::Relaxed);

        if SSL {
            // A user-supplied Host header does NOT affect SNI.
            // Through a proxy this socket's peer is the proxy; `server_name` names the target.
            let peer_name = if using_proxy {
                &proxy_server_name
            } else {
                &server_name
            };
            let sni: &[u8] = match peer_name {
                Some(name) => name,
                None => bun_http::strip_ipv6_brackets(display_host),
            };
            if !sni.is_empty() {
                this.hostname.set(ZBox::from_bytes(sni));
            }
        }

        sock.set_timeout(this.handshake_timeout());
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

    /// Disabled for `ws`, which implements `handshakeTimeout` with its own timer and has no
    /// handshake timeout by default.
    fn handshake_timeout(&self) -> core::ffi::c_uint {
        if self.ws_mode {
            0
        } else {
            handshake_timeout_seconds()
        }
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
        // `handle_close` / `handle_connect_error` releases the socket-userdata ref.
        tcp.close(uws::CloseCode::Normal);
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// `system_code` becomes `error.code`; `detail` is appended to `error.message`.
    ///
    /// Takes `ThisPtr<Self>` because `did_fail` may run JS that re-enters via
    /// `cancel()`, and `tcp.close()` synchronously dispatches `handle_close`.
    fn fail(this: ThisPtr<Self>, code: ErrorCode, system_code: BunString, detail: BunString) {
        log!("onFail: {}", <&'static str>::from(code));
        bun_jsc::mark_binding!();
        // Copy `tcp` out before dispatch so nothing touches `*this` after the
        // FFI call (which may reenter and pop our tag).
        let tcp = this.tcp.get();
        Self::report_failure(this, code, system_code, detail);

        // A failed upgrade (bad status line, mismatched subprotocol, invalid
        // headers, ...) is an application-level rejection of a healthy TCP
        // connection — close it gracefully (FIN) like Node's ws client does.
        // A Failure close arms SO_LINGER{1,0} and sends an RST, which the
        // server observes as ECONNRESET on a connection it served correctly.
        tcp.close(uws::CloseCode::Normal);
    }

    /// Notifies C++ at most once. If we're reading a non-upgrade response's body, that response was
    /// already reported as the outcome, so this only ends the body instead of reporting a failure.
    fn report_failure(
        this: ThisPtr<Self>,
        code: ErrorCode,
        system_code: BunString,
        detail: BunString,
    ) {
        if let Some((ws, _cpp_ref)) = this.outgoing_websocket.replace(None) {
            match this.response_body.take() {
                Some(body) => ws.did_end_response_body(
                    // Our own timeout always aborts, since the peer never ended the body.
                    code == ErrorCode::Timeout || !body.is_complete(),
                    !system_code.is_empty(),
                ),
                None => ws.did_fail(code, 0, system_code, detail),
            }
        }
    }

    /// Takes `ThisPtr<Self>` because the trailing `deref` releases the socket
    /// ref and on the normal path frees `this`; a `&mut self` argument would
    /// carry a Stacked Borrows protector that makes deallocating it UB.
    pub fn handle_close(this: ThisPtr<Self>, _: Socket<SSL>, code: c_int, _: *mut c_void) {
        log!("onClose");
        bun_jsc::mark_binding!();
        this.clear_data();
        this.tcp.set(Socket::<SSL>::detached());
        // Values above the `CloseCode` range are the errno of a failed read. A FIN goes through
        // `handle_end` instead.
        let (system_code, detail) = match socket_errno_name(code).filter(|_| code > 2) {
            Some(name) => (
                BunString::static_(name),
                BunString::create_format(format_args!("read {name}")),
            ),
            None => (BunString::EMPTY, BunString::EMPTY),
        };
        Self::report_failure(this, ErrorCode::Ended, system_code, detail);
        this.release_socket_ref();
    }

    /// See `fail`.
    pub(crate) fn terminate(this: ThisPtr<Self>, code: ErrorCode) {
        Self::fail(this, code, BunString::EMPTY, BunString::EMPTY);
        // We cannot access the pointer after fail is called.
    }

    /// `completed`: the TLS handshake succeeded but `accepts_tls_peer` rejected the peer.
    pub(crate) fn fail_tls(
        this: ThisPtr<Self>,
        ssl_error: uws::us_bun_verify_error_t,
        completed: bool,
    ) {
        let (code, reason) = if completed && ssl_error.error_no == 0 {
            (
                BunString::static_("ERR_TLS_CERT_ALTNAME_INVALID"),
                BunString::static_("Hostname/IP does not match certificate's altnames"),
            )
        } else {
            (
                BunString::clone_utf8(ssl_error.code_bytes()),
                BunString::clone_utf8(ssl_error.reason_bytes()),
            )
        };
        Self::fail(this, ErrorCode::TlsHandshakeFailed, code, reason);
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

        if handshake_success {
            let Some(ws) = this.cpp_websocket() else {
                return;
            };
            // `tls.checkServerIdentity` may close the WebSocket, which frees `this`.
            let _guard = RefPtr::from_this(this);
            // That close clears `hostname`, so the name is moved out while the verdict borrows it.
            let hostname = this.hostname.take();
            let ssl = socket.ssl_mut();
            let name = identity_name(hostname.as_bytes(), ssl.as_deref());
            let handshake = TlsHandshake::First {
                context: this.context,
                peer: this.tls_peer(),
            };
            let accepted = ws.accepts_tls_peer(handshake, ssl, ssl_error.error_no == 0, &name);
            if this.cpp_websocket().is_none() {
                return;
            }
            this.hostname.set(hostname);
            if !accepted {
                log!(
                    "TLS handshake failed: ssl_error={}, has_custom_ctx={}",
                    ssl_error.error_no,
                    this.secure.get().is_some()
                );
                Self::fail_tls(this, ssl_error, true);
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            Self::fail_tls(this, ssl_error, false);
        }
    }

    /// The name check inside the handshake. See `CppWebSocket::server_identity`.
    pub fn server_identity(&self, ssl: &mut boringssl::c::SSL) -> boringssl::ServerIdentity {
        let Some(ws) = self.cpp_websocket() else {
            return boringssl::ServerIdentity::Unchecked;
        };
        let hostname = identity_name(self.hostname.get().as_bytes(), Some(ssl));
        ws.server_identity(self.tls_peer(), ssl, &hostname)
    }

    /// Through a proxy this socket's peer is the proxy. The tunnel handshakes with the target.
    fn tls_peer(&self) -> TlsPeer {
        if self.proxy.get().is_some() {
            TlsPeer::Proxy
        } else {
            TlsPeer::Target
        }
    }

    /// `server_identity` for the tunnel, whose peer is the target.
    pub(crate) fn tunnel_server_identity(
        this: ThisPtr<Self>,
        ssl: &mut boringssl::c::SSL,
        hostname: &[u8],
    ) -> boringssl::ServerIdentity {
        this.cpp_websocket()
            .map_or(boringssl::ServerIdentity::Unchecked, |ws| {
                ws.server_identity(TlsPeer::Target, ssl, hostname)
            })
    }

    /// `accepts_tls_peer` for the tunnel, whose peer is the target.
    pub(crate) fn accepts_tunnel_peer(
        this: ThisPtr<Self>,
        ssl: Option<&mut boringssl::c::SSL>,
        chain_verified: bool,
        hostname: &[u8],
    ) -> bool {
        let handshake = TlsHandshake::First {
            context: this.context,
            peer: TlsPeer::Target,
        };
        this.cpp_websocket()
            .is_some_and(|ws| ws.accepts_tls_peer(handshake, ssl, chain_verified, hostname))
    }

    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub fn handle_open(this: ThisPtr<Self>, socket: Socket<SSL>) {
        log!("onOpen");
        this.tcp.set(socket);
        // `us_internal_socket_after_open` zeroes the socket timeout when the
        // SEMI_SOCKET opens, so the value `connect()` armed only covered the
        // TCP connect. Re-arm so an accept-but-never-answer peer times out.
        socket.set_timeout(this.handshake_timeout());

        debug_assert!(!this.input_body_buf.get().is_empty());
        debug_assert!(this.to_send_len.get() == 0);

        if SSL {
            let hostname = this.hostname.get();
            if !hostname.is_empty() {
                if let Some(ssl) = socket.ssl_mut() {
                    bun_http::configure_http_client_with_alpn(
                        ssl,
                        if bun_core::ip_address::is_ip_host(hostname.as_bytes()) {
                            core::ptr::null()
                        } else {
                            hostname.as_ptr()
                        },
                        bun_http::AlpnOffer::H1,
                    );
                }
            }
            if this
                .cpp_websocket()
                .is_some_and(|ws| ws.reject_unauthorized(this.tls_peer()))
            {
                socket.set_inline_reject();
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

    /// Appends `data` to `body`. Once `body` starts with a complete response head, calls `on_head`
    /// with the parsed response and the bytes after it. Skips interim 1xx responses, and fails the
    /// connection if the head is malformed or too large. All interim responses together may be as
    /// large as one head, or a server could keep the client parsing them forever. The result
    /// depends only on the bytes received so far, not on how they were split across reads.
    ///
    /// `on_head` gets a copy and the head stays in `body`: a `handshake` listener can spin the event
    /// loop, and the next read then appends after it.
    fn with_response_head(
        this: ThisPtr<Self>,
        data: &[u8],
        on_head: impl FnOnce(&picohttp::Response, &[u8]),
    ) {
        this.body.with_mut(|b| b.extend_from_slice(data));
        let received = this.body.get().clone();
        let mut unparsed: &[u8] = &received;
        let cap = max_response_head_len();
        let drop_interim = |unparsed: &[u8]| {
            this.body
                .with_mut(|b| drop(b.drain(..received.len() - unparsed.len())));
        };
        loop {
            let window = &unparsed[..unparsed.len().min(cap)];
            let mut slots = header_slots(window);
            let error = match picohttp::Response::parse(window, &mut slots) {
                Ok(response) if matches!(response.status_code, 100 | 102..=199) => {
                    unparsed = &unparsed[response.bytes_read..];
                    this.interim_len
                        .set(this.interim_len.get() + response.bytes_read);
                    if this.interim_len.get() <= cap {
                        continue;
                    }
                    ErrorCode::ResponseHeadersTooLarge
                }
                Ok(response) => {
                    drop_interim(unparsed);
                    this.interim_len.set(0);
                    return on_head(&response, &unparsed[response.bytes_read..]);
                }
                Err(picohttp::ParseResponseError::MalformedHttpResponse) => {
                    ErrorCode::InvalidResponse
                }
                // picohttpparser validates nothing until it has 9 bytes, so check the prefix here.
                Err(picohttp::ParseResponseError::ShortRead)
                    if !b"HTTP/1.".starts_with(&window[..window.len().min(7)]) =>
                {
                    ErrorCode::InvalidResponse
                }
                Err(picohttp::ParseResponseError::ShortRead) if unparsed.len() > cap => {
                    ErrorCode::ResponseHeadersTooLarge
                }
                Err(picohttp::ParseResponseError::ShortRead) => return drop_interim(unparsed),
            };
            return Self::terminate(this, error);
        }
    }

    /// Takes `ThisPtr<Self>` because `socket.close()` synchronously dispatches
    /// `handle_close`, and `terminate`/`complete_upgrade`/the trailing guard
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

        Self::handle_upgrade_response_data(this, data);
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// Caller holds a `RefPtr` guard.
    fn handle_upgrade_response_data(this: ThisPtr<Self>, data: &[u8]) {
        if this.response_body.get().is_some() {
            return Self::handle_response_body(this, data);
        }
        Self::with_response_head(this, data, |response, rest| {
            Self::process_websocket_upgrade_response(this, response, rest);
        });
    }

    /// Caller holds a `RefPtr` guard. `response` and `rest` must not borrow `self`.
    fn process_websocket_upgrade_response(
        this: ThisPtr<Self>,
        response: &picohttp::Response,
        rest: &[u8],
    ) {
        let Some(ws) = this.cpp_websocket() else {
            return Self::terminate(this, ErrorCode::Cancel);
        };
        let vm = bun_jsc::virtual_machine::VirtualMachine::get();
        let is_101 = response.status_code == 101;
        let should_read_body = this.ws_mode && !is_upgrade(response);
        if should_read_body {
            this.response_body
                .set(Some(ResponseBody::from_response(response)));
            this.body.set(rest.to_vec());
            // Emit 'unexpected-response' and any body bytes that arrived with the head before
            // draining microtasks, like node:http, whose parser finishes its current chunk.
            let _scope = vm.enter_event_loop_scope();
            ws.did_receive_handshake_response(response, false, &[]);
            return Self::handle_response_body(this, &[]);
        }
        let verdict = {
            // Don't drain microtasks between 'upgrade' and 'open'. `did_connect` drains them
            // after 'open'.
            let _scope = is_101.then(|| vm.enter_event_loop_scope_without_checkpoint());
            let body: &[u8] = if is_101 { &[] } else { rest };
            ws.did_receive_handshake_response(response, true, body)
        };
        if this.cpp_websocket().is_none() {
            // The listener closed the WebSocket, so `did_connect` won't run. Drain microtasks
            // here instead.
            drop(vm.enter_event_loop_scope());
            return;
        }
        let deflate_params = if this.ws_mode {
            let HandshakeVerdict::Accepted { deflate } = verdict else {
                // An 'upgrade' listener threw, so nothing validated the response. Like npm ws, stay
                // CONNECTING until the user closes the WebSocket, and drop whatever else arrives.
                this.response_body.set(Some(ResponseBody::UntilClose));
                this.body.set(Vec::new());
                drop(vm.enter_event_loop_scope());
                return;
            };
            deflate
        } else if !is_101 {
            let status = BunString::create_format(format_args!("{}", response.status_code));
            return Self::fail(
                this,
                ErrorCode::Expected101StatusCode,
                BunString::EMPTY,
                status,
            );
        } else {
            match this.validate_upgrade(response) {
                Ok(deflate) => deflate,
                Err(code) => return Self::terminate(this, code),
            }
        };
        Self::complete_upgrade(this, deflate_params, rest);
    }

    /// Caller holds a `RefPtr` guard.
    fn handle_response_body(this: ThisPtr<Self>, data: &[u8]) {
        let (Some(mut body), Some(ws)) = (this.response_body.get(), this.cpp_websocket()) else {
            return;
        };
        let mut chunk = this.body.take();
        chunk.extend_from_slice(data);
        let ended = body.decode(&mut chunk);
        this.response_body.set(Some(body));
        // `ws` has no timeout for the body, so use ours as an idle timeout between chunks.
        if !ws.is_paused() {
            this.tcp.get().set_timeout(handshake_timeout_seconds());
        }
        if !chunk.is_empty() {
            ws.did_receive_response_body(&chunk);
        }
        if ended {
            Self::terminate(this, ErrorCode::Ended);
        }
    }

    /// `pause()` / `resume()` while CONNECTING only apply to a non-upgrade response's body, never to
    /// the handshake. Data that was already read is still delivered. While paused, the idle timeout
    /// is off and the socket doesn't keep the process alive, like node:http.
    ///
    /// Takes `ThisPtr<Self>` because `resume_stream()` closes the socket if it can't re-register the
    /// poll; see `cancel`.
    pub(crate) fn set_paused(this: ThisPtr<Self>, paused: bool) {
        if this.response_body.get().is_none() {
            return;
        }
        let _guard = RefPtr::from_this(this);
        let tcp = this.tcp.get();
        if paused {
            tcp.set_timeout(0);
            this.poll_ref
                .with_mut(|p| p.unref(VirtualMachineRef::get().loop_ctx()));
            tcp.pause_stream();
        } else {
            tcp.set_timeout(handshake_timeout_seconds());
            this.poll_ref
                .with_mut(|p| p.r#ref(VirtualMachineRef::get().loop_ctx()));
            tcp.resume_stream();
        }
    }

    /// Takes `ThisPtr<Self>` because `terminate`/`handle_data` may free `this`.
    fn handle_proxy_response(this: ThisPtr<Self>, socket: Socket<SSL>, data: &[u8]) {
        log!("handleProxyResponse");
        Self::with_response_head(this, data, |response, remain_buf| {
            Self::process_proxy_response(this, socket, response, remain_buf);
        });
    }

    /// `response` and `remain_buf` must not borrow `self`.
    fn process_proxy_response(
        this: ThisPtr<Self>,
        socket: Socket<SSL>,
        response: &picohttp::Response,
        remain_buf: &[u8],
    ) {
        if !bun_http::is_successful_connect_status(response.status_code) {
            let code = if response.status_code == 407 {
                ErrorCode::ProxyAuthenticationRequired
            } else {
                ErrorCode::ProxyConnectFailed
            };
            let mut status_line = response.status_code.to_string().into_bytes();
            if !response.status.is_empty() {
                status_line.push(b' ');
                status_line.extend_from_slice(response.status);
            }
            let detail = BunString::clone_latin1(&status_line);
            return Self::fail(this, code, BunString::EMPTY, detail);
        }

        // Proxy tunnel established
        log!("Proxy tunnel established");

        // Clear the body buffer for WebSocket handshake
        this.body.with_mut(|b| b.clear());

        // Proxy state must exist if we're in proxy_handshake state.
        let Some(target_https) = this.proxy.get().as_ref().map(|p| p.is_target_https()) else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };

        // For wss:// through proxy, we need to do TLS handshake inside the tunnel
        if target_https {
            Self::start_proxy_tls_handshake(this, socket, remain_buf);
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
            Self::handle_data(this, socket, remain_buf);
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
            .is_none_or(|ws| ws.reject_unauthorized(TlsPeer::Target));

        // Create proxy tunnel with all parameters.
        // Safely unwrap proxy state - it must exist if we're called from handle_proxy_response.
        // The shared borrow of `proxy` spans only `init`, which allocates.
        let tunnel = this.proxy.get().as_ref().map(|p| {
            WebSocketProxyTunnel::init::<SSL>(
                Self::upgrade_client_ref(this),
                socket,
                p.get_target_host(),
            )
        });
        let Some(tunnel) = tunnel else {
            Self::terminate(this, ErrorCode::ProxyTunnelFailed);
            return;
        };

        // Use ssl_config if available, otherwise use defaults
        let ssl_options: SSLConfig = match this.ssl_config.get().as_deref() {
            Some(config) => config.clone(),
            None => bun_jsc::virtual_machine::VirtualMachine::get()
                .tls_config(Default::default(), false),
        };

        // Start TLS handshake
        if WebSocketProxyTunnel::start(
            tunnel.this_ptr(),
            &ssl_options,
            reject_unauthorized,
            initial_data,
        )
        .is_err()
        {
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
        // This is a TLS renegotiation. The request was already sent after the first handshake.
        if request_buf.is_empty() {
            return;
        }
        // TLS handshake done - free the CONNECT request buffer and send the
        // WebSocket upgrade request through the tunnel.
        this.state.set(State::Reading);
        this.clear_input();
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
    /// Takes `ThisPtr<Self>` because `terminate`/`complete_upgrade`/the guard
    /// drop may free `this`; see `fail`.
    pub(crate) fn handle_decrypted_data(this: ThisPtr<Self>, data: &[u8]) {
        log!("handleDecryptedData: {} bytes", data.len());
        let _guard = RefPtr::from_this(this);

        // Process as if it came directly from the socket.
        Self::handle_upgrade_response_data(this, data);
    }

    /// Takes `ThisPtr<Self>` because `terminate` may free `this`; see `fail`.
    pub fn handle_end(this: ThisPtr<Self>, _: Socket<SSL>) {
        log!("onEnd");
        Self::terminate(this, ErrorCode::Ended);
    }

    /// The global `WebSocket`'s checks on a 101 (RFC 6455 §4.1). Returns the negotiated
    /// `permessage-deflate` params, if any. `ws` validates in JS instead: see `HandshakeVerdict`.
    fn validate_upgrade(
        &self,
        response: &picohttp::Response,
    ) -> Result<Option<WebSocketDeflate::Params>, ErrorCode> {
        let mut upgrade_header = picohttp::Header::ZERO;
        let mut connection_header_seen = false;
        let mut connection_has_upgrade = false;
        let mut websocket_accept_header = picohttp::Header::ZERO;
        let mut protocol_header_seen = false;

        let mut deflate_params: Option<WebSocketDeflate::Params> = None;

        for header in response.headers.list {
            match header.name().len() {
                len if len == b"Connection".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Connection",
                    ) {
                        connection_header_seen = true;
                        connection_has_upgrade |= header_has_token(header.value(), b"upgrade");
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
                            return Err(ErrorCode::InvalidWebsocketVersion);
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
                            if !self.subprotocols.get().contains(protocol) {
                                break 'brk false;
                            }

                            if let Some(ws) = self.cpp_websocket() {
                                ws.set_protocol(BunString::clone_latin1(protocol));
                            }
                            true
                        };

                        if !valid {
                            return Err(ErrorCode::MismatchClientProtocol);
                        }
                    }
                }
                len if len == b"Sec-WebSocket-Extensions".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Sec-WebSocket-Extensions",
                    ) {
                        // RFC 6455 §9.1: only extensions we offered are allowed, each at most once.
                        if !self.offered_deflate || deflate_params.is_some() {
                            return Err(ErrorCode::UnsupportedExtension);
                        }
                        deflate_params = parse_deflate_response(header.value());
                        if deflate_params.is_none() {
                            return Err(ErrorCode::UnsupportedExtension);
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
            return Err(ErrorCode::MissingUpgradeHeader);
        }

        if !connection_header_seen {
            return Err(ErrorCode::MissingConnectionHeader);
        }

        if websocket_accept_header
            .name()
            .len()
            .min(websocket_accept_header.value().len())
            == 0
        {
            return Err(ErrorCode::MissingWebsocketAcceptHeader);
        }

        if !protocol_header_seen && !self.subprotocols.get().is_empty() {
            return Err(ErrorCode::MissingClientProtocol);
        }

        if !connection_has_upgrade {
            return Err(ErrorCode::InvalidConnectionHeader);
        }

        if !strings::eql_case_insensitive_ascii(upgrade_header.value(), b"websocket", true) {
            return Err(ErrorCode::InvalidUpgradeHeader);
        }

        if websocket_accept_header.value() != &self.expected_accept[..] {
            return Err(ErrorCode::MismatchWebsocketAcceptHeader);
        }

        Ok(deflate_params)
    }

    /// The 101 passed validation: hand the socket to the connected client. `remain_buf` holds the
    /// bytes received after the response head.
    ///
    /// Takes `ThisPtr<Self>` because `terminate`/`tcp.close()` may
    /// synchronously dispatch `handle_close`, and the success path's double
    /// `deref` may free `this`.
    fn complete_upgrade(
        this: ThisPtr<Self>,
        deflate_params: Option<WebSocketDeflate::Params>,
        remain_buf: &[u8],
    ) {
        // Ownership transfer: `overflow` is handed through C++
        // (`WebSocket__didConnect` → `Bun__WebSocketClient__init`/`_initWithTunnel`)
        // as an opaque box to the connected client.
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
                // This struct stays alive for the whole connection and `Done` never reads `body`,
                // so free it now.
                this.body.set(Vec::new());
                // The connected client holds its own.
                this.poll_ref
                    .with_mut(|p| p.unref(VirtualMachineRef::get().loop_ctx()));

                // Create the WebSocket client with the tunnel
                ws.did_connect_with_tunnel(tunnel, overflow(), deflate_params.as_ref());
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
        // The connected client checks a TLS renegotiation against this name.
        let verified_hostname = this.hostname.take();
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
                ws.did_connect::<SSL>(
                    bun_opaque::opaque_deref_mut(native_socket),
                    overflow(),
                    deflate_params.as_ref(),
                    // Ownership transferred to the connected client.
                    saved_secure.take(),
                    verified_hostname.as_bytes(),
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
    pub fn handle_timeout(this: ThisPtr<Self>, socket: Socket<SSL>) {
        if this.state.get() == State::Done {
            socket.close_now();
            return;
        }
        Self::terminate(this, ErrorCode::Timeout);
    }

    /// In theory, this could be called immediately.
    /// In that case, we set `state` to `failed` and return, expecting the parent to call `destroy`.
    ///
    /// Takes `ThisPtr<Self>` because the trailing `deref` releases the socket
    /// ref and may free `this`; a `&mut self` argument would carry a Stacked
    /// Borrows protector that makes deallocating its referent UB.
    pub fn handle_connect_error(this: ThisPtr<Self>, socket: Socket<SSL>, errno: c_int) {
        this.tcp.set(Socket::<SSL>::detached());

        // For the TCP socket.
        if this.state.get() == State::Reading {
            let code: &'static str = if socket.dns_error() != 0 {
                "ENOTFOUND"
            } else {
                socket_errno_name(errno).unwrap_or("ECONNREFUSED")
            };
            Self::fail(
                this,
                ErrorCode::FailedToConnect,
                BunString::static_(code),
                BunString::EMPTY,
            );
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

fn socket_errno_name(errno: c_int) -> Option<&'static str> {
    uws::SocketGroup::errno(errno).map(Into::into)
}

/// Errno name after `socket(2)` / `connect(2)` failed synchronously. Winsock doesn't set `errno`.
fn last_connect_error_code() -> BunString {
    if cfg!(windows) {
        return BunString::EMPTY;
    }
    socket_errno_name(bun_core::ffi::errno()).map_or(BunString::EMPTY, BunString::static_)
}

/// Encodes a header name or value the way `fetch` does: one byte per code unit
/// (<https://fetch.spec.whatwg.org/#concept-header-value>). C++ has already rejected
/// anything above U+00FF.
fn isomorphic_encode(s: &BunString) -> Cow<'_, [u8]> {
    if !s.is_utf16() {
        return Cow::Borrowed(s.latin1());
    }
    s.utf16()
        .iter()
        .map(|&unit| u8::try_from(unit).unwrap_or(b'?'))
        .collect()
}

fn encode_headers(names: &[BunString], values: &[BunString]) -> Headers {
    debug_assert_eq!(names.len(), values.len());
    let mut headers = Headers::default();
    for (name, value) in names.iter().zip(values) {
        headers.append(&isomorphic_encode(name), &isomorphic_encode(value));
    }
    headers
}

fn write_header_line(buf: &mut Vec<u8>, name: &[u8], value: &[u8]) {
    buf.extend_from_slice(name);
    buf.extend_from_slice(b": ");
    buf.extend_from_slice(value);
    buf.extend_from_slice(b"\r\n");
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
    protocols: &[u8],
    extra_headers: &Headers,
    target_authorization: Option<&[u8]>,
    extensions: Option<&[u8]>,
) -> BuildRequestResult {
    // Validate and use user key, or generate a new one
    use bun_base64::zig_base64::STANDARD as B64_STD;
    let mut encoded_buf = [0u8; 24];
    let key: &[u8] = 'blk: {
        if let Some(k_slice) = extra_headers.get(b"sec-websocket-key") {
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

    // Append raw bytes. Formatting header bytes with `Display` would replace invalid UTF-8.
    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(b"GET ");
    body.extend_from_slice(pathname);
    body.extend_from_slice(b" HTTP/1.1\r\n");
    match extra_headers.get(b"host") {
        Some(user_host) => write_header_line(&mut body, b"Host", user_host),
        None => {
            let host_fmt = HostFormatter {
                is_https,
                host,
                port: Some(port),
            };
            write!(&mut body, "Host: {host_fmt}\r\n").expect("infallible: in-memory write");
        }
    }
    body.extend_from_slice(
        b"Connection: Upgrade\r\n\
          Upgrade: websocket\r\n\
          Sec-WebSocket-Version: 13\r\n",
    );
    if let Some(extensions) = extensions {
        write_header_line(&mut body, b"Sec-WebSocket-Extensions", extensions);
    }
    write_header_line(&mut body, b"Sec-WebSocket-Key", key);
    if !protocols.is_empty() {
        write_header_line(&mut body, b"Sec-WebSocket-Protocol", protocols);
    }

    // Add Authorization header from URL credentials if user didn't provide one
    if let Some(auth) = target_authorization {
        if extra_headers.get(b"authorization").is_none() {
            write_header_line(&mut body, b"Authorization", auth);
        }
    }

    use bun_http_types::ETag::HeaderEntryColumns;
    let names = extra_headers.entries.items_name();
    let values = extra_headers.entries.items_value();
    for (name, value) in names.iter().zip(values) {
        let name = extra_headers.as_str(*name);
        if strings::eql_any_case_insensitive_ascii(
            name,
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
        write_header_line(&mut body, name, extra_headers.as_str(*value));
    }
    body.extend_from_slice(b"\r\n");

    BuildRequestResult {
        body,
        expected_accept,
    }
}

fn parse_window_bits(value: &[u8]) -> Option<u8> {
    use WebSocketDeflate::Params;

    let digits = value
        .strip_prefix(b"\"")
        .and_then(|v| v.strip_suffix(b"\""))
        .unwrap_or(value);
    let bits = match *digits {
        [d @ b'0'..=b'9'] => d - b'0',
        [b'1', d @ b'0'..=b'9'] => 10 + (d - b'0'),
        _ => return None,
    };
    (Params::MIN_WINDOW_BITS..=Params::MAX_WINDOW_BITS)
        .contains(&bits)
        .then_some(bits)
}

/// Validates the server's response to the global `WebSocket`'s offer, which is always
/// `permessage-deflate; client_max_window_bits` (`WebSocketOptions::extensions` in WebSocket.h), and
/// returns the negotiated params (RFC 7692 §7.1). `None` for a different extension, an unknown or
/// repeated parameter, or a missing or out-of-range value.
fn parse_deflate_response(response: &[u8]) -> Option<WebSocketDeflate::Params> {
    let mut parts = strings::split(response, b";").map(|part| strings::trim(part, b" \t"));
    if parts.next()? != b"permessage-deflate" {
        return None;
    }
    let mut params = WebSocketDeflate::Params::default();
    let (mut server_bits, mut client_bits) = (None, None);
    for part in parts {
        let (key, bits) = match strings::split_once_char(part, b'=') {
            Some((key, value)) => (key, Some(parse_window_bits(value)?)),
            None => (part, None),
        };
        match (key, bits) {
            (b"server_no_context_takeover", None) if params.server_no_context_takeover == 0 => {
                params.server_no_context_takeover = 1;
            }
            (b"client_no_context_takeover", None) if params.client_no_context_takeover == 0 => {
                params.client_no_context_takeover = 1;
            }
            (b"server_max_window_bits", Some(_)) if server_bits.is_none() => server_bits = bits,
            (b"client_max_window_bits", Some(_)) if client_bits.is_none() => client_bits = bits,
            _ => return None,
        }
    }
    params.server_max_window_bits = server_bits.unwrap_or(params.server_max_window_bits);
    params.client_max_window_bits = client_bits.unwrap_or(params.client_max_window_bits);
    Some(params)
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

/// Returns the name the certificate must match: `hostname` (`tls.serverName` or the URL's host), falling back to the SNI.
fn identity_name<'a>(
    hostname: &'a [u8],
    ssl: Option<&boringssl::c::SSL>,
) -> std::borrow::Cow<'a, [u8]> {
    if !hostname.is_empty() {
        hostname.into()
    } else {
        ssl.and_then(|ssl| ssl.servername())
            .map(<[u8]>::to_vec)
            .unwrap_or_default()
            .into()
    }
}

// LAYERING: `Bun__WebSocket__parseSSLConfig` / `Bun__WebSocket__freeSSLConfig`
// live in `bun_runtime::socket::ssl_config` (src/runtime/socket/SSLConfig.rs).
// `ParsedTls::from_js` walks Blob/JSCArrayBuffer/node_fs values (tier-6) and
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
//     targetAuthorization/unixSocketPath/extensions, passed as `nullptr` or `&local`)
//     → `Option<&BunString>` (guaranteed null-pointer niche);
//   - `const BunString*` array + `size_t` count → `&[BunString]`
//     (count may be 0 with a dangling/null begin());
//   - `void* sslConfig` (ownership transferred, boxed by
//     `Bun__WebSocket__parseSSLConfig`) → `Option<Box<SSLConfig>>`
//     (null-pointer niche; Box matches the transferred ownership);
//   - `const void* proxySSLConfig` (borrowed for the call, C++ frees it) → `Option<&SSLConfig>`;
//   - `BunString* connectErrorCode` (out param: the caller passes an empty
//     string, written only when returning null) → `&mut BunString`.
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
    proxy_ssl_config: Option<&bun_http::ssl_config::SSLConfig>,
    has_proxy_tls: bool,
    target_is_secure: bool,
    target_authorization: Option<&BunString>,
    unix_socket_path: Option<&BunString>,
    extensions: Option<&BunString>,
    connect_error_code: &mut BunString,
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
        proxy_ssl_config,
        has_proxy_tls,
        target_is_secure,
        target_authorization,
        unix_socket_path,
        extensions,
        connect_error_code,
    )
    .unwrap_or(ptr::null_mut())
}

// HOST_EXPORT(Bun__WebSocketHTTPClient__cancel, c)
pub fn bun__websockethttpclient__cancel(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpUpgradeClient>,
) {
    HttpUpgradeClient::cancel(this);
}

// HOST_EXPORT(Bun__WebSocketHTTPClient__setPaused, c)
pub fn bun__websockethttpclient__set_paused(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpUpgradeClient>,
    paused: bool,
) {
    HttpUpgradeClient::set_paused(this, paused);
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
    proxy_ssl_config: Option<&bun_http::ssl_config::SSLConfig>,
    has_proxy_tls: bool,
    target_is_secure: bool,
    target_authorization: Option<&BunString>,
    unix_socket_path: Option<&BunString>,
    extensions: Option<&BunString>,
    connect_error_code: &mut BunString,
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
        proxy_ssl_config,
        has_proxy_tls,
        target_is_secure,
        target_authorization,
        unix_socket_path,
        extensions,
        connect_error_code,
    )
    .unwrap_or(ptr::null_mut())
}

// HOST_EXPORT(Bun__WebSocketHTTPSClient__cancel, c)
pub fn bun__websockethttpsclient__cancel(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpsUpgradeClient>,
) {
    HttpsUpgradeClient::cancel(this);
}

// HOST_EXPORT(Bun__WebSocketHTTPSClient__setPaused, c)
pub fn bun__websockethttpsclient__set_paused(
    this: ThisPtr<crate::websocket_client::websocket_upgrade_client::HttpsUpgradeClient>,
    paused: bool,
) {
    HttpsUpgradeClient::set_paused(this, paused);
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
