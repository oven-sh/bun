use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use bun_ast::{Loc, Log};
use bun_core::FeatureFlags;
use bun_core::MutableString;
use bun_threading::thread_pool::{self, Batch, Task};
use bun_url::{PercentEncoding, URL};

use bun_dotenv::Loader as DotEnvLoader;

use crate::headers::{self, Headers};
use crate::{
    FetchRedirect, Flags, HTTPClient, HTTPRequestBody, HTTPVerboseLevel, InternalState, Method,
    RequestUrl, Signals,
};
use crate::{HTTPClientResult, HTTPClientResultCallback};

use crate::ssl_config::SharedPtr as SSLConfigSharedPtr;

bun_core::declare_scope!(AsyncHTTP, visible);

/// A configured request, as its caller holds it. Queue it with
/// [`AsyncHTTP::schedule`] + [`crate::HTTPThread::schedule`]; the HTTP thread
/// takes its [`crate::RequestCell`], results come through `result_callback`,
/// and the cell comes back with the terminal one, so the request can be
/// scheduled again (from this configuration). Between scheduling and the
/// terminal result the caller keeps this value (and the inputs `'a` covers)
/// alive and in place.
///
/// Lifetime `'a` covers every borrowed input the caller hands in: `url`,
/// `http_proxy`, `request_header_buf`, the borrowed `HTTPRequestBody::Bytes`
/// payload, and `client.{header_buf,unix_socket_path,if_modified_since}`.
pub struct AsyncHTTP<'a> {
    pub request_headers: headers::EntryList,
    pub(crate) request_body: crate::Body,
    pub(crate) method: Method,
    pub url: RequestUrl,
    /// Intrusive link for `UnboundedQueue(AsyncHTTP, .next)` in HTTPThread.
    /// Lifetime-erased (`'static`) — the queue mixes requests with unrelated
    /// borrow scopes; consumers never read borrowed fields through `next`.
    pub(crate) next: bun_threading::Link<AsyncHTTP<'static>>,

    pub(crate) task: thread_pool::Task,
    pub(crate) result_callback: HTTPClientResultCallback,

    /// The client and the HTTP thread's working state; `None` while the
    /// thread has it (between `start` and the terminal result).
    pub(crate) cell: core::cell::Cell<Option<Box<crate::RequestCell>>>,
    pub async_http_id: u32,

    pub(crate) signals: Signals,

    /// Set (release) by the HTTP thread right before the terminal result
    /// callback / shutdown release: from then on the HTTP thread never touches
    /// this value again ([`crate::InFlight::reclaim`]).
    pub(crate) handed_back: AtomicBool,
    _marker: core::marker::PhantomData<&'a [u8]>,
}

bun_core::intrusive_field!(['a] AsyncHTTP<'a>, task: Task);
bun_threading::intrusive_linked!(AsyncHTTP<'static>, next);

pub(crate) static ACTIVE_REQUESTS_COUNT: AtomicUsize = AtomicUsize::new(0);
pub static MAX_SIMULTANEOUS_REQUESTS: AtomicUsize = AtomicUsize::new(256);

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/// `task` only carries the request through a `Batch` into the HTTP thread's
/// queue; it is never run as a thread-pool task.
fn never_run(_: *mut Task) {
    unreachable!("AsyncHTTP tasks are queued, not run");
}

/// Build the `Proxy-Authorization: Basic <b64(user:pass)>` header value.
/// Returns `None` (and logs) if percent-decoding fails.
pub(crate) fn build_proxy_authorization(proxy: &URL<'_>) -> Option<Vec<u8>> {
    if proxy.username.is_empty() && proxy.password.is_empty() {
        return None;
    }

    let username = match PercentEncoding::decode_alloc(proxy.username) {
        Ok(u) => u,
        Err(err) => {
            bun_core::scoped_log!(AsyncHTTP, "failed to decode proxy username: {:?}", err);
            return None;
        }
    };

    let password = match PercentEncoding::decode_alloc(proxy.password) {
        Ok(p) => p,
        Err(err) => {
            bun_core::scoped_log!(AsyncHTTP, "failed to decode proxy password: {:?}", err);
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
fn make_client(
    method: Method,
    url: RequestUrl,
    header_entries: headers::EntryList,
    header_buf: &[u8],
    signals: Signals,
    async_http_id: u32,
    http_proxy: Option<RequestUrl>,
    proxy_headers: Option<Headers>,
    redirect_type: FetchRedirect,
) -> HTTPClient {
    HTTPClient {
        method,
        header_entries,
        header_buf: bun_ptr::RawSlice::new(header_buf),
        url,
        connected_hostname: crate::HostName::default(),
        connected_port: 0,
        verbose: HTTPVerboseLevel::None,
        // Note: DEFAULT_REDIRECT_COUNT (= 127) is crate-private in lib.rs;
        // duplicated as a literal here.
        remaining_redirect_count: 127,
        allow_retry: false,
        h2_retries: 0,
        redirect_type,
        progress_node: None,
        flags: Flags::default(),
        idle_timeout_seconds: None,
        state: InternalState::default(),
        pending_body: None,
        tls_props: None,
        custom_ssl_ctx: None,
        if_modified_since: bun_ptr::RawSlice::EMPTY,
        request_content_len_buf: [0u8; b"18446744073709551615".len()],
        http_proxy,
        proxy_settings: None,
        proxy_headers,
        proxy_authorization: None,
        proxy_tunnel: None,
        h2_attached: false,
        pending_h2: None,
        signals,
        async_http_id,
        unix_socket_path: bun_ptr::RawSlice::EMPTY,
        compress: None,
        compressed_request_body: Vec::new(),
        compressed_body_len: 0,
        req: None,
        session_sink: None,
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
    pub proxy_settings: Option<Arc<crate::ProxySettings>>,
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

    /// The method the request was made with. A redirect only ever rewrites the
    /// HTTP thread's copy (`client.method`), and only to GET.
    #[inline]
    pub fn method(&self) -> Method {
        self.method
    }

    /// A store into the shared signal `Store`, not into `self`.
    pub fn enable_response_body_streaming(&self) {
        self.signals.store(
            crate::signals::Field::ResponseBodyStreaming,
            true,
            Ordering::Release,
        );
    }

    /// Replace the request body (bytes for `'a`, a file, or a stream).
    pub fn set_request_body(&mut self, body: HTTPRequestBody<'a>) {
        self.request_body = body.erase();
    }

    /// The request's client, to finish configuring it before `schedule()`.
    /// Panics while the request is in flight.
    #[inline]
    pub fn client_mut(&mut self) -> &mut HTTPClient {
        self.cell
            .get_mut()
            .as_mut()
            .expect("request is in flight")
            .client_mut()
    }

    /// This request with the caller's `'a` erased. The borrowed inputs it was
    /// built from become a promise: the caller keeps them alive and in place
    /// until the terminal result has been delivered — the same promise every
    /// queued request already makes for itself.
    #[inline(always)]
    pub(crate) fn detach(self) -> AsyncHTTP<'static> {
        AsyncHTTP {
            request_headers: self.request_headers,
            request_body: self.request_body,
            method: self.method,
            url: self.url,
            next: self.next,
            task: self.task,
            result_callback: self.result_callback,
            cell: self.cell,
            async_http_id: self.async_http_id,
            signals: self.signals,
            handed_back: self.handed_back,
            _marker: core::marker::PhantomData,
        }
    }

    /// `process.exit()` with this request still queued: mark it handed back and
    /// run its owner's shutdown release.
    pub(crate) fn hand_back_at_shutdown(&self) {
        self.handed_back.store(true, Ordering::Release);
        self.result_callback.release_at_shutdown();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Preconnect
// ──────────────────────────────────────────────────────────────────────────

/// A `fetch.preconnect()` warm-up request: parses `href` once
/// ([`PreparedPreconnect::url`], for the caller to validate); the HTTP thread
/// owns the request once [`start`](PreparedPreconnect::start)ed.
pub struct PreparedPreconnect {
    url: bun_url::ParsedURL,
}

impl PreparedPreconnect {
    pub fn new(href: Box<[u8]>) -> Box<Self> {
        Box::new(Self {
            url: bun_url::ParsedURL::new(href),
        })
    }

    pub fn url(&self) -> URL<'_> {
        self.url.url()
    }

    #[allow(clippy::boxed_local)]
    pub fn start(self: Box<Self>) {
        if !FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
            return;
        }

        // `Bun__fetchPreconnect` reaches here without going through any path
        // that calls `HTTPThread::init`. `init` is idempotent (`Once`) and
        // every other JS-side entry point (`send_sync`, `FetchTasklet::queue`,
        // S3) passes default opts too.
        crate::http_thread::init(&Default::default());
        crate::http_thread().schedule_preconnect(self.url);
    }

    /// The request the HTTP thread builds (and owns) for a queued preconnect.
    pub(crate) fn into_request(url: bun_url::ParsedURL) -> Box<AsyncHTTP<'static>> {
        let mut async_http = AsyncHTTP::init(
            Method::GET,
            URL::default(),
            headers::EntryList::default(),
            b"",
            b"",
            HTTPClientResultCallback::ThreadOwned,
            FetchRedirect::Manual,
            Options::default(),
        )
        .detach();
        async_http.url = RequestUrl::owned(url);
        let lent = async_http.url.lend_inner();
        let client = async_http.client_mut();
        client.url = lent;
        client.flags.is_preconnect_only = true;
        Box::new(async_http)
    }
}

/// Warm up a connection to `url` (`--fetch-preconnect`).
pub fn preconnect(url: &URL<'_>) {
    Box::new(PreparedPreconnect {
        url: bun_url::ParsedURL::from_url(url),
    })
    .start();
}

// ──────────────────────────────────────────────────────────────────────────
// impl AsyncHTTP — init / reset / schedule
// ──────────────────────────────────────────────────────────────────────────

impl<'a> AsyncHTTP<'a> {
    #[allow(clippy::needless_pass_by_value)] // `url` is the borrow this request keeps for `'a`
    pub fn init(
        method: Method,
        url: URL<'a>,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
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

        // Hop 0 resolves from the same settings later hops do
        // (`HTTPClient::reevaluate_proxy_for_redirect`).
        let http_proxy = match (options.http_proxy, options.proxy_settings.as_deref()) {
            (Some(proxy), _) => Some(RequestUrl::new(&proxy)),
            (None, Some(settings)) => settings
                .resolve(&url)
                .map(|href| RequestUrl::owned(bun_url::ParsedURL::new(Box::from(href)))),
            (None, None) => None,
        };

        let url = RequestUrl::new(&url);
        let mut client = make_client(
            method,
            url.lend_inner(),
            // Note: the same `headers` value goes in both `AsyncHTTP.request_headers`
            // and `client.header_entries`; `MultiArrayList` owns its allocation, so clone here.
            headers.clone().expect("OOM"),
            headers_buf,
            signals,
            async_http_id,
            http_proxy,
            options.proxy_headers,
            redirect_type,
        );
        if let Some(val) = options.unix_socket_path {
            client.unix_socket_path = bun_ptr::RawSlice::new(val);
        }
        if let Some(val) = options.disable_timeout {
            client.flags.disable_timeout = val;
        }
        if let Some(val) = options.idle_timeout_seconds {
            client.idle_timeout_seconds = Some(crate::normalize_idle_timeout_seconds(val.into()));
        }
        if let Some(val) = options.verbose {
            client.verbose = val;
        }
        if let Some(val) = options.disable_decompression {
            client.flags.disable_decompression = val;
        }
        if let Some(val) = options.max_redirects {
            client.remaining_redirect_count = (val.min(126) + 1) as i8;
        }
        if let Some(val) = options.disable_keepalive {
            client.flags.disable_keepalive = val;
        }
        if let Some(val) = options.reject_unauthorized {
            client.flags.reject_unauthorized = val;
        }
        if let Some(val) = options.tls_props {
            client.tls_props = Some(val);
        }
        client.compress = options.compress;
        client.proxy_settings = options.proxy_settings;
        // `client.proxy_authorization` stays `None` here; the HTTP thread
        // derives it on its working copy so redirects can reassign it.

        AsyncHTTP {
            request_headers: headers,
            request_body: HTTPRequestBody::Bytes(request_body).erase(),
            method,
            url,
            next: bun_threading::Link::new(),
            task: thread_pool::Task {
                node: thread_pool::Node::default(),
                callback: never_run,
            },
            result_callback: callback,
            cell: core::cell::Cell::new(Some(crate::RequestCell::new(client))),
            async_http_id,
            signals,
            handed_back: AtomicBool::new(false),
            _marker: core::marker::PhantomData,
        }
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
        redirect_type: FetchRedirect,
    ) -> AsyncHTTP<'a> {
        Self::init(
            method,
            url,
            headers,
            headers_buf,
            request_body,
            HTTPClientResultCallback::None,
            redirect_type,
            Options {
                http_proxy,
                ..Options::default()
            },
        )
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        self.handed_back.store(false, Ordering::Relaxed);
        let mut cell = self.cell.take().expect("request already in flight");
        cell.arm(self);
        self.cell.set(Some(cell));
        batch.push(Batch::from(core::ptr::addr_of_mut!(self.task)));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// send_sync
// ──────────────────────────────────────────────────────────────────────────

// `send_sync` is a one-shot blocking handoff, so a Guarded<Option<T>>+Condvar
// is the exact semantics needed.
pub(crate) struct SingleHTTPChannel {
    slot: bun_threading::Guarded<Option<HTTPClientResult<'static>>>,
    cv: bun_threading::Condvar,
}

impl SingleHTTPChannel {
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

impl crate::HTTPClientResultHandler for SingleHTTPChannel {
    fn on_result(&self, mut result: HTTPClientResult<'_>) {
        // `init_sync` leaves every streaming/progress signal unset, so the only
        // callback is the terminal one; writing on `has_more` would hand
        // `send_sync` a partial body.
        debug_assert!(!result.has_more);
        let mut body = Vec::new();
        result.body_into(&mut body);
        result.body_owned = body;
        self.write_item(result.into_owned());
    }
}

impl<'a> AsyncHTTP<'a> {
    pub fn send_sync(
        &mut self,
        response_buffer: &mut MutableString,
    ) -> crate::Result<crate::HTTPResponseMetadata> {
        crate::http_thread::init(&Default::default());

        let channel = Arc::new(SingleHTTPChannel {
            slot: bun_threading::Guarded::new(None),
            cv: bun_threading::Condvar::new(),
        });
        self.result_callback = HTTPClientResultCallback::from_handler(Arc::clone(&channel));

        let mut batch = Batch::default();
        self.schedule(&mut batch);
        crate::HTTPThread::schedule(batch);

        let mut result = channel.read_item();
        // By the terminal result the HTTP thread has handed `self` back.
        debug_assert!(self.handed_back.load(Ordering::Acquire));
        result.body_into(&mut response_buffer.list);
        if let Some(err) = result.fail {
            return Err(err);
        }
        let Some(metadata) = result.metadata else {
            // Terminal result with neither error nor response head; surface as
            // a network error rather than panicking on network-driven state.
            return Err(crate::Error::ConnectionClosed);
        };
        Ok(metadata)
    }
}
