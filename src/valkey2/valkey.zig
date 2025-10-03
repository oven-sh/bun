///! Fully-featured Valkey/Redis client.
///!
///! Note that this is completely decoupled from JavaScript and adding
///! JavaScript-specific functionality is an anti-pattern.
///!
///! This client is implemented as a state machine. The public interface for
///! `ValkeyClient` exposes a relatively opaque API, with the state machine
///! doing the heavy lifting.
///!
///! This client is designed to be asynchronous. Interacting with the lifecycle
///! of the client is done through the injected `ValkeyListener` type, which
///! may contain any combination of the following methods:
///!  - beforeStateTransition(self: *Self, old_state: ValkeyClient.State,
///!                          new_state: ValkeyClient.State)
///!  - afterStateTransition(self: *Self, old_state: ValkeyClient.State,
///!                         new_state: ValkeyClient.State)
///!
pub fn ValkeyClient(
    comptime ValkeyListener: type,
    comptime RequestContext: type,
) type {
    return struct {
        // The client is implemented as a state machine, with each state representing a different
        // phase of the client's lifecycle.
        const Self = @This();

        /// Set of possible states the ValkeyClient can be in.
        pub const State = ClientState(Self);

        /// Set of possible errors the ValkeyClient can encounter.
        pub const Error = error{
            InvalidState,
            FailedToOpenSocket,
        };

        /// All requests must be given a context which is passed back when the
        /// response is received.
        pub const RequestType = Request(RequestContext);

        /// All responses are paired with the original request context.
        pub const ResponseType = Response(RequestContext);

        /// Type used internal to the client, representing a queued request.
        const QueuedRequestType = QueuedRequest(RequestContext);

        _allocator: std.mem.Allocator,

        /// Underlying WebSocket connection to the Valkey server. Interacts with the client through
        /// `SocketHandler`.
        _socket_io: SocketIO(Self),

        /// Current state of the client. Since the client is a state machine, this encodes the
        /// possible states of the client.
        _state: State,

        /// Queue of commands that are pending to be sent to the server.
        ///
        /// Since it is possible to queue commands while disconnected, this queue is in the base
        /// state.
        _outbound_queue: std.fifo.LinearFifo(QueuedRequestType, .Dynamic),

        /// Queue of commands that have been sent to the server and are awaiting a response.
        ///
        /// TODO(markovejnovic): This implementation is slightly cursed. There's a very redundant
        /// copy because of this queue. Every time we take a message from the outbound queue and
        /// drop it into the inflight queue, we're doing a very unnecessary copy. A better
        /// algorithm would include a marking scheme in the outbound queue, or maybe we would have
        /// some sort of queue tracking the states of each of the commands and their lifetimes.
        /// Food for thought.
        _inflight_queue: std.fifo.LinearFifo(QueuedRequestType, .Dynamic),

        /// The connection parameters used to connect to the Valkey server.
        _connection_params: ConnParams,

        /// Set of user-provided callbacks into the client.
        _callbacks: *ValkeyListener,

        _vm: *bun.jsc.VirtualMachine,
        auto_flusher: AutoFlusher = .{},

        /// Create a new Valkey client instance.
        ///
        /// Arguments:
        ///   - `allocator`: The allocator to use for all allocations.
        ///   - `uws_loop`: The uWS event loop to use for the underlying socket.
        ///   - `url_str`: The connection string to use.
        ///   - `options`: Connection options to use.
        ///   - `callbacks`: The set of callbacks to use for the client.
        ///
        /// Errors:
        ///   - `error.InvalidProtocol` if the protocol is not recognized.
        ///   - `error.InvalidUnixLocation` if the URL is a Unix socket but does not contain a
        ///   valid path.
        ///   - `error.MalformedUrl` in other cases of malformed URLs.
        ///   - `error.FailedToCreateSocket` if the underlying uWS socket could not be created. No
        ///   further details are provided.
        pub fn init(
            allocator: std.mem.Allocator,
            uws_loop: *bun.uws.Loop,
            url_str: []const u8,
            options: ClientOptions,
            callbacks: *ValkeyListener,
            // TODO(markovejnovic): This makes me genuinely sad -- we spent a lot of effort tearing
            //                      out all JS-related code out of this library, but the
            //                      auto-flushing feature still depends on having a VM registered.
            //                      We should do whatever we can to remove this dependency.
            virtual_machine: *bun.jsc.VirtualMachine,
        ) !Self {
            // TODO(markovejnovic): Better log with all the params.
            Self.debug(
                "Initializing Valkey client with URL {s}...",
                .{url_str},
            );
            const cparams = try ConnParams.init(allocator, url_str, options);

            return Self{
                ._allocator = allocator,
                ._callbacks = callbacks,
                ._socket_io = SocketIO(Self).init(options.tls, uws_loop) catch |e| {
                    switch (e) {
                        // This remapping is done because from the user of this library, there is
                        // no point in exposing the details of failure.
                        error.FailedToCreateContext => {
                            return error.FailedToCreateSocket;
                        },
                    }
                },
                ._state = .{ .disconnected = .{} },
                ._outbound_queue = std.fifo.LinearFifo(QueuedRequestType, .Dynamic).init(allocator),
                ._inflight_queue = std.fifo.LinearFifo(QueuedRequestType, .Dynamic).init(allocator),
                ._connection_params = cparams,
                ._vm = virtual_machine,
            };
        }

        /// Estimate the total number of bytes used by this client. This includes @sizeof(Self).
        pub fn memoryUsage(self: *const Self) usize {
            return ((self._outbound_queue.buf.len * @sizeOf(QueuedRequestType)) +
                (self._inflight_queue.buf.len * @sizeOf(QueuedRequestType)) +
                self._state.memoryUsage());
        }

        /// Deinitialize the Valkey client instance.
        pub fn deinit(self: *Self) void {
            _ = self;
        }

        /// Create a new copy of this client.
        pub fn duplicate() Self {}

        /// Start connecting to the Valkey server. Does not block.
        ///
        /// Errors:
        ///   - `Error.InvalidState` if the client is already connected.
        ///   - `Error.FailedToOpenSocket` if the socket failed creation. This is an eager error.
        pub fn startConnecting(self: *Self) Error!void {
            Self.debug("{*} Starting connection to Valkey server...", .{self});

            if (!self._state.canCreateConnection()) {
                return error.InvalidState;
            }

            self._state.transition(.{ .opening = .{} }) catch |err| {
                switch (err) {
                    error.FailedToOpenSocket => {
                        return Error.FailedToOpenSocket;
                    },
                    else => {
                        Self.debug(
                            "{*} Failed to transition to opening state: {any}",
                            .{ self, err },
                        );
                        return Error.InvalidState;
                    },
                }
            };
        }

        /// Attempt to close the connection to the Valkey server.
        pub fn close(self: *Self) Error!void {
            _ = self;
        }

        /// Invoked whenever a slice of bytes is received from the socket. You need to figure out a
        /// way to buffer these bytes and parse them as RESP messages.
        ///
        /// The goal of this function is to deserialize the incoming data and invoke `onPacket`,
        /// which then actually services the packet (based on the state).
        pub fn onData(self: *Self, data: []const u8) void {
            Self.debug("{*}.onData(data.len={})", .{ self, data.len });

            if (self._state != .linked) {
                self._state.warnIllegalState("onData");

                if (comptime bun.Environment.allow_assert) {
                    @panic("Received data while not in linked state");
                }

                // TODO(markovejnovic): This may very well be junk. Probably want to fail noisily
                // rather than silently.
                self._state.recoverFromIllegalState();
                return;
            }

            const state = &self._state.linked;

            // This actually requires quite some work -- we need to accumulate a bunch of data
            // together. The way we do this is through two paths:

            // 1. If the buffer already has data, we append to the buffer and then try to process
            // out of the buffer as much as humanly possible. -- This is batched so will be
            // slightly more efficient.
            const ing_buf = &state._ingress_buffer;
            if (ing_buf.remaining().len > 0) {
                bun.handleOom(ing_buf.write(self._allocator, data));

                // Batch process the buffer.
                while (true) {
                    const rem_buf = ing_buf.remaining();
                    if (rem_buf.len == 0) return;

                    var reader = protocol.ValkeyReader.init(rem_buf);
                    const before_read_pos = reader.pos;

                    // TODO(markovejnovic): This is completely copied out of the original
                    // implementation. Should vet.
                    //
                    // TODO(markovejnovic): I think there's performance on the table here. These
                    // allocations are likely to be sparse since they're happening sparsely with
                    // whatever the client's allocator is -- likely something sparse -- and that
                    // sucks if we're receiving a lot of messages that we might want to process in
                    // parallel. What would be really neat is if we batched subscription Push
                    // messages, for example, all together, so we wouldn't need to deallocate them
                    // individually and could simply drop an arena after all of them are pushed to
                    // the JS frontend. Food for thought.
                    var value = reader.readValue(self._allocator) catch |err| {
                        if (err == error.InvalidResponse) {
                            // Need more data in the buffer, wait for next onData call
                            if (comptime bun.Environment.allow_assert) {
                                Self.debug("read_buffer: needs more data ({d} bytes available)", .{
                                    rem_buf.len,
                                });
                            }
                            return;
                        } else {
                            // TODO(markovejnovic): Fail somehow.
                            return;
                        }
                    };
                    defer value.deinit(self._allocator);

                    const bytes_consumed = reader.pos - before_read_pos;
                    if (bytes_consumed == 0 and rem_buf.len > 0) {
                        // TODO(markovejnovic): Fail somehow.
                        return;
                    }

                    state._ingress_buffer.consume(@truncate(bytes_consumed));

                    var value_to_handle = value; // Use temp var for defer
                    self.onPacket(&value_to_handle) catch {
                        // TODO(markovejnovic): Enable
                        //self.fail("Failed to handle response (buffer path)", err);
                        return;
                    };

                    // Note that handleResponse may change our state. If we're not in a state which
                    // supports the ingress buffer, we should stop processing.
                    if (self._state == .linked) {
                        return;
                    }

                    //self.sendNextCommand();
                }
            }

            // 2. Since the buffer is empty, it's cheaper to just process the data directly.
            // TODO(markovejnovic): This is completely copied out of the original implementation.
            // Should vet.
            var current_data_slice = data; // Create a mutable view of the incoming data
            while (current_data_slice.len > 0) {
                var reader = protocol.ValkeyReader.init(current_data_slice);
                const before_read_pos = reader.pos;

                var value = reader.readValue(self._allocator) catch |err| {
                    if (err == error.InvalidResponse) {
                        // Partial message encountered on the stack-allocated path.
                        // Copy the *remaining* part of the stack data to the heap buffer
                        // and wait for more data.
                        if (comptime bun.Environment.allow_assert) {
                            debug(
                                "read_buffer: partial message on stack ({d} bytes), switching " ++
                                    "to buffer",
                                .{current_data_slice.len - before_read_pos},
                            );
                        }
                        bun.handleOom(state._ingress_buffer.write(
                            self._allocator,
                            current_data_slice[before_read_pos..],
                        ));
                        return; // Exit onData, next call will use the buffer path
                    } else {
                        // Any other error is fatal
                        // TODO(markovejnovic): Fail somehow.
                        //self.fail("Failed to read data (stack path)", err);
                        return;
                    }
                };
                // Successfully read a full message from the stack data
                defer value.deinit(self._allocator);

                const bytes_consumed = reader.pos - before_read_pos;
                if (bytes_consumed == 0) {
                    // This case should ideally not happen if readValue succeeded and slice wasn't
                    // empty
                    // TODO(markovejnovic): Fail somehow.
                    // self.fail("Parser consumed 0 bytes unexpectedly (stack path)",
                    // error.InvalidResponse);
                    return;
                }

                // Advance the view into the stack data slice for the next iteration
                current_data_slice = current_data_slice[bytes_consumed..];

                // Handle the successfully parsed response
                var value_to_handle = value; // Use temp var for defer
                self.onPacket(&value_to_handle) catch {
                    // TODO(markovejnovic): Fail somehow.
                    // self.fail("Failed to handle response (stack path)", err);
                    return;
                };

                // onPacket can change the state of the state machine, so we need to test again if
                // all is well.
                if (self._state != .linked) {
                    return;
                }
                // TODO(markovejnovic): Enable the following
                //self.sendNextCommand();
            }

            // If the loop finishes, the entire 'data' was processed without needing th ebuffer
        }

        /// Invoked by onData for each ingress packet.
        fn onPacket(self: *Self, value: *protocol.RESPValue) !void {
            // If we receive a packet while not linked, something's really fucked up.
            bun.debugAssert(self._state == .linked);

            const l_state = &self._state.linked;

            switch (l_state.state) {
                .normal => {
                    // TODO(markovejnovic)
                    @panic("Not Implemented");
                },
                .authenticating => {
                    try self.onAuthenticatingPacket(value);
                },
                .subscriber => {
                    // TODO(markovejnovic)
                    @panic("Not Implemented");
                },
            }
        }

        fn onAuthenticatingPacket(self: *Self, value: *protocol.RESPValue) !void {
            // TODO(markovejnovic): This is the legacy implementation, almost verbatim.
            Self.debug("Processing HELLO response", .{});
            switch (value.*) {
                .Error => |err| {
                    // TODO(markovejnovic): Enable
                    //self.fail(err, protocol.RedisError.AuthenticationFailed);
                    _ = err;
                    return;
                },
                .SimpleString => |str| {
                    if (std.mem.eql(u8, str, "OK")) {
                        try self._state.transition(.{ .linked = .{ .state = .normal } });
                        return;
                    }
                    // TODO(markovejnovic): Enable
                    //self.fail("Authentication failed (unexpected response)",
                    // protocol.RedisError.AuthenticationFailed,);

                    return;
                },
                .Map => |map| {
                    // This is the HELLO response map
                    Self.debug("Got HELLO response map with {d} entries", .{map.len});

                    // Process the Map response - find the protocol version
                    for (map) |*entry| {
                        switch (entry.key) {
                            .SimpleString => |key| {
                                if (std.mem.eql(u8, key, "proto") and entry.value == .Integer) {
                                    const proto_version = entry.value.Integer;
                                    Self.debug("Server protocol version: {d}", .{proto_version});
                                    if (proto_version != 3) {
                                        // TODO(markovejnovic): Enable
                                        //self.fail("Server does not support RESP3",
                                        //protocol.RedisError.UnsupportedProtocol);
                                        return;
                                    }
                                }
                            },
                            else => {},
                        }
                    }

                    try self._state.transition(.{ .linked = .{ .state = .normal } });
                    return;
                },
                else => {
                    // TODO(markovejnovic): Enable
                    //this.fail("Authentication failed with unexpected response",
                    //protocol.RedisError.AuthenticationFailed);
                    return;
                },
            }
        }

        /// Invoked whenever a write action went through. The nominal use-case is to push more
        /// data.
        pub fn onWritable(self: *Self) void {
            _ = self;
        }

        /// TODO(markovejnovic): When is it invoked?
        pub fn onTimeout(self: *Self) void {
            _ = self;
        }

        /// TODO(markovejnovic): When is it invoked?
        pub fn onConnectError(
            self: *Self,
            _: i32,
        ) void {
            // TODO(markovejnovic): Please implement me!!!
            _ = self;
        }

        /// Invoked whenever a connection is ended but not cleanly closed.
        /// TODO(markovejnovic): Confirm this claim
        pub fn onEnd(self: *Self) void {
            _ = self;
        }

        /// Invoked whenever a connection is successfully closed.
        pub fn onClose(self: *Self) void {
            _ = self;
        }

        /// Invoked when the socket connection has been opened successfully.
        pub fn onOpen(self: *Self) void {
            Self.debug("{*}.onOpen() called, current state={s} @{*}", .{
                self,
                @tagName(self._state),
                &self._state,
            });

            // The socket has opened, it is our responsibility to now transition to either
            // handshake (TLS) or linked (non-TLS).
            switch (self._state) {
                .opening => {
                    // Great, we just opened the client. If we're using TLS, then we transition to
                    // the handshake state. Otherwise, we transition to the linked state.
                    self._state.transition(
                        if (self._socket_io.usingTls())
                            .{ .handshake = .{} }
                        else
                            .{ .linked = .{ .state = .authenticating } },
                    ) catch {
                        self._state.warnIllegalState("onOpen");
                        self._state.recoverFromIllegalState();
                        // TODO(markovejnovic): Try to recover?
                    };
                },
                else => {
                    self._state.warnIllegalState("onOpen");
                    self._state.recoverFromIllegalState();
                },
            }
        }

        /// Test whether the client is currently connected to a Valkey server or
        /// not.
        pub fn isConnected(self: *const Self) bool {
            return switch (self._state) {
                .linked => |*l_state| switch (l_state.state) {
                    .authenticating => false,
                    else => true,
                },
                else => false,
            };
        }

        fn runBeforeStateTransitionCallback(self: *Self, from: *State, to: *State) void {
            if (comptime std.meta.hasFn(ValkeyListener, "beforeStateTransition")) {
                self._callbacks.beforeStateTransition(from, to);
            }
        }

        fn runAfterStateTransitionCallback(self: *Self, from: *State, to: *State) void {
            if (comptime std.meta.hasFn(ValkeyListener, "afterStateTransition")) {
                self._callbacks.afterStateTransition(from, to);
            }
        }

        /// Invoked whenever a state transition is attempted. A state transition may fail, in which
        /// case it will not be committed, ie. the state machine will remain unchanged.
        ///
        /// When adding code to this function you must be really careful with errors. If an error
        /// is thrown, the state transition is aborted and the state machine remains unchanged.
        /// This means that any side-effects that happened before the error was thrown will not be
        /// rolled back. Be very careful with this.
        ///
        /// This does not need to handle illegal transitions, the state machine handles that for
        /// you.
        fn onStateTransition(self: *Self, from_state: *State, to_state: *State) !void {
            Self.debug("{*}.onStateTransition(from={s}, to={s})", .{
                self,
                @tagName(from_state.*),
                @tagName(to_state.*),
            });

            // TODO(markovejnovic): This nesting hurts my eyes.
            switch (from_state.*) {
                .disconnected => {
                    switch (to_state.*) {
                        .opening => {
                            try self.onStateDisconnectedToOpening();
                        },
                        else => {
                            from_state.warnIllegalTransition(to_state);
                            from_state.recoverFromIllegalState();
                        },
                    }
                },
                .opening => {
                    switch (to_state.*) {
                        .linked => |*l_state| {
                            switch (l_state.state) {
                                .authenticating => {
                                    try self.onStateOpeningToAuthenticating();
                                },
                                else => {},
                            }
                        },
                        else => {},
                    }
                },
                else => {},
            }

            self.runAfterStateTransitionCallback(from_state, to_state);
        }

        fn onStateDisconnectedToOpening(self: *Self) !void {
            bun.debugAssert(self._state == .opening);

            Self.debug("{*} Socket is opening...", .{self});
            self._socket_io.startConnecting() catch |e| {
                Self.debug("{*} Failed to start connecting: {any}", .{
                    self,
                    e,
                });
                return e;
            };
        }

        fn onStateOpeningToAuthenticating(self: *Self) !void {
            bun.debugAssert(self._state == .linked);

            Self.debug("{*} Socket is authenticating...", .{self});

            // To authenticate, we need to send the HELLO command around.
            // TODO(markovejnovic): Support RESP 2.

            // Parse commands
            // TODO(markovejnovic): This was taken from the original
            // implementation. Vet this.
            var hello_args_buf: [4][]const u8 = .{ "3", "AUTH", "", "" };
            var hello_args: []const []const u8 = undefined;

            const username = self._connection_params.username;
            const password = self._connection_params.password;
            if (username.len > 0 or password.len > 0) {
                hello_args_buf[2] = if (username.len > 0)
                    username
                else
                    "default";
                hello_args_buf[3] = password;
            } else {
                hello_args = hello_args_buf[0..1];
            }

            var hello_cmd = Command.initById(.HELLO, .{ .raw = hello_args });
            try hello_cmd.write(self.egressWriter());

            // If we're using a specific database, we should also send the
            // SELECT command.
            //
            // What we can do is immediately send the SELECT command after the
            // HELLO command to the egress buffer. This way, we're not waiting
            // for the HELLO response to send the SELECT command.
            //
            // TODO(markovejnovic): Implement this.
            //if (self._connection_params.database > 0) {
            //    const db = bun.string.intToStr(self._connection_params.database,);
            //    var select_cmd = Command.initWithArgs(
            //        "SELECT",
            //        .{ .raw = &[_][]const u8{ db } },
            //    );
            //    select_cmd.write(self.egressWriter()) catch |e| {
            //        Self.debug("{*} Failed to write SELECT command: {any}", .{
            //            self,
            //            e,
            //        });
            //        return e;
            //    };
            //}

            self._state.flushEgressBuffer();
        }

        /// Zig std.io.Writer-compatible interface for writing to the egress
        /// buffer. Note that this can only be called while the socket is in
        /// the `.linked` state. See `_outbound_queue` for details.
        fn egressWriter(self: *Self) std.io.Writer(*Self, protocol.RedisError, egressWrite) {
            // TODO(markovejnovic): This should live in the linked state, not here, so it is
            // type-safer.
            return .{ .context = self };
        }

        /// Write data to the socket buffer
        fn egressWrite(self: *Self, data: []const u8) !usize {
            switch (self._state) {
                .linked => |*l_state| {
                    try l_state._egress_buffer.write(self._allocator, data);
                    return data.len;
                },
                else => {
                    Self.debug(
                        "{*}.egressWrite invoked while in state {s} which does not support " ++
                            "direct egress writing. Data will be lost, and the connection may " ++
                            "be broken.",
                        .{ self, @tagName(self._state) },
                    );

                    // TODO(markovejnovic): Actually go and fix this issue.
                    // TODO(markovejnovic): Definitely wrong error code.
                    return protocol.RedisError.InvalidArgument;
                },
            }
        }

        /// Make a request to the Valkey server.
        ///
        /// Errors:
        /// - `.SubscriptionCompatibility` if the given command is not available in the current
        /// subscription mode.
        pub fn request(self: *Self, req: *Self.RequestType) !void {
            Self.debug("{*}.request({s}, argc={})", .{
                self,
                req.command.command.toString(),
                req.command.args.len(),
            });

            // TODO(markovejnovic): Handle automatically opening the connection.
            switch (self._state) {
                .linked => |*l_state| {
                    switch (l_state.state) {
                        .normal => {
                            // Great, this state can send requests.
                            try self.enqueueRequest(req);
                        },
                        else => {
                            @panic("Not implemneted");
                        },
                    }
                },
                else => {
                    @panic("Not implemented");
                },
            }
        }

        /// Attempt to enqueue a request for sending to the server. This may choose to skip the
        /// queue if appropriate.
        fn enqueueRequest(self: *Self, req: *Self.RequestType) !void {
            const conn_opts = self._connection_params.options;

            const can_pipeline = req.command.canBePipelined() and conn_opts.enable_auto_pipelining;
            const messages_in_queue = self._outbound_queue.readableLength() > 0;
            const must_wait_flush = !req.command.canBePipelined() and messages_in_queue;
            const messages_in_flight = self._inflight_queue.readableLength() > 0;

            const queued_request = bun.handleOom(QueuedRequestType.init(req, self._allocator));

            // - If there are any commands in the queue, it makes sense to just queue this one.
            // - If there are no commands in the queue, and this command is not something that can
            //   be pipelined but there are commands in flight, the best we can do is queue this
            //   command.
            // - If the connection is not ready, then the best we can do is queue this command.
            // - If the command can be pipelined, we can queue it, regardless if there are messages
            //   in flight or not.
            if (messages_in_queue or
                (!can_pipeline and messages_in_flight) or
                !self.readyToTransmit() or
                must_wait_flush or
                can_pipeline)
            {
                bun.handleOom(self._outbound_queue.writeItem(queued_request));

                // If we're connected and using auto pipelining, we should try to flush the queue.
                if (self.readyToTransmit() and can_pipeline) {
                    self.registerAutoFlusher();
                }

                return;
            }

            // Otherwise, what we have to do is attempt to send this command immediately.
            // readyToTransmit() implies that we're in the linked state.
            bun.debugAssert(self.readyToTransmit());
            bun.debugAssert(self._state == .linked);

            req.command.write(self.egressWriter()) catch {
                req.context.failOom(self._callbacks);
                return;
            };

            bun.handleOom(self._inflight_queue.writeItem(queued_request));
            self._state.flushEgressBuffer();
        }

        fn readyToTransmit(self: *const Self) bool {
            return switch (self._state) {
                .linked => |*l_state| switch (l_state.state) {
                    .authenticating => false,
                    else => true,
                },
                else => false,
            };
        }

        ///
        fn registerAutoFlusher(self: *Self) void {
            if (self.auto_flusher.registered)
                return;

            AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(Self, self, self._vm);
            self.auto_flusher.registered = true;
        }

        fn unregisterAutoFlusher(self: *Self) void {
            if (!self.auto_flusher.registered)
                return;

            AutoFlusher.unregisterDeferredMicrotaskWithType(Self, self, self._vm);
            self.auto_flusher.registered = false;
        }

        pub fn onAutoFlush(self: *Self) bool {
            Self.debug("{*}.onAutoFlush()", .{self});

            if (!self.readyToTransmit()) {
                self.auto_flusher.registered = false;
                return false;
            }

            // Drain out the command queue
            var have_more = false;
            var total_bytelength: usize = 0;

            const requests: []QueuedRequestType = brk: {
                var to_process = @constCast(self._outbound_queue.readableSlice(0));
                var total: usize = 0;

                for (to_process) |*req| {
                    if (!req.pipelinable) {
                        break;
                    }

                    bun.handleOom(self._inflight_queue.writeItem(req.*));

                    total += 1;
                    total_bytelength += req.serialized_data.len;
                }
                break :brk to_process[0..total];
            };

            bun.debugAssert(self._state == .linked);
            for (requests) |*req| {
                // All the things that are left are not pipelinable, so we need to manually write
                // them out.
                _ = self.egressWrite(req.serialized_data) catch |err| {
                    // TODO(markovejnovic): This catch block shouldn't be necessary and is simply
                    // debt to accomodate the fact that egressWrite can return a wrong error code.
                    // Should be bun.handleOom
                    Self.debug("{*} Failed to write pipelined command: {any}", .{ self, err });
                };
                self._allocator.free(req.serialized_data);
            }

            self._outbound_queue.discard(requests.len);

            self._state.flushEgressBuffer();

            have_more = self._outbound_queue.readableLength() > 0;
            self.auto_flusher.registered = have_more;

            return have_more;
        }

        const debug = bun.Output.scoped(.valkey, .visible);
    };
}

/// Enum representing whether SSL/TLS is enabled or not.
///
/// Better than a flag because it commuicates intent more clearly.
const SslMode = enum(u1) {
    with_ssl,
    without_ssl,

    pub fn sslEnabled(self: SslMode) bool {
        return switch (self) {
            .with_ssl => true,
            .without_ssl => false,
        };
    }

    pub fn fromBool(enabled: bool) SslMode {
        return switch (enabled) {
            true => .with_ssl,
            false => .without_ssl,
        };
    }
};

/// Structure which handles the WebSocket events for the Valkey client. Encapsulates the socket and
/// its context.
pub fn SocketIO(ValkeyClientType: type) type {
    return struct {
        const Self = @This();

        _socket: bun.uws.AnySocket,
        _context: *bun.uws.SocketContext,

        /// Attempt to create a new SocketIO instance.
        ///
        /// Errors:
        ///   - `error.FailedToCreateContext` if the underlying uWS context could not be created.
        ///   No further details are provided.
        pub fn init(tls_config: TlsConfig, uws_loop: *bun.uws.Loop) !Self {
            return Self{
                ._context = try Self.createAndConfigureUwsContext(
                    tls_config,
                    uws_loop,
                ),
                // TODO(markovejnovic): Feels strange that we're initializing a
                // detached socket here. Maybe we should initialize the TCP socket
                // or TLS socket directly?
                ._socket = .{ .SocketTCP = .{ .socket = .{ .detached = {} } } },
            };
        }

        pub fn deinit(self: *Self) void {
            self._context.deinit(false);
        }

        /// Create a new uWS context given the TLS configuration.
        ///
        /// Errors:
        /// - `error.FailedToCreateContext` if the context could not be created. No further details
        /// are provided.
        fn createAndConfigureUwsContext(
            tls_config: TlsConfig,
            uws_loop: *bun.uws.Loop,
        ) !*bun.uws.SocketContext {
            // TODO(markovejnovic): The original implementation used to have
            // support for vm.rareData(). We should probably add that back in.
            switch (tls_config) {
                .none => {
                    const HandlerType = Self.SocketHandler(.without_ssl);

                    const ctx = bun.uws.SocketContext.createNoSSLContext(
                        uws_loop,
                        @sizeOf(*Self),
                    ) orelse {
                        // TODO(markovejnovic): Maybe get a detailed error?
                        return error.FailedToCreateContext;
                    };

                    HandlerType.SocketHandlerType.configure(
                        ctx,
                        true,
                        *Self,
                        HandlerType,
                    );

                    return ctx;
                },
                .enabled => {
                    // TODO(markovejnovic): Implement
                    unreachable;
                },
                .custom => |*ssl_config| {
                    // TODO(markovejnovic): Implement
                    _ = ssl_config;
                    unreachable;
                },
            }
        }

        /// Fetch the ValkeyClient which owns this SocketIO.
        fn parentClient(self: *Self) *ValkeyClientType {
            return @alignCast(@fieldParentPtr("_socket_io", self));
        }

        pub fn write(self: *Self, data: []const u8) i32 {
            return self._socket.write(data);
        }

        /// Check if the socket is using TLS.
        pub fn usingTls(self: *const Self) bool {
            return switch (self._socket) {
                .SocketTLS => true,
                .SocketTCP => false,
            };
        }

        /// Begin the connection process. Doesn't block.
        pub fn startConnecting(self: *Self) !void {
            if (self.usingTls()) {
                // TODO(markovejnovic): Implement TLS connection.
                @panic("TLS not implemented yet");
            }

            switch (self.parentClient()._connection_params.address) {
                .tcp => |*tcp| {
                    self._socket = .{
                        .SocketTCP = try bun.uws.SocketTCP.connectAnon(
                            tcp.host,
                            tcp.port,
                            self._context,
                            self,
                            false,
                        ),
                    };
                },
                .unix => |path| {
                    self._socket = .{
                        .SocketTCP = try bun.uws.SocketTCP.connectUnixAnon(
                            path,
                            self._context,
                            self,
                            false,
                        ),
                    };
                },
            }
        }

        /// Interactions between the socket and the Valkey client are handled
        /// here.
        fn SocketHandler(comptime ssl_mode: SslMode) type {
            return struct {
                pub const SocketHandlerType = bun.uws.NewSocketHandler(
                    ssl_mode.sslEnabled(),
                );
                // This is laid out in such a way that SocketIO patches its own
                // state and then lets the state machine handle the event.

                pub fn onOpen(self: *Self, socket: SocketHandlerType) void {
                    Self.debug("{*}.onOpen()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onOpen();
                }

                pub fn onClose(
                    self: *Self,
                    socket: SocketHandlerType,
                    _: i32,
                    _: ?*anyopaque,
                ) void {
                    Self.debug("{*}.onClose()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onClose();
                }

                pub fn onEnd(self: *Self, socket: SocketHandlerType) void {
                    Self.debug("{*}.onEnd()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onEnd();
                }

                pub fn onConnectError(self: *Self, socket: SocketHandlerType, err_code: i32) void {
                    Self.debug("{*}.onConnectError()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onConnectError(err_code);
                }

                pub fn onTimeout(self: *Self, socket: SocketHandlerType) void {
                    Self.debug("{*}.onTimeout()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onTimeout();
                }

                /// Invoked whenever a packet is received from the server.
                pub fn onData(self: *Self, socket: SocketHandlerType, data: []const u8) void {
                    Self.debug("{*}.onData(data.len={})", .{ self, data.len });
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onData(data);
                }

                pub fn onWritable(self: *Self, socket: SocketHandlerType) void {
                    Self.debug("{*}.onWritable()", .{self});
                    self.patchSocket(socket, ssl_mode);
                    self.parentClient().onWritable();
                }
            };
        }

        /// Given a concrete socket, update the opaque socket of `self`.
        ///
        /// Necessary because the socket type can only be deduced at
        /// runtime.
        fn patchSocket(
            self: *Self,
            concrete_socket: anytype,
            comptime ssl_mode: SslMode,
        ) void {
            self._socket = switch (ssl_mode) {
                .with_ssl => bun.uws.AnySocket{ .SocketTLS = concrete_socket },
                .without_ssl => bun.uws.AnySocket{ .SocketTCP = concrete_socket },
            };
        }

        const debug = bun.Output.scoped(.valkey_socket, .visible);
    };
}

/// Generalization of different Valkey server addresses -- Unix or TCP.
const ValkeyAddress = union(enum) {
    const Self = @This();

    const DEFAULT_VALKEY_PORT = 6379;

    tcp: struct {
        host: []const u8,
        port: u16,
    },
    unix: []const u8,

    /// Returns the hostname in the case of TCP, or the path in the case
    /// of a Unix socket.
    pub fn location(self: ValkeyAddress) []const u8 {
        return switch (self) {
            .tcp => |*tcp| tcp.host,
            .unix => |path| path,
        };
    }

    /// Deduce the address from a URL and protocol.
    ///
    /// The resulting ValkeyAddress is a view into the url_as_str.
    pub fn fromUrlProto(
        url_mem: []const u8,
        url: bun.URL,
        proto: ValkeyProtocol,
    ) !ValkeyAddress {
        return if (proto.isUnix())
            .{
                .unix = Self.parseUnixPath(url_mem) catch {
                    Self.debug("Failed to parse UNIX socket path from URL: {s}", .{url_mem});
                    return error.InvalidUnixLocation;
                },
            }
        else
            .{
                .tcp = .{
                    .host = url.displayHostname(),
                    .port = url.getPort() orelse DEFAULT_VALKEY_PORT,
                },
            };
    }

    /// Helper to grab the Unix socket path from a URL.
    fn parseUnixPath(url_mem: []const u8) ![]const u8 {
        const proto_idx = bun.strings.indexOf(url_mem, "://") orelse
            return error.MissingUnixProtocol;

        const sock_path = url_mem[proto_idx + 3 ..];

        if (sock_path.len == 0) {
            return error.MissingUnixProtocol;
        }

        // TODO(markovejnovic): I'm not sure why we do this -- can UNIX sockets
        // contain question marks?
        if (bun.strings.indexOfChar(sock_path, '?')) |query_index| {
            return sock_path[0..query_index];
        }

        return sock_path;
    }

    const debug = bun.Output.scoped(.valkey_address, .visible);
};

/// Protocols used to connect to Valkey server.
const ValkeyProtocol = enum {
    const Self = @This();

    standalone,
    standalone_unix,
    standalone_tls,
    standalone_tls_unix,

    const string_map = bun.ComptimeStringMap(Self, .{
        .{ "valkey", .standalone },
        .{ "valkeys", .standalone_tls },
        .{ "valkey+tls", .standalone_tls },
        .{ "valkey+unix", .standalone_unix },
        .{ "valkey+tls+unix", .standalone_tls_unix },
        .{ "redis", .standalone },
        .{ "rediss", .standalone_tls },
        .{ "redis+tls", .standalone_tls },
        .{ "redis+unix", .standalone_unix },
        .{ "redis+tls+unix", .standalone_tls_unix },
    });

    pub fn legalProtocols() [][]const u8 {
        return .{
            "valkey",
            "valkeys",
            "valkey+tls",
            "valkey+unix",
            "valkey+tls+unix",
            "redis",
            "rediss",
            "redis+tls",
            "redis+unix",
            "redis+tls+unix",
        };
    }

    pub fn isTLS(self: Self) bool {
        return switch (self) {
            .standalone_tls, .standalone_tls_unix => true,
            else => false,
        };
    }

    pub fn isUnix(self: Self) bool {
        return switch (self) {
            .standalone_unix, .standalone_tls_unix => true,
            else => false,
        };
    }

    /// Parse the protocol from a URL.
    /// Returns `standalone` if no protocol is specified.
    /// Errors out with `error.InvalidProtocol` if the protocol is not
    /// recognized.
    pub fn fromUrl(url: bun.URL) !Self {
        if (url.protocol.len == 0) {
            return .standalone;
        }

        return string_map.get(url.protocol) orelse {
            Self.debug(
                "Failed to parse protocol from URL: {s}",
                .{url.protocol},
            );
            return error.InvalidProtocol;
        };
    }

    const debug = bun.Output.scoped(.valkey_protocol, .visible);
};

pub const TlsConfig = union(enum) {
    const Self = @This();

    none,
    enabled,
    // TODO(markovejnovic): This is definitely debt. Should not depend on
    // bun.jsc.*
    custom: bun.jsc.API.ServerConfig.SSLConfig,

    pub fn clone(this: *const Self) Self {
        return switch (this.*) {
            .custom => |*ssl_config| .{ .custom = ssl_config.clone() },
            else => this.*,
        };
    }

    pub fn deinit(this: *Self) void {
        switch (this.*) {
            .custom => |*ssl_config| ssl_config.deinit(),
            else => {},
        }
    }

    pub fn toSslMode(this: *const Self) SslMode {
        return switch (this.*) {
            .none => .without_ssl,
            else => .with_ssl,
        };
    }
};

/// Encodes various secondary options for the valkey client.
const ClientOptions = struct {
    const Self = @This();

    idle_timeout_ms: u32 = 0,
    connection_timeout_ms: u32 = 10_000,
    enable_auto_reconnect: bool = true,
    max_retries: u32 = 20,
    enable_offline_queue: bool = true,
    enable_auto_pipelining: bool = true,
    enable_debug_logging: bool = false,
    tls: TlsConfig = .none,

    pub fn sslMode(self: *const Self) SslMode {
        return switch (self.tls) {
            .none => .without_ssl,
            else => .with_ssl,
        };
    }
};

/// Destructured form valkey URL: `[protocol://]host[:port]/[database]`.
const ConnParams = struct {
    const Self = @This();

    username: []const u8,
    password: []const u8,
    database: u32 = 0,
    address: ValkeyAddress,
    protocol: ValkeyProtocol,
    options: ClientOptions,

    _connection_str: ?[]u8,
    _allocator: std.mem.Allocator,

    /// Create connection parameters from a connection string. The resulting
    /// object owns its own memory.
    ///
    /// Assumes that the URL is well-formed.
    ///
    /// Errors:
    ///   - `error.InvalidProtocol` if the protocol is not recognized.
    ///   - `error.InvalidUnixLocation` if the URL is a Unix socket but
    ///     does not contain a valid path.
    ///   - `error.MalformedUrl` in other cases of malformed URLs.
    ///   - `error.OutOfMemory` if the given allocator fails.
    pub fn init(
        allocator: std.mem.Allocator,
        url_mem: []const u8,
        options: ClientOptions,
    ) !Self {
        const url = bun.URL.parse(url_mem);

        const proto = try ValkeyProtocol.fromUrl(url);

        var self: Self = .{
            .username = "",
            .password = "",
            .database = 0,
            .protocol = proto,
            .address = undefined,
            .options = options,
            ._allocator = allocator,
            ._connection_str = "",
        };

        var owned_loc: []const u8 = undefined;
        const address = try ValkeyAddress.fromUrlProto(url_mem, url, proto);
        const location = address.location();
        if (url.username.len > 0 or url.password.len > 0 or location.len > 0) {
            var builder = bun.StringBuilder{};
            defer builder.deinit(self._allocator);
            // TODO(markovejnovic): 80 columns.
            self.username, self.password, owned_loc = try builder.measureAllocateAppend(
                self._allocator,
                [_][]const u8{
                    url.username,
                    url.password,
                    location,
                },
            );

            builder.moveToSlice(&self._connection_str.?);

            errdefer {
                self._allocator.free(self._connection_str.?);
                self._connection_str = null;
            }
        }

        // We need to set the address here. The value of the constant 'address'
        // is not guaranteed to live long enough, so we need to use our own
        // thing.
        self.address = switch (address) {
            .tcp => |tcp| ValkeyAddress{ .tcp = .{
                .host = owned_loc,
                .port = tcp.port,
            } },
            .unix => ValkeyAddress{ .unix = owned_loc },
        };

        // Let's parse the database. This is very different between UNIX sockets
        // and TCP hosts.
        switch (self.address) {
            .unix => {
                // No database selection for UNIX sockets.
                // TODO(markovejnovic): This _could_ be implemented but would
                // be quite slow.
                //
                // //foo/bar/baz/2
                //
                // is very much a legal file path. What we could do is stat it
                // and if it exists, use it with `dbId = 0`, and if it doesn't
                // try treating the last component as a database ID.
                //
                // Both implementations are likely to break developer
                // expectations so here we just assume dbId = 0. They can pick
                // their DB themselves if they need to, through SELECT.
                return self;
            },
            .tcp => {
                // The database is specified:
                // valkey://foo.bar:6379/2
                if (url.pathname.len == 0) {
                    return self;
                }

                if (url.pathname.len == 1 and url.pathname[0] == '/') {
                    return self;
                }

                const db_id = std.fmt.parseInt(
                    u32,
                    url.pathname[1..],
                    10,
                ) catch {
                    Self.debug(
                        "Failed to parse database ID from path: {s}",
                        .{url.pathname},
                    );
                    return error.MalformedUrl;
                };

                self.database = db_id;

                return self;
            },
        }
    }

    /// Cleanup memory owned by this object, if necessary.
    pub fn deinit(self: *Self) void {
        if (self._connection_str) |str| {
            self._allocator.free(str);
        }
    }

    const debug = bun.Output.scoped(.valkey_conn_params, .visible);
};

test ConnParams {
    const params = try ConnParams.init(
        std.testing.allocator,
        "valkeys://user:pass@localhost:6380/2",
        .{},
    );
    defer params.deinit();

    std.testing.expectEqual("user", params.username);
    std.testing.expectEqual("pass", params.password);
    std.testing.expectEqual(2, params.database);
    std.testing.expectEqualStrings("localhost", params.address.location());
    std.testing.expect(params.protocol.isTLS());
    std.testing.expect(!params.protocol.isUnix());
}

/// State machine which encapsulates the current state of the Valkey client.
pub fn ClientState(ValkeyClientType: type) type {
    return union(enum) {
        const Self = @This();

        /// The client is disconnected and we're waiting to connect.
        disconnected: struct {},

        /// The socket is currently being opened.
        opening: struct {},

        /// The client is performing a TLS handshake. This gets skipped in the
        /// non-TLS case.
        handshake: struct {},

        /// The client is successfully connected at the transport layer and is
        /// receptive to TCP.
        linked: struct {
            /// Encodes whether the link-mode is normal or pub/sub.
            state: enum {
                /// The linked client is negotiating a valkey connection. This is a
                /// slight misnomer since it may not be authentication that is
                /// happening -- even connections without a username and password
                /// associated need to go through this step.
                ///
                /// What this step really ensures is that whatever is on the other
                /// end of the socket is actually a Valkey/Redis server.
                authenticating,

                /// The linked client is in normal mode, sending and receiving
                /// commands.
                normal,

                /// The linked client is in pub/sub mode, receiving messages.
                subscriber,
            },

            /// The buffer used to accumulate outgoing data.
            _egress_buffer: bun.OffsetByteList = .{},

            /// The buffer used to accumulate incoming data.
            _ingress_buffer: bun.OffsetByteList = .{},

            fn memoryUsage(self: *const @This()) usize {
                return self._egress_buffer.memoryCost() +
                    self._ingress_buffer.memoryCost();
            }
        },

        /// The user has closed the connection. This differs from the
        /// `disconnected` state in that we don't attempt to connect automatically.
        closed: struct {},

        /// Flush out any data in the egress buffer to the socket.
        pub fn flushEgressBuffer(self: *Self) void {
            bun.debugAssert(self.* == .linked);

            const chunk = self.linked._egress_buffer.remaining();
            if (chunk.len == 0) {
                return;
            }

            // Note we only write here once? Why? Because uSockets will call onWritable when it's
            // ready to accept more data so we don't need to block here.
            const written = self.parentClient()._socket_io.write(chunk);
            if (written > 0) {
                self.linked._egress_buffer.consume(@intCast(written));
            }
        }

        /// Check if the client is in a state where a new connection can be
        /// initiated.
        pub fn canCreateConnection(self: *const Self) bool {
            return self.* == .disconnected or self.* == .closed;
        }

        pub fn onClose(self: *Self) void {
            Self.debug("{*}.onClose()", .{self});
            switch (self) {
                .disconnected => {},
                .opening => {},
                .handshake => {},
            }
        }

        /// Warn about an illegal event in the current state.
        fn warnIllegalState(self: *Self, event_name: []const u8) void {
            // TODO(markovejnovic): Throw some telemetry in here.
            Self.debug(
                "Received an illegal event '{s}' in {s} state. This is a " ++
                    "programming bug.",
                .{ event_name, @tagName(self.*) },
            );

            if (bun.Environment.allow_assert) {
                @panic("Illegal event.");
            }
        }

        fn warnIllegalTransition(from: *const Self, to: *const Self) void {
            // TODO(markovejnovic): Throw some telemetry in here.
            Self.debug(
                "Attempted an illegal transition from {s} to {s}. This is " ++
                    "a programming bug.",
                .{ @tagName(from.*), @tagName(to.*) },
            );

            if (bun.Environment.allow_assert) {
                @panic("Illegal state transition.");
            }
        }

        /// Attempt to recover from an illegal state by transitioning to the
        /// disconnected state.
        fn recoverFromIllegalState(self: *Self) void {
            Self.debug("Recovering from illegal state by transitioning to disconnected.", .{});
            // TODO(markovejnovic): This transition makes no sense lmao.
            self.transition(.{ .disconnected = .{} }) catch unreachable;
        }

        /// Transition the state machine from one state to another.
        fn transition(self: *Self, new_state: Self) !void {
            Self.debug("{*} Transitioning from {s} to {s}...", .{
                self,
                @tagName(self.*),
                @tagName(new_state),
            });

            // TODO(markovejnovic): This is kind of inefficient.
            var old_state: Self = self.*;

            self.* = new_state;
            self.parentClient().onStateTransition(&old_state, self) catch |err| {
                // If the state transition fails, we actually have to revert
                // the states.
                Self.debug("State transition failed, reverting...", .{});
                self.* = old_state;
                return err;
            };

            Self.debug("State transition to={s} is complete.", .{
                @tagName(self.*),
            });
        }

        /// Fetch the ValkeyClient which owns this SocketIO.
        fn parentClient(self: *Self) *ValkeyClientType {
            return @alignCast(@fieldParentPtr("_state", self));
        }

        pub fn memoryUsage(self: *const Self) usize {
            return switch (self.*) {
                .linked => |*state| state.memoryUsage(),
                else => 0,
            };
        }

        const debug = bun.Output.scoped(.valkey_state, .visible);
    };
}

/// Encodes a command request with a given context. When the request is resolved, the context is
/// returned alongside the response.
fn Request(Context: type) type {
    return struct {
        command: Command,
        context: Context,
    };
}

fn Response(Context: type) type {
    _ = Context;
}

pub const protocol = @import("protocol.zig");

fn QueuedRequest(Context: type) type {
    return struct {
        const Self = @This();
        serialized_data: []u8,
        context: Context,

        // TODO(markovejnovic): These flags are hacks and shouldn't need to exist.
        pipelinable: bool,

        pub fn init(req: *const Request(Context), allocator: std.mem.Allocator) !Self {
            return Self{
                .serialized_data = try req.command.serialize(allocator),
                .context = req.context,
                .pipelinable = req.command.canBePipelined(),
            };
        }
    };
}

const PacketMetadata = struct {};

const std = @import("std");
const bun = @import("bun");
const Command = @import("command.zig").Command;

// TODO(markovejnovic): Remove this dependency. We were so close to removing all dependencies on JS
// APIs, except for the auto flushing.
const AutoFlusher = bun.jsc.WebCore.AutoFlusher;
