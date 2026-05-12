use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::io::Write as _;

use bun_ast::{Loc, Log};
use bun_core::FeatureFlags;
use bun_core::{MutableString, ZigStringSlice};
use bun_threading::IntrusiveWorkTask as _;
use bun_threading::thread_pool::{self, Batch, Task};
use bun_url::{PercentEncoding, URL};

use bun_dotenv::Loader as DotEnvLoader;
use bun_http_types::Encoding::Encoding;
use bun_picohttp as picohttp;

use crate::headers::{self, Headers};
use crate::{
    FetchRedirect, Flags, HTTPClient, HTTPRequestBody, HTTPVerboseLevel, InternalState, Method,
    Signals, ThreadlocalAsyncHTTP,
};
use crate::{HTTPClientResult, HTTPClientResultCallback};

use crate::ssl_config::SharedPtr as SSLConfigSharedPtr;

bun_core::declare_scope!(AsyncHTTP, visible);

// Lifetime `'a` covers every borrowed input the caller hands in: `url`,
// `http_proxy`, `request_header_buf`, the borrowed `HTTPRequestBody::Bytes`
// payload, and `client.{header_buf,hostname,if_modified_since}`. Intrusive
// fields (`real`, `next`) are raw pointers and thus lifetime-erased; the
// HTTP-thread copy uses the same `'a` as the JS-thread original it mirrors.
pub struct AsyncHTTP<'a> {
    pub request: Option<picohttp::Request<'static>>,
    pub response: Option<picohttp::Response<'static>>,
    pub request_headers: headers::EntryList,
    pub response_headers: headers::EntryList,
    // TODO(port): lifetime — caller-owned response buffer; never freed here.
    pub response_buffer: *mut MutableString,
    pub request_body: HTTPRequestBody<'a>,
    // PORT NOTE: `std.mem.Allocator param` field dropped — global mimalloc is used everywhere.
    pub request_header_buf: &'a [u8],
    pub method: Method,
    pub url: URL<'a>,
    pub http_proxy: Option<URL<'a>>,
    // Backref to the JS-thread `real` AsyncHTTP this HTTP-thread copy mirrors.
    // Cleared in finalize. Same `'a` — the copy never outlives the original.
    pub real: Option<NonNull<AsyncHTTP<'a>>>,
    /// Intrusive link for `UnboundedQueue(AsyncHTTP, .next)` in HTTPThread.
    /// Lifetime-erased (`'static`) — the queue mixes requests with unrelated
    /// borrow scopes; consumers never read borrowed fields through `next`.
    pub next: bun_threading::Link<AsyncHTTP<'static>>,

    pub task: thread_pool::Task,
    pub result_callback: HTTPClientResultCallback,

    pub redirected: bool,

    pub response_encoding: Encoding,
    pub verbose: HTTPVerboseLevel,

    pub client: HTTPClient<'a>,
    pub waiting_deffered: bool,
    pub finalized: bool,
    pub err: Option<bun_core::Error>,
    pub async_http_id: u32,

    pub state: AtomicState,
    pub elapsed: u64,
    pub gzip_elapsed: u64,

    pub signals: Signals,
}

bun_threading::intrusive_work_task!(['a] AsyncHTTP<'a>, task);

// SAFETY: `next` is the sole intrusive link for `UnboundedQueue(AsyncHTTP, .next)`.
// Only implemented for the lifetime-erased form — the queue is heterogeneous
// over borrow scopes and `next` is always stored as `Link<AsyncHTTP<'static>>`.
unsafe impl bun_threading::Linked for AsyncHTTP<'static> {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

pub static ACTIVE_REQUESTS_COUNT: AtomicUsize = AtomicUsize::new(0);
pub static MAX_SIMULTANEOUS_REQUESTS: AtomicUsize = AtomicUsize::new(256);

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

fn noop_result_callback(_: *mut (), _: *mut AsyncHTTP<'static>, _: HTTPClientResult<'_>) {}

#[inline(always)]
const fn noop_callback() -> HTTPClientResultCallback {
    HTTPClientResultCallback {
        ctx: core::ptr::null_mut(),
        function: noop_result_callback,
    }
}

/// Free a `URL.href` slice that the caller marked as owned.
///
/// # Safety
/// `href` must have been allocated via the global allocator as a `Box<[u8]>`
/// and ownership ceded to this module via `is_url_owned = true`. Mirrors Zig
/// `bun.default_allocator.free(url.href)`.
#[inline]
unsafe fn free_owned_href(href: &'static [u8]) {
    if !href.is_empty() {
        // SAFETY: caller guarantees `href` is the sole reference to a
        // global-allocator `Box<[u8]>` allocation. The fat `*mut [u8]` is
        // obtained directly from the borrowed slice — no need to round-trip
        // through `(ptr, len)` + `from_raw_parts`.
        unsafe { bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut()) };
    }
}

/// Read the HTTP-thread monotonic timer in nanoseconds.
/// Mirrors Zig `http_thread.timer.read()`.
#[inline]
fn http_thread_timer_read() -> u64 {
    crate::http_thread().timer.elapsed().as_nanos() as u64
}

/// Build the `Proxy-Authorization: Basic <b64(user[:pass])>` header value.
/// Returns `None` (and logs) if percent-decoding fails — Zig swallowed the
/// error and continued without proxy auth.
fn build_proxy_authorization(proxy: &URL<'_>) -> Option<Vec<u8>> {
    if proxy.username.is_empty() {
        return None;
    }

    // PERF(port): was stack-fallback (4096) — profile in Phase B
    let username = match PercentEncoding::decode_alloc(proxy.username) {
        Ok(u) => u,
        Err(err) => {
            bun_core::scoped_log!(AsyncHTTP, "failed to decode proxy username: {:?}", err);
            return None;
        }
    };

    let auth: Vec<u8> = if !proxy.password.is_empty() {
        // PERF(port): was stack-fallback (4096) — profile in Phase B
        let password = match PercentEncoding::decode_alloc(proxy.password) {
            Ok(p) => p,
            Err(err) => {
                bun_core::scoped_log!(AsyncHTTP, "failed to decode proxy password: {:?}", err);
                return None;
            }
        };
        // concat user and password
        let mut auth: Vec<u8> = Vec::with_capacity(username.len() + 1 + password.len());
        auth.extend_from_slice(&username);
        auth.push(b':');
        auth.extend_from_slice(&password);
        auth
    } else {
        // only use user
        username.into_vec()
    };

    let size = bun_base64::encode_len_from_size(auth.len());
    let mut buf = vec![0u8; size + b"Basic ".len()];
    let encoded_len = bun_base64::encode_url_safe(&mut buf[b"Basic ".len()..], &auth);
    buf[..b"Basic ".len()].copy_from_slice(b"Basic ");
    buf.truncate(b"Basic ".len() + encoded_len);
    Some(buf)
}

/// Construct an `HTTPClient` with all defaults except the supplied fields.
/// `HTTPClient` has no `Default` (it has a `Drop` impl with side-effects), so
/// this is the single place that enumerates the field set.
fn make_client<'a>(
    method: Method,
    url: URL<'a>,
    header_entries: headers::EntryList,
    header_buf: &'a [u8],
    hostname: Option<&'a [u8]>,
    signals: Signals,
    async_http_id: u32,
    http_proxy: Option<URL<'a>>,
    proxy_headers: Option<Headers>,
    redirect_type: FetchRedirect,
) -> HTTPClient<'a> {
    HTTPClient {
        method,
        header_entries,
        header_buf,
        url,
        connected_url: URL::default(),
        verbose: HTTPVerboseLevel::None,
        // PORT NOTE: DEFAULT_REDIRECT_COUNT (= 127) is crate-private in lib.rs;
        // duplicated as a literal here.
        remaining_redirect_count: 127,
        allow_retry: false,
        h2_retries: 0,
        redirect_type,
        redirect: Vec::new(),
        prev_redirect: Vec::new(),
        progress_node: None,
        flags: Flags::default(),
        state: InternalState::default(),
        tls_props: None,
        custom_ssl_ctx: None,
        result_callback: noop_callback(),
        if_modified_since: b"",
        request_content_len_buf: [0u8; b"-4294967295".len()],
        http_proxy,
        proxy_headers,
        proxy_authorization: None,
        proxy_tunnel: None,
        h2: None,
        h3: None,
        pending_h2: None,
        signals,
        async_http_id,
        hostname,
        unix_socket_path: ZigStringSlice::EMPTY,
    }
}

/// A drop-safe placeholder `HTTPClient` used when we need to move the real
/// client out of an `AsyncHTTP` (e.g. to run its `Drop` before the user
/// callback) without leaving the field uninitialized.
#[inline]
fn blank_client<'a>() -> HTTPClient<'a> {
    make_client(
        Method::GET,
        URL::default(),
        headers::EntryList::default(),
        b"",
        None,
        Signals::default(),
        0,
        None,
        None,
        FetchRedirect::Follow,
    )
}

// ──────────────────────────────────────────────────────────────────────────
// load_env
// ──────────────────────────────────────────────────────────────────────────

pub fn load_env(logger: &mut Log, env: &DotEnvLoader) {
    if let Some(max_http_requests) = env.get(b"BUN_CONFIG_MAX_HTTP_REQUESTS") {
        // PORT NOTE: env vars are bytes — never round-trip through &str. Zig used std.fmt.parseInt
        // on []const u8 directly; map to the byte-slice parser in bun_core::strings.
        let max: u16 = match bun_core::parse_int::<u16>(max_http_requests, 10) {
            Ok(v) => v,
            Err(_) => {
                logger
                    .add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{}\" is not a valid integer between 1 and 65535",
                            bstr::BStr::new(max_http_requests),
                        ),
                    );
                return;
            }
        };
        if max == 0 {
            logger.add_warning_fmt(
                None,
                Loc::EMPTY,
                format_args!(
                    "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535"
                ),
            );
            return;
        }
        MAX_SIMULTANEOUS_REQUESTS.store(usize::from(max), Ordering::Relaxed);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Options<'a> {
    pub http_proxy: Option<URL<'a>>,
    pub proxy_headers: Option<Headers>,
    // PORT NOTE: Zig had `?[]u8` (mutable slice); only ever read, so `&[u8]` here.
    pub hostname: Option<&'a [u8]>,
    pub signals: Option<Signals>,
    pub unix_socket_path: Option<ZigStringSlice>,
    pub disable_timeout: Option<bool>,
    pub verbose: Option<HTTPVerboseLevel>,
    pub disable_keepalive: Option<bool>,
    pub disable_decompression: Option<bool>,
    pub reject_unauthorized: Option<bool>,
    pub tls_props: Option<SSLConfigSharedPtr>,
}

// ──────────────────────────────────────────────────────────────────────────
// impl AsyncHTTP — basic state
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    /// Erase the borrow lifetime for storage in intrusive queues / raw-pointer
    /// callback contexts. See [`HTTPClient::as_erased_ptr`] for rationale.
    #[inline(always)]
    pub fn as_erased_ptr(&self) -> *mut AsyncHTTP<'static> {
        std::ptr::from_ref::<Self>(self)
            .cast_mut()
            .cast::<AsyncHTTP<'static>>()
    }

    /// Accessor for the global concurrent-request cap (Zig:
    /// `AsyncHTTP.max_simultaneous_requests`). Returned as a static so callers
    /// can `.load()` / `.store()` directly.
    #[inline]
    pub fn max_simultaneous_requests() -> &'static core::sync::atomic::AtomicUsize {
        &MAX_SIMULTANEOUS_REQUESTS
    }

    pub fn signal_header_progress(&mut self) {
        self.signals.store(
            crate::signals::Field::HeaderProgress,
            true,
            Ordering::Release,
        );
    }

    pub fn enable_response_body_streaming(&mut self) {
        self.signals.store(
            crate::signals::Field::ResponseBodyStreaming,
            true,
            Ordering::Release,
        );
    }

    /// Copy HTTP-thread progress state into the JS-thread "real" instance.
    ///
    /// Port of Zig `task.http.?.* = async_http.*` — Zig bitwise-copies the
    /// whole struct, which Rust can't do (`HTTPClient: Drop`, owned `Vec`s).
    /// Instead, copy exactly the fields the JS side observes between progress
    /// callbacks: the post-redirect `url`, response/timing fields written by
    /// `on_async_http_callback`, and the `client` flags/counters used for
    /// shutdown decisions and error formatting. Owned allocations stay with
    /// `src` (the HTTP-thread copy keeps running while `has_more`).
    pub fn sync_progress_from(&mut self, src: &AsyncHTTP<'a>) {
        self.url = src.url.clone();
        self.redirected = src.redirected;
        self.elapsed = src.elapsed;
        self.gzip_elapsed = src.gzip_elapsed;
        self.err = src.err;
        self.response = src.response;
        self.response_encoding = src.response_encoding;
        self.response_buffer = src.response_buffer;
        self.state
            .store(src.state.load(Ordering::Relaxed), Ordering::Relaxed);
        self.client.url = src.client.url.clone();
        self.client.flags = src.client.flags;
        self.client.remaining_redirect_count = src.client.remaining_redirect_count;
    }

    pub fn clear_data(&mut self) {
        // PORT NOTE: `response_headers.deinit(allocator)` becomes drop-in-place via assignment.
        self.response_headers = headers::EntryList::default();
        self.request = None;
        self.response = None;
        // PORT NOTE: ZigString.Slice ownership — Drop releases WTF/owned variants;
        // assigning EMPTY runs Drop on the old value.
        self.client.unix_socket_path = ZigStringSlice::EMPTY;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Preconnect
// ──────────────────────────────────────────────────────────────────────────

struct Preconnect {
    // TODO(port): self-referential — `async_http.response_buffer` borrows
    // `self.response_buffer`. Zig relied on stable heap addresses from
    // `bun.TrivialNew`. `Option` so we can write the field after the heap
    // address is fixed (late-init); `None` is never observed after `preconnect()`
    // populates it.
    async_http: Option<AsyncHTTP<'static>>,
    response_buffer: MutableString,
    url: URL<'static>,
    is_url_owned: bool,
}

impl Preconnect {
    fn on_result(this: *mut Preconnect, _: *mut AsyncHTTP<'static>, _: HTTPClientResult<'_>) {
        // SAFETY: `this` was produced by `heap::alloc` in `preconnect()` and is
        // uniquely owned here; `async_http` was fully written before scheduling.
        unsafe {
            (*this).response_buffer = MutableString::default();
            (*this)
                .async_http
                .as_mut()
                .expect("Preconnect.async_http set in preconnect()")
                .clear_data();
            // PORT NOTE: Zig `async_http.client.deinit()` — handled by Drop when
            // the Box is reclaimed below.
            if (*this).is_url_owned {
                // SAFETY: `is_url_owned` is the caller's promise that `url.href`
                // is a global-allocator `Box<[u8]>` we now own.
                free_owned_href((*this).url.href);
            }
            // Reclaim and drop the heap allocation (runs Drop on `async_http`
            // — which in turn drops `HTTPClient` — and on `response_buffer`).
            drop(bun_core::heap::take(this));
        }
    }
}

pub fn preconnect(url: URL<'static>, is_url_owned: bool) {
    if !FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
        if is_url_owned {
            // SAFETY: `is_url_owned` is the caller's promise that `url.href` is a
            // global-allocator `Box<[u8]>` we now own.
            unsafe { free_owned_href(url.href) };
        }
        return;
    }

    // Write-before-read: `Bun__fetchPreconnect` reaches here without going
    // through any path that calls `HTTPThread::init`, so `schedule()` below
    // would deref the uninitialized `HTTP_THREAD` static (UB on niche-bearing
    // fields) if `fetch.preconnect()` is the process's first HTTP operation.
    // `init` is idempotent (`Once`) and every other JS-side entry point
    // (`send_sync`, `FetchTasklet::start`, S3) passes default opts too.
    crate::http_thread::init(&Default::default());

    let this: *mut Preconnect = bun_core::heap::into_raw(Box::new(Preconnect {
        async_http: None,
        response_buffer: MutableString::default(),
        url,
        is_url_owned,
    }));

    // SAFETY: `this` is a freshly Box-allocated, uniquely-owned pointer; we
    // in-place write `async_http` before any read and before it can be observed
    // by another thread. The address of `response_buffer` is stable (heap).
    unsafe {
        let response_buffer: *mut MutableString = core::ptr::addr_of_mut!((*this).response_buffer);
        let url = (*this).url.clone();
        let async_http = (*this).async_http.insert(AsyncHTTP::init(
            Method::GET,
            url,
            headers::EntryList::default(),
            b"",
            response_buffer,
            b"",
            HTTPClientResultCallback::new::<Preconnect>(this, Preconnect::on_result),
            FetchRedirect::Manual,
            Options::default(),
        ));
        async_http.client.flags.is_preconnect_only = true;

        crate::HTTPThread::schedule(Batch::from(core::ptr::addr_of_mut!(async_http.task)));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// impl AsyncHTTP — init / reset / schedule
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    pub fn init(
        method: Method,
        url: URL<'a>,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        response_buffer: *mut MutableString,
        request_body: &'a [u8],
        callback: HTTPClientResultCallback,
        redirect_type: FetchRedirect,
        options: Options<'a>,
    ) -> AsyncHTTP<'a> {
        let async_http_id = if options
            .signals
            .as_ref()
            .map(|s| s.aborted.is_some())
            .unwrap_or(false)
        {
            crate::ASYNC_HTTP_ID_MONOTONIC.fetch_add(1, Ordering::Relaxed)
        } else {
            0
        };

        let signals = options.signals.unwrap_or_default();
        let http_proxy = options.http_proxy.clone();

        // PORT NOTE: reshaped for borrowck — Zig wrote `this.* = .{ .client = undefined, ... }`
        // then `this.client = .{...}`. Rust has no `undefined`; build the client first and move
        // it into the AsyncHTTP literal.
        let client = make_client(
            method,
            url.clone(),
            // PORT NOTE: Zig stored the same `headers` value in both `AsyncHTTP.request_headers`
            // and `client.header_entries` (shallow copy of the MultiArrayList header → shared
            // backing storage). `MultiArrayList` in Rust owns its allocation, so clone here.
            headers.clone().expect("OOM"),
            headers_buf,
            options.hostname,
            signals,
            async_http_id,
            http_proxy.clone(),
            options.proxy_headers,
            redirect_type,
        );

        let mut this = AsyncHTTP {
            request: None,
            response: None,
            request_headers: headers,
            response_headers: headers::EntryList::default(),
            response_buffer,
            request_body: HTTPRequestBody::Bytes(request_body),
            request_header_buf: headers_buf,
            method,
            url,
            http_proxy,
            real: None,
            next: bun_threading::Link::new(),
            task: thread_pool::Task {
                node: thread_pool::Node::default(),
                callback: start_async_http,
            },
            result_callback: callback,
            redirected: false,
            response_encoding: Encoding::Identity,
            verbose: HTTPVerboseLevel::None,
            client,
            waiting_deffered: false,
            finalized: false,
            err: None,
            async_http_id,
            state: AtomicState::new(State::Pending),
            elapsed: 0,
            gzip_elapsed: 0,
            signals,
        };
        if let Some(val) = options.unix_socket_path {
            debug_assert!(this.client.unix_socket_path.slice().is_empty());
            this.client.unix_socket_path = val;
        }
        if let Some(val) = options.disable_timeout {
            this.client.flags.disable_timeout = val;
        }
        if let Some(val) = options.verbose {
            this.client.verbose = val;
        }
        if let Some(val) = options.disable_decompression {
            this.client.flags.disable_decompression = val;
        }
        if let Some(val) = options.disable_keepalive {
            this.client.flags.disable_keepalive = val;
        }
        if let Some(val) = options.reject_unauthorized {
            this.client.flags.reject_unauthorized = val;
        }
        if let Some(val) = options.tls_props {
            this.client.tls_props = Some(val);
        }

        if let Some(proxy) = &this.http_proxy {
            if let Some(auth) = build_proxy_authorization(proxy) {
                this.client.proxy_authorization = Some(auth);
            }
        }
        this
    }

    /// Construct an `AsyncHTTP` for a synchronous request driven via
    /// [`send_sync`].
    ///
    /// Borrowed inputs (`url`, `headers_buf`, `request_body`, `http_proxy`,
    /// `hostname`) are tied to lifetime `'a` and must outlive the returned
    /// value — in practice they live on the calling stack frame and the
    /// request is driven to completion via `send_sync` before that frame
    /// returns (mirrors Zig `AsyncHTTP.initSync`).
    pub fn init_sync(
        method: Method,
        url: URL<'a>,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        response_buffer: *mut MutableString,
        request_body: &'a [u8],
        http_proxy: Option<URL<'a>>,
        hostname: Option<&'a [u8]>,
        redirect_type: FetchRedirect,
    ) -> AsyncHTTP<'a> {
        Self::init(
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            // PORT NOTE: Zig passed `undefined` for callback in sync mode.
            noop_callback(),
            redirect_type,
            Options {
                http_proxy,
                hostname,
                ..Options::default()
            },
        )
    }

    fn reset(&mut self) {
        // PORT NOTE: Zig rebuilt `self.client` from scratch via `HTTPClient.init()`
        // (which only sets method/url/header_entries/header_buf/signals). The
        // previous client's `Drop` runs on assignment.
        let header_entries = self.client.header_entries.clone().expect("OOM");
        let header_buf = self.client.header_buf;
        let signals = self.client.signals;
        self.client = make_client(
            self.method,
            self.client.url.clone(),
            header_entries,
            header_buf,
            None,
            signals,
            0,
            self.http_proxy.clone(),
            None,
            FetchRedirect::Follow,
        );

        if let Some(proxy) = &self.http_proxy {
            // TODO: need to understand how is possible to reuse Proxy with TSL, so disable keepalive if url is HTTPS
            self.client.flags.disable_keepalive = self.url.is_https();
            if let Some(auth) = build_proxy_authorization(proxy) {
                self.client.proxy_authorization = Some(auth);
            }
        }
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        self.state.store(State::Scheduled, Ordering::Relaxed);
        batch.push(Batch::from(core::ptr::addr_of_mut!(self.task)));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// send_sync
// ──────────────────────────────────────────────────────────────────────────

// 32 pointers much cheaper than 1000 pointers
// PORT NOTE: `bun_threading::Channel` requires `T: Copy`, which
// `HTTPClientResult` is not. `send_sync` is a one-shot blocking handoff, so a
// Guarded<Option<T>>+Condvar is the exact semantics needed.
pub struct SingleHTTPChannel {
    slot: bun_threading::Guarded<Option<HTTPClientResult<'static>>>,
    cv: bun_threading::Condvar,
}

impl SingleHTTPChannel {
    pub fn init() -> SingleHTTPChannel {
        SingleHTTPChannel {
            slot: bun_threading::Guarded::new(None),
            cv: bun_threading::Condvar::new(),
        }
    }
    pub fn reset(&mut self) {
        *self.slot.lock() = None;
    }
    fn write_item(&self, item: HTTPClientResult<'static>) {
        let mut g = self.slot.lock();
        *g = Some(item);
        self.cv.notify_one();
    }
    fn read_item(&self) -> HTTPClientResult<'static> {
        let mut g = self.slot.lock();
        loop {
            if let Some(item) = g.take() {
                return item;
            }
            self.cv.wait_guarded(&mut g);
        }
    }
}

fn send_sync_callback(
    this: *mut SingleHTTPChannel,
    async_http: *mut AsyncHTTP<'static>,
    result: HTTPClientResult<'_>,
) {
    // SAFETY: `async_http` is the HTTP-thread copy (inside ThreadlocalAsyncHTTP)
    // and `real` was set to the caller's stack/heap AsyncHTTP before scheduling.
    let async_http = unsafe { &mut *async_http };
    // PORT NOTE: Zig did `async_http.real.?.* = async_http.*` (whole-struct
    // bitwise copy back into the original) then re-seated `response_buffer`.
    // `AsyncHTTP` is not `Copy`/`Clone` in Rust and a raw `ptr::read`/`ptr::write`
    // would duplicate owned fields that are later dropped on both sides; instead
    // enumerate every field `on_async_http_callback` (and the client path) writes
    // and that callers of `send_sync` can observe, moving owned values out of
    // the HTTP-thread copy where necessary.
    if let Some(mut real) = async_http.real {
        // SAFETY: `real` outlives the HTTP-thread copy by construction.
        let real = unsafe { real.as_mut() };
        real.response = async_http.response;
        real.request = async_http.request.take();
        real.response_headers = core::mem::take(&mut async_http.response_headers);
        real.response_encoding = async_http.response_encoding;
        real.err = async_http.err;
        real.redirected = async_http.redirected;
        real.elapsed = async_http.elapsed;
        real.gzip_elapsed = async_http.gzip_elapsed;
        real.state
            .store(async_http.state.load(Ordering::Relaxed), Ordering::Relaxed);
        real.response_buffer = async_http.response_buffer;
    }
    // SAFETY: `this` is the leaked `SingleHTTPChannel` from `send_sync` and is
    // alive for the process lifetime; `result` borrows the HTTP-thread copy's
    // response buffer, which is the caller's buffer — outlives the read in
    // `send_sync`.
    unsafe {
        (*this).write_item(result.detach_lifetime());
    }
}

impl<'a> AsyncHTTP<'a> {
    pub fn send_sync(&mut self) -> Result<picohttp::Response<'static>, bun_core::Error> {
        crate::http_thread::init(&Default::default());

        // PORT NOTE: Zig leaked `ctx` (never destroyed). `Box::leak` is forbidden
        // (PORTING.md §Forbidden); allocate via `heap::alloc` and reclaim once
        // the single sync callback has fired and we've read the result.
        let ctx = bun_core::heap::into_raw_nn(Box::new(SingleHTTPChannel::init()));
        self.result_callback =
            HTTPClientResultCallback::new::<SingleHTTPChannel>(ctx.as_ptr(), send_sync_callback);

        let mut batch = Batch::default();
        self.schedule(&mut batch);
        crate::HTTPThread::schedule(batch);

        // `ctx` is a live heap allocation we own; the HTTP thread only touches
        // it inside `send_sync_callback`, whose final action is `write_item`,
        // so by the time `read_item` returns the callback has finished and no
        // other reference remains. `read_item` takes `&self` (channel internals
        // are interior-mutable), so a `ParentRef` shared deref is sufficient.
        let result = bun_ptr::ParentRef::from(ctx).read_item();
        // SAFETY: see above — sole owner, callback completed.
        drop(unsafe { bun_core::heap::take(ctx.as_ptr()) });
        if let Some(err) = result.fail {
            return Err(err);
        }
        debug_assert!(result.metadata.is_some());
        // The returned `Response` borrows `metadata.owned_buf` (status text +
        // header slices). Zig's `sendSync` returns `result.metadata.?.response`
        // and never `deinit`s the metadata; mirror that by suppressing Drop so
        // the borrowed buffer outlives the call. `send_sync` is one-shot CLI.
        let metadata = core::mem::ManuallyDrop::new(result.metadata.unwrap());
        Ok(metadata.response)
    }

    // ──────────────────────────────────────────────────────────────────────
    // on_result
    // ──────────────────────────────────────────────────────────────────────

    /// `Callback::new::<AsyncHTTP>` adapter — `*mut Self` ctx + raw `*mut`
    /// async_http arg, matching `HTTPClientResultCallbackFunction`.
    fn on_async_http_callback_raw(
        this: *mut AsyncHTTP<'static>,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult<'_>,
    ) {
        // PORT NOTE: kept as raw `*mut` throughout — `this == async_http` (set in
        // `on_start`) and the `!has_more` branch frees that allocation, so a
        // `&mut self` would be left dangling across the tail of the function
        // (UB under stacked borrows).
        // SAFETY: `this` is the HTTP-thread copy set in `on_start`; lives in a
        // `ThreadlocalAsyncHTTP` heap allocation owned by the HTTP thread.
        unsafe {
            debug_assert!((*this).real.is_some());

            let callback = (*this).result_callback;
            (*this).elapsed = http_thread_timer_read().saturating_sub((*this).elapsed);

            // TODO: this condition seems wrong: if we started with a non-default value, we might
            // report a redirect even if none happened
            (*this).redirected = (*this).client.flags.redirected;
            if result.is_success() {
                (*this).err = None;
                if let Some(metadata) = &result.metadata {
                    (*this).response = Some(metadata.response);
                }
                (*this).state.store(State::Success, Ordering::Relaxed);
            } else {
                (*this).err = result.fail;
                (*this).response = None;
                (*this).state.store(State::Fail, Ordering::Relaxed);
            }

            // PORT NOTE: Zig logged `socket_async_http_abort_tracker.count()` here
            // and did `tracker.shrinkAndFree(count)` when `capacity()>10_000 &&
            // count()<100`. `bun_collections::ArrayHashMap` does not yet expose
            // `capacity()`/`shrink_and_free()`.
            // TODO(port): wire `bun_collections::ArrayHashMap::{capacity,shrink_and_free}` once they exist and call them under the same guard.

            let has_more = result.has_more;
            if has_more {
                callback.run(async_http, result);
            } else {
                // PORT NOTE: Zig `this.client.deinit()` runs BEFORE the user
                // callback, then `threadlocal_http.deinit()` (a `TrivialDeinit`
                // — frees the box, NO field destructors) runs after.
                //
                // The threadlocal `AsyncHTTP` was created by a bitwise
                // `core::ptr::read` of the JS-thread original
                // (`start_queued_task`), so any owned field that was already
                // populated at that point — `request_headers`,
                // `client.header_entries`, `client.proxy_headers`,
                // `client.proxy_authorization`, `client.tls_props`,
                // `client.unix_socket_path` — is *shared* with the original
                // and must NOT be dropped here; the original drops them when
                // its `Box<AsyncHTTP>` is reclaimed. Only the state the clone
                // built up itself during request processing is torn down.
                {
                    let client = &mut (*this).client;
                    // Clone-owned (allocated after `ptr::read`).
                    drop(core::mem::take(&mut client.redirect));
                    drop(core::mem::take(&mut client.prev_redirect));
                    if let Some(tunnel) = client.proxy_tunnel.take() {
                        // SAFETY: tunnel was created by ProxyTunnel::start
                        // (heap::alloc) and is refcounted; detach the socket
                        // (the first half of the old `detach_and_deref`)
                        // before releasing the clone's strong ref below.
                        (*tunnel.as_ptr()).detach_socket();
                        tunnel.deref();
                    }
                    debug_assert!(client.h2.is_none());
                    if let Some(ctx) = client.custom_ssl_ctx.take() {
                        // Release the strong ref the clone took in set_custom_ssl_ctx.
                        ctx.deref();
                    }
                    // `state` was `Default` at `ptr::read` time and was
                    // populated by the clone (`on_start` → `client.start`); it
                    // owns the decompressor / compressed_body buffers.
                    drop(core::mem::take(&mut client.state));
                }
                let elapsed = (*this).elapsed;
                bun_core::scoped_log!(AsyncHTTP, "onAsyncHTTPCallback: {:?}", elapsed);
                callback.run(async_http, result);

                // SAFETY: `async_http` is the `async_http` field of a
                // `ThreadlocalAsyncHTTP` heap-allocated by HTTPThread via
                // `ThreadlocalAsyncHTTP::new` (heap::alloc); recover the parent
                // via field offset and reclaim the Box. This is the LAST access
                // to `this`/`async_http`; only static state is touched afterward.
                let threadlocal_http: *mut ThreadlocalAsyncHTTP =
                    bun_core::from_field_ptr!(ThreadlocalAsyncHTTP, async_http, async_http);
                // PORT NOTE: Zig `defer threadlocal_http.deinit()` is
                // `bun.TrivialDeinit` — it frees the heap slot WITHOUT running
                // any field destructors. Reclaiming as `Box<_>` here would
                // drop the bitwise-shared fields enumerated above and
                // double-free with the JS-thread original; deallocate the
                // storage directly instead.
                std::alloc::dealloc(
                    threadlocal_http.cast::<u8>(),
                    std::alloc::Layout::new::<ThreadlocalAsyncHTTP>(),
                );

                let active_requests = ACTIVE_REQUESTS_COUNT.fetch_sub(1, Ordering::Relaxed);
                debug_assert!(active_requests > 0);
            }
        }

        let thread = crate::http_thread();
        if (!thread.queued_tasks.is_empty() || !thread.deferred_tasks.is_empty())
            && ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed)
                < MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed)
        {
            thread.wakeup();
        }
    }

    /// Thin wrapper kept for API parity; the body is raw-pointer based to avoid
    /// holding `&mut self` across the dealloc of `self`'s storage.
    pub fn on_async_http_callback(
        &mut self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult<'_>,
    ) {
        Self::on_async_http_callback_raw(self.as_erased_ptr(), async_http, result);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// start
// ──────────────────────────────────────────────────────────────────────────

/// `thread_pool::Task` callback — recovers the parent `AsyncHTTP` via field
/// offset and dispatches into `on_start`.
///
/// # Safety
/// `task` must point to the `task` field of a live `AsyncHTTP` scheduled via
/// `schedule()`.
pub unsafe fn start_async_http(task: *mut Task) {
    // SAFETY: caller upholds the invariant above — `from_task_ptr` recovers the
    // live heap `AsyncHTTP` parent via container_of; the trampoline is its sole
    // borrower (HTTP-thread-only). Same single-step shape as every other
    // `IntrusiveWorkTask` call site (`&mut *Self::from_task_ptr(task)`).
    let this = unsafe { &mut *AsyncHTTP::<'static>::from_task_ptr(task) };
    this.on_start();
}

impl<'a> AsyncHTTP<'a> {
    pub fn on_start(&mut self) {
        let _ = ACTIVE_REQUESTS_COUNT.fetch_add(1, Ordering::Relaxed);
        self.err = None;
        self.state.store(State::Sending, Ordering::Relaxed);
        self.client.result_callback = HTTPClientResultCallback::new::<AsyncHTTP<'static>>(
            self.as_erased_ptr(),
            AsyncHTTP::on_async_http_callback_raw,
        );

        self.elapsed = http_thread_timer_read();
        // PORT NOTE: Zig reassigned `response_buffer.allocator = bun.http.default_allocator`
        // when capacity was 0. MutableString in Rust uses the global allocator
        // unconditionally; nothing to do.

        // `response_buffer` was set in `init()` to a caller-owned MutableString
        // that outlives this request — the very buffer `start()` records as
        // `state.body_out_str`. Route through the shared `body_out` accessor
        // (one centralised unsafe).
        let response_buffer = crate::body_out::as_mut(
            NonNull::new(self.response_buffer).expect("response_buffer set in init"),
        );

        // PORT NOTE: `HTTPRequestBody` is not `Clone` (the `Stream` arm holds an
        // intrusive refcount). Zig passed it by value (shallow copy). Move owned
        // payloads into the client and leave a detached placeholder so Drop on
        // `self.request_body` is a no-op.
        let body = core::mem::replace(&mut self.request_body, HTTPRequestBody::Bytes(b""));
        self.client.start(body, response_buffer);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HTTPCallbackPair / HTTPChannel / HTTPChannelContext
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: `HTTPCallbackPair` was Zig anonymous tuple `.{ *AsyncHTTP, HTTPClientResult }`.
// `bun_threading::Channel` requires `T: Copy`, which `HTTPClientResult` is not, so the
// `HTTPChannel` here boxes the pair and ships the pointer (which IS `Copy`) through
// a static-buffer channel. The receiver takes ownership of the Box.
pub type HTTPCallbackPair = (*mut AsyncHTTP<'static>, HTTPClientResult<'static>);

pub type HTTPChannel = bun_threading::Channel<
    *mut HTTPCallbackPair,
    bun_collections::linear_fifo::StaticBuffer<*mut HTTPCallbackPair, 1000>,
>;

pub struct HTTPChannelContext<'a> {
    pub http: AsyncHTTP<'a>,
    // TODO(port): lifetime — no init/assignment found in src/http/; appears unused.
    // BACKREF: set once by the owner before scheduling; the channel outlives
    // every callback dispatched through it (Zig dereferenced unconditionally).
    pub channel: Option<bun_ptr::BackRef<HTTPChannel>>,
}

impl HTTPChannelContext<'_> {
    pub fn callback(data: HTTPCallbackPair) {
        // SAFETY: `data.0` points to the `http` field of an `HTTPChannelContext`.
        let this: &mut HTTPChannelContext =
            unsafe { &mut *(bun_core::from_field_ptr!(HTTPChannelContext, http, data.0)) };
        let boxed = bun_core::heap::into_raw(Box::new(data));
        // `channel` is a set-once `BackRef`; `write_item` takes `&self`, so the
        // safe `Deref` impl covers the access (no open-coded `unsafe as_ref`).
        this.channel
            .expect("HTTPChannelContext.channel set before scheduling")
            .write_item(boxed)
            .expect("HTTPChannel full");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// State / AtomicState
// ──────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum State {
    Pending = 0,
    Scheduled = 1,
    Sending = 2,
    Success = 3,
    Fail = 4,
}

#[repr(transparent)]
pub struct AtomicState(AtomicU32);

impl AtomicState {
    pub const fn new(s: State) -> Self {
        Self(AtomicU32::new(s as u32))
    }
    pub fn store(&self, s: State, order: Ordering) {
        self.0.store(s as u32, order);
    }
    pub fn load(&self, order: Ordering) -> State {
        // Only ever stored via `store` above with valid discriminants; the
        // wildcard arm is statically unreachable but keeps the match safe.
        match self.0.load(order) {
            0 => State::Pending,
            1 => State::Scheduled,
            2 => State::Sending,
            3 => State::Success,
            4 => State::Fail,
            _ => unreachable!("invalid AsyncHTTP::State discriminant"),
        }
    }
}

// ported from: src/http/AsyncHTTP.zig
