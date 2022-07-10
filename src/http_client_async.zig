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
const boring = @import("boringssl");
pub const NetworkThread = @import("./network_thread.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;
const SOCK = os.SOCK;
const Arena = @import("./mimalloc_arena.zig").Arena;
const AsyncMessage = @import("./http/async_message.zig");
const AsyncBIO = @import("./http/async_bio.zig");
const AsyncSocket = @import("./http/async_socket.zig");
const ZlibPool = @import("./http/zlib.zig");
const URLBufferPool = ObjectPool([4096]u8, null, false, 10);
pub const MimeType = @import("./http/mime_type.zig");
pub const URLPath = @import("./http/url_path.zig");
// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
pub var default_arena: Arena = undefined;

const log = Output.scoped(.fetch, true);

pub fn onThreadStart(_: ?*anyopaque) ?*anyopaque {
    default_arena = Arena.init() catch unreachable;
    default_allocator = default_arena.allocator();
    NetworkThread.address_list_cached = NetworkThread.AddressListCache.init(default_allocator);
    AsyncIO.global = AsyncIO.init(1024, 0) catch |err| {
        log: {
            if (comptime Environment.isLinux) {
                if (err == error.SystemOutdated) {
                    Output.prettyErrorln(
                        \\<red>error<r>: Linux kernel version doesn't support io_uring, which Bun depends on. 
                        \\
                        \\To fix this error: <b>please upgrade to a newer Linux kernel<r>.
                        \\
                        \\If you're using Windows Subsystem for Linux, here's how: 
                        \\  1. Open PowerShell as an administrator
                        \\  2. Run this:
                        \\    <cyan>wsl --update<r>
                        \\    <cyan>wsl --shutdown<r>
                        \\
                        \\If that doesn't work (and you're on a Windows machine), try this:
                        \\  1. Open Windows Update
                        \\  2. Download any updates to Windows Subsystem for Linux
                        \\
                        \\If you're still having trouble, ask for help in bun's discord https://bun.sh/discord
                        \\
                    , .{});
                    break :log;
                }
            }

            Output.prettyErrorln("<r><red>error<r>: Failed to initialize network thread: <red><b>{s}<r>.\nHTTP requests will not work. Please file an issue and run strace().", .{@errorName(err)});
        }

        Global.crash();
    };

    AsyncIO.global_loaded = true;
    NetworkThread.global.pool.io = &AsyncIO.global;
    Global.setThreadName("HTTP");
    AsyncBIO.initBoringSSL();
    return null;
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

pub const extremely_verbose = Environment.isDebug;

fn writeRequest(
    comptime Writer: type,
    writer: Writer,
    request: picohttp.Request,
    body: string,
    // header_hashes: []u64,
) !void {
    _ = writer.write(request.method);
    _ = writer.write(" ");
    _ = writer.write(request.path);
    _ = writer.write(" HTTP/1.1\r\n");

    for (request.headers) |header| {
        _ = writer.write(header.name);
        _ = writer.write(": ");
        _ = writer.write(header.value);
        _ = writer.write("\r\n");
    }

    _ = writer.write("\r\n");

    if (body.len > 0) {
        _ = writer.write(body);
    }
}

method: Method,
header_entries: Headers.Entries,
header_buf: string,
url: URL,
allocator: std.mem.Allocator,
verbose: bool = Environment.isTest,
tcp_client: tcp.Client = undefined,
body_size: u32 = 0,
read_count: u32 = 0,
remaining_redirect_count: i8 = 127,
redirect: ?*URLBufferPool.Node = null,
disable_shutdown: bool = true,
timeout: usize = 0,
progress_node: ?*std.Progress.Node = null,
socket: AsyncSocket.SSL = undefined,
socket_loaded: bool = false,
gzip_elapsed: u64 = 0,
stage: Stage = Stage.pending,
received_keep_alive: bool = false,

/// Some HTTP servers (such as npm) report Last-Modified times but ignore If-Modified-Since.
/// This is a workaround for that.
force_last_modified: bool = false,
if_modified_since: string = "",
request_content_len_buf: ["-4294967295".len]u8 = undefined,
request_headers_buf: [128]picohttp.Header = undefined,
response_headers_buf: [128]picohttp.Header = undefined,

pub fn init(
    allocator: std.mem.Allocator,
    method: Method,
    url: URL,
    header_entries: Headers.Entries,
    header_buf: string,
) !HTTPClient {
    return HTTPClient{
        .allocator = allocator,
        .method = method,
        .url = url,
        .header_entries = header_entries,
        .header_buf = header_buf,
        .socket = AsyncSocket.SSL{
            .socket = undefined,
        },
    };
}

pub fn deinit(this: *HTTPClient) !void {
    if (this.redirect) |redirect| {
        redirect.release();
        this.redirect = null;
    }
}

const Stage = enum(u8) {
    pending,
    connect,
    request,
    response,
    done,
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
const connection_header = picohttp.Header{ .name = "Connection", .value = "close" };
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

const user_agent_header = picohttp.Header{ .name = "User-Agent", .value = "bun.js " ++ Global.package_json_version };
const user_agent_header_hash = hashHeaderName("User-Agent");
const location_header_hash = hashHeaderName("Location");

pub fn headerStr(this: *const HTTPClient, ptr: Api.StringPointer) string {
    return this.header_buf[ptr.offset..][0..ptr.length];
}

pub const HeaderBuilder = @import("./http/header_builder.zig");

pub const HTTPChannel = @import("./sync.zig").Channel(*AsyncHTTP, .{ .Static = 1000 });
// 32 pointers much cheaper than 1000 pointers
const SingleHTTPChannel = struct {
    const SingleHTTPCHannel_ = @import("./sync.zig").Channel(*AsyncHTTP, .{ .Static = 8 });
    channel: SingleHTTPCHannel_,
    pub fn reset(_: *@This()) void {}
    pub fn init() SingleHTTPChannel {
        return SingleHTTPChannel{ .channel = SingleHTTPCHannel_.init() };
    }
};

pub const HTTPChannelContext = struct {
    http: AsyncHTTP = undefined,
    channel: *HTTPChannel,

    pub fn callback(
        http: *AsyncHTTP,
    ) void {
        var this: *HTTPChannelContext = @fieldParentPtr(HTTPChannelContext, "http", http);
        this.channel.writeItem(http) catch unreachable;
    }
};

// This causes segfaults when resume connect()
pub const KeepAlive = struct {
    const limit = 2;
    pub const disabled = true;
    fds: [limit]u32 = undefined,
    hosts: [limit]u64 = undefined,
    ports: [limit]u16 = undefined,
    used: u8 = 0,

    pub var instance = KeepAlive{};

    pub fn append(this: *KeepAlive, host: []const u8, port: u16, fd: os.socket_t) bool {
        if (disabled) return false;
        if (this.used >= limit or fd > std.math.maxInt(u32)) return false;

        const i = this.used;
        const hash = std.hash.Wyhash.hash(0, host);

        this.fds[i] = @truncate(u32, @intCast(u64, fd));
        this.hosts[i] = hash;
        this.ports[i] = port;
        this.used += 1;
        return true;
    }
    pub fn find(this: *KeepAlive, host: []const u8, port: u16) ?os.socket_t {
        if (disabled) return null;

        if (this.used == 0) {
            return null;
        }

        const hash = std.hash.Wyhash.hash(0, host);
        const list = this.hosts[0..this.used];
        for (list) |host_hash, i| {
            if (host_hash == hash and this.ports[i] == port) {
                const fd = this.fds[i];
                const last = this.used - 1;

                if (i > last) {
                    const end_host = this.hosts[last];
                    const end_fd = this.fds[last];
                    const end_port = this.ports[last];
                    this.hosts[i] = end_host;
                    this.fds[i] = end_fd;
                    this.ports[i] = end_port;
                }
                this.used -= 1;

                return @intCast(os.socket_t, fd);
            }
        }

        return null;
    }
};

pub const AsyncHTTP = struct {
    request: ?picohttp.Request = null,
    response: ?picohttp.Response = null,
    request_headers: Headers.Entries = Headers.Entries{},
    response_headers: Headers.Entries = Headers.Entries{},
    response_buffer: *MutableString,
    request_body: *MutableString,
    allocator: std.mem.Allocator,
    request_header_buf: string = "",
    method: Method = Method.GET,
    max_retry_count: u32 = 0,
    url: URL,

    task: ThreadPool.Task = ThreadPool.Task{ .callback = HTTPSender.callback },

    /// Timeout in nanoseconds
    timeout: usize = 0,

    response_encoding: Encoding = Encoding.identity,
    redirect_count: u32 = 0,
    retries_count: u32 = 0,
    verbose: bool = false,

    client: HTTPClient = undefined,
    err: ?anyerror = null,

    state: AtomicState = AtomicState.init(State.pending),
    elapsed: u64 = 0,
    gzip_elapsed: u64 = 0,

    /// Callback runs when request finishes
    /// Executes on the network thread
    callback: ?CompletionCallback = null,
    callback_ctx: ?*anyopaque = null,

    pub const CompletionCallback = fn (this: *AsyncHTTP) void;
    pub var active_requests_count = std.atomic.Atomic(u32).init(0);
    pub var max_simultaneous_requests: u16 = 32;

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
        request_body: *MutableString,
        timeout: usize,
    ) !AsyncHTTP {
        var this = AsyncHTTP{
            .allocator = allocator,
            .url = url,
            .method = method,
            .request_headers = headers,
            .request_header_buf = headers_buf,
            .request_body = request_body,
            .response_buffer = response_buffer,
        };
        this.client = try HTTPClient.init(allocator, method, url, headers, headers_buf);
        this.client.timeout = timeout;
        this.timeout = timeout;
        return this;
    }

    fn reset(this: *AsyncHTTP) !void {
        const timeout = this.timeout;
        this.client = try HTTPClient.init(this.allocator, this.method, this.client.url, this.client.header_entries, this.client.header_buf);
        this.client.timeout = timeout;
        this.timeout = timeout;
    }

    pub fn schedule(this: *AsyncHTTP, _: std.mem.Allocator, batch: *ThreadPool.Batch) void {
        NetworkThread.init() catch unreachable;
        this.state.store(.scheduled, .Monotonic);
        batch.push(ThreadPool.Batch.from(&this.task));
    }

    fn sendSyncCallback(this: *AsyncHTTP) void {
        var single_http_channel = @ptrCast(*SingleHTTPChannel, @alignCast(@alignOf(*SingleHTTPChannel), this.callback_ctx.?));
        single_http_channel.channel.writeItem(this) catch unreachable;
    }

    pub fn sendSync(this: *AsyncHTTP, comptime _: bool) anyerror!picohttp.Response {
        if (this.callback_ctx == null) {
            var ctx = try bun.default_allocator.create(SingleHTTPChannel);
            ctx.* = SingleHTTPChannel.init();
            this.callback_ctx = ctx;
        } else {
            var ctx = @ptrCast(*SingleHTTPChannel, @alignCast(@alignOf(*SingleHTTPChannel), this.callback_ctx.?));
            ctx.* = SingleHTTPChannel.init();
        }

        this.callback = sendSyncCallback;

        var batch = NetworkThread.Batch{};
        this.schedule(bun.default_allocator, &batch);
        NetworkThread.global.pool.schedule(batch);
        while (true) {
            var data = @ptrCast(*SingleHTTPChannel, @alignCast(@alignOf(*SingleHTTPChannel), this.callback_ctx.?));
            var async_http: *AsyncHTTP = data.channel.readItem() catch unreachable;
            if (async_http.err) |err| {
                return err;
            }

            return async_http.response.?;
        }

        unreachable;
    }

    pub const HTTPSender = struct {
        frame: @Frame(AsyncHTTP.do) = undefined,
        finisher: ThreadPool.Task = .{ .callback = onFinish },

        pub const Pool = ObjectPool(HTTPSender, null, false, 8);

        pub fn callback(task: *ThreadPool.Task) void {
            var this = @fieldParentPtr(AsyncHTTP, "task", task);
            var sender = HTTPSender.Pool.get(default_allocator);
            sender.data = .{
                .frame = undefined,
                .finisher = .{ .callback = onFinish },
            };
            sender.data.frame = async do(&sender.data, this);
        }

        pub fn onFinish(task: *ThreadPool.Task) void {
            var this = @fieldParentPtr(HTTPSender, "finisher", task);
            @fieldParentPtr(HTTPSender.Pool.Node, "data", this).release();
        }
    };

    pub fn do(sender: *HTTPSender, this: *AsyncHTTP) void {
        defer {
            NetworkThread.global.pool.schedule(.{ .head = &sender.finisher, .tail = &sender.finisher, .len = 1 });
        }

        outer: {
            this.err = null;
            this.state.store(.sending, .Monotonic);

            var timer = std.time.Timer.start() catch @panic("Timer failure");
            defer this.elapsed = timer.read();

            this.response = await this.client.sendAsync(this.request_body.list.items, this.response_buffer) catch |err| {
                this.state.store(.fail, .Monotonic);
                this.err = err;

                if (this.max_retry_count > this.retries_count) {
                    this.retries_count += 1;
                    this.response_buffer.reset();

                    NetworkThread.global.pool.schedule(ThreadPool.Batch.from(&this.task));
                    return;
                }
                break :outer;
            };

            this.redirect_count = @intCast(u32, @maximum(127 - this.client.remaining_redirect_count, 0));
            this.state.store(.success, .Monotonic);
            this.gzip_elapsed = this.client.gzip_elapsed;
        }

        if (this.callback) |callback| {
            callback(this);
        }
    }
};

pub fn buildRequest(this: *HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    var header_names = header_entries.items(.name);
    var header_values = header_entries.items(.value);
    var request_headers_buf = &this.request_headers_buf;

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

pub fn connect(
    this: *HTTPClient,
    comptime ConnectType: type,
    connector: ConnectType,
) !void {
    const port = this.url.getPortAuto();

    try connector.connect(this.url.hostname, port);
    std.debug.assert(this.socket.socket.socket > 0);
    var client = std.x.net.tcp.Client{ .socket = std.x.os.Socket.from(this.socket.socket.socket) };
    // client.setQuickACK(true) catch {};

    this.tcp_client = client;
    if (this.timeout > 0) {
        client.setReadTimeout(@truncate(u32, this.timeout / std.time.ns_per_ms)) catch {};
        client.setWriteTimeout(@truncate(u32, this.timeout / std.time.ns_per_ms)) catch {};
    }
}

pub fn sendAsync(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) @Frame(HTTPClient.send) {
    return async this.send(body, body_out_str);
}

fn maybeClearSocket(this: *HTTPClient) void {
    if (this.socket_loaded) {
        this.socket_loaded = false;

        this.socket.deinit();
    }
}

pub fn send(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    defer this.maybeClearSocket();

    // this prevents stack overflow
    redirect: while (this.remaining_redirect_count >= -1) {
        this.maybeClearSocket();

        _ = AsyncHTTP.active_requests_count.fetchAdd(1, .Monotonic);
        defer {
            _ = AsyncHTTP.active_requests_count.fetchSub(1, .Monotonic);
        }

        this.stage = Stage.pending;
        body_out_str.reset();

        if (this.url.isHTTPS()) {
            return this.sendHTTPS(body, body_out_str) catch |err| {
                switch (err) {
                    error.Redirect => {
                        this.remaining_redirect_count -= 1;

                        continue :redirect;
                    },
                    else => return err,
                }
            };
        } else {
            return this.sendHTTP(body, body_out_str) catch |err| {
                switch (err) {
                    error.Redirect => {
                        this.remaining_redirect_count -= 1;

                        continue :redirect;
                    },
                    else => return err,
                }
            };
        }
    }

    return error.TooManyRedirects;
}

const Task = ThreadPool.Task;

pub fn sendHTTP(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    this.socket = AsyncSocket.SSL{
        .socket = try AsyncSocket.init(&AsyncIO.global, 0, default_allocator),
    };
    this.socket_loaded = true;
    this.stage = Stage.connect;
    var socket = &this.socket.socket;
    try this.connect(*AsyncSocket, socket);
    this.stage = Stage.request;
    defer this.closeSocket();

    var request = buildRequest(this, body.len);
    if (this.verbose) {
        Output.prettyErrorln("{s}", .{request});
    }

    try writeRequest(@TypeOf(socket), socket, request, body);
    _ = try socket.send();
    this.stage = Stage.response;
    if (this.progress_node == null) {
        return this.processResponse(
            false,
            @TypeOf(socket),
            socket,
            body_out_str,
        );
    } else {
        return this.processResponse(
            true,
            @TypeOf(socket),
            socket,
            body_out_str,
        );
    }
}

pub fn processResponse(this: *HTTPClient, comptime report_progress: bool, comptime Client: type, client: Client, body_out_str: *MutableString) !picohttp.Response {
    defer if (this.verbose) Output.flush();
    var response: picohttp.Response = .{
        .minor_version = 1,
        .status_code = 0,
        .status = "",
        .headers = &[_]picohttp.Header{},
    };
    var request_message = AsyncMessage.get(default_allocator);
    defer request_message.release();
    var request_buffer: []u8 = request_message.buf;
    var read_length: usize = 0;
    {
        var read_headers_up_to: usize = 0;

        var req_buf_read: usize = std.math.maxInt(usize);
        defer this.read_count += @intCast(u32, read_length);

        restart: while (req_buf_read != 0) {
            req_buf_read = try client.read(request_buffer, read_length);
            read_length += req_buf_read;
            var request_body = request_buffer[0..read_length];
            log("request_body ({d}):\n{s}", .{ read_length, request_body });
            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(read_length);
                this.progress_node.?.context.maybeRefresh();
            }

            read_headers_up_to = @minimum(read_headers_up_to, read_length);

            response = picohttp.Response.parseParts(request_body, &this.response_headers_buf, &read_headers_up_to) catch |err| {
                log("read_headers_up_to: {d}", .{read_headers_up_to});
                switch (err) {
                    error.ShortRead => continue :restart,
                    else => return err,
                }
            };
            break :restart;
        }
    }
    if (read_length == 0) {
        return error.NoData;
    }

    body_out_str.reset();
    var content_length: u32 = 0;
    var encoding = Encoding.identity;
    var transfer_encoding = Encoding.identity;

    var location: string = "";

    var pretend_its_304 = false;
    var maybe_keepalive = false;
    errdefer {
        maybe_keepalive = false;
    }
    var content_encoding_i = response.headers.len + 1;

    for (response.headers) |header, header_i| {
        switch (hashHeaderName(header.name)) {
            content_length_header_hash => {
                content_length = std.fmt.parseInt(u32, header.value, 10) catch 0;
                try body_out_str.inflate(content_length);
                body_out_str.list.expandToCapacity();
                this.body_size = content_length;
            },
            content_encoding_hash => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    encoding = Encoding.gzip;
                    content_encoding_i = header_i;
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    encoding = Encoding.deflate;
                    content_encoding_i = header_i;
                } else if (!strings.eqlComptime(header.value, "identity")) {
                    return error.UnsupportedContentEncoding;
                }
            },
            transfer_encoding_header => {
                if (strings.eqlComptime(header.value, "gzip")) {
                    transfer_encoding = Encoding.gzip;
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    transfer_encoding = Encoding.deflate;
                } else if (strings.eqlComptime(header.value, "identity")) {
                    transfer_encoding = Encoding.identity;
                } else if (strings.eqlComptime(header.value, "chunked")) {
                    transfer_encoding = Encoding.chunked;
                } else {
                    return error.UnsupportedTransferEncoding;
                }
            },
            location_header_hash => {
                location = header.value;
            },
            hashHeaderName("Connection") => {
                if (response.status_code >= 200 and response.status_code <= 299 and !KeepAlive.disabled) {
                    if (strings.eqlComptime(header.value, "keep-alive")) {
                        maybe_keepalive = true;
                    }
                }
            },
            hashHeaderName("Last-Modified") => {
                if (this.force_last_modified and response.status_code > 199 and response.status_code < 300 and this.if_modified_since.len > 0) {
                    if (strings.eql(this.if_modified_since, header.value)) {
                        pretend_its_304 = true;
                    }
                }
            },

            else => {},
        }
    }

    if (this.verbose) {
        Output.prettyErrorln("Response: {s}", .{response});
    }

    if (location.len > 0 and this.remaining_redirect_count > 0) {
        switch (response.status_code) {
            302, 301, 307, 308, 303 => {
                if (strings.indexOf(location, "://")) |i| {
                    var url_buf = this.redirect orelse URLBufferPool.get(default_allocator);

                    const protocol_name = location[0..i];
                    if (strings.eqlComptime(protocol_name, "http") or strings.eqlComptime(protocol_name, "https")) {} else {
                        return error.UnsupportedRedirectProtocol;
                    }

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

                    if (this.redirect) |red| {
                        red.release();
                    }

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

    body_getter: {
        if (pretend_its_304) {
            response.status_code = 304;
        }

        if (response.status_code == 304) break :body_getter;

        if (transfer_encoding == Encoding.chunked) {
            maybe_keepalive = false;
            var decoder = std.mem.zeroes(picohttp.phr_chunked_decoder);
            var buffer_: *MutableString = body_out_str;

            switch (encoding) {
                Encoding.gzip, Encoding.deflate => {
                    if (!ZlibPool.loaded) {
                        ZlibPool.instance = ZlibPool.init(default_allocator);
                        ZlibPool.loaded = true;
                    }

                    buffer_ = try ZlibPool.instance.get();
                },
                else => {},
            }

            var buffer = buffer_.*;

            var last_read: usize = 0;
            {
                const buffered_amount = client.bufferedReadAmount();
                if (buffered_amount > 0) {
                    var end = request_buffer[read_length..];
                    if (buffered_amount <= end.len) {
                        std.debug.assert(client.read(end, buffered_amount) catch unreachable == buffered_amount);
                        response.bytes_read += @intCast(c_int, buffered_amount);
                    }
                }
                var remainder = request_buffer[@intCast(usize, response.bytes_read)..read_length];
                last_read = remainder.len;
                try buffer.inflate(@maximum(remainder.len, 2048));
                buffer.list.expandToCapacity();
                std.mem.copy(u8, buffer.list.items, remainder);
            }

            // set consume_trailer to 1 to discard the trailing header
            // using content-encoding per chunk is not supported
            decoder.consume_trailer = 1;

            // these variable names are terrible
            // it's copypasta from https://github.com/h2o/picohttpparser#phr_decode_chunked
            // (but ported from C -> zig)
            var rret: usize = 0;
            var rsize: usize = last_read;
            var pret: isize = picohttp.phr_decode_chunked(&decoder, buffer.list.items.ptr, &rsize);
            var total_size = rsize;

            while (pret == -2) {
                var buffered_amount = client.bufferedReadAmount();
                if (buffer.list.items.len < total_size + 512 or buffer.list.items[total_size..].len < @intCast(usize, @maximum(decoder.bytes_left_in_chunk, buffered_amount)) or buffer.list.items[total_size..].len < 512) {
                    try buffer.inflate(@maximum((buffered_amount + total_size) * 2, 1024));
                    buffer.list.expandToCapacity();
                }

                // while (true) {

                var remainder = buffer.list.items[total_size..];
                const errorable_read = client.read(remainder, 0);

                rret = errorable_read catch |err| {
                    if (extremely_verbose) Output.prettyErrorln("Chunked transfer encoding error: {s}", .{@errorName(err)});
                    return err;
                };

                buffered_amount = client.bufferedReadAmount();
                if (buffered_amount > 0) {
                    try buffer.list.ensureTotalCapacity(default_allocator, rret + total_size + buffered_amount);
                    buffer.list.expandToCapacity();
                    remainder = buffer.list.items[total_size..];
                    remainder = remainder[rret..][0..buffered_amount];
                    rret += client.read(remainder, 0) catch |err| {
                        if (extremely_verbose) Output.prettyErrorln("Chunked transfer encoding error: {s}", .{@errorName(err)});
                        return err;
                    };
                }

                // socket hang up, there was a parsing error, etc
                if (rret == 0) {
                    if (extremely_verbose) Output.prettyErrorln("Unexpected 0", .{});

                    return error.ChunkedEncodingError;
                }

                rsize = rret;
                pret = picohttp.phr_decode_chunked(&decoder, buffer.list.items[total_size..].ptr, &rsize);
                if (pret == -1) {
                    if (extremely_verbose)
                        Output.prettyErrorln(
                            \\ buffered: {d} 
                            \\ rsize: {d}
                            \\ Read: {d} bytes / {d} total ({d} parsed)
                            \\ Chunk {d} left
                            \\ {}
                        , .{
                            client.bufferedReadAmount(),
                            rsize,
                            rret,
                            buffer.list.items.len,
                            total_size,
                            decoder.bytes_left_in_chunk,

                            decoder,
                        });

                    return error.ChunkedEncodingParseError;
                }
                total_size += rsize;

                if (comptime report_progress) {
                    this.progress_node.?.activate();
                    this.progress_node.?.setCompletedItems(total_size);
                    this.progress_node.?.context.maybeRefresh();
                }
            }

            buffer.list.shrinkRetainingCapacity(total_size);
            buffer_.* = buffer;
            switch (encoding) {
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

                    // if it compressed with this header, it is no longer
                    if (content_encoding_i < response.headers.len) {
                        var mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers, .capacity = response.headers.len };
                        _ = mutable_headers.swapRemove(content_encoding_i);
                        response.headers = mutable_headers.items;
                    }
                },
                else => {},
            }

            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(body_out_str.list.items.len);
                this.progress_node.?.context.maybeRefresh();
            }

            this.body_size = @truncate(u32, body_out_str.list.items.len);

            return response;
        }

        if (content_length > 0) {
            var remaining_content_length = content_length;
            var remainder = request_buffer[@intCast(usize, response.bytes_read)..read_length];
            remainder = remainder[0..std.math.min(remainder.len, content_length)];
            var buffer_: *MutableString = body_out_str;

            switch (encoding) {
                Encoding.gzip, Encoding.deflate => {
                    if (!ZlibPool.loaded) {
                        ZlibPool.instance = ZlibPool.init(default_allocator);
                        ZlibPool.loaded = true;
                    }

                    buffer_ = try ZlibPool.instance.get();
                    if (buffer_.list.capacity < remaining_content_length) {
                        try buffer_.list.ensureUnusedCapacity(buffer_.allocator, remaining_content_length);
                    }
                    buffer_.list.items = buffer_.list.items.ptr[0..remaining_content_length];
                },
                else => {},
            }
            var buffer = buffer_.*;

            var body_size: usize = 0;
            if (remainder.len > 0) {
                std.mem.copy(u8, buffer.list.items, remainder);
                body_size = remainder.len;
                this.read_count += @intCast(u32, body_size);
                remaining_content_length -= @intCast(u32, remainder.len);
            }

            while (remaining_content_length > 0) {
                const size = @intCast(u32, try client.read(
                    buffer.list.items,
                    body_size,
                ));
                this.read_count += size;
                if (size == 0) break;

                body_size += size;
                remaining_content_length -= size;

                if (comptime report_progress) {
                    this.progress_node.?.activate();
                    this.progress_node.?.setCompletedItems(body_size);
                    this.progress_node.?.context.maybeRefresh();
                }
            }

            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(body_size);
                this.progress_node.?.context.maybeRefresh();
            }

            buffer.list.shrinkRetainingCapacity(body_size);
            buffer_.* = buffer;

            switch (encoding) {
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

                    // if it compressed with this header, it is no longer
                    if (content_encoding_i < response.headers.len) {
                        var mutable_headers = std.ArrayListUnmanaged(picohttp.Header){ .items = response.headers, .capacity = response.headers.len };
                        _ = mutable_headers.swapRemove(content_encoding_i);
                        response.headers = mutable_headers.items;
                    }
                },
                else => {},
            }
        }
    }

    if (comptime report_progress) {
        this.progress_node.?.activate();
        this.progress_node.?.setCompletedItems(body_out_str.list.items.len);
        this.progress_node.?.context.maybeRefresh();
    }

    if (maybe_keepalive and response.status_code >= 200 and response.status_code < 300) {
        this.received_keep_alive = true;
    }

    return response;
}

pub fn closeSocket(this: *HTTPClient) void {
    if (this.received_keep_alive) {
        this.received_keep_alive = false;
        if (this.url.hostname.len > 0 and this.socket.socket.socket > 0) {
            if (!this.socket.connect_frame.wait and
                (!this.socket.ssl_bio_loaded or
                (this.socket.ssl_bio.pending_sends == 0 and this.socket.ssl_bio.pending_reads == 0)))
            {
                if (KeepAlive.instance.append(this.url.hostname, this.url.getPortAuto(), this.socket.socket.socket)) {
                    this.socket.socket.socket = 0;
                }
            }
        }
    }
    this.socket.close();
}

pub fn sendHTTPS(this: *HTTPClient, body_str: []const u8, body_out_str: *MutableString) !picohttp.Response {
    this.socket = try AsyncSocket.SSL.init(default_allocator, &AsyncIO.global);
    this.socket_loaded = true;

    var socket = &this.socket;
    this.stage = Stage.connect;
    try this.connect(*AsyncSocket.SSL, socket);
    this.stage = Stage.request;
    defer this.closeSocket();

    var request = buildRequest(this, body_str.len);
    if (this.verbose) {
        Output.prettyErrorln("{s}", .{request});
    }

    try writeRequest(@TypeOf(socket), socket, request, body_str);
    _ = try socket.send();

    this.stage = Stage.response;

    if (this.progress_node == null) {
        return this.processResponse(
            false,
            @TypeOf(socket),
            socket,
            body_out_str,
        );
    } else {
        return this.processResponse(
            true,
            @TypeOf(socket),
            socket,
            body_out_str,
        );
    }
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
