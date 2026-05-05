use core::ffi::c_void;
use core::mem::offset_of;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once};
use std::time::Instant;

use bun_alloc::Arena; // MimallocArena
use bun_collections::ArrayHashMap;
use bun_core::{self, Global, Output};

use bun_str::{strings, ZStr};
use bun_threading::{Mutex, UnboundedQueue};
use bun_threading::thread_pool::Batch;

use crate::proxy_tunnel::ProxyTunnel;
use crate::ssl_config::SslConfig; // bun.api.server.ServerConfig.SSLConfig
use crate::{AsyncHttp, HttpClient, InitError, NewHttpContext, ThreadlocalAsyncHttp};
use crate::h2;
use crate::h3;

// TODO(port): TSV names `NewHTTPContext(true)` as `HttpsContext`; assumed alias here.
type HttpsContext = NewHttpContext<true>;

bun_output::declare_scope!(HTTPThread, hidden); // threadlog
bun_output::declare_scope!(HTTPThread_log, visible); // log
// TODO(port): Zig had two `Output.scoped(.HTTPThread, ...)` with different visibilities (.hidden + .visible).
// Rust scope registry keys on name; pick one visibility in Phase B or split scope names.

/// SSL context cache keyed by interned SSLConfig pointer.
/// Since configs are interned via SSLConfig.GlobalRegistry, pointer equality
/// is sufficient for lookup. Each entry holds a ref on its SSLConfig.
struct SslContextCacheEntry {
    ctx: Arc<HttpsContext>,
    last_used_ns: u64,
    /// Strong ref held by the cache entry (released on eviction).
    config_ref: crate::ssl_config::SharedPtr,
}
const SSL_CONTEXT_CACHE_MAX_SIZE: usize = 60;
const SSL_CONTEXT_CACHE_TTL_NS: u64 = 30 * (60 * 1_000_000_000); // 30 * std.time.ns_per_min

// SAFETY: only ever accessed from the single HTTP client thread after `on_start`.
// TODO(port): wrap in a thread-affine cell once `bun_threading` provides one.
static mut CUSTOM_SSL_CONTEXT_MAP: Option<ArrayHashMap<*const SslConfig, SslContextCacheEntry>> = None;
fn custom_ssl_context_map() -> &'static mut ArrayHashMap<*const SslConfig, SslContextCacheEntry> {
    // SAFETY: HTTP-thread-only; initialized on first call.
    unsafe { CUSTOM_SSL_CONTEXT_MAP.get_or_insert_with(ArrayHashMap::new) }
}

pub struct HttpThread {
    pub loop_: &'static MiniEventLoop,
    pub http_context: NewHttpContext<false>,
    pub https_context: NewHttpContext<true>,

    pub queued_tasks: Queue,
    /// Tasks popped from `queued_tasks` that couldn't start because
    /// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
    /// and processed before `queued_tasks` on the next `drainEvents`. Owned by
    /// the HTTP thread; never accessed concurrently.
    pub deferred_tasks: Vec<*mut AsyncHttp>,
    /// Set by `drainQueuedShutdowns` when a shutdown's `async_http_id` wasn't in
    /// `socket_async_http_abort_tracker` — the request is either not yet started
    /// (still in `queued_tasks`/`deferred_tasks`) or already done. `drainEvents`
    /// uses this to decide whether it must scan the queued/deferred lists for
    /// aborted tasks when `active >= max`; without it the common at-capacity
    /// path stays O(1). Owned by the HTTP thread.
    pub has_pending_queued_abort: bool,

    pub queued_shutdowns: Vec<ShutdownMessage>,
    pub queued_writes: Vec<WriteMessage>,
    pub queued_response_body_drains: Vec<DrainMessage>,

    pub queued_shutdowns_lock: Mutex,
    pub queued_writes_lock: Mutex,
    pub queued_response_body_drains_lock: Mutex,

    pub queued_threadlocal_proxy_derefs: Vec<*mut ProxyTunnel>,

    pub has_awoken: AtomicBool,
    pub timer: Instant,
    pub lazy_libdeflater: Option<Box<LibdeflateState>>,
    pub lazy_request_body_buffer: Option<Box<HeapRequestBodyBuffer>>,
}

pub struct HeapRequestBodyBuffer {
    pub buffer: [u8; 512 * 1024],
    pub fixed_buffer_allocator: bun_alloc::FixedBufferAllocator,
    // TODO(port): `fixed_buffer_allocator` borrows `buffer` — self-referential. Phase B: store only a cursor.
}

impl HeapRequestBodyBuffer {
    pub fn init() -> Box<Self> {
        let mut this = Box::new(HeapRequestBodyBuffer {
            buffer: [0u8; 512 * 1024],
            // SAFETY: overwritten immediately below once `buffer` has a stable address.
            fixed_buffer_allocator: unsafe { core::mem::zeroed() },
        });
        // TODO(port): self-referential init; FixedBufferAllocator borrows this.buffer.
        this.fixed_buffer_allocator = bun_alloc::FixedBufferAllocator::init(&mut this.buffer);
        this
    }

    pub fn put(mut self: Box<Self>) {
        // SAFETY: HTTP-thread-only access to the global.
        let thread = crate::http_thread_mut();
        if thread.lazy_request_body_buffer.is_none() {
            self.fixed_buffer_allocator.reset();
            thread.lazy_request_body_buffer = Some(self);
        } else {
            // This case hypothetically should never happen
            drop(self);
        }
    }
}

pub enum RequestBodyBuffer {
    // Option<> so Drop can `.take()` the Box and hand it to `put()` (which consumes by value).
    Heap(Option<Box<HeapRequestBodyBuffer>>),
    // PERF(port): was std.heap.StackFallbackAllocator(32KB) — inline stack buffer with heap fallback.
    Stack(bun_alloc::StackFallbackAllocator<REQUEST_BODY_SEND_STACK_BUFFER_SIZE>),
}

impl Drop for RequestBodyBuffer {
    fn drop(&mut self) {
        if let Self::Heap(heap) = self {
            if let Some(h) = heap.take() {
                h.put();
            }
        }
    }
}

impl RequestBodyBuffer {
    pub fn allocated_slice(&mut self) -> &mut [u8] {
        match self {
            Self::Heap(heap) => &mut heap.as_mut().unwrap().buffer,
            Self::Stack(stack) => stack.buffer_mut(),
        }
    }

    pub fn to_array_list(&mut self) -> Vec<u8> {
        // TODO(port): Zig built an ArrayList over self.allocator()/self.allocated_slice() with len=0.
        // Rust Vec cannot adopt a foreign allocator+buffer; Phase B should expose a cursor type instead.
        // PERF(port): was FixedBufferAllocator/StackFallback — redesign in Phase B (allocator() accessor
        // dropped per PORTING.md non-AST rule; callers should write into allocated_slice() directly).
        let mut arraylist = Vec::with_capacity(self.allocated_slice().len());
        arraylist.clear();
        arraylist
    }
}

pub struct WriteMessage {
    pub async_http_id: u32,
    pub message_type: WriteMessageType,
}

#[repr(u8)] // Zig: enum(u2)
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum WriteMessageType {
    Data = 0,
    End = 1,
}

pub struct DrainMessage {
    pub async_http_id: u32,
}

pub struct ShutdownMessage {
    pub async_http_id: u32,
}

pub struct LibdeflateState {
    pub decompressor: *mut bun_libdeflate_sys::Decompressor,
    pub shared_buffer: [u8; 512 * 1024],
}

impl Drop for LibdeflateState {
    fn drop(&mut self) {
        // SAFETY: decompressor was allocated by libdeflate and is owned by this struct.
        unsafe { bun_libdeflate_sys::Decompressor::deinit(self.decompressor) };
    }
}

const REQUEST_BODY_SEND_STACK_BUFFER_SIZE: usize = 32 * 1024;

impl HttpThread {
    #[inline]
    pub fn get_request_body_send_buffer(&mut self, estimated_size: usize) -> RequestBodyBuffer {
        if estimated_size >= REQUEST_BODY_SEND_STACK_BUFFER_SIZE {
            if self.lazy_request_body_buffer.is_none() {
                bun_output::scoped_log!(
                    HTTPThread_log,
                    "Allocating HeapRequestBodyBuffer due to {} bytes request body",
                    estimated_size
                );
                return RequestBodyBuffer::Heap(Some(HeapRequestBodyBuffer::init()));
            }

            return RequestBodyBuffer::Heap(self.lazy_request_body_buffer.take());
        }
        RequestBodyBuffer::Stack(bun_alloc::StackFallbackAllocator::new())
        // PERF(port): was std.heap.stackFallback(REQUEST_BODY_SEND_STACK_BUFFER_SIZE, default_allocator)
    }

    pub fn deflater(&mut self) -> &mut LibdeflateState {
        if self.lazy_libdeflater.is_none() {
            let decompressor = bun_libdeflate_sys::Decompressor::alloc();
            if decompressor.is_null() {
                bun_core::out_of_memory();
            }
            self.lazy_libdeflater = Some(Box::new(LibdeflateState {
                decompressor,
                shared_buffer: [0u8; 512 * 1024],
            }));
        }

        self.lazy_libdeflater.as_deref_mut().unwrap()
    }

    /// Zig `timer.read()` returns u64 ns directly; Rust `Instant::elapsed().as_nanos()` is u128.
    /// Checked narrow — overflows only after ~584 years of process uptime.
    #[inline]
    fn timer_read(&self) -> u64 {
        u64::try_from(self.timer.elapsed().as_nanos()).unwrap()
    }
}

fn on_init_error_noop(err: InitError, opts: InitOpts) -> ! {
    match err {
        InitError::LoadCAFile => {
            if !bun_sys::exists_z(opts.abs_ca_file_name) {
                Output::err(
                    "HTTPThread",
                    format_args!("failed to find CA file: '{}'", bstr::BStr::new(opts.abs_ca_file_name.as_bytes())),
                );
            } else {
                Output::err(
                    "HTTPThread",
                    format_args!("failed to load CA file: '{}'", bstr::BStr::new(opts.abs_ca_file_name.as_bytes())),
                );
            }
        }
        InitError::InvalidCAFile => {
            Output::err(
                "HTTPThread",
                format_args!("the CA file is invalid: '{}'", bstr::BStr::new(opts.abs_ca_file_name.as_bytes())),
            );
        }
        InitError::InvalidCA => {
            Output::err("HTTPThread", format_args!("the provided CA is invalid"));
        }
        InitError::FailedToOpenSocket => {
            Output::err_generic(format_args!("failed to start HTTP client thread"));
        }
    }
    Global::crash();
}

#[derive(Clone)]
pub struct InitOpts {
    // TODO(port): lifetime — Zig `[]stringZ` borrowed from caller config; copied into spawned thread.
    pub ca: &'static [&'static ZStr],
    pub abs_ca_file_name: &'static ZStr,
    pub for_install: bool,

    pub on_init_error: fn(err: InitError, opts: InitOpts) -> !,
}

impl Default for InitOpts {
    fn default() -> Self {
        Self {
            ca: &[],
            abs_ca_file_name: ZStr::EMPTY,
            for_install: false,
            on_init_error: on_init_error_noop,
        }
    }
}

fn init_once(opts: &InitOpts) {
    // SAFETY: single-call (guarded by Once); http_thread is the global singleton.
    *crate::http_thread_mut() = HttpThread {
        // TODO(port): Zig left `loop` undefined here; assigned in on_start. Rust needs a placeholder.
        loop_: MiniEventLoop::placeholder(),
        http_context: NewHttpContext::<false> {
            ref_count: bun_ptr::RefCount::init(),
            pending_sockets: <NewHttpContext<false>>::PooledSocketHiveAllocator::EMPTY,
            ..Default::default()
        },
        https_context: NewHttpContext::<true> {
            ref_count: bun_ptr::RefCount::init(),
            pending_sockets: <NewHttpContext<true>>::PooledSocketHiveAllocator::EMPTY,
            ..Default::default()
        },
        timer: Instant::now(),
        queued_tasks: Queue::new(),
        deferred_tasks: Vec::new(),
        has_pending_queued_abort: false,
        queued_shutdowns: Vec::new(),
        queued_writes: Vec::new(),
        queued_response_body_drains: Vec::new(),
        queued_shutdowns_lock: Mutex::new(),
        queued_writes_lock: Mutex::new(),
        queued_response_body_drains_lock: Mutex::new(),
        queued_threadlocal_proxy_derefs: Vec::new(),
        has_awoken: AtomicBool::new(false),
        lazy_libdeflater: None,
        lazy_request_body_buffer: None,
    };
    bun_libdeflate_sys::load();
    let opts_copy = opts.clone();
    let thread = std::thread::Builder::new()
        .stack_size(bun_core::DEFAULT_THREAD_STACK_SIZE)
        .spawn(move || on_start(opts_copy));
    match thread {
        Ok(t) => {
            // detach: drop the JoinHandle
            drop(t);
        }
        Err(err) => Output::panic(format_args!(
            "Failed to start HTTP Client thread: {}",
            err
        )),
    }
}

static INIT_ONCE: Once = Once::new();

pub fn init(opts: &InitOpts) {
    INIT_ONCE.call_once(|| init_once(opts));
}

pub fn on_start(opts: InitOpts) {
    Output::Source::configure_named_thread("HTTP Client");
    // PERF(port): was MimallocArena bulk-free for bun.http.default_allocator.
    crate::set_default_arena(Arena::init());
    // TODO(port): bun.http.default_allocator = arena.allocator() — global allocator hook removed in Rust.

    let loop_ = MiniEventLoop::init_global(None, None);

    #[cfg(windows)]
    {
        if bun_sys::windows::getenv_w(bun_str::w!("SystemRoot")).is_none() {
            Output::err_generic(format_args!(
                "The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work."
            ));
            Global::crash();
        }
    }

    let thread = crate::http_thread_mut();
    thread.loop_ = loop_;
    thread.http_context.init();
    if let Err(err) = thread.https_context.init_with_thread_opts(&opts) {
        (opts.on_init_error)(err, opts);
    }
    thread.has_awoken.store(true, Ordering::Relaxed);
    thread.process_events();
}

impl HttpThread {
    pub fn connect<const IS_SSL: bool>(
        &mut self,
        client: &mut HttpClient,
    ) -> Result<Option<<NewHttpContext<IS_SSL> as crate::HttpContextTypes>::HttpSocket>, bun_core::Error>
    // TODO(port): narrow error set
    {
        if client.unix_socket_path.length() > 0 {
            return self
                .context::<IS_SSL>()
                .connect_socket(client, client.unix_socket_path.slice());
        }

        if IS_SSL {
            'custom_ctx: {
                let Some(tls) = client.tls_props.as_ref() else { break 'custom_ctx };
                if !tls.get().requires_custom_request_ctx {
                    break 'custom_ctx;
                }
                let requested_config: *const SslConfig = tls.get();

                // Evict stale entries from the cache
                self.evict_stale_ssl_contexts();

                // Look up by pointer equality (configs are interned)
                if let Some(entry) = custom_ssl_context_map().get_mut(&requested_config) {
                    // Cache hit - reuse existing SSL context
                    entry.last_used_ns = self.timer_read();
                    client.set_custom_ssl_ctx(entry.ctx.clone());
                    // Keepalive is now supported for custom SSL contexts
                    if let Some(url) = &client.http_proxy {
                        return entry.ctx.connect(client, url.hostname, url.get_port_auto());
                    } else {
                        return entry
                            .ctx
                            .connect(client, client.url.hostname, client.url.get_port_auto());
                    }
                }

                // Cache miss - create new SSL context
                // TODO(port): Zig used allocator.create + manual destroy on error; here Arc owns it.
                let mut custom_context = Arc::new(NewHttpContext::<true> {
                    ref_count: bun_ptr::RefCount::init(),
                    pending_sockets: <NewHttpContext<true>>::PooledSocketHiveAllocator::EMPTY,
                    ..Default::default()
                });
                if let Err(err) = Arc::get_mut(&mut custom_context)
                    .unwrap()
                    .init_with_client_config(client)
                {
                    drop(custom_context);

                    return Err(match err {
                        InitError::FailedToOpenSocket => bun_core::err!("FailedToOpenSocket"),
                        InitError::InvalidCA => bun_core::err!("FailedToOpenSocket"),
                        InitError::InvalidCAFile => bun_core::err!("FailedToOpenSocket"),
                        InitError::LoadCAFile => bun_core::err!("FailedToOpenSocket"),
                    });
                }

                let now = self.timer_read();
                custom_ssl_context_map().put(
                    requested_config,
                    SslContextCacheEntry {
                        ctx: custom_context.clone(),
                        last_used_ns: now,
                        // Clone a strong ref for the cache entry; client.tls_props keeps its own.
                        config_ref: tls.clone(),
                    },
                );

                // Enforce max cache size - evict oldest entry
                if custom_ssl_context_map().count() > SSL_CONTEXT_CACHE_MAX_SIZE {
                    evict_oldest_ssl_context();
                }

                client.set_custom_ssl_ctx(custom_context.clone());
                // Keepalive is now supported for custom SSL contexts
                if let Some(url) = &client.http_proxy {
                    if url.protocol.is_empty()
                        || url.protocol == b"https"
                        || url.protocol == b"http"
                    {
                        return custom_context.connect(client, url.hostname, url.get_port_auto());
                    }
                    return Err(bun_core::err!("UnsupportedProxyProtocol"));
                }
                return custom_context.connect(client, client.url.hostname, client.url.get_port_auto());
            }
        }
        if let Some(url) = &client.http_proxy {
            if !url.href.is_empty() {
                // https://github.com/oven-sh/bun/issues/11343
                if url.protocol.is_empty() || url.protocol == b"https" || url.protocol == b"http" {
                    return self
                        .context::<IS_SSL>()
                        .connect(client, url.hostname, url.get_port_auto());
                }
                return Err(bun_core::err!("UnsupportedProxyProtocol"));
            }
        }
        self.context::<IS_SSL>()
            .connect(client, client.url.hostname, client.url.get_port_auto())
    }

    pub fn context<const IS_SSL: bool>(&mut self) -> &mut NewHttpContext<IS_SSL> {
        // TODO(port): const-generic dispatch over two distinct fields needs transmute or a trait in Phase B.
        if IS_SSL {
            // SAFETY: NewHttpContext<true> and NewHttpContext<IS_SSL> are the same type when IS_SSL.
            unsafe { core::mem::transmute(&mut self.https_context) }
        } else {
            // SAFETY: same as above for false.
            unsafe { core::mem::transmute(&mut self.http_context) }
        }
    }

    /// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
    fn evict_stale_ssl_contexts(&mut self) {
        let now = self.timer_read();
        let map = custom_ssl_context_map();
        let mut i: usize = 0;
        while i < map.count() {
            let entry_last_used = map.values()[i].last_used_ns;
            if now.saturating_sub(entry_last_used) > SSL_CONTEXT_CACHE_TTL_NS {
                let entry = map.swap_remove_at(i);
                drop(entry.ctx); // entry.ctx.deref()
                drop(entry.config_ref); // entry.config_ref.deinit()
            } else {
                i += 1;
            }
        }
    }
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
    let entry = map.swap_remove_at(oldest_idx);
    drop(entry.ctx); // entry.ctx.deref()
    drop(entry.config_ref); // entry.config_ref.deinit()
}

impl HttpThread {
    fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
        if self.https_context.abort_pending_h2_waiter(async_http_id) {
            return true;
        }
        for entry in custom_ssl_context_map().values() {
            if entry.ctx.abort_pending_h2_waiter(async_http_id) {
                return true;
            }
        }
        false
    }

    fn drain_queued_shutdowns(&mut self) {
        loop {
            // socket.close() can potentially be slow
            // Let's not block other threads while this runs.
            let queued_shutdowns = {
                self.queued_shutdowns_lock.lock();
                let _guard = scopeguard::guard((), |_| self.queued_shutdowns_lock.unlock());
                // TODO(port): bun.Mutex is a raw lock; Phase B: use RAII guard.
                core::mem::take(&mut self.queued_shutdowns)
            };

            for http in &queued_shutdowns {
                if let Some(socket_ptr) =
                    crate::socket_async_http_abort_tracker().fetch_swap_remove(http.async_http_id)
                {
                    match socket_ptr.value {
                        crate::SocketPtr::SocketTLS(socket) => {
                            let tagged = NewHttpContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // If we only call socket.close(), then it won't
                                // call `onClose` if this happens before `onOpen` is
                                // called.
                                //
                                client.close_and_abort::<true>(socket);
                                continue;
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.abort_by_http_id(http.async_http_id);
                                continue;
                            }
                            socket.close(crate::CloseReason::Failure);
                        }
                        crate::SocketPtr::SocketTCP(socket) => {
                            let tagged = NewHttpContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                client.close_and_abort::<false>(socket);
                                continue;
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.abort_by_http_id(http.async_http_id);
                                continue;
                            }
                            socket.close(crate::CloseReason::Failure);
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
                    if h3::ClientContext::abort_by_http_id(http.async_http_id) {
                        continue;
                    }
                    // Otherwise the request either hasn't started yet (still in
                    // `queued_tasks`/`deferred_tasks`) or has already completed.
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
            bun_output::scoped_log!(HTTPThread, "drained {} queued shutdowns", len);
        }
    }

    fn drain_queued_writes(&mut self) {
        loop {
            let queued_writes = {
                self.queued_writes_lock.lock();
                let _guard = scopeguard::guard((), |_| self.queued_writes_lock.unlock());
                core::mem::take(&mut self.queued_writes)
            };
            for write in &queued_writes {
                let message = write.message_type;
                let ended = message == WriteMessageType::End;

                if let Some(socket_ptr) =
                    crate::socket_async_http_abort_tracker().get(write.async_http_id)
                {
                    match socket_ptr {
                        crate::SocketPtr::SocketTLS(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = NewHttpContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                if let crate::OriginalRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<true>(socket);
                                }
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.stream_body_by_http_id(write.async_http_id, ended);
                            }
                        }
                        crate::SocketPtr::SocketTCP(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = NewHttpContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                if let crate::OriginalRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<false>(socket);
                                }
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.stream_body_by_http_id(write.async_http_id, ended);
                            }
                        }
                    }
                } else {
                    h3::ClientContext::stream_body_by_http_id(write.async_http_id, ended);
                }
            }
            let len = queued_writes.len();
            drop(queued_writes);
            if len == 0 {
                break;
            }
            bun_output::scoped_log!(HTTPThread, "drained {} queued writes", len);
        }
    }

    fn drain_queued_http_response_body_drains(&mut self) {
        loop {
            // socket.close() can potentially be slow
            // Let's not block other threads while this runs.
            let queued_response_body_drains = {
                self.queued_response_body_drains_lock.lock();
                let _guard =
                    scopeguard::guard((), |_| self.queued_response_body_drains_lock.unlock());
                core::mem::take(&mut self.queued_response_body_drains)
            };

            for drain in &queued_response_body_drains {
                if let Some(socket_ptr) =
                    crate::socket_async_http_abort_tracker().get(drain.async_http_id)
                {
                    match socket_ptr {
                        crate::SocketPtr::SocketTLS(socket) => {
                            let tagged = NewHttpContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                client.drain_response_body::<true>(socket);
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.drain_response_body_by_http_id(drain.async_http_id);
                            }
                        }
                        crate::SocketPtr::SocketTCP(socket) => {
                            let tagged = NewHttpContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                client.drain_response_body::<false>(socket);
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                session.drain_response_body_by_http_id(drain.async_http_id);
                            }
                        }
                    }
                }
            }
            let len = queued_response_body_drains.len();
            drop(queued_response_body_drains);
            if len == 0 {
                break;
            }
            bun_output::scoped_log!(HTTPThread, "drained {} queued drains", len);
        }
    }

    fn drain_events(&mut self) {
        // Process any pending writes **before** aborting.
        self.drain_queued_http_response_body_drains();
        self.drain_queued_writes();
        self.drain_queued_shutdowns();
        h3::PendingConnect::drain_resolved();

        for http in self.queued_threadlocal_proxy_derefs.drain(..) {
            // SAFETY: pointer was queued by schedule_proxy_deref on this thread; still live.
            unsafe { (*http).deref() };
        }
        // .clearRetainingCapacity() — drain(..) above already cleared while keeping capacity.

        let mut count: usize = 0;
        let mut active = AsyncHttp::active_requests_count().load(Ordering::Relaxed);
        let max = AsyncHttp::max_simultaneous_requests().load(Ordering::Relaxed);
        let _defer_log = scopeguard::guard((), |_| {
            if cfg!(debug_assertions) {
                if count > 0 {
                    bun_output::scoped_log!(HTTPThread_log, "Processed {} tasks\n", count);
                }
            }
        });

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
        // anything still in `queued_tasks`.
        //
        // Already-aborted tasks are started regardless of `max`: `start_()` will
        // observe the `aborted` signal and fail immediately with
        // `error.AbortedBeforeConnecting`, and `onAsyncHTTPCallback` decrements
        // `active_requests_count` in the same turn — so they never hold a slot.
        // Without this, an aborted fetch that was queued behind `max` would sit
        // there until some unrelated request completed; if every active request
        // is itself hung, the aborted one never settles and its promise hangs
        // forever even though the user called `controller.abort()`.
        //
        // `startQueuedTask` can re-enter `onAsyncHTTPCallback` synchronously (for
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
                // SAFETY: AsyncHttp pointer is owned by caller, alive until completion callback.
                let aborted = unsafe { (*http).client.signals.get(crate::Signal::Aborted) };
                if aborted || active < max {
                    start_queued_task(http);
                    if cfg!(debug_assertions) {
                        count += 1;
                    }
                    active = AsyncHttp::active_requests_count().load(Ordering::Relaxed);
                } else {
                    self.deferred_tasks.push(http);
                }
            }
        }

        while let Some(http) = self.queued_tasks.pop() {
            // SAFETY: AsyncHttp pointer is owned by caller, alive until completion callback.
            let aborted = unsafe { (*http).client.signals.get(crate::Signal::Aborted) };
            if !aborted && active >= max {
                // Can't start this one yet. Defer it (preserves FIFO relative to
                // later pops) and keep draining — there may be aborted tasks
                // behind it that we can fail-fast right now.
                self.deferred_tasks.push(http);
                continue;
            }
            start_queued_task(http);
            if cfg!(debug_assertions) {
                count += 1;
            }
            active = AsyncHttp::active_requests_count().load(Ordering::Relaxed);
        }
    }
}

fn start_queued_task(http: *mut AsyncHttp) {
    // SAFETY: http points to a live AsyncHttp queued by the caller thread.
    let cloned = unsafe {
        ThreadlocalAsyncHttp::new(ThreadlocalAsyncHttp {
            async_http: (*http).clone(),
            // TODO(port): Zig used struct copy `http.*`; AsyncHttp must be Clone or copied field-wise.
        })
    };
    cloned.async_http.real = Some(http);
    // Clear stale queue pointers - the clone inherited http.next and http.task.node.next
    // which may point to other AsyncHTTP structs that could be freed before the callback
    // copies data back to the original. If not cleared, retrying a failed request would
    // re-queue with stale pointers causing use-after-free.
    cloned.async_http.next = core::ptr::null_mut();
    cloned.async_http.task.node.next = core::ptr::null_mut();
    cloned.async_http.on_start();
}

impl HttpThread {
    fn process_events(&mut self) -> ! {
        #[cfg(unix)]
        {
            self.loop_.loop_.num_polls = self.loop_.loop_.num_polls.max(2);
        }
        #[cfg(windows)]
        {
            self.loop_.loop_.inc();
        }
        #[cfg(not(any(unix, windows)))]
        {
            compile_error!("TODO:");
        }

        loop {
            self.drain_events();
            #[cfg(debug_assertions)]
            if bun_core::asan::ENABLED {
                let tracker = crate::socket_async_http_abort_tracker();
                debug_assert_eq!(tracker.keys().len(), tracker.values().len());
                for (http_id, socket) in tracker.keys().iter().zip(tracker.values()) {
                    if let Some(usocket) = socket.socket().get() {
                        let _ = http_id;
                        bun_core::asan::assert_unpoisoned(usocket);
                    }
                }
            }

            let mut start_time: i128 = 0;
            if cfg!(debug_assertions) {
                start_time = bun_core::time::nano_timestamp();
            }
            Output::flush();

            self.loop_.loop_.inc();
            self.loop_.loop_.tick();
            self.loop_.loop_.dec();

            #[cfg(debug_assertions)]
            if bun_core::asan::ENABLED {
                let tracker = crate::socket_async_http_abort_tracker();
                debug_assert_eq!(tracker.keys().len(), tracker.values().len());
                for (http_id, socket) in tracker.keys().iter().zip(tracker.values()) {
                    if let Some(usocket) = socket.socket().get() {
                        let _ = http_id;
                        bun_core::asan::assert_unpoisoned(usocket);
                    }
                }
            }

            // this.loop.run();
            if cfg!(debug_assertions) {
                let end = bun_core::time::nano_timestamp();
                bun_output::scoped_log!(HTTPThread, "Waited {}\n", (end - start_time) as i64);
                Output::flush();
            }
        }
    }

    pub fn schedule_response_body_drain(&mut self, async_http_id: u32) {
        {
            self.queued_response_body_drains_lock.lock();
            let _guard =
                scopeguard::guard((), |_| self.queued_response_body_drains_lock.unlock());
            self.queued_response_body_drains.push(DrainMessage { async_http_id });
        }
        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }

    pub fn schedule_shutdown(&mut self, http: &AsyncHttp) {
        bun_output::scoped_log!(HTTPThread, "scheduleShutdown {}", http.async_http_id);
        {
            self.queued_shutdowns_lock.lock();
            let _guard = scopeguard::guard((), |_| self.queued_shutdowns_lock.unlock());
            self.queued_shutdowns.push(ShutdownMessage {
                async_http_id: http.async_http_id,
            });
        }
        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }

    pub fn schedule_request_write(&mut self, http: &AsyncHttp, message_type: WriteMessageType) {
        {
            self.queued_writes_lock.lock();
            let _guard = scopeguard::guard((), |_| self.queued_writes_lock.unlock());
            self.queued_writes.push(WriteMessage {
                async_http_id: http.async_http_id,
                message_type,
            });
        }
        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }

    pub fn schedule_proxy_deref(&mut self, proxy: *mut ProxyTunnel) {
        // this is always called on the http thread,
        self.queued_threadlocal_proxy_derefs.push(proxy);
        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }

    pub fn wakeup(&self) {
        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }

    pub fn schedule(&mut self, batch: Batch) {
        if batch.len == 0 {
            return;
        }

        {
            let mut batch_ = batch;
            while let Some(task) = batch_.pop() {
                // SAFETY: task points to AsyncHttp.task; recover parent via field offset.
                let http: *mut AsyncHttp = unsafe {
                    (task as *mut _ as *mut u8)
                        .sub(offset_of!(AsyncHttp, task))
                        .cast::<AsyncHttp>()
                };
                self.queued_tasks.push(http);
            }
        }

        if self.has_awoken.load(Ordering::Relaxed) {
            self.loop_.loop_.wakeup();
        }
    }
}

// TODO(port): UnboundedQueue is intrusive over `AsyncHttp.next`; encode field offset in Phase B.
pub type Queue = UnboundedQueue<AsyncHttp>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/HTTPThread.zig (741 lines)
//   confidence: medium
//   todos:      13
//   notes:      Mutex pattern uses scopeguard placeholder; FixedBufferAllocator/StackFallback self-referential buffers need Phase B redesign (allocator() accessor dropped); const-generic context() uses transmute; global mutable state (custom_ssl_context_map, http_thread) wrapped unsafely.
// ──────────────────────────────────────────────────────────────────────────
