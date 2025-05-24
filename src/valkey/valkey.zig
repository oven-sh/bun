// Entry point for Valkey client
//
// This file contains the core Valkey client implementation with protocol handling

pub const ValkeyContext = @import("ValkeyContext.zig");

/// Connection flags to track Valkey client state
pub const ConnectionFlags = packed struct(u8) {
    is_authenticated: bool = false,
    is_manually_closed: bool = false,
    enable_offline_queue: bool = true,
    needs_to_open_socket: bool = true,
    enable_auto_reconnect: bool = true,
    is_reconnecting: bool = false,
    auto_pipelining: bool = true,
    finalized: bool = false,
};

/// Valkey connection status
pub const Status = enum {
    disconnected,
    connecting,
    connected,
    failed,
};

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
    custom: JSC.API.ServerConfig.SSLConfig,

    pub fn deinit(this: *TLS) void {
        switch (this.*) {
            .custom => |*ssl_config| ssl_config.deinit(),
            else => {},
        }
    }

    pub fn rejectUnauthorized(this: *const TLS, vm: *JSC.VirtualMachine) bool {
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

    vm: *JSC.VirtualMachine,

    /// Clean up resources used by the Valkey client
    pub fn deinit(this: *@This(), globalObjectOrFinalizing: ?*JSC.JSGlobalObject) void {
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
                pair_.rejectCommand(globalThis, object);
            }

            for (commands.readableSlice(0)) |cmd| {
                var offline_cmd = cmd;
                offline_cmd.promise.reject(globalThis, object);
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
        this.write_buffer.deinit(this.allocator);
        this.read_buffer.deinit(this.allocator);
        this.tls.deinit();
        this.unregisterAutoFlusher();
    }

    // ** Auto-pipelining **
    fn registerAutoFlusher(this: *ValkeyClient, vm: *JSC.VirtualMachine) void {
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
                }) catch bun.outOfMemory();

                total += 1;
                total_bytelength += command.serialized_data.len;
            }
            break :brk to_process[0..total];
        };

        this.write_buffer.byte_list.ensureUnusedCapacity(this.allocator, total_bytelength) catch bun.outOfMemory();
        for (pipelineable_commands) |*command| {
            this.write_buffer.write(this.allocator, command.serialized_data) catch bun.outOfMemory();
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
        return switch (this.status) {
            .connected => this.idle_timeout_interval_ms,
            .failed => 0,
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
    fn rejectAllPendingCommands(pending_ptr: *Command.PromisePair.Queue, entries_ptr: *Command.Entry.Queue, globalThis: *JSC.JSGlobalObject, allocator: std.mem.Allocator, jsvalue: JSC.JSValue) void {
        var pending = pending_ptr.*;
        var entries = entries_ptr.*;
        defer pending.deinit();
        defer entries.deinit();
        pending_ptr.* = .init(allocator);
        entries_ptr.* = .init(allocator);

        // Reject commands in the command queue
        for (pending.readableSlice(0)) |item| {
            var command_pair = item;
            command_pair.rejectCommand(globalThis, jsvalue);
        }

        // Reject commands in the offline queue
        for (entries.readableSlice(0)) |item| {
            var cmd = item;
            cmd.promise.reject(globalThis, jsvalue);
            cmd.deinit(allocator);
        }
    }

    /// Flush pending data to the socket
    pub fn flushData(this: *ValkeyClient) bool {
        const chunk = this.write_buffer.remaining();
        if (chunk.len == 0) return false;
        const wrote = this.socket.write(chunk, false);
        if (wrote > 0) {
            this.write_buffer.consume(@intCast(wrote));
        }
        return this.write_buffer.len() > 0;
    }

    const DeferredFailure = struct {
        message: []const u8,
        err: protocol.RedisError,
        globalThis: *JSC.JSGlobalObject,
        in_flight: Command.PromisePair.Queue,
        queue: Command.Entry.Queue,

        pub fn run(this: *DeferredFailure) void {
            defer {
                bun.default_allocator.free(this.message);
                bun.destroy(this);
            }
            debug("running deferred failure", .{});
            const err = protocol.valkeyErrorToJS(this.globalThis, this.message, this.err);
            rejectAllPendingCommands(&this.in_flight, &this.queue, this.globalThis, bun.default_allocator, err);
        }

        pub fn enqueue(this: *DeferredFailure) void {
            debug("enqueueing deferred failure", .{});
            const managed_task = JSC.ManagedTask.New(DeferredFailure, run).init(this);
            JSC.VirtualMachine.get().eventLoop().enqueueTask(managed_task);
        }
    };

    /// Mark the connection as failed with error message
    pub fn fail(this: *ValkeyClient, message: []const u8, err: protocol.RedisError) void {
        debug("failed: {s}: {s}", .{ message, @errorName(err) });
        if (this.status == .failed) return;

        if (this.flags.finalized) {
            // We can't run promises inside finalizers.
            if (this.queue.count + this.in_flight.count > 0) {
                const vm = this.vm;
                const deferred_failrue = bun.new(DeferredFailure, .{
                    // This memory is not owned by us.
                    .message = bun.default_allocator.dupe(u8, message) catch bun.outOfMemory(),

                    .err = err,
                    .globalThis = vm.global,
                    .in_flight = this.in_flight,
                    .queue = this.queue,
                });
                this.in_flight = .init(this.allocator);
                this.queue = .init(this.allocator);
                deferred_failrue.enqueue();
            }

            // Allow the finalizer to call .close()
            return;
        }

        const globalThis = this.globalObject();
        this.failWithJSValue(globalThis, protocol.valkeyErrorToJS(globalThis, message, err));
    }

    pub fn failWithJSValue(this: *ValkeyClient, globalThis: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) void {
        this.status = .failed;
        rejectAllPendingCommands(&this.in_flight, &this.queue, globalThis, this.allocator, jsvalue);

        if (!this.flags.is_authenticated) {
            this.flags.is_manually_closed = true;
            this.close();
        }
    }

    pub fn close(this: *ValkeyClient) void {
        const socket = this.socket;
        this.socket = .{ .SocketTCP = .detached };
        socket.close();
    }

    /// Handle connection closed event
    pub fn onClose(this: *ValkeyClient) void {
        this.unregisterAutoFlusher();
        this.write_buffer.deinit(this.allocator);

        // If manually closing, don't attempt to reconnect
        if (this.flags.is_manually_closed) {
            debug("skip reconnecting since the connection is manually closed", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            this.onValkeyClose();
            return;
        }

        // If auto reconnect is disabled, just fail
        if (!this.flags.enable_auto_reconnect) {
            debug("skip reconnecting since auto reconnect is disabled", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            this.onValkeyClose();
            return;
        }

        // Calculate reconnection delay with exponential backoff
        this.retry_attempts += 1;
        const delay_ms = this.getReconnectDelay();

        if (delay_ms == 0 or this.retry_attempts > this.max_retries) {
            debug("Max retries reached or retry strategy returned 0, giving up reconnection", .{});
            this.fail("Max reconnection attempts reached", protocol.RedisError.ConnectionClosed);
            this.onValkeyClose();
            return;
        }

        debug("reconnect in {d}ms (attempt {d}/{d})", .{ delay_ms, this.retry_attempts, this.max_retries });

        this.status = .disconnected;
        this.flags.is_reconnecting = true;

        // Signal reconnect timer should be started
        this.onValkeyReconnect();
    }

    pub fn sendNextCommand(this: *ValkeyClient) void {
        if (this.write_buffer.remaining().len == 0 and this.flags.is_authenticated) {
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
    pub fn onData(this: *ValkeyClient, data: []const u8) void {
        // Caller refs / derefs.

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
                        this.fail("Failed to read data (buffer path)", err);
                        return;
                    }
                };
                defer value.deinit(this.allocator);

                const bytes_consumed = reader.pos - before_read_pos;
                if (bytes_consumed == 0 and remaining_buffer.len > 0) {
                    this.fail("Parser consumed 0 bytes unexpectedly (buffer path)", error.InvalidResponse);
                    return;
                }

                this.read_buffer.consume(@truncate(bytes_consumed));

                var value_to_handle = value; // Use temp var for defer
                this.handleResponse(&value_to_handle) catch |err| {
                    this.fail("Failed to handle response (buffer path)", err);
                    return;
                };

                if (this.status == .disconnected or this.status == .failed) {
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
                    this.fail("Failed to read data (stack path)", err);
                    return;
                }
            };
            // Successfully read a full message from the stack data
            defer value.deinit(this.allocator);

            const bytes_consumed = reader.pos - before_read_pos;
            if (bytes_consumed == 0) {
                // This case should ideally not happen if readValue succeeded and slice wasn't empty
                this.fail("Parser consumed 0 bytes unexpectedly (stack path)", error.InvalidResponse);
                return;
            }

            // Advance the view into the stack data slice for the next iteration
            current_data_slice = current_data_slice[bytes_consumed..];

            // Handle the successfully parsed response
            var value_to_handle = value; // Use temp var for defer
            this.handleResponse(&value_to_handle) catch |err| {
                this.fail("Failed to handle response (stack path)", err);
                return;
            };

            // Check connection status after handling
            if (this.status == .disconnected or this.status == .failed) {
                return;
            }

            // After handling a response, try to send the next command
            this.sendNextCommand();

            // Loop continues with the remainder of current_data_slice
        }

        // If the loop finishes, the entire 'data' was processed without needing the buffer.
    }

    fn handleHelloResponse(this: *ValkeyClient, value: *protocol.RESPValue) void {
        debug("Processing HELLO response", .{});

        switch (value.*) {
            .Error => |err| {
                this.fail(err, protocol.RedisError.AuthenticationFailed);
                return;
            },
            .SimpleString => |str| {
                if (std.mem.eql(u8, str, "OK")) {
                    this.status = .connected;
                    this.flags.is_authenticated = true;
                    this.onValkeyConnect(value);
                    return;
                }
                this.fail("Authentication failed (unexpected response)", protocol.RedisError.AuthenticationFailed);

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
                                        this.fail("Server does not support RESP3", protocol.RedisError.UnsupportedProtocol);
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
                this.onValkeyConnect(value);
                return;
            },
            else => {
                this.fail("Authentication failed with unexpected response", protocol.RedisError.AuthenticationFailed);
                return;
            },
        }
    }

    /// Handle Valkey protocol response
    fn handleResponse(this: *ValkeyClient, value: *protocol.RESPValue) !void {
        debug("onData() {any}", .{value.*});
        // Special handling for the initial HELLO response
        if (!this.flags.is_authenticated) {
            this.handleHelloResponse(value);

            // We've handled the HELLO response without consuming anything from the command queue
            return;
        }

        // For regular commands, get the next command+promise pair from the queue
        var pair = this.in_flight.readItem() orelse {
            debug("Received response but no promise in queue", .{});
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
            promise_ptr.reject(globalThis, value.toJS(globalThis) catch |err| globalThis.takeError(err));
        } else {
            promise_ptr.resolve(globalThis, value);
        }
    }

    /// Send authentication command to Valkey server
    fn authenticate(this: *ValkeyClient) void {
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
            this.fail("Failed to write HELLO command", err);
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
                this.fail("Failed to write SELECT command", err);
                return;
            };
        }
    }

    /// Handle socket open event
    pub fn onOpen(this: *ValkeyClient, socket: uws.AnySocket) void {
        this.socket = socket;
        this.write_buffer.deinit(this.allocator);
        this.read_buffer.deinit(this.allocator);
        this.start();
    }

    /// Start the connection process
    fn start(this: *ValkeyClient) void {
        this.authenticate();
        _ = this.flushData();
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

        const offline_cmd = this.queue.readItem() orelse return false;

        // Add the promise to the command queue first
        this.in_flight.writeItem(.{
            .meta = offline_cmd.meta,
            .promise = offline_cmd.promise,
        }) catch bun.outOfMemory();
        const data = offline_cmd.serialized_data;

        if (this.flags.is_authenticated and this.write_buffer.remaining().len == 0) {
            // Optimization: avoid cloning the data an extra time.
            defer this.allocator.free(data);

            const wrote = this.socket.write(data, false);
            const unwritten = data[@intCast(@max(wrote, 0))..];

            if (unwritten.len > 0) {
                // Handle incomplete write.
                this.write_buffer.write(this.allocator, unwritten) catch bun.outOfMemory();
            }

            return true;
        }

        // Write the pre-serialized data directly to the output buffer
        _ = this.write(data) catch bun.outOfMemory();
        bun.default_allocator.free(data);

        return true;
    }

    pub fn onWritable(this: *ValkeyClient) void {
        this.ref();
        defer this.deref();

        this.sendNextCommand();
    }

    fn enqueue(this: *ValkeyClient, command: *const Command, promise: *Command.Promise) !void {
        const can_pipeline = command.meta.supports_auto_pipelining and this.flags.auto_pipelining;

        // For commands that don't support pipelining, we need to wait for the queue to drain completely
        // before sending the command. This ensures proper order of execution for state-changing commands.
        const must_wait_for_queue = !command.meta.supports_auto_pipelining and this.queue.readableLength() > 0;

        if (
        // If there are any pending commands, queue this one
        this.queue.readableLength() > 0 or
            // With auto pipelining, we can accept commands regardless of in_flight commands
            (!can_pipeline and this.in_flight.readableLength() > 0) or
            // We need authentication before processing commands
            !this.flags.is_authenticated or
            // Commands that don't support pipelining must wait for the entire queue to drain
            must_wait_for_queue or
            // If can pipeline, we can accept commands regardless of in_flight commands
            can_pipeline)
        {
            // We serialize the bytes in here, so we don't need to worry about the lifetime of the Command itself.
            try this.queue.writeItem(try Command.Entry.create(this.allocator, command, promise.*));

            // If we're connected and using auto pipelining, schedule a flush
            if (this.status == .connected and can_pipeline) {
                this.registerAutoFlusher(this.vm);
            }

            return;
        }

        switch (this.status) {
            .connecting, .connected => command.write(this.writer()) catch {
                promise.reject(this.globalObject(), this.globalObject().createOutOfMemoryError());
                return;
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

    pub fn send(this: *ValkeyClient, globalThis: *JSC.JSGlobalObject, command: *const Command) !*JSC.JSPromise {
        var promise = Command.Promise.create(globalThis, command.meta);

        const js_promise = promise.promise.get();
        // Handle disconnected state with offline queue
        switch (this.status) {
            .connecting, .connected => {
                try this.enqueue(command, &promise);

                // Schedule auto-flushing to process this command if pipelining is enabled
                if (this.flags.auto_pipelining and
                    command.meta.supports_auto_pipelining and
                    this.status == .connected and
                    this.queue.readableLength() > 0)
                {
                    this.registerAutoFlusher(this.vm);
                }
            },
            .disconnected => {
                // Only queue if offline queue is enabled
                if (this.flags.enable_offline_queue) {
                    try this.enqueue(command, &promise);
                } else {
                    promise.reject(globalThis, globalThis.ERR(.REDIS_CONNECTION_CLOSED, "Connection is closed and offline queue is disabled", .{}).toJS());
                }
            },
            .failed => {
                promise.reject(globalThis, globalThis.ERR(.REDIS_CONNECTION_CLOSED, "Connection has failed", .{}).toJS());
            },
        }

        return js_promise;
    }

    /// Close the Valkey connection
    pub fn disconnect(this: *ValkeyClient) void {
        this.flags.is_manually_closed = true;
        this.unregisterAutoFlusher();
        if (this.status == .connected or this.status == .connecting) {
            this.status = .disconnected;
            this.close();
        }
    }

    /// Get a writer for the connected socket
    pub fn writer(this: *ValkeyClient) std.io.Writer(*ValkeyClient, protocol.RedisError, write) {
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

    inline fn globalObject(this: *ValkeyClient) *JSC.JSGlobalObject {
        return this.parent().globalObject;
    }

    pub fn onValkeyConnect(this: *ValkeyClient, value: *protocol.RESPValue) void {
        this.parent().onValkeyConnect(value);
    }

    pub fn onValkeyReconnect(this: *ValkeyClient) void {
        this.parent().onValkeyReconnect();
    }

    pub fn onValkeyClose(this: *ValkeyClient) void {
        this.parent().onValkeyClose();
    }

    pub fn onValkeyTimeout(this: *ValkeyClient) void {
        this.parent().onValkeyTimeout();
    }
};

// Auto-pipelining
const AutoFlusher = JSC.WebCore.AutoFlusher;

const JSValkeyClient = JSC.API.Valkey;

const JSC = bun.JSC;
const std = @import("std");
const bun = @import("bun");
const protocol = @import("valkey_protocol.zig");
const debug = bun.Output.scoped(.Redis, false);
const uws = bun.uws;
