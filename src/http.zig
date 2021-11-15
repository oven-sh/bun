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
const Fallback = @import("./runtime.zig").Fallback;
const ErrorCSS = @import("./runtime.zig").ErrorCSS;
const ErrorJS = @import("./runtime.zig").ErrorJS;
const Css = @import("css_scanner.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const resolve_path = @import("./resolver/resolve_path.zig");
const OutputFile = Options.OutputFile;
const DotEnv = @import("./env_loader.zig");
const mimalloc = @import("./allocators/mimalloc.zig");
const MacroMap = @import("./resolver/package_json.zig").MacroMap;
const Analytics = @import("./analytics/analytics_thread.zig");
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

const picohttp = @import("./deps/picohttp.zig");
const Header = picohttp.Header;
const Request = picohttp.Request;
const Response = picohttp.Response;
pub const Headers = picohttp.Headers;
pub const MimeType = @import("./http/mime_type.zig");
const Bundler = bundler.Bundler;
const Websocket = @import("./http/websocket.zig");
const js_printer = @import("./js_printer.zig");
const SOCKET_FLAGS = os.SOCK_CLOEXEC;
const watcher = @import("./watcher.zig");
threadlocal var req_headers_buf: [100]picohttp.Header = undefined;
threadlocal var res_headers_buf: [100]picohttp.Header = undefined;
const sync = @import("./sync.zig");
const JavaScript = @import("./javascript/jsc/javascript.zig");
const JavaScriptCore = @import("./javascript/jsc/JavascriptCore.zig");
usingnamespace @import("./javascript/jsc/bindings/bindings.zig");
usingnamespace @import("./javascript/jsc/bindings/exports.zig");
const Router = @import("./router.zig");
pub const Watcher = watcher.NewWatcher(*Server);
const ZigURL = @import("./query_string_map.zig").URL;

const HTTPStatusCode = u10;
const URLPath = @import("./http/url_path.zig");
const Method = @import("./http/method.zig").Method;

pub const RequestContext = struct {
    request: Request,
    method: Method,
    url: URLPath,
    conn: *tcp.Connection,
    allocator: *std.mem.Allocator,
    arena: *std.heap.ArenaAllocator,
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
    res_headers_count: usize = 0,

    /// --disable-bun.js propagates here
    pub var fallback_only = false;

    pub fn getFullURL(this: *RequestContext) [:0]const u8 {
        if (this.full_url.len == 0) {
            if (this.bundler.options.origin.isAbsolute()) {
                this.full_url = std.fmt.allocPrintZ(this.allocator, "{s}{s}", .{ this.bundler.options.origin.origin, this.request.path }) catch unreachable;
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

    pub fn renderFallback(
        this: *RequestContext,
        allocator: *std.mem.Allocator,
        bundler_: *Bundler,
        step: Api.FallbackStep,
        log: *logger.Log,
        err: anyerror,
        exceptions: []Api.JsException,
        comptime fmt: string,
        args: anytype,
    ) !void {
        var route_index: i32 = -1;
        const routes: Api.StringMap = if (bundler_.router != null) brk: {
            const router = &bundler_.router.?;
            break :brk Api.StringMap{
                .keys = router.getNames() catch unreachable,
                .values = router.getPublicPaths() catch unreachable,
            };
        } else std.mem.zeroes(Api.StringMap);
        var preload: string = "";

        var params: Api.StringMap = std.mem.zeroes(Api.StringMap);
        if (fallback_entry_point_created == false) {
            defer fallback_entry_point_created = true;
            defer bundler_.resetStore();

            // You'd think: hey we're just importing a file
            // Do we really need to run it through the transpiler and linking and printing?
            // The answer, however, is yes.
            // What if you're importing a fallback that's in node_modules?
            try fallback_entry_point.generate(bundler_.options.framework.?.fallback.path, Bundler, bundler_);

            const bundler_parse_options = Bundler.ParseOptions{
                .allocator = default_allocator,
                .path = fallback_entry_point.source.path,
                .loader = .js,
                .macro_remappings = .{},
                .dirname_fd = 0,
                .jsx = bundler_.options.jsx,
            };

            if (bundler_.parse(
                bundler_parse_options,
                @as(?*bundler.FallbackEntryPoint, &fallback_entry_point),
            )) |*result| {
                try bundler_.linker.link(fallback_entry_point.source.path, result, .absolute_url, false);
                var buffer_writer = try js_printer.BufferWriter.init(default_allocator);
                var writer = js_printer.BufferPrinter.init(buffer_writer);
                _ = try bundler_.print(
                    result.*,
                    @TypeOf(&writer),
                    &writer,
                    .esm,
                );
                var slice = writer.ctx.buffer.toOwnedSliceLeaky();

                fallback_entry_point.built_code = try default_allocator.dupe(u8, slice);

                writer.ctx.buffer.deinit();
            }
        }

        if (this.matched_route) |match| {
            if (match.params.len > 0) {
                params.keys = match.params.items(.name);
                params.values = match.params.items(.value);
            }

            if (this.bundler.router.?.routeIndexByHash(match.hash)) |ind| {
                route_index = @intCast(i32, ind);
            }
        }

        var fallback_container = try allocator.create(Api.FallbackMessageContainer);
        defer allocator.destroy(fallback_container);
        fallback_container.* = Api.FallbackMessageContainer{
            .message = try std.fmt.allocPrint(allocator, fmt, args),
            .router = if (routes.keys.len > 0)
                Api.Router{ .route = route_index, .params = params, .routes = routes }
            else
                null,
            .reason = step,
            .cwd = this.bundler.fs.top_level_dir,
            .problems = Api.Problems{
                .code = @truncate(u16, @errorToInt(err)),
                .name = @errorName(err),
                .exceptions = exceptions,
                .build = try log.toAPI(allocator),
            },
        };

        defer this.done();

        if (RequestContext.fallback_only) {
            try this.writeStatus(200);
        } else {
            try this.writeStatus(500);
        }

        const route_name = if (route_index > -1) this.matched_route.?.name else this.url.pathname;
        if (comptime fmt.len > 0) Output.prettyErrorln(fmt, args);
        Output.flush();
        this.appendHeader("Content-Type", MimeType.html.value);
        var bb = std.ArrayList(u8).init(allocator);
        defer bb.deinit();
        var bb_writer = bb.writer();

        try Fallback.render(
            allocator,
            fallback_container,
            preload,
            fallback_entry_point.built_code,
            @TypeOf(bb_writer),
            bb_writer,
        );
        try this.prepareToSendBody(bb.items.len, false);
        try this.writeBodyBuf(bb.items);
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
            if (this.bundler.options.routes.single_page_app_routing and
                this.bundler.options.routes.single_page_app_fd != 0)
            {
                this.sendSinglePageHTML() catch {};
                return null;
            } else if (public_dir.openFile("index.html", .{})) |file| {
                var index_path = "index.html".*;
                relative_unrooted_path = &(index_path);
                _file = file;
                extension = "html";
            } else |err| {}

            // Okay is it actually a full path?
        } else if (extension.len > 0) {
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
                file.* = std.fs.openFileAbsolute(absolute_path, .{ .read = true }) catch return null;

                absolute_path = std.os.getFdPath(
                    file.handle,
                    &Bundler.tmp_buildfile_buf,
                ) catch return null;

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
            200 => "YAY",
            201 => "NEW",
            204 => "VERY CONTENT",
            206 => "MUCH CONTENT",
            304 => "NOT MODIFIED",
            300...303, 305...399 => "REDIRECT",
            404 => "Not Found",
            403 => "Not Allowed!",
            401 => "Login",
            402 => "Pay Me",
            400, 405...499 => "bad request :(",
            500...599 => "ERR",
            else => @compileError("Invalid code passed to printStatusLine"),
        };

        return std.fmt.comptimePrint("HTTP/1.1 {d} {s}\r\n", .{ code, status_text });
    }

    threadlocal var content_length_header_buf: [64]u8 = undefined;

    pub fn prepareToSendBody(
        ctx: *RequestContext,
        length: usize,
        comptime chunked: bool,
    ) !void {
        defer {
            if (Environment.isDebug or isTest) {
                std.debug.assert(!ctx.has_written_last_header);
                ctx.has_written_last_header = true;
            }
        }

        if (chunked) {
            ctx.appendHeader("Transfer-Encoding", "Chunked");
        } else {
            ctx.appendHeader("Content-Length", content_length_header_buf[0..std.fmt.formatIntBuf(&content_length_header_buf, length, 10, .upper, .{})]);
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
        arena: *std.heap.ArenaAllocator,
        conn: *tcp.Connection,
        bundler_: *Bundler,
        watcher_: *Watcher,
        timer: std.time.Timer,
    ) !RequestContext {
        var ctx = RequestContext{
            .request = req,
            .arena = arena,
            .bundler = bundler_,
            .log = undefined,
            .url = try URLPath.parse(req.path),
            .conn = conn,
            .allocator = &arena.allocator,
            .method = Method.which(req.method) orelse return error.InvalidMethod,
            .watcher = watcher_,
            .timer = timer,
        };

        return ctx;
    }

    pub inline fn isBrowserNavigation(req: *RequestContext) bool {
        if (req.header("Sec-Fetch-Mode")) |mode| {
            return strings.eqlComptime(mode.value, "navigate");
        }

        return false;
    }

    pub fn sendNotFound(req: *RequestContext) !void {
        std.debug.assert(!req.has_called_done);

        defer req.done();
        try req.writeStatus(404);
        try req.flushHeaders();
    }

    pub fn sendInternalError(ctx: *RequestContext, err: anytype) !void {
        defer ctx.done();
        try ctx.writeStatus(500);
        const printed = std.fmt.bufPrint(&error_buf, "Error: {s}", .{@errorName(err)}) catch |err2| brk: {
            if (Environment.isDebug or isTest) {
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
        if (comptime isDebug or isTest) std.debug.assert(!ctx.has_written_last_header);
        if (comptime isDebug or isTest) std.debug.assert(ctx.res_headers_count < res_headers_buf.len);
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
        ctx.appendHeader("ETag", node_modules_bundle.bundle.etag);
        ctx.appendHeader("Content-Type", "text/javascript");
        ctx.appendHeader("Cache-Control", "immutable, max-age=99999");

        if (ctx.header("If-None-Match")) |etag_header| {
            if (std.mem.eql(u8, node_modules_bundle.bundle.etag, etag_header.value)) {
                try ctx.sendNotModified();
                return;
            }
        }

        defer ctx.done();

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

    pub fn sendSinglePageHTML(ctx: *RequestContext) !void {
        ctx.appendHeader("Content-Type", MimeType.html.value);
        ctx.appendHeader("Cache-Control", "no-cache");

        defer ctx.done();

        std.debug.assert(ctx.bundler.options.routes.single_page_app_fd > 0);
        const file = std.fs.File{ .handle = ctx.bundler.options.routes.single_page_app_fd };
        const stats = file.stat() catch |err| {
            Output.prettyErrorln("<r><red>Error {s}<r> reading index.html", .{@errorName(err)});
            ctx.writeStatus(500) catch {};
            return;
        };

        const content_length = stats.size;
        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(content_length, false);

        _ = try std.os.sendfile(
            ctx.conn.client.socket.fd,
            ctx.bundler.options.routes.single_page_app_fd,
            0,
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
        count: usize = 0,
        pub const WatchBuildResult = struct {
            value: Value,
            id: u32,
            timestamp: u32,
            log: logger.Log,
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
        pub fn build(this: *WatchBuilder, id: u32, from_timestamp: u32, allocator: *std.mem.Allocator) !WatchBuildResult {
            if (this.count == 0) {
                var writer = try js_printer.BufferWriter.init(this.allocator);
                this.printer = js_printer.BufferPrinter.init(writer);
                this.printer.ctx.append_null_byte = false;
            }

            defer this.count += 1;

            var log = logger.Log.init(allocator);

            var watchlist_slice = this.watcher.watchlist.slice();

            const index = std.mem.indexOfScalar(u32, watchlist_slice.items(.hash), id) orelse {

                // log.addErrorFmt(null, logger.Loc.Empty, this, "File missing from watchlist: {d}. Please refresh :(", .{hash}) catch unreachable;
                return WatchBuildResult{
                    .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                    .id = id,
                    .log = log,
                    .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                };
            };

            const file_path_str = watchlist_slice.items(.file_path)[index];
            const fd = watchlist_slice.items(.fd)[index];
            const loader = watchlist_slice.items(.loader)[index];
            const macro_remappings = brk: {
                if (watchlist_slice.items(.package_json)[index]) |package_json| {
                    break :brk package_json.macros;
                }

                break :brk MacroMap{};
            };

            const path = Fs.Path.init(file_path_str);
            var old_log = this.bundler.log;
            this.bundler.setLog(&log);

            defer {
                this.bundler.setLog(old_log);
            }

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
                        Bundler.ParseOptions{
                            .allocator = allocator,
                            .path = path,
                            .loader = loader,
                            .dirname_fd = 0,
                            .file_descriptor = fd,
                            .file_hash = id,
                            .macro_remappings = macro_remappings,
                            // TODO: make this work correctly when multiple tsconfigs define different JSX pragmas
                            .jsx = this.bundler.options.jsx,
                        },
                        null,
                    ) orelse {
                        return WatchBuildResult{
                            .value = .{
                                .fail = .{
                                    .id = id,
                                    .from_timestamp = from_timestamp,
                                    .loader = loader.toAPI(),
                                    .module_path = this.bundler.fs.relativeTo(file_path_str),
                                    .log = try log.toAPI(allocator),
                                },
                            },
                            .id = id,
                            .log = log,
                            .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                        };
                    };

                    this.printer.ctx.reset();
                    {
                        var old_allocator = this.bundler.linker.allocator;
                        this.bundler.linker.allocator = allocator;
                        defer this.bundler.linker.allocator = old_allocator;
                        this.bundler.linker.link(
                            Fs.Path.init(file_path_str),
                            &parse_result,
                            .absolute_url,
                            false,
                        ) catch |err| {
                            return WatchBuildResult{
                                .value = .{
                                    .fail = .{
                                        .id = id,
                                        .from_timestamp = from_timestamp,
                                        .loader = loader.toAPI(),
                                        .module_path = this.bundler.fs.relativeTo(file_path_str),
                                        .log = try log.toAPI(allocator),
                                    },
                                },

                                .id = id,
                                .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                                .log = log,
                            };
                        };
                    }

                    var written = this.bundler.print(parse_result, @TypeOf(&this.printer), &this.printer, .esm) catch |err| {
                        return WatchBuildResult{
                            .value = .{
                                .fail = .{
                                    .id = id,
                                    .from_timestamp = from_timestamp,
                                    .loader = loader.toAPI(),
                                    .module_path = this.bundler.fs.relativeTo(file_path_str),
                                    .log = try log.toAPI(allocator),
                                },
                            },
                            .id = id,
                            .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                            .log = log,
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
                            },
                        },
                        .id = id,
                        .bytes = this.printer.ctx.written,
                        .approximate_newline_count = parse_result.ast.approximate_newline_count,
                        .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                        .log = log,
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
                            break :brk CSSBundlerHMR.bundle(
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
                            break :brk CSSBundler.bundle(
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
                    } catch {
                        return WatchBuildResult{
                            .value = .{
                                .fail = .{
                                    .id = id,
                                    .from_timestamp = from_timestamp,
                                    .loader = loader.toAPI(),
                                    .module_path = this.bundler.fs.relativeTo(file_path_str),
                                    .log = try log.toAPI(allocator),
                                },
                            },
                            .id = id,
                            .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                            .log = log,
                        };
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
                        .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                        .log = log,
                    };
                },
                else => {
                    return WatchBuildResult{
                        .value = .{ .fail = std.mem.zeroes(Api.WebsocketMessageBuildFailure) },
                        .id = id,
                        .timestamp = WebsocketHandler.toTimestamp(Server.global_start_time.read()),
                        .log = log,
                    };
                },
            }
        }
    };

    pub const JavaScriptHandler = struct {
        ctx: RequestContext,
        conn: tcp.Connection,
        params: Router.Param.List,

        pub var javascript_vm: ?*JavaScript.VirtualMachine = null;

        pub const HandlerThread = struct {
            args: Api.TransformOptions,
            framework: Options.Framework,
            existing_bundle: ?*NodeModuleBundle,
            log: *logger.Log = undefined,
            watcher: *Watcher,
            env_loader: *DotEnv.Loader,
            origin: ZigURL,
            client_bundler: Bundler,

            pub fn handleJSError(
                this: *HandlerThread,
                comptime step: Api.FallbackStep,
                err: anyerror,
            ) !void {
                return try this.handleJSErrorFmt(
                    step,
                    err,

                    "<r>JavaScript VM failed to start due to <red>{s}<r>.",
                    .{
                        @errorName(err),
                    },
                );
            }

            pub fn handleJSErrorFmt(this: *HandlerThread, comptime step: Api.FallbackStep, err: anyerror, comptime fmt: string, args: anytype) !void {
                var arena = std.heap.ArenaAllocator.init(default_allocator);
                var allocator = &arena.allocator;
                defer arena.deinit();

                defer this.log.msgs.clearRetainingCapacity();

                if (Output.enable_ansi_colors) {
                    if (this.log.msgs.items.len > 0) {
                        for (this.log.msgs.items) |msg| {
                            msg.writeFormat(Output.errorWriter(), true) catch continue;
                        }
                    }
                } else {
                    if (this.log.msgs.items.len > 0) {
                        for (this.log.msgs.items) |msg| {
                            msg.writeFormat(Output.errorWriter(), false) catch continue;
                        }
                    }
                }

                Output.prettyErrorln(fmt, args);
                Output.flush();

                while (channel.tryReadItem() catch null) |item| {
                    item.ctx.renderFallback(
                        allocator,
                        &this.client_bundler,
                        step,
                        this.log,
                        err,
                        &[_]Api.JsException{},
                        comptime Output.prettyFmt(fmt, false),
                        args,
                    ) catch {};
                }
            }

            pub fn handleRuntimeJSError(this: *HandlerThread, js_value: JSValue, comptime step: Api.FallbackStep, comptime fmt: string, args: anytype) !void {
                var arena = std.heap.ArenaAllocator.init(default_allocator);
                var allocator = &arena.allocator;
                defer arena.deinit();
                defer this.log.msgs.clearRetainingCapacity();

                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(allocator);
                defer exception_list.deinit();

                if (!js_value.isUndefinedOrNull()) {
                    javascript_vm.?.defaultErrorHandler(
                        js_value,
                        &exception_list,
                    );
                } else {
                    if (Output.enable_ansi_colors) {
                        if (this.log.msgs.items.len > 0) {
                            for (this.log.msgs.items) |msg| {
                                msg.writeFormat(Output.errorWriter(), true) catch continue;
                            }
                        }
                    } else {
                        if (this.log.msgs.items.len > 0) {
                            for (this.log.msgs.items) |msg| {
                                msg.writeFormat(Output.errorWriter(), false) catch continue;
                            }
                        }
                    }

                    Output.flush();
                }

                while (channel.tryReadItem() catch null) |item| {
                    item.ctx.renderFallback(
                        allocator,
                        &this.client_bundler,
                        step,
                        this.log,
                        error.JSError,
                        exception_list.items,
                        comptime Output.prettyFmt(fmt, false),
                        args,
                    ) catch {};
                }
            }

            pub fn handleFetchEventError(this: *HandlerThread, err: anyerror, js_value: JSValue, ctx: *RequestContext) !void {
                var arena = std.heap.ArenaAllocator.init(default_allocator);
                var allocator = &arena.allocator;
                defer arena.deinit();

                defer this.log.msgs.clearRetainingCapacity();

                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(allocator);
                defer exception_list.deinit();
                var did_log_messages = false;
                if (!js_value.isUndefinedOrNull()) {
                    var start_count = this.log.msgs.items.len;
                    javascript_vm.?.defaultErrorHandler(
                        js_value,
                        &exception_list,
                    );
                    did_log_messages = start_count != this.log.msgs.items.len and exception_list.items.len == 0;
                } else {
                    if (Output.enable_ansi_colors) {
                        if (this.log.msgs.items.len > 0) {
                            for (this.log.msgs.items) |msg| {
                                msg.writeFormat(Output.errorWriter(), true) catch continue;
                            }
                        }
                    } else {
                        if (this.log.msgs.items.len > 0) {
                            for (this.log.msgs.items) |msg| {
                                msg.writeFormat(Output.errorWriter(), false) catch continue;
                            }
                        }
                    }

                    Output.flush();
                }

                ctx.renderFallback(
                    allocator,
                    &this.client_bundler,
                    Api.FallbackStep.fetch_event_handler,
                    this.log,
                    if (did_log_messages) error.BuildTimeError else err,
                    exception_list.items,
                    "",
                    .{},
                ) catch {};
            }
        };

        pub const Channel = sync.Channel(*JavaScriptHandler, .{ .Static = 100 });
        pub var channel: Channel = undefined;
        var has_loaded_channel = false;
        pub var javascript_disabled = false;
        var js_thread: std.Thread = undefined;
        pub fn spawnThread(handler: *HandlerThread) !void {
            js_thread = try std.Thread.spawn(.{ .stack_size = 64 * 1024 * 1024 }, spawn, .{handler});
            js_thread.setName("JavaScript SSR") catch {};
            js_thread.detach();
        }

        pub fn spawn(handler: *HandlerThread) void {
            _spawn(handler) catch {};
        }

        pub fn _spawn(handler: *HandlerThread) !void {
            defer {
                javascript_disabled = true;
            }
            var start_timer = std.time.Timer.start() catch unreachable;

            var stdout = std.io.getStdOut();
            var stderr = std.io.getStdErr();
            var output_source = Output.Source.init(stdout, stderr);
            defer Output.flush();
            Output.Source.set(&output_source);
            @import("javascript/jsc/JavascriptCore.zig").JSCInitialize();

            js_ast.Stmt.Data.Store.create(std.heap.c_allocator);
            js_ast.Expr.Data.Store.create(std.heap.c_allocator);

            var vm = JavaScript.VirtualMachine.init(
                std.heap.c_allocator,
                handler.args,
                handler.existing_bundle,
                handler.log,
                handler.env_loader,
            ) catch |err| {
                handler.handleJSError(.create_vm, err) catch {};
                return;
            };
            vm.bundler.log = handler.log;
            std.debug.assert(JavaScript.VirtualMachine.vm_loaded);
            javascript_vm = vm;
            vm.bundler.options.origin = handler.origin;
            const boot = vm.bundler.options.framework.?.server.path;
            std.debug.assert(boot.len > 0);
            errdefer vm.deinit();
            vm.watcher = handler.watcher;
            {
                defer vm.flush();
                vm.bundler.configureRouter(false) catch |err| {
                    handler.handleJSError(.configure_router, err) catch {};
                    return;
                };
                vm.bundler.configureDefines() catch |err| {
                    handler.handleJSError(.configure_defines, err) catch {};
                    return;
                };

                var entry_point = boot;
                if (!std.fs.path.isAbsolute(entry_point)) {
                    const resolved_entry_point = vm.bundler.resolver.resolve(
                        std.fs.path.dirname(boot) orelse vm.bundler.fs.top_level_dir,
                        vm.bundler.normalizeEntryPointPath(boot),
                        .entry_point,
                    ) catch |err| {
                        try handler.handleJSError(
                            .resolve_entry_point,
                            err,
                        );
                        return;
                    };
                    entry_point = (resolved_entry_point.pathConst() orelse {
                        handler.handleJSErrorFmt(
                            .resolve_entry_point,
                            error.EntryPointDisabled,
                            "<r>JavaScript VM failed to start due to disabled entry point: <r><b>\"{s}\"",
                            .{resolved_entry_point.path_pair.primary.text},
                        ) catch {};

                        return;
                    }).text;
                }

                var load_result = vm.loadEntryPoint(
                    entry_point,
                ) catch |err| {
                    handler.handleJSErrorFmt(
                        .load_entry_point,
                        err,
                        "<r>JavaScript VM failed to start.\n<red>{s}:<r> while loading <r><b>\"{s}\"",
                        .{ @errorName(err), entry_point },
                    ) catch {};

                    return;
                };

                switch (load_result.status(vm.global.vm())) {
                    JSPromise.Status.Fulfilled => {},
                    else => {
                        var result = load_result.result(vm.global.vm());

                        handler.handleRuntimeJSError(
                            result,
                            .eval_entry_point,
                            "<r>JavaScript VM failed to start.\nwhile loading <r><b>\"{s}\"",
                            .{entry_point},
                        ) catch {};
                        return;
                    },
                }

                if (vm.event_listeners.count() == 0) {
                    handler.handleJSErrorFmt(
                        .eval_entry_point,
                        error.MissingFetchHandler,
                        "<r><red>error<r>: Framework didn't run <b><cyan>addEventListener(\"fetch\", callback)<r>, which means it can't accept HTTP requests.\nShutting down JS.",
                        .{},
                    ) catch {};
                    return;
                }
            }

            js_ast.Stmt.Data.Store.reset();
            js_ast.Expr.Data.Store.reset();
            JavaScript.Bun.flushCSSImports();
            const resolved_count = vm.resolved_count;
            const transpiled_count = vm.transpiled_count;
            vm.flush();

            Output.printElapsed(@intToFloat(f64, (start_timer.read())) / std.time.ns_per_ms);

            if (vm.bundler.options.framework.?.display_name.len > 0) {
                Output.prettyError(
                    " {s} ready<d>! (powered by Bun)\n<r>",
                    .{
                        vm.bundler.options.framework.?.display_name,
                    },
                );
            } else {
                Output.prettyError(
                    " Bun.js started\n<r>",
                    .{},
                );
            }

            Output.flush();

            try runLoop(
                vm,
                handler,
            );
        }

        var __arena: std.heap.ArenaAllocator = undefined;
        pub fn runLoop(vm: *JavaScript.VirtualMachine, thread: *HandlerThread) !void {
            var module_map = ZigGlobalObject.getModuleRegistryMap(vm.global);
            if (!VM.isJITEnabled()) {
                Output.prettyErrorln("<red><r>warn:<r> JIT is disabled,,,this is a bug in Bun and/or a permissions problem. JS will run slower.", .{});
                if (vm.bundler.env.map.get("BUN_CRASH_WITHOUT_JIT") != null) {
                    Global.crash();
                }
            }

            while (true) {
                __arena = std.heap.ArenaAllocator.init(vm.allocator);
                JavaScript.VirtualMachine.vm.arena = &__arena;
                JavaScript.VirtualMachine.vm.has_loaded = true;
                defer {
                    JavaScript.VirtualMachine.vm.flush();
                    std.debug.assert(
                        ZigGlobalObject.resetModuleRegistryMap(vm.global, module_map),
                    );
                    js_ast.Stmt.Data.Store.reset();
                    js_ast.Expr.Data.Store.reset();
                    JavaScript.Bun.flushCSSImports();
                    Output.flush();
                    JavaScript.VirtualMachine.vm.arena.deinit();
                    JavaScript.VirtualMachine.vm.has_loaded = false;
                    mimalloc.mi_collect(false);
                }

                var handler: *JavaScriptHandler = try channel.readItem();

                JavaScript.VirtualMachine.vm.preflush();

                JavaScript.EventListenerMixin.emitFetchEvent(
                    vm,
                    &handler.ctx,
                    HandlerThread,
                    thread,
                    HandlerThread.handleFetchEventError,
                ) catch |err| {};
            }
        }

        var one: [1]*JavaScriptHandler = undefined;
        pub fn enqueue(ctx: *RequestContext, server: *Server, params: *Router.Param.List) !void {
            if (JavaScriptHandler.javascript_disabled) {
                try ctx.renderFallback(
                    ctx.allocator,
                    ctx.bundler,
                    Api.FallbackStep.ssr_disabled,
                    &ctx.log,
                    error.JSDisabled,
                    &.{},
                    "",
                    .{},
                );
                return;
            }
            var clone = try ctx.allocator.create(JavaScriptHandler);
            clone.* = JavaScriptHandler{
                .ctx = ctx.*,
                .conn = ctx.conn.*,
                .params = if (params.len > 0)
                    try params.clone(ctx.allocator)
                else
                    Router.Param.List{},
            };

            clone.ctx.conn = &clone.conn;

            clone.ctx.matched_route.?.params = &clone.params;

            if (!has_loaded_channel) {
                var handler_thread = try server.allocator.create(HandlerThread);

                has_loaded_channel = true;
                channel = Channel.init();
                var transform_options = server.transform_options;
                if (server.transform_options.node_modules_bundle_path_server) |bundle_path| {
                    transform_options.node_modules_bundle_path = bundle_path;
                    transform_options.node_modules_bundle_path_server = null;
                    handler_thread.* = HandlerThread{
                        .args = transform_options,
                        .framework = server.bundler.options.framework.?,
                        .existing_bundle = null,
                        .log = undefined,
                        .watcher = server.watcher,
                        .env_loader = server.bundler.env,
                        .origin = server.bundler.options.origin,
                        .client_bundler = undefined,
                    };
                } else {
                    handler_thread.* = HandlerThread{
                        .args = server.transform_options,
                        .framework = server.bundler.options.framework.?,
                        .existing_bundle = server.bundler.options.node_modules_bundle,
                        .watcher = server.watcher,
                        .env_loader = server.bundler.env,
                        .log = undefined,
                        .origin = server.bundler.options.origin,
                        .client_bundler = undefined,
                    };
                }
                try server.bundler.clone(server.allocator, &handler_thread.client_bundler);
                handler_thread.log = try server.allocator.create(logger.Log);
                handler_thread.log.* = logger.Log.init(server.allocator);

                try server.bundler.clone(server.allocator, &handler_thread.client_bundler);

                try JavaScriptHandler.spawnThread(handler_thread);
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
        bundler: Bundler,
        pub var open_websockets: std.ArrayList(*WebsocketHandler) = undefined;
        var open_websockets_lock = sync.RwLock.init();
        pub fn addWebsocket(ctx: *RequestContext, server: *Server) !*WebsocketHandler {
            open_websockets_lock.lock();
            defer open_websockets_lock.unlock();

            var clone = try server.allocator.create(WebsocketHandler);
            clone.ctx = ctx.*;
            clone.conn = ctx.conn.*;
            try ctx.bundler.clone(server.allocator, &clone.bundler);
            ctx.bundler = &clone.bundler;

            clone.message_buffer = try MutableString.init(server.allocator, 0);
            clone.ctx.conn = &clone.conn;
            clone.ctx.log = logger.Log.init(server.allocator);
            var printer_writer = try js_printer.BufferWriter.init(server.allocator);

            clone.builder = WatchBuilder{
                .allocator = server.allocator,
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
            self.builder.printer = js_printer.BufferPrinter.init(
                js_printer.BufferWriter.init(self.ctx.allocator) catch unreachable,
            );
            _handle(self) catch {};
        }

        fn _handle(handler: *WebsocketHandler) !void {
            var ctx = &handler.ctx;
            defer handler.tombstone = true;
            defer removeWebsocket(handler);
            defer ctx.arena.deinit();
            var is_socket_closed = false;
            defer {
                if (!is_socket_closed) {
                    ctx.conn.deinit();
                }
            }
            defer Output.flush();

            handler.checkUpgradeHeaders() catch |err| {
                switch (err) {
                    error.BadRequest => {
                        defer is_socket_closed = true;

                        try ctx.sendBadRequest();
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
                    is_socket_closed = true;
                    return;
                },
            }

            const key = try handler.getWebsocketAcceptKey();

            ctx.appendHeader("Connection", "Upgrade");
            ctx.appendHeader("Upgrade", "websocket");
            ctx.appendHeader("Sec-WebSocket-Accept", key);
            ctx.appendHeader("Sec-WebSocket-Protocol", "bun-hmr");
            try ctx.writeStatus(101);
            try ctx.flushHeaders();
            // Output.prettyln("<r><green>101<r><d> Hot Module Reloading connected.<r>", .{});
            // Output.flush();
            Analytics.Features.hot_module_reloading = true;

            var cmd: Api.WebsocketCommand = undefined;
            var msg: Api.WebsocketMessage = .{
                .timestamp = handler.generateTimestamp(),
                .kind = .welcome,
            };
            var cmd_reader: ApiReader = undefined;
            {
                var byte_buf: [32 + std.fs.MAX_PATH_BYTES]u8 = undefined;
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
                    .cwd = handler.ctx.bundler.fs.top_level_dir,
                };
                try welcome_message.encode(&writer);
                if ((try handler.websocket.writeBinary(fbs.getWritten())) == 0) {
                    handler.tombstone = true;
                    is_socket_closed = true;
                    Output.prettyErrorln("<r><red>ERR:<r> <b>Websocket failed to write.<r>", .{});
                }
            }

            while (!handler.tombstone) {
                defer Output.flush();
                handler.conn.client.getError() catch |err| {
                    Output.prettyErrorln("<r><red>Websocket ERR:<r> <b>{s}<r>", .{err});
                    handler.tombstone = true;
                    is_socket_closed = true;
                };

                var frame = handler.websocket.read() catch |err| {
                    switch (err) {
                        error.ConnectionClosed => {
                            // Output.prettyln("Websocket closed.", .{});
                            handler.tombstone = true;
                            is_socket_closed = true;
                            continue;
                        },
                        else => {
                            Output.prettyErrorln("<r><red>Websocket ERR:<r> <b>{s}<r>", .{err});
                        },
                    }
                    return;
                };
                switch (frame.header.opcode) {
                    .Close => {
                        // Output.prettyln("Websocket closed.", .{});
                        is_socket_closed = true;
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

                                var arena = std.heap.ArenaAllocator.init(default_allocator);
                                defer arena.deinit();

                                var build_result = try handler.builder.build(request.id, cmd.timestamp, &arena.allocator);
                                const file_path = switch (build_result.value) {
                                    .fail => |fail| fail.module_path,
                                    .success => |fail| fail.module_path,
                                };

                                switch (build_result.value) {
                                    .fail => {
                                        Output.prettyErrorln(
                                            "Error: <b>{s}<r><b>",
                                            .{
                                                file_path,
                                            },
                                        );
                                    },
                                    .success => {
                                        if (build_result.timestamp > cmd.timestamp) {
                                            Output.prettyln(
                                                "<r><b><green>{d}ms<r> <d>built<r> <b>{s}<r><b> <r><d>({d}+ LOC)",
                                                .{
                                                    build_result.timestamp - cmd.timestamp,
                                                    file_path,
                                                    build_result.approximate_newline_count,
                                                },
                                            );
                                        }
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
                                Output.prettyErrorln(
                                    "<r>[Websocket]: Unknown cmd: <b>{d}<r>. This might be a version mismatch. Try updating your node_modules.bun",
                                    .{@enumToInt(cmd.kind)},
                                );
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
            var it = std.mem.split(u8, connection_header.value, ",");
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

    pub fn handleWebsocket(ctx: *RequestContext, server: *Server) anyerror!void {
        ctx.controlled = true;
        var handler = try WebsocketHandler.addWebsocket(ctx, server);
        _ = try std.Thread.spawn(.{}, WebsocketHandler.handle, .{handler});
    }

    threadlocal var client_entry_point: bundler.ClientEntryPoint = undefined;
    threadlocal var fallback_entry_point: bundler.FallbackEntryPoint = undefined;
    threadlocal var fallback_entry_point_created: bool = false;

    pub fn renderServeResult(ctx: *RequestContext, result: bundler.ServeResult) !void {
        if (ctx.keep_alive) {
            ctx.appendHeader("Connection", "keep-alive");
        }

        if (result.file.value == .noop) {
            return try ctx.sendNotFound();
        }

        ctx.mime_type = result.mime_type;
        ctx.appendHeader("Content-Type", result.mime_type.value);

        const send_body = ctx.method == .GET;

        switch (result.file.value) {
            .pending => |resolve_result| {
                const path = resolve_result.pathConst() orelse {
                    try ctx.sendNoContent();
                    return;
                };

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

                    pub fn reserveNext(rctx: *SocketPrinterInternal, count: u32) anyerror![*]u8 {
                        try buffer.growIfNeeded(count);
                        return return @ptrCast([*]u8, &buffer.list.items.ptr[buffer.list.items.len]);
                    }

                    pub fn advanceBy(rctx: *SocketPrinterInternal, count: u32) void {
                        if (comptime Environment.isDebug) std.debug.assert(buffer.list.items.len + count < buffer.list.capacity);

                        buffer.list.items = buffer.list.items.ptr[0 .. buffer.list.items.len + count];
                    }

                    pub fn init(rctx: *RequestContext, _loader: Options.Loader) SocketPrinterInternal {
                        if (!has_loaded_buffer) {
                            buffer = MutableString.init(default_allocator, 0) catch unreachable;
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

                        defer chunky.rctx.done();
                        try chunky.rctx.writeStatus(200);
                        try chunky.rctx.prepareToSendBody(buf.len, false);
                        try chunky.rctx.writeBodyBuf(buf);
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
                    SocketPrinterInternal.reserveNext,
                    SocketPrinterInternal.advanceBy,
                );
                const loader = ctx.bundler.options.loaders.get(result.file.input.name.ext) orelse .file;

                var chunked_encoder = SocketPrinter.init(
                    SocketPrinterInternal.init(ctx, loader),
                );

                // It will call flush for us automatically
                ctx.bundler.resetStore();

                var client_entry_point_: ?*bundler.ClientEntryPoint = null;
                if (resolve_result.import_kind == .entry_point and loader.supportsClientEntryPoint()) {
                    if (ctx.bundler.options.framework) |*framework| {
                        if (framework.client.isEnabled()) {
                            client_entry_point = bundler.ClientEntryPoint{};

                            try client_entry_point.generate(Bundler, ctx.bundler, path.name, framework.client.path);
                            client_entry_point_ = &client_entry_point;
                        }
                    }
                }

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
                    client_entry_point_,
                ) catch |err| {
                    ctx.sendInternalError(err) catch {};
                    return;
                };

                // CSS handles this specially
                if (loader != .css and client_entry_point_ == null) {
                    if (written.input_fd) |written_fd| {
                        try ctx.watcher.addFile(
                            written_fd,
                            result.file.input.text,
                            hash,
                            loader,
                            resolve_result.dirname_fd,
                            resolve_result.package_json,
                            true,
                        );

                        if (ctx.watcher.watchloop_handle == null) {
                            ctx.watcher.start() catch {};
                        }
                    }
                } else {
                    if (written.written > 0) {
                        if (ctx.watcher.watchloop_handle == null) {
                            try ctx.watcher.start();
                        }
                    }
                }

                if (written.empty) {
                    switch (loader) {
                        .css => try ctx.sendNoContent(),
                        .js, .jsx, .ts, .tsx, .json => {
                            const buf = "export default {};";
                            const strong_etag = comptime std.hash.Wyhash.hash(1, buf);
                            const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});
                            ctx.appendHeader("ETag", etag_content_slice);

                            if (ctx.header("If-None-Match")) |etag_header| {
                                if (std.mem.eql(u8, etag_content_slice, etag_header.value)) {
                                    try ctx.sendNotModified();
                                    return;
                                }
                            }
                            defer ctx.done();
                            try ctx.writeStatus(200);
                            try ctx.prepareToSendBody(buf.len, false);
                            try ctx.writeBodyBuf(buf);
                        },
                        else => unreachable,
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
                            file.dir,
                            null,
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

    fn handleBlobURL(ctx: *RequestContext, server: *Server) !void {
        var id = ctx.url.path["blob:".len..];
        // This makes it Just Work if you pass a line/column number
        if (strings.indexOfChar(id, ':')) |colon| {
            id = id[0..colon];
        }

        const blob = (JavaScriptHandler.javascript_vm orelse return try ctx.sendNotFound()).blobs.get(id) orelse return try ctx.sendNotFound();
        if (blob.len == 0) {
            try ctx.sendNoContent();
            return;
        }

        defer ctx.done();
        try ctx.writeStatus(200);
        ctx.appendHeader("Content-Type", MimeType.text.value);
        try ctx.prepareToSendBody(blob.len, false);
        try ctx.writeBodyBuf(blob.ptr[0..blob.len]);
    }

    fn handleBunURL(ctx: *RequestContext, server: *Server) !void {
        const path = ctx.url.path["bun:".len..];

        if (strings.eqlComptime(path, "_api.hmr")) {
            try ctx.handleWebsocket(server);
            return;
        }

        if (strings.eqlComptime(path, "error.js")) {
            const buffer = ErrorJS.sourceContent();
            ctx.appendHeader("Content-Type", MimeType.javascript.value);
            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method == .GET;
            defer ctx.done();
            try ctx.writeStatus(200);
            try ctx.prepareToSendBody(buffer.len, false);
            if (!send_body) return;
            _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
            return;
        }

        if (strings.eqlComptime(path, "erro.css")) {
            const buffer = ErrorCSS.sourceContent();
            ctx.appendHeader("Content-Type", MimeType.css.value);
            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method == .GET;
            defer ctx.done();
            try ctx.writeStatus(200);
            try ctx.prepareToSendBody(buffer.len, false);
            if (!send_body) return;
            _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
            return;
        }

        if (strings.eqlComptime(path, "fallback")) {
            const resolved = try ctx.bundler.resolver.resolve(ctx.bundler.fs.top_level_dir, ctx.bundler.options.framework.?.fallback.path, .stmt);
            const resolved_path = resolved.pathConst() orelse return try ctx.sendNotFound();
            const mime_type_ext = ctx.bundler.options.out_extensions.get(resolved_path.name.ext) orelse resolved_path.name.ext;
            const loader = ctx.bundler.options.loader(resolved_path.name.ext);
            try ctx.renderServeResult(bundler.ServeResult{
                .file = Options.OutputFile.initPending(loader, resolved),
                .mime_type = MimeType.byLoader(
                    loader,
                    mime_type_ext[1..],
                ),
            });
            return;
        }

        try ctx.sendNotFound();
        return;
    }

    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-Fetch-Dest
    pub fn isScriptOrStyleRequest(ctx: *RequestContext) bool {
        const header_ = ctx.header("Sec-Fetch-Dest") orelse return false;
        return strings.eqlComptime(header_.value, "script") or
            strings.eqlComptime(header_.value, "style");
    }

    fn handleSrcURL(ctx: *RequestContext, server: *Server) !void {
        var input_path = ctx.url.path["src:".len..];
        while (std.mem.indexOfScalar(u8, input_path, ':')) |i| {
            input_path = input_path[0..i];
        }
        if (input_path.len == 0) return ctx.sendNotFound();

        const pathname = Fs.PathName.init(input_path);
        const result = try ctx.buildFile(input_path, pathname.ext);

        switch (result.file.value) {
            .pending => |resolve_result| {
                const path = resolve_result.pathConst() orelse return try ctx.sendNotFound();

                var needs_close = false;
                const fd = if (resolve_result.file_fd != 0)
                    resolve_result.file_fd
                else brk: {
                    var file = std.fs.openFileAbsoluteZ(path.textZ(), .{ .read = true }) catch |err| {
                        Output.prettyErrorln("Failed to open {s} due to error {s}", .{ path.text, @errorName(err) });
                        return try ctx.sendInternalError(err);
                    };
                    needs_close = true;
                    break :brk file.handle;
                };
                defer {
                    if (needs_close) {
                        std.os.close(fd);
                    }
                }

                const content_length = brk: {
                    var file = std.fs.File{ .handle = fd };
                    var stat = file.stat() catch |err| {
                        Output.prettyErrorln("Failed to read {s} due to error {s}", .{ path.text, @errorName(err) });
                        return try ctx.sendInternalError(err);
                    };
                    break :brk stat.size;
                };

                if (content_length == 0) {
                    return try ctx.sendNoContent();
                }

                ctx.appendHeader("Content-Type", "text/plain");
                defer ctx.done();

                try ctx.writeStatus(200);
                try ctx.prepareToSendBody(content_length, false);

                _ = try std.os.sendfile(
                    ctx.conn.client.socket.fd,
                    fd,
                    0,
                    content_length,
                    &[_]std.os.iovec_const{},
                    &[_]std.os.iovec_const{},
                    0,
                );
            },
            else => return try ctx.sendNotFound(),
        }
    }

    fn handleAbsURL(ctx: *RequestContext, server: *Server) !void {
        const extname = ctx.url.extname;
        switch (extname.len) {
            3 => {
                if (!(strings.eqlComptimeIgnoreLen(extname, "css") or strings.eqlComptimeIgnoreLen(extname, "tsx") or strings.eqlComptimeIgnoreLen(extname, "jsx") or strings.eqlComptime(extname, "mjs"))) return try ctx.sendNotFound();
            },
            2 => {
                if (!(strings.eqlComptimeIgnoreLen(extname, "js") or strings.eqlComptimeIgnoreLen(extname, "ts"))) return try ctx.sendNotFound();
            },
            4 => {
                if (!(strings.eqlComptimeIgnoreLen(extname, "json") or strings.eqlComptimeIgnoreLen(extname, "yaml"))) return try ctx.sendNotFound();
            },
            else => {
                return try ctx.sendNotFound();
            },
        }

        switch (ctx.method) {
            .GET, .HEAD => {
                const result = try ctx.buildFile(
                    ctx.url.path["abs:".len..],
                    ctx.url.extname,
                );
                try @call(.{ .modifier = .always_inline }, RequestContext.renderServeResult, .{ ctx, result });
            },
            else => {
                try ctx.sendNotFound();
            },
        }
    }

    pub fn handleReservedRoutes(ctx: *RequestContext, server: *Server) !bool {
        if (strings.eqlComptime(ctx.url.extname, "bun") and ctx.bundler.options.node_modules_bundle != null) {
            try ctx.sendJSB();
            return true;
        }

        if (ctx.url.path.len > "blob:".len and strings.eqlComptimeIgnoreLen(ctx.url.path[0.."blob:".len], "blob:")) {
            try ctx.handleBlobURL(server);
            return true;
        }

        const isMaybePrefix = ctx.url.path.len > "bun:".len;

        if (isMaybePrefix and strings.eqlComptimeIgnoreLen(ctx.url.path[0.."bun:".len], "bun:")) {
            try ctx.handleBunURL(server);
            return true;
        } else if (isMaybePrefix and strings.eqlComptimeIgnoreLen(ctx.url.path[0.."src:".len], "src:")) {
            try ctx.handleSrcURL(server);
            return true;
        } else if (isMaybePrefix and strings.eqlComptimeIgnoreLen(ctx.url.path[0.."abs:".len], "abs:")) {
            try ctx.handleAbsURL(server);
            return true;
        }

        return false;
    }

    pub inline fn buildFile(ctx: *RequestContext, path_name: string, extname: string) !bundler.ServeResult {
        if (ctx.bundler.options.isFrontendFrameworkEnabled()) {
            if (serve_as_package_path) {
                return try ctx.bundler.buildFile(
                    &ctx.log,
                    ctx.allocator,
                    path_name,
                    extname,
                    true,
                    true,
                );
            } else {
                return try ctx.bundler.buildFile(
                    &ctx.log,
                    ctx.allocator,
                    path_name,
                    extname,
                    true,
                    false,
                );
            }
        } else {
            if (serve_as_package_path) {
                return try ctx.bundler.buildFile(
                    &ctx.log,
                    ctx.allocator,
                    path_name,
                    extname,
                    false,
                    true,
                );
            } else {
                return try ctx.bundler.buildFile(
                    &ctx.log,
                    ctx.allocator,
                    path_name,
                    extname,
                    false,
                    false,
                );
            }
        }
    }
    pub fn handleGet(ctx: *RequestContext) !void {
        const result = try ctx.buildFile(
            ctx.url.pathWithoutAssetPrefix(ctx.bundler.options.routes.asset_prefix_path),
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
var serve_as_package_path = false;

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
    bundler: *Bundler,
    watcher: *Watcher,
    timer: std.time.Timer = undefined,
    transform_options: Api.TransformOptions,
    javascript_enabled: bool = false,
    fallback_only: bool = false,

    pub fn onTCPConnection(server: *Server, conn: tcp.Connection, comptime features: ConnectionFeatures) void {
        conn.client.setNoDelay(true) catch {};
        conn.client.setQuickACK(true) catch {};
        conn.client.setLinger(1) catch {};

        server.handleConnection(&conn, comptime features);
    }

    threadlocal var filechange_buf: [32]u8 = undefined;

    pub fn onFileUpdate(
        ctx: *Server,
        events: []watcher.WatchEvent,
        watchlist: watcher.Watchlist,
    ) void {
        if (ctx.javascript_enabled) {
            if (Output.isEmojiEnabled()) {
                _onFileUpdate(ctx, events, watchlist, true, true);
            } else {
                _onFileUpdate(ctx, events, watchlist, true, false);
            }
        } else {
            if (Output.isEmojiEnabled()) {
                _onFileUpdate(ctx, events, watchlist, false, true);
            } else {
                _onFileUpdate(ctx, events, watchlist, false, false);
            }
        }
    }

    fn _onFileUpdate(
        ctx: *Server,
        events: []watcher.WatchEvent,
        watchlist: watcher.Watchlist,
        comptime is_javascript_enabled: bool,
        comptime is_emoji_enabled: bool,
    ) void {
        var fbs = std.io.fixedBufferStream(&filechange_buf);
        var writer = ByteApiWriter.init(&fbs);
        const message_type = Api.WebsocketMessage{
            .timestamp = RequestContext.WebsocketHandler.toTimestamp(ctx.timer.read()),
            .kind = .file_change_notification,
        };
        message_type.encode(&writer) catch unreachable;
        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);
        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        const hashes = slice.items(.hash);
        const parent_hashes = slice.items(.parent_hash);
        var header = fbs.getWritten();
        defer ctx.watcher.flushEvictions();
        defer Output.flush();

        var rfs: *Fs.FileSystem.RealFS = &ctx.bundler.fs.fs;

        // It's important that this function does not do any memory allocations
        // If this blocks, it can cause cascading bad things to happen
        for (events) |event| {
            const file_path = file_paths[event.index];
            const update_count = counts[event.index] + 1;
            counts[event.index] = update_count;
            const kind = kinds[event.index];

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

            switch (kind) {
                .file => {
                    if (event.op.delete or event.op.rename) {
                        ctx.watcher.removeAtIndex(
                            event.index,
                            0,
                            &.{},
                            .file,
                        );

                        if (comptime FeatureFlags.verbose_watcher) {
                            Output.prettyln("<r><d>File changed: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        }
                    } else {
                        const change_message = Api.WebsocketMessageFileChangeNotification{
                            .id = id,
                            .loader = (ctx.bundler.options.loaders.get(path.ext) orelse .file).toAPI(),
                        };

                        var content_writer = ByteApiWriter.init(&content_fbs);
                        change_message.encode(&content_writer) catch unreachable;
                        const change_buf = content_fbs.getWritten();
                        const written_buf = filechange_buf[0 .. header.len + change_buf.len];
                        RequestContext.WebsocketHandler.broadcast(written_buf) catch |err| {
                            Output.prettyln("Error writing change notification: {s}<r>", .{@errorName(err)});
                        };
                        if (comptime is_emoji_enabled) {
                            Output.prettyln("<r>📜  <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        } else {
                            Output.prettyln("<r>   <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        }
                    }
                },
                .directory => {
                    rfs.bustEntriesCache(file_path);
                    ctx.bundler.resolver.dir_cache.remove(file_path);

                    // if (event.op.delete or event.op.rename)
                    //     ctx.watcher.removeAtIndex(event.index, hashes[event.index], parent_hashes, .directory);

                    if (comptime is_emoji_enabled) {
                        Output.prettyln("<r>📁  <d>Dir change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                    } else {
                        Output.prettyln("<r>    <d>Dir change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                    }
                },
            }
        }
    }

    fn run(server: *Server, comptime features: ConnectionFeatures) !void {
        _ = Fs.FileSystem.RealFS.adjustUlimit() catch {};
        RequestContext.WebsocketHandler.open_websockets = @TypeOf(
            RequestContext.WebsocketHandler.open_websockets,
        ).init(server.allocator);
        const listener = try tcp.Listener.init(.ip, .{ .close_on_exec = true });
        defer listener.deinit();

        listener.setReuseAddress(true) catch {};
        listener.setReusePort(false) catch {};
        listener.setFastOpen(true) catch {};
        // listener.setNoDelay(true) catch {};
        // listener.setQuickACK(true) catch {};

        // try listener.ack(true);

        var port: u16 = 3000;

        if (server.transform_options.port) |_port| {
            port = _port;
        } else if (server.bundler.options.origin.getPort()) |_port| {
            port = _port;
        }

        {
            var attempts: u8 = 0;

            restart: while (attempts < 10) : (attempts += 1) {
                listener.bind(ip.Address.initIPv4(
                    IPv4.unspecified,
                    port,
                )) catch |err| {
                    switch (err) {
                        error.AddressInUse => {
                            port += 1;
                            continue :restart;
                        },
                        else => {
                            Output.prettyErrorln("<r><red>{s} while trying to start listening on port {d}.\n\n", .{ @errorName(err), port });
                            Output.flush();
                            std.os.exit(1);
                        },
                    }
                };
                break :restart;
            }

            if (attempts >= 10) {
                var random_number = std.rand.DefaultPrng.init(@intCast(u64, std.time.milliTimestamp()));
                const default_port = @intCast(u16, server.bundler.options.origin.getPort() orelse 3000);
                Output.prettyErrorln(
                    "<r><red>error<r>: Bun can't start because <b>port {d} is already in use<r>. Tried {d} - {d}. Try closing the other apps or manually passing Bun a port\n\n  <r><cyan><b>bun --origin http://localhost:{d}/<r>\n",
                    .{
                        default_port,
                        default_port,
                        port,
                        random_number.random.intRangeAtMost(u16, 3011, 65535),
                    },
                );
                Output.flush();
                std.os.exit(1);
            }
        }

        try listener.listen(1280);
        const addr = try listener.getLocalAddress();
        if (server.bundler.options.origin.getPort()) |_port| {
            if (_port != addr.ipv4.port) {
                server.bundler.options.origin.port = try std.fmt.allocPrint(server.allocator, "{d}", .{addr.ipv4.port});
            }
        }
        const start_time = @import("root").start_time;
        const now = std.time.nanoTimestamp();
        Output.printStartEnd(start_time, now);
        // This is technically imprecise.
        // However, we want to optimize for easy to copy paste
        // Nobody should get weird CORS errors when you go to the printed url.
        if (std.mem.readIntNative(u32, &addr.ipv4.host.octets) == 0 or std.mem.readIntNative(u128, &addr.ipv6.host.octets) == 0) {
            if (server.bundler.options.routes.single_page_app_routing) {
                Output.prettyError(
                    " Bun!! <d>v{s}<r>\n\n\n  Link:<r> <b><cyan>http://localhost:{d}<r>\n        <d>./{s}/index.html<r> \n\n\n",
                    .{
                        Global.package_json_version,
                        addr.ipv4.port,
                        resolve_path.relative(server.bundler.fs.top_level_dir, server.bundler.options.routes.static_dir),
                    },
                );
            } else {
                Output.prettyError(" Bun!! <d>v{s}<r>\n\n\n<d>  Link:<r> <b><cyan>http://localhost:{d}<r>\n\n\n", .{
                    Global.package_json_version,
                    addr.ipv4.port,
                });
            }
        } else {
            if (server.bundler.options.routes.single_page_app_routing) {
                Output.prettyError(" Bun!! <d>v{s}<r>\n\n\n<d>  Link:<r> <b><cyan>http://{s}<r>\n       <d>./{s}/index.html<r> \n\n\n", .{
                    Global.package_json_version,
                    addr,
                    resolve_path.relative(server.bundler.fs.top_level_dir, server.bundler.options.routes.static_dir),
                });
            } else {
                Output.prettyError(" Bun!! <d>v{s}\n\n\n<d>  Link:<r> <b><cyan>http://{s}<r>\n\n\n", .{
                    Global.package_json_version,
                    addr,
                });
            }
        }

        Output.flush();

        Analytics.Features.bun_bun = server.bundler.options.node_modules_bundle != null;
        Analytics.Features.framework = server.bundler.options.framework != null;
        Analytics.Features.filesystem_router = server.bundler.router != null;
        Analytics.Features.bunjs = server.transform_options.node_modules_bundle_path_server != null;

        const UpgradeCheckerThread = @import("./cli/upgrade_command.zig").UpgradeCheckerThread;

        UpgradeCheckerThread.spawn(server.bundler.env);

        var did_init = false;
        while (!did_init) {
            defer Output.flush();
            var conn = listener.accept(.{ .close_on_exec = true }) catch |err| {
                continue;
            };

            // We want to bind to the network socket as quickly as possible so that opening the URL works
            // We use a secondary loop so that we avoid the extra branch in a hot code path
            server.detectFastRefresh();
            Analytics.Features.fast_refresh = server.bundler.options.jsx.supports_fast_refresh;
            server.detectTSConfig();
            try server.initWatcher();
            did_init = true;
            Analytics.enqueue(Analytics.EventName.http_start);

            server.handleConnection(&conn, comptime features);
        }

        while (true) {
            defer Output.flush();
            var conn = listener.accept(.{ .close_on_exec = true }) catch |err| {
                continue;
            };

            server.handleConnection(&conn, comptime features);
        }
    }

    threadlocal var req_buf: [32_000]u8 = undefined;

    pub const ConnectionFeatures = struct {
        public_folder: PublicFolderPriority = PublicFolderPriority.none,
        filesystem_router: bool = false,
        pub const PublicFolderPriority = enum {
            none,
            first,
            last,
        };
    };

    threadlocal var req_ctx_: RequestContext = undefined;
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

        var request_arena = server.allocator.create(std.heap.ArenaAllocator) catch unreachable;
        request_arena.* = std.heap.ArenaAllocator.init(server.allocator);

        req_ctx_ = RequestContext.init(
            req,
            request_arena,
            conn,
            server.bundler,
            server.watcher,
            server.timer,
        ) catch |err| {
            Output.prettyErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
            conn.client.deinit();
            return;
        };
        var req_ctx = &req_ctx_;
        req_ctx.timer.reset();

        const is_navigation_request = req_ctx_.isBrowserNavigation();
        defer if (is_navigation_request) Analytics.enqueue(Analytics.EventName.http_build);

        if (req_ctx.url.needs_redirect) {
            req_ctx.handleRedirect(req_ctx.url.path) catch |err| {
                Output.prettyErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
                conn.client.deinit();
                return;
            };
            return;
        }

        defer {
            if (!req_ctx.controlled) {
                req_ctx.arena.deinit();
            }
        }

        req_ctx.log = logger.Log.init(server.allocator);
        var log = &req_ctx.log;

        req_ctx.bundler.setLog(log);
        // req_ctx.bundler.setAllocator(req_ctx.allocator);

        var did_print: bool = false;

        defer {
            if (!req_ctx.controlled) {
                if (!req_ctx.has_called_done) {
                    if (comptime isDebug) {
                        if (@errorReturnTrace()) |trace| {
                            std.debug.dumpStackTrace(trace.*);
                            Output.printError("\n", .{});
                        }
                    }

                    req_ctx.sendInternalError(error.InternalError) catch {};
                }
                const status = req_ctx.status orelse @intCast(HTTPStatusCode, 500);

                if (log.msgs.items.len == 0) {
                    if (!did_print) {
                        switch (status) {
                            // For success codes, just don't print anything.
                            // It's really noisy.
                            200, 304, 101 => {},

                            201...303, 305...399 => {
                                Output.prettyln("<r><green>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            400...499 => {
                                Output.prettyln("<r><yellow>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            else => {
                                Output.prettyln("<r><red>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                        }
                    }
                } else {
                    defer Output.flush();
                    defer log.deinit();
                    log.printForLogLevel(Output.errorWriter()) catch {};

                    if (!did_print) {
                        switch (status) {
                            // For success codes, just don't print anything.
                            // It's really noisy.
                            200, 304, 101 => {},

                            201...303, 305...399 => {
                                Output.prettyln("<r><green>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            400...499 => {
                                Output.prettyln("<r><yellow>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            else => {
                                Output.prettyln("<r><red>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                        }
                    }
                }
            }
        }

        if (comptime FeatureFlags.keep_alive) {
            if (req_ctx.header("Connection")) |connection| {
                req_ctx.keep_alive = strings.eqlInsensitive(connection.value, "keep-alive");
            }

            conn.client.setKeepAlive(req_ctx.keep_alive) catch {};
        } else {
            req_ctx.keep_alive = false;
        }

        var finished = req_ctx.handleReservedRoutes(server) catch |err| {
            Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
            did_print = true;
            return;
        };

        if (!finished) {
            switch (comptime features.public_folder) {
                .first => {
                    if (!finished) {
                        if (req_ctx.matchPublicFolder()) |result| {
                            finished = true;
                            req_ctx.renderServeResult(result) catch |err| {
                                Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                                did_print = true;
                                return;
                            };
                        }

                        finished = finished or req_ctx.has_called_done;
                    }
                },
                else => {},
            }
        }

        if (comptime features.filesystem_router) {
            if (!finished) {
                req_ctx.bundler.router.?.match(server, RequestContext, req_ctx) catch |err| {
                    switch (err) {
                        error.ModuleNotFound => {
                            req_ctx.sendNotFound() catch {};
                        },
                        else => {
                            Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                            did_print = true;
                        },
                    }
                };
                finished = true;
            }
        } else {
            request_handler: {
                if (!finished) {
                    req_ctx.handleRequest() catch |err| {
                        switch (err) {
                            error.ModuleNotFound => {
                                break :request_handler;
                            },
                            else => {
                                Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                                did_print = true;
                            },
                        }
                    };
                    finished = true;
                }
            }
        }

        if (comptime features.public_folder == .last) {
            if (!finished) {
                if (req_ctx.matchPublicFolder()) |result| {
                    finished = true;
                    req_ctx.renderServeResult(result) catch |err| {
                        Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                        did_print = true;
                    };
                }

                finished = finished or req_ctx.has_called_done;
            }
        }

        if (comptime features.public_folder != .none) {
            if (!finished and (req_ctx.bundler.options.routes.single_page_app_routing and req_ctx.url.extname.len == 0)) {
                req_ctx.sendSinglePageHTML() catch |err| {
                    Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                    did_print = true;
                };
                finished = true;
            }
        }

        if (!finished) {
            req_ctx.sendNotFound() catch {};
        }
    }

    pub fn initWatcher(server: *Server) !void {
        server.watcher = try Watcher.init(server, server.bundler.fs, server.allocator);

        if (comptime FeatureFlags.watch_directories) {
            server.bundler.resolver.onStartWatchingDirectoryCtx = server.watcher;
            server.bundler.resolver.onStartWatchingDirectory = onMaybeWatchDirectory;
        }
    }

    pub fn onMaybeWatchDirectory(watch: *Watcher, file_path: string, dir_fd: StoredFileDescriptorType) void {
        // We don't want to watch:
        // - Directories outside the root directory
        // - Directories inside node_modules
        if (std.mem.indexOf(u8, file_path, "node_modules") == null and std.mem.indexOf(u8, file_path, watch.fs.top_level_dir) != null) {
            watch.addDirectory(dir_fd, file_path, Watcher.getHash(file_path), false) catch {};
        }
    }

    pub fn detectFastRefresh(this: *Server) void {
        defer this.bundler.resetStore();

        // 1. Try react refresh
        _ = this.bundler.resolver.resolve(this.bundler.fs.top_level_dir, this.bundler.options.jsx.refresh_runtime, .internal) catch |err| {
            // 2. Try react refresh from import source perspective
            this.bundler.options.jsx.supports_fast_refresh = false;
            return;
        };
    }

    pub fn detectTSConfig(this: *Server) void {
        defer this.bundler.resetStore();

        const dir_info = (this.bundler.resolver.readDirInfo(this.bundler.fs.top_level_dir) catch return) orelse return;

        if (dir_info.package_json) |pkg| {
            Analytics.Features.macros = Analytics.Features.macros or pkg.macros.count() > 0;
            Analytics.Features.always_bundle = pkg.always_bundle.len > 0;
            Analytics.setProjectID(dir_info.abs_path, pkg.name);
        } else {
            Analytics.setProjectID(dir_info.abs_path, "");
        }

        const tsconfig = dir_info.tsconfig_json orelse return;
        Analytics.Features.tsconfig = true;

        serve_as_package_path = tsconfig.base_url_for_paths.len > 0 or tsconfig.base_url.len > 0;
        Analytics.Features.tsconfig_paths = tsconfig.paths.count() > 0;
    }

    pub var global_start_time: std.time.Timer = undefined;
    pub fn start(allocator: *std.mem.Allocator, options: Api.TransformOptions, comptime DebugType: type, debug: DebugType) !void {
        var log = logger.Log.init(allocator);
        var server = try allocator.create(Server);
        server.* = Server{
            .allocator = allocator,
            .log = log,
            .bundler = undefined,
            .watcher = undefined,
            .transform_options = options,
            .timer = try std.time.Timer.start(),
        };
        global_start_time = server.timer;
        server.bundler = try allocator.create(Bundler);
        server.bundler.* = try Bundler.init(allocator, &server.log, options, null, null);
        server.bundler.configureLinker();
        try server.bundler.configureRouter(true);

        if (debug.dump_environment_variables) {
            server.bundler.dumpEnvironmentVariables();
            return;
        }

        if (debug.fallback_only) {
            RequestContext.fallback_only = true;
            RequestContext.JavaScriptHandler.javascript_disabled = true;
        }

        Analytics.Features.filesystem_router = server.bundler.router != null;

        const public_folder_is_top_level = server.bundler.options.routes.static_dir_enabled and strings.eql(
            server.bundler.fs.top_level_dir,
            server.bundler.options.routes.static_dir,
        );

        if (server.bundler.router != null and server.bundler.options.routes.static_dir_enabled) {
            if (!public_folder_is_top_level) {
                try server.run(
                    ConnectionFeatures{ .public_folder = .first, .filesystem_router = true },
                );
            } else {
                try server.run(
                    ConnectionFeatures{ .public_folder = .last, .filesystem_router = true },
                );
            }
        } else if (server.bundler.router != null) {
            try server.run(
                ConnectionFeatures{ .filesystem_router = true },
            );
        } else if (server.bundler.options.routes.static_dir_enabled) {
            if (!public_folder_is_top_level) {
                try server.run(
                    ConnectionFeatures{
                        .public_folder = .first,
                    },
                );
            } else {
                try server.run(
                    ConnectionFeatures{
                        .public_folder = .last,
                    },
                );
            }
        } else {
            try server.run(
                ConnectionFeatures{ .filesystem_router = false },
            );
        }
    }
};
