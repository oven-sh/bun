//! HTTP client (port of `src/http/http.zig`).
//! The Zig file is `const HTTPClient = @This();` — the whole module IS the
//! `HTTPClient` struct. In Rust the struct is named explicitly and free
//! functions become inherent methods on it.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bstr::BStr;

use bun_boringssl as boringssl;
use bun_collections::{ArrayHashMap, MutableString};
use bun_core::{self as bun, Environment, FeatureFlags, Global, Output, StringBuilder, err};
// TODO(b0): CommonAbortReason arrives in bun_http_types via move-in
// (TYPE_ONLY from bun_jsc::CommonAbortReason — enum(u8) only; toJS stays in jsc)
use bun_http_types::CommonAbortReason;
use bun_str::{self as strings, ZigString, ZStr};
// TODO(b0): bun_jsc::URL::{href_from_string, join} arrive in bun_url via move-in
// (MOVE_DOWN bun_jsc::URL → bun_url, shared with install/js_parser/bake)
use bun_url::URL;
use bun_uws as uws;
use bun_wyhash::{self, Wyhash};

use crate::async_http::AsyncHTTP;
use crate::certificate_info::CertificateInfo;
use crate::h2_client as h2;
use crate::h3_client as h3;
use crate::http_cert_error::HTTPCertError;
use crate::http_context::{HttpContext, HttpSocket, HttpsContext};
use crate::http_request_body::HTTPRequestBody;
use crate::http_thread::HTTPThread;
use crate::internal_state::InternalState;
use crate::proxy_tunnel::ProxyTunnel;
use crate::signals::Signals;
use bun_http_types::{Encoding, FetchRedirect, Method};
use bun_picohttp as picohttp;
use bun_schema::api;

bun_output::declare_scope!(fetch, visible);

// ───────────────────────────── re-exports ─────────────────────────────
pub use bun_http_types::{ETag, FetchCacheMode, FetchRequestMode, MimeType, URLPath};
pub use crate::async_http::AsyncHTTP as AsyncHTTPExport; // TODO(port): dedupe re-exports
pub use crate::certificate_info::CertificateInfo as CertificateInfoExport;
pub use crate::decompressor::Decompressor;
pub use crate::h2_client as H2;
pub use crate::h2_frame_parser as H2Wire;
pub use crate::h3_client as H3;
pub use crate::header_builder::HeaderBuilder;
pub use crate::header_value_iterator::HeaderValueIterator;
pub use crate::headers::Headers;
pub use crate::http_context::NewHTTPContext;
pub use crate::http_request_body::HTTPRequestBody as HTTPRequestBodyExport;
pub use crate::http_thread::HTTPThread as HTTPThreadExport;
pub use crate::init_error::InitError;
pub use crate::internal_state::InternalState as InternalStateExport;
pub use crate::send_file::SendFile;
pub use crate::signals::Signals as SignalsExport;
pub use crate::thread_safe_stream_buffer::ThreadSafeStreamBuffer;

// ───────────────────────────── globals ─────────────────────────────

pub static mut HTTP_THREAD: Option<HTTPThread> = None;

// TODO: this needs to be freed when Worker Threads are implemented
// TODO(port): static mutable map; wrap in proper sync primitive in Phase B
pub static mut SOCKET_ASYNC_HTTP_ABORT_TRACKER: Option<ArrayHashMap<u32, uws::AnySocket>> = None;
pub static ASYNC_HTTP_ID_MONOTONIC: AtomicU32 = AtomicU32::new(0);

/// Set once at startup from `--experimental-http2-fetch` (before the HTTP
/// thread spawns) and then only read on that thread, so no atomics needed.
pub static mut EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI: bool = false;
/// Set once at startup from `--experimental-http3-fetch`. Same threading
/// rules as the http2 flag.
pub static mut EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI: bool = false;

const MAX_REDIRECT_URL_LENGTH: usize = 128 * 1024;

#[unsafe(no_mangle)]
#[export_name = "BUN_DEFAULT_MAX_HTTP_HEADER_SIZE"]
pub static mut MAX_HTTP_HEADER_SIZE: usize = 16 * 1024;

pub static mut OVERRIDDEN_DEFAULT_USER_AGENT: &'static [u8] = b"";

const PRINT_EVERY: usize = 0;
static mut PRINT_EVERY_I: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
const MAX_REQUEST_HEADERS: usize = 256;
static mut SHARED_REQUEST_HEADERS_BUF: [picohttp::Header; MAX_REQUEST_HEADERS] =
    [picohttp::Header::ZERO; MAX_REQUEST_HEADERS];

// this doesn't need to be stack memory because it is immediately cloned after use
static mut SHARED_RESPONSE_HEADERS_BUF: [picohttp::Header; 256] = [picohttp::Header::ZERO; 256];

pub const END_OF_CHUNKED_HTTP1_1_ENCODING_RESPONSE_BODY: &[u8] = b"0\r\n\r\n";

pub static mut TEMP_HOSTNAME: [u8; 8192] = [0; 8192];

// ───────────────────────────── enums ─────────────────────────────

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
enum HTTPUpgradeState {
    #[default]
    None = 0,
    Pending = 1,
    Upgraded = 2,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default, strum::IntoStaticStr)]
pub enum Protocol {
    #[default]
    Http1_1 = 0,
    Http2 = 1,
    Http3 = 2,
}

// TODO(port): was `packed struct(u32)` with mixed bool + 2-bit enum fields.
// Kept as a plain struct since it never crosses FFI; restore packing in Phase B
// if the 32-byte vs 4-byte size difference shows up in profiling.
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

const DEFAULT_REDIRECT_COUNT: i8 = 127;

// ───────────────────────────── HTTPClient struct ─────────────────────────────

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
pub struct HTTPClient<'a> {
    pub method: Method,
    pub header_entries: crate::headers::EntryList,
    pub header_buf: &'static [u8], // TODO(port): lifetime — borrows external buffer
    pub url: URL,
    pub connected_url: URL,
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
    pub progress_node: Option<&'a mut bun_core::Progress::Node>,

    pub flags: Flags,

    pub state: InternalState,
    pub tls_props: Option<crate::ssl_config::SharedPtr>,
    /// The custom SSL context used for this request (None = default context).
    /// Set by HTTPThread.connect() when using custom TLS configs.
    pub custom_ssl_ctx: Option<Arc<HttpsContext>>,
    pub result_callback: HTTPClientResultCallback,

    /// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
    /// This is a workaround for that.
    pub if_modified_since: &'static [u8], // TODO(port): lifetime
    pub request_content_len_buf: [u8; b"-4294967295".len()],

    pub http_proxy: Option<URL>,
    pub proxy_headers: Option<Headers>,
    pub proxy_authorization: Option<Vec<u8>>,
    pub proxy_tunnel: Option<Arc<ProxyTunnel>>,
    /// Set when this request is bound to a stream on an HTTP/2 session.
    /// Owned by the session; cleared by the session when the stream completes.
    pub h2: Option<NonNull<h2::Stream>>,
    /// Set when this request is bound to an HTTP/3 stream. Owned by the H3
    /// session; cleared by the session when the stream completes.
    pub h3: Option<NonNull<h3::Stream>>,
    /// Set while this request is the leader of a fresh TLS connect that other
    /// h2-capable requests have coalesced onto. Resolved (and freed) once ALPN
    /// is known or the connect fails.
    pub pending_h2: Option<Box<h2::PendingConnect>>,
    pub signals: Signals,
    pub async_http_id: u32,
    // TODO(port): lifetime — set by AsyncHTTP, not freed here (Zig deinit never frees `hostname`)
    pub hostname: Option<&'static [u8]>,
    pub unix_socket_path: ZigString::Slice,
}

impl<'a> Drop for HTTPClient<'a> {
    fn drop(&mut self) {
        // redirect / prev_redirect are Vec<u8> — dropped automatically.
        // proxy_authorization: Option<Vec<u8>> — dropped automatically.
        // proxy_headers: Option<Headers> — dropped automatically.
        if let Some(tunnel) = self.proxy_tunnel.take() {
            tunnel.detach_and_deref();
        }
        // The session detaches `h2` before any terminal callback, so this should
        // be None by the time the result callback's deinit path runs.
        debug_assert!(self.h2.is_none());
        // tls_props: Option<SharedPtr> — Drop releases strong ref.
        // custom_ssl_ctx: Option<Arc<_>> — Drop derefs.
        self.unix_socket_path = ZigString::Slice::empty();
    }
}

// ───────────────────────────── free helpers ─────────────────────────────

/// Returns the hostname to use for TLS SNI and certificate verification.
/// Priority: tls_props.server_name > client.hostname > client.url.hostname
/// The Host header value (client.hostname) may contain a port suffix which
/// must be stripped because it is not part of the DNS name in certificates.
fn get_tls_hostname(client: &HTTPClient<'_>, allow_proxy_url: bool) -> &[u8] {
    if allow_proxy_url {
        if let Some(proxy) = &client.http_proxy {
            return proxy.hostname;
        }
    }
    // Prefer the explicit TLS server_name (e.g. from Node.js servername option)
    if let Some(props) = &client.tls_props {
        if let Some(sn) = props.get().server_name {
            let sn_slice = bun_str::slice_to_nul(sn);
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

/// Strips an optional port suffix from a host string (e.g. "example.com:443" -> "example.com").
/// Handles IPv6 bracket notation correctly (e.g. "[::1]:443" -> "[::1]").
fn strip_port_from_host(host: &[u8]) -> &[u8] {
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

fn write_proxy_connect(
    writer: &mut impl bun_io::Write,
    client: &HTTPClient<'_>,
) -> Result<(), bun_core::Error> {
    let port: &[u8] = if client.url.get_port().is_some() {
        client.url.port
    } else if client.url.is_https() {
        b"443"
    } else {
        b"80"
    };
    let _ = writer.write(b"CONNECT ");
    let _ = writer.write(client.url.hostname);
    let _ = writer.write(b":");
    let _ = writer.write(port);
    let _ = writer.write(b" HTTP/1.1\r\n");

    let _ = writer.write(b"Host: ");
    let _ = writer.write(client.url.hostname);
    let _ = writer.write(b":");
    let _ = writer.write(port);

    let _ = writer.write(b"\r\nProxy-Connection: Keep-Alive\r\n");

    // Check if user provided Proxy-Authorization in custom headers
    let user_provided_proxy_auth = client
        .proxy_headers
        .as_ref()
        .map(|hdrs| hdrs.get(b"proxy-authorization").is_some())
        .unwrap_or(false);

    // Only write auto-generated proxy_authorization if user didn't provide one
    if let Some(auth) = &client.proxy_authorization {
        if !user_provided_proxy_auth {
            let _ = writer.write(b"Proxy-Authorization: ");
            let _ = writer.write(auth);
            let _ = writer.write(b"\r\n");
        }
    }

    // Write custom proxy headers
    if let Some(hdrs) = &client.proxy_headers {
        let slice = hdrs.entries.slice();
        let names = slice.items_name();
        let values = slice.items_value();
        for (idx, name_ptr) in names.iter().enumerate() {
            let _ = writer.write(hdrs.as_str(*name_ptr));
            let _ = writer.write(b": ");
            let _ = writer.write(hdrs.as_str(values[idx]));
            let _ = writer.write(b"\r\n");
        }
    }

    let _ = writer.write(b"\r\n");
    Ok(())
}

fn write_proxy_request(
    writer: &mut impl bun_io::Write,
    request: &picohttp::Request,
    client: &HTTPClient<'_>,
) -> Result<(), bun_core::Error> {
    let _ = writer.write(request.method);
    // will always be http:// here, https:// needs CONNECT tunnel
    let _ = writer.write(b" http://");
    let _ = writer.write(client.url.hostname);
    // Only include the port in the absolute-form request URI when the
    // original URL had an explicit port. RFC 7230 §5.3.2 treats the default
    // port as redundant, and writing `:80`/`:443` here breaks proxies that
    // do strict Host/authority matching (e.g. Charles, mitmproxy). Matches
    // curl and Node.js `http.request` behavior.
    if client.url.get_port().is_some() {
        let _ = writer.write(b":");
        let _ = writer.write(client.url.port);
    }
    let _ = writer.write(request.path);
    let _ = writer.write(b" HTTP/1.1\r\nProxy-Connection: Keep-Alive\r\n");

    // Check if user provided Proxy-Authorization in custom headers
    let user_provided_proxy_auth = client
        .proxy_headers
        .as_ref()
        .map(|hdrs| hdrs.get(b"proxy-authorization").is_some())
        .unwrap_or(false);

    // Only write auto-generated proxy_authorization if user didn't provide one
    if let Some(auth) = &client.proxy_authorization {
        if !user_provided_proxy_auth {
            let _ = writer.write(b"Proxy-Authorization: ");
            let _ = writer.write(auth);
            let _ = writer.write(b"\r\n");
        }
    }

    // Write custom proxy headers
    if let Some(hdrs) = &client.proxy_headers {
        let slice = hdrs.entries.slice();
        let names = slice.items_name();
        let values = slice.items_value();
        for (idx, name_ptr) in names.iter().enumerate() {
            let _ = writer.write(hdrs.as_str(*name_ptr));
            let _ = writer.write(b": ");
            let _ = writer.write(hdrs.as_str(values[idx]));
            let _ = writer.write(b"\r\n");
        }
    }

    for header in request.headers {
        let _ = writer.write(header.name);
        let _ = writer.write(b": ");
        let _ = writer.write(header.value);
        let _ = writer.write(b"\r\n");
    }

    let _ = writer.write(b"\r\n");
    Ok(())
}

fn write_request(
    writer: &mut impl bun_io::Write,
    request: &picohttp::Request,
) -> Result<(), bun_core::Error> {
    let _ = writer.write(request.method);
    let _ = writer.write(b" ");
    let _ = writer.write(request.path);
    let _ = writer.write(b" HTTP/1.1\r\n");

    for header in request.headers {
        let _ = writer.write(header.name);
        let _ = writer.write(b": ");
        let _ = writer.write(header.value);
        let _ = writer.write(b"\r\n");
    }

    let _ = writer.write(b"\r\n");
    Ok(())
}

// lowercase hash header names so that we can be sure
pub fn hash_header_name(name: &[u8]) -> u64 {
    let mut hasher = Wyhash::init(0);
    let mut remain = name;
    // TODO(port): @sizeOf(@TypeOf(hasher.buf)) — Wyhash internal buffer size
    const WYHASH_BUF_LEN: usize = 48;
    let mut buf = [0u8; WYHASH_BUF_LEN];

    while !remain.is_empty() {
        let end = WYHASH_BUF_LEN.min(remain.len());
        hasher.update(strings::copy_lowercase_if_needed(&remain[0..end], &mut buf));
        remain = &remain[end..];
    }

    hasher.final_()
}

pub const fn hash_header_const(name: &[u8]) -> u64 {
    // TODO(port): this was a comptime fn in Zig calling Wyhash + lowerString.
    // Needs `const fn` Wyhash + ASCII lowercase in bun_wyhash. Stub for Phase B.
    let mut hasher = Wyhash::init(0);
    let mut remain = name;
    const WYHASH_BUF_LEN: usize = 48;
    let mut buf = [0u8; WYHASH_BUF_LEN];
    while !remain.is_empty() {
        let end = if WYHASH_BUF_LEN < remain.len() { WYHASH_BUF_LEN } else { remain.len() };
        // std.ascii.lowerString equivalent
        let mut i = 0;
        while i < end {
            buf[i] = remain[i].to_ascii_lowercase();
            i += 1;
        }
        hasher.update(&buf[0..end]);
        remain = &remain[end..];
    }
    hasher.final_()
}

// for each request we need this hashs, putting on top of the file to avoid exceeding comptime quota limit
const AUTHORIZATION_HEADER_HASH: u64 = hash_header_const(b"Authorization");
const PROXY_AUTHORIZATION_HEADER_HASH: u64 = hash_header_const(b"Proxy-Authorization");
const COOKIE_HEADER_HASH: u64 = hash_header_const(b"Cookie");

const HOST_HEADER_NAME: &[u8] = b"Host";
const CONTENT_LENGTH_HEADER_NAME: &[u8] = b"Content-Length";
const CHUNKED_ENCODED_HEADER: picohttp::Header =
    picohttp::Header { name: b"Transfer-Encoding", value: b"chunked" };
const CONNECTION_HEADER: picohttp::Header =
    picohttp::Header { name: b"Connection", value: b"keep-alive" };
const ACCEPT_HEADER: picohttp::Header = picohttp::Header { name: b"Accept", value: b"*/*" };

const ACCEPT_ENCODING_NO_COMPRESSION: &[u8] = b"identity";
const ACCEPT_ENCODING_COMPRESSION: &[u8] = b"gzip, deflate, br, zstd";
const ACCEPT_ENCODING_HEADER_COMPRESSION: picohttp::Header =
    picohttp::Header { name: b"Accept-Encoding", value: ACCEPT_ENCODING_COMPRESSION };
const ACCEPT_ENCODING_HEADER_NO_COMPRESSION: picohttp::Header =
    picohttp::Header { name: b"Accept-Encoding", value: ACCEPT_ENCODING_NO_COMPRESSION };

const ACCEPT_ENCODING_HEADER: picohttp::Header = if FeatureFlags::DISABLE_COMPRESSION_IN_HTTP_CLIENT {
    ACCEPT_ENCODING_HEADER_NO_COMPRESSION
} else {
    ACCEPT_ENCODING_HEADER_COMPRESSION
};

fn get_user_agent_header() -> picohttp::Header {
    // SAFETY: OVERRIDDEN_DEFAULT_USER_AGENT is set once at startup before HTTP thread spawns
    let ua = unsafe { OVERRIDDEN_DEFAULT_USER_AGENT };
    picohttp::Header {
        name: b"User-Agent",
        value: if !ua.is_empty() { ua } else { Global::USER_AGENT },
    }
}

const MAX_TLS_RECORD_SIZE: usize = 16 * 1024;

#[inline]
pub fn cleanup(_force: bool) {
    // PERF(port): was MimallocArena bulk-free — profile in Phase B
}

#[cfg(target_os = "linux")]
pub const SOCKET_FLAGS: u32 = bun_sys::SOCK_CLOEXEC | bun_sys::posix::MSG_NOSIGNAL;
#[cfg(not(target_os = "linux"))]
pub const SOCKET_FLAGS: u32 = bun_sys::SOCK_CLOEXEC;

pub const OPEN_SOCKET_FLAGS: u32 = bun_sys::SOCK_CLOEXEC;

pub const EXTREMELY_VERBOSE: bool = false;

/// REFUSED_STREAM or graceful GOAWAY past our id: the server promises it
/// did not process the request, so re-dispatch from the top. Only reached
/// for `.bytes` bodies (replayable).
pub const MAX_H2_RETRIES: u8 = 5;

/// Whether the experimental Alt-Svc-driven HTTP/3 upgrade is enabled at all
/// (CLI flag or env var). Used on its own to gate `H3.AltSvc.record` — a
/// response that arrived over a request shape h3 can't serve (proxy, sendfile,
/// `force_http1`) still carries an authoritative Alt-Svc for the origin.
pub fn h3_alt_svc_enabled() -> bool {
    // SAFETY: set once at startup before HTTP thread spawns
    unsafe { EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI }
        || bun_core::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT.get()
}

#[inline]
fn http_thread() -> &'static mut HTTPThread {
    // SAFETY: HTTP_THREAD is initialized before any HTTPClient runs and only
    // accessed from the single HTTP thread.
    unsafe { HTTP_THREAD.as_mut().expect("http_thread initialized") }
}

#[inline]
fn abort_tracker() -> &'static mut ArrayHashMap<u32, uws::AnySocket> {
    // SAFETY: same single-thread invariant as http_thread()
    unsafe { SOCKET_ASYNC_HTTP_ABORT_TRACKER.get_or_insert_with(ArrayHashMap::new) }
}

// ───────────────────────────── impl HTTPClient ─────────────────────────────

impl<'a> HTTPClient<'a> {
    pub fn check_server_identity<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        cert_error: HTTPCertError,
        ssl_ptr: *mut boringssl::SSL,
        allow_proxy_url: bool,
    ) -> bool {
        if self.flags.reject_unauthorized {
            // SAFETY: ssl_ptr is a live *mut SSL while the TLS socket is open
            if let Some(cert_chain) = unsafe { boringssl::SSL_get_peer_cert_chain(ssl_ptr) } {
                // SAFETY: cert_chain is a live STACK_OF(X509) owned by the SSL session; index 0 is in bounds when non-null is returned
                if let Some(x509) = unsafe { boringssl::sk_X509_value(cert_chain, 0) } {
                    let hostname = get_tls_hostname(self, allow_proxy_url);

                    // check if we need to report the error (probably to `checkServerIdentity` was informed from JS side)
                    // this is the slow path
                    if self.signals.get(Signals::CertErrors) {
                        // clone the relevant data
                        // SAFETY: x509 is a live *mut X509 borrowed from cert_chain; null out-ptr requests size-only
                        let cert_size = unsafe { boringssl::i2d_X509(x509, core::ptr::null_mut()) };
                        let mut cert =
                            vec![0u8; usize::try_from(cert_size).unwrap()].into_boxed_slice();
                        let mut cert_ptr = cert.as_mut_ptr();
                        // SAFETY: x509 is live; cert_ptr points at a writable buffer of cert_size bytes
                        let result_size = unsafe { boringssl::i2d_X509(x509, &mut cert_ptr) };
                        debug_assert!(result_size == cert_size);

                        self.state.certificate_info = Some(CertificateInfo {
                            cert,
                            hostname: Box::<[u8]>::from(hostname),
                            cert_error: HTTPCertError {
                                error_no: cert_error.error_no,
                                code: ZStr::from_bytes(cert_error.code),
                                reason: ZStr::from_bytes(cert_error.reason),
                            },
                        });

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
            self.close_and_fail::<IS_SSL>(err!(ERR_TLS_CERT_ALTNAME_INVALID), socket);
            return false;
        }
        // we allow the connection to continue anyway
        true
    }

    pub fn register_abort_tracker<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        if self.signals.aborted.is_some() {
            let any = if IS_SSL {
                uws::AnySocket::SocketTLS(socket.into())
            } else {
                uws::AnySocket::SocketTCP(socket.into())
            };
            abort_tracker().put(self.async_http_id, any).expect("unreachable");
        }
    }

    pub fn unregister_abort_tracker(&mut self) {
        if self.signals.aborted.is_some() {
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
        bun_output::scoped_log!(fetch, "Connected {} \n", BStr::new(self.url.href));

        if self.signals.get(Signals::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return Err(err!(ClientAborted));
        }

        if self.state.request_stage == RequestStage::Pending {
            self.state.request_stage = RequestStage::Opened;
        }

        if IS_SSL {
            // SAFETY: socket.get_native_handle() returns a valid *mut SSL on TLS sockets
            let ssl_ptr: *mut boringssl::SSL = socket.get_native_handle().cast();
            if unsafe { !(*ssl_ptr).is_init_finished() } {
                let raw_hostname = get_tls_hostname(self, self.http_proxy.is_some());

                let mut hostname: &ZStr = ZStr::EMPTY;
                let mut owned: Option<Box<ZStr>> = None; // drops on scope exit
                if !strings::is_ip_address(raw_hostname) {
                    // SAFETY: TEMP_HOSTNAME only accessed from HTTP thread
                    let temp = unsafe { &mut TEMP_HOSTNAME };
                    if raw_hostname.len() < temp.len() {
                        temp[..raw_hostname.len()].copy_from_slice(raw_hostname);
                        temp[raw_hostname.len()] = 0;
                        // SAFETY: temp[len] == 0 written above
                        hostname = unsafe { ZStr::from_raw(temp.as_ptr(), raw_hostname.len()) };
                    } else {
                        let z = ZStr::from_bytes(raw_hostname);
                        // TODO(port): hostname_needs_free pattern — owned ZStr drops at scope exit
                        owned = Some(z);
                        hostname = owned.as_deref().unwrap();
                    }
                }

                // SAFETY: ssl_ptr is a live *mut SSL for the just-opened TLS socket
                unsafe {
                    (*ssl_ptr).configure_http_client_with_alpn(hostname, self.alpn_offer());
                }
                let _ = owned;
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
        if self.unix_socket_path.length() > 0 {
            return false;
        }
        if matches!(self.state.original_request_body, HTTPRequestBody::Sendfile(_)) {
            return false;
        }
        self.flags.force_http2
            // SAFETY: set once at startup
            || unsafe { EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI }
            || bun_core::feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT.get()
    }

    pub fn alpn_offer(&self) -> boringssl::SSL::AlpnOffer {
        if !self.can_offer_h2() {
            return boringssl::SSL::AlpnOffer::H1;
        }
        if self.flags.force_http2 {
            boringssl::SSL::AlpnOffer::H2Only
        } else {
            boringssl::SSL::AlpnOffer::H1OrH2
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
        if self.unix_socket_path.length() > 0 {
            return false;
        }
        if matches!(self.state.original_request_body, HTTPRequestBody::Sendfile(_)) {
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
            let ssl_ptr: *mut boringssl::SSL = socket.get_native_handle().cast();
            let mut proto: *const u8 = core::ptr::null();
            let mut proto_len: c_uint = 0;
            // SAFETY: ssl_ptr is a live *mut SSL for this socket; out-params are valid stack locals
            unsafe { boringssl::SSL_get0_alpn_selected(ssl_ptr, &mut proto, &mut proto_len) };
            if !proto.is_null()
                && proto_len == 2
                // SAFETY: proto[0..proto_len] is the slice ALPN wrote; proto_len == 2 checked above
                && unsafe { *proto.add(0) } == b'h'
                // SAFETY: same — index 1 is in bounds (proto_len == 2)
                && unsafe { *proto.add(1) } == b'2'
            {
                bun_output::scoped_log!(fetch, "ALPN negotiated h2 {}", BStr::new(self.url.href));
                let ctx = self.get_ssl_ctx::<true>();
                let session = h2::ClientSession::create(ctx, socket, self);
                HttpContext::<true>::tag_as_h2(socket, session);
                self.resolve_pending_h2(PendingH2Resolution::H2(session));
                session.attach(self);
                return;
            }
            self.flags.protocol = Protocol::Http1_1;
            self.resolve_pending_h2(PendingH2Resolution::H1);
            if self.flags.force_http2 {
                self.close_and_fail::<true>(err!(HTTP2Unsupported), socket);
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
        self.start(body, body_out);
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
            let callback = self.result_callback;
            let result = self.to_result();
            self.state.reset();
            callback.run(self.parent_async_http(), result);
        }
    }

    pub fn on_close<const IS_SSL: bool>(&mut self, socket: HttpSocket<IS_SSL>) {
        bun_output::scoped_log!(fetch, "Closed  {}\n", BStr::new(self.url.href));
        // the socket is closed, we need to unregister the abort tracker
        self.unregister_abort_tracker();

        if self.signals.get(Signals::Aborted) {
            self.fail(err!(Aborted));
            return;
        }
        if let Some(tunnel) = self.proxy_tunnel.take() {
            // always detach the socket from the tunnel onClose (timeout, connectError will call fail that will do the same)
            tunnel.shutdown();
            tunnel.detach_and_deref();
        }
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
                match self.state.chunked_decoder.state {
                    picohttp::ChunkedState::InTrailersLineHead
                    | picohttp::ChunkedState::InTrailersLineMiddle => {
                        // ignore failure if we are in the middle of trailer headers, since we processed all the chunks and trailers are ignored
                        self.state.flags.received_last_chunk = true;
                        let ctx = self.get_ssl_ctx::<IS_SSL>();
                        self.progress_update::<IS_SSL>(ctx, socket);
                        return;
                    }
                    // here we are in the middle of a chunk so ECONNRESET is expected
                    _ => {}
                }
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

        if self.allow_retry {
            self.allow_retry = false;
            // we need to retry the request, clean up the response message buffer and start again
            self.state.response_message_buffer = MutableString::default();
            let body = core::mem::replace(
                &mut self.state.original_request_body,
                HTTPRequestBody::Bytes(b""),
            );
            let body_out = self.state.body_out_str.take().unwrap();
            self.start(body, body_out);
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
        bun_output::scoped_log!(fetch, "Timeout  {}\n", BStr::new(self.url.href));
        // PORT NOTE: reshaped for borrowck — Zig used `defer terminateSocket(socket)`
        self.fail(err!(Timeout));
        HttpContext::<IS_SSL>::terminate_socket(socket);
    }

    pub fn on_connect_error(&mut self) {
        bun_output::scoped_log!(fetch, "onConnectError  {}\n", BStr::new(self.url.href));
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
    fn get_request_body_send_buffer(&self) -> crate::http_thread::RequestBodyBuffer {
        let actual_estimated_size =
            self.state.request_body.len() + self.estimated_request_header_byte_length();
        let estimated_size = if self.is_https() {
            actual_estimated_size.min(MAX_TLS_RECORD_SIZE)
        } else {
            actual_estimated_size * 2
        };
        http_thread().get_request_body_send_buffer(estimated_size)
    }

    pub fn is_keep_alive_possible(&self) -> bool {
        if FeatureFlags::ENABLE_KEEPALIVE {
            // TODO keepalive for unix sockets
            if self.unix_socket_path.length() > 0 {
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
    pub fn get_ssl_ctx<const IS_SSL: bool>(&self) -> *mut HttpContext<IS_SSL> {
        // TODO(port): returns raw ptr because the global/Arc lifetimes differ;
        // Phase B should unify behind a borrow.
        if IS_SSL {
            if let Some(ctx) = &self.custom_ssl_ctx {
                return Arc::as_ptr(ctx) as *mut HttpContext<IS_SSL>;
            }
            (&mut http_thread().https_context) as *mut _ as *mut HttpContext<IS_SSL>
        } else {
            (&mut http_thread().http_context) as *mut _ as *mut HttpContext<IS_SSL>
        }
    }

    pub fn set_custom_ssl_ctx(&mut self, ctx: Arc<HttpsContext>) {
        // Arc clone == ref(); dropping old == deref()
        self.custom_ssl_ctx = Some(ctx);
    }

    pub fn header_str(&self, ptr: api::StringPointer) -> &[u8] {
        &self.header_buf[ptr.offset as usize..][..ptr.length as usize]
    }

    pub fn build_request(&mut self, body_len: usize) -> picohttp::Request {
        let mut header_count: usize = 0;
        let header_entries = self.header_entries.slice();
        let header_names = header_entries.items_name();
        let header_values = header_entries.items_value();
        // SAFETY: shared buffer only accessed from single HTTP thread
        let request_headers_buf = unsafe { &mut SHARED_REQUEST_HEADERS_BUF };

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
                        if connection_value.eq_ignore_ascii_case(b"close") {
                            self.flags.disable_keepalive = true;
                        } else if connection_value.eq_ignore_ascii_case(b"keep-alive") {
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
                        self.if_modified_since = unsafe {
                            core::mem::transmute::<&[u8], &'static [u8]>(
                                self.header_str(header_values[i]),
                            )
                        };
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
                        if !value.eq_ignore_ascii_case(b"h2")
                            && !value.eq_ignore_ascii_case(b"h2c")
                        {
                            self.flags.upgrade_state = HTTPUpgradeState::Pending;
                        }
                    }
                }
                h if h == hash_header_const(CHUNKED_ENCODED_HEADER.name) => {
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

            request_headers_buf[header_count] = picohttp::Header {
                name,
                value: self.header_str(header_values[i]),
            };

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
            request_headers_buf[header_count] = picohttp::Header {
                name: HOST_HEADER_NAME,
                value: self.url.host,
            };
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
                        request_headers_buf[header_count] = picohttp::Header {
                            name: CONTENT_LENGTH_HEADER_NAME,
                            value: content_length,
                        };
                        header_count += 1;
                    }
                    // If !add_transfer_encoding, the user explicitly set Transfer-Encoding,
                    // which was already added to request_headers_buf. We respect that and
                    // do not add Content-Length (they are mutually exclusive per HTTP/1.1).
                } else if add_transfer_encoding && self.flags.upgrade_state == HTTPUpgradeState::None
                {
                    request_headers_buf[header_count] = CHUNKED_ENCODED_HEADER;
                    header_count += 1;
                }
            } else {
                use std::io::Write;
                let buf = &mut self.request_content_len_buf;
                let mut cursor = &mut buf[..];
                let value: &[u8] = match write!(cursor, "{}", body_len) {
                    Ok(()) => {
                        let written = buf.len() - cursor.len();
                        // SAFETY: borrows self.request_content_len_buf which lives for self
                        unsafe { core::slice::from_raw_parts(buf.as_ptr(), written) }
                    }
                    Err(_) => b"0",
                };
                request_headers_buf[header_count] = picohttp::Header {
                    name: CONTENT_LENGTH_HEADER_NAME,
                    value,
                };
                header_count += 1;
            }
        } else if let Some(content_length) = original_content_length {
            request_headers_buf[header_count] = picohttp::Header {
                name: CONTENT_LENGTH_HEADER_NAME,
                value: content_length,
            };
            header_count += 1;
        }

        picohttp::Request {
            method: <&'static str>::from(self.method).as_bytes(),
            path: self.url.pathname,
            minor_version: 1,
            headers: &request_headers_buf[0..header_count],
        }
    }

    pub fn do_redirect<const IS_SSL: bool>(
        &mut self,
        ctx: *mut HttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.do_redirect_multiplexed();
        }
        bun_output::scoped_log!(fetch, "doRedirect");
        if matches!(self.state.original_request_body, HTTPRequestBody::Stream(_)) {
            // handleResponseMetadata already rejected every non-303 status with a
            // stream body (RequestBodyNotReusable). Reaching here means the
            // redirect downgraded to GET with a null body; drop the streaming
            // flag so the follow-up request goes out without Transfer-Encoding,
            // and let state.reset() release the ThreadSafeStreamBuffer ref.
            self.flags.is_streaming_request_body = false;
        }

        self.unix_socket_path = ZigString::Slice::empty();
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

        let body_out_str = self.state.body_out_str.take().unwrap();
        self.remaining_redirect_count = self.remaining_redirect_count.saturating_sub(1);
        self.flags.redirected = true;
        debug_assert!(self.redirect_type == FetchRedirect::Follow);
        self.unregister_abort_tracker();

        // By the time doRedirect runs, handleResponseMetadata has already mutated
        // this.url to the redirect destination. Pooling the tunnel here would
        // store it under the WRONG target hostname — a follow-up request to the
        // redirect destination could then reuse a TLS session negotiated with the
        // original host. Close the tunnel on redirect; only pool the raw socket.
        if let Some(tunnel) = self.proxy_tunnel.take() {
            bun_output::scoped_log!(fetch, "close the tunnel in redirect");
            tunnel.shutdown();
            tunnel.detach_and_deref();
            HttpContext::<IS_SSL>::close_socket(socket);
        } else if self.state.request_stage == RequestStage::Done
            && self.is_keep_alive_possible()
            && !socket.is_closed_or_has_error()
        {
            // request_stage == .done: a 303 to a streaming POST can arrive before
            // the chunked upload's terminating 0\r\n\r\n is written. Pooling that
            // socket would let the next request's bytes land inside what the
            // server is still parsing as the previous chunked body.
            bun_output::scoped_log!(fetch, "Keep-Alive release in redirect");
            debug_assert!(!self.connected_url.hostname.is_empty());
            // SAFETY: ctx points at the thread-owned HttpContext for the lifetime of this call
            unsafe {
                (*ctx).release_socket(
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
            }
        } else {
            HttpContext::<IS_SSL>::close_socket(socket);
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
        bun_output::scoped_log!(fetch, "doRedirect state reset");
        // also reset proxy to redirect
        self.flags.proxy_tunneling = false;
        if let Some(tunnel) = self.proxy_tunnel.take() {
            tunnel.detach_and_deref();
        }
        self.flags.protocol = Protocol::Http1_1;

        self.start(HTTPRequestBody::Bytes(request_body), body_out_str);
    }

    /// **Not thread safe while request is in-flight**
    pub fn is_https(&self) -> bool {
        if let Some(proxy) = &self.http_proxy {
            return proxy.is_https();
        }
        self.url.is_https()
    }

    pub fn start(&mut self, body: HTTPRequestBody, body_out_str: &mut MutableString) {
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
        let guard = scopeguard::guard((), |_| {
            // TODO(port): defer self.completeConnectingProcess() — captures &mut self;
            // reshaped below as explicit calls before each return.
        });
        // PORT NOTE: reshaped for borrowck — Zig `defer this.completeConnectingProcess()`
        // is called explicitly at every exit point instead.
        let _ = guard;

        // TODO(port): allocator vtable identity check elided (no allocator param in Rust)

        // Aborted before connecting
        if self.signals.get(Signals::Aborted) {
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
                    if let Some(ctx) = h3::ClientContext::get_or_create(http_thread().loop_.loop_) {
                        if !ctx.connect(self, self.url.hostname, alt_port) {
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
            if self.http_proxy.is_some() || self.unix_socket_path.length() > 0 {
                self.fail(err!(HTTP3Unsupported));
                self.complete_connecting_process();
                return;
            }
            let Some(ctx) = h3::ClientContext::get_or_create(http_thread().loop_.loop_) else {
                self.fail(err!(HTTP3Unsupported));
                self.complete_connecting_process();
                return;
            };
            if !ctx.connect(self, self.url.hostname, self.url.get_port_auto()) {
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
                bun_core::handle_error_return_trace(err);
                self.fail(err);
                self.complete_connecting_process();
                return;
            }
        };

        if socket.is_closed()
            && (self.state.response_stage != ResponseStage::Done
                && self.state.response_stage != ResponseStage::Fail)
        {
            HttpContext::<IS_SSL>::mark_socket_as_dead(socket);
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
        let request_body_buffer = self.get_request_body_send_buffer();
        // PORT NOTE: request_body_buffer drops at scope exit (was `defer .deinit()`)
        let mut temporary_send_buffer = request_body_buffer.to_array_list();
        // PORT NOTE: temporary_send_buffer drops at scope exit

        let writer = &mut temporary_send_buffer; // Vec<u8> impls bun_io::Write

        let request = self.build_request(self.state.original_request_body.len());

        if self.http_proxy.is_some() {
            if self.url.is_https() {
                bun_output::scoped_log!(fetch, "start proxy tunneling (https proxy)");
                // DO the tunneling!
                self.flags.proxy_tunneling = true;
                write_proxy_connect(writer, self)?;
            } else {
                bun_output::scoped_log!(fetch, "start proxy request (http proxy)");
                // HTTP do not need tunneling with CONNECT just a slightly different version of the request
                write_proxy_request(writer, &request, self)?;
            }
        } else {
            bun_output::scoped_log!(fetch, "normal request");
            write_request(writer, &request)?;
        }

        let headers_len = temporary_send_buffer.len();
        if !self.state.request_body.is_empty()
            && temporary_send_buffer.capacity() - temporary_send_buffer.len() > 0
            && !self.flags.proxy_tunneling
        {
            let spare = temporary_send_buffer.capacity() - temporary_send_buffer.len();
            let wrote = spare.min(self.state.request_body.len());
            debug_assert!(wrote > 0);
            temporary_send_buffer.extend_from_slice(&self.state.request_body[0..wrote]);
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
                self.state.request_body,
                self.verbose == HTTPVerboseLevel::Curl,
            );
        }

        if has_sent_headers && !self.state.request_body.is_empty() {
            self.state.request_body =
                &self.state.request_body[self.state.request_sent_len - headers_len..];
        }

        let has_sent_body = if matches!(self.state.original_request_body, HTTPRequestBody::Bytes(_))
        {
            self.state.request_body.is_empty()
        } else {
            false
        };

        Ok(InitialRequestPayloadResult {
            has_sent_headers,
            has_sent_body,
            try_sending_more_data: amount == to_send.len()
                && (!has_sent_body || !has_sent_headers),
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
        let to_send = buffer.slice();
        if !to_send.is_empty() {
            let amount = write_to_socket::<IS_SSL>(socket, to_send)?;
            self.state.request_sent_len += amount;
            buffer.cursor += amount;
            if amount < to_send.len() {
                // we could not send all pending data so we need to buffer the extra data
                if !data.is_empty() {
                    buffer.write(data);
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
        bun_output::scoped_log!(fetch, "flushStream");
        let HTTPRequestBody::Stream(stream) = &mut self.state.original_request_body else {
            return;
        };
        let Some(stream_buffer) = stream.buffer.as_ref() else {
            return;
        };
        if self.flags.upgrade_state == HTTPUpgradeState::Pending {
            // cannot drain yet, upgrade is waiting for upgrade
            return;
        }
        let buffer = stream_buffer.acquire();
        let was_empty = buffer.is_empty() && data.is_empty();
        if was_empty && stream.ended {
            // nothing is buffered and the stream is done so we just release and detach
            stream_buffer.release();
            stream.detach();
            if self.flags.upgrade_state == HTTPUpgradeState::Upgraded {
                // for upgraded connections we need to shutdown the socket to signal the end of the connection
                // otherwise the client will wait forever for the connection to be closed
                socket.shutdown();
            }
            return;
        }

        // to simplify things here the buffer contains the raw data we just need to flush to the socket it
        let has_backpressure =
            match self.write_to_stream_using_buffer::<IS_SSL>(socket, buffer, data) {
                Ok(b) => b,
                Err(err) => {
                    // we got some critical error so we need to fail and close the connection
                    stream_buffer.release();
                    stream.detach();
                    self.close_and_fail::<IS_SSL>(err, socket);
                    return;
                }
            };

        if has_backpressure {
            // we have backpressure so just release the buffer and wait for onWritable
            stream_buffer.release();
        } else {
            if stream.ended {
                // done sending everything so we can release the buffer and detach the stream
                self.state.request_stage = RequestStage::Done;
                stream_buffer.release();
                stream.detach();
                if self.flags.upgrade_state == HTTPUpgradeState::Upgraded {
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

    pub fn on_writable<const IS_FIRST_CALL: bool, const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.signals.get(Signals::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return;
        }

        if FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
            if self.flags.is_preconnect_only {
                self.on_preconnect::<IS_SSL>(socket);
                return;
            }
        }

        if let Some(proxy) = &self.proxy_tunnel {
            proxy.on_writable::<IS_SSL>(socket);
        }

        match self.state.request_stage {
            RequestStage::Pending | RequestStage::Headers | RequestStage::Opened => {
                bun_output::scoped_log!(fetch, "sendInitialRequestPayload");
                self.set_timeout(socket, 5);
                let result = match self
                    .send_initial_request_payload::<IS_FIRST_CALL, IS_SSL>(socket)
                {
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
                            && !self.state.request_body.is_empty())
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
                bun_output::scoped_log!(fetch, "send body");
                self.set_timeout(socket, 5);

                match &mut self.state.original_request_body {
                    HTTPRequestBody::Bytes(_) => {
                        let to_send = self.state.request_body;
                        if !to_send.is_empty() {
                            let sent = match write_to_socket::<IS_SSL>(socket, to_send) {
                                Ok(s) => s,
                                Err(err) => {
                                    self.close_and_fail::<IS_SSL>(err, socket);
                                    return;
                                }
                            };

                            self.state.request_sent_len += sent;
                            self.state.request_body = &self.state.request_body[sent..];
                        }

                        if self.state.request_body.is_empty() {
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
                            panic!("sendfile is only supported without SSL. This code should never have been reached!");
                        }

                        match sendfile.write(socket) {
                            crate::send_file::WriteResult::Done => {
                                self.state.request_stage = RequestStage::Done;
                                return;
                            }
                            crate::send_file::WriteResult::Err(err) => {
                                self.close_and_fail::<false>(err, socket);
                                return;
                            }
                            crate::send_file::WriteResult::Again => {
                                socket.mark_needs_more_for_sendfile();
                            }
                        }
                    }
                }
            }
            RequestStage::ProxyBody => {
                bun_output::scoped_log!(fetch, "send proxy body");
                if let Some(proxy) = self.proxy_tunnel.clone() {
                    match &self.state.original_request_body {
                        HTTPRequestBody::Bytes(_) => {
                            self.set_timeout(socket, 5);

                            let to_send = self.state.request_body;
                            // just wait and retry when onWritable! if closed internally will call proxy.onClose
                            let Ok(sent) = proxy.write(to_send) else { return };

                            self.state.request_sent_len += sent;
                            self.state.request_body = &self.state.request_body[sent..];

                            if self.state.request_body.is_empty() {
                                self.state.request_stage = RequestStage::Done;
                                return;
                            }
                        }
                        HTTPRequestBody::Stream(_) => {
                            self.flush_stream::<IS_SSL>(socket);
                        }
                        HTTPRequestBody::Sendfile(_) => {
                            panic!("sendfile is only supported without SSL. This code should never have been reached!");
                        }
                    }
                }
            }
            RequestStage::ProxyHeaders => {
                bun_output::scoped_log!(fetch, "send proxy headers");
                if let Some(proxy) = self.proxy_tunnel.clone() {
                    self.set_timeout(socket, 5);
                    // PERF(port): was stack-fallback alloc (16KB) — profile in Phase B
                    let mut temporary_send_buffer: Vec<u8> = Vec::with_capacity(16 * 1024);
                    let writer = &mut temporary_send_buffer;

                    let request = self.build_request(self.state.request_body.len());
                    if write_request(writer, &request).is_err() {
                        self.close_and_fail::<IS_SSL>(err!(OutOfMemory), socket);
                        return;
                    }

                    let headers_len = temporary_send_buffer.len();
                    if !self.state.request_body.is_empty()
                        && temporary_send_buffer.capacity() - temporary_send_buffer.len() > 0
                    {
                        let spare =
                            temporary_send_buffer.capacity() - temporary_send_buffer.len();
                        let wrote = spare.min(self.state.request_body.len());
                        debug_assert!(wrote > 0);
                        temporary_send_buffer
                            .extend_from_slice(&self.state.request_body[0..wrote]);
                        // PERF(port): was raw ptr write into spare capacity + len bump
                    }

                    let to_send = &temporary_send_buffer[self.state.request_sent_len..];
                    if cfg!(debug_assertions) {
                        debug_assert!(!socket.is_shutdown());
                        debug_assert!(!socket.is_closed());
                    }
                    // just wait and retry when onWritable! if closed internally will call proxy.onClose
                    let Ok(amount) = proxy.write(to_send) else { return };

                    if IS_FIRST_CALL {
                        if amount == 0 {
                            // don't worry about it
                            bun_output::scoped_log!(fetch, "is_first_call and amount == 0");
                            return;
                        }
                    }

                    self.state.request_sent_len += amount;
                    let has_sent_headers = self.state.request_sent_len >= headers_len;

                    if has_sent_headers && !self.state.request_body.is_empty() {
                        self.state.request_body =
                            &self.state.request_body[self.state.request_sent_len - headers_len..];
                    }

                    let has_sent_body = self.state.request_body.is_empty();

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
                        debug_assert!(!self.state.request_body.is_empty());

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
        bun_output::scoped_log!(fetch, "closeAndFail: {}", err.name());
        HttpContext::<IS_SSL>::terminate_socket(socket);
        self.fail(err);
    }

    fn start_proxy_handshake<const IS_SSL: bool>(
        &mut self,
        socket: HttpSocket<IS_SSL>,
        start_payload: &[u8],
    ) {
        bun_output::scoped_log!(fetch, "startProxyHandshake");
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
                self.state.response_message_buffer.append(to_copy);
            }
        }

        self.set_timeout(socket, 5);
    }

    pub fn handle_on_data_headers<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: *mut HttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_output::scoped_log!(fetch, "handleOnDataHeader data: {}", BStr::new(incoming_data));
        let mut to_read = incoming_data;
        let mut needs_move = true;
        if !self.state.response_message_buffer.list.is_empty() {
            // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
            self.state.response_message_buffer.append_slice_exact(incoming_data);
            to_read = self.state.response_message_buffer.list.as_slice();
            needs_move = false;
        }

        loop {
            let mut amount_read: usize = 0;

            // we reset the pending_response each time wich means that on parse error this will be always be empty
            self.state.pending_response = Some(picohttp::Response::default());

            // minimal http/1.1 response is 16 bytes ("HTTP/1.1 200\r\n\r\n")
            // if less than 16 it will always be a ShortRead
            if to_read.len() < 16 {
                bun_output::scoped_log!(fetch, "handleShortRead");
                self.handle_short_read::<IS_SSL>(incoming_data, socket, needs_move);
                return;
            }

            // SAFETY: shared buffer only accessed from single HTTP thread
            let shared_resp = unsafe { &mut SHARED_RESPONSE_HEADERS_BUF };
            let response = match picohttp::Response::parse_parts(to_read, shared_resp, &mut amount_read)
            {
                Ok(r) => r,
                Err(e) if e == err!(ShortRead) => {
                    self.handle_short_read::<IS_SSL>(incoming_data, socket, needs_move);
                    return;
                }
                Err(e) => {
                    self.close_and_fail::<IS_SSL>(e, socket);
                    return;
                }
            };

            // we save the successful parsed response
            self.state.pending_response = Some(response);

            let bytes_read =
                (usize::try_from(response.bytes_read).unwrap()).min(to_read.len());
            to_read = &to_read[bytes_read..];

            if response.status_code == 101 {
                if self.flags.upgrade_state == HTTPUpgradeState::None {
                    // we cannot upgrade to websocket because the client did not request it!
                    self.close_and_fail::<IS_SSL>(err!(UnrequestedUpgrade), socket);
                    return;
                }
                // special case for websocket upgrade
                self.flags.upgrade_state = HTTPUpgradeState::Upgraded;
                if let Some(upgraded) = &self.signals.upgraded {
                    upgraded.store(true, Ordering::Relaxed);
                }
                // start draining the request body
                self.flush_stream::<IS_SSL>(socket);
                break;
            }

            // handle the case where we have a 100 Continue
            if response.status_code >= 100 && response.status_code < 200 {
                bun_output::scoped_log!(fetch, "information headers");

                self.state.pending_response = None;
                if to_read.is_empty() {
                    // we only received 1XX responses, we wanna wait for the next status code
                    return;
                }
                // the buffer could still contain more 1XX responses or other status codes, so we continue parsing
                continue;
            }

            break;
        }
        let mut response = self.state.pending_response.unwrap();
        let should_continue = match self.handle_response_metadata(&mut response) {
            Ok(s) => s,
            Err(err) => {
                self.close_and_fail::<IS_SSL>(err, socket);
                return;
            }
        };

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
            self.start_proxy_handshake::<IS_SSL>(socket, to_read);
            return;
        }

        // we have body data incoming so we clone metadata and keep going
        self.clone_metadata();

        if to_read.is_empty() {
            // no body data yet, but we can report the headers
            if self.signals.get(Signals::HeaderProgress) {
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
            self.set_timeout(socket, 5);
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
        if self.signals.get(Signals::HeaderProgress) {
            self.progress_update::<IS_SSL>(ctx, socket);
            return;
        }
    }

    pub fn on_data<const IS_SSL: bool>(
        &mut self,
        incoming_data: &[u8],
        ctx: *mut HttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        bun_output::scoped_log!(fetch, "onData {}", incoming_data.len());
        if self.signals.get(Signals::Aborted) {
            self.close_and_abort::<IS_SSL>(socket);
            return;
        }

        if let Some(proxy) = self.proxy_tunnel.clone() {
            // if we have a tunnel we dont care about the other stages, we will just tunnel the data
            self.set_timeout(socket, 5);
            proxy.receive(incoming_data);
            return;
        }

        match self.state.response_stage {
            ResponseStage::Pending | ResponseStage::Headers => {
                self.handle_on_data_headers::<IS_SSL>(incoming_data, ctx, socket);
            }
            ResponseStage::Body => {
                self.set_timeout(socket, 5);

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
                self.set_timeout(socket, 5);

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
                let callback = self.result_callback;
                let result = self.to_result();
                self.state.reset();
                self.flags.proxy_tunneling = false;

                callback.run(self.parent_async_http(), result);
            }
        }
    }

    /// The leader of a coalesced cold connect has learned the ALPN outcome (or
    /// failed). Dispatch every waiter accordingly.
    fn resolve_pending_h2(&mut self, resolution: PendingH2Resolution<'_>) {
        let Some(pc) = self.pending_h2.take() else { return };
        pc.unregister_from(self.get_ssl_ctx::<true>());
        // pc drops at scope exit (was `defer pc.deinit()`)

        for waiter in pc.waiters.iter() {
            if waiter.signals.get(Signals::Aborted) {
                waiter.fail(err!(Aborted));
                continue;
            }
            match &resolution {
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

        if let Some(tunnel) = self.proxy_tunnel.take() {
            tunnel.shutdown();
            // always detach the socket from the tunnel in case of fail
            tunnel.detach_and_deref();
        }
        if self.state.stage != Stage::Done && self.state.stage != Stage::Fail {
            self.state.request_stage = RequestStage::Fail;
            self.state.response_stage = ResponseStage::Fail;
            self.state.fail = Some(err);
            self.state.stage = Stage::Fail;

            if !self.flags.defer_fail_until_connecting_is_complete {
                let callback = self.result_callback;
                let result = self.to_result();
                self.state.reset();
                self.flags.proxy_tunneling = false;

                callback.run(self.parent_async_http(), result);
            }
        }
    }

    // We have to clone metadata immediately after use
    pub fn clone_metadata(&mut self) {
        debug_assert!(self.state.pending_response.is_some());
        if let Some(response) = &self.state.pending_response {
            if let Some(old) = self.state.cloned_metadata.take() {
                drop(old); // deinit
            }
            let mut builder = StringBuilder::default();
            response.count(&mut builder);
            builder.count(self.url.href);
            builder.allocate().expect("unreachable");
            // headers_buf is owned by the cloned_response (aka cloned_response.headers)
            let headers_buf =
                vec![picohttp::Header::ZERO; response.headers.list.len()].into_boxed_slice();
            let cloned_response = response.clone_into(headers_buf, &mut builder);

            // we clean the temporary response since cloned_metadata is now the owner
            self.state.pending_response = None;

            let href = builder.append(self.url.href);
            self.state.cloned_metadata = Some(HTTPResponseMetadata {
                owned_buf: builder.into_owned_slice(),
                response: cloned_response,
                url: href,
            });
        } else {
            // we should never clone metadata that dont exists
            // we added a empty metadata just in case but will hit the assert
            self.state.cloned_metadata = Some(HTTPResponseMetadata::default());
        }
    }

    pub fn set_timeout<S: SocketTimeout>(&self, socket: S, minutes: c_uint) {
        if self.flags.disable_timeout {
            socket.timeout(0);
            socket.set_timeout_minutes(0);
            return;
        }

        socket.timeout(0);
        socket.set_timeout_minutes(minutes);
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

        let Some(body_out_str) = self.state.body_out_str.as_ref() else {
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
        ctx: *mut HttpContext<IS_SSL>,
        socket: HttpSocket<IS_SSL>,
    ) {
        if self.flags.protocol != Protocol::Http1_1 {
            return self.send_progress_update_multiplexed();
        }
        let out_str = self.state.body_out_str.as_ref().unwrap();
        let body = (*out_str).clone(); // TODO(port): MutableString copy semantics
        let result = self.to_result();
        let is_done = !result.has_more;

        bun_output::scoped_log!(fetch, "progressUpdate {}", is_done);

        let callback = self.result_callback;

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
            let tunnel_poolable = if let Some(t) = &self.proxy_tunnel {
                self.state.request_stage == RequestStage::Done
                    && t.write_buffer.is_empty()
                    && t.wrapper.as_ref().map(|w| !w.is_shutdown()).unwrap_or(false)
            } else {
                true
            };

            if self.is_keep_alive_possible()
                && !socket.is_closed_or_has_error()
                && tunnel_poolable
            {
                bun_output::scoped_log!(fetch, "release socket");
                let tunnel = self.proxy_tunnel.take();
                if let Some(t) = &tunnel {
                    t.detach_owner(self);
                }
                // target_hostname = url.hostname (the CONNECT TCP target at
                // writeProxyConnect line 346). The SNI override (hostname) is
                // hashed into proxyAuthHash separately — both must match, but
                // they're distinct values when a Host header override is set.
                // SAFETY: ctx points at the thread-owned HttpContext for the lifetime of this call
                unsafe {
                    (*ctx).release_socket(
                        socket,
                        self.flags.did_have_handshaking_error
                            && !self.flags.reject_unauthorized,
                        self.connected_url.hostname,
                        self.connected_url.get_port_auto(),
                        self.tls_props.as_ref(),
                        tunnel.clone(),
                        if tunnel.is_some() { self.url.hostname } else { b"" },
                        if tunnel.is_some() { self.url.get_port_auto() } else { 0 },
                        if tunnel.is_some() { self.proxy_auth_hash() } else { 0 },
                        None,
                    );
                }
            } else {
                if let Some(tunnel) = self.proxy_tunnel.take() {
                    bun_output::scoped_log!(fetch, "close the tunnel");
                    tunnel.shutdown();
                    tunnel.detach_and_deref();
                }
                HttpContext::<IS_SSL>::close_socket(socket);
            }

            self.state.reset();
            self.state.response_stage = ResponseStage::Done;
            self.state.request_stage = RequestStage::Done;
            self.state.stage = Stage::Done;
            self.flags.proxy_tunneling = false;
            bun_output::scoped_log!(fetch, "done");
        }

        *result.body.unwrap() = body;
        callback.run(self.parent_async_http(), result);

        if PRINT_EVERY > 0 {
            // SAFETY: single-threaded HTTP thread
            unsafe {
                PRINT_EVERY_I += 1;
                if PRINT_EVERY_I % PRINT_EVERY == 0 {
                    Output::prettyln("Heap stats for HTTP thread\n", &[]);
                    Output::flush();
                    if let Some(a) = DEFAULT_ARENA.as_ref() {
                        a.dump_thread_stats();
                    }
                    PRINT_EVERY_I = 0;
                }
            }
        }
    }

    /// `send_progress_update_without_stage_check` minus the per-request TCP socket
    /// release/close. Used by HTTP/2 and HTTP/3, whose session owns the
    /// transport, so there is no `ctx`/`socket` to hand back to the pool here.
    fn send_progress_update_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        let out_str = self.state.body_out_str.as_ref().unwrap();
        let body = (*out_str).clone(); // TODO(port): MutableString copy semantics
        let result = self.to_result();
        let is_done = !result.has_more;
        bun_output::scoped_log!(fetch, "progressUpdate {}", is_done);
        let callback = self.result_callback;
        if is_done {
            self.unregister_abort_tracker();
            self.state.reset();
            self.state.response_stage = ResponseStage::Done;
            self.state.request_stage = RequestStage::Done;
            self.state.stage = Stage::Done;
            self.flags.proxy_tunneling = false;
        }
        *result.body.unwrap() = body;
        callback.run(self.parent_async_http(), result);
    }

    /// `do_redirect` minus the per-request socket release/close. The session
    /// detached the stream before calling this; `start()` re-enters the normal
    /// connect path for the redirect target.
    fn do_redirect_multiplexed(&mut self) {
        debug_assert!(self.flags.protocol != Protocol::Http1_1);
        bun_output::scoped_log!(fetch, "doRedirectMultiplexed");
        if matches!(self.state.original_request_body, HTTPRequestBody::Stream(_)) {
            self.flags.is_streaming_request_body = false;
        }
        self.unix_socket_path = ZigString::Slice::empty();
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
        let body_out_str = self.state.body_out_str.take().unwrap();
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
        self.start(HTTPRequestBody::Bytes(request_body), body_out_str);
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
        ctx: *mut HttpContext<IS_SSL>,
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
        bun_output::scoped_log!(fetch, "onPreconnect({})", BStr::new(self.url.href));
        self.unregister_abort_tracker();
        let ctx = self.get_ssl_ctx::<IS_SSL>();
        // SAFETY: ctx points at the thread-owned HttpContext for the lifetime of this call
        unsafe {
            (*ctx).release_socket(
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
        }

        self.state.reset();
        self.state.response_stage = ResponseStage::Done;
        self.state.request_stage = RequestStage::Done;
        self.state.stage = Stage::Done;
        self.flags.proxy_tunneling = false;
        self.result_callback.run(
            self.parent_async_http(),
            HTTPClientResult { fail: None, metadata: None, has_more: false, ..Default::default() },
        );
    }

    /// `@fieldParentPtr("client", this)` — recover the AsyncHTTP that embeds this client.
    #[inline]
    fn parent_async_http(&mut self) -> *mut AsyncHTTP {
        // SAFETY: HTTPClient is always embedded as `client` field of AsyncHTTP
        unsafe {
            (self as *mut Self as *mut u8)
                .sub(offset_of!(AsyncHTTP, client))
                .cast::<AsyncHTTP>()
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
                body: self.state.body_out_str.as_deref_mut(),
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
            body: self.state.body_out_str.as_deref_mut(),
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
            bun_output::scoped_log!(
                fetch,
                "handleResponseBodyFromSinglePacket {}",
                self.state.total_body_received
            );
        }
        // PORT NOTE: Zig `defer` block moved to end of fn (no early returns after this point that skip it)
        // we can ignore the body data in redirects
        if !self.state.flags.is_redirect_pending {
            if self.state.encoding.is_compressed() {
                self.state
                    .decompress_bytes(incoming_data, self.state.body_out_str.as_mut().unwrap(), true)?;
            } else {
                self.state.get_body_buffer().append_slice_exact(incoming_data)?;
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

        if let Some(progress) = self.progress_node.as_mut() {
            progress.activate();
            progress.set_completed_items(incoming_data.len());
            progress.context.maybe_refresh();
        }
        Ok(())
    }

    fn handle_response_body_from_multiple_packets(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let buffer = self.state.get_body_buffer();
        let content_length = self.state.content_length;

        let remainder: &[u8] = if let Some(cl) = content_length {
            let remaining_content_length = cl.saturating_sub(self.state.total_body_received);
            &incoming_data[0..incoming_data.len().min(remaining_content_length)]
        } else {
            incoming_data
        };

        // we can ignore the body data in redirects
        if !self.state.flags.is_redirect_pending {
            if buffer.list.is_empty() && incoming_data.len() < PREALLOCATE_MAX {
                let _ = buffer.list.try_reserve_exact(incoming_data.len());
            }

            let _ = buffer.write(remainder)?;
        }

        self.state.total_body_received += remainder.len();
        bun_output::scoped_log!(
            fetch,
            "handleResponseBodyFromMultiplePackets {}",
            self.state.total_body_received
        );
        if let Some(progress) = self.progress_node.as_mut() {
            progress.activate();
            progress.set_completed_items(self.state.total_body_received);
            progress.context.maybe_refresh();
        }

        // done or streaming
        let is_done =
            content_length.is_some() && self.state.total_body_received >= content_length.unwrap();
        if is_done || self.signals.get(Signals::ResponseBodyStreaming) || content_length.is_none() {
            let is_final_chunk = is_done;
            // TODO(port): buffer.* is a value copy in Zig; pass &mut here
            let processed = self.state.process_body_buffer(buffer, is_final_chunk)?;

            // We can only use the libdeflate fast path when we are not streaming
            // If we ever call processBodyBuffer again, it cannot go through the fast path.
            self.state.flags.is_libdeflate_fast_path_disabled = true;

            if let Some(progress) = self.progress_node.as_mut() {
                progress.activate();
                progress.set_completed_items(self.state.total_body_received);
                progress.context.maybe_refresh();
            }
            return Ok(is_done || processed);
        }
        Ok(false)
    }

    pub fn handle_response_body_chunked_encoding(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<bool, bun_core::Error> {
        // SAFETY: SINGLE_PACKET_SMALL_BUFFER only accessed from HTTP thread
        let small_len = unsafe { SINGLE_PACKET_SMALL_BUFFER.len() };
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
        let decoder = &mut self.state.chunked_decoder;
        let buffer_ptr = self.state.get_body_buffer();
        // TODO(port): Zig copies the MutableString by value into `buffer` then writes back
        let mut buffer = buffer_ptr.clone();
        buffer.append_slice(incoming_data)?;

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        decoder.consume_trailer = 1;

        let mut bytes_decoded = incoming_data.len();
        // phr_decode_chunked mutates in-place
        // SAFETY: buffer.list is initialized for [0..len()) and uniquely borrowed here;
        // the offset is len() - incoming_data.len() (the just-appended tail), which is in bounds.
        let pret = unsafe {
            picohttp::phr_decode_chunked(
                decoder,
                buffer
                    .list
                    .as_mut_ptr()
                    .add(buffer.list.len().saturating_sub(incoming_data.len())),
                &mut bytes_decoded,
            )
        };
        let new_len = buffer
            .list
            .len()
            .saturating_sub(incoming_data.len() - bytes_decoded);
        buffer.list.truncate(new_len);
        self.state.total_body_received += bytes_decoded;
        bun_output::scoped_log!(
            fetch,
            "handleResponseBodyChunkedEncodingFromMultiplePackets {}",
            self.state.total_body_received
        );

        *buffer_ptr = buffer.clone();

        match pret {
            // Invalid HTTP response body
            -1 => return Err(err!(InvalidHTTPResponse)),
            // Needs more data
            -2 => {
                if let Some(progress) = self.progress_node.as_mut() {
                    progress.activate();
                    progress.set_completed_items(buffer.list.len());
                    progress.context.maybe_refresh();
                }
                // streaming chunks
                if self.signals.get(Signals::ResponseBodyStreaming) {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;
                    return self.state.process_body_buffer(&buffer, false);
                }

                return Ok(false);
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                let _ = self.state.process_body_buffer(&buffer, true)?;

                if let Some(progress) = self.progress_node.as_mut() {
                    progress.activate();
                    progress.set_completed_items(buffer.list.len());
                    progress.context.maybe_refresh();
                }

                return Ok(true);
            }
        }
    }

    fn handle_response_body_chunked_encoding_from_single_packet(
        &mut self,
        incoming_data: &[u8],
    ) -> Result<bool, bun_core::Error> {
        let decoder = &mut self.state.chunked_decoder;
        // SAFETY: HTTP-thread-only static
        let small = unsafe { &mut SINGLE_PACKET_SMALL_BUFFER };
        debug_assert!(incoming_data.len() <= small.len());

        // set consume_trailer to 1 to discard the trailing header
        // using content-encoding per chunk is not supported
        decoder.consume_trailer = 1;

        let buffer: &mut [u8] = if self.state.response_message_buffer.owns(incoming_data) {
            // if we've already copied the buffer once, we can avoid copying it again.
            // SAFETY: response_message_buffer is owned mutably by self; incoming_data
            // is a borrow into it. Zig does `@constCast`.
            unsafe {
                core::slice::from_raw_parts_mut(
                    incoming_data.as_ptr() as *mut u8,
                    incoming_data.len(),
                )
            }
        } else {
            small[0..incoming_data.len()].copy_from_slice(incoming_data);
            &mut small[0..incoming_data.len()]
        };

        let mut bytes_decoded = incoming_data.len();
        // phr_decode_chunked mutates in-place
        // SAFETY: `buffer` is an exclusive &mut [u8] of len == incoming_data.len(); offset
        // len - incoming_data.len() == 0 is trivially in bounds.
        let pret = unsafe {
            picohttp::phr_decode_chunked(
                decoder,
                buffer
                    .as_mut_ptr()
                    .add(buffer.len().saturating_sub(incoming_data.len())),
                &mut bytes_decoded,
            )
        };
        let buffer = &mut buffer[..buffer
            .len()
            .saturating_sub(incoming_data.len() - bytes_decoded)];
        self.state.total_body_received += bytes_decoded;
        bun_output::scoped_log!(
            fetch,
            "handleResponseBodyChunkedEncodingFromSinglePacket {}",
            self.state.total_body_received
        );
        match pret {
            // Invalid HTTP response body
            -1 => Err(err!(InvalidHTTPResponse)),
            // Needs more data
            -2 => {
                if let Some(progress) = self.progress_node.as_mut() {
                    progress.activate();
                    progress.set_completed_items(buffer.len());
                    progress.context.maybe_refresh();
                }
                let body_buffer = self.state.get_body_buffer();
                body_buffer.append_slice_exact(buffer)?;

                // streaming chunks
                if self.signals.get(Signals::ResponseBodyStreaming) {
                    // If we're streaming, we cannot use the libdeflate fast path
                    self.state.flags.is_libdeflate_fast_path_disabled = true;

                    return self.state.process_body_buffer(body_buffer, true);
                }

                Ok(false)
            }
            // Done
            _ => {
                self.state.flags.received_last_chunk = true;
                self.handle_response_body_from_single_packet(buffer)?;
                debug_assert!(
                    self.state.body_out_str.as_ref().unwrap().list.as_ptr() != buffer.as_ptr()
                );
                if let Some(progress) = self.progress_node.as_mut() {
                    progress.activate();
                    progress.set_completed_items(buffer.len());
                    progress.context.maybe_refresh();
                }

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
            match hash_header_name(header.name) {
                h if h == hash_header_const(b"Content-Length") => {
                    // byte-level parse — header.value is network bytes, not &str
                    let content_length = 'cl: {
                        if header.value.is_empty() {
                            break 'cl 0;
                        }
                        let mut n: usize = 0;
                        for &b in header.value {
                            if !b.is_ascii_digit() {
                                break 'cl 0;
                            }
                            n = match n
                                .checked_mul(10)
                                .and_then(|n| n.checked_add((b - b'0') as usize))
                            {
                                Some(v) => v,
                                None => break 'cl 0,
                            };
                        }
                        n
                    };
                    if self.method.has_body() {
                        self.state.content_length = Some(content_length);
                    } else {
                        // ignore body size for HEAD requests
                        self.state.content_length = Some(0);
                    }
                }
                h if h == hash_header_const(b"Content-Type") => {
                    if strings::index_of(header.value, b"text/event-stream").is_some() {
                        is_server_sent_events = true;
                    }
                }
                h if h == hash_header_const(b"Content-Encoding") => {
                    if !self.flags.disable_decompression {
                        if header.value == b"gzip" {
                            self.state.encoding = Encoding::Gzip;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value == b"deflate" {
                            self.state.encoding = Encoding::Deflate;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value == b"br" {
                            self.state.encoding = Encoding::Brotli;
                            self.state.content_encoding_i = header_i as u8;
                        } else if header.value == b"zstd" {
                            self.state.encoding = Encoding::Zstd;
                            self.state.content_encoding_i = header_i as u8;
                        }
                    }
                }
                h if h == hash_header_const(b"Transfer-Encoding") => {
                    if header.value == b"gzip" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Gzip;
                        }
                    } else if header.value == b"deflate" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Deflate;
                        }
                    } else if header.value == b"br" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Brotli;
                        }
                    } else if header.value == b"zstd" {
                        if !self.flags.disable_decompression {
                            self.state.transfer_encoding = Encoding::Zstd;
                        }
                    } else if header.value == b"identity" {
                        self.state.transfer_encoding = Encoding::Identity;
                    } else if header.value == b"chunked" {
                        self.state.transfer_encoding = Encoding::Chunked;
                    } else {
                        return Err(err!(UnsupportedTransferEncoding));
                    }
                }
                h if h == hash_header_const(b"Location") => {
                    location = header.value;
                }
                h if h == hash_header_const(b"Connection") => {
                    if response.status_code >= 200 && response.status_code <= 299 {
                        // HTTP headers are case-insensitive (RFC 7230)
                        if header.value.eq_ignore_ascii_case(b"close") {
                            self.state.flags.allow_keepalive = false;
                        } else if header.value.eq_ignore_ascii_case(b"keep-alive") {
                            self.state.flags.allow_keepalive = true;
                        }
                    }
                }
                h if h == hash_header_const(b"Last-Modified") => {
                    pretend_304 = self.flags.force_last_modified
                        && response.status_code > 199
                        && response.status_code < 300
                        && !self.if_modified_since.is_empty()
                        && self.if_modified_since == header.value;
                }
                h if h == hash_header_const(b"Alt-Svc") => {
                    // Record regardless of *this* request's shape — a future
                    // request to the same origin may be h3-eligible even if this
                    // one was pinned/proxied/sendfile.
                    if self.is_https()
                        && self.unix_socket_path.length() == 0
                        && h3_alt_svc_enabled()
                    {
                        h3::AltSvc::record(
                            self.url.hostname,
                            self.url.get_port_auto(),
                            header.value,
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
                            && matches!(self.state.original_request_body, HTTPRequestBody::Stream(_))
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

                                let normalized_url = URL::href_from_string(
                                    bun_str::String::from_bytes(string_builder.allocated_slice()),
                                );
                                // normalized_url drops at scope exit (was `defer .deref()`)
                                if normalized_url.tag == bun_str::Tag::Dead {
                                    // URL__getHref failed, dont pass dead tagged string to toOwnedSlice.
                                    return Err(err!(RedirectURLInvalid));
                                }
                                let normalized_url_str = normalized_url.to_owned_slice()?;

                                let new_url = URL::parse(&normalized_url_str);
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

                                let normalized_url = URL::href_from_string(
                                    bun_str::String::from_bytes(string_builder.allocated_slice()),
                                );
                                let normalized_url_str = normalized_url.to_owned_slice()?;

                                let new_url = URL::parse(&normalized_url_str);
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

                                let new_url_ = URL::join(
                                    bun_str::String::from_bytes(original_url.href),
                                    bun_str::String::from_bytes(location),
                                );
                                // new_url_ drops at scope exit (was `defer .deref()`)

                                if new_url_.is_empty() {
                                    return Err(err!(InvalidRedirectURL));
                                }

                                let new_url = match new_url_.to_owned_slice() {
                                    Ok(s) => s,
                                    Err(_) => return Err(err!(RedirectURLTooLong)),
                                };
                                self.url = URL::parse(&new_url);
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
                        if ((status_code == 301 || status_code == 302) && self.method == Method::POST)
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
                                                    let _ =
                                                        self.header_entries.ordered_remove(i);
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
                            const HEADERS_TO_REMOVE: [H; 3] = [
                                H { name: b"Authorization", hash: AUTHORIZATION_HEADER_HASH },
                                H {
                                    name: b"Proxy-Authorization",
                                    hash: PROXY_AUTHORIZATION_HEADER_HASH,
                                },
                                H { name: b"Cookie", hash: COOKIE_HEADER_HASH },
                            ];
                            for header in HEADERS_TO_REMOVE.iter() {
                                let names = self.header_entries.items_name();
                                for (i, name_ptr) in names.iter().enumerate() {
                                    let name = self.header_str(*name_ptr);
                                    if name.len() == header.name.len() {
                                        let hash = hash_header_name(name);
                                        if hash == header.hash {
                                            self.header_entries.ordered_remove(i);
                                            break;
                                        }
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
            bun_output::scoped_log!(
                fetch,
                "handleResponseMetadata: content_length is {} and transfer_encoding {:?}",
                length,
                self.state.transfer_encoding
            );
        } else {
            bun_output::scoped_log!(
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

// ───────────────────────────── support types ─────────────────────────────

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const PREALLOCATE_MAX: usize = 1024 * 1024 * 256;

// the first packet for Transfer-Encoding: chunked
// is usually pretty small or sometimes even just a length
// so we can avoid allocating a temporary buffer to copy the data in
static mut SINGLE_PACKET_SMALL_BUFFER: [u8; 16 * 1024] = [0; 16 * 1024];

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ShouldContinue {
    ContinueStreaming,
    Finished,
}

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

#[derive(Default)]
pub struct HTTPResponseMetadata {
    pub url: *const [u8], // TODO(port): borrows owned_buf
    pub owned_buf: Box<[u8]>,
    pub response: picohttp::Response,
}

#[cold]
pub fn print_request(
    protocol: Protocol,
    request: &picohttp::Request,
    url: &[u8],
    ignore_insecure: bool,
    body: &[u8],
    curl: bool,
) {
    let mut request_ = request.clone();
    request_.path = url;

    if curl {
        Output::pretty_errorln(format_args!("{}", request_.curl(ignore_insecure, body)));
    }

    let ver: &[u8] = match protocol {
        Protocol::Http1_1 => b"HTTP/1.1",
        Protocol::Http2 => b"HTTP/2",
        Protocol::Http3 => b"HTTP/3",
    };
    let prefix = if Output::enable_ansi_colors_stderr() {
        Output::pretty_fmt::<true>("<r><d>[fetch]<r> ")
    } else {
        ""
    };
    let _ = Output::error_writer().write_fmt(format_args!(
        "{}> {} {} {}\n",
        prefix,
        BStr::new(ver),
        BStr::new(request_.method),
        BStr::new(request_.path)
    ));
    for header in request_.headers {
        let _ = Output::error_writer().write_fmt(format_args!("{}> {}\n", prefix, header));
    }
    Output::flush();
}

#[cold]
fn print_response(response: &picohttp::Response) {
    Output::pretty_errorln(format_args!("{}", response));
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
        let wrote = usize::try_from(amount).unwrap();
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
        buffer.write(&data[amount..]);
    }
    Ok(amount)
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
        matches!(self.fail, Some(e) if e == err!(Timeout))
    }

    pub fn is_abort(&self) -> bool {
        matches!(self.fail, Some(e) if e == err!(Aborted) || e == err!(AbortedBeforeConnecting))
    }
}

#[derive(Default, Copy, Clone)]
pub enum BodySize {
    TotalReceived(usize),
    ContentLength(usize),
    #[default]
    Unknown,
}

#[derive(Copy, Clone)]
pub struct HTTPClientResultCallback {
    pub ctx: *mut (),
    pub function: HTTPClientResultCallbackFunction,
}

pub type HTTPClientResultCallbackFunction =
    fn(*mut (), *mut AsyncHTTP, HTTPClientResult<'_>);

impl HTTPClientResultCallback {
    pub fn run(self, async_http: *mut AsyncHTTP, result: HTTPClientResult<'_>) {
        (self.function)(self.ctx, async_http, result);
    }

    // TODO(port): `Callback.New(comptime Type, comptime callback)` was a
    // type-returning fn that wrapped a typed callback in *anyopaque erasure.
    // In Rust this is a generic constructor; sketch below, refine in Phase B.
    pub fn new<T>(
        this: *mut T,
        callback: fn(*mut T, *mut AsyncHTTP, HTTPClientResult<'_>),
    ) -> Self {
        // SAFETY: fn-pointer transmute over *mut T → *mut () first arg
        unsafe {
            Self {
                ctx: this as *mut (),
                function: core::mem::transmute::<
                    fn(*mut T, *mut AsyncHTTP, HTTPClientResult<'_>),
                    HTTPClientResultCallbackFunction,
                >(callback),
            }
        }
    }
}

// Exists for heap stats reasons.
pub struct ThreadlocalAsyncHTTP {
    pub async_http: AsyncHTTP,
}

impl ThreadlocalAsyncHTTP {
    pub fn new(async_http: AsyncHTTP) -> Box<Self> {
        Box::new(Self { async_http })
    }
}

/// `socket: anytype` in `set_timeout` — minimal trait for what the body calls.
pub trait SocketTimeout {
    fn timeout(&self, seconds: c_uint);
    fn set_timeout_minutes(&self, minutes: c_uint);
}

// TODO(port): these are defined in InternalState.zig; aliased here for readability.
use crate::internal_state::{RequestStage, ResponseStage, Stage};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/http.zig (3265 lines)
//   confidence: medium
//   todos:      22
//   notes:      heavy borrowck reshaping (defer→explicit calls in start_, write_to_stream); Flags kept unpacked; get_ssl_ctx returns *mut due to Arc/static split; many `static mut` globals need sync wrappers; hash_header_const needs const-fn Wyhash; MimallocArena dropped (non-AST crate)
// ──────────────────────────────────────────────────────────────────────────
