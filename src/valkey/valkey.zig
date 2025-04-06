// Entry point for Valkey client
//
// This file contains the core Valkey client implementation with protocol handling

pub const ValkeyContext = @import("ValkeyContext.zig");

/// Connection flags to track Valkey client state
pub const ConnectionFlags = packed struct {
    is_authenticated: bool = false,
    is_manually_closed: bool = false,
    enable_offline_queue: bool = true,
    needs_to_open_socket: bool = true,
    enable_auto_reconnect: bool = true,
    is_reconnecting: bool = false,
};

/// TLS connection status
pub const TLSStatus = union(enum) {
    none,
    pending,
    ssl_not_available,
    ssl_ok,
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
    idle_timeout_ms: u32 = 30000,
    connection_timeout_ms: u32 = 10000,
    socket_timeout_ms: u32 = 0,
    enable_auto_reconnect: bool = true,
    max_retries: u32 = 20,
    enable_offline_queue: bool = true,
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
    last_message_start: u32 = 0,

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
    socket_timeout_ms: u32 = 0,
    retry_attempts: u32 = 0,
    max_retries: u32 = 20, // Maximum retry attempts

    flags: ConnectionFlags = .{},
    allocator: std.mem.Allocator,

    /// Clean up resources used by the Valkey client
    pub fn deinit(this: *@This(), globalObjectOrFinalizing: ?*JSC.JSGlobalObject) void {
        var pending = this.in_flight;
        this.in_flight = .init(this.allocator);
        defer pending.deinit();
        var commands = this.queue;
        this.queue = .init(this.allocator);
        defer commands.deinit();

        if (globalObjectOrFinalizing) |globalThis| {
            const object = protocol.valkeyErrorToJS(globalThis, "Connection closed", protocol.ValkeyError.ConnectionClosed);
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
    }

    /// Get the appropriate timeout interval based on connection state
    pub fn getTimeoutInterval(this: *const ValkeyClient) u32 {
        return switch (this.status) {
            .connected => this.idle_timeout_interval_ms,
            .failed => 0,
            else => this.connection_timeout_ms,
        };
    }

    pub fn hasAnyPendingCommands(this: *const ValkeyClient) bool {
        return this.in_flight.readableLength() > 0 or this.queue.readableLength() > 0 or this.write_buffer.len() > 0;
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
    fn rejectAllPendingCommands(this: *ValkeyClient, globalThis: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) void {
        var pending = this.in_flight;
        defer pending.deinit();
        var entries = this.queue;
        defer entries.deinit();
        this.in_flight = .init(this.allocator);
        this.queue = .init(this.allocator);

        // Reject commands in the command queue
        for (pending.readableSlice(0)) |item| {
            var command_pair = item;
            command_pair.rejectCommand(globalThis, jsvalue);
        }

        // Reject commands in the offline queue
        for (entries.readableSlice(0)) |item| {
            var cmd = item;
            cmd.promise.reject(globalThis, jsvalue);
            cmd.deinit(this.allocator);
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

    /// Mark the connection as failed with error message
    pub fn fail(this: *ValkeyClient, message: []const u8, err: protocol.ValkeyError) void {
        debug("failed: {s}: {s}", .{ message, @errorName(err) });
        if (this.status == .failed) return;

        const globalThis = this.globalObject();
        this.failWithJSValue(globalThis, protocol.valkeyErrorToJS(globalThis, message, err));
    }

    pub fn failWithJSValue(this: *ValkeyClient, globalThis: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) void {
        this.status = .failed;
        this.rejectAllPendingCommands(globalThis, jsvalue);

        if (!this.flags.is_authenticated) {
            this.flags.is_manually_closed = true;
            this.socket.close();
        }
    }

    /// Handle connection closed event
    pub fn onClose(this: *ValkeyClient) void {
        this.write_buffer.deinit(this.allocator);

        // If manually closing, don't attempt to reconnect
        if (this.flags.is_manually_closed) {
            debug("skip reconnecting since the connection is manually closed", .{});
            this.fail("Connection closed", protocol.ValkeyError.ConnectionClosed);
            this.onValkeyClose();
            return;
        }

        // If auto reconnect is disabled, just fail
        if (!this.flags.enable_auto_reconnect) {
            debug("skip reconnecting since auto reconnect is disabled", .{});
            this.fail("Connection closed", protocol.ValkeyError.ConnectionClosed);
            this.onValkeyClose();
            return;
        }

        // Calculate reconnection delay with exponential backoff
        this.retry_attempts += 1;
        const delay_ms = this.getReconnectDelay();

        if (delay_ms == 0 or this.retry_attempts > this.max_retries) {
            debug("Max retries reached or retry strategy returned 0, giving up reconnection", .{});
            this.fail("Max reconnection attempts reached", protocol.ValkeyError.ConnectionClosed);
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
            if (this.in_flight.readableLength() == 0) {
                _ = this.drain();
            }
        }

        _ = this.flushData();
    }

    fn onDataStackAllocated(this: *ValkeyClient, data: []const u8) void {
        var reader = protocol.ValkeyReader.init(data);
        while (true) {
            const before_read = reader.pos;
            var value = reader.readValue(this.allocator) catch |err| {
                if (err == error.InvalidResponse) {
                    if (comptime bun.Environment.allow_assert) {
                        debug("read_buffer: empty and received short read", .{});
                    }

                    this.read_buffer.head = 0;
                    this.last_message_start = 0;
                    this.read_buffer.byte_list.len = 0;
                    this.read_buffer.write(this.allocator, data[before_read..]) catch @panic("failed to write to read buffer");
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
            if (this.status == .disconnected) {
                return;
            }
            this.sendNextCommand();
            if (reader.pos == data.len) {
                break;
            }
        }
    }

    /// Process data received from socket
    pub fn onData(this: *ValkeyClient, data: []const u8) void {
        // Caller refs / derefs.

        this.read_buffer.head = this.last_message_start;

        if (this.read_buffer.remaining().len == 0) {
            this.onDataStackAllocated(data);
            return;
        }

        this.read_buffer.write(this.allocator, data) catch @panic("failed to write to read buffer");
        while (true) {
            var reader = protocol.ValkeyReader.init(this.read_buffer.remaining());
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
            this.read_buffer.consume(@truncate(reader.pos));

            this.handleResponse(&value) catch |err| {
                this.fail("Failed to handle response", err);
                return;
            };

            if (this.status == .disconnected) {
                return;
            }

            this.sendNextCommand();

            if (this.read_buffer.remaining().len == 0) {
                break;
            }
        }
    }

    fn handleHelloResponse(this: *ValkeyClient, value: *protocol.RESPValue) void {
        debug("Processing HELLO response", .{});

        switch (value.*) {
            .Error => |err| {
                this.fail(err, protocol.ValkeyError.AuthenticationFailed);
                return;
            },
            .SimpleString => |str| {
                if (std.mem.eql(u8, str, "OK")) {
                    this.status = .connected;
                    this.flags.is_authenticated = true;
                    this.onValkeyConnect();
                    return;
                }
                this.fail("Authentication failed (unexpected response)", protocol.ValkeyError.AuthenticationFailed);

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
                                        this.fail("Server does not support RESP3", protocol.ValkeyError.UnsupportedProtocol);
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

                this.onValkeyConnect();
                return;
            },
            else => {
                this.fail("Authentication failed with unexpected response", protocol.ValkeyError.AuthenticationFailed);
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
        var hello_cmd = protocol.ValkeyCommand{
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
                this.fail("Failed to format database number", protocol.ValkeyError.InvalidDatabase);
                return;
            };
            var select_cmd = protocol.ValkeyCommand{
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
        const offline_cmd = this.queue.readItem() orelse return false;

        // Add the promise to the command queue first
        this.in_flight.writeItem(.{
            .command_type = offline_cmd.command_type,
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
        if (
        // If there are any pending commands, queue this one
        this.queue.readableLength() > 0 or
            // TODO: pipelining. Unitl then, we need to wait for the previous command to finish.
            this.in_flight.readableLength() > 0 or !this.flags.is_authenticated)
        {
            try this.queue.writeItem(try Command.Entry.create(this.allocator, command, promise.*));
            return;
        }

        switch (command.args) {
            inline .slices, .raw => |args, tag| {
                const ValkeyCommand = if (tag == .slices) protocol.ValkeyCommandSlice else protocol.ValkeyCommand;
                var cmd = ValkeyCommand{
                    .command = command.command,
                    .args = args,
                };

                switch (this.status) {
                    .connecting, .connected => cmd.format(this.writer()) catch {
                        promise.reject(this.globalObject(), this.globalObject().createOutOfMemoryError());
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

    pub fn send(this: *ValkeyClient, globalThis: *JSC.JSGlobalObject, command: *const Command) !*JSC.JSPromise {
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
                    promise.reject(globalThis, globalThis.ERR_VALKEY_CONNECTION_CLOSED("Connection is closed and offline queue is disabled", .{}).toJS());
                }
            },
            .failed => {
                promise.reject(globalThis, globalThis.ERR_VALKEY_CONNECTION_CLOSED("Connection has failed", .{}).toJS());
            },
        }

        return js_promise;
    }

    /// Close the Valkey connection
    pub fn disconnect(this: *ValkeyClient) void {
        this.flags.is_manually_closed = true;

        if (this.status == .connected or this.status == .connecting) {
            this.status = .disconnected;
            this.socket.close();
        }
    }

    /// Get a writer for the connected socket
    pub fn writer(this: *ValkeyClient) std.io.Writer(*ValkeyClient, protocol.ValkeyError, write) {
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

    pub fn onValkeyConnect(this: *ValkeyClient) void {
        this.parent().onValkeyConnect();
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

const JSValkeyClient = JSC.API.Valkey;

const JSC = bun.JSC;
const std = @import("std");
const bun = @import("root").bun;
const protocol = @import("valkey_protocol.zig");
const js_valkey = @import("js_valkey.zig");
const debug = bun.Output.scoped(.Valkey, false);
const uws = bun.uws;
const Slice = JSC.ZigString.Slice;
