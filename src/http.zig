const bun = @import("root").bun;
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
const C = bun.C;
const Loc = bun.logger.Loc;
const Log = bun.logger.Log;
const DotEnv = @import("./env_loader.zig");
const std = @import("std");
const URL = @import("./url.zig").URL;
const PercentEncoding = @import("./url.zig").PercentEncoding;
pub const Method = @import("./http/method.zig").Method;
const Api = @import("./api/schema.zig").Api;
const Lock = @import("./lock.zig").Lock;
const HTTPClient = @This();
const Zlib = @import("./zlib.zig");
const Brotli = bun.brotli;
const StringBuilder = @import("./string_builder.zig");
const ThreadPool = bun.ThreadPool;
const ObjectPool = @import("./pool.zig").ObjectPool;
const SOCK = os.SOCK;
const Arena = @import("./mimalloc_arena.zig").Arena;
const ZlibPool = @import("./http/zlib.zig");
const BoringSSL = bun.BoringSSL;

const URLBufferPool = ObjectPool([8192]u8, null, false, 10);
const uws = bun.uws;
pub const MimeType = @import("./http/mime_type.zig");
pub const URLPath = @import("./http/url_path.zig");
// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
var default_arena: Arena = undefined;
pub var http_thread: HTTPThread = undefined;
const HiveArray = @import("./hive_array.zig").HiveArray;
const Batch = bun.ThreadPool.Batch;
const TaggedPointerUnion = @import("./tagged_pointer.zig").TaggedPointerUnion;
const DeadSocket = opaque {};
var dead_socket = @as(*DeadSocket, @ptrFromInt(1));
//TODO: this needs to be freed when Worker Threads are implemented
var socket_async_http_abort_tracker = std.AutoArrayHashMap(u32, *uws.Socket).init(bun.default_allocator);
var async_http_id: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);
const MAX_REDIRECT_URL_LENGTH = 128 * 1024;
const print_every = 0;
var print_every_i: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
var shared_request_headers_buf: [256]picohttp.Header = undefined;

// this doesn't need to be stack memory because it is immediately cloned after use
var shared_response_headers_buf: [256]picohttp.Header = undefined;

const end_of_chunked_http1_1_encoding_response_body = "0\r\n\r\n";

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
        return ptr.load(.Monotonic);
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

    pub fn len(this: *const HTTPRequestBody) usize {
        return switch (this.*) {
            .bytes => this.bytes.len,
            .sendfile => this.sendfile.content_size,
        };
    }
};

pub const Sendfile = struct {
    fd: bun.FileDescriptor,
    remain: usize = 0,
    offset: usize = 0,
    content_size: usize = 0,

    pub fn isEligible(url: bun.URL) bool {
        return url.isHTTP() and url.href.len > 0 and FeatureFlags.streaming_file_uploads_for_http_client;
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

            const errcode = std.os.linux.getErrno(val);

            this.remain -|= @as(u64, @intCast(this.offset -| begin));

            if (errcode != .SUCCESS or this.remain == 0 or val == 0) {
                if (errcode == .SUCCESS) {
                    return .{ .done = {} };
                }

                return .{ .err = bun.errnoToZigErr(errcode) };
            }
        } else if (Environment.isWindows) {
            const win = std.os.windows;
            const uv = bun.windows.libuv;
            const wsocket = bun.socketcast(socket.fd());
            const file_handle = uv.uv_get_osfhandle(bun.uvfdcast(this.fd));
            if (win.ws2_32.TransmitFile(wsocket, file_handle, 0, 0, null, null, 0) == 1) {
                return .{ .done = {} };
            }
            this.offset += this.remain;
            this.remain = 0;
            const errorno = win.ws2_32.WSAGetLastError();
            return .{ .err = bun.errnoToZigErr(errorno) };
        } else if (Environment.isPosix) {
            var sbytes: std.os.off_t = adjusted_count;
            const signed_offset = @as(i64, @bitCast(@as(u64, this.offset)));
            const errcode = std.c.getErrno(std.c.sendfile(
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

const ProxySSLData = struct {
    buffer: std.ArrayList(u8),
    partial: bool,
    temporary_slice: ?[]const u8,
    pub fn init() !ProxySSLData {
        const buffer = try std.ArrayList(u8).initCapacity(bun.default_allocator, 16 * 1024);

        return ProxySSLData{ .buffer = buffer, .partial = false, .temporary_slice = null };
    }

    pub fn slice(this: *@This()) []const u8 {
        if (this.temporary_slice) |data| {
            return data;
        }
        const data = this.buffer.toOwnedSliceSentinel(0) catch unreachable;
        this.temporary_slice = data;
        return data;
    }

    pub fn deinit(this: @This()) void {
        this.buffer.deinit();
        if (this.temporary_slice) |data| {
            bun.default_allocator.free(data);
        }
    }
};

const ProxyTunnel = struct {
    ssl_ctx: *BoringSSL.SSL_CTX,
    ssl: *BoringSSL.SSL,
    out_bio: *BoringSSL.BIO,
    in_bio: *BoringSSL.BIO,
    partial_data: ?ProxySSLData,
    read_buffer: []u8,

    pub fn init(comptime is_ssl: bool, client: *HTTPClient, socket: NewHTTPContext(is_ssl).HTTPSocket) ProxyTunnel {
        BoringSSL.load();
        const context = BoringSSL.SSL_CTX.init();

        if (context) |ssl_context| {
            const ssl_ctx = ssl_context;
            var ssl = BoringSSL.SSL.init(ssl_context);
            ssl.setIsClient(true);
            var out_bio: *BoringSSL.BIO = undefined;
            if (comptime is_ssl) {
                //TLS -> TLS
                const proxy_ssl: *BoringSSL.SSL = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                //create new SSL BIO
                out_bio = BoringSSL.BIO_new(BoringSSL.BIO_f_ssl()) orelse unreachable;
                //chain SSL bio with proxy BIO
                const proxy_bio = BoringSSL.SSL_get_wbio(proxy_ssl);
                _ = BoringSSL.BIO_push(out_bio, proxy_bio);
            } else {
                // socket output bio for non-TLS -> TLS
                const fd = @as(c_int, @intCast(@intFromPtr(socket.getNativeHandle())));
                out_bio = BoringSSL.BIO_new_fd(fd, BoringSSL.BIO_NOCLOSE);
            }

            // in memory bio to control input flow from onData handler
            const in_bio = BoringSSL.BIO.init() catch {
                unreachable;
            };
            _ = BoringSSL.BIO_set_mem_eof_return(in_bio, -1);
            ssl.setBIO(in_bio, out_bio);

            const hostname = bun.default_allocator.dupeZ(u8, client.hostname orelse client.url.hostname) catch unreachable;
            defer bun.default_allocator.free(hostname);

            ssl.configureHTTPClient(hostname);
            BoringSSL.SSL_CTX_set_verify(ssl_ctx, BoringSSL.SSL_VERIFY_NONE, null);
            BoringSSL.SSL_set_verify(ssl, BoringSSL.SSL_VERIFY_NONE, null);
            return ProxyTunnel{ .ssl = ssl, .ssl_ctx = ssl_ctx, .in_bio = in_bio, .out_bio = out_bio, .read_buffer = bun.default_allocator.alloc(u8, 16 * 1024) catch unreachable, .partial_data = null };
        }
        unreachable;
    }

    pub fn getSSLData(this: *@This(), incoming_data: ?[]const u8) !ProxySSLData {
        if (incoming_data) |data| {
            _ = this.in_bio.write(data) catch {
                return error.OutOfMemory;
            };
        }

        var data: ProxySSLData = undefined;
        if (this.partial_data) |partial| {
            data = partial;
            data.partial = false;
        } else {
            data = try ProxySSLData.init();
        }

        var writer = data.buffer.writer();
        while (true) {
            const read_size = this.ssl.read(this.read_buffer) catch |err| {
                // handshake needed
                if (err == error.WantWrite) {
                    //needs handshake
                    data.partial = true;
                    this.partial_data = data;
                    return data;
                }

                break;
            };
            // no more data
            if (read_size == 0) {
                break;
            }
            _ = writer.write(this.read_buffer[0..read_size]) catch 0;
        }
        return data;
    }
    pub fn deinit(this: @This()) void {
        this.ssl.deinit();
        this.ssl_ctx.deinit();
        if (this.partial_data) |ssl_data| {
            ssl_data.deinit();
        }
        bun.default_allocator.free(this.read_buffer);
        // no need to call BIO_free because of ssl.setBIO
    }
};

pub const HTTPCertError = struct {
    error_no: i32 = 0,
    code: [:0]const u8 = "",
    reason: [:0]const u8 = "",
};

fn NewHTTPContext(comptime ssl: bool) type {
    return struct {
        const pool_size = 64;
        const PooledSocket = struct {
            http_socket: HTTPSocket,
            hostname_buf: [MAX_KEEPALIVE_HOSTNAME]u8 = undefined,
            hostname_len: u8 = 0,
            port: u16 = 0,
        };

        pending_sockets: HiveArray(PooledSocket, pool_size) = HiveArray(PooledSocket, pool_size).init(),
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
            DeadSocket,
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

        pub fn init(this: *@This()) !void {
            if (comptime ssl) {
                const opts: uws.us_bun_socket_context_options_t = .{
                    // we request the cert so we load root certs and can verify it
                    .request_cert = 1,
                    // we manually abort the connection if the hostname doesn't match
                    .reject_unauthorized = 0,
                };
                this.us_socket_context = uws.us_create_bun_socket_context(ssl_int, http_thread.loop, @sizeOf(usize), opts).?;

                this.sslCtx().setup();
            } else {
                const opts: uws.us_socket_context_options_t = .{};
                this.us_socket_context = uws.us_create_socket_context(ssl_int, http_thread.loop, @sizeOf(usize), opts).?;
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
        pub fn releaseSocket(this: *@This(), socket: HTTPSocket, hostname: []const u8, port: u16) void {
            log("releaseSocket(0x{})", .{bun.fmt.hexIntUpper(@intFromPtr(socket.socket))});

            if (comptime Environment.allow_assert) {
                std.debug.assert(!socket.isClosed());
                std.debug.assert(!socket.isShutdown());
                std.debug.assert(socket.isEstablished());
            }
            std.debug.assert(hostname.len > 0);
            std.debug.assert(port > 0);

            if (hostname.len <= MAX_KEEPALIVE_HOSTNAME and !socket.isClosedOrHasError() and socket.isEstablished()) {
                if (this.pending_sockets.get()) |pending| {
                    socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(pending).ptr());
                    socket.flush();
                    socket.timeout(0);
                    socket.setTimeoutMinutes(5);

                    pending.http_socket = socket;
                    @memcpy(pending.hostname_buf[0..hostname.len], hostname);
                    pending.hostname_len = @as(u8, @truncate(hostname.len));
                    pending.port = port;

                    log("Keep-Alive release {s}:{d} (0x{})", .{ hostname, port, @intFromPtr(socket.socket) });
                    return;
                }
            }

            socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
            socket.close(0, null);
        }

        pub const Handler = struct {
            pub fn onOpen(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                const active = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                if (active.get(HTTPClient)) |client| {
                    return client.onOpen(comptime ssl, socket);
                }

                if (active.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));
                }

                socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
                socket.close(0, null);
                if (comptime Environment.allow_assert) {
                    std.debug.assert(false);
                }
            }
            pub fn onHandshake(
                ptr: *anyopaque,
                socket: HTTPSocket,
                success: i32,
                ssl_error: uws.us_bun_verify_error_t,
            ) void {
                const authorized = if (success == 1) true else false;

                const handshake_error = HTTPCertError{
                    .error_no = ssl_error.error_no,
                    .code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code) :0],
                    .reason = if (ssl_error.code == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason) :0],
                };
                log("onHandshake(0x{}) authorized: {} error: {s}", .{ bun.fmt.hexIntUpper(@intFromPtr(socket.socket)), authorized, handshake_error.code });

                const active = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                if (active.get(HTTPClient)) |client| {
                    if (handshake_error.error_no != 0 and (client.reject_unauthorized or !authorized)) {
                        client.closeAndFail(BoringSSL.getCertErrorFromNo(handshake_error.error_no), comptime ssl, socket);
                        return;
                    }
                    // no handshake_error at this point
                    if (authorized) {
                        // if checkServerIdentity returns false, we dont call open this means that the connection was rejected
                        if (!client.checkServerIdentity(comptime ssl, socket, handshake_error)) {
                            return;
                        }
                        return client.firstCall(comptime ssl, socket);
                    } else {
                        // if authorized it self is false, this means that the connection was rejected
                        return client.onConnectError(
                            comptime ssl,
                            socket,
                        );
                    }
                }

                if (active.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));
                }

                // we can reach here if we are aborted
                if (!socket.isClosed()) {
                    socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
                    socket.close(0, null);
                }
            }
            pub fn onClose(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
                _: ?*anyopaque,
            ) void {
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());

                if (tagged.get(HTTPClient)) |client| {
                    return client.onClose(comptime ssl, socket);
                }

                if (tagged.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));
                }

                return;
            }
            pub fn onData(
                ptr: *anyopaque,
                socket: HTTPSocket,
                buf: []const u8,
            ) void {
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onData(
                        comptime ssl,
                        buf,
                        if (comptime ssl) &http_thread.https_context else &http_thread.http_context,
                        socket,
                    );
                } else {
                    // trailing zero is fine to ignore
                    if (strings.eqlComptime(buf, end_of_chunked_http1_1_encoding_response_body)) {
                        return;
                    }

                    log("Unexpected data on socket", .{});
                }
            }
            pub fn onWritable(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onWritable(
                        false,
                        comptime ssl,
                        socket,
                    );
                }
            }
            pub fn onLongTimeout(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                socket.ext(**anyopaque).?.* = bun.cast(
                    **anyopaque,
                    ActiveSocket.init(&dead_socket).ptr(),
                );

                if (tagged.get(HTTPClient)) |client| {
                    return client.onTimeout(
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));
                    return;
                }
            }
            pub fn onConnectError(
                ptr: *anyopaque,
                socket: HTTPSocket,
                _: c_int,
            ) void {
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                if (tagged.get(HTTPClient)) |client| {
                    return client.onConnectError(
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));
                    return;
                }

                unreachable;
            }
            pub fn onEnd(
                ptr: *anyopaque,
                socket: HTTPSocket,
            ) void {
                var tagged = ActiveSocket.from(@as(**anyopaque, @ptrCast(@alignCast(ptr))).*);
                {
                    @setRuntimeSafety(false);
                    socket.ext(**anyopaque).?.* = @as(**anyopaque, @ptrCast(@alignCast(ActiveSocket.init(dead_socket).ptrUnsafe())));
                }

                if (tagged.get(HTTPClient)) |client| {
                    return client.onEnd(
                        comptime ssl,
                        socket,
                    );
                } else if (tagged.get(PooledSocket)) |pooled| {
                    std.debug.assert(context().pending_sockets.put(pooled));

                    return;
                }

                unreachable;
            }
        };

        fn existingSocket(this: *@This(), hostname: []const u8, port: u16) ?HTTPSocket {
            if (hostname.len > MAX_KEEPALIVE_HOSTNAME)
                return null;

            var iter = this.pending_sockets.available.iterator(.{ .kind = .unset });

            while (iter.next()) |pending_socket_index| {
                var socket = this.pending_sockets.at(@as(u16, @intCast(pending_socket_index)));
                if (socket.port != port) {
                    continue;
                }

                if (strings.eqlLong(socket.hostname_buf[0..socket.hostname_len], hostname, true)) {
                    const http_socket = socket.http_socket;
                    std.debug.assert(context().pending_sockets.put(socket));

                    if (http_socket.isClosed()) {
                        http_socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
                        continue;
                    }

                    if (http_socket.isShutdown() or http_socket.getError() != 0) {
                        http_socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(&dead_socket).ptr());
                        http_socket.close(0, null);
                        continue;
                    }

                    log("+ Keep-Alive reuse {s}:{d}", .{ hostname, port });
                    return http_socket;
                }
            }

            return null;
        }

        pub fn connect(this: *@This(), client: *HTTPClient, hostname_: []const u8, port: u16) !HTTPSocket {
            const hostname = if (FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(hostname_, "localhost"))
                "127.0.0.1"
            else
                hostname_;

            client.connected_url = if (client.http_proxy) |proxy| proxy else client.url;
            client.connected_url.hostname = hostname;

            if (client.isKeepAlivePossible()) {
                if (this.existingSocket(hostname, port)) |sock| {
                    sock.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                    client.allow_retry = true;
                    client.onOpen(comptime ssl, sock);
                    if (comptime ssl) {
                        client.firstCall(comptime ssl, sock);
                    }
                    return sock;
                }
            }

            if (HTTPSocket.connectAnon(
                hostname,
                port,
                this.us_socket_context,
                undefined,
            )) |socket| {
                client.allow_retry = false;
                socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                return socket;
            }

            return error.FailedToOpenSocket;
        }
    };
}

const UnboundedQueue = @import("./bun.js/unbounded_queue.zig").UnboundedQueue;
const Queue = UnboundedQueue(AsyncHTTP, .next);
const ShutdownQueue = UnboundedQueue(AsyncHTTP, .next);

pub const HTTPThread = struct {
    var http_thread_loaded: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);

    loop: *uws.Loop,
    http_context: NewHTTPContext(false),
    https_context: NewHTTPContext(true),

    queued_tasks: Queue = Queue{},
    queued_shutdowns: ShutdownQueue = ShutdownQueue{},
    has_awoken: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    timer: std.time.Timer,
    const threadlog = Output.scoped(.HTTPThread, true);

    const FakeStruct = struct {
        trash: i64 = 0,
    };

    pub fn init() !void {
        if (http_thread_loaded.swap(true, .SeqCst)) {
            return;
        }

        http_thread = .{
            .loop = undefined,
            .http_context = .{
                .us_socket_context = undefined,
            },
            .https_context = .{
                .us_socket_context = undefined,
            },
            .timer = std.time.Timer.start() catch unreachable,
        };

        const thread = try std.Thread.spawn(
            .{
                .stack_size = bun.default_thread_stack_size,
            },
            comptime onStart,
            .{
                FakeStruct{},
            },
        );
        thread.detach();
    }

    pub fn onStart(_: FakeStruct) void {
        Output.Source.configureNamedThread("HTTP Client");
        default_arena = Arena.init() catch unreachable;
        default_allocator = default_arena.allocator();
        const loop = bun.uws.Loop.create(struct {
            pub fn wakeup(_: *uws.Loop) callconv(.C) void {
                http_thread.drainEvents();
            }
            pub fn pre(_: *uws.Loop) callconv(.C) void {}
            pub fn post(_: *uws.Loop) callconv(.C) void {}
        });

        http_thread.loop = loop;
        http_thread.http_context.init() catch @panic("Failed to init http context");
        http_thread.https_context.init() catch @panic("Failed to init https context");
        http_thread.has_awoken.store(true, .Monotonic);
        http_thread.processEvents();
    }

    pub fn connect(this: *@This(), client: *HTTPClient, comptime is_ssl: bool) !NewHTTPContext(is_ssl).HTTPSocket {
        if (client.http_proxy) |url| {
            return try this.context(is_ssl).connect(client, url.hostname, url.getPortAuto());
        }
        return try this.context(is_ssl).connect(client, client.url.hostname, client.url.getPortAuto());
    }

    pub fn context(this: *@This(), comptime is_ssl: bool) *NewHTTPContext(is_ssl) {
        return if (is_ssl) &this.https_context else &this.http_context;
    }

    fn drainEvents(this: *@This()) void {
        while (this.queued_shutdowns.pop()) |http| {
            if (socket_async_http_abort_tracker.fetchSwapRemove(http.async_http_id)) |socket_ptr| {
                if (http.client.isHTTPS()) {
                    const socket = uws.SocketTLS.from(socket_ptr.value);
                    socket.shutdown();
                } else {
                    const socket = uws.SocketTCP.from(socket_ptr.value);
                    socket.shutdown();
                }
            }
        }

        var count: usize = 0;
        var active = AsyncHTTP.active_requests_count.load(.Monotonic);
        const max = AsyncHTTP.max_simultaneous_requests.load(.Monotonic);
        if (active >= max) return;
        defer {
            if (comptime Environment.allow_assert) {
                if (count > 0)
                    log("Processed {d} tasks\n", .{count});
            }
        }

        while (this.queued_tasks.pop()) |http| {
            var cloned = default_allocator.create(AsyncHTTP) catch unreachable;
            cloned.* = http.*;
            cloned.real = http;
            cloned.onStart();
            if (comptime Environment.allow_assert) {
                count += 1;
            }

            active += 1;
            if (active >= max) break;
        }
    }

    fn processEvents(this: *@This()) noreturn {
        if (comptime Environment.isPosix) {
            this.loop.num_polls = @max(2, this.loop.num_polls);
        } else if (comptime Environment.isWindows) {
            this.loop.inc();
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
            this.loop.run();
            if (comptime Environment.isDebug) {
                const end = std.time.nanoTimestamp();
                threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start_time)))});
                Output.flush();
            }
        }
    }

    pub fn scheduleShutdown(this: *@This(), http: *AsyncHTTP) void {
        this.queued_shutdowns.push(http);
        if (this.has_awoken.load(.Monotonic))
            this.loop.wakeup();
    }

    pub fn wakeup(this: *@This()) void {
        if (this.has_awoken.load(.Monotonic))
            this.loop.wakeup();
    }

    pub fn schedule(this: *@This(), batch: Batch) void {
        if (batch.len == 0)
            return;

        {
            var batch_ = batch;
            while (batch_.pop()) |task| {
                const http: *AsyncHTTP = @fieldParentPtr(AsyncHTTP, "task", task);
                this.queued_tasks.push(http);
            }
        }

        if (this.has_awoken.load(.Monotonic))
            this.loop.wakeup();
    }
};

const log = Output.scoped(.fetch, false);

var temp_hostname: [8192]u8 = undefined;

pub fn checkServerIdentity(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
    certError: HTTPCertError,
) bool {
    if (comptime is_ssl == false) {
        @panic("checkServerIdentity called on non-ssl socket");
    }
    if (client.reject_unauthorized) {
        const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
        if (BoringSSL.SSL_get_peer_cert_chain(ssl_ptr)) |cert_chain| {
            if (BoringSSL.sk_X509_value(cert_chain, 0)) |x509| {

                // check if we need to report the error (probably to `checkServerIdentity` was informed from JS side)
                // this is the slow path
                if (client.signals.get(.cert_errors)) {
                    // clone the relevant data
                    const cert_size = BoringSSL.i2d_X509(x509, null);
                    const cert = bun.default_allocator.alloc(u8, @intCast(cert_size)) catch @panic("OOM");
                    var cert_ptr = cert.ptr;
                    const result_size = BoringSSL.i2d_X509(x509, &cert_ptr);
                    std.debug.assert(result_size == cert_size);

                    var hostname = client.hostname orelse client.url.hostname;
                    if (client.http_proxy) |proxy| {
                        hostname = proxy.hostname;
                    }

                    client.state.certificate_info = .{
                        .cert = cert,
                        .hostname = bun.default_allocator.dupe(u8, hostname) catch @panic("OOM"),
                        .cert_error = .{
                            .error_no = certError.error_no,
                            .code = bun.default_allocator.dupeZ(u8, certError.code) catch @panic("OOM"),
                            .reason = bun.default_allocator.dupeZ(u8, certError.reason) catch @panic("OOM"),
                        },
                    };

                    // we inform the user that the cert is invalid
                    client.progressUpdate(true, &http_thread.https_context, socket);
                    // continue until we are aborted or not
                    return true;
                } else {
                    // we check with native code if the cert is valid
                    // fast path

                    var hostname = client.hostname orelse client.url.hostname;
                    if (client.http_proxy) |proxy| {
                        hostname = proxy.hostname;
                    }

                    if (BoringSSL.checkX509ServerIdentity(x509, hostname)) {
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

pub fn onOpen(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    if (comptime Environment.allow_assert) {
        if (client.http_proxy) |proxy| {
            std.debug.assert(is_ssl == proxy.isHTTPS());
        } else {
            std.debug.assert(is_ssl == client.url.isHTTPS());
        }
    }
    if (client.signals.aborted != null) {
        socket_async_http_abort_tracker.put(client.async_http_id, socket.socket) catch unreachable;
    }
    log("Connected {s} \n", .{client.url.href});

    if (client.signals.get(.aborted)) {
        client.closeAndAbort(comptime is_ssl, socket);
        return;
    }

    if (comptime is_ssl) {
        var ssl_ptr: *BoringSSL.SSL = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
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

    const in_progress = client.state.stage != .done and client.state.stage != .fail;

    if (in_progress) {
        // if the peer closed after a full chunk, treat this
        // as if the transfer had complete, browsers appear to ignore
        // a missing 0\r\n chunk
        if (client.state.isChunkedEncoding()) {
            if (picohttp.phr_decode_chunked_is_in_data(&client.state.chunked_decoder) == 0) {
                const buf = client.state.getBodyBuffer();
                if (buf.list.items.len > 0) {
                    client.state.received_last_chunk = true;
                    client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
                    return;
                }
            }
        } else if (client.state.content_length == null and client.state.response_stage == .body) {
            // no content length informed so we are done here
            client.state.received_last_chunk = true;
            client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
            return;
        }
    }

    if (client.allow_retry) {
        client.allow_retry = false;
        client.start(client.state.original_request_body, client.state.body_out_str.?);
        return;
    }

    if (in_progress) {
        client.closeAndFail(error.ConnectionClosed, is_ssl, socket);
    }
}
pub fn onTimeout(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    _ = socket;
    log("Timeout  {s}\n", .{client.url.href});

    if (client.state.stage != .done and client.state.stage != .fail) {
        client.fail(error.Timeout);
    }
}
pub fn onConnectError(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    _ = socket;
    log("onConnectError  {s}\n", .{client.url.href});

    if (client.state.stage != .done and client.state.stage != .fail)
        client.fail(error.ConnectionRefused);
}
pub fn onEnd(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    log("onEnd  {s}\n", .{client.url.href});
    const in_progress = client.state.stage != .done and client.state.stage != .fail;
    if (in_progress) {
        // if the peer closed after a full chunk, treat this
        // as if the transfer had complete, browsers appear to ignore
        // a missing 0\r\n chunk
        if (client.state.isChunkedEncoding()) {
            if (picohttp.phr_decode_chunked_is_in_data(&client.state.chunked_decoder) == 0) {
                const buf = client.state.getBodyBuffer();
                if (buf.list.items.len > 0) {
                    client.state.received_last_chunk = true;
                    client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
                    return;
                }
            }
        } else if (client.state.content_length == null and client.state.response_stage == .body) {
            // no content length informed so we are done here
            client.state.received_last_chunk = true;
            client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
            return;
        }
    }
    client.fail(error.ConnectionClosed);
}

pub inline fn getAllocator() std.mem.Allocator {
    return default_allocator;
}

pub inline fn cleanup(force: bool) void {
    default_arena.gc(force);
}

pub const Headers = @import("./http/headers.zig");

pub const SOCKET_FLAGS: u32 = if (Environment.isLinux)
    SOCK.CLOEXEC | os.MSG.NOSIGNAL
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
    proxy_decoded_headers,
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
                        .brotli = try Brotli.BrotliReaderArrayList.initWithOptions(
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
                std.debug.assert(reader.zlib.avail_in == 0);
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
                reader.total_in = @as(u32, @truncate(buffer.len));

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

    allow_keepalive: bool = true,
    received_last_chunk: bool = false,
    did_set_content_encoding: bool = false,
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
    fail: anyerror = error.NoError,
    request_stage: HTTPStage = .pending,
    response_stage: HTTPStage = .pending,
    certificate_info: ?CertificateInfo = null,

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

        this.* = .{
            .body_out_str = body_msg,
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .original_request_body = .{ .bytes = "" },
            .request_body = "",
            .certificate_info = null,
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
            return this.received_last_chunk;
        }

        if (this.content_length) |content_length| {
            return this.total_body_received >= content_length;
        }

        // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        return this.received_last_chunk;
    }

    fn decompressBytes(this: *InternalState, buffer: []const u8, body_out_str: *MutableString) !void {
        log("Decompressing {d} bytes\n", .{buffer.len});

        defer this.compressed_body.reset();
        var gzip_timer: std.time.Timer = undefined;

        if (extremely_verbose)
            gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

        try this.decompressor.updateBuffers(this.encoding, buffer, body_out_str);
        this.decompressor.readAll(this.isDone()) catch |err| {
            if (this.isDone() or error.ShortRead != err) {
                Output.prettyErrorln("<r><red>Decompression error: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                Output.flush();
                return err;
            }
        };

        if (extremely_verbose)
            this.gzip_elapsed = gzip_timer.read();
    }

    fn decompress(this: *InternalState, buffer: MutableString, body_out_str: *MutableString) !void {
        try this.decompressBytes(buffer.list.items, body_out_str);
    }

    pub fn processBodyBuffer(this: *InternalState, buffer: MutableString) !usize {
        var body_out_str = this.body_out_str.?;

        switch (this.encoding) {
            Encoding.brotli, Encoding.gzip, Encoding.deflate => {
                try this.decompress(buffer, body_out_str);
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

        return this.body_out_str.?.list.items.len;
    }
};

const default_redirect_count = 127;

method: Method,
header_entries: Headers.Entries,
header_buf: string,
url: URL,
connected_url: URL = URL{},
allocator: std.mem.Allocator,
verbose: bool = Environment.isTest,
remaining_redirect_count: i8 = default_redirect_count,
allow_retry: bool = false,
redirect_type: FetchRedirect = FetchRedirect.follow,
redirect: []u8 = &.{},
timeout: usize = 0,
progress_node: ?*std.Progress.Node = null,
received_keep_alive: bool = false,

disable_timeout: bool = false,
disable_keepalive: bool = false,
disable_decompression: bool = false,
state: InternalState = .{},

result_callback: HTTPClientResult.Callback = undefined,

/// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
/// This is a workaround for that.
force_last_modified: bool = false,
if_modified_since: string = "",
request_content_len_buf: ["-4294967295".len]u8 = undefined,

http_proxy: ?URL = null,
proxy_authorization: ?[]u8 = null,
proxy_tunneling: bool = false,
proxy_tunnel: ?ProxyTunnel = null,
signals: Signals = .{},
async_http_id: u32 = 0,
hostname: ?[]u8 = null,
reject_unauthorized: bool = true,

pub fn init(
    allocator: std.mem.Allocator,
    method: Method,
    url: URL,
    header_entries: Headers.Entries,
    header_buf: string,
    hostname: ?[]u8,
    signals: Signals,
) HTTPClient {
    return HTTPClient{
        .allocator = allocator,
        .method = method,
        .url = url,
        .header_entries = header_entries,
        .header_buf = header_buf,
        .hostname = hostname,
        .signals = signals,
    };
}

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
        tunnel.deinit();
        this.proxy_tunnel = null;
    }
}

pub fn isKeepAlivePossible(this: *HTTPClient) bool {
    if (comptime FeatureFlags.enable_keepalive) {
        // is not possible to reuse Proxy with TSL, so disable keepalive if url is tunneling HTTPS
        if (this.http_proxy != null and this.url.isHTTPS()) {
            return false;
        }
        return !this.disable_keepalive;
    }
    return false;
}

const Stage = enum(u8) {
    pending,
    connect,
    done,
    fail,
};

// threadlocal var resolver_cache

const os = std.os;

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

pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    chunked,

    pub fn isCompressed(this: Encoding) bool {
        return switch (this) {
            .brotli, .gzip, .deflate => true,
            else => false,
        };
    }
};

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const connection_header = picohttp.Header{ .name = "Connection", .value = "keep-alive" };
const connection_closing_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "gzip, deflate, br";
const accept_encoding_compression_no_brotli = "gzip, deflate";
const accept_encoding_header_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression };
const accept_encoding_header_compression_no_brotli = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression_no_brotli };
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
        var this: *HTTPChannelContext = @fieldParentPtr(HTTPChannelContext, "http", data.@"0");
        this.channel.writeItem(data) catch unreachable;
    }
};

pub const AsyncHTTP = struct {
    request: ?picohttp.Request = null,
    response: ?picohttp.Response = null,
    request_headers: Headers.Entries = Headers.Entries{},
    response_headers: Headers.Entries = Headers.Entries{},
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

    /// Timeout in nanoseconds
    timeout: usize = 0,
    redirected: bool = false,

    response_encoding: Encoding = Encoding.identity,
    verbose: bool = false,

    client: HTTPClient = undefined,
    err: ?anyerror = null,
    async_http_id: u32 = 0,

    state: AtomicState = AtomicState.init(State.pending),
    elapsed: u64 = 0,
    gzip_elapsed: u64 = 0,

    signals: Signals = .{},

    pub var active_requests_count = std.atomic.Value(usize).init(0);
    pub var max_simultaneous_requests = std.atomic.Value(usize).init(256);

    pub fn loadEnv(allocator: std.mem.Allocator, logger: *Log, env: *DotEnv.Loader) void {
        if (env.map.get("BUN_CONFIG_MAX_HTTP_REQUESTS")) |max_http_requests| {
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
            AsyncHTTP.max_simultaneous_requests.store(max, .Monotonic);
        }
    }

    pub fn signalHeaderProgress(this: *AsyncHTTP) void {
        @fence(.Release);
        var progress = this.signals.header_progress orelse return;
        progress.store(true, .Release);
    }

    pub fn enableBodyStreaming(this: *AsyncHTTP) void {
        @fence(.Release);
        var stream = this.signals.body_streaming orelse return;
        stream.store(true, .Release);
    }

    pub fn clearData(this: *AsyncHTTP) void {
        this.response_headers.deinit(this.allocator);
        this.response_headers = .{};
        this.request = null;
        this.response = null;
    }

    pub const State = enum(u32) {
        pending = 0,
        scheduled = 1,
        sending = 2,
        success = 3,
        fail = 4,
    };
    const AtomicState = std.atomic.Value(State);

    pub fn init(
        allocator: std.mem.Allocator,
        method: Method,
        url: URL,
        headers: Headers.Entries,
        headers_buf: string,
        response_buffer: *MutableString,
        request_body: []const u8,
        timeout: usize,
        callback: HTTPClientResult.Callback,
        http_proxy: ?URL,
        hostname: ?[]u8,
        redirect_type: FetchRedirect,
        signals: ?Signals,
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
            .http_proxy = http_proxy,
            .signals = signals orelse .{},
            .async_http_id = if (signals != null and signals.?.aborted != null) async_http_id.fetchAdd(1, .Monotonic) else 0,
        };

        this.client = HTTPClient.init(allocator, method, url, headers, headers_buf, hostname, signals orelse this.signals);
        this.client.async_http_id = this.async_http_id;
        this.client.timeout = timeout;
        this.client.http_proxy = this.http_proxy;
        this.client.redirect_type = redirect_type;
        this.timeout = timeout;

        if (http_proxy) |proxy| {
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

    pub fn isKeepAlivePossible(this: *AsyncHTTP) bool {
        if (comptime FeatureFlags.enable_keepalive) {
            // is not possible to reuse Proxy with TSL, so disable keepalive if url is tunneling HTTPS
            if (this.http_proxy != null and this.url.isHTTPS()) {
                return false;
            }
            // check state
            if (this.state.allow_keepalive and !this.disable_keepalive) return true;
        }
        return false;
    }

    pub fn initSync(allocator: std.mem.Allocator, method: Method, url: URL, headers: Headers.Entries, headers_buf: string, response_buffer: *MutableString, request_body: []const u8, timeout: usize, http_proxy: ?URL, hostname: ?[]u8, redirect_type: FetchRedirect) AsyncHTTP {
        return @This().init(
            allocator,
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            timeout,
            undefined,
            http_proxy,
            hostname,
            redirect_type,
            null,
        );
    }

    fn reset(this: *AsyncHTTP) !void {
        const timeout = this.timeout;
        const aborted = this.client.aborted;
        this.client = try HTTPClient.init(this.allocator, this.method, this.client.url, this.client.header_entries, this.client.header_buf, aborted);
        this.client.timeout = timeout;
        this.client.http_proxy = this.http_proxy;
        this.timeout = timeout;

        if (this.http_proxy) |proxy| {
            //TODO: need to understand how is possible to reuse Proxy with TSL, so disable keepalive if url is HTTPS
            this.client.disable_keepalive = this.url.isHTTPS();
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
        this.state.store(.scheduled, .Monotonic);
        batch.push(ThreadPool.Batch.from(&this.task));
    }

    fn sendSyncCallback(this: *SingleHTTPChannel, result: HTTPClientResult) void {
        this.channel.writeItem(result) catch unreachable;
    }

    pub fn sendSync(this: *AsyncHTTP, comptime _: bool) anyerror!picohttp.Response {
        try HTTPThread.init();

        var ctx = try bun.default_allocator.create(SingleHTTPChannel);
        ctx.* = SingleHTTPChannel.init();
        this.result_callback = HTTPClientResult.Callback.New(
            *SingleHTTPChannel,
            sendSyncCallback,
        ).init(ctx);

        var batch = bun.ThreadPool.Batch{};
        this.schedule(bun.default_allocator, &batch);
        http_thread.schedule(batch);
        while (true) {
            const result: HTTPClientResult = ctx.channel.readItem() catch unreachable;
            if (!result.isSuccess()) {
                return result.fail;
            }
            std.debug.assert(result.metadata != null);
            if (result.metadata) |metadata| {
                return metadata.response;
            }
        }

        unreachable;
    }

    pub fn onAsyncHTTPCallback(this: *AsyncHTTP, result: HTTPClientResult) void {
        std.debug.assert(this.real != null);

        var callback = this.result_callback;
        this.elapsed = http_thread.timer.read() -| this.elapsed;
        this.redirected = this.client.remaining_redirect_count != default_redirect_count;
        if (result.isSuccess()) {
            this.err = null;
            if (result.metadata) |metadata| {
                this.response = metadata.response;
            }
            this.state.store(.success, .Monotonic);
        } else {
            this.err = result.fail;
            this.response = null;
            this.state.store(State.fail, .Monotonic);
        }

        if (result.has_more) {
            callback.function(callback.ctx, result);
        } else {
            {
                this.client.deinit();
                defer default_allocator.destroy(this);
                this.real.?.* = this.*;
                this.real.?.response_buffer = this.response_buffer;

                log("onAsyncHTTPCallback: {any}", .{bun.fmt.fmtDuration(this.elapsed)});
                callback.function(callback.ctx, result);
            }

            const active_requests = AsyncHTTP.active_requests_count.fetchSub(1, .Monotonic);
            std.debug.assert(active_requests > 0);

            if (active_requests >= AsyncHTTP.max_simultaneous_requests.load(.Monotonic)) {
                http_thread.drainEvents();
            }
        }
    }

    pub fn startAsyncHTTP(task: *Task) void {
        var this = @fieldParentPtr(AsyncHTTP, "task", task);
        this.onStart();
    }

    pub fn onStart(this: *AsyncHTTP) void {
        _ = active_requests_count.fetchAdd(1, .Monotonic);
        this.err = null;
        this.state.store(.sending, .Monotonic);
        this.client.result_callback = HTTPClientResult.Callback.New(*AsyncHTTP, onAsyncHTTPCallback).init(
            this,
        );

        this.elapsed = http_thread.timer.read();
        if (this.response_buffer.list.capacity == 0) {
            this.response_buffer.allocator = default_allocator;
        }
        this.client.start(this.request_body, this.response_buffer);

        log("onStart: {any}", .{bun.fmt.fmtDuration(this.elapsed)});
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
            hashHeaderConst("Connection"),
            hashHeaderConst("Content-Length"),
            => continue,
            hashHeaderConst("if-modified-since") => {
                if (this.force_last_modified and this.if_modified_since.len == 0) {
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

    request_headers_buf[header_count] = connection_header;
    header_count += 1;

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

    if (!override_accept_encoding and !this.disable_decompression) {
        request_headers_buf[header_count] = accept_encoding_header;

        header_count += 1;
    }

    if (body_len > 0 or this.method.hasRequestBody()) {
        request_headers_buf[header_count] = .{
            .name = content_length_header_name,
            .value = std.fmt.bufPrint(&this.request_content_len_buf, "{d}", .{body_len}) catch "0",
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

pub fn doRedirect(this: *HTTPClient) void {
    std.debug.assert(this.state.cloned_metadata == null);
    const body_out_str = this.state.body_out_str.?;
    this.remaining_redirect_count -|= 1;
    std.debug.assert(this.redirect_type == FetchRedirect.follow);

    if (this.remaining_redirect_count == 0) {
        this.fail(error.TooManyRedirects);
        return;
    }
    this.state.reset(this.allocator);
    // also reset proxy to redirect
    this.proxy_tunneling = false;
    if (this.proxy_tunnel != null) {
        var tunnel = this.proxy_tunnel.?;
        tunnel.deinit();
        this.proxy_tunnel = null;
    }
    if (this.signals.aborted != null) {
        _ = socket_async_http_abort_tracker.swapRemove(this.async_http_id);
    }
    return this.start(.{ .bytes = "" }, body_out_str);
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

    std.debug.assert(this.state.response_message_buffer.list.capacity == 0);
    this.state = InternalState.init(body, body_out_str);

    if (this.isHTTPS()) {
        this.start_(true);
    } else {
        this.start_(false);
    }
}

fn start_(this: *HTTPClient, comptime is_ssl: bool) void {
    if (comptime Environment.allow_assert) {
        if (this.allocator.vtable == default_allocator.vtable and this.allocator.ptr != default_allocator.ptr) {
            @panic("HTTPClient used with threadlocal allocator belonging to another thread. This will cause crashes.");
        }
    }

    // Aborted before connecting
    if (this.signals.get(.aborted)) {
        this.fail(error.Aborted);
        return;
    }

    var socket = http_thread.connect(this, is_ssl) catch |err| {
        this.fail(err);
        return;
    };

    if (socket.isClosed() and (this.state.response_stage != .done and this.state.response_stage != .fail)) {
        this.fail(error.ConnectionClosed);
        std.debug.assert(this.state.fail != error.NoError);
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
        if (this.response.headers.len > 0) allocator.free(this.response.headers);
        this.owned_buf = &.{};
        this.url = "";
        this.response.headers = &.{};
        this.response.status = "";
    }
};

fn printRequest(request: picohttp.Request) void {
    @setCold(true);
    Output.prettyErrorln("Request: {}", .{request});
    Output.flush();
}

fn printResponse(response: picohttp.Response) void {
    @setCold(true);
    Output.prettyErrorln("Response: {}", .{response});
    Output.flush();
}

pub fn onWritable(this: *HTTPClient, comptime is_first_call: bool, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.signals.get(.aborted)) {
        this.closeAndAbort(is_ssl, socket);
        return;
    }

    switch (this.state.request_stage) {
        .pending, .headers => {
            var stack_fallback = std.heap.stackFallback(16384, default_allocator);
            const allocator = stack_fallback.get();
            var list = std.ArrayList(u8).initCapacity(allocator, stack_fallback.buffer.len) catch unreachable;
            defer if (list.capacity > stack_fallback.buffer.len) list.deinit();
            const writer = &list.writer();

            this.setTimeout(socket, 5);

            const request = this.buildRequest(this.state.original_request_body.len());

            if (this.http_proxy) |_| {
                if (this.url.isHTTPS()) {

                    //DO the tunneling!
                    this.proxy_tunneling = true;
                    writeProxyConnect(@TypeOf(writer), writer, this) catch {
                        this.closeAndFail(error.OutOfMemory, is_ssl, socket);
                        return;
                    };
                } else {
                    //HTTP do not need tunneling with CONNECT just a slightly different version of the request

                    writeProxyRequest(
                        @TypeOf(writer),
                        writer,
                        request,
                        this,
                    ) catch {
                        this.closeAndFail(error.OutOfMemory, is_ssl, socket);
                        return;
                    };
                }
            } else {
                writeRequest(
                    @TypeOf(writer),
                    writer,
                    request,
                ) catch {
                    this.closeAndFail(error.OutOfMemory, is_ssl, socket);
                    return;
                };
            }

            const headers_len = list.items.len;
            std.debug.assert(list.items.len == writer.context.items.len);
            if (this.state.request_body.len > 0 and list.capacity - list.items.len > 0 and !this.proxy_tunneling) {
                var remain = list.items.ptr[list.items.len..list.capacity];
                const wrote = @min(remain.len, this.state.request_body.len);
                std.debug.assert(wrote > 0);
                @memcpy(remain[0..wrote], this.state.request_body[0..wrote]);
                list.items.len += wrote;
            }

            const to_send = list.items[this.state.request_sent_len..];
            if (comptime Environment.allow_assert) {
                std.debug.assert(!socket.isShutdown());
                std.debug.assert(!socket.isClosed());
            }
            const amount = socket.write(
                to_send,
                false,
            );
            if (comptime is_first_call) {
                if (amount == 0) {
                    // don't worry about it
                    return;
                }
            }

            if (amount < 0) {
                this.closeAndFail(error.WriteFailed, is_ssl, socket);
                return;
            }

            this.state.request_sent_len += @as(usize, @intCast(amount));
            const has_sent_headers = this.state.request_sent_len >= headers_len;

            if (has_sent_headers and this.verbose) {
                printRequest(request);
            }

            if (has_sent_headers and this.state.request_body.len > 0) {
                this.state.request_body = this.state.request_body[this.state.request_sent_len - headers_len ..];
            }

            const has_sent_body = if (this.state.original_request_body == .bytes)
                this.state.request_body.len == 0
            else
                false;

            if (has_sent_headers and has_sent_body) {
                this.state.request_stage = .done;
                return;
            }

            if (has_sent_headers) {
                if (this.proxy_tunneling) {
                    this.state.request_stage = .proxy_handshake;
                } else {
                    this.state.request_stage = .body;
                }
                std.debug.assert(
                    // we should have leftover data OR we use sendfile()
                    (this.state.original_request_body == .bytes and this.state.request_body.len > 0) or
                        this.state.original_request_body == .sendfile,
                );

                // we sent everything, but there's some body leftover
                if (amount == @as(c_int, @intCast(to_send.len))) {
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
            if (this.state.original_request_body != .bytes) {
                @panic("sendfile is only supported without SSL. This code should never have been reached!");
            }
            var proxy = this.proxy_tunnel orelse return;

            this.setTimeout(socket, 5);

            const to_send = this.state.request_body;
            const amount = proxy.ssl.write(to_send) catch |err| {
                if (err == error.WantWrite) //just wait and retry when onWritable!
                    return;

                this.closeAndFail(error.WriteFailed, is_ssl, socket);
                return;
            };

            this.state.request_sent_len += @as(usize, @intCast(amount));
            this.state.request_body = this.state.request_body[@as(usize, @intCast(amount))..];

            if (this.state.request_body.len == 0) {
                this.state.request_stage = .done;
                return;
            }
        },
        .proxy_headers => {
            const proxy = this.proxy_tunnel orelse return;

            this.setTimeout(socket, 5);
            var stack_fallback = std.heap.stackFallback(16384, default_allocator);
            const allocator = stack_fallback.get();
            var list = std.ArrayList(u8).initCapacity(allocator, stack_fallback.buffer.len) catch unreachable;
            defer if (list.capacity > stack_fallback.buffer.len) list.deinit();
            const writer = &list.writer();

            const request = this.buildRequest(this.state.request_body.len);
            writeRequest(
                @TypeOf(writer),
                writer,
                request,
            ) catch {
                this.closeAndFail(error.OutOfMemory, is_ssl, socket);
                return;
            };

            const headers_len = list.items.len;
            std.debug.assert(list.items.len == writer.context.items.len);
            if (this.state.request_body.len > 0 and list.capacity - list.items.len > 0) {
                var remain = list.items.ptr[list.items.len..list.capacity];
                const wrote = @min(remain.len, this.state.request_body.len);
                std.debug.assert(wrote > 0);
                @memcpy(remain[0..wrote], this.state.request_body[0..wrote]);
                list.items.len += wrote;
            }

            const to_send = list.items[this.state.request_sent_len..];
            if (comptime Environment.allow_assert) {
                std.debug.assert(!socket.isShutdown());
                std.debug.assert(!socket.isClosed());
            }

            const amount = proxy.ssl.write(to_send) catch |err| {
                if (err == error.WantWrite) //just wait and retry when onWritable!
                    return;

                this.closeAndFail(error.WriteFailed, is_ssl, socket);
                return;
            };

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
                std.debug.assert(this.state.request_body.len > 0);

                // we sent everything, but there's some body leftover
                if (amount == @as(c_int, @intCast(to_send.len))) {
                    this.onWritable(false, is_ssl, socket);
                }
            } else {
                this.state.request_stage = .proxy_headers;
            }
        },
        else => {
            //Just check if need to call SSL_read if requested to be writable
            var proxy = this.proxy_tunnel orelse return;
            this.setTimeout(socket, 5);
            var data = proxy.getSSLData(null) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };
            if (data.partial) return;
            //only deinit if is not partial
            defer data.deinit();
            const decoded_data = data.slice();
            if (decoded_data.len == 0) return;
            this.onData(is_ssl, decoded_data, if (comptime is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
        },
    }
}

pub fn closeAndFail(this: *HTTPClient, err: anyerror, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.state.stage != .fail and this.state.stage != .done) {
        log("closeAndFail: {s}", .{@errorName(err)});
        if (!socket.isClosed()) {
            socket.ext(**anyopaque).?.* = bun.cast(
                **anyopaque,
                NewHTTPContext(is_ssl).ActiveSocket.init(&dead_socket).ptr(),
            );
            socket.close(0, null);
        }
        this.fail(err);
    }
}

fn startProxySendHeaders(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    this.state.response_stage = .proxy_headers;
    this.state.request_stage = .proxy_headers;
    this.state.request_sent_len = 0;
    this.onWritable(true, is_ssl, socket);
}

fn retryProxyHandshake(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    const proxy = this.proxy_tunnel orelse return;
    if (proxy.ssl.isInitFinished()) {
        this.startProxySendHeaders(is_ssl, socket);
        return;
    }
    proxy.ssl.handshake() catch |err| {
        switch (err) {
            error.WantWrite, error.WantRead => {
                return;
            },
            else => {
                log("Error performing SSL handshake with host through proxy {any}\n", .{err});
                this.closeAndFail(err, is_ssl, socket);
                return;
            },
        }
    };
    this.startProxySendHeaders(is_ssl, socket);
}
fn startProxyHandshake(this: *HTTPClient, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    this.state.response_stage = .proxy_handshake;
    this.state.request_stage = .proxy_handshake;
    const proxy = ProxyTunnel.init(is_ssl, this, socket);
    this.proxy_tunnel = proxy;

    proxy.ssl.handshake() catch |err| {
        switch (err) {
            error.WantWrite, error.WantRead => {
                //Wait and Pull
                return;
            },
            else => {
                log("Error performing SSL handshake with host through proxy {any}\n", .{err});
                this.closeAndFail(err, is_ssl, socket);
                return;
            },
        }
    };
    this.startProxySendHeaders(is_ssl, socket);
}

pub fn onData(this: *HTTPClient, comptime is_ssl: bool, incoming_data: []const u8, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    log("onData {}", .{incoming_data.len});
    if (this.signals.get(.aborted)) {
        this.closeAndAbort(is_ssl, socket);
        return;
    }
    switch (this.state.response_stage) {
        .pending, .headers, .proxy_decoded_headers => {
            var to_read = incoming_data;
            var amount_read: usize = 0;
            var needs_move = true;
            if (this.state.response_message_buffer.list.items.len > 0) {
                // this one probably won't be another chunk, so we use appendSliceExact() to avoid over-allocating
                this.state.response_message_buffer.appendSliceExact(incoming_data) catch @panic("Out of memory");
                to_read = this.state.response_message_buffer.list.items;
                needs_move = false;
            }

            // we reset the pending_response each time wich means that on parse error this will be always be empty
            this.state.pending_response = picohttp.Response{};

            var response = picohttp.Response.parseParts(
                to_read,
                &shared_response_headers_buf,
                &amount_read,
            ) catch |err| {
                switch (err) {
                    error.ShortRead => {
                        if (needs_move) {
                            const to_copy = incoming_data;

                            if (to_copy.len > 0) {
                                // this one will probably be another chunk, so we leave a little extra room
                                this.state.response_message_buffer.append(to_copy) catch @panic("Out of memory");
                            }
                        }

                        this.setTimeout(socket, 5);
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
                if (err == error.Redirect) {
                    this.state.response_message_buffer.deinit();
                    // we need to clean the client reference before closing the socket because we are going to reuse the same ref in a another request
                    socket.ext(**anyopaque).?.* = bun.cast(
                        **anyopaque,
                        NewHTTPContext(is_ssl).ActiveSocket.init(&dead_socket).ptr(),
                    );
                    if (this.state.allow_keepalive and FeatureFlags.enable_keepalive) {
                        std.debug.assert(this.connected_url.hostname.len > 0);
                        ctx.releaseSocket(
                            socket,
                            this.connected_url.hostname,
                            this.connected_url.getPortAuto(),
                        );
                    } else {
                        socket.close(0, null);
                    }

                    this.connected_url = URL{};
                    this.doRedirect();
                    return;
                }

                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (this.state.content_encoding_i < response.headers.len and !this.state.did_set_content_encoding) {
                // if it compressed with this header, it is no longer because we will decompress it
                const mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers, .capacity = response.headers.len };
                this.state.did_set_content_encoding = true;
                response.headers = mutable_headers.items;
                this.state.content_encoding_i = std.math.maxInt(@TypeOf(this.state.content_encoding_i));
                // we need to reset the pending response because we removed a header
                this.state.pending_response = response;
            }

            if (should_continue == .finished) {
                // this means that the request ended
                // clone metadata and return the progress at this point
                this.cloneMetadata();
                // if is chuncked but no body is expected we mark the last chunk
                this.state.received_last_chunk = true;
                // if is not we ignore the content_length
                this.state.content_length = 0;
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }

            if (this.proxy_tunneling and this.proxy_tunnel == null) {
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
        },

        .body => {
            this.setTimeout(socket, 5);

            if (this.proxy_tunnel != null) {
                var proxy = this.proxy_tunnel.?;
                var data = proxy.getSSLData(incoming_data) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };
                if (data.partial) return;
                defer data.deinit();
                const decoded_data = data.slice();
                if (decoded_data.len == 0) return;
                const report_progress = this.handleResponseBody(decoded_data, false) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };

                if (report_progress) {
                    this.progressUpdate(is_ssl, ctx, socket);
                    return;
                }
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

            if (this.proxy_tunnel != null) {
                var proxy = this.proxy_tunnel.?;
                var data = proxy.getSSLData(incoming_data) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };
                if (data.partial) return;
                defer data.deinit();
                const decoded_data = data.slice();
                if (decoded_data.len == 0) return;

                const report_progress = this.handleResponseBodyChunkedEncoding(decoded_data) catch |err| {
                    this.closeAndFail(err, is_ssl, socket);
                    return;
                };

                if (report_progress) {
                    this.progressUpdate(is_ssl, ctx, socket);
                    return;
                }
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
        .proxy_headers => {
            this.setTimeout(socket, 5);
            var proxy = this.proxy_tunnel orelse return;
            var data = proxy.getSSLData(incoming_data) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };
            if (data.partial) return;
            //only deinit if is not partial
            defer data.deinit();
            const decoded_data = data.slice();
            if (decoded_data.len == 0) return;
            this.proxy_tunneling = false;
            this.state.response_stage = .proxy_decoded_headers;
            //actual do the header parsing!
            this.onData(is_ssl, decoded_data, ctx, socket);
        },
        .proxy_handshake => {
            this.setTimeout(socket, 5);

            // put more data into SSL
            const proxy = this.proxy_tunnel orelse return;
            _ = proxy.in_bio.write(incoming_data) catch 0;

            //retry again!
            this.retryProxyHandshake(is_ssl, socket);
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
    if (this.signals.aborted != null) {
        _ = socket_async_http_abort_tracker.swapRemove(this.async_http_id);
    }

    this.state.request_stage = .fail;
    this.state.response_stage = .fail;
    this.state.fail = err;
    this.state.stage = .fail;

    const callback = this.result_callback;
    const result = this.toResult();
    this.state.reset(this.allocator);
    this.proxy_tunneling = false;

    callback.run(result);
}

// We have to clone metadata immediately after use
fn cloneMetadata(this: *HTTPClient) void {
    std.debug.assert(this.state.pending_response != null);
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
        const headers_buf = this.allocator.alloc(picohttp.Header, response.headers.len) catch unreachable;
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
        // we added a empty metadata just in case but will hit the std.debug.assert
        this.state.cloned_metadata = .{};
    }
}

pub fn setTimeout(this: *HTTPClient, socket: anytype, minutes: c_uint) void {
    if (this.disable_timeout) {
        socket.timeout(0);
        socket.setTimeoutMinutes(0);
        return;
    }

    socket.timeout(0);
    socket.setTimeoutMinutes(minutes);
}

pub fn progressUpdate(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.state.stage != .done and this.state.stage != .fail) {
        const out_str = this.state.body_out_str.?;
        const body = out_str.*;
        const result = this.toResult();
        const is_done = !result.has_more;

        if (this.signals.aborted != null and is_done) {
            _ = socket_async_http_abort_tracker.swapRemove(this.async_http_id);
        }

        log("progressUpdate {}", .{is_done});

        const callback = this.result_callback;

        if (is_done) {
            socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, NewHTTPContext(is_ssl).ActiveSocket.init(&dead_socket).ptr());

            if (this.isKeepAlivePossible() and !socket.isClosedOrHasError()) {
                ctx.releaseSocket(
                    socket,
                    this.connected_url.hostname,
                    this.connected_url.getPortAuto(),
                );
            } else if (!socket.isClosed()) {
                socket.close(0, null);
            }

            this.state.reset(this.allocator);
            this.state.response_stage = .done;
            this.state.request_stage = .done;
            this.state.stage = .done;
            this.proxy_tunneling = false;
        }

        result.body.?.* = body;
        callback.run(result);

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
    fail: anyerror = error.NoError,
    /// Owns the response metadata aka headers, url and status code
    metadata: ?HTTPResponseMetadata = null,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: BodySize = .unknown,
    redirected: bool = false,
    certificate_info: ?CertificateInfo = null,

    pub const BodySize = union(enum) {
        total_received: usize,
        content_length: usize,
        unknown: void,
    };

    pub fn isSuccess(this: *const HTTPClientResult) bool {
        return this.fail == error.NoError;
    }

    pub fn isTimeout(this: *const HTTPClientResult) bool {
        return this.fail == error.Timeout;
    }

    pub fn isAbort(this: *const HTTPClientResult) bool {
        return this.fail == error.Aborted;
    }

    pub const Callback = struct {
        ctx: *anyopaque,
        function: Function,

        pub const Function = *const fn (*anyopaque, HTTPClientResult) void;

        pub fn run(self: Callback, result: HTTPClientResult) void {
            self.function(self.ctx, result);
        }

        pub fn New(comptime Type: type, comptime callback: anytype) type {
            return struct {
                pub fn init(this: Type) Callback {
                    return Callback{
                        .ctx = this,
                        .function = @This().wrapped_callback,
                    };
                }

                pub fn wrapped_callback(ptr: *anyopaque, result: HTTPClientResult) void {
                    const casted = @as(Type, @ptrCast(@alignCast(ptr)));
                    @call(.always_inline, callback, .{ casted, result });
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
            .redirected = this.remaining_redirect_count != default_redirect_count,
            .fail = this.state.fail,
            // check if we are reporting cert errors, do not have a fail state and we are not done
            .has_more = this.state.fail == error.NoError and !this.state.isDone(),
            .body_size = body_size,
            .certificate_info = null,
        };
    }
    return HTTPClientResult{
        .body = this.state.body_out_str,
        .metadata = null,
        .fail = this.state.fail,
        // check if we are reporting cert errors, do not have a fail state and we are not done
        .has_more = certificate_info != null or (this.state.fail == error.NoError and !this.state.isDone()),
        .body_size = body_size,
        .certificate_info = certificate_info,
    };
}

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const preallocate_max = 1024 * 1024 * 256;

pub fn handleResponseBody(this: *HTTPClient, incoming_data: []const u8, is_only_buffer: bool) !bool {
    std.debug.assert(this.state.transfer_encoding == .identity);
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

    if (this.state.encoding.isCompressed()) {
        var body_buffer = this.state.body_out_str.?;
        if (body_buffer.list.capacity == 0) {
            const min = @min(@ceil(@as(f64, @floatFromInt(incoming_data.len)) * 1.5), @as(f64, 1024 * 1024 * 2));
            try body_buffer.growBy(@max(@as(usize, @intFromFloat(min)), 32));
        }

        // std.debug.assert(!body_buffer.owns(b));
        try this.state.decompressBytes(incoming_data, body_buffer);
    } else {
        try this.state.getBodyBuffer().appendSliceExact(incoming_data);
    }

    if (this.state.response_message_buffer.owns(incoming_data)) {
        if (comptime Environment.allow_assert) {
            // i'm not sure why this would happen and i haven't seen it happen
            // but we should check
            std.debug.assert(this.state.getBodyBuffer().list.items.ptr != this.state.response_message_buffer.list.items.ptr);
        }

        this.state.response_message_buffer.deinit();
    }

    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(incoming_data.len);
        progress.context.maybeRefresh();
    }
}

fn handleResponseBodyFromMultiplePackets(this: *HTTPClient, incoming_data: []const u8) !bool {
    var buffer = this.state.getBodyBuffer();
    const content_length = this.state.content_length;

    if (buffer.list.items.len == 0 and incoming_data.len < preallocate_max) {
        buffer.list.ensureTotalCapacityPrecise(buffer.allocator, incoming_data.len) catch {};
    }

    var remainder: []const u8 = undefined;
    if (content_length != null) {
        const remaining_content_length = content_length.? -| this.state.total_body_received;
        remainder = incoming_data[0..@min(incoming_data.len, remaining_content_length)];
    } else {
        remainder = incoming_data;
    }

    _ = try buffer.write(remainder);

    this.state.total_body_received += remainder.len;

    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(this.state.total_body_received);
        progress.context.maybeRefresh();
    }

    // done or streaming
    const is_done = content_length != null and this.state.total_body_received >= content_length.?;
    if (is_done or this.signals.get(.body_streaming) or content_length == null) {
        const processed = try this.state.processBodyBuffer(buffer.*);

        if (this.progress_node) |progress| {
            progress.activate();
            progress.setCompletedItems(this.state.total_body_received);
            progress.context.maybeRefresh();
        }
        return is_done or processed > 0;
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
    if (comptime Environment.allow_assert) {
        if (pret == -1) {
            @breakpoint();
        }
    }
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
                const processed = try this.state.processBodyBuffer(buffer);
                return processed > 0;
            }

            return false;
        },
        // Done
        else => {
            this.state.received_last_chunk = true;
            _ = try this.state.processBodyBuffer(
                buffer,
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
    std.debug.assert(incoming_data.len <= single_packet_small_buffer.len);

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
                const processed = try this.state.processBodyBuffer(body_buffer.*);
                return processed > 0;
            }

            return false;
        },
        // Done
        else => {
            this.state.received_last_chunk = true;

            try this.handleResponseBodyFromSinglePacket(buffer);
            std.debug.assert(this.state.body_out_str.?.list.items.ptr != buffer.ptr);
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
    for (response.headers, 0..) |header, header_i| {
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
                if (!this.disable_decompression) {
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
                    if (!this.disable_decompression) {
                        this.state.transfer_encoding = Encoding.gzip;
                    }
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    if (!this.disable_decompression) {
                        this.state.transfer_encoding = Encoding.deflate;
                    }
                } else if (strings.eqlComptime(header.value, "br")) {
                    if (!this.disable_decompression) {
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
                        this.state.allow_keepalive = false;
                    }
                }
            },
            hashHeaderConst("Last-Modified") => {
                pretend_304 = this.force_last_modified and response.status_code > 199 and response.status_code < 300 and this.if_modified_since.len > 0 and strings.eql(this.if_modified_since, header.value);
            },

            else => {},
        }
    }

    if (this.verbose) {
        printResponse(response.*);
    }

    if (pretend_304) {
        response.status_code = 304;
    }

    // Don't do this for proxies because those connections will be open for awhile.
    if (!this.proxy_tunneling) {

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
            this.state.allow_keepalive = false;
        }
    }

    if (this.proxy_tunneling and this.proxy_tunnel == null) {
        if (response.status_code == 200) {
            // signal to continue the proxing
            return ShouldContinue.continue_streaming;
        }

        //proxy denied connection so return proxy result (407, 403 etc)
        this.proxy_tunneling = false;
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
                                std.debug.assert(string_builder.cap == string_builder.len);

                            const normalized_url = JSC.URL.hrefFromString(bun.String.fromBytes(string_builder.allocatedSlice()));
                            defer normalized_url.deref();
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
                                std.debug.assert(string_builder.cap == string_builder.len);

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

                    return error.Redirect;
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

    if (this.method.hasBody() and (content_length == null or content_length.? > 0 or !this.state.allow_keepalive or this.state.transfer_encoding == .chunked or is_server_sent_events)) {
        return ShouldContinue.continue_streaming;
    } else {
        return ShouldContinue.finished;
    }
}
