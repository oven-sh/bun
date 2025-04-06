const std = @import("std");
const bun = @import("root").bun;
const redis = @import("redis.zig");
const protocol = @import("redis_protocol.zig");
const JSC = bun.JSC;
const String = bun.String;
const debug = bun.Output.scoped(.RedisJS, false);
const uws = bun.uws;

const JSValue = JSC.JSValue;
const Socket = uws.AnySocket;
const RedisError = protocol.RedisError;
const Command = @import("RedisCommand.zig");
/// Redis client wrapper for JavaScript
pub const JSRedisClient = struct {
    client: redis.RedisClient,
    globalObject: *JSC.JSGlobalObject,
    this_value: JSC.JSRef = JSC.JSRef.empty(),
    poll_ref: bun.Async.KeepAlive = .{},
    timer: JSC.BunTimer.EventLoopTimer = .{
        .tag = .RedisConnectionTimeout,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },
    reconnect_timer: JSC.BunTimer.EventLoopTimer = .{
        .tag = .RedisConnectionReconnect,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },

    ref_count: u32 = 1,

    pub usingnamespace JSC.Codegen.JSValkeyClient;
    pub usingnamespace bun.NewRefCounted(JSRedisClient, deinit, null);

    // Factory function to create a new Redis client from JS
    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*JSRedisClient {
        const arguments = callframe.arguments();
        const vm = globalObject.bunVM();
        const url_str = if (arguments.len < 1 or arguments[0].isUndefined())
            if (vm.transpiler.env.get("REDIS_URL")) |url|
                bun.String.init(url)
            else
                bun.String.init("redis://localhost:6379")
        else
            try arguments[0].toBunString(globalObject);
        defer url_str.deref();

        const url_utf8 = url_str.toUTF8WithoutRef(bun.default_allocator);
        defer url_utf8.deinit();
        const url = bun.URL.parse(url_utf8.slice());

        const port = url.getPort() orelse 6379;
        const uri = if (url.protocol.len > 0)
            redis.Protocol.Map.get(url.protocol) orelse return globalObject.throw("Expected url protocol to be one of redis, rediss, redis+tls, redis+unix, redis+tls+unix", .{})
        else
            .standalone;

        if (uri.isUnix() or uri.isTLS()) {
            return globalObject.throwTODO("Unix and TLS connections are not supported yet");
        }

        const options = if (arguments.len >= 2 and !arguments[1].isUndefinedOrNull() and arguments[1].isObject())
            try Options.fromJS(globalObject, arguments[1])
        else
            redis.Options{};

        var username: []const u8 = "";
        var password: []const u8 = "";
        var hostname: []const u8 = url.displayHostname();
        var connection_strings: []u8 = &.{};

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

        bun.analytics.Features.redis_connections += 1;

        return JSRedisClient.new(.{
            .client = redis.RedisClient{
                .hostname = hostname,
                .protocol = uri,
                .port = port,
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

    pub fn getConnected(this: *JSRedisClient, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.client.status == .connected);
    }

    pub fn getBufferedAmount(this: *JSRedisClient, _: *JSC.JSGlobalObject) JSValue {
        const len =
            this.client.write_buffer.len() +
            this.client.read_buffer.len();
        return JSValue.jsNumber(len);
    }

    pub fn jsConnect(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        this.ref();
        defer this.deref();

        const this_value = callframe.this();

        // If already connected, resolve immediately
        if (this.client.status == .connected) {
            return JSC.JSPromise.resolvedPromiseValue(globalObject, .undefined);
        }

        if (JSRedisClient.connectionPromiseGetCached(this_value)) |promise| {
            return promise;
        }

        const promise_ptr = JSC.JSPromise.create(globalObject);
        const promise = promise_ptr.asValue(globalObject);
        JSRedisClient.connectionPromiseSetCached(this_value, globalObject, promise);

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

    pub fn jsDisconnect(this: *JSRedisClient, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        if (this.client.status == .disconnected) {
            return .undefined;
        }
        this.client.disconnect();
        return .undefined;
    }

    pub fn getOnConnect(_: *JSRedisClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (JSRedisClient.onconnectGetCached(thisValue)) |value| {
            return value;
        }
        return .undefined;
    }

    pub fn setOnConnect(_: *JSRedisClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
        JSRedisClient.onconnectSetCached(thisValue, globalObject, value);
        return true;
    }

    pub fn getOnClose(_: *JSRedisClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (JSRedisClient.oncloseGetCached(thisValue)) |value| {
            return value;
        }
        return .undefined;
    }

    pub fn setOnClose(_: *JSRedisClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
        JSRedisClient.oncloseSetCached(thisValue, globalObject, value);
        return true;
    }

    /// Safely add a timer with proper reference counting and event loop keepalive
    fn addTimer(this: *JSRedisClient, timer: *JSC.BunTimer.EventLoopTimer, next_timeout_ms: u32) void {
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
    fn removeTimer(this: *JSRedisClient, timer: *JSC.BunTimer.EventLoopTimer) void {
        if (timer.state == .ACTIVE) {

            // Store VM reference to use later
            const vm = this.globalObject.bunVM();

            // Remove the timer from the event loop
            vm.timer.remove(timer);

            // Balance the ref from addTimer
            this.deref();
        }
    }

    fn resetConnectionTimeout(this: *JSRedisClient) void {
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

    pub fn disableConnectionTimeout(this: *JSRedisClient) void {
        if (this.timer.state == .ACTIVE) {
            this.removeTimer(&this.timer);
        }
        this.timer.state = .CANCELLED;
    }

    pub fn onConnectionTimeout(this: *JSRedisClient) JSC.BunTimer.EventLoopTimer.Arm {
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

    pub fn onReconnectTimer(this: *JSRedisClient) JSC.BunTimer.EventLoopTimer.Arm {
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

    pub fn reconnect(this: *JSRedisClient) void {
        if (!this.client.flags.is_reconnecting) {
            return;
        }

        // Ref to keep this alive during the reconnection
        this.ref();
        defer this.deref();

        this.client.status = .connecting;

        const vm = this.globalObject.bunVM();

        // Recreate socket and connect again
        const ctx = vm.rareData().redis_context.tcp orelse return;

        // Set retry to 0 to avoid incremental backoff from previous attempts
        this.client.retry_attempts = 0;

        // Ref the poll to keep event loop alive during connection
        this.poll_ref.disable();
        this.poll_ref = .{};
        this.poll_ref.ref(vm);

        this.client.socket = .{
            .SocketTCP = uws.SocketTCP.connectAnon(
                this.client.hostname,
                this.client.port,
                ctx,
                this,
                false,
            ) catch |err| {
                debug("Failed to reconnect: {s}", .{@errorName(err)});
                // Unref since connection failed
                this.poll_ref.unref(vm);
                // Schedule another reconnection attempt
                this.client.onClose();
                return;
            },
        };

        // Reset the socket timeout
        this.resetConnectionTimeout();
    }

    // Callback for when Redis client connects
    pub fn onRedisConnect(this: *JSRedisClient) void {
        // Safety check to ensure a valid connection state
        if (this.client.status != .connected) {
            debug("onRedisConnect called but client status is not 'connected': {s}", .{@tagName(this.client.status)});
            return;
        }

        const globalObject = this.globalObject;
        const event_loop = globalObject.bunVM().eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        if (this.this_value.tryGet()) |this_value| {
            // Call onConnect callback if defined by the user
            if (JSRedisClient.onconnectGetCached(this_value)) |on_connect| {
                const js_value = this_value;
                js_value.ensureStillAlive();
                globalObject.queueMicrotask(on_connect, &[_]JSValue{ JSValue.jsNull(), js_value });
            }

            if (JSRedisClient.connectionPromiseGetCached(this_value)) |promise| {
                JSRedisClient.connectionPromiseSetCached(this_value, globalObject, .zero);
                promise.asPromise().?.resolve(globalObject, .undefined);
            }
        }

        this.client.onWritable();
        this.updatePollRef();
    }

    // Callback for when Redis client needs to reconnect
    pub fn onRedisReconnect(this: *JSRedisClient) void {
        // Schedule reconnection using our safe timer methods
        if (this.reconnect_timer.state == .ACTIVE) {
            this.removeTimer(&this.reconnect_timer);
        }

        const delay_ms = this.client.getReconnectDelay();
        if (delay_ms > 0) {
            this.addTimer(&this.reconnect_timer, delay_ms);
        }
    }

    // Callback for when Redis client closes
    pub fn onRedisClose(this: *JSRedisClient) void {
        const globalObject = this.globalObject;
        this.poll_ref.disable();
        defer this.deref();

        const this_jsvalue = this.this_value.tryGet() orelse return;
        this.this_value.setWeak(this_jsvalue);
        this.ref();
        defer this.deref();

        // Create an error value
        const error_value = protocol.redisErrorToJS(globalObject, "Connection closed", protocol.RedisError.ConnectionClosed);

        const loop = globalObject.bunVM().eventLoop();
        loop.enter();
        defer loop.exit();

        if (this_jsvalue != .undefined) {
            if (JSRedisClient.connectionPromiseGetCached(this_jsvalue)) |promise| {
                JSRedisClient.connectionPromiseSetCached(this_jsvalue, globalObject, .zero);
                promise.asPromise().?.reject(globalObject, error_value);
            }
        }

        // Call onClose callback if it exists
        if (JSRedisClient.oncloseGetCached(this_jsvalue)) |on_close| {
            _ = on_close.call(
                globalObject,
                this_jsvalue,
                &[_]JSValue{error_value},
            ) catch |e| globalObject.reportActiveExceptionAsUnhandled(e);
        }
    }

    // Callback for when Redis client times out
    pub fn onRedisTimeout(this: *JSRedisClient) void {
        this.clientFail("Connection timeout", protocol.RedisError.ConnectionClosed);
    }

    pub fn clientFail(this: *JSRedisClient, message: []const u8, err: protocol.RedisError) void {
        debug("clientFail: {s}: {s}", .{ message, @errorName(err) });
        const globalObject = this.globalObject;
        const value = protocol.redisErrorToJS(globalObject, message, err);
        this.failWithJSValue(value);
    }

    pub fn failWithJSValue(this: *JSRedisClient, value: JSValue) void {
        const this_value = this.this_value.tryGet() orelse return;
        const globalObject = this.globalObject;
        if (JSRedisClient.oncloseGetCached(this_value)) |on_close| {
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

    pub fn finalize(this: *JSRedisClient) void {
        debug("JSRedisClient finalize", .{});
        this.stopTimers();
        this.this_value.deinit();
        if (this.client.status == .connected or this.client.status == .connecting) {
            this.client.flags.is_manually_closed = true;
        }

        this.client.socket.close();
        this.deref();
    }

    pub fn stopTimers(this: *JSRedisClient) void {
        // Use safe timer removal methods to ensure proper reference counting
        if (this.timer.state == .ACTIVE) {
            this.removeTimer(&this.timer);
        }
        if (this.reconnect_timer.state == .ACTIVE) {
            this.removeTimer(&this.reconnect_timer);
        }
    }

    fn connect(this: *JSRedisClient) !void {
        this.client.flags.needs_to_open_socket = false;
        const vm = this.globalObject.bunVM();

        const ctx = vm.rareData().redis_context.tcp orelse brk: {
            var err: uws.create_bun_socket_error_t = .none;
            const ctx_ = uws.us_create_bun_socket_context(0, vm.uwsLoop(), @sizeOf(*JSRedisClient), uws.us_bun_socket_context_options_t{}, &err).?;
            uws.NewSocketHandler(false).configure(ctx_, true, *JSRedisClient, SocketHandler(false));
            vm.rareData().redis_context.tcp = ctx_;
            break :brk ctx_;
        };
        this.ref();

        this.client.socket = uws.AnySocket{
            .SocketTCP = try uws.SocketTCP.connectAnon(
                this.client.hostname,
                this.client.port,
                ctx,
                this,
                false,
            ),
        };
    }

    fn send(this: *JSRedisClient, globalThis: *JSC.JSGlobalObject, this_jsvalue: JSValue, command: *const Command) !*JSC.JSPromise {
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

    pub fn jsSendCommand(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const command = try callframe.argument(0).toBunString(globalObject);
        defer command.deref();

        const args_array = callframe.argument(1);
        if (!args_array.isObject() or !args_array.isArray()) {
            return globalObject.throw("Arguments must be an array", .{});
        }
        var iter = args_array.arrayIterator(globalObject);
        var args = try std.ArrayList(JSC.ZigString.Slice).initCapacity(bun.default_allocator, iter.len);
        defer {
            for (args.items) |item| {
                item.deinit();
            }
            args.deinit();
        }

        while (iter.next()) |arg_js| {
            const arg_str = try arg_js.toBunString(globalObject);
            defer arg_str.deref();
            const slice = arg_str.toUTF8WithoutRef(bun.default_allocator);
            args.appendAssumeCapacity(slice);
        }

        const cmd_str = command.toUTF8WithoutRef(bun.default_allocator);
        defer cmd_str.deinit();
        // Send command with slices directly
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = cmd_str.slice(),
                .args = .{ .slices = args.items },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn get(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send GET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "GET",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send GET command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn set(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const value = try callframe.argument(1).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send SET command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SET",
                .args = .{ .slices = &.{ key_slice, value_slice } },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SET command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn del(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();

        // Send DEL command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "DEL",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send DEL command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn incr(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send INCR command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "INCR",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send INCR command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn decr(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send DECR command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "DECR",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send DECR command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn exists(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send EXISTS command with special Exists type for boolean conversion
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "EXISTS",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Exists,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send EXISTS command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn expire(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const seconds = try globalObject.validateIntegerRange(callframe.argument(1), i32, 0, .{ .min = 0, .max = 2147483647 });

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
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
                .args = .{ .raw = &.{ key_slice.slice(), seconds_slice } },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send EXPIRE command", err);
        };
        return promise.asValue(globalObject);
    }

    pub fn ttl(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send TTL command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "TTL",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send TTL command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement srem (remove value from a set)
    pub fn srem(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const value = try callframe.argument(1).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send SREM command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SREM",
                .args = .{ .slices = &.{ key_slice, value_slice } },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SREM command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement srandmember (get random member from set)
    pub fn srandmember(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send SRANDMEMBER command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SRANDMEMBER",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SRANDMEMBER command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement smembers (get all members of a set)
    pub fn smembers(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        // Send SMEMBERS command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SMEMBERS",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SMEMBERS command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement spop (pop a random member from a set)
    pub fn spop(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();

        // Send SPOP command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SPOP",
                .args = .{ .slices = &.{key_slice} },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SPOP command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement sadd (add member to a set)
    pub fn sadd(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const value = try callframe.argument(1).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send SADD command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SADD",
                .args = .{ .slices = &.{ key_slice, value_slice } },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SADD command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement sismember (check if value is member of a set)
    pub fn sismember(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();
        const value = try callframe.argument(1).toBunString(globalObject);
        defer value.deref();

        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();
        const value_slice = value.toUTF8WithoutRef(bun.default_allocator);
        defer value_slice.deinit();

        // Send SISMEMBER command
        const promise = this.send(
            globalObject,
            callframe.this(),
            &.{
                .command = "SISMEMBER",
                .args = .{ .slices = &.{ key_slice, value_slice } },
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send SISMEMBER command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hmget (get multiple values from hash)
    pub fn hmget(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const key = try callframe.argument(0).toBunString(globalObject);
        defer key.deref();

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

        // Add key as first argument
        const key_slice = key.toUTF8WithoutRef(bun.default_allocator);
        defer key_slice.deinit();

        args.appendAssumeCapacity(key_slice);

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
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send HMGET command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hincrby (increment hash field by integer value)
    pub fn hincrby(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send HINCRBY command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hincrbyfloat (increment hash field by float value)
    pub fn hincrbyfloat(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send HINCRBYFLOAT command", err);
        };
        return promise.asValue(globalObject);
    }

    // Implement hmset (set multiple values in hash)
    pub fn hmset(this: *JSRedisClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
                .command_type = .Generic,
            },
        ) catch |err| {
            return protocol.redisErrorToJS(globalObject, "Failed to send HMSET command", err);
        };
        return promise.asValue(globalObject);
    }

    // Getter for memory cost - useful for diagnostics
    pub fn memoryCost(this: *JSRedisClient) usize {
        var memory_cost: usize = @sizeOf(JSRedisClient);

        // Add size of all internal buffers
        memory_cost += this.client.write_buffer.byte_list.cap;
        memory_cost += this.client.read_buffer.byte_list.cap;

        // Add queue sizes
        memory_cost += this.client.in_flight.count * @sizeOf(redis.Command.PromisePair);
        for (this.client.queue.readableSlice(0)) |*command| {
            memory_cost += command.serialized_data.len;
        }
        memory_cost += this.client.queue.count * @sizeOf(redis.Command.Entry);
        return memory_cost;
    }

    pub fn deinit(this: *JSRedisClient) void {
        bun.debugAssert(this.client.socket.isClosed());

        this.client.deinit();
        this.poll_ref.disable();
        this.stopTimers();
        this.this_value.deinit();
        bun.debugAssert(this.ref_count == 0);
        this.destroy();
    }

    /// Keep the event loop alive, or don't keep it alive
    pub fn updatePollRef(this: *JSRedisClient) void {
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
            pub fn onOpen(this: *JSRedisClient, socket: SocketType) void {
                this.client.onOpen(_socket(socket));
            }

            fn onHandshake_(this: *JSRedisClient, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
                // Handle TLS handshake if needed
                _ = this;
                _ = success;
                _ = ssl_error;
            }

            pub const onHandshake = if (ssl) onHandshake_ else null;

            pub fn onClose(this: *JSRedisClient, socket: SocketType, _: i32, _: ?*anyopaque) void {
                _ = socket;
                this.client.onClose();
            }

            pub fn onEnd(_: *JSRedisClient, socket: SocketType) void {
                socket.close(.normal);
            }

            pub fn onConnectError(this: *JSRedisClient, socket: SocketType, _: i32) void {
                _ = socket;
                this.client.onClose();
            }

            pub fn onTimeout(this: *JSRedisClient, socket: SocketType) void {
                _ = socket;
                _ = this;
                // Handle socket timeout
            }

            pub fn onData(this: *JSRedisClient, socket: SocketType, data: []const u8) void {
                _ = socket;
                this.ref();
                defer this.deref();
                this.client.onData(data);
                this.updatePollRef();
            }

            pub fn onWritable(this: *JSRedisClient, socket: SocketType) void {
                _ = socket;
                this.ref();
                defer this.deref();
                this.client.onWritable();
                this.updatePollRef();
            }
        };
    }
};

// Parse JavaScript options into Redis client options
const Options = struct {
    pub fn fromJS(globalObject: *JSC.JSGlobalObject, options_obj: JSC.JSValue) !redis.Options {
        var this = redis.Options{};
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
            if (tls.isBoolean()) {
                this.has_tls = tls.toBoolean();
            }
        }

        return this;
    }
};
