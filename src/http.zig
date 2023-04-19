// const c = @import("./c.zig");
const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const stringZ = bun.stringZ;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const default_allocator = bun.default_allocator;
const C = bun.C;
const Api = @import("./api/schema.zig").Api;
const ApiReader = @import("./api/schema.zig").Reader;
const ApiWriter = @import("./api/schema.zig").Writer;
const ByteApiWriter = @import("./api/schema.zig").ByteWriter;
const NewApiWriter = @import("./api/schema.zig").Writer;
const js_ast = bun.JSAst;
const bundler = bun.bundler;
const logger = @import("root").bun.logger;
const Fs = @import("./fs.zig");
const Options = @import("./options.zig");
const Fallback = @import("./runtime.zig").Fallback;
const ErrorCSS = @import("./runtime.zig").ErrorCSS;
const ErrorJS = @import("./runtime.zig").ErrorJS;
const Runtime = @import("./runtime.zig").Runtime;
const Css = @import("css_scanner.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const resolve_path = @import("./resolver/resolve_path.zig");
const OutputFile = Options.OutputFile;
const DotEnv = @import("./env_loader.zig");
const mimalloc = @import("./allocators/mimalloc.zig");
const MacroMap = @import("./resolver/package_json.zig").MacroMap;
const Analytics = @import("./analytics/analytics_thread.zig");
const Arena = std.heap.ArenaAllocator;
const ThreadlocalArena = @import("./mimalloc_arena.zig").Arena;
const JSON = bun.JSON;
const DateTime = bun.DateTime;
const ThreadPool = @import("root").bun.ThreadPool;
const SourceMap = @import("./sourcemap/sourcemap.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;
const Lock = @import("./lock.zig").Lock;
const RequestDataPool = ObjectPool([32_000]u8, null, false, 1);
const ResolveWatcher = @import("./resolver/resolver.zig").ResolveWatcher;
pub fn constStrToU8(s: string) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const MutableStringAPIWriter = NewApiWriter(*MutableString);

const os = std.os;

const picohttp = @import("root").bun.picohttp;
const Header = picohttp.Header;
const Request = picohttp.Request;
const Response = picohttp.Response;
pub const Headers = picohttp.Headers;
pub const MimeType = @import("./http/mime_type.zig");
const Bundler = bundler.Bundler;
const Websocket = @import("./http/websocket.zig");
const JSPrinter = bun.js_printer;
const watcher = @import("./watcher.zig");
threadlocal var req_headers_buf: [100]picohttp.Header = undefined;
threadlocal var res_headers_buf: [100]picohttp.Header = undefined;
const sync = @import("./sync.zig");
const JavaScript = @import("root").bun.JSC;
const JavaScriptCore = JavaScriptCore.C;
const Syscall = JavaScript.Node.Syscall;
const Router = @import("./router.zig");
pub const Watcher = watcher.NewWatcher(*Server);
const ZigURL = @import("./url.zig").URL;

const HTTPStatusCode = u10;
const URLPath = @import("./http/url_path.zig");
const Method = @import("./http/method.zig").Method;

const SOCKET_FLAGS: u32 = if (Environment.isLinux)
    os.SOCK.CLOEXEC | os.MSG.NOSIGNAL
else
    os.SOCK.CLOEXEC;

fn iovec(buf: []const u8) os.iovec_const {
    return os.iovec_const{
        .iov_base = buf.ptr,
        .iov_len = buf.len,
    };
}

fn disableSIGPIPESoClosingTheTabDoesntCrash(conn: anytype) void {
    if (comptime !Environment.isMac) return;
    std.os.setsockopt(
        conn.handle,
        std.os.SOL.SOCKET,
        std.os.SO.NOSIGPIPE,
        &std.mem.toBytes(@as(c_int, 1)),
    ) catch {};
}
var http_editor_context: EditorContext = EditorContext{};

pub const RequestContext = struct {
    request: Request,
    method: Method,
    url: URLPath,
    conn: std.net.Stream,
    allocator: std.mem.Allocator,
    arena: ThreadlocalArena,
    req_body_node: *RequestDataPool.Node = undefined,
    log: logger.Log,
    bundler: *Bundler,
    keep_alive: bool = true,
    status: ?HTTPStatusCode = null,
    has_written_last_header: bool = false,
    has_called_done: bool = false,
    mime_type: MimeType = MimeType.other,
    to_plain_text: bool = false,
    controlled: bool = false,
    watcher: *Watcher,
    timer: std.time.Timer,
    matched_route: ?Router.Match = null,
    origin: ZigURL,
    datetime_buf: [512]u8 = undefined,

    full_url: [:0]const u8 = "",
    res_headers_count: usize = 0,

    /// --disable-bun.js propagates here
    pub var fallback_only = false;

    const default_favicon = @embedFile("favicon.png");
    const default_favicon_shasum = "68d5047bec9a8cd56e2e8999d74cad7ba448dce9";
    pub fn sendFavicon(ctx: *RequestContext) !void {
        ctx.appendHeader("Content-Type", MimeType.byExtension("png").value);
        ctx.appendHeader("ETag", default_favicon_shasum);
        ctx.appendHeader("Age", "0");
        ctx.appendHeader("Cache-Control", "public, max-age=3600");

        if (ctx.header("If-None-Match")) |etag_header| {
            if (strings.eqlLong(default_favicon_shasum, etag_header, true)) {
                try ctx.sendNotModified();
                return;
            }
        }

        defer ctx.done();

        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(default_favicon.len, false);
        try ctx.writeBodyBuf(default_favicon);
    }

    fn parseOrigin(this: *RequestContext) void {
        var protocol: ?string = null;
        var host: ?string = null;

        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Forwarded
        if (this.header("Forwarded")) |forwarded| {
            if (strings.indexOf(forwarded, "host=")) |host_start| {
                const host_i = host_start + "host=".len;
                const host_ = forwarded[host_i..][0 .. strings.indexOfChar(forwarded[host_i..], ';') orelse forwarded[host_i..].len];
                if (host_.len > 0) {
                    host = host_;
                }
            }

            if (strings.indexOf(forwarded, "proto=")) |protocol_start| {
                const protocol_i = protocol_start + "proto=".len;
                if (strings.eqlComptime(forwarded[protocol_i..][0 .. strings.indexOfChar(forwarded[protocol_i..], ';') orelse forwarded[protocol_i..].len], "https")) {
                    protocol = "https";
                } else {
                    protocol = "http";
                }
            }
        }

        if (protocol == null) {
            determine_protocol: {
                // Upgrade-Insecure-Requests doesn't work
                // Browsers send this header to clients that are not running HTTPS
                // We need to use protocol-relative URLs in import statements and in websocket handler, we need to send the absolute URL it received
                // That will be our fix
                // // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Upgrade-Insecure-Requests
                // if (this.header("Upgrade-Insecure-Requests") != null) {
                //     protocol = "https";
                //     break :determine_protocol;
                // }

                // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Proto
                if (this.header("X-Forwarded-Proto")) |proto| {
                    if (strings.eqlComptime(proto, "https")) {
                        protocol = "https";
                        break :determine_protocol;
                    }
                }

                // Microsoft IIS
                if (this.header("Front-End-Https")) |proto| {
                    if (strings.eqlComptime(proto, "on")) {
                        protocol = "https";
                        break :determine_protocol;
                    }
                }
            }
        }

        if (host == null) {
            determine_host: {
                if (this.header("X-Forwarded-Host")) |_host| {
                    host = _host;
                    break :determine_host;
                }
            }

            if (protocol == null) {
                if (this.header("Origin")) |origin| {
                    this.origin = ZigURL.parse(origin);
                    return;
                }
            }
        }

        if (host != null or protocol != null) {
            // Proxies like Caddy might only send X-Forwarded-Proto if the host matches
            const display_protocol = protocol orelse @as(string, "http");
            var display_host = host orelse
                (if (protocol != null) this.header("Host") else null) orelse
                @as(string, this.origin.host);

            var display_port = if (this.origin.port.len > 0) this.origin.port else @as(string, "3000");

            if (strings.indexOfChar(display_host, ':')) |colon| {
                display_port = display_host[colon + 1 .. display_host.len];
                display_host = display_host[0..colon];
            } else if (this.bundler.options.origin.port_was_automatically_set and protocol != null) {
                if (strings.eqlComptime(display_protocol, "https")) {
                    display_port = "443";
                } else {
                    display_port = "80";
                }
            }
            this.origin = ZigURL.parse(std.fmt.allocPrint(this.allocator, "{s}://{s}:{s}/", .{ display_protocol, display_host, display_port }) catch unreachable);
        }
    }

    pub fn getFullURL(this: *RequestContext) [:0]const u8 {
        if (this.full_url.len == 0) {
            if (this.origin.isAbsolute()) {
                this.full_url = std.fmt.allocPrintZ(this.allocator, "{s}{s}", .{ this.origin.origin, this.request.path }) catch unreachable;
            } else {
                this.full_url = this.allocator.dupeZ(u8, this.request.path) catch unreachable;
            }
        }

        return this.full_url;
    }

    pub fn getFullURLForSourceMap(this: *RequestContext) [:0]const u8 {
        if (this.full_url.len == 0) {
            if (this.origin.isAbsolute()) {
                this.full_url = std.fmt.allocPrintZ(this.allocator, "{s}{s}.map", .{ this.origin.origin, this.request.path }) catch unreachable;
            } else {
                this.full_url = std.fmt.allocPrintZ(this.allocator, "{s}.map", .{this.request.path}) catch unreachable;
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

    pub fn header(ctx: *RequestContext, comptime name: anytype) ?[]const u8 {
        return (ctx.headerEntry(name) orelse return null).value;
    }

    pub fn headerEntry(ctx: *RequestContext, comptime name: anytype) ?Header {
        for (ctx.request.headers) |head| {
            if (strings.eqlCaseInsensitiveASCII(head.name, name, true)) {
                return head;
            }
        }

        return null;
    }

    pub fn headerEntryFirst(ctx: *RequestContext, comptime name: []const string) ?Header {
        for (ctx.request.headers) |head| {
            inline for (name) |match| {
                if (strings.eqlCaseInsensitiveASCII(head.name, match, true)) {
                    return head;
                }
            }
        }

        return null;
    }

    pub fn renderFallback(
        this: *RequestContext,
        allocator: std.mem.Allocator,
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

            var tmp = bundler_.parse(
                bundler_parse_options,
                @as(?*bundler.FallbackEntryPoint, &fallback_entry_point),
            );
            if (tmp) |*result| {
                try bundler_.linker.linkAllowImportingFromBundle(
                    fallback_entry_point.source.path,
                    result,
                    this.origin,
                    .absolute_url,
                    false,
                    false,
                    false,
                );

                var buffer_writer = try JSPrinter.BufferWriter.init(default_allocator);
                var writer = JSPrinter.BufferPrinter.init(buffer_writer);
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

        this.appendHeader("Content-Type", MimeType.html.value);

        var link_stack_buf: [2048]u8 = undefined;

        var remaining: []u8 = link_stack_buf[0..];

        if (this.bundler.options.node_modules_bundle_url.len > 0) {
            add_preload: {
                const node_modules_preload_header_value = std.fmt.bufPrint(remaining, "<{s}>; rel=modulepreload", .{
                    this.bundler.options.node_modules_bundle_url,
                }) catch break :add_preload;

                this.appendHeader("Link", node_modules_preload_header_value);
                remaining = remaining[node_modules_preload_header_value.len..];
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

            module_preload: {
                if (strings.hasPrefix(match.file_path, Fs.FileSystem.instance.top_level_dir)) {
                    var stream = std.io.fixedBufferStream(remaining);
                    var writer = stream.writer();
                    writer.writeAll("<") catch break :module_preload;
                    writer.writeAll(std.mem.trimRight(u8, this.bundler.options.origin.href, "/")) catch break :module_preload;
                    writer.writeAll("/") catch break :module_preload;

                    if (this.bundler.options.routes.asset_prefix_path.len > 0) {
                        writer.writeAll(std.mem.trim(u8, this.bundler.options.routes.asset_prefix_path, "/")) catch break :module_preload;
                    }

                    // include that trailing slash
                    // this should never overflow because the directory will be "/" if it's a root
                    if (comptime Environment.isDebug) std.debug.assert(Fs.FileSystem.instance.top_level_dir.len > 0);

                    writer.writeAll(match.file_path[Fs.FileSystem.instance.top_level_dir.len - 1 ..]) catch break :module_preload;

                    writer.writeAll(">; rel=modulepreload") catch break :module_preload;

                    this.appendHeader(
                        "Link",
                        remaining[0..stream.pos],
                    );
                    remaining = remaining[stream.pos..];
                }
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
        defer allocator.free(fallback_container.message.?);

        defer this.done();

        if (RequestContext.fallback_only) {
            try this.writeStatus(200);
        } else {
            try this.writeStatus(500);
        }

        if (comptime fmt.len > 0) Output.prettyErrorln(fmt, args);
        Output.flush();

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

    fn matchPublicFolder(this: *RequestContext, comptime extensionless: bool) ?bundler.ServeResult {
        if (!this.bundler.options.routes.static_dir_enabled) return null;
        const relative_path = this.url.path;
        var extension = this.url.extname;
        var tmp_buildfile_buf = Bundler.tmp_buildfile_buf[0..];

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
            // bun.copy(u8, &tmp_buildfile_buf, relative_unrooted_path);
            // bun.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/"
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
            } else |_| {}

            // Okay is it actually a full path?
        } else if (extension.len > 0 and (!extensionless or strings.eqlComptime(extension, "html"))) {
            if (public_dir.openFile(relative_unrooted_path, .{})) |file| {
                _file = file;
            } else |_| {}
        }

        // Try some weird stuff.
        while (_file == null and relative_unrooted_path.len > 1) {
            // When no extension is provided, it might be html
            if (extension.len == 0) {
                bun.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                bun.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], ".html");

                if (public_dir.openFile(tmp_buildfile_buf[0 .. relative_unrooted_path.len + ".html".len], .{})) |file| {
                    _file = file;
                    extension = "html";
                    break;
                } else |_| {}

                var _path: []u8 = undefined;
                if (relative_unrooted_path[relative_unrooted_path.len - 1] == '/') {
                    bun.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0 .. relative_unrooted_path.len - 1]);
                    bun.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len - 1 ..], "/index.html");
                    _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len - 1 + "/index.html".len];
                } else {
                    bun.copy(u8, tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                    bun.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/index.html");

                    _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len + "/index.html".len];
                }

                if (extensionless and !strings.eqlComptime(std.fs.path.extension(_path), ".html")) {
                    break;
                }

                if (public_dir.openFile(_path, .{})) |file| {
                    const __path = _path;
                    relative_unrooted_path = __path;
                    extension = "html";
                    _file = file;
                    break;
                } else |_| {}
            }

            break;
        }

        if (_file) |*file| {
            var stat = file.stat() catch return null;
            var absolute_path = resolve_path.joinAbs(this.bundler.options.routes.static_dir, .auto, relative_unrooted_path);

            if (stat.kind == .SymLink) {
                file.* = std.fs.openFileAbsolute(absolute_path, .{ .mode = .read_only }) catch return null;

                absolute_path = bun.getFdPath(
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

            // if it wasn't a symlink, we never got the absolute path
            // so it could still be missing a file extension
            var ext = std.fs.path.extension(absolute_path);
            if (ext.len > 0) ext = ext[1..];

            // even if it was an absolute path, the file extension could just be a dot, like "foo."
            if (ext.len == 0) ext = extension;

            return bundler.ServeResult{
                .file = output_file,
                .mime_type = MimeType.byExtension(ext),
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

    pub fn printStatusLineError(err: anyerror, buf: []u8) []const u8 {
        return std.fmt.bufPrint(buf, "HTTP/1.1 500 {s}\r\n", .{@errorName(err)}) catch unreachable;
    }

    pub fn prepareToSendBody(
        ctx: *RequestContext,
        length: usize,
        comptime chunked: bool,
    ) !void {
        var content_length_header_buf: [64]u8 = undefined;
        defer {
            if (Environment.allow_assert) {
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

    const AsyncIO = @import("root").bun.AsyncIO;
    pub fn writeSocket(ctx: *RequestContext, buf_: anytype, _: anytype) !usize {
        var total: usize = 0;
        var buf: []const u8 = buf_;
        while (buf.len > 0) {
            switch (Syscall.send(ctx.conn.handle, buf, SOCKET_FLAGS)) {
                .err => |err| {
                    const erro = AsyncIO.asError(err.getErrno());
                    if (erro == error.EBADF or erro == error.ECONNABORTED or erro == error.ECONNREFUSED) {
                        return error.SocketClosed;
                    }

                    Output.prettyErrorln("send() error: {s}", .{err.toSystemError().message.slice()});

                    return erro;
                },
                .result => |written| {
                    if (written == 0) {
                        return error.SocketClosed;
                    }

                    buf = buf[written..];
                    total += written;
                },
            }
        }

        return total;
    }

    pub fn writeBodyBuf(ctx: *RequestContext, body: []const u8) !void {
        _ = try ctx.writeSocket(body, SOCKET_FLAGS);
    }

    pub fn writeStatus(ctx: *RequestContext, comptime code: HTTPStatusCode) !void {
        _ = try ctx.writeSocket(comptime printStatusLine(code), SOCKET_FLAGS);
        ctx.status = code;
    }

    pub fn writeStatusError(ctx: *RequestContext, err: anyerror) !void {
        var status_line_error_buf: [1024]u8 = undefined;
        _ = try ctx.writeSocket(printStatusLineError(err, &status_line_error_buf), SOCKET_FLAGS);
        ctx.status = @as(HTTPStatusCode, 500);
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
        this: *RequestContext,
        req: Request,
        arena: ThreadlocalArena,
        conn: std.net.Stream,
        bundler_: *Bundler,
        watcher_: *Watcher,
        timer: std.time.Timer,
    ) !void {
        this.* = RequestContext{
            .request = req,
            .arena = arena,
            .bundler = bundler_,
            .log = undefined,
            .url = try URLPath.parse(req.path),
            .conn = conn,
            .allocator = arena.allocator(),
            .method = Method.which(req.method) orelse return error.InvalidMethod,
            .watcher = watcher_,
            .timer = timer,
            .origin = bundler_.options.origin,
        };
    }

    // not all browsers send this
    pub const BrowserNavigation = enum {
        yes,
        no,
        maybe,
    };

    pub inline fn isBrowserNavigation(req: *RequestContext) BrowserNavigation {
        if (req.header("Sec-Fetch-Mode")) |mode| {
            return switch (strings.eqlComptime(mode, "navigate")) {
                true => BrowserNavigation.yes,
                false => BrowserNavigation.no,
            };
        }

        return .maybe;
    }

    pub fn sendNotFound(req: *RequestContext) !void {
        std.debug.assert(!req.has_called_done);

        defer req.done();
        try req.writeStatus(404);
        try req.flushHeaders();
    }

    pub fn sendInternalError(ctx: *RequestContext, err: anytype) !void {
        defer ctx.done();
        try ctx.writeStatusError(err);
        const printed = std.fmt.bufPrint(&error_buf, "error: {s}\nPlease see your terminal for more details", .{@errorName(err)}) catch |err2| brk: {
            if (Environment.isDebug or Environment.isTest) {
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
        if (comptime Environment.allow_assert) std.debug.assert(!ctx.has_written_last_header);
        if (comptime Environment.allow_assert) std.debug.assert(ctx.res_headers_count < res_headers_buf.len);
        res_headers_buf[ctx.res_headers_count] = Header{ .name = key, .value = value };
        ctx.res_headers_count += 1;
    }
    const file_chunk_size = 16384;
    const chunk_preamble_len: usize = brk: {
        var buf: [64]u8 = undefined;
        break :brk std.fmt.bufPrintIntToSlice(&buf, file_chunk_size, 16, true, .{}).len;
    };

    threadlocal var file_chunk_buf: [chunk_preamble_len + 2]u8 = undefined;
    threadlocal var symlink_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var weak_etag_buffer: [100]u8 = undefined;
    threadlocal var strong_etag_buffer: [100]u8 = undefined;
    threadlocal var weak_etag_tmp_buffer: [100]u8 = undefined;

    pub fn done(ctx: *RequestContext) void {
        std.debug.assert(!ctx.has_called_done);
        std.os.closeSocket(ctx.conn.handle);
        ctx.has_called_done = true;
    }

    pub fn sendBadRequest(ctx: *RequestContext) !void {
        try ctx.writeStatus(400);
        ctx.done();
    }

    pub fn sendJSB(ctx: *RequestContext) !void {
        const node_modules_bundle = ctx.bundler.options.node_modules_bundle orelse unreachable;
        if (ctx.header("Open-In-Editor") != null) {
            if (http_editor_context.editor == null) {
                http_editor_context.detectEditor(ctx.bundler.env);
            }

            if (http_editor_context.editor.? != .none) {
                var buf: string = "";

                if (node_modules_bundle.code_string == null) {
                    buf = try node_modules_bundle.readCodeAsStringSlow(bun.default_allocator);
                } else {
                    buf = node_modules_bundle.code_string.?.str;
                }

                http_editor_context.openInEditor(
                    http_editor_context.editor.?,
                    buf,
                    std.fs.path.basename(ctx.url.path),
                    ctx.bundler.fs.tmpdir(),
                    ctx.header("Editor-Line") orelse "",
                    ctx.header("Editor-Column") orelse "",
                );

                if (http_editor_context.editor.? != .none) {
                    try ctx.sendNoContent();
                    return;
                }
            }
        }

        ctx.appendHeader("ETag", node_modules_bundle.bundle.etag);
        ctx.appendHeader("Content-Type", "text/javascript");
        ctx.appendHeader("Cache-Control", "immutable, max-age=99999");

        if (ctx.header("If-None-Match")) |etag_header| {
            if (strings.eqlLong(node_modules_bundle.bundle.etag, etag_header, true)) {
                try ctx.sendNotModified();
                return;
            }
        }

        defer ctx.done();

        const content_length = node_modules_bundle.container.code_length.? - node_modules_bundle.codeStartOffset();
        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(content_length, false);

        _ = try std.os.sendfile(
            ctx.conn.handle,
            node_modules_bundle.fd,
            node_modules_bundle.codeStartOffset(),
            content_length,
            &[_]std.os.iovec_const{},
            &[_]std.os.iovec_const{},
            0,
        );
    }

    pub fn sendSinglePageHTML(ctx: *RequestContext) !void {
        std.debug.assert(ctx.bundler.options.routes.single_page_app_fd > 0);
        const file = std.fs.File{ .handle = ctx.bundler.options.routes.single_page_app_fd };
        return try sendHTMLFile(ctx, file);
    }

    pub fn sendHTMLFile(ctx: *RequestContext, file: std.fs.File) !void {
        ctx.appendHeader("Content-Type", MimeType.html.value);
        ctx.appendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

        defer ctx.done();

        const stats = file.stat() catch |err| {
            Output.prettyErrorln("<r><red>Error {s}<r> reading index.html", .{@errorName(err)});
            ctx.writeStatus(500) catch {};
            return;
        };

        const content_length = stats.size;
        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(content_length, false);

        var remain = content_length;
        while (remain > 0) {
            const wrote = try std.os.sendfile(
                ctx.conn.handle,
                ctx.bundler.options.routes.single_page_app_fd,
                content_length - remain,
                remain,
                &[_]std.os.iovec_const{},
                &[_]std.os.iovec_const{},
                0,
            );
            if (wrote == 0) {
                break;
            }
            remain -|= wrote;
        }
    }

    pub const WatchBuilder = struct {
        watcher: *Watcher,
        bundler: *Bundler,
        allocator: std.mem.Allocator,
        printer: JSPrinter.BufferPrinter,
        timer: std.time.Timer,
        count: usize = 0,
        origin: ZigURL,
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
        pub fn build(this: *WatchBuilder, id: u32, from_timestamp: u32, allocator: std.mem.Allocator) !WatchBuildResult {
            defer this.count += 1;
            this.printer.ctx.reset();
            var log = logger.Log.init(allocator);

            var watchlist_slice = this.watcher.watchlist.slice();

            const index = std.mem.indexOfScalar(u32, watchlist_slice.items(.hash), id) orelse return error.MissingWatchID;

            const file_path_str = watchlist_slice.items(.file_path)[index];
            const fd = watchlist_slice.items(.fd)[index];
            const loader = watchlist_slice.items(.loader)[index];
            const macro_remappings = this.bundler.options.macro_remap;
            const path = Fs.Path.init(file_path_str);
            var old_log = this.bundler.log;
            this.bundler.setLog(&log);

            defer {
                this.bundler.setLog(old_log);
            }

            switch (loader) {
                .toml, .json, .ts, .tsx, .js, .jsx => {
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
                            this.origin,
                            .absolute_url,
                            false,
                            false,
                        ) catch return WatchBuildResult{
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
                    }

                    var written = this.bundler.print(parse_result, @TypeOf(&this.printer), &this.printer, .esm) catch
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
                        .absolute_url,
                    );

                    const CSSBundler = Css.NewBundler(
                        @TypeOf(&this.printer),
                        @TypeOf(&this.bundler.linker),
                        @TypeOf(&this.bundler.resolver.caches.fs),
                        Watcher,
                        @TypeOf(this.bundler.fs),
                        false,
                        .absolute_url,
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
                                this.origin,
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
                                this.origin,
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
        conn: std.net.Stream,
        params: Router.Param.List,

        pub fn deinit(this: *JavaScriptHandler) void {
            this.params.deinit(bun.default_allocator);
            bun.default_allocator.destroy(this);
        }

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
            vm: *JavaScript.VirtualMachine = undefined,
            start_timer: std.time.Timer = undefined,
            entry_point: string = "",

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
                var arena = ThreadlocalArena.init() catch unreachable;
                var allocator = arena.allocator();
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

            pub fn handleRuntimeJSError(this: *HandlerThread, js_value: JavaScript.JSValue, comptime step: Api.FallbackStep, comptime fmt: string, args: anytype) !void {
                var arena = ThreadlocalArena.init() catch unreachable;
                var allocator = arena.allocator();
                defer arena.deinit();
                defer this.log.msgs.clearRetainingCapacity();

                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(allocator);
                defer exception_list.deinit();

                if (!js_value.isUndefinedOrNull()) {
                    javascript_vm.?.runErrorHandler(
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

            pub fn handleFetchEventError(this: *HandlerThread, err: anyerror, js_value: JavaScript.JSValue, ctx: *RequestContext) !void {
                var arena = ThreadlocalArena.init() catch unreachable;
                var allocator = arena.allocator();
                defer arena.deinit();

                defer this.log.msgs.clearRetainingCapacity();

                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(allocator);
                defer exception_list.deinit();
                var did_log_messages = false;
                if (!js_value.isUndefinedOrNull()) {
                    var start_count = this.log.msgs.items.len;
                    javascript_vm.?.runErrorHandler(
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
            if (!Environment.isMac) js_thread.setName("JavaScript SSR") catch {};
            js_thread.detach();
        }

        pub fn spawn(handler: *HandlerThread) void {
            _spawn(handler) catch {};
        }

        pub fn startJavaScript(handler: *HandlerThread) void {
            defer {
                javascript_disabled = true;
            }
            var vm = handler.vm;
            const entry_point = handler.entry_point;
            {
                var load_result = vm.loadEntryPoint(
                    entry_point,
                ) catch |err| {
                    handler.handleJSErrorFmt(
                        .load_entry_point,
                        err,
                        "<r>JavaScript VM failed to start.\n<red>{s}:<r> while loading <r><b>\"{s}\"",
                        .{ @errorName(err), entry_point },
                    ) catch {};
                    vm.flush();

                    return;
                };

                switch (load_result.status(vm.global.vm())) {
                    JavaScript.JSPromise.Status.Fulfilled => {},
                    else => {
                        var result = load_result.result(vm.global.vm());

                        handler.handleRuntimeJSError(
                            result,
                            .eval_entry_point,
                            "<r>JavaScript VM failed to start.\nwhile loading <r><b>\"{s}\"",
                            .{entry_point},
                        ) catch {};
                        vm.flush();
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
                    vm.flush();
                    return;
                }
            }

            js_ast.Stmt.Data.Store.reset();
            js_ast.Expr.Data.Store.reset();
            JavaScript.API.Bun.flushCSSImports();
            vm.flush();

            Output.printElapsed(@intToFloat(f64, (handler.start_timer.read())) / std.time.ns_per_ms);

            if (vm.bundler.options.framework.?.display_name.len > 0) {
                Output.prettyError(
                    " {s} ready<d>! (powered by bun)\n<r>",
                    .{
                        vm.bundler.options.framework.?.display_name,
                    },
                );
            } else {
                Output.prettyError(
                    " bun.js started\n<r>",
                    .{},
                );
            }

            Output.flush();

            runLoop(
                vm,
                handler,
            ) catch {};
        }

        pub fn _spawn(handler: *HandlerThread) !void {
            handler.start_timer = std.time.Timer.start() catch unreachable;

            Output.Source.configureThread();
            bun.JSC.initialize();

            js_ast.Stmt.Data.Store.create(bun.default_allocator);
            js_ast.Expr.Data.Store.create(bun.default_allocator);

            var vm: *JavaScript.VirtualMachine = JavaScript.VirtualMachine.init(
                bun.default_allocator,
                handler.args,
                null,
                handler.log,
                handler.env_loader,
            ) catch |err| {
                handler.handleJSError(.create_vm, err) catch {};
                javascript_disabled = true;
                return;
            };
            vm.bundler.options.macro_remap = try handler.client_bundler.options.macro_remap.clone(bun.default_allocator);
            vm.bundler.macro_context = js_ast.Macro.MacroContext.init(&vm.bundler);

            vm.is_from_devserver = true;
            vm.bundler.log = handler.log;
            std.debug.assert(JavaScript.VirtualMachine.isLoaded());
            javascript_vm = vm;
            vm.bundler.options.origin = handler.origin;
            const boot = vm.bundler.options.framework.?.server.path;
            std.debug.assert(boot.len > 0);
            errdefer vm.deinit();
            vm.bun_dev_watcher = handler.watcher;
            {
                vm.bundler.configureRouter(false) catch |err| {
                    handler.handleJSError(.configure_router, err) catch {};
                    vm.flush();
                    javascript_disabled = true;
                    return;
                };
                vm.bundler.configureDefines() catch |err| {
                    handler.handleJSError(.configure_defines, err) catch {};
                    vm.flush();
                    javascript_disabled = true;
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
                        javascript_disabled = true;
                        return;
                    };
                    entry_point = (resolved_entry_point.pathConst() orelse {
                        handler.handleJSErrorFmt(
                            .resolve_entry_point,
                            error.EntryPointDisabled,
                            "<r>JavaScript VM failed to start due to disabled entry point: <r><b>\"{s}\"",
                            .{resolved_entry_point.path_pair.primary.text},
                        ) catch {};
                        javascript_disabled = true;
                        return;
                    }).text;
                }

                handler.entry_point = entry_point;
            }
            handler.vm = vm;
            vm.global.vm().holdAPILock(handler, JavaScript.OpaqueWrap(HandlerThread, startJavaScript));
        }

        var __arena: ThreadlocalArena = undefined;

        pub fn runLoop(vm: *JavaScript.VirtualMachine, thread: *HandlerThread) !void {
            var module_map = JavaScript.ZigGlobalObject.getModuleRegistryMap(vm.global);

            if (!JavaScript.VM.isJITEnabled()) {
                Output.prettyErrorln("<red><r>warn:<r> JIT is disabled,,,this is a bug in bun and/or a permissions problem. JS will run slower.", .{});
                if (vm.bundler.env.map.get("BUN_CRASH_WITHOUT_JIT") != null) {
                    Global.crash();
                }
            }

            while (true) {
                __arena = ThreadlocalArena.init() catch unreachable;
                JavaScript.VirtualMachine.get().arena = &__arena;
                JavaScript.VirtualMachine.get().has_loaded = true;
                JavaScript.VirtualMachine.get().tick();
                defer {
                    JavaScript.VirtualMachine.get().flush();
                    std.debug.assert(
                        JavaScript.ZigGlobalObject.resetModuleRegistryMap(vm.global, module_map),
                    );
                    js_ast.Stmt.Data.Store.reset();
                    js_ast.Expr.Data.Store.reset();
                    JavaScript.API.Bun.flushCSSImports();
                    Output.flush();
                    JavaScript.VirtualMachine.get().arena.deinit();
                    JavaScript.VirtualMachine.get().has_loaded = false;
                }

                var handler: *JavaScriptHandler = try channel.readItem();
                JavaScript.VirtualMachine.get().tick();
                JavaScript.VirtualMachine.get().preflush();
                const original_origin = vm.origin;
                vm.origin = handler.ctx.origin;
                defer vm.origin = original_origin;
                handler.ctx.arena = __arena;
                handler.ctx.allocator = __arena.allocator();
                var req_body = handler.ctx.req_body_node;
                JavaScript.EventListenerMixin.emitFetchEvent(
                    vm,
                    &handler.ctx,
                    HandlerThread,
                    thread,
                    HandlerThread.handleFetchEventError,
                ) catch {};
                Server.current.releaseRequestDataPoolNode(req_body);
                JavaScript.VirtualMachine.get().tick();
                handler.deinit();
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

            var clone = try server.allocator.create(JavaScriptHandler);
            clone.* = JavaScriptHandler{
                .ctx = ctx.*,
                .conn = ctx.conn,
                .params = if (params.len > 0)
                    try params.clone(server.allocator)
                else
                    Router.Param.List{},
            };

            clone.ctx.conn = clone.conn;
            clone.ctx.matched_route.?.params = &clone.params;

            // this is a threadlocal arena
            clone.ctx.arena.deinit();
            clone.ctx.allocator = undefined;

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
        conn: std.net.Stream,
        tombstone: bool = false,
        builder: WatchBuilder,
        message_buffer: MutableString,
        bundler: Bundler,
        task: ThreadPool.Task,
        pub var open_websockets: std.ArrayList(*WebsocketHandler) = undefined;
        var open_websockets_lock = sync.RwLock.init();
        pub fn addWebsocket(ctx: *RequestContext, server: *Server) !*WebsocketHandler {
            open_websockets_lock.lock();
            defer open_websockets_lock.unlock();

            var clone = try server.allocator.create(WebsocketHandler);
            clone.ctx = ctx.*;
            clone.conn = ctx.conn;
            try ctx.bundler.clone(server.allocator, &clone.bundler);
            ctx.bundler = &clone.bundler;

            clone.task = .{ .callback = &onTask };
            clone.message_buffer = try MutableString.init(server.allocator, 0);
            clone.ctx.conn = clone.conn;
            clone.ctx.log = logger.Log.init(server.allocator);
            clone.ctx.origin = ZigURL.parse(server.allocator.dupe(u8, ctx.origin.href) catch unreachable);

            clone.builder = WatchBuilder{
                .allocator = server.allocator,
                .bundler = ctx.bundler,
                .printer = undefined,
                .timer = ctx.timer,
                .watcher = ctx.watcher,
                .origin = clone.ctx.origin,
            };

            clone.websocket = Websocket.Websocket.create(clone.conn.handle, SOCKET_FLAGS);
            clone.tombstone = false;

            ctx.allocator = undefined;
            ctx.arena.deinit();

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

        pub fn onSpawnThread(_: ?*anyopaque) ?*anyopaque {
            Global.setThreadName("HMR");
            Output.Source.configureThread();
            js_ast.Stmt.Data.Store.create(default_allocator);
            js_ast.Expr.Data.Store.create(default_allocator);
            websocket_printer = JSPrinter.BufferWriter.init(default_allocator) catch unreachable;

            return null;
        }

        pub fn onTask(self: *ThreadPool.Task) void {
            handle(@fieldParentPtr(WebsocketHandler, "task", self));
        }
        const CacheSet = @import("./cache.zig").Set;
        threadlocal var websocket_printer: JSPrinter.BufferWriter = undefined;
        pub fn handle(self: *WebsocketHandler) void {
            var req_body = self.ctx.req_body_node;
            defer {
                js_ast.Stmt.Data.Store.reset();
                js_ast.Expr.Data.Store.reset();
                Server.current.releaseRequestDataPoolNode(req_body);
            }

            self.builder.printer = JSPrinter.BufferPrinter.init(
                websocket_printer,
            );

            self.ctx.arena = ThreadlocalArena.init() catch unreachable;
            self.ctx.allocator = self.ctx.arena.allocator();
            self.builder.bundler.resolver.caches = CacheSet.init(self.ctx.allocator);
            self.builder.bundler.resolver.caches.fs.stream = true;

            _handle(self, &self.ctx) catch {};
        }

        fn _handle(handler: *WebsocketHandler, ctx: *RequestContext) !void {
            var is_socket_closed = false;
            const fd = ctx.conn.handle;
            defer {
                websocket_printer = handler.builder.printer.ctx;
                handler.tombstone = true;
                removeWebsocket(handler);

                ctx.arena.deinit();
                if (!is_socket_closed) {
                    _ = Syscall.close(fd);
                }
                bun.default_allocator.destroy(handler);
                Output.flush();
            }

            handler.checkUpgradeHeaders() catch |err| {
                switch (err) {
                    error.BadRequest => {
                        defer is_socket_closed = true;

                        try ctx.sendBadRequest();
                    },
                }
            };

            // switch (try handler.getWebsocketVersion()) {
            //     7, 8, 13 => {},
            //     else => {
            //         // Unsupported version
            //         // Set header to indicate to the client which versions are supported
            //         ctx.appendHeader("Sec-WebSocket-Version", "7,8,13");
            //         try ctx.writeStatus(426);
            //         try ctx.flushHeaders();
            //         ctx.done();
            //         is_socket_closed = true;
            //         return;
            //     },
            // }

            const key = try handler.getWebsocketAcceptKey();

            ctx.appendHeader("Connection", "Upgrade");
            ctx.appendHeader("Upgrade", "websocket");
            ctx.appendHeader("Sec-WebSocket-Accept", key);
            ctx.appendHeader("Sec-WebSocket-Protocol", "bun-hmr");
            ctx.writeStatus(101) catch |err| {
                if (err == error.SocketClosed) {
                    is_socket_closed = true;
                }

                return;
            };
            ctx.flushHeaders() catch |err| {
                if (err == error.SocketClosed) {
                    is_socket_closed = true;
                }

                return;
            };
            // Output.prettyErrorln("<r><green>101<r><d> Hot Module Reloading connected.<r>", .{});
            // Output.flush();
            Analytics.Features.hot_module_reloading = true;
            var build_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

            var cmd: Api.WebsocketCommand = undefined;
            var msg: Api.WebsocketMessage = .{
                .timestamp = handler.generateTimestamp(),
                .kind = .welcome,
            };
            var cmd_reader: ApiReader = undefined;
            {
                var byte_buf: [32 + bun.MAX_PATH_BYTES]u8 = undefined;
                var fbs = std.io.fixedBufferStream(&byte_buf);
                var writer = ByteApiWriter.init(&fbs);

                try msg.encode(&writer);
                var reloader = Api.Reloader.disable;
                if (ctx.bundler.options.hot_module_reloading) {
                    reloader = Api.Reloader.live;
                    if (ctx.bundler.options.jsx.supports_fast_refresh and ctx.bundler.env.get("BUN_FORCE_HMR") != null) {
                        reloader = Api.Reloader.fast_refresh;
                    }
                }

                const welcome_message = Api.WebsocketMessageWelcome{
                    .asset_prefix = handler.ctx.bundler.options.routes.asset_prefix_path,
                    .epoch = WebsocketHandler.toTimestamp(
                        @intCast(u64, (handler.ctx.timer.started.timestamp.tv_sec * std.time.ns_per_s)) + @intCast(u64, handler.ctx.timer.started.timestamp.tv_nsec),
                    ),
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
                Output.flush();

                defer Output.flush();
                std.os.getsockoptError(handler.conn.handle) catch |err| {
                    handler.tombstone = true;
                    Output.prettyErrorln("<r><red>Websocket ERR:<r> <b>{s}<r>", .{@errorName(err)});
                    is_socket_closed = true;
                };

                var frame = handler.websocket.read() catch |err| {
                    switch (err) {
                        error.ConnectionClosed => {
                            // Output.prettyErrorln("Websocket closed.", .{});
                            handler.tombstone = true;
                            is_socket_closed = true;
                            continue;
                        },
                        else => {
                            Output.prettyErrorln("<r><red>Websocket ERR:<r> <b>{s}<r>", .{@errorName(err)});
                        },
                    }
                    return;
                };
                switch (frame.header.opcode) {
                    .Close => {
                        // Output.prettyErrorln("Websocket closed.", .{});
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
                            .build, .build_with_file_path => {
                                const request_id = if (cmd.kind == .build)
                                    (try Api.WebsocketCommandBuild.decode(&cmd_reader)).id
                                else brk: {
                                    const full_build = try Api.WebsocketCommandBuildWithFilePath.decode(&cmd_reader);
                                    if (ctx.watcher.indexOf(full_build.id) != null) break :brk full_build.id;
                                    const file_path = if (std.fs.path.isAbsolute(full_build.file_path))
                                        full_build.file_path
                                    else
                                        ctx.bundler.fs.absBuf(
                                            &[_]string{ ctx.bundler.fs.top_level_dir, full_build.file_path },
                                            &build_file_path_buf,
                                        );

                                    if (Watcher.getHash(file_path) != full_build.id) {
                                        Output.prettyErrorln("<r><red>ERR:<r> <b>File path hash mismatch for {s}.<r>", .{full_build.file_path});
                                        continue;
                                    }
                                    // save because WebSocket's buffer is 8096
                                    // max file path is 4096
                                    var path_buf = bun.constStrToU8(file_path);
                                    path_buf.ptr[path_buf.len] = 0;
                                    var file_path_z: [:0]u8 = path_buf.ptr[0..path_buf.len :0];
                                    const file = std.fs.openFileAbsoluteZ(file_path_z, .{ .mode = .read_only }) catch |err| {
                                        Output.prettyErrorln("<r><red>ERR:<r>{s} opening file <b>{s}<r> <r>", .{ @errorName(err), full_build.file_path });
                                        continue;
                                    };
                                    Fs.FileSystem.setMaxFd(file.handle);
                                    try ctx.watcher.appendFile(
                                        file.handle,
                                        file_path,
                                        full_build.id,
                                        ctx.bundler.options.loader(Fs.PathName.init(file_path).ext),
                                        0,
                                        null,
                                        true,
                                    );
                                    break :brk full_build.id;
                                };

                                var arena = ThreadlocalArena.init() catch unreachable;
                                defer arena.deinit();

                                var head = Websocket.WebsocketHeader{
                                    .final = true,
                                    .opcode = .Binary,
                                    .mask = false,
                                    .len = 0,
                                };

                                // theres an issue where on the 4th or 5th build
                                // sometimes the final byte has incorrect data
                                // we never end up using all those bytes
                                if (handler.message_buffer.list.items.len > 0) {
                                    @memset(
                                        handler.message_buffer.list.items.ptr,
                                        0,
                                        @min(handler.message_buffer.list.items.len, 128),
                                    );
                                }
                                const build_result = handler.builder.build(request_id, cmd.timestamp, arena.allocator()) catch |err| {
                                    if (err == error.MissingWatchID) {
                                        msg.timestamp = cmd.timestamp;
                                        msg.kind = Api.WebsocketMessageKind.resolve_file;

                                        handler.message_buffer.reset();
                                        var buffer_writer = MutableStringAPIWriter.init(&handler.message_buffer);
                                        try msg.encode(&buffer_writer);
                                        const resolve_id = Api.WebsocketMessageResolveId{ .id = request_id };
                                        try resolve_id.encode(&buffer_writer);
                                        head.len = Websocket.WebsocketHeader.packLength(handler.message_buffer.list.items.len);
                                        var writer = buffer_writer.writable.writer();
                                        const body_len = handler.message_buffer.list.items.len;
                                        try head.writeHeader(&writer, body_len);
                                        var buffers = handler.message_buffer.toSocketBuffers(2, .{
                                            .{ body_len, handler.message_buffer.list.items.len },
                                            .{ 0, body_len },
                                        });
                                        _ = try handler.conn.writevAll(&buffers);
                                        continue;
                                    }

                                    return err;
                                };

                                const file_path = switch (build_result.value) {
                                    .fail => |fail| fail.module_path,
                                    .success => |fail| fail.module_path,
                                };

                                switch (build_result.value) {
                                    .fail => {
                                        Output.prettyErrorln(
                                            "error: <b>{s}<r><b>",
                                            .{
                                                file_path,
                                            },
                                        );
                                    },
                                    .success => {
                                        if (build_result.timestamp > cmd.timestamp) {
                                            Output.prettyErrorln(
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

                                {
                                    defer Output.flush();
                                    msg.timestamp = build_result.timestamp;
                                    msg.kind = switch (build_result.value) {
                                        .success => .build_success,
                                        else => .build_fail,
                                    };
                                    handler.message_buffer.reset();
                                    var buffer_writer = MutableStringAPIWriter.init(&handler.message_buffer);
                                    try msg.encode(&buffer_writer);
                                    var socket_buffers = std.mem.zeroes([4]std.os.iovec_const);

                                    var socket_buffer_count: usize = 2;

                                    switch (build_result.value) {
                                        .success => |success| {
                                            try success.encode(&buffer_writer);
                                            const total = handler.message_buffer.list.items.len + build_result.bytes.len + (if (build_result.bytes.len > 0) @as(usize, @sizeOf(u32)) else @as(usize, 0));
                                            const first_message_len = handler.message_buffer.list.items.len;
                                            head.len = Websocket.WebsocketHeader.packLength(total);
                                            try head.writeHeader(&handler.message_buffer.writer(), total);
                                            socket_buffers[0] = iovec(handler.message_buffer.list.items[first_message_len..]);
                                            socket_buffers[1] = iovec(handler.message_buffer.list.items[0..first_message_len]);

                                            if (build_result.bytes.len > 0) {
                                                socket_buffers[2] = iovec(build_result.bytes);
                                                // we reuse the accept key buffer
                                                // so we have a pointer that is not stack memory
                                                handler.accept_key[0..@sizeOf(usize)].* = @bitCast([@sizeOf(usize)]u8, std.hash.Wyhash.hash(0, build_result.bytes));
                                                socket_buffers[3] = iovec(handler.accept_key[0..4]);
                                                socket_buffer_count = 4;
                                            }
                                        },
                                        .fail => |fail| {
                                            try fail.encode(&buffer_writer);
                                            head.len = Websocket.WebsocketHeader.packLength(handler.message_buffer.list.items.len);
                                            const first_message_len = handler.message_buffer.list.items.len;
                                            try head.writeHeader(&handler.message_buffer.writer(), handler.message_buffer.list.items.len);
                                            socket_buffers[0] = iovec(handler.message_buffer.list.items[first_message_len..]);
                                            socket_buffers[1] = iovec(handler.message_buffer.list.items[0..first_message_len]);
                                        },
                                    }

                                    _ = try handler.conn.writevAll(
                                        socket_buffers[0..socket_buffer_count],
                                    );
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

            if (!strings.eqlComptime(upgrade_header, "websocket")) {
                return error.BadRequest; // Can only upgrade to websocket
            }

            // Some proxies/load balancers will mess with the connection header
            // and browsers also send multiple values here
            const connection_header = request.header("Connection") orelse return error.BadRequest;
            var it = std.mem.split(u8, connection_header, ",");
            while (it.next()) |part| {
                const conn = std.mem.trim(u8, part, " ");
                if (strings.eqlCaseInsensitiveASCII(conn, "upgrade", true)) {
                    return;
                }
            }
            return error.BadRequest; // Connection must be upgrade
        }

        fn getWebsocketVersion(
            self: *WebsocketHandler,
        ) !void {
            var request: *RequestContext = &self.ctx;
            _ = request.header("Sec-WebSocket-Version") orelse {
                Output.prettyErrorln("HMR WebSocket error: missing Sec-WebSocket-Version header", .{});
                return error.BadRequest;
            };
            // this error is noisy
            // return std.fmt.parseInt(u8, v, 10) catch {
            //     Output.prettyErrorln("HMR WebSocket error: Sec-WebSocket-Version is invalid {s}", .{v});
            //     return error.BadRequest;
            // };
        }

        fn getWebsocketAcceptKey(
            self: *WebsocketHandler,
        ) ![]const u8 {
            var request: *RequestContext = &self.ctx;
            const key = (request.header("Sec-WebSocket-Key") orelse return error.BadRequest);
            if (key.len < 8) {
                Output.prettyErrorln("HMR WebSocket error: Sec-WebSocket-Key is less than 8 characters long: {s}", .{key});
                return error.BadRequest;
            }

            var hash = std.crypto.hash.Sha1.init(.{});
            var out: [20]u8 = undefined;
            hash.update(key);
            hash.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            hash.final(&out);

            // Encode it
            return std.base64.standard.Encoder.encode(&self.accept_key, &out);
        }
    };

    pub fn writeETag(this: *RequestContext, buffer: anytype) !bool {
        const strong_etag = std.hash.Wyhash.hash(0, buffer);
        const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});

        this.appendHeader("ETag", etag_content_slice);

        if (this.header("If-None-Match")) |etag_header| {
            if (strings.eqlLong(etag_content_slice, etag_header, true)) {
                try this.sendNotModified();
                return true;
            }
        }

        return false;
    }

    pub fn handleWebsocket(ctx: *RequestContext, server: *Server) anyerror!void {
        ctx.controlled = true;
        var handler = try WebsocketHandler.addWebsocket(ctx, server);
        server.websocket_threadpool.schedule(ThreadPool.Batch.from(&handler.task));
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

        const accept: MimeType = brk: {
            if (ctx.header("Accept")) |accept|
                break :brk MimeType.init(accept);

            break :brk ctx.mime_type;
        };

        ctx.to_plain_text = accept.category == .text and strings.eqlComptime(accept.value, "text/plain");

        if (!ctx.to_plain_text) {
            if (!ctx.url.is_source_map) {
                ctx.appendHeader("Content-Type", ctx.mime_type.value);
            } else {
                ctx.appendHeader("Content-Type", MimeType.json.value);
            }
        } else {
            ctx.appendHeader("Content-Type", "text/plain");
        }

        const send_body = ctx.method.hasBody();

        switch (result.file.value) {
            .pending => |resolve_result| {
                const path = resolve_result.pathConst() orelse {
                    try ctx.sendNoContent();
                    return;
                };

                const hash = Watcher.getHash(result.file.input.text);
                const input_fd = if (ctx.watcher.indexOf(hash)) |ind|
                    if (ind > 0) ctx.watcher.watchlist.items(.fd)[ind] else null
                else
                    null;

                if (resolve_result.is_external) {
                    try ctx.sendBadRequest();
                    return;
                }

                const SocketPrinterInternal = struct {
                    const SocketPrinterInternal = @This();
                    rctx: *RequestContext,
                    _loader: Options.Loader,
                    buffer: MutableString = undefined,
                    threadlocal var buffer: ?*MutableString = null;

                    pub fn reserveNext(this: *SocketPrinterInternal, count: u32) anyerror![*]u8 {
                        try this.buffer.growIfNeeded(count);
                        return @ptrCast([*]u8, &this.buffer.list.items.ptr[this.buffer.list.items.len]);
                    }

                    pub fn advanceBy(this: *SocketPrinterInternal, count: u32) void {
                        if (comptime Environment.isDebug) std.debug.assert(this.buffer.list.items.len + count <= this.buffer.list.capacity);

                        this.buffer.list.items = this.buffer.list.items.ptr[0 .. this.buffer.list.items.len + count];
                    }

                    pub fn init(rctx: *RequestContext, _loader: Options.Loader) SocketPrinterInternal {
                        if (buffer == null) {
                            buffer = default_allocator.create(MutableString) catch unreachable;
                            buffer.?.* = MutableString.init2048(default_allocator) catch unreachable;
                        }

                        buffer.?.reset();

                        return SocketPrinterInternal{
                            .rctx = rctx,
                            ._loader = _loader,
                            .buffer = buffer.?.*,
                        };
                    }
                    pub fn writeByte(this: *SocketPrinterInternal, byte: u8) anyerror!usize {
                        try this.buffer.appendChar(byte);
                        return 1;
                    }
                    pub fn writeAll(this: *SocketPrinterInternal, bytes: anytype) anyerror!usize {
                        try this.buffer.append(bytes);
                        return bytes.len;
                    }

                    pub fn slice(this: *SocketPrinterInternal) string {
                        return this.buffer.list.items;
                    }

                    pub fn getLastByte(this: *const SocketPrinterInternal) u8 {
                        return if (this.buffer.list.items.len > 0) this.buffer.list.items[this.buffer.list.items.len - 1] else 0;
                    }

                    pub fn getLastLastByte(this: *const SocketPrinterInternal) u8 {
                        return if (this.buffer.list.items.len > 1) this.buffer.list.items[this.buffer.list.items.len - 2] else 0;
                    }

                    pub fn getWritten(this: *const SocketPrinterInternal) []u8 {
                        return this.buffer.list.items;
                    }

                    const SourceMapHandler = JSPrinter.SourceMapHandler.For(SocketPrinterInternal, onSourceMapChunk);
                    pub fn onSourceMapChunk(this: *SocketPrinterInternal, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
                        if (this.rctx.has_called_done) return;
                        var mutable = try chunk.printSourceMapContents(
                            source,
                            MutableString.initEmpty(this.rctx.allocator),
                            this.rctx.header("Mappings-Only") == null,
                            false,
                        );

                        const buf = mutable.toOwnedSliceLeaky();
                        if (buf.len == 0) {
                            try this.rctx.sendNoContent();
                            return;
                        }

                        defer this.rctx.done();
                        try this.rctx.writeStatus(200);
                        try this.rctx.prepareToSendBody(buf.len, false);
                        try this.rctx.writeBodyBuf(buf);
                    }
                    pub fn sourceMapHandler(this: *SocketPrinterInternal) JSPrinter.SourceMapHandler {
                        return SourceMapHandler.init(this);
                    }

                    pub fn done(
                        chunky: *SocketPrinterInternal,
                    ) anyerror!void {
                        SocketPrinterInternal.buffer.?.* = chunky.buffer;
                        if (chunky.rctx.has_called_done) return;
                        const buf = chunky.buffer.toOwnedSliceLeaky();
                        defer {
                            chunky.buffer.reset();
                            SocketPrinterInternal.buffer.?.* = chunky.buffer;
                        }

                        if (chunky.rctx.header("Open-In-Editor") != null) {
                            if (http_editor_context.editor == null) {
                                http_editor_context.detectEditor(chunky.rctx.bundler.env);
                            }

                            if (http_editor_context.editor.? != .none) {
                                http_editor_context.openInEditor(
                                    http_editor_context.editor.?,
                                    buf,
                                    std.fs.path.basename(chunky.rctx.url.path),
                                    chunky.rctx.bundler.fs.tmpdir(),
                                    chunky.rctx.header("Editor-Line") orelse "",
                                    chunky.rctx.header("Editor-Column") orelse "",
                                );

                                if (http_editor_context.editor.? != .none) {
                                    try chunky.rctx.sendNoContent();
                                    return;
                                }
                            }
                        }

                        if (buf.len == 0) {
                            try chunky.rctx.sendNoContent();
                            return;
                        }

                        var source_map_url: string = "";
                        const send_sourcemap_info = chunky._loader.isJavaScriptLike();

                        if (send_sourcemap_info) {
                            // This will be cleared by the arena
                            source_map_url = bun.asByteSlice(chunky.rctx.getFullURLForSourceMap());

                            chunky.rctx.appendHeader("SourceMap", source_map_url);
                        }

                        // Failed experiment: inject "Link" tags for each import path
                        // Browsers ignore this header when it's coming from a script import.
                        // In Chrome, the header appears in the Network tab but doesn't seem to do anything
                        // In Firefox,the header does not appear in the Network tab.
                        // Safari was not tested

                        if (FeatureFlags.strong_etags_for_built_files) {
                            // Always cache css & json files, even big ones
                            // css is especially important because we want to try and skip having the browser parse it whenever we can
                            if (buf.len < 16 * 16 * 16 * 16 or chunky._loader == .css or chunky._loader == .json) {
                                const strong_etag = std.hash.Wyhash.hash(0, buf);
                                const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});
                                chunky.rctx.appendHeader("ETag", etag_content_slice);

                                if (chunky.rctx.header("If-None-Match")) |etag_header| {
                                    if (strings.eqlLong(etag_content_slice, etag_header, true)) {
                                        try chunky.rctx.sendNotModified();
                                        return;
                                    }
                                }
                            }
                        }

                        defer chunky.rctx.done();
                        try chunky.rctx.writeStatus(200);
                        const source_map_url_len: usize = if (send_sourcemap_info)
                            "\n//# sourceMappingURL=".len + source_map_url.len + "\n".len
                        else
                            0;
                        try chunky.rctx.prepareToSendBody(buf.len + source_map_url_len, false);

                        try chunky.rctx.writeBodyBuf(buf);

                        if (send_sourcemap_info) {
                            // TODO: use an io vec
                            try chunky.rctx.writeBodyBuf("\n//# sourceMappingURL=");
                            try chunky.rctx.writeBodyBuf(source_map_url);
                            try chunky.rctx.writeBodyBuf("\n");
                        }
                    }

                    pub fn flush(
                        _: *SocketPrinterInternal,
                    ) anyerror!void {}
                };

                const SocketPrinter = JSPrinter.NewWriter(
                    SocketPrinterInternal,
                    SocketPrinterInternal.writeByte,
                    SocketPrinterInternal.writeAll,
                    SocketPrinterInternal.getLastByte,
                    SocketPrinterInternal.getLastLastByte,
                    SocketPrinterInternal.reserveNext,
                    SocketPrinterInternal.advanceBy,
                );
                const loader = ctx.bundler.options.loaders.get(result.file.input.name.ext) orelse .file;

                var socket_printer = SocketPrinter.init(
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

                const written = (if (!ctx.url.is_source_map)
                    ctx.bundler.buildWithResolveResult(
                        resolve_result,
                        ctx.allocator,
                        loader,
                        SocketPrinter,
                        socket_printer,
                        .absolute_url,
                        input_fd,
                        hash,
                        Watcher,
                        ctx.watcher,
                        client_entry_point_,
                        ctx.origin,
                        false,
                        null,
                    )
                else
                    ctx.bundler.buildWithResolveResult(
                        resolve_result,
                        ctx.allocator,
                        loader,
                        SocketPrinter,
                        socket_printer,
                        .absolute_url,
                        input_fd,
                        hash,
                        Watcher,
                        ctx.watcher,
                        client_entry_point_,
                        ctx.origin,
                        true,
                        socket_printer.ctx.sourceMapHandler(),
                    )) catch |err| {
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
                        .toml, .js, .jsx, .ts, .tsx, .json => {
                            const buf = "export default {};";
                            const strong_etag = comptime std.hash.Wyhash.hash(0, buf);
                            const etag_content_slice = std.fmt.bufPrintIntToSlice(strong_etag_buffer[0..49], strong_etag, 16, .upper, .{});
                            ctx.appendHeader("ETag", etag_content_slice);

                            if (ctx.header("If-None-Match")) |etag_header| {
                                if (strings.eqlLong(etag_content_slice, etag_header, true)) {
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
                        } else |_| {}
                    }
                }

                // if (result.mime_type.category != .html) {
                // hash(absolute_file_path, size, mtime)
                var weak_etag = std.hash.Wyhash.init(0);
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
                    if (strings.eqlLong(complete_weak_etag, etag_header, true)) {
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
                            ctx.conn.handle,
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

    fn handleBlobURL(ctx: *RequestContext, _: *Server) !void {
        var id = ctx.url.path["blob:".len..];

        var line: string = "";
        var column: string = "";

        // This makes it Just Work if you pass a line/column number
        if (strings.indexOfChar(id, ':')) |colon| {
            line = id[@min(id.len, colon + 1)..];
            id = id[0..colon];

            if (strings.indexOfChar(line, ':')) |col| {
                column = line[@min(line.len, col + 1)..];
                line = line[0..col];
            }
        }

        const Blob = @import("./blob.zig");

        const blob: Blob = brk: {
            // It could be a blob either for macros or for JS thread
            if (JavaScriptHandler.javascript_vm) |vm| {
                if (vm.blobs.?.get(id)) |blob| {
                    break :brk blob;
                }

                if (strings.eqlComptime(id, "node_modules.server.bun")) {
                    if (vm.node_modules) |_bun| {
                        if (_bun.code_string) |code| {
                            break :brk Blob{ .ptr = code.str.ptr, .len = code.str.len };
                        }
                    }
                }
            }

            if (JavaScript.VirtualMachine.isLoaded()) {
                var vm = JavaScript.VirtualMachine.get();
                if (vm.blobs.?.get(id)) |blob| {
                    break :brk blob;
                }

                if (strings.eqlComptime(id, "node_modules.server.bun")) {
                    if (vm.node_modules) |_bun| {
                        if (_bun.code_string) |code| {
                            break :brk Blob{ .ptr = code.str.ptr, .len = code.str.len };
                        }
                    }
                }
            }

            return try ctx.sendNotFound();
        };

        if (blob.len == 0) {
            try ctx.sendNoContent();
            return;
        }

        if (ctx.header("Open-In-Editor") != null) {
            if (http_editor_context.editor == null) {
                http_editor_context.detectEditor(ctx.bundler.env);
            }

            if (line.len == 0) {
                if (ctx.header("Editor-Line")) |_line| {
                    line = _line;
                }
            }

            if (column.len == 0) {
                if (ctx.header("Editor-Column")) |_column| {
                    column = _column;
                }
            }

            if (http_editor_context.editor) |editor| {
                if (editor != .none) {
                    http_editor_context.openInEditor(editor, blob.ptr[0..blob.len], id, Fs.FileSystem.instance.tmpdir(), line, column);
                    if (http_editor_context.editor.? != .none) {
                        defer ctx.done();
                        try ctx.writeStatus(200);
                        ctx.appendHeader("Content-Type", MimeType.html.value);
                        const auto_close = "<html><body><h1>Opened in editor!</h1><script>window.close();</script></body></html>";
                        try ctx.prepareToSendBody(auto_close.len, false);
                        try ctx.writeBodyBuf(auto_close);
                        return;
                    }
                }
            }
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
            if (ctx.header("Upgrade")) |upgrade| {
                if (strings.eqlCaseInsensitiveASCII(upgrade, "websocket", true)) {
                    try ctx.handleWebsocket(server);
                    return;
                }
            }
        }

        if (strings.eqlComptime(path, "error.js")) {
            const buffer = ErrorJS.sourceContent();
            ctx.appendHeader("Content-Type", MimeType.javascript.value);
            ctx.appendHeader("Cache-Control", "public, max-age=3600");
            ctx.appendHeader("Age", "0");

            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method.hasBody();
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
            ctx.appendHeader("Cache-Control", "public, max-age=3600");
            ctx.appendHeader("Age", "0");

            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method.hasBody();
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

        if (strings.eqlComptime(path, "wrap")) {
            const buffer = Runtime.sourceContent(ctx.bundler.options.jsx.use_embedded_refresh_runtime);
            ctx.appendHeader("Content-Type", MimeType.javascript.value);
            ctx.appendHeader("Cache-Control", "public, max-age=3600");
            ctx.appendHeader("Age", "0");
            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method.hasBody();
            defer ctx.done();
            try ctx.writeStatus(200);
            try ctx.prepareToSendBody(buffer.len, false);
            if (!send_body) return;
            _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
            return;
        }

        if (strings.eqlComptime(path, "info")) {
            return try ctx.sendBunInfoJSON();
        }

        if (strings.eqlComptime(path, "reactfsh-v0.11.0")) {
            const buffer = @embedFile("react-refresh.js");
            ctx.appendHeader("Content-Type", MimeType.javascript.value);
            ctx.appendHeader("Cache-Control", "public, max-age=3600");
            ctx.appendHeader("Age", "0");
            if (FeatureFlags.strong_etags_for_built_files) {
                const did_send = ctx.writeETag(buffer) catch false;
                if (did_send) return;
            }

            if (buffer.len == 0) {
                return try ctx.sendNoContent();
            }
            const send_body = ctx.method.hasBody();
            defer ctx.done();
            try ctx.writeStatus(200);
            try ctx.prepareToSendBody(buffer.len, false);
            if (!send_body) return;
            _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
            return;
        }

        try ctx.sendNotFound();
        return;
    }

    fn sendBunInfoJSON(ctx: *RequestContext) anyerror!void {
        defer ctx.bundler.resetStore();

        var buffer_writer = try JSPrinter.BufferWriter.init(default_allocator);

        var writer = JSPrinter.BufferPrinter.init(buffer_writer);
        defer writer.ctx.buffer.deinit();
        var source = logger.Source.initEmptyFile("info.json");
        _ = try JSPrinter.printJSON(
            *JSPrinter.BufferPrinter,
            &writer,
            try Global.BunInfo.generate(*Bundler, ctx.bundler, ctx.allocator),
            &source,
        );
        const buffer = writer.ctx.written;

        ctx.appendHeader("Content-Type", MimeType.json.value);
        ctx.appendHeader("Cache-Control", "public, max-age=3600");
        ctx.appendHeader("Age", "0");
        if (FeatureFlags.strong_etags_for_built_files) {
            const did_send = ctx.writeETag(buffer) catch false;
            if (did_send) return;
        }

        if (buffer.len == 0) {
            return try ctx.sendNoContent();
        }
        const send_body = ctx.method.hasBody();
        defer ctx.done();
        try ctx.writeStatus(200);
        try ctx.prepareToSendBody(buffer.len, false);
        if (!send_body) return;
        _ = try ctx.writeSocket(buffer, SOCKET_FLAGS);
    }

    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-Fetch-Dest
    pub fn isScriptOrStyleRequest(ctx: *RequestContext) bool {
        const header_ = ctx.header("Sec-Fetch-Dest") orelse return false;
        return strings.eqlComptime(header_, "script") or
            strings.eqlComptime(header_, "style");
    }

    fn handleSrcURL(ctx: *RequestContext, _: *Server) !void {
        var input_path = ctx.url.path["src:".len..];
        var line: string = "";
        var column: string = "";
        if (std.mem.indexOfScalar(u8, input_path, ':')) |i| {
            line = input_path[i + 1 ..];
            input_path = input_path[0..i];

            if (line.len > 0) {
                if (std.mem.indexOfScalar(u8, line, ':')) |j| {
                    column = line[j + 1 ..];
                    line = line[0..j];
                }
            }
        }

        if (ctx.bundler.options.routes.asset_prefix_path.len > 0 and
            strings.hasPrefix(input_path, ctx.bundler.options.routes.asset_prefix_path))
        {
            input_path = input_path[ctx.bundler.options.routes.asset_prefix_path.len..];
        }
        if (input_path.len == 0) return ctx.sendNotFound();

        const result = ctx.buildFile(input_path) catch |err| {
            if (err == error.ModuleNotFound) {
                return try ctx.sendNotFound();
            }

            return err;
        };

        switch (result.file.value) {
            .pending => |resolve_result| {
                const path = resolve_result.pathConst() orelse return try ctx.sendNotFound();
                if (ctx.header("Open-In-Editor") != null) {
                    if (http_editor_context.editor == null)
                        http_editor_context.detectEditor(ctx.bundler.env);

                    if (http_editor_context.editor) |editor| {
                        if (editor != .none) {
                            editor.open(http_editor_context.path, path.text, line, column, bun.default_allocator) catch |err| {
                                if (editor != .other) {
                                    Output.prettyErrorln("Error {s} opening in {s}", .{ @errorName(err), @tagName(editor) });
                                }

                                http_editor_context.editor = Editor.none;
                            };

                            if (http_editor_context.editor.? != .none) {
                                defer ctx.done();
                                try ctx.writeStatus(200);
                                ctx.appendHeader("Content-Type", MimeType.html.value);
                                const auto_close = "<html><body><script>window.close();</script></body></html>";
                                try ctx.prepareToSendBody(auto_close.len, false);
                                try ctx.writeBodyBuf(auto_close);
                                return;
                            }
                        }
                    }
                }

                var needs_close = false;
                const fd = if (resolve_result.file_fd != 0)
                    resolve_result.file_fd
                else brk: {
                    var file = std.fs.openFileAbsoluteZ(path.textZ(), .{ .mode = .read_only }) catch |err| {
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
                    ctx.conn.handle,
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

    fn handleAbsURL(ctx: *RequestContext, _: *Server) !void {
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
                );
                try @call(.always_inline, RequestContext.renderServeResult, .{ ctx, result });
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

        if (strings.hasPrefixComptime(ctx.url.path, "blob:")) {
            try ctx.handleBlobURL(server);
            return true;
        }

        // From HTTP, we serve files with a hash modkey
        // The format is
        //    hash:${hash}/${ORIGINAL_PATH}
        //    hash:abcdefg123/app/foo/my-file.jpeg
        // The hash exists for browser cache invalidation
        if (strings.hasPrefixComptime(ctx.url.path, "hash:")) {
            var current = ctx.url.path;
            current = current["hash:".len..];
            if (strings.indexOfChar(current, '/')) |i| {
                current = current[i + 1 ..];
                ctx.url.path = current;
                return false;
            }
        }

        if (strings.hasPrefixComptime(ctx.url.path, "bun:")) {
            try ctx.handleBunURL(server);
            return true;
        }

        if (strings.hasPrefixComptime(ctx.url.path, "src:")) {
            try ctx.handleSrcURL(server);
            return true;
        }

        if (strings.hasPrefixComptime(ctx.url.path, "abs:")) {
            try ctx.handleAbsURL(server);
            return true;
        }

        return false;
    }

    pub inline fn buildFile(ctx: *RequestContext, path_name: string) !bundler.ServeResult {
        if (ctx.bundler.options.isFrontendFrameworkEnabled()) {
            return try ctx.bundler.buildFile(
                &ctx.log,
                path_name,
                true,
            );
        } else {
            return try ctx.bundler.buildFile(
                &ctx.log,
                path_name,
                false,
            );
        }
    }
    pub fn handleGet(ctx: *RequestContext) !void {
        const result = try ctx.buildFile(
            ctx.url.pathWithoutAssetPrefix(ctx.bundler.options.routes.asset_prefix_path),
        );
        try @call(.always_inline, RequestContext.renderServeResult, .{ ctx, result });
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
//     allocator: std.mem.Allocator,

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
const Editor = @import("./open.zig").Editor;
const EditorContext = @import("./open.zig").EditorContext;

pub const Server = struct {
    log: logger.Log,
    allocator: std.mem.Allocator,
    bundler: *Bundler,
    watcher: *Watcher,
    timer: std.time.Timer = undefined,
    transform_options: Api.TransformOptions,
    javascript_enabled: bool = false,
    fallback_only: bool = false,
    req_body_release_queue_mutex: Lock = Lock.init(),
    req_body_release_queue: RequestDataPool.List = RequestDataPool.List{},

    websocket_threadpool: ThreadPool = ThreadPool.init(.{
        // on macOS, the max stack size is 65520 bytes,
        // so we ask for 65519
        .stack_size = 65519,
        .max_threads = std.math.maxInt(u32),
    }),

    pub var current: *Server = undefined;

    pub fn releaseRequestDataPoolNode(this: *Server, node: *RequestDataPool.Node) void {
        this.req_body_release_queue_mutex.lock();
        defer this.req_body_release_queue_mutex.unlock();
        node.next = null;

        this.req_body_release_queue.prepend(node);
    }

    pub fn cleanupRequestData(this: *Server) void {
        this.req_body_release_queue_mutex.lock();
        defer this.req_body_release_queue_mutex.unlock();
        var any = false;
        while (this.req_body_release_queue.popFirst()) |node| {
            node.next = null;
            node.release();
            any = true;
        }
    }

    threadlocal var filechange_buf: [32]u8 = undefined;
    threadlocal var filechange_buf_hinted: [32]u8 = undefined;

    pub fn onFileUpdate(
        ctx: *Server,
        events: []watcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: watcher.Watchlist,
    ) void {
        if (Output.isEmojiEnabled()) {
            _onFileUpdate(ctx, events, changed_files, watchlist, true);
        } else {
            _onFileUpdate(ctx, events, changed_files, watchlist, false);
        }
    }

    var _on_file_update_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    fn _onFileUpdate(
        ctx: *Server,
        events: []watcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: watcher.Watchlist,
        comptime is_emoji_enabled: bool,
    ) void {
        var fbs = std.io.fixedBufferStream(&filechange_buf);
        var hinted_fbs = std.io.fixedBufferStream(&filechange_buf_hinted);
        {
            var writer = ByteApiWriter.init(&fbs);
            const message_type = Api.WebsocketMessage{
                .timestamp = RequestContext.WebsocketHandler.toTimestamp(ctx.timer.read()),
                .kind = .file_change_notification,
            };

            message_type.encode(&writer) catch unreachable;
        }

        {
            var writer = ByteApiWriter.init(&hinted_fbs);
            const message_type = Api.WebsocketMessage{
                .timestamp = RequestContext.WebsocketHandler.toTimestamp(ctx.timer.read()),
                .kind = Api.WebsocketMessageKind.file_change_notification_with_hint,
            };

            message_type.encode(&writer) catch unreachable;
        }

        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);
        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        const hashes = slice.items(.hash);
        var file_descriptors = slice.items(.fd);
        const header = fbs.getWritten();
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
            const id = hashes[event.index];
            var content_fbs = std.io.fixedBufferStream(filechange_buf[header.len..]);
            var hinted_content_fbs = std.io.fixedBufferStream(filechange_buf_hinted[header.len..]);

            if (comptime Environment.isDebug) {
                Output.prettyErrorln("[watcher] {s}: -- {}", .{ @tagName(kind), event.op });
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
                            Output.prettyErrorln("<r><d>File changed: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        }
                    } else {
                        var tmp = ctx.bundler.options.loaders.get(path.ext) orelse .file;
                        const change_message = Api.WebsocketMessageFileChangeNotification{
                            .id = id,
                            .loader = tmp.toAPI(),
                        };

                        var content_writer = ByteApiWriter.init(&content_fbs);
                        change_message.encode(&content_writer) catch unreachable;
                        const change_buf = content_fbs.getWritten();
                        const written_buf = filechange_buf[0 .. header.len + change_buf.len];
                        RequestContext.WebsocketHandler.broadcast(written_buf) catch |err| {
                            Output.prettyErrorln("Error writing change notification: {s}<r>", .{@errorName(err)});
                        };
                        if (comptime is_emoji_enabled) {
                            Output.prettyErrorln("<r>📜  <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        } else {
                            Output.prettyErrorln("<r>   <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                        }
                    }
                },
                .directory => {
                    const affected = event.names(changed_files);
                    var entries_option: ?*Fs.FileSystem.RealFS.EntriesOption = null;
                    if (affected.len > 0) {
                        entries_option = rfs.entries.get(file_path);
                    }

                    rfs.bustEntriesCache(file_path);
                    ctx.bundler.resolver.dir_cache.remove(file_path);

                    if (entries_option) |dir_ent| {
                        var last_file_hash: Watcher.HashType = std.math.maxInt(Watcher.HashType);
                        for (affected) |changed_name_ptr| {
                            const changed_name: []u8 = (changed_name_ptr orelse continue)[0..];
                            if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                            const loader = (ctx.bundler.options.loaders.get(Fs.PathName.init(changed_name).ext) orelse .file);
                            if (loader.isJavaScriptLikeOrJSON() or loader == .css) {
                                var path_string: bun.PathString = undefined;
                                var file_hash: Watcher.HashType = last_file_hash;
                                const abs_path: string = brk: {
                                    if (dir_ent.entries.get(changed_name)) |file_ent| {
                                        // reset the file descriptor
                                        file_ent.entry.cache.fd = 0;
                                        file_ent.entry.need_stat = true;
                                        path_string = file_ent.entry.abs_path;
                                        file_hash = Watcher.getHash(path_string.slice());
                                        for (hashes, 0..) |hash, entry_id| {
                                            if (hash == file_hash) {
                                                file_descriptors[entry_id] = 0;
                                                break;
                                            }
                                        }

                                        break :brk path_string.slice();
                                    } else {
                                        var file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);
                                        @memcpy(&_on_file_update_path_buf, file_path_without_trailing_slash.ptr, file_path_without_trailing_slash.len);
                                        _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                                        @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..].ptr, changed_name.ptr, changed_name.len);
                                        const path_slice = _on_file_update_path_buf[0 .. file_path_without_trailing_slash.len + changed_name.len + 1];
                                        file_hash = Watcher.getHash(path_slice);
                                        break :brk path_slice;
                                    }
                                };

                                // skip consecutive duplicates
                                if (last_file_hash == file_hash) continue;
                                last_file_hash = file_hash;

                                const change_message = Api.WebsocketMessageFileChangeNotification{
                                    .id = file_hash,
                                    .loader = loader.toAPI(),
                                };

                                var content_writer = ByteApiWriter.init(&hinted_content_fbs);
                                change_message.encode(&content_writer) catch unreachable;
                                const change_buf = hinted_content_fbs.getWritten();
                                const written_buf = filechange_buf_hinted[0 .. header.len + change_buf.len];
                                RequestContext.WebsocketHandler.broadcast(written_buf) catch |err| {
                                    Output.prettyErrorln("Error writing change notification: {s}<r>", .{@errorName(err)});
                                };
                                if (comptime is_emoji_enabled) {
                                    Output.prettyErrorln("<r>📜  <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(abs_path)});
                                } else {
                                    Output.prettyErrorln("<r>   <d>File change: {s}<r>", .{ctx.bundler.fs.relativeTo(abs_path)});
                                }
                            }
                        }
                    }

                    // if (event.op.delete or event.op.rename)
                    //     ctx.watcher.removeAtIndex(event.index, hashes[event.index], parent_hashes, .directory);
                    if (comptime is_emoji_enabled) {
                        Output.prettyErrorln("<r>📁  <d>Dir change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
                    } else {
                        Output.prettyErrorln("<r>    <d>Dir change: {s}<r>", .{ctx.bundler.fs.relativeTo(file_path)});
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
        var listener = std.net.StreamServer.init(.{
            .kernel_backlog = 1280,
        });
        defer listener.deinit();
        server.websocket_threadpool.stack_size = @truncate(
            u32,
            @min(
                @max(128_000, Fs.FileSystem.RealFS.Limit.stack),
                4_000_000,
            ),
        );

        // listener.setFastOpen(true) catch {};
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
                listener.listen(std.net.Address.initIp4(
                    .{ 0, 0, 0, 0 },
                    port,
                )) catch |err| {
                    switch (err) {
                        error.AddressInUse => {
                            port += 1;
                            continue :restart;
                        },
                        else => {
                            Output.prettyErrorln("<r><red>{s} while trying to start listening on port {d}.\n\n", .{ @errorName(err), port });
                            Global.exit(1);
                        },
                    }
                };

                break :restart;
            }

            if (attempts >= 10) {
                var random_number = std.rand.DefaultPrng.init(@intCast(u64, std.time.milliTimestamp()));
                const default_port = @intCast(u16, server.bundler.options.origin.getPort() orelse 3000);
                Output.prettyErrorln(
                    "<r><red>error<r>: bun can't start because <b>port {d} is already in use<r>. Tried {d} - {d}. Try closing the other apps or manually passing bun a port\n\n  <r><cyan><b>bun --origin http://localhost:{d}/<r>\n",
                    .{
                        default_port,
                        default_port,
                        port,
                        random_number.random().intRangeAtMost(u16, 3011, 65535),
                    },
                );
                Global.exit(1);
            }
        }

        const addr = listener.listen_address;
        if (server.bundler.options.origin.getPort() != addr.getPort()) {
            server.bundler.options.origin = ZigURL.parse(try std.fmt.allocPrint(server.allocator, "{s}://{s}:{d}", .{ server.bundler.options.origin.displayProtocol(), server.bundler.options.origin.displayHostname(), addr.getPort() }));
        }

        const start_time = Global.getStartTime();
        const now = std.time.nanoTimestamp();
        Output.printStartEnd(start_time, now);

        const display_path: string = brk: {
            if (server.bundler.options.routes.single_page_app_routing) {
                const lhs = std.mem.trimRight(u8, server.bundler.fs.top_level_dir, std.fs.path.sep_str);
                const rhs = std.mem.trimRight(u8, server.bundler.options.routes.static_dir, std.fs.path.sep_str);

                if (strings.eql(lhs, rhs)) {
                    break :brk ".";
                }

                break :brk resolve_path.relative(lhs, rhs);
            }

            break :brk "";
        };

        // This is technically imprecise.
        // However, we want to optimize for easy to copy paste
        // Nobody should get weird CORS errors when you go to the printed url.
        if (addr.in.sa.addr == 0) {
            if (server.bundler.options.routes.single_page_app_routing) {
                Output.prettyError(
                    " bun!! <d>v{s}<r>\n\n\n  Link:<r> <b><cyan>http://localhost:{d}<r>\n        <d>{s}/index.html<r> \n\n\n",
                    .{
                        Global.package_json_version_with_sha,
                        addr.getPort(),
                        display_path,
                    },
                );
            } else {
                Output.prettyError(" bun!! <d>v{s}<r>\n\n\n<d>  Link:<r> <b><cyan>http://localhost:{d}<r>\n\n\n", .{
                    Global.package_json_version_with_sha,
                    addr.getPort(),
                });
            }
        } else {
            if (server.bundler.options.routes.single_page_app_routing) {
                Output.prettyError(" bun!! <d>v{s}<r>\n\n\n<d>  Link:<r> <b><cyan>http://{any}<r>\n       <d>{s}/index.html<r> \n\n\n", .{
                    Global.package_json_version_with_sha,
                    addr,
                    display_path,
                });
            } else {
                Output.prettyError(" bun!! <d>v{s}\n\n\n<d>  Link:<r> <b><cyan>http://{any}<r>\n\n\n", .{
                    Global.package_json_version_with_sha,
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
            var conn = listener.accept() catch
                continue;

            disableSIGPIPESoClosingTheTabDoesntCrash(conn.stream);

            // We want to bind to the network socket as quickly as possible so that opening the URL works
            // We use a secondary loop so that we avoid the extra branch in a hot code path
            Analytics.Features.fast_refresh = server.bundler.options.jsx.supports_fast_refresh;
            server.detectTSConfig();
            server.detectFastRefresh();
            try server.initWatcher();
            did_init = true;
            Analytics.enqueue(Analytics.EventName.http_start);

            server.handleConnection(conn.stream, comptime features);
        }

        server.cleanupRequestData();
        var counter: usize = 0;

        while (true) {
            defer Output.flush();
            var conn = listener.accept() catch
                continue;

            disableSIGPIPESoClosingTheTabDoesntCrash(conn.stream);

            server.handleConnection(conn.stream, comptime features);
            counter +%= 1;
            if (counter % 4 == 0) server.cleanupRequestData();
        }
    }

    pub const ConnectionFeatures = struct {
        public_folder: PublicFolderPriority = PublicFolderPriority.none,
        filesystem_router: bool = false,
        single_page_app_routing: bool = false,
        pub const PublicFolderPriority = enum {
            none,
            first,
            last,
        };
    };

    threadlocal var req_ctx_: RequestContext = undefined;
    pub fn handleConnection(server: *Server, conn: std.net.Stream, comptime features: ConnectionFeatures) void {
        var req_buf_node = RequestDataPool.get(server.allocator);

        // https://stackoverflow.com/questions/686217/maximum-on-http-header-values
        var read_size = conn.read(&req_buf_node.data) catch {
            _ = conn.write(comptime RequestContext.printStatusLine(400) ++ "\r\n\r\n") catch {};
            return;
        };

        if (read_size == 0) {
            // Actually, this was not a request.
            return;
        }

        var req = picohttp.Request.parse(req_buf_node.data[0..read_size], &req_headers_buf) catch |err| {
            _ = conn.write(comptime RequestContext.printStatusLine(400) ++ "\r\n\r\n") catch {};
            _ = Syscall.close(conn.handle);
            Output.printErrorln("ERR: {s}", .{@errorName(err)});
            return;
        };

        var request_arena = ThreadlocalArena.init() catch unreachable;
        var request_allocator = request_arena.allocator();
        var req_ctx = request_allocator.create(RequestContext) catch unreachable;

        req_ctx.init(
            req,
            request_arena,
            conn,
            server.bundler,
            server.watcher,
            server.timer,
        ) catch |err| {
            Output.prettyErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
            _ = Syscall.close(conn.handle);
            request_arena.deinit();
            return;
        };

        req_ctx.req_body_node = req_buf_node;
        req_ctx.timer.reset();

        const is_navigation_request = req_ctx.isBrowserNavigation();
        defer if (is_navigation_request == .yes) Analytics.enqueue(Analytics.EventName.http_build);
        req_ctx.parseOrigin();
        // req_ctx.appendHeader("Date", value: string)
        outer: {
            const now = DateTime.Datetime.now();
            req_ctx.appendHeader(
                "Date",
                now.formatHttpBuf(&req_ctx.datetime_buf) catch brk: {
                    break :brk now.formatHttp(req_ctx.allocator) catch break :outer;
                },
            );
        }

        if (req_ctx.url.needs_redirect) {
            req_ctx.handleRedirect(req_ctx.url.path) catch |err| {
                Output.prettyErrorln("<r>[<red>{s}<r>] - <b>{s}<r>: {s}", .{ @errorName(err), req.method, req.path });
                conn.close();
                return;
            };
            return;
        }

        defer {
            if (!req_ctx.controlled) {
                req_ctx.req_body_node.release();
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
                    if (comptime Environment.isDebug) {
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
                                Output.prettyErrorln("<r><green>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            400...499 => {
                                Output.prettyErrorln("<r><yellow>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            else => {
                                Output.prettyErrorln("<r><red>{d}<r><d> {s} <r>{s}<d> as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
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
                                Output.prettyErrorln("<r><green>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            400...499 => {
                                Output.prettyErrorln("<r><yellow>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                            else => {
                                Output.prettyErrorln("<r><red>{d}<r><d> <r>{s}<d> {s} as {s}<r>", .{ status, @tagName(req_ctx.method), req.path, req_ctx.mime_type.value });
                            },
                        }
                    }
                }
            }
        }

        if (comptime FeatureFlags.keep_alive) {
            if (req_ctx.header("Connection")) |connection| {
                req_ctx.keep_alive = strings.eqlInsensitive(connection, "keep-alive");
            }
        } else {
            req_ctx.keep_alive = false;
            req_ctx.appendHeader("Connection", "close");
        }

        var finished = req_ctx.handleReservedRoutes(server) catch |err| {
            Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
            did_print = true;
            return;
        };

        if (!finished) {
            switch (comptime features.public_folder) {
                .none => {
                    if (comptime features.single_page_app_routing) {
                        if (req_ctx.url.isRoot(server.bundler.options.routes.asset_prefix_path)) {
                            req_ctx.sendSinglePageHTML() catch |err| {
                                Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                                did_print = true;
                            };
                            finished = true;
                        }
                    }
                },
                else => {
                    // Check if this is a route to an HTML file in the public folder.
                    // Note: the public folder may actually just be the root folder
                    // In this case, we only check if the pathname has no extension
                    if (!finished) {
                        if (req_ctx.matchPublicFolder(comptime features.public_folder == .last or features.single_page_app_routing)) |result| {
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
            }
        }

        if (comptime features.filesystem_router) {
            if (!finished) {
                req_ctx.bundler.router.?.match(*Server, server, RequestContext, req_ctx) catch |err| {
                    switch (err) {
                        error.ModuleNotFound => {},
                        else => {
                            Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                            did_print = true;
                        },
                    }
                };
                finished = req_ctx.controlled or req_ctx.has_called_done;
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
                    finished = finished or req_ctx.has_called_done;
                }
            }
        }

        if (comptime features.public_folder == .last) {
            if (!finished) {
                if (req_ctx.matchPublicFolder(false)) |result| {
                    finished = true;
                    req_ctx.renderServeResult(result) catch |err| {
                        Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                        did_print = true;
                    };
                }

                finished = finished or req_ctx.has_called_done;
            }
        }

        if (comptime features.single_page_app_routing or features.public_folder != .none) {
            if (!finished and (req_ctx.bundler.options.routes.single_page_app_routing and req_ctx.url.extname.len == 0)) {
                if (!finished) {
                    req_ctx.sendSinglePageHTML() catch |err| {
                        Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                        did_print = true;
                    };
                }
                finished = finished or req_ctx.has_called_done;
            }
        }

        if (!finished) {
            // if we're about to 404 and it's the favicon, use our stand-in
            if (strings.eqlComptime(req_ctx.url.path, "favicon.ico")) {
                req_ctx.sendFavicon() catch |err| {
                    Output.printErrorln("FAIL [{s}] - {s}: {s}", .{ @errorName(err), req.method, req.path });
                    did_print = true;
                };
                return;
            }

            req_ctx.sendNotFound() catch {};
        }
    }

    pub fn initWatcher(server: *Server) !void {
        server.watcher = try Watcher.init(server, server.bundler.fs, server.allocator);

        if (comptime FeatureFlags.watch_directories and !Environment.isTest) {
            server.bundler.resolver.watcher = ResolveWatcher(*Watcher, onMaybeWatchDirectory).init(server.watcher);
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
        if (this.bundler.options.jsx.runtime == .solid)
            return;

        defer this.bundler.resetStore();

        const runtime = this.bundler.options.jsx.refresh_runtime;

        // If there's a .bun, don't even read the filesystem
        // Just use the .bun
        if (this.bundler.options.node_modules_bundle) |node_modules_bundle| {
            const package_name = runtime[0 .. strings.indexOfChar(runtime, '/') orelse runtime.len];
            if (node_modules_bundle.getPackageIDByName(package_name) != null) return;
        }

        _ = this.bundler.resolver.resolve(this.bundler.fs.top_level_dir, this.bundler.options.jsx.importSource(), .internal) catch {
            // if they don't have React, they can't use fast refresh
            this.bundler.options.jsx.supports_fast_refresh = false;
            return;
        };

        this.bundler.options.jsx.supports_fast_refresh = true;
        this.bundler.options.jsx.refresh_runtime = "bun:reactfsh-v0.11.0";
        this.bundler.options.jsx.use_embedded_refresh_runtime = true;
        this.bundler.resolver.opts = this.bundler.options;
    }

    pub fn detectTSConfig(this: *Server) void {
        defer this.bundler.resetStore();

        const dir_info = (this.bundler.resolver.readDirInfo(this.bundler.fs.top_level_dir) catch return) orelse return;

        if (dir_info.package_json) |pkg| {
            Analytics.setProjectID(dir_info.abs_path, pkg.name);
        } else {
            Analytics.setProjectID(dir_info.abs_path, "");
        }

        const tsconfig = dir_info.tsconfig_json orelse return;
        Analytics.Features.tsconfig = true;
        Analytics.Features.tsconfig_paths = tsconfig.paths.count() > 0;
    }

    pub var global_start_time: std.time.Timer = undefined;
    pub fn start(allocator: std.mem.Allocator, options: Api.TransformOptions, comptime DebugType: type, debug: DebugType) !void {
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
        Server.current = server;

        if (debug.dump_environment_variables) {
            server.bundler.dumpEnvironmentVariables();
            return;
        }

        if (debug.dump_limits) {
            Fs.FileSystem.printLimits();
            Global.exit(0);
            return;
        }

        http_editor_context.name = debug.editor;

        server.bundler.options.macro_remap = debug.macros orelse .{};

        if (debug.fallback_only or server.bundler.env.map.get("BUN_DISABLE_BUN_JS") != null) {
            RequestContext.fallback_only = true;
            RequestContext.JavaScriptHandler.javascript_disabled = true;
        }

        Analytics.Features.filesystem_router = server.bundler.router != null;

        const public_folder_is_top_level = server.bundler.options.routes.static_dir_enabled and strings.eql(
            server.bundler.fs.top_level_dir,
            server.bundler.options.routes.static_dir,
        );

        server.websocket_threadpool.on_thread_spawn = RequestContext.WebsocketHandler.onSpawnThread;

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
                ConnectionFeatures{
                    .filesystem_router = true,
                },
            );
        } else if (server.bundler.options.routes.static_dir_enabled) {
            if (server.bundler.options.routes.single_page_app_routing) {
                if (!public_folder_is_top_level) {
                    try server.run(
                        ConnectionFeatures{
                            .public_folder = .first,
                            .single_page_app_routing = true,
                        },
                    );
                } else {
                    try server.run(
                        ConnectionFeatures{
                            .public_folder = .last,
                            .single_page_app_routing = true,
                        },
                    );
                }
            } else {
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
            }
        } else if (server.bundler.options.routes.single_page_app_routing) {
            try server.run(
                ConnectionFeatures{
                    .single_page_app_routing = true,
                },
            );
        } else {
            try server.run(
                ConnectionFeatures{ .filesystem_router = false },
            );
        }
    }
};
