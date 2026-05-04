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
use core::ffi::{c_int, c_void, CStr};
use core::ptr;
use std::io::Write as _;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_collections::StringSet;
use bun_core::fmt::HostFormatter;
use bun_core::FeatureFlags;
use bun_http::{HeaderValueIterator, Headers};
use bun_jsc::{JSGlobalObject, JSValue, VirtualMachine};
use bun_picohttp as picohttp;
use bun_str::strings;
use bun_str::{String as BunString, Utf8Slice};
use bun_uws::{self as uws, SocketHandler, SocketKind, SslCtxRef};

use super::cpp_web_socket::CppWebSocket;
use super::web_socket_deflate as WebSocketDeflate;
use super::web_socket_proxy::WebSocketProxy;
use super::web_socket_proxy_tunnel::WebSocketProxyTunnel;
use crate::websocket_client::ErrorCode;

// TODO(port): confirm crate path — Zig is `jsc.API.ServerConfig.SSLConfig`
use bun_runtime::api::server_config::SSLConfig;

bun_output::declare_scope!(WebSocketUpgradeClient, visible);

macro_rules! log {
    ($($arg:tt)*) => {
        bun_output::scoped_log!(WebSocketUpgradeClient, $($arg)*)
    };
}

/// `uws.NewSocketHandler(ssl)`
type Socket<const SSL: bool> = SocketHandler<SSL>;

#[derive(Default, Clone, Copy)]
pub struct DeflateNegotiationResult {
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
    /// TLS inside tunnel (for wss:// through proxy)
    ProxyTlsHandshake,
    /// WebSocket upgrade complete, forwarding data through tunnel
    Done,
}

/// `NewHTTPUpgradeClient(comptime ssl: bool) type` — generic over `SSL`.
///
/// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread
/// refcount; `ref_count` field below, `ref()`/`deref()` inherent methods, `deinit`
/// runs when count hits 0.
pub struct HTTPClient<const SSL: bool> {
    ref_count: Cell<u32>,
    tcp: Socket<SSL>,
    outgoing_websocket: Option<*mut CppWebSocket>,
    /// Owned request bytes. Freed via `clear_input`.
    input_body_buf: Vec<u8>,
    // PORT NOTE: reshaped for borrowck — Zig `to_send: []const u8` is always a
    // suffix of `input_body_buf`; stored here as the suffix length so we don't
    // hold a self-referential slice.
    to_send_len: usize,
    read_length: usize,
    headers_buf: [picohttp::Header; 128],
    body: Vec<u8>,
    /// Owned NUL-terminated hostname for SNI; empty when unset.
    // TODO(port): owned ZStr type — Zig `[:0]const u8` from `dupeZ`. Stored here
    // as bytes including the trailing NUL; `&hostname[..len-1]` is the slice.
    hostname: Box<[u8]>,
    poll_ref: KeepAlive,
    state: State,
    subprotocols: StringSet,

    /// Proxy state (None when not using proxy)
    proxy: Option<WebSocketProxy>,

    /// TLS options (full SSLConfig for complete TLS customization)
    ssl_config: Option<Box<SSLConfig>>,

    /// `us_ssl_ctx_t` built from `ssl_config` when it carries a custom CA.
    /// Heap-allocated because ownership transfers to the connected
    /// `WebSocket` after the upgrade completes (so the `SSL_CTX` outlives
    /// this struct).
    secure: Option<SslCtxRef>,

    /// Expected Sec-WebSocket-Accept value for handshake validation per RFC 6455 §4.2.2.
    /// This is base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")).
    expected_accept: [u8; 28],

    /// Whether the upgrade request offered `permessage-deflate`. When this is
    /// false (opt-out via `perMessageDeflate: false`) and the server responds
    /// with a `Sec-WebSocket-Extensions` header anyway, `processResponse`
    /// fails the handshake per RFC 6455 §9.1 — matching upstream `ws`.
    offered_permessage_deflate: bool,
}

// Handler set referenced by `dispatch.zig` (kind = `.ws_client_upgrade[_tls]`).
// The `register()` C++ round-trip that previously installed these on a
// shared `us_socket_context_t` is gone — sockets are stamped with the
// kind at connect time and routed here statically.
//
// TODO(port): expose these as a `uws::SocketHandlerSet` const for the dispatch
// table; in Zig these were `pub const onOpen = handleOpen;` etc.
impl<const SSL: bool> HTTPClient<SSL> {
    pub const ON_OPEN: fn(&mut Self, Socket<SSL>) = Self::handle_open;
    pub const ON_CLOSE: fn(&mut Self, Socket<SSL>, c_int, *mut c_void) = Self::handle_close;
    pub const ON_DATA: fn(&mut Self, Socket<SSL>, &[u8]) = Self::handle_data;
    pub const ON_WRITABLE: fn(&mut Self, Socket<SSL>) = Self::handle_writable;
    pub const ON_TIMEOUT: fn(&mut Self, Socket<SSL>) = Self::handle_timeout;
    pub const ON_LONG_TIMEOUT: fn(&mut Self, Socket<SSL>) = Self::handle_timeout;
    pub const ON_CONNECT_ERROR: fn(&mut Self, Socket<SSL>, c_int) = Self::handle_connect_error;
    pub const ON_END: fn(&mut Self, Socket<SSL>) = Self::handle_end;
    pub const ON_HANDSHAKE: fn(&mut Self, Socket<SSL>, i32, uws::us_bun_verify_error_t) =
        Self::handle_handshake;
}

impl<const SSL: bool> HTTPClient<SSL> {
    /// Intrusive refcount increment.
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Intrusive refcount decrement; runs `deinit` (clearData + free) on 0.
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; `self` was allocated via `Box::into_raw`
            // in `connect` and no other live references remain.
            unsafe { Self::deinit(self as *const Self as *mut Self) };
        }
    }

    /// Called by `RefCount` when the count hits zero.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller guarantees `this` is the unique remaining ref.
        let this_ref = unsafe { &mut *this };
        this_ref.clear_data();
        debug_assert!(this_ref.tcp.is_detached());
        // SAFETY: allocated via Box::into_raw in `connect`.
        drop(unsafe { Box::from_raw(this) });
    }

    /// Suffix of `input_body_buf` still pending write.
    fn to_send(&self) -> &[u8] {
        let len = self.input_body_buf.len();
        &self.input_body_buf[len - self.to_send_len..]
    }

    /// On error, this returns null.
    /// Returning null signals to the parent function that the connection failed.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn connect(
        global: &JSGlobalObject,
        websocket: *mut CppWebSocket,
        host: &BunString,
        port: u16,
        pathname: &BunString,
        client_protocol: &BunString,
        header_names: *const BunString,
        header_values: *const BunString,
        header_count: usize,
        // Proxy parameters
        proxy_host: Option<&BunString>,
        proxy_port: u16,
        proxy_authorization: Option<&BunString>,
        proxy_header_names: *const BunString,
        proxy_header_values: *const BunString,
        proxy_header_count: usize,
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
        let vm = global.bun_vm();

        debug_assert!(vm.event_loop_handle().is_some());

        // Decode all BunString inputs into UTF-8 slices. The underlying
        // JavaScript strings may be Latin1 or UTF-16; `String.to_utf8()` either
        // borrows the 8-bit ASCII backing (no allocation) or allocates a
        // UTF-8 copy. All slices live until end of scope (Drop).

        let host_slice = host.to_utf8();
        let pathname_slice = pathname.to_utf8();
        let client_protocol_slice = client_protocol.to_utf8();

        // Headers8Bit::init only returns AllocError; handle OOM as a crash per
        // the OOM contract instead of masking it as a connection failure.
        // SAFETY: header_names/header_values point to header_count live BunStrings per extern-C contract.
        let extra_headers =
            unsafe { Headers8Bit::init(header_names, header_values, header_count) };

        let proxy_host_slice: Option<Utf8Slice<'_>> = proxy_host.map(|ph| ph.to_utf8());
        let target_authorization_slice: Option<Utf8Slice<'_>> =
            target_authorization.map(|ta| ta.to_utf8());
        let unix_socket_path_slice: Option<Utf8Slice<'_>> =
            unix_socket_path.map(|usp| usp.to_utf8());

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
        // Ownership of `body` moves into the proxy (matching Zig); the CONNECT
        // request becomes the initial input_body_buf instead.
        let (proxy_state, input_body_buf): (Option<WebSocketProxy>, Vec<u8>) = if using_proxy {
            // Parse proxy authorization (temporary, freed after building CONNECT request)
            let proxy_auth_decoded: Option<Utf8Slice<'_>> =
                proxy_authorization.map(|auth| auth.to_utf8());
            let proxy_auth_slice: Option<&[u8]> = proxy_auth_decoded.as_ref().map(|s| s.slice());

            // Parse proxy headers (temporary, freed after building CONNECT request)
            // Headers8Bit::init / to_headers only return AllocError; OOM should
            // crash, not silently become a connection failure.
            // SAFETY: proxy_header_names/values point to proxy_header_count live BunStrings per extern-C contract.
            let proxy_extra_headers = unsafe {
                Headers8Bit::init(proxy_header_names, proxy_header_values, proxy_header_count)
            };

            let proxy_hdrs: Option<Headers> = if proxy_header_count > 0 {
                Some(proxy_extra_headers.to_headers())
            } else {
                None
            };

            // Build CONNECT request (proxy_auth and proxy_hdrs are dropped after this).
            // build_connect_request only returns AllocError; crash on OOM.
            let connect_request =
                build_connect_request(host_slice.slice(), port, proxy_auth_slice, proxy_hdrs.as_ref());

            // Duplicate target_host (needed for SNI during TLS handshake).
            let target_host_dup: Box<[u8]> = Box::from(host_slice.slice());

            let proxy = WebSocketProxy::init(
                target_host_dup,
                // Use target_is_secure from C++, not ssl template parameter
                // (ssl may be true for HTTPS proxy even with ws:// target)
                target_is_secure,
                body,
            );
            (Some(proxy), connect_request)
        } else {
            (None, body)
        };

        let subprotocols = {
            let mut subprotocols = StringSet::new();
            let mut it = HeaderValueIterator::init(protocol_for_subprotocols);
            while let Some(protocol) = it.next() {
                subprotocols.insert(protocol);
            }
            subprotocols
        };

        let client = Box::into_raw(Box::new(HTTPClient::<SSL> {
            ref_count: Cell::new(1),
            tcp: Socket::<SSL>::detached(),
            outgoing_websocket: Some(websocket),
            input_body_buf,
            to_send_len: 0,
            read_length: 0,
            headers_buf: [picohttp::Header::default(); 128],
            body: Vec::new(),
            hostname: Box::default(),
            poll_ref: KeepAlive::init(),
            state: State::Initializing,
            proxy: proxy_state,
            ssl_config: None,
            secure: None,
            expected_accept: request_result.expected_accept,
            offered_permessage_deflate: offer_permessage_deflate,
            subprotocols,
        }));
        // SAFETY: just allocated above; we hold the only ref.
        let client_ref = unsafe { &mut *client };

        // Store TLS config if provided (ownership transferred to client)
        client_ref.ssl_config = ssl_config;

        let display_host_: &[u8] = if using_proxy {
            proxy_host_slice.as_ref().unwrap().slice()
        } else {
            host_slice.slice()
        };
        let connect_port = if using_proxy { proxy_port } else { port };

        client_ref.poll_ref.r#ref(vm);
        let display_host: &[u8] = if FeatureFlags::HARDCODE_LOCALHOST_TO_127_0_0_1
            && display_host_ == b"localhost"
        {
            b"127.0.0.1"
        } else {
            display_host_
        };

        log!(
            "connect: ssl={}, has_ssl_config={}, using_proxy={}",
            SSL,
            client_ref.ssl_config.is_some(),
            using_proxy
        );

        let group = vm.rare_data().ws_upgrade_group(vm, SSL);
        let kind: SocketKind = if SSL {
            SocketKind::WsClientUpgradeTls
        } else {
            SocketKind::WsClientUpgrade
        };
        // Default-TLS shares the VM-wide client SSL_CTX; a custom CA
        // builds a per-connection one that the connected WebSocket
        // inherits so it isn't rebuilt on adopt.
        let secure_ptr: Option<&uws::SslCtx> = if SSL {
            'brk: {
                if let Some(config) = &client_ref.ssl_config {
                    if config.requires_custom_request_ctx {
                        let mut err = uws::create_bun_socket_error_t::None;
                        // Per-VM weak cache: every `new WebSocket(wss://, {tls:{ca}})`
                        // with the same CA shares one CTX with each other and with
                        // any `Bun.connect`/Postgres/etc. that named it.
                        let ctx = match vm
                            .rare_data()
                            .ssl_ctx_cache()
                            .get_or_create_opts(config.as_usockets_for_client_verification(), &mut err)
                        {
                            Some(ctx) => ctx,
                            None => {
                                // Do NOT fall through to the default trust store — the
                                // user passed an explicit CA/cert and BoringSSL
                                // rejected it. Swapping in system roots would let the
                                // connection succeed against a host the user didn't
                                // trust. The C++ caller emits an `error` event on null.
                                log!(
                                    "createSSLContext failed for WebSocket: {}",
                                    <&'static str>::from(err)
                                );
                                client_ref.poll_ref.unref(vm);
                                client_ref.deref();
                                return None;
                            }
                        };
                        // Owned ref; transferred to the connected WebSocket on
                        // upgrade, freed in `deinit` if we never get that far.
                        // TODO(port): SslCtxRef ownership — `ctx` from cache should
                        // be a retained ref; storing it and yielding a borrow.
                        client_ref.secure = Some(ctx);
                        break 'brk client_ref.secure.as_deref();
                    }
                }
                Some(vm.rare_data().default_client_ssl_ctx())
            }
        } else {
            None
        };

        // Unix domain socket path (ws+unix:// / wss+unix://)
        if let Some(usp) = &unix_socket_path_slice {
            match Socket::<SSL>::connect_unix_group(group, kind, secure_ptr, usp.slice(), client, false)
            {
                Ok(socket) => {
                    client_ref.tcp = socket;
                    if client_ref.state == State::Failed {
                        client_ref.deref();
                        return None;
                    }
                    bun_analytics::Features::WEB_SOCKET.increment();

                    if SSL {
                        // SNI uses the URL host (defaulted to "localhost" in
                        // C++ when absent), mirroring the TCP path below. A
                        // user-supplied Host header does NOT affect SNI; use
                        // `tls: { checkServerIdentity }` or put the hostname
                        // in the URL (wss+unix://name/path) to verify against
                        // a specific certificate name.
                        if !host_slice.slice().is_empty()
                            && !strings::is_ip_address(host_slice.slice())
                        {
                            client_ref.hostname = dupe_z(host_slice.slice());
                        }
                    }

                    client_ref.tcp.timeout(120);
                    client_ref.state = State::Reading;
                    // +1 for cpp_websocket
                    client_ref.r#ref();
                    return Some(client);
                }
                Err(_) => {
                    client_ref.deref();
                }
            }
            return None;
        }

        match Socket::<SSL>::connect_group(group, kind, secure_ptr, display_host, connect_port, client, false)
        {
            Ok(sock) => {
                client_ref.tcp = sock;
                let out = client_ref;
                // I don't think this case gets reached.
                if out.state == State::Failed {
                    out.deref();
                    return None;
                }
                bun_analytics::Features::WEB_SOCKET.increment();

                if SSL {
                    // SNI for the outer TLS socket must use the host we actually
                    // dialed. For HTTPS proxy connections, that's the proxy host,
                    // not the wss:// target.
                    if !strings::is_ip_address(display_host_) {
                        out.hostname = dupe_z(display_host_);
                    }
                }

                out.tcp.timeout(120);
                out.state = State::Reading;
                // +1 for cpp_websocket
                out.r#ref();
                Some(client)
            }
            Err(_) => {
                client_ref.deref();
                None
            }
        }
    }

    pub fn clear_input(&mut self) {
        self.input_body_buf = Vec::new();
        self.to_send_len = 0;
    }

    pub fn clear_data(&mut self) {
        self.poll_ref.unref(VirtualMachine::get());

        self.subprotocols.clear_and_free();
        self.clear_input();
        self.body = Vec::new();

        if !self.hostname.is_empty() {
            self.hostname = Box::default();
        }

        // Clean up proxy state. Null the field and detach the tunnel's
        // back-reference before deinit so that SSLWrapper shutdown callbacks
        // cannot re-enter clear_data() while the proxy is still reachable.
        if let Some(mut proxy) = self.proxy.take() {
            if let Some(tunnel) = proxy.get_tunnel() {
                tunnel.detach_upgrade_client();
            }
            drop(proxy);
        }
        // ssl_config: Option<Box<SSLConfig>> — Drop runs SSLConfig::deinit + frees the box.
        self.ssl_config = None;
        // secure: Option<SslCtxRef> — Drop calls SSL_CTX_free.
        self.secure = None;
    }

    pub fn cancel(&mut self) {
        self.clear_data();

        // Either of the below two operations - closing the TCP socket or clearing the C++ reference could trigger a deref
        // Therefore, we need to make sure the `this` pointer is valid until the end of the function.
        self.r#ref();
        let _guard = scopeguard::guard((), |_| self.deref());
        // TODO(port): defer semantics — scopeguard captures &self; verify borrowck in Phase B.

        // The C++ end of the socket is no longer holding a reference to this, so we must clear it.
        if self.outgoing_websocket.is_some() {
            self.outgoing_websocket = None;
            self.deref();
        }

        // no need to be .failure we still wanna to send pending SSL buffer + close_notify
        if SSL {
            self.tcp.close(uws::CloseCode::Normal);
        } else {
            self.tcp.close(uws::CloseCode::Failure);
        }
    }

    pub fn fail(&mut self, code: ErrorCode) {
        log!("onFail: {}", <&'static str>::from(code));
        bun_jsc::mark_binding!();
        self.dispatch_abrupt_close(code);

        if SSL {
            self.tcp.close(uws::CloseCode::Normal);
        } else {
            self.tcp.close(uws::CloseCode::Failure);
        }
    }

    fn dispatch_abrupt_close(&mut self, code: ErrorCode) {
        if let Some(ws) = self.outgoing_websocket.take() {
            // SAFETY: ws is a live C++ WebSocket back-reference (BACKREF).
            unsafe { (*ws).did_abrupt_close(code) };
            self.deref();
        }
    }

    pub fn handle_close(&mut self, _: Socket<SSL>, _: c_int, _: *mut c_void) {
        log!("onClose");
        bun_jsc::mark_binding!();
        self.clear_data();
        self.tcp.detach();
        self.dispatch_abrupt_close(ErrorCode::Ended);

        self.deref();
    }

    pub fn terminate(&mut self, code: ErrorCode) {
        self.fail(code);
        // We cannot access the pointer after fail is called.
    }

    pub fn handle_handshake(
        &mut self,
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
        let mut reject_unauthorized = false;
        if let Some(ws) = self.outgoing_websocket {
            // SAFETY: live C++ back-reference.
            reject_unauthorized = unsafe { (*ws).reject_unauthorized() };
        }

        if handshake_success {
            // handshake completed but we may have ssl errors
            if reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    log!(
                        "TLS handshake failed: ssl_error={}, has_custom_ctx={}",
                        ssl_error.error_no,
                        self.secure.is_some()
                    );
                    self.fail(ErrorCode::TlsHandshakeFailed);
                    return;
                }
                // SAFETY: native handle on a TLS socket is `*SSL`.
                let ssl_ptr = unsafe { socket.get_native_handle().cast::<boringssl::c::SSL>() };
                // SAFETY: ssl_ptr is a live *SSL from the open socket; SSL_get_servername
                // returns a nullable borrowed C string valid for the SSL's lifetime.
                if let Some(servername) =
                    unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0).as_ref() }
                {
                    // SAFETY: SSL_get_servername returns a NUL-terminated C string.
                    let hostname = unsafe { CStr::from_ptr(servername as *const _ as *const _) }
                        .to_bytes();
                    if !boringssl::check_server_identity(ssl_ptr, hostname) {
                        self.fail(ErrorCode::TlsHandshakeFailed);
                    }
                }
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            self.fail(ErrorCode::TlsHandshakeFailed);
        }
    }

    pub fn handle_open(&mut self, socket: Socket<SSL>) {
        log!("onOpen");
        self.tcp = socket;

        debug_assert!(!self.input_body_buf.is_empty());
        debug_assert!(self.to_send_len == 0);

        if SSL {
            if !self.hostname.is_empty() {
                if let Some(handle) = socket.get_native_handle_ref() {
                    // TODO(port): ZStr — hostname includes trailing NUL.
                    let len = self.hostname.len() - 1;
                    // SAFETY: hostname[len] == 0 (written by dupe_z); the buffer
                    // outlives this borrow.
                    let zstr = unsafe {
                        bun_str::ZStr::from_raw(self.hostname.as_ptr(), len)
                    };
                    handle.configure_http_client(zstr);
                }
                self.hostname = Box::default();
            }
        }

        // If using proxy, set state to proxy_handshake
        if self.proxy.is_some() {
            self.state = State::ProxyHandshake;
        }

        let wrote = socket.write(&self.input_body_buf);
        if wrote < 0 {
            self.terminate(ErrorCode::FailedToWrite);
            return;
        }

        self.to_send_len = self.input_body_buf.len() - usize::try_from(wrote).unwrap();
    }

    pub fn is_same_socket(&self, socket: Socket<SSL>) -> bool {
        socket.socket().eq(&self.tcp.socket())
    }

    pub fn handle_data(&mut self, socket: Socket<SSL>, data: &[u8]) {
        log!("onData");

        // For tunnel mode after successful upgrade, forward all data to the tunnel
        // The tunnel will decrypt and pass to the WebSocket client
        if self.state == State::Done {
            if let Some(p) = &mut self.proxy {
                if let Some(tunnel) = p.get_tunnel() {
                    // Ref the tunnel to keep it alive during this call
                    // (in case the WebSocket client closes during processing)
                    tunnel.r#ref();
                    let _g = scopeguard::guard((), |_| tunnel.deref());
                    tunnel.receive(data);
                }
            }
            return;
        }

        if self.outgoing_websocket.is_none() {
            self.state = State::Failed;
            self.clear_data();
            socket.close(uws::CloseCode::Failure);
            return;
        }
        self.r#ref();
        // TODO(port): defer self.deref() — placed at all return points below.

        debug_assert!(self.is_same_socket(socket));

        #[cfg(debug_assertions)]
        debug_assert!(!socket.is_shutdown());

        // Handle proxy handshake response
        if self.state == State::ProxyHandshake {
            self.handle_proxy_response(socket, data);
            self.deref();
            return;
        }

        // Route through proxy tunnel if TLS handshake is in progress or complete
        if let Some(p) = &mut self.proxy {
            if let Some(tunnel) = p.get_tunnel() {
                tunnel.receive(data);
                self.deref();
                return;
            }
        }

        let mut body = data;
        if !self.body.is_empty() {
            self.body.extend_from_slice(data);
            body = &self.body;
        }

        let is_first = self.body.is_empty();
        const HTTP_101: &[u8] = b"HTTP/1.1 101 ";
        if is_first && body.len() > HTTP_101.len() {
            // fail early if we receive a non-101 status code
            if !body.starts_with(HTTP_101) {
                self.terminate(ErrorCode::Expected101StatusCode);
                self.deref();
                return;
            }
        }

        let response = match picohttp::Response::parse(body, &mut self.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseError::MalformedHttpResponse) => {
                self.terminate(ErrorCode::InvalidResponse);
                self.deref();
                return;
            }
            Err(picohttp::ParseError::ShortRead) => {
                if self.body.is_empty() {
                    self.body.extend_from_slice(data);
                }
                self.deref();
                return;
            }
        };

        let bytes_read = usize::try_from(response.bytes_read).unwrap();
        // PORT NOTE: reshaped for borrowck — copy remain_buf out before mutating self.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice into self.body — profile in Phase B.
        self.process_response(response, &remain_buf);
        self.deref();
    }

    fn handle_proxy_response(&mut self, socket: Socket<SSL>, data: &[u8]) {
        log!("handleProxyResponse");

        let mut body = data;
        if !self.body.is_empty() {
            self.body.extend_from_slice(data);
            body = &self.body;
        }

        // Check for HTTP 200 response from proxy
        let is_first = self.body.is_empty();
        const HTTP_200: &[u8] = b"HTTP/1.1 200 ";
        const HTTP_200_ALT: &[u8] = b"HTTP/1.0 200 ";
        if is_first && body.len() > HTTP_200.len() {
            if !body.starts_with(HTTP_200) && !body.starts_with(HTTP_200_ALT) {
                // Proxy connection failed
                self.terminate(ErrorCode::ProxyConnectFailed);
                return;
            }
        }

        // Parse the response to find the end of headers
        let response = match picohttp::Response::parse(body, &mut self.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseError::MalformedHttpResponse) => {
                self.terminate(ErrorCode::InvalidResponse);
                return;
            }
            Err(picohttp::ParseError::ShortRead) => {
                if self.body.is_empty() {
                    self.body.extend_from_slice(data);
                }
                return;
            }
        };

        // Proxy returned non-200 status
        if response.status_code != 200 {
            if response.status_code == 407 {
                self.terminate(ErrorCode::ProxyAuthenticationRequired);
            } else {
                self.terminate(ErrorCode::ProxyConnectFailed);
            }
            return;
        }

        // Proxy tunnel established
        log!("Proxy tunnel established");

        let bytes_read = usize::try_from(response.bytes_read).unwrap();
        // PORT NOTE: reshaped for borrowck — copy remain_buf before clearing self.body.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice — profile in Phase B.

        // Clear the body buffer for WebSocket handshake
        self.body.clear();

        // Safely unwrap proxy state - it must exist if we're in proxy_handshake state
        let Some(p) = &mut self.proxy else {
            self.terminate(ErrorCode::ProxyTunnelFailed);
            return;
        };

        // For wss:// through proxy, we need to do TLS handshake inside the tunnel
        if p.is_target_https() {
            self.start_proxy_tls_handshake(socket, &remain_buf);
            return;
        }

        // For ws:// through proxy, send the WebSocket upgrade request
        self.state = State::Reading;

        // Use the WebSocket upgrade request from proxy state (replaces CONNECT
        // request buffer; old Vec is dropped here).
        self.input_body_buf = p.take_websocket_request_buf();
        self.to_send_len = 0;

        // Send the WebSocket upgrade request
        let wrote = socket.write(&self.input_body_buf);
        if wrote < 0 {
            self.terminate(ErrorCode::FailedToWrite);
            return;
        }

        self.to_send_len = self.input_body_buf.len() - usize::try_from(wrote).unwrap();

        // If there's remaining data after the proxy response, process it
        if !remain_buf.is_empty() {
            self.handle_data(socket, &remain_buf);
        }
    }

    /// Start TLS handshake inside the proxy tunnel for wss:// connections
    fn start_proxy_tls_handshake(&mut self, socket: Socket<SSL>, initial_data: &[u8]) {
        log!("startProxyTLSHandshake");

        // Safely unwrap proxy state - it must exist if we're called from handle_proxy_response
        let Some(p) = &mut self.proxy else {
            self.terminate(ErrorCode::ProxyTunnelFailed);
            return;
        };

        // Get certificate verification setting
        let reject_unauthorized = match self.outgoing_websocket {
            // SAFETY: live C++ back-reference.
            Some(ws) => unsafe { (*ws).reject_unauthorized() },
            None => true,
        };

        // Create proxy tunnel with all parameters
        let target_host = p.get_target_host();
        let tunnel = match WebSocketProxyTunnel::init(
            SSL,
            self as *mut Self as *mut c_void,
            // TODO(port): WebSocketProxyTunnel::init signature — Zig passes
            // `ssl, this, socket, target_host, reject_unauthorized`.
            socket,
            target_host,
            reject_unauthorized,
        ) {
            Ok(t) => t,
            Err(_) => {
                self.terminate(ErrorCode::ProxyTunnelFailed);
                return;
            }
        };

        // Use ssl_config if available, otherwise use defaults
        let ssl_options: SSLConfig = match &self.ssl_config {
            Some(config) => (**config).clone(),
            // TODO(port): SSLConfig clone — Zig copies by value (`config.*`).
            None => SSLConfig {
                reject_unauthorized: 0, // We verify manually
                request_cert: 1,
                ..Default::default()
            },
        };

        // Start TLS handshake
        if tunnel.start(ssl_options, initial_data).is_err() {
            tunnel.deref();
            self.terminate(ErrorCode::ProxyTunnelFailed);
            return;
        }

        // PORT NOTE: reshaped for borrowck — re-borrow proxy after &mut self uses above.
        let Some(p) = &mut self.proxy else {
            self.terminate(ErrorCode::ProxyTunnelFailed);
            return;
        };
        p.set_tunnel(tunnel);
        self.state = State::ProxyTlsHandshake;
    }

    /// Called by WebSocketProxyTunnel when TLS handshake completes successfully
    pub fn on_proxy_tls_handshake_complete(&mut self) {
        log!("onProxyTLSHandshakeComplete");

        // TLS handshake done - send WebSocket upgrade request through tunnel
        self.state = State::Reading;

        // Free the CONNECT request buffer
        self.input_body_buf = Vec::new();
        self.to_send_len = 0;

        // Safely unwrap proxy state and send through the tunnel
        let Some(p) = &mut self.proxy else {
            self.terminate(ErrorCode::ProxyTunnelFailed);
            return;
        };

        // Take the WebSocket upgrade request from proxy state (transfers ownership).
        // Store it in input_body_buf so handle_writable can retry on drain.
        self.input_body_buf = p.take_websocket_request_buf();
        if self.input_body_buf.is_empty() {
            self.terminate(ErrorCode::FailedToWrite);
            return;
        }

        // Send through the tunnel (will be encrypted). Buffer any unwritten
        // portion in to_send so handle_writable retries when the socket drains.
        if let Some(tunnel) = p.get_tunnel() {
            let wrote = match tunnel.write(&self.input_body_buf) {
                Ok(n) => n,
                Err(_) => {
                    self.terminate(ErrorCode::FailedToWrite);
                    return;
                }
            };
            self.to_send_len = self.input_body_buf.len() - wrote;
        } else {
            self.terminate(ErrorCode::ProxyTunnelFailed);
        }
    }

    /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
    pub fn handle_decrypted_data(&mut self, data: &[u8]) {
        log!("handleDecryptedData: {} bytes", data.len());

        // Process as if it came directly from the socket
        let mut body = data;
        if !self.body.is_empty() {
            self.body.extend_from_slice(data);
            body = &self.body;
        }

        let is_first = self.body.is_empty();
        const HTTP_101: &[u8] = b"HTTP/1.1 101 ";
        if is_first && body.len() > HTTP_101.len() {
            // fail early if we receive a non-101 status code
            if !body.starts_with(HTTP_101) {
                self.terminate(ErrorCode::Expected101StatusCode);
                return;
            }
        }

        let response = match picohttp::Response::parse(body, &mut self.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseError::MalformedHttpResponse) => {
                self.terminate(ErrorCode::InvalidResponse);
                return;
            }
            Err(picohttp::ParseError::ShortRead) => {
                if self.body.is_empty() {
                    self.body.extend_from_slice(data);
                }
                return;
            }
        };

        let bytes_read = usize::try_from(response.bytes_read).unwrap();
        // PORT NOTE: reshaped for borrowck — copy remain_buf out before mutating self.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice — profile in Phase B.
        self.process_response(response, &remain_buf);
    }

    pub fn handle_end(&mut self, _: Socket<SSL>) {
        log!("onEnd");
        self.terminate(ErrorCode::Ended);
    }

    pub fn process_response(&mut self, response: picohttp::Response, remain_buf: &[u8]) {
        let mut upgrade_header = picohttp::Header::default();
        let mut connection_header = picohttp::Header::default();
        let mut websocket_accept_header = picohttp::Header::default();
        let mut protocol_header_seen = false;

        // var visited_version = false;
        let mut deflate_result = DeflateNegotiationResult::default();

        if response.status_code != 101 {
            self.terminate(ErrorCode::Expected101StatusCode);
            return;
        }

        for header in response.headers.list() {
            match header.name.len() {
                len if len == b"Connection".len() => {
                    if connection_header.name.is_empty()
                        && strings::eql_case_insensitive_ascii(header.name, b"Connection", false)
                    {
                        connection_header = *header;
                    }
                }
                len if len == b"Upgrade".len() => {
                    if upgrade_header.name.is_empty()
                        && strings::eql_case_insensitive_ascii(header.name, b"Upgrade", false)
                    {
                        upgrade_header = *header;
                    }
                }
                len if len == b"Sec-WebSocket-Version".len() => {
                    if strings::eql_case_insensitive_ascii(
                        header.name,
                        b"Sec-WebSocket-Version",
                        false,
                    ) {
                        if !strings::eql_comptime_ignore_len(header.value, b"13") {
                            self.terminate(ErrorCode::InvalidWebsocketVersion);
                            return;
                        }
                    }
                }
                len if len == b"Sec-WebSocket-Accept".len() => {
                    if websocket_accept_header.name.is_empty()
                        && strings::eql_case_insensitive_ascii(
                            header.name,
                            b"Sec-WebSocket-Accept",
                            false,
                        )
                    {
                        websocket_accept_header = *header;
                    }
                }
                len if len == b"Sec-WebSocket-Protocol".len() => {
                    if strings::eql_case_insensitive_ascii(
                        header.name,
                        b"Sec-WebSocket-Protocol",
                        false,
                    ) {
                        let valid = 'brk: {
                            // Can't have multiple protocol headers in the response.
                            if protocol_header_seen {
                                break 'brk false;
                            }

                            protocol_header_seen = true;

                            let mut iterator = HeaderValueIterator::init(header.value);

                            let Some(protocol) = iterator.next() else {
                                // Can't be empty.
                                break 'brk false;
                            };

                            // Can't have multiple protocols.
                            if iterator.next().is_some() {
                                break 'brk false;
                            }

                            // Protocol must be in the list of allowed protocols.
                            if !self.subprotocols.contains(protocol) {
                                break 'brk false;
                            }

                            if let Some(ws) = self.outgoing_websocket {
                                let protocol_str = BunString::clone_latin1(protocol);
                                // SAFETY: live C++ back-reference.
                                unsafe { (*ws).set_protocol(&protocol_str) };
                                drop(protocol_str);
                            }
                            true
                        };

                        if !valid {
                            self.terminate(ErrorCode::MismatchClientProtocol);
                            return;
                        }
                    }
                }
                len if len == b"Sec-WebSocket-Extensions".len() => {
                    if strings::eql_case_insensitive_ascii(
                        header.name,
                        b"Sec-WebSocket-Extensions",
                        false,
                    ) {
                        // Per RFC 6455 §9.1, the server MUST NOT respond with an
                        // extension the client did not offer. Match upstream `ws`
                        // (lib/websocket.js: "Server sent a Sec-WebSocket-Extensions
                        // header but no extension was requested") and fail the
                        // handshake instead of silently accepting it.
                        if !self.offered_permessage_deflate {
                            self.terminate(ErrorCode::InvalidResponse);
                            return;
                        }
                        // This is a simplified parser. A full parser would handle multiple extensions and quoted values.
                        for ext_str in header.value.split(|b| *b == b',') {
                            let mut ext_it = trim_ws(ext_str).split(|b| *b == b';');
                            let ext_name = trim_ws(ext_it.next().unwrap_or(b""));
                            if ext_name == b"permessage-deflate" {
                                deflate_result.enabled = true;
                                for param_str in ext_it {
                                    let mut param_it =
                                        trim_ws(param_str).split(|b| *b == b'=');
                                    let key = trim_ws(param_it.next().unwrap_or(b""));
                                    let value = trim_ws(param_it.next().unwrap_or(b""));

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

                                            if let Some(bits) = parse_u8_dec(trimmed_value) {
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

                                            if let Some(bits) = parse_u8_dec(trimmed_value) {
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

        // if (!visited_version) {
        //     this.terminate(ErrorCode.invalid_websocket_version);
        //     return;
        // }

        if upgrade_header.name.len().min(upgrade_header.value.len()) == 0 {
            self.terminate(ErrorCode::MissingUpgradeHeader);
            return;
        }

        if connection_header.name.len().min(connection_header.value.len()) == 0 {
            self.terminate(ErrorCode::MissingConnectionHeader);
            return;
        }

        if websocket_accept_header
            .name
            .len()
            .min(websocket_accept_header.value.len())
            == 0
        {
            self.terminate(ErrorCode::MissingWebsocketAcceptHeader);
            return;
        }

        if !strings::eql_case_insensitive_ascii(connection_header.value, b"Upgrade", true) {
            self.terminate(ErrorCode::InvalidConnectionHeader);
            return;
        }

        if !strings::eql_case_insensitive_ascii(upgrade_header.value, b"websocket", true) {
            self.terminate(ErrorCode::InvalidUpgradeHeader);
            return;
        }

        if websocket_accept_header.value != &self.expected_accept[..] {
            self.terminate(ErrorCode::MismatchWebsocketAcceptHeader);
            return;
        }

        let overflow_len = remain_buf.len();
        let mut overflow: Vec<u8> = Vec::new();
        if overflow_len > 0 {
            // TODO(port): Zig terminates on alloc failure here; Rust Vec aborts on OOM.
            overflow = remain_buf.to_vec();
        }

        // Check if we're using a proxy tunnel (wss:// through HTTP proxy)
        if let Some(p) = &mut self.proxy {
            if let Some(tunnel) = p.get_tunnel() {
                // wss:// through HTTP proxy: use tunnel mode
                // For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel.
                // The socket continues to call handle_data on the upgrade client, which forwards to tunnel.
                // The tunnel forwards decrypted data to the WebSocket client.
                bun_jsc::mark_binding!();
                if !self.tcp.is_closed() && self.outgoing_websocket.is_some() {
                    self.tcp.timeout(0);
                    log!("onDidConnect (tunnel mode)");

                    // Release the ref that paired with C++'s m_upgradeClient: C++
                    // nulls m_upgradeClient inside didConnectWithTunnel() so it will
                    // never call cancel() to drop it. The TCP socket's ref (released
                    // in handle_close) is what keeps this struct alive to forward
                    // socket data to the tunnel after we switch to .done.
                    let ws = self.outgoing_websocket.take().unwrap();

                    // Create the WebSocket client with the tunnel
                    // SAFETY: live C++ back-reference.
                    unsafe {
                        (*ws).did_connect_with_tunnel(
                            tunnel,
                            overflow.as_ptr(),
                            overflow.len(),
                            if deflate_result.enabled {
                                &deflate_result.params as *const _
                            } else {
                                ptr::null()
                            },
                        )
                    };

                    // Switch state to connected - handle_data will forward to tunnel
                    self.state = State::Done;
                    self.deref();
                } else if self.tcp.is_closed() {
                    self.terminate(ErrorCode::Cancel);
                } else if self.outgoing_websocket.is_none() {
                    self.tcp.close(uws::CloseCode::Failure);
                }
                return;
            }
        }

        // Normal (non-tunnel) mode — original code path. Transfer the
        // custom `us_ssl_ctx_t` to the connected WebSocket (it must outlive
        // the upgrade client because the socket's SSL* still references the
        // SSL_CTX inside it).
        let mut saved_secure = self.secure.take(); // prevent clear_data from freeing it
        // Any arm below that doesn't hand `saved_secure` to did_connect must
        // drop the ref it took out of `self`; SslCtxRef::Drop calls SSL_CTX_free.
        self.clear_data();
        bun_jsc::mark_binding!();
        if !self.tcp.is_closed() && self.outgoing_websocket.is_some() {
            self.tcp.timeout(0);
            log!("onDidConnect");

            let ws = self.outgoing_websocket.take().unwrap();
            let socket = self.tcp;

            // Normal mode: pass socket directly to WebSocket client
            self.tcp.detach();
            if let Some(native_socket) = socket.socket().get() {
                // SAFETY: live C++ back-reference.
                unsafe {
                    (*ws).did_connect(
                        native_socket,
                        overflow.as_ptr(),
                        overflow.len(),
                        if deflate_result.enabled {
                            &deflate_result.params as *const _
                        } else {
                            ptr::null()
                        },
                        saved_secure.take(), // ownership transferred; suppress the drop above
                    )
                };
            } else {
                self.terminate(ErrorCode::FailedToConnect);
            }
            // Once for the outgoing_websocket.
            self.deref();
            // Once again for the TCP socket.
            self.deref();
        } else if self.tcp.is_closed() {
            self.terminate(ErrorCode::Cancel);
        } else if self.outgoing_websocket.is_none() {
            self.tcp.close(uws::CloseCode::Failure);
        }
        drop(saved_secure);
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<Self>();
        cost += self.body.capacity();
        cost += self.to_send_len;
        cost
    }

    pub fn handle_writable(&mut self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(socket));

        // Forward to proxy tunnel if active
        if let Some(p) = &mut self.proxy {
            if let Some(tunnel) = p.get_tunnel() {
                tunnel.on_writable();
                // In .done state (after WebSocket upgrade), just handle tunnel writes
                if self.state == State::Done {
                    return;
                }

                // Flush any unwritten upgrade request bytes through the tunnel
                if self.to_send_len == 0 {
                    return;
                }
                self.r#ref();
                // TODO(port): defer self.deref() — placed at return points below.
                let wrote = match tunnel.write(self.to_send()) {
                    Ok(n) => n,
                    Err(_) => {
                        self.terminate(ErrorCode::FailedToWrite);
                        self.deref();
                        return;
                    }
                };
                self.to_send_len -= wrote.min(self.to_send_len);
                self.deref();
                return;
            }
        }

        if self.to_send_len == 0 {
            return;
        }

        self.r#ref();
        // TODO(port): defer self.deref() — placed at return points below.

        let wrote = socket.write(self.to_send());
        if wrote < 0 {
            self.terminate(ErrorCode::FailedToWrite);
            self.deref();
            return;
        }
        let wrote = usize::try_from(wrote).unwrap();
        self.to_send_len -= wrote.min(self.to_send_len);
        self.deref();
    }

    pub fn handle_timeout(&mut self, _: Socket<SSL>) {
        self.terminate(ErrorCode::Timeout);
    }

    /// In theory, this could be called immediately.
    /// In that case, we set `state` to `failed` and return, expecting the parent to call `destroy`.
    pub fn handle_connect_error(&mut self, _: Socket<SSL>, _: c_int) {
        self.tcp.detach();

        // For the TCP socket.
        // TODO(port): defer self.deref() — moved to end of fn.

        if self.state == State::Reading {
            self.terminate(ErrorCode::FailedToConnect);
        } else {
            self.state = State::Failed;
        }

        self.deref();
    }
}

/// `bun.default_allocator.dupeZ(u8, s) catch ""` — returns owned bytes with a
/// trailing NUL, or empty on (impossible-in-Rust) alloc failure.
// TODO(port): owned ZStr type — replace this helper and the `hostname` field
// with `bun_str::ZStr::from_bytes(s)` once the owned-ZStr shape is settled.
fn dupe_z(s: &[u8]) -> Box<[u8]> {
    let mut v = Vec::with_capacity(s.len() + 1);
    v.extend_from_slice(s);
    v.push(0);
    v.into_boxed_slice()
}

/// `std.mem.trim(u8, s, " \t")`
fn trim_ws(s: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = s.len();
    while start < end && (s[start] == b' ' || s[start] == b'\t') {
        start += 1;
    }
    while end > start && (s[end - 1] == b' ' || s[end - 1] == b'\t') {
        end -= 1;
    }
    &s[start..end]
}

/// `std.fmt.parseInt(u8, s, 10) catch null`
fn parse_u8_dec(s: &[u8]) -> Option<u8> {
    if s.is_empty() {
        return None;
    }
    let mut acc: u32 = 0;
    for &b in s {
        if !(b'0'..=b'9').contains(&b) {
            return None;
        }
        acc = acc.checked_mul(10)?.checked_add((b - b'0') as u32)?;
        if acc > u8::MAX as u32 {
            return None;
        }
    }
    Some(acc as u8)
}

/// Decodes an array of BunString header name/value pairs to UTF-8 up front.
///
/// The BunString values may be backed by 8-bit Latin1 or 16-bit UTF-16
/// `WTFStringImpl`s. Calling `.slice()` on a ZigString wrapper that was built
/// from a non-ASCII WTFStringImpl returns raw Latin1 or UTF-16 code units,
/// which then corrupts the HTTP upgrade request and can cause heap corruption.
///
/// Using `bun_str::String::to_utf8()` either borrows the 8-bit ASCII backing
/// (no allocation) or allocates a UTF-8 copy. The resulting slices are stored
/// here so build_request_body / build_connect_request can index them by &[u8].
///
// PORT NOTE: reshaped for borrowck — Zig stored parallel `name_slices` /
// `value_slices` arrays of `[]const u8` borrowing into `slices`. That is
// self-referential in Rust; instead store only the `Utf8Slice` array (len =
// 2*count, names at even indices, values at odd) and yield pairs via `iter()`.
struct Headers8Bit<'a> {
    slices: Vec<Utf8Slice<'a>>,
}

impl<'a> Headers8Bit<'a> {
    /// # Safety
    /// `names_ptr` and `values_ptr` must each be null or point to `len` valid
    /// `BunString`s alive for `'a`.
    unsafe fn init(
        names_ptr: *const BunString,
        values_ptr: *const BunString,
        len: usize,
    ) -> Self {
        if len == 0 {
            return Self { slices: Vec::new() };
        }
        // SAFETY: per fn contract.
        let names_in = unsafe { core::slice::from_raw_parts(names_ptr, len) };
        let values_in = unsafe { core::slice::from_raw_parts(values_ptr, len) };

        let mut slices: Vec<Utf8Slice<'a>> = Vec::with_capacity(len * 2);
        for i in 0..len {
            slices.push(names_in[i].to_utf8());
            slices.push(values_in[i].to_utf8());
        }

        Self { slices }
    }

    fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> + '_ {
        self.slices
            .chunks_exact(2)
            .map(|pair| (pair[0].slice(), pair[1].slice()))
    }

    /// Convert to `bun_http::Headers`.
    fn to_headers(&self) -> Headers {
        let mut headers = Headers::default();
        for (name, value) in self.iter() {
            headers.append(name, value);
            // PERF(port): Zig `try headers.append` — alloc errors abort in Rust.
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
        write!(&mut buf, "Proxy-Authorization: {}\r\n", bstr::BStr::new(auth)).unwrap();
    }

    // Custom proxy headers
    if let Some(hdrs) = proxy_headers {
        let slice = hdrs.entries.slice();
        let names = slice.items_name();
        let values = slice.items_value();
        // TODO(port): bun_http::Headers MultiArrayList accessors — Zig is
        // `slice.items(.name)` / `slice.items(.value)`.
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
    vm: &VirtualMachine,
    pathname: &[u8],
    is_https: bool,
    host: &[u8],
    port: u16,
    client_protocol: &[u8],
    extra_headers: &Headers8Bit<'_>,
    target_authorization: Option<&[u8]>,
    /// When false, don't advertise `permessage-deflate` (matches `ws` with
    /// `perMessageDeflate: false`). When true, send the default extension
    /// offer `permessage-deflate; client_max_window_bits`.
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
    let mut encoded_buf = [0u8; 24];
    let key: &[u8] = 'blk: {
        if let Some(k_slice) = user_key {
            // Validate that it's a valid base64-encoded 16-byte value
            let mut decoded_buf = [0u8; 24]; // Max possible decoded size
            let Some(decoded_len) = bun_base64::standard_calc_size_for_slice(k_slice) else {
                // Invalid base64, fall through to generate
                break 'blk bun_base64::standard_encode(
                    &mut encoded_buf,
                    &vm.rare_data().next_uuid().bytes,
                );
            };

            if decoded_len == 16 {
                // Try to decode to verify it's valid base64
                if bun_base64::standard_decode(&mut decoded_buf, k_slice).is_err() {
                    // Invalid base64, fall through to generate
                    break 'blk bun_base64::standard_encode(
                        &mut encoded_buf,
                        &vm.rare_data().next_uuid().bytes,
                    );
                }
                // Valid 16-byte key, use it as-is
                break 'blk k_slice;
            }
        }
        // Generate a new key if user key is invalid or not provided
        bun_base64::standard_encode(&mut encoded_buf, &vm.rare_data().next_uuid().bytes)
    };
    // TODO(port): bun_base64 API names — Zig std.base64.standard.Encoder/Decoder.

    // Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
    // base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
    let expected_accept = compute_accept_value(key);

    let protocol = user_protocol.unwrap_or(client_protocol);

    let host_fmt = HostFormatter {
        is_https,
        host,
        port,
    };

    let static_headers = [
        picohttp::Header { name: b"Sec-WebSocket-Key", value: key },
        picohttp::Header { name: b"Sec-WebSocket-Protocol", value: protocol },
    ];

    let headers_ = &static_headers[0..1 + (!protocol.is_empty()) as usize];
    let pico_headers = picohttp::Headers { headers: headers_ };

    // Build extra headers string, skipping the ones we handle
    let mut extra_headers_buf: Vec<u8> = Vec::new();

    // Add Authorization header from URL credentials if user didn't provide one
    if !user_authorization {
        if let Some(auth) = target_authorization {
            write!(&mut extra_headers_buf, "Authorization: {}\r\n", bstr::BStr::new(auth)).unwrap();
        }
    }

    for (name_slice, value) in extra_headers.iter() {
        if strings::eql_case_insensitive_ascii(name_slice, b"host", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"connection", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"upgrade", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-version", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-extensions", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-key", true)
            || strings::eql_case_insensitive_ascii(name_slice, b"sec-websocket-protocol", true)
        {
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
        return Ok(BuildRequestResult { body, expected_accept });
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
    Ok(BuildRequestResult { body, expected_accept })
}

/// Compute the expected Sec-WebSocket-Accept value per RFC 6455 §4.2.2:
/// base64(SHA-1(key ++ "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
fn compute_accept_value(key: &[u8]) -> [u8; 28] {
    const WEBSOCKET_GUID: &[u8] = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = bun_sha::hashers::Sha1::init();
    hasher.update(key);
    hasher.update(WEBSOCKET_GUID);
    let mut hash = bun_sha::hashers::Sha1::Digest::default();
    // TODO(port): SHA1 Digest type — Zig is `[20]u8`.
    hasher.final_(&mut hash);
    let mut result = [0u8; 28];
    let _ = bun_base64::encode(&mut result, &hash);
    result
}

/// Parse SSLConfig from a JavaScript TLS options object.
/// This function is exported for C++ to call from JSWebSocket.cpp.
/// Returns null if parsing fails (an exception will be set on globalThis).
/// The returned SSLConfig is heap-allocated and ownership is transferred to the caller.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__WebSocket__parseSSLConfig(
    global_this: &JSGlobalObject,
    tls_value: JSValue,
) -> Option<Box<SSLConfig>> {
    let vm = global_this.bun_vm();

    // Use SSLConfig::from_js for clean and safe parsing
    let config_opt = match SSLConfig::from_js(vm, global_this, tls_value) {
        Ok(c) => c,
        Err(_) => {
            // Exception is already set on global_this
            return None;
        }
    };

    if let Some(config) = config_opt {
        // Allocate on heap and return pointer (ownership transferred to caller)
        return Some(Box::new(config));
    }

    // No TLS options provided or all defaults, return null
    None
}

/// Free an SSLConfig previously returned by `parseSSLConfig`.
/// Exported for C++ so error/early-return paths in JSWebSocket.cpp and
/// WebSocket.cpp can release ownership without leaking the heap allocation
/// (and all duped cert/key/CA strings inside it) when `connect()` never
/// hands the pointer off to a Zig upgrade client.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__WebSocket__freeSSLConfig(config: *mut SSLConfig) {
    // SAFETY: `config` was produced by `Box::into_raw` (via `Option<Box<_>>` FFI
    // niche) in `Bun__WebSocket__parseSSLConfig`; caller transfers ownership.
    drop(unsafe { Box::from_raw(config) });
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" export shims for the generic `connect`/`cancel`/`memoryCost`.
// Zig's `exportAll()` does `@export(&connect, .{ .name = ... })` per `ssl`.
// Rust cannot `#[no_mangle]` a generic, so monomorphize both here.
// TODO(port): full C-ABI parameter mapping for `connect` (Option<&T> niche,
// Option<Box<T>> niche, raw `*const BunString` arrays). Verify against the
// C++ caller in JSWebSocket.cpp / WebSocket.cpp before Phase B.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! export_http_client {
    ($ssl:literal, $name:literal) => {
        const _: () = {
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn ${concat(Bun__, $name, __connect)}(
                global: &JSGlobalObject,
                websocket: *mut CppWebSocket,
                host: &BunString,
                port: u16,
                pathname: &BunString,
                client_protocol: &BunString,
                header_names: *const BunString,
                header_values: *const BunString,
                header_count: usize,
                proxy_host: Option<&BunString>,
                proxy_port: u16,
                proxy_authorization: Option<&BunString>,
                proxy_header_names: *const BunString,
                proxy_header_values: *const BunString,
                proxy_header_count: usize,
                ssl_config: Option<Box<SSLConfig>>,
                target_is_secure: bool,
                target_authorization: Option<&BunString>,
                unix_socket_path: Option<&BunString>,
                offer_permessage_deflate: bool,
            ) -> *mut HTTPClient<$ssl> {
                match HTTPClient::<$ssl>::connect(
                    global,
                    websocket,
                    host,
                    port,
                    pathname,
                    client_protocol,
                    header_names,
                    header_values,
                    header_count,
                    proxy_host,
                    proxy_port,
                    proxy_authorization,
                    proxy_header_names,
                    proxy_header_values,
                    proxy_header_count,
                    ssl_config,
                    target_is_secure,
                    target_authorization,
                    unix_socket_path,
                    offer_permessage_deflate,
                ) {
                    Some(p) => p,
                    None => ptr::null_mut(),
                }
            }

            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn ${concat(Bun__, $name, __cancel)}(
                this: *mut HTTPClient<$ssl>,
            ) {
                // SAFETY: caller (C++) holds a live ref.
                unsafe { (*this).cancel() };
            }

            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn ${concat(Bun__, $name, __memoryCost)}(
                this: *mut HTTPClient<$ssl>,
            ) -> usize {
                // SAFETY: caller (C++) holds a live ref.
                unsafe { (*this).memory_cost() }
            }
        };
    };
}
// TODO(port): `${concat(...)}` metavariable-expr is unstable (`macro_metavar_expr_concat`).
// Phase B: replace with `paste::paste!` or hand-expand the two instantiations.

export_http_client!(false, "WebSocketHTTPClient");
export_http_client!(true, "WebSocketHTTPSClient");

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/websocket_client/WebSocketUpgradeClient.zig (1560 lines)
//   confidence: medium
//   todos:      19
//   notes:      intrusive RefCount + many `defer this.deref()` hand-placed; `to_send` reshaped to suffix-len; Headers8Bit reshaped to avoid self-ref; remain_buf copies added (PERF); extern "C" export macro needs paste!; SslCtxRef/SSLConfig/base64/sha1 crate paths guessed
// ──────────────────────────────────────────────────────────────────────────
