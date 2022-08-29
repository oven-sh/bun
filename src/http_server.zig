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
const IncomingRequest = picohttp.Request;
const StaticResponse = picohttp.Response;
pub const Headers = picohttp.Headers;
pub const MimeType = @import("./http/mime_type.zig");
const Syscall = @import("./bun.js/node/syscall.zig");
const HiveArray = @import("./hive_array.zig").HiveArray;
const JSC = @import("./jsc.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;

const log = Output.scoped(.HTTPServer, false);

const ServerConfig = @import("./bun.js/api/server.zig").ServerConfig;
const AsyncIO = @import("io");
pub const constants = struct {
    pub const OPEN_SOCKET_FLAGS = std.os.SOCK.CLOEXEC;
    pub const PADDING = 64;
    pub const RECV_BUFFER_LENGTH = (1024 * 512) - (PADDING * 2);
    pub const SOCKET_BACKLOG = 1024;
};

const FallbackBuffer = std.BoundedArray(u8, 16384);
const FallbackBufferPool = ObjectPool(FallbackBuffer, null, false, 256);

const SocketList = HiveArray(Socket, constants.SOCKET_BACKLOG);

const fd_t = JSC.Node.FileDescriptor;

pub const Server = struct {
    recv_buffer_bytes: [constants.RECV_BUFFER_LENGTH]u8 align(constants.PADDING) = undefined,
    recv_buffer: []u8 = &.{},
    listener: fd_t,
    accept_completion: AsyncIO.Completion = undefined,
    accept_connections: bool = true,
    sockets: SocketList = SocketList.init(),

    pub fn start(config: ServerConfig) !*Server {
        const socket = try AsyncIO.openSocket(std.os.af.INET, constants.OPEN_SOCKET_FLAGS | std.os.SOCK.STREAM, std.os.IPPROTO.TCP);
        errdefer std.os.close(socket);
        var listener: std.x.net.tcp.Listener = .{
            .socket = .{
                .fd = socket,
            },
        };
        listener.setFastOpen(true) catch {};
        listener.setReuseAddress(true) catch {};
        listener.setReusePort(true) catch {};
        listener.setKeepAlive(false) catch {};
        try listener.bind(std.x.net.ip.Address.initIPv4(std.x.os.IPv4.unspecified, config.port));
        var server = try bun.default_allocator.create(Server);
        server.* = .{
            .listener = socket,
        };
        server.recv_buffer = &server.recv_buffer_bytes;
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

        if (!this.accept_connections) {
            log("onAccept closing fd: {d} because accept_connections is false", .{fd});
            std.os.close(fd);
            return;
        }

        var socket = this.sockets.get() orelse {
            log("onAccept closing fd: {d} because no sockets available", .{fd});
            std.os.close(fd);
            return;
        };

        socket.* = .{
            .fd = fd,
        };

        socket.enqueueRecv();
        this.enqueueAccept();
    }
};

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

pub const Socket = struct {
    fd: fd_t = 0,
    read_slice: []u8 = &.{},
    recv_completion: CompletionSwapper = CompletionSwapper{},

    pub fn enqueueRecv(this: *Socket) void {
        this.setTimeout();
        AsyncIO.global.recv(*Socket, this, Socket.onRecv, this.recv_completion.get(), this.fd, this.getNextBuffer());
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

        this.consume(completion.operation.recv.buf[0..read]);

        var headers: [512]picohttp.Header = undefined;
        var data = this.getData() catch |err| {
            switch (err) {
                error.TooBig => {
                    log("onRecv TooBig", .{});
                    this.server().sendError(this.fd, request_header_fields_too_large);
                    this.reset();
                    return;
                },
            }
        };
        const request = IncomingRequest.parse(data.slice(), &headers) catch |err| {
            switch (err) {
                error.BadRequest => {
                    log("onRecv bad request", .{});
                    this.server().sendError(this.fd, bad_request);
                    this.reset();
                    return;
                },
                error.ShortRead => {
                    this.enqueueRecv();
                    return;
                },
            }
        };
        log("onRecv request: {any}", .{request});
        this.cancelTimeout();
        this.server().dispatch(this.fd, request, data);
        this.reset();
    }

    pub fn server(this: *Socket) *Server {
        return @fieldParentPtr(Server, "sockets", @fieldParentPtr(SocketList, "data", this));
    }
};
