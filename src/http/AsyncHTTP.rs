use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_ast::{Loc, Log};
use bun_core::FeatureFlags;
use bun_core::MutableString;
use bun_ptr::AliasableBox;
use bun_url::{PercentEncoding, URL};

use bun_dotenv::Loader as DotEnvLoader;

use crate::headers::{self, Headers};
use crate::{
    FetchRedirect, FinishedRequest, Flags, HTTPClient, HTTPRequestBody, HTTPVerboseLevel,
    InternalState, Method, Signals,
};
use crate::{HTTPClientResult, HTTPClientResultCallback};

use crate::ssl_config::SharedPtr as SSLConfigSharedPtr;

bun_core::declare_scope!(AsyncHTTP, visible);

// Lifetime `'a` covers every borrowed input the caller hands in: `url`,
// `http_proxy`, `request_header_buf`, the borrowed `HTTPRequestBody::Bytes`
// payload, and `client.{header_buf,unix_socket_path,if_modified_since,progress}`.
pub struct AsyncHTTP<'a> {
    request_headers: headers::EntryList,
    pub request_body: HTTPRequestBody<'a>,
    method: Method,
    url: URL<'a>,
    /// Set by the first attempt.
    original: Option<OriginalClientState<'a>>,
    /// Intrusive link for `UnboundedQueue(AsyncHTTP, .next)` in HTTPThread.
    /// Lifetime-erased (`'static`) — the queue mixes requests with unrelated
    /// borrow scopes; consumers never read borrowed fields through `next`.
    pub(crate) next: bun_threading::Link<AsyncHTTP<'static>>,

    pub client: HTTPClient<'a>,
    pub async_http_id: u32,

    pub elapsed: u64,
}

/// What an attempt changes in `client`, besides what `AsyncHTTP` has a field for.
#[derive(Clone, Copy)]
struct OriginalClientState<'a> {
    flags: Flags,
    remaining_redirect_count: i8,
    http_proxy: Option<&'a [u8]>,
    unix_socket_path: &'a [u8],
}

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

pub(crate) static ACTIVE_REQUESTS_COUNT: AtomicUsize = AtomicUsize::new(0);
pub static MAX_SIMULTANEOUS_REQUESTS: AtomicUsize = AtomicUsize::new(256);

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

fn noop_result_callback(_: *mut (), _: Option<FinishedRequest>, _: HTTPClientResult<'_>) {}

#[inline(always)]
const fn noop_callback() -> HTTPClientResultCallback {
    HTTPClientResultCallback {
        ctx: core::ptr::null_mut(),
        function: noop_result_callback,
        release_at_shutdown: None,
    }
}

/// Read the HTTP-thread monotonic timer in nanoseconds.
#[inline]
fn http_thread_timer_read() -> u64 {
    crate::http_thread().timer.elapsed().as_nanos() as u64
}

/// A CR, LF or NUL ends the header line that a configured value (token, OTP, user agent) is written into as is.
pub fn breaks_header_line(value: &[u8]) -> bool {
    bun_core::strings::contains_any(value, b"\r\n\0")
}

/// The `Basic <b64(user:pass)>` credentials for a URL's userinfo, as sent in
/// `Authorization` / `Proxy-Authorization`. `None` when the URL has no
/// userinfo, or (logged) when it does not percent-decode.
pub fn basic_authorization(url: &URL<'_>) -> Option<Vec<u8>> {
    if url.username.is_empty() && url.password.is_empty() {
        return None;
    }

    let username = match PercentEncoding::decode_alloc(url.username) {
        Ok(u) => u,
        Err(err) => {
            bun_core::scoped_log!(AsyncHTTP, "failed to decode URL username: {:?}", err);
            return None;
        }
    };

    let password = match PercentEncoding::decode_alloc(url.password) {
        Ok(p) => p,
        Err(err) => {
            bun_core::scoped_log!(AsyncHTTP, "failed to decode URL password: {:?}", err);
            return None;
        }
    };
    let mut auth: Vec<u8> = Vec::with_capacity(username.len() + 1 + password.len());
    auth.extend_from_slice(&username);
    auth.push(b':');
    auth.extend_from_slice(&password);

    let size = bun_base64::encode_len_from_size(auth.len());
    let mut buf = vec![0u8; size + b"Basic ".len()];
    let encoded_len = bun_base64::encode(&mut buf[b"Basic ".len()..], &auth);
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
    signals: Signals,
    async_http_id: u32,
    http_proxy: Option<URL<'a>>,
    proxy_headers: Option<Headers>,
    redirect_type: FetchRedirect,
    result_callback: HTTPClientResultCallback,
) -> HTTPClient<'a> {
    HTTPClient {
        result_callback,
        method,
        header_entries,
        header_buf,
        url,
        connected_url: URL::default(),
        verbose: HTTPVerboseLevel::None,
        // Note: DEFAULT_REDIRECT_COUNT (= 127) is crate-private in lib.rs;
        // duplicated as a literal here.
        remaining_redirect_count: 127,
        allow_retry: false,
        h2_retries: 0,
        redirect_type,
        redirect: Vec::new(),
        prev_redirect: Vec::new(),
        progress: None,
        flags: Flags::default(),
        idle_timeout_seconds: None,
        state: InternalState::default(),
        tls_props: None,
        custom_ssl_ctx: None,
        if_modified_since: b"",
        // The client dials and authenticates a proxy from this one parse, whoever made the URL.
        http_proxy: http_proxy.map(|proxy| URL::parse_single_reader(proxy.href)),
        proxy_settings: None,
        proxy_headers,
        proxy_authorization: None,
        proxy_tunnel: None,
        pending_h2: None,
        signals,
        async_http_id,
        unix_socket_path: b"",
        compress: None,
        compressed_request_body: Vec::new(),
        compressed_body_len: 0,
        pool: crate::PoolOptions::default(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// load_env
// ──────────────────────────────────────────────────────────────────────────

pub fn load_env(logger: &mut Log, env: &DotEnvLoader) {
    if let Some(max_http_requests) = env.get(b"BUN_CONFIG_MAX_HTTP_REQUESTS") {
        // Note: env vars are bytes — never round-trip through &str.
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
    pub proxy_settings: Option<Box<crate::ProxySettings>>,
    pub proxy_headers: Option<Headers>,
    pub signals: Option<Signals>,
    pub unix_socket_path: Option<&'a [u8]>,
    pub disable_timeout: Option<bool>,
    /// Per-request idle timeout override in seconds; see
    /// `HTTPClient::idle_timeout_seconds`.
    pub idle_timeout_seconds: Option<core::ffi::c_uint>,
    pub verbose: Option<HTTPVerboseLevel>,
    pub disable_keepalive: Option<bool>,
    pub disable_decompression: Option<bool>,
    pub max_redirects: Option<u8>,
    pub reject_unauthorized: Option<bool>,
    pub tls_props: Option<SSLConfigSharedPtr>,
    pub compress: Option<crate::compress_body::CompressOption>,
    pub pool: crate::PoolOptions,
    pub bypass_pool: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// impl AsyncHTTP — basic state
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    /// Accessor for the global concurrent-request cap. Returned as a static
    /// so callers can `.load()` / `.store()` directly.
    #[inline]
    pub fn max_simultaneous_requests() -> &'static core::sync::atomic::AtomicUsize {
        &MAX_SIMULTANEOUS_REQUESTS
    }

    /// A store into the shared signal `Store`, not into `self`.
    pub fn enable_response_body_streaming(&self) {
        self.client.signals.store(
            crate::signals::Field::ResponseBodyStreaming,
            true,
            Ordering::Release,
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Preconnect
// ──────────────────────────────────────────────────────────────────────────

type Href = std::borrow::Cow<'static, [u8]>;

fn on_preconnect_result(
    href: *mut Href,
    finished: Option<FinishedRequest>,
    _: HTTPClientResult<'_>,
) {
    drop(finished);
    // SAFETY: the box that `preconnect()` leaked; this is its only result.
    unsafe { bun_core::heap::destroy(href) };
}

pub fn preconnect(href: Href) {
    if !FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
        return;
    }

    crate::http_thread::init(&Default::default());

    let href = bun_core::heap::into_raw(Box::new(href));
    // SAFETY: freed after the request that borrows it.
    let url = URL::parse(unsafe { &*href });
    let mut async_http = AsyncHTTP::init(
        Method::GET,
        url,
        headers::EntryList::default(),
        b"",
        b"",
        HTTPClientResultCallback::new(href, on_preconnect_result),
        FetchRedirect::Manual,
        Options::default(),
    );
    async_http.client.flags.is_preconnect_only = true;
    crate::HTTPThread::schedule([async_http]);
}

// ──────────────────────────────────────────────────────────────────────────
// impl AsyncHTTP — init
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    pub fn init(
        method: Method,
        url: URL<'a>,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        request_body: &'a [u8],
        callback: HTTPClientResultCallback,
        redirect_type: FetchRedirect,
        options: Options<'a>,
    ) -> Box<AsyncHTTP<'a>> {
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

        let client = make_client(
            method,
            url.clone(),
            // Note: the same `headers` value goes in both `AsyncHTTP.request_headers`
            // and `client.header_entries`; `MultiArrayList` owns its allocation, so clone here.
            headers.clone().expect("OOM"),
            headers_buf,
            signals,
            async_http_id,
            options.http_proxy,
            options.proxy_headers,
            redirect_type,
            callback,
        );

        let mut this = Box::new(AsyncHTTP {
            request_headers: headers,
            request_body: HTTPRequestBody::Bytes(request_body),
            method,
            url,
            original: None,
            next: bun_threading::Link::new(),
            client,
            async_http_id,
            elapsed: 0,
        });
        if let Some(val) = options.unix_socket_path {
            this.client.unix_socket_path = val;
        }
        if let Some(val) = options.disable_timeout {
            this.client.flags.disable_timeout = val;
        }
        if let Some(val) = options.idle_timeout_seconds {
            this.client.idle_timeout_seconds =
                Some(crate::normalize_idle_timeout_seconds(val.into()));
        }
        if let Some(val) = options.verbose {
            this.client.verbose = val;
        }
        if let Some(val) = options.disable_decompression {
            this.client.flags.disable_decompression = val;
        }
        if let Some(val) = options.max_redirects {
            this.client.remaining_redirect_count = (val.min(126) + 1) as i8;
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
        this.client.compress = options.compress;
        this.client.proxy_settings = options.proxy_settings;
        this.client.pool = options.pool;
        if options.bypass_pool {
            this.client.flags.pool_bypass = crate::PoolBypass::NotThisHop;
        }
        this
    }

    /// Construct an `AsyncHTTP` for a synchronous request driven via
    /// [`send_sync`].
    ///
    /// Borrowed inputs (`url`, `headers_buf`, `request_body`, `http_proxy`)
    /// are tied to lifetime `'a` and must outlive the returned value — in
    /// practice they live on the calling stack frame and the request is driven
    /// to completion via `send_sync` before that frame returns.
    pub fn init_sync(
        method: Method,
        url: URL<'a>,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        request_body: &'a [u8],
        http_proxy: Option<URL<'a>>,
        proxy_settings: Option<Box<crate::ProxySettings>>,
        redirect_type: FetchRedirect,
    ) -> Box<AsyncHTTP<'a>> {
        Self::init(
            method,
            url,
            headers,
            headers_buf,
            request_body,
            noop_callback(),
            redirect_type,
            Options {
                http_proxy,
                proxy_settings,
                ..Options::default()
            },
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// send_sync
// ──────────────────────────────────────────────────────────────────────────

/// The request and the result of a blocking send.
struct SyncResultSlot {
    slot: bun_threading::Guarded<Option<(Box<AsyncHTTP<'static>>, HTTPClientResult<'static>)>>,
    cv: bun_threading::Condvar,
}

impl SyncResultSlot {
    fn new() -> SyncResultSlot {
        SyncResultSlot {
            slot: bun_threading::Guarded::new(None),
            cv: bun_threading::Condvar::new(),
        }
    }

    fn on_result(
        this: *mut SyncResultSlot,
        finished: Option<FinishedRequest>,
        result: HTTPClientResult<'_>,
    ) {
        // `init_sync` sets no streaming signal, so the last result is the only one.
        let request = finished.expect("one result");
        debug_assert!(result.body.is_empty());
        // SAFETY: `send_and_wait` cannot return before the lock is released.
        let this = unsafe { &*this };
        let mut slot = this.slot.lock();
        *slot = Some((request, result.without_borrowed_body()));
        this.cv.notify_one();
    }

    fn wait(&self) {
        let mut slot = self.slot.lock();
        while slot.is_none() {
            self.cv.wait_guarded(&mut slot);
        }
    }

    fn into_inner(mut self) -> (Box<AsyncHTTP<'static>>, HTTPClientResult<'static>) {
        self.slot.get_mut().take().expect("waited for")
    }
}

fn send_and_wait<'a>(requests: impl Iterator<Item = Box<AsyncHTTP<'a>>>, slots: &[SyncResultSlot]) {
    crate::http_thread::init(&Default::default());
    crate::HTTPThread::schedule(slots.iter().zip(requests).map(|(slot, mut request)| {
        request.client.result_callback = HTTPClientResultCallback::new(
            core::ptr::from_ref(slot).cast_mut(),
            SyncResultSlot::on_result,
        );
        // SAFETY: every request is back before this function returns.
        unsafe { core::mem::transmute::<Box<AsyncHTTP<'a>>, Box<AsyncHTTP<'static>>>(request) }
    }));
    slots.iter().for_each(SyncResultSlot::wait);
}

impl<'a> AsyncHTTP<'a> {
    pub fn send_sync(
        self: Box<Self>,
        response_buffer: &mut MutableString,
    ) -> crate::Result<crate::HTTPResponseMetadata> {
        let (_, result) = self.send_sync_for_result(response_buffer)?;
        result.into_metadata()
    }

    /// Like `send_sync`, but returns what the caller needs to decide whether to retry, and to do so.
    pub fn send_sync_for_result(
        self: Box<Self>,
        response_buffer: &mut MutableString,
    ) -> crate::Result<(Box<Self>, HTTPClientResult<'static>)> {
        // `InFlightRequest::connect` sends any other scheme over plain TCP (`fetch("host:port/path")` relies on it); no blocking caller means that.
        if !self.url.has_http_like_protocol() {
            return Err(crate::Error::UnsupportedProtocol);
        }
        let slot = SyncResultSlot::new();
        send_and_wait(core::iter::once(self), core::slice::from_ref(&slot));
        let (request, mut result) = slot.into_inner();
        result.body_into(&mut response_buffer.list);
        Ok((request, result))
    }

    /// Sends the requests side by side. The results are in the same order.
    pub fn send_all_sync(
        requests: impl ExactSizeIterator<Item = Box<Self>>,
    ) -> impl Iterator<Item = HTTPClientResult<'static>> {
        let slots: Vec<SyncResultSlot> =
            (0..requests.len()).map(|_| SyncResultSlot::new()).collect();
        send_and_wait(requests, &slots);
        slots.into_iter().map(|slot| slot.into_inner().1)
    }
}

/// Owns a request until its last result. A socket's ext slot, a stream or a list of waiters holds it between events.
#[must_use]
pub(crate) struct InFlightRequest {
    // A drop leaks it, because `HttpThread::in_flight` points to it until `finish`.
    http: ManuallyDrop<AliasableBox<AsyncHTTP<'static>>>,
    unfinished: AssertNotDropped,
}

struct AssertNotDropped;

impl Drop for AssertNotDropped {
    fn drop(&mut self) {
        debug_assert!(false, "a request was dropped without its last result");
    }
}

impl core::ops::Deref for InFlightRequest {
    type Target = HTTPClient<'static>;
    fn deref(&self) -> &Self::Target {
        &self.http.client
    }
}

impl core::ops::DerefMut for InFlightRequest {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.http.client
    }
}

impl InFlightRequest {
    pub(crate) fn start(http: Box<AsyncHTTP<'static>>) {
        let mut this = Self::new(http.into());
        crate::http_thread().in_flight.push(this.http.as_non_null());
        this.http.on_start();
        this.connect();
    }

    /// `finish` panics unless `http` is in `HttpThread::in_flight`.
    pub(crate) fn new(http: AliasableBox<AsyncHTTP<'static>>) -> Self {
        Self {
            http: ManuallyDrop::new(http),
            unfinished: AssertNotDropped,
        }
    }

    fn into_inner(self) -> AliasableBox<AsyncHTTP<'static>> {
        let _ = ManuallyDrop::new(self.unfinished);
        ManuallyDrop::into_inner(self.http)
    }

    pub(crate) fn into_non_null(self) -> NonNull<AsyncHTTP<'static>> {
        self.into_inner().into_non_null()
    }

    pub(crate) fn fail(mut self, err: crate::Error) {
        self.record_failure(err);
        self.finish();
    }

    /// Moves the request to its callback with the last result.
    pub(crate) fn finish(mut self) {
        self.unregister_abort_tracker();
        // Shrink the abort tracker once it has drained from a high-water mark.
        {
            let tracker = crate::abort_tracker();
            let count = tracker.count();
            if count > 0 {
                bun_core::scoped_log!(
                    AsyncHTTP,
                    "socket_async_http_abort_tracker count: {}",
                    count
                );
            }
            if tracker.capacity() > 10_000 && count < 100 {
                tracker.shrink_and_free(count);
            }
        }

        let in_flight = &mut crate::http_thread().in_flight;
        let index = in_flight.iter().position(|&n| n == self.http.as_non_null());
        in_flight.swap_remove(index.expect("in flight"));
        let mut this = self.into_inner().into_box();
        this.elapsed = http_thread_timer_read().saturating_sub(this.elapsed);
        bun_core::scoped_log!(AsyncHTTP, "finish: {:?}", this.elapsed);

        let mut result = this.client.to_result();
        if result.is_success() {
            result.body_owned = core::mem::take(&mut this.client.state.decoded_body.list);
        }

        // Release HTTP-thread resources before another thread gets the request.
        this.client.proxy_tunnel = None;
        this.client.custom_ssl_ctx = None;
        this.client.state = InternalState::default();

        let callback = this.client.result_callback;
        callback.run(Some(this), result);

        let active_requests = ACTIVE_REQUESTS_COUNT.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(active_requests > 0);

        if crate::http_thread().has_unstarted_tasks()
            && ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed)
                < MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed)
        {
            crate::HTTPThread::wakeup();
        }
    }
}

impl AsyncHTTP<'static> {
    pub(crate) fn release_at_shutdown(self: Box<Self>) {
        let callback = self.client.result_callback;
        drop(self);
        if let Some(release) = callback.release_at_shutdown {
            // SAFETY: paired ctx/fn from `HTTPClientResultCallback::new_with_release`.
            unsafe { release(callback.ctx) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// start
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    fn on_start(&mut self) {
        let _ = ACTIVE_REQUESTS_COUNT.fetch_add(1, Ordering::Relaxed);

        match self.original {
            Some(original) => self.reset_for_retry(original),
            None => {
                self.original = Some(OriginalClientState {
                    flags: self.client.flags,
                    remaining_redirect_count: self.client.remaining_redirect_count,
                    http_proxy: self.client.http_proxy.as_ref().map(|proxy| proxy.href),
                    unix_socket_path: self.client.unix_socket_path,
                });
            }
        }

        if let Some(proxy) = &self.client.http_proxy {
            self.client.proxy_authorization = basic_authorization(proxy);
        }

        self.elapsed = http_thread_timer_read();

        let body = match self.request_body {
            // Stays for the next attempt.
            HTTPRequestBody::Bytes(bytes) => HTTPRequestBody::Bytes(bytes),
            _ => core::mem::replace(&mut self.request_body, HTTPRequestBody::Bytes(b"")),
        };
        self.client.begin_attempt(body);
    }

    /// Restores `client` to its state before the first attempt.
    fn reset_for_retry(&mut self, original: OriginalClientState<'a>) {
        let client = &mut self.client;
        client.method = self.method;
        client.url = self.url.clone();
        client.connected_url = URL::default();
        client.redirect = Vec::new();
        client.prev_redirect = Vec::new();
        // Cloned from `request_headers` in `init`, and it only shrinks.
        assert!(client.header_entries.capacity() >= self.request_headers.len());
        client.header_entries.clear_retaining_capacity();
        (client.header_entries).append_list_assume_capacity(&self.request_headers);
        client.flags = original.flags;
        client.remaining_redirect_count = original.remaining_redirect_count;
        client.http_proxy = original.http_proxy.map(URL::parse_single_reader);
        client.proxy_authorization = None;
        client.unix_socket_path = original.unix_socket_path;
        client.allow_retry = false;
        client.h2_retries = 0;
        client.compressed_request_body = Vec::new();
        client.compressed_body_len = 0;
    }
}
