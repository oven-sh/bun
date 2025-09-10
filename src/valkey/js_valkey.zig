fn SubscriptionCtx(comptime ParentType: type, comptime _: []const u8) type {
    return struct {
        const Self = @This();

        original_enable_offline_queue: bool,
        original_enable_auto_pipelining: bool,
        _subscriptionCallbackMap: jsc.JSValue,
        parent_ref: *ParentType,

        const ParentJS = JSValkeyClient.js;

        fn parent(this: *Self) *ParentType {
            return this.parent_ref;
        }

        pub fn init(global_object: *jsc.JSGlobalObject, parent_ptr: *ParentType, enable_offline_queue: bool, enable_auto_pipelining: bool) Self {
            const self = Self{
                .original_enable_offline_queue = enable_offline_queue,
                .original_enable_auto_pipelining = enable_auto_pipelining,
                ._subscriptionCallbackMap = jsc.JSMap.create(global_object),
                .parent_ref = parent_ptr,
            };
            return self;
        }

        fn subscriptionCallbackMap(this: *Self) *jsc.JSMap {
            return jsc.JSMap.fromJS(this._subscriptionCallbackMap) orelse unreachable;
        }

        /// Get the total number of channels that this subscription context is subscribed to.
        pub fn subscriptionCount(this: *Self, globalObject: *jsc.JSGlobalObject) usize {
            return this.subscriptionCallbackMap().size(globalObject);
        }

        /// Test whether this context has any subscriptions. It is mandatory to
        /// guard deinit with this function.
        pub fn hasSubscriptions(this: *Self, globalObject: *jsc.JSGlobalObject) bool {
            return this.subscriptionCount(globalObject) > 0;
        }

        pub fn clearReceiveHandlers(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
    ) void {
            if (this.subscriptionCallbackMap().remove(globalObject, channelName)) {
                this.parent().channel_subscription_count -= 1;
                this.parent().updateHasPendingActivity();
            }
        }

        /// Remove a specific receive handler.
        ///
        /// Returns: The total number of remaining handlers for this channel, or null if here were no listeners
        /// originally registered.
        ///
        /// Note: This function will empty out the map entry if there are no more handlers registered.
        pub fn removeReceiveHandler(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
        callback: JSValue,
    ) !?usize {
            const existing = try this.subscriptionCallbackMap().get(globalObject, channelName);

            if (existing == null) {
                // Could not find the channel, nothing to remove.
                return null;
            }

            if (existing.?.isUndefinedOrNull()) {
                // Nothing to remove.
                return null;
            }

            // Existing is guaranteed to be an array of callbacks.
            bun.assert(existing.?.isArray());

            // TODO(markovejnovic): I can't find a better way to do this... I generate a new array,
            // filtering out the callback we want to remove. This is woefully inefficient for large
            // sets (and surprisingly fast for small sets of callbacks).
            //
            // Perhaps there is an avenue to build a generic iterator pattern? @taylor.fish and I have
            // briefly expressed a desire for this, and I promised her I would look into it, but at
            // this moment have no proposal.
            var array_it = try existing.?.arrayIterator(globalObject);
            const updated_array = try jsc.JSArray.createEmpty(globalObject, 0);
            while (try array_it.next()) |iter| {
                if (iter == callback)
                continue;

                try updated_array.push(globalObject, iter);
            }

            // Otherwise, we have ourselves an array of callbacks. We need to remove the element in the
            // array that matches the callback.
            _ = this.subscriptionCallbackMap().remove(globalObject, channelName);

            // Only populate the map if we have remaining callbacks for this channel.
            const new_length = (updated_array.arrayIterator(globalObject) catch unreachable).len;
            if (new_length != 0) {
                this.subscriptionCallbackMap().set(globalObject, channelName, updated_array);
            } else {
                this.parent().channel_subscription_count -= 1;
                this.parent().updateHasPendingActivity();
            }

            return new_length;
        }

        /// Add a handler for receiving messages on a specific channel
        pub fn upsertReceiveHandler(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
        callback: JSValue,
    ) bun.JSError!void {
            var handlers_array: JSValue = undefined;
            var is_new_channel = false;
            if (try this.subscriptionCallbackMap().get(globalObject, channelName)) |existing_handler_arr| {
                debug("Adding a new receive handler.", .{});
                if (existing_handler_arr.isUndefined()) {
                    // Create a new array if the existing_handler_arr is undefined/null
                    handlers_array = try jsc.JSArray.createEmpty(globalObject, 0);
                    is_new_channel = true;
                } else if (existing_handler_arr.isArray()) {
                    // Use the existing array
                    handlers_array = existing_handler_arr;
                } else unreachable;
            } else {
                // No existing_handler_arr exists, create a new array
                handlers_array = try jsc.JSArray.createEmpty(globalObject, 0);
                is_new_channel = true;
            }

            try handlers_array.push(globalObject, callback);
            this.subscriptionCallbackMap().set(globalObject, channelName, handlers_array);
            // Update subscription count if this is a new channel
            if (is_new_channel) {
                this.parent().channel_subscription_count += 1;
                this.parent().updateHasPendingActivity();
            }
        }

        pub fn registerCallback(this: *Self, globalObject: *jsc.JSGlobalObject, eventString: JSValue, callback: JSValue) bun.JSError!void {
            this._.set(globalObject, eventString, callback);
        }

        pub fn getCallbacks(this: *Self, globalObject: *jsc.JSGlobalObject, channelName: JSValue) bun.JSError!?JSValue {
            const result = try this.subscriptionCallbackMap().get(globalObject, channelName);
            if (result) |r| {
                if (r.isUndefinedOrNull()) {
                    return null;
                }
            }

            return result;
        }

        /// Invoke callbacks for a channel with the given arguments
        /// Handles both single callbacks and arrays of callbacks
        pub fn invokeCallback(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
        args: []const JSValue,
    ) bun.JSError!void {
            const callbacks = try this.getCallbacks(globalObject, channelName) orelse {
                debug("No callbacks found for channel {s}", .{channelName.asString().getZigString(globalObject)});
                return;
            };

            // If callbacks is an array, iterate and call each one
            if (callbacks.isArray()) {
                var iter = try callbacks.arrayIterator(globalObject);
                while (try iter.next()) |callback| {
                    if (callback.isCallable()) {
                        _ = callback.call(globalObject, .js_undefined, args) catch |e| {
                            return e;
                        };
                    }
                }
            } else if (callbacks.isCallable()) {
                _ = callbacks.call(globalObject, .js_undefined, args) catch |e| {
                    return e;
                };
            }
        }

        pub fn deinit(this: *Self) void {
            this.parent().channel_subscription_count = 0;
            this.parent().updateHasPendingActivity();
            this._subscriptionCallbackMap = .js_undefined;
        }
    };
}

/// Valkey client wrapper for JavaScript
pub const JSValkeyClient = struct {
    const SubscriptionCtxType = SubscriptionCtx(JSValkeyClient, "_subscription_ctx");

    client: valkey.ValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    this_value: jsc.JSRef = jsc.JSRef.empty(),
    poll_ref: bun.Async.KeepAlive = .{},

    _subscription_ctx: ?SubscriptionCtxType,
    channel_subscription_count: u32 = 0,
    has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),

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

    pub const js = jsc.Codegen.JSRedisClient;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;
    pub const new = bun.TrivialNew(@This());

    // Factory function to create a new Valkey client from JS
    pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*JSValkeyClient {
        return try create(globalObject, callframe.arguments());
    }

    pub fn create(globalObject: *jsc.JSGlobalObject, arguments: []const JSValue) bun.JSError!*JSValkeyClient {
        const this_allocator = bun.default_allocator;

        const vm = globalObject.bunVM();
        const url_str = if (arguments.len < 1 or arguments[0].isUndefined())
            if (vm.transpiler.env.get("REDIS_URL") orelse vm.transpiler.env.get("VALKEY_URL")) |url|
                bun.String.init(url)
            else
                bun.String.init("valkey://localhost:6379")
        else
            try arguments[0].toBunString(globalObject);
        defer url_str.deref();

        const url_utf8 = url_str.toUTF8WithoutRef(this_allocator);
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
            this_allocator.free(connection_strings);
        }

        if (url.username.len > 0 or url.password.len > 0 or hostname.len > 0) {
            var b = bun.StringBuilder{};
            b.count(url.username);
            b.count(url.password);
            b.count(hostname);
            try b.allocate(this_allocator);
            defer b.deinit(this_allocator);
            username = b.append(url.username);
            password = b.append(url.password);
            hostname = b.append(hostname);
            b.moveToSlice(&connection_strings);
        }

        const database = if (url.pathname.len > 0) std.fmt.parseInt(u32, url.pathname[1..], 10) catch 0 else 0;

        bun.analytics.Features.valkey += 1;

        return JSValkeyClient.new(.{
            .ref_count = .init(),
            ._subscription_ctx = null,
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
                .protocol = uri,
                .username = username,
                .password = password,
                .in_flight = .init(this_allocator),
                .queue = .init(this_allocator),
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
                .allocator = this_allocator,
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

    /// Clone this client while remaining in the initial disconnected state. This does not preserve
    /// the
    pub fn cloneWithoutConnecting(this: *const JSValkeyClient) bun.OOM!*JSValkeyClient {
        const vm = this.globalObject.bunVM();

        const relocate = struct {
            // Given a slice within a window, move the slice to point to a new
            // window, with the same offset relative to the window start.
            fn slice(original: []const u8, old_base: [*]const u8, new_base: [*]const u8) []const u8 {
                const offset = @intFromPtr(original.ptr) - @intFromPtr(old_base);
                return new_base[offset..][0..original.len];
            }
        }.slice;

        // Make a copy of connection_strings to avoid double-free
        const connection_strings_copy = try this.client.allocator.dupe(u8, this.client.connection_strings);

        // Note that there is no need to copy username, password and address since the copies live
        // within the connection_strings buffer.
        const base_ptr = this.client.connection_strings.ptr;
        const new_base = connection_strings_copy.ptr;
        const username = relocate(this.client.username, base_ptr, new_base);
        const password = relocate(this.client.password, base_ptr, new_base);
        const orig_hostname = this.client.address.hostname();
        const hostname = relocate(orig_hostname, base_ptr, new_base);

        return JSValkeyClient.new(.{
            .ref_count = .init(),
            ._subscription_ctx = null,
            .client = .{
                .vm = vm,
                .address = switch (this.client.protocol) {
                    .standalone_unix, .standalone_tls_unix => .{ .unix = hostname },
                    else => .{
                        .host = .{
                            .host = hostname,
                            .port = this.client.address.host.port,
                        },
                    },
                },
                .protocol = this.client.protocol,
                .username = username,
                .password = password,
                .in_flight = .init(this.client.allocator),
                .queue = .init(this.client.allocator),
                .status = .disconnected,
                .connection_strings = connection_strings_copy,
                .socket = .{
                    .SocketTCP = .{
                        .socket = .{
                            .detached = {},
                        },
                    },
                },
                .database = this.client.database,
                .allocator = this.client.allocator,
                .flags = .{
                    // Because this starts in the disconnected state, we need to reset some flags.
                    .is_authenticated = false,
                    // If the user manually closed the connection, then duplicating a closed client
                    // means the new client remains finalized.
                    .is_manually_closed = this.client.flags.is_manually_closed,
                    .enable_offline_queue = if (this._subscription_ctx) |*ctx| ctx.original_enable_offline_queue else this.client.flags.enable_offline_queue,
                    .needs_to_open_socket = true,
                    .enable_auto_reconnect = this.client.flags.enable_auto_reconnect,
                    .is_reconnecting = false,
                    .auto_pipelining = if (this._subscription_ctx) |*ctx| ctx.original_enable_auto_pipelining else this.client.flags.auto_pipelining,
                    // Duplicating a finalized client means it stays finalized.
                    .finalized = this.client.flags.finalized,
                },
                .max_retries = this.client.max_retries,
                .connection_timeout_ms = this.client.connection_timeout_ms,
                .idle_timeout_interval_ms = this.client.idle_timeout_interval_ms,
            },
            .globalObject = this.globalObject,
        });
    }

    pub fn getOrCreateSubscriptionCtxEnteringSubscriptionMode(
        this: *JSValkeyClient,
    ) *SubscriptionCtxType {
        if (this._subscription_ctx) |*ctx| {
            // If we already have a subscription context, return it
            return ctx;
        }

        // Save the original flag values and create a new subscription context
        this._subscription_ctx = SubscriptionCtxType.init(
            this.globalObject,
            this,
            this.client.flags.enable_offline_queue,
            this.client.flags.auto_pipelining,
        );

        // We need to make sure we disable the offline queue.
        this.client.flags.enable_offline_queue = false;
        this.client.flags.auto_pipelining = false;

        return &(this._subscription_ctx.?);
    }

    pub fn deleteSubscriptionCtx(this: *JSValkeyClient) void {
        if (this._subscription_ctx) |*ctx| {
            // Restore the original flag values when leaving subscription mode
            this.client.flags.enable_offline_queue = ctx.original_enable_offline_queue;
            this.client.flags.auto_pipelining = ctx.original_enable_auto_pipelining;

            ctx.deinit();
        }

        this._subscription_ctx = null;
    }

    pub fn isSubscriber(this: *const JSValkeyClient) bool {
        return this._subscription_ctx != null;
    }

    pub fn getConnected(this: *JSValkeyClient, _: *jsc.JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.client.status == .connected);
    }

    pub fn getBufferedAmount(this: *JSValkeyClient, _: *jsc.JSGlobalObject) JSValue {
        const len =
            this.client.write_buffer.len() +
            this.client.read_buffer.len();
        return JSValue.jsNumber(len);
    }

    pub fn doConnect(
        this: *JSValkeyClient,
        globalObject: *jsc.JSGlobalObject,
        this_value: JSValue,
    ) bun.JSError!JSValue {
        this.ref();
        defer this.deref();

        // If already connected, resolve immediately
        if (this.client.status == .connected) {
            debug("Connecting client is already connected.", .{});
            return jsc.JSPromise.resolvedPromiseValue(globalObject, js.helloGetCached(this_value) orelse .js_undefined);
        }

        if (js.connectionPromiseGetCached(this_value)) |promise| {
            debug("Connecting client is already connected.", .{});
            return promise;
        }

        const promise_ptr = jsc.JSPromise.create(globalObject);
        const promise = promise_ptr.toJS();
        js.connectionPromiseSetCached(this_value, globalObject, promise);

        // If was manually closed, reset that flag
        this.client.flags.is_manually_closed = false;
        this.this_value.setStrong(this_value, globalObject);

        if (this.client.flags.needs_to_open_socket) {
            debug("Need to open socket, starting connection process.", .{});
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
                this.updateHasPendingActivity();
                this.client.flags.is_reconnecting = true;
                this.client.retry_attempts = 0;
                this.reconnect();
            },
            else => {},
        }

        return promise;
    }

    pub fn jsConnect(this: *JSValkeyClient, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return try this.doConnect(globalObject, callframe.this());
    }

    pub fn jsDisconnect(this: *JSValkeyClient, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        if (this.client.status == .disconnected) {
            return .js_undefined;
        }
        this.client.disconnect();
        return .js_undefined;
    }

    pub fn getOnConnect(_: *JSValkeyClient, thisValue: JSValue, _: *jsc.JSGlobalObject) JSValue {
        if (js.onconnectGetCached(thisValue)) |value| {
            return value;
        }
        return .js_undefined;
    }

    pub fn setOnConnect(_: *JSValkeyClient, thisValue: JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
        js.onconnectSetCached(thisValue, globalObject, value);
    }

    pub fn getOnClose(_: *JSValkeyClient, thisValue: JSValue, _: *jsc.JSGlobalObject) JSValue {
        if (js.oncloseGetCached(thisValue)) |value| {
            return value;
        }
        return .js_undefined;
    }

    pub fn setOnClose(_: *JSValkeyClient, thisValue: JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
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
        this.updateHasPendingActivity();

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
                const js_promise = promise.asPromise().?;
                if (this.client.flags.connection_promise_returns_client) {
                    debug("Resolving connection promise with client instance", .{});
                    const this_js = this.toJS(globalObject);
                    this_js.unprotect();
                    js_promise.resolve(globalObject, this_js);
                } else {
                    debug("Resolving connection promise with HELLO response", .{});
                    js_promise.resolve(globalObject, hello_value);
                }
                this.client.flags.connection_promise_returns_client = false;
            }
        }

        this.client.onWritable();
        this.updatePollRef();
    }

    pub fn onValkeySubscribe(this: *JSValkeyClient, value: *protocol.RESPValue) void {
        if (!this.isSubscriber()) {
            debug("onSubscribe called but client is not in subscriber mode", .{});
            return;
        }

        _ = value;

        this.client.onWritable();
        this.updatePollRef();
    }

    pub fn onValkeyUnsubscribe(this: *JSValkeyClient, value: *protocol.RESPValue) void {
        if (!this.isSubscriber()) {
            debug("onUnsubscribe called but client is not in subscriber mode", .{});
            return;
        }

        var subscription_ctx = this._subscription_ctx.?;

        // Check if we have any remaining subscriptions
        // If the callback map is empty, we can exit subscription mode
        if (!subscription_ctx.hasSubscriptions(this.globalObject)) {
            // No more subscriptions, exit subscription mode
            this.deleteSubscriptionCtx();
        }

        _ = value;

        this.client.onWritable();
        this.updatePollRef();
    }

    pub fn onValkeyMessage(this: *JSValkeyClient, value: []protocol.RESPValue) void {
        if (!this.isSubscriber()) {
            debug("onMessage called but client is not in subscriber mode", .{});
            return;
        }

        const globalObject = this.globalObject;
        const event_loop = this.client.vm.eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        // The message push should be an array with [channel, message]
        if (value.len < 2) {
            debug("Message array has insufficient elements: {}", .{value.len});
            return;
        }

        // Extract channel and message
        const channel_value = value[0].toJS(globalObject) catch {
            debug("Failed to convert channel to JS", .{});
            return;
        };
        const message_value = value[1].toJS(globalObject) catch {
            debug("Failed to convert message to JS", .{});
            return;
        };

        // Get the subscription context
        const subs_ctx = &(this._subscription_ctx orelse {
            debug("No subscription context found", .{});
            return;
        });

        // Invoke callbacks for this channel with message and channel as arguments
        subs_ctx.invokeCallback(
            globalObject,
            channel_value,
            &[_]JSValue{ message_value, channel_value },
        ) catch |e| {
            debug("Failed to invoke callbacks. Error: {}", .{e});
            this.failWithJSValue(globalObject.takeException(e));
        };

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

    pub fn hasPendingActivity(this: *JSValkeyClient) bool {
        // TODO(markovejnovic): Could this be .monotonic? My intuition says
        // yes, because none of the things that may be freed will actually be
        // read. The pointers don't move, so it should be safe, but I've
        // decided here to be conservative.
        return this.has_pending_activity.load(.acquire);
    }

    pub fn updateHasPendingActivity(this: *JSValkeyClient) void {
        if (this.client.hasAnyPendingCommands()) {
            this.has_pending_activity.store(true, .release);
            return;
        }

        if (this.channel_subscription_count > 0) {
            this.has_pending_activity.store(true, .release);
            return;
        }

        if (this.client.status != .connected and this.client.status != .disconnected) {
            this.has_pending_activity.store(true, .release);
            return;
        }

        this.has_pending_activity.store(false, .release);
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
        if (this._subscription_ctx) |*ctx| {
            ctx.deinit();
        }
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
        debug("Connecting to Redis.", .{});
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

    pub fn send(this: *JSValkeyClient, globalThis: *jsc.JSGlobalObject, this_jsvalue: JSValue, command: *const Command) !*jsc.JSPromise {
        if (this.client.flags.needs_to_open_socket) {
            @branchHint(.unlikely);

            if (this.this_value != .strong)
                this.this_value.setStrong(this_jsvalue, globalThis);

            this.connect() catch |err| {
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalThis.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, " {s} connecting to Valkey", .{@errorName(err)}).toJS();
                const promise = jsc.JSPromise.create(globalThis);
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
    pub const duplicate = fns.duplicate;
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
                                this.updateHasPendingActivity();
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
    pub fn fromJS(globalObject: *jsc.JSGlobalObject, options_obj: jsc.JSValue) !valkey.Options {
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
                if (try jsc.API.ServerConfig.SSLConfig.fromJS(globalObject.bunVM(), globalObject, tls)) |ssl_config| {
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

const debug = bun.Output.scoped(.RedisJS, .visible);

const Command = @import("./ValkeyCommand.zig");
const std = @import("std");
const valkey = @import("./valkey.zig");

const protocol = @import("./valkey_protocol.zig");
const RedisError = protocol.RedisError;

const bun = @import("bun");
const BoringSSL = bun.BoringSSL;
const String = bun.String;
const Timer = bun.api.Timer;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;

const uws = bun.uws;
const Socket = uws.AnySocket;
