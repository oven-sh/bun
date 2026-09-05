use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::Error;
use crate::http_thread::InitOpts as HTTPThreadInitOpts;
use crate::ssl_config::{self, SSLConfig};
use crate::{self as http, AlpnOffer, HTTPCertError, HTTPClient, InitError, ProxyTunnel, h2};
use bun_boringssl::ssl_ctx_setup;
use bun_boringssl_sys::{OwnedSslCtx, SSL_CTX};
use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::strings;
use bun_ptr::RefPtr;
use bun_uws as uws;

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const UNIX_POOL_SIZE: usize = 128;
pub(crate) const MAX_KEEPALIVE_HOSTNAME: usize = 128;

/// The const-generic `SSL` is load-bearing for monomorphization (gates hot
/// inner-loop branches); do not demote to a runtime bool.
#[derive(bun_ptr::CellRefCounted)]
pub struct HTTPContext<const SSL: bool> {
    /// Heap-allocated custom-SSL contexts only. The cache entry in
    /// custom_ssl_context_map holds 1; each in-flight HTTPClient that set
    /// `client.custom_ssl_ctx = this` holds 1. Eviction drops the cache
    /// ref but the context survives until the last client releases it,
    /// so deinit() never runs while a request is mid-flight. The global
    /// http_context/https_context start at 1 and are never deref'd.
    pub(crate) ref_count: Cell<u32>,
    pub(crate) pending_sockets: LazyPool<SSL, POOL_SIZE>,
    pub(crate) pending_unix_sockets: LazyPool<SSL, UNIX_POOL_SIZE>,
    /// Incremented per park; the lowest value in a full pool is evicted.
    pub(crate) park_seq: u64,
    /// Embedded sweep/iteration list-head for every socket this context
    /// owns (active clients + pooled keepalive). Address-stable: this
    /// struct is either a `http_thread.{http,https}_context` static or a
    /// `bun.default_allocator.create()` for custom-SSL entries.
    pub(crate) group: uws::SocketGroup,
    /// Built from this context's SSLConfig (or the default `request_cert=1`
    /// opts). Only meaningful when `SSL`.
    pub(crate) secure: Option<OwnedSslCtx>,
    /// HTTP/2 sessions with at least one active stream, available for
    /// concurrent attachment if `hasHeadroom()`. Each entry holds a ref.
    pub(crate) active_h2_sessions: Vec<RefPtr<h2::ClientSession>>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket.
    // Owned Box<PendingConnect>; `pc.deinit()` runs in Drop. The `Box` is
    // load-bearing: `client.pending_h2` holds `NonNull<PendingConnect>`
    // into the box interior; unboxing would dangle it on `Vec` realloc.
    #[expect(clippy::vec_box)]
    pub(crate) pending_h2_connects: Vec<Box<h2::PendingConnect>>,
    /// Client-side TLS session cache; populated only when `SSL`.
    pub(crate) session_cache: crate::session_cache::SessionCache,
}

/// Keep-alive pool storage, allocated on the first park.
pub(crate) struct LazyPool<const SSL: bool, const N: usize>(
    Option<Box<HiveArray<PooledSocket<SSL>, N>>>,
);

impl<const SSL: bool, const N: usize> LazyPool<SSL, N> {
    pub(crate) const fn new() -> Self {
        Self(None)
    }

    fn get(&self) -> Option<&HiveArray<PooledSocket<SSL>, N>> {
        self.0.as_deref()
    }

    fn get_or_init(&mut self) -> &HiveArray<PooledSocket<SSL>, N> {
        self.0.get_or_insert_with(HiveArray::new_boxed)
    }
}

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
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>> for DeadSocket {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
}
impl<const SSL: bool> bun_ptr::tagged_pointer::UnionMember<ActiveSocketTypes<SSL>>
    for HTTPClient<'static>
{
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

/// Typed accessors for the `ActiveSocket` tagged-pointer recovered from a
/// socket's ext slot. Centralises the `unsafe { &mut *ptr }` upgrade that the
/// socket-event dispatch handlers (and HTTPThread queue drains) repeat at
/// every site.
///
/// INVARIANT (single point of unsafe): a tagged pointer stored in a live
/// socket's ext slot identifies an object that is alive for the duration of
/// the dispatched callback — `HTTPClient` until its terminal result callback,
/// `h2::ClientSession` while the slot holds its socket-ext ref, `PooledSocket`
/// while its HiveArray bit is set. All accesses are HTTP-thread-only, so no
/// concurrent `&mut` exists. Callers obtain the tagged value via
/// [`HTTPContext::get_tagged`] / [`HTTPContext::get_tagged_from_socket`] and
/// must not retain the returned reference past the callback.
///
/// An h2 session is handed out as a [`h2::SessionPtr`] rather than a `&mut`:
/// its entry points release the slot's ref themselves (the socket closing, or
/// the last request finishing on an unpoolable connection), so a `&mut`
/// argument to them could be freed while still live.
pub(crate) trait ActiveSocketExt<const SSL: bool>: Copy {
    fn client_mut<'a>(self) -> Option<&'a mut HTTPClient<'static>>;
    fn session(self) -> Option<h2::SessionPtr>;
    fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>>;
}

/// The single `&mut *p` upgrade for [`ActiveSocketExt`] — generic so
/// `client_mut`/`pooled_mut` share one SAFETY argument instead of two
/// open-coded ones. INVARIANT: see [`ActiveSocketExt`] trait doc.
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
    fn session(self) -> Option<h2::SessionPtr> {
        // INVARIANT: see the trait doc — while tagged as the session the slot
        // holds the socket-ext ref, which is what `this_ptr` requires.
        self.get::<h2::ClientSession>()
            .and_then(NonNull::new)
            .map(h2::ClientSession::this_ptr)
    }
    #[inline]
    fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>> {
        active_socket_get_mut(self)
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
    /// The context that owns this pooled socket's memory (for returning to correct pool).
    pub(crate) owner: *mut HTTPContext<SSL>,
    /// If this socket carries an established CONNECT tunnel (HTTPS through
    /// an HTTP proxy), the tunnel is preserved here. The pool owns one
    /// strong ref while the socket is parked (the `RefPtr` *is* that ref).
    /// None for direct connections.
    pub(crate) proxy_tunnel: Option<RefPtr<ProxyTunnel>>,
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
    pub(crate) h2_session: Option<RefPtr<h2::ClientSession>>,
}

/// `&mut` access to a pooled / found-slot HTTP/2 session, for the field
/// writes and idle-frame handling that cannot release the session. Anything
/// that can (`adopt`, the socket events) goes through a [`h2::SessionPtr`]
/// instead.
///
/// INVARIANT: the holder owns one ref on the session, a distinct heap
/// allocation; HTTP-thread-only, so no concurrent `&mut`. Each call re-derives
/// a fresh `&mut`, so callers may interleave raw `as_ptr()` reads (e.g.
/// `register_h2`) without a spanning Unique tag.
#[inline]
#[allow(clippy::mut_from_ref)]
fn h2_session_mut(s: &RefPtr<h2::ClientSession>) -> &mut h2::ClientSession {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *s.as_ptr() }
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
    /// Drop the strong refs the pool holds while a socket is parked
    /// (proxy_tunnel / h2_session) and clear the heap-owned
    /// `target_hostname`. Called from `Drop` and `add_memory_back_to_pool`
    /// before the slot is recycled or its socket force-closed.
    ///
    /// Centralises the intrusive-rc `deref` so each caller doesn't repeat the
    /// pair of `unsafe { …::deref(nn.as_ptr()) }`.
    fn release_parked_refs(&mut self) {
        self.target_hostname = Box::default();
        self.proxy_tunnel = None;
        self.h2_session = None;
    }
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
}

fn ssl_config_hash(cfg: Option<&SSLConfig>) -> u64 {
    cfg.map_or(0, SSLConfig::content_hash)
}

struct ExistingSocket<const SSL: bool> {
    socket: HTTPSocket<SSL>,
    /// Present if the socket carries an established CONNECT tunnel.
    /// Ownership (one strong ref) is transferred to the caller.
    tunnel: Option<RefPtr<ProxyTunnel>>,
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

    fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if tagged.is::<PooledSocket<SSL>>() {
            // SAFETY: tag check above guarantees the pointer is a PooledSocket<SSL>.
            unsafe {
                Handler::<SSL>::add_memory_back_to_pool(tagged.as_unchecked::<PooledSocket<SSL>>());
            }
        }

        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(dead_socket()));
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
    /// `ActiveSocket` tagged pointer), already dereferenced by
    /// `NsHandler` before reaching `Handler.on*`. No second deref.
    fn get_tagged(ptr: *mut c_void) -> ActiveSocket<SSL> {
        ActiveSocket::<SSL>::from(Some(ptr))
    }

    pub(crate) fn get_tagged_from_socket(socket: HTTPSocket<SSL>) -> ActiveSocket<SSL> {
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
    fn set_socket_ext(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if let Some(slot) = socket.ext::<*mut c_void>() {
            // SAFETY: see INVARIANT above.
            unsafe { *slot = tagged.ptr() };
        }
    }

    /// Shared-borrow a live `*const ClientSession` to read/set its
    /// `Cell<u32>` registry index. Module-private — callers guarantee the
    /// session is live (registry holds a strong ref while indexed).
    /// `registry_index`/`set_registry_index` only touch `Cell` fields,
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

    /// Tail of [`Self::unregister_h2_raw`]: swap-remove the entry at `idx`
    /// from `list`, fix up the swapped-in entry's index, and release the ref
    /// taken in [`Self::register_h2`] through the pointer the registry held.
    /// `session` only identifies the entry being removed.
    fn h2_swap_remove_and_deref(
        list: &mut Vec<RefPtr<h2::ClientSession>>,
        idx: u32,
        session: *const h2::ClientSession,
    ) {
        debug_assert!(
            (idx as usize) < list.len()
                && core::ptr::eq(list[idx as usize].as_ptr().cast_const(), session)
        );
        let _removed = list.swap_remove(idx as usize);
        if (idx as usize) < list.len() {
            // The swapped-in entry is a distinct allocation from `session`
            // (the entry at `idx` was just removed); `set_registry_index`
            // only touches a `Cell<u32>`.
            list[idx as usize].set_registry_index(idx);
        }
    }

    pub(crate) fn register_h2(&mut self, session: *mut h2::ClientSession) {
        if !SSL {
            return;
        }
        let s = Self::h2_session_ref(session);
        if s.registry_index() != u32::MAX {
            return;
        }
        s.set_registry_index(u32::try_from(self.active_h2_sessions.len()).expect("int cast"));
        // SAFETY: `session` is live (caller contract).
        self.active_h2_sessions
            .push(unsafe { RefPtr::init_ref(session) });
    }

    /// Called from drainQueuedShutdowns when the abort-tracker lookup
    /// misses: a request parked in `PendingConnect.waiters` (coalesced
    /// onto a leader's in-flight TLS connect) never registered a socket,
    /// so it can only be found by scanning here.
    pub(crate) fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
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
                h2::PendingConnect::waiter_mut(waiter).fail_from_h2(crate::Error::Aborted);
                return true;
            }
        }
        false
    }

    /// Take `session` out of `active_h2_sessions`, releasing the registry's
    /// ref. Takes the context as a raw pointer because it is reached on
    /// re-entrant call paths (`connect` → `adopt` → `maybe_release` /
    /// `fail_all` → `fail_streams`) where an ancestor stack frame already
    /// holds `&mut HTTPContext<SSL>`. Upgrading the session's `ctx` backref to
    /// a second `&mut Self` there would alias; this entry point instead
    /// projects `active_h2_sessions` through a raw place expression so no
    /// intermediate `&mut Self` is formed.
    ///
    /// # Safety
    /// `ctx` must point to a live `HTTPContext<SSL>`; an ancestor frame may
    /// hold a `&mut` to it but must not be mid-iteration over
    /// `active_h2_sessions` (this swap_removes from that Vec). `session` must
    /// be live for the duration of the call; it is only used to find and
    /// identify the registry entry, which is what gets released.
    pub(crate) unsafe fn unregister_h2_raw(ctx: *mut Self, session: *const h2::ClientSession) {
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

    pub(crate) fn tag_as_h2(socket: HTTPSocket<SSL>, session: *const h2::ClientSession) {
        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(session));
    }

    fn ssl_ctx(&self) -> *mut SSL_CTX {
        if !SSL {
            unreachable!();
        }
        self.secure.as_ref().unwrap().as_ptr()
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
        self.secure = match opts.create_ssl_context(&mut err) {
            Some(ctx) => Some(ctx),
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
        // SAFETY: secure was just set to Some.
        unsafe { ssl_ctx_setup(self.ssl_ctx()) };
        let owner_ptr = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        self.group
            .init(http::http_thread().uws_loop(), None, owner_ptr);
        Ok(())
    }

    pub(crate) fn init_with_thread_opts(
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
        self.init_with_opts(&opts)
    }

    pub(crate) fn init(&mut self) {
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
    pub(crate) fn release_socket(
        &mut self,
        socket: HTTPSocket<SSL>,
        did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
        verification: PeerVerification,
        hostname: &[u8],
        port: u16,
        ssl_config: Option<&ssl_config::SharedPtr>,
        mut tunnel: Option<RefPtr<ProxyTunnel>>,
        target_hostname: &[u8],
        target_port: u16,
        proxy_auth_hash: u64,
        h2_session: Option<RefPtr<h2::ClientSession>>,
        unix_path: &[u8],
    ) {
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
            let owner: *mut Self = self;
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
                owner,
                // Pool owns the tunnel ref transferred by the caller.
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
                h2_session,
            };
            let parked = match transport {
                Transport::Tcp => Self::park(self.pending_sockets.get_or_init(), pooled),
                Transport::Unix => Self::park(self.pending_unix_sockets.get_or_init(), pooled),
            };
            match parked {
                None => {
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
                Some(mut pooled) => tunnel = pooled.proxy_tunnel.take(),
            }
        }
        bun_core::scoped_log!(HTTPContext, "close socket");
        if let Some(t) = tunnel {
            ProxyTunnel::shutdown(t.as_non_null());
            crate::proxy_tunnel::raw_as_mut(t.as_ptr()).detach_socket();
        }
        Self::close_socket(socket);
    }

    /// Park `pooled`, evicting the longest-idle entry when the pool is full; hands it back on failure.
    fn park<const N: usize>(
        pool: &HiveArray<PooledSocket<SSL>, N>,
        pooled: PooledSocket<SSL>,
    ) -> Option<PooledSocket<SSL>> {
        if pool.used.find_first_unset().is_none() {
            let mut oldest: Option<*mut PooledSocket<SSL>> = None;
            let mut iter = pool.used.iterator::<true, true>();
            while let Some(idx) = iter.next() {
                let ptr = pool.at(u16::try_from(idx).expect("int cast"));
                if oldest
                    .is_none_or(|o| pooled_socket_mut(ptr).park_seq < pooled_socket_mut(o).park_seq)
                {
                    oldest = Some(ptr);
                }
            }
            let Some(oldest) = oldest else {
                return Some(pooled);
            };
            bun_core::scoped_log!(HTTPContext, "Keep-Alive pool full, evicting oldest");
            Self::terminate_socket(pooled_socket_mut(oldest).http_socket);
        }
        let Some(slot) = pool.claim() else {
            return Some(pooled);
        };
        let socket = pooled.http_socket;
        Self::set_socket_ext(
            socket,
            ActiveSocket::<SSL>::init(slot.addr().as_ptr().cast_const()),
        );
        socket.flush();
        socket.timeout(0);
        socket.set_timeout_minutes(5);
        slot.write(pooled);
        None
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
        };
        match transport {
            Transport::Tcp => Self::find_in(self.pending_sockets.get()?, &key),
            Transport::Unix => Self::find_in(self.pending_unix_sockets.get()?, &key),
        }
    }

    fn find_in<const N: usize>(
        pool: &HiveArray<PooledSocket<SSL>, N>,
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
        } = *key;
        let mut iter = pool.used.iterator::<true, true>();

        while let Some(pending_socket_index) = iter.next() {
            let socket_ptr = pool.at(u16::try_from(pending_socket_index).expect("int cast"));
            let socket = pooled_socket_mut(socket_ptr);
            debug_assert!(socket.transport == transport);
            if socket.port != port {
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
                if !strings::eql_long(&socket.target_hostname, target_hostname, true) {
                    continue;
                }
                // proxy_tunnel.is_some() guaranteed by want_tunnel match above.
                if !required_for_target.admits(socket.proxy_tunnel.as_ref().unwrap().verification) {
                    continue;
                }
            } else if transport == Transport::Unix
                && !strings::eql_long(&socket.target_hostname, target_hostname, true)
            {
                continue;
            }
            if SSL && !required_for_socket.admits(socket.verification) {
                continue;
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

                // Transfer tunnel ownership (the parked strong ref) to the caller.
                let tunnel: Option<RefPtr<ProxyTunnel>> = socket.proxy_tunnel.take();
                socket.target_hostname = Box::default();
                let h2_session = socket.h2_session.take();
                let verification = socket.verification;
                // SAFETY: `socket_ptr` is a fully-initialized hive slot; the
                // owned-heap fields (tunnel/target_hostname/h2_session)
                // were just moved out / cleared, so the in-place drop in `put`
                // touches only trivially-droppable residuals.
                let ok = unsafe { pool.put(socket_ptr) };
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
                    verification,
                });
            }
        }

        None
    }

    pub(crate) fn connect_socket(
        &mut self,
        client: &mut HTTPClient,
        socket_path: &[u8],
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        client.connected_url = client
            .http_proxy
            .clone()
            .unwrap_or_else(|| client.url.clone());

        client.flags.reused_socket_verification = PeerVerification::None;
        if client.is_keep_alive_possible() {
            if let Some(found) = self.existing_socket(
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
            ) {
                let sock = found.socket;
                debug_assert!(found.tunnel.is_none());
                debug_assert!(found.h2_session.is_none());
                client.flags.reused_socket_verification = found.verification;
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
                client.on_open::<SSL>(sock)?;
                if SSL {
                    client.first_call::<SSL>(sock);
                }
                return Ok(Some(sock));
            }
        }

        let socket = HTTPSocket::<SSL>::connect_unix_group(
            &mut self.group,
            Self::KIND,
            if SSL {
                self.secure.as_ref().map(OwnedSslCtx::as_ptr)
            } else {
                None
            },
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

    pub(crate) fn connect(
        &mut self,
        client: &mut HTTPClient,
        hostname: &[u8],
        port: u16,
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
        client.connected_url = client
            .http_proxy
            .clone()
            .unwrap_or_else(|| client.url.clone());
        // URL.hostname is a borrowed slice — assigning a local would not
        // satisfy the field's lifetime, so this uses raw lifetime erasure.
        client.connected_url.hostname =
            // SAFETY: hostname borrows `client.url` or `client.http_proxy`,
            // which outlive `connected_url` for the duration of the connect
            // attempt.
            unsafe { bun_ptr::detach_lifetime(hostname) };

        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref());
                // Listed sessions are kept alive by the registry's ref. The
                // scan only reads; `adopt` runs after the iteration is over
                // because it may end by unregistering the session it was
                // given (swap-removing it from this Vec) and releasing it.
                let reusable = self
                    .active_h2_sessions
                    .iter()
                    .map(|session| session.this_ptr())
                    .find(|s| {
                        s.has_headroom()
                            && s.matches(hostname, port, cfg)
                            // Same guard as the pool path (`existing_socket`).
                            && client.socket_verification().admits(s.verification)
                    });
                if let Some(session) = reusable {
                    h2::ClientSession::adopt(session, client);
                    return Ok(None);
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in &mut self.pending_h2_connects {
                    // Same guard as the active-session loop above, applied to
                    // an in-flight connect before its session exists.
                    if pc.matches(hostname, port, cfg_nn)
                        && client.socket_verification().admits(pc.verification)
                    {
                        // client outlives the pending connect (resolved before
                        // its terminal callback fires).
                        pc.waiters.push(client.as_erased_ptr());
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
            ) {
                let sock = found.socket;
                client.flags.reused_socket_verification = found.verification;
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
                if let Some(session) = found.h2_session.take() {
                    debug_assert!(SSL);
                    h2_session_mut(&session).socket = sock.assume_ssl();
                    // The pool's ref becomes the socket ext's; `adopt` goes
                    // through that handle and may release it again if the
                    // session turns out to be unusable, so nothing touches
                    // `session` afterwards.
                    let session = session.into_this_ptr();
                    Self::tag_as_h2(sock, session.as_ptr());
                    self.register_h2(session.as_ptr());
                    h2::ClientSession::adopt(session, client);
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

        let socket = HTTPSocket::<SSL>::connect_group(
            &mut self.group,
            Self::KIND,
            if SSL {
                self.secure.as_ref().map(OwnedSslCtx::as_ptr)
            } else {
                None
            },
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
                    verification: client.socket_verification(),
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

impl<const SSL: bool> HTTPContext<SSL> {
    fn drain_pool<const N: usize>(pool: &HiveArray<PooledSocket<SSL>, N>) {
        let mut iter = pool.used.iterator::<true, true>();
        while let Some(idx) = iter.next() {
            let pooled = pooled_socket_mut(pool.at(u16::try_from(idx).expect("int cast")));
            // Not shutdown(): its close callback would deref the freed HTTPClient in the ext slot.
            pooled.release_parked_refs();
            pooled.http_socket.close(uws::CloseKind::Failure);
        }
    }
}

impl<const SSL: bool> Drop for HTTPContext<SSL> {
    fn drop(&mut self) {
        // Drain pooled keepalive sockets: drop their parked refs and force-close.
        // Must force-close (code != 0) because SSL clean shutdown (code=0) requires a
        // shutdown handshake with the peer, which won't complete during eviction.
        // Without force-close, the socket stays linked and the context refcount never
        // reaches 0, leaking the SSL_CTX.
        if let Some(pool) = self.pending_sockets.get() {
            Self::drain_pool(pool);
        }
        if let Some(pool) = self.pending_unix_sockets.get() {
            Self::drain_pool(pool);
        }

        // Note: Vec drop subsumes `active_h2_sessions.deinit()`.
        // Note: Box<PendingConnect> Drop subsumes `pc.deinit()`; Vec drop
        // subsumes `pending_h2_connects.deinit()`.

        // `init_with_opts` can fail before `group.init()` runs (HTTPThread
        // cache-miss error path frees the half-init context); tolerate that
        // here by skipping group teardown when it was never linked into the
        // loop.
        if !self.group.loop_.is_null() {
            // Force-close any remaining sockets before unlinking the group so
            // the loop never dereferences a freed `*Context` via `group->ext`.
            self.group.close_all();
            // Note: SocketGroup deinit must run before the embedding struct
            // is freed (it unlinks from the loop's group list).
            // SAFETY: group was init()'d in `init`/`init_with_opts`; HTTP-thread-only.
            unsafe { uws::SocketGroup::destroy(&raw mut self.group) };
        }
    }
}

/// Ext is the `ActiveSocket` tagged-pointer word.
pub struct Handler<const SSL: bool>;

impl<const SSL: bool> Handler<SSL> {
    pub fn on_open(ptr: *mut c_void, socket: HTTPSocket<SSL>) {
        let active = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = active.client_mut() {
            match client.on_connect::<SSL>(socket) {
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
                        let err = client.handshake_failure_error(&ssl_error);
                        client.close_and_fail::<SSL>(err, socket);
                        return;
                    }

                    // if checkServerIdentity returns false, we dont call firstCall — the connection was rejected
                    // SAFETY: the native handle on a TLS socket is `*mut SSL`,
                    // live and non-null after the handshake completes.
                    let ssl = unsafe {
                        &mut *socket
                            .get_native_handle()
                            .expect("TLS socket has native handle after handshake")
                            .cast::<bun_boringssl_sys::SSL>()
                    };
                    if !client.check_server_identity::<SSL>(socket, ssl, true) {
                        // checkServerIdentity already called closeAndFail() → fail()
                        // → result callback, which may have destroyed the
                        // AsyncHTTP that embeds `client`. Socket is terminated
                        // and the abort tracker is unregistered there, so the
                        // only safe action is to return without touching
                        // `client` again.
                        return;
                    }
                    // Peer chain + hostname verified: let the session sink
                    // flush its pending TLS 1.2 ticket (parked before this
                    // dispatch) and cache later TLS 1.3 tickets directly.
                    // SAFETY: `ssl` is the live handle for this socket on the
                    // HTTP thread.
                    unsafe { crate::session_cache::arm(ssl) };
                }

                return client.first_call::<SSL>(socket);
            } else {
                // `error_no` is an X509 verdict or a uSockets transport code.
                if client.flags.did_have_handshaking_error {
                    let err = client.handshake_failure_error(&ssl_error);
                    client.close_and_fail::<SSL>(err, socket);
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
        HTTPContext::<SSL>::mark_socket_as_dead(socket);

        if let Some(client) = tagged.client_mut() {
            return client.on_close::<SSL>(socket);
        }
        if let Some(session) = tagged.session() {
            return h2::ClientSession::on_close(session, crate::Error::ConnectionClosed);
        }
        // PooledSocket/DeadSocket: whoever retagged the ext should have
        // unregistered; sweep by pointer so a miss can't leave a stale
        // entry for `drain_queued_shutdowns` to deref after free.
        crate::unregister_abort_tracker_for_socket(socket.socket);
    }

    unsafe fn add_memory_back_to_pool(pooled_ptr: *mut PooledSocket<SSL>) {
        // SAFETY: caller guarantees `pooled_ptr` points at a live HiveArray slot.
        // Hoist `owner` and clear the slot's owned resources first; the
        // `&mut HiveArray` receiver formed by `pending_sockets.put` (covering
        // this very slot) is created only after the `&mut PooledSocket` borrow
        // is dropped — avoids Stacked Borrows invalidation of the slot pointer.
        // SAFETY: see fn-level contract.
        let (owner, transport) = unsafe {
            let slot = &mut *pooled_ptr;
            slot.release_parked_refs();
            (slot.owner, slot.transport)
        };
        // SAFETY: owner is the HiveArray backing this slot; address-stable
        // (static or Box-allocated) and outlives any pooled entry.
        let ok = unsafe {
            match transport {
                Transport::Tcp => (*owner)
                    .pending_sockets
                    .get()
                    .is_some_and(|p| p.put(pooled_ptr)),
                Transport::Unix => (*owner)
                    .pending_unix_sockets
                    .get()
                    .is_some_and(|p| p.put(pooled_ptr)),
            }
        };
        debug_assert!(ok);
    }

    pub fn on_data(ptr: *mut c_void, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = HTTPContext::<SSL>::get_tagged(ptr);
        if let Some(client) = tagged.client_mut() {
            return client.on_data::<SSL>(buf, client.get_ssl_ctx::<SSL>(), socket);
        } else if let Some(session) = tagged.session() {
            return h2::ClientSession::on_data(session, buf);
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

            if let Some(session) = pooled.h2_session.as_ref().map(h2_session_mut) {
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
        if let Some(client) = tagged.client_mut() {
            return client.on_writable::<false, SSL>(socket);
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
        if let Some(client) = tagged.client_mut() {
            return client.on_timeout::<SSL>(socket);
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
        HTTPContext::<SSL>::mark_tagged_socket_as_dead(socket, tagged);
        if let Some(client) = tagged.client_mut() {
            client.on_connect_error(dns_error);
        } else {
            // Same backstop as `on_close`: a SEMI_SOCKET/connecting socket
            // whose ext is no longer a client never dispatches `on_close`,
            // so sweep any leftover tracker entry here.
            crate::unregister_abort_tracker_for_socket(socket.socket);
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
        if let Some(client) = tagged.client_mut() {
            if client.has_unsent_request_body() {
                socket.close(uws::CloseKind::Failure);
            } else {
                socket.close(uws::CloseKind::Normal);
            }
            client.on_close::<SSL>(socket);
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

/// Must be aligned to `align_of::<usize>()` so that tagged pointer values
/// embedding this address pass the align check in `bun.cast`.
#[repr(C, align(8))]
struct DeadSocket {
    garbage: u8,
}

// A shared static + accessor; the pointer is only ever compared, never
// written through.
static DEAD_SOCKET: DeadSocket = DeadSocket { garbage: 0 };

#[inline]
fn dead_socket() -> *const DeadSocket {
    &raw const DEAD_SOCKET
}
