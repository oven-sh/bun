use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use bun_collections::ArrayHashMap;
use bun_core::{self, Output};

use bun_threading::{Mutex, UnboundedQueue};
use bun_uws as uws;

use crate::async_http::{ACTIVE_REQUESTS_COUNT, MAX_SIMULTANEOUS_REQUESTS};
use crate::http_context::ActiveSocketExt;
use crate::proxy_tunnel::ProxyTunnel;
use crate::ssl_config::{self, SSLConfig};
use crate::{AsyncHttp, HTTPContext, HttpClient, InitError, NewHttpContext, h2, h3};

bun_core::declare_scope!(HTTPThread, hidden); // threadlog
bun_core::declare_scope!(HTTPThread_log, visible); // log
// TODO(port): Zig had two `Output.scoped(.HTTPThread, ...)` with different visibilities (.hidden + .visible).
// Rust scope registry keys on name; pick one visibility in Phase B or split scope names.

/// SSL context cache keyed by interned SSLConfig pointer.
/// Since configs are interned via SSLConfig.GlobalRegistry, pointer equality
/// is sufficient for lookup. Each entry holds a ref on its SSLConfig.
struct SslContextCacheEntry {
    /// Intrusive-refcounted custom-SSL context. The cache holds one strong
    /// ref (taken in `connect`); released via `ctx.deref()` on eviction.
    ctx: NonNull<NewHttpContext<true>>,
    last_used_ns: u64,
    /// Strong ref held by the cache entry (released on eviction).
    config_ref: ssl_config::SharedPtr,
}

impl SslContextCacheEntry {
    /// Mutable access to the cached `NewHttpContext`.
    ///
    /// INVARIANT: `ctx` is set once at insert (in `connect`) to a fresh
    /// `heap::release`-boxed `NewHttpContext` on which the cache holds one
    /// strong intrusive ref; it stays live until eviction's `deref` drops it.
    /// The map and all callers are HTTP-thread-only, so the returned `&mut`
    /// is the sole live borrow. Centralises the `Option<NonNull>`-style
    /// `(*entry.ctx.as_ptr()).…` raw deref repeated at every lookup.
    #[inline]
    fn ctx_mut<'a>(&self) -> &'a mut NewHttpContext<true> {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *self.ctx.as_ptr() }
    }

    /// Release the strong intrusive ref the cache holds on `ctx` (taken at
    /// insert in `connect`). Consumes the entry; `config_ref`'s `Drop` releases
    /// the SSLConfig ref. Centralises the raw
    /// `NewHttpContext::deref(entry.ctx.as_ptr())` open-coded at both eviction
    /// paths so the set-once `NonNull` is dereferenced in one place.
    fn release(self) {
        // SAFETY: same INVARIANT as [`ctx_mut`] — `ctx` is a
        // `heap::release`-boxed `NewHttpContext` on which the cache holds one
        // strong ref; this `deref` is its sole release.
        unsafe { NewHttpContext::<true>::deref(self.ctx.as_ptr()) };
        // self.config_ref drops here (entry.config_ref.deinit()).
    }
}
const SSL_CONTEXT_CACHE_MAX_SIZE: usize = 60;
const SSL_CONTEXT_CACHE_TTL_NS: u64 = 30 * (60 * 1_000_000_000); // 30 * std.time.ns_per_min

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

pub struct HttpThread {
    /// Per-thread `MiniEventLoop` singleton — published by
    /// `MiniEventLoop::init_global()` in [`on_start`]; outlives the thread
    /// (Zig: `bun.http.http_thread.loop = bun.jsc.MiniEventLoop.initGlobal(null, null)`,
    /// HTTPThread.zig:228+235).
    pub loop_: *const MiniEventLoop<'static>,
    /// The raw uSockets loop inside `loop_.loop` — split out so HTTPContext
    /// can `SocketGroup::init` without naming MiniEventLoop.
    pub uws_loop: *mut uws::Loop,
    pub http_context: NewHttpContext<false>,
    pub https_context: NewHttpContext<true>,
    /// Stashed `InitOpts` for the default HTTPS context. When the user passed
    /// no explicit CA config, `on_start` defers
    /// `https_context.init_with_thread_opts` (which calls
    /// `us_ssl_ctx_from_options` → `us_get_default_ca_store`, ~0.7 ms CPU +
    /// ~400 KB heap to parse the bundled root certs) until the first SSL
    /// connect actually arrives via [`HttpThread::connect`]`::<true>`. A
    /// fully-cached `bun install` never makes one, so the cost is skipped
    /// entirely. If `--cafile` / `--ca` *was* passed, `on_start` still runs
    /// init eagerly so a bad CA file crashes at thread start (the long-standing
    /// test contract) and this stays `None`. HTTP-thread-only after `on_start`;
    /// `Option::take` is the once-guard (no atomics needed — `connect` is never
    /// reentrant).
    lazy_https_init: Option<InitOpts>,

    pub queued_tasks: Queue,
    /// Tasks popped from `queued_tasks` that couldn't start because
    /// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
    /// and processed before `queued_tasks` on the next `drainEvents`. Owned by
    /// the HTTP thread; never accessed concurrently.
    pub deferred_tasks: Vec<NonNull<AsyncHttp<'static>>>,
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

impl HttpThread {
    /// Mirror of Zig `initOnce`'s `bun.http.http_thread = .{ ... }` field-init
    /// list (HTTPThread.zig:195-206). `loop_`/`uws_loop` are filled in by
    /// `on_start` on the spawned thread; `timer` is started on the calling
    /// thread per spec.
    fn new() -> Self {
        Self {
            loop_: core::ptr::null(),
            uws_loop: core::ptr::null_mut(),
            http_context: NewHttpContext::<false> {
                ref_count: Cell::new(1),
                pending_sockets: bun_collections::HiveArray::init(),
                group: uws::SocketGroup::default(),
                secure: None,
                active_h2_sessions: Vec::new(),
                pending_h2_connects: Vec::new(),
            },
            https_context: NewHttpContext::<true> {
                ref_count: Cell::new(1),
                pending_sockets: bun_collections::HiveArray::init(),
                group: uws::SocketGroup::default(),
                secure: None,
                active_h2_sessions: Vec::new(),
                pending_h2_connects: Vec::new(),
            },
            lazy_https_init: None,
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
            timer: Instant::now(),
            lazy_libdeflater: None,
            lazy_request_body_buffer: None,
        }
    }
}

pub struct HeapRequestBodyBuffer {
    pub buffer: [u8; 512 * 1024],
    // TODO(port): was `std.heap.FixedBufferAllocator` borrowing `buffer` —
    // self-referential. Phase B: bun_alloc::FixedBufferAllocator or just a cursor.
    pub cursor: usize,
}

impl HeapRequestBodyBuffer {
    pub fn init() -> Box<Self> {
        // TODO(port): self-referential init; FixedBufferAllocator borrows this.buffer.
        Box::new(HeapRequestBodyBuffer {
            buffer: [0u8; 512 * 1024],
            cursor: 0,
        })
    }

    pub fn put(mut self: Box<Self>) {
        // SAFETY: HTTP-thread-only access to the global.
        let thread = crate::http_thread_mut();
        if thread.lazy_request_body_buffer.is_none() {
            self.cursor = 0; // .reset()
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
    // TODO(b2-blocked): bun_alloc::StackFallbackAllocator<REQUEST_BODY_SEND_STACK_BUFFER_SIZE>
    Stack(Box<[u8; REQUEST_BODY_SEND_STACK_BUFFER_SIZE]>),
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
            Self::Stack(stack) => &mut stack[..],
        }
    }

    pub fn to_array_list(&mut self) -> Vec<u8> {
        // TODO(port): Zig built an ArrayList over self.arena()/self.allocated_slice() with len=0.
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
    pub kind: WriteMessageType,
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
    pub decompressor: *mut bun_libdeflate_sys::libdeflate::Decompressor,
    pub shared_buffer: [u8; 512 * 1024],
}

impl LibdeflateState {
    /// Mutable access to the libdeflate decompressor handle.
    ///
    /// INVARIANT: `decompressor` is set once in [`HttpThread::deflater`] from
    /// `libdeflate_alloc_decompressor` (panics on null) and is never freed
    /// until thread teardown. The handle is a separate C heap allocation
    /// disjoint from `self`, so the returned `&mut` does not alias
    /// `shared_buffer`. HTTP-thread-only — sole live borrow. Centralises the
    /// raw `&mut *deflater.decompressor` upgrade repeated at every
    /// `decompress` call site.
    #[inline]
    pub fn decompressor_mut<'a>(&self) -> &'a mut bun_libdeflate_sys::libdeflate::Decompressor {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *self.decompressor }
    }
}

pub const REQUEST_BODY_SEND_STACK_BUFFER_SIZE: usize = 32 * 1024;

// TODO(port): UnboundedQueue is intrusive over `AsyncHttp.next`; encode field offset in Phase B.
pub type Queue = UnboundedQueue<AsyncHttp<'static>>;

// Clone: bitwise OK for the `*const c_void` CA-string pointers — they borrow
// caller-owned config (Zig `[]stringZ`), not heap we free. The `Vec` itself
// deep-clones its slot list.
#[derive(Clone)]
pub struct InitOpts {
    // TODO(port): lifetime — Zig `[]stringZ` borrowed from caller config; copied into spawned thread.
    pub ca: Vec<*const c_void>, // *const [*:0]const u8
    pub abs_ca_file_name: &'static [u8],
    pub for_install: bool,

    pub on_init_error: fn(err: InitError, opts: &InitOpts) -> !,
}

// SAFETY: `ca` holds borrowed `[*:0]const u8` C-string pointers from caller
// config (Zig `[]stringZ`). They are copied into the spawned HTTP thread and
// only read there; no shared mutable state crosses the thread boundary.
unsafe impl Send for InitOpts {}

impl Default for InitOpts {
    fn default() -> Self {
        Self {
            ca: Vec::new(),
            abs_ca_file_name: b"",
            for_install: false,
            on_init_error: on_init_error_noop,
        }
    }
}

fn on_init_error_noop(err: InitError, opts: &InitOpts) -> ! {
    match err {
        InitError::LoadCAFile => {
            // SAFETY: `abs_ca_file_name` is Zig `stringZ` (`[:0]const u8`) by
            // contract — already passed as a C string to BoringSSL via
            // `init_with_thread_opts`, so `ptr[len] == 0` holds.
            let path = unsafe {
                bun_core::ZStr::from_raw(
                    opts.abs_ca_file_name.as_ptr(),
                    opts.abs_ca_file_name.len(),
                )
            };
            if !bun_sys::exists_z(path) {
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
        InitError::FailedToOpenSocket => {
            bun_core::err_generic!("failed to start HTTP client thread");
        }
    }
    bun_core::Global::crash();
}

impl HttpThread {
    /// Raw uSockets loop for `SocketGroup::init`. Split from `loop_` so
    /// HTTPContext doesn't need to name the higher-tier MiniEventLoop type.
    #[inline]
    pub fn uws_loop(&self) -> *mut uws::Loop {
        self.uws_loop
    }

    /// Mutable access to the live uSockets event loop.
    ///
    /// INVARIANT: `uws_loop` is set once in [`on_start`] (published via the
    /// `has_awoken` Release store) and outlives the HTTP thread. The loop is a
    /// separate C heap allocation disjoint from `self`. HTTP-thread-only at
    /// every caller — `wakeup()` is the sole cross-thread entry and uses the
    /// raw FFI call instead. Centralises the raw `&mut *self.uws_loop`
    /// upgrade repeated in `process_events`.
    #[inline]
    fn uws_loop_mut<'a>(&self) -> &'a mut uws::Loop {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *self.uws_loop }
    }

    /// Zig `timer.read()` returns u64 ns directly; Rust `Instant::elapsed().as_nanos()` is u128.
    /// Checked narrow — overflows only after ~584 years of process uptime.
    #[inline]
    fn timer_read(&self) -> u64 {
        u64::try_from(self.timer.elapsed().as_nanos()).expect("int cast")
    }

    #[inline]
    pub fn get_request_body_send_buffer(&mut self, estimated_size: usize) -> RequestBodyBuffer {
        if estimated_size >= REQUEST_BODY_SEND_STACK_BUFFER_SIZE {
            if self.lazy_request_body_buffer.is_none() {
                bun_core::scoped_log!(
                    HTTPThread_log,
                    "Allocating HeapRequestBodyBuffer due to {} bytes request body",
                    estimated_size
                );
                return RequestBodyBuffer::Heap(Some(HeapRequestBodyBuffer::init()));
            }

            return RequestBodyBuffer::Heap(self.lazy_request_body_buffer.take());
        }
        // PERF(port): was std.heap.stackFallback(REQUEST_BODY_SEND_STACK_BUFFER_SIZE, default_allocator)
        RequestBodyBuffer::Stack(Box::new([0u8; REQUEST_BODY_SEND_STACK_BUFFER_SIZE]))
    }

    pub fn deflater(&mut self) -> &mut LibdeflateState {
        if self.lazy_libdeflater.is_none() {
            let decompressor = bun_libdeflate_sys::libdeflate::Decompressor::alloc();
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

    pub fn context<const IS_SSL: bool>(&mut self) -> &mut NewHttpContext<IS_SSL> {
        // PORT NOTE: const-generic dispatch over two distinct fields — `NewHttpContext<true>`
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
    /// thread from [`HttpThread::connect`]`::<true>` only; the `Option::take`
    /// is the once-guard. On failure, `on_init_error` diverges (matching the
    /// eager-init crash semantics from Zig `onStart`).
    #[inline]
    fn ensure_https_context_init(&mut self) {
        if let Some(opts) = self.lazy_https_init.take() {
            self.init_https_context_cold(opts);
        }
    }

    #[cold]
    fn init_https_context_cold(&mut self, opts: InitOpts) {
        if let Err(err) = self.https_context.init_with_thread_opts(&opts) {
            (opts.on_init_error)(err, &opts);
        }
    }

    pub fn connect<const IS_SSL: bool>(
        &mut self,
        client: &mut HttpClient,
    ) -> Result<Option<crate::HTTPSocket<IS_SSL>>, bun_core::Error>
// TODO(port): narrow error set
    {
        if IS_SSL {
            // First SSL connect: materialize the default HTTPS `SSL_CTX` +
            // socket group now (deferred from `on_start`). Runs once; every
            // SSL request — including unix-socket and proxy paths below —
            // funnels through here before touching `https_context.{group,secure}`.
            self.ensure_https_context_init();
        }
        // PORT NOTE: borrowck — `slice()` borrows `client`; capture into a
        // `bun_ptr::RawSlice` (encapsulated outlives-holder invariant) so the
        // borrow of `client` ends before we hand `&mut client` to
        // `connect_socket`. Backing storage is `client.unix_socket_path`, which
        // `connect_socket` does not touch.
        let unix_path = bun_ptr::RawSlice::new(client.unix_socket_path.slice());
        if !unix_path.is_empty() {
            return self
                .context::<IS_SSL>()
                .connect_socket(client, unix_path.slice());
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
                if let Some(entry) = custom_ssl_context_map().get_mut(&requested_config) {
                    // Cache hit - reuse existing SSL context
                    entry.last_used_ns = self.timer_read();
                    client.set_custom_ssl_ctx(entry.ctx);
                    let ctx = entry.ctx_mut();
                    // Keepalive is now supported for custom SSL contexts
                    return if let Some(url) = client.http_proxy.clone() {
                        ctx.connect(client, url.hostname, url.get_port_auto())
                    } else {
                        let (hn, pt) = (client.url.hostname, client.url.get_port_auto());
                        ctx.connect(client, hn, pt)
                    }
                    // PORT NOTE: NewHttpContext<true> == NewHttpContext<IS_SSL> here (IS_SSL branch).
                    .map(|o| o.map(|s| s.cast_ssl::<IS_SSL>()));
                }

                // Cache miss - create new SSL context
                // TODO(port): Zig used allocator.create + manual destroy on error.
                let custom_context = bun_core::heap::release(Box::new(NewHttpContext::<true> {
                    ref_count: Cell::new(1),
                    pending_sockets: bun_collections::HiveArray::init(),
                    group: uws::SocketGroup::default(),
                    secure: None,
                    active_h2_sessions: Vec::new(),
                    pending_h2_connects: Vec::new(),
                }));
                if let Err(err) = custom_context.init_with_client_config(client) {
                    // Spec HTTPThread.zig:277 raw-frees without `deinit` here
                    // because `initWithOpts` fails before `group.init()` runs.
                    // `impl Drop for HTTPContext` now tolerates an
                    // uninitialized group (skips close_all/destroy when
                    // `group.loop_` is null), so reclaiming the Box is safe.
                    // SAFETY: custom_context was just Box::leak'd above and
                    // has refcount 1; reclaim and drop on error.
                    drop(unsafe {
                        bun_core::heap::take(std::ptr::from_mut::<NewHttpContext<true>>(
                            custom_context,
                        ))
                    });

                    return Err(match err {
                        InitError::FailedToOpenSocket
                        | InitError::InvalidCA
                        | InitError::InvalidCAFile
                        | InitError::LoadCAFile => bun_core::err!("FailedToOpenSocket"),
                    });
                }

                let now = self.timer_read();
                let ctx_nn = NonNull::from(&mut *custom_context);
                let _ = custom_ssl_context_map().put(
                    requested_config,
                    SslContextCacheEntry {
                        ctx: ctx_nn,
                        last_used_ns: now,
                        // Strong ref for the cache entry; client.tls_props keeps its own.
                        config_ref: tls,
                    },
                );

                // Enforce max cache size - evict oldest entry
                if custom_ssl_context_map().count() > SSL_CONTEXT_CACHE_MAX_SIZE {
                    evict_oldest_ssl_context();
                }

                client.set_custom_ssl_ctx(ctx_nn);
                // Keepalive is now supported for custom SSL contexts
                let result = if let Some(url) = client.http_proxy.clone() {
                    if url.protocol.is_empty()
                        || url.protocol == b"https"
                        || url.protocol == b"http"
                    {
                        custom_context.connect(client, url.hostname, url.get_port_auto())
                    } else {
                        return Err(bun_core::err!("UnsupportedProxyProtocol"));
                    }
                } else {
                    let (hn, pt) = (client.url.hostname, client.url.get_port_auto());
                    custom_context.connect(client, hn, pt)
                };
                // PORT NOTE: NewHttpContext<true> == NewHttpContext<IS_SSL> here (IS_SSL branch).
                return result.map(|o| o.map(|s| s.cast_ssl::<IS_SSL>()));
            }
        }
        if let Some(url) = client.http_proxy.clone() {
            if !url.href.is_empty() {
                // https://github.com/oven-sh/bun/issues/11343
                if url.protocol.is_empty() || url.protocol == b"https" || url.protocol == b"http" {
                    return self.context::<IS_SSL>().connect(
                        client,
                        url.hostname,
                        url.get_port_auto(),
                    );
                }
                return Err(bun_core::err!("UnsupportedProxyProtocol"));
            }
        }
        let (hn, pt) = (client.url.hostname, client.url.get_port_auto());
        self.context::<IS_SSL>().connect(client, hn, pt)
    }

    /// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
    fn evict_stale_ssl_contexts(&mut self) {
        let now = self.timer_read();
        let map = custom_ssl_context_map();
        let mut i: usize = 0;
        while i < map.count() {
            let entry_last_used = map.values()[i].last_used_ns;
            if now.saturating_sub(entry_last_used) > SSL_CONTEXT_CACHE_TTL_NS {
                let (_k, entry) = map.swap_remove_at(i);
                entry.release();
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
            let queued_shutdowns = {
                let _guard = self.queued_shutdowns_lock.lock_guard();
                core::mem::take(&mut self.queued_shutdowns)
            };

            for http in &queued_shutdowns {
                let tracker = abort_tracker();
                let found_idx = tracker.keys().iter().position(|&k| k == http.async_http_id);
                if let Some(idx) = found_idx {
                    let (_k, socket_ptr) = tracker.swap_remove_at(idx);
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                // If we only call socket.close(), then it won't
                                // call `onClose` if this happens before `onOpen` is
                                // called.
                                client.close_and_abort::<true>(socket);
                                continue;
                            }
                            if let Some(session) = tagged.session_mut() {
                                session.abort_by_http_id(http.async_http_id);
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                client.close_and_abort::<false>(socket);
                                continue;
                            }
                            if let Some(session) = tagged.session_mut() {
                                session.abort_by_http_id(http.async_http_id);
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
            bun_core::scoped_log!(HTTPThread, "drained {} queued shutdowns", len);
        }
    }

    fn drain_queued_writes(&mut self) {
        loop {
            let queued_writes = {
                let _guard = self.queued_writes_lock.lock_guard();
                core::mem::take(&mut self.queued_writes)
            };
            for write in &queued_writes {
                let message = write.kind;
                let ended = message == WriteMessageType::End;

                if let Some(socket_ptr) = abort_tracker().get(&write.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                if let crate::HTTPRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<true>(socket);
                                }
                            }
                            if let Some(session) = tagged.session_mut() {
                                session.stream_body_by_http_id(write.async_http_id, ended);
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                if let crate::HTTPRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<false>(socket);
                                }
                            }
                            if let Some(session) = tagged.session_mut() {
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
            bun_core::scoped_log!(HTTPThread, "drained {} queued writes", len);
        }
    }

    fn drain_queued_http_response_body_drains(&mut self) {
        loop {
            // socket.close() can potentially be slow
            // Let's not block other threads while this runs.
            let queued_response_body_drains = {
                let _guard = self.queued_response_body_drains_lock.lock_guard();
                core::mem::take(&mut self.queued_response_body_drains)
            };

            for drain in &queued_response_body_drains {
                if let Some(socket_ptr) = abort_tracker().get(&drain.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                client.drain_response_body::<true>(socket);
                            }
                            if let Some(session) = tagged.session_mut() {
                                session.drain_response_body_by_http_id(drain.async_http_id);
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.client_mut() {
                                client.drain_response_body::<false>(socket);
                            }
                            if let Some(session) = tagged.session_mut() {
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
            bun_core::scoped_log!(HTTPThread, "drained {} queued drains", len);
        }
    }

    pub fn drain_events(&mut self) {
        // Process any pending writes **before** aborting.
        self.drain_queued_http_response_body_drains();
        self.drain_queued_writes();
        self.drain_queued_shutdowns();
        h3::PendingConnect::drain_resolved();

        for http in self.queued_threadlocal_proxy_derefs.drain(..) {
            // SAFETY: pointer was queued by schedule_proxy_deref on this thread; still live.
            unsafe { ProxyTunnel::deref(http) };
        }
        // .clearRetainingCapacity() — drain(..) above already cleared while keeping capacity.

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
                // AsyncHttp is heap-owned by the caller and alive until its
                // completion callback; while parked in `deferred_tasks` no other
                // borrow exists, so a transient `ParentRef` shared deref is sound.
                let aborted = bun_ptr::ParentRef::from(http)
                    .client
                    .signals
                    .get(crate::signals::Field::Aborted);
                if aborted || active < max {
                    start_queued_task(http.as_ptr());
                    if cfg!(debug_assertions) {
                        count += 1;
                    }
                    active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
                } else {
                    self.deferred_tasks.push(http);
                }
            }
        }

        loop {
            let Some(http) = NonNull::new(self.queued_tasks.pop()) else {
                break;
            };
            // AsyncHttp is heap-owned by the caller and alive until its
            // completion callback; the MPSC pop hands sole access to this
            // thread, so a transient `ParentRef` shared deref is sound.
            let aborted = bun_ptr::ParentRef::from(http)
                .client
                .signals
                .get(crate::signals::Field::Aborted);
            if !aborted && active >= max {
                // Can't start this one yet. Defer it (preserves FIFO relative to
                // later pops) and keep draining — there may be aborted tasks
                // behind it that we can fail-fast right now.
                self.deferred_tasks.push(http);
                continue;
            }
            start_queued_task(http.as_ptr());
            if cfg!(debug_assertions) {
                count += 1;
            }
            active = ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed);
        }

        if cfg!(debug_assertions) && count > 0 {
            bun_core::scoped_log!(HTTPThread_log, "Processed {} tasks\n", count);
        }
    }

    pub fn schedule_response_body_drain(&mut self, async_http_id: u32) {
        {
            let _guard = self.queued_response_body_drains_lock.lock_guard();
            self.queued_response_body_drains
                .push(DrainMessage { async_http_id });
        }
        self.wakeup();
    }

    pub fn schedule_shutdown(&mut self, http: &AsyncHttp) {
        bun_core::scoped_log!(HTTPThread, "scheduleShutdown {}", http.async_http_id);
        {
            let _guard = self.queued_shutdowns_lock.lock_guard();
            self.queued_shutdowns.push(ShutdownMessage {
                async_http_id: http.async_http_id,
            });
        }
        self.wakeup();
    }

    pub fn schedule_request_write(&mut self, http: &AsyncHttp, kind: WriteMessageType) {
        {
            let _guard = self.queued_writes_lock.lock_guard();
            self.queued_writes.push(WriteMessage {
                async_http_id: http.async_http_id,
                kind,
            });
        }
        self.wakeup();
    }

    pub fn schedule_proxy_deref(&mut self, proxy: *mut ProxyTunnel) {
        // this is always called on the http thread,
        self.queued_threadlocal_proxy_derefs.push(proxy);
        self.wakeup();
    }

    pub fn wakeup(&self) {
        // Acquire (not Relaxed): pairs with the Release store in `on_start`
        // so the read of `self.uws_loop` (a non-atomic field set there)
        // observes the published value. This is the canonical "Relaxed gives
        // no happens-before for the init it guards" case.
        if self.has_awoken.load(Ordering::Acquire) {
            // SAFETY: uws_loop is the live HTTP-thread loop set in on_start.
            // Call the raw extern (not `Loop::wakeup(&mut self)`) — this runs
            // cross-thread while the HTTP thread owns the loop, so forming
            // `&mut Loop` here would alias.
            unsafe { uws::us_wakeup_loop(self.uws_loop) };
        }
    }

    /// Enqueue a batch of `AsyncHttp` tasks for the HTTP thread. Safe to
    /// call from any thread: only touches the lock-free `queued_tasks` MPSC
    /// queue and `wakeup()` (atomic load + raw FFI call). This is the
    /// **only** cross-thread entry point — every other `HttpThread` method
    /// is HTTP-thread-only via [`http_thread()`](crate::http_thread).
    pub fn schedule(batch: bun_threading::thread_pool::Batch) {
        if batch.len == 0 {
            return;
        }
        // Release-mode guard: `HttpThread` has niche-bearing fields, so
        // dereffing `as_mut_ptr()` below on an uninitialized static is UB.
        // The "every caller goes through `init`" invariant was unenforced
        // (e.g. `async_http::preconnect` did not), so check it here. The
        // `Acquire` load pairs with `init_once`'s `Release` store to publish
        // the `HTTP_THREAD.write(..)` to this thread.
        assert!(
            crate::HTTP_THREAD_INIT.load(Ordering::Acquire),
            "HTTPThread::schedule() called before HTTPThread::init()"
        );
        // SAFETY: `HTTP_THREAD_INIT == true` (checked above) ⇒ `HTTP_THREAD`
        // is fully written. `get_unchecked` (no owner assert) so the
        // `ThreadCell` debug-owner check is skipped on this cross-thread
        // caller. Wrap the result in a `ParentRef` (process-lifetime backref)
        // so the `&self`-only calls below — `queued_tasks.push` (lock-free
        // MPSC) and `wakeup` (atomics + raw uws ptr) — go through the safe
        // `Deref` impl instead of open-coded `(*this_p)` raw derefs. Only a
        // shared `&HttpThread` is ever materialised; the HTTP thread itself
        // never holds a long-lived `&mut HttpThread` across the points these
        // touch (both fields are designed for cross-thread shared access).
        let this = unsafe {
            bun_ptr::ParentRef::<Self>::from_raw((*crate::HTTP_THREAD.get_unchecked()).as_mut_ptr())
        };
        {
            let mut batch_ = batch;
            while let Some(task) = batch_.pop() {
                // SAFETY: task points to AsyncHttp.task; recover parent via field offset.
                let http: *mut AsyncHttp =
                    unsafe { bun_core::from_field_ptr!(AsyncHttp, task, task.as_ptr()) };
                this.queued_tasks.push(http);
            }
        }
        this.wakeup();
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
    let (_k, entry) = map.swap_remove_at(oldest_idx);
    entry.release();
}

fn start_queued_task(http: *mut AsyncHttp) {
    // SAFETY: http points to a live AsyncHttp queued by the caller thread.
    let cloned = crate::ThreadlocalAsyncHttp::new(unsafe { core::ptr::read(http) });
    // PORT NOTE: Zig used struct copy `http.*`; AsyncHttp is byte-copied here
    // since the original stays valid (real owner is `http`, copy is the
    // HTTP-thread working set).
    let cloned = bun_core::heap::release(cloned);
    cloned.async_http.real = NonNull::new(http);
    // Clear stale queue pointers - the clone inherited http.next and http.task.node.next
    // which may point to other AsyncHTTP structs that could be freed before the callback
    // copies data back to the original. If not cleared, retrying a failed request would
    // re-queue with stale pointers causing use-after-free.
    cloned.async_http.next.clear();
    cloned.async_http.task.node.next = core::ptr::null_mut();
    cloned.async_http.on_start();
}

/// Borrow the HTTP-thread abort tracker. PORTING.md §Global mutable state:
/// HTTP-thread-only, per-statement reborrow.
#[inline]
fn abort_tracker() -> &'static mut ArrayHashMap<u32, uws::AnySocket> {
    crate::abort_tracker()
}

use core::cell::Cell;

// ═══════════════════════════════════════════════════════════════════════════
// init / on_start / process_events — depends on `bun_event_loop::MiniEventLoop`
// (higher-tier) for `loop_.loop_.{tick,inc,dec,num_polls}`. The wakeup path
// above uses the raw `*mut uws::Loop` directly so the rest of the thread
// machinery compiles; the actual event-loop drive stays gated until the tier
// boundary is resolved.
// TODO(b2-blocked): MiniEventLoop is in bun_event_loop (not in bun_http deps).
// ═══════════════════════════════════════════════════════════════════════════

mod _event_loop_draft {
    use super::*;
    use bun_core::Global;
    use std::sync::Once;

    static INIT_ONCE: Once = Once::new();
    // PORT NOTE: Zig `std.Thread.spawn` + `.detach()` allocates nothing on the
    // heap. Rust's `Builder::spawn` allocates an `Arc<thread::Inner>` (48 B)
    // shared between the `JoinHandle` and the new thread's TLS `current()`.
    // Dropping the handle leaves the only strong ref inside the spawned
    // thread's TLS, which LSAN does not scan as a root — so when the main
    // thread reaches `Global::exit` *before* the HTTP thread has installed
    // that TLS slot, LSAN reports the Arc as a direct leak and (with CI's
    // `abort_on_error=1`) the process SIGABRTs (exit 134). Park the handle in
    // a process-lifetime static so the Arc is always reachable from a global
    // root, matching the Zig semantics of "detach" without the false positive.
    static HTTP_THREAD_HANDLE: std::sync::OnceLock<std::thread::JoinHandle<()>> =
        std::sync::OnceLock::new();

    pub(super) fn init(opts: &InitOpts) {
        INIT_ONCE.call_once(|| init_once(opts));
    }

    fn init_once(opts: &InitOpts) {
        // Spec HTTPThread.zig:195-206 — initialize the global (with timer
        // started on the calling thread) BEFORE spawning, so `on_start`'s
        // `crate::http_thread_mut()` finds `Some(..)` and can fill in
        // `loop_`/`uws_loop`/contexts.
        // SAFETY: `init_once` runs under `Once`; no other thread reads
        // `HTTP_THREAD` until `has_awoken` is set in `on_start`.
        unsafe {
            (*crate::HTTP_THREAD.get()).write(HttpThread::new());
        }
        crate::HTTP_THREAD_INIT.store(true, core::sync::atomic::Ordering::Release);
        bun_libdeflate_sys::libdeflate::load();
        let opts_copy = opts.clone();
        let thread = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || on_start(opts_copy));
        match thread {
            // detach — see HTTP_THREAD_HANDLE note above re: LSAN reachability
            Ok(t) => {
                let _ = HTTP_THREAD_HANDLE.set(t);
            }
            Err(err) => Output::panic(format_args!("Failed to start HTTP Client thread: {}", err)),
        }
    }

    pub(super) fn on_start(opts: InitOpts) {
        Output::Source::configure_named_thread(bun_core::zstr!("HTTP Client"));
        // PERF(port): was MimallocArena bulk-free for bun.http.default_allocator.

        // uSockets' long-timeout counter is `% 240` minutes (see
        // `us_socket_long_timeout` in packages/bun-usockets/src/socket.c), so
        // values above 239 min wrap around and fire early. Clamp here — it's the
        // only assignment — so the underlying timer can't wrap, and round values
        // above 240s up to a whole minute so `socket.set_timeout`'s floor-to-
        // minute long-timer path never yields a timeout *shorter* than requested.
        // Normalising once here keeps the h1 (`HTTPClient::set_timeout`) and h2
        // (`ClientSession::rearm_timeout`) paths identical without duplicating the
        // math at each call site.
        let raw: u64 = bun_core::env_var::BUN_CONFIG_HTTP_IDLE_TIMEOUT
            .get()
            .unwrap_or(300)
            .min(239 * 60);
        crate::IDLE_TIMEOUT_SECONDS.store(
            (if raw > 240 {
                raw.div_ceil(60) * 60
            } else {
                raw
            }) as core::ffi::c_uint,
            core::sync::atomic::Ordering::Relaxed,
        );

        // Zig: `const loop = bun.jsc.MiniEventLoop.initGlobal(null, null)`
        // (HTTPThread.zig:228). Critical side effect: `init_global` calls
        // `internal_loop_data.set_parent_raw(2 /* mini */, mini_ptr)` on this
        // thread's uSockets loop. Without it, the macOS DNS cache-miss path
        // (`dns::getaddrinfo` → `(*loop).internal_loop_data.get_parent()`)
        // panics with `Parent loop not set - pointer is null`, which aborts
        // the process — `bun install` SIGABRT on the first uncached lookup.
        let loop_ = mini_event_loop::init_global(None, None);
        // `init_global` returns the heap-allocated thread-local singleton (never
        // null); this thread owns it for the thread lifetime. `loop_ptr()` reads
        // a stable field via `&self`, so a `ParentRef` shared deref suffices.
        let uws_loop = bun_ptr::ParentRef::from(
            NonNull::new(loop_).expect("init_global returns the thread-local singleton"),
        )
        .loop_ptr();

        #[cfg(windows)]
        {
            // `getenv_w` forwards `name.as_ptr()` directly to Win32
            // `GetEnvironmentVariableW`, which expects a NUL-terminated LPCWSTR.
            // `bun_core::w!` does NOT append a sentinel on its own (see
            // src/sys/windows/mod.rs WATCHER_CHILD_ENV_Z note), so embed `\0`
            // in the literal — Zig's `bun.strings.w("SystemRoot")` returns
            // `[:0]const u16`, this matches that spec (HTTPThread.zig:231).
            if bun_sys::windows::getenv_w(bun_core::w!("SystemRoot\0")).is_none() {
                Output::err_generic(
                    "The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.",
                    (),
                );
                Global::crash();
            }
        }

        let thread = crate::http_thread_mut();
        thread.loop_ = loop_;
        thread.uws_loop = uws_loop;
        thread.http_context.init();
        // `https_context.init_with_thread_opts` eagerly builds the BoringSSL
        // `SSL_CTX` and parses the bundled root-CA store
        // (`us_get_default_ca_store`, root_certs.cpp:210), costing ~0.7 ms CPU
        // and ~400 KB heap whether or not an HTTPS request ever happens. When
        // there is no user-supplied CA config we stash `opts` and let the first
        // `connect::<true>` call run it (see `HttpThread::lazy_https_init`) — a
        // fully-cached `bun install` (which makes zero network requests) then
        // skips the cost entirely.
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
        // Release: publishes `uws_loop`/`loop_` to cross-thread `wakeup()`
        // readers (which Acquire-load `has_awoken`).
        thread.has_awoken.store(true, Ordering::Release);
        thread.process_events();
    }

    impl HttpThread {
        fn process_events(&mut self) -> ! {
            let uws_loop = self.uws_loop_mut();
            #[cfg(unix)]
            {
                uws_loop.num_polls = uws_loop.num_polls.max(2);
            }
            #[cfg(windows)]
            {
                uws_loop.inc();
            }

            loop {
                self.drain_events();
                Output::flush();

                let uws_loop = self.uws_loop_mut();
                uws_loop.inc();
                uws_loop.tick();
                uws_loop.dec();

                if cfg!(debug_assertions) {
                    Output::flush();
                }
            }
        }
    }
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

// ported from: src/http/HTTPThread.zig
