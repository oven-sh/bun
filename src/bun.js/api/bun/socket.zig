pub const SocketAddress = @import("./socket/SocketAddress.zig");

const WrappedType = enum {
    none,
    tls,
    tcp,
};

fn JSSocketType(comptime ssl: bool) type {
    if (!ssl) {
        return jsc.Codegen.JSTCPSocket;
    } else {
        return jsc.Codegen.JSTLSSocket;
    }
}

fn selectALPNCallback(_: ?*BoringSSL.SSL, out: [*c][*c]const u8, outlen: [*c]u8, in: [*c]const u8, inlen: c_uint, arg: ?*anyopaque) callconv(.c) c_int {
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
        return if (status == BoringSSL.OPENSSL_NPN_NEGOTIATED) BoringSSL.SSL_TLSEXT_ERR_OK else BoringSSL.SSL_TLSEXT_ERR_ALERT_FATAL;
    } else {
        return BoringSSL.SSL_TLSEXT_ERR_NOACK;
    }
}

pub const Handlers = @import("./socket/Handlers.zig");
pub const SocketConfig = Handlers.SocketConfig;

pub const Listener = @import("./socket/Listener.zig");
pub const WindowsNamedPipeContext = if (Environment.isWindows) @import("./socket/WindowsNamedPipeContext.zig") else void;

pub fn NewSocket(comptime ssl: bool) type {
    return struct {
        const This = @This();
        pub const js = if (!ssl) jsc.Codegen.JSTCPSocket else jsc.Codegen.JSTLSSocket;
        pub const toJS = js.toJS;
        pub const fromJS = js.fromJS;
        pub const fromJSDirect = js.fromJSDirect;

        pub const new = bun.TrivialNew(@This());

        const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;

        pub const Socket = uws.NewSocketHandler(ssl);
        socket: Socket,
        // if the socket owns a context it will be here
        socket_context: ?*uws.SocketContext,

        flags: Flags = .{},
        ref_count: RefCount,
        wrapped: WrappedType = .none,
        handlers: ?*Handlers,
        this_value: jsc.JSValue = .zero,
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
        ref_pollref_on_connect: bool = true,
        connection: ?Listener.UnixOrHost = null,
        protos: ?[]const u8,
        server_name: ?[]const u8 = null,
        buffered_data_for_node_net: bun.ByteList = .{},
        bytes_written: u64 = 0,

        // TODO: switch to something that uses `visitAggregate` and have the
        // `Listener` keep a list of all the sockets JSValue in there
        // This is wasteful because it means we are keeping a JSC::Weak for every single open socket
        has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),
        native_callback: NativeCallbacks = .none,

        pub fn hasPendingActivity(this: *This) callconv(.c) bool {
            return this.has_pending_activity.load(.acquire);
        }

        pub fn memoryCost(this: *This) usize {
            return @sizeOf(This) + this.buffered_data_for_node_net.cap;
        }

        pub fn attachNativeCallback(this: *This, callback: NativeCallbacks) bool {
            if (this.native_callback != .none) return false;
            this.native_callback = callback;

            switch (callback) {
                .h2 => |h2| h2.ref(),
                .none => {},
            }
            return true;
        }

        pub fn detachNativeCallback(this: *This) void {
            const native_callback = this.native_callback;
            this.native_callback = .none;

            switch (native_callback) {
                .h2 => |h2| {
                    h2.onNativeClose();
                    h2.deref();
                },
                .none => {},
            }
        }

        pub fn doConnect(this: *This, connection: Listener.UnixOrHost) !void {
            bun.assert(this.socket_context != null);
            this.ref();
            defer this.deref();

            switch (connection) {
                .host => |c| {
                    this.socket = try This.Socket.connectAnon(
                        c.host,
                        c.port,
                        this.socket_context.?,
                        this,
                        this.flags.allow_half_open,
                    );
                },
                .unix => |u| {
                    this.socket = try This.Socket.connectUnixAnon(
                        u,
                        this.socket_context.?,
                        this,
                        this.flags.allow_half_open,
                    );
                },
                .fd => |f| {
                    const socket = This.Socket.fromFd(this.socket_context.?, f, This, this, null, false) orelse return error.ConnectionFailed;
                    this.onOpen(socket);
                },
            }
        }

        pub fn constructor(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*This {
            return globalObject.throw("Cannot construct Socket", .{});
        }

        pub fn resumeFromJS(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) return .js_undefined;

            log("resume", .{});
            // we should not allow pausing/resuming a wrapped socket because a wrapped socket is 2 sockets and this can cause issues
            if (this.wrapped == .none and this.flags.is_paused) {
                this.flags.is_paused = !this.socket.resumeStream();
            }
            return .js_undefined;
        }

        pub fn pauseFromJS(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) return .js_undefined;

            log("pause", .{});
            // we should not allow pausing/resuming a wrapped socket because a wrapped socket is 2 sockets and this can cause issues
            if (this.wrapped == .none and !this.flags.is_paused) {
                this.flags.is_paused = this.socket.pauseStream();
            }

            return .js_undefined;
        }

        pub fn setKeepAlive(this: *This, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments_old(2);

            const enabled: bool = brk: {
                if (args.len >= 1) {
                    break :brk args.ptr[0].toBoolean();
                }
                break :brk false;
            };

            const initialDelay: u32 = brk: {
                if (args.len > 1) {
                    break :brk @intCast(try globalThis.validateIntegerRange(args.ptr[1], i32, 0, .{ .min = 0, .field_name = "initialDelay" }));
                }
                break :brk 0;
            };
            log("setKeepAlive({}, {})", .{ enabled, initialDelay });

            return JSValue.jsBoolean(this.socket.setKeepAlive(enabled, initialDelay));
        }

        pub fn setNoDelay(this: *This, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            _ = globalThis;

            const args = callframe.arguments_old(1);
            const enabled: bool = brk: {
                if (args.len >= 1) {
                    break :brk args.ptr[0].toBoolean();
                }
                break :brk true;
            };
            log("setNoDelay({})", .{enabled});

            return JSValue.jsBoolean(this.socket.setNoDelay(enabled));
        }

        pub fn handleError(this: *This, err_value: jsc.JSValue) void {
            log("handleError", .{});
            const handlers = this.getHandlers();
            var vm = handlers.vm;
            if (vm.isShuttingDown()) {
                return;
            }
            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();
            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            _ = handlers.callErrorHandler(this_value, &.{ this_value, err_value });
        }

        pub fn onWritable(this: *This, _: Socket) void {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) return;
            if (this.native_callback.onWritable()) return;
            const handlers = this.getHandlers();
            const callback = handlers.onWritable;
            if (callback == .zero) return;

            var vm = handlers.vm;
            if (vm.isShuttingDown()) {
                return;
            }
            this.ref();
            defer this.deref();
            this.internalFlush();
            log("onWritable buffered_data_for_node_net {d}", .{this.buffered_data_for_node_net.len});
            // is not writable if we have buffered data or if we are already detached
            if (this.buffered_data_for_node_net.len > 0 or this.socket.isDetached()) return;

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            _ = callback.call(globalObject, this_value, &.{this_value}) catch |err| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, globalObject.takeError(err) });
            };
        }

        pub fn onTimeout(this: *This, _: Socket) void {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) return;
            const handlers = this.getHandlers();
            log("onTimeout {s}", .{if (handlers.is_server) "S" else "C"});
            const callback = handlers.onTimeout;
            if (callback == .zero or this.flags.finalizing) return;
            if (handlers.vm.isShuttingDown()) {
                return;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            _ = callback.call(globalObject, this_value, &.{this_value}) catch |err| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, globalObject.takeError(err) });
            };
        }

        pub fn getHandlers(this: *const This) *Handlers {
            return this.handlers orelse @panic("No handlers set on Socket");
        }

        pub fn handleConnectError(this: *This, errno: c_int) bun.JSError!void {
            const handlers = this.getHandlers();
            log("onConnectError {s} ({d}, {d})", .{ if (handlers.is_server) "S" else "C", errno, this.ref_count.get() });
            // Ensure the socket is still alive for any defer's we have
            this.ref();
            defer this.deref();
            this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);

            const needs_deref = !this.socket.isDetached();
            this.socket = Socket.detached;
            defer this.markInactive();
            defer if (needs_deref) this.deref();

            const vm = handlers.vm;
            this.poll_ref.unrefOnNextTick(vm);
            if (vm.isShuttingDown()) {
                return;
            }

            bun.assert(errno >= 0);
            var errno_: c_int = if (errno == @intFromEnum(bun.sys.SystemErrno.ENOENT)) @intFromEnum(bun.sys.SystemErrno.ENOENT) else @intFromEnum(bun.sys.SystemErrno.ECONNREFUSED);
            const code_ = if (errno == @intFromEnum(bun.sys.SystemErrno.ENOENT)) bun.String.static("ENOENT") else bun.String.static("ECONNREFUSED");
            if (Environment.isWindows and errno_ == @intFromEnum(bun.sys.SystemErrno.ENOENT)) errno_ = @intFromEnum(bun.sys.SystemErrno.UV_ENOENT);
            if (Environment.isWindows and errno_ == @intFromEnum(bun.sys.SystemErrno.ECONNREFUSED)) errno_ = @intFromEnum(bun.sys.SystemErrno.UV_ECONNREFUSED);

            const callback = handlers.onConnectError;
            const globalObject = handlers.globalObject;
            const err = jsc.SystemError{
                .errno = -errno_,
                .message = bun.String.static("Failed to connect"),
                .syscall = bun.String.static("connect"),
                .code = code_,
            };

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            if (callback == .zero) {
                if (handlers.promise.trySwap()) |promise| {
                    handlers.promise.deinit();
                    if (this.this_value != .zero) {
                        this.this_value = .zero;
                    }
                    this.has_pending_activity.store(false, .release);

                    // reject the promise on connect() error
                    const err_value = err.toErrorInstance(globalObject);
                    try promise.asPromise().?.reject(globalObject, err_value);
                }

                return;
            }

            const this_value = this.getThisValue(globalObject);
            this.this_value = .zero;
            this.has_pending_activity.store(false, .release);

            const err_value = err.toErrorInstance(globalObject);
            const result = callback.call(globalObject, this_value, &[_]JSValue{ this_value, err_value }) catch |e| globalObject.takeException(e);

            if (result.toError()) |err_val| {
                if (handlers.rejectPromise(err_val) catch true) return; // TODO: properly propagate exception upwards
                _ = handlers.callErrorHandler(this_value, &.{ this_value, err_val });
            } else if (handlers.promise.trySwap()) |val| {
                // They've defined a `connectError` callback
                // The error is effectively handled, but we should still reject the promise.
                var promise = val.asPromise().?;
                const err_ = err.toErrorInstance(globalObject);
                try promise.rejectAsHandled(globalObject, err_);
            }
        }

        pub fn onConnectError(this: *This, _: Socket, errno: c_int) bun.JSError!void {
            jsc.markBinding(@src());
            try this.handleConnectError(errno);
        }

        pub fn markActive(this: *This) void {
            if (!this.flags.is_active) {
                this.getHandlers().markActive();
                this.flags.is_active = true;
                this.has_pending_activity.store(true, .release);
            }
        }

        pub fn closeAndDetach(this: *This, code: uws.Socket.CloseCode) void {
            const socket = this.socket;
            this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);

            this.socket.detach();
            this.detachNativeCallback();

            socket.close(code);
        }

        pub fn markInactive(this: *This) void {
            if (this.flags.is_active) {
                // we have to close the socket before the socket context is closed
                // otherwise we will get a segfault
                // uSockets will defer freeing the TCP socket until the next tick
                if (!this.socket.isClosed()) {
                    this.closeAndDetach(.normal);
                    // onClose will call markInactive again
                    return;
                }

                this.flags.is_active = false;
                const handlers = this.getHandlers();
                const vm = handlers.vm;
                handlers.markInactive();
                this.poll_ref.unref(vm);
                this.has_pending_activity.store(false, .release);
            }
        }

        pub fn isServer(this: *const This) bool {
            return this.getHandlers().is_server;
        }

        pub fn onOpen(this: *This, socket: Socket) void {
            log("onOpen {s} {*} {} {}", .{ if (this.isServer()) "S" else "C", this, this.socket.isDetached(), this.ref_count.get() });
            // Ensure the socket remains alive until this is finished
            this.ref();
            defer this.deref();

            // update the internal socket instance to the one that was just connected
            // This socket must be replaced because the previous one is a connecting socket not a uSockets socket
            this.socket = socket;
            jsc.markBinding(@src());

            // Add SNI support for TLS (mongodb and others requires this)
            if (comptime ssl) {
                if (this.socket.ssl()) |ssl_ptr| {
                    if (!ssl_ptr.isInitFinished()) {
                        if (this.server_name) |server_name| {
                            const host = server_name;
                            if (host.len > 0) {
                                const host__ = bun.handleOom(default_allocator.dupeZ(u8, host));
                                defer default_allocator.free(host__);
                                ssl_ptr.setHostname(host__);
                            }
                        } else if (this.connection) |connection| {
                            if (connection == .host) {
                                const host = connection.host.host;
                                if (host.len > 0) {
                                    const host__ = bun.handleOom(default_allocator.dupeZ(u8, host));
                                    defer default_allocator.free(host__);
                                    ssl_ptr.setHostname(host__);
                                }
                            }
                        }
                        if (this.protos) |protos| {
                            if (this.isServer()) {
                                BoringSSL.SSL_CTX_set_alpn_select_cb(BoringSSL.SSL_get_SSL_CTX(ssl_ptr), selectALPNCallback, bun.cast(*anyopaque, this));
                            } else {
                                _ = BoringSSL.SSL_set_alpn_protos(ssl_ptr, protos.ptr, @as(c_uint, @intCast(protos.len)));
                            }
                        }
                    }
                }
            }

            if (this.wrapped == .none) {
                if (socket.ext(**anyopaque)) |ctx| {
                    ctx.* = bun.cast(**anyopaque, this);
                }
            }

            const handlers = this.getHandlers();
            const callback = handlers.onOpen;
            const handshake_callback = handlers.onHandshake;

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);

            this.markActive();
            handlers.resolvePromise(this_value) catch {}; // TODO: properly propagate exception upwards

            if (comptime ssl) {
                // only calls open callback if handshake callback is provided
                // If handshake is provided, open is called on connection open
                // If is not provided, open is called after handshake
                if (callback == .zero or handshake_callback == .zero) return;
            } else {
                if (callback == .zero) return;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();
            const result = callback.call(globalObject, this_value, &[_]JSValue{this_value}) catch |err| globalObject.takeException(err);

            if (result.toError()) |err| {
                defer this.markInactive();
                if (!this.socket.isClosed()) {
                    log("Closing due to error", .{});
                } else {
                    log("Already closed", .{});
                }

                if (handlers.rejectPromise(err) catch true) return; // TODO: properly propagate exception upwards
                _ = handlers.callErrorHandler(this_value, &.{ this_value, err });
            }
        }

        pub fn getThisValue(this: *This, globalObject: *jsc.JSGlobalObject) JSValue {
            if (this.this_value == .zero) {
                const value = this.toJS(globalObject);
                value.ensureStillAlive();
                this.this_value = value;
                return value;
            }

            return this.this_value;
        }

        pub fn onEnd(this: *This, _: Socket) void {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) return;
            const handlers = this.getHandlers();
            log("onEnd {s}", .{if (handlers.is_server) "S" else "C"});
            // Ensure the socket remains alive until this is finished
            this.ref();
            defer this.deref();

            const callback = handlers.onEnd;
            if (callback == .zero or handlers.vm.isShuttingDown()) {
                this.poll_ref.unref(handlers.vm);

                // If you don't handle TCP fin, we assume you're done.
                this.markInactive();
                return;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            _ = callback.call(globalObject, this_value, &.{this_value}) catch |err| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, globalObject.takeError(err) });
            };
        }

        pub fn onHandshake(this: *This, s: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) bun.JSError!void {
            jsc.markBinding(@src());
            this.flags.handshake_complete = true;
            this.socket = s;
            if (this.socket.isDetached()) return;
            const handlers = this.getHandlers();
            log("onHandshake {s} ({d})", .{ if (handlers.is_server) "S" else "C", success });

            const authorized = if (success == 1) true else false;

            this.flags.authorized = authorized;

            var callback = handlers.onHandshake;
            var is_open = false;

            if (handlers.vm.isShuttingDown()) {
                return;
            }

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
            var scope = handlers.enter();
            defer scope.exit();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);

            var result: jsc.JSValue = jsc.JSValue.zero;
            // open callback only have 1 parameters and its the socket
            // you should use getAuthorizationError and authorized getter to get those values in this case
            if (is_open) {
                result = callback.call(globalObject, this_value, &[_]JSValue{this_value}) catch |err| globalObject.takeException(err);

                // only call onOpen once for clients
                if (!handlers.is_server) {
                    // clean onOpen callback so only called in the first handshake and not in every renegotiation
                    // on servers this would require a different approach but it's not needed because our servers will not call handshake multiple times
                    // servers don't support renegotiation
                    handlers.onOpen.unprotect();
                    handlers.onOpen = .zero;
                }
            } else {
                // call handhsake callback with authorized and authorization error if has one
                const authorization_error: JSValue = if (ssl_error.error_no == 0)
                    JSValue.jsNull()
                else
                    try ssl_error.toJS(globalObject);

                result = callback.call(globalObject, this_value, &[_]JSValue{
                    this_value,
                    JSValue.jsBoolean(authorized),
                    authorization_error,
                }) catch |err| globalObject.takeException(err);
            }

            if (result.toError()) |err_value| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, err_value });
            }
        }

        pub fn onClose(this: *This, _: Socket, err: c_int, _: ?*anyopaque) bun.JSError!void {
            jsc.markBinding(@src());
            const handlers = this.getHandlers();
            log("onClose {s}", .{if (handlers.is_server) "S" else "C"});
            this.detachNativeCallback();
            this.socket.detach();
            defer this.deref();
            defer this.markInactive();

            if (this.flags.finalizing) {
                return;
            }

            const vm = handlers.vm;
            this.poll_ref.unref(vm);

            const callback = handlers.onClose;

            if (callback == .zero)
                return;

            if (vm.isShuttingDown()) {
                return;
            }

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            var js_error: JSValue = .js_undefined;
            if (err != 0) {
                // errors here are always a read error
                js_error = try bun.sys.Error.fromCodeInt(err, .read).toJS(globalObject);
            }

            _ = callback.call(globalObject, this_value, &[_]JSValue{
                this_value,
                js_error,
            }) catch |e| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, globalObject.takeError(e) });
            };
        }

        pub fn onData(this: *This, s: Socket, data: []const u8) void {
            jsc.markBinding(@src());
            this.socket = s;
            if (this.socket.isDetached()) return;
            const handlers = this.getHandlers();
            log("onData {s} ({d})", .{ if (handlers.is_server) "S" else "C", data.len });
            if (this.native_callback.onData(data)) return;

            const callback = handlers.onData;
            if (callback == .zero or this.flags.finalizing) return;
            if (handlers.vm.isShuttingDown()) {
                return;
            }

            const globalObject = handlers.globalObject;
            const this_value = this.getThisValue(globalObject);
            const output_value = handlers.binary_type.toJS(data, globalObject) catch |err| {
                this.handleError(globalObject.takeException(err));
                return;
            };

            // the handlers must be kept alive for the duration of the function call
            // that way if we need to call the error handler, we can
            var scope = handlers.enter();
            defer scope.exit();

            // const encoding = handlers.encoding;
            _ = callback.call(globalObject, this_value, &[_]JSValue{
                this_value,
                output_value,
            }) catch |err| {
                _ = handlers.callErrorHandler(this_value, &.{ this_value, globalObject.takeError(err) });
            };
        }

        pub fn getData(_: *This, _: *jsc.JSGlobalObject) JSValue {
            log("getData()", .{});
            return .js_undefined;
        }

        pub fn setData(this: *This, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
            log("setData()", .{});
            This.js.dataSetCached(this.this_value, globalObject, value);
        }

        pub fn getListener(this: *This, _: *jsc.JSGlobalObject) JSValue {
            const handlers = this.handlers orelse return .js_undefined;

            if (!handlers.is_server or this.socket.isDetached()) {
                return .js_undefined;
            }

            const l: *Listener = @fieldParentPtr("handlers", handlers);
            return l.strong_self.get() orelse .js_undefined;
        }

        pub fn getReadyState(this: *This, _: *jsc.JSGlobalObject) JSValue {
            if (this.socket.isDetached()) {
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

        pub fn getAuthorized(this: *This, _: *jsc.JSGlobalObject) JSValue {
            log("getAuthorized()", .{});
            return JSValue.jsBoolean(this.flags.authorized);
        }

        pub fn timeout(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments_old(1);
            if (this.socket.isDetached()) return .js_undefined;
            if (args.len == 0) {
                return globalObject.throw("Expected 1 argument, got 0", .{});
            }
            const t = try args.ptr[0].coerce(i32, globalObject);
            if (t < 0) {
                return globalObject.throw("Timeout must be a positive integer", .{});
            }
            log("timeout({d})", .{t});

            this.socket.setTimeout(@as(c_uint, @intCast(t)));

            return .js_undefined;
        }

        pub fn getAuthorizationError(this: *This, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());

            if (this.socket.isDetached()) {
                return JSValue.jsNull();
            }

            // this error can change if called in different stages of hanshake
            // is very usefull to have this feature depending on the user workflow
            const ssl_error = this.socket.getVerifyError();
            if (ssl_error.error_no == 0) {
                return JSValue.jsNull();
            }

            const code = if (ssl_error.code == null) "" else ssl_error.code[0..bun.len(ssl_error.code)];

            const reason = if (ssl_error.reason == null) "" else ssl_error.reason[0..bun.len(ssl_error.reason)];

            const fallback = jsc.SystemError{
                .code = bun.String.cloneUTF8(code),
                .message = bun.String.cloneUTF8(reason),
            };

            return fallback.toErrorInstance(globalObject);
        }

        pub fn write(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());

            if (this.socket.isDetached()) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            var args = callframe.argumentsUndef(5);

            return switch (this.writeOrEnd(globalObject, args.mut(), false, false)) {
                .fail => .zero,
                .success => |result| JSValue.jsNumber(result.wrote),
            };
        }

        pub fn getLocalFamily(this: *This, globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            var buf: [64]u8 = [_]u8{0} ** 64;
            const address_bytes: []const u8 = this.socket.localAddress(&buf) orelse return .js_undefined;
            return switch (address_bytes.len) {
                4 => try bun.String.static("IPv4").toJS(globalThis),
                16 => try bun.String.static("IPv6").toJS(globalThis),
                else => return .js_undefined,
            };
        }

        pub fn getLocalAddress(this: *This, globalThis: *jsc.JSGlobalObject) JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            var buf: [64]u8 = [_]u8{0} ** 64;
            var text_buf: [512]u8 = undefined;

            const address_bytes: []const u8 = this.socket.localAddress(&buf) orelse return .js_undefined;
            const address: std.net.Address = switch (address_bytes.len) {
                4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
                16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
                else => return .js_undefined,
            };

            const text = bun.fmt.formatIp(address, &text_buf) catch unreachable;
            return ZigString.init(text).toJS(globalThis);
        }

        pub fn getLocalPort(this: *This, _: *jsc.JSGlobalObject) JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            return JSValue.jsNumber(this.socket.localPort());
        }

        pub fn getRemoteFamily(this: *This, globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            var buf: [64]u8 = [_]u8{0} ** 64;
            const address_bytes: []const u8 = this.socket.remoteAddress(&buf) orelse return .js_undefined;
            return switch (address_bytes.len) {
                4 => try bun.String.static("IPv4").toJS(globalThis),
                16 => try bun.String.static("IPv6").toJS(globalThis),
                else => return .js_undefined,
            };
        }

        pub fn getRemoteAddress(this: *This, globalThis: *jsc.JSGlobalObject) bun.JSError!JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            var buf: [64]u8 = [_]u8{0} ** 64;
            var text_buf: [512]u8 = undefined;

            const address_bytes: []const u8 = this.socket.remoteAddress(&buf) orelse return .js_undefined;
            const address: std.net.Address = switch (address_bytes.len) {
                4 => std.net.Address.initIp4(address_bytes[0..4].*, 0),
                16 => std.net.Address.initIp6(address_bytes[0..16].*, 0, 0, 0),
                else => return .js_undefined,
            };

            const text = bun.fmt.formatIp(address, &text_buf) catch unreachable;
            return bun.String.createUTF8ForJS(globalThis, text);
        }

        pub fn getRemotePort(this: *This, _: *jsc.JSGlobalObject) JSValue {
            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            return JSValue.jsNumber(this.socket.remotePort());
        }

        pub fn writeMaybeCorked(this: *This, buffer: []const u8) i32 {
            if (this.socket.isShutdown() or this.socket.isClosed()) {
                return -1;
            }

            // we don't cork yet but we might later
            if (comptime ssl) {
                // TLS wrapped but in TCP mode
                if (this.wrapped == .tcp) {
                    const res = this.socket.rawWrite(buffer);
                    const uwrote: usize = @intCast(@max(res, 0));
                    this.bytes_written += uwrote;
                    log("write({d}) = {d}", .{ buffer.len, res });
                    return res;
                }
            }

            const res = this.socket.write(buffer);
            const uwrote: usize = @intCast(@max(res, 0));
            this.bytes_written += uwrote;
            log("write({d}) = {d}", .{ buffer.len, res });
            return res;
        }

        pub fn writeBuffered(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            if (this.socket.isDetached()) {
                this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);
                return .false;
            }

            const args = callframe.argumentsUndef(2);

            return switch (this.writeOrEndBuffered(globalObject, args.ptr[0], args.ptr[1], false)) {
                .fail => .zero,
                .success => |result| if (@max(result.wrote, 0) == result.total) .true else .false,
            };
        }

        pub fn endBuffered(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            if (this.socket.isDetached()) {
                this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);
                return .false;
            }

            const args = callframe.argumentsUndef(2);
            this.ref();
            defer this.deref();
            return switch (this.writeOrEndBuffered(globalObject, args.ptr[0], args.ptr[1], true)) {
                .fail => .zero,
                .success => |result| brk: {
                    if (result.wrote == result.total) {
                        this.internalFlush();
                    }

                    break :brk JSValue.jsBoolean(@as(usize, @max(result.wrote, 0)) == result.total);
                },
            };
        }

        fn writeOrEndBuffered(this: *This, globalObject: *jsc.JSGlobalObject, data_value: jsc.JSValue, encoding_value: jsc.JSValue, comptime is_end: bool) WriteResult {
            if (this.buffered_data_for_node_net.len == 0) {
                var values = [4]jsc.JSValue{ data_value, .js_undefined, .js_undefined, encoding_value };
                return this.writeOrEnd(globalObject, &values, true, is_end);
            }

            var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
            const allow_string_object = true;
            const buffer: jsc.Node.StringOrBuffer = if (data_value.isUndefined())
                jsc.Node.StringOrBuffer.empty
            else
                jsc.Node.StringOrBuffer.fromJSWithEncodingValueAllowStringObject(globalObject, stack_fallback.get(), data_value, encoding_value, allow_string_object) catch {
                    return .fail;
                } orelse {
                    if (!globalObject.hasException()) {
                        globalObject.throwInvalidArgumentTypeValue("data", "string, buffer, or blob", data_value) catch {};
                        return .fail;
                    }
                    return .fail;
                };
            defer buffer.deinit();
            if (!this.flags.end_after_flush and is_end) {
                this.flags.end_after_flush = true;
            }

            if (this.socket.isShutdown() or this.socket.isClosed()) {
                return .{
                    .success = .{
                        .wrote = -1,
                        .total = buffer.slice().len + this.buffered_data_for_node_net.len,
                    },
                };
            }

            const total_to_write: usize = buffer.slice().len + @as(usize, this.buffered_data_for_node_net.len);
            if (total_to_write == 0) {
                if (ssl) {
                    log("total_to_write == 0", .{});
                    if (!data_value.isUndefined()) {
                        log("data_value is not undefined", .{});
                        // special condition for SSL_write(0, "", 0)
                        // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                        // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                        this.flags.empty_packet_pending = true;
                        if (!this.tryWriteEmptyPacket()) {
                            return .{ .success = .{
                                .wrote = -1,
                                .total = total_to_write,
                            } };
                        }
                    }
                }

                return .{ .success = .{} };
            }

            const wrote: i32 = brk: {
                if (comptime !ssl and Environment.isPosix) {
                    // fast-ish path: use writev() to avoid cloning to another buffer.
                    if (this.socket.socket == .connected and buffer.slice().len > 0) {
                        const rc = this.socket.socket.connected.write2(ssl, this.buffered_data_for_node_net.slice(), buffer.slice());
                        const written: usize = @intCast(@max(rc, 0));
                        const leftover = total_to_write -| written;
                        if (leftover == 0) {
                            this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);
                            break :brk rc;
                        }

                        const remaining_in_buffered_data = this.buffered_data_for_node_net.slice()[@min(written, this.buffered_data_for_node_net.len)..];
                        const remaining_in_input_data = buffer.slice()[@min(this.buffered_data_for_node_net.len -| written, buffer.slice().len)..];

                        if (written > 0) {
                            if (remaining_in_buffered_data.len > 0) {
                                var input_buffer = this.buffered_data_for_node_net.slice();
                                _ = bun.c.memmove(input_buffer.ptr, input_buffer.ptr[written..], remaining_in_buffered_data.len);
                                this.buffered_data_for_node_net.len = @truncate(remaining_in_buffered_data.len);
                            }
                        }

                        if (remaining_in_input_data.len > 0) {
                            bun.handleOom(this.buffered_data_for_node_net.appendSlice(
                                bun.default_allocator,
                                remaining_in_input_data,
                            ));
                        }

                        break :brk rc;
                    }
                }

                // slower-path: clone the data, do one write.
                bun.handleOom(this.buffered_data_for_node_net.appendSlice(
                    bun.default_allocator,
                    buffer.slice(),
                ));
                const rc = this.writeMaybeCorked(this.buffered_data_for_node_net.slice());
                if (rc > 0) {
                    const wrote: usize = @intCast(@max(rc, 0));
                    // did we write everything?
                    // we can free this temporary buffer.
                    if (wrote == this.buffered_data_for_node_net.len) {
                        this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);
                    } else {
                        // Otherwise, let's move the temporary buffer back.
                        const len = @as(usize, @intCast(this.buffered_data_for_node_net.len)) - wrote;
                        bun.debugAssert(len <= this.buffered_data_for_node_net.len);
                        bun.debugAssert(len <= this.buffered_data_for_node_net.cap);
                        _ = bun.c.memmove(this.buffered_data_for_node_net.ptr, this.buffered_data_for_node_net.ptr[wrote..], len);
                        this.buffered_data_for_node_net.len = @truncate(len);
                    }
                }

                break :brk rc;
            };

            return .{
                .success = .{
                    .wrote = wrote,
                    .total = total_to_write,
                },
            };
        }

        fn writeOrEnd(this: *This, globalObject: *jsc.JSGlobalObject, args: []jsc.JSValue, buffer_unwritten_data: bool, comptime is_end: bool) WriteResult {
            if (args[0].isUndefined()) {
                if (!this.flags.end_after_flush and is_end) {
                    this.flags.end_after_flush = true;
                }
                log("writeOrEnd undefined", .{});
                return .{ .success = .{} };
            }

            bun.debugAssert(this.buffered_data_for_node_net.len == 0);
            var encoding_value: jsc.JSValue = args[3];
            if (args[2].isString()) {
                encoding_value = args[2];
                args[2] = .js_undefined;
            } else if (args[1].isString()) {
                encoding_value = args[1];
                args[1] = .js_undefined;
            }

            const offset_value = args[1];
            const length_value = args[2];

            if (!encoding_value.isUndefined() and (!offset_value.isUndefined() or !length_value.isUndefined())) {
                return globalObject.throwTODO("Support encoding with offset and length altogether. Only either encoding or offset, length is supported, but not both combinations yet.") catch .fail;
            }

            var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
            const buffer: jsc.Node.BlobOrStringOrBuffer = if (args[0].isUndefined())
                jsc.Node.BlobOrStringOrBuffer{ .string_or_buffer = jsc.Node.StringOrBuffer.empty }
            else
                jsc.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueAllowRequestResponse(globalObject, stack_fallback.get(), args[0], encoding_value, true) catch {
                    return .fail;
                } orelse {
                    if (!globalObject.hasException()) {
                        return globalObject.throwInvalidArgumentTypeValue("data", "string, buffer, or blob", args[0]) catch .fail;
                    }
                    return .fail;
                };

            defer buffer.deinit();
            if (buffer == .blob and buffer.blob.needsToReadFile()) {
                return globalObject.throw("File blob not supported yet in this function.", .{}) catch .fail;
            }

            const label = if (comptime is_end) "end" else "write";

            const byte_offset: usize = brk: {
                if (offset_value.isUndefined()) break :brk 0;
                if (!offset_value.isAnyInt()) {
                    return globalObject.throwInvalidArgumentType(comptime "Socket." ++ label, "byteOffset", "integer") catch .fail;
                }
                const i = offset_value.toInt64();
                if (i < 0) {
                    return globalObject.throwRangeError(i, .{ .field_name = "byteOffset", .min = 0, .max = jsc.MAX_SAFE_INTEGER }) catch .fail;
                }
                break :brk @intCast(i);
            };

            const byte_length: usize = brk: {
                if (length_value.isUndefined()) break :brk buffer.slice().len;
                if (!length_value.isAnyInt()) {
                    return globalObject.throwInvalidArgumentType(comptime "Socket." ++ label, "byteLength", "integer") catch .fail;
                }

                const l = length_value.toInt64();

                if (l < 0) {
                    return globalObject.throwRangeError(l, .{ .field_name = "byteLength", .min = 0, .max = jsc.MAX_SAFE_INTEGER }) catch .fail;
                }
                break :brk @intCast(l);
            };

            var bytes = buffer.slice();

            if (byte_offset > bytes.len) {
                return globalObject.throwRangeError(@as(i64, @intCast(byte_offset)), .{ .field_name = "byteOffset", .min = 0, .max = @intCast(bytes.len) }) catch .fail;
            }

            bytes = bytes[byte_offset..];

            if (byte_length > bytes.len) {
                return globalObject.throwRangeError(@as(i64, @intCast(byte_length)), .{ .field_name = "byteLength", .min = 0, .max = @intCast(bytes.len) }) catch .fail;
            }

            bytes = bytes[0..byte_length];

            if (globalObject.hasException()) {
                return .fail;
            }

            if (this.socket.isShutdown() or this.socket.isClosed()) {
                return .{
                    .success = .{
                        .wrote = -1,
                        .total = bytes.len,
                    },
                };
            }
            if (!this.flags.end_after_flush and is_end) {
                this.flags.end_after_flush = true;
            }

            if (bytes.len == 0) {
                if (ssl) {
                    log("writeOrEnd 0", .{});
                    // special condition for SSL_write(0, "", 0)
                    // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                    // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                    this.flags.empty_packet_pending = true;
                    if (!this.tryWriteEmptyPacket()) {
                        return .{ .success = .{
                            .wrote = -1,
                            .total = bytes.len,
                        } };
                    }
                }
                return .{ .success = .{} };
            }
            log("writeOrEnd {d}", .{bytes.len});
            const wrote = this.writeMaybeCorked(bytes);
            const uwrote: usize = @intCast(@max(wrote, 0));
            if (buffer_unwritten_data) {
                const remaining = bytes[uwrote..];
                if (remaining.len > 0) {
                    bun.handleOom(this.buffered_data_for_node_net.appendSlice(
                        bun.default_allocator,
                        remaining,
                    ));
                }
            }

            return .{
                .success = .{
                    .wrote = wrote,
                    .total = bytes.len,
                },
            };
        }

        fn tryWriteEmptyPacket(this: *This) bool {
            if (ssl) {
                // just mimic the side-effect dont actually write empty non-TLS data onto the socket, we just wanna to have same behavior of node.js
                if (!this.flags.handshake_complete or this.buffered_data_for_node_net.len > 0) return false;

                this.flags.empty_packet_pending = false;
                return true;
            }
            return false;
        }

        fn canEndAfterFlush(this: *This) bool {
            return this.flags.is_active and this.flags.end_after_flush and !this.flags.empty_packet_pending and this.buffered_data_for_node_net.len == 0;
        }

        fn internalFlush(this: *This) void {
            if (this.buffered_data_for_node_net.len > 0) {
                const written: usize = @intCast(@max(this.socket.write(this.buffered_data_for_node_net.slice()), 0));
                this.bytes_written += written;
                if (written > 0) {
                    if (this.buffered_data_for_node_net.len > written) {
                        const remaining = this.buffered_data_for_node_net.slice()[written..];
                        _ = bun.c.memmove(this.buffered_data_for_node_net.ptr, remaining.ptr, remaining.len);
                        this.buffered_data_for_node_net.len = @truncate(remaining.len);
                    } else {
                        this.buffered_data_for_node_net.clearAndFree(bun.default_allocator);
                    }
                }
            }

            _ = this.tryWriteEmptyPacket();
            this.socket.flush();

            if (this.canEndAfterFlush()) {
                this.markInactive();
            }
        }

        pub fn flush(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            this.internalFlush();
            return .js_undefined;
        }

        pub fn terminate(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            this.closeAndDetach(.failure);
            return .js_undefined;
        }

        pub fn shutdown(this: *This, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            const args = callframe.arguments_old(1);
            if (args.len > 0 and args.ptr[0].toBoolean()) {
                this.socket.shutdownRead();
            } else {
                this.socket.shutdown();
            }

            return .js_undefined;
        }

        pub fn close(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            _ = callframe;
            this.socket.close(.normal);
            this.socket.detach();
            this.poll_ref.unref(globalObject.bunVM());
            return .js_undefined;
        }

        pub fn end(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());

            var args = callframe.argumentsUndef(5);

            log("end({d} args)", .{args.len});
            if (this.socket.isDetached()) {
                return JSValue.jsNumber(@as(i32, -1));
            }

            this.ref();
            defer this.deref();

            return switch (this.writeOrEnd(globalObject, args.mut(), false, true)) {
                .fail => .zero,
                .success => |result| brk: {
                    if (result.wrote == result.total) {
                        this.internalFlush();
                    }
                    break :brk JSValue.jsNumber(result.wrote);
                },
            };
        }

        pub fn jsRef(this: *This, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) this.ref_pollref_on_connect = true;
            if (this.socket.isDetached()) return .js_undefined;
            this.poll_ref.ref(globalObject.bunVM());
            return .js_undefined;
        }

        pub fn jsUnref(this: *This, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            if (this.socket.isDetached()) this.ref_pollref_on_connect = false;
            this.poll_ref.unref(globalObject.bunVM());
            return .js_undefined;
        }

        pub fn deinit(this: *This) void {
            this.markInactive();
            this.detachNativeCallback();

            this.buffered_data_for_node_net.deinit(bun.default_allocator);

            this.poll_ref.unref(jsc.VirtualMachine.get());
            // need to deinit event without being attached
            if (this.flags.owned_protos) {
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
            if (this.socket_context) |socket_context| {
                this.socket_context = null;
                socket_context.deinit(ssl);
            }
            bun.destroy(this);
        }

        pub fn finalize(this: *This) void {
            log("finalize() {d} {}", .{ @intFromPtr(this), this.socket_context != null });
            this.flags.finalizing = true;
            if (!this.socket.isClosed()) {
                this.closeAndDetach(.failure);
            }

            this.deref();
        }

        pub fn reload(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            const args = callframe.arguments_old(1);

            if (args.len < 1) {
                return globalObject.throw("Expected 1 argument", .{});
            }

            if (this.socket.isDetached()) {
                return .js_undefined;
            }

            const opts = args.ptr[0];
            if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
                return globalObject.throw("Expected options object", .{});
            }

            const socket_obj = try opts.get(globalObject, "socket") orelse {
                return globalObject.throw("Expected \"socket\" option", .{});
            };

            const this_handlers = this.getHandlers();
            const handlers = try Handlers.fromJS(globalObject, socket_obj, this_handlers.is_server);
            this_handlers.deinit();
            this_handlers.* = handlers;

            return .js_undefined;
        }

        pub fn getFD(this: *This, _: *jsc.JSGlobalObject) JSValue {
            return this.socket.fd().toJSWithoutMakingLibUVOwned();
        }

        pub fn getBytesWritten(this: *This, _: *jsc.JSGlobalObject) JSValue {
            return jsc.JSValue.jsNumber(this.bytes_written + this.buffered_data_for_node_net.len);
        }

        // this invalidates the current socket returning 2 new sockets
        // one for non-TLS and another for TLS
        // handlers for non-TLS are preserved
        pub fn upgradeTLS(this: *This, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
            jsc.markBinding(@src());
            const this_js = callframe.this();

            if (comptime ssl) {
                return .js_undefined;
            }
            if (this.socket.isDetached() or this.socket.isNamedPipe()) {
                return .js_undefined;
            }
            const args = callframe.arguments_old(1);

            if (args.len < 1) {
                return globalObject.throw("Expected 1 arguments", .{});
            }

            var success = false;

            const opts = args.ptr[0];
            if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
                return globalObject.throw("Expected options object", .{});
            }

            const socket_obj = try opts.get(globalObject, "socket") orelse {
                return globalObject.throw("Expected \"socket\" option", .{});
            };
            if (globalObject.hasException()) {
                return .zero;
            }

            const handlers = try Handlers.fromJS(globalObject, socket_obj, this.isServer());

            if (globalObject.hasException()) {
                return .zero;
            }

            var ssl_opts: ?jsc.API.ServerConfig.SSLConfig = null;

            if (try opts.getTruthy(globalObject, "tls")) |tls| {
                if (!tls.isBoolean()) {
                    ssl_opts = try jsc.API.ServerConfig.SSLConfig.fromJS(jsc.VirtualMachine.get(), globalObject, tls);
                } else if (tls.toBoolean()) {
                    ssl_opts = jsc.API.ServerConfig.SSLConfig.zero;
                }
            }

            if (globalObject.hasException()) {
                return .zero;
            }

            const socket_config = &(ssl_opts orelse {
                return globalObject.throw("Expected \"tls\" option", .{});
            });
            defer socket_config.deinit();

            var default_data = JSValue.zero;
            if (try opts.fastGet(globalObject, .data)) |default_data_value| {
                default_data = default_data_value;
                default_data.ensureStillAlive();
            }
            if (globalObject.hasException()) {
                return .zero;
            }

            const options = socket_config.asUSockets();

            const handlers_ptr = bun.handleOom(handlers.vm.allocator.create(Handlers));
            handlers_ptr.* = handlers;
            var tls = bun.new(TLSSocket, .{
                .ref_count = .init(),
                .handlers = handlers_ptr,
                .this_value = .zero,
                .socket = TLSSocket.Socket.detached,
                .connection = if (this.connection) |c| c.clone() else null,
                .wrapped = .tls,
                .protos = if (socket_config.protos) |p|
                    bun.handleOom(bun.default_allocator.dupe(u8, std.mem.span(p)))
                else
                    null,
                .server_name = if (socket_config.server_name) |sn|
                    bun.handleOom(bun.default_allocator.dupe(u8, std.mem.span(sn)))
                else
                    null,
                .socket_context = null, // only set after the wrapTLS
                .flags = .{
                    .is_active = false,
                },
            });

            const TCPHandler = NewWrappedHandler(false);

            // reconfigure context to use the new wrapper handlers
            Socket.unsafeConfigure(this.socket.context().?, true, true, WrappedSocket, TCPHandler);
            const TLSHandler = NewWrappedHandler(true);
            const new_socket = this.socket.wrapTLS(options, @sizeOf(*anyopaque), @sizeOf(WrappedSocket), true, WrappedSocket, TLSHandler) orelse {
                const err = BoringSSL.ERR_get_error();
                defer if (err != 0) BoringSSL.ERR_clear_error();
                tls.wrapped = .none;

                // Reset config to TCP
                uws.NewSocketHandler(false).configure(
                    this.socket.context().?,
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

                tls.deref();

                handlers_ptr.deinit();
                bun.default_allocator.destroy(handlers_ptr);

                // If BoringSSL gave us an error code, let's use it.
                if (err != 0 and !globalObject.hasException()) {
                    return globalObject.throwValue(bun.BoringSSL.ERR_toJS(globalObject, err));
                }

                // If BoringSSL did not give us an error code, let's throw a generic error.
                if (!globalObject.hasException()) {
                    return globalObject.throw("Failed to upgrade socket from TCP -> TLS. Is the TLS config correct?", .{});
                }

                return .js_undefined;
            };

            // Do not create the JS Wrapper object until _after_ we've validated the TLS config.
            // Otherwise, JSC will GC it and the lifetime gets very complicated.
            const tls_js_value = tls.getThisValue(globalObject);
            TLSSocket.js.dataSetCached(tls_js_value, globalObject, default_data);

            tls.socket = new_socket;
            const new_context = new_socket.context().?;
            tls.socket_context = new_context; // owns the new tls context that have a ref from the old one
            tls.ref();

            const this_handlers = this.getHandlers();
            const raw_handlers_ptr = bun.handleOom(this_handlers.vm.allocator.create(Handlers));
            raw_handlers_ptr.* = this_handlers.clone();

            const raw = bun.new(TLSSocket, .{
                .ref_count = .init(),
                .handlers = raw_handlers_ptr,
                .this_value = .zero,
                .socket = new_socket,
                .connection = if (this.connection) |c| c.clone() else null,
                .wrapped = .tcp,
                .protos = null,
                .socket_context = new_context.ref(true),
            });
            raw.ref();

            const raw_js_value = raw.getThisValue(globalObject);
            if (JSSocketType(ssl).dataGetCached(this_js)) |raw_default_data| {
                raw_default_data.ensureStillAlive();
                TLSSocket.js.dataSetCached(raw_js_value, globalObject, raw_default_data);
            }

            // marks both as active
            raw.markActive();
            // this will keep tls alive until socket.open() is called to start TLS certificate and the handshake process
            // open is not immediately called because we need to set bunSocketInternal
            tls.markActive();

            // we're unrefing the original instance and refing the TLS instance
            tls.poll_ref.ref(this_handlers.vm);

            // mark both instances on socket data
            if (new_socket.ext(WrappedSocket)) |ctx| {
                ctx.* = .{ .tcp = raw, .tls = tls };
            }

            if (this.flags.is_active) {
                this.poll_ref.disable();
                this.flags.is_active = false;
                // will free handlers when hits 0 active connections
                // the connection can be upgraded inside a handler call so we need to guarantee that it will be still alive
                this.getHandlers().markInactive();

                this.has_pending_activity.store(false, .release);
            }

            const array = try jsc.JSValue.createEmptyArray(globalObject, 2);
            try array.putIndex(globalObject, 0, raw_js_value);
            try array.putIndex(globalObject, 1, tls_js_value);

            defer this.deref();

            // detach and invalidate the old instance
            this.detachNativeCallback();
            this.socket.detach();

            // start TLS handshake after we set extension on the socket
            new_socket.startTLS(!handlers_ptr.is_server);

            success = true;
            return array;
        }

        pub const disableRenegotiation = if (ssl) tls_socket_functions.disableRenegotiation else tcp_socket_function_that_returns_undefined;
        pub const isSessionReused = if (ssl) tls_socket_functions.isSessionReused else tcp_socket_function_that_returns_false;
        pub const setVerifyMode = if (ssl) tls_socket_functions.setVerifyMode else tcp_socket_function_that_returns_undefined;
        pub const renegotiate = if (ssl) tls_socket_functions.renegotiate else tcp_socket_function_that_returns_undefined;
        pub const getTLSTicket = if (ssl) tls_socket_functions.getTLSTicket else tcp_socket_function_that_returns_undefined;
        pub const setSession = if (ssl) tls_socket_functions.setSession else tcp_socket_function_that_returns_undefined;
        pub const getSession = if (ssl) tls_socket_functions.getSession else tcp_socket_function_that_returns_undefined;
        pub const getALPNProtocol = if (ssl) tls_socket_functions.getALPNProtocol else tcp_socket_getter_that_returns_false;
        pub const exportKeyingMaterial = if (ssl) tls_socket_functions.exportKeyingMaterial else tcp_socket_function_that_returns_undefined;
        pub const getEphemeralKeyInfo = if (ssl) tls_socket_functions.getEphemeralKeyInfo else tcp_socket_function_that_returns_null;
        pub const getCipher = if (ssl) tls_socket_functions.getCipher else tcp_socket_function_that_returns_undefined;
        pub const getTLSPeerFinishedMessage = if (ssl) tls_socket_functions.getTLSPeerFinishedMessage else tcp_socket_function_that_returns_undefined;
        pub const getTLSFinishedMessage = if (ssl) tls_socket_functions.getTLSFinishedMessage else tcp_socket_function_that_returns_undefined;
        pub const getSharedSigalgs = if (ssl) tls_socket_functions.getSharedSigalgs else tcp_socket_function_that_returns_undefined;
        pub const getTLSVersion = if (ssl) tls_socket_functions.getTLSVersion else tcp_socket_function_that_returns_null;
        pub const setMaxSendFragment = if (ssl) tls_socket_functions.setMaxSendFragment else tcp_socket_function_that_returns_false;
        pub const getPeerCertificate = if (ssl) tls_socket_functions.getPeerCertificate else tcp_socket_function_that_returns_null;
        pub const getCertificate = if (ssl) tls_socket_functions.getCertificate else tcp_socket_function_that_returns_undefined;
        pub const getPeerX509Certificate = if (ssl) tls_socket_functions.getPeerX509Certificate else tcp_socket_function_that_returns_undefined;
        pub const getX509Certificate = if (ssl) tls_socket_functions.getX509Certificate else tcp_socket_function_that_returns_undefined;
        pub const getServername = if (ssl) tls_socket_functions.getServername else tcp_socket_function_that_returns_undefined;
        pub const setServername = if (ssl) tls_socket_functions.setServername else tcp_socket_function_that_returns_undefined;

        fn tcp_socket_function_that_returns_undefined(_: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            return .js_undefined;
        }

        fn tcp_socket_function_that_returns_false(_: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            return .false;
        }

        fn tcp_socket_getter_that_returns_false(_: *This, _: *jsc.JSGlobalObject) bun.JSError!JSValue {
            return .false;
        }

        fn tcp_socket_function_that_returns_null(_: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
            return .null;
        }
    };
}

pub const TCPSocket = NewSocket(false);
pub const TLSSocket = NewSocket(true);

// We use this direct callbacks on HTTP2 when available
const NativeCallbacks = union(enum) {
    h2: *H2FrameParser,
    none,

    pub fn onData(this: NativeCallbacks, data: []const u8) bool {
        switch (this) {
            .h2 => |h2| {
                h2.onNativeRead(data) catch return false; // TODO: properly propagate exception upwards
                return true;
            },
            .none => return false,
        }
    }
    pub fn onWritable(this: NativeCallbacks) bool {
        switch (this) {
            .h2 => |h2| {
                h2.onNativeWritable();
                return true;
            },
            .none => return false,
        }
    }
};

const log = Output.scoped(.Socket, .visible);

const WriteResult = union(enum) {
    fail: void,
    success: struct {
        wrote: i32 = 0,
        total: usize = 0,
    },
};

const Flags = packed struct(u16) {
    is_active: bool = false,
    /// Prevent onClose from calling into JavaScript while we are finalizing
    finalizing: bool = false,
    authorized: bool = false,
    handshake_complete: bool = false,
    empty_packet_pending: bool = false,
    end_after_flush: bool = false,
    owned_protos: bool = true,
    is_paused: bool = false,
    allow_half_open: bool = false,
    _: u7 = 0,
};

pub const WrappedSocket = extern struct {
    // both shares the same socket but one behaves as TLS and the other as TCP
    tls: *TLSSocket,
    tcp: *TLSSocket,
};

pub fn NewWrappedHandler(comptime tls: bool) type {
    const Socket = uws.NewSocketHandler(true);
    return struct {
        pub fn onOpen(this: WrappedSocket, socket: Socket) void {
            // only TLS will call onOpen
            if (comptime tls) {
                TLSSocket.onOpen(this.tls, socket);
            }
        }

        pub fn onEnd(this: WrappedSocket, socket: Socket) void {
            if (comptime tls) {
                TLSSocket.onEnd(this.tls, socket);
            } else {
                TLSSocket.onEnd(this.tcp, socket);
            }
        }

        pub fn onHandshake(this: WrappedSocket, socket: Socket, success: i32, ssl_error: uws.us_bun_verify_error_t) bun.JSError!void {
            // only TLS will call onHandshake
            if (comptime tls) {
                try TLSSocket.onHandshake(this.tls, socket, success, ssl_error);
            }
        }

        pub fn onClose(this: WrappedSocket, socket: Socket, err: c_int, data: ?*anyopaque) bun.JSError!void {
            if (comptime tls) {
                try TLSSocket.onClose(this.tls, socket, err, data);
            } else {
                try TLSSocket.onClose(this.tcp, socket, err, data);
            }
        }

        pub fn onData(this: WrappedSocket, socket: Socket, data: []const u8) void {
            if (comptime tls) {
                TLSSocket.onData(this.tls, socket, data);
            } else {
                // tedius use this (tedius is a pure-javascript implementation of TDS protocol used to interact with instances of Microsoft's SQL Server)
                TLSSocket.onData(this.tcp, socket, data);
            }
        }

        pub const onFd = null;

        pub fn onWritable(this: WrappedSocket, socket: Socket) void {
            if (comptime tls) {
                TLSSocket.onWritable(this.tls, socket);
            } else {
                TLSSocket.onWritable(this.tcp, socket);
            }
        }

        pub fn onTimeout(this: WrappedSocket, socket: Socket) void {
            if (comptime tls) {
                TLSSocket.onTimeout(this.tls, socket);
            } else {
                TLSSocket.onTimeout(this.tcp, socket);
            }
        }

        pub fn onLongTimeout(this: WrappedSocket, socket: Socket) void {
            if (comptime tls) {
                TLSSocket.onTimeout(this.tls, socket);
            } else {
                TLSSocket.onTimeout(this.tcp, socket);
            }
        }

        pub fn onConnectError(this: WrappedSocket, socket: Socket, errno: c_int) bun.JSError!void {
            if (comptime tls) {
                try TLSSocket.onConnectError(this.tls, socket, errno);
            } else {
                try TLSSocket.onConnectError(this.tcp, socket, errno);
            }
        }
    };
}

pub const DuplexUpgradeContext = struct {
    upgrade: uws.UpgradedDuplex,
    // We only us a tls and not a raw socket when upgrading a Duplex, Duplex dont support socketpairs
    tls: ?*TLSSocket,
    // task used to deinit the context in the next tick, vm is used to enqueue the task
    vm: *jsc.VirtualMachine,
    task: jsc.AnyTask,
    task_event: EventState = .StartTLS,
    ssl_config: ?jsc.API.ServerConfig.SSLConfig,
    is_open: bool = false,

    pub const EventState = enum(u8) {
        StartTLS,
        Close,
    };

    pub const new = bun.TrivialNew(DuplexUpgradeContext);

    fn onOpen(this: *DuplexUpgradeContext) void {
        this.is_open = true;
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onOpen(socket);
        }
    }

    fn onData(this: *DuplexUpgradeContext, decoded_data: []const u8) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onData(socket, decoded_data);
        }
    }

    fn onHandshake(this: *DuplexUpgradeContext, success: bool, ssl_error: uws.us_bun_verify_error_t) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onHandshake(socket, @intFromBool(success), ssl_error) catch {};
        }
    }

    fn onEnd(this: *DuplexUpgradeContext) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);
        if (this.tls) |tls| {
            tls.onEnd(socket);
        }
    }

    fn onWritable(this: *DuplexUpgradeContext) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onWritable(socket);
        }
    }

    fn onError(this: *DuplexUpgradeContext, err_value: jsc.JSValue) void {
        if (this.is_open) {
            if (this.tls) |tls| {
                tls.handleError(err_value);
            }
        } else {
            if (this.tls) |tls| {
                tls.handleConnectError(@intFromEnum(bun.sys.SystemErrno.ECONNREFUSED)) catch {};
            }
        }
    }

    fn onTimeout(this: *DuplexUpgradeContext) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onTimeout(socket);
        }
    }

    fn onClose(this: *DuplexUpgradeContext) void {
        const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

        if (this.tls) |tls| {
            tls.onClose(socket, 0, null) catch {};
        }

        this.deinitInNextTick();
    }

    fn runEvent(this: *DuplexUpgradeContext) void {
        switch (this.task_event) {
            .StartTLS => {
                if (this.ssl_config) |config| {
                    this.upgrade.startTLS(config, true) catch |err| {
                        switch (err) {
                            error.OutOfMemory => {
                                bun.outOfMemory();
                            },
                            else => {
                                const errno = @intFromEnum(bun.sys.SystemErrno.ECONNREFUSED);
                                if (this.tls) |tls| {
                                    const socket = TLSSocket.Socket.fromDuplex(&this.upgrade);

                                    tls.handleConnectError(errno) catch {};
                                    tls.onClose(socket, errno, null) catch {};
                                }
                            },
                        }
                    };
                    this.ssl_config.?.deinit();
                    this.ssl_config = null;
                }
            },
            .Close => {
                this.upgrade.close();
            },
        }
    }

    fn deinitInNextTick(this: *DuplexUpgradeContext) void {
        this.task_event = .Close;
        this.vm.enqueueTask(jsc.Task.init(&this.task));
    }

    fn startTLS(this: *DuplexUpgradeContext) void {
        this.task_event = .StartTLS;
        this.vm.enqueueTask(jsc.Task.init(&this.task));
    }

    fn deinit(this: *DuplexUpgradeContext) void {
        if (this.tls) |tls| {
            this.tls = null;
            tls.deref();
        }
        this.upgrade.deinit();
        this.destroy();
    }
};

pub fn jsUpgradeDuplexToTLS(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const args = callframe.arguments_old(2);
    if (args.len < 2) {
        return globalObject.throw("Expected 2 arguments", .{});
    }
    const duplex = args.ptr[0];
    // TODO: do better type checking
    if (duplex.isEmptyOrUndefinedOrNull()) {
        return globalObject.throw("Expected a Duplex instance", .{});
    }

    const opts = args.ptr[1];
    if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
        return globalObject.throw("Expected options object", .{});
    }

    const socket_obj = try opts.get(globalObject, "socket") orelse {
        return globalObject.throw("Expected \"socket\" option", .{});
    };

    const is_server = false; // A duplex socket is always handled as a client
    const handlers = try Handlers.fromJS(globalObject, socket_obj, is_server);

    var ssl_opts: ?jsc.API.ServerConfig.SSLConfig = null;
    if (try opts.getTruthy(globalObject, "tls")) |tls| {
        if (!tls.isBoolean()) {
            ssl_opts = try jsc.API.ServerConfig.SSLConfig.fromJS(jsc.VirtualMachine.get(), globalObject, tls);
        } else if (tls.toBoolean()) {
            ssl_opts = jsc.API.ServerConfig.SSLConfig.zero;
        }
    }
    const socket_config = &(ssl_opts orelse {
        return globalObject.throw("Expected \"tls\" option", .{});
    });

    var default_data = JSValue.zero;
    if (try opts.fastGet(globalObject, .data)) |default_data_value| {
        default_data = default_data_value;
        default_data.ensureStillAlive();
    }

    const handlers_ptr = bun.handleOom(handlers.vm.allocator.create(Handlers));
    handlers_ptr.* = handlers;
    var tls = bun.new(TLSSocket, .{
        .ref_count = .init(),
        .handlers = handlers_ptr,
        .this_value = .zero,
        .socket = TLSSocket.Socket.detached,
        .connection = null,
        .wrapped = .tls,
        .protos = if (socket_config.protos) |p|
            bun.handleOom(bun.default_allocator.dupe(u8, std.mem.span(p)))
        else
            null,
        .server_name = if (socket_config.server_name) |sn|
            bun.handleOom(bun.default_allocator.dupe(u8, std.mem.span(sn)))
        else
            null,
        .socket_context = null, // only set after the wrapTLS
    });
    const tls_js_value = tls.getThisValue(globalObject);
    TLSSocket.js.dataSetCached(tls_js_value, globalObject, default_data);

    var duplexContext = DuplexUpgradeContext.new(.{
        .upgrade = undefined,
        .tls = tls,
        .vm = globalObject.bunVM(),
        .task = undefined,
        .ssl_config = socket_config.*,
    });
    tls.ref();

    duplexContext.task = jsc.AnyTask.New(DuplexUpgradeContext, DuplexUpgradeContext.runEvent).init(duplexContext);
    duplexContext.upgrade = uws.UpgradedDuplex.from(globalObject, duplex, .{
        .onOpen = @ptrCast(&DuplexUpgradeContext.onOpen),
        .onData = @ptrCast(&DuplexUpgradeContext.onData),
        .onHandshake = @ptrCast(&DuplexUpgradeContext.onHandshake),
        .onClose = @ptrCast(&DuplexUpgradeContext.onClose),
        .onEnd = @ptrCast(&DuplexUpgradeContext.onEnd),
        .onWritable = @ptrCast(&DuplexUpgradeContext.onWritable),
        .onError = @ptrCast(&DuplexUpgradeContext.onError),
        .onTimeout = @ptrCast(&DuplexUpgradeContext.onTimeout),
        .ctx = @ptrCast(duplexContext),
    });

    tls.socket = TLSSocket.Socket.fromDuplex(&duplexContext.upgrade);
    tls.markActive();
    tls.poll_ref.ref(globalObject.bunVM());

    duplexContext.startTLS();

    const array = try jsc.JSValue.createEmptyArray(globalObject, 2);
    try array.putIndex(globalObject, 0, tls_js_value);
    // data, end, drain and close events must be reported
    try array.putIndex(globalObject, 1, try duplexContext.upgrade.getJSHandlers(globalObject));

    return array;
}

pub fn jsIsNamedPipeSocket(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const arguments = callframe.arguments_old(3);
    if (arguments.len < 1) {
        return global.throwNotEnoughArguments("isNamedPipeSocket", 1, arguments.len);
    }
    const socket = arguments.ptr[0];
    if (socket.as(TCPSocket)) |this| {
        return jsc.JSValue.jsBoolean(this.socket.isNamedPipe());
    } else if (socket.as(TLSSocket)) |this| {
        return jsc.JSValue.jsBoolean(this.socket.isNamedPipe());
    }
    return .false;
}

pub fn jsGetBufferedAmount(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    const arguments = callframe.arguments_old(3);
    if (arguments.len < 1) {
        return global.throwNotEnoughArguments("getBufferedAmount", 1, arguments.len);
    }
    const socket = arguments.ptr[0];
    if (socket.as(TCPSocket)) |this| {
        return jsc.JSValue.jsNumber(this.buffered_data_for_node_net.len);
    } else if (socket.as(TLSSocket)) |this| {
        return jsc.JSValue.jsNumber(this.buffered_data_for_node_net.len);
    }
    return jsc.JSValue.jsNumber(0);
}

pub fn jsCreateSocketPair(global: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    jsc.markBinding(@src());

    if (Environment.isWindows) {
        return global.throw("Not implemented on Windows", .{});
    }

    var fds_: [2]std.c.fd_t = .{ 0, 0 };
    const rc = std.c.socketpair(std.posix.AF.UNIX, std.posix.SOCK.STREAM, 0, &fds_);
    if (rc != 0) {
        const err = bun.sys.Error.fromCode(bun.sys.getErrno(rc), .socketpair);
        return global.throwValue(try err.toJS(global));
    }

    _ = bun.FD.fromNative(fds_[0]).updateNonblocking(true);
    _ = bun.FD.fromNative(fds_[1]).updateNonblocking(true);

    const array = try jsc.JSValue.createEmptyArray(global, 2);
    try array.putIndex(global, 0, .jsNumber(fds_[0]));
    try array.putIndex(global, 1, .jsNumber(fds_[1]));
    return array;
}

pub fn jsSetSocketOptions(global: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();

    if (arguments.len < 3) {
        return global.throwNotEnoughArguments("setSocketOptions", 3, arguments.len);
    }

    const socket = arguments.ptr[0].as(TCPSocket) orelse {
        return global.throw("Expected a SocketTCP instance", .{});
    };

    const is_for_send_buffer = arguments.ptr[1].toInt32() == 1;
    const is_for_recv_buffer = arguments.ptr[1].toInt32() == 2;
    const buffer_size = arguments.ptr[2].toInt32();
    const file_descriptor = socket.socket.fd();

    if (bun.Environment.isPosix) {
        if (is_for_send_buffer) {
            const result = bun.sys.setsockopt(file_descriptor, std.posix.SOL.SOCKET, std.posix.SO.SNDBUF, buffer_size);
            if (result.asErr()) |err| {
                return global.throwValue(try err.toJS(global));
            }
        } else if (is_for_recv_buffer) {
            const result = bun.sys.setsockopt(file_descriptor, std.posix.SOL.SOCKET, std.posix.SO.RCVBUF, buffer_size);
            if (result.asErr()) |err| {
                return global.throwValue(try err.toJS(global));
            }
        }
    }

    return .js_undefined;
}

const string = []const u8;

const std = @import("std");
const tls_socket_functions = @import("./socket/tls_socket_functions.zig");
const H2FrameParser = @import("./h2_frame_parser.zig").H2FrameParser;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const uws = bun.uws;
const BoringSSL = bun.BoringSSL.c;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
