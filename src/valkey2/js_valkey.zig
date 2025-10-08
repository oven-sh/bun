//! The JavaScript-driven Valkey client.
//! The declaration of all the public methods here is given in
//! `valkey.classes.ts` and the codegen will invoke these methods.
//!
//! Some implementation notes follow.
//!
//! Note that all event-loop and reference counting logic is handled within
//! ValkeyClientListener. This tightly couples into the lifecycle of
//! ValkeyClient, versus the wrapper JsValkey object.
pub const JsValkey = struct {
    const DEFAULT_CONN_STR = "valkey://localhost:6379";

    const Self = @This();

    /// The context object passed with each request. Keep it small.
    const RequestContext = union(enum) {
        /// The JS user requested this command and an associated promise is present.
        pub const UserRequest = struct {
            _promise: bun.jsc.JSPromise.Strong,
            // TODO(markovejnovic): This gives array-of-struct vibes instead of struct-of-array.
            // Probably slow.
            _return_as_buffer: bool,

            pub fn init(go: *bun.jsc.JSGlobalObject, return_as_buffer: bool) @This() {
                return .{
                    ._promise = bun.jsc.JSPromise.Strong.init(go),
                    ._return_as_buffer = return_as_buffer,
                };
            }

            pub fn promise(self: *const @This()) *bun.jsc.JSPromise {
                return self._promise.get();
            }

            /// Given a Redis RESPValue, resolve the promise with it.
            pub fn resolveWithRespValue(
                self: *@This(),
                go: *bun.jsc.JSGlobalObject,
                value: *protocol.RESPValue,
            ) void {
                const loop = go.bunVM().eventLoop();
                loop.enter();
                defer loop.exit();

                // TODO(markovejnovic): This feels pretty cobbled together...
                self._promise.resolve(go, value.toJSWithOptions(go, .{
                    .return_as_buffer = self._return_as_buffer,
                }) catch |err| go.takeError(err));
            }

            pub fn reject(
                self: *@This(),
                go: *bun.jsc.JSGlobalObject,
                reason: bun.JSError!bun.jsc.JSValue,
            ) void {
                const loop = go.bunVM().eventLoop();
                loop.enter();
                defer loop.exit();

                // TODO(markovejnovic): I think this handleOom is a smell...
                self._promise.reject(go, bun.handleOom(reason));
            }
        };

        pub fn failOom(self: *RequestContext, listener: *ValkeyClientListener) void {
            const go = listener.parent()._global_obj;
            switch (self.*) {
                .user_request => |*ur| {
                    ur.reject(go, go.createOutOfMemoryError());
                },
            }
        }

        user_request: UserRequest,
    };

    const ZigClient = ValkeyClient(ValkeyClientListener, RequestContext);

    /// This listener is passed into the ValkeyClient. ValkeyClient invokes these methods on
    /// certain events.
    const ValkeyClientListener = struct {
        fn parent(self: *@This()) *JsValkey {
            return @alignCast(@fieldParentPtr("_client_listener", self));
        }

        /// Invoked by the ZigClient whenever we receive a response for a request. This is where we
        /// resolve user promises.
        pub fn onResponse(
            self: *@This(),
            ctx: *RequestContext,
            value: *protocol.RESPValue,
        ) !void {
            const go = self.parent()._global_obj;

            switch (ctx.*) {
                .user_request => |*ur| {
                    switch (value.*) {
                        .Error => {
                            ur.reject(go, value.toJS(go) catch |err| go.takeError(err));
                        },
                        else => {
                            ur.resolveWithRespValue(go, value);
                        },
                    }
                },
            }
        }

        pub fn afterStateTransition(
            self: *@This(),
            old_state: *const ZigClient.State,
            new_state: *const ZigClient.State,
        ) void {
            self.updateRefCount(new_state);
            self.updateJsThisRef(new_state);
            self.updateEventLoop(new_state);

            const pp = self.parent();

            // If we enter the linked normal state, then we're fully connected so what we need to
            // do is resolve the user's promise.
            if (new_state.* == .linked and new_state.linked.state == .normal) {
                const js_this = pp._js_this.tryGet().?;

                // Means we just connected to Valkey. Let's resolve the connection promise.
                const js_promise = JsValkey.js.connectionPromiseGetCached(js_this) orelse {
                    // No promise to resolve. This is strange and shouldn't happen.
                    Self.debug("Error: Linked state but no connection promise found.", .{});
                    // TODO(markovejnovic): Telemetry.
                    return;
                };

                const promise = js_promise.asPromise().?;
                // TODO(markovejnovic): If duplicating, this kind of resolution won't suffice.
                // We'll need to figure out a mechanism to pass the resulting client object to the
                // promise.
                promise.resolve(self.parent()._global_obj, .js_undefined);

                JsValkey.js.connectionPromiseSetCached(js_this, pp._global_obj, .zero);
            }

            _ = old_state;
        }

        /// Update the event loop reference count based on the new state.
        fn updateEventLoop(self: *@This(), new_state: *const ZigClient.State) void {
            const jsvlk = self.parent();

            switch (new_state.*) {
                .disconnected, .closed => {
                    jsvlk._event_loop_rc.unref(jsvlk._virtual_machine);
                },
                .opening => {
                    // We're opening so we need the event loop.
                    jsvlk._event_loop_rc.ref(jsvlk._virtual_machine);
                },
                .handshake => {
                    bun.debugAssert(jsvlk._event_loop_rc.status == .active);
                },
                .linked => |lstate| {
                    switch (lstate.state) {
                        .authenticating => {
                            bun.debugAssert(jsvlk._event_loop_rc.status == .active);
                        },
                        .subscriber => {
                            jsvlk._event_loop_rc.ref(jsvlk._virtual_machine);
                        },
                        .normal => {
                            bun.debugAssert(jsvlk._event_loop_rc.status == .active);
                            jsvlk._event_loop_rc.unref(jsvlk._virtual_machine);
                        },
                    }
                },
            }
        }

        fn updateRefCount(self: *@This(), new_state: *const ZigClient.State) void {
            const jsvlk = self.parent();

            switch (new_state.*) {
                .disconnected => {},
                .closed => {
                    // After disconnecting, we can drop our reference.
                },
                .opening => {
                    Self.debug("Opening connection, adding ref", .{});
                    jsvlk.ref();
                },
                .handshake => {
                    bun.debugAssert(jsvlk._ref_count.raw_count > 0);
                    // The only case is opening -> handshake and the ref is already upgraded.
                    // Nothing to do.
                },
                .linked => |lstate| {
                    switch (lstate.state) {
                        .authenticating, .subscriber => {},
                        .normal => {},
                    }
                },
            }

            Self.debug("Current ref-count: {}", .{jsvlk._ref_count.raw_count});
        }

        fn updateJsThisRef(self: *@This(), new_state: *const ZigClient.State) void {
            const jsvlk = self.parent();

            switch (new_state.*) {
                .disconnected => {
                    // A connection was dropped, so we can drop our reference.
                    jsvlk._js_this.downgrade();
                },
                .closed => {
                    // After disconnecting, we can drop our reference.
                },
                .opening => {
                    // We're opening the connection so we need to keep the JS
                    // object alive.
                    jsvlk._js_this.upgrade(jsvlk._global_obj);
                },
                .handshake => {
                    // opening -> handshake is the only case, so this must
                    // already be upgraded
                    bun.debugAssert(jsvlk._js_this.isStrong());
                },
                .linked => {
                    // The JS object MUST be alive at this point, since linked
                    // is entered through opening -> handshake -> linked or
                    // opening -> linked
                    bun.debugAssert(jsvlk._js_this.isStrong());
                },
            }

            Self.debug("JSRef = {s}", .{if (jsvlk._js_this.isStrong()) "strong" else "weak"});
        }

        const debug = bun.Output.scoped(.valkey_client_listener, .visible);
    };

    const Client = ZigClient;

    _client: Client,
    _ref_count: RefCount,
    _client_listener: ValkeyClientListener = .{},
    _event_loop_rc: bun.Async.KeepAlive = .{},
    _global_obj: *bun.jsc.JSGlobalObject,
    _js_this: bun.jsc.JSRef,
    _virtual_machine: *bun.jsc.VirtualMachine,

    pub fn constructor(
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
        js_this: bun.jsc.JSValue,
    ) bun.JSError!*JsValkey {
        Self.debug("Creating JsValkey...", .{});

        // Parse the arguments first.
        var args_parsed = try Self.parseConstructorArgs(go, cf);
        defer args_parsed.deinit();

        // TODO(markovejnovic): Can we avoid this allocation?
        const conn_url = args_parsed.conn_str.toUTF8(bun.default_allocator);
        defer conn_url.deinit();

        var self = Self.new(.{
            ._client = undefined,
            ._ref_count = RefCount.init(),
            ._client_listener = .{},
            ._virtual_machine = go.bunVM(),
            ._js_this = bun.jsc.JSRef.initWeak(js_this),
            ._global_obj = go,
        });

        self._client = try initClient(
            go,
            conn_url.slice(),
            &self._client_listener,
        );

        return self;
    }

    /// Attempt to create the Valkey client.
    /// This may fail but will offer proper JS errors.
    fn initClient(
        go: *bun.jsc.JSGlobalObject,
        conn_str: []const u8,
        client_listener: *ValkeyClientListener,
    ) bun.JSError!Client {
        const vm = go.bunVM();
        return bun.handleOom(Client.init(
            bun.default_allocator,
            vm.uwsLoop(),
            conn_str,
            .{}, // TODO(markovejnovic): Accept options from user lol
            client_listener,
            // TODO(markovejnovic): This VM argument is leaking JS context down to the
            // native-only Valkey. This is the only leak site.
            vm,
        )) catch |err| {
            switch (err) {
                error.InvalidProtocol => {
                    return go.ERR(
                        .REDIS_INVALID_ARGUMENT,
                        "Invalid protocol. Valid protocols are: " ++
                            "'redis://', 'valkey://', 'rediss://', " ++
                            "'valkeys://', 'redis+tls://', " ++
                            "'redis+unix://', 'redis+tls+unix://'.",
                        .{},
                    ).throw();
                },
                error.InvalidUnixLocation => {
                    // TODO(markovejnovic): Use ERR
                    return go.throw("Invalid UNIX socket location given in the URL.", .{});
                },
                error.MalformedUrl => {
                    // TODO(markovejnovic): Use ERR
                    return go.throw("Invalid connection URL given.", .{});
                },
                error.FailedToCreateSocket => {
                    // TODO(markovejnovic): Use ERR
                    // TODO(markovejnovic): Improve this error message.
                    // This error message sucks, but we can't do better atm
                    return go.throw("Unspecified error creating socket.", .{});
                },
            }
        };
    }

    /// Parse arguments given to the constructor. There's a lot of arguments
    /// the constructor can take, so this is separated.
    fn parseConstructorArgs(
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!struct {
        conn_str: bun.String,

        pub fn deinit(self: *@This()) void {
            self.conn_str.deref();
        }
    } {
        const args = cf.arguments();
        const env = go.bunVM().transpiler.env;

        const conn_url = if (args.len > 0 and !args[0].isUndefined())
            try args[0].toBunString(go)
        else if (env.get("REDIS_URL") orelse env.get("VALKEY_URL")) |url|
            bun.String.init(url)
        else
            bun.String.init(DEFAULT_CONN_STR);

        return .{
            .conn_str = conn_url,
        };
    }

    /// Duplicate the JsValkey object.
    pub fn duplicate() bun.JSError!*JsValkey {
        @panic("duplicate not yet implemented");
    }

    pub fn getConnected(self: *const Self, _: *bun.jsc.JSGlobalObject) bun.jsc.JSValue {
        return bun.jsc.JSValue.jsBoolean(self._client.isConnected());
    }

    pub fn getBufferedAmount(self: *const Self, _: *bun.jsc.JSGlobalObject) bun.jsc.JSValue {
        return bun.jsc.JSValue.jsNumber(self._client.bufferedBytesCount());
    }

    pub fn close(self: *Self, go: *bun.jsc.JSGlobalObject, cf: *bun.jsc.CallFrame) bun.jsc.JSValue {
        _ = self;
        _ = go;
        _ = cf;
        return .js_undefined;
    }

    pub fn deinit(self: *Self) void {
        _ = self;
    }

    pub fn finalize(self: *Self) void {
        Self.debug("Finalizing JsValkey", .{});
        self._client.deinit();
    }

    /// External API which measures the total memory usage of this object in
    /// bytes.
    pub fn memoryCost(self: *const Self) usize {
        return @sizeOf(Self) + self._client.memoryUsage();
    }

    pub const RequestOptions = struct {
        return_as_buffer: bool = false,
    };

    /// Create a request which gets resolved in onResponse.
    pub fn request(
        self: *Self,
        go: *bun.jsc.JSGlobalObject,
        _: bun.jsc.JSValue,
        command: Command,
        options: RequestOptions,
    ) !*bun.jsc.JSPromise {
        // The goal of this function is to transform Command -> RequestType. To achieve that, we
        // need to enrich the Command with promise.
        var req: ZigClient.RequestType = .{
            .command = command,
            .context = .{
                .user_request = RequestContext.UserRequest.init(go, options.return_as_buffer),
            },
        };

        self._client.request(&req) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send command", err);
        };

        return req.context.user_request.promise();
    }

    pub fn connect(
        self: *Self,
        go: *bun.jsc.JSGlobalObject,
        _: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        const promise = bun.jsc.JSPromise.create(go);

        // No need to kick the event loop here. ValkeyClientListener does that.
        self._client.startConnecting() catch |err| {
            switch (err) {
                error.InvalidState => {
                    // The client is already connected.
                    return bun.jsc.JSPromise.resolvedPromiseValue(go, .js_undefined);
                },
                error.FailedToOpenSocket => {
                    // If we fail, on the other hand, we need to reject the
                    // promise immediately.
                    go.bunVM().event_loop.rejectPromise(promise, go, go.ERR(
                        .SOCKET_CLOSED_BEFORE_CONNECTION,
                        "FailedToOpenSocket connecting to Valkey.",
                        .{},
                    ).toJS());
                },
            }
        };

        // Let's add this promise to our storage so that it can be resolved when the connection
        // links.
        Self.js.connectionPromiseSetCached(self._js_this.tryGet().?, go, promise.toJS());

        // TODO(markovejnovic): Connection timeout please.
        return promise.toJS();
    }

    pub fn send(
        self: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        const command = try cf.argument(0).toBunString(go);
        defer command.deref();

        const args_array = cf.argument(1);
        if (!args_array.isObject() or !args_array.isArray()) {
            return go.throw("Arguments must be an array", .{});
        }
        var iter = try args_array.arrayIterator(go);
        var args = try std.ArrayList(JSArgument).initCapacity(bun.default_allocator, iter.len);
        defer {
            for (args.items) |*item| {
                item.deinit();
            }
            args.deinit();
        }

        while (try iter.next()) |arg_js| {
            args.appendAssumeCapacity(try jsValueToJsArgument(go, arg_js) orelse {
                return go.throwInvalidArgumentType("sendCommand", "argument", "string or buffer");
            });
        }

        const cmd_str = command.toUTF8WithoutRef(bun.default_allocator);
        defer cmd_str.deinit();
        const promise = self.request(go, cf.this(), Command.initDirect(cmd_str.slice(), .{
            .args = args.items,
        }), .{}) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send command", err);
        };
        return promise.toJS();
    }

    fn hsetImpl(
        this: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
        comptime command: CommandDescriptor,
    ) bun.JSError!bun.jsc.JSValue {
        // TODO(markovejnovic): Stolen straight off of the legacy implementation.
        const key = try cf.argument(0).toBunString(go);
        defer key.deref();

        const second_arg = cf.argument(1);

        var args = std.ArrayList(bun.jsc.ZigString.Slice).init(bun.default_allocator);
        defer {
            for (args.items) |item| item.deinit();
            args.deinit();
        }

        try args.append(key.toUTF8(bun.default_allocator));

        if (second_arg.isObject() and !second_arg.isArray()) {
            // Pattern 1: Object/Record - hset(key, {field: value, ...})
            const obj = second_arg.getObject() orelse {
                return go.throwInvalidArgumentType(command.toString(), "fields", "object");
            };

            var object_iter = try bun.jsc.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
            }).init(go, obj);
            defer object_iter.deinit();

            try args.ensureTotalCapacity(1 + object_iter.len * 2);

            while (try object_iter.next()) |field_name| {
                const field_slice = field_name.toUTF8(bun.default_allocator);
                args.appendAssumeCapacity(field_slice);

                const value_str = try object_iter.value.toBunString(go);
                defer value_str.deref();

                const value_slice = value_str.toUTF8(bun.default_allocator);
                args.appendAssumeCapacity(value_slice);
            }
        } else if (second_arg.isArray()) {
            // Pattern 3: Array - hmset(key, [field, value, ...])
            var iter = try second_arg.arrayIterator(go);
            if (iter.len % 2 != 0) {
                return go.throw("Array must have an even number of elements (field-value pairs)", .{});
            }

            try args.ensureTotalCapacity(1 + iter.len);

            while (try iter.next()) |field_js| {
                const field_str = try field_js.toBunString(go);
                args.appendAssumeCapacity(field_str.toUTF8(bun.default_allocator));
                field_str.deref();

                const value_js = try iter.next() orelse {
                    return go.throw("Array must have an even number of elements (field-value pairs)", .{});
                };
                const value_str = try value_js.toBunString(go);
                args.appendAssumeCapacity(value_str.toUTF8(bun.default_allocator));
                value_str.deref();
            }
        } else {
            // Pattern 2: Variadic - hset(key, field, value, ...)
            const args_count = cf.argumentsCount();
            if (args_count < 3) {
                return go.throw("HSET requires at least key, field, and value arguments", .{});
            }

            const field_value_count = args_count - 1; // Exclude key
            if (field_value_count % 2 != 0) {
                return go.throw("HSET requires field-value pairs (even number of arguments after key)", .{});
            }

            try args.ensureTotalCapacity(args_count);

            var i: u32 = 1;
            while (i < args_count) : (i += 1) {
                const arg_str = try cf.argument(i).toBunString(go);
                args.appendAssumeCapacity(arg_str.toUTF8(bun.default_allocator));
                arg_str.deref();
            }
        }

        if (args.items.len == 1) {
            return go.throw("HSET requires at least one field-value pair", .{});
        }

        const promise = this.request(
            go,
            cf.this(),
            Command.initById(command, .{ .slices = args.items }),
            .{},
        ) catch |err| {
            const msg = "Failed to send " ++ command.toString() ++ " command";
            return protocol.valkeyErrorToJS(go, msg, err);
        };

        return promise.toJS();
    }

    pub fn hset(
        this: *Self,
        globalObject: *bun.jsc.JSGlobalObject,
        callframe: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        return hsetImpl(this, globalObject, callframe, .HSET);
    }

    pub fn hmset(
        this: *Self,
        globalObject: *bun.jsc.JSGlobalObject,
        callframe: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        return hsetImpl(this, globalObject, callframe, .HMSET);
    }

    pub fn hmget(this: *JsValkey, go: *bun.jsc.JSGlobalObject, cf: *bun.jsc.CallFrame) bun.JSError!bun.jsc.JSValue {
        // TODO(markovejnovic): Implementation taken straight from the legacy code.
        const args_view = cf.arguments();
        if (args_view.len < 2) {
            return go.throw("HMGET requires at least a key and one field", .{});
        }

        var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
        var args = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), args_view.len);
        defer {
            for (args.items) |*item| {
                item.deinit();
            }
            args.deinit();
        }

        const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
            return go.throwInvalidArgumentType("hmget", "key", "string or buffer");
        };
        args.appendAssumeCapacity(key);

        const second_arg = cf.argument(1);
        if (second_arg.isArray()) {
            const array_len = try second_arg.getLength(go);
            if (array_len == 0) {
                return go.throw("HMGET requires at least one field", .{});
            }

            var array_iter = try second_arg.arrayIterator(go);
            while (try array_iter.next()) |element| {
                const field = (try jsValueToJsArgument(go, element)) orelse {
                    return go.throwInvalidArgumentType("hmget", "field", "string or buffer");
                };
                try args.append(field);
            }
        } else {
            for (args_view[1..]) |arg| {
                if (arg.isUndefinedOrNull()) {
                    break;
                }
                const field = (try jsValueToJsArgument(go, arg)) orelse {
                    return go.throwInvalidArgumentType("hmget", "field", "string or buffer");
                };
                try args.append(field);
            }
        }

        // Send HMGET command
        const promise = this.request(
            go,
            cf.this(),
            Command.initById(.HMGET, .{ .args = args.items }),
            .{},
        ) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send HMGET command", err);
        };
        return promise.toJS();
    }

    pub fn ping(
        this: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        // TODO(markovejnovic): Taken from the legacy implementation.
        var message_buf: [1]JSArgument = undefined;
        var args_slice: []JSArgument = &.{};

        if (!cf.argument(0).isUndefinedOrNull()) {
            // Only use the first argument if provided, ignore any additional arguments
            const message = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
                return go.throwInvalidArgumentType("ping", "message", "string or buffer");
            };
            message_buf[0] = message;
            args_slice = message_buf[0..1];
        }
        defer {
            for (args_slice) |*item| {
                item.deinit();
            }
        }

        const promise = this.request(go, cf.this(), Command.initById(
            .PING,
            .{ .args = args_slice },
        ), .{}) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send PING command", err);
        };
        return promise.toJS();
    }

    pub fn get(
        this: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
            return go.throwInvalidArgumentType("get", "key", "string or buffer");
        };
        defer key.deinit();

        const promise = this.request(
            go,
            cf.this(),
            Command.initById(.GET, .{ .args = &.{key} }),
            .{},
        ) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send GET command", err);
        };
        return promise.toJS();
    }

    pub fn set(this: *Self, go: *bun.jsc.JSGlobalObject, cf: *bun.jsc.CallFrame) bun.JSError!bun.jsc.JSValue {
        // TODO(markovejnovic): Implementation taken straight from the legacy code.

        const args_view = cf.arguments();
        var stack_fallback = std.heap.stackFallback(512, bun.default_allocator);
        var args = try std.ArrayList(JSArgument).initCapacity(stack_fallback.get(), args_view.len);
        defer {
            for (args.items) |*item| {
                item.deinit();
            }
            args.deinit();
        }
        const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
            return go.throwInvalidArgumentType("set", "key", "string or buffer");
        };
        args.appendAssumeCapacity(key);

        const value = (try jsValueToJsArgument(go, cf.argument(1))) orelse {
            return go.throwInvalidArgumentType("set", "value", "string or buffer or number");
        };
        args.appendAssumeCapacity(value);

        if (args_view.len > 2) {
            for (args_view[2..]) |arg| {
                if (arg.isUndefinedOrNull()) {
                    break;
                }
                args.appendAssumeCapacity(try jsValueToJsArgument(go, arg) orelse {
                    return go.throwInvalidArgumentType("set", "arguments", "string or buffer");
                });
            }
        }

        const promise = this.request(
            go,
            cf.this(),
            Command.initById(.SET, .{ .args = args.items }),
            .{},
        ) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send SET command", err);
        };

        return promise.toJS();
    }

    pub fn expire(
        this: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
            return go.throwInvalidArgumentType("expire", "key", "string or buffer");
        };
        defer key.deinit();

        // Validate the seconds argument as an integer in valid range
        _ = try go.validateIntegerRange(cf.argument(1), i32, 0, .{
            .min = 0,
            .max = 2147483647,
            .field_name = "seconds",
        });

        // Convert to string argument (numbers get auto-converted by jsValueToJsArgument)
        const seconds_arg = (try jsValueToJsArgument(go, cf.argument(1))) orelse {
            return go.throwInvalidArgumentType("expire", "seconds", "number");
        };
        defer seconds_arg.deinit();

        // Use the same pattern as MetFactory: call this.request()
        const promise = this.request(
            go,
            cf.this(),
            Command.initById(.EXPIRE, .{ .args = &.{ key, seconds_arg } }),
            .{},
        ) catch |err| {
            return protocol.valkeyErrorToJS(go, "Failed to send EXPIRE command", err);
        };
        return promise.toJS();
    }

    pub const getBuffer = MetFactory.@"(key: RedisKey, options)"("getBuffer", .GET, "key", .{ .return_as_buffer = true }).fxn;
    pub const @"type" = MetFactory.@"(key: RedisKey)"("type", .TYPE, "key").fxn;
    pub const append = MetFactory.@"(key: RedisKey, value: RedisValue)"("append", .APPEND, "key", "value").fxn;
    pub const bitcount = MetFactory.@"(key: RedisKey)"("bitcount", .BITCOUNT, "key").fxn;
    pub const blmove = MetFactory.@"(...strings: string[])"("blmove", .BLMOVE).fxn;
    pub const blmpop = MetFactory.@"(...strings: string[])"("blmpop", .BLMPOP).fxn;
    pub const blpop = MetFactory.@"(...strings: string[])"("blpop", .BLPOP).fxn;
    pub const brpop = MetFactory.@"(...strings: string[])"("brpop", .BRPOP).fxn;
    pub const brpoplpush = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("brpoplpush", .BRPOPLPUSH, "source", "destination", "timeout").fxn;
    pub const bzmpop = MetFactory.@"(...strings: string[])"("bzmpop", .BZMPOP).fxn;
    pub const bzpopmax = MetFactory.@"(...strings: string[])"("bzpopmax", .BZPOPMAX).fxn;
    pub const bzpopmin = MetFactory.@"(...strings: string[])"("bzpopmin", .BZPOPMIN).fxn;
    pub const copy = MetFactory.@"(...strings: string[])"("copy", .COPY).fxn;
    pub const decr = MetFactory.@"(key: RedisKey)"("decr", .DECR, "key").fxn;
    pub const decrby = MetFactory.@"(key: RedisKey, value: RedisValue)"("decrby", .DECRBY, "key", "decrement").fxn;
    pub const del = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("del", .DEL, "key").fxn;
    pub const dump = MetFactory.@"(key: RedisKey)"("dump", .DUMP, "key").fxn;
    pub const exists = MetFactory.@"(key: RedisKey)"("exists", .EXISTS, "key").fxn;
    pub const expireat = MetFactory.@"(key: RedisKey, value: RedisValue)"("expireat", .EXPIREAT, "key", "timestamp").fxn;
    pub const expiretime = MetFactory.@"(key: RedisKey)"("expiretime", .EXPIRETIME, "key").fxn;
    pub const getbit = MetFactory.@"(key: RedisKey, value: RedisValue)"("getbit", .GETBIT, "key", "offset").fxn;
    pub const getdel = MetFactory.@"(key: RedisKey)"("getdel", .GETDEL, "key").fxn;
    pub const getex = MetFactory.@"(...strings: string[])"("getex", .GETEX).fxn;
    pub const getrange = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("getrange", .GETRANGE, "key", "start", "end").fxn;
    pub const getset = MetFactory.@"(key: RedisKey, value: RedisValue)"("getset", .GETSET, "key", "value").fxn;
    pub const hdel = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("hdel", .HDEL, "key").fxn;
    pub const hexists = MetFactory.@"(key: RedisKey, value: RedisValue)"("hexists", .HEXISTS, "key", "field").fxn;
    pub const hexpire = MetFactory.@"(...strings: string[])"("hexpire", .HEXPIRE).fxn;
    pub const hexpireat = MetFactory.@"(...strings: string[])"("hexpireat", .HEXPIREAT).fxn;
    pub const hexpiretime = MetFactory.@"(...strings: string[])"("hexpiretime", .HEXPIRETIME).fxn;
    pub const hget = MetFactory.@"(key: RedisKey, value: RedisValue)"("hget", .HGET, "key", "field").fxn;
    pub const hgetall = MetFactory.@"(key: RedisKey)"("hgetall", .HGETALL, "key").fxn;
    pub const hgetdel = MetFactory.@"(...strings: string[])"("hgetdel", .HGETDEL).fxn;
    pub const hgetex = MetFactory.@"(...strings: string[])"("hgetex", .HGETEX).fxn;
    pub const hincrby = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("hincrby", .HINCRBY, "key", "field", "increment").fxn;
    pub const hincrbyfloat = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("hincrbyfloat", .HINCRBYFLOAT, "key", "field", "increment").fxn;
    pub const hkeys = MetFactory.@"(key: RedisKey)"("hkeys", .HKEYS, "key").fxn;
    pub const hlen = MetFactory.@"(key: RedisKey)"("hlen", .HLEN, "key").fxn;
    pub const hpersist = MetFactory.@"(...strings: string[])"("hpersist", .HPERSIST).fxn;
    pub const hpexpire = MetFactory.@"(...strings: string[])"("hpexpire", .HPEXPIRE).fxn;
    pub const hpexpireat = MetFactory.@"(...strings: string[])"("hpexpireat", .HPEXPIREAT).fxn;
    pub const hpexpiretime = MetFactory.@"(...strings: string[])"("hpexpiretime", .HPEXPIRETIME).fxn;
    pub const hpttl = MetFactory.@"(...strings: string[])"("hpttl", .HPTTL).fxn;
    pub const hrandfield = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("hrandfield", .HRANDFIELD, "key").fxn;
    pub const hscan = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("hscan", .HSCAN, "key").fxn;
    pub const hsetex = MetFactory.@"(...strings: string[])"("hsetex", .HSETEX).fxn;
    pub const hsetnx = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("hsetnx", .HSETNX, "key", "field", "value").fxn;
    pub const hstrlen = MetFactory.@"(key: RedisKey, value: RedisValue)"("hstrlen", .HSTRLEN, "key", "field").fxn;
    pub const httl = MetFactory.@"(...strings: string[])"("httl", .HTTL).fxn;
    pub const hvals = MetFactory.@"(key: RedisKey)"("hvals", .HVALS, "key").fxn;
    pub const incr = MetFactory.@"(key: RedisKey)"("incr", .INCR, "key").fxn;
    pub const incrby = MetFactory.@"(key: RedisKey, value: RedisValue)"("incrby", .INCRBY, "key", "increment").fxn;
    pub const incrbyfloat = MetFactory.@"(key: RedisKey, value: RedisValue)"("incrbyfloat", .INCRBYFLOAT, "key", "increment").fxn;
    pub const keys = MetFactory.@"(key: RedisKey)"("keys", .KEYS, "key").fxn;
    pub const lindex = MetFactory.@"(key: RedisKey, value: RedisValue)"("lindex", .LINDEX, "key", "index").fxn;
    pub const linsert = MetFactory.@"(...strings: string[])"("linsert", .LINSERT).fxn;
    pub const llen = MetFactory.@"(key: RedisKey)"("llen", .LLEN, "key").fxn;
    pub const lmove = MetFactory.@"(...strings: string[])"("lmove", .LMOVE).fxn;
    pub const lmpop = MetFactory.@"(...strings: string[])"("lmpop", .LMPOP).fxn;
    pub const lpop = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("lpop", .LPOP, "key").fxn;
    pub const lpos = MetFactory.@"(...strings: string[])"("lpos", .LPOS).fxn;
    pub const lpush = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpush", .LPUSH).fxn;
    pub const lpushx = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("lpushx", .LPUSHX).fxn;
    pub const lrange = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("lrange", .LRANGE, "key", "start", "stop").fxn;
    pub const lrem = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("lrem", .LREM, "key", "count", "element").fxn;
    pub const lset = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("lset", .LSET, "key", "index", "element").fxn;
    pub const ltrim = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("ltrim", .LTRIM, "key", "start", "stop").fxn;
    pub const mget = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("mget", .MGET, "key").fxn;
    pub const mset = MetFactory.@"(...strings: string[])"("mset", .MSET).fxn;
    pub const msetnx = MetFactory.@"(...strings: string[])"("msetnx", .MSETNX).fxn;
    pub const persist = MetFactory.@"(key: RedisKey)"("persist", .PERSIST, "key").fxn;
    pub const pexpire = MetFactory.@"(key: RedisKey, value: RedisValue)"("pexpire", .PEXPIRE, "key", "milliseconds").fxn;
    pub const pexpireat = MetFactory.@"(key: RedisKey, value: RedisValue)"("pexpireat", .PEXPIREAT, "key", "milliseconds-timestamp").fxn;
    pub const pexpiretime = MetFactory.@"(key: RedisKey)"("pexpiretime", .PEXPIRETIME, "key").fxn;
    pub const pfadd = MetFactory.@"(key: RedisKey, value: RedisValue)"("pfadd", .PFADD, "key", "value").fxn;
    pub const psetex = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("psetex", .PSETEX, "key", "milliseconds", "value").fxn;
    pub const psubscribe = MetFactory.@"(...strings: string[])"("psubscribe", .PSUBSCRIBE, .dont_care).fxn;
    pub const pttl = MetFactory.@"(key: RedisKey)"("pttl", .PTTL, "key").fxn;
    pub const pubsub = MetFactory.@"(...strings: string[])"("pubsub", .PUBSUB, .dont_care).fxn;
    pub const punsubscribe = MetFactory.@"(...strings: string[])"("punsubscribe", .PUNSUBSCRIBE, .dont_care).fxn;
    pub const randomkey = MetFactory.@"()"(.RANDOMKEY).fxn;
    pub const rename = MetFactory.@"(key: RedisKey, value: RedisValue)"("rename", .RENAME, "key", "newkey").fxn;
    pub const renamenx = MetFactory.@"(key: RedisKey, value: RedisValue)"("renamenx", .RENAMENX, "key", "newkey").fxn;
    pub const rpop = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("rpop", .RPOP, "key").fxn;
    pub const rpoplpush = MetFactory.@"(key: RedisKey, value: RedisValue)"("rpoplpush", .RPOPLPUSH, "source", "destination").fxn;
    pub const rpush = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpush", .RPUSH).fxn;
    pub const rpushx = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("rpushx", .RPUSHX).fxn;
    pub const scan = MetFactory.@"(...strings: string[])"("scan", .SCAN).fxn;
    pub const scard = MetFactory.@"(key: RedisKey)"("scard", .SCARD, "key").fxn;
    pub const script = MetFactory.@"(...strings: string[])"("script", .SCRIPT).fxn;
    pub const sdiff = MetFactory.@"(...strings: string[])"("sdiff", .SDIFF).fxn;
    pub const sdiffstore = MetFactory.@"(...strings: string[])"("sdiffstore", .SDIFFSTORE).fxn;
    pub const select = MetFactory.@"(...strings: string[])"("select", .SELECT).fxn;
    pub const setbit = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("setbit", .SETBIT, "key", "offset", "value").fxn;
    pub const setex = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("setex", .SETEX, "key", "seconds", "value").fxn;
    pub const setnx = MetFactory.@"(key: RedisKey, value: RedisValue)"("setnx", .SETNX, "key", "value").fxn;
    pub const setrange = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("setrange", .SETRANGE, "key", "offset", "value").fxn;
    pub const sinter = MetFactory.@"(...strings: string[])"("sinter", .SINTER).fxn;
    pub const sintercard = MetFactory.@"(...strings: string[])"("sintercard", .SINTERCARD).fxn;
    pub const sinterstore = MetFactory.@"(...strings: string[])"("sinterstore", .SINTERSTORE).fxn;
    pub const sadd = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("sadd", .SADD).fxn;
    pub const sismember = MetFactory.@"(key: RedisKey, value: RedisValue)"("sismember", .SISMEMBER, "key", "value").fxn;
    pub const smembers = MetFactory.@"(key: RedisKey)"("smembers", .SMEMBERS, "key").fxn;
    pub const smismember = MetFactory.@"(...strings: string[])"("smismember", .SMISMEMBER).fxn;
    pub const smove = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("smove", .SMOVE, "source", "destination", "member").fxn;
    pub const spop = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("spop", .SPOP, "key").fxn;
    pub const spublish = MetFactory.@"(key: RedisKey, value: RedisValue)"("spublish", .SPUBLISH, "channel", "message").fxn;
    pub const srandmember = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("srandmember", .SRANDMEMBER, "key").fxn;
    pub const srem = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("srem", .SREM, "key").fxn;
    pub const sscan = MetFactory.@"(...strings: string[])"("sscan", .SSCAN).fxn;
    pub const strlen = MetFactory.@"(key: RedisKey)"("strlen", .STRLEN, "key").fxn;
    pub const substr = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("substr", .SUBSTR, "key", "start", "end").fxn;
    pub const sunion = MetFactory.@"(...strings: string[])"("sunion", .SUNION).fxn;
    pub const sunionstore = MetFactory.@"(...strings: string[])"("sunionstore", .SUNIONSTORE).fxn;
    pub const touch = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("touch", .TOUCH, "key").fxn;
    pub const ttl = MetFactory.@"(key: RedisKey)"("ttl", .TTL, "key").fxn;
    pub const unlink = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("unlink", .UNLINK, "key").fxn;
    pub const zadd = MetFactory.@"(...strings: string[])"("zadd", .ZADD).fxn;
    pub const zcard = MetFactory.@"(key: RedisKey)"("zcard", .ZCARD, "key").fxn;
    pub const zcount = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zcount", .ZCOUNT, "key", "min", "max").fxn;
    pub const zdiff = MetFactory.@"(...strings: string[])"("zdiff", .ZDIFF).fxn;
    pub const zdiffstore = MetFactory.@"(...strings: string[])"("zdiffstore", .ZDIFFSTORE).fxn;
    pub const zincrby = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zincrby", .ZINCRBY, "key", "increment", "member").fxn;
    pub const zinter = MetFactory.@"(...strings: string[])"("zinter", .ZINTER).fxn;
    pub const zintercard = MetFactory.@"(...strings: string[])"("zintercard", .ZINTERCARD).fxn;
    pub const zinterstore = MetFactory.@"(...strings: string[])"("zinterstore", .ZINTERSTORE).fxn;
    pub const zlexcount = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zlexcount", .ZLEXCOUNT, "key", "min", "max").fxn;
    pub const zmpop = MetFactory.@"(...strings: string[])"("zmpop", .ZMPOP).fxn;
    pub const zmscore = MetFactory.@"(key: RedisKey, value: RedisValue, ...args: RedisValue)"("zmscore", .ZMSCORE).fxn;
    pub const zpopmax = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zpopmax", .ZPOPMAX, "key").fxn;
    pub const zpopmin = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zpopmin", .ZPOPMIN, "key").fxn;
    pub const zrandmember = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrandmember", .ZRANDMEMBER, "key").fxn;
    pub const zrange = MetFactory.@"(...strings: string[])"("zrange", .ZRANGE).fxn;
    pub const zrangebylex = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrangebylex", .ZRANGEBYLEX, "key").fxn;
    pub const zrangebyscore = MetFactory.@"(...strings: string[])"("zrangebyscore", .ZRANGEBYSCORE).fxn;
    pub const zrangestore = MetFactory.@"(...strings: string[])"("zrangestore", .ZRANGESTORE).fxn;
    pub const zrank = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrank", .ZRANK, "key").fxn;
    pub const zrem = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrem", .ZREM, "key").fxn;
    pub const zremrangebylex = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zremrangebylex", .ZREMRANGEBYLEX, "key", "min", "max").fxn;
    pub const zremrangebyrank = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zremrangebyrank", .ZREMRANGEBYRANK, "key", "start", "stop").fxn;
    pub const zremrangebyscore = MetFactory.@"(key: RedisKey, value: RedisValue, value2: RedisValue)"("zremrangebyscore", .ZREMRANGEBYSCORE, "key", "min", "max").fxn;
    pub const zrevrange = MetFactory.@"(...strings: string[])"("zrevrange", .ZREVRANGE).fxn;
    pub const zrevrangebylex = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrevrangebylex", .ZREVRANGEBYLEX, "key").fxn;
    pub const zrevrangebyscore = MetFactory.@"(...strings: string[])"("zrevrangebyscore", .ZREVRANGEBYSCORE).fxn;
    pub const zrevrank = MetFactory.@"(key: RedisKey, ...args: RedisKey[])"("zrevrank", .ZREVRANK, "key").fxn;
    pub const zscan = MetFactory.@"(...strings: string[])"("zscan", .ZSCAN).fxn;
    pub const zscore = MetFactory.@"(key: RedisKey, value: RedisValue)"("zscore", .ZSCORE, "key", "value").fxn;
    pub const zunion = MetFactory.@"(...strings: string[])"("zunion", .ZUNION).fxn;
    pub const zunionstore = MetFactory.@"(...strings: string[])"("zunionstore", .ZUNIONSTORE).fxn;

    pub const js = bun.jsc.Codegen.JSRedisClient2;
    pub const new = bun.TrivialNew(@This());
    const RefCount = bun.ptr.RefCount(Self, "_ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const debug = bun.Output.scoped(.js_valkey, .visible);
};

/// Codegen for different types of methods.
///
/// Met stands for "method" not "methamphetamine".
const MetFactory = struct {
    const Self = @This();

    /// 0-arity method like RANDOMKEY
    pub fn @"()"(comptime command_descriptor: CommandDescriptor) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const promise = self.request(go, cf.this(), .{
                    .command = .{ .command_id = command_descriptor },
                    .args = .{ .args = &.{} },
                }, .{}) catch |err| {
                    return protocol.valkeyErrorToJS(
                        go,
                        "Failed to send " ++ command_descriptor.toString(),
                        err,
                    );
                };
                return promise.toJS();
            }
        };
    }

    /// 1-arity method like INCR
    pub fn @"(key: RedisKey)"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
        comptime arg0_name: []const u8,
    ) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
                    return go.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();

                const promise = self.request(
                    go,
                    cf.this(),
                    Command.initById(command, .{ .args = &.{key} }),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(
                        go,
                        "Failed to send " ++ command.toString(),
                        err,
                    );
                };
                return promise.toJS();
            }
        };
    }

    /// 1-arity method with custom request options
    pub fn @"(key: RedisKey, options)"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
        comptime arg0_name: []const u8,
        comptime options: JsValkey.RequestOptions,
    ) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
                    return go.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();

                const promise = self.request(
                    go,
                    cf.this(),
                    Command.initById(command, .{ .args = &.{key} }),
                    options,
                ) catch |err| {
                    return protocol.valkeyErrorToJS(
                        go,
                        "Failed to send " ++ command.toString(),
                        err,
                    );
                };
                return promise.toJS();
            }
        };
    }

    // 2-arity method like SET
    pub fn @"(key: RedisKey, value: RedisValue)"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
        comptime arg0_name: []const u8,
        comptime arg1_name: []const u8,
    ) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
                    return go.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();
                const value = (try jsValueToJsArgument(go, cf.argument(1))) orelse {
                    return go.throwInvalidArgumentType(name, arg1_name, "string or buffer");
                };
                defer value.deinit();

                const promise = self.request(
                    go,
                    cf.this(),
                    Command.initById(command, .{ .args = &.{ key, value } }),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(...strings: string[])"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
    ) type {
        return struct {
            pub fn fxn(
                this: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                var args = try std.ArrayList(JSArgument).initCapacity(
                    bun.default_allocator,
                    cf.arguments().len,
                );
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (cf.arguments()) |arg| {
                    const another = (try jsValueToJsArgument(go, arg)) orelse {
                        return go.throwInvalidArgumentType(
                            name,
                            "additional arguments",
                            "string or buffer",
                        );
                    };
                    try args.append(another);
                }

                const promise = this.request(
                    go,
                    cf.this(),
                    Command.initById(command, .{ .args = args.items }),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(key: RedisKey, ...args: RedisKey[])"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
        comptime arg0_name: []const u8,
    ) type {
        return struct {
            pub fn fxn(
                this: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                if (cf.argument(0).isUndefinedOrNull()) {
                    return go.throwMissingArgumentsValue(&.{arg0_name});
                }

                const arguments = cf.arguments();
                var args = try std.ArrayList(JSArgument).initCapacity(
                    bun.default_allocator,
                    arguments.len,
                );
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (arguments) |arg| {
                    if (arg.isUndefinedOrNull()) {
                        continue;
                    }

                    const another = (try jsValueToJsArgument(go, arg)) orelse {
                        return go.throwInvalidArgumentType(
                            name,
                            "additional arguments",
                            "string or buffer",
                        );
                    };
                    try args.append(another);
                }

                const promise = this.request(
                    go,
                    cf.this(),
                    Command.initById(
                        command,
                        .{ .args = args.items },
                    ),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(key: RedisKey, value: RedisValue, value2: RedisValue)"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
        comptime arg0_name: []const u8,
        comptime arg1_name: []const u8,
        comptime arg2_name: []const u8,
    ) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const key = (try jsValueToJsArgument(go, cf.argument(0))) orelse {
                    return go.throwInvalidArgumentType(name, arg0_name, "string or buffer");
                };
                defer key.deinit();
                const value = (try jsValueToJsArgument(go, cf.argument(1))) orelse {
                    return go.throwInvalidArgumentType(name, arg1_name, "string or buffer");
                };
                defer value.deinit();
                const value2 = (try jsValueToJsArgument(go, cf.argument(2))) orelse {
                    return go.throwInvalidArgumentType(name, arg2_name, "string or buffer");
                };
                defer value2.deinit();

                const promise = self.request(
                    go,
                    cf.this(),
                    Command.initById(
                        command,
                        .{ .args = &.{ key, value, value2 } },
                    ),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }

    pub fn @"(key: RedisKey, value: RedisValue, ...args: RedisValue)"(
        comptime name: []const u8,
        comptime command: CommandDescriptor,
    ) type {
        return struct {
            pub fn fxn(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                callframe: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                var args = try std.ArrayList(JSArgument).initCapacity(
                    bun.default_allocator,
                    callframe.arguments().len,
                );
                defer {
                    for (args.items) |*item| {
                        item.deinit();
                    }
                    args.deinit();
                }

                for (callframe.arguments()) |arg| {
                    if (arg.isUndefinedOrNull()) {
                        continue;
                    }

                    const another = (try jsValueToJsArgument(go, arg)) orelse {
                        return go.throwInvalidArgumentType(
                            name,
                            "additional arguments",
                            "string or buffer",
                        );
                    };
                    try args.append(another);
                }

                const promise = self.request(
                    go,
                    callframe.this(),
                    Command.initById(command, .{ .args = args.items }),
                    .{},
                ) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }
};

fn jsValueToJsArgument(go: *bun.jsc.JSGlobalObject, value: bun.jsc.JSValue) !?JSArgument {
    if (value.isUndefinedOrNull()) {
        return null;
    }

    if (value.isNumber()) {
        // Allow numbers to be passed as strings.
        const str = try value.toJSString(go);
        return try JSArgument.fromJSMaybeFile(go, bun.default_allocator, str.toJS(), true);
    }

    return try JSArgument.fromJSMaybeFile(go, bun.default_allocator, value, false);
}

// TODO(markovejnovic): This should be imported from the same location as ValkeyClient.

const bun = @import("bun");
const std = @import("std");
const JSArgument = bun.jsc.Node.BlobOrStringOrBuffer;

const Command = @import("./command.zig").Command;
const CommandDescriptor = @import("./command.zig").CommandDescriptor;

const ValkeyClient = @import("./valkey.zig").ValkeyClient;
const protocol = @import("./valkey.zig").protocol;
