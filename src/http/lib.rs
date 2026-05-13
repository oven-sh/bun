//! HTTP client (port of `src/http/http.zig`).
//! The Zig file is `const HTTPClient = @This();` — the whole module IS the
//! `HTTPClient` struct. In Rust the struct is named explicitly and free
//! functions become inherent methods on it.

#![allow(unused, nonstandard_style, unexpected_cfgs, static_mut_refs)]
#![warn(unused_must_use)]
// ═══════════════════════════════════════════════════════════════════════
// B-1 GATE-AND-STUB
// All Phase-A draft bodies are preserved below behind ``.
// Un-gating happens in B-2.
// ═══════════════════════════════════════════════════════════════════════

// ── sub-modules (un-gated in B-2; remaining gates need higher-tier deps) ──
// TODO(b2-blocked): AsyncHTTP/HTTPContext/HTTPThread/ProxyTunnel are mutually
// recursive (HTTPClient ↔ HTTPContext ↔ HTTPThread ↔ AsyncHTTP ↔ ProxyTunnel ↔
// h2_client/h3_client) and must land together with the `the gated draft block (now dissolved)` block
// below. ssl_config + ssl_wrapper are now resolved (un-gated this pass);
// remaining lower-tier blockers are method bodies on
// bun_uws::NewSocketHandler (connect/adopt/ext/write/…) and
// bun_uws::quic::{Stream,Context,Header,PendingConnect} (h3 only).
// PORT NOTE: `h2_client`/`h3_client` are now un-gated as thin shells (atomics
// + constants only); their heavy submodules (Stream/ClientSession/…) remain
// gated inside H2Client.rs/H3Client.rs until the cluster above lands.
#![warn(unreachable_pub)]
#[path = "AsyncHTTP.rs"]
pub mod async_http;
#[path = "CertificateInfo.rs"]
pub mod certificate_info;
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
#[path = "lshpack.rs"]
pub mod lshpack;
#[path = "ProxyTunnel.rs"]
pub mod proxy_tunnel;
#[path = "SendFile.rs"]
pub mod send_file;
#[path = "Signals.rs"]
pub mod signals;
#[path = "ThreadSafeStreamBuffer.rs"]
pub mod thread_safe_stream_buffer;
#[path = "websocket.rs"]
pub mod websocket;
#[path = "websocket_http_client.rs"]
pub mod websocket_http_client;
#[path = "zlib.rs"]
pub mod zlib;

// ── crate-root re-exports (real types from un-gated modules) ──
pub use async_http::AsyncHTTP;
pub use certificate_info::CertificateInfo;
pub use decompressor::Decompressor;
pub use header_builder::HeaderBuilder;
pub use headers::{Headers, HeadersExt};
pub use http_cert_error::HTTPCertError;
pub use http_context::{HTTPContext, HTTPSocket};
pub use http_request_body::HTTPRequestBody;
pub use http_thread::HttpThread as HTTPThread;
pub use internal_state::InternalState;
pub use proxy_tunnel::ProxyTunnel;
pub use send_file::SendFile;
pub use signals::Signals;
pub use thread_safe_stream_buffer::ThreadSafeStreamBuffer;
#[path = "ssl_config.rs"]
pub mod ssl_config;
pub use ssl_config::SSLConfig;
// PORT NOTE: SSLWrapper was MOVE_DOWN to bun_uws (tier 4); re-export here so
// `crate::ssl_wrapper::SSLWrapper` resolves for ProxyTunnel/HTTPContext.
pub use bun_uws::ssl_wrapper;
pub use bun_uws::ssl_wrapper::SSLWrapper;

// ── naming aliases ──
// Phase-A drafts used both `HTTPClient`/`HttpClient` and the Zig type-factory
// name `NewHTTPContext`; alias all spellings to the canonical types so submodules
// resolve without churn.
pub use h2_client as h2;
pub use h2_client as H2;
pub use h3_client as h3;
pub use h3_client as H3;
pub use http_context as new_http_context;
pub type NewHTTPContext<const SSL: bool> = http_context::HTTPContext<SSL>;
pub type NewHttpContext<const SSL: bool> = http_context::HTTPContext<SSL>;
pub type HttpsContext = http_context::HTTPContext<true>;
pub type HttpContext = http_context::HTTPContext<false>;
pub type HttpClient<'a> = HTTPClient<'a>;
pub type HttpThread = HTTPThread;
pub type AsyncHttp<'a> = AsyncHTTP<'a>;
pub type ThreadlocalAsyncHttp<'a> = ThreadlocalAsyncHTTP<'a>;
pub use HTTPClientResult as http_client_result;
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
pub use header_value_iterator::HeaderValueIterator;
pub use init_error::InitError;

/// Zig: `pub const extremely_verbose = false;` — compile-time switch.
pub const extremely_verbose: bool = false;

/// Cloned response metadata (headers + url + status). Ownership transfers to
/// the user once the headers phase completes.
// PORT NOTE: extracted from the gated `the gated draft block (now dissolved)` block so `InternalState`
// can name it. The `picohttp::Response<'static>` borrows into `owned_buf`.
pub struct HTTPResponseMetadata {
    // Borrows `owned_buf` (sibling field) — `RawSlice` carries the
    // outlives-holder invariant for the self-referential borrow.
    pub url: bun_ptr::RawSlice<u8>,
    pub owned_buf: Box<[u8]>,
    pub response: bun_picohttp::Response<'static>,
}

impl Default for HTTPResponseMetadata {
    fn default() -> Self {
        Self {
            url: bun_ptr::RawSlice::EMPTY,
            owned_buf: Box::default(),
            response: bun_picohttp::Response::default(),
        }
    }
}

impl Drop for HTTPResponseMetadata {
    // Port of Zig `HTTPResponseMetadata.deinit`: `owned_buf` is freed by
    // `Box`'s own Drop; `response.headers.list` was `Box::leak`'d in
    // `clone_metadata` and must be reclaimed here. `Default` / zero-header
    // responses have an empty static slice, guarded by the len check.
    fn drop(&mut self) {
        let list = self.response.headers.list;
        if !list.is_empty() {
            // SAFETY: the only non-empty producer is `clone_metadata`, which
            // `Box::leak`s exactly this slice; we are its sole owner. The fat
            // `*mut [Header]` is obtained directly from the borrowed slice — no
            // need to round-trip through `(ptr, len)` + `from_raw_parts`.
            unsafe { bun_core::heap::destroy(core::ptr::from_ref(list).cast_mut()) };
        }
        self.response.headers = bun_picohttp::HeaderList::default();
        self.response.status = b"";
    }
}
// TODO(b1): bun_http_types re-exports — verify these resolve in B-2.
pub use bun_http_types::{ETag, FetchCacheMode, FetchRequestMode, MimeType, URLPath};

// ═══════════════════════════════════════════════════════════════════════
// B-2: extracted from `the gated draft block (now dissolved)` — standalone items with no deps on
// the still-gated HTTPClient/HTTPContext/ssl_* surfaces.
// ═══════════════════════════════════════════════════════════════════════

use bun_core::MutableString;
use bun_http_types::FetchRedirect::CommonAbortReason;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum HTTPUpgradeState {
    #[default]
    None = 0,
    Pending = 1,
    Upgraded = 2,
}

// PORT NOTE: was `packed struct(u32)` with mixed bool + 2-bit enum fields.
// Kept as a plain struct since it never crosses FFI; restore packing in Phase B
// if the 32-byte vs 4-byte size difference shows up in profiling.
// PERF(port): was packed struct(u32) — profile in Phase B.
#[derive(Clone, Copy)]
pub struct Flags {
    pub disable_timeout: bool,
    pub disable_keepalive: bool,
    pub disable_decompression: bool,
    pub did_have_handshaking_error: bool,
    pub force_last_modified: bool,
    pub redirected: bool,
    pub proxy_tunneling: bool,
    pub reject_unauthorized: bool,
    pub is_preconnect_only: bool,
    pub is_streaming_request_body: bool,
    pub defer_fail_until_connecting_is_complete: bool,
    pub upgrade_state: HTTPUpgradeState,
    pub protocol: Protocol,
    /// Set by `fetch(url, { protocol: "http2" })`: ALPN advertises only h2
    /// and the request fails if the server selects anything else.
    pub force_http2: bool,
    /// Set by `fetch(url, { protocol: "http1.1" })`: opt out of h2 even when
    /// the experimental env flag would otherwise advertise it.
    pub force_http1: bool,
    /// Set by `fetch(url, { protocol: "http3" })`: skip TCP entirely and open
    /// a QUIC connection. HTTPS-only; no proxy/unix-socket support.
    pub force_http3: bool,
    /// Set after the first H3 retry so a stale-session/GOAWAY race retries
    /// once on a fresh connection but never loops.
    pub h3_retried: bool,
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
            defer_fail_until_connecting_is_complete: false,
            upgrade_state: HTTPUpgradeState::None,
            protocol: Protocol::Http1_1,
            force_http2: false,
            force_http1: false,
            force_http3: false,
            h3_retried: false,
        }
    }
}

// ───────────────────────────── globals ─────────────────────────────

pub static ASYNC_HTTP_ID_MONOTONIC: AtomicU32 = AtomicU32::new(0);

/// Set once at startup from `--experimental-http2-fetch` (before the HTTP
/// thread spawns) and then only read on that thread.
pub static EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI: AtomicBool = AtomicBool::new(false);
/// Set once at startup from `--experimental-http3-fetch`. Same threading
/// rules as the http2 flag.
pub static EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI: AtomicBool = AtomicBool::new(false);

const MAX_REDIRECT_URL_LENGTH: usize = 128 * 1024;

/// Mirrors Zig's `bun.http.max_http_header_size`. The static is exported to
/// C++ via `BUN_DEFAULT_MAX_HTTP_HEADER_SIZE`; `AtomicUsize` has the same
/// size/alignment as `usize` so the symbol layout is unchanged.
#[unsafe(export_name = "BUN_DEFAULT_MAX_HTTP_HEADER_SIZE")]
pub static MAX_HTTP_HEADER_SIZE: AtomicUsize = AtomicUsize::new(16 * 1024);

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

/// Set once during single-threaded CLI parsing; read from the HTTP thread.
pub static OVERRIDDEN_DEFAULT_USER_AGENT: std::sync::OnceLock<&'static [u8]> =
    std::sync::OnceLock::new();

/// Idle timeout for HTTP client sockets, in seconds. The timer is armed in
/// `on_open` (so it covers the TLS handshake) and re-armed on every read/write;
/// if no bytes move in either direction for this long the request fails with
/// `error.Timeout`. 0 disables the timer (matching `disable_timeout = true`).
/// Overridable via `BUN_CONFIG_HTTP_IDLE_TIMEOUT`. Default is 5 minutes — the
/// previous hard-coded value — so unchanged environments see identical
/// behaviour except that the handshake phase is now also covered. Values
/// above 240s are served by uSockets' minute-granularity long timer (see
/// [`SocketTimeout::set_timeout`]), so they round up to the next whole minute.
pub static IDLE_TIMEOUT_SECONDS: AtomicU32 = AtomicU32::new(300);

/// Safe accessor for [`IDLE_TIMEOUT_SECONDS`].
#[inline]
pub fn idle_timeout_seconds() -> c_uint {
    IDLE_TIMEOUT_SECONDS.load(Ordering::Relaxed)
}

pub const END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY: &[u8] = b"0\r\n\r\n";

/// HTTP-thread-only scratch buffer for building NUL-terminated hostnames.
pub static TEMP_HOSTNAME: bun_core::RacyCell<[u8; 8192]> = bun_core::RacyCell::new([0; 8192]);

const DEFAULT_REDIRECT_COUNT: i8 = 127;

const MAX_TLS_RECORD_SIZE: usize = 16 * 1024;

/// REFUSED_STREAM or graceful GOAWAY past our id: the server promises it
/// did not process the request, so re-dispatch from the top. Only reached
/// for `.bytes` bodies (replayable).
pub const MAX_H2_RETRIES: u8 = 5;

const PREALLOCATE_MAX: usize = 1024 * 1024 * 256;

#[inline]
pub fn cleanup(_force: bool) {
    // PERF(port): was MimallocArena bulk-free — profile in Phase B
}

/// Whether the experimental Alt-Svc-driven HTTP/3 upgrade is enabled at all
/// (CLI flag or env var). Used on its own to gate `H3.AltSvc.record` — a
/// response that arrived over a request shape h3 can't serve (proxy, sendfile,
/// `force_http1`) still carries an authoritative Alt-Svc for the origin.
pub fn h3_alt_svc_enabled() -> bool {
    // SAFETY: set once at startup before HTTP thread spawns; only read thereafter.
    let cli = EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.load(Ordering::Relaxed);
    cli || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT
        .get()
        .unwrap_or(false)
}

/// Strips an optional port suffix from a host string (e.g. "example.com:443" -> "example.com").
/// Handles IPv6 bracket notation correctly (e.g. "[::1]:443" -> "[::1]").
pub fn strip_port_from_host(host: &[u8]) -> &[u8] {
    if host.is_empty() {
        return host;
    }
    // IPv6 with brackets: "[::1]:port"
    if host[0] == b'[' {
        if let Some(bracket) = host.iter().rposition(|&b| b == b']') {
            // Return everything up to and including ']'
            return &host[0..bracket + 1];
        }
        return host;
    }
    // IPv4 or hostname: find last colon
    if let Some(colon) = host.iter().rposition(|&b| b == b':') {
        return &host[0..colon];
    }
    host
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ShouldContinue {
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

impl HTTPClient<'_> {
    /// Shared body of `apply_headers` for the h2/h3 client sessions: hand a
    /// pre-decoded multiplexed response (HPACK / QPACK) to the HTTP/1.1
    /// metadata pipeline (`handle_response_metadata` + `clone_metadata`), then
    /// undo the HTTP/1.1-specific framing decisions that don't apply when the
    /// transport delimits the body (h2 DATA frames / h3 STREAM frames).
    ///
    /// SAFETY CONTRACT: `headers` borrows caller-owned storage
    /// (`stream.decoded_bytes` for h2, the lsquic hset for h3) that is
    /// lifetime-erased into `state.pending_response`. The caller MUST invoke
    /// `clone_metadata` (which deep-copies the header bytes) synchronously
    /// before that backing storage is freed. Both call sites already do.
    #[inline]
    pub(crate) fn apply_multiplexed_headers(
        &mut self,
        status_code: u32,
        headers: &[picohttp::Header],
    ) -> Result<HeaderResult, bun_core::Error> {
        let mut response = picohttp::Response {
            minor_version: 0,
            status_code,
            status: b"",
            headers: picohttp::HeaderList { list: headers },
            bytes_read: 0,
        };
        // SAFETY: see fn doc — erased borrow is deep-copied by `clone_metadata`
        // before the backing storage is released.
        self.state.pending_response = Some(unsafe { response.detach_lifetime() });
        let should_continue = self.handle_response_metadata(&mut response)?;
        // handle_response_metadata may mutate `response` (e.g. the 304 rewrite
        // for force_last_modified); clone_metadata reads pending_response, so
        // re-sync. SAFETY: same lifetime erase as above.
        self.state.pending_response = Some(unsafe { response.detach_lifetime() });
        // h2/h3 framing delimits the body; chunked transfer-encoding and the
        // HTTP/1.1 "no Content-Length ⇒ no keep-alive" rule don't apply.
        self.state.transfer_encoding = Encoding::Identity;
        if self.state.response_stage == ResponseStage::BodyChunk {
            self.state.response_stage = ResponseStage::Body;
        }
        self.state.flags.allow_keepalive = true;
        Ok(if should_continue == ShouldContinue::Finished {
            HeaderResult::Finished
        } else {
            HeaderResult::HasBody
        })
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
    pub body: Option<&'a mut MutableString>,
    pub has_more: bool,
    pub redirected: bool,
    pub can_stream: bool,
    /// Set once ALPN selected h2 so the JS side writes raw bytes into the
    /// streaming-body buffer instead of chunked-encoding them.
    pub is_http2: bool,

    pub fail: Option<bun_core::Error>,

    /// Owns the response metadata aka headers, url and status code
    pub metadata: Option<HTTPResponseMetadata>,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the response body
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    pub body_size: BodySize,
    pub certificate_info: Option<CertificateInfo>,
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

    pub fn is_timeout(&self) -> bool {
        matches!(self.fail, Some(e) if e == bun_core::err!("Timeout"))
    }

    pub fn is_abort(&self) -> bool {
        matches!(self.fail, Some(e) if e == bun_core::err!("Aborted") || e == bun_core::err!("AbortedBeforeConnecting"))
    }

    /// Widen the borrow on `body` to `'static` for self-referential storage.
    ///
    /// Field-by-field move (no bitwise reinterpret): the only lifetime-carrying
    /// field is `body: Option<&'a mut MutableString>`, which always points at a
    /// buffer owned by the same heap object that will store this result
    /// (`FetchTasklet.response_buffer`, `NetworkTask.response_buffer`, …).
    ///
    /// # Safety
    /// Caller must guarantee `body`'s pointee outlives the returned value and
    /// is not aliased exclusively elsewhere for that duration.
    #[inline]
    pub unsafe fn detach_lifetime(self) -> HTTPClientResult<'static> {
        HTTPClientResult {
            // SAFETY: caller contract — the buffer outlives the stored result.
            body: self
                .body
                .map(|b| unsafe { &mut *core::ptr::from_mut::<MutableString>(b) }),
            has_more: self.has_more,
            redirected: self.redirected,
            can_stream: self.can_stream,
            is_http2: self.is_http2,
            fail: self.fail,
            metadata: self.metadata,
            body_size: self.body_size,
            certificate_info: self.certificate_info,
        }
    }
}

pub type HTTPClientResultCallbackFunction =
    fn(*mut (), *mut AsyncHTTP<'static>, HTTPClientResult<'_>);

#[derive(Copy, Clone)]
pub struct HTTPClientResultCallback {
    pub ctx: *mut (),
    pub function: HTTPClientResultCallbackFunction,
}

impl HTTPClientResultCallback {
    pub fn run(self, async_http: *mut AsyncHTTP<'static>, result: HTTPClientResult<'_>) {
        (self.function)(self.ctx, async_http, result);
    }

    // PORT NOTE: `Callback.New(comptime Type, comptime callback)` was a
    // type-returning fn that wrapped a typed callback in *anyopaque erasure.
    pub fn new<T>(
        this: *mut T,
        callback: fn(*mut T, *mut AsyncHTTP<'static>, HTTPClientResult<'_>),
    ) -> Self {
        Self {
            ctx: this.cast::<()>(),
            // SAFETY: fn-pointer cast over *mut T → *mut () first arg; same
            // calling convention, the receiver casts `ctx` back before use.
            function: unsafe {
                bun_ptr::cast_fn_ptr::<
                    fn(*mut T, *mut AsyncHTTP<'static>, HTTPClientResult<'_>),
                    HTTPClientResultCallbackFunction,
                >(callback)
            },
        }
    }
}

// Exists for heap stats reasons.
pub struct ThreadlocalAsyncHTTP<'a> {
    pub async_http: AsyncHTTP<'a>,
}

impl<'a> ThreadlocalAsyncHTTP<'a> {
    pub fn new(async_http: AsyncHTTP<'a>) -> Box<Self> {
        Box::new(Self { async_http })
    }
}

/// `socket: anytype` in `set_timeout` — minimal trait for what the body calls.
pub trait SocketTimeout {
    fn timeout(&self, seconds: core::ffi::c_uint);
    fn set_timeout_minutes(&self, minutes: core::ffi::c_uint);
    /// Seconds-granularity idle timer. Values >240s are routed onto uSockets'
    /// minute-granularity long-timeout wheel; ≤240s use the short-tick timer.
    fn set_timeout(&self, seconds: core::ffi::c_uint);
}

// lowercase hash header names so that we can be sure
pub fn hash_header_name(name: &[u8]) -> u64 {
    // Also fixes the Wyhash11→Wyhash port bug noted in the deleted TODO; safe —
    // `hash_header_const` at :809 is computed by this same fn at runtime, no
    // persisted hashes.
    bun_wyhash::hash_ascii_lowercase(0, name)
}

// ───────────────────────────── HTTPClient struct ─────────────────────────────
// Extracted from `the gated draft block (now dissolved)`. The heavy `impl HTTPClient` (socket
// dispatch / state machine) remains gated below until the missing
// `bun_uws::NewSocketHandler` methods (`ext`/`timeout`/`raw_write`/`flush`/
// `shutdown`/`connect_group`/…) land.

use bun_core::ZigStringSlice;
use bun_url::URL;
use core::ptr::NonNull;

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
//
// Lifetime `'a` ties every borrowed input — `url`, `http_proxy`, `header_buf`,
// `if_modified_since`, `hostname`, and the borrowed `HTTPRequestBody::Bytes`
// payload — to the caller's storage. Phase-A erased these to `'static` and
// lifetime-erased at every call site; threading the lifetime removes that hazard.
// Intrusive raw-pointer backrefs (socket ext, h2/h3 streams) store the
// lifetime-erased `HTTPClient<'static>` form via [`HTTPClient::as_erased_ptr`].
pub struct HTTPClient<'a> {
    pub method: Method,
    pub header_entries: headers::EntryList,
    pub header_buf: &'a [u8],
    pub url: URL<'a>,
    pub connected_url: URL<'a>,
    // allocator param dropped — global mimalloc
    pub verbose: HTTPVerboseLevel,
    pub remaining_redirect_count: i8,
    pub allow_retry: bool,
    /// Transparent re-dispatch count for REFUSED_STREAM / graceful-GOAWAY,
    /// where the server promises the request was not processed. Capped by
    /// `MAX_H2_RETRIES`.
    pub h2_retries: u8,
    pub redirect_type: FetchRedirect,
    pub redirect: Vec<u8>,
    /// The previous hop's `redirect` buffer, parked by `handle_response_metadata`
    /// when it overwrites `redirect`. `connected_url` may still borrow from it
    /// until `do_redirect` has released the socket, so it is freed there rather
    /// than at the assignment site. Also freed in `Drop` for error paths.
    pub prev_redirect: Vec<u8>,
    // TODO(port): lifetime — &mut Progress::Node owned by caller; raw to avoid <'a>
    pub progress_node: Option<NonNull<bun_core::Progress::Node>>,

    pub flags: Flags,

    pub state: InternalState<'a>,
    pub tls_props: Option<ssl_config::SharedPtr>,
    /// The custom SSL context used for this request (None = default context).
    /// Set by HTTPThread.connect() when using custom TLS configs.
    /// Holds one owned strong ref (taken in `set_custom_ssl_ctx`, released on
    /// drop). `HttpsContext` is intrusive-refcounted (also recovered from socket
    /// ext), so this is an `IntrusiveRc`, not an `Arc`.
    pub custom_ssl_ctx: Option<http_context::HTTPContextRc<true>>,
    pub result_callback: HTTPClientResultCallback,

    /// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
    /// This is a workaround for that.
    pub if_modified_since: &'a [u8],
    pub request_content_len_buf: [u8; b"-4294967295".len()],

    pub http_proxy: Option<URL<'a>>,
    pub proxy_headers: Option<Headers>,
    pub proxy_authorization: Option<Vec<u8>>,
    /// Set while this request is tunneling through an HTTP proxy (CONNECT).
    /// Holds one owned strong ref on the intrusive-refcounted `ProxyTunnel`
    /// (taken by `ProxyTunnel::start` / `adopt`, released on drop / pool
    /// hand-off), so this is an `IntrusiveRc`, not an `Arc`. The pointee is
    /// also recovered raw from the SSLWrapper callback `ctx`, hence intrusive.
    pub proxy_tunnel: Option<proxy_tunnel::RefPtr>,
    /// Set when this request is bound to a stream on an HTTP/2 session.
    /// Owned by the session; cleared by the session when the stream completes.
    pub h2: Option<NonNull<h2::Stream>>,
    /// Set when this request is bound to an HTTP/3 stream. Owned by the H3
    /// session; cleared by the session when the stream completes.
    pub h3: Option<NonNull<h3::Stream>>,
    /// Set while this request is the leader of a fresh TLS connect that other
    /// h2-capable requests have coalesced onto. Resolved (and freed) once ALPN
    /// is known or the connect fails. Backref into the owning
    /// `HTTPContext.pending_h2_connects` Vec — not an owned Box.
    pub pending_h2: Option<NonNull<h2::PendingConnect>>,
    pub signals: Signals,
    pub async_http_id: u32,
    pub hostname: Option<&'a [u8]>,
    pub unix_socket_path: ZigStringSlice,
}

impl<'a> HTTPClient<'a> {
    /// Erase the borrow lifetime for storage in intrusive data structures
    /// (socket ext slots, h2/h3 stream backrefs, proxy-tunnel ctx). Lifetimes
    /// are a compile-time fiction on raw pointers; consumers re-derive a
    /// short-lived `&mut` when accessing. Centralizing the cast keeps every
    /// such erasure auditable at one definition.
    #[inline(always)]
    pub fn as_erased_ptr(&self) -> NonNull<HTTPClient<'static>> {
        // SAFETY: `self` is a valid reference (non-null, aligned).
        NonNull::from(self).cast::<HTTPClient<'static>>()
    }

    /// Upgrade an [`as_erased_ptr`](Self::as_erased_ptr) back-reference to
    /// `&mut HTTPClient`.
    ///
    /// INVARIANT: every `NonNull<HTTPClient<'static>>` reaching here is a
    /// back-ref produced by `as_erased_ptr` and stored in an intrusive
    /// container (h2/h3 `Stream.client`, `PendingConnect.waiters`,
    /// `ClientSession.pending_attach`, socket ext slots) whose holder is
    /// strictly outlived by the `HTTPClient`'s embedding `AsyncHTTP`. All such
    /// access is HTTP-thread-only, so the returned `&mut` is the sole live
    /// borrow for its scope. The `HTTPClient` is a distinct allocation from
    /// every holder.
    ///
    /// Centralises the back-ref upgrade previously open-coded in
    /// `h2_client::ClientSession::{stream_client_mut, pending_client_mut}`,
    /// `h2_client::PendingConnect::waiter_mut`, and `h3_client::client_mut`.
    #[inline(always)]
    pub(crate) fn from_erased_backref<'b>(
        p: NonNull<HTTPClient<'static>>,
    ) -> &'b mut HTTPClient<'static> {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *p.as_ptr() }
    }
}

impl Drop for HTTPClient<'_> {
    fn drop(&mut self) {
        // redirect / prev_redirect are Vec<u8> — dropped automatically.
        // proxy_authorization: Option<Vec<u8>> — dropped automatically.
        // proxy_headers: Option<Headers> — dropped automatically.
        // tunnel was created by ProxyTunnel::new (heap::alloc) and refcounted;
        // close_proxy_tunnel releases this client's strong ref (no shutdown —
        // matches Zig deinit which only detach+derefs).
        self.close_proxy_tunnel(false);
        // The session detaches `h2` before any terminal callback, so this should
        // be None by the time the result callback's deinit path runs.
        debug_assert!(self.h2.is_none());
        // tls_props: Option<SharedPtr> — Drop releases strong ref.
        if let Some(ctx) = self.custom_ssl_ctx.take() {
            // Release the strong ref taken in set_custom_ssl_ctx.
            ctx.deref();
        }
        self.unix_socket_path = ZigStringSlice::EMPTY;
    }
}

// ── HTTP-thread globals (single-threaded; initialized by HTTPThread::on_start) ──
// `MaybeUninit` (not `Option`) so the static const-evals to all-zero bytes and
// lands in `.bss`. `Option<HTTPThread>::None` has a non-zero niche value, which
// forced the entire ~27 KB struct into `.data` and thus into startup RSS for
// every process — Zig's `var http_thread: HTTPThread = undefined` is pure BSS.
//
// `ThreadCell` (not `RacyCell`) to encode "HTTP-thread-only after init" in the
// type. `claim()` is invoked from `HTTPThread::on_start`. JS-side callers that
// only touch the lock-free `queued_tasks` + `wakeup` (e.g. `schedule()`) go
// through [`http_thread_shared`] / `get_unchecked` until those fields are
// hoisted out of the thread-confined struct.
pub static HTTP_THREAD: bun_core::ThreadCell<core::mem::MaybeUninit<HTTPThread>> =
    bun_core::ThreadCell::new(core::mem::MaybeUninit::uninit());
pub(crate) static HTTP_THREAD_INIT: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

#[inline]
pub fn http_thread() -> &'static mut HTTPThread {
    // Release-mode guard, not `debug_assert!`: `HTTPThread` contains
    // niche-bearing fields (`Box`, `Vec`, `NonNull`, `Option<Arc>` …), so
    // `assume_init_mut()` on the uninitialized static is *immediate* UB — a
    // `debug_assert!` leaves release builds unguarded. The `Acquire` load
    // pairs with `init_once`'s `Release` store on `HTTP_THREAD_INIT`,
    // establishing happens-before for cross-thread callers that did not
    // themselves go through `Once::call_once` (e.g. `schedule_*` paths from
    // the JS thread). Cost is a single relaxed-on-x86 atomic load.
    assert!(
        HTTP_THREAD_INIT.load(core::sync::atomic::Ordering::Acquire),
        "http_thread() called before HTTPThread::init()"
    );
    // SAFETY: `HTTP_THREAD_INIT == true` (checked above) is set only after
    // `HTTP_THREAD.write(..)` in `init_once`, so the `MaybeUninit` is fully
    // written. Thread-affinity is documented (HTTP-thread-only after
    // `on_start`); the `ThreadCell` owner assert covers debug.
    unsafe { (*HTTP_THREAD.get()).assume_init_mut() }
}
#[inline]
pub fn http_thread_mut() -> &'static mut HTTPThread {
    http_thread()
}

// TODO: this needs to be freed when Worker Threads are implemented
// HTTP-thread-only; `RacyCell` is the alias-safe static cell.
pub static SOCKET_ASYNC_HTTP_ABORT_TRACKER: bun_core::RacyCell<
    Option<bun_collections::ArrayHashMap<u32, bun_uws::AnySocket>>,
> = bun_core::RacyCell::new(None);

// ═══════════════════════════════════════════════════════════════════════
// Prelude: imports, constants, helper fns, and bridge impls the
// `impl HTTPClient` state machine needs. Kept separate from the head/tail
// blocks so the state machine compiles standalone.
// ═══════════════════════════════════════════════════════════════════════

use core::ffi::{c_int, c_uint, c_void};
use core::mem::offset_of;

use bstr::BStr;
use bun_boringssl as boringssl;
use bun_collections::ArrayHashMap;
use bun_core::StringBuilder;
use bun_core::{FeatureFlags, Global, Output, err};
use bun_core::{OwnedString, String as BunString, Tag as BunStringTag, immutable as strings};
use bun_uws as uws;
// TODO(port): spec http.zig:829 uses `std.hash.Wyhash` (NOT Wyhash11 — see
// PORTING.md §Crate-map). bun_wyhash currently only exports Wyhash11; swap
// once `bun_wyhash::Wyhash` (std algorithm) lands so proxy_auth_hash() and
// header-name hashing match any component still computing the Zig hash.
use bun_http_types::ETag::StringPointer;
use bun_wyhash::Wyhash11 as Wyhash;

use crate::headers::api;
use crate::http_context::HTTPSocket as HttpSocket;
use crate::internal_state::{HTTPStage, RequestStage, ResponseStage, Stage};

bun_core::declare_scope!(fetch, visible);

/// Generic `HttpContext<const SSL>` alias — `crate::HttpContext` /
/// `crate::HttpsContext` (above) are concrete-SSL aliases; the state machine
/// needs a const-generic spelling for `get_ssl_ctx<IS_SSL>()`.
pub type GenHttpContext<const SSL: bool> = http_context::HTTPContext<SSL>;

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
// PORT NOTE: Zig computed these at comptime via `Wyhash + lowerString`.
// Wyhash11 is not yet `const fn`, so use a runtime alias of `hash_header_name`
// and cache the three values that are looked up on every request via
// `LazyLock`. The per-header `match` arms inside `build_request` /
// `handle_response_metadata` already call `hash_header_const` at runtime.
#[inline(always)]
fn hash_header_const(name: &[u8]) -> u64 {
    hash_header_name(name)
}

static AUTHORIZATION_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Authorization"));
static PROXY_AUTHORIZATION_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Proxy-Authorization"));
static COOKIE_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Cookie"));

// ── shared per-thread buffers ───────────────────────────────────────────
// All four are HTTP-thread-only scratch (single uws loop thread); `RacyCell`
// is the alias-safe static cell per docs/PORTING.md §Global mutable state.
const PRINT_EVERY: usize = 0;
static PRINT_EVERY_I: AtomicUsize = AtomicUsize::new(0);

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
const MAX_REQUEST_HEADERS: usize = 256;
static SHARED_REQUEST_HEADERS_BUF: bun_core::RacyCell<[picohttp::Header; MAX_REQUEST_HEADERS]> =
    bun_core::RacyCell::new([picohttp::Header::ZERO; MAX_REQUEST_HEADERS]);

// this doesn't need to be stack memory because it is immediately cloned after use
static SHARED_RESPONSE_HEADERS_BUF: bun_core::RacyCell<[picohttp::Header; 256]> =
    bun_core::RacyCell::new([picohttp::Header::ZERO; 256]);

// the first packet for Transfer-Encoding: chunked
// is usually pretty small or sometimes even just a length
// so we can avoid allocating a temporary buffer to copy the data in
static SINGLE_PACKET_SMALL_BUFFER: bun_core::RacyCell<[u8; 16 * 1024]> =
    bun_core::RacyCell::new([0; 16 * 1024]);

/// Accessors for the HTTP-thread-only `RacyCell` scratch buffers.
///
/// INVARIANT: every caller is on the dedicated HTTP thread (the only thread
/// that runs `HTTPClient` methods after `on_start`), and each buffer is fully
/// overwritten before being read, so a fresh `&mut` here is the sole live
/// borrow. Centralised so the SAFETY argument lives in one place instead of
/// being repeated at every `&mut *X.get()` call site.
mod scratch {
    use super::*;
    #[inline]
    pub(super) fn request_headers() -> &'static mut [picohttp::Header; MAX_REQUEST_HEADERS] {
        // SAFETY: see module-level INVARIANT.
        unsafe { &mut *SHARED_REQUEST_HEADERS_BUF.get() }
    }
    #[inline]
    pub(super) fn response_headers() -> &'static mut [picohttp::Header; 256] {
        // SAFETY: see module-level INVARIANT.
        unsafe { &mut *SHARED_RESPONSE_HEADERS_BUF.get() }
    }
    #[inline]
    pub(super) fn single_packet_small_buffer() -> &'static mut [u8; 16 * 1024] {
        // SAFETY: see module-level INVARIANT.
        unsafe { &mut *SINGLE_PACKET_SMALL_BUFFER.get() }
    }
    #[inline]
    pub fn temp_hostname() -> &'static mut [u8; 8192] {
        // SAFETY: see module-level INVARIANT.
        unsafe { &mut *TEMP_HOSTNAME.get() }
    }
}
pub use scratch::temp_hostname;

// ── ALPN offer enum ─────────────────────────────────────────────────────
// PORT NOTE: Zig used `boringssl.SSL.AlpnOffer`; bun_boringssl doesn't yet
// expose one, so define it locally and TODO(b2) wire through to
// `configure_http_client_with_alpn` once that lands.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AlpnOffer {
    H1,
    H2Only,
    H1OrH2,
}

/// Port of `BoringSSL.SSL.configureHTTPClientWithALPN` (boringssl.zig:19066).
/// Sets SNI (when `hostname` is non-empty), the legacy-server-connect option,
/// the ALPN protocol list for `offer`, and enables SCT/OCSP stapling. Called
/// from `on_open` for every TLS socket — must run even when the hostname is an
/// IP literal (with empty SNI) so ALPN is still advertised.
pub fn configure_http_client_with_alpn(
    ssl: *mut boringssl::c::SSL,
    hostname: *const core::ffi::c_char,
    offer: AlpnOffer,
) {
    // SAFETY: caller passes a live *mut SSL for a just-opened socket; `hostname`
    // is either null or a NUL-terminated buffer that outlives this call.
    unsafe {
        if !hostname.is_null() && *hostname != 0 {
            boringssl::c::SSL_set_tlsext_host_name(ssl, hostname);
        }
        boringssl::c::SSL_clear_options(ssl, boringssl::c::SSL_OP_LEGACY_SERVER_CONNECT);
        boringssl::c::SSL_set_options(ssl, boringssl::c::SSL_OP_LEGACY_SERVER_CONNECT);

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
        let rc = boringssl::c::SSL_set_alpn_protos(ssl, alpns.as_ptr(), alpns.len());
        debug_assert_eq!(rc, 0);

        boringssl::c::SSL_enable_signed_cert_timestamps(ssl);
        boringssl::c::SSL_enable_ocsp_stapling(ssl);
    }
}

// ── EntryList column accessors ──────────────────────────────────────────
use bun_http_types::ETag::HeaderEntryColumns;

impl<const SSL: bool> SocketTimeout for HttpSocket<SSL> {
    fn timeout(&self, seconds: c_uint) {
        uws::NewSocketHandler::<SSL>::timeout(self, seconds)
    }
    fn set_timeout_minutes(&self, minutes: c_uint) {
        uws::NewSocketHandler::<SSL>::set_timeout_minutes(self, minutes)
    }
    fn set_timeout(&self, seconds: c_uint) {
        uws::NewSocketHandler::<SSL>::set_timeout(self, seconds)
    }
}

/// Borrow the HTTP-thread abort tracker. PORTING.md §Global mutable state:
/// HTTP-thread-only, so the `&'static mut` is the unique live borrow at every
/// call site. Callers must not hold the result across a call that re-enters
/// this accessor (per-statement reborrow shape — same contract the prior
/// `*mut` API imposed, now centralized here so 5 call sites drop their
/// `unsafe` block).
#[inline]
pub(crate) fn abort_tracker() -> &'static mut ArrayHashMap<u32, uws::AnySocket> {
    // SAFETY: same single-thread invariant as http_thread(). Every call site
    // is a per-statement reborrow (audited in r3); no two `&mut` overlap.
    unsafe { (*SOCKET_ASYNC_HTTP_ABORT_TRACKER.get()).get_or_insert_with(ArrayHashMap::new) }
}

/// Returns the hostname to use for TLS SNI and certificate verification.
/// Priority: tls_props.server_name > client.hostname > client.url.hostname
/// The Host header value (client.hostname) may contain a port suffix which
/// must be stripped because it is not part of the DNS name in certificates.
fn get_tls_hostname<'c>(client: &'c HTTPClient<'_>, allow_proxy_url: bool) -> &'c [u8] {
    if allow_proxy_url {
        if let Some(proxy) = &client.http_proxy {
            return proxy.hostname;
        }
    }
    // Prefer the explicit TLS server_name (e.g. from Node.js servername option)
    if let Some(props) = &client.tls_props {
        let sn = props.get().server_name;
        if !sn.is_null() {
            // SAFETY: server_name is a NUL-terminated CStr owned by the
            // SSLConfig; `ffi::cstr` yields an unbound-lifetime borrow of that
            // C allocation, so `to_bytes()` already satisfies `'c` (tied to
            // `client.tls_props`) without a `(ptr,len)` round-trip.
            let sn_slice = unsafe { bun_core::ffi::cstr(sn) }.to_bytes();
            if !sn_slice.is_empty() {
                return sn_slice;
            }
        }
    }
    // client.hostname comes from the Host header and may include ":port"
    if let Some(host) = &client.hostname {
        return strip_port_from_host(host);
    }
    client.url.hostname
}

// ── support types ───────────────────────────────────────────────────────
enum PendingH2Resolution<'a> {
    /// ALPN selected h2; waiters attach onto this session.
    H2(&'a mut h2::ClientSession),
    /// Handshake completed and ALPN selected http/1.1. Waiters can be pinned
    /// to h1 (and force_http2 waiters failed) since the server has spoken.
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
/// CONNECT builder, which is intentional per the .zig specs — do not unify.
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

fn write_proxy_connect(writer: &mut Vec<u8>, client: &HTTPClient) -> Result<(), bun_core::Error> {
    let port: &[u8] = if client.url.get_port().is_some() {
        client.url.port
    } else if client.url.is_https() {
        b"443"
    } else {
        b"80"
    };
    writer.extend_from_slice(b"CONNECT ");
    writer.extend_from_slice(client.url.hostname);
    writer.extend_from_slice(b":");
    writer.extend_from_slice(port);
    writer.extend_from_slice(b" HTTP/1.1\r\n");

    writer.extend_from_slice(b"Host: ");
    writer.extend_from_slice(client.url.hostname);
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
) -> Result<(), bun_core::Error> {
    writer.extend_from_slice(request.method);
    // will always be http:// here, https:// needs CONNECT tunnel
    writer.extend_from_slice(b" http://");
    writer.extend_from_slice(client.url.hostname);
    // Only include the port in the absolute-form request URI when the
    // original URL had an explicit port. RFC 7230 §5.3.2 treats the default
    // port as redundant, and writing `:80`/`:443` here breaks proxies that
    // do strict Host/authority matching (e.g. Charles, mitmproxy). Matches
    // curl and Node.js `http.request` behavior.
    if client.url.get_port().is_some() {
        writer.extend_from_slice(b":");
        writer.extend_from_slice(client.url.port);
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

fn write_request(
    writer: &mut Vec<u8>,
    request: &picohttp::Request<'_>,
) -> Result<(), bun_core::Error> {
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
pub fn print_request(
    protocol: Protocol,
    request: &picohttp::Request<'_>,
    url: &[u8],
    ignore_insecure: bool,
    body: &[u8],
    curl: bool,
) {
    // TODO(port): Zig built a clone with `path = url` for the curl formatter.
    // picohttp::Request<'_> isn't `Clone`, so format the fields directly.
    if curl {
        let request_ = picohttp::Request {
            method: request.method,
            path: url,
            minor_version: request.minor_version,
            headers: request.headers,
            bytes_read: request.bytes_read,
        };
        Output::pretty_errorln(&format_args!("{}", request_.curl(ignore_insecure, body)));
    }

    let ver: &str = match protocol {
        Protocol::Http1_1 => "HTTP/1.1",
        Protocol::Http2 => "HTTP/2",
        Protocol::Http3 => "HTTP/3",
    };
    // TODO(port): pretty_fmt prefix elided pending Output::error_writer() in bun_core.
    Output::pretty_errorln(&format_args!(
        "> {} {} {}",
        ver,
        BStr::new(request.method),
        BStr::new(url),
    ));
    for header in request.headers {
        Output::pretty_errorln(&format_args!("> {}", header));
    }
    Output::flush();
}

#[cold]
fn print_response(response: &picohttp::Response<'_>) {
    Output::pretty_errorln(&format_args!("{}", response));
    Output::flush();
}

/// Write data to the socket (Just a error wrapper to easly handle amount written and error handling)
fn write_to_socket<const IS_SSL: bool>(
    socket: HttpSocket<IS_SSL>,
    data: &[u8],
) -> Result<usize, bun_core::Error> {
    let mut remaining = data;
    let mut total_written: usize = 0;
    while !remaining.is_empty() {
        let amount = socket.write(remaining);
        if amount < 0 {
            return Err(err!(WriteFailed));
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
) -> Result<usize, bun_core::Error> {
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

/// Zig: `BoringSSL.getCertErrorFromNo(error_no)` — maps an X509 verify code
/// onto a `bun_core::Error` whose name is the upper-snake Zig error-set tag
/// (e.g. `CERT_HAS_EXPIRED`). JS-side `error.code` matches on this exact
/// string, so do NOT substitute `X509_verify_cert_error_string` output here.
// PORT NOTE: constants are the BoringSSL `X509_V_ERR_*` values from
// `<openssl/x509.h>` (see boringssl.zig:17302-17370). Inlined as literals so
// this file doesn't grow a dep on a header-generated const set.
pub(crate) fn get_cert_error_from_no(error_no: i32) -> bun_core::Error {
    let name: &'static str = match error_no {
        0 => "OK", // X509_V_OK
        2 => "UNABLE_TO_GET_ISSUER_CERT",
        3 => "UNABLE_TO_GET_CRL",
        4 => "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
        5 => "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
        6 => "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
        7 => "CERT_SIGNATURE_FAILURE",
        8 => "CRL_SIGNATURE_FAILURE",
        9 => "CERT_NOT_YET_VALID",
        10 => "CERT_HAS_EXPIRED",
        11 => "CRL_NOT_YET_VALID",
        12 => "CRL_HAS_EXPIRED",
        13 => "ERROR_IN_CERT_NOT_BEFORE_FIELD",
        14 => "ERROR_IN_CERT_NOT_AFTER_FIELD",
        15 => "ERROR_IN_CRL_LAST_UPDATE_FIELD",
        16 => "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
        17 => "OUT_OF_MEM",
        18 => "DEPTH_ZERO_SELF_SIGNED_CERT",
        19 => "SELF_SIGNED_CERT_IN_CHAIN",
        20 => "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        21 => "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        22 => "CERT_CHAIN_TOO_LONG",
        23 => "CERT_REVOKED",
        24 => "INVALID_CA",
        25 => "PATH_LENGTH_EXCEEDED",
        26 => "INVALID_PURPOSE",
        27 => "CERT_UNTRUSTED",
        28 => "CERT_REJECTED",
        29 => "SUBJECT_ISSUER_MISMATCH",
        30 => "AKID_SKID_MISMATCH",
        31 => "AKID_ISSUER_SERIAL_MISMATCH",
        32 => "KEYUSAGE_NO_CERTSIGN",
        33 => "UNABLE_TO_GET_CRL_ISSUER",
        34 => "UNHANDLED_CRITICAL_EXTENSION",
        35 => "KEYUSAGE_NO_CRL_SIGN",
        36 => "UNHANDLED_CRITICAL_CRL_EXTENSION",
        37 => "INVALID_NON_CA",
        38 => "PROXY_PATH_LENGTH_EXCEEDED",
        39 => "KEYUSAGE_NO_DIGITAL_SIGNATURE",
        40 => "PROXY_CERTIFICATES_NOT_ALLOWED",
        41 => "INVALID_EXTENSION",
        42 => "INVALID_POLICY_EXTENSION",
        43 => "NO_EXPLICIT_POLICY",
        44 => "DIFFERENT_CRL_SCOPE",
        45 => "UNSUPPORTED_EXTENSION_FEATURE",
        46 => "UNNESTED_RESOURCE",
        47 => "PERMITTED_VIOLATION",
        48 => "EXCLUDED_VIOLATION",
        49 => "SUBTREE_MINMAX",
        50 => "APPLICATION_VERIFICATION",
        51 => "UNSUPPORTED_CONSTRAINT_TYPE",
        52 => "UNSUPPORTED_CONSTRAINT_SYNTAX",
        53 => "UNSUPPORTED_NAME_SYNTAX",
        54 => "CRL_PATH_VALIDATION_ERROR",
        56 => "SUITE_B_INVALID_VERSION",
        57 => "SUITE_B_INVALID_ALGORITHM",
        58 => "SUITE_B_INVALID_CURVE",
        59 => "SUITE_B_INVALID_SIGNATURE_ALGORITHM",
        60 => "SUITE_B_LOS_NOT_ALLOWED",
        61 => "SUITE_B_CANNOT_SIGN_P_384_WITH_P_256",
        62 => "HOSTNAME_MISMATCH",
        63 => "EMAIL_MISMATCH",
        64 => "IP_ADDRESS_MISMATCH",
        65 => "INVALID_CALL",
        66 => "STORE_LOOKUP",
        67 => "NAME_CONSTRAINTS_WITHOUT_SANS",
        _ => "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR",
    };
    bun_core::Error::from_name(name)
}

// ── HTTPClient field accessors ──────────────────────────────────────────
// The Zig struct stored raw pointers (`*MutableString`, `*ProxyTunnel`); the
// Rust struct uses `Option<NonNull<_>>`. These helpers centralize the unsafe
// deref so the state-machine bodies stay readable.
impl<'a> HTTPClient<'a> {
    #[inline]
    fn request_body(&self) -> &[u8] {
        // `request_body` is a `RawSlice` into `original_request_body` (sibling
        // field of `self`); the RawSlice invariant centralises the unsafe.
        self.state.request_body.slice()
    }
    #[inline]
    fn set_request_body(&mut self, slice: &[u8]) {
        self.state.request_body = bun_ptr::RawSlice::new(slice);
    }
    #[inline]
    fn body_out_str(&self) -> Option<&MutableString> {
        body_out::opt_mut(self.state.body_out_str).map(|b| &*b)
    }
    #[inline]
    fn body_out_str_mut(&mut self) -> Option<&mut MutableString> {
        body_out::opt_mut(self.state.body_out_str)
    }
    #[inline]
    fn proxy_tunnel_mut(&mut self) -> Option<&mut ProxyTunnel> {
        let raw = self.proxy_tunnel.as_ref().map(|p| p.as_ptr())?;
        Some(proxy_tunnel::raw_as_mut(raw))
    }
    /// Detach and release the proxy tunnel if one is attached. Replaces the
    /// open-coded `take → as_mut → shutdown → detach_and_deref` sequence.
    #[inline]
    fn close_proxy_tunnel(&mut self, shutdown: bool) {
        if let Some(t) = self.proxy_tunnel.take() {
            // `detach_socket` (formerly the first half of `detach_and_deref`)
            // must run before the strong ref is released so a refcount>1
            // tunnel keeps no dangling socket.
            let tunnel = proxy_tunnel::raw_as_mut(t.as_ptr());
            if shutdown {
                tunnel.shutdown();
            }
            tunnel.detach_socket();
            // Release the strong ref this client held (formerly the `deref`
            // half of `detach_and_deref`).
            t.deref();
        }
    }
    /// Common tail of `fail` / `fail_from_h2` / `complete_connecting_process`:
    /// build the result, reset request state, and dispatch the callback.
    /// Factored out so the borrowck reshape (`to_result()` borrows `&mut self`
    /// while the post-reset callback wants `&mut self.state` again) lives in
    /// one place instead of being open-coded with raw `(*this_ptr).field` at
    /// every fail site.
    fn dispatch_result_and_reset(&mut self, clear_proxy_tunneling: bool) {
        let callback = self.result_callback;
        // PORT NOTE: reshaped for borrowck — `to_result()`'s `body` field is a
        // `&mut MutableString` derived from a NonNull (caller-owned, disjoint
        // from `self`'s storage), but its lifetime is tied to `&mut self`.
        // Detach so the `state.reset()` reborrow below compiles.
        // SAFETY: `body_out_str` points at the caller-owned MutableString that
        // outlives this client. NOTE: `state.reset()` below DOES write through
        // that same allocation (`(*body_out_str).reset()`, InternalState.rs)
        // while `result.body` is a live `&'static mut` to it — this overlap is
        // pre-existing (the old open-coded `(*this_ptr).state.reset()` did the
        // same) and matches the Zig sequencing; the callback observes the
        // post-reset (empty) buffer. Do not read this comment as asserting
        // `result.body` and `state.reset()` are disjoint.
        let result = unsafe { self.to_result().detach_lifetime() };
        self.state.reset();
        if clear_proxy_tunneling {
            self.flags.proxy_tunneling = false;
        }
        callback.run(self.parent_async_http(), result);
    }
    #[inline]
    fn progress_node_mut(&mut self) -> Option<&mut bun_core::Progress::Node> {
        // SAFETY: progress_node is owned by the caller (e.g. `bun install`'s
        // Progress) and outlives this client.
        self.progress_node.map(|mut p| unsafe { p.as_mut() })
    }
    /// Common `progress.activate(); set_completed_items(n); maybe_refresh()`
    /// triple used at every body-chunk boundary. Centralises the raw deref of
    /// `progress.context` (a backref into the owning `Progress` whose `&mut`
    /// would alias the embedded `Node` — see `Progress::Node::context_ptr`).
    fn report_progress(&mut self, completed: usize) {
        if let Some(progress) = self.progress_node_mut() {
            progress.activate();
            progress.set_completed_items(completed);
            // SAFETY: `context` is a non-null backref to the owning Progress.
            // `&mut Progress` would alias the node tree (the Progress embeds
            // `root: Node`), so this stays a narrowly-scoped raw deref.
            unsafe { (*progress.context_ptr()).maybe_refresh() };
        }
    }
}

/// Module-private accessors for the caller-owned `body_out_str` buffer.
///
/// `state.body_out_str` is a `NonNull<MutableString>` set in `start()` to a
/// buffer owned by the request initiator (FetchTasklet/NetworkTask/…) that
/// strictly outlives the HTTPClient. The buffer is a separate heap allocation
/// from `HTTPClient`/`InternalState`, so a `&mut MutableString` derived here
/// never overlaps a `&mut self` on the client.
///
/// Centralising the SAFETY argument removes a dozen open-coded
/// `unsafe { p.as_mut() }` derefs at call sites.
pub(crate) mod body_out {
    use super::{MutableString, NonNull};

    /// Upgrade the body-out NonNull to `&mut MutableString`.
    /// INVARIANT (module): `p` was obtained from `state.body_out_str` (or its
    /// upstream source, `AsyncHTTP.response_buffer`, which `start()` forwards
    /// into `body_out_str`).
    #[inline]
    pub(crate) fn as_mut<'a>(mut p: NonNull<MutableString>) -> &'a mut MutableString {
        // SAFETY: see module-level invariant.
        unsafe { p.as_mut() }
    }
    /// `Option`-lifted [`as_mut`].
    #[inline]
    pub(super) fn opt_mut<'a>(p: Option<NonNull<MutableString>>) -> Option<&'a mut MutableString> {
        p.map(as_mut)
    }
    /// Snapshot the body buffer's contents by value (http.zig
    /// `const body = out_str.*`) so a following `state.reset()` doesn't
    /// deliver an empty body.
    #[inline]
    pub(super) fn take_list(p: Option<NonNull<MutableString>>) -> Option<Vec<u8>> {
        p.map(|p| core::mem::take(&mut as_mut(p).list))
    }
    /// Restore the body bytes that `state.reset()` cleared (http.zig
    /// `result.body.?.* = body`).
    #[inline]
    pub(super) fn restore_list(p: Option<NonNull<MutableString>>, v: Option<Vec<u8>>) {
        if let (Some(p), Some(v)) = (p, v) {
            as_mut(p).list = v;
        }
    }
}

// ───────────────────────────── impl HTTPClient ─────────────────────────────

impl<'a> HTTPClient<'a> {
    pub fn check_server_identity<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        cert_error: HTTPCertError,
        ssl_ptr: *mut boringssl::c::SSL,
        allow_proxy_url: bool,
    ) -> bool {
        if self.flags.reject_unauthorized {
            // SAFETY: ssl_ptr is a live *mut SSL while the TLS socket is open
            let cert_chain = unsafe { boringssl::c::SSL_get_peer_cert_chain(ssl_ptr) };
            if !cert_chain.is_null() {
                // SAFETY: cert_chain is a live STACK_OF(X509) owned by the SSL session; index 0 is in bounds when non-null is returned
                let x509 = unsafe { boringssl::c::sk_X509_value(cert_chain, 0) };
                if !x509.is_null() {
                    let hostname = get_tls_hostname(self, allow_proxy_url);

                    // check if we need to report the error (probably to `checkServerIdentity` was informed from JS side)
                    // this is the slow path
                    if self.signals.get(signals::Field::CertErrors) {
                        // clone the relevant data
                        // SAFETY: x509 is a live *mut X509 borrowed from cert_chain; null out-ptr requests size-only
                        let cert_size =
                            unsafe { boringssl::c::i2d_X509(x509, core::ptr::null_mut()) };
                        let mut cert = vec![0u8; usize::try_from(cert_size).expect("int cast")]
                            .into_boxed_slice();
                        let mut cert_ptr = cert.as_mut_ptr();
                        // SAFETY: x509 is live; cert_ptr points at a writable buffer of cert_size bytes
                        let result_size =
                            unsafe { boringssl::c::i2d_X509(x509, &raw mut cert_ptr) };
                        debug_assert!(result_size == cert_size);

                        self.state.certificate_info = Some(CertificateInfo {
                            cert,
                            hostname: Box::<[u8]>::from(hostname),
                            cert_error,
                        });

                        // we inform the user that the cert is invalid
                        let ctx = self.get_ssl_ctx::<IS_SSL>();
                        self.progress_update::<IS_SSL>(ctx, socket);
                        // continue until we are aborted or not
                        return true;
                    } else {
                        // we check with native code if the cert is valid
                        // fast path
                        // SAFETY: x509 is a live *mut X509 borrowed from cert_chain
                        if boringssl::check_x509_server_identity(unsafe { &mut *x509 }, hostname) {
                            return true;
                        }
                    }
                }
            }
            // SSL error so we fail the connection
            self.close_and_fail::<IS_SSL>(err!(ERR_TLS_CERT_ALTNAME_INVALID), socket);
            return false;
        }
        // we allow the connection to continue anyway
        true
    }

    pub fn register_abort_tracker<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if self.signals.aborted.is_some() {
            let any = if IS_SSL {
                uws::AnySocket::SocketTls(uws::SocketTLS::from_any(socket.socket))
            } else {
                uws::AnySocket::SocketTcp(uws::SocketTCP::from_any(socket.socket))
            };
            // SAFETY: HTTP-thread only; per-statement reborrow.
            let _ = abort_tracker().put(self.async_http_id, any);
        }
    }

    pub fn unregister_abort_tracker(&mut self) {
        if self.signals.aborted.is_some() {
            // SAFETY: HTTP-thread only; per-statement reborrow.
            let _ = abort_tracker().swap_remove(&self.async_http_id);
        }
    }

    pub fn on_open<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) -> Result<(), bun_core::Error> {
        if cfg!(debug_assertions) {
            if let Some(proxy) = &self.http_proxy {
                debug_assert!(IS_SSL == proxy.is_https());
            } else {
                debug_assert!(IS_SSL == self.url.is_https());
            }
        }
        self.register_abort_tracker::<IS_SSL>(socket);
        bun_core::scoped_log!(fetch, "Connected {} \n", BStr::new(self.url.href));

        // Arm the idle timer immediately so a stalled TLS handshake (server
        // accepts TCP but never answers ClientHello, or a NAT/middlebox silently
        // drops the flow under load) eventually fails with error.Timeout instead
        // of leaving the request — and for `bun install`, the whole process —
        // blocked in epoll_wait forever. Previously the first `set_timeout` call
        // was inside `on_writable`, which only runs *after* the handshake
        // completes. See https://github.com/oven-sh/bun/issues/30325.
        self.set_timeout(socket);

        if self.signals.get(signals::Field::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return Err(err!(ClientAborted));
        }

        if self.state.request_stage == RequestStage::Pending {
            self.state.request_stage = RequestStage::Opened;
        }

        if IS_SSL {
            // SAFETY: socket.get_native_handle() returns a valid *mut SSL on TLS sockets
            let ssl_ptr: *mut boringssl::c::SSL = socket
                .get_native_handle()
                .map(|p| p.cast())
                .unwrap_or(core::ptr::null_mut());
            // SAFETY: ssl_ptr is a live *mut SSL for the just-opened TLS socket
            if !ssl_ptr.is_null() && unsafe { boringssl::c::SSL_is_init_finished(ssl_ptr) } == 0 {
                let raw_hostname = get_tls_hostname(self, self.http_proxy.is_some());

                // Build a NUL-terminated SNI string only when the hostname is not an
                // IP literal (RFC 6066 forbids IP SNI). ALPN/SCT/OCSP must still be
                // configured regardless, so the helper is called unconditionally
                // below with `null` SNI in the IP case (http.zig:186-207).
                let mut owned: Vec<u8>; // drops on scope exit
                let host_z: *const core::ffi::c_char = if !strings::is_ip_address(raw_hostname) {
                    // SAFETY: TEMP_HOSTNAME only accessed from HTTP thread
                    let temp = scratch::temp_hostname();
                    if raw_hostname.len() < temp.len() {
                        temp[..raw_hostname.len()].copy_from_slice(raw_hostname);
                        temp[raw_hostname.len()] = 0;
                        temp.as_ptr().cast::<core::ffi::c_char>()
                    } else {
                        owned = Vec::with_capacity(raw_hostname.len() + 1);
                        owned.extend_from_slice(raw_hostname);
                        owned.push(0);
                        owned.as_ptr().cast::<core::ffi::c_char>()
                    }
                } else {
                    core::ptr::null()
                };

                configure_http_client_with_alpn(ssl_ptr, host_z, self.alpn_offer());
            }
        } else {
            self.first_call::<IS_SSL>(socket);
        }
        Ok(())
    }

    /// Whether to advertise "h2" in the TLS ALPN list. Restricted to request
    /// shapes the HTTP/2 path currently handles end-to-end (no proxy/Upgrade,
    /// no sendfile). Enabled by `--experimental-http2-fetch`, the
    /// `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT` env var, or
    /// `protocol: "http2"` on the fetch options.
    pub fn can_offer_h2(&self) -> bool {
        if self.flags.force_http1 {
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
            HTTPRequestBody::Sendfile(_)
        ) {
            return false;
        }
        self.flags.force_http2
            || EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.load(Ordering::Relaxed)
            || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT
                .get()
                .unwrap_or(false)
    }

    pub fn alpn_offer(&self) -> AlpnOffer {
        if !self.can_offer_h2() {
            return AlpnOffer::H1;
        }
        if self.flags.force_http2 {
            AlpnOffer::H2Only
        } else {
            AlpnOffer::H1OrH2
        }
    }

    /// Whether this request shape is eligible to *use* a cached Alt-Svc h3
    /// alternative (HTTPS, no proxy/unix-socket, no sendfile, not pinned to a
    /// specific protocol). When true, `start_()` consults `H3.AltSvc.lookup`
    /// before opening TCP.
    pub fn can_try_h3_alt_svc(&self) -> bool {
        if self.flags.force_http1 || self.flags.force_http2 {
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
            HTTPRequestBody::Sendfile(_)
        ) {
            return false;
        }
        h3_alt_svc_enabled()
    }

    pub fn first_call<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
            if self.flags.is_preconnect_only {
                self.on_preconnect::<IS_SSL>(socket);
                return;
            }
        }

        if IS_SSL {
            let ssl_ptr: *mut boringssl::c::SSL = socket
                .get_native_handle()
                .map(|p| p.cast())
                .unwrap_or(core::ptr::null_mut());
            let mut proto: *const u8 = core::ptr::null();
            let mut proto_len: c_uint = 0;
            // SAFETY: ssl_ptr is a live *mut SSL for this socket; out-params are
            // valid stack locals. `proto[0..proto_len]` is the slice ALPN wrote
            // (borrowed from the SSL session, valid while ssl_ptr is).
            let alpn = unsafe {
                boringssl::c::SSL_get0_alpn_selected(ssl_ptr, &raw mut proto, &raw mut proto_len);
                bun_core::ffi::slice(proto, proto_len as usize)
            };
            if alpn == b"h2" {
                bun_core::scoped_log!(fetch, "ALPN negotiated h2 {}", BStr::new(self.url.href));
                // PORT NOTE: `comptime is_ssl` made this arm `HttpSocket<true>`; in
                // Rust the const-generic isn't unified, so rebuild from the InternalSocket.
                let tls_socket = uws::SocketTLS::from_any(socket.socket);
                let ctx = self.get_ssl_ctx::<true>();
                // SAFETY: `create` returns a freshly-boxed session with refcount 1,
                // owned by the socket ext-data via `tag_as_h2`. The `&mut` is
                // unique here — no other access until `attach` returns.
                let session = unsafe { &mut *h2::ClientSession::create(ctx, tls_socket, self) };
                GenHttpContext::<true>::tag_as_h2(tls_socket, session);
                self.resolve_pending_h2(PendingH2Resolution::H2(session));
                session.attach(self);
                return;
            }
            self.flags.protocol = Protocol::Http1_1;
            self.resolve_pending_h2(PendingH2Resolution::H1);
            if self.flags.force_http2 {
                self.close_and_fail::<IS_SSL>(err!(HTTP2Unsupported), socket);
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
    pub fn retry_after_h2_coalesce(&mut self) {
        self.start_::<true>();
    }

    pub fn retry_from_h2(&mut self) {
        debug_assert!(self.h2.is_none());
        self.unregister_abort_tracker();
        self.flags.protocol = Protocol::Http1_1;
        self.h2_retries += 1;
        let body = core::mem::replace(
            &mut self.state.original_request_body,
            HTTPRequestBody::Bytes(b""),
        );
        let body_out = self.state.body_out_str.take().unwrap();
        self.state.reset();
        self.start(body, body_out::as_mut(body_out));
    }

    /// Called by the HTTP/2 session for stream-level termination (RST_STREAM,
    /// GOAWAY, abort, decode error). The socket stays up for sibling streams, so
    /// only the request fails.
    pub fn fail_from_h2(&mut self, err: bun_core::Error) {
        debug_assert!(self.h2.is_none());
        debug_assert!(self.h3.is_none());
        self.unregister_abort_tracker();
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            self.state.request_stage = RequestStage::Fail;
            self.state.response_stage = ResponseStage::Fail;
            self.state.fail = Some(err);
            self.state.stage = Stage::Fail;
            if self.flags.defer_fail_until_connecting_is_complete {
                return;
            }
            self.dispatch_result_and_reset(false);
        }
    }

    pub fn on_close<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        bun_core::scoped_log!(fetch, "Closed  {}\n", BStr::new(self.url.href));
        // the socket is closed, we need to unregister the abort tracker
        self.unregister_abort_tracker();

        if self.signals.get(signals::Field::Aborted) {
            self.fail(err!(Aborted));
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
        if in_progress {
            if self.state.is_chunked_encoding() {
                // Match the spec exactly: only the two trailer states mean
                // "all chunks consumed"; CHUNKED_IN_CHUNK_SIZE/EXT/CRLF mean
                // the body was truncated mid-stream and must fail.
                // 4 = CHUNKED_IN_TRAILERS_LINE_HEAD, 5 = CHUNKED_IN_TRAILERS_LINE_MIDDLE
                if matches!(self.state.chunked_decoder._state, 4 | 5) {
                    // ignore failure if we are in the middle of trailer headers, since we processed all the chunks and trailers are ignored
                    self.state.flags.received_last_chunk = true;
                    let ctx = self.get_ssl_ctx::<IS_SSL>();
                    self.progress_update::<IS_SSL>(ctx, socket);
                    return;
                }
                // here we are in the middle of a chunk so ECONNRESET is expected
            } else if self.state.content_length.is_none()
                && self.state.response_stage == ResponseStage::Body
            {
                // no content length informed so we are done here
                self.state.flags.received_last_chunk = true;
                let ctx = self.get_ssl_ctx::<IS_SSL>();
                self.progress_update::<IS_SSL>(ctx, socket);
                return;
            }
        }

        if self.allow_retry
            && self.method.is_idempotent()
            && self.state.response_stage != ResponseStage::Body
            && self.state.response_stage != ResponseStage::BodyChunk
        {
            self.allow_retry = false;
            // we need to retry the request, clean up the response message buffer and start again
            self.state.response_message_buffer = MutableString::default();
            let body = core::mem::replace(
                &mut self.state.original_request_body,
                HTTPRequestBody::Bytes(b""),
            );
            let body_out = self.state.body_out_str.take().unwrap();
            self.start(body, body_out::as_mut(body_out));
            return;
        }

        if in_progress {
            self.fail(err!(ConnectionClosed));
        }
    }

    pub fn on_timeout<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if self.flags.disable_timeout {
            return;
        }
        bun_core::scoped_log!(fetch, "Timeout  {}\n", BStr::new(self.url.href));
        // PORT NOTE: reshaped for borrowck — Zig used `defer terminateSocket(socket)`
        self.fail(err!(Timeout));
        GenHttpContext::<IS_SSL>::terminate_socket(socket);
    }

    pub fn on_connect_error(&mut self) {
        bun_core::scoped_log!(fetch, "onConnectError  {}\n", BStr::new(self.url.href));
        self.fail(err!(ConnectionRefused));
    }

    /// Get the buffer we use to write data to the network.
    ///
    /// For large files, we want to avoid extra network send overhead
    /// So we do two things:
    /// 1. Use a 32 KB stack buffer for small files
    /// 2. Use a 512 KB heap buffer for large files
    /// This only has an impact on http://
    ///
    /// On https://, we are limited to a 16 KB TLS record size.
    #[inline]
    fn get_request_body_send_buffer(&self) -> http_thread::RequestBodyBuffer {
        let actual_estimated_size =
            self.request_body().len() + self.estimated_request_header_byte_length();
        let estimated_size = if HTTPClient::is_https(self) {
            actual_estimated_size.min(MAX_TLS_RECORD_SIZE)
        } else {
            actual_estimated_size * 2
        };
        http_thread().get_request_body_send_buffer(estimated_size)
    }

    pub fn is_keep_alive_possible(&self) -> bool {
        if FeatureFlags::ENABLE_KEEPALIVE {
            // TODO keepalive for unix sockets
            if self.unix_socket_path.slice().len() > 0 {
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
    /// uses hostname orelse url.hostname (ProxyTunnel.zig:44). If a Host header
    /// override sets hostname != url.hostname, two requests to different IPs
    /// with the same Host header must NOT share a tunnel — they're physically
    /// connected to different servers. Hashing hostname here catches that.
    ///
    /// Per-header hashes are combined with wrapping add so insertion order
    /// doesn't matter and duplicate headers don't cancel to zero.
    pub fn proxy_auth_hash(&self) -> u64 {
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
            if !strings::eql_case_insensitive_ascii(sni, self.url.hostname, true) {
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
    pub fn get_ssl_ctx<const IS_SSL: bool>(&self) -> *mut GenHttpContext<IS_SSL> {
        // TODO(port): returns raw ptr because the global/Arc lifetimes differ;
        // Phase B should unify behind a borrow.
        if IS_SSL {
            if let Some(ctx) = self.custom_ssl_ctx.as_ref() {
                return ctx.as_ptr().cast::<GenHttpContext<IS_SSL>>();
            }
            (&raw mut http_thread().https_context).cast::<GenHttpContext<IS_SSL>>()
        } else {
            (&raw mut http_thread().http_context).cast::<GenHttpContext<IS_SSL>>()
        }
    }

    /// Upgrade a `*mut GenHttpContext<SSL>` (the value [`get_ssl_ctx`]
    /// produces and that `progress_update`/`do_redirect`/`on_data` thread
    /// through as a parameter) to `&mut`.
    ///
    /// INVARIANT: every value reaching here is one of two thread-owned,
    /// set-once non-null pointers — `&raw mut http_thread().http(s)_context`
    /// or the heap-boxed `custom_ssl_ctx` on which the client holds a strong
    /// intrusive ref — both live for the call. The context is a separate
    /// allocation from `HTTPClient`, so the returned `&mut` does not alias any
    /// `&self` borrow used to compute the call's other arguments.
    /// HTTP-thread-only — sole live `&mut`. Centralises the raw
    /// `(*ctx).release_socket(..)` deref open-coded at the three
    /// `release_socket` sites and the `resolve_pending_h2` upgrade.
    #[inline]
    fn ssl_ctx_mut<'c, const IS_SSL: bool>(
        ctx: *mut GenHttpContext<IS_SSL>,
    ) -> &'c mut GenHttpContext<IS_SSL> {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *ctx }
    }

    pub fn set_custom_ssl_ctx(&mut self, ctx: NonNull<HttpsContext>) {
        // Intrusive-refcounted: this fn takes ownership of one strong ref by
        // bumping it here (matches http.zig:821-825). Callers do NOT pre-bump.
        // SAFETY: ctx points at a live HttpsContext.
        let new_ref = unsafe { http_context::HTTPContextRc::<true>::init_ref(ctx.as_ptr()) };
        if let Some(old) = self.custom_ssl_ctx.replace(new_ref) {
            // Release the ref we previously held.
            old.deref();
        }
    }

    pub fn header_str(&self, ptr: StringPointer) -> &'a [u8] {
        // Reborrow at `'a` so the returned slice doesn't tie up `&self`.
        let buf: &'a [u8] = self.header_buf;
        &buf[ptr.offset as usize..][..ptr.length as usize]
    }

    pub fn build_request(&mut self, body_len: usize) -> picohttp::Request<'static> {
        let mut header_count: usize = 0;
        let header_entries = self.header_entries.slice();
        let header_names = header_entries.items_name();
        let header_values = header_entries.items_value();
        let request_headers_buf = scratch::request_headers();

        let mut override_accept_encoding = false;
        let mut override_accept_header = false;
        let mut override_host_header = false;
        let mut override_connection_header = false;
        let mut override_user_agent = false;
        let mut add_transfer_encoding = true;
        let mut original_content_length: Option<&[u8]> = None;

        // Reserve slots for default headers that may be appended after user headers
        // (Connection, User-Agent, Accept, Host, Accept-Encoding, Content-Length/Transfer-Encoding).
        const MAX_DEFAULT_HEADERS: usize = 6;
        const MAX_USER_HEADERS: usize = MAX_REQUEST_HEADERS - MAX_DEFAULT_HEADERS;

        for (i, head) in header_names.iter().enumerate() {
            let name = self.header_str(*head);
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
                    original_content_length = Some(self.header_str(header_values[i]));
                    continue;
                }
                h if h == hash_header_const(b"Connection") => {
                    if will_append {
                        override_connection_header = true;
                        let connection_value = self.header_str(header_values[i]);
                        if bun_core::strings::eql_case_insensitive_ascii_check_length(
                            connection_value,
                            b"close",
                        ) {
                            self.flags.disable_keepalive = true;
                        } else if bun_core::strings::eql_case_insensitive_ascii_check_length(
                            connection_value,
                            b"keep-alive",
                        ) {
                            self.flags.disable_keepalive = false;
                        }
                    }
                }
                h if h == hash_header_const(b"if-modified-since") => {
                    if self.flags.force_last_modified && self.if_modified_since.is_empty() {
                        // TODO(port): lifetime — borrows self.header_buf
                        // SAFETY: header_str() returns a slice into self.header_buf which outlives
                        // this client; lifetime is erased here only because Phase A forbids struct
                        // lifetime params. The borrow is valid for the life of `self`.
                        self.if_modified_since =
                            unsafe { bun_ptr::detach_lifetime(self.header_str(header_values[i])) };
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
                        let value = self.header_str(header_values[i]);
                        if !bun_core::strings::eql_any_case_insensitive_ascii(
                            value,
                            &[b"h2", b"h2c"],
                        ) {
                            self.flags.upgrade_state = HTTPUpgradeState::Pending;
                        }
                    }
                }
                h if h == hash_header_const(CHUNKED_ENCODED_HEADER.name()) => {
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
                picohttp::Header::new(name, self.header_str(header_values[i]));

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
                picohttp::Header::new(HOST_HEADER_NAME, self.url.host);
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
                // Zig http.zig:1051 — `std.fmt.bufPrint(&buf, "{d}", .{body_len}) catch "0"`.
                // 11-byte buf vs 64-bit usize: must fall back to "0" on
                // overflow (same latent bug as Zig), NOT panic.
                let value: &[u8] = match bun_core::fmt::buf_print(
                    &mut self.request_content_len_buf,
                    format_args!("{body_len}"),
                ) {
                    // SAFETY: borrows `self.request_content_len_buf` which lives for `self`.
                    Ok(s) => unsafe { bun_ptr::detach_lifetime(s) },
                    Err(_) => b"0",
                };
                request_headers_buf[header_count] =
                    picohttp::Header::new(CONTENT_LENGTH_HEADER_NAME, value);
                header_count += 1;
            }
        } else if let Some(content_length) = original_content_length {
            request_headers_buf[header_count] =
                picohttp::Header::new(CONTENT_LENGTH_HEADER_NAME, content_length);
            header_count += 1;
        }

        // SAFETY: every borrowed slice points into storage that outlives the
        // returned `Request` — `Method::as_str()` is `'static`; `url.pathname`
        // borrows `self.url` (lives for the client); `request_headers_buf` is
        // the per-HTTP-thread `SHARED_REQUEST_HEADERS_BUF` static. Return as
        // `'static` so callers don't pin `&mut self` for the rest of their fn.
        picohttp::Request {
            method: self.method.as_str().as_bytes(),
            path: unsafe { bun_ptr::detach_lifetime(self.url.pathname) },
            minor_version: 1,
            headers: unsafe { bun_ptr::detach_lifetime(&request_headers_buf[0..header_count]) },
            bytes_read: 0,
        }
    }

    pub fn do_redirect<const IS_SSL: bool>(
        &mut self,
        ctx: *mut GenHttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.do_redirect_multiplexed();
        }
        bun_core::scoped_log!(fetch, "doRedirect");
        if matches!(self.state.original_request_body, HTTPRequestBody::Stream(_)) {
            // handleResponseMetadata already rejected every non-303 status with a
            // stream body (RequestBodyNotReusable). Reaching here means the
            // redirect downgraded to GET with a null body; drop the streaming
            // flag so the follow-up request goes out without Transfer-Encoding,
            // and let state.reset() release the ThreadSafeStreamBuffer ref.
            self.flags.is_streaming_request_body = false;
        }

        // PORT NOTE: Zig deinit'd then assigned `.empty` here; the bitwise
        // `task.http.?.* = async_http.*` copy-back later overwrote the
        // JS-thread original's slice with `.empty`, so the buffer was freed
        // exactly once. The Rust port has no struct copy-back
        // (`sync_progress_from` skips owned fields) and the original retains
        // its own `Owned(Vec)` aliasing the same allocation (the HTTP-thread
        // clone was created via `ptr::read`). Dropping it here would
        // double-free when the original later runs `clear_data()`. Forget the
        // clone's view; the original is the sole owner.
        core::mem::forget(core::mem::take(&mut self.unix_socket_path));
        // TODO: what we do with stream body?
        let request_body: &[u8] = if self.state.flags.resend_request_body_on_redirect
            && matches!(self.state.original_request_body, HTTPRequestBody::Bytes(_))
        {
            match &self.state.original_request_body {
                HTTPRequestBody::Bytes(b) => b,
                _ => unreachable!(),
            }
        } else {
            b""
        };

        self.state.response_message_buffer = MutableString::default();

        // PORT NOTE: copy the NonNull, do NOT `.take()` — http.zig:1098 reads
        // `this.state.body_out_str.?` without clearing it, so the
        // TooManyRedirects `fail()` below still sees a populated body pointer.
        let body_out_str = self.state.body_out_str.unwrap();
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
        } else if self.state.request_stage == RequestStage::Done
            && self.is_keep_alive_possible()
            && !socket.is_closed_or_has_error()
        {
            // request_stage == .done: a 303 to a streaming POST can arrive before
            // the chunked upload's terminating 0\r\n\r\n is written. Pooling that
            // socket would let the next request's bytes land inside what the
            // server is still parsing as the previous chunked body.
            bun_core::scoped_log!(fetch, "Keep-Alive release in redirect");
            debug_assert!(!self.connected_url.hostname.is_empty());
            Self::ssl_ctx_mut(ctx).release_socket(
                socket,
                self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
                self.connected_url.hostname,
                self.connected_url.get_port_auto(),
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
        self.connected_url = URL::default();
        // connected_url was the last borrower of the previous hop's URL buffer
        // (handleResponseMetadata already repointed this.url at the new one).
        self.prev_redirect = Vec::new();

        // TODO: should this check be before decrementing the redirect count?
        // the current logic will allow one less redirect than requested
        if self.remaining_redirect_count == 0 {
            self.fail(err!(TooManyRedirects));
            return;
        }
        self.state.reset();
        bun_core::scoped_log!(fetch, "doRedirect state reset");
        // also reset proxy to redirect
        self.flags.proxy_tunneling = false;
        self.close_proxy_tunnel(false);
        self.flags.protocol = Protocol::Http1_1;

        self.start(
            HTTPRequestBody::Bytes(request_body),
            body_out::as_mut(body_out_str),
        );
    }

    /// **Not thread safe while request is in-flight**
    pub fn is_https(&self) -> bool {
        if let Some(proxy) = &self.http_proxy {
            return proxy.is_https();
        }
        self.url.is_https()
    }

    pub fn start(&mut self, body: HTTPRequestBody<'a>, body_out_str: &mut MutableString) {
        // TODO(port): body_out_str ownership — Zig stores *MutableString in state
        body_out_str.reset();

        debug_assert!(self.state.response_message_buffer.list.capacity() == 0);
        self.state = InternalState::init(body, body_out_str);

        if self.is_https() {
            self.start_::<true>();
        } else {
            self.start_::<false>();
        }
    }

    fn start_<const IS_SSL: bool>(&mut self) {
        self.unregister_abort_tracker();

        // mark that we are connecting
        self.flags.defer_fail_until_connecting_is_complete = true;
        // this will call .fail() if the connection fails in the middle of the function avoiding UAF with can happen when the connection is aborted
        // PORT NOTE: Zig `defer this.completeConnectingProcess()` cannot be a Drop guard here
        // (it needs `&mut self`, which would alias every other `self.*` call in the body),
        // so it is reshaped as an explicit `self.complete_connecting_process()` before each return.

        // TODO(port): allocator vtable identity check elided (no allocator param in Rust)

        // Aborted before connecting
        if self.signals.get(signals::Field::Aborted) {
            self.fail(err!(AbortedBeforeConnecting));
            self.complete_connecting_process();
            return;
        }

        // protocol: "http2" is documented as HTTPS-only (h2c is out of scope).
        // Every consumer of force_http2 is gated on `comptime is_ssl`, so without
        // this an http:// request would silently fall through to HTTP/1.1.
        if !IS_SSL {
            if self.flags.force_http2 {
                self.fail(err!(HTTP2Unsupported));
                self.complete_connecting_process();
                return;
            }
        }

        if IS_SSL {
            // Opportunistic Alt-Svc upgrade: a previous response from this origin
            // advertised `h3`, and the experimental flag is on. Don't touch
            // `flags.force_http3` — that's the user's explicit `protocol:"http3"`
            // choice and persists across redirects, whereas an Alt-Svc upgrade is
            // per-origin and a cross-origin redirect must re-evaluate from h1.
            // `doRedirectMultiplexed` resets `flags.protocol`, so the redirected
            // request lands back here with `force_http3` still false and consults
            // the cache for the new origin.
            if !self.flags.force_http3 && self.can_try_h3_alt_svc() {
                if let Some(alt_port) =
                    h3::AltSvc::lookup(self.url.hostname, self.url.get_port_auto())
                {
                    if let Some(ctx) = h3::ClientContext::get_or_create(http_thread().uws_loop) {
                        if !h3::ClientContext::as_mut(ctx).connect(
                            self,
                            self.url.hostname,
                            alt_port,
                        ) {
                            self.fail(err!(ConnectionRefused));
                        }
                        self.complete_connecting_process();
                        return;
                    }
                    // engine init failed: fall through to TCP
                }
            }
        }

        if self.flags.force_http3 {
            if !IS_SSL {
                self.fail(err!(HTTP3Unsupported));
                self.complete_connecting_process();
                return;
            }
            if self.http_proxy.is_some() || self.unix_socket_path.slice().len() > 0 {
                self.fail(err!(HTTP3Unsupported));
                self.complete_connecting_process();
                return;
            }
            let Some(ctx) = h3::ClientContext::get_or_create(http_thread().uws_loop) else {
                self.fail(err!(HTTP3Unsupported));
                self.complete_connecting_process();
                return;
            };
            if !h3::ClientContext::as_mut(ctx).connect(
                self,
                self.url.hostname,
                self.url.get_port_auto(),
            ) {
                self.fail(err!(ConnectionRefused));
            }
            self.complete_connecting_process();
            return;
        }

        let socket = match http_thread().connect::<IS_SSL>(self) {
            Ok(Some(s)) => s,
            Ok(None) => {
                // Coalesced onto an in-flight h2 connect; the leader will attach us
                // (or re-dispatch) once ALPN resolves.
                self.complete_connecting_process();
                return;
            }
            Err(err) => {
                // TODO(port): bun.handleErrorReturnTrace(err) — error traces not yet wired in Rust
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
            self.fail(err!(ConnectionClosed));
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
    ) -> Result<InitialRequestPayloadResult, bun_core::Error> {
        let mut request_body_buffer = self.get_request_body_send_buffer();
        // PORT NOTE: request_body_buffer drops at scope exit (was `defer .deinit()`)
        let mut temporary_send_buffer = request_body_buffer.to_array_list();
        // PORT NOTE: temporary_send_buffer drops at scope exit

        let writer = &mut temporary_send_buffer; // Vec<u8> impls bun_io::Write

        let request = self.build_request(self.state.original_request_body.len());

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
            // PERF(port): was raw ptr write into spare capacity + len bump
        }

        let to_send = &temporary_send_buffer[self.state.request_sent_len..];
        if cfg!(debug_assertions) {
            debug_assert!(!socket.is_shutdown());
            debug_assert!(!socket.is_closed());
        }
        let amount = write_to_socket::<IS_SSL>(socket, to_send)?;
        if IS_FIRST_CALL {
            if amount == 0 {
                // don't worry about it
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
                self.url.href,
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

        let has_sent_body = if matches!(self.state.original_request_body, HTTPRequestBody::Bytes(_))
        {
            self.request_body().is_empty()
        } else {
            false
        };

        Ok(InitialRequestPayloadResult {
            has_sent_headers,
            has_sent_body,
            try_sending_more_data: amount == to_send.len() && (!has_sent_body || !has_sent_headers),
        })
    }

    pub fn flush_stream<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        // only flush the stream if needed no additional data is being added
        self.write_to_stream::<IS_SSL>(socket, b"");
    }

    /// Write buffered data to the socket returning true if there is backpressure
    fn write_to_stream_using_buffer<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        buffer: &mut bun_io::StreamBuffer,
        data: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let to_send_len = buffer.slice().len();
        if to_send_len > 0 {
            let amount = write_to_socket::<IS_SSL>(socket, buffer.slice())?;
            self.state.request_sent_len += amount;
            buffer.cursor += amount;
            if amount < to_send_len {
                // we could not send all pending data so we need to buffer the extra data
                if !data.is_empty() {
                    let _ = buffer.write(data); // OOM/capacity: Zig aborts; port keeps fire-and-forget
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

    pub fn write_to_stream<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>, data: &[u8]) {
        bun_core::scoped_log!(fetch, "flushStream");
        // PORT NOTE: reshaped for borrowck — copy out the Copy bits we need
        // (`upgrade_state`, the stream-buffer NonNull, `ended`) so the
        // `&mut self.state.original_request_body` borrow is dropped before any
        // call that takes `&mut self`. The stream is re-borrowed only at the
        // `detach()` sites via `request_stream_detach`.
        let upgrade_state = self.flags.upgrade_state;
        let (stream_buffer_ptr, ended) = {
            let HTTPRequestBody::Stream(stream) = &mut self.state.original_request_body else {
                return;
            };
            let Some(buf) = stream.buffer else { return };
            (buf, stream.ended)
        };
        // ThreadSafeStreamBuffer is owned by the JS-side request body stream
        // and outlives this call (intrusive-refcounted; independent heap
        // allocation, so `&mut` here does not alias `self`). Route through the
        // shared `from_attached` accessor (one centralised unsafe).
        let stream_buffer = ThreadSafeStreamBuffer::from_attached(stream_buffer_ptr);
        if upgrade_state == HTTPUpgradeState::Pending {
            // cannot drain yet, upgrade is waiting for upgrade
            return;
        }
        let buffer = stream_buffer.acquire();
        let was_empty = buffer.is_empty() && data.is_empty();
        if was_empty && ended {
            // nothing is buffered and the stream is done so we just release and detach
            stream_buffer.release();
            self.request_stream_detach();
            if upgrade_state == HTTPUpgradeState::Upgraded {
                // for upgraded connections we need to shutdown the socket to signal the end of the connection
                // otherwise the client will wait forever for the connection to be closed
                socket.shutdown();
            }
            return;
        }

        // to simplify things here the buffer contains the raw data we just need to flush to the socket it
        // `write_to_stream_using_buffer` touches only `state.request_sent_len`,
        // disjoint from `original_request_body` and `stream_buffer`.
        let has_backpressure =
            match self.write_to_stream_using_buffer::<IS_SSL>(socket, buffer, data) {
                Ok(b) => b,
                Err(err) => {
                    // we got some critical error so we need to fail and close the connection
                    stream_buffer.release();
                    self.request_stream_detach();
                    self.close_and_fail::<IS_SSL>(err, socket);
                    return;
                }
            };

        if has_backpressure {
            // we have backpressure so just release the buffer and wait for onWritable
            stream_buffer.release();
        } else {
            if ended {
                // done sending everything so we can release the buffer and detach the stream
                self.state.request_stage = RequestStage::Done;
                stream_buffer.release();
                self.request_stream_detach();
                if upgrade_state == HTTPUpgradeState::Upgraded {
                    // for upgraded connections we need to shutdown the socket to signal the end of the connection
                    // otherwise the client will wait forever for the connection to be closed
                    socket.shutdown();
                }
            } else {
                // only report drain if we send everything and previous we had something to send
                if !was_empty {
                    stream_buffer.report_drain();
                }
                // release the buffer so main thread can use it to send more data
                stream_buffer.release();
            }
        }
    }

    /// Re-borrow `state.original_request_body` and detach the stream variant.
    /// Factored out so [`write_to_stream`] can drop its body borrow before
    /// calling `&mut self` methods, then re-acquire only for the detach.
    #[inline]
    fn request_stream_detach(&mut self) {
        if let HTTPRequestBody::Stream(stream) = &mut self.state.original_request_body {
            stream.detach();
        }
    }

    pub fn on_writable<const IS_FIRST_CALL: bool, const IS_SSL: bool>(
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

        if let Some(proxy) = self.proxy_tunnel_mut() {
            proxy.on_writable::<IS_SSL>(socket);
        }

        match self.state.request_stage {
            RequestStage::Pending | RequestStage::Headers | RequestStage::Opened => {
                bun_core::scoped_log!(fetch, "sendInitialRequestPayload");
                self.set_timeout(socket);
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
                        (matches!(self.state.original_request_body, HTTPRequestBody::Bytes(_))
                            && !self.request_body().is_empty())
                            || matches!(
                                self.state.original_request_body,
                                HTTPRequestBody::Sendfile(_) | HTTPRequestBody::Stream(_)
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
                self.set_timeout(socket);

                match &mut self.state.original_request_body {
                    HTTPRequestBody::Bytes(_) => {
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
                    HTTPRequestBody::Stream(_) => {
                        // flush without adding any new data
                        self.flush_stream::<IS_SSL>(socket);
                    }
                    HTTPRequestBody::Sendfile(sendfile) => {
                        if IS_SSL {
                            panic!(
                                "sendfile is only supported without SSL. This code should never have been reached!"
                            );
                        }

                        // PORT NOTE: sendfile.write() takes the raw fd, not the socket handle.
                        match sendfile.write(socket.fd()) {
                            crate::send_file::Status::Done => {
                                self.state.request_stage = RequestStage::Done;
                                return;
                            }
                            crate::send_file::Status::Err(err) => {
                                self.close_and_fail::<IS_SSL>(err, socket);
                                return;
                            }
                            crate::send_file::Status::Again => {
                                // PORT NOTE: mark_needs_more_for_sendfile is `const SSL=false`-only;
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
                if let Some(proxy_ptr) = self.proxy_tunnel.as_ref().map(|p| p.as_ptr()) {
                    // Detached upgrade so `&mut self` can be reborrowed below;
                    // the tunnel is a disjoint heap allocation (see
                    // `proxy_tunnel::raw_as_mut` INVARIANT).
                    let proxy = proxy_tunnel::raw_as_mut(proxy_ptr);
                    match &self.state.original_request_body {
                        HTTPRequestBody::Bytes(_) => {
                            self.set_timeout(socket);

                            let to_send = self.request_body();
                            // just wait and retry when onWritable! if closed internally will call proxy.onClose
                            let Ok(sent) = ProxyTunnel::write(proxy, to_send) else {
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
                        HTTPRequestBody::Stream(_) => {
                            self.flush_stream::<IS_SSL>(socket);
                        }
                        HTTPRequestBody::Sendfile(_) => {
                            panic!(
                                "sendfile is only supported without SSL. This code should never have been reached!"
                            );
                        }
                    }
                }
            }
            RequestStage::ProxyHeaders => {
                bun_core::scoped_log!(fetch, "send proxy headers");
                if let Some(proxy_ptr) = self.proxy_tunnel.as_ref().map(|p| p.as_ptr()) {
                    // Detached upgrade so `&mut self` can be reborrowed below;
                    // the tunnel is a disjoint heap allocation (see
                    // `proxy_tunnel::raw_as_mut` INVARIANT).
                    let proxy = proxy_tunnel::raw_as_mut(proxy_ptr);
                    self.set_timeout(socket);
                    // PERF(port): was stack-fallback alloc (16KB) — profile in Phase B
                    let mut temporary_send_buffer: Vec<u8> = Vec::with_capacity(16 * 1024);
                    let writer = &mut temporary_send_buffer;

                    let request = self.build_request(self.request_body().len());
                    if write_request(writer, &request).is_err() {
                        self.close_and_fail::<IS_SSL>(err!(OutOfMemory), socket);
                        return;
                    }

                    let headers_len = temporary_send_buffer.len();
                    if !self.request_body().is_empty()
                        && temporary_send_buffer.capacity() - temporary_send_buffer.len() > 0
                    {
                        let spare = temporary_send_buffer.capacity() - temporary_send_buffer.len();
                        let wrote = spare.min(self.request_body().len());
                        debug_assert!(wrote > 0);
                        temporary_send_buffer.extend_from_slice(&self.request_body()[0..wrote]);
                        // PERF(port): was raw ptr write into spare capacity + len bump
                    }

                    let to_send = &temporary_send_buffer[self.state.request_sent_len..];
                    if cfg!(debug_assertions) {
                        debug_assert!(!socket.is_shutdown());
                        debug_assert!(!socket.is_closed());
                    }
                    // just wait and retry when onWritable! if closed internally will call proxy.onClose
                    let Ok(amount) = ProxyTunnel::write(proxy, to_send) else {
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

                    let has_sent_body = self.request_body().is_empty();

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
                        debug_assert!(!self.request_body().is_empty());

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

    pub fn close_and_fail<const IS_SSL: bool>(
        &mut self,
        err: bun_core::Error,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(fetch, "closeAndFail: {:?}", err);
        GenHttpContext::<IS_SSL>::terminate_socket(socket);
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
        ProxyTunnel::start::<IS_SSL>(self, socket, ssl_options, start_payload);
    }

    #[inline]
    fn handle_short_read<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        socket: HttpSocket<IS_SSL>,
        needs_move: bool,
    ) {
        if needs_move {
            let to_copy = incoming_data;
            if !to_copy.is_empty() {
                // this one will probably be another chunk, so we leave a little extra room
                let _ = self.state.response_message_buffer.append(to_copy); // OOM/capacity: Zig aborts; port keeps fire-and-forget
            }
        }

        self.set_timeout(socket);
    }

    pub fn handle_on_data_headers<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: *mut GenHttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(
            fetch,
            "handleOnDataHeader data: {}",
            BStr::new(incoming_data)
        );
        // PORT NOTE: reshaped for borrowck — `to_read` aliases either
        // `incoming_data` or `self.state.response_message_buffer`; hold it as a
        // `RawSlice` (encapsulated outlives-holder backref, safe `.slice()`)
        // so subsequent `&mut self` calls don't trip the checker.
        let mut to_read = bun_ptr::RawSlice::new(incoming_data);
        macro_rules! to_read {
            () => {
                to_read.slice()
            };
        }
        let mut needs_move = true;
        if !self.state.response_message_buffer.list.is_empty() {
            // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
            let _ = self
                .state
                .response_message_buffer
                .append_slice_exact(incoming_data);
            to_read = bun_ptr::RawSlice::new(self.state.response_message_buffer.list.as_slice());
            needs_move = false;
        }

        loop {
            let mut amount_read: usize = 0;

            // we reset the pending_response each time wich means that on parse error this will be always be empty
            self.state.pending_response = Some(picohttp::Response::default());

            // minimal http/1.1 response is 16 bytes ("HTTP/1.1 200\r\n\r\n")
            // if less than 16 it will always be a ShortRead
            if to_read!().len() < 16 {
                bun_core::scoped_log!(fetch, "handleShortRead");
                self.handle_short_read::<IS_SSL>(incoming_data, socket, needs_move);
                return;
            }

            let shared_resp = scratch::response_headers();
            let response = match picohttp::Response::parse_parts(
                to_read!(),
                shared_resp,
                Some(&mut amount_read),
            ) {
                Ok(r) => r,
                Err(picohttp::ParseResponseError::ShortRead) => {
                    self.handle_short_read::<IS_SSL>(incoming_data, socket, needs_move);
                    return;
                }
                Err(e) => {
                    self.close_and_fail::<IS_SSL>(e.into(), socket);
                    return;
                }
            };

            // we save the successful parsed response
            // SAFETY: response borrows SHARED_RESPONSE_HEADERS_BUF / response_message_buffer,
            // both of which outlive this fn; widen to 'static for storage.
            // Rebind `response` to the detached `'static` copy so it no longer
            // borrows `to_read` (lets the `to_read` reassignment below pass
            // borrowck — `RawSlice::slice` ties output to `&to_read`).
            let response = unsafe { response.detach_lifetime() };
            self.state.pending_response = Some(response);

            let bytes_read =
                (usize::try_from(response.bytes_read).expect("int cast")).min(to_read.len());
            to_read = bun_ptr::RawSlice::new(&to_read.slice()[bytes_read..]);

            if response.status_code == 101 {
                if self.flags.upgrade_state == HTTPUpgradeState::None {
                    // we cannot upgrade to websocket because the client did not request it!
                    self.close_and_fail::<IS_SSL>(err!(UnrequestedUpgrade), socket);
                    return;
                }
                // special case for websocket upgrade
                self.flags.upgrade_state = HTTPUpgradeState::Upgraded;
                self.signals
                    .store(signals::Field::Upgraded, true, Ordering::Relaxed);
                // start draining the request body
                self.flush_stream::<IS_SSL>(socket);
                break;
            }

            // handle the case where we have a 100 Continue
            if response.status_code >= 100 && response.status_code < 200 {
                bun_core::scoped_log!(fetch, "information headers");

                self.state.pending_response = None;
                if to_read!().is_empty() {
                    // we only received 1XX responses, we wanna wait for the next status code
                    return;
                }
                // the buffer could still contain more 1XX responses or other status codes, so we continue parsing
                continue;
            }

            break;
        }
        // pending_response is already `Option<Response<'static>>` (set just above).
        // NOTE: copy (Response is Copy), do NOT .take() — clone_metadata() below
        // requires pending_response to remain Some.
        let mut response: picohttp::Response<'static> = self.state.pending_response.unwrap();
        let should_continue = match self.handle_response_metadata(&mut response) {
            Ok(s) => s,
            Err(err) => {
                self.close_and_fail::<IS_SSL>(err, socket);
                return;
            }
        };
        // handle_response_metadata may mutate `response`; mirror it back so
        // clone_metadata() sees the up-to-date headers regardless of the
        // content-encoding branch below.
        self.state.pending_response = Some(response);

        if (self.state.content_encoding_i as usize) < response.headers.list.len()
            && !self.state.flags.did_set_content_encoding
        {
            // if it compressed with this header, it is no longer because we will decompress it
            // TODO(port): Zig wrapped headers in ArrayListUnmanaged but never mutated; preserved as-is
            self.state.flags.did_set_content_encoding = true;
            self.state.content_encoding_i = u8::MAX;
            // we need to reset the pending response because we removed a header
            self.state.pending_response = Some(response);
        }

        if should_continue == ShouldContinue::Finished {
            if self.state.flags.is_redirect_pending {
                self.do_redirect::<IS_SSL>(ctx, socket);
                return;
            }
            // this means that the request ended
            // clone metadata and return the progress at this point
            self.clone_metadata();
            // if is chuncked but no body is expected we mark the last chunk
            self.state.flags.received_last_chunk = true;
            // if is not we ignore the content_length
            self.state.content_length = Some(0);
            self.progress_update::<IS_SSL>(ctx, socket);
            return;
        }

        if self.flags.proxy_tunneling && self.proxy_tunnel.is_none() {
            // we are proxing we dont need to cloneMetadata yet
            self.start_proxy_handshake::<IS_SSL>(socket, to_read!());
            return;
        }

        // we have body data incoming so we clone metadata and keep going
        self.clone_metadata();

        if to_read!().is_empty() {
            // no body data yet, but we can report the headers
            if self.signals.get(signals::Field::HeaderProgress) {
                self.progress_update::<IS_SSL>(ctx, socket);
            }
            return;
        }

        if self.state.response_stage == ResponseStage::Body {
            let report_progress = match self.handle_response_body(to_read!(), true) {
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
            self.set_timeout(socket);
            let report_progress = match self.handle_response_body_chunked_encoding(to_read!()) {
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

    pub fn on_data<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: *mut GenHttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_core::scoped_log!(fetch, "onData {}", incoming_data.len());
        if self.signals.get(signals::Field::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return;
        }

        if self.proxy_tunnel.is_some() {
            // if we have a tunnel we dont care about the other stages, we will just tunnel the data
            self.set_timeout(socket);
            self.proxy_tunnel_mut().unwrap().receive(incoming_data);
            return;
        }

        match self.state.response_stage {
            ResponseStage::Pending | ResponseStage::Headers => {
                self.handle_on_data_headers::<IS_SSL>(incoming_data, ctx, socket);
            }
            ResponseStage::Body => {
                self.set_timeout(socket);

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
                self.set_timeout(socket);

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
                self.state.pending_response = None;
                self.close_and_fail::<IS_SSL>(err!(UnexpectedData), socket);
                return;
            }
        }
    }

    pub fn close_and_abort<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        self.close_and_fail::<IS_SSL>(err!(Aborted), socket);
    }

    fn complete_connecting_process(&mut self) {
        if self.flags.defer_fail_until_connecting_is_complete {
            self.flags.defer_fail_until_connecting_is_complete = false;
            if self.state.stage == Stage::Fail {
                self.dispatch_result_and_reset(true);
            }
        }
    }

    /// The leader of a coalesced cold connect has learned the ALPN outcome (or
    /// failed). Dispatch every waiter accordingly.
    fn resolve_pending_h2(&mut self, mut resolution: PendingH2Resolution<'_>) {
        let Some(pc_ptr) = self.pending_h2.take() else {
            return;
        };
        // `pc_ptr` is a backref into the context's `pending_h2_connects` Vec,
        // set in `HTTPContext::connect`; unregister_from swaps the owning Box
        // out so we can iterate and drop it here.
        let Some(pc) = h2::PendingConnect::unregister_from(
            pc_ptr.as_ptr(),
            Self::ssl_ctx_mut(self.get_ssl_ctx::<true>()),
        ) else {
            return;
        };
        // pc drops at scope exit (was `defer pc.deinit()`)

        for waiter_ptr in pc.waiters.iter().copied() {
            let waiter = h2::PendingConnect::waiter_mut(waiter_ptr);
            if waiter.signals.get(signals::Field::Aborted) {
                waiter.fail(err!(Aborted));
                continue;
            }
            match &mut resolution {
                PendingH2Resolution::H2(s) => s.enqueue(waiter),
                PendingH2Resolution::H1 => {
                    // ALPN selected http/1.1 on the leader's handshake; a
                    // force_http2 waiter would just open a fresh TLS connection
                    // and fail the same way, so fail it here instead of burning
                    // another handshake.
                    if waiter.flags.force_http2 {
                        waiter.fail(err!(HTTP2Unsupported));
                        continue;
                    }
                    // Pin to h1 so this `start_` doesn't register a fresh
                    // PendingConnect that the rest of this loop would re-coalesce
                    // onto (which would serialise N cold fetches into N
                    // sequential handshakes). The origin already chose h1 once.
                    waiter.flags.force_http1 = true;
                    waiter.start_::<true>();
                }
                // The first waiter becomes the new leader; the rest re-coalesce
                // onto it via the normal PendingConnect path.
                PendingH2Resolution::LeaderFailed => waiter.start_::<true>(),
            }
        }
    }

    fn fail(&mut self, err: bun_core::Error) {
        self.unregister_abort_tracker();
        self.resolve_pending_h2(PendingH2Resolution::LeaderFailed);

        self.close_proxy_tunnel(true);
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            self.state.request_stage = RequestStage::Fail;
            self.state.response_stage = ResponseStage::Fail;
            self.state.fail = Some(err);
            self.state.stage = Stage::Fail;

            if !self.flags.defer_fail_until_connecting_is_complete {
                self.dispatch_result_and_reset(true);
            }
        }
    }

    // We have to clone metadata immediately after use
    pub fn clone_metadata(&mut self) {
        debug_assert!(self.state.pending_response.is_some());
        // PORT NOTE: `Response<'static>` is `Copy`; bind by value so no borrow
        // of `self.state` is held across the `pending_response = None` write
        // below (Zig nulls it mid-block, which would trip borrowck on a `&`).
        if let Some(response) = self.state.pending_response {
            if let Some(old) = self.state.cloned_metadata.take() {
                drop(old); // deinit
            }
            let mut builder = picohttp::StringBuilder::default();
            response.count(&mut builder);
            builder.count(self.url.href);
            let _ = builder.allocate();
            // headers_buf is owned by the cloned_response (aka cloned_response.headers)
            // PORT NOTE: `Response::clone` ties its return lifetime to
            // `headers: &'a mut [Header]`; leak the box to obtain `'static` so
            // the cloned response can be stored in `HTTPResponseMetadata`.
            // Reclaimed by `Drop for HTTPResponseMetadata` (mirrors Zig
            // `deinit` freeing `response.headers.list`).
            let headers_buf = bun_core::heap::release(
                vec![picohttp::Header::ZERO; response.headers.list.len()].into_boxed_slice(),
            );
            let cloned_response = response.clone(headers_buf, &mut builder);

            // we clean the temporary response since cloned_metadata is now the owner
            self.state.pending_response = None;

            // SAFETY: `href` aliases `builder`'s heap buffer; ownership of that
            // buffer is transferred to `owned_buf` immediately below and stored
            // alongside `href` in `HTTPResponseMetadata`.
            let href = bun_ptr::RawSlice::new(unsafe { builder.append_raw(self.url.href) });
            // Transfer the single backing allocation out of the builder
            // (`builder.ptr.?[0..builder.cap]`) so its Drop becomes a no-op.
            let owned_buf = builder.move_to_slice();
            self.state.cloned_metadata = Some(HTTPResponseMetadata {
                owned_buf,
                response: cloned_response,
                url: href,
            });
        } else {
            // we should never clone metadata that dont exists
            // we added a empty metadata just in case but will hit the assert
            self.state.cloned_metadata = Some(HTTPResponseMetadata::default());
        }
    }

    pub fn set_timeout<S: SocketTimeout>(&self, socket: S) {
        // Duration comes from `IDLE_TIMEOUT_SECONDS` (tunable via
        // `BUN_CONFIG_HTTP_IDLE_TIMEOUT`, set low in tests) and is normalised once
        // in `HTTPThread::on_start` — clamped to the uSockets long-timer bound and
        // rounded up to a whole minute above 240s — so this is a plain
        // pass-through. `socket.set_timeout` picks the short-tick timer for values
        // ≤ 240s and the minute-granularity long timer above that, so the default
        // 300s maps to the same 5-minute long timer as before.
        if self.flags.disable_timeout || idle_timeout_seconds() == 0 {
            socket.set_timeout(0);
            return;
        }
        socket.set_timeout(idle_timeout_seconds());
    }

    pub fn drain_response_body<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
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

        let Some(body_out_str) = self.body_out_str() else {
            return;
        };
        if body_out_str.list.is_empty() {
            // No update! Don't do anything.
            return;
        }

        let ctx = self.get_ssl_ctx::<IS_SSL>();
        self.send_progress_update_without_stage_check::<IS_SSL>(ctx, socket);
    }

    fn send_progress_update_without_stage_check<const IS_SSL: bool>(
        &mut self,
        ctx: *mut GenHttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.send_progress_update_multiplexed();
        }
        // PORT NOTE: reshaped for borrowck — `to_result()` returns an
        // `HTTPClientResult<'_>` whose lifetime is tied to `&mut self` (via the
        // `body: &mut MutableString` borrow). Holding that result across the
        // `is_done` mutations below would require a second live `&mut Self`,
        // which PORTING.md §Forbidden flags as aliased `&mut`. Instead:
        // snapshot every owned/Copy field out of the result, drop it, mutate
        // `self` directly, then rebuild a fresh `HTTPClientResult` for the
        // callback from the snapshotted fields + the restored body.
        let body = self.state.body_out_str;
        // Snapshot the body buffer's CONTENTS by value (http.zig:2238-2239
        // `const body = out_str.*`) so that `state.reset()` — which calls
        // `body.reset()` and clears the list — doesn't deliver an empty body
        // when `is_done`. Restored below before the callback (http.zig:2307
        // `result.body.?.* = body`).
        let body_snapshot = body_out::take_list(body);
        let callback = self.result_callback;

        let (
            has_more,
            redirected,
            can_stream,
            is_http2,
            fail,
            metadata,
            body_size,
            certificate_info,
        ) = {
            let r = self.to_result();
            (
                r.has_more,
                r.redirected,
                r.can_stream,
                r.is_http2,
                r.fail,
                r.metadata,
                r.body_size,
                r.certificate_info,
            )
        }; // r (and its &mut borrow of self) dropped here
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
                self.state.request_stage == RequestStage::Done
                    && t.write_buffer.is_empty()
                    && t.wrapper
                        .as_ref()
                        .map(|w| !w.is_shutdown())
                        .unwrap_or(false)
            } else {
                true
            };

            // PORT NOTE (diverges from Zig): the same early-reply hazard
            // described above for tunnels applies to direct connections — a
            // server may answer (200, Content-Length: 0) before a large PUT
            // body has finished writing (e.g. S3 multipart UploadPart against
            // a mock that ignores req.body). Pooling that socket lets the next
            // request's bytes interleave with the previous body's tail on the
            // wire, which the server then mis-parses. The redirect path
            // (do_redirect) already gates on request_stage == Done for exactly
            // this reason; mirror that gate here for the non-redirect
            // completion path. `request_stage` alone is insufficient because
            // a fully-sent small request parks at `.body` (see on_writable),
            // so for byte-buffer bodies check the unsent slice instead.
            // Stream/Sendfile are left at Zig parity (they don't track an
            // unsent slice here).
            let request_side_drained = match &self.state.original_request_body {
                HTTPRequestBody::Bytes(_) => self.state.request_body.is_empty(),
                _ => true,
            };

            if self.is_keep_alive_possible()
                && !socket.is_closed_or_has_error()
                && tunnel_poolable
                && request_side_drained
            {
                bun_core::scoped_log!(fetch, "release socket");
                // Hand the client's strong ref straight to the pool: `release_socket`
                // either stores this `RefPtr` in the parked `PooledSocket` or
                // dereffs it if pooling fails.
                let tunnel = self.proxy_tunnel.take();
                if let Some(t) = &tunnel {
                    proxy_tunnel::raw_as_mut(t.as_ptr()).detach_owner(&*self);
                }
                let had_tunnel = tunnel.is_some();
                // target_hostname = url.hostname (the CONNECT TCP target at
                // writeProxyConnect line 346). The SNI override (hostname) is
                // hashed into proxyAuthHash separately — both must match, but
                // they're distinct values when a Host header override is set.
                Self::ssl_ctx_mut(ctx).release_socket(
                    socket,
                    self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
                    self.connected_url.hostname,
                    self.connected_url.get_port_auto(),
                    self.tls_props.as_ref(),
                    tunnel,
                    if had_tunnel { self.url.hostname } else { b"" },
                    if had_tunnel {
                        self.url.get_port_auto()
                    } else {
                        0
                    },
                    if had_tunnel {
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

        // Restore the body bytes that `state.reset()` cleared (http.zig:2307).
        body_out::restore_list(body, body_snapshot);
        let async_http = self.parent_async_http();
        // Rebuild the result from snapshotted fields now that all `&mut self`
        // mutations are finished — no aliased borrows remain.
        let result = HTTPClientResult {
            body: body_out::opt_mut(body),
            has_more,
            redirected,
            can_stream,
            is_http2,
            fail,
            metadata,
            body_size,
            certificate_info,
        };
        callback.run(async_http, result);

        if PRINT_EVERY > 0 {
            let i = PRINT_EVERY_I.fetch_add(1, Ordering::Relaxed) + 1;
            if i % PRINT_EVERY == 0 {
                Output::prettyln(format_args!("Heap stats for HTTP thread\n"));
                Output::flush();
                // PERF(port): MimallocArena dump_thread_stats — dropped (no DEFAULT_ARENA in Rust)
                PRINT_EVERY_I.store(0, Ordering::Relaxed);
            }
        }
    }

    /// `send_progress_update_without_stage_check` minus the per-request TCP socket
    /// release/close. Used by HTTP/2 and HTTP/3, whose session owns the
    /// transport, so there is no `ctx`/`socket` to hand back to the pool here.
    fn send_progress_update_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        // PORT NOTE: reshaped for borrowck — `to_result()` ties `result`'s
        // lifetime to `&mut self`, so holding it across the `is_done` mutations
        // would require a second live `&mut Self` (aliased UB). Instead snapshot
        // every owned/Copy field out of the result, drop it, mutate `self`
        // directly, then rebuild a fresh `HTTPClientResult` for the callback.
        // See send_progress_update_without_stage_check for the same pattern.
        let body = self.state.body_out_str;
        // Snapshot the body buffer's CONTENTS by value (http.zig:2326-2327
        // `const body = out_str.*`); restored below (http.zig:2340).
        let body_snapshot = body_out::take_list(body);
        let callback = self.result_callback;

        let (
            has_more,
            redirected,
            can_stream,
            is_http2,
            fail,
            metadata,
            body_size,
            certificate_info,
        ) = {
            let r = self.to_result();
            (
                r.has_more,
                r.redirected,
                r.can_stream,
                r.is_http2,
                r.fail,
                r.metadata,
                r.body_size,
                r.certificate_info,
            )
        }; // r (and its &mut borrow of self) dropped here
        let is_done = !has_more;
        bun_core::scoped_log!(fetch, "progressUpdate {}", is_done);
        if is_done {
            self.unregister_abort_tracker();
            self.state.reset();
            self.state.response_stage = ResponseStage::Done;
            self.state.request_stage = RequestStage::Done;
            self.state.stage = Stage::Done;
            self.flags.proxy_tunneling = false;
        }
        // Restore the body bytes that `state.reset()` cleared (http.zig:2340).
        body_out::restore_list(body, body_snapshot);
        let async_http = self.parent_async_http();
        // Rebuild the result from snapshotted fields now that all `&mut self`
        // mutations are finished — no aliased borrows remain.
        let result = HTTPClientResult {
            body: body_out::opt_mut(body),
            has_more,
            redirected,
            can_stream,
            is_http2,
            fail,
            metadata,
            body_size,
            certificate_info,
        };
        callback.run(async_http, result);
    }

    /// `do_redirect` minus the per-request socket release/close. The session
    /// detached the stream before calling this; `start()` re-enters the normal
    /// connect path for the redirect target.
    fn do_redirect_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        bun_core::scoped_log!(fetch, "doRedirectMultiplexed");
        if matches!(self.state.original_request_body, HTTPRequestBody::Stream(_)) {
            self.flags.is_streaming_request_body = false;
        }
        // See `do_redirect`: the HTTP-thread clone shares this allocation
        // with the JS-thread original (created via `ptr::read`); dropping it
        // here double-frees once the original runs `clear_data()`.
        core::mem::forget(core::mem::take(&mut self.unix_socket_path));
        let request_body: &[u8] = if self.state.flags.resend_request_body_on_redirect
            && matches!(self.state.original_request_body, HTTPRequestBody::Bytes(_))
        {
            match &self.state.original_request_body {
                HTTPRequestBody::Bytes(b) => b,
                _ => unreachable!(),
            }
        } else {
            b""
        };
        self.state.response_message_buffer = MutableString::default();
        // PORT NOTE: copy the NonNull, do NOT `.take()` — http.zig:2360 reads
        // `this.state.body_out_str.?` without clearing it, so the
        // TooManyRedirects `fail()` below still sees a populated body pointer.
        let body_out_str = self.state.body_out_str.unwrap();
        self.remaining_redirect_count = self.remaining_redirect_count.saturating_sub(1);
        self.flags.redirected = true;
        debug_assert!(self.redirect_type == FetchRedirect::Follow);
        self.unregister_abort_tracker();
        self.connected_url = URL::default();
        self.prev_redirect = Vec::new();
        if self.remaining_redirect_count == 0 {
            self.fail(err!(TooManyRedirects));
            return;
        }
        self.state.reset();
        self.flags.proxy_tunneling = false;
        self.flags.protocol = Protocol::Http1_1;
        // SAFETY: body_out_str points at the caller-owned MutableString.
        self.start(
            HTTPRequestBody::Bytes(request_body),
            body_out::as_mut(body_out_str),
        );
    }

    pub fn progress_update_h3(&mut self) {
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

    pub fn do_redirect_h3(&mut self) {
        debug_assert!(self.flags.protocol == Protocol::Http3);
        self.do_redirect_multiplexed();
    }

    pub fn progress_update<const IS_SSL: bool>(
        &mut self,
        ctx: *mut GenHttpContext<IS_SSL>,
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

    pub fn on_preconnect<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        bun_core::scoped_log!(fetch, "onPreconnect({})", BStr::new(self.url.href));
        self.unregister_abort_tracker();
        let ctx = self.get_ssl_ctx::<IS_SSL>();
        Self::ssl_ctx_mut(ctx).release_socket(
            socket,
            self.flags.did_have_handshaking_error && !self.flags.reject_unauthorized,
            self.url.hostname,
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
        self.result_callback.run(
            self.parent_async_http(),
            HTTPClientResult {
                fail: None,
                metadata: None,
                has_more: false,
                ..Default::default()
            },
        );
    }

    /// Intrusive backref: recover the AsyncHTTP that embeds this
    /// client. Returns the lifetime-erased pointer form expected by
    /// `HTTPClientResultCallback::run`.
    #[inline]
    fn parent_async_http(&mut self) -> *mut AsyncHTTP<'static> {
        // SAFETY: HTTPClient is always embedded as `client` field of AsyncHTTP
        unsafe {
            bun_core::from_field_ptr!(AsyncHTTP<'static>, client, std::ptr::from_mut::<Self>(self))
        }
    }

    pub fn to_result(&mut self) -> HTTPClientResult<'_> {
        let body_size: BodySize = if self.state.is_chunked_encoding() {
            BodySize::TotalReceived(self.state.total_body_received)
        } else if let Some(content_length) = self.state.content_length {
            BodySize::ContentLength(content_length)
        } else {
            BodySize::Unknown
        };

        let mut certificate_info: Option<CertificateInfo> = None;
        if let Some(info) = self.state.certificate_info.take() {
            // transfer owner ship of the certificate info here
            certificate_info = Some(info);
        } else if let Some(metadata) = self.state.cloned_metadata.take() {
            // transfer owner ship of the metadata here
            return HTTPClientResult {
                metadata: Some(metadata),
                body: body_out::opt_mut(self.state.body_out_str),
                redirected: self.flags.redirected,
                fail: self.state.fail,
                // check if we are reporting cert errors, do not have a fail state and we are not done
                has_more: certificate_info.is_some()
                    || (self.state.fail.is_none() && !self.state.is_done()),
                body_size,
                certificate_info: None,
                can_stream: (self.state.request_stage == RequestStage::Body
                    || self.state.request_stage == RequestStage::ProxyBody)
                    && self.flags.is_streaming_request_body,
                is_http2: self.flags.protocol != Protocol::Http1_1,
            };
        }
        HTTPClientResult {
            body: body_out::opt_mut(self.state.body_out_str),
            metadata: None,
            redirected: self.flags.redirected,
            fail: self.state.fail,
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

    pub fn handle_response_body(
        &mut self,
        incoming_data: &[u8],
        is_only_buffer: bool,
    ) -> Result<bool, bun_core::Error> {
        debug_assert!(self.state.transfer_encoding == Encoding::Identity);
        let content_length = self.state.content_length;
        // is it exactly as much as we need?
        if is_only_buffer
            && content_length.is_some()
            && incoming_data.len() >= content_length.unwrap()
        {
            self.handle_response_body_from_single_packet(
                &incoming_data[0..content_length.unwrap()],
            )?;
            Ok(true)
        } else {
            self.handle_response_body_from_multiple_packets(incoming_data)
        }
    }

    fn handle_response_body_from_single_packet(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<(), bun_core::Error> {
        if !self.state.is_chunked_encoding() {
            self.state.total_body_received += incoming_data.len();
            bun_core::scoped_log!(
                fetch,
                "handleResponseBodyFromSinglePacket {}",
                self.state.total_body_received
            );
        }
        // PORT NOTE: Zig `defer` block moved to end of fn (no early returns after this point that skip it)
        // we can ignore the body data in redirects
        if !self.state.flags.is_redirect_pending {
            if self.state.encoding.is_compressed() {
                let body_out = self.state.body_out_str.unwrap();
                self.state
                    .decompress_bytes(incoming_data, body_out::as_mut(body_out), true)?;
            } else {
                self.state
                    .get_body_buffer()
                    .append_slice_exact(incoming_data)?;
            }

            if self.state.response_message_buffer.owns(incoming_data) {
                if cfg!(debug_assertions) {
                    // i'm not sure why this would happen and i haven't seen it happen
                    // but we should check
                    debug_assert!(
                        self.state.get_body_buffer().list.as_ptr()
                            != self.state.response_message_buffer.list.as_ptr()
                    );
                }
                self.state.response_message_buffer = MutableString::default();
            }
        }

        self.report_progress(incoming_data.len());
        Ok(())
    }

    fn handle_response_body_from_multiple_packets(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<bool, bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — get_body_buffer() may return
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
        if is_done
            || self.signals.get(signals::Field::ResponseBodyStreaming)
            || content_length.is_none()
        {
            let is_final_chunk = is_done;
            // PORT NOTE: Zig passes `buffer.*` BY VALUE (http.zig:2614). Mirror that by
            // moving the body buffer's bytes out — process_body_buffer takes `&mut self.state`
            // and may mutate `compressed_body` (via decompress_bytes' reset) or `body_out_str`,
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
            return Ok(is_done || processed);
        }
        Ok(false)
    }

    pub fn handle_response_body_chunked_encoding(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<bool, bun_core::Error> {
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
    ) -> Result<bool, bun_core::Error> {
        // PORT NOTE: reshaped for borrowck — `chunked_decoder` and the body
        // buffer (`compressed_body` / `body_out_str`) are disjoint fields of
        // `self.state`, so borrow them once together via the split accessor and
        // operate on safe references. The Zig `var buffer = buffer_ptr.*` was a
        // shallow struct copy that aliased the same allocation; deep-cloning
        // here would diverge (mutations from process_body_buffer would be lost).
        let (decoder, body_buf) = self.state.chunked_decoder_and_body_buffer();
        body_buf.append_slice(incoming_data)?;

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        decoder.consume_trailer = 1;

        let mut bytes_decoded = incoming_data.len();
        // phr_decode_chunked mutates in-place
        // SAFETY: body_buf.list is initialized for [0..len()) and uniquely
        // borrowed here; the offset is len() - incoming_data.len() (the
        // just-appended tail), which is in bounds.
        let pret = unsafe {
            picohttp::phr_decode_chunked(
                &raw mut *decoder,
                body_buf
                    .list
                    .as_mut_ptr()
                    .add(body_buf.list.len().saturating_sub(incoming_data.len())),
                &raw mut bytes_decoded,
            )
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
            -1 => return Err(err!(InvalidHTTPResponse)),
            // Needs more data
            -2 => {
                self.report_progress(buffer_len);
                // streaming chunks
                if self.signals.get(signals::Field::ResponseBodyStreaming) {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;
                    // PORT NOTE: Zig passes the by-value struct copy (http.zig:2681). Move the
                    // bytes out so no `&` into self.state aliases the `&mut self.state` call.
                    let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
                    return self.state.process_body_buffer(buffer_snap, false);
                }

                return Ok(false);
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                // PORT NOTE: Zig passes the by-value struct copy (http.zig:2689). Move the
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
    ) -> Result<bool, bun_core::Error> {
        let small = scratch::single_packet_small_buffer();
        debug_assert!(incoming_data.len() <= small.len());

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        self.state.chunked_decoder.consume_trailer = 1;

        // Capture the length up front so no `&[u8]` aliases the live `&mut [u8]` below.
        let in_len = incoming_data.len();
        let buffer: &mut [u8] = if self.state.response_message_buffer.owns(incoming_data) {
            // if we've already copied the buffer once, we can avoid copying it again.
            // SAFETY: `incoming_data` is a subslice of `response_message_buffer.list`
            // (`owns` just verified). Zig does `@constCast(incoming_data)` (http.zig:2727),
            // but `incoming_data.as_ptr() as *mut u8` would carry SharedReadOnly provenance
            // (it came from a `&[u8]`) and writing through it is UB. Derive the mutable
            // slice from the owning Vec instead so the write has Unique provenance.
            let base = self.state.response_message_buffer.list.as_mut_ptr();
            let off = incoming_data.as_ptr() as usize - base as usize;
            unsafe { bun_core::ffi::slice_mut(base.add(off), in_len) }
        } else {
            small[0..in_len].copy_from_slice(incoming_data);
            &mut small[0..in_len]
        };

        let mut bytes_decoded = in_len;
        // phr_decode_chunked mutates in-place
        // SAFETY: `buffer` is an exclusive &mut [u8] of len == in_len; offset
        // len - in_len == 0 is trivially in bounds. `chunked_decoder` is a
        // disjoint field of `self.state` (no live borrow of `self` at this
        // point — `buffer` is raw-derived or borrows `small`).
        let pret = unsafe {
            picohttp::phr_decode_chunked(
                &raw mut self.state.chunked_decoder,
                buffer.as_mut_ptr().add(buffer.len().saturating_sub(in_len)),
                &raw mut bytes_decoded,
            )
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
            -1 => Err(err!(InvalidHTTPResponse)),
            // Needs more data
            -2 => {
                self.report_progress(buffer.len());
                self.state.get_body_buffer().append_slice_exact(buffer)?;

                // streaming chunks
                if self.signals.get(signals::Field::ResponseBodyStreaming) {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;

                    // PORT NOTE: Zig passes `body_buffer.*` BY VALUE (http.zig:2763). Move
                    // the bytes out so no `&` into self.state aliases the `&mut self.state`
                    // taken by process_body_buffer (which mutates compressed_body/body_out_str).
                    let buffer_snap = core::mem::take(&mut self.state.get_body_buffer().list);
                    return self.state.process_body_buffer(buffer_snap, true);
                }

                Ok(false)
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                self.handle_response_body_from_single_packet(buffer)?;
                debug_assert!(
                    self.body_out_str()
                        .map(|b| b.list.as_ptr())
                        .unwrap_or(core::ptr::null())
                        != buffer.as_ptr()
                );
                self.report_progress(buffer.len());

                Ok(true)
            }
        }
    }

    pub fn handle_response_metadata(
        &mut self,
        response: &mut picohttp::Response,
    ) -> Result<ShouldContinue, bun_core::Error> {
        let mut location: &[u8] = b"";
        let mut pretend_304 = false;
        let mut is_server_sent_events = false;
        for (header_i, header) in response.headers.list.iter().enumerate() {
            match hash_header_name(header.name()) {
                h if h == hash_header_const(b"Content-Length") => {
                    // byte-level parse — header.value() is network bytes, not &str
                    let content_length =
                        bun_core::parse_unsigned::<usize>(header.value(), 10).unwrap_or(0);
                    if self.method.has_body() {
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
                        if header.value() == b"gzip" {
                            self.state.encoding = Encoding::Gzip;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value() == b"deflate" {
                            self.state.encoding = Encoding::Deflate;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value() == b"br" {
                            self.state.encoding = Encoding::Brotli;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value() == b"zstd" {
                            self.state.encoding = Encoding::Zstd;
                            self.state.content_encoding_i = header_i as u8;
                        }
                    }
                }
                h if h == hash_header_const(b"Transfer-Encoding") => {
                    if header.value() == b"gzip" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Gzip;
                        }
                    } else if header.value() == b"deflate" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Deflate;
                        }
                    } else if header.value() == b"br" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Brotli;
                        }
                    } else if header.value() == b"zstd" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Zstd;
                        }
                    } else if header.value() == b"identity" {
                        self.state.transfer_encoding = Encoding::Identity;
                    } else if header.value() == b"chunked" {
                        self.state.transfer_encoding = Encoding::Chunked;
                    } else {
                        return Err(err!(UnsupportedTransferEncoding));
                    }
                }
                h if h == hash_header_const(b"Location") => {
                    location = header.value();
                }
                h if h == hash_header_const(b"Connection") => {
                    if response.status_code >= 200 && response.status_code <= 299 {
                        // HTTP headers are case-insensitive (RFC 7230)
                        if bun_core::strings::eql_case_insensitive_ascii_check_length(
                            header.value(),
                            b"close",
                        ) {
                            self.state.flags.allow_keepalive = false;
                        } else if bun_core::strings::eql_case_insensitive_ascii_check_length(
                            header.value(),
                            b"keep-alive",
                        ) {
                            self.state.flags.allow_keepalive = true;
                        }
                    }
                }
                h if h == hash_header_const(b"Last-Modified") => {
                    pretend_304 = self.flags.force_last_modified
                        && response.status_code > 199
                        && response.status_code < 300
                        && !self.if_modified_since.is_empty()
                        && self.if_modified_since == header.value();
                }
                h if h == hash_header_const(b"Alt-Svc") => {
                    // Record regardless of *this* request's shape — a future
                    // request to the same origin may be h3-eligible even if this
                    // one was pinned/proxied/sendfile.
                    if self.is_https()
                        && self.unix_socket_path.slice().len() == 0
                        && h3_alt_svc_enabled()
                    {
                        h3::AltSvc::record(
                            self.url.hostname,
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

        if self.flags.proxy_tunneling && self.proxy_tunnel.is_none() {
            if response.status_code == 200 {
                // signal to continue the proxing
                return Ok(ShouldContinue::ContinueStreaming);
            }

            // proxy denied connection so return proxy result (407, 403 etc)
            self.flags.proxy_tunneling = false;
            self.flags.disable_keepalive = true;
        }

        let status_code = response.status_code;

        if status_code == 407 {
            // If the request is being proxied and passes through the 407 status code, then let's also not do HTTP Keep-Alive.
            self.flags.disable_keepalive = true;
        }

        // if is no redirect or if is redirect == "manual" just proceed
        let is_redirect = status_code >= 300 && status_code <= 399;
        if is_redirect {
            if self.redirect_type == FetchRedirect::Follow
                && !location.is_empty()
                && self.remaining_redirect_count > 0
            {
                match status_code {
                    302 | 301 | 307 | 308 | 303 => {
                        // https://fetch.spec.whatwg.org/#http-redirect-fetch step 11:
                        // "If internalResponse's status is not 303, request's body
                        // is non-null, and request's body's source is null, then
                        // return a network error." A ReadableStream body has no
                        // source to replay from, so only 303 (which drops the body
                        // and switches to GET) may be followed.
                        if status_code != 303
                            && matches!(
                                self.state.original_request_body,
                                HTTPRequestBody::Stream(_)
                            )
                        {
                            return Err(err!(RequestBodyNotReusable));
                        }
                        let mut is_same_origin = true;

                        {
                            // PERF(port): was ArenaAllocator + stackFallback(4096) — profile in Phase B
                            if let Some(i) = strings::index_of(location, b"://") {
                                let mut string_builder = StringBuilder::default();

                                let is_protocol_relative = i == 0;
                                let protocol_name: &[u8] = if is_protocol_relative {
                                    self.url.display_protocol()
                                } else {
                                    &location[0..i]
                                };
                                let is_http = protocol_name == b"http";
                                if is_http || protocol_name == b"https" {
                                } else {
                                    return Err(err!(UnsupportedRedirectProtocol));
                                }

                                if (protocol_name.len() * usize::from(is_protocol_relative))
                                    + location.len()
                                    > MAX_REDIRECT_URL_LENGTH
                                {
                                    return Err(err!(RedirectURLTooLong));
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

                                if cfg!(debug_assertions) {
                                    debug_assert!(string_builder.cap == string_builder.len);
                                }

                                let input =
                                    BunString::borrow_utf8(string_builder.allocated_slice());
                                let normalized_url =
                                    OwnedString::new(bun_url::href_from_string(&input));
                                if normalized_url.tag() == BunStringTag::Dead {
                                    // URL__getHref failed, dont pass dead tagged string to toOwnedSlice.
                                    return Err(err!(RedirectURLInvalid));
                                }
                                let normalized_url_str = normalized_url.to_owned_slice();

                                // SAFETY: self-borrow — `normalized_url_str` is moved into
                                // `self.redirect` below, which lives as long as `self` (≥ `'a`).
                                let new_url: URL<'a> =
                                    unsafe { URL::parse(&normalized_url_str).erase_lifetime() };
                                is_same_origin = strings::eql_case_insensitive_ascii(
                                    strings::without_trailing_slash(new_url.origin),
                                    strings::without_trailing_slash(self.url.origin),
                                    true,
                                );
                                self.url = new_url;
                                // connected_url still borrows from the previous hop's buffer
                                // until doRedirect releases the socket, so park it in
                                // prev_redirect for doRedirect to free instead of leaking it.
                                debug_assert!(self.prev_redirect.is_empty());
                                self.prev_redirect =
                                    core::mem::replace(&mut self.redirect, normalized_url_str);
                            } else if location.starts_with(b"//") {
                                let mut string_builder = StringBuilder::default();

                                let protocol_name = self.url.display_protocol();

                                if protocol_name.len() + 1 + location.len()
                                    > MAX_REDIRECT_URL_LENGTH
                                {
                                    return Err(err!(RedirectURLTooLong));
                                }

                                let is_http = protocol_name == b"http";

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

                                if cfg!(debug_assertions) {
                                    debug_assert!(string_builder.cap == string_builder.len);
                                }

                                let input =
                                    BunString::borrow_utf8(string_builder.allocated_slice());
                                let normalized_url =
                                    OwnedString::new(bun_url::href_from_string(&input));
                                if normalized_url.tag() == BunStringTag::Dead {
                                    return Err(err!(RedirectURLInvalid));
                                }
                                let normalized_url_str = normalized_url.to_owned_slice();

                                // SAFETY: self-borrow — `normalized_url_str` is moved into
                                // `self.redirect` below, which lives as long as `self` (≥ `'a`).
                                let new_url: URL<'a> =
                                    unsafe { URL::parse(&normalized_url_str).erase_lifetime() };
                                is_same_origin = strings::eql_case_insensitive_ascii(
                                    strings::without_trailing_slash(new_url.origin),
                                    strings::without_trailing_slash(self.url.origin),
                                    true,
                                );
                                self.url = new_url;
                                debug_assert!(self.prev_redirect.is_empty());
                                self.prev_redirect =
                                    core::mem::replace(&mut self.redirect, normalized_url_str);
                            } else {
                                let original_url = self.url.clone();

                                let base = BunString::borrow_utf8(original_url.href);
                                let rel = BunString::borrow_utf8(location);
                                let new_url_ = OwnedString::new(bun_url::join(&base, &rel));

                                if new_url_.is_empty() {
                                    return Err(err!(InvalidRedirectURL));
                                }

                                let new_url = new_url_.to_owned_slice();
                                // SAFETY: self-borrow — `new_url` is moved into `self.redirect`
                                // below, which lives as long as `self` (≥ `'a`).
                                self.url = unsafe { URL::parse(&new_url).erase_lifetime() };
                                is_same_origin = strings::eql_case_insensitive_ascii(
                                    strings::without_trailing_slash(self.url.origin),
                                    strings::without_trailing_slash(original_url.origin),
                                    true,
                                );
                                debug_assert!(self.prev_redirect.is_empty());
                                self.prev_redirect =
                                    core::mem::replace(&mut self.redirect, new_url);
                            }
                        }

                        // If one of the following is true
                        // - internalResponse's status is 301 or 302 and request's method is `POST`
                        // - internalResponse's status is 303 and request's method is not `GET` or `HEAD`
                        // then:
                        if ((status_code == 301 || status_code == 302)
                            && self.method == Method::POST)
                            || (status_code == 303
                                && self.method != Method::GET
                                && self.method != Method::HEAD)
                        {
                            // - Set request's method to `GET` and request's body to null.
                            self.method = Method::GET;

                            // https://github.com/oven-sh/bun/issues/6053
                            if self.header_entries.len() > 0 {
                                // A request-body-header name is a header name that is a byte-case-insensitive match for one of:
                                // - `Content-Encoding`
                                // - `Content-Language`
                                // - `Content-Location`
                                // - `Content-Type`
                                const REQUEST_BODY_HEADER: [&[u8]; 3] = [
                                    b"Content-Encoding",
                                    b"Content-Language",
                                    b"Content-Location",
                                ];
                                let mut i: usize = 0;

                                // - For each headerName of request-body-header name, delete headerName from request's header list.
                                let mut len = self.header_entries.len();
                                'outer: while i < len {
                                    let names = self.header_entries.items_name();
                                    let name = self.header_str(names[i]);
                                    match name.len() {
                                        l if l == b"Content-Type".len() => {
                                            let hash = hash_header_name(name);
                                            if hash == hash_header_const(b"Content-Type") {
                                                let _ = self.header_entries.ordered_remove(i);
                                                len = self.header_entries.len();
                                                continue 'outer;
                                            }
                                        }
                                        l if l == b"Content-Encoding".len() => {
                                            let hash = hash_header_name(name);
                                            for hash_value in REQUEST_BODY_HEADER {
                                                if hash == hash_header_const(hash_value) {
                                                    let _ = self.header_entries.ordered_remove(i);
                                                    len = self.header_entries.len();
                                                    continue 'outer;
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                    i += 1;
                                }
                            }
                        }

                        // https://fetch.spec.whatwg.org/#concept-http-redirect-fetch
                        // If request's current URL's origin is not same origin with
                        // locationURL's origin, then for each headerName of CORS
                        // non-wildcard request-header name, delete headerName from
                        // request's header list.
                        if !is_same_origin && self.header_entries.len() > 0 {
                            struct H {
                                name: &'static [u8],
                                hash: u64,
                            }
                            // PORT NOTE: was a `const` table in Zig; LazyLock hashes
                            // aren't const, so build at runtime.
                            let headers_to_remove: [H; 3] = [
                                H {
                                    name: b"Authorization",
                                    hash: *AUTHORIZATION_HEADER_HASH,
                                },
                                H {
                                    name: b"Proxy-Authorization",
                                    hash: *PROXY_AUTHORIZATION_HEADER_HASH,
                                },
                                H {
                                    name: b"Cookie",
                                    hash: *COOKIE_HEADER_HASH,
                                },
                            ];
                            for to_remove in headers_to_remove.iter() {
                                let mut i = 0;
                                while i < self.header_entries.len() {
                                    let name = self.header_str(self.header_entries.items_name()[i]);
                                    if name.len() == to_remove.name.len()
                                        && hash_header_name(name) == to_remove.hash
                                    {
                                        let _ = self.header_entries.ordered_remove(i);
                                    } else {
                                        i += 1;
                                    }
                                }
                            }
                        }
                        self.state.flags.is_redirect_pending = true;
                        if self.method.has_request_body() {
                            self.state.flags.resend_request_body_on_redirect = true;
                        }
                    }
                    _ => {}
                }
            } else if self.redirect_type == FetchRedirect::Error {
                // error out if redirect is not allowed
                return Err(err!(UnexpectedRedirect));
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

        if self.method.has_body()
            && (content_length.is_none()
                || content_length.unwrap() > 0
                || !self.state.flags.allow_keepalive
                || self.state.transfer_encoding == Encoding::Chunked
                || is_server_sent_events)
        {
            Ok(ShouldContinue::ContinueStreaming)
        } else {
            Ok(ShouldContinue::Finished)
        }
    }
} // impl HTTPClient
