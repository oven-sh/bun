//! This is the code for the object returned by Bun.listen().

const Listener = @This();

handlers: Handlers,
listener: ListenerType = .none,

poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
connection: UnixOrHost,
/// Embedded sweep/iteration list-head for every accepted socket on this
/// listener. `group.ext` = `*Listener`, so the dispatch handler recovers us
/// from the socket without a context-ext lookup.
group: uws.SocketGroup = .{},
/// SSL_CTX + handshake policy for accepted sockets. Owned; deinit on close.
secure_ctx: SecureContext.Native = std.mem.zeroes(SecureContext.Native),
/// Heap-allocated `us_ssl_ctx_t` per `addContext()` SNI hostname. The C SNI
/// tree holds borrowed pointers into these; freed in `deinit` after the listen
/// socket closes (which drops the C-side refs first).
sni_contexts: std.ArrayList(*uws.SslCtx) = .empty,
ssl: bool = false,
protos: ?[]const u8 = null,

strong_data: jsc.Strong.Optional = .empty,
strong_self: jsc.Strong.Optional = .empty,

pub const js = jsc.Codegen.JSListener;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const ListenerType = union(enum) {
    uws: *uws.ListenSocket,
    namedPipe: *WindowsNamedPipeListeningContext,
    none: void,
};

pub fn getData(this: *Listener, _: *jsc.JSGlobalObject) JSValue {
    log("getData()", .{});
    return this.strong_data.get() orelse .js_undefined;
}

pub fn setData(this: *Listener, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    log("setData()", .{});
    this.strong_data.set(globalObject, value);
}

pub const UnixOrHost = union(enum) {
    unix: []const u8,
    host: struct {
        host: []const u8,
        port: u16,
    },
    fd: bun.FD,

    pub fn clone(this: UnixOrHost) UnixOrHost {
        switch (this) {
            .unix => |u| {
                return .{
                    .unix = bun.handleOom(bun.default_allocator.dupe(u8, u)),
                };
            },
            .host => |h| {
                return .{
                    .host = .{
                        .host = bun.handleOom(bun.default_allocator.dupe(u8, h.host)),
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

pub fn reload(this: *Listener, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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

    const handlers = try Handlers.fromJS(globalObject, socket_obj, this.handlers.mode == .server);
    // Preserve the live connection count across the struct assignment. `Handlers.fromJS`
    // returns `active_connections = 0`, but existing accepted sockets each hold a +1 via
    // `markActive`. Without this, closing any of them after reload would underflow the
    // counter (panic in safe builds, wrap in release).
    const active_connections = this.handlers.active_connections;
    this.handlers.deinit();
    this.handlers = handlers;
    this.handlers.active_connections = active_connections;

    return .js_undefined;
}

pub fn listen(globalObject: *jsc.JSGlobalObject, opts: JSValue) bun.JSError!JSValue {
    log("listen", .{});
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected object", .{});
    }

    const vm = jsc.VirtualMachine.get();

    var socket_config = try SocketConfig.fromJS(vm, opts, globalObject, true);
    defer socket_config.deinitExcludingHandlers();

    const handlers = &socket_config.handlers;
    // Only deinit handlers if there's an error; otherwise we put them in a `Listener` and
    // need them to stay alive.
    errdefer handlers.deinit();

    const hostname_or_unix = &socket_config.hostname_or_unix;
    const port = socket_config.port;
    const ssl = if (socket_config.ssl) |*ssl| ssl else null;
    const ssl_enabled = ssl != null;
    const socket_flags = socket_config.socketFlags();

    if (Environment.isWindows and port == null) {
        // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
        var buf: bun.PathBuffer = undefined;
        if (normalizePipeName(hostname_or_unix.slice(), buf[0..])) |pipe_name| {
            const connection: Listener.UnixOrHost = .{
                .unix = bun.handleOom(hostname_or_unix.intoOwnedSlice(bun.default_allocator)),
            };

            var socket: Listener = .{
                .handlers = handlers.*,
                .connection = connection,
                .ssl = ssl_enabled,
                .listener = .none,
                .protos = if (ssl) |s| s.takeProtos() else null,
            };

            vm.eventLoop().ensureWaker();

            if (socket_config.default_data != .zero) {
                socket.strong_data = .create(socket_config.default_data, globalObject);
            }

            const this: *Listener = bun.handleOom(handlers.vm.allocator.create(Listener));
            this.* = socket;
            // TODO: server_name is not supported on named pipes, I belive its , lets wait for
            // someone to ask for it

            // On error, clean up everything `this` owns *except* `this.handlers`: the outer
            // `errdefer handlers.deinit()` already unprotects those JSValues, and `this.handlers`
            // is a by-value copy of the same struct, so calling `this.deinit()` here would
            // unprotect the same callbacks a second time.
            errdefer {
                this.strong_data.deinit();
                this.connection.deinit();
                if (this.protos) |protos| bun.default_allocator.free(protos);
                handlers.vm.allocator.destroy(this);
            }

            // we need to add support for the backlog parameter on listen here we use the
            // default value of nodejs
            const named_pipe = WindowsNamedPipeListeningContext.listen(
                globalObject,
                pipe_name,
                511,
                ssl,
                this,
            ) catch return globalObject.throwInvalidArguments(
                "Failed to listen at {s}",
                .{pipe_name},
            );
            this.listener = .{ .namedPipe = named_pipe };

            const this_value = this.toJS(globalObject);
            this.strong_self.set(globalObject, this_value);
            this.poll_ref.ref(handlers.vm);
            return this_value;
        }
    }

    vm.eventLoop().ensureWaker();

    // Allocate the Listener up front so the embedded `group` has its final
    // address before we hand it to listen() (it's linked into the loop's
    // intrusive list).
    var this: *Listener = bun.handleOom(handlers.vm.allocator.create(Listener));
    this.* = .{
        .handlers = handlers.*,
        .connection = undefined, // set after listen succeeds
        .ssl = ssl_enabled,
        .protos = if (ssl) |s| s.takeProtos() else null,
    };
    this.group.init(uws.Loop.get(), null, this);
    var listener_allocated = true;
    errdefer if (listener_allocated) {
        if (this.secure_ctx.ssl_ctx != null) this.secure_ctx.deinit();
        if (this.protos) |p| bun.default_allocator.free(p);
        this.group.deinit();
        handlers.vm.allocator.destroy(this);
    };

    if (ssl) |ssl_cfg| {
        var create_err: uws.create_bun_socket_error_t = .none;
        this.secure_ctx = ssl_cfg.asUSockets().createSSLContext(false, &create_err) orelse {
            return globalObject.throwValue(create_err.toJS(globalObject));
        };
    }
    const ssl_ctx: ?*uws.SslCtx = if (ssl_enabled) &this.secure_ctx else null;
    const kind: uws.SocketKind = if (ssl_enabled) .bun_listener_tls else .bun_listener_tcp;

    const hostname = bun.handleOom(hostname_or_unix.intoOwnedSlice(bun.default_allocator));
    errdefer bun.default_allocator.free(hostname);
    var connection: Listener.UnixOrHost = if (port) |port_| .{
        .host = .{ .host = hostname, .port = port_ },
    } else if (socket_config.fd) |fd| .{ .fd = fd } else .{ .unix = hostname };

    var errno: c_int = 0;
    const listen_socket: *uws.ListenSocket = brk: {
        switch (connection) {
            .host => |host| {
                const hostz = bun.handleOom(bun.default_allocator.dupeZ(u8, host.host));
                defer bun.default_allocator.free(hostz);
                const ls = this.group.listen(kind, ssl_ctx, hostz.ptr, host.port, socket_flags, @sizeOf(?*anyopaque), &errno);
                if (ls) |s| connection.host.port = @intCast(s.getLocalPort());
                break :brk ls;
            },
            .unix => |u| {
                const pathz = bun.handleOom(bun.default_allocator.dupeZ(u8, u));
                defer bun.default_allocator.free(pathz);
                break :brk this.group.listenUnix(kind, ssl_ctx, pathz.ptr, pathz.len, socket_flags, @sizeOf(?*anyopaque), &errno);
            },
            .fd => |fd| {
                const err: bun.jsc.SystemError = .{
                    .errno = @intFromEnum(bun.sys.SystemErrno.EINVAL),
                    .code = .static("EINVAL"),
                    .message = .static("Bun does not support listening on a file descriptor."),
                    .syscall = .static("listen"),
                    .fd = fd.uv(),
                };
                return globalObject.throwValue(err.toErrorInstance(globalObject));
            },
        }
    } orelse {
        const err = globalObject.createErrorInstance("Failed to listen at {s}", .{hostname});
        log("Failed to listen {d}", .{errno});
        if (errno != 0) {
            err.put(globalObject, ZigString.static("syscall"), try bun.String.createUTF8ForJS(globalObject, "listen"));
            err.put(globalObject, ZigString.static("errno"), JSValue.jsNumber(errno));
            err.put(globalObject, ZigString.static("address"), ZigString.initUTF8(hostname).toJS(globalObject));
            if (port) |p| err.put(globalObject, ZigString.static("port"), .jsNumber(p));
            if (bun.sys.SystemErrno.init(errno)) |str| {
                err.put(globalObject, ZigString.static("code"), ZigString.init(@tagName(str)).toJS(globalObject));
            }
        }
        return globalObject.throwValue(err);
    };

    this.connection = connection;
    this.listener = .{ .uws = listen_socket };
    if (socket_config.default_data != .zero) {
        this.strong_data = .create(socket_config.default_data, globalObject);
    }

    if (ssl) |ssl_config| {
        if (ssl_config.server_name) |server_name| {
            if (std.mem.span(server_name).len > 0) {
                _ = listen_socket.addServerName(server_name, &this.secure_ctx, null);
            }
        }
    }

    listener_allocated = false; // ownership now on `this`; deinit handles cleanup
    const this_value = this.toJS(globalObject);
    this.strong_self.set(globalObject, this_value);
    this.poll_ref.ref(handlers.vm);

    return this_value;
}

pub fn constructor(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*Listener {
    return globalObject.throw("Cannot construct Listener", .{});
}

pub fn onNamePipeCreated(comptime ssl: bool, listener: *Listener) *NewSocket(ssl) {
    const Socket = NewSocket(ssl);
    bun.assert(ssl == listener.ssl);

    var this_socket = Socket.new(.{
        .ref_count = .init(),
        .handlers = &listener.handlers,
        .socket = Socket.Socket.detached,
        .protos = listener.protos,
        .flags = .{ .owned_protos = false },
    });
    this_socket.ref();
    if (listener.strong_data.get()) |default_data| {
        const globalObject = listener.handlers.globalObject;
        Socket.js.dataSetCached(this_socket.getThisValue(globalObject), globalObject, default_data);
    }
    return this_socket;
}

/// Called from `dispatch.zig` `BunListener.onOpen` for every accepted socket.
/// Allocates the `NewSocket` wrapper, stashes it in the socket ext, then
/// re-stamps the kind to `.bun_socket_{tcp,tls}` so subsequent events route
/// straight to `BunSocket` (the listener arm only fires once per accept).
pub fn onCreate(comptime ssl: bool, listener: *Listener, socket: uws.NewSocketHandler(ssl)) void {
    jsc.markBinding(@src());
    log("onCreate", .{});

    const Socket = NewSocket(ssl);
    bun.assert(ssl == listener.ssl);

    const this_socket = bun.new(Socket, .{
        .ref_count = .init(),
        .handlers = &listener.handlers,
        .socket = socket,
        .protos = listener.protos,
        .flags = .{ .owned_protos = false },
    });
    this_socket.ref();
    if (listener.strong_data.get()) |default_data| {
        const globalObject = listener.handlers.globalObject;
        Socket.js.dataSetCached(this_socket.getThisValue(globalObject), globalObject, default_data);
    }
    if (socket.ext(**anyopaque)) |ctx| {
        ctx.* = bun.cast(**anyopaque, this_socket);
    }
    socket.socket.connected.setKind(if (ssl) .bun_socket_tls else .bun_socket_tcp);
    socket.setTimeout(120);
}

pub fn addServerName(this: *Listener, global: *jsc.JSGlobalObject, hostname: JSValue, tls: JSValue) bun.JSError!JSValue {
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
    const server_name = bun.handleOom(bun.default_allocator.dupeZ(u8, host_str.slice()));
    defer bun.default_allocator.free(server_name);
    if (server_name.len == 0) {
        return global.throwInvalidArguments("hostname pattern cannot be empty", .{});
    }

    if (this.listener != .uws) return .js_undefined;
    const ls = this.listener.uws;

    if (try SSLConfig.fromJS(jsc.VirtualMachine.get(), global, tls)) |ssl_config| {
        var cfg = ssl_config;
        defer cfg.deinit();
        var create_err: uws.create_bun_socket_error_t = .none;
        // The SNI tree stores a `us_ssl_ctx_t*` (not a bare SSL_CTX*), so the
        // wrapper must outlive this call. Heap-allocate and let the listener's
        // `sni_contexts` own it; the C side bumps `ref_count` and the deinit
        // path drops it when the listen socket closes.
        const sni_ctx = bun.new(uws.SslCtx, cfg.asUSockets().createSSLContext(false, &create_err) orelse {
            return global.throwValue(create_err.toJS(global));
        });
        bun.handleOom(this.sni_contexts.append(bun.default_allocator, sni_ctx));
        ls.removeServerName(server_name);
        _ = ls.addServerName(server_name, sni_ctx, null);
    }

    return .js_undefined;
}

pub fn dispose(this: *Listener, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.doStop(true);
    return .js_undefined;
}

pub fn stop(this: *Listener, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(1);
    log("close", .{});

    this.doStop(if (arguments.len > 0 and arguments.ptr[0].isBoolean()) arguments.ptr[0].toBoolean() else false);

    return .js_undefined;
}

fn doStop(this: *Listener, force_close: bool) void {
    if (this.listener == .none) return;
    const listener = this.listener;

    if (listener == .uws) this.unlinkUnixSocketPath();

    defer switch (listener) {
        .uws => |socket| socket.close(),
        .namedPipe => |namedPipe| if (Environment.isWindows) namedPipe.closePipeAndDeinit(),
        .none => {},
    };
    this.listener = .none;

    if (this.handlers.active_connections == 0) {
        this.poll_ref.unref(this.handlers.vm);
        this.strong_self.clearWithoutDeallocation();
        this.strong_data.clearWithoutDeallocation();
    } else if (force_close) {
        this.group.closeAll();
    }
}

pub fn finalize(this: *Listener) callconv(.c) void {
    log("finalize", .{});
    const listener = this.listener;
    this.listener = .none;
    switch (listener) {
        .uws => |socket| {
            this.unlinkUnixSocketPath();
            socket.close();
        },
        .namedPipe => |namedPipe| if (Environment.isWindows) namedPipe.closePipeAndDeinit(),
        .none => {},
    }
    this.deinit();
}

/// Match Node.js/libuv: unlink the unix socket file before closing the listening fd.
/// Unlinking after close would race with another process creating a socket at the same path.
fn unlinkUnixSocketPath(this: *const Listener) void {
    if (this.connection != .unix) return;
    const path = this.connection.unix;
    // Abstract sockets (Linux) start with a NUL byte and have no filesystem entry.
    if (path.len == 0 or path[0] == 0) return;
    const buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(buf);
    _ = bun.sys.unlink(bun.path.z(path, buf));
}

pub fn deinit(this: *Listener) void {
    log("deinit", .{});
    this.strong_self.deinit();
    this.strong_data.deinit();
    const vm = this.handlers.vm;
    this.poll_ref.unref(vm);
    bun.assert(this.listener == .none);

    // Any still-open accepted sockets hold a `&listener.handlers` pointer, so
    // we cannot free `this` while they're alive. Force-close them; their
    // onClose paths will markInactive against handlers we drop right after.
    if (this.handlers.active_connections > 0) {
        this.group.closeAll();
    }
    this.group.deinit();
    if (this.secure_ctx.ssl_ctx != null) this.secure_ctx.deinit();
    for (this.sni_contexts.items) |ctx| {
        ctx.deinit();
        bun.destroy(ctx);
    }
    this.sni_contexts.deinit(bun.default_allocator);

    this.connection.deinit();
    if (this.protos) |protos| {
        this.protos = null;
        bun.default_allocator.free(protos);
    }
    this.handlers.deinit();
    vm.allocator.destroy(this);
}

pub fn getConnectionsCount(this: *Listener, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.handlers.active_connections);
}

pub fn getUnix(this: *Listener, globalObject: *jsc.JSGlobalObject) JSValue {
    if (this.connection != .unix) {
        return .js_undefined;
    }

    return ZigString.init(this.connection.unix).withEncoding().toJS(globalObject);
}

pub fn getHostname(this: *Listener, globalObject: *jsc.JSGlobalObject) JSValue {
    if (this.connection != .host) {
        return .js_undefined;
    }
    return ZigString.init(this.connection.host.host).withEncoding().toJS(globalObject);
}

pub fn getPort(this: *Listener, _: *jsc.JSGlobalObject) JSValue {
    if (this.connection != .host) {
        return .js_undefined;
    }
    return JSValue.jsNumber(this.connection.host.port);
}

pub fn getFD(this: *Listener, _: *jsc.JSGlobalObject) JSValue {
    switch (this.listener) {
        .uws => |uws_listener| {
            return uws_listener.socket(false).fd().toJSWithoutMakingLibUVOwned();
        },
        else => return JSValue.jsNumber(-1),
    }
}

pub fn ref(this: *Listener, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const this_value = callframe.this();
    if (this.listener == .none) return .js_undefined;
    this.poll_ref.ref(globalObject.bunVM());
    this.strong_self.set(globalObject, this_value);
    return .js_undefined;
}

pub fn unref(this: *Listener, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.poll_ref.unref(globalObject.bunVM());
    if (this.handlers.active_connections == 0) {
        this.strong_self.clearWithoutDeallocation();
    }
    return .js_undefined;
}

pub fn connect(globalObject: *jsc.JSGlobalObject, opts: JSValue) bun.JSError!JSValue {
    return connectInner(globalObject, null, null, opts);
}

pub fn connectInner(globalObject: *jsc.JSGlobalObject, prev_maybe_tcp: ?*TCPSocket, prev_maybe_tls: ?*TLSSocket, opts: JSValue) bun.JSError!JSValue {
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throwInvalidArguments("Expected options object", .{});
    }
    const vm = globalObject.bunVM();

    var socket_config = try SocketConfig.fromJS(vm, opts, globalObject, true);
    defer socket_config.deinitExcludingHandlers();

    const handlers = &socket_config.handlers;
    // Only deinit handlers if there's an error; otherwise we put them in a `TCPSocket` or
    // `TLSSocket` and need them to stay alive.
    errdefer handlers.deinit();

    const hostname_or_unix = &socket_config.hostname_or_unix;
    const port = socket_config.port;
    const ssl = if (socket_config.ssl) |*ssl| ssl else null;
    const ssl_enabled = ssl != null;
    const default_data = socket_config.default_data;

    vm.eventLoop().ensureWaker();

    var connection: Listener.UnixOrHost = blk: {
        if (try opts.getTruthy(globalObject, "fd")) |fd_| {
            if (fd_.isNumber()) {
                const fd = fd_.asFileDescriptor();
                break :blk .{ .fd = fd };
            }
        }
        const host = bun.handleOom(hostname_or_unix.intoOwnedSlice(bun.default_allocator));
        break :blk if (port) |port_| .{
            .host = .{
                .host = host,
                .port = port_,
            },
        } else .{ .unix = host };
    };
    errdefer connection.deinit();

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
                        connection.fd = bun.FD.fromNative(osfd).makeLibUVOwned() catch
                            @panic("failed to allocate file descriptor");
                        break :brk true;
                    }
                }
                break :brk false;
            },
            else => false,
        };
        if (isNamedPipe) {
            default_data.ensureStillAlive();

            const handlers_ptr = bun.handleOom(handlers.vm.allocator.create(Handlers));
            handlers_ptr.* = handlers.*;

            var promise = jsc.JSPromise.create(globalObject);
            const promise_value = promise.toJS();
            handlers_ptr.promise.set(globalObject, promise_value);

            if (ssl_enabled) {
                var tls = if (prev_maybe_tls) |prev| blk: {
                    if (prev.handlers) |prev_handlers| {
                        prev_handlers.deinit();
                        handlers.vm.allocator.destroy(prev_handlers);
                    }
                    bun.assert(prev.this_value.isNotEmpty());
                    prev.handlers = handlers_ptr;
                    bun.assert(prev.socket.socket == .detached);
                    // Free old resources before reassignment to prevent memory leaks
                    // when sockets are reused for reconnection (common with MongoDB driver)
                    if (prev.connection) |old_connection| {
                        old_connection.deinit();
                    }
                    prev.connection = connection;
                    if (prev.flags.owned_protos) {
                        if (prev.protos) |old_protos| {
                            bun.default_allocator.free(old_protos);
                        }
                    }
                    prev.protos = if (ssl) |s| s.takeProtos() else null;
                    if (prev.server_name) |old_server_name| {
                        bun.default_allocator.free(old_server_name);
                    }
                    prev.server_name = if (ssl) |s| s.takeServerName() else null;
                    break :blk prev;
                } else TLSSocket.new(.{
                    .ref_count = .init(),
                    .handlers = handlers_ptr,
                    .socket = TLSSocket.Socket.detached,
                    .connection = connection,
                    .protos = if (ssl) |s| s.takeProtos() else null,
                    .server_name = if (ssl) |s| s.takeServerName() else null,
                });

                TLSSocket.js.dataSetCached(tls.getThisValue(globalObject), globalObject, default_data);
                tls.poll_ref.ref(handlers.vm);
                tls.ref();

                const named_pipe = switch (connection) {
                    .unix => WindowsNamedPipeContext.connect(
                        globalObject,
                        pipe_name.?,
                        if (ssl) |s| s.* else null,
                        .{ .tls = tls },
                    ) catch return promise_value,
                    .fd => |fd| WindowsNamedPipeContext.open(
                        globalObject,
                        fd,
                        if (ssl) |s| s.* else null,
                        .{ .tls = tls },
                    ) catch return promise_value,
                    else => unreachable,
                };
                tls.socket = TLSSocket.Socket.fromNamedPipe(named_pipe);
            } else {
                var tcp = if (prev_maybe_tcp) |prev| blk: {
                    bun.assert(prev.this_value.isNotEmpty());
                    if (prev.handlers) |prev_handlers| {
                        prev_handlers.deinit();
                        handlers.vm.allocator.destroy(prev_handlers);
                    }
                    prev.handlers = handlers_ptr;
                    bun.assert(prev.socket.socket == .detached);
                    bun.assert(prev.connection == null);
                    bun.assert(prev.protos == null);
                    bun.assert(prev.server_name == null);
                    break :blk prev;
                } else TCPSocket.new(.{
                    .ref_count = .init(),
                    .handlers = handlers_ptr,
                    .socket = TCPSocket.Socket.detached,
                    .connection = null,
                    .protos = null,
                    .server_name = null,
                });
                tcp.ref();
                TCPSocket.js.dataSetCached(tcp.getThisValue(globalObject), globalObject, default_data);
                tcp.poll_ref.ref(handlers.vm);

                const named_pipe = switch (connection) {
                    .unix => WindowsNamedPipeContext.connect(
                        globalObject,
                        pipe_name.?,
                        null,
                        .{ .tcp = tcp },
                    ) catch return promise_value,
                    .fd => |fd| WindowsNamedPipeContext.open(
                        globalObject,
                        fd,
                        null,
                        .{ .tcp = tcp },
                    ) catch return promise_value,
                    else => unreachable,
                };
                tcp.socket = TCPSocket.Socket.fromNamedPipe(named_pipe);
            }
            return promise_value;
        }
    }

    // Build the SSL_CTX once here (or pull it from a passed SecureContext);
    // doConnect hands `&socket.owned_ssl_ctx` to the per-VM connect group.
    var owned_ssl_ctx = std.mem.zeroes(uws.SslCtx);
    if (ssl_enabled) {
        // node:tls passes the native SecureContext as `tls.secureContext` so
        // we share its already-built SSL_CTX (CA bundle, cert chain, ciphers)
        // instead of rebuilding ~50 KB of BoringSSL state per connect. The
        // borrow up_ref()s the SSL_CTX*; the SecureContext can be GC'd while
        // the connection is alive without taking the cert store with it.
        const native_sc: ?*SecureContext = blk: {
            const tls_js = (try opts.getTruthy(globalObject, "tls")) orelse break :blk null;
            if (!tls_js.isObject()) break :blk null;
            const sc_js = (try tls_js.getTruthy(globalObject, "secureContext")) orelse break :blk null;
            break :blk SecureContext.fromJS(sc_js);
        };
        if (native_sc) |sc| {
            owned_ssl_ctx = uws.SslCtx.initBorrowed(sc.handle());
            // Per-connection policy can diverge from the cached context's
            // (e.g. `rejectUnauthorized: false` on this connect only).
            if (ssl) |ssl_cfg| {
                owned_ssl_ctx.reject_unauthorized = @intFromBool(ssl_cfg.reject_unauthorized != 0);
                owned_ssl_ctx.request_cert = @intFromBool(ssl_cfg.request_cert != 0);
            }
            owned_ssl_ctx.is_client = 1;
        } else if (ssl) |ssl_cfg| {
            var create_err: uws.create_bun_socket_error_t = .none;
            owned_ssl_ctx = ssl_cfg.asUSockets().createSSLContext(true, &create_err) orelse {
                return globalObject.throwValue(create_err.toJS(globalObject));
            };
        }
    }
    errdefer if (owned_ssl_ctx.ssl_ctx != null) owned_ssl_ctx.deinit();

    default_data.ensureStillAlive();

    const handlers_ptr = bun.handleOom(handlers.vm.allocator.create(Handlers));
    handlers_ptr.* = handlers.*;
    handlers_ptr.mode = .client;

    var promise = jsc.JSPromise.create(globalObject);
    const promise_value = promise.toJS();
    handlers_ptr.promise.set(globalObject, promise_value);

    switch (ssl_enabled) {
        inline else => |is_ssl_enabled| {
            const SocketType = NewSocket(is_ssl_enabled);
            const maybe_previous: ?*SocketType = if (is_ssl_enabled)
                prev_maybe_tls
            else
                prev_maybe_tcp;

            const socket = if (maybe_previous) |prev| blk: {
                bun.assert(prev.this_value.isNotEmpty());
                if (prev.handlers) |prev_handlers| {
                    prev_handlers.deinit();
                    handlers.vm.allocator.destroy(prev_handlers);
                }
                prev.handlers = handlers_ptr;
                bun.assert(prev.socket.socket == .detached);
                // Free old resources before reassignment to prevent memory leaks
                // when sockets are reused for reconnection (common with MongoDB driver)
                if (prev.connection) |old_connection| {
                    old_connection.deinit();
                }
                prev.connection = connection;
                if (prev.flags.owned_protos) {
                    if (prev.protos) |old_protos| {
                        bun.default_allocator.free(old_protos);
                    }
                }
                prev.protos = if (ssl) |s| s.takeProtos() else null;
                if (prev.server_name) |old_server_name| {
                    bun.default_allocator.free(old_server_name);
                }
                prev.server_name = if (ssl) |s| s.takeServerName() else null;
                if (prev.owned_ssl_ctx.ssl_ctx != null) prev.owned_ssl_ctx.deinit();
                prev.owned_ssl_ctx = owned_ssl_ctx;
                break :blk prev;
            } else bun.new(SocketType, .{
                .ref_count = .init(),
                .handlers = handlers_ptr,
                .socket = SocketType.Socket.detached,
                .connection = connection,
                .protos = if (ssl) |s| s.takeProtos() else null,
                .server_name = if (ssl) |s| s.takeServerName() else null,
                .owned_ssl_ctx = owned_ssl_ctx,
            });
            // Ownership moved into `socket`; disarm the errdefer.
            owned_ssl_ctx = std.mem.zeroes(uws.SslCtx);
            socket.ref();
            SocketType.js.dataSetCached(socket.getThisValue(globalObject), globalObject, default_data);
            socket.flags.allow_half_open = socket_config.allowHalfOpen;
            socket.doConnect(connection) catch {
                socket.handleConnectError(@intFromEnum(if (port == null) bun.sys.SystemErrno.ENOENT else bun.sys.SystemErrno.ECONNREFUSED)) catch {};
                if (maybe_previous == null) socket.deref();
                return promise_value;
            };

            // if this is from node:net there's surface where the user can .ref() and .deref()
            // before the connection starts. make sure we honor that here.
            // in the Bun.connect path, this will always be true at this point in time.
            if (socket.ref_pollref_on_connect) socket.poll_ref.ref(handlers.vm);

            return promise_value;
        },
    }
}

pub fn getsockname(this: *Listener, globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    if (this.listener != .uws) {
        return .js_undefined;
    }

    const out = callFrame.argumentsAsArray(1)[0];
    if (!out.isObject()) {
        return globalThis.throwInvalidArguments("Expected object", .{});
    }
    const socket = this.listener.uws;

    var buf: [64]u8 = [_]u8{0} ** 64;
    var text_buf: [512]u8 = undefined;
    const address_bytes: []const u8 = socket.getLocalAddress(&buf) catch return .js_undefined;
    const address_zig: std.net.Address = switch (address_bytes.len) {
        4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
        16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
        else => return .js_undefined,
    };
    const family_js = switch (address_bytes.len) {
        4 => try bun.String.static("IPv4").toJS(globalThis),
        16 => try bun.String.static("IPv6").toJS(globalThis),
        else => return .js_undefined,
    };
    const address_js = ZigString.init(bun.fmt.formatIp(address_zig, &text_buf) catch unreachable).toJS(globalThis);
    const port_js: JSValue = .jsNumber(socket.getLocalPort());

    out.put(globalThis, bun.String.static("family"), family_js);
    out.put(globalThis, bun.String.static("address"), address_js);
    out.put(globalThis, bun.String.static("port"), port_js);
    return .js_undefined;
}

pub fn jsAddServerName(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

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
pub const log = Output.scoped(.Listener, .visible);

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
    globalThis: *jsc.JSGlobalObject,
    vm: *jsc.VirtualMachine,
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

    fn onPipeClosed(pipe: *uv.Pipe) callconv(.c) void {
        const this: *WindowsNamedPipeListeningContext = @ptrCast(@alignCast(pipe.data));
        this.deinit();
    }

    pub fn closePipeAndDeinit(this: *WindowsNamedPipeListeningContext) void {
        this.listener = null;
        this.uvPipe.data = this;
        this.uvPipe.close(onPipeClosed);
    }

    pub fn listen(
        globalThis: *jsc.JSGlobalObject,
        path: []const u8,
        backlog: i32,
        ssl_config: ?*const SSLConfig,
        listener: *Listener,
    ) !*WindowsNamedPipeListeningContext {
        const this = WindowsNamedPipeListeningContext.new(.{
            .globalThis = globalThis,
            .vm = globalThis.bunVM(),
            .listener = listener,
        });
        var pipe_initialized = false;
        errdefer {
            // Once the uv pipe handle is registered with the loop it must be closed via
            // uv_close; before that point we can free the struct directly. `deinit()` also
            // frees the SSL context if one was created.
            if (pipe_initialized) this.closePipeAndDeinit() else this.deinit();
        }

        if (ssl_config) |ssl_options| {
            bun.BoringSSL.load();

            const ctx_opts: uws.SocketContext.BunSocketContextOptions = ssl_options.asUSockets();
            var err: uws.create_bun_socket_error_t = .none;
            // Create SSL context using uSockets to match behavior of node.js
            const ctx = ctx_opts.createSSLContext(&err) orelse return error.InvalidOptions; // invalid options
            this.ctx = ctx;
        }

        const initResult = this.uvPipe.init(this.vm.uvLoop(), false);
        if (initResult == .err) {
            return error.FailedToInitPipe;
        }
        pipe_initialized = true;
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
        this.vm.enqueueTask(jsc.Task.init(&this.task));
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;
const uv = bun.windows.libuv;

const api = bun.api;
const Handlers = bun.api.SocketHandlers;
const TCPSocket = bun.api.TCPSocket;
const TLSSocket = bun.api.TLSSocket;
const SSLConfig = bun.api.ServerConfig.SSLConfig;
const SecureContext = bun.api.SecureContext;

const NewSocket = api.socket.NewSocket;
const SocketConfig = api.socket.SocketConfig;
const WindowsNamedPipeContext = api.socket.WindowsNamedPipeContext;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const NodePath = jsc.Node.path;
