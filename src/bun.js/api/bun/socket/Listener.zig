//! This is the code for the object returned by Bun.listen().
const Listener = @This();

handlers: Handlers,
listener: ListenerType = .none,

poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
connection: UnixOrHost,
socket_context: ?*uws.SocketContext = null,
ssl: bool = false,
protos: ?[]const u8 = null,

strong_data: JSC.Strong.Optional = .empty,
strong_self: JSC.Strong.Optional = .empty,

pub const js = JSC.Codegen.JSListener;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const ListenerType = union(enum) {
    uws: *uws.ListenSocket,
    namedPipe: *WindowsNamedPipeListeningContext,
    none: void,
};

pub fn getData(this: *Listener, _: *JSC.JSGlobalObject) JSValue {
    log("getData()", .{});
    return this.strong_data.get() orelse .js_undefined;
}

pub fn setData(this: *Listener, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
    log("setData()", .{});
    this.strong_data.set(globalObject, value);
}

pub const UnixOrHost = union(enum) {
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
                    .unix = (bun.default_allocator.dupe(u8, u) catch bun.outOfMemory()),
                };
            },
            .host => |h| {
                return .{
                    .host = .{
                        .host = (bun.default_allocator.dupe(u8, h.host) catch bun.outOfMemory()),
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

pub fn reload(this: *Listener, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);

    if (args.len < 1 or (this.listener == .none and this.handlers.active_connections == 0)) {
        return globalObject.throw("Expected 1 argument", .{});
    }

    const opts = args.ptr[0];
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwValue(globalObject.toInvalidArguments("Expected options object", .{}));
    }

    const socket_obj = try opts.get(globalObject, "socket") orelse {
        return globalObject.throw("Expected \"socket\" object", .{});
    };

    const handlers = try Handlers.fromJS(globalObject, socket_obj, this.handlers.is_server);

    var prev_handlers = &this.handlers;
    prev_handlers.unprotect();
    this.handlers = handlers; // TODO: this is a memory leak
    this.handlers.protect();

    return .js_undefined;
}

pub fn listen(globalObject: *JSC.JSGlobalObject, opts: JSValue) bun.JSError!JSValue {
    log("listen", .{});
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected object", .{});
    }

    const vm = JSC.VirtualMachine.get();

    var socket_config = try SocketConfig.fromJS(vm, opts, globalObject, true);

    var hostname_or_unix = socket_config.hostname_or_unix;
    const port = socket_config.port;
    var ssl = socket_config.ssl;
    var handlers = socket_config.handlers;
    var protos: ?[]const u8 = null;

    const ssl_enabled = ssl != null;

    const socket_flags = socket_config.socketFlags();
    defer if (ssl) |*_ssl| _ssl.deinit();

    if (Environment.isWindows) {
        if (port == null) {
            // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
            const slice = hostname_or_unix.slice();
            var buf: bun.PathBuffer = undefined;
            if (normalizePipeName(slice, buf[0..])) |pipe_name| {
                const connection: Listener.UnixOrHost = .{ .unix = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch bun.outOfMemory()).slice() };
                if (ssl_enabled) {
                    if (ssl.?.protos) |p| {
                        protos = p[0..ssl.?.protos_len];
                    }
                }
                var socket = Listener{
                    .handlers = handlers,
                    .connection = connection,
                    .ssl = ssl_enabled,
                    .socket_context = null,
                    .listener = .none,
                    .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null,
                };

                vm.eventLoop().ensureWaker();

                socket.handlers.protect();

                if (socket_config.default_data != .zero) {
                    socket.strong_data = .create(socket_config.default_data, globalObject);
                }

                var this: *Listener = handlers.vm.allocator.create(Listener) catch bun.outOfMemory();
                this.* = socket;
                //TODO: server_name is not supported on named pipes, I belive its , lets wait for someone to ask for it

                this.listener = .{
                    // we need to add support for the backlog parameter on listen here we use the default value of nodejs
                    .namedPipe = WindowsNamedPipeListeningContext.listen(globalObject, pipe_name, 511, ssl, this) catch {
                        this.deinit();
                        return globalObject.throwInvalidArguments("Failed to listen at {s}", .{pipe_name});
                    },
                };

                const this_value = this.toJS(globalObject);
                this.strong_self.set(globalObject, this_value);
                this.poll_ref.ref(handlers.vm);

                return this_value;
            }
        }
    }
    const ctx_opts: uws.SocketContext.BunSocketContextOptions = if (ssl != null)
        JSC.API.ServerConfig.SSLConfig.asUSockets(ssl.?)
    else
        .{};

    vm.eventLoop().ensureWaker();

    var create_err: uws.create_bun_socket_error_t = .none;
    const socket_context = switch (ssl_enabled) {
        true => uws.SocketContext.createSSLContext(uws.Loop.get(), @sizeOf(usize), ctx_opts, &create_err),
        false => uws.SocketContext.createNoSSLContext(uws.Loop.get(), @sizeOf(usize)),
    } orelse {
        var err = globalObject.createErrorInstance("Failed to listen on {s}:{d}", .{ hostname_or_unix.slice(), port orelse 0 });
        defer {
            socket_config.handlers.unprotect();
            hostname_or_unix.deinit();
        }

        const errno = @intFromEnum(bun.sys.getErrno(@as(c_int, -1)));
        if (errno != 0) {
            err.put(globalObject, ZigString.static("errno"), JSValue.jsNumber(errno));
            if (bun.sys.SystemErrno.init(errno)) |str| {
                err.put(globalObject, ZigString.static("code"), ZigString.init(@tagName(str)).toJS(globalObject));
            }
        }

        return globalObject.throwValue(err);
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
        .host = .{ .host = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch bun.outOfMemory()).slice(), .port = port_ },
    } else if (socket_config.fd) |fd| .{ .fd = fd } else .{
        .unix = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch bun.outOfMemory()).slice(),
    };
    var errno: c_int = 0;
    const listen_socket: *uws.ListenSocket = brk: {
        switch (connection) {
            .host => |c| {
                const host = bun.default_allocator.dupeZ(u8, c.host) catch bun.outOfMemory();
                defer bun.default_allocator.free(host);

                const socket = socket_context.listen(ssl_enabled, host.ptr, c.port, socket_flags, 8, &errno);
                // should return the assigned port
                if (socket) |s| {
                    connection.host.port = @as(u16, @intCast(s.getLocalPort(ssl_enabled)));
                }
                break :brk socket;
            },
            .unix => |u| {
                const host = bun.default_allocator.dupeZ(u8, u) catch bun.outOfMemory();
                defer bun.default_allocator.free(host);
                break :brk socket_context.listenUnix(ssl_enabled, host, host.len, socket_flags, 8, &errno);
            },
            .fd => |fd| {
                _ = fd;
                return globalObject.ERR(.INVALID_ARG_VALUE, "Bun does not support listening on a file descriptor.", .{}).throw();
            },
        }
    } orelse {
        defer {
            hostname_or_unix.deinit();
            socket_context.free(ssl_enabled);
        }

        const err = globalObject.createErrorInstance("Failed to listen at {s}", .{bun.span(hostname_or_unix.slice())});
        log("Failed to listen {d}", .{errno});
        if (errno != 0) {
            err.put(globalObject, ZigString.static("syscall"), bun.String.createUTF8ForJS(globalObject, "listen"));
            err.put(globalObject, ZigString.static("errno"), JSValue.jsNumber(errno));
            err.put(globalObject, ZigString.static("address"), hostname_or_unix.toZigString().toJS(globalObject));
            if (port) |p| err.put(globalObject, ZigString.static("port"), .jsNumber(p));
            if (bun.sys.SystemErrno.init(errno)) |str| {
                err.put(globalObject, ZigString.static("code"), ZigString.init(@tagName(str)).toJS(globalObject));
            }
        }
        return globalObject.throwValue(err);
    };

    var socket = Listener{
        .handlers = handlers,
        .connection = connection,
        .ssl = ssl_enabled,
        .socket_context = socket_context,
        .listener = .{ .uws = listen_socket },
        .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null,
    };

    socket.handlers.protect();

    if (socket_config.default_data != .zero) {
        socket.strong_data = .create(socket_config.default_data, globalObject);
    }

    if (ssl) |ssl_config| {
        if (ssl_config.server_name) |server_name| {
            const slice = bun.asByteSlice(server_name);
            if (slice.len > 0)
                socket.socket_context.?.addServerName(true, server_name, ctx_opts);
        }
    }

    var this: *Listener = handlers.vm.allocator.create(Listener) catch bun.outOfMemory();
    this.* = socket;
    this.socket_context.?.ext(ssl_enabled, *Listener).?.* = this;

    const this_value = this.toJS(globalObject);
    this.strong_self.set(globalObject, this_value);
    this.poll_ref.ref(handlers.vm);

    return this_value;
}

pub fn onCreateTLS(socket: uws.NewSocketHandler(true)) void {
    onCreate(true, socket);
}

pub fn onCreateTCP(socket: uws.NewSocketHandler(false)) void {
    onCreate(false, socket);
}

pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*Listener {
    return globalObject.throw("Cannot construct Listener", .{});
}

pub fn onNamePipeCreated(comptime ssl: bool, listener: *Listener) *NewSocket(ssl) {
    const Socket = NewSocket(ssl);
    bun.assert(ssl == listener.ssl);

    var this_socket = Socket.new(.{
        .ref_count = .init(),
        .handlers = &listener.handlers,
        .this_value = .zero,
        // here we start with a detached socket and attach it later after accept
        .socket = Socket.Socket.detached,
        .protos = listener.protos,
        .flags = .{ .owned_protos = false },
        .socket_context = null, // dont own the socket context
    });
    this_socket.ref();
    if (listener.strong_data.get()) |default_data| {
        const globalObject = listener.handlers.globalObject;
        Socket.js.dataSetCached(this_socket.getThisValue(globalObject), globalObject, default_data);
    }
    return this_socket;
}

pub fn onCreate(comptime ssl: bool, socket: uws.NewSocketHandler(ssl)) void {
    JSC.markBinding(@src());
    log("onCreate", .{});
    //PS: We dont reach this path when using named pipes on windows see onNamePipeCreated

    var listener: *Listener = socket.context().?.ext(ssl, *Listener).?.*;
    const Socket = NewSocket(ssl);
    bun.assert(ssl == listener.ssl);

    const this_socket = bun.new(Socket, .{
        .ref_count = .init(),
        .handlers = &listener.handlers,
        .this_value = .zero,
        .socket = socket,
        .protos = listener.protos,
        .flags = .{ .owned_protos = false },
        .socket_context = null, // dont own the socket context
    });
    this_socket.ref();
    if (listener.strong_data.get()) |default_data| {
        const globalObject = listener.handlers.globalObject;
        Socket.js.dataSetCached(this_socket.getThisValue(globalObject), globalObject, default_data);
    }
    if (socket.ext(**anyopaque)) |ctx| {
        ctx.* = bun.cast(**anyopaque, this_socket);
    }
    socket.setTimeout(120);
}

pub fn addServerName(this: *Listener, global: *JSC.JSGlobalObject, hostname: JSValue, tls: JSValue) bun.JSError!JSValue {
    if (!this.ssl) {
        return global.throwInvalidArguments("addServerName requires SSL support", .{});
    }
    if (!hostname.isString()) {
        return global.throwInvalidArguments("hostname pattern expects a string", .{});
    }
    const host_str = try hostname.toSlice(
        global,
        bun.default_allocator,
    );
    defer host_str.deinit();
    const server_name = bun.default_allocator.dupeZ(u8, host_str.slice()) catch bun.outOfMemory();
    defer bun.default_allocator.free(server_name);
    if (server_name.len == 0) {
        return global.throwInvalidArguments("hostname pattern cannot be empty", .{});
    }

    if (try JSC.API.ServerConfig.SSLConfig.fromJS(JSC.VirtualMachine.get(), global, tls)) |ssl_config| {
        // to keep nodejs compatibility, we allow to replace the server name
        this.socket_context.?.removeServerName(true, server_name);
        this.socket_context.?.addServerName(true, server_name, ssl_config.asUSockets());
    }

    return .js_undefined;
}

pub fn dispose(this: *Listener, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.doStop(true);
    return .js_undefined;
}

pub fn stop(this: *Listener, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    log("close", .{});

    this.doStop(if (arguments.len > 0 and arguments.ptr[0].isBoolean()) arguments.ptr[0].toBoolean() else false);

    return .js_undefined;
}

fn doStop(this: *Listener, force_close: bool) void {
    if (this.listener == .none) return;
    const listener = this.listener;
    defer switch (listener) {
        .uws => |socket| socket.close(this.ssl),
        .namedPipe => |namedPipe| if (Environment.isWindows) namedPipe.closePipeAndDeinit(),
        .none => {},
    };
    this.listener = .none;

    // if we already have no active connections, we can deinit the context now
    if (this.handlers.active_connections == 0) {
        this.poll_ref.unref(this.handlers.vm);

        this.handlers.unprotect();
        // deiniting the context will also close the listener
        if (this.socket_context) |ctx| {
            this.socket_context = null;
            ctx.deinit(this.ssl);
        }
        this.strong_self.clearWithoutDeallocation();
        this.strong_data.clearWithoutDeallocation();
    } else {
        if (force_close) {
            // close all connections in this context and wait for them to close
            if (this.socket_context) |ctx| {
                ctx.close(this.ssl);
            }
        }
    }
}

pub fn finalize(this: *Listener) callconv(.C) void {
    log("finalize", .{});
    const listener = this.listener;
    this.listener = .none;
    switch (listener) {
        .uws => |socket| socket.close(this.ssl),
        .namedPipe => |namedPipe| if (Environment.isWindows) namedPipe.closePipeAndDeinit(),
        .none => {},
    }
    this.deinit();
}

pub fn deinit(this: *Listener) void {
    log("deinit", .{});
    this.strong_self.deinit();
    this.strong_data.deinit();
    this.poll_ref.unref(this.handlers.vm);
    bun.assert(this.listener == .none);
    this.handlers.unprotect();

    if (this.handlers.active_connections > 0) {
        if (this.socket_context) |ctx| {
            ctx.close(this.ssl);
        }
        // TODO: fix this leak.
    } else {
        if (this.socket_context) |ctx| {
            ctx.deinit(this.ssl);
        }
    }

    this.connection.deinit();
    if (this.protos) |protos| {
        this.protos = null;
        bun.default_allocator.free(protos);
    }
    bun.default_allocator.destroy(this);
}

pub fn getConnectionsCount(this: *Listener, _: *JSC.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.handlers.active_connections);
}

pub fn getUnix(this: *Listener, globalObject: *JSC.JSGlobalObject) JSValue {
    if (this.connection != .unix) {
        return .js_undefined;
    }

    return ZigString.init(this.connection.unix).withEncoding().toJS(globalObject);
}

pub fn getHostname(this: *Listener, globalObject: *JSC.JSGlobalObject) JSValue {
    if (this.connection != .host) {
        return .js_undefined;
    }
    return ZigString.init(this.connection.host.host).withEncoding().toJS(globalObject);
}

pub fn getPort(this: *Listener, _: *JSC.JSGlobalObject) JSValue {
    if (this.connection != .host) {
        return .js_undefined;
    }
    return JSValue.jsNumber(this.connection.host.port);
}

pub fn ref(this: *Listener, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const this_value = callframe.this();
    if (this.listener == .none) return .js_undefined;
    this.poll_ref.ref(globalObject.bunVM());
    this.strong_self.set(globalObject, this_value);
    return .js_undefined;
}

pub fn unref(this: *Listener, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.poll_ref.unref(globalObject.bunVM());
    if (this.handlers.active_connections == 0) {
        this.strong_self.clearWithoutDeallocation();
    }
    return .js_undefined;
}

pub fn connect(globalObject: *JSC.JSGlobalObject, opts: JSValue) bun.JSError!JSValue {
    return connectInner(globalObject, null, null, opts);
}

pub fn connectInner(globalObject: *JSC.JSGlobalObject, prev_maybe_tcp: ?*TCPSocket, prev_maybe_tls: ?*TLSSocket, opts: JSValue) bun.JSError!JSValue {
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected options object", .{});
    }
    const vm = globalObject.bunVM();

    const socket_config = try SocketConfig.fromJS(vm, opts, globalObject, false);

    var hostname_or_unix = socket_config.hostname_or_unix;
    const port = socket_config.port;
    var ssl = socket_config.ssl;
    var handlers = socket_config.handlers;
    var default_data = socket_config.default_data;

    var protos: ?[]const u8 = null;
    var server_name: ?[]const u8 = null;
    const ssl_enabled = ssl != null;
    defer if (ssl != null) ssl.?.deinit();

    vm.eventLoop().ensureWaker();

    var connection: Listener.UnixOrHost = blk: {
        if (try opts.getTruthy(globalObject, "fd")) |fd_| {
            if (fd_.isNumber()) {
                const fd = fd_.asFileDescriptor();
                break :blk .{ .fd = fd };
            }
        }
        if (port) |_| {
            break :blk .{ .host = .{ .host = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch bun.outOfMemory()).slice(), .port = port.? } };
        }

        break :blk .{ .unix = (hostname_or_unix.cloneIfNeeded(bun.default_allocator) catch bun.outOfMemory()).slice() };
    };

    if (Environment.isWindows) {
        var buf: bun.PathBuffer = undefined;
        var pipe_name: ?[]const u8 = null;
        const isNamedPipe = switch (connection) {
            // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
            .unix => |slice| brk: {
                pipe_name = normalizePipeName(slice, buf[0..]);
                break :brk (pipe_name != null);
            },
            .fd => |fd| brk: {
                const uvfd = fd.uv();
                const fd_type = uv.uv_guess_handle(uvfd);
                if (fd_type == uv.Handle.Type.named_pipe) {
                    break :brk true;
                }
                if (fd_type == uv.Handle.Type.unknown) {
                    // is not a libuv fd, check if it's a named pipe
                    const osfd: uv.uv_os_fd_t = @ptrFromInt(@as(usize, @intCast(uvfd)));
                    if (bun.windows.GetFileType(osfd) == bun.windows.FILE_TYPE_PIPE) {
                        // yay its a named pipe lets make it a libuv fd
                        connection.fd = bun.FD.fromNative(osfd).makeLibUVOwned() catch @panic("failed to allocate file descriptor");
                        break :brk true;
                    }
                }
                break :brk false;
            },
            else => false,
        };
        if (isNamedPipe) {
            default_data.ensureStillAlive();

            var handlers_ptr = handlers.vm.allocator.create(Handlers) catch bun.outOfMemory();
            handlers_ptr.* = handlers;

            var promise = JSC.JSPromise.create(globalObject);
            const promise_value = promise.toJS();
            handlers_ptr.promise.set(globalObject, promise_value);

            if (ssl_enabled) {
                var tls = if (prev_maybe_tls) |prev| blk: {
                    bun.destroy(prev.handlers);
                    bun.assert(prev.this_value != .zero);
                    prev.handlers = handlers_ptr;
                    bun.assert(prev.socket.socket == .detached);
                    prev.connection = connection;
                    prev.protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null;
                    prev.server_name = server_name;
                    prev.socket_context = null;
                    break :blk prev;
                } else TLSSocket.new(.{
                    .ref_count = .init(),
                    .handlers = handlers_ptr,
                    .this_value = .zero,
                    .socket = TLSSocket.Socket.detached,
                    .connection = connection,
                    .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null,
                    .server_name = server_name,
                    .socket_context = null,
                });
                TLSSocket.js.dataSetCached(tls.getThisValue(globalObject), globalObject, default_data);
                tls.poll_ref.ref(handlers.vm);
                tls.ref();
                if (connection == .unix) {
                    const named_pipe = WindowsNamedPipeContext.connect(globalObject, pipe_name.?, ssl, .{ .tls = tls }) catch {
                        return promise_value;
                    };
                    tls.socket = TLSSocket.Socket.fromNamedPipe(named_pipe);
                } else {
                    // fd
                    const named_pipe = WindowsNamedPipeContext.open(globalObject, connection.fd, ssl, .{ .tls = tls }) catch {
                        return promise_value;
                    };
                    tls.socket = TLSSocket.Socket.fromNamedPipe(named_pipe);
                }
            } else {
                var tcp = if (prev_maybe_tcp) |prev| blk: {
                    bun.assert(prev.this_value != .zero);
                    prev.handlers = handlers_ptr;
                    bun.assert(prev.socket.socket == .detached);
                    bun.assert(prev.connection == null);
                    bun.assert(prev.protos == null);
                    bun.assert(prev.server_name == null);
                    prev.socket_context = null;
                    break :blk prev;
                } else TCPSocket.new(.{
                    .ref_count = .init(),
                    .handlers = handlers_ptr,
                    .this_value = .zero,
                    .socket = TCPSocket.Socket.detached,
                    .connection = null,
                    .protos = null,
                    .server_name = null,
                    .socket_context = null,
                });
                tcp.ref();
                TCPSocket.js.dataSetCached(tcp.getThisValue(globalObject), globalObject, default_data);
                tcp.poll_ref.ref(handlers.vm);

                if (connection == .unix) {
                    const named_pipe = WindowsNamedPipeContext.connect(globalObject, pipe_name.?, null, .{ .tcp = tcp }) catch {
                        return promise_value;
                    };
                    tcp.socket = TCPSocket.Socket.fromNamedPipe(named_pipe);
                } else {
                    // fd
                    const named_pipe = WindowsNamedPipeContext.open(globalObject, connection.fd, null, .{ .tcp = tcp }) catch {
                        return promise_value;
                    };
                    tcp.socket = TCPSocket.Socket.fromNamedPipe(named_pipe);
                }
            }
            return promise_value;
        }
    }

    const ctx_opts: uws.SocketContext.BunSocketContextOptions = if (ssl != null)
        JSC.API.ServerConfig.SSLConfig.asUSockets(ssl.?)
    else
        .{};

    var create_err: uws.create_bun_socket_error_t = .none;
    const socket_context = switch (ssl_enabled) {
        true => uws.SocketContext.createSSLContext(uws.Loop.get(), @sizeOf(usize), ctx_opts, &create_err),
        false => uws.SocketContext.createNoSSLContext(uws.Loop.get(), @sizeOf(usize)),
    } orelse {
        const err = JSC.SystemError{
            .message = bun.String.static("Failed to connect"),
            .syscall = bun.String.static("connect"),
            .code = if (port == null) bun.String.static("ENOENT") else bun.String.static("ECONNREFUSED"),
        };
        handlers.unprotect();
        connection.deinit();
        return globalObject.throwValue(err.toErrorInstance(globalObject));
    };

    if (ssl_enabled) {
        if (ssl.?.protos) |p| {
            protos = p[0..ssl.?.protos_len];
        }
        if (ssl.?.server_name) |s| {
            server_name = bun.default_allocator.dupe(u8, s[0..bun.len(s)]) catch bun.outOfMemory();
        }
        uws.NewSocketHandler(true).configure(socket_context, true, *TLSSocket, NewSocket(true));
    } else {
        uws.NewSocketHandler(false).configure(socket_context, true, *TCPSocket, NewSocket(false));
    }

    default_data.ensureStillAlive();

    var handlers_ptr = handlers.vm.allocator.create(Handlers) catch bun.outOfMemory();
    handlers_ptr.* = handlers;
    handlers_ptr.is_server = false;

    var promise = JSC.JSPromise.create(globalObject);
    const promise_value = promise.toJS();
    handlers_ptr.promise.set(globalObject, promise_value);

    switch (ssl_enabled) {
        inline else => |is_ssl_enabled| {
            const SocketType = NewSocket(is_ssl_enabled);
            const maybe_previous: ?*SocketType = if (is_ssl_enabled) prev_maybe_tls else prev_maybe_tcp;

            const socket = if (maybe_previous) |prev| blk: {
                bun.assert(prev.this_value != .zero);
                prev.handlers = handlers_ptr;
                bun.assert(prev.socket.socket == .detached);
                prev.connection = connection;
                prev.protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null;
                prev.server_name = server_name;
                prev.socket_context = socket_context;
                break :blk prev;
            } else bun.new(SocketType, .{
                .ref_count = .init(),
                .handlers = handlers_ptr,
                .this_value = .zero,
                .socket = SocketType.Socket.detached,
                .connection = connection,
                .protos = if (protos) |p| (bun.default_allocator.dupe(u8, p) catch bun.outOfMemory()) else null,
                .server_name = server_name,
                .socket_context = socket_context, // owns the socket context
            });
            socket.ref();
            SocketType.js.dataSetCached(socket.getThisValue(globalObject), globalObject, default_data);
            socket.flags.allow_half_open = socket_config.allowHalfOpen;
            socket.doConnect(connection) catch {
                socket.handleConnectError(@intFromEnum(if (port == null) bun.sys.SystemErrno.ENOENT else bun.sys.SystemErrno.ECONNREFUSED));
                return promise_value;
            };

            // if this is from node:net there's surface where the user can .ref() and .deref() before the connection starts. make sure we honor that here.
            // in the Bun.connect path, this will always be true at this point in time.
            if (socket.ref_pollref_on_connect) socket.poll_ref.ref(handlers.vm);

            return promise_value;
        },
    }
}

pub fn getsockname(this: *Listener, globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    if (this.listener != .uws) {
        return .js_undefined;
    }

    const out = callFrame.argumentsAsArray(1)[0];
    const socket = this.listener.uws;

    var buf: [64]u8 = [_]u8{0} ** 64;
    var text_buf: [512]u8 = undefined;
    const address_bytes: []const u8 = socket.getLocalAddress(this.ssl, &buf) catch return .js_undefined;
    const address_zig: std.net.Address = switch (address_bytes.len) {
        4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
        16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
        else => return .js_undefined,
    };
    const family_js = switch (address_bytes.len) {
        4 => bun.String.static("IPv4").toJS(globalThis),
        16 => bun.String.static("IPv6").toJS(globalThis),
        else => return .js_undefined,
    };
    const address_js = ZigString.init(bun.fmt.formatIp(address_zig, &text_buf) catch unreachable).toJS(globalThis);
    const port_js: JSValue = .jsNumber(socket.getLocalPort(this.ssl));

    out.put(globalThis, bun.String.static("family"), family_js);
    out.put(globalThis, bun.String.static("address"), address_js);
    out.put(globalThis, bun.String.static("port"), port_js);
    return .js_undefined;
}

pub fn jsAddServerName(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    JSC.markBinding(@src());

    const arguments = callframe.arguments_old(3);
    if (arguments.len < 3) {
        return global.throwNotEnoughArguments("addServerName", 3, arguments.len);
    }
    const listener = arguments.ptr[0];
    if (listener.as(Listener)) |this| {
        return this.addServerName(global, arguments.ptr[1], arguments.ptr[2]);
    }
    return global.throw("Expected a Listener instance", .{});
}
pub const log = Output.scoped(.Listener, false);

fn isValidPipeName(pipe_name: []const u8) bool {
    if (!Environment.isWindows) {
        return false;
    }
    // check for valid pipe names
    // at minimum we need to have \\.\pipe\ or \\?\pipe\ + 1 char that is not a separator
    return pipe_name.len > 9 and
        NodePath.isSepWindowsT(u8, pipe_name[0]) and
        NodePath.isSepWindowsT(u8, pipe_name[1]) and
        (pipe_name[2] == '.' or pipe_name[2] == '?') and
        NodePath.isSepWindowsT(u8, pipe_name[3]) and
        strings.eql(pipe_name[4..8], "pipe") and
        NodePath.isSepWindowsT(u8, pipe_name[8]) and
        !NodePath.isSepWindowsT(u8, pipe_name[9]);
}

fn normalizePipeName(pipe_name: []const u8, buffer: []u8) ?[]const u8 {
    if (Environment.isWindows) {
        bun.assert(pipe_name.len < buffer.len);
        if (!isValidPipeName(pipe_name)) {
            return null;
        }
        // normalize pipe name with can have mixed slashes
        // pipes are simple and this will be faster than using node:path.resolve()
        // we dont wanna to normalize the pipe name it self only the pipe identifier (//./pipe/, //?/pipe/, etc)
        @memcpy(buffer[0..9], "\\\\.\\pipe\\");
        @memcpy(buffer[9..pipe_name.len], pipe_name[9..]);
        return buffer[0..pipe_name.len];
    } else {
        return null;
    }
}

pub const WindowsNamedPipeListeningContext = if (Environment.isWindows) struct {
    uvPipe: uv.Pipe = std.mem.zeroes(uv.Pipe),
    listener: ?*Listener,
    globalThis: *JSC.JSGlobalObject,
    vm: *JSC.VirtualMachine,
    ctx: ?*BoringSSL.SSL_CTX = null, // server reuses the same ctx
    pub const new = bun.TrivialNew(WindowsNamedPipeListeningContext);

    fn onClientConnect(this: *WindowsNamedPipeListeningContext, status: uv.ReturnCode) void {
        if (status != uv.ReturnCode.zero or this.vm.isShuttingDown() or this.listener == null) {
            // connection dropped or vm is shutting down or we are deiniting/closing
            return;
        }
        const listener = this.listener.?;
        const socket: WindowsNamedPipeContext.SocketType = brk: {
            if (this.ctx) |_| {
                break :brk .{ .tls = Listener.onNamePipeCreated(true, listener) };
            } else {
                break :brk .{ .tcp = Listener.onNamePipeCreated(false, listener) };
            }
        };

        const client = WindowsNamedPipeContext.create(this.globalThis, socket);

        const result = client.named_pipe.getAcceptedBy(&this.uvPipe, this.ctx);
        if (result == .err) {
            // connection dropped
            client.deinit();
        }
    }

    fn onPipeClosed(pipe: *uv.Pipe) callconv(.C) void {
        const this: *WindowsNamedPipeListeningContext = @ptrCast(@alignCast(pipe.data));
        this.deinit();
    }

    pub fn closePipeAndDeinit(this: *WindowsNamedPipeListeningContext) void {
        this.listener = null;
        this.uvPipe.data = this;
        this.uvPipe.close(onPipeClosed);
    }

    pub fn listen(globalThis: *JSC.JSGlobalObject, path: []const u8, backlog: i32, ssl_config: ?JSC.API.ServerConfig.SSLConfig, listener: *Listener) !*WindowsNamedPipeListeningContext {
        const this = WindowsNamedPipeListeningContext.new(.{
            .globalThis = globalThis,
            .vm = globalThis.bunVM(),
            .listener = listener,
        });

        if (ssl_config) |ssl_options| {
            bun.BoringSSL.load();

            const ctx_opts: uws.SocketContext.BunSocketContextOptions = JSC.API.ServerConfig.SSLConfig.asUSockets(ssl_options);
            var err: uws.create_bun_socket_error_t = .none;
            // Create SSL context using uSockets to match behavior of node.js
            const ctx = ctx_opts.createSSLContext(&err) orelse return error.InvalidOptions; // invalid options
            this.ctx = ctx;
        }

        const initResult = this.uvPipe.init(this.vm.uvLoop(), false);
        if (initResult == .err) {
            return error.FailedToInitPipe;
        }
        if (path[path.len - 1] == 0) {
            // is already null terminated
            const slice_z = path[0 .. path.len - 1 :0];
            this.uvPipe.listenNamedPipe(slice_z, backlog, this, onClientConnect).unwrap() catch return error.FailedToBindPipe;
        } else {
            var path_buf: bun.PathBuffer = undefined;
            // we need to null terminate the path
            const len = @min(path.len, path_buf.len - 1);

            @memcpy(path_buf[0..len], path[0..len]);
            path_buf[len] = 0;
            const slice_z = path_buf[0..len :0];
            this.uvPipe.listenNamedPipe(slice_z, backlog, this, onClientConnect).unwrap() catch return error.FailedToBindPipe;
        }
        //TODO: add readableAll and writableAll support if someone needs it
        // if(uv.uv_pipe_chmod(&this.uvPipe, uv.UV_WRITABLE | uv.UV_READABLE) != 0) {
        // this.closePipeAndDeinit();
        // return error.FailedChmodPipe;
        //}

        return this;
    }

    fn runEvent(this: *WindowsNamedPipeListeningContext) void {
        switch (this.task_event) {
            .deinit => {
                this.deinit();
            },
            .none => @panic("Invalid event state"),
        }
    }

    fn deinitInNextTick(this: *WindowsNamedPipeListeningContext) void {
        bun.assert(this.task_event != .deinit);
        this.task_event = .deinit;
        this.vm.enqueueTask(JSC.Task.init(&this.task));
    }

    fn deinit(this: *WindowsNamedPipeListeningContext) void {
        this.listener = null;
        if (this.ctx) |ctx| {
            this.ctx = null;
            BoringSSL.SSL_CTX_free(ctx);
        }
        bun.destroy(this);
    }
} else void;

const default_allocator = bun.default_allocator;
const bun = @import("bun");
const Environment = bun.Environment;

const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const uws = bun.uws;
const ZigString = JSC.ZigString;
const BoringSSL = bun.BoringSSL.c;
const Async = bun.Async;
const uv = bun.windows.libuv;
const Handlers = JSC.API.SocketHandlers;
const TCPSocket = JSC.API.TCPSocket;
const TLSSocket = JSC.API.TLSSocket;
const socket_ = @import("../socket.zig");
const WindowsNamedPipeContext = socket_.WindowsNamedPipeContext;
const SocketConfig = socket_.SocketConfig;
const NodePath = JSC.Node.path;
const NewSocket = socket_.NewSocket;
