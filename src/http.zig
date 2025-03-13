const HTTPClient = @This();

const bun = @import("root").bun;
const uws = bun.uws;
const picohttp = bun.picohttp;
const JSC = bun.JSC;
const URL = bun.URL;
const BoringSSL = bun.BoringSSL;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
// const stringZ = bun.stringZ;
// const C = bun.C;
// const Loc = bun.logger.Loc;
// const Log = bun.logger.Log;
// const DotEnv = @import("./env_loader.zig");
const std = @import("std");
const posix = std.posix;
const SOCK = posix.SOCK;
pub const MimeType = @import("./http/mime_type.zig");

// const URL = @import("./url.zig").URL;
pub const Method = @import("./http/method.zig").Method;
// const Api = @import("./api/schema.zig").Api;
// const Lock = bun.Mutex;

const Zlib = @import("./zlib.zig");
const Brotli = bun.brotli;
const StringBuilder = bun.StringBuilder;
const ObjectPool = @import("./pool.zig").ObjectPool;

const default_allocator = bun.default_allocator;
pub const AsyncHTTP = @import("./http/client/async_http.zig").AsyncHTTP;
const registerAsyncHTTPAbortTracker = @import("./http/client/async_http.zig").registerAbortTracker;
const unregisterAsyncHTTPAbortTracker = @import("./http/client/async_http.zig").unregisterAbortTracker;
const HTTPThread = @import("./http/client/thread.zig").HTTPThread;
const getHttpContext = @import("./http/client/thread.zig").getContext;
const Encoding = @import("./http/client/async_http.zig").Encoding;
const HTTPCertError = @import("./http/client/errors.zig").HTTPCertError;
const HTTPRequestBody = @import("./http/client/request_body.zig").HTTPRequestBody;
const CertificateInfo = @import("./http/client/certificate_info.zig").CertificateInfo;
const HTTPVerboseLevel = @import("./http/client/async_http.zig").HTTPVerboseLevel;
const HTTPClientResult = @import("./http/client/result.zig").HTTPClientResult;
const ProxyTunnel = @import("./http/client/proxy_tunnel.zig").ProxyTunnel;
const Signals = @import("./http/client/signals.zig").Signals;
// const Arena = @import("./allocators/mimalloc_arena.zig").Arena;
// const ZlibPool = @import("./http/zlib.zig");
// const BoringSSL = bun.BoringSSL.c;
const Progress = bun.Progress;
// const X509 = @import("./bun.js/api/bun/x509.zig");
const SSLConfig = bun.server.ServerConfig.SSLConfig;
// const SSLWrapper = @import("./bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;
const NewHTTPContext = @import("./http/client/thread.zig").NewHTTPContext;
const http_thread = @import("./http/client/thread.zig").getHttpThread();
const URLBufferPool = ObjectPool([8192]u8, null, false, 10);

pub const HTTPResponseMetadata = @import("./http/client/result.zig").HTTPResponseMetadata;
// This becomes Arena.allocator
const TaggedPointerUnion = @import("./tagged_pointer.zig").TaggedPointerUnion;
pub const end_of_chunked_http1_1_encoding_response_body = @import("./http/client/async_http.zig").end_of_chunked_http1_1_encoding_response_body;

//TODO: this needs to be freed when Worker Threads are implemented
var async_http_id_monotonic: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);
const MAX_REDIRECT_URL_LENGTH = 128 * 1024;

pub var max_http_header_size: usize = 16 * 1024;
comptime {
    @export(&max_http_header_size, .{ .name = "BUN_DEFAULT_MAX_HTTP_HEADER_SIZE" });
}

const print_every = 0;
var print_every_i: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
var shared_request_headers_buf: [256]picohttp.Header = undefined;

// this doesn't need to be stack memory because it is immediately cloned after use
var shared_response_headers_buf: [256]picohttp.Header = undefined;

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const preallocate_max = 1024 * 1024 * 256;

pub const FetchRedirect = enum(u8) {
    follow,
    manual,
    @"error",

    pub const Map = bun.ComptimeStringMap(FetchRedirect, .{
        .{ "follow", .follow },
        .{ "manual", .manual },
        .{ "error", .@"error" },
    });
};

const log = Output.scoped(.fetch, false);

var temp_hostname: [8192]u8 = undefined;

pub fn checkServerIdentity(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
    certError: HTTPCertError,
    sslPtr: *BoringSSL.SSL,
    allowProxyUrl: bool,
) bool {
    if (client.flags.reject_unauthorized) {
        if (BoringSSL.SSL_get_peer_cert_chain(sslPtr)) |cert_chain| {
            if (BoringSSL.sk_X509_value(cert_chain, 0)) |x509| {

                // check if we need to report the error (probably to `checkServerIdentity` was informed from JS side)
                // this is the slow path
                if (client.signals.get(.cert_errors)) {
                    // clone the relevant data
                    const cert_size = BoringSSL.i2d_X509(x509, null);
                    const cert = default_allocator.alloc(u8, @intCast(cert_size)) catch bun.outOfMemory();
                    var cert_ptr = cert.ptr;
                    const result_size = BoringSSL.i2d_X509(x509, &cert_ptr);
                    assert(result_size == cert_size);

                    var hostname = client.hostname orelse client.url.hostname;
                    if (allowProxyUrl) {
                        if (client.http_proxy) |proxy| {
                            hostname = proxy.hostname;
                        }
                    }

                    client.state.certificate_info = .{
                        .cert = cert,
                        .hostname = default_allocator.dupe(u8, hostname) catch bun.outOfMemory(),
                        .cert_error = .{
                            .error_no = certError.error_no,
                            .code = default_allocator.dupeZ(u8, certError.code) catch bun.outOfMemory(),
                            .reason = default_allocator.dupeZ(u8, certError.reason) catch bun.outOfMemory(),
                        },
                    };

                    // we inform the user that the cert is invalid
                    client.progressUpdate(is_ssl, getHttpContext(is_ssl), socket);
                    // continue until we are aborted or not
                    return true;
                } else {
                    // we check with native code if the cert is valid
                    // fast path

                    var hostname = client.hostname orelse client.url.hostname;
                    if (allowProxyUrl) {
                        if (client.http_proxy) |proxy| {
                            hostname = proxy.hostname;
                        }
                    }

                    if (bun.BoringSSL.checkX509ServerIdentity(x509, hostname)) {
                        return true;
                    }
                }
            }
        }
        // SSL error so we fail the connection
        client.closeAndFail(error.ERR_TLS_CERT_ALTNAME_INVALID, is_ssl, socket);
        return false;
    }
    // we allow the connection to continue anyway
    return true;
}

fn registerAbortTracker(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (client.signals.aborted != null) {
        registerAsyncHTTPAbortTracker(client.async_http_id, socket.socket) catch unreachable;
    }
}

fn unregisterAbortTracker(
    client: *HTTPClient,
) void {
    if (client.signals.aborted != null) {
        _ = unregisterAsyncHTTPAbortTracker(client.async_http_id);
    }
}

pub fn onOpen(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) !void {
    if (comptime Environment.allow_assert) {
        if (client.http_proxy) |proxy| {
            assert(is_ssl == proxy.isHTTPS());
        } else {
            assert(is_ssl == client.url.isHTTPS());
        }
    }
    client.registerAbortTracker(is_ssl, socket);
    log("Connected {s} \n", .{client.url.href});

    if (client.signals.get(.aborted)) {
        client.closeAndAbort(comptime is_ssl, socket);
        return error.ClientAborted;
    }

    if (comptime is_ssl) {
        var ssl_ptr: *BoringSSL.SSL = @ptrCast(socket.getNativeHandle());
        if (!ssl_ptr.isInitFinished()) {
            var _hostname = client.hostname orelse client.url.hostname;
            if (client.http_proxy) |proxy| {
                _hostname = proxy.hostname;
            }

            var hostname: [:0]const u8 = "";
            var hostname_needs_free = false;
            if (!strings.isIPAddress(_hostname)) {
                if (_hostname.len < temp_hostname.len) {
                    @memcpy(temp_hostname[0.._hostname.len], _hostname);
                    temp_hostname[_hostname.len] = 0;
                    hostname = temp_hostname[0.._hostname.len :0];
                } else {
                    hostname = default_allocator.dupeZ(u8, _hostname) catch unreachable;
                    hostname_needs_free = true;
                }
            }

            defer if (hostname_needs_free) default_allocator.free(hostname);

            ssl_ptr.configureHTTPClient(hostname);
        }
    } else {
        client.firstCall(is_ssl, socket);
    }
}

pub fn firstCall(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (comptime FeatureFlags.is_fetch_preconnect_supported) {
        if (client.flags.is_preconnect_only) {
            client.onPreconnect(is_ssl, socket);
            return;
        }
    }

    if (client.state.request_stage == .pending) {
        client.onWritable(true, comptime is_ssl, socket);
    }
}
pub fn onClose(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    log("Closed  {s}\n", .{client.url.href});
    // the socket is closed, we need to unregister the abort tracker
    client.unregisterAbortTracker();

    if (client.signals.get(.aborted)) {
        client.fail(error.Aborted);
        return;
    }
    if (client.proxy_tunnel) |tunnel| {
        client.proxy_tunnel = null;
        // always detach the socket from the tunnel onClose (timeout, connectError will call fail that will do the same)
        tunnel.detachAndDeref();
    }
    const in_progress = client.state.stage != .done and client.state.stage != .fail and client.state.flags.is_redirect_pending == false;
    if (client.state.flags.is_redirect_pending) {
        // if the connection is closed and we are pending redirect just do the redirect
        // in this case we will re-connect or go to a different socket if needed
        client.doRedirect(is_ssl, getHttpContext(is_ssl), socket);
        return;
    }
    if (in_progress) {
        // if the peer closed after a full chunk, treat this
        // as if the transfer had complete, browsers appear to ignore
        // a missing 0\r\n chunk
        if (client.state.isChunkedEncoding()) {
            if (picohttp.phr_decode_chunked_is_in_data(&client.state.chunked_decoder) == 0) {
                const buf = client.state.getBodyBuffer();
                if (buf.list.items.len > 0) {
                    client.state.flags.received_last_chunk = true;
                    client.progressUpdate(comptime is_ssl, getHttpContext(is_ssl), socket);
                    return;
                }
            }
        } else if (client.state.content_length == null and client.state.response_stage == .body) {
            // no content length informed so we are done here
            client.state.flags.received_last_chunk = true;
            client.progressUpdate(comptime is_ssl, getHttpContext(is_ssl), socket);
            return;
        }
    }

    if (client.allow_retry) {
        client.allow_retry = false;
        // we need to retry the request, clean up the response message buffer and start again
        client.state.response_message_buffer.deinit();
        client.start(client.state.original_request_body, client.state.body_out_str.?);
        return;
    }

    if (in_progress) {
        client.fail(error.ConnectionClosed);
    }
}
pub fn onTimeout(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (client.flags.disable_timeout) return;
    log("Timeout  {s}\n", .{client.url.href});

    defer NewHTTPContext(is_ssl).terminateSocket(socket);
    client.fail(error.Timeout);
}
pub fn onConnectError(
    client: *HTTPClient,
) void {
    log("onConnectError  {s}\n", .{client.url.href});
    client.fail(error.ConnectionRefused);
}

pub inline fn getAllocator() std.mem.Allocator {
    return default_allocator;
}

const max_tls_record_size = 16 * 1024;

/// Get the buffer we use to write data to the network.
///
/// For large files, we want to avoid extra network send overhead
/// So we do two things:
/// 1. Use a 32 KB stack buffer for small files
/// 2. Use a 512 KB heap buffer for large files
/// This only has an impact on http://
///
/// On https://, we are limited to a 16 KB TLS record size.
inline fn getRequestBodySendBuffer(this: *@This()) HTTPThread.RequestBodyBuffer {
    const actual_estimated_size = this.state.request_body.len + this.estimatedRequestHeaderByteLength();
    const estimated_size = if (this.isHTTPS()) @min(actual_estimated_size, max_tls_record_size) else actual_estimated_size * 2;
    return http_thread.getRequestBodySendBuffer(estimated_size);
}

pub const Headers = JSC.WebCore.Headers;

pub const SOCKET_FLAGS: u32 = if (Environment.isLinux)
    SOCK.CLOEXEC | posix.MSG.NOSIGNAL
else
    SOCK.CLOEXEC;

pub const OPEN_SOCKET_FLAGS = SOCK.CLOEXEC;

pub const extremely_verbose = false;

fn writeProxyConnect(
    comptime Writer: type,
    writer: Writer,
    client: *HTTPClient,
) !void {
    var port: []const u8 = undefined;
    if (client.url.getPort()) |_| {
        port = client.url.port;
    } else {
        port = if (client.url.isHTTPS()) "443" else "80";
    }
    _ = writer.write("CONNECT ") catch 0;
    _ = writer.write(client.url.hostname) catch 0;
    _ = writer.write(":") catch 0;
    _ = writer.write(port) catch 0;
    _ = writer.write(" HTTP/1.1\r\n") catch 0;

    _ = writer.write("Host: ") catch 0;
    _ = writer.write(client.url.hostname) catch 0;
    _ = writer.write(":") catch 0;
    _ = writer.write(port) catch 0;

    _ = writer.write("\r\nProxy-Connection: Keep-Alive\r\n") catch 0;

    if (client.proxy_authorization) |auth| {
        _ = writer.write("Proxy-Authorization: ") catch 0;
        _ = writer.write(auth) catch 0;
        _ = writer.write("\r\n") catch 0;
    }

    _ = writer.write("\r\n") catch 0;
}

fn writeProxyRequest(
    comptime Writer: type,
    writer: Writer,
    request: picohttp.Request,
    client: *HTTPClient,
) !void {
    var port: []const u8 = undefined;
    if (client.url.getPort()) |_| {
        port = client.url.port;
    } else {
        port = if (client.url.isHTTPS()) "443" else "80";
    }

    _ = writer.write(request.method) catch 0;
    // will always be http:// here, https:// needs CONNECT tunnel
    _ = writer.write(" http://") catch 0;
    _ = writer.write(client.url.hostname) catch 0;
    _ = writer.write(":") catch 0;
    _ = writer.write(port) catch 0;
    _ = writer.write(request.path) catch 0;
    _ = writer.write(" HTTP/1.1\r\nProxy-Connection: Keep-Alive\r\n") catch 0;

    if (client.proxy_authorization) |auth| {
        _ = writer.write("Proxy-Authorization: ") catch 0;
        _ = writer.write(auth) catch 0;
        _ = writer.write("\r\n") catch 0;
    }
    for (request.headers) |header| {
        _ = writer.write(header.name) catch 0;
        _ = writer.write(": ") catch 0;
        _ = writer.write(header.value) catch 0;
        _ = writer.write("\r\n") catch 0;
    }

    _ = writer.write("\r\n") catch 0;
}

fn writeRequest(
    comptime Writer: type,
    writer: Writer,
    request: picohttp.Request,
) !void {
    _ = writer.write(request.method) catch 0;
    _ = writer.write(" ") catch 0;
    _ = writer.write(request.path) catch 0;
    _ = writer.write(" HTTP/1.1\r\n") catch 0;

    for (request.headers) |header| {
        _ = writer.write(header.name) catch 0;
        _ = writer.write(": ") catch 0;
        _ = writer.write(header.value) catch 0;
        _ = writer.write("\r\n") catch 0;
    }

    _ = writer.write("\r\n") catch 0;
}

pub const HTTPStage = enum {
    pending,
    headers,
    body,
    body_chunk,
    fail,
    done,
    proxy_handshake,
    proxy_headers,
    proxy_body,
};

const Decompressor = union(enum) {
    zlib: *Zlib.ZlibReaderArrayList,
    brotli: *Brotli.BrotliReaderArrayList,
    none: void,

    pub fn deinit(this: *Decompressor) void {
        switch (this.*) {
            inline .brotli, .zlib => |that| {
                that.deinit();
                this.* = .{ .none = {} };
            },
            .none => {},
        }
    }

    pub fn updateBuffers(this: *Decompressor, encoding: Encoding, buffer: []const u8, body_out_str: *MutableString) !void {
        if (!encoding.isCompressed()) {
            return;
        }

        if (this.* == .none) {
            switch (encoding) {
                .gzip, .deflate => {
                    this.* = .{
                        .zlib = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            default_allocator,
                            .{
                                // zlib.MAX_WBITS = 15
                                // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                                // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                                // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                                .windowBits = if (encoding == Encoding.gzip) Zlib.MAX_WBITS | 16 else (if (buffer.len > 1 and buffer[0] == 120) 0 else -Zlib.MAX_WBITS),
                            },
                        ),
                    };
                    return;
                },
                .brotli => {
                    this.* = .{
                        .brotli = try Brotli.BrotliReaderArrayList.newWithOptions(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            .{},
                        ),
                    };
                    return;
                },
                else => @panic("Invalid encoding. This code should not be reachable"),
            }
        }

        switch (this.*) {
            .zlib => |reader| {
                assert(reader.zlib.avail_in == 0);
                reader.zlib.next_in = buffer.ptr;
                reader.zlib.avail_in = @as(u32, @truncate(buffer.len));

                const initial = body_out_str.list.items.len;
                body_out_str.list.expandToCapacity();
                if (body_out_str.list.capacity == initial) {
                    try body_out_str.list.ensureUnusedCapacity(body_out_str.allocator, 4096);
                    body_out_str.list.expandToCapacity();
                }
                reader.list = body_out_str.list;
                reader.zlib.next_out = @ptrCast(&body_out_str.list.items[initial]);
                reader.zlib.avail_out = @as(u32, @truncate(body_out_str.list.capacity - initial));
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = @truncate(initial);
            },
            .brotli => |reader| {
                reader.input = buffer;
                reader.total_in = 0;

                const initial = body_out_str.list.items.len;
                reader.list = body_out_str.list;
                reader.total_out = @truncate(initial);
            },
            else => @panic("Invalid encoding. This code should not be reachable"),
        }
    }

    pub fn readAll(this: *Decompressor, is_done: bool) !void {
        switch (this.*) {
            .zlib => |zlib| try zlib.readAll(),
            .brotli => |brotli| try brotli.readAll(is_done),
            .none => {},
        }
    }
};

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
pub const InternalState = struct {
    response_message_buffer: MutableString = undefined,
    /// pending response is the temporary storage for the response headers, url and status code
    /// this uses shared_response_headers_buf to store the headers
    /// this will be turned null once the metadata is cloned
    pending_response: ?picohttp.Response = null,

    /// This is the cloned metadata containing the response headers, url and status code after the .headers phase are received
    /// will be turned null once returned to the user (the ownership is transferred to the user)
    /// this can happen after await fetch(...) and the body can continue streaming when this is already null
    /// the user will receive only chunks of the body stored in body_out_str
    cloned_metadata: ?HTTPResponseMetadata = null,
    flags: InternalStateFlags = InternalStateFlags{},

    transfer_encoding: Encoding = Encoding.identity,
    encoding: Encoding = Encoding.identity,
    content_encoding_i: u8 = std.math.maxInt(u8),
    chunked_decoder: picohttp.phr_chunked_decoder = .{},
    decompressor: Decompressor = .{ .none = {} },
    stage: Stage = Stage.pending,
    /// This is owned by the user and should not be freed here
    body_out_str: ?*MutableString = null,
    compressed_body: MutableString = undefined,
    content_length: ?usize = null,
    total_body_received: usize = 0,
    request_body: []const u8 = "",
    original_request_body: HTTPRequestBody = .{ .bytes = "" },
    request_sent_len: usize = 0,
    fail: ?anyerror = null,
    request_stage: HTTPStage = .pending,
    response_stage: HTTPStage = .pending,
    certificate_info: ?CertificateInfo = null,

    pub const InternalStateFlags = packed struct {
        allow_keepalive: bool = true,
        received_last_chunk: bool = false,
        did_set_content_encoding: bool = false,
        is_redirect_pending: bool = false,
        is_libdeflate_fast_path_disabled: bool = false,
        resend_request_body_on_redirect: bool = false,
    };

    pub fn init(body: HTTPRequestBody, body_out_str: *MutableString) InternalState {
        return .{
            .original_request_body = body,
            .request_body = if (body == .bytes) body.bytes else "",
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .body_out_str = body_out_str,
            .stage = Stage.pending,
            .pending_response = null,
        };
    }

    pub fn isChunkedEncoding(this: *InternalState) bool {
        return this.transfer_encoding == Encoding.chunked;
    }

    pub fn reset(this: *InternalState, allocator: std.mem.Allocator) void {
        this.compressed_body.deinit();
        this.response_message_buffer.deinit();

        const body_msg = this.body_out_str;
        if (body_msg) |body| body.reset();
        this.decompressor.deinit();

        // just in case we check and free to avoid leaks
        if (this.cloned_metadata != null) {
            this.cloned_metadata.?.deinit(allocator);
            this.cloned_metadata = null;
        }

        // if exists we own this info
        if (this.certificate_info) |info| {
            this.certificate_info = null;
            info.deinit(default_allocator);
        }

        this.original_request_body.deinit();
        this.* = .{
            .body_out_str = body_msg,
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .original_request_body = .{ .bytes = "" },
            .request_body = "",
            .certificate_info = null,
            .flags = .{},
        };
    }

    pub fn getBodyBuffer(this: *InternalState) *MutableString {
        if (this.encoding.isCompressed()) {
            return &this.compressed_body;
        }

        return this.body_out_str.?;
    }

    fn isDone(this: *InternalState) bool {
        if (this.isChunkedEncoding()) {
            return this.flags.received_last_chunk;
        }

        if (this.content_length) |content_length| {
            return this.total_body_received >= content_length;
        }

        // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        return this.flags.received_last_chunk;
    }

    fn decompressBytes(this: *InternalState, buffer: []const u8, body_out_str: *MutableString, is_final_chunk: bool) !void {
        defer this.compressed_body.reset();
        var gzip_timer: std.time.Timer = undefined;

        if (extremely_verbose)
            gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

        var still_needs_to_decompress = true;

        if (FeatureFlags.isLibdeflateEnabled()) {
            // Fast-path: use libdeflate
            if (is_final_chunk and !this.flags.is_libdeflate_fast_path_disabled and this.encoding.canUseLibDeflate() and this.isDone()) libdeflate: {
                this.flags.is_libdeflate_fast_path_disabled = true;

                log("Decompressing {d} bytes with libdeflate\n", .{buffer.len});
                var deflater = http_thread.deflater();

                // gzip stores the size of the uncompressed data in the last 4 bytes of the stream
                // But it's only valid if the stream is less than 4.7 GB, since it's 4 bytes.
                // If we know that the stream is going to be larger than our
                // pre-allocated buffer, then let's dynamically allocate the exact
                // size.
                if (this.encoding == Encoding.gzip and buffer.len > 16 and buffer.len < 1024 * 1024 * 1024) {
                    const estimated_size: u32 = @bitCast(buffer[buffer.len - 4 ..][0..4].*);
                    // Since this is arbtirary input from the internet, let's set an upper bound of 32 MB for the allocation size.
                    if (estimated_size > deflater.shared_buffer.len and estimated_size < 32 * 1024 * 1024) {
                        try body_out_str.list.ensureTotalCapacityPrecise(body_out_str.allocator, estimated_size);
                        const result = deflater.decompressor.decompress(buffer, body_out_str.list.allocatedSlice(), .gzip);

                        if (result.status == .success) {
                            body_out_str.list.items.len = result.written;
                            still_needs_to_decompress = false;
                        }

                        break :libdeflate;
                    }
                }

                const result = deflater.decompressor.decompress(buffer, &deflater.shared_buffer, switch (this.encoding) {
                    .gzip => .gzip,
                    .deflate => .deflate,
                    else => unreachable,
                });

                if (result.status == .success) {
                    try body_out_str.list.ensureTotalCapacityPrecise(body_out_str.allocator, result.written);
                    body_out_str.list.appendSliceAssumeCapacity(deflater.shared_buffer[0..result.written]);
                    still_needs_to_decompress = false;
                }
            }
        }

        // Slow path, or brotli: use the .decompressor
        if (still_needs_to_decompress) {
            log("Decompressing {d} bytes\n", .{buffer.len});
            if (body_out_str.list.capacity == 0) {
                const min = @min(@ceil(@as(f64, @floatFromInt(buffer.len)) * 1.5), @as(f64, 1024 * 1024 * 2));
                try body_out_str.growBy(@max(@as(usize, @intFromFloat(min)), 32));
            }

            try this.decompressor.updateBuffers(this.encoding, buffer, body_out_str);

            this.decompressor.readAll(this.isDone()) catch |err| {
                if (this.isDone() or error.ShortRead != err) {
                    Output.prettyErrorln("<r><red>Decompression error: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                    Output.flush();
                    return err;
                }
            };
        }

        if (extremely_verbose)
            this.gzip_elapsed = gzip_timer.read();
    }

    fn decompress(this: *InternalState, buffer: MutableString, body_out_str: *MutableString, is_final_chunk: bool) !void {
        try this.decompressBytes(buffer.list.items, body_out_str, is_final_chunk);
    }

    pub fn processBodyBuffer(this: *InternalState, buffer: MutableString, is_final_chunk: bool) !bool {
        if (this.flags.is_redirect_pending) return false;

        var body_out_str = this.body_out_str.?;

        switch (this.encoding) {
            Encoding.brotli, Encoding.gzip, Encoding.deflate => {
                try this.decompress(buffer, body_out_str, is_final_chunk);
            },
            else => {
                if (!body_out_str.owns(buffer.list.items)) {
                    body_out_str.append(buffer.list.items) catch |err| {
                        Output.prettyErrorln("<r><red>Failed to append to body buffer: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                        Output.flush();
                        return err;
                    };
                }
            },
        }

        return this.body_out_str.?.list.items.len > 0;
    }
};

const default_redirect_count = 127;

pub const Flags = packed struct {
    disable_timeout: bool = false,
    disable_keepalive: bool = false,
    disable_decompression: bool = false,
    did_have_handshaking_error: bool = false,
    force_last_modified: bool = false,
    redirected: bool = false,
    proxy_tunneling: bool = false,
    reject_unauthorized: bool = true,
    is_preconnect_only: bool = false,
    is_streaming_request_body: bool = false,
};

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
method: Method,
header_entries: Headers.Entry.List,
header_buf: string,
url: URL,
connected_url: URL = URL{},
allocator: std.mem.Allocator,
verbose: HTTPVerboseLevel = .none,
remaining_redirect_count: i8 = default_redirect_count,
allow_retry: bool = false,
redirect_type: FetchRedirect = FetchRedirect.follow,
redirect: []u8 = &.{},
progress_node: ?*Progress.Node = null,

flags: Flags = Flags{},

state: InternalState = .{},
tls_props: ?*SSLConfig = null,
result_callback: HTTPClientResult.Callback = undefined,

/// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
/// This is a workaround for that.
if_modified_since: string = "",
request_content_len_buf: ["-4294967295".len]u8 = undefined,

http_proxy: ?URL = null,
proxy_authorization: ?[]u8 = null,
proxy_tunnel: ?*ProxyTunnel = null,
signals: Signals = .{},
async_http_id: u32 = 0,
hostname: ?[]u8 = null,
unix_socket_path: JSC.ZigString.Slice = JSC.ZigString.Slice.empty,

pub fn deinit(this: *HTTPClient) void {
    if (this.redirect.len > 0) {
        default_allocator.free(this.redirect);
        this.redirect = &.{};
    }
    if (this.proxy_authorization) |auth| {
        this.allocator.free(auth);
        this.proxy_authorization = null;
    }
    if (this.proxy_tunnel) |tunnel| {
        this.proxy_tunnel = null;
        tunnel.detachAndDeref();
    }
    this.unix_socket_path.deinit();
    this.unix_socket_path = JSC.ZigString.Slice.empty;
}

pub fn isKeepAlivePossible(this: *HTTPClient) bool {
    if (comptime FeatureFlags.enable_keepalive) {
        // TODO keepalive for unix sockets
        if (this.unix_socket_path.length() > 0) return false;
        // is not possible to reuse Proxy with TSL, so disable keepalive if url is tunneling HTTPS
        if (this.http_proxy != null and this.url.isHTTPS()) {
            return false;
        }

        //check state
        if (this.state.flags.allow_keepalive and !this.flags.disable_keepalive) return true;
    }
    return false;
}

const Stage = enum(u8) {
    pending,
    connect,
    done,
    fail,
};

// lowercase hash header names so that we can be sure
pub fn hashHeaderName(name: string) u64 {
    var hasher = std.hash.Wyhash.init(0);
    var remain = name;

    var buf: [@sizeOf(@TypeOf(hasher.buf))]u8 = undefined;

    while (remain.len > 0) {
        const end = @min(hasher.buf.len, remain.len);

        hasher.update(strings.copyLowercaseIfNeeded(remain[0..end], &buf));
        remain = remain[end..];
    }

    return hasher.final();
}

pub fn hashHeaderConst(comptime name: string) u64 {
    var hasher = std.hash.Wyhash.init(0);
    var remain = name;
    var buf: [hasher.buf.len]u8 = undefined;

    while (remain.len > 0) {
        const end = @min(hasher.buf.len, remain.len);

        hasher.update(std.ascii.lowerString(&buf, remain[0..end]));
        remain = remain[end..];
    }

    return hasher.final();
}

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const chunked_encoded_header = picohttp.Header{ .name = "Transfer-Encoding", .value = "chunked" };
const connection_header = picohttp.Header{ .name = "Connection", .value = "keep-alive" };
const connection_closing_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "gzip, deflate, br";
const accept_encoding_header_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression };
const accept_encoding_header_no_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_no_compression };

const accept_encoding_header = if (FeatureFlags.disable_compression_in_http_client)
    accept_encoding_header_no_compression
else
    accept_encoding_header_compression;

const user_agent_header = picohttp.Header{ .name = "User-Agent", .value = Global.user_agent };

pub fn headerStr(this: *const HTTPClient, ptr: Api.StringPointer) string {
    return this.header_buf[ptr.offset..][0..ptr.length];
}

pub const HeaderBuilder = @import("./http/header_builder.zig");

const HTTPCallbackPair = .{ *AsyncHTTP, HTTPClientResult };
pub const HTTPChannel = @import("./sync.zig").Channel(HTTPCallbackPair, .{ .Static = 1000 });
// 32 pointers much cheaper than 1000 pointers
const SingleHTTPChannel = struct {
    const SingleHTTPCHannel_ = @import("./sync.zig").Channel(HTTPClientResult, .{ .Static = 8 });
    channel: SingleHTTPCHannel_,
    pub fn reset(_: *@This()) void {}
    pub fn init() SingleHTTPChannel {
        return SingleHTTPChannel{ .channel = SingleHTTPCHannel_.init() };
    }
};

pub const HTTPChannelContext = struct {
    http: AsyncHTTP = undefined,
    channel: *HTTPChannel,

    pub fn callback(data: HTTPCallbackPair) void {
        var this: *HTTPChannelContext = @fieldParentPtr("http", data.@"0");
        this.channel.writeItem(data) catch unreachable;
    }
};

pub fn buildRequest(this: *HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    const header_names = header_entries.items(.name);
    const header_values = header_entries.items(.value);
    var request_headers_buf = &shared_request_headers_buf;

    var override_accept_encoding = false;
    var override_accept_header = false;
    var override_host_header = false;
    var override_user_agent = false;

    for (header_names, 0..) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            hashHeaderConst("Content-Length"),
            => continue,
            hashHeaderConst("Connection") => {
                if (!this.flags.disable_keepalive) {
                    continue;
                }
            },
            hashHeaderConst("if-modified-since") => {
                if (this.flags.force_last_modified and this.if_modified_since.len == 0) {
                    this.if_modified_since = this.headerStr(header_values[i]);
                }
            },
            hashHeaderConst(host_header_name) => {
                override_host_header = true;
            },
            hashHeaderConst("Accept") => {
                override_accept_header = true;
            },
            hashHeaderConst("User-Agent") => {
                override_user_agent = true;
            },
            hashHeaderConst("Accept-Encoding") => {
                override_accept_encoding = true;
            },
            else => {},
        }

        request_headers_buf[header_count] = .{
            .name = name,
            .value = this.headerStr(header_values[i]),
        };

        // header_name_hashes[header_count] = hash;

        // // ensure duplicate headers come after each other
        // if (header_count > 2) {
        //     var head_i: usize = header_count - 1;
        //     while (head_i > 0) : (head_i -= 1) {
        //         if (header_name_hashes[head_i] == header_name_hashes[header_count]) {
        //             std.mem.swap(picohttp.Header, &header_name_hashes[header_count], &header_name_hashes[head_i + 1]);
        //             std.mem.swap(u64, &request_headers_buf[header_count], &request_headers_buf[head_i + 1]);
        //             break;
        //         }
        //     }
        // }
        header_count += 1;
    }

    if (!this.flags.disable_keepalive) {
        request_headers_buf[header_count] = connection_header;
        header_count += 1;
    }

    if (!override_user_agent) {
        request_headers_buf[header_count] = user_agent_header;
        header_count += 1;
    }

    if (!override_accept_header) {
        request_headers_buf[header_count] = accept_header;
        header_count += 1;
    }

    if (!override_host_header) {
        request_headers_buf[header_count] = .{
            .name = host_header_name,
            .value = this.url.host,
        };
        header_count += 1;
    }

    if (!override_accept_encoding and !this.flags.disable_decompression) {
        request_headers_buf[header_count] = accept_encoding_header;

        header_count += 1;
    }

    if (body_len > 0 or this.method.hasRequestBody()) {
        if (this.flags.is_streaming_request_body) {
            request_headers_buf[header_count] = chunked_encoded_header;
        } else {
            request_headers_buf[header_count] = .{
                .name = content_length_header_name,
                .value = std.fmt.bufPrint(&this.request_content_len_buf, "{d}", .{body_len}) catch "0",
            };
        }
        header_count += 1;
    }

    return picohttp.Request{
        .method = @tagName(this.method),
        .path = this.url.pathname,
        .minor_version = 1,
        .headers = request_headers_buf[0..header_count],
    };
}

pub fn doRedirect(
    this: *HTTPClient,
    comptime is_ssl: bool,
    ctx: *NewHTTPContext(is_ssl),
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    log("doRedirect", .{});
    if (this.state.original_request_body == .stream) {
        // we cannot follow redirect from a stream right now
        // NOTE: we can use .tee(), reset the readable stream and cancel/wait pending write requests before redirecting. node.js just errors here so we just closeAndFail too.
        this.closeAndFail(error.UnexpectedRedirect, is_ssl, socket);
        return;
    }

    this.unix_socket_path.deinit();
    this.unix_socket_path = JSC.ZigString.Slice.empty;
    // TODO: what we do with stream body?
    const request_body = if (this.state.flags.resend_request_body_on_redirect and this.state.original_request_body == .bytes)
        this.state.original_request_body.bytes
    else
        "";

    this.state.response_message_buffer.deinit();

    const body_out_str = this.state.body_out_str.?;
    this.remaining_redirect_count -|= 1;
    this.flags.redirected = true;
    assert(this.redirect_type == FetchRedirect.follow);
    this.unregisterAbortTracker();

    // we need to clean the client reference before closing the socket because we are going to reuse the same ref in a another request
    if (this.isKeepAlivePossible()) {
        assert(this.connected_url.hostname.len > 0);
        ctx.releaseSocket(
            socket,
            this.flags.did_have_handshaking_error and !this.flags.reject_unauthorized,
            this.connected_url.hostname,
            this.connected_url.getPortAuto(),
        );
    } else {
        NewHTTPContext(is_ssl).closeSocket(socket);
    }
    this.connected_url = URL{};

    // TODO: should this check be before decrementing the redirect count?
    // the current logic will allow one less redirect than requested
    if (this.remaining_redirect_count == 0) {
        this.fail(error.TooManyRedirects);
        return;
    }
    this.state.reset(this.allocator);
    log("doRedirect state reset", .{});
    // also reset proxy to redirect
    this.flags.proxy_tunneling = false;
    if (this.proxy_tunnel) |tunnel| {
        this.proxy_tunnel = null;
        tunnel.detachAndDeref();
    }

    return this.start(.{ .bytes = request_body }, body_out_str);
}
pub fn isHTTPS(this: *HTTPClient) bool {
    if (this.http_proxy) |proxy| {
        if (proxy.isHTTPS()) {
            return true;
        }
        return false;
    }
    if (this.url.isHTTPS()) {
        return true;
    }
    return false;
}
pub fn start(this: *HTTPClient, body: HTTPRequestBody, body_out_str: *MutableString) void {
    body_out_str.reset();

    assert(this.state.response_message_buffer.list.capacity == 0);
    this.state = InternalState.init(body, body_out_str);

    if (this.isHTTPS()) {
        this.start_(true);
    } else {
        this.start_(false);
    }
}

fn start_(this: *HTTPClient, comptime is_ssl: bool) void {
    // Aborted before connecting
    if (this.signals.get(.aborted)) {
        this.fail(error.AbortedBeforeConnecting);
        return;
    }

    var socket = http_thread.connect(this, is_ssl) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());

        this.fail(err);
        return;
    };

    if (socket.isClosed() and (this.state.response_stage != .done and this.state.response_stage != .fail)) {
        NewHTTPContext(is_ssl).markSocketAsDead(socket);
        this.fail(error.ConnectionClosed);
        return;
    }
}

fn printRequest(request: picohttp.Request, url: string, ignore_insecure: bool, body: []const u8, curl: bool) void {
    @branchHint(.cold);
    var request_ = request;
    request_.path = url;

    if (curl) {
        Output.prettyErrorln("{}", .{request_.curl(ignore_insecure, body)});
    }

    Output.prettyErrorln("{}", .{request_});

    Output.flush();
}

fn printResponse(response: picohttp.Response) void {
    @branchHint(.cold);
    Output.prettyErrorln("{}", .{response});
    Output.flush();
}

pub fn onPreconnect(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("onPreconnect({})", .{this.url});
    this.unregisterAbortTracker();
    const ctx = getHttpContext(is_ssl);
    ctx.releaseSocket(
        socket,
        this.flags.did_have_handshaking_error and !this.flags.reject_unauthorized,
        this.url.hostname,
        this.url.getPortAuto(),
    );

    this.state.reset(this.allocator);
    this.state.response_stage = .done;
    this.state.request_stage = .done;
    this.state.stage = .done;
    this.flags.proxy_tunneling = false;
    this.result_callback.run(@fieldParentPtr("client", this), HTTPClientResult{ .fail = null, .metadata = null, .has_more = false });
}

fn estimatedRequestHeaderByteLength(this: *const HTTPClient) usize {
    const sliced = this.header_entries.slice();
    var count: usize = 0;
    for (sliced.items(.name)) |head| {
        count += @as(usize, head.length);
    }
    for (sliced.items(.value)) |value| {
        count += @as(usize, value.length);
    }
    return count;
}

const InitialRequestPayloadResult = struct {
    has_sent_headers: bool,
    has_sent_body: bool,
    try_sending_more_data: bool,
};

// This exists as a separate function to reduce the amount of time the request body buffer is kept around.
noinline fn sendInitialRequestPayload(this: *HTTPClient, comptime is_first_call: bool, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !InitialRequestPayloadResult {
    var request_body_buffer = this.getRequestBodySendBuffer();
    defer request_body_buffer.deinit();
    var temporary_send_buffer = request_body_buffer.toArrayList();
    defer temporary_send_buffer.deinit();

    const writer = &temporary_send_buffer.writer();

    const request = this.buildRequest(this.state.original_request_body.len());

    if (this.http_proxy) |_| {
        if (this.url.isHTTPS()) {
            //DO the tunneling!
            this.flags.proxy_tunneling = true;
            try writeProxyConnect(@TypeOf(writer), writer, this);
        } else {
            // HTTP do not need tunneling with CONNECT just a slightly different version of the request
            try writeProxyRequest(
                @TypeOf(writer),
                writer,
                request,
                this,
            );
        }
    } else {
        try writeRequest(
            @TypeOf(writer),
            writer,
            request,
        );
    }

    const headers_len = temporary_send_buffer.items.len;
    assert(temporary_send_buffer.items.len == writer.context.items.len);
    if (this.state.request_body.len > 0 and temporary_send_buffer.capacity - temporary_send_buffer.items.len > 0 and !this.flags.proxy_tunneling) {
        var remain = temporary_send_buffer.items.ptr[temporary_send_buffer.items.len..temporary_send_buffer.capacity];
        const wrote = @min(remain.len, this.state.request_body.len);
        assert(wrote > 0);
        @memcpy(remain[0..wrote], this.state.request_body[0..wrote]);
        temporary_send_buffer.items.len += wrote;
    }

    const to_send = temporary_send_buffer.items[this.state.request_sent_len..];
    if (comptime Environment.allow_assert) {
        assert(!socket.isShutdown());
        assert(!socket.isClosed());
    }
    const amount = socket.write(
        to_send,
        false,
    );
    if (comptime is_first_call) {
        if (amount == 0) {
            // don't worry about it
            return .{
                .has_sent_headers = this.state.request_sent_len >= headers_len,
                .has_sent_body = false,
                .try_sending_more_data = false,
            };
        }
    }

    if (amount < 0) {
        return error.WriteFailed;
    }

    this.state.request_sent_len += @as(usize, @intCast(amount));
    const has_sent_headers = this.state.request_sent_len >= headers_len;

    if (has_sent_headers and this.verbose != .none) {
        printRequest(request, this.url.href, !this.flags.reject_unauthorized, this.state.request_body, this.verbose == .curl);
    }

    if (has_sent_headers and this.state.request_body.len > 0) {
        this.state.request_body = this.state.request_body[this.state.request_sent_len - headers_len ..];
    }

    const has_sent_body = if (this.state.original_request_body == .bytes)
        this.state.request_body.len == 0
    else
        false;

    return .{
        .has_sent_headers = has_sent_headers,
        .has_sent_body = has_sent_body,
        .try_sending_more_data = amount == @as(c_int, @intCast(to_send.len)) and (!has_sent_body or !has_sent_headers),
    };
}

pub fn onWritable(this: *HTTPClient, comptime is_first_call: bool, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.signals.get(.aborted)) {
        this.closeAndAbort(is_ssl, socket);
        return;
    }

    if (comptime FeatureFlags.is_fetch_preconnect_supported) {
        if (this.flags.is_preconnect_only) {
            this.onPreconnect(is_ssl, socket);
            return;
        }
    }

    if (this.proxy_tunnel) |proxy| {
        proxy.onWritable(is_ssl, socket);
    }

    switch (this.state.request_stage) {
        .pending, .headers => {
            this.setTimeout(socket, 5);
            const result = sendInitialRequestPayload(this, is_first_call, is_ssl, socket) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };
            const has_sent_headers = result.has_sent_headers;
            const has_sent_body = result.has_sent_body;
            const try_sending_more_data = result.try_sending_more_data;

            if (has_sent_headers and has_sent_body) {
                if (this.flags.proxy_tunneling) {
                    this.state.request_stage = .proxy_handshake;
                } else {
                    this.state.request_stage = .body;
                    if (this.flags.is_streaming_request_body) {
                        // lets signal to start streaming the body
                        this.progressUpdate(is_ssl, getHttpContext(is_ssl), socket);
                    }
                }
                return;
            }

            if (has_sent_headers) {
                if (this.flags.proxy_tunneling) {
                    this.state.request_stage = .proxy_handshake;
                } else {
                    this.state.request_stage = .body;
                    if (this.flags.is_streaming_request_body) {
                        // lets signal to start streaming the body
                        this.progressUpdate(is_ssl, getHttpContext(is_ssl), socket);
                    }
                }
                assert(
                    // we should have leftover data OR we use sendfile/stream
                    (this.state.original_request_body == .bytes and this.state.request_body.len > 0) or
                        this.state.original_request_body == .sendfile or this.state.original_request_body == .stream,
                );

                // we sent everything, but there's some body left over
                if (try_sending_more_data) {
                    this.onWritable(false, is_ssl, socket);
                }
            } else {
                this.state.request_stage = .headers;
            }
        },
        .body => {
            this.setTimeout(socket, 5);

            switch (this.state.original_request_body) {
                .bytes => {
                    const to_send = this.state.request_body;
                    const amount = socket.write(to_send, true);
                    if (amount < 0) {
                        this.closeAndFail(error.WriteFailed, is_ssl, socket);
                        return;
                    }

                    this.state.request_sent_len += @as(usize, @intCast(amount));
                    this.state.request_body = this.state.request_body[@as(usize, @intCast(amount))..];

                    if (this.state.request_body.len == 0) {
                        this.state.request_stage = .done;
                        return;
                    }
                },
                .stream => {
                    var stream = &this.state.original_request_body.stream;
                    stream.has_backpressure = false;
                    // to simplify things here the buffer contains the raw data we just need to flush to the socket it
                    if (stream.buffer.isNotEmpty()) {
                        const to_send = stream.buffer.slice();
                        const amount = socket.write(to_send, true);
                        if (amount < 0) {
                            this.closeAndFail(error.WriteFailed, is_ssl, socket);
                            return;
                        }
                        this.state.request_sent_len += @as(usize, @intCast(amount));
                        stream.buffer.cursor += @intCast(amount);
                        if (amount < to_send.len) {
                            stream.has_backpressure = true;
                        }
                        if (stream.buffer.isEmpty()) {
                            stream.buffer.reset();
                        }
                    }
                    if (stream.hasEnded()) {
                        this.state.request_stage = .done;
                        stream.buffer.deinit();
                        return;
                    }
                },
                .sendfile => |*sendfile| {
                    if (comptime is_ssl) {
                        @panic("sendfile is only supported without SSL. This code should never have been reached!");
                    }

                    switch (sendfile.write(socket)) {
                        .done => {
                            this.state.request_stage = .done;
                            return;
                        },
                        .err => |err| {
                            this.closeAndFail(err, false, socket);
                            return;
                        },
                        .again => {
                            socket.markNeedsMoreForSendfile();
                        },
                    }
                },
            }
        },
        .proxy_body => {
            if (this.proxy_tunnel) |proxy| {
                switch (this.state.original_request_body) {
                    .bytes => {
                        this.setTimeout(socket, 5);

                        const to_send = this.state.request_body;
                        const amount = proxy.writeData(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose

                        this.state.request_sent_len += @as(usize, @intCast(amount));
                        this.state.request_body = this.state.request_body[@as(usize, @intCast(amount))..];

                        if (this.state.request_body.len == 0) {
                            this.state.request_stage = .done;
                            return;
                        }
                    },
                    .stream => {
                        var stream = &this.state.original_request_body.stream;
                        stream.has_backpressure = false;

                        // to simplify things here the buffer contains the raw data we just need to flush to the socket it
                        if (stream.buffer.isNotEmpty()) {
                            const to_send = stream.buffer.slice();
                            const amount = proxy.writeData(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose
                            this.state.request_sent_len += amount;
                            stream.buffer.cursor += @truncate(amount);
                            if (amount < to_send.len) {
                                stream.has_backpressure = true;
                            }
                            if (stream.buffer.isEmpty()) {
                                stream.buffer.reset();
                            }
                        }
                        if (stream.hasEnded()) {
                            this.state.request_stage = .done;
                            stream.buffer.deinit();
                            return;
                        }
                    },
                    .sendfile => {
                        @panic("sendfile is only supported without SSL. This code should never have been reached!");
                    },
                }
            }
        },
        .proxy_headers => {
            if (this.proxy_tunnel) |proxy| {
                this.setTimeout(socket, 5);
                var stack_buffer = std.heap.stackFallback(1024 * 16, default_allocator);
                const allocator = stack_buffer.get();
                var temporary_send_buffer = std.ArrayList(u8).fromOwnedSlice(allocator, &stack_buffer.buffer);
                temporary_send_buffer.items.len = 0;
                defer temporary_send_buffer.deinit();
                const writer = &temporary_send_buffer.writer();

                const request = this.buildRequest(this.state.request_body.len);
                writeRequest(
                    @TypeOf(writer),
                    writer,
                    request,
                ) catch {
                    this.closeAndFail(error.OutOfMemory, is_ssl, socket);
                    return;
                };

                const headers_len = temporary_send_buffer.items.len;
                assert(temporary_send_buffer.items.len == writer.context.items.len);
                if (this.state.request_body.len > 0 and temporary_send_buffer.capacity - temporary_send_buffer.items.len > 0) {
                    var remain = temporary_send_buffer.items.ptr[temporary_send_buffer.items.len..temporary_send_buffer.capacity];
                    const wrote = @min(remain.len, this.state.request_body.len);
                    assert(wrote > 0);
                    @memcpy(remain[0..wrote], this.state.request_body[0..wrote]);
                    temporary_send_buffer.items.len += wrote;
                }

                const to_send = temporary_send_buffer.items[this.state.request_sent_len..];
                if (comptime Environment.allow_assert) {
                    assert(!socket.isShutdown());
                    assert(!socket.isClosed());
                }
                const amount = proxy.writeData(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose

                if (comptime is_first_call) {
                    if (amount == 0) {
                        // don't worry about it
                        return;
                    }
                }

                this.state.request_sent_len += @as(usize, @intCast(amount));
                const has_sent_headers = this.state.request_sent_len >= headers_len;

                if (has_sent_headers and this.state.request_body.len > 0) {
                    this.state.request_body = this.state.request_body[this.state.request_sent_len - headers_len ..];
                }

                const has_sent_body = this.state.request_body.len == 0;

                if (has_sent_headers and has_sent_body) {
                    this.state.request_stage = .done;
                    return;
                }

                if (has_sent_headers) {
                    this.state.request_stage = .proxy_body;
                    if (this.flags.is_streaming_request_body) {
                        // lets signal to start streaming the body
                        this.progressUpdate(is_ssl, getHttpContext(is_ssl), socket);
                    }
                    assert(this.state.request_body.len > 0);

                    // we sent everything, but there's some body leftover
                    if (amount == @as(c_int, @intCast(to_send.len))) {
                        this.onWritable(false, is_ssl, socket);
                    }
                } else {
                    this.state.request_stage = .proxy_headers;
                }
            }
        },
        else => {},
    }
}

pub fn closeAndFail(this: *HTTPClient, err: anyerror, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("closeAndFail: {s}", .{@errorName(err)});
    if (!socket.isClosed()) {
        NewHTTPContext(is_ssl).terminateSocket(socket);
    }
    this.fail(err);
}

fn startProxyHandshake(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    // if we have options we pass them (ca, reject_unauthorized, etc) otherwise use the default
    const ssl_options = if (this.tls_props != null) this.tls_props.?.* else JSC.API.ServerConfig.SSLConfig.zero;
    ProxyTunnel.start(this, is_ssl, socket, ssl_options);
}

inline fn handleShortRead(
    this: *HTTPClient,
    comptime is_ssl: bool,
    incoming_data: []const u8,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
    needs_move: bool,
) void {
    if (needs_move) {
        const to_copy = incoming_data;

        if (to_copy.len > 0) {
            // this one will probably be another chunk, so we leave a little extra room
            this.state.response_message_buffer.append(to_copy) catch bun.outOfMemory();
        }
    }

    this.setTimeout(socket, 5);
}

pub fn handleOnDataHeaders(
    this: *HTTPClient,
    comptime is_ssl: bool,
    incoming_data: []const u8,
    ctx: *NewHTTPContext(is_ssl),
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    var to_read = incoming_data;
    var amount_read: usize = 0;
    var needs_move = true;
    if (this.state.response_message_buffer.list.items.len > 0) {
        // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
        this.state.response_message_buffer.appendSliceExact(incoming_data) catch bun.outOfMemory();
        to_read = this.state.response_message_buffer.list.items;
        needs_move = false;
    }

    // we reset the pending_response each time wich means that on parse error this will be always be empty
    this.state.pending_response = picohttp.Response{};

    // minimal http/1.1 request size is 16 bytes without headers and 26 with Host header
    // if is less than 16 will always be a ShortRead
    if (to_read.len < 16) {
        this.handleShortRead(is_ssl, incoming_data, socket, needs_move);
        return;
    }

    var response = picohttp.Response.parseParts(
        to_read,
        &shared_response_headers_buf,
        &amount_read,
    ) catch |err| {
        switch (err) {
            error.ShortRead => {
                this.handleShortRead(is_ssl, incoming_data, socket, needs_move);
            },
            else => {
                this.closeAndFail(err, is_ssl, socket);
            },
        }
        return;
    };

    // we save the successful parsed response
    this.state.pending_response = response;

    const body_buf = to_read[@min(@as(usize, @intCast(response.bytes_read)), to_read.len)..];
    // handle the case where we have a 100 Continue
    if (response.status_code == 100) {
        // we still can have the 200 OK in the same buffer sometimes
        if (body_buf.len > 0) {
            this.onData(is_ssl, body_buf, ctx, socket);
        }
        return;
    }
    const should_continue = this.handleResponseMetadata(
        &response,
    ) catch |err| {
        this.closeAndFail(err, is_ssl, socket);
        return;
    };

    if (this.state.content_encoding_i < response.headers.list.len and !this.state.flags.did_set_content_encoding) {
        // if it compressed with this header, it is no longer because we will decompress it
        const mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers.list, .capacity = response.headers.list.len };
        this.state.flags.did_set_content_encoding = true;
        response.headers = .{ .list = mutable_headers.items };
        this.state.content_encoding_i = std.math.maxInt(@TypeOf(this.state.content_encoding_i));
        // we need to reset the pending response because we removed a header
        this.state.pending_response = response;
    }

    if (should_continue == .finished) {
        if (this.state.flags.is_redirect_pending) {
            this.doRedirect(is_ssl, ctx, socket);
            return;
        }
        // this means that the request ended
        // clone metadata and return the progress at this point
        this.cloneMetadata();
        // if is chuncked but no body is expected we mark the last chunk
        this.state.flags.received_last_chunk = true;
        // if is not we ignore the content_length
        this.state.content_length = 0;
        this.progressUpdate(is_ssl, ctx, socket);
        return;
    }

    if (this.flags.proxy_tunneling and this.proxy_tunnel == null) {
        // we are proxing we dont need to cloneMetadata yet
        this.startProxyHandshake(is_ssl, socket);
        return;
    }

    // we have body data incoming so we clone metadata and keep going
    this.cloneMetadata();

    if (body_buf.len == 0) {
        // no body data yet, but we can report the headers
        if (this.signals.get(.header_progress)) {
            this.progressUpdate(is_ssl, ctx, socket);
        }
        return;
    }

    if (this.state.response_stage == .body) {
        {
            const report_progress = this.handleResponseBody(body_buf, true) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (report_progress) {
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }
        }
    } else if (this.state.response_stage == .body_chunk) {
        this.setTimeout(socket, 5);
        {
            const report_progress = this.handleResponseBodyChunkedEncoding(body_buf) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (report_progress) {
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }
        }
    }

    // if not reported we report partially now
    if (this.signals.get(.header_progress)) {
        this.progressUpdate(is_ssl, ctx, socket);
        return;
    }
}
pub fn onData(
    this: *HTTPClient,
    comptime is_ssl: bool,
    incoming_data: []const u8,
    ctx: *NewHTTPContext(is_ssl),
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    log("onData {}", .{incoming_data.len});
    if (this.signals.get(.aborted)) {
        this.closeAndAbort(is_ssl, socket);
        return;
    }

    switch (this.state.response_stage) {
        .pending, .headers => {
            this.handleOnDataHeaders(is_ssl, incoming_data, ctx, socket);
        },
        .body => {
            this.setTimeout(socket, 5);

            if (this.proxy_tunnel) |proxy| {
                proxy.receiveData(incoming_data);
            } else {
                const report_progress = this.handleResponseBody(incoming_data, false) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };

                if (report_progress) {
                    this.progressUpdate(is_ssl, ctx, socket);
                    return;
                }
            }
        },

        .body_chunk => {
            this.setTimeout(socket, 5);

            if (this.proxy_tunnel) |proxy| {
                proxy.receiveData(incoming_data);
            } else {
                const report_progress = this.handleResponseBodyChunkedEncoding(incoming_data) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };

                if (report_progress) {
                    this.progressUpdate(is_ssl, ctx, socket);
                    return;
                }
            }
        },

        .fail => {},
        .proxy_headers, .proxy_handshake => {
            this.setTimeout(socket, 5);
            if (this.proxy_tunnel) |proxy| {
                proxy.receiveData(incoming_data);
            }
            return;
        },
        else => {
            this.state.pending_response = null;
            this.closeAndFail(error.UnexpectedData, is_ssl, socket);
            return;
        },
    }
}

pub fn closeAndAbort(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    this.closeAndFail(error.Aborted, comptime is_ssl, socket);
}

fn fail(this: *HTTPClient, err: anyerror) void {
    this.unregisterAbortTracker();

    if (this.proxy_tunnel) |tunnel| {
        this.proxy_tunnel = null;
        // always detach the socket from the tunnel in case of fail
        tunnel.detachAndDeref();
    }
    if (this.state.stage != .done and this.state.stage != .fail) {
        this.state.request_stage = .fail;
        this.state.response_stage = .fail;
        this.state.fail = err;
        this.state.stage = .fail;

        const callback = this.result_callback;
        const result = this.toResult();
        this.state.reset(this.allocator);
        this.flags.proxy_tunneling = false;

        callback.run(@fieldParentPtr("client", this), result);
    }
}

// We have to clone metadata immediately after use
fn cloneMetadata(this: *HTTPClient) void {
    assert(this.state.pending_response != null);
    if (this.state.pending_response) |response| {
        if (this.state.cloned_metadata != null) {
            this.state.cloned_metadata.?.deinit(this.allocator);
            this.state.cloned_metadata = null;
        }
        var builder_ = StringBuilder{};
        var builder = &builder_;
        response.count(builder);
        builder.count(this.url.href);
        builder.allocate(this.allocator) catch unreachable;
        // headers_buf is owned by the cloned_response (aka cloned_response.headers)
        const headers_buf = this.allocator.alloc(picohttp.Header, response.headers.list.len) catch unreachable;
        const cloned_response = response.clone(headers_buf, builder);

        // we clean the temporary response since cloned_metadata is now the owner
        this.state.pending_response = null;

        const href = builder.append(this.url.href);
        this.state.cloned_metadata = .{
            .owned_buf = builder.ptr.?[0..builder.cap],
            .response = cloned_response,
            .url = href,
        };
    } else {
        // we should never clone metadata that dont exists
        // we added a empty metadata just in case but will hit the assert
        this.state.cloned_metadata = .{};
    }
}

pub fn setTimeout(this: *HTTPClient, socket: anytype, minutes: c_uint) void {
    if (this.flags.disable_timeout) {
        socket.timeout(0);
        socket.setTimeoutMinutes(0);
        return;
    }

    socket.timeout(0);
    socket.setTimeoutMinutes(minutes);
}

pub fn progressUpdate(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.state.stage != .done and this.state.stage != .fail) {
        if (this.state.flags.is_redirect_pending and this.state.fail == null) {
            if (this.state.isDone()) {
                this.doRedirect(is_ssl, ctx, socket);
            }
            return;
        }
        const out_str = this.state.body_out_str.?;
        const body = out_str.*;
        const result = this.toResult();
        const is_done = !result.has_more;

        log("progressUpdate {}", .{is_done});

        const callback = this.result_callback;

        if (is_done) {
            this.unregisterAbortTracker();

            if (this.isKeepAlivePossible() and !socket.isClosedOrHasError()) {
                ctx.releaseSocket(
                    socket,
                    this.flags.did_have_handshaking_error and !this.flags.reject_unauthorized,
                    this.connected_url.hostname,
                    this.connected_url.getPortAuto(),
                );
            } else if (!socket.isClosed()) {
                NewHTTPContext(is_ssl).closeSocket(socket);
            }

            this.state.reset(this.allocator);
            this.state.response_stage = .done;
            this.state.request_stage = .done;
            this.state.stage = .done;
            this.flags.proxy_tunneling = false;
        }

        result.body.?.* = body;
        callback.run(@fieldParentPtr("client", this), result);

        if (comptime print_every > 0) {
            print_every_i += 1;
            if (print_every_i % print_every == 0) {
                Output.prettyln("Heap stats for HTTP thread\n", .{});
                Output.flush();
                print_every_i = 0;
            }
        }
    }
}

pub fn toResult(this: *HTTPClient) HTTPClientResult {
    const body_size: HTTPClientResult.BodySize = if (this.state.isChunkedEncoding())
        .{ .total_received = this.state.total_body_received }
    else if (this.state.content_length) |content_length|
        .{ .content_length = content_length }
    else
        .{ .unknown = {} };

    var certificate_info: ?CertificateInfo = null;
    if (this.state.certificate_info) |info| {
        // transfer owner ship of the certificate info here
        this.state.certificate_info = null;
        certificate_info = info;
    } else if (this.state.cloned_metadata) |metadata| {
        // transfer owner ship of the metadata here
        this.state.cloned_metadata = null;
        return HTTPClientResult{
            .metadata = metadata,
            .body = this.state.body_out_str,
            .redirected = this.flags.redirected,
            .fail = this.state.fail,
            // check if we are reporting cert errors, do not have a fail state and we are not done
            .has_more = certificate_info != null or (this.state.fail == null and !this.state.isDone()),
            .body_size = body_size,
            .certificate_info = null,
        };
    }
    return HTTPClientResult{
        .body = this.state.body_out_str,
        .metadata = null,
        .redirected = this.flags.redirected,
        .fail = this.state.fail,
        // check if we are reporting cert errors, do not have a fail state and we are not done
        .has_more = certificate_info != null or (this.state.fail == null and !this.state.isDone()),
        .body_size = body_size,
        .certificate_info = certificate_info,
        // we can stream the request_body at this stage
        .can_stream = (this.state.request_stage == .body or this.state.request_stage == .proxy_body) and this.flags.is_streaming_request_body,
    };
}

pub fn handleResponseBody(this: *HTTPClient, incoming_data: []const u8, is_only_buffer: bool) !bool {
    assert(this.state.transfer_encoding == .identity);
    const content_length = this.state.content_length;
    // is it exactly as much as we need?
    if (is_only_buffer and content_length != null and incoming_data.len >= content_length.?) {
        try handleResponseBodyFromSinglePacket(this, incoming_data[0..content_length.?]);
        return true;
    } else {
        return handleResponseBodyFromMultiplePackets(this, incoming_data);
    }
}

fn handleResponseBodyFromSinglePacket(this: *HTTPClient, incoming_data: []const u8) !void {
    if (!this.state.isChunkedEncoding()) {
        this.state.total_body_received += incoming_data.len;
    }
    defer {
        if (this.progress_node) |progress| {
            progress.activate();
            progress.setCompletedItems(incoming_data.len);
            progress.context.maybeRefresh();
        }
    }
    // we can ignore the body data in redirects
    if (this.state.flags.is_redirect_pending) return;

    if (this.state.encoding.isCompressed()) {
        try this.state.decompressBytes(incoming_data, this.state.body_out_str.?, true);
    } else {
        try this.state.getBodyBuffer().appendSliceExact(incoming_data);
    }

    if (this.state.response_message_buffer.owns(incoming_data)) {
        if (comptime Environment.allow_assert) {
            // i'm not sure why this would happen and i haven't seen it happen
            // but we should check
            assert(this.state.getBodyBuffer().list.items.ptr != this.state.response_message_buffer.list.items.ptr);
        }

        this.state.response_message_buffer.deinit();
    }
}

fn handleResponseBodyFromMultiplePackets(this: *HTTPClient, incoming_data: []const u8) !bool {
    var buffer = this.state.getBodyBuffer();
    const content_length = this.state.content_length;

    var remainder: []const u8 = undefined;
    if (content_length != null) {
        const remaining_content_length = content_length.? -| this.state.total_body_received;
        remainder = incoming_data[0..@min(incoming_data.len, remaining_content_length)];
    } else {
        remainder = incoming_data;
    }

    // we can ignore the body data in redirects
    if (!this.state.flags.is_redirect_pending) {
        if (buffer.list.items.len == 0 and incoming_data.len < preallocate_max) {
            buffer.list.ensureTotalCapacityPrecise(buffer.allocator, incoming_data.len) catch {};
        }

        _ = try buffer.write(remainder);
    }

    this.state.total_body_received += remainder.len;

    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(this.state.total_body_received);
        progress.context.maybeRefresh();
    }

    // done or streaming
    const is_done = content_length != null and this.state.total_body_received >= content_length.?;
    if (is_done or this.signals.get(.body_streaming) or content_length == null) {
        const is_final_chunk = is_done;
        const processed = try this.state.processBodyBuffer(buffer.*, is_final_chunk);

        // We can only use the libdeflate fast path when we are not streaming
        // If we ever call processBodyBuffer again, it cannot go through the fast path.
        this.state.flags.is_libdeflate_fast_path_disabled = true;

        if (this.progress_node) |progress| {
            progress.activate();
            progress.setCompletedItems(this.state.total_body_received);
            progress.context.maybeRefresh();
        }
        return is_done or processed;
    }
    return false;
}

pub fn handleResponseBodyChunkedEncoding(
    this: *HTTPClient,
    incoming_data: []const u8,
) !bool {
    if (incoming_data.len <= single_packet_small_buffer.len and this.state.getBodyBuffer().list.items.len == 0) {
        return try this.handleResponseBodyChunkedEncodingFromSinglePacket(incoming_data);
    } else {
        return try this.handleResponseBodyChunkedEncodingFromMultiplePackets(incoming_data);
    }
}

fn handleResponseBodyChunkedEncodingFromMultiplePackets(
    this: *HTTPClient,
    incoming_data: []const u8,
) !bool {
    var decoder = &this.state.chunked_decoder;
    const buffer_ptr = this.state.getBodyBuffer();
    var buffer = buffer_ptr.*;
    try buffer.appendSlice(incoming_data);

    // set consume_trailer to 1 to discard the trailing header
    // using content-encoding per chunk is not supported
    decoder.consume_trailer = 1;

    var bytes_decoded = incoming_data.len;
    // phr_decode_chunked mutates in-place
    const pret = picohttp.phr_decode_chunked(
        decoder,
        buffer.list.items.ptr + (buffer.list.items.len -| incoming_data.len),
        &bytes_decoded,
    );
    buffer.list.items.len -|= incoming_data.len - bytes_decoded;
    this.state.total_body_received += bytes_decoded;

    buffer_ptr.* = buffer;

    switch (pret) {
        // Invalid HTTP response body
        -1 => return error.InvalidHTTPResponse,
        // Needs more data
        -2 => {
            if (this.progress_node) |progress| {
                progress.activate();
                progress.setCompletedItems(buffer.list.items.len);
                progress.context.maybeRefresh();
            }
            // streaming chunks
            if (this.signals.get(.body_streaming)) {
                // If we're streaming, we cannot use the libdeflate fast path
                this.state.flags.is_libdeflate_fast_path_disabled = true;
                return try this.state.processBodyBuffer(buffer, false);
            }

            return false;
        },
        // Done
        else => {
            this.state.flags.received_last_chunk = true;
            _ = try this.state.processBodyBuffer(
                buffer,
                true,
            );

            if (this.progress_node) |progress| {
                progress.activate();
                progress.setCompletedItems(buffer.list.items.len);
                progress.context.maybeRefresh();
            }

            return true;
        },
    }

    unreachable;
}

// the first packet for Transfer-Encoding: chunked
// is usually pretty small or sometimes even just a length
// so we can avoid allocating a temporary buffer to copy the data in
var single_packet_small_buffer: [16 * 1024]u8 = undefined;
fn handleResponseBodyChunkedEncodingFromSinglePacket(
    this: *HTTPClient,
    incoming_data: []const u8,
) !bool {
    var decoder = &this.state.chunked_decoder;
    assert(incoming_data.len <= single_packet_small_buffer.len);

    // set consume_trailer to 1 to discard the trailing header
    // using content-encoding per chunk is not supported
    decoder.consume_trailer = 1;

    var buffer: []u8 = undefined;

    if (
    // if we've already copied the buffer once, we can avoid copying it again.
    this.state.response_message_buffer.owns(incoming_data)) {
        buffer = @constCast(incoming_data);
    } else {
        buffer = single_packet_small_buffer[0..incoming_data.len];
        @memcpy(buffer[0..incoming_data.len], incoming_data);
    }

    var bytes_decoded = incoming_data.len;
    // phr_decode_chunked mutates in-place
    const pret = picohttp.phr_decode_chunked(
        decoder,
        buffer.ptr + (buffer.len -| incoming_data.len),
        &bytes_decoded,
    );
    buffer.len -|= incoming_data.len - bytes_decoded;
    this.state.total_body_received += bytes_decoded;

    switch (pret) {
        // Invalid HTTP response body
        -1 => {
            return error.InvalidHTTPResponse;
        },
        // Needs more data
        -2 => {
            if (this.progress_node) |progress| {
                progress.activate();
                progress.setCompletedItems(buffer.len);
                progress.context.maybeRefresh();
            }
            const body_buffer = this.state.getBodyBuffer();
            try body_buffer.appendSliceExact(buffer);

            // streaming chunks
            if (this.signals.get(.body_streaming)) {
                // If we're streaming, we cannot use the libdeflate fast path
                this.state.flags.is_libdeflate_fast_path_disabled = true;

                return try this.state.processBodyBuffer(body_buffer.*, true);
            }

            return false;
        },
        // Done
        else => {
            this.state.flags.received_last_chunk = true;
            try this.handleResponseBodyFromSinglePacket(buffer);
            assert(this.state.body_out_str.?.list.items.ptr != buffer.ptr);
            if (this.progress_node) |progress| {
                progress.activate();
                progress.setCompletedItems(buffer.len);
                progress.context.maybeRefresh();
            }

            return true;
        },
    }

    unreachable;
}

const ShouldContinue = enum {
    continue_streaming,
    finished,
};

pub fn handleResponseMetadata(
    this: *HTTPClient,
    response: *picohttp.Response,
) !ShouldContinue {
    var location: string = "";
    var pretend_304 = false;
    var is_server_sent_events = false;
    for (response.headers.list, 0..) |header, header_i| {
        switch (hashHeaderName(header.name)) {
            hashHeaderConst("Content-Length") => {
                const content_length = std.fmt.parseInt(usize, header.value, 10) catch 0;
                if (this.method.hasBody()) {
                    this.state.content_length = content_length;
                } else {
                    // ignore body size for HEAD requests
                    this.state.content_length = 0;
                }
            },
            hashHeaderConst("Content-Type") => {
                if (strings.contains(header.value, "text/event-stream")) {
                    is_server_sent_events = true;
                }
            },
            hashHeaderConst("Content-Encoding") => {
                if (!this.flags.disable_decompression) {
                    if (strings.eqlComptime(header.value, "gzip")) {
                        this.state.encoding = Encoding.gzip;
                        this.state.content_encoding_i = @as(u8, @truncate(header_i));
                    } else if (strings.eqlComptime(header.value, "deflate")) {
                        this.state.encoding = Encoding.deflate;
                        this.state.content_encoding_i = @as(u8, @truncate(header_i));
                    } else if (strings.eqlComptime(header.value, "br")) {
                        this.state.encoding = Encoding.brotli;
                        this.state.content_encoding_i = @as(u8, @truncate(header_i));
                    }
                }
            },
            hashHeaderConst("Transfer-Encoding") => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    if (!this.flags.disable_decompression) {
                        this.state.transfer_encoding = Encoding.gzip;
                    }
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    if (!this.flags.disable_decompression) {
                        this.state.transfer_encoding = Encoding.deflate;
                    }
                } else if (strings.eqlComptime(header.value, "br")) {
                    if (!this.flags.disable_decompression) {
                        this.state.transfer_encoding = .brotli;
                    }
                } else if (strings.eqlComptime(header.value, "identity")) {
                    this.state.transfer_encoding = Encoding.identity;
                } else if (strings.eqlComptime(header.value, "chunked")) {
                    this.state.transfer_encoding = Encoding.chunked;
                } else {
                    return error.UnsupportedTransferEncoding;
                }
            },
            hashHeaderConst("Location") => {
                location = header.value;
            },
            hashHeaderConst("Connection") => {
                if (response.status_code >= 200 and response.status_code <= 299) {
                    if (!strings.eqlComptime(header.value, "keep-alive")) {
                        this.state.flags.allow_keepalive = false;
                    }
                }
            },
            hashHeaderConst("Last-Modified") => {
                pretend_304 = this.flags.force_last_modified and response.status_code > 199 and response.status_code < 300 and this.if_modified_since.len > 0 and strings.eql(this.if_modified_since, header.value);
            },

            else => {},
        }
    }

    if (this.verbose != .none) {
        printResponse(response.*);
    }

    if (pretend_304) {
        response.status_code = 304;
    }

    // Don't do this for proxies because those connections will be open for awhile.
    if (!this.flags.proxy_tunneling) {

        // according to RFC 7230 section 3.3.3:
        //   1. Any response to a HEAD request and any response with a 1xx (Informational),
        //      204 (No Content), or 304 (Not Modified) status code
        //      [...] cannot contain a message body or trailer section.
        // therefore in these cases set content-length to 0, so the response body is always ignored
        // and is not waited for (which could cause a timeout)
        if ((response.status_code >= 100 and response.status_code < 200) or response.status_code == 204 or response.status_code == 304) {
            this.state.content_length = 0;
        }

        //
        // according to RFC 7230 section 6.3:
        //   In order to remain persistent, all messages on a connection need to
        //   have a self-defined message length (i.e., one not defined by closure
        //   of the connection)
        // therefore, if response has no content-length header and is not chunked, implicitly disable
        // the keep-alive behavior (keep-alive being the default behavior for HTTP/1.1 and not for HTTP/1.0)
        //
        // but, we must only do this IF the status code allows it to contain a body.
        else if (this.state.content_length == null and this.state.transfer_encoding != .chunked) {
            this.state.flags.allow_keepalive = false;
        }
    }

    if (this.flags.proxy_tunneling and this.proxy_tunnel == null) {
        if (response.status_code == 200) {
            // signal to continue the proxing
            return ShouldContinue.continue_streaming;
        }

        //proxy denied connection so return proxy result (407, 403 etc)
        this.flags.proxy_tunneling = false;
    }

    const status_code = response.status_code;

    // if is no redirect or if is redirect == "manual" just proceed
    const is_redirect = status_code >= 300 and status_code <= 399;
    if (is_redirect) {
        if (this.redirect_type == FetchRedirect.follow and location.len > 0 and this.remaining_redirect_count > 0) {
            switch (status_code) {
                302, 301, 307, 308, 303 => {
                    var is_same_origin = true;

                    {
                        var url_arena = std.heap.ArenaAllocator.init(default_allocator);
                        defer url_arena.deinit();
                        var fba = std.heap.stackFallback(4096, url_arena.allocator());
                        const url_allocator = fba.get();
                        if (strings.indexOf(location, "://")) |i| {
                            var string_builder = bun.StringBuilder{};

                            const is_protocol_relative = i == 0;
                            const protocol_name = if (is_protocol_relative) this.url.displayProtocol() else location[0..i];
                            const is_http = strings.eqlComptime(protocol_name, "http");
                            if (is_http or strings.eqlComptime(protocol_name, "https")) {} else {
                                return error.UnsupportedRedirectProtocol;
                            }

                            if ((protocol_name.len * @as(usize, @intFromBool(is_protocol_relative))) + location.len > MAX_REDIRECT_URL_LENGTH) {
                                return error.RedirectURLTooLong;
                            }

                            string_builder.count(location);

                            if (is_protocol_relative) {
                                if (is_http) {
                                    string_builder.count("http");
                                } else {
                                    string_builder.count("https");
                                }
                            }

                            try string_builder.allocate(url_allocator);

                            if (is_protocol_relative) {
                                if (is_http) {
                                    _ = string_builder.append("http");
                                } else {
                                    _ = string_builder.append("https");
                                }
                            }

                            _ = string_builder.append(location);

                            if (comptime Environment.allow_assert)
                                assert(string_builder.cap == string_builder.len);

                            const normalized_url = JSC.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
                            if (normalized_url.tag == .Dead) {
                                // URL__getHref failed, dont pass dead tagged string to toOwnedSlice.
                                return error.RedirectURLInvalid;
                            }
                            const normalized_url_str = try normalized_url.toOwnedSlice(default_allocator);

                            const new_url = URL.parse(normalized_url_str);
                            is_same_origin = strings.eqlCaseInsensitiveASCII(strings.withoutTrailingSlash(new_url.origin), strings.withoutTrailingSlash(this.url.origin), true);
                            this.url = new_url;
                            this.redirect = normalized_url_str;
                        } else if (strings.hasPrefixComptime(location, "//")) {
                            var string_builder = bun.StringBuilder{};

                            const protocol_name = this.url.displayProtocol();

                            if (protocol_name.len + 1 + location.len > MAX_REDIRECT_URL_LENGTH) {
                                return error.RedirectURLTooLong;
                            }

                            const is_http = strings.eqlComptime(protocol_name, "http");

                            if (is_http) {
                                string_builder.count("http:");
                            } else {
                                string_builder.count("https:");
                            }

                            string_builder.count(location);

                            try string_builder.allocate(url_allocator);

                            if (is_http) {
                                _ = string_builder.append("http:");
                            } else {
                                _ = string_builder.append("https:");
                            }

                            _ = string_builder.append(location);

                            if (comptime Environment.allow_assert)
                                assert(string_builder.cap == string_builder.len);

                            const normalized_url = JSC.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
                            const normalized_url_str = try normalized_url.toOwnedSlice(default_allocator);

                            const new_url = URL.parse(normalized_url_str);
                            is_same_origin = strings.eqlCaseInsensitiveASCII(strings.withoutTrailingSlash(new_url.origin), strings.withoutTrailingSlash(this.url.origin), true);
                            this.url = new_url;
                            this.redirect = normalized_url_str;
                        } else {
                            const original_url = this.url;

                            const new_url_ = bun.JSC.URL.join(
                                bun.String.fromBytes(original_url.href),
                                bun.String.fromBytes(location),
                            );
                            defer new_url_.deref();

                            if (new_url_.isEmpty()) {
                                return error.InvalidRedirectURL;
                            }

                            const new_url = new_url_.toOwnedSlice(default_allocator) catch {
                                return error.RedirectURLTooLong;
                            };
                            this.url = URL.parse(new_url);
                            is_same_origin = strings.eqlCaseInsensitiveASCII(strings.withoutTrailingSlash(this.url.origin), strings.withoutTrailingSlash(original_url.origin), true);
                            this.redirect = new_url;
                        }
                    }

                    // If one of the following is true
                    // - internalResponse’s status is 301 or 302 and request’s method is `POST`
                    // - internalResponse’s status is 303 and request’s method is not `GET` or `HEAD`
                    // then:
                    if (((status_code == 301 or status_code == 302) and this.method == .POST) or
                        (status_code == 303 and this.method != .GET and this.method != .HEAD))
                    {
                        // - Set request’s method to `GET` and request’s body to null.
                        this.method = .GET;

                        // https://github.com/oven-sh/bun/issues/6053
                        if (this.header_entries.len > 0) {
                            // A request-body-header name is a header name that is a byte-case-insensitive match for one of:
                            // - `Content-Encoding`
                            // - `Content-Language`
                            // - `Content-Location`
                            // - `Content-Type`
                            const @"request-body-header" = &.{
                                "Content-Encoding",
                                "Content-Language",
                                "Content-Location",
                            };
                            var i: usize = 0;

                            // - For each headerName of request-body-header name, delete headerName from request’s header list.
                            const names = this.header_entries.items(.name);
                            var len = names.len;
                            outer: while (i < len) {
                                const name = this.headerStr(names[i]);
                                switch (name.len) {
                                    "Content-Type".len => {
                                        const hash = hashHeaderName(name);
                                        if (hash == comptime hashHeaderConst("Content-Type")) {
                                            _ = this.header_entries.orderedRemove(i);
                                            len = this.header_entries.len;
                                            continue :outer;
                                        }
                                    },
                                    "Content-Encoding".len => {
                                        const hash = hashHeaderName(name);
                                        inline for (@"request-body-header") |hash_value| {
                                            if (hash == comptime hashHeaderConst(hash_value)) {
                                                _ = this.header_entries.orderedRemove(i);
                                                len = this.header_entries.len;
                                                continue :outer;
                                            }
                                        }
                                    },
                                    else => {},
                                }
                                i += 1;
                            }
                        }
                    }

                    // https://fetch.spec.whatwg.org/#concept-http-redirect-fetch
                    // If request’s current URL’s origin is not same origin with
                    // locationURL’s origin, then for each headerName of CORS
                    // non-wildcard request-header name, delete headerName from
                    // request’s header list.
                    if (!is_same_origin and this.header_entries.len > 0) {
                        const authorization_header_hash = comptime hashHeaderConst("Authorization");
                        for (this.header_entries.items(.name), 0..) |name_ptr, i| {
                            const name = this.headerStr(name_ptr);
                            if (name.len == "Authorization".len) {
                                const hash = hashHeaderName(name);
                                if (hash == authorization_header_hash) {
                                    this.header_entries.orderedRemove(i);
                                    break;
                                }
                            }
                        }
                    }

                    this.state.flags.is_redirect_pending = true;
                    if (this.method.hasRequestBody()) {
                        this.state.flags.resend_request_body_on_redirect = true;
                    }
                },
                else => {},
            }
        } else if (this.redirect_type == FetchRedirect.@"error") {
            // error out if redirect is not allowed
            return error.UnexpectedRedirect;
        }
    }

    this.state.response_stage = if (this.state.transfer_encoding == .chunked) .body_chunk else .body;
    const content_length = this.state.content_length;
    if (content_length) |length| {
        log("handleResponseMetadata: content_length is {} and transfer_encoding {}", .{ length, this.state.transfer_encoding });
    } else {
        log("handleResponseMetadata: content_length is null and transfer_encoding {}", .{this.state.transfer_encoding});
    }

    if (this.method.hasBody() and (content_length == null or content_length.? > 0 or !this.state.flags.allow_keepalive or this.state.transfer_encoding == .chunked or is_server_sent_events)) {
        return ShouldContinue.continue_streaming;
    } else {
        return ShouldContinue.finished;
    }
}

const assert = bun.assert;
