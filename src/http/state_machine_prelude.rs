// ═══════════════════════════════════════════════════════════════════════
// B-2 un-gate prelude: imports, constants, helper fns, and bridge
// impls the `impl HTTPClient` state machine needs. Reconstructed from the
// recipe at tasks/wbod1goes (prior pass reached 67/371 errors before an
// external `git reset` discarded it). Kept in a separate file so concurrent
// `git reset` of lib.rs doesn't lose it.
// ═══════════════════════════════════════════════════════════════════════

use core::ffi::{c_int, c_uint, c_void};
use core::mem::offset_of;
use std::sync::atomic::Ordering;

use bstr::BStr;
use bun_boringssl as boringssl;
use bun_collections::ArrayHashMap;
use bun_core::{self as bun, Environment, FeatureFlags, Global, Output, err};
use bun_string::{immutable as strings, StringBuilder};
use bun_uws as uws;
use bun_wyhash::Wyhash11 as Wyhash;
use bun_http_types::ETag::{StringPointer};

use crate::headers::api;
use crate::http_context::HTTPSocket as HttpSocket;
use crate::internal_state::{HTTPStage, RequestStage, ResponseStage, Stage};

/// Generic `HttpContext<const SSL>` alias — the canonical `HttpContext` /
/// `HttpsContext` are concrete-SSL aliases above; the state machine needs a
/// const-generic spelling for `get_ssl_ctx<IS_SSL>()`.
pub type GenHttpContext<const SSL: bool> = http_context::HTTPContext<SSL>;

bun_core::declare_scope!(fetch, visible);

// ── header constants ────────────────────────────────────────────────────
const HOST_HEADER_NAME: &[u8] = b"Host";
const CONTENT_LENGTH_HEADER_NAME: &[u8] = b"Content-Length";
const CHUNKED_ENCODED_HEADER: picohttp::Header =
    picohttp::Header::new(b"Transfer-Encoding", b"chunked");
const CONNECTION_HEADER: picohttp::Header =
    picohttp::Header::new(b"Connection", b"keep-alive");
const ACCEPT_HEADER: picohttp::Header = picohttp::Header::new(b"Accept", b"*/*");

const ACCEPT_ENCODING_NO_COMPRESSION: &[u8] = b"identity";
const ACCEPT_ENCODING_COMPRESSION: &[u8] = b"gzip, deflate, br, zstd";
const ACCEPT_ENCODING_HEADER_COMPRESSION: picohttp::Header =
    picohttp::Header::new(b"Accept-Encoding", ACCEPT_ENCODING_COMPRESSION);
const ACCEPT_ENCODING_HEADER_NO_COMPRESSION: picohttp::Header =
    picohttp::Header::new(b"Accept-Encoding", ACCEPT_ENCODING_NO_COMPRESSION);

const ACCEPT_ENCODING_HEADER: picohttp::Header = if FeatureFlags::DISABLE_COMPRESSION_IN_HTTP_CLIENT {
    ACCEPT_ENCODING_HEADER_NO_COMPRESSION
} else {
    ACCEPT_ENCODING_HEADER_COMPRESSION
};

fn get_user_agent_header() -> picohttp::Header {
    // SAFETY: OVERRIDDEN_DEFAULT_USER_AGENT is set once at startup before HTTP thread spawns
    let ua = unsafe { OVERRIDDEN_DEFAULT_USER_AGENT };
    picohttp::Header::new(
        b"User-Agent",
        if !ua.is_empty() { ua } else { Global::user_agent.as_bytes() },
    )
}

// ── header-hash constants ───────────────────────────────────────────────
// PORT NOTE: Zig computed these at comptime via `Wyhash + lowerString`.
// Wyhash11 is not yet `const fn`, so use a runtime alias of `hash_header_name`
// and cache the three values that are looked up on every request via
// `LazyLock`. The per-header `match` arms inside `build_request` /
// `handle_response_metadata` already call `hash_header_const` at runtime.
#[inline(always)]
fn hash_header_const(name: &[u8]) -> u64 { hash_header_name(name) }

static AUTHORIZATION_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Authorization"));
static PROXY_AUTHORIZATION_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Proxy-Authorization"));
static COOKIE_HEADER_HASH: std::sync::LazyLock<u64> =
    std::sync::LazyLock::new(|| hash_header_name(b"Cookie"));

// ── shared per-thread buffers ───────────────────────────────────────────
const PRINT_EVERY: usize = 0;
static mut PRINT_EVERY_I: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
const MAX_REQUEST_HEADERS: usize = 256;
static mut SHARED_REQUEST_HEADERS_BUF: [picohttp::Header; MAX_REQUEST_HEADERS] =
    [picohttp::Header::ZERO; MAX_REQUEST_HEADERS];

// this doesn't need to be stack memory because it is immediately cloned after use
static mut SHARED_RESPONSE_HEADERS_BUF: [picohttp::Header; 256] = [picohttp::Header::ZERO; 256];

// the first packet for Transfer-Encoding: chunked
// is usually pretty small or sometimes even just a length
// so we can avoid allocating a temporary buffer to copy the data in
static mut SINGLE_PACKET_SMALL_BUFFER: [u8; 16 * 1024] = [0; 16 * 1024];

// ── ALPN offer enum ─────────────────────────────────────────────────────
// PORT NOTE: Zig used `boringssl.SSL.AlpnOffer`; bun_boringssl doesn't yet
// expose one, so define it locally and TODO(b2) wire through to
// `configure_http_client_with_alpn` once that lands.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AlpnOffer { H1, H2Only, H1OrH2 }

// ── boringssl FFI not yet re-exported by bun_boringssl ──────────────────
mod boring_extra {
    use core::ffi::{c_int, c_uchar, c_uint};
    unsafe extern "C" {
        pub fn i2d_X509(x: *mut bun_boringssl::c::X509, out: *mut *mut u8) -> c_int;
        pub fn SSL_get0_alpn_selected(
            ssl: *const bun_boringssl::c::SSL,
            out_data: *mut *const c_uchar,
            out_len: *mut c_uint,
        );
        pub fn SSL_is_init_finished(ssl: *const bun_boringssl::c::SSL) -> c_int;
        pub fn SSL_get_peer_cert_chain(
            ssl: *const bun_boringssl::c::SSL,
        ) -> *mut core::ffi::c_void; // STACK_OF(X509)*
        pub fn sk_X509_value(stack: *const core::ffi::c_void, idx: usize) -> *mut bun_boringssl::c::X509;
        pub fn SSL_set_tlsext_host_name(ssl: *mut bun_boringssl::c::SSL, name: *const core::ffi::c_char) -> c_int;
    }
}

// ── EntryList column accessors ──────────────────────────────────────────
// `header_entries.slice().items_name()` was a Zig MultiArrayList convenience.
// Re-widen the borrow to `'static` so the per-row `header_str()` calls inside
// `build_request` don't trip borrowck (the underlying buffer is the static
// `SHARED_REQUEST_HEADERS_BUF` / `self.header_buf` pair).
trait HeaderEntrySliceColumns {
    fn items_name(&self) -> &'static [StringPointer];
    fn items_value(&self) -> &'static [StringPointer];
}
impl HeaderEntrySliceColumns for bun_collections::multi_array_list::Slice<bun_http_types::ETag::HeaderEntry> {
    fn items_name(&self) -> &'static [StringPointer] {
        // SAFETY: StringPointer is POD; the MultiArrayList backing storage outlives every
        // caller in this file (header_entries is a field of HTTPClient). Lifetime is
        // erased only to avoid threading `'self` through the Zig-shaped state machine.
        unsafe {
            core::mem::transmute::<&[StringPointer], &'static [StringPointer]>(
                self.items::<"name", StringPointer>(),
            )
        }
    }
    fn items_value(&self) -> &'static [StringPointer] {
        // SAFETY: see items_name()
        unsafe {
            core::mem::transmute::<&[StringPointer], &'static [StringPointer]>(
                self.items::<"value", StringPointer>(),
            )
        }
    }
}
trait HeaderEntryListColumns {
    fn items_name(&self) -> &'static [StringPointer];
}
impl HeaderEntryListColumns for bun_http_types::ETag::HeaderEntryList {
    fn items_name(&self) -> &'static [StringPointer] {
        // SAFETY: see HeaderEntrySliceColumns::items_name()
        unsafe {
            core::mem::transmute::<&[StringPointer], &'static [StringPointer]>(
                self.items::<"name", StringPointer>(),
            )
        }
    }
}

// ── socket helpers ──────────────────────────────────────────────────────
#[inline]
fn socket_is_closed_or_has_error<const SSL: bool>(socket: &HttpSocket<SSL>) -> bool {
    socket.is_closed() || socket.is_shutdown() || socket.get_error() != 0
}

impl<const SSL: bool> SocketTimeout for HttpSocket<SSL> {
    fn timeout(&self, seconds: c_uint) { Self::timeout(self, seconds) }
    fn set_timeout_minutes(&self, minutes: c_uint) { Self::set_timeout_minutes(self, minutes) }
}

#[inline]
fn abort_tracker() -> &'static mut ArrayHashMap<u32, uws::AnySocket> {
    // SAFETY: same single-thread invariant as http_thread()
    unsafe { SOCKET_ASYNC_HTTP_ABORT_TRACKER.get_or_insert_with(ArrayHashMap::new) }
}

/// Returns the hostname to use for TLS SNI and certificate verification.
/// Priority: tls_props.server_name > client.hostname > client.url.hostname
/// The Host header value (client.hostname) may contain a port suffix which
/// must be stripped because it is not part of the DNS name in certificates.
fn get_tls_hostname(client: &HTTPClient, allow_proxy_url: bool) -> &[u8] {
    if allow_proxy_url {
        if let Some(proxy) = &client.http_proxy {
            return proxy.hostname;
        }
    }
    // Prefer the explicit TLS server_name (e.g. from Node.js servername option)
    if let Some(props) = &client.tls_props {
        let sn = props.get().server_name;
        if !sn.is_null() {
            // SAFETY: server_name is a NUL-terminated CStr owned by the SSLConfig.
            let sn_slice = unsafe { core::ffi::CStr::from_ptr(sn) }.to_bytes();
            if !sn_slice.is_empty() {
                // SAFETY: lifetime tied to `client.tls_props`, which outlives this call.
                return unsafe { core::slice::from_raw_parts(sn_slice.as_ptr(), sn_slice.len()) };
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
fn write_proxy_connect(
    writer: &mut Vec<u8>,
    client: &HTTPClient,
) -> Result<(), bun_core::Error> {
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
        Output::pretty_errorln(format_args!("{}", request_.curl(ignore_insecure, body)));
    }

    let ver: &str = match protocol {
        Protocol::Http1_1 => "HTTP/1.1",
        Protocol::Http2 => "HTTP/2",
        Protocol::Http3 => "HTTP/3",
    };
    // TODO(port): pretty_fmt prefix elided pending Output::error_writer() in bun_core.
    Output::pretty_errorln(format_args!(
        "> {} {} {}",
        ver,
        BStr::new(request.method),
        BStr::new(url),
    ));
    for header in request.headers {
        Output::pretty_errorln(format_args!("> {}", header));
    }
    Output::flush();
}

#[cold]
fn print_response(response: &picohttp::Response<'_>) {
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

// ── bridge impls removed ────────────────────────────────────────────────
// Formerly placeholder scaffolding while sibling modules were behind
// `the gated draft block (now dissolved)`. All 19 functions now have real ported bodies in their
// home modules; the state machine calls them directly:
//   - h2::ClientSession::{create,attach,enqueue}      → src/http/h2_client/ClientSession.rs
//   - h3::ClientContext::{get_or_create,connect}       → src/http/h3_client/ClientContext.rs
//   - HTTPContext::<SSL>::{terminate_socket,close_socket,mark_socket_as_dead,
//       tag_as_h2,release_socket}                       → src/http/HTTPContext.rs
//   - HTTPThread::{get_request_body_send_buffer,connect} → src/http/HTTPThread.rs
//   - RequestBodyBuffer::to_array_list                   → src/http/HTTPThread.rs
//   - ProxyTunnel::{shutdown,on_writable,write,receive,detach_owner,start}
//                                                        → src/http/ProxyTunnel.rs
// Keeping duplicate inherent impls here would be a hard "duplicate
// definitions" error, so the block is dropped rather than re-ported.

// ── HTTPClient field accessors ──────────────────────────────────────────
// The Zig struct stored raw pointers (`*MutableString`, `*ProxyTunnel`); the
// Rust struct uses `Option<NonNull<_>>`. These helpers centralize the unsafe
// deref so the state-machine bodies stay readable.
impl HTTPClient {
    #[inline]
    fn request_body(&self) -> &'static [u8] {
        // SAFETY: request_body is a slice into `original_request_body` which is
        // a field of `self`. Lifetime erased only to thread through Zig-shaped
        // borrowck (mutates other state fields while reading this).
        unsafe { &*self.state.request_body }
    }
    #[inline]
    fn set_request_body(&mut self, slice: &[u8]) {
        self.state.request_body = slice as *const [u8];
    }
    #[inline]
    fn body_out_str(&self) -> &MutableString {
        // SAFETY: body_out_str is set in `start()` and lives for the request.
        unsafe { self.state.body_out_str.unwrap().as_ref() }
    }
    #[inline]
    fn body_out_str_mut(&mut self) -> &mut MutableString {
        // SAFETY: see body_out_str()
        unsafe { self.state.body_out_str.unwrap().as_mut() }
    }
    #[inline]
    fn proxy_tunnel_mut(&mut self) -> Option<&mut ProxyTunnel> {
        // SAFETY: proxy_tunnel is intrusive-refcounted; this borrow does not
        // outlive `self` and the tunnel is not dropped while borrowed.
        self.proxy_tunnel.map(|p| unsafe { &mut *p.as_ptr() })
    }
    #[inline]
    fn progress_node_mut(&mut self) -> Option<&mut bun_core::Progress::Node> {
        // SAFETY: progress_node is owned by the caller (e.g. `bun install`'s
        // Progress) and outlives this client.
        self.progress_node.map(|p| unsafe { &mut *p.as_ptr() })
    }
}
