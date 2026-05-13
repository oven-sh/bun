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
use core::ffi::{CStr, c_int, c_void};
use core::ptr;
use std::io::Write as _;

use bun_boringssl as boringssl;
use bun_collections::StringSet;
use bun_core::fmt::HostFormatter;
use bun_core::strings;
use bun_core::{FeatureFlags, ZBox};
use bun_core::{String as BunString, ZigStringSlice as Utf8Slice};
use bun_http::{HeaderValueIterator, Headers};
use bun_io::KeepAlive;
use bun_jsc::{JSGlobalObject, VirtualMachineRef};
use bun_picohttp as picohttp;
use bun_ptr::ThisPtr;
use bun_uws::{self as uws, SocketHandler, SocketKind, SslCtx};

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
// Zig: `bun.new`/`bun.destroy` log under `.alloc` (hidden, BUN_DEBUG_alloc=1).
bun_core::declare_scope!(alloc, hidden);

/// Local `VirtualMachine → EventLoopCtx` adapter for `KeepAlive::{ref,unref}`.
/// Forwards to the canonical fully-populated vtable in `bun_jsc`.
#[inline]
fn vm_loop_ctx(vm: *mut VirtualMachineRef) -> bun_io::EventLoopCtx {
    bun_jsc::virtual_machine::VirtualMachine::event_loop_ctx(vm)
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
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
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
    hostname: ZBox,
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
    // TODO(port): Zig held a strong `SslCtxRef` (RAII over `SSL_CTX_up_ref`/
    // `SSL_CTX_free`). No such wrapper exists in `bun_uws` yet; store the raw
    // retained pointer and release in `clear_data`/Drop callers.
    secure: Option<*mut SslCtx>,

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
//
// These take `*mut Self` (not `&mut Self`) because uSockets dispatches them
// from the raw userdata pointer and several of them can free `Self` (via
// `deref` reaching zero) or be re-entered synchronously by `tcp.close()` /
// C++ callbacks. Holding a `&mut Self` function-argument across either of
// those is UB under Stacked Borrows (argument protectors / aliased `&mut`).
impl<const SSL: bool> HTTPClient<SSL> {
    pub const ON_OPEN: unsafe fn(*mut Self, Socket<SSL>) = Self::handle_open;
    pub const ON_CLOSE: unsafe fn(*mut Self, Socket<SSL>, c_int, *mut c_void) = Self::handle_close;
    pub const ON_DATA: unsafe fn(*mut Self, Socket<SSL>, &[u8]) = Self::handle_data;
    pub const ON_WRITABLE: unsafe fn(*mut Self, Socket<SSL>) = Self::handle_writable;
    pub const ON_TIMEOUT: unsafe fn(*mut Self, Socket<SSL>) = Self::handle_timeout;
    pub const ON_LONG_TIMEOUT: unsafe fn(*mut Self, Socket<SSL>) = Self::handle_timeout;
    pub const ON_CONNECT_ERROR: unsafe fn(*mut Self, Socket<SSL>, c_int) =
        Self::handle_connect_error;
    pub const ON_END: unsafe fn(*mut Self, Socket<SSL>) = Self::handle_end;
    pub const ON_HANDSHAKE: unsafe fn(*mut Self, Socket<SSL>, i32, uws::us_bun_verify_error_t) =
        Self::handle_handshake;
}

impl<const SSL: bool> HTTPClient<SSL> {
    /// Zig: `meta.typeName(T)` keeps the full path because the name contains `(`.
    const TYPE_NAME: &'static str = if SSL {
        "http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(true)"
    } else {
        "http.websocket_client.WebSocketUpgradeClient.NewHTTPUpgradeClient(false)"
    };

    /// Called by `RefCount` when the count hits zero.
    ///
    /// # Safety
    /// `this` must be the unique remaining pointer to a `Self` allocated via
    /// `heap::alloc` in `connect`.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: caller guarantees `this` is the unique remaining ref.
        unsafe {
            (*this).clear_data();
            debug_assert!((*this).tcp.is_detached());
            // allocated via heap::alloc in `connect`.
            bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::TYPE_NAME, this);
            drop(bun_core::heap::take(this));
        }
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
        let vm_ptr = global.bun_vm_ptr();
        let vm = global.bun_vm().as_mut();

        debug_assert!(vm.event_loop_handle.is_some());

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
        let extra_headers = unsafe { Headers8Bit::init(header_names, header_values, header_count) };

        let proxy_host_slice: Option<Utf8Slice> = proxy_host.map(|ph| ph.to_utf8());
        let target_authorization_slice: Option<Utf8Slice> =
            target_authorization.map(|ta| ta.to_utf8());
        let unix_socket_path_slice: Option<Utf8Slice> = unix_socket_path.map(|usp| usp.to_utf8());

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
            let proxy_auth_decoded: Option<Utf8Slice> =
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
                let _ = subprotocols.insert(protocol); // OOM-only Result (Zig: catch unreachable)
            }
            subprotocols
        };

        let client: *mut Self = bun_core::heap::into_raw(Box::new(HTTPClient::<SSL> {
            ref_count: Cell::new(1),
            tcp: Socket::<SSL>::detached(),
            outgoing_websocket: Some(websocket),
            input_body_buf,
            to_send_len: 0,
            read_length: 0,
            headers_buf: [picohttp::Header::ZERO; 128],
            body: Vec::new(),
            hostname: ZBox::default(),
            poll_ref: KeepAlive::init(),
            state: State::Initializing,
            proxy: proxy_state,
            ssl_config: None,
            secure: None,
            expected_accept: request_result.expected_accept,
            offered_permessage_deflate: offer_permessage_deflate,
            subprotocols,
        }));
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::TYPE_NAME, client);
        // SAFETY: just allocated above; we hold the only ref. This `&mut` is
        // used only for pre-connect setup and MUST NOT span any
        // `Socket::connect_*_group` call below — those install `client` as
        // socket userdata and may synchronously dispatch
        // `handle_connect_error(*mut Self)` (see .zig:1152), which would
        // alias this borrow under Stacked Borrows. A fresh `&mut *client` is
        // re-derived after each connect call returns.
        let client_ref = unsafe { &mut *client };

        // Store TLS config if provided (ownership transferred to client)
        client_ref.ssl_config = ssl_config;

        let display_host_: &[u8] = if using_proxy {
            proxy_host_slice.as_ref().unwrap().slice()
        } else {
            host_slice.slice()
        };
        let connect_port = if using_proxy { proxy_port } else { port };

        client_ref.poll_ref.r#ref(vm_loop_ctx(vm_ptr));
        let display_host: &[u8] =
            if FeatureFlags::HARDCODE_LOCALHOST_TO_127_0_0_1 && display_host_ == b"localhost" {
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

        // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `vm` mutably and
        // `ws_upgrade_group` also wants a `vm` reference. See websocket_client.rs.
        let group = {
            // SAFETY: `rare_data()` returns `&mut RareData` reached through a
            // separate Box; the `&*vm_ptr` argument does not overlap.
            unsafe { (*vm_ptr).rare_data().ws_upgrade_group::<SSL>(&*vm_ptr) }
        };
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
        let secure_ptr: Option<*mut uws::SslCtx> = if SSL {
            let hooks =
                bun_jsc::virtual_machine::runtime_hooks().expect("RuntimeHooks not installed");
            'brk: {
                if let Some(config) = &client_ref.ssl_config {
                    if config.requires_custom_request_ctx {
                        let mut err = uws::create_bun_socket_error_t::none;
                        // Per-VM weak cache: every `new WebSocket(wss://, {tls:{ca}})`
                        // with the same CA shares one CTX with each other and with
                        // any `Bun.connect`/Postgres/etc. that named it.
                        // SAFETY: `vm_ptr` is the live per-thread VM (caller
                        // contract); JS thread.
                        let ctx = unsafe {
                            (hooks.ssl_ctx_cache_get_or_create)(
                                vm_ptr,
                                config.as_usockets_for_client_verification(),
                                &mut err,
                            )
                        };
                        let Some(ctx) = ctx else {
                            // Do NOT fall through to the default trust store — the
                            // user passed an explicit CA/cert and BoringSSL
                            // rejected it. Swapping in system roots would let the
                            // connection succeed against a host the user didn't
                            // trust. The C++ caller emits an `error` event on null.
                            log!("createSSLContext failed for WebSocket: {:?}", err);
                            client_ref.poll_ref.unref(vm_loop_ctx(vm_ptr));
                            // SAFETY: `client` from heap::alloc above; sole owner.
                            unsafe { Self::deref(client) };
                            return None;
                        };
                        // Owned ref; transferred to the connected WebSocket on
                        // upgrade, freed in `deinit` if we never get that far.
                        client_ref.secure = Some(ctx);
                        break 'brk client_ref.secure;
                    }
                }
                // SAFETY: `vm_ptr` is the live per-thread VM; JS thread.
                Some(unsafe { (hooks.default_client_ssl_ctx)(vm_ptr) })
            }
        } else {
            None
        };

        // End the setup `&mut` before connect: `connect_*_group` may
        // synchronously dispatch `handle_connect_error` via the userdata
        // pointer, which would alias any live `&mut Self`.
        let _ = client_ref;

        // Unix domain socket path (ws+unix:// / wss+unix://)
        if let Some(usp) = &unix_socket_path_slice {
            match Socket::<SSL>::connect_unix_group(
                group,
                kind,
                secure_ptr,
                usp.slice(),
                client,
                false,
            ) {
                Ok(socket) => {
                    // SAFETY: `client` is live (refcount >= 1); re-derive a
                    // fresh `&mut` now that any reentrant dispatch has
                    // returned. Not the sole owner anymore — `client` is also
                    // installed as socket userdata.
                    let client_ref = unsafe { &mut *client };
                    client_ref.tcp = socket;
                    if client_ref.state == State::Failed {
                        // SAFETY: `client` from heap::alloc above.
                        unsafe { Self::deref(client) };
                        return None;
                    }
                    bun_analytics::features::web_socket
                        .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

                    if SSL {
                        // SNI uses the URL host (defaulted to "localhost" in
                        // C++ when absent), mirroring the TCP path below. A
                        // user-supplied Host header does NOT affect SNI; use
                        // `tls: { checkServerIdentity }` or put the hostname
                        // in the URL (wss+unix://name/path) to verify against
                        // a specific certificate name.
                        if !host_slice.slice().is_empty() {
                            client_ref.hostname = ZBox::from_bytes(host_slice.slice());
                        }
                    }

                    client_ref.tcp.timeout(120);
                    client_ref.state = State::Reading;
                    // +1 for cpp_websocket
                    client_ref.ref_();
                    return Some(client);
                }
                Err(_) => {
                    // SAFETY: `client` from heap::alloc above; never
                    // installed as userdata on the Err path.
                    unsafe { Self::deref(client) };
                }
            }
            return None;
        }

        match Socket::<SSL>::connect_group(
            group,
            kind,
            secure_ptr,
            display_host,
            c_int::from(connect_port),
            client,
            false,
        ) {
            Ok(sock) => {
                // SAFETY: `client` is live (refcount >= 1); re-derive a fresh
                // `&mut` now that any reentrant dispatch has returned. Not the
                // sole owner anymore — `client` is also socket userdata.
                let out = unsafe { &mut *client };
                out.tcp = sock;
                // I don't think this case gets reached.
                if out.state == State::Failed {
                    // SAFETY: `client` from heap::alloc above.
                    unsafe { Self::deref(client) };
                    return None;
                }
                bun_analytics::features::web_socket
                    .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

                if SSL {
                    // SNI for the outer TLS socket must use the host we actually
                    // dialed. For HTTPS proxy connections, that's the proxy host,
                    // not the wss:// target.
                    if !display_host_.is_empty() {
                        out.hostname = ZBox::from_bytes(display_host_);
                    }
                }

                out.tcp.timeout(120);
                out.state = State::Reading;
                // +1 for cpp_websocket
                out.ref_();
                Some(client)
            }
            Err(_) => {
                // SAFETY: `client` from heap::alloc above; never installed
                // as userdata on the Err path.
                unsafe { Self::deref(client) };
                None
            }
        }
    }

    pub fn clear_input(&mut self) {
        self.input_body_buf = Vec::new();
        self.to_send_len = 0;
    }

    pub fn clear_data(&mut self) {
        self.poll_ref
            .unref(vm_loop_ctx(VirtualMachineRef::get_mut_ptr()));

        self.subprotocols.clear_and_free();
        self.clear_input();
        self.body = Vec::new();

        if !self.hostname.is_empty() {
            self.hostname = ZBox::default();
        }

        // Clean up proxy state. Null the field and detach the tunnel's
        // back-reference before deinit so that SSLWrapper shutdown callbacks
        // cannot re-enter clear_data() while the proxy is still reachable.
        if let Some(mut proxy) = self.proxy.take() {
            if let Some(tunnel) = proxy.get_tunnel() {
                // SAFETY: `proxy` holds a live ref on `tunnel`.
                unsafe { (*tunnel.as_ptr()).detach_upgrade_client() };
            }
            drop(proxy);
        }
        // ssl_config: Option<Box<SSLConfig>> — Drop runs SSLConfig::deinit + frees the box.
        self.ssl_config = None;
        // secure: raw retained `SSL_CTX*` (no RAII wrapper yet — see field
        // TODO(port)). Release the ref taken in `connect`.
        if let Some(s) = self.secure.take() {
            // SAFETY: `s` was returned by `create_ssl_client_context_for`
            // (one owned ref) and has not been freed; SSL_CTX_free decrements
            // BoringSSL's internal refcount.
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` (not `&mut self`)
    /// because `tcp.close()` synchronously dispatches `handle_close` from the
    /// socket userdata pointer, which would alias a `&mut self` argument; and
    /// the trailing `deref` may free `this`, which would violate a `&mut self`
    /// argument protector.
    pub unsafe fn cancel(this: *mut Self) {
        // SAFETY: caller (C++ / uWS) holds a live ref; `this` carries root
        // (userdata) provenance from `heap::alloc`.
        let this = unsafe { ThisPtr::new(this) };
        // SAFETY: short-lived `&mut` for clear_data; ends before any reentrant call.
        unsafe { (*this.as_ptr()).clear_data() };

        // Either of the below two operations - closing the TCP socket or clearing the C++ reference could trigger a deref
        // Therefore, we need to make sure the `this` pointer is valid until the end of the function.
        // Bumps the intrusive refcount and derefs on Drop (after `tcp.close`
        // below), which may free `this` — no `&`/`&mut Self` is live at that
        // point.
        let _guard = this.ref_guard();

        // The C++ end of the socket is no longer holding a reference to this, so we must clear it.
        // SAFETY: short-lived `&mut` for the field take; ends before any reentrant call.
        if unsafe { (*this.as_ptr()).outgoing_websocket.take().is_some() } {
            // SAFETY: refcount > 1 here (the +1 from `_guard` above).
            unsafe { Self::deref(this.as_ptr()) };
        }

        // Copy `tcp` out so no `&mut Self` spans the close — uSockets fires
        // `handle_close` inline, which derives a fresh `&mut`/`*mut` from
        // userdata.
        let tcp = this.tcp;
        // no need to be .failure we still wanna to send pending SSL buffer + close_notify
        if SSL {
            tcp.close(uws::CloseCode::Normal);
        } else {
            tcp.close(uws::CloseCode::Failure);
        }
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `did_abrupt_close` may run JS that re-enters via `cancel()`, and
    /// `tcp.close()` synchronously dispatches `handle_close`; both would alias
    /// a `&mut self` argument.
    pub unsafe fn fail(this: *mut Self, code: ErrorCode) {
        log!("onFail: {}", <&'static str>::from(code));
        bun_jsc::mark_binding!();
        // SAFETY: caller contract — `this` is a live `heap::alloc` pointer.
        let this = unsafe { ThisPtr::new(this) };
        // Copy `tcp` out before dispatch so nothing touches `*this` after the
        // FFI call (which may reenter and pop our tag).
        let tcp = this.tcp;
        // SAFETY: forwards `this` with root provenance; no `&mut Self` is live.
        unsafe { Self::dispatch_abrupt_close(this.as_ptr(), code) };

        if SSL {
            tcp.close(uws::CloseCode::Normal);
        } else {
            tcp.close(uws::CloseCode::Failure);
        }
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `did_abrupt_close` runs JS error handlers and may re-enter via C++
    /// `cancel()`, which would alias a `&mut self` argument; and the trailing
    /// `deref` may free `this`.
    unsafe fn dispatch_abrupt_close(this: *mut Self, code: ErrorCode) {
        // SAFETY: short-lived `&mut` for the field take; ends before the FFI call.
        let ws = unsafe { (*this).outgoing_websocket.take() };
        if let Some(ws) = ws {
            CppWebSocket::opaque_ref(ws).did_abrupt_close(code);
            // SAFETY: `this` carries root provenance; may free `this`.
            unsafe { Self::deref(this) };
        }
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because the
    /// trailing `deref` releases the socket ref and on the normal path frees
    /// `this`; a `&mut self` argument would carry a Stacked Borrows protector
    /// that makes deallocating its referent UB.
    pub unsafe fn handle_close(this: *mut Self, _: Socket<SSL>, _: c_int, _: *mut c_void) {
        log!("onClose");
        bun_jsc::mark_binding!();
        // SAFETY: short-lived `&mut` borrows; each ends before the next call.
        unsafe { (*this).clear_data() };
        unsafe { (*this).tcp.detach() };
        // SAFETY: forwards `this` with root provenance; no `&mut Self` is live.
        unsafe { Self::dispatch_abrupt_close(this, ErrorCode::Ended) };

        // SAFETY: may free `this`; no `&mut Self` is live.
        unsafe { Self::deref(this) };
    }

    /// # Safety
    /// `this` must point to a live `Self`. See `fail`.
    pub unsafe fn terminate(this: *mut Self, code: ErrorCode) {
        // SAFETY: forwards `this` with root provenance.
        unsafe { Self::fail(this, code) };
        // We cannot access the pointer after fail is called.
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because `fail`
    /// may free `this` / be re-entered; see `fail`.
    pub unsafe fn handle_handshake(
        this: *mut Self,
        socket: Socket<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        log!(
            "onHandshake({}) ssl_error.error_no={}",
            success,
            ssl_error.error_no
        );

        // SAFETY: caller (uWS dispatch) — `this` is a live `heap::alloc`
        // pointer recovered from userdata; no Rust borrow is live.
        let this = unsafe { ThisPtr::new(this) };
        let handshake_success = success == 1;
        let mut reject_unauthorized = false;
        if let Some(ws) = this.outgoing_websocket {
            reject_unauthorized = CppWebSocket::opaque_ref(ws).reject_unauthorized();
        }

        if handshake_success {
            // handshake completed but we may have ssl errors
            if reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    log!(
                        "TLS handshake failed: ssl_error={}, has_custom_ctx={}",
                        ssl_error.error_no,
                        this.secure.is_some()
                    );
                    // SAFETY: no `&mut Self` is live across this call.
                    unsafe { Self::fail(this.as_ptr(), ErrorCode::TlsHandshakeFailed) };
                    return;
                }
                // SAFETY: native handle on a TLS socket is `*SSL`.
                let ssl_ptr = socket
                    .get_native_handle()
                    .map_or(core::ptr::null_mut(), |h| h.cast::<boringssl::c::SSL>());
                // SAFETY: ssl_ptr is a live *SSL from the open socket; SSL_get_servername
                // returns a nullable borrowed C string valid for the SSL's lifetime.
                // Keep the raw pointer — round-tripping through `&c_char` would
                // shrink provenance to 1 byte and make the CStr scan UB.
                let servername = unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0) };
                let hostname = if !this.hostname.is_empty() {
                    this.hostname.as_bytes()
                } else if !servername.is_null() {
                    // SAFETY: SSL_get_servername returns a NUL-terminated C string
                    // owned by the SSL session; full provenance retained above.
                    unsafe { bun_core::ffi::cstr(servername) }.to_bytes()
                } else {
                    b""
                };
                // SAFETY: ssl_ptr is a live `*SSL` from the open socket.
                if hostname.is_empty()
                    || !boringssl::check_server_identity(unsafe { &mut *ssl_ptr }, hostname)
                {
                    // SAFETY: no `&mut Self` is live across this call.
                    unsafe { Self::fail(this.as_ptr(), ErrorCode::TlsHandshakeFailed) };
                }
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::fail(this.as_ptr(), ErrorCode::TlsHandshakeFailed) };
        }
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` may free `this`; see `fail`.
    pub unsafe fn handle_open(this: *mut Self, socket: Socket<SSL>) {
        log!("onOpen");
        // SAFETY: short-lived `&mut` for setup; ends before any reentrant call.
        let me = unsafe { &mut *this };
        me.tcp = socket;

        debug_assert!(!me.input_body_buf.is_empty());
        debug_assert!(me.to_send_len == 0);

        if SSL {
            if !me.hostname.is_empty() {
                if let Some(handle) = socket.get_native_handle() {
                    // SAFETY: native handle on a TLS socket is `*SSL`; live for the
                    // open socket's lifetime.
                    let handle = handle.cast::<boringssl::c::SSL>();
                    // `configureHTTPClient` ext-method hasn't landed on
                    // boringssl::SSL; use bun_http's helper.
                    bun_http::configure_http_client_with_alpn(
                        handle,
                        if strings::is_ip_address(me.hostname.as_bytes()) {
                            core::ptr::null()
                        } else {
                            me.hostname.as_ptr()
                        },
                        bun_http::AlpnOffer::H1,
                    );
                }
            }
        }

        // If using proxy, set state to proxy_handshake
        if me.proxy.is_some() {
            me.state = State::ProxyHandshake;
        }

        let wrote = socket.write(&me.input_body_buf);
        if wrote < 0 {
            // SAFETY: no `&mut Self` is live across this call (`me`'s last use is above).
            unsafe { Self::terminate(this, ErrorCode::FailedToWrite) };
            return;
        }

        me.to_send_len = me.input_body_buf.len() - usize::try_from(wrote).expect("int cast");
    }

    pub fn is_same_socket(&self, socket: Socket<SSL>) -> bool {
        // PORT NOTE: `InternalSocket` has no `PartialEq`; compare native handles.
        socket.get_native_handle() == self.tcp.get_native_handle()
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `socket.close()` synchronously dispatches `handle_close` (aliased
    /// `&mut`), and `terminate`/`process_response`/the trailing `deref` may
    /// free `this` (argument-protector UB on `&mut self`).
    pub unsafe fn handle_data(this: *mut Self, socket: Socket<SSL>, data: &[u8]) {
        log!("onData");
        // SAFETY: caller (uWS dispatch) — `this` is a live `heap::alloc`
        // pointer recovered from userdata; no Rust borrow is live.
        let this = unsafe { ThisPtr::new(this) };

        // For tunnel mode after successful upgrade, forward all data to the tunnel
        // The tunnel will decrypt and pass to the WebSocket client
        if this.state == State::Done {
            // SAFETY: short-lived `&mut` for the proxy borrow; ends before return.
            if let Some(p) = unsafe { &mut (*this.as_ptr()).proxy } {
                if let Some(tunnel) = p.get_tunnel() {
                    let tp = tunnel.as_ptr();
                    // Ref the tunnel to keep it alive during this call
                    // (in case the WebSocket client closes during processing)
                    // SAFETY: `p` holds a live ref on `tunnel`.
                    let _g = unsafe { bun_ptr::ScopedRef::new(tp) };
                    // SAFETY: ref guard above keeps the tunnel live.
                    unsafe { WebSocketProxyTunnel::receive(tp, data) };
                }
            }
            return;
        }

        if this.outgoing_websocket.is_none() {
            // SAFETY: short-lived `&mut` writes; each ends before `socket.close`.
            unsafe { (*this.as_ptr()).state = State::Failed };
            unsafe { (*this.as_ptr()).clear_data() };
            // No `&mut Self` is live across this call (handle_close reenters).
            socket.close(uws::CloseCode::Failure);
            return;
        }
        // Bumps the intrusive refcount and derefs on Drop at every return path
        // below (Zig: `self.ref(); defer self.deref();`). No `&`/`&mut Self` is
        // live when the guard drops.
        let _guard = this.ref_guard();

        debug_assert!(this.is_same_socket(socket));

        #[cfg(debug_assertions)]
        debug_assert!(!socket.is_shutdown());

        // Handle proxy handshake response
        if this.state == State::ProxyHandshake {
            // SAFETY: forwards `this` with root provenance; no `&mut Self` is live.
            unsafe { Self::handle_proxy_response(this.as_ptr(), socket, data) };
            return;
        }

        // Route through proxy tunnel if TLS handshake is in progress or complete
        {
            // SAFETY: short-lived `&mut` for the proxy borrow.
            if let Some(p) = unsafe { &mut (*this.as_ptr()).proxy } {
                if let Some(tunnel) = p.get_tunnel() {
                    // SAFETY: `p` holds a live ref on `tunnel`.
                    unsafe { WebSocketProxyTunnel::receive(tunnel.as_ptr(), data) };
                    return;
                }
            }
        }

        // SAFETY: short-lived `&mut` for body buffering; no reentrant calls in
        // this region until `terminate`/`process_response` below.
        let me = unsafe { &mut *this.as_ptr() };
        let mut body = data;
        if !me.body.is_empty() {
            if me.body.len().saturating_add(data.len()) > bun_http::max_http_header_size() {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this.as_ptr(), ErrorCode::InvalidResponse) };
                return;
            }
            me.body.extend_from_slice(data);
            body = &me.body;
        }

        let is_first = me.body.is_empty();
        const HTTP_101: &[u8] = b"HTTP/1.1 101 ";
        if is_first && body.len() > HTTP_101.len() {
            // fail early if we receive a non-101 status code
            if !body.starts_with(HTTP_101) {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this.as_ptr(), ErrorCode::Expected101StatusCode) };
                return;
            }
        }

        let response = match picohttp::Response::parse(body, &mut me.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseResponseError::Malformed_HTTP_Response) => {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this.as_ptr(), ErrorCode::InvalidResponse) };
                return;
            }
            Err(picohttp::ParseResponseError::ShortRead) => {
                if me.body.is_empty() {
                    if data.len() > bun_http::max_http_header_size() {
                        // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                        unsafe { Self::terminate(this.as_ptr(), ErrorCode::InvalidResponse) };
                        return;
                    }
                    me.body.extend_from_slice(data);
                }
                return;
            }
        };

        let bytes_read = usize::try_from(response.bytes_read).expect("int cast");
        // PORT NOTE: reshaped for borrowck — copy remain_buf out before mutating self.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice into self.body — profile in Phase B.
        // SAFETY: `me`'s last use is the `body` slice above (now copied out);
        // no `&mut Self` spans this call.
        unsafe { Self::process_response(this.as_ptr(), response, &remain_buf) };
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate`/`handle_data` may free `this`; see `fail`.
    unsafe fn handle_proxy_response(this: *mut Self, socket: Socket<SSL>, data: &[u8]) {
        log!("handleProxyResponse");

        // SAFETY: short-lived `&mut` for body buffering; no reentrant calls in
        // this region until `terminate` below.
        let me = unsafe { &mut *this };
        let mut body = data;
        if !me.body.is_empty() {
            me.body.extend_from_slice(data);
            body = &me.body;
        }

        // Check for HTTP 200 response from proxy
        let is_first = me.body.is_empty();
        const HTTP_200: &[u8] = b"HTTP/1.1 200 ";
        const HTTP_200_ALT: &[u8] = b"HTTP/1.0 200 ";
        if is_first && body.len() > HTTP_200.len() {
            if !body.starts_with(HTTP_200) && !body.starts_with(HTTP_200_ALT) {
                // Proxy connection failed
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this, ErrorCode::ProxyConnectFailed) };
                return;
            }
        }

        // Parse the response to find the end of headers
        let response = match picohttp::Response::parse(body, &mut me.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseResponseError::Malformed_HTTP_Response) => {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this, ErrorCode::InvalidResponse) };
                return;
            }
            Err(picohttp::ParseResponseError::ShortRead) => {
                if me.body.is_empty() {
                    me.body.extend_from_slice(data);
                }
                return;
            }
        };

        // Proxy returned non-200 status
        if response.status_code != 200 {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            if response.status_code == 407 {
                unsafe { Self::terminate(this, ErrorCode::ProxyAuthenticationRequired) };
            } else {
                unsafe { Self::terminate(this, ErrorCode::ProxyConnectFailed) };
            }
            return;
        }

        // Proxy tunnel established
        log!("Proxy tunnel established");

        let bytes_read = usize::try_from(response.bytes_read).expect("int cast");
        // PORT NOTE: reshaped for borrowck — copy remain_buf before clearing self.body.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice — profile in Phase B.

        // SAFETY: re-derive a fresh `&mut` after the `body` borrow above.
        let me = unsafe { &mut *this };

        // Clear the body buffer for WebSocket handshake
        me.body.clear();

        // Safely unwrap proxy state - it must exist if we're in proxy_handshake state
        let Some(p) = &mut me.proxy else {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
            return;
        };

        // For wss:// through proxy, we need to do TLS handshake inside the tunnel
        if p.is_target_https() {
            // SAFETY: `me`/`p` last used above; forwards `this` with root provenance.
            unsafe { Self::start_proxy_tls_handshake(this, socket, &remain_buf) };
            return;
        }

        // For ws:// through proxy, send the WebSocket upgrade request
        me.state = State::Reading;

        // Use the WebSocket upgrade request from proxy state (replaces CONNECT
        // request buffer; old Vec is dropped here).
        me.input_body_buf = p.take_websocket_request_buf().into_vec();
        me.to_send_len = 0;

        // Send the WebSocket upgrade request
        let wrote = socket.write(&me.input_body_buf);
        if wrote < 0 {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::FailedToWrite) };
            return;
        }

        me.to_send_len = me.input_body_buf.len() - usize::try_from(wrote).expect("int cast");

        // If there's remaining data after the proxy response, process it
        if !remain_buf.is_empty() {
            // SAFETY: `me`'s last use is above; forwards `this` with root provenance.
            unsafe { Self::handle_data(this, socket, &remain_buf) };
        }
    }

    /// Start TLS handshake inside the proxy tunnel for wss:// connections
    ///
    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` may free `this`; see `fail`.
    unsafe fn start_proxy_tls_handshake(this: *mut Self, socket: Socket<SSL>, initial_data: &[u8]) {
        log!("startProxyTLSHandshake");

        // SAFETY: short-lived `&mut`; no reentrant calls until `terminate` below.
        let me = unsafe { &mut *this };

        // Safely unwrap proxy state - it must exist if we're called from handle_proxy_response
        let Some(p) = &mut me.proxy else {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
            return;
        };

        // Get certificate verification setting
        let reject_unauthorized = match me.outgoing_websocket {
            Some(ws) => CppWebSocket::opaque_ref(ws).reject_unauthorized(),
            None => true,
        };

        // Create proxy tunnel with all parameters
        let target_host = p.get_target_host();
        let tunnel =
            match WebSocketProxyTunnel::init::<SSL>(this, socket, target_host, reject_unauthorized)
            {
                Ok(t) => t,
                Err(_) => {
                    // SAFETY: `me`/`p` last used above; no `&mut Self` spans this call.
                    unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
                    return;
                }
            };

        // Use ssl_config if available, otherwise use defaults
        let ssl_options: SSLConfig = match &me.ssl_config {
            Some(config) => (**config).clone(),
            // TODO(port): SSLConfig clone — Zig copies by value (`config.*`).
            None => {
                let mut c = SSLConfig::default();
                c.reject_unauthorized = 0; // We verify manually
                c.request_cert = 1;
                c
            }
        };

        // Start TLS handshake
        // SAFETY: `tunnel` was just allocated by `init` (live, ref_count == 1).
        if unsafe { WebSocketProxyTunnel::start(tunnel.as_ptr(), ssl_options, initial_data) }
            .is_err()
        {
            // SAFETY: release the ref taken by `init`.
            unsafe { WebSocketProxyTunnel::deref(tunnel.as_ptr()) };
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
            return;
        }

        // PORT NOTE: reshaped for borrowck — re-borrow proxy after uses above.
        // SAFETY: re-derive a fresh `&mut`.
        let me = unsafe { &mut *this };
        let Some(p) = &mut me.proxy else {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
            return;
        };
        p.set_tunnel(Some(tunnel));
        me.state = State::ProxyTlsHandshake;
    }

    /// Called by WebSocketProxyTunnel when TLS handshake completes successfully
    ///
    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` may free `this`; see `fail`.
    pub unsafe fn on_proxy_tls_handshake_complete(this: *mut Self) {
        log!("onProxyTLSHandshakeComplete");

        // SAFETY: short-lived `&mut`; no reentrant calls until `terminate` below.
        let me = unsafe { &mut *this };

        // TLS handshake done - send WebSocket upgrade request through tunnel
        me.state = State::Reading;

        // Free the CONNECT request buffer
        me.input_body_buf = Vec::new();
        me.to_send_len = 0;

        // Safely unwrap proxy state and send through the tunnel
        let Some(p) = &mut me.proxy else {
            // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
            return;
        };

        // Take the WebSocket upgrade request from proxy state (transfers ownership).
        // Store it in input_body_buf so handle_writable can retry on drain.
        me.input_body_buf = p.take_websocket_request_buf().into_vec();
        if me.input_body_buf.is_empty() {
            // SAFETY: `me`/`p` last used above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::FailedToWrite) };
            return;
        }

        // Send through the tunnel (will be encrypted). Buffer any unwritten
        // portion in to_send so handle_writable retries when the socket drains.
        if let Some(tunnel) = p.get_tunnel() {
            // SAFETY: `p` holds a live ref on `tunnel`.
            let wrote =
                match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), &me.input_body_buf) } {
                    Ok(n) => n,
                    Err(_) => {
                        // SAFETY: `me`/`p`/`tunnel` last used above; no `&mut Self` spans this call.
                        unsafe { Self::terminate(this, ErrorCode::FailedToWrite) };
                        return;
                    }
                };
            me.to_send_len = me.input_body_buf.len() - wrote;
        } else {
            // SAFETY: `me`/`p` last used above; no `&mut Self` spans this call.
            unsafe { Self::terminate(this, ErrorCode::ProxyTunnelFailed) };
        }
    }

    /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
    ///
    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate`/`process_response` may free `this`; see `fail`.
    pub unsafe fn handle_decrypted_data(this: *mut Self, data: &[u8]) {
        log!("handleDecryptedData: {} bytes", data.len());

        // SAFETY: short-lived `&mut` for body buffering; no reentrant calls in
        // this region until `terminate`/`process_response` below.
        let me = unsafe { &mut *this };

        // Process as if it came directly from the socket
        let mut body = data;
        if !me.body.is_empty() {
            me.body.extend_from_slice(data);
            body = &me.body;
        }

        let is_first = me.body.is_empty();
        const HTTP_101: &[u8] = b"HTTP/1.1 101 ";
        if is_first && body.len() > HTTP_101.len() {
            // fail early if we receive a non-101 status code
            if !body.starts_with(HTTP_101) {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this, ErrorCode::Expected101StatusCode) };
                return;
            }
        }

        let response = match picohttp::Response::parse(body, &mut me.headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseResponseError::Malformed_HTTP_Response) => {
                // SAFETY: `me`'s last use is above; no `&mut Self` spans this call.
                unsafe { Self::terminate(this, ErrorCode::InvalidResponse) };
                return;
            }
            Err(picohttp::ParseResponseError::ShortRead) => {
                if me.body.is_empty() {
                    me.body.extend_from_slice(data);
                }
                return;
            }
        };

        let bytes_read = usize::try_from(response.bytes_read).expect("int cast");
        // PORT NOTE: reshaped for borrowck — copy remain_buf out before mutating self.
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        // PERF(port): was zero-copy slice — profile in Phase B.
        // SAFETY: `me`'s last use is the `body` slice above (now copied out);
        // no `&mut Self` spans this call.
        unsafe { Self::process_response(this, response, &remain_buf) };
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` may free `this`; see `fail`.
    pub unsafe fn handle_end(this: *mut Self, _: Socket<SSL>) {
        log!("onEnd");
        // SAFETY: forwards `this` with root provenance; no `&mut Self` is live.
        unsafe { Self::terminate(this, ErrorCode::Ended) };
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate`/`tcp.close()` may synchronously dispatch `handle_close`
    /// (aliased `&mut`), and the success path's double `deref` may free
    /// `this` (argument-protector UB on `&mut self`).
    pub unsafe fn process_response(
        this: *mut Self,
        response: picohttp::Response,
        remain_buf: &[u8],
    ) {
        let mut upgrade_header = picohttp::Header::ZERO;
        let mut connection_header = picohttp::Header::ZERO;
        let mut websocket_accept_header = picohttp::Header::ZERO;
        let mut protocol_header_seen = false;

        // var visited_version = false;
        let mut deflate_result = DeflateNegotiationResult::default();

        if response.status_code != 101 {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::Expected101StatusCode) };
            return;
        }

        for header in response.headers.list {
            match header.name().len() {
                len if len == b"Connection".len() => {
                    if connection_header.name().is_empty()
                        && strings::eql_case_insensitive_ascii_ignore_length(header.name(), b"Connection")
                    {
                        connection_header = *header;
                    }
                }
                len if len == b"Upgrade".len() => {
                    if upgrade_header.name().is_empty()
                        && strings::eql_case_insensitive_ascii_ignore_length(header.name(), b"Upgrade")
                    {
                        upgrade_header = *header;
                    }
                }
                len if len == b"Sec-WebSocket-Version".len() => {
                    if strings::eql_case_insensitive_ascii_ignore_length(
                        header.name(),
                        b"Sec-WebSocket-Version",
                    ) {
                        if !strings::eql_comptime_ignore_len(header.value(), b"13") {
                            // SAFETY: no `&mut Self` is live across this call.
                            unsafe { Self::terminate(this, ErrorCode::InvalidWebsocketVersion) };
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
                            // SAFETY: short-lived `&self` read.
                            if !unsafe { (*this).subprotocols.contains(protocol) } {
                                break 'brk false;
                            }

                            // SAFETY: short-lived read of `outgoing_websocket`.
                            if let Some(ws) = unsafe { (*this).outgoing_websocket } {
                                let mut protocol_str = BunString::clone_latin1(protocol);
                                CppWebSocket::opaque_ref(ws).set_protocol(&mut protocol_str);
                                // `BunString` is `Copy`; explicitly drop the
                                // ref taken by `clone_latin1` (Zig: `defer
                                // protocol_str.deref()`).
                                protocol_str.deref();
                            }
                            true
                        };

                        if !valid {
                            // SAFETY: no `&mut Self` is live across this call.
                            unsafe { Self::terminate(this, ErrorCode::MismatchClientProtocol) };
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
                        // SAFETY: short-lived read.
                        if !unsafe { (*this).offered_permessage_deflate } {
                            // SAFETY: no `&mut Self` is live across this call.
                            unsafe { Self::terminate(this, ErrorCode::InvalidResponse) };
                            return;
                        }
                        // This is a simplified parser. A full parser would handle multiple extensions and quoted values.
                        for ext_str in header.value().split(|b| *b == b',') {
                            let mut ext_it = strings::trim(ext_str, b" \t").split(|b| *b == b';');
                            let ext_name = strings::trim(ext_it.next().unwrap_or(b""), b" \t");
                            if ext_name == b"permessage-deflate" {
                                deflate_result.enabled = true;
                                for param_str in ext_it {
                                    let mut param_it =
                                        strings::trim(param_str, b" \t").split(|b| *b == b'=');
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

        // if (!visited_version) {
        //     this.terminate(ErrorCode.invalid_websocket_version);
        //     return;
        // }

        if upgrade_header
            .name()
            .len()
            .min(upgrade_header.value().len())
            == 0
        {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::MissingUpgradeHeader) };
            return;
        }

        if connection_header
            .name()
            .len()
            .min(connection_header.value().len())
            == 0
        {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::MissingConnectionHeader) };
            return;
        }

        if websocket_accept_header
            .name()
            .len()
            .min(websocket_accept_header.value().len())
            == 0
        {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::MissingWebsocketAcceptHeader) };
            return;
        }

        if !strings::eql_case_insensitive_ascii(connection_header.value(), b"Upgrade", true) {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::InvalidConnectionHeader) };
            return;
        }

        if !strings::eql_case_insensitive_ascii(upgrade_header.value(), b"websocket", true) {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::InvalidUpgradeHeader) };
            return;
        }

        // SAFETY: short-lived read.
        // SAFETY: `this` is live (caller contract); short-lived shared borrow of the field.
        if websocket_accept_header.value() != unsafe { &(&(*this).expected_accept)[..] } {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::MismatchWebsocketAcceptHeader) };
            return;
        }

        // Ownership transfer: `overflow` is HANDED OFF across FFI —
        // `WebSocket__didConnect` → `Bun__WebSocketClient__init`/`_initWithTunnel`
        // adopts the raw `(ptr, len)` into an `InitialDataHandler` queued as a
        // microtask, which reclaims it via `Box::<[u8]>::from_raw` when the
        // microtask runs. Allocate as `Box<[u8]>` and `heap::alloc` it so the
        // alloc/free pair through the SAME Rust global allocator (mimalloc).
        // Do NOT keep a `Vec`/`Box` binding past the FFI call — it would drop
        // at scope exit and leave the queued microtask with a dangling pointer
        // (UAF on read in `handle_data`, then double-free on drop).
        let overflow_len = remain_buf.len();
        let overflow_ptr: *mut u8 = if overflow_len > 0 {
            let mut v: Vec<u8> = Vec::new();
            if v.try_reserve_exact(overflow_len).is_err() {
                // Spec .zig:1020 — OOM here terminates with `invalid_response`
                // rather than aborting the process.
                // SAFETY: no `&mut Self` is live across this call.
                unsafe { Self::terminate(this, ErrorCode::InvalidResponse) };
                return;
            }
            v.extend_from_slice(remain_buf);
            // Leak across the FFI boundary; `InitialDataHandler` reconstructs
            // the `Box<[u8]>` and drops it after delivery.
            bun_core::heap::into_raw(v.into_boxed_slice()).cast::<u8>()
        } else {
            core::ptr::null_mut()
        };

        // Check if we're using a proxy tunnel (wss:// through HTTP proxy)
        // SAFETY: short-lived `&mut` for the proxy borrow.
        if let Some(p) = unsafe { &mut (*this).proxy } {
            if let Some(tunnel) = p.get_tunnel() {
                // wss:// through HTTP proxy: use tunnel mode
                // For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel.
                // The socket continues to call handle_data on the upgrade client, which forwards to tunnel.
                // The tunnel forwards decrypted data to the WebSocket client.
                bun_jsc::mark_binding!();
                // SAFETY: short-lived reads.
                let tcp = unsafe { (*this).tcp };
                let has_ws = unsafe { (*this).outgoing_websocket.is_some() };
                if !tcp.is_closed() && has_ws {
                    tcp.timeout(0);
                    log!("onDidConnect (tunnel mode)");

                    // Release the ref that paired with C++'s m_upgradeClient: C++
                    // nulls m_upgradeClient inside didConnectWithTunnel() so it will
                    // never call cancel() to drop it. The TCP socket's ref (released
                    // in handle_close) is what keeps this struct alive to forward
                    // socket data to the tunnel after we switch to .done.
                    // SAFETY: short-lived `&mut` for the field take.
                    let ws = unsafe { (*this).outgoing_websocket.take().unwrap() };

                    // Create the WebSocket client with the tunnel
                    // SAFETY: live C++ back-reference.
                    unsafe {
                        (*ws).did_connect_with_tunnel(
                            tunnel.as_ptr().cast::<c_void>(),
                            overflow_ptr,
                            overflow_len,
                            if deflate_result.enabled {
                                Some(&deflate_result.params)
                            } else {
                                None
                            },
                        )
                    };

                    // Switch state to connected - handle_data will forward to tunnel
                    // SAFETY: short-lived write.
                    unsafe { (*this).state = State::Done };
                    // SAFETY: drops the outgoing_websocket ref; no `&mut Self` is live.
                    unsafe { Self::deref(this) };
                } else if tcp.is_closed() {
                    // SAFETY: no `&mut Self` is live across this call.
                    unsafe { Self::terminate(this, ErrorCode::Cancel) };
                } else if !has_ws {
                    // No `&mut Self` spans this call (handle_close reenters).
                    tcp.close(uws::CloseCode::Failure);
                }
                return;
            }
        }

        // Normal (non-tunnel) mode — original code path. Transfer the
        // custom `us_ssl_ctx_t` to the connected WebSocket (it must outlive
        // the upgrade client because the socket's SSL* still references the
        // SSL_CTX inside it).
        // SAFETY: short-lived `&mut` for the field take.
        let mut saved_secure = unsafe { (*this).secure.take() }; // prevent clear_data from freeing it
        // Any arm below that doesn't hand `saved_secure` to did_connect must
        // release the ref it took out of `self` (SSL_CTX_free at fn end).
        // SAFETY: short-lived `&mut` for clear_data; ends before any reentrant call.
        unsafe { (*this).clear_data() };
        bun_jsc::mark_binding!();
        // SAFETY: short-lived reads.
        let tcp = unsafe { (*this).tcp };
        let has_ws = unsafe { (*this).outgoing_websocket.is_some() };
        if !tcp.is_closed() && has_ws {
            tcp.timeout(0);
            log!("onDidConnect");

            // SAFETY: short-lived `&mut` for the field take/detach; ends before
            // the FFI call below.
            let ws = unsafe { (*this).outgoing_websocket.take().unwrap() };
            let socket = tcp;

            // Normal mode: pass socket directly to WebSocket client
            unsafe { (*this).tcp.detach() };
            if let uws::InternalSocket::Connected(native_socket) = socket.socket {
                // SAFETY: live C++ back-reference.
                unsafe {
                    (*ws).did_connect(
                        &mut *native_socket,
                        overflow_ptr,
                        overflow_len,
                        if deflate_result.enabled {
                            Some(&deflate_result.params)
                        } else {
                            None
                        },
                        // ownership transferred; suppress the drop above
                        saved_secure.take().map(|p| &mut *p),
                    )
                };
            } else {
                // SAFETY: no `&mut Self` is live across this call.
                unsafe { Self::terminate(this, ErrorCode::FailedToConnect) };
            }
            // SAFETY: two refs are released here (the outgoing_websocket ref
            // then the TCP socket ref). The first call cannot reach zero
            // because the second ref is still held. The second may free
            // `this`; no `&mut Self` is live.
            // Once for the outgoing_websocket.
            unsafe { Self::deref(this) };
            // Once again for the TCP socket.
            unsafe { Self::deref(this) };
        } else if tcp.is_closed() {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this, ErrorCode::Cancel) };
        } else if !has_ws {
            // No `&mut Self` spans this call (handle_close reenters).
            tcp.close(uws::CloseCode::Failure);
        }
        // Zig: `defer if (saved_secure) |s| bun.BoringSSL.c.SSL_CTX_free(s);`
        // Any arm above that didn't transfer ownership to `did_connect` left
        // the retained `SSL_CTX*` in `saved_secure`; release it now.
        if let Some(s) = saved_secure {
            // SAFETY: `s` is the owned ref taken out of `self.secure` above;
            // not aliased after this point.
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<Self>();
        cost += self.body.capacity();
        cost += self.to_send_len;
        cost
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` and the trailing `deref` may free `this`; see `fail`.
    pub unsafe fn handle_writable(this: *mut Self, socket: Socket<SSL>) {
        // SAFETY: caller (uWS dispatch) — `this` is a live `heap::alloc`
        // pointer recovered from userdata; no Rust borrow is live.
        let this = unsafe { ThisPtr::new(this) };
        debug_assert!(this.is_same_socket(socket));

        // Forward to proxy tunnel if active
        // SAFETY: short-lived `&mut` for the proxy borrow.
        if let Some(p) = unsafe { &mut (*this.as_ptr()).proxy } {
            if let Some(tunnel) = p.get_tunnel() {
                // SAFETY: `p` holds a live ref on `tunnel`.
                unsafe { WebSocketProxyTunnel::on_writable(tunnel.as_ptr()) };
                // In .done state (after WebSocket upgrade), just handle tunnel writes
                if this.state == State::Done {
                    return;
                }

                // Flush any unwritten upgrade request bytes through the tunnel
                if this.to_send_len == 0 {
                    return;
                }
                // Bumps the intrusive refcount and derefs on Drop at every
                // return path below (Zig: `self.ref(); defer self.deref();`).
                let _guard = this.ref_guard();
                // SAFETY: `p` holds a live ref on `tunnel`.
                let wrote =
                    match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), this.to_send()) } {
                        Ok(n) => n,
                        Err(_) => {
                            // SAFETY: no `&mut Self` is live across this call.
                            unsafe { Self::terminate(this.as_ptr(), ErrorCode::FailedToWrite) };
                            return;
                        }
                    };
                // SAFETY: short-lived `&mut` write.
                unsafe {
                    let to_send_len = &mut (*this.as_ptr()).to_send_len;
                    *to_send_len -= wrote.min(*to_send_len);
                }
                return;
            }
        }

        if this.to_send_len == 0 {
            return;
        }

        // Bumps the intrusive refcount and derefs on Drop at every return path
        // below (Zig: `self.ref(); defer self.deref();`).
        let _guard = this.ref_guard();

        let wrote = socket.write(this.to_send());
        if wrote < 0 {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this.as_ptr(), ErrorCode::FailedToWrite) };
            return;
        }
        let wrote = usize::try_from(wrote).expect("int cast");
        // SAFETY: short-lived `&mut` write.
        unsafe {
            let to_send_len = &mut (*this.as_ptr()).to_send_len;
            *to_send_len -= wrote.min(*to_send_len);
        }
    }

    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because
    /// `terminate` may free `this`; see `fail`.
    pub unsafe fn handle_timeout(this: *mut Self, _: Socket<SSL>) {
        // SAFETY: forwards `this` with root provenance; no `&mut Self` is live.
        unsafe { Self::terminate(this, ErrorCode::Timeout) };
    }

    /// In theory, this could be called immediately.
    /// In that case, we set `state` to `failed` and return, expecting the parent to call `destroy`.
    ///
    /// # Safety
    /// `this` must point to a live `Self`. Takes `*mut Self` because the
    /// trailing `deref` releases the socket ref and may free `this`; a
    /// `&mut self` argument would carry a Stacked Borrows protector that
    /// makes deallocating its referent UB.
    pub unsafe fn handle_connect_error(this: *mut Self, _: Socket<SSL>, _: c_int) {
        // SAFETY: caller (uWS dispatch) — `this` is a live `heap::alloc`
        // pointer recovered from userdata; no Rust borrow is live.
        let this = unsafe { ThisPtr::new(this) };
        // SAFETY: short-lived `&mut` for detach; ends before any reentrant call.
        unsafe { (*this.as_ptr()).tcp.detach() };

        // For the TCP socket.
        // TODO(port): defer self.deref() — moved to end of fn.

        if this.state == State::Reading {
            // SAFETY: no `&mut Self` is live across this call.
            unsafe { Self::terminate(this.as_ptr(), ErrorCode::FailedToConnect) };
        } else {
            // SAFETY: short-lived write.
            unsafe { (*this.as_ptr()).state = State::Failed };
        }

        // SAFETY: may free `this`; no `&mut Self` is live.
        unsafe { Self::deref(this.as_ptr()) };
    }
}

/// Decodes an array of BunString header name/value pairs to UTF-8 up front.
///
/// The BunString values may be backed by 8-bit Latin1 or 16-bit UTF-16
/// `WTFStringImpl`s. Calling `.slice()` on a ZigString wrapper that was built
/// from a non-ASCII WTFStringImpl returns raw Latin1 or UTF-16 code units,
/// which then corrupts the HTTP upgrade request and can cause heap corruption.
///
/// Using `bun_core::String::to_utf8()` either borrows the 8-bit ASCII backing
/// (no allocation) or allocates a UTF-8 copy. The resulting slices are stored
/// here so build_request_body / build_connect_request can index them by &[u8].
///
// PORT NOTE: reshaped for borrowck — Zig stored parallel `name_slices` /
// `value_slices` arrays of `[]const u8` borrowing into `slices`. That is
// self-referential in Rust; instead store only the `Utf8Slice` array (len =
// 2*count, names at even indices, values at odd) and yield pairs via `iter()`.
struct Headers8Bit<'a> {
    slices: Vec<Utf8Slice>,
    _marker: core::marker::PhantomData<&'a BunString>,
}

impl<'a> Headers8Bit<'a> {
    /// # Safety
    /// `names_ptr` and `values_ptr` must each be null or point to `len` valid
    /// `BunString`s alive for `'a`.
    unsafe fn init(names_ptr: *const BunString, values_ptr: *const BunString, len: usize) -> Self {
        if len == 0 {
            return Self {
                slices: Vec::new(),
                _marker: core::marker::PhantomData,
            };
        }
        // SAFETY: per fn contract.
        let names_in = unsafe { bun_core::ffi::slice(names_ptr, len) };
        let values_in = unsafe { bun_core::ffi::slice(values_ptr, len) };

        let mut slices: Vec<Utf8Slice> = Vec::with_capacity(len * 2);
        for i in 0..len {
            slices.push(names_in[i].to_utf8());
            slices.push(values_in[i].to_utf8());
        }

        Self {
            slices,
            _marker: core::marker::PhantomData,
        }
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
            // Validate that it's a valid base64-encoded 16-byte value
            let mut decoded_buf = [0u8; 24]; // Max possible decoded size
            let Ok(decoded_len) = B64_STD.decoder.calc_size_for_slice(k_slice) else {
                // Invalid base64, fall through to generate
                break 'blk B64_STD
                    .encoder
                    .encode(&mut encoded_buf, &vm.rare_data().next_uuid().bytes);
            };

            if decoded_len == 16 {
                // Try to decode to verify it's valid base64
                if B64_STD.decoder.decode(&mut decoded_buf, k_slice).is_err() {
                    // Invalid base64, fall through to generate
                    break 'blk B64_STD
                        .encoder
                        .encode(&mut encoded_buf, &vm.rare_data().next_uuid().bytes);
                }
                // Valid 16-byte key, use it as-is
                break 'blk k_slice;
            }
        }
        // Generate a new key if user key is invalid or not provided
        B64_STD
            .encoder
            .encode(&mut encoded_buf, &vm.rare_data().next_uuid().bytes)
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
// extern "C" export shims for the generic `connect`/`cancel`/`memoryCost`.
// Zig's `exportAll()` does `@export(&connect, .{ .name = ... })` per `ssl`.
// Rust cannot `#[no_mangle]` a generic, so monomorphize both here.
// TODO(port): full C-ABI parameter mapping for `connect` (Option<&T> niche,
// Option<Box<T>> niche, raw `*const BunString` arrays). Verify against the
// C++ caller in JSWebSocket.cpp / WebSocket.cpp before Phase B.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! export_http_client {
    ($ssl:literal, $connect:ident, $cancel:ident, $memory_cost:ident) => {
        const _: () = {
            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn $connect(
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
                // SAFETY: extern-C contract — caller (WebCore::WebSocket C++)
                // guarantees `header_names`/`header_values` point to
                // `header_count` live `BunString`s (and likewise for the proxy
                // header arrays), and that `websocket` is a live back-ref.
                match unsafe {
                    HTTPClient::<$ssl>::connect(
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
                    )
                } {
                    Some(p) => p,
                    None => ptr::null_mut(),
                }
            }

            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn $cancel(this: *mut HTTPClient<$ssl>) {
                // SAFETY: caller (C++) holds a live ref; `this` carries root
                // (userdata) provenance from `heap::alloc`.
                unsafe { HTTPClient::<$ssl>::cancel(this) };
            }

            #[unsafe(no_mangle)]
            pub unsafe extern "C" fn $memory_cost(this: *mut HTTPClient<$ssl>) -> usize {
                // SAFETY: caller (C++) holds a live ref.
                unsafe { (*this).memory_cost() }
            }
        };
    };
}
// PORT NOTE: `${concat(...)}` metavar-expr is unstable; hand-expand the two
// instantiations by passing the pre-concatenated idents.

export_http_client!(
    false,
    Bun__WebSocketHTTPClient__connect,
    Bun__WebSocketHTTPClient__cancel,
    Bun__WebSocketHTTPClient__memoryCost
);
export_http_client!(
    true,
    Bun__WebSocketHTTPSClient__connect,
    Bun__WebSocketHTTPSClient__cancel,
    Bun__WebSocketHTTPSClient__memoryCost
);

/// Aliases for `WebSocketProxyTunnel` (matches Zig `HTTPClient` / `HTTPSClient`).
pub type NewHttpUpgradeClient<const SSL: bool> = HTTPClient<SSL>;
pub type HttpUpgradeClient = HTTPClient<false>;
pub type HttpsUpgradeClient = HTTPClient<true>;

// ported from: src/http_jsc/websocket_client/WebSocketUpgradeClient.zig
