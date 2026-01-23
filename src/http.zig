const HTTPClient = @This();

// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
pub var default_arena: Arena = undefined;
pub var http_thread: HTTPThread = undefined;

//TODO: this needs to be freed when Worker Threads are implemented
pub var socket_async_http_abort_tracker = std.AutoArrayHashMap(u32, uws.AnySocket).init(bun.default_allocator);
pub var async_http_id_monotonic: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);
const MAX_REDIRECT_URL_LENGTH = 128 * 1024;

pub var max_http_header_size: usize = 16 * 1024;
comptime {
    @export(&max_http_header_size, .{ .name = "BUN_DEFAULT_MAX_HTTP_HEADER_SIZE" });
}

pub var overridden_default_user_agent: []const u8 = "";

const print_every = 0;
var print_every_i: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
var shared_request_headers_buf: [256]picohttp.Header = undefined;

// this doesn't need to be stack memory because it is immediately cloned after use
var shared_response_headers_buf: [256]picohttp.Header = undefined;

pub const end_of_chunked_http1_1_encoding_response_body = "0\r\n\r\n";

const log = Output.scoped(.fetch, .visible);

pub var temp_hostname: [8192]u8 = undefined;

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
                    const cert = bun.handleOom(bun.default_allocator.alloc(u8, @intCast(cert_size)));
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
                        .hostname = bun.handleOom(bun.default_allocator.dupe(u8, hostname)),
                        .cert_error = .{
                            .error_no = certError.error_no,
                            .code = bun.handleOom(bun.default_allocator.dupeZ(u8, certError.code)),
                            .reason = bun.handleOom(bun.default_allocator.dupeZ(u8, certError.reason)),
                        },
                    };

                    // we inform the user that the cert is invalid
                    client.progressUpdate(is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
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

pub fn registerAbortTracker(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (client.signals.aborted != null) {
        switch (is_ssl) {
            true => socket_async_http_abort_tracker.put(client.async_http_id, .{ .SocketTLS = socket }) catch unreachable,
            false => socket_async_http_abort_tracker.put(client.async_http_id, .{ .SocketTCP = socket }) catch unreachable,
        }
    }
}

pub fn unregisterAbortTracker(
    client: *HTTPClient,
) void {
    if (client.signals.aborted != null) {
        _ = socket_async_http_abort_tracker.swapRemove(client.async_http_id);
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

    if (client.state.request_stage == .pending)
        client.state.request_stage = .opened;

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
                    hostname = bun.default_allocator.dupeZ(u8, _hostname) catch unreachable;
                    hostname_needs_free = true;
                }
            }

            defer if (hostname_needs_free) bun.default_allocator.free(hostname);

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

    switch (client.state.request_stage) {
        .opened, .pending => {
            client.onWritable(true, comptime is_ssl, socket);
        },
        else => {},
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
        tunnel.shutdown();
        tunnel.detachAndDeref();
    }
    const in_progress = client.state.stage != .done and client.state.stage != .fail and client.state.flags.is_redirect_pending == false;
    if (client.state.flags.is_redirect_pending) {
        // if the connection is closed and we are pending redirect just do the redirect
        // in this case we will re-connect or go to a different socket if needed
        client.doRedirect(is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
        return;
    }
    if (in_progress) {
        if (client.state.isChunkedEncoding()) {
            switch (client.state.chunked_decoder._state) {
                .CHUNKED_IN_TRAILERS_LINE_HEAD, .CHUNKED_IN_TRAILERS_LINE_MIDDLE => {
                    // ignore failure if we are in the middle of trailer headers, since we processed all the chunks and trailers are ignored
                    client.state.flags.received_last_chunk = true;
                    client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
                    return;
                },
                // here we are in the middle of a chunk so ECONNRESET is expected
                else => {},
            }
        } else if (client.state.content_length == null and client.state.response_stage == .body) {
            // no content length informed so we are done here
            client.state.flags.received_last_chunk = true;
            client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
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

pub inline fn cleanup(force: bool) void {
    default_arena.gc(force);
}

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

    // Check if user provided Proxy-Authorization in custom headers
    const user_provided_proxy_auth = if (client.proxy_headers) |hdrs| hdrs.get("proxy-authorization") != null else false;

    // Only write auto-generated proxy_authorization if user didn't provide one
    if (client.proxy_authorization) |auth| {
        if (!user_provided_proxy_auth) {
            _ = writer.write("Proxy-Authorization: ") catch 0;
            _ = writer.write(auth) catch 0;
            _ = writer.write("\r\n") catch 0;
        }
    }

    // Write custom proxy headers
    if (client.proxy_headers) |hdrs| {
        const slice = hdrs.entries.slice();
        const names = slice.items(.name);
        const values = slice.items(.value);
        for (names, 0..) |name_ptr, idx| {
            _ = writer.write(hdrs.asStr(name_ptr)) catch 0;
            _ = writer.write(": ") catch 0;
            _ = writer.write(hdrs.asStr(values[idx])) catch 0;
            _ = writer.write("\r\n") catch 0;
        }
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

    // Check if user provided Proxy-Authorization in custom headers
    const user_provided_proxy_auth = if (client.proxy_headers) |hdrs| hdrs.get("proxy-authorization") != null else false;

    // Only write auto-generated proxy_authorization if user didn't provide one
    if (client.proxy_authorization) |auth| {
        if (!user_provided_proxy_auth) {
            _ = writer.write("Proxy-Authorization: ") catch 0;
            _ = writer.write(auth) catch 0;
            _ = writer.write("\r\n") catch 0;
        }
    }

    // Write custom proxy headers
    if (client.proxy_headers) |hdrs| {
        const slice = hdrs.entries.slice();
        const names = slice.items(.name);
        const values = slice.items(.value);
        for (names, 0..) |name_ptr, idx| {
            _ = writer.write(hdrs.asStr(name_ptr)) catch 0;
            _ = writer.write(": ") catch 0;
            _ = writer.write(hdrs.asStr(values[idx])) catch 0;
            _ = writer.write("\r\n") catch 0;
        }
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

const default_redirect_count = 127;

pub const HTTPVerboseLevel = enum {
    none,
    headers,
    curl,
};

const HTTPUpgradeState = enum(u2) {
    none = 0,
    pending = 1,
    upgraded = 2,
};
pub const Flags = packed struct(u16) {
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
    defer_fail_until_connecting_is_complete: bool = false,
    upgrade_state: HTTPUpgradeState = .none,
    _padding: u3 = 0,
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
proxy_headers: ?Headers = null,
proxy_authorization: ?[]u8 = null,
proxy_tunnel: ?*ProxyTunnel = null,
signals: Signals = .{},
async_http_id: u32 = 0,
hostname: ?[]u8 = null,
unix_socket_path: jsc.ZigString.Slice = jsc.ZigString.Slice.empty,

pub fn deinit(this: *HTTPClient) void {
    if (this.redirect.len > 0) {
        bun.default_allocator.free(this.redirect);
        this.redirect = &.{};
    }
    if (this.proxy_authorization) |auth| {
        this.allocator.free(auth);
        this.proxy_authorization = null;
    }
    if (this.proxy_headers) |*hdrs| {
        hdrs.deinit();
        this.proxy_headers = null;
    }
    if (this.proxy_tunnel) |tunnel| {
        this.proxy_tunnel = null;
        tunnel.detachAndDeref();
    }
    this.unix_socket_path.deinit();
    this.unix_socket_path = jsc.ZigString.Slice.empty;
}

pub fn isKeepAlivePossible(this: *HTTPClient) bool {
    if (comptime FeatureFlags.enable_keepalive) {
        // TODO keepalive for unix sockets
        if (this.unix_socket_path.length() > 0) return false;

        // is not possible to reuse Proxy with TLS, so disable keepalive if url is tunneling HTTPS
        if (this.proxy_tunnel != null or (this.http_proxy != null and this.url.isHTTPS())) {
            log("Keep-Alive release (proxy tunneling https)", .{});
            return false;
        }

        // check state
        if (this.state.flags.allow_keepalive and !this.flags.disable_keepalive) return true;
    }
    return false;
}

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
// for each request we need this hashs, putting on top of the file to avoid exceeding comptime quota limit
const authorization_header_hash = hashHeaderConst("Authorization");
const proxy_authorization_header_hash = hashHeaderConst("Proxy-Authorization");
const cookie_header_hash = hashHeaderConst("Cookie");

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const chunked_encoded_header = picohttp.Header{ .name = "Transfer-Encoding", .value = "chunked" };
const connection_header = picohttp.Header{ .name = "Connection", .value = "keep-alive" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "gzip, deflate, br, zstd";
const accept_encoding_header_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression };
const accept_encoding_header_no_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_no_compression };

const accept_encoding_header = if (FeatureFlags.disable_compression_in_http_client)
    accept_encoding_header_no_compression
else
    accept_encoding_header_compression;

fn getUserAgentHeader() picohttp.Header {
    return picohttp.Header{ .name = "User-Agent", .value = if (overridden_default_user_agent.len > 0)
        overridden_default_user_agent
    else
        Global.user_agent };
}

pub fn headerStr(this: *const HTTPClient, ptr: api.StringPointer) string {
    return this.header_buf[ptr.offset..][0..ptr.length];
}

pub const HeaderBuilder = @import("./http/HeaderBuilder.zig");

pub fn buildRequest(this: *HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    const header_names = header_entries.items(.name);
    const header_values = header_entries.items(.value);
    var request_headers_buf = &shared_request_headers_buf;

    var override_accept_encoding = false;
    var override_accept_header = false;
    var override_host_header = false;
    var override_connection_header = false;
    var override_user_agent = false;
    var add_transfer_encoding = true;
    var original_content_length: ?string = null;

    for (header_names, 0..) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            hashHeaderConst("Content-Length"),
            => {
                original_content_length = this.headerStr(header_values[i]);
                continue;
            },
            hashHeaderConst("Connection") => {
                override_connection_header = true;
                const connection_value = this.headerStr(header_values[i]);
                if (std.ascii.eqlIgnoreCase(connection_value, "close")) {
                    this.flags.disable_keepalive = true;
                } else if (std.ascii.eqlIgnoreCase(connection_value, "keep-alive")) {
                    this.flags.disable_keepalive = false;
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
            hashHeaderConst("Upgrade") => {
                const value = this.headerStr(header_values[i]);
                if (!std.ascii.eqlIgnoreCase(value, "h2") and !std.ascii.eqlIgnoreCase(value, "h2c")) {
                    this.flags.upgrade_state = .pending;
                }
            },
            hashHeaderConst(chunked_encoded_header.name) => {
                // We don't want to override chunked encoding header if it was set by the user
                add_transfer_encoding = false;
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

    if (!override_connection_header and !this.flags.disable_keepalive) {
        request_headers_buf[header_count] = connection_header;
        header_count += 1;
    }

    if (!override_user_agent) {
        request_headers_buf[header_count] = getUserAgentHeader();
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
            if (add_transfer_encoding and this.flags.upgrade_state == .none) {
                request_headers_buf[header_count] = chunked_encoded_header;
                header_count += 1;
            }
        } else {
            request_headers_buf[header_count] = .{
                .name = content_length_header_name,
                .value = std.fmt.bufPrint(&this.request_content_len_buf, "{d}", .{body_len}) catch "0",
            };
            header_count += 1;
        }
    } else if (original_content_length) |content_length| {
        request_headers_buf[header_count] = .{
            .name = content_length_header_name,
            .value = content_length,
        };
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
    this.unix_socket_path = jsc.ZigString.Slice.empty;
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

    if (this.proxy_tunnel) |tunnel| {
        log("close the tunnel in redirect", .{});
        this.proxy_tunnel = null;
        tunnel.detachAndDeref();
        NewHTTPContext(is_ssl).closeSocket(socket);
    } else {
        // we need to clean the client reference before closing the socket because we are going to reuse the same ref in a another request
        if (this.isKeepAlivePossible() and !socket.isClosedOrHasError()) {
            log("Keep-Alive release in redirect", .{});
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

/// **Not thread safe while request is in-flight**
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
    this.unregisterAbortTracker();

    // mark that we are connecting
    this.flags.defer_fail_until_connecting_is_complete = true;
    // this will call .fail() if the connection fails in the middle of the function avoiding UAF with can happen when the connection is aborted
    defer this.completeConnectingProcess();
    if (comptime Environment.allow_assert) {
        // Comparing `ptr` is safe here because it is only done if the vtable pointers are equal,
        // which means they are both mimalloc arenas and therefore have non-undefined context
        // pointers.
        if (this.allocator.vtable == default_allocator.vtable and this.allocator.ptr != default_allocator.ptr) {
            @panic("HTTPClient used with threadlocal allocator belonging to another thread. This will cause crashes.");
        }
    }

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

    // If we haven't already called onOpen(), then that means we need to
    // register the abort tracker. We need to do this in cases where the
    // connection takes a long time to happen such as when it's not routable.
    // See test/js/bun/io/fetch/fetch-abort-slow-connect.test.ts.
    //
    // We have to be careful here because if .connect() had finished
    // synchronously, then this socket is on longer valid and the pointer points
    // to invalid memory.
    if (this.state.request_stage == .pending) {
        this.registerAbortTracker(is_ssl, socket);
    }
}

pub const HTTPResponseMetadata = struct {
    url: []const u8 = "",
    owned_buf: []u8 = "",
    response: picohttp.Response = .{},
    pub fn deinit(this: *HTTPResponseMetadata, allocator: std.mem.Allocator) void {
        if (this.owned_buf.len > 0) allocator.free(this.owned_buf);
        if (this.response.headers.list.len > 0) allocator.free(this.response.headers.list);
        this.owned_buf = &.{};
        this.url = "";
        this.response.headers = .{};
        this.response.status = "";
    }
};

fn printRequest(request: picohttp.Request, url: string, ignore_insecure: bool, body: []const u8, curl: bool) void {
    @branchHint(.cold);
    var request_ = request;
    request_.path = url;

    if (curl) {
        Output.prettyErrorln("{f}", .{request_.curl(ignore_insecure, body)});
    }

    Output.prettyErrorln("{f}", .{request_});

    Output.flush();
}

fn printResponse(response: picohttp.Response) void {
    @branchHint(.cold);
    Output.prettyErrorln("{f}", .{response});
    Output.flush();
}

pub fn onPreconnect(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("onPreconnect({})", .{this.url});
    this.unregisterAbortTracker();
    const ctx = if (comptime is_ssl) &http_thread.https_context else &http_thread.http_context;
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
            log("start proxy tunneling (https proxy)", .{});
            //DO the tunneling!
            this.flags.proxy_tunneling = true;
            try writeProxyConnect(@TypeOf(writer), writer, this);
        } else {
            log("start proxy request (http proxy)", .{});
            // HTTP do not need tunneling with CONNECT just a slightly different version of the request
            try writeProxyRequest(
                @TypeOf(writer),
                writer,
                request,
                this,
            );
        }
    } else {
        log("normal request", .{});
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
    const amount = try writeToSocket(is_ssl, socket, to_send);
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

    this.state.request_sent_len += amount;
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

pub fn flushStream(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    // only flush the stream if needed no additional data is being added
    this.writeToStream(is_ssl, socket, "");
}

/// Write data to the socket (Just a error wrapper to easly handle amount written and error handling)
fn writeToSocket(comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, data: []const u8) !usize {
    var remaining = data;
    var total_written: usize = 0;
    while (remaining.len > 0) {
        const amount = socket.write(remaining);
        if (amount < 0) {
            return error.WriteFailed;
        }
        const wrote: usize = @intCast(amount);
        total_written += wrote;
        remaining = remaining[wrote..];
        if (wrote == 0) break;
    }
    return total_written;
}

/// Write data to the socket and buffer the unwritten data if there is backpressure
fn writeToSocketWithBufferFallback(comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, buffer: *bun.io.StreamBuffer, data: []const u8) !usize {
    const amount = try writeToSocket(is_ssl, socket, data);
    if (amount < data.len) {
        bun.handleOom(buffer.write(data[@intCast(amount)..]));
    }
    return amount;
}

/// Write buffered data to the socket returning true if there is backpressure
fn writeToStreamUsingBuffer(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, buffer: *bun.io.StreamBuffer, data: []const u8) !bool {
    const to_send = buffer.slice();
    if (to_send.len > 0) {
        const amount = try writeToSocket(is_ssl, socket, to_send);
        this.state.request_sent_len += amount;
        buffer.cursor += amount;
        if (amount < to_send.len) {
            // we could not send all pending data so we need to buffer the extra data
            if (data.len > 0) {
                bun.handleOom(buffer.write(data));
            }
            // failed to send everything so we have backpressure
            return true;
        }
        if (buffer.isEmpty()) {
            buffer.reset();
        }
    }

    // ok we flushed all pending data so we can reset the backpressure
    if (data.len > 0) {
        // no backpressure everything was sended so we can just try to send
        const sent = try writeToSocketWithBufferFallback(is_ssl, socket, buffer, data);
        this.state.request_sent_len += sent;
        // if we didn't send all the data we have backpressure
        return sent < data.len;
    }
    // no data to send so we are done
    return false;
}

pub fn writeToStream(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, data: []const u8) void {
    log("flushStream", .{});
    if (this.state.original_request_body != .stream) {
        return;
    }
    var stream = &this.state.original_request_body.stream;
    const stream_buffer = stream.buffer orelse return;
    if (this.flags.upgrade_state == .pending) {
        // cannot drain yet, upgrade is waiting for upgrade
        return;
    }
    const buffer = stream_buffer.acquire();
    const wasEmpty = buffer.isEmpty() and data.len == 0;
    if (wasEmpty and stream.ended) {
        // nothing is buffered and the stream is done so we just release and detach
        stream_buffer.release();
        stream.detach();
        if (this.flags.upgrade_state == .upgraded) {
            // for upgraded connections we need to shutdown the socket to signal the end of the connection
            // otherwise the client will wait forever for the connection to be closed
            socket.shutdown();
        }
        return;
    }

    // to simplify things here the buffer contains the raw data we just need to flush to the socket it
    const has_backpressure = writeToStreamUsingBuffer(this, is_ssl, socket, buffer, data) catch |err| {
        // we got some critical error so we need to fail and close the connection
        stream_buffer.release();
        stream.detach();
        this.closeAndFail(err, is_ssl, socket);
        return;
    };

    if (has_backpressure) {
        // we have backpressure so just release the buffer and wait for onWritable
        stream_buffer.release();
    } else {
        if (stream.ended) {
            // done sending everything so we can release the buffer and detach the stream
            this.state.request_stage = .done;
            stream_buffer.release();
            stream.detach();
            if (this.flags.upgrade_state == .upgraded) {
                // for upgraded connections we need to shutdown the socket to signal the end of the connection
                // otherwise the client will wait forever for the connection to be closed
                socket.shutdown();
            }
        } else {
            // only report drain if we send everything and previous we had something to send
            if (!wasEmpty) {
                stream_buffer.reportDrain();
            }
            // release the buffer so main thread can use it to send more data
            stream_buffer.release();
        }
    }
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
        .pending, .headers, .opened => {
            log("sendInitialRequestPayload", .{});
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
                        this.progressUpdate(is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
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
                        this.progressUpdate(is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
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
            log("send body", .{});
            this.setTimeout(socket, 5);

            switch (this.state.original_request_body) {
                .bytes => {
                    const to_send = this.state.request_body;
                    if (to_send.len > 0) {
                        const sent = writeToSocket(is_ssl, socket, to_send) catch |err| {
                            this.closeAndFail(err, is_ssl, socket);
                            return;
                        };

                        this.state.request_sent_len += sent;
                        this.state.request_body = this.state.request_body[sent..];
                    }

                    if (this.state.request_body.len == 0) {
                        this.state.request_stage = .done;
                        return;
                    }
                },
                .stream => {
                    // flush without adding any new data
                    this.flushStream(is_ssl, socket);
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
            log("send proxy body", .{});
            if (this.proxy_tunnel) |proxy| {
                switch (this.state.original_request_body) {
                    .bytes => {
                        this.setTimeout(socket, 5);

                        const to_send = this.state.request_body;
                        const sent = proxy.write(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose

                        this.state.request_sent_len += sent;
                        this.state.request_body = this.state.request_body[sent..];

                        if (this.state.request_body.len == 0) {
                            this.state.request_stage = .done;
                            return;
                        }
                    },
                    .stream => {
                        this.flushStream(is_ssl, socket);
                    },
                    .sendfile => {
                        @panic("sendfile is only supported without SSL. This code should never have been reached!");
                    },
                }
            }
        },
        .proxy_headers => {
            log("send proxy headers", .{});
            if (this.proxy_tunnel) |proxy| {
                this.setTimeout(socket, 5);
                var stack_buffer = std.heap.stackFallback(1024 * 16, bun.default_allocator);
                const allocator = stack_buffer.get();
                var temporary_send_buffer = std.array_list.Managed(u8).fromOwnedSlice(allocator, &stack_buffer.buffer);
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
                const amount = proxy.write(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose

                if (comptime is_first_call) {
                    if (amount == 0) {
                        // don't worry about it
                        log("is_first_call and amount == 0", .{});
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
                        this.progressUpdate(is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
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
    NewHTTPContext(is_ssl).terminateSocket(socket);
    this.fail(err);
}

fn startProxyHandshake(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, start_payload: []const u8) void {
    log("startProxyHandshake", .{});
    // if we have options we pass them (ca, reject_unauthorized, etc) otherwise use the default
    const ssl_options = if (this.tls_props != null) this.tls_props.?.* else jsc.API.ServerConfig.SSLConfig.zero;
    ProxyTunnel.start(this, is_ssl, socket, ssl_options, start_payload);
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
            bun.handleOom(this.state.response_message_buffer.append(to_copy));
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
    log("handleOnDataHeader data: {s}", .{incoming_data});
    var to_read = incoming_data;
    var needs_move = true;
    if (this.state.response_message_buffer.list.items.len > 0) {
        // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
        bun.handleOom(this.state.response_message_buffer.appendSliceExact(incoming_data));
        to_read = this.state.response_message_buffer.list.items;
        needs_move = false;
    }

    while (true) {
        var amount_read: usize = 0;

        // we reset the pending_response each time wich means that on parse error this will be always be empty
        this.state.pending_response = picohttp.Response{};

        // minimal http/1.1 request size is 16 bytes without headers and 26 with Host header
        // if is less than 16 will always be a ShortRead
        if (to_read.len < 16) {
            log("handleShortRead", .{});
            this.handleShortRead(is_ssl, incoming_data, socket, needs_move);
            return;
        }

        const response = picohttp.Response.parseParts(
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

        to_read = to_read[@min(@as(usize, @intCast(response.bytes_read)), to_read.len)..];

        if (response.status_code == 101) {
            if (this.flags.upgrade_state == .none) {
                // we cannot upgrade to websocket because the client did not request it!
                this.closeAndFail(error.UnrequestedUpgrade, is_ssl, socket);
                return;
            }
            // special case for websocket upgrade
            this.flags.upgrade_state = .upgraded;
            if (this.signals.upgraded) |upgraded| {
                upgraded.store(true, .monotonic);
            }
            // start draining the request body
            this.flushStream(is_ssl, socket);
            break;
        }

        // handle the case where we have a 100 Continue
        if (response.status_code >= 100 and response.status_code < 200) {
            log("information headers", .{});

            this.state.pending_response = null;
            if (to_read.len == 0) {
                // we only received 1XX responses, we wanna wait for the next status code
                return;
            }
            // the buffer could still contain more 1XX responses or other status codes, so we continue parsing
            continue;
        }

        break;
    }
    var response = this.state.pending_response.?;
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
        this.startProxyHandshake(is_ssl, socket, to_read);
        return;
    }

    // we have body data incoming so we clone metadata and keep going
    this.cloneMetadata();

    if (to_read.len == 0) {
        // no body data yet, but we can report the headers
        if (this.signals.get(.header_progress)) {
            this.progressUpdate(is_ssl, ctx, socket);
        }
        return;
    }

    if (this.state.response_stage == .body) {
        {
            const report_progress = this.handleResponseBody(to_read, true) catch |err| {
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
            const report_progress = this.handleResponseBodyChunkedEncoding(to_read) catch |err| {
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

    if (this.proxy_tunnel) |proxy| {
        // if we have a tunnel we dont care about the other stages, we will just tunnel the data
        this.setTimeout(socket, 5);
        proxy.receive(incoming_data);
        return;
    }

    switch (this.state.response_stage) {
        .pending, .headers => {
            this.handleOnDataHeaders(is_ssl, incoming_data, ctx, socket);
        },
        .body => {
            this.setTimeout(socket, 5);

            const report_progress = this.handleResponseBody(incoming_data, false) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (report_progress) {
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }
        },

        .body_chunk => {
            this.setTimeout(socket, 5);

            const report_progress = this.handleResponseBodyChunkedEncoding(incoming_data) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (report_progress) {
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }
        },

        .fail => {},
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

fn completeConnectingProcess(this: *HTTPClient) void {
    if (this.flags.defer_fail_until_connecting_is_complete) {
        this.flags.defer_fail_until_connecting_is_complete = false;
        if (this.state.stage == .fail) {
            const callback = this.result_callback;
            const result = this.toResult();
            this.state.reset(this.allocator);
            this.flags.proxy_tunneling = false;

            callback.run(@fieldParentPtr("client", this), result);
        }
    }
}

fn fail(this: *HTTPClient, err: anyerror) void {
    this.unregisterAbortTracker();

    if (this.proxy_tunnel) |tunnel| {
        this.proxy_tunnel = null;
        tunnel.shutdown();
        // always detach the socket from the tunnel in case of fail
        tunnel.detachAndDeref();
    }
    if (this.state.stage != .done and this.state.stage != .fail) {
        this.state.request_stage = .fail;
        this.state.response_stage = .fail;
        this.state.fail = err;
        this.state.stage = .fail;

        if (!this.flags.defer_fail_until_connecting_is_complete) {
            const callback = this.result_callback;
            const result = this.toResult();
            this.state.reset(this.allocator);
            this.flags.proxy_tunneling = false;

            callback.run(@fieldParentPtr("client", this), result);
        }
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

pub fn drainResponseBody(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {

    // Find out if we should not send any update.
    switch (this.state.stage) {
        .done, .fail => return,
        else => {},
    }

    if (this.state.fail != null) {
        // If there's any error at all, do not drain.
        return;
    }

    // If there's a pending redirect, then don't bother to send a response body
    // as that wouldn't make sense and I want to defensively avoid edgecases
    // from that.
    if (this.state.flags.is_redirect_pending) {
        return;
    }

    const body_out_str = this.state.body_out_str orelse return;
    if (body_out_str.list.items.len == 0) {
        // No update! Don't do anything.
        return;
    }

    this.sendProgressUpdateWithoutStageCheck(is_ssl, http_thread.context(is_ssl), socket);
}

fn sendProgressUpdateWithoutStageCheck(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    const out_str = this.state.body_out_str.?;
    const body = out_str.*;
    const result = this.toResult();
    const is_done = !result.has_more;

    log("progressUpdate {}", .{is_done});

    const callback = this.result_callback;

    if (is_done) {
        this.unregisterAbortTracker();
        if (this.proxy_tunnel) |tunnel| {
            log("close the tunnel", .{});
            this.proxy_tunnel = null;
            tunnel.shutdown();
            tunnel.detachAndDeref();
            NewHTTPContext(is_ssl).closeSocket(socket);
        } else {
            if (this.isKeepAlivePossible() and !socket.isClosedOrHasError()) {
                log("release socket", .{});
                ctx.releaseSocket(
                    socket,
                    this.flags.did_have_handshaking_error and !this.flags.reject_unauthorized,
                    this.connected_url.hostname,
                    this.connected_url.getPortAuto(),
                );
            } else {
                NewHTTPContext(is_ssl).closeSocket(socket);
            }
        }

        this.state.reset(this.allocator);
        this.state.response_stage = .done;
        this.state.request_stage = .done;
        this.state.stage = .done;
        this.flags.proxy_tunneling = false;
        log("done", .{});
    }

    result.body.?.* = body;
    callback.run(@fieldParentPtr("client", this), result);

    if (comptime print_every > 0) {
        print_every_i += 1;
        if (print_every_i % print_every == 0) {
            Output.prettyln("Heap stats for HTTP thread\n", .{});
            Output.flush();
            default_arena.dumpThreadStats();
            print_every_i = 0;
        }
    }
}

pub fn progressUpdate(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.state.stage != .done and this.state.stage != .fail) {
        if (this.state.flags.is_redirect_pending and this.state.fail == null) {
            if (this.state.isDone()) {
                this.doRedirect(is_ssl, ctx, socket);
            }
            return;
        }

        this.sendProgressUpdateWithoutStageCheck(is_ssl, ctx, socket);
    }
}

pub const HTTPClientResult = struct {
    body: ?*MutableString = null,
    has_more: bool = false,
    redirected: bool = false,
    can_stream: bool = false,

    fail: ?anyerror = null,

    /// Owns the response metadata aka headers, url and status code
    metadata: ?HTTPResponseMetadata = null,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: BodySize = .unknown,
    certificate_info: ?CertificateInfo = null,

    pub fn abortReason(this: *const HTTPClientResult) ?jsc.CommonAbortReason {
        if (this.isTimeout()) {
            return .Timeout;
        }

        if (this.isAbort()) {
            return .UserAbort;
        }

        return null;
    }

    pub const BodySize = union(enum) {
        total_received: usize,
        content_length: usize,
        unknown: void,
    };

    pub fn isSuccess(this: *const HTTPClientResult) bool {
        return this.fail == null;
    }

    pub fn isTimeout(this: *const HTTPClientResult) bool {
        return if (this.fail) |e| e == error.Timeout else false;
    }

    pub fn isAbort(this: *const HTTPClientResult) bool {
        return if (this.fail) |e| (e == error.Aborted or e == error.AbortedBeforeConnecting) else false;
    }

    pub const Callback = struct {
        ctx: *anyopaque,
        function: Function,

        pub const Function = *const fn (*anyopaque, *AsyncHTTP, HTTPClientResult) void;

        pub fn run(self: Callback, async_http: *AsyncHTTP, result: HTTPClientResult) void {
            self.function(self.ctx, async_http, result);
        }

        pub fn New(comptime Type: type, comptime callback: anytype) type {
            return struct {
                pub fn init(this: Type) Callback {
                    return Callback{
                        .ctx = this,
                        .function = @This().wrapped_callback,
                    };
                }

                pub fn wrapped_callback(ptr: *anyopaque, async_http: *AsyncHTTP, result: HTTPClientResult) void {
                    const casted = @as(Type, @ptrCast(@alignCast(ptr)));
                    @call(bun.callmod_inline, callback, .{ casted, async_http, result });
                }
            };
        }
    };
};

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

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const preallocate_max = 1024 * 1024 * 256;

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
        log("handleResponseBodyFromSinglePacket {d}", .{this.state.total_body_received});
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
    log("handleResponseBodyFromMultiplePackets {d}", .{this.state.total_body_received});
    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(this.state.total_body_received);
        progress.context.maybeRefresh();
    }

    // done or streaming
    const is_done = content_length != null and this.state.total_body_received >= content_length.?;
    if (is_done or this.signals.get(.response_body_streaming) or content_length == null) {
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
    log("handleResponseBodyChunkedEncodingFromMultiplePackets {d}", .{this.state.total_body_received});

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
            if (this.signals.get(.response_body_streaming)) {
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
    log("handleResponseBodyChunkedEncodingFromSinglePacket {d}", .{this.state.total_body_received});
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
            if (this.signals.get(.response_body_streaming)) {
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
                    } else if (strings.eqlComptime(header.value, "zstd")) {
                        this.state.encoding = Encoding.zstd;
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
                } else if (strings.eqlComptime(header.value, "zstd")) {
                    if (!this.flags.disable_decompression) {
                        this.state.transfer_encoding = .zstd;
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
                    // HTTP headers are case-insensitive (RFC 7230)
                    if (std.ascii.eqlIgnoreCase(header.value, "close")) {
                        this.state.flags.allow_keepalive = false;
                    } else if (std.ascii.eqlIgnoreCase(header.value, "keep-alive")) {
                        this.state.flags.allow_keepalive = true;
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

        // proxy denied connection so return proxy result (407, 403 etc)
        this.flags.proxy_tunneling = false;
        this.flags.disable_keepalive = true;
    }

    const status_code = response.status_code;

    if (status_code == 407) {
        // If the request is being proxied and passes through the 407 status code, then let's also not do HTTP Keep-Alive.
        this.flags.disable_keepalive = true;
    }

    // if is no redirect or if is redirect == "manual" just proceed
    const is_redirect = status_code >= 300 and status_code <= 399;
    if (is_redirect) {
        if (this.redirect_type == FetchRedirect.follow and location.len > 0 and this.remaining_redirect_count > 0) {
            switch (status_code) {
                302, 301, 307, 308, 303 => {
                    var is_same_origin = true;

                    {
                        var url_arena = std.heap.ArenaAllocator.init(bun.default_allocator);
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

                            const normalized_url = jsc.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
                            if (normalized_url.tag == .Dead) {
                                // URL__getHref failed, dont pass dead tagged string to toOwnedSlice.
                                return error.RedirectURLInvalid;
                            }
                            const normalized_url_str = try normalized_url.toOwnedSlice(bun.default_allocator);

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

                            const normalized_url = jsc.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
                            const normalized_url_str = try normalized_url.toOwnedSlice(bun.default_allocator);

                            const new_url = URL.parse(normalized_url_str);
                            is_same_origin = strings.eqlCaseInsensitiveASCII(strings.withoutTrailingSlash(new_url.origin), strings.withoutTrailingSlash(this.url.origin), true);
                            this.url = new_url;
                            this.redirect = normalized_url_str;
                        } else {
                            const original_url = this.url;

                            const new_url_ = bun.jsc.URL.join(
                                bun.String.fromBytes(original_url.href),
                                bun.String.fromBytes(location),
                            );
                            defer new_url_.deref();

                            if (new_url_.isEmpty()) {
                                return error.InvalidRedirectURL;
                            }

                            const new_url = new_url_.toOwnedSlice(bun.default_allocator) catch {
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
                    // var authorization_removed = false;
                    // var proxy_authorization_removed = false;
                    // var cookie_removed = false;
                    // References:
                    // https://github.com/nodejs/undici/commit/6805746680d27a5369d7fb67bc05f95a28247d75#diff-ea7696549c3a0b60a4a7e07cc79b6d4e950c7cb1068d47e368a510967d77e7e5R206
                    // https://github.com/denoland/deno/commit/7456255cd10286d71363fc024e51b2662790448a#diff-6e35f325f0a4e1ae3214fde20c9108e9b3531df5d284ba3c93becb99bbfc48d5R70
                    if (!is_same_origin and this.header_entries.len > 0) {
                        const headers_to_remove: []const struct {
                            name: []const u8,
                            hash: u64,
                        } = &.{
                            .{ .name = "Authorization", .hash = authorization_header_hash },
                            .{ .name = "Proxy-Authorization", .hash = proxy_authorization_header_hash },
                            .{ .name = "Cookie", .hash = cookie_header_hash },
                        };
                        inline for (headers_to_remove) |header| {
                            const names = this.header_entries.items(.name);

                            for (names, 0..) |name_ptr, i| {
                                const name = this.headerStr(name_ptr);
                                if (name.len == header.name.len) {
                                    const hash = hashHeaderName(name);
                                    if (hash == header.hash) {
                                        this.header_entries.orderedRemove(i);
                                        break;
                                    }
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
    if (this.flags.upgrade_state == .upgraded) {
        this.state.content_length = null;
        this.state.flags.allow_keepalive = false;
        return ShouldContinue.continue_streaming;
    }

    if (this.method.hasBody() and (content_length == null or content_length.? > 0 or !this.state.flags.allow_keepalive or this.state.transfer_encoding == .chunked or is_server_sent_events)) {
        return ShouldContinue.continue_streaming;
    } else {
        return ShouldContinue.finished;
    }
}

// Exists for heap stats reasons.
pub const ThreadlocalAsyncHTTP = struct {
    pub const new = bun.TrivialNew(@This());
    pub const deinit = bun.TrivialDeinit(@This());

    async_http: AsyncHTTP,
};

pub const ETag = @import("./http/ETag.zig");
pub const Method = @import("./http/Method.zig").Method;
pub const Headers = @import("./http/Headers.zig");
pub const MimeType = @import("./http/MimeType.zig");
pub const URLPath = @import("./http/URLPath.zig");
pub const Encoding = @import("./http/Encoding.zig").Encoding;
pub const Decompressor = @import("./http/Decompressor.zig").Decompressor;
pub const Signals = @import("./http/Signals.zig");
pub const ThreadSafeStreamBuffer = @import("./http/ThreadSafeStreamBuffer.zig");
pub const HTTPThread = @import("./http/HTTPThread.zig");
pub const NewHTTPContext = @import("./http/HTTPContext.zig").NewHTTPContext;
pub const AsyncHTTP = @import("./http/AsyncHTTP.zig");
pub const InternalState = @import("./http/InternalState.zig");
pub const CertificateInfo = @import("./http/CertificateInfo.zig");
pub const FetchRedirect = @import("./http/FetchRedirect.zig").FetchRedirect;
pub const FetchCacheMode = @import("./http/FetchCacheMode.zig").FetchCacheMode;
pub const FetchRequestMode = @import("./http/FetchRequestMode.zig").FetchRequestMode;
pub const InitError = @import("./http/InitError.zig").InitError;
pub const HTTPRequestBody = @import("./http/HTTPRequestBody.zig").HTTPRequestBody;
pub const SendFile = @import("./http/SendFile.zig");
pub const HeaderValueIterator = @import("./http/HeaderValueIterator.zig");

const string = []const u8;

const HTTPCertError = @import("./http/HTTPCertError.zig");
const ProxyTunnel = @import("./http/ProxyTunnel.zig");
const std = @import("std");
const URL = @import("./url.zig").URL;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const Global = bun.Global;
const MutableString = bun.MutableString;
const Output = bun.Output;
const Progress = bun.Progress;
const StringBuilder = bun.StringBuilder;
const assert = bun.assert;
const jsc = bun.jsc;
const picohttp = bun.picohttp;
const strings = bun.strings;
const uws = bun.uws;
const Arena = bun.allocators.MimallocArena;
const BoringSSL = bun.BoringSSL.c;
const api = bun.schema.api;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const posix = std.posix;
const SOCK = posix.SOCK;
