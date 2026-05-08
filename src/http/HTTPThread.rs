use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use bun_collections::ArrayHashMap;
use bun_core::{self, Output};

use bun_threading::{Mutex, UnboundedQueue};
use bun_uws as uws;

use crate::async_http::{ACTIVE_REQUESTS_COUNT, MAX_SIMULTANEOUS_REQUESTS};
use crate::proxy_tunnel::ProxyTunnel;
use crate::ssl_config::{self, SSLConfig};
use crate::{h2, h3, AsyncHttp, HTTPContext, HttpClient, InitError, NewHttpContext};

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
const SSL_CONTEXT_CACHE_MAX_SIZE: usize = 60;
const SSL_CONTEXT_CACHE_TTL_NS: u64 = 30 * (60 * 1_000_000_000); // 30 * std.time.ns_per_min

// PORTING.md §Global mutable state: only ever accessed from the single HTTP
// client thread after `on_start`. RacyCell — thread affinity is the contract.
static CUSTOM_SSL_CONTEXT_MAP: bun_core::RacyCell<
    Option<ArrayHashMap<*const SSLConfig, SslContextCacheEntry>>,
> = bun_core::RacyCell::new(None);
/// Raw pointer to the (lazily-initialized) SSL-context cache. Callers reborrow
/// per-access — PORTING.md §Global mutable state.
fn custom_ssl_context_map() -> *mut ArrayHashMap<*const SSLConfig, SslContextCacheEntry> {
    // SAFETY: HTTP-thread-only; initialized on first call.
    unsafe { (*CUSTOM_SSL_CONTEXT_MAP.get()).get_or_insert_with(ArrayHashMap::new) as *mut _ }
}

// TODO(b2-blocked): `bun_event_loop` is a higher-tier crate (not in bun_http
// deps); MiniEventLoop is referenced only as a borrowed handle here. The
// inner `*mut uws::Loop` (what HTTPContext needs for SocketGroup::init) is
// surfaced separately so the layering hole is contained.
type MiniEventLoop = c_void;

pub struct HttpThread {
    // TODO(b2-blocked): &'static bun_event_loop::MiniEventLoop once that crate
    // is reachable from bun_http (currently higher-tier).
    pub loop_: *const MiniEventLoop,
    /// The raw uSockets loop inside `loop_.loop` — split out so HTTPContext
    /// can `SocketGroup::init` without naming MiniEventLoop.
    pub uws_loop: *mut uws::Loop,
    pub http_context: NewHttpContext<false>,
    pub https_context: NewHttpContext<true>,

    pub queued_tasks: Queue,
    /// Tasks popped from `queued_tasks` that couldn't start because
    /// `active_requests_count >= max_simultaneous_requests`. Kept in FIFO order
    /// and processed before `queued_tasks` on the next `drainEvents`. Owned by
    /// the HTTP thread; never accessed concurrently.
    pub deferred_tasks: Vec<*mut AsyncHttp<'static>>,
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

    pub fn connect<const IS_SSL: bool>(
        &mut self,
        client: &mut HttpClient,
    ) -> Result<Option<crate::HTTPSocket<IS_SSL>>, bun_core::Error>
    // TODO(port): narrow error set
    {
        let unix_path = client.unix_socket_path.slice();
        if !unix_path.is_empty() {
            // PORT NOTE: borrowck — slice() borrows `client`; copy out the
            // pointer/len before passing &mut client.
            // SAFETY: unix_socket_path borrows storage that outlives this call.
            let path: &[u8] =
                unsafe { core::slice::from_raw_parts(unix_path.as_ptr(), unix_path.len()) };
            return self.context::<IS_SSL>().connect_socket(client, path);
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
                // SAFETY: HTTP-thread only; per-statement reborrow.
                if let Some(entry) = unsafe { &mut *custom_ssl_context_map() }.get_mut(&requested_config) {
                    // Cache hit - reuse existing SSL context
                    entry.last_used_ns = self.timer_read();
                    client.set_custom_ssl_ctx(entry.ctx);
                    let ctx = entry.ctx.as_ptr();
                    // Keepalive is now supported for custom SSL contexts
                    // SAFETY: cache holds a strong ref; ctx alive until eviction.
                    return unsafe {
                        if let Some(url) = client.http_proxy.clone() {
                            (*ctx).connect(client, url.hostname, url.get_port_auto())
                        } else {
                            let (hn, pt) = (client.url.hostname, client.url.get_port_auto());
                            (*ctx).connect(client, hn, pt)
                        }
                    }
                    // PORT NOTE: NewHttpContext<true> == NewHttpContext<IS_SSL> here (IS_SSL branch).
                    .map(|o| o.map(|s| unsafe { core::mem::transmute_copy(&s) }));
                }

                // Cache miss - create new SSL context
                // TODO(port): Zig used allocator.create + manual destroy on error.
                let custom_context = Box::leak(Box::new(NewHttpContext::<true> {
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
                    drop(unsafe { Box::from_raw(std::ptr::from_mut::<NewHttpContext<true>>(custom_context)) });

                    return Err(match err {
                        InitError::FailedToOpenSocket
                        | InitError::InvalidCA
                        | InitError::InvalidCAFile
                        | InitError::LoadCAFile => bun_core::err!("FailedToOpenSocket"),
                    });
                }

                let now = self.timer_read();
                // SAFETY: custom_context is a live Box::leak'd allocation.
                let ctx_nn = unsafe { NonNull::new_unchecked(std::ptr::from_mut(custom_context)) };
                // SAFETY: HTTP-thread only.
                let _ = unsafe { &mut *custom_ssl_context_map() }.put(
                    requested_config,
                    SslContextCacheEntry {
                        ctx: ctx_nn,
                        last_used_ns: now,
                        // Strong ref for the cache entry; client.tls_props keeps its own.
                        config_ref: tls,
                    },
                );

                // Enforce max cache size - evict oldest entry
                // SAFETY: HTTP-thread only.
                if unsafe { (*custom_ssl_context_map()).count() } > SSL_CONTEXT_CACHE_MAX_SIZE {
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
                return result.map(|o| o.map(|s| unsafe { core::mem::transmute_copy(&s) }));
            }
        }
        if let Some(url) = client.http_proxy.clone() {
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
        let (hn, pt) = (client.url.hostname, client.url.get_port_auto());
        self.context::<IS_SSL>().connect(client, hn, pt)
    }

    /// Evict SSL context cache entries that haven't been used for ssl_context_cache_ttl_ns.
    fn evict_stale_ssl_contexts(&mut self) {
        let now = self.timer_read();
        // SAFETY: HTTP-thread only; sole live `&mut` for the loop below.
        let map = unsafe { &mut *custom_ssl_context_map() };
        let mut i: usize = 0;
        while i < map.count() {
            let entry_last_used = map.values()[i].last_used_ns;
            if now.saturating_sub(entry_last_used) > SSL_CONTEXT_CACHE_TTL_NS {
                let (_k, entry) = map.swap_remove_at(i);
                // SAFETY: cache holds one strong ref taken at insert.
                unsafe { NewHttpContext::<true>::deref(entry.ctx.as_ptr()) };
                drop(entry.config_ref); // entry.config_ref.deinit()
            } else {
                i += 1;
            }
        }
    }

    fn abort_pending_h2_waiter(&mut self, async_http_id: u32) -> bool {
        if self.https_context.abort_pending_h2_waiter(async_http_id) {
            return true;
        }
        // SAFETY: HTTP-thread only; iterator borrows for the loop body.
        for entry in unsafe { &mut *custom_ssl_context_map() }.values_mut() {
            // SAFETY: cache holds a strong ref; ctx alive.
            if unsafe { (*entry.ctx.as_ptr()).abort_pending_h2_waiter(async_http_id) } {
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
                // SAFETY: HTTP-thread only; reborrowed each iteration.
                let tracker = unsafe { &mut *abort_tracker() };
                let found_idx = tracker
                    .keys()
                    .iter()
                    .position(|&k| k == http.async_http_id);
                if let Some(idx) = found_idx {
                    let (_k, socket_ptr) = tracker.swap_remove_at(idx);
                    match socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // If we only call socket.close(), then it won't
                                // call `onClose` if this happens before `onOpen` is
                                // called.
                                //
                                // SAFETY: tagged-pointer recovered from socket ext.
                                unsafe { (*client).close_and_abort::<true>(socket) };
                                continue;
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe { (*session).abort_by_http_id(http.async_http_id) };
                                continue;
                            }
                            socket.close(uws::CloseKind::Failure);
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // SAFETY: tagged-pointer recovered from socket ext.
                                unsafe { (*client).close_and_abort::<false>(socket) };
                                continue;
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe { (*session).abort_by_http_id(http.async_http_id) };
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

                // SAFETY: HTTP-thread only; per-statement reborrow.
                if let Some(socket_ptr) = unsafe { &*abort_tracker() }.get(&write.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // SAFETY: tagged-pointer recovered from socket ext.
                                let client = unsafe { &mut *client };
                                if let crate::HTTPRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<true>(socket);
                                }
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe {
                                    (*session).stream_body_by_http_id(write.async_http_id, ended)
                                };
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            if socket.is_closed() || socket.is_shutdown() {
                                continue;
                            }
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // SAFETY: tagged-pointer recovered from socket ext.
                                let client = unsafe { &mut *client };
                                if let crate::HTTPRequestBody::Stream(stream) =
                                    &mut client.state.original_request_body
                                {
                                    stream.ended = ended;
                                    client.flush_stream::<false>(socket);
                                }
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe {
                                    (*session).stream_body_by_http_id(write.async_http_id, ended)
                                };
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
                // SAFETY: HTTP-thread only; per-statement reborrow.
                if let Some(socket_ptr) = unsafe { &*abort_tracker() }.get(&drain.async_http_id) {
                    match *socket_ptr {
                        uws::AnySocket::SocketTls(socket) => {
                            let tagged = HTTPContext::<true>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // SAFETY: tagged-pointer recovered from socket ext.
                                unsafe { (*client).drain_response_body::<true>(socket) };
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe {
                                    (*session).drain_response_body_by_http_id(drain.async_http_id)
                                };
                            }
                        }
                        uws::AnySocket::SocketTcp(socket) => {
                            let tagged = HTTPContext::<false>::get_tagged_from_socket(socket);
                            if let Some(client) = tagged.get::<HttpClient>() {
                                // SAFETY: tagged-pointer recovered from socket ext.
                                unsafe { (*client).drain_response_body::<false>(socket) };
                            }
                            if let Some(session) = tagged.get::<h2::ClientSession>() {
                                // SAFETY: session alive while tagged on a socket.
                                unsafe {
                                    (*session).drain_response_body_by_http_id(drain.async_http_id)
                                };
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
                // SAFETY: AsyncHttp pointer is owned by caller, alive until completion callback.
                let aborted =
                    unsafe { (*http).client.signals.get(crate::signals::Field::Aborted) };
                if aborted || active < max {
                    start_queued_task(http);
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
            let http = self.queued_tasks.pop();
            if http.is_null() {
                break;
            }
            // SAFETY: AsyncHttp pointer is owned by caller, alive until completion callback.
            let aborted = unsafe { (*http).client.signals.get(crate::signals::Field::Aborted) };
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
        if self.has_awoken.load(Ordering::Relaxed) {
            unsafe extern "C" {
                fn us_wakeup_loop(loop_: *mut uws::Loop);
            }
            // SAFETY: uws_loop is the live HTTP-thread loop set in on_start.
            unsafe { us_wakeup_loop(self.uws_loop) };
        }
    }

    pub fn schedule(&mut self, batch: bun_threading::thread_pool::Batch) {
        if batch.len == 0 {
            return;
        }

        {
            let mut batch_ = batch;
            while let Some(task) = batch_.pop() {
                // SAFETY: task points to AsyncHttp.task; recover parent via field offset.
                let http: *mut AsyncHttp = unsafe {
                    task.as_ptr()
                        .cast::<u8>()
                        .sub(core::mem::offset_of!(AsyncHttp, task))
                        .cast::<AsyncHttp>()
                };
                self.queued_tasks.push(http);
            }
        }

        self.wakeup();
    }
}

/// Evict the least-recently-used SSL context cache entry.
fn evict_oldest_ssl_context() {
    // SAFETY: HTTP-thread only; sole live `&mut` for the body below.
    let map = unsafe { &mut *custom_ssl_context_map() };
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
    // SAFETY: cache holds one strong ref taken at insert.
    unsafe { NewHttpContext::<true>::deref(entry.ctx.as_ptr()) };
    drop(entry.config_ref); // entry.config_ref.deinit()
}

fn start_queued_task(http: *mut AsyncHttp) {
    // SAFETY: http points to a live AsyncHttp queued by the caller thread.
    let cloned = crate::ThreadlocalAsyncHttp::new(unsafe { core::ptr::read(http) });
    // PORT NOTE: Zig used struct copy `http.*`; AsyncHttp is byte-copied here
    // since the original stays valid (real owner is `http`, copy is the
    // HTTP-thread working set).
    let cloned = Box::leak(cloned);
    cloned.async_http.real = NonNull::new(http);
    // Clear stale queue pointers - the clone inherited http.next and http.task.node.next
    // which may point to other AsyncHTTP structs that could be freed before the callback
    // copies data back to the original. If not cleared, retrying a failed request would
    // re-queue with stale pointers causing use-after-free.
    cloned.async_http.next = core::ptr::null_mut();
    cloned.async_http.task.node.next = core::ptr::null_mut();
    cloned.async_http.on_start();
}

/// Raw pointer to the HTTP-thread abort tracker. Callers reborrow per-access —
/// PORTING.md §Global mutable state.
#[inline]
fn abort_tracker() -> *mut ArrayHashMap<u32, uws::AnySocket> {
    // SAFETY: same single-thread invariant as http_thread().
    unsafe {
        (*crate::SOCKET_ASYNC_HTTP_ABORT_TRACKER.get()).get_or_insert_with(ArrayHashMap::new)
            as *mut _
    }
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
            *crate::HTTP_THREAD.get() = Some(HttpThread::new());
        }
        bun_libdeflate_sys::libdeflate::load();
        let opts_copy = opts.clone();
        let thread = std::thread::Builder::new()
            .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize)
            .spawn(move || on_start(opts_copy));
        match thread {
            Ok(t) => drop(t), // detach
            Err(err) => Output::panic(format_args!("Failed to start HTTP Client thread: {}", err)),
        }
    }

    pub(super) fn on_start(opts: InitOpts) {
        Output::Source::configure_named_thread(bun_core::zstr!("HTTP Client"));
        // PERF(port): was MimallocArena bulk-free for bun.http.default_allocator.

        // TODO(b2-blocked): MiniEventLoop::init_global lives in bun_event_loop
        // (higher tier). Until that's wired into bun_http's deps, drive the
        // raw uws Loop directly. The MiniEventLoop wrapper handle (`loop_`)
        // stays null; only `uws_loop` is consumed below.
        let uws_loop = uws::Loop::get();

        #[cfg(windows)]
        {
            if bun_sys::windows::getenv_w(bun_string::w!("SystemRoot")).is_none() {
                Output::err_generic(
                    "The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.",
                    (),
                );
                Global::crash();
            }
        }

        let thread = crate::http_thread_mut();
        thread.loop_ = core::ptr::null();
        thread.uws_loop = uws_loop;
        thread.http_context.init();
        if let Err(err) = thread.https_context.init_with_thread_opts(&opts) {
            (opts.on_init_error)(err, &opts);
        }
        thread.has_awoken.store(true, Ordering::Relaxed);
        thread.process_events();
    }

    impl HttpThread {
        fn process_events(&mut self) -> ! {
            // SAFETY: uws_loop is set in on_start before this is called and
            // outlives the thread.
            let uws_loop = unsafe { &mut *self.uws_loop };
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

                // SAFETY: uws_loop is the live HTTP-thread loop set in on_start.
                let uws_loop = unsafe { &mut *self.uws_loop };
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
