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
const Lock = @import("./lock.zig").Lock;
const log = Output.scoped(.HTTPServer, false);
const uWS = @import("uws");
const adjustUlimit = @import("./fs.zig").FileSystem.RealFS.adjustUlimit;

const ServerConfig = struct {
    port: u16 = 3001,
    host: []const u8 = "0.0.0.0",
    reuse_port: bool = true,
};
const AsyncIO = @import("io");
pub const constants = struct {
    pub const OPEN_SOCKET_FLAGS = std.os.SOCK.CLOEXEC | std.os.SO.REUSEADDR | std.os.SO.REUSEPORT;
    pub const SOCKET_BACKLOG = 1024;
};

const FallbackBufferPool = ObjectPool([16384]u8, null, false, 1024);

const IncomingRequest = struct {
    http_request: HTTPRequest,
    body_chunk: []const u8 = "",
    fd: fd_t = 0,
    bytes: []u8,

    pub fn freeData(this: *IncomingRequest, allocator: std.mem.Allocator) void {
        if (this.bytes.len > 0)
            allocator.free(this.bytes);
        this.bytes.len = 0;
        this.bytes.ptr = undefined;
        this.body_chunk = "";
        if (this.http_request.headers.len > 0)
            allocator.free(this.http_request.headers);
        this.http_request.headers.len = 0;
        this.http_request.headers.ptr = undefined;
    }

    pub fn create(allocator: std.mem.Allocator, request_recv: []const u8, fd: fd_t, request: HTTPRequest) !IncomingRequest {
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

pub const RequestHandler = struct {
    ctx: *anyopaque,
    onRequest: fn (ctx: *anyopaque, conn: *Connection, incoming: IncomingRequest) bool,

    pub fn New(comptime HandlerType: type, comptime Function: anytype) type {
        return struct {
            pub fn init(handler: *HandlerType) RequestHandler {
                return RequestHandler{
                    .ctx = handler,
                    .onRequest = onRequest,
                };
            }

            pub fn onRequest(ctx: *anyopaque, conn: *Connection, incoming: IncomingRequest) bool {
                if (@typeInfo(@TypeOf(Function)).Fn.return_type.? == void) {
                    Function(@ptrCast(*HandlerType, @alignCast(@alignOf(HandlerType), ctx)), conn, incoming);
                    return true;
                }

                return Function(@ptrCast(*HandlerType, @alignCast(@alignOf(HandlerType), ctx)), conn, incoming);
            }
        };
    }
};

pub const Server = struct {
    listener: *uWS.listen_socket_t,
    ctx: *uWS.us_socket_context_t,
    status: Status = Status.open,
    handler: RequestHandler,
    shutdown_requested: bool = false,
    loop: *uWS.Loop = undefined,

    pending_sockets_to_return: PendingSocketsList = PendingSocketsList.init(),
    pending_sockets_to_return_lock: Lock = Lock.init(),
    pending_sockets_to_return_scheduled: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

    pub fn flushPendingSocketsToReturn(server: *Server) void {
        server.pending_sockets_to_return_scheduled.store(0, .Monotonic);
        server.pending_sockets_to_return_lock.lock();
        var sockets_slice = server.pending_sockets_to_return.readableSlice(0);
        var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
        var allocator = stack_fallback.get();
        var list = allocator.dupe(u32, sockets_slice) catch unreachable;
        server.pending_sockets_to_return.head = 0;
        server.pending_sockets_to_return.count = 0;
        server.pending_sockets_to_return_lock.unlock();

        defer {
            if (!stack_fallback.fixed_buffer_allocator.ownsSlice(std.mem.sliceAsBytes(list))) {
                allocator.free(list);
            }
        }

        for (list) |fd| {
            _ = uWS.SocketTCP.attach(@intCast(c_int, fd), server.ctx);
        }
    }

    const PendingSocketsList = std.fifo.LinearFifo(u32, .{ .Static = constants.SOCKET_BACKLOG });

    pub fn takeAsync(this: *Server, socket: fd_t) void {
        this.pending_sockets_to_return_lock.lock();
        {
            this.pending_sockets_to_return.writeItemAssumeCapacity(@intCast(u32, socket));
        }
        if (this.pending_sockets_to_return_scheduled.fetchAdd(1, .Monotonic) == 0)
            this.loop.wakeup();
        this.pending_sockets_to_return_lock.unlock();
    }

    pub fn take(server: *Server, fd: fd_t) void {
        _ = uWS.SocketTCP.attach(fd, server.ctx);
    }

    pub fn quiet(this: *Server) void {
        if (this.status != .open)
            return;

        this.status = .closing;
        this.listener.close(false);
        this.status = .closed;
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
    }

    pub fn boot() void {}

    pub fn start(config: ServerConfig, handler: RequestHandler) !*Server {
        log("start port: {d}", .{config.port});

        var server = try bun.default_allocator.create(Server);
        var ctx = server.createContext() orelse return error.OutOfMemory;
        uWS.SocketTCP.configure(
            ctx,
            Connection,
            Connection.onOpen,
            Connection.onClose,
            Connection.onData,
            Connection.onWritable,
            Connection.onTimeout,
            Connection.onConnectError,
            Connection.onEnd,
        );

        server.* = .{
            .listener = undefined,
            .ctx = ctx,
            .handler = handler,
            .status = .open,
            .loop = uWS.Loop.get().?,
        };

        if (uWS.SocketTCP.listen(config.host, config.port, ctx, *Server, server, "listener") == null) {
            return error.ListenFailed;
        }

        server.* = .{
            .listener = server.listener,
            .ctx = ctx,
            .handler = handler,
            .status = .open,
            .loop = uWS.Loop.get().?,
        };
        _ = server.loop.addPostHandler(*Server, server, flushPendingSocketsToReturn);
        return server;
    }
    pub fn createContext(server: *Server) ?*uWS.us_socket_context_t {
        var loop = uWS.Loop.get().?;
        var ctx = uWS.us_create_socket_context(0, loop, @sizeOf(*Server), .{}) orelse return null;
        var ptr = @ptrCast(**Server, @alignCast(@alignOf(*Server), uWS.us_socket_context_ext(0, ctx).?));
        ptr.* = server;
        return ctx;
    }

    pub fn dispatch(this: *Server, connection: *Connection, incoming_request: IncomingRequest) void {
        if (this.handler.onRequest(this.handler.ctx, connection, incoming_request)) {
            return;
        }
        _ = connection.socket.write(bad_request, false);
        connection.socket.close(0, null);
    }
};

const CompletionSwapper = struct {
    first: AsyncIO.Completion = undefined,
    second: AsyncIO.Completion = undefined,
    which: u1 = 0,

    pub fn get(this: *CompletionSwapper) *AsyncIO.Completion {
        if (this.which == 0) {
            this.which = 1;
            this.first = undefined;
            return &this.first;
        } else {
            this.which = 0;
            this.second = undefined;
            return &this.second;
        }
    }
};

const CRLF = [2]u8{ '\r', '\n' };

const request_header_fields_too_large = "431 Request Header Fields Too Large" ++
    CRLF ++
    "Connection: close" ++
    CRLF ++
    "Server: bun" ++
    CRLF ++
    "Content-Type: text/plain" ++
    CRLF ++
    "Content-Length: 0" ++
    CRLF ++
    CRLF;

const bad_request = "400 Bad Request" ++
    CRLF ++
    "Connection: close" ++
    CRLF ++
    "Server: bun" ++
    CRLF ++
    "Content-Type: text/plain" ++
    CRLF ++
    "Content-Length: 0" ++
    CRLF ++
    CRLF;

const hello_world = "HTTP/1.1 200 OK" ++
    CRLF ++
    "Connection: keep-alive" ++
    CRLF ++
    "Server: bun" ++
    CRLF ++
    "Content-Type: text/plain" ++
    CRLF ++
    "Content-Length: 13" ++
    CRLF ++ CRLF ++
    "Hello, world!";

pub const Connection = struct {
    socket: uWS.SocketTCP,
    incoming_request: IncomingRequest = undefined,
    is_writable: bool = false,
    has_received: bool = false,
    has_incoming_request: bool = false,

    pub fn onOpen(this: *Connection, socket: uWS.SocketTCP) void {
        this.socket = socket;
        socket.timeout(30);
        this.is_writable = false;
        log("Client connected", .{});
    }

    fn dispatch(this: *Connection, incoming_request: IncomingRequest) void {
        this.has_received = false;
        this.is_writable = false;
        this.server().dispatch(this, incoming_request);
        return;
    }

    pub fn onClose(this: *Connection, socket: uWS.SocketTCP, _: c_int, _: ?*anyopaque) void {
        _ = this;
        _ = socket;

        log("Client disconnected", .{});
    }

    pub fn onWritable(this: *Connection, socket: uWS.SocketTCP) void {
        _ = this;
        _ = socket;

        this.is_writable = true;
    }

    pub fn onData(this: *Connection, socket: uWS.SocketTCP, data: []const u8) void {
        _ = this;
        _ = socket;
        _ = data;
        socket.timeout(30);

        var headers: [512]picohttp.Header = undefined;
        const request = HTTPRequest.parse(data, &headers) catch |err| {
            switch (err) {
                error.BadRequest => {
                    log("onRecv bad request", .{});
                    this.socket.close(0, null);
                    return;
                },
                error.ShortRead => {
                    return;
                },
            }
        };

        const fd = @intCast(fd_t, @ptrToInt(socket.handle().?));
        if (this.has_incoming_request) {
            this.incoming_request.freeData(bun.default_allocator);
        }
        this.has_received = true;
        this.has_incoming_request = true;
        this.dispatch(IncomingRequest.create(bun.default_allocator, data, fd, request) catch {
            log("Dropping request due to OOM!", .{});
            this.socket.close(0, null);
            return;
        });
    }

    pub fn onTimeout(this: *Connection, socket: uWS.SocketTCP) void {
        _ = this;
        _ = socket;
        socket.close(0, null);
    }

    pub fn onConnectError(this: *Connection, socket: uWS.SocketTCP, code: c_int) void {
        _ = this;
        _ = socket;
        _ = code;
    }

    pub fn onEnd(this: *Connection, socket: uWS.SocketTCP) void {
        _ = this;
        _ = socket;

        socket.shutdown();
        socket.close(0, null);
    }

    pub inline fn server(this: Connection) *Server {
        return @ptrCast(**Server, @alignCast(@alignOf(*Server), uWS.us_socket_context_ext(0, this.socket.context())).?).*;
    }
};

const NetworkThread = @import("./network_thread.zig");

pub const ToySingleThreadedHTTPServer = struct {
    pub const Handler = RequestHandler.New(ToySingleThreadedHTTPServer, onRequest);
    server: *Server,

    pub fn onRequest(
        this: *ToySingleThreadedHTTPServer,
        connection: *Connection,
        _: IncomingRequest,
    ) bool {
        _ = this;

        const wrote = connection.socket.write(hello_world, true);
        if (wrote < hello_world.len) {
            log("onRequest: write failed", .{});
            connection.socket.close(0, null);
            return false;
        }

        // incoming.freeData(bun.default_allocator);
        return true;
    }

    pub fn startServer(toy: *ToySingleThreadedHTTPServer) void {
        var toy_config = ServerConfig{
            .port = std.fmt.parseInt(u16, std.os.getenv("PORT") orelse "3001", 10) catch 3001,
        };
        defer Output.prettyln("Server started on port {d}", .{toy_config.port});
        defer Output.flush();

        toy.server = Server.start(toy_config, RequestHandler.New(ToySingleThreadedHTTPServer, onRequest).init(toy)) catch unreachable;
        toy.server.loop.run();
    }

    pub fn main() anyerror!void {
        var http = try bun.default_allocator.create(ToySingleThreadedHTTPServer);
        http.* = .{ .server = undefined };

        var stdout_ = std.io.getStdOut();
        var stderr_ = std.io.getStdErr();
        var output_source = Output.Source.init(stdout_, stderr_);
        Output.Source.set(&output_source);
        _ = try adjustUlimit();
        defer Output.flush();
        startServer(http);
    }
};

pub const ToyHTTPServer = struct {
    pub const Handler = RequestHandler.New(*ToyHTTPServer, onRequest);
    const Fifo = std.fifo.LinearFifo(IncomingRequest, .{ .Static = 4096 });
    server: *Server,
    pending: std.BoundedArray(IncomingRequest, 2048) = std.BoundedArray(IncomingRequest, 2048).init(0) catch unreachable,
    active: Fifo,
    lock: Lock = Lock.init(),
    loop: *uWS.Loop,
    has_scheduled: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    ctx: *uWS.us_socket_context_t = undefined,
    waker: AsyncIO.Waker = undefined,
    // active_requests: HiveArray(WritableSocket, 1024) = HiveArray(WritableSocket, 1024).init(),

    pub fn onRequest(
        this: *ToyHTTPServer,
        connection: *Connection,
        incoming: IncomingRequest,
    ) bool {
        _ = connection.socket.detach();

        {
            this.lock.lock();
            this.pending.buffer[this.pending.len] = incoming;
            this.pending.len += 1;
            defer this.lock.unlock();
        }

        this.loop.wakeup();
        this.waker.wake() catch unreachable;
        return true;
    }

    pub fn drain(this: *ToyHTTPServer) void {
        {
            this.has_scheduled.store(0, .Monotonic);
            this.lock.lock();
            defer this.lock.unlock();
            const all = this.pending.slice();
            this.active.write(all) catch unreachable;
            this.pending.len = 0;
        }
        var ctx = this.ctx;

        while (this.active.readItem()) |incoming| {
            var socket = uWS.SocketTCP.attach(incoming.fd, ctx) orelse continue;
            _ = socket.write(hello_world, true);
            _ = socket.detach();
            this.server.takeAsync(incoming.fd);
        }
    }

    // pub fn dispatch(this: *ToyHTTPServer, socket: *WritableSocket, _: IncomingRequest) void {
    //     this.server.takeAsync(socket.socket.detach());
    // }

    pub const WritableSocket = struct {
        socket: uWS.SocketTCP,
        incoming_request: IncomingRequest = undefined,
        is_writable: bool = false,
        has_received: bool = false,
        has_incoming_request: bool = false,

        pub fn onOpen(_: *WritableSocket, _: uWS.SocketTCP) void {
            // this.socket = socket;
            // socket.timeout(30);
            // this.is_writable = false;
            // log("Client connected", .{});
        }

        pub fn dispatch(this: *WritableSocket) void {
            this.has_received = false;
            this.is_writable = false;
            // this.server().dispatch(this, this.incoming_request);
            return;
        }

        pub fn onClose(this: *WritableSocket, socket: uWS.SocketTCP, _: c_int, _: ?*anyopaque) void {
            _ = this;
            _ = socket;

            log("Client disconnected", .{});
        }

        pub fn onWritable(this: *WritableSocket, socket: uWS.SocketTCP) void {
            _ = this;
            _ = socket;

            this.is_writable = true;
        }

        pub fn onData(this: *WritableSocket, socket: uWS.SocketTCP, data: []const u8) void {
            _ = this;
            _ = socket;
            _ = data;
            // socket.timeout(30);

            // var headers: [512]picohttp.Header = undefined;
            // const request = HTTPRequest.parse(data, &headers) catch |err| {
            //     switch (err) {
            //         error.BadRequest => {
            //             log("onRecv bad request", .{});
            //             this.socket.close(0, null);
            //             return;
            //         },
            //         error.ShortRead => {
            //             return;
            //         },
            //     }
            // };

            // const fd = @intCast(fd_t, @ptrToInt(socket.handle().?));
            // if (this.has_incoming_request) {
            //     this.incoming_request.freeData(bun.default_allocator);
            // }
            // this.incoming_request = IncomingRequest.create(bun.default_allocator, data, fd, request) catch {
            //     log("Dropping request due to OOM!", .{});
            //     this.socket.close(0, null);
            //     return;
            // };
            // this.has_received = true;
            // this.has_incoming_request = true;
            // this.dispatch();
        }

        pub fn onTimeout(this: *WritableSocket, socket: uWS.SocketTCP) void {
            _ = this;
            _ = socket;
            socket.close(0, null);
        }

        pub fn onConnectError(this: *WritableSocket, socket: uWS.SocketTCP, code: c_int) void {
            _ = this;
            _ = socket;
            _ = code;
        }

        pub fn onEnd(this: *WritableSocket, socket: uWS.SocketTCP) void {
            _ = this;
            _ = socket;

            socket.shutdown();
            socket.close(0, null);
        }

        pub inline fn server(this: WritableSocket) *ToyHTTPServer {
            return @ptrCast(**ToyHTTPServer, @alignCast(@alignOf(*ToyHTTPServer), uWS.us_socket_context_ext(0, this.socket.context())).?).*;
        }
    };

    pub fn startServer(toy: *ToyHTTPServer) void {
        Output.Source.configureNamedThread("ToyHTTPServer");
        var toy_config = ServerConfig{
            .port = std.fmt.parseInt(u16, std.os.getenv("PORT") orelse "3001", 10) catch 3001,
        };
        defer Output.prettyln("Server started on port {d}", .{toy_config.port});
        defer Output.flush();

        toy.server = Server.start(toy_config, RequestHandler.New(ToyHTTPServer, onRequest).init(toy)) catch unreachable;
        toy.server.loop.run();
    }

    pub fn main() anyerror!void {
        var http = try bun.default_allocator.create(ToyHTTPServer);
        var stdout_ = std.io.getStdOut();
        var stderr_ = std.io.getStdErr();
        var output_source = Output.Source.init(stdout_, stderr_);
        _ = try adjustUlimit();
        Output.Source.set(&output_source);
        defer Output.flush();
        http.* = .{
            .active = Fifo.init(),
            .server = undefined,
            .loop = uWS.Loop.get().?,
            .waker = AsyncIO.Waker.init(bun.default_allocator) catch unreachable,
        };
        http.ctx = uWS.us_create_socket_context(0, http.loop, 8, .{}).?;
        uWS.SocketTCP.configure(
            http.ctx,
            WritableSocket,
            WritableSocket.onOpen,
            WritableSocket.onClose,
            WritableSocket.onData,
            WritableSocket.onWritable,
            WritableSocket.onTimeout,
            WritableSocket.onConnectError,
            WritableSocket.onEnd,
        );

        @ptrCast(**anyopaque, @alignCast(@alignOf(*anyopaque), uWS.us_socket_context_ext(0, http.ctx).?)).* = @ptrCast(*anyopaque, &http);
        _ = http.loop.addPostHandler(*ToyHTTPServer, http, drain);
        var thread = std.Thread.spawn(.{}, startServer, .{http}) catch unreachable;
        http.drain();

        thread.detach();
        while (true) {
            http.loop.nextTick(*ToyHTTPServer, http, drain);
            _ = http.waker.wait() catch 0;
            http.drain();
            http.loop.run();
        }
    }
};

pub const main = if (@hasDecl(@import("build_options"), "toy_single_threaded_http_server"))
    ToySingleThreadedHTTPServer.main
else
    ToyHTTPServer.main;

test "ToyHTTPServer" {
    try ToyHTTPServer.main();
}
