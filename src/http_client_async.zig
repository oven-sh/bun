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
const StringBuilder = @import("./string_builder.zig");
const AsyncIO = bun.AsyncIO;
const ThreadPool = bun.ThreadPool;
const BoringSSL = bun.BoringSSL;
pub const NetworkThread = @import("./network_thread.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;
const SOCK = os.SOCK;
const Arena = @import("./mimalloc_arena.zig").Arena;
const ZlibPool = @import("./http/zlib.zig");

const URLBufferPool = ObjectPool([4096]u8, null, false, 10);
const uws = bun.uws;
pub const MimeType = @import("./http/mime_type.zig");
pub const URLPath = @import("./http/url_path.zig");
// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
var default_arena: Arena = undefined;
pub var http_thread: HTTPThread = undefined;
const HiveArray = @import("./hive_array.zig").HiveArray;
const Batch = NetworkThread.Batch;
const TaggedPointerUnion = @import("./tagged_pointer.zig").TaggedPointerUnion;
const DeadSocket = opaque {};
var dead_socket = @as(*DeadSocket, @ptrFromInt(1));
//TODO: this needs to be freed when Worker Threads are implemented
var socket_async_http_abort_tracker = std.AutoArrayHashMap(u32, *uws.Socket).init(bun.default_allocator);
var async_http_id: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0);

const print_every = 0;
var print_every_i: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
var shared_request_headers_buf: [256]picohttp.Header = undefined;

// this doesn't need to be stack memory because it is immediately cloned after use
var shared_response_headers_buf: [256]picohttp.Header = undefined;

const end_of_chunked_http1_1_encoding_response_body = "0\r\n\r\n";

pub const Signals = struct {
    header_progress: ?*std.atomic.Atomic(bool) = null,
    body_streaming: ?*std.atomic.Atomic(bool) = null,
    aborted: ?*std.atomic.Atomic(bool) = null,

    pub const Store = struct {
        header_progress: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
        body_streaming: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
        aborted: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),

        pub fn to(this: *Store) Signals {
            return .{
                .header_progress = &this.header_progress,
                .body_streaming = &this.body_streaming,
                .aborted = &this.aborted,
            };
        }
    };

    pub fn get(this: Signals, comptime field: std.meta.FieldEnum(Signals)) bool {
        var ptr: *std.atomic.Atomic(bool) = @field(this, @tagName(field)) orelse return false;
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
                std.os.linux.sendfile(socket.fd(), this.fd, &signed_offset, this.remain);
            this.offset = @as(u64, @intCast(signed_offset));

            const errcode = std.os.linux.getErrno(val);

            this.remain -|= @as(u64, @intCast(this.offset -| begin));

            if (errcode != .SUCCESS or this.remain == 0 or val == 0) {
                if (errcode == .SUCCESS) {
                    return .{ .done = {} };
                }

                return .{ .err = AsyncIO.asError(errcode) };
            }
        } else {
            var sbytes: std.os.off_t = adjusted_count;
            const signed_offset = @as(i64, @bitCast(@as(u64, this.offset)));
            const errcode = std.c.getErrno(std.c.sendfile(
                this.fd,
                socket.fd(),

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

                return .{ .err = AsyncIO.asError(errcode) };
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
        var buffer = try std.ArrayList(u8).initCapacity(bun.default_allocator, 16 * 1024);

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
        var context = BoringSSL.SSL_CTX.init();

        if (context) |ssl_context| {
            var ssl_ctx = ssl_context;
            var ssl = BoringSSL.SSL.init(ssl_context);
            ssl.setIsClient(true);
            var out_bio: *BoringSSL.BIO = undefined;
            if (comptime is_ssl) {
                //TLS -> TLS
                var proxy_ssl: *BoringSSL.SSL = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
                //create new SSL BIO
                out_bio = BoringSSL.BIO_new(BoringSSL.BIO_f_ssl()) orelse unreachable;
                //chain SSL bio with proxy BIO
                var proxy_bio = BoringSSL.SSL_get_wbio(proxy_ssl);
                _ = BoringSSL.BIO_push(out_bio, proxy_bio);
            } else {
                // socket output bio for non-TLS -> TLS
                var fd = @as(c_int, @intCast(@intFromPtr(socket.getNativeHandle())));
                out_bio = BoringSSL.BIO_new_fd(fd, BoringSSL.BIO_NOCLOSE);
            }

            // in memory bio to control input flow from onData handler
            var in_bio = BoringSSL.BIO.init() catch {
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
            var opts: uws.us_socket_context_options_t = .{};
            this.us_socket_context = uws.us_create_socket_context(ssl_int, http_thread.loop, @sizeOf(usize), opts).?;
            if (comptime ssl) {
                this.sslCtx().setup();
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

            if (hostname.len <= MAX_KEEPALIVE_HOSTNAME and !socket.isClosed() and !socket.isShutdown() and socket.isEstablished()) {
                if (this.pending_sockets.get()) |pending| {
                    socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(pending).ptr());
                    socket.flush();
                    socket.timeout(300);

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
            pub fn onTimeout(
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

                    if (http_socket.isShutdown()) {
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

            if (comptime FeatureFlags.enable_keepalive) {
                if (!client.disable_keepalive) {
                    if (this.existingSocket(hostname, port)) |sock| {
                        sock.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(client).ptr());
                        client.allow_retry = true;
                        client.onOpen(comptime ssl, sock);
                        return sock;
                    }
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
    var http_thread_loaded: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false);

    loop: *uws.Loop,
    http_context: NewHTTPContext(false),
    https_context: NewHTTPContext(true),

    queued_tasks: Queue = Queue{},
    queued_shutdowns: ShutdownQueue = ShutdownQueue{},
    has_awoken: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
    timer: std.time.Timer = undefined,
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
                .stack_size = 4 * 1024 * 1024,
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
        var loop = uws.Loop.create(struct {
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

    fn processEvents_(this: *@This()) void {
        this.loop.num_polls = @max(2, this.loop.num_polls);

        while (true) {
            this.drainEvents();

            var start_time: i128 = 0;
            if (comptime Environment.isDebug) {
                start_time = std.time.nanoTimestamp();
            }
            Output.flush();
            this.loop.run();
            if (comptime Environment.isDebug) {
                var end = std.time.nanoTimestamp();
                threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@as(i64, @truncate(end - start_time)))});
                Output.flush();
            }
        }
    }

    pub fn processEvents(this: *@This()) void {
        processEvents_(this);
        unreachable;
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
                var http: *AsyncHTTP = @fieldParentPtr(AsyncHTTP, "task", task);
                this.queued_tasks.push(http);
            }
        }

        if (this.has_awoken.load(.Monotonic))
            this.loop.wakeup();
    }
};

const log = Output.scoped(.fetch, false);

var temp_hostname: [8096]u8 = undefined;
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
        var ssl: *BoringSSL.SSL = @as(*BoringSSL.SSL, @ptrCast(socket.getNativeHandle()));
        if (!ssl.isInitFinished()) {
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

            ssl.configureHTTPClient(hostname);
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

    const in_progress = client.state.stage != .done and client.state.stage != .fail;

    // if the peer closed after a full chunk, treat this
    // as if the transfer had complete, browsers appear to ignore
    // a missing 0\r\n chunk
    if (in_progress and client.state.isChunkedEncoding()) {
        if (picohttp.phr_decode_chunked_is_in_data(&client.state.chunked_decoder) == 0) {
            var buf = client.state.getBodyBuffer();
            if (buf.list.items.len > 0) {
                client.state.received_last_chunk = true;
                client.progressUpdate(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
                return;
            }
        }
    }

    if (client.allow_retry) {
        client.allow_retry = false;
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
    _: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    log("onEnd  {s}\n", .{client.url.href});

    if (client.state.stage != .done and client.state.stage != .fail)
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

pub const InternalState = struct {
    response_message_buffer: MutableString = undefined,
    pending_response: picohttp.Response = undefined,
    allow_keepalive: bool = true,
    received_last_chunk: bool = false,
    transfer_encoding: Encoding = Encoding.identity,
    encoding: Encoding = Encoding.identity,
    content_encoding_i: u8 = std.math.maxInt(u8),
    chunked_decoder: picohttp.phr_chunked_decoder = .{},
    zlib_reader: ?*Zlib.ZlibReaderArrayList = null,
    stage: Stage = Stage.pending,
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
    metadata_sent: bool = false,

    pub fn init(body: HTTPRequestBody, body_out_str: *MutableString) InternalState {
        return .{
            .original_request_body = body,
            .request_body = if (body == .bytes) body.bytes else "",
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .body_out_str = body_out_str,
            .stage = Stage.pending,
            .pending_response = picohttp.Response{},
        };
    }

    pub fn isChunkedEncoding(this: *InternalState) bool {
        return this.transfer_encoding == Encoding.chunked;
    }

    pub fn reset(this: *InternalState) void {
        this.compressed_body.deinit();
        this.response_message_buffer.deinit();

        var body_msg = this.body_out_str;
        if (body_msg) |body| body.reset();
        if (this.zlib_reader) |reader| {
            this.zlib_reader = null;
            reader.deinit();
        }

        this.* = .{
            .body_out_str = body_msg,
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .original_request_body = .{ .bytes = "" },
            .request_body = "",
        };
    }

    pub fn getBodyBuffer(this: *InternalState) *MutableString {
        switch (this.encoding) {
            Encoding.gzip, Encoding.deflate => {
                return &this.compressed_body;
            },
            else => {
                return this.body_out_str.?;
            },
        }
    }

    fn isDone(this: *InternalState) bool {
        if (this.isChunkedEncoding()) {
            return this.received_last_chunk;
        }

        if (this.content_length) |content_length| {
            return this.total_body_received >= content_length;
        }

        // TODO: in future to handle Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        return true;
    }

    fn decompressConst(this: *InternalState, buffer: []const u8, body_out_str: *MutableString) !void {
        defer this.compressed_body.reset();
        var gzip_timer: std.time.Timer = undefined;

        if (extremely_verbose)
            gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

        var reader: *Zlib.ZlibReaderArrayList = undefined;
        if (this.zlib_reader) |current_reader| {
            reader = current_reader;
            reader.zlib.next_in = buffer.ptr;
            reader.zlib.avail_in = @as(u32, @truncate(buffer.len));

            reader.list = body_out_str.list;
            const initial = body_out_str.list.items.len;
            body_out_str.list.expandToCapacity();
            if (body_out_str.list.capacity == initial) {
                try body_out_str.list.ensureUnusedCapacity(body_out_str.allocator, 4096);
                body_out_str.list.expandToCapacity();
            }
            reader.zlib.next_out = &body_out_str.list.items[initial];
            reader.zlib.avail_out = @as(u32, @truncate(body_out_str.list.capacity - initial));
            // we reset the total out so we can track how much we decompressed this time
            reader.zlib.total_out = initial;
        } else {
            reader = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
                buffer,
                &body_out_str.list,
                body_out_str.allocator,
                default_allocator,
                .{
                    // TODO: add br support today we support gzip and deflate only
                    // zlib.MAX_WBITS = 15
                    // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                    // to (de-)compress zlib format, use wbits = zlib.MAX_WBITS
                    // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                    .windowBits = if (this.encoding == Encoding.gzip) Zlib.MAX_WBITS | 16 else -Zlib.MAX_WBITS,
                },
            );
            this.zlib_reader = reader;
        }

        reader.readAll() catch |err| {
            if (this.isDone() or error.ShortRead != err) {
                Output.prettyErrorln("<r><red>Zlib error: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                Output.flush();
                return err;
            }
        };

        if (extremely_verbose)
            this.gzip_elapsed = gzip_timer.read();
    }

    fn decompress(this: *InternalState, buffer: MutableString, body_out_str: *MutableString) !void {
        try this.decompressConst(buffer.list.items, body_out_str);
    }

    pub fn processBodyBuffer(this: *InternalState, buffer: MutableString) !usize {
        var body_out_str = this.body_out_str.?;

        switch (this.encoding) {
            Encoding.gzip, Encoding.deflate => {
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

        return this.postProcessBody();
    }

    pub fn postProcessBody(this: *InternalState) usize {

        // we only touch it if we did not sent the headers yet
        if (!this.metadata_sent) {
            var response = &this.pending_response;
            if (this.content_encoding_i < response.headers.len) {
                // if it compressed with this header, it is no longer
                var mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers, .capacity = response.headers.len };
                _ = mutable_headers.orderedRemove(this.content_encoding_i);
                response.headers = mutable_headers.items;
                this.content_encoding_i = std.math.maxInt(@TypeOf(this.content_encoding_i));
            }
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
redirect: ?*URLBufferPool.Node = null,
timeout: usize = 0,
progress_node: ?*std.Progress.Node = null,
received_keep_alive: bool = false,

disable_timeout: bool = false,
disable_keepalive: bool = false,

state: InternalState = .{},

result_callback: HTTPClientResult.Callback = undefined,

/// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
/// This is a workaround for that.
force_last_modified: bool = false,
if_modified_since: string = "",
request_content_len_buf: ["-4294967295".len]u8 = undefined,

cloned_metadata: HTTPResponseMetadata = .{},
http_proxy: ?URL = null,
proxy_authorization: ?[]u8 = null,
proxy_tunneling: bool = false,
proxy_tunnel: ?ProxyTunnel = null,
signals: Signals = .{},
async_http_id: u32 = 0,
hostname: ?[]u8 = null,

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
    if (this.redirect) |redirect| {
        redirect.release();
        this.redirect = null;
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
            // we don't support brotli yet
            .gzip, .deflate => true,
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
const accept_encoding_compression = "gzip, deflate";
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

    pub var active_requests_count = std.atomic.Atomic(usize).init(0);
    pub var max_simultaneous_requests = std.atomic.Atomic(usize).init(256);

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
    const AtomicState = std.atomic.Atomic(State);

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
            //TODO: need to understand how is possible to reuse Proxy with TSL, so disable keepalive if url is HTTPS
            this.client.disable_keepalive = this.url.isHTTPS();
            // Username between 0 and 4096 chars
            if (proxy.username.len > 0 and proxy.username.len < 4096) {
                // Password between 0 and 4096 chars
                if (proxy.password.len > 0 and proxy.password.len < 4096) {
                    // decode password
                    var password_buffer: [4096]u8 = undefined;
                    @memset(&password_buffer, 0);
                    var password_stream = std.io.fixedBufferStream(&password_buffer);
                    var password_writer = password_stream.writer();
                    const PassWriter = @TypeOf(password_writer);
                    const password_len = PercentEncoding.decode(PassWriter, password_writer, proxy.password) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const password = password_buffer[0..password_len];

                    // Decode username
                    var username_buffer: [4096]u8 = undefined;
                    @memset(&username_buffer, 0);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    var username_writer = username_stream.writer();
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
                    var encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], auth);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                } else {
                    //Decode username
                    var username_buffer: [4096]u8 = undefined;
                    @memset(&username_buffer, 0);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    var username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const username = username_buffer[0..username_len];

                    // only use user
                    const size = std.base64.standard.Encoder.calcSize(username_len);
                    var buf = allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    var encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], username);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                }
            }
        }
        return this;
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
        var aborted = this.client.aborted;
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
                    var password_buffer: [4096]u8 = undefined;
                    @memset(&password_buffer, 0);
                    var password_stream = std.io.fixedBufferStream(&password_buffer);
                    var password_writer = password_stream.writer();
                    const PassWriter = @TypeOf(password_writer);
                    const password_len = PercentEncoding.decode(PassWriter, password_writer, proxy.password) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const password = password_buffer[0..password_len];

                    // Decode username
                    var username_buffer: [4096]u8 = undefined;
                    @memset(&username_buffer, 0);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    var username_writer = username_stream.writer();
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
                    var encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], auth);
                    buf[0.."Basic ".len].* = "Basic ".*;
                    this.client.proxy_authorization = buf[0 .. "Basic ".len + encoded.len];
                } else {
                    //Decode username
                    var username_buffer: [4096]u8 = undefined;
                    @memset(&username_buffer, 0);
                    var username_stream = std.io.fixedBufferStream(&username_buffer);
                    var username_writer = username_stream.writer();
                    const UserWriter = @TypeOf(username_writer);
                    const username_len = PercentEncoding.decode(UserWriter, username_writer, proxy.username) catch {
                        // Invalid proxy authorization
                        return this;
                    };
                    const username = username_buffer[0..username_len];

                    // only use user
                    const size = std.base64.standard.Encoder.calcSize(username_len);
                    var buf = this.allocator.alloc(u8, size + "Basic ".len) catch unreachable;
                    var encoded = std.base64.url_safe.Encoder.encode(buf["Basic ".len..], username);
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

        var batch = NetworkThread.Batch{};
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
    var header_names = header_entries.items(.name);
    var header_values = header_entries.items(.value);
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

    if (!override_accept_encoding) {
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
    var body_out_str = this.state.body_out_str.?;
    this.remaining_redirect_count -|= 1;
    std.debug.assert(this.redirect_type == FetchRedirect.follow);

    if (this.remaining_redirect_count == 0) {
        this.fail(error.TooManyRedirects);
        return;
    }
    this.state.reset();
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

const HTTPResponseMetadata = struct {
    url: []const u8 = "",
    owned_buf: []u8 = "",
    response: picohttp.Response = .{},
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
            var allocator = stack_fallback.get();
            var list = std.ArrayList(u8).initCapacity(allocator, stack_fallback.buffer.len) catch unreachable;
            defer if (list.capacity > stack_fallback.buffer.len) list.deinit();
            var writer = &list.writer();

            this.setTimeout(socket, 60);

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

            if (this.verbose) {
                printRequest(request);
            }

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
                this.state.request_stage = .body;
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
            this.setTimeout(socket, 60);

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
            var proxy = this.proxy_tunnel orelse return;

            this.setTimeout(socket, 60);

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

            this.setTimeout(socket, 60);
            var stack_fallback = std.heap.stackFallback(16384, default_allocator);
            var allocator = stack_fallback.get();
            var list = std.ArrayList(u8).initCapacity(allocator, stack_fallback.buffer.len) catch unreachable;
            defer if (list.capacity > stack_fallback.buffer.len) list.deinit();
            var writer = &list.writer();

            this.setTimeout(socket, 60);

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
            this.setTimeout(socket, 60);
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
    this.state.reset();
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

            this.state.pending_response = picohttp.Response{};

            const response = picohttp.Response.parseParts(
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

                        this.setTimeout(socket, 60);
                    },
                    else => {
                        this.closeAndFail(err, is_ssl, socket);
                    },
                }
                return;
            };

            this.state.pending_response = response;

            var body_buf = to_read[@min(@as(usize, @intCast(response.bytes_read)), to_read.len)..];

            var deferred_redirect: ?*URLBufferPool.Node = null;
            const can_continue = this.handleResponseMetadata(
                response,
                // If there are multiple consecutive redirects
                // and the redirect differs in hostname
                // the new URL buffer may point to invalid memory after
                // this function is called
                // That matters because for Keep Alive, the hostname must point to valid memory
                &deferred_redirect,
            ) catch |err| {
                if (err == error.Redirect) {
                    this.state.response_message_buffer.deinit();

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

                    if (deferred_redirect) |redirect| {
                        std.debug.assert(redirect != this.redirect);
                        // connected_url no longer points to valid memory
                        redirect.release();
                    }
                    this.connected_url = URL{};
                    this.doRedirect();
                    return;
                }

                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            this.cloneMetadata();

            if (!can_continue) {
                // if is chuncked but no body is expected we mark the last chunk
                this.state.received_last_chunk = true;
                // if is not we ignore the content_length
                this.state.content_length = 0;
                this.progressUpdate(is_ssl, ctx, socket);
                return;
            }

            if (this.proxy_tunneling and this.proxy_tunnel == null) {
                this.startProxyHandshake(is_ssl, socket);
                return;
            }

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
                this.setTimeout(socket, 500);
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
            this.setTimeout(socket, 60);

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
            this.setTimeout(socket, 500);

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
            this.setTimeout(socket, 60);
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
            this.setTimeout(socket, 60);

            // put more data into SSL
            const proxy = this.proxy_tunnel orelse return;
            _ = proxy.in_bio.write(incoming_data) catch 0;

            //retry again!
            this.retryProxyHandshake(is_ssl, socket);
            return;
        },
        else => {
            this.state.pending_response = .{};
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
    const result = this.toResult(this.cloned_metadata);
    this.state.reset();
    this.proxy_tunneling = false;

    callback.run(result);
}

// We have to clone metadata immediately after use
fn cloneMetadata(this: *HTTPClient) void {
    var builder_ = StringBuilder{};
    var builder = &builder_;
    this.state.pending_response.count(builder);
    builder.count(this.url.href);
    builder.allocate(bun.default_allocator) catch unreachable;
    var headers_buf = bun.default_allocator.alloc(picohttp.Header, this.state.pending_response.headers.len) catch unreachable;
    const response = this.state.pending_response.clone(headers_buf, builder);

    this.state.pending_response = response;

    const href = builder.append(this.url.href);
    this.cloned_metadata = .{
        .owned_buf = builder.ptr.?[0..builder.cap],
        .response = response,
        .url = href,
    };
}

pub fn setTimeout(this: *HTTPClient, socket: anytype, amount: c_uint) void {
    if (this.disable_timeout) {
        socket.timeout(0);
        return;
    }

    socket.timeout(amount);
}

pub fn progressUpdate(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.state.stage != .done and this.state.stage != .fail) {
        const is_done = this.state.isDone();

        if (this.signals.aborted != null and is_done) {
            _ = socket_async_http_abort_tracker.swapRemove(this.async_http_id);
        }

        log("progressUpdate {}", .{is_done});

        var out_str = this.state.body_out_str.?;
        var body = out_str.*;
        this.cloned_metadata.response = this.state.pending_response;
        const result = this.toResult(this.cloned_metadata);
        const callback = this.result_callback;

        if (is_done) {
            socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, NewHTTPContext(is_ssl).ActiveSocket.init(&dead_socket).ptr());

            if (this.state.allow_keepalive and !this.disable_keepalive and !socket.isClosed() and FeatureFlags.enable_keepalive) {
                ctx.releaseSocket(
                    socket,
                    this.connected_url.hostname,
                    this.connected_url.getPortAuto(),
                );
            } else if (!socket.isClosed()) {
                socket.close(0, null);
            }

            this.state.reset();
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

    metadata: ?ResultMetadata = null,

    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: BodySize = .unknown,
    redirected: bool = false,

    pub const ResultMetadata = struct {
        response: picohttp.Response = .{},
        metadata_buf: []u8 = &.{},
        href: []const u8 = "",
        headers_buf: []picohttp.Header = &.{},

        pub fn deinit(this: *ResultMetadata) void {
            if (this.metadata_buf.len > 0) bun.default_allocator.free(this.metadata_buf);
            if (this.headers_buf.len > 0) bun.default_allocator.free(this.headers_buf);
            this.headers_buf = &.{};
            this.metadata_buf = &.{};
            this.href = "";
            this.response.headers = &.{};
            this.response.status = "";
        }
    };

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
                    var casted = @as(Type, @ptrCast(@alignCast(ptr)));
                    @call(.always_inline, callback, .{ casted, result });
                }
            };
        }
    };
};

pub fn toResult(this: *HTTPClient, metadata: HTTPResponseMetadata) HTTPClientResult {
    const body_size: HTTPClientResult.BodySize = if (this.state.isChunkedEncoding())
        .{ .total_received = this.state.total_body_received }
    else if (this.state.content_length) |content_length|
        .{ .content_length = content_length }
    else
        .{ .unknown = {} };
    if (!this.state.metadata_sent) {
        this.state.metadata_sent = true;
        return HTTPClientResult{
            .metadata = .{
                .response = metadata.response,
                .metadata_buf = metadata.owned_buf,
                .href = metadata.url,
                .headers_buf = metadata.response.headers,
            },
            .body = this.state.body_out_str,
            .redirected = this.remaining_redirect_count != default_redirect_count,
            .fail = this.state.fail,
            .has_more = this.state.fail == error.NoError and !this.state.isDone(),
            .body_size = body_size,
        };
    }
    return HTTPClientResult{
        .body = this.state.body_out_str,
        .metadata = null,
        .fail = this.state.fail,
        .has_more = this.state.fail == error.NoError and !this.state.isDone(),
        .body_size = body_size,
    };
}

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const preallocate_max = 1024 * 1024 * 256;

pub fn handleResponseBody(this: *HTTPClient, incoming_data: []const u8, is_only_buffer: bool) !bool {
    std.debug.assert(this.state.transfer_encoding == .identity);
    const content_length = this.state.content_length orelse 0;
    // is it exactly as much as we need?
    if (is_only_buffer and incoming_data.len >= content_length) {
        try handleResponseBodyFromSinglePacket(this, incoming_data[0..content_length]);
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

        try this.state.decompressConst(incoming_data, body_buffer);
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

    _ = this.state.postProcessBody();
}

fn handleResponseBodyFromMultiplePackets(this: *HTTPClient, incoming_data: []const u8) !bool {
    var buffer = this.state.getBodyBuffer();
    const content_length = this.state.content_length orelse 0;

    if (buffer.list.items.len == 0 and
        content_length > 0 and incoming_data.len < preallocate_max)
    {
        buffer.list.ensureTotalCapacityPrecise(buffer.allocator, incoming_data.len) catch {};
    }

    const remaining_content_length = content_length -| this.state.total_body_received;
    var remainder = incoming_data[0..@min(incoming_data.len, remaining_content_length)];

    _ = try buffer.write(remainder);

    this.state.total_body_received += remainder.len;

    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(this.state.total_body_received);
        progress.context.maybeRefresh();
    }

    // done or streaming
    const is_done = this.state.total_body_received >= content_length;
    if (is_done or this.signals.get(.body_streaming)) {
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
    var buffer_ = this.state.getBodyBuffer();
    var buffer = buffer_.*;
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

    buffer_.* = buffer;

    switch (pret) {
        // Invalid HTTP response body
        -1 => {
            return error.InvalidHTTPResponse;
        },
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
        buffer = bun.constStrToU8(incoming_data);
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

pub fn handleResponseMetadata(
    this: *HTTPClient,
    response: picohttp.Response,
    deferred_redirect: *?*URLBufferPool.Node,
) !bool {
    var location: string = "";
    var pretend_304 = false;
    for (response.headers, 0..) |header, header_i| {
        switch (hashHeaderName(header.name)) {
            hashHeaderConst("Content-Length") => {
                const content_length = std.fmt.parseInt(usize, header.value, 10) catch 0;
                if (this.method.hasBody()) {
                    this.state.content_length = content_length;
                } else {
                    // ignore body size for HEAD requests
                    this.state.content_length = content_length;
                }
            },
            hashHeaderConst("Content-Encoding") => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    this.state.encoding = Encoding.gzip;
                    this.state.content_encoding_i = @as(u8, @truncate(header_i));
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    this.state.encoding = Encoding.deflate;
                    this.state.content_encoding_i = @as(u8, @truncate(header_i));
                }
            },
            hashHeaderConst("Transfer-Encoding") => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    this.state.transfer_encoding = Encoding.gzip;
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    this.state.transfer_encoding = Encoding.deflate;
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
        printResponse(response);
    }

    this.state.pending_response = response;
    if (pretend_304) {
        this.state.pending_response.status_code = 304;
    }

    if (this.proxy_tunneling and this.proxy_tunnel == null) {
        if (this.state.pending_response.status_code == 200) {
            //signal to continue the proxing
            return true;
        }

        //proxy denied connection so return proxy result (407, 403 etc)
        this.proxy_tunneling = false;
    }

    const is_redirect = this.state.pending_response.status_code >= 300 and this.state.pending_response.status_code <= 399;
    if (is_redirect) {
        if (this.redirect_type == FetchRedirect.follow and location.len > 0 and this.remaining_redirect_count > 0) {
            switch (this.state.pending_response.status_code) {
                302, 301, 307, 308, 303 => {
                    if (strings.indexOf(location, "://")) |i| {
                        var url_buf = URLBufferPool.get(default_allocator);

                        const is_protocol_relative = i == 0;
                        const protocol_name = if (is_protocol_relative) this.url.displayProtocol() else location[0..i];
                        const is_http = strings.eqlComptime(protocol_name, "http");
                        if (is_http or strings.eqlComptime(protocol_name, "https")) {} else {
                            return error.UnsupportedRedirectProtocol;
                        }

                        if ((protocol_name.len * @as(usize, @intFromBool(is_protocol_relative))) + location.len > url_buf.data.len) {
                            return error.RedirectURLTooLong;
                        }

                        deferred_redirect.* = this.redirect;
                        var url_buf_len = location.len;
                        if (is_protocol_relative) {
                            if (is_http) {
                                url_buf.data[0.."http".len].* = "http".*;
                                bun.copy(u8, url_buf.data["http".len..], location);
                                url_buf_len += "http".len;
                            } else {
                                url_buf.data[0.."https".len].* = "https".*;
                                bun.copy(u8, url_buf.data["https".len..], location);
                                url_buf_len += "https".len;
                            }
                        } else {
                            bun.copy(u8, &url_buf.data, location);
                        }

                        this.url = URL.parse(url_buf.data[0..url_buf_len]);
                        this.redirect = url_buf;
                    } else if (strings.hasPrefixComptime(location, "//")) {
                        var url_buf = URLBufferPool.get(default_allocator);

                        const protocol_name = this.url.displayProtocol();

                        if (protocol_name.len + 1 + location.len > url_buf.data.len) {
                            return error.RedirectURLTooLong;
                        }

                        deferred_redirect.* = this.redirect;
                        var url_buf_len = location.len;

                        if (strings.eqlComptime(protocol_name, "http")) {
                            url_buf.data[0.."http:".len].* = "http:".*;
                            bun.copy(u8, url_buf.data["http:".len..], location);
                            url_buf_len += "http:".len;
                        } else {
                            url_buf.data[0.."https:".len].* = "https:".*;
                            bun.copy(u8, url_buf.data["https:".len..], location);
                            url_buf_len += "https:".len;
                        }

                        this.url = URL.parse(url_buf.data[0..url_buf_len]);
                        this.redirect = url_buf;
                    } else {
                        var url_buf = URLBufferPool.get(default_allocator);
                        const original_url = this.url;
                        const port = original_url.getPortAuto();

                        if (port == original_url.getDefaultPort()) {
                            this.url = URL.parse(std.fmt.bufPrint(
                                &url_buf.data,
                                "{s}://{s}{s}",
                                .{ original_url.displayProtocol(), original_url.displayHostname(), location },
                            ) catch return error.RedirectURLTooLong);
                        } else {
                            this.url = URL.parse(std.fmt.bufPrint(
                                &url_buf.data,
                                "{s}://{s}:{d}{s}",
                                .{ original_url.displayProtocol(), original_url.displayHostname(), port, location },
                            ) catch return error.RedirectURLTooLong);
                        }

                        deferred_redirect.* = this.redirect;
                        this.redirect = url_buf;
                    }

                    // Note: RFC 1945 and RFC 2068 specify that the client is not allowed to change
                    // the method on the redirected request. However, most existing user agent
                    // implementations treat 302 as if it were a 303 response, performing a GET on
                    // the Location field-value regardless of the original request method. The
                    // status codes 303 and 307 have been added for servers that wish to make
                    // unambiguously clear which kind of reaction is expected of the client.
                    if (response.status_code == 302) {
                        switch (this.method) {
                            .GET, .HEAD => {},
                            else => {
                                this.method = .GET;
                            },
                        }
                    }

                    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/303
                    if (response.status_code == 303 and this.method != .HEAD) {
                        this.method = .GET;
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

    // if is no redirect or if is redirect == "manual" just proceed
    this.state.response_stage = if (this.state.transfer_encoding == .chunked) .body_chunk else .body;
    const content_length = this.state.content_length orelse 0;
    // if no body is expected we should stop processing
    return this.method.hasBody() and (content_length > 0 or this.state.transfer_encoding == .chunked);
}
