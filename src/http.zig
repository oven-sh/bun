// const c = @import("./c.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const Api = @import("./api/schema.zig").Api;
const bundler = @import("bundler.zig");
const logger = @import("logger.zig");

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
const MimeType = @import("http/mime_type.zig");
const Bundler = bundler.ServeBundler;
const Websocket = @import("./http/websocket.zig");
const js_printer = @import("js_printer.zig");
const SOCKET_FLAGS = os.SOCK_CLOEXEC;
const watcher = @import("./watcher.zig");
threadlocal var req_headers_buf: [100]picohttp.Header = undefined;
threadlocal var res_headers_buf: [100]picohttp.Header = undefined;

const Watcher = watcher.NewWatcher(*Server);

const ENABLE_LOGGER = false;
pub fn println(comptime fmt: string, args: anytype) void {
    // if (ENABLE_LOGGER) {
    Output.println(fmt, args);
    // }
}

const HTTPStatusCode = u10;

pub const URLPath = struct {
    extname: string = "",
    path: string = "",
    first_segment: string = "",
    query_string: string = "",

    // This does one pass over the URL path instead of like 4
    pub fn parse(raw_path: string) URLPath {
        var question_mark_i: i16 = -1;
        var period_i: i16 = -1;
        var first_segment_end: i16 = std.math.maxInt(i16);
        var last_slash: i16 = -1;

        var i: i16 = @intCast(i16, raw_path.len) - 1;
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
                break :brk raw_path[@intCast(usize, period_i)..@intCast(usize, question_mark_i)];
            } else if (period_i > -1) {
                period_i += 1;
                break :brk raw_path[@intCast(usize, period_i)..];
            } else {
                break :brk &([_]u8{});
            }
        };

        const path = if (question_mark_i < 0) raw_path[1..] else raw_path[1..@intCast(usize, question_mark_i)];
        const first_segment = raw_path[1..std.math.min(@intCast(usize, first_segment_end), raw_path.len)];

        return URLPath{
            .extname = extname,
            .first_segment = first_segment,
            .path = if (raw_path.len == 1) "." else path,
            .query_string = if (question_mark_i > -1) raw_path[@intCast(usize, question_mark_i)..@intCast(usize, raw_path.len)] else "",
        };
    }
};

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
        switch (Match.match(str[0..2])) {
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

pub const RequestContext = struct {
    request: Request,
    method: Method,
    url: URLPath,
    conn: *tcp.Connection,
    allocator: *std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    log: logger.Log,
    bundler: *Bundler,
    keep_alive: bool = true,
    status: ?HTTPStatusCode = null,
    has_written_last_header: bool = false,
    has_called_done: bool = false,
    mime_type: MimeType = MimeType.other,
    controlled: bool = false,
    watcher: *Watcher,

    res_headers_count: usize = 0,

    pub const bundle_prefix = "__speedy";

    pub fn header(ctx: *RequestContext, comptime name: anytype) ?Header {
        if (name.len < 17) {
            for (ctx.request.headers) |head| {
                if (strings.eqlComptime(head.name, name)) {
                    return head;
                }
            }
        } else {
            for (ctx.request.headers) |head| {
                if (strings.eql(head.name, name)) {
                    return head;
                }
            }
        }

        return null;
    }

    pub fn printStatusLine(comptime code: HTTPStatusCode) []const u8 {
        const status_text = switch (code) {
            101 => "ACTIVATING WEBSOCKET",
            200...299 => "OK",
            300...399 => "=>",
            400...499 => "DID YOU KNOW YOU CAN MAKE THIS SAY WHATEVER YOU WANT",
            500...599 => "ERR",
            else => @compileError("Invalid code passed to printStatusLine"),
        };

        return std.fmt.comptimePrint("HTTP/1.1 {d} {s}\r\n", .{ code, status_text });
    }

    pub fn prepareToSendBody(
        ctx: *RequestContext,
        length: usize,
        comptime chunked: bool,
    ) !void {
        defer {
            if (isDebug or isTest) {
                std.debug.assert(!ctx.has_written_last_header);
                ctx.has_written_last_header = true;
            }
        }

        if (chunked) {
            ctx.appendHeader("Transfer-Encoding", "Chunked");
        } else {
            const length_str = try ctx.allocator.alloc(u8, 64);
            ctx.appendHeader("Content-Length", length_str[0..std.fmt.formatIntBuf(length_str, length, 10, true, .{})]);
        }

        try ctx.flushHeaders();
    }

    threadlocal var resp_header_out_buf: [4096]u8 = undefined;
    pub fn flushHeaders(ctx: *RequestContext) !void {
        if (ctx.res_headers_count == 0) return;

        const headers: []picohttp.Header = res_headers_buf[0..ctx.res_headers_count];
        defer ctx.res_headers_count = 0;
        var writer = std.io.fixedBufferStream(&resp_header_out_buf);
        for (headers) |head| {
            _ = writer.write(head.name) catch 0;
            _ = writer.write(": ") catch 0;
            _ = writer.write(head.value) catch 0;
            _ = writer.write("\r\n") catch 0;
        }

        _ = writer.write("\r\n") catch 0;

        _ = try ctx.writeSocket(writer.getWritten(), SOCKET_FLAGS);
    }

    pub fn writeSocket(ctx: *RequestContext, buf: anytype, flags: anytype) !usize {
        // ctx.conn.client.setWriteBufferSize(@intCast(u32, buf.len)) catch {};
        const written = ctx.conn.client.write(buf, SOCKET_FLAGS) catch |err| {
            Output.printError("Write error: {s}", .{@errorName(err)});
            return err;
        };

        if (written == 0) {
            return error.SocketClosed;
        }

        return written;
    }

    pub fn writeBodyBuf(ctx: *RequestContext, body: []const u8) !void {
        _ = try ctx.writeSocket(body, SOCKET_FLAGS);
    }

    pub fn writeStatus(ctx: *RequestContext, comptime code: HTTPStatusCode) !void {
        _ = try ctx.writeSocket(comptime printStatusLine(code), SOCKET_FLAGS);
        ctx.status = code;
    }

    pub fn init(
        req: Request,
        arena: std.heap.ArenaAllocator,
        conn: *tcp.Connection,
        bundler_: *Bundler,
        watcher_: *Watcher,
    ) !RequestContext {
        var ctx = RequestContext{
            .request = req,
            .arena = arena,
            .bundler = bundler_,
            .url = URLPath.parse(req.path),
            .log = undefined,
            .conn = conn,
            .allocator = undefined,
            .method = Method.which(req.method) orelse return error.InvalidMethod,
            .watcher = watcher_,
        };

        return ctx;
    }

    pub fn sendNotFound(req: *RequestContext) !void {
        try req.writeStatus(404);
        try req.flushHeaders();
        req.done();
    }

    pub fn sendInternalError(ctx: *RequestContext, err: anytype) !void {
        try ctx.writeStatus(500);
        const printed = std.fmt.bufPrint(&error_buf, "Error: {s}", .{@errorName(err)}) catch |err2| brk: {
            if (isDebug or isTest) {
                Global.panic("error while printing error: {s}", .{@errorName(err2)});
            }

            break :brk "Internal error";
        };

        try ctx.prepareToSendBody(printed.len, false);
        try ctx.writeBodyBuf(printed);
    }

    threadlocal var error_buf: [4096]u8 = undefined;

    pub fn sendNotModified(ctx: *RequestContext) !void {
        try ctx.writeStatus(304);
        try ctx.flushHeaders();
        ctx.done();
    }

    pub fn sendNoContent(ctx: *RequestContext) !void {
        try ctx.writeStatus(204);
        try ctx.flushHeaders();
        ctx.done();
    }

    pub fn appendHeader(ctx: *RequestContext, comptime key: string, value: string) void {
        if (isDebug or isTest) std.debug.assert(!ctx.has_written_last_header);
        if (isDebug or isTest) std.debug.assert(ctx.res_headers_count < res_headers_buf.len);
        res_headers_buf[ctx.res_headers_count] = Header{ .name = key, .value = value };
        ctx.res_headers_count += 1;
    }
    const file_chunk_size = 16384;
    const chunk_preamble_len: usize = brk: {
        var buf: [64]u8 = undefined;
        break :brk std.fmt.bufPrintIntToSlice(&buf, file_chunk_size, 16, true, .{}).len;
    };

    threadlocal var file_chunk_buf: [chunk_preamble_len + 2]u8 = undefined;
    threadlocal var symlink_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var weak_etag_buffer: [100]u8 = undefined;
    threadlocal var strong_etag_buffer: [100]u8 = undefined;
    threadlocal var weak_etag_tmp_buffer: [100]u8 = undefined;

    pub fn done(ctx: *RequestContext) void {
        std.debug.assert(!ctx.has_called_done);
        ctx.conn.deinit();
        ctx.has_called_done = true;
    }

    pub fn sendBadRequest(ctx: *RequestContext) !void {
        try ctx.writeStatus(400);
        ctx.done();
    }

    pub fn sendJSB(ctx: *RequestContext) !void {
        const node_modules_bundle = ctx.bundler.options.node_modules_bundle orelse unreachable;
        defer ctx.done();
        ctx.appendHeader("ETag", node_modules_bundle.bundle.etag);
        ctx.appendHeader("Content-Type", "text/javascript");
        ctx.appendHeader("Cache-Control", "immutable, max-age=99999");

        if (ctx.header("If-None-Match")) |etag_header| {
            if (std.mem.eql(u8, node_modules_bundle.bundle.etag, etag_header.value)) {
                try ctx.sendNotModified();
                return;
            }
        }

        const content_length = node_modules_bundle.container.code_length.? - node_modules_bundle.codeStartOffset();
        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(content_length, false);

        _ = try std.os.sendfile(
            ctx.conn.client.socket.fd,
            node_modules_bundle.fd,
            node_modules_bundle.codeStartOffset(),
            content_length,
            &[_]std.os.iovec_const{},
            &[_]std.os.iovec_const{},
            0,
        );
    }

    pub const WebsocketHandler = struct {
        accept_key: [28]u8 = undefined,
        ctx: RequestContext,

        pub fn handle(self: WebsocketHandler) void {
            var this = self;
            var stdout = std.io.getStdOut();
            // var stdout = std.io.bufferedWriter(stdout_file.writer());
            var stderr = std.io.getStdErr();
            // var stderr = std.io.bufferedWriter(stderr_file.writer());
            var output_source = Output.Source.init(stdout, stderr);
            // defer stdout.flush() catch {};
            // defer stderr.flush() catch {};
            Output.Source.set(&output_source);
            Output.enable_ansi_colors = stderr.isTty();

            _handle(&this) catch {};
        }

        fn _handle(handler: *WebsocketHandler) !void {
            var ctx = &handler.ctx;
            defer ctx.arena.deinit();
            defer ctx.conn.deinit();
            defer Output.flush();

            handler.checkUpgradeHeaders() catch |err| {
                switch (err) {
                    error.BadRequest => {
                        try ctx.sendBadRequest();
                        ctx.done();
                    },
                    else => {
                        return err;
                    },
                }
            };

            switch (try handler.getWebsocketVersion()) {
                7, 8, 13 => {},
                else => {
                    // Unsupported version
                    // Set header to indicate to the client which versions are supported
                    ctx.appendHeader("Sec-WebSocket-Version", "7,8,13");
                    try ctx.writeStatus(426);
                    try ctx.flushHeaders();
                    ctx.done();
                    return;
                },
            }

            const key = try handler.getWebsocketAcceptKey();

            ctx.appendHeader("Connection", "Upgrade");
            ctx.appendHeader("Upgrade", "websocket");
            ctx.appendHeader("Sec-WebSocket-Accept", key);
            try ctx.writeStatus(101);
            try ctx.flushHeaders();
            Output.println("101 - Websocket connected.", .{});
            Output.flush();

            var websocket = Websocket.Websocket.create(ctx, SOCKET_FLAGS);
            _ = try websocket.writeText("Hello!");

            while (true) {
                defer Output.flush();
                var frame = websocket.read() catch |err| {
                    switch (err) {
                        error.ConnectionClosed => {
                            Output.prettyln("Websocket closed.", .{});
                            return;
                        },
                        else => {
                            Output.prettyErrorln("<r><red>ERR:<r> <b>{s}<r>", .{err});
                        },
                    }
                    return;
                };
                switch (frame.header.opcode) {
                    .Close => {
                        Output.prettyln("Websocket closed.", .{});
                        return;
                    },
                    .Text => {
                        _ = try websocket.writeText(frame.data);
                    },
                    .Ping => {
                        var pong = frame;
                        pong.header.opcode = .Pong;
                        _ = try websocket.writeDataFrame(pong);
                    },
                    else => {
                        Output.prettyErrorln("Websocket unknown opcode: {s}", .{@tagName(frame.header.opcode)});
                    },
                }
            }
        }

        fn checkUpgradeHeaders(
            self: *WebsocketHandler,
        ) !void {
            var request: *RequestContext = &self.ctx;
            const upgrade_header = request.header("Upgrade") orelse return error.BadRequest;

            if (!std.ascii.eqlIgnoreCase(upgrade_header.value, "websocket")) {
                return error.BadRequest; // Can only upgrade to websocket
            }

            // Some proxies/load balancers will mess with the connection header
            // and browsers also send multiple values here
            const connection_header = request.header("Connection") orelse return error.BadRequest;
            var it = std.mem.split(connection_header.value, ",");
            while (it.next()) |part| {
                const conn = std.mem.trim(u8, part, " ");
                if (std.ascii.eqlIgnoreCase(conn, "upgrade")) {
                    return;
                }
            }
            return error.BadRequest; // Connection must be upgrade
        }

        fn getWebsocketVersion(
            self: *WebsocketHandler,
        ) !u8 {
            var request: *RequestContext = &self.ctx;
            const v = request.header("Sec-WebSocket-Version") orelse return error.BadRequest;
            return std.fmt.parseInt(u8, v.value, 10) catch error.BadRequest;
        }

        fn getWebsocketAcceptKey(
            self: *WebsocketHandler,
        ) ![]const u8 {
            var request: *RequestContext = &self.ctx;
            const key = (request.header("Sec-WebSocket-Key") orelse return error.BadRequest).value;
            if (key.len < 8) {
                return error.BadRequest;
            }

            var hash = std.crypto.hash.Sha1.init(.{});
            var out: [20]u8 = undefined;
            hash.update(key);
            hash.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            hash.final(&out);

            // Encode it
            return std.base64.standard_encoder.encode(&self.accept_key, &out);
        }
    };

    pub fn handleWebsocket(ctx: *RequestContext) anyerror!void {
        ctx.controlled = true;
        var handler = WebsocketHandler{ .ctx = ctx.* };
        _ = try std.Thread.spawn(WebsocketHandler.handle, handler);
    }

    pub fn handleGet(ctx: *RequestContext) !void {
        if (strings.eqlComptime(ctx.url.extname, "jsb") and ctx.bundler.options.node_modules_bundle != null) {
            return try ctx.sendJSB();
        }

        if (strings.eqlComptime(ctx.url.path, "_api")) {
            try ctx.handleWebsocket();
            return;
        }

        const result = try ctx.bundler.buildFile(
            &ctx.log,
            ctx.allocator,
            ctx.url.path,
            ctx.url.extname,
        );

        if (ctx.keep_alive) {
            ctx.appendHeader("Connection", "keep-alive");
        }

        if (std.meta.activeTag(result.file.value) == .noop) {
            return try ctx.sendNotFound();
        }

        ctx.mime_type = result.mime_type;
        ctx.appendHeader("Content-Type", result.mime_type.value);

        const send_body = ctx.method == .GET;

        switch (result.file.value) {
            .pending => |resolve_result| {
                const hash = Watcher.getHash(result.file.input.text);
                var watcher_index = ctx.watcher.indexOf(hash);
                var input_fd = if (watcher_index) |ind| ctx.watcher.watchlist.items(.fd)[ind] else null;

                if (resolve_result.is_external) {
                    try ctx.sendBadRequest();
                    return;
                }

                const SocketPrinterInternal = struct {
                    const SocketPrinterInternal = @This();
                    rctx: *RequestContext,
                    threadlocal var buffer: MutableString = undefined;
                    threadlocal var has_loaded_buffer: bool = false;

                    pub fn init(rctx: *RequestContext) SocketPrinterInternal {
                        // if (isMac) {
                        //     _ = std.os.fcntl(file.handle, std.os.F_NOCACHE, 1) catch 0;
                        // }

                        if (!has_loaded_buffer) {
                            buffer = MutableString.init(std.heap.c_allocator, 0) catch unreachable;
                            has_loaded_buffer = true;
                        }

                        buffer.reset();

                        return SocketPrinterInternal{
                            .rctx = rctx,
                        };
                    }
                    pub fn writeByte(_ctx: *SocketPrinterInternal, byte: u8) anyerror!usize {
                        try buffer.appendChar(byte);
                        return 1;
                    }
                    pub fn writeAll(_ctx: *SocketPrinterInternal, bytes: anytype) anyerror!usize {
                        try buffer.append(bytes);
                        return bytes.len;
                    }

                    pub fn getLastByte(_ctx: *const SocketPrinterInternal) u8 {
                        return if (buffer.list.items.len > 0) buffer.list.items[buffer.list.items.len - 1] else 0;
                    }

                    pub fn getLastLastByte(_ctx: *const SocketPrinterInternal) u8 {
                        return if (buffer.list.items.len > 1) buffer.list.items[buffer.list.items.len - 2] else 0;
                    }

                    pub fn done(
                        chunky: *SocketPrinterInternal,
                    ) anyerror!void {
                        const buf = buffer.toOwnedSliceLeaky();
                        defer buffer.reset();

                        if (buf.len == 0) {
                            try chunky.rctx.sendNoContent();
                            return;
                        }

                        if (FeatureFlags.strong_etags_for_built_files) {
                            if (buf.len < 16 * 16 * 16 * 16) {
                                const strong_etag = std.hash.Wyhash.hash(1, buf);
                                const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, true, .{});

                                chunky.rctx.appendHeader("ETag", etag_content_slice);

                                if (chunky.rctx.header("If-None-Match")) |etag_header| {
                                    if (std.mem.eql(u8, etag_content_slice, etag_header.value)) {
                                        try chunky.rctx.sendNotModified();
                                        return;
                                    }
                                }
                            }
                        }

                        try chunky.rctx.writeStatus(200);
                        try chunky.rctx.prepareToSendBody(buf.len, false);
                        try chunky.rctx.writeBodyBuf(buf);
                        chunky.rctx.done();
                    }

                    pub fn flush(
                        _ctx: *SocketPrinterInternal,
                    ) anyerror!void {}
                };

                const SocketPrinter = js_printer.NewWriter(
                    SocketPrinterInternal,
                    SocketPrinterInternal.writeByte,
                    SocketPrinterInternal.writeAll,
                    SocketPrinterInternal.getLastByte,
                    SocketPrinterInternal.getLastLastByte,
                );

                var chunked_encoder = SocketPrinter.init(SocketPrinterInternal.init(ctx));

                // It will call flush for us automatically
                defer ctx.bundler.resetStore();
                const loader = ctx.bundler.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;
                var written = try ctx.bundler.buildWithResolveResult(
                    resolve_result,
                    ctx.allocator,
                    loader,
                    SocketPrinter,
                    chunked_encoder,
                    .absolute_url,
                    input_fd,
                );
                if (written.input_fd) |written_fd| {
                    try ctx.watcher.addFile(written_fd, result.file.input.text, hash, true);
                    if (ctx.watcher.watchloop_handle == null) {
                        try ctx.watcher.start();
                    }
                }
            },
            .noop => {
                try ctx.sendNotFound();
            },
            .copy, .move => |file| {
                // defer std.os.close(file.fd);
                defer {
                    if (ctx.watcher.addFile(file.fd, result.file.input.text, Watcher.getHash(result.file.input.text), true)) {
                        if (ctx.watcher.watchloop_handle == null) {
                            ctx.watcher.start() catch |err| {
                                Output.prettyErrorln("Failed to start watcher: {s}", .{@errorName(err)});
                            };
                        }
                    } else |err| {}
                }

                // if (result.mime_type.category != .html) {
                // hash(absolute_file_path, size, mtime)
                var weak_etag = std.hash.Wyhash.init(1);
                weak_etag_buffer[0] = 'W';
                weak_etag_buffer[1] = '/';
                weak_etag.update(result.file.input.text);
                std.mem.writeIntNative(u64, weak_etag_tmp_buffer[0..8], result.file.size);
                weak_etag.update(weak_etag_tmp_buffer[0..8]);

                if (result.file.mtime) |mtime| {
                    std.mem.writeIntNative(i128, weak_etag_tmp_buffer[0..16], mtime);
                    weak_etag.update(weak_etag_tmp_buffer[0..16]);
                }

                const etag_content_slice = std.fmt.bufPrintIntToSlice(weak_etag_buffer[2..], weak_etag.final(), 16, true, .{});
                const complete_weak_etag = weak_etag_buffer[0 .. etag_content_slice.len + 2];

                ctx.appendHeader("ETag", complete_weak_etag);

                if (ctx.header("If-None-Match")) |etag_header| {
                    if (strings.eql(complete_weak_etag, etag_header.value)) {
                        try ctx.sendNotModified();
                        return;
                    }
                }
                // } else {
                //     ctx.appendHeader("Cache-Control", "no-cache");
                // }

                switch (result.file.size) {
                    0 => {
                        try ctx.sendNoContent();
                        return;
                    },
                    else => {
                        defer ctx.done();

                        try ctx.writeStatus(200);
                        try ctx.prepareToSendBody(result.file.size, false);
                        if (!send_body) return;
                        _ = try std.os.sendfile(
                            ctx.conn.client.socket.fd,
                            file.fd,
                            0,
                            result.file.size,
                            &[_]std.os.iovec_const{},
                            &[_]std.os.iovec_const{},
                            0,
                        );
                    },
                }
            },
            .buffer => |buffer| {

                // The version query string is only included for:
                // - The runtime
                // - node_modules
                // For the runtime, it's a hash of the file contents
                // For node modules, it's just the package version from the package.json
                // It's safe to assume node_modules are immutable. In practice, they aren't.
                // However, a lot of other stuff breaks when node_modules change so it's fine
                if (strings.contains(ctx.url.query_string, "v=")) {
                    ctx.appendHeader("Cache-Control", "public, immutable, max-age=31556952");
                }

                if (FeatureFlags.strong_etags_for_built_files) {
                    // TODO: don't hash runtime.js
                    const strong_etag = std.hash.Wyhash.hash(1, buffer);
                    const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, true, .{});

                    ctx.appendHeader("ETag", etag_content_slice);

                    if (ctx.header("If-None-Match")) |etag_header| {
                        if (std.mem.eql(u8, etag_content_slice, etag_header.value)) {
                            try ctx.sendNotModified();
                            return;
                        }
                    }
                }

                if (buffer.len == 0) {
                    return try ctx.sendNoContent();
                }

                defer ctx.done();
                try ctx.writeStatus(200);
                try ctx.prepareToSendBody(buffer.len, false);
                if (!send_body) return;
                _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
            },
        }

        // If we get this far, it means
    }

    pub fn handleRequest(ctx: *RequestContext) !void {
        switch (ctx.method) {
            .GET, .HEAD, .OPTIONS => {
                return ctx.handleGet();
            },
            else => {
                return ctx.sendNotFound();
            },
        }
    }
};

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
    log: logger.Log,
    allocator: *std.mem.Allocator,
    bundler: Bundler,
    watcher: *Watcher,

    pub fn adjustUlimit() !void {
        var limit = try std.os.getrlimit(.NOFILE);
        if (limit.cur < limit.max) {
            var new_limit = std.mem.zeroes(std.os.rlimit);
            new_limit.cur = limit.max;
            new_limit.max = limit.max;
            try std.os.setrlimit(.NOFILE, new_limit);
        }
    }

    pub fn onTCPConnection(server: *Server, conn: tcp.Connection) void {
        conn.client.setNoDelay(true) catch {};
        conn.client.setQuickACK(true) catch {};
        conn.client.setLinger(1) catch {};

        server.handleConnection(&conn);
    }

    pub fn onFileUpdate(ctx: *Server, events: []watcher.WatchEvent, watchlist: watcher.Watchlist) void {
        for (events) |event| {
            const item = watchlist.items(.file_path)[event.index];
            Output.prettyln("File changed: \"<b>{s}<r>\"", .{item});
        }
    }

    fn run(server: *Server) !void {
        adjustUlimit() catch {};
        const listener = try tcp.Listener.init(.ip, .{ .close_on_exec = true });
        defer listener.deinit();

        listener.setReuseAddress(true) catch {};
        listener.setReusePort(true) catch {};
        listener.setFastOpen(true) catch {};
        // listener.setNoDelay(true) catch {};
        // listener.setQuickACK(true) catch {};

        // try listener.ack(true);

        try listener.bind(ip.Address.initIPv4(IPv4.unspecified, 9000));
        try listener.listen(1280);
        const addr = try listener.getLocalAddress();

        Output.prettyln("<r>Started Speedy at <b><cyan>http://{s}<r>", .{addr});
        Output.flush();
        // var listener_handle = try std.os.kqueue();
        // var change_list = std.mem.zeroes([2]os.Kevent);

        // change_list[0].ident = @intCast(usize, listener.socket.fd);
        // change_list[1].ident = @intCast(usize, listener.socket.fd);

        // var eventlist: [128]os.Kevent = undefined;
        while (true) {
            defer Output.flush();
            var conn = listener.accept(.{ .close_on_exec = true }) catch |err| {
                continue;
            };

            server.handleConnection(&conn);
        }
    }

    pub fn sendError(server: *Server, request: *Request, conn: *tcp.Connection, code: HTTPStatusCode, msg: string) !void {
        try server.writeStatus(code, connection);
    }

    threadlocal var req_buf: [32_000]u8 = undefined;

    pub fn handleConnection(server: *Server, conn: *tcp.Connection) void {

        // https://stackoverflow.com/questions/686217/maximum-on-http-header-values
        var read_size = conn.client.read(&req_buf, SOCKET_FLAGS) catch |err| {
            _ = conn.client.write(RequestContext.printStatusLine(400) ++ "\r\n\r\n", SOCKET_FLAGS) catch {};
            return;
        };

        if (read_size == 0) {
            // Actually, this was not a request.
            return;
        }

        var req = picohttp.Request.parse(req_buf[0..read_size], &req_headers_buf) catch |err| {
            _ = conn.client.write(RequestContext.printStatusLine(400) ++ "\r\n\r\n", SOCKET_FLAGS) catch {};
            conn.client.deinit();
            Output.printErrorln("ERR: {s}", .{@errorName(err)});
            return;
        };

        var request_arena = std.heap.ArenaAllocator.init(server.allocator);
        var req_ctx: RequestContext = undefined;
        defer {
            if (!req_ctx.controlled) {
                req_ctx.arena.deinit();
            }
        }
        req_ctx = RequestContext.init(
            req,
            request_arena,
            conn,
            &server.bundler,
            server.watcher,
        ) catch |err| {
            Output.printErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
            conn.client.deinit();
            return;
        };

        req_ctx.allocator = &req_ctx.arena.allocator;
        req_ctx.log = logger.Log.init(req_ctx.allocator);

        if (FeatureFlags.keep_alive) {
            if (req_ctx.header("Connection")) |connection| {
                req_ctx.keep_alive = strings.eqlInsensitive(connection.value, "keep-alive");
            }

            conn.client.setKeepAlive(req_ctx.keep_alive) catch {};
        } else {
            req_ctx.keep_alive = false;
        }

        req_ctx.handleRequest() catch |err| {
            switch (err) {
                error.ModuleNotFound => {
                    req_ctx.sendNotFound() catch {};
                },
                else => {
                    Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                    return;
                },
            }
        };

        if (!req_ctx.controlled) {
            const status = req_ctx.status orelse @intCast(HTTPStatusCode, 500);

            if (req_ctx.log.msgs.items.len == 0) {
                println("{d} – {s} {s} as {s}", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
            } else {
                println("{s} {s}", .{ @tagName(req_ctx.method), req.path });
                for (req_ctx.log.msgs.items) |msg| {
                    msg.writeFormat(Output.errorWriter()) catch continue;
                }
                req_ctx.log.deinit();
            }
        }
    }

    pub fn initWatcher(server: *Server) !void {
        server.watcher = try Watcher.init(server, server.bundler.fs, server.allocator);
    }

    pub fn start(allocator: *std.mem.Allocator, options: Api.TransformOptions) !void {
        var log = logger.Log.init(allocator);
        var server = Server{
            .allocator = allocator,
            .log = log,
            .bundler = undefined,
            .watcher = undefined,
        };
        server.bundler = try Bundler.init(allocator, &server.log, options);
        server.bundler.configureLinker();

        try server.initWatcher();

        try server.run();
    }
};
