const Bun = @This();
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const logger = @import("root").bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = bun.Bundler;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("root").bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.bundler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("root").bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const HTTP = @import("root").bun.HTTP;
const FetchEvent = WebCore.FetchEvent;
const js = @import("root").bun.JSC.C;
const JSC = @import("root").bun.JSC;
const JSError = @import("../base.zig").JSError;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("root").bun.JSC.JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("root").bun.JSC.Microtask;
const JSGlobalObject = @import("root").bun.JSC.JSGlobalObject;
const ExceptionValueRef = @import("root").bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = @import("root").bun.JSC.JSPrivateDataPtr;
const ZigConsoleClient = @import("root").bun.JSC.ZigConsoleClient;
const Node = @import("root").bun.JSC.Node;
const ZigException = @import("root").bun.JSC.ZigException;
const ZigStackTrace = @import("root").bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = @import("root").bun.JSC.ErrorableResolvedSource;
const ResolvedSource = @import("root").bun.JSC.ResolvedSource;
const JSPromise = @import("root").bun.JSC.JSPromise;
const JSInternalPromise = @import("root").bun.JSC.JSInternalPromise;
const JSModuleLoader = @import("root").bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = @import("root").bun.JSC.JSPromiseRejectionOperation;
const Exception = @import("root").bun.JSC.Exception;
const ErrorableZigString = @import("root").bun.JSC.ErrorableZigString;
const ZigGlobalObject = @import("root").bun.JSC.ZigGlobalObject;
const VM = @import("root").bun.JSC.VM;
const JSFunction = @import("root").bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;
const is_bindgen = JSC.is_bindgen;
const uws = @import("root").bun.uws;
const Fallback = Runtime.Fallback;
const MimeType = HTTP.MimeType;
const Blob = JSC.WebCore.Blob;
const BoringSSL = @import("root").bun.BoringSSL;
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
const DateTime = bun.DateTime;
const linux = std.os.linux;

const BlobFileContentResult = struct {
    data: [:0]const u8,
    fn init(comptime fieldname: []const u8, js_obj: JSC.JSValue, global: *JSC.JSGlobalObject, exception: JSC.C.ExceptionRef) ?BlobFileContentResult {
        if (JSC.WebCore.Body.Value.fromJS(global, js_obj)) |body| {
            if (body == .Blob and body.Blob.store != null and body.Blob.store.?.data == .file) {
                var fs: JSC.Node.NodeFS = .{};
                const read = fs.readFileWithOptions(.{ .path = body.Blob.store.?.data.file.pathlike }, .sync, .null_terminated);
                switch (read) {
                    .err => {
                        global.throwValue(read.err.toJSC(global));
                        return .{ .data = "" };
                    },
                    else => {
                        const str = read.result.null_terminated;
                        if (str.len > 0) {
                            return .{ .data = str };
                        }
                        JSC.throwInvalidArguments(std.fmt.comptimePrint("Invalid {s} file", .{fieldname}), .{}, global, exception);
                        return .{ .data = str };
                    },
                }
            }
        }

        return null;
    }
};

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

    websocket: ?WebSocketServer = null,

    pub const SSLConfig = struct {
        server_name: [*c]const u8 = null,

        key_file_name: [*c]const u8 = null,
        cert_file_name: [*c]const u8 = null,

        ca_file_name: [*c]const u8 = null,
        dh_params_file_name: [*c]const u8 = null,

        passphrase: [*c]const u8 = null,
        low_memory_mode: bool = false,

        key: ?[][*c]const u8 = null,
        key_count: u32 = 0,

        cert: ?[][*c]const u8 = null,
        cert_count: u32 = 0,

        ca: ?[][*c]const u8 = null,
        ca_count: u32 = 0,

        secure_options: u32 = 0,
        request_cert: i32 = 0,
        reject_unauthorized: i32 = 0,
        ssl_ciphers: [*c]const u8 = null,

        const log = Output.scoped(.SSLConfig, false);

        pub fn asUSockets(this_: ?SSLConfig) uws.us_bun_socket_context_options_t {
            var ctx_opts: uws.us_bun_socket_context_options_t = undefined;
            @memset(@ptrCast([*]u8, &ctx_opts), 0, @sizeOf(uws.us_bun_socket_context_options_t));

            if (this_) |ssl_config| {
                if (ssl_config.key_file_name != null)
                    ctx_opts.key_file_name = ssl_config.key_file_name;
                if (ssl_config.cert_file_name != null)
                    ctx_opts.cert_file_name = ssl_config.cert_file_name;
                if (ssl_config.ca_file_name != null)
                    ctx_opts.ca_file_name = ssl_config.ca_file_name;
                if (ssl_config.dh_params_file_name != null)
                    ctx_opts.dh_params_file_name = ssl_config.dh_params_file_name;
                if (ssl_config.passphrase != null)
                    ctx_opts.passphrase = ssl_config.passphrase;
                ctx_opts.ssl_prefer_low_memory_usage = @boolToInt(ssl_config.low_memory_mode);

                if (ssl_config.key) |key| {
                    ctx_opts.key = key.ptr;
                    ctx_opts.key_count = ssl_config.key_count;
                }
                if (ssl_config.cert) |cert| {
                    ctx_opts.cert = cert.ptr;
                    ctx_opts.cert_count = ssl_config.cert_count;
                }
                if (ssl_config.ca) |ca| {
                    ctx_opts.ca = ca.ptr;
                    ctx_opts.ca_count = ssl_config.ca_count;
                }

                if (ssl_config.ssl_ciphers != null) {
                    ctx_opts.ssl_ciphers = ssl_config.ssl_ciphers;
                }
                ctx_opts.request_cert = ssl_config.request_cert;
                ctx_opts.reject_unauthorized = ssl_config.reject_unauthorized;
            }

            return ctx_opts;
        }

        pub fn deinit(this: *SSLConfig) void {
            const fields = .{
                "server_name",
                "key_file_name",
                "cert_file_name",
                "ca_file_name",
                "dh_params_file_name",
                "passphrase",
                "ssl_ciphers",
            };

            inline for (fields) |field| {
                if (@field(this, field) != null) {
                    const slice = std.mem.span(@field(this, field));
                    if (slice.len > 0) {
                        bun.default_allocator.free(slice);
                    }
                }
            }

            if (this.cert) |cert| {
                var i: u32 = 0;
                while (i < this.cert_count) : (i += 1) {
                    const slice = std.mem.span(cert[i]);
                    if (slice.len > 0) {
                        bun.default_allocator.free(slice);
                    }
                }

                bun.default_allocator.free(cert);
                this.cert = null;
            }

            if (this.key) |key| {
                var i: u32 = 0;
                while (i < this.key_count) : (i += 1) {
                    const slice = std.mem.span(key[i]);
                    if (slice.len > 0) {
                        bun.default_allocator.free(slice);
                    }
                }

                bun.default_allocator.free(key);
                this.key = null;
            }

            if (this.ca) |ca| {
                var i: u32 = 0;
                while (i < this.ca_count) : (i += 1) {
                    const slice = std.mem.span(ca[i]);
                    if (slice.len > 0) {
                        bun.default_allocator.free(slice);
                    }
                }

                bun.default_allocator.free(ca);
                this.ca = null;
            }
        }

        pub const zero = SSLConfig{};

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
                        JSC.throwInvalidArguments("Unable to access keyFile path", .{}, global, exception);
                        result.deinit();

                        return null;
                    }
                    any = true;
                }
            }

            if (obj.getTruthy(global, "key")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLengthOfArray(global);
                    if (count > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, count) catch unreachable;

                        var i: u32 = 0;
                        var valid_count: u32 = 0;
                        var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                        while (i < count) : (i += 1) {
                            const item = js_obj.getIndex(global, i);
                            if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item, exception)) |sb| {
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                                    valid_count += 1;
                                    any = true;
                                }
                            } else if (BlobFileContentResult.init("key", item, global, exception)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    any = true;
                                } else {
                                    arena.deinit();
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                                arena.deinit();
                                // mark and free all keys
                                result.key = native_array;
                                result.deinit();
                                return null;
                            }
                        }

                        arena.deinit();

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.key = native_array;
                        }

                        result.key_count = valid_count;
                    }
                } else if (BlobFileContentResult.init("key", js_obj, global, exception)) |content| {
                    if (content.data.len > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                        native_array[0] = content.data.ptr;
                        result.key = native_array;
                        result.key_count = 1;
                        any = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                    var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                    if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj, exception)) |sb| {
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                            any = true;
                            result.key = native_array;
                            result.key_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                        arena.deinit();
                        // mark and free all certs
                        result.key = native_array;
                        result.deinit();
                        return null;
                    }

                    arena.deinit();
                }
            }

            if (obj.getTruthy(global, "certFile")) |cert_file_name| {
                var sliced = cert_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.cert_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.cert_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Unable to access certFile path", .{}, global, exception);
                        result.deinit();
                        return null;
                    }
                    any = true;
                }
            }

            if (obj.getTruthy(global, "cert")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLengthOfArray(global);
                    if (count > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, count) catch unreachable;

                        var i: u32 = 0;
                        var valid_count: u32 = 0;

                        var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                        while (i < count) : (i += 1) {
                            const item = js_obj.getIndex(global, i);
                            if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item, exception)) |sb| {
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                                    valid_count += 1;
                                    any = true;
                                }
                            } else if (BlobFileContentResult.init("cert", item, global, exception)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    any = true;
                                } else {
                                    arena.deinit();
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                                arena.deinit();
                                // mark and free all certs
                                result.cert = native_array;
                                result.deinit();
                                return null;
                            }
                        }

                        arena.deinit();

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.cert = native_array;
                        }

                        result.cert_count = valid_count;
                    }
                } else if (BlobFileContentResult.init("cert", js_obj, global, exception)) |content| {
                    if (content.data.len > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                        native_array[0] = content.data.ptr;
                        result.cert = native_array;
                        result.cert_count = 1;
                        any = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                    var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                    if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj, exception)) |sb| {
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                            any = true;
                            result.cert = native_array;
                            result.cert_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                        arena.deinit();
                        // mark and free all certs
                        result.cert = native_array;
                        result.deinit();
                        return null;
                    }

                    arena.deinit();
                }
            }

            if (obj.getTruthy(global, "requestCert")) |request_cert| {
                result.request_cert = if (request_cert.asBoolean()) 1 else 0;
                any = true;
            }

            if (obj.getTruthy(global, "rejectUnauthorized")) |reject_unauthorized| {
                result.reject_unauthorized = if (reject_unauthorized.asBoolean()) 1 else 0;
                any = true;
            }

            if (obj.getTruthy(global, "ciphers")) |ssl_ciphers| {
                var sliced = ssl_ciphers.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.ssl_ciphers = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    any = true;
                }
            }
            if (obj.getTruthy(global, "serverName")) |server_name| {
                var sliced = server_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.server_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    any = true;
                }
            }

            if (obj.getTruthy(global, "ca")) |js_obj| {
                if (js_obj.jsType().isArray()) {
                    const count = js_obj.getLengthOfArray(global);
                    if (count > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, count) catch unreachable;

                        var i: u32 = 0;
                        var valid_count: u32 = 0;

                        var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                        while (i < count) : (i += 1) {
                            const item = js_obj.getIndex(global, i);
                            if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item, exception)) |sb| {
                                const sliced = sb.slice();
                                if (sliced.len > 0) {
                                    native_array[valid_count] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                                    valid_count += 1;
                                    any = true;
                                }
                            } else if (BlobFileContentResult.init("ca", item, global, exception)) |content| {
                                if (content.data.len > 0) {
                                    native_array[valid_count] = content.data.ptr;
                                    valid_count += 1;
                                    any = true;
                                } else {
                                    arena.deinit();
                                    // mark and free all CA's
                                    result.cert = native_array;
                                    result.deinit();
                                    return null;
                                }
                            } else {
                                global.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                                arena.deinit();
                                // mark and free all CA's
                                result.cert = native_array;
                                result.deinit();
                                return null;
                            }
                        }

                        arena.deinit();

                        if (valid_count == 0) {
                            bun.default_allocator.free(native_array);
                        } else {
                            result.ca = native_array;
                        }

                        result.ca_count = valid_count;
                    }
                } else if (BlobFileContentResult.init("ca", js_obj, global, exception)) |content| {
                    if (content.data.len > 0) {
                        const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                        native_array[0] = content.data.ptr;
                        result.ca = native_array;
                        result.ca_count = 1;
                        any = true;
                    } else {
                        result.deinit();
                        return null;
                    }
                } else {
                    const native_array = bun.default_allocator.alloc([*c]const u8, 1) catch unreachable;
                    var arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator);
                    if (JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj, exception)) |sb| {
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[0] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                            any = true;
                            result.ca = native_array;
                            result.ca_count = 1;
                        } else {
                            bun.default_allocator.free(native_array);
                        }
                    } else {
                        JSC.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{}, global, exception);
                        arena.deinit();
                        // mark and free all certs
                        result.ca = native_array;
                        result.deinit();
                        return null;
                    }
                    arena.deinit();
                }
            }

            if (obj.getTruthy(global, "caFile")) |ca_file_name| {
                var sliced = ca_file_name.toSlice(global, bun.default_allocator);
                defer sliced.deinit();
                if (sliced.len > 0) {
                    result.ca_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                    if (std.os.system.access(result.ca_file_name, std.os.F_OK) != 0) {
                        JSC.throwInvalidArguments("Invalid caFile path", .{}, global, exception);
                        result.deinit();
                        return null;
                    }
                }
            }
            // Optional
            if (any) {
                if (obj.getTruthy(global, "secureOptions")) |secure_options| {
                    if (secure_options.isNumber()) {
                        result.secure_options = secure_options.toU32();
                    }
                }

                if (obj.getTruthy(global, "dhParamsFile")) |dh_params_file_name| {
                    var sliced = dh_params_file_name.toSlice(global, bun.default_allocator);
                    defer sliced.deinit();
                    if (sliced.len > 0) {
                        result.dh_params_file_name = bun.default_allocator.dupeZ(u8, sliced.slice()) catch unreachable;
                        if (std.os.system.access(result.dh_params_file_name, std.os.F_OK) != 0) {
                            JSC.throwInvalidArguments("Invalid dhParamsFile path", .{}, global, exception);
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

        const PORT_ENV = .{ "BUN_PORT", "PORT", "NODE_PORT" };

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
                JSC.throwInvalidArguments("Bun.serve expects an object", .{}, global, exception);
                return args;
            }

            if (arg.getTruthy(global, "webSocket") orelse arg.getTruthy(global, "websocket")) |websocket_object| {
                if (!websocket_object.isObject()) {
                    JSC.throwInvalidArguments("Expected websocket to be an object", .{}, global, exception);
                    if (args.ssl_config) |*conf| {
                        conf.deinit();
                    }
                    return args;
                }

                if (WebSocketServer.onCreate(global, websocket_object)) |wss| {
                    args.websocket = wss;
                } else {
                    if (args.ssl_config) |*conf| {
                        conf.deinit();
                    }
                    return args;
                }
            }

            if (arg.getTruthy(global, "port")) |port_| {
                args.port = @intCast(
                    u16,
                    @min(
                        @max(0, port_.coerce(i32, global)),
                        std.math.maxInt(u16),
                    ),
                );
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

            if (arg.getTruthy(global, "tls")) |tls| {
                if (SSLConfig.inJS(global, tls, exception)) |ssl_config| {
                    args.ssl_config = ssl_config;
                }

                if (exception.* != null) {
                    return args;
                }
            }

            // @compatibility Bun v0.x - v0.2.1
            // this used to be top-level, now it's "tls" object
            if (args.ssl_config == null) {
                if (SSLConfig.inJS(global, arg, exception)) |ssl_config| {
                    args.ssl_config = ssl_config;
                }

                if (exception.* != null) {
                    return args;
                }
            }

            if (arg.getTruthy(global, "maxRequestBodySize")) |max_request_body_size| {
                if (max_request_body_size.isNumber()) {
                    args.max_request_body_size = @intCast(u64, @max(0, max_request_body_size.toInt64()));
                }
            }

            if (arg.getTruthy(global, "error")) |onError| {
                if (!onError.isCallable(global.vm())) {
                    JSC.throwInvalidArguments("Expected error to be a function", .{}, global, exception);
                    if (args.ssl_config) |*conf| {
                        conf.deinit();
                    }
                    return args;
                }
                JSC.C.JSValueProtect(global, onError.asObjectRef());
                args.onError = onError;
            }

            if (arg.getTruthy(global, "fetch")) |onRequest| {
                if (!onRequest.isCallable(global.vm())) {
                    JSC.throwInvalidArguments("Expected fetch() to be a function", .{}, global, exception);
                    return args;
                }
                JSC.C.JSValueProtect(global, onRequest.asObjectRef());
                args.onRequest = onRequest;
            } else {
                JSC.throwInvalidArguments("Expected fetch() to be a function", .{}, global, exception);
                if (args.ssl_config) |*conf| {
                    conf.deinit();
                }
                return args;
            }
        }

        if (args.base_uri.len > 0) {
            args.base_url = URL.parse(args.base_uri);
            if (args.base_url.hostname.len == 0) {
                JSC.throwInvalidArguments("baseURI must have a hostname", .{}, global, exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            if (!strings.isAllASCII(args.base_uri)) {
                JSC.throwInvalidArguments("Unicode baseURI must already be encoded for now.\nnew URL(baseuRI).toString() should do the trick.", .{}, global, exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            if (args.base_url.protocol.len == 0) {
                const protocol: string = if (args.ssl_config != null) "https" else "http";
                const hostname = args.base_url.hostname;
                const needsBrackets: bool = strings.isIPV6Address(hostname) and hostname[0] != '[';
                if (needsBrackets) {
                    args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                        std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]/{s}", .{
                            protocol,
                            hostname,
                            strings.trimLeadingChar(args.base_url.pathname, '/'),
                        })
                    else
                        std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]:{d}/{s}", .{
                            protocol,
                            hostname,
                            args.port,
                            strings.trimLeadingChar(args.base_url.pathname, '/'),
                        })) catch unreachable;
                } else {
                    args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                        std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/{s}", .{
                            protocol,
                            hostname,
                            strings.trimLeadingChar(args.base_url.pathname, '/'),
                        })
                    else
                        std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/{s}", .{
                            protocol,
                            hostname,
                            args.port,
                            strings.trimLeadingChar(args.base_url.pathname, '/'),
                        })) catch unreachable;
                }

                args.base_url = URL.parse(args.base_uri);
            }
        } else {
            const hostname: string =
                if (has_hostname and std.mem.span(args.hostname).len > 0) std.mem.span(args.hostname) else "0.0.0.0";

            const needsBrackets: bool = strings.isIPV6Address(hostname) and hostname[0] != '[';

            const protocol: string = if (args.ssl_config != null) "https" else "http";
            if (needsBrackets) {
                args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                    std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]/", .{
                        protocol,
                        hostname,
                    })
                else
                    std.fmt.allocPrint(bun.default_allocator, "{s}://[{s}]:{d}/", .{ protocol, hostname, args.port })) catch unreachable;
            } else {
                args.base_uri = (if ((args.port == 80 and args.ssl_config == null) or (args.port == 443 and args.ssl_config != null))
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}/", .{
                        protocol,
                        hostname,
                    })
                else
                    std.fmt.allocPrint(bun.default_allocator, "{s}://{s}:{d}/", .{ protocol, hostname, args.port })) catch unreachable;
            }

            if (!strings.isAllASCII(hostname)) {
                JSC.throwInvalidArguments("Unicode hostnames must already be encoded for now.\nnew URL(input).hostname should do the trick.", .{}, global, exception);
                bun.default_allocator.free(bun.constStrToU8(args.base_uri));
                args.base_uri = "";
                return args;
            }

            args.base_url = URL.parse(args.base_uri);
        }

        // I don't think there's a case where this can happen
        // but let's check anyway, just in case
        if (args.base_url.hostname.len == 0) {
            JSC.throwInvalidArguments("baseURI must have a hostname", .{}, global, exception);
            bun.default_allocator.free(bun.constStrToU8(args.base_uri));
            args.base_uri = "";
            return args;
        }

        if (args.base_url.username.len > 0 or args.base_url.password.len > 0) {
            JSC.throwInvalidArguments("baseURI can't have a username or password", .{}, global, exception);
            bun.default_allocator.free(bun.constStrToU8(args.base_uri));
            args.base_uri = "";
            return args;
        }

        return args;
    }
};

const HTTPStatusText = struct {
    pub fn get(code: u16) ?[]const u8 {
        return switch (code) {
            100 => "100 Continue",
            101 => "101 Switching protocols",
            102 => "102 Processing",
            103 => "103 Early Hints",
            200 => "200 OK",
            201 => "201 Created",
            202 => "202 Accepted",
            203 => "203 Non-Authoritative Information",
            204 => "204 No Content",
            205 => "205 Reset Content",
            206 => "206 Partial Content",
            207 => "207 Multi-Status",
            208 => "208 Already Reported",
            226 => "226 IM Used",
            300 => "300 Multiple Choices",
            301 => "301 Moved Permanently",
            302 => "302 Found",
            303 => "303 See Other",
            304 => "304 Not Modified",
            305 => "305 Use Proxy",
            306 => "306 Switch Proxy",
            307 => "307 Temporary Redirect",
            308 => "308 Permanent Redirect",
            400 => "400 Bad Request",
            401 => "401 Unauthorized",
            402 => "402 Payment Required",
            403 => "403 Forbidden",
            404 => "404 Not Found",
            405 => "405 Method Not Allowed",
            406 => "406 Not Acceptable",
            407 => "407 Proxy Authentication Required",
            408 => "408 Request Timeout",
            409 => "409 Conflict",
            410 => "410 Gone",
            411 => "411 Length Required",
            412 => "412 Precondition Failed",
            413 => "413 Payload Too Large",
            414 => "414 URI Too Long",
            415 => "415 Unsupported Media Type",
            416 => "416 Range Not Satisfiable",
            417 => "417 Expectation Failed",
            418 => "418 I'm a Teapot",
            421 => "421 Misdirected Request",
            422 => "422 Unprocessable Entity",
            423 => "423 Locked",
            424 => "424 Failed Dependency",
            425 => "425 Too Early",
            426 => "426 Upgrade Required",
            428 => "428 Precondition Required",
            429 => "429 Too Many Requests",
            431 => "431 Request Header Fields Too Large",
            451 => "451 Unavailable For Legal Reasons",
            500 => "500 Internal Server Error",
            501 => "501 Not Implemented",
            502 => "502 Bad Gateway",
            503 => "503 Service Unavailable",
            504 => "504 Gateway Timeout",
            505 => "505 HTTP Version Not Supported",
            506 => "506 Variant Also Negotiates",
            507 => "507 Insufficient Storage",
            508 => "508 Loop Detected",
            510 => "510 Not Extended",
            511 => "511 Network Authentication Required",
            else => null,
        };
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
            return .{
                .ptr = this,
                .vtable = &.{
                    .alloc = alloc,
                    .resize = resize,
                    .free = free,
                },
            };
        }

        fn alloc(self_: *anyopaque, a: usize, b: u8, d: usize) ?[*]u8 {
            const self = @ptrCast(*@This(), @alignCast(@alignOf(@This()), self_));
            if (self.unused.findFirstSet()) |i| {
                self.unused.unset(i);
                return std.mem.asBytes(&self.buf[i]);
            }

            return self.fallback_allocator.rawAlloc(a, b, d);
        }

        fn resize(
            _: *anyopaque,
            _: []u8,
            _: u8,
            _: usize,
            _: usize,
        ) bool {
            unreachable;
        }

        fn sliceContainsSlice(container: []u8, slice: []u8) bool {
            return @ptrToInt(slice.ptr) >= @ptrToInt(container.ptr) and
                (@ptrToInt(slice.ptr) + slice.len) <= (@ptrToInt(container.ptr) + container.len);
        }

        fn free(
            self_: *anyopaque,
            buf: []u8,
            buf_align: u8,
            return_address: usize,
        ) void {
            const self = @ptrCast(*@This(), @alignCast(@alignOf(@This()), self_));
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
        const ctxLog = Output.scoped(.RequestContext, false);
        const App = uws.NewApp(ssl_enabled);
        pub threadlocal var pool: ?*RequestContext.RequestContextStackAllocator = null;
        pub threadlocal var pool_allocator: std.mem.Allocator = undefined;
        pub const ResponseStream = JSC.WebCore.HTTPServerWritable(ssl_enabled);
        pub const RequestContextStackAllocator = NewRequestContextStackAllocator(RequestContext, 2048);
        pub const name = "HTTPRequestContext" ++ (if (debug_mode) "Debug" else "") ++ (if (ThisServer.ssl_enabled) "TLS" else "");
        pub const shim = JSC.Shimmer("Bun", name, @This());

        server: *ThisServer,
        resp: ?*App.Response,
        /// thread-local default heap allocator
        /// this prevents an extra pthread_getspecific() call which shows up in profiling
        allocator: std.mem.Allocator,
        req: *uws.Request,
        signal: ?*JSC.WebCore.AbortSignal = null,
        method: HTTP.Method,
        aborted: bool = false,
        finalized: bun.DebugOnly(bool) = bun.DebugOnlyDefault(false),
        upgrade_context: ?*uws.uws_socket_context_t = null,

        /// We can only safely free once the request body promise is finalized
        /// and the response is rejected
        pending_promises_for_abort: u8 = 0,

        has_marked_complete: bool = false,
        has_marked_pending: bool = false,

        response_jsvalue: JSC.JSValue = JSC.JSValue.zero,
        response_protected: bool = false,
        response_ptr: ?*JSC.WebCore.Response = null,
        blob: JSC.WebCore.AnyBlob = JSC.WebCore.AnyBlob{ .Blob = .{} },
        promise: ?*JSC.JSValue = null,
        has_abort_handler: bool = false,
        has_sendfile_ctx: bool = false,
        has_called_error_handler: bool = false,
        needs_content_length: bool = false,
        needs_content_range: bool = false,
        sendfile: SendfileContext = undefined,
        request_body: ?*JSC.WebCore.BodyValueRef = null,
        request_body_buf: std.ArrayListUnmanaged(u8) = .{},
        request_body_content_len: usize = 0,

        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_transfer_encoding: bool = false,

        /// Used to identify if request can be safely deinitialized
        is_waiting_body: bool = false,

        /// Used in renderMissing in debug mode to show the user an HTML page
        /// Used to avoid looking at the uws.Request struct after it's been freed
        is_web_browser_navigation: if (debug_mode) bool else void = if (debug_mode) false else {},

        sink: ?*ResponseStream.JSSink = null,
        byte_stream: ?*JSC.WebCore.ByteStream = null,

        /// Used in errors
        pathname: []const u8 = "",

        has_written_status: bool = false,

        /// Used either for temporary blob data or fallback
        /// When the response body is a temporary value
        response_buf_owned: std.ArrayListUnmanaged(u8) = .{},

        keepalive: bool = true,

        // TODO: support builtin compression
        const can_sendfile = !ssl_enabled;

        pub fn setAbortHandler(this: *RequestContext) void {
            if (this.has_abort_handler) return;
            if (this.resp) |resp| {
                this.has_abort_handler = true;
                resp.onAborted(*RequestContext, RequestContext.onAbort, this);
            }
        }

        pub fn onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            ctxLog("onResolve", .{});

            const arguments = callframe.arguments(2);
            var ctx = arguments.ptr[1].asPromisePtr(@This());
            const result = arguments.ptr[0];
            result.ensureStillAlive();

            ctx.pending_promises_for_abort -|= 1;
            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return JSValue.jsUndefined();
            }

            if (ctx.didUpgradeWebSocket()) {
                ctx.finalize();
                return JSValue.jsUndefined();
            }

            handleResolve(ctx, result);
            return JSValue.jsUndefined();
        }

        fn handleResolve(ctx: *RequestContext, value: JSC.JSValue) void {
            if (value.isEmptyOrUndefinedOrNull() or !value.isCell()) {
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
            std.debug.assert(!ctx.response_protected);
            ctx.response_protected = true;
            JSC.C.JSValueProtect(ctx.server.globalThis, value.asObjectRef());

            ctx.render(response);
        }

        pub fn finalizeForAbort(this: *RequestContext) void {
            streamLog("finalizeForAbort", .{});
            this.pending_promises_for_abort -|= 1;
            if (this.pending_promises_for_abort == 0) this.finalize();
        }

        pub fn onReject(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            ctxLog("onReject", .{});

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
            if (ctx.resp == null) {
                ctx.finalizeForAbort();
                return;
            }
            const resp = ctx.resp.?;
            const has_responded = resp.hasResponded();
            if (!has_responded)
                ctx.runErrorHandler(
                    value,
                );

            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return;
            }

            // I don't think this case happens?
            if (ctx.didUpgradeWebSocket()) {
                ctx.finalize();
                return;
            }

            if (!resp.hasResponded() and !ctx.has_marked_pending) {
                ctx.renderMissing();
                return;
            }
        }

        pub fn renderMissing(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                resp.runCorkedWithType(*RequestContext, renderMissingCorked, ctx);
            }
            ctx.finalize();
        }

        pub fn renderMissingCorked(ctx: *RequestContext) void {
            if (ctx.resp) |resp| {
                if (comptime !debug_mode) {
                    if (!ctx.has_written_status)
                        resp.writeStatus("204 No Content");
                    ctx.has_written_status = true;
                    ctx.end("", ctx.shouldCloseConnection());
                } else {
                    if (ctx.is_web_browser_navigation) {
                        resp.writeStatus("200 OK");
                        ctx.has_written_status = true;

                        resp.writeHeader("content-type", MimeType.html.value);
                        resp.writeHeader("content-encoding", "gzip");
                        resp.writeHeaderInt("content-length", welcome_page_html_gz.len);
                        ctx.end(welcome_page_html_gz, ctx.shouldCloseConnection());
                        return;
                    }

                    if (!ctx.has_written_status)
                        resp.writeStatus("200 OK");
                    ctx.has_written_status = true;
                    ctx.end("Welcome to Bun! To get started, return a Response object.", ctx.shouldCloseConnection());
                }
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
                if (this.resp) |resp| {
                    resp.writeStatus("500 Internal Server Error");
                    resp.writeHeader("content-type", MimeType.html.value);
                }
            }

            const allocator = this.allocator;

            var fallback_container = allocator.create(Api.FallbackMessageContainer) catch unreachable;
            defer allocator.destroy(fallback_container);
            fallback_container.* = Api.FallbackMessageContainer{
                .message = std.fmt.allocPrint(allocator, comptime Output.prettyFmt(fmt, false), args) catch unreachable,
                .router = null,
                .reason = .fetch_event_handler,
                .cwd = VirtualMachine.get().bundler.fs.top_level_dir,
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
            if (this.resp == null or this.resp.?.tryEnd(bb.items, bb.items.len, this.shouldCloseConnection())) {
                bb.clearAndFree();
                this.finalizeWithoutDeinit();
                return;
            }

            this.has_marked_pending = true;
            this.response_buf_owned = std.ArrayListUnmanaged(u8){ .items = bb.items, .capacity = bb.capacity };

            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }
            this.setAbortHandler();
        }

        pub fn renderResponseBuffer(this: *RequestContext) void {
            if (this.resp) |resp| {
                resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
            }
        }

        /// Render a complete response buffer
        pub fn renderResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();

                if (!resp.tryEnd(
                    this.response_buf_owned.items,
                    this.response_buf_owned.items.len,
                    this.shouldCloseConnection(),
                )) {
                    this.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
                    this.setAbortHandler();
                    return;
                }
            }
            this.finalize();
        }

        /// Drain a partial response buffer
        pub fn drainResponseBufferAndMetadata(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();
                this.setAbortHandler();

                _ = resp.write(
                    this.response_buf_owned.items,
                );
            }
            this.response_buf_owned.items.len = 0;
        }

        pub fn end(this: *RequestContext, data: []const u8, closeConnection: bool) void {
            if (this.resp) |resp| {
                if (this.is_waiting_body) {
                    this.is_waiting_body = false;
                    resp.clearOnData();
                }
                resp.end(data, closeConnection);
                this.resp = null;
            }
        }

        pub fn endStream(this: *RequestContext, closeConnection: bool) void {
            if (this.resp) |resp| {
                if (this.is_waiting_body) {
                    this.is_waiting_body = false;
                    resp.clearOnData();
                }
                resp.endStream(closeConnection);
                this.resp = null;
            }
        }

        pub fn endWithoutBody(this: *RequestContext, closeConnection: bool) void {
            if (this.resp) |resp| {
                if (this.is_waiting_body) {
                    this.is_waiting_body = false;
                    resp.clearOnData();
                }
                resp.endWithoutBody(closeConnection);
                this.resp = null;
            }
        }

        pub fn onWritableResponseBuffer(this: *RequestContext, _: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);
            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }
            this.end("", this.shouldCloseConnection());
            this.finalize();
            return false;
        }

        // TODO: should we cork?
        pub fn onWritableCompleteResponseBufferAndMetadata(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);

            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }

            if (!this.has_written_status) {
                this.renderMetadata();
            }

            if (this.method == .HEAD) {
                this.end("", this.shouldCloseConnection());
                this.finalize();
                return false;
            }

            return this.sendWritableBytesForCompleteResponseBuffer(this.response_buf_owned.items, write_offset, resp);
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
                .method = HTTP.Method.which(req.method()) orelse .GET,
                .server = server,
            };
        }

        pub fn isDeadRequest(this: *RequestContext) bool {
            if (this.pending_promises_for_abort > 0) return false;

            if (this.promise != null) {
                return false;
            }

            if (this.request_body) |body| {
                if (body.value == .Locked) {
                    return false;
                }
            }

            return true;
        }

        pub fn onAbort(this: *RequestContext, resp: *App.Response) void {
            std.debug.assert(this.resp == resp);
            std.debug.assert(!this.aborted);
            //mark request as aborted
            this.aborted = true;

            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                if (!signal.aborted()) {
                    const reason = JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.server.globalThis);
                    reason.ensureStillAlive();
                    _ = signal.signal(reason);
                }
                _ = signal.unref();
            }

            //if have sink, call onAborted on sink
            if (this.sink) |wrapper| {
                wrapper.sink.abort();
                return;
            }

            // if we can, free the request now.
            if (this.isDeadRequest()) {
                this.finalizeWithoutDeinit();
                this.markComplete();
                this.deinit();
            } else {
                this.pending_promises_for_abort = 0;

                // if we cannot, we have to reject pending promises
                // first, we reject the request body promise
                if (this.request_body) |body| {
                    // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                    // but we received nothing or the connection was aborted

                    if (body.value == .Locked) {
                        // the promise is pending
                        if (body.value.Locked.action != .none or body.value.Locked.promise != null) {
                            this.pending_promises_for_abort += 1;
                            body.value.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                        } else if (body.value.Locked.readable != null) {
                            body.value.Locked.readable.?.abort(this.server.globalThis);
                            body.value.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                            body.value.Locked.readable = null;
                        }
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
                    promise.asAnyPromise().?.reject(this.server.globalThis, JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis));
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
            ctxLog("finalizeWithoutDeinit", .{});
            this.blob.detach();

            if (comptime Environment.allow_assert) {
                std.debug.assert(!this.finalized);
                this.finalized = true;
            }

            if (!this.response_jsvalue.isEmpty()) {
                ctxLog("finalizeWithoutDeinit: response_jsvalue != .zero", .{});
                if (this.response_protected) {
                    this.response_jsvalue.unprotect();
                    this.response_protected = false;
                }
                this.response_jsvalue = JSC.JSValue.zero;
            }

            // if signal is not aborted, abort the signal
            if (this.signal) |signal| {
                this.signal = null;
                if (this.aborted and !signal.aborted()) {
                    const reason = JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.server.globalThis);
                    reason.ensureStillAlive();
                    _ = signal.signal(reason);
                }
                _ = signal.unref();
            }

            if (this.request_body) |body| {
                ctxLog("finalizeWithoutDeinit: request_body != null", .{});
                // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
                // but we received nothing or the connection was aborted
                // the promise is pending
                if (body.value == .Locked and body.value.Locked.action != .none and body.value.Locked.promise != null) {
                    body.value.toErrorInstance(JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis), this.server.globalThis);
                }
            }

            if (this.promise) |promise| {
                ctxLog("finalizeWithoutDeinit: this.promise != null", .{});
                this.promise = null;

                if (promise.asAnyPromise()) |prom| {
                    prom.rejectAsHandled(this.server.globalThis, (JSC.toTypeError(.ABORT_ERR, "Request aborted", .{}, this.server.globalThis)));
                }
                JSC.C.JSValueUnprotect(this.server.globalThis, promise.asObjectRef());
            }

            if (this.byte_stream) |stream| {
                ctxLog("finalizeWithoutDeinit: stream != null", .{});

                this.byte_stream = null;
                stream.unpipe();
            }

            if (this.pathname.len > 0) {
                ctxLog("finalizeWithoutDeinit: this.pathname.len > 0 null", .{});
                this.allocator.free(bun.constStrToU8(this.pathname));
                this.pathname = "";
            }

            // if we are waiting for the body yet and the request was not aborted we can safely clear the onData callback
            if (this.resp) |resp| {
                if (this.is_waiting_body and this.aborted == false) {
                    resp.clearOnData();
                    this.is_waiting_body = false;
                }
            }
        }
        pub fn finalize(this: *RequestContext) void {
            ctxLog("finalize", .{});
            this.finalizeWithoutDeinit();
            this.markComplete();
            this.deinit();
        }

        pub fn deinit(this: *RequestContext) void {
            ctxLog("deinit", .{});
            if (comptime Environment.allow_assert)
                std.debug.assert(this.finalized);

            if (comptime Environment.allow_assert)
                std.debug.assert(this.has_marked_complete);

            var server = this.server;
            this.request_body_buf.clearAndFree(this.allocator);
            this.response_buf_owned.clearAndFree(this.allocator);

            if (this.request_body) |body| {
                _ = body.unref();
                this.request_body = null;
            }

            server.request_pool_allocator.destroy(this);
        }

        fn writeHeaders(
            this: *RequestContext,
            headers: *JSC.FetchHeaders,
        ) void {
            headers.fastRemove(.ContentLength);
            headers.fastRemove(.TransferEncoding);
            if (!ssl_enabled) headers.fastRemove(.StrictTransportSecurity);
            if (this.resp) |resp| {
                headers.toUWSResponse(ssl_enabled, resp);
            }
        }

        pub fn writeStatus(this: *RequestContext, status: u16) void {
            var status_text_buf: [48]u8 = undefined;
            std.debug.assert(!this.has_written_status);
            this.has_written_status = true;

            if (this.resp) |resp| {
                if (HTTPStatusText.get(status)) |text| {
                    resp.writeStatus(text);
                } else {
                    resp.writeStatus(std.fmt.bufPrint(&status_text_buf, "{d} HM", .{status}) catch unreachable);
                }
            }
        }

        fn cleanupAndFinalizeAfterSendfile(this: *RequestContext) void {
            if (this.resp) |resp| {
                resp.overrideWriteOffset(this.sendfile.offset);
                this.endWithoutBody(this.shouldCloseConnection());
            }
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
            if (this.aborted or this.resp == null) {
                this.cleanupAndFinalizeAfterSendfile();
                return false;
            }
            const resp = this.resp.?;

            const adjusted_count_temporary = @min(@as(u64, this.sendfile.remain), @as(u63, std.math.maxInt(u63)));
            // TODO we should not need this int cast; improve the return type of `@min`
            const adjusted_count = @intCast(u63, adjusted_count_temporary);

            if (Environment.isLinux) {
                var signed_offset = @intCast(i64, this.sendfile.offset);
                const start = this.sendfile.offset;
                const val =
                    // this does the syscall directly, without libc
                    linux.sendfile(this.sendfile.socket_fd, this.sendfile.fd, &signed_offset, this.sendfile.remain);
                this.sendfile.offset = @intCast(Blob.SizeType, signed_offset);

                const errcode = linux.getErrno(val);

                this.sendfile.remain -|= @intCast(Blob.SizeType, this.sendfile.offset -| start);

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
                this.sendfile.offset +|= wrote;
                this.sendfile.remain -|= wrote;
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
                this.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableSendfile, this);
            }

            this.setAbortHandler();
            resp.markNeedsMore();

            return true;
        }

        pub fn onWritableBytes(this: *RequestContext, write_offset: c_ulong, resp: *App.Response) callconv(.C) bool {
            std.debug.assert(this.resp == resp);
            if (this.aborted) {
                this.finalizeForAbort();
                return false;
            }

            // Copy to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();

            _ = this.sendWritableBytesForBlob(bytes, write_offset, resp);
            return true;
        }

        pub fn sendWritableBytesForBlob(this: *RequestContext, bytes_: []const u8, write_offset: c_ulong, resp: *App.Response) bool {
            std.debug.assert(this.resp == resp);

            var bytes = bytes_[@min(bytes_.len, @truncate(usize, write_offset))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.finalize();
                return true;
            } else {
                this.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableBytes, this);
                return true;
            }
        }

        pub fn sendWritableBytesForCompleteResponseBuffer(this: *RequestContext, bytes_: []const u8, write_offset: c_ulong, resp: *App.Response) bool {
            std.debug.assert(this.resp == resp);

            var bytes = bytes_[@min(bytes_.len, @truncate(usize, write_offset))..];
            if (resp.tryEnd(bytes, bytes_.len, this.shouldCloseConnection())) {
                this.response_buf_owned.items.len = 0;
                this.finalize();
            } else {
                this.has_marked_pending = true;
                resp.onWritable(*RequestContext, onWritableCompleteResponseBuffer, this);
            }

            return true;
        }

        pub fn onWritableSendfile(this: *RequestContext, _: c_ulong, _: *App.Response) callconv(.C) bool {
            return this.onSendfile();
        }

        // We tried open() in another thread for this
        // it was not faster due to the mountain of syscalls
        pub fn renderSendFile(this: *RequestContext, blob: JSC.WebCore.Blob) void {
            if (this.resp == null) return;
            const resp = this.resp.?;

            this.blob = .{ .Blob = blob };
            const file = &this.blob.store().?.data.file;
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
                    this.runErrorHandler(err.withPathLike(file.pathlike).toSystemError().toErrorInstance(
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
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toSystemError();
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
                        .syscall = .sendfile,
                    };
                    var sys = err.withPathLike(file.pathlike).toSystemError();
                    sys.message = ZigString.init("File must be regular or FIFO");
                    this.runErrorHandler(sys.toErrorInstance(
                        this.server.globalThis,
                    ));
                    return;
                }
            }

            const original_size = this.blob.Blob.size;
            const stat_size = @intCast(Blob.SizeType, stat.size);
            this.blob.Blob.size = if (std.os.S.ISREG(stat.mode))
                stat_size
            else
                @min(original_size, stat_size);

            this.needs_content_length = true;

            this.sendfile = .{
                .fd = fd,
                .remain = this.blob.Blob.offset + original_size,
                .offset = this.blob.Blob.offset,
                .auto_close = auto_close,
                .socket_fd = if (!this.aborted) resp.getNativeHandle() else -999,
            };

            // if we are sending only part of a file, include the content-range header
            // only include content-range automatically when using a file path instead of an fd
            // this is to better support manually controlling the behavior
            if (std.os.S.ISREG(stat.mode) and auto_close) {
                this.needs_content_range = (this.sendfile.remain -| this.sendfile.offset) != stat_size;
            }

            // we know the bounds when we are sending a regular file
            if (std.os.S.ISREG(stat.mode)) {
                this.sendfile.offset = @min(this.sendfile.offset, stat_size);
                this.sendfile.remain = @min(@max(this.sendfile.remain, this.sendfile.offset), stat_size) -| this.sendfile.offset;
            }

            resp.runCorkedWithType(*RequestContext, renderMetadataAndNewline, this);

            if (this.sendfile.remain == 0 or !this.method.hasBody()) {
                this.cleanupAndFinalizeAfterSendfile();
                return;
            }

            _ = this.onSendfile();
        }

        pub fn renderMetadataAndNewline(this: *RequestContext) void {
            if (this.resp) |resp| {
                this.renderMetadata();
                resp.prepareForSendfile();
            }
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
            this.blob.Blob.doReadFileInternal(*RequestContext, this, onReadFile, this.server.globalThis);
        }

        pub fn onReadFile(this: *RequestContext, result: Blob.Store.ReadFile.ResultType) void {
            if (this.aborted or this.resp == null) {
                this.finalizeForAbort();
                return;
            }

            if (result == .err) {
                this.runErrorHandler(result.err.toErrorInstance(this.server.globalThis));
                return;
            }

            const is_temporary = result.result.is_temporary;
            if (!is_temporary) {
                this.blob.Blob.resolveSize();
                this.doRenderBlob();
            } else {
                const stat_size = @intCast(Blob.SizeType, result.result.total_size);
                const original_size = this.blob.Blob.size;

                this.blob.Blob.size = if (original_size == 0 or original_size == Blob.max_size)
                    stat_size
                else
                    @min(original_size, stat_size);

                if (!this.has_written_status)
                    this.needs_content_range = true;

                // this is used by content-range
                this.sendfile = .{
                    .fd = @truncate(i32, bun.invalid_fd),
                    .remain = @truncate(Blob.SizeType, result.result.buf.len),
                    .offset = this.blob.Blob.offset,
                    .auto_close = false,
                    .socket_fd = -999,
                };

                this.response_buf_owned = .{ .items = result.result.buf, .capacity = result.result.buf.len };
                this.resp.?.runCorkedWithType(*RequestContext, renderResponseBufferAndMetadata, this);
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
                    this.doSendfile(this.blob.Blob);
                return;
            }

            this.doRenderBlob();
        }

        const StreamPair = struct { this: *RequestContext, stream: JSC.WebCore.ReadableStream };

        fn doRenderStream(pair: *StreamPair) void {
            var this = pair.this;
            var stream = pair.stream;
            if (this.resp == null or this.aborted) {
                stream.value.unprotect();
                this.finalizeForAbort();
                return;
            }
            const resp = this.resp.?;

            // uWS automatically adds the status line if needed
            // we want to batch network calls as much as possible
            if (!(this.response_ptr.?.statusCode() == 200 and this.response_ptr.?.body.init.headers == null)) {
                this.renderMetadata();
            }

            stream.value.ensureStillAlive();

            var response_stream = this.allocator.create(ResponseStream.JSSink) catch unreachable;
            response_stream.* = ResponseStream.JSSink{
                .sink = .{
                    .res = resp,
                    .allocator = this.allocator,
                    .buffer = bun.ByteList{},
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
                if (resp.hasResponded()) {
                    streamLog("responded", .{});
                }
            }

            this.aborted = this.aborted or response_stream.sink.aborted;

            if (assignment_result.toError()) |err_value| {
                streamLog("returned an error", .{});
                if (!this.aborted) resp.clearAborted();
                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                stream.value.unprotect();
                return this.handleReject(err_value);
            }

            if (response_stream.sink.done or
                // TODO: is there a condition where resp could be freed before done?
                resp.hasResponded())
            {
                if (!this.aborted) resp.clearAborted();
                const wrote_anything = response_stream.sink.wrote > 0;
                streamLog("is done", .{});
                const responded = resp.hasResponded();

                response_stream.detach();
                this.sink = null;
                response_stream.sink.destroy();
                if (!responded and !wrote_anything and !this.aborted) {
                    this.renderMissing();
                    return;
                } else if (wrote_anything and !responded and !this.aborted) {
                    this.endStream(this.shouldCloseConnection());
                }

                this.finalize();
                stream.value.unprotect();

                return;
            }

            if (!assignment_result.isEmptyOrUndefinedOrNull()) {
                assignment_result.ensureStillAlive();
                // it returns a Promise when it goes through ReadableStreamDefaultReader
                if (assignment_result.asAnyPromise()) |promise| {
                    streamLog("returned a promise", .{});
                    switch (promise.status(this.server.globalThis.vm())) {
                        .Pending => {
                            streamLog("promise still Pending", .{});
                            // TODO: should this timeout?
                            this.setAbortHandler();
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
                            streamLog("promise Fulfilled", .{});
                            this.handleResolveStream();
                        },
                        .Rejected => {
                            streamLog("promise Rejected", .{});
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

            const is_in_progress = response_stream.sink.has_backpressure or !(response_stream.sink.wrote == 0 and
                response_stream.sink.buffer.len == 0);

            if (!stream.isLocked(this.server.globalThis) and !is_in_progress) {
                if (JSC.WebCore.ReadableStream.fromJS(stream.value, this.server.globalThis)) |comparator| {
                    if (std.meta.activeTag(comparator.ptr) == std.meta.activeTag(stream.ptr)) {
                        streamLog("is not locked", .{});
                        this.renderMissing();
                        return;
                    }
                }
            }

            this.setAbortHandler();
            streamLog("is in progress, but did not return a Promise. Finalizing request context", .{});
            this.finalize();
            stream.value.unprotect();
        }

        const streamLog = Output.scoped(.ReadableStream, false);

        pub fn didUpgradeWebSocket(this: *RequestContext) bool {
            return @ptrToInt(this.upgrade_context) == std.math.maxInt(usize);
        }

        pub fn onResponse(
            ctx: *RequestContext,
            this: *ThisServer,
            req: *uws.Request,
            request_object: *Request,
            request_value: JSValue,
            response_value: JSValue,
        ) void {
            request_value.ensureStillAlive();
            response_value.ensureStillAlive();

            if (ctx.aborted) {
                ctx.finalizeForAbort();
                return;
            }

            // if you return a Response object or a Promise<Response>
            // but you upgraded the connection to a WebSocket
            // just ignore the Response object. It doesn't do anything.
            // it's better to do that than to throw an error
            if (ctx.didUpgradeWebSocket()) {
                ctx.finalize();
                return;
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                ctx.renderMissing();
                return;
            }

            if (response_value.toError()) |err_value| {
                ctx.runErrorHandler(err_value);
                return;
            }

            if (response_value.as(JSC.WebCore.Response)) |response| {
                ctx.response_jsvalue = response_value;
                ctx.response_jsvalue.ensureStillAlive();
                ctx.response_protected = false;
                response.body.value.toBlobIfPossible();

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
            var vm = this.vm;

            if (response_value.asAnyPromise()) |promise| {
                // If we immediately have the value available, we can skip the extra event loop tick
                switch (promise.status(vm.global.vm())) {
                    .Pending => {},
                    .Fulfilled => {
                        const fulfilled_value = promise.result(vm.global.vm());

                        // if you return a Response object or a Promise<Response>
                        // but you upgraded the connection to a WebSocket
                        // just ignore the Response object. It doesn't do anything.
                        // it's better to do that than to throw an error
                        if (ctx.didUpgradeWebSocket()) {
                            ctx.finalize();
                            return;
                        }

                        if (fulfilled_value.isEmptyOrUndefinedOrNull()) {
                            ctx.renderMissing();
                            return;
                        }
                        var response = fulfilled_value.as(JSC.WebCore.Response) orelse {
                            ctx.renderMissing();
                            return;
                        };

                        ctx.response_jsvalue = fulfilled_value;
                        ctx.response_jsvalue.ensureStillAlive();
                        ctx.response_protected = false;
                        ctx.response_ptr = response;
                        response.body.value.toBlobIfPossible();
                        switch (response.body.value) {
                            .Blob => |*blob| {
                                if (blob.needsToReadFile()) {
                                    fulfilled_value.protect();
                                    ctx.response_protected = true;
                                }
                            },
                            .Locked => {
                                fulfilled_value.protect();
                                ctx.response_protected = true;
                            },
                            else => {},
                        }
                        ctx.render(response);
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
                request_object.uws_request = req;

                request_object.ensureURL() catch {
                    request_object.url = "";
                };

                // we have to clone the request headers here since they will soon belong to a different request
                if (request_object.headers == null) {
                    request_object.headers = JSC.FetchHeaders.createFromUWS(this.globalThis, req);
                }

                if (comptime debug_mode) {
                    ctx.pathname = bun.default_allocator.dupe(u8, request_object.url) catch unreachable;
                }

                // This object dies after the stack frame is popped
                // so we have to clear it in here too
                request_object.uws_request = null;

                ctx.setAbortHandler();
                ctx.pending_promises_for_abort += 1;

                response_value.then(this.globalThis, ctx, RequestContext.onResolve, RequestContext.onReject);
                return;
            }
            if (ctx.resp) |resp| {
                // The user returned something that wasn't a promise or a promise with a response
                if (!resp.hasResponded() and !ctx.has_marked_pending) ctx.renderMissing();
            }
        }

        pub fn handleResolveStream(req: *RequestContext) void {
            streamLog("handleResolveStream", .{});

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

            streamLog("onResolve({any})", .{wrote_anything});

            //aborted so call finalizeForAbort
            if (req.aborted or req.resp == null) {
                req.finalizeForAbort();
                return;
            }
            const resp = req.resp.?;

            const responded = resp.hasResponded();

            if (!responded and !wrote_anything) {
                resp.clearAborted();
                req.renderMissing();
                return;
            } else if (!responded and wrote_anything) {
                resp.clearAborted();
                req.endStream(req.shouldCloseConnection());
            }

            req.finalize();
        }

        pub fn onResolveStream(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            streamLog("onResolveStream", .{});
            var args = callframe.arguments(2);
            var req: *@This() = args.ptr[args.len - 1].asPromisePtr(@This());
            req.handleResolveStream();
            return JSValue.jsUndefined();
        }
        pub fn onRejectStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            streamLog("onRejectStream", .{});
            const args = callframe.arguments(2);
            var req = args.ptr[args.len - 1].asPromisePtr(@This());
            var err = args.ptr[0];
            req.handleRejectStream(globalThis, err);
            return JSValue.jsUndefined();
        }

        pub fn handleRejectStream(req: *@This(), globalThis: *JSC.JSGlobalObject, err: JSValue) void {
            streamLog("handleRejectStream", .{});
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

            streamLog("onReject({any})", .{wrote_anything});

            //aborted so call finalizeForAbort
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
                req.endStream(true);
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
            value.toBlobIfPossible();

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
                // .InlineBlob,
                .InternalBlob,
                .Blob,
                => {
                    this.blob = value.useAsAnyBlob();
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

                            // toBlobIfPossible should've caught this
                            .Blob, .File => unreachable,

                            .JavaScript, .Direct => {
                                if (this.resp) |resp| {
                                    var pair = StreamPair{ .stream = stream, .this = this };
                                    resp.runCorkedWithType(*StreamPair, doRenderStream, &pair);
                                }
                                return;
                            },

                            .Bytes => |byte_stream| {
                                std.debug.assert(byte_stream.pipe.ctx == null);
                                std.debug.assert(this.byte_stream == null);

                                stream.detach(this.server.globalThis);

                                if (this.resp == null) {
                                    byte_stream.parent().deinit();
                                    return;
                                }
                                const resp = this.resp.?;

                                // If we've received the complete body by the time this function is called
                                // we can avoid streaming it and just send it all at once.
                                if (byte_stream.has_received_last_chunk) {
                                    this.blob.from(byte_stream.buffer);
                                    byte_stream.parent().deinit();
                                    this.doRenderBlob();
                                    return;
                                }

                                byte_stream.pipe = JSC.WebCore.Pipe.New(@This(), onPipe).init(this);
                                this.byte_stream = byte_stream;
                                this.response_buf_owned = byte_stream.buffer.moveToUnmanaged();

                                // we don't set size here because even if we have a hint
                                // uWebSockets won't let us partially write streaming content
                                this.blob.detach();

                                // if we've received metadata and part of the body, send everything we can and drain
                                if (this.response_buf_owned.items.len > 0) {
                                    resp.runCorkedWithType(*RequestContext, drainResponseBufferAndMetadata, this);
                                } else {
                                    // if we only have metadata to send, send it now
                                    resp.runCorkedWithType(*RequestContext, renderMetadata, this);
                                }
                                this.setAbortHandler();
                                return;
                            },
                        }
                    }

                    // when there's no stream, we need to
                    lock.onReceiveValue = doRenderWithBodyLocked;
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

            if (this.aborted or this.resp == null) {
                this.finalizeForAbort();
                return;
            }
            const resp = this.resp.?;

            const chunk = stream.slice();
            // on failure, it will continue to allocate
            // we can't do buffering ourselves here or it won't work
            // uSockets will append and manage the buffer
            // so any write will buffer if the write fails
            if (resp.write(chunk)) {
                if (stream.isDone()) {
                    this.endStream(this.shouldCloseConnection());
                    this.finalize();
                }
            } else {
                // when it's the last one, we just want to know if it's done
                if (stream.isDone()) {
                    this.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableResponseBuffer, this);
                }
            }
        }

        pub fn doRenderBlob(this: *RequestContext) void {
            // We are not corked
            // The body is small
            // Faster to do the memcpy than to do the two network calls
            // We are not streaming
            // This is an important performance optimization
            if (this.has_abort_handler and this.blob.size() < 16384 - 1024) {
                if (this.resp) |resp| {
                    resp.runCorkedWithType(*RequestContext, doRenderBlobCorked, this);
                }
            } else {
                this.doRenderBlobCorked();
            }
        }

        pub fn doRenderBlobCorked(this: *RequestContext) void {
            this.renderMetadata();
            this.renderBytes();
        }

        pub fn doRender(this: *RequestContext) void {
            ctxLog("render", .{});

            if (this.aborted) {
                this.finalizeForAbort();
                return;
            }
            var response = this.response_ptr.?;
            this.doRenderWithBody(&response.body.value);
        }

        pub fn renderProductionError(this: *RequestContext, status: u16) void {
            if (this.resp) |resp| {
                switch (status) {
                    404 => {
                        if (!this.has_written_status) {
                            resp.writeStatus("404 Not Found");
                            this.has_written_status = true;
                        }
                        this.endWithoutBody(this.shouldCloseConnection());
                    },
                    else => {
                        if (!this.has_written_status) {
                            resp.writeStatus("500 Internal Server Error");
                            resp.writeHeader("content-type", "text/plain");
                            this.has_written_status = true;
                        }

                        this.end("Something went wrong!", this.shouldCloseConnection());
                    },
                }
            }
            this.finalize();
        }

        pub fn runErrorHandler(
            this: *RequestContext,
            value: JSC.JSValue,
        ) void {
            runErrorHandlerWithStatusCode(this, value, 500);
        }

        fn ensurePathname(this: *RequestContext) []const u8 {
            if (this.pathname.len > 0)
                return this.pathname;

            if (!this.has_abort_handler) {
                return this.req.url();
            }

            return "/";
        }

        pub inline fn shouldCloseConnection(this: *const RequestContext) bool {
            if (this.resp) |resp| {
                return resp.state().isHttpConnectionClose();
            }
            return false;
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
                    exception_list.toOwnedSlice() catch @panic("TODO"),
                    "<r><red>{s}<r> - <b>{s}<r> failed",
                    .{ @as(string, @tagName(this.method)), this.ensurePathname() },
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
            JSC.markBinding(@src());
            if (!this.server.config.onError.isEmpty() and !this.has_called_error_handler) {
                this.has_called_error_handler = true;
                var args = [_]JSC.C.JSValueRef{value.asObjectRef()};
                const result = JSC.C.JSObjectCallAsFunctionReturnValue(this.server.globalThis, this.server.config.onError.asObjectRef(), this.server.thisObject.asObjectRef(), 1, &args);
                defer result.ensureStillAlive();
                if (!result.isEmptyOrUndefinedOrNull()) {
                    if (result.toError()) |err| {
                        this.finishRunningErrorHandler(err, status);
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
            JSC.markBinding(@src());
            if (this.resp == null or this.resp.?.hasResponded()) return;

            runErrorHandlerWithStatusCodeDontCheckResponded(this, value, status);
        }

        pub fn renderMetadata(this: *RequestContext) void {
            if (this.resp == null) return;
            const resp = this.resp.?;

            var response: *JSC.WebCore.Response = this.response_ptr.?;
            var status = response.statusCode();
            var needs_content_range = this.needs_content_range and this.sendfile.remain < this.blob.size();

            const size = if (needs_content_range)
                this.sendfile.remain
            else
                this.blob.size();

            status = if (status == 200 and size == 0 and !this.blob.isDetached())
                204
            else
                status;

            var needs_content_type = true;
            const content_type: MimeType = brk: {
                if (response.body.init.headers) |headers_| {
                    if (headers_.fastGet(.ContentType)) |content| {
                        needs_content_type = false;
                        break :brk MimeType.byName(content.slice());
                    }
                }

                break :brk if (this.blob.contentType().len > 0)
                    MimeType.byName(this.blob.contentType())
                else if (MimeType.sniff(this.blob.slice())) |content|
                    content
                else if (this.blob.wasString())
                    MimeType.text
                    // TODO: should we get the mime type off of the Blob.Store if it exists?
                    // A little wary of doing this right now due to causing some breaking change
                else
                    MimeType.other;
            };

            var has_content_disposition = false;
            if (response.body.init.headers) |headers_| {
                has_content_disposition = headers_.fastHas(.ContentDisposition);
                needs_content_range = needs_content_range and headers_.fastHas(.ContentRange);
                if (needs_content_range) {
                    status = 206;
                }

                this.writeStatus(status);
                this.writeHeaders(headers_);

                response.body.init.headers = null;
                headers_.deref();
            } else if (needs_content_range) {
                status = 206;
                this.writeStatus(status);
            } else {
                this.writeStatus(status);
            }

            if (needs_content_type and
                // do not insert the content type if it is the fallback value
                // we may not know the content-type when streaming
                (!this.blob.isDetached() or content_type.value.ptr != MimeType.other.value.ptr))
            {
                resp.writeHeader("content-type", content_type.value);
            }

            // automatically include the filename when:
            // 1. Bun.file("foo")
            // 2. The content-disposition header is not present
            if (!has_content_disposition and content_type.category.autosetFilename()) {
                if (this.blob.store()) |store| {
                    if (store.data == .file) {
                        if (store.data.file.pathlike == .path) {
                            const basename = std.fs.path.basename(store.data.file.pathlike.path.slice());
                            if (basename.len > 0) {
                                var filename_buf: [1024]u8 = undefined;

                                resp.writeHeader(
                                    "content-disposition",
                                    std.fmt.bufPrint(&filename_buf, "filename=\"{s}\"", .{basename[0..@min(basename.len, 1024 - 32)]}) catch "",
                                );
                            }
                        }
                    }
                }
            }

            if (this.needs_content_length) {
                resp.writeHeaderInt("content-length", size);
                this.needs_content_length = false;
            }

            if (needs_content_range) {
                var content_range_buf: [1024]u8 = undefined;

                resp.writeHeader(
                    "content-range",
                    std.fmt.bufPrint(
                        &content_range_buf,
                        // we omit the full size of the Blob because it could
                        // change between requests and this potentially leaks
                        // PII undesirably
                        "bytes {d}-{d}/*",
                        .{ this.sendfile.offset, this.sendfile.offset + (this.sendfile.remain -| 1) },
                    ) catch "bytes */*",
                );
                this.needs_content_range = false;
            }
        }

        pub fn renderBytes(this: *RequestContext) void {
            // copy it to stack memory to prevent aliasing issues in release builds
            const blob = this.blob;
            const bytes = blob.slice();
            if (this.resp) |resp| {
                if (!resp.tryEnd(
                    bytes,
                    bytes.len,
                    this.shouldCloseConnection(),
                )) {
                    this.has_marked_pending = true;
                    resp.onWritable(*RequestContext, onWritableBytes, this);
                    // given a blob, we might not have set an abort handler yet
                    this.setAbortHandler();
                    return;
                }
            }

            this.finalize();
        }

        pub fn render(this: *RequestContext, response: *JSC.WebCore.Response) void {
            ctxLog("render", .{});
            this.response_ptr = response;

            this.doRender();
        }

        pub fn onBufferedBodyChunk(this: *RequestContext, resp: *App.Response, chunk: []const u8, last: bool) void {
            ctxLog("onBufferedBodyChunk {} {}", .{ chunk.len, last });

            std.debug.assert(this.resp == resp);

            this.is_waiting_body = last == false;
            if (this.aborted or this.has_marked_complete) return;

            if (this.request_body != null) {
                var body = this.request_body.?;

                if (body.value == .Locked) {
                    if (body.value.Locked.readable) |readable| {
                        if (readable.ptr == .Bytes) {
                            std.debug.assert(this.request_body_buf.items.len == 0);

                            if (!last) {
                                readable.ptr.Bytes.onData(
                                    .{
                                        .temporary = bun.ByteList.initConst(chunk),
                                    },
                                    bun.default_allocator,
                                );
                            } else {
                                readable.ptr.Bytes.onData(
                                    .{
                                        .temporary_and_done = bun.ByteList.initConst(chunk),
                                    },
                                    bun.default_allocator,
                                );
                            }

                            return;
                        }
                    }
                }

                if (last) {
                    var bytes = this.request_body_buf;
                    defer this.request_body_buf = .{};
                    var old = body.value;

                    const total = bytes.items.len + chunk.len;
                    getter: {
                        // if (total <= JSC.WebCore.InlineBlob.available_bytes) {
                        //     if (total == 0) {
                        //         body.value = .{ .Empty = {} };
                        //         break :getter;
                        //     }

                        //     body.value = .{ .InlineBlob = JSC.WebCore.InlineBlob.concat(bytes.items, chunk) };
                        //     this.request_body_buf.clearAndFree(this.allocator);
                        // } else {
                        bytes.ensureTotalCapacityPrecise(this.allocator, total) catch |err| {
                            this.request_body_buf.clearAndFree(this.allocator);
                            body.value.toError(err, this.server.globalThis);
                            break :getter;
                        };

                        const prev_len = bytes.items.len;
                        bytes.items.len = total;
                        var slice = bytes.items[prev_len..];
                        @memcpy(slice.ptr, chunk.ptr, chunk.len);
                        body.value = .{
                            .InternalBlob = .{
                                .bytes = bytes.toManaged(this.allocator),
                            },
                        };
                        // }
                    }

                    if (old == .Locked) {
                        old.resolve(&body.value, this.server.globalThis);
                    }
                    return;
                }

                if (this.request_body_buf.capacity == 0) {
                    this.request_body_buf.ensureTotalCapacityPrecise(this.allocator, @min(this.request_body_content_len, max_request_body_preallocate_length)) catch @panic("Out of memory while allocating request body buffer");
                }
                this.request_body_buf.appendSlice(this.allocator, chunk) catch @panic("Out of memory while allocating request body");
            }
        }

        pub fn onStartStreamingRequestBody(this: *RequestContext) JSC.WebCore.DrainResult {
            ctxLog("onStartStreamingRequestBody", .{});
            if (this.aborted) {
                return JSC.WebCore.DrainResult{
                    .aborted = {},
                };
            }

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

            return .{
                .estimated_size = this.request_body_content_len,
            };
        }
        const max_request_body_preallocate_length = 1024 * 256;
        pub fn onStartBuffering(this: *RequestContext) void {
            ctxLog("onStartBuffering", .{});
            // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
            // if is not, this should be removed and only keep protect + setAbortHandler
            if (this.is_transfer_encoding == false and this.request_body_content_len == 0) {
                // no content-length or 0 content-length
                // no transfer-encoding
                if (this.request_body != null) {
                    var body = this.request_body.?;
                    var old = body.value;
                    old.Locked.onReceiveValue = null;
                    var new_body = .{ .Null = {} };
                    old.resolve(&new_body, this.server.globalThis);
                    body.value = new_body;
                }
            } else {
                this.setAbortHandler();
            }
        }

        pub fn onStartBufferingCallback(this: *anyopaque) void {
            onStartBuffering(bun.cast(*RequestContext, this));
        }

        pub fn onStartStreamingRequestBodyCallback(this: *anyopaque) JSC.WebCore.DrainResult {
            return onStartStreamingRequestBody(bun.cast(*RequestContext, this));
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

pub const WebSocketServer = struct {
    globalObject: *JSC.JSGlobalObject = undefined,
    handler: WebSocketServer.Handler = .{},

    maxPayloadLength: u32 = 1024 * 1024 * 16,
    maxLifetime: u16 = 0,
    idleTimeout: u16 = 120,
    compression: i32 = 0,
    backpressureLimit: u32 = 1024 * 1024 * 16,
    sendPingsAutomatically: bool = true,
    resetIdleTimeoutOnSend: bool = true,
    closeOnBackpressureLimit: bool = false,

    pub const Handler = struct {
        onOpen: JSC.JSValue = .zero,
        onMessage: JSC.JSValue = .zero,
        onClose: JSC.JSValue = .zero,
        onDrain: JSC.JSValue = .zero,
        onError: JSC.JSValue = .zero,

        app: ?*anyopaque = null,

        globalObject: *JSC.JSGlobalObject = undefined,
        active_connections: usize = 0,

        /// used by publish()
        flags: packed struct(u2) {
            ssl: bool = false,
            publish_to_self: bool = true,
        } = .{},

        pub fn fromJS(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue) ?Handler {
            var handler = Handler{ .globalObject = globalObject };
            if (object.getTruthy(globalObject, "message")) |message| {
                if (!message.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArguments("websocket expects a function for the message option", .{});
                    return null;
                }
                handler.onMessage = message;
                message.ensureStillAlive();
            }

            if (object.getTruthy(globalObject, "open")) |open| {
                if (!open.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArguments("websocket expects a function for the open option", .{});
                    return null;
                }
                handler.onOpen = open;
                open.ensureStillAlive();
            }

            if (object.getTruthy(globalObject, "close")) |close| {
                if (!close.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArguments("websocket expects a function for the close option", .{});
                    return null;
                }
                handler.onClose = close;
                close.ensureStillAlive();
            }

            if (object.getTruthy(globalObject, "drain")) |drain| {
                if (!drain.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArguments("websocket expects a function for the drain option", .{});
                    return null;
                }
                handler.onDrain = drain;
                drain.ensureStillAlive();
            }

            if (object.getTruthy(globalObject, "onError")) |onError| {
                if (!onError.isCallable(globalObject.vm())) {
                    globalObject.throwInvalidArguments("websocket expects a function for the onError option", .{});
                    return null;
                }
                handler.onError = onError;
                onError.ensureStillAlive();
            }

            if (handler.onMessage != .zero or handler.onOpen != .zero)
                return handler;

            return null;
        }

        pub fn protect(this: Handler) void {
            this.onOpen.protect();
            this.onMessage.protect();
            this.onClose.protect();
            this.onDrain.protect();
            this.onError.protect();
        }

        pub fn unprotect(this: Handler) void {
            this.onOpen.unprotect();
            this.onMessage.unprotect();
            this.onClose.unprotect();
            this.onDrain.unprotect();
            this.onError.unprotect();
        }
    };

    pub fn toBehavior(this: WebSocketServer) uws.WebSocketBehavior {
        return .{
            .maxPayloadLength = this.maxPayloadLength,
            .idleTimeout = this.idleTimeout,
            .compression = this.compression,
            .maxBackpressure = this.backpressureLimit,
            .sendPingsAutomatically = this.sendPingsAutomatically,
            .maxLifetime = this.maxLifetime,
            .resetIdleTimeoutOnSend = this.resetIdleTimeoutOnSend,
            .closeOnBackpressureLimit = this.closeOnBackpressureLimit,
        };
    }

    pub fn protect(this: WebSocketServer) void {
        this.handler.protect();
    }
    pub fn unprotect(this: WebSocketServer) void {
        this.handler.unprotect();
    }

    const CompressTable = bun.ComptimeStringMap(i32, .{
        .{ "disable", 0 },
        .{ "shared", uws.SHARED_COMPRESSOR },
        .{ "dedicated", uws.DEDICATED_COMPRESSOR },
        .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
        .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
        .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
        .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
        .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
        .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
        .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
        .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
    });

    const DecompressTable = bun.ComptimeStringMap(i32, .{
        .{ "disable", 0 },
        .{ "shared", uws.SHARED_DECOMPRESSOR },
        .{ "dedicated", uws.DEDICATED_DECOMPRESSOR },
        .{ "3KB", uws.DEDICATED_COMPRESSOR_3KB },
        .{ "4KB", uws.DEDICATED_COMPRESSOR_4KB },
        .{ "8KB", uws.DEDICATED_COMPRESSOR_8KB },
        .{ "16KB", uws.DEDICATED_COMPRESSOR_16KB },
        .{ "32KB", uws.DEDICATED_COMPRESSOR_32KB },
        .{ "64KB", uws.DEDICATED_COMPRESSOR_64KB },
        .{ "128KB", uws.DEDICATED_COMPRESSOR_128KB },
        .{ "256KB", uws.DEDICATED_COMPRESSOR_256KB },
    });

    pub fn onCreate(globalObject: *JSC.JSGlobalObject, object: JSValue) ?WebSocketServer {
        var server = WebSocketServer{};

        if (Handler.fromJS(globalObject, object)) |handler| {
            server.handler = handler;
        } else {
            globalObject.throwInvalidArguments("WebSocketServer expects a message handler", .{});
            return null;
        }

        if (object.get(globalObject, "perMessageDeflate")) |per_message_deflate| {
            getter: {
                if (per_message_deflate.isUndefined()) {
                    break :getter;
                }

                if (per_message_deflate.isBoolean() or per_message_deflate.isNull()) {
                    if (per_message_deflate.toBoolean()) {
                        server.compression = uws.SHARED_COMPRESSOR | uws.SHARED_DECOMPRESSOR;
                    } else {
                        server.compression = 0;
                    }
                    break :getter;
                }

                if (per_message_deflate.getTruthy(globalObject, "compress")) |compression| {
                    if (compression.isBoolean()) {
                        server.compression |= if (compression.toBoolean()) uws.SHARED_COMPRESSOR else 0;
                    } else if (compression.isString()) {
                        server.compression |= CompressTable.getWithEql(compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                            globalObject.throwInvalidArguments(
                                "WebSocketServer expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"",
                                .{},
                            );
                            return null;
                        };
                    } else {
                        globalObject.throwInvalidArguments(
                            "websocket expects a valid compress option, either disable \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"",
                            .{},
                        );
                        return null;
                    }
                }

                if (per_message_deflate.getTruthy(globalObject, "decompress")) |compression| {
                    if (compression.isBoolean()) {
                        server.compression |= if (compression.toBoolean()) uws.SHARED_DECOMPRESSOR else 0;
                    } else if (compression.isString()) {
                        server.compression |= DecompressTable.getWithEql(compression.getZigString(globalObject), ZigString.eqlComptime) orelse {
                            globalObject.throwInvalidArguments(
                                "websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"",
                                .{},
                            );
                            return null;
                        };
                    } else {
                        globalObject.throwInvalidArguments(
                            "websocket expects a valid decompress option, either \"disable\" \"shared\" \"dedicated\" \"3KB\" \"4KB\" \"8KB\" \"16KB\" \"32KB\" \"64KB\" \"128KB\" or \"256KB\"",
                            .{},
                        );
                        return null;
                    }
                }
            }
        }

        if (object.get(globalObject, "maxPayloadLength")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    globalObject.throwInvalidArguments("websocket expects maxPayloadLength to be an integer", .{});
                    return null;
                }
                server.maxPayloadLength = @intCast(u32, @truncate(i33, @max(value.toInt64(), 0)));
            }
        }
        if (object.get(globalObject, "idleTimeout")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    globalObject.throwInvalidArguments("websocket expects idleTimeout to be an integer", .{});
                    return null;
                }

                server.idleTimeout = value.to(u16);
            }
        }
        if (object.get(globalObject, "backpressureLimit")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isAnyInt()) {
                    globalObject.throwInvalidArguments("websocket expects backpressureLimit to be an integer", .{});
                    return null;
                }

                server.backpressureLimit = @intCast(u32, @truncate(i33, @max(value.toInt64(), 0)));
            }
        }
        // if (object.get(globalObject, "sendPings")) |value| {
        //     if (!value.isUndefinedOrNull()) {
        //         if (!value.isBoolean()) {
        //             globalObject.throwInvalidArguments("websocket expects sendPings to be a boolean", .{});
        //             return null;
        //         }

        //         server.sendPings = value.toBoolean();
        //     }
        // }

        if (object.get(globalObject, "closeOnBackpressureLimit")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isBoolean()) {
                    globalObject.throwInvalidArguments("websocket expects closeOnBackpressureLimit to be a boolean", .{});
                    return null;
                }

                server.closeOnBackpressureLimit = value.toBoolean();
            }
        }

        if (object.get(globalObject, "publishToSelf")) |value| {
            if (!value.isUndefinedOrNull()) {
                if (!value.isBoolean()) {
                    globalObject.throwInvalidArguments("websocket expects publishToSelf to be a boolean", .{});
                    return null;
                }

                server.handler.flags.publish_to_self = value.toBoolean();
            }
        }

        server.protect();
        return server;
    }
};

const Corker = struct {
    args: []const JSValue = &.{},
    globalObject: *JSC.JSGlobalObject,
    this_value: JSC.JSValue = .zero,
    callback: JSC.JSValue,
    result: JSValue = .zero,

    pub fn run(this: *Corker) void {
        const this_value = this.this_value;
        this.result = if (this_value == .zero)
            this.callback.call(this.globalObject, this.args)
        else
            this.callback.callWithThis(this.globalObject, this_value, this.args);
    }
};

pub const ServerWebSocket = struct {
    handler: *WebSocketServer.Handler,
    this_value: JSValue = .zero,
    websocket: uws.AnyWebSocket = undefined,
    closed: bool = false,
    binary_type: JSC.JSValue.JSType = .Uint8Array,
    opened: bool = false,

    pub usingnamespace JSC.Codegen.JSServerWebSocket;

    const log = Output.scoped(.WebSocketServer, false);

    pub fn onOpen(this: *ServerWebSocket, ws: uws.AnyWebSocket) void {
        log("OnOpen", .{});

        this.websocket = ws;
        this.closed = false;

        // the this value is initially set to whatever the user passed in
        const value_to_cache = this.this_value;

        var handler = this.handler;
        handler.active_connections +|= 1;
        var globalObject = handler.globalObject;

        const onOpenHandler = handler.onOpen;
        this.this_value = .zero;
        this.opened = false;
        if (value_to_cache != .zero) {
            const current_this = this.getThisValue();
            ServerWebSocket.dataSetCached(current_this, globalObject, value_to_cache);
        }

        if (onOpenHandler.isEmptyOrUndefinedOrNull()) return;
        const this_value = this.getThisValue();
        var args = [_]JSValue{this_value};

        var corker = Corker{
            .args = &args,
            .globalObject = globalObject,
            .callback = onOpenHandler,
        };
        const error_handler = handler.onError;
        ws.cork(&corker, Corker.run);
        const result = corker.result;
        this.opened = true;
        if (result.toError()) |err_value| {
            log("onOpen exception", .{});

            if (!this.closed) {
                this.closed = true;
                // we un-gracefully close the connection if there was an exception
                // we don't want any event handlers to fire after this for anything other than error()
                // https://github.com/oven-sh/bun/issues/1480
                this.websocket.close();
                handler.active_connections -|= 1;
                this_value.unprotect();
            }

            if (error_handler.isEmptyOrUndefinedOrNull()) {
                globalObject.bunVM().runErrorHandler(err_value, null);
            } else {
                const corky = [_]JSValue{err_value};
                corker.args = &corky;
                corker.callback = error_handler;
                corker.this_value = .zero;
                corker.result = .zero;
                corker.run();
            }
        }
    }

    pub fn getThisValue(this: *ServerWebSocket) JSValue {
        var this_value = this.this_value;
        if (this_value == .zero) {
            this_value = this.toJS(this.handler.globalObject);
            this_value.protect();
            this.this_value = this_value;
        }
        return this_value;
    }

    pub fn onMessage(
        this: *ServerWebSocket,
        ws: uws.AnyWebSocket,
        message: []const u8,
        opcode: uws.Opcode,
    ) void {
        log("onMessage({d}): {s}", .{
            @enumToInt(opcode),
            message,
        });
        const onMessageHandler = this.handler.onMessage;
        if (onMessageHandler.isEmptyOrUndefinedOrNull()) return;
        var globalObject = this.handler.globalObject;

        const arguments = [_]JSValue{
            this.getThisValue(),
            switch (opcode) {
                .text => brk: {
                    var str = ZigString.init(message);
                    str.markUTF8();
                    break :brk str.toValueGC(globalObject);
                },
                .binary => if (this.binary_type == .Uint8Array)
                    JSC.ArrayBuffer.create(
                        globalObject,
                        message,
                        .Uint8Array,
                    )
                else
                    JSC.ArrayBuffer.create(
                        globalObject,
                        message,
                        .ArrayBuffer,
                    ),
                else => unreachable,
            },
        };

        var corker = Corker{
            .args = &arguments,
            .globalObject = globalObject,
            .callback = onMessageHandler,
        };

        ws.cork(&corker, Corker.run);
        const result = corker.result;

        if (result.isEmptyOrUndefinedOrNull()) return;

        if (result.toError()) |err_value| {
            if (this.handler.onError.isEmptyOrUndefinedOrNull()) {
                globalObject.bunVM().runErrorHandler(err_value, null);
            } else {
                const args = [_]JSValue{err_value};
                corker.args = &args;
                corker.callback = this.handler.onError;
                corker.this_value = .zero;
                corker.result = .zero;
                corker.run();
            }
            return;
        }

        if (result.asAnyPromise()) |promise| {
            switch (promise.status(globalObject.vm())) {
                .Rejected => {
                    _ = promise.result(globalObject.vm());
                    return;
                },

                else => {},
            }
        }
    }
    pub fn onDrain(this: *ServerWebSocket, _: uws.AnyWebSocket) void {
        log("onDrain", .{});

        var handler = this.handler;
        if (this.closed)
            return;

        if (handler.onDrain != .zero) {
            var globalObject = handler.globalObject;

            var corker = Corker{
                .args = &[_]JSC.JSValue{this.this_value},
                .globalObject = globalObject,
                .callback = handler.onDrain,
            };

            this.websocket.cork(&corker, Corker.run);
            const result = corker.result;

            if (result.toError()) |err_value| {
                if (this.handler.onError.isEmptyOrUndefinedOrNull()) {
                    globalObject.bunVM().runErrorHandler(err_value, null);
                } else {
                    const args = [_]JSValue{err_value};
                    corker.args = &args;
                    corker.callback = this.handler.onError;
                    corker.this_value = .zero;
                    corker.result = .zero;
                    corker.run();
                }
            }
        }
    }
    pub fn onPing(_: *ServerWebSocket, _: uws.AnyWebSocket, _: []const u8) void {
        log("onPing", .{});
    }
    pub fn onPong(_: *ServerWebSocket, _: uws.AnyWebSocket, _: []const u8) void {
        log("onPong", .{});
    }
    pub fn onClose(this: *ServerWebSocket, _: uws.AnyWebSocket, code: i32, message: []const u8) void {
        log("onClose", .{});
        var handler = this.handler;
        const was_closed = this.closed;
        this.closed = true;
        defer {
            if (!was_closed) {
                handler.active_connections -|= 1;
            }
        }

        if (handler.onClose != .zero) {
            const result = handler.onClose.call(
                handler.globalObject,
                &[_]JSC.JSValue{ this.this_value, JSValue.jsNumber(code), ZigString.init(message).toValueGC(handler.globalObject) },
            );

            if (result.toError()) |err| {
                log("onClose error", .{});
                handler.globalObject.bunVM().runErrorHandler(err, null);
            }
        }

        this.this_value.unprotect();
    }

    pub fn behavior(comptime ServerType: type, comptime ssl: bool, opts: uws.WebSocketBehavior) uws.WebSocketBehavior {
        return uws.WebSocketBehavior.Wrap(ServerType, @This(), ssl).apply(opts);
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*ServerWebSocket {
        globalObject.throw("Cannot construct ServerWebSocket", .{});
        return null;
    }

    pub fn finalize(this: *ServerWebSocket) callconv(.C) void {
        log("finalize", .{});
        bun.default_allocator.destroy(this);
    }

    pub fn publish(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(4);

        if (args.len < 1) {
            log("publish()", .{});
            globalThis.throw("publish requires at least 1 argument", .{});
            return .zero;
        }

        var app = this.handler.app orelse {
            log("publish() closed", .{});
            return JSValue.jsNumber(0);
        };
        const flags = this.handler.flags;
        const ssl = flags.ssl;
        const publish_to_self = flags.publish_to_self;

        const topic_value = args.ptr[0];
        const message_value = args.ptr[1];
        const compress_value = args.ptr[2];

        if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
            log("publish() topic invalid", .{});
            globalThis.throw("publish requires a topic string", .{});
            return .zero;
        }

        var topic_slice = topic_value.toSlice(globalThis, bun.default_allocator);
        defer topic_slice.deinit();
        if (topic_slice.len == 0) {
            globalThis.throw("publish requires a non-empty topic", .{});
            return .zero;
        }

        const compress = args.len > 1 and compress_value.toBoolean();

        if (message_value.isEmptyOrUndefinedOrNull()) {
            globalThis.throw("publish requires a non-empty message", .{});
            return .zero;
        }

        if (message_value.asArrayBuffer(globalThis)) |array_buffer| {
            const buffer = array_buffer.slice();

            if (buffer.len == 0) {
                globalThis.throw("publish requires a non-empty message", .{});
                return .zero;
            }

            const result = if (!publish_to_self)
                this.websocket.publish(topic_slice.slice(), buffer, .binary, compress)
            else
                uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

            return JSValue.jsNumber(
                // if 0, return 0
                // else return number of bytes sent
                if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
            );
        }

        {
            var string_slice = message_value.toSlice(globalThis, bun.default_allocator);
            defer string_slice.deinit();
            if (string_slice.len == 0) {
                return JSValue.jsNumber(0);
            }

            const buffer = string_slice.slice();

            const result = if (!publish_to_self)
                this.websocket.publish(topic_slice.slice(), buffer, .text, compress)
            else
                uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

            return JSValue.jsNumber(
                // if 0, return 0
                // else return number of bytes sent
                if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
            );
        }

        return .zero;
    }

    pub fn publishText(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(4);

        if (args.len < 1) {
            log("publish()", .{});
            globalThis.throw("publish requires at least 1 argument", .{});
            return .zero;
        }

        var app = this.handler.app orelse {
            log("publish() closed", .{});
            return JSValue.jsNumber(0);
        };
        const flags = this.handler.flags;
        const ssl = flags.ssl;
        const publish_to_self = flags.publish_to_self;

        const topic_value = args.ptr[0];
        const message_value = args.ptr[1];
        const compress_value = args.ptr[2];

        if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
            log("publish() topic invalid", .{});
            globalThis.throw("publishText requires a topic string", .{});
            return .zero;
        }

        var topic_slice = topic_value.toSlice(globalThis, bun.default_allocator);
        defer topic_slice.deinit();
        if (topic_slice.len == 0) {
            globalThis.throw("publishText requires a non-empty topic", .{});
            return .zero;
        }

        const compress = args.len > 1 and compress_value.toBoolean();

        if (message_value.isEmptyOrUndefinedOrNull() or !message_value.isString()) {
            globalThis.throw("publishText requires a non-empty message", .{});
            return .zero;
        }

        var string_slice = message_value.toSlice(globalThis, bun.default_allocator);
        defer string_slice.deinit();
        if (string_slice.len == 0) {
            return JSValue.jsNumber(0);
        }

        const buffer = string_slice.slice();

        const result = if (!publish_to_self)
            this.websocket.publish(topic_slice.slice(), buffer, .text, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
        );
    }

    pub fn publishBinary(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(4);

        if (args.len < 1) {
            log("publishBinary()", .{});
            globalThis.throw("publishBinary requires at least 1 argument", .{});
            return .zero;
        }

        var app = this.handler.app orelse {
            log("publish() closed", .{});
            return JSValue.jsNumber(0);
        };
        const flags = this.handler.flags;
        const ssl = flags.ssl;
        const publish_to_self = flags.publish_to_self;
        const topic_value = args.ptr[0];
        const message_value = args.ptr[1];
        const compress_value = args.ptr[2];

        if (topic_value.isEmptyOrUndefinedOrNull() or !topic_value.isString()) {
            log("publishBinary() topic invalid", .{});
            globalThis.throw("publishBinary requires a topic string", .{});
            return .zero;
        }

        var topic_slice = topic_value.toSlice(globalThis, bun.default_allocator);
        defer topic_slice.deinit();
        if (topic_slice.len == 0) {
            globalThis.throw("publishBinary requires a non-empty topic", .{});
            return .zero;
        }

        const compress = args.len > 1 and compress_value.toBoolean();

        if (message_value.isEmptyOrUndefinedOrNull()) {
            globalThis.throw("publishBinary requires a non-empty message", .{});
            return .zero;
        }
        const array_buffer = message_value.asArrayBuffer(globalThis) orelse {
            globalThis.throw("publishBinary expects an ArrayBufferView", .{});
            return .zero;
        };
        const buffer = array_buffer.slice();

        if (buffer.len == 0) {
            return JSC.JSValue.jsNumber(0);
        }

        const result = if (!publish_to_self)
            this.websocket.publish(topic_slice.slice(), buffer, .binary, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
        );
    }

    pub fn publishBinaryWithoutTypeChecks(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        topic_str: *JSC.JSString,
        array: *JSC.JSUint8Array,
    ) callconv(.C) JSC.JSValue {
        var app = this.handler.app orelse {
            log("publish() closed", .{});
            return JSValue.jsNumber(0);
        };
        const flags = this.handler.flags;
        const ssl = flags.ssl;
        const publish_to_self = flags.publish_to_self;

        var topic_slice = topic_str.toSlice(globalThis, bun.default_allocator);
        defer topic_slice.deinit();
        if (topic_slice.len == 0) {
            globalThis.throw("publishBinary requires a non-empty topic", .{});
            return .zero;
        }

        const compress = true;

        const buffer = array.slice();
        if (buffer.len == 0) {
            return JSC.JSValue.jsNumber(0);
        }

        const result = if (!publish_to_self)
            this.websocket.publish(topic_slice.slice(), buffer, .binary, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .binary, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
        );
    }

    pub fn publishTextWithoutTypeChecks(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        topic_str: *JSC.JSString,
        str: *JSC.JSString,
    ) callconv(.C) JSC.JSValue {
        var app = this.handler.app orelse {
            log("publish() closed", .{});
            return JSValue.jsNumber(0);
        };
        const flags = this.handler.flags;
        const ssl = flags.ssl;
        const publish_to_self = flags.publish_to_self;

        var topic_slice = topic_str.toSlice(globalThis, bun.default_allocator);
        defer topic_slice.deinit();
        if (topic_slice.len == 0) {
            globalThis.throw("publishBinary requires a non-empty topic", .{});
            return .zero;
        }

        const compress = true;

        const slice = str.toSlice(globalThis, bun.default_allocator);
        defer slice.deinit();
        const buffer = slice.slice();

        if (buffer.len == 0) {
            return JSC.JSValue.jsNumber(0);
        }
        const result = if (!publish_to_self)
            this.websocket.publish(topic_slice.slice(), buffer, .text, compress)
        else
            uws.AnyWebSocket.publishWithOptions(ssl, app, topic_slice.slice(), buffer, .text, compress);

        return JSValue.jsNumber(
            // if 0, return 0
            // else return number of bytes sent
            if (result) @intCast(i32, @truncate(u31, buffer.len)) else @as(i32, 0),
        );
    }

    pub fn cork(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(1);

        if (args.len < 1) {
            globalThis.throw("cork requires at least 1 argument", .{});
            return .zero;
        }
        const callback = args.ptr[0];
        if (callback.isEmptyOrUndefinedOrNull() or !callback.isCallable(globalThis.vm())) {
            globalThis.throw("cork requires a function", .{});
            return .zero;
        }

        if (this.closed) {
            return JSValue.jsUndefined();
        }

        var corker = Corker{
            .globalObject = globalThis,
            .this_value = this.this_value,
            .callback = callback,
        };
        this.websocket.cork(&corker, Corker.run);

        const result = corker.result;

        if (result.isEmptyOrUndefinedOrNull())
            return JSValue.jsUndefined();

        if (result.isAnyError()) {
            globalThis.throwValue(result);
            return JSValue.jsUndefined();
        }

        return result;
    }

    pub fn send(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(2);

        if (args.len < 1) {
            log("send()", .{});
            globalThis.throw("send requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            log("send() closed", .{});
            return JSValue.jsNumber(0);
        }

        const message_value = args.ptr[0];
        const compress_value = args.ptr[1];

        const compress = args.len > 1 and compress_value.toBoolean();

        if (message_value.isEmptyOrUndefinedOrNull()) {
            globalThis.throw("send requires a non-empty message", .{});
            return .zero;
        }

        if (message_value.asArrayBuffer(globalThis)) |buffer| {
            if (buffer.len == 0) {
                return JSValue.jsNumber(0);
            }

            switch (this.websocket.send(buffer.slice(), .binary, compress, true)) {
                .backpressure => {
                    log("send() backpressure ({d} bytes)", .{buffer.len});
                    return JSValue.jsNumber(-1);
                },
                .success => {
                    log("send() success ({d} bytes)", .{buffer.len});
                    return JSValue.jsNumber(buffer.slice().len);
                },
                .dropped => {
                    log("send() dropped ({d} bytes)", .{buffer.len});
                    return JSValue.jsNumber(0);
                },
            }
        }

        {
            var string_slice = message_value.toSlice(globalThis, bun.default_allocator);
            defer string_slice.deinit();
            if (string_slice.len == 0) {
                return JSValue.jsNumber(0);
            }

            const buffer = string_slice.slice();
            switch (this.websocket.send(buffer, .text, compress, true)) {
                .backpressure => {
                    log("send() backpressure ({d} bytes string)", .{buffer.len});
                    return JSValue.jsNumber(-1);
                },
                .success => {
                    log("send() success ({d} bytes string)", .{buffer.len});
                    return JSValue.jsNumber(buffer.len);
                },
                .dropped => {
                    log("send() dropped ({d} bytes string)", .{buffer.len});
                    return JSValue.jsNumber(0);
                },
            }
        }

        return .zero;
    }

    pub fn sendText(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(2);

        if (args.len < 1) {
            log("sendText()", .{});
            globalThis.throw("sendText requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            log("sendText() closed", .{});
            return JSValue.jsNumber(0);
        }

        const message_value = args.ptr[0];
        const compress_value = args.ptr[1];

        const compress = args.len > 1 and compress_value.toBoolean();

        if (message_value.isEmptyOrUndefinedOrNull() or !message_value.isString()) {
            globalThis.throw("sendText expects a string", .{});
            return .zero;
        }

        var string_slice = message_value.toSlice(globalThis, bun.default_allocator);
        defer string_slice.deinit();
        if (string_slice.len == 0) {
            return JSValue.jsNumber(0);
        }

        const buffer = string_slice.slice();
        switch (this.websocket.send(buffer, .text, compress, true)) {
            .backpressure => {
                log("sendText() backpressure ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("sendText() success ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(buffer.len);
            },
            .dropped => {
                log("sendText() dropped ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }

    pub fn sendTextWithoutTypeChecks(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        message_str: *JSC.JSString,
        compress: bool,
    ) callconv(.C) JSValue {
        if (this.closed) {
            log("sendText() closed", .{});
            return JSValue.jsNumber(0);
        }

        var string_slice = message_str.toSlice(globalThis, bun.default_allocator);
        defer string_slice.deinit();
        if (string_slice.len == 0) {
            return JSValue.jsNumber(0);
        }

        const buffer = string_slice.slice();
        switch (this.websocket.send(buffer, .text, compress, true)) {
            .backpressure => {
                log("sendText() backpressure ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("sendText() success ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(buffer.len);
            },
            .dropped => {
                log("sendText() dropped ({d} bytes string)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }

    pub fn sendBinary(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(2);

        if (args.len < 1) {
            log("sendBinary()", .{});
            globalThis.throw("sendBinary requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            log("sendBinary() closed", .{});
            return JSValue.jsNumber(0);
        }

        const message_value = args.ptr[0];
        const compress_value = args.ptr[1];

        const compress = args.len > 1 and compress_value.toBoolean();

        const buffer = message_value.asArrayBuffer(globalThis) orelse {
            globalThis.throw("sendBinary requires an ArrayBufferView", .{});
            return .zero;
        };

        if (buffer.len == 0) {
            return JSValue.jsNumber(0);
        }

        switch (this.websocket.send(buffer.slice(), .binary, compress, true)) {
            .backpressure => {
                log("sendBinary() backpressure ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("sendBinary() success ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(buffer.slice().len);
            },
            .dropped => {
                log("sendBinary() dropped ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }

    pub fn sendBinaryWithoutTypeChecks(
        this: *ServerWebSocket,
        _: *JSC.JSGlobalObject,
        array_buffer: *JSC.JSUint8Array,
        compress: bool,
    ) callconv(.C) JSValue {
        if (this.closed) {
            log("sendBinary() closed", .{});
            return JSValue.jsNumber(0);
        }

        const buffer = array_buffer.slice();

        if (buffer.len == 0) {
            return JSValue.jsNumber(0);
        }

        switch (this.websocket.send(buffer, .binary, compress, true)) {
            .backpressure => {
                log("sendBinary() backpressure ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(-1);
            },
            .success => {
                log("sendBinary() success ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(buffer.len);
            },
            .dropped => {
                log("sendBinary() dropped ({d} bytes)", .{buffer.len});
                return JSValue.jsNumber(0);
            },
        }
    }

    pub fn getData(
        _: *ServerWebSocket,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        log("getData()", .{});
        return JSValue.jsUndefined();
    }

    pub fn setData(
        this: *ServerWebSocket,
        globalObject: *JSC.JSGlobalObject,
        value: JSC.JSValue,
    ) callconv(.C) bool {
        log("setData()", .{});
        ServerWebSocket.dataSetCached(this.this_value, globalObject, value);
        return true;
    }

    pub fn getReadyState(
        this: *ServerWebSocket,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        log("getReadyState()", .{});

        if (this.closed) {
            return JSValue.jsNumber(3);
        }

        return JSValue.jsNumber(1);
    }

    pub fn close(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(2);
        log("close()", .{});

        if (this.closed) {
            return JSValue.jsUndefined();
        }

        if (!this.opened) {
            globalThis.throw("Calling close() inside open() is not supported. Consider changing your upgrade() callback instead", .{});
            return .zero;
        }
        this.closed = true;

        const code = if (args.len > 0) args.ptr[0].toInt32() else @as(i32, 1000);
        var message_value = if (args.len > 1) args.ptr[1].toSlice(globalThis, bun.default_allocator) else ZigString.Slice.empty;
        defer message_value.deinit();
        if (code > 1000 or message_value.len > 0) {
            this.websocket.end(code, message_value.slice());
        } else {
            this.this_value.unprotect();
            this.websocket.close();
        }

        return JSValue.jsUndefined();
    }

    pub fn getBinaryType(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        log("getBinaryType()", .{});

        return switch (this.binary_type) {
            .Uint8Array => ZigString.static("uint8array").toValue(globalThis),
            else => ZigString.static("arraybuffer").toValue(globalThis),
        };
    }

    pub const BinaryType = bun.ComptimeStringMap(JSC.JSValue.JSType, .{
        &.{ "uint8array", .Uint8Array },
        &.{ "Uint8Array", .Uint8Array },
        &.{ "arraybuffer", .ArrayBuffer },
        &.{ "ArrayBuffer", .ArrayBuffer },
    });

    pub fn setBinaryType(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        value: JSC.JSValue,
    ) callconv(.C) bool {
        log("setBinaryType()", .{});

        if (value.isEmptyOrUndefinedOrNull() or !value.isString()) {
            globalThis.throw("binaryType must be either \"uint8array\" or \"arraybuffer\"", .{});
            return false;
        }

        switch (BinaryType.getWithEql(
            value.getZigString(globalThis),
            ZigString.eqlComptime,
        ) orelse // random value
            .Uint8ClampedArray) {
            .Uint8Array => {
                this.binary_type = .Uint8Array;

                return true;
            },
            .ArrayBuffer => {
                this.binary_type = .ArrayBuffer;
                return true;
            },
            else => {
                globalThis.throw("binaryType must be either \"uint8array\" or \"arraybuffer\"", .{});
                return false;
            },
        }
    }

    pub fn getBufferedAmount(
        this: *ServerWebSocket,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        log("getBufferedAmount()", .{});

        if (this.closed) {
            return JSValue.jsNumber(0);
        }

        return JSValue.jsNumber(this.websocket.getBufferedAmount());
    }
    pub fn subscribe(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(1);
        if (args.len < 1) {
            globalThis.throw("subscribe requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            return JSValue.jsBoolean(true);
        }

        var topic = args.ptr[0].toSlice(globalThis, bun.default_allocator);
        defer topic.deinit();

        if (topic.len == 0) {
            globalThis.throw("subscribe requires a non-empty topic name", .{});
            return .zero;
        }

        return JSValue.jsBoolean(this.websocket.subscribe(topic.slice()));
    }
    pub fn unsubscribe(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(1);
        if (args.len < 1) {
            globalThis.throw("unsubscribe requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            return JSValue.jsBoolean(true);
        }

        var topic = args.ptr[0].toSlice(globalThis, bun.default_allocator);
        defer topic.deinit();

        if (topic.len == 0) {
            globalThis.throw("unsubscribe requires a non-empty topic name", .{});
            return .zero;
        }

        return JSValue.jsBoolean(this.websocket.unsubscribe(topic.slice()));
    }
    pub fn isSubscribed(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        const args = callframe.arguments(1);
        if (args.len < 1) {
            globalThis.throw("isSubscribed requires at least 1 argument", .{});
            return .zero;
        }

        if (this.closed) {
            return JSValue.jsBoolean(false);
        }

        var topic = args.ptr[0].toSlice(globalThis, bun.default_allocator);
        defer topic.deinit();

        if (topic.len == 0) {
            globalThis.throw("isSubscribed requires a non-empty topic name", .{});
            return .zero;
        }

        return JSValue.jsBoolean(this.websocket.isSubscribed(topic.slice()));
    }

    // pub fn getTopics(
    //     this: *ServerWebSocket,
    //     globalThis: *JSC.JSGlobalObject,
    // ) callconv(.C) JSValue {
    //     if (this.closed) {
    //         return JSValue.createStringArray(globalThis, bun.default_allocator, null, 0, false);
    //     }

    //      this
    // }

    pub fn getRemoteAddress(
        this: *ServerWebSocket,
        globalThis: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.closed) {
            return JSValue.jsUndefined();
        }

        var buf: [64]u8 = [_]u8{0} ** 64;
        var text_buf: [512]u8 = undefined;

        const address_bytes = this.websocket.getRemoteAddress(&buf);
        const address: std.net.Address = switch (address_bytes.len) {
            4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
            16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
            else => return JSValue.jsUndefined(),
        };

        const text = bun.fmt.formatIp(address, &text_buf) catch unreachable;
        return ZigString.init(text).toValueGC(globalThis);
    }
};

pub fn NewServer(comptime ssl_enabled_: bool, comptime debug_mode_: bool) type {
    return struct {
        pub const ssl_enabled = ssl_enabled_;
        const debug_mode = debug_mode_;

        const ThisServer = @This();
        pub const RequestContext = NewRequestContext(ssl_enabled, debug_mode, @This());

        pub const App = uws.NewApp(ssl_enabled);

        const httplog = Output.scoped(.Server, false);

        listener: ?*App.ListenSocket = null,
        thisObject: JSC.JSValue = JSC.JSValue.zero,
        app: *App = undefined,
        vm: *JSC.VirtualMachine = undefined,
        globalThis: *JSGlobalObject,
        base_url_string_for_joining: string = "",
        config: ServerConfig = ServerConfig{},
        pending_requests: usize = 0,
        request_pool_allocator: std.mem.Allocator = undefined,

        listen_callback: JSC.AnyTask = undefined,
        allocator: std.mem.Allocator,
        poll_ref: JSC.PollRef = .{},
        temporary_url_buffer: std.ArrayListUnmanaged(u8) = .{},

        flags: packed struct(u3) {
            deinit_scheduled: bool = false,
            terminated: bool = false,
            has_js_deinited: bool = false,
        } = .{},

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
                .reload = .{
                    .rfn = onReload,
                },
                .upgrade = .{
                    .rfn = JSC.wrapSync(ThisServer, "onUpgrade"),
                },

                .publish = .{
                    .rfn = JSC.wrapSync(ThisServer, "publish"),
                },
            },
            .{
                .port = .{
                    .get = JSC.getterWrap(ThisServer, "getPort"),
                },
                .hostname = .{
                    .get = JSC.getterWrap(ThisServer, "getHostname"),
                },
                .protocol = .{
                    .get = JSC.getterWrap(ThisServer, "getProtocol"),
                },
                .development = .{
                    .get = JSC.getterWrap(ThisServer, "getDevelopment"),
                },
                .pendingRequests = .{
                    .get = JSC.getterWrap(ThisServer, "getPendingRequests"),
                },
                .pendingWebSockets = .{
                    .get = JSC.getterWrap(ThisServer, "getPendingWebSockets"),
                },
            },
        );

        pub fn publish(this: *ThisServer, globalThis: *JSC.JSGlobalObject, topic: ZigString, message_value: JSValue, compress_value: ?JSValue, exception: JSC.C.ExceptionRef) JSValue {
            if (this.config.websocket == null)
                return JSValue.jsNumber(0);

            var app = this.app;

            if (topic.len == 0) {
                httplog("publish() topic invalid", .{});
                JSC.JSError(this.vm.allocator, "publish requires a topic string", .{}, globalThis, exception);
                return .zero;
            }

            var topic_slice = topic.toSlice(bun.default_allocator);
            defer topic_slice.deinit();
            if (topic_slice.len == 0) {
                JSC.JSError(this.vm.allocator, "publish requires a non-empty topic", .{}, globalThis, exception);
                return .zero;
            }

            const compress = (compress_value orelse JSValue.jsBoolean(true)).toBoolean();

            if (message_value.isEmptyOrUndefinedOrNull()) {
                JSC.JSError(this.vm.allocator, "publish requires a non-empty message", .{}, globalThis, exception);
                return .zero;
            }

            if (message_value.asArrayBuffer(globalThis)) |buffer| {
                if (buffer.len == 0) {
                    JSC.JSError(this.vm.allocator, "publish requires a non-empty message", .{}, globalThis, exception);
                    return .zero;
                }

                return JSValue.jsNumber(
                    // if 0, return 0
                    // else return number of bytes sent
                    @as(i32, @boolToInt(uws.AnyWebSocket.publishWithOptions(ssl_enabled, app, topic_slice.slice(), buffer.slice(), .binary, compress))) * @intCast(i32, @truncate(u31, buffer.len)),
                );
            }

            {
                var string_slice = message_value.toSlice(globalThis, bun.default_allocator);
                defer string_slice.deinit();
                if (string_slice.len == 0) {
                    return JSValue.jsNumber(0);
                }

                const buffer = string_slice.slice();
                return JSValue.jsNumber(
                    // if 0, return 0
                    // else return number of bytes sent
                    @as(i32, @boolToInt(uws.AnyWebSocket.publishWithOptions(ssl_enabled, app, topic_slice.slice(), buffer, .text, compress))) * @intCast(i32, @truncate(u31, buffer.len)),
                );
            }

            return .zero;
        }

        pub fn onUpgrade(
            this: *ThisServer,
            globalThis: *JSC.JSGlobalObject,
            object: JSC.JSValue,
            optional: ?JSValue,
            exception: js.ExceptionRef,
        ) JSValue {
            if (this.config.websocket == null) {
                JSC.throwInvalidArguments("To enable websocket support, set the \"websocket\" object in Bun.serve({})", .{}, globalThis, exception);
                return JSValue.jsUndefined();
            }

            if (this.flags.terminated) {
                return JSValue.jsBoolean(false);
            }

            var request = object.as(Request) orelse {
                JSC.throwInvalidArguments("upgrade requires a Request object", .{}, globalThis, exception);
                return JSValue.jsUndefined();
            };

            if (request.upgrader == null) {
                return JSC.jsBoolean(false);
            }

            var upgrader = bun.cast(*RequestContext, request.upgrader.?);
            if (upgrader.aborted or upgrader.resp == null) {
                return JSC.jsBoolean(false);
            }

            if (upgrader.upgrade_context == null or @ptrToInt(upgrader.upgrade_context) == std.math.maxInt(usize)) {
                return JSC.jsBoolean(false);
            }
            const resp = upgrader.resp.?;
            var ctx = upgrader.upgrade_context.?;

            var sec_websocket_key_str = ZigString.Empty;

            if (request.headers) |head| {
                sec_websocket_key_str = head.fastGet(.SecWebSocketKey) orelse ZigString.Empty;
            }

            if (sec_websocket_key_str.len == 0) {
                sec_websocket_key_str = ZigString.init(upgrader.req.header("sec-websocket-key") orelse "");
            }

            if (sec_websocket_key_str.len == 0) {
                return JSC.jsBoolean(false);
            }

            var sec_websocket_protocol = ZigString.init(upgrader.req.header("sec-websocket-protocol") orelse "");
            var sec_websocket_extensions = ZigString.init(upgrader.req.header("sec-websocket-extensions") orelse "");

            if (sec_websocket_protocol.len > 0) {
                sec_websocket_protocol.markUTF8();
            }
            if (sec_websocket_extensions.len > 0) {
                sec_websocket_extensions.markUTF8();
            }

            var data_value = JSC.JSValue.zero;

            // if we converted a HeadersInit to a Headers object, we need to free it
            var fetch_headers_to_deref: ?*JSC.FetchHeaders = null;

            defer {
                if (fetch_headers_to_deref) |fh| {
                    fh.deref();
                }
            }

            if (optional) |opts| {
                getter: {
                    if (opts.isEmptyOrUndefinedOrNull()) {
                        break :getter;
                    }

                    if (!opts.isObject()) {
                        JSC.throwInvalidArguments("upgrade options must be an object", .{}, globalThis, exception);
                        return JSValue.jsUndefined();
                    }

                    if (opts.fastGet(globalThis, .data)) |headers_value| {
                        data_value = headers_value;
                    }

                    if (opts.fastGet(globalThis, .headers)) |headers_value| {
                        if (headers_value.isEmptyOrUndefinedOrNull()) {
                            break :getter;
                        }

                        var fetch_headers_to_use: *JSC.FetchHeaders = headers_value.as(JSC.FetchHeaders) orelse brk: {
                            if (headers_value.isObject()) {
                                if (JSC.FetchHeaders.createFromJS(globalThis, headers_value)) |fetch_headers| {
                                    fetch_headers_to_deref = fetch_headers;
                                    break :brk fetch_headers;
                                }
                            }
                            break :brk null;
                        } orelse {
                            JSC.throwInvalidArguments("upgrade options.headers must be a Headers or an object", .{}, globalThis, exception);
                            return JSValue.jsUndefined();
                        };

                        if (fetch_headers_to_use.fastGet(.SecWebSocketProtocol)) |protocol| {
                            sec_websocket_protocol = protocol;
                        }

                        if (fetch_headers_to_use.fastGet(.SecWebSocketExtensions)) |protocol| {
                            sec_websocket_extensions = protocol;
                        }

                        // TODO: should we cork?
                        // we must write the status first so that 200 OK isn't written
                        resp.writeStatus("101 Switching Protocols");
                        fetch_headers_to_use.toUWSResponse(comptime ssl_enabled, resp);
                    }
                }
            }

            // --- After this point, do not throw an exception
            // See https://github.com/oven-sh/bun/issues/1339

            // obviously invalid pointer marks it as used
            upgrader.upgrade_context = @intToPtr(*uws.uws_socket_context_s, std.math.maxInt(usize));
            request.upgrader = null;

            resp.clearAborted();

            var ws = this.vm.allocator.create(ServerWebSocket) catch return .zero;
            ws.* = .{
                .handler = &this.config.websocket.?.handler,
                .this_value = data_value,
            };

            var sec_websocket_protocol_str = sec_websocket_protocol.toSlice(bun.default_allocator);
            defer sec_websocket_protocol_str.deinit();
            var sec_websocket_extensions_str = sec_websocket_extensions.toSlice(bun.default_allocator);
            defer sec_websocket_extensions_str.deinit();

            resp.upgrade(
                *ServerWebSocket,
                ws,
                sec_websocket_key_str.slice(),
                sec_websocket_protocol_str.slice(),
                sec_websocket_extensions_str.slice(),
                ctx,
            );

            return JSC.jsBoolean(true);
        }

        pub fn onReload(
            this: *ThisServer,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSObjectRef {
            if (arguments.len < 1) {
                JSC.throwInvalidArguments("Expected 1 argument, got 0", .{}, ctx, exception);
                return js.JSValueMakeUndefined(ctx);
            }

            var args_slice = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
            defer args_slice.deinit();
            var new_config = ServerConfig.fromJS(ctx, &args_slice, exception);
            if (exception.* != null) return js.JSValueMakeUndefined(ctx);

            // only reload those two
            if (this.config.onRequest != new_config.onRequest) {
                this.config.onRequest.unprotect();
                this.config.onRequest = new_config.onRequest;
            }
            if (this.config.onError != new_config.onError) {
                this.config.onError.unprotect();
                this.config.onError = new_config.onError;
            }

            if (new_config.websocket) |*ws| {
                ws.handler.flags.ssl = ssl_enabled;
                if (ws.handler.onMessage != .zero or ws.handler.onOpen != .zero) {
                    if (this.config.websocket) |old_ws| {
                        old_ws.unprotect();
                    } else {
                        this.app.ws("/*", this, 0, ServerWebSocket.behavior(
                            ThisServer,
                            ssl_enabled,
                            ws.toBehavior(),
                        ));
                    }

                    ws.globalObject = ctx;
                    this.config.websocket = ws.*;
                } // we don't remove it
            }

            return this.thisObject.asObjectRef();
        }

        pub fn onFetch(
            this: *ThisServer,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            arguments: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSObjectRef {
            var globalThis = ctx.ptr();
            JSC.markBinding(@src());
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
            var body: JSC.WebCore.Body.Value = .{ .Null = {} };
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
                    .url = url.href,
                    .headers = headers,
                    .body = JSC.WebCore.InitRequestBodyValue(body) catch unreachable,
                    .method = method,
                };
            }

            var request = ctx.bunVM().allocator.create(Request) catch unreachable;
            request.* = existing_request.?;

            var args_ = [_]JSC.C.JSValueRef{request.toJS(this.globalThis).asObjectRef()};
            const response_value = JSC.C.JSObjectCallAsFunctionReturnValue(
                this.globalThis,
                this.config.onRequest.asObjectRef(),
                this.thisObject.asObjectRef(),
                1,
                &args_,
            );

            if (response_value.isAnyError()) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, response_value).asObjectRef();
            }

            if (response_value.isEmptyOrUndefinedOrNull()) {
                return JSC.JSPromise.rejectedPromiseValue(ctx, ZigString.init("fetch() returned an empty value").toErrorInstance(ctx)).asObjectRef();
            }

            if (response_value.asAnyPromise() != null) {
                return response_value.asObjectRef();
            }

            if (response_value.as(JSC.WebCore.Response)) |resp| {
                resp.url = this.allocator.dupe(u8, url.href) catch unreachable;
            }

            return JSC.JSPromise.resolvedPromiseValue(ctx, response_value).asObjectRef();
        }

        pub fn stopFromJS(this: *ThisServer, abruptly: ?JSValue) JSC.JSValue {
            if (this.listener != null) {
                const abrupt = brk: {
                    if (abruptly) |val| {
                        if (val.isBoolean() and val.toBoolean()) {
                            break :brk true;
                        }
                    }
                    break :brk false;
                };

                JSC.C.JSValueUnprotect(this.globalThis, this.thisObject.asObjectRef());
                this.thisObject = JSC.JSValue.jsUndefined();
                this.stop(abrupt);
            }

            return JSC.JSValue.jsUndefined();
        }

        pub fn getPort(this: *ThisServer) JSC.JSValue {
            var listener = this.listener orelse return JSC.JSValue.jsNumber(this.config.port);
            return JSC.JSValue.jsNumber(listener.getLocalPort());
        }

        pub fn getPendingRequests(this: *ThisServer) JSC.JSValue {
            return JSC.JSValue.jsNumber(@intCast(i32, @truncate(u31, this.pending_requests)));
        }

        pub fn getPendingWebSockets(this: *ThisServer) JSC.JSValue {
            return JSC.JSValue.jsNumber(@intCast(i32, @truncate(u31, this.activeSocketsCount())));
        }

        pub fn getHostname(this: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            return ZigString.init(bun.span(this.config.hostname)).toValue(globalThis);
        }

        pub fn getProtocol(_: *ThisServer, globalThis: *JSGlobalObject) JSC.JSValue {
            if (comptime ssl_enabled) {
                return ZigString.init("https:").toValue(globalThis);
            } else {
                return ZigString.init("http:").toValue(globalThis);
            }
        }

        pub fn getDevelopment(
            _: *ThisServer,
        ) JSC.JSValue {
            return JSC.JSValue.jsBoolean(debug_mode);
        }

        pub fn onRequestComplete(this: *ThisServer) void {
            this.vm.eventLoop().processGCTimer();

            this.pending_requests -= 1;
            this.deinitIfWeCan();
        }

        pub fn finalize(this: *ThisServer) void {
            httplog("finalize", .{});
            this.flags.has_js_deinited = true;
            this.deinitIfWeCan();
        }

        pub fn activeSocketsCount(this: *const ThisServer) u32 {
            const websocket = &(this.config.websocket orelse return 0);
            return @truncate(u32, websocket.handler.active_connections);
        }

        pub fn hasActiveWebSockets(this: *const ThisServer) bool {
            return this.activeSocketsCount() > 0;
        }

        pub fn deinitIfWeCan(this: *ThisServer) void {
            httplog("deinitIfWeCan", .{});
            if (this.pending_requests == 0 and this.listener == null and this.flags.has_js_deinited and !this.hasActiveWebSockets()) {
                if (this.config.websocket) |*ws| {
                    ws.handler.app = null;
                }
                this.unref();
                this.scheduleDeinit();
            }
        }

        pub fn stopListening(this: *ThisServer, abrupt: bool) void {
            httplog("stopListening", .{});
            var listener = this.listener orelse return;
            this.listener = null;
            this.unref();
            if (!abrupt) {
                listener.close();
            } else {
                this.flags.terminated = true;
                this.app.close();
            }
        }

        pub fn stop(this: *ThisServer, abrupt: bool) void {
            this.stopListening(abrupt);
            this.deinitIfWeCan();
        }

        pub fn scheduleDeinit(this: *ThisServer) void {
            if (this.flags.deinit_scheduled)
                return;
            this.flags.deinit_scheduled = true;
            httplog("scheduleDeinit", .{});

            if (!this.flags.terminated) {
                this.flags.terminated = true;
                this.app.close();
            }

            var task = bun.default_allocator.create(JSC.AnyTask) catch unreachable;
            task.* = JSC.AnyTask.New(ThisServer, deinit).init(this);
            this.vm.enqueueTask(JSC.Task.init(task));
        }

        pub fn deinit(this: *ThisServer) void {
            httplog("deinit", .{});
            this.app.destroy();
            const allocator = this.allocator;
            allocator.destroy(this);
        }

        pub fn init(config: ServerConfig, globalThis: *JSGlobalObject) *ThisServer {
            var server = bun.default_allocator.create(ThisServer) catch @panic("Out of memory!");
            server.* = .{
                .globalThis = globalThis,
                .config = config,
                .base_url_string_for_joining = bun.default_allocator.dupe(u8, strings.trim(config.base_url.href, "/")) catch unreachable,
                .vm = JSC.VirtualMachine.get(),
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
            httplog("onListenFailed", .{});
            this.unref();

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
                    var encoded_str = zig_str.withEncoding();
                    encoded_str.mark();

                    // We shouldn't *need* to do this but it's not entirely clear.
                    BoringSSL.ERR_clear_error();
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

        pub fn onListen(this: *ThisServer, socket: ?*App.ListenSocket) void {
            if (socket == null) {
                return this.onListenFailed();
            }

            this.listener = socket;
            this.vm.uws_event_loop = uws.Loop.get();
        }

        pub fn ref(this: *ThisServer) void {
            if (this.poll_ref.isActive()) return;

            this.poll_ref.ref(this.vm);
            this.vm.eventLoop().start_server_on_next_tick = true;
        }

        pub fn unref(this: *ThisServer) void {
            if (!this.poll_ref.isActive()) return;

            this.poll_ref.unrefOnNextTick(this.vm);
            this.vm.eventLoop().start_server_on_next_tick = false;
        }

        pub fn onBunInfoRequest(this: *ThisServer, req: *uws.Request, resp: *App.Response) void {
            JSC.markBinding(@src());
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
                bun.Global.BunInfo.generate(*Bundler, &JSC.VirtualMachine.get().bundler, allocator) catch unreachable,
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
            JSC.markBinding(@src());
            this.pending_requests += 1;
            defer this.pending_requests -= 1;
            req.setYield(false);
            if (req.header("open-in-editor") == null) {
                resp.writeStatus("501 Not Implemented");
                resp.end("Viewing source without opening in editor is not implemented yet!", false);
                return;
            }

            var ctx = &JSC.VirtualMachine.get().rareData().editor_context;
            ctx.autoDetectEditor(JSC.VirtualMachine.get().bundler.env);
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

        pub fn onRequest(
            this: *ThisServer,
            req: *uws.Request,
            resp: *App.Response,
        ) void {
            JSC.markBinding(@src());
            this.pending_requests += 1;
            req.setYield(false);
            var ctx = this.request_pool_allocator.create(RequestContext) catch @panic("ran out of memory");
            ctx.create(this, req, resp);
            var request_object = this.allocator.create(JSC.WebCore.Request) catch unreachable;
            var body = JSC.WebCore.InitRequestBodyValue(.{ .Null = {} }) catch unreachable;

            ctx.request_body = body;
            const js_signal = JSC.WebCore.AbortSignal.create(this.globalThis);
            js_signal.ensureStillAlive();
            if (JSC.WebCore.AbortSignal.fromJS(js_signal)) |signal| {
                ctx.signal = signal.ref().ref(); // +2 refs 1 for the request and 1 for the request context
            }

            request_object.* = .{
                .url = "",
                .method = ctx.method,
                .uws_request = req,
                .https = ssl_enabled,
                .signal = ctx.signal,
                .body = body.ref(),
            };

            if (comptime debug_mode) {
                ctx.is_web_browser_navigation = brk: {
                    if (ctx.req.header("sec-fetch-dest")) |fetch_dest| {
                        if (strings.eqlComptime(fetch_dest, "document")) {
                            break :brk true;
                        }
                    }

                    break :brk false;
                };
            }

            // we need to do this very early unfortunately
            // it seems to work fine for synchronous requests but anything async will take too long to register the handler
            // we do this only for HTTP methods that support request bodies, so not GET, HEAD, OPTIONS, or CONNECT.
            if ((HTTP.Method.which(req.method()) orelse HTTP.Method.OPTIONS).hasRequestBody()) {
                const req_len: usize = brk: {
                    if (req.header("content-length")) |content_length| {
                        break :brk std.fmt.parseInt(usize, content_length, 10) catch 0;
                    }

                    break :brk 0;
                };

                if (req_len > this.config.max_request_body_size) {
                    resp.writeStatus("413 Request Entity Too Large");
                    resp.endWithoutBody(true);
                    this.finalize();
                    return;
                }

                ctx.request_body_content_len = req_len;
                ctx.is_transfer_encoding = req.header("transfer-encoding") != null;
                if (req_len > 0 or ctx.is_transfer_encoding) {
                    // we defer pre-allocating the body until we receive the first chunk
                    // that way if the client is lying about how big the body is or the client aborts
                    // we don't waste memory
                    ctx.request_body.?.value = .{
                        .Locked = .{
                            .task = ctx,
                            .global = this.globalThis,
                            .onStartBuffering = RequestContext.onStartBufferingCallback,
                            .onStartStreaming = RequestContext.onStartStreamingRequestBodyCallback,
                        },
                    };
                    ctx.is_waiting_body = true;
                    resp.onData(*RequestContext, RequestContext.onBufferedBodyChunk, ctx);
                }
            }

            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.JSValue{
                request_object.toJS(this.globalThis),
                this.thisObject,
            };

            const request_value = args[0];
            request_value.ensureStillAlive();

            const response_value = this.config.onRequest.callWithThis(this.globalThis, this.thisObject, &args);

            ctx.onResponse(
                this,
                req,
                request_object,
                request_value,
                response_value,
            );
            // uWS request will not live longer than this function
            request_object.uws_request = null;
        }

        pub fn onWebSocketUpgrade(
            this: *ThisServer,
            resp: *App.Response,
            req: *uws.Request,
            upgrade_ctx: *uws.uws_socket_context_t,
            _: usize,
        ) void {
            JSC.markBinding(@src());
            this.pending_requests += 1;
            req.setYield(false);
            var ctx = this.request_pool_allocator.create(RequestContext) catch @panic("ran out of memory");
            ctx.create(this, req, resp);
            var request_object = this.allocator.create(JSC.WebCore.Request) catch unreachable;
            var body = JSC.WebCore.InitRequestBodyValue(.{ .Null = {} }) catch unreachable;

            ctx.request_body = body;
            const js_signal = JSC.WebCore.AbortSignal.create(this.globalThis);
            js_signal.ensureStillAlive();
            if (JSC.WebCore.AbortSignal.fromJS(js_signal)) |signal| {
                ctx.signal = signal.ref().ref(); // +2 refs 1 for the request and 1 for the request context
            }

            request_object.* = .{
                .url = "",
                .method = ctx.method,
                .uws_request = req,
                .upgrader = ctx,
                .https = ssl_enabled,
                .signal = ctx.signal,
                .body = body.ref(),
            };
            ctx.upgrade_context = upgrade_ctx;

            // We keep the Request object alive for the duration of the request so that we can remove the pointer to the UWS request object.
            var args = [_]JSC.JSValue{
                request_object.toJS(this.globalThis),
                this.thisObject,
            };
            const request_value = args[0];
            request_value.ensureStillAlive();
            const response_value = this.config.onRequest.callWithThis(this.globalThis, this.thisObject, &args);

            ctx.onResponse(
                this,
                req,
                request_object,
                request_value,
                response_value,
            );

            // uWS request will not live longer than this function
            request_object.uws_request = null;
        }

        pub fn listen(this: *ThisServer) void {
            httplog("listen", .{});
            if (ssl_enabled) {
                BoringSSL.load();
                const ssl_config = this.config.ssl_config orelse @panic("Assertion failure: ssl_config");
                this.app = App.create(ssl_config.asUSockets());

                if (ssl_config.server_name != null and std.mem.span(ssl_config.server_name).len > 0) {
                    this.app.addServerName(ssl_config.server_name);
                }
            } else {
                this.app = App.create(.{});
            }

            if (this.config.websocket) |*websocket| {
                websocket.globalObject = this.globalThis;
                websocket.handler.app = this.app;
                websocket.handler.flags.ssl = ssl_enabled;
                this.app.ws(
                    "/*",
                    this,
                    0,
                    ServerWebSocket.behavior(ThisServer, ssl_enabled, websocket.toBehavior()),
                );
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
            var host: [*:0]const u8 = undefined;
            var host_buff: [1024:0]u8 = undefined;

            if (hostname.len == 0 or (!ssl_enabled and strings.eqlComptime(hostname, "localhost"))) {
                host = "";
            } else if (hostname.len > 2 and hostname[0] == '[') {
                // remove "[" and "]" from hostname
                host = std.fmt.bufPrintZ(&host_buff, "{s}", .{hostname[1 .. hostname.len - 1]}) catch unreachable;
            } else {
                host = this.config.hostname;
            }

            this.ref();

            // Starting up an HTTP server is a good time to GC
            if (this.vm.aggressive_garbage_collection == .aggressive) {
                this.vm.autoGarbageCollect();
            } else {
                this.vm.eventLoop().performGC();
            }

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

pub const AnyServer = union(enum) {
    Server: *Server,
    SSLServer: *SSLServer,
    DebugServer: *DebugServer,
    DebugSSLServer: *DebugSSLServer,
};

const welcome_page_html_gz = @embedFile("welcome-page.html.gz");
