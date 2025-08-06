pub const QuicSocket = struct {
    const This = @This();

    // JavaScript class bindings - following the same pattern as TCP/TLS sockets
    pub const js = jsc.Codegen.JSQuicSocket;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    // QUIC socket using uSockets QUIC API
    socket: ?*uws.quic.Socket = null,
    socket_context: ?*uws.quic.SocketContext = null,
    listen_socket: ?*uws.quic.ListenSocket = null,
    // Current stream for simple operations (will expand to support multiple streams)
    current_stream: ?*uws.quic.Stream = null,

    flags: Flags = .{},
    ref_count: RefCount,
    handlers: ?*QuicHandlers,
    this_value: jsc.JSValue = .zero,
    poll_ref: Async.KeepAlive = Async.KeepAlive.init(),

    // QUIC-specific fields
    server_name: ?[]const u8 = null,
    connection_id: ?[]const u8 = null,
    stream_count: u32 = 0,
    ssl_config: ?SSLConfig = null,

    has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

    pub const Flags = packed struct {
        is_server: bool = false,
        is_connected: bool = false,
        is_closed: bool = false,
        has_backpressure: bool = false,

        // QUIC-specific flags
        has_0rtt: bool = false,
        is_migration_capable: bool = false,

        _: u26 = 0,
    };

    pub fn hasPendingActivity(this: *This) callconv(.C) bool {
        return this.has_pending_activity.load(.acquire);
    }

    pub fn memoryCost(_: *This) usize {
        return @sizeOf(This);
    }

    pub fn finalize(this: *This) void {
        this.deinit();
    }

    pub fn deinit(this: *This) void {
        this.poll_ref.unref(jsc.VirtualMachine.get());

        if (this.handlers) |handlers| {
            handlers.unprotect();
            bun.default_allocator.destroy(handlers);
        }

        // Close QUIC socket if still open
        if (this.socket != null and !this.flags.is_closed) {
            this.closeImpl();
        }

        if (this.server_name) |server_name| {
            bun.default_allocator.free(server_name);
        }

        if (this.connection_id) |conn_id| {
            bun.default_allocator.free(conn_id);
        }

        if (this.ssl_config) |*ssl| {
            ssl.deinit();
        }
    }

    // Initialize a new QUIC socket
    pub fn init(allocator: std.mem.Allocator, handlers: *QuicHandlers) !*This {
        const this = try allocator.create(This);
        this.* = This{
            .ref_count = RefCount.init(),
            .handlers = handlers,
        };
        handlers.protect();
        return this;
    }

    // Create QUIC socket context with callbacks
    fn createContext(this: *This) !void {
        if (this.socket_context != null) return;

        const loop = uws.Loop.get();

        // Convert SSLConfig to BunSocketContextOptions
        var options: uws.BunSocketContextOptions = .{};
        
        if (this.ssl_config) |ssl| {
            log("QuicSocket: Using SSL config", .{});
            options = ssl.asUSockets();
        } else {
            log("QuicSocket: No SSL config", .{});
        }

        const context = uws.quic.SocketContext.create(loop, options, @sizeOf(*This)) orelse return error.ContextCreationFailed;

        this.socket_context = context;

        // Set up callbacks
        context.onOpen(&onSocketOpen);
        context.onClose(&onSocketClose);
        context.onConnection(&onSocketConnection);
        context.onStreamOpen(&onStreamOpen);
        context.onStreamData(&onStreamData);
        context.onStreamClose(&onStreamClose);
        context.onStreamEnd(&onStreamEnd);
        context.onStreamWritable(&onStreamWritable);

        // Store reference to this instance in context extension data
        const ext_data = context.ext();
        if (ext_data) |ext| {
            const this_ptr: **This = @ptrCast(@alignCast(ext));
            this_ptr.* = this;
            log("Stored QuicSocket instance {*} in context ext data at {*}", .{ this, ext });
        } else {
            log("ERROR: No extension data in context!", .{});
        }

        log("QUIC socket context created", .{});
    }

    // Connect to a QUIC server
    pub fn connectImpl(this: *This, hostname: []const u8, port: u16) !void {
        if (this.socket_context == null) {
            try this.createContext();
        }

        this.server_name = try bun.default_allocator.dupe(u8, hostname);

        // Convert hostname to null-terminated string for C API
        const hostname_cstr = try bun.default_allocator.dupeZ(u8, hostname);
        defer bun.default_allocator.free(hostname_cstr);

        // Create outgoing QUIC connection
        const socket = this.socket_context.?.connect(hostname_cstr.ptr, @intCast(port), @sizeOf(*This)) orelse return error.ConnectionFailed;

        this.socket = socket;

        // Note: Socket extension data access will be handled through the socket context
        // The this pointer is already stored in the context extension data

        log("QUIC connect to {s}:{} initiated", .{ hostname, port });
    }

    // Listen for QUIC connections (server mode)
    pub fn listenImpl(this: *This, hostname: []const u8, port: u16) !void {
        if (this.socket_context == null) {
            try this.createContext();
        }

        this.flags.is_server = true;

        // Convert hostname to null-terminated string for C API
        const hostname_cstr = try bun.default_allocator.dupeZ(u8, hostname);
        defer bun.default_allocator.free(hostname_cstr);

        // Start listening for QUIC connections
        const listen_socket = this.socket_context.?.listen(hostname_cstr.ptr, @intCast(port), @sizeOf(*This)) orelse return error.ListenFailed;

        this.listen_socket = listen_socket;

        log("QUIC listening on {s}:{}", .{ hostname, port });
        
        // Mark server as connected (listening) after successful bind
        if (this.flags.is_server) {
            this.flags.is_connected = true;
        }
        
        // Call the open handler for server listen sockets
        if (this.handlers) |handlers| {
            if (handlers.onOpen != .zero) {
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();

                // Ensure this_value is initialized
                if (this.this_value == .zero) {
                    this.this_value = this.toJS(handlers.globalObject);
                }

                _ = handlers.onOpen.call(handlers.globalObject, this.this_value, &.{this.this_value}) catch |err| {
                    const exception = handlers.globalObject.takeException(err);
                    this.callErrorHandler(exception);
                };
            }
        }
    }

    // Close the QUIC connection
    pub fn closeImpl(this: *This) void {
        if (this.flags.is_closed) return;
        this.flags.is_closed = true;
        this.has_pending_activity.store(false, .release);

        // Close current stream if exists
        if (this.current_stream) |stream| {
            stream.close();
            this.current_stream = null;
        }

        // Close socket (this will be handled by uSockets cleanup)
        this.socket = null;
        this.listen_socket = null;

        log("QUIC connection closed", .{});
    }

    // Write data to the QUIC connection
    pub fn writeImpl(this: *This, data: []const u8) !usize {
        log("writeImpl called, socket={any}, is_closed={}, is_connected={}", .{ this.socket, this.flags.is_closed, this.flags.is_connected });
        
        if (this.flags.is_closed) return error.SocketClosed;
        if (!this.flags.is_connected) return error.NotConnected;

        // Ensure we have a stream to write to
        if (this.current_stream == null) {
            log("No current stream, need to create one", .{});
            if (this.socket) |socket| {
                log("Calling createStream on socket {any}", .{socket});
                socket.createStream(0); // No extra data needed for stream extension
                // For now, return 0 bytes written since stream creation is async
                // The user should retry the write after the stream is created
                log("Stream not ready yet, creating new stream", .{});
                return 0;
            } else {
                log("No socket available", .{});
                return error.NoSocket;
            }
        }

        if (this.current_stream) |stream| {
            const bytes_written = stream.write(data);
            if (bytes_written < 0) {
                return error.WriteFailed;
            }
            return @intCast(bytes_written);
        }

        return 0; // Stream not ready yet
    }

    // Read data from the QUIC connection
    pub fn readImpl(this: *This, buffer: []u8) !usize {
        if (this.flags.is_closed) return error.SocketClosed;
        if (!this.flags.is_connected) return error.NotConnected;

        // QUIC reading is event-driven through the onStreamData callback
        // This method is kept for API compatibility but actual data comes through events
        _ = buffer; // Suppress unused variable warning
        log("QUIC read called - data comes through onStreamData events", .{});
        return 0;
    }

    // Create a new QUIC stream
    pub fn createStreamImpl(this: *This) !u32 {
        if (this.flags.is_closed) return error.SocketClosed;
        if (!this.flags.is_connected) return error.NotConnected;

        if (this.socket) |socket| {
            socket.createStream(@sizeOf(*uws.quic.Stream));
            this.stream_count += 1;
            log("QUIC stream #{} created", .{this.stream_count});
            return this.stream_count;
        }

        return error.NoSocket;
    }

    // Get connection statistics
    pub fn getQuicStats(this: *This) QuicStats {
        return QuicStats{
            .stream_count = this.stream_count,
            .is_connected = this.flags.is_connected,
            .has_0rtt = this.flags.has_0rtt,
            .bytes_sent = 0, // TODO: Track actual bytes
            .bytes_received = 0, // TODO: Track actual bytes
        };
    }

    // JavaScript method bindings
    pub fn connect(this: *This, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 2) return globalThis.throw("connect requires hostname and port", .{});

        const hostname_js = args.ptr[0];
        const port_js = args.ptr[1];

        if (!hostname_js.isString()) return globalThis.throw("hostname must be a string", .{});
        if (!port_js.isNumber()) return globalThis.throw("port must be a number", .{});

        var hostname_slice = try hostname_js.getZigString(globalThis);
        const hostname = hostname_slice.slice();
        const port = port_js.to(u16);

        this.connectImpl(hostname, port) catch |err| {
            return globalThis.throwError(err, "Failed to connect");
        };

        return .js_undefined;
    }

    pub fn listen(this: *This, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 2) return globalThis.throw("listen requires hostname and port", .{});

        const hostname_js = args.ptr[0];
        const port_js = args.ptr[1];

        if (!hostname_js.isString()) return globalThis.throw("hostname must be a string", .{});
        if (!port_js.isNumber()) return globalThis.throw("port must be a number", .{});

        var hostname_slice = try hostname_js.getZigString(globalThis);
        const hostname = hostname_slice.slice();
        const port = port_js.to(u16);

        this.listenImpl(hostname, port) catch |err| {
            return globalThis.throwError(err, "Failed to listen");
        };

        return .js_undefined;
    }

    pub fn write(this: *This, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        log("write() called on QuicSocket, this={x}", .{@intFromPtr(this)});
        const args = callframe.arguments();
        if (args.len < 1) return globalThis.throw("write requires data", .{});

        const data_js = args.ptr[0];
        if (data_js.isEmptyOrUndefinedOrNull()) {
            return globalThis.throw("data cannot be null or undefined", .{});
        }

        // Convert JS value to byte array
        var data_slice: []const u8 = undefined;

        if (data_js.asArrayBuffer(globalThis)) |array_buffer| {
            data_slice = array_buffer.slice();
        } else if (data_js.isString()) {
            var zig_str = try data_js.getZigString(globalThis);
            data_slice = zig_str.slice();
        } else {
            return globalThis.throw("data must be a string or ArrayBuffer", .{});
        }

        const bytes_written = this.writeImpl(data_slice) catch |err| {
            return switch (err) {
                error.SocketClosed => globalThis.throw("Socket is closed", .{}),
                error.NotConnected => globalThis.throw("Socket is not connected", .{}),
                error.NoSocket => globalThis.throw("No socket available", .{}),
                error.WriteFailed => globalThis.throw("Write operation failed", .{}),
            };
        };

        return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(bytes_written)));
    }

    pub fn read(this: *This, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        // QUIC reading is event-driven, so this just returns status info
        const bytes_read = this.readImpl(&[_]u8{}) catch |err| {
            return switch (err) {
                error.SocketClosed => globalThis.throw("Socket is closed", .{}),
                error.NotConnected => globalThis.throw("Socket is not connected", .{}),
            };
        };

        return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(bytes_read)));
    }

    pub fn createStream(this: *This, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const stream_id = this.createStreamImpl() catch {
            return globalThis.throw("Failed to create stream", .{});
        };

        return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(stream_id)));
    }

    pub fn close(this: *This, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.closeImpl();
        return .js_undefined;
    }

    // Property getters
    pub fn getServerName(this: *This, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.server_name) |server_name| {
            return jsc.ZigString.init(server_name).toJS(globalThis);
        }
        return jsc.JSValue.jsNull();
    }

    pub fn setServerName(_: *This, _: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        if (value.isString()) {
            // TODO: Implement setting server name
        }
    }

    pub fn getConnectionId(this: *This, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.connection_id) |conn_id| {
            return jsc.ZigString.init(conn_id).toJS(globalThis);
        }
        return jsc.JSValue.jsNull();
    }

    pub fn getStreamCount(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(this.stream_count)));
    }

    pub fn getIsConnected(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsBoolean(this.flags.is_connected);
    }

    pub fn getIsServer(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsBoolean(this.flags.is_server);
    }

    pub fn getHas0RTT(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        return jsc.JSValue.jsBoolean(this.flags.has_0rtt);
    }

    pub fn getStats(this: *This, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const stats = this.getQuicStats();

        // Create a JavaScript object with the stats
        const stats_obj = jsc.JSValue.createEmptyObject(globalThis, 5);
        stats_obj.put(globalThis, "streamCount", jsc.JSValue.jsNumber(@as(f64, @floatFromInt(stats.stream_count))));
        stats_obj.put(globalThis, "isConnected", jsc.JSValue.jsBoolean(stats.is_connected));
        stats_obj.put(globalThis, "has0RTT", jsc.JSValue.jsBoolean(stats.has_0rtt));
        stats_obj.put(globalThis, "bytesSent", jsc.JSValue.jsNumber(@as(f64, @floatFromInt(stats.bytes_sent))));
        stats_obj.put(globalThis, "bytesReceived", jsc.JSValue.jsNumber(@as(f64, @floatFromInt(stats.bytes_received))));

        return stats_obj;
    }

    pub fn getData(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        _ = this; // TODO: Implement data storage
        return .js_undefined;
    }

    pub fn setData(this: *This, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        _ = this; // TODO: Implement data storage
        _ = globalThis;
        _ = value;
    }

    pub fn getReadyState(this: *This, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.flags.is_closed) {
            return jsc.ZigString.init("closed").toJS(globalThis);
        } else if (this.flags.is_connected) {
            return jsc.ZigString.init("open").toJS(globalThis);
        } else {
            return jsc.ZigString.init("connecting").toJS(globalThis);
        }
    }

    pub fn getPort(this: *This, _: *jsc.JSGlobalObject) jsc.JSValue {
        if (this.listen_socket) |listen_socket| {
            const port = listen_socket.getPort();
            return jsc.JSValue.jsNumber(@as(f64, @floatFromInt(port)));
        }
        return jsc.JSValue.jsNumber(0);
    }

    pub fn jsRef(this: *This, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.poll_ref.ref(globalObject.bunVM());
        return .js_undefined;
    }

    pub fn jsUnref(this: *This, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        this.poll_ref.unref(globalObject.bunVM());
        return .js_undefined;
    }

    // Static method for Bun.quic() API
    pub fn quic(globalThis: *jsc.JSGlobalObject, options: jsc.JSValue) bun.JSError!jsc.JSValue {
        if (options.isEmptyOrUndefinedOrNull() or !options.isObject()) {
            return globalThis.throw("quic requires options object", .{});
        }

        // Determine if this is a server socket
        const is_server = if (try options.get(globalThis, "server")) |server_val|
            server_val.toBoolean()
        else
            false;

        // Parse SSL/TLS configuration if provided
        var ssl_config: ?SSLConfig = null;
        if (try options.getTruthy(globalThis, "tls")) |tls_options| {
            const vm = globalThis.bunVM();
            ssl_config = try SSLConfig.fromJS(vm, globalThis, tls_options);
        }
        errdefer if (ssl_config) |*ssl| ssl.deinit();

        // Create handlers from options
        const handlers = QuicHandlers.fromJS(globalThis, options, is_server) catch {
            if (ssl_config) |*ssl| ssl.deinit();
            return globalThis.throw("Invalid QUIC handlers", .{});
        };

        // Allocate handlers on heap
        const handlers_ptr = try bun.default_allocator.create(QuicHandlers);
        handlers_ptr.* = handlers;
        handlers_ptr.withAsyncContextIfNeeded(globalThis);

        // Initialize QUIC socket
        const this = QuicSocket.init(bun.default_allocator, handlers_ptr) catch {
            handlers_ptr.unprotect();
            bun.default_allocator.destroy(handlers_ptr);
            if (ssl_config) |*ssl| ssl.deinit();
            return globalThis.throw("Failed to create QUIC socket", .{});
        };
        
        this.ssl_config = ssl_config;

        // Configure from options
        if (try options.get(globalThis, "hostname")) |hostname_val| {
            if (hostname_val.isString()) {
                var hostname_slice = try hostname_val.getZigString(globalThis);
                const hostname = hostname_slice.slice();

                const port_val = (try options.get(globalThis, "port")) orelse jsc.JSValue.jsNumber(443);
                const port = if (port_val.isNumber()) port_val.to(u16) else 443;

                if (is_server) {
                    this.listenImpl(hostname, port) catch {
                        this.deref();
                        return globalThis.throw("Failed to listen", .{});
                    };
                } else {
                    this.connectImpl(hostname, port) catch {
                        this.deref();
                        return globalThis.throw("Failed to connect", .{});
                    };
                }
            }
        }

        // Set up JavaScript value and return
        this.this_value = this.toJS(globalThis);
        this.poll_ref.ref(globalThis.bunVM());

        return this.this_value;
    }

    // uSockets callback handlers
    fn onSocketOpen(socket: *uws.quic.Socket, is_client: c_int) callconv(.C) void {
        jsc.markBinding(@src());
        log("onSocketOpen called: socket={*}, is_client={}", .{ socket, is_client });

        const context = socket.context() orelse {
            log("ERROR: No context for socket", .{});
            return;
        };
        const ext_data = context.ext() orelse {
            log("ERROR: No ext data in context", .{});
            return;
        };
        
        log("Got ext_data at {*}", .{ext_data});
        
        // For client connections and server listen sockets, the ext_data contains pointer to QuicSocket
        // For server-accepted connections, we need to handle differently
        if (is_client != 0) {
            // Client connection
            const this_ptr: **This = @ptrCast(@alignCast(ext_data));
            const this: *This = this_ptr.*;
            log("Retrieved QuicSocket instance: {*}, handlers={*}", .{ this, this.handlers });

            this.socket = socket;
            this.flags.is_connected = true;
            this.has_pending_activity.store(true, .release);

            log("QUIC client socket opened", .{});

            // Call onOpen handler for client
            if (this.handlers) |handlers| {
                log("Found handlers, checking onOpen callback...", .{});
                if (handlers.onOpen != .zero) {
                    log("onOpen handler is set, calling JavaScript callback", .{});
                } else {
                    log("WARNING: onOpen handler is .zero!", .{});
                }
                
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();

                // Ensure this_value is initialized
                if (this.this_value == .zero) {
                    this.this_value = this.toJS(handlers.globalObject);
                    log("Created this_value for JavaScript", .{});
                }

                if (handlers.onOpen != .zero) {
                    log("About to call JavaScript onOpen handler", .{});
                    _ = handlers.onOpen.call(handlers.globalObject, this.this_value, &.{this.this_value}) catch |err| {
                        log("ERROR: Exception calling onOpen handler", .{});
                        const exception = handlers.globalObject.takeException(err);
                        this.callErrorHandler(exception);
                    };
                    log("JavaScript onOpen handler called successfully", .{});
                }
            } else {
                log("ERROR: No handlers found on QuicSocket instance!", .{});
            }
        } else {
            // Server connection - this is a new incoming connection
            // For now, we'll handle this as a server-side connection event
            // In a full implementation, we'd create a new QuicSocket for each connection
            const this_ptr: **This = @ptrCast(@alignCast(ext_data));
            const this: *This = this_ptr.*;
            
            log("QUIC server accepted new connection", .{});
            
            // For server, mark as connected and call connection handler
            if (this.handlers) |handlers| {
                log("Server connection: checking handlers", .{});
                if (handlers.onConnection != .zero) {
                    log("onConnection handler is set", .{});
                } else {
                    log("WARNING: onConnection handler is .zero!", .{});
                }
                
                // Server listen socket opened
                // Store the socket but don't call onConnection here
                // onConnection will be called when clients connect via onSocketConnection
                this.socket = socket;
                log("Server listen socket opened and ready", .{});
            }
        }
    }

    fn onSocketConnection(socket: *uws.quic.Socket) callconv(.C) void {
        jsc.markBinding(@src());
        log("onSocketConnection called: socket={*}", .{socket});
        
        const context = socket.context() orelse {
            log("ERROR: No context for connection socket", .{});
            return;
        };
        const ext_data = context.ext() orelse {
            log("ERROR: No ext_data for connection context", .{});
            return;
        };
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        log("QuicSocket instance retrieved: {*}, handlers: {*}", .{ this, this.handlers });

        // Ensure this_value is initialized
        if (this.this_value == .zero) {
            this.this_value = this.toJS(this.handlers.?.globalObject);
        }

        // Call JavaScript onConnection handler for server-side connections
        if (this.handlers) |handlers| {
            if (handlers.onConnection != .zero) {
                log("Calling JavaScript onConnection handler", .{});
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();
                
                // For now pass the same socket instance - TODO: create new QuicSocket for connection
                _ = handlers.onConnection.call(handlers.globalObject, this.this_value, &.{this.this_value}) catch |err| {
                    log("ERROR: Exception calling onConnection handler", .{});
                    const exception = handlers.globalObject.takeException(err);
                    this.callErrorHandler(exception);
                    return;
                };
                log("onConnection handler called successfully", .{});
            } else {
                log("No onConnection handler registered", .{});
            }
        }
    }

    fn onSocketClose(socket: *uws.quic.Socket) callconv(.C) void {
        jsc.markBinding(@src());

        const context = socket.context() orelse return;
        const ext_data = context.ext() orelse return;
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        this.flags.is_connected = false;
        this.flags.is_closed = true;
        this.has_pending_activity.store(false, .release);

        log("QUIC socket closed", .{});

        // Call JavaScript onClose handler
        if (this.handlers) |handlers| {
            if (handlers.onClose != .zero) {
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();

                _ = handlers.onClose.call(handlers.globalObject, this.this_value, &.{this.this_value}) catch |err| {
                    const exception = handlers.globalObject.takeException(err);
                    this.callErrorHandler(exception);
                };
            }
        }
    }

    fn onStreamOpen(stream: *uws.quic.Stream, is_client: c_int) callconv(.C) void {
        jsc.markBinding(@src());

        log("onStreamOpen called, stream={any}, is_client={}", .{ stream, is_client });

        const socket = stream.socket() orelse {
            log("ERROR: No socket for stream", .{});
            return;
        };
        const context = socket.context() orelse {
            log("ERROR: No context for socket", .{});
            return;
        };
        const ext_data = context.ext() orelse {
            log("ERROR: No ext_data for context", .{});
            return;
        };
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        this.current_stream = stream;
        
        // Mark connection as established when first stream opens successfully
        if (!this.flags.is_connected) {
            this.flags.is_connected = true;
            log("QUIC connection now established after stream open", .{});
        }

        log("QUIC stream opened (client: {})", .{is_client != 0});
    }

    fn onStreamData(stream: *uws.quic.Stream, data: [*c]u8, length: c_int) callconv(.C) void {
        jsc.markBinding(@src());

        const socket = stream.socket() orelse return;
        const context = socket.context() orelse return;
        const ext_data = context.ext() orelse return;
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        if (length <= 0) return;

        const data_slice = data[0..@intCast(length)];
        log("QUIC stream received {} bytes", .{length});

        // Call JavaScript onMessage handler
        if (this.handlers) |handlers| {
            if (handlers.onMessage != .zero) {
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();

                const array_buffer = jsc.ArrayBuffer.createBuffer(handlers.globalObject, data_slice) catch {
                    this.callErrorHandler(jsc.JSValue.jsNull());
                    return;
                };
                _ = handlers.onMessage.call(handlers.globalObject, this.this_value, &.{ this.this_value, array_buffer }) catch |err| {
                    const exception = handlers.globalObject.takeException(err);
                    this.callErrorHandler(exception);
                };
            }
        }
    }

    fn onStreamClose(stream: *uws.quic.Stream) callconv(.C) void {
        jsc.markBinding(@src());

        const socket = stream.socket() orelse return;
        const context = socket.context() orelse return;
        const ext_data = context.ext() orelse return;
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        if (this.current_stream == stream) {
            this.current_stream = null;
        }

        log("QUIC stream closed", .{});
    }

    fn onStreamEnd(stream: *uws.quic.Stream) callconv(.C) void {
        jsc.markBinding(@src());

        const socket = stream.socket() orelse return;
        const context = socket.context() orelse return;
        const ext_data = context.ext() orelse return;
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        _ = this; // Use this if needed for future functionality

        log("QUIC stream ended", .{});
    }

    fn onStreamWritable(stream: *uws.quic.Stream) callconv(.C) void {
        jsc.markBinding(@src());

        const socket = stream.socket() orelse return;
        const context = socket.context() orelse return;
        const ext_data = context.ext() orelse return;
        const this_ptr: **This = @ptrCast(@alignCast(ext_data));
        const this: *This = this_ptr.*;

        _ = this; // Use this if needed for future functionality

        log("QUIC stream writable", .{});
    }

    // Error handler helper
    fn callErrorHandler(this: *This, exception: jsc.JSValue) void {
        if (this.handlers) |handlers| {
            if (handlers.onError != .zero) {
                const vm = handlers.vm;
                const event_loop = vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();

                _ = handlers.onError.call(handlers.globalObject, this.this_value, &.{ this.this_value, exception }) catch {
                    // If error handler itself throws, we can't do much more
                    log("Error in QUIC error handler", .{});
                };
            }
        }
    }
};

pub const QuicStats = struct {
    stream_count: u32,
    is_connected: bool,
    has_0rtt: bool,
    bytes_sent: u64,
    bytes_received: u64,
};

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const Async = bun.Async;

const jsc = bun.jsc;
const SocketAddress = @import("./socket/SocketAddress.zig");
const Handlers = @import("./socket/Handlers.zig");
const uws = @import("../../../deps/uws.zig");
const log = bun.Output.scoped(.QuicSocket, false);
const SSLConfig = @import("../server/SSLConfig.zig");

// QUIC-specific handlers that use different callback names than regular sockets
pub const QuicHandlers = struct {
    onOpen: jsc.JSValue = .zero, // "open" callback
    onMessage: jsc.JSValue = .zero, // "message" callback
    onClose: jsc.JSValue = .zero, // "close" callback
    onError: jsc.JSValue = .zero, // "error" callback
    onConnection: jsc.JSValue = .zero, // "connection" callback (server only)

    vm: *jsc.VirtualMachine,
    globalObject: *jsc.JSGlobalObject,
    is_server: bool,

    protection_count: bun.DebugOnly(u32) = if (Environment.isDebug) 0,

    pub fn fromJS(globalObject: *jsc.JSGlobalObject, opts: jsc.JSValue, is_server: bool) bun.JSError!QuicHandlers {
        var handlers = QuicHandlers{
            .vm = globalObject.bunVM(),
            .globalObject = globalObject,
            .is_server = is_server,
        };

        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            return globalObject.throwInvalidArguments("Expected options to be an object", .{});
        }

        // Map QUIC callback names to handler fields
        const pairs = .{
            .{ "onOpen", "open" },
            .{ "onMessage", "message" },
            .{ "onClose", "close" },
            .{ "onError", "error" },
            .{ "onConnection", "connection" },
        };

        inline for (pairs) |pair| {
            if (try opts.getTruthyComptime(globalObject, pair.@"1")) |callback_value| {
                if (!callback_value.isCell() or !callback_value.isCallable()) {
                    return globalObject.throwInvalidArguments("Expected \"{s}\" callback to be a function", .{pair[1]});
                }

                @field(handlers, pair.@"0") = callback_value;
            }
        }

        // For QUIC, we need at least an open callback or error callback
        if (handlers.onOpen == .zero and handlers.onError == .zero) {
            return globalObject.throwInvalidArguments("Expected at least \"open\" or \"error\" callback", .{});
        }

        return handlers;
    }

    pub fn unprotect(this: *QuicHandlers) void {
        if (this.vm.isShuttingDown()) {
            return;
        }

        if (comptime Environment.isDebug) {
            bun.assert(this.protection_count > 0);
            this.protection_count -= 1;
        }
        this.onOpen.unprotect();
        this.onMessage.unprotect();
        this.onClose.unprotect();
        this.onError.unprotect();
        this.onConnection.unprotect();
    }

    pub fn protect(this: *QuicHandlers) void {
        if (comptime Environment.isDebug) {
            this.protection_count += 1;
        }
        this.onOpen.protect();
        this.onMessage.protect();
        this.onClose.protect();
        this.onError.protect();
        this.onConnection.protect();
    }

    pub fn withAsyncContextIfNeeded(this: *QuicHandlers, globalObject: *jsc.JSGlobalObject) void {
        inline for (.{
            "onOpen",
            "onMessage",
            "onClose",
            "onError",
            "onConnection",
        }) |field| {
            const value = @field(this, field);
            if (value != .zero) {
                @field(this, field) = value.withAsyncContextIfNeeded(globalObject);
            }
        }
    }
};
