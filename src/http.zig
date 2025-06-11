const bun = @import("bun");
const picohttp = bun.picohttp;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const stringZ = bun.stringZ;

const Loc = bun.logger.Loc;
const Log = bun.logger.Log;
const DotEnv = @import("./env_loader.zig");
const std = @import("std");
const URL = @import("./url.zig").URL;
const PercentEncoding = @import("./url.zig").PercentEncoding;
pub const Method = @import("./http/method.zig").Method;
const Api = @import("./api/schema.zig").Api;
const HTTPClient = @This();
const Zlib = @import("./zlib.zig");
const Brotli = bun.brotli;
const zstd = bun.zstd;
const StringBuilder = bun.StringBuilder;
const ThreadPool = bun.ThreadPool;
const posix = std.posix;
const SOCK = posix.SOCK;
const Arena = @import("./allocators/mimalloc_arena.zig").Arena;
const BoringSSL = bun.BoringSSL.c;
const Progress = bun.Progress;
const SSLConfig = @import("./bun.js/api/server.zig").ServerConfig.SSLConfig;
const SSLWrapper = @import("./bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;
const Blob = bun.webcore.Blob;
const FetchHeaders = bun.webcore.FetchHeaders;
const uws = bun.uws;
pub const MimeType = @import("./http/mime_type.zig");
pub const URLPath = @import("./http/url_path.zig");
// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
var default_arena: Arena = undefined;
pub var http_thread: HTTPThread = undefined;
const HiveArray = @import("./hive_array.zig").HiveArray;
const Batch = bun.ThreadPool.Batch;
const TaggedPointerUnion = @import("./ptr.zig").TaggedPointerUnion;
const DeadSocket = opaque {};
var dead_socket = @as(*DeadSocket, @ptrFromInt(1));
//TODO: this needs to be freed when Worker Threads are implemented
var socket_async_http_abort_tracker = std.AutoArrayHashMap(u32, uws.InternalSocket).init(bun.default_allocator);
var async_http_id_monotonic: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);
const MAX_REDIRECT_URL_LENGTH = 128 * 1024;
var custom_ssl_context_map = std.AutoArrayHashMap(*SSLConfig, *NewHTTPContext(true)).init(bun.default_allocator);

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

pub const end_of_chunked_http1_1_encoding_response_body = "0\r\n\r\n";

pub const Signals = struct {
    header_progress: ?*std.atomic.Value(bool) = null,
    body_streaming: ?*std.atomic.Value(bool) = null,
    aborted: ?*std.atomic.Value(bool) = null,
    cert_errors: ?*std.atomic.Value(bool) = null,

    pub fn isEmpty(this: *const Signals) bool {
        return this.aborted == null and this.body_streaming == null and this.header_progress == null and this.cert_errors == null;
    }

    pub const Store = struct {
        header_progress: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        body_streaming: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        aborted: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
        cert_errors: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

        pub fn to(this: *Store) Signals {
            return .{
                .header_progress = &this.header_progress,
                .body_streaming = &this.body_streaming,
                .aborted = &this.aborted,
                .cert_errors = &this.cert_errors,
            };
        }
    };

    pub fn get(this: Signals, comptime field: std.meta.FieldEnum(Signals)) bool {
        var ptr: *std.atomic.Value(bool) = @field(this, @tagName(field)) orelse return false;
        return ptr.load(.monotonic);
    }
};

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

pub const HTTPRequestBody = union(enum) {
    bytes: []const u8,
    sendfile: Sendfile,
    stream: struct {
        buffer: bun.io.StreamBuffer,
        ended: bool,
        has_backpressure: bool = false,

        pub fn hasEnded(this: *@This()) bool {
            return this.ended and this.buffer.isEmpty();
        }
    },

    pub fn isStream(this: *const HTTPRequestBody) bool {
        return this.* == .stream;
    }

    pub fn deinit(this: *HTTPRequestBody) void {
        switch (this.*) {
            .sendfile, .bytes => {},
            .stream => |*stream| stream.buffer.deinit(),
        }
    }
    pub fn len(this: *const HTTPRequestBody) usize {
        return switch (this.*) {
            .bytes => this.bytes.len,
            .sendfile => this.sendfile.content_size,
            // unknow amounts
            .stream => std.math.maxInt(usize),
        };
    }
};

pub const Sendfile = struct {
    fd: bun.FileDescriptor,
    remain: usize = 0,
    offset: usize = 0,
    content_size: usize = 0,

    pub fn isEligible(url: bun.URL) bool {
        if (comptime Environment.isWindows or !FeatureFlags.streaming_file_uploads_for_http_client) {
            return false;
        }
        return url.isHTTP() and url.href.len > 0;
    }

    pub fn write(
        this: *Sendfile,
        socket: NewHTTPContext(false).HTTPSocket,
    ) Status {
        const adjusted_count_temporary = @min(@as(u64, this.remain), @as(u63, std.math.maxInt(u63)));
        // TODO we should not need this int cast; improve the return type of `@min`
        const adjusted_count = @as(u63, @intCast(adjusted_count_temporary));

        if (Environment.isLinux) {
            var signed_offset = @as(i64, @intCast(this.offset));
            const begin = this.offset;
            const val =
                // this does the syscall directly, without libc
                std.os.linux.sendfile(socket.fd().cast(), this.fd.cast(), &signed_offset, this.remain);
            this.offset = @as(u64, @intCast(signed_offset));

            const errcode = bun.sys.getErrno(val);

            this.remain -|= @as(u64, @intCast(this.offset -| begin));

            if (errcode != .SUCCESS or this.remain == 0 or val == 0) {
                if (errcode == .SUCCESS) {
                    return .{ .done = {} };
                }

                return .{ .err = bun.errnoToZigErr(errcode) };
            }
        } else if (Environment.isPosix) {
            var sbytes: std.posix.off_t = adjusted_count;
            const signed_offset = @as(i64, @bitCast(@as(u64, this.offset)));
            const errcode = bun.sys.getErrno(std.c.sendfile(
                this.fd.cast(),
                socket.fd().cast(),
                signed_offset,
                &sbytes,
                null,
                0,
            ));
            const wrote = @as(u64, @intCast(sbytes));
            this.offset +|= wrote;
            this.remain -|= wrote;
            if (errcode != .AGAIN or this.remain == 0 or sbytes == 0) {
                if (errcode == .SUCCESS) {
                    return .{ .done = {} };
                }

                return .{ .err = bun.errnoToZigErr(errcode) };
            }
        }

        return .{ .again = {} };
    }

    pub const Status = union(enum) {
        done: void,
        err: anyerror,
        again: void,
    };
};

const ProxyTunnel = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", ProxyTunnel.deinit, .{});
    pub const ref = ProxyTunnel.RefCount.ref;
    pub const deref = ProxyTunnel.RefCount.deref;

    wrapper: ?ProxyTunnelWrapper = null,
    shutdown_err: anyerror = error.ConnectionClosed,
    // active socket is the socket that is currently being used
    socket: union(enum) {
        tcp: NewHTTPContext(false).HTTPSocket,
        ssl: NewHTTPContext(true).HTTPSocket,
        none: void,
    } = .{ .none = {} },
    write_buffer: bun.io.StreamBuffer = .{},
    ref_count: RefCount,

    const ProxyTunnelWrapper = SSLWrapper(*HTTPClient);

    fn onOpen(this: *HTTPClient) void {
        log("ProxyTunnel onOpen", .{});
        this.state.response_stage = .proxy_handshake;
        this.state.request_stage = .proxy_handshake;
        if (this.proxy_tunnel) |proxy| {
            proxy.ref();
            defer proxy.deref();
            if (proxy.wrapper) |*wrapper| {
                var ssl_ptr = wrapper.ssl orelse return;
                const _hostname = this.hostname orelse this.url.hostname;

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
        }
    }

    fn onData(this: *HTTPClient, decoded_data: []const u8) void {
        if (decoded_data.len == 0) return;
        log("ProxyTunnel onData decoded {}", .{decoded_data.len});
        if (this.proxy_tunnel) |proxy| {
            proxy.ref();
            defer proxy.deref();
            switch (this.state.response_stage) {
                .body => {
                    log("ProxyTunnel onData body", .{});
                    if (decoded_data.len == 0) return;
                    const report_progress = this.handleResponseBody(decoded_data, false) catch |err| {
                        proxy.close(err);
                        return;
                    };

                    if (report_progress) {
                        switch (proxy.socket) {
                            .ssl => |socket| {
                                this.progressUpdate(true, &http_thread.https_context, socket);
                            },
                            .tcp => |socket| {
                                this.progressUpdate(false, &http_thread.http_context, socket);
                            },
                            .none => {},
                        }
                        return;
                    }
                },
                .body_chunk => {
                    log("ProxyTunnel onData body_chunk", .{});
                    if (decoded_data.len == 0) return;
                    const report_progress = this.handleResponseBodyChunkedEncoding(decoded_data) catch |err| {
                        proxy.close(err);
                        return;
                    };

                    if (report_progress) {
                        switch (proxy.socket) {
                            .ssl => |socket| {
                                this.progressUpdate(true, &http_thread.https_context, socket);
                            },
                            .tcp => |socket| {
                                this.progressUpdate(false, &http_thread.http_context, socket);
                            },
                            .none => {},
                        }
                        return;
                    }
                },
                .proxy_headers => {
                    log("ProxyTunnel onData proxy_headers", .{});
                    switch (proxy.socket) {
                        .ssl => |socket| {
                            this.handleOnDataHeaders(true, decoded_data, &http_thread.https_context, socket);
                        },
                        .tcp => |socket| {
                            this.handleOnDataHeaders(false, decoded_data, &http_thread.http_context, socket);
                        },
                        .none => {},
                    }
                },
                else => {
                    log("ProxyTunnel onData unexpected data", .{});
                    this.state.pending_response = null;
                    proxy.close(error.UnexpectedData);
                },
            }
        }
    }

    fn onHandshake(this: *HTTPClient, handshake_success: bool, ssl_error: uws.us_bun_verify_error_t) void {
        if (this.proxy_tunnel) |proxy| {
            log("ProxyTunnel onHandshake", .{});
            proxy.ref();
            defer proxy.deref();
            this.state.response_stage = .proxy_headers;
            this.state.request_stage = .proxy_headers;
            this.state.request_sent_len = 0;
            const handshake_error = HTTPCertError{
                .error_no = ssl_error.error_no,
                .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
                .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
            };
            if (handshake_success) {
                log("ProxyTunnel onHandshake success", .{});
                // handshake completed but we may have ssl errors
                this.flags.did_have_handshaking_error = handshake_error.error_no != 0;
                if (this.flags.reject_unauthorized) {
                    // only reject the connection if reject_unauthorized == true
                    if (this.flags.did_have_handshaking_error) {
                        proxy.close(BoringSSL.getCertErrorFromNo(handshake_error.error_no));
                        return;
                    }

                    // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                    bun.assert(proxy.wrapper != null);
                    const ssl_ptr = proxy.wrapper.?.ssl orelse return;

                    switch (proxy.socket) {
                        .ssl => |socket| {
                            if (!this.checkServerIdentity(true, socket, handshake_error, ssl_ptr, false)) {
                                log("ProxyTunnel onHandshake checkServerIdentity failed", .{});
                                this.flags.did_have_handshaking_error = true;

                                this.unregisterAbortTracker();
                                return;
                            }
                        },
                        .tcp => |socket| {
                            if (!this.checkServerIdentity(false, socket, handshake_error, ssl_ptr, false)) {
                                log("ProxyTunnel onHandshake checkServerIdentity failed", .{});
                                this.flags.did_have_handshaking_error = true;
                                this.unregisterAbortTracker();
                                return;
                            }
                        },
                        .none => {},
                    }
                }

                switch (proxy.socket) {
                    .ssl => |socket| {
                        this.onWritable(true, true, socket);
                    },
                    .tcp => |socket| {
                        this.onWritable(true, false, socket);
                    },
                    .none => {},
                }
            } else {
                log("ProxyTunnel onHandshake failed", .{});
                // if we are here is because server rejected us, and the error_no is the cause of this
                // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                if (this.flags.did_have_handshaking_error and handshake_error.error_no != 0) {
                    proxy.close(BoringSSL.getCertErrorFromNo(handshake_error.error_no));
                    return;
                }
                // if handshake_success it self is false, this means that the connection was rejected
                proxy.close(error.ConnectionRefused);
                return;
            }
        }
    }

    pub fn write(this: *HTTPClient, encoded_data: []const u8) void {
        if (this.proxy_tunnel) |proxy| {
            const written = switch (proxy.socket) {
                .ssl => |socket| socket.write(encoded_data, false),
                .tcp => |socket| socket.write(encoded_data, false),
                .none => 0,
            };
            const pending = encoded_data[@intCast(written)..];
            if (pending.len > 0) {
                // lets flush when we are truly writable
                proxy.write_buffer.write(pending) catch bun.outOfMemory();
            }
        }
    }

    fn onClose(this: *HTTPClient) void {
        log("ProxyTunnel onClose {s}", .{if (this.proxy_tunnel == null) "tunnel is detached" else "tunnel exists"});
        if (this.proxy_tunnel) |proxy| {
            proxy.ref();
            // defer the proxy deref the proxy tunnel may still be in use after triggering the close callback
            defer http_thread.scheduleProxyDeref(proxy);
            const err = proxy.shutdown_err;
            switch (proxy.socket) {
                .ssl => |socket| {
                    this.closeAndFail(err, true, socket);
                },
                .tcp => |socket| {
                    this.closeAndFail(err, false, socket);
                },
                .none => {},
            }
            proxy.detachSocket();
        }
    }

    fn start(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, ssl_options: JSC.API.ServerConfig.SSLConfig, start_payload: []const u8) void {
        const proxy_tunnel = bun.new(ProxyTunnel, .{
            .ref_count = .init(),
        });

        var custom_options = ssl_options;
        // we always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        custom_options.reject_unauthorized = 0;
        custom_options.request_cert = 1;
        proxy_tunnel.wrapper = SSLWrapper(*HTTPClient).init(custom_options, true, .{
            .onOpen = ProxyTunnel.onOpen,
            .onData = ProxyTunnel.onData,
            .onHandshake = ProxyTunnel.onHandshake,
            .onClose = ProxyTunnel.onClose,
            .write = ProxyTunnel.write,
            .ctx = this,
        }) catch |err| {
            if (err == error.OutOfMemory) {
                bun.outOfMemory();
            }

            // invalid TLS Options
            proxy_tunnel.detachAndDeref();
            this.closeAndFail(error.ConnectionRefused, is_ssl, socket);
            return;
        };
        this.proxy_tunnel = proxy_tunnel;
        if (is_ssl) {
            proxy_tunnel.socket = .{ .ssl = socket };
        } else {
            proxy_tunnel.socket = .{ .tcp = socket };
        }
        if (start_payload.len > 0) {
            log("proxy tunnel start with payload", .{});
            proxy_tunnel.wrapper.?.startWithPayload(start_payload);
        } else {
            log("proxy tunnel start", .{});
            proxy_tunnel.wrapper.?.start();
        }
    }

    pub fn close(this: *ProxyTunnel, err: anyerror) void {
        this.shutdown_err = err;
        this.shutdown();
    }

    pub fn shutdown(this: *ProxyTunnel) void {
        if (this.wrapper) |*wrapper| {
            // fast shutdown the connection
            _ = wrapper.shutdown(true);
        }
    }

    pub fn onWritable(this: *ProxyTunnel, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
        log("ProxyTunnel onWritable", .{});
        this.ref();
        defer this.deref();
        defer if (this.wrapper) |*wrapper| {
            // Cycle to through the SSL state machine
            _ = wrapper.flush();
        };

        const encoded_data = this.write_buffer.slice();
        if (encoded_data.len == 0) {
            return;
        }
        const written = socket.write(encoded_data, true);
        if (written == encoded_data.len) {
            this.write_buffer.reset();
        } else {
            this.write_buffer.cursor += @intCast(written);
        }
    }

    pub fn receiveData(this: *ProxyTunnel, buf: []const u8) void {
        this.ref();
        defer this.deref();
        if (this.wrapper) |*wrapper| {
            wrapper.receiveData(buf);
        }
    }

    pub fn writeData(this: *ProxyTunnel, buf: []const u8) !usize {
        if (this.wrapper) |*wrapper| {
            return try wrapper.writeData(buf);
        }
        return error.ConnectionClosed;
    }

    pub fn detachSocket(this: *ProxyTunnel) void {
        this.socket = .{ .none = {} };
    }

    pub fn detachAndDeref(this: *ProxyTunnel) void {
        this.detachSocket();
        this.deref();
    }

    fn deinit(this: *ProxyTunnel) void {
        this.socket = .{ .none = {} };
        if (this.wrapper) |*wrapper| {
            wrapper.deinit();
            this.wrapper = null;
        }
        this.write_buffer.deinit();
        bun.destroy(this);
    }
};

pub const HTTPCertError = struct {
    error_no: i32 = 0,
    code: [:0]const u8 = "",
    reason: [:0]const u8 = "",
};

pub const InitError = error{
    FailedToOpenSocket,
    LoadCAFile,
    InvalidCAFile,
    InvalidCA,
};

fn NewHTTPContext(comptime ssl: bool) type {
    return struct {
        const pool_size = 64;
        const PooledSocket = struct {
            http_socket: HTTPSocket,
            hostname_buf: [MAX_KEEPALIVE_HOSTNAME]u8 = undefined,
            hostname_len: u8 = 0,
            port: u16 = 0,
            /// If you set `rejectUnauthorized` to `false`, the connection fails to verify,
            did_have_handshaking_error_while_reject_unauthorized_is_false: bool = false,
        };

        pub fn markSocketAsDead(socket: HTTPSocket) void {
            if (socket.ext(**anyopaque)) |ctx| {
                ctx.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
            }
        }

        fn terminateSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.failure);
        }

        fn closeSocket(socket: HTTPSocket) void {
            markSocketAsDead(socket);
            socket.close(.normal);
        }

        fn getTagged(ptr: *anyopaque) ActiveSocket {
            return ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
        }

        pub fn getTaggedFromSocket(socket: HTTPSocket) ActiveSocket {
            if (socket.ext(anyopaque)) |ctx| {
                return getTagged(ctx);
            }
            return ActiveSocket.init(&dead_socket);
        }

        pub const PooledSocketHiveAllocator = bun.HiveArray(PooledSocket, pool_size);

        pending_sockets: PooledSocketHiveAllocator,
        us_socket_context: *uws.SocketContext,

        const Context = @This();
        pub const HTTPSocket = uws.NewSocketHandler(ssl);

        pub fn context() *@This() {
            if (comptime ssl) {
                return &http_thread.https_context;
            } else {
                return &http_thread.http_context;
            }
        }

        const ActiveSocket = TaggedPointerUnion(.{
            *DeadSocket,
            HTTPClient,
            PooledSocket,
        });
        const ssl_int = @as(c_int, @intFromBool(ssl));

        const MAX_KEEPALIVE_HOSTNAME = 128;

        pub fn sslCtx(this: *@This()) *BoringSSL.SSL_CTX {
            if (comptime !ssl) {
                unreachable;
            }

            return @as(*BoringSSL.SSL_CTX, @ptrCast(this.us_socket_context.getNativeHandle(true)));
        }

        pub fn deinit(this: *@This()) void {
            this.us_socket_context.deinit(ssl);
            bun.default_allocator.destroy(this);
        }

        pub fn initWithClientConfig(this: *@This(), client: *HTTPClient) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts = client.tls_props.?.asUSockets();
            opts.request_cert = 1;
            opts.reject_unauthorized = 0;
            try this.initWithOpts(&opts);
        }

        fn initWithOpts(this: *@This(), opts: *const uws.SocketContext.BunSocketContextOptions) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }

            var err: uws.create_bun_socket_error_t = .none;
            const socket = uws.SocketContext.createSSLContext(http_thread.loop.loop, @sizeOf(usize), opts.*, &err);
            if (socket == null) {
                return switch (err) {
                    .load_ca_file => error.LoadCAFile,
                    .invalid_ca_file => error.InvalidCAFile,
                    .invalid_ca => error.InvalidCA,
                    else => error.FailedToOpenSocket,
                };
            }
            this.us_socket_context = socket.?;
            this.sslCtx().setup();

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        pub fn initWithThreadOpts(this: *@This(), init_opts: *const HTTPThread.InitOpts) InitError!void {
            if (!comptime ssl) {
                @compileError("ssl only");
            }
            var opts: uws.SocketContext.BunSocketContextOptions = .{
                .ca = if (init_opts.ca.len > 0) @ptrCast(init_opts.ca) else null,
                .ca_count = @intCast(init_opts.ca.len),
                .ca_file_name = if (init_opts.abs_ca_file_name.len > 0) init_opts.abs_ca_file_name else null,
                .request_cert = 1,
            };

            try this.initWithOpts(&opts);
        }

        pub fn init(this: *@This()) void {
            if (comptime ssl) {
                const opts: uws.SocketContext.BunSocketContextOptions = .{
                    // we request the cert so we load root certs and can verify it
                    .request_cert = 1,
                    // we manually abort the connection if the hostname doesn't match
                    .reject_unauthorized = 0,
                };
                var err: uws.create_bun_socket_error_t = .none;
                this.us_socket_context = uws.SocketContext.createSSLContext(http_thread.loop.loop, @sizeOf(usize), opts, &err).?;

                this.sslCtx().setup();
            } else {
                this.us_socket_context = uws.SocketContext.createNoSSLContext(http_thread.loop.loop, @sizeOf(usize)).?;
            }

            HTTPSocket.configure(
                this.us_socket_context,
                false,
                anyopaque,
                Handler,
            );
        }

        /// Attempt to keep the socket alive by reusing it for another request.
        /// If no space is available, close the socket.
        ///
        /// If `did_have_handshaking_error_while_reject_unauthorized_is_false`
        /// is set, then we can only reuse the socket for HTTP Keep Alive if
        /// `reject_unauthorized` is set to `false`.
        pub fn releaseSocket(this: *@This(), socket: HTTPSocket, did_have_handshaking_error_while_reject_unauthorized_is_false: bool, hostname: []const u8, port: u16) void {
            // log("releaseSocket(0x{})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

            if (comptime Environment.allow_assert) {
                assert(!socket.isClosed());
                assert(!socket.isShutdown());
                assert(socket.isEstablished());
            }
            assert(hostname.len > 0);
            assert(port > 0);

            if (hostname.len <= MAX_KEEPALIVE_HOSTNAME and !socket.isClosedOrHasError() and socket.isEstablished()) {
                if (this.pending_sockets.get()) |pending| {
                    if (socket.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(pending).ptr());
                    }
                    socket.flush();
                    socket.timeout(0);
                    socket.setTimeoutMinutes(5);

                    pending.http_socket = socket;
                    pending.did_have_handshaking_error_while_reject_unauthorized_is_false = did_have_handshaking_error_while_reject_unauthorized_is_false;
                    @memcpy(pending.hostname_buf[0..hostname.len], hostname);
                    pending.hostname_len = @as(u8, @truncate(hostname.len));
                    pending.port = port;

                    log("Keep-Alive release {s}:{d}", .{
                        hostname,
                        port,
                    });
                    return;
                }
            }
            log("close socket", .{});
            closeSocket(socket);
        }

        pub const Handler = struct {
            pub fn onOpen(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    if (client.onOpen(comptime ssl, socket)) |_| {
                        return;
                    } else |_| {
                        log("Unable to open socket", .{});
                        terminateSocket(socket);
                        return;
                    }
                }

                if (active.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                    return;
                }

                log("Unexpected open on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onHandshake(
                ptr: *anyopaque,
                socket: HTTPSocket,
                success: i32,
                ssl_error: uws.us_bun_verify_error_t,
            ) void {
                const handshake_success = if (success == 1) true else false;

                const handshake_error = HTTPCertError{
                    .error_no = ssl_error.error_no,
                    .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
                    .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
                };

                const active = getTagged(ptr);
                if (active.get(HTTPClient)) |client| {
                    // handshake completed but we may have ssl errors
                    client.flags.did_have_handshaking_error = handshake_error.error_no != 0;
                    if (handshake_success) {
                        if (client.flags.reject_unauthorized) {
                            // only reject the connection if reject_unauthorized == true
                            if (client.flags.did_have_handshaking_error) {
                                client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                                return;
                            }

                            // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                            if (!client.checkServerIdentity(comptime ssl, socket, handshake_error, ssl_ptr, true)) {
                                client.flags.did_have_handshaking_error = true;
                                client.unregisterAbortTracker();
                                if (!socket.isClosed()) terminateSocket(socket);
                                return;
                            }
                        }

                        return client.firstCall(comptime ssl, socket);
                    } else {
                        // if we are here is because server rejected us, and the error_no is the cause of this
                        // if we set reject_unauthorized == false this means the server requires custom CA aka NODE_EXTRA_CA_CERTS
                        if (client.flags.did_have_handshaking_error) {
                            client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                            return;
                        }
                        // if handshake_success it self is false, this means that the connection was rejected
                        client.closeAndFail(error.ConnectionRefused, comptime ssl, socket);
                        return;
                    }
                }

                if (socket.isClosed()) {
                    markSocketAsDead(socket);
                    if (active.get(PooledSocket)) |pooled| {
                        addMemoryBackToPool(pooled);
                    }

                    return;
                }

                if (handshake_success) {
                    if (active.is(PooledSocket)) {
                        // Allow pooled sockets to be reused if the handshake was successful.
                        socket.setTimeout(0);
                        socket.setTimeoutMinutes(5);
                        return;
                    }
                }

                if (active.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }

                terminateSocket(socket);
            }
            pub fn onClose(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
                _: ?*anyopaque,
            ) void {
                const tagged = getTagged(ptr);
                markSocketAsDead(socket);

                if (tagged.get(HTTPClient)) |client| {
                    return client.onClose(comptime ssl, socket);
                }

                if (tagged.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }

                return;
            }

            fn addMemoryBackToPool(pooled: *PooledSocket) void {
                assert(context().pending_sockets.put(pooled));
            }

            pub fn onData(
                ptr: *anyopaque,
                socket: HTTPSocket,
                buf: []const u8,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onData(
                        comptime ssl,
                        buf,
                        if (comptime ssl) &http_thread.https_context else &http_thread.http_context,
                        socket,
                    );
                } else if (tagged.is(PooledSocket)) {
                    // trailing zero is fine to ignore
                    if (strings.eqlComptime(buf, end_of_chunked_http1_1_encoding_response_body)) {
                        return;
                    }

                    log("Unexpected data on socket", .{});

                    return;
                }
                log("Unexpected data on unknown socket", .{});
                terminateSocket(socket);
            }
            pub fn onWritable(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onWritable(
                        false,
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.is(PooledSocket)) {
                    // it's a keep-alive socket
                } else {
                    // don't know what this is, let's close it
                    log("Unexpected writable on socket", .{});
                    terminateSocket(socket);
                }
            }
            pub fn onLongTimeout(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const tagged = getTagged(ptr);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onTimeout(comptime ssl, socket);
                } else if (tagged.get(PooledSocket)) |pooled| {
                    // If a socket has been sitting around for 5 minutes
                    // Let's close it and remove it from the pool.
                    addMemoryBackToPool(pooled);
                }

                terminateSocket(socket);
            }
            pub fn onConnectError(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
            ) void {
                const tagged = getTagged(ptr);
                markSocketAsDead(socket);
                if (tagged.get(HTTPClient)) |client| {
                    client.onConnectError();
                } else if (tagged.get(PooledSocket)) |pooled| {
                    addMemoryBackToPool(pooled);
                }
                // us_connecting_socket_close is always called internally by uSockets
            }
            pub fn onEnd(
                _: *anyopaque,
                socket: HTTPSocket,
            ) void {
                // TCP fin must be closed, but we must keep the original tagged
                // pointer so that their onClose callback is called.
                //
                // Three possible states:
                // 1. HTTP Keep-Alive socket: it must be removed from the pool
                // 2. HTTP Client socket: it might need to be retried
                // 3. Dead socket: it is already marked as dead
                socket.close(.failure);
            }
        };

        fn existingSocket(this: *@This(), reject_unauthorized: bool, hostname: []const u8, port: u16) ?HTTPSocket {
            if (hostname.len > MAX_KEEPALIVE_HOSTNAME)
                return null;

            var iter = this.pending_sockets.used.iterator(.{ .kind = .set });

            while (iter.next()) |pending_socket_index| {
                var socket = this.pending_sockets.at(@as(u16, @intCast(pending_socket_index)));
                if (socket.port != port) {
                    continue;
                }

                if (socket.did_have_handshaking_error_while_reject_unauthorized_is_false and reject_unauthorized) {
                    continue;
                }

                if (strings.eqlLong(socket.hostname_buf[0..socket.hostname_len], hostname, true)) {
                    const http_socket = socket.http_socket;
                    assert(context().pending_sockets.put(socket));

                    if (http_socket.isClosed()) {
                        markSocketAsDead(http_socket);
                        continue;
                    }

                    if (http_socket.isShutdown() or http_socket.getError() != 0) {
                        terminateSocket(http_socket);
                        continue;
                    }

                    log("+ Keep-Alive reuse {s}:{d}", .{ hostname, port });
                    return http_socket;
                }
            }

            return null;
        }

        pub fn connectSocket(this: *@This(), client: *HTTPClient, socket_path: []const u8) !HTTPSocket {
            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            const socket = try HTTPSocket.connectUnixAnon(
                socket_path,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false, // dont allow half-open sockets
            );
            client.allow_retry = false;
            return socket;
        }

        pub fn connect(this: *@This(), client: *HTTPClient, hostname_: []const u8, port: u16) !HTTPSocket {
            const hostname = if (FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(hostname_, "localhost"))
                "127.0.0.1"
            else
                hostname_;

            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            client.connected_url.hostname = hostname;

            if (client.isKeepAlivePossible()) {
                if (this.existingSocket(client.flags.reject_unauthorized, hostname, port)) |sock| {
                    if (sock.ext(**anyopaque)) |ctx| {
                        ctx.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                    }
                    client.allow_retry = true;
                    try client.onOpen(comptime ssl, sock);
                    if (comptime ssl) {
                        client.firstCall(comptime ssl, sock);
                    }
                    return sock;
                }
            }

            const socket = try HTTPSocket.connectAnon(
                hostname,
                port,
                this.us_socket_context,
                ActiveSocket.init(client).ptr(),
                false,
            );
            client.allow_retry = false;
            return socket;
        }
    };
}

const UnboundedQueue = @import("./bun.js/unbounded_queue.zig").UnboundedQueue;
const Queue = UnboundedQueue(AsyncHTTP, .next);

pub const HTTPThread = struct {
    loop: *JSC.MiniEventLoop,
    http_context: NewHTTPContext(false),
    https_context: NewHTTPContext(true),

    queued_tasks: Queue = Queue{},

    queued_shutdowns: std.ArrayListUnmanaged(ShutdownMessage) = std.ArrayListUnmanaged(ShutdownMessage){},
    queued_writes: std.ArrayListUnmanaged(WriteMessage) = std.ArrayListUnmanaged(WriteMessage){},

    queued_shutdowns_lock: bun.Mutex = .{},
    queued_writes_lock: bun.Mutex = .{},

    queued_proxy_deref: std.ArrayListUnmanaged(*ProxyTunnel) = std.ArrayListUnmanaged(*ProxyTunnel){},

    has_awoken: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    timer: std.time.Timer,
    lazy_libdeflater: ?*LibdeflateState = null,
    lazy_request_body_buffer: ?*HeapRequestBodyBuffer = null,

    pub const HeapRequestBodyBuffer = struct {
        buffer: [512 * 1024]u8 = undefined,
        fixed_buffer_allocator: std.heap.FixedBufferAllocator,

        pub const new = bun.TrivialNew(@This());
        pub const deinit = bun.TrivialDeinit(@This());

        pub fn init() *@This() {
            var this = HeapRequestBodyBuffer.new(.{
                .fixed_buffer_allocator = undefined,
            });
            this.fixed_buffer_allocator = std.heap.FixedBufferAllocator.init(&this.buffer);
            return this;
        }

        pub fn put(this: *@This()) void {
            if (http_thread.lazy_request_body_buffer == null) {
                // This case hypothetically should never happen
                this.fixed_buffer_allocator.reset();
                http_thread.lazy_request_body_buffer = this;
            } else {
                this.deinit();
            }
        }
    };

    pub const RequestBodyBuffer = union(enum) {
        heap: *HeapRequestBodyBuffer,
        stack: std.heap.StackFallbackAllocator(request_body_send_stack_buffer_size),

        pub fn deinit(this: *@This()) void {
            switch (this.*) {
                .heap => |heap| heap.put(),
                .stack => {},
            }
        }

        pub fn allocatedSlice(this: *@This()) []u8 {
            return switch (this.*) {
                .heap => |heap| &heap.buffer,
                .stack => |*stack| &stack.buffer,
            };
        }

        pub fn allocator(this: *@This()) std.mem.Allocator {
            return switch (this.*) {
                .heap => |heap| heap.fixed_buffer_allocator.allocator(),
                .stack => |*stack| stack.get(),
            };
        }

        pub fn toArrayList(this: *@This()) std.ArrayList(u8) {
            var arraylist = std.ArrayList(u8).fromOwnedSlice(this.allocator(), this.allocatedSlice());
            arraylist.items.len = 0;
            return arraylist;
        }
    };

    const threadlog = Output.scoped(.HTTPThread, true);
    const WriteMessage = struct {
        data: []const u8,
        async_http_id: u32,
        flags: packed struct(u8) {
            is_tls: bool,
            ended: bool,
            _: u6 = 0,
        },
    };
    const ShutdownMessage = struct {
        async_http_id: u32,
        is_tls: bool,
    };

    pub const LibdeflateState = struct {
        decompressor: *bun.libdeflate.Decompressor = undefined,
        shared_buffer: [512 * 1024]u8 = undefined,

        pub const new = bun.TrivialNew(@This());
    };

    const request_body_send_stack_buffer_size = 32 * 1024;

    pub inline fn getRequestBodySendBuffer(this: *@This(), estimated_size: usize) RequestBodyBuffer {
        if (estimated_size >= request_body_send_stack_buffer_size) {
            if (this.lazy_request_body_buffer == null) {
                log("Allocating HeapRequestBodyBuffer due to {d} bytes request body", .{estimated_size});
                return .{
                    .heap = HeapRequestBodyBuffer.init(),
                };
            }

            return .{ .heap = bun.take(&this.lazy_request_body_buffer).? };
        }
        return .{
            .stack = std.heap.stackFallback(request_body_send_stack_buffer_size, bun.default_allocator),
        };
    }

    pub fn deflater(this: *@This()) *LibdeflateState {
        if (this.lazy_libdeflater == null) {
            this.lazy_libdeflater = LibdeflateState.new(.{
                .decompressor = bun.libdeflate.Decompressor.alloc() orelse bun.outOfMemory(),
            });
        }

        return this.lazy_libdeflater.?;
    }

    fn onInitErrorNoop(err: InitError, opts: InitOpts) noreturn {
        switch (err) {
            error.LoadCAFile => {
                if (!bun.sys.existsZ(opts.abs_ca_file_name)) {
                    Output.err("HTTPThread", "failed to find CA file: '{s}'", .{opts.abs_ca_file_name});
                } else {
                    Output.err("HTTPThread", "failed to load CA file: '{s}'", .{opts.abs_ca_file_name});
                }
            },
            error.InvalidCAFile => {
                Output.err("HTTPThread", "the CA file is invalid: '{s}'", .{opts.abs_ca_file_name});
            },
            error.InvalidCA => {
                Output.err("HTTPThread", "the provided CA is invalid", .{});
            },
            error.FailedToOpenSocket => {
                Output.errGeneric("failed to start HTTP client thread", .{});
            },
        }
        Global.crash();
    }

    pub const InitOpts = struct {
        ca: []stringZ = &.{},
        abs_ca_file_name: stringZ = &.{},
        for_install: bool = false,

        onInitError: *const fn (err: InitError, opts: InitOpts) noreturn = &onInitErrorNoop,
    };

    fn initOnce(opts: *const InitOpts) void {
        http_thread = .{
            .loop = undefined,
            .http_context = .{
                .us_socket_context = undefined,
                .pending_sockets = NewHTTPContext(false).PooledSocketHiveAllocator.empty,
            },
            .https_context = .{
                .us_socket_context = undefined,
                .pending_sockets = NewHTTPContext(true).PooledSocketHiveAllocator.empty,
            },
            .timer = std.time.Timer.start() catch unreachable,
        };
        bun.libdeflate.load();
        const thread = std.Thread.spawn(
            .{
                .stack_size = bun.default_thread_stack_size,
            },
            onStart,
            .{opts.*},
        ) catch |err| Output.panic("Failed to start HTTP Client thread: {s}", .{@errorName(err)});
        thread.detach();
    }
    var init_once = bun.once(initOnce);

    pub fn init(opts: *const InitOpts) void {
        init_once.call(.{opts});
    }

    pub fn onStart(opts: InitOpts) void {
        Output.Source.configureNamedThread("HTTP Client");
        default_arena = Arena.init() catch unreachable;
        default_allocator = default_arena.allocator();

        const loop = bun.JSC.MiniEventLoop.initGlobal(null);

        if (Environment.isWindows) {
            _ = std.process.getenvW(comptime bun.strings.w("SystemRoot")) orelse {
                bun.Output.errGeneric("The %SystemRoot% environment variable is not set. Bun needs this set in order for network requests to work.", .{});
                Global.crash();
            };
        }

        http_thread.loop = loop;
        http_thread.http_context.init();
        http_thread.https_context.initWithThreadOpts(&opts) catch |err| opts.onInitError(err, opts);
        http_thread.has_awoken.store(true, .monotonic);
        http_thread.processEvents();
    }

    pub fn connect(this: *@This(), client: *HTTPClient, comptime is_ssl: bool) !NewHTTPContext(is_ssl).HTTPSocket {
        if (client.unix_socket_path.length() > 0) {
            return try this.context(is_ssl).connectSocket(client, client.unix_socket_path.slice());
        }

        if (comptime is_ssl) {
            const needs_own_context = client.tls_props != null and client.tls_props.?.requires_custom_request_ctx;
            if (needs_own_context) {
                var requested_config = client.tls_props.?;
                for (custom_ssl_context_map.keys()) |other_config| {
                    if (requested_config.isSame(other_config)) {
                        // we free the callers config since we have a existing one
                        if (requested_config != client.tls_props) {
                            requested_config.deinit();
                            bun.default_allocator.destroy(requested_config);
                        }
                        client.tls_props = other_config;
                        if (client.http_proxy) |url| {
                            return try custom_ssl_context_map.get(other_config).?.connect(client, url.hostname, url.getPortAuto());
                        } else {
                            return try custom_ssl_context_map.get(other_config).?.connect(client, client.url.hostname, client.url.getPortAuto());
                        }
                    }
                }
                // we need the config so dont free it
                var custom_context = try bun.default_allocator.create(NewHTTPContext(is_ssl));
                custom_context.initWithClientConfig(client) catch |err| {
                    client.tls_props = null;

                    requested_config.deinit();
                    bun.default_allocator.destroy(requested_config);
                    bun.default_allocator.destroy(custom_context);

                    // TODO: these error names reach js. figure out how they should be handled
                    return switch (err) {
                        error.FailedToOpenSocket => |e| e,
                        error.InvalidCA => error.FailedToOpenSocket,
                        error.InvalidCAFile => error.FailedToOpenSocket,
                        error.LoadCAFile => error.FailedToOpenSocket,
                    };
                };
                try custom_ssl_context_map.put(requested_config, custom_context);
                // We might deinit the socket context, so we disable keepalive to make sure we don't
                // free it while in use.
                client.flags.disable_keepalive = true;
                if (client.http_proxy) |url| {
                    // https://github.com/oven-sh/bun/issues/11343
                    if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                        return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
                    }
                    return error.UnsupportedProxyProtocol;
                }
                return try custom_context.connect(client, client.url.hostname, client.url.getPortAuto());
            }
        }
        if (client.http_proxy) |url| {
            if (url.href.len > 0) {
                // https://github.com/oven-sh/bun/issues/11343
                if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "https") or strings.eqlComptime(url.protocol, "http")) {
                    return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
                }
                return error.UnsupportedProxyProtocol;
            }
        }
        return try this.context(is_ssl).connect(client, client.url.hostname, client.url.getPortAuto());
    }

    pub fn context(this: *@This(), comptime is_ssl: bool) *NewHTTPContext(is_ssl) {
        return if (is_ssl) &this.https_context else &this.http_context;
    }

    fn drainEvents(this: *@This()) void {
        {
            this.queued_shutdowns_lock.lock();
            defer this.queued_shutdowns_lock.unlock();
            for (this.queued_shutdowns.items) |http| {
                if (socket_async_http_abort_tracker.fetchSwapRemove(http.async_http_id)) |socket_ptr| {
                    if (http.is_tls) {
                        const socket = uws.SocketTLS.fromAny(socket_ptr.value);
                        // do a fast shutdown here since we are aborting and we dont want to wait for the close_notify from the other side
                        socket.close(.failure);
                    } else {
                        const socket = uws.SocketTCP.fromAny(socket_ptr.value);
                        socket.close(.failure);
                    }
                }
            }
            this.queued_shutdowns.clearRetainingCapacity();
        }
        {
            this.queued_writes_lock.lock();
            defer this.queued_writes_lock.unlock();
            for (this.queued_writes.items) |write| {
                const ended = write.flags.ended;
                defer if (!strings.eqlComptime(write.data, end_of_chunked_http1_1_encoding_response_body) and write.data.len > 0) {
                    // "0\r\n\r\n" is always a static so no need to free
                    bun.default_allocator.free(write.data);
                };
                if (socket_async_http_abort_tracker.get(write.async_http_id)) |socket_ptr| {
                    if (write.flags.is_tls) {
                        const socket = uws.SocketTLS.fromAny(socket_ptr);
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(true).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                if (write.data.len > 0) {
                                    stream.buffer.write(write.data) catch {};
                                }
                                stream.ended = ended;
                                if (!stream.has_backpressure) {
                                    client.onWritable(
                                        false,
                                        true,
                                        socket,
                                    );
                                }
                            }
                        }
                    } else {
                        const socket = uws.SocketTCP.fromAny(socket_ptr);
                        if (socket.isClosed() or socket.isShutdown()) {
                            continue;
                        }
                        const tagged = NewHTTPContext(false).getTaggedFromSocket(socket);
                        if (tagged.get(HTTPClient)) |client| {
                            if (client.state.original_request_body == .stream) {
                                var stream = &client.state.original_request_body.stream;
                                if (write.data.len > 0) {
                                    stream.buffer.write(write.data) catch {};
                                }
                                stream.ended = ended;
                                if (!stream.has_backpressure) {
                                    client.onWritable(
                                        false,
                                        false,
                                        socket,
                                    );
                                }
                            }
                        }
                    }
                }
            }
            this.queued_writes.clearRetainingCapacity();
        }

        while (this.queued_proxy_deref.pop()) |http| {
            http.deref();
        }

        var count: usize = 0;
        var active = AsyncHTTP.active_requests_count.load(.monotonic);
        const max = AsyncHTTP.max_simultaneous_requests.load(.monotonic);
        if (active >= max) return;
        defer {
            if (comptime Environment.allow_assert) {
                if (count > 0)
                    log("Processed {d} tasks\n", .{count});
            }
        }

        while (this.queued_tasks.pop()) |http| {
            var cloned = ThreadlocalAsyncHTTP.new(.{
                .async_http = http.*,
            });
            cloned.async_http.real = http;
            cloned.async_http.onStart();
            if (comptime Environment.allow_assert) {
                count += 1;
            }

            active += 1;
            if (active >= max) break;
        }
    }

    fn processEvents(this: *@This()) noreturn {
        if (comptime Environment.isPosix) {
            this.loop.loop.num_polls = @max(2, this.loop.loop.num_polls);
        } else if (comptime Environment.isWindows) {
            this.loop.loop.inc();
        } else {
            @compileError("TODO:");
        }

        while (true) {
            this.drainEvents();

            var start_time: i128 = 0;
            if (comptime Environment.isDebug) {
                start_time = std.time.nanoTimestamp();
            }
            Output.flush();

            this.loop.loop.inc();
            this.loop.loop.tick();
            this.loop.loop.dec();

            // this.loop.run();
            if (comptime Environment.isDebug) {
                const end = std.time.nanoTimestamp();
                threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start_time)))});
                Output.flush();
            }
        }
    }

    pub fn scheduleShutdown(this: *@This(), http: *AsyncHTTP) void {
        {
            this.queued_shutdowns_lock.lock();
            defer this.queued_shutdowns_lock.unlock();
            this.queued_shutdowns.append(bun.default_allocator, .{
                .async_http_id = http.async_http_id,
                .is_tls = http.client.isHTTPS(),
            }) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn scheduleRequestWrite(this: *@This(), http: *AsyncHTTP, data: []const u8, ended: bool) void {
        {
            this.queued_writes_lock.lock();
            defer this.queued_writes_lock.unlock();
            this.queued_writes.append(bun.default_allocator, .{
                .async_http_id = http.async_http_id,
                .data = data,
                .flags = .{
                    .is_tls = http.client.isHTTPS(),
                    .ended = ended,
                },
            }) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn scheduleProxyDeref(this: *@This(), proxy: *ProxyTunnel) void {
        // this is always called on the http thread
        {
            this.queued_proxy_deref.append(bun.default_allocator, proxy) catch bun.outOfMemory();
        }
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn wakeup(this: *@This()) void {
        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }

    pub fn schedule(this: *@This(), batch: Batch) void {
        if (batch.len == 0)
            return;

        {
            var batch_ = batch;
            while (batch_.pop()) |task| {
                const http: *AsyncHTTP = @fieldParentPtr("task", task);
                this.queued_tasks.push(http);
            }
        }

        if (this.has_awoken.load(.monotonic))
            this.loop.loop.wakeup();
    }
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
                    const cert = bun.default_allocator.alloc(u8, @intCast(cert_size)) catch bun.outOfMemory();
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
                        .hostname = bun.default_allocator.dupe(u8, hostname) catch bun.outOfMemory(),
                        .cert_error = .{
                            .error_no = certError.error_no,
                            .code = bun.default_allocator.dupeZ(u8, certError.code) catch bun.outOfMemory(),
                            .reason = bun.default_allocator.dupeZ(u8, certError.reason) catch bun.outOfMemory(),
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

fn registerAbortTracker(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (client.signals.aborted != null) {
        socket_async_http_abort_tracker.put(client.async_http_id, socket.socket) catch unreachable;
    }
}

fn unregisterAbortTracker(
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

pub const CertificateInfo = struct {
    cert: []const u8,
    cert_error: HTTPCertError,
    hostname: []const u8,
    pub fn deinit(this: *const CertificateInfo, allocator: std.mem.Allocator) void {
        allocator.free(this.cert);
        allocator.free(this.cert_error.code);
        allocator.free(this.cert_error.reason);
        allocator.free(this.hostname);
    }
};

const Decompressor = union(enum) {
    zlib: *Zlib.ZlibReaderArrayList,
    brotli: *Brotli.BrotliReaderArrayList,
    zstd: *zstd.ZstdReaderArrayList,
    none: void,

    pub fn deinit(this: *Decompressor) void {
        switch (this.*) {
            inline .brotli, .zlib, .zstd => |that| {
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
                .zstd => {
                    this.* = .{
                        .zstd = try zstd.ZstdReaderArrayList.initWithListAllocator(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            default_allocator,
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
            .zstd => |reader| {
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
            .zstd => |reader| try reader.readAll(is_done),
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

    pub const InternalStateFlags = packed struct(u8) {
        allow_keepalive: bool = true,
        received_last_chunk: bool = false,
        did_set_content_encoding: bool = false,
        is_redirect_pending: bool = false,
        is_libdeflate_fast_path_disabled: bool = false,
        resend_request_body_on_redirect: bool = false,
        _padding: u2 = 0,
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
            info.deinit(bun.default_allocator);
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
            .total_body_received = 0,
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
            Encoding.brotli, Encoding.gzip, Encoding.deflate, Encoding.zstd => {
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

pub const HTTPVerboseLevel = enum {
    none,
    headers,
    curl,
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
    _padding: u5 = 0,
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
        bun.default_allocator.free(this.redirect);
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
        if (this.proxy_tunnel != null or (this.http_proxy != null and this.url.isHTTPS())) {
            log("Keep-Alive release (proxy tunneling https)", .{});
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
// for each request we need this hashs, putting on top of the file to avoid exceeding comptime quota limit
const authorization_header_hash = hashHeaderConst("Authorization");
const proxy_authorization_header_hash = hashHeaderConst("Proxy-Authorization");
const cookie_header_hash = hashHeaderConst("Cookie");

pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    zstd,
    chunked,

    pub fn canUseLibDeflate(this: Encoding) bool {
        return switch (this) {
            .gzip, .deflate => true,
            else => false,
        };
    }

    pub fn isCompressed(this: Encoding) bool {
        return switch (this) {
            .brotli, .gzip, .deflate, .zstd => true,
            else => false,
        };
    }
};

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const chunked_encoded_header = picohttp.Header{ .name = "Transfer-Encoding", .value = "chunked" };
const connection_header = picohttp.Header{ .name = "Connection", .value = "keep-alive" };
const connection_closing_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "gzip, deflate, br, zstd";
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

pub const AsyncHTTP = struct {
    request: ?picohttp.Request = null,
    response: ?picohttp.Response = null,
    request_headers: Headers.Entry.List = .empty,
    response_headers: Headers.Entry.List = .empty,
    response_buffer: *MutableString,
    request_body: HTTPRequestBody = .{ .bytes = "" },
    allocator: std.mem.Allocator,
    request_header_buf: string = "",
    method: Method = Method.GET,
    url: URL,
    http_proxy: ?URL = null,
    real: ?*AsyncHTTP = null,
    next: ?*AsyncHTTP = null,

    task: ThreadPool.Task = ThreadPool.Task{ .callback = &startAsyncHTTP },
    result_callback: HTTPClientResult.Callback = undefined,

    redirected: bool = false,

    response_encoding: Encoding = Encoding.identity,
    verbose: HTTPVerboseLevel = .none,

    client: HTTPClient = undefined,
    waitingDeffered: bool = false,
    finalized: bool = false,
    err: ?anyerror = null,
    async_http_id: u32 = 0,

    state: AtomicState = AtomicState.init(State.pending),
    elapsed: u64 = 0,
    gzip_elapsed: u64 = 0,

    signals: Signals = .{},

    pub var active_requests_count = std.atomic.Value(usize).init(0);
    pub var max_simultaneous_requests = std.atomic.Value(usize).init(256);

    pub fn loadEnv(allocator: std.mem.Allocator, logger: *Log, env: *DotEnv.Loader) void {
        if (env.get("BUN_CONFIG_MAX_HTTP_REQUESTS")) |max_http_requests| {
            const max = std.fmt.parseInt(u16, max_http_requests, 10) catch {
                logger.addErrorFmt(
                    null,
                    Loc.Empty,
                    allocator,
                    "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{s}\" is not a valid integer between 1 and 65535",
                    .{max_http_requests},
                ) catch unreachable;
                return;
            };
            if (max == 0) {
                logger.addWarningFmt(
                    null,
                    Loc.Empty,
                    allocator,
                    "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535",
                    .{},
                ) catch unreachable;
                return;
            }
            AsyncHTTP.max_simultaneous_requests.store(max, .monotonic);
        }
    }

    pub fn signalHeaderProgress(this: *AsyncHTTP) void {
        var progress = this.signals.header_progress orelse return;
        progress.store(true, .release);
    }

    pub fn enableBodyStreaming(this: *AsyncHTTP) void {
        var stream = this.signals.body_streaming orelse return;
        stream.store(true, .release);
    }

    pub fn clearData(this: *AsyncHTTP) void {
        this.response_headers.deinit(this.allocator);
        this.response_headers = .{};
        this.request = null;
        this.response = null;
        this.client.unix_socket_path.deinit();
        this.client.unix_socket_path = JSC.ZigString.Slice.empty;
    }

    pub const State = enum(u32) {
        pending = 0,
        scheduled = 1,
        sending = 2,
        success = 3,
        fail = 4,
    };
    const AtomicState = std.atomic.Value(State);

    pub const Options = struct {
        http_proxy: ?URL = null,
        hostname: ?[]u8 = null,
        signals: ?Signals = null,
        unix_socket_path: ?JSC.ZigString.Slice = null,
        disable_timeout: ?bool = null,
        verbose: ?HTTPVerboseLevel = null,
        disable_keepalive: ?bool = null,
        disable_decompression: ?bool = null,
        reject_unauthorized: ?bool = null,
        tls_props: ?*SSLConfig = null,
    };

    const Preconnect = struct {
        async_http: AsyncHTTP,
        response_buffer: MutableString,
        url: bun.URL,
        is_url_owned: bool,

        pub const new = bun.TrivialNew(@This());

        pub fn onResult(this: *Preconnect, _: *AsyncHTTP, _: HTTPClientResult) void {
            this.response_buffer.deinit();
            this.async_http.clearData();
            this.async_http.client.deinit();
            if (this.is_url_owned) {
                bun.default_allocator.free(this.url.href);
            }

            bun.destroy(this);
        }
    };

    pub fn preconnect(
        url: URL,
        is_url_owned: bool,
    ) void {
        if (!FeatureFlags.is_fetch_preconnect_supported) {
            if (is_url_owned) {
                bun.default_allocator.free(url.href);
            }

            return;
        }

        var this = Preconnect.new(.{
            .async_http = undefined,
            .response_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .url = url,
            .is_url_owned = is_url_owned,
        });

        this.async_http = AsyncHTTP.init(bun.default_allocator, .GET, url, .{}, "", &this.response_buffer, "", HTTPClientResult.Callback.New(*Preconnect, Preconnect.onResult).init(this), .manual, .{});
        this.async_http.client.flags.is_preconnect_only = true;

        http_thread.schedule(Batch.from(&this.async_http.task));
    }

    pub fn init(
        allocator: std.mem.Allocator,
        method: Method,
        url: URL,
        headers: Headers.Entry.List,
        headers_buf: string,
        response_buffer: *MutableString,
        request_body: []const u8,
        callback: HTTPClientResult.Callback,
        redirect_type: FetchRedirect,
        options: Options,
    ) AsyncHTTP {
        var this = AsyncHTTP{
            .allocator = allocator,
            .url = url,
            .method = method,
            .request_headers = headers,
            .request_header_buf = headers_buf,
            .request_body = .{ .bytes = request_body },
            .response_buffer = response_buffer,
            .result_callback = callback,
            .http_proxy = options.http_proxy,
            .signals = options.signals orelse .{},
            .async_http_id = if (options.signals != null and options.signals.?.aborted != null) async_http_id_monotonic.fetchAdd(1, .monotonic) else 0,
        };

        this.client = .{
            .allocator = allocator,
            .method = method,
            .url = url,
            .header_entries = headers,
            .header_buf = headers_buf,
            .hostname = options.hostname,
            .signals = options.signals orelse this.signals,
            .async_http_id = this.async_http_id,
            .http_proxy = this.http_proxy,
            .redirect_type = redirect_type,
        };
        if (options.unix_socket_path) |val| {
            assert(this.client.unix_socket_path.length() == 0);
            this.client.unix_socket_path = val;
        }
        if (options.disable_timeout) |val| {
            this.client.flags.disable_timeout = val;
        }
        if (options.verbose) |val| {
            this.client.verbose = val;
        }
        if (options.disable_decompression) |val| {
            this.client.flags.disable_decompression = val;
        }
        if (options.disable_keepalive) |val| {
            this.client.flags.disable_keepalive = val;
        }
        if (options.reject_unauthorized) |val| {
            this.client.flags.reject_unauthorized = val;
        }
        if (options.tls_props) |val| {
            this.client.tls_props = val;
        }

        if (options.http_proxy) |proxy| {
            // Username between 0 and 4096 chars
            if (proxy.username.len > 0 and proxy.username.len < 4096) {
                // Password between 0 and 4096 chars
                if (proxy.password.len > 0 and proxy.password.len < 4096) {
                    // decode password
                    var password_buffer = std.mem.zeroes([4096]u8);
                    var password_stream = std.io.fixedBufferStream(&password_buffer);
                    const password_writer = password_stream.writer();
                    const PassWriter = @TypeOf(password_writer);
                    const password_len = PercentEncoding.decode(PassWriter, password_writer, proxy.password) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const password = password_buffer[0..password_len];

                    // Decode username
                    var username_buffer = std.mem.zeroes([4096]u8);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    const username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const username = username_buffer[0..username_len];

                    // concat user and password
                    const auth = std.fmt.allocPrint(allocator, "{s}:{s}", .{ username, password }) catch unreachable;
                    defer allocator.free(auth);
                    const size = std.base64.standard.Encoder.calcSize(auth.len);
                    var buf = this.allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    const encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], auth);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                } else {
                    //Decode username
                    var username_buffer = std.mem.zeroes([4096]u8);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    const username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const username = username_buffer[0..username_len];

                    // only use user
                    const size = std.base64.standard.Encoder.calcSize(username_len);
                    var buf = allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    const encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], username);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                }
            }
        }
        return this;
    }

    pub fn initSync(
        allocator: std.mem.Allocator,
        method: Method,
        url: URL,
        headers: Headers.Entry.List,
        headers_buf: string,
        response_buffer: *MutableString,
        request_body: []const u8,
        http_proxy: ?URL,
        hostname: ?[]u8,
        redirect_type: FetchRedirect,
    ) AsyncHTTP {
        return @This().init(
            allocator,
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            undefined,
            redirect_type,
            .{
                .http_proxy = http_proxy,
                .hostname = hostname,
            },
        );
    }

    fn reset(this: *AsyncHTTP) !void {
        const aborted = this.client.aborted;
        this.client = try HTTPClient.init(this.allocator, this.method, this.client.url, this.client.header_entries, this.client.header_buf, aborted);
        this.client.http_proxy = this.http_proxy;

        if (this.http_proxy) |proxy| {
            //TODO: need to understand how is possible to reuse Proxy with TSL, so disable keepalive if url is HTTPS
            this.client.flags.disable_keepalive = this.url.isHTTPS();
            // Username between 0 and 4096 chars
            if (proxy.username.len > 0 and proxy.username.len < 4096) {
                // Password between 0 and 4096 chars
                if (proxy.password.len > 0 and proxy.password.len < 4096) {
                    // decode password
                    var password_buffer = std.mem.zeroes([4096]u8);
                    var password_stream = std.io.fixedBufferStream(&password_buffer);
                    const password_writer = password_stream.writer();
                    const PassWriter = @TypeOf(password_writer);
                    const password_len = PercentEncoding.decode(PassWriter, password_writer, proxy.password) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const password = password_buffer[0..password_len];

                    // Decode username
                    var username_buffer = std.mem.zeroes([4096]u8);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    const username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };

                    const username = username_buffer[0..username_len];

                    // concat user and password
                    const auth = std.fmt.allocPrint(this.allocator, "{s}:{s}", .{ username, password }) catch unreachable;
                    defer this.allocator.free(auth);
                    const size = std.base64.standard.Encoder.calcSize(auth.len);
                    var buf = this.allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    const encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], auth);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                } else {
                    //Decode username
                    var username_buffer = std.mem.zeroes([4096]u8);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    const username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const username = username_buffer[0..username_len];

                    // only use user
                    const size = std.base64.standard.Encoder.calcSize(username_len);
                    var buf = this.allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    const encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], username);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                }
            }
        }
    }

    pub fn schedule(this: *AsyncHTTP, _: std.mem.Allocator, batch: *ThreadPool.Batch) void {
        this.state.store(.scheduled, .monotonic);
        batch.push(ThreadPool.Batch.from(&this.task));
    }

    fn sendSyncCallback(this: *SingleHTTPChannel, async_http: *AsyncHTTP, result: HTTPClientResult) void {
        async_http.real.?.* = async_http.*;
        async_http.real.?.response_buffer = async_http.response_buffer;
        this.channel.writeItem(result) catch unreachable;
    }

    pub fn sendSync(this: *AsyncHTTP) anyerror!picohttp.Response {
        HTTPThread.init(&.{});

        var ctx = try bun.default_allocator.create(SingleHTTPChannel);
        ctx.* = SingleHTTPChannel.init();
        this.result_callback = HTTPClientResult.Callback.New(
            *SingleHTTPChannel,
            sendSyncCallback,
        ).init(ctx);

        var batch = bun.ThreadPool.Batch{};
        this.schedule(bun.default_allocator, &batch);
        http_thread.schedule(batch);

        const result = ctx.channel.readItem() catch unreachable;
        if (result.fail) |err| {
            return err;
        }
        assert(result.metadata != null);
        return result.metadata.?.response;
    }

    pub fn onAsyncHTTPCallback(this: *AsyncHTTP, async_http: *AsyncHTTP, result: HTTPClientResult) void {
        assert(this.real != null);

        var callback = this.result_callback;
        this.elapsed = http_thread.timer.read() -| this.elapsed;

        // TODO: this condition seems wrong: if we started with a non-default value, we might
        // report a redirect even if none happened
        this.redirected = this.client.flags.redirected;
        if (result.isSuccess()) {
            this.err = null;
            if (result.metadata) |metadata| {
                this.response = metadata.response;
            }
            this.state.store(.success, .monotonic);
        } else {
            this.err = result.fail;
            this.response = null;
            this.state.store(State.fail, .monotonic);
        }

        if (comptime Environment.enable_logs) {
            if (socket_async_http_abort_tracker.count() > 0) {
                log("socket_async_http_abort_tracker count: {d}", .{socket_async_http_abort_tracker.count()});
            }
        }

        if (socket_async_http_abort_tracker.capacity() > 10_000 and socket_async_http_abort_tracker.count() < 100) {
            socket_async_http_abort_tracker.shrinkAndFree(socket_async_http_abort_tracker.count());
        }

        if (result.has_more) {
            callback.function(callback.ctx, async_http, result);
        } else {
            {
                this.client.deinit();
                var threadlocal_http: *ThreadlocalAsyncHTTP = @fieldParentPtr("async_http", async_http);
                defer threadlocal_http.deinit();
                log("onAsyncHTTPCallback: {any}", .{std.fmt.fmtDuration(this.elapsed)});
                callback.function(callback.ctx, async_http, result);
            }

            const active_requests = AsyncHTTP.active_requests_count.fetchSub(1, .monotonic);
            assert(active_requests > 0);
        }

        if (!http_thread.queued_tasks.isEmpty() and AsyncHTTP.active_requests_count.load(.monotonic) < AsyncHTTP.max_simultaneous_requests.load(.monotonic)) {
            http_thread.loop.loop.wakeup();
        }
    }

    pub fn startAsyncHTTP(task: *Task) void {
        var this: *AsyncHTTP = @fieldParentPtr("task", task);
        this.onStart();
    }

    pub fn onStart(this: *AsyncHTTP) void {
        _ = active_requests_count.fetchAdd(1, .monotonic);
        this.err = null;
        this.state.store(.sending, .monotonic);
        this.client.result_callback = HTTPClientResult.Callback.New(*AsyncHTTP, onAsyncHTTPCallback).init(
            this,
        );

        this.elapsed = http_thread.timer.read();
        if (this.response_buffer.list.capacity == 0) {
            this.response_buffer.allocator = default_allocator;
        }
        this.client.start(this.request_body, this.response_buffer);
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
            if (add_transfer_encoding) {
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

    if (this.proxy_tunnel) |tunnel| {
        log("close the tunnel in redirect", .{});
        this.proxy_tunnel = null;
        tunnel.detachAndDeref();
        if (!socket.isClosed()) {
            log("close socket in redirect", .{});
            NewHTTPContext(is_ssl).closeSocket(socket);
        }
    } else {
        // we need to clean the client reference before closing the socket because we are going to reuse the same ref in a another request
        if (this.isKeepAlivePossible()) {
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
}

const Task = ThreadPool.Task;

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
            log("send proxy body", .{});
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
                        this.setTimeout(socket, 5);

                        // to simplify things here the buffer contains the raw data we just need to flush to the socket it
                        if (stream.buffer.isNotEmpty()) {
                            const to_send = stream.buffer.slice();
                            const amount = proxy.writeData(to_send) catch return; // just wait and retry when onWritable! if closed internally will call proxy.onClose
                            this.state.request_sent_len += amount;
                            stream.buffer.cursor += @truncate(amount);
                            if (amount < to_send.len) {
                                stream.has_backpressure = true;
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
            log("send proxy headers", .{});
            if (this.proxy_tunnel) |proxy| {
                this.setTimeout(socket, 5);
                var stack_buffer = std.heap.stackFallback(1024 * 16, bun.default_allocator);
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
    if (!socket.isClosed()) {
        NewHTTPContext(is_ssl).terminateSocket(socket);
    }
    this.fail(err);
}

fn startProxyHandshake(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket, start_payload: []const u8) void {
    log("startProxyHandshake", .{});
    // if we have options we pass them (ca, reject_unauthorized, etc) otherwise use the default
    const ssl_options = if (this.tls_props != null) this.tls_props.?.* else JSC.API.ServerConfig.SSLConfig.zero;
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
    log("handleOnDataHeaders", .{});
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
        log("handleShortRead", .{});
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
    if (response.status_code >= 100 and response.status_code < 200) {
        log("information headers", .{});
        // we still can have the 200 OK in the same buffer sometimes
        if (body_buf.len > 0) {
            log("information headers with body", .{});
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
        this.startProxyHandshake(is_ssl, socket, body_buf);
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

    if (this.proxy_tunnel) |proxy| {
        // if we have a tunnel we dont care about the other stages, we will just tunnel the data
        this.setTimeout(socket, 5);
        proxy.receiveData(incoming_data);
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
            if (this.proxy_tunnel) |tunnel| {
                log("close the tunnel", .{});
                this.proxy_tunnel = null;
                tunnel.shutdown();
                tunnel.detachAndDeref();
                if (!socket.isClosed()) {
                    log("close socket", .{});
                    NewHTTPContext(is_ssl).closeSocket(socket);
                }
            } else {
                if (this.isKeepAlivePossible() and !socket.isClosedOrHasError()) {
                    log("release socket", .{});
                    ctx.releaseSocket(
                        socket,
                        this.flags.did_have_handshaking_error and !this.flags.reject_unauthorized,
                        this.connected_url.hostname,
                        this.connected_url.getPortAuto(),
                    );
                } else if (!socket.isClosed()) {
                    log("close socket", .{});
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

    pub fn abortReason(this: *const HTTPClientResult) ?JSC.CommonAbortReason {
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

                            const normalized_url = JSC.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
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

                            const normalized_url = JSC.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
                            const normalized_url_str = try normalized_url.toOwnedSlice(bun.default_allocator);

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

    if (this.method.hasBody() and (content_length == null or content_length.? > 0 or !this.state.flags.allow_keepalive or this.state.transfer_encoding == .chunked or is_server_sent_events)) {
        return ShouldContinue.continue_streaming;
    } else {
        return ShouldContinue.finished;
    }
}

const assert = bun.assert;

// Exists for heap stats reasons.
const ThreadlocalAsyncHTTP = struct {
    pub const new = bun.TrivialNew(@This());
    pub const deinit = bun.TrivialDeinit(@This());

    async_http: AsyncHTTP,
};

pub const Headers = struct {
    pub const Entry = struct {
        name: Api.StringPointer,
        value: Api.StringPointer,

        pub const List = bun.MultiArrayList(Entry);
    };

    entries: Entry.List = .{},
    buf: std.ArrayListUnmanaged(u8) = .{},
    allocator: std.mem.Allocator,

    pub fn memoryCost(this: *const Headers) usize {
        return this.buf.items.len + this.entries.memoryCost();
    }

    pub fn clone(this: *Headers) !Headers {
        return Headers{
            .entries = try this.entries.clone(this.allocator),
            .buf = try this.buf.clone(this.allocator),
            .allocator = this.allocator,
        };
    }

    pub fn get(this: *const Headers, name: []const u8) ?[]const u8 {
        const entries = this.entries.slice();
        const names = entries.items(.name);
        const values = entries.items(.value);
        for (names, 0..) |name_ptr, i| {
            if (bun.strings.eqlCaseInsensitiveASCII(this.asStr(name_ptr), name, true)) {
                return this.asStr(values[i]);
            }
        }

        return null;
    }

    pub fn append(this: *Headers, name: []const u8, value: []const u8) !void {
        var offset: u32 = @truncate(this.buf.items.len);
        try this.buf.ensureUnusedCapacity(this.allocator, name.len + value.len);
        const name_ptr = Api.StringPointer{
            .offset = offset,
            .length = @truncate(name.len),
        };
        this.buf.appendSliceAssumeCapacity(name);
        offset = @truncate(this.buf.items.len);
        this.buf.appendSliceAssumeCapacity(value);

        const value_ptr = Api.StringPointer{
            .offset = offset,
            .length = @truncate(value.len),
        };
        try this.entries.append(this.allocator, .{
            .name = name_ptr,
            .value = value_ptr,
        });
    }

    pub fn deinit(this: *Headers) void {
        this.entries.deinit(this.allocator);
        this.buf.clearAndFree(this.allocator);
    }
    pub fn getContentType(this: *const Headers) ?[]const u8 {
        if (this.entries.len == 0 or this.buf.items.len == 0) {
            return null;
        }
        const header_entries = this.entries.slice();
        const header_names = header_entries.items(.name);
        const header_values = header_entries.items(.value);

        for (header_names, 0..header_names.len) |name, i| {
            if (bun.strings.eqlCaseInsensitiveASCII(this.asStr(name), "content-type", true)) {
                return this.asStr(header_values[i]);
            }
        }
        return null;
    }
    pub fn asStr(this: *const Headers, ptr: Api.StringPointer) []const u8 {
        return if (ptr.offset + ptr.length <= this.buf.items.len)
            this.buf.items[ptr.offset..][0..ptr.length]
        else
            "";
    }

    pub const Options = struct {
        body: ?*const Blob.Any = null,
    };

    pub fn fromPicoHttpHeaders(headers: []const picohttp.Header, allocator: std.mem.Allocator) !Headers {
        const header_count = headers.len;
        var result = Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
        };

        var buf_len: usize = 0;
        for (headers) |header| {
            buf_len += header.name.len + header.value.len;
        }
        result.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
        result.entries.len = headers.len;
        result.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
        result.buf.items.len = buf_len;
        var offset: u32 = 0;
        for (headers, 0..headers.len) |header, i| {
            const name_offset = offset;
            bun.copy(u8, result.buf.items[offset..][0..header.name.len], header.name);
            offset += @truncate(header.name.len);
            const value_offset = offset;
            bun.copy(u8, result.buf.items[offset..][0..header.value.len], header.value);
            offset += @truncate(header.value.len);

            result.entries.set(i, .{
                .name = .{
                    .offset = name_offset,
                    .length = @truncate(header.name.len),
                },
                .value = .{
                    .offset = value_offset,
                    .length = @truncate(header.value.len),
                },
            });
        }
        return result;
    }

    pub fn from(fetch_headers_ref: ?*FetchHeaders, allocator: std.mem.Allocator, options: Options) !Headers {
        var header_count: u32 = 0;
        var buf_len: u32 = 0;
        if (fetch_headers_ref) |headers_ref|
            headers_ref.count(&header_count, &buf_len);
        var headers = Headers{
            .entries = .{},
            .buf = .{},
            .allocator = allocator,
        };
        const buf_len_before_content_type = buf_len;
        const needs_content_type = brk: {
            if (options.body) |body| {
                if (body.hasContentTypeFromUser() and (fetch_headers_ref == null or !fetch_headers_ref.?.fastHas(.ContentType))) {
                    header_count += 1;
                    buf_len += @as(u32, @truncate(body.contentType().len + "Content-Type".len));
                    break :brk true;
                }
            }
            break :brk false;
        };
        headers.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
        headers.entries.len = header_count;
        headers.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
        headers.buf.items.len = buf_len;
        var sliced = headers.entries.slice();
        var names = sliced.items(.name);
        var values = sliced.items(.value);
        if (fetch_headers_ref) |headers_ref|
            headers_ref.copyTo(names.ptr, values.ptr, headers.buf.items.ptr);

        // TODO: maybe we should send Content-Type header first instead of last?
        if (needs_content_type) {
            bun.copy(u8, headers.buf.items[buf_len_before_content_type..], "Content-Type");
            names[header_count - 1] = .{
                .offset = buf_len_before_content_type,
                .length = "Content-Type".len,
            };

            bun.copy(u8, headers.buf.items[buf_len_before_content_type + "Content-Type".len ..], options.body.?.contentType());
            values[header_count - 1] = .{
                .offset = buf_len_before_content_type + @as(u32, "Content-Type".len),
                .length = @as(u32, @truncate(options.body.?.contentType().len)),
            };
        }

        return headers;
    }
};
