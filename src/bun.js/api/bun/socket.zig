const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../../../which.zig");
const uws = @import("root").bun.uws;
const ZigString = JSC.ZigString;
const BoringSSL = bun.BoringSSL;
const X509 = @import("./x509.zig");
const Async = bun.Async;

// const Corker = struct {
//     ptr: ?*[16384]u8 = null,
//     holder: ?*anyopaque = null,
//     list: bun.ByteList = .{},

//     pub fn write(this: *Corker, owner: *anyopaque, bytes: []const u8) usize {
//         if (this.holder != null and this.holder.? != owner) {
//             return 0;
//         }

//         this.holder = owner;
//         if (this.ptr == null) {
//             this.ptr = bun.default_allocator.alloc(u8, 16384) catch @panic("Out of memory allocating corker");
//             std.debug.assert(this.list.cap == 0);
//             std.debug.assert(this.list.len == 0);
//             this.list.cap = 16384;
//             this.list.ptr = this.ptr.?;
//             this.list.len = 0;
//         }
//     }

//     pub fn flushIfNecessary(this: *Corker, comptime ssl: bool, socket: uws.NewSocketHandler(ssl), owner: *anyopaque) void {
//         if (this.holder == null or this.holder.? != owner) {
//             return;
//         }

//         if (this.ptr == null) {
//             return;
//         }

//         if (this.list.len == 0) {
//             return;
//         }

//         const bytes = ths.list.slice();

//         this.list.len = 0;
//     }
// };

noinline fn getSSLException(globalThis: *JSC.JSGlobalObject, defaultMessage: []const u8) JSValue {
    var zig_str: ZigString = ZigString.init("");
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
            @memcpy(output_buf[written..][0..reason.len], reason);
            written += reason.len;
        }

        if (BoringSSL.ERR_func_error_string(
            ssl_error,
        )) |reason_ptr| {
            const reason = std.mem.span(reason_ptr);
            if (reason.len > 0) {
                output_buf[written..][0.." via ".len].* = " via ".*;
                written += " via ".len;
                @memcpy(output_buf[written..][0..reason.len], reason);
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
                @memcpy(output_buf[written..][0..reason.len], reason);
                written += reason.len;
            }
        }
    }

    if (written > 0) {
        const message = output_buf[0..written];
        zig_str = ZigString.init(std.fmt.allocPrint(bun.default_allocator, "OpenSSL {s}", .{message}) catch unreachable);
        var encoded_str = zig_str.withEncoding();
        encoded_str.mark();

        // We shouldn't *need* to do this but it's not entirely clear.
        BoringSSL.ERR_clear_error();
    }

    if (zig_str.len == 0) {
        zig_str = ZigString.init(defaultMessage);
    }

    // store the exception in here
    // toErrorInstance clones the string
    const exception = zig_str.toErrorInstance(globalThis);

    // reference it in stack memory
    exception.ensureStillAlive();

    return exception;
}

fn normalizeHost(input: anytype) @TypeOf(input) {
    return input;
}
const BinaryType = JSC.BinaryType;

const WrappedType = enum {
    none,
    tls,
    tcp,
};
const Handlers = struct {
    onOpen: JSC.JSValue = .zero,
    onClose: JSC.JSValue = .zero,
    onData: JSC.JSValue = .zero,
    onWritable: JSC.JSValue = .zero,
    onTimeout: JSC.JSValue = .zero,
    onConnectError: JSC.JSValue = .zero,
    onEnd: JSC.JSValue = .zero,
    onError: JSC.JSValue = .zero,
    onHandshake: JSC.JSValue = .zero,

    binary_type: BinaryType = .Buffer,

    vm: *JSC.VirtualMachine,
    globalObject: *JSC.JSGlobalObject,
    active_connections: u32 = 0,
    is_server: bool = false,
    promise: JSC.Strong = .{},

    protection_count: bun.DebugOnly(u32) = bun.DebugOnlyDefault(0),

    pub fn markActive(this: *Handlers) void {
        Listener.log("markActive", .{});

        this.active_connections += 1;
    }

    pub const Scope = struct {
        handlers: *Handlers,
        socket_context: ?*uws.SocketContext,

        pub fn exit(this: *Scope, ssl: bool, wrapped: WrappedType) void {
            var vm = this.handlers.vm;
            defer vm.drainMicrotasks();
            this.handlers.markInactive(ssl, this.socket_context, wrapped);
        }
    };

    pub fn enter(this: *Handlers, context: ?*uws.SocketContext) Scope {
        this.markActive();
        return .{
            .handlers = this,
            .socket_context = context,
        };
    }

    // corker: Corker = .{},

    pub fn resolvePromise(this: *Handlers, value: JSValue) void {
        const promise = this.promise.trySwap() orelse return;
        const anyPromise = promise.asAnyPromise() orelse return;
        anyPromise.resolve(this.globalObject, value);
    }

    pub fn rejectPromise(this: *Handlers, value: JSValue) bool {
        const promise = this.promise.trySwap() orelse return false;
        const anyPromise = promise.asAnyPromise() orelse return false;
        anyPromise.reject(this.globalObject, value);
        return true;
    }

    pub fn markInactive(this: *Handlers, ssl: bool, ctx: ?*uws.SocketContext, wrapped: WrappedType) void {
        Listener.log("markInactive", .{});
        this.active_connections -= 1;
        if (this.active_connections == 0) {
            if (this.is_server) {
                var listen_socket: *Listener = @fieldParentPtr(Listener, "handlers", this);
                // allow it to be GC'd once the last connection is closed and it's not listening anymore
                if (listen_socket.listener == null) {
                    listen_socket.strong_self.clear();
                }
            } else {
                this.unprotect();
                // will deinit when is not wrapped or when is the TCP wrapped connection
                if (wrapped != .tls) {
                    if (ctx) |ctx_|
                        ctx_.deinit(ssl);
                }
                bun.default_allocator.destroy(this);
            }
        }
    }

    pub fn callErrorHandler(this: *Handlers, thisValue: JSValue, err: []const JSValue) bool {
        const onError = this.onError;
        if (onError == .zero) {
            if (err.len > 0)
                this.vm.onUnhandledError(this.globalObject, err[0]);

            return false;
        }

        const result = onError.callWithThis(this.globalObject, thisValue, err);
        if (result.isAnyError()) {
            this.vm.onUnhandledError(this.globalObject, result);
        }

        return true;
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, opts: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Handlers {
        var handlers = Handlers{
            .vm = globalObject.bunVM(),
            .globalObject = globalObject,
        };

        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected \"socket\" to be an object", .{}, globalObject).asObjectRef();
            return null;
        }

        const pairs = .{
            .{ "onData", "data" },
            .{ "onWritable", "drain" },
            .{ "onOpen", "open" },
            .{ "onClose", "close" },
            .{ "onTimeout", "timeout" },
            .{ "onConnectError", "connectError" },
            .{ "onEnd", "end" },
            .{ "onError", "error" },
            .{ "onHandshake", "handshake" },
        };
        inline for (pairs) |pair| {
            if (opts.getTruthy(globalObject, pair.@"1")) |callback_value| {
                if (!callback_value.isCell() or !callback_value.isCallable(globalObject.vm())) {
                    exception.* = JSC.toInvalidArguments(comptime std.fmt.comptimePrint("Expected \"{s}\" callback to be a function", .{pair.@"1"}), .{}, globalObject).asObjectRef();
                    return null;
                }

                @field(handlers, pair.@"0") = callback_value;
            }
        }

        if (handlers.onData == .zero and handlers.onWritable == .zero) {
            exception.* = JSC.toInvalidArguments("Expected at least \"data\" or \"drain\" callback", .{}, globalObject).asObjectRef();
            return null;
        }

        if (opts.getTruthy(globalObject, "binaryType")) |binary_type_value| {
            if (!binary_type_value.isString()) {
                exception.* = JSC.toInvalidArguments("Expected \"binaryType\" to be a string", .{}, globalObject).asObjectRef();
                return null;
            }

            handlers.binary_type = BinaryType.fromJSValue(globalObject, binary_type_value) orelse {
                exception.* = JSC.toInvalidArguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", .{}, globalObject).asObjectRef();
                return null;
            };
        }

        return handlers;
    }

    pub fn unprotect(this: *Handlers) void {
        if (comptime Environment.allow_assert) {
            std.debug.assert(this.protection_count > 0);
            this.protection_count -= 1;
        }
        this.onOpen.unprotect();
        this.onClose.unprotect();
        this.onData.unprotect();
        this.onWritable.unprotect();
        this.onTimeout.unprotect();
        this.onConnectError.unprotect();
        this.onEnd.unprotect();
        this.onError.unprotect();
        this.onHandshake.unprotect();
    }

    pub fn protect(this: *Handlers) void {
        if (comptime Environment.allow_assert) {
            this.protection_count += 1;
        }
        this.onOpen.protect();
        this.onClose.protect();
        this.onData.protect();
        this.onWritable.protect();
        this.onTimeout.protect();
        this.onConnectError.protect();
        this.onEnd.protect();
        this.onError.protect();
        this.onHandshake.protect();
    }
};

pub const SocketConfig = struct {
    hostname_or_unix: JSC.ZigString.Slice,
    port: ?u16 = null,
    ssl: ?JSC.API.ServerConfig.SSLConfig = null,
    handlers: Handlers,
    default_data: JSC.JSValue = .zero,
    exclusive: bool = false,

    pub fn fromJS(
        opts: JSC.JSValue,
        globalObject: *JSC.JSGlobalObject,
        exception: JSC.C.ExceptionRef,
    ) ?SocketConfig {
        var hostname_or_unix: JSC.ZigString.Slice = JSC.ZigString.Slice.empty;
        var port: ?u16 = null;
        var exclusive = false;

        var ssl: ?JSC.API.ServerConfig.SSLConfig = null;
        var default_data = JSValue.zero;

        if (opts.getTruthy(globalObject, "tls")) |tls| {
            if (tls.isBoolean()) {
                if (tls.toBoolean()) {
                    ssl = JSC.API.ServerConfig.SSLConfig.zero;
                }
            } else {
                if (JSC.API.ServerConfig.SSLConfig.inJS(globalObject, tls, exception)) |ssl_config| {
                    ssl = ssl_config;
                } else if (exception.* != null) {
                    return null;
                }
            }
        }

        hostname_or_unix: {
            if (opts.getTruthy(globalObject, "fd")) |fd_| {
                if (fd_.isNumber()) {
                    break :hostname_or_unix;
                }
            }

            if (opts.getTruthy(globalObject, "unix")) |unix_socket| {
                if (!unix_socket.isString()) {
                    exception.* = JSC.toInvalidArguments("Expected \"unix\" to be a string", .{}, globalObject).asObjectRef();
                    return null;
                }

                hostname_or_unix = unix_socket.getZigString(globalObject).toSlice(bun.default_allocator);

                if (strings.hasPrefixComptime(hostname_or_unix.slice(), "file://") or strings.hasPrefixComptime(hostname_or_unix.slice(), "unix://") or strings.hasPrefixComptime(hostname_or_unix.slice(), "sock://")) {
                    hostname_or_unix.ptr += 7;
                    hostname_or_unix.len -|= 7;
                }

                if (hostname_or_unix.len > 0) {
                    break :hostname_or_unix;
                }
            }

            if (opts.getTruthy(globalObject, "exclusive")) |_| {
                exclusive = true;
            }

            if (opts.getTruthy(globalObject, "hostname") orelse opts.getTruthy(globalObject, "host")) |hostname| {
                if (!hostname.isString()) {
                    exception.* = JSC.toInvalidArguments("Expected \"hostname\" to be a string", .{}, globalObject).asObjectRef();
                    return null;
                }

                var port_value = opts.get(globalObject, "port") orelse JSValue.zero;
                hostname_or_unix = hostname.getZigString(globalObject).toSlice(bun.default_allocator);

                if (port_value.isEmptyOrUndefinedOrNull() and hostname_or_unix.len > 0) {
                    const parsed_url = bun.URL.parse(hostname_or_unix.slice());
                    if (parsed_url.getPort()) |port_num| {
                        port_value = JSValue.jsNumber(port_num);
                        hostname_or_unix.ptr = parsed_url.hostname.ptr;
                        hostname_or_unix.len = @as(u32, @truncate(parsed_url.hostname.len));
                    }
                }

                if (port_value.isEmptyOrUndefinedOrNull() or !port_value.isNumber() or port_value.toInt64() > std.math.maxInt(u16) or port_value.toInt64() < 0) {
                    exception.* = JSC.toInvalidArguments("Expected \"port\" to be a number between 0 and 65535", .{}, globalObject).asObjectRef();
                    return null;
                }

                port = port_value.toU16();

                if (hostname_or_unix.len == 0) {
                    exception.* = JSC.toInvalidArguments("Expected \"hostname\" to be a non-empty string", .{}, globalObject).asObjectRef();
                    return null;
                }

                if (hostname_or_unix.len > 0) {
                    break :hostname_or_unix;
                }
            }

            if (hostname_or_unix.len == 0) {
                exception.* = JSC.toInvalidArguments("Expected \"unix\" or \"hostname\" to be a non-empty string", .{}, globalObject).asObjectRef();
                return null;
            }

            exception.* = JSC.toInvalidArguments("Expected either \"hostname\" or \"unix\"", .{}, globalObject).asObjectRef();
            return null;
        }

        var handlers = Handlers.fromJS(globalObject, opts.get(globalObject, "socket") orelse JSValue.zero, exception) orelse {
            hostname_or_unix.deinit();
            return null;
        };

        if (opts.getTruthy(globalObject, "data")) |default_data_value| {
            default_data = default_data_value;
        }

        handlers.protect();

        return SocketConfig{
            .hostname_or_unix = hostname_or_unix,
            .port = port,
            .ssl = ssl,
            .handlers = handlers,
            .default_data = default_data,
            .exclusive = exclusive,
        };
    }
};

pub const Listener = struct {
    pub const log = Output.scoped(.Listener, false);

    handlers: Handlers,
    listener: ?*uws.ListenSocket = null,
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
    connection: UnixOrHost,
    socket_context: ?*uws.SocketContext = null,
    ssl: bool = false,
    protos: ?[]const u8 = null,

    strong_data: JSC.Strong = .{},
    strong_self: JSC.Strong = .{},

    pub usingnamespace JSC.Codegen.JSListener;

    pub fn getData(
        this: *Listener,
        _: *JSC.JSGlobalObject,
    ) callconv(.C) JSValue {
        log("getData()", .{});
        return this.strong_data.get() orelse JSValue.jsUndefined();
    }

    pub fn setData(
        this: *Listener,
        globalObject: *JSC.JSGlobalObject,
        value: JSC.JSValue,
    ) callconv(.C) bool {
        log("setData()", .{});
        this.strong_data.set(globalObject, value);
        return true;
    }

    const UnixOrHost = union(enum) {
        unix: []const u8,
        host: struct {
            host: []const u8,
            port: u16,
        },
        fd: bun.FileDescriptor,

        pub fn clone(this: UnixOrHost) UnixOrHost {
            switch (this) {
                .unix => |u| {
                    return .{
                        .unix = (bun.default_allocator.dupe(u8, u) catch unreachable),
                    };
                },
                .host => |h| {
                    return .{
                        .host = .{
                            .host = (bun.default_allocator.dupe(u8, h.host) catch unreachable),
                            .port = this.host.port,
                        },
                    };
                },
                .fd => |f| return .{ .fd = f },
            }
        }

        pub fn deinit(this: UnixOrHost) void {
            switch (this) {
                .unix => |u| {
                    bun.default_allocator.free(u);
                },
                .host => |h| {
                    bun.default_allocator.free(h.host);
                },
                .fd => {}, // this is an integer
            }
        }
    };

    pub fn reload(this: *Listener, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const args = callframe.arguments(1);

        if (args.len < 1 or (this.listener == null and this.handlers.active_connections == 0)) {
            globalObject.throw("Expected 1 argument", .{});
            return .zero;
        }

        const opts = args.ptr[0];
        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            globalObject.throwValue(JSC.toInvalidArguments("Expected options object", .{}, globalObject));
            return .zero;
        }

        var exception: JSC.C.JSValueRef = null;

        const socket_obj = opts.get(globalObject, "socket") orelse {
            globalObject.throw("Expected \"socket\" object", .{});
            return .zero;
        };

        const handlers = Handlers.fromJS(globalObject, socket_obj, &exception) orelse {
            globalObject.throwValue(exception.?.value());
            return .zero;
        };

        var prev_handlers = &this.handlers;
        prev_handlers.unprotect();
        this.handlers = handlers; // TODO: this is a memory leak
        this.handlers.protect();

        return JSValue.jsUndefined();
    }

    pub fn listen(globalObject: *JSC.JSGlobalObject, opts: JSValue) JSValue {
        log("listen", .{});
        var exception_ = [1]JSC.JSValueRef{null};
        const exception: JSC.C.ExceptionRef = &exception_;
        defer {
            if (exception_[0] != null) {
                globalObject.throwValue(exception_[0].?.value());
            }
        }
        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected object", .{}, globalObject).asObjectRef();
            return .zero;
        }

        var socket_config = SocketConfig.fromJS(opts, globalObject, exception) orelse {
            return .zero;
        };

        var hostname_or_unix = socket_config.hostname_or_unix;
        const port = socket_config.port;
        var ssl = socket_config.ssl;
        var handlers = socket_config.handlers;
        var protos: ?[]const u8 = null;
        const exclusive = socket_config.exclusive;
        handlers.is_server = true;

        const ssl_enabled = ssl != null;

        const socket_flags: i32 = if (exclusive) 1 else 0;

        const ctx_opts: uws.us_bun_socket_context_options_t = JSC.API.ServerConfig.SSLConfig.asUSockets(ssl);

        defer if (ssl != null) ssl.?.deinit();
        globalObject.bunVM().eventLoop().ensureWaker();

        const socket_context = uws.us_create_bun_socket_context(
            @intFromBool(ssl_enabled),
            uws.Loop.get(),
            @sizeOf(usize),
            ctx_opts,
        ) orelse {
            var err = globalObject.createErrorInstance("Failed to listen on {s}:{d}", .{ hostname_or_unix.slice(), port orelse 0 });
            defer {
                socket_config.handlers.unprotect();
                hostname_or_unix.deinit();
            }

            const errno = @intFromEnum(std.c.getErrno(-1));
            if (errno != 0) {
                err.put(globalObject, ZigString.static("errno"), JSValue.jsNumber(errno));
                if (bun.C.SystemErrno.init(errno)) |str| {
                    err.put(globalObject, ZigString.static("code"), ZigString.init(@tagName(str)).toValueGC(globalObject));
                }
            }

            exception.* = err.asObjectRef();
            return .zero;
        };

        if (ssl_enabled) {
            if (ssl.?.protos) |p| {
                protos = p[0..ssl.?.protos_len];
            }

            uws.NewSocketHandler(true).configure(
                socket_context,
                true,
                *TLSSocket,
                struct {
                    pub const onOpen = NewSocket(true).onOpen;
                    pub const onCreate = onCreateTLS;
                    pub const onClose = NewSocket(true).onClose;
                    pub const onData = NewSocket(true).onData;
                    pub const onWritable = NewSocket(true).onWritable;
                    pub const onTimeout = NewSocket(true).onTimeout;
                    pub const onConnectError = NewSocket(true).onConnectError;
                    pub const onEnd = NewSocket(true).onEnd;
                    pub const onHandshake = NewSocket(true).onHandshake;
                },
            );
        } else {
            uws.NewSocketHandler(false).configure(
                socket_context,
                true,
                *TCPSocket,
                struct {
                    pub const onOpen = NewSocket(false).onOpen;
                    pub const onCreate = onCreateTCP;
                    pub const onClose = NewSocket(false).onClose;
                    pub const onData = NewSocket(false).onData;
                    pub const onWritable = NewSocket(false).onWritable;
                    pub const onTimeout = NewSocket(false).onTimeout;
                    pub const onConnectError = NewSocket(false).onConnectError;
                    pub const onEnd = NewSocket(false).onEnd;
                    pub const onHandshake = NewSocket(false).onHandshake;
                },
            );
        }

        var connection: Listener.UnixOrHost = if (port) |port_| .{
            .host = .{ .host = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch unreachable).slice(), .port = port_ },
        } else .{
            .unix = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch unreachable).slice(),
        };

        const listen_socket: *uws.ListenSocket = brk: {
            switch (connection) {
                .host => |c| {
                    const host = bun.default_allocator.dupeZ(u8, c.host) catch unreachable;
                    defer bun.default_allocator.free(host);

                    const socket = uws.us_socket_context_listen(
                        @intFromBool(ssl_enabled),
                        socket_context,
                        if (host.len == 0) null else host.ptr,
                        c.port,
                        socket_flags,
                        8,
                    );
                    // should return the assigned port
                    if (socket) |s| {
                        connection.host.port = @as(u16, @intCast(s.getLocalPort(ssl_enabled)));
                    }
                    break :brk socket;
                },
                .unix => |u| {
                    const host = bun.default_allocator.dupeZ(u8, u) catch unreachable;
                    defer bun.default_allocator.free(host);
                    break :brk uws.us_socket_context_listen_unix(@intFromBool(ssl_enabled), socket_context, host, socket_flags, 8);
                },
                .fd => {
                    // don't call listen() on an fd
                    return .zero;
                },
            }
        } orelse {
            defer {
                hostname_or_unix.deinit();
                uws.us_socket_context_free(@intFromBool(ssl_enabled), socket_context);
            }

            const err = globalObject.createErrorInstance(
                "Failed to listen at {s}",
                .{
                    bun.span(hostname_or_unix.slice()),
                },
            );
            const errno = @intFromEnum(std.c.getErrno(-1));
            if (errno != 0) {
                err.put(globalObject, ZigString.static("errno"), JSValue.jsNumber(errno));
                if (bun.C.SystemErrno.init(errno)) |str| {
                    err.put(globalObject, ZigString.static("code"), ZigString.init(@tagName(str)).toValueGC(globalObject));
                }
            }
            exception.* = err.asObjectRef();

            return .zero;
        };

        var socket = Listener{
            .handlers = handlers,
            .connection = connection,
            .ssl = ssl_enabled,
            .socket_context = socket_context,
            .listener = listen_socket,
            .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch unreachable) else null,
        };

        socket.handlers.protect();

        if (socket_config.default_data != .zero) {
            socket.strong_data = JSC.Strong.create(socket_config.default_data, globalObject);
        }

        if (ssl) |ssl_config| {
            if (ssl_config.server_name) |server_name| {
                const slice = bun.asByteSlice(server_name);
                if (slice.len > 0)
                    uws.us_bun_socket_context_add_server_name(1, socket.socket_context, server_name, ctx_opts, null);
            }
        }

        var this: *Listener = handlers.vm.allocator.create(Listener) catch @panic("OOM");
        this.* = socket;
        this.socket_context.?.ext(ssl_enabled, *Listener).?.* = this;

        const this_value = this.toJS(globalObject);
        this.strong_self.set(globalObject, this_value);
        this.poll_ref.ref(handlers.vm);

        return this_value;
    }

    pub fn onCreateTLS(
        socket: uws.NewSocketHandler(true),
    ) void {
        onCreate(true, socket);
    }

    pub fn onCreateTCP(
        socket: uws.NewSocketHandler(false),
    ) void {
        onCreate(false, socket);
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*Listener {
        globalObject.throw("Cannot construct Listener", .{});
        return null;
    }

    pub fn onCreate(comptime ssl: bool, socket: uws.NewSocketHandler(ssl)) void {
        JSC.markBinding(@src());
        log("onCreate", .{});
        var listener: *Listener = socket.context().?.ext(ssl, *Listener).?.*;
        const Socket = NewSocket(ssl);
        std.debug.assert(ssl == listener.ssl);

        var this_socket = listener.handlers.vm.allocator.create(Socket) catch @panic("Out of memory");
        this_socket.* = Socket{
            .handlers = &listener.handlers,
            .this_value = .zero,
            .socket = socket,
            .protos = listener.protos,
            .owned_protos = false,
        };
        if (listener.strong_data.get()) |default_data| {
            const globalObject = listener.handlers.globalObject;
            Socket.dataSetCached(this_socket.getThisValue(globalObject), globalObject, default_data);
        }
        socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, this_socket);
        socket.setTimeout(120000);
    }

    // pub fn addServerName(this: *Listener, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {

    //     uws.us_socket_context_add_server_name
    // }

    // pub fn removeServerName(this: *Listener, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
    //     uws.us_socket_context_add_server_name
    // }

    // pub fn removeServerName(this: *Listener, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
    //     uws.us_socket_context_add_server_name
    // }

    pub fn stop(this: *Listener, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const arguments = callframe.arguments(1);
        log("close", .{});

        if (arguments.len > 0 and arguments.ptr[0].isBoolean() and arguments.ptr[0].toBoolean() and this.socket_context != null) {
            this.socket_context.?.close(this.ssl);
            this.listener = null;
        } else {
            var listener = this.listener orelse return JSValue.jsUndefined();
            this.listener = null;
            listener.close(this.ssl);
        }

        this.poll_ref.unref(this.handlers.vm);
        if (this.handlers.active_connections == 0) {
            this.handlers.unprotect();
            this.socket_context.?.close(this.ssl);
            this.socket_context.?.deinit(this.ssl);
            this.socket_context = null;
            this.strong_self.clear();
            this.strong_data.clear();
        }

        return JSValue.jsUndefined();
    }

    pub fn finalize(this: *Listener) callconv(.C) void {
        log("Finalize", .{});
        this.deinit();
    }

    pub fn deinit(this: *Listener) void {
        this.strong_self.deinit();
        this.strong_data.deinit();
        this.poll_ref.unref(this.handlers.vm);
        std.debug.assert(this.listener == null);
        std.debug.assert(this.handlers.active_connections == 0);
        this.handlers.unprotect();

        if (this.socket_context) |ctx| {
            ctx.deinit(this.ssl);
        }

        this.connection.deinit();
        if (this.protos) |protos| {
            this.protos = null;
            bun.default_allocator.free(protos);
        }
        bun.default_allocator.destroy(this);
    }

    pub fn getConnectionsCount(this: *Listener, _: *JSC.JSGlobalObject) callconv(.C) JSValue {
        return JSValue.jsNumber(this.handlers.active_connections);
    }

    pub fn getUnix(this: *Listener, globalObject: *JSC.JSGlobalObject) callconv(.C) JSValue {
        if (this.connection != .unix) {
            return JSValue.jsUndefined();
        }

        return ZigString.init(this.connection.unix).withEncoding().toValueGC(globalObject);
    }

    pub fn getHostname(this: *Listener, globalObject: *JSC.JSGlobalObject) callconv(.C) JSValue {
        if (this.connection != .host) {
            return JSValue.jsUndefined();
        }
        return ZigString.init(this.connection.host.host).withEncoding().toValueGC(globalObject);
    }

    pub fn getPort(this: *Listener, _: *JSC.JSGlobalObject) callconv(.C) JSValue {
        if (this.connection != .host) {
            return JSValue.jsUndefined();
        }
        return JSValue.jsNumber(this.connection.host.port);
    }

    pub fn ref(this: *Listener, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        const this_value = callframe.this();
        if (this.listener == null) return JSValue.jsUndefined();
        this.poll_ref.ref(globalObject.bunVM());
        this.strong_self.set(globalObject, this_value);
        return JSValue.jsUndefined();
    }

    pub fn unref(this: *Listener, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.poll_ref.unref(globalObject.bunVM());
        if (this.handlers.active_connections == 0) {
            this.strong_self.clear();
        }
        return JSValue.jsUndefined();
    }

    pub fn connect(
        globalObject: *JSC.JSGlobalObject,
        opts: JSValue,
    ) JSValue {
        var exception_ = [1]JSC.JSValueRef{null};
        const exception: JSC.C.ExceptionRef = &exception_;
        defer {
            if (exception_[0] != null) {
                globalObject.throwValue(exception_[0].?.value());
            }
        }
        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected options object", .{}, globalObject).asObjectRef();
            return .zero;
        }

        const socket_config = SocketConfig.fromJS(opts, globalObject, exception) orelse {
            return .zero;
        };

        var hostname_or_unix = socket_config.hostname_or_unix;
        const port = socket_config.port;
        var ssl = socket_config.ssl;
        var handlers = socket_config.handlers;
        var default_data = socket_config.default_data;

        var protos: ?[]const u8 = null;
        var server_name: ?[]const u8 = null;
        const ssl_enabled = ssl != null;
        defer if (ssl != null) ssl.?.deinit();

        const ctx_opts: uws.us_bun_socket_context_options_t = JSC.API.ServerConfig.SSLConfig.asUSockets(socket_config.ssl);

        globalObject.bunVM().eventLoop().ensureWaker();

        const socket_context = uws.us_create_bun_socket_context(@intFromBool(ssl_enabled), uws.Loop.get(), @sizeOf(usize), ctx_opts) orelse {
            const err = JSC.SystemError{
                .message = bun.String.static("Failed to connect"),
                .syscall = bun.String.static("connect"),
                .code = if (port == null) bun.String.static("ENOENT") else bun.String.static("ECONNREFUSED"),
            };
            exception.* = err.toErrorInstance(globalObject).asObjectRef();
            handlers.unprotect();
            return .zero;
        };

        const connection: Listener.UnixOrHost = blk: {
            if (opts.getTruthy(globalObject, "fd")) |fd_| {
                if (fd_.isNumber()) {
                    const fd = fd_.asFileDescriptor();
                    break :blk .{ .fd = fd };
                }
            }
            if (port) |_| {
                break :blk .{ .host = .{ .host = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch unreachable).slice(), .port = port.? } };
            }
            break :blk .{ .unix = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch unreachable).slice() };
        };

        if (ssl_enabled) {
            if (ssl.?.protos) |p| {
                protos = p[0..ssl.?.protos_len];
            }
            if (ssl.?.server_name) |s| {
                server_name = bun.default_allocator.dupe(u8, s[0..bun.len(s)]) catch unreachable;
            }
            uws.NewSocketHandler(true).configure(
                socket_context,
                true,
                *TLSSocket,
                struct {
                    pub const onOpen = NewSocket(true).onOpen;
                    pub const onClose = NewSocket(true).onClose;
                    pub const onData = NewSocket(true).onData;
                    pub const onWritable = NewSocket(true).onWritable;
                    pub const onTimeout = NewSocket(true).onTimeout;
                    pub const onConnectError = NewSocket(true).onConnectError;
                    pub const onEnd = NewSocket(true).onEnd;
                    pub const onHandshake = NewSocket(true).onHandshake;
                },
            );
        } else {
            uws.NewSocketHandler(false).configure(
                socket_context,
                true,
                *TCPSocket,
                struct {
                    pub const onOpen = NewSocket(false).onOpen;
                    pub const onClose = NewSocket(false).onClose;
                    pub const onData = NewSocket(false).onData;
                    pub const onWritable = NewSocket(false).onWritable;
                    pub const onTimeout = NewSocket(false).onTimeout;
                    pub const onConnectError = NewSocket(false).onConnectError;
                    pub const onEnd = NewSocket(false).onEnd;
                    pub const onHandshake = NewSocket(false).onHandshake;
                },
            );
        }

        default_data.ensureStillAlive();

        var handlers_ptr = handlers.vm.allocator.create(Handlers) catch @panic("OOM");
        handlers_ptr.* = handlers;
        handlers_ptr.is_server = false;

        var promise = JSC.JSPromise.create(globalObject);
        const promise_value = promise.asValue(globalObject);
        handlers_ptr.promise.set(globalObject, promise_value);

        if (ssl_enabled) {
            var tls = handlers.vm.allocator.create(TLSSocket) catch @panic("OOM");

            tls.* = .{
                .handlers = handlers_ptr,
                .this_value = .zero,
                .socket = undefined,
                .connection = connection,
                .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch unreachable) else null,
                .server_name = server_name,
            };

            TLSSocket.dataSetCached(tls.getThisValue(globalObject), globalObject, default_data);

            tls.doConnect(connection, socket_context) catch {
                handlers_ptr.unprotect();
                socket_context.deinit(true);
                handlers.vm.allocator.destroy(handlers_ptr);
                handlers.promise.deinit();
                bun.default_allocator.destroy(tls);
                const err = JSC.SystemError{
                    .message = bun.String.static("Failed to connect"),
                    .syscall = bun.String.static("connect"),
                    .code = if (port == null) bun.String.static("ENOENT") else bun.String.static("ECONNREFUSED"),
                };
                exception.* = err.toErrorInstance(globalObject).asObjectRef();
                return .zero;
            };
            tls.poll_ref.ref(handlers.vm);

            return promise_value;
        } else {
            var tcp = handlers.vm.allocator.create(TCPSocket) catch @panic("OOM");

            tcp.* = .{
                .handlers = handlers_ptr,
                .this_value = .zero,
                .socket = undefined,
                .connection = null,
                .protos = null,
                .server_name = null,
            };

            TCPSocket.dataSetCached(tcp.getThisValue(globalObject), globalObject, default_data);

            tcp.doConnect(connection, socket_context) catch {
                handlers_ptr.unprotect();
                socket_context.deinit(false);
                handlers.vm.allocator.destroy(handlers_ptr);
                handlers.promise.deinit();
                bun.default_allocator.destroy(tcp);
                const err = JSC.SystemError{
                    .message = bun.String.static("Failed to connect"),
                    .syscall = bun.String.static("connect"),
                    .code = if (port == null) bun.String.static("ENOENT") else bun.String.static("ECONNREFUSED"),
                };
                exception.* = err.toErrorInstance(globalObject).asObjectRef();
                return .zero;
            };
            tcp.poll_ref.ref(handlers.vm);

            return promise_value;
        }
    }
};

fn JSSocketType(comptime ssl: bool) type {
    if (!ssl) {
        return JSC.Codegen.JSTCPSocket;
    } else {
        return JSC.Codegen.JSTLSSocket;
    }
}

fn selectALPNCallback(
    _: ?*BoringSSL.SSL,
    out: [*c][*c]const u8,
    outlen: [*c]u8,
    in: [*c]const u8,
    inlen: c_uint,
    arg: ?*anyopaque,
) callconv(.C) c_int {
    const this = bun.cast(*TLSSocket, arg);
    if (this.protos) |protos| {
        if (protos.len == 0) {
            return BoringSSL.SSL_TLSEXT_ERR_NOACK;
        }

        const status = BoringSSL.SSL_select_next_proto(bun.cast([*c][*c]u8, out), outlen, protos.ptr, @as(c_uint, @intCast(protos.len)), in, inlen);

        // Previous versions of Node.js returned SSL_TLSEXT_ERR_NOACK if no protocol
        // match was found. This would neither cause a fatal alert nor would it result
        // in a useful ALPN response as part of the Server Hello message.
        // We now return SSL_TLSEXT_ERR_ALERT_FATAL in that case as per Section 3.2
        // of RFC 7301, which causes a fatal no_application_protocol alert.
        const expected = if (comptime BoringSSL.OPENSSL_NPN_NEGOTIATED == 1) BoringSSL.SSL_TLSEXT_ERR_OK else BoringSSL.SSL_TLSEXT_ERR_ALERT_FATAL;

        return if (status == expected) 1 else 0;
    } else {
        return BoringSSL.SSL_TLSEXT_ERR_NOACK;
    }
}

fn NewSocket(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        socket: Socket,
        detached: bool = false,
        wrapped: WrappedType = .none,
        handlers: *Handlers,
        this_value: JSC.JSValue = .zero,
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
        is_active: bool = false,
        last_4: [4]u8 = .{ 0, 0, 0, 0 },
        authorized: bool = false,
        connection: ?Listener.UnixOrHost = null,
        protos: ?[]const u8,
        owned_protos: bool = true,
        server_name: ?[]const u8 = null,

        // TODO: switch to something that uses `visitAggregate` and have the
        // `Listener` keep a list of all the sockets JSValue in there
        // This is wasteful because it means we are keeping a JSC::Weak for every single open socket
        has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

        const This = @This();
        const log = Output.scoped(.Socket, false);
        const WriteResult = union(enum) {
            fail: void,
            success: struct {
                wrote: i32 = 0,
                total: usize = 0,
            },
        };

        pub usingnamespace if (!ssl)
            JSC.Codegen.JSTCPSocket
        else
            JSC.Codegen.JSTLSSocket;

        pub fn hasPendingActivity(this: *This) callconv(.C) bool {
            @fence(.Acquire);

            return this.has_pending_activity.load(.Acquire);
        }

        pub fn doConnect(this: *This, connection: Listener.UnixOrHost, socket_ctx: *uws.SocketContext) !void {
            switch (connection) {
                .host => |c| {
                    _ = This.Socket.connectPtr(
                        normalizeHost(c.host),
                        c.port,
                        socket_ctx,
                        This,
                        this,
                        "socket",
                    ) orelse return error.ConnectionFailed;
                },
                .unix => |u| {
                    _ = This.Socket.connectUnixPtr(
                        u,
                        socket_ctx,
                        This,
                        this,
                        "socket",
                    ) orelse return error.ConnectionFailed;
                },
                .fd => |f| {
                    const socket = This.Socket.fromFd(socket_ctx, f, This, this, "socket") orelse return error.ConnectionFailed;
                    this.onOpen(socket);
                },
            }
        }

        pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*This {
            globalObject.throw("Cannot construct Socket", .{});
            return null;
        }

        pub fn onWritable(
            this: *This,
            _: Socket,
        ) void {
            JSC.markBinding(@src());
            log("onWritable", .{});
            if (this.detached) return;
            const handlers = this.handlers;
            const callback = handlers.onWritable;
            if (callback == .zero) return;
            var vm = handlers.vm;
            defer vm.drainMicrotasks();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }
        pub fn onTimeout(
            this: *This,
            socket: Socket,
        ) void {
            JSC.markBinding(@src());
            log("onTimeout", .{});
            if (this.detached) return;

            const handlers = this.handlers;
            const callback = handlers.onTimeout;
            if (callback == .zero) return;

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter(socket.context());
            defer scope.exit(ssl, this.wrapped);

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }
        pub fn onConnectError(this: *This, _: Socket, errno: c_int) void {
            JSC.markBinding(@src());
            log("onConnectError({d})", .{errno});
            if (this.detached) return;
            this.detached = true;
            defer this.markInactive();

            const handlers = this.handlers;
            var vm = handlers.vm;
            this.poll_ref.unrefOnNextTick(vm);

            const callback = handlers.onConnectError;
            const globalObject = handlers.globalObject;
            defer vm.drainMicrotasks();
            const err = JSC.SystemError{
                .errno = errno,
                .message = bun.String.static("Failed to connect"),
                .syscall = bun.String.static("connect"),

                // For some reason errno is 0 which causes this to be success.
                // Unix socket case wont hit this callback because it instantly errors.
                .code = bun.String.static("ECONNREFUSED"),
                // .code = bun.String.static(@tagName(bun.sys.getErrno(errno))),
                // .code = bun.String.static(@tagName(@as(bun.C.E, @enumFromInt(errno)))),
            };

            if (callback == .zero) {
                if (handlers.promise.trySwap()) |promise| {
                    // reject the promise on connect() error
                    const err_value = err.toErrorInstance(globalObject);
                    promise.asPromise().?.rejectOnNextTick(globalObject, err_value);
                }

                return;
            }

            const this_value = this.getThisValue(globalObject);
            const err_value = err.toErrorInstance(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
                err_value,
            });

            if (result.toError()) |err_val| {
                if (handlers.rejectPromise(err_val)) return;
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_val });
            } else if (handlers.promise.trySwap()) |val| {
                // They've defined a `connectError` callback
                // The error is effectively handled, but we should still reject the promise.
                var promise = val.asPromise().?;
                const err_ = err.toErrorInstance(globalObject);
                promise.rejectOnNextTickAsHandled(globalObject, err_);
                this.has_pending_activity.store(false, .Release);
            }
        }

        pub fn markActive(this: *This) void {
            if (!this.is_active) {
                this.handlers.markActive();
                this.is_active = true;
                this.has_pending_activity.store(true, .Release);
            }
        }

        pub fn markInactive(this: *This) void {
            if (this.is_active) {
                if (!this.detached) {
                    // we have to close the socket before the socket context is closed
                    // otherwise we will get a segfault
                    // uSockets will defer closing the TCP socket until the next tick
                    if (!this.socket.isClosed()) {
                        this.detached = true;
                        this.socket.close(0, null);
                        // onClose will call markInactive again
                        return;
                    }
                }
                this.is_active = false;
                const vm = this.handlers.vm;

                this.handlers.markInactive(ssl, this.socket.context(), this.wrapped);
                this.poll_ref.unref(vm);
                this.has_pending_activity.store(false, .Release);
            }
        }

        pub fn onOpen(this: *This, socket: Socket) void {
            JSC.markBinding(@src());
            log("onOpen ssl: {}", .{comptime ssl});

            // Add SNI support for TLS (mongodb and others requires this)
            if (comptime ssl) {
                var ssl_ptr = this.socket.ssl();

                if (!ssl_ptr.isInitFinished()) {
                    if (this.server_name) |server_name| {
                        const host = normalizeHost(server_name);
                        if (host.len > 0) {
                            const host__ = default_allocator.dupeZ(u8, host) catch unreachable;
                            defer default_allocator.free(host__);
                            ssl_ptr.setHostname(host__);
                        }
                    } else if (this.connection) |connection| {
                        if (connection == .host) {
                            const host = normalizeHost(connection.host.host);
                            if (host.len > 0) {
                                const host__ = default_allocator.dupeZ(u8, host) catch unreachable;
                                defer default_allocator.free(host__);
                                ssl_ptr.setHostname(host__);
                            }
                        }
                    }
                    if (this.protos) |protos| {
                        if (this.handlers.is_server) {
                            BoringSSL.SSL_CTX_set_alpn_select_cb(BoringSSL.SSL_get_SSL_CTX(ssl_ptr), selectALPNCallback, bun.cast(*anyopaque, this));
                        } else {
                            _ = BoringSSL.SSL_set_alpn_protos(ssl_ptr, protos.ptr, @as(c_uint, @intCast(protos.len)));
                        }
                    }
                }
            }

            this.detached = false;
            this.socket = socket;

            if (this.wrapped == .none) {
                socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, this);
            }

            const handlers = this.handlers;
            const callback = handlers.onOpen;
            const handshake_callback = handlers.onHandshake;

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);

            this.markActive();
            handlers.resolvePromise(this_value);

            if (comptime ssl) {
                // only calls open callback if handshake callback is provided
                // If handshake is provided, open is called on connection open
                // If is not provided, open is called after handshake
                if (callback == .zero or handshake_callback == .zero) return;
            } else {
                if (callback == .zero) return;
            }
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (result.toError()) |err| {
                this.detached = true;
                defer this.markInactive();
                if (!this.socket.isClosed()) {
                    log("Closing due to error", .{});
                } else {
                    log("Already closed", .{});
                }

                if (handlers.rejectPromise(err)) return;
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err });
            }
        }

        pub fn getThisValue(this: *This, globalObject: *JSC.JSGlobalObject) JSValue {
            if (this.this_value == .zero) {
                const value = this.toJS(globalObject);
                value.ensureStillAlive();
                this.this_value = value;
                return value;
            }

            return this.this_value;
        }

        pub fn onEnd(this: *This, socket: Socket) void {
            JSC.markBinding(@src());
            log("onEnd", .{});
            if (this.detached) return;

            const handlers = this.handlers;

            const callback = handlers.onEnd;
            if (callback == .zero) {
                this.poll_ref.unref(handlers.vm);

                // If you don't handle TCP fin, we assume you're done.
                this.markInactive();
                return;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter(socket.context());
            defer scope.exit(ssl, this.wrapped);

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }

        pub fn onHandshake(this: *This, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            log("onHandshake({d})", .{success});
            JSC.markBinding(@src());
            if (this.detached) return;

            const authorized = if (success == 1) true else false;

            this.authorized = authorized;

            const handlers = this.handlers;
            var callback = handlers.onHandshake;
            var is_open = false;

            // Use open callback when handshake is not provided
            if (callback == .zero) {
                callback = handlers.onOpen;
                if (callback == .zero) {
                    return;
                }
                is_open = true;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter(socket.context());
            defer scope.exit(ssl, this.wrapped);

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);

            var result: JSC.JSValue = JSC.JSValue.zero;
            // open callback only have 1 parameters and its the socket
            // you should use getAuthorizationError and authorized getter to get those values in this case
            if (is_open) {
                result = callback.callWithThis(globalObject, this_value, &[_]JSValue{this_value});
            } else {
                // call handhsake callback with authorized and authorization error if has one
                var authorization_error: JSValue = undefined;
                if (ssl_error.error_no == 0) {
                    authorization_error = JSValue.jsNull();
                } else {
                    const code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code)];

                    const reason = if (ssl_error.reason == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason)];

                    const fallback = JSC.SystemError{
                        .code = bun.String.createUTF8(code),
                        .message = bun.String.createUTF8(reason),
                    };

                    authorization_error = fallback.toErrorInstance(globalObject);
                }
                result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                    this_value,
                    JSValue.jsBoolean(authorized),
                    authorization_error,
                });
            }

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }

        pub fn onClose(this: *This, socket: Socket, err: c_int, _: ?*anyopaque) void {
            JSC.markBinding(@src());
            log("onClose", .{});
            this.detached = true;
            defer this.markInactive();

            const handlers = this.handlers;
            this.poll_ref.unref(handlers.vm);

            const callback = handlers.onClose;
            if (callback == .zero)
                return;

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter(socket.context());
            defer scope.exit(ssl, this.wrapped);

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
                JSValue.jsNumber(@as(i32, err)),
            });

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }

        pub fn onData(this: *This, socket: Socket, data: []const u8) void {
            JSC.markBinding(@src());
            log("onData({d})", .{data.len});
            if (this.detached) return;

            const handlers = this.handlers;
            const callback = handlers.onData;
            if (callback == .zero) return;

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const output_value = handlers.binary_type.toJS(data, globalObject);

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter(socket.context());
            defer scope.exit(ssl, this.wrapped);

            // const encoding = handlers.encoding;
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
                output_value,
            });

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, err_value });
            }
        }

        pub fn getData(
            _: *This,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            log("getData()", .{});
            return JSValue.jsUndefined();
        }

        pub fn setData(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            value: JSC.JSValue,
        ) callconv(.C) bool {
            log("setData()", .{});
            This.dataSetCached(this.this_value, globalObject, value);
            return true;
        }

        pub fn getListener(
            this: *This,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            if (!this.handlers.is_server or this.detached) {
                return JSValue.jsUndefined();
            }

            return @fieldParentPtr(Listener, "handlers", this.handlers).strong_self.get() orelse JSValue.jsUndefined();
        }

        pub fn getReadyState(
            this: *This,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            log("getReadyState()", .{});

            if (this.detached) {
                return JSValue.jsNumber(@as(i32, -1));
            } else if (this.socket.isClosed()) {
                return JSValue.jsNumber(@as(i32, 0));
            } else if (this.socket.isEstablished()) {
                return JSValue.jsNumber(@as(i32, 1));
            } else if (this.socket.isShutdown()) {
                return JSValue.jsNumber(@as(i32, -2));
            } else {
                return JSValue.jsNumber(@as(i32, 2));
            }
        }

        pub fn getAuthorized(
            this: *This,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            log("getAuthorized()", .{});
            return JSValue.jsBoolean(this.authorized);
        }
        pub fn timeout(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments(1);
            if (this.detached) return JSValue.jsUndefined();
            if (args.len == 0) {
                globalObject.throw("Expected 1 argument, got 0", .{});
                return .zero;
            }
            const t = args.ptr[0].coerce(i32, globalObject);
            if (t < 0) {
                globalObject.throw("Timeout must be a positive integer", .{});
                return .zero;
            }

            this.socket.setTimeout(@as(c_uint, @intCast(t)));

            return JSValue.jsUndefined();
        }

        pub fn getAuthorizationError(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());

            if (this.detached) {
                return JSValue.jsNull();
            }

            // this error can change if called in different stages of hanshake
            // is very usefull to have this feature depending on the user workflow
            const ssl_error = this.socket.verifyError();
            if (ssl_error.error_no == 0) {
                return JSValue.jsNull();
            }

            const code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code)];

            const reason = if (ssl_error.reason == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason)];

            const fallback = JSC.SystemError{
                .code = bun.String.createUTF8(code),
                .message = bun.String.createUTF8(reason),
            };

            return fallback.toErrorInstance(globalObject);
        }

        pub fn write(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());

            if (this.detached) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            const args = callframe.arguments(4);

            if (args.len == 0) {
                globalObject.throw("Expected 1 - 4 arguments, got 0", .{});
                return .zero;
            }

            return switch (this.writeOrEnd(globalObject, args.ptr[0..args.len], false)) {
                .fail => .zero,
                .success => |result| JSValue.jsNumber(result.wrote),
            };
        }

        pub fn getLocalPort(
            this: *This,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            if (this.detached) {
                return JSValue.jsUndefined();
            }

            return JSValue.jsNumber(this.socket.localPort());
        }

        pub fn getRemoteAddress(
            this: *This,
            globalThis: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            if (this.detached) {
                return JSValue.jsUndefined();
            }

            var buf: [64]u8 = [_]u8{0} ** 64;
            var length: i32 = 64;
            var text_buf: [512]u8 = undefined;

            this.socket.remoteAddress(&buf, &length);
            const address_bytes = buf[0..@as(usize, @intCast(length))];
            const address: std.net.Address = switch (length) {
                4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
                16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
                else => return JSValue.jsUndefined(),
            };

            const text = bun.fmt.formatIp(address, &text_buf) catch unreachable;
            return ZigString.init(text).toValueGC(globalThis);
        }

        fn writeMaybeCorked(this: *This, buffer: []const u8, is_end: bool) i32 {
            if (this.detached or this.socket.isShutdown() or this.socket.isClosed()) {
                return -1;
            }
            // we don't cork yet but we might later

            if (comptime ssl) {
                // TLS wrapped but in TCP mode
                if (this.wrapped == .tcp) {
                    const res = this.socket.rawWrite(buffer, is_end);
                    log("write({d}, {any}) = {d}", .{ buffer.len, is_end, res });
                    return res;
                }
            }

            const res = this.socket.write(buffer, is_end);
            log("write({d}, {any}) = {d}", .{ buffer.len, is_end, res });
            return res;
        }

        fn writeOrEnd(this: *This, globalObject: *JSC.JSGlobalObject, args: []const JSC.JSValue, is_end: bool) WriteResult {
            if (args.len == 0) return .{ .success = .{} };
            if (args.ptr[0].asArrayBuffer(globalObject)) |array_buffer| {
                var slice = array_buffer.slice();

                if (args.len > 1) {
                    if (!args.ptr[1].isAnyInt()) {
                        globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                        return .{ .fail = {} };
                    }

                    const offset = @min(args.ptr[1].toUInt64NoTruncate(), slice.len);
                    slice = slice[offset..];

                    if (args.len > 2) {
                        if (!args.ptr[2].isAnyInt()) {
                            globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                            return .{ .fail = {} };
                        }

                        const length = @min(args.ptr[2].toUInt64NoTruncate(), slice.len);
                        slice = slice[0..length];
                    }
                }

                // sending empty can be used to ensure that we'll cycle through internal openssl's state
                if (comptime ssl == false) {
                    if (slice.len == 0) return .{ .success = .{} };
                }

                return .{
                    .success = .{
                        .wrote = this.writeMaybeCorked(slice, is_end),
                        .total = slice.len,
                    },
                };
            } else if (args.ptr[0].jsType() == .DOMWrapper) {
                const blob: JSC.WebCore.AnyBlob = getter: {
                    if (args.ptr[0].as(JSC.WebCore.Blob)) |blob| {
                        break :getter JSC.WebCore.AnyBlob{ .Blob = blob.* };
                    } else if (args.ptr[0].as(JSC.WebCore.Response)) |response| {
                        response.body.value.toBlobIfPossible();

                        if (response.body.value.tryUseAsAnyBlob()) |blob| {
                            break :getter blob;
                        }

                        globalObject.throw("Only Blob/buffered bodies are supported for now", .{});
                        return .{ .fail = {} };
                    } else if (args.ptr[0].as(JSC.WebCore.Request)) |request| {
                        request.body.value.toBlobIfPossible();
                        if (request.body.value.tryUseAsAnyBlob()) |blob| {
                            break :getter blob;
                        }

                        globalObject.throw("Only Blob/buffered bodies are supported for now", .{});
                        return .{ .fail = {} };
                    }

                    globalObject.throw("Expected Blob, Request or Response", .{});
                    return .{ .fail = {} };
                };

                if (!blob.needsToReadFile()) {
                    var slice = blob.slice();

                    if (args.len > 1) {
                        if (!args.ptr[1].isAnyInt()) {
                            globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                            return .{ .fail = {} };
                        }

                        const offset = @min(args.ptr[1].toUInt64NoTruncate(), slice.len);
                        slice = slice[offset..];

                        if (args.len > 2) {
                            if (!args.ptr[2].isAnyInt()) {
                                globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                                return .{ .fail = {} };
                            }

                            const length = @min(args.ptr[2].toUInt64NoTruncate(), slice.len);
                            slice = slice[0..length];
                        }
                    }

                    // sending empty can be used to ensure that we'll cycle through internal openssl's state
                    if (comptime ssl == false) {
                        if (slice.len == 0) return .{ .success = .{} };
                    }

                    return .{
                        .success = .{
                            .wrote = this.writeMaybeCorked(slice, is_end),
                            .total = slice.len,
                        },
                    };
                }

                globalObject.throw("sendfile() not implemented yet", .{});
                return .{ .fail = {} };
            } else if (bun.String.tryFromJS(args.ptr[0], globalObject)) |bun_str| {
                defer bun_str.deref();
                var zig_str = bun_str.toUTF8WithoutRef(bun.default_allocator);
                defer zig_str.deinit();

                var slice = zig_str.slice();

                if (args.len > 1) {
                    if (!args.ptr[1].isAnyInt()) {
                        globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                        return .{ .fail = {} };
                    }

                    const offset = @min(args.ptr[1].toUInt64NoTruncate(), slice.len);
                    slice = slice[offset..];

                    if (args.len > 2) {
                        if (!args.ptr[2].isAnyInt()) {
                            globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                            return .{ .fail = {} };
                        }

                        const length = @min(args.ptr[2].toUInt64NoTruncate(), slice.len);
                        slice = slice[0..length];
                    }
                }

                // sending empty can be used to ensure that we'll cycle through internal openssl's state
                if (comptime ssl == false) {
                    if (slice.len == 0) return .{ .success = .{} };
                }

                return .{
                    .success = .{
                        .wrote = this.writeMaybeCorked(slice, is_end),
                        .total = slice.len,
                    },
                };
            } else {
                globalObject.throw("Expected ArrayBufferView, a string, or a Blob", .{});
                return .{ .fail = {} };
            }
        }

        pub fn flush(
            this: *This,
            _: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (!this.detached)
                this.socket.flush();

            return JSValue.jsUndefined();
        }

        pub fn shutdown(
            this: *This,
            _: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            const args = callframe.arguments(1);
            if (!this.detached) {
                if (args.len > 0 and args.ptr[0].toBoolean()) {
                    this.socket.shutdownRead();
                } else {
                    this.socket.shutdown();
                }
            }

            return JSValue.jsUndefined();
        }

        pub fn end(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());

            const args = callframe.arguments(4);

            log("end({d} args)", .{args.len});

            if (this.detached) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            return switch (this.writeOrEnd(globalObject, args.ptr[0..args.len], true)) {
                .fail => .zero,
                .success => |result| brk: {
                    if (result.wrote == result.total) {
                        this.socket.flush();
                        // markInactive does .detached = true
                        this.markInactive();
                    }
                    break :brk JSValue.jsNumber(result.wrote);
                },
            };
        }

        pub fn ref(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (this.detached) return JSValue.jsUndefined();
            this.poll_ref.ref(globalObject.bunVM());
            return JSValue.jsUndefined();
        }

        pub fn unref(this: *This, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
            JSC.markBinding(@src());
            this.poll_ref.unref(globalObject.bunVM());
            return JSValue.jsUndefined();
        }

        pub fn finalize(this: *This) callconv(.C) void {
            log("finalize() {d}", .{@intFromPtr(this)});
            if (!this.detached) {
                this.detached = true;
                if (!this.socket.isClosed()) {
                    this.socket.close(0, null);
                }
            }

            this.markInactive();

            this.poll_ref.unref(JSC.VirtualMachine.get());
            // need to deinit event without being attached
            if (this.owned_protos) {
                if (this.protos) |protos| {
                    this.protos = null;
                    default_allocator.free(protos);
                }
            }

            if (this.server_name) |server_name| {
                this.server_name = null;
                default_allocator.free(server_name);
            }

            if (this.connection) |connection| {
                this.connection = null;
                connection.deinit();
            }
        }

        pub fn reload(this: *This, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const args = callframe.arguments(1);

            if (args.len < 1) {
                globalObject.throw("Expected 1 argument", .{});
                return .zero;
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const opts = args.ptr[0];
            if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
                globalObject.throw("Expected options object", .{});
                return .zero;
            }

            var exception: JSC.C.JSValueRef = null;

            const socket_obj = opts.get(globalObject, "socket") orelse {
                globalObject.throw("Expected \"socket\" option", .{});
                return .zero;
            };

            const handlers = Handlers.fromJS(globalObject, socket_obj, &exception) orelse {
                globalObject.throwValue(exception.?.value());
                return .zero;
            };

            var prev_handlers = this.handlers;
            prev_handlers.unprotect();
            this.handlers.* = handlers; // TODO: this is a memory leak
            this.handlers.protect();

            return JSValue.jsUndefined();
        }

        pub fn getTLSTicket(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const ssl_ptr = this.socket.ssl();
            const session = BoringSSL.SSL_get_session(ssl_ptr) orelse return JSValue.jsUndefined();
            var ticket: [*c]const u8 = undefined;
            var length: usize = 0;
            //The pointer is only valid while the connection is in use so we need to copy it
            BoringSSL.SSL_SESSION_get0_ticket(session, @as([*c][*c]const u8, @ptrCast(&ticket)), &length);

            if (ticket == null or length == 0) {
                return JSValue.jsUndefined();
            }

            return JSC.ArrayBuffer.createBuffer(globalObject, ticket[0..length]);
        }

        pub fn setSession(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const args = callframe.arguments(1);

            if (args.len < 1) {
                globalObject.throw("Expected session to be a string, Buffer or TypedArray", .{});
                return .zero;
            }

            const session_arg = args.ptr[0];
            var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();

            var exception_ref = [_]JSC.C.JSValueRef{null};
            const exception: JSC.C.ExceptionRef = &exception_ref;
            if (JSC.Node.StringOrBuffer.fromJS(globalObject, arena.allocator(), session_arg)) |sb| {
                defer sb.deinit();
                const session_slice = sb.slice();
                const ssl_ptr = this.socket.ssl();
                var tmp = @as([*c]const u8, @ptrCast(session_slice.ptr));
                const session = BoringSSL.d2i_SSL_SESSION(null, &tmp, @as(c_long, @intCast(session_slice.len))) orelse return JSValue.jsUndefined();
                if (BoringSSL.SSL_set_session(ssl_ptr, session) != 1) {
                    globalObject.throwValue(getSSLException(globalObject, "SSL_set_session error"));
                    return .zero;
                }
                return JSValue.jsUndefined();
            } else if (exception.* != null) {
                globalObject.throwValue(JSC.JSValue.c(exception.*));
                return .zero;
            } else {
                globalObject.throw("Expected session to be a string, Buffer or TypedArray", .{});
                return .zero;
            }
        }

        pub fn getSession(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const ssl_ptr = this.socket.ssl();
            const session = BoringSSL.SSL_get_session(ssl_ptr) orelse return JSValue.jsUndefined();
            const size = BoringSSL.i2d_SSL_SESSION(session, null);
            if (size <= 0) {
                return JSValue.jsUndefined();
            }

            const buffer_size = @as(usize, @intCast(size));
            var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
            var buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

            const result_size = BoringSSL.i2d_SSL_SESSION(session, &buffer_ptr);
            std.debug.assert(result_size == size);
            return buffer;
        }

        pub fn getALPNProtocol(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsBoolean(false);
            }

            if (this.detached) {
                return JSValue.jsBoolean(false);
            }

            var alpn_proto: [*c]const u8 = null;
            var alpn_proto_len: u32 = 0;

            const ssl_ptr = this.socket.ssl();

            BoringSSL.SSL_get0_alpn_selected(ssl_ptr, &alpn_proto, &alpn_proto_len);
            if (alpn_proto == null or alpn_proto_len == 0) {
                return JSValue.jsBoolean(false);
            }

            const slice = alpn_proto[0..alpn_proto_len];
            if (strings.eql(slice, "h2")) {
                return ZigString.static("h2").toValue(globalObject);
            }
            if (strings.eql(slice, "http/1.1")) {
                return ZigString.static("http/1.1").toValue(globalObject);
            }
            return ZigString.fromUTF8(slice).toValueGC(globalObject);
        }
        pub fn exportKeyingMaterial(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const args = callframe.arguments(3);
            if (args.len < 2) {
                globalObject.throw("Expected length and label to be provided", .{});
                return .zero;
            }
            const length_arg = args.ptr[0];
            if (!length_arg.isNumber()) {
                globalObject.throw("Expected length to be a number", .{});
                return .zero;
            }

            const length = length_arg.coerceToInt64(globalObject);
            if (length < 0) {
                globalObject.throw("Expected length to be a positive number", .{});
                return .zero;
            }

            const label_arg = args.ptr[1];
            if (!label_arg.isString()) {
                globalObject.throw("Expected label to be a string", .{});
                return .zero;
            }

            var label = label_arg.toSliceOrNull(globalObject) orelse {
                globalObject.throw("Expected label to be a string", .{});
                return .zero;
            };

            defer label.deinit();
            const label_slice = label.slice();
            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));

            if (args.len > 2) {
                const context_arg = args.ptr[2];

                var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
                defer arena.deinit();

                var exception_ref = [_]JSC.C.JSValueRef{null};
                const exception: JSC.C.ExceptionRef = &exception_ref;
                if (JSC.Node.StringOrBuffer.fromJS(globalObject, arena.allocator(), context_arg)) |sb| {
                    defer sb.deinit();
                    const context_slice = sb.slice();

                    const buffer_size = @as(usize, @intCast(length));
                    var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
                    const buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

                    const result = BoringSSL.SSL_export_keying_material(ssl_ptr, buffer_ptr, buffer_size, @as([*c]const u8, @ptrCast(label_slice.ptr)), label_slice.len, @as([*c]const u8, @ptrCast(context_slice.ptr)), context_slice.len, 1);
                    if (result != 1) {
                        globalObject.throwValue(getSSLException(globalObject, "Failed to export keying material"));
                        return .zero;
                    }
                    return buffer;
                } else if (exception.* != null) {
                    globalObject.throwValue(JSC.JSValue.c(exception.*));
                    return .zero;
                } else {
                    globalObject.throw("Expected context to be a string, Buffer or TypedArray", .{});
                    return .zero;
                }
            } else {
                const buffer_size = @as(usize, @intCast(length));
                var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
                const buffer_ptr = @as([*c]u8, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

                const result = BoringSSL.SSL_export_keying_material(ssl_ptr, buffer_ptr, buffer_size, @as([*c]const u8, @ptrCast(label_slice.ptr)), label_slice.len, null, 0, 0);
                if (result != 1) {
                    globalObject.throwValue(getSSLException(globalObject, "Failed to export keying material"));
                    return .zero;
                }
                return buffer;
            }
        }

        pub fn getEphemeralKeyInfo(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsNull();
            }

            if (this.detached) {
                return JSValue.jsNull();
            }

            // only available for clients
            if (this.handlers.is_server) {
                return JSValue.jsNull();
            }
            var result = JSValue.createEmptyObject(globalObject, 3);

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            // TODO: investigate better option or compatible way to get the key
            // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
            // wich will result in a empty object
            // var raw_key: [*c]BoringSSL.EVP_PKEY = undefined;
            // if (BoringSSL.SSL_get_server_tmp_key(ssl_ptr, @ptrCast([*c][*c]BoringSSL.EVP_PKEY, &raw_key)) == 0) {
            //     return result;
            // }
            const raw_key: [*c]BoringSSL.EVP_PKEY = BoringSSL.SSL_get_privatekey(ssl_ptr);
            if (raw_key == null) {
                return result;
            }

            const kid = BoringSSL.EVP_PKEY_id(raw_key);
            const bits = BoringSSL.EVP_PKEY_bits(raw_key);

            switch (kid) {
                BoringSSL.EVP_PKEY_DH => {
                    result.put(globalObject, ZigString.static("type"), ZigString.static("DH").toValue(globalObject));
                    result.put(globalObject, ZigString.static("size"), JSValue.jsNumber(bits));
                },

                BoringSSL.EVP_PKEY_EC, BoringSSL.EVP_PKEY_X25519, BoringSSL.EVP_PKEY_X448 => {
                    var curve_name: []const u8 = undefined;
                    if (kid == BoringSSL.EVP_PKEY_EC) {
                        const ec = BoringSSL.EVP_PKEY_get1_EC_KEY(raw_key);
                        const nid = BoringSSL.EC_GROUP_get_curve_name(BoringSSL.EC_KEY_get0_group(ec));
                        const nid_str = BoringSSL.OBJ_nid2sn(nid);
                        if (nid_str != null) {
                            curve_name = nid_str[0..bun.len(nid_str)];
                        } else {
                            curve_name = "";
                        }
                    } else {
                        const kid_str = BoringSSL.OBJ_nid2sn(kid);
                        if (kid_str != null) {
                            curve_name = kid_str[0..bun.len(kid_str)];
                        } else {
                            curve_name = "";
                        }
                    }
                    result.put(globalObject, ZigString.static("type"), ZigString.static("ECDH").toValue(globalObject));
                    result.put(globalObject, ZigString.static("name"), ZigString.fromUTF8(curve_name).toValueGC(globalObject));
                    result.put(globalObject, ZigString.static("size"), JSValue.jsNumber(bits));
                },
                else => {},
            }
            return result;
        }

        pub fn getCipher(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }
            var result = JSValue.createEmptyObject(globalObject, 3);

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            const cipher = BoringSSL.SSL_get_current_cipher(ssl_ptr);
            if (cipher == null) {
                result.put(globalObject, ZigString.static("name"), JSValue.jsNull());
                result.put(globalObject, ZigString.static("standardName"), JSValue.jsNull());
                result.put(globalObject, ZigString.static("version"), JSValue.jsNull());
                return result;
            }

            const name = BoringSSL.SSL_CIPHER_get_name(cipher);
            if (name == null) {
                result.put(globalObject, ZigString.static("name"), JSValue.jsNull());
            } else {
                result.put(globalObject, ZigString.static("name"), ZigString.fromUTF8(name[0..bun.len(name)]).toValueGC(globalObject));
            }

            const standard_name = BoringSSL.SSL_CIPHER_standard_name(cipher);
            if (standard_name == null) {
                result.put(globalObject, ZigString.static("standardName"), JSValue.jsNull());
            } else {
                result.put(globalObject, ZigString.static("standardName"), ZigString.fromUTF8(standard_name[0..bun.len(standard_name)]).toValueGC(globalObject));
            }

            const version = BoringSSL.SSL_CIPHER_get_version(cipher);
            if (version == null) {
                result.put(globalObject, ZigString.static("version"), JSValue.jsNull());
            } else {
                result.put(globalObject, ZigString.static("version"), ZigString.fromUTF8(version[0..bun.len(version)]).toValueGC(globalObject));
            }

            return result;
        }

        pub fn getTLSPeerFinishedMessage(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            // We cannot just pass nullptr to SSL_get_peer_finished()
            // because it would further be propagated to memcpy(),
            // where the standard requirements as described in ISO/IEC 9899:2011
            // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
            // Thus, we use a dummy byte.
            var dummy: [1]u8 = undefined;
            const size = BoringSSL.SSL_get_peer_finished(ssl_ptr, @as(*anyopaque, @ptrCast(&dummy)), @sizeOf(@TypeOf(dummy)));
            if (size == 0) return JSValue.jsUndefined();

            const buffer_size = @as(usize, @intCast(size));
            var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
            const buffer_ptr = @as(*anyopaque, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

            const result_size = BoringSSL.SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size);
            std.debug.assert(result_size == size);
            return buffer;
        }

        pub fn getTLSFinishedMessage(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            // We cannot just pass nullptr to SSL_get_finished()
            // because it would further be propagated to memcpy(),
            // where the standard requirements as described in ISO/IEC 9899:2011
            // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
            // Thus, we use a dummy byte.
            var dummy: [1]u8 = undefined;
            const size = BoringSSL.SSL_get_finished(ssl_ptr, @as(*anyopaque, @ptrCast(&dummy)), @sizeOf(@TypeOf(dummy)));
            if (size == 0) return JSValue.jsUndefined();

            const buffer_size = @as(usize, @intCast(size));
            var buffer = JSValue.createBufferFromLength(globalObject, buffer_size);
            const buffer_ptr = @as(*anyopaque, @ptrCast(buffer.asArrayBuffer(globalObject).?.ptr));

            const result_size = BoringSSL.SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size);
            std.debug.assert(result_size == size);
            return buffer;
        }

        pub fn getSharedSigalgs(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (comptime ssl == false) {
                return JSValue.jsNull();
            }

            if (this.detached) {
                return JSValue.jsNull();
            }
            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));

            const nsig = BoringSSL.SSL_get_shared_sigalgs(ssl_ptr, 0, null, null, null, null, null);

            const array = JSC.JSValue.createEmptyArray(globalObject, @as(usize, @intCast(nsig)));

            for (0..@as(usize, @intCast(nsig))) |i| {
                var hash_nid: c_int = 0;
                var sign_nid: c_int = 0;
                var sig_with_md: []const u8 = "";

                _ = BoringSSL.SSL_get_shared_sigalgs(ssl_ptr, @as(c_int, @intCast(i)), &sign_nid, &hash_nid, null, null, null);
                switch (sign_nid) {
                    BoringSSL.EVP_PKEY_RSA => {
                        sig_with_md = "RSA";
                    },
                    BoringSSL.EVP_PKEY_RSA_PSS => {
                        sig_with_md = "RSA-PSS";
                    },

                    BoringSSL.EVP_PKEY_DSA => {
                        sig_with_md = "DSA";
                    },

                    BoringSSL.EVP_PKEY_EC => {
                        sig_with_md = "ECDSA";
                    },

                    BoringSSL.NID_ED25519 => {
                        sig_with_md = "Ed25519";
                    },

                    BoringSSL.NID_ED448 => {
                        sig_with_md = "Ed448";
                    },
                    BoringSSL.NID_id_GostR3410_2001 => {
                        sig_with_md = "gost2001";
                    },

                    BoringSSL.NID_id_GostR3410_2012_256 => {
                        sig_with_md = "gost2012_256";
                    },
                    BoringSSL.NID_id_GostR3410_2012_512 => {
                        sig_with_md = "gost2012_512";
                    },
                    else => {
                        const sn_str = BoringSSL.OBJ_nid2sn(sign_nid);
                        if (sn_str != null) {
                            sig_with_md = sn_str[0..bun.len(sn_str)];
                        } else {
                            sig_with_md = "UNDEF";
                        }
                    },
                }

                const hash_str = BoringSSL.OBJ_nid2sn(hash_nid);
                if (hash_str != null) {
                    const hash_str_len = bun.len(hash_str);
                    const hash_slice = hash_str[0..hash_str_len];
                    const buffer = bun.default_allocator.alloc(u8, sig_with_md.len + hash_str_len + 1) catch unreachable;
                    defer bun.default_allocator.free(buffer);

                    bun.copy(u8, buffer, sig_with_md);
                    buffer[sig_with_md.len] = '+';
                    bun.copy(u8, buffer[sig_with_md.len + 1 ..], hash_slice);
                    array.putIndex(globalObject, @as(u32, @intCast(i)), JSC.ZigString.fromUTF8(buffer).toValueGC(globalObject));
                } else {
                    const buffer = bun.default_allocator.alloc(u8, sig_with_md.len + 6) catch unreachable;
                    defer bun.default_allocator.free(buffer);

                    bun.copy(u8, buffer, sig_with_md);
                    bun.copy(u8, buffer[sig_with_md.len..], "+UNDEF");
                    array.putIndex(globalObject, @as(u32, @intCast(i)), JSC.ZigString.fromUTF8(buffer).toValueGC(globalObject));
                }
            }
            return array;
        }

        pub fn getTLSVersion(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (comptime ssl == false) {
                return JSValue.jsNull();
            }

            if (this.detached) {
                return JSValue.jsNull();
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            const version = BoringSSL.SSL_get_version(ssl_ptr);
            if (version == null) return JSValue.jsNull();
            const version_len = bun.len(version);
            if (version_len == 0) return JSValue.jsNull();
            const slice = version[0..version_len];
            return ZigString.fromUTF8(slice).toValueGC(globalObject);
        }

        pub fn setMaxSendFragment(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (comptime ssl == false) {
                return JSValue.jsBoolean(false);
            }

            if (this.detached) {
                return JSValue.jsBoolean(false);
            }

            const args = callframe.arguments(1);

            if (args.len < 1) {
                globalObject.throw("Expected size to be a number", .{});
                return .zero;
            }

            const arg = args.ptr[0];
            if (!arg.isNumber()) {
                globalObject.throw("Expected size to be a number", .{});
                return .zero;
            }
            const size = args.ptr[0].coerceToInt64(globalObject);
            if (size < 1) {
                globalObject.throw("Expected size to be greater than 1", .{});
                return .zero;
            }
            if (size > 16384) {
                globalObject.throw("Expected size to be less than 16385", .{});
                return .zero;
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            return JSValue.jsBoolean(BoringSSL.SSL_set_max_send_fragment(ssl_ptr, @as(usize, @intCast(size))) == 1);
        }
        pub fn getPeerCertificate(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const args = callframe.arguments(1);
            var abbreviated: bool = true;
            if (args.len > 0) {
                const arg = args.ptr[0];
                if (!arg.isBoolean()) {
                    globalObject.throw("Expected abbreviated to be a boolean", .{});
                    return .zero;
                }
                abbreviated = arg.toBoolean();
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));

            if (abbreviated) {
                if (this.handlers.is_server) {
                    const cert = BoringSSL.SSL_get_peer_certificate(ssl_ptr);
                    if (cert) |x509| {
                        return X509.toJS(x509, globalObject);
                    }
                }

                const cert_chain = BoringSSL.SSL_get_peer_cert_chain(ssl_ptr) orelse return JSValue.jsUndefined();
                const cert = BoringSSL.sk_X509_value(cert_chain, 0) orelse return JSValue.jsUndefined();
                return X509.toJS(cert, globalObject);
            }
            var cert: ?*BoringSSL.X509 = null;
            if (this.handlers.is_server) {
                cert = BoringSSL.SSL_get_peer_certificate(ssl_ptr);
            }

            const cert_chain = BoringSSL.SSL_get_peer_cert_chain(ssl_ptr);
            const first_cert = if (cert) |c| c else if (cert_chain) |cc| BoringSSL.sk_X509_value(cc, 0) else null;

            if (first_cert == null) {
                return JSValue.jsUndefined();
            }

            // TODO: we need to support the non abbreviated version of this
            return JSValue.jsUndefined();
        }

        pub fn getCertificate(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            const cert = BoringSSL.SSL_get_certificate(ssl_ptr);

            if (cert) |x509| {
                return X509.toJS(x509, globalObject);
            }
            return JSValue.jsUndefined();
        }
        pub fn setServername(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            if (comptime ssl == false) {
                return JSValue.jsUndefined();
            }

            if (this.handlers.is_server) {
                globalObject.throw("Cannot issue SNI from a TLS server-side socket", .{});
                return .zero;
            }

            const args = callframe.arguments(1);
            if (args.len < 1) {
                globalObject.throw("Expected 1 argument", .{});
                return .zero;
            }

            const server_name = args.ptr[0];
            if (!server_name.isString()) {
                globalObject.throw("Expected \"serverName\" to be a string", .{});
                return .zero;
            }

            const slice = server_name.getZigString(globalObject).toOwnedSlice(bun.default_allocator) catch unreachable;
            if (this.server_name) |old| {
                this.server_name = slice;
                default_allocator.free(old);
            } else {
                this.server_name = slice;
            }

            if (this.detached) {
                // will be attached onOpen
                return JSValue.jsUndefined();
            }

            const host = normalizeHost(@as([]const u8, slice));
            if (host.len > 0) {
                var ssl_ptr = this.socket.ssl();

                if (ssl_ptr.isInitFinished()) {
                    // match node.js exceptions
                    globalObject.throw("Already started.", .{});
                    return .zero;
                }
                const host__ = default_allocator.dupeZ(u8, host) catch unreachable;
                defer default_allocator.free(host__);
                ssl_ptr.setHostname(host__);
            }

            return JSValue.jsUndefined();
        }

        // this invalidates the current socket returning 2 new sockets
        // one for non-TLS and another for TLS
        // handlers for non-TLS are preserved
        pub fn upgradeTLS(
            this: *This,
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSValue {
            JSC.markBinding(@src());
            if (comptime ssl) {
                return JSValue.jsUndefined();
            }

            if (this.detached) {
                return JSValue.jsUndefined();
            }

            const args = callframe.arguments(1);

            if (args.len < 1) {
                globalObject.throw("Expected 1 arguments", .{});
                return .zero;
            }

            var exception: JSC.C.JSValueRef = null;

            const opts = args.ptr[0];
            if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
                globalObject.throw("Expected options object", .{});
                return .zero;
            }

            const socket_obj = opts.get(globalObject, "socket") orelse {
                globalObject.throw("Expected \"socket\" option", .{});
                return .zero;
            };

            var handlers = Handlers.fromJS(globalObject, socket_obj, &exception) orelse {
                globalObject.throwValue(exception.?.value());
                return .zero;
            };

            var ssl_opts: ?JSC.API.ServerConfig.SSLConfig = null;

            if (opts.getTruthy(globalObject, "tls")) |tls| {
                if (tls.isBoolean()) {
                    if (tls.toBoolean()) {
                        ssl_opts = JSC.API.ServerConfig.SSLConfig.zero;
                    }
                } else {
                    if (JSC.API.ServerConfig.SSLConfig.inJS(globalObject, tls, &exception)) |ssl_config| {
                        ssl_opts = ssl_config;
                    } else if (exception != null) {
                        return .zero;
                    }
                }
            }

            if (ssl_opts == null) {
                globalObject.throw("Expected \"tls\" option", .{});
                return .zero;
            }

            var default_data = JSValue.zero;
            if (opts.getTruthy(globalObject, "data")) |default_data_value| {
                default_data = default_data_value;
                default_data.ensureStillAlive();
            }

            var socket_config = ssl_opts.?;
            defer socket_config.deinit();
            const options = socket_config.asUSockets();

            const protos = socket_config.protos;
            const protos_len = socket_config.protos_len;

            const ext_size = @sizeOf(WrappedSocket);

            const is_server = this.handlers.is_server;
            var tls = handlers.vm.allocator.create(TLSSocket) catch @panic("OOM");
            var handlers_ptr = handlers.vm.allocator.create(Handlers) catch @panic("OOM");
            handlers_ptr.* = handlers;
            handlers_ptr.is_server = is_server;
            handlers_ptr.protect();

            tls.* = .{
                .handlers = handlers_ptr,
                .this_value = .zero,
                .socket = undefined,
                .connection = if (this.connection) |c| c.clone() else null,
                .wrapped = .tls,
                .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p[0..protos_len]) catch unreachable) else null,
                .server_name = if (socket_config.server_name) |server_name| (bun.default_allocator.dupe(u8, server_name[0..bun.len(server_name)]) catch unreachable) else null,
            };

            const tls_js_value = tls.getThisValue(globalObject);
            TLSSocket.dataSetCached(tls_js_value, globalObject, default_data);

            const TCPHandler = NewWrappedHandler(false);

            // reconfigure context to use the new wrapper handlers
            Socket.unsafeConfigure(this.socket.context().?, true, true, WrappedSocket, TCPHandler);
            const old_context = this.socket.context();
            const TLSHandler = NewWrappedHandler(true);
            const new_socket = this.socket.wrapTLS(
                options,
                ext_size,
                true,
                WrappedSocket,
                TLSHandler,
            ) orelse {
                handlers_ptr.unprotect();
                handlers.vm.allocator.destroy(handlers_ptr);
                bun.default_allocator.destroy(tls);
                return JSValue.jsUndefined();
            };

            tls.socket = new_socket;

            var raw = handlers.vm.allocator.create(TLSSocket) catch @panic("OOM");
            var raw_handlers_ptr = handlers.vm.allocator.create(Handlers) catch @panic("OOM");
            raw_handlers_ptr.* = .{
                .vm = globalObject.bunVM(),
                .globalObject = globalObject,
                .onOpen = this.handlers.onOpen,
                .onClose = this.handlers.onClose,
                .onData = this.handlers.onData,
                .onWritable = this.handlers.onWritable,
                .onTimeout = this.handlers.onTimeout,
                .onConnectError = this.handlers.onConnectError,
                .onEnd = this.handlers.onEnd,
                .onError = this.handlers.onError,
                .onHandshake = this.handlers.onHandshake,
                .binary_type = this.handlers.binary_type,
                .is_server = is_server,
            };

            raw.* = .{
                .handlers = raw_handlers_ptr,
                .this_value = .zero,
                .socket = new_socket,
                .connection = if (this.connection) |c| c.clone() else null,
                .wrapped = .tcp,
                .protos = null,
            };
            raw_handlers_ptr.protect();

            const raw_js_value = raw.getThisValue(globalObject);
            if (JSSocketType(ssl).dataGetCached(this.getThisValue(globalObject))) |raw_default_data| {
                raw_default_data.ensureStillAlive();
                TLSSocket.dataSetCached(raw_js_value, globalObject, raw_default_data);
            }
            // marks both as active
            raw.markActive();
            // this will keep tls alive until socket.open() is called to start TLS certificate and the handshake process
            // open is not immediately called because we need to set bunSocketInternal
            tls.markActive();

            // mark both instances on socket data
            new_socket.ext(WrappedSocket).?.* = .{ .tcp = raw, .tls = tls };

            // start TLS handshake after we set ext
            new_socket.startTLS(!this.handlers.is_server);

            //detach and invalidate the old instance
            this.detached = true;
            if (this.is_active) {
                const vm = this.handlers.vm;
                this.is_active = false;
                // will free handlers and the old_context when hits 0 active connections
                // the connection can be upgraded inside a handler call so we need to garantee that it will be still alive
                this.handlers.markInactive(ssl, old_context, this.wrapped);
                this.poll_ref.unref(vm);
                this.has_pending_activity.store(false, .Release);
            }

            const array = JSC.JSValue.createEmptyArray(globalObject, 2);
            array.putIndex(globalObject, 0, raw_js_value);
            array.putIndex(globalObject, 1, tls_js_value);
            return array;
        }
    };
}

pub const TCPSocket = NewSocket(false);
pub const TLSSocket = NewSocket(true);

pub const WrappedSocket = extern struct {
    // both shares the same socket but one behaves as TLS and the other as TCP
    tls: *TLSSocket,
    tcp: *TLSSocket,
};

pub fn NewWrappedHandler(comptime tls: bool) type {
    const Socket = uws.NewSocketHandler(true);
    return struct {
        pub fn onOpen(
            this: WrappedSocket,
            socket: Socket,
        ) void {
            // only TLS will call onOpen
            if (comptime tls) {
                TLSSocket.onOpen(this.tls, socket);
            }
        }

        pub fn onEnd(
            this: WrappedSocket,
            socket: Socket,
        ) void {
            if (comptime tls) {
                TLSSocket.onEnd(this.tls, socket);
            } else {
                TLSSocket.onEnd(this.tcp, socket);
            }
        }

        pub fn onHandshake(
            this: WrappedSocket,
            socket: Socket,
            success: i32,
            ssl_error: uws.us_bun_verify_error_t,
        ) void {
            // only TLS will call onHandshake
            if (comptime tls) {
                TLSSocket.onHandshake(this.tls, socket, success, ssl_error);
            }
        }

        pub fn onClose(
            this: WrappedSocket,
            socket: Socket,
            err: c_int,
            data: ?*anyopaque,
        ) void {
            if (comptime tls) {
                TLSSocket.onClose(this.tls, socket, err, data);
            } else {
                TLSSocket.onClose(this.tcp, socket, err, data);
            }
        }

        pub fn onData(
            this: WrappedSocket,
            socket: Socket,
            data: []const u8,
        ) void {
            if (comptime tls) {
                TLSSocket.onData(this.tls, socket, data);
            } else {
                // tedius use this
                TLSSocket.onData(this.tcp, socket, data);
            }
        }

        pub fn onWritable(
            this: WrappedSocket,
            socket: Socket,
        ) void {
            if (comptime tls) {
                TLSSocket.onWritable(this.tls, socket);
            } else {
                TLSSocket.onWritable(this.tcp, socket);
            }
        }
        pub fn onTimeout(
            this: WrappedSocket,
            socket: Socket,
        ) void {
            if (comptime tls) {
                TLSSocket.onTimeout(this.tls, socket);
            } else {
                TLSSocket.onTimeout(this.tcp, socket);
            }
        }

        pub fn onLongTimeout(
            this: WrappedSocket,
            socket: Socket,
        ) void {
            if (comptime tls) {
                TLSSocket.onTimeout(this.tls, socket);
            } else {
                TLSSocket.onTimeout(this.tcp, socket);
            }
        }

        pub fn onConnectError(
            this: WrappedSocket,
            socket: Socket,
            errno: c_int,
        ) void {
            if (comptime tls) {
                TLSSocket.onConnectError(this.tls, socket, errno);
            } else {
                TLSSocket.onConnectError(this.tcp, socket, errno);
            }
        }
    };
}
