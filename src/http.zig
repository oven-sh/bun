// const c = @import("./c.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const Api = @import("./api/schema.zig").Api;
const ApiReader = @import("./api/schema.zig").Reader;
const ApiWriter = @import("./api/schema.zig").Writer;
const ByteApiWriter = @import("./api/schema.zig").ByteWriter;
const NewApiWriter = @import("./api/schema.zig").Writer;
const js_ast = @import("./js_ast.zig");
const bundler = @import("bundler.zig");
const logger = @import("logger.zig");
const Fs = @import("./fs.zig");
const Options = @import("./options.zig");
const Css = @import("css_scanner.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const resolve_path = @import("./resolver/resolve_path.zig");
const OutputFile = Options.OutputFile;
pub fn constStrToU8(s: string) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const MutableStringAPIWriter = NewApiWriter(*MutableString);

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
pub const Headers = picohttp.Headers;
pub const MimeType = @import("./http/mime_type.zig");
const Bundler = bundler.ServeBundler;
const Websocket = @import("./http/websocket.zig");
const js_printer = @import("./js_printer.zig");
const SOCKET_FLAGS = os.SOCK_CLOEXEC;
const watcher = @import("./watcher.zig");
threadlocal var req_headers_buf: [100]picohttp.Header = undefined;
threadlocal var res_headers_buf: [100]picohttp.Header = undefined;
const sync = @import("./sync.zig");
const JavaScript = @import("./javascript/jsc/javascript.zig");
usingnamespace @import("./javascript/jsc/bindings/bindings.zig");
usingnamespace @import("./javascript/jsc/bindings/exports.zig");
const Router = @import("./router.zig");
pub const Watcher = watcher.NewWatcher(*Server);

const ENABLE_LOGGER = false;
pub fn println(comptime fmt: string, args: anytype) void {
    // if (ENABLE_LOGGER) {
    Output.println(fmt, args);
    // }
}

const HTTPStatusCode = u10;
const URLPath = @import("./http/url_path.zig");

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
    timer: std.time.Timer,
    matched_route: ?Router.Match = null,

    full_url: [:0]const u8 = "",
    match_file_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined,
    res_headers_count: usize = 0,

    pub const bundle_prefix = "__speedy";

    pub fn getFullURL(this: *RequestContext) [:0]const u8 {
        if (this.full_url.len == 0) {
            if (this.bundler.options.origin.len > 0) {
                this.full_url = std.fmt.allocPrintZ(this.allocator, "{s}{s}", .{ this.bundler.options.origin, this.request.path }) catch unreachable;
            } else {
                this.full_url = this.allocator.dupeZ(u8, this.request.path) catch unreachable;
            }
        }

        return this.full_url;
    }

    pub fn handleRedirect(this: *RequestContext, url: string) !void {
        this.appendHeader("Location", url);
        defer this.done();
        try this.writeStatus(302);
        try this.flushHeaders();
    }

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

    fn matchPublicFolder(this: *RequestContext) ?bundler.ServeResult {
        if (!this.bundler.options.routes.static_dir_enabled) return null;
        const relative_path = this.url.path;
        var extension = this.url.extname;
        var tmp_buildfile_buf = std.mem.span(&Bundler.tmp_buildfile_buf);

        // On Windows, we don't keep the directory handle open forever because Windows doesn't like that.
        const public_dir: std.fs.Dir = this.bundler.options.routes.static_dir_handle orelse std.fs.openDirAbsolute(this.bundler.options.routes.static_dir, .{}) catch |err| {
            this.bundler.log.addErrorFmt(null, logger.Loc.Empty, this.allocator, "Opening public directory failed: {s}", .{@errorName(err)}) catch unreachable;
            Output.printErrorln("Opening public directory failed: {s}", .{@errorName(err)});
            this.bundler.options.routes.static_dir_enabled = false;
            return null;
        };

        var relative_unrooted_path: []u8 = resolve_path.normalizeString(relative_path, false, .auto);

        var _file: ?std.fs.File = null;

        // Is it the index file?
        if (relative_unrooted_path.len == 0) {
            // std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path);
            // std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/"
            // Search for /index.html
            if (public_dir.openFile("index.html", .{})) |file| {
                var index_path = "index.html".*;
                relative_unrooted_path = &(index_path);
                _file = file;
                extension = "html";
            } else |err| {}
            // Okay is it actually a full path?
        } else {
            if (public_dir.openFile(relative_unrooted_path, .{})) |file| {
                _file = file;
            } else |err| {}
        }

        // Try some weird stuff.
        while (_file == null and relative_unrooted_path.len > 1) {
            // When no extension is provided, it might be html
            if (extension.len == 0) {
                std.mem.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], ".html");

                if (public_dir.openFile(tmp_buildfile_buf[0 .. relative_unrooted_path.len + ".html".len], .{})) |file| {
                    _file = file;
                    extension = "html";
                    break;
                } else |err| {}

                var _path: []u8 = undefined;
                if (relative_unrooted_path[relative_unrooted_path.len - 1] == '/') {
                    std.mem.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0 .. relative_unrooted_path.len - 1]);
                    std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len - 1 ..], "/index.html");
                    _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len - 1 + "/index.html".len];
                } else {
                    std.mem.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                    std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/index.html");

                    _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len + "/index.html".len];
                }

                if (public_dir.openFile(_path, .{})) |file| {
                    const __path = _path;
                    relative_unrooted_path = __path;
                    extension = "html";
                    _file = file;
                    break;
                } else |err| {}
            }

            break;
        }

        if (_file) |*file| {
            var stat = file.stat() catch return null;
            var absolute_path = resolve_path.joinAbs(this.bundler.options.routes.static_dir, .auto, relative_unrooted_path);

            if (stat.kind == .SymLink) {
                absolute_path = std.fs.realpath(absolute_path, &Bundler.tmp_buildfile_buf) catch return null;
                file.close();
                file.* = std.fs.openFileAbsolute(absolute_path, .{ .read = true }) catch return null;
                stat = file.stat() catch return null;
            }

            if (stat.kind != .File) {
                file.close();
                return null;
            }

            var output_file = OutputFile.initFile(file.*, absolute_path, stat.size);
            output_file.value.copy.close_handle_on_complete = true;
            output_file.value.copy.autowatch = false;
            return bundler.ServeResult{
                .file = output_file,
                .mime_type = MimeType.byExtension(std.fs.path.extension(absolute_path)[1..]),
            };
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
            ctx.appendHeader("Content-Length", length_str[0..std.fmt.formatIntBuf(length_str, length, 10, .upper, .{})]);
        }

        try ctx.flushHeaders();
    }

    pub fn clearHeaders(
        this: *RequestContext,
    ) !void {
        this.res_headers_count = 0;
    }

    pub fn appendHeaderSlow(this: *RequestContext, name: string, value: string) !void {
        res_headers_buf[this.res_headers_count] = picohttp.Header{ .name = name, .value = value };
        this.res_headers_count += 1;
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

    threadlocal var status_buf: [std.fmt.count("HTTP/1.1 {d} {s}\r\n", .{ 200, "OK" })]u8 = undefined;
    pub fn writeStatusSlow(ctx: *RequestContext, code: u16) !void {
        _ = try ctx.writeSocket(
            try std.fmt.bufPrint(
                &status_buf,
                "HTTP/1.1 {d} {s}\r\n",
                .{ code, if (code > 299) "HM" else "OK" },
            ),
            SOCKET_FLAGS,
        );

        ctx.status = @truncate(HTTPStatusCode, code);
    }

    pub fn init(
        req: Request,
        arena: std.heap.ArenaAllocator,
        conn: *tcp.Connection,
        bundler_: *Bundler,
        watcher_: *Watcher,
        timer: std.time.Timer,
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
            .timer = timer,
        };

        return ctx;
    }

    pub fn sendNotFound(req: *RequestContext) !void {
        defer req.done();
        try req.writeStatus(404);
        try req.flushHeaders();
    }

    pub fn sendInternalError(ctx: *RequestContext, err: anytype) !void {
        defer ctx.done();
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
        defer ctx.done();
        try ctx.writeStatus(304);
        try ctx.flushHeaders();
    }

    pub fn sendNoContent(ctx: *RequestContext) !void {
        defer ctx.done();
        try ctx.writeStatus(204);
        try ctx.flushHeaders();
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

    pub const WatchBuilder = struct {
        watcher: *Watcher,
        bundler: *Bundler,
        allocator: *std.mem.Allocator,
        printer: js_printer.BufferPrinter,
        timer: std.time.Timer,

        pub const WatchBuildResult = struct {
            value: Value,
            id: u32,
            timestamp: u32,
            bytes: []const u8 = "",
            approximate_newline_count: usize = 0,
            pub const Value = union(Tag) {
                success: Api.WebsocketMessageBuildSuccess,
                fail: Api.WebsocketMessageBuildFailure,
            };
            pub const Tag = enum {
                success,
                fail,
            };
        };
        pub fn build(this: *WatchBuilder, id: u32, from_timestamp: u32) !WatchBuildResult {
            var log = logger.Log.init(this.allocator);
            errdefer log.deinit();

            const index = std.mem.indexOfScalar(u32, this.watcher.watchlist.items(.hash), id) orelse {

                // log.addErrorFmt(null, logger.Loc.Empty, this, "File missing from watchlist: {d}. Please refresh :(", .{hash}) catch unreachable;
                return WatchBuildResult{
                    .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                    .id = id,
                    .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                };
            };

            const file_path_str = this.watcher.watchlist.items(.file_path)[index];
            const fd = this.watcher.watchlist.items(.fd)[index];
            const loader = this.watcher.watchlist.items(.loader)[index];

            const path = Fs.Path.init(file_path_str);
            var old_log = this.bundler.log;
            defer this.bundler.log = old_log;
            this.bundler.log = &log;

            switch (loader) {
                .json, .ts, .tsx, .js, .jsx => {
                    // Since we already have:
                    // - The file descriptor
                    // - The path
                    // - The loader
                    // We can skip resolving. We will need special handling for renaming where basically we:
                    // - Update the watch item.
                    // - Clear directory cache
                    this.bundler.resetStore();

                    var parse_result = this.bundler.parse(
                        this.bundler.allocator,
                        path,
                        loader,
                        0,
                        fd,
                        id,
                    ) orelse {
                        return WatchBuildResult{
                            .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                            .id = id,
                            .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                        };
                    };

                    this.printer.ctx.reset();

                    var old_linker_allocator = this.bundler.linker.allocator;
                    defer this.bundler.linker.allocator = old_linker_allocator;
                    this.bundler.linker.allocator = this.allocator;
                    try this.bundler.linker.link(
                        Fs.Path.init(file_path_str),
                        &parse_result,
                        .absolute_url,
                        false,
                    );

                    var written = this.bundler.print(parse_result, @TypeOf(&this.printer), &this.printer, .esm) catch |err| {
                        return WatchBuildResult{
                            .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                            .id = id,
                            .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                        };
                    };

                    return WatchBuildResult{
                        .value = .{
                            .success = .{
                                .id = id,
                                .from_timestamp = from_timestamp,
                                .loader = parse_result.loader.toAPI(),
                                .module_path = this.bundler.fs.relativeTo(file_path_str),
                                .blob_length = @truncate(u32, written),
                                // .log = std.mem.zeroes(Api.Log),
                            },
                        },
                        .id = id,
                        .bytes = this.printer.ctx.written,
                        .approximate_newline_count = parse_result.ast.approximate_newline_count,
                        .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                    };
                },
                .css => {
                    const CSSBundlerHMR = Css.NewBundler(
                        @TypeOf(&this.printer),
                        @TypeOf(&this.bundler.linker),
                        @TypeOf(&this.bundler.resolver.caches.fs),
                        Watcher,
                        @TypeOf(this.bundler.fs),
                        true,
                    );

                    const CSSBundler = Css.NewBundler(
                        @TypeOf(&this.printer),
                        @TypeOf(&this.bundler.linker),
                        @TypeOf(&this.bundler.resolver.caches.fs),
                        Watcher,
                        @TypeOf(this.bundler.fs),
                        false,
                    );

                    this.printer.ctx.reset();

                    const count = brk: {
                        if (this.bundler.options.hot_module_reloading) {
                            break :brk try CSSBundlerHMR.bundle(
                                file_path_str,
                                this.bundler.fs,
                                &this.printer,
                                this.watcher,
                                &this.bundler.resolver.caches.fs,
                                this.watcher.watchlist.items(.hash)[index],
                                fd,
                                this.allocator,
                                &log,
                                &this.bundler.linker,
                            );
                        } else {
                            break :brk try CSSBundler.bundle(
                                file_path_str,
                                this.bundler.fs,
                                &this.printer,
                                this.watcher,
                                &this.bundler.resolver.caches.fs,
                                this.watcher.watchlist.items(.hash)[index],
                                fd,
                                this.allocator,
                                &log,
                                &this.bundler.linker,
                            );
                        }
                    };

                    return WatchBuildResult{
                        .value = .{
                            .success = .{
                                .id = id,
                                .from_timestamp = from_timestamp,
                                .loader = .css,
                                .module_path = this.bundler.fs.relativeTo(file_path_str),
                                .blob_length = @truncate(u32, count.written),
                                // .log = std.mem.zeroes(Api.Log),
                            },
                        },
                        .id = id,
                        .bytes = this.printer.ctx.written,
                        .approximate_newline_count = count.approximate_newline_count,
                        // .approximate_newline_count = parse_result.ast.approximate_newline_count,
                        .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                    };
                },
                else => {
                    return WatchBuildResult{
                        .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                        .id = id,
                        .timestamp = WebsocketHandler.toTimestamp(this.timer.read()),
                    };
                },
            }
        }
    };

    pub const JavaScriptHandler = struct {
        ctx: RequestContext,
        conn: tcp.Connection,
        params: Router.Param.List,

        pub var javascript_vm: *JavaScript.VirtualMachine = undefined;

        pub const HandlerThread = struct {
            args: Api.TransformOptions,
            framework: Options.Framework,
            existing_bundle: ?*NodeModuleBundle,
            log: ?*logger.Log = null,
            watcher: *Watcher,
        };

        pub const Channel = sync.Channel(*JavaScriptHandler, .{ .Static = 100 });
        pub var channel: Channel = undefined;
        var has_loaded_channel = false;
        pub var javascript_disabled = false;
        pub fn spawnThread(handler: HandlerThread) !void {
            var thread = try std.Thread.spawn(.{}, spawn, .{handler});
            thread.detach();
        }

        pub fn spawn(handler: HandlerThread) void {
            var _handler = handler;
            _spawn(&_handler) catch {};
        }

        pub fn _spawn(handler: *HandlerThread) !void {
            defer {
                javascript_disabled = true;
            }

            var stdout = std.io.getStdOut();
            // var stdout = std.io.bufferedWriter(stdout_file.writer());
            var stderr = std.io.getStdErr();
            // var stderr = std.io.bufferedWriter(stderr_file.writer());
            var output_source = Output.Source.init(stdout, stderr);
            // defer stdout.flush() catch {};
            // defer stderr.flush() catch {};
            Output.Source.set(&output_source);
            Output.enable_ansi_colors = stderr.isTty();
            js_ast.Stmt.Data.Store.create(std.heap.c_allocator);
            js_ast.Expr.Data.Store.create(std.heap.c_allocator);

            defer Output.flush();
            var vm = JavaScript.VirtualMachine.init(std.heap.c_allocator, handler.args, handler.existing_bundle, handler.log) catch |err| {
                Output.prettyErrorln(
                    "JavaScript VM failed to start: <r><red>{s}<r>",
                    .{@errorName(err)},
                );
                Output.flush();
                return;
            };
            std.debug.assert(JavaScript.VirtualMachine.vm_loaded);
            javascript_vm = vm;

            const boot = vm.bundler.options.framework.?.server;
            std.debug.assert(boot.len > 0);
            defer vm.deinit();
            vm.watcher = handler.watcher;
            var entry_point = boot;
            if (!std.fs.path.isAbsolute(entry_point)) {
                const resolved_entry_point = try vm.bundler.resolver.resolve(
                    std.fs.path.dirname(boot) orelse vm.bundler.fs.top_level_dir,
                    vm.bundler.normalizeEntryPointPath(boot),
                    .entry_point,
                );
                entry_point = resolved_entry_point.path_pair.primary.text;
            }

            var load_result = vm.loadEntryPoint(
                entry_point,
            ) catch |err| {
                Output.prettyErrorln(
                    "<r>JavaScript VM failed to start.\n<red>{s}:<r> while loading <r><b>\"\"",
                    .{ @errorName(err), entry_point },
                );

                if (channel.tryReadItem() catch null) |item| {
                    item.ctx.sendInternalError(error.JSFailedToStart) catch {};
                    item.ctx.arena.deinit();
                }
                return;
            };

            switch (load_result.status(vm.global.vm())) {
                JSPromise.Status.Fulfilled => {},
                else => {
                    Output.prettyErrorln(
                        "JavaScript VM failed to start",
                        .{},
                    );
                    var result = load_result.result(vm.global.vm());

                    vm.defaultErrorHandler(result);

                    if (channel.tryReadItem() catch null) |item| {
                        item.ctx.sendInternalError(error.JSFailedToStart) catch {};
                        item.ctx.arena.deinit();
                    }
                    return;
                },
            }

            if (vm.event_listeners.count() == 0) {
                Output.prettyErrorln("<r><red>error<r>: Framework didn't run <b><cyan>addEventListener(\"fetch\", callback)<r>, which means it can't accept HTTP requests.\nShutting down JS.", .{});
                if (channel.tryReadItem() catch null) |item| {
                    item.ctx.sendInternalError(error.JSFailedToStart) catch {};
                    item.ctx.arena.deinit();
                }
                return;
            }

            js_ast.Stmt.Data.Store.reset();
            js_ast.Expr.Data.Store.reset();
            JavaScript.Wundle.flushCSSImports();

            try runLoop(vm);
        }

        pub fn runLoop(vm: *JavaScript.VirtualMachine) !void {
            var module_map = ZigGlobalObject.getModuleRegistryMap(vm.global);

            while (true) {
                defer {
                    std.debug.assert(ZigGlobalObject.resetModuleRegistryMap(vm.global, module_map));
                    js_ast.Stmt.Data.Store.reset();
                    js_ast.Expr.Data.Store.reset();
                    JavaScript.Wundle.flushCSSImports();
                }
                var handler: *JavaScriptHandler = try channel.readItem();

                try JavaScript.EventListenerMixin.emitFetchEvent(vm, &handler.ctx);
            }
        }

        var one: [1]*JavaScriptHandler = undefined;
        pub fn enqueue(ctx: *RequestContext, server: *Server, filepath_buf: []u8, params: *Router.Param.List) !void {
            var clone = try ctx.allocator.create(JavaScriptHandler);
            clone.ctx = ctx.*;
            clone.conn = ctx.conn.*;
            clone.ctx.conn = &clone.conn;

            if (params.len > 0) {
                clone.params = try params.clone(ctx.allocator);
            } else {
                clone.params = Router.Param.List{};
            }

            clone.ctx.matched_route.?.params = &clone.params;

            clone.ctx.matched_route.?.file_path = filepath_buf[0..ctx.matched_route.?.file_path.len];
            // this copy may be unnecessary, i'm not 100% sure where when
            std.mem.copy(u8, &clone.ctx.match_file_path_buf, filepath_buf[0..ctx.matched_route.?.file_path.len]);

            if (!has_loaded_channel) {
                has_loaded_channel = true;
                channel = Channel.init();
                var transform_options = server.transform_options;
                if (server.transform_options.node_modules_bundle_path_server) |bundle_path| {
                    transform_options.node_modules_bundle_path = bundle_path;
                    transform_options.node_modules_bundle_path_server = null;
                    try JavaScriptHandler.spawnThread(
                        HandlerThread{
                            .args = transform_options,
                            .framework = server.bundler.options.framework.?,
                            .existing_bundle = null,
                            .log = &server.log,
                            .watcher = server.watcher,
                        },
                    );
                } else {
                    try JavaScriptHandler.spawnThread(
                        HandlerThread{
                            .args = server.transform_options,
                            .framework = server.bundler.options.framework.?,
                            .existing_bundle = server.bundler.options.node_modules_bundle,
                            .log = &server.log,
                            .watcher = server.watcher,
                        },
                    );
                }
            }

            defer ctx.controlled = true;
            one[0] = clone;
            _ = try channel.write(&one);
        }
    };

    pub const WebsocketHandler = struct {
        accept_key: [28]u8 = undefined,
        ctx: RequestContext,
        websocket: Websocket.Websocket,
        conn: tcp.Connection,
        tombstone: bool = false,
        builder: WatchBuilder,
        message_buffer: MutableString,
        pub var open_websockets: std.ArrayList(*WebsocketHandler) = undefined;
        var open_websockets_lock = sync.RwLock.init();
        pub fn addWebsocket(ctx: *RequestContext) !*WebsocketHandler {
            open_websockets_lock.lock();
            defer open_websockets_lock.unlock();
            var clone = try ctx.allocator.create(WebsocketHandler);
            clone.ctx = ctx.*;
            clone.conn = ctx.conn.*;
            clone.message_buffer = try MutableString.init(ctx.allocator, 0);
            clone.ctx.conn = &clone.conn;
            var printer_writer = try js_printer.BufferWriter.init(ctx.allocator);

            clone.builder = WatchBuilder{
                .allocator = ctx.allocator,
                .bundler = ctx.bundler,
                .printer = js_printer.BufferPrinter.init(printer_writer),
                .timer = ctx.timer,
                .watcher = ctx.watcher,
            };

            clone.websocket = Websocket.Websocket.create(&clone.conn, SOCKET_FLAGS);
            clone.tombstone = false;
            try open_websockets.append(clone);
            return clone;
        }
        pub var to_close_buf: [100]*WebsocketHandler = undefined;
        pub var to_close: []*WebsocketHandler = &[_]*WebsocketHandler{};

        pub fn generateTimestamp(handler: *WebsocketHandler) u32 {
            return @truncate(u32, handler.ctx.timer.read() / std.time.ns_per_ms);
        }

        pub fn toTimestamp(timestamp: u64) u32 {
            return @truncate(u32, timestamp / std.time.ns_per_ms);
        }

        pub fn broadcast(message: []const u8) !void {
            {
                open_websockets_lock.lockShared();
                defer open_websockets_lock.unlockShared();
                var markForClosing = false;
                for (open_websockets.items) |item| {
                    var socket: *WebsocketHandler = item;
                    if (socket.tombstone) {
                        continue;
                    }

                    const written = socket.websocket.writeBinary(message) catch |err| brk: {
                        Output.prettyError("<r>WebSocket error: <b>{d}", .{@errorName(err)});
                        markForClosing = true;
                        break :brk 0;
                    };

                    if (socket.tombstone or written < message.len) {
                        markForClosing = true;
                    }

                    if (markForClosing) {
                        to_close_buf[to_close.len] = item;
                        to_close = to_close_buf[0 .. to_close.len + 1];
                    }
                }
            }

            if (to_close.len > 0) {
                open_websockets_lock.lock();
                defer open_websockets_lock.unlock();
                for (to_close) |item| {
                    WebsocketHandler.removeBulkWebsocket(item);
                }
                to_close = &[_]*WebsocketHandler{};
            }
        }

        pub fn removeWebsocket(socket: *WebsocketHandler) void {
            open_websockets_lock.lock();
            defer open_websockets_lock.unlock();
            removeBulkWebsocket(socket);
        }

        pub fn removeBulkWebsocket(socket: *WebsocketHandler) void {
            if (std.mem.indexOfScalar(*WebsocketHandler, open_websockets.items, socket)) |id| {
                socket.tombstone = true;
                _ = open_websockets.swapRemove(id);
            }
        }

        pub fn handle(self: *WebsocketHandler) void {
            var stdout = std.io.getStdOut();
            // var stdout = std.io.bufferedWriter(stdout_file.writer());
            var stderr = std.io.getStdErr();
            // var stderr = std.io.bufferedWriter(stderr_file.writer());
            var output_source = Output.Source.init(stdout, stderr);
            // defer stdout.flush() catch {};
            // defer stderr.flush() catch {};
            Output.Source.set(&output_source);
            Output.enable_ansi_colors = stderr.isTty();
            js_ast.Stmt.Data.Store.create(self.ctx.allocator);
            js_ast.Expr.Data.Store.create(self.ctx.allocator);
            _handle(self) catch {};
        }

        fn _handle(handler: *WebsocketHandler) !void {
            var ctx = &handler.ctx;
            defer handler.tombstone = true;
            defer removeWebsocket(handler);
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
            ctx.appendHeader("Sec-WebSocket-Protocol", "speedy-hmr");
            try ctx.writeStatus(101);
            try ctx.flushHeaders();
            Output.println("101 - Websocket connected.", .{});
            Output.flush();

            var cmd: Api.WebsocketCommand = undefined;
            var msg: Api.WebsocketMessage = .{
                .timestamp = handler.generateTimestamp(),
                .kind = .welcome,
            };
            var cmd_reader: ApiReader = undefined;
            var byte_buf: [32]u8 = undefined;
            var fbs = std.io.fixedBufferStream(&byte_buf);
            var writer = ByteApiWriter.init(&fbs);

            try msg.encode(&writer);
            var reloader = Api.Reloader.disable;
            if (ctx.bundler.options.hot_module_reloading) {
                reloader = Api.Reloader.live;
                if (ctx.bundler.options.jsx.supports_fast_refresh) {
                    if (ctx.bundler.options.node_modules_bundle) |bundle| {
                        if (bundle.hasFastRefresh()) {
                            reloader = Api.Reloader.fast_refresh;
                        }
                    }
                }
            }
            const welcome_message = Api.WebsocketMessageWelcome{
                .epoch = WebsocketHandler.toTimestamp(handler.ctx.timer.start_time),
                .javascript_reloader = reloader,
            };
            try welcome_message.encode(&writer);
            if ((try handler.websocket.writeBinary(fbs.getWritten())) == 0) {
                handler.tombstone = true;
                Output.prettyErrorln("<r><red>ERR:<r> <b>Websocket failed to write.<r>", .{});
            }

            while (!handler.tombstone) {
                defer Output.flush();
                handler.conn.client.getError() catch |err| {
                    Output.prettyErrorln("<r><red>ERR:<r> <b>{s}<r>", .{err});
                    handler.tombstone = true;
                };

                var frame = handler.websocket.read() catch |err| {
                    switch (err) {
                        error.ConnectionClosed => {
                            Output.prettyln("Websocket closed.", .{});
                            handler.tombstone = true;
                            continue;
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
                        _ = try handler.websocket.writeText(frame.data);
                    },
                    .Binary => {
                        var cnst_frame = constStrToU8(frame.data);
                        cmd_reader = ApiReader.init(cnst_frame, ctx.allocator);
                        cmd = try Api.WebsocketCommand.decode(&cmd_reader);
                        switch (cmd.kind) {
                            .build => {
                                var request = try Api.WebsocketCommandBuild.decode(&cmd_reader);
                                var build_result = try handler.builder.build(request.id, cmd.timestamp);
                                const file_path = switch (build_result.value) {
                                    .fail => |fail| fail.module_path,
                                    .success => |fail| fail.module_path,
                                };

                                switch (build_result.value) {
                                    .fail => {
                                        Output.errorLn(
                                            "Error: <b>{s}<r><b>",
                                            .{
                                                file_path,
                                            },
                                        );
                                    },
                                    .success => {
                                        Output.prettyln(
                                            "<r><b><green>{d}ms<r> <d>built<r> <b>{s}<r><b> <r><d>({d}+ LOC)",
                                            .{
                                                build_result.timestamp - cmd.timestamp,
                                                file_path,
                                                build_result.approximate_newline_count,
                                            },
                                        );
                                    },
                                }

                                defer Output.flush();
                                msg.timestamp = build_result.timestamp;
                                msg.kind = switch (build_result.value) {
                                    .success => .build_success,
                                    else => .build_fail,
                                };
                                handler.message_buffer.reset();
                                var buffer_writer = MutableStringAPIWriter.init(&handler.message_buffer);
                                try msg.encode(&buffer_writer);
                                var head = Websocket.WebsocketHeader{
                                    .final = true,
                                    .opcode = .Binary,
                                    .mask = false,
                                    .len = 0,
                                };

                                switch (build_result.value) {
                                    .success => |success| {
                                        try success.encode(&buffer_writer);
                                        const total = handler.message_buffer.list.items.len + build_result.bytes.len;
                                        head.len = Websocket.WebsocketHeader.packLength(total);
                                        try handler.websocket.writeHeader(head, total);
                                        _ = try handler.conn.client.write(handler.message_buffer.list.items, SOCKET_FLAGS);
                                        if (build_result.bytes.len > 0) {
                                            _ = try handler.conn.client.write(build_result.bytes, SOCKET_FLAGS);
                                        }
                                    },
                                    .fail => |fail| {
                                        try fail.encode(&buffer_writer);
                                        head.len = Websocket.WebsocketHeader.packLength(handler.message_buffer.list.items.len);
                                        try handler.websocket.writeHeader(head, handler.message_buffer.list.items.len);
                                        _ = try handler.conn.client.write(handler.message_buffer.list.items, SOCKET_FLAGS);
                                    },
                                }
                            },
                            else => {
                                Output.prettyErrorln("<r>[Websocket]: Unknown cmd: <b>{d}<r>. This might be a version mismatch. Try updating your node_modules.jsb", .{@enumToInt(cmd.kind)});
                            },
                        }
                    },
                    .Ping => {
                        var pong = frame;
                        pong.header.opcode = .Pong;
                        _ = try handler.websocket.writeDataFrame(pong);
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

    pub fn writeETag(this: *RequestContext, buffer: anytype) !bool {
        const strong_etag = std.hash.Wyhash.hash(1, buffer);
        const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});

        this.appendHeader("ETag", etag_content_slice);

        if (this.header("If-None-Match")) |etag_header| {
            if (std.mem.eql(u8, etag_content_slice, etag_header.value)) {
                try this.sendNotModified();
                return true;
            }
        }

        return false;
    }

    pub fn handleWebsocket(ctx: *RequestContext) anyerror!void {
        ctx.controlled = true;
        var handler = try WebsocketHandler.addWebsocket(ctx);
        _ = try std.Thread.spawn(.{}, WebsocketHandler.handle, .{handler});
    }

    pub fn auto500(ctx: *RequestContext) void {
        if (ctx.has_called_done) {
            return;
        }

        defer ctx.done();

        if (ctx.status == null) {
            ctx.writeStatus(500) catch {};
        }

        if (!ctx.has_written_last_header) {
            ctx.flushHeaders() catch {};
        }
    }

    pub fn renderServeResult(ctx: *RequestContext, result: bundler.ServeResult) !void {
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
                    _loader: Options.Loader,
                    threadlocal var buffer: MutableString = undefined;
                    threadlocal var has_loaded_buffer: bool = false;

                    pub fn init(rctx: *RequestContext, _loader: Options.Loader) SocketPrinterInternal {
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
                            ._loader = _loader,
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

                    pub fn slice(_ctx: *SocketPrinterInternal) string {
                        return buffer.list.items;
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
                            // Always cache css & json files, even big ones
                            // css is especially important because we want to try and skip having the browser parse it whenever we can
                            if (buf.len < 16 * 16 * 16 * 16 or chunky._loader == .css or chunky._loader == .json) {
                                const strong_etag = std.hash.Wyhash.hash(1, buf);
                                const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});
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
                const loader = ctx.bundler.options.loaders.get(result.file.input.name.ext) orelse .file;

                var chunked_encoder = SocketPrinter.init(
                    SocketPrinterInternal.init(ctx, loader),
                );

                // It will call flush for us automatically
                ctx.bundler.resetStore();
                var written = ctx.bundler.buildWithResolveResult(
                    resolve_result,
                    ctx.allocator,
                    loader,
                    SocketPrinter,
                    chunked_encoder,
                    .absolute_url,
                    input_fd,
                    hash,
                    Watcher,
                    ctx.watcher,
                ) catch |err| {
                    ctx.sendInternalError(err) catch {};
                    return;
                };

                // CSS handles this specially
                if (loader != .css) {
                    if (written.input_fd) |written_fd| {
                        try ctx.watcher.addFile(
                            written_fd,
                            result.file.input.text,
                            hash,
                            loader,
                            true,
                        );
                        if (ctx.watcher.watchloop_handle == null) {
                            try ctx.watcher.start();
                        }
                    }
                } else {
                    if (written.written > 0) {
                        if (ctx.watcher.watchloop_handle == null) {
                            try ctx.watcher.start();
                        }
                    }
                }
            },
            .noop => {
                try ctx.sendNotFound();
            },
            .copy, .move => |file| {
                // defer std.os.close(file.fd);
                defer {
                    // for public dir content, we close on completion
                    if (file.close_handle_on_complete) {
                        std.debug.assert(!file.autowatch);
                        std.os.close(file.fd);
                    }

                    if (file.autowatch) {
                        // we must never autowatch a file that will be closed
                        std.debug.assert(!file.close_handle_on_complete);
                        if (ctx.watcher.addFile(
                            file.fd,
                            result.file.input.text,
                            Watcher.getHash(result.file.input.text),
                            result.file.loader,
                            true,
                        )) {
                            if (ctx.watcher.watchloop_handle == null) {
                                ctx.watcher.start() catch |err| {
                                    Output.prettyErrorln("Failed to start watcher: {s}", .{@errorName(err)});
                                };
                            }
                        } else |err| {}
                    }
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

                const etag_content_slice = std.fmt.bufPrintIntToSlice(weak_etag_buffer[2..], weak_etag.final(), 16, .upper, .{});
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
                    const did_send = ctx.writeETag(buffer) catch false;
                    if (did_send) return;
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
    }

    pub fn handleReservedRoutes(ctx: *RequestContext) !bool {
        if (strings.eqlComptime(ctx.url.extname, "jsb") and ctx.bundler.options.node_modules_bundle != null) {
            try ctx.sendJSB();
            return true;
        }

        if (strings.eqlComptime(ctx.url.path, "_api.hmr")) {
            try ctx.handleWebsocket();
            return true;
        }

        return false;
    }

    pub fn handleGet(ctx: *RequestContext) !void {

        // errdefer ctx.auto500();

        const result = try ctx.bundler.buildFile(
            &ctx.log,
            ctx.allocator,
            ctx.url.path,
            ctx.url.extname,
        );

        try @call(.{ .modifier = .always_inline }, RequestContext.renderServeResult, .{ ctx, result });
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

// // u32 == File ID from Watcher
// pub const WatcherBuildChannel = sync.Channel(u32, .Dynamic);
// pub const WatcherBuildQueue = struct {
//     channel: WatcherBuildChannel,
//     bundler: *Bundler,
//     watcher: *Watcher,
//     allocator: *std.mem.Allocator,

//     pub fn start(queue: *@This()) void {
//         var stdout = std.io.getStdOut();
//         var stderr = std.io.getStdErr();
//         var output_source = Output.Source.init(stdout, stderr);

//         Output.Source.set(&output_source);
//         Output.enable_ansi_colors = stderr.isTty();
//         defer Output.flush();
//         queue.loop();
//     }

//     pub fn loop(queue: *@This()) !void {
//         while (true) {

//         }
//     }
// };

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
    timer: std.time.Timer = undefined,
    transform_options: Api.TransformOptions,

    javascript_enabled: bool = false,

    pub fn adjustUlimit() !void {
        var limit = try std.os.getrlimit(.NOFILE);
        if (limit.cur < limit.max) {
            var new_limit = std.mem.zeroes(std.os.rlimit);
            new_limit.cur = limit.max;
            new_limit.max = limit.max;
            try std.os.setrlimit(.NOFILE, new_limit);
        }
    }

    pub fn onTCPConnection(server: *Server, conn: tcp.Connection, comptime features: ConnectionFeatures) void {
        conn.client.setNoDelay(true) catch {};
        conn.client.setQuickACK(true) catch {};
        conn.client.setLinger(1) catch {};

        server.handleConnection(&conn, comptime features);
    }

    threadlocal var filechange_buf: [32]u8 = undefined;

    pub fn onFileUpdate(ctx: *Server, events: []watcher.WatchEvent, watchlist: watcher.Watchlist) void {
        if (ctx.javascript_enabled) {
            _onFileUpdate(ctx, events, watchlist, true);
        } else {
            _onFileUpdate(ctx, events, watchlist, false);
        }
    }

    fn _onFileUpdate(
        ctx: *Server,
        events: []watcher.WatchEvent,
        watchlist: watcher.Watchlist,
        comptime is_javascript_enabled: bool,
    ) void {
        var fbs = std.io.fixedBufferStream(&filechange_buf);
        var writer = ByteApiWriter.init(&fbs);
        const message_type = Api.WebsocketMessage{
            .timestamp = RequestContext.WebsocketHandler.toTimestamp(ctx.timer.read()),
            .kind = .file_change_notification,
        };
        message_type.encode(&writer) catch unreachable;
        var header = fbs.getWritten();
        for (events) |event| {
            const file_path = watchlist.items(.file_path)[event.index];
            const update_count = watchlist.items(.count)[event.index] + 1;
            watchlist.items(.count)[event.index] = update_count;

            // so it's consistent with the rest
            // if we use .extname we might run into an issue with whether or not the "." is included.
            const path = Fs.PathName.init(file_path);
            const id = watchlist.items(.hash)[event.index];
            var content_fbs = std.io.fixedBufferStream(filechange_buf[header.len..]);

            defer {
                if (comptime is_javascript_enabled) {
                    // TODO: does this need a lock?
                    // RequestContext.JavaScriptHandler.javascript_vm.incrementUpdateCounter(id, update_count);
                }
            }
            const change_message = Api.WebsocketMessageFileChangeNotification{
                .id = id,
                .loader = (ctx.bundler.options.loaders.get(path.ext) orelse .file).toAPI(),
            };

            var content_writer = ByteApiWriter.init(&content_fbs);
            change_message.encode(&content_writer) catch unreachable;
            const change_buf = content_fbs.getWritten();
            const written_buf = filechange_buf[0 .. header.len + change_buf.len];
            defer Output.flush();
            RequestContext.WebsocketHandler.broadcast(written_buf) catch |err| {
                Output.prettyln("Error writing change notification: {s}", .{@errorName(err)});
            };
            Output.prettyln("<r><d>Detected file change: {s}", .{ctx.bundler.fs.relativeTo(file_path)});
        }
    }

    fn run(server: *Server, comptime features: ConnectionFeatures) !void {
        adjustUlimit() catch {};
        const listener = try tcp.Listener.init(.ip, .{ .close_on_exec = true });
        defer listener.deinit();
        RequestContext.WebsocketHandler.open_websockets = @TypeOf(
            RequestContext.WebsocketHandler.open_websockets,
        ).init(server.allocator);

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

            server.handleConnection(&conn, comptime features);
        }
    }

    pub fn sendError(server: *Server, request: *Request, conn: *tcp.Connection, code: HTTPStatusCode, msg: string) !void {
        try server.writeStatus(code, connection);
    }

    threadlocal var req_buf: [32_000]u8 = undefined;

    pub const ConnectionFeatures = struct {
        public_folder: bool = false,
        filesystem_router: bool = false,
    };

    pub fn handleConnection(server: *Server, conn: *tcp.Connection, comptime features: ConnectionFeatures) void {

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
            server.timer,
        ) catch |err| {
            Output.printErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
            conn.client.deinit();
            return;
        };

        req_ctx.allocator = &req_ctx.arena.allocator;
        req_ctx.log = logger.Log.init(req_ctx.allocator);

        if (comptime FeatureFlags.keep_alive) {
            if (req_ctx.header("Connection")) |connection| {
                req_ctx.keep_alive = strings.eqlInsensitive(connection.value, "keep-alive");
            }

            conn.client.setKeepAlive(req_ctx.keep_alive) catch {};
        } else {
            req_ctx.keep_alive = false;
        }

        var finished = req_ctx.handleReservedRoutes() catch |err| {
            Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
            return;
        };

        if (comptime features.public_folder and features.filesystem_router) {
            if (!finished) {
                if (req_ctx.matchPublicFolder()) |result| {
                    finished = true;
                    req_ctx.renderServeResult(result) catch |err| {
                        Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                        return;
                    };
                }
            }

            if (!finished) {
                req_ctx.bundler.router.?.match(server, RequestContext, &req_ctx) catch |err| {
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
            }
        } else if (comptime features.public_folder) {
            if (!finished) {
                if (req_ctx.matchPublicFolder()) |result| {
                    finished = true;
                    req_ctx.renderServeResult(result) catch |err| {
                        Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                        return;
                    };
                }
            }

            if (!finished) {
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
            }
        } else if (comptime features.filesystem_router) {
            if (!finished) {
                req_ctx.bundler.router.?.match(server, RequestContext, &req_ctx) catch |err| {
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
            }
        } else {
            if (!finished) {
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
            }
        }

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
            .transform_options = options,
            .timer = try std.time.Timer.start(),
        };
        server.bundler = try Bundler.init(allocator, &server.log, options, null);
        server.bundler.configureLinker();
        try server.bundler.configureRouter();

        try server.initWatcher();

        if (server.bundler.router != null and server.bundler.options.routes.static_dir_enabled) {
            try server.run(
                ConnectionFeatures{ .public_folder = true, .filesystem_router = true },
            );
        } else if (server.bundler.router != null) {
            try server.run(
                ConnectionFeatures{ .public_folder = false, .filesystem_router = true },
            );
        } else if (server.bundler.options.routes.static_dir_enabled) {
            try server.run(
                ConnectionFeatures{ .public_folder = true, .filesystem_router = false },
            );
        } else {
            try server.run(
                ConnectionFeatures{ .public_folder = false, .filesystem_router = false },
            );
        }
    }
};
