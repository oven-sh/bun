use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::http_thread::InitOpts as HTTPThreadInitOpts;
use crate::{
    self as http, AlpnOffer, HTTPCertError, HTTPClient, InitError, ProxyTunnel,
    get_cert_error_from_no, h2,
};
use bun_boringssl::ssl_ctx_setup;
use bun_boringssl_sys::SSL_CTX;
use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::{self, Error, FeatureFlags};
// TODO(b0): SSLConfig arrives from move-in
// (MOVE_DOWN bun_runtime::api::server::server_config::SSLConfig → bun_http)
use crate::ssl_config::{self, SSLConfig};
use bun_core::strings;
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
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for HTTPClient<'static>
{
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

/// The single `&mut *p` upgrade for [`ActiveSocketExt`] — generic so
/// `client_mut`/`session_mut`/`pooled_mut` share one SAFETY argument instead of
/// three open-coded ones. INVARIANT: see [`ActiveSocketExt`] trait doc.
#[inline(always)]
fn active_socket_get_mut<'a, const SSL: bool, T>(tagged: ActiveSocket<SSL>) -> Option<&'a mut T>
where
    T: bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>,
{
    // SAFETY: see [`ActiveSocketExt`] trait-level INVARIANT — the tagged pointer
    // identifies an object live for the dispatched callback, HTTP-thread-only.
    tagged.get::<T>().map(|p| unsafe { &mut *p })
}

impl<const SSL: bool> ActiveSocketExt<SSL> for ActiveSocket<SSL> {
    #[inline]
    fn client_mut<'a>(self) -> Option<&'a mut HTTPClient<'static>> {
        active_socket_get_mut(self)
    }
    #[inline]
    fn session_mut<'a>(self) -> Option<&'a mut h2::ClientSession> {
        active_socket_get_mut(self)
    }
    #[inline]
    fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>> {
        active_socket_get_mut(self)
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

/// Upgrade an `Option<NonNull<h2::ClientSession>>` held by a pool / found-slot
/// / `active_h2_sessions` registry entry to `Option<&'a mut h2::ClientSession>`.
///
/// INVARIANT: while the holder stores `Some`, it owns one strong intrusive ref
/// on the session (taken in `release_socket` / `register_h2`, released in
/// `add_memory_back_to_pool` / `existing_socket` / `unregister_h2`); the
/// session is a distinct heap allocation that outlives the holder.
/// HTTP-thread-only, so no concurrent `&mut`. Centralises the SAFETY argument
/// shared by `PooledSocket::h2_session_mut`, `ExistingSocket::h2_session_mut`,
/// and the `active_h2_sessions` registry scan in `connect`.
#[inline]
fn h2_session_as_mut<'a>(
    s: Option<NonNull<h2::ClientSession>>,
) -> Option<&'a mut h2::ClientSession> {
    // SAFETY: see INVARIANT above.
    s.map(|mut s| unsafe { s.as_mut() })
}

/// Upgrade a `*mut PooledSocket<SSL>` returned by `HiveArray::at` to `&mut`.
///
/// INVARIANT: every caller obtains `p` from `pending_sockets.at(idx)` while
/// iterating `pending_sockets.used` (the slot's `used` bit is set), so the
/// slot is an initialised `PooledSocket` written by `release_socket`. The
/// HiveArray data array is disjoint from the `used` bitset the iterator
/// borrows, so the returned `&mut` does not alias it. HTTP-thread-only.
/// Centralises the raw `&mut *socket_ptr` upgrade repeated at each HiveArray
/// scan.
#[inline]
fn pooled_socket_mut<'a, const SSL: bool>(p: *mut PooledSocket<SSL>) -> &'a mut PooledSocket<SSL> {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *p }
}

impl<const SSL: bool> PooledSocket<SSL> {
    /// Mutable access to the parked HTTP/2 session.
    ///
    /// INVARIANT: the pool owns one strong ref on the session while parked
    /// (taken in `release_socket`, released in `add_memory_back_to_pool` /
    /// `existing_socket`); the pointee outlives `self`.
    #[inline]
    pub fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
        h2_session_as_mut(self.h2_session)
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

impl<const SSL: bool> ExistingSocket<SSL> {
    /// Mutable access to the transferred HTTP/2 session.
    ///
    /// INVARIANT: `h2_session` carries one strong ref moved out of the pool by
    /// `existing_socket`; the pointee is a distinct heap allocation that
    /// outlives `self`. HTTP-thread-only. Each call re-derives a fresh `&mut`
    /// from the raw `NonNull`, so callers may interleave calls with raw
    /// `as_ptr()` reads (e.g. `register_h2`) without a spanning Unique tag.
    #[inline]
    fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
        h2_session_as_mut(self.h2_session)
    }
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
                Handler::<SSL>::add_memory_back_to_pool(tagged.as_unchecked::<PooledSocket<SSL>>());
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
    ///
    /// Returns a [`bun_ptr::ParentRef`] (the registry's strong ref ⇒ the
    /// session outlives the handle) so the shared deref goes through the safe
    /// `Deref` impl instead of an open-coded raw-ptr reborrow.
    #[inline]
    fn h2_session_ref(session: *const h2::ClientSession) -> bun_ptr::ParentRef<h2::ClientSession> {
        bun_ptr::ParentRef::from(
            NonNull::new(session.cast_mut()).expect("h2 registry session is non-null"),
        )
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
            (idx as usize) < list.len() && core::ptr::eq(list[idx as usize].cast_const(), session)
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
            // `waiters` hold back-references to HTTPClients owned by their
            // AsyncHTTP (alive until completion callback). `BackRef::from`
            // encodes that invariant so reading the Copy `async_http_id`
            // field goes through the safe `Deref` impl.
            let pos = pc
                .waiters
                .iter()
                .position(|w| bun_ptr::BackRef::from(*w).async_http_id == async_http_id);
            if let Some(i) = pos {
                let waiter = pc.waiters.swap_remove(i);
                // Same liveness as above; exclusive access — the waiter was
                // just removed from the only container that aliased it, and
                // the HTTP thread is single-threaded here.
                h2::PendingConnect::waiter_mut(waiter).fail_from_h2(bun_core::err!("Aborted"));
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
            // Captured before `claim()` so the `&mut self.pending_sockets`
            // borrow held by the `HiveSlot` doesn't conflict with a whole-`self`
            // borrow inside the initializer.
            let owner: *mut Self = self;
            if let Some(slot) = self.pending_sockets.claim() {
                // The slot's stable address is registered as the socket's
                // user-data *before* the `PooledSocket` is written; nothing
                // dereferences it until after `slot.write()` below. If the
                // `Box::from`/`Arc::clone` in the initializer panic, `slot`'s
                // `Drop` releases the hive bit without running
                // `PooledSocket::drop` (which would otherwise drop garbage in
                // `ssl_config: Option<Arc>` / `target_hostname: Box<[u8]>`).
                let pending_addr = slot.addr();
                Self::set_socket_ext(
                    socket,
                    ActiveSocket::<SSL>::init(pending_addr.as_ptr().cast_const()),
                );
                socket.flush();
                socket.timeout(0);
                socket.set_timeout_minutes(5);

                let had_tunnel = tunnel.is_some();
                let mut hostname_buf = [0u8; MAX_KEEPALIVE_HOSTNAME];
                hostname_buf[..hostname.len()].copy_from_slice(hostname);

                slot.write(PooledSocket {
                    http_socket: socket,
                    hostname_buf,
                    hostname_len: hostname.len() as u8, // @truncate
                    port,
                    did_have_handshaking_error_while_reject_unauthorized_is_false,
                    // Clone a strong ref for the keepalive pool; the caller retains
                    // its own ref via HTTPClient.tls_props.
                    ssl_config: ssl_config.cloned(),
                    owner,
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
                });

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
            // without a second decrement. Route through the centralised
            // `raw_as_mut` accessor — `raw` is a live intrusive-refcounted
            // ProxyTunnel; we hold the strong ref `detach_and_deref` releases.
            let t = crate::proxy_tunnel::raw_as_mut(t.leak());
            t.shutdown();
            t.detach_and_deref();
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
            let socket = pooled_socket_mut(socket_ptr);
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
                // SAFETY: `socket_ptr` is a fully-initialized hive slot; the
                // owned-heap fields (ssl_config/tunnel/target_hostname/h2_session)
                // were just moved out / cleared, so the in-place drop in `put`
                // touches only trivially-droppable residuals.
                let ok = unsafe { self.pending_sockets.put(socket_ptr) };
                debug_assert!(ok);
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
        client.connected_url = client
            .http_proxy
            .clone()
            .unwrap_or_else(|| client.url.clone());
        let socket = HTTPSocket::<SSL>::connect_unix_group(
            &mut self.group,
            Self::KIND,
            if SSL { self.secure } else { None },
            socket_path,
            ActiveSocket::<SSL>::init(
                client
                    .as_erased_ptr()
                    .as_ptr()
                    .cast::<HTTPClient<'static>>(),
            )
            .ptr(),
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

        client.connected_url = client
            .http_proxy
            .clone()
            .unwrap_or_else(|| client.url.clone());
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
                    // Active sessions are kept alive by registry refs; `&mut`
                    // is unique here (registry is iterated read-only and
                    // adopt() does not reenter the registry). Route through
                    // the centralised [`h2_session_as_mut`] accessor — same
                    // strong-ref-held invariant as the pool/found-slot cases.
                    let s = h2_session_as_mut(NonNull::new(session)).unwrap();
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

            if let Some(mut found) = self.existing_socket(
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
                    AlpnOffer::H1
                },
            ) {
                let sock = found.socket;
                Self::set_socket_ext(
                    sock,
                    ActiveSocket::<SSL>::init(
                        client
                            .as_erased_ptr()
                            .as_ptr()
                            .cast::<HTTPClient<'static>>(),
                    ),
                );
                client.allow_retry = true;
                if let Some(session) = found.h2_session {
                    if SSL {
                        // PORT NOTE: `session.socket = sock` — direct field
                        // write; ClientSession.socket is `HTTPSocket<true>`.
                        // Re-derive `&mut` at each step (via the accessor)
                        // rather than holding one across `register_h2` — that
                        // fn forms a fresh `&*session`, which under Stacked
                        // Borrows would invalidate a spanning Unique.
                        found.h2_session_mut().unwrap().socket = sock.assume_ssl();
                        Self::tag_as_h2(sock, session.as_ptr());
                        self.register_h2(session.as_ptr());
                        found.h2_session_mut().unwrap().adopt(client);
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
                    // `raw` is a live ProxyTunnel; we hold the strong ref `adopt`
                    // is about to move into `client.proxy_tunnel`. Route through
                    // the centralised [`proxy_tunnel::raw_as_mut`] backref upgrade.
                    crate::proxy_tunnel::raw_as_mut(raw).adopt::<SSL>(client, sock);
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
            ActiveSocket::<SSL>::init(
                client
                    .as_erased_ptr()
                    .as_ptr()
                    .cast::<HTTPClient<'static>>(),
            )
            .ptr(),
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
                let pooled_ptr = self
                    .pending_sockets
                    .at(u16::try_from(idx).expect("int cast"));
                let pooled = pooled_socket_mut(pooled_ptr);
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
                    if !client.check_server_identity::<SSL>(socket, handshake_error, ssl_ptr, true)
                    {
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

    /// Short-tick (seconds-granularity) idle timer. Same handling as
    /// [`on_long_timeout`]; `HTTPClient::set_timeout` routes to whichever
    /// timer suits the configured duration, so both must dispatch.
    pub fn on_timeout(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        Self::on_long_timeout(ptr, socket);
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

// ported from: src/http/HTTPContext.zig
