const Bun = @This();
const default_allocator = @import("../../../global.zig").default_allocator;
const bun = @import("../../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../../identity_context.zig").IdentityContext;
const Fs = @import("../../../fs.zig");
const Resolver = @import("../../../resolver/resolver.zig");
const ast = @import("../../../import_record.zig");
const NodeModuleBundle = @import("../../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../../bundler.zig").MacroEntryPoint;
const logger = @import("../../../logger.zig");
const Api = @import("../../../api/schema.zig").Api;
const options = @import("../../../options.zig");
const Bundler = @import("../../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../../js_printer.zig");
const js_parser = @import("../../../js_parser.zig");
const js_ast = @import("../../../js_ast.zig");
const hash_map = @import("../../../hash_map.zig");
const http = @import("../../../http.zig");
const NodeFallbackModules = @import("../../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../../analytics/analytics_thread.zig");
const ZigString = @import("../../../jsc.zig").ZigString;
const Runtime = @import("../../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../../env_loader.zig");
const ParseResult = @import("../../../bundler.zig").ParseResult;
const PackageJSON = @import("../../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const HTTP = @import("http");
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../../jsc.zig").C;
const JSC = @import("../../../jsc.zig");
const JSError = @import("../base.zig").JSError;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("../../../jsc.zig").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("../../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../../jsc.zig").ZigConsoleClient;
const Node = @import("../../../jsc.zig").Node;
const ZigException = @import("../../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../../jsc.zig").Exception;
const ErrorableZigString = @import("../../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../../jsc.zig").ZigGlobalObject;
const VM = @import("../../../jsc.zig").VM;
const JSFunction = @import("../../../jsc.zig").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;
const is_bindgen = JSC.is_bindgen;
const uws = @import("uws");
const Fallback = Runtime.Fallback;
const MimeType = HTTP.MimeType;
const Blob = JSC.WebCore.Blob;
const BoringSSL = @import("boringssl");
const Arena = @import("../../../mimalloc_arena.zig").Arena;
const SendfileContext = struct {
    fd: i32,
    socket_fd: i32 = 0,
    remain: Blob.SizeType = 0,
    offset: Blob.SizeType = 0,
    has_listener: bool = false,
    has_set_on_writable: bool = false,
};
const linux = std.os.linux;

pub const ServerConfig = struct {
    port: u16 = 0,
    hostname: [*:0]const u8 = "0.0.0.0",

    // TODO: use webkit URL parser instead of bun's
    base_url: URL = URL{},
    base_uri: string = "",

    ssl_config: ?SSLConfig = null,
    max_request_body_size: usize = 1024 * 1024 * 128,
    development: bool = false,

    onError: JSC.JSValue = JSC.JSValue.zero,
    onRequest: JSC.JSValue = JSC.JSValue.zero,

    pub const SSLConfig = struct {
        server_name: [*c]const u8 = null,

        key_file_name: [*c]const u8 = null,
        cert_file_name: [*c]const u8 = null,

        ca_file_name: [*c]const u8 = null,
        dh_params_file_name: [*c]const u8 = null,

        passphrase: [*c]const u8 = null,
        low_memory_mode: bool = false,

        pub fn deinit(this: *SSLConfig) void {
            const fields = .{
                "server_name",
                "key_file_name",
                "cert_file_name",
                "ca_file_name",
                "dh_params_file_name",
                "passphrase",
            };

            inline for (fields) |field| {
                const slice = std.mem.span(@field(this, field));
                if (slice.len > 0) {
                    bun.default_allocator.free(slice);
                }
            }
        }

        const zero = SSLConfig{};

        pub fn inJS(global: *JSC.JSGlobalObject, obj: JSC.JSValue, exception: JSC.C.ExceptionRef) ?SSLConfig {
            var result = zero;
            var any = false;

            // Required
            if (obj.getTruthy(global, "keyFile")) |key_file_name| {
                var sliced = key_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.key_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.key_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Unable to access keyFile path", .{}, global.ref(), exception);
                        result.deinit();

                        return null;
                    }
                    any = true;
                }
            }
            if (obj.getTruthy(global, "certFile")) |cert_file_name| {
                var sliced = cert_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.cert_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.cert_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Unable to access certFile path", .{}, global.ref(), exception);
                        result.deinit();
                        return null;
                    }
                    any = true;
                }
            }

            // Optional
            if (any) {
                if (obj.getTruthy(global, "serverName")) |key_file_name| {
                    var sliced = key_file_name.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.server_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    }
                }

                if (obj.getTruthy(global, "caFile")) |ca_file_name| {
                    var sliced = ca_file_name.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.ca_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                        if (std.os.system.access(result.ca_file_name, std.os.F_OK) != 0) {
                            JSC.throwInvalidArguments("Invalid caFile path", .{}, global.ref(), exception);
                            result.deinit();
                            return null;
                        }
                    }
                }
                if (obj.getTruthy(global, "dhParamsFile")) |dh_params_file_name| {
                    var sliced = dh_params_file_name.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.dh_params_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                        if (std.os.system.access(result.dh_params_file_name, std.os.F_OK) != 0) {
                            JSC.throwInvalidArguments("Invalid dhParamsFile path", .{}, global.ref(), exception);
                            result.deinit();
                            return null;
                        }
                    }
                }

                if (obj.getTruthy(global, "passphrase")) |passphrase| {
                    var sliced = passphrase.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.passphrase = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    }
                }

                if (obj.get(global, "lowMemoryMode")) |low_memory_mode| {
                    result.low_memory_mode = low_memory_mode.toBoolean();
                    any = true;
                }
            }

            if (!any)
                return null;
            return result;
        }

        pub fn fromJS(global: *JSC.JSGlobalObject, arguments: *JSC.Node.ArgumentsSlice, exception: JSC.C.ExceptionRef) ?SSLConfig {
            if (arguments.next()) |arg| {
                return SSLConfig.inJS(global, arg, exception);
            }

            return null;
        }
    };

    pub fn fromJS(global: *JSC.JSGlobalObject, arguments: *JSC.Node.ArgumentsSlice, exception: JSC.C.ExceptionRef) ServerConfig {
        var env = VirtualMachine.vm.bundler.env;

        var args = ServerConfig{
            .port = 3000,
            .hostname = "0.0.0.0",
            .development = true,
        };
        var has_hostname = false;
        if (strings.eqlComptime(env.get("NODE_ENV") orelse "", "production")) {
            args.development = false;
        }

        if (VirtualMachine.vm.bundler.options.production) {
            args.development = false;
        }

        const PORT_ENV = .{ "PORT", "BUN_PORT" };

        inline for (PORT_ENV) |PORT| {
            if (env.get(PORT)) |port| {
                if (std.fmt.parseInt(u16, port, 10)) |_port| {
                    args.port = _port;
                } else |_| {}
            }
        }

        if (VirtualMachine.vm.bundler.options.transform_options.port) |port| {
            args.port = port;
        }

        if (VirtualMachine.vm.bundler.options.transform_options.origin) |origin| {
            args.base_uri = origin;
        }

        if (arguments.next()) |arg| {
            if (arg.isUndefinedOrNull() or !arg.isObject()) {
                JSC.throwInvalidArguments("Bun.serve expects an object", .{}, global.ref(), exception);
                return args;
            }

            if (arg.getTruthy(global, "port")) |port_| {
                args.port = @intCast(u16, @minimum(@maximum(0, port_.toInt32()), std.math.maxInt(u16)));
            }

            if (arg.getTruthy(global, "baseURI")) |baseURI| {
                var sliced = baseURI.toSlice(global, bun.default_allocator);

                if (sliced.len > 0) {
                    defer sliced.deinit();
                    args.base_uri = bun.default_allocator.dupe(u8, sliced.slice()) catch unreachable;
                }
            }

            if (arg.getTruthy(global, "hostname") orelse arg.getTruthy(global, "host")) |host| {
                const host_str = host.toSlice(
                    global,
                    bun.default_allocator,
                );
                if (host_str.len > 0) {
                    args.hostname = bun.default_allocator.dupeZ(u8, host_str.slice()) catch unreachable;
                    has_hostname = true;
                }
            }

            if (arg.get(global, "development")) |dev| {
                args.development = dev.toBoolean();
            }

            if (SSLConfig.fromJS(global, arguments, exception)) |ssl_config| {
                args.ssl_config = ssl_config;
            }

            if (exception.* != null) {
                return args;
            }

            if (arg.getTruthy(global, "maxRequestBodySize")) |max_request_body_size| {
                args.max_request_body_size = @intCast(u64, @maximum(0, max_request_body_size.toInt64()));
            }

            if (arg.getTruthy(global, "error")) |onError| {
                if (!onError.isCallable(global.vm())) {
                    JSC.throwInvalidArguments("Expected error to be a function", .{}, global.ref(), exception);
                    if (args.ssl_config) |*conf| {
                        conf.deinit();
                    }
                    return args;
                }
                JSC.C.JSValueProtect(global.ref(), onError.asObjectRef());
                args.onError = onError;
            }

            if (arg.getTruthy(global, "fetch")) |onRequest| {
                if (!onRequest.isCallable(global.vm())) {
                    JSC.throwInvalidArguments("Expected fetch() to be a function", .{}, global.ref(), exception);
                    return args;
                }
                JSC.C.JSValueProtect(global.ref(), onRequest.asObjectRef());
                args.onRequest = onRequest;
            } else {
                JSC.throwInvalidArguments("Expected fetch() to be a function", .{}, global.ref(), exception);
                if (args.ssl_config) |*conf| {
                    conf.deinit();
                }
                return args;
            }
        }

        if (args.port == 0) {
            JSC.throwInvalidArguments("Invalid port: must be > 0", .{}, global.ref(), exception);
        }

        if (args.base_uri.len > 0) {
            args.base_url = URL.parse(args.base_uri);
            if (args.base_url.hostname.len == 0) {
                JSC.throwInvalidArguments("baseURI must have a hostname", .{}, global.ref(), exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            if (!strings.isAllASCII(args.base_uri)) {
                JSC.throwInvalidArguments("Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.", .{}, global.ref(), exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            if (args.base_url.protocol.len == 0) {
                const protocol: string = if (args.ssl_config != null) "https" else "http";

                args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/{s}", .{
                        protocol,
                        args.base_url.hostname,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })
                else
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/{s}", .{
                        protocol,
                        args.base_url.hostname,
                        args.port,
                        strings.trimLeadingChar(args.base_url.pathname, '/'),
                    })) catch unreachable;

                args.base_url = URL.parse(args.base_uri);
            }
        } else {
            const hostname: string =
                if (has_hostname and std.mem.span(args.hostname).len > 0) std.mem.span(args.hostname) else "localhost";
            const protocol: string = if (args.ssl_config != null) "https" else "http";

            args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/", .{
                    protocol,
                    hostname,
                })
            else
                std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/", .{ protocol, hostname, args.port })) catch unreachable;

            if (!strings.isAllASCII(hostname)) {
                JSC.throwInvalidArguments("Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.", .{}, global.ref(), exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            args.base_url = URL.parse(args.base_uri);
        }

        // I don't think there's a case where this can happen
        // but let's check anyway, just in case
        if (args.base_url.hostname.len == 0) {
            JSC.throwInvalidArguments("baseURI must have a hostname", .{}, global.ref(), exception);
            bun.default_allocator.free(bun.constStrToU8(args.base_uri));
            args.base_uri = "";
            return args;
        }

        if (args.base_url.username.len > 0 or args.base_url.password.len > 0) {
            JSC.throwInvalidArguments("baseURI can't have a username or password", .{}, global.ref(), exception);
            bun.default_allocator.free(bun.constStrToU8(args.base_uri));
            args.base_uri = "";
            return args;
        }

        return args;
    }
};

// This is defined separately partially to work-around an LLVM debugger bug.
fn NewRequestContext(comptime ssl_enabled: bool, comptime debug_mode: bool, comptime ThisServer: type) type {
    return struct {
        const RequestContext = @This();
        const App = uws.NewApp(ssl_enabled);
        pub threadlocal var pool: ?*RequestContext.RequestContextStackAllocator = null;
        pub threadlocal var pool_allocator: std.mem.Allocator = undefined;

        server: *ThisServer,
        resp: *App.Response,
        /// thread-local default heap allocator
        /// this prevents an extra pthread_getspecific() call which shows up in profiling
        allocator: std.mem.Allocator,
        req: *uws.Request,
        url: string,
        method: HTTP.Method,
        aborted: bool = false,

        has_marked_complete: bool = false,
        response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
        response_ptr: ?*JSC.WebCore.Response = null,
        blob: JSC.WebCore.Blob = JSC.WebCore.Blob{},
        promise: ?*JSC.JSValue = null,
        response_headers: ?*JSC.FetchHeaders = null,
        has_abort_handler: bool = false,
        has_sendfile_ctx: bool = false,
        has_called_error_handler: bool = false,
        needs_content_length: bool = false,
        sendfile: SendfileContext = undefined,
        request_js_object: JSC.C.JSObjectRef = null,
        request_body_buf: std.ArrayListUnmanaged(u8) = .{},
        /// Used either for temporary blob data or fallback
        /// When the response body is a temporary value
        response_buf_owned: std.ArrayListUnmanaged(u8) = .{},

        // Pre-allocate up to 2048 requests
        // use a bitset to track which ones are used
        pub const RequestContextStackAllocator = struct {
            buf: [2048]RequestContext = undefined,
            unused: Set = undefined,
            fallback_allocator: std.mem.Allocator = undefined,

            pub const Set = std.bit_set.ArrayBitSet(usize, 2048);

            pub fn get(this: *@This()) std.mem.Allocator {
                this.unused = Set.initFull();
                return std.mem.Allocator.init(this, alloc, resize, free);
            }

            fn alloc(self: *@This(), a: usize, b: u29, c: u29, d: usize) ![]u8 {
                if (self.unused.findFirstSet()) |i| {
                    self.unused.unset(i);
                    return std.mem.asBytes(&self.buf[i]);
                }

                return try self.fallback_allocator.rawAlloc(a, b, c, d);
            }

            fn resize(
                _: *@This(),
                _: []u8,
                _: u29,
                _: usize,
                _: u29,
                _: usize,
            ) ?usize {
                unreachable;
            }

            fn sliceContainsSlice(container: []u8, slice: []u8) bool {
                return @ptrToInt(slice.ptr) >= @ptrToInt(container.ptr) and
                    (@ptrToInt(slice.ptr) + slice.len) <= (@ptrToInt(container.ptr) + container.len);
            }

            fn free(
                self: *@This(),
                buf: []u8,
                buf_align: u29,
                return_address: usize,
            ) void {
                _ = buf_align;
                _ = return_address;
                const bytes = std.mem.asBytes(&self.buf);
                if (sliceContainsSlice(bytes, buf)) {
                    const index = if (bytes[0..buf.len].ptr != buf.ptr)
                        (@ptrToInt(buf.ptr) - @ptrToInt(bytes)) / @sizeOf(RequestContext)
                    else
                        @as(usize, 0);

                    if (comptime Environment.allow_assert) {
                        std.debug.assert(@intToPtr(*RequestContext, @ptrToInt(buf.ptr)) == &self.buf[index]);
                        std.debug.assert(!self.unused.isSet(index));
                    }

                    self.unused.set(index);
                } else {
                    self.fallback_allocator.rawFree(buf, buf_align, return_address);
                }
            }
        };

        // TODO: support builtin compression
        const can_sendfile = !ssl_enabled;

        pub fn setAbortHandler(this: *RequestContext) void {
            if (this.has_abort_handler) return;
            this.has_abort_handler = true;
            this.resp.onAborted(*RequestContext, RequestContext.onAbort, this);
        }

        pub fn onResolve(
            ctx: *RequestContext,
            _: *JSC.JSGlobalObject,
            arguments: []const JSC.JSValue,
        ) void {
            if (ctx.aborted) {
                ctx.finalize();
                return;
            }

            if (arguments.len == 0) {
                ctx.renderMissing();
                return;
            }

            handleResolve(ctx, arguments[0]);
        }

        fn handleResolve(ctx: *RequestContext, value: JSC.JSValue) void {
            if (value.isEmptyOrUndefinedOrNull()) {
                ctx.renderMissing();
                return;
            }

            var response = value.as(JSC.WebCore.Response) orelse {
                Output.prettyErrorln("Expected a Response object", .{});
                Output.flush();
                ctx.renderMissing();
                return;
            };
            ctx.response_jsvalue = value;
            JSC.C.JSValueProtect(ctx.server.globalThis.ref(), value.asObjectRef());

            ctx.render(response);
        }

        pub fn onReject(
            ctx: *RequestContext,
            _: *JSC.JSGlobalObject,
            arguments: []const JSC.JSValue,
        ) void {
            if (ctx.aborted) {
                ctx.finalize();
                return;
            }

            handleReject(ctx, if (arguments.len > 0) arguments[0] else JSC.JSValue.jsUndefined());
        }

        fn handleReject(ctx: *RequestContext, value: JSC.JSValue) void {
            ctx.runErrorHandler(
                value,
            );

            if (ctx.aborted) {
                ctx.finalize();
                return;
            }

            if (!ctx.resp.hasResponded()) {
                ctx.renderMissing();
            }
        }

        pub fn renderMissing(ctx: *RequestContext) void {
            if (comptime !debug_mode) {
                ctx.resp.writeStatus("204 No Content");
                ctx.resp.endWithoutBody();
                ctx.finalize();
            } else {
                ctx.resp.writeStatus("200 OK");
                ctx.resp.end("Welcome to Bun! To get started, return a Response object.", false);
                ctx.finalize();
            }
        }

        pub fn renderDefaultError(
            this: *RequestContext,
            log: *logger.Log,
            err: anyerror,
            exceptions: []Api.JsException,
            comptime fmt: string,
            args: anytype,
        ) void {
            this.resp.writeStatus("500 Internal Server Error");
            this.resp.writeHeader("content-type", MimeType.html.value);

            const allocator = this.allocator;

            var fallback_container = allocator.create(Api.FallbackMessageContainer) catch unreachable;
            defer allocator.destroy(fallback_container);
            fallback_container.* = Api.FallbackMessageContainer{
                .message = std.fmt.allocPrint(allocator, comptime Output.prettyFmt(fmt, false), args) catch unreachable,
                .router = null,
                .reason = .fetch_event_handler,
                .cwd = VirtualMachine.vm.bundler.fs.top_level_dir,
                .problems = Api.Problems{
                    .code = @truncate(u16, @errorToInt(err)),
                    .name = @errorName(err),
                    .exceptions = exceptions,
                    .build = log.toAPI(allocator) catch unreachable,
                },
            };

            if (comptime fmt.len > 0) Output.prettyErrorln(fmt, args);
            Output.flush();

            var bb = std.ArrayList(u8).init(allocator);
            var bb_writer = bb.writer();

            Fallback.renderBackend(
                allocator,
                fallback_container,
                @TypeOf(bb_writer),
                bb_writer,
            ) catch unreachable;
            if (this.resp.tryEnd(bb.items, bb.items.len)) {
                bb.clearAndFree();
                this.finalizeWithoutDeinit();
                return;
            }

            this.response_buf_owned = std.ArrayListUnmanaged(u8){ .items = bb.items, .capacity = bb.capacity };
            this.renderResponseBuffer();
        }

        pub fn renderResponseBuffer(this: *RequestContext) void {
            this.resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
        }

        pub fn onWritableResponseBuffer(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            if (this.aborted) {
                this.finalize();
                return false;
            }
            return this.sendWritableBytes(this.response_buf_owned.items, write_offset, resp);
        }

        pub fn create(this: *RequestContext, server: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            this.* = .{
                .allocator = server.allocator,
                .resp = resp,
                .req = req,
                // this memory is owned by the Request object
                .url = strings.append(this.allocator, server.base_url_string_for_joining, req.url()) catch
                    @panic("Out of memory while joining the URL path?"),
                .method = HTTP.Method.which(req.method()) orelse .GET,
                .server = server,
            };
        }

        pub fn onAbort(this: *RequestContext, _: *App.Response) void {
            this.aborted = true;
            this.finalizeWithoutDeinit();
            this.markComplete();
        }

        pub fn markComplete(this: *RequestContext) void {
            if (!this.has_marked_complete) this.server.onRequestComplete();
            this.has_marked_complete = true;
        }

        // This function may be called multiple times
        // so it's important that we can safely do that
        pub fn finalizeWithoutDeinit(this: *RequestContext) void {
            this.blob.detach();
            this.request_body_buf.clearAndFree(this.allocator);

            if (!this.response_jsvalue.isEmpty()) {
                this.server.response_objects_pool.push(this.server.globalThis, this.response_jsvalue);
                this.response_jsvalue = JSC.JSValue.zero;
            }

            if (this.request_js_object != null) {
                // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                // but we received nothing
                if (JSC.JSValue.fromRef(this.request_js_object).as(Request)) |req| {
                    if (req.body == .Locked and req.body.Locked.action != .none and req.body.Locked.promise != null) {
                        var old_body = req.body;
                        req.body = JSC.WebCore.Body.Value.empty;
                        old_body.Locked.callback = null;
                        old_body.resolve(&req.body, this.server.globalThis);
                        VirtualMachine.vm.tick();
                    }
                    req.uws_request = null;
                    JSC.C.JSValueUnprotect(this.server.globalThis.ref(), this.request_js_object);
                    this.request_js_object = null;
                }
            }

            if (this.promise != null) {
                JSC.C.JSValueUnprotect(this.server.globalThis.ref(), this.promise.?.asObjectRef());
                this.promise = null;
            }

            if (this.response_headers != null) {
                this.response_headers.?.deref();
                this.response_headers = null;
            }

            this.response_buf_owned.clearAndFree(this.allocator);
        }
        pub fn finalize(this: *RequestContext) void {
            var server = this.server;
            this.finalizeWithoutDeinit();
            this.markComplete();
            server.request_pool_allocator.destroy(this);
        }

        fn writeHeaders(
            this: *RequestContext,
            headers: *JSC.FetchHeaders,
        ) void {
            headers.remove(&ZigString.init("content-length"));
            headers.remove(&ZigString.init("transfer-encoding"));
            if (!ssl_enabled) headers.remove(&ZigString.init("strict-transport-security"));
            headers.toUWSResponse(ssl_enabled, this.resp);
        }

        pub fn writeStatus(this: *RequestContext, status: u16) void {
            var status_text_buf: [48]u8 = undefined;

            if (status == 302) {
                this.resp.writeStatus("302 Found");
            } else {
                this.resp.writeStatus(std.fmt.bufPrint(&status_text_buf, "{d} HM", .{status}) catch unreachable);
            }
        }

        fn cleanupAndFinalizeAfterSendfile(this: *RequestContext) void {
            this.resp.setWriteOffset(this.sendfile.offset);
            this.resp.endWithoutBody();
            // use node syscall so that we don't segfault on BADF
            _ = JSC.Node.Syscall.close(this.sendfile.fd);
            this.sendfile = undefined;
            this.finalize();
        }
        const separator: string = "\r\n";
        const separator_iovec = [1]std.os.iovec_const{.{
            .iov_base = separator.ptr,
            .iov_len = separator.len,
        }};

        pub fn onSendfile(this: *RequestContext) bool {
            if (this.aborted) {
                this.cleanupAndFinalizeAfterSendfile();
                return false;
            }

            const adjusted_count_temporary = @minimum(@as(u64, this.sendfile.remain), @as(u63, std.math.maxInt(u63)));
            // TODO we should not need this int cast; improve the return type of `@minimum`
            const adjusted_count = @intCast(u63, adjusted_count_temporary);

            if (Environment.isLinux) {
                var signed_offset = @intCast(i64, this.sendfile.offset);
                const start = this.sendfile.offset;
                const val =
                    // this does the syscall directly, without libc
                    linux.sendfile(this.sendfile.socket_fd, this.sendfile.fd, &signed_offset, this.sendfile.remain);
                this.sendfile.offset = @intCast(Blob.SizeType, signed_offset);

                const errcode = linux.getErrno(val);

                this.sendfile.remain -= @intCast(Blob.SizeType, this.sendfile.offset - start);

                if (errcode != .SUCCESS or this.aborted or this.sendfile.remain == 0 or val == 0) {
                    if (errcode != .SUCCESS) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode != .SUCCESS;
                }
            } else {
                var sbytes: std.os.off_t = adjusted_count;
                const signed_offset = @bitCast(i64, @as(u64, this.sendfile.offset));

                const errcode = std.c.getErrno(std.c.sendfile(
                    this.sendfile.fd,
                    this.sendfile.socket_fd,

                    signed_offset,
                    &sbytes,
                    null,
                    0,
                ));
                const wrote = @intCast(Blob.SizeType, sbytes);
                this.sendfile.offset += wrote;
                this.sendfile.remain -= wrote;
                if (errcode != .AGAIN or this.aborted or this.sendfile.remain == 0 or sbytes == 0) {
                    if (errcode != .AGAIN and errcode != .SUCCESS) {
                        Output.prettyErrorln("Error: {s}", .{@tagName(errcode)});
                        Output.flush();
                    }
                    this.cleanupAndFinalizeAfterSendfile();
                    return errcode == .SUCCESS;
                }
            }

            if (!this.sendfile.has_set_on_writable) {
                this.sendfile.has_set_on_writable = true;
                this.resp.onWritable(*RequestContext, onWritableSendfile, this);
            }

            this.resp.markNeedsMore();

            return true;
        }

        pub fn onWritableBytes(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            if (this.aborted) {
                this.finalize();
                return false;
            }

            var bytes = this.blob.sharedView();
            return this.sendWritableBytes(bytes, write_offset, resp);
        }

        pub fn sendWritableBytes(this: *RequestContext, bytes_: []const u8, write_offset: c_ulong, resp: *App.Response) bool {
            var bytes = bytes_[@minimum(bytes_.len, @truncate(usize, write_offset))..];
            if (resp.tryEnd(bytes, bytes_.len)) {
                this.finalize();
                return true;
            } else {
                this.resp.onWritable(*RequestContext, onWritableBytes, this);
                return true;
            }
        }

        pub fn onWritableSendfile(this: *RequestContext, _: c_ulong, _: *App.Response) callconv(.C) bool {
            return this.onSendfile();
        }

        pub fn onPrepareSendfileWrap(this: *anyopaque, fd: i32, size: Blob.SizeType, err: ?JSC.SystemError, globalThis: *JSGlobalObject) void {
            onPrepareSendfile(bun.cast(*RequestContext, this), fd, size, err, globalThis);
        }

        fn onPrepareSendfile(this: *RequestContext, fd: i32, size: Blob.SizeType, err: ?JSC.SystemError, globalThis: *JSGlobalObject) void {
            if (err) |system_error| {
                if (this.aborted) {
                    this.finalize();
                    return;
                }

                if (system_error.errno == @enumToInt(std.os.E.NOENT)) {
                    this.runErrorHandlerWithStatusCode(system_error.toErrorInstance(globalThis), 404);
                } else {
                    this.runErrorHandlerWithStatusCode(system_error.toErrorInstance(globalThis), 500);
                }

                return;
            }

            this.blob.size = size;
            this.needs_content_length = true;

            this.sendfile = .{
                .fd = fd,
                .remain = size,
                .socket_fd = if (!this.aborted) this.resp.getNativeHandle() else -999,
            };

            if (this.aborted) {
                _ = JSC.Node.Syscall.close(fd);
                this.finalize();
                return;
            }

            this.resp.runCorked(*RequestContext, renderMetadata, this);

            if (size == 0) {
                this.cleanupAndFinalizeAfterSendfile();
                return;
            }

            this.setAbortHandler();

            // TODO: fix this to be MSGHDR
            _ = std.os.write(this.sendfile.socket_fd, "\r\n") catch 0;

            _ = this.onSendfile();
        }

        pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
            JSC.WebCore.Blob.doOpenAndStatFile(
                &this.blob,
                *RequestContext,
                this,
                onPrepareSendfileWrap,
                blob.globalThis,
            );
        }

        pub fn doSendfile(this: *RequestContext, blob: Blob) void {
            if (this.aborted) {
                this.finalize();
                return;
            }

            if (this.has_sendfile_ctx) return;

            this.has_sendfile_ctx = true;
            this.setAbortHandler();

            if (comptime can_sendfile) {
                return this.renderSendFile(blob);
            }

            this.blob.doReadFileInternal(*RequestContext, this, onReadFile, this.server.globalThis);
        }

        pub fn onReadFile(this: *RequestContext, result: Blob.Store.ReadFile.ResultType) void {
            if (this.aborted) {
                this.finalize();
                return;
            }

            if (result == .err) {
                this.runErrorHandler(result.err.toErrorInstance(this.server.globalThis));
                return;
            }

            const is_temporary = result.result.is_temporary;
            if (!is_temporary) {
                this.blob.resolveSize();
                this.doRenderBlob();
            } else {
                this.blob.size = @truncate(Blob.SizeType, result.result.buf.len);
                this.response_buf_owned = .{ .items = result.result.buf, .capacity = result.result.buf.len };
                this.renderResponseBuffer();
            }
        }

        pub fn doRenderWithBodyLocked(this: *anyopaque, value: *JSC.WebCore.Body.Value) void {
            doRenderWithBody(bun.cast(*RequestContext, this), value);
        }

        pub fn doRenderWithBody(this: *RequestContext, value: *JSC.WebCore.Body.Value) void {
            switch (value.*) {
                .Error => {
                    const err = value.Error;
                    _ = value.use();
                    if (this.aborted) {
                        this.finalize();
                        return;
                    }
                    this.runErrorHandler(err);
                    return;
                },
                .Blob => {
                    this.blob = value.use();

                    if (this.aborted) {
                        this.finalize();
                        return;
                    }

                    if (this.blob.needsToReadFile()) {
                        this.req.setYield(false);
                        this.setAbortHandler();
                        if (!this.has_sendfile_ctx)
                            this.doSendfile(this.blob);
                        return;
                    }
                },
                // TODO: this needs to support streaming!
                .Locked => |*lock| {
                    lock.callback = doRenderWithBodyLocked;
                    lock.task = this;
                    return;
                },
                else => {},
            }

            this.doRenderBlob();
        }

        pub fn doRenderBlob(this: *RequestContext) void {
            if (this.has_abort_handler)
                this.resp.runCorked(*RequestContext, renderMetadata, this)
            else
                this.renderMetadata();

            this.renderBytes();
        }

        pub fn doRender(this: *RequestContext) void {
            if (this.aborted) {
                this.finalize();
                return;
            }
            var response = this.response_ptr.?;
            this.doRenderWithBody(&response.body.value);
        }

        pub fn renderProductionError(this: *RequestContext, status: u16) void {
            switch (status) {
                404 => {
                    this.resp.writeStatus("404 Not Found");
                    this.resp.endWithoutBody();
                },
                else => {
                    this.resp.writeStatus("500 Internal Server Error");
                    this.resp.writeHeader("content-type", "text/plain");
                    this.resp.end("Something went wrong!", true);
                },
            }

            this.finalize();
        }

        pub fn runErrorHandler(
            this: *RequestContext,
            value: JSC.JSValue,
        ) void {
            runErrorHandlerWithStatusCode(this, value, 500);
        }

        pub fn runErrorHandlerWithStatusCode(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            if (this.resp.hasResponded()) return;

            var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(this.allocator);
            defer exception_list.deinit();
            if (!this.server.config.onError.isEmpty() and !this.has_called_error_handler) {
                this.has_called_error_handler = true;
                var args = [_]JSC.C.JSValueRef{value.asObjectRef()};
                const result = JSC.C.JSObjectCallAsFunctionReturnValue(this.server.globalThis.ref(), this.server.config.onError.asObjectRef(), this.server.thisObject.asObjectRef(), 1, &args);

                if (!result.isEmptyOrUndefinedOrNull()) {
                    if (result.isError() or result.isAggregateError(this.server.globalThis)) {
                        this.runErrorHandler(result);
                        return;
                    } else if (result.as(Response)) |response| {
                        this.render(response);
                        return;
                    }
                }
            }

            if (comptime debug_mode) {
                JSC.VirtualMachine.vm.defaultErrorHandler(value, &exception_list);

                this.renderDefaultError(
                    JSC.VirtualMachine.vm.log,
                    error.ExceptionOcurred,
                    exception_list.toOwnedSlice(),
                    "<r><red>{s}<r> - <b>{s}<r> failed",
                    .{ std.mem.span(@tagName(this.method)), this.url },
                );
            } else {
                if (status != 404)
                    JSC.VirtualMachine.vm.defaultErrorHandler(value, &exception_list);
                this.renderProductionError(status);
            }
            JSC.VirtualMachine.vm.log.reset();
            return;
        }

        pub fn renderMetadata(this: *RequestContext) void {
            var response: *JSC.WebCore.Response = this.response_ptr.?;
            var status = response.statusCode();
            const size = this.blob.size;
            status = if (status == 200 and size == 0)
                204
            else
                status;

            this.writeStatus(status);
            var needs_content_type = true;
            const content_type: MimeType = brk: {
                if (response.body.init.headers) |headers_| {
                    if (headers_.get("content-type")) |content| {
                        needs_content_type = false;
                        break :brk MimeType.init(content);
                    }
                }
                break :brk if (this.blob.content_type.len > 0)
                    MimeType.init(this.blob.content_type)
                else if (MimeType.sniff(this.blob.sharedView())) |content|
                    content
                else if (this.blob.is_all_ascii orelse false)
                    MimeType.text
                else
                    MimeType.other;
            };

            var has_content_disposition = false;

            if (response.body.init.headers) |headers_| {
                this.writeHeaders(headers_);
                has_content_disposition = headers_.has(&ZigString.init("content-disposition"));
                response.body.init.headers = null;
                headers_.deref();
            }

            if (needs_content_type) {
                this.resp.writeHeader("content-type", content_type.value);
            }

            // automatically include the filename when:
            // 1. Bun.file("foo")
            // 2. The content-disposition header is not present
            if (!has_content_disposition and content_type.category.autosetFilename()) {
                if (this.blob.store) |store| {
                    if (store.data == .file) {
                        if (store.data.file.pathlike == .path) {
                            const basename = std.fs.path.basename(store.data.file.pathlike.path.slice());
                            if (basename.len > 0) {
                                var filename_buf: [1024]u8 = undefined;

                                this.resp.writeHeader(
                                    "content-disposition",
                                    std.fmt.bufPrint(&filename_buf, "filename=\"{s}\"", .{basename[0..@minimum(basename.len, 1024 - 32)]}) catch "",
                                );
                            }
                        }
                    }
                }
            }

            if (this.needs_content_length) {
                this.resp.writeHeaderInt("content-length", size);
                this.needs_content_length = false;
            }
        }

        pub fn renderBytes(this: *RequestContext) void {
            const bytes = this.blob.sharedView();

            if (!this.resp.tryEnd(
                bytes,
                bytes.len,
            )) {
                this.resp.onWritable(*RequestContext, onWritableBytes, this);
                return;
            }

            this.finalize();
        }

        pub fn render(this: *RequestContext, response: *JSC.WebCore.Response) void {
            this.response_ptr = response;

            this.doRender();
        }

        pub fn resolveRequestBody(this: *RequestContext) void {
            if (this.aborted) {
                this.finalize();
                return;
            }

            if (JSC.JSValue.fromRef(this.request_js_object).as(Request)) |req| {
                var bytes = this.request_body_buf.toOwnedSlice(this.allocator);
                var old = req.body;
                req.body = .{
                    .Blob = if (bytes.len > 0)
                        Blob.init(bytes, this.allocator, this.server.globalThis)
                    else
                        Blob.initEmpty(this.server.globalThis),
                };
                old.resolve(&req.body, this.server.globalThis);
                VirtualMachine.vm.tick();
                return;
            }
        }

        pub fn onBodyChunk(this: *RequestContext, _: *App.Response, chunk: []const u8, last: bool) void {
            if (this.aborted) return;
            this.request_body_buf.appendSlice(this.allocator, chunk) catch @panic("Out of memory while allocating request body");
            if (last) {
                if (JSC.JSValue.fromRef(this.request_js_object).as(Request) != null) {
                    uws.Loop.get().?.nextTick(*RequestContext, this, resolveRequestBody);
                } else {
                    this.request_body_buf.deinit(this.allocator);
                    this.request_body_buf = .{};
                }
            }
        }

        pub fn onRequestData(this: *RequestContext) void {
            if (this.req.header("content-length")) |content_length| {
                const len = std.fmt.parseInt(usize, content_length, 10) catch 0;
                if (len == 0) {
                    if (JSC.JSValue.fromRef(this.request_js_object).as(Request)) |req| {
                        var old = req.body;
                        old.Locked.callback = null;
                        req.body = .{ .Empty = .{} };
                        old.resolve(&req.body, this.server.globalThis);
                        VirtualMachine.vm.tick();
                        return;
                    }
                }

                if (len >= this.server.config.max_request_body_size) {
                    if (JSC.JSValue.fromRef(this.request_js_object).as(Request)) |req| {
                        var old = req.body;
                        old.Locked.callback = null;
                        req.body = .{ .Empty = .{} };
                        old.toError(error.RequestBodyTooLarge, this.server.globalThis);
                        VirtualMachine.vm.tick();
                        return;
                    }

                    this.resp.writeStatus("413 Request Entity Too Large");
                    this.resp.endWithoutBody();
                    this.finalize();
                    return;
                }

                this.request_body_buf.ensureTotalCapacityPrecise(this.allocator, len) catch @panic("Out of memory while allocating request body buffer");
            }
            this.setAbortHandler();

            this.resp.onData(*RequestContext, onBodyChunk, this);
        }

        pub fn onRequestDataCallback(this: *anyopaque) void {
            onRequestData(bun.cast(*RequestContext, this));
        }
    };
}

pub fn NewServer(comptime ssl_enabled_: bool, comptime debug_mode_: bool) type {
    return struct {
        const ssl_enabled = ssl_enabled_;
        const debug_mode = debug_mode_;

        const ThisServer = @This();
        pub const RequestContext = NewRequestContext(ssl_enabled, debug_mode, @This());

        pub const App = uws.NewApp(ssl_enabled);

        listener: ?*App.ListenSocket = null,
        thisObject: JSC.JSValue = JSC.JSValue.zero,
        app: *App = undefined,
        vm: *JSC.VirtualMachine = undefined,
        globalThis: *JSGlobalObject,
        base_url_string_for_joining: string = "",
        response_objects_pool: JSC.WebCore.Response.Pool = JSC.WebCore.Response.Pool{},
        config: ServerConfig = ServerConfig{},
        pending_requests: usize = 0,
        request_pool_allocator: std.mem.Allocator = undefined,
        has_js_deinited: bool = false,
        listen_callback: JSC.AnyTask = undefined,
        allocator: std.mem.Allocator,

        pub const Class = JSC.NewClass(
            ThisServer,
            .{ .name = "Server" },
            .{
                .stop = .{
                    .rfn = JSC.wrapSync(ThisServer, "stopFromJS"),
                },
                .finalize = .{
                    .rfn = finalize,
                },
            },
            .{
                .port = .{
                    .get = JSC.getterWrap(ThisServer, "getPort"),
                },
                .hostname = .{
                    .get = JSC.getterWrap(ThisServer, "getHostname"),
                },
                .development = .{
                    .get = JSC.getterWrap(ThisServer, "getDevelopment"),
                },
                .pendingRequests = .{
                    .get = JSC.getterWrap(ThisServer, "getPendingRequests"),
                },
            },
        );

        pub fn stopFromJS(this: *ThisServer) JSC.JSValue {
            if (this.listener != null) {
                JSC.C.JSValueUnprotect(this.globalThis.ref(), this.thisObject.asObjectRef());
                this.thisObject = JSC.JSValue.jsUndefined();
                this.stop();
            }

            return JSC.JSValue.jsUndefined();
        }

        pub fn getPort(this: *ThisServer) JSC.JSValue {
            return JSC.JSValue.jsNumber(this.config.port);
        }

        pub fn getPendingRequests(this: *ThisServer) JSC.JSValue {
            return JSC.JSValue.jsNumber(@intCast(i32, @truncate(u31, this.pending_requests)));
        }

        pub fn getHostname(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            return ZigString.init(this.config.base_uri).toValue(globalThis);
        }

        pub fn getDevelopment(
            _: *ThisServer,
        ) JSC.JSValue {
            return JSC.JSValue.jsBoolean(debug_mode);
        }

        pub fn onRequestComplete(this: *ThisServer) void {
            this.pending_requests -= 1;
            this.deinitIfWeCan();
        }

        pub fn finalize(this: *ThisServer) void {
            this.has_js_deinited = true;
            this.deinitIfWeCan();
        }

        pub fn deinitIfWeCan(this: *ThisServer) void {
            if (this.pending_requests == 0 and this.listener == null and this.has_js_deinited)
                this.deinit();
        }

        pub fn stop(this: *ThisServer) void {
            if (this.listener) |listener| {
                listener.close();
                this.listener = null;
            }

            this.deinitIfWeCan();
        }

        pub fn deinit(this: *ThisServer) void {
            if (this.vm.response_objects_pool) |pool| {
                if (pool == &this.response_objects_pool) {
                    this.vm.response_objects_pool = null;
                }
            }

            // if you run multiple servers simultaneously, this could break it
            if (this.vm.uws_event_loop != null and uws.Loop.get().? == this.vm.uws_event_loop.?) {
                this.vm.uws_event_loop = null;
            }

            this.app.destroy();
            const allocator = this.allocator;
            allocator.destroy(this);
        }

        pub fn init(config: ServerConfig, globalThis: *JSGlobalObject) *ThisServer {
            var server = bun.default_allocator.create(ThisServer) catch @panic("Out of memory!");
            server.* = .{
                .globalThis = globalThis,
                .config = config,
                .base_url_string_for_joining = strings.trim(config.base_url.href, "/"),
                .vm = JSC.VirtualMachine.vm,
                .allocator = Arena.getThreadlocalDefault(),
            };
            if (RequestContext.pool == null) {
                RequestContext.pool = server.allocator.create(RequestContext.RequestContextStackAllocator) catch @panic("Out of memory!");
                RequestContext.pool.?.* = .{
                    .fallback_allocator = server.allocator,
                };
                server.request_pool_allocator = RequestContext.pool.?.get();
                RequestContext.pool_allocator = server.request_pool_allocator;
            } else {
                server.request_pool_allocator = RequestContext.pool_allocator;
            }

            return server;
        }

        noinline fn onListenFailed(this: *ThisServer) void {
            var zig_str: ZigString = ZigString.init("Failed to start server");
            if (comptime ssl_enabled) {
                var output_buf: [4096]u8 = undefined;
                output_buf[0] = 0;
                var written: usize = 0;
                var ssl_error = BoringSSL.ERR_get_error();
                while (ssl_error != 0 and written < output_buf.len) : (ssl_error = BoringSSL.ERR_get_error()) {
                    if (written > 0) {
                        output_buf[written] = '\n';
                        written += 1;
                    }

                    if (BoringSSL.ERR_reason_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len == 0) {
                            break;
                        }
                        @memcpy(output_buf[written..].ptr, reason.ptr, reason.len);
                        written += reason.len;
                    }

                    if (BoringSSL.ERR_func_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len > 0) {
                            output_buf[written..][0.." via ".len].* = " via ".*;
                            written += " via ".len;
                            @memcpy(output_buf[written..].ptr, reason.ptr, reason.len);
                            written += reason.len;
                        }
                    }

                    if (BoringSSL.ERR_lib_error_string(
                        ssl_error,
                    )) |reason_ptr| {
                        const reason = std.mem.span(reason_ptr);
                        if (reason.len > 0) {
                            output_buf[written..][0] = ' ';
                            written += 1;
                            @memcpy(output_buf[written..].ptr, reason.ptr, reason.len);
                            written += reason.len;
                        }
                    }
                }

                if (written > 0) {
                    var message = output_buf[0..written];
                    zig_str = ZigString.init(std.fmt.allocPrint(bun.default_allocator, "OpenSSL {s}", .{message}) catch unreachable);
                    zig_str.withEncoding().mark();
                }
            }
            // store the exception in here
            this.thisObject = zig_str.toErrorInstance(this.globalThis);
            return;
        }

        pub fn onListen(this: *ThisServer, socket: ?*App.ListenSocket, _: uws.uws_app_listen_config_t) void {
            if (socket == null) {
                return this.onListenFailed();
            }

            this.listener = socket;
            const needs_post_handler = this.vm.uws_event_loop == null;
            this.vm.uws_event_loop = uws.Loop.get();
            this.vm.response_objects_pool = &this.response_objects_pool;
            this.listen_callback = JSC.AnyTask.New(ThisServer, run).init(this);
            this.vm.eventLoop().enqueueTask(JSC.Task.init(&this.listen_callback));
            if (needs_post_handler) {
                _ = this.vm.uws_event_loop.?.addPostHandler(*JSC.VirtualMachine.EventLoop, this.vm.eventLoop(), JSC.VirtualMachine.EventLoop.tick);
            }
        }

        pub fn run(this: *ThisServer) void {
            // this.app.addServerName(hostname_pattern: [*:0]const u8)
            this.app.run();
        }

        pub fn onBunInfoRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;
            this.pending_requests += 1;
            defer this.pending_requests -= 1;
            req.setYield(false);
            var stack_fallback = std.heap.stackFallback(8096, this.allocator);
            var allocator = stack_fallback.get();

            var buffer_writer = js_printer.BufferWriter.init(allocator) catch unreachable;
            var writer = js_printer.BufferPrinter.init(buffer_writer);
            defer writer.ctx.buffer.deinit();
            var source = logger.Source.initEmptyFile("info.json");
            _ = js_printer.printJSON(
                *js_printer.BufferPrinter,
                &writer,
                bun.Global.BunInfo.generate(*Bundler, &JSC.VirtualMachine.vm.bundler, allocator) catch unreachable,
                &source,
            ) catch unreachable;

            resp.writeStatus("200 OK");
            resp.writeHeader("Content-Type", MimeType.json.value);
            resp.writeHeader("Cache-Control", "public, max-age=3600");
            resp.writeHeaderInt("Age", 0);
            const buffer = writer.ctx.written;
            resp.end(buffer, false);
        }

        pub fn onSrcRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;
            this.pending_requests += 1;
            defer this.pending_requests -= 1;
            req.setYield(false);
            if (req.header("open-in-editor") == null) {
                resp.writeStatus("501 Not Implemented");
                resp.end("Viewing source without opening in editor is not implemented yet!", false);
                return;
            }

            var ctx = &JSC.VirtualMachine.vm.rareData().editor_context;
            ctx.autoDetectEditor(JSC.VirtualMachine.vm.bundler.env);
            var line: ?string = req.header("editor-line");
            var column: ?string = req.header("editor-column");

            if (ctx.editor) |editor| {
                resp.writeStatus("200 Opened");
                resp.end("Opened in editor", false);
                var url = req.url()["/src:".len..];
                if (strings.indexOfChar(url, ':')) |colon| {
                    url = url[0..colon];
                }
                editor.open(ctx.path, url, line, column, this.allocator) catch Output.prettyErrorln("Failed to open editor", .{});
            } else {
                resp.writeStatus("500 Missing Editor :(");
                resp.end("Please set your editor in bunfig.toml", false);
            }
        }

        pub fn onRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;
            this.pending_requests += 1;
            var vm = this.vm;
            req.setYield(false);
            var ctx = this.request_pool_allocator.create(RequestContext) catch @panic("ran out of memory");
            ctx.create(this, req, resp);

            var request_object = this.allocator.create(JSC.WebCore.Request) catch unreachable;
            request_object.* = .{
                .url = JSC.ZigString.init(ctx.url),
                .method = ctx.method,
                .uws_request = req,
                .body = .{
                    .Locked = .{
                        .task = ctx,
                        .global = this.globalThis,
                        .onRequestData = RequestContext.onRequestDataCallback,
                    },
                },
            };
            request_object.url.mark();
            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.C.JSValueRef{JSC.WebCore.Request.Class.make(this.globalThis.ref(), request_object)};
            ctx.request_js_object = args[0];
            JSC.C.JSValueProtect(this.globalThis.ref(), args[0]);
            const response_value = JSC.C.JSObjectCallAsFunctionReturnValue(this.globalThis.ref(), this.config.onRequest.asObjectRef(), this.thisObject.asObjectRef(), 1, &args);

            if (ctx.aborted) {
                ctx.finalize();
                return;
            }

            if (response_value.isEmptyOrUndefinedOrNull() and !ctx.resp.hasResponded()) {
                ctx.renderMissing();
                return;
            }

            if (response_value.isError() or response_value.isAggregateError(this.globalThis) or response_value.isException(this.globalThis.vm())) {
                ctx.runErrorHandler(response_value);
                return;
            }

            if (response_value.as(JSC.WebCore.Response)) |response| {
                JSC.C.JSValueProtect(this.globalThis.ref(), response_value.asObjectRef());
                ctx.response_jsvalue = response_value;

                ctx.render(response);
                return;
            }

            var wait_for_promise = false;

            if (response_value.asPromise()) |promise| {
                // If we immediately have the value available, we can skip the extra event loop tick
                switch (promise.status(vm.global.vm())) {
                    .Pending => {},
                    .Fulfilled => {
                        ctx.handleResolve(promise.result(vm.global.vm()));
                        return;
                    },
                    .Rejected => {
                        ctx.handleReject(promise.result(vm.global.vm()));
                        return;
                    },
                }
                wait_for_promise = true;
                // I don't think this case should happen
                // But I'm uncertain
            } else if (response_value.asInternalPromise()) |promise| {
                switch (promise.status(vm.global.vm())) {
                    .Pending => {},
                    .Fulfilled => {
                        ctx.handleResolve(promise.result(vm.global.vm()));
                        return;
                    },
                    .Rejected => {
                        ctx.handleReject(promise.result(vm.global.vm()));
                        return;
                    },
                }
                wait_for_promise = true;
            }

            if (wait_for_promise) {
                ctx.setAbortHandler();
                response_value.then(
                    this.globalThis,
                    RequestContext,
                    ctx,
                    RequestContext.onResolve,
                    RequestContext.onReject,
                );
                return;
            }

            // The user returned something that wasn't a promise or a promise with a response
            if (!ctx.resp.hasResponded()) ctx.renderMissing();
        }

        pub fn listen(this: *ThisServer) void {
            if (ssl_enabled) {
                BoringSSL.load();
                const ssl_config = this.config.ssl_config orelse @panic("Assertion failure: ssl_config");
                this.app = App.create(.{
                    .key_file_name = ssl_config.key_file_name,
                    .cert_file_name = ssl_config.cert_file_name,
                    .passphrase = ssl_config.passphrase,
                    .dh_params_file_name = ssl_config.dh_params_file_name,
                    .ca_file_name = ssl_config.ca_file_name,
                    .ssl_prefer_low_memory_usage = @as(c_int, @boolToInt(ssl_config.low_memory_mode)),
                });

                if (ssl_config.server_name != null and std.mem.span(ssl_config.server_name).len > 0) {
                    this.app.addServerName(ssl_config.server_name);
                }
            } else {
                this.app = App.create(.{});
            }

            this.app.any("/*", *ThisServer, this, onRequest);

            if (comptime debug_mode) {
                this.app.get("/bun:info", *ThisServer, this, onBunInfoRequest);
                this.app.get("/src:/*", *ThisServer, this, onSrcRequest);
            }

            this.app.listenWithConfig(*ThisServer, this, onListen, .{
                .port = this.config.port,
                .host = this.config.hostname,
                .options = 0,
            });
        }
    };
}

pub const Server = NewServer(false, false);
pub const SSLServer = NewServer(true, false);
pub const DebugServer = NewServer(false, true);
pub const DebugSSLServer = NewServer(true, true);
