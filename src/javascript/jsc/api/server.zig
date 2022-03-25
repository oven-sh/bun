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
const d = @import("../base.zig").d;
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
    ssl_config: ?SSLConfig = null,
    max_request_body_size: usize = 1024 * 1024 * 128,
    development: bool = false,

    onError: JSC.JSValue = JSC.JSValue.zero,
    onRequest: JSC.JSValue = JSC.JSValue.zero,

    pub const SSLConfig = struct {
        server_name: [*:0]const u8 = "",

        key_file_name: [*:0]const u8 = "",
        cert_file_name: [*:0]const u8 = "",

        ca_file_name: [*:0]const u8 = "",
        dh_params_file_name: [*:0]const u8 = "",

        passphrase: [*:0]const u8 = "",
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
                if (sliced.len > 0) {
                    result.key_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.key_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Invalid keyFile path", .{}, global.ref(), exception);
                        result.deinit();

                        return null;
                    }
                    any = true;
                }
            }
            if (obj.getTruthy(global, "certFile")) |cert_file_name| {
                var sliced = cert_file_name.toSlice(global, bun.default_allocator);
                if (sliced.len > 0) {
                    result.cert_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.cert_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Invalid certFile path", .{}, global.ref(), exception);
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
                    if (sliced.len > 0) {
                        result.server_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    }
                }

                if (obj.getTruthy(global, "caFile")) |ca_file_name| {
                    var sliced = ca_file_name.toSlice(global, bun.default_allocator);
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

        if (arguments.next()) |arg| {
            if (arg.isUndefinedOrNull() or !arg.isObject()) {
                JSC.throwInvalidArguments("Bun.serve expects an object", .{}, global.ref(), exception);
                return args;
            }

            if (arg.getTruthy(global, "port")) |port_| {
                args.port = @intCast(u16, @minimum(@maximum(0, port_.toInt32()), std.math.maxInt(u16)));
            }

            if (arg.getTruthy(global, "hostname") orelse arg.getTruthy(global, "host")) |host| {
                const host_str = host.toSlice(
                    global,
                    bun.default_allocator,
                );
                if (host_str.len > 0) {
                    args.hostname = bun.default_allocator.dupeZ(u8, host_str.slice()) catch unreachable;
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

        return args;
    }
};

pub fn NewServer(comptime ssl_enabled: bool, comptime debug_mode: bool) type {
    return struct {
        const ThisServer = @This();
        const RequestContextStackAllocator = std.heap.StackFallbackAllocator(@sizeOf(RequestContext) * 2048 + 4096);

        pub const App = uws.NewApp(ssl_enabled);

        listener: ?*App.ListenSocket = null,

        app: *App = undefined,
        globalThis: *JSGlobalObject,

        response_objects_pool: JSC.WebCore.Response.Pool = JSC.WebCore.Response.Pool{},
        config: ServerConfig = ServerConfig{},
        request_pool_allocator: std.mem.Allocator = undefined,

        pub fn init(config: ServerConfig, globalThis: *JSGlobalObject) *ThisServer {
            var server = bun.default_allocator.create(ThisServer) catch @panic("Out of memory!");
            server.* = .{
                .globalThis = globalThis,
                .config = config,
            };
            RequestContext.pool = bun.default_allocator.create(RequestContextStackAllocator) catch @panic("Out of memory!");
            server.request_pool_allocator = RequestContext.pool.get();
            return server;
        }

        pub fn onListen(this: *ThisServer, socket: ?*App.ListenSocket, _: uws.uws_app_listen_config_t) void {
            if (socket == null) {
                JSC.VirtualMachine.vm.defaultErrorHandler(ZigString.init("Bun.serve failed to start").toErrorInstance(this.globalThis), null);
                return;
            }

            this.listener = socket;
            VirtualMachine.vm.uws_event_loop = uws.Loop.get();
            VirtualMachine.vm.response_objects_pool = &this.response_objects_pool;

            this.app.run();
        }

        pub const RequestContext = struct {
            server: *ThisServer,
            resp: *App.Response,
            req: *uws.Request,
            url: string,
            method: HTTP.Method,
            aborted: bool = false,
            response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
            response_ptr: ?*JSC.WebCore.Response = null,
            blob: JSC.WebCore.Blob = JSC.WebCore.Blob{},
            promise: ?*JSC.JSValue = null,
            response_headers: ?*JSC.WebCore.Headers.RefCountedHeaders = null,
            has_abort_handler: bool = false,
            has_sendfile_ctx: bool = false,
            has_called_error_handler: bool = false,
            sendfile: SendfileContext = undefined,
            request_js_object: JSC.C.JSObjectRef = null,
            request_body_buf: std.ArrayListUnmanaged(u8) = .{},
            fallback_buf: std.ArrayListUnmanaged(u8) = .{},

            pub threadlocal var pool: *RequestContextStackAllocator = undefined;

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
                    ctx.req.setYield(true);
                    ctx.finalize();
                    return;
                }

                var response = arguments[0].as(JSC.WebCore.Response) orelse {
                    Output.prettyErrorln("Expected a Response object", .{});
                    Output.flush();
                    ctx.req.setYield(true);
                    ctx.finalize();
                    return;
                };
                ctx.render(response);
            }

            pub fn onReject(
                ctx: *RequestContext,
                _: *JSC.JSGlobalObject,
                arguments: []const JSC.JSValue,
            ) void {
                ctx.runErrorHandler(
                    if (arguments.len > 0) arguments[0] else JSC.JSValue.jsUndefined(),
                );

                if (ctx.aborted) {
                    ctx.finalize();
                    return;
                }

                ctx.req.setYield(true);
                ctx.finalize();
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

                var allocator = bun.default_allocator;

                var fallback_container = allocator.create(Api.FallbackMessageContainer) catch unreachable;
                defer allocator.destroy(fallback_container);
                fallback_container.* = Api.FallbackMessageContainer{
                    .message = std.fmt.allocPrint(allocator, fmt, args) catch unreachable,
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

                this.fallback_buf = std.ArrayListUnmanaged(u8){ .items = bb.items, .capacity = bb.capacity };
                this.resp.onWritable(*RequestContext, onWritableFallback, this);
            }

            pub fn onWritableFallback(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
                if (this.aborted) {
                    return false;
                }

                return this.sendWritableBytes(this.fallback_buf.items, write_offset, resp);
            }

            pub fn create(this: *RequestContext, server: *ThisServer, req: *uws.Request, resp: *App.Response) void {
                this.* = .{
                    .resp = resp,
                    .req = req,
                    .url = req.url(),
                    .method = HTTP.Method.which(req.method()) orelse .GET,
                    .server = server,
                };
            }

            pub fn onAbort(this: *RequestContext, _: *App.Response) void {
                this.aborted = true;
                this.finalizeWithoutDeinit();
            }

            // This function may be called multiple times
            // so it's important that we can safely do that
            pub fn finalizeWithoutDeinit(this: *RequestContext) void {
                this.blob.detach();
                this.request_body_buf.clearAndFree(bun.default_allocator);

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

                this.fallback_buf.clearAndFree(bun.default_allocator);
            }
            pub fn finalize(this: *RequestContext) void {
                this.finalizeWithoutDeinit();

                this.server.request_pool_allocator.destroy(this);
            }

            fn writeHeaders(
                this: *RequestContext,
                headers_: *Headers.RefCountedHeaders,
            ) void {
                var headers: *JSC.WebCore.Headers = headers_.get();
                if (headers.getHeaderIndex("content-length")) |index| {
                    headers.entries.orderedRemove(index);
                }

                if (this.blob.content_type.len > 0 and headers.getHeaderIndex("content-type") == null) {
                    this.resp.writeHeader("content-type", this.blob.content_type);
                } else if (MimeType.sniff(this.blob.sharedView())) |content| {
                    this.resp.writeHeader("content-type", content.value);
                }

                defer headers_.deref();
                var entries = headers.entries.slice();
                const names = entries.items(.name);
                const values = entries.items(.value);

                this.resp.writeHeaders(names, values, headers.buf.items);
            }

            pub fn writeStatus(this: *RequestContext, status: u16) void {
                var status_text_buf: [48]u8 = undefined;

                if (status == 302) {
                    this.resp.writeStatus("302 Found");
                } else {
                    this.resp.writeStatus(std.fmt.bufPrint(&status_text_buf, "{d} HM", .{status}) catch unreachable);
                }
            }

            fn cleanupAfterSendfile(this: *RequestContext) void {
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
                        this.cleanupAfterSendfile();
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
                        this.cleanupAfterSendfile();
                        return errcode != .SUCCESS;
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
                if (this.aborted)
                    return false;

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

            pub fn onWritablePrepareSendfile(this: *RequestContext, _: c_ulong, _: *App.Response) callconv(.C) bool {
                this.renderSendFile(this.blob);

                return true;
            }

            pub fn onPrepareSendfileWrap(this: *anyopaque, fd: i32, size: anyerror!Blob.SizeType, _: *JSGlobalObject) void {
                onPrepareSendfile(bun.cast(*RequestContext, this), fd, size);
            }

            fn onPrepareSendfile(this: *RequestContext, fd: i32, size: anyerror!Blob.SizeType) void {
                this.setAbortHandler();
                if (this.aborted) return;
                const size_ = size catch {
                    this.req.setYield(true);
                    this.finalize();
                    return;
                };
                this.blob.size = size_;

                this.sendfile = .{
                    .fd = fd,
                    .remain = size_,
                    .socket_fd = this.resp.getNativeHandle(),
                };

                this.resp.runCorked(*RequestContext, renderMetadata, this);

                if (size_ == 0) {
                    this.cleanupAfterSendfile();
                    this.finalize();

                    return;
                }

                // TODO: fix this to be MSGHDR
                _ = std.os.write(this.sendfile.socket_fd, "\r\n") catch 0;

                _ = this.onSendfile();
            }

            pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
                if (this.has_sendfile_ctx) return;
                this.has_sendfile_ctx = true;
                this.setAbortHandler();

                JSC.WebCore.Blob.doOpenAndStatFile(
                    &this.blob,
                    *RequestContext,
                    this,
                    onPrepareSendfileWrap,
                    blob.globalThis,
                );
            }

            pub fn doRender(this: *RequestContext) void {
                if (this.aborted) {
                    return;
                }
                var response = this.response_ptr.?;
                var body = &response.body;
                this.blob = response.body.use();

                if (body.value == .Error) {
                    this.resp.writeStatus("500 Internal Server Error");
                    this.resp.writeHeader("content-type", "text/plain");
                    this.resp.endWithoutBody();
                    JSC.VirtualMachine.vm.defaultErrorHandler(body.value.Error, null);
                    body.value = JSC.WebCore.Body.Value.empty;
                    this.finalize();
                    return;
                }

                if (body.value == .Blob) {
                    if (body.value.Blob.needsToReadFile()) {
                        this.req.setYield(false);
                        this.setAbortHandler();
                        if (!this.has_sendfile_ctx) this.renderSendFile(this.blob);
                        return;
                    }
                }

                if (this.has_abort_handler)
                    this.resp.runCorked(*RequestContext, renderMetadata, this)
                else
                    this.renderMetadata();

                this.renderBytes();
            }

            pub fn renderProductionError(this: *RequestContext) void {
                this.resp.writeStatus("500 Internal Server Error");
                this.resp.writeHeader("content-type", "text/plain");
                this.resp.end("Something went wrong!", true);

                this.finalize();
            }

            pub fn runErrorHandler(this: *RequestContext, value: JSC.JSValue) void {
                if (this.resp.hasResponded()) return;

                var exception_list: std.ArrayList(Api.JsException) = std.ArrayList(Api.JsException).init(bun.default_allocator);

                if (!this.server.config.onError.isEmpty() and !this.has_called_error_handler) {
                    this.has_called_error_handler = true;
                    var args = [_]JSC.C.JSValueRef{value.asObjectRef()};
                    const result = JSC.C.JSObjectCallAsFunctionReturnValue(this.server.globalThis.ref(), this.server.config.onError.asObjectRef(), null, 1, &args);
                    if (!result.isUndefinedOrNull()) {
                        if (result.isError() or result.isAggregateError(this.server.globalThis)) {
                            JSC.VirtualMachine.vm.defaultErrorHandler(result, &exception_list);
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
                        "Unhandled exception in request handler",
                        .{},
                    );
                } else {
                    JSC.VirtualMachine.vm.defaultErrorHandler(value, &exception_list);
                    this.renderProductionError();
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

                if (response.body.init.headers) |headers_| {
                    this.writeHeaders(headers_);
                } else if (this.blob.content_type.len > 0) {
                    this.resp.writeHeader("content-type", this.blob.content_type);
                } else if (MimeType.sniff(this.blob.sharedView())) |content| {
                    this.resp.writeHeader("content-type", content.value);
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
                if (this.aborted)
                    return;
                if (JSC.JSValue.fromRef(this.request_js_object).as(Request)) |req| {
                    var bytes = this.request_body_buf.toOwnedSlice(bun.default_allocator);
                    var old = req.body;
                    req.body = .{
                        .Blob = if (bytes.len > 0)
                            Blob.init(bytes, bun.default_allocator, this.server.globalThis)
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
                this.request_body_buf.appendSlice(bun.default_allocator, chunk) catch @panic("Out of memory while allocating request body");

                if (last) {
                    if (JSC.JSValue.fromRef(this.request_js_object).as(Request) != null) {
                        uws.Loop.get().?.nextTick(*RequestContext, this, resolveRequestBody);
                    } else {
                        this.request_body_buf.deinit(bun.default_allocator);
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

                    this.request_body_buf.ensureTotalCapacityPrecise(bun.default_allocator, len) catch @panic("Out of memory while allocating request body buffer");
                }
                this.setAbortHandler();

                this.resp.onData(*RequestContext, onBodyChunk, this);
            }

            pub fn onRequestDataCallback(this: *anyopaque) void {
                onRequestData(bun.cast(*RequestContext, this));
            }
        };

        pub fn onBunInfoRequest(_: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;
            req.setYield(false);
            var stack_fallback = std.heap.stackFallback(8096, bun.default_allocator);
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

        pub fn onSrcRequest(_: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;
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
                editor.open(ctx.path, url, line, column, bun.default_allocator) catch Output.prettyErrorln("Failed to open editor", .{});
            } else {
                resp.writeStatus("500 Missing Editor :(");
                resp.end("Please set your editor in bunfig.toml", false);
            }
        }

        pub fn onRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            if (comptime JSC.is_bindgen) return undefined;

            req.setYield(false);
            var ctx = this.request_pool_allocator.create(RequestContext) catch @panic("ran out of memory");
            ctx.create(this, req, resp);

            var request_object = bun.default_allocator.create(JSC.WebCore.Request) catch unreachable;
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
            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.C.JSValueRef{JSC.WebCore.Request.Class.make(this.globalThis.ref(), request_object)};
            ctx.request_js_object = args[0];
            JSC.C.JSValueProtect(this.globalThis.ref(), args[0]);
            ctx.response_jsvalue = JSC.C.JSObjectCallAsFunctionReturnValue(this.globalThis.ref(), this.config.onRequest.asObjectRef(), null, 1, &args);
            defer JSC.VirtualMachine.vm.tick();
            if (ctx.aborted) {
                ctx.finalize();

                return;
            }

            if (ctx.response_jsvalue.isUndefinedOrNull()) {
                req.setYield(true);
                ctx.finalize();
                return;
            }

            if (ctx.response_jsvalue.isError() or ctx.response_jsvalue.isAggregateError(this.globalThis) or ctx.response_jsvalue.isException(this.globalThis.vm())) {
                ctx.runErrorHandler(ctx.response_jsvalue);
            }

            JSC.C.JSValueProtect(this.globalThis.ref(), ctx.response_jsvalue.asObjectRef());

            if (ctx.response_jsvalue.as(JSC.WebCore.Response)) |response| {
                ctx.render(response);

                return;
            }

            if (ctx.response_jsvalue.jsTypeLoose() == .JSPromise) {
                ctx.setAbortHandler();
                JSC.VirtualMachine.vm.tick();

                ctx.response_jsvalue.then(
                    this.globalThis,
                    RequestContext,
                    ctx,
                    RequestContext.onResolve,
                    RequestContext.onReject,
                );
                return;
            }

            if (!ctx.resp.hasResponded()) {
                ctx.resp.writeStatus("200 OK");
                ctx.resp.end("Welcome to Bun! To get started, ", false);
            }

            // switch (ctx.response_jsvalue.jsTypeLoose()) {
            //     .JSPromise => {
            //         JSPromise.
            //     },
            // }
        }

        pub fn listen(this: *ThisServer) void {
            if (ssl_enabled) {
                const ssl_config = this.config.ssl_config orelse @panic("Assertion failure: ssl_config");
                this.app = App.create(.{
                    .key_file_name = ssl_config.key_file_name,
                    .cert_file_name = ssl_config.cert_file_name,
                    .passphrase = ssl_config.passphrase,
                    .dh_params_file_name = ssl_config.dh_params_file_name,
                    .ca_file_name = ssl_config.ca_file_name,
                    .ssl_prefer_low_memory_usage = @as(c_int, @boolToInt(ssl_config.low_memory_mode)),
                });

                if (std.mem.span(ssl_config.server_name).len > 0) {
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

pub const Server = NewServer(false, true);
pub const SSLServer = NewServer(true, true);

pub const DebugServer = NewServer(false, true);
pub const DebugSSLServer = NewServer(true, true);
