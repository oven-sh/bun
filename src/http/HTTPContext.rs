use core::cell::{Cell, RefCell};
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::Error;
use crate::http_thread::{InitOpts as HTTPThreadInitOpts, ThreadState};
use crate::ssl_config::{self, SSLConfig};
use crate::{
    self as http, AlpnOffer, HTTPCertError, HTTPClient, InitError, RequestCell, RequestRef,
    get_cert_error_from_no, h2,
};
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::TaggedPtrUnion;
use bun_core::strings;
use bun_ptr::{BackRef, RefPtr};
use bun_uws as uws;

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
pub(crate) const MAX_KEEPALIVE_HOSTNAME: usize = 128;

/// The const-generic `SSL` is load-bearing for monomorphization (gates hot
/// inner-loop branches); do not demote to a runtime bool.
#[derive(bun_ptr::CellRefCounted)]
pub struct HTTPContext<const SSL: bool> {
    /// Heap-allocated custom-SSL contexts only. The cache entry in the thread's
    /// `custom_ssl_contexts` holds 1; each in-flight HTTPClient that set
    /// `client.custom_ssl_ctx = this` holds 1. Eviction drops the cache
    /// ref but the context survives until the last client releases it, so it
    /// is never dropped while a request is mid-flight. The thread's default
    /// http_context/https_context start at 1 and are never released.
    pub(crate) ref_count: Cell<u32>,
    thread: Cell<Option<&'static ThreadState>>,
    /// Embedded sweep/iteration list-head for every socket this context
    /// owns (active clients + pooled keepalive). Address-stable: this struct
    /// is either inside the thread's `ThreadState` or a heap allocation for
    /// custom-SSL entries. Declared (so dropped, closing its sockets) before
    /// the pool slots those sockets may be tagged with.
    pub(crate) group: uws::SocketGroupCell,
    pub(crate) pending_sockets: KeepAlivePool<SSL>,
    /// `SSL_CTX*` built from this context's SSLConfig (or the default
    /// `request_cert=1` opts). Only set when `SSL`.
    pub(crate) secure: RefCell<Option<OwnedSslCtx>>,
    /// HTTP/2 sessions with at least one active stream, available for
    /// concurrent attachment if `hasHeadroom()`. Each entry is one reference.
    pub(crate) active_h2_sessions: RefCell<Vec<RefPtr<h2::ClientSession>>>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket. Boxed: the leader's
    /// `client.pending_h2` points at the entry.
    #[expect(clippy::vec_box)]
    pub(crate) pending_h2_connects: RefCell<Vec<Box<h2::PendingConnect>>>,
    /// Client-side TLS session cache; populated only when `SSL`.
    pub(crate) session_cache: crate::session_cache::SessionCache,
}

pub(crate) type HTTPContextRc<const SSL: bool> = RefPtr<HTTPContext<SSL>>;

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

pub(crate) type ActiveSocket<const SSL: bool> = TaggedPtrUnion<ActiveSocketTypes<SSL>>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules (the `bun_ptr::impl_tagged_ptr_union!` macro impls on a tuple, which
/// is foreign even when every element is local).
pub(crate) struct ActiveSocketTypes<const SSL: bool>;

// Note: tags assigned 1024 - i, descending.
impl<const SSL: bool> bun_ptr::tagged_pointer::TypeList for ActiveSocketTypes<SSL> {
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 3;
}
/// A socket nobody owns any more: closed, or about to be. The pointer is the
/// thread's `ThreadState`.
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>> for ThreadState {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>> for RequestCell {
    const TAG: bun_ptr::tagged_pointer::TagType = 1023;
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for PooledSocket<SSL>
{
    const TAG: bun_ptr::tagged_pointer::TagType = 1022;
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for h2::ClientSession
{
    const TAG: bun_ptr::tagged_pointer::TagType = 1021;
}

/// Typed accessors for the `ActiveSocket` tagged pointer read out of a
/// socket's ext slot. Whoever tags a socket keeps the tagged object alive
/// until the socket is re-tagged (a request until it is retired, an h2
/// session while the slot holds its `socket_ref`, a pool slot while its
/// `used` bit is set, the thread state forever), which is the holder
/// obligation the returned [`BackRef`]s carry.
pub(crate) trait ActiveSocketExt<const SSL: bool>: Copy {
    fn request(self) -> Option<RequestRef>;
    fn session(self) -> Option<h2::SessionPtr>;
    fn pooled(self) -> Option<BackRef<PooledSocket<SSL>>>;
    /// The thread state (which every tag can reach), for as long as the
    /// returned handle is used within the current callback.
    fn thread(self) -> Option<BackRef<ThreadState>>;
}

impl<const SSL: bool> ActiveSocketExt<SSL> for ActiveSocket<SSL> {
    #[inline]
    fn request(self) -> Option<RequestRef> {
        self.get::<RequestCell>()
            .and_then(NonNull::new)
            .map(BackRef::from)
    }
    #[inline]
    fn session(self) -> Option<h2::SessionPtr> {
        self.get::<h2::ClientSession>()
            .and_then(NonNull::new)
            .map(|p| BackRef::<h2::ClientSession>::from(p).this_ptr())
    }
    #[inline]
    fn pooled(self) -> Option<BackRef<PooledSocket<SSL>>> {
        self.get::<PooledSocket<SSL>>()
            .and_then(NonNull::new)
            .map(BackRef::from)
    }
    #[inline]
    fn thread(self) -> Option<BackRef<ThreadState>> {
        if let Some(req) = self.request() {
            return Some(BackRef::new(req.thread()));
        }
        if let Some(pooled) = self.pooled() {
            return Some(BackRef::new(pooled.owner().thread()));
        }
        if let Some(session) = self.session() {
            return Some(BackRef::new(session.ctx.thread()));
        }
        self.get::<ThreadState>()
            .and_then(NonNull::new)
            .map(BackRef::from)
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

/// One idle keep-alive connection. Lives in a [`KeepAlivePool`] slot; the
/// socket's ext is tagged with the slot's address while it is parked.
pub struct PooledSocket<const SSL: bool> {
    pub(crate) http_socket: Cell<HTTPSocket<SSL>>,
    hostname_buf: RefCell<[u8; MAX_KEEPALIVE_HOSTNAME]>,
    hostname_len: Cell<u8>,
    pub(crate) port: Cell<u16>,
    /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
    pub(crate) did_have_handshaking_error_while_reject_unauthorized_is_false: Cell<bool>,
    /// A CA-valid but wrong-hostname cert leaves `did_have_handshaking_error`
    /// false, so this is what keeps a strict caller off a connection whose
    /// hostname was never checked natively.
    pub(crate) verification: Cell<PeerVerification>,
    /// The interned SSLConfig this socket was created with (None = default context).
    /// Owns a strong ref while the socket is in the keepalive pool.
    pub(crate) ssl_config: RefCell<Option<ssl_config::SharedPtr>>,
    /// The context whose pool this slot belongs to (set by
    /// [`HTTPContext::attach`]).
    owner: Cell<Option<BackRef<HTTPContext<SSL>>>>,
    index: u8,
    /// If this socket carries an established CONNECT tunnel (HTTPS through
    /// an HTTP proxy), the tunnel is preserved here. The pool owns one
    /// strong ref while the socket is parked (the `RefPtr` *is* that ref).
    /// None for direct connections.
    pub(crate) proxy_tunnel: RefCell<Option<crate::proxy_tunnel::RefPtr>>,
    /// Target (origin) hostname the tunnel connects to. `hostname_buf`
    /// above holds the PROXY hostname; this is the upstream we CONNECTed
    /// to. Heap-allocated only when proxy_tunnel is set; empty otherwise.
    pub(crate) target_hostname: RefCell<Box<[u8]>>,
    pub(crate) target_port: Cell<u16>,
    /// Hash of the effective Proxy-Authorization value so that tunnels
    /// established with different credentials are not cross-shared.
    /// 0 = no proxy auth.
    pub(crate) proxy_auth_hash: Cell<u64>,
    /// HTTP/2 connection state (HPACK tables, server SETTINGS) when
    /// this socket negotiated "h2". The pool's reference while parked.
    pub(crate) h2_session: RefCell<Option<RefPtr<h2::ClientSession>>>,
}

impl<const SSL: bool> PooledSocket<SSL> {
    fn new(index: u8) -> Self {
        Self {
            http_socket: Cell::new(HTTPSocket::<SSL>::detached()),
            hostname_buf: RefCell::new([0; MAX_KEEPALIVE_HOSTNAME]),
            hostname_len: Cell::new(0),
            port: Cell::new(0),
            did_have_handshaking_error_while_reject_unauthorized_is_false: Cell::new(false),
            verification: Cell::new(PeerVerification::None),
            ssl_config: RefCell::new(None),
            owner: Cell::new(None),
            index,
            proxy_tunnel: RefCell::new(None),
            target_hostname: RefCell::new(Box::default()),
            target_port: Cell::new(0),
            proxy_auth_hash: Cell::new(0),
            h2_session: RefCell::new(None),
        }
    }

    fn hostname_is(&self, hostname: &[u8]) -> bool {
        strings::eql_long(
            &self.hostname_buf.borrow()[..self.hostname_len.get() as usize],
            hostname,
            true,
        )
    }

    /// Drop the strong refs the pool holds while a socket is parked
    /// (proxy_tunnel / h2_session / ssl_config) and clear the heap-owned
    /// `target_hostname`. Called before the slot is recycled or its socket
    /// force-closed.
    fn release_parked_refs(&self) {
        // Cleared even for the non-SSL context — an HTTP-proxy-to-HTTPS tunnel pools in
        // the non-SSL context but still stores the inner-TLS tls_props here for
        // pool-key matching.
        *self.ssl_config.borrow_mut() = None;
        *self.target_hostname.borrow_mut() = Box::default();
        *self.proxy_tunnel.borrow_mut() = None;
        *self.h2_session.borrow_mut() = None;
    }

    fn owner(&self) -> BackRef<HTTPContext<SSL>> {
        self.owner.get().expect("pool slot used before attach")
    }

    /// Return this slot to its pool.
    fn release(&self) {
        self.release_parked_refs();
        self.owner().pending_sockets.free(self.index);
    }
}

/// Fixed-size set of [`PooledSocket`] slots with a `used` bitmap. Slots are
/// inline, so their addresses are stable for as long as the owning context is.
pub(crate) struct KeepAlivePool<const SSL: bool> {
    slots: Box<[PooledSocket<SSL>]>,
    used: Cell<u64>,
}

const _: () = assert!(POOL_SIZE <= 64);

impl<const SSL: bool> KeepAlivePool<SSL> {
    fn new() -> Self {
        Self {
            slots: (0..POOL_SIZE).map(|i| PooledSocket::new(i as u8)).collect(),
            used: Cell::new(0),
        }
    }

    fn claim(&self) -> Option<&PooledSocket<SSL>> {
        let used = self.used.get();
        let free = (!used).trailing_zeros() as usize;
        if free >= POOL_SIZE {
            return None;
        }
        self.used.set(used | (1u64 << free));
        Some(&self.slots[free])
    }

    fn free(&self, index: u8) {
        self.used.set(self.used.get() & !(1u64 << index));
    }

    /// The occupied slots, in index order. The bitmap is snapshotted, so
    /// freeing a slot mid-iteration is fine.
    fn iter_used(&self) -> impl Iterator<Item = &PooledSocket<SSL>> + '_ {
        let mut bits = self.used.get();
        core::iter::from_fn(move || {
            if bits == 0 {
                return None;
            }
            let i = bits.trailing_zeros() as usize;
            bits &= bits - 1;
            Some(&self.slots[i])
        })
    }
}

struct ExistingSocket<const SSL: bool> {
    socket: HTTPSocket<SSL>,
    /// Present if the socket carries an established CONNECT tunnel.
    /// Ownership (one strong ref) is transferred to the caller.
    tunnel: Option<crate::proxy_tunnel::RefPtr>,
    /// Present if the socket negotiated "h2"; ownership transferred.
    h2_session: Option<RefPtr<h2::ClientSession>>,
    verification: PeerVerification,
}

impl<const SSL: bool> HTTPContext<SSL> {
    const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    /// A context not yet attached to the thread (see [`attach`](Self::attach))
    /// or initialised (`init*`).
    pub(crate) fn new() -> Self {
        Self {
            ref_count: Cell::new(1),
            thread: Cell::new(None),
            pending_sockets: KeepAlivePool::new(),
            group: uws::SocketGroupCell::new(),
            secure: RefCell::new(None),
            active_h2_sessions: RefCell::new(Vec::new()),
            pending_h2_connects: RefCell::new(Vec::new()),
            session_cache: crate::session_cache::SessionCache::default(),
        }
    }

    /// A heap context for a custom TLS config, attached to `thread`; the
    /// returned reference is the caller's.
    pub(crate) fn create(thread: &'static ThreadState) -> RefPtr<Self> {
        let this = RefPtr::new(Self::new());
        this.attach(thread);
        this
    }

    /// Bind this (now address-stable) context to the thread and point its
    /// pool slots back at it.
    pub(crate) fn attach(&self, thread: &'static ThreadState) {
        self.thread.set(Some(thread));
        let this = BackRef::new(self);
        for slot in self.pending_sockets.slots.iter() {
            slot.owner.set(Some(this));
        }
    }

    pub(crate) fn thread(&self) -> &'static ThreadState {
        self.thread.get().expect("HTTPContext used before attach")
    }

    /// The thread's default context for this `SSL`.
    pub(crate) fn default_for(thread: &ThreadState) -> &HTTPContext<SSL> {
        // `HTTPContext<true>` and `HTTPContext<SSL>` are the same type when
        // `SSL`, just spelled differently; `cast_ssl` is that identity.
        if SSL {
            thread.https_context.cast_ssl::<SSL>()
        } else {
            thread.http_context.cast_ssl::<SSL>()
        }
    }

    /// Identity cast between two spellings of the same monomorphization.
    /// Panics if `TO != SSL`.
    pub(crate) fn cast_ssl<const TO: bool>(&self) -> &HTTPContext<TO> {
        assert!(TO == SSL);
        (self as &dyn core::any::Any)
            .downcast_ref::<HTTPContext<TO>>()
            .expect("same type")
    }

    /// The tag for a socket nobody owns: closed, or about to be.
    fn dead_tag(thread: &ThreadState) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::init::<ThreadState>(thread)
    }

    fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        let Some(thread) = tagged.thread() else {
            return;
        };
        if let Some(pooled) = tagged.pooled() {
            pooled.release();
        }
        Self::set_socket_ext(socket, Self::dead_tag(thread.get()));
    }

    pub(crate) fn mark_socket_as_dead(socket: HTTPSocket<SSL>) {
        Self::mark_tagged_socket_as_dead(socket, Self::get_tagged_from_socket(socket));
    }

    pub(crate) fn terminate_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
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

    /// `ptr` is the *value* stored in the socket ext (the packed
    /// `ActiveSocket` tagged pointer), already read out by the dispatcher
    /// before reaching `Handler.on*`.
    fn get_tagged(ptr: *mut c_void) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::from(Some(ptr))
    }

    pub(crate) fn get_tagged_from_socket(socket: HTTPSocket<SSL>) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::from(socket.ext_word())
    }

    /// Write `tagged` into `socket`'s ext slot (a no-op on a closed/detached
    /// socket).
    #[inline]
    fn set_socket_ext(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        socket.set_ext_word(tagged.ptr());
    }

    pub(crate) fn tag_as_request(socket: HTTPSocket<SSL>, req: &RequestCell) {
        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init::<RequestCell>(req));
    }

    pub(crate) fn tag_as_h2(socket: HTTPSocket<SSL>, session: &h2::ClientSession) {
        Self::set_socket_ext(
            socket,
            ActiveSocket::<SSL>::init::<h2::ClientSession>(session),
        );
    }

    pub(crate) fn register_h2(&self, session: &RefPtr<h2::ClientSession>) {
        if !SSL {
            return;
        }
        if session.registry_index() != u32::MAX {
            return;
        }
        let mut list = self.active_h2_sessions.borrow_mut();
        session.set_registry_index(u32::try_from(list.len()).expect("int cast"));
        list.push(session.clone());
    }

    /// Take `session` out of `active_h2_sessions`, releasing the registry's
    /// reference. That is never the last one: a listed session also has a
    /// socket-ext or pool holder.
    pub(crate) fn unregister_h2(&self, session: &h2::ClientSession) {
        if !SSL {
            return;
        }
        let idx = session.registry_index();
        if idx == u32::MAX {
            return;
        }
        session.set_registry_index(u32::MAX);
        let entry = {
            let mut list = self.active_h2_sessions.borrow_mut();
            debug_assert!(
                (idx as usize) < list.len()
                    && core::ptr::eq(&raw const *list[idx as usize], session)
            );
            let entry = list.swap_remove(idx as usize);
            if (idx as usize) < list.len() {
                list[idx as usize].set_registry_index(idx);
            }
            entry
        };
        drop(entry);
    }

    /// Called from drainQueuedShutdowns when the abort-tracker lookup
    /// misses: a request parked in `PendingConnect.waiters` (coalesced
    /// onto a leader's in-flight TLS connect) never registered a socket,
    /// so it can only be found by scanning here.
    pub(crate) fn abort_pending_h2_waiter(&self, async_http_id: u32) -> bool {
        if !SSL {
            return false;
        }
        let waiter = {
            let list = self.pending_h2_connects.borrow();
            let mut found = None;
            for pc in list.iter() {
                let mut waiters = pc.waiters.borrow_mut();
                if let Some(i) = waiters
                    .iter()
                    .position(|w| w.async_http_id() == async_http_id)
                {
                    found = Some(waiters.swap_remove(i));
                    break;
                }
            }
            found
        };
        match waiter {
            Some(waiter) => {
                waiter.client().fail_from_h2(crate::Error::Aborted);
                true
            }
            None => false,
        }
    }

    fn ssl_ctx_ptr(&self) -> Option<*mut bun_boringssl_sys::SSL_CTX> {
        self.secure.borrow().as_ref().map(OwnedSslCtx::as_ptr)
    }

    pub(crate) fn init_with_client_config(&self, client: &HTTPClient) -> Result<(), InitError> {
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
        &self,
        opts: &uws::SocketContext::BunSocketContextOptions,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let mut err = uws::create_bun_socket_error_t::none;
        let Some(ctx) = opts.create_ssl_context(&mut err) else {
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
        };
        bun_boringssl::ssl_ctx_setup_owned(&ctx);
        *self.secure.borrow_mut() = Some(ctx);
        self.init_group();
        Ok(())
    }

    fn init_group(&self) {
        let owner_ptr = core::ptr::from_ref::<Self>(self)
            .cast_mut()
            .cast::<c_void>();
        self.group
            .init(self.thread().waker.loop_ptr(), None, owner_ptr);
    }

    pub(crate) fn init_with_thread_opts(
        &self,
        init_opts: &HTTPThreadInitOpts,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let ca: Vec<*const core::ffi::c_char> = init_opts.ca.iter().map(|z| z.as_ptr()).collect();
        let opts = uws::SocketContext::BunSocketContextOptions {
            ca: if !ca.is_empty() {
                ca.as_ptr()
            } else {
                core::ptr::null()
            },
            ca_count: u32::try_from(ca.len()).expect("int cast"),
            ca_file_name: if !init_opts.abs_ca_file_name.is_empty() {
                init_opts.abs_ca_file_name.as_ptr().cast()
            } else {
                core::ptr::null()
            },
            request_cert: 1,
            ..Default::default()
        };
        self.init_with_opts(&opts)
    }

    pub(crate) fn init(&self) {
        self.init_group();
        if SSL {
            let mut err = uws::create_bun_socket_error_t::none;
            let ctx = uws::SocketContext::BunSocketContextOptions {
                // we request the cert so we load root certs and can verify it
                request_cert: 1,
                // we manually abort the connection if the hostname doesn't match
                reject_unauthorized: 0,
                ..Default::default()
            }
            .create_ssl_context(&mut err)
            .unwrap();
            bun_boringssl::ssl_ctx_setup_owned(&ctx);
            *self.secure.borrow_mut() = Some(ctx);
        }
    }

    /// Attempt to keep the socket alive by reusing it for another request.
    /// If no space is available, close the socket.
    ///
    /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
    /// is set, then we can only reuse the socket for HTTP Keep Alive if
    /// `reject_unauthorized` is set to `false`.
    ///
    /// If `tunnel` is `Some`, the socket carries an established CONNECT
    /// tunnel and the pool takes over that reference. If pooling fails (pool
    /// full, hostname too long, socket bad), it is released here.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn release_socket(
        &self,
        socket: HTTPSocket<SSL>,
        did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
        verification: PeerVerification,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<&ssl_config::SharedPtr>,
        tunnel: Option<crate::proxy_tunnel::RefPtr>,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        h2_session: Option<RefPtr<h2::ClientSession>>,
    ) {
        // log("releaseSocket(0x{f})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

        debug_assert!(!socket.is_closed());
        debug_assert!(!socket.is_shutdown());
        debug_assert!(socket.is_established());
        debug_assert!(!hostname.is_empty());
        debug_assert!(port > 0);

        if hostname.len() <= MAX_KEEPALIVE_HOSTNAME
            && !(socket.is_closed() || socket.is_shutdown() || socket.get_error() != 0)
            && socket.is_established()
        {
            if let Some(slot) = self.pending_sockets.claim() {
                Self::set_socket_ext(socket, ActiveSocket::<SSL>::init::<PooledSocket<SSL>>(slot));
                socket.flush();
                socket.timeout(0);
                socket.set_timeout_minutes(5);

                let had_tunnel = tunnel.is_some();
                slot.http_socket.set(socket);
                slot.hostname_buf.borrow_mut()[..hostname.len()].copy_from_slice(hostname);
                slot.hostname_len.set(hostname.len() as u8); // @truncate
                slot.port.set(port);
                slot.did_have_handshaking_error_while_reject_unauthorized_is_false
                    .set(did_have_handshaking_error_while_reject_unauthorized_is_false);
                slot.verification.set(verification);
                // Clone a strong ref for the keepalive pool; the caller retains
                // its own ref via HTTPClient.tls_props.
                *slot.ssl_config.borrow_mut() = ssl_config.cloned();
                // Pool owns the tunnel ref transferred by the caller.
                *slot.proxy_tunnel.borrow_mut() = tunnel;
                *slot.target_hostname.borrow_mut() = if had_tunnel && !target_hostname.is_empty() {
                    Box::<[u8]>::from(target_hostname)
                } else {
                    Box::default()
                };
                slot.target_port.set(target_port);
                slot.proxy_auth_hash.set(proxy_auth_hash);
                *slot.h2_session.borrow_mut() = h2_session;

                bun_core::scoped_log!(
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
        bun_core::scoped_log!(HTTPContext, "close socket");
        if let Some(t) = tunnel {
            crate::proxy_tunnel::ProxyTunnel::shutdown(&t);
            t.detach_socket();
        }
        drop(h2_session);
        Self::close_socket(socket);
    }

    #[allow(clippy::too_many_arguments)]
    fn existing_socket(
        &self,
        required_for_socket: PeerVerification,
        required_for_target: PeerVerification,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<*const SSLConfig>,
        want_tunnel: bool,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        want_h2: AlpnOffer,
    ) -> Option<ExistingSocket<SSL>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }

        for socket in self.pending_sockets.iter_used() {
            if socket.port.get() != port {
                continue;
            }

            // Match ssl_config by pointer equality (interned configs)
            if SSLConfig::raw_ptr(socket.ssl_config.borrow().as_ref()) != ssl_config {
                continue;
            }

            if socket
                .did_have_handshaking_error_while_reject_unauthorized_is_false
                .get()
                && required_for_target > PeerVerification::None
            {
                continue;
            }

            // ALPN on the pooled socket has already decided which protocol
            // it speaks; only match callers compatible with that choice.
            if socket.h2_session.borrow().is_some() {
                if want_h2 == AlpnOffer::H1 {
                    continue;
                }
            } else if want_h2 == AlpnOffer::H2Only {
                continue;
            }

            // Tunnel presence must match: a direct-connection socket cannot
            // serve a tunneled request and vice versa.
            if want_tunnel != socket.proxy_tunnel.borrow().is_some() {
                continue;
            }

            if socket.proxy_auth_hash.get() != proxy_auth_hash {
                continue;
            }

            if want_tunnel {
                if socket.target_port.get() != target_port {
                    continue;
                }
                if !strings::eql_long(&socket.target_hostname.borrow(), target_hostname, true) {
                    continue;
                }
                // proxy_tunnel.is_some() guaranteed by want_tunnel match above.
                if !required_for_target.admits(
                    socket
                        .proxy_tunnel
                        .borrow()
                        .as_ref()
                        .unwrap()
                        .verification
                        .get(),
                ) {
                    continue;
                }
            }
            if SSL && !required_for_socket.admits(socket.verification.get()) {
                continue;
            }

            if socket.hostname_is(hostname) {
                let http_socket = socket.http_socket.get();

                if http_socket.is_closed() {
                    Self::mark_socket_as_dead(http_socket);
                    continue;
                }

                if http_socket.is_shutdown() || http_socket.get_error() != 0 {
                    Self::terminate_socket(http_socket);
                    continue;
                }

                // Release the pool's strong ref (caller has its own via tls_props)
                *socket.ssl_config.borrow_mut() = None;
                // Transfer tunnel ownership (the parked strong ref) to the caller.
                let tunnel = socket.proxy_tunnel.borrow_mut().take();
                *socket.target_hostname.borrow_mut() = Box::default();
                let h2_session = socket.h2_session.borrow_mut().take();
                let verification = socket.verification.get();
                self.pending_sockets.free(socket.index);
                bun_core::scoped_log!(
                    HTTPContext,
                    "+ Keep-Alive reuse {}:{}{}",
                    bstr::BStr::new(hostname),
                    port,
                    if tunnel.is_some() {
                        " (with tunnel)"
                    } else {
                        ""
                    }
                );
                return Some(ExistingSocket {
                    socket: http_socket,
                    tunnel,
                    h2_session,
                    verification,
                });
            }
        }

        None
    }

    pub(crate) fn connect_socket(
        &self,
        client: &mut HTTPClient,
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        client.set_connected_to_target();
        let socket_path = client.unix_socket_path;
        let socket = HTTPSocket::<SSL>::connect_unix_group_tagged(
            &self.group,
            Self::KIND,
            if SSL { self.ssl_ctx_ptr() } else { None },
            socket_path.slice(),
            ActiveSocket::<SSL>::init::<RequestCell>(client.req().as_const_ptr()).ptr(),
            false, // dont allow half-open sockets
        )?;
        client.allow_retry = false;
        Ok(Some(socket))
    }

    pub(crate) fn connect(
        &self,
        client: &mut HTTPClient,
        hostname: &[u8],
        port: u16,
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        client.set_connected_to(hostname);

        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref());
                // The scan only reads; `adopt` runs after the registry borrow
                // is over because it may end by unregistering the session it
                // was given (swap-removing it from this Vec) and releasing it.
                let reusable = self
                    .active_h2_sessions
                    .borrow()
                    .iter()
                    .find(|s| {
                        s.has_headroom()
                            && s.matches(hostname, port, cfg)
                            // Same guard as the pool path (`existing_socket`).
                            && client.socket_verification().admits(s.verification)
                    })
                    .map(|s| s.this_ptr());
                if let Some(session) = reusable {
                    h2::ClientSession::adopt(session, client);
                    return Ok(None);
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in self.pending_h2_connects.borrow().iter() {
                    // Same guard as the active-session loop above, applied to
                    // an in-flight connect before its session exists.
                    if pc.matches(hostname, port, cfg_nn)
                        && client.socket_verification().admits(pc.verification)
                    {
                        // The request outlives the pending connect (resolved
                        // before its terminal callback fires).
                        pc.waiters.borrow_mut().push(client.req());
                        return Ok(None);
                    }
                }
            }
        }

        client.flags.reused_socket_verification = PeerVerification::None;
        if client.is_keep_alive_possible() {
            let want_tunnel = client.http_proxy.is_some() && client.url.is_https();
            // CONNECT TCP target (writeProxyConnect line 346).
            let target_hostname: &[u8] = if want_tunnel {
                client.url.hostname()
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
            if let Some(found) = self.existing_socket(
                client.socket_verification(),
                client.target_verification(),
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
                    AlpnOffer::H1
                },
            ) {
                let sock = found.socket;
                client.flags.reused_socket_verification = found.verification;
                Self::tag_as_request(sock, &client.req());
                client.allow_retry = true;
                if let Some(session) = found.h2_session {
                    if SSL {
                        // The pool's ref (carried by `found`) becomes the
                        // socket tag's; `adopt` may release it again if the
                        // session turns out to be unusable.
                        h2::ClientSession::resume_from_pool(
                            session,
                            sock.assume_ssl(),
                            self.cast_ssl::<true>(),
                            client,
                        );
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
                    // `adopt` moves the pool's strong ref into
                    // `client.proxy_tunnel`.
                    crate::proxy_tunnel::ProxyTunnel::adopt::<SSL>(tunnel, client, sock);
                    client.on_open::<SSL>(sock)?;
                    client.on_writable::<true, SSL>(sock);
                } else {
                    client.on_open::<SSL>(sock)?;
                    if SSL {
                        client.first_call::<SSL>(sock);
                    }
                }
                return Ok(Some(sock));
            }
        }

        let socket = HTTPSocket::<SSL>::connect_group_tagged(
            &self.group,
            Self::KIND,
            if SSL { self.ssl_ctx_ptr() } else { None },
            hostname,
            port as c_int,
            ActiveSocket::<SSL>::init::<RequestCell>(client.req().as_const_ptr()).ptr(),
            false,
        )?;
        client.allow_retry = false;
        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref())
                    .and_then(|p| NonNull::new(p.cast_mut()));
                let pc = Box::new(h2::PendingConnect {
                    hostname: Box::<[u8]>::from(hostname),
                    port,
                    ssl_config: cfg,
                    verification: client.socket_verification(),
                    waiters: RefCell::new(Vec::new()),
                });
                // `client.pending_h2` points into the Vec-owned Box so
                // `resolve_pending_h2` can dispatch coalesced waiters once
                // ALPN resolves; the Box address is stable across the push,
                // and the client unregisters it before finishing.
                client.pending_h2 = Some(BackRef::new(&*pc));
                self.pending_h2_connects.borrow_mut().push(pc);
            }
        }
        Ok(Some(socket))
    }

    /// Remove the pending connect at `pc` from `pending_h2_connects` and
    /// hand the owning box back.
    pub(crate) fn take_pending_h2(
        &self,
        pc: &h2::PendingConnect,
    ) -> Option<Box<h2::PendingConnect>> {
        let mut list = self.pending_h2_connects.borrow_mut();
        list.iter()
            .position(|p| core::ptr::eq(&raw const **p, pc))
            .map(|i| list.swap_remove(i))
    }
}

impl<const SSL: bool> Drop for HTTPContext<SSL> {
    fn drop(&mut self) {
        // Drain pooled keepalive sockets: deref their ssl_config and force-close.
        // Must force-close (code != 0) because SSL clean shutdown (code=0) requires a
        // shutdown handshake with the peer, which won't complete during eviction.
        // Without force-close, the socket stays linked and the context refcount never
        // reaches 0, leaking the SSL_CTX.
        if let Some(thread) = self.thread.get() {
            for pooled in self.pending_sockets.iter_used() {
                // Do NOT call rp.data.shutdown() here — it drives
                // SSLWrapper.shutdown → triggerCloseCallback → onClose on a
                // tunnel whose request is long gone. Re-tag as dead first so
                // the close callback does not come back to this pool while it
                // is being torn down; http_socket.close(.failure) force-closes
                // the TCP without triggering the tunnel callback.
                pooled.release_parked_refs();
                let socket = pooled.http_socket.get();
                Self::set_socket_ext(socket, Self::dead_tag(thread));
                socket.close(uws::CloseKind::Failure);
            }
        }
        // `group` closes any remaining sockets and unlinks itself on drop;
        // `secure` releases the SSL_CTX reference after that (field order).
    }
}

/// Socket event handlers for the fetch client's sockets. Ext is the
/// `ActiveSocket` tagged-pointer word.
pub struct Handler<const SSL: bool>;

/// Hands back the requests an event finished once its handler returns
/// (see `RequestCell::deliver`).
struct FlushCompletions(Option<BackRef<ThreadState>>);

impl Drop for FlushCompletions {
    #[inline]
    fn drop(&mut self) {
        if let Some(thread) = self.0 {
            thread.flush_completions();
        }
    }
}

impl<const SSL: bool> Handler<SSL> {
    pub fn on_open(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let active = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(active.thread());
        if let Some(req) = active.request() {
            match req.with_client(|c| c.on_connect::<SSL>(socket)) {
                Ok(_) => return,
                Err(_) => {
                    bun_core::scoped_log!(HTTPContext, "Unable to open socket");
                    HTTPContext::<SSL>::terminate_socket(socket);
                    return;
                }
            }
        }

        bun_core::scoped_log!(HTTPContext, "Unexpected open on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_handshake(
        ptr: *mut c_void,
        socket: HTTPSocket<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_success = success == 1;

        let handshake_error = HTTPCertError::from_verify_error(ssl_error);

        let active = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(active.thread());
        if let Some(req) = active.request() {
            let mut client = req.client();
            // handshake completed but we may have ssl errors
            client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
            if handshake_success {
                if client.flags.reject_unauthorized {
                    // only reject the connection if reject_unauthorized == true
                    if client.flags.did_have_handshaking_error {
                        client.close_and_fail::<SSL>(
                            get_cert_error_from_no(handshake_error.error_no),
                            socket,
                        );
                        return;
                    }

                    // if checkServerIdentity returns false, we dont call firstCall — the connection was rejected
                    let Some(ssl) = socket.ssl_mut() else {
                        client.close_and_fail::<SSL>(crate::Error::ConnectionRefused, socket);
                        return;
                    };
                    if !client.check_server_identity::<SSL>(socket, ssl, true) {
                        // checkServerIdentity already called closeAndFail() →
                        // fail(); the socket is terminated and the abort
                        // tracker unregistered there.
                        return;
                    }
                    // Peer chain + hostname verified: let the session sink
                    // flush its pending TLS 1.2 ticket (parked before this
                    // dispatch) and cache later TLS 1.3 tickets directly.
                    if let Some(sink) = &client.session_sink {
                        sink.arm();
                    }
                }

                return client.first_call::<SSL>(socket);
            } else {
                // if we are here is because server rejected us, and the error_no is the cause of this
                // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                if client.flags.did_have_handshaking_error {
                    client.close_and_fail::<SSL>(
                        get_cert_error_from_no(handshake_error.error_no),
                        socket,
                    );
                    return;
                }
                // if handshake_success it self is false, this means that the connection was rejected
                client.close_and_fail::<SSL>(crate::Error::ConnectionRefused, socket);
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
        let _flush = FlushCompletions(tagged.thread());
        HTTPContext::<SSL>::mark_socket_as_dead(socket);

        if let Some(req) = tagged.request() {
            return RequestCell::on_close::<SSL>(req, socket);
        }
        if let Some(session) = tagged.session() {
            return h2::ClientSession::on_close(session, crate::Error::ConnectionClosed);
        }
        // PooledSocket/DeadSocket: whoever retagged the ext should have
        // unregistered; sweep by pointer so a miss can't leave a stale
        // entry for `drain_queued_shutdowns` to chase after the socket is freed.
        if let Some(thread) = tagged.thread() {
            crate::unregister_abort_tracker_for_socket(&thread, socket.socket);
        }
    }

    pub fn on_data(ptr: *mut c_void, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(tagged.thread());
        if let Some(req) = tagged.request() {
            return RequestCell::on_data::<SSL>(req, buf, socket);
        } else if let Some(session) = tagged.session() {
            return h2::ClientSession::on_data(session, buf);
        } else if let Some(pooled) = tagged.pooled() {
            // If this pooled socket carries a CONNECT tunnel, any
            // idle data is inner-TLS traffic (close_notify, alert,
            // pipelined bytes) that we can't process without the
            // SSLWrapper. We'd hand back a tunnel whose inner state
            // diverged from ours. Evict it.
            if pooled.proxy_tunnel.borrow().is_some() {
                bun_core::scoped_log!(HTTPContext, "Data on idle pooled tunnel — evicting");
                HTTPContext::<SSL>::terminate_socket(socket);
                return;
            }

            let session = pooled.h2_session.borrow().as_ref().map(|s| s.this_ptr());
            if let Some(session) = session {
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

            bun_core::scoped_log!(HTTPContext, "Unexpected data on socket");
            HTTPContext::<SSL>::terminate_socket(socket);

            return;
        }
        bun_core::scoped_log!(HTTPContext, "Unexpected data on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_writable(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(tagged.thread());
        if let Some(req) = tagged.request() {
            return RequestCell::on_writable::<false, SSL>(req, socket);
        } else if let Some(session) = tagged.session() {
            return h2::ClientSession::on_writable(session);
        } else if tagged.is::<PooledSocket<SSL>>() {
            // it's a keep-alive socket
        } else {
            // don't know what this is, let's close it
            bun_core::scoped_log!(HTTPContext, "Unexpected writable on socket");
            HTTPContext::<SSL>::terminate_socket(socket);
        }
    }

    pub fn on_long_timeout(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(tagged.thread());
        if let Some(req) = tagged.request() {
            return req.with_client(|c| c.on_timeout::<SSL>(socket));
        }
        if let Some(session) = tagged.session() {
            HTTPContext::<SSL>::mark_socket_as_dead(socket);
            h2::ClientSession::on_close(session, crate::Error::Timeout);
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    /// Short-tick (seconds-granularity) idle timer. Same handling as
    /// [`on_long_timeout`]; `HTTPClient::set_timeout` routes to whichever
    /// timer suits the configured duration, so both must dispatch.
    pub fn on_timeout(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        Self::on_long_timeout(ptr, socket);
    }

    pub fn on_connect_error(ptr: *mut c_void, socket: HTTPSocket<SSL>, _: c_int) {
        // Read before the socket is marked dead: uSockets keeps the
        // connecting socket alive for the whole dispatch.
        let dns_error = socket.dns_error();
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        let _flush = FlushCompletions(tagged.thread());
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
        if let Some(req) = tagged.request() {
            req.with_client(|c| c.on_connect_error(dns_error));
        } else if let Some(thread) = tagged.thread() {
            // Same backstop as `on_close`: a SEMI_SOCKET/connecting socket
            // whose ext is no longer a client never dispatches `on_close`,
            // so sweep any leftover tracker entry here.
            crate::unregister_abort_tracker_for_socket(&thread, socket.socket);
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
        let _flush = FlushCompletions(tagged.thread());
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
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
        if let Some(req) = tagged.request() {
            if req.client().has_unsent_request_body() {
                socket.close(uws::CloseKind::Failure);
            } else {
                socket.close(uws::CloseKind::Normal);
            }
            RequestCell::on_close::<SSL>(req, socket);
            return;
        }
        if let Some(session) = tagged.session() {
            // An HTTP/2 session's streams may still be uploading; the same
            // undeliverable-bytes reasoning applies, and this matches the
            // pre-existing behaviour for this branch.
            socket.close(uws::CloseKind::Failure);
            h2::ClientSession::on_close(session, crate::Error::ConnectionClosed);
            return;
        }
        socket.close(uws::CloseKind::Normal);
    }
}
