const Bun = @This();
const default_allocator = @import("../../global.zig").default_allocator;
const bun = @import("../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../bundler.zig").MacroEntryPoint;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../js_printer.zig");
const js_parser = @import("../../js_parser.zig");
const js_ast = @import("../../js_ast.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("javascript_core").ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = @import("../../bundler.zig").ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("javascript_core").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const HTTP = @import("http");
const FetchEvent = WebCore.FetchEvent;
const js = @import("javascript_core").C;
const JSC = @import("javascript_core");
const JSError = @import("../base.zig").JSError;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("javascript_core").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("javascript_core").Microtask;
const JSGlobalObject = @import("javascript_core").JSGlobalObject;
const ExceptionValueRef = @import("javascript_core").ExceptionValueRef;
const JSPrivateDataPtr = @import("javascript_core").JSPrivateDataPtr;
const ZigConsoleClient = @import("javascript_core").ZigConsoleClient;
const Node = @import("javascript_core").Node;
const ZigException = @import("javascript_core").ZigException;
const ZigStackTrace = @import("javascript_core").ZigStackTrace;
const ErrorableResolvedSource = @import("javascript_core").ErrorableResolvedSource;
const ResolvedSource = @import("javascript_core").ResolvedSource;
const JSPromise = @import("javascript_core").JSPromise;
const JSInternalPromise = @import("javascript_core").JSInternalPromise;
const JSModuleLoader = @import("javascript_core").JSModuleLoader;
const JSPromiseRejectionOperation = @import("javascript_core").JSPromiseRejectionOperation;
const Exception = @import("javascript_core").Exception;
const ErrorableZigString = @import("javascript_core").ErrorableZigString;
const ZigGlobalObject = @import("javascript_core").ZigGlobalObject;
const VM = @import("javascript_core").VM;
const JSFunction = @import("javascript_core").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;
const is_bindgen = JSC.is_bindgen;
const uws = @import("uws");
const Fallback = Runtime.Fallback;
const MimeType = HTTP.MimeType;
const Blob = JSC.WebCore.Blob;
const BoringSSL = @import("boringssl");
const Arena = @import("../../mimalloc_arena.zig").Arena;
const SendfileContext = struct {
    fd: i32,
    socket_fd: i32 = 0,
    remain: Blob.SizeType = 0,
    offset: Blob.SizeType = 0,
    has_listener: bool = false,
    has_set_on_writable: bool = false,
    auto_close: bool = false,
};
const DateTime = @import("datetime");
const linux = std.os.linux;

pub const ServerConfig = struct {
    port: u16 = 0,
    hostname: [*:0]const u8 = "localhost",

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
                if (@field(this, field) != null) {
                    const slice = std.mem.span(@field(this, field));
                    if (slice.len > 0) {
                        bun.default_allocator.free(slice);
                    }
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
        var env = arguments.vm.bundler.env;

        var args = ServerConfig{
            .port = 3000,
            .hostname = "0.0.0.0",
            .development = true,
        };
        var has_hostname = false;
        if (strings.eqlComptime(env.get("NODE_ENV") orelse "", "production")) {
            args.development = false;
        }

        if (arguments.vm.bundler.options.production) {
            args.development = false;
        }

        const PORT_ENV = .{ "PORT", "BUN_PORT", "NODE_PORT" };

        inline for (PORT_ENV) |PORT| {
            if (env.get(PORT)) |port| {
                if (std.fmt.parseInt(u16, port, 10)) |_port| {
                    args.port = _port;
                } else |_| {}
            }
        }

        if (arguments.vm.bundler.options.transform_options.port) |port| {
            args.port = port;
        }

        if (arguments.vm.bundler.options.transform_options.origin) |origin| {
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
                if (has_hostname and std.mem.span(args.hostname).len > 0) std.mem.span(args.hostname) else "0.0.0.0";
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

pub fn NewRequestContextStackAllocator(comptime RequestContext: type, comptime count: usize) type {
    // Pre-allocate up to 2048 requests
    // use a bitset to track which ones are used
    return struct {
        buf: [count]RequestContext = undefined,
        unused: Set = undefined,
        fallback_allocator: std.mem.Allocator = undefined,

        pub const Set = std.bit_set.ArrayBitSet(usize, count);

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
}

// This is defined separately partially to work-around an LLVM debugger bug.
fn NewRequestContext(comptime ssl_enabled: bool, comptime debug_mode: bool, comptime ThisServer: type) type {
    return struct {
        const RequestContext = @This();
        const App = uws.NewApp(ssl_enabled);
        pub threadlocal var pool: ?*RequestContext.RequestContextStackAllocator = null;
        pub threadlocal var pool_allocator: std.mem.Allocator = undefined;
        pub const ResponseStream = JSC.WebCore.HTTPServerWritable(ssl_enabled);
        pub const RequestContextStackAllocator = NewRequestContextStackAllocator(RequestContext, 2048);
        pub const name = "HTTPRequestContext" ++ (if (debug_mode) "Debug" else "") ++ (if (ThisServer.ssl_enabled) "TLS" else "");
        pub const shim = JSC.Shimmer("Bun", name, @This());

        server: *ThisServer,
        resp: *App.Response,
        /// thread-local default heap allocator
        /// this prevents an extra pthread_getspecific() call which shows up in profiling
        allocator: std.mem.Allocator,
        req: *uws.Request,
        url: string,
        method: HTTP.Method,
        aborted: bool = false,
        finalized: bun.DebugOnly(bool) = bun.DebugOnlyDefault(false),

        /// We can only safely free once the request body promise is finalized
        /// and the response is rejected
        pending_promises_for_abort: u8 = 0,

        has_marked_complete: bool = false,
        response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
        response_protected: bool = false,
        response_ptr: ?*JSC.WebCore.Response = null,
        blob: JSC.WebCore.Blob = JSC.WebCore.Blob{},
        promise: ?*JSC.JSValue = null,
        has_abort_handler: bool = false,
        has_sendfile_ctx: bool = false,
        has_called_error_handler: bool = false,
        needs_content_length: bool = false,
        sendfile: SendfileContext = undefined,
        request_js_object: JSC.C.JSObjectRef = null,
        request_body_buf: std.ArrayListUnmanaged(u8) = .{},
        request_body_content_len: usize = 0,
        sink: ?*ResponseStream.JSSink = null,
        byte_stream: ?*JSC.WebCore.ByteStream = null,

        has_written_status: bool = false,

        /// Used either for temporary blob data or fallback
        /// When the response body is a temporary value
        response_buf_owned: std.ArrayListUnmanaged(u8) = .{},

        // TODO: support builtin compression
        const can_sendfile = !ssl_enabled;

        pub fn setAbortHandler(this: *RequestContext) void {
            if (this.has_abort_handler) return;
            this.has_abort_handler = true;
            this.resp.onAborted(*RequestContext, RequestContext.onAbort, this);
        }

        pub fn onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const arguments = callframe.arguments(2);
            var ctx = arguments.ptr[1].asPromisePtr(@This());
            const result = arguments.ptr[0];
            ctx.pending_promises_for_abort -|= 1;
            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return JSValue.jsUndefined();
            }

            if (result.isEmptyOrUndefinedOrNull()) {
                ctx.renderMissing();
                return JSValue.jsUndefined();
            }

            handleResolve(ctx, result);
            return JSValue.jsUndefined();
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

        pub fn finalizeForAbort(this: *RequestContext) void {
            this.pending_promises_for_abort -|= 1;
            if (this.pending_promises_for_abort == 0) this.finalize();
        }

        pub fn onReject(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const arguments = callframe.arguments(2);
            var ctx = arguments.ptr[1].asPromisePtr(@This());
            const err = arguments.ptr[0];

            ctx.pending_promises_for_abort -|= 1;

            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return JSValue.jsUndefined();
            }
            handleReject(ctx, if (!err.isEmptyOrUndefinedOrNull()) err else JSC.JSValue.jsUndefined());
            return JSValue.jsUndefined();
        }

        fn handleReject(ctx: *RequestContext, value: JSC.JSValue) void {
            const has_responded = ctx.resp.hasResponded();
            if (!has_responded)
                ctx.runErrorHandler(
                    value,
                );

            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return;
            }
            if (!ctx.resp.hasResponded()) {
                ctx.renderMissing();
                return;
            }
        }

        pub fn renderMissing(ctx: *RequestContext) void {
            if (comptime !debug_mode) {
                if (!ctx.has_written_status)
                    ctx.resp.writeStatus("204 No Content");
                ctx.has_written_status = true;
                ctx.resp.endWithoutBody();
                ctx.finalize();
            } else {
                if (!ctx.has_written_status)
                    ctx.resp.writeStatus("200 OK");
                ctx.has_written_status = true;
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
            if (!this.has_written_status) {
                this.has_written_status = true;

                this.resp.writeStatus("500 Internal Server Error");
                this.resp.writeHeader("content-type", MimeType.html.value);
            }

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
            this.resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
        }

        pub fn renderResponseBuffer(this: *RequestContext) void {
            this.resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
        }

        /// Render a complete response buffer
        pub fn renderResponseBufferAndMetadata(this: *RequestContext) void {
            this.renderMetadata();

            if (!this.resp.tryEnd(
                this.response_buf_owned.items,
                this.response_buf_owned.items.len,
            )) {
                this.resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
                this.setAbortHandler();
                return;
            }

            this.finalize();
        }

        /// Drain a partial response buffer
        pub fn drainResponseBufferAndMetadata(this: *RequestContext) void {
            this.renderMetadata();
            this.setAbortHandler();

            _ = this.resp.write(
                this.response_buf_owned.items,
            );

            this.response_buf_owned.items.len = 0;
        }

        pub fn renderResponseBufferAndMetadataCorked(this: *RequestContext) void {
            this.resp.runCorkedWithType(*RequestContext, renderResponseBufferAndMetadata, this);
        }

        pub fn drainResponseBufferAndMetadataCorked(this: *RequestContext) void {
            this.resp.runCorkedWithType(*RequestContext, drainResponseBufferAndMetadata, this);
        }

        pub fn onWritableResponseBuffer(this: *RequestContext, _: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);
            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }
            resp.end("", false);
            this.finalize();
            return false;
        }

        pub fn onWritableCompleteResponseBuffer(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);
            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }
            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
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

        pub fn isDeadRequest(this: *RequestContext) bool {
            if (this.pending_promises_for_abort > 0) return false;

            if (this.promise != null) {
                return false;
            }

            if (this.request_js_object) |obj| {
                if (obj.value().as(Request)) |req| {
                    if (req.body == .Locked) {
                        return false;
                    }
                }
            }

            return true;
        }

        pub fn onAbort(this: *RequestContext, resp: *App.Response) void {
            std.debug.assert(this.resp == resp);
            std.debug.assert(!this.aborted);
            this.aborted = true;

            // if we can, free the request now.
            if (this.isDeadRequest()) {
                this.finalizeWithoutDeinit();
                this.markComplete();
                this.deinit();
            } else {
                this.pending_promises_for_abort = 0;

                // if we cannot, we have to reject pending promises
                // first, we reject the request body promise
                if (this.request_js_object != null) {
                    var request_js = this.request_js_object.?.value();
                    request_js.ensureStillAlive();

                    this.request_js_object = null;
                    defer request_js.ensureStillAlive();
                    defer JSC.C.JSValueUnprotect(this.server.globalThis.ref(), request_js.asObjectRef());
                    // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                    // but we received nothing or the connection was aborted
                    if (request_js.as(Request)) |req| {
                        // the promise is pending
                        if (req.body == .Locked and (req.body.Locked.action != .none or req.body.Locked.promise != null)) {
                            this.pending_promises_for_abort += 1;
                            req.body.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                        } else if (req.body == .Locked and (req.body.Locked.readable != null)) {
                            req.body.Locked.readable.?.abort(this.server.globalThis);
                            req.body.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                            req.body.Locked.readable = null;
                        }
                        req.uws_request = null;
                    }
                }

                if (this.response_ptr) |response| {
                    if (response.body.value == .Locked) {
                        if (response.body.value.Locked.readable) |*readable| {
                            response.body.value.Locked.readable = null;
                            readable.abort(this.server.globalThis);
                        }
                    }
                }

                // then, we reject the response promise
                if (this.promise) |promise| {
                    this.pending_promises_for_abort += 1;
                    this.promise = null;
                    promise.asPromise().?.reject(this.server.globalThis, JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis));
                }

                if (this.pending_promises_for_abort > 0) {
                    this.server.vm.tick();
                }
            }
        }

        pub fn markComplete(this: *RequestContext) void {
            if (!this.has_marked_complete) this.server.onRequestComplete();
            this.has_marked_complete = true;
        }

        // This function may be called multiple times
        // so it's important that we can safely do that
        pub fn finalizeWithoutDeinit(this: *RequestContext) void {
            this.blob.detach();

            if (comptime Environment.allow_assert) {
                std.debug.assert(!this.finalized);
                this.finalized = true;
            }

            if (!this.response_jsvalue.isEmpty()) {
                if (this.response_protected) {
                    this.response_jsvalue.unprotect();
                    this.response_protected = false;
                }
                this.response_jsvalue = JSC.JSValue.zero;
            }

            if (this.request_js_object != null) {
                var request_js = this.request_js_object.?.value();
                request_js.ensureStillAlive();

                this.request_js_object = null;
                defer request_js.ensureStillAlive();
                defer JSC.C.JSValueUnprotect(this.server.globalThis.ref(), request_js.asObjectRef());
                // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                // but we received nothing or the connection was aborted
                if (request_js.as(Request)) |req| {
                    // the promise is pending
                    if (req.body == .Locked and req.body.Locked.action != .none and req.body.Locked.promise != null) {
                        req.body.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                    }
                    req.uws_request = null;
                }
            }

            if (this.promise) |promise| {
                this.promise = null;

                if (promise.asInternalPromise()) |prom| {
                    prom.rejectAsHandled(this.server.globalThis, (JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis)));
                } else if (promise.asPromise()) |prom| {
                    prom.rejectAsHandled(this.server.globalThis, (JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis)));
                }
                JSC.C.JSValueUnprotect(this.server.globalThis.ref(), promise.asObjectRef());
            }

            if (this.byte_stream) |stream| {
                this.byte_stream = null;
                stream.unpipe();
            }
        }
        pub fn finalize(this: *RequestContext) void {
            this.finalizeWithoutDeinit();
            this.markComplete();
            this.deinit();
        }

        pub fn deinit(this: *RequestContext) void {
            if (comptime Environment.allow_assert)
                std.debug.assert(this.finalized);

            if (comptime Environment.allow_assert)
                std.debug.assert(this.has_marked_complete);

            var server = this.server;
            this.request_body_buf.clearAndFree(this.allocator);
            this.response_buf_owned.clearAndFree(this.allocator);

            server.request_pool_allocator.destroy(this);
        }

        fn writeHeaders(
            this: *RequestContext,
            headers: *JSC.FetchHeaders,
        ) void {
            headers.fastRemove(.ContentLength);
            headers.fastRemove(.TransferEncoding);
            if (!ssl_enabled) headers.fastRemove(.StrictTransportSecurity);
            headers.toUWSResponse(ssl_enabled, this.resp);
        }

        pub fn writeStatus(this: *RequestContext, status: u16) void {
            var status_text_buf: [48]u8 = undefined;
            std.debug.assert(!this.has_written_status);
            this.has_written_status = true;

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
            if (this.sendfile.auto_close)
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
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE) {
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
                    if (errcode != .AGAIN and errcode != .SUCCESS and errcode != .PIPE) {
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

            this.setAbortHandler();
            this.resp.markNeedsMore();

            return true;
        }

        pub fn onWritableBytes(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);
            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }

            var bytes = this.blob.sharedView();
            _ = this.sendWritableBytesForBlob(bytes, write_offset, resp);
            return true;
        }

        pub fn sendWritableBytesForBlob(this: *RequestContext, bytes_: []const u8, write_offset: c_ulong, resp: *App.Response) bool {
            std.debug.assert(this.resp == resp);

            var bytes = bytes_[@minimum(bytes_.len, @truncate(usize, write_offset))..];
            if (resp.tryEnd(bytes, bytes_.len)) {
                this.finalize();
                return true;
            } else {
                this.resp.onWritable(*RequestContext, onWritableBytes, this);
                return true;
            }
        }

        pub fn sendWritableBytesForCompleteResponseBuffer(this: *RequestContext, bytes_: []const u8, write_offset: c_ulong, resp: *App.Response) bool {
            std.debug.assert(this.resp == resp);

            var bytes = bytes_[@minimum(bytes_.len, @truncate(usize, write_offset))..];
            if (resp.tryEnd(bytes, bytes_.len)) {
                this.response_buf_owned.items.len = 0;
                this.finalize();
            } else {
                this.resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }

            return true;
        }

        pub fn onWritableSendfile(this: *RequestContext, _: c_ulong, _: *App.Response) callconv(.C) bool {
            return this.onSendfile();
        }

        // We tried open() in another thread for this
        // it was not faster due to the mountain of syscalls
        pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
            this.blob = blob;
            const file = &this.blob.store.?.data.file;
            var file_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            const auto_close = file.pathlike != .fd;
            const fd = if (!auto_close)
                file.pathlike.fd
            else switch (JSC.Node.Syscall.open(file.pathlike.path.sliceZ(&file_buf), std.os.O.RDONLY | std.os.O.NONBLOCK | std.os.O.CLOEXEC, 0)) {
                .result => |_fd| _fd,
                .err => |err| return this.runErrorHandler(err.withPath(file.pathlike.path.slice()).toSystemError().toErrorInstance(
                    this.server.globalThis,
                )),
            };

            // stat only blocks if the target is a file descriptor
            const stat: std.os.Stat = switch (JSC.Node.Syscall.fstat(fd)) {
                .result => |result| result,
                .err => |err| {
                    this.runErrorHandler(err.withPath(file.pathlike.path.slice()).toSystemError().toErrorInstance(
                        this.server.globalThis,
                    ));
                    if (auto_close) {
                        _ = JSC.Node.Syscall.close(fd);
                    }
                    return;
                },
            };

            if (Environment.isMac) {
                if (!std.os.S.ISREG(stat.mode)) {
                    if (auto_close) {
                        _ = JSC.Node.Syscall.close(fd);
                    }

                    var err = JSC.Node.Syscall.Error{
                        .errno = @intCast(JSC.Node.Syscall.Error.Int, @enumToInt(std.os.E.INVAL)),
                        .path = file.pathlike.path.slice(),
                        .syscall = .sendfile,
                    };
                    var sys = err.toSystemError();
                    sys.message = ZigString.init("MacOS does not support sending non-regular files");
                    this.runErrorHandler(sys.toErrorInstance(
                        this.server.globalThis,
                    ));
                    return;
                }
            }

            if (Environment.isLinux) {
                if (!(std.os.S.ISREG(stat.mode) or std.os.S.ISFIFO(stat.mode))) {
                    if (auto_close) {
                        _ = JSC.Node.Syscall.close(fd);
                    }

                    var err = JSC.Node.Syscall.Error{
                        .errno = @intCast(JSC.Node.Syscall.Error.Int, @enumToInt(std.os.E.INVAL)),
                        .path = file.pathlike.path.slice(),
                        .syscall = .sendfile,
                    };
                    var sys = err.toSystemError();
                    sys.message = ZigString.init("File must be regular or FIFO");
                    this.runErrorHandler(sys.toErrorInstance(
                        this.server.globalThis,
                    ));
                    return;
                }
            }

            this.blob.size = @intCast(Blob.SizeType, stat.size);
            this.needs_content_length = true;

            this.sendfile = .{
                .fd = fd,
                .remain = this.blob.size,
                .auto_close = auto_close,
                .socket_fd = if (!this.aborted) this.resp.getNativeHandle() else -999,
            };

            this.resp.runCorkedWithType(*RequestContext, renderMetadataAndNewline, this);

            if (this.blob.size == 0) {
                this.cleanupAndFinalizeAfterSendfile();
                return;
            }

            _ = this.onSendfile();
        }

        pub fn renderMetadataAndNewline(this: *RequestContext) void {
            this.renderMetadata();
            this.resp.prepareForSendfile();
        }

        pub fn doSendfile(this: *RequestContext, blob: Blob) void {
            if (this.aborted) {
                this.finalizeForAbort();
                return;
            }

            if (this.has_sendfile_ctx) return;

            this.has_sendfile_ctx = true;

            if (comptime can_sendfile) {
                return this.renderSendFile(blob);
            }

            this.setAbortHandler();
            this.blob.doReadFileInternal(*RequestContext, this, onReadFile, this.server.globalThis);
        }

        pub fn onReadFile(this: *RequestContext, result: Blob.Store.ReadFile.ResultType) void {
            if (this.aborted) {
                this.finalizeForAbort();
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
                this.resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }
        }

        pub fn doRenderWithBodyLocked(this: *anyopaque, value: *JSC.WebCore.Body.Value) void {
            doRenderWithBody(bun.cast(*RequestContext, this), value);
        }

        fn renderWithBlobFromBodyValue(this: *RequestContext) void {
            if (this.aborted) {
                this.finalizeForAbort();
                return;
            }

            if (this.blob.needsToReadFile()) {
                this.req.setYield(false);
                if (!this.has_sendfile_ctx)
                    this.doSendfile(this.blob);
                return;
            }

            this.doRenderBlob();
        }

        const StreamPair = struct { this: *RequestContext, stream: JSC.WebCore.ReadableStream };

        fn doRenderStream(pair: *StreamPair) void {
            var this = pair.this;
            var stream = pair.stream;
            // uWS automatically adds the status line if needed
            // we want to batch network calls as much as possible
            if (!(this.response_ptr.?.statusCode() == 200 and this.response_ptr.?.body.init.headers == null)) {
                this.renderMetadata();
            }

            stream.value.ensureStillAlive();

            var response_stream = this.allocator.create(ResponseStream.JSSink) catch unreachable;
            response_stream.* = ResponseStream.JSSink{
                .sink = .{
                    .res = this.resp,
                    .allocator = this.allocator,
                    .buffer = bun.ByteList.init(""),
                },
            };
            var signal = &response_stream.sink.signal;
            this.sink = response_stream;

            signal.* = ResponseStream.JSSink.SinkSignal.init(JSValue.zero);

            // explicitly set it to a dead pointer
            // we use this memory address to disable signals being sent
            signal.clear();
            std.debug.assert(signal.isDead());

            // We are already corked!
            const assignment_result: JSValue = ResponseStream.JSSink.assignToStream(
                this.server.globalThis,
                stream.value,
                response_stream,
                @ptrCast(**anyopaque, &signal.ptr),
            );

            assignment_result.ensureStillAlive();
            // assert that it was updated
            std.debug.assert(!signal.isDead());

            if (comptime Environment.allow_assert) {
                if (this.resp.hasResponded()) {
                    streamLog("responded", .{});
                }
            }

            this.aborted = this.aborted or response_stream.sink.aborted;

            if (assignment_result.isAnyError(this.server.globalThis)) {
                streamLog("returned an error", .{});
                if (!this.aborted) this.resp.clearAborted();
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                stream.value.unprotect();
                return this.handleReject(assignment_result);
            }

            if (response_stream.sink.done or
                // TODO: is there a condition where resp could be freed before done?
                this.resp.hasResponded())
            {
                if (!this.aborted) this.resp.clearAborted();
                const wrote_anything = response_stream.sink.wrote > 0;
                streamLog("is done", .{});
                const responded = this.resp.hasResponded();

                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                if (!responded and !wrote_anything and !this.aborted) {
                    this.renderMissing();
                    return;
                } else if (wrote_anything and !responded and !this.aborted) {
                    this.resp.endStream(false);
                }

                this.finalize();
                stream.value.unprotect();

                return;
            }

            if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                assignment_result.ensureStillAlive();
                // it returns a Promise when it goes through ReadableStreamDefaultReader
                if (assignment_result.asPromise()) |promise| {
                    streamLog("returned a promise", .{});
                    switch (promise.status(this.server.globalThis.vm())) {
                        .Pending => {
                            // TODO: should this timeout?
                            this.resp.onAborted(*ResponseStream, ResponseStream.onAborted, &response_stream.sink);
                            this.response_ptr.?.body.value = .{
                                .Locked = .{
                                    .readable = stream,
                                    .global = this.server.globalThis,
                                },
                            };
                            assignment_result.then(
                                this.server.globalThis,
                                this,
                                onResolveStream,
                                onRejectStream,
                            );
                            // the response_stream should be GC'd

                        },
                        .Fulfilled => {
                            this.handleResolveStream();
                        },
                        .Rejected => {
                            this.handleRejectStream(this.server.globalThis, promise.result(this.server.globalThis.vm()));
                        },
                    }
                    return;
                }
            }

            if (this.aborted) {
                response_stream.detach();
                stream.cancel(this.server.globalThis);
                response_stream.sink.done = true;
                this.finalizeForAbort();

                response_stream.sink.finalize();
                stream.value.unprotect();
                return;
            }

            stream.value.ensureStillAlive();

            if (!stream.isLocked(this.server.globalThis)) {
                streamLog("is not locked", .{});
                this.renderMissing();
                return;
            }

            this.resp.onAborted(*ResponseStream, ResponseStream.onAborted, &response_stream.sink);
            streamLog("is in progress, but did not return a Promise. Finalizing request context", .{});
            this.finalize();
            stream.value.unprotect();
        }

        const streamLog = Output.scoped(.ReadableStream, false);

        pub fn handleResolveStream(req: *RequestContext) void {
            streamLog("onResolve", .{});
            var wrote_anything = false;
            if (req.sink) |wrapper| {
                wrapper.sink.pending_flush = null;
                wrapper.sink.done = true;
                req.aborted = req.aborted or wrapper.sink.aborted;
                wrote_anything = wrapper.sink.wrote > 0;
                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                if (resp.body.value == .Locked) {
                    resp.body.value.Locked.readable.?.done();
                    resp.body.value = .{ .Used = {} };
                }
            }

            if (req.aborted) {
                req.finalizeForAbort();
                return;
            }

            const responded = req.resp.hasResponded();

            if (!responded and !wrote_anything) {
                req.resp.clearAborted();
                req.renderMissing();
                return;
            } else if (!responded and wrote_anything and !req.aborted) {
                req.resp.clearAborted();
                req.resp.endStream(false);
            }

            req.finalize();
        }

        pub fn onResolveStream(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            var args = callframe.arguments(2);
            var req: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
            req.handleResolveStream();
            return JSValue.jsUndefined();
        }
        pub fn onRejectStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const args = callframe.arguments(2);
            var req = args.ptr[args.len - 1].asPromisePtr(@This());
            var err = args.ptr[0];
            req.handleRejectStream(globalThis, err);
            return JSValue.jsUndefined();
        }

        pub fn handleRejectStream(req: *@This(), globalThis: *JSC.JSGlobalObject, err: JSValue) void {
            var wrote_anything = req.has_written_status;

            if (req.sink) |wrapper| {
                wrapper.sink.pending_flush = null;
                wrapper.sink.done = true;
                wrote_anything = wrote_anything or wrapper.sink.wrote > 0;
                req.aborted = req.aborted or wrapper.sink.aborted;
                wrapper.sink.finalize();
                wrapper.detach();
                req.sink = null;
                wrapper.sink.destroy();
            }

            if (req.response_ptr) |resp| {
                if (resp.body.value == .Locked) {
                    resp.body.value.Locked.readable.?.done();
                    resp.body.value = .{ .Used = {} };
                }
            }

            streamLog("onReject({s})", .{wrote_anything});

            if (req.aborted) {
                req.finalizeForAbort();
                return;
            }

            if (!err.isEmptyOrUndefinedOrNull() and !wrote_anything) {
                req.response_jsvalue.unprotect();
                req.response_jsvalue = JSValue.zero;
                req.handleReject(err);
                return;
            } else if (wrote_anything) {
                req.resp.endStream(true);
                if (comptime debug_mode) {
                    if (!err.isEmptyOrUndefinedOrNull()) {
                        var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(req.allocator);
                        defer exception_list.deinit();
                        req.server.vm.runErrorHandler(err, &exception_list);
                    }
                }
                req.finalize();
                return;
            }

            const fallback = JSC.SystemError{
                .code = ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_UNHANDLED_ERROR))),
                .message = ZigString.init("Unhandled error in ReadableStream"),
            };
            req.handleReject(fallback.toErrorInstance(globalThis));
        }

        pub fn doRenderWithBody(this: *RequestContext, value: *JSC.WebCore.Body.Value) void {
            switch (value.*) {
                .Error => {
                    const err = value.Error;
                    _ = value.use();
                    if (this.aborted) {
                        this.finalizeForAbort();
                        return;
                    }
                    this.runErrorHandler(err);
                    return;
                },
                .Blob => {
                    this.blob = value.use();
                    this.renderWithBlobFromBodyValue();
                    return;
                },
                .Locked => |*lock| {
                    if (this.aborted) {
                        this.finalizeForAbort();
                        return;
                    }

                    if (lock.readable) |stream_| {
                        const stream: JSC.WebCore.ReadableStream = stream_;
                        stream.value.ensureStillAlive();

                        value.* = .{ .Used = {} };

                        if (stream.isLocked(this.server.globalThis)) {
                            streamLog("was locked but it shouldn't be", .{});
                            var err = JSC.SystemError{
                                .code = ZigString.init(@as(string, @tagName(JSC.Node.ErrorCode.ERR_STREAM_CANNOT_PIPE))),
                                .message = ZigString.init("Stream already used, please create a new one"),
                            };
                            stream.value.unprotect();
                            this.runErrorHandler(err.toErrorInstance(this.server.globalThis));
                            return;
                        }

                        switch (stream.ptr) {
                            .Invalid => {},

                            // fast path for Blob
                            .Blob => |val| {
                                streamLog("was Blob", .{});
                                this.blob = JSC.WebCore.Blob.initWithStore(val.store, this.server.globalThis);
                                this.blob.offset = val.offset;
                                this.blob.size = val.remain;

                                val.store.ref();
                                stream.detach(this.server.globalThis);
                                val.deinit();
                                this.renderWithBlobFromBodyValue();
                                return;
                            },

                            // fast path for File
                            .File => |val| {
                                streamLog("was File Blob", .{});
                                this.blob = JSC.WebCore.Blob.initWithStore(val.store, this.server.globalThis);
                                val.store.ref();

                                // it should be lazy, file shouldn't have opened yet.
                                std.debug.assert(!val.started);

                                stream.detach(this.server.globalThis);
                                val.deinit();
                                this.renderWithBlobFromBodyValue();
                                return;
                            },

                            .JavaScript, .Direct => {
                                var pair = StreamPair{ .stream = stream, .this = this };
                                this.resp.runCorkedWithType(*StreamPair, doRenderStream, &pair);
                                return;
                            },

                            .Bytes => |byte_stream| {
                                std.debug.assert(byte_stream.pipe.ctx == null);
                                std.debug.assert(this.byte_stream == null);

                                stream.detach(this.server.globalThis);

                                this.response_buf_owned = byte_stream.buffer.moveToUnmanaged();

                                // If we've received the complete body by the time this function is called
                                // we can avoid streaming it and just send it all at once.
                                if (byte_stream.has_received_last_chunk) {
                                    this.blob.size = @truncate(Blob.SizeType, this.response_buf_owned.items.len);
                                    byte_stream.parent().deinit();
                                    this.renderResponseBufferAndMetadataCorked();
                                    return;
                                }

                                byte_stream.pipe = JSC.WebCore.ByteStream.Pipe.New(@This(), onPipe).init(this);
                                this.byte_stream = byte_stream;

                                // we don't set size here because even if we have a hint
                                // uWebSockets won't let us partially write streaming content
                                this.blob.size = 0;

                                // if we've received metadata and part of the body, send everything we can and drain
                                if (this.response_buf_owned.items.len > 0) {
                                    this.drainResponseBufferAndMetadataCorked();
                                } else {
                                    // if we only have metadata to send, send it now
                                    this.resp.runCorkedWithType(*RequestContext, renderMetadata, this);
                                }
                                this.setAbortHandler();
                                return;
                            },
                        }
                    }

                    // when there's no stream, we need to
                    lock.callback = doRenderWithBodyLocked;
                    lock.task = this;

                    return;
                },
                else => {},
            }

            this.doRenderBlob();
        }

        pub fn onPipe(this: *RequestContext, stream: JSC.WebCore.StreamResult, allocator: std.mem.Allocator) void {
            var stream_needs_deinit = stream == .owned or stream == .owned_and_done;

            defer {
                if (stream_needs_deinit) {
                    if (stream.isDone()) {
                        stream.owned_and_done.listManaged(allocator).deinit();
                    } else {
                        stream.owned.listManaged(allocator).deinit();
                    }
                }
            }

            if (this.aborted) {
                this.finalizeForAbort();
                return;
            }

            const chunk = stream.slice();
            // on failure, it will continue to allocate
            // we can't do buffering ourselves here or it won't work
            // uSockets will append and manage the buffer
            // so any write will buffer if the write fails
            if (this.resp.write(chunk)) {
                if (stream.isDone()) {
                    this.resp.endStream(false);
                    this.finalize();
                }
            } else {
                // when it's the last one, we just want to know if it's done
                if (stream.isDone()) {
                    this.resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
                }
            }
        }

        pub fn doRenderBlob(this: *RequestContext) void {
            // We are not corked
            // The body is small
            // Faster to do the memcpy than to do the two network calls
            // We are not streaming
            // This is an important performance optimization
            if (this.has_abort_handler and this.blob.sharedView().len < 16384 - 1024) {
                this.resp.runCorkedWithType(*RequestContext, doRenderBlobCorked, this);
            } else {
                this.doRenderBlobCorked();
            }
        }

        pub fn doRenderBlobCorked(this: *RequestContext) void {
            this.renderMetadata();
            this.renderBytes();
        }

        pub fn doRender(this: *RequestContext) void {
            if (this.aborted) {
                this.finalizeForAbort();
                return;
            }
            var response = this.response_ptr.?;
            this.doRenderWithBody(&response.body.value);
        }

        pub fn renderProductionError(this: *RequestContext, status: u16) void {
            switch (status) {
                404 => {
                    if (!this.has_written_status) {
                        this.resp.writeStatus("404 Not Found");
                        this.has_written_status = true;
                    }

                    this.resp.endWithoutBody();
                },
                else => {
                    if (!this.has_written_status) {
                        this.resp.writeStatus("500 Internal Server Error");
                        this.resp.writeHeader("content-type", "text/plain");
                        this.has_written_status = true;
                    }

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

        fn finishRunningErrorHandler(this: *RequestContext, value: JSC.JSValue, status: u16) void {
            var vm = this.server.vm;
            var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(this.allocator);
            defer exception_list.deinit();
            if (comptime debug_mode) {
                vm.runErrorHandler(value, &exception_list);

                this.renderDefaultError(
                    vm.log,
                    error.ExceptionOcurred,
                    exception_list.toOwnedSlice(),
                    "<r><red>{s}<r> - <b>{s}<r> failed",
                    .{ @as(string, @tagName(this.method)), this.url },
                );
            } else {
                if (status != 404)
                    vm.runErrorHandler(value, &exception_list);
                this.renderProductionError(status);
            }

            vm.log.reset();
        }

        pub fn runErrorHandlerWithStatusCodeDontCheckResponded(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding();
            if (!this.server.config.onError.isEmpty() and !this.has_called_error_handler) {
                this.has_called_error_handler = true;
                var args = [_]JSC.C.JSValueRef{value.asObjectRef()};
                const result = JSC.C.JSObjectCallAsFunctionReturnValue(this.server.globalThis.ref(), this.server.config.onError.asObjectRef(), this.server.thisObject.asObjectRef(), 1, &args);

                if (!result.isEmptyOrUndefinedOrNull()) {
                    if (result.isError() or result.isAggregateError(this.server.globalThis)) {
                        this.finishRunningErrorHandler(result, status);
                        return;
                    } else if (result.as(Response)) |response| {
                        this.render(response);
                        return;
                    }
                }
            }

            this.finishRunningErrorHandler(value, status);
        }

        pub fn runErrorHandlerWithStatusCode(
            this: *RequestContext,
            value: JSC.JSValue,
            status: u16,
        ) void {
            JSC.markBinding();
            if (this.resp.hasResponded()) return;

            runErrorHandlerWithStatusCodeDontCheckResponded(this, value, status);
        }

        pub fn renderMetadata(this: *RequestContext) void {
            var response: *JSC.WebCore.Response = this.response_ptr.?;
            var status = response.statusCode();
            const size = this.blob.size;
            status = if (status == 200 and size == 0 and !this.blob.isDetached())
                204
            else
                status;

            this.writeStatus(status);
            var needs_content_type = true;
            const content_type: MimeType = brk: {
                if (response.body.init.headers) |headers_| {
                    if (headers_.fastGet(.ContentType)) |content| {
                        needs_content_type = false;
                        break :brk MimeType.byName(content.slice());
                    }
                }
                break :brk if (this.blob.content_type.len > 0)
                    MimeType.byName(this.blob.content_type)
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
                has_content_disposition = headers_.fastHas(.ContentDisposition);
                response.body.init.headers = null;
                headers_.deref();
            }

            if (needs_content_type and
                // do not insert the content type if it is the fallback value
                // we may not know the content-type when streaming
                (!this.blob.isDetached() or content_type.value.ptr != MimeType.other.value.ptr))
            {
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
                // given a blob, we might not have set an abort handler yet
                this.setAbortHandler();
                return;
            }

            this.finalize();
        }

        pub fn render(this: *RequestContext, response: *JSC.WebCore.Response) void {
            this.response_ptr = response;

            this.doRender();
        }

        pub fn onBufferedBodyChunk(this: *RequestContext, resp: *App.Response, chunk: []const u8, last: bool) void {
            std.debug.assert(this.resp == resp);

            if (this.aborted) return;

            const request = JSC.JSValue.fromRef(this.request_js_object);
            var req = request.as(Request) orelse {
                this.request_body_buf.clearAndFree(this.allocator);
                return;
            };

            if (req.body == .Locked) {
                if (req.body.Locked.readable) |readable| {
                    if (readable.ptr == .Bytes) {
                        std.debug.assert(this.request_body_buf.items.len == 0);

                        if (!last) {
                            readable.ptr.Bytes.onData(
                                .{
                                    .temporary = bun.ByteList.init(chunk),
                                },
                                bun.default_allocator,
                            );
                        } else {
                            readable.ptr.Bytes.onData(
                                .{
                                    .temporary_and_done = bun.ByteList.init(chunk),
                                },
                                bun.default_allocator,
                            );
                        }

                        return;
                    }
                }
            }

            if (last) {
                request.ensureStillAlive();
                var bytes = this.request_body_buf;
                var old = req.body;
                if (bytes.items.len == 0) {
                    req.body = .{ .Empty = {} };
                } else {
                    req.body = .{ .InternalBlob = bytes.toManaged(this.allocator) };
                }

                if (old == .Locked)
                    old.resolve(&req.body, this.server.globalThis);
                request.unprotect();
            }

            if (this.request_body_buf.capacity == 0) {
                this.request_body_buf.ensureTotalCapacityPrecise(this.allocator, @minimum(this.request_body_content_len, max_request_body_preallocate_length)) catch @panic("Out of memory while allocating request body buffer");
            }

            this.request_body_buf.appendSlice(this.allocator, chunk) catch @panic("Out of memory while allocating request body");
        }

        pub fn onDrainRequestBody(this: *RequestContext) JSC.WebCore.DrainResult {
            if (this.aborted) {
                return JSC.WebCore.DrainResult{
                    .aborted = void{},
                };
            }

            std.debug.assert(!this.resp.hasResponded());

            // This means we have received part of the body but not the whole thing
            if (this.request_body_buf.items.len > 0) {
                var emptied = this.request_body_buf;
                this.request_body_buf = .{};
                return .{
                    .owned = .{
                        .list = emptied.toManaged(this.allocator),
                        .size_hint = if (emptied.capacity < max_request_body_preallocate_length)
                            emptied.capacity
                        else
                            0,
                    },
                };
            }

            const content_length = this.req.header("content-length") orelse {
                return .{
                    .empty = void{},
                };
            };

            const len = std.fmt.parseInt(usize, content_length, 10) catch 0;
            this.request_body_content_len = len;

            if (len == 0) {
                return JSC.WebCore.DrainResult{
                    .empty = void{},
                };
            }

            if (len > this.server.config.max_request_body_size) {
                this.resp.writeStatus("413 Request Entity Too Large");
                this.resp.endWithoutBody();

                this.finalize();
                return JSC.WebCore.DrainResult{
                    .aborted = void{},
                };
            }

            this.resp.onData(*RequestContext, onBufferedBodyChunk, this);

            return .{
                .estimated_size = len,
            };
        }
        const max_request_body_preallocate_length = 1024 * 256;
        pub fn onPull(this: *RequestContext) void {
            const request = JSC.JSValue.c(this.request_js_object);
            request.ensureStillAlive();

            if (this.req.header("content-length")) |content_length| {
                const len = std.fmt.parseInt(usize, content_length, 10) catch 0;
                this.request_body_content_len = len;
                if (len == 0) {
                    if (request.as(Request)) |req| {
                        var old = req.body;
                        old.Locked.callback = null;
                        req.body = .{ .Empty = .{} };
                        old.resolve(&req.body, this.server.globalThis);
                        return;
                    }
                    request.ensureStillAlive();
                }

                if (len >= this.server.config.max_request_body_size) {
                    if (request.as(Request)) |req| {
                        var old = req.body;
                        old.Locked.callback = null;
                        req.body = .{ .Empty = .{} };
                        old.toError(error.RequestBodyTooLarge, this.server.globalThis);
                        return;
                    }
                    request.ensureStillAlive();

                    this.resp.writeStatus("413 Request Entity Too Large");
                    this.resp.endWithoutBody();
                    this.finalize();
                    return;
                }
            } else if (this.req.header("transfer-encoding") == null) {
                // no content-length
                // no transfer-encoding
                if (request.as(Request)) |req| {
                    var old = req.body;
                    old.Locked.callback = null;
                    req.body = .{ .Empty = .{} };
                    old.resolve(&req.body, this.server.globalThis);
                    return;
                }
            }

            request.protect();
            this.setAbortHandler();
            this.resp.onData(*RequestContext, onBufferedBodyChunk, this);
        }

        pub fn onPullCallback(this: *anyopaque) void {
            onPull(bun.cast(*RequestContext, this));
        }

        pub fn onDrainRequestBodyCallback(this: *anyopaque) JSC.WebCore.DrainResult {
            return onDrainRequestBody(bun.cast(*RequestContext, this));
        }

        pub const Export = shim.exportFunctions(.{
            .onResolve = onResolve,
            .onReject = onReject,
            .onResolveStream = onResolveStream,
            .onRejectStream = onRejectStream,
        });

        comptime {
            if (!JSC.is_bindgen) {
                @export(onResolve, .{
                    .name = Export[0].symbol_name,
                });
                @export(onReject, .{
                    .name = Export[1].symbol_name,
                });
                @export(onResolveStream, .{
                    .name = Export[2].symbol_name,
                });
                @export(onRejectStream, .{
                    .name = Export[3].symbol_name,
                });
            }
        }
    };
}

pub fn NewServer(comptime ssl_enabled_: bool, comptime debug_mode_: bool) type {
    return struct {
        pub const ssl_enabled = ssl_enabled_;
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
        config: ServerConfig = ServerConfig{},
        pending_requests: usize = 0,
        request_pool_allocator: std.mem.Allocator = undefined,
        has_js_deinited: bool = false,
        listen_callback: JSC.AnyTask = undefined,
        allocator: std.mem.Allocator,
        keeping_js_alive: bool = false,

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
                .fetch = .{
                    .rfn = onFetch,
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

        pub fn onFetch(
            this: *ThisServer,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSObjectRef {
            var globalThis = ctx.ptr();

            if (arguments.len == 0) {
                const fetch_error = WebCore.Fetch.fetch_error_no_args;
                return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
            }

            var headers: ?*JSC.FetchHeaders = null;
            var method = HTTP.Method.GET;
            var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
            defer args.deinit();

            var url: URL = undefined;
            var first_arg = args.nextEat().?;
            var body: JSC.WebCore.Body.Value = .{ .Empty = .{} };
            var existing_request: ?WebCore.Request = null;
            // TODO: set Host header
            // TODO: set User-Agent header
            if (first_arg.isString()) {
                var url_zig_str = ZigString.init("");
                JSValue.fromRef(arguments[0]).toZigString(&url_zig_str, globalThis);
                var temp_url_str = url_zig_str.slice();

                if (temp_url_str.len == 0) {
                    const fetch_error = JSC.WebCore.Fetch.fetch_error_blank_url;
                    return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
                }

                url = URL.parse(temp_url_str);

                if (url.hostname.len == 0) {
                    url = URL.parse(
                        strings.append(this.allocator, this.base_url_string_for_joining, url.pathname) catch unreachable,
                    );
                } else {
                    temp_url_str = this.allocator.dupe(u8, temp_url_str) catch unreachable;
                    url = URL.parse(temp_url_str);
                }

                if (arguments.len >= 2 and arguments[1].?.value().isObject()) {
                    var opts = JSValue.fromRef(arguments[1]);
                    if (opts.fastGet(ctx.ptr(), .method)) |method_| {
                        var slice_ = method_.toSlice(ctx.ptr(), getAllocator(ctx));
                        defer slice_.deinit();
                        method = HTTP.Method.which(slice_.slice()) orelse method;
                    }

                    if (opts.fastGet(ctx.ptr(), .headers)) |headers_| {
                        if (headers_.as(JSC.FetchHeaders)) |headers__| {
                            headers = headers__;
                        } else if (JSC.FetchHeaders.createFromJS(ctx.ptr(), headers_)) |headers__| {
                            headers = headers__;
                        }
                    }

                    if (opts.fastGet(ctx.ptr(), .body)) |body__| {
                        if (Blob.get(ctx.ptr(), body__, true, false)) |new_blob| {
                            body = .{ .Blob = new_blob };
                        } else |_| {
                            return JSPromise.rejectedPromiseValue(globalThis, ZigString.init("fetch() received invalid body").toErrorInstance(globalThis)).asRef();
                        }
                    }
                }
            } else if (first_arg.as(Request)) |request_| {
                existing_request = request_.*;
            } else {
                const fetch_error = WebCore.Fetch.fetch_type_error_strings.get(js.JSValueGetType(ctx, arguments[0]));
                return JSPromise.rejectedPromiseValue(globalThis, ZigString.init(fetch_error).toErrorInstance(globalThis)).asRef();
            }

            if (existing_request == null) {
                existing_request = Request{
                    .url = ZigString.init(url.href),
                    .headers = headers,
                    .body = body,
                    .method = method,
                };
            }

            var request = ctx.bunVM().allocator.create(Request) catch unreachable;
            request.* = existing_request.?;
            request.url.mark();

            var args_ = [_]JSC.C.JSValueRef{request.toJS(this.globalThis).asObjectRef()};
            const response_value = JSC.C.JSObjectCallAsFunctionReturnValue(
                this.globalThis.ref(),
                this.config.onRequest.asObjectRef(),
                this.thisObject.asObjectRef(),
                1,
                &args_,
            );

            if (response_value.isAnyError(ctx)) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, response_value).asObjectRef();
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, ZigString.init("fetch() returned an empty value").toErrorInstance(ctx)).asObjectRef();
            }

            if (response_value.asPromise() != null) {
                return response_value.asObjectRef();
            }

            if (response_value.as(JSC.WebCore.Response)) |resp| {
                resp.url = this.allocator.dupe(u8, url.href) catch unreachable;
            }

            return JSC.JSPromise.resolvedPromiseValue(ctx, response_value).asObjectRef();
        }

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
            return ZigString.init(bun.span(this.config.hostname)).toValue(globalThis);
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
            if (this.pending_requests == 0 and this.listener == null and this.has_js_deinited) {
                this.deref();
                this.deinit();
            }
        }

        pub fn stop(this: *ThisServer) void {
            if (this.listener) |listener| {
                this.listener = null;
                this.deref();
                listener.close();
            }

            this.deinitIfWeCan();
        }

        pub fn deinit(this: *ThisServer) void {
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
            var zig_str: ZigString = ZigString.init("");
            var output_buf: [4096]u8 = undefined;

            if (comptime ssl_enabled) {
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

            if (zig_str.len == 0) {
                zig_str = ZigString.init(std.fmt.bufPrint(&output_buf, "Failed to start server. Is port {d} in use?", .{this.config.port}) catch "Failed to start server");
            }

            // store the exception in here
            // toErrorInstance clones the string
            this.thisObject = zig_str.toErrorInstance(this.globalThis);

            // reference it in stack memory
            this.thisObject.ensureStillAlive();
            return;
        }

        pub fn onListen(this: *ThisServer, socket: ?*App.ListenSocket, _: uws.uws_app_listen_config_t) void {
            if (socket == null) {
                return this.onListenFailed();
            }

            this.listener = socket;
            this.vm.uws_event_loop = uws.Loop.get();
            this.ref();
        }

        pub fn ref(this: *ThisServer) void {
            if (this.keeping_js_alive) return;

            this.vm.us_loop_reference_count +|= 1;
            this.vm.eventLoop().start_server_on_next_tick = true;
            this.keeping_js_alive = true;
        }

        pub fn deref(this: *ThisServer) void {
            if (!this.keeping_js_alive) return;

            this.vm.us_loop_reference_count -|= 1;
            this.vm.eventLoop().start_server_on_next_tick = false;
            this.keeping_js_alive = false;
        }

        pub fn onBunInfoRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            JSC.markBinding();
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
            JSC.markBinding();
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
            JSC.markBinding();
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
                        .onPull = RequestContext.onPullCallback,
                        .onDrain = RequestContext.onDrainRequestBodyCallback,
                    },
                },
            };
            request_object.url.mark();
            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.C.JSValueRef{request_object.toJS(this.globalThis).asObjectRef()};
            ctx.request_js_object = args[0];
            const request_value = JSValue.c(args[0]);
            request_value.ensureStillAlive();
            const response_value = JSC.C.JSObjectCallAsFunctionReturnValue(this.globalThis.ref(), this.config.onRequest.asObjectRef(), this.thisObject.asObjectRef(), 1, &args);
            request_value.ensureStillAlive();
            response_value.ensureStillAlive();

            if (ctx.aborted) {
                ctx.finalizeForAbort();
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
                ctx.response_jsvalue = response_value;
                ctx.response_jsvalue.ensureStillAlive();
                ctx.response_protected = false;
                switch (response.body.value) {
                    .Blob => |*blob| {
                        if (blob.needsToReadFile()) {
                            response_value.protect();
                            ctx.response_protected = true;
                        }
                    },
                    .Locked => {
                        response_value.protect();
                        ctx.response_protected = true;
                    },
                    else => {},
                }
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
                // Even if the user hasn't requested it, we have to start downloading the body!!
                // terrible for performance.
                if (request_object.body == .Locked and (request_object.body.Locked.promise == null and request_object.body.Locked.readable == null) and ((HTTP.Method.which(req.method()) orelse HTTP.Method.OPTIONS).hasRequestBody())) {
                    const req_len: usize = brk: {
                        if (req.header("content-length")) |content_length| {
                            break :brk std.fmt.parseInt(usize, content_length, 10) catch 0;
                        }

                        break :brk 0;
                    };

                    if (req_len > this.config.max_request_body_size) {
                        resp.writeStatus("413 Request Entity Too Large");
                        resp.endWithoutBody();
                        this.finalize();
                        return;
                    }

                    if ((req_len > 0)) {
                        ctx.request_body_buf.ensureTotalCapacityPrecise(ctx.allocator, req_len) catch {
                            resp.writeStatus("413 Request Entity Too Large");
                            resp.endWithoutBody();
                            this.finalize();
                            return;
                        };
                        resp.onData(*RequestContext, RequestContext.onBufferedBodyChunk, ctx);
                    }
                }

                ctx.setAbortHandler();
                ctx.pending_promises_for_abort += 1;

                // we have to clone the request headers here since they will soon belong to a different request
                if (request_object.headers == null) {
                    request_object.headers = JSC.FetchHeaders.createFromUWS(this.globalThis, req);
                }

                response_value.then(this.globalThis, ctx, RequestContext.onResolve, RequestContext.onReject);
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

            const hostname = bun.span(this.config.hostname);
            // When "localhost" is specified, we omit the hostname entirely
            // Otherwise, "curl http://localhost:3000" doesn't actually work due to IPV6 vs IPV4 issues
            // This prints a spurious log si_destination_compare on macOS but only when debugger is connected
            const host: [*:0]const u8 = if (hostname.len == 0 or (!ssl_enabled and strings.eqlComptime(hostname, "localhost")))
                ""
            else
                this.config.hostname;

            this.app.listenWithConfig(*ThisServer, this, onListen, .{
                .port = this.config.port,
                .host = host,
                .options = 0,
            });
        }
    };
}

pub const Server = NewServer(false, false);
pub const SSLServer = NewServer(true, false);
pub const DebugServer = NewServer(false, true);
pub const DebugSSLServer = NewServer(true, true);
