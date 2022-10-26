const picohttp = @import("picohttp");
const bun = @import("./global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const stringZ = bun.stringZ;
const C = bun.C;
const std = @import("std");
const URL = @import("./url.zig").URL;
pub const Method = @import("./http/method.zig").Method;
const Api = @import("./api/schema.zig").Api;
const Lock = @import("./lock.zig").Lock;
const HTTPClient = @This();
const Zlib = @import("./zlib.zig");
const StringBuilder = @import("./string_builder.zig");
const AsyncIO = @import("io");
const ThreadPool = @import("thread_pool");
const BoringSSL = @import("boringssl");
pub const NetworkThread = @import("./network_thread.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;
const SOCK = os.SOCK;
const Arena = @import("./mimalloc_arena.zig").Arena;
const ZlibPool = @import("./http/zlib.zig");
const URLBufferPool = ObjectPool([4096]u8, null, false, 10);
const uws = @import("uws");
pub const MimeType = @import("./http/mime_type.zig");
pub const URLPath = @import("./http/url_path.zig");
// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
pub var default_arena: Arena = undefined;
pub var http_thread: HTTPThread = undefined;
const HiveArray = @import("./hive_array.zig").HiveArray;
const Batch = NetworkThread.Batch;
const TaggedPointerUnion = @import("./tagged_pointer.zig").TaggedPointerUnion;
const DeadSocket = opaque {};
var dead_socket = @intToPtr(*DeadSocket, 1);

const print_every = 0;
var print_every_i: usize = 0;

// we always rewrite the entire HTTP request when write() returns EAGAIN
// so we can reuse this buffer
var shared_request_headers_buf: [256]picohttp.Header = undefined;

// this doesn't need to be stack memory because it is immediately cloned after use
var shared_response_headers_buf: [256]picohttp.Header = undefined;

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
        const ssl_int = @as(c_int, @boolToInt(ssl));

        const MAX_KEEPALIVE_HOSTNAME = 128;

        pub fn sslCtx(this: *@This()) *BoringSSL.SSL_CTX {
            if (comptime !ssl) {
                unreachable;
            }

            return @ptrCast(*BoringSSL.SSL_CTX, this.us_socket_context.getNativeHandle(true));
        }

        pub fn init(this: *@This()) !void {
            var opts: uws.us_socket_context_options_t = undefined;
            @memset(@ptrCast([*]u8, &opts), 0, @sizeOf(uws.us_socket_context_options_t));
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
                    @memcpy(&pending.hostname_buf, hostname.ptr, hostname.len);
                    pending.hostname_len = @truncate(u8, hostname.len);
                    pending.port = port;

                    log("- Keep-Alive release {s}:{d}", .{ hostname, port });
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
                var tagged = ActiveSocket.from(bun.cast(**anyopaque, ptr).*);
                socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, ActiveSocket.init(dead_socket).ptr());

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
                var socket = this.pending_sockets.at(@intCast(u16, pending_socket_index));
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

        pub fn connect(this: *@This(), client: *HTTPClient, hostname: []const u8, port: u16) !HTTPSocket {
            // const hostname = if (FeatureFlags.hardcode_localhost_to_127_0_0_1 and strings.eqlComptime(hostname_, "localhost"))
            //     "127.0.0.1"
            // else
            //     hostname_;

            client.connected_url = client.url;
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

pub const HTTPThread = struct {
    var http_thread_loaded: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false);

    loop: *uws.Loop,
    http_context: NewHTTPContext(false),
    https_context: NewHTTPContext(true),

    queued_tasks: Queue = Queue{},
    has_awoken: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
    timer: std.time.Timer = undefined,
    const threadlog = Output.scoped(.HTTPThread, true);

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

        var thread = try std.Thread.spawn(.{
            .stack_size = 4 * 1024 * 1024,
        }, onStart, .{});
        thread.detach();
    }

    pub fn onStart() void {
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
        return try this.context(is_ssl).connect(client, client.url.hostname, client.url.getPortAuto());
    }

    pub fn context(this: *@This(), comptime is_ssl: bool) *NewHTTPContext(is_ssl) {
        return if (is_ssl) &this.https_context else &this.http_context;
    }

    fn drainEvents(this: *@This()) void {
        var count: usize = 0;
        var remaining: usize = AsyncHTTP.max_simultaneous_requests - AsyncHTTP.active_requests_count.loadUnchecked();
        if (remaining == 0) return;
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

            remaining -= 1;
            if (remaining == 0) break;
        }
    }

    fn processEvents_(this: *@This()) void {
        this.loop.num_polls = @maximum(2, this.loop.num_polls);

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
                threadlog("Waited {any}\n", .{std.fmt.fmtDurationSigned(@truncate(i64, end - start_time))});
                Output.flush();
            }
        }
    }

    pub fn processEvents(this: *@This()) void {
        processEvents_(this);
        unreachable;
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
        std.debug.assert(is_ssl == client.url.isHTTPS());
    }

    log("Connected {s} \n", .{client.url.href});

    if (comptime is_ssl) {
        var ssl: *BoringSSL.SSL = @ptrCast(*BoringSSL.SSL, socket.getNativeHandle());
        if (!ssl.isInitFinished()) {
            var hostname: [:0]u8 = "";
            var hostname_needs_free = false;
            if (!strings.isIPAddress(client.url.hostname)) {
                if (client.url.hostname.len < temp_hostname.len) {
                    @memcpy(&temp_hostname, client.url.hostname.ptr, client.url.hostname.len);
                    temp_hostname[client.url.hostname.len] = 0;
                    hostname = temp_hostname[0..client.url.hostname.len :0];
                } else {
                    hostname = bun.default_allocator.dupeZ(u8, client.url.hostname) catch unreachable;
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
    _ = socket;
    log("Closed  {s}\n", .{client.url.href});

    const in_progress = client.state.stage != .done and client.state.stage != .fail;

    // if the peer closed after a full chunk, treat this
    // as if the transfer had complete, browsers appear to ignore
    // a missing 0\r\n chunk
    if (in_progress and client.state.transfer_encoding == .chunked) {
        if (picohttp.phr_decode_chunked_is_in_data(&client.state.chunked_decoder) == 0) {
            if (client.state.compressed_body orelse client.state.body_out_str) |body| {
                if (body.list.items.len > 0) {
                    client.done(comptime is_ssl, if (is_ssl) &http_thread.https_context else &http_thread.http_context, socket);
                    return;
                }
            }
        }
    }

    if (client.allow_retry) {
        client.allow_retry = false;
        client.start(client.state.request_body, client.state.body_out_str.?);
        return;
    }

    if (in_progress)
        client.fail(error.ConnectionClosed);
}
pub fn onTimeout(
    client: *HTTPClient,
    comptime is_ssl: bool,
    socket: NewHTTPContext(is_ssl).HTTPSocket,
) void {
    _ = socket;
    log("Timeout  {s}\n", .{client.url.href});

    if (client.state.stage != .done and client.state.stage != .fail)
        client.fail(error.Timeout);
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

fn writeRequest(
    comptime Writer: type,
    writer: Writer,
    request: picohttp.Request,
    // header_hashes: []u64,
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
};

pub const InternalState = struct {
    request_message: ?*BodyPreamblePool.Node = null,
    pending_response: picohttp.Response = undefined,
    allow_keepalive: bool = true,
    transfer_encoding: Encoding = Encoding.identity,
    encoding: Encoding = Encoding.identity,
    content_encoding_i: u8 = std.math.maxInt(u8),
    chunked_decoder: picohttp.phr_chunked_decoder = .{},
    stage: Stage = Stage.pending,
    body_out_str: ?*MutableString = null,
    compressed_body: ?*MutableString = null,
    body_size: usize = 0,
    request_body: []const u8 = "",
    request_sent_len: usize = 0,
    fail: anyerror = error.NoError,
    request_stage: HTTPStage = .pending,
    response_stage: HTTPStage = .pending,

    pub fn reset(this: *InternalState) void {
        if (this.request_message) |msg| {
            msg.release();
            this.request_message = null;
        }

        if (this.compressed_body) |body| {
            ZlibPool.instance.put(body) catch unreachable;
            this.compressed_body = null;
        }

        var body_msg = this.body_out_str;
        this.* = .{
            .body_out_str = body_msg,
        };
    }

    pub fn getBodyBuffer(this: *InternalState) *MutableString {
        switch (this.encoding) {
            Encoding.gzip, Encoding.deflate => {
                if (this.compressed_body == null) {
                    if (!ZlibPool.loaded) {
                        ZlibPool.instance = ZlibPool.init(default_allocator);
                        ZlibPool.loaded = true;
                    }

                    this.compressed_body = ZlibPool.instance.get() catch unreachable;
                }

                return this.compressed_body.?;
            },
            else => {
                return this.body_out_str.?;
            },
        }
    }

    pub fn processBodyBuffer(this: *InternalState, buffer: MutableString) !void {
        var body_out_str = this.body_out_str.?;
        var buffer_ = this.getBodyBuffer();
        buffer_.* = buffer;

        switch (this.encoding) {
            Encoding.gzip, Encoding.deflate => {
                var gzip_timer: std.time.Timer = undefined;

                if (extremely_verbose)
                    gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

                body_out_str.list.expandToCapacity();
                defer ZlibPool.instance.put(buffer_) catch unreachable;
                ZlibPool.decompress(buffer.list.items, body_out_str) catch |err| {
                    Output.prettyErrorln("<r><red>Zlib error<r>", .{});
                    Output.flush();
                    return err;
                };

                if (extremely_verbose)
                    this.gzip_elapsed = gzip_timer.read();
            },
            else => {},
        }

        var response = &this.pending_response;
        // if it compressed with this header, it is no longer
        if (this.content_encoding_i < response.headers.len) {
            var mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers, .capacity = response.headers.len };
            _ = mutable_headers.orderedRemove(this.content_encoding_i);
            response.headers = mutable_headers.items;
            this.content_encoding_i = std.math.maxInt(@TypeOf(this.content_encoding_i));
        }

        this.body_size = @truncate(usize, body_out_str.list.items.len);
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
redirect: ?*URLBufferPool.Node = null,
timeout: usize = 0,
progress_node: ?*std.Progress.Node = null,
received_keep_alive: bool = false,

disable_timeout: bool = false,
disable_keepalive: bool = false,

state: InternalState = .{},

completion_callback: HTTPClientResult.Callback = undefined,

/// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
/// This is a workaround for that.
force_last_modified: bool = false,
if_modified_since: string = "",
request_content_len_buf: ["-4294967295".len]u8 = undefined,

cloned_metadata: HTTPResponseMetadata = .{},

pub fn init(
    allocator: std.mem.Allocator,
    method: Method,
    url: URL,
    header_entries: Headers.Entries,
    header_buf: string,
) HTTPClient {
    return HTTPClient{
        .allocator = allocator,
        .method = method,
        .url = url,
        .header_entries = header_entries,
        .header_buf = header_buf,
    };
}

pub fn deinit(this: *HTTPClient) void {
    if (this.redirect) |redirect| {
        redirect.release();
        this.redirect = null;
    }
}

const Stage = enum(u8) {
    pending,
    connect,
    done,
    fail,
};

// threadlocal var resolver_cache
const tcp = std.x.net.tcp;
const ip = std.x.net.ip;

const IPv4 = std.x.os.IPv4;
const IPv6 = std.x.os.IPv6;
const Socket = std.x.os.Socket;
const os = std.os;

// lowercase hash header names so that we can be sure
pub fn hashHeaderName(name: string) u64 {
    var hasher = std.hash.Wyhash.init(0);
    var remain: string = name;
    var buf: [32]u8 = undefined;
    var buf_slice: []u8 = std.mem.span(&buf);

    while (remain.len > 0) {
        const end = @minimum(hasher.buf.len, remain.len);

        hasher.update(strings.copyLowercase(std.mem.span(remain[0..end]), buf_slice));
        remain = remain[end..];
    }

    return hasher.final();
}

const host_header_hash = hashHeaderName("Host");
const connection_header_hash = hashHeaderName("Connection");

pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    chunked,
};

const content_encoding_hash = hashHeaderName("Content-Encoding");
const transfer_encoding_header = hashHeaderName("Transfer-Encoding");

const host_header_name = "Host";
const content_length_header_name = "Content-Length";
const content_length_header_hash = hashHeaderName("Content-Length");
const connection_header = picohttp.Header{ .name = "Connection", .value = "keep-alive" };
const connection_closing_header = picohttp.Header{ .name = "Connection", .value = "close" };
const accept_header = picohttp.Header{ .name = "Accept", .value = "*/*" };
const accept_header_hash = hashHeaderName("Accept");

const accept_encoding_no_compression = "identity";
const accept_encoding_compression = "deflate, gzip";
const accept_encoding_header_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_compression };
const accept_encoding_header_no_compression = picohttp.Header{ .name = "Accept-Encoding", .value = accept_encoding_no_compression };

const accept_encoding_header = if (FeatureFlags.disable_compression_in_http_client)
    accept_encoding_header_no_compression
else
    accept_encoding_header_compression;

const accept_encoding_header_hash = hashHeaderName("Accept-Encoding");

const user_agent_header = picohttp.Header{ .name = "User-Agent", .value = Global.user_agent };
const user_agent_header_hash = hashHeaderName("User-Agent");
const location_header_hash = hashHeaderName("Location");

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
    request_body: []const u8 = "",
    allocator: std.mem.Allocator,
    request_header_buf: string = "",
    method: Method = Method.GET,
    max_retry_count: u32 = 0,
    url: URL,
    real: ?*AsyncHTTP = null,
    next: ?*AsyncHTTP = null,

    task: ThreadPool.Task = ThreadPool.Task{ .callback = startAsyncHTTP },
    completion_callback: HTTPClientResult.Callback = undefined,

    /// Timeout in nanoseconds
    timeout: usize = 0,
    redirected: bool = false,

    response_encoding: Encoding = Encoding.identity,
    retries_count: u32 = 0,
    verbose: bool = false,

    client: HTTPClient = undefined,
    err: ?anyerror = null,

    state: AtomicState = AtomicState.init(State.pending),
    elapsed: u64 = 0,
    gzip_elapsed: u64 = 0,

    pub var active_requests_count = std.atomic.Atomic(usize).init(0);
    pub var max_simultaneous_requests: usize = 256;

    pub fn deinit(this: *AsyncHTTP) void {
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
    ) AsyncHTTP {
        var this = AsyncHTTP{
            .allocator = allocator,
            .url = url,
            .method = method,
            .request_headers = headers,
            .request_header_buf = headers_buf,
            .request_body = request_body,
            .response_buffer = response_buffer,
            .completion_callback = callback,
        };
        this.client = HTTPClient.init(allocator, method, url, headers, headers_buf);
        this.client.timeout = timeout;
        this.timeout = timeout;
        return this;
    }

    pub fn initSync(
        allocator: std.mem.Allocator,
        method: Method,
        url: URL,
        headers: Headers.Entries,
        headers_buf: string,
        response_buffer: *MutableString,
        request_body: []const u8,
        timeout: usize,
    ) AsyncHTTP {
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
        );
    }

    fn reset(this: *AsyncHTTP) !void {
        const timeout = this.timeout;
        this.client = try HTTPClient.init(this.allocator, this.method, this.client.url, this.client.header_entries, this.client.header_buf);
        this.client.timeout = timeout;
        this.timeout = timeout;
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
        this.completion_callback = HTTPClientResult.Callback.New(
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

            return result.response;
        }

        unreachable;
    }

    pub fn onAsyncHTTPComplete(this: *AsyncHTTP, result: HTTPClientResult) void {
        std.debug.assert(this.real != null);
        const active_requests = AsyncHTTP.active_requests_count.fetchSub(1, .Monotonic);
        std.debug.assert(active_requests > 0);

        var completion = this.completion_callback;
        this.response = result.response;
        this.elapsed = http_thread.timer.read() -| this.elapsed;
        this.redirected = this.client.remaining_redirect_count != default_redirect_count;
        if (!result.isSuccess()) {
            this.err = result.fail;
            this.state.store(State.fail, .Monotonic);
        } else {
            this.err = null;
            this.state.store(.success, .Monotonic);
        }
        this.client.deinit();

        this.real.?.* = this.*;
        this.real.?.response_buffer = this.response_buffer;

        log("onAsyncHTTPComplete: {any}", .{bun.fmt.fmtDuration(this.elapsed)});

        default_allocator.destroy(this);

        completion.function(completion.ctx, result);

        if (active_requests == AsyncHTTP.max_simultaneous_requests) {
            http_thread.drainEvents();
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
        this.client.completion_callback = HTTPClientResult.Callback.New(*AsyncHTTP, onAsyncHTTPComplete).init(
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

const BodyPreambleArray = std.BoundedArray(u8, 1024 * 16);
const BodyPreamblePool = ObjectPool(BodyPreambleArray, null, false, 16);

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
    for (header_names) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            connection_header_hash,
            content_length_header_hash,
            => continue,
            hashHeaderName("if-modified-since") => {
                if (this.force_last_modified and this.if_modified_since.len == 0) {
                    this.if_modified_since = this.headerStr(header_values[i]);
                }
            },
            host_header_hash => {
                override_host_header = true;
            },
            accept_header_hash => {
                override_accept_header = true;
            },
            else => {},
        }

        override_user_agent = override_user_agent or hash == user_agent_header_hash;

        override_accept_encoding = override_accept_encoding or hash == accept_encoding_header_hash;

        request_headers_buf[header_count] = (picohttp.Header{
            .name = name,
            .value = this.headerStr(header_values[i]),
        });

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
        request_headers_buf[header_count] = picohttp.Header{
            .name = host_header_name,
            .value = this.url.hostname,
        };
        header_count += 1;
    }

    if (!override_accept_encoding) {
        request_headers_buf[header_count] = accept_encoding_header;
        header_count += 1;
    }

    if (body_len > 0) {
        request_headers_buf[header_count] = picohttp.Header{
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

    if (this.remaining_redirect_count == 0) {
        this.fail(error.TooManyRedirects);
        return;
    }
    this.state.reset();
    return this.start("", body_out_str);
}

pub fn start(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) void {
    body_out_str.reset();

    std.debug.assert(this.state.request_message == null);
    this.state = InternalState{
        .request_body = body,
        .body_out_str = body_out_str,
        .stage = Stage.pending,
        .request_message = null,
        .pending_response = picohttp.Response{},
        .compressed_body = null,
    };

    if (this.url.isHTTPS()) {
        this.start_(true);
    } else {
        this.start_(false);
    }
}

fn start_(this: *HTTPClient, comptime is_ssl: bool) void {
    var socket = http_thread.connect(this, is_ssl) catch |err| {
        this.fail(err);
        return;
    };

    if (socket.isClosed() and (this.state.response_stage != .done and this.state.response_stage != .fail)) {
        this.fail(error.ConnectionClosed);
        std.debug.assert(this.state.fail != error.NoError);
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
    switch (this.state.request_stage) {
        .pending, .headers => {
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

            if (this.verbose) {
                printRequest(request);
            }

            const headers_len = list.items.len;
            std.debug.assert(list.items.len == writer.context.items.len);
            if (this.state.request_body.len > 0 and list.capacity - list.items.len > 0) {
                var remain = list.items.ptr[list.items.len..list.capacity];
                const wrote = @minimum(remain.len, this.state.request_body.len);
                std.debug.assert(wrote > 0);
                @memcpy(remain.ptr, this.state.request_body.ptr, wrote);
                list.items.len += wrote;
            }

            const to_send = list.items[this.state.request_sent_len..];
            if (comptime Environment.allow_assert) {
                std.debug.assert(!socket.isShutdown());
                std.debug.assert(!socket.isClosed());
            }
            const amount = socket.write(to_send, false);
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

            this.state.request_sent_len += @intCast(usize, amount);
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
                this.state.request_stage = .body;
                std.debug.assert(this.state.request_body.len > 0);

                // we sent everything, but there's some body leftover
                if (amount == @intCast(c_int, to_send.len)) {
                    this.onWritable(false, is_ssl, socket);
                }
            } else {
                this.state.request_stage = .headers;
            }
        },
        .body => {
            this.setTimeout(socket, 60);

            const to_send = this.state.request_body;
            const amount = socket.write(to_send, true);
            if (amount < 0) {
                this.closeAndFail(error.WriteFailed, is_ssl, socket);
                return;
            }

            this.state.request_sent_len += @intCast(usize, amount);
            this.state.request_body = this.state.request_body[@intCast(usize, amount)..];

            if (this.state.request_body.len == 0) {
                this.state.request_stage = .done;
                return;
            }
        },
        else => {},
    }
}

pub fn closeAndFail(this: *HTTPClient, err: anyerror, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    socket.ext(**anyopaque).?.* = bun.cast(
        **anyopaque,
        NewHTTPContext(is_ssl).ActiveSocket.init(&dead_socket).ptr(),
    );
    this.fail(err);
    socket.close(0, null);
}

pub fn onData(this: *HTTPClient, comptime is_ssl: bool, incoming_data: []const u8, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    switch (this.state.response_stage) {
        .pending, .headers => {
            var to_read = incoming_data;
            var pending_buffers: [2]string = .{ "", "" };
            var amount_read: usize = 0;
            var needs_move = true;
            if (this.state.request_message) |req_msg| {
                var available = req_msg.data.unusedCapacitySlice();
                if (available.len == 0) {
                    this.state.request_message.?.release();
                    this.state.request_message = null;
                    this.closeAndFail(error.ResponseHeaderTooLarge, is_ssl, socket);
                    return;
                }

                const to_read_len = @minimum(available.len, to_read.len);
                req_msg.data.appendSliceAssumeCapacity(to_read[0..to_read_len]);
                to_read = req_msg.data.slice();
                pending_buffers[1] = incoming_data[to_read_len..];
                needs_move = pending_buffers[1].len > 0;
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
                                this.state.request_message = this.state.request_message orelse brk: {
                                    var preamble = BodyPreamblePool.get(getAllocator());
                                    preamble.data = .{};
                                    break :brk preamble;
                                };
                                this.state.request_message.?.data.appendSlice(to_copy) catch {
                                    this.closeAndFail(error.ResponseHeadersTooLarge, is_ssl, socket);
                                    return;
                                };
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

            pending_buffers[0] = to_read[@minimum(@intCast(usize, response.bytes_read), to_read.len)..];
            if (pending_buffers[0].len == 0 and pending_buffers[1].len > 0) {
                pending_buffers[0] = pending_buffers[1];
                pending_buffers[1] = "";
            }

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
                    if (this.state.request_message) |msg| {
                        msg.release();
                        this.state.request_message = null;
                    }

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
                this.done(is_ssl, ctx, socket);
                return;
            }

            if (pending_buffers[0].len == 0) {
                return;
            }

            if (this.state.response_stage == .body) {
                {
                    const is_done = this.handleResponseBody(pending_buffers[0]) catch |err| {
                        this.closeAndFail(err, is_ssl, socket);
                        return;
                    };

                    if (is_done) {
                        this.done(is_ssl, ctx, socket);
                        return;
                    }
                }

                if (pending_buffers[1].len > 0) {
                    const is_done = this.handleResponseBody(pending_buffers[1]) catch |err| {
                        this.closeAndFail(err, is_ssl, socket);
                        return;
                    };

                    if (is_done) {
                        this.done(is_ssl, ctx, socket);
                        return;
                    }
                }
            } else if (this.state.response_stage == .body_chunk) {
                this.setTimeout(socket, 500);
                {
                    const is_done = this.handleResponseBodyChunk(pending_buffers[0]) catch |err| {
                        this.closeAndFail(err, is_ssl, socket);
                        return;
                    };

                    if (is_done) {
                        this.done(is_ssl, ctx, socket);
                        return;
                    }
                }

                if (pending_buffers[1].len > 0) {
                    const is_done = this.handleResponseBodyChunk(pending_buffers[1]) catch |err| {
                        this.closeAndFail(err, is_ssl, socket);
                        return;
                    };

                    if (is_done) {
                        this.done(is_ssl, ctx, socket);
                        return;
                    }
                }

                this.setTimeout(socket, 60);
            }
        },

        .body => {
            this.setTimeout(socket, 60);

            const is_done = this.handleResponseBody(incoming_data) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (is_done) {
                this.done(is_ssl, ctx, socket);
                return;
            }
        },

        .body_chunk => {
            this.setTimeout(socket, 500);

            const is_done = this.handleResponseBodyChunk(incoming_data) catch |err| {
                this.closeAndFail(err, is_ssl, socket);
                return;
            };

            if (is_done) {
                this.done(is_ssl, ctx, socket);
                return;
            }
        },

        .fail => {},

        else => {
            this.state.pending_response = .{};
            this.closeAndFail(error.UnexpectedData, is_ssl, socket);
            return;
        },
    }
}

fn fail(this: *HTTPClient, err: anyerror) void {
    this.state.request_stage = .fail;
    this.state.response_stage = .fail;
    this.state.fail = err;
    this.state.stage = .fail;

    const callback = this.completion_callback;
    const result = this.toResult(this.cloned_metadata);
    this.state.reset();
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

pub fn done(this: *HTTPClient, comptime is_ssl: bool, ctx: *NewHTTPContext(is_ssl), socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    var out_str = this.state.body_out_str.?;
    var body = out_str.*;
    this.cloned_metadata.response = this.state.pending_response;
    const result = this.toResult(this.cloned_metadata);
    const callback = this.completion_callback;

    this.state.response_stage = .done;
    this.state.request_stage = .done;
    this.state.stage = .done;

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
    result.body.?.* = body;
    std.debug.assert(this.state.stage != .done);
    this.state.response_stage = .done;
    this.state.request_stage = .done;
    this.state.stage = .done;
    if (comptime print_every > 0) {
        print_every_i += 1;
        if (print_every_i % print_every == 0) {
            Output.prettyln("Heap stats for HTTP thread\n", .{});
            Output.flush();
            default_arena.dumpThreadStats();
            print_every_i = 0;
        }
    }
    callback.run(result);
}

pub const HTTPClientResult = struct {
    body: ?*MutableString = null,
    response: picohttp.Response = .{},
    metadata_buf: []u8 = &.{},
    href: []const u8 = "",
    fail: anyerror = error.NoError,
    redirected: bool = false,
    headers_buf: []picohttp.Header = &.{},

    pub fn isSuccess(this: *const HTTPClientResult) bool {
        return this.fail == error.NoError;
    }

    pub fn deinitMetadata(this: *HTTPClientResult) void {
        if (this.metadata_buf.len > 0) bun.default_allocator.free(this.metadata_buf);
        if (this.headers_buf.len > 0) bun.default_allocator.free(this.headers_buf);

        this.headers_buf = &.{};
        this.metadata_buf = &.{};
        this.href = "";
        this.response.headers = &.{};
        this.response.status = "";
    }

    pub const Callback = struct {
        ctx: *anyopaque,
        function: Function,

        pub const Function = fn (*anyopaque, HTTPClientResult) void;

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
                    var casted = @ptrCast(Type, @alignCast(std.meta.alignment(Type), ptr));
                    @call(.{ .modifier = .always_inline }, callback, .{ casted, result });
                }
            };
        }
    };
};

pub fn toResult(this: *HTTPClient, metadata: HTTPResponseMetadata) HTTPClientResult {
    return HTTPClientResult{
        .body = this.state.body_out_str,
        .response = metadata.response,
        .metadata_buf = metadata.owned_buf,
        .redirected = this.remaining_redirect_count != default_redirect_count,
        .href = metadata.url,
        .fail = this.state.fail,
        .headers_buf = metadata.response.headers,
    };
}

// preallocate a buffer for the body no more than 256 MB
// the intent is to avoid an OOM caused by a malicious server
// reporting gigantic Conten-Length and then
// never finishing sending the body
const preallocate_max = 1024 * 1024 * 256;

pub fn handleResponseBody(this: *HTTPClient, incoming_data: []const u8) !bool {
    var buffer = this.state.getBodyBuffer();

    if (buffer.list.items.len == 0 and
        this.state.body_size > 0 and this.state.body_size < preallocate_max)
    {
        // since we don't do streaming yet, we might as well just allocate the whole thing
        // when we know the expected size
        buffer.list.ensureTotalCapacityPrecise(buffer.allocator, this.state.body_size) catch {};
    }

    const remaining_content_length = this.state.body_size - buffer.list.items.len;
    var remainder = incoming_data[0..@minimum(incoming_data.len, remaining_content_length)];

    _ = try buffer.write(remainder);

    if (this.progress_node) |progress| {
        progress.activate();
        progress.setCompletedItems(buffer.list.items.len);
        progress.context.maybeRefresh();
    }

    if (buffer.list.items.len == this.state.body_size) {
        try this.state.processBodyBuffer(buffer.*);

        if (this.progress_node) |progress| {
            progress.activate();
            progress.setCompletedItems(buffer.list.items.len);
            progress.context.maybeRefresh();
        }
        return true;
    }

    return false;
}

pub fn handleResponseBodyChunk(
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
        buffer.list.items.ptr + (buffer.list.items.len - incoming_data.len),
        &bytes_decoded,
    );
    buffer.list.items.len -|= incoming_data.len - bytes_decoded;

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

            if (this.state.compressed_body) |compressed| {
                compressed.* = buffer;
            } else {
                this.state.body_out_str.?.* = buffer;
            }
            return false;
        },
        // Done
        else => {
            try this.state.processBodyBuffer(
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

pub fn handleResponseMetadata(
    this: *HTTPClient,
    response: picohttp.Response,
    deferred_redirect: *?*URLBufferPool.Node,
) !bool {
    var location: string = "";
    var pretend_304 = false;
    for (response.headers) |header, header_i| {
        switch (hashHeaderName(header.name)) {
            content_length_header_hash => {
                const content_length = std.fmt.parseInt(@TypeOf(this.state.body_size), header.value, 10) catch 0;
                this.state.body_size = content_length;
            },
            content_encoding_hash => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    this.state.encoding = Encoding.gzip;
                    this.state.content_encoding_i = @truncate(u8, header_i);
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    this.state.encoding = Encoding.deflate;
                    this.state.content_encoding_i = @truncate(u8, header_i);
                } else if (!strings.eqlComptime(header.value, "identity")) {
                    return error.UnsupportedContentEncoding;
                }
            },
            transfer_encoding_header => {
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
            location_header_hash => {
                location = header.value;
            },
            hashHeaderName("Connection") => {
                if (response.status_code >= 200 and response.status_code <= 299) {
                    if (!strings.eqlComptime(header.value, "keep-alive")) {
                        this.state.allow_keepalive = false;
                    }
                }
            },
            hashHeaderName("Last-Modified") => {
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

    if (location.len > 0 and this.remaining_redirect_count > 0) {
        switch (this.state.pending_response.status_code) {
            302, 301, 307, 308, 303 => {
                if (strings.indexOf(location, "://")) |i| {
                    var url_buf = URLBufferPool.get(default_allocator);

                    const protocol_name = location[0..i];
                    if (strings.eqlComptime(protocol_name, "http") or strings.eqlComptime(protocol_name, "https")) {} else {
                        return error.UnsupportedRedirectProtocol;
                    }

                    if (location.len > url_buf.data.len) {
                        return error.RedirectURLTooLong;
                    }

                    deferred_redirect.* = this.redirect;
                    std.mem.copy(u8, &url_buf.data, location);
                    this.url = URL.parse(url_buf.data[0..location.len]);
                    this.redirect = url_buf;
                } else {
                    var url_buf = URLBufferPool.get(default_allocator);
                    const original_url = this.url;
                    this.url = URL.parse(std.fmt.bufPrint(
                        &url_buf.data,
                        "{s}://{s}{s}",
                        .{ original_url.displayProtocol(), original_url.displayHostname(), location },
                    ) catch return error.RedirectURLTooLong);

                    deferred_redirect.* = this.redirect;
                    this.redirect = url_buf;
                }

                // Ensure we don't up ove

                // https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/303
                if (response.status_code == 303) {
                    this.method = .GET;
                }

                return error.Redirect;
            },
            else => {},
        }
    }

    this.state.response_stage = if (this.state.transfer_encoding == .chunked) .body_chunk else .body;

    return this.method.hasBody() and (this.state.body_size > 0 or this.state.transfer_encoding == .chunked);
}

// // zig test src/http_client.zig --test-filter "sendHTTP - only" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
// test "sendHTTP - only" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     // headers.appendHeader("X-What", "ok", true, true, false);
//     headers.appendHeader("Accept-Encoding", "identity", true, true, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("http://example.com/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.sendHTTP("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqual(body_out_str.list.items.len, 1256);
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }

// // zig test src/http_client.zig --test-filter "sendHTTP - gzip" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
// test "sendHTTP - gzip" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     // headers.appendHeader("X-What", "ok", true, true, false);
//     headers.appendHeader("Accept-Encoding", "gzip", true, true, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("http://example.com/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.sendHTTP("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }

// // zig test src/http_client.zig --test-filter "sendHTTPS - identity" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test --test-no-exec
// test "sendHTTPS - identity" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     headers.appendHeader("X-What", "ok", true, true, false);
//     headers.appendHeader("Accept-Encoding", "identity", true, true, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("https://example.com/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.sendHTTPS("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }

// test "sendHTTPS - gzip" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     headers.appendHeader("Accept-Encoding", "gzip", false, false, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("https://example.com/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.sendHTTPS("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }

// // zig test src/http_client.zig --test-filter "sendHTTPS - deflate" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test
// test "sendHTTPS - deflate" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     headers.appendHeader("Accept-Encoding", "deflate", false, false, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("https://example.com/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.sendHTTPS("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }

// // zig test src/http_client.zig --test-filter "sendHTTP" -lc -lc++ /Users/jarred/Code/bun/src/deps/zlib/libz.a /Users/jarred/Code/bun/src/deps/picohttpparser.o --cache-dir /Users/jarred/Code/bun/zig-cache --global-cache-dir /Users/jarred/.cache/zig --name bun --pkg-begin clap /Users/jarred/Code/bun/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin picohttp /Users/jarred/Code/bun/src/deps/picohttp.zig --pkg-end --pkg-begin iguanaTLS /Users/jarred/Code/bun/src/deps/iguanaTLS/src/main.zig --pkg-end -I /Users/jarred/Code/bun/src/deps -I /Users/jarred/Code/bun/src/deps/mimalloc -I /usr/local/opt/icu4c/include  -L src/deps/mimalloc -L /usr/local/opt/icu4c/lib --main-pkg-path /Users/jarred/Code/bun --enable-cache -femit-bin=zig-out/bin/test

// test "send - redirect" {
//     Output.initTest();
//     defer Output.flush();

//     var headers = try std.heap.c_allocator.create(Headers);
//     headers.* = Headers{
//         .entries = @TypeOf(headers.entries){},
//         .buf = @TypeOf(headers.buf){},
//         .used = 0,
//         .allocator = std.heap.c_allocator,
//     };

//     headers.appendHeader("Accept-Encoding", "gzip", false, false, false);

//     var client = HTTPClient.init(
//         std.heap.c_allocator,
//         .GET,
//         URL.parse("https://www.bun.sh/"),
//         headers.entries,
//         headers.buf.items,
//     );
//     try std.testing.expectEqualStrings(client.url.hostname, "www.bun.sh");
//     var body_out_str = try MutableString.init(std.heap.c_allocator, 0);
//     var response = try client.send("", &body_out_str);
//     try std.testing.expectEqual(response.status_code, 200);
//     try std.testing.expectEqual(client.url.hostname, "bun.sh");
//     try std.testing.expectEqualStrings(body_out_str.list.items, @embedFile("fixtures_example.com.html"));
// }
