const picohttp = @import("picohttp");
const _global = @import("./global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const FeatureFlags = _global.FeatureFlags;
const stringZ = _global.stringZ;
const C = _global.C;
const std = @import("std");
const URL = @import("./query_string_map.zig").URL;
const Method = @import("./http/method.zig").Method;
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

// This becomes Arena.allocator
pub var default_allocator: std.mem.Allocator = undefined;
pub var default_arena: Arena = undefined;

pub fn onThreadStart() void {
    default_arena = Arena.init() catch unreachable;
    default_allocator = default_arena.allocator();
}

pub const Headers = struct {
    pub const Kv = struct {
        name: Api.StringPointer,
        value: Api.StringPointer,
    };
    pub const Entries = std.MultiArrayList(Kv);
};

const SOCKET_FLAGS: u32 = if (Environment.isLinux)
    SOCK.CLOEXEC | os.MSG.NOSIGNAL
else
    SOCK.CLOEXEC;

const OPEN_SOCKET_FLAGS = SOCK.CLOEXEC;

const extremely_verbose = false;

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
gzip_elapsed: u64 = 0,
stage: Stage = Stage.pending,

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
        .socket = undefined,
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
        var end = std.math.min(hasher.buf.len, remain.len);

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

pub const HeaderBuilder = struct {
    content: StringBuilder = StringBuilder{},
    header_count: u64 = 0,
    entries: Headers.Entries = Headers.Entries{},

    pub fn count(this: *HeaderBuilder, name: string, value: string) void {
        this.header_count += 1;
        this.content.count(name);
        this.content.count(value);
    }

    pub fn allocate(this: *HeaderBuilder, allocator: std.mem.Allocator) !void {
        try this.content.allocate(allocator);
        try this.entries.ensureTotalCapacity(allocator, this.header_count);
    }
    pub fn append(this: *HeaderBuilder, name: string, value: string) void {
        const name_ptr = Api.StringPointer{
            .offset = @truncate(u32, this.content.len),
            .length = @truncate(u32, name.len),
        };

        _ = this.content.append(name);

        const value_ptr = Api.StringPointer{
            .offset = @truncate(u32, this.content.len),
            .length = @truncate(u32, value.len),
        };
        _ = this.content.append(value);
        this.entries.appendAssumeCapacity(Headers.Kv{ .name = name_ptr, .value = value_ptr });
    }

    pub fn apply(this: *HeaderBuilder, client: *HTTPClient) void {
        client.header_entries = this.entries;
        client.header_buf = this.content.ptr.?[0..this.content.len];
    }
};

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

    pub fn callback(http: *AsyncHTTP, sender: *AsyncHTTP.HTTPSender) void {
        var this: *HTTPChannelContext = @fieldParentPtr(HTTPChannelContext, "http", http);
        this.channel.writeItem(http) catch unreachable;
        sender.onFinish();
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

    pub const CompletionCallback = fn (this: *AsyncHTTP, sender: *HTTPSender) void;
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

    pub fn schedule(this: *AsyncHTTP, allocator: std.mem.Allocator, batch: *ThreadPool.Batch) void {
        std.debug.assert(NetworkThread.global_loaded.load(.Monotonic) == 1);
        var sender = HTTPSender.get(this, allocator);
        this.state.store(.scheduled, .Monotonic);
        batch.push(ThreadPool.Batch.from(&sender.task));
    }

    fn sendSyncCallback(this: *AsyncHTTP, sender: *HTTPSender) void {
        var single_http_channel = @ptrCast(*SingleHTTPChannel, @alignCast(@alignOf(*SingleHTTPChannel), this.callback_ctx.?));
        single_http_channel.channel.writeItem(this) catch unreachable;
        sender.release();
    }

    pub fn sendSync(this: *AsyncHTTP, comptime _: bool) anyerror!picohttp.Response {
        if (this.callback_ctx == null) {
            var ctx = try _global.default_allocator.create(SingleHTTPChannel);
            ctx.* = SingleHTTPChannel.init();
            this.callback_ctx = ctx;
        } else {
            var ctx = @ptrCast(*SingleHTTPChannel, @alignCast(@alignOf(*SingleHTTPChannel), this.callback_ctx.?));
            ctx.* = SingleHTTPChannel.init();
        }

        this.callback = sendSyncCallback;

        var batch = NetworkThread.Batch{};
        this.schedule(_global.default_allocator, &batch);
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

    var http_sender_head: std.atomic.Atomic(?*HTTPSender) = std.atomic.Atomic(?*HTTPSender).init(null);

    pub const HTTPSender = struct {
        task: ThreadPool.Task = .{ .callback = callback },
        frame: @Frame(AsyncHTTP.do) = undefined,
        http: *AsyncHTTP = undefined,

        next: ?*HTTPSender = null,

        pub fn get(http: *AsyncHTTP, allocator: std.mem.Allocator) *HTTPSender {
            @fence(.Acquire);

            var head_ = http_sender_head.load(.Monotonic);

            if (head_ == null) {
                var new_head = allocator.create(HTTPSender) catch unreachable;
                new_head.* = HTTPSender{};
                new_head.next = null;
                new_head.task = .{ .callback = callback };
                new_head.http = http;
                return new_head;
            }

            http_sender_head.store(head_.?.next, .Monotonic);

            head_.?.* = HTTPSender{};
            head_.?.next = null;
            head_.?.task = .{ .callback = callback };
            head_.?.http = http;

            return head_.?;
        }

        pub fn release(this: *HTTPSender) void {
            @fence(.Acquire);
            this.task = .{ .callback = callback };
            this.http = undefined;
            this.next = http_sender_head.swap(this, .Monotonic);
        }

        pub fn callback(task: *ThreadPool.Task) void {
            var this = @fieldParentPtr(HTTPSender, "task", task);
            this.frame = async AsyncHTTP.do(this);
        }

        pub fn onFinish(this: *HTTPSender) void {
            this.release();
        }
    };

    pub fn do(sender: *HTTPSender) void {
        outer: {
            var this = sender.http;
            this.err = null;
            this.state.store(.sending, .Monotonic);
            var timer = std.time.Timer.start() catch @panic("Timer failure");
            defer this.elapsed = timer.read();
            _ = active_requests_count.fetchAdd(1, .Monotonic);

            this.response = await this.client.sendAsync(this.request_body.list.items, this.response_buffer) catch |err| {
                _ = active_requests_count.fetchSub(1, .Monotonic);
                this.state.store(.fail, .Monotonic);
                this.err = err;

                if (sender.http.max_retry_count > sender.http.retries_count) {
                    sender.http.retries_count += 1;
                    NetworkThread.global.pool.schedule(ThreadPool.Batch.from(&sender.task));
                    return;
                }
                break :outer;
            };

            this.redirect_count = @intCast(u32, @maximum(127 - this.client.remaining_redirect_count, 0));
            this.state.store(.success, .Monotonic);
            this.gzip_elapsed = this.client.gzip_elapsed;
            _ = active_requests_count.fetchSub(1, .Monotonic);
        }

        if (sender.http.callback) |callback| {
            callback(sender.http, sender);
        }
    }
};

const buffer_pool_len = std.math.maxInt(u16) - 64;
const BufferPool = ObjectPool([buffer_pool_len]u8, null, false);
const URLBufferPool = ObjectPool([4096]u8, null, false);

pub const AsyncMessage = struct {
    used: u32 = 0,
    sent: u32 = 0,
    completion: AsyncIO.Completion = undefined,
    buf: []u8 = undefined,
    pooled: ?*BufferPool.Node = null,
    allocator: std.mem.Allocator,
    next: ?*AsyncMessage = null,
    context: *anyopaque = undefined,
    released: bool = false,
    var _first_ssl: ?*AsyncMessage = null;
    pub fn getSSL(allocator: std.mem.Allocator) *AsyncMessage {
        if (_first_ssl) |first| {
            var prev = first;

            std.debug.assert(prev.released);
            if (prev.next) |next| {
                _first_ssl = next;
                prev.next = null;
            } else {
                _first_ssl = null;
            }
            prev.released = false;

            return prev;
        }

        var msg = allocator.create(AsyncMessage) catch unreachable;
        msg.* = AsyncMessage{
            .allocator = allocator,
            .pooled = null,
            .buf = &[_]u8{},
        };
        return msg;
    }

    var _first: ?*AsyncMessage = null;
    pub fn get(allocator: std.mem.Allocator) *AsyncMessage {
        if (_first) |first| {
            var prev = first;
            std.debug.assert(prev.released);
            prev.released = false;

            if (first.next) |next| {
                _first = next;
                prev.next = null;
                return prev;
            } else {
                _first = null;
            }

            return prev;
        }

        var msg = allocator.create(AsyncMessage) catch unreachable;
        var pooled = BufferPool.get(allocator);
        msg.* = AsyncMessage{ .allocator = allocator, .buf = &pooled.data, .pooled = pooled };
        return msg;
    }

    pub fn release(self: *AsyncMessage) void {
        self.used = 0;
        self.sent = 0;
        if (self.released) return;
        self.released = true;

        if (self.pooled != null) {
            var old = _first;
            _first = self;
            self.next = old;
        } else {
            var old = _first_ssl;
            self.next = old;
            _first_ssl = self;
        }
    }

    const WriteResponse = struct {
        written: u32 = 0,
        overflow: bool = false,
    };

    pub fn writeAll(this: *AsyncMessage, buffer: []const u8) WriteResponse {
        var remain = this.buf[this.used..];
        var writable = buffer[0..@minimum(buffer.len, remain.len)];
        if (writable.len == 0) {
            return .{ .written = 0, .overflow = buffer.len > 0 };
        }

        std.mem.copy(u8, remain, writable);
        this.used += @intCast(u16, writable.len);

        return .{ .written = @truncate(u32, writable.len), .overflow = writable.len == remain.len };
    }

    pub inline fn slice(this: *const AsyncMessage) []const u8 {
        return this.buf[0..this.used][this.sent..];
    }

    pub inline fn available(this: *AsyncMessage) []u8 {
        return this.buf[0 .. this.buf.len - this.used];
    }
};

const Completion = AsyncIO.Completion;

const AsyncSocket = struct {
    const This = @This();
    io: *AsyncIO = undefined,
    socket: std.os.socket_t = 0,
    head: *AsyncMessage = undefined,
    tail: *AsyncMessage = undefined,
    allocator: std.mem.Allocator,
    err: ?anyerror = null,
    queued: usize = 0,
    sent: usize = 0,
    send_frame: @Frame(AsyncSocket.send) = undefined,
    read_frame: @Frame(AsyncSocket.read) = undefined,
    connect_frame: @Frame(AsyncSocket.connectToAddress) = undefined,
    close_frame: @Frame(AsyncSocket.close) = undefined,

    read_context: []u8 = undefined,
    read_offset: u64 = 0,
    read_completion: AsyncIO.Completion = undefined,
    connect_completion: AsyncIO.Completion = undefined,
    close_completion: AsyncIO.Completion = undefined,

    const ConnectError = AsyncIO.ConnectError || std.os.SocketError || std.os.SetSockOptError || error{
        UnknownHostName,
        ConnectionRefused,
        AddressNotAvailable,
    };

    pub fn init(io: *AsyncIO, socket: std.os.socket_t, allocator: std.mem.Allocator) !AsyncSocket {
        var head = AsyncMessage.get(allocator);

        return AsyncSocket{ .io = io, .socket = socket, .head = head, .tail = head, .allocator = allocator };
    }

    fn on_connect(this: *AsyncSocket, _: *Completion, err: ConnectError!void) void {
        err catch |resolved_err| {
            this.err = resolved_err;
        };

        resume this.connect_frame;
    }

    fn connectToAddress(this: *AsyncSocket, address: std.net.Address) ConnectError!void {
        const sockfd = AsyncIO.openSocket(address.any.family, OPEN_SOCKET_FLAGS | std.os.SOCK.STREAM, std.os.IPPROTO.TCP) catch |err| {
            if (extremely_verbose) {
                Output.prettyErrorln("openSocket error: {s}", .{@errorName(err)});
            }

            return error.ConnectionRefused;
        };

        this.io.connect(*AsyncSocket, this, on_connect, &this.connect_completion, sockfd, address);
        suspend {
            this.connect_frame = @frame().*;
        }

        if (this.err) |e| {
            return @errSetCast(ConnectError, e);
        }

        this.socket = sockfd;
        return;
    }

    fn on_close(this: *AsyncSocket, _: *Completion, _: AsyncIO.CloseError!void) void {
        resume this.close_frame;
    }

    pub fn close(this: *AsyncSocket) void {
        if (this.socket == 0) return;
        this.io.close(*AsyncSocket, this, on_close, &this.close_completion, this.socket);
        suspend {
            this.close_frame = @frame().*;
        }
        this.socket = 0;
    }

    pub fn connect(this: *AsyncSocket, name: []const u8, port: u16) ConnectError!void {
        this.socket = 0;
        outer: while (true) {
            // on macOS, getaddrinfo() is very slow
            // If you send ~200 network requests, about 1.5s is spent on getaddrinfo()
            // So, we cache this.
            var address_list = NetworkThread.getAddressList(default_allocator, name, port) catch |err| {
                return @errSetCast(ConnectError, err);
            };

            const list = address_list.address_list;
            if (list.addrs.len == 0) return error.ConnectionRefused;

            try_cached_index: {
                if (address_list.index) |i| {
                    const address = list.addrs[i];
                    if (address_list.invalidated) continue :outer;

                    this.connectToAddress(address) catch |err| {
                        if (err == error.ConnectionRefused) {
                            address_list.index = null;
                            break :try_cached_index;
                        }

                        address_list.invalidate();
                        continue :outer;
                    };
                }
            }

            for (list.addrs) |address, i| {
                if (address_list.invalidated) continue :outer;
                this.connectToAddress(address) catch |err| {
                    if (err == error.ConnectionRefused) continue;
                    address_list.invalidate();
                    if (err == error.AddressNotAvailable or err == error.UnknownHostName) continue :outer;
                    return err;
                };
                address_list.index = @truncate(u32, i);
                return;
            }

            if (address_list.invalidated) continue :outer;

            address_list.invalidate();
            return error.ConnectionRefused;
        }
    }

    fn on_send(msg: *AsyncMessage, _: *Completion, result: SendError!usize) void {
        var this = @ptrCast(*AsyncSocket, @alignCast(@alignOf(*AsyncSocket), msg.context));
        const written = result catch |err| {
            this.err = err;
            resume this.send_frame;
            return;
        };

        if (written == 0) {
            resume this.send_frame;
            return;
        }

        msg.sent += @truncate(u16, written);
        const has_more = msg.used > msg.sent;
        this.sent += written;

        if (has_more) {
            this.io.send(
                *AsyncMessage,
                msg,
                on_send,
                &msg.completion,
                this.socket,
                msg.slice(),
                SOCKET_FLAGS,
            );
        } else {
            msg.release();
        }

        // complete
        if (this.queued <= this.sent) {
            resume this.send_frame;
        }
    }

    pub fn write(this: *AsyncSocket, buf: []const u8) usize {
        this.tail.context = this;

        const resp = this.tail.writeAll(buf);
        this.queued += resp.written;

        if (resp.overflow) {
            var next = AsyncMessage.get(default_allocator);
            this.tail.next = next;
            this.tail = next;

            return @as(usize, resp.written) + this.write(buf[resp.written..]);
        }

        return @as(usize, resp.written);
    }

    pub const SendError = AsyncIO.SendError;

    pub fn deinit(this: *AsyncSocket) void {
        this.head.release();
    }

    pub fn send(this: *This) SendError!usize {
        const original_sent = this.sent;
        this.head.context = this;

        this.io.send(
            *AsyncMessage,
            this.head,
            on_send,
            &this.head.completion,
            this.socket,
            this.head.slice(),
            SOCKET_FLAGS,
        );

        var node = this.head;
        while (node.next) |element| {
            this.io.send(
                *AsyncMessage,
                element,
                on_send,
                &element.completion,
                this.socket,
                element.slice(),
                SOCKET_FLAGS,
            );
            node = element.next orelse break;
        }

        suspend {
            this.send_frame = @frame().*;
        }

        if (this.err) |err| {
            this.err = null;
            return @errSetCast(AsyncSocket.SendError, err);
        }

        return this.sent - original_sent;
    }

    pub const RecvError = AsyncIO.RecvError;

    const Reader = struct {
        pub fn on_read(ctx: *AsyncSocket, _: *AsyncIO.Completion, result: RecvError!usize) void {
            const len = result catch |err| {
                ctx.err = err;
                resume ctx.read_frame;
                return;
            };
            ctx.read_offset += len;
            resume ctx.read_frame;
        }
    };

    pub fn read(
        this: *AsyncSocket,
        bytes: []u8,
        offset: u64,
    ) RecvError!u64 {
        this.read_context = bytes;
        this.read_offset = offset;
        const original_read_offset = this.read_offset;

        this.io.recv(
            *AsyncSocket,
            this,
            Reader.on_read,
            &this.read_completion,
            this.socket,
            bytes,
        );

        suspend {
            this.read_frame = @frame().*;
        }

        if (this.err) |err| {
            this.err = null;
            return @errSetCast(RecvError, err);
        }

        return this.read_offset - original_read_offset;
    }

    pub const SSL = struct {
        ssl: *boring.SSL = undefined,
        ssl_loaded: bool = false,
        socket: AsyncSocket,
        handshake_complete: bool = false,
        ssl_bio: ?*AsyncBIO = null,
        read_bio: ?*AsyncMessage = null,
        handshake_frame: @Frame(SSL.handshake) = undefined,
        send_frame: @Frame(SSL.send) = undefined,
        read_frame: @Frame(SSL.read) = undefined,
        hostname: [std.fs.MAX_PATH_BYTES]u8 = undefined,
        is_ssl: bool = false,

        const SSLConnectError = ConnectError || HandshakeError;
        const HandshakeError = error{OpenSSLError};

        pub fn connect(this: *SSL, name: []const u8, port: u16) !void {
            this.is_ssl = true;
            try this.socket.connect(name, port);

            this.handshake_complete = false;

            var ssl = boring.initClient();
            this.ssl = ssl;
            this.ssl_loaded = true;
            errdefer {
                this.ssl_loaded = false;
                this.ssl.deinit();
                this.ssl = undefined;
            }

            {
                std.mem.copy(u8, &this.hostname, name);
                this.hostname[name.len] = 0;
                var name_ = this.hostname[0..name.len :0];
                ssl.setHostname(name_);
            }

            var bio = try AsyncBIO.init(this.socket.allocator);
            bio.socket_fd = this.socket.socket;
            this.ssl_bio = bio;

            boring.SSL_set_bio(ssl, bio.bio, bio.bio);

            this.read_bio = AsyncMessage.get(this.socket.allocator);
            try this.handshake();
        }

        pub fn close(this: *SSL) void {
            this.socket.close();
        }

        fn handshake(this: *SSL) HandshakeError!void {
            while (!this.ssl.isInitFinished()) {
                boring.ERR_clear_error();
                this.ssl_bio.?.enqueueSend();
                const handshake_result = boring.SSL_connect(this.ssl);
                if (handshake_result == 0) {
                    Output.prettyErrorln("ssl accept error", .{});
                    Output.flush();
                    return error.OpenSSLError;
                }
                this.handshake_complete = handshake_result == 1 and this.ssl.isInitFinished();

                if (!this.handshake_complete) {
                    // accept_result < 0
                    const e = boring.SSL_get_error(this.ssl, handshake_result);
                    if ((e == boring.SSL_ERROR_WANT_READ or e == boring.SSL_ERROR_WANT_WRITE)) {
                        this.ssl_bio.?.enqueueSend();
                        suspend {
                            this.handshake_frame = @frame().*;
                            this.ssl_bio.?.pushPendingFrame(&this.handshake_frame);
                        }

                        continue;
                    }

                    Output.prettyErrorln("ssl accept error = {}, return val was {}", .{ e, handshake_result });
                    Output.flush();
                    return error.OpenSSLError;
                }
            }
        }

        pub fn write(this: *SSL, buffer_: []const u8) usize {
            var buffer = buffer_;
            var read_bio = this.read_bio;
            while (buffer.len > 0) {
                const response = read_bio.?.writeAll(buffer);
                buffer = buffer[response.written..];
                if (response.overflow) {
                    read_bio = read_bio.?.next orelse brk: {
                        read_bio.?.next = AsyncMessage.get(this.socket.allocator);
                        break :brk read_bio.?.next.?;
                    };
                }
            }

            return buffer_.len;
        }

        pub fn send(this: *SSL) !usize {
            var bio_ = this.read_bio;
            var len: usize = 0;
            while (bio_) |bio| {
                var slice = bio.slice();
                len += this.ssl.write(slice) catch |err| {
                    switch (err) {
                        error.WantRead => {
                            suspend {
                                this.send_frame = @frame().*;
                                this.ssl_bio.?.pushPendingFrame(&this.send_frame);
                            }
                            continue;
                        },
                        error.WantWrite => {
                            this.ssl_bio.?.enqueueSend();

                            suspend {
                                this.send_frame = @frame().*;
                                this.ssl_bio.?.pushPendingFrame(&this.send_frame);
                            }
                            continue;
                        },
                        else => {},
                    }

                    if (comptime Environment.isDebug) {
                        Output.prettyErrorln("SSL error: {s} (buf: {s})\n URL:", .{
                            @errorName(err),
                            bio.slice(),
                        });
                        Output.flush();
                    }

                    return err;
                };

                bio_ = bio.next;
            }
            return len;
        }

        pub fn read(this: *SSL, buf_: []u8, offset: u64) !u64 {
            var buf = buf_[offset..];
            var len: usize = 0;
            while (buf.len > 0) {
                len = this.ssl.read(buf) catch |err| {
                    switch (err) {
                        error.WantWrite => {
                            this.ssl_bio.?.enqueueSend();

                            if (extremely_verbose) {
                                Output.prettyErrorln(
                                    "error: {s}: \n Read Wait: {s}\n Send Wait: {s}",
                                    .{
                                        @errorName(err),
                                        @tagName(this.ssl_bio.?.read_wait),
                                        @tagName(this.ssl_bio.?.send_wait),
                                    },
                                );
                                Output.flush();
                            }

                            suspend {
                                this.read_frame = @frame().*;
                                this.ssl_bio.?.pushPendingFrame(&this.read_frame);
                            }
                            continue;
                        },
                        error.WantRead => {
                            // this.ssl_bio.enqueueSend();

                            if (extremely_verbose) {
                                Output.prettyErrorln(
                                    "error: {s}: \n Read Wait: {s}\n Send Wait: {s}",
                                    .{
                                        @errorName(err),
                                        @tagName(this.ssl_bio.?.read_wait),
                                        @tagName(this.ssl_bio.?.send_wait),
                                    },
                                );
                                Output.flush();
                            }

                            suspend {
                                this.read_frame = @frame().*;
                                this.ssl_bio.?.pushPendingFrame(&this.read_frame);
                            }
                            continue;
                        },
                        else => return err,
                    }
                    unreachable;
                };

                break;
            }

            return len;
        }

        pub inline fn init(allocator: std.mem.Allocator, io: *AsyncIO) !SSL {
            return SSL{
                .socket = try AsyncSocket.init(io, 0, allocator),
            };
        }

        pub fn deinit(this: *SSL) void {
            this.socket.deinit();
            if (!this.is_ssl) return;

            if (this.ssl_bio) |bio| {
                _ = boring.BIO_set_data(bio.bio, null);
                bio.pending_frame = AsyncBIO.PendingFrame.init();
                bio.socket_fd = 0;
                bio.release();
                this.ssl_bio = null;
            }

            if (this.ssl_loaded) {
                this.ssl.deinit();
                this.ssl_loaded = false;
            }

            this.handshake_complete = false;

            if (this.read_bio) |bio| {
                var next_ = bio.next;
                while (next_) |next| {
                    next.release();
                    next_ = next.next;
                }

                bio.release();
                this.read_bio = null;
            }
        }
    };
};

pub const AsyncBIO = struct {
    bio: *boring.BIO = undefined,
    socket_fd: std.os.socket_t = 0,
    allocator: std.mem.Allocator,

    read_wait: Wait = Wait.pending,
    send_wait: Wait = Wait.pending,
    recv_completion: AsyncIO.Completion = undefined,
    send_completion: AsyncIO.Completion = undefined,

    write_buffer: ?*AsyncMessage = null,

    last_send_result: AsyncIO.SendError!usize = 0,

    last_read_result: AsyncIO.RecvError!usize = 0,
    next: ?*AsyncBIO = null,
    pending_frame: PendingFrame = PendingFrame.init(),

    pub const PendingFrame = std.fifo.LinearFifo(anyframe, .{ .Static = 8 });

    pub inline fn pushPendingFrame(this: *AsyncBIO, frame: anyframe) void {
        this.pending_frame.writeItem(frame) catch {};
    }

    pub inline fn popPendingFrame(this: *AsyncBIO) ?anyframe {
        return this.pending_frame.readItem();
    }

    var method: ?*boring.BIO_METHOD = null;
    var head: ?*AsyncBIO = null;

    const async_bio_name: [:0]const u8 = "AsyncBIO";

    const Wait = enum {
        pending,
        suspended,
        completed,
    };

    fn instance(allocator: std.mem.Allocator) *AsyncBIO {
        if (head) |head_| {
            var next = head_.next;
            var ret = head_;
            ret.read_wait = .pending;
            ret.send_wait = .pending;
            head = next;

            ret.pending_frame = PendingFrame.init();
            return ret;
        }

        var bio = allocator.create(AsyncBIO) catch unreachable;
        bio.* = AsyncBIO{
            .allocator = allocator,
            .read_wait = .pending,
            .send_wait = .pending,
        };

        return bio;
    }

    pub fn release(this: *AsyncBIO) void {
        if (head) |head_| {
            this.next = head_;
        }

        this.read_wait = .pending;
        this.last_read_result = 0;
        this.send_wait = .pending;
        this.last_read_result = 0;
        this.pending_frame = PendingFrame.init();

        if (this.write_buffer) |write| {
            write.release();
            this.write_buffer = null;
        }

        head = this;
    }

    pub fn init(allocator: std.mem.Allocator) !*AsyncBIO {
        var bio = instance(allocator);

        bio.bio = boring.BIO_new(
            method orelse brk: {
                method = boring.BIOMethod.init(async_bio_name, Bio.create, Bio.destroy, Bio.write, Bio.read, null, Bio.ctrl);
                break :brk method.?;
            },
        ) orelse return error.OutOfMemory;

        _ = boring.BIO_set_data(bio.bio, bio);
        return bio;
    }

    const WaitResult = enum {
        none,
        read,
        send,
    };

    const Sender = struct {
        pub fn onSend(this: *AsyncBIO, _: *Completion, result: AsyncIO.SendError!usize) void {
            this.last_send_result = result;
            this.send_wait = .completed;
            this.write_buffer.?.sent += @truncate(u32, result catch 0);

            if (extremely_verbose) {
                const read_result = result catch @as(usize, 999);
                Output.prettyErrorln("onSend: {d}", .{read_result});
                Output.flush();
            }

            if (this.pending_frame.readItem()) |frame| {
                resume frame;
            }
        }
    };

    pub fn enqueueSend(
        self: *AsyncBIO,
    ) void {
        if (self.write_buffer == null) return;
        var to_write = self.write_buffer.?.slice();
        if (to_write.len == 0) {
            return;
        }

        self.last_send_result = 0;

        AsyncIO.global.send(
            *AsyncBIO,
            self,
            Sender.onSend,
            &self.send_completion,
            self.socket_fd,
            to_write,
            SOCKET_FLAGS,
        );
        self.send_wait = .suspended;
        if (extremely_verbose) {
            Output.prettyErrorln("enqueueSend: {d}", .{to_write.len});
            Output.flush();
        }
    }

    const Reader = struct {
        pub fn onRead(this: *AsyncBIO, _: *Completion, result: AsyncIO.RecvError!usize) void {
            this.last_read_result = result;
            this.read_wait = .completed;
            if (extremely_verbose) {
                const read_result = result catch @as(usize, 999);
                Output.prettyErrorln("onRead: {d}", .{read_result});
                Output.flush();
            }
            if (this.pending_frame.readItem()) |frame| {
                resume frame;
            }
        }
    };

    pub fn enqueueRead(self: *AsyncBIO, read_buf: []u8, off: u64) void {
        var read_buffer = read_buf[off..];
        if (read_buffer.len == 0) {
            return;
        }

        self.last_read_result = 0;
        AsyncIO.global.recv(*AsyncBIO, self, Reader.onRead, &self.recv_completion, self.socket_fd, read_buffer);
        self.read_wait = .suspended;
        if (extremely_verbose) {
            Output.prettyErrorln("enqueuedRead: {d}", .{read_buf.len});
            Output.flush();
        }
    }

    pub const Bio = struct {
        inline fn cast(bio: *boring.BIO) *AsyncBIO {
            return @ptrCast(*AsyncBIO, @alignCast(@alignOf(*AsyncBIO), boring.BIO_get_data(bio)));
        }

        pub fn create(this_bio: *boring.BIO) callconv(.C) c_int {
            boring.BIO_set_init(this_bio, 1);
            return 1;
        }
        pub fn destroy(this_bio: *boring.BIO) callconv(.C) c_int {
            boring.BIO_set_init(this_bio, 0);

            if (boring.BIO_get_data(this_bio) != null) {
                var this = cast(this_bio);
                this.release();
            }

            return 0;
        }
        pub fn write(this_bio: *boring.BIO, ptr: [*c]const u8, len: c_int) callconv(.C) c_int {
            std.debug.assert(@ptrToInt(ptr) > 0 and len >= 0);

            var buf = ptr[0..@intCast(usize, len)];
            boring.BIO_clear_flags(this_bio, boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY);

            if (len <= 0) {
                return 0;
            }

            var this = cast(this_bio);
            if (this.read_wait == .suspended) {
                boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));
                return -1;
            }

            switch (this.send_wait) {
                .pending => {
                    var write_buffer = this.write_buffer orelse brk: {
                        this.write_buffer = AsyncMessage.get(default_allocator);
                        break :brk this.write_buffer.?;
                    };

                    _ = write_buffer.writeAll(buf);
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));

                    return -1;
                },
                .suspended => {
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));

                    return -1;
                },
                .completed => {
                    this.send_wait = .pending;
                    const written = this.last_send_result catch |err| {
                        Output.prettyErrorln("HTTPS error: {s}", .{@errorName(err)});
                        Output.flush();
                        boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY));
                        return -1;
                    };
                    this.last_send_result = 0;
                    return @intCast(c_int, written);
                },
            }

            unreachable;
        }

        pub fn read(this_bio: *boring.BIO, ptr: [*c]u8, len: c_int) callconv(.C) c_int {
            std.debug.assert(@ptrToInt(ptr) > 0 and len >= 0);
            var buf = ptr[0..@intCast(usize, len)];

            boring.BIO_clear_flags(this_bio, boring.BIO_FLAGS_RWS | boring.BIO_FLAGS_SHOULD_RETRY);
            var this = cast(this_bio);

            switch (this.read_wait) {
                .pending => {
                    this.enqueueRead(buf, 0);
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                    return -1;
                },
                .suspended => {
                    boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                    return -1;
                },
                .completed => {
                    this.read_wait = .pending;
                    const read_len = this.last_read_result catch |err| {
                        Output.prettyErrorln("HTTPS error: {s}", .{@errorName(err)});
                        Output.flush();
                        boring.BIO_set_flags(this_bio, (boring.BIO_FLAGS_WRITE | boring.BIO_FLAGS_SHOULD_RETRY));
                        return -1;
                    };
                    this.last_read_result = 0;
                    return @intCast(c_int, read_len);
                },
            }
            unreachable;
        }
        pub fn ctrl(_: *boring.BIO, cmd: c_int, _: c_long, _: ?*anyopaque) callconv(.C) c_long {
            return switch (cmd) {
                boring.BIO_CTRL_PENDING, boring.BIO_CTRL_WPENDING => 0,
                else => 1,
            };
        }
    };
};

pub fn buildRequest(this: *HTTPClient, body_len: usize) picohttp.Request {
    var header_count: usize = 0;
    var header_entries = this.header_entries.slice();
    var header_names = header_entries.items(.name);
    var header_values = header_entries.items(.value);
    var request_headers_buf = &this.request_headers_buf;

    var override_accept_encoding = false;
    var override_accept_header = false;

    var override_user_agent = false;
    for (header_names) |head, i| {
        const name = this.headerStr(head);
        // Hash it as lowercase
        const hash = hashHeaderName(name);

        // Skip host and connection header
        // we manage those
        switch (hash) {
            host_header_hash,
            connection_header_hash,
            content_length_header_hash,
            => continue,
            hashHeaderName("if-modified-since") => {
                if (this.force_last_modified and this.if_modified_since.len == 0) {
                    this.if_modified_since = this.headerStr(header_values[i]);
                }
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

    // request_headers_buf[header_count] = connection_header;
    // header_count += 1;

    if (!override_user_agent) {
        request_headers_buf[header_count] = user_agent_header;
        header_count += 1;
    }

    if (!override_accept_header) {
        request_headers_buf[header_count] = accept_header;
        header_count += 1;
    }

    request_headers_buf[header_count] = picohttp.Header{
        .name = host_header_name,
        .value = this.url.hostname,
    };
    header_count += 1;

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
    var client = std.x.net.tcp.Client{ .socket = std.x.os.Socket.from(this.socket.socket.socket) };
    client.setReadBufferSize(buffer_pool_len) catch {};
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

pub fn send(this: *HTTPClient, body: []const u8, body_out_str: *MutableString) !picohttp.Response {
    defer if (@enumToInt(this.stage) > @enumToInt(Stage.pending)) this.socket.deinit();
    // this prevents stack overflow
    redirect: while (this.remaining_redirect_count >= -1) {
        if (@enumToInt(this.stage) > @enumToInt(Stage.pending)) this.socket.deinit();

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
    this.stage = Stage.connect;
    var socket = &this.socket.socket;
    try this.connect(*AsyncSocket, socket);
    this.stage = Stage.request;
    defer this.socket.close();
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

const ZlibPool = struct {
    lock: Lock = Lock.init(),
    items: std.ArrayList(*MutableString),
    allocator: std.mem.Allocator,
    pub var instance: ZlibPool = undefined;
    pub var loaded: bool = false;
    pub var decompression_thread_pool: ThreadPool = undefined;
    pub var decompression_thread_pool_loaded: bool = false;

    pub fn init(allocator: std.mem.Allocator) ZlibPool {
        return ZlibPool{
            .allocator = allocator,
            .items = std.ArrayList(*MutableString).init(allocator),
        };
    }

    pub fn get(this: *ZlibPool) !*MutableString {
        switch (this.items.items.len) {
            0 => {
                var mutable = try default_allocator.create(MutableString);
                mutable.* = try MutableString.init(default_allocator, 0);
                return mutable;
            },
            else => {
                return this.items.pop();
            },
        }

        unreachable;
    }

    pub fn put(this: *ZlibPool, mutable: *MutableString) !void {
        mutable.reset();
        try this.items.append(mutable);
    }

    pub fn decompress(compressed_data: []const u8, output: *MutableString) Zlib.ZlibError!void {
        // Heuristic: if we have more than 128 KB of data to decompress
        // it may take 1ms or so
        // We must keep the network thread unblocked as often as possible
        // So if we have more than 50 KB of data to decompress, we do it off the network thread
        // if (compressed_data.len < 50_000) {
        var reader = try Zlib.ZlibReaderArrayList.init(compressed_data, &output.list, default_allocator);
        try reader.readAll();
        return;
        // }

        // var task = try DecompressionTask.get(default_allocator);
        // defer task.release();
        // task.* = DecompressionTask{
        //     .data = compressed_data,
        //     .output = output,
        //     .event_fd = AsyncIO.global.eventfd(),
        // };
        // task.scheduleAndWait();

        // if (task.err) |err| {
        //     return @errSetCast(Zlib.ZlibError, err);
        // }
    }

    pub const DecompressionTask = struct {
        task: ThreadPool.Task = ThreadPool.Task{ .callback = callback },
        frame: @Frame(scheduleAndWait) = undefined,
        data: []const u8,
        output: *MutableString = undefined,
        completion: Completion = undefined,
        event_fd: std.os.fd_t = 0,
        err: ?anyerror = null,
        next: ?*DecompressionTask = null,

        pub var head: ?*DecompressionTask = null;

        pub fn get(allocator: std.mem.Allocator) !*DecompressionTask {
            if (head) |head_| {
                var this = head_;
                head = this.next;
                this.next = null;
                return this;
            }

            return try allocator.create(DecompressionTask);
        }

        pub fn scheduleAndWait(task: *DecompressionTask) void {
            if (!decompression_thread_pool_loaded) {
                decompression_thread_pool_loaded = true;
                decompression_thread_pool = ThreadPool.init(.{ .max_threads = 1 });
            }

            AsyncIO.global.event(
                *DecompressionTask,
                task,
                DecompressionTask.finished,
                &task.completion,
                task.event_fd,
            );

            suspend {
                var batch = ThreadPool.Batch.from(&task.task);
                decompression_thread_pool.schedule(batch);
                task.frame = @frame().*;
            }
        }

        pub fn release(this: *DecompressionTask) void {
            this.next = head;
            head = this;
        }

        fn callback_(this: *DecompressionTask) Zlib.ZlibError!void {
            var reader = try Zlib.ZlibReaderArrayList.init(this.data, &this.output.list, default_allocator);
            try reader.readAll();
        }

        pub fn callback(task: *ThreadPool.Task) void {
            var this: *DecompressionTask = @fieldParentPtr(DecompressionTask, "task", task);
            this.callback_() catch |err| {
                this.err = err;
            };
            AsyncIO.triggerEvent(this.event_fd, &this.completion) catch {};
        }

        pub fn finished(this: *DecompressionTask, _: *Completion, _: void) void {
            resume this.frame;
        }
    };
};

pub fn processResponse(this: *HTTPClient, comptime report_progress: bool, comptime Client: type, client: Client, body_out_str: *MutableString) !picohttp.Response {
    defer if (this.verbose) Output.flush();
    var response: picohttp.Response = undefined;
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
            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(read_length);
                this.progress_node.?.context.maybeRefresh();
            }

            var request_body = request_buffer[0..read_length];
            read_headers_up_to = if (read_headers_up_to > read_length) read_length else read_headers_up_to;

            response = picohttp.Response.parseParts(request_body, &this.response_headers_buf, &read_headers_up_to) catch |err| {
                switch (err) {
                    error.ShortRead => {
                        continue :restart;
                    },
                    else => {
                        return err;
                    },
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

    for (response.headers) |header| {
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
                } else if (strings.eqlComptime(header.value, "deflate")) {
                    encoding = Encoding.deflate;
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
                var remainder = request_buffer[@intCast(usize, response.bytes_read)..read_length];
                last_read = remainder.len;
                try buffer.inflate(std.math.max(remainder.len, 2048));
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
                if (buffer.list.items[total_size..].len < @intCast(usize, decoder.bytes_left_in_chunk) or buffer.list.items[total_size..].len < 512) {
                    try buffer.inflate(std.math.max(total_size * 2, 1024));
                    buffer.list.expandToCapacity();
                }

                rret = try client.read(buffer.list.items, total_size);

                if (rret == 0) {
                    return error.ChunkedEncodingError;
                }

                rsize = rret;
                pret = picohttp.phr_decode_chunked(&decoder, buffer.list.items[total_size..].ptr, &rsize);
                if (pret == -1) return error.ChunkedEncodingParseError;

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
                    var gzip_timer = std.time.Timer.start() catch @panic("Timer failure");
                    body_out_str.list.expandToCapacity();
                    defer ZlibPool.instance.put(buffer_) catch unreachable;
                    ZlibPool.decompress(buffer.list.items, body_out_str) catch |err| {
                        Output.prettyErrorln("<r><red>Zlib error<r>", .{});
                        Output.flush();
                        return err;
                    };
                    this.gzip_elapsed = gzip_timer.read();
                },
                else => {},
            }

            if (comptime report_progress) {
                this.progress_node.?.activate();
                this.progress_node.?.setCompletedItems(body_out_str.list.items.len);
                this.progress_node.?.context.maybeRefresh();
            }

            this.body_size = @intCast(u32, body_out_str.list.items.len);
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
                    var gzip_timer = std.time.Timer.start() catch @panic("Timer failure");
                    body_out_str.list.expandToCapacity();
                    defer ZlibPool.instance.put(buffer_) catch unreachable;
                    ZlibPool.decompress(buffer.list.items, body_out_str) catch |err| {
                        Output.prettyErrorln("<r><red>Zlib error<r>", .{});
                        Output.flush();
                        return err;
                    };
                    this.gzip_elapsed = gzip_timer.read();
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

    return response;
}

pub fn sendHTTPS(this: *HTTPClient, body_str: []const u8, body_out_str: *MutableString) !picohttp.Response {
    this.socket = try AsyncSocket.SSL.init(default_allocator, &AsyncIO.global);
    var socket = &this.socket;
    this.stage = Stage.connect;
    try this.connect(*AsyncSocket.SSL, socket);
    this.stage = Stage.request;
    defer this.socket.close();

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
