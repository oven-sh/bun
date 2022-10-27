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
const JSC = @import("javascript_core");
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../../../which.zig");
const uws = @import("uws");
const ZigString = JSC.ZigString;
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

const Handlers = struct {
    onOpen: JSC.JSValue = .zero,
    onClose: JSC.JSValue = .zero,
    onData: JSC.JSValue = .zero,
    onWritable: JSC.JSValue = .zero,
    onTimeout: JSC.JSValue = .zero,
    onConnectError: JSC.JSValue = .zero,
    onEnd: JSC.JSValue = .zero,
    onError: JSC.JSValue = .zero,

    encoding: JSC.Node.Encoding = .utf8,

    vm: *JSC.VirtualMachine,
    globalObject: *JSC.JSGlobalObject,
    active_connections: u32 = 0,
    is_server: bool = false,
    promise: JSC.Strong = .{},

    pub fn markActive(this: *Handlers) void {
        Listener.log("markActive", .{});
        this.active_connections += 1;
    }

    // corker: Corker = .{},

    pub fn resolvePromise(this: *Handlers, value: JSValue) void {
        var promise = this.promise.get() orelse return;
        this.promise.deinit();
        promise.asPromise().?.resolve(this.globalObject, value);
    }

    pub fn rejectPromise(this: *Handlers, value: JSValue) bool {
        var promise = this.promise.get() orelse return false;
        this.promise.deinit();
        promise.asPromise().?.reject(this.globalObject, value);
        return true;
    }

    pub fn markInactive(this: *Handlers, ssl: bool, ctx: *uws.SocketContext) void {
        Listener.log("markInactive", .{});
        this.active_connections -= 1;
        if (this.active_connections == 0 and this.is_server) {
            var listen_socket: *Listener = @fieldParentPtr(Listener, "handlers", this);
            // allow it to be GC'd once the last connection is closed and it's not listening anymore
            if (listen_socket.listener == null) {
                listen_socket.strong_self.clear();
            }
        } else if (this.active_connections == 0 and !this.is_server) {
            this.unprotect();
            ctx.deinit(ssl);
            bun.default_allocator.destroy(this);
        }
    }

    pub fn callErrorHandler(this: *Handlers, thisValue: JSValue, err: []const JSValue) bool {
        const onError = this.onError;
        if (onError == .zero) {
            return false;
        }

        const result = onError.callWithThis(this.globalObject, thisValue, err);
        if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(this.globalObject)) {
            this.vm.runErrorHandler(result, null);
        }

        return true;
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, opts: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Handlers {
        var handlers = Handlers{
            .vm = globalObject.bunVM(),
            .globalObject = globalObject,
        };

        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected socket object", .{}, globalObject).asObjectRef();
            return null;
        }

        const pairs = .{
            .{ "onData", "data" },
            .{ "onWritable", "drain" },
            .{ "onOpen", "open" },
            .{ "onClose", "close" },
            .{ "onData", "data" },
            .{ "onTimeout", "timeout" },
            .{ "onConnectError", "connectError" },
            .{ "onEnd", "end" },
            .{ "onError", "error" },
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

        return handlers;
    }

    pub fn unprotect(this: *Handlers) void {
        this.onOpen.unprotect();
        this.onClose.unprotect();
        this.onData.unprotect();
        this.onWritable.unprotect();
        this.onTimeout.unprotect();
        this.onConnectError.unprotect();
        this.onEnd.unprotect();
        this.onError.unprotect();
    }

    pub fn protect(this: *Handlers) void {
        this.onOpen.protect();
        this.onClose.protect();
        this.onData.protect();
        this.onWritable.protect();
        this.onTimeout.protect();
        this.onConnectError.protect();
        this.onEnd.protect();
        this.onError.protect();
    }
};

pub const SocketConfig = struct {
    hostname_or_unix: JSC.ZigString.Slice,
    port: ?u16 = null,
    ssl: ?JSC.API.ServerConfig.SSLConfig = null,
    handlers: Handlers,
    default_data: JSC.JSValue = .zero,

    pub fn fromJS(
        opts: JSC.JSValue,
        globalObject: *JSC.JSGlobalObject,
        exception: JSC.C.ExceptionRef,
    ) ?SocketConfig {
        var hostname_or_unix: JSC.ZigString.Slice = JSC.ZigString.Slice.empty;
        var port: ?u16 = null;

        var ssl: ?JSC.API.ServerConfig.SSLConfig = null;
        var default_data = JSValue.zero;

        if (opts.getTruthy(globalObject, "tls")) |tls| {
            if (JSC.API.ServerConfig.SSLConfig.inJS(globalObject, tls, exception)) |ssl_config| {
                ssl = ssl_config;
            } else if (exception.* != null) {
                return null;
            }
        }

        if (opts.getTruthy(globalObject, "hostname")) |hostname| {
            if (hostname.isEmptyOrUndefinedOrNull() or !hostname.isString()) {
                exception.* = JSC.toInvalidArguments("Expected \"hostname\" to be a string", .{}, globalObject).asObjectRef();
                return null;
            }

            const port_value = opts.get(globalObject, "port") orelse JSValue.zero;
            if (port_value.isEmptyOrUndefinedOrNull() or !port_value.isNumber() or port_value.toInt64() > std.math.maxInt(u16) or port_value.toInt64() < 0) {
                exception.* = JSC.toInvalidArguments("Expected \"port\" to be a number between 0 and 65432", .{}, globalObject).asObjectRef();
                return null;
            }

            hostname_or_unix = hostname.getZigString(globalObject).toSlice(bun.default_allocator);
            port = port_value.toU16();

            if (hostname_or_unix.len == 0) {
                exception.* = JSC.toInvalidArguments("Expected \"hostname\" to be a non-empty string", .{}, globalObject).asObjectRef();
                return null;
            }
        } else if (opts.getTruthy(globalObject, "unix")) |unix_socket| {
            if (unix_socket.isEmptyOrUndefinedOrNull() or !unix_socket.isString()) {
                exception.* = JSC.toInvalidArguments("Expected \"unix\" to be a string", .{}, globalObject).asObjectRef();
                return null;
            }

            hostname_or_unix = unix_socket.getZigString(globalObject).toSlice(bun.default_allocator);

            if (hostname_or_unix.len == 0) {
                exception.* = JSC.toInvalidArguments("Expected \"unix\" to be a non-empty string", .{}, globalObject).asObjectRef();
                return null;
            }
        } else {
            exception.* = JSC.toInvalidArguments("Expected either \"hostname\" or \"unix\"", .{}, globalObject).asObjectRef();
            return null;
        }

        const handlers = Handlers.fromJS(globalObject, opts.get(globalObject, "socket") orelse JSValue.zero, exception) orelse {
            hostname_or_unix.deinit();
            return null;
        };

        if (opts.getTruthy(globalObject, "data")) |default_data_value| {
            default_data = default_data_value;
        }

        return SocketConfig{
            .hostname_or_unix = hostname_or_unix,
            .port = port,
            .ssl = ssl,
            .handlers = handlers,
            .default_data = default_data,
        };
    }
};

pub const Listener = struct {
    pub const log = Output.scoped(.Listener, false);

    handlers: Handlers,
    listener: ?*uws.ListenSocket = null,
    poll_ref: JSC.PollRef = JSC.PollRef.init(),
    connection: UnixOrHost,
    socket_context: ?*uws.SocketContext = null,
    ssl: bool = false,

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

        pub fn deinit(this: UnixOrHost) void {
            switch (this) {
                .unix => |u| {
                    bun.default_allocator.destroy(@intToPtr([*]u8, @ptrToInt(u.ptr)));
                },
                .host => |h| {
                    bun.default_allocator.destroy(@intToPtr([*]u8, @ptrToInt(h.host.ptr)));
                },
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

        var socket_obj = opts.get(globalObject, "socket") orelse {
            globalObject.throw("Expected \"socket\" object", .{});
            return .zero;
        };

        const handlers = Handlers.fromJS(globalObject, socket_obj, &exception) orelse {
            globalObject.throwValue(exception.?.value());
            return .zero;
        };

        var prev_handlers = this.handlers;
        prev_handlers.unprotect();
        this.handlers = handlers; // TODO: this is a memory leak
        this.handlers.protect();

        return JSValue.jsUndefined();
    }

    pub fn listen(
        globalObject: *JSC.JSGlobalObject,
        opts: JSValue,
        exception: JSC.C.ExceptionRef,
    ) JSValue {
        log("listen", .{});
        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected object", .{}, globalObject).asObjectRef();
            return .zero;
        }

        const socket_config = SocketConfig.fromJS(opts, globalObject, exception) orelse {
            return .zero;
        };
        var hostname_or_unix = socket_config.hostname_or_unix;
        var port = socket_config.port;
        var ssl = socket_config.ssl;
        var handlers = socket_config.handlers;
        handlers.is_server = true;

        const ssl_enabled = ssl != null;

        var socket = Listener{
            .handlers = handlers,
            .connection = if (port) |port_| .{
                .host = .{ .host = (hostname_or_unix.cloneIfNeeded() catch unreachable).slice(), .port = port_ },
            } else .{
                .unix = (hostname_or_unix.cloneIfNeeded() catch unreachable).slice(),
            },
            .ssl = ssl_enabled,
        };

        socket.handlers.protect();

        if (socket_config.default_data != .zero) {
            socket.strong_data = JSC.Strong.create(socket_config.default_data, globalObject);
        }

        const socket_flags: i32 = 0;

        var ctx_opts: uws.us_socket_context_options_t = undefined;
        @memset(@ptrCast([*]u8, &ctx_opts), 0, @sizeOf(uws.us_socket_context_options_t));

        if (ssl) |ssl_config| {
            ctx_opts.key_file_name = ssl_config.key_file_name;
            ctx_opts.cert_file_name = ssl_config.cert_file_name;
            ctx_opts.ca_file_name = ssl_config.ca_file_name;
            ctx_opts.dh_params_file_name = ssl_config.dh_params_file_name;
            ctx_opts.passphrase = ssl_config.passphrase;
            ctx_opts.ssl_prefer_low_memory_usage = @boolToInt(ssl_config.low_memory_mode);
        }

        socket.socket_context = uws.us_create_socket_context(@boolToInt(ssl_enabled), uws.Loop.get().?, @sizeOf(usize), ctx_opts);

        if (ssl) |ssl_config| {
            uws.us_socket_context_add_server_name(1, socket.socket_context, ssl_config.server_name, ctx_opts, null);
        }

        var this: *Listener = handlers.vm.allocator.create(Listener) catch @panic("OOM");
        this.* = socket;
        this.socket_context.?.ext(ssl_enabled, *Listener).?.* = this;

        var this_value = this.toJS(globalObject);
        this.strong_self.set(globalObject, this_value);
        this.poll_ref.ref(handlers.vm);

        if (ssl_enabled) {
            uws.NewSocketHandler(true).configure(
                this.socket_context.?,
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
                },
            );
        } else {
            uws.NewSocketHandler(false).configure(
                this.socket_context.?,
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
                },
            );
        }

        switch (this.connection) {
            .host => |c| {
                var host = bun.default_allocator.dupeZ(u8, c.host) catch unreachable;
                defer bun.default_allocator.destroy(host.ptr);
                this.listener = uws.us_socket_context_listen(@boolToInt(ssl_enabled), this.socket_context, host, c.port, socket_flags, 8) orelse {
                    exception.* = JSC.toInvalidArguments(
                        "Failed to listen at {s}:{d}",
                        .{
                            bun.span(host),
                            c.port,
                        },
                        globalObject,
                    ).asObjectRef();
                    this.poll_ref.unref(handlers.vm);

                    this.strong_self.clear();
                    this.strong_data.clear();

                    return .zero;
                };
            },
            .unix => |u| {
                var host = bun.default_allocator.dupeZ(u8, u) catch unreachable;
                defer bun.default_allocator.destroy(host.ptr);
                this.listener = uws.us_socket_context_listen_unix(@boolToInt(ssl_enabled), this.socket_context, host, socket_flags, 8) orelse {
                    exception.* = JSC.toInvalidArguments(
                        "Failed to listen on socket {s}",
                        .{
                            bun.span(host),
                        },
                        globalObject,
                    ).asObjectRef();
                    this.poll_ref.unref(handlers.vm);

                    this.strong_self.clear();
                    this.strong_data.clear();

                    return .zero;
                };
            },
        }

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
        var listener: *Listener = socket.context().ext(ssl, *Listener).?.*;
        const Socket = NewSocket(ssl);
        std.debug.assert(ssl == listener.ssl);

        var this_socket = listener.handlers.vm.allocator.create(Socket) catch @panic("Out of memory");
        this_socket.* = Socket{
            .handlers = &listener.handlers,
            .this_value = listener.strong_data.get() orelse JSValue.zero,
            .socket = socket,
        };
        socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, this_socket);
        socket.timeout(120000);
    }

    pub fn stop(this: *Listener, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        log("close", .{});

        var listener = this.listener orelse return JSValue.jsUndefined();
        this.listener = null;
        listener.close(this.ssl);
        if (this.handlers.active_connections == 0) {
            this.poll_ref.unref(this.handlers.vm);
            this.handlers.unprotect();
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

        if (this.socket_context) |ctx| {
            ctx.deinit(this.ssl);
        }

        this.handlers.unprotect();
        this.connection.deinit();
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
        var this_value = callframe.this();
        if (this.listener == null) return JSValue.jsUndefined();
        this.poll_ref.ref(globalObject.bunVM());
        this.strong_self.set(globalObject, this_value);
        return JSValue.jsUndefined();
    }

    pub fn unref(this: *Listener, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        if (!this.poll_ref.isActive()) return JSValue.jsUndefined();

        this.poll_ref.unref(globalObject.bunVM());
        if (this.handlers.active_connections == 0) {
            this.strong_self.clear();
        }
        return JSValue.jsUndefined();
    }

    pub fn connect(
        globalObject: *JSC.JSGlobalObject,
        opts: JSValue,
        exception: JSC.C.ExceptionRef,
    ) JSValue {
        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected options object", .{}, globalObject).asObjectRef();
            return .zero;
        }

        const socket_config = SocketConfig.fromJS(opts, globalObject, exception) orelse {
            return .zero;
        };
        var hostname_or_unix = socket_config.hostname_or_unix;
        var port = socket_config.port;
        var ssl = socket_config.ssl;
        var handlers = socket_config.handlers;
        var default_data = socket_config.default_data;

        const ssl_enabled = ssl != null;

        handlers.protect();

        var ctx_opts: uws.us_socket_context_options_t = undefined;
        @memset(@ptrCast([*]u8, &ctx_opts), 0, @sizeOf(uws.us_socket_context_options_t));

        if (ssl) |ssl_config| {
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
        }

        var socket_context = uws.us_create_socket_context(@boolToInt(ssl_enabled), uws.Loop.get().?, @sizeOf(usize), ctx_opts).?;
        var connection: Listener.UnixOrHost = if (port) |port_| .{
            .host = .{ .host = (hostname_or_unix.cloneIfNeeded() catch unreachable).slice(), .port = port_ },
        } else .{
            .unix = (hostname_or_unix.cloneIfNeeded() catch unreachable).slice(),
        };

        if (ssl_enabled) {
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
                },
            );
        }

        default_data.ensureStillAlive();

        // const socket_flags: i32 = 0;

        var handlers_ptr = handlers.vm.allocator.create(Handlers) catch @panic("OOM");
        handlers_ptr.* = handlers;
        handlers_ptr.is_server = false;

        var promise = JSC.JSPromise.create(globalObject);
        var promise_value = promise.asValue(globalObject);
        handlers_ptr.promise.set(globalObject, promise_value);

        if (ssl_enabled) {
            var tls = handlers.vm.allocator.create(TLSSocket) catch @panic("OOM");

            tls.* = .{
                .handlers = handlers_ptr,
                .this_value = default_data,
                .socket = undefined,
            };

            tls.doConnect(connection, socket_context) catch {
                handlers_ptr.unprotect();
                socket_context.deinit(true);
                handlers.vm.allocator.destroy(handlers_ptr);
                handlers.promise.deinit();
                bun.default_allocator.destroy(tls);
                exception.* = ZigString.static("Failed to connect").toErrorInstance(globalObject).asObjectRef();
                return .zero;
            };

            return promise_value;
        } else {
            var tcp = handlers.vm.allocator.create(TCPSocket) catch @panic("OOM");

            tcp.* = .{
                .handlers = handlers_ptr,
                .this_value = default_data,
                .socket = undefined,
            };

            tcp.doConnect(connection, socket_context) catch {
                handlers_ptr.unprotect();
                socket_context.deinit(false);
                handlers.vm.allocator.destroy(handlers_ptr);
                handlers.promise.deinit();
                bun.default_allocator.destroy(tcp);
                exception.* = ZigString.static("Failed to connect").toErrorInstance(globalObject).asObjectRef();
                return .zero;
            };

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

fn NewSocket(comptime ssl: bool) type {
    return struct {
        pub const Socket = uws.NewSocketHandler(ssl);
        socket: Socket,
        detached: bool = false,
        handlers: *Handlers,
        this_value: JSC.JSValue = .zero,
        poll_ref: JSC.PollRef = JSC.PollRef.init(),
        reffer: JSC.Ref = JSC.Ref.init(),
        last_4: [4]u8 = .{ 0, 0, 0, 0 },

        const This = @This();
        const log = Output.scoped(.Socket, false);

        pub usingnamespace JSSocketType(ssl);

        pub fn doConnect(this: *This, connection: Listener.UnixOrHost, socket_ctx: *uws.SocketContext) !void {
            switch (connection) {
                .host => |c| {
                    _ = @This().Socket.connectPtr(
                        c.host,
                        c.port,
                        socket_ctx,
                        @This(),
                        this,
                        "socket",
                    ) orelse return error.ConnectionFailed;
                },
                .unix => |u| {
                    _ = @This().Socket.connectUnixPtr(
                        u,
                        socket_ctx,
                        @This(),
                        this,
                        "socket",
                    ) orelse return error.ConnectionFailed;
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
            if (this.detached) return;
            var handlers = this.handlers;
            const callback = handlers.onWritable;
            if (callback == .zero) {
                return;
            }

            const this_value = this.getThisValue(handlers.globalObject);
            const result = callback.callWithThis(handlers.globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(handlers.globalObject)) {
                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
            }
        }
        pub fn onTimeout(
            this: *This,
            _: Socket,
        ) void {
            JSC.markBinding(@src());
            if (this.detached) return;
            this.detached = true;
            var handlers = this.handlers;
            this.poll_ref.unref(handlers.vm);
            var globalObject = handlers.globalObject;
            const callback = handlers.onTimeout;

            this.markInactive();
            if (callback == .zero) {
                return;
            }

            const this_value = this.getThisValue(globalObject);
            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(globalObject)) {
                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
            }
        }
        pub fn onConnectError(this: *This, socket: Socket, errno: c_int) void {
            JSC.markBinding(@src());
            log("onConnectError({d}", .{errno});
            this.detached = true;
            var handlers = this.handlers;
            this.poll_ref.unref(handlers.vm);
            var err = JSC.SystemError{
                .errno = errno,
                .message = ZigString.init("Failed to connect"),
                .syscall = ZigString.init("connect"),
            };
            _ = handlers.rejectPromise(err.toErrorInstance(handlers.globalObject));
            this.reffer.unref(handlers.vm);
            handlers.markInactive(ssl, socket.context());
            this.finalize();
        }

        pub fn markActive(this: *This) void {
            if (!this.reffer.has) {
                this.handlers.markActive();
                this.reffer.ref(this.handlers.vm);
            }
        }

        pub fn markInactive(this: *This) void {
            if (this.reffer.has) {
                var vm = this.handlers.vm;
                this.reffer.unref(vm);

                // we have to close the socket before the socket context is closed
                // otherwise we will get a segfault
                // uSockets will defer closing the TCP socket until the next tick
                if (!this.socket.isClosed())
                    this.socket.close(0, null);

                this.handlers.markInactive(ssl, this.socket.context());
                this.poll_ref.unref(vm);
            }

            if (this.this_value != .zero) {
                this.this_value.unprotect();
            }
        }

        pub fn onOpen(this: *This, socket: Socket) void {
            JSC.markBinding(@src());
            log("onOpen", .{});
            this.poll_ref.ref(this.handlers.vm);
            this.detached = false;
            this.socket = socket;
            socket.ext(**anyopaque).?.* = bun.cast(**anyopaque, this);
            var handlers = this.handlers;
            const old_this_value = this.this_value;
            this.this_value = .zero;
            const this_value = this.getThisValue(handlers.globalObject);

            if (old_this_value != .zero) {
                This.dataSetCached(this_value, handlers.globalObject, old_this_value);
            }

            this.markActive();
            handlers.resolvePromise(this_value);

            if (handlers.onOpen == .zero and old_this_value == .zero)
                return;

            const result = handlers.onOpen.callWithThis(handlers.globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(handlers.globalObject)) {
                if (!this.socket.isClosed()) {
                    log("Closing due to error", .{});
                    this.detached = true;
                    this.socket.close(0, null);
                } else {
                    log("Already closed", .{});
                }

                if (handlers.rejectPromise(this_value)) {
                    return;
                }

                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
                return;
            }
        }

        pub fn getThisValue(this: *This, globalObject: *JSC.JSGlobalObject) JSValue {
            if (this.this_value == .zero) {
                const value = this.toJS(globalObject);
                this.this_value = value;
                value.protect();
                return value;
            }

            return this.this_value;
        }

        pub fn onEnd(this: *This, _: Socket) void {
            JSC.markBinding(@src());
            log("onEnd", .{});
            this.detached = true;
            var handlers = this.handlers;
            const callback = handlers.onEnd;

            if (callback == .zero) {
                return;
            }

            const this_value = this.getThisValue(handlers.globalObject);
            const result = callback.callWithThis(handlers.globalObject, this_value, &[_]JSValue{
                this_value,
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(handlers.globalObject)) {
                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
            }
        }

        pub fn onClose(this: *This, _: Socket, err: c_int, _: ?*anyopaque) void {
            JSC.markBinding(@src());
            log("onClose", .{});
            this.detached = true;
            var handlers = this.handlers;
            this.poll_ref.unref(handlers.vm);

            const callback = handlers.onClose;
            var globalObject = handlers.globalObject;

            if (callback == .zero) {
                this.markInactive();
                return;
            }

            const this_value = this.getThisValue(globalObject);

            const result = callback.callWithThis(globalObject, this_value, &[_]JSValue{
                this_value,
                JSValue.jsNumber(@as(i32, err)),
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(globalObject)) {
                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
            }
        }

        pub fn onData(this: *This, _: Socket, data: []const u8) void {
            JSC.markBinding(@src());
            if (comptime Environment.allow_assert) {
                log("onData({d})", .{data.len});
            }

            if (this.detached) return;
            var handlers = this.handlers;
            // const encoding = handlers.encoding;
            const callback = handlers.onData;
            if (callback == .zero) {
                return;
            }

            const output_value = JSC.ArrayBuffer.create(handlers.globalObject, data, .Uint8Array);

            const this_value = this.getThisValue(handlers.globalObject);
            const result = callback.callWithThis(handlers.globalObject, this_value, &[_]JSValue{
                this_value,
                output_value,
            });

            if (!result.isEmptyOrUndefinedOrNull() and result.isAnyError(handlers.globalObject)) {
                if (handlers.callErrorHandler(this_value, &[_]JSC.JSValue{ this_value, result })) {
                    return;
                }

                handlers.vm.runErrorHandler(result, null);
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
            const t = args.ptr[0].toInt32();
            if (t < 0) {
                globalObject.throw("Timeout must be a positive integer", .{});
                return .zero;
            }

            this.socket.timeout(@intCast(c_uint, t));

            return JSValue.jsUndefined();
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

            return this.writeOrEnd(globalObject, args.ptr[0..args.len], false);
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

            var buf: [512]u8 = undefined;
            var length: i32 = 512;
            this.socket.remoteAddress(&buf, &length);
            const address = buf[0..@intCast(usize, @minimum(length, 0))];

            if (address.len == 0) {
                return JSValue.jsUndefined();
            }

            return ZigString.init(address).toValueGC(globalThis);
        }

        fn writeMaybeCorked(this: *This, buffer: []const u8, is_end: bool) i32 {
            // we don't cork yet but we might later
            return this.socket.write(buffer, is_end);
        }

        fn writeOrEnd(this: *This, globalObject: *JSC.JSGlobalObject, args: []const JSC.JSValue, is_end: bool) JSValue {
            if (args.ptr[0].isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected an ArrayBufferView, a string, or a Blob", .{});
                return .zero;
            }

            if (this.socket.isShutdown() or this.socket.isClosed()) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            if (args.ptr[0].asArrayBuffer(globalObject)) |array_buffer| {
                var slice = array_buffer.slice();

                if (args.len > 1) {
                    if (!args.ptr[1].isAnyInt()) {
                        globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                        return .zero;
                    }

                    const offset = @minimum(args.ptr[1].toUInt64NoTruncate(), slice.len);
                    slice = slice[offset..];

                    if (args.len > 2) {
                        if (!args.ptr[2].isAnyInt()) {
                            globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                            return .zero;
                        }

                        const length = @minimum(args.ptr[2].toUInt64NoTruncate(), slice.len);
                        slice = slice[0..length];
                    }
                }

                if (slice.len == 0) {
                    return JSValue.jsNumber(@as(i32, 0));
                }

                return JSValue.jsNumber(this.writeMaybeCorked(slice, is_end));
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
                        return .zero;
                    } else if (args.ptr[0].as(JSC.WebCore.Request)) |request| {
                        request.body.toBlobIfPossible();
                        if (request.body.tryUseAsAnyBlob()) |blob| {
                            break :getter blob;
                        }

                        globalObject.throw("Only Blob/buffered bodies are supported for now", .{});
                        return .zero;
                    }

                    globalObject.throw("Expected Blob, Request or Response", .{});
                    return .zero;
                };

                if (!blob.needsToReadFile()) {
                    var slice = blob.slice();

                    if (args.len > 1) {
                        if (!args.ptr[1].isAnyInt()) {
                            globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                            return .zero;
                        }

                        const offset = @minimum(args.ptr[1].toUInt64NoTruncate(), slice.len);
                        slice = slice[offset..];

                        if (args.len > 2) {
                            if (!args.ptr[2].isAnyInt()) {
                                globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                                return .zero;
                            }

                            const length = @minimum(args.ptr[2].toUInt64NoTruncate(), slice.len);
                            slice = slice[0..length];
                        }
                    }

                    if (slice.len == 0) {
                        return JSValue.jsNumber(@as(i32, 0));
                    }

                    return JSValue.jsNumber(this.writeMaybeCorked(slice, is_end));
                }

                globalObject.throw("sendfile() not implemented yet", .{});
                return .zero;
            } else if (args.ptr[0].toStringOrNull(globalObject)) |jsstring| {
                var zig_str = jsstring.toSlice(globalObject, globalObject.bunVM().allocator);
                defer zig_str.deinit();

                var slice = zig_str.slice();

                if (args.len > 1) {
                    if (!args.ptr[1].isAnyInt()) {
                        globalObject.throw("Expected offset integer, got {any}", .{args.ptr[1].getZigString(globalObject)});
                        return .zero;
                    }

                    const offset = @minimum(args.ptr[1].toUInt64NoTruncate(), slice.len);
                    slice = slice[offset..];

                    if (args.len > 2) {
                        if (!args.ptr[2].isAnyInt()) {
                            globalObject.throw("Expected length integer, got {any}", .{args.ptr[2].getZigString(globalObject)});
                            return .zero;
                        }

                        const length = @minimum(args.ptr[2].toUInt64NoTruncate(), slice.len);
                        slice = slice[0..length];
                    }
                }

                return JSValue.jsNumber(this.writeMaybeCorked(slice, is_end));
            } else {
                globalObject.throw("Expected ArrayBufferView, a string, or a Blob", .{});
                return .zero;
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

            if (args.len == 0) {
                log("end()", .{});
                if (!this.detached) {
                    if (!this.socket.isClosed()) this.socket.flush();
                    this.detached = true;

                    this.markInactive();
                    if (!this.socket.isClosed())
                        this.socket.close(0, null);
                }

                return JSValue.jsUndefined();
            }

            log("end({d} args)", .{args.len});

            if (this.detached) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            const result = this.writeOrEnd(globalObject, args.ptr[0..args.len], true);
            if (result != .zero and result.toInt32() > 0) {
                this.socket.flush();
                this.detached = true;
                this.markInactive();
                if (!this.socket.isClosed())
                    this.socket.close(0, null);
            }

            return result;
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
            log("finalize()", .{});
            if (!this.detached and !this.socket.isClosed()) {
                this.detached = true;
                this.socket.close(0, null);
            }
            this.markInactive();
            if (this.poll_ref.isActive()) this.poll_ref.unref(JSC.VirtualMachine.vm);
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

            var socket_obj = opts.get(globalObject, "socket") orelse {
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
    };
}

pub const TCPSocket = NewSocket(false);
pub const TLSSocket = NewSocket(true);
