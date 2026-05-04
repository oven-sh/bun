use core::cell::Cell;
use core::ffi::{c_int, c_void};
use std::sync::Arc;

use bun_boringssl as boringssl;
use bun_boringssl_sys::SSL_CTX;
use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::{self, Error, FeatureFlags};
use bun_http::{self as http, h2, HTTPCertError, HTTPClient, HTTPThread, InitError, ProxyTunnel};
use bun_runtime::api::server::server_config::SSLConfig;
use bun_str::strings;
use bun_uws as uws;

bun_output::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const MAX_KEEPALIVE_HOSTNAME: usize = 128;

/// Zig: `fn NewHTTPContext(comptime ssl: bool) type { return struct { ... } }`
/// The const-generic `SSL` is load-bearing for monomorphization (gates hot
/// inner-loop branches); do not demote to a runtime bool.
// PORT NOTE: renamed NewHTTPContext→HTTPContext — `New` is a Zig type-factory
// naming convention, not part of the type's identity; LIFETIMES.tsv already
// aliases `*NewHTTPContext(true)` as `HttpsContext`.
pub struct HTTPContext<const SSL: bool> {
    /// Heap-allocated custom-SSL contexts only. The cache entry in
    /// custom_ssl_context_map holds 1; each in-flight HTTPClient that set
    /// `client.custom_ssl_ctx = this` holds 1. Eviction drops the cache
    /// ref but the context survives until the last client releases it,
    /// so deinit() never runs while a request is mid-flight. The global
    /// http_context/https_context start at 1 and are never deref'd.
    pub ref_count: Cell<u32>,
    pub pending_sockets: PooledSocketHiveAllocator<SSL>,
    /// Embedded sweep/iteration list-head for every socket this context
    /// owns (active clients + pooled keepalive). Address-stable: this
    /// struct is either a `http_thread.{http,https}_context` static or a
    /// `bun.default_allocator.create()` for custom-SSL entries.
    pub group: uws::SocketGroup,
    /// `SSL_CTX*` built from this context's SSLConfig (or the default
    /// `request_cert=1` opts). One owned ref; `SSL_CTX_free` on deinit.
    /// Only meaningful when `SSL`.
    pub secure: Option<*mut SSL_CTX>,
    /// HTTP/2 sessions with at least one active stream, available for
    /// concurrent attachment if `hasHeadroom()`.
    // TODO(port): lifetime — Zig stores `*H2.ClientSession` with manual
    // `.ref()`/`.deref()`. Arc clone/drop subsumes those calls.
    pub active_h2_sessions: Vec<Arc<h2::ClientSession>>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket.
    // TODO(port): lifetime — owned Box<PendingConnect>; `pc.deinit()` in Drop.
    pub pending_h2_connects: Vec<Box<h2::PendingConnect>>,
}

// Intrusive refcount: Zig `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
// `*T` crosses FFI (group.ext) and is recovered from socket ext, so per
// PORTING.md this stays intrusive rather than `Rc<T>`.
pub type HTTPContextRc<const SSL: bool> = bun_ptr::IntrusiveRc<HTTPContext<SSL>>;

pub type PooledSocketHiveAllocator<const SSL: bool> = HiveArray<PooledSocket<SSL>, POOL_SIZE>;

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

pub type ActiveSocket<const SSL: bool> =
    TaggedPtrUnion<(DeadSocket, HTTPClient, PooledSocket<SSL>, h2::ClientSession)>;

pub struct PooledSocket<const SSL: bool> {
    pub http_socket: HTTPSocket<SSL>,
    pub hostname_buf: [u8; MAX_KEEPALIVE_HOSTNAME],
    pub hostname_len: u8,
    pub port: u16,
    /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
    pub did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
    /// The interned SSLConfig this socket was created with (None = default context).
    /// Owns a strong ref while the socket is in the keepalive pool.
    // TODO(port): SSLConfig.SharedPtr — assuming Arc-shaped shared ptr.
    pub ssl_config: Option<Arc<SSLConfig>>,
    /// The context that owns this pooled socket's memory (for returning to correct pool).
    pub owner: *const HTTPContext<SSL>,
    /// If this socket carries an established CONNECT tunnel (HTTPS through
    /// an HTTP proxy), the tunnel is preserved here. The pool owns one
    /// strong ref while the socket is parked. None for direct connections.
    // TODO(port): ProxyTunnel.RefPtr is intrusive; LIFETIMES.tsv classifies
    // the equivalent ExistingSocket.tunnel as Arc — using Arc here for
    // consistency. Revisit if ProxyTunnel must stay intrusive across FFI.
    pub proxy_tunnel: Option<Arc<ProxyTunnel>>,
    /// Target (origin) hostname the tunnel connects to. `hostname_buf`
    /// above holds the PROXY hostname; this is the upstream we CONNECTed
    /// to. Heap-allocated only when proxy_tunnel is set; empty otherwise.
    pub target_hostname: Box<[u8]>,
    pub target_port: u16,
    /// Hash of the effective Proxy-Authorization value so that tunnels
    /// established with different credentials are not cross-shared.
    /// 0 = no proxy auth.
    pub proxy_auth_hash: u64,
    /// HTTP/2 connection state (HPACK tables, server SETTINGS) when
    /// this socket negotiated "h2". Owned by the pool while parked.
    pub h2_session: Option<Arc<h2::ClientSession>>,
}

struct ExistingSocket<const SSL: bool> {
    socket: HTTPSocket<SSL>,
    /// Non-null if the socket carries an established CONNECT tunnel.
    /// Ownership (one strong ref) is transferred to the caller.
    tunnel: Option<Arc<ProxyTunnel>>,
    /// Non-null if the socket negotiated "h2"; ownership transferred.
    h2_session: Option<Arc<h2::ClientSession>>,
}

impl<const SSL: bool> HTTPContext<SSL> {
    pub const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    /// `dispatch.zig` reaches `Handler` via this name. The ext stores
    /// `*anyopaque` (the `ActiveSocket` tagged pointer), so dispatch reads
    /// it as `**anyopaque` and `Handler` decodes the tag.
    pub type ActiveSocketHandler = Handler<SSL>;

    pub fn ref_(&self) {
        // TODO(port): IntrusiveRc::ref — increments self.ref_count
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref(&self) {
        // TODO(port): IntrusiveRc::deref — decrements; runs Drop at 0.
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; this struct was Box-allocated for
            // custom-SSL entries (statics never reach 0).
            unsafe { drop(Box::from_raw(self as *const Self as *mut Self)) };
        }
    }

    pub fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if tagged.is::<PooledSocket<SSL>>() {
            Handler::<SSL>::add_memory_back_to_pool(tagged.as_::<PooledSocket<SSL>>());
        }

        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
            unsafe { *ctx = ActiveSocket::<SSL>::init(dead_socket()).ptr() as *mut c_void };
        }
    }

    pub fn mark_socket_as_dead(socket: HTTPSocket<SSL>) {
        Self::mark_tagged_socket_as_dead(socket, Self::get_tagged_from_socket(socket));
    }

    pub fn terminate_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseCode::Failure);
    }

    pub fn close_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseCode::Normal);
    }

    /// `ptr` is the *value* stored in the socket ext (the packed
    /// `ActiveSocket` tagged pointer), already dereferenced by
    /// `NsHandler` before reaching `Handler.on*`. No second deref.
    fn get_tagged(ptr: *mut c_void) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::from(ptr)
    }

    pub fn get_tagged_from_socket(socket: HTTPSocket<SSL>) -> ActiveSocket<SSL> {
        if let Some(slot) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
            return Self::get_tagged(unsafe { *slot });
        }
        ActiveSocket::<SSL>::init(dead_socket())
    }

    pub fn context() -> &'static mut Self {
        if SSL {
            &mut http::http_thread().https_context
        } else {
            &mut http::http_thread().http_context
        }
    }

    pub fn register_h2(&mut self, session: &Arc<h2::ClientSession>) {
        if !SSL {
            return;
        }
        if session.registry_index() != u32::MAX {
            return;
        }
        // PORT NOTE: Arc::clone subsumes Zig `session.ref()`.
        session.set_registry_index(u32::try_from(self.active_h2_sessions.len()).unwrap());
        self.active_h2_sessions.push(session.clone());
    }

    /// Called from drainQueuedShutdowns when the abort-tracker lookup
    /// misses: a request parked in `PendingConnect.waiters` (coalesced
    /// onto a leader's in-flight TLS connect) never registered a socket,
    /// so it can only be found by scanning here.
    pub fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
        if !SSL {
            return false;
        }
        for pc in &mut self.pending_h2_connects {
            for (i, waiter) in pc.waiters.iter().enumerate() {
                if waiter.async_http_id == async_http_id {
                    let waiter = pc.waiters.swap_remove(i);
                    waiter.fail_from_h2(bun_core::err!("Aborted"));
                    return true;
                }
            }
        }
        false
    }

    pub fn unregister_h2(&mut self, session: &h2::ClientSession) {
        if !SSL {
            return;
        }
        let idx = session.registry_index();
        if idx == u32::MAX {
            return;
        }
        session.set_registry_index(u32::MAX);
        let list = &mut self.active_h2_sessions;
        debug_assert!(
            (idx as usize) < list.len() && Arc::as_ptr(&list[idx as usize]) == session as *const _
        );
        // PORT NOTE: dropping the Arc subsumes Zig `session.deref()`.
        let _ = list.swap_remove(idx as usize);
        if (idx as usize) < list.len() {
            list[idx as usize].set_registry_index(idx);
        }
    }

    pub fn tag_as_h2(socket: HTTPSocket<SSL>, session: &h2::ClientSession) {
        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
            unsafe { *ctx = ActiveSocket::<SSL>::init(session).ptr() as *mut c_void };
        }
    }

    pub fn ssl_ctx(&self) -> *mut SSL_CTX {
        if !SSL {
            unreachable!();
        }
        self.secure.unwrap()
    }

    pub fn init_with_client_config(&mut self, client: &mut HTTPClient) -> Result<(), InitError> {
        // TODO(port): `if (!comptime ssl) @compileError("ssl only")` — Rust
        // cannot @compileError on a const-generic bool branch without nightly;
        // debug_assert until Phase B splits impls.
        debug_assert!(SSL, "ssl only");
        let opts = client
            .tls_props
            .as_ref()
            .unwrap()
            .get()
            .as_usockets_for_client_verification();
        self.init_with_opts(&opts)
    }

    fn init_with_opts(
        &mut self,
        opts: &uws::socket_context::BunSocketContextOptions,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let mut err = uws::create_bun_socket_error_t::None;
        self.secure = match opts.create_ssl_context(&mut err) {
            Some(ctx) => Some(ctx),
            None => {
                return Err(match err {
                    uws::create_bun_socket_error_t::LoadCaFile => InitError::LoadCAFile,
                    uws::create_bun_socket_error_t::InvalidCaFile => InitError::InvalidCAFile,
                    uws::create_bun_socket_error_t::InvalidCa => InitError::InvalidCA,
                    _ => InitError::FailedToOpenSocket,
                });
            }
        };
        // SAFETY: secure was just set to Some.
        unsafe { boringssl::ssl_ctx_setup(self.ssl_ctx()) };
        self.group
            .init(http::http_thread().loop_.loop_, None, self as *mut _);
        Ok(())
    }

    pub fn init_with_thread_opts(
        &mut self,
        init_opts: &HTTPThread::InitOpts,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let opts = uws::socket_context::BunSocketContextOptions {
            ca: if !init_opts.ca.is_empty() {
                init_opts.ca.as_ptr().cast()
            } else {
                core::ptr::null()
            },
            ca_count: u32::try_from(init_opts.ca.len()).unwrap(),
            ca_file_name: if !init_opts.abs_ca_file_name.is_empty() {
                init_opts.abs_ca_file_name.as_ptr()
            } else {
                core::ptr::null()
            },
            request_cert: 1,
            ..Default::default()
        };
        self.init_with_opts(&opts)
    }

    pub fn init(&mut self) {
        self.group
            .init(http::http_thread().loop_.loop_, None, self as *mut _);
        if SSL {
            let mut err = uws::create_bun_socket_error_t::None;
            self.secure = Some(
                uws::socket_context::BunSocketContextOptions {
                    // we request the cert so we load root certs and can verify it
                    request_cert: 1,
                    // we manually abort the connection if the hostname doesn't match
                    reject_unauthorized: 0,
                    ..Default::default()
                }
                .create_ssl_context(&mut err)
                .unwrap(),
            );
            // SAFETY: secure was just set to Some.
            unsafe { boringssl::ssl_ctx_setup(self.ssl_ctx()) };
        }
    }

    /// Attempt to keep the socket alive by reusing it for another request.
    /// If no space is available, close the socket.
    ///
    /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
    /// is set, then we can only reuse the socket for HTTP Keep Alive if
    /// `reject_unauthorized` is set to `false`.
    ///
    /// If `tunnel` is non-null, the socket carries an established CONNECT
    /// tunnel. The pool takes ownership of one strong ref on the tunnel;
    /// the caller must NOT deref it afterwards. If pooling fails (pool
    /// full, hostname too long, socket bad), the tunnel is dereffed here.
    #[allow(clippy::too_many_arguments)]
    pub fn release_socket(
        &mut self,
        socket: HTTPSocket<SSL>,
        did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<&Arc<SSLConfig>>,
        tunnel: Option<Arc<ProxyTunnel>>,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        h2_session: Option<Arc<h2::ClientSession>>,
    ) {
        // log("releaseSocket(0x{f})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

        if cfg!(debug_assertions) {
            debug_assert!(!socket.is_closed());
            debug_assert!(!socket.is_shutdown());
            debug_assert!(socket.is_established());
        }
        debug_assert!(!hostname.is_empty());
        debug_assert!(port > 0);

        if hostname.len() <= MAX_KEEPALIVE_HOSTNAME
            && !socket.is_closed_or_has_error()
            && socket.is_established()
        {
            if let Some(pending) = self.pending_sockets.get() {
                if let Some(ctx) = socket.ext::<*mut c_void>() {
                    // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
                    unsafe {
                        *ctx = ActiveSocket::<SSL>::init(pending as *mut PooledSocket<SSL>).ptr()
                            as *mut c_void
                    };
                }
                socket.flush();
                socket.timeout(0);
                socket.set_timeout_minutes(5);

                pending.http_socket = socket;
                pending.did_have_handshaking_error_while_reject_unauthorized_is_false =
                    did_have_handshaking_error_while_reject_unauthorized_is_false;
                pending.hostname_buf[..hostname.len()].copy_from_slice(hostname);
                pending.hostname_len = hostname.len() as u8; // @truncate
                pending.port = port;
                pending.owner = self as *const _;
                // Clone a strong ref for the keepalive pool; the caller retains
                // its own ref via HTTPClient.tls_props.
                pending.ssl_config = ssl_config.cloned();

                // Pool owns the tunnel ref transferred by the caller.
                let had_tunnel = tunnel.is_some();
                pending.proxy_tunnel = tunnel;
                pending.proxy_auth_hash = proxy_auth_hash;
                pending.target_hostname = if had_tunnel && !target_hostname.is_empty() {
                    Box::<[u8]>::from(target_hostname)
                } else {
                    Box::default()
                };
                pending.target_port = target_port;
                pending.h2_session = h2_session;

                bun_output::scoped_log!(
                    HTTPContext,
                    "Keep-Alive release {}:{} tunnel={} target={}:{}",
                    bstr::BStr::new(hostname),
                    port,
                    had_tunnel,
                    bstr::BStr::new(target_hostname),
                    target_port,
                );
                return;
            }
        }
        bun_output::scoped_log!(HTTPContext, "close socket");
        if let Some(t) = tunnel {
            t.shutdown();
            // TODO(port): `detachAndDeref()` — Arc drop subsumes deref; detach
            // semantics need explicit call.
            t.detach();
            drop(t);
        }
        drop(h2_session); // PORT NOTE: subsumes `s.deref()`
        Self::close_socket(socket);
    }

    fn existing_socket(
        &mut self,
        reject_unauthorized: bool,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<*const SSLConfig>,
        want_tunnel: bool,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        want_h2: boringssl::ssl::AlpnOffer,
    ) -> Option<ExistingSocket<SSL>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }

        let mut iter = self.pending_sockets.used.iter_set();

        while let Some(pending_socket_index) = iter.next() {
            let socket = self
                .pending_sockets
                .at(u16::try_from(pending_socket_index).unwrap());
            if socket.port != port {
                continue;
            }

            // Match ssl_config by pointer equality (interned configs)
            if SSLConfig::raw_ptr(socket.ssl_config.as_ref()) != ssl_config {
                continue;
            }

            if socket.did_have_handshaking_error_while_reject_unauthorized_is_false
                && reject_unauthorized
            {
                continue;
            }

            // ALPN on the pooled socket has already decided which protocol
            // it speaks; only match callers compatible with that choice.
            if socket.h2_session.is_some() {
                if want_h2 == boringssl::ssl::AlpnOffer::H1 {
                    continue;
                }
            } else if want_h2 == boringssl::ssl::AlpnOffer::H2Only {
                continue;
            }

            // Tunnel presence must match: a direct-connection socket cannot
            // serve a tunneled request and vice versa.
            if want_tunnel != socket.proxy_tunnel.is_some() {
                continue;
            }

            if want_tunnel {
                if socket.proxy_auth_hash != proxy_auth_hash {
                    continue;
                }
                if socket.target_port != target_port {
                    continue;
                }
                if !strings::eql_long(&socket.target_hostname, target_hostname, true) {
                    continue;
                }
                // A tunnel established with reject_unauthorized=false never
                // ran checkServerIdentity — a CA-valid wrong-hostname cert
                // leaves did_have_handshaking_error=false so the outer
                // guard passes. Block a strict caller from reusing it.
                if reject_unauthorized
                    && !socket
                        .proxy_tunnel
                        .as_ref()
                        .unwrap()
                        .data
                        .established_with_reject_unauthorized
                {
                    continue;
                }
            }

            if strings::eql_long(
                &socket.hostname_buf[..socket.hostname_len as usize],
                hostname,
                true,
            ) {
                let http_socket = socket.http_socket;

                if http_socket.is_closed() {
                    Self::mark_socket_as_dead(http_socket);
                    continue;
                }

                if http_socket.is_shutdown() || http_socket.get_error() != 0 {
                    Self::terminate_socket(http_socket);
                    continue;
                }

                // Release the pool's strong ref (caller has its own via tls_props)
                socket.ssl_config = None;
                // Transfer tunnel ownership to the caller.
                // PORT NOTE: `rp.leak()` → `Option::take()` (move strong ref out).
                let tunnel: Option<Arc<ProxyTunnel>> = socket.proxy_tunnel.take();
                socket.target_hostname = Box::default();
                let h2_session = socket.h2_session.take();
                let ok = self.pending_sockets.put(socket);
                debug_assert!(ok);
                bun_output::scoped_log!(
                    HTTPContext,
                    "+ Keep-Alive reuse {}:{}{}",
                    bstr::BStr::new(hostname),
                    port,
                    if tunnel.is_some() { " (with tunnel)" } else { "" }
                );
                return Some(ExistingSocket {
                    socket: http_socket,
                    tunnel,
                    h2_session,
                });
            }
        }

        None
    }

    pub fn connect_socket(
        &mut self,
        client: &mut HTTPClient,
        socket_path: &[u8],
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        // TODO(port): narrow error set
        client.connected_url = client.http_proxy.clone().unwrap_or_else(|| client.url.clone());
        let socket = HTTPSocket::<SSL>::connect_unix_group(
            &mut self.group,
            Self::KIND,
            if SSL { self.secure } else { None },
            socket_path,
            ActiveSocket::<SSL>::init(client).ptr(),
            false, // dont allow half-open sockets
        )?;
        client.allow_retry = false;
        Ok(socket)
    }

    pub fn connect(
        &mut self,
        client: &mut HTTPClient,
        hostname_: &[u8],
        port: u16,
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        // TODO(port): narrow error set
        let hostname: &[u8] =
            if FeatureFlags::HARDCODE_LOCALHOST_TO_127_0_0_1 && hostname_ == b"localhost" {
                b"127.0.0.1"
            } else {
                hostname_
            };

        client.connected_url = client.http_proxy.clone().unwrap_or_else(|| client.url.clone());
        client.connected_url.hostname = hostname.into();

        if SSL {
            if client.can_offer_h2() {
                for session in &self.active_h2_sessions {
                    if session.has_headroom()
                        && session.matches(hostname, port, SSLConfig::raw_ptr(client.tls_props.as_ref()))
                    {
                        session.adopt(client);
                        return Ok(None);
                    }
                }
                for pc in &mut self.pending_h2_connects {
                    if pc.matches(hostname, port, SSLConfig::raw_ptr(client.tls_props.as_ref())) {
                        pc.waiters.push(client);
                        return Ok(None);
                    }
                }
            }
        }

        if client.is_keep_alive_possible() {
            let want_tunnel = client.http_proxy.is_some() && client.url.is_https();
            // CONNECT TCP target (writeProxyConnect line 346). The SNI
            // override (client.hostname) is hashed into proxyAuthHash.
            let target_hostname: &[u8] = if want_tunnel { &client.url.hostname } else { b"" };
            let target_port: u16 = if want_tunnel {
                client.url.get_port_auto()
            } else {
                0
            };
            let proxy_auth_hash: u64 = if want_tunnel { client.proxy_auth_hash() } else { 0 };

            if let Some(found) = self.existing_socket(
                client.flags.reject_unauthorized,
                hostname,
                port,
                SSLConfig::raw_ptr(client.tls_props.as_ref()),
                want_tunnel,
                target_hostname,
                target_port,
                proxy_auth_hash,
                if SSL {
                    client.alpn_offer()
                } else {
                    boringssl::ssl::AlpnOffer::H1
                },
            ) {
                let sock = found.socket;
                if let Some(ctx) = sock.ext::<*mut c_void>() {
                    // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
                    unsafe {
                        *ctx = ActiveSocket::<SSL>::init(client as *mut HTTPClient).ptr()
                            as *mut c_void
                    };
                }
                client.allow_retry = true;
                if let Some(session) = found.h2_session {
                    if SSL {
                        // TODO(port): `session.socket = sock` requires interior
                        // mutability on Arc<ClientSession>.
                        session.set_socket(sock);
                        Self::tag_as_h2(sock, &session);
                        self.register_h2(&session);
                        session.adopt(client);
                    } else {
                        unreachable!();
                    }
                    return Ok(None);
                }
                if let Some(tunnel) = found.tunnel {
                    // Reattach the pooled tunnel BEFORE onOpen so the
                    // request/response stage is already .proxy_headers.
                    // onOpen only promotes .pending -> .opened, and
                    // firstCall only acts on .opened/.pending, so both
                    // become no-ops for the CONNECT/handshake phases.
                    tunnel.adopt(client, SSL, sock);
                    client.on_open::<SSL>(sock)?;
                    client.on_writable::<SSL>(true, sock);
                } else {
                    client.on_open::<SSL>(sock)?;
                    if SSL {
                        client.first_call::<SSL>(sock);
                    }
                }
                return Ok(Some(sock));
            }
        }

        let socket = HTTPSocket::<SSL>::connect_group(
            &mut self.group,
            Self::KIND,
            if SSL { self.secure } else { None },
            hostname,
            port,
            ActiveSocket::<SSL>::init(client as *mut HTTPClient).ptr(),
            false,
        )?;
        client.allow_retry = false;
        if SSL {
            if client.can_offer_h2() {
                let pc = Box::new(h2::PendingConnect {
                    hostname: Box::<[u8]>::from(hostname),
                    port,
                    ssl_config: SSLConfig::raw_ptr(client.tls_props.as_ref()),
                    ..Default::default()
                });
                // TODO(port): `client.pending_h2 = pc` stores a backref into
                // the Vec-owned Box; needs raw ptr or different ownership.
                client.pending_h2 = Some(&*pc as *const h2::PendingConnect as *mut _);
                self.pending_h2_connects.push(pc);
            }
        }
        Ok(socket)
    }
}

impl<const SSL: bool> Drop for HTTPContext<SSL> {
    fn drop(&mut self) {
        // Drain pooled keepalive sockets: deref their ssl_config and force-close.
        // Must force-close (code != 0) because SSL clean shutdown (code=0) requires a
        // shutdown handshake with the peer, which won't complete during eviction.
        // Without force-close, the socket stays linked and the context refcount never
        // reaches 0, leaking the SSL_CTX.
        {
            let mut iter = self.pending_sockets.used.iter_set();
            while let Some(idx) = iter.next() {
                let pooled = self.pending_sockets.at(u16::try_from(idx).unwrap());
                // Not gated on comptime ssl — an HTTP-proxy-to-HTTPS
                // tunnel pools in the non-SSL context but still stores
                // the inner-TLS tls_props here for pool-key matching.
                pooled.ssl_config = None;
                // Do NOT call rp.data.shutdown() here — it drives
                // SSLWrapper.shutdown → triggerCloseCallback →
                // onClose(handlers.ctx), and handlers.ctx is the
                // stale HTTPClient pointer from detachOwner(). That
                // client is freed by now. http_socket.close(.failure)
                // below force-closes the TCP without triggering the
                // callback, same as addMemoryBackToPool().
                pooled.proxy_tunnel = None;
                pooled.target_hostname = Box::default();
                pooled.h2_session = None;
                pooled.http_socket.close(uws::CloseCode::Failure);
            }
        }

        // PORT NOTE: Vec drop subsumes `active_h2_sessions.deinit()`.
        // PORT NOTE: Box<PendingConnect> Drop subsumes `pc.deinit()`; Vec drop
        // subsumes `pending_h2_connects.deinit()`.

        // Force-close any remaining sockets before unlinking the group so
        // the loop never dereferences a freed `*Context` via `group->ext`.
        self.group.close_all();
        // PORT NOTE: SocketGroup Drop subsumes `group.deinit()`.
        if SSL {
            if let Some(c) = self.secure {
                // SAFETY: we own one ref on the SSL_CTX.
                unsafe { bun_boringssl_sys::SSL_CTX_free(c) };
            }
        }
        // PORT NOTE: `bun.default_allocator.destroy(this)` is the Box drop
        // performed by IntrusiveRc when refcount hits 0; not repeated here.
    }
}

/// Named so `dispatch.zig` can `vtable.make` it. Ext is the
/// `ActiveSocket` tagged-pointer word.
pub struct Handler<const SSL: bool>;

impl<const SSL: bool> Handler<SSL> {
    pub fn on_open(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let active = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = active.get::<HTTPClient>() {
            match client.on_open::<SSL>(socket) {
                Ok(_) => return,
                Err(_) => {
                    bun_output::scoped_log!(HTTPContext, "Unable to open socket");
                    HTTPContext::<SSL>::terminate_socket(socket);
                    return;
                }
            }
        }

        bun_output::scoped_log!(HTTPContext, "Unexpected open on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_handshake(
        ptr: *mut c_void,
        socket: HTTPSocket<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_success = success == 1;

        let handshake_error = HTTPCertError {
            error_no: ssl_error.error_no,
            code: if ssl_error.code.is_null() {
                bun_str::ZStr::EMPTY
            } else {
                // SAFETY: non-null NUL-terminated C string from uSockets.
                unsafe { bun_str::ZStr::from_ptr(ssl_error.code) }
            },
            reason: if ssl_error.code.is_null() {
                bun_str::ZStr::EMPTY
            } else {
                // SAFETY: non-null NUL-terminated C string from uSockets.
                unsafe { bun_str::ZStr::from_ptr(ssl_error.reason) }
            },
        };

        let active = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = active.get::<HTTPClient>() {
            // handshake completed but we may have ssl errors
            client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if handshake_success {
                if client.flags.reject_unauthorized {
                    // only reject the connection if reject_unauthorized == true
                    if client.flags.did_have_handshaking_error {
                        client.close_and_fail::<SSL>(
                            boringssl::get_cert_error_from_no(handshake_error.error_no),
                            socket,
                        );
                        return;
                    }

                    // if checkServerIdentity returns false, we dont call firstCall — the connection was rejected
                    // SAFETY: native handle of an SSL socket is `SSL*`.
                    let ssl_ptr =
                        unsafe { socket.get_native_handle() as *mut bun_boringssl_sys::SSL };
                    if !client.check_server_identity::<SSL>(socket, handshake_error, ssl_ptr, true) {
                        // checkServerIdentity already called closeAndFail() → fail()
                        // → result callback, which may have destroyed the
                        // AsyncHTTP that embeds `client`. Socket is terminated
                        // and the abort tracker is unregistered there, so the
                        // only safe action is to return without touching
                        // `client` again.
                        return;
                    }
                }

                return client.first_call::<SSL>(socket);
            } else {
                // if we are here is because server rejected us, and the error_no is the cause of this
                // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                if client.flags.did_have_handshaking_error {
                    client.close_and_fail::<SSL>(
                        boringssl::get_cert_error_from_no(handshake_error.error_no),
                        socket,
                    );
                    return;
                }
                // if handshake_success it self is false, this means that the connection was rejected
                client.close_and_fail::<SSL>(bun_core::err!("ConnectionRefused"), socket);
                return;
            }
        }

        if socket.is_closed() {
            HTTPContext::<SSL>::mark_socket_as_dead(socket);
            return;
        }

        if handshake_success {
            if active.is::<PooledSocket<SSL>>() {
                // Allow pooled sockets to be reused if the handshake was successful.
                socket.set_timeout(0);
                socket.set_timeout_minutes(5);
                return;
            }
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_close(ptr: *mut c_void, socket: HTTPSocket<SSL>, _: c_int, _: Option<*mut c_void>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        HTTPContext::<SSL>::mark_socket_as_dead(socket);

        if let Some(client) = tagged.get::<HTTPClient>() {
            return client.on_close::<SSL>(socket);
        }
        if let Some(session) = tagged.get::<h2::ClientSession>() {
            return session.on_close(bun_core::err!("ConnectionClosed"));
        }
    }

    fn add_memory_back_to_pool(pooled: &mut PooledSocket<SSL>) {
        pooled.ssl_config = None;
        pooled.proxy_tunnel = None;
        pooled.target_hostname = Box::default();
        pooled.h2_session = None;
        // SAFETY: owner is the HiveArray backing this slot; address-stable
        // (static or Box-allocated) and outlives any pooled entry.
        let ok = unsafe { (*(pooled.owner as *mut HTTPContext<SSL>)).pending_sockets.put(pooled) };
        debug_assert!(ok);
    }

    pub fn on_data(ptr: *mut c_void, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.get::<HTTPClient>() {
            return client.on_data::<SSL>(buf, client.get_ssl_ctx::<SSL>(), socket);
        } else if let Some(session) = tagged.get::<h2::ClientSession>() {
            return session.on_data(buf);
        } else if tagged.is::<PooledSocket<SSL>>() {
            let pooled = tagged.as_::<PooledSocket<SSL>>();
            // If this pooled socket carries a CONNECT tunnel, any
            // idle data is inner-TLS traffic (close_notify, alert,
            // pipelined bytes) that we can't process without the
            // SSLWrapper. We'd hand back a tunnel whose inner state
            // diverged from ours. Evict it.
            if pooled.proxy_tunnel.is_some() {
                bun_output::scoped_log!(HTTPContext, "Data on idle pooled tunnel — evicting");
                HTTPContext::<SSL>::terminate_socket(socket);
                return;
            }

            if let Some(session) = &pooled.h2_session {
                session.on_idle_data(buf);
                if !session.can_pool() {
                    HTTPContext::<SSL>::terminate_socket(socket);
                }
                return;
            }

            // trailing zero is fine to ignore
            if buf == http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY {
                return;
            }

            bun_output::scoped_log!(HTTPContext, "Unexpected data on socket");

            return;
        }
        bun_output::scoped_log!(HTTPContext, "Unexpected data on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_writable(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.get::<HTTPClient>() {
            return client.on_writable::<SSL>(false, socket);
        } else if let Some(session) = tagged.get::<h2::ClientSession>() {
            return session.on_writable();
        } else if tagged.is::<PooledSocket<SSL>>() {
            // it's a keep-alive socket
        } else {
            // don't know what this is, let's close it
            bun_output::scoped_log!(HTTPContext, "Unexpected writable on socket");
            HTTPContext::<SSL>::terminate_socket(socket);
        }
    }

    pub fn on_long_timeout(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.get::<HTTPClient>() {
            return client.on_timeout::<SSL>(socket);
        }
        if let Some(session) = tagged.get::<h2::ClientSession>() {
            HTTPContext::<SSL>::mark_socket_as_dead(socket);
            session.on_close(bun_core::err!("Timeout"));
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_connect_error(ptr: *mut c_void, socket: HTTPSocket<SSL>, _: c_int) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
        if let Some(client) = tagged.get::<HTTPClient>() {
            client.on_connect_error();
        }
        // us_connecting_socket_close is always called internally by uSockets
    }

    pub fn on_end(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        // TCP fin must be closed, but we must keep the original tagged
        // pointer so that their onClose callback is called.
        //
        // Four possible states:
        // 1. HTTP Keep-Alive socket: it must be removed from the pool
        // 2. HTTP Client socket: it might need to be retried
        // 3. HTTP/2 session: fail every stream on it
        // 4. Dead socket: it is already marked as dead
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
        socket.close(uws::CloseCode::Failure);

        if let Some(client) = tagged.get::<HTTPClient>() {
            client.on_close::<SSL>(socket);
            return;
        }
        if let Some(session) = tagged.get::<h2::ClientSession>() {
            session.on_close(bun_core::err!("ConnectionClosed"));
            return;
        }
    }
}

/// Must be aligned to `align_of::<usize>()` so that tagged pointer values
/// embedding this address pass the align check in `bun.cast`.
#[repr(C, align(8))]
pub struct DeadSocket {
    garbage: u8,
}

// TODO(port): Zig used `pub var dead_socket align(@alignOf(usize)) = .{}` and
// a module-level `var dead_socket = &DeadSocket.dead_socket`. Using a static
// + accessor; revisit if `&'static mut` is needed for TaggedPtrUnion::init.
static DEAD_SOCKET: DeadSocket = DeadSocket { garbage: 0 };

#[inline]
fn dead_socket() -> *const DeadSocket {
    &DEAD_SOCKET as *const DeadSocket
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HTTPContext.zig (859 lines)
//   confidence: medium
//   todos:      13
//   notes:      const-generic <SSL> monomorphization; Arc used per LIFETIMES.tsv but H2/ProxyTunnel are intrusive-refcounted across FFI — Phase B may need IntrusiveRc; HiveArray iter + at() borrowck overlap needs reshaping; inherent associated type (ActiveSocketHandler) is nightly-only.
// ──────────────────────────────────────────────────────────────────────────
