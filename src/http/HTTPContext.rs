use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;

use bun_boringssl_sys::SSL_CTX;
use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::{self, Error, FeatureFlags};
use crate::{self as http, h2, AlpnOffer, HTTPCertError, HTTPClient, InitError, ProxyTunnel};
use crate::http_thread::InitOpts as HTTPThreadInitOpts;
// TODO(b0): SSLConfig arrives from move-in
// (MOVE_DOWN bun_runtime::api::server::server_config::SSLConfig → bun_http)
use crate::ssl_config::{self, SSLConfig};
use bun_string::strings;
use bun_uws as uws;

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const MAX_KEEPALIVE_HOSTNAME: usize = 128;

/// Zig: `fn NewHTTPContext(comptime ssl: bool) type { return struct { ... } }`
/// The const-generic `SSL` is load-bearing for monomorphization (gates hot
/// inner-loop branches); do not demote to a runtime bool.
// PORT NOTE: renamed NewHTTPContext→HTTPContext — `New` is a Zig type-factory
// naming convention, not part of the type's identity; LIFETIMES.tsv already
// aliases `*NewHTTPContext(true)` as `HttpsContext`.
#[derive(bun_ptr::CellRefCounted)]
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
    // `.ref()`/`.deref()`. Kept as raw pointers; ref/deref is intrusive.
    pub active_h2_sessions: Vec<*mut h2::ClientSession>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket.
    // TODO(port): lifetime — owned Box<PendingConnect>; `pc.deinit()` in Drop.
    pub pending_h2_connects: Vec<Box<h2::PendingConnect>>,
}

// Intrusive refcount: Zig `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
// `*T` crosses FFI (group.ext) and is recovered from socket ext, so per
// PORTING.md this stays intrusive rather than `Rc<T>`. Derived via
// `#[derive(CellRefCounted)]` above; default `destroy` (`heap::take`) applies
// (this struct is Box-allocated for custom-SSL entries; statics never hit 0).
pub type HTTPContextRc<const SSL: bool> = bun_ptr::IntrusiveRc<HTTPContext<SSL>>;

pub type PooledSocketHiveAllocator<const SSL: bool> = HiveArray<PooledSocket<SSL>, POOL_SIZE>;

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

pub type ActiveSocket<const SSL: bool> = TaggedPtrUnion<ActiveSocketTypes<SSL>>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules (the `bun_ptr::impl_tagged_ptr_union!` macro impls on a tuple, which
/// is foreign even when every element is local).
pub struct ActiveSocketTypes<const SSL: bool>;

// PORT NOTE: tags assigned 1024 - i to match Zig's `TagTypeEnumWithTypeMap`
// (`@typeName(Types[0])` → 1024, descending).
impl<const SSL: bool> bun_ptr::tagged_pointer::TypeList for ActiveSocketTypes<SSL> {
    const LEN: usize = 4;
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 3;
    fn type_name_from_tag(tag: bun_ptr::tagged_pointer::TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("DeadSocket"),
            1023 => Some("HTTPClient"),
            1022 => Some("PooledSocket"),
            1021 => Some("H2.ClientSession"),
            _ => None,
        }
    }
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>> for DeadSocket {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
    const NAME: &'static str = "DeadSocket";
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>> for HTTPClient<'static> {
    const TAG: bun_ptr::tagged_pointer::TagType = 1023;
    const NAME: &'static str = "HTTPClient";
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for PooledSocket<SSL>
{
    const TAG: bun_ptr::tagged_pointer::TagType = 1022;
    const NAME: &'static str = "PooledSocket";
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for h2::ClientSession
{
    const TAG: bun_ptr::tagged_pointer::TagType = 1021;
    const NAME: &'static str = "H2.ClientSession";
}

/// Typed accessors for the `ActiveSocket` tagged-pointer recovered from a
/// socket's ext slot. Centralises the `unsafe { &mut *ptr }` upgrade that the
/// socket-event dispatch handlers (and HTTPThread queue drains) repeat at
/// every site.
///
/// INVARIANT (single point of unsafe): a tagged pointer stored in a live
/// socket's ext slot identifies an object that is alive for the duration of
/// the dispatched callback — `HTTPClient` until its terminal result callback,
/// `h2::ClientSession` while it holds a registry strong ref, `PooledSocket`
/// while its HiveArray bit is set. All accesses are HTTP-thread-only, so no
/// concurrent `&mut` exists. Callers obtain the tagged value via
/// [`HTTPContext::get_tagged`] / [`HTTPContext::get_tagged_from_socket`] and
/// must not retain the returned reference past the callback.
pub trait ActiveSocketExt<const SSL: bool>: Copy {
    fn client_mut<'a>(self) -> Option<&'a mut HTTPClient<'static>>;
    fn session_mut<'a>(self) -> Option<&'a mut h2::ClientSession>;
    fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>>;
}

impl<const SSL: bool> ActiveSocketExt<SSL> for ActiveSocket<SSL> {
    #[inline]
    fn client_mut<'a>(self) -> Option<&'a mut HTTPClient<'static>> {
        // SAFETY: see trait-level INVARIANT.
        self.get::<HTTPClient>().map(|p| unsafe { &mut *p })
    }
    #[inline]
    fn session_mut<'a>(self) -> Option<&'a mut h2::ClientSession> {
        // SAFETY: see trait-level INVARIANT.
        self.get::<h2::ClientSession>().map(|p| unsafe { &mut *p })
    }
    #[inline]
    fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>> {
        // SAFETY: see trait-level INVARIANT.
        self.get::<PooledSocket<SSL>>().map(|p| unsafe { &mut *p })
    }
}

pub struct PooledSocket<const SSL: bool> {
    pub http_socket: HTTPSocket<SSL>,
    pub hostname_buf: [u8; MAX_KEEPALIVE_HOSTNAME],
    pub hostname_len: u8,
    pub port: u16,
    /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
    pub did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
    /// The interned SSLConfig this socket was created with (None = default context).
    /// Owns a strong ref while the socket is in the keepalive pool.
    pub ssl_config: Option<ssl_config::SharedPtr>,
    /// The context that owns this pooled socket's memory (for returning to correct pool).
    pub owner: *mut HTTPContext<SSL>,
    /// If this socket carries an established CONNECT tunnel (HTTPS through
    /// an HTTP proxy), the tunnel is preserved here. The pool owns one
    /// strong ref while the socket is parked (the `RefPtr` *is* that ref).
    /// None for direct connections.
    pub proxy_tunnel: Option<crate::proxy_tunnel::RefPtr>,
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
    pub h2_session: Option<NonNull<h2::ClientSession>>,
}

impl<const SSL: bool> PooledSocket<SSL> {
    /// Mutable access to the parked HTTP/2 session.
    ///
    /// INVARIANT: the pool owns one strong ref on the session while parked
    /// (taken in `release_socket`, released in `add_memory_back_to_pool` /
    /// `existing_socket`); the pointee outlives `self`.
    #[inline]
    pub fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
        // SAFETY: see INVARIANT above. HTTP-thread-only; no concurrent &mut.
        self.h2_session.map(|mut s| unsafe { s.as_mut() })
    }

    /// Drop the strong refs the pool holds while a socket is parked
    /// (proxy_tunnel / h2_session / ssl_config) and clear the heap-owned
    /// `target_hostname`. Called from `Drop` and `add_memory_back_to_pool`
    /// before the slot is recycled or its socket force-closed.
    ///
    /// Centralises the intrusive-rc `deref` so each caller doesn't repeat the
    /// pair of `unsafe { …::deref(nn.as_ptr()) }`.
    fn release_parked_refs(&mut self) {
        // Not gated on `comptime ssl` — an HTTP-proxy-to-HTTPS tunnel pools in
        // the non-SSL context but still stores the inner-TLS tls_props here for
        // pool-key matching.
        self.ssl_config = None;
        self.target_hostname = Box::default();
        if let Some(rp) = self.proxy_tunnel.take() {
            // The pool's strong ref *is* this `RefPtr`; release it.
            rp.deref();
        }
        if let Some(s) = self.h2_session.take() {
            // SAFETY: pool owns one strong ref while parked.
            unsafe { h2::ClientSession::deref(s.as_ptr()) };
        }
    }
}

struct ExistingSocket<const SSL: bool> {
    socket: HTTPSocket<SSL>,
    /// Present if the socket carries an established CONNECT tunnel.
    /// Ownership (one strong ref) is transferred to the caller.
    tunnel: Option<crate::proxy_tunnel::RefPtr>,
    /// Non-null if the socket negotiated "h2"; ownership transferred.
    h2_session: Option<NonNull<h2::ClientSession>>,
}

/// `dispatch.zig` reaches `Handler` via this name. The ext stores
/// `*anyopaque` (the `ActiveSocket` tagged pointer), so dispatch reads
/// it as `**anyopaque` and `Handler` decodes the tag.
// PORT NOTE: was `pub type ActiveSocketHandler = Handler<SSL>;` (inherent
// associated type — unstable). Hoisted to a free alias.
pub type ActiveSocketHandler<const SSL: bool> = Handler<SSL>;

impl<const SSL: bool> HTTPContext<SSL> {
    pub const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    pub fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if tagged.is::<PooledSocket<SSL>>() {
            // SAFETY: tag check above guarantees the pointer is a PooledSocket<SSL>.
            unsafe {
                Handler::<SSL>::add_memory_back_to_pool(
                    tagged.as_unchecked::<PooledSocket<SSL>>(),
                );
            }
        }

        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(dead_socket()));
    }

    pub fn mark_socket_as_dead(socket: HTTPSocket<SSL>) {
        Self::mark_tagged_socket_as_dead(socket, Self::get_tagged_from_socket(socket));
    }

    pub fn terminate_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Failure);
    }

    pub fn close_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Normal);
    }

    /// `ptr` is the *value* stored in the socket ext (the packed
    /// `ActiveSocket` tagged pointer), already dereferenced by
    /// `NsHandler` before reaching `Handler.on*`. No second deref.
    fn get_tagged(ptr: *mut c_void) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::from(Some(ptr))
    }

    pub fn get_tagged_from_socket(socket: HTTPSocket<SSL>) -> ActiveSocket<SSL> {
        if let Some(slot) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot stores the ActiveSocket tagged-pointer word.
            return Self::get_tagged(unsafe { *slot });
        }
        ActiveSocket::<SSL>::init(dead_socket())
    }

    /// Write `tagged` into `socket`'s ext slot.
    ///
    /// INVARIANT (centralised here): the ext slot of every HTTP-thread socket
    /// holds exactly the `ActiveSocket` tagged-pointer word; uSockets allocates
    /// it as `size_of::<*mut c_void>()` and never reads/writes it itself, so
    /// the raw `*slot = …` write is the sole owner. `ext()` returns `None`
    /// only for closed sockets, in which case the write is a no-op.
    #[inline]
    pub fn set_socket_ext(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if let Some(slot) = socket.ext::<*mut c_void>() {
            // SAFETY: see INVARIANT above.
            unsafe { *slot = tagged.ptr() };
        }
    }

    pub fn context() -> *mut Self {
        // PORT NOTE: const-generic dispatch over two distinct fields — `HTTPContext<true>`
        // and `HTTPContext<SSL>` are the same type when `SSL` matches, just spelled
        // differently. A raw-pointer `.cast()` is the identity here.
        if SSL {
            (&raw mut http::http_thread().https_context).cast::<Self>()
        } else {
            (&raw mut http::http_thread().http_context).cast::<Self>()
        }
    }

    /// Shared-borrow a live `*const ClientSession` to read/set its
    /// `Cell<u32>` registry index. Module-private — callers guarantee the
    /// session is live (registry holds a strong ref while indexed).
    /// `registry_index`/`set_registry_index`/`ref_` only touch `Cell` fields,
    /// so a shared borrow is sound regardless of other raw aliases on this
    /// single thread.
    #[inline]
    fn h2_session_ref<'a>(session: *const h2::ClientSession) -> &'a h2::ClientSession {
        // SAFETY: see fn doc.
        unsafe { &*session }
    }

    /// Common tail of [`unregister_h2`]/[`unregister_h2_raw`]: swap-remove the
    /// entry at `idx` from `list`, fix up the swapped-in entry's index, and
    /// release the strong ref taken in [`register_h2`].
    fn h2_swap_remove_and_deref(
        list: &mut Vec<*mut h2::ClientSession>,
        idx: u32,
        session: *const h2::ClientSession,
    ) {
        debug_assert!(
            (idx as usize) < list.len()
                && core::ptr::eq(list[idx as usize].cast_const(), session)
        );
        let _ = list.swap_remove(idx as usize);
        if (idx as usize) < list.len() {
            // The swapped-in entry is a distinct allocation from `session`
            // (the entry at `idx` was just removed); `set_registry_index`
            // only touches a `Cell<u32>`.
            Self::h2_session_ref(list[idx as usize]).set_registry_index(idx);
        }
        // Releases the strong ref taken in register_h2.
        // SAFETY: `session` carries write provenance from the original Box.
        unsafe { h2::ClientSession::deref(session.cast_mut()) };
    }

    pub fn register_h2(&mut self, session: *mut h2::ClientSession) {
        if !SSL {
            return;
        }
        let s = Self::h2_session_ref(session);
        if s.registry_index() != u32::MAX {
            return;
        }
        // PORT NOTE: `session.ref()` — intrusive refcount bump.
        s.ref_();
        s.set_registry_index(u32::try_from(self.active_h2_sessions.len()).expect("int cast"));
        self.active_h2_sessions.push(session);
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
            // SAFETY: waiters hold borrowed HTTPClient pointers owned by their
            // AsyncHTTP; alive until completion callback.
            let pos = pc
                .waiters
                .iter()
                .position(|w| unsafe { w.as_ref() }.async_http_id == async_http_id);
            if let Some(i) = pos {
                let mut waiter = pc.waiters.swap_remove(i);
                // SAFETY: same as above.
                unsafe { waiter.as_mut() }.fail_from_h2(bun_core::err!("Aborted"));
                return true;
            }
        }
        false
    }

    pub fn unregister_h2(&mut self, session: *const h2::ClientSession) {
        if !SSL {
            return;
        }
        // `session` is the raw heap pointer (heap::alloc provenance) passed
        // through from the ClientSession `&mut self` callers; keeping it raw
        // lets `deref()` reclaim the Box without a `&T → *mut T` cast.
        let s = Self::h2_session_ref(session);
        let idx = s.registry_index();
        if idx == u32::MAX {
            return;
        }
        s.set_registry_index(u32::MAX);
        Self::h2_swap_remove_and_deref(&mut self.active_h2_sessions, idx, session);
    }

    /// Raw-pointer variant of [`Self::unregister_h2`] for re-entrant call
    /// paths (`connect` → `adopt` → `maybe_release` / `fail_all` → `on_close`)
    /// where an ancestor stack frame already holds `&mut HTTPContext<SSL>`.
    /// Upgrading the session's `ctx` backref to a second `&mut Self` there
    /// would alias; this entry point instead projects `active_h2_sessions`
    /// through a raw place expression so no intermediate `&mut Self` is
    /// formed.
    ///
    /// # Safety
    /// `ctx` must point to a live `HTTPContext<SSL>`; an ancestor frame may
    /// hold a `&mut` to it but must not be mid-iteration over
    /// `active_h2_sessions` (this swap_removes from that Vec). `session` must
    /// be live for the duration of the call and carry write provenance to its
    /// Box allocation (it is `deref()`ed on exit).
    pub unsafe fn unregister_h2_raw(ctx: *mut Self, session: *const h2::ClientSession) {
        if !SSL {
            return;
        }
        let s = Self::h2_session_ref(session);
        let idx = s.registry_index();
        if idx == u32::MAX {
            return;
        }
        s.set_registry_index(u32::MAX);
        // SAFETY: `ctx` is live per caller contract. Project the field via raw
        // place expression — no intermediate `&mut Self` is formed, so we do
        // not alias an ancestor frame's `&mut HTTPContext`.
        let list = unsafe { &mut (*ctx).active_h2_sessions };
        Self::h2_swap_remove_and_deref(list, idx, session);
    }

    pub fn tag_as_h2(socket: HTTPSocket<SSL>, session: *const h2::ClientSession) {
        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(session));
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
        self.init_with_opts(opts)
    }

    fn init_with_opts(
        &mut self,
        opts: uws::SocketContext::BunSocketContextOptions,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let mut err = uws::create_bun_socket_error_t::none;
        self.secure = match opts.create_ssl_context(&mut err) {
            Some(ctx) => Some(ctx),
            None => {
                return Err(match err {
                    uws::create_bun_socket_error_t::load_ca_file => InitError::LoadCAFile,
                    uws::create_bun_socket_error_t::invalid_ca_file => InitError::InvalidCAFile,
                    uws::create_bun_socket_error_t::invalid_ca => InitError::InvalidCA,
                    _ => InitError::FailedToOpenSocket,
                });
            }
        };
        // SAFETY: secure was just set to Some.
        unsafe { ssl_ctx_setup(self.ssl_ctx()) };
        let owner_ptr = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        self.group
            .init(http::http_thread().uws_loop(), None, owner_ptr);
        Ok(())
    }

    pub fn init_with_thread_opts(
        &mut self,
        init_opts: &HTTPThreadInitOpts,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let opts = uws::SocketContext::BunSocketContextOptions {
            ca: if !init_opts.ca.is_empty() {
                init_opts.ca.as_ptr().cast()
            } else {
                core::ptr::null()
            },
            ca_count: u32::try_from(init_opts.ca.len()).expect("int cast"),
            ca_file_name: if !init_opts.abs_ca_file_name.is_empty() {
                init_opts.abs_ca_file_name.as_ptr().cast()
            } else {
                core::ptr::null()
            },
            request_cert: 1,
            ..Default::default()
        };
        self.init_with_opts(opts)
    }

    pub fn init(&mut self) {
        let owner_ptr = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        self.group
            .init(http::http_thread().uws_loop(), None, owner_ptr);
        if SSL {
            let mut err = uws::create_bun_socket_error_t::none;
            self.secure = Some(
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
            // SAFETY: secure was just set to Some.
            unsafe { ssl_ctx_setup(self.ssl_ctx()) };
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
        ssl_config: Option<&ssl_config::SharedPtr>,
        tunnel: Option<crate::proxy_tunnel::RefPtr>,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        h2_session: Option<NonNull<h2::ClientSession>>,
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
            && !(socket.is_closed() || socket.is_shutdown() || socket.get_error() != 0)
            && socket.is_established()
        {
            if let Some(pending_ptr) = self.pending_sockets.get() {
                Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(pending_ptr.cast_const()));
                socket.flush();
                socket.timeout(0);
                socket.set_timeout_minutes(5);

                let had_tunnel = tunnel.is_some();
                let mut hostname_buf = [0u8; MAX_KEEPALIVE_HOSTNAME];
                hostname_buf[..hostname.len()].copy_from_slice(hostname);

                // PORT NOTE: `HiveArray::get` returns an *uninitialized* slot
                // (`MaybeUninit<T>`). Zig wrote each field without running any
                // destructor on the previous value; doing field-by-field
                // assignment in Rust would `Drop` uninitialized garbage in
                // `ssl_config` (`Option<Arc<_>>`) and `target_hostname`
                // (`Box<[u8]>`). Use `ptr::write` to initialize the whole
                // struct in place. On reuse, callers (`existing_socket`,
                // `add_memory_back_to_pool`) reset those fields to None/empty
                // before `put()`, so nothing is leaked by skipping their drop
                // here.
                // SAFETY: pending_ptr is a fresh HiveArray slot reserved above;
                // valid for writes of `size_of::<PooledSocket<SSL>>()` bytes.
                unsafe {
                    core::ptr::write(
                        pending_ptr,
                        PooledSocket {
                            http_socket: socket,
                            hostname_buf,
                            hostname_len: hostname.len() as u8, // @truncate
                            port,
                            did_have_handshaking_error_while_reject_unauthorized_is_false,
                            // Clone a strong ref for the keepalive pool; the caller retains
                            // its own ref via HTTPClient.tls_props.
                            ssl_config: ssl_config.cloned(),
                            owner: std::ptr::from_mut(self),
                            // Pool owns the tunnel ref transferred by the caller.
                            proxy_tunnel: tunnel,
                            target_hostname: if had_tunnel && !target_hostname.is_empty() {
                                Box::<[u8]>::from(target_hostname)
                            } else {
                                Box::default()
                            },
                            target_port,
                            proxy_auth_hash,
                            h2_session,
                        },
                    );
                }

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
            // `detach_and_deref` consumes the strong ref the caller transferred;
            // `leak()` first so the `RefPtr`'s debug-tracking entry is retired
            // without a second decrement.
            let raw = t.leak();
            // SAFETY: `raw` is a live intrusive-refcounted ProxyTunnel; we hold
            // the strong ref `detach_and_deref` is about to release.
            unsafe {
                (*raw).shutdown();
                (*raw).detach_and_deref();
            }
        }
        if let Some(s) = h2_session {
            // SAFETY: live intrusive-refcounted ClientSession; deref releases
            // the strong ref the caller transferred.
            unsafe { h2::ClientSession::deref(s.as_ptr()) };
        }
        Self::close_socket(socket);
    }

    #[allow(clippy::too_many_arguments)]
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
        want_h2: AlpnOffer,
    ) -> Option<ExistingSocket<SSL>> {
        if hostname.len() > MAX_KEEPALIVE_HOSTNAME {
            return None;
        }

        let mut iter = self.pending_sockets.used.iterator::<true, true>();

        while let Some(pending_socket_index) = iter.next() {
            let socket_ptr = self
                .pending_sockets
                .at(u16::try_from(pending_socket_index).expect("int cast"));
            // SAFETY: HiveArray slot reserved (`used` bit set); contents are
            // initialized PooledSocket written by release_socket().
            let socket = unsafe { &mut *socket_ptr };
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
                    // proxy_tunnel.is_some() guaranteed by want_tunnel match above.
                    && !socket
                        .proxy_tunnel
                        .as_ref()
                        .unwrap()
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
                // Transfer tunnel ownership (the parked strong ref) to the caller.
                let tunnel: Option<crate::proxy_tunnel::RefPtr> = socket.proxy_tunnel.take();
                socket.target_hostname = Box::default();
                let h2_session = socket.h2_session.take();
                let ok = self.pending_sockets.put(socket_ptr);
                debug_assert!(ok);
                bun_core::scoped_log!(
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
            ActiveSocket::<SSL>::init(client.as_erased_ptr().as_ptr().cast::<HTTPClient<'static>>()).ptr(),
            false, // dont allow half-open sockets
        )?;
        client.allow_retry = false;
        Ok(Some(socket))
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
        // TODO(port): URL.hostname is a borrowed slice — assigning a local
        // overwrites lifetime. Preserved as-is via raw lifetime erasure matching
        // the Zig pointer assignment semantics.
        client.connected_url.hostname =
            // SAFETY: hostname borrows either a static literal or `client.url`/
            // `client.http_proxy` which outlive `connected_url` for the
            // duration of the connect attempt.
            unsafe { bun_ptr::detach_lifetime(hostname) };

        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref());
                for &session in &self.active_h2_sessions {
                    // SAFETY: active sessions are kept alive by registry refs;
                    // `&mut` is unique here (registry is iterated read-only and
                    // adopt() does not reenter the registry).
                    let s = unsafe { &mut *session };
                    if s.has_headroom() && s.matches(hostname, port, cfg) {
                        s.adopt(client);
                        return Ok(None);
                    }
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in &mut self.pending_h2_connects {
                    if pc.matches(hostname, port, cfg_nn) {
                        // client outlives the pending connect (resolved before
                        // its terminal callback fires).
                        pc.waiters.push(client.as_erased_ptr());
                        return Ok(None);
                    }
                }
            }
        }

        if client.is_keep_alive_possible() {
            let want_tunnel = client.http_proxy.is_some() && client.url.is_https();
            // CONNECT TCP target (writeProxyConnect line 346). The SNI
            // override (client.hostname) is hashed into proxyAuthHash.
            let target_hostname: &[u8] = if want_tunnel { client.url.hostname } else { b"" };
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
                if SSL { client.alpn_offer() } else { AlpnOffer::H1 },
            ) {
                let sock = found.socket;
                Self::set_socket_ext(
                    sock,
                    ActiveSocket::<SSL>::init(
                        client.as_erased_ptr().as_ptr().cast::<HTTPClient<'static>>(),
                    ),
                );
                client.allow_retry = true;
                if let Some(mut session) = found.h2_session {
                    if SSL {
                        // PORT NOTE: `session.socket = sock` — direct field
                        // write; ClientSession.socket is `HTTPSocket<true>`.
                        // SAFETY: session strong ref transferred from pool.
                        // Re-derive `&mut` from the raw pointer at each step
                        // rather than holding one `&mut` across `register_h2`
                        // — that fn forms a fresh `&*session`, which under
                        // Stacked Borrows would invalidate a spanning Unique.
                        unsafe { session.as_mut() }.socket = sock.assume_ssl();
                        Self::tag_as_h2(sock, session.as_ptr());
                        self.register_h2(session.as_ptr());
                        // SAFETY: session still live; fresh `&mut` after
                        // register_h2's shared borrow has ended.
                        unsafe { session.as_mut() }.adopt(client);
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
                    //
                    // `adopt` re-wraps the raw pointer into `client.proxy_tunnel`
                    // (a fresh `RefPtr::from_raw`, no bump), taking over the
                    // strong ref this `tunnel` holds — so `leak()` it first to
                    // surrender the claim without decrementing.
                    let raw = tunnel.leak();
                    // SAFETY: `raw` is a live ProxyTunnel; we hold the strong ref
                    // `adopt` is about to move into `client.proxy_tunnel`.
                    unsafe { (*raw).adopt::<SSL>(client, sock) };
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

        let socket = HTTPSocket::<SSL>::connect_group(
            &mut self.group,
            Self::KIND,
            if SSL { self.secure } else { None },
            hostname,
            port as c_int,
            ActiveSocket::<SSL>::init(client.as_erased_ptr().as_ptr().cast::<HTTPClient<'static>>()).ptr(),
            false,
        )?;
        client.allow_retry = false;
        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref())
                    .and_then(|p| NonNull::new(p.cast_mut()));
                let mut pc = h2::PendingConnect::new(h2::PendingConnect {
                    hostname: Box::<[u8]>::from(hostname),
                    port,
                    ssl_config: cfg,
                    ..Default::default()
                });
                // `client.pending_h2 = pc` stores a *borrowed* backref into the
                // Vec-owned allocation so `resolve_pending_h2` can dispatch
                // coalesced waiters once ALPN resolves. Ownership stays with
                // `pending_h2_connects`; the Box address is stable across the
                // Vec push.
                client.pending_h2 = Some(NonNull::from(&mut *pc));
                self.pending_h2_connects.push(pc);
            }
        }
        Ok(Some(socket))
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
            let mut iter = self.pending_sockets.used.iterator::<true, true>();
            while let Some(idx) = iter.next() {
                let pooled_ptr = self.pending_sockets.at(u16::try_from(idx).expect("int cast"));
                // SAFETY: `used` bit is set; slot is an initialized PooledSocket.
                let pooled = unsafe { &mut *pooled_ptr };
                // Do NOT call rp.data.shutdown() here — it drives
                // SSLWrapper.shutdown → triggerCloseCallback →
                // onClose(handlers.ctx), and handlers.ctx is the
                // stale HTTPClient pointer from detachOwner(). That
                // client is freed by now. http_socket.close(.failure)
                // below force-closes the TCP without triggering the
                // callback, same as addMemoryBackToPool().
                pooled.release_parked_refs();
                pooled.http_socket.close(uws::CloseKind::Failure);
            }
        }

        // PORT NOTE: Vec drop subsumes `active_h2_sessions.deinit()`.
        // PORT NOTE: Box<PendingConnect> Drop subsumes `pc.deinit()`; Vec drop
        // subsumes `pending_h2_connects.deinit()`.

        // `init_with_opts` can fail before `group.init()` runs (HTTPThread
        // cache-miss error path frees the half-init context). Spec
        // HTTPThread.zig:277 raw-frees without `deinit`; tolerate that here
        // by skipping group teardown when it was never linked into the loop.
        if !self.group.loop_.is_null() {
            // Force-close any remaining sockets before unlinking the group so
            // the loop never dereferences a freed `*Context` via `group->ext`.
            self.group.close_all();
            // PORT NOTE: SocketGroup deinit must run before the embedding struct
            // is freed (it unlinks from the loop's group list).
            // SAFETY: group was init()'d in `init`/`init_with_opts`; HTTP-thread-only.
            unsafe { uws::SocketGroup::destroy(&raw mut self.group) };
        }
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
        if let Some(client) = active.client_mut() {
            match client.on_open::<SSL>(socket) {
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
        if let Some(client) = active.client_mut() {
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
                    let ssl_ptr = socket
                        .get_native_handle()
                        .map(|h| h.cast::<bun_boringssl_sys::SSL>())
                        .unwrap_or(core::ptr::null_mut());
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
                        get_cert_error_from_no(handshake_error.error_no),
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

        if let Some(client) = tagged.client_mut() {
            return client.on_close::<SSL>(socket);
        }
        if let Some(session) = tagged.session_mut() {
            return session.on_close(bun_core::err!("ConnectionClosed"));
        }
    }

    unsafe fn add_memory_back_to_pool(pooled_ptr: *mut PooledSocket<SSL>) {
        // SAFETY: caller guarantees `pooled_ptr` points at a live HiveArray slot.
        // Hoist `owner` and clear the slot's owned resources first; the
        // `&mut HiveArray` receiver formed by `pending_sockets.put` (covering
        // this very slot) is created only after the `&mut PooledSocket` borrow
        // is dropped — avoids Stacked Borrows invalidation of the slot pointer.
        // SAFETY: see fn-level contract.
        let owner = unsafe {
            let slot = &mut *pooled_ptr;
            slot.release_parked_refs();
            slot.owner
        };
        // SAFETY: owner is the HiveArray backing this slot; address-stable
        // (static or Box-allocated) and outlives any pooled entry.
        let ok = unsafe { (*owner).pending_sockets.put(pooled_ptr) };
        debug_assert!(ok);
    }

    pub fn on_data(ptr: *mut c_void, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.client_mut() {
            return client.on_data::<SSL>(buf, client.get_ssl_ctx::<SSL>(), socket);
        } else if let Some(session) = tagged.session_mut() {
            return session.on_data(buf);
        } else if let Some(pooled) = tagged.pooled_mut() {
            // If this pooled socket carries a CONNECT tunnel, any
            // idle data is inner-TLS traffic (close_notify, alert,
            // pipelined bytes) that we can't process without the
            // SSLWrapper. We'd hand back a tunnel whose inner state
            // diverged from ours. Evict it.
            if pooled.proxy_tunnel.is_some() {
                bun_core::scoped_log!(HTTPContext, "Data on idle pooled tunnel — evicting");
                HTTPContext::<SSL>::terminate_socket(socket);
                return;
            }

            if let Some(session) = pooled.h2_session_mut() {
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

            return;
        }
        bun_core::scoped_log!(HTTPContext, "Unexpected data on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_writable(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.client_mut() {
            return client.on_writable::<false, SSL>(socket);
        } else if let Some(session) = tagged.session_mut() {
            return session.on_writable();
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
        if let Some(client) = tagged.client_mut() {
            return client.on_timeout::<SSL>(socket);
        }
        if let Some(session) = tagged.session_mut() {
            HTTPContext::<SSL>::mark_socket_as_dead(socket);
            session.on_close(bun_core::err!("Timeout"));
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub fn on_connect_error(ptr: *mut c_void, socket: HTTPSocket<SSL>, _: c_int) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
        if let Some(client) = tagged.client_mut() {
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
        socket.close(uws::CloseKind::Failure);

        if let Some(client) = tagged.client_mut() {
            client.on_close::<SSL>(socket);
            return;
        }
        if let Some(session) = tagged.session_mut() {
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
    &raw const DEAD_SOCKET
}

// ═══════════════════════════════════════════════════════════════════════════
// BoringSSL helpers ported from `boringssl.zig` (Zig wrappers, not C symbols).
// ═══════════════════════════════════════════════════════════════════════════

std::thread_local! {
    static AUTO_CRYPTO_BUFFER_POOL: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
}

unsafe extern "C" {
    fn CRYPTO_BUFFER_POOL_new() -> *mut c_void;
    fn SSL_CTX_set0_buffer_pool(ctx: *mut SSL_CTX, pool: *mut c_void);
    fn SSL_CTX_set_cipher_list(ctx: *mut SSL_CTX, str_: *const c_char) -> c_int;
}

// PORT NOTE: BoringSSL's `SSL_DEFAULT_CIPHER_LIST` macro — copied verbatim
// from `<openssl/ssl.h>` so we don't depend on a header-generated const.
const SSL_DEFAULT_CIPHER_LIST: &core::ffi::CStr = c"ALL:!aNULL:!eNULL:!SRP:!PSK:!CAMELLIA:!IDEA:!SEED";

/// Zig: `SSL_CTX.setup(ctx)`.
unsafe fn ssl_ctx_setup(ctx: *mut SSL_CTX) {
    // SAFETY: thread-local guarded by null check; CRYPTO_BUFFER_POOL_new is
    // safe to call on the HTTP thread.
    AUTO_CRYPTO_BUFFER_POOL.with(|pool| unsafe {
        if pool.get().is_null() {
            pool.set(CRYPTO_BUFFER_POOL_new());
        }
        SSL_CTX_set0_buffer_pool(ctx, pool.get());
        let _ = SSL_CTX_set_cipher_list(ctx, SSL_DEFAULT_CIPHER_LIST.as_ptr());
    });
}

/// Zig: `BoringSSL.getCertErrorFromNo(error_no)` — maps an X509 verify code
/// onto a `bun_core::Error` whose name is the upper-snake Zig error-set tag
/// (e.g. `CERT_HAS_EXPIRED`). JS-side `error.code` matches on this exact
/// string, so do NOT substitute `X509_verify_cert_error_string` output here.
// PORT NOTE: constants are the BoringSSL `X509_V_ERR_*` values from
// `<openssl/x509.h>` (see boringssl.zig:17302-17370). Inlined as literals so
// this file doesn't grow a dep on a header-generated const set.
fn get_cert_error_from_no(error_no: i32) -> Error {
    let name: &'static str = match error_no {
        0 => "OK", // X509_V_OK
        2 => "UNABLE_TO_GET_ISSUER_CERT",
        3 => "UNABLE_TO_GET_CRL",
        4 => "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
        5 => "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
        6 => "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
        7 => "CERT_SIGNATURE_FAILURE",
        8 => "CRL_SIGNATURE_FAILURE",
        9 => "CERT_NOT_YET_VALID",
        10 => "CERT_HAS_EXPIRED",
        11 => "CRL_NOT_YET_VALID",
        12 => "CRL_HAS_EXPIRED",
        13 => "ERROR_IN_CERT_NOT_BEFORE_FIELD",
        14 => "ERROR_IN_CERT_NOT_AFTER_FIELD",
        15 => "ERROR_IN_CRL_LAST_UPDATE_FIELD",
        16 => "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
        17 => "OUT_OF_MEM",
        18 => "DEPTH_ZERO_SELF_SIGNED_CERT",
        19 => "SELF_SIGNED_CERT_IN_CHAIN",
        20 => "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        21 => "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        22 => "CERT_CHAIN_TOO_LONG",
        23 => "CERT_REVOKED",
        24 => "INVALID_CA",
        25 => "PATH_LENGTH_EXCEEDED",
        26 => "INVALID_PURPOSE",
        27 => "CERT_UNTRUSTED",
        28 => "CERT_REJECTED",
        29 => "SUBJECT_ISSUER_MISMATCH",
        30 => "AKID_SKID_MISMATCH",
        31 => "AKID_ISSUER_SERIAL_MISMATCH",
        32 => "KEYUSAGE_NO_CERTSIGN",
        33 => "UNABLE_TO_GET_CRL_ISSUER",
        34 => "UNHANDLED_CRITICAL_EXTENSION",
        35 => "KEYUSAGE_NO_CRL_SIGN",
        36 => "UNHANDLED_CRITICAL_CRL_EXTENSION",
        37 => "INVALID_NON_CA",
        38 => "PROXY_PATH_LENGTH_EXCEEDED",
        39 => "KEYUSAGE_NO_DIGITAL_SIGNATURE",
        40 => "PROXY_CERTIFICATES_NOT_ALLOWED",
        41 => "INVALID_EXTENSION",
        42 => "INVALID_POLICY_EXTENSION",
        43 => "NO_EXPLICIT_POLICY",
        44 => "DIFFERENT_CRL_SCOPE",
        45 => "UNSUPPORTED_EXTENSION_FEATURE",
        46 => "UNNESTED_RESOURCE",
        47 => "PERMITTED_VIOLATION",
        48 => "EXCLUDED_VIOLATION",
        49 => "SUBTREE_MINMAX",
        50 => "APPLICATION_VERIFICATION",
        51 => "UNSUPPORTED_CONSTRAINT_TYPE",
        52 => "UNSUPPORTED_CONSTRAINT_SYNTAX",
        53 => "UNSUPPORTED_NAME_SYNTAX",
        54 => "CRL_PATH_VALIDATION_ERROR",
        56 => "SUITE_B_INVALID_VERSION",
        57 => "SUITE_B_INVALID_ALGORITHM",
        58 => "SUITE_B_INVALID_CURVE",
        59 => "SUITE_B_INVALID_SIGNATURE_ALGORITHM",
        60 => "SUITE_B_LOS_NOT_ALLOWED",
        61 => "SUITE_B_CANNOT_SIGN_P_384_WITH_P_256",
        62 => "HOSTNAME_MISMATCH",
        63 => "EMAIL_MISMATCH",
        64 => "IP_ADDRESS_MISMATCH",
        65 => "INVALID_CALL",
        66 => "STORE_LOOKUP",
        67 => "NAME_CONSTRAINTS_WITHOUT_SANS",
        _ => "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
    };
    Error::from_name(name)
}


// ported from: src/http/HTTPContext.zig
