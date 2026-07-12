use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::Error;
use crate::http_thread::InitOpts as HTTPThreadInitOpts;
use crate::ssl_config::{self, SSLConfig};
use crate::{
    self as http, AlpnOffer, HTTPCertError, HTTPClient, InitError, get_cert_error_from_no, h2,
};
use bun_boringssl::ssl_ctx_setup;
use bun_boringssl_sys::SSL_CTX;
use bun_collections::HiveArray;
use bun_core::strings;
use bun_core::{self, FeatureFlags};
use bun_usockets as uws;
use bun_usockets::unsafe_core::trampolines::{socket_owner_ref, with_socket_owner};

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const MAX_KEEPALIVE_HOSTNAME: usize = 128;

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
    // Raw pointers; the intrusive refcount (bumped on insert, dropped on
    // removal) is what keeps each session alive while listed here.
    pub active_h2_sessions: Vec<*mut h2::ClientSession>,
    /// HTTPClients whose fresh TLS connect is in flight and whose request
    /// is h2-capable. Subsequent h2-capable requests to the same origin
    /// coalesce onto the first one's session once ALPN resolves rather
    /// than each opening its own socket.
    // Owned Box<PendingConnect>; `pc.deinit()` runs in Drop. The `Box` is
    // load-bearing: `client.pending_h2` holds `NonNull<PendingConnect>`
    // into the box interior; unboxing would dangle it on `Vec` realloc.
    #[expect(clippy::vec_box)]
    pub pending_h2_connects: Vec<Box<h2::PendingConnect>>,
}

// Intrusive refcount:
// `*T` crosses FFI (group.ext) and is recovered from socket ext, so per
// PORTING.md this stays intrusive rather than `Rc<T>`. Derived via
// `#[derive(CellRefCounted)]` above; default `destroy` (`heap::take`) applies
// (this struct is Box-allocated for custom-SSL entries; statics never hit 0).
pub(crate) type HTTPContextRc<const SSL: bool> = bun_ptr::IntrusiveRc<HTTPContext<SSL>>;

pub(crate) type PooledSocketHiveAllocator<const SSL: bool> =
    HiveArray<PooledSocket<SSL>, POOL_SIZE>;

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

/// What a socket's [`SocketOwner`] currently dispatches to — the safe enum
/// replacement for the old ext tagged-pointer union (Protocol v2 — src/usockets/docs/design.md).
#[derive(Copy, Clone)]
pub(crate) enum ActiveSocket<const SSL: bool> {
    /// Terminal/no-op: whoever owned the socket already ran its teardown.
    Dead,
    Client(NonNull<HTTPClient<'static>>),
    Pooled(NonNull<PooledSocket<SSL>>),
    H2(NonNull<h2::ClientSession>),
}

/// Per-socket Protocol v2 dispatch owner. One heap allocation per HTTP-thread
/// socket. Ref holders: the core ext word (released by core exactly once at
/// the socket terminal), the keepalive pool slot while parked
/// (`PooledSocket::owner_ref`), and the trampoline's per-dispatch guard.
#[derive(bun_ptr::RefCounted)]
pub struct SocketOwner<const SSL: bool> {
    ref_count: bun_ptr::RefCount<Self>,
    /// Retagged in place at ownership transitions (connect / park / reuse /
    /// ALPN=h2 / dead-marking) — same transitions the old ext word made.
    state: Cell<ActiveSocket<SSL>>,
    /// Owner-held handle: Protocol v2 `on_connect_error` has no socket
    /// argument, so the terminal close + `dns_error()` read use this.
    /// Refreshed on `on_open` and pool reuse.
    socket: Cell<HTTPSocket<SSL>>,
}

impl<const SSL: bool> SocketOwner<SSL> {
    fn new_client(client: &HTTPClient) -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(Self {
            ref_count: bun_ptr::RefCount::init(),
            state: Cell::new(ActiveSocket::Client(client.as_erased_ptr())),
            socket: Cell::new(HTTPSocket::<SSL>::DETACHED),
        })
    }
}

impl<const SSL: bool> ActiveSocket<SSL> {
    /// INVARIANT (single point of unsafe; irreducible until the AsyncHTTP
    /// bitwise-clone ownership model is reworked): a variant read from a live
    /// socket's owner identifies an object alive for the current callback —
    /// `HTTPClient` until its terminal result callback, `h2::ClientSession`
    /// while it holds a registry/tag strong ref, `PooledSocket` while its
    /// HiveArray bit is set. HTTP-thread-only, so no concurrent `&mut`;
    /// callers must not retain the returned reference past the callback.
    #[inline]
    pub(crate) fn client_mut<'a>(self) -> Option<&'a mut HTTPClient<'static>> {
        match self {
            // SAFETY: see enum-level INVARIANT above.
            ActiveSocket::Client(p) => Some(unsafe { &mut *p.as_ptr() }),
            _ => None,
        }
    }
    #[inline]
    pub(crate) fn session_mut<'a>(self) -> Option<&'a mut h2::ClientSession> {
        match self {
            // SAFETY: see enum-level INVARIANT above.
            ActiveSocket::H2(p) => Some(unsafe { &mut *p.as_ptr() }),
            _ => None,
        }
    }
    #[inline]
    pub(crate) fn pooled_mut<'a>(self) -> Option<&'a mut PooledSocket<SSL>> {
        match self {
            // SAFETY: see enum-level INVARIANT above.
            ActiveSocket::Pooled(p) => Some(unsafe { &mut *p.as_ptr() }),
            _ => None,
        }
    }
}

pub struct PooledSocket<const SSL: bool> {
    pub http_socket: HTTPSocket<SSL>,
    pub hostname_buf: [u8; MAX_KEEPALIVE_HOSTNAME],
    pub hostname_len: u8,
    pub port: u16,
    /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
    pub did_have_handshaking_error_while_reject_unauthorized_is_false: bool,
    /// True if the TLS handshake for this socket ran with
    /// `rejectUnauthorized=true` (i.e. `checkServerIdentity` was enforced).
    /// A socket established with `rejectUnauthorized=false` never validated the
    /// peer hostname, so a strict caller must not reuse it even when the chain
    /// itself was CA-valid (`did_have_handshaking_error` stays false).
    pub established_with_reject_unauthorized: bool,
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
    /// The pool's strong ref on the socket's dispatch owner while parked
    /// (Protocol v2: pool slots hold OwnerRef). Taken in
    /// `release_socket`; released in `release_parked_refs`, or moved out by
    /// `existing_socket` and released after the reuse retag in `connect`.
    pub(crate) owner_ref: Option<bun_ptr::RefPtr<SocketOwner<SSL>>>,
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
    pub(crate) fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
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
        // Cleared even for the non-SSL context — an HTTP-proxy-to-HTTPS tunnel pools in
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
        if let Some(o) = self.owner_ref.take() {
            // Release the pool's strong ref on the dispatch owner (the core
            // ext ref keeps it alive until the socket terminal).
            o.deref();
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
    /// The parked slot's strong ref on the dispatch owner, moved out of the
    /// pool; `connect` derefs it after retagging the owner to the new client.
    owner: Option<bun_ptr::RefPtr<SocketOwner<SSL>>>,
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

/// Protocol v2 registration marker for the HTTP client kinds; the ext word
/// is a core-owned strong ref to a [`SocketOwner`].
pub struct HttpProtocol<const SSL: bool>;

/// Convert the trampoline's [`uws::AnySocket`] to the kind-matching typed
/// handle (the KIND registration fixes the SSL flavor).
#[inline]
fn from_any<const SSL: bool>(s: uws::AnySocket) -> HTTPSocket<SSL> {
    HTTPSocket::<SSL>::from_any(*s.socket())
}

impl<const SSL: bool> uws::Protocol for HttpProtocol<SSL> {
    type Owner = SocketOwner<SSL>;
    const KIND: uws::SocketKind = HTTPContext::<SSL>::KIND;

    fn on_open(o: &Self::Owner, s: uws::AnySocket, _is_client: bool, _ip: &[u8]) {
        let socket = from_any::<SSL>(s);
        // Refresh the owner-held handle: the connect-time handle may have
        // been a Connecting one that has since promoted.
        o.socket.set(socket);
        Handler::<SSL>::on_open(o, socket);
    }
    fn on_data(o: &Self::Owner, s: uws::AnySocket, data: &mut [u8]) {
        Handler::<SSL>::on_data(o, from_any::<SSL>(s), data);
    }
    fn on_writable(o: &Self::Owner, s: uws::AnySocket) {
        Handler::<SSL>::on_writable(o, from_any::<SSL>(s));
    }
    fn on_close(o: &Self::Owner, s: uws::AnySocket, _code: uws::CloseCode2, _errno: i32) {
        Handler::<SSL>::on_close(o, from_any::<SSL>(s));
    }
    fn on_end(o: &Self::Owner, s: uws::AnySocket) {
        Handler::<SSL>::on_end(o, from_any::<SSL>(s));
    }
    fn on_timeout(o: &Self::Owner, s: uws::AnySocket) {
        Handler::<SSL>::on_timeout(o, from_any::<SSL>(s));
    }
    fn on_long_timeout(o: &Self::Owner, s: uws::AnySocket) {
        Handler::<SSL>::on_long_timeout(o, from_any::<SSL>(s));
    }
    fn on_connect_error(o: &Self::Owner, _err: uws::ConnectFailure) {
        // The wire errno is ignored on purpose (v1 parity): the client
        // distinguishes DNS failures via `dns_error()` on the owner-held
        // handle, and everything else maps to ConnectionRefused.
        Handler::<SSL>::on_connect_error(o);
    }
    fn on_handshake(o: &Self::Owner, s: uws::AnySocket, ok: bool, err: uws::VerifyError) {
        Handler::<SSL>::on_handshake(o, from_any::<SSL>(s), ok, err);
    }
}

impl<const SSL: bool> HTTPContext<SSL> {
    pub(crate) const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    pub(crate) fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if let ActiveSocket::Pooled(p) = tagged {
            // SAFETY: a Pooled variant read from a live owner points at the
            // slot whose HiveArray bit is still set (enum-level INVARIANT).
            unsafe { Handler::<SSL>::add_memory_back_to_pool(p.as_ptr()) };
        }
        Self::set_state(socket, ActiveSocket::Dead);
    }

    pub(crate) fn mark_socket_as_dead(socket: HTTPSocket<SSL>) {
        Self::mark_tagged_socket_as_dead(socket, Self::get_tagged_from_socket(socket));
    }

    /// Owner-side dead-marking for dispatch handlers that already hold the
    /// owner (skips the handle→owner re-resolution).
    fn mark_owner_dead(owner: &SocketOwner<SSL>) {
        if let ActiveSocket::Pooled(p) = owner.state.get() {
            // SAFETY: see `mark_tagged_socket_as_dead`.
            unsafe { Handler::<SSL>::add_memory_back_to_pool(p.as_ptr()) };
        }
        owner.state.set(ActiveSocket::Dead);
    }

    pub(crate) fn terminate_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Failure);
    }

    pub(crate) fn close_socket(socket: HTTPSocket<SSL>) {
        Self::mark_socket_as_dead(socket);
        socket.close(uws::CloseKind::Normal);
    }

    /// Read the socket's current owner state; `Dead` for stale/detached
    /// handles and sockets whose terminal already released the owner.
    pub(crate) fn get_tagged_from_socket(socket: HTTPSocket<SSL>) -> ActiveSocket<SSL> {
        with_socket_owner(&socket, |o: &SocketOwner<SSL>| o.state.get())
            .unwrap_or(ActiveSocket::Dead)
    }

    /// Retag the socket's owner in place; no-op when the owner is already
    /// released (post-terminal) or the handle is stale.
    #[inline]
    pub(crate) fn set_state(socket: HTTPSocket<SSL>, state: ActiveSocket<SSL>) {
        let _ = with_socket_owner(&socket, |o: &SocketOwner<SSL>| o.state.set(state));
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

    pub(crate) fn register_h2(&mut self, session: *mut h2::ClientSession) {
        if !SSL {
            return;
        }
        let s = Self::h2_session_ref(session);
        if s.registry_index() != u32::MAX {
            return;
        }
        // Note: `session.ref()` — intrusive refcount bump.
        s.ref_();
        s.set_registry_index(u32::try_from(self.active_h2_sessions.len()).expect("int cast"));
        self.active_h2_sessions.push(session);
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
        let session = NonNull::new(session.cast_mut()).expect("tag_as_h2 requires a live session");
        Self::set_state(socket, ActiveSocket::H2(session));
    }

    pub(crate) fn ssl_ctx(&self) -> *mut SSL_CTX {
        if !SSL {
            unreachable!();
        }
        self.secure.unwrap()
    }

    /// `secure` as the connect-time borrow, spelled in the core crate's
    /// opaque `SslCtx` name (same BoringSSL object, cast at the seam).
    fn ssl_ctx_for_connect(&self) -> Option<*mut uws::SslCtx> {
        self.secure.map(|c| c.cast::<uws::SslCtx>())
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

    fn init_with_opts(&mut self, opts: &uws::BunSocketContextOptions) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let mut err = uws::create_bun_socket_error_t::none;
        // `uws::SslCtx` (bssl-sys) and `SSL_CTX` (bun_boringssl_sys) are two
        // opaque names for the same BoringSSL object; cast at the crate seam.
        self.secure = match opts.create_ssl_context(&mut err) {
            Some(ctx) => Some(ctx.cast::<SSL_CTX>()),
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

    pub(crate) fn init_with_thread_opts(
        &mut self,
        init_opts: &HTTPThreadInitOpts,
    ) -> Result<(), InitError> {
        debug_assert!(SSL, "ssl only");
        let opts = uws::BunSocketContextOptions {
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
                uws::BunSocketContextOptions {
                    // we request the cert so we load root certs and can verify it
                    request_cert: 1,
                    // we manually abort the connection if the hostname doesn't match
                    reject_unauthorized: 0,
                    ..Default::default()
                }
                .create_ssl_context(&mut err)
                .unwrap()
                // Same opaque BoringSSL object; cast at the crate seam.
                .cast::<SSL_CTX>(),
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
        established_with_reject_unauthorized: bool,
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
            // The pool's strong ref on the dispatch owner (P5: pool slots
            // hold OwnerRef). None only if the terminal already released the
            // owner — then the socket can't be parked.
            if let Some(owner_ref) = socket_owner_ref::<SSL, SocketOwner<SSL>>(&socket) {
                if let Some(slot) = self.pending_sockets.claim() {
                    // The slot's stable address is retagged into the owner
                    // *before* the `PooledSocket` is written; nothing
                    // dereferences it until after `slot.write()` below. If the
                    // `Box::from`/`Arc::clone` in the initializer panic, `slot`'s
                    // `Drop` releases the hive bit without running
                    // `PooledSocket::drop` (which would otherwise drop garbage in
                    // `ssl_config: Option<Arc>` / `target_hostname: Box<[u8]>`).
                    let pending_addr = slot.addr();
                    owner_ref
                        .data()
                        .state
                        .set(ActiveSocket::Pooled(pending_addr));
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
                        established_with_reject_unauthorized,
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
                        owner_ref: Some(owner_ref),
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
                // Pool full: release the ref taken above and fall through to close.
                owner_ref.deref();
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

            // The hash covers the Host-header SNI override that the handshake
            // was verified against (see get_tls_hostname / connect()).
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
            } else if SSL
                // Same failure mode as the tunnel branch above, for direct
                // HTTPS sockets: a socket established with
                // reject_unauthorized=false never ran checkServerIdentity, so
                // a CA-valid wrong-hostname cert leaves
                // did_have_handshaking_error=false and the outer guard passes.
                // Block a strict caller from reusing it.
                && reject_unauthorized
                && !socket.established_with_reject_unauthorized
            {
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

                // Release the pool's strong ref (caller has its own via tls_props)
                socket.ssl_config = None;
                // Transfer tunnel ownership (the parked strong ref) to the caller.
                let tunnel: Option<crate::proxy_tunnel::RefPtr> = socket.proxy_tunnel.take();
                socket.target_hostname = Box::default();
                let h2_session = socket.h2_session.take();
                // Move the slot's owner ref out; `connect` derefs it after
                // retagging the owner to the reusing client.
                let owner_ref = socket.owner_ref.take();
                // SAFETY: `socket_ptr` is a fully-initialized hive slot; the
                // owned-heap fields (ssl_config/tunnel/target_hostname/
                // h2_session/owner_ref) were just moved out / cleared, so the
                // in-place drop in `put` touches only trivially-droppable
                // residuals.
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
                    owner: owner_ref,
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
        let ssl_ctx = if SSL {
            self.ssl_ctx_for_connect()
        } else {
            None
        };
        let owner = SocketOwner::<SSL>::new_client(client);
        // Second ref so the owner-held handle can be stamped after connect
        // (connect_unix_owned transfers `owner` to the core ext).
        let owner_view = owner.clone();
        let socket = match HTTPSocket::<SSL>::connect_unix_owned(
            &mut self.group,
            Self::KIND,
            ssl_ctx,
            socket_path,
            owner,
            false, // dont allow half-open sockets
        ) {
            Ok(s) => s,
            Err(e) => {
                owner_view.deref();
                return Err(e.into());
            }
        };
        owner_view.data().socket.set(socket);
        owner_view.deref();
        client.allow_retry = false;
        Ok(Some(socket))
    }

    pub(crate) fn connect(
        &mut self,
        client: &mut HTTPClient,
        hostname_: &[u8],
        port: u16,
    ) -> Result<Option<HTTPSocket<SSL>>, Error> {
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
        // URL.hostname is a borrowed slice — assigning a local would not
        // satisfy the field's lifetime, so this uses raw lifetime erasure.
        client.connected_url.hostname =
            // SAFETY: hostname borrows either a static literal or `client.url`/
            // `client.http_proxy` which outlive `connected_url` for the
            // duration of the connect attempt.
            unsafe { bun_ptr::detach_lifetime(hostname) };

        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref());
                let host_header_hash = client.proxy_auth_hash();
                for &session in &self.active_h2_sessions {
                    // Active sessions are kept alive by registry refs; `&mut`
                    // is unique here (registry is iterated read-only and
                    // adopt() does not reenter the registry). Route through
                    // the centralised [`h2_session_as_mut`] accessor — same
                    // strong-ref-held invariant as the pool/found-slot cases.
                    let s = h2_session_as_mut(NonNull::new(session)).unwrap();
                    if s.has_headroom()
                        && s.matches(hostname, port, cfg, host_header_hash)
                        // Same guard as the pool path: a session whose TLS
                        // handshake ran with reject_unauthorized=false never
                        // validated the peer hostname, so a strict caller
                        // must not multiplex onto it.
                        && (!client.flags.reject_unauthorized
                            || s.established_with_reject_unauthorized)
                    {
                        s.adopt(client);
                        return Ok(None);
                    }
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in &mut self.pending_h2_connects {
                    // Same strictness guard as the active-session loop above: a
                    // strict caller must not coalesce onto an in-flight connect
                    // that was initiated with reject_unauthorized=false, since
                    // the resulting session won't have validated the peer.
                    if pc.matches(hostname, port, cfg_nn, host_header_hash)
                        && (!client.flags.reject_unauthorized || pc.reject_unauthorized)
                    {
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
            // For a direct TLS connection the handshake verifies the peer
            // against get_tls_hostname() — which prefers the Host-header
            // override (client.hostname) over url.hostname — so the override
            // must discriminate the pool key there too, not just for CONNECT
            // tunnels. proxy_auth_hash() reduces to exactly the override hash
            // (or 0) for a non-proxied request.
            let proxy_auth_hash: u64 = if want_tunnel || (SSL && client.http_proxy.is_none()) {
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
                if let Some(o) = found.owner.take() {
                    // Retag the parked owner to the new client and refresh its
                    // held handle, then release the pool's ref (the core ext
                    // ref keeps the owner alive while the socket lives).
                    o.data()
                        .state
                        .set(ActiveSocket::Client(client.as_erased_ptr()));
                    o.data().socket.set(sock);
                    o.deref();
                } else {
                    Self::set_state(sock, ActiveSocket::Client(client.as_erased_ptr()));
                }
                client.allow_retry = true;
                if let Some(session) = found.h2_session {
                    if SSL {
                        // Note: `session.socket = sock` — direct field
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

        let ssl_ctx = if SSL {
            self.ssl_ctx_for_connect()
        } else {
            None
        };
        let owner = SocketOwner::<SSL>::new_client(client);
        // Second ref so the owner-held handle can be stamped after connect
        // (connect_owned transfers `owner` to the core ext).
        let owner_view = owner.clone();
        let socket = match HTTPSocket::<SSL>::connect_owned(
            &mut self.group,
            Self::KIND,
            ssl_ctx,
            hostname,
            port as c_int,
            owner,
            false,
        ) {
            Ok(s) => s,
            Err(e) => {
                owner_view.deref();
                return Err(e.into());
            }
        };
        owner_view.data().socket.set(socket);
        owner_view.deref();
        client.allow_retry = false;
        if SSL {
            if client.can_offer_h2() {
                let cfg = SSLConfig::raw_ptr(client.tls_props.as_ref())
                    .and_then(|p| NonNull::new(p.cast_mut()));
                let mut pc = h2::PendingConnect::new(h2::PendingConnect {
                    hostname: Box::<[u8]>::from(hostname),
                    port,
                    ssl_config: cfg,
                    reject_unauthorized: client.flags.reject_unauthorized,
                    host_header_hash: client.proxy_auth_hash(),
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
        if SSL {
            if let Some(c) = self.secure {
                // SAFETY: we own one ref on the SSL_CTX.
                unsafe { bun_boringssl_sys::SSL_CTX_free(c) };
            }
        }
        // Note: `bun.default_allocator.destroy(this)` is the Box drop
        // performed by IntrusiveRc when refcount hits 0; not repeated here.
    }
}

/// Socket-event handlers, dispatched via [`HttpProtocol`]; the owner's
/// `state` enum selects the client / h2-session / pooled-slot recipient.
pub(crate) struct Handler<const SSL: bool>;

impl<const SSL: bool> Handler<SSL> {
    pub(crate) fn on_open(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        let active = owner.state.get();
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

    pub(crate) fn on_handshake(
        owner: &SocketOwner<SSL>,
        socket: HTTPSocket<SSL>,
        handshake_success: bool,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_error = HTTPCertError::from_verify_error(ssl_error);

        let active = owner.state.get();
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
                    // SAFETY: the native handle on a TLS socket is `*mut SSL`,
                    // live and non-null after the handshake completes.
                    let ssl = unsafe {
                        &mut *socket
                            .get_native_handle()
                            .expect("TLS socket has native handle after handshake")
                            .cast::<bun_boringssl_sys::SSL>()
                    };
                    if !client.check_server_identity::<SSL>(socket, handshake_error, ssl, true) {
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
                client.close_and_fail::<SSL>(crate::Error::ConnectionRefused, socket);
                return;
            }
        }

        if socket.is_closed() {
            HTTPContext::<SSL>::mark_owner_dead(owner);
            return;
        }

        if handshake_success {
            if matches!(active, ActiveSocket::Pooled(_)) {
                // Allow pooled sockets to be reused if the handshake was successful.
                socket.set_timeout(0);
                socket.set_timeout_minutes(5);
                return;
            }
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub(crate) fn on_close(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        let tagged = owner.state.get();
        HTTPContext::<SSL>::mark_owner_dead(owner);

        if let Some(client) = tagged.client_mut() {
            return client.on_close::<SSL>(socket);
        }
        if let Some(session) = tagged.session_mut() {
            return session.on_close(crate::Error::ConnectionClosed);
        }
        // Pooled/Dead: whoever retagged the owner should have unregistered;
        // sweep by pointer so a miss can't leave a stale entry for
        // `drain_queued_shutdowns` to hit on a later abort.
        crate::unregister_abort_tracker_for_socket(socket.socket);
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

    pub(crate) fn on_data(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>, buf: &[u8]) {
        let tagged = owner.state.get();
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
            HTTPContext::<SSL>::terminate_socket(socket);

            return;
        }
        bun_core::scoped_log!(HTTPContext, "Unexpected data on unknown socket");
        HTTPContext::<SSL>::terminate_socket(socket);
    }

    pub(crate) fn on_writable(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        let tagged = owner.state.get();
        if let Some(client) = tagged.client_mut() {
            return client.on_writable::<false, SSL>(socket);
        } else if let Some(session) = tagged.session_mut() {
            return session.on_writable();
        } else if matches!(tagged, ActiveSocket::Pooled(_)) {
            // it's a keep-alive socket
        } else {
            // don't know what this is, let's close it
            bun_core::scoped_log!(HTTPContext, "Unexpected writable on socket");
            HTTPContext::<SSL>::terminate_socket(socket);
        }
    }

    pub(crate) fn on_long_timeout(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        let tagged = owner.state.get();
        if let Some(client) = tagged.client_mut() {
            return client.on_timeout::<SSL>(socket);
        }
        if let Some(session) = tagged.session_mut() {
            HTTPContext::<SSL>::mark_owner_dead(owner);
            session.on_close(crate::Error::Timeout);
        }

        HTTPContext::<SSL>::terminate_socket(socket);
    }

    /// Short-tick (seconds-granularity) idle timer. Same handling as
    /// [`on_long_timeout`]; `HTTPClient::set_timeout` routes to whichever
    /// timer suits the configured duration, so both must dispatch.
    pub(crate) fn on_timeout(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        Self::on_long_timeout(owner, socket);
    }

    pub(crate) fn on_connect_error(owner: &SocketOwner<SSL>) {
        let socket = owner.socket.get();
        // Read before the close below: uSockets keeps the connecting socket
        // alive for the whole dispatch, and `dns_error()` is 0 for a socket
        // that failed after name resolution (v1 parity).
        let dns_error = socket.dns_error();
        if matches!(socket.socket, uws::InternalSocket::Connected(_)) {
            // Close-before-notify (v1 parity): a pre-open SEMI_SOCKET close
            // dispatches nothing (C1); the trampoline's dispatch guard keeps
            // `owner` alive even though the close releases core's ext ref.
            socket.close(uws::CloseKind::Failure);
        }
        let tagged = owner.state.get();
        HTTPContext::<SSL>::mark_owner_dead(owner);
        if let Some(client) = tagged.client_mut() {
            client.on_connect_error(dns_error);
        } else {
            // Same backstop as `on_close`: a SEMI_SOCKET/connecting socket
            // whose owner is no longer a client never dispatches `on_close`,
            // so sweep any leftover tracker entry here.
            crate::unregister_abort_tracker_for_socket(socket.socket);
        }
        // us_connecting_socket_close is always called internally by uSockets
    }

    pub(crate) fn on_end(owner: &SocketOwner<SSL>, socket: HTTPSocket<SSL>) {
        // TCP fin must be closed, but we must keep the original tagged
        // state so that their onClose callback is called.
        //
        // Four possible states:
        // 1. HTTP Keep-Alive socket: it must be removed from the pool
        // 2. HTTP Client socket: it might need to be retried
        // 3. HTTP/2 session: fail every stream on it
        // 4. Dead socket: it is already marked as dead
        let tagged = owner.state.get();
        HTTPContext::<SSL>::mark_owner_dead(owner);
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
        if let Some(session) = tagged.session_mut() {
            // An HTTP/2 session's streams may still be uploading; the same
            // undeliverable-bytes reasoning applies, and this matches the
            // pre-existing behaviour for this branch.
            socket.close(uws::CloseKind::Failure);
            session.on_close(crate::Error::ConnectionClosed);
            return;
        }
        socket.close(uws::CloseKind::Normal);
    }
}
