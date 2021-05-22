// const c = @import("./c.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const Api = @import("./api/schema.zig").Api;
const bundler = @import("bundler.zig");

const tcp = std.x.net.tcp;
const ip = std.x.net.ip;

const IPv4 = std.x.os.IPv4;
const IPv6 = std.x.os.IPv6;
const Socket = std.x.os.Socket;
const os = std.os;

const picohttp = @import("./deps/picohttp.zig");
const Header = picohttp.Header;
const Request = picohttp.Request;
const Response = picohttp.Response;
const Headers = picohttp.Headers;
const MimeType = @import("http/mime_type.zig");
const Bundler = bundler.Bundler;

// This is a tiny HTTP server.
// It needs to support:
// - Static files
// - ETags, If-Not-Modified-Since
// - Bundling
// - Content-Type header
// - Content-Range header
// Fancy things to support:
// - Server-Timings for:
//      - Resolver time
//      - Parsing time
//      - IO read time
pub const Server = struct {
    options: *Api.TransformOptions,
    allocator: *std.mem.Allocator,

    threadlocal var req_headers_buf: [100]picohttp.Header = undefined;
    threadlocal var res_headers_buf: [100]picohttp.Header = undefined;

    pub const RequestContext = struct {
        request: Request,
        method: Method,
        url: URLPath,
        conn: *tcp.Connection,
        bundler: *Bundler,
        status: ?u5 = null,
        has_written_last_header: bool = false,

        res_headers_count: usize = 0,

        pub const bundle_prefix = "__speedy";

        pub fn header(ctx: *RequestContext, comptime name: anytype) ?Header {
            for (ctx.request.headers) |header| {
                if (strings.eql(header.name, name)) {
                    return header;
                }
            }
            return null;
        }

        pub fn printStatusLine(comptime code: u9) ![]u8 {
            const status_text = switch (code) {
                200...299 => "OK",
                300...399 => "=>",
                400...499 => "UH",
                500...599 => "ERR",
                else => @compileError("Invalid code passed to printStatusLine"),
            };

            return try std.fmt.comptimePrint("HTTP/1.1 {s} \r\n", .{ code, status_text });
        }

        pub fn prepareToSendBody(
            ctx: *RequestContext,
            length: usize,
            comptime chunked: bool,
        ) !void {
            if (isDebug or isTest) {
                std.debug.assert(!ctx.has_written_last_header);
                ctx.has_written_last_header = true;
            }

            if (chunked) {}
        }

        pub fn writeBodyBuf(ctx: *RequestContext) void {}

        pub fn writeStatus(ctx: *RequestContext, comptime code: u9) !void {
            _ = try ctx.conn.client.write(comptime printStatusLine(code), os.SOCK_CLOEXEC);
        }

        pub fn init(req: Request, conn: *tcp.Connection, bundler: *Bundler) !RequestContext {
            return RequestContext{
                .request = request,
                .conn = conn,
                .bundler = bundler,
                .url = URLPath.parse(req.path),
                .method = Method.which(req.method) orelse return error.InvalidMethod,
            };
        }

        pub fn sendNotFound(req: *RequestContext) !void {
            return req.writeStatus(404);
        }

        pub fn sendInternalError(ctx: *RequestContext, err: anytype) void {
            ctx.writeStatus(500) catch {};
            const printed = std.fmt.bufPrint(&error_buf, "Error: {s}", .{@errorName(err)}) catch {};
            ctx.prepareToSendBody(printed.len, false) catch {};
            ctx.writeBodyBuf(&printed) catch {};
        }

        threadlocal var error_buf: [4096]u8 = undefined;

        pub fn appendHeader(ctx: *RequestContext, comptime key: string, value: string) void {
            if (isDebug or isTest) std.debug.assert(!ctx.has_written_last_header);
            if (isDebug or isTest) std.debug.assert(ctx.res_headers_count < res_headers_buf.len);
            res_headers_buf[ctx.res_headers_count] = Header{ .key = key, .value = value };
            ctx.res_headers_count += 1;
        }

        pub fn handleGet(ctx: *RequestContext) !void {
            const result = ctx.bundler.buildFile(req.allocator, req.url) catch |err| {
                ctx.sendInternalError(err);
                return;
            };

            if (result.output.len == 0) {
                return ctx.sendNotFound();
            }

            const file = result.output;

            const mime_type = MimeType.byExtension(std.fs.path.extension(file));
            ctx.appendHeader("Content-Type", mime_type.value);

            return ctx.writeResult(result, mime_type);
        }

        pub fn handle(ctx: *RequestContext) !void {
            switch (ctx.method) {
                .GET, .HEAD, .OPTIONS => {
                    return ctx.handleGet();
                },
                else => {
                    return ctx.sendNotFound();
                },
            }
        }

        pub const Method = enum {
            GET,
            HEAD,
            PATCH,
            PUT,
            POST,
            OPTIONS,
            CONNECT,
            TRACE,

            pub fn which(str: []const u8) ?Method {
                if (str.len < 3) {
                    return null;
                }
                const Match = strings.ExactSizeMatcher(2);
                // we already did the length check
                switch (Match.hashUnsafe(str[0..2])) {
                    Match.case("GE"), Match.case("ge") => {
                        return .GET;
                    },
                    Match.case("HE"), Match.case("he") => {
                        return .HEAD;
                    },
                    Match.case("PA"), Match.case("pa") => {
                        return .PATCH;
                    },
                    Match.case("PO"), Match.case("po") => {
                        return .POST;
                    },
                    Match.case("PU"), Match.case("pu") => {
                        return .PUT;
                    },
                    Match.case("OP"), Match.case("op") => {
                        return .OPTIONS;
                    },
                    Match.case("CO"), Match.case("co") => {
                        return .CONNECT;
                    },
                    Match.case("TR"), Match.case("tr") => {
                        return .TRACE;
                    },
                    else => {
                        return null;
                    },
                }
            }
        };
    };

    pub const URLPath = struct {
        extname: string = "",
        path: string = "",
        first_segment: string = "",
        query_string: string = "",

        // This does one pass over the URL path instead of like 4
        pub fn parse(raw_path: string) PathParser {
            var question_mark_i: i16 = -1;
            var period_i: i16 = -1;
            var first_segment_end: i16 = std.math.maxInt(i16);
            var last_slash: i16 = -1;

            var i: i16 = raw_path.len - 1;
            while (i >= 0) : (i -= 1) {
                const c = raw_path[@intCast(usize, i)];

                switch (c) {
                    '?' => {
                        question_mark_i = std.math.max(question_mark_i, i);
                        if (question_mark_i < period_i) {
                            period_i = -1;
                        }

                        if (last_slash > question_mark_i) {
                            last_slash = -1;
                        }
                    },
                    '.' => {
                        period_i = std.math.max(period_i, i);
                    },
                    '/' => {
                        last_slash = std.math.max(last_slash, i);

                        if (i > 0) {
                            first_segment_end = std.math.min(first_segment_end, i);
                        }
                    },
                    else => {},
                }
            }

            if (last_slash > period_i) {
                period_i = -1;
            }

            const extname = brk: {
                if (question_mark_i > -1 and period_i > -1) {
                    period_i += 1;
                    break :brk raw_path[period_i..question_mark_i];
                } else if (period_i > -1) {
                    period_i += 1;
                    break :brk raw_path[period_i..];
                } else {
                    break :brk [_]u8{};
                }
            };

            const path = raw_path[0..@intCast(usize, std.math.max(question_mark_i, raw_path.len))];
            const first_segment = raw_path[0..std.math.min(@intCast(usize, first_segment_end), raw_path.len)];

            return URLPath{
                .extname = extname,
                .first_segment = first_segment,
                .path = path,
                .query_string = if (question_mark_i > -1) raw_path[question_mark_i..raw_path.len] else "",
            };
        }
    };

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

    pub fn sendError(server: *Server, request: *Request, conn: *tcp.Connection, code: u9, msg: string) !void {
        try server.writeStatus(code, connection);
        conn.deinit();
    }

    pub fn handleConnection(server: *Server, conn: *tcp.Connection) void {
        errdefer conn.deinit();
        // https://stackoverflow.com/questions/686217/maximum-on-http-header-values
        var req_buf: [std.mem.page_size]u8 = undefined;
        var read_size = conn.client.read(&req_buf, os.SOCK_CLOEXEC) catch |err| {
            return;
        };
        var req = picohttp.Request.parse(req_buf[0..read_size], &req_headers_buf) catch |err| {
            Output.printError("ERR: {s}", .{@errorName(err)});

            return;
        };

        var req_ctx = RequestContext.init(req, conn) catch |err| {
            Output.printError("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
            conn.deinit();
            return;
        };

        req_ctx.handle() catch |err| {
            Output.printError("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
            conn.deinit();
            return;
        };

        Output.print("{d} – {s} {s}", .{ req_ctx.status orelse 500, @tagName(req.method), req.path });
    }

    pub fn start(allocator: *std.mem.Allocator, options: *Api.TransformOptions) !void {
        var server = Server{ .options = options, .allocator = allocator };

        try server.run();
    }
};
