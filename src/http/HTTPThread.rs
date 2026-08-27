use core::cell::{Cell, RefCell, RefMut};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use bun_collections::ArrayHashMap;
use bun_core::{self, Output};
use bun_ptr::{BackRef, RefPtr};
use bun_threading::{Guarded, UnboundedQueue};
use bun_uws as uws;
use bun_uws::LoopWaker;

use crate::async_http::{ACTIVE_REQUESTS_COUNT, MAX_SIMULTANEOUS_REQUESTS};
use crate::http_context::ActiveSocketExt;
use crate::ssl_config::{self, SSLConfig};
use crate::{AsyncHttp, HTTPContext, InitError, NewHttpContext, RequestCell, h2, h3};

// The scope registry keys on name, so the two visibilities (.hidden +
// .visible) are split into two scope names.
bun_core::declare_scope!(HTTPThread, hidden); // threadlog
bun_core::declare_scope!(HTTPThread_log, visible); // log

/// SSL context cache keyed by interned SSLConfig pointer.
/// Since configs are interned via `ssl_config::global_registry`, pointer
/// equality is sufficient for lookup.
struct SslContextCacheEntry {
    /// The cache's reference; each in-flight request using the context holds
    /// its own (`HTTPClient::custom_ssl_ctx`), so an evicted context lives on
    /// until the last such request is done with it.
    ctx: RefPtr<NewHttpContext<true>>,
    last_used_ns: u64,
    /// The cache entry's reference on the config it is keyed by.
    _config_ref: ssl_config::SharedPtr,
}

const SSL_CONTEXT_CACHE_MAX_SIZE: usize = 60;
const SSL_CONTEXT_CACHE_TTL_NS: u64 = 30 * (60 * 1_000_000_000); // 30 minutes

pub struct LibdeflateState {
    pub(crate) decompressor: Option<bun_libdeflate_sys::libdeflate::OwnedDecompressor>,
    pub(crate) compressor: Option<bun_libdeflate_sys::libdeflate::OwnedCompressor>,
    pub(crate) shared_buffer: Box<[u8]>,
}

const LIBDEFLATE_SHARED_BUFFER_SIZE: usize = 512 * 1024;

impl LibdeflateState {
    /// Mutable access to the libdeflate decompressor handle.
    ///
    /// `decompressor` is set once in [`ThreadState::deflater`] (panics on OOM)
    /// and is never `None` after that, so the unwrap is infallible.
    #[inline]
    pub(crate) fn decompressor_mut(&mut self) -> &mut bun_libdeflate_sys::libdeflate::Decompressor {
        self.decompressor
            .as_deref_mut()
            .expect("set in ThreadState::deflater()")
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

pub struct WriteMessage {
    pub(crate) async_http_id: u32,
    pub(crate) kind: WriteMessageType,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum WriteMessageType {
    Data = 0,
    End = 1,
}

pub struct ShutdownMessage {
    pub(crate) async_http_id: u32,
}

/// The JS thread's `checkServerIdentity` callback approved the peer
/// certificate; un-park the connection so the request is written.
pub struct CertCheckResumeMessage {
    pub(crate) async_http_id: u32,
}

pub(crate) type Queue = UnboundedQueue<AsyncHttp<'static>>;

/// A request its owner has queued for the HTTP thread: the owner keeps its
/// `AsyncHTTP` alive and does not touch it (beyond `Sync` fields) from
/// `HTTPThread::schedule` until the terminal result callback / shutdown
/// release has run, which is exactly [`BackRef`]'s holder obligation.
pub(crate) type LentRequest = BackRef<AsyncHttp<'static>>;

/// Configuration for the HTTP thread's default HTTPS context.
#[derive(Clone, Copy)]
pub struct InitOpts {
    /// PEM CA certificates (`--ca`), each NUL-terminated.
    pub ca: &'static [bun_core::ZBox],
    /// `--cafile`, as an absolute path with its trailing NUL included, or empty.
    pub abs_ca_file_name: &'static [u8],

    pub on_init_error: fn(err: InitError, opts: &InitOpts) -> !,
}

impl Default for InitOpts {
    fn default() -> Self {
        Self {
            ca: &[],
            abs_ca_file_name: b"",
            on_init_error: on_init_error_default,
        }
    }
}

fn on_init_error_default(err: InitError, opts: &InitOpts) -> ! {
    let name = bun_core::strings::without_suffix_comptime(opts.abs_ca_file_name, b"\0");
    match err {
        InitError::LoadCAFile => {
            if !bun_sys::exists(name) {
                Output::err(
                    "HTTPThread",
                    "failed to find CA file: '{}'",
                    (bstr::BStr::new(name),),
                );
            } else {
                Output::err(
                    "HTTPThread",
                    "failed to load CA file: '{}'",
                    (bstr::BStr::new(name),),
                );
            }
        }
        InitError::InvalidCAFile => {
            Output::err(
                "HTTPThread",
                "the CA file is invalid: '{}'",
                (bstr::BStr::new(name),),
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

// ──────────────────────────────────────────────────────────────────────────
// HTTPThread — the handle every thread sees
// ──────────────────────────────────────────────────────────────────────────

/// The process's one HTTP client thread, as seen from any thread: the queues
/// other threads feed it through and the waker that gets it to look at them.
/// Everything the thread itself works with lives in [`ThreadState`].
pub struct HttpThread {
    /// Published by the HTTP thread once its loop exists; until then there is
    /// nothing to wake (the thread drains the queues when it starts).
    waker: OnceLock<LoopWaker>,
    started: AtomicBool,
    queued_tasks: Queue,
    queued_shutdowns: Guarded<Vec<ShutdownMessage>>,
    queued_writes: Guarded<Vec<WriteMessage>>,
    queued_receive_resumes: Guarded<Vec<u32>>,
    queued_cert_check_resumes: Guarded<Vec<CertCheckResumeMessage>>,
    /// HTTP/3 connects whose DNS lookup resolved on another thread
    /// (`h3::PendingConnect`), by ticket.
    queued_h3_dns: Guarded<Vec<h3::DnsTicket>>,
    /// `fetch.preconnect()` targets; the thread builds and owns the requests.
    queued_preconnects: Guarded<Vec<bun_url::ParsedURL>>,
}

static HTTP_THREAD: HttpThread = HttpThread {
    waker: OnceLock::new(),
    started: AtomicBool::new(false),
    queued_tasks: Queue::new(),
    queued_shutdowns: Guarded::new(Vec::new()),
    queued_writes: Guarded::new(Vec::new()),
    queued_receive_resumes: Guarded::new(Vec::new()),
    queued_cert_check_resumes: Guarded::new(Vec::new()),
    queued_h3_dns: Guarded::new(Vec::new()),
    queued_preconnects: Guarded::new(Vec::new()),
};

/// The HTTP client thread's cross-thread handle. `HTTPThread::init` must have
/// run (every entry point that starts a request calls it first).
#[inline]
pub fn http_thread() -> &'static HttpThread {
    assert!(
        HTTP_THREAD.started.load(Ordering::Acquire),
        "http_thread() called before HTTPThread::init()"
    );
    &HTTP_THREAD
}

impl HttpThread {
    pub(crate) fn get() -> &'static HttpThread {
        &HTTP_THREAD
    }

    pub(crate) fn is_initialized() -> bool {
        HTTP_THREAD.started.load(Ordering::Acquire)
    }

    pub(crate) fn wakeup(&self) {
        if let Some(waker) = self.waker.get() {
            waker.wake();
        }
    }

    /// Enqueue a batch of `AsyncHttp` tasks for the HTTP thread; any thread.
    /// Each task's `AsyncHTTP` is lent to the HTTP thread until its terminal
    /// result callback (see [`LentRequest`]).
    pub fn schedule(batch: bun_threading::thread_pool::Batch) {
        if batch.len == 0 {
            return;
        }
        let this = http_thread();
        let mut batch = batch;
        while let Some(task) = batch.pop() {
            let http = <AsyncHttp<'static> as bun_core::IntrusiveField<
                bun_threading::thread_pool::Task,
            >>::container_nn(task);
            this.queued_tasks.push(http);
        }
        this.wakeup();
    }

    pub fn schedule_receive_resume(&self, async_http_id: u32) {
        {
            let mut queued = self.queued_receive_resumes.lock();
            if queued.last() == Some(&async_http_id) {
                return;
            }
            queued.push(async_http_id);
        }
        self.wakeup();
    }

    pub fn schedule_shutdown(&self, http: &AsyncHttp) {
        self.schedule_shutdown_by_id(http.async_http_id);
    }

    pub fn schedule_shutdown_by_id(&self, async_http_id: u32) {
        bun_core::scoped_log!(HTTPThread, "scheduleShutdown {}", async_http_id);
        self.queued_shutdowns
            .lock()
            .push(ShutdownMessage { async_http_id });
        self.wakeup();
    }

    pub fn schedule_cert_check_resume(&self, async_http_id: u32) {
        bun_core::scoped_log!(HTTPThread, "scheduleCertCheckResume {}", async_http_id);
        self.queued_cert_check_resumes
            .lock()
            .push(CertCheckResumeMessage { async_http_id });
        self.wakeup();
    }

    pub fn schedule_request_write(&self, async_http_id: u32, kind: WriteMessageType) {
        self.queued_writes.lock().push(WriteMessage {
            async_http_id,
            kind,
        });
        self.wakeup();
    }

    /// An HTTP/3 connect's DNS lookup resolved (any thread).
    pub(crate) fn schedule_h3_dns_resolved(&self, ticket: h3::DnsTicket) {
        self.queued_h3_dns.lock().push(ticket);
        self.wakeup();
    }

    pub(crate) fn schedule_preconnect(&self, url: bun_url::ParsedURL) {
        self.queued_preconnects.lock().push(url);
        self.wakeup();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadState — what the HTTP thread itself owns
// ──────────────────────────────────────────────────────────────────────────

/// Everything the HTTP thread works with, created by the thread when it
/// starts and alive for the rest of the process (the thread never exits), so
/// the thread's own objects hold it as `&'static ThreadState`. Not `Sync`:
/// nothing here is reachable from another thread.
pub struct ThreadState {
    pub(crate) waker: LoopWaker,
    pub(crate) http_context: NewHttpContext<false>,
    pub(crate) https_context: NewHttpContext<true>,
    /// Stashed `InitOpts` for the default HTTPS context. When the user passed
    /// no explicit CA config, start-up defers
    /// `https_context.init_with_thread_opts` (which calls
    /// `us_ssl_ctx_from_options` → `us_get_default_ca_store`) until the first
    /// SSL connect actually arrives via [`ThreadState::connect`]`::<true>`. A
    /// fully-cached `bun install` never makes one, so the cost is skipped
    /// entirely. If `--cafile` / `--ca` *was* passed, start-up still runs
    /// init eagerly so a bad CA file crashes at thread start (the long-standing
    /// test contract) and this stays `None`.
    lazy_https_init: Cell<Option<InitOpts>>,

    /// Tasks popped from `queued_tasks` that couldn't start because
    /// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
    /// and processed before `queued_tasks` on the next `drain_events`.
    deferred_tasks: RefCell<Vec<LentRequest>>,
    /// Set by `drain_queued_shutdowns` when a shutdown's `async_http_id` wasn't
    /// in the abort tracker — the request is either not yet started (still in
    /// `queued_tasks`/`deferred_tasks`) or already done. `drain_events` uses
    /// this to decide whether it must scan the queued/deferred lists for
    /// aborted tasks when `active >= max`; without it the common at-capacity
    /// path stays O(1).
    has_pending_queued_abort: Cell<bool>,

    /// Proxy tunnels whose last reference was given up inside one of their
    /// own callbacks; released on the next `drain_events` instead.
    queued_proxy_derefs: RefCell<Vec<crate::proxy_tunnel::RefPtr>>,

    pub(crate) timer: Instant,
    lazy_libdeflater: RefCell<Option<Box<LibdeflateState>>>,

    /// Every request currently being worked on. Inserted by
    /// [`start_queued_task`]; moved to `retired` once its terminal result has
    /// gone out. Exists so [`shutdown_for_exit`] can release each one's owner
    /// at process exit — the request socket never reaches a terminal state
    /// once the JS thread stops driving the world.
    #[expect(clippy::vec_box)] // address-stable: `RequestRef`s point at the cells
    in_flight: RefCell<Vec<Box<RequestCell>>>,
    /// Requests whose terminal result is ready, handed back by
    /// [`ThreadState::flush_completions`] between events.
    pub(crate) completed: RefCell<std::collections::VecDeque<crate::RequestRef>>,
    /// Requests nobody else holds (preconnects): queued like any other, freed
    /// here after their terminal result.
    #[expect(clippy::vec_box)] // address-stable: queued by pointer
    owned_requests: RefCell<Vec<Box<AsyncHttp<'static>>>>,

    /// Socket of every started request that has an abort signal, by
    /// `async_http_id`, so the JS-thread wake-ups (abort, body chunk, receive
    /// resume, cert-check verdict) can find it.
    pub(crate) abort_tracker: RefCell<ArrayHashMap<u32, uws::AnySocket>>,
    custom_ssl_contexts: RefCell<ArrayHashMap<*const SSLConfig, SslContextCacheEntry>>,

    /// Origins that advertised HTTP/3 via Alt-Svc.
    pub(crate) alt_svc: RefCell<h3::alt_svc::Cache>,
    /// The lsquic client engine, created on first HTTP/3 connect.
    pub(crate) h3: std::cell::OnceCell<Box<h3::ClientContext>>,
    /// HTTP/3 connects waiting on DNS, by ticket index.
    pub(crate) h3_dns_pending: RefCell<Vec<Option<Box<h3::PendingConnect>>>>,

    // Scratch buffers, each fully rewritten before it is read.
    // we always rewrite the entire HTTP request when write() returns EAGAIN
    // so we can reuse this buffer
    pub(crate) request_headers_buf: RefCell<Box<[bun_picohttp::Header; MAX_REQUEST_HEADERS]>>,
    // this doesn't need to be stack memory because it is immediately cloned after use
    pub(crate) response_headers_buf: RefCell<Box<[bun_picohttp::Header; 256]>>,
    // the first packet for Transfer-Encoding: chunked
    // is usually pretty small or sometimes even just a length
    // so we can avoid allocating a temporary buffer to copy the data in
    pub(crate) single_packet_buf: RefCell<Box<[u8; SINGLE_PACKET_BUF_SIZE]>>,
}

pub(crate) const MAX_REQUEST_HEADERS: usize = 256;
pub(crate) const SINGLE_PACKET_BUF_SIZE: usize = 16 * 1024;

impl ThreadState {
    /// `Instant::elapsed().as_nanos()` is u128; checked narrow to u64 —
    /// overflows only after ~584 years of process uptime.
    #[inline]
    pub(crate) fn timer_read(&self) -> u64 {
        u64::try_from(self.timer.elapsed().as_nanos()).expect("int cast")
    }

    pub(crate) fn deflater(&self) -> RefMut<'_, LibdeflateState> {
        RefMut::map(self.lazy_libdeflater.borrow_mut(), |slot| {
            &mut **slot.get_or_insert_with(|| {
                let decompressor = bun_libdeflate_sys::libdeflate::OwnedDecompressor::new()
                    .unwrap_or_else(|| bun_core::out_of_memory());
                Box::new(LibdeflateState {
                    decompressor: Some(decompressor),
                    compressor: None,
                    shared_buffer: vec![0u8; LIBDEFLATE_SHARED_BUFFER_SIZE].into_boxed_slice(),
                })
            })
        })
    }

    pub(crate) fn context<const IS_SSL: bool>(&self) -> &NewHttpContext<IS_SSL> {
        NewHttpContext::<IS_SSL>::default_for(self)
    }

    /// One-shot lazy init of the default HTTPS context. See
    /// [`ThreadState::lazy_https_init`] for rationale. Called on the HTTP
    /// thread from [`ThreadState::connect`]`::<true>` only. On failure,
    /// `on_init_error` diverges.
    #[inline]
    fn ensure_https_context_init(&self) {
        if let Some(opts) = self.lazy_https_init.take() {
            self.init_https_context_cold(&opts);
        }
    }

    #[cold]
    fn init_https_context_cold(&self, opts: &InitOpts) {
        if let Err(err) = self.https_context.init_with_thread_opts(opts) {
            (opts.on_init_error)(err, opts);
        }
    }

    pub(crate) fn connect<const IS_SSL: bool>(
        &'static self,
        client: &mut crate::HTTPClient,
    ) -> crate::Result<Option<crate::HTTPSocket<IS_SSL>>> {
        if IS_SSL {
            // First SSL connect: materialize the default HTTPS `SSL_CTX` +
            // socket group now (deferred from `on_start`). Runs once; every
            // SSL request — including unix-socket and proxy paths below —
            // funnels through here before touching `https_context.{group,secure}`.
            self.ensure_https_context_init();
        }
        if !client.unix_socket_path.is_empty() {
            return self.context::<IS_SSL>().connect_socket(client);
        }

        if IS_SSL {
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
                let cached = {
                    let mut map = self.custom_ssl_contexts.borrow_mut();
                    map.get_mut(&requested_config).map(|entry| {
                        entry.last_used_ns = self.timer_read();
                        entry.ctx.clone()
                    })
                };
                let ctx = match cached {
                    Some(ctx) => ctx,
                    None => {
                        // Cache miss - create new SSL context
                        let ctx = NewHttpContext::<true>::create(self);
                        if let Err(err) = ctx.init_with_client_config(client) {
                            return Err(match err {
                                InitError::InvalidCRL => crate::Error::InvalidCRL,
                                InitError::FailedToOpenSocket
                                | InitError::InvalidCA
                                | InitError::InvalidCAFile
                                | InitError::LoadCAFile => crate::Error::FailedToOpenSocket,
                            });
                        }
                        let now = self.timer_read();
                        let _ = self.custom_ssl_contexts.borrow_mut().put(
                            requested_config,
                            SslContextCacheEntry {
                                ctx: ctx.clone(),
                                last_used_ns: now,
                                // Strong ref for the cache entry; client.tls_props keeps its own.
                                _config_ref: tls,
                            },
                        );
                        // Enforce max cache size - evict oldest entry
                        if self.custom_ssl_contexts.borrow().count() > SSL_CONTEXT_CACHE_MAX_SIZE {
                            self.evict_oldest_ssl_context();
                        }
                        ctx
                    }
                };
                // `ctx` becomes the reference the client holds from here on;
                // the guard's keeps the context alive across the connect call
                // even if the client lets go of it inside.
                let this = ctx.this_ptr();
                let _guard = RefPtr::from_this(this);
                client.set_custom_ssl_ctx(ctx);
                let ctx = this;
                // Keepalive is now supported for custom SSL contexts
                let result = if let Some((hostname, port, protocol_ok)) =
                    client.http_proxy().map(|url| {
                        (
                            bun_ptr::RawSlice::new(url.hostname),
                            url.get_port_auto(),
                            url.protocol.is_empty() || url.has_http_like_protocol(),
                        )
                    }) {
                    if !protocol_ok {
                        return Err(crate::Error::UnsupportedProxyProtocol);
                    }
                    ctx.connect(client, hostname.slice(), port)
                } else {
                    let (hn, pt) = (
                        bun_ptr::RawSlice::new(client.url.hostname()),
                        client.url.get_port_auto(),
                    );
                    ctx.connect(client, hn.slice(), pt)
                };
                // NewHttpContext<true> == NewHttpContext<IS_SSL> here (IS_SSL branch).
                return result.map(|o| o.map(|s| s.cast_ssl::<IS_SSL>()));
            }
        }
        if let Some((href_empty, hostname, port, protocol_ok)) = client.http_proxy().map(|url| {
            (
                url.href.is_empty(),
                bun_ptr::RawSlice::new(url.hostname),
                url.get_port_auto(),
                url.protocol.is_empty() || url.has_http_like_protocol(),
            )
        }) {
            if !href_empty {
                // https://github.com/oven-sh/bun/issues/11343
                if protocol_ok {
                    return self
                        .context::<IS_SSL>()
                        .connect(client, hostname.slice(), port);
                }
                return Err(crate::Error::UnsupportedProxyProtocol);
            }
        }
        let (hn, pt) = (
            bun_ptr::RawSlice::new(client.url.hostname()),
            client.url.get_port_auto(),
        );
        self.context::<IS_SSL>().connect(client, hn.slice(), pt)
    }

    /// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
    fn evict_stale_ssl_contexts(&self) {
        let now = self.timer_read();
        let mut evicted = Vec::new();
        {
            let mut map = self.custom_ssl_contexts.borrow_mut();
            let mut i: usize = 0;
            while i < map.count() {
                let entry_last_used = map.values()[i].last_used_ns;
                if now.saturating_sub(entry_last_used) > SSL_CONTEXT_CACHE_TTL_NS {
                    let (_k, entry) = map.swap_remove_at(i);
                    evicted.push(entry);
                } else {
                    i += 1;
                }
            }
        }
        drop(evicted);
    }

    /// Evict the least-recently-used SSL context cache entry.
    fn evict_oldest_ssl_context(&self) {
        let entry = {
            let mut map = self.custom_ssl_contexts.borrow_mut();
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
            map.swap_remove_at(oldest_idx).1
        };
        drop(entry);
    }

    fn abort_pending_h2_waiter(&self, async_http_id: u32) -> bool {
        if self.https_context.abort_pending_h2_waiter(async_http_id) {
            return true;
        }
        let contexts: Vec<RefPtr<NewHttpContext<true>>> = self
            .custom_ssl_contexts
            .borrow()
            .values()
            .iter()
            .map(|e| e.ctx.clone())
            .collect();
        contexts
            .iter()
            .any(|ctx| ctx.abort_pending_h2_waiter(async_http_id))
    }

    /// The socket registered for `async_http_id`, if any.
    fn tracked_socket(&self, async_http_id: u32) -> Option<uws::AnySocket> {
        self.abort_tracker.borrow().get(&async_http_id).copied()
    }

    fn drain_queued_shutdowns(&self) {
        let shared = HttpThread::get();
        loop {
            // socket.close() can potentially be slow
            // Let's not block other threads while this runs.
            let queued_shutdowns = core::mem::take(&mut *shared.queued_shutdowns.lock());

            for http in &queued_shutdowns {
                let found = self.abort_tracker.borrow_mut().remove(&http.async_http_id);
                if let Some(socket_ptr) = found {
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                // If we only call socket.close(), then it won't
                                // call `onClose` if this happens before `onOpen` is
                                // called.
                                req.with_client(|c| c.close_and_abort::<true>(socket));
                                continue;
                            }
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::abort_by_http_id(session, http.async_http_id);
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                req.with_client(|c| c.close_and_abort::<false>(socket));
                                continue;
                            }
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::abort_by_http_id(session, http.async_http_id);
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                    }
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
                    if h3::ClientContext::abort_by_http_id(self, http.async_http_id) {
                        continue;
                    }
                    // Otherwise the request either hasn't started yet (still in
                    // `queued_tasks`/`deferred_tasks`) or has already completed.
                    // Flag it so `drainEvents` knows to scan the queue for
                    // aborted-but-unstarted tasks even when `active >= max`
                    // would otherwise short-circuit.
                    self.has_pending_queued_abort.set(true);
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

    fn drain_queued_writes(&self) {
        let shared = HttpThread::get();
        loop {
            let queued_writes = core::mem::take(&mut *shared.queued_writes.lock());
            for write in &queued_writes {
                let message = write.kind;
                let ended = message == WriteMessageType::End;

                if let Some(socket_ptr) = self.tracked_socket(write.async_http_id) {
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                let mut client = req.client();
                                if let crate::Body::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<true>(socket);
                                    client.drain_tunnel_events();
                                }
                            }
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::stream_body_by_http_id(
                                    session,
                                    write.async_http_id,
                                    ended,
                                );
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                let mut client = req.client();
                                if let crate::Body::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<false>(socket);
                                    client.drain_tunnel_events();
                                }
                            }
                            if let Some(session) = tagged.session() {
                                h2::ClientSession::stream_body_by_http_id(
                                    session,
                                    write.async_http_id,
                                    ended,
                                );
                            }
                        }
                    }
                } else {
                    h3::ClientContext::stream_body_by_http_id(self, write.async_http_id, ended);
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

    fn drain_queued_cert_check_resumes(&self) {
        let shared = HttpThread::get();
        loop {
            let queued_cert_check_resumes =
                core::mem::take(&mut *shared.queued_cert_check_resumes.lock());
            for resume in &queued_cert_check_resumes {
                // Both arms are required: an HTTPS target behind a plaintext
                // proxy parks behind a SocketTcp tracker entry.
                if let Some(socket_ptr) = self.tracked_socket(resume.async_http_id) {
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                RequestCell::resume_after_cert_check::<true>(req, socket);
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                RequestCell::resume_after_cert_check::<false>(req, socket);
                            }
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

    fn drain_queued_receive_resumes(&self) {
        let shared = HttpThread::get();
        loop {
            let queued = core::mem::take(&mut *shared.queued_receive_resumes.lock());
            if queued.is_empty() {
                return;
            }
            for id in queued {
                if let Some(socket_ptr) = self.tracked_socket(id) {
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                req.with_client(|c| {
                                    c.resume_receive::<true>(socket);
                                    c.drain_response_body::<true>(socket);
                                });
                            }
                            if let Some(session) = tagged.session() {
                                // The resume may tear the session down and
                                // release the socket's ref; hold one across
                                // the second call.
                                let _keep_alive = RefPtr::from_this(session);
                                h2::ClientSession::resume_receive_by_http_id(session, id);
                                h2::ClientSession::drain_response_body_by_http_id(session, id);
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(req) = tagged.request() {
                                req.with_client(|c| {
                                    c.resume_receive::<false>(socket);
                                    c.drain_response_body::<false>(socket);
                                });
                            }
                            if let Some(session) = tagged.session() {
                                // See the Tls arm.
                                let _keep_alive = RefPtr::from_this(session);
                                h2::ClientSession::resume_receive_by_http_id(session, id);
                                h2::ClientSession::drain_response_body_by_http_id(session, id);
                            }
                        }
                    }
                } else {
                    h3::ClientContext::resume_receive_by_http_id(self, id);
                }
            }
        }
    }

    fn drain_queued_h3_dns(&self) {
        let batch = core::mem::take(&mut *HttpThread::get().queued_h3_dns.lock());
        for ticket in batch {
            h3::PendingConnect::finish(self, ticket);
        }
    }

    fn drain_queued_preconnects(&self) {
        let batch = core::mem::take(&mut *HttpThread::get().queued_preconnects.lock());
        for url in batch {
            let request = crate::async_http::PreparedPreconnect::into_request(url);
            let mut cell = request.cell.take().expect("just built");
            cell.arm(&request);
            request.cell.set(Some(cell));
            let ptr = core::ptr::NonNull::from(&*request);
            self.owned_requests.borrow_mut().push(request);
            HttpThread::get().queued_tasks.push(ptr);
        }
    }

    /// The thread-owned request at `ptr` has delivered its terminal result.
    pub(crate) fn free_owned_request(&self, ptr: *const AsyncHttp<'static>) {
        let mut owned = self.owned_requests.borrow_mut();
        if let Some(i) = owned
            .iter()
            .position(|r| core::ptr::eq(&raw const **r, ptr))
        {
            drop(owned.swap_remove(i));
        }
    }

    pub(crate) fn drain_events(&'static self) {
        // Process any pending writes **before** aborting.
        self.drain_queued_receive_resumes();
        self.flush_completions();
        self.drain_queued_writes();
        self.flush_completions();
        self.drain_queued_shutdowns();
        self.flush_completions();
        // After shutdowns: an abort or cert-rejection scheduled in the same JS
        // turn removes the abort-tracker entry first, so the resume becomes a
        // no-op and the request is never transmitted after a same-tick abort.
        self.drain_queued_cert_check_resumes();
        self.flush_completions();
        self.drain_queued_h3_dns();
        self.flush_completions();
        self.drain_queued_preconnects();

        drop(core::mem::take(&mut *self.queued_proxy_derefs.borrow_mut()));

        let mut count: usize = 0;
        let mut active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
        let max = MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed);

        // Fast path: at capacity and no queued/deferred task could possibly be
        // aborted. A queued task can only become aborted via `scheduleShutdown`,
        // which we just drained — `drainQueuedShutdowns` sets
        // `has_pending_queued_abort` for any id it couldn't find in the socket
        // tracker. If that's clear, there's nothing to fail-fast and nothing can
        // start, so don't walk the lists.
        if active >= max && !self.has_pending_queued_abort.get() {
            return;
        }

        // Deferred tasks are ones we previously popped from the MPSC queue but
        // couldn't start because we were at max. They stay in FIFO order ahead of
        // anything still in `queued_tasks`.
        //
        // Already-aborted tasks are started regardless of `max`: `start_()` will
        // observe the `aborted` signal and fail immediately with
        // `AbortedBeforeConnecting`, and `RequestCell::deliver` decrements
        // `ACTIVE_REQUESTS_COUNT` in the same turn — so they never hold a slot.
        // Without this, an aborted fetch that was queued behind `max` would sit
        // there until some unrelated request completed; if every active request
        // is itself hung, the aborted one never settles and its promise hangs
        // forever even though the user called `controller.abort()`.
        //
        // `start_queued_task` can reach `RequestCell::deliver` synchronously (for
        // aborted tasks, or when connect() fails immediately), which reads both
        // `ACTIVE_REQUESTS_COUNT` and `deferred_tasks.len()` to decide whether
        // to wake the loop. To keep those reads accurate we swap the deferred list
        // out before iterating so the field reflects only tasks still waiting, and
        // reload `active` from the atomic after every start rather than tracking
        // it locally.
        self.has_pending_queued_abort.set(false);
        {
            let pending = core::mem::take(&mut *self.deferred_tasks.borrow_mut());
            for http in pending {
                let aborted = http.signals.get(crate::signals::Field::Aborted);
                if aborted || active < max {
                    start_queued_task(self, http);
                    self.flush_completions();
                    if cfg!(debug_assertions) {
                        count += 1;
                    }
                    active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
                } else {
                    self.deferred_tasks.borrow_mut().push(http);
                }
            }
        }

        while let Some(http) = self.pop_queued_task() {
            let aborted = http.signals.get(crate::signals::Field::Aborted);
            if !aborted && active >= max {
                // Can't start this one yet. Defer it (preserves FIFO relative to
                // later pops) and keep draining — there may be aborted tasks
                // behind it that we can fail-fast right now.
                self.deferred_tasks.borrow_mut().push(http);
                continue;
            }
            start_queued_task(self, http);
            self.flush_completions();
            if cfg!(debug_assertions) {
                count += 1;
            }
            active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
        }

        if cfg!(debug_assertions) && count > 0 {
            bun_core::scoped_log!(HTTPThread_log, "Processed {} tasks\n", count);
        }
    }

    fn pop_queued_task(&self) -> Option<LentRequest> {
        core::ptr::NonNull::new(HttpThread::get().queued_tasks.pop()).map(BackRef::from)
    }

    /// Whether any request is waiting for a concurrency slot.
    pub(crate) fn has_queued_tasks(&self) -> bool {
        !HttpThread::get().queued_tasks.is_empty() || !self.deferred_tasks.borrow().is_empty()
    }

    pub(crate) fn schedule_proxy_deref(&self, proxy: crate::proxy_tunnel::RefPtr) {
        // this is always called on the http thread,
        self.queued_proxy_derefs.borrow_mut().push(proxy);
        self.waker.wake();
    }

    /// Take over a request the thread is going to work on.
    pub(crate) fn adopt_request(&self, cell: Box<RequestCell>) -> BackRef<RequestCell> {
        let this = BackRef::new(&*cell);
        let mut in_flight = self.in_flight.borrow_mut();
        cell.in_flight_slot.set(in_flight.len());
        in_flight.push(cell);
        this
    }

    /// Hand back every request whose terminal result was produced during the
    /// event just handled (see [`RequestCell::deliver`]). Only called between
    /// events, where no request is borrowed further up the stack.
    #[inline]
    pub(crate) fn flush_completions(&self) {
        if self.completed.borrow().is_empty() {
            return;
        }
        self.flush_completions_slow();
    }

    #[cold]
    fn flush_completions_slow(&self) {
        loop {
            let Some(done) = self.completed.borrow_mut().pop_front() else {
                return;
            };
            let cell = {
                let mut in_flight = self.in_flight.borrow_mut();
                let i = done.in_flight_slot.get();
                if !in_flight
                    .get(i)
                    .is_some_and(|c| core::ptr::eq(&raw const **c, done.get()))
                {
                    debug_assert!(false, "completed request not in flight");
                    continue;
                }
                let cell = in_flight.swap_remove(i);
                if let Some(moved) = in_flight.get(i) {
                    moved.in_flight_slot.set(i);
                }
                cell
            };
            cell.finish(self);
        }
    }

    /// Called from [`crate::shutdown_for_exit`] on the HTTP thread once
    /// `SHUTDOWN_REQUESTED` is observed. Marks every request the thread still
    /// holds as handed back and runs its owner's shutdown release (the full
    /// result callback is not invoked: the JS thread is parked in
    /// `global_exit()` waiting on us and will not process the completion).
    /// Without the release the owner's `ctx` ⇄ request cycle is unreachable
    /// from any root and LSan reports the whole chain as indirect leaks.
    fn release_in_flight_for_exit(&self) {
        self.flush_completions();
        bun_core::scoped_log!(
            HTTPThread,
            "release_in_flight_for_exit: in_flight={} deferred={}",
            self.in_flight.borrow().len(),
            self.deferred_tasks.borrow().len()
        );
        // Requests handed to us but never started (concurrency-deferred, or
        // still on the incoming queue): the JS-side owner is waiting to get
        // them back all the same. Nothing here was connected, so
        // `release_at_shutdown` is the whole story.
        for http in core::mem::take(&mut *self.deferred_tasks.borrow_mut()) {
            http.hand_back_at_shutdown();
        }
        while let Some(http) = self.pop_queued_task() {
            http.hand_back_at_shutdown();
        }
        for cell in core::mem::take(&mut *self.in_flight.borrow_mut()) {
            // The connecting socket's ext may still point at `cell`, but the
            // loop never ticks again (we park forever after this returns), so
            // dropping it here frees nothing that will be looked at.
            cell.hand_back_at_shutdown();
        }
    }
}

fn start_queued_task(thread: &'static ThreadState, http: LentRequest) {
    let cell = RequestCell::start(thread, http);
    // Clone-owned from here: `cell` is what the socket tag, h2/h3 streams
    // and the proxy tunnel point at; the owner's `AsyncHTTP` is only read
    // (its config was copied into `cell`) and marked handed back at the end.
    cell.with_client(|c| c.start_request());
}

/// Debug+ASAN invariant check: every socket pointer in the abort tracker must
/// point at live (unfreed) memory. A stale entry here means some socket-close
/// path forgot `unregister_abort_tracker`, which later manifests as a
/// use-after-free in `drain_queued_shutdowns`/`drain_queued_writes` when the
/// JS thread aborts that request id. Runs before and after each loop tick so
/// the report fires at the tick that leaked, not at the eventual abort.
#[inline]
fn assert_abort_tracker_sockets_alive(thread: &ThreadState) {
    if cfg!(debug_assertions) {
        for socket in thread.abort_tracker.borrow().values() {
            if let Some(usocket) = socket.socket().get() {
                bun_core::asan::assert_unpoisoned(usocket);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// init / on_start / the thread's loop
// ═══════════════════════════════════════════════════════════════════════════

static INIT_ONCE: std::sync::Once = std::sync::Once::new();
// Note: `Builder::spawn` allocates an `Arc<thread::Inner>` (48 B)
// shared between the `JoinHandle` and the new thread's TLS `current()`.
// Dropping the handle leaves the only strong ref inside the spawned
// thread's TLS, which LSAN does not scan as a root — so when the main
// thread reaches `Global::exit` *before* the HTTP thread has installed
// that TLS slot, LSAN reports the Arc as a direct leak and (with CI's
// `abort_on_error=1`) the process SIGABRTs (exit 134). Park the handle in
// a process-lifetime static so the Arc is always reachable from a global
// root, keeping detach semantics without the false positive.
static HTTP_THREAD_HANDLE: OnceLock<std::thread::JoinHandle<()>> = OnceLock::new();

pub fn init(opts: &InitOpts) {
    INIT_ONCE.call_once(|| init_once(*opts));
}

fn init_once(opts: InitOpts) {
    HTTP_THREAD.started.store(true, Ordering::Release);
    bun_libdeflate_sys::libdeflate::load();
    let thread = std::thread::Builder::new()
        .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
        .spawn(move || on_start(opts));
    match thread {
        // detach — see HTTP_THREAD_HANDLE note above re: LSAN reachability
        Ok(t) => {
            let _ = HTTP_THREAD_HANDLE.set(t);
        }
        Err(err) => Output::panic(format_args!("Failed to start HTTP Client thread: {}", err)),
    }
}

fn on_start(opts: InitOpts) -> ! {
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

    #[cfg(windows)]
    {
        // `getenv_w` forwards `name.as_ptr()` directly to Win32
        // `GetEnvironmentVariableW`, which expects a NUL-terminated LPCWSTR.
        // `bun_core::w!` does NOT append a sentinel on its own (see
        // src/sys/windows/mod.rs WATCHER_CHILD_ENV_Z note), so embed `\0`
        // in the literal.
        if bun_sys::windows::getenv_w(bun_core::w!("SystemRoot\0")).is_none() {
            Output::err_generic(
                "The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.",
                (),
            );
            bun_core::Global::crash();
        }
    }

    // The loop, and (inside `run_uws_loop_forever`) this thread's
    // `MiniEventLoop`: its `init_global` sets the loop's parent, which the
    // macOS DNS cache-miss path (`dns::getaddrinfo` → `get_parent()`) needs —
    // without it `bun install` aborts on the first uncached lookup.
    let waker = LoopWaker::for_current_thread();

    let state: &'static ThreadState = bun_core::heap::release(Box::new(ThreadState {
        waker,
        http_context: NewHttpContext::new(),
        https_context: NewHttpContext::new(),
        lazy_https_init: Cell::new(None),
        deferred_tasks: RefCell::new(Vec::new()),
        has_pending_queued_abort: Cell::new(false),
        queued_proxy_derefs: RefCell::new(Vec::new()),
        timer: Instant::now(),
        lazy_libdeflater: RefCell::new(None),
        in_flight: RefCell::new(Vec::new()),
        completed: RefCell::new(std::collections::VecDeque::new()),
        owned_requests: RefCell::new(Vec::new()),
        abort_tracker: RefCell::new(ArrayHashMap::new()),
        custom_ssl_contexts: RefCell::new(ArrayHashMap::new()),
        alt_svc: RefCell::new(h3::alt_svc::Cache::default()),
        h3: std::cell::OnceCell::new(),
        h3_dns_pending: RefCell::new(Vec::new()),
        request_headers_buf: RefCell::new(Box::new(
            [bun_picohttp::Header::ZERO; MAX_REQUEST_HEADERS],
        )),
        response_headers_buf: RefCell::new(Box::new([bun_picohttp::Header::ZERO; 256])),
        single_packet_buf: RefCell::new(Box::new([0u8; SINGLE_PACKET_BUF_SIZE])),
    }));
    state.http_context.attach(state);
    state.https_context.attach(state);
    state.http_context.init();
    // `https_context.init_with_thread_opts` eagerly builds the BoringSSL
    // `SSL_CTX` and the default root-CA store (`us_get_default_ca_store`),
    // which reads the OpenSSL default cert file/dir where present, whether
    // or not an HTTPS request ever happens. When there is no user-supplied
    // CA config we stash `opts` and let the first `connect::<true>` call
    // run it (see `ThreadState::lazy_https_init`) — a fully-cached
    // `bun install` (which makes zero network requests) then skips the
    // cost entirely.
    if !opts.abs_ca_file_name.is_empty() || !opts.ca.is_empty() {
        // User passed --cafile / --ca: validate now so a bad CA file fails
        // the process at thread start (test contract:
        // bun-install-registry.test.ts "non-existent --cafile" /
        // "invalid cafile"), even if the registry is plain HTTP and no SSL
        // connect would ever happen.
        if let Err(err) = state.https_context.init_with_thread_opts(&opts) {
            (opts.on_init_error)(err, &opts);
        }
    } else {
        // No CA config — safe to defer the ~0.7 ms / ~400 KB root-cert
        // parse to the first SSL connect (warm-cache `bun install` makes
        // none).
        state.lazy_https_init.set(Some(opts));
    }
    // Publishes the waker to cross-thread `wakeup()` callers; anything queued
    // before this is picked up by the first `drain_events` below.
    let _ = HTTP_THREAD.waker.set(waker);

    bun_event_loop::MiniEventLoop::run_uws_loop_forever(
        move || {
            if SHUTDOWN_REQUESTED.load(Ordering::Acquire) {
                state.release_in_flight_for_exit();
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
            state.drain_events();
            state.flush_completions();
            assert_abort_tracker_sockets_alive(state);
            Output::flush();
        },
        move || {
            state.flush_completions();
            assert_abort_tracker_sockets_alive(state);
            if cfg!(debug_assertions) {
                Output::flush();
            }
        },
    )
}

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_DONE: (Guarded<bool>, bun_threading::Condvar) =
    (Guarded::new(false), bun_threading::Condvar::new());

/// Called from `bun_jsc::VirtualMachine::global_exit()` on the JS thread,
/// before `~VM`. Asks the HTTP daemon thread to release every request it
/// still holds and waits (with a short timeout) for it to ack.
/// No-op if the HTTP thread was never started.
/// Returns whether the HTTP thread is now parked (or was never running):
/// `false` means it did not acknowledge within the deadline and may still
/// touch requests, so the caller must not free anything it shares with it.
#[must_use]
pub fn shutdown_for_exit() -> bool {
    if !HttpThread::is_initialized() {
        return true;
    }
    let thread = HttpThread::get();
    if thread.waker.get().is_none() {
        // `on_start` hasn't published the loop yet — no `start_queued_task`
        // can have run, so it holds nothing.
        return true;
    }
    SHUTDOWN_REQUESTED.store(true, Ordering::Release);
    thread.wakeup();
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
