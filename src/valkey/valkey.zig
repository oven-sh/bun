// Entry point for Valkey client
//
// This file contains the core Valkey client implementation with protocol handling

pub const ValkeyContext = @import("./ValkeyContext.zig");

/// Connection flags to track Valkey client state
pub const ConnectionFlags = struct {
    // TODO(markovejnovic): I am not a huge fan of these flags. I would
    // consider refactoring them into an enumerated state machine, as that
    // feels significantly more natural compared to a bag of booleans.
    is_authenticated: bool = false,
    is_manually_closed: bool = false,
    is_selecting_db_internal: bool = false,
    enable_offline_queue: bool = true,
    needs_to_open_socket: bool = true,
    enable_auto_reconnect: bool = true,
    is_reconnecting: bool = false,
    failed: bool = false,
    enable_auto_pipelining: bool = true,
    finalized: bool = false,
    // This flag is a slight hack to allow returning the client instance in the
    // promise which resolves when the connection is established. There are two
    // modes through which a client may connect:
    //   1. Connect through `client.connect()` which has the semantics of
    //      resolving the promise with the connection information.
    //   2. Through `client.duplicate()` which creates a promise through
    //      `onConnect()` which resolves with the client instance itself.
    // This flag is set to true in the latter case to indicate to the promise
    // resolution delegation to resolve the promise with the client.
    connection_promise_returns_client: bool = false,
};

/// Valkey connection status
pub const Status = enum {
    disconnected,
    connecting,
    connected,
};

pub fn isActive(this: *const Status) bool {
    return switch (this.*) {
        .connected, .connecting => true,
        else => false,
    };
}

pub const Command = @import("./ValkeyCommand.zig");

/// Valkey protocol types (standalone, TLS, Unix socket)
pub const Protocol = enum {
    standalone,
    standalone_unix,
    standalone_tls,
    standalone_tls_unix,

    pub const Map = bun.ComptimeStringMap(Protocol, .{
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

    pub fn isTLS(self: Protocol) bool {
        return switch (self) {
            .standalone_tls, .standalone_tls_unix => true,
            else => false,
        };
    }

    pub fn isUnix(self: Protocol) bool {
        return switch (self) {
            .standalone_unix, .standalone_tls_unix => true,
            else => false,
        };
    }
};

pub const TLS = union(enum) {
    none,
    enabled,
    custom: jsc.API.ServerConfig.SSLConfig,

    pub fn clone(this: *const TLS) TLS {
        return switch (this.*) {
            .custom => |*ssl_config| .{ .custom = ssl_config.clone() },
            else => this.*,
        };
    }

    pub fn deinit(this: *TLS) void {
        switch (this.*) {
            .custom => |*ssl_config| ssl_config.deinit(),
            else => {},
        }
    }

    pub fn rejectUnauthorized(this: *const TLS, vm: *jsc.VirtualMachine) bool {
        return switch (this.*) {
            .custom => |*ssl_config| ssl_config.reject_unauthorized != 0,
            .enabled => vm.getTLSRejectUnauthorized(),
            else => false,
        };
    }
};

/// Connection options for Valkey client
pub const Options = struct {
    idle_timeout_ms: u32 = 0,
    connection_timeout_ms: u32 = 10000,
    enable_auto_reconnect: bool = true,
    max_retries: u32 = 20,
    enable_offline_queue: bool = true,
    enable_auto_pipelining: bool = true,
    enable_debug_logging: bool = false,

    tls: TLS = .none,
};

pub const Address = union(enum) {
    unix: []const u8,
    host: struct {
        host: []const u8,
        port: u16,
    },

    pub fn hostname(this: *const Address) []const u8 {
        return switch (this.*) {
            .unix => |unix_addr| unix_addr,
            .host => |h| h.host,
        };
    }

    pub fn connect(this: *const Address, client: *ValkeyClient, ctx: *bun.uws.SocketContext, is_tls: bool) !uws.AnySocket {
        switch (is_tls) {
            inline else => |tls| {
                const SocketType = if (tls) uws.SocketTLS else uws.SocketTCP;
                const union_field = if (tls) "SocketTLS" else "SocketTCP";
                switch (this.*) {
                    .unix => |path| {
                        return @unionInit(uws.AnySocket, union_field, try SocketType.connectUnixAnon(
                            path,
                            ctx,
                            client,
                            false,
                        ));
                    },
                    .host => |h| {
                        return @unionInit(uws.AnySocket, union_field, try SocketType.connectAnon(
                            h.host,
                            h.port,
                            ctx,
                            client,
                            false,
                        ));
                    },
                }
            },
        }
    }
};

/// Core Valkey client implementation
pub const ValkeyClient = struct {
    socket: uws.AnySocket,
    status: Status = Status.connecting,

    // Buffer management
    write_buffer: bun.OffsetByteList = .{},
    read_buffer: bun.OffsetByteList = .{},

    /// In-flight commands, after the data has been written to the network socket
    in_flight: Command.PromisePair.Queue,

    /// Commands that are waiting to be sent to the server. When pipelining is implemented, this usually will be empty.
    queue: Command.Entry.Queue,

    // Connection parameters
    password: []const u8 = "",
    username: []const u8 = "",
    database: u32 = 0,
    address: Address,
    protocol: Protocol,

    connection_strings: []u8 = &.{},

    // TLS support
    tls: TLS = .none,

    // Timeout and reconnection management
    idle_timeout_interval_ms: u32 = 0,
    connection_timeout_ms: u32 = 0,
    retry_attempts: u32 = 0,
    max_retries: u32 = 20, // Maximum retry attempts

    flags: ConnectionFlags = .{},
    allocator: std.mem.Allocator,

    // Auto-pipelining
    auto_flusher: AutoFlusher = .{},

    vm: *jsc.VirtualMachine,

    /// Clean up resources used by the Valkey client
    pub fn deinit(this: *@This(), globalObjectOrFinalizing: ?*jsc.JSGlobalObject) void {
        var pending = this.in_flight;
        this.in_flight = .init(this.allocator);
        defer pending.deinit();
        var commands = this.queue;
        this.queue = .init(this.allocator);
        defer commands.deinit();

        if (globalObjectOrFinalizing) |globalThis| {
            const object = protocol.valkeyErrorToJS(globalThis, "Connection closed", protocol.RedisError.ConnectionClosed);
            for (pending.readableSlice(0)) |pair| {
                var pair_ = pair;
                pair_.rejectCommand(globalThis, object) catch {}; // TODO: properly propagate exception upwards
            }

            for (commands.readableSlice(0)) |cmd| {
                var offline_cmd = cmd;
                offline_cmd.promise.reject(globalThis, object) catch {}; // TODO: properly propagate exception upwards
                offline_cmd.deinit(this.allocator);
            }
        } else {
            // finalizing. we can't call into JS.
            for (pending.readableSlice(0)) |pair| {
                var pair_ = pair;
                pair_.promise.deinit();
            }

            for (commands.readableSlice(0)) |cmd| {
                var offline_cmd = cmd;
                offline_cmd.promise.deinit();
                offline_cmd.deinit(this.allocator);
            }
        }

        this.allocator.free(this.connection_strings);
        // Note there is no need to deallocate username, password and hostname since they are
        // within the this.connection_strings buffer.
        this.write_buffer.deinit(this.allocator);
        this.read_buffer.deinit(this.allocator);
        this.tls.deinit();
        this.unregisterAutoFlusher();
    }

    // ** Auto-pipelining **
    fn registerAutoFlusher(this: *ValkeyClient, vm: *jsc.VirtualMachine) void {
        if (!this.auto_flusher.registered) {
            AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(@This(), this, vm);
            this.auto_flusher.registered = true;
        }
    }

    fn unregisterAutoFlusher(this: *ValkeyClient) void {
        if (this.auto_flusher.registered) {
            AutoFlusher.unregisterDeferredMicrotaskWithType(@This(), this, this.vm);
            this.auto_flusher.registered = false;
        }
    }

    // Drain auto-pipelined commands
    pub fn onAutoFlush(this: *@This()) bool {
        // Don't process if not connected or already processing
        if (this.status != .connected) {
            this.auto_flusher.registered = false;
            return false;
        }

        this.ref();
        defer this.deref();

        // Start draining the command queue
        var have_more = false;
        var total_bytelength: usize = 0;

        const pipelineable_commands: []Command.Entry = brk: {
            var to_process = @constCast(this.queue.readableSlice(0));
            var total: usize = 0;
            for (to_process) |*command| {
                if (!command.meta.supports_auto_pipelining) {
                    break;
                }

                this.in_flight.writeItem(.{
                    .meta = command.meta,
                    .promise = command.promise,
                }) catch |err| bun.handleOom(err);

                total += 1;
                total_bytelength += command.serialized_data.len;
            }
            break :brk to_process[0..total];
        };

        bun.handleOom(this.write_buffer.byte_list.ensureUnusedCapacity(this.allocator, total_bytelength));
        for (pipelineable_commands) |*command| {
            bun.handleOom(this.write_buffer.write(this.allocator, command.serialized_data));
            // Free the serialized data since we've copied it to the write buffer
            this.allocator.free(command.serialized_data);
        }

        this.queue.discard(pipelineable_commands.len);

        _ = this.flushData();

        have_more = this.queue.readableLength() > 0;
        this.auto_flusher.registered = have_more;

        // Return true if we should schedule another flush
        return have_more;
    }
    // ** End of auto-pipelining **

    /// Get the appropriate timeout interval based on connection state
    pub fn getTimeoutInterval(this: *const ValkeyClient) u32 {
        if (this.flags.failed) return 0;
        return switch (this.status) {
            .connected => this.idle_timeout_interval_ms,
            else => this.connection_timeout_ms,
        };
    }

    pub fn hasAnyPendingCommands(this: *const ValkeyClient) bool {
        return this.in_flight.readableLength() > 0 or
            this.queue.readableLength() > 0 or
            this.write_buffer.len() > 0 or
            this.read_buffer.len() > 0;
    }

    /// Calculate reconnect delay with exponential backoff
    pub fn getReconnectDelay(this: *const ValkeyClient) u32 {
        const base_delay: u32 = 50; // Base delay in ms
        const max_delay: u32 = 2000; // Max delay in ms

        // Fixed backoff calculation to avoid integer overflow
        if (this.retry_attempts == 0) return base_delay;

        // Cap at 10 attempts for backoff calculation to avoid overflow
        const attempt = @min(this.retry_attempts, 10);

        // Use a safer exponential backoff calculation
        var delay: u32 = base_delay;
        var i: u32 = 1;
        while (i < attempt) : (i += 1) {
            // Double the delay up to max_delay
            delay = @min(delay * 2, max_delay);
        }

        return delay;
    }

    /// Reject all pending commands with an error
    fn rejectAllPendingCommands(pending_ptr: *Command.PromisePair.Queue, entries_ptr: *Command.Entry.Queue, globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator, jsvalue: jsc.JSValue) bun.JSTerminated!void {
        var pending = pending_ptr.*;
        var entries = entries_ptr.*;
        defer pending.deinit();
        defer entries.deinit();
        pending_ptr.* = .init(allocator);
        entries_ptr.* = .init(allocator);

        // Reject commands in the command queue
        for (pending.readableSlice(0)) |item| {
            var command_pair = item;
            try command_pair.rejectCommand(globalThis, jsvalue);
        }

        // Reject commands in the offline queue
        for (entries.readableSlice(0)) |item| {
            var cmd = item;
            defer cmd.deinit(allocator);
            try cmd.promise.reject(globalThis, jsvalue);
        }
    }

    /// Flush pending data to the socket
    pub fn flushData(this: *ValkeyClient) bool {
        const chunk = this.write_buffer.remaining();
        if (chunk.len == 0) return false;
        const wrote = this.socket.write(chunk);
        if (wrote > 0) {
            this.write_buffer.consume(@intCast(wrote));
        }
        const has_remaining = this.write_buffer.len() > 0;
        return has_remaining;
    }

    const DeferredFailure = struct {
        message: []const u8,
        err: protocol.RedisError,
        globalThis: *jsc.JSGlobalObject,
        in_flight: Command.PromisePair.Queue,
        queue: Command.Entry.Queue,

        pub fn run(this: *DeferredFailure) bun.JSTerminated!void {
            defer {
                bun.default_allocator.free(this.message);
                bun.destroy(this);
            }
            debug("running deferred failure", .{});
            const err = protocol.valkeyErrorToJS(this.globalThis, this.message, this.err);
            try rejectAllPendingCommands(&this.in_flight, &this.queue, this.globalThis, bun.default_allocator, err);
        }

        pub fn enqueue(this: *DeferredFailure) void {
            debug("enqueueing deferred failure", .{});
            const managed_task = jsc.ManagedTask.New(DeferredFailure, run).init(this);
            jsc.VirtualMachine.get().eventLoop().enqueueTask(managed_task);
        }
    };

    /// Mark the connection as failed with error message
    pub fn fail(this: *ValkeyClient, message: []const u8, err: protocol.RedisError) bun.JSTerminated!void {
        debug("failed: {s}: {}", .{ message, err });
        if (this.flags.failed) return;

        if (this.flags.finalized) {
            // We can't run promises inside finalizers.
            if (this.queue.count + this.in_flight.count > 0) {
                const vm = this.vm;
                const deferred_failure = bun.new(DeferredFailure, .{
                    // This memory is not owned by us.
                    .message = bun.handleOom(bun.default_allocator.dupe(u8, message)),

                    .err = err,
                    .globalThis = vm.global,
                    .in_flight = this.in_flight,
                    .queue = this.queue,
                });
                this.in_flight = .init(this.allocator);
                this.queue = .init(this.allocator);
                deferred_failure.enqueue();
            }

            // Allow the finalizer to call .close()
            return;
        }

        const globalThis = this.globalObject();
        try this.failWithJSValue(globalThis, protocol.valkeyErrorToJS(globalThis, message, err));
    }

    pub fn failWithJSValue(this: *ValkeyClient, globalThis: *jsc.JSGlobalObject, jsvalue: jsc.JSValue) bun.JSTerminated!void {
        if (this.flags.failed) return;
        this.flags.failed = true;
        const val = rejectAllPendingCommands(&this.in_flight, &this.queue, globalThis, this.allocator, jsvalue);

        if (!this.connectionReady()) {
            this.flags.is_manually_closed = true;
            this.close();
        }
        return val;
    }

    pub fn close(this: *ValkeyClient) void {
        const socket = this.socket;
        this.socket = .{ .SocketTCP = .detached };
        socket.close();
    }

    /// Handle connection closed event
    pub fn onClose(this: *ValkeyClient) bun.JSTerminated!void {
        this.unregisterAutoFlusher();
        this.write_buffer.clearAndFree(this.allocator);

        // If manually closing, don't attempt to reconnect
        if (this.flags.is_manually_closed) {
            debug("skip reconnecting since the connection is manually closed", .{});
            try this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            try this.onValkeyClose();
            return;
        }

        // If auto reconnect is disabled, just fail
        if (!this.flags.enable_auto_reconnect) {
            debug("skip reconnecting since auto reconnect is disabled", .{});
            try this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            try this.onValkeyClose();
            return;
        }

        // Calculate reconnection delay with exponential backoff
        this.retry_attempts += 1;
        const delay_ms = this.getReconnectDelay();

        if (delay_ms == 0 or this.retry_attempts > this.max_retries) {
            debug("Max retries reached or retry strategy returned 0, giving up reconnection", .{});
            try this.fail("Max reconnection attempts reached", protocol.RedisError.ConnectionClosed);
            try this.onValkeyClose();
            return;
        }

        debug("reconnect in {d}ms (attempt {d}/{d})", .{ delay_ms, this.retry_attempts, this.max_retries });

        this.flags.is_reconnecting = true;
        this.flags.is_authenticated = false;
        this.flags.is_selecting_db_internal = false;

        // Signal reconnect timer should be started
        this.onValkeyReconnect();
    }

    pub fn sendNextCommand(this: *ValkeyClient) void {
        if (this.write_buffer.remaining().len == 0 and this.connectionReady()) {
            if (this.queue.readableLength() > 0) {
                // Check the command at the head of the queue
                const flags = &this.queue.peekItem(0).meta;

                if (!flags.supports_auto_pipelining) {
                    // Head is non-pipelineable. Try to drain it serially if nothing is in-flight.
                    if (this.in_flight.readableLength() == 0) {
                        _ = this.drain(); // Send the single non-pipelineable command

                        // After draining, check if the *new* head is pipelineable and schedule flush if needed.
                        // This covers sequences like NON_PIPE -> PIPE -> PIPE ...
                        if (this.queue.readableLength() > 0 and this.queue.peekItem(0).meta.supports_auto_pipelining) {
                            this.registerAutoFlusher(this.vm);
                        }
                    } else {
                        // Non-pipelineable command is blocked by in-flight commands. Do nothing, wait for in-flight to finish.
                    }
                } else {
                    // Head is pipelineable. Register the flusher to batch it with others.
                    this.registerAutoFlusher(this.vm);
                }
            } else if (this.in_flight.readableLength() == 0) {
                // Without auto pipelining, wait for in-flight to empty before draining
                _ = this.drain();
            }
        }

        _ = this.flushData();
    }

    /// Process data received from socket
    ///
    /// Caller refs / derefs.
    pub fn onData(this: *ValkeyClient, data: []const u8) bun.JSTerminated!void {
        debug("Low-level onData called with {d} bytes: {s}", .{ data.len, data });
        // Path 1: Buffer already has data, append and process from buffer
        if (this.read_buffer.remaining().len > 0) {
            this.read_buffer.write(this.allocator, data) catch @panic("failed to write to read buffer");

            // Process as many complete messages from the buffer as possible
            while (true) {
                const remaining_buffer = this.read_buffer.remaining();
                if (remaining_buffer.len == 0) {
                    break; // Buffer processed completely
                }

                var reader = protocol.ValkeyReader.init(remaining_buffer);
                const before_read_pos = reader.pos;

                var value = reader.readValue(this.allocator) catch |err| {
                    if (err == error.InvalidResponse) {
                        // Need more data in the buffer, wait for next onData call
                        if (comptime bun.Environment.allow_assert) {
                            debug("read_buffer: needs more data ({d} bytes available)", .{remaining_buffer.len});
                        }
                        return;
                    } else {
                        try this.fail("Failed to read data (buffer path)", err);
                        return;
                    }
                };
                defer value.deinit(this.allocator);

                const bytes_consumed = reader.pos - before_read_pos;
                if (bytes_consumed == 0 and remaining_buffer.len > 0) {
                    try this.fail("Parser consumed 0 bytes unexpectedly (buffer path)", error.InvalidResponse);
                    return;
                }

                this.read_buffer.consume(@truncate(bytes_consumed));

                var value_to_handle = value; // Use temp var for defer
                this.handleResponse(&value_to_handle) catch |err| {
                    try this.fail("Failed to handle response (buffer path)", err);
                    return;
                };

                if (this.status == .disconnected or this.flags.failed) {
                    return;
                }
                this.sendNextCommand();
            }
            return; // Finished processing buffered data for now
        }

        // Path 2: Buffer is empty, try processing directly from stack 'data'
        var current_data_slice = data; // Create a mutable view of the incoming data
        while (current_data_slice.len > 0) {
            var reader = protocol.ValkeyReader.init(current_data_slice);
            const before_read_pos = reader.pos;

            var value = reader.readValue(this.allocator) catch |err| {
                if (err == error.InvalidResponse) {
                    // Partial message encountered on the stack-allocated path.
                    // Copy the *remaining* part of the stack data to the heap buffer
                    // and wait for more data.
                    if (comptime bun.Environment.allow_assert) {
                        debug("read_buffer: partial message on stack ({d} bytes), switching to buffer", .{current_data_slice.len - before_read_pos});
                    }
                    this.read_buffer.write(this.allocator, current_data_slice[before_read_pos..]) catch @panic("failed to write remaining stack data to buffer");
                    return; // Exit onData, next call will use the buffer path
                } else {
                    // Any other error is fatal
                    try this.fail("Failed to read data (stack path)", err);
                    return;
                }
            };
            // Successfully read a full message from the stack data
            defer value.deinit(this.allocator);

            const bytes_consumed = reader.pos - before_read_pos;
            if (bytes_consumed == 0) {
                // This case should ideally not happen if readValue succeeded and slice wasn't empty
                try this.fail("Parser consumed 0 bytes unexpectedly (stack path)", error.InvalidResponse);
                return;
            }

            // Advance the view into the stack data slice for the next iteration
            current_data_slice = current_data_slice[bytes_consumed..];

            // Handle the successfully parsed response
            var value_to_handle = value; // Use temp var for defer
            this.handleResponse(&value_to_handle) catch |err| {
                try this.fail("Failed to handle response (stack path)", err);
                return;
            };

            // Check connection status after handling
            if (this.status == .disconnected or this.flags.failed) {
                return;
            }

            // After handling a response, try to send the next command
            this.sendNextCommand();

            // Loop continues with the remainder of current_data_slice
        }

        // If the loop finishes, the entire 'data' was processed without needing the buffer.
    }

    /// Try handling this response as a subscriber-state response.
    /// Returns `handled` if we handled it, `fallthrough` if we did not.
    fn handleSubscribeResponse(
        this: *ValkeyClient,
        value: *protocol.RESPValue,
        pair: ?*ValkeyCommand.PromisePair,
    ) bun.JSError!enum { handled, fallthrough } {
        // Resolve the promise with the potentially transformed value
        const globalThis = this.globalObject();
        const loop = this.vm.eventLoop();

        debug("Handling a subscribe response: {f}", .{value.*});
        loop.enter();
        defer loop.exit();

        return switch (value.*) {
            .Error => {
                if (pair) |p| {
                    try p.promise.reject(globalThis, value.toJS(globalThis));
                }
                return .handled;
            },
            .Push => |push| {
                const p = this.parent();
                const sub_count = try p._subscription_ctx.channelsSubscribedToCount(globalThis);

                if (protocol.SubscriptionPushMessage.map.get(push.kind)) |msg_type| {
                    switch (msg_type) {
                        .message => {
                            this.onValkeyMessage(push.data);
                            return .handled;
                        },
                        .subscribe => {
                            p.addSubscription();
                            this.onValkeySubscribe(value);

                            // For SUBSCRIBE responses, only resolve the promise for the first channel confirmation
                            // Additional channel confirmations from multi-channel SUBSCRIBE commands don't need promise pairs
                            if (pair) |req_pair| {
                                try req_pair.promise.promise.resolve(globalThis, .jsNumber(sub_count));
                            }
                            return .handled;
                        },
                        .unsubscribe => {
                            try this.onValkeyUnsubscribe();
                            p.removeSubscription();

                            // For UNSUBSCRIBE responses, only resolve the promise if we have one
                            // Additional channel confirmations from multi-channel UNSUBSCRIBE commands don't need promise pairs
                            if (pair) |req_pair| {
                                try req_pair.promise.promise.resolve(globalThis, .js_undefined);
                            }
                            return .handled;
                        },
                    }
                } else {
                    // We should rarely reach this point. If we're guaranteed to be handling a subscribe/unsubscribe,
                    // then this is an unexpected path.
                    @branchHint(.cold);
                    try this.fail(
                        "Push message is not a subscription message.",
                        protocol.RedisError.InvalidResponseType,
                    );
                    return .handled;
                }
            },
            else => {
                // This may be a regular command response. Let's pass it down
                // to the next handler.
                return .fallthrough;
            },
        };
    }

    fn handleHelloResponse(this: *ValkeyClient, value: *protocol.RESPValue) bun.JSTerminated!void {
        debug("Processing HELLO response", .{});

        switch (value.*) {
            .Error => |err| {
                try this.fail(err, protocol.RedisError.AuthenticationFailed);
                return;
            },
            .SimpleString => |str| {
                if (std.mem.eql(u8, str, "OK")) {
                    this.status = .connected;
                    this.flags.is_authenticated = true;
                    try this.onValkeyConnect(value);
                    return;
                }
                try this.fail("Authentication failed (unexpected response)", protocol.RedisError.AuthenticationFailed);

                return;
            },
            .Map => |map| {
                // This is the HELLO response map
                debug("Got HELLO response map with {d} entries", .{map.len});

                // Process the Map response - find the protocol version
                for (map) |*entry| {
                    switch (entry.key) {
                        .SimpleString => |key| {
                            if (std.mem.eql(u8, key, "proto")) {
                                if (entry.value == .Integer) {
                                    const proto_version = entry.value.Integer;
                                    debug("Server protocol version: {d}", .{proto_version});
                                    if (proto_version != 3) {
                                        try this.fail("Server does not support RESP3", protocol.RedisError.UnsupportedProtocol);
                                        return;
                                    }
                                }
                            }
                        },
                        else => {},
                    }
                }

                // Authentication successful via HELLO
                this.status = .connected;
                this.flags.is_authenticated = true;
                try this.onValkeyConnect(value);
                return;
            },
            else => {
                try this.fail("Authentication failed with unexpected response", protocol.RedisError.AuthenticationFailed);
                return;
            },
        }
    }

    /// Handle Valkey protocol response
    fn handleResponse(this: *ValkeyClient, value: *protocol.RESPValue) !void {
        // Special handling for the initial HELLO response
        if (!this.flags.is_authenticated) {
            try this.handleHelloResponse(value);

            // We've handled the HELLO response without consuming anything from the command queue
            return;
        }

        // Handle initial SELECT response
        if (this.flags.is_selecting_db_internal) {
            this.flags.is_selecting_db_internal = false;

            return switch (value.*) {
                .Error => |err_str| {
                    try this.fail(err_str, protocol.RedisError.InvalidCommand);
                },
                .SimpleString => |ok_str| {
                    if (!std.mem.eql(u8, ok_str, "OK")) {
                        // SELECT returned something other than "OK"
                        try this.fail("SELECT command failed with non-OK response", protocol.RedisError.InvalidResponse);
                        return;
                    }

                    // SELECT was successful.
                    debug("SELECT {d} successful", .{this.database});
                    // Connection is now fully ready on the specified database.
                    // If any commands were queued while waiting for SELECT, try to send them.
                    this.sendNextCommand();
                },
                else => { // Unexpected response type for SELECT
                    try this.fail("Received non-SELECT response while in the SELECT state.", protocol.RedisError.InvalidResponse);
                },
            };
        }
        // Check if this is a subscription push message that might not need a promise pair
        var should_consume_promise_pair = true;
        var pair_maybe: ?ValkeyCommand.PromisePair = null;

        // For subscription clients, check if this is a push message that doesn't need a promise pair
        if (this.parent().isSubscriber()) {
            switch (value.*) {
                .Push => |push| {
                    if (protocol.SubscriptionPushMessage.map.get(push.kind)) |msg_type| {
                        switch (msg_type) {
                            .message => {
                                // Message pushes never need promise pairs
                                should_consume_promise_pair = false;
                            },
                            .subscribe, .unsubscribe => {
                                // Subscribe/unsubscribe pushes only need promise pairs if we have pending commands
                                if (this.in_flight.readableLength() == 0) {
                                    should_consume_promise_pair = false;
                                }
                            },
                        }
                    }
                },
                else => {},
            }
        }

        // Only consume promise pair if we determined we need one
        // The reaosn we consume pairs is that a SUBSCRIBE message may actually be followed by a number of SUBSCRIBE
        // responses which indicate all the channels we have connected to. As a stop-gap, we currently ignore the
        // actual of content of the SUBSCRIBE responses and just resolve the first one with the count of channels.
        // TODO(markovejnovic): Do better.
        if (should_consume_promise_pair) {
            pair_maybe = this.in_flight.readItem();
        }

        // We handle subscriptions specially because they are not regular commands and their failure will potentially
        // cause the client to drop out of subscriber mode.
        const request_is_subscribe = if (pair_maybe) |p| p.meta.subscription_request else false;
        if (this.parent().isSubscriber() or request_is_subscribe) {
            debug("This client is a subscriber. Handling as subscriber...", .{});

            switch (value.*) {
                .Error => |err| {
                    try this.fail(err, protocol.RedisError.InvalidResponse);
                    return;
                },
                .Push => |push| {
                    if (protocol.SubscriptionPushMessage.map.get(push.kind)) |_| {
                        if ((try this.handleSubscribeResponse(value, if (pair_maybe) |*pm| pm else null)) == .handled) {
                            return;
                        }
                    } else {
                        @branchHint(.cold);
                        try this.fail(
                            "Unexpected push message kind without promise",
                            protocol.RedisError.InvalidResponseType,
                        );
                        return;
                    }
                },
                else => {
                    // In the else case, we fall through to the regular
                    // handler. Subscribers can send .Push commands which have
                    // the same semantics as regular commands.
                },
            }

            debug("Treating subscriber response as a regular command...", .{});
        }

        // For regular commands, get the next command+promise pair from the queue
        var pair = pair_maybe orelse {
            return;
        };

        const meta = pair.meta;

        // Handle the response based on command type
        if (meta.return_as_bool) {
            // EXISTS returns 1 if key exists, 0 if not - we convert to boolean
            if (value.* == .Integer) {
                const int_value = value.Integer;
                value.* = .{ .Boolean = int_value > 0 };
            }
        }

        // Resolve the promise with the potentially transformed value
        var promise_ptr = &pair.promise;
        const globalThis = this.globalObject();
        const loop = this.vm.eventLoop();

        loop.enter();
        defer loop.exit();

        if (value.* == .Error) {
            try promise_ptr.reject(globalThis, value.toJS(globalThis) catch |err| globalThis.takeError(err));
        } else {
            try promise_ptr.resolve(globalThis, value);
        }
    }

    /// Send authentication command to Valkey server
    fn authenticate(this: *ValkeyClient) bun.JSTerminated!void {
        // First send HELLO command for RESP3 protocol
        debug("Sending HELLO 3 command", .{});

        var hello_args_buf: [4][]const u8 = .{ "3", "AUTH", "", "" };
        var hello_args: []const []const u8 = undefined;

        if (this.username.len > 0 or this.password.len > 0) {
            hello_args_buf[0] = "3";
            hello_args_buf[1] = "AUTH";

            if (this.username.len > 0) {
                hello_args_buf[2] = this.username;
                hello_args_buf[3] = this.password;
            } else {
                hello_args_buf[2] = "default";
                hello_args_buf[3] = this.password;
            }

            hello_args = hello_args_buf[0..4];
        } else {
            hello_args = hello_args_buf[0..1];
        }

        // Format and send the HELLO command without adding to command queue
        // We'll handle this response specially in handleResponse
        var hello_cmd = Command{
            .command = "HELLO",
            .args = .{ .raw = hello_args },
        };

        hello_cmd.write(this.writer()) catch |err| {
            try this.fail("Failed to write HELLO command", err);
            return;
        };

        // If using a specific database, send SELECT command
        if (this.database > 0) {
            var int_buf: [64]u8 = undefined;
            const db_str = std.fmt.bufPrintZ(&int_buf, "{d}", .{this.database}) catch unreachable;
            var select_cmd = Command{
                .command = "SELECT",
                .args = .{ .raw = &[_][]const u8{db_str} },
            };
            select_cmd.write(this.writer()) catch |err| {
                try this.fail("Failed to write SELECT command", err);
                return;
            };
            this.flags.is_selecting_db_internal = true;
        }
    }

    /// Handle socket open event
    pub fn onOpen(this: *ValkeyClient, socket: uws.AnySocket) bun.JSTerminated!void {
        this.socket = socket;
        this.write_buffer.clearAndFree(this.allocator);
        this.read_buffer.clearAndFree(this.allocator);
        if (this.socket == .SocketTCP) {
            // if is tcp, we need to start the connection process
            // if is tls, we need to wait for the handshake to complete
            try this.start();
        }
    }

    /// Start the connection process
    pub fn start(this: *ValkeyClient) bun.JSTerminated!void {
        try this.authenticate();
        _ = this.flushData();
    }

    /// Test whether we are ready to run "normal" RESP commands, such as
    /// get/set, pub/sub, etc.
    fn connectionReady(this: *const ValkeyClient) bool {
        return this.flags.is_authenticated and !this.flags.is_selecting_db_internal;
    }

    /// Process queued commands in the offline queue
    pub fn drain(this: *ValkeyClient) bool {
        // If there's something in the in-flight queue and the next command
        // doesn't support pipelining, we should wait for in-flight commands to complete
        if (this.in_flight.readableLength() > 0) {
            const queue_slice = this.queue.readableSlice(0);
            if (queue_slice.len > 0 and !queue_slice[0].meta.supports_auto_pipelining) {
                return false;
            }
        }

        const offline_cmd = this.queue.readItem() orelse {
            return false;
        };

        // Add the promise to the command queue first
        this.in_flight.writeItem(.{
            .meta = offline_cmd.meta,
            .promise = offline_cmd.promise,
        }) catch |err| bun.handleOom(err);
        const data = offline_cmd.serialized_data;

        if (this.connectionReady() and this.write_buffer.remaining().len == 0) {
            // Optimization: avoid cloning the data an extra time.
            defer this.allocator.free(data);

            const wrote = this.socket.write(data);
            const unwritten = data[@intCast(@max(wrote, 0))..];

            if (unwritten.len > 0) {
                // Handle incomplete write.
                bun.handleOom(this.write_buffer.write(this.allocator, unwritten));
            }

            return true;
        }

        // Write the pre-serialized data directly to the output buffer
        _ = bun.handleOom(this.write(data));
        bun.default_allocator.free(data);

        return true;
    }

    pub fn onWritable(this: *ValkeyClient) void {
        this.ref();
        defer this.deref();

        this.sendNextCommand();
    }

    fn enqueue(this: *ValkeyClient, command: *const Command, promise: *Command.Promise) !void {
        const can_pipeline = command.meta.supports_auto_pipelining and this.flags.enable_auto_pipelining;

        // For commands that don't support pipelining, we need to wait for the queue to drain completely
        // before sending the command. This ensures proper order of execution for state-changing commands.
        const must_wait_for_queue = !command.meta.supports_auto_pipelining and this.queue.readableLength() > 0;

        if (
        // If there are any pending commands, queue this one
        this.queue.readableLength() > 0 or
            // With auto pipelining, we can accept commands regardless of in_flight commands
            (!can_pipeline and this.in_flight.readableLength() > 0) or
            // We need authentication before processing commands
            !this.connectionReady() or
            // Commands that don't support pipelining must wait for the entire queue to drain
            must_wait_for_queue or
            // If can pipeline, we can accept commands regardless of in_flight commands
            can_pipeline)
        {
            // We serialize the bytes in here, so we don't need to worry about the lifetime of the Command itself.
            const entry = try Command.Entry.create(this.allocator, command, promise.*);
            try this.queue.writeItem(entry);

            // If we're connected and using auto pipelining, schedule a flush
            if (this.status == .connected and can_pipeline) {
                this.registerAutoFlusher(this.vm);
            }

            return;
        }

        switch (this.status) {
            .connecting, .connected => {
                command.write(this.writer()) catch {
                    try promise.reject(this.globalObject(), this.globalObject().createOutOfMemoryError());
                    return;
                };
            },
            else => unreachable,
        }

        const cmd_pair = Command.PromisePair{
            .meta = command.meta,
            .promise = promise.*,
        };

        // Add to queue with command type
        try this.in_flight.writeItem(cmd_pair);

        _ = this.flushData();
    }

    pub fn send(this: *ValkeyClient, globalThis: *jsc.JSGlobalObject, command: *const Command) !*jsc.JSPromise {
        // FIX: Check meta before using it for routing decisions
        var checked_command = command.*;
        checked_command.meta = command.meta.check(command);

        var promise = Command.Promise.create(globalThis, checked_command.meta);

        const js_promise = promise.promise.get();
        if (this.flags.failed) {
            try promise.reject(globalThis, globalThis.ERR(.REDIS_CONNECTION_CLOSED, "Connection has failed", .{}).toJS());
        } else {
            // Handle disconnected state with offline queue
            switch (this.status) {
                .connected => {
                    try this.enqueue(&checked_command, &promise);

                    // Schedule auto-flushing to process this command if pipelining is enabled
                    if (this.flags.enable_auto_pipelining and
                        checked_command.meta.supports_auto_pipelining and
                        this.status == .connected and
                        this.queue.readableLength() > 0)
                    {
                        this.registerAutoFlusher(this.vm);
                    }
                },
                .connecting, .disconnected => {
                    // Only queue if offline queue is enabled
                    if (this.flags.enable_offline_queue) {
                        try this.enqueue(&checked_command, &promise);
                    } else {
                        try promise.reject(
                            globalThis,
                            globalThis.ERR(
                                .REDIS_CONNECTION_CLOSED,
                                "Connection is closed and offline queue is disabled",
                                .{},
                            ).toJS(),
                        );
                    }
                },
            }
        }

        return js_promise;
    }

    /// Close the Valkey connection
    pub fn disconnect(this: *ValkeyClient) void {
        this.flags.is_manually_closed = true;
        this.unregisterAutoFlusher();
        if (this.status == .connected or this.status == .connecting) {
            this.close();
        }
    }

    /// Get a writer for the connected socket
    pub fn writer(this: *ValkeyClient) std.Io.GenericWriter(*ValkeyClient, protocol.RedisError, write) {
        return .{ .context = this };
    }

    /// Write data to the socket buffer
    fn write(this: *ValkeyClient, data: []const u8) !usize {
        try this.write_buffer.write(this.allocator, data);
        return data.len;
    }

    /// Increment reference count
    pub fn ref(this: *ValkeyClient) void {
        this.parent().ref();
    }

    pub fn deref(this: *ValkeyClient) void {
        this.parent().deref();
    }

    inline fn parent(this: *ValkeyClient) *JSValkeyClient {
        return @fieldParentPtr("client", this);
    }

    inline fn globalObject(this: *ValkeyClient) *jsc.JSGlobalObject {
        return this.parent().globalObject;
    }

    pub fn onValkeyConnect(this: *ValkeyClient, value: *protocol.RESPValue) bun.JSTerminated!void {
        return this.parent().onValkeyConnect(value);
    }

    pub fn onValkeySubscribe(this: *ValkeyClient, value: *protocol.RESPValue) void {
        this.parent().onValkeySubscribe(value);
    }

    pub fn onValkeyUnsubscribe(this: *ValkeyClient) bun.JSError!void {
        return this.parent().onValkeyUnsubscribe();
    }

    pub fn onValkeyMessage(this: *ValkeyClient, value: []protocol.RESPValue) void {
        this.parent().onValkeyMessage(value);
    }

    pub fn onValkeyReconnect(this: *ValkeyClient) void {
        this.parent().onValkeyReconnect();
    }

    pub fn onValkeyClose(this: *ValkeyClient) bun.JSTerminated!void {
        return this.parent().onValkeyClose();
    }

    pub fn onValkeyTimeout(this: *ValkeyClient) void {
        this.parent().onValkeyTimeout();
    }
};

// Auto-pipelining
const debug = bun.Output.scoped(.Redis, .visible);

const ValkeyCommand = @import("./ValkeyCommand.zig");
const protocol = @import("./valkey_protocol.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
const AutoFlusher = jsc.WebCore.AutoFlusher;
const JSValkeyClient = jsc.API.Valkey;
