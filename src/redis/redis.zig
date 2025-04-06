// Entry point for Redis client
//
// This file contains the core Redis client implementation with protocol handling

pub const RedisContext = @import("RedisContext.zig");

/// Connection flags to track Redis client state
pub const ConnectionFlags = packed struct {
    is_ready_for_query: bool = false,
    is_processing_data: bool = false,
    is_authenticated: bool = false,
    is_reconnecting: bool = false,
    is_manually_closed: bool = false,
    enable_offline_queue: bool = true,
    needs_to_open_socket: bool = true,
};

/// TLS connection status
pub const TLSStatus = union(enum) {
    none,
    pending,
    ssl_not_available,
    ssl_ok,
};

/// Redis connection status
pub const Status = enum {
    disconnected,
    connecting,
    connected,
    failed,
};

pub const Command = @import("./RedisCommand.zig");

/// Redis protocol types (standalone, TLS, Unix socket)
pub const Protocol = enum {
    standalone,
    standalone_unix,
    standalone_tls,
    standalone_tls_unix,

    pub const Map = bun.ComptimeStringMap(Protocol, .{
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

/// Connection options for Redis client
pub const Options = struct {
    idle_timeout_ms: u32 = 30000,
    connection_timeout_ms: u32 = 10000,
    socket_timeout_ms: u32 = 0,
    enable_auto_reconnect: bool = true,
    max_retries: u32 = 20,
    enable_offline_queue: bool = true,
    enable_debug_logging: bool = false,
    has_tls: bool = false,
};

/// Core Redis client implementation
pub const RedisClient = struct {
    socket: uws.AnySocket,
    status: Status = Status.connecting,

    // Buffer management
    write_buffer: bun.OffsetByteList = .{},
    read_buffer: bun.OffsetByteList = .{},
    last_message_start: u32 = 0,

    in_flight: Command.PromisePair.Queue,
    queue: Command.Entry.Queue,

    // Connection parameters
    password: []const u8 = "",
    username: []const u8 = "",
    database: u32 = 0,
    hostname: []const u8 = "",
    port: u16 = 6379,
    protocol: Protocol = .standalone,

    connection_strings: []u8 = &.{},

    // TLS support
    tls_ctx: ?*uws.SocketContext = null,
    tls_status: TLSStatus = .none,

    // Timeout and reconnection management
    idle_timeout_interval_ms: u32 = 0,
    connection_timeout_ms: u32 = 0,
    socket_timeout_ms: u32 = 0,
    retry_attempts: u32 = 0,
    max_retries: u32 = 20, // Maximum retry attempts
    enable_auto_reconnect: bool = true,
    enable_offline_queue: bool = true,

    flags: ConnectionFlags = .{},
    allocator: std.mem.Allocator,

    /// Clean up resources used by the Redis client
    pub fn deinit(this: *@This()) void {
        var pending = this.in_flight;
        this.in_flight = .init(this.allocator);
        defer pending.deinit();
        var commands = this.queue;
        this.queue = .init(this.allocator);
        defer commands.deinit();

        for (pending.readableSlice(0)) |pair| {
            var pair_ = pair;
            pair_.rejectCommand(this.globalObject(), "Connection closed", protocol.RedisError.ConnectionClosed);
        }

        for (commands.readableSlice(0)) |cmd| {
            var offline_cmd = cmd;
            offline_cmd.promise.reject(this.globalObject(), "Connection closed", protocol.RedisError.ConnectionClosed);
            offline_cmd.deinit(this.allocator);
        }

        this.allocator.free(this.connection_strings);
        this.write_buffer.deinit(this.allocator);
        this.read_buffer.deinit(this.allocator);
    }

    /// Get the appropriate timeout interval based on connection state
    pub fn getTimeoutInterval(this: *const RedisClient) u32 {
        return switch (this.status) {
            .connected => this.idle_timeout_interval_ms,
            .failed => 0,
            else => this.connection_timeout_ms,
        };
    }

    pub fn hasAnyPendingCommands(this: *const RedisClient) bool {
        return this.in_flight.readableLength() > 0 or this.queue.readableLength() > 0 or this.write_buffer.len() > 0;
    }

    /// Calculate reconnect delay with exponential backoff
    pub fn getReconnectDelay(this: *const RedisClient) u32 {
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
    fn rejectAllPendingCommands(this: *RedisClient, message: []const u8, err: protocol.RedisError) void {
        var pending = this.in_flight;
        defer pending.deinit();
        var entries = this.queue;
        defer entries.deinit();
        this.in_flight = .init(this.allocator);
        this.queue = .init(this.allocator);

        const globalThis = this.globalObject();
        // Reject commands in the command queue
        for (pending.readableSlice(0)) |item| {
            var command_pair = item;
            command_pair.rejectCommand(globalThis, message, err);
        }

        // Reject commands in the offline queue
        for (entries.readableSlice(0)) |item| {
            var cmd = item;
            cmd.promise.reject(globalThis, message, err);
            cmd.deinit(this.allocator);
        }
    }

    /// Flush pending data to the socket
    pub fn flushData(this: *RedisClient) void {
        const chunk = this.write_buffer.remaining();
        if (chunk.len == 0) return;
        const wrote = this.socket.write(chunk, false);
        if (wrote > 0) {
            this.write_buffer.consume(@intCast(wrote));
        }
    }

    /// Mark the connection as failed with error message
    pub fn fail(this: *RedisClient, message: []const u8, err: protocol.RedisError) void {
        debug("failed: {s}: {s}", .{ message, @errorName(err) });
        if (this.status == .failed) return;

        this.status = .failed;

        this.rejectAllPendingCommands(message, err);
    }

    /// Handle connection closed event
    pub fn onClose(this: *RedisClient) void {
        this.write_buffer.deinit(this.allocator);

        // If manually closing, don't attempt to reconnect
        if (this.flags.is_manually_closed) {
            debug("skip reconnecting since the connection is manually closed", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            this.onRedisClose();
            return;
        }

        // If auto reconnect is disabled, just fail
        if (!this.enable_auto_reconnect) {
            debug("skip reconnecting since auto reconnect is disabled", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            this.onRedisClose();
            return;
        }

        // Calculate reconnection delay with exponential backoff
        this.retry_attempts += 1;
        const delay_ms = this.getReconnectDelay();

        if (delay_ms == 0 or this.retry_attempts > this.max_retries) {
            debug("Max retries reached or retry strategy returned 0, giving up reconnection", .{});
            this.fail("Max reconnection attempts reached", protocol.RedisError.ConnectionClosed);
            this.onRedisClose();
            return;
        }

        debug("reconnect in {d}ms (attempt {d}/{d})", .{ delay_ms, this.retry_attempts, this.max_retries });

        this.status = .disconnected;
        this.flags.is_reconnecting = true;

        // Signal reconnect timer should be started
        this.onRedisReconnect();
    }

    /// Process data received from socket
    pub fn onData(this: *RedisClient, data: []const u8) void {
        // Caller refs / derefs.
        this.flags.is_processing_data = true;
        defer {
            this.flags.is_processing_data = false;
        }

        this.read_buffer.head = this.last_message_start;

        if (this.read_buffer.remaining().len == 0) {
            var reader = protocol.RedisReader.init(data);
            var value = reader.readValue(this.allocator) catch |err| {
                if (err == error.InvalidResponse) {
                    if (comptime bun.Environment.allow_assert) {
                        debug("read_buffer: empty and received short read", .{});
                    }

                    this.read_buffer.head = 0;
                    this.last_message_start = 0;
                    this.read_buffer.byte_list.len = 0;
                    this.read_buffer.write(this.allocator, data) catch @panic("failed to write to read buffer");
                } else {
                    this.fail("Failed to read data", err);
                }
                return;
            };
            defer value.deinit(this.allocator);

            this.handleResponse(&value) catch |err| {
                this.fail("Failed to handle response", err);
                return;
            };
            return;
        }

        this.read_buffer.write(this.allocator, data) catch @panic("failed to write to read buffer");
        var reader = protocol.RedisReader.init(this.read_buffer.remaining());
        var value = reader.readValue(this.allocator) catch |err| {
            if (err != error.InvalidResponse) {
                this.fail("Failed to read data", err);
                return;
            }

            if (comptime bun.Environment.allow_assert) {
                debug("read_buffer: not empty and received short read", .{});
            }
            return;
        };
        defer value.deinit(this.allocator);

        this.handleResponse(&value) catch |err| {
            this.fail("Failed to handle response", err);
            return;
        };

        debug("clean read_buffer", .{});
        this.last_message_start = 0;
        this.read_buffer.head = 0;
    }

    /// Handle Redis protocol response
    fn handleResponse(this: *RedisClient, value: *protocol.RESPValue) !void {
        // Special handling for the initial HELLO response
        if (!this.flags.is_authenticated) {
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
                        this.onRedisConnect();
                        return;
                    }
                    this.fail("Authentication failed", protocol.RedisError.AuthenticationFailed);
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

                    this.onRedisConnect();
                    return;
                },
                else => {
                    this.fail("Authentication failed with unexpected response", protocol.RedisError.AuthenticationFailed);
                    return;
                },
            }

            // We've handled the HELLO response without consuming anything from the command queue
            return;
        }

        // For regular commands, get the next command+promise pair from the queue
        var pair = this.in_flight.readItem() orelse {
            debug("Received response but no promise in queue", .{});
            return;
        };

        const command_type = pair.command_type;

        // Handle the response based on command type
        switch (command_type) {
            .Exists => {
                // EXISTS returns 1 if key exists, 0 if not - we convert to boolean
                if (value.* == .Integer) {
                    const int_value = value.Integer;
                    value.* = .{ .Boolean = int_value > 0 };
                }
            },
            .Generic => {}, // No special handling for generic commands
        }

        // Resolve the promise with the potentially transformed value
        var promise_ptr = &pair.promise;
        const globalThis = this.globalObject();
        const loop = globalThis.bunVM().eventLoop();

        loop.enter();
        defer loop.exit();
        promise_ptr.resolve(globalThis, value);
    }

    /// Send authentication command to Redis server
    fn authenticate(this: *RedisClient) void {
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
        var hello_cmd = protocol.RedisCommand{
            .command = "HELLO",
            .args = hello_args,
        };

        hello_cmd.format(this.writer()) catch |err| {
            this.fail("Failed to write HELLO command", err);
            return;
        };

        // If using a specific database, send SELECT command
        if (this.database > 0) {
            var int_buf: [16]u8 = undefined;
            const db_str = std.fmt.bufPrintZ(&int_buf, "{d}", .{this.database}) catch {
                this.fail("Failed to format database number", protocol.RedisError.InvalidDatabase);
                return;
            };
            var select_cmd = protocol.RedisCommand{
                .command = "SELECT",
                .args = &[_][]const u8{db_str},
            };
            select_cmd.format(this.writer()) catch |err| {
                this.fail("Failed to write SELECT command", err);
                return;
            };
        }
    }

    /// Handle socket open event
    pub fn onOpen(this: *RedisClient, socket: uws.AnySocket) void {
        this.socket = socket;
        this.write_buffer.deinit(this.allocator);
        this.read_buffer.deinit(this.allocator);
        this.start();
    }

    /// Start the connection process
    fn start(this: *RedisClient) void {
        this.authenticate();
        this.flushData();
    }

    /// Process queued commands in the offline queue
    pub fn drain(this: *RedisClient) bool {
        var offline_cmd = this.queue.readItem() orelse return false;

        // Add the promise to the command queue first
        this.in_flight.writeItem(.{
            .command_type = offline_cmd.command_type,
            .promise = offline_cmd.promise,
        }) catch |err| {
            debug("Failed to add command to queue: {s}", .{@errorName(err)});
            offline_cmd.promise.reject(this.globalObject(), "Failed to queue command", err);
            offline_cmd.deinit(this.allocator);
            return false;
        };
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
        _ = this.write(data) catch |err| {
            debug("Failed to write offline command: {s}", .{@errorName(err)});
            offline_cmd.promise.reject(this.globalObject(), "Failed to write command from offline queue", err);
            offline_cmd.deinit(this.allocator);
            return false;
        };

        bun.default_allocator.free(data);

        return true;
    }

    pub fn onWritable(this: *RedisClient) void {
        this.ref();
        defer this.deref();

        if (this.write_buffer.remaining().len == 0 and this.flags.is_authenticated) {
            _ = this.drain();
        }

        this.flushData();
    }

    fn enqueue(this: *RedisClient, command: *const Command, promise: *Command.Promise) !void {
        if (this.queue.readableLength() > 0 or !this.flags.is_authenticated) {
            try this.queue.writeItem(try Command.Entry.create(this.allocator, command, promise.*));
            return;
        }

        switch (command.args) {
            inline .slices, .raw => |args, tag| {
                const RedisCommand = if (tag == .slices) protocol.RedisCommandSlice else protocol.RedisCommand;
                var cmd = RedisCommand{
                    .command = command.command,
                    .args = args,
                };

                switch (this.status) {
                    .connecting, .connected => cmd.format(this.writer()) catch |err| {
                        promise.reject(this.globalObject(), "Failed to format command", err);
                        return;
                    },
                    else => unreachable,
                }
            },
        }

        const cmd_pair = Command.PromisePair{
            .command_type = command.command_type,
            .promise = promise.*,
        };

        // Add to queue with command type
        try this.in_flight.writeItem(cmd_pair);

        _ = this.flushData();
    }

    pub fn send(this: *RedisClient, globalThis: *JSC.JSGlobalObject, command: *const Command) !*JSC.JSPromise {
        var promise = Command.Promise.create(globalThis, command.command_type);

        const js_promise = promise.promise.get();
        // Handle disconnected state with offline queue
        switch (this.status) {
            .connecting, .connected => {
                try this.enqueue(command, &promise);
            },
            .disconnected => {
                // Only queue if offline queue is enabled
                if (this.flags.enable_offline_queue) {
                    try this.enqueue(command, &promise);
                } else {
                    promise.reject(globalThis, "Connection is closed and offline queue is disabled", protocol.RedisError.ConnectionClosed);
                    return promise.promise.get();
                }
            },
            .failed => {
                promise.reject(globalThis, "Connection has failed", protocol.RedisError.ConnectionClosed);
                return promise.promise.get();
            },
        }

        return js_promise;
    }

    /// Close the Redis connection
    pub fn disconnect(this: *RedisClient) void {
        this.flags.is_manually_closed = true;

        if (this.status == .connected or this.status == .connecting) {
            this.status = .disconnected;
            this.socket.close();
        }
    }

    /// Get a writer for the connected socket
    pub fn writer(this: *RedisClient) std.io.Writer(*RedisClient, protocol.RedisError, write) {
        return .{ .context = this };
    }

    /// Write data to the socket buffer
    fn write(this: *RedisClient, data: []const u8) protocol.RedisError!usize {
        try this.write_buffer.write(this.allocator, data);
        return data.len;
    }

    /// Increment reference count
    pub fn ref(this: *RedisClient) void {
        this.parent().ref();
    }

    pub fn deref(this: *RedisClient) void {
        this.parent().deref();
    }

    inline fn parent(this: *RedisClient) *JSRedisClient {
        return @fieldParentPtr("client", this);
    }

    inline fn globalObject(this: *RedisClient) *JSC.JSGlobalObject {
        return this.parent().globalObject;
    }

    pub fn onRedisConnect(this: *RedisClient) void {
        this.parent().onRedisConnect();
    }

    pub fn onRedisReconnect(this: *RedisClient) void {
        this.parent().onRedisReconnect();
    }

    pub fn onRedisClose(this: *RedisClient) void {
        this.parent().onRedisClose();
    }

    pub fn onRedisTimeout(this: *RedisClient) void {
        this.parent().onRedisTimeout();
    }
};

const JSRedisClient = JSC.API.Redis;

const JSC = bun.JSC;
const std = @import("std");
const bun = @import("root").bun;
const protocol = @import("redis_protocol.zig");
const js_redis = @import("js_redis.zig");
const debug = bun.Output.scoped(.Redis, false);
const uws = bun.uws;
const Slice = JSC.ZigString.Slice;
