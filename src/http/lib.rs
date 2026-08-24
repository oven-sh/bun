//! HTTP client.

#![warn(unused_must_use)]
pub mod error;
pub use error::{CertError, Error, Result};
#[path = "AsyncHTTP.rs"]
pub mod async_http;
#[path = "CertificateInfo.rs"]
pub mod certificate_info;
pub mod compress_body;
#[path = "Decompressor.rs"]
pub mod decompressor;
#[path = "H2Client.rs"]
pub mod h2_client;
pub use bun_http_types::h2 as h2_frame_parser;
#[path = "H3Client.rs"]
pub mod h3_client;
#[path = "HeaderBuilder.rs"]
pub mod header_builder;
#[path = "HeaderValueIterator.rs"]
pub mod header_value_iterator;
#[path = "Headers.rs"]
pub mod headers;
#[path = "HTTPCertError.rs"]
pub mod http_cert_error;
#[path = "HTTPContext.rs"]
pub mod http_context;
#[path = "HTTPRequestBody.rs"]
pub mod http_request_body;
#[path = "HTTPThread.rs"]
pub mod http_thread;
#[path = "InitError.rs"]
pub mod init_error;
#[path = "InternalState.rs"]
pub mod internal_state;
pub use bun_lshpack_sys as lshpack;

#[path = "ProxyTunnel.rs"]
pub mod proxy_tunnel;
#[path = "SendFile.rs"]
pub mod send_file;
#[path = "session_cache.rs"]
pub mod session_cache;
#[path = "Signals.rs"]
pub mod signals;
#[path = "ThreadSafeStreamBuffer.rs"]
pub mod thread_safe_stream_buffer;
#[path = "websocket.rs"]
pub mod websocket;

// ── crate-root re-exports ──
pub use async_http::AsyncHTTP;
pub use certificate_info::CertificateInfo;
pub use decompressor::Decompressor;
pub use header_builder::HeaderBuilder;
pub use headers::{Headers, HeadersExt};
pub(crate) use http_cert_error::HTTPCertError;
pub use http_context::{HTTPContext, HTTPSocket};
pub(crate) use http_request_body::Body;
pub use http_request_body::HTTPRequestBody;
pub use http_thread::HttpThread as HTTPThread;
pub use http_thread::shutdown_for_exit;
pub use internal_state::InternalState;
pub use proxy_tunnel::ProxyTunnel;
pub use send_file::SendFile;
pub use signals::Signals;
pub use thread_safe_stream_buffer::{DrainHandler, ThreadSafeStreamBuffer};
#[path = "ssl_config.rs"]
pub mod ssl_config;
pub use ssl_config::SSLConfig;
// SSLWrapper was MOVE_DOWN to bun_uws (tier 4); re-export here so
// `crate::ssl_wrapper::SSLWrapper` resolves for ProxyTunnel/HTTPContext.
pub use bun_uws::ssl_wrapper;

// ── naming aliases ──
// Submodules use both `HTTPClient`/`HttpClient` and the older name
// `NewHTTPContext`; alias all spellings to the canonical types so submodules
// resolve without churn.
pub use h2_client as h2;
pub use h3_client as h3;
pub use h3_client as H3;
pub type NewHTTPContext<const SSL: bool> = http_context::HTTPContext<SSL>;
pub type NewHttpContext<const SSL: bool> = http_context::HTTPContext<SSL>;
pub(crate) type HttpsContext = http_context::HTTPContext<true>;
pub type HttpClient = HTTPClient;
pub type AsyncHttp<'a> = AsyncHTTP<'a>;

pub use bun_http_types::FetchRedirect::FetchRedirect;
pub use bun_http_types::Method::Method;
pub use bun_picohttp as picohttp;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum HTTPVerboseLevel {
    #[default]
    None,
    Headers,
    Curl,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum Protocol {
    #[default]
    Http1_1,
    Http2,
    Http3,
}

pub use bun_http_types::Encoding::Encoding;
pub use header_value_iterator::{
    HeaderValueIterator, connection_header_keep_alive, upgrade_header_is_not_h2,
};
pub use init_error::InitError;

/// Cloned response metadata (headers + url + status). Ownership transfers to
/// the user once the headers phase completes. `url`, `status` and every
/// header name/value point into `owned_buf` (a sibling field, so it lives
/// exactly as long as they do).
pub struct HTTPResponseMetadata {
    url: bun_ptr::RawSlice<u8>,
    /// Backs `url`, `status` and every header.
    _owned_buf: Box<[u8]>,
    headers: Box<[bun_picohttp::Header]>,
    status: bun_ptr::RawSlice<u8>,
    status_code: u32,
    minor_version: usize,
}

impl HTTPResponseMetadata {
    /// The response head, borrowing this metadata.
    #[inline]
    pub fn response(&self) -> bun_picohttp::Response<'_> {
        bun_picohttp::Response {
            minor_version: self.minor_version,
            status_code: self.status_code,
            status: self.status.slice(),
            headers: bun_picohttp::HeaderList {
                list: &self.headers,
            },
            bytes_read: 0,
        }
    }
    #[inline]
    pub fn status_code(&self) -> u32 {
        self.status_code
    }
    /// The URL the response came from (after redirects).
    #[inline]
    pub fn url(&self) -> &[u8] {
        self.url.slice()
    }
    #[inline]
    pub fn status_text(&self) -> &[u8] {
        self.status.slice()
    }
    #[inline]
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        self.response().headers.get(name)
    }
    #[inline]
    pub fn header_if_other_is_absent(&self, name: &[u8], other: &[u8]) -> Option<&[u8]> {
        self.response().headers.get_if_other_is_absent(name, other)
    }
}
pub use bun_http_types::{ETag, MimeType};
/// How a caller lends its `Progress` node to a request (`HTTPClient::progress_node`).
pub type ProgressRef = bun_ptr::BackRef<bun_core::Progress::Node>;

// ═══════════════════════════════════════════════════════════════════════
// Standalone items with no deps on HTTPClient/HTTPContext/ssl_*.
// ═══════════════════════════════════════════════════════════════════════

use bun_core::MutableString;
use bun_http_types::FetchRedirect::CommonAbortReason;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum HTTPUpgradeState {
    #[default]
    None = 0,
    Pending = 1,
    Upgraded = 2,
}

// was `packed struct(u32)` with mixed bool + 2-bit enum fields.
// Kept as a plain struct since it never crosses FFI; restore packing
// if the 32-byte vs 4-byte size difference shows up in profiling.
#[derive(Clone, Copy)]
pub struct Flags {
    pub(crate) disable_timeout: bool,
    pub(crate) disable_keepalive: bool,
    pub(crate) disable_decompression: bool,
    pub(crate) did_have_handshaking_error: bool,
    pub force_last_modified: bool,
    pub(crate) redirected: bool,
    pub(crate) proxy_tunneling: bool,
    pub reject_unauthorized: bool,
    pub(crate) is_preconnect_only: bool,
    pub is_streaming_request_body: bool,
    pub(crate) defer_terminal_dispatch_until_connecting_is_complete: bool,
    pub(crate) upgrade_state: HTTPUpgradeState,
    pub(crate) protocol: Protocol,
    pub forced_protocol: Option<Protocol>,
    pub(crate) h3_retried: bool,
    pub is_node_http_client: bool,
}

impl Default for Flags {
    fn default() -> Self {
        Self {
            disable_timeout: false,
            disable_keepalive: false,
            disable_decompression: false,
            did_have_handshaking_error: false,
            force_last_modified: false,
            redirected: false,
            proxy_tunneling: false,
            reject_unauthorized: true,
            is_preconnect_only: false,
            is_streaming_request_body: false,
            defer_terminal_dispatch_until_connecting_is_complete: false,
            upgrade_state: HTTPUpgradeState::None,
            protocol: Protocol::Http1_1,
            forced_protocol: None,
            h3_retried: false,
            is_node_http_client: false,
        }
    }
}

// ───────────────────────────── globals ─────────────────────────────

pub(crate) static ASYNC_HTTP_ID_MONOTONIC: AtomicU32 = AtomicU32::new(0);

/// Set once at startup from `--experimental-http2-fetch` (before the HTTP
/// thread spawns) and then only read on that thread.
pub static EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI: AtomicBool = AtomicBool::new(false);
/// Set once at startup from `--experimental-http3-fetch`. Same threading
/// rules as the http2 flag.
pub static EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI: AtomicBool = AtomicBool::new(false);

const MAX_REDIRECT_URL_LENGTH: usize = 128 * 1024;

/// Read from C++ (uWS `HttpParser`, node:http's parser) through
/// `Bun__defaultMaxHttpHeaderSize`.
pub(crate) static MAX_HTTP_HEADER_SIZE: AtomicUsize = AtomicUsize::new(16 * 1024);

/// Safe accessor for `MAX_HTTP_HEADER_SIZE`.
#[inline]
pub fn max_http_header_size() -> usize {
    MAX_HTTP_HEADER_SIZE.load(Ordering::Relaxed)
}

/// Safe setter for `MAX_HTTP_HEADER_SIZE` (see [`max_http_header_size`]).
#[inline]
pub fn set_max_http_header_size(v: usize) {
    MAX_HTTP_HEADER_SIZE.store(v, Ordering::Relaxed);
}

/// `--insecure-http-parser`: the process-wide default for node:http's
/// `insecureHTTPParser` option. Set once during single-threaded CLI parsing;
/// read from JS when node:http builds its parser leniency flags.
static INSECURE_HTTP_PARSER: AtomicBool = AtomicBool::new(false);

/// Safe accessor for `INSECURE_HTTP_PARSER`.
#[inline]
pub fn insecure_http_parser() -> bool {
    INSECURE_HTTP_PARSER.load(Ordering::Relaxed)
}

/// Safe setter for `INSECURE_HTTP_PARSER` (see [`insecure_http_parser`]).
#[inline]
pub fn set_insecure_http_parser(v: bool) {
    INSECURE_HTTP_PARSER.store(v, Ordering::Relaxed);
}

/// Set once during single-threaded CLI parsing; read from the HTTP thread.
pub static OVERRIDDEN_DEFAULT_USER_AGENT: std::sync::OnceLock<&'static [u8]> =
    std::sync::OnceLock::new();

/// Idle timeout for HTTP client sockets, in seconds. The timer is armed in
/// `on_open` (so it covers the TLS handshake) and re-armed on writes and on
/// body-phase reads; response-header reads do not re-arm it, so it is an
/// absolute deadline for the header block to complete (undici `headersTimeout`
/// semantics). 0 disables the timer (matching `disable_timeout = true`).
/// Overridable via `BUN_CONFIG_HTTP_IDLE_TIMEOUT`. Default is 5 minutes.
/// `HTTPThread::on_start` stores it padded for the timer-wheel sweep (see
/// [`normalize_idle_timeout_seconds`]).
pub(crate) static IDLE_TIMEOUT_SECONDS: AtomicU32 = AtomicU32::new(300);

/// Safe accessor for [`IDLE_TIMEOUT_SECONDS`].
#[inline]
pub(crate) fn idle_timeout_seconds() -> c_uint {
    IDLE_TIMEOUT_SECONDS.load(Ordering::Relaxed)
}

/// Normalise an idle timeout (seconds) for uSockets' timer wheels. The sweep
/// phase is unrelated to when a socket arms its timer, so a timer armed for N
/// ticks can fire up to one period (4s short wheel, 60s long wheel) before
/// the requested duration (#39952). Pad by one period so it never fires
/// early, and clamp so the padded value stays at the long wheel's 239 min
/// maximum. 0 = disabled.
#[inline]
pub fn normalize_idle_timeout_seconds(raw: u64) -> c_uint {
    if raw == 0 {
        return 0;
    }
    /// `LIBUS_TIMEOUT_GRANULARITY` (packages/bun-usockets/src/libusockets.h).
    const SHORT_WHEEL_PERIOD_SECONDS: u64 = 4;
    const LONG_WHEEL_PERIOD_SECONDS: u64 = 60;
    /// `SocketTimeout::set_timeout` routes values above this to the long wheel.
    const SHORT_WHEEL_MAX_SECONDS: u64 = 240;
    /// The long counter wraps `% 240` minutes; one minute of pad stays below.
    const MAX_RAW_SECONDS: u64 = 238 * LONG_WHEEL_PERIOD_SECONDS;
    let raw = raw.min(MAX_RAW_SECONDS);
    (if raw + SHORT_WHEEL_PERIOD_SECONDS > SHORT_WHEEL_MAX_SECONDS {
        (raw.div_ceil(LONG_WHEEL_PERIOD_SECONDS) + 1) * LONG_WHEEL_PERIOD_SECONDS
    } else {
        raw + SHORT_WHEEL_PERIOD_SECONDS
    }) as c_uint
}

pub const END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY: &[u8] = b"0\r\n\r\n";

/// A hostname as the NUL-terminated string SNI wants, or `None` for an IP
/// literal (RFC 6066 forbids IP SNI) / empty name.
pub(crate) struct SniHostname(Option<bun_core::ZBox>);

impl SniHostname {
    pub(crate) fn new(hostname: &[u8]) -> Self {
        if hostname.is_empty() || bun_core::ip_address::is_ip_address(hostname) {
            return Self(None);
        }
        Self(Some(bun_core::ZBox::from_bytes(hostname)))
    }
    /// Up to the first NUL, as C would read it.
    pub(crate) fn as_cstr(&self) -> Option<&core::ffi::CStr> {
        self.0.as_ref().map(|z| {
            core::ffi::CStr::from_bytes_until_nul(z.as_bytes_with_nul()).expect("ZBox ends in NUL")
        })
    }
}

/// The hostname a request's socket was connected to. Inline for anything the
/// keep-alive pool could key on; longer names spill to the heap.
pub(crate) enum HostName {
    Inline {
        len: u8,
        buf: [u8; http_context::MAX_KEEPALIVE_HOSTNAME],
    },
    Heap(Box<[u8]>),
}

impl Default for HostName {
    fn default() -> Self {
        HostName::Inline {
            len: 0,
            buf: [0; http_context::MAX_KEEPALIVE_HOSTNAME],
        }
    }
}

impl HostName {
    pub(crate) fn set(&mut self, hostname: &[u8]) {
        if hostname.len() <= http_context::MAX_KEEPALIVE_HOSTNAME {
            if let HostName::Inline { len, buf } = self {
                buf[..hostname.len()].copy_from_slice(hostname);
                *len = hostname.len() as u8;
            } else {
                let mut buf = [0u8; http_context::MAX_KEEPALIVE_HOSTNAME];
                buf[..hostname.len()].copy_from_slice(hostname);
                *self = HostName::Inline {
                    len: hostname.len() as u8,
                    buf,
                };
            }
        } else {
            *self = HostName::Heap(Box::from(hostname));
        }
    }
    pub(crate) fn clear(&mut self) {
        if let HostName::Inline { len, .. } = self {
            *len = 0;
        } else {
            *self = HostName::default();
        }
    }
    #[inline]
    pub(crate) fn as_slice(&self) -> &[u8] {
        match self {
            HostName::Inline { len, buf } => &buf[..*len as usize],
            HostName::Heap(b) => b,
        }
    }
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }
}

impl core::ops::Deref for HostName {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.as_slice()
    }
}

const MAX_TLS_RECORD_SIZE: usize = 16 * 1024;

/// REFUSED_STREAM or graceful GOAWAY past our id: the server promises it
/// did not process the request, so re-dispatch from the top. Only reached
/// for `.bytes` bodies (replayable).
pub(crate) const MAX_H2_RETRIES: u8 = 5;

const PREALLOCATE_MAX: usize = 1024 * 1024 * 256;

/// Per-chunk scratch buffers (`InternalState::decoded_body` on the HTTP thread
/// and `FetchTasklet::scheduled_response_buffer` on the JS thread) whose
/// capacity has grown past this are dropped after the chunk is consumed rather
/// than `clear()`ed-and-reused, so the per-connection high-water mark stays
/// bounded for long-lived streaming responses.
pub const DECODED_BODY_RETAIN_CAP: usize = 512 * 1024;

/// Whether the experimental Alt-Svc-driven HTTP/3 upgrade is enabled at all
/// (CLI flag or env var). Used on its own to gate `H3.AltSvc.record` — a
/// response that arrived over a request shape h3 can't serve (proxy, sendfile,
/// pinned to h1) still carries an authoritative Alt-Svc for the origin.
pub(crate) fn h3_alt_svc_enabled() -> bool {
    // SAFETY: set once at startup before HTTP thread spawns; only read thereafter.
    let cli = EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.load(Ordering::Relaxed);
    cli || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT
        .get()
        .unwrap_or(false)
}

/// Strips an optional port suffix from a host string (e.g. "example.com:443" -> "example.com").
/// Handles IPv6 bracket notation correctly (e.g. "[::1]:443" -> "[::1]").
pub(crate) fn strip_port_from_host(host: &[u8]) -> &[u8] {
    if host.is_empty() {
        return host;
    }
    // IPv6 with brackets: "[::1]:port"
    if host[0] == b'[' {
        if let Some(bracket) = strings::last_index_of_char(host, b']') {
            // Return everything up to and including ']'
            return &host[0..bracket + 1];
        }
        return host;
    }
    // IPv4 or hostname: find last colon
    if let Some(colon) = strings::last_index_of_char(host, b':') {
        return &host[0..colon];
    }
    host
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ShouldContinue {
    ContinueStreaming,
    Finished,
}

/// Return of `apply_headers` in the h2/h3 client sessions: did the headers
/// terminate the response (HEAD, 204/304, END_STREAM) or is a body expected?
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum HeaderResult {
    HasBody,
    Finished,
}

impl HTTPClient {
    /// Shared body of `apply_headers` for the h2/h3 client sessions: hand a
    /// pre-decoded multiplexed response (HPACK / QPACK) to the HTTP/1.1
    /// metadata pipeline (`handle_response_metadata` + `clone_metadata`), then
    /// undo the HTTP/1.1-specific framing decisions that don't apply when the
    /// transport delimits the body (h2 DATA frames / h3 STREAM frames).
    ///
    /// Returns the (possibly-mutated) response so the caller can pass it to
    /// `clone_metadata` once the redirect decision has been made; the borrow of
    /// `headers` flows through, so the deep copy is checked by the compiler
    /// rather than by a call-ordering contract.
    #[inline]
    fn apply_multiplexed_headers<'h>(
        &mut self,
        status_code: u32,
        headers: &'h [picohttp::Header],
    ) -> crate::Result<(HeaderResult, picohttp::Response<'h>)> {
        let mut response = picohttp::Response {
            minor_version: 0,
            status_code,
            status: b"",
            headers: picohttp::HeaderList { list: headers },
            bytes_read: 0,
        };
        let should_continue = self.handle_response_metadata(&mut response)?;
        // h2/h3 framing delimits the body; chunked transfer-encoding and the
        // HTTP/1.x persistence rules (no Content-Length ⇒ no keep-alive, and the
        // HTTP/1.0 default that the synthetic `minor_version: 0` above trips)
        // don't apply.
        self.state.transfer_encoding = Encoding::Identity;
        if self.state.response_stage == ResponseStage::BodyChunk {
            self.state.response_stage = ResponseStage::Body;
        }
        self.state.flags.allow_keepalive = true;
        let result = if should_continue == ShouldContinue::Finished {
            HeaderResult::Finished
        } else {
            HeaderResult::HasBody
        };
        Ok((result, response))
    }
}

#[derive(Default, Copy, Clone)]
pub enum BodySize {
    TotalReceived(usize),
    ContentLength(usize),
    #[default]
    Unknown,
}

#[derive(Default)]
pub struct HTTPClientResult<'a> {
    pub body: &'a [u8],
    /// Populated only on the terminal (`!has_more`) progress callback:
    /// `send_progress_update_*` moves the whole `decoded_body.list` here so
    /// one-shot consumers (`send_sync`, `NetworkTask` manifest, S3 simple,
    /// `RemoteImageDownload`) can `mem::take` it instead of
    /// `extend_from_slice`ing the borrowed `body`. Streaming consumers read
    /// `body` on non-terminal callbacks and treat this as just the final
    /// chunk's bytes.
    pub body_owned: Vec<u8>,
    pub has_more: bool,
    pub redirected: bool,
    pub can_stream: bool,
    /// Set once ALPN selected h2 so the JS side writes raw bytes into the
    /// streaming-body buffer instead of chunked-encoding them.
    pub is_http2: bool,

    pub fail: Option<crate::Error>,
    /// Raw `getaddrinfo(3)` return code when `fail` is `DNSResolveFailed`;
    /// 0 otherwise. Lets the JS side report the resolver error (`ENOTFOUND`,
    /// ...) with `syscall`/`hostname` instead of a generic connect failure.
    pub dns_error: i32,
    /// Owned copy of the hostname the failed lookup was for (the proxy's
    /// when one is configured, else the post-redirect target). Owned so the
    /// JS side never dereferences the client's borrowed URL buffers, which
    /// the HTTP thread frees after the result callback returns.
    pub dns_hostname: Option<Box<[u8]>>,

    /// Owns the response metadata aka headers, url and status code
    pub metadata: Option<HTTPResponseMetadata>,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the response body
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub body_size: BodySize,
    pub certificate_info: Option<CertificateInfo>,
    /// On the terminal callback: nanoseconds from the request's start on the
    /// HTTP thread to that callback. 0 before then.
    pub elapsed: u64,
}

impl<'a> HTTPClientResult<'a> {
    pub fn abort_reason(&self) -> Option<CommonAbortReason> {
        if self.is_timeout() {
            return Some(CommonAbortReason::Timeout);
        }
        if self.is_abort() {
            return Some(CommonAbortReason::UserAbort);
        }
        None
    }

    pub fn is_success(&self) -> bool {
        self.fail.is_none()
    }

    pub(crate) fn is_timeout(&self) -> bool {
        matches!(self.fail, Some(crate::Error::Timeout))
    }

    pub(crate) fn is_abort(&self) -> bool {
        matches!(
            self.fail,
            Some(crate::Error::Aborted | crate::Error::AbortedBeforeConnecting)
        )
    }

    /// Returns this callback's body bytes as a slice regardless of which
    /// field carries them (`body` on non-terminal, `body_owned` on terminal).
    #[inline]
    pub fn body_bytes(&self) -> &[u8] {
        if self.body.is_empty() {
            self.body_owned.as_slice()
        } else {
            self.body
        }
    }

    /// Moves this callback's body bytes into `dest`. On a terminal callback
    /// with `dest` empty this is a `Vec` move; otherwise it appends.
    #[inline]
    pub fn body_into(&mut self, dest: &mut Vec<u8>) {
        if !self.body.is_empty() {
            dest.extend_from_slice(self.body);
        } else if !self.body_owned.is_empty() {
            if dest.is_empty() {
                core::mem::swap(dest, &mut self.body_owned);
            } else {
                dest.extend_from_slice(&self.body_owned);
            }
        }
    }

    /// The result without its borrowed `body` view (the bytes, if any, are in
    /// `body_owned` on the terminal callback), for keeping past the callback.
    #[inline]
    pub fn into_owned(self) -> HTTPClientResult<'static> {
        HTTPClientResult {
            body: &[],
            body_owned: self.body_owned,
            has_more: self.has_more,
            redirected: self.redirected,
            can_stream: self.can_stream,
            is_http2: self.is_http2,
            fail: self.fail,
            dns_error: self.dns_error,
            dns_hostname: self.dns_hostname,
            metadata: self.metadata,
            body_size: self.body_size,
            certificate_info: self.certificate_info,
            elapsed: self.elapsed,
        }
    }
}

pub type HTTPClientResultCallbackFunction = fn(*mut (), HTTPClientResult<'_>);

/// A result receiver addressed by raw pointer: for callers that embed the
/// [`AsyncHTTP`] in a struct of their own and want that struct back in the
/// callback. See [`HTTPClientResultCallback::new`].
pub trait RawResultCallback: Sized {
    /// A progress (`result.has_more`) or terminal result, on the HTTP thread.
    fn on_result(this: *mut Self, result: HTTPClientResult<'_>);
    /// The process is exiting with the request still out: nothing more will
    /// be delivered. HTTP thread; the JS thread is parked.
    fn release_at_shutdown(_this: *mut Self) {}
}

/// Where a request's results go.
#[derive(Clone, Default)]
pub enum HTTPClientResultCallback {
    /// Nowhere (a request nobody is listening to).
    #[default]
    None,
    /// A [`RawResultCallback`] implementor, type-erased.
    Raw {
        ctx: *mut (),
        function: HTTPClientResultCallbackFunction,
        release_at_shutdown: fn(*mut ()),
    },
    /// A shared handler, held until the terminal result (or shutdown
    /// release) has been delivered.
    Handler(Arc<dyn HTTPClientResultHandler>),
    /// Nowhere; the request itself belongs to the HTTP thread
    /// (`ThreadState::owned_requests`), which frees it after the terminal
    /// result.
    ThreadOwned,
}

impl HTTPClientResultCallback {
    pub(crate) fn run(&self, result: HTTPClientResult<'_>) {
        match self {
            Self::None | Self::ThreadOwned => {}
            Self::Raw { ctx, function, .. } => function(*ctx, result),
            Self::Handler(handler) => handler.on_result(result),
        }
    }

    pub(crate) fn release_at_shutdown(&self) {
        match self {
            Self::None | Self::ThreadOwned => {}
            Self::Raw {
                ctx,
                release_at_shutdown,
                ..
            } => release_at_shutdown(*ctx),
            Self::Handler(handler) => handler.release_at_shutdown(),
        }
    }

    /// Deliver results to `T`'s [`RawResultCallback`] impl with `this` as the
    /// receiver. `this` must stay valid until the terminal result.
    pub fn new<T: RawResultCallback>(this: *mut T) -> Self {
        Self::Raw {
            ctx: this.cast::<()>(),
            function: |ctx, result| T::on_result(ctx.cast::<T>(), result),
            release_at_shutdown: |ctx| T::release_at_shutdown(ctx.cast::<T>()),
        }
    }

    /// Deliver results to `handler`, which the request holds until its terminal
    /// result (or shutdown release) has been delivered.
    pub fn from_handler<H: HTTPClientResultHandler>(handler: Arc<H>) -> Self {
        Self::Handler(handler)
    }
}

/// The receiving end of a request started through
/// [`HTTPClientResultCallback::from_handler`], called on the HTTP thread.
pub trait HTTPClientResultHandler: Send + Sync + 'static {
    /// A progress (`result.has_more`) or terminal result. By the terminal one
    /// the request has already been handed back, so nothing of it is passed.
    fn on_result(&self, result: HTTPClientResult<'_>);
    /// The process is exiting with the request still out: nothing more will be
    /// delivered. HTTP thread; the JS thread is parked.
    fn release_at_shutdown(&self) {}
}

/// An [`AsyncHTTP`] together with the storage its request borrows (body
/// bytes, ...) point into, in one allocation.
pub struct OwnedRequest<S: 'static>(Box<RequestStorageCell<S>>);

struct RequestStorageCell<S: 'static> {
    /// Points into `storage`: declared first so it is dropped first. `None`
    /// only while `OwnedRequest::new` builds it and after `into_storage`.
    http: Option<AsyncHTTP<'static>>,
    storage: S,
}

impl<S: 'static> OwnedRequest<S> {
    /// Build the request from `storage`, which lives (unmoved, in this
    /// allocation) for as long as the request does.
    pub fn new(storage: S, build: impl for<'a> FnOnce(&'a S) -> AsyncHTTP<'a>) -> Self {
        let mut cell = bun_core::heap::new_with(|| RequestStorageCell {
            http: None,
            storage,
        });
        // written into the cell in place (the request is ~1.7 KB)
        cell.http = Some(build(&cell.storage).detach());
        Self(cell)
    }

    pub fn storage(&self) -> &S {
        &self.0.storage
    }

    /// Drop the request and take the storage back.
    pub fn into_storage(mut self) -> S {
        self.0.http = None;
        let cell = *self.0;
        cell.storage
    }

    pub fn http(&self) -> &AsyncHTTP<'_> {
        self.0.http.as_ref().expect("built")
    }

    /// Adjust the request before it is started.
    pub fn with_http_mut<R>(&mut self, f: impl for<'a> FnOnce(&mut AsyncHTTP<'a>) -> R) -> R {
        f(self.0.http.as_mut().expect("built"))
    }

    /// Queue the request on `batch` for the HTTP thread. The request stays
    /// allocated, untouched by this thread, until the HTTP thread hands it back.
    pub fn start(mut self, batch: &mut bun_threading::thread_pool::Batch) -> InFlight<S> {
        let id = self.http().async_http_id;
        self.0.http.as_mut().expect("built").schedule(batch);
        InFlight {
            cell: Some(self.0),
            id,
        }
    }
}

/// The caller's handle on a started [`OwnedRequest`]: its id for the
/// `HTTPThread::schedule_*` calls, and the way to take it back once the HTTP
/// thread is done with it. Dropping it before then leaks the request.
pub struct InFlight<S: 'static> {
    /// Always `Some`; taken by `reclaim` / `drop`.
    cell: Option<Box<RequestStorageCell<S>>>,
    id: u32,
}

impl<S: 'static> InFlight<S> {
    pub fn async_http_id(&self) -> u32 {
        self.id
    }

    fn cell(&self) -> &RequestStorageCell<S> {
        self.cell.as_deref().expect("in flight")
    }

    /// Whether the HTTP thread has handed the request back (its terminal result
    /// or shutdown release was delivered).
    pub fn handed_back(&self) -> bool {
        self.cell()
            .http
            .as_ref()
            .expect("built")
            .handed_back
            .load(Ordering::Acquire)
    }

    /// The request's storage. The HTTP thread is reading the bytes the request
    /// points at: `S` must not free or reallocate those through `&S`.
    pub fn storage(&self) -> &S {
        &self.cell().storage
    }

    /// Take the request back; `Err(self)` while the HTTP thread still has it.
    pub fn reclaim(mut self) -> Result<OwnedRequest<S>, Self> {
        if !self.handed_back() {
            return Err(self);
        }
        Ok(OwnedRequest(self.cell.take().expect("in flight")))
    }
}

impl<S: 'static> Drop for InFlight<S> {
    fn drop(&mut self) {
        let Some(cell) = self.cell.take() else {
            return;
        };
        if cell
            .http
            .as_ref()
            .expect("built")
            .handed_back
            .load(Ordering::Acquire)
        {
            drop(cell);
        } else {
            debug_assert!(
                false,
                "InFlight request dropped before the HTTP thread handed it back"
            );
            // The HTTP thread still points into it: leaking beats freeing.
            let _ = Box::leak(cell);
        }
    }
}

/// A request the HTTP thread is working on (see [`RequestCell`]). Holders — the
/// socket's ext tag, h2/h3 streams, the proxy tunnel, pending-connect waiter
/// lists — drop or clear it before the cell is retired.
pub(crate) type RequestRef = bun_ptr::BackRef<RequestCell>;

/// A request's [`HTTPClient`] while the caller still holds it; moved into the
/// HTTP thread's [`RequestCell`] when the request is scheduled, after which the
/// caller has nothing to configure and this derefs to a panic.
#[derive(Default)]
pub struct ClientSlot(Option<HTTPClient>);

impl ClientSlot {
    pub(crate) fn filled(client: HTTPClient) -> Self {
        Self(Some(client))
    }
    fn take(&mut self) -> HTTPClient {
        self.0.take().expect("request already scheduled")
    }
    #[inline]
    pub fn is_present(&self) -> bool {
        self.0.is_some()
    }
}

impl core::ops::Deref for ClientSlot {
    type Target = HTTPClient;
    #[inline]
    fn deref(&self) -> &HTTPClient {
        self.0.as_ref().expect("request already scheduled")
    }
}

impl core::ops::DerefMut for ClientSlot {
    #[inline]
    fn deref_mut(&mut self) -> &mut HTTPClient {
        self.0.as_mut().expect("request already scheduled")
    }
}

/// The HTTP thread's working state for one request: its own [`HTTPClient`]
/// built from the caller's queued [`AsyncHTTP`], plus what it needs to hand
/// the results back. Heap-allocated by [`RequestCell::start`] and owned by the
/// thread (`ThreadState::in_flight`); everything else refers to it through a
/// [`RequestRef`]. Once the terminal result has gone out it is retired and
/// freed between events (`ThreadState::reap`).
pub struct RequestCell {
    /// Set when the HTTP thread picks the cell up.
    thread: Cell<Option<&'static http_thread::ThreadState>>,
    /// The caller's request, lent until the terminal result (see
    /// [`http_thread::LentRequest`]); `None` from then on.
    origin: Cell<Option<http_thread::LentRequest>>,
    /// `origin`'s address, for the raw callback's `async_http` argument; never
    /// dereferenced here.
    /// Identifies the caller's request to `ThreadState::free_owned_request`.
    origin_ptr: *const AsyncHTTP<'static>,
    client: RefCell<HTTPClient>,
    result_callback: HTTPClientResultCallback,
    async_http_id: u32,
    signals: Signals,
    started_at: u64,
    /// The terminal result has been produced (or the shutdown release run).
    done: Cell<bool>,
    /// The terminal result, between `deliver` and `finish`.
    terminal: RefCell<Option<HTTPClientResult<'static>>>,
}

impl RequestCell {
    /// The cell a request is queued in: its client moves in (one copy, on
    /// the scheduling thread); the HTTP thread fills in the rest in
    /// [`RequestCell::start`].
    pub(crate) fn new_for(request: &mut AsyncHTTP<'_>) -> Box<RequestCell> {
        let client = request.client.take();
        bun_core::heap::new_with(|| RequestCell {
            thread: Cell::new(None),
            origin: Cell::new(None),
            origin_ptr: core::ptr::null(),
            client: RefCell::new(client),
            result_callback: request.result_callback.clone(),
            async_http_id: request.async_http_id,
            signals: request.signals,
            started_at: 0,
            done: Cell::new(false),
            terminal: RefCell::new(None),
        })
    }

    /// Set the thread up to work on `origin`: take the cell it queued and
    /// register it as in flight.
    pub(crate) fn start(
        thread: &'static http_thread::ThreadState,
        origin: http_thread::LentRequest,
    ) -> RequestRef {
        let _ = async_http::ACTIVE_REQUESTS_COUNT.fetch_add(1, Ordering::Relaxed);
        let mut cell = origin
            .cell
            .take()
            .expect("request queued without a cell");
        cell.thread.set(Some(thread));
        cell.origin.set(Some(origin));
        cell.origin_ptr = origin.as_const_ptr();
        cell.started_at = thread.timer_read();
        let this = thread.adopt_request(cell);
        {
            let mut client = this.client.borrow_mut();
            client.req = Some(this);
            // Derived here so `reevaluate_proxy_for_redirect` can freely
            // drop/replace it.
            debug_assert!(client.proxy_authorization.is_none());
            if let Some(proxy) = &client.http_proxy {
                client.proxy_authorization = async_http::build_proxy_authorization(&proxy.url());
            }
            client.pending_body = Some(origin.request_body.clone_for_thread());
        }
        this
    }

    #[inline]
    pub(crate) fn thread(&self) -> &'static http_thread::ThreadState {
        self.thread.get().expect("request cell not started")
    }

    #[inline]
    pub(crate) fn async_http_id(&self) -> u32 {
        self.async_http_id
    }

    #[inline]
    pub(crate) fn signals(&self) -> Signals {
        self.signals
    }

    /// The request's client state. Panics if it is already borrowed further
    /// up the stack: every path that re-enters a request (proxy tunnel
    /// callbacks) goes through [`RequestCell::try_client`] instead.
    #[inline]
    pub(crate) fn client(&self) -> core::cell::RefMut<'_, HTTPClient> {
        self.client.borrow_mut()
    }

    #[inline]
    pub(crate) fn try_client(&self) -> Option<core::cell::RefMut<'_, HTTPClient>> {
        self.client.try_borrow_mut().ok()
    }

    /// Run an entry point on the client, then replay anything its proxy
    /// tunnel had to defer while the client was busy inside `f`.
    #[inline]
    pub(crate) fn with_client<R>(&self, f: impl FnOnce(&mut HTTPClient) -> R) -> R {
        let mut client = self.client();
        let result = f(&mut client);
        client.drain_tunnel_events();
        result
    }

    /// Deliver `result`. A terminal result (`!has_more`) also hands the
    /// caller's request back and retires this cell; the caller's client borrow
    /// may still be live, so the cell is only freed at the next `reap`.
    pub(crate) fn deliver(&self, mut result: HTTPClientResult<'_>) {
        if result.has_more {
            self.result_callback.run(result);
            return;
        }
        debug_assert!(!self.done.get());
        self.done.set(true);
        let thread = self.thread();
        result.elapsed = thread.timer_read().saturating_sub(self.started_at);
        bun_core::scoped_log!(fetch, "onAsyncHTTPCallback: {:?}", result.elapsed);
        // The client is still borrowed further up this stack; the hand-back
        // (which moves it home) and the callback run once that frame is done,
        // before the thread looks at its next event.
        *self.terminal.borrow_mut() = Some(result.into_owned());
        thread.completed.borrow_mut().push_back(bun_ptr::BackRef::new(self));
    }

    /// Hand the finished request back to its owner: restore the client to the
    /// state the owner may re-schedule it with, park the cell on the owner's
    /// `AsyncHTTP`, mark it handed back, then deliver the terminal result. Runs
    /// from `ThreadState::flush_completions`, where no request is borrowed.
    pub(crate) fn finish(mut self: Box<Self>, thread: &http_thread::ThreadState) {
        let result = self
            .terminal
            .get_mut()
            .take()
            .expect("finished without a terminal result");

        // Log the tracker count, then shrink the abort tracker back down once
        // it has drained from a high-water mark (capacity > 10_000 entries but
        // fewer than 100 live), so long-lived heavy-fetch processes don't pin
        // the peak allocation forever.
        {
            let mut tracker = thread.abort_tracker.borrow_mut();
            let count = tracker.count();
            if count > 0 {
                bun_core::scoped_log!(fetch, "socket_async_http_abort_tracker count: {}", count);
            }
            if tracker.capacity() > 10_000 && count < 100 {
                tracker.shrink_and_free(count);
            }
        }

        let origin = self.origin.take();
        let callback = core::mem::take(&mut self.result_callback);
        let thread_owned = matches!(callback, HTTPClientResultCallback::ThreadOwned);
        let origin_ptr = self.origin_ptr;
        match origin {
            Some(origin) => {
                // What the connection lent this attempt stays on this thread;
                // what goes home is the owner's configuration.
                self.client.get_mut().reset_for_owner(&origin);
                self.thread.set(None);
                self.done.set(false);
                origin.cell.set(Some(self));
                // Nothing touches the owner's request after this.
                origin.handed_back.store(true, Ordering::Release);
            }
            None => drop(self),
        }
        callback.run(result);
        if thread_owned {
            thread.free_owned_request(origin_ptr);
        }

        let active_requests = async_http::ACTIVE_REQUESTS_COUNT.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(active_requests > 0);

        if thread.has_queued_tasks()
            && async_http::ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed)
                < async_http::MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed)
        {
            thread.waker.wake();
        }
    }

    /// `process.exit()` with the request still out: mark the caller's request
    /// handed back and run the owner's shutdown release.
    pub(crate) fn hand_back_at_shutdown(&self) {
        if self.done.replace(true) {
            return;
        }
        if let Some(origin) = self.origin.take() {
            origin.handed_back.store(true, Ordering::Release);
        }
        self.result_callback.release_at_shutdown();
    }

    // ── socket-event entry points (see `http_context::Handler`) ─────────────

    pub(crate) fn on_data<const IS_SSL: bool>(
        req: RequestRef,
        incoming_data: &[u8],
        socket: HttpSocket<IS_SSL>,
    ) {
        let tunnel = {
            let mut client = req.client();
            match client.proxy_tunnel_this() {
                None => {
                    let ctx = client.get_ssl_ctx::<IS_SSL>();
                    client.on_data::<IS_SSL>(incoming_data, ctx, socket);
                    return;
                }
                Some(tunnel) => {
                    bun_core::scoped_log!(fetch, "onData {}", incoming_data.len());
                    if client.signals.get(signals::Field::Aborted) {
                        client.close_and_abort::<IS_SSL>(socket);
                        return;
                    }
                    // Body phase only, mirroring the non-proxy dispatch (header
                    // phase is an absolute deadline; see [`IDLE_TIMEOUT_SECONDS`]).
                    debug_assert!(!client.state.flags.receive_paused); // maybe_pause_receive bails on proxy_tunnel
                    if matches!(
                        client.state.response_stage,
                        ResponseStage::Body | ResponseStage::BodyChunk
                    ) {
                        client.set_timeout(&socket);
                    }
                    tunnel
                }
            }
        };
        // The client is not borrowed here, so the tunnel's callbacks work on
        // it directly; anything they had to defer is replayed after.
        ProxyTunnel::receive(tunnel, incoming_data);
        if let Some(mut client) = req.try_client() {
            client.drain_tunnel_events();
        }
    }

    pub(crate) fn on_writable<const IS_FIRST_CALL: bool, const IS_SSL: bool>(
        req: RequestRef,
        socket: HttpSocket<IS_SSL>,
    ) {
        req.with_client(|c| c.on_writable::<IS_FIRST_CALL, IS_SSL>(socket));
    }

    pub(crate) fn on_close<const IS_SSL: bool>(req: RequestRef, socket: HttpSocket<IS_SSL>) {
        req.with_client(|c| c.on_close::<IS_SSL>(socket));
    }

    pub(crate) fn resume_after_cert_check<const IS_SSL: bool>(
        req: RequestRef,
        socket: HttpSocket<IS_SSL>,
    ) {
        req.with_client(|c| c.resume_after_cert_check::<IS_SSL>(socket));
    }
}

/// `socket: anytype` in `set_timeout` — minimal trait for what the body calls.
trait SocketTimeout {
    /// Seconds-granularity idle timer. Values >240s are routed onto uSockets'
    /// minute-granularity long-timeout wheel; ≤240s use the short-tick timer.
    fn set_timeout(&self, seconds: core::ffi::c_uint);
}

// lowercase hash header names so that we can be sure
pub(crate) fn hash_header_name(name: &[u8]) -> u64 {
    // Uses the std Wyhash algorithm; safe —
    // every comparison hash is computed by this same fn at runtime, no
    // persisted hashes.
    bun_wyhash::hash_ascii_lowercase(0, name)
}

// ───────────────────────────── HTTPClient struct ─────────────────────────────
// The heavy `impl HTTPClient` (socket dispatch / state machine) remains
// gated below until the missing
// `bun_uws::NewSocketHandler` methods (`ext`/`timeout`/`raw_write`/`flush`/
// `shutdown`/`connect_group`/…) land.

use bun_core::ZigStringSlice;
use bun_url::URL;

/// Owned copies of the proxy environment captured at request creation so the
/// HTTP thread can re-resolve `HTTPClient::http_proxy` per redirect hop.
/// curl / Node's undici `EnvHttpProxyAgent` both re-run the no_proxy match
/// and the http/https proxy choice against each redirected URL.
pub struct ProxySettings {
    http_proxy: Box<[u8]>,
    https_proxy: Box<[u8]>,
    no_proxy: Box<[u8]>,
}

impl ProxySettings {
    /// Returns `None` when neither proxy is set: no re-evaluation is needed.
    pub(crate) fn new(
        http_proxy: Option<&[u8]>,
        https_proxy: Option<&[u8]>,
        no_proxy: Option<&[u8]>,
    ) -> Option<Arc<Self>> {
        let http_proxy = http_proxy.unwrap_or(b"");
        let https_proxy = https_proxy.unwrap_or(b"");
        if http_proxy.is_empty() && https_proxy.is_empty() {
            return None;
        }
        Some(Arc::new(Self {
            http_proxy: http_proxy.into(),
            https_proxy: https_proxy.into(),
            no_proxy: no_proxy.unwrap_or(b"").into(),
        }))
    }

    /// Capture `http_proxy` / `https_proxy` / `no_proxy` from the process env.
    pub fn from_env(env: &bun_dotenv::Loader) -> Option<Arc<Self>> {
        #[inline]
        fn is_emptyish(v: &[u8]) -> bool {
            v.is_empty() || v == b"\"\"" || v == b"''"
        }
        // lowercase first; an empty lowercase value falls through to uppercase.
        let read = |lower: &[u8], upper: &[u8]| -> Option<&[u8]> {
            let v = env
                .get(lower)
                .filter(|v| !v.is_empty())
                .or_else(|| env.get(upper))?;
            if is_emptyish(v) { None } else { Some(v) }
        };
        Self::new(
            read(b"http_proxy", b"HTTP_PROXY"),
            read(b"https_proxy", b"HTTPS_PROXY"),
            read(b"no_proxy", b"NO_PROXY"),
        )
    }

    /// Build from an explicit `fetch(url, { proxy })` option. The same proxy is
    /// used for both schemes; NO_PROXY is still consulted per hop.
    pub fn from_explicit(proxy_href: &[u8], env: &bun_dotenv::Loader) -> Option<Arc<Self>> {
        let no_proxy = env
            .get(b"no_proxy")
            .filter(|v| !v.is_empty())
            .or_else(|| env.get(b"NO_PROXY"))
            .filter(|v| !(v.is_empty() || *v == b"\"\"" || *v == b"''"));
        Self::new(Some(proxy_href), Some(proxy_href), no_proxy)
    }

    /// Proxy href to use for `url`, or `None` for a direct connection.
    pub fn resolve(&self, url: &URL<'_>) -> Option<&[u8]> {
        let href: &[u8] = if url.is_http() {
            &self.http_proxy
        } else {
            &self.https_proxy
        };
        if href.is_empty() {
            return None;
        }
        if no_proxy_matches(&self.no_proxy, url.hostname, url.host) {
            return None;
        }
        Some(href)
    }
}

/// Returns true if the given hostname/host should bypass the proxy according
/// to the supplied `no_proxy` list. Runs on the HTTP thread from a captured
/// copy of the env value; see https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/.
fn no_proxy_matches(no_proxy_text: &[u8], hostname: &[u8], host: &[u8]) -> bool {
    if hostname.is_empty() {
        return false;
    }
    for item in strings::split(no_proxy_text, b",") {
        let mut entry = strings::trim(item, &strings::WHITESPACE_CHARS);
        if entry.is_empty() {
            continue;
        }
        if entry == b"*" {
            return true;
        }
        if strings::starts_with_char(entry, b'.') {
            entry = &entry[1..];
            if entry.is_empty() {
                continue;
            }
        }

        // IPv6 literals contain multiple colons (e.g., "::1"); bracketed IPv6
        // with port is "[::1]:8080"; host:port has a single colon.
        let colon_count = strings::count_char(entry, b':');
        let has_port = if strings::starts_with_char(entry, b'[') {
            strings::index_of(entry, b"]:").is_some()
        } else {
            colon_count == 1
        };

        if has_port {
            if strings::eql_case_insensitive_ascii(host, entry, true) {
                return true;
            }
        } else {
            let entry_len = entry.len();
            if hostname.len() == entry_len {
                if strings::eql_case_insensitive_ascii(hostname, entry, true) {
                    return true;
                }
            } else if hostname.len() > entry_len
                && hostname[hostname.len() - entry_len - 1] == b'.'
                && strings::eql_case_insensitive_ascii(
                    &hostname[hostname.len() - entry_len..],
                    entry,
                    true,
                )
            {
                return true;
            }
        }
    }

    false
}
/// A request URL: the caller's parsed href (borrowed for `'a`), or one this
/// request owns (a redirect target, a proxy resolved from the environment). The
/// components are kept as resolved slices so the hot accessors are a load, not
/// a reparse.
pub struct RequestUrl {
    /// Keeps an owned href alive; `None` when the bytes are the caller's.
    backing: Option<Box<[u8]>>,
    href: bun_ptr::RawSlice<u8>,
    hash: bun_ptr::RawSlice<u8>,
    host: bun_ptr::RawSlice<u8>,
    hostname: bun_ptr::RawSlice<u8>,
    origin: bun_ptr::RawSlice<u8>,
    password: bun_ptr::RawSlice<u8>,
    pathname: bun_ptr::RawSlice<u8>,
    path: bun_ptr::RawSlice<u8>,
    port: bun_ptr::RawSlice<u8>,
    protocol: bun_ptr::RawSlice<u8>,
    search: bun_ptr::RawSlice<u8>,
    username: bun_ptr::RawSlice<u8>,
    is_https: bool,
    port_number: Option<u16>,
}

impl Default for RequestUrl {
    fn default() -> Self {
        RequestUrl::new(&URL::default())
    }
}

impl Clone for RequestUrl {
    fn clone(&self) -> Self {
        match &self.backing {
            // re-point the components into the copy
            Some(href) => RequestUrl::owned(bun_url::ParsedURL::new(href.clone())),
            None => self.lend_inner(),
        }
    }
}

impl RequestUrl {
    fn record(url: &URL<'_>, backing: Option<Box<[u8]>>) -> RequestUrl {
        use bun_ptr::RawSlice as R;
        RequestUrl {
            backing,
            href: R::new(url.href),
            hash: R::new(url.hash),
            host: R::new(url.host),
            hostname: R::new(url.hostname),
            origin: R::new(url.origin),
            password: R::new(url.password),
            pathname: R::new(url.pathname),
            path: R::new(url.path),
            port: R::new(url.port),
            protocol: R::new(url.protocol),
            search: R::new(url.search),
            username: R::new(url.username),
            is_https: url.is_https(),
            port_number: url.get_port(),
        }
    }

    /// The caller's parsed URL, borrowed for `'a`.
    #[inline]
    pub fn new(url: &URL<'_>) -> Self {
        Self::record(url, None)
    }

    /// A URL this request owns.
    pub fn owned(parsed: bun_url::ParsedURL) -> RequestUrl {
        // The components point into `parsed`'s heap href, which moves into
        // `backing` (the allocation itself stays put).
        let recorded = RequestUrl::record(&parsed.url(), None);
        RequestUrl {
            backing: Some(parsed.into_href()),
            ..recorded
        }
    }

    fn lend_inner(&self) -> RequestUrl {
        RequestUrl {
            backing: None,
            href: self.href,
            hash: self.hash,
            host: self.host,
            hostname: self.hostname,
            origin: self.origin,
            password: self.password,
            pathname: self.pathname,
            path: self.path,
            port: self.port,
            protocol: self.protocol,
            search: self.search,
            username: self.username,
            is_https: self.is_https,
            port_number: self.port_number,
        }
    }

    /// The full borrowed view (`search_params` is not carried).
    #[inline]
    pub fn url(&self) -> URL<'_> {
        URL::from_parts(&bun_url::UrlParts {
            hash: self.hash.slice(),
            host: self.host.slice(),
            hostname: self.hostname.slice(),
            href: self.href.slice(),
            origin: self.origin.slice(),
            password: self.password.slice(),
            pathname: self.pathname.slice(),
            path: self.path.slice(),
            port: self.port.slice(),
            protocol: self.protocol.slice(),
            search: self.search.slice(),
            username: self.username.slice(),
        })
    }
    #[inline]
    pub fn href(&self) -> &[u8] {
        self.href.slice()
    }
    #[inline]
    pub fn hostname(&self) -> &[u8] {
        self.hostname.slice()
    }
    #[inline]
    pub fn host(&self) -> &[u8] {
        self.host.slice()
    }
    #[inline]
    pub fn pathname(&self) -> &[u8] {
        self.pathname.slice()
    }
    #[inline]
    pub fn origin(&self) -> &[u8] {
        self.origin.slice()
    }
    #[inline]
    pub fn port(&self) -> &[u8] {
        self.port.slice()
    }
    #[inline]
    pub fn protocol(&self) -> &[u8] {
        self.protocol.slice()
    }
    #[inline]
    pub fn is_https(&self) -> bool {
        self.is_https
    }
    #[inline]
    pub fn is_http(&self) -> bool {
        strings::eql_case_insensitive_ascii(self.protocol(), b"http", true)
    }
    #[inline]
    pub fn has_http_like_protocol(&self) -> bool {
        self.is_https || self.is_http()
    }
    #[inline]
    pub fn get_port(&self) -> Option<u16> {
        self.port_number
    }
    #[inline]
    pub fn get_port_auto(&self) -> u16 {
        self.port_number
            .unwrap_or(if self.is_https { 443 } else { 80 })
    }
    pub fn display_protocol(&self) -> &[u8] {
        let protocol = self.protocol();
        if !protocol.is_empty() {
            return protocol;
        }
        if self.get_port() == Some(443) {
            return b"https";
        }
        b"http"
    }
}

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
//
// Lifetime `'a` is the caller's storage for the borrowed inputs — `url`,
// `header_buf`, `if_modified_since`, `hostname`, and the borrowed
// `Body::Bytes` payload. The HTTP thread's working copy
// (`RequestCell`, built by [`HTTPClient::clone_for_thread`]) is `'static`: by
// then the caller has promised (by queueing the request) to keep that storage
// alive until the terminal result.
pub struct HTTPClient {
    pub(crate) method: Method,
    pub header_entries: headers::EntryList,
    pub(crate) header_buf: bun_ptr::RawSlice<u8>,
    pub(crate) url: RequestUrl,
    /// Host and port of the peer the current socket was connected to (the
    /// proxy's when one is set, else `url`'s at connect time — a redirect
    /// rewrites `url` before the old socket is released).
    pub(crate) connected_hostname: HostName,
    pub(crate) connected_port: u16,
    pub verbose: HTTPVerboseLevel,
    pub remaining_redirect_count: i8,
    pub(crate) allow_retry: bool,
    /// Transparent re-dispatch count for REFUSED_STREAM / graceful-GOAWAY,
    /// where the server promises the request was not processed. Capped by
    /// `MAX_H2_RETRIES`.
    pub(crate) h2_retries: u8,
    pub(crate) redirect_type: FetchRedirect,
    /// A `Progress::Node` owned by the caller, which outlives the request.
    pub progress_node: Option<bun_ptr::BackRef<bun_core::Progress::Node>>,

    pub flags: Flags,

    /// Per-request override of the global [`IDLE_TIMEOUT_SECONDS`], set from
    /// `fetch(url, { timeout: <ms> })`. Already normalised (see
    /// [`normalize_idle_timeout_seconds`]). `None` = use the global default.
    pub(crate) idle_timeout_seconds: Option<c_uint>,

    pub(crate) state: InternalState,
    /// The body to start the request with; taken by `start_request` /
    /// retries. On the caller's side this is what `AsyncHTTP.request_body`
    /// carries instead.
    pub(crate) pending_body: Option<Body>,
    pub(crate) tls_props: Option<ssl_config::SharedPtr>,
    /// The custom SSL context used for this request (None = default context).
    /// Set by `ThreadState::connect()` when using custom TLS configs; this is
    /// the request's reference on it, released on drop.
    pub(crate) custom_ssl_ctx: Option<http_context::HTTPContextRc<true>>,

    /// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
    /// This is a workaround for that. Points into the caller's storage (or
    /// `header_buf`).
    pub if_modified_since: bun_ptr::RawSlice<u8>,
    pub(crate) request_content_len_buf: [u8; b"18446744073709551615".len()],

    pub(crate) http_proxy: Option<RequestUrl>,
    /// Captured proxy env (http_proxy / https_proxy / no_proxy) so redirects
    /// can re-resolve `http_proxy` against each hop's URL on the HTTP thread.
    /// `None` means the initial `http_proxy` is used for every hop.
    pub(crate) proxy_settings: Option<Arc<ProxySettings>>,
    pub(crate) proxy_headers: Option<Headers>,
    pub(crate) proxy_authorization: Option<Vec<u8>>,
    /// Set while this request is tunneling through an HTTP proxy (CONNECT):
    /// the request's reference on the tunnel (taken by `ProxyTunnel::start` /
    /// `adopt`, released on drop / handed to the keep-alive pool).
    pub(crate) proxy_tunnel: Option<proxy_tunnel::RefPtr>,
    /// Set when this request is bound to a stream on an HTTP/2 session.
    /// Owned by the session; cleared by the session when the stream completes.
    /// Whether an HTTP/2 stream currently carries this request.
    pub(crate) h2_attached: bool,
    /// Set when this request is bound to an HTTP/3 stream. Owned by the H3
    /// session; cleared by the session when the stream completes.
    /// Set while this request is the leader of a fresh TLS connect that other
    /// h2-capable requests have coalesced onto. Resolved (and freed) once ALPN
    /// is known or the connect fails. Points into the owning
    /// `HTTPContext.pending_h2_connects` Vec's boxed entry.
    pub(crate) pending_h2: Option<bun_ptr::BackRef<h2::PendingConnect>>,
    pub(crate) signals: Signals,
    pub(crate) async_http_id: u32,
    pub(crate) hostname: Option<bun_ptr::RawSlice<u8>>,
    pub(crate) unix_socket_path: ZigStringSlice,
    /// `fetch({ compress })` — when set, the body is compressed lazily at
    /// write time (h1: `send_initial_request_payload`; h2/h3: at attach) so
    /// the output can borrow `LibdeflateState::shared_buffer`. Persists across
    /// redirects/retries so each hop re-compresses from the original
    /// `state.original_request_body`.
    pub(crate) compress: Option<compress_body::CompressOption>,
    /// Backing storage for the compressed body when it must outlive a single
    /// synchronous write (output > shared buffer, partial h1 write, or h2/h3
    /// frame encoding). Empty in the common one-write h1 case.
    pub(crate) compressed_request_body: Vec<u8>,
    /// Compressed length for `Content-Length`; 0 when `compress` is None or
    /// the body hasn't been compressed yet.
    pub(crate) compressed_body_len: usize,
    /// The [`RequestCell`] this working copy lives in; `None` on the caller's
    /// side.
    pub(crate) req: Option<RequestRef>,
    /// The TLS session sink installed on this request's connection, so the
    /// handshake verdict can arm it.
    pub(crate) session_sink: Option<std::rc::Rc<session_cache::SessionSink>>,
}

impl HTTPClient {
    /// Back to what the owner configured: release everything this attempt
    /// acquired on the HTTP thread (here, on that thread) and undo the
    /// per-hop rewrites (`url`, `method`, stripped headers), so the owner may
    /// schedule the request again.
    fn reset_for_owner(&mut self, origin: &AsyncHTTP<'static>) {
        self.close_proxy_tunnel(false);
        if let Some(ctx) = self.custom_ssl_ctx.take() {
            ctx.deref();
        }
        self.session_sink = None;
        self.pending_h2 = None;
        self.h2_attached = false;
        self.req = None;
        self.pending_body = None;
        self.state = InternalState::default();
        self.header_entries.clear_retaining_capacity();
        if self.header_entries.capacity() >= origin.request_headers.len() {
            self.header_entries
                .append_list_assume_capacity(&origin.request_headers);
        } else {
            self.header_entries = origin.request_headers.clone().expect("OOM");
        }
        self.url = origin.url.clone();
        self.method = origin.method;
        self.connected_hostname.clear();
        self.connected_port = 0;
        self.compressed_request_body = Vec::new();
        self.compressed_body_len = 0;
        self.proxy_authorization = None;
        self.allow_retry = false;
        self.h2_retries = 0;
    }

    /// The cell this working copy lives in.
    #[inline]
    pub(crate) fn req(&self) -> RequestRef {
        self.req
            .expect("HTTPClient method used off the HTTP thread")
    }

    #[inline]
    pub(crate) fn thread(&self) -> &'static http_thread::ThreadState {
        self.req().thread()
    }

    #[inline]
    pub(crate) fn hostname(&self) -> Option<&[u8]> {
        self.hostname.as_ref().map(|h| h.slice())
    }

    #[inline]
    pub(crate) fn http_proxy(&self) -> Option<URL<'_>> {
        self.http_proxy.as_ref().map(RequestUrl::url)
    }

    /// Record the peer the next socket connects to: the proxy if one is set,
    /// else `url`, with `hostname` as the name actually dialled.
    pub(crate) fn set_connected_to(&mut self, hostname: &[u8]) {
        let port = match &self.http_proxy {
            Some(proxy) => proxy.get_port_auto(),
            None => self.url.get_port_auto(),
        };
        self.connected_hostname.set(hostname);
        self.connected_port = port;
    }

    /// [`set_connected_to`](Self::set_connected_to) with the proxy's / url's
    /// own hostname.
    pub(crate) fn set_connected_to_target(&mut self) {
        let (hostname, port) = match &self.http_proxy {
            Some(proxy) => (
                bun_ptr::RawSlice::new(proxy.hostname()),
                proxy.get_port_auto(),
            ),
            None => (
                bun_ptr::RawSlice::new(self.url.hostname()),
                self.url.get_port_auto(),
            ),
        };
        self.connected_hostname.set(hostname.slice());
        self.connected_port = port;
    }
}

impl Drop for RequestCell {
    fn drop(&mut self) {
        // The working copy's connection-level holds: only ever set on the
        // HTTP thread's client, so released with its cell.
        let client = self.client.get_mut();
        client.close_proxy_tunnel(false);
        if let Some(ctx) = client.custom_ssl_ctx.take() {
            ctx.deref();
        }
    }
}

pub use http_thread::http_thread;

// ═══════════════════════════════════════════════════════════════════════
// Prelude: imports, constants, helper fns, and bridge impls the
// `impl HTTPClient` state machine needs. Kept separate from the head/tail
// blocks so the state machine compiles standalone.
// ═══════════════════════════════════════════════════════════════════════

use core::cell::{Cell, RefCell};
use core::ffi::c_uint;

use bstr::BStr;
use bun_boringssl as boringssl;
use bun_collections::VecExt;
use bun_core::StringBuilder;
use bun_core::{FeatureFlags, Global, Output};
use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_http_types::ETag::StringPointer;
use bun_uws as uws;
// the std Wyhash algorithm, not Wyhash11.
use bun_wyhash::Wyhash;

use crate::http_context::HTTPSocket as HttpSocket;
use crate::internal_state::{RequestStage, ResponseStage, Stage};

bun_core::declare_scope!(fetch, visible);

/// Generic `HttpContext<const SSL>` alias — `crate::HttpsContext` (above) is
/// the concrete-SSL alias; the state machine needs a const-generic spelling
/// for `get_ssl_ctx<IS_SSL>()`.
pub(crate) type GenHttpContext<const SSL: bool> = http_context::HTTPContext<SSL>;

/// How the state machine holds a context across calls that also take
/// `&mut self`: the client keeps a reference on its custom context for its
/// whole life, and the default contexts live in the thread's state forever.
pub(crate) type CtxRef<const SSL: bool> = bun_ptr::BackRef<GenHttpContext<SSL>>;

// ── header constants ────────────────────────────────────────────────────
const HOST_HEADER_NAME: &[u8] = b"Host";
const CONTENT_LENGTH_HEADER_NAME: &[u8] = b"Content-Length";
const CHUNKED_ENCODED_HEADER: picohttp::Header =
    picohttp::Header::new(b"Transfer-Encoding", b"chunked");
const CONNECTION_HEADER: picohttp::Header = picohttp::Header::new(b"Connection", b"keep-alive");
const ACCEPT_HEADER: picohttp::Header = picohttp::Header::new(b"Accept", b"*/*");

const ACCEPT_ENCODING_NO_COMPRESSION: &[u8] = b"identity";
const ACCEPT_ENCODING_COMPRESSION: &[u8] = b"gzip, deflate, br, zstd";
const ACCEPT_ENCODING_HEADER_COMPRESSION: picohttp::Header =
    picohttp::Header::new(b"Accept-Encoding", ACCEPT_ENCODING_COMPRESSION);
const ACCEPT_ENCODING_HEADER_NO_COMPRESSION: picohttp::Header =
    picohttp::Header::new(b"Accept-Encoding", ACCEPT_ENCODING_NO_COMPRESSION);

const ACCEPT_ENCODING_HEADER: picohttp::Header = if FeatureFlags::DISABLE_COMPRESSION_IN_HTTP_CLIENT
{
    ACCEPT_ENCODING_HEADER_NO_COMPRESSION
} else {
    ACCEPT_ENCODING_HEADER_COMPRESSION
};

fn get_user_agent_header() -> picohttp::Header {
    let ua = OVERRIDDEN_DEFAULT_USER_AGENT.get().copied().unwrap_or(b"");
    picohttp::Header::new(
        b"User-Agent",
        if !ua.is_empty() {
            ua
        } else {
            Global::user_agent.as_bytes()
        },
    )
}

// ── header-hash constants ───────────────────────────────────────────────
// `Wyhash` is not `const fn`, so the per-header `match` arms inside
// `build_request` / `handle_response_metadata` call this runtime alias of
// `hash_header_name`.
#[inline(always)]
fn hash_header_const(name: &[u8]) -> u64 {
    hash_header_name(name)
}

bun_core::comptime_string_map! {
    /// Request-body-header names
    /// (https://fetch.spec.whatwg.org/#request-body-header-name).
    /// Keys are lowercase: looked up via `get_ascii_case_insensitive`.
    static REQUEST_BODY_HEADERS: () = {
        b"content-encoding" => (),
        b"content-language" => (),
        b"content-location" => (),
        b"content-type" => (),
    };
}

bun_core::comptime_string_map! {
    /// Headers deleted from the request on a cross-origin redirect.
    /// `host` is included because a user-supplied Host header names the
    /// previous origin; keeping it would also suppress the default Host
    /// header derived from the new URL.
    /// Keys are lowercase: looked up via `get_ascii_case_insensitive`.
    static CROSS_ORIGIN_STRIPPED_REQUEST_HEADERS: () = {
        b"authorization" => (),
        b"proxy-authorization" => (),
        b"cookie" => (),
        b"host" => (),
    };
}

// ── ALPN offer enum ─────────────────────────────────────────────────────
// bun_boringssl doesn't expose an ALPN-offer enum, so
// one is defined locally next to `configure_http_client_with_alpn`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AlpnOffer {
    H1,
    H2Only,
    H1OrH2,
}

/// Sets SNI (when `hostname` is `Some`), the legacy-server-connect option,
/// the ALPN protocol list for `offer`, and enables SCT/OCSP stapling. Called
/// from `on_open` for every TLS socket — must run even when the hostname is an
/// IP literal (with no SNI) so ALPN is still advertised.
pub fn configure_http_client_with_alpn(
    ssl: &mut boringssl::c::SSL,
    hostname: Option<&core::ffi::CStr>,
    offer: AlpnOffer,
) {
    const ALPN_H1: &[u8] = &[8, b'h', b't', b't', b'p', b'/', b'1', b'.', b'1'];
    const ALPN_H2: &[u8] = &[2, b'h', b'2'];
    const ALPN_H2_H1: &[u8] = &[
        2, b'h', b'2', 8, b'h', b't', b't', b'p', b'/', b'1', b'.', b'1',
    ];
    let alpns: &'static [u8] = match offer {
        AlpnOffer::H1 => ALPN_H1,
        AlpnOffer::H1OrH2 => ALPN_H2_H1,
        AlpnOffer::H2Only => ALPN_H2,
    };
    ssl.configure_client(hostname.filter(|h| !h.is_empty()), alpns);
}

// ── EntryList column accessors ──────────────────────────────────────────
use bun_http_types::ETag::HeaderEntryColumns;

impl<const SSL: bool> SocketTimeout for HttpSocket<SSL> {
    fn set_timeout(&self, seconds: c_uint) {
        uws::NewSocketHandler::<SSL>::set_timeout(self, seconds)
    }
}

/// Remove every abort-tracker entry whose stored socket is `socket`.
///
/// Backstop for the per-client `unregister_abort_tracker()` calls: when
/// `Handler::on_close` fires on a socket whose ext has already been retagged
/// as dead/pooled, the client/session dispatch is skipped and any stale entry
/// would survive into `us_internal_free_closed_sockets`, leaving
/// `drain_queued_shutdowns` to chase a freed socket on a later abort. O(n)
/// over live abortable requests; no-op on a `Detached` socket.
pub(crate) fn unregister_abort_tracker_for_socket(
    thread: &http_thread::ThreadState,
    socket: uws::InternalSocket,
) {
    if socket.is_detached() {
        return;
    }
    let mut tracker = thread.abort_tracker.borrow_mut();
    let mut i = 0usize;
    while i < tracker.count() {
        if *tracker.values()[i].socket() == socket {
            let _ = tracker.swap_remove_at(i);
        } else {
            i += 1;
        }
    }
}

/// Returns the hostname to use for TLS SNI and certificate verification.
/// Priority: tls_props.server_name > client.hostname > client.url.hostname()
/// The Host header value (client.hostname) may contain a port suffix which
/// must be stripped because it is not part of the DNS name in certificates.
fn get_tls_hostname<'c>(client: &'c HTTPClient, allow_proxy_url: bool) -> &'c [u8] {
    if allow_proxy_url {
        if let Some(proxy) = &client.http_proxy {
            return proxy.hostname();
        }
    }
    // Prefer the explicit TLS server_name (e.g. from Node.js servername option)
    if let Some(props) = &client.tls_props {
        if let Some(sn) = props.get().server_name_bytes() {
            if !sn.is_empty() {
                return sn;
            }
        }
    }
    // client.hostname comes from the Host header and may include ":port"
    if let Some(host) = client.hostname() {
        return strip_port_from_host(host);
    }
    client.url.hostname()
}

// ── support types ───────────────────────────────────────────────────────
#[derive(Clone, Copy)]
enum PendingH2Resolution {
    /// ALPN selected h2; waiters attach onto this session.
    H2(h2::SessionPtr),
    /// Handshake completed and ALPN selected http/1.1. Waiters can be pinned
    /// to h1 (and h2-pinned waiters failed) since the server has spoken.
    H1,
    /// Leader's connect/handshake failed or was aborted before ALPN. Nothing
    /// has been learned about the server's protocol support, so waiters must
    /// retry without protocol pinning.
    LeaderFailed,
}

struct InitialRequestPayloadResult {
    has_sent_headers: bool,
    has_sent_body: bool,
    try_sending_more_data: bool,
}

// ── request/response writers ────────────────────────────────────────────
/// Emit `Proxy-Authorization` (auto-generated from URL credentials, unless the
/// user supplied one via `proxy_headers`) followed by all custom
/// `proxy_headers`. Shared by `write_proxy_connect` and `write_proxy_request` —
/// the precedence rule (user-provided header wins over URL-derived credentials)
/// is identical for both CONNECT tunnels and absolute-form forward requests.
///
/// NOTE: this precedence is the *opposite* of the WebSocket upgrade client's
/// CONNECT builder, which is intentional — do not unify.
fn write_proxy_auth_and_headers(writer: &mut Vec<u8>, client: &HTTPClient) {
    // Check if user provided Proxy-Authorization in custom headers
    let user_provided_proxy_auth = client
        .proxy_headers
        .as_ref()
        .map(|hdrs| hdrs.get(b"proxy-authorization").is_some())
        .unwrap_or(false);

    // Only write auto-generated proxy_authorization if user didn't provide one
    if let Some(auth) = &client.proxy_authorization {
        if !user_provided_proxy_auth {
            writer.extend_from_slice(b"Proxy-Authorization: ");
            writer.extend_from_slice(auth);
            writer.extend_from_slice(b"\r\n");
        }
    }

    // Write custom proxy headers
    if let Some(hdrs) = &client.proxy_headers {
        let slice = hdrs.entries.slice();
        let names = slice.items_name();
        let values = slice.items_value();
        for (idx, name_ptr) in names.iter().enumerate() {
            writer.extend_from_slice(hdrs.as_str(*name_ptr));
            writer.extend_from_slice(b": ");
            writer.extend_from_slice(hdrs.as_str(values[idx]));
            writer.extend_from_slice(b"\r\n");
        }
    }
}

fn validate_request_target(target: &[u8]) -> crate::Result<()> {
    if target.iter().any(|&byte| byte <= 0x20 || byte == 0x7f) {
        return Err(crate::Error::InvalidURL);
    }
    Ok(())
}

fn write_proxy_connect(writer: &mut Vec<u8>, client: &HTTPClient) -> crate::Result<()> {
    validate_request_target(client.url.href())?;
    let port: &[u8] = if client.url.get_port().is_some() {
        client.url.port()
    } else if client.url.is_https() {
        b"443"
    } else {
        b"80"
    };
    writer.extend_from_slice(b"CONNECT ");
    writer.extend_from_slice(client.url.hostname());
    writer.extend_from_slice(b":");
    writer.extend_from_slice(port);
    writer.extend_from_slice(b" HTTP/1.1\r\n");

    writer.extend_from_slice(b"Host: ");
    writer.extend_from_slice(client.url.hostname());
    writer.extend_from_slice(b":");
    writer.extend_from_slice(port);

    writer.extend_from_slice(b"\r\nProxy-Connection: Keep-Alive\r\n");

    write_proxy_auth_and_headers(writer, client);

    writer.extend_from_slice(b"\r\n");
    Ok(())
}

fn write_proxy_request(
    writer: &mut Vec<u8>,
    request: &picohttp::Request<'_>,
    client: &HTTPClient,
) -> crate::Result<()> {
    validate_request_target(client.url.href())?;
    writer.extend_from_slice(request.method);
    // will always be http:// here, https:// needs CONNECT tunnel
    writer.extend_from_slice(b" http://");
    writer.extend_from_slice(client.url.hostname());
    // Only include the port in the absolute-form request URI when the
    // original URL had an explicit port. RFC 7230 §5.3.2 treats the default
    // port as redundant, and writing `:80`/`:443` here breaks proxies that
    // do strict Host/authority matching (e.g. Charles, mitmproxy). Matches
    // curl and Node.js `http.request` behavior.
    if client.url.get_port().is_some() {
        writer.extend_from_slice(b":");
        writer.extend_from_slice(client.url.port());
    }
    writer.extend_from_slice(request.path);
    writer.extend_from_slice(b" HTTP/1.1\r\nProxy-Connection: Keep-Alive\r\n");

    write_proxy_auth_and_headers(writer, client);

    for header in request.headers {
        writer.extend_from_slice(header.name());
        writer.extend_from_slice(b": ");
        writer.extend_from_slice(header.value());
        writer.extend_from_slice(b"\r\n");
    }

    writer.extend_from_slice(b"\r\n");
    Ok(())
}

fn write_request(writer: &mut Vec<u8>, request: &picohttp::Request<'_>) -> crate::Result<()> {
    validate_request_target(request.path)?;
    writer.extend_from_slice(request.method);
    writer.extend_from_slice(b" ");
    writer.extend_from_slice(request.path);
    writer.extend_from_slice(b" HTTP/1.1\r\n");

    for header in request.headers {
        writer.extend_from_slice(header.name());
        writer.extend_from_slice(b": ");
        writer.extend_from_slice(header.value());
        writer.extend_from_slice(b"\r\n");
    }

    writer.extend_from_slice(b"\r\n");
    Ok(())
}

#[cold]
pub(crate) fn print_request(
    protocol: Protocol,
    request: &picohttp::Request<'_>,
    url: &[u8],
    ignore_insecure: bool,
    body: &[u8],
    curl: bool,
) {
    if curl {
        let request_ = picohttp::Request {
            method: request.method,
            path: url,
            minor_version: request.minor_version,
            headers: request.headers,
            bytes_read: request.bytes_read,
        };
        bun_core::pretty_errorln!("{}", request_.curl(ignore_insecure, body));
    }

    let ver: &str = match protocol {
        Protocol::Http1_1 => "HTTP/1.1",
        Protocol::Http2 => "HTTP/2",
        Protocol::Http3 => "HTTP/3",
    };
    bun_core::pretty_errorln!(
        "> {} {} {}",
        ver,
        BStr::new(request.method),
        bun_core::fmt::redacted_npm_url(url),
    );
    for header in request.headers {
        let name = header.name();
        if strings::eql_case_insensitive_ascii(name, b"authorization", true)
            || strings::eql_case_insensitive_ascii(name, b"proxy-authorization", true)
        {
            let value = header.value();
            let scheme_len = strings::index_of_char_usize(value, b' ').map_or(0, |i| i + 1);
            bun_core::pretty_errorln!(
                "> <r><cyan>{}<r><d>: <r>{}<d>[redacted]<r>",
                BStr::new(name),
                BStr::new(&value[..scheme_len]),
            );
        } else {
            bun_core::pretty_errorln!("> {}", header);
        }
    }
    Output::flush();
}

#[cold]
fn print_response(response: &picohttp::Response<'_>) {
    bun_core::pretty_errorln!("{}", response);
    Output::flush();
}

/// Write data to the socket (Just a error wrapper to easly handle amount written and error handling)
fn write_to_socket<const IS_SSL: bool>(
    socket: HttpSocket<IS_SSL>,
    data: &[u8],
) -> crate::Result<usize> {
    let mut remaining = data;
    let mut total_written: usize = 0;
    while !remaining.is_empty() {
        let amount = socket.write(remaining);
        if amount < 0 {
            return Err(crate::Error::WriteFailed);
        }
        let wrote = usize::try_from(amount).expect("int cast");
        total_written += wrote;
        remaining = &remaining[wrote..];
        if wrote == 0 {
            break;
        }
    }
    Ok(total_written)
}

/// Write data to the socket and buffer the unwritten data if there is backpressure
fn write_to_socket_with_buffer_fallback<const IS_SSL: bool>(
    socket: HttpSocket<IS_SSL>,
    buffer: &mut bun_io::StreamBuffer,
    data: &[u8],
) -> crate::Result<usize> {
    let amount = write_to_socket::<IS_SSL>(socket, data)?;
    if amount < data.len() {
        let _ = buffer.write(&data[amount..]);
    }
    Ok(amount)
}

// ── Bridge stubs removed: real impls now live in HTTPContext.rs,
//    HTTPThread.rs, h2_client/ClientSession.rs, h3_client/ClientContext.rs
//    and ProxyTunnel.rs.
// ────────────────────────────────────────────────────────────────────────

/// Maps an X509 verify code
/// onto a `crate::Error` whose name is the upper-snake error tag
/// (e.g. `CERT_HAS_EXPIRED`). JS-side `error.code` matches on this exact
/// string, so do NOT substitute `X509_verify_cert_error_string` output here.
// constants are the BoringSSL `X509_V_ERR_*` values from
// `<openssl/x509.h>`. Inlined as literals so
// this file doesn't grow a dep on a header-generated const set.
pub(crate) fn get_cert_error_from_no(error_no: i32) -> crate::Error {
    use crate::error::CertError;
    crate::Error::Cert(match error_no {
        0 => CertError::OK, // X509_V_OK
        2 => CertError::UNABLE_TO_GET_ISSUER_CERT,
        3 => CertError::UNABLE_TO_GET_CRL,
        4 => CertError::UNABLE_TO_DECRYPT_CERT_SIGNATURE,
        5 => CertError::UNABLE_TO_DECRYPT_CRL_SIGNATURE,
        6 => CertError::UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY,
        7 => CertError::CERT_SIGNATURE_FAILURE,
        8 => CertError::CRL_SIGNATURE_FAILURE,
        9 => CertError::CERT_NOT_YET_VALID,
        10 => CertError::CERT_HAS_EXPIRED,
        11 => CertError::CRL_NOT_YET_VALID,
        12 => CertError::CRL_HAS_EXPIRED,
        13 => CertError::ERROR_IN_CERT_NOT_BEFORE_FIELD,
        14 => CertError::ERROR_IN_CERT_NOT_AFTER_FIELD,
        15 => CertError::ERROR_IN_CRL_LAST_UPDATE_FIELD,
        16 => CertError::ERROR_IN_CRL_NEXT_UPDATE_FIELD,
        17 => CertError::OUT_OF_MEM,
        18 => CertError::DEPTH_ZERO_SELF_SIGNED_CERT,
        19 => CertError::SELF_SIGNED_CERT_IN_CHAIN,
        20 => CertError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
        21 => CertError::UNABLE_TO_VERIFY_LEAF_SIGNATURE,
        22 => CertError::CERT_CHAIN_TOO_LONG,
        23 => CertError::CERT_REVOKED,
        24 => CertError::INVALID_CA,
        25 => CertError::PATH_LENGTH_EXCEEDED,
        26 => CertError::INVALID_PURPOSE,
        27 => CertError::CERT_UNTRUSTED,
        28 => CertError::CERT_REJECTED,
        29 => CertError::SUBJECT_ISSUER_MISMATCH,
        30 => CertError::AKID_SKID_MISMATCH,
        31 => CertError::AKID_ISSUER_SERIAL_MISMATCH,
        32 => CertError::KEYUSAGE_NO_CERTSIGN,
        33 => CertError::UNABLE_TO_GET_CRL_ISSUER,
        34 => CertError::UNHANDLED_CRITICAL_EXTENSION,
        35 => CertError::KEYUSAGE_NO_CRL_SIGN,
        36 => CertError::UNHANDLED_CRITICAL_CRL_EXTENSION,
        37 => CertError::INVALID_NON_CA,
        38 => CertError::PROXY_PATH_LENGTH_EXCEEDED,
        39 => CertError::KEYUSAGE_NO_DIGITAL_SIGNATURE,
        40 => CertError::PROXY_CERTIFICATES_NOT_ALLOWED,
        41 => CertError::INVALID_EXTENSION,
        42 => CertError::INVALID_POLICY_EXTENSION,
        43 => CertError::NO_EXPLICIT_POLICY,
        44 => CertError::DIFFERENT_CRL_SCOPE,
        45 => CertError::UNSUPPORTED_EXTENSION_FEATURE,
        46 => CertError::UNNESTED_RESOURCE,
        47 => CertError::PERMITTED_VIOLATION,
        48 => CertError::EXCLUDED_VIOLATION,
        49 => CertError::SUBTREE_MINMAX,
        50 => CertError::APPLICATION_VERIFICATION,
        51 => CertError::UNSUPPORTED_CONSTRAINT_TYPE,
        52 => CertError::UNSUPPORTED_CONSTRAINT_SYNTAX,
        53 => CertError::UNSUPPORTED_NAME_SYNTAX,
        54 => CertError::CRL_PATH_VALIDATION_ERROR,
        56 => CertError::SUITE_B_INVALID_VERSION,
        57 => CertError::SUITE_B_INVALID_ALGORITHM,
        58 => CertError::SUITE_B_INVALID_CURVE,
        59 => CertError::SUITE_B_INVALID_SIGNATURE_ALGORITHM,
        60 => CertError::SUITE_B_LOS_NOT_ALLOWED,
        61 => CertError::SUITE_B_CANNOT_SIGN_P_384_WITH_P_256,
        62 => CertError::HOSTNAME_MISMATCH,
        63 => CertError::EMAIL_MISMATCH,
        64 => CertError::IP_ADDRESS_MISMATCH,
        65 => CertError::INVALID_CALL,
        66 => CertError::STORE_LOOKUP,
        67 => CertError::NAME_CONSTRAINTS_WITHOUT_SANS,
        _ => CertError::UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
    })
}

// ── HTTPClient field accessors ──────────────────────────────────────────
impl HTTPClient {
    #[inline]
    /// Whether closing this socket gracefully would queue our FIN behind
    /// request-body bytes that have not yet been handed to the kernel - the
    /// case where the peer (which may have stopped reading the body) would
    /// never observe the connection closing.
    pub(crate) fn has_unsent_request_body(&self) -> bool {
        if self.state.request_stage == RequestStage::Done {
            return false;
        }
        if self.flags.is_streaming_request_body {
            // More body chunks may still be produced by JS.
            return true;
        }
        !self.request_body().is_empty()
    }

    /// Pooling a socket whose request is still going out would land the next request inside this one's body.
    #[inline]
    fn is_request_fully_sent(&self) -> bool {
        self.state.request_stage == RequestStage::Done
    }

    #[inline]
    fn request_body(&self) -> &[u8] {
        // `request_body` is a `RawSlice` into `original_request_body` (sibling
        // field of `self`).
        self.state.request_body.slice()
    }
    /// The tunnel's handle, for the entry points that may release the client's
    /// reference while they run (`ProxyTunnel::on_writable` / `receive`).
    #[inline]
    pub(crate) fn proxy_tunnel_this(&self) -> Option<bun_ptr::ThisPtr<ProxyTunnel>> {
        self.proxy_tunnel.as_ref().map(|p| p.this_ptr())
    }
    /// The tunnel, not borrowed through `self` (the client's reference keeps
    /// it alive for as long as `proxy_tunnel` is set).
    #[inline]
    fn proxy_tunnel_ref(&self) -> Option<bun_ptr::BackRef<ProxyTunnel>> {
        self.proxy_tunnel
            .as_ref()
            .map(|p| bun_ptr::BackRef::new(&**p))
    }

    /// Detach the proxy tunnel, if one is attached, and release this client's
    /// ref on it. The tunnel is unhooked from this request first, so the
    /// shutdown's close callback does not come back to it.
    #[inline]
    fn close_proxy_tunnel(&mut self, shutdown: bool) {
        if let Some(t) = self.proxy_tunnel.take() {
            t.detach_request();
            if shutdown {
                proxy_tunnel::ProxyTunnel::shutdown(&t);
            }
            t.detach_socket();
            t.deref();
        }
    }
    /// Common tail of `fail` / `fail_from_h2` / `complete_connecting_process`:
    /// build the result, reset request state, and dispatch the callback.
    fn dispatch_result_and_reset(&mut self, clear_proxy_tunneling: bool) {
        let result = self.to_result();
        self.state.reset();
        // `state.reset()` returns every stage field to Pending, which makes
        // this finished client indistinguishable from a fresh one. Every
        // caller reaches here with `stage == Fail` (a terminal state), and the
        // final result dispatched below retires the cell that holds this
        // client. Restore the terminal stage so a late event on a
        // still-reachable reference (socket tag, timer, tracker entry) hits
        // the `stage != Done && stage != Fail` guards and becomes a no-op
        // instead of delivering a second final result. The success path
        // (`send_progress_update_without_stage_check`) already restores
        // `Stage::Done` the same way after its reset.
        self.state.request_stage = RequestStage::Fail;
        self.state.response_stage = ResponseStage::Fail;
        self.state.stage = Stage::Fail;
        if clear_proxy_tunneling {
            self.flags.proxy_tunneling = false;
        }
        self.req().deliver(result);
    }
    /// Common `progress.activate(); set_completed_items(n); maybe_refresh()`
    /// triple used at every body-chunk boundary.
    fn report_progress(&mut self, completed: usize) {
        if let Some(progress) = self.progress_node {
            progress.activate();
            progress.set_completed_items(completed);
            progress.maybe_refresh();
        }
    }
}

// ───────────────────────────── impl HTTPClient ─────────────────────────────

impl HTTPClient {
    pub(crate) fn check_server_identity<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        ssl: &mut boringssl::c::SSL,
        allow_proxy_url: bool,
    ) -> bool {
        if self.flags.reject_unauthorized {
            {
                if let Some(x509) = ssl.peer_leaf_certificate() {
                    let hostname = get_tls_hostname(self, allow_proxy_url);

                    // check if we need to report the error (probably to `checkServerIdentity` was informed from JS side)
                    // this is the slow path
                    //
                    // The JS callback only applies to the *target's* certificate
                    // (Node semantics). For the HTTPS proxy's own handshake, use
                    // the native SAN check — a pinning callback written for the
                    // target would reject the proxy's certificate.
                    let is_proxy_certificate = allow_proxy_url && self.http_proxy.is_some();
                    if !is_proxy_certificate && self.signals.get(signals::Field::CertErrors) {
                        // clone the relevant data
                        let hostname = Box::<[u8]>::from(hostname);
                        let cert = x509.to_der().into_boxed_slice();
                        self.state.certificate_info = Some(CertificateInfo { cert, hostname });

                        // Park the connection until the JS-side
                        // `checkServerIdentity` callback approves this
                        // certificate (gates `on_writable`/`on_data`; see the
                        // flag's doc comment). The JS thread resumes via
                        // `HTTPThread::schedule_cert_check_resume` on success,
                        // or schedules a shutdown on failure.
                        self.state.flags.is_waiting_for_cert_check = true;

                        // we inform the user that the cert is invalid
                        let ctx = self.get_ssl_ctx::<IS_SSL>();
                        self.progress_update::<IS_SSL>(ctx, socket);
                        // continue until we are aborted or not
                        return true;
                    } else {
                        // we check with native code if the cert is valid
                        // fast path
                        if boringssl::check_x509_server_identity(x509, hostname) {
                            return true;
                        }
                    }
                }
            }
            // SSL error so we fail the connection
            self.close_and_fail::<IS_SSL>(crate::Error::ERR_TLS_CERT_ALTNAME_INVALID, socket);
            return false;
        }
        // we allow the connection to continue anyway
        true
    }

    pub(crate) fn register_abort_tracker<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.signals.aborted.is_some() {
            let any = if IS_SSL {
                uws::AnySocket::SocketTls(uws::SocketTLS::from_any(socket.socket))
            } else {
                uws::AnySocket::SocketTcp(uws::SocketTCP::from_any(socket.socket))
            };
            let _ = self
                .thread()
                .abort_tracker
                .borrow_mut()
                .put(self.async_http_id, any);
        }
    }

    pub(crate) fn unregister_abort_tracker(&mut self) {
        if self.signals.aborted.is_some() {
            let _ = self
                .thread()
                .abort_tracker
                .borrow_mut()
                .swap_remove(&self.async_http_id);
        }
    }

    /// Runs once per request: for a new connection via [`Self::on_connect`],
    /// and for a socket reused from the pool via `HTTPContext::connect`.
    pub(crate) fn on_open<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) -> crate::Result<()> {
        if cfg!(debug_assertions) {
            if let Some(proxy) = &self.http_proxy {
                debug_assert!(IS_SSL == proxy.is_https());
            } else {
                debug_assert!(IS_SSL == self.url.is_https());
            }
        }
        self.register_abort_tracker::<IS_SSL>(socket);
        bun_core::scoped_log!(fetch, "Connected {} \n", BStr::new(self.url.href()));

        // Arm the idle timer immediately so a stalled TLS handshake (server
        // accepts TCP but never answers ClientHello, or a NAT/middlebox silently
        // drops the flow under load) eventually fails with error.Timeout instead
        // of leaving the request — and for `bun install`, the whole process —
        // blocked in epoll_wait forever. Previously the first `set_timeout` call
        // was inside `on_writable`, which only runs *after* the handshake
        // completes. See https://github.com/oven-sh/bun/issues/30325.
        self.set_timeout(&socket);

        if self.signals.get(signals::Field::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return Err(crate::Error::ClientAborted);
        }

        if self.state.request_stage == RequestStage::Pending {
            self.state.request_stage = RequestStage::Opened;
        }

        if IS_SSL {
            if let Some(ssl) = socket.ssl_mut().filter(|ssl| !ssl.is_init_finished()) {
                // SNI only when the hostname is not an IP literal (RFC 6066
                // forbids IP SNI). ALPN/SCT/OCSP must still be configured
                // regardless, so the helper runs unconditionally.
                let sni = SniHostname::new(get_tls_hostname(self, self.http_proxy.is_some()));
                configure_http_client_with_alpn(ssl, sni.as_cstr(), self.alpn_offer());

                if crate::session_cache::eligible(self) {
                    let want_tunnel = self.http_proxy.is_some() && self.url.is_https();
                    let proxy_auth_hash = if want_tunnel || self.http_proxy.is_none() {
                        self.proxy_auth_hash()
                    } else {
                        0
                    };
                    self.session_sink = crate::session_cache::install(
                        ssl,
                        self.get_ssl_ctx::<true>(),
                        &self.connected_hostname,
                        self.connected_port,
                        proxy_auth_hash,
                    );
                }
            }
        } else {
            self.first_call::<IS_SSL>(socket);
        }
        Ok(())
    }

    /// Runs once per connection, from the uSockets open callback. A socket
    /// reused from the pool skips this and goes straight to [`Self::on_open`],
    /// so socket options belong here, not there.
    pub(crate) fn on_connect<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) -> crate::Result<()> {
        // Enable TCP keepalive so a half-open connection (peer closed but the
        // FIN/RST never reached us — NAT timeout, wifi/cellular handoff,
        // middlebox state eviction, VPN disconnect) is detected in ~70s instead
        // of hanging until an application-level timeout. Without this, a
        // streaming `reader.read()` on a half-open socket blocks indefinitely.
        // Matches Node/undici, which calls `socket.setKeepAlive(true, 60e3)` in
        // buildConnector:
        // https://github.com/nodejs/undici/blob/f33a6cb615e1/lib/core/connect.js#L121-L124
        // TCP_KEEPIDLE=60, KEEPINTVL=1, KEEPCNT=10 — the latter two are hardcoded
        // in bsd_socket_keepalive. The kernel default TCP_KEEPIDLE is 7200s, so
        // bare SO_KEEPALIVE without the delay would be ineffective; 60 here sets
        // TCP_KEEPIDLE=60s.
        //
        // `disable_keepalive` is set when fetch is called with `keepalive: false`,
        // which is what `node:http`/`node:https` pass through from
        // `agent.keepAlive` (see _http_client.ts) — so requests through
        // `http.globalAgent` (`keepAlive: true`) get TCP keepalive and requests
        // through a non-keepalive Agent or `agent: false` skip it, matching Node.
        //
        // TCP options do not apply to a unix socket.
        if !self.flags.disable_keepalive && self.unix_socket_path.slice().is_empty() {
            let _ = socket.set_keep_alive(true, 60);
        }

        self.on_open::<IS_SSL>(socket)
    }

    /// Whether to advertise "h2" in the TLS ALPN list. Restricted to request
    /// shapes the HTTP/2 path currently handles end-to-end (no proxy/Upgrade,
    /// no sendfile). Enabled by `--experimental-http2-fetch`, the
    /// `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT` env var, or
    /// `protocol: "http2"` on the fetch options.
    pub(crate) fn can_offer_h2(&self) -> bool {
        // The h2 session transmits from `attach()` without consulting the
        // `is_waiting_for_cert_check` park gate, so requests with a JS
        // `checkServerIdentity` callback stay on HTTP/1.1.
        if self.signals.get(signals::Field::CertErrors) {
            return false;
        }
        if self.flags.forced_protocol == Some(Protocol::Http1_1) {
            return false;
        }
        if self.http_proxy.is_some() {
            return false;
        }
        if self.flags.is_preconnect_only {
            return false;
        }
        if self.unix_socket_path.slice().len() > 0 {
            return false;
        }
        if matches!(
            self.state.original_request_body,
            Body::Sendfile(_)
        ) {
            return false;
        }
        self.flags.forced_protocol == Some(Protocol::Http2)
            || EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.load(Ordering::Relaxed)
            || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT
                .get()
                .unwrap_or(false)
    }

    pub(crate) fn alpn_offer(&self) -> AlpnOffer {
        if !self.can_offer_h2() {
            return AlpnOffer::H1;
        }
        if self.flags.forced_protocol == Some(Protocol::Http2) {
            AlpnOffer::H2Only
        } else {
            AlpnOffer::H1OrH2
        }
    }

    /// Whether this request shape is eligible to *use* a cached Alt-Svc h3
    /// alternative (HTTPS, no proxy/unix-socket, no sendfile, not pinned to a
    /// specific protocol). When true, `start_()` consults `H3.AltSvc.lookup`
    /// before opening TCP.
    pub(crate) fn can_try_h3_alt_svc(&self) -> bool {
        // The h3 client never routes through `check_server_identity`, so a JS
        // `checkServerIdentity` callback could never run; stay on TCP.
        if self.signals.get(signals::Field::CertErrors) {
            return false;
        }
        if matches!(
            self.flags.forced_protocol,
            Some(Protocol::Http1_1 | Protocol::Http2)
        ) {
            return false;
        }
        if self.http_proxy.is_some() {
            return false;
        }
        if self.flags.is_preconnect_only {
            return false;
        }
        if self.unix_socket_path.slice().len() > 0 {
            return false;
        }
        if matches!(
            self.state.original_request_body,
            Body::Sendfile(_)
        ) {
            return false;
        }
        if self.has_tls_options_unsupported_by_h3() {
            return false;
        }
        h3_alt_svc_enabled()
    }

    fn has_tls_options_unsupported_by_h3(&self) -> bool {
        self.signals.get(signals::Field::CertErrors)
            || self
                .tls_props
                .as_ref()
                .is_some_and(|tls| tls.get().requires_custom_request_ctx)
    }

    pub(crate) fn first_call<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
            if self.flags.is_preconnect_only {
                self.on_preconnect::<IS_SSL>(socket);
                return;
            }
        }

        if IS_SSL {
            let is_h2 = socket
                .ssl_mut()
                .is_some_and(|ssl| ssl.alpn_selected() == b"h2");
            if is_h2 {
                bun_core::scoped_log!(fetch, "ALPN negotiated h2 {}", BStr::new(self.url.href()));
                // This arm needs HttpSocket<true>, but the const-generic isn't
                // unified here, so rebuild from the InternalSocket.
                let tls_socket = uws::SocketTLS::from_any(socket.socket);
                let ctx = self.get_ssl_ctx::<true>();
                // `create` tags the socket with the new session (the tag holds
                // the session's first reference); `attach_leader` may release
                // it (a failed first flush tears the session down), so
                // `session` is not used after that call.
                let session = h2::ClientSession::create(ctx, tls_socket, self);
                self.resolve_pending_h2(PendingH2Resolution::H2(session));
                h2::ClientSession::attach_leader(session, self);
                return;
            }
            self.flags.protocol = Protocol::Http1_1;
            self.resolve_pending_h2(PendingH2Resolution::H1);
            if self.flags.forced_protocol == Some(Protocol::Http2) {
                self.close_and_fail::<IS_SSL>(crate::Error::HTTP2Unsupported, socket);
                return;
            }
        }

        match self.state.request_stage {
            RequestStage::Opened | RequestStage::Pending => {
                self.on_writable::<true, IS_SSL>(socket);
            }
            _ => {}
        }
    }

    /// Re-enter the connect path for a request that was coalesced onto an h2
    /// session but couldn't be attached (cap reached, or ALPN chose h1).
    pub(crate) fn retry_after_h2_coalesce(&mut self) {
        self.start_::<true>();
    }

    pub(crate) fn retry_from_h2(&mut self) {
        debug_assert!(!self.h2_attached);
        self.unregister_abort_tracker();
        self.flags.protocol = Protocol::Http1_1;
        self.h2_retries += 1;
        let body = core::mem::take(&mut self.state.original_request_body);
        self.state.reset();
        self.start(body);
    }

    /// Called by the HTTP/2 session for stream-level termination (RST_STREAM,
    /// GOAWAY, abort, decode error). The socket stays up for sibling streams, so
    /// only the request fails.
    pub(crate) fn fail_from_h2(&mut self, err: crate::Error) {
        debug_assert!(!self.h2_attached);
        self.unregister_abort_tracker();
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            self.state.request_stage = RequestStage::Fail;
            self.state.response_stage = ResponseStage::Fail;
            self.state.fail = Some(err);
            self.state.stage = Stage::Fail;
            if self
                .flags
                .defer_terminal_dispatch_until_connecting_is_complete
            {
                return;
            }
            self.dispatch_result_and_reset(false);
        }
    }

    pub(crate) fn on_close<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        bun_core::scoped_log!(fetch, "Closed  {}\n", BStr::new(self.url.href()));
        // the socket is closed, we need to unregister the abort tracker
        self.unregister_abort_tracker();

        if self.signals.get(signals::Field::Aborted) {
            self.fail(crate::Error::Aborted);
            return;
        }
        self.close_proxy_tunnel(true);
        let in_progress = self.state.stage != Stage::Done
            && self.state.stage != Stage::Fail
            && !self.state.flags.is_redirect_pending;
        if self.state.flags.is_redirect_pending {
            // if the connection is closed and we are pending redirect just do the redirect
            // in this case we will re-connect or go to a different socket if needed
            let ctx = self.get_ssl_ctx::<IS_SSL>();
            self.do_redirect::<IS_SSL>(ctx, socket);
            return;
        }
        if in_progress && self.state.is_body_complete_on_close() {
            if let Err(err) = self.state.finalize_body_on_eof() {
                self.fail(err);
                return;
            }
            let ctx = self.get_ssl_ctx::<IS_SSL>();
            self.progress_update::<IS_SSL>(ctx, socket);
            return;
        }

        // `in_progress` also keeps a client whose final result was already
        // delivered (stage Done/Fail) from restarting; the request is retired
        // once that result is dispatched, so a late close event must not
        // re-enter `start()`.
        if in_progress
            && self.allow_retry
            && self.method.is_idempotent()
            // Only a Bytes body can be rebuilt from `original_request_body`.
            // Stream/Sendfile bodies are consumed as they are written, so a
            // retry would silently replay a truncated request.
            && matches!(self.state.original_request_body, Body::Bytes(_))
            && self.state.response_stage != ResponseStage::Body
            && self.state.response_stage != ResponseStage::BodyChunk
        {
            self.allow_retry = false;
            // we need to retry the request, clean up the response message buffer and start again
            self.state.response_message_buffer = MutableString::default();
            let body = core::mem::take(&mut self.state.original_request_body);
            self.start(body);
            return;
        }

        if in_progress {
            self.fail(crate::Error::ConnectionClosed);
        }
    }

    pub(crate) fn on_timeout<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if self.flags.disable_timeout {
            return;
        }
        bun_core::scoped_log!(fetch, "Timeout  {}\n", BStr::new(self.url.href()));
        // Terminate (mark dead + close) BEFORE failing, matching
        // `close_and_fail`: `fail()` dispatches the final result and retires
        // this request, and the socket must already be de-tagged so the
        // synchronous close callbacks (TLS close fires on_handshake for a
        // mid-handshake socket) cannot re-enter this client.
        GenHttpContext::<IS_SSL>::terminate_socket(socket);
        self.fail(crate::Error::Timeout);
    }

    /// `dns_error` is the raw `getaddrinfo(3)` return code when the name
    /// lookup itself failed; 0 for a connect failure past name resolution.
    pub(crate) fn on_connect_error(&mut self, dns_error: i32) {
        bun_core::scoped_log!(
            fetch,
            "onConnectError  {} dns_error={}\n",
            BStr::new(self.url.href()),
            dns_error
        );
        if dns_error != 0 {
            self.state.dns_error = dns_error;
            // `connected_hostname` is the exact name the connect resolved
            // (the proxy's when one is set, else the post-redirect `url`), set
            // by `HTTPContext::connect`.
            self.state.dns_hostname = Some(self.connected_hostname.as_slice().into());
            self.fail(crate::Error::DNSResolveFailed);
            return;
        }
        self.fail(crate::Error::ConnectionRefused);
    }

    /// Get the buffer we use to write data to the network.
    ///
    /// For large files, we want to avoid extra network send overhead
    /// So we do two things:
    /// 1. Use a 32 KB buffer for small files, 2. a 512 KB buffer for large files.
    /// This only has an impact on http://
    ///
    /// On https://, we are limited to a 16 KB TLS record size.
    #[inline]
    fn get_request_body_send_buffer(&self) -> Vec<u8> {
        let actual_estimated_size =
            self.request_body().len() + self.estimated_request_header_byte_length();
        let estimated_size = if HTTPClient::is_https(self) {
            actual_estimated_size.min(MAX_TLS_RECORD_SIZE)
        } else {
            actual_estimated_size * 2
        };
        Vec::with_capacity(http_thread::request_body_send_buffer_capacity(
            estimated_size,
        ))
    }

    pub(crate) fn is_keep_alive_possible(&self) -> bool {
        if FeatureFlags::ENABLE_KEEPALIVE {
            // TODO keepalive for unix sockets
            if self.unix_socket_path.slice().len() > 0 {
                return false;
            }
            // A peer accepted by a per-request JS `checkServerIdentity` callback must
            // not enter or leave the shared pool (same exclusion as `can_offer_h2`).
            if self.signals.get(signals::Field::CertErrors) {
                return false;
            }
            // check state
            if self.state.flags.allow_keepalive && !self.flags.disable_keepalive {
                return true;
            }
        }
        false
    }

    /// Hash of the per-request tunnel discriminators beyond the (proxy, target
    /// url.hostname/port, ssl_config) tuple already covered by separate pool-key
    /// fields. Covers the Host-header SNI override (hostname) plus everything
    /// writeProxyConnect sends: all proxy_headers entries and the auto-generated
    /// Proxy-Authorization (if not overridden by a user header). Returns 0 if
    /// none apply.
    ///
    /// target_hostname in the pool stores url.hostname (the CONNECT TCP target
    /// at writeProxyConnect line 346). But the inner TLS SNI/cert verification
    /// uses `hostname`, falling back to url.hostname. If a Host header
    /// override sets hostname != url.hostname, two requests to different IPs
    /// with the same Host header must NOT share a tunnel — they're physically
    /// connected to different servers. Hashing hostname here catches that.
    ///
    /// Per-header hashes are combined with wrapping add so insertion order
    /// doesn't matter and duplicate headers don't cancel to zero.
    pub(crate) fn proxy_auth_hash(&self) -> u64 {
        let mut combined: u64 = 0;
        let mut any = false;
        let mut name_lower_buf = [0u8; 256];

        // SNI override — distinct from url.hostname which is stored separately
        // as the CONNECT target. Normalize before hashing: strip port (Host
        // header may include ":443"), lowercase (DNS is case-insensitive per
        // RFC 1035), and skip if it matches url.hostname (no actual override —
        // a request with an explicit but identical Host header should hit the
        // same pool entry as one without).
        if let Some(sni_raw) = &self.hostname {
            let sni = strip_port_from_host(sni_raw);
            if !strings::eql_case_insensitive_ascii(sni, self.url.hostname(), true) {
                let sni_lower: &[u8] = if sni.len() <= name_lower_buf.len() {
                    strings::copy_lowercase(sni, &mut name_lower_buf[0..sni.len()])
                } else {
                    sni
                };
                combined = combined.wrapping_add(bun_wyhash::hash(sni_lower));
                any = true;
            }
        }

        let mut user_provided_auth = false;
        if let Some(hdrs) = &self.proxy_headers {
            let slice = hdrs.entries.slice();
            let names = slice.items_name();
            let values = slice.items_value();
            for (idx, name_ptr) in names.iter().enumerate() {
                let name = hdrs.as_str(*name_ptr);
                let value = hdrs.as_str(values[idx]);
                // HTTP header names are case-insensitive (RFC 7230 §3.2) —
                // lowercase so "X-Foo" and "x-foo" hash identically.
                let name_lower: &[u8] = if name.len() <= name_lower_buf.len() {
                    strings::copy_lowercase(name, &mut name_lower_buf[0..name.len()])
                } else {
                    name
                };
                let mut h = Wyhash::init(0);
                h.update(name_lower);
                h.update(b":");
                h.update(value);
                // Wrapping add, not XOR — duplicate identical headers (via
                // Headers.append) would cancel under XOR (H(x)^H(x)=0) and
                // collide with the no-headers sentinel. Add is commutative
                // (order-independent) without the cancellation.
                combined = combined.wrapping_add(h.final_());
                any = true;
                if strings::eql_case_insensitive_ascii(name, b"proxy-authorization", true) {
                    user_provided_auth = true;
                }
            }
        }
        // writeProxyConnect only sends proxy_authorization if the user didn't
        // already provide one in proxy_headers — match that precedence.
        if !user_provided_auth {
            if let Some(auth) = &self.proxy_authorization {
                let mut h = Wyhash::init(0);
                h.update(b"proxy-authorization:");
                h.update(auth);
                combined = combined.wrapping_add(h.final_());
                any = true;
            }
        }

        if any { combined } else { 0 }
    }

    /// Returns the SSL context for this client - either the custom context
    /// (for mTLS/custom TLS) or the default global context.
    pub(crate) fn get_ssl_ctx<const IS_SSL: bool>(&self) -> CtxRef<IS_SSL> {
        if IS_SSL {
            if let Some(ctx) = self.custom_ssl_ctx.as_ref() {
                return bun_ptr::BackRef::new(ctx.cast_ssl::<IS_SSL>());
            }
        }
        bun_ptr::BackRef::new(self.thread().context::<IS_SSL>())
    }

    /// Take `ctx` as this request's custom-context reference (releasing any
    /// previous one).
    pub(crate) fn set_custom_ssl_ctx(&mut self, ctx: http_context::HTTPContextRc<true>) {
        if let Some(old) = self.custom_ssl_ctx.replace(ctx) {
            old.deref();
        }
    }

    pub(crate) fn header_str(&self, ptr: StringPointer) -> &[u8] {
        header_str_in(&self.header_buf, ptr)
    }
}

fn header_str_in(header_buf: &bun_ptr::RawSlice<u8>, ptr: StringPointer) -> &[u8] {
    {
        let buf: &[u8] = header_buf.slice();
        let end = (ptr.offset as usize).wrapping_add(ptr.length as usize);
        // Match `Headers::as_str`: return empty on a desynced `header_entries`
        // / `header_buf` rather than slice-panicking on the HTTP thread.
        debug_assert!(
            end <= buf.len() && ptr.offset as usize <= end,
            "HTTPClient::header_str: StringPointer {{ offset: {}, length: {} }} out of range for header_buf of length {}",
            ptr.offset,
            ptr.length,
            buf.len(),
        );
        if end > buf.len() || ptr.offset as usize > end {
            return b"";
        }
        &buf[ptr.offset as usize..end]
    }
}

impl HTTPClient {
    /// Fill `request_headers_buf` with this request's header block and return
    /// how many headers were written; [`Self::built_request`] then assembles
    /// the `Request` view over them.
    pub(crate) fn build_request(
        &mut self,
        body_len: usize,
        request_headers_buf: &mut [picohttp::Header; http_thread::MAX_REQUEST_HEADERS],
    ) -> usize {
        let mut header_count: usize = 0;
        let header_buf = self.header_buf;
        let header_str = |ptr: StringPointer| header_str_in(&header_buf, ptr);
        let header_entries = self.header_entries.slice();
        let header_names = header_entries.items_name();
        let header_values = header_entries.items_value();

        let mut override_accept_encoding = false;
        let mut override_accept_header = false;
        let mut override_host_header = false;
        let mut override_connection_header = false;
        let mut connection_close_requested = false;
        let mut override_user_agent = false;
        let mut add_transfer_encoding = true;
        let mut original_content_length: Option<&[u8]> = None;

        // Reserve slots for default headers that may be appended after user headers
        // (Connection, User-Agent, Accept, Host, Accept-Encoding, Content-Length/Transfer-Encoding).
        const MAX_DEFAULT_HEADERS: usize = 6;
        const MAX_USER_HEADERS: usize = http_thread::MAX_REQUEST_HEADERS - MAX_DEFAULT_HEADERS;

        for (i, head) in header_names.iter().enumerate() {
            let name = header_str(*head);
            // Hash it as lowercase
            let hash = hash_header_name(name);

            // Whether this header will actually be written to the buffer.
            // Override flags must only be set when the header is kept, otherwise
            // the default header is suppressed but the user header is dropped,
            // leaving the header entirely absent from the request.
            let will_append = header_count < MAX_USER_HEADERS;

            // Skip host and connection header
            // we manage those
            match hash {
                h if h == hash_header_const(b"Content-Length") => {
                    // Content-Length is always consumed (never written to the buffer).
                    original_content_length = Some(header_str(header_values[i]));
                    continue;
                }
                h if h == hash_header_const(b"Connection") => {
                    if will_append {
                        override_connection_header = true;
                        match connection_header_keep_alive(header_str(header_values[i])) {
                            Some(false) => {
                                connection_close_requested = true;
                                self.flags.disable_keepalive = true;
                            }
                            Some(true) if !connection_close_requested => {
                                self.flags.disable_keepalive = false;
                            }
                            _ => {}
                        }
                    }
                }
                h if h == hash_header_const(b"if-modified-since") => {
                    if self.flags.force_last_modified && self.if_modified_since.is_empty() {
                        self.if_modified_since =
                            bun_ptr::RawSlice::new(header_str(header_values[i]));
                    }
                }
                h if h == hash_header_const(HOST_HEADER_NAME) => {
                    if will_append {
                        override_host_header = true;
                    }
                }
                h if h == hash_header_const(b"Accept") => {
                    if will_append {
                        override_accept_header = true;
                    }
                }
                h if h == hash_header_const(b"User-Agent") => {
                    if will_append {
                        override_user_agent = true;
                    }
                }
                h if h == hash_header_const(b"Accept-Encoding") => {
                    if will_append {
                        override_accept_encoding = true;
                    }
                }
                h if h == hash_header_const(b"Upgrade") => {
                    if will_append {
                        if upgrade_header_is_not_h2(header_str(header_values[i])) {
                            self.flags.upgrade_state = HTTPUpgradeState::Pending;
                        }
                    }
                }
                h if h == hash_header_const(CHUNKED_ENCODED_HEADER.name()) => {
                    if !self.flags.is_streaming_request_body {
                        continue;
                    }
                    // We don't want to override chunked encoding header if it was set by the user
                    if will_append {
                        add_transfer_encoding = false;
                    }
                }
                _ => {}
            }

            // Silently drop excess headers to stay within the fixed-size request header buffer.
            if !will_append {
                continue;
            }

            request_headers_buf[header_count] =
                picohttp::Header::new(name, header_str(header_values[i]));

            header_count += 1;
        }

        if !override_connection_header && !self.flags.disable_keepalive {
            request_headers_buf[header_count] = CONNECTION_HEADER;
            header_count += 1;
        }

        if !override_user_agent {
            request_headers_buf[header_count] = get_user_agent_header();
            header_count += 1;
        }

        if !override_accept_header {
            request_headers_buf[header_count] = ACCEPT_HEADER;
            header_count += 1;
        }

        if !override_host_header {
            request_headers_buf[header_count] =
                picohttp::Header::new(HOST_HEADER_NAME, self.url.host());
            header_count += 1;
        }

        if !override_accept_encoding && !self.flags.disable_decompression {
            request_headers_buf[header_count] = ACCEPT_ENCODING_HEADER;
            header_count += 1;
        }

        if body_len > 0 || self.method.has_request_body() {
            if self.flags.is_streaming_request_body {
                if let Some(content_length) = original_content_length {
                    if add_transfer_encoding {
                        // User explicitly set Content-Length and did not set Transfer-Encoding;
                        // preserve Content-Length instead of using chunked encoding.
                        // This matches Node.js behavior where an explicit Content-Length is always honored.
                        request_headers_buf[header_count] =
                            picohttp::Header::new(CONTENT_LENGTH_HEADER_NAME, content_length);
                        header_count += 1;
                    }
                    // If !add_transfer_encoding, the user explicitly set Transfer-Encoding,
                    // which was already added to request_headers_buf. We respect that and
                    // do not add Content-Length (they are mutually exclusive per HTTP/1.1).
                } else if add_transfer_encoding
                    && self.flags.upgrade_state == HTTPUpgradeState::None
                {
                    request_headers_buf[header_count] = CHUNKED_ENCODED_HEADER;
                    header_count += 1;
                }
            } else {
                let value: &[u8] =
                    bun_core::fmt::int_as_bytes(&mut self.request_content_len_buf, body_len);
                request_headers_buf[header_count] =
                    picohttp::Header::new(CONTENT_LENGTH_HEADER_NAME, value);
                header_count += 1;
            }
        } else if let Some(content_length) = original_content_length
            && (self.flags.is_node_http_client
                || matches!(bun_core::parse_unsigned::<usize>(content_length, 10), Ok(0)))
        {
            request_headers_buf[header_count] =
                picohttp::Header::new(CONTENT_LENGTH_HEADER_NAME, content_length);
            header_count += 1;
        }

        header_count
    }

    /// The request head over the headers [`Self::build_request`] wrote.
    pub(crate) fn built_request<'r>(
        method: Method,
        url: &'r RequestUrl,
        headers: &'r [picohttp::Header],
    ) -> picohttp::Request<'r> {
        picohttp::Request {
            method: method.as_str().as_bytes(),
            path: url.pathname(),
            minor_version: 1,
            headers,
            bytes_read: 0,
        }
    }

    pub(crate) fn do_redirect<const IS_SSL: bool>(
        &mut self,
        ctx: CtxRef<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.do_redirect_multiplexed();
        }
        bun_core::scoped_log!(fetch, "doRedirect");
        if matches!(self.state.original_request_body, Body::Stream(_)) {
            // handleResponseMetadata already rejected every non-303 status with a
            // stream body (RequestBodyNotReusable). Reaching here means the
            // redirect downgraded to GET with a null body; drop the streaming
            // flag so the follow-up request goes out without Transfer-Encoding,
            // and let state.reset() release the ThreadSafeStreamBuffer ref.
            self.flags.is_streaming_request_body = false;
        }

        // Decided before unix_socket_path is cleared below: a unix-socket connection must not be pooled.
        let keep_alive_possible = self.is_keep_alive_possible();
        self.unix_socket_path = ZigStringSlice::EMPTY;
        // TODO: what we do with stream body?
        let request_body = if self.state.flags.resend_request_body_on_redirect
            && matches!(self.state.original_request_body, Body::Bytes(_))
        {
            match &self.state.original_request_body {
                Body::Bytes(b) => Body::Bytes(*b),
                _ => unreachable!(),
            }
        } else {
            Body::EMPTY
        };

        self.state.response_message_buffer = MutableString::default();

        self.remaining_redirect_count = self.remaining_redirect_count.saturating_sub(1);
        self.flags.redirected = true;
        debug_assert!(self.redirect_type == FetchRedirect::Follow);
        self.unregister_abort_tracker();

        // By the time doRedirect runs, handleResponseMetadata has already mutated
        // this.url to the redirect destination. Pooling the tunnel here would
        // store it under the WRONG target hostname — a follow-up request to the
        // redirect destination could then reuse a TLS session negotiated with the
        // original host. Close the tunnel on redirect; only pool the raw socket.
        if self.proxy_tunnel.is_some() {
            bun_core::scoped_log!(fetch, "close the tunnel");
            self.close_proxy_tunnel(true);
            GenHttpContext::<IS_SSL>::close_socket(socket);
        } else if keep_alive_possible
            && self.is_request_fully_sent()
            && !socket.is_closed_or_has_error()
            // A direct TLS socket verified against a Host-header override
            // (get_tls_hostname) must not be pooled here: this.url has already
            // been repointed at the redirect destination, so proxy_auth_hash()
            // can no longer compute the correct pool key. Close it instead.
            && (!IS_SSL || self.http_proxy.is_some() || self.hostname.is_none())
        {
            bun_core::scoped_log!(fetch, "Keep-Alive release in redirect");
            debug_assert!(!self.connected_hostname.is_empty());
            ctx.release_socket(
                socket,
                self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
                self.flags.reject_unauthorized,
                &self.connected_hostname,
                self.connected_port,
                self.tls_props.as_ref(),
                None,
                b"",
                0,
                0,
                None,
            );
        } else {
            GenHttpContext::<IS_SSL>::close_socket(socket);
        }
        self.connected_hostname.clear();

        // Deferred until after the pool/close decision above — see
        // `InternalStateFlags::clear_hostname_on_redirect`.
        if self.state.flags.clear_hostname_on_redirect {
            self.state.flags.clear_hostname_on_redirect = false;
            self.hostname = None;
        }

        // TODO: should this check be before decrementing the redirect count?
        // the current logic will allow one less redirect than requested
        if self.remaining_redirect_count == 0 {
            self.fail(crate::Error::TooManyRedirects);
            return;
        }
        self.state.reset();
        bun_core::scoped_log!(fetch, "doRedirect state reset");
        // also reset proxy to redirect
        self.flags.proxy_tunneling = false;
        self.close_proxy_tunnel(false);
        self.flags.protocol = Protocol::Http1_1;
        self.reevaluate_proxy_for_redirect();

        self.start(request_body);
    }

    /// Re-resolve `http_proxy` against the post-redirect `self.url`. The
    /// decision was made once on the JS thread at request creation; without
    /// this, a redirect into a `no_proxy`-exempt host would still be sent via
    /// the proxy, and a redirect out of one would bypass it.
    fn reevaluate_proxy_for_redirect(&mut self) {
        let Some(settings) = self.proxy_settings.as_deref() else {
            return;
        };
        let new_href = settings.resolve(&self.url.url());
        let current = self.http_proxy.as_ref().map(|p| p.href()).unwrap_or(b"");
        if new_href.unwrap_or(b"") == current {
            return;
        }
        match new_href {
            None => {
                self.http_proxy = None;
                self.proxy_authorization = None;
            }
            Some(href) => {
                let proxy = bun_url::ParsedURL::new(Box::from(href));
                self.proxy_authorization = async_http::build_proxy_authorization(&proxy.url());
                self.http_proxy = Some(RequestUrl::owned(proxy));
            }
        }
    }

    /// **Not thread safe while request is in-flight**
    pub(crate) fn is_https(&self) -> bool {
        if let Some(proxy) = &self.http_proxy {
            return proxy.is_https();
        }
        self.url.is_https()
    }

    /// Begin the request on the HTTP thread with the body it was queued with.
    pub(crate) fn start_request(&mut self) {
        let body = self.pending_body.take().unwrap_or_default();
        self.start(body);
    }

    pub(crate) fn start(&mut self, body: Body) {
        debug_assert!(self.state.response_message_buffer.list.capacity() == 0);
        self.state = InternalState::init(self.thread(), body);

        if self.is_https() {
            self.start_::<true>();
        } else {
            self.start_::<false>();
        }
    }

    fn start_<const IS_SSL: bool>(&mut self) {
        self.unregister_abort_tracker();
        self.session_sink = None;

        // Mark that we are connecting: a terminal result reached inside this
        // function (synchronous failure, or preconnect completing on a pooled
        // socket) is recorded and dispatched by `complete_connecting_process()`
        // instead, so the request is retired only once these frames are done
        // with it.
        // `complete_connecting_process()` cannot be a Drop guard here
        // (it needs `&mut self`, which would alias every other `self.*` call in the body),
        // so it is called explicitly before each return.
        self.flags
            .defer_terminal_dispatch_until_connecting_is_complete = true;

        // Aborted before connecting
        if self.signals.get(signals::Field::Aborted) {
            self.fail(crate::Error::AbortedBeforeConnecting);
            self.complete_connecting_process();
            return;
        }

        // protocol: "http2" is documented as HTTPS-only (h2c is out of scope).
        // Every h2 consumer is gated on the SSL const-generic, so without this
        // an http:// request would silently fall through to HTTP/1.1.
        if !IS_SSL {
            if self.flags.forced_protocol == Some(Protocol::Http2) {
                self.fail(crate::Error::HTTP2Unsupported);
                self.complete_connecting_process();
                return;
            }
        }

        if IS_SSL {
            // Opportunistic Alt-Svc upgrade: a previous response from this origin
            // advertised `h3`, and the experimental flag is on. Don't touch
            // `flags.forced_protocol` — that's the user's explicit `protocol:"http3"`
            // choice and persists across redirects, whereas an Alt-Svc upgrade is
            // per-origin and a cross-origin redirect must re-evaluate from h1.
            // `doRedirectMultiplexed` resets `flags.protocol`, so the redirected
            // request lands back here with `forced_protocol` still `None` and
            // consults the cache for the new origin.
            if self.flags.forced_protocol != Some(Protocol::Http3) && self.can_try_h3_alt_svc() {
                let thread = self.thread();
                let alt_port = thread
                    .alt_svc
                    .borrow_mut()
                    .lookup(self.url.hostname(), self.url.get_port_auto());
                if let Some(alt_port) = alt_port {
                    if let Some(ctx) = h3::ClientContext::get_or_create(thread) {
                        let hostname = bun_ptr::RawSlice::new(self.url.hostname());
                        if !ctx.connect(self, hostname.slice(), alt_port) {
                            self.fail(crate::Error::ConnectionRefused);
                        }
                        self.complete_connecting_process();
                        return;
                    }
                    // engine init failed: fall through to TCP
                }
            }
        }

        // `can_offer_h2` refuses to advertise h2 when a JS `checkServerIdentity`
        // callback is set, so `protocol: "http2"` + callback would handshake and
        // then fail in `first_call` anyway. Fail up front instead.
        if self.flags.forced_protocol == Some(Protocol::Http2)
            && self.signals.get(signals::Field::CertErrors)
        {
            self.fail(crate::Error::HTTP2Unsupported);
            self.complete_connecting_process();
            return;
        }

        if self.flags.forced_protocol == Some(Protocol::Http3) {
            // h3 never routes through `check_server_identity`; refuse the
            // combination instead of silently skipping the JS callback.
            if self.signals.get(signals::Field::CertErrors) {
                self.fail(crate::Error::HTTP3Unsupported);
                self.complete_connecting_process();
                return;
            }
            if !IS_SSL {
                self.fail(crate::Error::HTTP3Unsupported);
                self.complete_connecting_process();
                return;
            }
            if self.http_proxy.is_some() || self.unix_socket_path.slice().len() > 0 {
                self.fail(crate::Error::HTTP3Unsupported);
                self.complete_connecting_process();
                return;
            }
            if self.has_tls_options_unsupported_by_h3() {
                self.fail(crate::Error::HTTP3Unsupported);
                self.complete_connecting_process();
                return;
            }
            let Some(ctx) = h3::ClientContext::get_or_create(self.thread()) else {
                self.fail(crate::Error::HTTP3Unsupported);
                self.complete_connecting_process();
                return;
            };
            let (hostname, port) = (
                bun_ptr::RawSlice::new(self.url.hostname()),
                self.url.get_port_auto(),
            );
            if !ctx.connect(self, hostname.slice(), port) {
                self.fail(crate::Error::ConnectionRefused);
            }
            self.complete_connecting_process();
            return;
        }

        let socket = match self.thread().connect::<IS_SSL>(self) {
            Ok(Some(s)) => s,
            Ok(None) => {
                // Coalesced onto an in-flight h2 connect; the leader will attach us
                // (or re-dispatch) once ALPN resolves.
                self.complete_connecting_process();
                return;
            }
            Err(err) => {
                self.fail(err);
                self.complete_connecting_process();
                return;
            }
        };

        if socket.is_closed()
            && (self.state.response_stage != ResponseStage::Done
                && self.state.response_stage != ResponseStage::Fail)
        {
            GenHttpContext::<IS_SSL>::mark_socket_as_dead(socket);
            self.fail(crate::Error::ConnectionClosed);
            self.complete_connecting_process();
            return;
        }

        // If we haven't already called onOpen(), then that means we need to
        // register the abort tracker. We need to do this in cases where the
        // connection takes a long time to happen such as when it's not routable.
        // See test/js/bun/io/fetch/fetch-abort-slow-connect.test.ts.
        //
        // We have to be careful here because if .connect() had finished
        // synchronously, then this socket is on longer valid and the pointer points
        // to invalid memory.
        if self.state.request_stage == RequestStage::Pending {
            self.register_abort_tracker::<IS_SSL>(socket);
        }
        self.complete_connecting_process();
    }

    /// Body length for `Content-Length` — the compressed length once
    /// [`compress_body_for_send`] has run, otherwise the original.
    #[inline]
    pub(crate) fn body_len_for_send(&self) -> usize {
        if self.state.flags.body_compressed {
            self.compressed_body_len
        } else {
            self.state.original_request_body.len()
        }
    }

    /// Lazy one-shot request-body compression at write time. Re-seats
    /// `state.request_body` (the send cursor) to the compressed bytes;
    /// `state.original_request_body` stays as the original uncompressed slice
    /// so redirects/retries can re-compress from it. When `into_shared` and
    /// the bound fits, the cursor borrows `LibdeflateState::shared_buffer` —
    /// callers must [`spill_compressed_body`] before returning to the event
    /// loop with bytes left to send. Idempotent per attempt via
    /// `state.flags.body_compressed`.
    ///
    /// [`spill_compressed_body`]: Self::spill_compressed_body
    pub(crate) fn compress_body_for_send(&mut self, into_shared: bool) -> crate::Result<()> {
        let Some(opt) = self.compress else {
            return Ok(());
        };
        if self.state.flags.body_compressed {
            return Ok(());
        }
        let Body::Bytes(input) = self.state.original_request_body else {
            return Ok(());
        };
        if input.is_empty() {
            return Ok(());
        }

        let thread = self.thread();
        let mut deflater = thread.deflater();
        let out = compress_body::compress_into(
            &mut deflater,
            input.slice(),
            &opt,
            &mut self.compressed_request_body,
        )?;
        // The cursor points either into `LibdeflateState::shared_buffer`
        // (the thread's, valid for the current synchronous callback — the
        // caller spills before yielding) or into `self.compressed_request_body`
        // (only mutated by this function via `clear()` on the next attempt
        // after `state.reset()`).
        let cursor = match out {
            compress_body::CompressOutput::Shared(n) if into_shared => {
                bun_ptr::RawSlice::new(&deflater.shared_buffer[..n])
            }
            compress_body::CompressOutput::Shared(n) => {
                self.compressed_request_body
                    .extend_from_slice(&deflater.shared_buffer[..n]);
                bun_ptr::RawSlice::new(self.compressed_request_body.as_slice())
            }
            compress_body::CompressOutput::Spilled => {
                bun_ptr::RawSlice::new(self.compressed_request_body.as_slice())
            }
        };
        self.compressed_body_len = cursor.len();
        self.state.request_body = cursor;
        self.state.flags.body_compressed = true;
        Ok(())
    }

    /// Copy any unsent compressed bytes still borrowing `shared_buffer` into
    /// `compressed_request_body` and re-seat the cursor. No-op when the cursor
    /// already points at the Vec (or is empty).
    fn spill_compressed_body(&mut self) {
        if !self.state.flags.body_compressed
            || !self.compressed_request_body.is_empty()
            || self.state.request_body.is_empty()
        {
            return;
        }
        self.compressed_request_body
            .extend_from_slice(self.state.request_body.slice());
        self.state.request_body = bun_ptr::RawSlice::new(self.compressed_request_body.as_slice());
    }

    fn estimated_request_header_byte_length(&self) -> usize {
        let sliced = self.header_entries.slice();
        let mut count: usize = 0;
        for head in sliced.items_name() {
            count += head.length as usize;
        }
        for value in sliced.items_value() {
            count += value.length as usize;
        }
        count
    }

    // This exists as a separate function to reduce the amount of time the request body buffer is kept around.
    #[inline(never)]
    fn send_initial_request_payload<const IS_FIRST_CALL: bool, const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) -> crate::Result<InitialRequestPayloadResult> {
        self.compress_body_for_send(true)?;

        let mut temporary_send_buffer = self.get_request_body_send_buffer();

        let writer = &mut temporary_send_buffer; // Vec<u8> impls bun_io::Write

        let thread = self.thread();
        let mut request_headers_buf = thread.request_headers_buf.borrow_mut();
        let header_count = self.build_request(self.body_len_for_send(), &mut request_headers_buf);
        let request =
            Self::built_request(self.method, &self.url, &request_headers_buf[..header_count]);

        if self.http_proxy.is_some() {
            if self.url.is_https() {
                bun_core::scoped_log!(fetch, "start proxy tunneling (https proxy)");
                // DO the tunneling!
                self.flags.proxy_tunneling = true;
                write_proxy_connect(writer, self)?;
            } else {
                bun_core::scoped_log!(fetch, "start proxy request (http proxy)");
                // HTTP do not need tunneling with CONNECT just a slightly different version of the request
                write_proxy_request(writer, &request, self)?;
            }
        } else {
            bun_core::scoped_log!(fetch, "normal request");
            validate_request_target(self.url.host())?;
            write_request(writer, &request)?;
        }

        let headers_len = temporary_send_buffer.len();
        if !self.request_body().is_empty()
            && temporary_send_buffer.capacity() - temporary_send_buffer.len() > 0
            && !self.flags.proxy_tunneling
        {
            let spare = temporary_send_buffer.capacity() - temporary_send_buffer.len();
            let wrote = spare.min(self.request_body().len());
            debug_assert!(wrote > 0);
            temporary_send_buffer.extend_from_slice(&self.request_body()[0..wrote]);
        }

        let to_send = &temporary_send_buffer[self.state.request_sent_len..];
        // The socket can be dead here: on_handshake → on_writable runs while
        // draining buffered TLS bytes, and a write on the outer connection in
        // proxy.on_writable (or a close fired from the SSL wrapper's flush)
        // can mark the socket closed/shut down before we reach this point.
        // Writing to it would return 0 and the request would hang at
        // Headers forever. Surface ConnectionClosed so the caller's
        // close_and_fail runs.
        if socket.is_closed() || socket.is_shutdown() {
            return Err(crate::Error::ConnectionClosed);
        }
        let amount = write_to_socket::<IS_SSL>(socket, to_send)?;
        if IS_FIRST_CALL {
            if amount == 0 {
                // don't worry about it
                self.spill_compressed_body();
                return Ok(InitialRequestPayloadResult {
                    has_sent_headers: self.state.request_sent_len >= headers_len,
                    has_sent_body: false,
                    try_sending_more_data: false,
                });
            }
        }

        self.state.request_sent_len += amount;
        let has_sent_headers = self.state.request_sent_len >= headers_len;

        if has_sent_headers && self.verbose != HTTPVerboseLevel::None {
            print_request(
                Protocol::Http1_1,
                &request,
                self.url.href(),
                !self.flags.reject_unauthorized,
                self.request_body(),
                self.verbose == HTTPVerboseLevel::Curl,
            );
        }

        if has_sent_headers && !self.request_body().is_empty() {
            self.state.request_body = bun_ptr::RawSlice::new(
                &self.state.request_body.slice()[self.state.request_sent_len - headers_len..],
            );
        }

        let has_sent_body = if matches!(self.state.original_request_body, Body::Bytes(_))
        {
            self.request_body().is_empty()
        } else {
            false
        };

        self.spill_compressed_body();

        Ok(InitialRequestPayloadResult {
            has_sent_headers,
            has_sent_body,
            try_sending_more_data: amount == to_send.len() && (!has_sent_body || !has_sent_headers),
        })
    }

    pub(crate) fn flush_stream<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        // only flush the stream if needed no additional data is being added
        self.write_to_stream::<IS_SSL>(socket, b"");
    }

    /// Write buffered data to the socket returning true if there is backpressure
    fn write_to_stream_using_buffer<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        buffer: &mut bun_io::StreamBuffer,
        data: &[u8],
    ) -> crate::Result<bool> {
        // Through a proxy tunnel the stream body goes via the inner TLS,
        // not the outer socket.
        if let Some(proxy) = self.proxy_tunnel_ref() {
            if socket.is_closed() || socket.is_shutdown() {
                return Err(crate::Error::ConnectionClosed);
            }
            // Any Err is backpressure: WantRead/WantWrite retry on the next
            // on_writable, and a fatal SSL error queued a close the caller
            // acts on once the stream buffer is released, so bail via Ok(true).
            let pending = buffer.slice().len();
            if pending > 0 {
                let Ok(n) = proxy.write(buffer.slice()) else {
                    let _ = buffer.write(data);
                    return Ok(true);
                };
                self.state.request_sent_len += n;
                buffer.cursor += n;
                if n < pending {
                    let _ = buffer.write(data);
                    return Ok(true);
                }
                buffer.reset();
            }
            if !data.is_empty() {
                let Ok(n) = proxy.write(data) else {
                    let _ = buffer.write(data);
                    return Ok(true);
                };
                self.state.request_sent_len += n;
                if n < data.len() {
                    let _ = buffer.write(&data[n..]);
                    return Ok(true);
                }
            }
            return Ok(false);
        }

        let to_send_len = buffer.slice().len();
        if to_send_len > 0 {
            let amount = write_to_socket::<IS_SSL>(socket, buffer.slice())?;
            self.state.request_sent_len += amount;
            buffer.cursor += amount;
            if amount < to_send_len {
                // we could not send all pending data so we need to buffer the extra data
                if !data.is_empty() {
                    let _ = buffer.write(data); // OOM/capacity: fire-and-forget
                }
                // failed to send everything so we have backpressure
                return Ok(true);
            }
            if buffer.is_empty() {
                buffer.reset();
            }
        }

        // ok we flushed all pending data so we can reset the backpressure
        if !data.is_empty() {
            // no backpressure everything was sended so we can just try to send
            let sent = write_to_socket_with_buffer_fallback::<IS_SSL>(socket, buffer, data)?;
            self.state.request_sent_len += sent;
            // if we didn't send all the data we have backpressure
            return Ok(sent < data.len());
        }
        // no data to send so we are done
        Ok(false)
    }

    pub(crate) fn write_to_stream<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        data: &[u8],
    ) {
        bun_core::scoped_log!(fetch, "flushStream");
        // Never write body bytes before the request headers: drain_queued_writes can
        // reach this via the not-yet-opened socket start_() puts in the abort tracker,
        // and request_sent_len still indexes headers. on_writable's Body arm re-flushes.
        if !matches!(
            self.state.request_stage,
            RequestStage::Body | RequestStage::ProxyBody
        ) {
            return;
        }
        let upgrade_state = self.flags.upgrade_state;
        // The stream's reference keeps the shared buffer alive; nothing below
        // releases it before `request_stream_detach`, after which the handle
        // is not used.
        let (stream_buffer, ended) = {
            let Body::Stream(stream) = &self.state.original_request_body else {
                return;
            };
            let Some(buf) = stream.buffer() else { return };
            (
                bun_ptr::BackRef::<ThreadSafeStreamBuffer>::new(buf),
                stream.ended,
            )
        };
        if upgrade_state == HTTPUpgradeState::Pending {
            // cannot drain yet, upgrade is waiting for upgrade
            return;
        }
        let mut buffer = stream_buffer.lock();
        let was_empty = buffer.is_empty() && data.is_empty();
        if was_empty && ended {
            // nothing is buffered and the stream is done so we just release and detach
            //
            // An earlier flush already drained the terminating 0\r\n\r\n, so
            // the request message is complete. Mark the stage Done for the
            // keep-alive / redirect pooling gates, matching the
            // `ended && !has_backpressure` exit below.
            self.state.request_stage = RequestStage::Done;
            drop(buffer);
            self.request_stream_detach();
            if upgrade_state == HTTPUpgradeState::Upgraded {
                // for upgraded connections we need to shutdown the socket to signal the end of the connection
                // otherwise the client will wait forever for the connection to be closed
                socket.shutdown();
            }
            return;
        }

        // to simplify things here the buffer contains the raw data we just need to flush to the socket it
        let has_backpressure =
            match self.write_to_stream_using_buffer::<IS_SSL>(socket, &mut buffer.buffer, data) {
                Ok(b) => b,
                Err(err) => {
                    // we got some critical error so we need to fail and close the connection
                    drop(buffer);
                    self.request_stream_detach();
                    self.close_and_fail::<IS_SSL>(err, socket);
                    return;
                }
            };

        if has_backpressure {
            // we have backpressure so just release the buffer and wait for onWritable
            drop(buffer);
        } else {
            if ended {
                // done sending everything so we can release the buffer and detach the stream
                self.state.request_stage = RequestStage::Done;
                drop(buffer);
                self.request_stream_detach();
                if upgrade_state == HTTPUpgradeState::Upgraded {
                    // for upgraded connections we need to shutdown the socket to signal the end of the connection
                    // otherwise the client will wait forever for the connection to be closed
                    socket.shutdown();
                }
            } else {
                // only report drain if we send everything and previous we had something to send
                if !was_empty {
                    buffer.report_drain();
                }
                // release the buffer so main thread can use it to send more data
                drop(buffer);
            }
        }
    }

    /// Re-borrow `state.original_request_body` and detach the stream variant.
    /// Factored out so [`write_to_stream`] can drop its body borrow before
    /// calling `&mut self` methods, then re-acquire only for the detach.
    #[inline]
    fn request_stream_detach(&mut self) {
        if let Body::Stream(stream) = &mut self.state.original_request_body {
            stream.detach();
        }
    }

    pub(crate) fn on_writable<const IS_FIRST_CALL: bool, const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.signals.get(signals::Field::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return;
        }

        if FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
            if self.flags.is_preconnect_only {
                self.on_preconnect::<IS_SSL>(socket);
                return;
            }
        }

        if let Some(proxy) = self.proxy_tunnel_this() {
            ProxyTunnel::on_writable::<IS_SSL>(proxy, socket);
            // ProxyTunnel::on_writable → SSLWrapper::flush → handle_traffic
            // may process a TLS alert or close_notify that was buffered
            // alongside the handshake flight; its close → close_and_fail
            // terminates the outer socket and finishes this request. The
            // socket handle says whether that happened.
            self.drain_tunnel_events();
            if socket.is_closed() {
                return;
            }
        }

        // Parked until the JS `checkServerIdentity` callback approves the peer
        // certificate: write no HTTP data. Kept below the tunnel flush so the
        // handshake's final flight still reaches the wire while parked.
        if self.state.flags.is_waiting_for_cert_check {
            return;
        }

        match self.state.request_stage {
            RequestStage::Pending | RequestStage::Headers | RequestStage::Opened => {
                bun_core::scoped_log!(fetch, "sendInitialRequestPayload");
                self.set_timeout(&socket);
                let result =
                    match self.send_initial_request_payload::<IS_FIRST_CALL, IS_SSL>(socket) {
                        Ok(r) => r,
                        Err(err) => {
                            self.close_and_fail::<IS_SSL>(err, socket);
                            return;
                        }
                    };
                let has_sent_headers = result.has_sent_headers;
                let has_sent_body = result.has_sent_body;
                let try_sending_more_data = result.try_sending_more_data;

                if has_sent_headers && has_sent_body {
                    // has_sent_body is only ever true for a Bytes body, so the whole request is out.
                    self.state.request_stage = if self.flags.proxy_tunneling {
                        RequestStage::ProxyHandshake
                    } else {
                        RequestStage::Done
                    };
                    return;
                }

                if has_sent_headers {
                    if self.flags.proxy_tunneling {
                        self.state.request_stage = RequestStage::ProxyHandshake;
                    } else {
                        self.state.request_stage = RequestStage::Body;
                        if self.flags.is_streaming_request_body {
                            // lets signal to start streaming the body
                            let ctx = self.get_ssl_ctx::<IS_SSL>();
                            self.progress_update::<IS_SSL>(ctx, socket);
                        }
                    }
                    debug_assert!(
                        // we should have leftover data OR we use sendfile/stream
                        (matches!(self.state.original_request_body, Body::Bytes(_))
                            && !self.request_body().is_empty())
                            || matches!(
                                self.state.original_request_body,
                                Body::Sendfile(_) | Body::Stream(_)
                            )
                    );

                    // we sent everything, but there's some body left over
                    if try_sending_more_data {
                        self.on_writable::<false, IS_SSL>(socket);
                    }
                } else {
                    self.state.request_stage = RequestStage::Headers;
                }
            }
            RequestStage::Body => {
                bun_core::scoped_log!(fetch, "send body");
                if !self.state.flags.receive_paused {
                    self.set_timeout(&socket);
                }

                match &mut self.state.original_request_body {
                    Body::Bytes(_) => {
                        let to_send = self.request_body();
                        if !to_send.is_empty() {
                            let sent = match write_to_socket::<IS_SSL>(socket, to_send) {
                                Ok(s) => s,
                                Err(err) => {
                                    self.close_and_fail::<IS_SSL>(err, socket);
                                    return;
                                }
                            };

                            self.state.request_sent_len += sent;
                            self.state.request_body =
                                bun_ptr::RawSlice::new(&self.state.request_body.slice()[sent..]);
                        }

                        if self.request_body().is_empty() {
                            self.state.request_stage = RequestStage::Done;
                            return;
                        }
                    }
                    Body::Stream(_) => {
                        // flush without adding any new data
                        self.flush_stream::<IS_SSL>(socket);
                    }
                    Body::Sendfile(sendfile) => {
                        if IS_SSL {
                            panic!(
                                "sendfile is only supported without SSL. This code should never have been reached!"
                            );
                        }

                        // sendfile.write() takes the raw fd, not the socket handle.
                        match sendfile.write(socket.fd()) {
                            #[cfg(not(windows))]
                            crate::send_file::Status::Done => {
                                self.state.request_stage = RequestStage::Done;
                                return;
                            }
                            #[cfg(not(windows))]
                            crate::send_file::Status::Err(err) => {
                                self.close_and_fail::<IS_SSL>(err, socket);
                                return;
                            }
                            crate::send_file::Status::Again => {
                                // mark_needs_more_for_sendfile is `const SSL=false`-only;
                                // this arm is unreachable for SSL (panic above).
                                uws::SocketTCP::from_any(socket.socket)
                                    .mark_needs_more_for_sendfile();
                            }
                        }
                    }
                }
            }
            RequestStage::ProxyBody => {
                bun_core::scoped_log!(fetch, "send proxy body");
                if let Some(proxy) = self.proxy_tunnel_ref() {
                    match &self.state.original_request_body {
                        Body::Bytes(_) => {
                            self.set_timeout(&socket);

                            let to_send = self.request_body();
                            // just wait and retry when onWritable! if closed internally proxy.onClose is queued
                            let Ok(sent) = proxy.write(to_send) else {
                                self.drain_tunnel_events();
                                return;
                            };

                            self.state.request_sent_len += sent;
                            self.state.request_body =
                                bun_ptr::RawSlice::new(&self.state.request_body.slice()[sent..]);

                            if self.request_body().is_empty() {
                                self.state.request_stage = RequestStage::Done;
                                return;
                            }
                        }
                        Body::Stream(_) => {
                            self.flush_stream::<IS_SSL>(socket);
                        }
                        Body::Sendfile(_) => {
                            panic!(
                                "sendfile is only supported without SSL. This code should never have been reached!"
                            );
                        }
                    }
                }
            }
            RequestStage::ProxyHeaders => {
                bun_core::scoped_log!(fetch, "send proxy headers");
                if let Some(proxy) = self.proxy_tunnel_ref() {
                    self.set_timeout(&socket);
                    // Proxy-tunnel writes can be partial across event-loop ticks
                    // — compress straight into the Vec.
                    if let Err(e) = self.compress_body_for_send(false) {
                        self.close_and_fail::<IS_SSL>(e, socket);
                        return;
                    }
                    let mut temporary_send_buffer: Vec<u8> = Vec::with_capacity(16 * 1024);
                    let writer = &mut temporary_send_buffer;

                    {
                        let thread = self.thread();
                        let mut request_headers_buf = thread.request_headers_buf.borrow_mut();
                        let header_count =
                            self.build_request(self.body_len_for_send(), &mut request_headers_buf);
                        let request = Self::built_request(
                            self.method,
                            &self.url,
                            &request_headers_buf[..header_count],
                        );
                        if let Err(e) = write_request(writer, &request) {
                            drop(request_headers_buf);
                            self.close_and_fail::<IS_SSL>(e, socket);
                            return;
                        }
                    }

                    let headers_len = temporary_send_buffer.len();
                    if !self.request_body().is_empty()
                        && temporary_send_buffer.capacity() - temporary_send_buffer.len() > 0
                    {
                        let spare = temporary_send_buffer.capacity() - temporary_send_buffer.len();
                        let wrote = spare.min(self.request_body().len());
                        debug_assert!(wrote > 0);
                        temporary_send_buffer.extend_from_slice(&self.request_body()[0..wrote]);
                    }

                    let to_send = &temporary_send_buffer[self.state.request_sent_len..];
                    // Same reasoning as send_initial_request_payload: the
                    // inner TLS handshake can complete from buffered bytes
                    // after the outer proxy socket is already gone (or
                    // proxy.on_writable above marked it dead). Writing into
                    // the tunnel would succeed at the SSL layer and buffer
                    // forever on a dead outer socket.
                    if socket.is_closed() || socket.is_shutdown() {
                        self.close_and_fail::<IS_SSL>(crate::Error::ConnectionClosed, socket);
                        return;
                    }
                    // just wait and retry when onWritable! if closed internally proxy.onClose is queued
                    let Ok(amount) = proxy.write(to_send) else {
                        self.drain_tunnel_events();
                        return;
                    };

                    if IS_FIRST_CALL {
                        if amount == 0 {
                            // don't worry about it
                            bun_core::scoped_log!(fetch, "is_first_call and amount == 0");
                            return;
                        }
                    }

                    self.state.request_sent_len += amount;
                    let has_sent_headers = self.state.request_sent_len >= headers_len;

                    if has_sent_headers && !self.request_body().is_empty() {
                        self.state.request_body = bun_ptr::RawSlice::new(
                            &self.state.request_body.slice()
                                [self.state.request_sent_len - headers_len..],
                        );
                    }

                    // Match send_initial_request_payload: a Stream/Sendfile
                    // body has an empty `request_body()` buffer at this
                    // point, which does not mean the body is sent.
                    let has_sent_body =
                        if matches!(self.state.original_request_body, Body::Bytes(_)) {
                            self.request_body().is_empty()
                        } else {
                            false
                        };

                    if has_sent_headers && has_sent_body {
                        self.state.request_stage = RequestStage::Done;
                        return;
                    }

                    if has_sent_headers {
                        self.state.request_stage = RequestStage::ProxyBody;
                        if self.flags.is_streaming_request_body {
                            // lets signal to start streaming the body
                            let ctx = self.get_ssl_ctx::<IS_SSL>();
                            self.progress_update::<IS_SSL>(ctx, socket);
                        }
                        debug_assert!(
                            // leftover bytes OR stream/sendfile (whose body
                            // buffer is empty here; the body flows via
                            // flush_stream in the ProxyBody arm)
                            (matches!(self.state.original_request_body, Body::Bytes(_))
                                && !self.request_body().is_empty())
                                || matches!(
                                    self.state.original_request_body,
                                    Body::Sendfile(_) | Body::Stream(_)
                                )
                        );

                        // we sent everything, but there's some body leftover
                        if amount == to_send.len() {
                            self.on_writable::<false, IS_SSL>(socket);
                        }
                    } else {
                        self.state.request_stage = RequestStage::ProxyHeaders;
                    }
                }
            }
            _ => {}
        }
    }

    /// The JS-side `checkServerIdentity` callback approved the peer
    /// certificate: clear the park flag and write the request that
    /// `on_writable` has been holding back since the handshake completed.
    pub(crate) fn resume_after_cert_check<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) {
        if !self.state.flags.is_waiting_for_cert_check {
            // Never parked, or already resumed/reset by a redirect or failure.
            return;
        }
        bun_core::scoped_log!(fetch, "resumeAfterCertCheck");
        self.state.flags.is_waiting_for_cert_check = false;
        self.on_writable::<true, IS_SSL>(socket);
    }

    pub(crate) fn close_and_fail<const IS_SSL: bool>(
        &mut self,
        err: crate::Error,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(fetch, "closeAndFail: {:?}", err);
        if cfg!(target_os = "macos") && self.state.original_request_body.len() > 0 {
            GenHttpContext::<IS_SSL>::fail_socket(socket);
        } else {
            GenHttpContext::<IS_SSL>::terminate_socket(socket);
        }
        self.fail(err);
    }

    fn start_proxy_handshake<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        start_payload: &[u8],
    ) {
        bun_core::scoped_log!(fetch, "startProxyHandshake");
        // if we have options we pass them (ca, reject_unauthorized, etc) otherwise use the default
        let ssl_options = if let Some(tls) = &self.tls_props {
            tls.get().clone()
        } else {
            crate::ssl_config::SSLConfig::ZERO
        };
        // The sole caller (`handle_on_data_headers`) has already moved
        // `response_message_buffer` into a local, so the CONNECT envelope is
        // gone from `self` and `start_payload` borrows that caller local (or
        // `incoming_data`), which outlives this call; the #30381 split-envelope
        // hazard is handled there. ProxyTunnel::start has synchronous failure
        // paths (SSLWrapper init error, or a handshake-traffic error that
        // reports a close) that call close_and_fail -> fail -> the result
        // callback, which finishes this request.
        debug_assert!(self.state.response_message_buffer.list.capacity() == 0);
        ProxyTunnel::start::<IS_SSL>(self, socket, &ssl_options, start_payload);
    }

    pub(crate) fn handle_on_data_headers<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: CtxRef<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(
            fetch,
            "handleOnDataHeader data: {}",
            BStr::new(incoming_data)
        );
        // Move the accumulation buffer out of `self` so `to_read` can be a
        // plain `&[u8]` borrow of either `incoming_data` or the local `buffer`,
        // both disjoint from `&mut self`. The short-read paths move it back;
        // every other path either drops it (terminal / reset) or lets it drop
        // here once `clone_metadata()` has deep-copied the parsed headers.
        let mut buffer = std::mem::take(&mut self.state.response_message_buffer);
        let needs_move = buffer.list.is_empty();
        let mut to_read: &[u8] = if needs_move {
            incoming_data
        } else {
            // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
            let _ = buffer.append_slice_exact(incoming_data);
            buffer.list.as_slice()
        };

        // Persist the unparsed tail for the next `on_data`. When `needs_move`,
        // `to_read` is a suffix of `incoming_data` and is copied into the
        // (currently empty) accumulation buffer; otherwise `to_read` is a suffix
        // of `buffer`, so the consumed prefix is drained and `buffer` is moved
        // back into state. Does not re-arm the idle timer (header phase is an
        // absolute deadline; see [`IDLE_TIMEOUT_SECONDS`]).
        macro_rules! short_read {
            () => {{
                bun_core::scoped_log!(fetch, "handleShortRead");
                if needs_move {
                    if !to_read.is_empty() {
                        // this one will probably be another chunk, so we leave a little extra room
                        let _ = self.state.response_message_buffer.append(to_read);
                    }
                } else {
                    let keep = to_read.len();
                    buffer
                        .list
                        .drain_front(buffer.list.len().saturating_sub(keep));
                    self.state.response_message_buffer = buffer;
                }
                return;
            }};
        }

        let thread = self.thread();
        let mut scratch_guard;
        let mut scratch_heap;
        let shared_resp: &mut [picohttp::Header] =
            match thread.response_headers_buf.try_borrow_mut() {
                Ok(guard) => {
                    scratch_guard = guard;
                    &mut scratch_guard[..]
                }
                // re-entered (a tunnelled response's headers arriving while the
                // CONNECT response is still being handled)
                Err(_) => {
                    scratch_heap = vec![picohttp::Header::ZERO; 256];
                    &mut scratch_heap[..]
                }
            };
        let mut response = loop {
            let mut amount_read: usize = 0;

            // minimal http/1.1 response is 16 bytes ("HTTP/1.1 200\r\n\r\n")
            // if less than 16 it will always be a ShortRead
            if to_read.len() < 16 {
                short_read!();
            }

            let parsed = match picohttp::Response::parse_parts(
                to_read,
                &mut shared_resp[..],
                Some(&mut amount_read),
            ) {
                Ok(r) => r,
                Err(picohttp::ParseResponseError::ShortRead) => {
                    // `MAX_HTTP_HEADER_SIZE` (default 16 KB) is the *server*/
                    // request-side knob (Node `--max-http-header-size`); reusing
                    // it here rejects legitimate responses with large
                    // `Location`/`Set-Cookie` headers. The intent is to bound
                    // `response_message_buffer` growth, so use a generous fixed
                    // cap independent of that knob.
                    const MAX_RESPONSE_HEADER_BUFFER: usize = 1024 * 1024;
                    if to_read.len() > MAX_RESPONSE_HEADER_BUFFER {
                        self.close_and_fail::<IS_SSL>(
                            crate::Error::ResponseHeadersTooLarge,
                            socket,
                        );
                        return;
                    }
                    short_read!();
                }
                Err(e) => {
                    self.close_and_fail::<IS_SSL>(e.into(), socket);
                    return;
                }
            };

            let bytes_read = parsed.bytes_read.min(to_read.len());
            to_read = &to_read[bytes_read..];

            if parsed.status_code == 101 {
                if self.flags.upgrade_state == HTTPUpgradeState::None
                    || (self.flags.proxy_tunneling && self.proxy_tunnel.is_none())
                {
                    // we cannot upgrade to websocket because the client did not request it!
                    self.close_and_fail::<IS_SSL>(crate::Error::UnrequestedUpgrade, socket);
                    return;
                }
                // special case for websocket upgrade
                self.flags.upgrade_state = HTTPUpgradeState::Upgraded;
                // start draining the request body
                self.flush_stream::<IS_SSL>(socket);
                break parsed;
            }

            // handle the case where we have a 100 Continue
            if parsed.status_code >= 100 && parsed.status_code < 200 {
                bun_core::scoped_log!(fetch, "information headers");

                if to_read.is_empty() {
                    if !needs_move {
                        buffer.list.clear();
                        self.state.response_message_buffer = buffer;
                    }
                    // we only received 1XX responses, we wanna wait for the next status code
                    return;
                }
                // the buffer could still contain more 1XX responses or other status codes, so we continue parsing
                continue;
            }

            break parsed;
        };
        let should_continue = match self.handle_response_metadata(&mut response) {
            Ok(s) => s,
            Err(err) => {
                self.close_and_fail::<IS_SSL>(err, socket);
                return;
            }
        };
        // Headers complete: start the body-idle window fresh (see [`IDLE_TIMEOUT_SECONDS`]).
        self.set_timeout(&socket);

        if (self.state.content_encoding_i as usize) < response.headers.list.len()
            && !self.state.flags.did_set_content_encoding
        {
            // if it compressed with this header, it is no longer because we will decompress it
            self.state.flags.did_set_content_encoding = true;
            self.state.content_encoding_i = u8::MAX;
        }

        if should_continue == ShouldContinue::Finished {
            if !to_read.is_empty() {
                self.state.flags.allow_keepalive = false;
            }
            if self.state.flags.is_redirect_pending {
                self.do_redirect::<IS_SSL>(ctx, socket);
                return;
            }
            // this means that the request ended
            // clone metadata and return the progress at this point
            self.clone_metadata(&response);
            // if is chuncked but no body is expected we mark the last chunk
            self.state.flags.received_last_chunk = true;
            // if is not we ignore the content_length
            self.state.content_length = Some(0);
            self.progress_update::<IS_SSL>(ctx, socket);
            return;
        }

        if self.flags.proxy_tunneling && self.proxy_tunnel.is_none() {
            // we are proxing we dont need to cloneMetadata yet
            self.start_proxy_handshake::<IS_SSL>(socket, to_read);
            return;
        }

        // we have body data incoming so we clone metadata and keep going
        self.clone_metadata(&response);

        if to_read.is_empty() {
            // no body data yet, but we can report the headers
            if self.signals.get(signals::Field::HeaderProgress) {
                self.progress_update::<IS_SSL>(ctx, socket);
            }
            return;
        }

        if self.state.response_stage == ResponseStage::Body {
            let report_progress = match self.handle_response_body(to_read, true) {
                Ok(b) => b,
                Err(err) => {
                    self.close_and_fail::<IS_SSL>(err, socket);
                    return;
                }
            };

            if report_progress {
                self.progress_update::<IS_SSL>(ctx, socket);
                return;
            }
        } else if self.state.response_stage == ResponseStage::BodyChunk {
            let report_progress = match self.handle_response_body_chunked_encoding(to_read) {
                Ok(b) => b,
                Err(err) => {
                    self.close_and_fail::<IS_SSL>(err, socket);
                    return;
                }
            };

            if report_progress {
                self.progress_update::<IS_SSL>(ctx, socket);
                return;
            }
        }

        // if not reported we report partially now
        if self.signals.get(signals::Field::HeaderProgress) {
            self.progress_update::<IS_SSL>(ctx, socket);
            return;
        }
    }

    pub(crate) fn on_data<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: CtxRef<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(fetch, "onData {}", incoming_data.len());
        if self.signals.get(signals::Field::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return;
        }

        if let Some(proxy) = self.proxy_tunnel_this() {
            // Body phase only, mirroring the non-proxy dispatch below (header
            // phase is an absolute deadline; see [`IDLE_TIMEOUT_SECONDS`]).
            debug_assert!(!self.state.flags.receive_paused); // maybe_pause_receive bails on proxy_tunnel
            if matches!(
                self.state.response_stage,
                ResponseStage::Body | ResponseStage::BodyChunk
            ) {
                self.set_timeout(&socket);
            }
            ProxyTunnel::receive(proxy, incoming_data);
            self.drain_tunnel_events();
            return;
        }

        // While parked waiting for the JS `checkServerIdentity` verdict, no
        // request has been written, so any data is unexpected. Must stay below
        // the proxy_tunnel dispatch above: a tunneled target's raw inner-TLS
        // records must keep reaching the SSLWrapper while parked.
        if self.state.flags.is_waiting_for_cert_check {
            self.close_and_fail::<IS_SSL>(crate::Error::UnexpectedData, socket);
            return;
        }

        match self.state.response_stage {
            ResponseStage::Pending | ResponseStage::Headers => {
                self.handle_on_data_headers::<IS_SSL>(incoming_data, ctx, socket);
            }
            ResponseStage::Body => {
                if !self.state.flags.receive_paused {
                    self.set_timeout(&socket);
                }

                let report_progress = match self.handle_response_body(incoming_data, false) {
                    Ok(b) => b,
                    Err(err) => {
                        self.close_and_fail::<IS_SSL>(err, socket);
                        return;
                    }
                };

                if report_progress {
                    self.progress_update::<IS_SSL>(ctx, socket);
                    return;
                }
            }
            ResponseStage::BodyChunk => {
                if !self.state.flags.receive_paused {
                    self.set_timeout(&socket);
                }

                let report_progress =
                    match self.handle_response_body_chunked_encoding(incoming_data) {
                        Ok(b) => b,
                        Err(err) => {
                            self.close_and_fail::<IS_SSL>(err, socket);
                            return;
                        }
                    };

                if report_progress {
                    self.progress_update::<IS_SSL>(ctx, socket);
                    return;
                }
            }
            ResponseStage::Fail => {}
            _ => {
                self.close_and_fail::<IS_SSL>(crate::Error::UnexpectedData, socket);
                return;
            }
        }
    }

    pub(crate) fn close_and_abort<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        self.close_and_fail::<IS_SSL>(crate::Error::Aborted, socket);
    }

    fn complete_connecting_process(&mut self) {
        if self
            .flags
            .defer_terminal_dispatch_until_connecting_is_complete
        {
            self.flags
                .defer_terminal_dispatch_until_connecting_is_complete = false;
            if self.state.stage == Stage::Fail {
                self.dispatch_result_and_reset(true);
            } else if self.flags.is_preconnect_only && self.state.stage == Stage::Done {
                // Deferred preconnect success (see `on_preconnect`).
                self.dispatch_preconnect_result();
            }
        }
    }

    /// The leader of a coalesced cold connect has learned the ALPN outcome (or
    /// failed). Dispatch every waiter accordingly.
    fn resolve_pending_h2(&mut self, resolution: PendingH2Resolution) {
        let Some(pc_ptr) = self.pending_h2.take() else {
            return;
        };
        // `pc_ptr` is a backref into the context's `pending_h2_connects` Vec,
        // set in `HTTPContext::connect`; `take_pending_h2` swaps the owning
        // Box out so we can iterate and drop it here.
        let Some(pc) = self.get_ssl_ctx::<true>().take_pending_h2(&pc_ptr) else {
            return;
        };
        // pc drops at scope exit (was `defer pc.deinit()`)

        let waiters = core::mem::take(&mut *pc.waiters.borrow_mut());
        for waiter_req in waiters {
            let mut waiter = waiter_req.client();
            let waiter = &mut *waiter;
            if waiter.signals.get(signals::Field::Aborted) {
                waiter.fail(crate::Error::Aborted);
                continue;
            }
            match resolution {
                PendingH2Resolution::H2(session) => h2::ClientSession::enqueue(session, waiter),
                PendingH2Resolution::H1 => {
                    // ALPN selected http/1.1 on the leader's handshake; an
                    // h2-pinned waiter would just open a fresh TLS connection
                    // and fail the same way, so fail it here instead of burning
                    // another handshake.
                    if waiter.flags.forced_protocol == Some(Protocol::Http2) {
                        waiter.fail(crate::Error::HTTP2Unsupported);
                        continue;
                    }
                    // Pin to h1 so this `start_` doesn't register a fresh
                    // PendingConnect that the rest of this loop would re-coalesce
                    // onto (which would serialise N cold fetches into N
                    // sequential handshakes). The origin already chose h1 once.
                    waiter.flags.forced_protocol = Some(Protocol::Http1_1);
                    waiter.start_::<true>();
                }
                // The first waiter becomes the new leader; the rest re-coalesce
                // onto it via the normal PendingConnect path.
                PendingH2Resolution::LeaderFailed => waiter.start_::<true>(),
            }
        }
    }

    fn fail(&mut self, err: crate::Error) {
        self.unregister_abort_tracker();
        self.resolve_pending_h2(PendingH2Resolution::LeaderFailed);

        self.close_proxy_tunnel(true);
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            self.state.request_stage = RequestStage::Fail;
            self.state.response_stage = ResponseStage::Fail;
            self.state.fail = Some(err);
            self.state.stage = Stage::Fail;

            if !self
                .flags
                .defer_terminal_dispatch_until_connecting_is_complete
            {
                self.dispatch_result_and_reset(true);
            }
        }
    }

    /// Deep-copy `response` (headers, status, and this request's `url.href`)
    /// into owned storage on `state.cloned_metadata` so the caller can drop the
    /// buffer the parsed slices borrow.
    pub(crate) fn clone_metadata(&mut self, response: &picohttp::Response<'_>) {
        self.state.cloned_metadata = None;
        let mut builder = picohttp::StringBuilder::default();
        response.count(&mut builder);
        builder.count(self.url.href());
        let _ = builder.allocate();
        // Every cloned slice (header names/values, status, href) points into
        // `builder`'s single allocation, which becomes `owned_buf` below.
        let mut headers =
            vec![picohttp::Header::ZERO; response.headers.list.len()].into_boxed_slice();
        let (status, status_code, minor_version) = {
            let cloned = response.clone(&mut headers, &mut builder);
            (
                bun_ptr::RawSlice::new(cloned.status),
                cloned.status_code,
                cloned.minor_version,
            )
        };
        let href = bun_ptr::RawSlice::new(builder.append(self.url.href()));
        // Transfer the single backing allocation out of the builder
        // (`builder.ptr.?[0..builder.cap]`) so its Drop becomes a no-op.
        let owned_buf = builder.move_to_slice();
        self.state.cloned_metadata = Some(HTTPResponseMetadata {
            _owned_buf: owned_buf,
            headers,
            status,
            status_code,
            minor_version,
            url: href,
        });
    }

    /// The idle timeout to arm for this request, in seconds (0 = disabled):
    /// the per-request `fetch({ timeout })` override when present, otherwise
    /// the global `BUN_CONFIG_HTTP_IDLE_TIMEOUT` default. Both are already
    /// normalised (see [`normalize_idle_timeout_seconds`]).
    #[inline]
    pub(crate) fn effective_idle_timeout_seconds(&self) -> c_uint {
        if self.flags.disable_timeout {
            return 0;
        }
        self.idle_timeout_seconds
            .unwrap_or_else(idle_timeout_seconds)
    }

    pub(crate) fn set_timeout<S: SocketTimeout>(&self, socket: &S) {
        // Values are pre-normalised (global: `HTTPThread::on_start`;
        // per-request: `AsyncHTTP::init`) so this is a plain pass-through.
        // `socket.set_timeout` picks the short-tick timer for values ≤ 240s
        // and the minute-granularity long timer above that.
        socket.set_timeout(self.effective_idle_timeout_seconds());
    }

    fn maybe_pause_receive<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if self.state.flags.receive_paused
            || self.proxy_tunnel.is_some()
            || self.flags.upgrade_state == HTTPUpgradeState::Upgraded
            || !self.signals.is_receive_paused()
            || socket.is_closed_or_has_error()
        {
            return;
        }
        self.state.flags.receive_paused = true;
        socket.set_timeout(0);
        let _ = socket.pause_stream();
        bun_core::scoped_log!(fetch, "pause receive {}", self.async_http_id);
    }

    pub(crate) fn resume_receive<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if !self.state.flags.receive_paused || self.signals.is_receive_paused() {
            return;
        }
        self.state.flags.receive_paused = false;
        if socket.is_closed() {
            return;
        }
        // A FIN/RST/error that landed while the read poll was paused is only
        // observable through the poll. Re-arm even when the socket already has
        // an error or shutdown latched so the regular readable/EOF/error
        // dispatch surfaces it; bailing here would strand the request with its
        // timeout disabled and the body promise pending forever.
        let _ = socket.resume_stream();
        bun_core::scoped_log!(fetch, "resume receive {}", self.async_http_id);
        self.set_timeout(&socket);
    }

    pub(crate) fn drain_response_body<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        // Find out if we should not send any update.
        match self.state.stage {
            Stage::Done | Stage::Fail => return,
            _ => {}
        }

        if self.state.fail.is_some() {
            // If there's any error at all, do not drain.
            return;
        }

        // If there's a pending redirect, then don't bother to send a response body
        // as that wouldn't make sense and I want to defensively avoid edgecases
        // from that.
        if self.state.flags.is_redirect_pending {
            return;
        }

        if self.state.decoded_body.list.is_empty() {
            // No update! Don't do anything.
            return;
        }

        let ctx = self.get_ssl_ctx::<IS_SSL>();
        self.send_progress_update_without_stage_check::<IS_SSL>(ctx, socket);
    }

    fn send_progress_update_without_stage_check<const IS_SSL: bool>(
        &mut self,
        ctx: CtxRef<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.send_progress_update_multiplexed();
        }
        let req = self.req();

        let mut result = self.to_result();
        let has_more = result.has_more;
        let is_done = !has_more;

        bun_core::scoped_log!(fetch, "progressUpdate {}", is_done);

        if is_done {
            self.unregister_abort_tracker();
            // is_done is response-driven. A server can reply early (HTTP 413)
            // with keep-alive while request_stage is still .proxy_body or the
            // tunnel still has buffered encrypted writes. Pooling that tunnel
            // would leave the connection mid-request on the inner TLS stream;
            // adopt() resetting write_buffer doesn't restore a clean HTTP/1.1
            // boundary. Only pool a tunnel whose request side is fully drained.
            //
            // Also check wrapper liveness: a close-delimited body (no
            // Content-Length, no Transfer-Encoding — RFC 7230 §3.3.3 rule 7)
            // ends on inner-TLS close; ProxyTunnel.onClose fires but the outer
            // socket is still alive. Pooling that dead wrapper would hang the
            // next request (proxy.write() → error.ConnectionClosed, swallowed).
            let tunnel_poolable = if let Some(t) = self.proxy_tunnel.as_deref() {
                t.is_poolable()
            } else {
                true
            };

            // The uSockets paused bit survives `state.reset()`; never hand a
            // paused socket back to the pool.
            if core::mem::take(&mut self.state.flags.receive_paused)
                && !socket.is_closed_or_has_error()
            {
                let _ = socket.resume_stream();
            }

            if self.is_request_fully_sent()
                && self.is_keep_alive_possible()
                && !socket.is_closed_or_has_error()
                && tunnel_poolable
            {
                bun_core::scoped_log!(fetch, "release socket");
                // Hand the client's strong ref straight to the pool: `release_socket`
                // either stores this `RefPtr` in the parked `PooledSocket` or
                // dereffs it if pooling fails.
                let tunnel = self.proxy_tunnel.take();
                if let Some(t) = &tunnel {
                    t.detach_owner(&*self);
                }
                let had_tunnel = tunnel.is_some();
                // target_hostname = url.hostname (the CONNECT TCP target at
                // writeProxyConnect line 346). The SNI override (hostname) is
                // hashed into proxyAuthHash separately — both must match, but
                // they're distinct values when a Host header override is set.
                ctx.release_socket(
                    socket,
                    self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
                    self.flags.reject_unauthorized,
                    &self.connected_hostname,
                    self.connected_port,
                    self.tls_props.as_ref(),
                    tunnel,
                    if had_tunnel { self.url.hostname() } else { b"" },
                    if had_tunnel {
                        self.url.get_port_auto()
                    } else {
                        0
                    },
                    if had_tunnel || (IS_SSL && self.http_proxy.is_none()) {
                        // Direct TLS: the handshake verified the peer against
                        // the Host-header override (get_tls_hostname), so the
                        // override hash must be part of the pool key. Matches
                        // the lookup in HTTPContext::connect.
                        self.proxy_auth_hash()
                    } else {
                        0
                    },
                    None,
                );
            } else {
                if self.proxy_tunnel.is_some() {
                    bun_core::scoped_log!(fetch, "close the tunnel");
                    self.close_proxy_tunnel(true);
                }
                GenHttpContext::<IS_SSL>::close_socket(socket);
            }

            self.state.reset();
            self.state.response_stage = ResponseStage::Done;
            self.state.request_stage = RequestStage::Done;
            self.state.stage = Stage::Done;
            self.flags.proxy_tunneling = false;
            bun_core::scoped_log!(fetch, "done");
        }

        // Move the body bytes out of `self.state` before delivering: the
        // terminal result retires this request.
        let mut decoded_body = core::mem::take(&mut self.state.decoded_body);
        if has_more {
            result.body = decoded_body.list.as_slice();
            req.deliver(result);
            if decoded_body.list.capacity() <= DECODED_BODY_RETAIN_CAP {
                decoded_body.list.clear();
                self.state.decoded_body = decoded_body;
            }
            self.maybe_pause_receive(socket);
        } else {
            result.body_owned = decoded_body.list;
            req.deliver(result);
        }
    }

    /// `send_progress_update_without_stage_check` minus the per-request TCP socket
    /// release/close. Used by HTTP/2 and HTTP/3, whose session owns the
    /// transport, so there is no `ctx`/`socket` to hand back to the pool here.
    fn send_progress_update_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        let req = self.req();

        let mut result = self.to_result();
        let is_done = !result.has_more;
        bun_core::scoped_log!(fetch, "progressUpdate {}", is_done);
        if is_done {
            self.unregister_abort_tracker();
            self.state.reset();
            self.state.response_stage = ResponseStage::Done;
            self.state.request_stage = RequestStage::Done;
            self.state.stage = Stage::Done;
            self.flags.proxy_tunneling = false;
        }
        // See `send_progress_update_without_stage_check`: move the body out of
        // `self.state` before the terminal delivery.
        let mut decoded_body = core::mem::take(&mut self.state.decoded_body);
        if is_done {
            result.body_owned = decoded_body.list;
            req.deliver(result);
            return;
        }
        result.body = decoded_body.list.as_slice();
        req.deliver(result);
        if decoded_body.list.capacity() <= DECODED_BODY_RETAIN_CAP {
            decoded_body.list.clear();
            self.state.decoded_body = decoded_body;
        }
    }

    /// `do_redirect` minus the per-request socket release/close. The session
    /// detached the stream before calling this; `start()` re-enters the normal
    /// connect path for the redirect target.
    fn do_redirect_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        bun_core::scoped_log!(fetch, "doRedirectMultiplexed");
        // See `do_redirect`: the cross-origin redirect must drop the
        // per-request Host override before the follow-up connection derives
        // its SNI / certificate-verification hostname. The h2/h3 path never
        // reaches `do_redirect`'s consume-and-clear, so mirror it here before
        // `state.reset()` discards the flag.
        if self.state.flags.clear_hostname_on_redirect {
            self.state.flags.clear_hostname_on_redirect = false;
            self.hostname = None;
        }
        if matches!(self.state.original_request_body, Body::Stream(_)) {
            self.flags.is_streaming_request_body = false;
        }
        self.unix_socket_path = ZigStringSlice::EMPTY;
        let request_body = if self.state.flags.resend_request_body_on_redirect
            && matches!(self.state.original_request_body, Body::Bytes(_))
        {
            match &self.state.original_request_body {
                Body::Bytes(b) => Body::Bytes(*b),
                _ => unreachable!(),
            }
        } else {
            Body::EMPTY
        };
        self.state.response_message_buffer = MutableString::default();
        self.remaining_redirect_count = self.remaining_redirect_count.saturating_sub(1);
        self.flags.redirected = true;
        debug_assert!(self.redirect_type == FetchRedirect::Follow);
        self.unregister_abort_tracker();
        self.connected_hostname.clear();
        if self.remaining_redirect_count == 0 {
            self.fail(crate::Error::TooManyRedirects);
            return;
        }
        self.state.reset();
        self.flags.proxy_tunneling = false;
        self.flags.protocol = Protocol::Http1_1;
        self.reevaluate_proxy_for_redirect();
        self.start(request_body);
    }

    pub(crate) fn progress_update_h3(&mut self) {
        debug_assert!(self.flags.protocol == Protocol::Http3);
        if self.state.stage == Stage::Done || self.state.stage == Stage::Fail {
            return;
        }
        if self.state.flags.is_redirect_pending && self.state.fail.is_none() {
            if self.state.is_done() {
                self.do_redirect_multiplexed();
            }
            return;
        }
        self.send_progress_update_multiplexed();
    }

    pub(crate) fn do_redirect_h3(&mut self) {
        debug_assert!(self.flags.protocol == Protocol::Http3);
        self.do_redirect_multiplexed();
    }

    pub(crate) fn progress_update<const IS_SSL: bool>(
        &mut self,
        ctx: CtxRef<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            if self.state.flags.is_redirect_pending && self.state.fail.is_none() {
                if self.state.is_done() {
                    self.do_redirect::<IS_SSL>(ctx, socket);
                }
                return;
            }

            self.send_progress_update_without_stage_check::<IS_SSL>(ctx, socket);
        }
    }

    pub(crate) fn on_preconnect<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        bun_core::scoped_log!(fetch, "onPreconnect({})", BStr::new(self.url.href()));
        self.unregister_abort_tracker();
        let ctx = self.get_ssl_ctx::<IS_SSL>();
        ctx.release_socket(
            socket,
            self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
            self.flags.reject_unauthorized,
            self.url.hostname(),
            self.url.get_port_auto(),
            self.tls_props.as_ref(),
            None,
            b"",
            0,
            0,
            None,
        );

        self.state.reset();
        self.state.response_stage = ResponseStage::Done;
        self.state.request_stage = RequestStage::Done;
        self.state.stage = Stage::Done;
        self.flags.proxy_tunneling = false;
        // True when pooled-socket reuse reached here synchronously inside
        // `start_`/`connect`; `complete_connecting_process` dispatches then.
        if self
            .flags
            .defer_terminal_dispatch_until_connecting_is_complete
        {
            return;
        }
        self.dispatch_preconnect_result();
    }

    /// Terminal result for a preconnect-only request; retires the request.
    fn dispatch_preconnect_result(&mut self) {
        self.req().deliver(HTTPClientResult {
            fail: None,
            metadata: None,
            has_more: false,
            ..Default::default()
        });
    }

    /// Build the result payload for the progress/completion callback.
    ///
    /// `body` is left `&[]`: every caller attaches it from
    /// `state.decoded_body` *after* the `state.reset()` that follows this
    /// call. With `body` empty the result has no borrow into `self`, so it
    /// can be held across the caller's `&mut self` mutations.
    pub(crate) fn to_result(&mut self) -> HTTPClientResult<'static> {
        let body_size: BodySize = if self.state.is_chunked_encoding() {
            BodySize::TotalReceived(self.state.total_body_received)
        } else if let Some(content_length) = self.state.content_length {
            BodySize::ContentLength(content_length)
        } else {
            BodySize::Unknown
        };

        // A followed redirect's intermediate head was only cloned to drive
        // do_redirect(); on failure it must not surface as the final Response.
        if self.state.flags.is_redirect_pending && self.state.fail.is_some() {
            self.state.cloned_metadata = None;
        }

        let certificate_info = self.state.certificate_info.take();
        if certificate_info.is_none() {
            if let Some(metadata) = self.state.cloned_metadata.take() {
                // transfer ownership of the metadata here
                return HTTPClientResult {
                    metadata: Some(metadata),
                    body: &[],
                    body_owned: Vec::new(),
                    redirected: self.flags.redirected,
                    fail: self.state.fail,
                    dns_error: self.state.dns_error,
                    dns_hostname: self.state.dns_hostname.take(),
                    has_more: self.state.fail.is_none() && !self.state.is_done(),
                    body_size,
                    certificate_info: None,
                    can_stream: (self.state.request_stage == RequestStage::Body
                        || self.state.request_stage == RequestStage::ProxyBody)
                        && self.flags.is_streaming_request_body,
                    is_http2: self.flags.protocol != Protocol::Http1_1,
                    elapsed: 0,
                };
            }
        }
        HTTPClientResult {
            elapsed: 0,
            body: &[],
            body_owned: Vec::new(),
            metadata: None,
            redirected: self.flags.redirected,
            fail: self.state.fail,
            dns_error: self.state.dns_error,
            dns_hostname: self.state.dns_hostname.take(),
            // check if we are reporting cert errors, do not have a fail state and we are not done
            has_more: certificate_info.is_some()
                || (self.state.fail.is_none() && !self.state.is_done()),
            body_size,
            certificate_info,
            // we can stream the request_body at this stage
            can_stream: (self.state.request_stage == RequestStage::Body
                || self.state.request_stage == RequestStage::ProxyBody)
                && self.flags.is_streaming_request_body,
            is_http2: self.flags.protocol != Protocol::Http1_1,
        }
    }

    pub(crate) fn handle_response_body(
        &mut self,
        incoming_data: &[u8],
        is_only_buffer: bool,
    ) -> crate::Result<bool> {
        debug_assert!(self.state.transfer_encoding == Encoding::Identity);
        let content_length = self.state.content_length;
        if let Some(len) = content_length
            && incoming_data.len() > len.saturating_sub(self.state.total_body_received)
        {
            self.state.flags.allow_keepalive = false;
        }
        // is it exactly as much as we need?
        if is_only_buffer
            && let Some(len) = content_length
            && incoming_data.len() >= len
        {
            self.handle_response_body_from_single_packet(&incoming_data[0..len])?;
            Ok(true)
        } else {
            self.handle_response_body_from_multiple_packets(incoming_data)
        }
    }

    fn handle_response_body_from_single_packet(
        &mut self,
        incoming_data: &[u8],
    ) -> crate::Result<()> {
        if !self.state.is_chunked_encoding() {
            self.state.total_body_received += incoming_data.len();
            bun_core::scoped_log!(
                fetch,
                "handleResponseBodyFromSinglePacket {}",
                self.state.total_body_received
            );
        }
        // we can ignore the body data in redirects
        if !self.state.flags.is_redirect_pending {
            if self.state.encoding.is_compressed() {
                self.state.decompress_bytes(incoming_data, true)?;
            } else {
                self.state
                    .get_body_buffer()
                    .append_slice_exact(incoming_data)?;
            }
        }

        self.report_progress(incoming_data.len());
        Ok(())
    }

    fn handle_response_body_from_multiple_packets(
        &mut self,
        incoming_data: &[u8],
    ) -> crate::Result<bool> {
        // reshaped for borrowck — get_body_buffer() may return
        // `&mut self.state.compressed_body`, so its borrow must be scoped
        // tightly and not held across other `self.state.*` accesses (would be
        // aliased `&mut`). Read the Copy fields first, then borrow the buffer
        // only for the write block.
        let content_length = self.state.content_length;

        let remainder: &[u8] = if let Some(cl) = content_length {
            let remaining_content_length = cl.saturating_sub(self.state.total_body_received);
            &incoming_data[0..incoming_data.len().min(remaining_content_length)]
        } else {
            incoming_data
        };

        // we can ignore the body data in redirects
        if !self.state.flags.is_redirect_pending {
            let buffer = self.state.get_body_buffer();
            if buffer.list.is_empty() && incoming_data.len() < PREALLOCATE_MAX {
                let _ = buffer.list.try_reserve_exact(incoming_data.len());
            }

            let _ = buffer.write(remainder)?;
        }

        self.state.total_body_received += remainder.len();
        bun_core::scoped_log!(
            fetch,
            "handleResponseBodyFromMultiplePackets {}",
            self.state.total_body_received
        );
        let total_received = self.state.total_body_received;
        self.report_progress(total_received);

        // done or streaming
        let is_done =
            content_length.is_some() && self.state.total_body_received >= content_length.unwrap();
        let is_streaming = self.signals.get(signals::Field::ResponseBodyStreaming)
            || self.signals.body_receive_mode.is_some();
        if is_done || is_streaming || content_length.is_none() {
            let is_final_chunk = is_done;
            // Move the body buffer's bytes out — process_body_buffer takes `&mut self.state`
            // and may mutate `compressed_body` (via decompress_bytes' reset) or `decoded_body`,
            // so any `&` into `self.state` held across the call would be aliased UB.
            let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
            let processed = self
                .state
                .process_body_buffer(buffer_snap, is_final_chunk)?;

            // We can only use the libdeflate fast path when we are not streaming
            // If we ever call processBodyBuffer again, it cannot go through the fast path.
            self.state.flags.is_libdeflate_fast_path_disabled = true;

            let total_received = self.state.total_body_received;
            self.report_progress(total_received);
            // Close-delimited bodies still need per-packet decompression, but
            // a non-streaming consumer must not see per-packet progress: the
            // terminal callback (on close) is the first to carry metadata.
            return Ok(is_done || (processed && is_streaming));
        }
        Ok(false)
    }

    pub(crate) fn handle_response_body_chunked_encoding(
        &mut self,
        incoming_data: &[u8],
    ) -> crate::Result<bool> {
        let small_len = 16 * 1024usize;
        if incoming_data.len() <= small_len && self.state.get_body_buffer().list.is_empty() {
            self.handle_response_body_chunked_encoding_from_single_packet(incoming_data)
        } else {
            self.handle_response_body_chunked_encoding_from_multiple_packets(incoming_data)
        }
    }

    fn handle_response_body_chunked_encoding_from_multiple_packets(
        &mut self,
        incoming_data: &[u8],
    ) -> crate::Result<bool> {
        // reshaped for borrowck — `chunked_decoder` and the body
        // buffer (`compressed_body` / `decoded_body`) are disjoint fields of
        // `self.state`, so borrow them once together via the split accessor and
        // operate on safe references. Deep-cloning the buffer here would
        // diverge (mutations from process_body_buffer would be lost).
        let (decoder, body_buf) = self.state.chunked_decoder_and_body_buffer();
        body_buf.append_slice(incoming_data)?;

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        decoder.consume_trailer = 1;

        // decode the just-appended tail in place
        let tail_start = body_buf.list.len().saturating_sub(incoming_data.len());
        let decoded = picohttp::decode_chunked(decoder, &mut body_buf.list[tail_start..]);
        let (pret, bytes_decoded): (isize, usize) = match decoded {
            picohttp::ChunkedDecode::Invalid(n) => (-1, n),
            picohttp::ChunkedDecode::Incomplete(n) => (-2, n),
            picohttp::ChunkedDecode::Done(n) => (0, n),
        };
        let new_len = body_buf
            .list
            .len()
            .saturating_sub(incoming_data.len() - bytes_decoded);
        body_buf.list.truncate(new_len);
        let buffer_len = body_buf.list.len();
        self.state.total_body_received += bytes_decoded;
        bun_core::scoped_log!(
            fetch,
            "handleResponseBodyChunkedEncodingFromMultiplePackets {}",
            self.state.total_body_received
        );

        match pret {
            // Invalid HTTP response body
            -1 => return Err(crate::Error::InvalidHTTPResponse),
            // Needs more data
            -2 => {
                self.report_progress(buffer_len);
                // streaming chunks
                if self.signals.get(signals::Field::ResponseBodyStreaming)
                    || self.signals.body_receive_mode.is_some()
                {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;
                    // Move the
                    // bytes out so no `&` into self.state aliases the `&mut self.state` call.
                    let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
                    return self.state.process_body_buffer(buffer_snap, false);
                }

                return Ok(false);
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                // Move the
                // bytes out so no `&` into self.state aliases the `&mut self.state` call.
                let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
                let _ = self.state.process_body_buffer(buffer_snap, true)?;

                self.report_progress(buffer_len);

                return Ok(true);
            }
        }
    }

    fn handle_response_body_chunked_encoding_from_single_packet(
        &mut self,
        incoming_data: &[u8],
    ) -> crate::Result<bool> {
        let thread = self.thread();
        let mut small = thread.single_packet_buf.borrow_mut();
        debug_assert!(incoming_data.len() <= small.len());

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        self.state.chunked_decoder.consume_trailer = 1;

        // `handle_on_data_headers` moves `response_message_buffer` into a
        // local before dispatching here, so `incoming_data` never aliases
        // `self` and the scratch copy is always sufficient (the dispatcher
        // bounds `incoming_data.len()` to the scratch size).
        let in_len = incoming_data.len();
        let buffer = &mut small[0..in_len];
        buffer.copy_from_slice(incoming_data);

        // decodes in place
        let decoded = picohttp::decode_chunked(&mut self.state.chunked_decoder, buffer);
        let (pret, bytes_decoded): (isize, usize) = match decoded {
            picohttp::ChunkedDecode::Invalid(n) => (-1, n),
            picohttp::ChunkedDecode::Incomplete(n) => (-2, n),
            picohttp::ChunkedDecode::Done(n) => (0, n),
        };
        let new_len = buffer.len().saturating_sub(in_len - bytes_decoded);

        let buffer = &mut buffer[..new_len];
        self.state.total_body_received += bytes_decoded;
        bun_core::scoped_log!(
            fetch,
            "handleResponseBodyChunkedEncodingFromSinglePacket {}",
            self.state.total_body_received
        );
        match pret {
            // Invalid HTTP response body
            -1 => Err(crate::Error::InvalidHTTPResponse),
            // Needs more data
            -2 => {
                self.report_progress(buffer.len());
                self.state.get_body_buffer().append_slice_exact(buffer)?;

                // streaming chunks
                if self.signals.get(signals::Field::ResponseBodyStreaming)
                    || self.signals.body_receive_mode.is_some()
                {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;

                    // Move
                    // the bytes out so no `&` into self.state aliases the `&mut self.state`
                    // taken by process_body_buffer (which mutates compressed_body/decoded_body).
                    let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
                    return self.state.process_body_buffer(buffer_snap, false);
                }

                Ok(false)
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                self.handle_response_body_from_single_packet(buffer)?;
                debug_assert!(self.state.decoded_body.list.as_ptr() != buffer.as_ptr());
                self.report_progress(buffer.len());

                Ok(true)
            }
        }
    }

    pub(crate) fn handle_response_metadata(
        &mut self,
        response: &mut picohttp::Response,
    ) -> crate::Result<ShouldContinue> {
        let mut location: &[u8] = b"";
        let mut pretend_304 = false;
        let mut is_server_sent_events = false;
        let mut content_codings: u32 = 0;
        let mut has_keep_alive_token = false;
        for (header_i, header) in response.headers.list.iter().enumerate() {
            match hash_header_name(header.name()) {
                h if h == hash_header_const(b"Content-Length") => {
                    // RFC 9110 section 9.3.6: a client MUST ignore
                    // Content-Length in a successful response to CONNECT —
                    // the connection becomes an opaque tunnel and is never
                    // pooled, so the framing-desync concern below does not
                    // apply.
                    if self.flags.proxy_tunneling
                        && self.proxy_tunnel.is_none()
                        && response.status_code == 200
                    {
                        continue;
                    }
                    // byte-level parse — header.value() is network bytes, not &str
                    //
                    // RFC 9112 section 6.3: an invalid or conflicting
                    // Content-Length is an unrecoverable framing error —
                    // falling back to 0 would release a desynchronized socket
                    // into the keep-alive pool.
                    let value = header.value();
                    if value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
                        return Err(crate::Error::InvalidContentLength);
                    }
                    let Ok(content_length) = bun_core::parse_unsigned::<usize>(value, 10) else {
                        return Err(crate::Error::InvalidContentLength);
                    };
                    if self.method.has_body() {
                        if self
                            .state
                            .content_length
                            .is_some_and(|prev| prev != content_length)
                        {
                            return Err(crate::Error::InvalidContentLength);
                        }
                        self.state.content_length = Some(content_length);
                    } else {
                        // ignore body size for HEAD requests
                        self.state.content_length = Some(0);
                    }
                }
                h if h == hash_header_const(b"Content-Type") => {
                    if strings::index_of(header.value(), b"text/event-stream").is_some() {
                        is_server_sent_events = true;
                    }
                }
                h if h == hash_header_const(b"Content-Encoding") => {
                    if !self.flags.disable_decompression {
                        for token in HeaderValueIterator::init(header.value()) {
                            match Encoding::from_token(token) {
                                Some(Encoding::Identity) => {}
                                Some(coding) if coding.is_compressed() && content_codings == 0 => {
                                    self.state.encoding = coding;
                                    self.state.content_encoding_i = header_i as u8;
                                    content_codings = 1;
                                }
                                // Stacked or unknown codings: we can only strip one layer, so pass through raw.
                                _ => {
                                    self.state.encoding = Encoding::Identity;
                                    self.state.content_encoding_i = u8::MAX;
                                    content_codings = u32::MAX;
                                }
                            }
                        }
                    }
                }
                h if h == hash_header_const(b"Transfer-Encoding") => {
                    // RFC 9110 section 9.3.6: as with Content-Length above, a
                    // client MUST ignore Transfer-Encoding in a successful
                    // response to CONNECT.
                    if self.flags.proxy_tunneling
                        && self.proxy_tunnel.is_none()
                        && response.status_code == 200
                    {
                        continue;
                    }
                    // RFC 9112 §6.1: `chunked`, if present, must be the final coding.
                    for token in HeaderValueIterator::init(header.value()) {
                        if self.state.transfer_encoding == Encoding::Chunked {
                            return Err(crate::Error::UnsupportedTransferEncoding);
                        }
                        match Encoding::from_token(token) {
                            Some(Encoding::Chunked) => {
                                self.state.transfer_encoding = Encoding::Chunked;
                            }
                            Some(_) => {}
                            None => return Err(crate::Error::UnsupportedTransferEncoding),
                        }
                    }
                }
                h if h == hash_header_const(b"Location") => {
                    location = header.value();
                }
                h if h == hash_header_const(b"Connection") => {
                    // `close` on any field line, any status, is sticky (RFC 9110 §5.3, RFC 9112 §9.6).
                    match connection_header_keep_alive(header.value()) {
                        Some(false) => self.state.flags.allow_keepalive = false,
                        Some(true) => has_keep_alive_token = true,
                        None => {}
                    }
                }
                h if h == hash_header_const(b"Last-Modified") => {
                    pretend_304 = self.flags.force_last_modified
                        && response.status_code > 199
                        && response.status_code < 300
                        && !self.if_modified_since.is_empty()
                        && self.if_modified_since.slice() == header.value();
                }
                h if h == hash_header_const(b"Alt-Svc") => {
                    // Record regardless of *this* request's shape — a future
                    // request to the same origin may be h3-eligible even if this
                    // one was pinned/proxied/sendfile.
                    if self.is_https()
                        && self.unix_socket_path.slice().len() == 0
                        && !(self.flags.proxy_tunneling && self.proxy_tunnel.is_none())
                        && h3_alt_svc_enabled()
                    {
                        self.thread().alt_svc.borrow_mut().record(
                            self.url.hostname(),
                            self.url.get_port_auto(),
                            header.value(),
                        );
                    }
                }
                _ => {}
            }
        }

        if self.verbose != HTTPVerboseLevel::None {
            print_response(response);
        }

        if pretend_304 {
            response.status_code = 304;
        }

        // According to RFC 7230 section 3.3.3:
        //   1. Any response to a HEAD request and any response with a 1xx (Informational),
        //      204 (No Content), or 304 (Not Modified) status code
        //      [...] cannot contain a message body or trailer section.
        // Therefore in these cases set content-length to 0, so the response body is always ignored
        // and is not waited for (which could cause a timeout).
        // This applies regardless of whether we're using a proxy tunnel or not,
        // since these status codes NEVER have a body per the HTTP spec.
        if (response.status_code >= 100 && response.status_code < 200)
            || response.status_code == 204
            || response.status_code == 304
        {
            self.state.content_length = Some(0);
        }

        // Don't do this for proxies because those connections will be open for awhile.
        if !self.flags.proxy_tunneling {
            //
            // according to RFC 7230 section 6.3:
            //   In order to remain persistent, all messages on a connection need to
            //   have a self-defined message length (i.e., one not defined by closure
            //   of the connection)
            // therefore, if response has no content-length header and is not chunked, implicitly disable
            // the keep-alive behavior (keep-alive being the default behavior for HTTP/1.1 and not for HTTP/1.0)
            //
            // but, we must only do this IF the status code allows it to contain a body.
            if self.state.content_length.is_none()
                && self.state.transfer_encoding != Encoding::Chunked
            {
                self.state.flags.allow_keepalive = false;
            }
        }

        // RFC 9110 §9.3.6: a non-200 response to CONNECT means the tunnel was
        // not established. Surface the proxy's response to the caller, but
        // never follow a Location header from it — a malicious proxy could
        // otherwise redirect the request (body and custom headers included)
        // to an attacker-chosen plaintext origin.
        let mut is_proxy_connect_failure = false;
        if self.flags.proxy_tunneling && self.proxy_tunnel.is_none() {
            if response.status_code == 200 {
                // signal to continue the proxing
                return Ok(ShouldContinue::ContinueStreaming);
            }

            // proxy denied connection so return proxy result (407, 403 etc)
            self.flags.proxy_tunneling = false;
            self.flags.disable_keepalive = true;
            is_proxy_connect_failure = true;
        }

        // RFC 9112 §9.3: an HTTP/1.0 response is non-persistent unless it says
        // `Connection: keep-alive`. Deliberately below the CONNECT return above:
        // proxies commonly answer CONNECT with `HTTP/1.0 200`, which says nothing
        // about the tunneled origin, whose own response is what gets judged here.
        if response.minor_version == 0 && !has_keep_alive_token {
            self.state.flags.allow_keepalive = false;
        }

        let status_code = response.status_code;

        if status_code == 407 {
            // If the request is being proxied and passes through the 407 status code, then let's also not do HTTP Keep-Alive.
            self.flags.disable_keepalive = true;
        }

        // if is no redirect or if is redirect == "manual" just proceed
        // https://fetch.spec.whatwg.org/#redirect-status
        let is_redirect = matches!(status_code, 301 | 302 | 303 | 307 | 308);
        if is_redirect {
            if !is_proxy_connect_failure
                && self.redirect_type == FetchRedirect::Follow
                && !location.is_empty()
                && self.remaining_redirect_count > 0
            {
                // https://fetch.spec.whatwg.org/#http-redirect-fetch step 11:
                // "If internalResponse's status is not 303, request's body
                // is non-null, and request's body's source is null, then
                // return a network error." A ReadableStream body has no
                // source to replay from, so only 303 (which drops the body
                // and switches to GET) may be followed.
                if status_code != 303
                    && matches!(self.state.original_request_body, Body::Stream(_))
                {
                    return Err(crate::Error::RequestBodyNotReusable);
                }
                let is_same_origin;

                {
                    if let Some(i) = strings::index_of(location, b"://") {
                        let mut string_builder = StringBuilder::default();

                        let is_protocol_relative = i == 0;
                        let protocol_name: &[u8] = if is_protocol_relative {
                            self.url.display_protocol()
                        } else {
                            &location[0..i]
                        };
                        let is_http =
                            strings::eql_case_insensitive_ascii(protocol_name, b"http", true);
                        if is_http
                            || strings::eql_case_insensitive_ascii(protocol_name, b"https", true)
                        {
                        } else {
                            return Err(crate::Error::UnsupportedRedirectProtocol);
                        }

                        if (protocol_name.len() * usize::from(is_protocol_relative))
                            + location.len()
                            > MAX_REDIRECT_URL_LENGTH
                        {
                            return Err(crate::Error::RedirectURLTooLong);
                        }

                        string_builder.count(location);

                        if is_protocol_relative {
                            if is_http {
                                string_builder.count(b"http");
                            } else {
                                string_builder.count(b"https");
                            }
                        }

                        string_builder.allocate()?;

                        if is_protocol_relative {
                            if is_http {
                                let _ = string_builder.append(b"http");
                            } else {
                                let _ = string_builder.append(b"https");
                            }
                        }

                        let _ = string_builder.append(location);

                        debug_assert!(string_builder.cap == string_builder.len);

                        let input = BunString::borrow_utf8(string_builder.allocated_slice());
                        let normalized_url = bun_url::href_from_string(&input);
                        if normalized_url.tag() == BunStringTag::Dead {
                            // URL__getHref failed, dont pass dead tagged string to toOwnedSlice.
                            return Err(crate::Error::RedirectURLInvalid);
                        }
                        let new_url = bun_url::ParsedURL::new(
                            normalized_url.to_owned_slice().into_boxed_slice(),
                        );
                        is_same_origin = strings::eql_case_insensitive_ascii(
                            strings::without_trailing_slash(new_url.origin()),
                            strings::without_trailing_slash(self.url.origin()),
                            true,
                        );
                        self.url = RequestUrl::owned(new_url);
                    } else if location.starts_with(b"//") {
                        let mut string_builder = StringBuilder::default();

                        let protocol_name = self.url.display_protocol();

                        if protocol_name.len() + 1 + location.len() > MAX_REDIRECT_URL_LENGTH {
                            return Err(crate::Error::RedirectURLTooLong);
                        }

                        let is_http =
                            strings::eql_case_insensitive_ascii(protocol_name, b"http", true);

                        if is_http {
                            string_builder.count(b"http:");
                        } else {
                            string_builder.count(b"https:");
                        }

                        string_builder.count(location);

                        string_builder.allocate()?;

                        if is_http {
                            let _ = string_builder.append(b"http:");
                        } else {
                            let _ = string_builder.append(b"https:");
                        }

                        let _ = string_builder.append(location);

                        debug_assert!(string_builder.cap == string_builder.len);

                        let input = BunString::borrow_utf8(string_builder.allocated_slice());
                        let normalized_url = bun_url::href_from_string(&input);
                        if normalized_url.tag() == BunStringTag::Dead {
                            return Err(crate::Error::RedirectURLInvalid);
                        }
                        let new_url = bun_url::ParsedURL::new(
                            normalized_url.to_owned_slice().into_boxed_slice(),
                        );
                        is_same_origin = strings::eql_case_insensitive_ascii(
                            strings::without_trailing_slash(new_url.origin()),
                            strings::without_trailing_slash(self.url.origin()),
                            true,
                        );
                        self.url = RequestUrl::owned(new_url);
                    } else {
                        let base = BunString::borrow_utf8(self.url.href());
                        let rel = BunString::borrow_utf8(location);
                        let new_url_ = bun_url::join(&base, &rel);

                        if new_url_.is_empty() {
                            return Err(crate::Error::InvalidRedirectURL);
                        }

                        let new_url =
                            bun_url::ParsedURL::new(new_url_.to_owned_slice().into_boxed_slice());
                        if !new_url.url().has_http_like_protocol() {
                            return Err(crate::Error::UnsupportedRedirectProtocol);
                        }
                        is_same_origin = strings::eql_case_insensitive_ascii(
                            strings::without_trailing_slash(new_url.origin()),
                            strings::without_trailing_slash(self.url.origin()),
                            true,
                        );
                        self.url = RequestUrl::owned(new_url);
                    }
                }

                // If one of the following is true
                // - internalResponse's status is 301 or 302 and request's method is `POST`
                // - internalResponse's status is 303 and request's method is not `GET` or `HEAD`
                // then:
                if ((status_code == 301 || status_code == 302) && self.method == Method::POST)
                    || (status_code == 303
                        && self.method != Method::GET
                        && self.method != Method::HEAD)
                {
                    // - Set request's method to `GET` and request's body to null.
                    self.method = Method::GET;

                    // https://github.com/oven-sh/bun/issues/6053
                    if self.header_entries.len() > 0 {
                        // - For each headerName of request-body-header name, delete headerName from request's header list.
                        let mut i: usize = 0;
                        while i < self.header_entries.len() {
                            let names = self.header_entries.items_name();
                            let name = self.header_str(names[i]);
                            if REQUEST_BODY_HEADERS
                                .get_ascii_case_insensitive(name)
                                .is_some()
                            {
                                let _ = self.header_entries.ordered_remove(i);
                            } else {
                                i += 1;
                            }
                        }
                    }
                }

                // Cross-origin redirect: re-derive SNI / cert
                // verification / Host from the redirect target. See
                // `InternalStateFlags::clear_hostname_on_redirect`.
                if !is_same_origin {
                    self.state.flags.clear_hostname_on_redirect = true;
                }

                // https://fetch.spec.whatwg.org/#concept-http-redirect-fetch
                // If request's current URL's origin is not same origin with
                // locationURL's origin, then for each headerName of CORS
                // non-wildcard request-header name, delete headerName from
                // request's header list.
                if !is_same_origin && self.header_entries.len() > 0 {
                    let mut i = 0;
                    while i < self.header_entries.len() {
                        let name = self.header_str(self.header_entries.items_name()[i]);
                        if CROSS_ORIGIN_STRIPPED_REQUEST_HEADERS
                            .get_ascii_case_insensitive(name)
                            .is_some()
                        {
                            let _ = self.header_entries.ordered_remove(i);
                        } else {
                            i += 1;
                        }
                    }
                }
                self.state.flags.is_redirect_pending = true;
                if self.method.has_request_body() {
                    self.state.flags.resend_request_body_on_redirect = true;
                }
            } else if !is_proxy_connect_failure && self.redirect_type == FetchRedirect::Error {
                // error out if redirect is not allowed
                return Err(crate::Error::UnexpectedRedirect);
            }
        }

        self.state.response_stage = if self.state.transfer_encoding == Encoding::Chunked {
            ResponseStage::BodyChunk
        } else {
            ResponseStage::Body
        };
        let content_length = self.state.content_length;
        if let Some(length) = content_length {
            bun_core::scoped_log!(
                fetch,
                "handleResponseMetadata: content_length is {} and transfer_encoding {:?}",
                length,
                self.state.transfer_encoding
            );
        } else {
            bun_core::scoped_log!(
                fetch,
                "handleResponseMetadata: content_length is null and transfer_encoding {:?}",
                self.state.transfer_encoding
            );
        }
        if self.flags.upgrade_state == HTTPUpgradeState::Upgraded {
            self.state.content_length = None;
            self.state.flags.allow_keepalive = false;
            return Ok(ShouldContinue::ContinueStreaming);
        }

        // RFC 9112 §6.3: framing comes from Transfer-Encoding and Content-Length
        // alone. `Connection: close` only means the socket won't be reused, so a
        // `Content-Length: 0` response is still complete.
        if self.method.has_body()
            && (content_length.is_none()
                || content_length.unwrap() > 0
                || self.state.transfer_encoding == Encoding::Chunked
                || is_server_sent_events)
        {
            if self.state.flags.is_redirect_pending {
                // WHATWG HTTP-redirect fetch runs on the response head; the 3xx
                // body is discarded, not awaited. The socket still carries
                // undrained body bytes so it must be closed, not pooled.
                self.state.flags.allow_keepalive = false;
                return Ok(ShouldContinue::Finished);
            }
            Ok(ShouldContinue::ContinueStreaming)
        } else {
            Ok(ShouldContinue::Finished)
        }
    }
} // impl HTTPClient

