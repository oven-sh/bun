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

use core::cell::{Cell, RefCell};
use core::ffi::c_int;
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
use bun_ptr::AsCtxPtr;
use bun_usockets::{self as uws, AnySocket, SocketHandler, SocketKind, SslCtx};

use super::cpp_websocket::CppWebSocket;
use super::websocket_deflate as WebSocketDeflate;
use super::websocket_proxy::WebSocketProxy;
use super::websocket_proxy_tunnel::WebSocketProxyTunnel;
use crate::websocket_client::{ErrorCode, socket_from_any};

// LAYERING: SSLConfig was MOVE_DOWN'd from bun_runtime::api::server_config →
// bun_http::ssl_config (data + as_usockets/for_client_verification). The
// JSC-dependent `from_js` constructor stays in bun_runtime; the C-ABI
// `Bun__WebSocket__parseSSLConfig` export therefore lives in
// bun_runtime::socket::SSLConfig and bridges to this lower-tier type via
// `into_http()`.
use bun_http::ssl_config::SSLConfig;

bun_core::define_scoped_log!(log, WebSocketUpgradeClient, visible);
bun_core::declare_scope!(alloc, hidden);

/// Local `VirtualMachine → EventLoopCtx` adapter for `KeepAlive::{ref,unref}`.
/// Forwards to the canonical fully-populated vtable in `bun_jsc`.
///
/// # Safety
/// `vm` must be the live per-thread VM singleton.
#[inline]
unsafe fn vm_loop_ctx(vm: *mut VirtualMachineRef) -> bun_io::EventLoopCtx {
    // SAFETY: caller contract above.
    unsafe { bun_jsc::virtual_machine::VirtualMachine::event_loop_ctx(vm) }
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
    /// TLS inside tunnel (for wss:// through proxy)
    ProxyTlsHandshake,
    /// WebSocket upgrade complete, forwarding data through tunnel
    Done,
}

/// Owned +1 reference to a `us_ssl_ctx_t` (`SSL_CTX*`); releases the ref via
/// `SSL_CTX_free` on drop (BoringSSL decrements its internal refcount).
/// Either dropped here, or transferred to the connected `WebSocket` via
/// `into_raw()` after the upgrade completes.
struct SslCtxOwned(*mut SslCtx);

impl SslCtxOwned {
    /// Transfer ownership of the retained ref to the caller without freeing.
    fn into_raw(self) -> *mut SslCtx {
        core::mem::ManuallyDrop::new(self).0
    }
}

impl Drop for SslCtxOwned {
    fn drop(&mut self) {
        // `self.0` is an owned retained ref (returned with +1 by
        // `ssl_ctx_cache_get_or_create`) that has not been transferred out.
        bun_usockets::tls::context::ssl_ctx_unref(self.0);
    }
}

/// WebSocket HTTP upgrade client, generic over `SSL`.
///
/// Interior-mutable Protocol v2 owner: handlers receive `&self`, so every
/// mutable field is a `Cell`/`RefCell`. No `RefCell` borrow may be held
/// across a call that can re-enter this struct (terminate/fail, tunnel
/// writes, `tcp.close`, any C++ callback) — those paths reach `clear_data`.
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct HTTPClient<const SSL: bool> {
    ref_count: bun_ptr::RefCount<Self>,
    tcp: Cell<Socket<SSL>>,
    outgoing_websocket: Cell<Option<*mut CppWebSocket>>,
    /// Owned request bytes. Freed via `clear_input`.
    input_body_buf: RefCell<Vec<u8>>,
    // The unsent bytes are always a suffix of `input_body_buf`; stored here as
    // the suffix length so we don't hold a self-referential slice.
    to_send_len: Cell<usize>,
    /// Partial-header accumulator across reads (response not yet complete).
    body: RefCell<Vec<u8>>,
    /// Owned NUL-terminated hostname for SNI; empty when unset.
    hostname: RefCell<ZBox>,
    poll_ref: Cell<KeepAlive>,
    state: Cell<State>,
    subprotocols: RefCell<StringSet>,

    /// Proxy state (None when not using proxy)
    proxy: RefCell<Option<WebSocketProxy>>,

    /// TLS options (full SSLConfig for complete TLS customization)
    ssl_config: RefCell<Option<Box<SSLConfig>>>,

    /// `us_ssl_ctx_t` built from `ssl_config` when it carries a custom CA.
    /// Heap-allocated because ownership transfers to the connected
    /// `WebSocket` after the upgrade completes (so the `SSL_CTX` outlives
    /// this struct). RAII: dropping the wrapper releases the retained ref.
    secure: RefCell<Option<SslCtxOwned>>,

    /// Expected Sec-WebSocket-Accept value for handshake validation per RFC 6455 §4.2.2.
    /// This is base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")).
    expected_accept: [u8; 28],

    /// Whether the upgrade request offered `permessage-deflate`. When this is
    /// false (opt-out via `perMessageDeflate: false`) and the server responds
    /// with a `Sec-WebSocket-Extensions` header anyway, `processResponse`
    /// fails the handshake per RFC 6455 §9.1 — matching upstream `ws`.
    offered_permessage_deflate: bool,
}

// Protocol v2 handler set (kind = `WsClientUpgrade[Tls]`): sockets are
// stamped with the kind at connect time; the dispatch trampoline recovers
// the typed owner from the ext word, holds a strong ref across every
// handler, and releases the core-owned attach ref exactly once at the
// terminal (on_close / on_connect_error / silent SEMI_SOCKET close).
impl<const SSL: bool> uws::Protocol for HTTPClient<SSL> {
    type Owner = Self;
    const KIND: SocketKind = if SSL {
        SocketKind::WsClientUpgradeTls
    } else {
        SocketKind::WsClientUpgrade
    };

    fn on_open(o: &Self, s: AnySocket, _is_client: bool, _ip: &[u8]) {
        o.handle_open(socket_from_any::<SSL>(s));
    }
    fn on_data(o: &Self, s: AnySocket, data: &mut [u8]) {
        o.handle_data(socket_from_any::<SSL>(s), data);
    }
    fn on_writable(o: &Self, s: AnySocket) {
        o.handle_writable(socket_from_any::<SSL>(s));
    }
    fn on_close(o: &Self, _s: AnySocket, _code: uws::CloseCode2, _errno: i32) {
        o.handle_close();
    }
    fn on_end(o: &Self, _s: AnySocket) {
        o.handle_end();
    }
    fn on_timeout(o: &Self, _s: AnySocket) {
        o.handle_timeout();
    }
    fn on_long_timeout(o: &Self, _s: AnySocket) {
        o.handle_timeout();
    }
    fn on_connect_error(o: &Self, _err: uws::ConnectFailure) {
        o.handle_connect_error();
    }
    fn on_handshake(o: &Self, s: AnySocket, ok: bool, err: uws::us_bun_verify_error_t) {
        o.handle_handshake(socket_from_any::<SSL>(s), ok, err);
    }
}

impl<const SSL: bool> HTTPClient<SSL> {
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
        {
            // SAFETY: caller guarantees `this` is the unique remaining ref.
            let me = unsafe { &*this };
            me.clear_data();
            debug_assert!(me.tcp.get().is_detached());
        }
        bun_core::scoped_log!(alloc, "destroy({}) = {:p}", Self::TYPE_NAME, this);
        // SAFETY: allocated via `heap::alloc` in `connect`; sole owner.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Thin release wrapper over the intrusive [`bun_ptr::RefCount`] (the
    /// derive emits no inherent forwarders).
    ///
    /// # Safety
    /// `this` must point to a live `Self` and the caller must own one ref.
    /// After this call `this` may be dangling.
    unsafe fn deref(this: *mut Self) {
        // SAFETY: forwarded caller contract.
        unsafe { bun_ptr::RefCount::<Self>::deref(this) };
    }

    /// Copy of the `input_body_buf` suffix still pending write. Owned copy so
    /// no `RefCell` borrow spans the (possibly re-entrant) write below.
    fn pending_write_bytes(&self) -> Vec<u8> {
        let buf = self.input_body_buf.borrow();
        let pending = self.to_send_len.get().min(buf.len());
        buf[buf.len() - pending..].to_vec()
    }

    /// Post-write bookkeeping: `to_send_len` shrinks by `wrote`, clamped to
    /// the current buffer (a re-entrant `clear_data` may have emptied it).
    fn note_wrote(&self, wrote: usize) {
        let remaining = self.to_send_len.get().saturating_sub(wrote);
        self.to_send_len
            .set(remaining.min(self.input_body_buf.borrow().len()));
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
        // Ownership of `body` moves into the proxy; the CONNECT
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
                let _ = subprotocols.insert(protocol); // OOM-only Result
            }
            subprotocols
        };

        let client: bun_ptr::RefPtr<Self> = bun_ptr::RefPtr::new(HTTPClient::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            tcp: Cell::new(Socket::<SSL>::detached()),
            outgoing_websocket: Cell::new(Some(websocket)),
            input_body_buf: RefCell::new(input_body_buf),
            to_send_len: Cell::new(0),
            body: RefCell::new(Vec::new()),
            hostname: RefCell::new(ZBox::default()),
            poll_ref: Cell::new(KeepAlive::init()),
            state: Cell::new(State::Initializing),
            proxy: RefCell::new(proxy_state),
            ssl_config: RefCell::new(ssl_config),
            secure: RefCell::new(None),
            expected_accept: request_result.expected_accept,
            offered_permessage_deflate: offer_permessage_deflate,
            subprotocols: RefCell::new(subprotocols),
        });
        bun_core::scoped_log!(alloc, "new({}) = {:p}", Self::TYPE_NAME, client.as_ptr());
        // Ref ledger: `client` (this RefPtr) becomes the C++ `m_upgradeClient`
        // ref returned to the caller; `connect_*_owned` below transfers ONE
        // extra strong ref to core (released by core exactly once at the
        // socket terminal, incl. silent SEMI_SOCKET close via detach_owner).
        let client_ref: &Self = client.data();

        let display_host_: &[u8] = if using_proxy {
            proxy_host_slice.as_ref().unwrap().slice()
        } else {
            host_slice.slice()
        };
        let connect_port = if using_proxy { proxy_port } else { port };

        {
            let mut poll_ref = client_ref.poll_ref.take();
            // SAFETY: `vm_ptr` is the live per-thread VM (`global.bun_vm_ptr()`).
            poll_ref.r#ref(unsafe { vm_loop_ctx(vm_ptr) });
            client_ref.poll_ref.set(poll_ref);
        }
        let display_host: &[u8] =
            if FeatureFlags::HARDCODE_LOCALHOST_TO_127_0_0_1 && display_host_ == b"localhost" {
                b"127.0.0.1"
            } else {
                display_host_
            };

        log!(
            "connect: ssl={}, has_ssl_config={}, using_proxy={}",
            SSL,
            client_ref.ssl_config.borrow().is_some(),
            using_proxy
        );

        // Reshaped for borrowck — `rare_data()` borrows `vm` mutably and
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
                let needs_custom_ctx = client_ref
                    .ssl_config
                    .borrow()
                    .as_ref()
                    .is_some_and(|c| c.requires_custom_request_ctx);
                if needs_custom_ctx {
                    let mut err = uws::create_bun_socket_error_t::none;
                    // Per-VM weak cache: every `new WebSocket(wss://, {tls:{ca}})`
                    // with the same CA shares one CTX with each other and with
                    // any `Bun.connect`/Postgres/etc. that named it.
                    let opts = client_ref
                        .ssl_config
                        .borrow()
                        .as_ref()
                        .expect("checked above")
                        .as_usockets_for_client_verification();
                    // SAFETY: `vm_ptr` is the live per-thread VM (caller
                    // contract); JS thread.
                    let ctx =
                        unsafe { (hooks.ssl_ctx_cache_get_or_create)(vm_ptr, &opts, &mut err) };
                    let Some(ctx) = ctx else {
                        // Do NOT fall through to the default trust store — the
                        // user passed an explicit CA/cert and BoringSSL
                        // rejected it. Swapping in system roots would let the
                        // connection succeed against a host the user didn't
                        // trust. The C++ caller emits an `error` event on null.
                        log!("createSSLContext failed for WebSocket: {:?}", err);
                        // Sole ref; the destructor's clear_data unrefs poll_ref.
                        client.deref();
                        return None;
                    };
                    // Owned ref; transferred to the connected WebSocket on
                    // upgrade, freed in `deinit` if we never get that far.
                    client_ref.secure.replace(Some(SslCtxOwned(ctx)));
                    break 'brk Some(ctx);
                }
                // SAFETY: `vm_ptr` is the live per-thread VM; JS thread.
                Some(unsafe { (hooks.default_client_ssl_ctx)(vm_ptr) })
            }
        } else {
            None
        };

        // Unix domain socket path (ws+unix:// / wss+unix://)
        if let Some(usp) = &unix_socket_path_slice {
            // May synchronously dispatch `on_connect_error` before returning;
            // the handler runs under the core dispatch guard and only flips
            // `state` to Failed (observed below).
            match Socket::<SSL>::connect_unix_owned(
                group,
                kind,
                secure_ptr,
                usp.slice(),
                client.clone(),
                false,
            ) {
                Ok(socket) => {
                    client_ref.tcp.set(socket);
                    if client_ref.state.get() == State::Failed {
                        // Core already released its attach ref at the
                        // connect-error terminal; drop the C++ ref.
                        client_ref.detach_tcp();
                        client.deref();
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
                            client_ref
                                .hostname
                                .replace(ZBox::from_bytes(host_slice.slice()));
                        }
                    }

                    client_ref.tcp.get().timeout(120);
                    client_ref.state.set(State::Reading);
                    // The remaining local ref is the C++ `m_upgradeClient` ref.
                    return Some(client.into_raw());
                }
                Err(_) => {
                    // `connect_unix_owned` released the transferred ref on Err.
                    client.deref();
                }
            }
            return None;
        }

        match Socket::<SSL>::connect_owned(
            group,
            kind,
            secure_ptr,
            display_host,
            c_int::from(connect_port),
            client.clone(),
            false,
        ) {
            Ok(sock) => {
                client_ref.tcp.set(sock);
                // I don't think this case gets reached.
                if client_ref.state.get() == State::Failed {
                    // Core already released its attach ref at the
                    // connect-error terminal; drop the C++ ref.
                    client_ref.detach_tcp();
                    client.deref();
                    return None;
                }
                bun_analytics::features::web_socket
                    .fetch_add(1, core::sync::atomic::Ordering::Relaxed);

                if SSL {
                    // SNI for the outer TLS socket must use the host we actually
                    // dialed. For HTTPS proxy connections, that's the proxy host,
                    // not the wss:// target.
                    if !display_host_.is_empty() {
                        client_ref.hostname.replace(ZBox::from_bytes(display_host_));
                    }
                }

                client_ref.tcp.get().timeout(120);
                client_ref.state.set(State::Reading);
                // The remaining local ref is the C++ `m_upgradeClient` ref.
                Some(client.into_raw())
            }
            Err(_) => {
                // `connect_owned` released the transferred ref on Err.
                client.deref();
                None
            }
        }
    }

    pub fn clear_input(&self) {
        self.input_body_buf.replace(Vec::new());
        self.to_send_len.set(0);
    }

    pub fn clear_data(&self) {
        {
            let mut poll_ref = self.poll_ref.take();
            // SAFETY: `get_mut_ptr()` is the live per-thread VM singleton.
            poll_ref.unref(unsafe { vm_loop_ctx(VirtualMachineRef::get_mut_ptr()) });
            self.poll_ref.set(poll_ref);
        }

        self.subprotocols.borrow_mut().clear_and_free();
        self.clear_input();
        self.body.replace(Vec::new());
        self.hostname.replace(ZBox::default());

        // Clean up proxy state. Take the field (ending the RefCell borrow) and
        // detach the tunnel's back-reference before drop so that SSLWrapper
        // shutdown callbacks cannot re-enter clear_data() through the proxy.
        let proxy = self.proxy.borrow_mut().take();
        if let Some(proxy) = proxy {
            if let Some(tunnel) = proxy.get_tunnel() {
                // SAFETY: `proxy` holds a live ref on `tunnel`.
                unsafe { (*tunnel.as_ptr()).detach_upgrade_client() };
            }
            drop(proxy);
        }
        // Option<Box<SSLConfig>> — Drop runs SSLConfig::deinit + frees the box.
        // Take first so the RefCell borrow ends before the Drop runs.
        drop(self.ssl_config.borrow_mut().take());
        // Option<SslCtxOwned> — Drop releases the ref taken in `connect`.
        drop(self.secure.borrow_mut().take());
    }

    /// # Safety
    /// `this` must point to a live `Self`. Raw entry from C++: releases the
    /// C++-side ref, so the pointer may be dangling when this returns.
    pub unsafe fn cancel(this: *mut Self) {
        // Keep the allocation alive across the two releases below.
        // SAFETY: caller (C++) holds a live ref.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };
        // SAFETY: guarded above.
        let me = unsafe { &*this };
        me.clear_data();

        // The C++ end is no longer holding a reference to this; release it.
        if me.outgoing_websocket.take().is_some() {
            // SAFETY: refcount > 1 here (the +1 from `_guard` above).
            unsafe { Self::deref(this) };
        }

        let tcp = me.tcp.get();
        // Detach the core-held owner ref before closing. `close` on a
        // SEMI_SOCKET (TCP connect still in flight — the common case when
        // `ws.close()` is called synchronously after `new WebSocket()`) skips
        // dispatch entirely; `detach_owner` makes core release its attach ref
        // NOW and turns any subsequent dispatch on this socket into a no-op.
        tcp.detach_owner();
        // no need to be .failure we still wanna to send pending SSL buffer + close_notify
        if SSL {
            tcp.close(uws::CloseCode::Normal);
        } else {
            tcp.close(uws::CloseCode::Failure);
        }
        me.detach_tcp();
        // `_guard` drops here, balancing the ref above. May free `this`.
    }

    /// Detach the local socket handle so later `close()`/`is_closed()` calls
    /// are no-ops on a stale handle.
    fn detach_tcp(&self) {
        let mut tcp = self.tcp.get();
        tcp.detach();
        self.tcp.set(tcp);
    }

    /// Callers must keep the allocation alive across this call (dispatch
    /// guard, ScopedRef in the raw entry points): `did_abrupt_close` runs JS
    /// that may re-enter `cancel()`, and `tcp.close()` synchronously
    /// dispatches `handle_close`.
    pub fn fail(&self, code: ErrorCode) {
        log!("onFail: {}", <&'static str>::from(code));
        bun_jsc::mark_binding!();
        let tcp = self.tcp.get();
        self.dispatch_abrupt_close(code);

        // A failed upgrade (bad status line, mismatched subprotocol, invalid
        // headers, ...) is an application-level rejection of a healthy TCP
        // connection — close it gracefully (FIN) like Node's ws client does.
        // A Failure close arms SO_LINGER{1,0} and sends an RST, which the
        // server observes as ECONNRESET on a connection it served correctly.
        tcp.close(uws::CloseCode::Normal);
    }

    fn dispatch_abrupt_close(&self, code: ErrorCode) {
        if let Some(ws) = self.outgoing_websocket.take() {
            CppWebSocket::opaque_ref(ws).did_abrupt_close(code);
            // Release the C++-side ref; callers hold a guard, so the
            // allocation survives this release.
            // SAFETY: live per callers' liveness contract.
            unsafe { Self::deref(self.as_ctx_ptr()) };
        }
    }

    // Terminal: after this returns, core releases its attach ref exactly once.
    pub fn handle_close(&self) {
        log!("onClose");
        bun_jsc::mark_binding!();
        self.clear_data();
        self.detach_tcp();
        self.dispatch_abrupt_close(ErrorCode::Ended);
    }

    /// Raw entry for the proxy tunnel's backref dispatch.
    ///
    /// # Safety
    /// `this` must point to a live `Self`.
    pub unsafe fn terminate(this: *mut Self, code: ErrorCode) {
        // SAFETY: caller contract — `this` is live.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };
        // SAFETY: guarded above.
        unsafe { &*this }.fail(code);
    }

    pub fn handle_handshake(
        &self,
        socket: Socket<SSL>,
        success: bool,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        log!(
            "onHandshake({}) ssl_error.error_no={}",
            success,
            ssl_error.error_no
        );

        let mut reject_unauthorized = false;
        if let Some(ws) = self.outgoing_websocket.get() {
            reject_unauthorized = CppWebSocket::opaque_ref(ws).reject_unauthorized();
        }

        if success {
            // handshake completed but we may have ssl errors
            if reject_unauthorized {
                // only reject the connection if reject_unauthorized == true
                if ssl_error.error_no != 0 {
                    log!(
                        "TLS handshake failed: ssl_error={}, has_custom_ctx={}",
                        ssl_error.error_no,
                        self.secure.borrow().is_some()
                    );
                    self.fail(ErrorCode::TlsHandshakeFailed);
                    return;
                }
                // SAFETY: native handle on a TLS socket is `*SSL`.
                let ssl_ptr = socket
                    .get_native_handle()
                    .map_or(core::ptr::null_mut(), |h| h.cast::<boringssl::c::SSL>());
                if ssl_ptr.is_null() {
                    // No SSL object to verify against — treat as handshake failure
                    // rather than dereferencing null below.
                    self.fail(ErrorCode::TlsHandshakeFailed);
                    return;
                }
                // SAFETY: ssl_ptr is a live *SSL from the open socket; SSL_get_servername
                // returns a nullable borrowed C string valid for the SSL's lifetime.
                // Keep the raw pointer — round-tripping through `&c_char` would
                // shrink provenance to 1 byte and make the CStr scan UB.
                let servername = unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0) };
                // Owned copy so no `hostname` RefCell borrow spans `fail`.
                let hostname_owned: Vec<u8> = {
                    let hn = self.hostname.borrow();
                    if !hn.is_empty() {
                        hn.as_bytes().to_vec()
                    } else if !servername.is_null() {
                        // SAFETY: SSL_get_servername returns a NUL-terminated C
                        // string owned by the SSL session; full provenance
                        // retained above.
                        unsafe { bun_core::ffi::cstr(servername) }
                            .to_bytes()
                            .to_vec()
                    } else {
                        Vec::new()
                    }
                };
                if hostname_owned.is_empty()
                    // SAFETY: `ssl_ptr` is non-null (checked above) and is the live `*SSL`
                    // for this open socket; reached only after a successful TLS handshake.
                    || !boringssl::check_server_identity(unsafe { &mut *ssl_ptr }, &hostname_owned)
                {
                    self.fail(ErrorCode::TlsHandshakeFailed);
                }
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
            self.fail(ErrorCode::TlsHandshakeFailed);
        }
    }

    pub fn handle_open(&self, socket: Socket<SSL>) {
        log!("onOpen");
        self.tcp.set(socket);

        debug_assert!(!self.input_body_buf.borrow().is_empty());
        debug_assert!(self.to_send_len.get() == 0);

        if SSL {
            let hostname = self.hostname.borrow();
            if !hostname.is_empty() {
                if let Some(handle) = socket.get_native_handle() {
                    // SAFETY: native handle on a TLS socket is `*SSL`; live for the
                    // open socket's lifetime.
                    let handle = handle.cast::<boringssl::c::SSL>();
                    // `configureHTTPClient` ext-method hasn't landed on
                    // boringssl::SSL; use bun_http's helper.
                    // SAFETY: `handle` is the live `*mut SSL` for this just-opened
                    // socket (uSockets never passes null); `hostname` is a
                    // NUL-terminated CString that outlives this call.
                    bun_http::configure_http_client_with_alpn(
                        unsafe { &mut *handle },
                        if strings::is_ip_address(hostname.as_bytes()) {
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
        if self.proxy.borrow().is_some() {
            self.state.set(State::ProxyHandshake);
        }

        // Borrow spans only `socket.write` (plain send; never re-enters).
        let wrote = {
            let buf = self.input_body_buf.borrow();
            socket.write(&buf)
        };
        if wrote < 0 {
            self.fail(ErrorCode::FailedToWrite);
            return;
        }

        self.to_send_len
            .set(self.input_body_buf.borrow().len() - usize::try_from(wrote).expect("int cast"));
    }

    pub fn is_same_socket(&self, socket: Socket<SSL>) -> bool {
        // `InternalSocket` has no `PartialEq`; compare native handles.
        socket.get_native_handle() == self.tcp.get().get_native_handle()
    }

    /// Snapshot of the tunnel pointer, with the `proxy` RefCell borrow scoped
    /// so re-entrant tunnel callbacks can reach `clear_data` safely.
    fn tunnel_ptr(&self) -> Option<core::ptr::NonNull<WebSocketProxyTunnel>> {
        self.proxy
            .borrow()
            .as_ref()
            .and_then(WebSocketProxy::get_tunnel)
    }

    pub fn handle_data(&self, socket: Socket<SSL>, data: &[u8]) {
        log!("onData");

        // For tunnel mode after successful upgrade, forward all data to the tunnel
        // The tunnel will decrypt and pass to the WebSocket client
        if self.state.get() == State::Done {
            if let Some(tunnel) = self.tunnel_ptr() {
                let tp = tunnel.as_ptr();
                // Ref the tunnel to keep it alive during this call
                // (in case the WebSocket client closes during processing)
                // SAFETY: `proxy` holds a live ref on `tunnel`.
                let _g = unsafe { bun_ptr::ScopedRef::new(tp) };
                // SAFETY: ref guard above keeps the tunnel live.
                unsafe { WebSocketProxyTunnel::receive(tp, data) };
            }
            return;
        }

        if self.outgoing_websocket.get().is_none() {
            self.state.set(State::Failed);
            self.clear_data();
            // handle_close re-enters synchronously; no borrows are live.
            socket.close(uws::CloseCode::Failure);
            return;
        }

        debug_assert!(self.is_same_socket(socket));

        #[cfg(debug_assertions)]
        debug_assert!(!socket.is_shutdown());

        // Handle proxy handshake response
        if self.state.get() == State::ProxyHandshake {
            self.handle_proxy_response(socket, data);
            return;
        }

        // Route through proxy tunnel if TLS handshake is in progress or complete
        if let Some(tunnel) = self.tunnel_ptr() {
            // SAFETY: `proxy` holds a live ref on `tunnel`.
            unsafe { WebSocketProxyTunnel::receive(tunnel.as_ptr(), data) };
            return;
        }

        self.process_upgrade_response_bytes(data);
    }

    /// Accumulate + parse the 101 response. The parse buffers are locals, so
    /// `process_response` (which can reach `clear_data` through JS) never
    /// races a `RefCell` borrow of `self.body`.
    fn process_upgrade_response_bytes(&self, data: &[u8]) {
        let mut accum: Vec<u8> = self.body.take();
        let is_first = accum.is_empty();
        if !is_first {
            accum.extend_from_slice(data);
        }
        let body: &[u8] = if is_first { data } else { &accum };

        const HTTP_101: &[u8] = b"HTTP/1.1 101 ";
        if is_first && body.len() > HTTP_101.len() {
            // fail early if we receive a non-101 status code
            if !body.starts_with(HTTP_101) {
                self.fail(ErrorCode::Expected101StatusCode);
                return;
            }
        }

        let mut headers_buf = [picohttp::Header::ZERO; 128];
        let response = match picohttp::Response::parse(body, &mut headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseResponseError::MalformedHttpResponse) => {
                self.fail(ErrorCode::InvalidResponse);
                return;
            }
            Err(picohttp::ParseResponseError::ShortRead) => {
                if is_first {
                    accum.extend_from_slice(data);
                }
                // ShortRead means no \r\n\r\n was found, so every byte in
                // `accum` is part of an incomplete header — cap that, not
                // total bytes received (which may include pipelined
                // WebSocket frames once the header does complete).
                if accum.len() > bun_http::max_http_header_size() {
                    self.fail(ErrorCode::InvalidResponse);
                    return;
                }
                self.body.replace(accum);
                return;
            }
        };

        let bytes_read = usize::try_from(response.bytes_read).expect("int cast");
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();
        self.process_response(response, &remain_buf);
    }

    fn handle_proxy_response(&self, socket: Socket<SSL>, data: &[u8]) {
        log!("handleProxyResponse");

        // Parse buffers are locals — see process_upgrade_response_bytes.
        let mut accum: Vec<u8> = self.body.take();
        let is_first = accum.is_empty();
        if !is_first {
            accum.extend_from_slice(data);
        }
        let body: &[u8] = if is_first { data } else { &accum };

        // Check for HTTP 200 response from proxy
        const HTTP_200: &[u8] = b"HTTP/1.1 200 ";
        const HTTP_200_ALT: &[u8] = b"HTTP/1.0 200 ";
        if is_first && body.len() > HTTP_200.len() {
            if !body.starts_with(HTTP_200) && !body.starts_with(HTTP_200_ALT) {
                // Proxy connection failed
                self.fail(ErrorCode::ProxyConnectFailed);
                return;
            }
        }

        // Parse the response to find the end of headers
        let mut headers_buf = [picohttp::Header::ZERO; 128];
        let response = match picohttp::Response::parse(body, &mut headers_buf) {
            Ok(r) => r,
            Err(picohttp::ParseResponseError::MalformedHttpResponse) => {
                self.fail(ErrorCode::InvalidResponse);
                return;
            }
            Err(picohttp::ParseResponseError::ShortRead) => {
                if is_first {
                    accum.extend_from_slice(data);
                }
                // ShortRead means no \r\n\r\n was found, so every byte in
                // `accum` is part of an incomplete header — cap that, not
                // total bytes received.
                if accum.len() > bun_http::max_http_header_size() {
                    self.fail(ErrorCode::InvalidResponse);
                    return;
                }
                self.body.replace(accum);
                return;
            }
        };

        // Proxy returned non-200 status
        if response.status_code != 200 {
            if response.status_code == 407 {
                self.fail(ErrorCode::ProxyAuthenticationRequired);
            } else {
                self.fail(ErrorCode::ProxyConnectFailed);
            }
            return;
        }

        // Proxy tunnel established
        log!("Proxy tunnel established");

        let bytes_read = usize::try_from(response.bytes_read).expect("int cast");
        let remain_buf: Vec<u8> = body[bytes_read..].to_vec();

        // For wss:// through proxy, we need to do TLS handshake inside the tunnel
        let target_https: Option<bool> = self
            .proxy
            .borrow()
            .as_ref()
            .map(WebSocketProxy::is_target_https);
        let Some(target_https) = target_https else {
            // Proxy state must exist in proxy_handshake state.
            self.fail(ErrorCode::ProxyTunnelFailed);
            return;
        };
        if target_https {
            self.start_proxy_tls_handshake(socket, &remain_buf);
            return;
        }

        // For ws:// through proxy, send the WebSocket upgrade request
        self.state.set(State::Reading);

        // Use the WebSocket upgrade request from proxy state (replaces CONNECT
        // request buffer; old Vec is dropped here).
        let request: Vec<u8> = match self.proxy.borrow_mut().as_mut() {
            Some(p) => p.take_websocket_request_buf().into_vec(),
            None => Vec::new(),
        };
        self.input_body_buf.replace(request);
        self.to_send_len.set(0);

        // Send the WebSocket upgrade request (plain send; never re-enters).
        let wrote = {
            let buf = self.input_body_buf.borrow();
            socket.write(&buf)
        };
        if wrote < 0 {
            self.fail(ErrorCode::FailedToWrite);
            return;
        }

        self.to_send_len
            .set(self.input_body_buf.borrow().len() - usize::try_from(wrote).expect("int cast"));

        // If there's remaining data after the proxy response, process it
        if !remain_buf.is_empty() {
            self.handle_data(socket, &remain_buf);
        }
    }

    /// Start TLS handshake inside the proxy tunnel for wss:// connections.
    fn start_proxy_tls_handshake(&self, socket: Socket<SSL>, initial_data: &[u8]) {
        log!("startProxyTLSHandshake");

        // Get certificate verification setting
        let reject_unauthorized = match self.outgoing_websocket.get() {
            Some(ws) => CppWebSocket::opaque_ref(ws).reject_unauthorized(),
            None => true,
        };

        // Create proxy tunnel with all parameters. The target-host copy ends
        // the `proxy` borrow before any call that can re-enter this struct.
        let target_host: Option<Vec<u8>> = self
            .proxy
            .borrow()
            .as_ref()
            .map(|p| p.get_target_host().to_vec());
        let Some(target_host) = target_host else {
            // Proxy state must exist when called from handle_proxy_response.
            self.fail(ErrorCode::ProxyTunnelFailed);
            return;
        };
        let tunnel = match WebSocketProxyTunnel::init::<SSL>(
            self.as_ctx_ptr(),
            socket,
            &target_host,
            reject_unauthorized,
        ) {
            Ok(t) => t,
            Err(_) => {
                self.fail(ErrorCode::ProxyTunnelFailed);
                return;
            }
        };

        // Use ssl_config if available, otherwise use defaults
        let ssl_options: SSLConfig = match self.ssl_config.borrow().as_deref() {
            Some(config) => config.clone(),
            None => {
                let mut c = SSLConfig::default();
                c.reject_unauthorized = 0; // We verify manually
                c.request_cert = 1;
                c
            }
        };

        // Start TLS handshake; may synchronously fire SSLWrapper callbacks
        // that re-enter this struct — no RefCell borrow is live here.
        // SAFETY: `tunnel` was just allocated by `init` (live, ref_count == 1).
        if unsafe { WebSocketProxyTunnel::start(tunnel.as_ptr(), &ssl_options, initial_data) }
            .is_err()
        {
            // SAFETY: release the ref taken by `init`.
            unsafe { WebSocketProxyTunnel::deref(tunnel.as_ptr()) };
            self.fail(ErrorCode::ProxyTunnelFailed);
            return;
        }

        let stored = {
            let mut proxy = self.proxy.borrow_mut();
            match proxy.as_mut() {
                Some(p) => {
                    p.set_tunnel(Some(tunnel));
                    true
                }
                None => false,
            }
        };
        if !stored {
            // A re-entrant teardown during start() cleared the proxy; the
            // tunnel ref from init() must not leak.
            // SAFETY: `tunnel` holds the init() ref; sole owner here.
            unsafe { WebSocketProxyTunnel::deref(tunnel.as_ptr()) };
            self.fail(ErrorCode::ProxyTunnelFailed);
            return;
        }
        self.state.set(State::ProxyTlsHandshake);
    }

    /// Called by WebSocketProxyTunnel when TLS handshake completes successfully
    ///
    /// # Safety
    /// `this` must point to a live `Self` (tunnel backref entry).
    pub unsafe fn on_proxy_tls_handshake_complete(this: *mut Self) {
        log!("onProxyTLSHandshakeComplete");
        // SAFETY: caller contract — `this` is live.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };
        // SAFETY: guarded above.
        let me = unsafe { &*this };

        // TLS handshake done - send WebSocket upgrade request through tunnel
        me.state.set(State::Reading);

        // Replace the CONNECT request buffer with the WebSocket upgrade
        // request from proxy state (transfers ownership); handle_writable
        // retries any unwritten suffix on drain.
        let request: Option<Vec<u8>> = me
            .proxy
            .borrow_mut()
            .as_mut()
            .map(|p| p.take_websocket_request_buf().into_vec());
        let Some(request) = request else {
            me.fail(ErrorCode::ProxyTunnelFailed);
            return;
        };
        if request.is_empty() {
            me.fail(ErrorCode::FailedToWrite);
            return;
        }
        let total = request.len();
        me.input_body_buf.replace(request);
        me.to_send_len.set(0);

        // Send through the tunnel (will be encrypted). The write can
        // synchronously re-enter fail/clear_data, so write from an owned
        // copy and clamp the bookkeeping afterwards.
        let Some(tunnel) = me.tunnel_ptr() else {
            me.fail(ErrorCode::ProxyTunnelFailed);
            return;
        };
        me.to_send_len.set(total);
        let pending = me.pending_write_bytes();
        // SAFETY: `proxy` holds a live ref on `tunnel`.
        match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), &pending) } {
            Ok(wrote) => me.note_wrote(wrote),
            Err(_) => me.fail(ErrorCode::FailedToWrite),
        }
    }

    /// Called by WebSocketProxyTunnel with decrypted data from the TLS tunnel
    ///
    /// # Safety
    /// `this` must point to a live `Self` (tunnel backref entry).
    pub unsafe fn handle_decrypted_data(this: *mut Self, data: &[u8]) {
        log!("handleDecryptedData: {} bytes", data.len());
        // SAFETY: caller contract — `this` is live.
        let _guard = unsafe { bun_ptr::ScopedRef::new(this) };
        // Process as if it came directly from the socket.
        // SAFETY: guarded above.
        unsafe { &*this }.process_upgrade_response_bytes(data);
    }

    pub fn handle_end(&self) {
        log!("onEnd");
        self.fail(ErrorCode::Ended);
    }

    /// `response` borrows the caller's LOCAL parse buffers, so the re-entrant
    /// paths below (fail/close/C++ callbacks → clear_data) cannot invalidate
    /// it or trip a `RefCell` borrow.
    fn process_response(&self, response: picohttp::Response, remain_buf: &[u8]) {
        let mut upgrade_header = picohttp::Header::ZERO;
        let mut connection_header = picohttp::Header::ZERO;
        let mut websocket_accept_header = picohttp::Header::ZERO;
        let mut protocol_header_seen = false;

        // var visited_version = false;
        let mut deflate_result = DeflateNegotiationResult::default();

        if response.status_code != 101 {
            self.fail(ErrorCode::Expected101StatusCode);
            return;
        }

        for header in response.headers.list {
            match header.name().len() {
                len if len == b"Connection".len() => {
                    if connection_header.name().is_empty()
                        && strings::eql_case_insensitive_ascii_ignore_length(
                            header.name(),
                            b"Connection",
                        )
                    {
                        connection_header = *header;
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
                            self.fail(ErrorCode::InvalidWebsocketVersion);
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
                            if !self.subprotocols.borrow().contains(protocol) {
                                break 'brk false;
                            }

                            if let Some(ws) = self.outgoing_websocket.get() {
                                let mut protocol_str = BunString::clone_latin1(protocol);
                                CppWebSocket::opaque_ref(ws).set_protocol(&mut protocol_str);
                                // `BunString` is `Copy`; explicitly drop the
                                // ref taken by `clone_latin1`.
                                protocol_str.deref();
                            }
                            true
                        };

                        if !valid {
                            self.fail(ErrorCode::MismatchClientProtocol);
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
                        if !self.offered_permessage_deflate {
                            self.fail(ErrorCode::InvalidResponse);
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
            self.fail(ErrorCode::MissingUpgradeHeader);
            return;
        }

        if connection_header
            .name()
            .len()
            .min(connection_header.value().len())
            == 0
        {
            self.fail(ErrorCode::MissingConnectionHeader);
            return;
        }

        if websocket_accept_header
            .name()
            .len()
            .min(websocket_accept_header.value().len())
            == 0
        {
            self.fail(ErrorCode::MissingWebsocketAcceptHeader);
            return;
        }

        if !protocol_header_seen && !self.subprotocols.borrow().is_empty() {
            self.fail(ErrorCode::MissingClientProtocol);
            return;
        }

        if !strings::eql_case_insensitive_ascii(connection_header.value(), b"Upgrade", true) {
            self.fail(ErrorCode::InvalidConnectionHeader);
            return;
        }

        if !strings::eql_case_insensitive_ascii(upgrade_header.value(), b"websocket", true) {
            self.fail(ErrorCode::InvalidUpgradeHeader);
            return;
        }

        if websocket_accept_header.value() != &self.expected_accept[..] {
            self.fail(ErrorCode::MismatchWebsocketAcceptHeader);
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
                // OOM here terminates with `invalid_response` rather than
                // aborting the process.
                self.fail(ErrorCode::InvalidResponse);
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
        if let Some(tunnel) = self.tunnel_ptr() {
            // wss:// through HTTP proxy: use tunnel mode
            // For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel.
            // The socket continues to call handle_data on the upgrade client, which forwards to tunnel.
            // The tunnel forwards decrypted data to the WebSocket client.
            bun_jsc::mark_binding!();
            let tcp = self.tcp.get();
            let has_ws = self.outgoing_websocket.get().is_some();
            if !tcp.is_closed() && has_ws {
                tcp.timeout(0);
                log!("onDidConnect (tunnel mode)");

                // Release the ref that paired with C++'s m_upgradeClient: C++
                // nulls m_upgradeClient inside didConnectWithTunnel() so it will
                // never call cancel() to drop it. The core-held owner ref
                // (released after handle_close returns) is what keeps this
                // struct alive to forward socket data to the tunnel after we
                // switch to .done.
                let ws = self.outgoing_websocket.take().unwrap();

                // Create the WebSocket client with the tunnel
                // SAFETY: live C++ back-reference.
                unsafe {
                    (*ws).did_connect_with_tunnel(
                        tunnel.as_ptr().cast::<core::ffi::c_void>(),
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
                self.state.set(State::Done);
                // Drop the C++ ref; the caller's dispatch guard + the core
                // owner ref keep the allocation alive.
                // SAFETY: live per callers' liveness contract.
                unsafe { Self::deref(self.as_ctx_ptr()) };
            } else if tcp.is_closed() {
                self.fail(ErrorCode::Cancel);
            } else if !has_ws {
                // handle_close re-enters synchronously; no borrows are live.
                tcp.close(uws::CloseCode::Failure);
            }
            return;
        }

        // Normal (non-tunnel) mode — original code path. Transfer the
        // custom `us_ssl_ctx_t` to the connected WebSocket (it must outlive
        // the upgrade client because the socket's SSL* still references the
        // SSL_CTX inside it).
        let mut saved_secure = self.secure.borrow_mut().take(); // prevent clear_data from freeing it
        // Any arm below that doesn't hand `saved_secure` to did_connect must
        // release the ref it took out of `self` (SSL_CTX_free at fn end).
        self.clear_data();
        bun_jsc::mark_binding!();
        let tcp = self.tcp.get();
        let has_ws = self.outgoing_websocket.get().is_some();
        if !tcp.is_closed() && has_ws {
            tcp.timeout(0);
            log!("onDidConnect");

            let ws = self.outgoing_websocket.take().unwrap();
            let socket = tcp;

            // Normal mode: pass socket directly to WebSocket client.
            // Release the core-held owner ref FIRST so the handed-off socket
            // carries a clean (null) owner word into the framed adopt; any
            // event before the adopt no-ops. Then detach the local handle.
            socket.detach_owner();
            self.detach_tcp();
            if let uws::InternalSocket::Connected(native_socket) = socket.socket {
                // Raw header pointer round-trips opaquely through C++ into
                // `Bun__WebSocketClient__init`, which re-derives a SocketRef.
                // SAFETY: live C++ back-reference.
                unsafe {
                    (*ws).did_connect(
                        native_socket.ptr.as_ptr(),
                        overflow_ptr,
                        overflow_len,
                        if deflate_result.enabled {
                            Some(&deflate_result.params)
                        } else {
                            None
                        },
                        // ownership transferred; `into_raw` suppresses the
                        // RAII release at fn end.
                        saved_secure
                            .take()
                            .map_or(core::ptr::null_mut(), SslCtxOwned::into_raw),
                    )
                };
            } else {
                self.fail(ErrorCode::FailedToConnect);
            }
            // Drop the C++ ref (the core owner ref was released by
            // detach_owner above); the caller's dispatch guard keeps the
            // allocation alive until dispatch returns.
            // SAFETY: live per callers' liveness contract.
            unsafe { Self::deref(self.as_ctx_ptr()) };
        } else if tcp.is_closed() {
            self.fail(ErrorCode::Cancel);
        } else if !has_ws {
            // handle_close re-enters synchronously; no borrows are live.
            tcp.close(uws::CloseCode::Failure);
        }
        // Any arm above that didn't transfer ownership to `did_connect` left
        // the retained ref in `saved_secure`; RAII drop releases it now.
        drop(saved_secure);
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<Self>();
        cost += self.body.borrow().capacity();
        cost += self.to_send_len.get();
        cost
    }

    pub fn handle_writable(&self, socket: Socket<SSL>) {
        debug_assert!(self.is_same_socket(socket));

        // Forward to proxy tunnel if active
        if let Some(tunnel) = self.tunnel_ptr() {
            // SAFETY: `proxy` holds a live ref on `tunnel`.
            unsafe { WebSocketProxyTunnel::on_writable(tunnel.as_ptr()) };
            // In .done state (after WebSocket upgrade), just handle tunnel writes
            if self.state.get() == State::Done {
                return;
            }

            // Flush any unwritten upgrade request bytes through the tunnel.
            // The write can synchronously re-enter fail/clear_data, so write
            // from an owned copy and clamp the bookkeeping afterwards.
            if self.to_send_len.get() == 0 {
                return;
            }
            let pending = self.pending_write_bytes();
            // SAFETY: `proxy` holds a live ref on `tunnel`.
            match unsafe { WebSocketProxyTunnel::write(tunnel.as_ptr(), &pending) } {
                Ok(wrote) => self.note_wrote(wrote),
                Err(_) => self.fail(ErrorCode::FailedToWrite),
            }
            return;
        }

        if self.to_send_len.get() == 0 {
            return;
        }

        // Plain socket send; never re-enters, so the borrow may span it.
        let wrote = {
            let buf = self.input_body_buf.borrow();
            let pending = self.to_send_len.get().min(buf.len());
            socket.write(&buf[buf.len() - pending..])
        };
        if wrote < 0 {
            self.fail(ErrorCode::FailedToWrite);
            return;
        }
        self.note_wrote(usize::try_from(wrote).expect("int cast"));
    }

    pub fn handle_timeout(&self) {
        self.fail(ErrorCode::Timeout);
    }

    /// In theory, this could be called immediately (synchronously from
    /// `connect_*_owned`). In that case, we set `state` to `Failed` and
    /// return, expecting `connect` to observe it and release the C++ ref.
    /// Terminal: core releases its attach ref exactly once after this returns.
    pub fn handle_connect_error(&self) {
        self.detach_tcp();

        if self.state.get() == State::Reading {
            self.fail(ErrorCode::FailedToConnect);
        } else {
            self.state.set(State::Failed);
        }
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
// Storing parallel `name_slices` / `value_slices` arrays borrowing into
// `slices` would be self-referential; instead store only the `Utf8Slice` array (len =
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
        // SAFETY: per fn contract — `values_ptr` points to `len` live `BunString`s.
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
// Rust cannot `#[no_mangle]` a generic, so monomorphize both here.
//
// C-ABI mapping (verified against the declarations in
// src/jsc/bindings/headers.h and the call sites in WebSocket.cpp):
//   - non-null `const BunString*` params (host/path/protocols) → `&BunString`;
//   - nullable `const BunString*` params (proxyHost/proxyAuthorization/
//     targetAuthorization/unixSocketPath, passed as `nullptr` or `&local`)
//     → `Option<&BunString>` (guaranteed null-pointer niche);
//   - `BunString*` array + `size_t` count pairs → `*const BunString` + `usize`
//     (count may be 0 with a dangling/null begin(); never dereferenced then);
//   - `void* sslConfig` (ownership transferred, boxed by
//     `Bun__WebSocket__parseSSLConfig`) → `Option<Box<SSLConfig>>`
//     (null-pointer niche; Box matches the transferred ownership).
// Keep these signatures in sync with headers.h if either side changes.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! export_http_client {
    ($ssl:literal, $connect:ident, $cancel:ident, $memory_cost:ident) => {
        const _: () = {
            // `pub(crate)`: these exist only for the C++ caller via `no_mangle`;
            // the anonymous `const` block makes them unreachable from Rust paths.
            #[unsafe(no_mangle)]
            pub(crate) unsafe extern "C" fn $connect(
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
            pub(crate) unsafe extern "C" fn $cancel(this: *mut HTTPClient<$ssl>) {
                // SAFETY: caller (C++) holds a live ref; `this` carries root
                // (userdata) provenance from `heap::alloc`.
                unsafe { HTTPClient::<$ssl>::cancel(this) };
            }

            #[unsafe(no_mangle)]
            pub(crate) unsafe extern "C" fn $memory_cost(this: *mut HTTPClient<$ssl>) -> usize {
                // SAFETY: caller (C++) holds a live ref.
                unsafe { (*this).memory_cost() }
            }
        };
    };
}
// `${concat(...)}` metavar-expr is unstable; hand-expand the two
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

/// Aliases for `WebSocketProxyTunnel`.
pub type NewHttpUpgradeClient<const SSL: bool> = HTTPClient<SSL>;
pub(crate) type HttpUpgradeClient = HTTPClient<false>;
pub(crate) type HttpsUpgradeClient = HTTPClient<true>;
