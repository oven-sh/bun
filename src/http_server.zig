const std = @import("std");
const bun = @import("global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const picohttp = @import("picohttp");
const Header = picohttp.Header;
const HTTPRequest = picohttp.Request;
const StaticResponse = picohttp.Response;
pub const Headers = picohttp.Headers;
pub const MimeType = @import("./http/mime_type.zig");
const HiveArray = @import("./hive_array.zig").HiveArray;
const ObjectPool = @import("./pool.zig").ObjectPool;
const StringPointer = @import("./api/schema.zig").Api.StringPointer;
const StringBuilder = @import("./string_builder.zig");

const log = Output.scoped(.HTTPServer, false);

const ServerConfig = struct {
    port: u16,
};
const AsyncIO = @import("io");
pub const constants = struct {
    pub const OPEN_SOCKET_FLAGS = std.os.SOCK.CLOEXEC;
    pub const SOCKET_BACKLOG = 1024;
};

const FallbackBufferPool = ObjectPool([16384]u8, null, false, 256);

const SocketList = HiveArray(Socket, constants.SOCKET_BACKLOG);
const IncomingRequest = struct {
    http_request: HTTPRequest,
    body_chunk: []const u8 = "",
    fd: fd_t = 0,
    bytes: []u8,

    pub fn freeData(this: *IncomingRequest, allocator: std.mem.Allocator) void {
        _ = this;
        _ = allocator;
        // if (this.bytes.len > 0)
        //     allocator.free(this.bytes);
        // this.bytes.len = 0;
        // this.bytes.ptr = undefined;
        // this.body_chunk = "";
        // if (this.http_request.headers.len > 0)
        //     allocator.free(this.http_request.headers);
        // this.http_request.headers.len = 0;
        // this.http_request.headers.ptr = undefined;
    }

    pub fn create(allocator: std.mem.Allocator, request_recv: []u8, fd: fd_t, request: HTTPRequest) !IncomingRequest {
        var body_chunk = request_recv[@minimum(request.bytes_read, request_recv.len)..];

        var string_builder = StringBuilder{};
        request.count(&string_builder);
        if (body_chunk.len > 0) string_builder.count(body_chunk);
        try string_builder.allocate(allocator);
        var headers = try allocator.alloc(Header, request.headers.len);
        const new_request = request.clone(headers, &string_builder);
        return IncomingRequest{
            .http_request = new_request,
            .body_chunk = if (body_chunk.len > 0) string_builder.append(body_chunk) else "",
            .fd = fd,
            .bytes = string_builder.ptr.?[0..string_builder.cap],
        };
    }
};

const fd_t = std.os.fd_t;

const Data = struct {
    value: Value = Value{ .empty = void{} },
    len: u16 = 0,

    pub const Value = union(enum) {
        recv_buffer: *RecvBuffer,
        fallback_buffer: *FallbackBufferPool.Node,
        empty: void,
    };

    pub fn read(this: Data) []u8 {
        return switch (this.value) {
            .recv_buffer => this.value.recv_buffer[0..this.len],
            .fallback_buffer => this.value.fallback_buffer.data[0..this.len],
            .empty => &.{},
        };
    }

    pub fn writable(this: Data) []u8 {
        return switch (this.value) {
            .recv_buffer => this.value.recv_buffer[this.len..],
            .fallback_buffer => this.value.fallback_buffer.data[this.len..],
            .empty => &.{},
        };
    }
};

pub const RequestHandler = struct {
    ctx: *anyopaque,
    onRequest: fn (ctx: *anyopaque, incoming: IncomingRequest) bool,

    pub fn New(comptime HandlerType: type, comptime Function: anytype) type {
        return struct {
            pub fn init(handler: *HandlerType) RequestHandler {
                return RequestHandler{
                    .ctx = handler,
                    .onRequest = onRequest,
                };
            }

            pub fn onRequest(ctx: *anyopaque, incoming: IncomingRequest) bool {
                if (@typeInfo(@TypeOf(Function)).Fn.return_type.? == void) {
                    Function(@ptrCast(*HandlerType, @alignCast(@alignOf(HandlerType), ctx)), incoming);
                    return true;
                }

                return Function(@ptrCast(*HandlerType, @alignCast(@alignOf(HandlerType), ctx)), incoming);
            }
        };
    }
};

const recv_buffer_len = 4096;
const RecvBuffer = [recv_buffer_len]u8;
const RecvHiveArray = HiveArray(RecvBuffer, 128);
const CompletionPool = ObjectPool(AsyncIO.Completion, null, false, 256);

pub fn sendStaticMessageConcurrent(io: *AsyncIO, fd: fd_t, message: []const u8) void {
    const CompletionPoolBackup = ObjectPool(AsyncIO.Completion, null, false, 512);

    const doSendError = struct {
        pub fn send(
            this: *AsyncIO,
            completion: *AsyncIO.Completion,
            result: AsyncIO.SendError!usize,
        ) void {
            defer @fieldParentPtr(CompletionPoolBackup.Node, "data", completion).release();

            const amt = result catch |err| {
                if (err != error.EBADF)
                    sendClose(completion.operation.send.socket);
                return;
            };
            const remain = completion.operation.send.buf[0..completion.operation.send.len][amt..];
            if (amt == 0 or remain.len == 0) {
                sendClose(completion.operation.send.socket);
                return;
            }
            this.send(*AsyncIO, this, send, &CompletionPoolBackup.get(bun.default_allocator).data, completion.operation.send.socket, remain, 0);
        }
    }.send;
    io.send(*AsyncIO, io, doSendError, &CompletionPoolBackup.get(bun.default_allocator).data, fd, message, 0);
}

pub fn sendStaticMessage(fd: fd_t, message: []const u8) void {
    const doSendError = struct {
        pub fn send(
            _: *usize,
            completion: *AsyncIO.Completion,
            result: AsyncIO.SendError!usize,
        ) void {
            defer @fieldParentPtr(CompletionPool.Node, "data", completion).release();

            var amt = result catch {
                sendClose(completion.operation.send.socket);
                return;
            };
            const remain = completion.operation.send.buf[0..completion.operation.send.len][amt..];
            if (amt == 0 or remain.len == 0) {
                sendClose(completion.operation.send.socket);
                return;
            }
            AsyncIO.global.send(*usize, &amt, send, &CompletionPool.get(bun.default_allocator).data, completion.operation.send.socket, remain, 0);
        }
    }.send;
    const foo = struct {
        pub var garbage: usize = 1;
    };
    AsyncIO.global.send(*usize, &foo.garbage, doSendError, &CompletionPool.get(bun.default_allocator).data, fd, message, 0);
}

pub const Server = struct {
    recv_buffer: RecvHiveArray = RecvHiveArray.init(),
    listener: fd_t,
    accept_completion: AsyncIO.Completion = undefined,
    status: Status = Status.open,
    sockets: SocketList = SocketList.init(),
    handler: RequestHandler,
    shutdown_completion: AsyncIO.Completion = undefined,
    shutdown_requested: bool = false,
    pub fn quiet(this: *Server) void {
        this.status = .closing;
    }

    pub const Status = enum {
        open,
        closing,
        closed,
    };

    pub fn shutdown(this: *Server) void {
        if (this.shutdown_requested)
            return;
        this.shutdown_requested = true;
        log("shutdown");
        this.quiet();
        AsyncIO.global.nextTick(*Server, this, doShutdown, &this.shutdown_completion);
    }

    pub fn doShutdown(this: *Server, _: *AsyncIO.Completion, _: void) void {
        log("doShutdown");
        this.status = Status.closed;
        var iter = this.sockets.available.iterator(.{
            .kind = .unset,
        });

        while (iter.next()) |id| {
            this.sockets.buffer[id].reset();
            this.sockets.buffer[id].closeWithoutReset();
        }

        this.sockets = SocketList.init();
        this.recv_buffer = RecvHiveArray.init();
    }

    pub fn boot() void {}

    pub fn start(config: ServerConfig, handler: RequestHandler) !*Server {
        log("start port: {d}", .{config.port});
        const socket = try AsyncIO.openSocket(std.os.AF.INET, constants.OPEN_SOCKET_FLAGS | std.os.SOCK.STREAM, std.os.IPPROTO.TCP);
        errdefer std.os.close(socket);
        var listener: std.x.net.tcp.Listener = .{
            .socket = .{
                .fd = socket,
            },
        };
        // listener.setFastOpen(true) catch {};
        listener.setReuseAddress(true) catch {};
        listener.setReusePort(true) catch {};

        // listener.setKeepAlive(false) catch {};
        try listener.bind(std.x.net.ip.Address.initIPv4(std.x.os.IPv4.unspecified, config.port));
        _ = try AsyncIO.Syscall.fcntl(socket, std.os.F.SETFL, (try AsyncIO.Syscall.fcntl(socket, std.os.F.GETFL, 0)) | std.os.O.NONBLOCK);
        var server = try bun.default_allocator.create(Server);
        server.* = .{
            .listener = socket,
            .handler = handler,
        };
        try listener.listen(constants.SOCKET_BACKLOG);
        server.enqueueAccept();
        return server;
    }

    pub fn enqueueAccept(server: *Server) void {
        AsyncIO.global.accept(*Server, server, onAccept, &server.accept_completion, server.listener);
    }

    pub fn onAccept(
        this: *Server,
        _: *AsyncIO.Completion,
        result_: AsyncIO.AcceptError!std.os.socket_t,
    ) void {
        const fd = result_ catch |err| {
            log("onAccept error: {s}", .{@errorName(err)});
            return;
        };

        if (this.status == .closing or this.status == .closed) {
            log("onAccept closing fd: {d} because not accepting connections", .{fd});
            std.os.close(fd);
            return;
        }

        var socket = this.sockets.get() orelse {
            log("onAccept closing fd: {d} because no sockets available", .{fd});
            std.os.close(fd);
            return;
        };
        socket.server_ = this;

        socket.* = .{
            .fd = fd,
            .server_ = this,
        };

        socket.enqueueRecv() catch {
            log("onAccept closing fd: {d} because enqueueRecv failed", .{fd});
            std.os.close(fd);
            std.debug.assert(this.sockets.put(socket));
        };

        this.enqueueAccept();
    }

    pub fn dispatch(this: *Server, socket: *Socket, request: HTTPRequest) void {
        var incoming_request = IncomingRequest.create(bun.default_allocator, socket.data.read(), socket.fd, request) catch {
            log("Dropping request due to OOM!", .{});
            socket.reset();
            return;
        };

        // Reset the data before calling the handler to free up memory for the next request.
        socket.reset();
        std.debug.assert(this.sockets.put(socket));

        if (!this.handler.onRequest(this.handler.ctx, incoming_request)) {
            log("Dropping request due to handler failure!", .{});
            return;
        }
    }
};

fn sendClose(fd: fd_t) void {
    if (comptime Environment.isLinux) {
        const Closer = struct {
            pub fn onClose(_: void, completion: *AsyncIO.Completion, _: AsyncIO.CloseError!void) void {
                var node = @fieldParentPtr(CompletionPool.Node, "data", completion);
                node.releaase();
            }
        };

        AsyncIO.global.close(void, void{}, Closer.onClose, CompletionPool.get(bun.default_allocator), fd);
    } else {
        std.os.close(fd);
    }
}

const CompletionSwapper = struct {
    first: AsyncIO.Completion = undefined,
    second: AsyncIO.Completion = undefined,
    which: u1 = 0,

    pub fn get(this: *CompletionSwapper) *AsyncIO.Completion {
        if (this.which == 0) {
            this.which = 1;
            return &this.first;
        } else {
            this.which = 0;
            return &this.second;
        }
    }
};

const request_header_fields_too_large = "431 Request Header Fields Too Large" ++
    "\r\n" ++
    "Connection: close" ++
    "\r\n" ++
    "Server: bun" ++
    "\r\n" ++
    "Content-Type: text/plain" ++
    "\r\n" ++
    "Content-Length: 0" ++
    "\r\n" ++
    "\r\n";

const bad_request = "400 Bad Request" ++
    "\r\n" ++
    "Connection: close" ++
    "\r\n" ++
    "Server: bun" ++
    "\r\n" ++
    "Content-Type: text/plain" ++
    "\r\n" ++
    "Content-Length: 0" ++
    "\r\n" ++
    "\r\n";

const hello_world = "HTTP/1.1 " ++
    "200 OK" ++
    "\r\n" ++
    "Connection: close" ++
    "\r\n" ++
    "Server: bun" ++
    "\r\n" ++
    "Content-Type: text/plain" ++
    "\r\n" ++
    "Content-Length: 13" ++
    "\r\n" ++
    "\r\n" ++
    "Hello, world!";

pub const Socket = struct {
    recv_completion: CompletionSwapper = CompletionSwapper{},
    fd: fd_t,
    data: Data = .{},
    server_: *Server,

    pub fn reset(this: *Socket) void {
        switch (this.data.value) {
            .recv_buffer => |buf| {
                std.debug.assert(this.server().recv_buffer.put(buf));
                this.data = .{ .value = .{ .empty = void{} } };
            },
            .fallback_buffer => |buf| {
                buf.release();
                this.data = .{ .value = .{ .empty = void{} } };
            },
            .empty => {},
        }

        this.* = .{ .fd = 0, .server_ = undefined };
    }

    pub fn consume(this: *Socket, buf: []u8) !void {
        var writable = this.data.writable();
        if (buf.ptr == writable.ptr and writable.len >= buf.len) {
            this.data.len += @truncate(u16, buf.len);
            return;
        } else if (writable.len >= buf.len) {
            @memcpy(writable.ptr, buf.ptr, buf.len);
            this.data.len += @truncate(u16, buf.len);
            return;
        }
        const start_len = this.data.len;

        switch (this.data.value) {
            .recv_buffer => |recv| {
                var fallback = FallbackBufferPool.get(bun.default_allocator);
                @memcpy(&fallback.data, recv, start_len);
                std.debug.assert(this.server().recv_buffer.put(recv));
                @memcpy(fallback.data[start_len..].ptr, buf.ptr, buf.len);
                this.data = .{ .value = .{ .fallback_buffer = fallback }, .len = @truncate(u16, buf.len + start_len) };
            },
            .fallback_buffer => {
                return error.TooBig;
            },
            .empty => {
                if (buf.len <= recv_buffer_len) {
                    if (this.server().recv_buffer.get()) |recv| {
                        @memcpy(recv, buf.ptr, buf.len);
                        this.data = .{ .value = .{ .recv_buffer = recv }, .len = @truncate(u16, buf.len) };
                        return;
                    }
                }

                if (buf.len <= 16384) {
                    var fallback = FallbackBufferPool.get(bun.default_allocator);
                    @memcpy(&fallback.data, buf.ptr, buf.len);
                    this.data = .{ .value = .{ .fallback_buffer = fallback }, .len = @truncate(u16, buf.len) };
                }

                return error.TooBig;
            },
        }
    }

    pub fn cancelTimeout(this: *Socket) void {
        _ = this;
    }

    fn getNextBuffer(this: *Socket) []u8 {
        var next_buffer: []u8 = this.data.writable();

        if (next_buffer.len < 512) {
            var buf = this.data.read();
            if (buf.len == 0) {
                if (this.server().recv_buffer.get()) |recv| {
                    this.data = .{ .value = .{ .recv_buffer = recv }, .len = @truncate(u16, buf.len) };
                    return this.data.writable();
                }
            }

            if (this.data.value == .recv_buffer) {
                var fallback = FallbackBufferPool.get(bun.default_allocator);
                @memcpy(&fallback.data, buf.ptr, buf.len);
                this.data = .{ .value = .{ .fallback_buffer = fallback }, .len = @truncate(u16, buf.len) };
                return this.data.writable();
            }
        }

        return next_buffer;
    }

    pub fn enqueueRecv(this: *Socket) !void {
        this.setTimeout();

        var next_buffer = this.getNextBuffer();
        if (next_buffer.len == 0) {
            return error.TooBig;
        }

        AsyncIO.global.recv(
            *Socket,
            this,
            Socket.onRecv,
            this.recv_completion.get(),
            this.fd,
            next_buffer,
        );
    }

    pub fn close(this: *Socket) void {
        this.reset();

        this.closeWithoutReset();
        std.debug.assert(this.server().sockets.put(this));
    }

    pub fn closeWithoutReset(this: *Socket) void {
        std.debug.assert(this.fd > 0);
        sendClose(this.fd);

        this.fd = 0;
    }

    pub fn onRecv(
        this: *Socket,
        completion: *AsyncIO.Completion,
        read_: AsyncIO.RecvError!usize,
    ) void {
        const read = read_ catch |err| {
            log("onRecv error: {s}", .{@errorName(err)});
            this.close();
            return;
        };

        if (read == 0) {
            log("onRecv disconnected socket", .{});
            this.close();
            return;
        }

        this.consume(completion.operation.recv.buf[0..read]) catch |err| {
            switch (err) {
                error.TooBig => {
                    log("onRecv TooBig", .{});
                    this.reset();
                    sendStaticMessage(this.fd, request_header_fields_too_large);

                    return;
                },
            }
        };

        var headers: [512]picohttp.Header = undefined;
        const request = HTTPRequest.parse(this.data.read(), &headers) catch |err| {
            switch (err) {
                error.BadRequest => {
                    log("onRecv bad request", .{});
                    this.reset();
                    sendStaticMessage(this.fd, bad_request);

                    return;
                },
                error.ShortRead => {
                    this.enqueueRecv() catch {
                        log("onRecv TooBig (on enqueue)", .{});
                        this.reset();
                        sendStaticMessage(this.fd, request_header_fields_too_large);
                    };
                    return;
                },
            }
        };
        log("onRecv request: {any}", .{request});
        this.cancelTimeout();
        this.server().dispatch(this, request);
    }

    pub fn setTimeout(_: *Socket) void {}

    pub fn server(this: *Socket) *Server {
        return this.server_;
    }
};

const NetworkThread = @import("./network_thread.zig");

pub const ToySingleThreadedHTTPServer = struct {
    pub const Handler = RequestHandler.New(ToySingleThreadedHTTPServer, onRequest);
    server: *Server,
    task: NetworkThread.Task = .{ .callback = startServer },

    pub fn onRequest(
        _: *ToySingleThreadedHTTPServer,
        incoming: IncomingRequest,
    ) void {
        log("onRequest: {any}", .{incoming});
        sendStaticMessage(incoming.fd, hello_world);
        var inc = incoming;
        inc.freeData(bun.default_allocator);
    }

    pub fn drain(_: *ToySingleThreadedHTTPServer) void {}

    pub fn loop(this: *ToySingleThreadedHTTPServer) void {
        this.drain();

        while (true) {
            AsyncIO.global.wait(this, drain);
        }
    }

    pub fn startServer(task: *NetworkThread.Task) void {
        var toy_config = ServerConfig{
            .port = std.fmt.parseInt(u16, std.os.getenv("PORT") orelse "3001", 10) catch 3001,
        };
        defer Output.prettyln("Server started on port {d}", .{toy_config.port});
        defer Output.flush();

        var toy = @fieldParentPtr(ToySingleThreadedHTTPServer, "task", task);
        toy.server = Server.start(toy_config, RequestHandler.New(ToySingleThreadedHTTPServer, onRequest).init(toy)) catch unreachable;
    }

    pub fn main() anyerror!void {
        var http = try bun.default_allocator.create(ToySingleThreadedHTTPServer);

        var stdout_ = std.io.getStdOut();
        var stderr_ = std.io.getStdErr();
        var output_source = Output.Source.init(stdout_, stderr_);
        Output.Source.set(&output_source);
        defer Output.flush();
        try NetworkThread.init();
        http.* = .{
            .server = undefined,
        };
        NetworkThread.global.schedule(NetworkThread.Batch.from(&http.task));
        while (true) {
            std.time.sleep(std.time.ns_per_hour);
        }
    }
};

pub const ToyHTTPServer = struct {
    const Lock = @import("./lock.zig").Lock;

    pub const Handler = RequestHandler.New(*ToyHTTPServer, onRequest);
    const Fifo = std.fifo.LinearFifo(IncomingRequest, .Dynamic);
    server: *Server,
    pending: Fifo,
    active: Fifo,
    lock: Lock = Lock.init(),
    io: AsyncIO,
    task: NetworkThread.Task = .{ .callback = startServer },

    pub fn onRequest(
        this: *ToyHTTPServer,
        incoming: IncomingRequest,
    ) void {
        {
            this.lock.lock();
            this.pending.writeItem(incoming) catch unreachable;
            defer this.lock.unlock();
        }
        this.io.waker.wake() catch unreachable;
    }

    pub fn drain(this: *ToyHTTPServer) void {
        const all = this.pending.readableSlice(0);
        this.active.write(all) catch unreachable;
        this.pending.count = 0;
        this.pending.head = 0;
    }

    pub fn loop(this: *ToyHTTPServer) void {
        this.drain();

        while (true) {
            while (this.active.readItem()) |*incoming| {
                defer incoming.freeData(bun.default_allocator);
                sendStaticMessageConcurrent(&this.io, incoming.fd, hello_world);
            }

            this.io.wait(this, drain);
        }
    }

    pub fn startServer(task: *NetworkThread.Task) void {
        var toy_config = ServerConfig{
            .port = std.fmt.parseInt(u16, std.os.getenv("PORT") orelse "3001", 10) catch 3001,
        };
        defer Output.prettyln("Server started on port {d}", .{toy_config.port});
        defer Output.flush();

        var toy = @fieldParentPtr(ToyHTTPServer, "task", task);
        toy.server = Server.start(toy_config, RequestHandler.New(ToyHTTPServer, onRequest).init(toy)) catch unreachable;
    }

    pub fn main() anyerror!void {
        var http = try bun.default_allocator.create(ToyHTTPServer);

        var stdout_ = std.io.getStdOut();
        var stderr_ = std.io.getStdErr();
        var output_source = Output.Source.init(stdout_, stderr_);
        Output.Source.set(&output_source);
        defer Output.flush();
        try NetworkThread.init();
        http.* = .{
            .pending = Fifo.init(bun.default_allocator),
            .active = Fifo.init(bun.default_allocator),
            .io = try AsyncIO.init(1024, 0, try AsyncIO.Waker.init(bun.default_allocator)),
            .server = undefined,
        };
        NetworkThread.global.schedule(NetworkThread.Batch.from(&http.task));
        http.loop();
    }
};

pub const main = if (@hasDecl(@import("build_options"), "toy_single_threaded_http_server"))
    ToySingleThreadedHTTPServer.main
else
    ToyHTTPServer.main;

test "ToyHTTPServer" {
    try ToyHTTPServer.main();
}
