use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ops::ControlFlow::{self, Break, Continue};
use core::ptr::NonNull;

use crate::http_thread::InitOpts as HTTPThreadInitOpts;
use crate::registry::Registry;
use crate::session_cache::SessionCache;
use crate::ssl_config::{self, SSLConfig};
use crate::{
    self as http, AlpnOffer, AsyncHTTP, HTTPCertError, HTTPClient, HTTPThread, InFlightRequest,
    InitError, NextStep, ProxyTunnel, get_cert_error_from_no, h2,
};
use bun_boringssl::ssl_ctx_setup;
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::HiveArray;
use bun_core::{ZBox, strings};
use bun_ptr::tagged_pointer::TagType;
use bun_ptr::{AliasableBox, RefCount, RefPtr, TaggedPtr};
use bun_uws as uws;

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const UNIX_POOL_SIZE: usize = 128;
pub(crate) const MAX_KEEPALIVE_HOSTNAME: usize = 128;

/// The const-generic `SSL` is load-bearing for monomorphization (gates hot
/// inner-loop branches); do not demote to a runtime bool.
pub struct HTTPContext<const SSL: bool> {
    pub(crate) shared: RefPtr<SharedContext>,
    pending_sockets: LazyPool<SSL, POOL_SIZE>,
    pending_unix_sockets: LazyPool<SSL, UNIX_POOL_SIZE>,
    /// Incremented per park; the lowest value in a full pool is evicted.
    park_seq: u64,
    /// Built from this context's SSLConfig (or the default `request_cert=1`
    /// opts). Only meaningful when `SSL`.
    pub(crate) secure: Option<OwnedSslCtx>,
    /// HTTP/2 sessions with at least one active stream or an unanswered
    /// liveness PING, available for concurrent attachment if `hasHeadroom()`.
    pub(crate) active_h2_sessions: Registry<h2::ClientSession>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket.
    // The `Box` is load-bearing: `client.pending_h2` names an entry by its address.
    #[expect(clippy::vec_box)]
    pub(crate) pending_h2_connects: Vec<Box<h2::PendingConnect>>,
}

/// What uSockets and BoringSSL point to, and use under calls that have `&mut HTTPContext`.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct SharedContext {
    /// A request's ref keeps a custom context after its eviction.
    ref_count: RefCount,
    pub(crate) id: HttpContextId,
    /// Sweep/iteration list-head for every socket this context
    /// owns (active clients + pooled keepalive).
    group: uws::SocketGroup,
    /// Client-side TLS session cache; populated only when `SSL`.
    pub(crate) session_cache: SessionCache,
}

/// See [`HTTPThread::context`].
#[derive(Clone, Copy)]
pub(crate) struct HttpContextId(u32);

impl HttpContextId {
    pub(crate) const DEFAULT: Self = Self(0);

    pub(crate) fn custom(index: u32) -> Self {
        Self(index + 1)
    }

    pub(crate) fn custom_index(self) -> Option<u32> {
        self.0.checked_sub(1)
    }
}

/// Keep-alive pool storage, allocated on the first park.
struct LazyPool<const SSL: bool, const N: usize>(Option<Box<HiveArray<PooledSocket<SSL>, N>>>);

impl<const SSL: bool, const N: usize> LazyPool<SSL, N> {
    const fn new() -> Self {
        Self(None)
    }

    fn get_mut(&mut self) -> Option<&mut HiveArray<PooledSocket<SSL>, N>> {
        self.0.as_deref_mut()
    }

    fn get_or_init(&mut self) -> &mut HiveArray<PooledSocket<SSL>, N> {
        self.0.get_or_insert_with(HiveArray::new_boxed)
    }
}

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

/// What the ext slot of a socket names when it does not hold a request.
#[derive(Clone, Copy)]
pub(crate) enum ActiveSocket {
    Dead,
    Pooled(PoolSlot),
    Session(h2::SessionId),
}

#[derive(Clone, Copy)]
pub(crate) struct PoolSlot {
    context: HttpContextId,
    transport: Transport,
    index: usize,
}

impl ActiveSocket {
    const DEAD: TagType = 0;
    const REQUEST: TagType = 1;
    const POOLED_TCP: TagType = 2;
    const POOLED_UNIX: TagType = 3;
    const SESSION: TagType = 4;
    /// Half of the bits that a `TaggedPtr` has for its address.
    const INDEX_BITS: u32 = 24;

    fn to_ext(self) -> TaggedPtr {
        let (tag, context, index) = match self {
            Self::Dead => (Self::DEAD, HttpContextId::DEFAULT, 0),
            Self::Pooled(slot) => match slot.transport {
                Transport::Tcp => (Self::POOLED_TCP, slot.context, slot.index),
                Transport::Unix => (Self::POOLED_UNIX, slot.context, slot.index),
            },
            Self::Session(id) => (Self::SESSION, id.context, id.index as usize),
        };
        debug_assert!((context.0 as usize | index) >> Self::INDEX_BITS == 0);
        let address = (context.0 as usize) << Self::INDEX_BITS | index;
        TaggedPtr::init(core::ptr::without_provenance::<c_void>(address), tag)
    }

    fn from_ext(ext: TaggedPtr) -> Self {
        let address = ext.get::<c_void>().addr();
        let context = HttpContextId((address >> Self::INDEX_BITS) as u32);
        let index = address & ((1 << Self::INDEX_BITS) - 1);
        let pooled = |transport| {
            Self::Pooled(PoolSlot {
                context,
                transport,
                index,
            })
        };
        match ext.data() {
            Self::POOLED_TCP => pooled(Transport::Tcp),
            Self::POOLED_UNIX => pooled(Transport::Unix),
            Self::SESSION => Self::Session(h2::SessionId {
                context,
                index: index as u32,
            }),
            _ => Self::Dead,
        }
    }

    #[inline]
    pub(crate) fn session(self) -> Option<h2::SessionId> {
        match self {
            Self::Session(id) => Some(id),
            _ => None,
        }
    }
}

/// How the peer on a pooled connection was authenticated. Connections are
/// only shared between requests that authenticate the same way (a
/// `rejectUnauthorized: false` request may take any), so a verdict from a JS
/// `checkServerIdentity` callback is never inherited by a request relying on
/// the native check, or vice versa.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum PeerVerification {
    /// Established with `rejectUnauthorized: false`; neither the chain nor
    /// the hostname was enforced.
    #[default]
    None,
    /// Chain verified against the CA store; identity approved by a JS
    /// `checkServerIdentity` callback at handshake time (like Node's
    /// `https.Agent`, the callback is per connection, not per request).
    Callback,
    /// Chain verified and hostname matched by the native check.
    Native,
}

impl PeerVerification {
    /// Whether a request that verifies at `self` may take a pooled connection
    /// verified at `pooled`.
    #[inline]
    pub(crate) fn admits(self, pooled: PeerVerification) -> bool {
        self == PeerVerification::None || self == pooled
    }
}

/// What `PooledSocket::hostname_buf` names.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Transport {
    /// A hostname, paired with `port`.
    Tcp,
    /// An AF_UNIX socket path. `port` is 0.
    Unix,
}

pub struct PooledSocket<const SSL: bool> {
    pub(crate) http_socket: HTTPSocket<SSL>,
    pub(crate) hostname_buf: [u8; MAX_KEEPALIVE_HOSTNAME],
    pub(crate) hostname_len: u8,
    pub(crate) port: u16,
    pub(crate) transport: Transport,
    pub(crate) park_seq: u64,
    /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
    pub(crate) did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
    /// A CA-valid but wrong-hostname cert leaves `did_have_handshaking_error`
    /// false, so this is what keeps a strict caller off a connection whose
    /// hostname was never checked natively.
    pub(crate) verification: PeerVerification,
    /// `SSLConfig::content_hash` of the config this socket was created with; 0 = default context.
    pub(crate) ssl_config_hash: u64,
    /// If this socket carries an established CONNECT tunnel (HTTPS through
    /// an HTTP proxy), the tunnel is preserved here.
    /// None for direct connections.
    pub(crate) proxy_tunnel: Option<Box<ProxyTunnel>>,
    /// Tunnel: the origin hostname (`hostname_buf` is the proxy). Unix TLS:
    /// the hostname the handshake verified (`hostname_buf` is the path).
    pub(crate) target_hostname: Box<[u8]>,
    pub(crate) target_port: u16,
    /// Hash of the effective Proxy-Authorization value so that tunnels
    /// established with different credentials are not cross-shared.
    /// 0 = no proxy auth.
    pub(crate) proxy_auth_hash: u64,
    /// HTTP/2 connection state (HPACK tables, server SETTINGS) when
    /// this socket negotiated "h2". Owned by the pool while parked.
    pub(crate) h2_session: Option<Box<h2::ClientSession>>,
    /// `PoolOptions::id` of the fetch session that opened it.
    pub(crate) pool_id: u64,
    /// `PoolOptions::idle_timeout_seconds` of the session that parked it.
    pub(crate) idle_timeout_seconds: u32,
}

#[derive(Clone, Copy)]
struct PoolKey<'a> {
    required_for_socket: PeerVerification,
    required_for_target: PeerVerification,
    hostname: &'a [u8],
    port: u16,
    ssl_config_hash: u64,
    want_tunnel: bool,
    target_hostname: &'a [u8],
    target_port: u16,
    proxy_auth_hash: u64,
    want_h2: AlpnOffer,
    transport: Transport,
    pool_id: u64,
}

fn ssl_config_hash(cfg: Option<&SSLConfig>) -> u64 {
    cfg.map_or(0, SSLConfig::content_hash)
}

struct ExistingSocket<const SSL: bool> {
    socket: HTTPSocket<SSL>,
    /// Present if the socket carries an established CONNECT tunnel.
    tunnel: Option<Box<ProxyTunnel>>,
    /// Present if the socket negotiated "h2"; ownership transferred.
    h2_session: Option<Box<h2::ClientSession>>,
    verification: PeerVerification,
}

#[inline(never)]
fn need_socket_handlers() {
    core::hint::black_box(uws::SocketKind::HttpClient);
}

impl<const SSL: bool> HTTPContext<SSL> {
    const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    pub(crate) fn new(id: HttpContextId) -> Self {
        Self {
            shared: RefPtr::new(SharedContext {
                ref_count: RefCount::init(),
                id,
                group: uws::SocketGroup::default(),
                session_cache: SessionCache::new(),
            }),
            pending_sockets: LazyPool::new(),
            pending_unix_sockets: LazyPool::new(),
            park_seq: 0,
            secure: None,
            active_h2_sessions: Registry::new(),
            pending_h2_connects: Vec::new(),
        }
    }

    fn pooled_mut(thread: &mut HTTPThread, slot: PoolSlot) -> &mut PooledSocket<SSL> {
        let ctx = thread.context::<SSL>(slot.context);
        match slot.transport {
            Transport::Tcp => (ctx.pending_sockets.get_mut()).and_then(|p| p.get_mut(slot.index)),
            Transport::Unix => {
                (ctx.pending_unix_sockets.get_mut()).and_then(|p| p.get_mut(slot.index))
            }
        }
        .expect("tagged by park")
    }

    /// Also takes a pooled socket out of its pool.
    pub(crate) fn mark_tagged_socket_as_dead(
        thread: &mut HTTPThread,
        socket: HTTPSocket<SSL>,
        tagged: ActiveSocket,
    ) {
        if let ActiveSocket::Pooled(slot) = tagged {
            let ctx = thread.context::<SSL>(slot.context);
            let removed = match slot.transport {
                Transport::Tcp => {
                    (ctx.pending_sockets.get_mut()).is_some_and(|p| p.remove(slot.index))
                }
                Transport::Unix => {
                    (ctx.pending_unix_sockets.get_mut()).is_some_and(|p| p.remove(slot.index))
                }
            };
            debug_assert!(removed);
        }

        Self::mark_socket_as_dead(socket);
    }

    /// Comes before every close: uSockets dispatches under it, and [`Handler`] can then only handle a dead socket.
    pub(crate) fn mark_socket_as_dead(socket: HTTPSocket<SSL>) {
        Self::set_socket_ext(socket, ActiveSocket::Dead);
    }

    pub(crate) fn terminate_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Failure);
    }

    pub(crate) fn terminate_tagged_socket(
        thread: &mut HTTPThread,
        socket: HTTPSocket<SSL>,
        tagged: ActiveSocket,
    ) {
        Self::mark_tagged_socket_as_dead(thread, socket, tagged);
        thread.unregister_abort_tracker_for_socket(socket.socket);
        socket.close(uws::CloseKind::Failure);
    }

    /// macOS `close_and_fail` for a request with a body: FIN, not RST. With
    /// body bytes in the kernel send buffer XNU's SO_LINGER RST carries
    /// `snd_nxt`, which the peer can drop as out-of-window and never observe
    /// the close; a FIN is in-order. Linux clamps the RST into window and
    /// Windows delivers it, and a FIN would put the aborting client into
    /// TIME_WAIT for every aborted upload (ephemeral-port exhaustion under
    /// abort churn), so those platforms keep `terminate_socket`.
    pub(crate) fn fail_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::FastShutdown);
    }

    pub(crate) fn close_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Normal);
    }

    fn is_dead(socket: HTTPSocket<SSL>) -> bool {
        Self::ext_slot(&socket).is_none_or(|slot| slot.get().data() == ActiveSocket::DEAD)
    }

    #[inline]
    fn ext_slot(socket: &HTTPSocket<SSL>) -> Option<&Cell<TaggedPtr>> {
        // SAFETY: every HTTP-thread socket has one word of ext, which only this function reaches.
        // uSockets frees a closed socket only between two ticks.
        socket.ext().map(|slot| unsafe { &*slot })
    }

    #[inline]
    fn set_socket_ext(socket: HTTPSocket<SSL>, tagged: ActiveSocket) {
        if let Some(slot) = Self::ext_slot(&socket) {
            let old = slot.replace(tagged.to_ext());
            debug_assert!(old.data() != ActiveSocket::REQUEST, "request lost");
        }
    }

    fn put_request(slot: &Cell<TaggedPtr>, request: InFlightRequest) {
        debug_assert!(slot.get().data() == ActiveSocket::DEAD);
        let http = request.into_non_null();
        slot.set(TaggedPtr::init(http.as_ptr(), ActiveSocket::REQUEST));
    }

    /// Leaves the socket marked as dead. `Err` is what `slot` holds instead of a request.
    fn take_request(slot: &Cell<TaggedPtr>) -> Result<InFlightRequest, ActiveSocket> {
        let ext = slot.get();
        let http = NonNull::new(ext.get::<AsyncHTTP>());
        let http = http.filter(|_| ext.data() == ActiveSocket::REQUEST);
        let http = http.ok_or_else(|| ActiveSocket::from_ext(ext))?;
        slot.set(ActiveSocket::Dead.to_ext());
        // SAFETY: only `put_request` writes this tag, and the slot has given it up. uSockets copies
        // the slot of a connecting socket to each candidate, and then dispatches either to the
        // connecting socket or, once that is freed, to the one candidate that opened. No timer is
        // armed on a connecting socket, and `on_open` replaces the abort tracker's handle to it.
        let http = unsafe { AliasableBox::from_non_null(http) };
        Ok(InFlightRequest::new(http))
    }

    /// Runs `body` on the request of `socket`. If it has none, returns what it has instead.
    pub(crate) fn enter_client(
        thread: &mut HTTPThread,
        socket: HTTPSocket<SSL>,
        body: impl FnOnce(&mut HTTPClient<'static>, &mut HTTPThread) -> ControlFlow<NextStep>,
    ) -> Option<ActiveSocket> {
        let Some(slot) = Self::ext_slot(&socket) else {
            return Some(ActiveSocket::Dead);
        };
        match Self::take_request(slot) {
            Ok(request) => {
                Self::run_on_socket(thread, request, socket, slot, body);
                None
            }
            Err(tagged) => Some(tagged),
        }
    }

    /// `slot` is that of `socket`. It is marked as dead, and gets `request` unless `body` breaks.
    fn run_on_socket(
        thread: &mut HTTPThread,
        mut request: InFlightRequest,
        socket: HTTPSocket<SSL>,
        slot: &Cell<TaggedPtr>,
        body: impl FnOnce(&mut HTTPClient<'static>, &mut HTTPThread) -> ControlFlow<NextStep>,
    ) {
        match body(&mut request, thread) {
            Continue(()) => {
                debug_assert!(!socket.is_closed());
                Self::put_request(slot, request);
            }
            Break(step) => Self::run_next_step(thread, request, socket, step),
        }
    }

    fn run_next_step(
        thread: &mut HTTPThread,
        mut request: InFlightRequest,
        socket: HTTPSocket<SSL>,
        step: NextStep,
    ) {
        if let NextStep::ReleaseSocket = step {
            request.release_socket(thread, socket);
        }
        if socket.is_closed() {
            thread.unregister_abort_tracker_for_socket(socket.socket);
        }
        match step {
            NextStep::ReleaseSocket | NextStep::Finish => request.finish(thread),
            NextStep::Connect => request.connect(thread),
            NextStep::AttachH2 => h2::ClientSession::start(thread, socket.assume_ssl(), request),
        }
    }

    /// Lists `session` and tags its socket with it.
    pub(crate) fn register_h2(&mut self, session: Box<h2::ClientSession>) -> h2::SessionId {
        debug_assert!(SSL);
        let socket = session.socket;
        let id = h2::SessionId {
            context: self.shared.id,
            index: self.active_h2_sessions.insert(session),
        };
        HTTPContext::set_socket_ext(socket, ActiveSocket::Session(id));
        id
    }

    /// Called from drainQueuedShutdowns when the abort-tracker lookup
    /// misses: a request parked in `PendingConnect.waiters` (coalesced
    /// onto a leader's in-flight TLS connect) never registered a socket,
    /// so it can only be found by scanning here.
    pub(crate) fn take_pending_h2_waiter(&mut self, async_http_id: u32) -> Option<InFlightRequest> {
        self.pending_h2_connects.iter_mut().find_map(|pc| {
            let waiters = &mut pc.waiters;
            let i = (waiters.iter()).position(|w| w.async_http_id == async_http_id)?;
            Some(waiters.swap_remove(i))
        })
    }

    pub(crate) fn init_with_client_config(
        &mut self,
        client: &mut HTTPClient,
    ) -> Result<(), InitError> {
        // Rust cannot reject a const-generic bool branch at compile time on
        // stable, so this is a debug_assert.
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
        opts: &uws::SocketContext::BunSocketContextOptions,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let mut err = uws::create_bun_socket_error_t::none;
        let ctx = match opts.create_ssl_context(&mut err) {
            Some(ctx) => ctx,
            None => {
                return Err(match err {
                    uws::create_bun_socket_error_t::load_ca_file => InitError::LoadCAFile,
                    uws::create_bun_socket_error_t::invalid_ca_file => InitError::InvalidCAFile,
                    uws::create_bun_socket_error_t::invalid_ca => InitError::InvalidCA,
                    uws::create_bun_socket_error_t::invalid_crl => InitError::InvalidCRL,
                    uws::create_bun_socket_error_t::none
                    | uws::create_bun_socket_error_t::invalid_ciphers
                    | uws::create_bun_socket_error_t::invalid_ecdh_curve => {
                        InitError::FailedToOpenSocket
                    }
                });
            }
        };
        ssl_ctx_setup(self.secure.insert(ctx));
        (self.shared.group).init(uws::Loop::get(), None, core::ptr::null_mut());
        Ok(())
    }

    pub(crate) fn init_with_thread_opts(
        &mut self,
        init_opts: &HTTPThreadInitOpts,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let ca: Vec<_> = init_opts.ca.iter().map(ZBox::as_ptr).collect();
        let opts = uws::SocketContext::BunSocketContextOptions {
            ca: if !ca.is_empty() {
                ca.as_ptr()
            } else {
                core::ptr::null()
            },
            ca_count: u32::try_from(ca.len()).expect("int cast"),
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

    pub(crate) fn init(&mut self) {
        (self.shared.group).init(uws::Loop::get(), None, core::ptr::null_mut());
        if SSL {
            let mut err = uws::create_bun_socket_error_t::none;
            let ctx = self.secure.insert(
                uws::SocketContext::BunSocketContextOptions {
                    // we request the cert so we load root certs and can verify it
                    request_cert: 1,
                    // we manually abort the connection if the hostname doesn't match
                    reject_unauthorized: 0,
                    ..Default::default()
                }
                .create_ssl_context(&mut err)
                .unwrap(),
            );
            ssl_ctx_setup(ctx);
        }
    }

    /// Attempt to keep the socket alive by reusing it for another request.
    /// If no space is available, close the socket.
    ///
    /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
    /// is set, then we can only reuse the socket for HTTP Keep Alive if
    /// `reject_unauthorized` is set to `false`.
    ///
    /// Returns the pool entry, if the socket was kept.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn release_socket(
        &mut self,
        socket: HTTPSocket<SSL>,
        did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
        verification: PeerVerification,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<&ssl_config::SharedPtr>,
        tunnel: Option<Box<ProxyTunnel>>,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        unix_path: &[u8],
        pool: crate::PoolOptions,
    ) -> Option<&mut PooledSocket<SSL>> {
        // log("releaseSocket(0x{f})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

        debug_assert!(!socket.is_closed());
        debug_assert!(!socket.is_shutdown());
        debug_assert!(socket.is_established());
        let (transport, hostname, port) = if unix_path.is_empty() {
            (Transport::Tcp, hostname, port)
        } else {
            (Transport::Unix, unix_path, 0)
        };
        debug_assert!(!hostname.is_empty());
        debug_assert!(transport == Transport::Unix || port > 0);

        if hostname.len() <= MAX_KEEPALIVE_HOSTNAME
            && !(socket.is_closed() || socket.is_shutdown() || socket.get_error() != 0)
            && socket.is_established()
        {
            let id = self.shared.id;
            self.park_seq += 1;
            let had_tunnel = tunnel.is_some();
            let mut hostname_buf = [0u8; MAX_KEEPALIVE_HOSTNAME];
            hostname_buf[..hostname.len()].copy_from_slice(hostname);
            let pooled = PooledSocket {
                http_socket: socket,
                hostname_buf,
                hostname_len: hostname.len() as u8, // @truncate
                port,
                transport,
                park_seq: self.park_seq,
                did_have_handshaking_error_while_reject_unauthorized_is_false,
                verification,
                ssl_config_hash: ssl_config_hash(ssl_config.map(|c| &**c)),
                proxy_tunnel: tunnel,
                target_hostname: if (had_tunnel || transport == Transport::Unix)
                    && !target_hostname.is_empty()
                {
                    Box::<[u8]>::from(target_hostname)
                } else {
                    Box::default()
                },
                target_port,
                proxy_auth_hash,
                h2_session: None,
                pool_id: pool.id,
                idle_timeout_seconds: pool.idle_timeout_seconds,
            };
            let parked = match transport {
                Transport::Tcp => Self::park(self.pending_sockets.get_or_init(), id, pooled, pool),
                Transport::Unix => {
                    Self::park(self.pending_unix_sockets.get_or_init(), id, pooled, pool)
                }
            };
            if parked.is_some() {
                bun_core::scoped_log!(
                    HTTPContext,
                    "Keep-Alive release {}:{} tunnel={} target={}:{}",
                    bstr::BStr::new(hostname),
                    port,
                    had_tunnel,
                    bstr::BStr::new(target_hostname),
                    target_port,
                );
                return parked;
            }
        }
        bun_core::scoped_log!(HTTPContext, "close socket");
        Self::close_socket(socket);
        None
    }

    /// Park `pooled`, evicting the longest-idle entry when the pool is full.
    fn park<const N: usize>(
        pool: &mut HiveArray<PooledSocket<SSL>, N>,
        context: HttpContextId,
        pooled: PooledSocket<SSL>,
        options: crate::PoolOptions,
    ) -> Option<&mut PooledSocket<SSL>> {
        // Oldest parked socket, of `options.id` only when `same_session`.
        let oldest = |pool: &mut HiveArray<PooledSocket<SSL>, N>, same_session: bool| {
            let mut oldest: Option<(usize, u64)> = None;
            let mut count = 0usize;
            let mut iter = pool.used().iter_set();
            while let Some(idx) = iter.next()
                && let Some(parked) = pool.get_mut(idx)
            {
                if same_session && parked.pool_id != options.id {
                    continue;
                }
                count += 1;
                if oldest.is_none_or(|(_, park_seq)| parked.park_seq < park_seq) {
                    oldest = Some((idx, parked.park_seq));
                }
            }
            (oldest.map(|(idx, _)| idx), count)
        };
        if options.max_idle_sockets > 0 {
            if let (Some(evict), count) = oldest(pool, true)
                && count >= options.max_idle_sockets as usize
            {
                bun_core::scoped_log!(HTTPContext, "Keep-Alive context limit, evicting oldest");
                Self::close_socket(pool.get_mut(evict)?.http_socket);
                pool.remove(evict);
            }
        }
        if pool.used().find_first_unset().is_none() {
            let oldest = oldest(pool, false).0?;
            bun_core::scoped_log!(HTTPContext, "Keep-Alive pool full, evicting oldest");
            // The evicted connection is healthy: retire it with a FIN
            // (`close_socket`), not the RST `terminate_socket` sends.
            Self::close_socket(pool.get_mut(oldest)?.http_socket);
            pool.remove(oldest);
        }
        let socket = pooled.http_socket;
        let transport = pooled.transport;
        let index = pool.try_insert(pooled).ok()?;
        Self::set_socket_ext(
            socket,
            ActiveSocket::Pooled(PoolSlot {
                context,
                transport,
                index,
            }),
        );
        socket.flush();
        Self::arm_idle_timeout(socket, options.idle_timeout_seconds);
        pool.get_mut(index)
    }

    /// How long a parked socket may sit idle; 0 is the 5 minute default.
    fn arm_idle_timeout(socket: HTTPSocket<SSL>, idle_timeout_seconds: u32) {
        socket.set_timeout(match idle_timeout_seconds {
            0 => 5 * 60,
            seconds => seconds,
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn existing_socket(
        &mut self,
        required_for_socket: PeerVerification,
        required_for_target: PeerVerification,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<&SSLConfig>,
        want_tunnel: bool,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        want_h2: AlpnOffer,
        transport: Transport,
        pool_id: u64,
    ) -> Option<ExistingSocket<SSL>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }
        let key = PoolKey {
            required_for_socket,
            required_for_target,
            hostname,
            port,
            ssl_config_hash: ssl_config_hash(ssl_config),
            want_tunnel,
            target_hostname,
            target_port,
            proxy_auth_hash,
            want_h2,
            transport,
            pool_id,
        };
        match transport {
            Transport::Tcp => Self::find_in(self.pending_sockets.get_mut()?, &key),
            Transport::Unix => Self::find_in(self.pending_unix_sockets.get_mut()?, &key),
        }
    }

    fn find_in<const N: usize>(
        pool: &mut HiveArray<PooledSocket<SSL>, N>,
        key: &PoolKey<'_>,
    ) -> Option<ExistingSocket<SSL>> {
        let PoolKey {
            required_for_socket,
            required_for_target,
            hostname,
            port,
            ssl_config_hash,
            want_tunnel,
            target_hostname,
            target_port,
            proxy_auth_hash,
            want_h2,
            transport,
            pool_id,
        } = *key;
        let mut iter = pool.used().iter_set();

        while let Some(pending_socket_index) = iter.next() {
            let socket = pool.get_mut(pending_socket_index)?;
            debug_assert!(socket.transport == transport);
            if socket.port != port {
                continue;
            }

            if socket.pool_id != pool_id {
                continue;
            }

            if socket.ssl_config_hash != ssl_config_hash {
                continue;
            }

            if socket.did_have_handshaking_error_while_reject_unauthorized_is_false
                && required_for_target > PeerVerification::None
            {
                continue;
            }

            // ALPN on the pooled socket has already decided which protocol
            // it speaks; only match callers compatible with that choice.
            if socket.h2_session.is_some() {
                if want_h2 == AlpnOffer::H1 {
                    continue;
                }
            } else if want_h2 == AlpnOffer::H2Only {
                continue;
            }

            // Tunnel presence must match: a direct-connection socket cannot
            // serve a tunneled request and vice versa.
            if want_tunnel != socket.proxy_tunnel.is_some() {
                continue;
            }

            if socket.proxy_auth_hash != proxy_auth_hash {
                continue;
            }

            if want_tunnel {
                if socket.target_port != target_port {
                    continue;
                }
                if !strings::eql_long(&socket.target_hostname, target_hostname) {
                    continue;
                }
                // proxy_tunnel.is_some() guaranteed by want_tunnel match above.
                if !required_for_target.admits(socket.proxy_tunnel.as_ref().unwrap().verification) {
                    continue;
                }
            } else if transport == Transport::Unix
                && !strings::eql_long(&socket.target_hostname, target_hostname)
            {
                continue;
            }
            if SSL && !required_for_socket.admits(socket.verification) {
                continue;
            }

            if strings::eql_long(
                &socket.hostname_buf[..socket.hostname_len as usize],
                hostname,
            ) {
                let http_socket = socket.http_socket;
                let found = ExistingSocket {
                    socket: http_socket,
                    tunnel: socket.proxy_tunnel.take(),
                    h2_session: socket.h2_session.take(),
                    verification: socket.verification,
                };
                // Reused or closed below.
                pool.remove(pending_socket_index);

                if http_socket.is_closed() {
                    Self::mark_socket_as_dead(http_socket);
                    continue;
                }

                if http_socket.is_shutdown() || http_socket.get_error() != 0 {
                    Self::terminate_socket(http_socket);
                    continue;
                }

                // `HTTPThread::drain_events` hands a socket out before the loop
                // polls it, so input the origin already wrote is unread in the
                // kernel and invisible to the checks above; reuse answers this
                // request with it. Same verdicts the idle handlers reach after
                // a poll: `Handler::on_data` terminates, `Handler::on_end`
                // closes. HTTP/2 idle frames are healthy, so `on_idle_data`
                // keeps deciding for those.
                if found.h2_session.is_none() {
                    match http_socket.queued_input() {
                        uws::QueuedInput::None => {}
                        uws::QueuedInput::Eof => {
                            Self::close_socket(http_socket);
                            continue;
                        }
                        uws::QueuedInput::Data | uws::QueuedInput::Error => {
                            Self::terminate_socket(http_socket);
                            continue;
                        }
                    }
                }

                Self::mark_socket_as_dead(http_socket);
                bun_core::scoped_log!(
                    HTTPContext,
                    "+ Keep-Alive reuse {}:{}{}",
                    bstr::BStr::new(hostname),
                    port,
                    if found.tunnel.is_some() {
                        " (with tunnel)"
                    } else {
                        ""
                    }
                );
                return Some(found);
            }
        }

        None
    }

    pub(crate) fn connect_socket(thread: &mut HTTPThread, mut client: InFlightRequest) {
        let ctx = thread.context_of::<SSL>(&client);
        let socket_path = client.unix_socket_path;
        client.flags.reused_socket_verification = PeerVerification::None;
        if client.is_keep_alive_possible() {
            if let Some(found) = ctx.existing_socket(
                client.socket_verification(),
                client.target_verification(),
                socket_path,
                0,
                client.tls_props.as_deref(),
                false,
                client.unix_tls_hostname::<SSL>(),
                0,
                0,
                AlpnOffer::H1,
                Transport::Unix,
                client.pool.id,
            ) {
                let sock = found.socket;
                debug_assert!(found.tunnel.is_none());
                debug_assert!(found.h2_session.is_none());
                client.flags.reused_socket_verification = found.verification;
                client.allow_retry = true;
                let slot = Self::ext_slot(&sock).expect("connected");
                return Self::run_on_socket(thread, client, sock, slot, |c, thread| {
                    c.on_reuse::<SSL>(thread, sock)
                });
            }
        }

        bun_removable_features::call_removable!(HttpClient, Abort, need_socket_handlers);
        let connected = HTTPSocket::<SSL>::connect_unix_group(
            &ctx.shared.group,
            Self::KIND,
            if SSL {
                ctx.secure.as_ref().map(OwnedSslCtx::as_ptr)
            } else {
                None
            },
            socket_path,
            ActiveSocket::Dead.to_ext().to(),
            false, // dont allow half-open sockets
        );
        Self::on_connecting(thread, client, connected);
    }

    fn on_connecting(
        thread: &mut HTTPThread,
        mut client: InFlightRequest,
        connected: Result<HTTPSocket<SSL>, uws::ConnectError>,
    ) {
        let socket = match connected {
            Ok(socket) => socket,
            Err(err) => {
                client.record_socket_open_errno();
                return client.fail(thread, err.into());
            }
        };
        client.allow_retry = false;
        // An abort can come before `on_open`: test/js/bun/io/fetch/fetch-abort-slow-connect.test.ts
        client.register_abort_tracker::<SSL>(thread, socket, None);
        Self::put_request(Self::ext_slot(&socket).expect("connecting"), client);
    }

    /// Connects to `client.connected_url.hostname`.
    pub(crate) fn connect(thread: &mut HTTPThread, mut client: InFlightRequest, port: u16) {
        let ctx = thread.context_of::<SSL>(&client);
        let hostname = client.connected_url.hostname;

        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref());
                let reusable = ctx.active_h2_sessions.iter_mut().find(|(_, s)| {
                    s.has_headroom()
                        && s.matches(hostname, port, cfg, client.pool.id)
                        // Same guard as the pool path (`existing_socket`).
                        && client.socket_verification().admits(s.verification)
                });
                if let Some((index, _)) = reusable {
                    let context = ctx.shared.id;
                    let session = h2::SessionId { context, index };
                    return h2::ClientSession::adopt(thread, session, client);
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in &mut ctx.pending_h2_connects {
                    // Same guard as the active-session loop above, applied to
                    // an in-flight connect before its session exists.
                    if pc.matches(hostname, port, cfg_nn, client.pool.id)
                        && client.socket_verification().admits(pc.verification)
                    {
                        return pc.waiters.push(client);
                    }
                }
            }
        }

        client.flags.reused_socket_verification = PeerVerification::None;
        if client.is_keep_alive_possible() {
            let want_tunnel = client.http_proxy.is_some() && client.url.is_https();
            // CONNECT TCP target (writeProxyConnect line 346).
            let target_hostname: &[u8] = if want_tunnel {
                client.url.hostname
            } else {
                b""
            };
            let target_port: u16 = if want_tunnel {
                client.url.get_port_auto()
            } else {
                0
            };
            let proxy_auth_hash: u64 = if want_tunnel {
                client.proxy_auth_hash()
            } else {
                0
            };
            if let Some(found) = ctx.existing_socket(
                client.socket_verification(),
                client.target_verification(),
                hostname,
                port,
                client.tls_props.as_deref(),
                want_tunnel,
                target_hostname,
                target_port,
                proxy_auth_hash,
                if SSL {
                    client.alpn_offer()
                } else {
                    AlpnOffer::H1
                },
                Transport::Tcp,
                client.pool.id,
            ) {
                let sock = found.socket;
                client.flags.reused_socket_verification = found.verification;
                client.allow_retry = true;
                if let Some(mut session) = found.h2_session {
                    debug_assert!(SSL);
                    session.socket = sock.assume_ssl();
                    let session = ctx.register_h2(session);
                    return h2::ClientSession::adopt(thread, session, client);
                }
                let slot = Self::ext_slot(&sock).expect("connected");
                if let Some(tunnel) = found.tunnel {
                    // Reattach the pooled tunnel BEFORE onOpen so the
                    // request/response stage is already .proxy_headers.
                    // onOpen only promotes .pending -> .opened, and
                    // firstCall only acts on .opened/.pending, so both
                    // become no-ops for the CONNECT/handshake phases.
                    tunnel.adopt(&mut client);
                    return Self::run_on_socket(thread, client, sock, slot, |c, thread| {
                        c.on_open::<SSL>(thread, sock)?;
                        c.on_writable::<true, SSL>(thread, sock, None)
                    });
                }
                return Self::run_on_socket(thread, client, sock, slot, |c, thread| {
                    c.on_reuse::<SSL>(thread, sock)
                });
            }
        }

        bun_removable_features::call_removable!(HttpClient, Abort, need_socket_handlers);
        let connected = HTTPSocket::<SSL>::connect_group(
            &ctx.shared.group,
            Self::KIND,
            if SSL {
                ctx.secure.as_ref().map(OwnedSslCtx::as_ptr)
            } else {
                None
            },
            hostname,
            port as c_int,
            ActiveSocket::Dead.to_ext().to(),
            false,
        );
        if SSL {
            if connected.is_ok() && client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref())
                    .and_then(|p| NonNull::new(p.cast_mut()));
                let mut pc = h2::PendingConnect::new(h2::PendingConnect {
                    hostname: Box::<[u8]>::from(hostname),
                    port,
                    ssl_config: cfg,
                    verification: client.socket_verification(),
                    pool_id: client.pool.id,
                    ..Default::default()
                });
                client.pending_h2 = Some(NonNull::from(&mut *pc));
                ctx.pending_h2_connects.push(pc);
            }
        }
        Self::on_connecting(thread, client, connected);
    }
}

impl<const SSL: bool> HTTPContext<SSL> {
    /// Retire every idle socket that belongs to fetch session `pool_id`.
    pub(crate) fn close_idle_sockets(&mut self, pool_id: u64) {
        fn close_in<const SSL: bool, const N: usize>(
            pool: &mut HiveArray<PooledSocket<SSL>, N>,
            pool_id: u64,
        ) {
            let mut iter = pool.used().iter_set();
            while let Some(idx) = iter.next() {
                if let Some(pooled) = pool.get_mut(idx)
                    && pooled.pool_id == pool_id
                {
                    HTTPContext::<SSL>::close_socket(pooled.http_socket);
                    pool.remove(idx);
                }
            }
        }
        if let Some(pool) = self.pending_sockets.get_mut() {
            close_in(pool, pool_id);
        }
        if let Some(pool) = self.pending_unix_sockets.get_mut() {
            close_in(pool, pool_id);
        }
        // Collected first: `remove` cannot run under `iter_mut`.
        let idle: Vec<_> = self
            .active_h2_sessions
            .iter_mut()
            .filter(|(_, session)| session.is_idle_in_pool(pool_id))
            .map(|(index, session)| (index, session.socket))
            .collect();
        for (index, socket) in idle {
            HTTPContext::close_socket(socket);
            self.active_h2_sessions.remove(index);
        }
    }

    fn drain_pool<const N: usize>(pool: &mut HiveArray<PooledSocket<SSL>, N>) {
        let mut iter = pool.used().iter_set();
        while let Some(idx) = iter.next()
            && let Some(pooled) = pool.get_mut(idx)
        {
            Self::terminate_socket(pooled.http_socket);
            pool.remove(idx);
        }
    }
}

impl<const SSL: bool> Drop for HTTPContext<SSL> {
    fn drop(&mut self) {
        // Drain pooled keepalive sockets: drop what they own and force-close.
        // Must force-close (code != 0) because SSL clean shutdown (code=0) requires a
        // shutdown handshake with the peer, which won't complete during eviction.
        if let Some(pool) = self.pending_sockets.get_mut() {
            Self::drain_pool(pool);
        }
        if let Some(pool) = self.pending_unix_sockets.get_mut() {
            Self::drain_pool(pool);
        }
        // No request is left, so these only wait for the ACK of a liveness PING.
        for (_, session) in self.active_h2_sessions.iter_mut() {
            HTTPContext::terminate_socket(session.socket);
        }

        // `init_with_opts` can fail before `group.init()` runs (HTTPThread
        // cache-miss error path frees the half-init context); tolerate that
        // here by skipping group teardown when it was never linked into the
        // loop.
        if !self.shared.group.loop_.get().is_null() {
            // What is left is dead, and waits for the peer to end a graceful TLS close.
            self.shared.group.close_all();
        }
    }
}

/// Ext is a request or an `ActiveSocket`.
pub struct Handler<const SSL: bool>;

impl<const SSL: bool> Handler<SSL> {
    /// `us_dispatch_server_identity`: BoringSSL verifies only in the first handshake, when the socket has a request.
    pub fn server_identity(
        socket: HTTPSocket<SSL>,
        ssl: &bun_boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        if let Some(slot) = HTTPContext::<SSL>::ext_slot(&socket)
            && let Ok(client) = HTTPContext::<SSL>::take_request(slot)
        {
            let verdict = client.server_identity(ssl);
            HTTPContext::<SSL>::put_request(slot, client);
            return verdict;
        }
        bun_boringssl::ServerIdentity::Rejected
    }

    pub fn on_open(socket: HTTPSocket<SSL>) {
        let tagged = HTTPThread::enter(|thread| {
            HTTPContext::<SSL>::enter_client(thread, socket, |c, thread| {
                c.on_connect::<SSL>(thread, socket)
            })
        });
        if tagged.is_none() {
            return;
        }

        bun_core::scoped_log!(HTTPContext, "Unexpected open on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_handshake(
        socket: HTTPSocket<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        if !HTTPContext::<SSL>::is_dead(socket) {
            HTTPThread::enter(|thread| {
                Self::handle_handshake(thread, socket, success == 1, ssl_error)
            });
        } else if !socket.is_closed() {
            HTTPContext::<SSL>::terminate_socket(socket);
        }
    }

    fn handle_handshake(
        thread: &mut HTTPThread,
        socket: HTTPSocket<SSL>,
        handshake_success: bool,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_error = HTTPCertError::from_verify_error(ssl_error);

        let active = HTTPContext::<SSL>::enter_client(thread, socket, |client, thread| {
            // A reused connection is past its handshake: uSockets reports a fatal error on an
            // established session as a failed one, then closes the socket, and `on_close` resends.
            if !handshake_success && client.retries_on_close() {
                return Continue(());
            }
            // handshake completed but we may have ssl errors
            client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if handshake_success {
                // only reject the connection if reject_unauthorized == true
                if client.flags.reject_unauthorized && client.flags.did_have_handshaking_error {
                    return client.close_and_fail::<SSL>(
                        get_cert_error_from_no(handshake_error.error_no),
                        socket,
                    );
                }
                // A renegotiation that finished: the request is already on its way.
                use crate::internal_state::HTTPStage;
                if !matches!(
                    client.state.request_stage,
                    HTTPStage::Pending | HTTPStage::Opened
                ) {
                    return Continue(());
                }
                if client.wants_server_identity_check() {
                    // SAFETY: `socket` is live, and `check_server_identity` does not use `ssl` after it closes `socket`.
                    let ssl =
                        unsafe { socket.ssl() }.expect("TLS socket has an SSL after handshake");
                    client.check_server_identity::<SSL>(thread, socket, ssl, true)?;
                    if client.flags.reject_unauthorized {
                        // Peer chain + hostname verified: let the session sink
                        // flush its pending TLS 1.2 ticket (parked before this
                        // dispatch) and cache later TLS 1.3 tickets directly.
                        if let Some(raw) = socket.socket.get() {
                            // SAFETY: `raw` is this live socket, on the HTTP thread.
                            unsafe { crate::session_cache::arm(raw) };
                        }
                    }
                }

                return client.first_call::<SSL>(thread, socket);
            } else {
                // if we are here is because server rejected us, and the error_no is the cause of this
                // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                return client.close_and_fail::<SSL>(
                    crate::handshake_failure(handshake_error.error_no),
                    socket,
                );
            }
        });
        let Some(active) = active else { return };

        // uSockets reports a fatal alert on an established session as a failed handshake. A
        // success is a finished renegotiation, which RFC 9113 §9.2.1 makes a connection error.
        if let Some(session) = active.session() {
            HTTPContext::<SSL>::mark_socket_as_dead(socket);
            h2::ClientSession::on_close(
                thread,
                session,
                if handshake_success {
                    crate::Error::HTTP2ProtocolError
                } else {
                    crate::handshake_failure(handshake_error.error_no)
                },
            );
        }

        if socket.is_closed() {
            HTTPContext::<SSL>::mark_tagged_socket_as_dead(thread, socket, active);
            return;
        }

        if handshake_success {
            if let ActiveSocket::Pooled(slot) = active {
                let pooled = HTTPContext::<SSL>::pooled_mut(thread, slot);
                // Allow pooled sockets to be reused if the handshake was successful.
                HTTPContext::<SSL>::arm_idle_timeout(socket, pooled.idle_timeout_seconds);
                return;
            }
        }

        HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, active);
    }

    pub fn on_close(socket: HTTPSocket<SSL>, _: c_int, _: Option<*mut c_void>) {
        if HTTPContext::<SSL>::is_dead(socket) {
            return HTTPThread::try_enter(|thread| {
                thread.unregister_abort_tracker_for_socket(socket.socket);
            });
        }
        HTTPThread::enter(|thread| {
            let tagged = HTTPContext::<SSL>::enter_client(thread, socket, |c, thread| {
                c.on_close::<SSL>(thread, socket)
            });
            let Some(tagged) = tagged else { return };
            HTTPContext::<SSL>::mark_tagged_socket_as_dead(thread, socket, tagged);

            if let Some(session) = tagged.session() {
                h2::ClientSession::on_close(thread, session, crate::Error::ConnectionClosed);
                return;
            }
            thread.unregister_abort_tracker_for_socket(socket.socket);
        });
    }

    pub fn on_data(socket: HTTPSocket<SSL>, buf: &[u8]) {
        HTTPThread::enter(|thread| Self::handle_data(thread, socket, buf));
    }

    fn handle_data(thread: &mut HTTPThread, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = HTTPContext::<SSL>::enter_client(thread, socket, |client, thread| {
            client.on_data::<SSL>(thread, buf, socket)
        });
        let Some(tagged) = tagged else { return };
        if let Some(session) = tagged.session() {
            return h2::ClientSession::on_data(thread, session, buf);
        } else if let ActiveSocket::Pooled(slot) = tagged {
            let pooled = HTTPContext::<SSL>::pooled_mut(thread, slot);
            // If this pooled socket carries a CONNECT tunnel, any
            // idle data is inner-TLS traffic (close_notify, alert,
            // pipelined bytes) that we can't process without the
            // SSLWrapper. We'd hand back a tunnel whose inner state
            // diverged from ours. Evict it.
            if pooled.proxy_tunnel.is_some() {
                bun_core::scoped_log!(HTTPContext, "Data on idle pooled tunnel — evicting");
                HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);
                return;
            }

            if let Some(session) = &mut pooled.h2_session {
                session.on_idle_data(buf);
                if !session.can_pool() {
                    HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);
                }
                return;
            }

            // trailing zero is fine to ignore
            if buf == http::END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY {
                return;
            }

            bun_core::scoped_log!(HTTPContext, "Unexpected data on socket");
            HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);

            return;
        }
        bun_core::scoped_log!(HTTPContext, "Unexpected data on unknown socket");
        HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);
    }

    pub fn on_writable(socket: HTTPSocket<SSL>) {
        HTTPThread::enter(|thread| {
            let tagged = HTTPContext::<SSL>::enter_client(thread, socket, |client, thread| {
                client.on_writable::<false, SSL>(thread, socket, None)
            });
            match tagged {
                Some(ActiveSocket::Session(session)) => {
                    h2::ClientSession::on_writable(thread, session);
                }
                // it's a keep-alive socket
                None | Some(ActiveSocket::Pooled(_)) => {}
                Some(tagged @ ActiveSocket::Dead) => {
                    // don't know what this is, let's close it
                    bun_core::scoped_log!(HTTPContext, "Unexpected writable on socket");
                    HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);
                }
            }
        });
    }

    pub fn on_long_timeout(socket: HTTPSocket<SSL>) {
        HTTPThread::enter(|thread| {
            let tagged = HTTPContext::<SSL>::enter_client(thread, socket, |c, _| {
                c.on_timeout::<SSL>(socket)
            });
            let Some(tagged) = tagged else { return };
            if let Some(session) = tagged.session() {
                HTTPContext::<SSL>::mark_socket_as_dead(socket);
                h2::ClientSession::on_timeout(thread, session);
            }

            HTTPContext::<SSL>::terminate_tagged_socket(thread, socket, tagged);
        });
    }

    /// Short-tick (seconds-granularity) idle timer. Same handling as
    /// [`on_long_timeout`]; `HTTPClient::set_timeout` routes to whichever
    /// timer suits the configured duration, so both must dispatch.
    pub fn on_timeout(socket: HTTPSocket<SSL>) {
        Self::on_long_timeout(socket);
    }

    pub fn on_connect_error(socket: HTTPSocket<SSL>, errno: c_int) {
        if HTTPContext::<SSL>::is_dead(socket) {
            // A connecting socket whose ext is no longer a client never dispatches `on_close`.
            return HTTPThread::try_enter(|thread| {
                thread.unregister_abort_tracker_for_socket(socket.socket);
            });
        }
        // uSockets keeps the connecting socket alive for the whole dispatch.
        let dns_error = socket.dns_error();
        HTTPThread::enter(|thread| {
            if let Some(tagged) = HTTPContext::<SSL>::enter_client(thread, socket, |c, _| {
                c.on_connect_error(dns_error, errno)
            }) {
                HTTPContext::<SSL>::mark_tagged_socket_as_dead(thread, socket, tagged);
                thread.unregister_abort_tracker_for_socket(socket.socket);
            }
        });
        // us_connecting_socket_close is always called internally by uSockets
    }

    pub fn on_end(socket: HTTPSocket<SSL>) {
        HTTPThread::enter(|thread| Self::handle_end(thread, socket));
    }

    fn handle_end(thread: &mut HTTPThread, socket: HTTPSocket<SSL>) {
        // Four possible states:
        // 1. HTTP Keep-Alive socket: it must be removed from the pool
        // 2. HTTP Client socket: it might need to be retried
        // 3. HTTP/2 session: fail every stream on it
        // 4. Dead socket: it is already marked as dead
        //
        // An idle (pooled keep-alive) socket's FIN is answered with a graceful
        // close so well-behaved servers don't observe ECONNRESET for
        // connections we were simply done with, and so is a FIN that
        // terminates an EOF-delimited response (the request was fully sent;
        // this FIN *is* the end of the response). A FIN that cuts the request
        // short while its body is still being sent is answered with a reset
        // instead: a graceful close would queue our FIN behind the
        // not-yet-delivered body bytes (a server that rejects an upload early
        // stops reading them), so the peer would never observe the connection
        // closing and it would leak.
        let tagged = HTTPContext::<SSL>::enter_client(thread, socket, |client, thread| {
            if client.has_unsent_request_body() {
                socket.close(uws::CloseKind::Failure);
            } else {
                socket.close(uws::CloseKind::Normal);
            }
            client.on_close::<SSL>(thread, socket)
        });
        let Some(tagged) = tagged else { return };
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(thread, socket, tagged);
        if let Some(session) = tagged.session() {
            // An HTTP/2 session's streams may still be uploading; the same
            // undeliverable-bytes reasoning applies, and this matches the
            // pre-existing behaviour for this branch.
            socket.close(uws::CloseKind::Failure);
            h2::ClientSession::on_close(thread, session, crate::Error::ConnectionClosed);
            return;
        }
        thread.unregister_abort_tracker_for_socket(socket.socket);
        socket.close(uws::CloseKind::Normal);
    }
}
