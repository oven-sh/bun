const MySQLConnection = @This();

socket: Socket,
status: ConnectionState = .disconnected,
ref_count: RefCount = RefCount.init(),

write_buffer: bun.OffsetByteList = .{},
read_buffer: bun.OffsetByteList = .{},
last_message_start: u32 = 0,
sequence_id: u8 = 0,

requests: Queue = Queue.init(bun.default_allocator),
statements: PreparedStatementsMap = .{},

poll_ref: bun.Async.KeepAlive = .{},
globalObject: *jsc.JSGlobalObject,
vm: *jsc.VirtualMachine,

pending_activity_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
js_value: JSValue = .js_undefined,

is_ready_for_query: bool = false,
has_backpressure: bool = false,

server_version: bun.ByteList = .{},
connection_id: u32 = 0,
capabilities: Capabilities = .{},
character_set: CharacterSet = CharacterSet.default,
status_flags: StatusFlags = .{},

auth_plugin: ?AuthMethod = null,
auth_state: AuthState = .{ .pending = {} },

tls_ctx: ?*uws.SocketContext = null,
tls_config: jsc.API.ServerConfig.SSLConfig = .{},
tls_status: TLSStatus = .none,
ssl_mode: SSLMode = .disable,

auth_data: []const u8 = "",
database: []const u8 = "",
user: []const u8 = "",
password: []const u8 = "",
options: []const u8 = "",
options_buf: []const u8 = "",

auto_flusher: AutoFlusher = .{},

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn onAutoFlush(this: *@This()) bool {
    if (this.has_backpressure) {
        debug("onAutoFlush: has backpressure", .{});
        this.auto_flusher.registered = false;
        // if we have backpressure, wait for onWritable
        return false;
    }
    this.ref();
    defer this.deref();
    debug("onAutoFlush: draining", .{});
    // drain as much as we can
    this.drainInternal();

    // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
    const keep_flusher_registered = !this.has_backpressure and this.write_buffer.len() > 0;
    debug("onAutoFlush: keep_flusher_registered: {}", .{keep_flusher_registered});
    this.auto_flusher.registered = keep_flusher_registered;
    return keep_flusher_registered;
}

pub const AuthState = union(enum) {
    pending: void,
    native_password: void,
    caching_sha2: CachingSha2,
    ok: void,

    pub const CachingSha2 = union(enum) {
        fast_auth,
        full_auth,
        waiting_key,
    };
};

pub fn hasPendingActivity(this: *MySQLConnection) bool {
    return this.pending_activity_count.load(.acquire) > 0;
}

fn updateHasPendingActivity(this: *MySQLConnection) void {
    const a: u32 = if (this.requests.count > 0) 1 else 0;
    const b: u32 = if (this.status != .disconnected) 1 else 0;
    this.pending_activity_count.store(a + b, .release);
}

fn registerAutoFlusher(this: *@This()) void {
    const data_to_send = this.write_buffer.len();
    debug("registerAutoFlusher: backpressure: {} registered: {} data_to_send: {}", .{ this.has_backpressure, this.auto_flusher.registered, data_to_send });

    if (!this.auto_flusher.registered and // should not be registered
        !this.has_backpressure and // if has backpressure we need to wait for onWritable event
        data_to_send > 0 and // we need data to send
        this.status == .connected //and we need to be connected
    ) {
        AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, this.vm);
        this.auto_flusher.registered = true;
    }
}

fn unregisterAutoFlusher(this: *@This()) void {
    debug("unregisterAutoFlusher registered: {}", .{this.auto_flusher.registered});
    if (this.auto_flusher.registered) {
        AutoFlusher.unregisterDeferredMicrotaskWithType(@This(), this, this.vm);
        this.auto_flusher.registered = false;
    }
}

fn drainInternal(this: *@This()) void {
    debug("drainInternal", .{});
    if (this.vm.isShuttingDown()) return this.close();

    const event_loop = this.vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();

    this.flushData();

    if (!this.has_backpressure) {
        // no backpressure yet so pipeline more if possible and flush again
        // this.advance();
        this.flushData();
    }
}
pub fn finalize(this: *MySQLConnection) void {
    debug("MySQLConnection finalize", .{});

    // Ensure we disconnect before finalizing
    if (this.status != .disconnected) {
        this.disconnect();
    }

    this.js_value = .zero;
    this.deref();
}

pub fn doRef(this: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.poll_ref.ref(this.vm);
    this.updateHasPendingActivity();
    return .js_undefined;
}

pub fn doUnref(this: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.poll_ref.unref(this.vm);
    this.updateHasPendingActivity();
    return .js_undefined;
}

pub fn doFlush(this: *MySQLConnection, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.registerAutoFlusher();
    return .js_undefined;
}

pub fn createQuery(this: *MySQLConnection, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    _ = callframe;
    _ = globalObject;
    _ = this;

    return .js_undefined;
}

pub fn getConnected(this: *MySQLConnection, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.status == .connected);
}

pub fn doClose(this: *MySQLConnection, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.disconnect();
    this.write_buffer.deinit(bun.default_allocator);

    return .js_undefined;
}

pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*MySQLConnection {
    _ = callframe;

    return globalObject.throw("MySQLConnection cannot be constructed directly", .{});
}

pub fn flushData(this: *@This()) void {
    // we know we still have backpressure so just return we will flush later
    if (this.has_backpressure) {
        debug("flushData: has backpressure", .{});
        return;
    }

    const chunk = this.write_buffer.remaining();
    if (chunk.len == 0) {
        debug("flushData: no data to flush", .{});
        return;
    }

    const wrote = this.socket.write(chunk);
    this.has_backpressure = wrote < chunk.len;
    debug("flushData: wrote {d}/{d} bytes", .{ wrote, chunk.len });
    if (wrote > 0) {
        // SocketMonitor.write(chunk[0..@intCast(wrote)]);
        this.write_buffer.consume(@intCast(wrote));
    }
}

pub fn getQueriesArray(this: *const @This()) JSValue {
    return js.queriesGetCached(this.js_value) orelse .zero;
}

pub fn failWithJSValue(this: *MySQLConnection, value: JSValue) void {
    defer this.updateHasPendingActivity();
    if (this.status == .failed) return;

    this.setStatus(.failed);
    if (!this.socket.isClosed()) this.socket.close();
    const on_close = this.consumeOnCloseCallback(this.globalObject) orelse return;

    const loop = this.vm.eventLoop();
    loop.enter();
    defer loop.exit();
    _ = on_close.call(
        this.globalObject,
        this.js_value,
        &[_]JSValue{
            value,
            this.getQueriesArray(),
        },
    ) catch |e| this.globalObject.reportActiveExceptionAsUnhandled(e);
}

pub fn fail(this: *MySQLConnection, message: []const u8, err: anyerror) void {
    debug("failed: {s}: {s}", .{ message, @errorName(err) });
    const instance = this.globalObject.createErrorInstance("{s}", .{message});
    instance.put(this.globalObject, jsc.ZigString.static("code"), String.init(@errorName(err)).toJS(this.globalObject));
    this.failWithJSValue(instance);
}

pub fn onClose(this: *MySQLConnection) void {
    var vm = this.vm;
    defer vm.drainMicrotasks();
    this.fail("Connection closed", error.ConnectionClosed);
}

pub fn disconnect(this: *@This()) void {
    if (this.status == .connected) {
        this.setStatus(.disconnected);
        this.poll_ref.disable();

        const requests = this.requests.readableSlice(0);
        this.requests.head = 0;
        this.requests.count = 0;

        // Fail any pending requests
        for (requests) |request| {
            request.onError(.{
                .error_code = 2013, // CR_SERVER_LOST
                .error_message = .{ .temporary = "Lost connection to MySQL server" },
            }, this.globalObject);
        }

        this.socket.close();
    }
}

fn SocketHandler(comptime ssl: bool) type {
    return struct {
        const SocketType = uws.NewSocketHandler(ssl);
        fn _socket(s: SocketType) Socket {
            if (comptime ssl) {
                return Socket{ .SocketTLS = s };
            }

            return Socket{ .SocketTCP = s };
        }
        pub fn onOpen(this: *MySQLConnection, socket: SocketType) void {
            this.onOpen(_socket(socket));
        }

        fn onHandshake_(this: *MySQLConnection, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            this.onHandshake(success, ssl_error);
        }

        pub const onHandshake = if (ssl) onHandshake_ else null;

        pub fn onClose(this: *MySQLConnection, socket: SocketType, _: i32, _: ?*anyopaque) void {
            _ = socket;
            this.onClose();
        }

        pub fn onEnd(this: *MySQLConnection, socket: SocketType) void {
            _ = socket;
            this.onClose();
        }

        pub fn onConnectError(this: *MySQLConnection, socket: SocketType, _: i32) void {
            _ = socket;
            this.onClose();
        }

        pub fn onTimeout(this: *MySQLConnection, socket: SocketType) void {
            _ = socket;
            this.onTimeout();
        }

        pub fn onData(this: *MySQLConnection, socket: SocketType, data: []const u8) void {
            _ = socket;
            this.onData(data);
        }

        pub fn onWritable(this: *MySQLConnection, socket: SocketType) void {
            _ = socket;
            this.onDrain();
        }
    };
}

pub fn onTimeout(this: *MySQLConnection) void {
    this.fail("Connection timed out", error.ConnectionTimedOut);
}

pub fn onDrain(this: *MySQLConnection) void {
    debug("onDrain", .{});
    this.drainInternal();
}

pub fn call(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var vm = globalObject.bunVM();
    const arguments = callframe.arguments();
    const hostname_str = try arguments[0].toBunString(globalObject);
    defer hostname_str.deref();
    const port = try arguments[1].coerce(i32, globalObject);

    const username_str = try arguments[2].toBunString(globalObject);
    defer username_str.deref();
    const password_str = try arguments[3].toBunString(globalObject);
    defer password_str.deref();
    const database_str = try arguments[4].toBunString(globalObject);
    defer database_str.deref();
    // TODO: update this to match MySQL.
    const ssl_mode: SSLMode = switch (arguments[5].toInt32()) {
        0 => .disable,
        1 => .prefer,
        2 => .require,
        3 => .verify_ca,
        4 => .verify_full,
        else => .disable,
    };

    const tls_object = arguments[6];

    var tls_config: jsc.API.ServerConfig.SSLConfig = .{};
    var tls_ctx: ?*uws.SocketContext = null;
    if (ssl_mode != .disable) {
        tls_config = if (tls_object.isBoolean() and tls_object.toBoolean())
            .{}
        else if (tls_object.isObject())
            (jsc.API.ServerConfig.SSLConfig.fromJS(vm, globalObject, tls_object) catch return .zero) orelse .{}
        else {
            return globalObject.throwInvalidArguments("tls must be a boolean or an object", .{});
        };

        if (globalObject.hasException()) {
            tls_config.deinit();
            return .zero;
        }

        // we always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match
        const original_reject_unauthorized = tls_config.reject_unauthorized;
        tls_config.reject_unauthorized = 0;
        tls_config.request_cert = 1;

        // We create it right here so we can throw errors early.
        const context_options = tls_config.asUSockets();
        var err: uws.create_bun_socket_error_t = .none;
        tls_ctx = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*@This()), context_options, &err) orelse {
            if (err != .none) {
                return globalObject.throw("failed to create TLS context", .{});
            } else {
                return globalObject.throwValue(err.toJS(globalObject));
            }
        };

        // restore the original reject_unauthorized
        tls_config.reject_unauthorized = original_reject_unauthorized;
        if (err != .none) {
            tls_config.deinit();
            if (tls_ctx) |ctx| {
                ctx.deinit(true);
            }
            return globalObject.throwValue(err.toJS(globalObject));
        }

        uws.NewSocketHandler(true).configure(tls_ctx.?, true, *@This(), SocketHandler(true));
    }

    var username: []const u8 = "";
    var password: []const u8 = "";
    var database: []const u8 = "";
    var options: []const u8 = "";
    var path: []const u8 = "";

    const options_str = try arguments[7].toBunString(globalObject);
    defer options_str.deref();

    const path_str = try arguments[8].toBunString(globalObject);
    defer path_str.deref();

    const options_buf: []u8 = brk: {
        var b = bun.StringBuilder{};
        b.cap += username_str.utf8ByteLength() + 1 + password_str.utf8ByteLength() + 1 + database_str.utf8ByteLength() + 1 + options_str.utf8ByteLength() + 1 + path_str.utf8ByteLength() + 1;

        b.allocate(bun.default_allocator) catch {};
        var u = username_str.toUTF8WithoutRef(bun.default_allocator);
        defer u.deinit();
        username = b.append(u.slice());

        var p = password_str.toUTF8WithoutRef(bun.default_allocator);
        defer p.deinit();
        password = b.append(p.slice());

        var d = database_str.toUTF8WithoutRef(bun.default_allocator);
        defer d.deinit();
        database = b.append(d.slice());

        var o = options_str.toUTF8WithoutRef(bun.default_allocator);
        defer o.deinit();
        options = b.append(o.slice());

        var _path = path_str.toUTF8WithoutRef(bun.default_allocator);
        defer _path.deinit();
        path = b.append(_path.slice());

        break :brk b.allocatedSlice();
    };

    const on_connect = arguments[9];
    const on_close = arguments[10];
    // const idle_timeout = arguments[11].toInt32();
    // const connection_timeout = arguments[12].toInt32();
    // const max_lifetime = arguments[13].toInt32();
    // const use_unnamed_prepared_statements = arguments[14].asBoolean();

    var ptr = try bun.default_allocator.create(MySQLConnection);

    ptr.* = MySQLConnection{
        .globalObject = globalObject,
        .vm = vm,
        .database = database,
        .user = username,
        .password = password,
        .options = options,
        .options_buf = options_buf,
        .socket = .{ .SocketTCP = .{ .socket = .{ .detached = {} } } },
        .requests = Queue.init(bun.default_allocator),
        .statements = PreparedStatementsMap{},
        .tls_config = tls_config,
        .tls_ctx = tls_ctx,
        .ssl_mode = ssl_mode,
        .tls_status = if (ssl_mode != .disable) .pending else .none,
        // .idle_timeout_interval_ms = @intCast(idle_timeout),
        // .connection_timeout_ms = @intCast(connection_timeout),
        // .max_lifetime_interval_ms = @intCast(max_lifetime),
        .character_set = CharacterSet.default,
    };

    {
        const hostname = hostname_str.toUTF8(bun.default_allocator);
        defer hostname.deinit();

        const ctx = vm.rareData().mysql_context.tcp orelse brk: {
            const ctx_ = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*@This())).?;
            uws.NewSocketHandler(false).configure(ctx_, true, *@This(), SocketHandler(false));
            vm.rareData().mysql_context.tcp = ctx_;
            break :brk ctx_;
        };

        if (path.len > 0) {
            ptr.socket = .{
                .SocketTCP = uws.SocketTCP.connectUnixAnon(path, ctx, ptr, false) catch |err| {
                    tls_config.deinit();
                    if (tls_ctx) |tls| {
                        tls.deinit(true);
                    }
                    ptr.deinit();
                    return globalObject.throwError(err, "failed to connect to postgresql");
                },
            };
        } else {
            ptr.socket = .{
                .SocketTCP = uws.SocketTCP.connectAnon(hostname.slice(), port, ctx, ptr, false) catch |err| {
                    tls_config.deinit();
                    if (tls_ctx) |tls| {
                        tls.deinit(true);
                    }
                    ptr.deinit();
                    return globalObject.throwError(err, "failed to connect to mysql");
                },
            };
        }
    }

    ptr.updateHasPendingActivity();
    ptr.poll_ref.ref(vm);
    const js_value = ptr.toJS(globalObject);
    js_value.ensureStillAlive();
    ptr.js_value = js_value;
    js.onconnectSetCached(js_value, globalObject, on_connect);
    js.oncloseSetCached(js_value, globalObject, on_close);

    return js_value;
}

pub fn deinit(this: *MySQLConnection) void {
    this.disconnect();
    debug("MySQLConnection deinit", .{});

    var requests = this.requests;
    defer requests.deinit();
    this.requests = Queue.init(bun.default_allocator);

    // Clear any pending requests first
    for (requests.readableSlice(0)) |request| {
        request.onError(.{
            .error_code = 2013,
            .error_message = .{ .temporary = "Connection closed" },
        }, this.globalObject);
    }
    this.write_buffer.deinit(bun.default_allocator);
    this.read_buffer.deinit(bun.default_allocator);
    this.statements.deinit(bun.default_allocator);
    bun.default_allocator.free(this.auth_data);
    this.auth_data = "";
    this.tls_config.deinit();
    if (this.tls_ctx) |ctx| {
        ctx.deinit(true);
    }
    bun.default_allocator.free(this.options_buf);
    bun.default_allocator.destroy(this);
}

pub fn onOpen(this: *MySQLConnection, socket: Socket) void {
    this.socket = socket;
    this.setStatus(.handshaking);
    this.poll_ref.ref(this.vm);
    this.updateHasPendingActivity();

    // Do nothing, the server will start the handshake process.
    // Set a timeout so that we at least don't do nothing forever.
    socket.setTimeout(120);
}

pub fn onHandshake(this: *MySQLConnection, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
    debug("onHandshake: {d} {d}", .{ success, ssl_error.error_no });
    const handshake_success = if (success == 1) true else false;
    if (handshake_success) {
        if (this.tls_config.reject_unauthorized != 0) {
            // only reject the connection if reject_unauthorized == true
            switch (this.ssl_mode) {
                // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279

                .verify_ca, .verify_full => {
                    if (ssl_error.error_no != 0) {
                        this.failWithJSValue(ssl_error.toJS(this.globalObject));
                        return;
                    }

                    const ssl_ptr: *BoringSSL.c.SSL = @ptrCast(this.socket.getNativeHandle());
                    if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.failWithJSValue(ssl_error.toJS(this.globalObject));
                        }
                    }
                },
                else => {
                    return;
                },
            }
        }
    } else {
        // if we are here is because server rejected us, and the error_no is the cause of this
        // no matter if reject_unauthorized is false because we are disconnected by the server
        this.failWithJSValue(ssl_error.toJS(this.globalObject));
    }
}

pub fn onData(this: *MySQLConnection, data: []const u8) void {
    debug("onData: {d}", .{data.len});
    this.ref();
    const vm = this.vm;
    // Clear the timeout.
    this.socket.setTimeout(0);

    defer {
        if (this.status == .connected and this.requests.readableLength() == 0 and this.write_buffer.remaining().len == 0) {
            // Don't keep the process alive when there's nothing to do.
            this.poll_ref.unref(vm);
        } else if (this.status == .connected) {
            // Keep the process alive if there's something to do.
            this.poll_ref.ref(vm);
        }

        this.deref();
    }

    const event_loop = vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();

    // SocketMonitor.read(data);

    if (this.read_buffer.remaining().len == 0) {
        var consumed: usize = 0;
        var offset: usize = 0;
        const reader = StackReader.init(data, &consumed, &offset);
        this.processPackets(StackReader, reader) catch |err| {
            if (err == error.ShortRead) {
                if (comptime bun.Environment.allow_assert) {
                    debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                        offset,
                        consumed,
                        data.len,
                    });
                }

                this.read_buffer.head = 0;
                this.last_message_start = 0;
                this.read_buffer.byte_list.len = 0;
                this.read_buffer.write(bun.default_allocator, data[offset..]) catch @panic("failed to write to read buffer");
            } else {
                if (comptime bun.Environment.allow_assert) {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                }
                this.fail("Failed to read data", err);
            }
        };
        return;
    }

    {
        this.read_buffer.head = this.last_message_start;

        this.read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
        this.processPackets(Reader, this.bufferedReader()) catch |err| {
            if (err != error.ShortRead) {
                if (comptime bun.Environment.allow_assert) {
                    if (@errorReturnTrace()) |trace| {
                        debug("Error: {s}\n{}", .{ @errorName(err), trace });
                    }
                }
                this.fail("Failed to read data", err);
                return;
            }

            if (comptime bun.Environment.allow_assert) {
                debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                    this.last_message_start,
                    this.read_buffer.head,
                    this.read_buffer.byte_list.len,
                });
            }

            return;
        };

        this.last_message_start = 0;
        this.read_buffer.head = 0;
    }
}

pub fn processPackets(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    while (true) {
        reader.markMessageStart();

        // Read packet header
        const header = PacketHeader.decode(reader.peek()) orelse break;
        reader.skip(PacketHeader.size);

        // Ensure we have the full packet
        reader.ensureCapacity(header.length) catch |err| {
            if (err == error.ShortRead) {
                reader.skip(-@as(isize, @intCast(PacketHeader.size)));
            }

            return err;
        };

        // Update sequence id
        this.sequence_id = header.sequence_id +% 1;

        // Process packet based on connection state
        switch (this.status) {
            .handshaking => try this.handleHandshake(Context, reader),
            .authenticating, .authentication_awaiting_pk => try this.handleAuth(Context, reader),
            .connected => try this.handleCommand(Context, reader),
            else => {
                debug("Unexpected packet in state {s}", .{@tagName(this.status)});
                return error.UnexpectedPacket;
            },
        }
    }
}

pub fn handleHandshake(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    var handshake = HandshakeV10{};
    try handshake.decode(reader);
    defer handshake.deinit();

    // Store server info
    this.server_version = try handshake.server_version.toOwned();
    this.connection_id = handshake.connection_id;
    // this.capabilities = handshake.capability_flags;
    this.capabilities = Capabilities.getDefaultCapabilities(this.ssl_mode != .disable, this.database.len > 0);

    // Override with utf8mb4 instead of using server's default
    this.character_set = CharacterSet.default;
    this.status_flags = handshake.status_flags;

    debug(
        \\Handshake
        \\   Server Version: {s}
        \\   Connection ID:  {d}
        \\   Character Set:  {d} ({s})
        \\   Server Capabilities:   [ {} ] 0x{x:0>8}
        \\   Status Flags:   [ {} ]
        \\
    , .{
        this.server_version.slice(),
        this.connection_id,
        this.character_set,
        this.character_set.label(),
        this.capabilities,
        this.capabilities.toInt(),
        this.status_flags,
    });

    if (this.auth_data.len > 0) {
        bun.default_allocator.free(this.auth_data);
        this.auth_data = "";
    }

    // Store auth data
    const auth_data = try bun.default_allocator.alloc(u8, handshake.auth_plugin_data_part_1.len + handshake.auth_plugin_data_part_2.len);
    @memcpy(auth_data[0..8], &handshake.auth_plugin_data_part_1);
    @memcpy(auth_data[8..], handshake.auth_plugin_data_part_2);
    this.auth_data = auth_data;

    // Get auth plugin
    if (handshake.auth_plugin_name.slice().len > 0) {
        this.auth_plugin = AuthMethod.fromString(handshake.auth_plugin_name.slice()) orelse {
            this.fail("Unsupported auth plugin", error.UnsupportedAuthPlugin);
            return;
        };
    }

    // Update status
    this.setStatus(.authenticating);

    // Send auth response
    try this.sendHandshakeResponse();
}

fn handleHandshakeDecodePublicKey(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    var response = Auth.caching_sha2_password.PublicKeyResponse{};
    try response.decode(reader);
    defer response.deinit();
    // revert back to authenticating since we received the public key
    this.setStatus(.authenticating);

    var encrypted_password = Auth.caching_sha2_password.EncryptedPassword{
        .password = this.password,
        .public_key = response.data.slice(),
        .nonce = this.auth_data,
        .sequence_id = this.sequence_id,
    };
    try encrypted_password.write(this.writer());
    this.flushData();
}

// pub fn resetConnectionTimeout(this: *@This()) void {
//     // if we are processing data, don't reset the timeout, wait for the data to be processed
//     if (this.flags.is_processing_data) return;
//     const interval = this.getTimeoutInterval();
//     if (this.timer.state == .ACTIVE) {
//         this.vm.timer.remove(&this.timer);
//     }
//     if (interval == 0) {
//         return;
//     }

//     this.timer.next = bun.timespec.msFromNow(@intCast(interval));
//     this.vm.timer.insert(&this.timer);
// }

pub fn consumeOnConnectCallback(this: *const @This(), globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    debug("consumeOnConnectCallback", .{});
    const on_connect = js.onconnectGetCached(this.js_value) orelse return null;
    debug("consumeOnConnectCallback exists", .{});

    js.onconnectSetCached(this.js_value, globalObject, .zero);
    return on_connect;
}

pub fn consumeOnCloseCallback(this: *const @This(), globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    debug("consumeOnCloseCallback", .{});
    const on_close = js.oncloseGetCached(this.js_value) orelse return null;
    debug("consumeOnCloseCallback exists", .{});
    js.oncloseSetCached(this.js_value, globalObject, .zero);
    return on_close;
}

pub fn setStatus(this: *@This(), status: ConnectionState) void {
    if (this.status == status) return;
    defer this.updateHasPendingActivity();

    this.status = status;
    // this.resetConnectionTimeout();
    if (this.vm.isShuttingDown()) return;

    switch (status) {
        .connected => {
            const on_connect = this.consumeOnConnectCallback(this.globalObject) orelse return;
            const js_value = this.js_value;
            js_value.ensureStillAlive();
            this.globalObject.queueMicrotask(on_connect, &[_]JSValue{ JSValue.jsNull(), js_value });
            this.poll_ref.unref(this.vm);
        },
        else => {},
    }
}

pub fn handleAuth(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    const first_byte = try reader.int(u8);
    reader.skip(-1);

    debug("Auth packet: 0x{x:0>2}", .{first_byte});

    switch (first_byte) {
        @intFromEnum(PacketType.OK) => {
            var ok = OKPacket{};
            try ok.decode(reader);
            defer ok.deinit();

            this.setStatus(.connected);
            this.status_flags = ok.status_flags;
            this.is_ready_for_query = true;
        },

        @intFromEnum(PacketType.ERROR) => {
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();

            this.failWithJSValue(err.toJS(this.globalObject));
            return error.AuthenticationFailed;
        },

        @intFromEnum(PacketType.MORE_DATA) => {
            // Handle various MORE_DATA cases
            if (this.auth_plugin) |plugin| {
                switch (plugin) {
                    .caching_sha2_password => {
                        reader.skip(1);

                        if (this.status == .authentication_awaiting_pk) {
                            return this.handleHandshakeDecodePublicKey(Context, reader);
                        }

                        var response = Auth.caching_sha2_password.Response{};
                        try response.decode(reader);
                        defer response.deinit();

                        switch (response.status) {
                            .success => {
                                debug("success", .{});
                                this.setStatus(.connected);
                                this.is_ready_for_query = true;
                            },
                            .continue_auth => {
                                debug("continue auth", .{});

                                if (this.ssl_mode == .disable) {
                                    // we are in plain TCP so we need to request the public key
                                    this.setStatus(.authentication_awaiting_pk);
                                    var packet = try this.writer().start(this.sequence_id);

                                    var request = Auth.caching_sha2_password.PublicKeyRequest{};
                                    try request.write(this.writer());
                                    try packet.end();
                                    this.flushData();
                                } else {
                                    // SSL mode is enabled, send password as is
                                    var packet = try this.writer().start(this.sequence_id);
                                    try this.writer().write(this.password);
                                    try packet.end();
                                    this.flushData();
                                }
                            },
                            else => {
                                this.fail("Authentication failed", error.AuthenticationFailed);
                            },
                        }
                    },
                    else => {
                        debug("Unexpected auth continuation for plugin: {s}", .{@tagName(plugin)});
                        return error.UnexpectedPacket;
                    },
                }
            } else if (first_byte == @intFromEnum(PacketType.LOCAL_INFILE)) {
                // Handle LOCAL INFILE request
                var infile = LocalInfileRequest{};
                try infile.decode(reader);
                defer infile.deinit();

                // We don't support LOCAL INFILE for security reasons
                this.fail("LOCAL INFILE not supported", error.LocalInfileNotSupported);
                return;
            } else {
                debug("Received auth continuation without plugin", .{});
                return error.UnexpectedPacket;
            }
        },

        PacketType.AUTH_SWITCH => {
            var auth_switch = AuthSwitchRequest{};
            try auth_switch.decode(reader);
            defer auth_switch.deinit();

            // Update auth plugin and data
            const auth_method = AuthMethod.fromString(auth_switch.plugin_name.slice()) orelse {
                this.fail("Unsupported auth plugin", error.UnsupportedAuthPlugin);
                return;
            };

            // Send new auth response
            try this.sendAuthSwitchResponse(auth_method, auth_switch.plugin_data.slice());
        },

        else => {
            debug("Unexpected auth packet: 0x{x:0>2}", .{first_byte});
            return error.UnexpectedPacket;
        },
    }
}

pub fn handleCommand(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    // Get the current request if any
    if (this.requests.readableLength() == 0) {
        debug("Received unexpected command response", .{});
        return error.UnexpectedPacket;
    }

    const request = this.requests.peekItem(0);

    // Handle based on request type
    if (request.statement) |statement| {
        switch (statement.status) {
            .parsing => {
                // We're waiting for prepare response
                try this.handlePreparedStatement(Context, reader);
            },
            .prepared => {
                // We're waiting for execute response
                try this.handleResultSet(Context, reader);
            },
            .failed => {
                // Statement failed, clean up
                if (this.requests.readItem()) |req| {
                    req.onError(statement.error_response, this.globalObject);
                }
            },
        }
        return;
    }

    // Regular query response
    try this.handleResultSet(Context, reader);
}

pub fn sendHandshakeResponse(this: *MySQLConnection) !void {
    // Only require password for caching_sha2_password when connecting for the first time
    if (this.auth_plugin) |plugin| {
        const requires_password = switch (plugin) {
            .caching_sha2_password => false, // Allow empty password, server will handle auth flow
            .sha256_password => true, // Always requires password
            .mysql_native_password => false, // Allows empty password
        };

        if (requires_password and this.password.len == 0) {
            this.fail("Password required for authentication", error.PasswordRequired);
            return;
        }
    }

    var response = HandshakeResponse41{
        .capability_flags = this.capabilities,
        .max_packet_size = 0, //16777216,
        .character_set = CharacterSet.default,
        .username = .{ .temporary = this.user },
        .database = .{ .temporary = this.database },
        .auth_plugin_name = .{
            .temporary = if (this.auth_plugin) |plugin|
                switch (plugin) {
                    .mysql_native_password => "mysql_native_password",
                    .caching_sha2_password => "caching_sha2_password",
                    .sha256_password => "sha256_password",
                }
            else
                "",
        },
        .auth_response = .{ .empty = {} },
    };
    defer response.deinit();

    // Add some basic connect attributes like mysql2
    // try response.connect_attrs.put(bun.default_allocator, try bun.default_allocator.dupe(u8, "_client_name"), try bun.default_allocator.dupe(u8, "Bun"));
    // try response.connect_attrs.put(bun.default_allocator, try bun.default_allocator.dupe(u8, "_client_version"), try bun.default_allocator.dupe(u8, bun.Global.package_json_version_with_revision));

    // Generate auth response based on plugin
    var scrambled_buf: [32]u8 = undefined;
    if (this.auth_plugin) |plugin| {
        if (this.auth_data.len == 0) {
            this.fail("Missing auth data from server", error.MissingAuthData);
            return;
        }

        response.auth_response = .{ .temporary = try plugin.scramble(this.password, this.auth_data, &scrambled_buf) };
    }
    response.capability_flags.reject();
    try response.write(this.writer());
    this.capabilities = response.capability_flags;
    this.flushData();

    this.socket.setTimeout(0);
}

pub fn sendAuthSwitchResponse(this: *MySQLConnection, auth_method: AuthMethod, plugin_data: []const u8) !void {
    var response = AuthSwitchResponse{};
    defer response.deinit();

    var scrambled_buf: [32]u8 = undefined;

    response.auth_response = .{
        .temporary = try auth_method.scramble(this.password, plugin_data, &scrambled_buf),
    };

    try response.write(this.writer());
    this.flushData();
}

pub const Writer = struct {
    connection: *MySQLConnection,

    pub fn write(this: Writer, data: []const u8) anyerror!void {
        var buffer = &this.connection.write_buffer;
        try buffer.write(bun.default_allocator, data);
    }

    pub fn pwrite(this: Writer, data: []const u8, index: usize) anyerror!void {
        @memcpy(this.connection.write_buffer.byte_list.slice()[index..][0..data.len], data);
    }

    pub fn offset(this: Writer) usize {
        return this.connection.write_buffer.len();
    }
};

pub fn writer(this: *MySQLConnection) NewWriter(Writer) {
    return .{
        .wrapped = .{
            .connection = this,
        },
    };
}

pub const Reader = struct {
    connection: *MySQLConnection,

    pub fn markMessageStart(this: Reader) void {
        this.connection.last_message_start = this.connection.read_buffer.head;
    }

    pub const ensureLength = ensureCapacity;

    pub fn peek(this: Reader) []const u8 {
        return this.connection.read_buffer.remaining();
    }

    pub fn skip(this: Reader, count: isize) void {
        if (count < 0) {
            const abs_count = @abs(count);
            if (abs_count > this.connection.read_buffer.head) {
                this.connection.read_buffer.head = 0;
                return;
            }
            this.connection.read_buffer.head -= @intCast(abs_count);
            return;
        }

        const ucount: usize = @intCast(count);
        if (this.connection.read_buffer.head + ucount > this.connection.read_buffer.byte_list.len) {
            this.connection.read_buffer.head = this.connection.read_buffer.byte_list.len;
            return;
        }

        this.connection.read_buffer.head += @intCast(ucount);
    }

    pub fn ensureCapacity(this: Reader, count: usize) bool {
        return this.connection.read_buffer.remaining().len >= count;
    }

    pub fn read(this: Reader, count: usize) anyerror!Data {
        const remaining = this.peek();
        if (remaining.len < count) {
            return error.ShortRead;
        }

        this.skip(@intCast(count));
        return Data{
            .temporary = remaining[0..count],
        };
    }

    pub fn readZ(this: Reader) anyerror!Data {
        const remaining = this.peek();
        if (bun.strings.indexOfChar(remaining, 0)) |zero| {
            this.skip(@intCast(zero + 1));
            return Data{
                .temporary = remaining[0..zero],
            };
        }

        return error.ShortRead;
    }
};

pub fn bufferedReader(this: *MySQLConnection) NewReader(Reader) {
    return .{
        .wrapped = .{
            .connection = this,
        },
    };
}

pub fn handlePreparedStatement(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    const first_byte = try reader.int(u8);
    reader.skip(-1);

    switch (first_byte) {
        @intFromEnum(PacketType.OK) => {
            var ok = StmtPrepareOKPacket{};
            try ok.decode(reader);

            // Get the current request
            const request = this.requests.peekItem(0);
            if (request.statement) |statement| {
                statement.statement_id = ok.statement_id;

                // Read parameter definitions if any
                if (ok.num_params > 0) {
                    const params = try bun.default_allocator.alloc(types.FieldType, ok.num_params);
                    errdefer bun.default_allocator.free(params);

                    for (params) |*param| {
                        var column = ColumnDefinition41{};
                        defer column.deinit();
                        try column.decode(reader);
                        param.* = column.column_type;
                    }

                    statement.params = params;
                }

                // Read column definitions if any
                if (ok.num_columns > 0) {
                    const columns = try bun.default_allocator.alloc(ColumnDefinition41, ok.num_columns);
                    var consumed: u32 = 0;
                    errdefer {
                        for (columns[0..consumed]) |*column| {
                            column.deinit();
                        }
                        bun.default_allocator.free(columns);
                    }

                    for (columns) |*column| {
                        try column.decode(reader);
                        consumed += 1;
                    }

                    statement.columns = columns;
                }

                statement.status = .prepared;

                if (request.status == .pending) {
                    try request.bindAndExecute(this.writer(), statement, this.globalObject);
                    this.flushData();
                }
            } else {
                debug("Unexpected prepared statement packet", .{});
            }
        },

        @intFromEnum(PacketType.ERROR) => {
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();

            if (this.requests.readItem()) |request| {
                if (request.statement) |statement| {
                    statement.status = .failed;
                    statement.error_response = err;
                }
                request.onError(err, this.globalObject);
            }
        },

        else => {
            debug("Unexpected prepared statement packet: 0x{x:0>2}", .{first_byte});
            return error.UnexpectedPacket;
        },
    }
}

pub fn handleResultSet(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    const first_byte = try reader.int(u8);
    reader.skip(-1);

    switch (first_byte) {
        @intFromEnum(PacketType.OK) => {
            var ok = OKPacket{};
            try ok.decode(reader);
            defer ok.deinit();

            this.status_flags = ok.status_flags;
            this.is_ready_for_query = true;

            if (this.requests.readItem()) |request| {
                request.onSuccess(this.globalObject);
            }
        },

        @intFromEnum(PacketType.ERROR) => {
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();

            if (this.requests.readItem()) |request| {
                request.onError(err, this.globalObject);
            }
        },

        else => {
            // This is likely a result set header
            var header = ResultSetHeader{};
            try header.decode(reader);

            if (this.requests.readableLength() > 0) {
                const request = this.requests.peekItem(0);

                // Read column definitions
                const columns = try bun.default_allocator.alloc(ColumnDefinition41, header.field_count);
                var columns_read: u32 = 0;
                errdefer {
                    for (columns[0..columns_read]) |*column| {
                        column.deinit();
                    }
                    bun.default_allocator.free(columns);
                }

                for (columns) |*column| {
                    try column.decode(reader);
                    columns_read += 1;
                }

                const globalThis = this.globalObject;
                // Start reading rows
                while (true) {
                    const row_first_byte = try reader.byte();
                    reader.skip(-1);

                    switch (row_first_byte) {
                        @intFromEnum(PacketType.EOF) => {
                            var eof = EOFPacket{};
                            try eof.decode(reader);

                            // Update status flags and finish
                            this.status_flags = eof.status_flags;
                            this.is_ready_for_query = true;
                            this.requests.discard(1);

                            request.onSuccess(this.globalObject);
                            break;
                        },

                        @intFromEnum(PacketType.ERROR) => {
                            var err = ErrorPacket{};
                            try err.decode(reader);
                            defer err.deinit();
                            this.requests.discard(1);
                            request.onError(err, this.globalObject);
                            break;
                        },

                        else => {
                            var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
                            const allocator = stack_fallback.get();

                            // Read row data
                            var row = ResultSet.Row{
                                .columns = columns,
                                .binary = request.binary,
                            };
                            defer row.deinit(allocator);
                            try row.decode(allocator, reader);

                            const pending_value = MySQLQuery.js.pendingValueGetCached(request.thisValue) orelse .zero;

                            // Process row data
                            const structure = request.statement.?.structure(request.thisValue, globalThis);
                            const row_value = row.toJS(structure.jsValue() orelse .js_undefined, pending_value, globalThis);
                            if (globalThis.hasException()) {
                                request.onJSError(globalThis.tryTakeException().?, globalThis);
                                return error.JSError;
                            }

                            if (pending_value == .zero) {
                                MySQLQuery.js.pendingValueSetCached(request.thisValue, globalThis, row_value);
                            }
                        },
                    }
                }
            } else {
                debug("Unexpected result set packet", .{});
            }
        },
    }
}

fn close(this: *@This()) void {
    this.disconnect();
    this.unregisterAutoFlusher();
    this.write_buffer.deinit(bun.default_allocator);
}

pub fn closeStatement(this: *MySQLConnection, statement: *MySQLStatement) !void {
    var _close = PreparedStatement.Close{
        .statement_id = statement.statement_id,
    };

    try _close.write(this.writer());
    this.flushData();
}

pub fn resetStatement(this: *MySQLConnection, statement: *MySQLStatement) !void {
    var reset = PreparedStatement.Reset{
        .statement_id = statement.statement_id,
    };

    try reset.write(this.writer());
    this.flushData();
}

pub fn getQueries(_: *@This(), thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    if (js.queriesGetCached(thisValue)) |value| {
        return value;
    }

    const array = try jsc.JSValue.createEmptyArray(globalObject, 0);
    js.queriesSetCached(thisValue, globalObject, array);

    return array;
}

pub fn getOnConnect(_: *@This(), thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (js.onconnectGetCached(thisValue)) |value| {
        return value;
    }

    return .js_undefined;
}

pub fn setOnConnect(_: *@This(), thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    js.onconnectSetCached(thisValue, globalObject, value);
}

pub fn getOnClose(_: *@This(), thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (js.oncloseGetCached(thisValue)) |value| {
        return value;
    }

    return .js_undefined;
}

pub fn setOnClose(_: *@This(), thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    js.oncloseSetCached(thisValue, globalObject, value);
}

pub const js = jsc.Codegen.JSMySQLConnection;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const Socket = uws.AnySocket;
const ConnectionState = @import("./ConnectionState.zig").ConnectionState;
const MySQLStatement = @import("./MySQLStatement.zig");
const PreparedStatementsMap = std.HashMapUnmanaged(u64, *MySQLStatement, bun.IdentityContext(u64), 80);
const types = @import("./MySQLTypes.zig");
const Capabilities = @import("./Capabilities.zig");
const StatusFlags = @import("./StatusFlags.zig").StatusFlags;
const AuthMethod = @import("./AuthMethod.zig").AuthMethod;
const TLSStatus = @import("./TLSStatus.zig").TLSStatus;
const SSLMode = @import("./SSLMode.zig").SSLMode;
const PreparedStatement = @import("./protocol/PreparedStatement.zig");
const debug = bun.Output.scoped(.MySQLConnection, false);
const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
const NewReader = @import("./protocol/NewReader.zig").NewReader;
const BoringSSL = bun.BoringSSL;
const Data = @import("./protocol/Data.zig").Data;
const HandshakeResponse41 = @import("./protocol/HandshakeResponse41.zig");
const CharacterSet = @import("./protocol/CharacterSet.zig").CharacterSet;
const AuthSwitchResponse = @import("./protocol/AuthSwitchResponse.zig");
const HandshakeV10 = @import("./protocol/HandshakeV10.zig");
const String = bun.String;
const StackReader = @import("./protocol/StackReader.zig");
const PacketType = @import("./protocol/PacketType.zig").PacketType;
const OKPacket = @import("./protocol/OKPacket.zig");
const PacketHeader = @import("./protocol/PacketHeader.zig");
const ErrorPacket = @import("./protocol/ErrorPacket.zig");
const StmtPrepareOKPacket = @import("./protocol/StmtPrepareOKPacket.zig");
const ResultSetHeader = @import("./protocol/ResultSetHeader.zig");
const ColumnDefinition41 = @import("./protocol/ColumnDefinition41.zig");
const EOFPacket = @import("./protocol/EOFPacket.zig");
const ResultSet = @import("./protocol/ResultSet.zig");
const Auth = @import("./protocol/Auth.zig");
const LocalInfileRequest = @import("./protocol/LocalInfileRequest.zig");
const AuthSwitchRequest = @import("./protocol/AuthSwitchRequest.zig");
const MySQLQuery = @import("./MySQLQuery.zig");
const AutoFlusher = jsc.WebCore.AutoFlusher;
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
const Queue = std.fifo.LinearFifo(*MySQLQuery, .Dynamic);
