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
    write_buffer_before_connection: bun.OffsetByteList = .{},
    write_buffer: bun.OffsetByteList = .{},
    read_buffer: bun.OffsetByteList = .{},
    last_message_start: u32 = 0,

    command_queue: Command.PromisePair.Queue,
    offline_queue: Command.Offline.Queue,

    // Connection parameters
    password: []const u8 = "",
    username: []const u8 = "",
    database: u32 = 0,
    hostname: []const u8 = "",
    port: u16 = 6379,
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
        var command_queue = this.command_queue;
        this.command_queue = .init(this.allocator);
        defer command_queue.deinit();
        var offline_queue = this.offline_queue;
        this.offline_queue = .init(this.allocator);
        defer offline_queue.deinit();

        for (command_queue.readableSlice(0)) |pair| {
            var pair_ = pair;
            pair_.rejectCommand(this.globalObject(), "Connection closed", protocol.RedisError.ConnectionClosed);
        }

        for (offline_queue.readableSlice(0)) |cmd| {
            var offline_cmd = cmd;
            offline_cmd.promise.reject(this.globalObject(), "Connection closed", protocol.RedisError.ConnectionClosed);
            offline_cmd.deinit(this.allocator);
        }

        this.allocator.free(this.connection_strings);
        this.write_buffer.deinit(this.allocator);
        this.write_buffer_before_connection.deinit(this.allocator);
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
    fn rejectAllPendingCommands(this: *RedisClient, message: []const u8) void {
        var command_queue = this.command_queue;
        defer command_queue.deinit();
        var offline_queue = this.offline_queue;
        defer offline_queue.deinit();
        this.command_queue = .init(this.allocator);
        this.offline_queue = .init(this.allocator);

        const globalThis = this.globalObject();
        // Reject commands in the command queue
        for (command_queue.readableSlice(0)) |item| {
            var command_pair = item;
            command_pair.rejectCommand(globalThis, message, protocol.RedisError.ConnectionClosed);
        }

        // Reject commands in the offline queue
        for (offline_queue.readableSlice(0)) |item| {
            var cmd = item;
            cmd.promise.reject(globalThis, message, protocol.RedisError.ConnectionClosed);
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
        this.ref();
        defer this.deref();

        if (this.status != .connected) {
            var command_queue = this.command_queue;
            defer command_queue.deinit();
            this.command_queue = .init(this.allocator);
            const globalThis = this.globalObject();
            for (command_queue.readableSlice(0)) |pair| {
                var command_pair = pair;
                command_pair.rejectCommand(globalThis, message, err);
            }
        }

        this.onRedisClose();
    }

    /// Handle connection closed event
    pub fn onClose(this: *RedisClient) void {
        // If manually closing, don't attempt to reconnect
        if (this.flags.is_manually_closed) {
            debug("skip reconnecting since the connection is manually closed", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            return;
        }

        // If auto reconnect is disabled, just fail
        if (!this.enable_auto_reconnect) {
            debug("skip reconnecting since auto reconnect is disabled", .{});
            this.fail("Connection closed", protocol.RedisError.ConnectionClosed);
            return;
        }

        // Calculate reconnection delay with exponential backoff
        this.retry_attempts += 1;
        const delay_ms = this.getReconnectDelay();

        if (delay_ms == 0 or this.retry_attempts > this.max_retries) {
            debug("Max retries reached or retry strategy returned 0, giving up reconnection", .{});
            this.fail("Max reconnection attempts reached", protocol.RedisError.ConnectionClosed);
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
        this.ref();
        this.flags.is_processing_data = true;

        defer {
            this.flags.is_processing_data = false;
            this.deref();
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
        var pair = this.command_queue.readItem() orelse {
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
        promise_ptr.resolve(this.globalObject(), value);
    }

    /// Send authentication command to Redis server
    pub fn authenticate(this: *RedisClient) void {
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
        this.start();
    }

    /// Start the connection process
    fn start(this: *RedisClient) void {
        this.authenticate(); // This now properly handles the HELLO response internally
        this.flushData();
    }

    /// Process queued commands in the offline queue
    pub fn processOfflineQueue(this: *RedisClient) void {
        if (this.offline_queue.count == 0) return;

        debug("Processing {d} commands from offline queue", .{this.offline_queue.count});

        var offline_queue = this.offline_queue;
        this.offline_queue = .init(this.allocator);
        defer {
            for (offline_queue.readableSlice(0)) |item| {
                var offline_cmd = item;
                offline_cmd.promise.deinit();
                offline_cmd.deinit(this.allocator);
            }

            offline_queue.deinit();
        }

        while (this.offline_queue.readItem()) |item| {
            var offline_cmd = item;

            // Write the pre-serialized data directly to the output buffer
            _ = this.write(offline_cmd.serialized_data) catch |err| {
                debug("Failed to write offline command: {s}", .{@errorName(err)});
                offline_cmd.promise.reject(this.globalObject(), "Failed to write command from offline queue", err);
                offline_cmd.deinit(this.allocator);
                continue;
            };

            // Add the promise to the command queue
            this.command_queue.writeItem(.{
                .command_type = offline_cmd.command_type,
                .promise = offline_cmd.promise,
            }) catch |err| {
                debug("Failed to add command to queue: {s}", .{@errorName(err)});
                offline_cmd.promise.reject(this.globalObject(), "Failed to queue command", err);
                offline_cmd.deinit(this.allocator);
                continue;
            };

            // Free the serialized data buffer only
            this.allocator.free(offline_cmd.serialized_data);
        }

        // Flush all the data at once
        this.flushData();
    }

    /// Send Redis command with string slices
    pub fn send(this: *RedisClient, command: *const Command) !*JSC.JSPromise {
        var promise = Command.Promise.create(this.globalObject(), command.command_type);
        const cmd_pair = Command.PromisePair{
            .command_type = command.command_type,
            .promise = promise,
        };

        // Handle disconnected state with offline queue
        switch (this.status) {
            .connecting, .connected => {},
            .disconnected => {
                // Only queue if offline queue is enabled
                if (this.flags.enable_offline_queue) {
                    debug("Queue command in offline queue: {s}", .{command});

                    // Create offline command and add to queue
                    const offline_cmd = try Command.Offline.create(this.allocator, command, promise);
                    try this.offline_queue.writeItem(offline_cmd);

                    // If auto reconnect is enabled and we're not already reconnecting, try to reconnect
                    if (this.enable_auto_reconnect and !this.flags.is_reconnecting and !this.flags.is_manually_closed) {
                        this.flags.is_reconnecting = true;
                        this.retry_attempts = 0;
                        this.onRedisReconnect();
                    }

                    return promise.promise.get();
                } else {
                    return protocol.RedisError.ConnectionClosed;
                }
            },
            .failed => {
                return protocol.RedisError.ConnectionClosed;
            },
        }

        switch (command.args) {
            inline .slices, .raw => |args, tag| {
                const RedisCommand = if (tag == .slices) protocol.RedisCommandSlice else protocol.RedisCommand;
                var cmd = RedisCommand{
                    .command = command.command,
                    .args = args,
                };

                switch (this.status) {
                    .connecting => try cmd.format(this.writerBeforeConnection()),
                    .connected => try cmd.format(this.writer()),
                    else => unreachable,
                }
            },
        }

        // Add to queue with command type
        try this.command_queue.writeItem(cmd_pair);

        if (this.status == .connected) this.flushData();

        return promise.promise.get();
    }

    /// Close the Redis connection
    pub fn disconnect(this: *RedisClient) void {
        this.flags.is_manually_closed = true;

        if (this.status == .connected or this.status == .connecting) {
            this.status = .disconnected;
            if (!this.socket.isClosed()) {
                this.socket.close();
            }
        }
    }

    /// Get a writer for the connected socket
    pub fn writer(this: *RedisClient) std.io.Writer(*RedisClient, protocol.RedisError, write) {
        return .{ .context = this };
    }

    /// Get a writer for the socket before connection
    pub fn writerBeforeConnection(this: *RedisClient) std.io.Writer(*RedisClient, protocol.RedisError, writeBeforeConnection) {
        return .{ .context = this };
    }

    /// Write data to the socket buffer
    pub fn write(this: *RedisClient, data: []const u8) protocol.RedisError!usize {
        try this.write_buffer.write(this.allocator, data);
        return data.len;
    }

    /// Write data to the buffer before connection
    pub fn writeBeforeConnection(this: *RedisClient, data: []const u8) protocol.RedisError!usize {
        try this.write_buffer_before_connection.write(this.allocator, data);
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
