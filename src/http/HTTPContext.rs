use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use crate::http_thread::InitOpts as HTTPThreadInitOpts;
use crate::{
    self as http, AlpnOffer, HTTPCertError, HTTPClient, InitError, get_cert_error_from_no, h2,
};
use bun_boringssl::ssl_ctx_setup;
use bun_boringssl_sys::SSL_CTX;
use bun_collections::{HiveArray, TaggedPtrUnion};
use bun_core::{self, Error, FeatureFlags};
// TODO(port): SSLConfig arrives from move-in
// (MOVE_DOWN bun_runtime::api::server::server_config::SSLConfig → bun_http)
use crate::ssl_config::{self, SSLConfig};
use bun_core::strings;
use bun_uws as uws;

bun_core::declare_scope!(HTTPContext, hidden);

const POOL_SIZE: usize = 64;
const MAX_KEEPALIVE_HOSTNAME: usize = 128;

#[derive(bun_ptr::CellRefCounted)]
pub struct HTTPContext<const SSL: bool> {
    pub ref_count: Cell<u32>,
    pub pending_sockets: PooledSocketHiveAllocator<SSL>,
    pub group: uws::SocketGroup,
    /// `SSL_CTX*` built from this context's SSLConfig (or the default
    /// `request_cert=1` opts). One owned ref; `SSL_CTX_free` on deinit.
    /// Only meaningful when `SSL`.
    pub secure: Option<*mut SSL_CTX>,
    pub active_h2_sessions: Vec<*mut h2::ClientSession>,
    #[expect(clippy::vec_box)]
    pub pending_h2_connects: Vec<Box<h2::PendingConnect>>,
}

pub(crate) type HTTPContextRc<const SSL: bool> = bun_ptr::IntrusiveRc<HTTPContext<SSL>>;

pub(crate) type PooledSocketHiveAllocator<const SSL: bool> =
    HiveArray<PooledSocket<SSL>, POOL_SIZE>;

pub type HTTPSocket<const SSL: bool> = uws::SocketHandler<SSL>;

pub(crate) type ActiveSocket<const SSL: bool> = TaggedPtrUnion<ActiveSocketTypes<SSL>>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules (the `bun_ptr::impl_tagged_ptr_union!` macro impls on a tuple, which
/// is foreign even when every element is local).
pub(crate) struct ActiveSocketTypes<const SSL: bool>;

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

pub(crate) trait ActiveSocketExt<const SSL: bool>: Copy {
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
    pub established_with_reject_unauthorized: bool,
    /// The interned SSLConfig this socket was created with (None = default context).
    /// Owns a strong ref while the socket is in the keepalive pool.
    pub ssl_config: Option<ssl_config::SharedPtr>,
    /// The context that owns this pooled socket's memory (for returning to correct pool).
    pub owner: *mut HTTPContext<SSL>,
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

#[inline]
fn pooled_socket_mut<'a, const SSL: bool>(p: *mut PooledSocket<SSL>) -> &'a mut PooledSocket<SSL> {
    // SAFETY: see INVARIANT above.
    unsafe { &mut *p }
}

impl<const SSL: bool> PooledSocket<SSL> {
    #[inline]
    pub(crate) fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
        h2_session_as_mut(self.h2_session)
    }

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
    #[inline]
    fn h2_session_mut(&mut self) -> Option<&mut h2::ClientSession> {
        h2_session_as_mut(self.h2_session)
    }
}

pub type ActiveSocketHandler<const SSL: bool> = Handler<SSL>;

impl<const SSL: bool> HTTPContext<SSL> {
    pub(crate) const KIND: uws::SocketKind = if SSL {
        uws::SocketKind::HttpClientTls
    } else {
        uws::SocketKind::HttpClient
    };

    pub(crate) fn mark_tagged_socket_as_dead(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
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

    #[inline]
    pub(crate) fn set_socket_ext(socket: HTTPSocket<SSL>, tagged: ActiveSocket<SSL>) {
        if let Some(slot) = socket.ext::<*mut c_void>() {
            // SAFETY: see INVARIANT above.
            unsafe { *slot = tagged.ptr() };
        }
    }

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
        // PORT NOTE: `session.ref()` — intrusive refcount bump.
        s.ref_();
        s.set_registry_index(u32::try_from(self.active_h2_sessions.len()).expect("int cast"));
        self.active_h2_sessions.push(session);
    }

    pub(crate) fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
        if !SSL {
            return false;
        }
        for pc in &mut self.pending_h2_connects {
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
        Self::set_socket_ext(socket, ActiveSocket::<SSL>::init(session));
    }

    pub(crate) fn ssl_ctx(&self) -> *mut SSL_CTX {
        if !SSL {
            unreachable!();
        }
        self.secure.unwrap()
    }

    pub(crate) fn init_with_client_config(
        &mut self,
        client: &mut HTTPClient,
    ) -> Result<(), InitError> {
        // TODO(port): `if (!comptime ssl) @compileError("ssl only")` — Rust
        // cannot @compileError on a const-generic bool branch without nightly;
        // debug_assert until the SSL/non-SSL impls are split.
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
            if let Some(slot) = self.pending_sockets.claim() {
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
            } else if SSL && reject_unauthorized && !socket.established_with_reject_unauthorized {
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

    pub(crate) fn connect_socket(
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

    pub(crate) fn connect(
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
                let host_header_hash = client.proxy_auth_hash();
                for &session in &self.active_h2_sessions {
                    let s = h2_session_as_mut(NonNull::new(session)).unwrap();
                    if s.has_headroom()
                        && s.matches(hostname, port, cfg, host_header_hash)
                        && (!client.flags.reject_unauthorized
                            || s.established_with_reject_unauthorized)
                    {
                        s.adopt(client);
                        return Ok(None);
                    }
                }
                let cfg_nn = cfg.and_then(|p| NonNull::new(p.cast_mut()));
                for pc in &mut self.pending_h2_connects {
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
                    reject_unauthorized: client.flags.reject_unauthorized,
                    host_header_hash: client.proxy_auth_hash(),
                    ..Default::default()
                });
                client.pending_h2 = Some(NonNull::from(&mut *pc));
                self.pending_h2_connects.push(pc);
            }
        }
        Ok(Some(socket))
    }
}

impl<const SSL: bool> Drop for HTTPContext<SSL> {
    fn drop(&mut self) {
        {
            let mut iter = self.pending_sockets.used.iterator::<true, true>();
            while let Some(idx) = iter.next() {
                let pooled_ptr = self
                    .pending_sockets
                    .at(u16::try_from(idx).expect("int cast"));
                let pooled = pooled_socket_mut(pooled_ptr);
                pooled.release_parked_refs();
                pooled.http_socket.close(uws::CloseKind::Failure);
            }
        }

        // PORT NOTE: Vec drop subsumes `active_h2_sessions.deinit()`.
        // PORT NOTE: Box<PendingConnect> Drop subsumes `pc.deinit()`; Vec drop
        // subsumes `pending_h2_connects.deinit()`.

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
                    // SAFETY: the native handle on a TLS socket is `*mut SSL`,
                    // live and non-null after the handshake completes.
                    let ssl = unsafe {
                        &mut *socket
                            .get_native_handle()
                            .expect("TLS socket has native handle after handshake")
                            .cast::<bun_boringssl_sys::SSL>()
                    };
                    if !client.check_server_identity::<SSL>(socket, handshake_error, ssl, true) {
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
pub(crate) struct DeadSocket {
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
