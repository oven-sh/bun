pub fn NewSocketHandler(comptime is_ssl: bool) type {
    return struct {
        const ssl_int: i32 = @intFromBool(is_ssl);

        socket: InternalSocket,

        const ThisSocket = @This();

        pub const detached: NewSocketHandler(is_ssl) = NewSocketHandler(is_ssl){ .socket = .{ .detached = {} } };

        pub fn setNoDelay(this: ThisSocket, enabled: bool) bool {
            return this.socket.setNoDelay(enabled);
        }

        pub fn setKeepAlive(this: ThisSocket, enabled: bool, delay: u32) bool {
            return this.socket.setKeepAlive(enabled, delay);
        }

        pub fn pauseStream(this: ThisSocket) bool {
            return this.socket.pauseResume(is_ssl, true);
        }

        pub fn resumeStream(this: ThisSocket) bool {
            return this.socket.pauseResume(is_ssl, false);
        }

        pub fn detach(this: *ThisSocket) void {
            this.socket.detach();
        }

        pub fn isDetached(this: ThisSocket) bool {
            return this.socket.isDetached();
        }

        pub fn isNamedPipe(this: ThisSocket) bool {
            return this.socket.isNamedPipe();
        }

        pub fn getVerifyError(this: ThisSocket) uws.us_bun_verify_error_t {
            switch (this.socket) {
                .connected => |socket| return socket.getVerifyError(is_ssl),
                .upgradedDuplex => |socket| return socket.sslError(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.sslError() else return std.mem.zeroes(us_bun_verify_error_t),
                .connecting, .detached => return std.mem.zeroes(us_bun_verify_error_t),
            }
        }

        pub fn isEstablished(this: ThisSocket) bool {
            switch (this.socket) {
                .connected => |socket| return socket.isEstablished(comptime is_ssl),
                .upgradedDuplex => |socket| return socket.isEstablished(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.isEstablished() else return false,
                .connecting, .detached => return false,
            }
        }

        pub fn timeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
                .connected => |socket| socket.setTimeout(is_ssl, seconds),
                .connecting => |socket| socket.timeout(is_ssl, seconds),
                .detached => {},
            }
        }

        pub fn setTimeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    if (seconds > 240) {
                        socket.setTimeout(is_ssl, 0);
                        socket.setLongTimeout(is_ssl, seconds / 60);
                    } else {
                        socket.setTimeout(is_ssl, seconds);
                        socket.setLongTimeout(is_ssl, 0);
                    }
                },
                .connecting => |socket| {
                    if (seconds > 240) {
                        socket.timeout(is_ssl, 0);
                        socket.longTimeout(is_ssl, seconds / 60);
                    } else {
                        socket.timeout(is_ssl, seconds);
                        socket.longTimeout(is_ssl, 0);
                    }
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
            }
        }

        pub fn setTimeoutMinutes(this: ThisSocket, minutes: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    socket.setTimeout(is_ssl, 0);
                    socket.setLongTimeout(is_ssl, minutes);
                },
                .connecting => |socket| {
                    socket.timeout(is_ssl, 0);
                    socket.longTimeout(is_ssl, minutes);
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(minutes * 60),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(minutes * 60),
            }
        }

        pub fn startTLS(this: ThisSocket, is_client: bool) void {
            if (this.socket.get()) |socket| socket.open(is_ssl, is_client, null);
        }

        pub fn ssl(this: ThisSocket) ?*BoringSSL.SSL {
            if (comptime is_ssl) {
                if (this.getNativeHandle()) |handle| {
                    return @as(*BoringSSL.SSL, @ptrCast(handle));
                }
                return null;
            }
            return null;
        }

        // Note: this assumes that the socket is non-TLS and will be adopted and wrapped with a new TLS context
        // context ext will not be copied to the new context, new context will contain us_wrapped_socket_context_t on ext
        pub fn wrapTLS(
            this: ThisSocket,
            options: SocketContext.BunSocketContextOptions,
            socket_ext_size: i32,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) ?NewSocketHandler(true) {
            const TLSSocket = NewSocketHandler(true);
            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *us_socket_t) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return socket.ext(true);
                    }

                    if (comptime deref_) {
                        return (TLSSocket.from(socket)).ext(ContextType).?.*;
                    }

                    return (TLSSocket.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *us_socket_t, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*us_socket_t {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                TLSSocket.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *us_socket_t, code: i32, reason: ?*anyopaque) callconv(.C) ?*us_socket_t {
                    Fields.onClose(
                        getValue(socket),
                        TLSSocket.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *us_socket_t, buf: ?[*]u8, len: i32) callconv(.C) ?*us_socket_t {
                    Fields.onData(
                        getValue(socket),
                        TLSSocket.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onWritable(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onTimeout(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_long_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onLongTimeout(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *us_socket_t, code: i32) callconv(.C) ?*us_socket_t {
                    Fields.onConnectError(
                        TLSSocket.from(socket).ext(ContextType).?.*,
                        TLSSocket.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    Fields.onConnectError(
                        @as(*align(alignment) ContextType, @ptrCast(@alignCast(socket.ext(comptime is_ssl)))).*,
                        TLSSocket.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onEnd(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *us_socket_t, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), TLSSocket.from(socket), success, verify_error);
                }
            };

            const events: c.us_socket_events_t = .{
                .on_open = SocketHandler.on_open,
                .on_close = SocketHandler.on_close,
                .on_data = SocketHandler.on_data,
                .on_writable = SocketHandler.on_writable,
                .on_timeout = SocketHandler.on_timeout,
                .on_connect_error = SocketHandler.on_connect_error,
                .on_connect_error_connecting_socket = SocketHandler.on_connect_error_connecting_socket,
                .on_end = SocketHandler.on_end,
                .on_handshake = SocketHandler.on_handshake,
                .on_long_timeout = SocketHandler.on_long_timeout,
            };

            const this_socket = this.socket.get() orelse return null;

            const socket = c.us_socket_wrap_with_tls(ssl_int, this_socket, options, events, socket_ext_size) orelse return null;
            return NewSocketHandler(true).from(socket);
        }

        pub fn getNativeHandle(this: ThisSocket) ?*NativeSocketHandleType(is_ssl) {
            return @ptrCast(switch (this.socket) {
                .connected => |socket| socket.getNativeHandle(is_ssl),
                .connecting => |socket| socket.getNativeHandle(is_ssl),
                .detached => null,
                .upgradedDuplex => |socket| if (is_ssl) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
                .pipe => |socket| if (is_ssl and Environment.isWindows) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
            } orelse return null);
        }

        pub inline fn fd(this: ThisSocket) bun.FileDescriptor {
            if (comptime is_ssl) {
                @compileError("SSL sockets do not have a file descriptor accessible this way");
            }
            const socket = this.socket.get() orelse return bun.invalid_fd;

            // on windows uSockets exposes SOCKET
            return if (comptime Environment.isWindows)
                .fromNative(@ptrCast(socket.getNativeHandle(is_ssl).?))
            else
                .fromNative(@intCast(@intFromPtr(socket.getNativeHandle(is_ssl))));
        }

        pub fn markNeedsMoreForSendfile(this: ThisSocket) void {
            if (comptime is_ssl) {
                @compileError("SSL sockets do not support sendfile yet");
            }
            const socket = this.socket.get() orelse return;
            socket.sendFileNeedsMore();
        }

        pub fn ext(this: ThisSocket, comptime ContextType: type) ?*ContextType {
            const alignment = if (ContextType == *anyopaque)
                @sizeOf(usize)
            else
                std.meta.alignment(ContextType);

            const ptr = switch (this.socket) {
                .connected => |sock| sock.ext(is_ssl),
                .connecting => |sock| sock.ext(is_ssl),
                .detached => return null,
                .upgradedDuplex => return null,
                .pipe => return null,
            };

            return @as(*align(alignment) ContextType, @ptrCast(@alignCast(ptr)));
        }

        /// This can be null if the socket was closed.
        pub fn context(this: ThisSocket) ?*SocketContext {
            switch (this.socket) {
                .connected => |socket| return socket.context(is_ssl),
                .connecting => |socket| return socket.context(is_ssl),
                .detached => return null,
                .upgradedDuplex => return null,
                .pipe => return null,
            }
        }

        pub fn flush(this: ThisSocket) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| socket.flush(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.flush(),
                .connected => |socket| socket.flush(is_ssl),
                .connecting, .detached => return,
            }
        }

        pub fn write(this: ThisSocket, data: []const u8, msg_more: bool) i32 {
            return switch (this.socket) {
                .upgradedDuplex => |socket| socket.encodeAndWrite(data, msg_more),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.encodeAndWrite(data, msg_more) else 0,
                .connected => |socket| socket.write(is_ssl, data, msg_more),
                .connecting, .detached => 0,
            };
        }

        pub fn writeFd(this: ThisSocket, data: []const u8, file_descriptor: bun.FileDescriptor) i32 {
            return switch (this.socket) {
                .upgradedDuplex, .pipe => this.write(data, false),
                .connected => |socket| socket.writeFd(data, file_descriptor),
                .connecting, .detached => 0,
            };
        }

        pub fn rawWrite(this: ThisSocket, data: []const u8, msg_more: bool) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.rawWrite(is_ssl, data, msg_more),
                .connecting, .detached => 0,
                .upgradedDuplex => |socket| socket.rawWrite(data, msg_more),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.rawWrite(data, msg_more) else 0,
            };
        }

        pub fn shutdown(this: ThisSocket) void {
            switch (this.socket) {
                .connected => |socket| socket.shutdown(is_ssl),
                .connecting => |socket| {
                    debug("us_connecting_socket_shutdown({d})", .{@intFromPtr(socket)});
                    return socket.shutdown(is_ssl);
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.shutdown(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.shutdown(),
            }
        }

        pub fn shutdownRead(this: ThisSocket) void {
            switch (this.socket) {
                .connected => |socket| socket.shutdownRead(is_ssl),
                .connecting => |socket| {
                    debug("us_connecting_socket_shutdown_read({d})", .{@intFromPtr(socket)});
                    return socket.shutdownRead(is_ssl);
                },
                .upgradedDuplex => |socket| socket.shutdownRead(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.shutdownRead(),
                .detached => {},
            }
        }

        pub fn isShutdown(this: ThisSocket) bool {
            return switch (this.socket) {
                .connected => |socket| socket.isShutdown(is_ssl),
                .connecting => |socket| blk: {
                    debug("us_connecting_socket_is_shut_down({d})", .{@intFromPtr(socket)});
                    break :blk socket.isShutdown(is_ssl);
                },
                .upgradedDuplex => |socket| socket.isShutdown(),
                .pipe => |pipe| return if (Environment.isWindows) pipe.isShutdown() else false,
                .detached => true,
            };
        }

        pub fn isClosedOrHasError(this: ThisSocket) bool {
            if (this.isClosed() or this.isShutdown()) {
                return true;
            }

            return this.getError() != 0;
        }

        pub fn getError(this: ThisSocket) i32 {
            switch (this.socket) {
                .connected => |socket| {
                    debug("us_socket_get_error({d})", .{@intFromPtr(socket)});
                    return socket.getError(is_ssl);
                },
                .connecting => |socket| {
                    debug("us_connecting_socket_get_error({d})", .{@intFromPtr(socket)});
                    return socket.getError(is_ssl);
                },
                .detached => return 0,
                .upgradedDuplex => |socket| {
                    return socket.sslError().error_no;
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.sslError().error_no else 0;
                },
            }
        }

        pub fn isClosed(this: ThisSocket) bool {
            return this.socket.isClosed(comptime is_ssl);
        }

        pub fn close(this: ThisSocket, code: us_socket_t.CloseCode) void {
            return this.socket.close(comptime is_ssl, code);
        }

        pub fn localPort(this: ThisSocket) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.localPort(is_ssl),
                .pipe, .upgradedDuplex, .connecting, .detached => 0,
            };
        }

        pub fn remotePort(this: ThisSocket) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.remotePort(is_ssl),
                .pipe, .upgradedDuplex, .connecting, .detached => 0,
            };
        }

        /// `buf` cannot be longer than 2^31 bytes long.
        pub fn remoteAddress(this: ThisSocket, buf: []u8) ?[]const u8 {
            return switch (this.socket) {
                .connected => |sock| sock.remoteAddress(is_ssl, buf) catch |e| {
                    bun.Output.panic("Failed to get socket's remote address: {s}", .{@errorName(e)});
                },
                .pipe, .upgradedDuplex, .connecting, .detached => null,
            };
        }

        /// Get the local address of a socket in binary format.
        ///
        /// # Arguments
        /// - `buf`: A buffer to store the binary address data.
        ///
        /// # Returns
        /// This function returns a slice of the buffer on success, or null on failure.
        pub fn localAddress(this: ThisSocket, buf: []u8) ?[]const u8 {
            return switch (this.socket) {
                .connected => |sock| sock.localAddress(is_ssl, buf) catch |e| {
                    bun.Output.panic("Failed to get socket's local address: {s}", .{@errorName(e)});
                },
                .pipe, .upgradedDuplex, .connecting, .detached => null,
            };
        }

        pub fn connect(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: Context,
            comptime socket_field_name: []const u8,
            allowHalfOpen: bool,
        ) ?*Context {
            debug("connect({s}, {d})", .{ host, port });

            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();

            // remove brackets from IPv6 addresses, as getaddrinfo doesn't understand them
            const clean_host = if (host.len > 1 and host[0] == '[' and host[host.len - 1] == ']')
                host[1 .. host.len - 1]
            else
                host;

            const host_ = allocator.dupeZ(u8, clean_host) catch bun.outOfMemory();
            defer allocator.free(host);

            var did_dns_resolve: i32 = 0;
            const socket = socket_ctx.connect(is_ssl, host_, port, if (allowHalfOpen) uws.LIBUS_SOCKET_ALLOW_HALF_OPEN else 0, @sizeOf(Context), &did_dns_resolve) orelse return null;
            const socket_ = if (did_dns_resolve == 1)
                ThisSocket{
                    .socket = .{ .connected = @ptrCast(socket) },
                }
            else
                ThisSocket{
                    .socket = .{ .connecting = @ptrCast(socket) },
                };

            var holder = socket_.ext(Context);
            holder.* = ctx;
            @field(holder, socket_field_name) = socket_;
            return holder;
        }

        pub fn connectPtr(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: *Context,
            comptime socket_field_name: []const u8,
            allowHalfOpen: bool,
        ) !*Context {
            const this_socket = try connectAnon(host, port, socket_ctx, ctx, allowHalfOpen);
            @field(ctx, socket_field_name) = this_socket;
            return ctx;
        }

        pub fn fromDuplex(
            duplex: *UpgradedDuplex,
        ) ThisSocket {
            return ThisSocket{ .socket = .{ .upgradedDuplex = duplex } };
        }

        pub fn fromNamedPipe(
            pipe: *WindowsNamedPipe,
        ) ThisSocket {
            if (Environment.isWindows) {
                return ThisSocket{ .socket = .{ .pipe = pipe } };
            }
            @compileError("WindowsNamedPipe is only available on Windows");
        }

        pub fn fromFd(
            ctx: *SocketContext,
            handle: bun.FileDescriptor,
            comptime This: type,
            this: *This,
            comptime socket_field_name: ?[]const u8,
            is_ipc: bool,
        ) ?ThisSocket {
            const socket_ = ThisSocket{
                .socket = .{
                    .connected = us_socket_t.fromFd(
                        ctx,
                        @sizeOf(*anyopaque),
                        handle.native(),
                        @intFromBool(is_ipc),
                    ) orelse return null,
                },
            };

            if (socket_.ext(*anyopaque)) |holder| {
                holder.* = this;
            }

            if (comptime socket_field_name) |field| {
                @field(this, field) = socket_;
            }

            return socket_;
        }

        pub fn connectUnixPtr(
            path: []const u8,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: *Context,
            comptime socket_field_name: []const u8,
        ) !*Context {
            const this_socket = try connectUnixAnon(path, socket_ctx, ctx);
            @field(ctx, socket_field_name) = this_socket;
            return ctx;
        }

        pub fn connectUnixAnon(
            path: []const u8,
            socket_ctx: *SocketContext,
            ctx: *anyopaque,
            allowHalfOpen: bool,
        ) !ThisSocket {
            debug("connect(unix:{s})", .{path});
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();
            const path_ = allocator.dupeZ(u8, path) catch bun.outOfMemory();
            defer allocator.free(path_);

            const socket = socket_ctx.connectUnix(is_ssl, path_, if (allowHalfOpen) uws.LIBUS_SOCKET_ALLOW_HALF_OPEN else 0, 8) orelse
                return error.FailedToOpenSocket;

            const socket_ = ThisSocket{ .socket = .{ .connected = socket } };
            if (socket_.ext(*anyopaque)) |holder| {
                holder.* = ctx;
            }
            return socket_;
        }

        pub fn connectAnon(
            raw_host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            ptr: *anyopaque,
            allowHalfOpen: bool,
        ) !ThisSocket {
            debug("connect({s}, {d})", .{ raw_host, port });
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();

            // remove brackets from IPv6 addresses, as getaddrinfo doesn't understand them
            const clean_host = if (raw_host.len > 1 and raw_host[0] == '[' and raw_host[raw_host.len - 1] == ']')
                raw_host[1 .. raw_host.len - 1]
            else
                raw_host;

            const host = allocator.dupeZ(u8, clean_host) catch bun.outOfMemory();
            defer allocator.free(host);

            var did_dns_resolve: i32 = 0;
            const socket_ptr = socket_ctx.connect(
                is_ssl,
                host.ptr,
                port,
                if (allowHalfOpen) uws.LIBUS_SOCKET_ALLOW_HALF_OPEN else 0,
                @sizeOf(*anyopaque),
                &did_dns_resolve,
            ) orelse return error.FailedToOpenSocket;
            const socket = if (did_dns_resolve == 1)
                ThisSocket{
                    .socket = .{ .connected = @ptrCast(socket_ptr) },
                }
            else
                ThisSocket{
                    .socket = .{ .connecting = @ptrCast(socket_ptr) },
                };
            if (socket.ext(*anyopaque)) |holder| {
                holder.* = ptr;
            }
            return socket;
        }

        pub fn unsafeConfigure(
            ctx: *SocketContext,
            comptime ssl_type: bool,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) void {
            const SocketHandlerType = NewSocketHandler(ssl_type);
            const Type = comptime if (@TypeOf(Fields) != type) @TypeOf(Fields) else Fields;

            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *us_socket_t) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return socket.ext(is_ssl);
                    }

                    if (comptime deref_) {
                        return (SocketHandlerType.from(socket)).ext(ContextType).?.*;
                    }

                    return (SocketHandlerType.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *us_socket_t, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*us_socket_t {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                SocketHandlerType.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *us_socket_t, code: i32, reason: ?*anyopaque) callconv(.C) ?*us_socket_t {
                    Fields.onClose(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *us_socket_t, buf: ?[*]u8, len: i32) callconv(.C) ?*us_socket_t {
                    Fields.onData(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onWritable(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onTimeout(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    const val = if (comptime ContextType == anyopaque)
                        socket.ext(comptime is_ssl)
                    else if (comptime deref_)
                        SocketHandlerType.fromConnecting(socket).ext(ContextType).?.*
                    else
                        SocketHandlerType.fromConnecting(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        SocketHandlerType.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *us_socket_t, code: i32) callconv(.C) ?*us_socket_t {
                    const val = if (comptime ContextType == anyopaque)
                        socket.ext(is_ssl)
                    else if (comptime deref_)
                        SocketHandlerType.from(socket).ext(ContextType).?.*
                    else
                        SocketHandlerType.from(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        SocketHandlerType.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onEnd(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *us_socket_t, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), SocketHandlerType.from(socket), success, verify_error);
                }
            };

            if (@typeInfo(@TypeOf(Type.onOpen)) != .null)
                ctx.onOpen(is_ssl, SocketHandler.on_open);
            if (@typeInfo(@TypeOf(Type.onClose)) != .null)
                ctx.onClose(is_ssl, SocketHandler.on_close);
            if (@typeInfo(@TypeOf(Type.onData)) != .null)
                ctx.onData(is_ssl, SocketHandler.on_data);
            if (@typeInfo(@TypeOf(Type.onFd)) != .null)
                ctx.onFd(is_ssl, SocketHandler.on_fd);
            if (@typeInfo(@TypeOf(Type.onWritable)) != .null)
                ctx.onWritable(is_ssl, SocketHandler.on_writable);
            if (@typeInfo(@TypeOf(Type.onTimeout)) != .null)
                ctx.onTimeout(is_ssl, SocketHandler.on_timeout);
            if (@typeInfo(@TypeOf(Type.onConnectError)) != .null) {
                ctx.onSocketConnectError(is_ssl, SocketHandler.on_connect_error);
                ctx.onConnectError(is_ssl, SocketHandler.on_connect_error_connecting_socket);
            }
            if (@typeInfo(@TypeOf(Type.onEnd)) != .null)
                ctx.onEnd(is_ssl, SocketHandler.on_end);
            if (@typeInfo(@TypeOf(Type.onHandshake)) != .null)
                ctx.onHandshake(is_ssl, SocketHandler.on_handshake);
        }

        pub fn configure(
            ctx: *SocketContext,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) void {
            const Type = comptime if (@TypeOf(Fields) != type) @TypeOf(Fields) else Fields;

            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *us_socket_t) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return socket.ext(is_ssl);
                    }

                    if (comptime deref_) {
                        return (ThisSocket.from(socket)).ext(ContextType).?.*;
                    }

                    return (ThisSocket.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *us_socket_t, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*us_socket_t {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                ThisSocket.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *us_socket_t, code: i32, reason: ?*anyopaque) callconv(.C) ?*us_socket_t {
                    Fields.onClose(
                        getValue(socket),
                        ThisSocket.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *us_socket_t, buf: ?[*]u8, len: i32) callconv(.C) ?*us_socket_t {
                    Fields.onData(
                        getValue(socket),
                        ThisSocket.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_fd(socket: *us_socket_t, file_descriptor: c_int) callconv(.C) ?*us_socket_t {
                    Fields.onFd(
                        getValue(socket),
                        ThisSocket.from(socket),
                        file_descriptor,
                    );
                    return socket;
                }
                pub fn on_writable(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onWritable(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onTimeout(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_long_timeout(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onLongTimeout(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    const val = if (comptime ContextType == anyopaque)
                        socket.ext(comptime is_ssl)
                    else if (comptime deref_)
                        ThisSocket.fromConnecting(socket).ext(ContextType).?.*
                    else
                        ThisSocket.fromConnecting(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        ThisSocket.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *us_socket_t, code: i32) callconv(.C) ?*us_socket_t {
                    const val = if (comptime ContextType == anyopaque)
                        socket.ext(is_ssl)
                    else if (comptime deref_)
                        ThisSocket.from(socket).ext(ContextType).?.*
                    else
                        ThisSocket.from(socket).ext(ContextType);

                    // We close immediately in this case
                    // uSockets doesn't know if this is a TLS socket or not.
                    // So we need to close it like a TCP socket.
                    NewSocketHandler(false).from(socket).close(.failure);

                    Fields.onConnectError(
                        val,
                        ThisSocket.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *us_socket_t) callconv(.C) ?*us_socket_t {
                    Fields.onEnd(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *us_socket_t, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), ThisSocket.from(socket), success, verify_error);
                }
            };

            if (comptime @hasDecl(Type, "onOpen") and @typeInfo(@TypeOf(Type.onOpen)) != .null)
                ctx.onOpen(is_ssl, SocketHandler.on_open);
            if (comptime @hasDecl(Type, "onClose") and @typeInfo(@TypeOf(Type.onClose)) != .null)
                ctx.onClose(is_ssl, SocketHandler.on_close);
            if (comptime @hasDecl(Type, "onData") and @typeInfo(@TypeOf(Type.onData)) != .null)
                ctx.onData(is_ssl, SocketHandler.on_data);
            if (comptime @hasDecl(Type, "onFd") and @typeInfo(@TypeOf(Type.onFd)) != .null)
                ctx.onFd(is_ssl, SocketHandler.on_fd);
            if (comptime @hasDecl(Type, "onWritable") and @typeInfo(@TypeOf(Type.onWritable)) != .null)
                ctx.onWritable(is_ssl, SocketHandler.on_writable);
            if (comptime @hasDecl(Type, "onTimeout") and @typeInfo(@TypeOf(Type.onTimeout)) != .null)
                ctx.onTimeout(is_ssl, SocketHandler.on_timeout);
            if (comptime @hasDecl(Type, "onConnectError") and @typeInfo(@TypeOf(Type.onConnectError)) != .null) {
                ctx.onSocketConnectError(is_ssl, SocketHandler.on_connect_error);
                ctx.onConnectError(is_ssl, SocketHandler.on_connect_error_connecting_socket);
            }
            if (comptime @hasDecl(Type, "onEnd") and @typeInfo(@TypeOf(Type.onEnd)) != .null)
                ctx.onEnd(is_ssl, SocketHandler.on_end);
            if (comptime @hasDecl(Type, "onHandshake") and @typeInfo(@TypeOf(Type.onHandshake)) != .null)
                ctx.onHandshake(is_ssl, SocketHandler.on_handshake);
            if (comptime @hasDecl(Type, "onLongTimeout") and @typeInfo(@TypeOf(Type.onLongTimeout)) != .null)
                ctx.onLongTimeout(is_ssl, SocketHandler.on_long_timeout);
        }

        pub fn from(socket: *us_socket_t) ThisSocket {
            return ThisSocket{ .socket = .{ .connected = socket } };
        }

        pub fn fromConnecting(connecting: *ConnectingSocket) ThisSocket {
            return ThisSocket{ .socket = .{ .connecting = connecting } };
        }

        pub fn fromAny(socket: InternalSocket) ThisSocket {
            return ThisSocket{ .socket = socket };
        }

        pub fn adoptPtr(
            socket: *us_socket_t,
            socket_ctx: *SocketContext,
            comptime Context: type,
            comptime socket_field_name: []const u8,
            ctx: *Context,
        ) bool {
            // ext_size of -1 means we want to keep the current ext size
            // in particular, we don't want to allocate a new socket
            const new_socket = socket_ctx.adoptSocket(comptime is_ssl, socket, -1) orelse return false;
            bun.assert(new_socket == socket);
            var adopted = ThisSocket.from(new_socket);
            if (adopted.ext(*anyopaque)) |holder| {
                holder.* = ctx;
            }
            @field(ctx, socket_field_name) = adopted;
            return true;
        }
    };
}
pub const SocketTCP = NewSocketHandler(false);
pub const SocketTLS = NewSocketHandler(true);

pub const InternalSocket = union(enum) {
    connected: *us_socket_t,
    connecting: *ConnectingSocket,
    detached: void,
    upgradedDuplex: *uws.UpgradedDuplex,
    pipe: if (Environment.isWindows) *uws.WindowsNamedPipe else void,

    pub fn pauseResume(this: InternalSocket, ssl: bool, pause: bool) bool {
        switch (this) {
            .detached => return true,
            .connected => |socket| {
                if (pause) socket.pause(ssl) else socket.@"resume"(ssl);
                return true;
            },
            .connecting => |_| {
                // always return false for connecting sockets
                return false;
            },
            .upgradedDuplex => |_| {
                // TODO: pause and resume upgraded duplex
                return false;
            },
            .pipe => |pipe| {
                if (Environment.isWindows) {
                    if (pause) {
                        return pipe.pauseStream();
                    }
                    return pipe.resumeStream();
                }
                return false;
            },
        }
    }
    pub fn isDetached(this: InternalSocket) bool {
        return this == .detached;
    }
    pub fn isNamedPipe(this: InternalSocket) bool {
        return this == .pipe;
    }
    pub fn detach(this: *InternalSocket) void {
        this.* = .detached;
    }
    pub fn setNoDelay(this: InternalSocket, enabled: bool) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| {
                // only supported by connected sockets
                socket.setNodelay(enabled);
                return true;
            },
        }
    }
    pub fn setKeepAlive(this: InternalSocket, enabled: bool, delay: u32) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| {
                // only supported by connected sockets and can fail
                return socket.setKeepalive(enabled, delay) == 0;
            },
        }
    }
    pub fn close(this: InternalSocket, comptime is_ssl: bool, code: us_socket_t.CloseCode) void {
        switch (this) {
            .detached => {},
            .connected => |socket| {
                socket.close(is_ssl, code);
            },
            .connecting => |socket| {
                socket.close(is_ssl);
            },
            .upgradedDuplex => |socket| {
                socket.close();
            },
            .pipe => |pipe| {
                if (Environment.isWindows) pipe.close();
            },
        }
    }

    pub fn isClosed(this: InternalSocket, comptime is_ssl: bool) bool {
        return switch (this) {
            .connected => |socket| socket.isClosed(is_ssl),
            .connecting => |socket| socket.isClosed(is_ssl),
            .detached => true,
            .upgradedDuplex => |socket| socket.isClosed(),
            .pipe => |pipe| if (Environment.isWindows) pipe.isClosed() else true,
        };
    }

    pub fn get(this: @This()) ?*us_socket_t {
        return switch (this) {
            .connected => this.connected,
            .connecting => null,
            .detached => null,
            .upgradedDuplex => null,
            .pipe => null,
        };
    }

    pub fn eq(this: @This(), other: @This()) bool {
        return switch (this) {
            .connected => switch (other) {
                .connected => this.connected == other.connected,
                .upgradedDuplex, .connecting, .detached, .pipe => false,
            },
            .connecting => switch (other) {
                .upgradedDuplex, .connected, .detached, .pipe => false,
                .connecting => this.connecting == other.connecting,
            },
            .detached => switch (other) {
                .detached => true,
                .upgradedDuplex, .connected, .connecting, .pipe => false,
            },
            .upgradedDuplex => switch (other) {
                .upgradedDuplex => this.upgradedDuplex == other.upgradedDuplex,
                .connected, .connecting, .detached, .pipe => false,
            },
            .pipe => switch (other) {
                .pipe => if (Environment.isWindows) other.pipe == other.pipe else false,
                .connected, .connecting, .detached, .upgradedDuplex => false,
            },
        };
    }
};

/// TODO: rename to ConnectedSocket
pub const AnySocket = union(enum) {
    SocketTCP: SocketTCP,
    SocketTLS: SocketTLS,

    pub fn setTimeout(this: AnySocket, seconds: c_uint) void {
        switch (this) {
            .SocketTCP => this.SocketTCP.setTimeout(seconds),
            .SocketTLS => this.SocketTLS.setTimeout(seconds),
        }
    }

    pub fn shutdown(this: AnySocket) void {
        switch (this) {
            .SocketTCP => |sock| sock.shutdown(),
            .SocketTLS => |sock| sock.shutdown(),
        }
    }

    pub fn shutdownRead(this: AnySocket) void {
        switch (this) {
            .SocketTCP => |sock| sock.shutdownRead(),
            .SocketTLS => |sock| sock.shutdownRead(),
        }
    }

    pub fn isShutdown(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => this.SocketTCP.isShutdown(),
            .SocketTLS => this.SocketTLS.isShutdown(),
        };
    }
    pub fn isClosed(this: AnySocket) bool {
        return switch (this) {
            inline else => |s| s.isClosed(),
        };
    }
    pub fn close(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.normal),
        }
    }

    pub fn terminate(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.failure),
        }
    }

    pub fn write(this: AnySocket, data: []const u8, msg_more: bool) i32 {
        return switch (this) {
            .SocketTCP => |sock| sock.write(data, msg_more),
            .SocketTLS => |sock| sock.write(data, msg_more),
        };
    }

    pub fn getNativeHandle(this: AnySocket) ?*anyopaque {
        return switch (this.socket()) {
            .connected => |sock| sock.getNativeHandle(this.isSSL()),
            else => null,
        };
    }

    pub fn localPort(this: AnySocket) i32 {
        switch (this) {
            .SocketTCP => |sock| sock.localPort(),
            .SocketTLS => |sock| sock.localPort(),
        }
    }

    pub fn isSSL(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => false,
            .SocketTLS => true,
        };
    }

    pub fn socket(this: AnySocket) InternalSocket {
        return switch (this) {
            .SocketTCP => this.SocketTCP.socket,
            .SocketTLS => this.SocketTLS.socket,
        };
    }

    pub fn ext(this: AnySocket, comptime ContextType: type) ?*ContextType {
        const ptr = this.socket().ext(this.isSSL()) orelse return null;

        return @ptrCast(@alignCast(ptr));
    }

    pub fn context(this: AnySocket) *SocketContext {
        @setRuntimeSafety(true);
        return switch (this) {
            .SocketTCP => |sock| sock.context(),
            .SocketTLS => |sock| sock.context(),
        }.?;
    }
};

fn NativeSocketHandleType(comptime ssl: bool) type {
    if (ssl) {
        return BoringSSL.SSL;
    } else {
        return anyopaque;
    }
}

const us_socket_t = uws.us_socket_t;

const c = struct {
    pub const us_socket_events_t = extern struct {
        on_open: ?*const fn (*us_socket_t, i32, [*c]u8, i32) callconv(.C) ?*us_socket_t = null,
        on_data: ?*const fn (*us_socket_t, [*c]u8, i32) callconv(.C) ?*us_socket_t = null,
        on_writable: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t = null,
        on_close: ?*const fn (*us_socket_t, i32, ?*anyopaque) callconv(.C) ?*us_socket_t = null,

        on_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t = null,
        on_long_timeout: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t = null,
        on_end: ?*const fn (*us_socket_t) callconv(.C) ?*us_socket_t = null,
        on_connect_error: ?*const fn (*us_socket_t, i32) callconv(.C) ?*us_socket_t = null,
        on_connect_error_connecting_socket: ?*const fn (*ConnectingSocket, i32) callconv(.C) ?*ConnectingSocket = null,
        on_handshake: ?*const fn (*us_socket_t, i32, uws.us_bun_verify_error_t, ?*anyopaque) callconv(.C) void = null,
    };
    pub extern fn us_socket_wrap_with_tls(ssl: i32, s: *uws.us_socket_t, options: uws.SocketContext.BunSocketContextOptions, events: c.us_socket_events_t, socket_ext_size: i32) ?*uws.us_socket_t;
};

const bun = @import("bun");
const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const Environment = bun.Environment;
const SocketContext = uws.SocketContext;
const debug = bun.Output.scoped(.uws, false);
const std = @import("std");
const us_bun_verify_error_t = uws.us_bun_verify_error_t;
const BunSocketContextOptions = uws.SocketContext.BunSocketContextOptions;
const WindowsNamedPipe = uws.WindowsNamedPipe;
const UpgradedDuplex = uws.UpgradedDuplex;
const BoringSSL = bun.BoringSSL.c;
