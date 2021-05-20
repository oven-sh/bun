// const c = @import("./c.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const Api = @import("./api/schema.zig").Api;

const tcp = std.x.net.tcp;
const ip = std.x.net.ip;

const IPv4 = std.x.os.IPv4;
const IPv6 = std.x.os.IPv6;
const Socket = std.x.os.Socket;
const os = std.os;

const picohttp = @import("picohttp");
const Header = picohttp.Header;
const Request = picohttp.Request;
const Response = picohttp.Response;
const Headers = picohttp.Headers;

pub const Server = struct {
    options: *Api.TransformOptions,
    allocator: *std.mem.Allocator,

    threadlocal var headers_buf: [100]picohttp.Header = undefined;

    fn run(server: *Server) !void {
        const listener = try tcp.Listener.init(.ip, os.SOCK_CLOEXEC);
        defer listener.deinit();

        listener.setReuseAddress(true) catch {};
        listener.setReusePort(true) catch {};
        listener.setFastOpen(true) catch {};
        // try listener.ack(true);

        try listener.bind(ip.Address.initIPv4(IPv4.unspecified, 9000));
        try listener.listen(128);

        // try listener.set(true);

        while (true) {
            var conn = try listener.accept(os.SOCK_CLOEXEC);
            server.handleConnection(&conn);
        }
    }

    pub fn writeStatus(server: *Server, comptime code: u9, conn: *tcp.Connection) !void {
        _ = try conn.client.write(std.fmt.comptimePrint("HTTP/1.1 {d}\r\n", .{code}), os.SOCK_CLOEXEC);
    }

    pub fn sendError(server: *Server, request: *Request, conn: *tcp.Connection, code: u9, msg: string) !void {
        try server.writeStatus(code, connection);
        conn.deinit();
    }

    pub fn handleRequest(server: *Server, request: *Request, conn: *tcp.Connection) !void {
        try server.writeStatus(200, conn);
        conn.deinit();
        // switch (request.method) {
        //     .GET, .HEAD => {},
        //     else => {},
        // }
    }

    pub fn handleConnection(server: *Server, conn: *tcp.Connection) void {
        errdefer conn.deinit();
        // https://stackoverflow.com/questions/686217/maximum-on-http-header-values
        var req_buf: [std.mem.page_size]u8 = undefined;
        var read_size = conn.client.read(&req_buf, os.SOCK_CLOEXEC) catch |err| {
            return;
        };
        var req = picohttp.Request.parse(req_buf[0..read_size], &headers_buf) catch |err| {
            Output.printError("ERR: {s}", .{@errorName(err)});

            return;
        };
        server.handleRequest(&req, conn) catch |err| {
            Output.printError("FAIL [{s}] - {s}: {s}", .{ @errorName(err), @tagName(req.method), req.path });
            conn.deinit();
            return;
        };
        Output.print("[{s}] - {s}", .{ @tagName(req.method), req.path });
    }

    pub fn start(allocator: *std.mem.Allocator, options: *Api.TransformOptions) !void {
        var server = Server{ .options = options, .allocator = allocator };

        try server.run();
    }
};

// fn indexHandler(req: Request, res: Response) !void {
//     try res.write("hi\n");
// }

// fn aboutHandler(req: Request, res: Response) !void {
//     try res.write("Hello from about\n");
// }

// fn aboutHandler2(req: Request, res: Response) !void {
//     try res.write("Hello from about2\n");
// }

// fn postHandler(req: Request, res: Response, args: *const struct {
//     post_num: []const u8,
// }) !void {
//     try res.print("Hello from post, post_num is {s}\n", .{args.post_num});
// }

// var counter = std.atomic.Int(usize).init(0);
// fn counterHandler(req: Request, res: Response) !void {
//     try res.print("Page loaded {d} times\n", .{counter.fetchAdd(1)});
// }
