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
                self._promise.resolve(go, value.toJSWithOptions(go, .{
                    ._return_as_buffer = self.return_as_buffer,
                }));
            }

            pub fn reject(
                self: @This(),
                go: *bun.jsc.JSGlobalObject,
                reason: bun.JSError!bun.jsc.JSValue,
            ) void {
                self._promise.reject(go, reason.toJS());
            }
        };

        user_request: UserRequest,
    };

    const ZigClient = ValkeyClient(ValkeyClientListener, RequestContext);

    /// This listener is passed into the ValkeyClient. ValkeyClient invokes these methods on
    /// certain events.
    const ValkeyClientListener = struct {
        fn parent(self: *@This()) *JsValkey {
            return @alignCast(@fieldParentPtr("_client_listener", self));
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

            Self.debug(
                "JSRef State = {s}",
                .{if (jsvlk._js_this.isStrong()) "strong" else "weak"},
            );
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
        const ReqType = ZigClient.RequestType;

        // The goal of this function is to transform Command -> RequestType. To achieve that, we
        // need to enrich the Command with promise.
        const req: ReqType = .{
            .command = command,
            .context = .{
                .user_request = RequestContext.UserRequest.init(go, options.return_as_buffer),
            },
        };

        self._client.request(req) catch |err| {
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

    pub const randomKey = MethodFactory.@"()"("RANDOMKEY").call;

    pub const js = bun.jsc.Codegen.JSRedisClient2;
    pub const new = bun.TrivialNew(@This());
    const RefCount = bun.ptr.RefCount(Self, "_ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const debug = bun.Output.scoped(.js_valkey, .visible);
};

/// Codegen for different types of methods.
const MethodFactory = struct {
    const Self = @This();

    /// 0-arity method like RANDOMKEY
    pub fn @"()"(comptime command: []const u8) type {
        return struct {
            pub fn call(
                self: *JsValkey,
                go: *bun.jsc.JSGlobalObject,
                cf: *bun.jsc.CallFrame,
            ) bun.JSError!bun.jsc.JSValue {
                const promise = self.request(go, cf.this(), .{
                    .command = command,
                    .args = .{ .args = &.{} },
                }, .{}) catch |err| {
                    return protocol.valkeyErrorToJS(go, "Failed to send " ++ command, err);
                };
                return promise.toJS();
            }
        };
    }
};

const bun = @import("bun");
const ValkeyClient = @import("./valkey.zig").ValkeyClient;
// TODO(markovejnovic): This should be imported from the same location as ValkeyClient.
const protocol = @import("./valkey.zig").protocol;
const Command = @import("./command.zig").Command;
