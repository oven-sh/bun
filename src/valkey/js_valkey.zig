/// Valkey client wrapper for JavaScript
pub const JSValkeyClient = struct {
    client: valkey.ValkeyClient,
    globalObject: *JSC.JSGlobalObject,
    this_value: JSC.JSRef = JSC.JSRef.empty(),
    poll_ref: bun.Async.KeepAlive = .{},
    timer: JSC.BunTimer.EventLoopTimer = .{
        .tag = .ValkeyConnectionTimeout,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },
    reconnect_timer: JSC.BunTimer.EventLoopTimer = .{
        .tag = .ValkeyConnectionReconnect,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },

    ref_count: u32 = 1,

    pub usingnamespace JSC.Codegen.JSRedisClient;
    pub usingnamespace bun.NewRefCounted(JSValkeyClient, deinit, null);

    // Factory function to create a new Valkey client from JS
    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*JSValkeyClient {
        return try create(globalObject, callframe.arguments());
    }

    pub fn create(globalObject: *JSC.JSGlobalObject, arguments: []const JSValue) bun.JSError!*JSValkeyClient {
        const vm = globalObject.bunVM();
        const url_str = if (arguments.len < 1 or arguments[0].isUndefined())
            if (vm.transpiler.env.get("REDIS_URL") orelse vm.transpiler.env.get("VALKEY_URL")) |url|
                bun.String.init(url)
            else
                bun.String.init("valkey://localhost:6379")
        else
            try arguments[0].toBunString(globalObject);
        defer url_str.deref();

        const url_utf8 = url_str.toUTF8WithoutRef(bun.default_allocator);
        defer url_utf8.deinit();
        const url = bun.URL.parse(url_utf8.slice());

        const uri: valkey.Protocol = if (url.protocol.len > 0)
            valkey.Protocol.Map.get(url.protocol) orelse return globalObject.throw("Expected url protocol to be one of redis, valkey, rediss, valkeys, redis+tls, redis+unix, redis+tls+unix", .{})
        else
            .standalone;

        var username: []const u8 = "";
        var password: []const u8 = "";
        var hostname: []const u8 = switch (uri) {
            .standalone_tls, .standalone => url.displayHostname(),
            .standalone_unix, .standalone_tls_unix => brk: {
                const unix_socket_path = bun.strings.indexOf(url_utf8.slice(), "://") orelse {
                    return globalObject.throwInvalidArguments("Expected unix socket path after valkey+unix:// or valkey+tls+unix://", .{});
                };
                const path = url_utf8.slice()[unix_socket_path + 3 ..];
                if (bun.strings.indexOfChar(path, '?')) |query_index| {
                    break :brk path[0..query_index];
                }
                if (path.len == 0) {
                    // "valkey+unix://?abc=123"
                    return globalObject.throwInvalidArguments("Expected unix socket path after valkey+unix:// or valkey+tls+unix://", .{});
                }

                break :brk path;
            },
        };

        const port = switch (uri) {
            .standalone_unix, .standalone_tls_unix => 0,
            else => url.getPort() orelse 6379,
        };

        const options = if (arguments.len >= 2 and !arguments[1].isUndefinedOrNull() and arguments[1].isObject())
            try Options.fromJS(globalObject, arguments[1])
        else
            valkey.Options{};

        var connection_strings: []u8 = &.{};
        errdefer {
            bun.default_allocator.free(connection_strings);
        }

        if (url.username.len > 0 or url.password.len > 0 or hostname.len > 0) {
            var b = bun.StringBuilder{};
            b.count(url.username);
            b.count(url.password);
            b.count(hostname);
            try b.allocate(bun.default_allocator);
            username = b.append(url.username);
            password = b.append(url.password);
            hostname = b.append(hostname);
            connection_strings = b.allocatedSlice();
        }

        const database = if (url.pathname.len > 0) std.fmt.parseInt(u32, url.pathname[1..], 10) catch 0 else 0;

        bun.analytics.Features.valkey += 1;

        return JSValkeyClient.new(.{
            .client = valkey.ValkeyClient{
                .address = switch (uri) {
                    .standalone_unix, .standalone_tls_unix => .{ .unix = hostname },
                    else => .{
                        .host = .{
                            .host = hostname,
                            .port = port,
                        },
                    },
                },
                .username = username,
                .password = password,
                .in_flight = .init(bun.default_allocator),
                .queue = .init(bun.default_allocator),
                .status = .disconnected,
                .connection_strings = connection_strings,
                .socket = .{
                    .SocketTCP = .{
                        .socket = .{
                            .detached = {},
                        },
                    },
                },
                .database = database,
                .allocator = bun.default_allocator,
                .flags = .{
                    .enable_auto_reconnect = options.enable_auto_reconnect,
                    .enable_offline_queue = options.enable_offline_queue,
                },
                .max_retries = options.max_retries,
                .connection_timeout_ms = options.connection_timeout_ms,
                .socket_timeout_ms = options.socket_timeout_ms,
                .idle_timeout_interval_ms = options.idle_timeout_ms,
            },
            .globalObject = globalObject,
            .ref_count = 1,
        });
    }

    pub fn getConnected(this: *JSValkeyClient, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.client.status == .connected);
    }

    pub fn getBufferedAmount(this: *JSValkeyClient, _: *JSC.JSGlobalObject) JSValue {
        const len =
            this.client.write_buffer.len() +
            this.client.read_buffer.len();
        return JSValue.jsNumber(len);
    }

    pub fn jsConnect(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        this.ref();
        defer this.deref();

        const this_value = callframe.this();

        // If already connected, resolve immediately
        if (this.client.status == .connected) {
            return JSC.JSPromise.resolvedPromiseValue(globalObject, JSValkeyClient.helloGetCached(this_value) orelse .undefined);
        }

        if (JSValkeyClient.connectionPromiseGetCached(this_value)) |promise| {
            return promise;
        }

        const promise_ptr = JSC.JSPromise.create(globalObject);
        const promise = promise_ptr.asValue(globalObject);
        JSValkeyClient.connectionPromiseSetCached(this_value, globalObject, promise);

        // If was manually closed, reset that flag
        this.client.flags.is_manually_closed = false;
        this.this_value.setStrong(this_value, globalObject);

        if (this.client.flags.needs_to_open_socket) {
            this.poll_ref.ref(globalObject.bunVM());

            this.connect() catch |err| {
                this.poll_ref.unref(globalObject.bunVM());
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalObject.ERR_SOCKET_CLOSED_BEFORE_CONNECTION(" {s} connecting to Valkey", .{@errorName(err)}).toJS();
                promise_ptr.reject(globalObject, err_value);
                return promise;
            };

            this.resetConnectionTimeout();
            return promise;
        }

        switch (this.client.status) {
            .disconnected => {
                this.client.flags.is_reconnecting = true;
                this.client.retry_attempts = 0;
                this.reconnect();
            },
            .failed => {
                this.client.status = .disconnected;
                this.client.flags.is_reconnecting = true;
                this.client.retry_attempts = 0;
                this.reconnect();
            },
            else => {},
        }

        return promise;
    }

    pub fn jsDisconnect(this: *JSValkeyClient, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        if (this.client.status == .disconnected) {
            return .undefined;
        }
        this.client.disconnect();
        return .undefined;
    }

    pub fn getOnConnect(_: *JSValkeyClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (JSValkeyClient.onconnectGetCached(thisValue)) |value| {
            return value;
        }
        return .undefined;
    }

    pub fn setOnConnect(_: *JSValkeyClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
        JSValkeyClient.onconnectSetCached(thisValue, globalObject, value);
        return true;
    }

    pub fn getOnClose(_: *JSValkeyClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (JSValkeyClient.oncloseGetCached(thisValue)) |value| {
            return value;
        }
        return .undefined;
    }

    pub fn setOnClose(_: *JSValkeyClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
        JSValkeyClient.oncloseSetCached(thisValue, globalObject, value);
        return true;
    }

    /// Safely add a timer with proper reference counting and event loop keepalive
    fn addTimer(this: *JSValkeyClient, timer: *JSC.BunTimer.EventLoopTimer, next_timeout_ms: u32) void {
        this.ref();
        defer this.deref();

        // If the timer is already active, we need to remove it first
        if (timer.state == .ACTIVE) {
            this.removeTimer(timer);
        }

        // Skip if timeout is zero
        if (next_timeout_ms == 0) {
            return;
        }

        // Store VM reference to use later
        const vm = this.globalObject.bunVM();

        // Set up timer and add to event loop
        timer.next = bun.timespec.msFromNow(@intCast(next_timeout_ms));
        vm.timer.insert(timer);
        this.ref();
    }

    /// Safely remove a timer with proper reference counting and event loop keepalive
    fn removeTimer(this: *JSValkeyClient, timer: *JSC.BunTimer.EventLoopTimer) void {
        if (timer.state == .ACTIVE) {

            // Store VM reference to use later
            const vm = this.globalObject.bunVM();

            // Remove the timer from the event loop
            vm.timer.remove(timer);

            // Balance the ref from addTimer
            this.deref();
        }
    }

    fn resetConnectionTimeout(this: *JSValkeyClient) void {
        const interval = this.client.getTimeoutInterval();

        // First remove existing timer if active
        if (this.timer.state == .ACTIVE) {
            this.removeTimer(&this.timer);
        }

        // Add new timer if interval is non-zero
        if (interval > 0) {
            this.addTimer(&this.timer, interval);
        }
    }

    pub fn disableConnectionTimeout(this: *JSValkeyClient) void {
        if (this.timer.state == .ACTIVE) {
            this.removeTimer(&this.timer);
        }
        this.timer.state = .CANCELLED;
    }

    pub fn onConnectionTimeout(this: *JSValkeyClient) JSC.BunTimer.EventLoopTimer.Arm {
        debug("onConnectionTimeout", .{});

        // Mark timer as fired
        this.timer.state = .FIRED;

        // Increment ref to ensure 'this' stays alive throughout the function
        this.ref();
        defer this.deref();

        if (this.client.getTimeoutInterval() == 0) {
            this.resetConnectionTimeout();
            return .disarm;
        }

        switch (this.client.status) {
            .connected => {
                debug("Idle timeout reached after {d}ms", .{this.client.idle_timeout_interval_ms});
                this.clientFail("Idle timeout reached", protocol.RedisError.ConnectionClosed);
            },
            .connecting => {
                debug("Connection timeout after {d}ms", .{this.client.connection_timeout_ms});
                this.clientFail("Connection timeout", protocol.RedisError.ConnectionClosed);
            },
            else => {
                // No timeout for other states
            },
        }

        return .disarm;
    }

    pub fn onReconnectTimer(this: *JSValkeyClient) JSC.BunTimer.EventLoopTimer.Arm {
        debug("Reconnect timer fired, attempting to reconnect", .{});

        // Mark timer as fired and store important values before doing any derefs
        this.reconnect_timer.state = .FIRED;

        // Increment ref to ensure 'this' stays alive throughout the function
        this.ref();
        defer this.deref();

        // Execute reconnection logic
        this.reconnect();

        return .disarm;
    }

    pub fn reconnect(this: *JSValkeyClient) void {
        if (!this.client.flags.is_reconnecting) {
            return;
        }

        const vm = this.globalObject.bunVM();

        if (vm.isShuttingDown()) {
            @branchHint(.unlikely);
            return;
        }

        // Ref to keep this alive during the reconnection
        this.ref();
        defer this.deref();

        this.client.status = .connecting;

        // Set retry to 0 to avoid incremental backoff from previous attempts
        this.client.retry_attempts = 0;

        // Ref the poll to keep event loop alive during connection
        this.poll_ref.disable();
        this.poll_ref = .{};
        this.poll_ref.ref(vm);

        this.connect() catch |err| {
            this.failWithJSValue(this.globalObject.ERR_SOCKET_CLOSED_BEFORE_CONNECTION("{s} reconnecting", .{@errorName(err)}).toJS());
            this.poll_ref.disable();
            return;
        };

        // Reset the socket timeout
        this.resetConnectionTimeout();
    }

    // Callback for when Valkey client connects
    pub fn onValkeyConnect(this: *JSValkeyClient, value: *protocol.RESPValue) void {
        // Safety check to ensure a valid connection state
        if (this.client.status != .connected) {
            debug("onValkeyConnect called but client status is not 'connected': {s}", .{@tagName(this.client.status)});
            return;
        }

        const globalObject = this.globalObject;
        const event_loop = globalObject.bunVM().eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        if (this.this_value.tryGet()) |this_value| {
            const hello_value = value.toJS(globalObject) catch .undefined;
            JSValkeyClient.helloSetCached(this_value, globalObject, hello_value);
            // Call onConnect callback if defined by the user
            if (JSValkeyClient.onconnectGetCached(this_value)) |on_connect| {
                const js_value = this_value;
                js_value.ensureStillAlive();
                globalObject.queueMicrotask(on_connect, &[_]JSValue{ js_value, hello_value });
            }

            if (JSValkeyClient.connectionPromiseGetCached(this_value)) |promise| {
                JSValkeyClient.connectionPromiseSetCached(this_value, globalObject, .zero);
                promise.asPromise().?.resolve(globalObject, hello_value);
            }
        }

        this.client.onWritable();
        this.updatePollRef();
    }

    // Callback for when Valkey client needs to reconnect
    pub fn onValkeyReconnect(this: *JSValkeyClient) void {
        // Schedule reconnection using our safe timer methods
        if (this.reconnect_timer.state == .ACTIVE) {
            this.removeTimer(&this.reconnect_timer);
        }

        const delay_ms = this.client.getReconnectDelay();
        if (delay_ms > 0) {
            this.addTimer(&this.reconnect_timer, delay_ms);
        }
    }

    // Callback for when Valkey client closes
    pub fn onValkeyClose(this: *JSValkeyClient) void {
        const globalObject = this.globalObject;
        this.poll_ref.disable();
        defer this.deref();

        const this_jsvalue = this.this_value.tryGet() orelse return;
        this.this_value.setWeak(this_jsvalue);
        this.ref();
        defer this.deref();

        // Create an error value
        const error_value = protocol.valkeyErrorToJS(globalObject, "Connection closed", protocol.RedisError.ConnectionClosed);

        const loop = globalObject.bunVM().eventLoop();
        loop.enter();
        defer loop.exit();

        if (this_jsvalue != .undefined) {
            if (JSValkeyClient.connectionPromiseGetCached(this_jsvalue)) |promise| {
                JSValkeyClient.connectionPromiseSetCached(this_jsvalue, globalObject, .zero);
                promise.asPromise().?.reject(globalObject, error_value);
            }
        }

        // Call onClose callback if it exists
        if (JSValkeyClient.oncloseGetCached(this_jsvalue)) |on_close| {
            _ = on_close.call(
                globalObject,
                this_jsvalue,
                &[_]JSValue{error_value},
            ) catch |e| globalObject.reportActiveExceptionAsUnhandled(e);
        }
    }

    // Callback for when Valkey client times out
    pub fn onValkeyTimeout(this: *JSValkeyClient) void {
        this.clientFail("Connection timeout", protocol.RedisError.ConnectionClosed);
    }

    pub fn clientFail(this: *JSValkeyClient, message: []const u8, err: protocol.RedisError) void {
        debug("clientFail: {s}: {s}", .{ message, @errorName(err) });
        const globalObject = this.globalObject;
        const value = protocol.valkeyErrorToJS(globalObject, message, err);
        this.failWithJSValue(value);
    }

    pub fn failWithJSValue(this: *JSValkeyClient, value: JSValue) void {
        const this_value = this.this_value.tryGet() orelse return;
        const globalObject = this.globalObject;
        if (JSValkeyClient.oncloseGetCached(this_value)) |on_close| {
            const loop = globalObject.bunVM().eventLoop();
            loop.enter();
            defer loop.exit();
            _ = on_close.call(
                globalObject,
                this_value,
                &[_]JSValue{value},
            ) catch |e| globalObject.reportActiveExceptionAsUnhandled(e);
        }
    }

    pub fn finalize(this: *JSValkeyClient) void {
        // Since this.stopTimers impacts the reference count potentially, we
        // need to ref/unref here as well.
        this.ref();
        defer this.deref();

        this.stopTimers();
        this.this_value.deinit();
        if (this.client.status == .connected or this.client.status == .connecting) {
            this.client.flags.is_manually_closed = true;
        }
        this.client.flags.finalized = true;
        this.client.close();
        this.deref();
    }

    pub fn stopTimers(this: *JSValkeyClient) void {
        // Use safe timer removal methods to ensure proper reference counting
        if (this.timer.state == .ACTIVE) {
            this.removeTimer(&this.timer);
        }
        if (this.reconnect_timer.state == .ACTIVE) {
            this.removeTimer(&this.reconnect_timer);
        }
    }

    fn connect(this: *JSValkeyClient) !void {
        this.client.flags.needs_to_open_socket = false;
        const vm = this.globalObject.bunVM();

        const ctx: *uws.SocketContext, const deinit_context: bool =
            switch (this.client.tls) {
                .none => .{
                    vm.rareData().valkey_context.tcp orelse brk_ctx: {
                        // TCP socket
                        var err: uws.create_bun_socket_error_t = .none;
                        const ctx_ = uws.us_create_bun_socket_context(0, vm.uwsLoop(), @sizeOf(*JSValkeyClient), uws.us_bun_socket_context_options_t{}, &err).?;
                        uws.NewSocketHandler(false).configure(ctx_, true, *JSValkeyClient, SocketHandler(false));
                        vm.rareData().valkey_context.tcp = ctx_;
                        break :brk_ctx ctx_;
                    },
                    false,
                },
                .enabled => .{
                    vm.rareData().valkey_context.tls orelse brk_ctx: {
                        // TLS socket, default config
                        var err: uws.create_bun_socket_error_t = .none;
                        const ctx_ = uws.us_create_bun_socket_context(1, vm.uwsLoop(), @sizeOf(*JSValkeyClient), uws.us_bun_socket_context_options_t{}, &err).?;
                        uws.NewSocketHandler(true).configure(ctx_, true, *JSValkeyClient, SocketHandler(true));
                        vm.rareData().valkey_context.tls = ctx_;
                        break :brk_ctx ctx_;
                    },
                    false,
                },
                .custom => |*custom| brk_ctx: {
                    // TLS socket, custom config
                    var err: uws.create_bun_socket_error_t = .none;
                    const options = custom.asUSockets();
                    const ctx_ = uws.us_create_bun_socket_context(1, vm.uwsLoop(), @sizeOf(*JSValkeyClient), options, &err).?;
                    uws.NewSocketHandler(true).configure(ctx_, true, *JSValkeyClient, SocketHandler(true));
                    break :brk_ctx .{ ctx_, true };
                },
            };
        this.ref();

        defer {
            if (deinit_context) {
                // This is actually unref(). uws.Context is reference counted.
                ctx.deinit(true);
            }
        }
        this.client.socket = try this.client.address.connect(&this.client, ctx, this.client.tls != .none);
    }

    fn send(this: *JSValkeyClient, globalThis: *JSC.JSGlobalObject, this_jsvalue: JSValue, command: *const Command) !*JSC.JSPromise {
        if (this.client.flags.needs_to_open_socket) {
            @branchHint(.unlikely);

            if (this.this_value != .strong)
                this.this_value.setStrong(this_jsvalue, globalThis);

            this.connect() catch |err| {
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalThis.ERR_SOCKET_CLOSED_BEFORE_CONNECTION(" {s} connecting to Valkey", .{@errorName(err)}).toJS();
                const promise = JSC.JSPromise.create(globalThis);
                promise.reject(globalThis, err_value);
                return promise;
            };
            this.resetConnectionTimeout();
        }

        defer this.updatePollRef();

        return try this.client.send(globalThis, command);
    }

    pub fn jsSend(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const command = try callframe.argument(0).toBunString(globalObject);
        defer command.deref();

        const args_array = callframe.argument(1);
        if (!args_array.isObject() or !args_array.isArray()) {
            return globalObject.throw("Arguments must be an array", .{});
        }
        var iter = args_array.arrayIterator(globalObject);
        var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, iter.len);
        defer {
            for (args.items) |*item| {
                item.deinit();
            }
            args.deinit();
        }

        while (iter.next()) |arg_js| {
            args.appendAssumeCapacity(try fromJS(globalObject, arg_js) orelse {
                return globalObject.throwInvalidArgumentType("sendCommand", "argument", "string or buffer");
            });
        }

        const cmd_str = command.toUTF8WithoutRef(bun.default_allocator);
        defer cmd_str.deinit();
        // Send command with slices directly
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = cmd_str.slice(),
                .args = .{ .args = args.items },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn get(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("get", "key", "string or buffer");
        };
        defer key.deinit();

        // Send GET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "GET",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send GET command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn set(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("set", "key", "string or buffer");
        };
        defer key.deinit();

        const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
            return globalObject.throwInvalidArgumentType("set", "value", "string or buffer");
        };
        defer value.deinit();

        // Send SET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SET",
                .args = .{ .args = &.{ key, value } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SET command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn del(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("del", "key", "string or buffer");
        };
        defer key.deinit();

        // Send DEL command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "DEL",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send DEL command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn incr(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("incr", "key", "string or buffer");
        };
        defer key.deinit();

        // Send INCR command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "INCR",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send INCR command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn decr(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("decr", "key", "string or buffer");
        };
        defer key.deinit();

        // Send DECR command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "DECR",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send DECR command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn exists(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("exists", "key", "string or buffer");
        };
        defer key.deinit();

        // Send EXISTS command with special Exists type for boolean conversion
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "EXISTS",
                .args = .{ .args = &.{key} },
                .meta = .{ .return_as_bool = true },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send EXISTS command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn expire(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("expire", "key", "string or buffer");
        };
        defer key.deinit();

        const seconds = try globalObject.validateIntegerRange(callframe.argument(1), i32, 0, .{ .min = 0, .max = 2147483647 });

        // Convert seconds to a string
        var int_buf: [64]u8 = undefined;
        const seconds_len = std.fmt.formatIntBuf(&int_buf, seconds, 10, .lower, .{});
        const seconds_slice = int_buf[0..seconds_len];

        // Send EXPIRE command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "EXPIRE",
                .args = .{ .raw = &.{ key.slice(), seconds_slice } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send EXPIRE command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn ttl(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("ttl", "key", "string or buffer");
        };
        defer key.deinit();

        // Send TTL command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "TTL",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send TTL command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement srem (remove value from a set)
    pub fn srem(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("srem", "key", "string or buffer");
        };
        defer key.deinit();
        const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
            return globalObject.throwInvalidArgumentType("srem", "value", "string or buffer");
        };
        defer value.deinit();

        // Send SREM command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SREM",
                .args = .{ .args = &.{ key, value } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SREM command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement srandmember (get random member from set)
    pub fn srandmember(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("srandmember", "key", "string or buffer");
        };
        defer key.deinit();

        // Send SRANDMEMBER command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SRANDMEMBER",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SRANDMEMBER command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement smembers (get all members of a set)
    pub fn smembers(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("smembers", "key", "string or buffer");
        };
        defer key.deinit();

        // Send SMEMBERS command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SMEMBERS",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SMEMBERS command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement spop (pop a random member from a set)
    pub fn spop(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("spop", "key", "string or buffer");
        };
        defer key.deinit();

        // Send SPOP command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SPOP",
                .args = .{ .args = &.{key} },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SPOP command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement sadd (add member to a set)
    pub fn sadd(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("sadd", "key", "string or buffer");
        };
        defer key.deinit();
        const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
            return globalObject.throwInvalidArgumentType("sadd", "value", "string or buffer");
        };
        defer value.deinit();

        // Send SADD command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SADD",
                .args = .{ .args = &.{ key, value } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SADD command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement sismember (check if value is member of a set)
    pub fn sismember(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("sismember", "key", "string or buffer");
        };
        defer key.deinit();
        const value = (try fromJS(globalObject, callframe.argument(1))) orelse {
            return globalObject.throwInvalidArgumentType("sismember", "value", "string or buffer");
        };
        defer value.deinit();

        // Send SISMEMBER command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SISMEMBER",
                .args = .{ .args = &.{ key, value } },
                .meta = .{ .return_as_bool = true },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send SISMEMBER command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hmget (get multiple values from hash)
    pub fn hmget(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = (try fromJS(globalObject, callframe.argument(0))) orelse {
            return globalObject.throwInvalidArgumentType("hmget", "key", "string or buffer");
        };
        defer key.deinit();

        // Get field array argument
        const fields_array = callframe.argument(1);
        if (!fields_array.isObject() or !fields_array.isArray()) {
            return globalObject.throw("Fields must be an array", .{});
        }

        var iter = fields_array.arrayIterator(globalObject);
        var args = try std.ArrayList(JSC.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
        defer {
            for (args.items) |item| {
                item.deinit();
            }
            args.deinit();
        }

        args.appendAssumeCapacity(JSC.ZigString.Slice.fromUTF8NeverFree(key.slice()));

        // Add field names as arguments
        while (iter.next()) |field_js| {
            const field_str = try field_js.toBunString(globalObject);
            defer field_str.deref();

            const field_slice = field_str.toUTF8WithoutRef(bun.default_allocator);
            args.appendAssumeCapacity(field_slice);
        }

        // Send HMGET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "HMGET",
                .args = .{ .slices = args.items },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send HMGET command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hincrby (increment hash field by integer value)
    pub fn hincrby(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const field = try callframe.argument(1).toBunString(globalObject);
        defer field.deref();
        const value = try callframe.argument(2).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const field_slice = field.toUTF8WithoutRef(bun.default_allocator);
        defer field_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send HINCRBY command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "HINCRBY",
                .args = .{ .slices = &.{ key_slice, field_slice, value_slice } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send HINCRBY command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hincrbyfloat (increment hash field by float value)
    pub fn hincrbyfloat(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const field = try callframe.argument(1).toBunString(globalObject);
        defer field.deref();
        const value = try callframe.argument(2).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const field_slice = field.toUTF8WithoutRef(bun.default_allocator);
        defer field_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send HINCRBYFLOAT command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "HINCRBYFLOAT",
                .args = .{ .slices = &.{ key_slice, field_slice, value_slice } },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send HINCRBYFLOAT command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hmset (set multiple values in hash)
    pub fn hmset(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        // For simplicity, let's accept a list of alternating keys and values
        const array_arg = callframe.argument(1);
        if (!array_arg.isObject() or !array_arg.isArray()) {
            return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
        }

        var iter = array_arg.arrayIterator(globalObject);
        if (iter.len % 2 != 0) {
            return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
        }

        var args = try std.ArrayList(JSC.ZigString.Slice).initCapacity(bun.default_allocator, iter.len + 1);
        defer {
            for (args.items) |item| {
                item.deinit();
            }
            args.deinit();
        }

        // Add key as first argument
        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        args.appendAssumeCapacity(key_slice);

        // Add field-value pairs
        while (iter.next()) |field_js| {
            // Add field name
            const field_str = try field_js.toBunString(globalObject);
            defer field_str.deref();
            const field_slice = field_str.toUTF8WithoutRef(bun.default_allocator);
            args.appendAssumeCapacity(field_slice);

            // Add value
            if (iter.next()) |value_js| {
                const value_str = try value_js.toBunString(globalObject);
                defer value_str.deref();
                const value_slice = value_str.toUTF8WithoutRef(bun.default_allocator);
                args.appendAssumeCapacity(value_slice);
            } else {
                return globalObject.throw("Arguments must be an array of alternating field names and values", .{});
            }
        }

        // Send HMSET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "HMSET",
                .args = .{ .slices = args.items },
            },
        ) catch |err| {
            return protocol.valkeyErrorToJS(globalObject, "Failed to send HMSET command", err);
        };
        return promise.asValue(globalObject);
    }

    // Getter for memory cost - useful for diagnostics
    pub fn memoryCost(this: *JSValkeyClient) usize {
        var memory_cost: usize = @sizeOf(JSValkeyClient);

        // Add size of all internal buffers
        memory_cost += this.client.write_buffer.byte_list.cap;
        memory_cost += this.client.read_buffer.byte_list.cap;

        // Add queue sizes
        memory_cost += this.client.in_flight.count * @sizeOf(valkey.Command.PromisePair);
        for (this.client.queue.readableSlice(0)) |*command| {
            memory_cost += command.serialized_data.len;
        }
        memory_cost += this.client.queue.count * @sizeOf(valkey.Command.Entry);
        return memory_cost;
    }

    pub fn deinit(this: *JSValkeyClient) void {
        bun.debugAssert(this.client.socket.isClosed());

        this.client.deinit(null);
        this.poll_ref.disable();
        this.stopTimers();
        this.this_value.deinit();
        bun.debugAssert(this.ref_count == 0);
        this.destroy();
    }

    /// Keep the event loop alive, or don't keep it alive
    pub fn updatePollRef(this: *JSValkeyClient) void {
        if (!this.client.hasAnyPendingCommands() and this.client.status == .connected) {
            this.poll_ref.unref(this.globalObject.bunVM());
            // If we don't have any pending commands and we're connected, we don't need to keep the object alive.
            if (this.this_value.tryGet()) |value| {
                this.this_value.setWeak(value);
            }
        } else if (this.client.hasAnyPendingCommands()) {
            this.poll_ref.ref(this.globalObject.bunVM());
            // If we have pending commands, we need to keep the object alive.
            if (this.this_value == .weak) {
                this.this_value.upgrade(this.globalObject);
            }
        }
    }

    // Socket handler for the uWebSockets library
    fn SocketHandler(comptime ssl: bool) type {
        return struct {
            const SocketType = uws.NewSocketHandler(ssl);
            fn _socket(s: SocketType) Socket {
                if (comptime ssl) {
                    return Socket{ .SocketTLS = s };
                }

                return Socket{ .SocketTCP = s };
            }
            pub fn onOpen(this: *JSValkeyClient, socket: SocketType) void {
                this.client.socket = _socket(socket);
                this.client.onOpen(_socket(socket));
            }

            fn onHandshake_(this: *JSValkeyClient, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
                debug("onHandshake: {d} {d}", .{ success, ssl_error.error_no });
                const handshake_success = if (success == 1) true else false;
                this.ref();
                defer this.deref();
                if (handshake_success) {
                    const vm = this.globalObject.bunVM();
                    if (this.client.tls.rejectUnauthorized(vm)) {
                        if (ssl_error.error_no != 0) {
                            // only reject the connection if reject_unauthorized == true

                            const ssl_ptr: *BoringSSL.c.SSL = @ptrCast(this.client.socket.getNativeHandle());
                            if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                                const hostname = servername[0..bun.len(servername)];
                                if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                                    this.client.flags.is_authenticated = false;
                                    const loop = vm.eventLoop();
                                    loop.enter();
                                    defer loop.exit();
                                    this.client.status = .failed;
                                    this.client.flags.is_manually_closed = true;
                                    this.client.failWithJSValue(this.globalObject, ssl_error.toJS(this.globalObject));
                                    this.client.close();
                                }
                            }
                        }
                    }
                }
            }

            pub const onHandshake = if (ssl) onHandshake_ else null;

            pub fn onClose(this: *JSValkeyClient, _: SocketType, _: i32, _: ?*anyopaque) void {
                // Ensure the socket pointer is updated.
                this.client.socket = .{ .SocketTCP = .detached };

                this.client.onClose();
            }

            pub fn onEnd(this: *JSValkeyClient, socket: SocketType) void {
                // Ensure the socket pointer is updated before closing
                this.client.socket = _socket(socket);

                // Do not allow half-open connections
                socket.close(.normal);
            }

            pub fn onConnectError(this: *JSValkeyClient, _: SocketType, _: i32) void {
                // Ensure the socket pointer is updated.
                this.client.socket = .{ .SocketTCP = .detached };

                this.client.onClose();
            }

            pub fn onTimeout(this: *JSValkeyClient, socket: SocketType) void {
                this.client.socket = _socket(socket);
                // Handle socket timeout
            }

            pub fn onData(this: *JSValkeyClient, socket: SocketType, data: []const u8) void {
                // Ensure the socket pointer is updated.
                this.client.socket = _socket(socket);

                this.ref();
                defer this.deref();
                this.client.onData(data);
                this.updatePollRef();
            }

            pub fn onWritable(this: *JSValkeyClient, socket: SocketType) void {
                this.client.socket = _socket(socket);
                this.ref();
                defer this.deref();
                this.client.onWritable();
                this.updatePollRef();
            }
        };
    }
};

// Parse JavaScript options into Valkey client options
const Options = struct {
    pub fn fromJS(globalObject: *JSC.JSGlobalObject, options_obj: JSC.JSValue) !valkey.Options {
        var this = valkey.Options{};
        if (try options_obj.getIfPropertyExists(globalObject, "idleTimeout")) |idle_timeout| {
            this.idle_timeout_ms = try globalObject.validateIntegerRange(idle_timeout, u32, 0, .{ .min = 0, .max = std.math.maxInt(u32) });
        }

        if (try options_obj.getIfPropertyExists(globalObject, "connectionTimeout")) |connection_timeout| {
            this.connection_timeout_ms = try globalObject.validateIntegerRange(connection_timeout, u32, 0, .{ .min = 0, .max = std.math.maxInt(u32) });
        }

        if (try options_obj.getIfPropertyExists(globalObject, "socketTimeout")) |socket_timeout| {
            this.socket_timeout_ms = try globalObject.validateIntegerRange(socket_timeout, u32, 0, .{ .min = 0, .max = std.math.maxInt(u32) });
        }

        if (try options_obj.getIfPropertyExists(globalObject, "autoReconnect")) |auto_reconnect| {
            this.enable_auto_reconnect = auto_reconnect.toBoolean();
        }

        if (try options_obj.getIfPropertyExists(globalObject, "maxRetries")) |max_retries| {
            this.max_retries = try globalObject.validateIntegerRange(max_retries, u32, 0, .{ .min = 0, .max = std.math.maxInt(u32) });
        }

        if (try options_obj.getIfPropertyExists(globalObject, "enableOfflineQueue")) |enable_offline_queue| {
            this.enable_offline_queue = enable_offline_queue.toBoolean();
        }

        if (try options_obj.getIfPropertyExists(globalObject, "tls")) |tls| {
            if (tls.isBoolean() or tls.isUndefinedOrNull()) {
                this.tls = if (tls.toBoolean()) .enabled else .none;
            } else if (tls.isObject()) {
                if (try JSC.API.ServerConfig.SSLConfig.fromJS(globalObject.bunVM(), globalObject, tls)) |ssl_config| {
                    this.tls = .{ .custom = ssl_config };
                } else {
                    return globalObject.throwInvalidArgumentType("tls", "tls", "object");
                }
            } else {
                return globalObject.throwInvalidArgumentType("tls", "tls", "boolean or object");
            }
        }

        return this;
    }
};

const std = @import("std");
const bun = @import("root").bun;
const valkey = @import("valkey.zig");
const protocol = @import("valkey_protocol.zig");
const JSC = bun.JSC;
const String = bun.String;
const debug = bun.Output.scoped(.RedisJS, false);
const uws = bun.uws;

const JSValue = JSC.JSValue;
const Socket = uws.AnySocket;
const RedisError = protocol.RedisError;
const Command = @import("ValkeyCommand.zig");
const BoringSSL = bun.BoringSSL;
const JSArgument = JSC.Node.BlobOrStringOrBuffer;
fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue) !?JSArgument {
    if (value == .undefined or value == .null) {
        return null;
    }

    if (value.isNumber()) {
        // Allow numbers to be passed as strings.
        const str = value.toString(globalObject);
        if (globalObject.hasException()) {
            @branchHint(.unlikely);
            return error.JSError;
        }

        return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, str.toJS(), true);
    }

    return try JSArgument.fromJSMaybeFile(globalObject, bun.default_allocator, value, false);
}
