const JSMySQLConnection = @This();
__ref_count: RefCount = RefCount.init(),
#js_value: jsc.JSRef = jsc.JSRef.empty(),
#globalObject: *jsc.JSGlobalObject,
#vm: *jsc.VirtualMachine,
#poll_ref: bun.Async.KeepAlive = .{},

#connection: MySQLConnection,

auto_flusher: AutoFlusher = .{},

idle_timeout_interval_ms: u32 = 0,
connection_timeout_ms: u32 = 0,
/// Before being connected, this is a connection timeout timer.
/// After being connected, this is an idle timeout timer.
timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .MySQLConnectionTimeout,
    .next = .epoch,
},

/// This timer controls the maximum lifetime of a connection.
/// It starts when the connection successfully starts (i.e. after handshake is complete).
/// It stops when the connection is closed.
max_lifetime_interval_ms: u32 = 0,
max_lifetime_timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .MySQLConnectionMaxLifetime,
    .next = .epoch,
},

pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub fn onAutoFlush(this: *@This()) bool {
    debug("onAutoFlush", .{});
    if (this.#connection.hasBackpressure()) {
        this.auto_flusher.registered = false;
        // if we have backpressure, wait for onWritable
        return false;
    }

    // drain as much as we can
    this.drainInternal();

    // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
    const keep_flusher_registered = this.#connection.canFlush();
    this.auto_flusher.registered = keep_flusher_registered;
    return keep_flusher_registered;
}

fn registerAutoFlusher(this: *@This()) void {
    if (!this.auto_flusher.registered and // should not be registered

        this.#connection.canFlush())
    {
        AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, this.#vm);
        this.auto_flusher.registered = true;
    }
}

fn unregisterAutoFlusher(this: *@This()) void {
    if (this.auto_flusher.registered) {
        AutoFlusher.unregisterDeferredMicrotaskWithType(@This(), this, this.#vm);
        this.auto_flusher.registered = false;
    }
}

fn stopTimers(this: *@This()) void {
    debug("stopTimers", .{});
    if (this.timer.state == .ACTIVE) {
        this.#vm.timer.remove(&this.timer);
    }
    if (this.max_lifetime_timer.state == .ACTIVE) {
        this.#vm.timer.remove(&this.max_lifetime_timer);
    }
}
fn getTimeoutInterval(this: *@This()) u32 {
    return switch (this.#connection.status) {
        .connected => {
            if (this.#connection.isIdle()) {
                return this.idle_timeout_interval_ms;
            }
            return 0;
        },
        .failed => 0,
        else => {
            return this.connection_timeout_ms;
        },
    };
}
pub fn resetConnectionTimeout(this: *@This()) void {
    const interval = this.getTimeoutInterval();
    debug("resetConnectionTimeout {d}", .{interval});
    if (this.timer.state == .ACTIVE) {
        this.#vm.timer.remove(&this.timer);
    }
    if (this.#connection.status == .failed or
        this.#connection.isProcessingData() or
        interval == 0) return;

    this.timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(interval));
    this.#vm.timer.insert(&this.timer);
}

pub fn onConnectionTimeout(this: *@This()) void {
    this.timer.state = .FIRED;

    if (this.#connection.isProcessingData()) {
        return;
    }

    if (this.#connection.status == .failed) return;

    if (this.getTimeoutInterval() == 0) {
        this.resetConnectionTimeout();
        return;
    }

    switch (this.#connection.status) {
        .connected => {
            this.failFmt(error.IdleTimeout, "Idle timeout reached after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.idle_timeout_interval_ms) *| std.time.ns_per_ms)});
        },
        .connecting => {
            this.failFmt(error.ConnectionTimedOut, "Connection timeout after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.connection_timeout_ms) *| std.time.ns_per_ms)});
        },
        .handshaking,
        .authenticating,
        .authentication_awaiting_pk,
        => {
            this.failFmt(error.ConnectionTimedOut, "Connection timeout after {f} (during authentication)", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.connection_timeout_ms) *| std.time.ns_per_ms)});
        },
        .disconnected, .failed => {},
    }
}

pub fn onMaxLifetimeTimeout(this: *@This()) void {
    this.max_lifetime_timer.state = .FIRED;
    if (this.#connection.status == .failed) return;
    this.failFmt(error.LifetimeTimeout, "Max lifetime timeout reached after {f}", .{bun.fmt.fmtDurationOneDecimal(@as(u64, this.max_lifetime_interval_ms) *| std.time.ns_per_ms)});
}
fn setupMaxLifetimeTimerIfNecessary(this: *@This()) void {
    if (this.max_lifetime_interval_ms == 0) return;
    if (this.max_lifetime_timer.state == .ACTIVE) return;

    this.max_lifetime_timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(this.max_lifetime_interval_ms));
    this.#vm.timer.insert(&this.max_lifetime_timer);
}
pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*@This() {
    _ = callframe;

    return globalObject.throw("MySQLConnection cannot be constructed directly", .{});
}

pub fn enqueueRequest(this: *@This(), item: *JSMySQLQuery) void {
    debug("enqueueRequest", .{});
    this.#connection.enqueueRequest(item);
    this.resetConnectionTimeout();
    this.registerAutoFlusher();
}

pub fn close(this: *@This()) void {
    this.ref();
    this.stopTimers();
    this.unregisterAutoFlusher();
    defer {
        this.updateReferenceType();
        this.deref();
    }
    if (this.#vm.isShuttingDown()) {
        this.#connection.close();
    } else {
        this.#connection.cleanQueueAndClose(null, this.getQueriesArray());
    }
}

fn drainInternal(this: *@This()) void {
    debug("drainInternal", .{});
    if (this.#vm.isShuttingDown()) return this.close();
    this.ref();
    defer this.deref();
    const event_loop = this.#vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();
    this.ensureJSValueIsAlive();
    this.#connection.flushQueue() catch |err| {
        bun.assert_eql(err, error.AuthenticationFailed);
        this.fail("Authentication failed", err);
        return;
    };
}
pub fn deinit(this: *@This()) void {
    this.stopTimers();
    this.#poll_ref.unref(this.#vm);
    this.unregisterAutoFlusher();

    this.#connection.cleanup();
    bun.destroy(this);
}

fn ensureJSValueIsAlive(this: *@This()) void {
    if (this.#js_value.tryGet()) |value| {
        value.ensureStillAlive();
    }
}
pub fn finalize(this: *@This()) void {
    debug("finalize", .{});
    this.#js_value.finalize();
    this.deref();
}

fn SocketHandler(comptime ssl: bool) type {
    return struct {
        const SocketType = uws.NewSocketHandler(ssl);
        fn _socket(s: SocketType) uws.AnySocket {
            if (comptime ssl) {
                return uws.AnySocket{ .SocketTLS = s };
            }

            return uws.AnySocket{ .SocketTCP = s };
        }
        pub fn onOpen(this: *JSMySQLConnection, s: SocketType) void {
            const socket = _socket(s);
            this.#connection.setSocket(socket);

            if (socket == .SocketTCP) {
                // This handshake is not TLS handleshake is actually the MySQL handshake
                // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
                this.#connection.status = .handshaking;
                this.ref(); // keep a ref for the socket
            }
            // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
            this.setupMaxLifetimeTimerIfNecessary();
            this.resetConnectionTimeout();
            this.updateReferenceType();
        }

        fn onHandshake_(
            this: *JSMySQLConnection,
            _: anytype,
            success: i32,
            ssl_error: uws.us_bun_verify_error_t,
        ) void {
            const handshakeWasSuccessful = this.#connection.doHandshake(success, ssl_error) catch |err| return this.failFmt(err, "Failed to send handshake response", .{});
            if (!handshakeWasSuccessful) {
                this.failWithJSValue(ssl_error.toJS(this.#globalObject) catch return);
            }
        }

        pub const onHandshake = if (ssl) onHandshake_ else null;

        pub fn onClose(this: *JSMySQLConnection, _: SocketType, _: i32, _: ?*anyopaque) void {
            defer this.deref();
            this.fail("Connection closed", error.ConnectionClosed);
        }

        pub fn onEnd(_: *JSMySQLConnection, socket: SocketType) void {
            // no half closed sockets
            socket.close(.normal);
        }

        pub fn onConnectError(this: *JSMySQLConnection, _: SocketType, _: i32) void {
            // TODO: proper propagation of the error
            this.fail("Connection closed", error.ConnectionClosed);
        }

        pub fn onTimeout(this: *JSMySQLConnection, _: SocketType) void {
            this.fail("Connection timeout", error.ConnectionTimedOut);
        }

        pub fn onData(this: *JSMySQLConnection, _: SocketType, data: []const u8) void {
            this.ref();
            defer this.deref();
            const vm = this.#vm;

            defer {
                // reset the connection timeout after we're done processing the data
                this.resetConnectionTimeout();
                this.updateReferenceType();
                this.registerAutoFlusher();
            }
            if (this.#vm.isShuttingDown()) {
                // we are shutting down lets not process the data
                return;
            }

            const event_loop = vm.eventLoop();
            event_loop.enter();
            defer event_loop.exit();
            this.ensureJSValueIsAlive();

            this.#connection.readAndProcessData(data) catch |err| {
                this.onError(null, err);
            };
        }

        pub fn onWritable(this: *JSMySQLConnection, _: SocketType) void {
            this.#connection.resetBackpressure();
            this.drainInternal();
        }
    };
}

fn updateReferenceType(this: *@This()) void {
    if (this.#connection.isActive()) {
        debug("connection is active", .{});
        if (this.#js_value.isNotEmpty() and this.#js_value == .weak) {
            debug("strong ref until connection is closed", .{});
            this.#js_value.upgrade(this.#globalObject);
        }
        if (this.#connection.status == .connected and this.#connection.isIdle()) {
            this.#poll_ref.unref(this.#vm);
        } else {
            this.#poll_ref.ref(this.#vm);
        }
        return;
    }
    if (this.#js_value.isNotEmpty() and this.#js_value == .strong) {
        this.#js_value.downgrade();
    }
    this.#poll_ref.unref(this.#vm);
}

pub fn createInstance(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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

        // We always request the cert so we can verify it and also we manually abort the connection if the hostname doesn't match.
        // We create it right here so we can throw errors early.
        const context_options = tls_config.asUSocketsForClientVerification();
        var err: uws.create_bun_socket_error_t = .none;
        tls_ctx = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*@This()), context_options, &err) orelse {
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
    const idle_timeout = arguments[11].toInt32();
    const connection_timeout = arguments[12].toInt32();
    const max_lifetime = arguments[13].toInt32();
    const use_unnamed_prepared_statements = arguments[14].asBoolean();
    // MySQL doesn't support unnamed prepared statements
    _ = use_unnamed_prepared_statements;

    var ptr = bun.new(JSMySQLConnection, .{
        .#globalObject = globalObject,
        .#vm = vm,
        .idle_timeout_interval_ms = @intCast(idle_timeout),
        .connection_timeout_ms = @intCast(connection_timeout),
        .max_lifetime_interval_ms = @intCast(max_lifetime),
        .#connection = MySQLConnection.init(
            database,
            username,
            password,
            options,
            options_buf,
            tls_config,
            tls_ctx,
            ssl_mode,
        ),
    });

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
            ptr.#connection.setSocket(.{
                .SocketTCP = uws.SocketTCP.connectUnixAnon(path, ctx, ptr, false) catch |err| {
                    ptr.deref();
                    return globalObject.throwError(err, "failed to connect to postgresql");
                },
            });
        } else {
            ptr.#connection.setSocket(.{
                .SocketTCP = uws.SocketTCP.connectAnon(hostname.slice(), port, ctx, ptr, false) catch |err| {
                    ptr.deref();
                    return globalObject.throwError(err, "failed to connect to mysql");
                },
            });
        }
    }
    ptr.#connection.status = .connecting;
    ptr.resetConnectionTimeout();
    ptr.#poll_ref.ref(vm);
    const js_value = ptr.toJS(globalObject);
    js_value.ensureStillAlive();
    ptr.#js_value.setStrong(js_value, globalObject);
    js.onconnectSetCached(js_value, globalObject, on_connect);
    js.oncloseSetCached(js_value, globalObject, on_close);

    return js_value;
}

pub fn getQueries(_: *@This(), thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    if (js.queriesGetCached(thisValue)) |value| {
        return value;
    }

    const array = try jsc.JSValue.createEmptyArray(globalObject, 0);
    js.queriesSetCached(thisValue, globalObject, array);

    return array;
}

pub fn getConnected(this: *@This(), _: *jsc.JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.#connection.status == .connected);
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

pub fn doRef(this: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.#poll_ref.ref(this.#vm);
    return .js_undefined;
}

pub fn doUnref(this: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.#poll_ref.unref(this.#vm);
    return .js_undefined;
}

pub fn doFlush(this: *@This(), _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.registerAutoFlusher();
    return .js_undefined;
}

pub fn doClose(this: *@This(), globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    _ = globalObject;
    this.stopTimers();

    defer this.updateReferenceType();
    this.#connection.cleanQueueAndClose(null, this.getQueriesArray());
    return .js_undefined;
}

fn consumeOnConnectCallback(this: *const @This(), globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    if (this.#vm.isShuttingDown()) return null;
    if (this.#js_value.tryGet()) |value| {
        const on_connect = js.onconnectGetCached(value) orelse return null;
        js.onconnectSetCached(value, globalObject, .zero);
        return on_connect;
    }
    return null;
}

fn consumeOnCloseCallback(this: *const @This(), globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    if (this.#vm.isShuttingDown()) return null;
    if (this.#js_value.tryGet()) |value| {
        const on_close = js.oncloseGetCached(value) orelse return null;
        js.oncloseSetCached(value, globalObject, .zero);
        return on_close;
    }
    return null;
}

pub fn getQueriesArray(this: *@This()) JSValue {
    if (this.#vm.isShuttingDown()) return .js_undefined;
    if (this.#js_value.tryGet()) |value| {
        return js.queriesGetCached(value) orelse .js_undefined;
    }

    return .js_undefined;
}

pub inline fn isAbleToWrite(this: *const @This()) bool {
    return this.#connection.isAbleToWrite();
}
pub inline fn isConnected(this: *const @This()) bool {
    return this.#connection.status == .connected;
}
pub inline fn canPipeline(this: *@This()) bool {
    return this.#connection.canPipeline();
}
pub inline fn canPrepareQuery(this: *@This()) bool {
    return this.#connection.canPrepareQuery();
}
pub inline fn canExecuteQuery(this: *@This()) bool {
    return this.#connection.canExecuteQuery();
}
pub inline fn getWriter(this: *@This()) NewWriter(MySQLConnection.Writer) {
    return this.#connection.writer();
}
fn failFmt(this: *@This(), error_code: AnyMySQLError.Error, comptime fmt: [:0]const u8, args: anytype) void {
    const message = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, fmt, args));
    defer bun.default_allocator.free(message);

    const err = AnyMySQLError.mysqlErrorToJS(this.#globalObject, message, error_code);
    this.failWithJSValue(err);
}

fn failWithJSValue(this: *@This(), value: JSValue) void {
    this.ref();

    defer {
        if (this.#vm.isShuttingDown()) {
            this.#connection.close();
        } else {
            this.#connection.cleanQueueAndClose(value, this.getQueriesArray());
        }
        this.updateReferenceType();
        this.deref();
    }
    this.stopTimers();

    if (this.#connection.status == .failed) return;

    this.#connection.status = .failed;
    if (this.#vm.isShuttingDown()) return;

    const on_close = this.consumeOnCloseCallback(this.#globalObject) orelse return;
    on_close.ensureStillAlive();
    const loop = this.#vm.eventLoop();
    // loop.enter();
    // defer loop.exit();
    this.ensureJSValueIsAlive();
    var js_error = value.toError() orelse value;
    if (js_error == .zero) {
        js_error = AnyMySQLError.mysqlErrorToJS(this.#globalObject, "Connection closed", error.ConnectionClosed);
    }
    js_error.ensureStillAlive();

    const queries_array = this.getQueriesArray();
    queries_array.ensureStillAlive();
    // this.#globalObject.queueMicrotask(on_close, &[_]JSValue{ js_error, queries_array });
    loop.runCallback(on_close, this.#globalObject, .js_undefined, &[_]JSValue{ js_error, queries_array });
}

fn fail(this: *@This(), message: []const u8, err: AnyMySQLError.Error) void {
    const instance = AnyMySQLError.mysqlErrorToJS(this.#globalObject, message, err);
    this.failWithJSValue(instance);
}
pub fn onConnectionEstabilished(this: *@This()) void {
    if (this.#vm.isShuttingDown()) return;
    const on_connect = this.consumeOnConnectCallback(this.#globalObject) orelse return;
    on_connect.ensureStillAlive();
    var js_value = this.#js_value.tryGet() orelse .js_undefined;
    js_value.ensureStillAlive();
    this.#globalObject.queueMicrotask(on_connect, &[_]JSValue{ JSValue.jsNull(), js_value });
}
pub fn onQueryResult(this: *@This(), request: *JSMySQLQuery, result: MySQLQueryResult) void {
    request.resolve(this.getQueriesArray(), result);
}
pub fn onResultRow(this: *@This(), request: *JSMySQLQuery, statement: *MySQLStatement, Context: type, reader: NewReader(Context)) (error{ ShortRead, JSError })!void {
    const result_mode = request.getResultMode();
    var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
    const allocator = stack_fallback.get();
    var row = ResultSet.Row{
        .globalObject = this.#globalObject,
        .columns = statement.columns,
        .binary = !request.isSimple(),
        .raw = result_mode == .raw,
        .bigint = request.isBigintSupported(),
    };
    var structure: JSValue = .js_undefined;
    var cached_structure: ?CachedStructure = null;
    switch (result_mode) {
        .objects => {
            cached_structure = if (this.#js_value.tryGet()) |value| statement.structure(value, this.#globalObject) else null;
            structure = cached_structure.?.jsValue() orelse .js_undefined;
        },
        .raw, .values => {
            // no need to check for duplicate fields or structure
        },
    }
    defer row.deinit(allocator);
    row.decode(allocator, reader) catch |err| {
        if (err == error.ShortRead) {
            return error.ShortRead;
        }
        this.#connection.queue.markCurrentRequestAsFinished(request);
        request.reject(this.getQueriesArray(), err);
        return;
    };
    const pending_value = request.getPendingValue() orelse .js_undefined;
    // Process row data
    const row_value = try row.toJS(
        this.#globalObject,
        pending_value,
        structure,
        statement.fields_flags,
        result_mode,
        cached_structure,
    );
    if (this.#globalObject.tryTakeException()) |err| {
        this.#connection.queue.markCurrentRequestAsFinished(request);
        request.rejectWithJSValue(this.getQueriesArray(), err);
        return;
    }
    statement.result_count += 1;

    if (pending_value.isEmptyOrUndefinedOrNull()) {
        request.setPendingValue(row_value);
    }
}
pub fn onError(this: *@This(), request: ?*JSMySQLQuery, err: AnyMySQLError.Error) void {
    if (request) |_request| {
        if (this.#vm.isShuttingDown()) {
            _request.markAsFailed();
            return;
        }
        if (this.#globalObject.tryTakeException()) |err_| {
            _request.rejectWithJSValue(this.getQueriesArray(), err_);
        } else {
            _request.reject(this.getQueriesArray(), err);
        }
    } else {
        if (this.#vm.isShuttingDown()) {
            this.close();
            return;
        }
        if (this.#globalObject.tryTakeException()) |err_| {
            this.failWithJSValue(err_);
        } else {
            this.fail("Connection closed", err);
        }
    }
}
pub fn onErrorPacket(
    this: *@This(),
    request: ?*JSMySQLQuery,
    err: ErrorPacket,
) void {
    if (request) |_request| {
        if (this.#vm.isShuttingDown()) {
            _request.markAsFailed();
        } else {
            if (this.#globalObject.tryTakeException()) |err_| {
                _request.rejectWithJSValue(this.getQueriesArray(), err_);
            } else {
                _request.rejectWithJSValue(this.getQueriesArray(), err.toJS(this.#globalObject));
            }
        }
    } else {
        if (this.#vm.isShuttingDown()) {
            this.close();
            return;
        }
        if (this.#globalObject.tryTakeException()) |err_| {
            this.failWithJSValue(err_);
        } else {
            this.failWithJSValue(err.toJS(this.#globalObject));
        }
    }
}

pub fn getStatementFromSignatureHash(this: *@This(), signature_hash: u64) !MySQLConnection.PreparedStatementsMapGetOrPutResult {
    return try this.#connection.statements.getOrPut(bun.default_allocator, signature_hash);
}

const RefCount = bun.ptr.RefCount(@This(), "__ref_count", deinit, .{});
pub const js = jsc.Codegen.JSMySQLConnection;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;
pub const toJS = js.toJS;

pub const Writer = MySQLConnection.Writer;

const debug = bun.Output.scoped(.MySQLConnection, .visible);

const AnyMySQLError = @import("../protocol/AnyMySQLError.zig");
const CachedStructure = @import("../../shared/CachedStructure.zig");
const ErrorPacket = @import("../protocol/ErrorPacket.zig");
const JSMySQLQuery = @import("./JSMySQLQuery.zig");
const MySQLConnection = @import("../MySQLConnection.zig");
const MySQLQueryResult = @import("../MySQLQueryResult.zig");
const MySQLStatement = @import("../MySQLStatement.zig");
const ResultSet = @import("../protocol/ResultSet.zig");
const std = @import("std");
const NewReader = @import("../protocol/NewReader.zig").NewReader;
const NewWriter = @import("../protocol/NewWriter.zig").NewWriter;
const SSLMode = @import("../SSLMode.zig").SSLMode;

const bun = @import("bun");
const uws = bun.uws;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const AutoFlusher = jsc.WebCore.AutoFlusher;
