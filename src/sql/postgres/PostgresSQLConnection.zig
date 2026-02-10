const PostgresSQLConnection = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
socket: Socket,
status: Status = Status.connecting,
ref_count: RefCount = RefCount.init(),

write_buffer: bun.OffsetByteList = .{},
read_buffer: bun.OffsetByteList = .{},
last_message_start: u32 = 0,
requests: PostgresRequest.Queue,
// number of pipelined requests (Bind/Execute/Prepared statements)
pipelined_requests: u32 = 0,
// number of non-pipelined requests (Simple/Copy)
nonpipelinable_requests: u32 = 0,

poll_ref: bun.Async.KeepAlive = .{},
globalObject: *jsc.JSGlobalObject,
vm: *jsc.VirtualMachine,
statements: PreparedStatementsMap,
prepared_statement_id: u64 = 0,
pending_activity_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
js_value: JSValue = .js_undefined,

backend_parameters: bun.StringMap = bun.StringMap.init(bun.default_allocator, true),
backend_key_data: protocol.BackendKeyData = .{},

database: []const u8 = "",
user: []const u8 = "",
password: []const u8 = "",
path: []const u8 = "",
options: []const u8 = "",
options_buf: []const u8 = "",

authentication_state: AuthenticationState = .{ .pending = {} },

tls_ctx: ?*uws.SocketContext = null,
tls_config: jsc.API.ServerConfig.SSLConfig = .{},
tls_status: TLSStatus = .none,
ssl_mode: SSLMode = .disable,

idle_timeout_interval_ms: u32 = 0,
connection_timeout_ms: u32 = 0,

flags: ConnectionFlags = .{},

/// Before being connected, this is a connection timeout timer.
/// After being connected, this is an idle timeout timer.
timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .PostgresSQLConnectionTimeout,
    .next = .epoch,
},

/// This timer controls the maximum lifetime of a connection.
/// It starts when the connection successfully starts (i.e. after handshake is complete).
/// It stops when the connection is closed.
max_lifetime_interval_ms: u32 = 0,
max_lifetime_timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .PostgresSQLConnectionMaxLifetime,
    .next = .epoch,
},
auto_flusher: AutoFlusher = .{},

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn onAutoFlush(this: *@This()) bool {
    if (this.flags.has_backpressure) {
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
    const keep_flusher_registered = !this.flags.has_backpressure and this.write_buffer.len() > 0;
    debug("onAutoFlush: keep_flusher_registered: {}", .{keep_flusher_registered});
    this.auto_flusher.registered = keep_flusher_registered;
    return keep_flusher_registered;
}

fn registerAutoFlusher(this: *PostgresSQLConnection) void {
    const data_to_send = this.write_buffer.len();
    debug("registerAutoFlusher: backpressure: {} registered: {} data_to_send: {}", .{ this.flags.has_backpressure, this.auto_flusher.registered, data_to_send });

    if (!this.auto_flusher.registered and // should not be registered
        !this.flags.has_backpressure and // if has backpressure we need to wait for onWritable event
        data_to_send > 0 and // we need data to send
        this.status == .connected //and we need to be connected
    ) {
        AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, this.vm);
        this.auto_flusher.registered = true;
    }
}

fn unregisterAutoFlusher(this: *PostgresSQLConnection) void {
    debug("unregisterAutoFlusher registered: {}", .{this.auto_flusher.registered});
    if (this.auto_flusher.registered) {
        AutoFlusher.unregisterDeferredMicrotaskWithType(@This(), this, this.vm);
        this.auto_flusher.registered = false;
    }
}

fn getTimeoutInterval(this: *const PostgresSQLConnection) u32 {
    return switch (this.status) {
        .connected => this.idle_timeout_interval_ms,
        .failed => 0,
        else => this.connection_timeout_ms,
    };
}
pub fn disableConnectionTimeout(this: *PostgresSQLConnection) void {
    if (this.timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.timer);
    }
    this.timer.state = .CANCELLED;
}
pub fn resetConnectionTimeout(this: *PostgresSQLConnection) void {
    // if we are processing data, don't reset the timeout, wait for the data to be processed
    if (this.flags.is_processing_data) return;
    const interval = this.getTimeoutInterval();
    if (this.timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.timer);
    }
    if (interval == 0) {
        return;
    }

    this.timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(interval));
    this.vm.timer.insert(&this.timer);
}

pub fn getQueries(_: *PostgresSQLConnection, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    if (js.queriesGetCached(thisValue)) |value| {
        return value;
    }

    const array = try jsc.JSValue.createEmptyArray(globalObject, 0);
    js.queriesSetCached(thisValue, globalObject, array);

    return array;
}

pub fn getOnConnect(_: *PostgresSQLConnection, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (js.onconnectGetCached(thisValue)) |value| {
        return value;
    }

    return .js_undefined;
}

pub fn setOnConnect(_: *PostgresSQLConnection, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    js.onconnectSetCached(thisValue, globalObject, value);
}

pub fn getOnClose(_: *PostgresSQLConnection, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (js.oncloseGetCached(thisValue)) |value| {
        return value;
    }

    return .js_undefined;
}

pub fn setOnClose(_: *PostgresSQLConnection, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    js.oncloseSetCached(thisValue, globalObject, value);
}

pub fn setupTLS(this: *PostgresSQLConnection) void {
    debug("setupTLS", .{});
    const new_socket = this.socket.SocketTCP.socket.connected.upgrade(this.tls_ctx.?, this.tls_config.server_name) orelse {
        this.fail("Failed to upgrade to TLS", error.TLSUpgradeFailed);
        return;
    };
    this.socket = .{
        .SocketTLS = .{
            .socket = .{
                .connected = new_socket,
            },
        },
    };

    this.start();
}
fn setupMaxLifetimeTimerIfNecessary(this: *PostgresSQLConnection) void {
    if (this.max_lifetime_interval_ms == 0) return;
    if (this.max_lifetime_timer.state == .ACTIVE) return;

    this.max_lifetime_timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(this.max_lifetime_interval_ms));
    this.vm.timer.insert(&this.max_lifetime_timer);
}

pub fn onConnectionTimeout(this: *PostgresSQLConnection) void {
    debug("onConnectionTimeout", .{});

    this.timer.state = .FIRED;
    if (this.flags.is_processing_data) {
        return;
    }

    if (this.getTimeoutInterval() == 0) {
        this.resetConnectionTimeout();
        return;
    }

    switch (this.status) {
        .connected => {
            this.failFmt("ERR_POSTGRES_IDLE_TIMEOUT", "Idle timeout reached after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.idle_timeout_interval_ms) *| std.time.ns_per_ms)});
        },
        else => {
            this.failFmt("ERR_POSTGRES_CONNECTION_TIMEOUT", "Connection timeout after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.connection_timeout_ms) *| std.time.ns_per_ms)});
        },
        .sent_startup_message => {
            this.failFmt("ERR_POSTGRES_CONNECTION_TIMEOUT", "Connection timeout after {f} (sent startup message, but never received response)", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.connection_timeout_ms) *| std.time.ns_per_ms)});
        },
    }
}

pub fn onMaxLifetimeTimeout(this: *PostgresSQLConnection) void {
    debug("onMaxLifetimeTimeout", .{});
    this.max_lifetime_timer.state = .FIRED;
    if (this.status == .failed) return;
    this.failFmt("ERR_POSTGRES_LIFETIME_TIMEOUT", "Max lifetime timeout reached after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.max_lifetime_interval_ms) *| std.time.ns_per_ms)});
}

fn start(this: *PostgresSQLConnection) void {
    this.setupMaxLifetimeTimerIfNecessary();
    this.resetConnectionTimeout();
    this.sendStartupMessage();

    this.drainInternal();
}

pub fn hasPendingActivity(this: *PostgresSQLConnection) bool {
    return this.pending_activity_count.load(.acquire) > 0;
}

fn updateHasPendingActivity(this: *PostgresSQLConnection) void {
    const a: u32 = if (this.requests.readableLength() > 0) 1 else 0;
    const b: u32 = if (this.status != .disconnected) 1 else 0;
    this.pending_activity_count.store(a + b, .release);
}

pub fn setStatus(this: *PostgresSQLConnection, status: Status) void {
    if (this.status == status) return;
    defer this.updateHasPendingActivity();

    this.status = status;
    this.resetConnectionTimeout();
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

pub fn finalize(this: *PostgresSQLConnection) void {
    debug("PostgresSQLConnection finalize", .{});
    this.stopTimers();
    this.js_value = .zero;
    this.deref();
}

pub fn flushDataAndResetTimeout(this: *PostgresSQLConnection) void {
    this.resetConnectionTimeout();
    // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
    this.registerAutoFlusher();
}

pub fn flushData(this: *PostgresSQLConnection) void {
    // we know we still have backpressure so just return we will flush later
    if (this.flags.has_backpressure) {
        debug("flushData: has backpressure", .{});
        return;
    }

    const chunk = this.write_buffer.remaining();
    if (chunk.len == 0) {
        debug("flushData: no data to flush", .{});
        return;
    }

    const wrote = this.socket.write(chunk);
    this.flags.has_backpressure = wrote < chunk.len;
    debug("flushData: wrote {d}/{d} bytes", .{ wrote, chunk.len });
    if (wrote > 0) {
        SocketMonitor.write(chunk[0..@intCast(wrote)]);
        this.write_buffer.consume(@intCast(wrote));
    }
}

pub fn failWithJSValue(this: *PostgresSQLConnection, value: JSValue) void {
    defer this.updateHasPendingActivity();
    this.stopTimers();
    if (this.status == .failed) return;

    this.status = .failed;

    this.ref();
    defer this.deref();
    // we defer the refAndClose so the on_close will be called first before we reject the pending requests
    defer this.refAndClose(value);
    const on_close = this.consumeOnCloseCallback(this.globalObject) orelse return;

    const loop = this.vm.eventLoop();
    loop.enter();
    var js_error = value.toError() orelse value;
    if (js_error == .zero) {
        js_error = postgresErrorToJS(this.globalObject, "Connection closed", error.ConnectionClosed);
    }
    js_error.ensureStillAlive();
    defer loop.exit();
    _ = on_close.call(
        this.globalObject,
        .js_undefined,
        &[_]JSValue{
            js_error,
            this.getQueriesArray(),
        },
    ) catch |e| this.globalObject.reportActiveExceptionAsUnhandled(e);
}

pub fn failFmt(this: *PostgresSQLConnection, code: []const u8, comptime fmt: [:0]const u8, args: anytype) void {
    const message = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, fmt, args));
    defer bun.default_allocator.free(message);

    const err = createPostgresError(this.globalObject, message, .{ .code = code }) catch |e| this.globalObject.takeError(e);

    this.failWithJSValue(err);
}

pub fn fail(this: *PostgresSQLConnection, message: []const u8, err: AnyPostgresError) void {
    debug("failed: {s}: {s}", .{ message, @errorName(err) });

    const globalObject = this.globalObject;

    this.failWithJSValue(postgresErrorToJS(globalObject, message, err));
}

pub fn onClose(this: *PostgresSQLConnection) void {
    this.unregisterAutoFlusher();

    if (this.vm.isShuttingDown()) {
        defer this.updateHasPendingActivity();
        this.stopTimers();
        if (this.status == .failed) return;

        this.status = .failed;
        this.cleanUpRequests(null);
    } else {
        const loop = this.vm.eventLoop();
        loop.enter();
        defer loop.exit();
        this.poll_ref.unref(this.vm);

        this.fail("Connection closed", error.ConnectionClosed);
    }
}

fn sendStartupMessage(this: *PostgresSQLConnection) void {
    if (this.status != .connecting) return;
    debug("sendStartupMessage", .{});
    this.status = .sent_startup_message;
    var msg = protocol.StartupMessage{
        .user = Data{ .temporary = this.user },
        .database = Data{ .temporary = this.database },
        .options = Data{ .temporary = this.options },
    };
    msg.writeInternal(Writer, this.writer()) catch |err| {
        this.fail("Failed to write startup message", err);
    };
}

fn startTLS(this: *PostgresSQLConnection, socket: uws.AnySocket) void {
    debug("startTLS", .{});
    const offset = switch (this.tls_status) {
        .message_sent => |count| count,
        else => 0,
    };
    const ssl_request = [_]u8{
        0x00, 0x00, 0x00, 0x08, // Length
        0x04, 0xD2, 0x16, 0x2F, // SSL request code
    };

    const written = socket.write(ssl_request[offset..]);
    if (written > 0) {
        this.tls_status = .{
            .message_sent = offset + @as(u8, @intCast(written)),
        };
    } else {
        this.tls_status = .{
            .message_sent = offset,
        };
    }
}

pub fn onOpen(this: *PostgresSQLConnection, socket: uws.AnySocket) void {
    this.socket = socket;

    this.poll_ref.ref(this.vm);
    this.updateHasPendingActivity();

    if (this.tls_status == .message_sent or this.tls_status == .pending) {
        this.startTLS(socket);
        return;
    }

    this.start();
}

pub fn onHandshake(this: *PostgresSQLConnection, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
    debug("onHandshake: {d} {d}", .{ success, ssl_error.error_no });
    const handshake_success = if (success == 1) true else false;
    if (handshake_success) {
        if (this.tls_config.reject_unauthorized != 0) {
            // only reject the connection if reject_unauthorized == true
            switch (this.ssl_mode) {
                // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279

                .verify_ca, .verify_full => {
                    if (ssl_error.error_no != 0) {
                        this.failWithJSValue(ssl_error.toJS(this.globalObject) catch return);
                        return;
                    }

                    const ssl_ptr: *BoringSSL.c.SSL = @ptrCast(this.socket.getNativeHandle());
                    if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.failWithJSValue(ssl_error.toJS(this.globalObject) catch return);
                        }
                    }
                },
                // require is the same as prefer
                .require, .prefer, .disable => {},
            }
        }
    } else {
        // if we are here is because server rejected us, and the error_no is the cause of this
        // no matter if reject_unauthorized is false because we are disconnected by the server
        this.failWithJSValue(ssl_error.toJS(this.globalObject) catch return);
    }
}

pub fn onTimeout(this: *PostgresSQLConnection) void {
    _ = this;
    debug("onTimeout", .{});
}

pub fn onDrain(this: *PostgresSQLConnection) void {
    debug("onDrain", .{});
    this.flags.has_backpressure = false;
    // Don't send any other messages while we're waiting for TLS.
    if (this.tls_status == .message_sent) {
        if (this.tls_status.message_sent < 8) {
            this.startTLS(this.socket);
        }

        return;
    }

    this.drainInternal();
}

fn drainInternal(this: *PostgresSQLConnection) void {
    debug("drainInternal", .{});
    if (this.vm.isShuttingDown()) return this.close();

    const event_loop = this.vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();

    this.flushData();

    if (!this.flags.has_backpressure and this.flags.is_ready_for_query) {
        // no backpressure yet so pipeline more if possible and flush again
        this.advance();
        this.flushData();
    }
}

pub fn onData(this: *PostgresSQLConnection, data: []const u8) void {
    this.ref();
    this.flags.is_processing_data = true;
    const vm = this.vm;

    this.disableConnectionTimeout();
    defer {
        if (this.status == .connected and !this.hasQueryRunning() and this.write_buffer.remaining().len == 0) {
            // Don't keep the process alive when there's nothing to do.
            this.poll_ref.unref(vm);
        } else if (this.status == .connected) {
            // Keep the process alive if there's something to do.
            this.poll_ref.ref(vm);
        }
        this.flags.is_processing_data = false;

        // reset the connection timeout after we're done processing the data
        this.resetConnectionTimeout();
        this.deref();
    }

    const event_loop = vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();
    SocketMonitor.read(data);
    // reset the head to the last message so remaining reflects the right amount of bytes
    this.read_buffer.head = this.last_message_start;

    if (this.read_buffer.remaining().len == 0) {
        var consumed: usize = 0;
        var offset: usize = 0;
        const reader = protocol.StackReader.init(data, &consumed, &offset);
        PostgresRequest.onData(this, protocol.StackReader, reader) catch |err| {
            if (err == error.ShortRead) {
                if (comptime bun.Environment.allow_assert) {
                    debug("read_buffer: empty and received short read: last_message_start: {d}, head: {d}, len: {d}", .{
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
                bun.handleErrorReturnTrace(err, @errorReturnTrace());

                this.fail("Failed to read data", err);
            }
        };
        // no need to reset anything, its already empty
        return;
    }
    // read buffer is not empty, so we need to write the data to the buffer and then read it
    this.read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
    PostgresRequest.onData(this, Reader, this.bufferedReader()) catch |err| {
        if (err != error.ShortRead) {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            this.fail("Failed to read data", err);
            return;
        }

        if (comptime bun.Environment.allow_assert) {
            debug("read_buffer: not empty and received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                this.last_message_start,
                this.read_buffer.head,
                this.read_buffer.byte_list.len,
            });
        }
        return;
    };

    debug("clean read_buffer", .{});
    // success, we read everything! let's reset the last message start and the head
    this.last_message_start = 0;
    this.read_buffer.head = 0;
}

pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*PostgresSQLConnection {
    _ = callframe;
    return globalObject.throw("PostgresSQLConnection cannot be constructed directly", .{});
}

comptime {
    const jscall = jsc.toJSHostFn(call);
    @export(&jscall, .{ .name = "PostgresSQLConnection__createInstance" });
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

        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match.
        // We create it right here so we can throw errors early.
        const context_options = tls_config.asUSocketsForClientVerification();
        var err: uws.create_bun_socket_error_t = .none;
        tls_ctx = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*PostgresSQLConnection), context_options, &err) orelse {
            if (err != .none) {
                return globalObject.throw("failed to create TLS context", .{});
            } else {
                return globalObject.throwValue(err.toJS(globalObject));
            }
        };
        if (err != .none) {
            tls_config.deinit();
            if (tls_ctx) |ctx| {
                ctx.deinit(true);
            }
            return globalObject.throwValue(err.toJS(globalObject));
        }

        uws.NewSocketHandler(true).configure(tls_ctx.?, true, *PostgresSQLConnection, SocketHandler(true));
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
    const idle_timeout = arguments[11].toInt32();
    const connection_timeout = arguments[12].toInt32();
    const max_lifetime = arguments[13].toInt32();
    const use_unnamed_prepared_statements = arguments[14].asBoolean();

    const ptr: *PostgresSQLConnection = try bun.default_allocator.create(PostgresSQLConnection);

    ptr.* = PostgresSQLConnection{
        .globalObject = globalObject,
        .vm = vm,
        .database = database,
        .user = username,
        .password = password,
        .path = path,
        .options = options,
        .options_buf = options_buf,
        .socket = .{ .SocketTCP = .{ .socket = .{ .detached = {} } } },
        .requests = PostgresRequest.Queue.init(bun.default_allocator),
        .statements = PreparedStatementsMap{},
        .tls_config = tls_config,
        .tls_ctx = tls_ctx,
        .ssl_mode = ssl_mode,
        .tls_status = if (ssl_mode != .disable) .pending else .none,
        .idle_timeout_interval_ms = @intCast(idle_timeout),
        .connection_timeout_ms = @intCast(connection_timeout),
        .max_lifetime_interval_ms = @intCast(max_lifetime),
        .flags = .{
            .use_unnamed_prepared_statements = use_unnamed_prepared_statements,
        },
    };

    {
        const hostname = hostname_str.toUTF8(bun.default_allocator);
        defer hostname.deinit();

        const ctx = vm.rareData().postgresql_context.tcp orelse brk: {
            const ctx_ = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*PostgresSQLConnection)).?;
            uws.NewSocketHandler(false).configure(ctx_, true, *PostgresSQLConnection, SocketHandler(false));
            vm.rareData().postgresql_context.tcp = ctx_;
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
                    return globalObject.throwError(err, "failed to connect to postgresql");
                },
            };
        }
    }

    // only call toJS if connectUnixAnon does not fail immediately
    ptr.updateHasPendingActivity();
    ptr.resetConnectionTimeout();
    ptr.poll_ref.ref(vm);
    const js_value = ptr.toJS(globalObject);
    js_value.ensureStillAlive();
    ptr.js_value = js_value;
    js.onconnectSetCached(js_value, globalObject, on_connect);
    js.oncloseSetCached(js_value, globalObject, on_close);
    bun.analytics.Features.postgres_connections += 1;
    return js_value;
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
        pub fn onOpen(this: *PostgresSQLConnection, socket: SocketType) void {
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onOpen(_socket(socket));
        }

        fn onHandshake_(this: *PostgresSQLConnection, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onHandshake(success, ssl_error);
        }

        pub const onHandshake = if (ssl) onHandshake_ else null;

        pub fn onClose(this: *PostgresSQLConnection, socket: SocketType, _: i32, _: ?*anyopaque) void {
            _ = socket;
            this.onClose();
        }

        pub fn onEnd(this: *PostgresSQLConnection, socket: SocketType) void {
            _ = socket;
            this.onClose();
        }

        pub fn onConnectError(this: *PostgresSQLConnection, socket: SocketType, _: i32) void {
            _ = socket;
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onClose();
        }

        pub fn onTimeout(this: *PostgresSQLConnection, socket: SocketType) void {
            _ = socket;
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onTimeout();
        }

        pub fn onData(this: *PostgresSQLConnection, socket: SocketType, data: []const u8) void {
            _ = socket;
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onData(data);
        }

        pub fn onWritable(this: *PostgresSQLConnection, socket: SocketType) void {
            _ = socket;
            if (this.vm.isShuttingDown()) {
                @branchHint(.unlikely);
                this.close();
                return;
            }
            this.onDrain();
        }
    };
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
pub fn doFlush(this: *PostgresSQLConnection, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    this.registerAutoFlusher();
    return .js_undefined;
}

fn close(this: *@This()) void {
    this.disconnect();
    this.unregisterAutoFlusher();
    this.write_buffer.clearAndFree(bun.default_allocator);
}

pub fn doClose(this: *@This(), globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.close();
    return .js_undefined;
}

pub fn stopTimers(this: *PostgresSQLConnection) void {
    if (this.timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.timer);
    }
    if (this.max_lifetime_timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.max_lifetime_timer);
    }
}

pub fn deinit(this: *@This()) void {
    this.disconnect();
    this.stopTimers();
    var iter = this.statements.valueIterator();
    while (iter.next()) |stmt_ptr| {
        var stmt = stmt_ptr.*;
        stmt.deref();
    }
    this.statements.deinit(bun.default_allocator);
    this.write_buffer.deinit(bun.default_allocator);
    this.read_buffer.deinit(bun.default_allocator);
    this.backend_parameters.deinit();

    bun.freeSensitive(bun.default_allocator, this.options_buf);

    this.tls_config.deinit();
    bun.default_allocator.destroy(this);
}

fn cleanUpRequests(this: *@This(), js_reason: ?jsc.JSValue) void {
    while (this.current()) |request| {
        switch (request.status) {
            // pending we will fail the request and the stmt will be marked as error ConnectionClosed too
            .pending => {
                const stmt = request.statement orelse continue;
                stmt.error_response = .{ .postgres_error = AnyPostgresError.ConnectionClosed };
                stmt.status = .failed;
                if (!this.vm.isShuttingDown()) {
                    if (js_reason) |reason| {
                        request.onJSError(reason, this.globalObject);
                    } else {
                        request.onError(.{ .postgres_error = AnyPostgresError.ConnectionClosed }, this.globalObject);
                    }
                }
            },
            // in the middle of running
            .binding,
            .running,
            .partial_response,
            => {
                this.finishRequest(request);
                if (!this.vm.isShuttingDown()) {
                    if (js_reason) |reason| {
                        request.onJSError(reason, this.globalObject);
                    } else {
                        request.onError(.{ .postgres_error = AnyPostgresError.ConnectionClosed }, this.globalObject);
                    }
                }
            },
            // just ignore success and fail cases
            .success, .fail => {},
        }
        request.deref();
        this.requests.discard(1);
    }
}
fn refAndClose(this: *@This(), js_reason: ?jsc.JSValue) void {
    // refAndClose is always called when we wanna to disconnect or when we are closed

    if (!this.socket.isClosed()) {
        // event loop need to be alive to close the socket
        this.poll_ref.ref(this.vm);
        // will unref on socket close
        this.socket.close();
    }

    // cleanup requests
    this.cleanUpRequests(js_reason);
}

pub fn disconnect(this: *@This()) void {
    this.stopTimers();
    this.unregisterAutoFlusher();
    if (this.status == .connected) {
        this.status = .disconnected;
        this.refAndClose(null);
    }
}

fn current(this: *PostgresSQLConnection) ?*PostgresSQLQuery {
    if (this.requests.readableLength() == 0) {
        return null;
    }

    return this.requests.peekItem(0);
}

pub fn hasQueryRunning(this: *PostgresSQLConnection) bool {
    return !this.flags.is_ready_for_query or this.current() != null;
}

pub fn canPipeline(this: *PostgresSQLConnection) bool {
    if (bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING.get()) {
        @branchHint(.unlikely);
        return false;
    }

    return this.nonpipelinable_requests == 0 and // need to wait for non pipelinable requests to finish
        !this.flags.use_unnamed_prepared_statements and // unnamed statements are not pipelinable
        !this.flags.waiting_to_prepare and // cannot pipeline when waiting prepare
        !this.flags.has_backpressure and // dont make sense to buffer more if we have backpressure
        this.write_buffer.len() < MAX_PIPELINE_SIZE; // buffer is too big need to flush before pipeline more
}

pub const Writer = struct {
    connection: *PostgresSQLConnection,

    pub fn write(this: Writer, data: []const u8) AnyPostgresError!void {
        var buffer = &this.connection.write_buffer;
        try buffer.write(bun.default_allocator, data);
    }

    pub fn pwrite(this: Writer, data: []const u8, index: usize) AnyPostgresError!void {
        @memcpy(this.connection.write_buffer.byte_list.slice()[index..][0..data.len], data);
    }

    pub fn offset(this: Writer) usize {
        return this.connection.write_buffer.len();
    }
};

pub fn writer(this: *PostgresSQLConnection) protocol.NewWriter(Writer) {
    return .{
        .wrapped = .{
            .connection = this,
        },
    };
}

pub const Reader = struct {
    connection: *PostgresSQLConnection,

    pub fn markMessageStart(this: Reader) void {
        this.connection.last_message_start = this.connection.read_buffer.head;
    }

    pub const ensureLength = ensureCapacity;

    pub fn peek(this: Reader) []const u8 {
        return this.connection.read_buffer.remaining();
    }
    pub fn skip(this: Reader, count: usize) void {
        this.connection.read_buffer.head = @min(this.connection.read_buffer.head + @as(u32, @truncate(count)), this.connection.read_buffer.byte_list.len);
    }
    pub fn ensureCapacity(this: Reader, count: usize) bool {
        return @as(usize, this.connection.read_buffer.head) + count <= @as(usize, this.connection.read_buffer.byte_list.len);
    }
    pub fn read(this: Reader, count: usize) AnyPostgresError!Data {
        var remaining = this.connection.read_buffer.remaining();
        if (@as(usize, remaining.len) < count) {
            return error.ShortRead;
        }

        this.skip(count);
        return Data{
            .temporary = remaining[0..count],
        };
    }
    pub fn readZ(this: Reader) AnyPostgresError!Data {
        const remain = this.connection.read_buffer.remaining();

        if (bun.strings.indexOfChar(remain, 0)) |zero| {
            this.skip(zero + 1);
            return Data{
                .temporary = remain[0..zero],
            };
        }

        return error.ShortRead;
    }
};

pub fn bufferedReader(this: *PostgresSQLConnection) protocol.NewReader(Reader) {
    return .{
        .wrapped = .{ .connection = this },
    };
}

fn finishRequest(this: *@This(), item: *PostgresSQLQuery) void {
    switch (item.status) {
        .running, .binding, .partial_response => {
            if (item.flags.simple) {
                this.nonpipelinable_requests -= 1;
            } else if (item.flags.pipelined) {
                this.pipelined_requests -= 1;
            }
        },
        .success, .fail, .pending => {},
    }
}

pub fn canPrepareQuery(noalias this: *const @This()) bool {
    return this.flags.is_ready_for_query and !this.flags.waiting_to_prepare and this.pipelined_requests == 0;
}

fn advance(this: *PostgresSQLConnection) void {
    var offset: usize = 0;
    debug("advance", .{});
    defer {
        while (this.requests.readableLength() > 0) {
            const result = this.requests.peekItem(0);
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            switch (result.status) {
                .success => {
                    result.deref();
                    this.requests.discard(1);
                    continue;
                },
                .fail => {
                    result.deref();
                    this.requests.discard(1);
                    continue;
                },
                else => break, // trully current item
            }
        }
    }
    while (this.requests.readableLength() > offset and !this.flags.has_backpressure) {
        if (this.vm.isShuttingDown()) return this.close();

        var req: *PostgresSQLQuery = this.requests.peekItem(offset);
        switch (req.status) {
            .pending => {
                if (req.flags.simple) {
                    if (this.pipelined_requests > 0 or !this.flags.is_ready_for_query) {
                        debug("cannot execute simple query, pipelined_requests: {d}, is_ready_for_query: {}", .{ this.pipelined_requests, this.flags.is_ready_for_query });
                        // need to wait for the previous request to finish before starting simple queries
                        return;
                    }
                    var query_str = req.query.toUTF8(bun.default_allocator);
                    defer query_str.deinit();
                    debug("execute simple query: {s}", .{query_str.slice()});
                    PostgresRequest.executeQuery(query_str.slice(), PostgresSQLConnection.Writer, this.writer()) catch |err| {
                        if (this.globalObject.tryTakeException()) |err_| {
                            req.onJSError(err_, this.globalObject);
                        } else {
                            req.onWriteFail(err, this.globalObject, this.getQueriesArray());
                        }
                        if (offset == 0) {
                            req.deref();
                            this.requests.discard(1);
                        } else {
                            // deinit later
                            req.status = .fail;
                        }
                        debug("executeQuery failed: {s}", .{@errorName(err)});
                        continue;
                    };
                    this.nonpipelinable_requests += 1;
                    this.flags.is_ready_for_query = false;
                    req.status = .running;
                    return;
                } else {
                    if (req.statement) |statement| {
                        switch (statement.status) {
                            .failed => {
                                debug("stmt failed", .{});
                                bun.assert(statement.error_response != null);
                                req.onError(statement.error_response.?, this.globalObject);
                                if (offset == 0) {
                                    req.deref();
                                    this.requests.discard(1);
                                } else {
                                    // deinit later
                                    req.status = .fail;
                                    offset += 1;
                                }

                                continue;
                            },
                            .prepared => {
                                const thisValue = req.thisValue.tryGet() orelse {
                                    bun.assertf(false, "query value was freed earlier than expected", .{});
                                    if (offset == 0) {
                                        req.deref();
                                        this.requests.discard(1);
                                    } else {
                                        // deinit later
                                        req.status = .fail;
                                        offset += 1;
                                    }
                                    continue;
                                };
                                const binding_value = PostgresSQLQuery.js.bindingGetCached(thisValue) orelse .zero;
                                const columns_value = PostgresSQLQuery.js.columnsGetCached(thisValue) orelse .zero;
                                req.flags.binary = statement.fields.len > 0;
                                debug("binding and executing stmt", .{});
                                PostgresRequest.bindAndExecute(this.globalObject, statement, binding_value, columns_value, PostgresSQLConnection.Writer, this.writer()) catch |err| {
                                    if (this.globalObject.tryTakeException()) |err_| {
                                        req.onJSError(err_, this.globalObject);
                                    } else {
                                        req.onWriteFail(err, this.globalObject, this.getQueriesArray());
                                    }
                                    if (offset == 0) {
                                        req.deref();
                                        this.requests.discard(1);
                                    } else {
                                        // deinit later
                                        req.status = .fail;
                                        offset += 1;
                                    }
                                    debug("bind and execute failed: {s}", .{@errorName(err)});
                                    continue;
                                };

                                this.flags.is_ready_for_query = false;
                                req.status = .binding;
                                req.flags.pipelined = true;
                                this.pipelined_requests += 1;

                                if (this.flags.use_unnamed_prepared_statements or !this.canPipeline()) {
                                    debug("cannot pipeline more stmt", .{});
                                    return;
                                }

                                offset += 1;
                                continue;
                            },
                            .pending => {
                                if (!this.canPrepareQuery()) {
                                    debug("need to wait to finish the pipeline before starting a new query preparation", .{});
                                    // need to wait to finish the pipeline before starting a new query preparation
                                    return;
                                }
                                // statement is pending, lets write/parse it
                                var query_str = req.query.toUTF8(bun.default_allocator);
                                defer query_str.deinit();
                                const has_params = statement.signature.fields.len > 0;
                                // If it does not have params, we can write and execute immediately in one go
                                if (!has_params) {
                                    const thisValue = req.thisValue.tryGet() orelse {
                                        bun.assertf(false, "query value was freed earlier than expected", .{});
                                        if (offset == 0) {
                                            req.deref();
                                            this.requests.discard(1);
                                        } else {
                                            // deinit later
                                            req.status = .fail;
                                            offset += 1;
                                        }
                                        continue;
                                    };
                                    // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                                    const binding_value = PostgresSQLQuery.js.bindingGetCached(thisValue) orelse .zero;
                                    debug("prepareAndQueryWithSignature", .{});
                                    PostgresRequest.prepareAndQueryWithSignature(this.globalObject, query_str.slice(), binding_value, PostgresSQLConnection.Writer, this.writer(), &statement.signature) catch |err| {
                                        if (this.globalObject.tryTakeException()) |err_| {
                                            req.onJSError(err_, this.globalObject);
                                        } else {
                                            statement.status = .failed;
                                            statement.error_response = .{ .postgres_error = err };
                                            req.onWriteFail(err, this.globalObject, this.getQueriesArray());
                                        }
                                        if (offset == 0) {
                                            req.deref();
                                            this.requests.discard(1);
                                        } else {
                                            // deinit later
                                            req.status = .fail;
                                        }
                                        debug("prepareAndQueryWithSignature failed: {s}", .{@errorName(err)});

                                        continue;
                                    };
                                    this.flags.is_ready_for_query = false;
                                    this.flags.waiting_to_prepare = true;
                                    req.status = .binding;
                                    statement.status = .parsing;
                                    this.flushDataAndResetTimeout();
                                    return;
                                }

                                const connection_writer = this.writer();
                                debug("writing query", .{});
                                // write query and wait for it to be prepared
                                PostgresRequest.writeQuery(query_str.slice(), statement.signature.prepared_statement_name, statement.signature.fields, PostgresSQLConnection.Writer, connection_writer) catch |err| {
                                    if (this.globalObject.tryTakeException()) |err_| {
                                        req.onJSError(err_, this.globalObject);
                                    } else {
                                        statement.error_response = .{ .postgres_error = err };
                                        statement.status = .failed;
                                        req.onWriteFail(err, this.globalObject, this.getQueriesArray());
                                    }
                                    bun.assert(offset == 0);
                                    req.deref();
                                    this.requests.discard(1);
                                    debug("write query failed: {s}", .{@errorName(err)});
                                    continue;
                                };
                                connection_writer.write(&protocol.Sync) catch |err| {
                                    if (this.globalObject.tryTakeException()) |err_| {
                                        req.onJSError(err_, this.globalObject);
                                    } else {
                                        statement.error_response = .{ .postgres_error = err };
                                        statement.status = .failed;
                                        req.onWriteFail(err, this.globalObject, this.getQueriesArray());
                                    }
                                    bun.assert(offset == 0);
                                    req.deref();
                                    this.requests.discard(1);
                                    debug("write query (sync) failed: {s}", .{@errorName(err)});
                                    continue;
                                };
                                this.flags.is_ready_for_query = false;
                                this.flags.waiting_to_prepare = true;
                                statement.status = .parsing;
                                this.flushDataAndResetTimeout();
                                return;
                            },
                            .parsing => {
                                // we are still parsing, lets wait for it to be prepared or failed
                                offset += 1;
                                continue;
                            },
                        }
                    } else {
                        offset += 1;
                        continue;
                    }
                }
            },

            .running, .binding, .partial_response => {
                if (this.flags.waiting_to_prepare or this.nonpipelinable_requests > 0) {
                    return;
                }
                const total_requests_running = this.pipelined_requests;
                if (offset < total_requests_running) {
                    offset += total_requests_running;
                } else {
                    offset += 1;
                }
                continue;
            },
            .success => {
                if (offset > 0) {
                    // deinit later
                    req.status = .fail;
                    offset += 1;
                    continue;
                }
                req.deref();
                this.requests.discard(1);
                continue;
            },
            .fail => {
                if (offset > 0) {
                    // deinit later
                    offset += 1;
                    continue;
                }
                req.deref();
                this.requests.discard(1);
                continue;
            },
        }
    }
}

pub fn getQueriesArray(this: *const PostgresSQLConnection) JSValue {
    if (this.js_value.isEmptyOrUndefinedOrNull()) {
        return .js_undefined;
    }
    return js.queriesGetCached(this.js_value) orelse .js_undefined;
}

pub fn on(this: *PostgresSQLConnection, comptime MessageType: @Type(.enum_literal), comptime Context: type, reader: protocol.NewReader(Context)) AnyPostgresError!void {
    debug("on({s})", .{@tagName(MessageType)});

    switch (comptime MessageType) {
        .DataRow => {
            const request = this.current() orelse return error.ExpectedRequest;

            var statement = request.statement orelse return error.ExpectedStatement;
            var structure: JSValue = .js_undefined;
            var cached_structure: ?PostgresCachedStructure = null;
            // explicit use switch without else so if new modes are added, we don't forget to check for duplicate fields
            switch (request.flags.result_mode) {
                .objects => {
                    cached_structure = statement.structure(this.js_value, this.globalObject);
                    structure = cached_structure.?.jsValue() orelse .js_undefined;
                },
                .raw, .values => {
                    // no need to check for duplicate fields or structure
                },
            }

            var putter = DataCell.Putter{
                .list = &.{},
                .fields = statement.fields,
                .binary = request.flags.binary,
                .bigint = request.flags.bigint,
                .globalObject = this.globalObject,
            };

            var stack_buf: [70]DataCell.SQLDataCell = undefined;
            var cells: []DataCell.SQLDataCell = stack_buf[0..@min(statement.fields.len, jsc.JSObject.maxInlineCapacity())];
            var free_cells = false;
            defer {
                for (cells[0..putter.count]) |*cell| {
                    cell.deinit();
                }
                if (free_cells) bun.default_allocator.free(cells);
            }

            if (statement.fields.len >= jsc.JSObject.maxInlineCapacity()) {
                cells = try bun.default_allocator.alloc(DataCell.SQLDataCell, statement.fields.len);
                free_cells = true;
            }
            // make sure all cells are reset if reader short breaks the fields will just be null with is better than undefined behavior
            @memset(cells, DataCell.SQLDataCell{ .tag = .null, .value = .{ .null = 0 } });
            putter.list = cells;

            if (request.flags.result_mode == .raw) {
                try protocol.DataRow.decode(
                    &putter,
                    Context,
                    reader,
                    DataCell.Putter.putRaw,
                );
            } else {
                try protocol.DataRow.decode(
                    &putter,
                    Context,
                    reader,
                    DataCell.Putter.put,
                );
            }
            const thisValue = request.thisValue.tryGet() orelse return {
                bun.assertf(false, "query value was freed earlier than expected", .{});
                return error.ExpectedRequest;
            };
            const pending_value = PostgresSQLQuery.js.pendingValueGetCached(thisValue) orelse .zero;
            pending_value.ensureStillAlive();
            const result = try putter.toJS(
                this.globalObject,
                pending_value,
                structure,
                statement.fields_flags,
                request.flags.result_mode,
                cached_structure,
            );

            if (pending_value == .zero) {
                PostgresSQLQuery.js.pendingValueSetCached(thisValue, this.globalObject, result);
            }
        },
        .CopyData => {
            var copy_data: protocol.CopyData = undefined;
            try copy_data.decodeInternal(Context, reader);
            copy_data.data.deinit();
        },
        .ParameterStatus => {
            var parameter_status: protocol.ParameterStatus = undefined;
            try parameter_status.decodeInternal(Context, reader);
            defer {
                parameter_status.deinit();
            }
            try this.backend_parameters.insert(parameter_status.name.slice(), parameter_status.value.slice());
        },
        .ReadyForQuery => {
            var ready_for_query: protocol.ReadyForQuery = undefined;
            try ready_for_query.decodeInternal(Context, reader);

            this.setStatus(.connected);
            this.flags.waiting_to_prepare = false;
            this.flags.is_ready_for_query = true;
            this.socket.setTimeout(300);
            defer this.updateRef();

            if (this.current()) |request| {
                if (request.status == .partial_response) {
                    this.finishRequest(request);
                    // if is a partial response, just signal that the query is now complete
                    request.onResult("", this.globalObject, this.js_value, true);
                }
            }
            this.advance();

            this.registerAutoFlusher();
        },
        .CommandComplete => {
            var request = this.current() orelse return error.ExpectedRequest;

            var cmd: protocol.CommandComplete = undefined;
            try cmd.decodeInternal(Context, reader);
            defer {
                cmd.deinit();
            }
            debug("-> {s}", .{cmd.command_tag.slice()});
            defer this.updateRef();

            request.onResult(cmd.command_tag.slice(), this.globalObject, this.js_value, false);
        },
        .BindComplete => {
            try reader.eatMessage(protocol.BindComplete);
            var request = this.current() orelse return error.ExpectedRequest;
            if (request.status == .binding) {
                request.status = .running;
            }
        },
        .ParseComplete => {
            try reader.eatMessage(protocol.ParseComplete);
            const request = this.current() orelse return error.ExpectedRequest;
            if (request.statement) |statement| {
                // if we have params wait for parameter description
                if (statement.status == .parsing and statement.signature.fields.len == 0) {
                    statement.status = .prepared;
                    this.flags.waiting_to_prepare = false;
                }
            }
        },
        .ParameterDescription => {
            var description: protocol.ParameterDescription = undefined;
            try description.decodeInternal(Context, reader);
            const request = this.current() orelse return error.ExpectedRequest;
            var statement = request.statement orelse return error.ExpectedStatement;
            statement.parameters = description.parameters;
            if (statement.status == .parsing) {
                statement.status = .prepared;
                this.flags.waiting_to_prepare = false;
            }
        },
        .RowDescription => {
            var description: protocol.RowDescription = undefined;
            try description.decodeInternal(Context, reader);
            errdefer description.deinit();
            const request = this.current() orelse return error.ExpectedRequest;
            var statement = request.statement orelse return error.ExpectedStatement;
            statement.fields = description.fields;
        },
        .Authentication => {
            var auth: protocol.Authentication = undefined;
            try auth.decodeInternal(Context, reader);
            defer auth.deinit();

            switch (auth) {
                .SASL => {
                    if (this.authentication_state != .SASL) {
                        this.authentication_state = .{ .SASL = .{} };
                    }

                    var mechanism_buf: [128]u8 = undefined;
                    const mechanism = std.fmt.bufPrintZ(&mechanism_buf, "n,,n=*,r={s}", .{this.authentication_state.SASL.nonce()}) catch unreachable;
                    var response = protocol.SASLInitialResponse{
                        .mechanism = .{
                            .temporary = "SCRAM-SHA-256",
                        },
                        .data = .{
                            .temporary = mechanism,
                        },
                    };

                    try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                    debug("SASL", .{});
                    this.flushData();
                },
                .SASLContinue => |*cont| {
                    if (this.authentication_state != .SASL) {
                        debug("Unexpected SASLContinue for authentiation state: {s}", .{@tagName(std.meta.activeTag(this.authentication_state))});
                        return error.UnexpectedMessage;
                    }
                    var sasl = &this.authentication_state.SASL;

                    if (sasl.status != .init) {
                        debug("Unexpected SASLContinue for SASL state: {s}", .{@tagName(sasl.status)});
                        return error.UnexpectedMessage;
                    }
                    debug("SASLContinue", .{});

                    const iteration_count = try cont.iterationCount();

                    const server_salt_decoded_base64 = bun.base64.decodeAlloc(bun.z_allocator, cont.s) catch |err| {
                        return switch (err) {
                            error.DecodingFailed => error.SASL_SIGNATURE_INVALID_BASE64,
                            else => |e| e,
                        };
                    };
                    defer bun.z_allocator.free(server_salt_decoded_base64);
                    try sasl.computeSaltedPassword(server_salt_decoded_base64, iteration_count, this);

                    const auth_string = try std.fmt.allocPrint(
                        bun.z_allocator,
                        "n=*,r={s},r={s},s={s},i={s},c=biws,r={s}",
                        .{
                            sasl.nonce(),
                            cont.r,
                            cont.s,
                            cont.i,
                            cont.r,
                        },
                    );
                    defer bun.z_allocator.free(auth_string);
                    try sasl.computeServerSignature(auth_string);

                    const client_key = sasl.clientKey();
                    const client_key_signature = sasl.clientKeySignature(&client_key, auth_string);
                    var client_key_xor_buffer: [32]u8 = undefined;
                    for (&client_key_xor_buffer, client_key, client_key_signature) |*out, a, b| {
                        out.* = a ^ b;
                    }

                    var client_key_xor_base64_buf = std.mem.zeroes([bun.base64.encodeLenFromSize(32)]u8);
                    const xor_base64_len = bun.base64.encode(&client_key_xor_base64_buf, &client_key_xor_buffer);

                    const payload = try std.fmt.allocPrint(
                        bun.z_allocator,
                        "c=biws,r={s},p={s}",
                        .{ cont.r, client_key_xor_base64_buf[0..xor_base64_len] },
                    );
                    defer bun.z_allocator.free(payload);

                    var response = protocol.SASLResponse{
                        .data = .{
                            .temporary = payload,
                        },
                    };

                    try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                    sasl.status = .@"continue";
                    this.flushData();
                },
                .SASLFinal => |final| {
                    if (this.authentication_state != .SASL) {
                        debug("SASLFinal - Unexpected SASLContinue for authentiation state: {s}", .{@tagName(std.meta.activeTag(this.authentication_state))});
                        return error.UnexpectedMessage;
                    }
                    var sasl = &this.authentication_state.SASL;

                    if (sasl.status != .@"continue") {
                        debug("SASLFinal - Unexpected SASLContinue for SASL state: {s}", .{@tagName(sasl.status)});
                        return error.UnexpectedMessage;
                    }

                    if (sasl.server_signature_len == 0) {
                        debug("SASLFinal - Server signature is empty", .{});
                        return error.UnexpectedMessage;
                    }

                    const server_signature = sasl.serverSignature();

                    // This will usually start with "v="
                    const comparison_signature = final.data.slice();

                    if (comparison_signature.len < 2 or !bun.strings.eqlLong(server_signature, comparison_signature[2..], true)) {
                        debug("SASLFinal - SASL Server signature mismatch\nExpected: {s}\nActual: {s}", .{ server_signature, comparison_signature[2..] });
                        this.fail("The server did not return the correct signature", error.SASL_SIGNATURE_MISMATCH);
                    } else {
                        debug("SASLFinal - SASL Server signature match", .{});
                        this.authentication_state.zero();
                    }
                },
                .Ok => {
                    debug("Authentication OK", .{});
                    this.authentication_state.zero();
                    this.authentication_state = .{ .ok = {} };
                },

                .Unknown => {
                    this.fail("Unknown authentication method", error.UNKNOWN_AUTHENTICATION_METHOD);
                },

                .ClearTextPassword => {
                    debug("ClearTextPassword", .{});
                    var response = protocol.PasswordMessage{
                        .password = .{
                            .temporary = this.password,
                        },
                    };

                    try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                    this.flushData();
                },

                .MD5Password => |md5| {
                    debug("MD5Password", .{});
                    // Format is: md5 + md5(md5(password + username) + salt)
                    var first_hash_buf: bun.sha.MD5.Digest = undefined;
                    var first_hash_str: [32]u8 = undefined;
                    var final_hash_buf: bun.sha.MD5.Digest = undefined;
                    var final_hash_str: [32]u8 = undefined;
                    var final_password_buf: [36]u8 = undefined;

                    // First hash: md5(password + username)
                    var first_hasher = bun.sha.MD5.init();
                    first_hasher.update(this.password);
                    first_hasher.update(this.user);
                    first_hasher.final(&first_hash_buf);
                    const first_hash_str_output = std.fmt.bufPrint(&first_hash_str, "{x}", .{&first_hash_buf}) catch unreachable;

                    // Second hash: md5(first_hash + salt)
                    var final_hasher = bun.sha.MD5.init();
                    final_hasher.update(first_hash_str_output);
                    final_hasher.update(&md5.salt);
                    final_hasher.final(&final_hash_buf);
                    const final_hash_str_output = std.fmt.bufPrint(&final_hash_str, "{x}", .{&final_hash_buf}) catch unreachable;

                    // Format final password as "md5" + final_hash
                    const final_password = std.fmt.bufPrintZ(&final_password_buf, "md5{s}", .{final_hash_str_output}) catch unreachable;

                    var response = protocol.PasswordMessage{
                        .password = .{
                            .temporary = final_password,
                        },
                    };

                    this.authentication_state = .{ .md5 = {} };
                    try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                    this.flushData();
                },

                else => {
                    debug("TODO auth: {s}", .{@tagName(std.meta.activeTag(auth))});
                    this.fail("TODO: support authentication method: {s}", error.UNSUPPORTED_AUTHENTICATION_METHOD);
                },
            }
        },
        .NoData => {
            try reader.eatMessage(protocol.NoData);
            var request = this.current() orelse return error.ExpectedRequest;
            if (request.status == .binding) {
                request.status = .running;
            }
        },
        .BackendKeyData => {
            try this.backend_key_data.decodeInternal(Context, reader);
        },
        .ErrorResponse => {
            var err: protocol.ErrorResponse = undefined;
            try err.decodeInternal(Context, reader);

            if (this.status == .connecting or this.status == .sent_startup_message) {
                defer {
                    err.deinit();
                }
                this.failWithJSValue(err.toJS(this.globalObject));

                // it shouldn't enqueue any requests while connecting
                bun.assert(this.requests.count == 0);
                return;
            }

            var request = this.current() orelse {
                debug("ErrorResponse: {f}", .{err});
                return error.ExpectedRequest;
            };
            var is_error_owned = true;
            defer {
                if (is_error_owned) {
                    err.deinit();
                }
            }
            if (request.statement) |stmt| {
                if (stmt.status == PostgresSQLStatement.Status.parsing) {
                    stmt.status = PostgresSQLStatement.Status.failed;
                    stmt.error_response = .{ .protocol = err };
                    is_error_owned = false;
                    if (this.statements.remove(bun.hash(stmt.signature.name))) {
                        stmt.deref();
                    }
                }
            }

            this.finishRequest(request);
            this.updateRef();
            request.onError(.{ .protocol = err }, this.globalObject);
        },
        .PortalSuspended => {
            // try reader.eatMessage(&protocol.PortalSuspended);
            // var request = this.current() orelse return error.ExpectedRequest;
            // _ = request;
            debug("TODO PortalSuspended", .{});
        },
        .CloseComplete => {
            try reader.eatMessage(protocol.CloseComplete);
            var request = this.current() orelse return error.ExpectedRequest;
            defer this.updateRef();
            request.onResult("CLOSECOMPLETE", this.globalObject, this.js_value, false);
        },
        .CopyInResponse => {
            debug("TODO CopyInResponse", .{});
        },
        .NoticeResponse => {
            debug("UNSUPPORTED NoticeResponse", .{});
            var resp: protocol.NoticeResponse = undefined;

            try resp.decodeInternal(Context, reader);
            resp.deinit();
        },
        .EmptyQueryResponse => {
            try reader.eatMessage(protocol.EmptyQueryResponse);
            var request = this.current() orelse return error.ExpectedRequest;
            defer this.updateRef();
            request.onResult("", this.globalObject, this.js_value, false);
        },
        .CopyOutResponse => {
            debug("TODO CopyOutResponse", .{});
        },
        .CopyDone => {
            debug("TODO CopyDone", .{});
        },
        .CopyBothResponse => {
            debug("TODO CopyBothResponse", .{});
        },
        else => @compileError("Unknown message type: " ++ @tagName(MessageType)),
    }
}

pub fn updateRef(this: *PostgresSQLConnection) void {
    this.updateHasPendingActivity();
    if (this.pending_activity_count.raw > 0) {
        this.poll_ref.ref(this.vm);
    } else {
        this.poll_ref.unref(this.vm);
    }
}

pub fn getConnected(this: *PostgresSQLConnection, _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.status == Status.connected);
}

pub fn consumeOnConnectCallback(this: *const PostgresSQLConnection, globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    debug("consumeOnConnectCallback", .{});
    const on_connect = js.onconnectGetCached(this.js_value) orelse return null;
    debug("consumeOnConnectCallback exists", .{});

    js.onconnectSetCached(this.js_value, globalObject, .zero);
    return on_connect;
}

pub fn consumeOnCloseCallback(this: *const PostgresSQLConnection, globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    debug("consumeOnCloseCallback", .{});
    const on_close = js.oncloseGetCached(this.js_value) orelse return null;
    debug("consumeOnCloseCallback exists", .{});
    js.oncloseSetCached(this.js_value, globalObject, .zero);
    return on_close;
}

const PreparedStatementsMap = std.HashMapUnmanaged(u64, *PostgresSQLStatement, bun.IdentityContext(u64), 80);

const debug = bun.Output.scoped(.Postgres, .visible);

const MAX_PIPELINE_SIZE = std.math.maxInt(u16); // about 64KB per connection

pub const js = jsc.Codegen.JSPostgresSQLConnection;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

const DataCell = @import("./DataCell.zig");
const PostgresCachedStructure = @import("../shared/CachedStructure.zig");
const PostgresRequest = @import("./PostgresRequest.zig");
const PostgresSQLQuery = @import("./PostgresSQLQuery.zig");
const PostgresSQLStatement = @import("./PostgresSQLStatement.zig");
const SocketMonitor = @import("./SocketMonitor.zig");
const protocol = @import("./PostgresProtocol.zig");
const std = @import("std");
const AuthenticationState = @import("./AuthenticationState.zig").AuthenticationState;
const ConnectionFlags = @import("../shared/ConnectionFlags.zig").ConnectionFlags;
const Data = @import("../shared/Data.zig").Data;
const SSLMode = @import("./SSLMode.zig").SSLMode;
const Status = @import("./Status.zig").Status;
const TLSStatus = @import("./TLSStatus.zig").TLSStatus;

const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
const createPostgresError = @import("./AnyPostgresError.zig").createPostgresError;
const postgresErrorToJS = @import("./AnyPostgresError.zig").postgresErrorToJS;

const bun = @import("bun");
const BoringSSL = bun.BoringSSL;
const assert = bun.assert;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const AutoFlusher = jsc.WebCore.AutoFlusher;

const uws = bun.uws;
const Socket = uws.AnySocket;
