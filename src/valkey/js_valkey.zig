/// Valkey client wrapper for JavaScript
pub const JSValkeyClient = struct {
    client: valkey.ValkeyClient,
    globalObject: *JSC.JSGlobalObject,
    this_value: JSC.JSRef = JSC.JSRef.empty(),
    poll_ref: bun.Async.KeepAlive = .{},
    timer: Timer.EventLoopTimer = .{
        .tag = .ValkeyConnectionTimeout,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },
    reconnect_timer: Timer.EventLoopTimer = .{
        .tag = .ValkeyConnectionReconnect,
        .next = .{
            .sec = 0,
            .nsec = 0,
        },
    },
    ref_count: RefCount,

    pub const js = JSC.Codegen.JSRedisClient;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;
    pub const new = bun.TrivialNew(@This());

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
            .ref_count = .init(),
            .client = .{
                .vm = vm,
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
                    .auto_pipelining = options.enable_auto_pipelining,
                },
                .max_retries = options.max_retries,
                .connection_timeout_ms = options.connection_timeout_ms,
                .idle_timeout_interval_ms = options.idle_timeout_ms,
            },
            .globalObject = globalObject,
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

    pub fn doConnect(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, this_value: JSValue) bun.JSError!JSValue {
        this.ref();
        defer this.deref();

        // If already connected, resolve immediately
        if (this.client.status == .connected) {
            return JSC.JSPromise.resolvedPromiseValue(globalObject, js.helloGetCached(this_value) orelse .js_undefined);
        }

        if (js.connectionPromiseGetCached(this_value)) |promise| {
            return promise;
        }

        const promise_ptr = JSC.JSPromise.create(globalObject);
        const promise = promise_ptr.toJS();
        js.connectionPromiseSetCached(this_value, globalObject, promise);

        // If was manually closed, reset that flag
        this.client.flags.is_manually_closed = false;
        this.this_value.setStrong(this_value, globalObject);

        if (this.client.flags.needs_to_open_socket) {
            this.poll_ref.ref(this.client.vm);

            this.connect() catch |err| {
                this.poll_ref.unref(this.client.vm);
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalObject.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, " {s} connecting to Valkey", .{@errorName(err)}).toJS();
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

    pub fn jsConnect(this: *JSValkeyClient, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return try this.doConnect(globalObject, callframe.this());
    }

    pub fn jsDisconnect(this: *JSValkeyClient, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        if (this.client.status == .disconnected) {
            return .js_undefined;
        }
        this.client.disconnect();
        return .js_undefined;
    }

    pub fn getOnConnect(_: *JSValkeyClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (js.onconnectGetCached(thisValue)) |value| {
            return value;
        }
        return .js_undefined;
    }

    pub fn setOnConnect(_: *JSValkeyClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) void {
        js.onconnectSetCached(thisValue, globalObject, value);
    }

    pub fn getOnClose(_: *JSValkeyClient, thisValue: JSValue, _: *JSC.JSGlobalObject) JSValue {
        if (js.oncloseGetCached(thisValue)) |value| {
            return value;
        }
        return .js_undefined;
    }

    pub fn setOnClose(_: *JSValkeyClient, thisValue: JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) void {
        js.oncloseSetCached(thisValue, globalObject, value);
    }

    /// Safely add a timer with proper reference counting and event loop keepalive
    fn addTimer(this: *JSValkeyClient, timer: *Timer.EventLoopTimer, next_timeout_ms: u32) void {
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
        const vm = this.client.vm;

        // Set up timer and add to event loop
        timer.next = bun.timespec.msFromNow(@intCast(next_timeout_ms));
        vm.timer.insert(timer);
        this.ref();
    }

    /// Safely remove a timer with proper reference counting and event loop keepalive
    fn removeTimer(this: *JSValkeyClient, timer: *Timer.EventLoopTimer) void {
        if (timer.state == .ACTIVE) {

            // Store VM reference to use later
            const vm = this.client.vm;

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

    pub fn onConnectionTimeout(this: *JSValkeyClient) Timer.EventLoopTimer.Arm {
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

        var buf: [128]u8 = undefined;
        switch (this.client.status) {
            .connected => {
                const msg = std.fmt.bufPrintZ(&buf, "Idle timeout reached after {d}ms", .{this.client.idle_timeout_interval_ms}) catch unreachable;
                this.clientFail(msg, protocol.RedisError.IdleTimeout);
            },
            .disconnected, .connecting => {
                const msg = std.fmt.bufPrintZ(&buf, "Connection timeout reached after {d}ms", .{this.client.connection_timeout_ms}) catch unreachable;
                this.clientFail(msg, protocol.RedisError.ConnectionTimeout);
            },
            else => {
                // No timeout for other states
            },
        }

        return .disarm;
    }

    pub fn onReconnectTimer(this: *JSValkeyClient) Timer.EventLoopTimer.Arm {
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

        const vm = this.client.vm;

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
            this.failWithJSValue(this.globalObject.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, "{s} reconnecting", .{@errorName(err)}).toJS());
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
        const event_loop = this.client.vm.eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        if (this.this_value.tryGet()) |this_value| {
            const hello_value: JSValue = value.toJS(globalObject) catch .js_undefined;
            js.helloSetCached(this_value, globalObject, hello_value);
            // Call onConnect callback if defined by the user
            if (js.onconnectGetCached(this_value)) |on_connect| {
                const js_value = this_value;
                js_value.ensureStillAlive();
                globalObject.queueMicrotask(on_connect, &[_]JSValue{ js_value, hello_value });
            }

            if (js.connectionPromiseGetCached(this_value)) |promise| {
                js.connectionPromiseSetCached(this_value, globalObject, .zero);
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

        const loop = this.client.vm.eventLoop();
        loop.enter();
        defer loop.exit();

        if (!this_jsvalue.isUndefined()) {
            if (js.connectionPromiseGetCached(this_jsvalue)) |promise| {
                js.connectionPromiseSetCached(this_jsvalue, globalObject, .zero);
                promise.asPromise().?.reject(globalObject, error_value);
            }
        }

        // Call onClose callback if it exists
        if (js.oncloseGetCached(this_jsvalue)) |on_close| {
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
        this.client.fail(message, err);
    }

    pub fn failWithJSValue(this: *JSValkeyClient, value: JSValue) void {
        const this_value = this.this_value.tryGet() orelse return;
        const globalObject = this.globalObject;
        if (js.oncloseGetCached(this_value)) |on_close| {
            const loop = this.client.vm.eventLoop();
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
        const vm = this.client.vm;

        const ctx: *uws.SocketContext, const deinit_context: bool =
            switch (this.client.tls) {
                .none => .{
                    vm.rareData().valkey_context.tcp orelse brk_ctx: {
                        // TCP socket
                        const ctx_ = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient)).?;
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
                        const ctx_ = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient), uws.SocketContext.BunSocketContextOptions{}, &err).?;
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
                    const ctx_ = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient), options, &err).?;
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

    pub fn send(this: *JSValkeyClient, globalThis: *JSC.JSGlobalObject, this_jsvalue: JSValue, command: *const Command) !*JSC.JSPromise {
        if (this.client.flags.needs_to_open_socket) {
            @branchHint(.unlikely);

            if (this.this_value != .strong)
                this.this_value.setStrong(this_jsvalue, globalThis);

            this.connect() catch |err| {
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalThis.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, " {s} connecting to Valkey", .{@errorName(err)}).toJS();
                const promise = JSC.JSPromise.create(globalThis);
                promise.reject(globalThis, err_value);
                return promise;
            };
            this.resetConnectionTimeout();
        }

        defer this.updatePollRef();

        return try this.client.send(globalThis, command);
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

    fn deinit(this: *JSValkeyClient) void {
        bun.debugAssert(this.client.socket.isClosed());

        this.client.deinit(null);
        this.poll_ref.disable();
        this.stopTimers();
        this.this_value.deinit();
        this.ref_count.assertNoRefs();
        bun.destroy(this);
    }

    /// Keep the event loop alive, or don't keep it alive
    pub fn updatePollRef(this: *JSValkeyClient) void {
        if (!this.client.hasAnyPendingCommands() and this.client.status == .connected) {
            this.poll_ref.unref(this.client.vm);
            // If we don't have any pending commands and we're connected, we don't need to keep the object alive.
            if (this.this_value.tryGet()) |value| {
                this.this_value.setWeak(value);
            }
        } else if (this.client.hasAnyPendingCommands()) {
            this.poll_ref.ref(this.client.vm);
            // If we have pending commands, we need to keep the object alive.
            if (this.this_value == .weak) {
                this.this_value.upgrade(this.globalObject);
            }
        }
    }

    pub const jsSend = fns.jsSend;
    pub const @"type" = fns.type;
    pub const append = fns.append;
    pub const bitcount = fns.bitcount;
    pub const decr = fns.decr;
    pub const del = fns.del;
    pub const dump = fns.dump;
    pub const exists = fns.exists;
    pub const expire = fns.expire;
    pub const expiretime = fns.expiretime;
    pub const get = fns.get;
    pub const getBuffer = fns.getBuffer;
    pub const getdel = fns.getdel;
    pub const getex = fns.getex;
    pub const getset = fns.getset;
    pub const hgetall = fns.hgetall;
    pub const hincrby = fns.hincrby;
    pub const hincrbyfloat = fns.hincrbyfloat;
    pub const hkeys = fns.hkeys;
    pub const hlen = fns.hlen;
    pub const hmget = fns.hmget;
    pub const hmset = fns.hmset;
    pub const hstrlen = fns.hstrlen;
    pub const hvals = fns.hvals;
    pub const incr = fns.incr;
    pub const keys = fns.keys;
    pub const llen = fns.llen;
    pub const lpop = fns.lpop;
    pub const lpush = fns.lpush;
    pub const lpushx = fns.lpushx;
    pub const mget = fns.mget;
    pub const persist = fns.persist;
    pub const pexpiretime = fns.pexpiretime;
    pub const pfadd = fns.pfadd;
    pub const ping = fns.ping;
    pub const psubscribe = fns.psubscribe;
    pub const pttl = fns.pttl;
    pub const publish = fns.publish;
    pub const pubsub = fns.pubsub;
    pub const punsubscribe = fns.punsubscribe;
    pub const rpop = fns.rpop;
    pub const rpush = fns.rpush;
    pub const rpushx = fns.rpushx;
    pub const sadd = fns.sadd;
    pub const scard = fns.scard;
    pub const script = fns.script;
    pub const select = fns.select;
    pub const set = fns.set;
    pub const setnx = fns.setnx;
    pub const sismember = fns.sismember;
    pub const smembers = fns.smembers;
    pub const smove = fns.smove;
    pub const spop = fns.spop;
    pub const spublish = fns.spublish;
    pub const srandmember = fns.srandmember;
    pub const srem = fns.srem;
    pub const strlen = fns.strlen;
    pub const subscribe = fns.subscribe;
    pub const substr = fns.substr;
    pub const ttl = fns.ttl;
    pub const unsubscribe = fns.unsubscribe;
    pub const zcard = fns.zcard;
    pub const zpopmax = fns.zpopmax;
    pub const zpopmin = fns.zpopmin;
    pub const zrandmember = fns.zrandmember;
    pub const zrank = fns.zrank;
    pub const zrevrank = fns.zrevrank;
    pub const zscore = fns.zscore;

    const fns = @import("./js_valkey_functions.zig");
};

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
                const vm = this.client.vm;
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

// Parse JavaScript options into Valkey client options
const Options = struct {
    pub fn fromJS(globalObject: *JSC.JSGlobalObject, options_obj: JSC.JSValue) !valkey.Options {
        var this = valkey.Options{
            .enable_auto_pipelining = !bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING),
        };

        if (try options_obj.getOptionalInt(globalObject, "idleTimeout", u32)) |idle_timeout| {
            this.idle_timeout_ms = idle_timeout;
        }

        if (try options_obj.getOptionalInt(globalObject, "connectionTimeout", u32)) |connection_timeout| {
            this.connection_timeout_ms = connection_timeout;
        }

        if (try options_obj.getIfPropertyExists(globalObject, "autoReconnect")) |auto_reconnect| {
            this.enable_auto_reconnect = auto_reconnect.toBoolean();
        }

        if (try options_obj.getOptionalInt(globalObject, "maxRetries", u32)) |max_retries| {
            this.max_retries = max_retries;
        }

        if (try options_obj.getIfPropertyExists(globalObject, "enableOfflineQueue")) |enable_offline_queue| {
            this.enable_offline_queue = enable_offline_queue.toBoolean();
        }

        if (try options_obj.getIfPropertyExists(globalObject, "enableAutoPipelining")) |enable_auto_pipelining| {
            this.enable_auto_pipelining = enable_auto_pipelining.toBoolean();
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
const bun = @import("bun");
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

const Timer = bun.api.Timer;
