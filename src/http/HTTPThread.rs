use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::time::Instant;

use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::ArrayHashMap;
use bun_core::{self, Output};
use bun_errno::SystemErrno;
use bun_ptr::RefPtr;
use bun_threading::{Guarded, UnboundedQueue};
use bun_uws as uws;

use crate::async_http::{ACTIVE_REQUESTS_COUNT, MAX_SIMULTANEOUS_REQUESTS};
use crate::http_context::ActiveSocketExt;
use crate::ssl_config::{self, SSLConfig};
use crate::{AsyncHttp, HTTPContext, InFlightRequest, InitError, NewHttpContext, h2, h3};

// The scope registry keys on name, so the two visibilities (.hidden +
// .visible) are split into two scope names.
bun_core::declare_scope!(HTTPThread, hidden); // threadlog
bun_core::declare_scope!(HTTPThread_log, visible); // log

/// SSL context cache keyed by interned SSLConfig pointer.
/// Since configs are interned via `ssl_config::global_registry`, pointer
/// equality is sufficient for lookup. Each entry holds a ref on its SSLConfig.
struct SslContextCacheEntry {
    ctx: RefPtr<NewHttpContext<true>>,
    last_used_ns: u64,
    /// Strong ref held by the cache entry (released on eviction).
    _config_ref: ssl_config::SharedPtr,
}

impl SslContextCacheEntry {
    /// Mutable access to the cached `NewHttpContext`. The map and all callers
    /// are HTTP-thread-only, so the returned `&mut` is the sole live borrow.
    #[inline]
    fn ctx_mut<'a>(&self) -> &'a mut NewHttpContext<true> {
        // SAFETY: see above.
        unsafe { &mut *self.ctx.as_ptr() }
    }
}
const SSL_CONTEXT_CACHE_MAX_SIZE: usize = 60;
const SSL_CONTEXT_CACHE_TTL_NS: u64 = 30 * (60 * 1_000_000_000); // 30 minutes

// PORTING.md §Global mutable state: only ever accessed from the single HTTP
// client thread after `on_start`. RacyCell — thread affinity is the contract.
static CUSTOM_SSL_CONTEXT_MAP: bun_core::RacyCell<
    Option<ArrayHashMap<*const SSLConfig, SslContextCacheEntry>>,
> = bun_core::RacyCell::new(None);
/// Borrow the (lazily-initialized) SSL-context cache. PORTING.md §Global
/// mutable state: only ever accessed from the single HTTP client thread after
/// `on_start`, so the `&'static mut` is the unique live borrow at every call
/// site (callers must not hold the result across a call that re-enters this
/// accessor; the prior `*mut` API enforced the same per-statement reborrow
/// shape).
fn custom_ssl_context_map() -> &'static mut ArrayHashMap<*const SSLConfig, SslContextCacheEntry> {
    // SAFETY: HTTP-thread-only; initialized on first call. Every call site is
    // a per-statement reborrow (audited in r3), so no two `&mut` overlap.
    unsafe { (*CUSTOM_SSL_CONTEXT_MAP.get()).get_or_insert_with(ArrayHashMap::new) }
}

use bun_event_loop::MiniEventLoop as mini_event_loop;
use bun_event_loop::MiniEventLoop::MiniEventLoop;

/// The HTTP thread's state that other threads touch.
struct Inbox {
    /// The uSockets loop of the HTTP thread, null until it has started.
    uws_loop: AtomicPtr<uws::Loop>,
    tasks: Queue,
    shutdowns: Guarded<Vec<ShutdownMessage>>,
    writes: Guarded<Vec<WriteMessage>>,
    receive_resumes: Guarded<Vec<u32>>,
    cert_check_resumes: Guarded<Vec<CertCheckResumeMessage>>,
    /// `PoolOptions::id`s whose idle connections to close.
    pool_closes: Guarded<Vec<u64>>,
    /// Lets a tick skip the lock.
    has_pool_closes: AtomicBool,
}

static INBOX: Inbox = Inbox {
    uws_loop: AtomicPtr::new(core::ptr::null_mut()),
    tasks: Queue::new(),
    shutdowns: Guarded::new(Vec::new()),
    writes: Guarded::new(Vec::new()),
    receive_resumes: Guarded::new(Vec::new()),
    cert_check_resumes: Guarded::new(Vec::new()),
    pool_closes: Guarded::new(Vec::new()),
    has_pool_closes: AtomicBool::new(false),
};

pub struct HttpThread {
    pub(crate) http_context: NewHttpContext<false>,
    pub(crate) https_context: NewHttpContext<true>,
    /// Stashed `InitOpts` for the default HTTPS context. When the user passed
    /// no explicit CA config, `on_start` defers
    /// `https_context.init_with_thread_opts` (which calls
    /// `us_ssl_ctx_from_options` → `us_get_default_ca_store`) until the first
    /// use, in [`HttpThread::ensure_https_context_init`]. A
    /// fully-cached `bun install` never makes one, so the cost is skipped
    /// entirely. If `--cafile` / `--ca` *was* passed, `on_start` still runs
    /// init eagerly so a bad CA file crashes at thread start (the long-standing
    /// test contract) and this stays `None`. HTTP-thread-only after `on_start`;
    /// `Option::take` is the once-guard (no atomics needed — `connect` is never
    /// reentrant).
    lazy_https_init: Option<InitOpts>,

    /// Tasks popped from `INBOX.tasks` that couldn't start because
    /// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
    /// and processed before `INBOX.tasks` on the next `drainEvents`. Owned by
    /// the HTTP thread; never accessed concurrently.
    // `Box` is load-bearing: `schedule` and the result callback pass `Box<AsyncHTTP>`.
    #[expect(clippy::vec_box)]
    deferred_tasks: Vec<Box<AsyncHttp<'static>>>,
    /// Set by `drainQueuedShutdowns` when a shutdown's `async_http_id` wasn't in
    /// `socket_async_http_abort_tracker` — the request is either not yet started
    /// (still in `INBOX.tasks`/`deferred_tasks`) or already done. `drainEvents`
    /// uses this to decide whether it must scan the queued/deferred lists for
    /// aborted tasks when `active >= max`; without it the common at-capacity
    /// path stays O(1). Owned by the HTTP thread.
    pub(crate) has_pending_queued_abort: bool,

    /// Custom TLS contexts with no ref left, see
    /// `HTTPContext::destroy_between_ticks`.
    pub(crate) dead_ssl_contexts: Vec<NonNull<NewHttpContext<true>>>,

    pub(crate) timer: Instant,
    pub(crate) lazy_libdeflater: Option<LibdeflateState>,

    /// What each `InFlightRequest` owns, for `dealloc_in_flight_for_exit`.
    pub(crate) in_flight: Vec<NonNull<AsyncHttp<'static>>>,
    /// By `async_http_id`: requests that left their transport with a body still to decode.
    pub(crate) held_bodies: ArrayHashMap<u32, InFlightRequest>,
}

impl HttpThread {
    fn new() -> Self {
        Self {
            http_context: NewHttpContext::<false> {
                ref_count: Cell::new(1),
                pending_sockets: crate::http_context::LazyPool::new(),
                pending_unix_sockets: crate::http_context::LazyPool::new(),
                park_seq: 0,
                group: uws::SocketGroup::default(),
                secure: None,
                active_h2_sessions: Vec::new(),
                pending_h2_connects: Vec::new(),
                session_cache: crate::session_cache::SessionCache::new(),
            },
            https_context: NewHttpContext::<true> {
                ref_count: Cell::new(1),
                pending_sockets: crate::http_context::LazyPool::new(),
                pending_unix_sockets: crate::http_context::LazyPool::new(),
                park_seq: 0,
                group: uws::SocketGroup::default(),
                secure: None,
                active_h2_sessions: Vec::new(),
                pending_h2_connects: Vec::new(),
                session_cache: crate::session_cache::SessionCache::new(),
            },
            lazy_https_init: None,
            deferred_tasks: Vec::new(),
            has_pending_queued_abort: false,
            dead_ssl_contexts: Vec::new(),
            timer: Instant::now(),
            lazy_libdeflater: None,
            in_flight: Vec::new(),
            held_bodies: ArrayHashMap::new(),
        }
    }
}

/// Initial capacity of the `Vec` the request head (plus as much body as fits) is assembled into.
pub(crate) fn request_body_send_buffer_capacity(estimated_size: usize) -> usize {
    const SMALL: usize = 32 * 1024;
    const LARGE: usize = 512 * 1024;
    if estimated_size >= SMALL {
        LARGE
    } else {
        SMALL
    }
}

struct WriteMessage {
    async_http_id: u32,
    kind: WriteMessageType,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum WriteMessageType {
    Data = 0,
    End = 1,
    /// The stream body broke its declared Content-Length; a no-op once that body was dropped.
    LengthMismatch = 2,
}

struct ShutdownMessage {
    async_http_id: u32,
}

/// The JS thread's `checkServerIdentity` callback approved the peer
/// certificate; un-park the connection so the request is written.
struct CertCheckResumeMessage {
    async_http_id: u32,
}

pub(crate) const LIBDEFLATE_SHARED_BUFFER_LEN: usize = 512 * 1024;

pub struct LibdeflateState {
    pub(crate) compressor: bun_deflate::Compressor,
    pub(crate) shared_buffer: Box<[u8; LIBDEFLATE_SHARED_BUFFER_LEN]>,
}

pub(crate) type Queue = UnboundedQueue<AsyncHttp<'static>>;

// Clone: bitwise OK for the `*const c_void` CA-string pointers — they borrow
// caller-owned config, not heap we free. The `Vec` itself
// deep-clones its slot list.
#[derive(Clone)]
pub struct InitOpts {
    // NUL-terminated C strings borrowed from caller config; the pointers are
    // copied into the spawned thread and only read there (see the Send SAFETY note).
    pub ca: Vec<*const c_void>, // *const [*:0]const u8
    pub abs_ca_file_name: &'static bun_core::ZStr,

    pub on_init_error: fn(err: InitError, opts: &InitOpts) -> !,
}

// SAFETY: `ca` holds borrowed NUL-terminated C-string pointers from caller
// config. They are copied into the spawned HTTP thread and
// only read there; no shared mutable state crosses the thread boundary.
unsafe impl Send for InitOpts {}

impl Default for InitOpts {
    fn default() -> Self {
        Self {
            ca: Vec::new(),
            abs_ca_file_name: bun_core::ZStr::EMPTY,
            on_init_error: on_init_error_noop,
        }
    }
}

fn on_init_error_noop(err: InitError, opts: &InitOpts) -> ! {
    match err {
        InitError::LoadCAFile => {
            if !bun_sys::exists_z(opts.abs_ca_file_name) {
                Output::err(
                    "HTTPThread",
                    "failed to find CA file: '{}'",
                    (bstr::BStr::new(opts.abs_ca_file_name),),
                );
            } else {
                Output::err(
                    "HTTPThread",
                    "failed to load CA file: '{}'",
                    (bstr::BStr::new(opts.abs_ca_file_name),),
                );
            }
        }
        InitError::InvalidCAFile => {
            Output::err(
                "HTTPThread",
                "the CA file is invalid: '{}'",
                (bstr::BStr::new(opts.abs_ca_file_name),),
            );
        }
        InitError::InvalidCA => {
            Output::err("HTTPThread", "the provided CA is invalid", ());
        }
        InitError::InvalidCRL => {
            Output::err("HTTPThread", "the provided CRL is invalid", ());
        }
        InitError::FailedToOpenSocket => {
            bun_core::err_generic!("failed to start HTTP client thread");
        }
    }
    bun_core::Global::crash();
}

impl HttpThread {
    /// `Instant::elapsed().as_nanos()` is u128; checked narrow to u64 —
    /// overflows only after ~584 years of process uptime.
    #[inline]
    fn timer_read(&self) -> u64 {
        u64::try_from(self.timer.elapsed().as_nanos()).expect("int cast")
    }

    pub(crate) fn deflater(&mut self) -> &mut LibdeflateState {
        self.lazy_libdeflater
            .get_or_insert_with(|| LibdeflateState {
                compressor: Default::default(),
                shared_buffer: bun_core::boxed_zeroed(),
            })
    }

    pub(crate) fn context<const IS_SSL: bool>(&mut self) -> &mut NewHttpContext<IS_SSL> {
        // Note: const-generic dispatch over two distinct fields — `NewHttpContext<true>`
        // and `NewHttpContext<IS_SSL>` are the same type when IS_SSL, just spelled
        // differently. Route through a raw-pointer `.cast()` (identity).
        if IS_SSL {
            // SAFETY: identical type when IS_SSL == true; pointer is to a live `&mut self` field.
            unsafe { &mut *(&raw mut self.https_context).cast::<NewHttpContext<IS_SSL>>() }
        } else {
            // SAFETY: identical type when IS_SSL == false; pointer is to a live `&mut self` field.
            unsafe { &mut *(&raw mut self.http_context).cast::<NewHttpContext<IS_SSL>>() }
        }
    }

    /// One-shot lazy init of the default HTTPS context. See
    /// [`HttpThread::lazy_https_init`] for rationale. Called on the HTTP
    /// thread by `connect::<true>` and `default_ssl_ctx`; the `Option::take`
    /// is the once-guard. On failure, `on_init_error` diverges.
    #[inline]
    fn ensure_https_context_init(&mut self) {
        if let Some(opts) = self.lazy_https_init.take() {
            self.init_https_context_cold(&opts);
        }
    }

    #[cold]
    fn init_https_context_cold(&mut self, opts: &InitOpts) {
        if let Err(err) = self.https_context.init_with_thread_opts(opts) {
            (opts.on_init_error)(err, opts);
        }
    }

    /// A new reference to the default HTTPS context's `SSL_CTX`, which holds the CA options of [`InitOpts`].
    pub(crate) fn default_ssl_ctx(&mut self) -> OwnedSslCtx {
        self.ensure_https_context_init();
        self.https_context
            .secure
            .clone()
            .expect("init_with_thread_opts sets `secure` or diverges")
    }

    pub(crate) fn connect<const IS_SSL: bool>(&mut self, mut client: InFlightRequest) {
        if IS_SSL {
            // First SSL connect: materialize the default HTTPS `SSL_CTX` +
            // socket group now (deferred from `on_start`). Runs once; every
            // SSL socket — including unix-socket and proxy paths below —
            // funnels through here before touching `https_context.{group,secure}`.
            self.ensure_https_context_init();

            'custom_ctx: {
                let Some(tls) = client.tls_props.clone() else {
                    break 'custom_ctx;
                };
                if !tls.get().requires_custom_request_ctx {
                    break 'custom_ctx;
                }
                let requested_config: *const SSLConfig = tls.get();

                // Evict stale entries from the cache
                self.evict_stale_ssl_contexts();

                // Look up by pointer equality (configs are interned)
                if let Some(entry) = custom_ssl_context_map().get_mut(&requested_config) {
                    // Cache hit - reuse existing SSL context
                    entry.last_used_ns = self.timer_read();
                    client.set_custom_ssl_ctx(entry.ctx.clone());
                    return Self::dial(entry.ctx_mut(), client);
                }

                // Cache miss - create new SSL context
                let ctx = RefPtr::new(NewHttpContext::<true> {
                    ref_count: Cell::new(1),
                    pending_sockets: crate::http_context::LazyPool::new(),
                    pending_unix_sockets: crate::http_context::LazyPool::new(),
                    park_seq: 0,
                    group: uws::SocketGroup::default(),
                    secure: None,
                    active_h2_sessions: Vec::new(),
                    pending_h2_connects: Vec::new(),
                    session_cache: crate::session_cache::SessionCache::new(),
                });
                // SAFETY: fresh allocation; HTTP-thread-only.
                let custom_context = unsafe { &mut *ctx.as_ptr() };
                if let Err(err) = custom_context.init_with_client_config(&mut client) {
                    // `init_with_client_config` fails before `group.init()` runs.
                    // `impl Drop for HTTPContext` tolerates an uninitialized
                    // group (skips close_all when `group.loop_` is
                    // null), so dropping `ctx` here is safe.
                    return client.fail(match err {
                        InitError::InvalidCRL => crate::Error::InvalidCRL,
                        InitError::FailedToOpenSocket
                        | InitError::InvalidCA
                        | InitError::InvalidCAFile
                        | InitError::LoadCAFile => crate::Error::FailedToOpenSocket,
                    });
                }

                let now = self.timer_read();
                client.set_custom_ssl_ctx(ctx.clone());
                let _ = custom_ssl_context_map().put(
                    requested_config,
                    SslContextCacheEntry {
                        ctx,
                        last_used_ns: now,
                        // Strong ref for the cache entry; client.tls_props keeps its own.
                        _config_ref: tls,
                    },
                );

                // Enforce max cache size - evict oldest entry
                if custom_ssl_context_map().count() > SSL_CONTEXT_CACHE_MAX_SIZE {
                    evict_oldest_ssl_context();
                }

                return Self::dial(custom_context, client);
            }
        }
        Self::dial(self.context::<IS_SSL>(), client)
    }

    /// Open the connection for `client` on `ctx`: unix path, HTTP proxy, or direct.
    fn dial<const IS_SSL: bool>(ctx: &mut NewHttpContext<IS_SSL>, mut client: InFlightRequest) {
        client.connected_url = client
            .http_proxy
            .clone()
            .unwrap_or_else(|| client.url.clone());
        if !client.unix_socket_path.is_empty() {
            return ctx.connect_socket(client);
        }
        if let Some(url) = &client.http_proxy {
            if !url.href.is_empty() {
                // https://github.com/oven-sh/bun/issues/11343
                if url.protocol.is_empty() || url.has_http_like_protocol() {
                    let port = url.get_port_auto();
                    return ctx.connect(client, port);
                }
                return client.fail(crate::Error::UnsupportedProxyProtocol);
            }
        }
        // The hostname is passed to the socket layer as a C string, so it must not contain a NUL.
        if let Err(err) = crate::validate_request_target(client.url.hostname) {
            return client.fail(err);
        }
        client.connected_url.hostname = client.url.hostname;
        let port = client.url.get_port_auto();
        ctx.connect(client, port);
    }

    /// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
    fn evict_stale_ssl_contexts(&mut self) {
        let now = self.timer_read();
        let map = custom_ssl_context_map();
        let mut i: usize = 0;
        while i < map.count() {
            let entry_last_used = map.values()[i].last_used_ns;
            if now.saturating_sub(entry_last_used) > SSL_CONTEXT_CACHE_TTL_NS {
                map.swap_remove_at(i);
            } else {
                i += 1;
            }
        }
    }

    fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
        if self.https_context.abort_pending_h2_waiter(async_http_id) {
            return true;
        }
        for entry in custom_ssl_context_map().values_mut() {
            if entry.ctx_mut().abort_pending_h2_waiter(async_http_id) {
                return true;
            }
        }
        false
    }

    fn drain_queued_shutdowns(&mut self) {
        loop {
            // socket.close() can potentially be slow
            // Let's not block other threads while this runs.
            let queued_shutdowns = core::mem::take(&mut *INBOX.shutdowns.lock());

            for http in &queued_shutdowns {
                let tracker = abort_tracker();
                let found_idx = tracker.keys().iter().position(|&k| k == http.async_http_id);
                if let Some(idx) = found_idx {
                    let (_k, socket_ptr) = tracker.swap_remove_at(idx);
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            // If we only call socket.close(), then it won't
                            // call `onClose` if this happens before `onOpen` is
                            // called.
                            let tagged =
                                HTTPContext::enter_client(socket, |c| c.close_and_abort(socket));
                            let Some(tagged) = tagged else { continue };
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::abort_by_http_id(session, http.async_http_id);
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged =
                                HTTPContext::enter_client(socket, |c| c.close_and_abort(socket));
                            let Some(tagged) = tagged else { continue };
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::abort_by_http_id(session, http.async_http_id);
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                    }
                } else if let Some(held) = InFlightRequest::take_held(http.async_http_id) {
                    held.fail(crate::Error::Aborted);
                } else {
                    // No socket for this id. It may be a request coalesced onto a
                    // leader's in-flight h2 TLS connect (parked in `pc.waiters`
                    // with no abort-tracker entry); scan those first so the abort
                    // doesn't wait for the leader's connect to resolve.
                    if self.abort_pending_h2_waiter(http.async_http_id) {
                        continue;
                    }
                    // Or it's on an HTTP/3 session, which has no TCP socket to
                    // register in the tracker.
                    if h3::ClientContext::abort_by_http_id(http.async_http_id) {
                        continue;
                    }
                    // Otherwise the request either hasn't started yet (still in
                    // `INBOX.tasks`/`deferred_tasks`) or has already completed.
                    // Flag it so `drainEvents` knows to scan the queue for
                    // aborted-but-unstarted tasks even when `active >= max`
                    // would otherwise short-circuit.
                    self.has_pending_queued_abort = true;
                }
            }
            let len = queued_shutdowns.len();
            drop(queued_shutdowns);
            if len == 0 {
                break;
            }
            bun_core::scoped_log!(HTTPThread, "drained {} queued shutdowns", len);
        }
    }

    fn drain_queued_writes(&mut self) {
        loop {
            let queued_writes = core::mem::take(&mut *INBOX.writes.lock());
            for write in &queued_writes {
                let message = write.kind;

                if let Some(socket_ptr) = abort_tracker().get(&write.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::enter_client(socket, |client| {
                                client.on_request_stream_message::<true>(message, socket)
                            });
                            if let Some(session) = tagged.and_then(ActiveSocketExt::session) {
                                h2::ClientSession::stream_body_by_http_id(
                                    session,
                                    write.async_http_id,
                                    message,
                                );
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::enter_client(socket, |client| {
                                client.on_request_stream_message::<false>(message, socket)
                            });
                            if let Some(session) = tagged.and_then(ActiveSocketExt::session) {
                                h2::ClientSession::stream_body_by_http_id(
                                    session,
                                    write.async_http_id,
                                    message,
                                );
                            }
                        }
                    }
                } else {
                    h3::ClientContext::stream_body_by_http_id(write.async_http_id, message);
                }
            }
            let len = queued_writes.len();
            drop(queued_writes);
            if len == 0 {
                break;
            }
            bun_core::scoped_log!(HTTPThread, "drained {} queued writes", len);
        }
    }

    fn drain_queued_cert_check_resumes(&mut self) {
        loop {
            let queued_cert_check_resumes = core::mem::take(&mut *INBOX.cert_check_resumes.lock());
            for resume in &queued_cert_check_resumes {
                // Both arms are required: an HTTPS target behind a plaintext
                // proxy parks behind a SocketTcp tracker entry.
                if let Some(socket_ptr) = abort_tracker().get(&resume.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            HTTPContext::enter_client(socket, |client| {
                                client.resume_after_cert_check::<true>(socket)
                            });
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            HTTPContext::enter_client(socket, |client| {
                                client.resume_after_cert_check::<false>(socket)
                            });
                        }
                    }
                }
            }
            let len = queued_cert_check_resumes.len();
            drop(queued_cert_check_resumes);
            if len == 0 {
                break;
            }
            bun_core::scoped_log!(HTTPThread, "drained {} queued cert check resumes", len);
        }
    }

    fn drain_queued_pool_closes(&mut self) {
        // Read before writing so an idle tick leaves the cache line shared. The
        // flag is a hint: the queue is published by its lock, and the producer
        // wakes the loop after raising the flag.
        while INBOX.has_pool_closes.load(Ordering::Relaxed)
            && INBOX.has_pool_closes.swap(false, Ordering::Acquire)
        {
            let queued = core::mem::take(&mut *INBOX.pool_closes.lock());
            for pool_id in queued {
                self.http_context.close_idle_sockets(pool_id);
                self.https_context.close_idle_sockets(pool_id);
                for entry in custom_ssl_context_map().values_mut() {
                    entry.ctx_mut().close_idle_sockets(pool_id);
                }
                h3::ClientContext::close_idle_sessions(pool_id);
            }
        }
    }

    /// One resume per request. A resume can queue the next one, which waits for the next turn.
    fn drain_queued_receive_resumes(&mut self) {
        let mut queued = core::mem::take(&mut *INBOX.receive_resumes.lock());
        queued.sort_unstable();
        queued.dedup();
        for id in queued {
            if let Some(socket_ptr) = abort_tracker().get(&id) {
                let session = match *socket_ptr {
                    uws::AnySocket::SocketTls(socket) => {
                        HTTPContext::enter_client(socket, |c| c.resume_receive(socket))
                            .and_then(ActiveSocketExt::session)
                    }
                    uws::AnySocket::SocketTcp(socket) => {
                        HTTPContext::enter_client(socket, |c| c.resume_receive(socket))
                            .and_then(ActiveSocketExt::session)
                    }
                };
                if let Some(session) = session {
                    h2::ClientSession::resume_receive_by_http_id(session, id);
                }
            } else if let Some(held) = InFlightRequest::take_held(id) {
                held.resume_held();
            } else {
                h3::ClientContext::resume_receive_by_http_id(id);
            }
        }
    }

    /// Parks a request that found every connection taken. Parked requests start in the order they
    /// came, except that the ones with `yields_to_other_requests` start after all the others.
    fn defer(&mut self, http: Box<AsyncHttp<'static>>) {
        let yields = |http: &AsyncHttp<'static>| http.client.flags.yields_to_other_requests;
        // The list keeps the requests that yield at its end, so the last one tells if there are any.
        if yields(&http) || !self.deferred_tasks.last().is_some_and(|last| yields(last)) {
            self.deferred_tasks.push(http);
            return;
        }
        let first_that_yields = self
            .deferred_tasks
            .partition_point(|parked| !yields(parked));
        self.deferred_tasks.insert(first_that_yields, http);
    }

    pub(crate) fn drain_events(&mut self) {
        // Process any pending writes **before** aborting.
        self.drain_queued_receive_resumes();
        self.drain_queued_writes();
        self.drain_queued_shutdowns();
        // After shutdowns: an abort or cert-rejection scheduled in the same JS
        // turn removes the abort-tracker entry first, so the resume becomes a
        // no-op and the request is never transmitted after a same-tick abort.
        self.drain_queued_cert_check_resumes();
        self.drain_queued_pool_closes();
        h3::PendingConnect::drain_resolved();

        let mut count: usize = 0;
        let mut active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
        let max = MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed);

        // Fast path: at capacity and no queued/deferred task could possibly be
        // aborted. A queued task can only become aborted via `scheduleShutdown`,
        // which we just drained — `drainQueuedShutdowns` sets
        // `has_pending_queued_abort` for any id it couldn't find in the socket
        // tracker. If that's clear, there's nothing to fail-fast and nothing can
        // start, so don't walk the lists.
        if active >= max && !self.has_pending_queued_abort {
            return;
        }

        // Deferred tasks are ones we previously popped from the MPSC queue but
        // couldn't start because we were at max. They stay in FIFO order ahead of
        // anything still in `INBOX.tasks`.
        //
        // Already-aborted tasks are started regardless of `max`: `start_()` will
        // observe the `aborted` signal and fail immediately with
        // `error.AbortedBeforeConnecting`, and `InFlightRequest::finish` decrements
        // `active_requests_count` in the same turn — so they never hold a slot.
        // Without this, an aborted fetch that was queued behind `max` would sit
        // there until some unrelated request completed; if every active request
        // is itself hung, the aborted one never settles and its promise hangs
        // forever even though the user called `controller.abort()`.
        //
        // `InFlightRequest::start` can reach `finish` synchronously (for
        // aborted tasks, or when connect() fails immediately), which reads both
        // `active_requests_count` and `deferred_tasks.items.len` to decide whether
        // to wake the loop. To keep those reads accurate we swap the deferred list
        // out before iterating so the field reflects only tasks still waiting, and
        // reload `active` from the atomic after every start rather than tracking
        // it locally.
        self.has_pending_queued_abort = false;
        {
            let pending = core::mem::take(&mut self.deferred_tasks);
            for http in pending {
                let aborted = http.client.signals.get(crate::signals::Field::Aborted);
                if aborted || active < max {
                    InFlightRequest::start(http);
                    if cfg!(debug_assertions) {
                        count += 1;
                    }
                    active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
                } else {
                    self.deferred_tasks.push(http);
                }
            }
        }

        while let Some(http) = pop_queued_task() {
            let aborted = http.client.signals.get(crate::signals::Field::Aborted);
            if !aborted && active >= max {
                // Can't start this one yet. Defer it (preserves FIFO relative to
                // later pops) and keep draining — there may be aborted tasks
                // behind it that we can fail-fast right now.
                self.defer(http);
                continue;
            }
            InFlightRequest::start(http);
            if cfg!(debug_assertions) {
                count += 1;
            }
            active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
        }

        if cfg!(debug_assertions) && count > 0 {
            bun_core::scoped_log!(HTTPThread_log, "Processed {} tasks\n", count);
        }
    }

    pub(crate) fn has_unstarted_tasks(&self) -> bool {
        !INBOX.tasks.is_empty() || !self.deferred_tasks.is_empty()
    }

    pub fn schedule_receive_resume(async_http_id: u32) {
        {
            let mut queued = INBOX.receive_resumes.lock();
            if queued.last() == Some(&async_http_id) {
                return;
            }
            queued.push(async_http_id);
        }
        Self::wakeup();
    }

    pub fn schedule_shutdown(async_http_id: u32) {
        bun_core::scoped_log!(HTTPThread, "scheduleShutdown {}", async_http_id);
        INBOX
            .shutdowns
            .lock()
            .push(ShutdownMessage { async_http_id });
        Self::wakeup();
    }

    pub fn schedule_cert_check_resume(async_http_id: u32) {
        bun_core::scoped_log!(HTTPThread, "scheduleCertCheckResume {}", async_http_id);
        INBOX
            .cert_check_resumes
            .lock()
            .push(CertCheckResumeMessage { async_http_id });
        Self::wakeup();
    }

    /// Close the idle keep-alive connections of fetch session `pool_id`.
    pub fn schedule_pool_close(pool_id: u64) {
        INBOX.pool_closes.lock().push(pool_id);
        INBOX.has_pool_closes.store(true, Ordering::Release);
        Self::wakeup();
    }

    pub fn schedule_request_write(async_http_id: u32, kind: WriteMessageType) {
        INBOX.writes.lock().push(WriteMessage {
            async_http_id,
            kind,
        });
        Self::wakeup();
    }

    /// Everything this thread runs is inside `drain_events` or `tick`, and
    /// this runs between the two, so no socket callback is on the stack.
    fn free_dead_ssl_contexts(&mut self) {
        // One at a time: a context's `Drop` closes its sockets, and a close
        // handler is free to drop the last ref of another context.
        while let Some(ctx) = self.dead_ssl_contexts.pop() {
            // SAFETY: `HTTPContext::destroy_between_ticks` pushed it at
            // refcount zero, so this is the sole owner of the `RefPtr::new`
            // allocation.
            unsafe { bun_core::heap::destroy(ctx.as_ptr()) };
        }
    }

    /// Called from [`crate::shutdown_for_exit`] on the HTTP thread once
    /// `SHUTDOWN_REQUESTED` is observed. Frees every request. The
    /// result callback is not invoked (the JS thread is parked in
    /// `global_exit()` waiting on us and will not process the completion);
    /// only `release_at_shutdown` runs so the owner can drop the ref it
    /// took for the in-flight callback.
    fn dealloc_in_flight_for_exit(&mut self) {
        bun_core::scoped_log!(
            HTTPThread,
            "dealloc_in_flight_for_exit: in_flight={} deferred={}",
            self.in_flight.len(),
            self.deferred_tasks.len()
        );
        for http in core::mem::take(&mut self.deferred_tasks) {
            http.release_at_shutdown();
        }
        while let Some(http) = pop_queued_task() {
            http.release_at_shutdown();
        }
        for http in core::mem::take(&mut self.in_flight) {
            // SAFETY: from a `Box`. This thread parks for good, so its `InFlightRequest` is not used again.
            unsafe { bun_core::heap::take(http.as_ptr()) }.release_at_shutdown();
        }
    }

    pub(crate) fn wakeup() {
        let uws_loop = INBOX.uws_loop.load(Ordering::Acquire);
        if !uws_loop.is_null() {
            // SAFETY: uws_loop is the live HTTP-thread loop set in on_start.
            // This runs on another thread and `Loop` is `!Sync`, so pass the raw pointer.
            unsafe { uws::us_wakeup_loop(uws_loop) };
        }
    }

    /// Any thread. A request comes back through its last result callback.
    pub fn schedule(requests: impl IntoIterator<Item = Box<AsyncHttp<'static>>>) {
        let mut any = false;
        for http in requests {
            INBOX.tasks.push(bun_core::heap::into_raw_nn(http));
            any = true;
        }
        if any {
            assert!(is_initialized());
            Self::wakeup();
        }
    }
}

fn pop_queued_task() -> Option<Box<AsyncHttp<'static>>> {
    let http = NonNull::new(INBOX.tasks.pop())?;
    // SAFETY: a box that `schedule` leaked; a pop hands it to one caller.
    Some(unsafe { bun_core::heap::take(http.as_ptr()) })
}

/// Evict the least-recently-used SSL context cache entry.
fn evict_oldest_ssl_context() {
    let map = custom_ssl_context_map();
    if map.count() == 0 {
        return;
    }
    let mut oldest_idx: usize = 0;
    let mut oldest_time: u64 = u64::MAX;
    for (i, entry) in map.values().iter().enumerate() {
        if entry.last_used_ns < oldest_time {
            oldest_time = entry.last_used_ns;
            oldest_idx = i;
        }
    }
    map.swap_remove_at(oldest_idx);
}

/// Borrow the HTTP-thread abort tracker. PORTING.md §Global mutable state:
/// HTTP-thread-only, per-statement reborrow.
#[inline]
fn abort_tracker() -> &'static mut ArrayHashMap<u32, uws::AnySocket> {
    crate::abort_tracker()
}

/// Debug+ASAN invariant check: every socket pointer in the abort tracker must
/// point at live (unfreed) memory. A stale entry here means some socket-close
/// path forgot `unregister_abort_tracker`, which later manifests as a
/// use-after-free in `drain_queued_shutdowns`/`drain_queued_writes` when the
/// JS thread aborts that request id. Runs before and after each loop tick so
/// the report fires at the tick that leaked, not at the eventual abort.
#[inline]
fn assert_abort_tracker_sockets_alive() {
    if cfg!(debug_assertions) {
        for socket in abort_tracker().values() {
            if let Some(usocket) = socket.socket().get() {
                bun_core::asan::assert_unpoisoned(usocket);
            }
        }
    }
}

use core::cell::Cell;

// ═══════════════════════════════════════════════════════════════════════════
// init / on_start / process_events — uses `bun_event_loop::MiniEventLoop`
// (`on_start` calls
// `mini_event_loop::init_global` and drives the thread's event loop). The
// wakeup path above still uses the raw `*const uws::Loop` directly.
// ═══════════════════════════════════════════════════════════════════════════

mod _event_loop_draft {
    use super::*;
    use std::sync::Once;

    static INIT_ONCE: Once = Once::new();
    // Note: `Builder::spawn` allocates an `Arc<thread::Inner>` (48 B)
    // shared between the `JoinHandle` and the new thread's TLS `current()`.
    // Dropping the handle leaves the only strong ref inside the spawned
    // thread's TLS, which LSAN does not scan as a root — so when the main
    // thread reaches `Global::exit` *before* the HTTP thread has installed
    // that TLS slot, LSAN reports the Arc as a direct leak and (with CI's
    // `abort_on_error=1`) the process SIGABRTs (exit 134). Park the handle in
    // a process-lifetime static so the Arc is always reachable from a global
    // root, keeping detach semantics without the false positive.
    static HTTP_THREAD_HANDLE: std::sync::OnceLock<std::thread::JoinHandle<()>> =
        std::sync::OnceLock::new();

    pub(super) fn init(opts: &InitOpts) {
        INIT_ONCE.call_once(|| init_once(opts));
    }

    fn init_once(opts: &InitOpts) {
        // Initialize the global (with timer
        // started on the calling thread) BEFORE spawning, so `on_start`'s
        // `crate::http_thread()` finds it initialized and can fill in the contexts.
        // SAFETY: `init_once` runs under `Once`; only the thread spawned below
        // reads `HTTP_THREAD`.
        unsafe {
            (*crate::HTTP_THREAD.get()).write(HttpThread::new());
        }
        crate::HTTP_THREAD_INIT.store(true, core::sync::atomic::Ordering::Release);
        let opts_copy = opts.clone();
        let thread = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || on_start(opts_copy));
        match thread {
            // detach — see HTTP_THREAD_HANDLE note above re: LSAN reachability
            Ok(t) => {
                let _ = HTTP_THREAD_HANDLE.set(t);
            }
            Err(err) => exit_spawn_failed(&err),
        }
    }

    /// A refused thread is the environment's limit, not a bug: no crash reporter.
    #[cold]
    #[inline(never)]
    fn exit_spawn_failed(err: &std::io::Error) -> ! {
        match SystemErrno::from_io_error(err) {
            Some(errno) => {
                bun_core::err_generic!("Failed to start HTTP Client thread: {}", errno);
                if errno == SystemErrno::EAGAIN {
                    bun_core::note!(
                        "The process or thread limit may have been reached (ulimit -u, or the container's pids limit); raise it or reduce concurrency"
                    );
                }
            }
            // No errno name for this OS code (most Windows thread-creation failures).
            None => bun_core::err_generic!("Failed to start HTTP Client thread: {}", err),
        }
        bun_core::Global::crash()
    }

    fn on_start(opts: InitOpts) {
        Output::Source::configure_named_thread(bun_core::zstr!("HTTP Client"));

        // Normalising once here (see `normalize_idle_timeout_seconds`) keeps
        // the h1 (`HTTPClient::set_timeout`) and h2
        // (`ClientSession::rearm_timeout`) paths identical without duplicating
        // the math at each call site.
        crate::IDLE_TIMEOUT_SECONDS.store(
            crate::normalize_idle_timeout_seconds(
                bun_core::env_var::BUN_CONFIG_HTTP_IDLE_TIMEOUT
                    .get()
                    .unwrap_or(300),
            ),
            core::sync::atomic::Ordering::Relaxed,
        );

        // Critical side effect: `init_global` calls
        // `internal_loop_data.set_parent_raw(2 /* mini */, mini_ptr)` on this
        // thread's uSockets loop. Without it, the macOS DNS cache-miss path
        // (`dns::getaddrinfo` → `(*loop).internal_loop_data.get_parent()`)
        // panics with `Parent loop not set - pointer is null`, which aborts
        // the process — `bun install` SIGABRT on the first uncached lookup.
        let loop_ = mini_event_loop::init_global(None);

        #[cfg(windows)]
        {
            if bun_sys::windows::getenv_w(bun_core::wstr!("SystemRoot")).is_none() {
                Output::err_generic(
                    "The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.",
                    (),
                );
                bun_core::Global::crash();
            }
        }

        crate::HTTP_THREAD.claim();
        let thread = crate::http_thread();
        thread.http_context.init();
        // `https_context.init_with_thread_opts` eagerly builds the BoringSSL
        // `SSL_CTX` and the default root-CA store (`us_get_default_ca_store`),
        // which reads the OpenSSL default cert file/dir where present, whether
        // or not an HTTPS request ever happens. When there is no user-supplied
        // CA config we stash `opts` and let the first use of the context
        // run it (see `HttpThread::lazy_https_init`) — a fully-cached
        // `bun install` (which makes zero network requests) then skips the
        // cost entirely.
        if !opts.abs_ca_file_name.is_empty() || !opts.ca.is_empty() {
            // User passed --cafile / --ca: validate now so a bad CA file fails
            // the process at thread start (test contract:
            // bun-install-registry.test.ts "non-existent --cafile" /
            // "invalid cafile"), even if the registry is plain HTTP and no SSL
            // connect would ever happen.
            if let Err(err) = thread.https_context.init_with_thread_opts(&opts) {
                (opts.on_init_error)(err, &opts);
            }
        } else {
            // No CA config — safe to defer the ~0.7 ms / ~400 KB root-cert
            // parse to the first SSL connect (warm-cache `bun install` makes
            // none).
            thread.lazy_https_init = Some(opts);
        }
        let uws_loop = core::ptr::from_ref(loop_.loop_).cast_mut();
        INBOX.uws_loop.store(uws_loop, Ordering::Release);
        thread.process_events(loop_);
    }

    impl HttpThread {
        fn process_events(&mut self, loop_: &MiniEventLoop) -> ! {
            let uws_loop = loop_.loop_;
            #[cfg(unix)]
            {
                uws_loop.num_polls.set(uws_loop.num_polls.get().max(2));
            }
            #[cfg(windows)]
            {
                uws_loop.inc();
            }

            loop {
                if SHUTDOWN_REQUESTED.load(Ordering::Acquire) {
                    self.dealloc_in_flight_for_exit();
                    {
                        let mut done = SHUTDOWN_DONE.0.lock();
                        *done = true;
                        SHUTDOWN_DONE.1.notify_all();
                    }
                    // The JS thread is in `global_exit()` and will call
                    // `Global::exit()` after we ack. Park forever so the loop
                    // never ticks the (now partially-freed) sockets again.
                    loop {
                        std::thread::park();
                    }
                }
                self.drain_events();
                self.free_dead_ssl_contexts();
                assert_abort_tracker_sockets_alive();
                Output::flush();

                uws_loop.inc();
                uws_loop.tick();
                uws_loop.dec();
                // Run the deferred-free thunk (`Store::process_deferred_frees`)
                // like `MiniEventLoop::tick_once` does after its raw tick; the
                // FilePoll hive slots freed during this tick are reclaimed here.
                loop_.on_after_event_loop();
                assert_abort_tracker_sockets_alive();

                if cfg!(debug_assertions) {
                    Output::flush();
                }
            }
        }
    }
}

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_DONE: (bun_threading::Guarded<bool>, bun_threading::Condvar) = (
    bun_threading::Guarded::new(false),
    bun_threading::Condvar::new(),
);

/// Whether [`init`] has run; [`crate::http_thread`] panics before that.
pub fn is_initialized() -> bool {
    crate::HTTP_THREAD_INIT.load(Ordering::Acquire)
}

/// Called from `bun_jsc::VirtualMachine::global_exit()` on the JS thread,
/// before `~VM`. Asks the HTTP daemon thread to reclaim every in-flight
/// request and waits (with a short timeout) for it to ack.
/// No-op if the HTTP thread was never started.
/// Returns whether the HTTP thread is now parked (or was never running):
/// `false` means it did not acknowledge within the deadline and may still
/// touch requests, so the caller must not free anything it shares with it.
#[must_use]
pub fn shutdown_for_exit() -> bool {
    if INBOX.uws_loop.load(Ordering::Acquire).is_null() {
        return true;
    }
    SHUTDOWN_REQUESTED.store(true, Ordering::Release);
    HttpThread::wakeup();
    let mut done = SHUTDOWN_DONE.0.lock();
    // 1s upper bound: a stuck HTTP thread shouldn't deadlock process exit.
    let deadline = Instant::now() + std::time::Duration::from_secs(1);
    while !*done {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        if SHUTDOWN_DONE
            .1
            .timed_wait_guarded(&mut done, remaining.as_nanos() as u64)
            .is_err()
        {
            break;
        }
    }
    let acked = *done;
    drop(done);
    if !acked {
        // Timed out without an ack: the HTTP thread may still be inside
        // `tick()` and could touch parked allocations. Leak them — the
        // process is exiting and a leak beats a use-after-free.
        return false;
    }
    true
}

// dispatch_deps bridge removed — real impls now live in
// h3_client/ClientContext.rs (abort_by_http_id / stream_body_by_http_id).

/// Module-level bridge for `HTTPThread::init`. The real body lives in
/// `_event_loop_draft` below (depends on `bun_event_loop::MiniEventLoop`,
/// which is outside this crate's dep set). Call sites in AsyncHTTP.rs hit
/// this until that tier boundary is resolved.
pub fn init(opts: &InitOpts) {
    _event_loop_draft::init(opts)
}
