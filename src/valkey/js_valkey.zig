pub const SubscriptionCtx = struct {
    const Self = @This();

    is_subscriber: bool,
    original_enable_offline_queue: bool,
    original_enable_auto_pipelining: bool,

    const ParentJS = JSValkeyClient.js;

    pub fn init(valkey_parent: *JSValkeyClient) bun.JSError!Self {
        const callback_map = jsc.JSMap.create(valkey_parent.globalObject);
        const parent_this = valkey_parent.this_value.tryGet() orelse unreachable;

        ParentJS.gc.set(.subscriptionCallbackMap, parent_this, valkey_parent.globalObject, callback_map);

        const self = Self{
            .original_enable_offline_queue = valkey_parent.client.flags.enable_offline_queue,
            .original_enable_auto_pipelining = valkey_parent.client.flags.enable_auto_pipelining,
            .is_subscriber = false,
        };
        return self;
    }

    fn parent(this: *SubscriptionCtx) *JSValkeyClient {
        return @alignCast(@fieldParentPtr("_subscription_ctx", this));
    }

    fn subscriptionCallbackMap(this: *Self) *jsc.JSMap {
        const parent_this = this.parent().this_value.tryGet() orelse unreachable;

        const value_js = ParentJS.gc.get(.subscriptionCallbackMap, parent_this).?;
        return jsc.JSMap.fromJS(value_js).?;
    }

    /// Get the total number of channels that this subscription context is subscribed to.
    pub fn channelsSubscribedToCount(this: *Self, globalObject: *jsc.JSGlobalObject) bun.JSError!u32 {
        const count = try this.subscriptionCallbackMap().size(globalObject);

        return count;
    }

    /// Test whether this context has any subscriptions. It is mandatory to
    /// guard deinit with this function.
    pub fn hasSubscriptions(this: *Self, globalObject: *jsc.JSGlobalObject) bun.JSError!bool {
        return (try this.channelsSubscribedToCount(globalObject)) > 0;
    }

    pub fn clearReceiveHandlers(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
    ) bun.JSError!void {
        const map = this.subscriptionCallbackMap();
        _ = try map.remove(globalObject, channelName);
    }

    pub fn clearAllReceiveHandlers(this: *Self, globalObject: *jsc.JSGlobalObject) bun.JSError!void {
        try this.subscriptionCallbackMap().clear(globalObject);
    }

    /// Remove a specific receive handler.
    ///
    /// Returns: The total number of remaining handlers for this channel, or null if here were no listeners originally
    /// registered.
    ///
    /// Note: This function will empty out the map entry if there are no more handlers registered.
    pub fn removeReceiveHandler(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
        callback: JSValue,
    ) !?usize {
        const map = this.subscriptionCallbackMap();

        const existing = try map.get(globalObject, channelName);
        if (existing.isUndefinedOrNull()) {
            // Nothing to remove.
            return null;
        }

        // Existing is guaranteed to be an array of callbacks.
        // This check is necessary because crossing between Zig and C++ is necessary because Zig doesn't know that C++
        // is side-effect-free.
        if (comptime bun.Environment.isDebug) {
            bun.assert(existing.isArray());
        }

        // TODO(markovejnovic): I can't find a better way to do this... I generate a new array,
        // filtering out the callback we want to remove. This is woefully inefficient for large
        // sets (and surprisingly fast for small sets of callbacks).
        //
        // Perhaps there is an avenue to build a generic iterator pattern? @taylor.fish and I have
        // briefly expressed a desire for this, and I promised her I would look into it, but at
        // this moment have no proposal.
        var array_it = try existing.arrayIterator(globalObject);
        const updated_array = try jsc.JSArray.createEmpty(globalObject, 0);
        while (try array_it.next()) |iter| {
            if (iter == callback)
                continue;

            try updated_array.push(globalObject, iter);
        }

        // Otherwise, we have ourselves an array of callbacks. We need to remove the element in the
        // array that matches the callback.
        _ = try map.remove(globalObject, channelName);

        // Only populate the map if we have remaining callbacks for this channel.
        const new_length = try updated_array.getLength(globalObject);

        if (new_length != 0) {
            try map.set(globalObject, channelName, updated_array);
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
        defer this.parent().onNewSubscriptionCallbackInsert();
        const map = this.subscriptionCallbackMap();

        var handlers_array: JSValue = .js_undefined;
        var is_new_channel = false;
        const existing_handler_arr = try map.get(globalObject, channelName);
        if (existing_handler_arr != .js_undefined) {
            debug("Adding a new receive handler.", .{});
            // Note that we need to cover this case because maps in JSC can return undefined when the key has never been
            // set.
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

        // Append the new callback to the array
        try handlers_array.push(globalObject, callback);

        // Set the updated array back in the map
        try map.set(globalObject, channelName, handlers_array);
    }

    pub fn getCallbacks(this: *Self, globalObject: *jsc.JSGlobalObject, channelName: JSValue) bun.JSError!?JSValue {
        const result = try this.subscriptionCallbackMap().get(globalObject, channelName);
        if (result == .js_undefined) {
            return null;
        }

        return result;
    }

    /// Invoke callbacks for a channel with the given arguments
    /// Handles both single callbacks and arrays of callbacks
    pub fn invokeCallbacks(
        this: *Self,
        globalObject: *jsc.JSGlobalObject,
        channelName: JSValue,
        args: []const JSValue,
    ) bun.JSError!void {
        const callbacks = try this.getCallbacks(globalObject, channelName) orelse {
            debug("No callbacks found for channel {f}", .{channelName.asString().getZigString(globalObject)});
            return;
        };

        if (comptime bun.Environment.isDebug) {
            bun.assert(callbacks.isArray());
        }

        const vm = jsc.VirtualMachine.get();
        const event_loop = vm.eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        // After we go through every single callback, we will have to update the poll ref.
        // The user may, for example, unsubscribe in the callbacks, or even stop the client.
        defer this.parent().updatePollRef();

        // If callbacks is an array, iterate and call each one
        var iter = try callbacks.arrayIterator(globalObject);
        while (try iter.next()) |callback| {
            if (comptime bun.Environment.isDebug) {
                bun.assert(callback.isCallable());
            }

            event_loop.runCallback(callback, globalObject, .js_undefined, args);
        }
    }

    /// Return whether the subscription context is ready to be deleted by the JS garbage collector.
    pub fn isDeletable(this: *Self, global_object: *jsc.JSGlobalObject) bun.JSError!bool {
        // The user may request .close(), in which case we can dispose of the subscription object. If that is the case,
        // finalized will be true. Otherwise, we should treat the object as disposable if there are no active
        // subscriptions.
        return this.parent().client.flags.finalized or !(try this.hasSubscriptions(global_object));
    }

    pub fn deinit(this: *Self, global_object: *jsc.JSGlobalObject) void {
        if (comptime bun.Environment.isDebug) {
            bun.debugAssert(this.isDeletable(this.parent().globalObject) catch unreachable);
        }

        if (this.parent().this_value.tryGet()) |parent_this| {
            ParentJS.gc.set(.subscriptionCallbackMap, parent_this, global_object, .js_undefined);
        }
    }
};

/// Valkey client wrapper for JavaScript
pub const JSValkeyClient = struct {
    client: valkey.ValkeyClient,
    globalObject: *jsc.JSGlobalObject,
    this_value: jsc.JSRef = jsc.JSRef.empty(),
    poll_ref: bun.Async.KeepAlive = .{},

    _subscription_ctx: SubscriptionCtx,
    _socket_ctx: ?*uws.SocketContext = null,

    timer: Timer.EventLoopTimer = .{
        .tag = .ValkeyConnectionTimeout,
        .next = .epoch,
    },
    reconnect_timer: Timer.EventLoopTimer = .{
        .tag = .ValkeyConnectionReconnect,
        .next = .epoch,
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
    pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, js_this: JSValue) bun.JSError!*JSValkeyClient {
        return try create(globalObject, callframe.arguments(), js_this);
    }

    /// Create a Valkey client that does not have an associated JS object nor a SubscriptionCtx.
    ///
    /// This whole client needs a refactor.
    pub fn createNoJsNoPubsub(globalObject: *jsc.JSGlobalObject, arguments: []const JSValue) bun.JSError!*JSValkeyClient {
        const this_allocator = bun.default_allocator;

        const vm = globalObject.bunVM();

        const url_str = if (arguments.len >= 1 and !arguments[0].isUndefinedOrNull())
            try arguments[0].toBunString(globalObject)
        else if (vm.transpiler.env.get("REDIS_URL") orelse vm.transpiler.env.get("VALKEY_URL")) |url|
            bun.String.init(url)
        else
            bun.String.static("valkey://localhost:6379");
        defer url_str.deref();
        var fallback_url_buf: [2048]u8 = undefined;

        // Parse and validate the URL using URL.zig's fromString which returns null for invalid URLs
        // TODO(markovejnovic): The following check for :// is a stop-gap. It is my expectation
        // that URL.fromString returns null if the protocol is not specified. This is not, in-fact,
        // the case right now and I do not understand why. It will take some work in JSC to
        // understand why this is happening, but since I need to uncork valkey, I'm adding this as
        // a stop-gap.
        const parsed_url = get_url: {
            const url_slice = url_str.toUTF8WithoutRef(this_allocator);
            defer url_slice.deinit();

            const url_byte_slice = url_slice.slice();

            if (url_byte_slice.len == 0) {
                return globalObject.throwInvalidArguments("Invalid URL format", .{});
            }

            if (bun.strings.contains(url_byte_slice, "://")) {
                break :get_url URL.fromString(url_str) orelse {
                    return globalObject.throwInvalidArguments("Invalid URL format", .{});
                };
            }

            const corrected_url = get_url_slice: {
                const written = std.fmt.bufPrintZ(
                    &fallback_url_buf,
                    "valkey://{s}",
                    .{url_byte_slice},
                ) catch {
                    return globalObject.throwInvalidArguments("URL is too long.", .{});
                };

                break :get_url_slice fallback_url_buf[0..written.len];
            };

            break :get_url URL.fromUTF8(corrected_url) orelse {
                return globalObject.throwInvalidArguments("Invalid URL format", .{});
            };
        };
        defer parsed_url.deinit();

        // Extract protocol string
        const protocol_str = parsed_url.protocol();
        defer protocol_str.deref();
        const protocol_utf8 = protocol_str.toUTF8WithoutRef(this_allocator);
        defer protocol_utf8.deinit();
        // Remove the trailing ':' from protocol (e.g., "redis:" -> "redis")
        const protocol_slice = if (protocol_utf8.slice().len > 0 and protocol_utf8.slice()[protocol_utf8.slice().len - 1] == ':')
            protocol_utf8.slice()[0 .. protocol_utf8.slice().len - 1]
        else
            protocol_utf8.slice();

        const uri: valkey.Protocol = if (protocol_slice.len > 0)
            valkey.Protocol.Map.get(protocol_slice) orelse return globalObject.throw("Expected url protocol to be one of redis, valkey, rediss, valkeys, redis+tls, redis+unix, redis+tls+unix", .{})
        else
            .standalone;

        // Extract all URL components
        const username_str = parsed_url.username();
        defer username_str.deref();
        const username_utf8 = username_str.toUTF8WithoutRef(this_allocator);
        defer username_utf8.deinit();

        const password_str = parsed_url.password();
        defer password_str.deref();
        const password_utf8 = password_str.toUTF8WithoutRef(this_allocator);
        defer password_utf8.deinit();

        const hostname_str = parsed_url.host();
        defer hostname_str.deref();
        const hostname_utf8 = hostname_str.toUTF8WithoutRef(this_allocator);
        defer hostname_utf8.deinit();

        const pathname_str = parsed_url.pathname();
        defer pathname_str.deref();
        const pathname_utf8 = pathname_str.toUTF8WithoutRef(this_allocator);
        defer pathname_utf8.deinit();

        // Determine hostname based on protocol type
        const hostname_slice = switch (uri) {
            .standalone_tls, .standalone => hostname_utf8.slice(),
            .standalone_unix, .standalone_tls_unix => brk: {
                // For unix sockets, the path is in the pathname
                if (pathname_utf8.slice().len == 0) {
                    return globalObject.throwInvalidArguments("Expected unix socket path after valkey+unix:// or valkey+tls+unix://", .{});
                }
                break :brk pathname_utf8.slice();
            },
        };

        const port = switch (uri) {
            .standalone_unix, .standalone_tls_unix => 0,
            else => brk: {
                const port_value = parsed_url.port();
                // URL.port() returns std.math.maxInt(u32) if port is not set
                if (port_value == std.math.maxInt(u32)) {
                    // No port specified, use default
                    break :brk 6379;
                } else {
                    // Port was explicitly specified
                    if (port_value == 0) {
                        // Port 0 is invalid for TCP connections (though it's allowed for unix sockets)
                        return globalObject.throwInvalidArguments("Port 0 is not valid for TCP connections", .{});
                    }
                    if (port_value > 65535) {
                        return globalObject.throwInvalidArguments("Invalid port number in URL. Port must be a number between 0 and 65535", .{});
                    }
                    break :brk @as(u16, @intCast(port_value));
                }
            },
        };

        const options = if (arguments.len >= 2 and !arguments[1].isUndefinedOrNull() and arguments[1].isObject())
            try Options.fromJS(globalObject, arguments[1])
        else
            valkey.Options{};

        // Copy strings into a persistent buffer since the URL object will be deinitialized
        var connection_strings: []u8 = &.{};
        var username: []const u8 = "";
        var password: []const u8 = "";
        var hostname: []const u8 = "";

        errdefer if (connection_strings.len != 0) this_allocator.free(connection_strings);

        if (username_utf8.slice().len > 0 or password_utf8.slice().len > 0 or hostname_slice.len > 0) {
            var b = bun.StringBuilder{};
            b.count(username_utf8.slice());
            b.count(password_utf8.slice());
            b.count(hostname_slice);
            try b.allocate(this_allocator);
            defer b.deinit(this_allocator);
            username = b.append(username_utf8.slice());
            password = b.append(password_utf8.slice());
            hostname = b.append(hostname_slice);
            b.moveToSlice(&connection_strings);
        }

        // Parse database number from pathname (e.g., "/1" -> database 1)
        const database = if (pathname_utf8.slice().len > 1)
            std.fmt.parseInt(u32, pathname_utf8.slice()[1..], 10) catch 0
        else
            0;

        bun.analytics.Features.valkey += 1;

        return JSValkeyClient.new(.{
            .ref_count = .init(),
            ._subscription_ctx = undefined,
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
                .tls = if (options.tls != .none) options.tls else if (uri.isTLS()) .enabled else .none,
                .database = database,
                .allocator = this_allocator,
                .flags = .{
                    .enable_auto_reconnect = options.enable_auto_reconnect,
                    .enable_offline_queue = options.enable_offline_queue,
                    .enable_auto_pipelining = options.enable_auto_pipelining,
                },
                .max_retries = options.max_retries,
                .connection_timeout_ms = options.connection_timeout_ms,
                .idle_timeout_interval_ms = options.idle_timeout_ms,
            },
            .globalObject = globalObject,
        });
    }

    pub fn create(globalObject: *jsc.JSGlobalObject, arguments: []const JSValue, js_this: JSValue) bun.JSError!*JSValkeyClient {
        var new_client = try JSValkeyClient.createNoJsNoPubsub(globalObject, arguments);

        // Initially, we only need to hold a weak reference to the JS object.
        new_client.this_value = jsc.JSRef.initWeak(js_this);

        // Need to associate the subscription context, after the JS ref has been populated.
        new_client._subscription_ctx = try SubscriptionCtx.init(new_client);

        return new_client;
    }

    /// Clone this client while remaining in the initial disconnected state.
    ///
    /// Note that this does not create an object with an associated this_value.
    /// You may need to populate it yourself.
    pub fn cloneWithoutConnecting(
        this: *const JSValkeyClient,
        globalObject: *jsc.JSGlobalObject,
    ) bun.OOM!*JSValkeyClient {
        const vm = globalObject.bunVM();

        // Make a copy of connection_strings to avoid double-free
        const connection_strings_copy = try this.client.allocator.dupe(u8, this.client.connection_strings);

        // Note that there is no need to copy username, password and address since the copies live
        // within the connection_strings buffer.
        const base_ptr = this.client.connection_strings.ptr;
        const new_base = connection_strings_copy.ptr;
        const username = bun.memory.rebaseSlice(this.client.username, base_ptr, new_base);
        const password = bun.memory.rebaseSlice(this.client.password, base_ptr, new_base);
        const orig_hostname = this.client.address.hostname();
        const hostname = bun.memory.rebaseSlice(orig_hostname, base_ptr, new_base);
        const new_alloc = this.client.allocator;
        // TODO: we could ref count it instead of cloning it
        const tls: valkey.TLS = this.client.tls.clone();

        return JSValkeyClient.new(.{
            .ref_count = .init(),
            ._subscription_ctx = undefined,
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
                .in_flight = .init(new_alloc),
                .queue = .init(new_alloc),
                .status = .disconnected,
                .connection_strings = connection_strings_copy,
                .socket = .{
                    .SocketTCP = .{
                        .socket = .{
                            .detached = {},
                        },
                    },
                },
                .tls = tls,
                .database = this.client.database,
                .allocator = new_alloc,
                .flags = .{
                    // Because this starts in the disconnected state, we need to reset some flags.
                    .is_authenticated = false,
                    // If the user manually closed the connection, then duplicating a closed client
                    // means the new client remains finalized.
                    .is_manually_closed = this.client.flags.is_manually_closed,
                    .enable_offline_queue = if (this._subscription_ctx.is_subscriber)
                        this._subscription_ctx.original_enable_offline_queue
                    else
                        this.client.flags.enable_offline_queue,
                    .needs_to_open_socket = true,
                    .enable_auto_reconnect = this.client.flags.enable_auto_reconnect,
                    .is_reconnecting = false,
                    .enable_auto_pipelining = if (this._subscription_ctx.is_subscriber)
                        this._subscription_ctx.original_enable_auto_pipelining
                    else
                        this.client.flags.enable_auto_pipelining,
                    // Duplicating a finalized client means it stays finalized.
                    .finalized = this.client.flags.finalized,
                },
                .max_retries = this.client.max_retries,
                .connection_timeout_ms = this.client.connection_timeout_ms,
                .idle_timeout_interval_ms = this.client.idle_timeout_interval_ms,
            },
            .globalObject = globalObject,
        });
    }

    pub fn addSubscription(this: *JSValkeyClient) void {
        debug("addSubscription: entering, current subscriber state: {}", .{this._subscription_ctx.is_subscriber});
        bun.debugAssert(this.client.status == .connected);
        this.ref();
        defer this.deref();

        if (!this._subscription_ctx.is_subscriber) {
            this._subscription_ctx.original_enable_offline_queue = this.client.flags.enable_offline_queue;
            this._subscription_ctx.original_enable_auto_pipelining = this.client.flags.enable_auto_pipelining;
            debug("addSubscription: calling updatePollRef", .{});
            this.updatePollRef();
        }

        this._subscription_ctx.is_subscriber = true;
        debug("addSubscription: exiting, new subscriber state: {}", .{this._subscription_ctx.is_subscriber});
    }

    pub fn removeSubscription(this: *JSValkeyClient) void {
        debug("removeSubscription: entering, has subscriptions: {}", .{this._subscription_ctx.hasSubscriptions(this.globalObject) catch false});
        this.ref();
        defer this.deref();

        // This is the last subscription, restore original flags
        if (!(this._subscription_ctx.hasSubscriptions(this.globalObject) catch false)) {
            this.client.flags.enable_offline_queue = this._subscription_ctx.original_enable_offline_queue;
            this.client.flags.enable_auto_pipelining = this._subscription_ctx.original_enable_auto_pipelining;
            this._subscription_ctx.is_subscriber = false;
            debug("removeSubscription: calling updatePollRef", .{});
            this.updatePollRef();
        }
        debug("removeSubscription: exiting", .{});
    }

    pub fn getOrCreateSubscriptionCtx(
        this: *JSValkeyClient,
    ) bun.JSError!*SubscriptionCtx {
        if (this._subscription_ctx) |*ctx| {
            // If we already have a subscription context, return it
            return ctx;
        }

        // Save the original flag values and create a new subscription context
        this._subscription_ctx = try SubscriptionCtx.init(
            this,
            this.client.flags.enable_offline_queue,
            this.client.flags.enable_auto_pipelining,
        );

        // We need to make sure we disable the offline queue, but we actually want to make sure that our HELLO message
        // goes through first. Consequently, we only disable the offline queue if we're already connected.
        if (this.client.status == .connected) {
            this.client.flags.enable_offline_queue = false;
        }

        this.client.flags.enable_auto_pipelining = false;

        return &(this._subscription_ctx.?);
    }

    pub fn isSubscriber(this: *const JSValkeyClient) bool {
        return this._subscription_ctx.is_subscriber;
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
            return jsc.JSPromise.resolvedPromiseValue(globalObject, js.helloGetCached(this_value) orelse .js_undefined);
        }

        if (js.connectionPromiseGetCached(this_value)) |promise| {
            return promise;
        }

        const promise_ptr = jsc.JSPromise.create(globalObject);
        const promise = promise_ptr.toJS();
        js.connectionPromiseSetCached(this_value, globalObject, promise);

        // If was manually closed, reset that flag
        this.client.flags.is_manually_closed = false;
        defer this.updatePollRef();

        if (this.client.flags.needs_to_open_socket) {
            this.poll_ref.ref(this.client.vm);

            this.connect() catch |err| {
                this.poll_ref.unref(this.client.vm);
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalObject.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, " {s} connecting to Valkey", .{@errorName(err)}).toJS();
                const event_loop = this.client.vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();
                try promise_ptr.reject(globalObject, err_value);
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
        timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(next_timeout_ms));
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

            // this.addTimer() adds a reference to 'this' when the timer is
            // alive which is balanced here.
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

    pub fn onConnectionTimeout(this: *JSValkeyClient) void {
        debug("onConnectionTimeout", .{});

        // Mark timer as fired
        this.timer.state = .FIRED;

        // Increment ref to ensure 'this' stays alive throughout the function
        this.ref();
        defer this.deref();
        if (this.client.flags.failed) {
            return;
        }

        if (this.client.getTimeoutInterval() == 0) {
            this.resetConnectionTimeout();
            return;
        }

        var buf: [128]u8 = undefined;
        switch (this.client.status) {
            .connected => {
                const msg = std.fmt.bufPrintZ(&buf, "Idle timeout reached after {d}ms", .{this.client.idle_timeout_interval_ms}) catch unreachable;
                this.clientFail(msg, protocol.RedisError.IdleTimeout) catch {}; // TODO: properly propagate exception upwards
            },
            .disconnected, .connecting => {
                const msg = std.fmt.bufPrintZ(&buf, "Connection timeout reached after {d}ms", .{this.client.connection_timeout_ms}) catch unreachable;
                this.clientFail(msg, protocol.RedisError.ConnectionTimeout) catch {}; // TODO: properly propagate exception upwards
            },
        }
    }

    pub fn onReconnectTimer(this: *JSValkeyClient) void {
        debug("Reconnect timer fired, attempting to reconnect", .{});

        // Mark timer as fired and store important values before doing any derefs
        this.reconnect_timer.state = .FIRED;

        // Increment ref to ensure 'this' stays alive throughout the function
        this.ref();
        defer this.deref();

        // Execute reconnection logic
        this.reconnect();
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
    pub fn onValkeyConnect(this: *JSValkeyClient, value: *protocol.RESPValue) bun.JSTerminated!void {
        bun.debugAssert(this.client.status == .connected);
        // we should always have a strong reference to the object here
        bun.debugAssert(this.this_value.isStrong());

        defer {
            this.client.onWritable();
            // update again after running the callback
            this.updatePollRef();
        }
        const globalObject = this.globalObject;
        const event_loop = this.client.vm.eventLoop();
        event_loop.enter();
        defer event_loop.exit();

        if (this.this_value.tryGet()) |this_value| {
            const hello_value: JSValue = js_hello: {
                break :js_hello value.toJS(globalObject) catch |err| {
                    // TODO: how should we handle this? old code ignore the exception instead of cleaning it up
                    // now we clean it up, and behave the same as old code
                    _ = globalObject.takeException(err);
                    break :js_hello .js_undefined;
                };
            };
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
                    try js_promise.resolve(globalObject, this_value);
                } else {
                    debug("Resolving connection promise with HELLO response", .{});
                    try js_promise.resolve(globalObject, hello_value);
                }
                this.client.flags.connection_promise_returns_client = false;
            }
        }
    }

    /// Invoked when the Valkey client receives a new listener.
    ///
    /// `SubscriptionCtx` will invoke this to communicate that it has added a new listener.
    pub fn onNewSubscriptionCallbackInsert(this: *JSValkeyClient) void {
        this.ref();
        defer this.deref();

        this.client.onWritable();
        this.updatePollRef();
    }

    pub fn onValkeySubscribe(this: *JSValkeyClient, value: *protocol.RESPValue) void {
        bun.debugAssert(this.isSubscriber());
        bun.debugAssert(this.this_value.isStrong());

        this.ref();
        defer this.deref();

        _ = value;

        this.client.onWritable();
        this.updatePollRef();
    }

    pub fn onValkeyUnsubscribe(this: *JSValkeyClient) bun.JSError!void {
        bun.debugAssert(this.isSubscriber());
        bun.debugAssert(this.this_value.isStrong());

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

        // Invoke callbacks for this channel with message and channel as arguments
        this._subscription_ctx.invokeCallbacks(
            globalObject,
            channel_value,
            &[_]JSValue{ message_value, channel_value },
        ) catch {
            return;
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
    pub fn onValkeyClose(this: *JSValkeyClient) bun.JSTerminated!void {
        const globalObject = this.globalObject;

        defer {
            // Update poll reference to allow garbage collection of disconnected clients
            this.updatePollRef();
            this.deref();
        }

        const this_jsvalue = this.this_value.tryGet() orelse return;
        this_jsvalue.ensureStillAlive();

        // Create an error value
        const error_value = protocol.valkeyErrorToJS(globalObject, "Connection closed", protocol.RedisError.ConnectionClosed);

        const loop = this.client.vm.eventLoop();
        loop.enter();
        defer loop.exit();

        if (!this_jsvalue.isUndefined()) {
            if (js.connectionPromiseGetCached(this_jsvalue)) |promise| {
                js.connectionPromiseSetCached(this_jsvalue, globalObject, .zero);
                try promise.asPromise().?.reject(globalObject, error_value);
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

    pub fn clientFail(this: *JSValkeyClient, message: []const u8, err: protocol.RedisError) bun.JSTerminated!void {
        try this.client.fail(message, err);
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

    fn closeSocketNextTick(this: *JSValkeyClient) void {
        if (this.client.socket.isClosed()) return;

        this.ref();
        // socket close can potentially call JS so we need to enqueue the deinit
        const Holder = struct {
            ctx: *JSValkeyClient,
            task: jsc.AnyTask,

            pub fn run(self: *@This()) void {
                defer bun.default_allocator.destroy(self);

                self.ctx.client.close();
                self.ctx.deref();
            }
        };
        var holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .ctx = this,
            .task = undefined,
        };
        holder.task = jsc.AnyTask.New(Holder, Holder.run).init(holder);

        this.client.vm.enqueueTask(jsc.Task.init(&holder.task));
    }

    pub fn finalize(this: *JSValkeyClient) void {
        defer this.deref();

        this.stopTimers();
        this.this_value.finalize();
        this.client.flags.finalized = true;
        this.closeSocketNextTick();
        // We do not need to free the subscription context here because we're
        // guaranteed to have freed it by virtue of the fact that we are
        // garbage collected now and the subscription context holds a reference
        // to us. If we still had a subscription context, we would never be
        // garbage collected.
        bun.debugAssert(!this._subscription_ctx.is_subscriber);
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

    fn failWithInvalidSocketContext(this: *JSValkeyClient) bun.JSTerminated!void {
        // if the context is invalid is not worth retrying
        this.client.flags.enable_auto_reconnect = false;
        try this.clientFail(if (this.client.tls == .none) "Failed to create TCP context" else "Failed to create TLS context", protocol.RedisError.ConnectionClosed);
        try this.client.onValkeyClose();
    }

    fn connect(this: *JSValkeyClient) !void {
        this.client.flags.needs_to_open_socket = false;
        const vm = this.client.vm;

        this.ref();
        defer this.deref();
        const ctx: *uws.SocketContext, const own_ctx: bool =
            switch (this.client.tls) {
                .none => .{
                    vm.rareData().valkey_context.tcp orelse brk_ctx: {
                        // TCP socket
                        const ctx_ = uws.SocketContext.createNoSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient)) orelse {
                            try this.failWithInvalidSocketContext();
                            this.client.status = .disconnected;
                            return;
                        };
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
                        const ctx_ = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient), uws.SocketContext.BunSocketContextOptions{}, &err) orelse {
                            try this.failWithInvalidSocketContext();
                            this.client.status = .disconnected;
                            return;
                        };
                        uws.NewSocketHandler(true).configure(ctx_, true, *JSValkeyClient, SocketHandler(true));
                        vm.rareData().valkey_context.tls = ctx_;
                        break :brk_ctx ctx_;
                    },
                    false,
                },
                .custom => |*custom| brk_ctx: {
                    if (this._socket_ctx) |ctx| {
                        break :brk_ctx .{ ctx, true };
                    }
                    // TLS socket, custom config
                    var err: uws.create_bun_socket_error_t = .none;
                    const options = custom.asUSockets();

                    const ctx_ = uws.SocketContext.createSSLContext(vm.uwsLoop(), @sizeOf(*JSValkeyClient), options, &err) orelse {
                        try this.failWithInvalidSocketContext();
                        this.client.status = .disconnected;
                        return;
                    };
                    uws.NewSocketHandler(true).configure(ctx_, true, *JSValkeyClient, SocketHandler(true));
                    break :brk_ctx .{ ctx_, true };
                },
            };
        this.ref();

        if (own_ctx) {
            // save the context so we deinit it later (if we reconnect we can reuse the same context)
            this._socket_ctx = ctx;
        }
        this.client.status = .connecting;
        this.updatePollRef();

        errdefer {
            this.client.status = .disconnected;
            this.updatePollRef();
        }
        this.client.socket = try this.client.address.connect(&this.client, ctx, this.client.tls != .none);
    }

    pub fn send(this: *JSValkeyClient, globalThis: *jsc.JSGlobalObject, _: JSValue, command: *const Command) !*jsc.JSPromise {
        if (this.client.flags.needs_to_open_socket) {
            @branchHint(.unlikely);

            this.connect() catch |err| {
                this.client.flags.needs_to_open_socket = true;
                const err_value = globalThis.ERR(.SOCKET_CLOSED_BEFORE_CONNECTION, " {s} connecting to Valkey", .{@errorName(err)}).toJS();
                const promise = jsc.JSPromise.create(globalThis);
                const event_loop = this.client.vm.eventLoop();
                event_loop.enter();
                defer event_loop.exit();
                try promise.reject(globalThis, err_value);
                return promise;
            };
            this.resetConnectionTimeout();
        }

        defer this.updatePollRef();
        return try this.client.send(globalThis, command);
    }

    // Getter for memory cost - useful for diagnostics
    pub fn memoryCost(this: *JSValkeyClient) usize {
        // TODO(markovejnovic): This is most-likely wrong because I didn't know better.
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

    fn deinitSocketContextNextTick(this: *JSValkeyClient) void {
        const ctx = this._socket_ctx orelse return;
        this._socket_ctx = null;
        // socket close can potentially call JS so we need to enqueue the deinit
        // this should only be the case tls socket with custom config
        const Holder = struct {
            ctx: *uws.SocketContext,
            task: jsc.AnyTask,

            pub fn run(self: *@This()) void {
                defer bun.default_allocator.destroy(self);
                self.ctx.deinit(true);
            }
        };
        var holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .ctx = ctx,
            .task = undefined,
        };
        holder.task = jsc.AnyTask.New(Holder, Holder.run).init(holder);

        this.client.vm.enqueueTask(jsc.Task.init(&holder.task));
    }

    fn deinit(this: *JSValkeyClient) void {
        bun.debugAssert(this.client.socket.isClosed());
        this.deinitSocketContextNextTick();
        this.client.deinit(null);
        this.poll_ref.disable();
        this.stopTimers();
        this.ref_count.assertNoRefs();

        bun.destroy(this);
    }

    /// Keep the event loop alive, or don't keep it alive
    ///
    /// This requires this_value to be alive.
    pub fn updatePollRef(this: *JSValkeyClient) void {
        // TODO(markovejnovic): This function is such a crazy cop out. We really
        // should be treating valkey as a state machine, with well-defined
        // state and modes in which it tracks and manages its own lifecycle.
        // This is a mess beyond belief and it is incredibly fragile.
        const has_pending_commands = this.client.hasAnyPendingCommands();

        // isDeletable may throw an exception, and if it does, we have to assume
        // that the object still has references. Best we can do is hope nothing
        // catastrophic happens.
        const subs_deletable: bool = !(this._subscription_ctx.hasSubscriptions(this.globalObject) catch false);

        const has_activity = has_pending_commands or !subs_deletable or this.client.flags.is_reconnecting;

        // There's a couple cases to handle here:
        if (has_activity or this.client.status == .connecting) {
            // If we currently have pending activity or we are connecting, we need to keep the event
            // loop alive.
            this.poll_ref.ref(this.client.vm);
        } else {
            // There is no pending activity so it is safe to remove the event
            // loop.
            this.poll_ref.unref(this.client.vm);
        }

        if (this.this_value.isEmpty()) {
            return;
        }

        // Orthogonal to this, we need to manage the strong reference to the JS
        // object.
        switch (this.client.status) {
            .connecting, .connected => {
                // Whenever we're connected, we need to keep the object alive.
                //
                // TODO(markovejnovic): This is a leak.
                // Note this is an intentional leak. Unless the user manually
                // closes the connection, the object will stay alive forever,
                // even if it falls out of scope. This is kind of stupid, since
                // if the object is out of scope, and isn't subscribed upon,
                // how exactly is the user going to call anything on the object?
                //
                // It is 100% safe to drop the strong reference there and let
                // the object be GC'd, but we're not doing that now.
                debug("upgrading this_value since we are connected/connecting", .{});
                this.this_value.upgrade(this.globalObject);
            },
            .disconnected => {
                // If we're disconnected, we need to check if we have
                // any pending activity.
                if (has_activity) {
                    debug("upgrading this_value since there is pending activity", .{});
                    // If we have pending activity, we need to keep the object
                    // alive.
                    this.this_value.upgrade(this.globalObject);
                } else {
                    debug("downgrading this_value since there is no pending activity", .{});
                    // If we don't have any pending activity, we can drop the
                    // strong reference.
                    this.this_value.downgrade();
                }
            },
        }
    }

    pub const jsSend = fns.jsSend;
    pub const @"type" = fns.type;
    pub const append = fns.append;
    pub const bitcount = fns.bitcount;
    pub const blpop = fns.blpop;
    pub const brpop = fns.brpop;
    pub const copy = fns.copy;
    pub const decr = fns.decr;
    pub const decrby = fns.decrby;
    pub const del = fns.del;
    pub const dump = fns.dump;
    pub const duplicate = fns.duplicate;
    pub const exists = fns.exists;
    pub const expire = fns.expire;
    pub const expireat = fns.expireat;
    pub const expiretime = fns.expiretime;
    pub const get = fns.get;
    pub const getBuffer = fns.getBuffer;
    pub const getbit = fns.getbit;
    pub const getdel = fns.getdel;
    pub const getex = fns.getex;
    pub const getrange = fns.getrange;
    pub const getset = fns.getset;
    pub const hgetall = fns.hgetall;
    pub const hget = fns.hget;
    pub const hincrby = fns.hincrby;
    pub const hincrbyfloat = fns.hincrbyfloat;
    pub const hkeys = fns.hkeys;
    pub const hdel = fns.hdel;
    pub const hexists = fns.hexists;
    pub const hgetdel = fns.hgetdel;
    pub const hgetex = fns.hgetex;
    pub const hlen = fns.hlen;
    pub const hmget = fns.hmget;
    pub const hmset = fns.hmset;
    pub const hrandfield = fns.hrandfield;
    pub const hscan = fns.hscan;
    pub const hset = fns.hset;
    pub const hsetex = fns.hsetex;
    pub const hsetnx = fns.hsetnx;
    pub const hstrlen = fns.hstrlen;
    pub const hvals = fns.hvals;
    pub const hexpire = fns.hexpire;
    pub const hexpireat = fns.hexpireat;
    pub const hexpiretime = fns.hexpiretime;
    pub const hpersist = fns.hpersist;
    pub const hpexpire = fns.hpexpire;
    pub const hpexpireat = fns.hpexpireat;
    pub const hpexpiretime = fns.hpexpiretime;
    pub const hpttl = fns.hpttl;
    pub const httl = fns.httl;
    pub const incr = fns.incr;
    pub const incrby = fns.incrby;
    pub const incrbyfloat = fns.incrbyfloat;
    pub const keys = fns.keys;
    pub const lindex = fns.lindex;
    pub const linsert = fns.linsert;
    pub const llen = fns.llen;
    pub const lmove = fns.lmove;
    pub const lmpop = fns.lmpop;
    pub const lpop = fns.lpop;
    pub const lpos = fns.lpos;
    pub const lpush = fns.lpush;
    pub const lpushx = fns.lpushx;
    pub const lrange = fns.lrange;
    pub const lrem = fns.lrem;
    pub const lset = fns.lset;
    pub const ltrim = fns.ltrim;
    pub const mget = fns.mget;
    pub const mset = fns.mset;
    pub const msetnx = fns.msetnx;
    pub const persist = fns.persist;
    pub const pexpire = fns.pexpire;
    pub const pexpireat = fns.pexpireat;
    pub const pexpiretime = fns.pexpiretime;
    pub const pfadd = fns.pfadd;
    pub const ping = fns.ping;
    pub const psetex = fns.psetex;
    pub const psubscribe = fns.psubscribe;
    pub const pttl = fns.pttl;
    pub const publish = fns.publish;
    pub const pubsub = fns.pubsub;
    pub const punsubscribe = fns.punsubscribe;
    pub const randomkey = fns.randomkey;
    pub const rename = fns.rename;
    pub const renamenx = fns.renamenx;
    pub const rpop = fns.rpop;
    pub const rpoplpush = fns.rpoplpush;
    pub const rpush = fns.rpush;
    pub const rpushx = fns.rpushx;
    pub const sadd = fns.sadd;
    pub const scan = fns.scan;
    pub const scard = fns.scard;
    pub const script = fns.script;
    pub const sdiff = fns.sdiff;
    pub const sdiffstore = fns.sdiffstore;
    pub const sinter = fns.sinter;
    pub const sintercard = fns.sintercard;
    pub const sinterstore = fns.sinterstore;
    pub const select = fns.select;
    pub const set = fns.set;
    pub const setbit = fns.setbit;
    pub const setex = fns.setex;
    pub const setnx = fns.setnx;
    pub const setrange = fns.setrange;
    pub const sismember = fns.sismember;
    pub const smembers = fns.smembers;
    pub const smismember = fns.smismember;
    pub const smove = fns.smove;
    pub const spop = fns.spop;
    pub const spublish = fns.spublish;
    pub const srandmember = fns.srandmember;
    pub const srem = fns.srem;
    pub const sscan = fns.sscan;
    pub const strlen = fns.strlen;
    pub const subscribe = fns.subscribe;
    pub const substr = fns.substr;
    pub const sunion = fns.sunion;
    pub const sunionstore = fns.sunionstore;
    pub const touch = fns.touch;
    pub const ttl = fns.ttl;
    pub const unlink = fns.unlink;
    pub const unsubscribe = fns.unsubscribe;
    pub const zcard = fns.zcard;
    pub const zcount = fns.zcount;
    pub const zlexcount = fns.zlexcount;
    pub const zpopmax = fns.zpopmax;
    pub const zpopmin = fns.zpopmin;
    pub const zrandmember = fns.zrandmember;
    pub const zrange = fns.zrange;
    pub const zrangebylex = fns.zrangebylex;
    pub const zrangebyscore = fns.zrangebyscore;
    pub const zrangestore = fns.zrangestore;
    pub const zrank = fns.zrank;
    pub const zrem = fns.zrem;
    pub const zremrangebylex = fns.zremrangebylex;
    pub const zremrangebyrank = fns.zremrangebyrank;
    pub const zremrangebyscore = fns.zremrangebyscore;
    pub const zrevrange = fns.zrevrange;
    pub const zrevrangebylex = fns.zrevrangebylex;
    pub const zrevrangebyscore = fns.zrevrangebyscore;
    pub const zrevrank = fns.zrevrank;
    pub const zscore = fns.zscore;
    pub const zincrby = fns.zincrby;
    pub const zmscore = fns.zmscore;
    pub const zadd = fns.zadd;
    pub const zscan = fns.zscan;
    pub const zdiff = fns.zdiff;
    pub const zdiffstore = fns.zdiffstore;
    pub const zinter = fns.zinter;
    pub const zintercard = fns.zintercard;
    pub const zinterstore = fns.zinterstore;
    pub const zunion = fns.zunion;
    pub const zunionstore = fns.zunionstore;
    pub const zmpop = fns.zmpop;
    pub const bzmpop = fns.bzmpop;
    pub const bzpopmin = fns.bzpopmin;
    pub const bzpopmax = fns.bzpopmax;
    pub const blmove = fns.blmove;
    pub const blmpop = fns.blmpop;
    pub const brpoplpush = fns.brpoplpush;

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
        pub fn onOpen(this: *JSValkeyClient, socket: SocketType) bun.JSTerminated!void {
            this.client.socket = _socket(socket);
            try this.client.onOpen(_socket(socket));
        }

        fn onHandshake_(this: *JSValkeyClient, _: anytype, success: i32, ssl_error: uws.us_bun_verify_error_t) bun.JSTerminated!void {
            debug("onHandshake: {d} error={d} reason={s} code={s}", .{
                success,
                ssl_error.error_no,
                if (ssl_error.reason != null) bun.span(ssl_error.reason[0..bun.len(ssl_error.reason) :0]) else "no reason",
                if (ssl_error.code != null) bun.span(ssl_error.code[0..bun.len(ssl_error.code) :0]) else "no code",
            });
            const handshake_success = if (success == 1) true else false;
            this.ref();
            defer this.deref();
            defer this.updatePollRef();
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
                                this.client.flags.is_manually_closed = true;
                                defer this.client.close();
                                const ssl_js_value = ssl_error.toJS(this.globalObject) catch |err| switch (err) {
                                    error.JSTerminated => return error.JSTerminated,
                                    else => {
                                        // Clear any pending exception since we can't convert it to JS
                                        this.globalObject.clearException();
                                        return;
                                    },
                                };
                                try this.client.failWithJSValue(this.globalObject, ssl_js_value);
                                return;
                            }
                        }
                    }
                }
                try this.client.start();
            }
        }

        pub const onHandshake = if (ssl) onHandshake_ else null;

        pub fn onClose(this: *JSValkeyClient, _: SocketType, _: i32, _: ?*anyopaque) void {
            // No need to deref since this.client.onClose() invokes onValkeyClose which does the deref.

            debug("Socket closed.", .{});
            this.ref();
            // Ensure the socket pointer is updated.
            this.client.socket = .{ .SocketTCP = .detached };
            defer {
                this.client.status = .disconnected;
                this.updatePollRef();
                this.deref();
            }

            this.client.onClose() catch {}; // TODO: properly propagate exception upwards
        }

        pub fn onEnd(this: *JSValkeyClient, socket: SocketType) void {
            _ = this;
            _ = socket;

            // Half-opened sockets are not allowed.
            // usockets will always call onClose after onEnd in this case so we don't need to do anything here
        }

        pub fn onConnectError(this: *JSValkeyClient, _: SocketType, _: i32) bun.JSTerminated!void {
            // Ensure the socket pointer is updated.
            this.client.socket = .{ .SocketTCP = .detached };
            this.ref();
            defer {
                this.client.status = .disconnected;
                this.updatePollRef();
                this.deref();
            }

            try this.client.onClose();
        }

        pub fn onTimeout(this: *JSValkeyClient, socket: SocketType) void {
            debug("Socket timed out.", .{});

            this.client.socket = _socket(socket);
            // Handle socket timeout
        }

        pub fn onData(this: *JSValkeyClient, socket: SocketType, data: []const u8) void {
            // Ensure the socket pointer is updated.
            this.client.socket = _socket(socket);

            this.ref();
            defer this.deref();
            this.client.onData(data) catch {}; // TODO: properly propagate exception upwards
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
            .enable_auto_pipelining = !bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING.get(),
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
const URL = @import("../bun.js/bindings/URL.zig").URL;

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
