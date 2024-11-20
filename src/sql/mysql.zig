const bun = @import("root").bun;
const JSC = bun.JSC;
const String = bun.String;
const uws = bun.uws;
const std = @import("std");
pub const debug = bun.Output.scoped(.MySQL, false);
const Crypto = JSC.API.Bun.Crypto;
const JSValue = JSC.JSValue;
const BoringSSL = @import("../boringssl.zig");

const sql = @import("./shared_sql.zig");
const QueryBindingIterator = sql.QueryBindingIterator;

pub const protocol = @import("./mysql/mysql_protocol.zig");
pub const types = @import("./mysql/mysql_types.zig");

// MySQL integer types
pub const int1 = u8;
pub const int2 = u16;
pub const int3 = u24;
pub const int4 = u32;
pub const int8 = u64;

pub const MySQLInt8 = int1;
pub const MySQLInt16 = int2;
pub const MySQLInt24 = int3;
pub const MySQLInt32 = int4;
pub const MySQLInt64 = int8;
const mysql = @This();

pub const SSLMode = enum(u8) {
    disable = 0,
    prefer = 1,
    require = 2,
    verify_ca = 3,
    verify_full = 4,
};
const Data = sql.Data;
// MySQL capability flags
pub const Capabilities = packed struct(u32) {
    CLIENT_LONG_PASSWORD: bool = false,
    CLIENT_FOUND_ROWS: bool = false,
    CLIENT_LONG_FLAG: bool = false,
    CLIENT_CONNECT_WITH_DB: bool = false,
    CLIENT_NO_SCHEMA: bool = false,
    CLIENT_COMPRESS: bool = false,
    CLIENT_ODBC: bool = false,
    CLIENT_LOCAL_FILES: bool = false,
    CLIENT_IGNORE_SPACE: bool = false,
    CLIENT_PROTOCOL_41: bool = false,
    CLIENT_INTERACTIVE: bool = false,
    CLIENT_SSL: bool = false,
    CLIENT_IGNORE_SIGPIPE: bool = false,
    CLIENT_TRANSACTIONS: bool = false,
    CLIENT_RESERVED: bool = false,
    CLIENT_SECURE_CONNECTION: bool = false,
    CLIENT_MULTI_STATEMENTS: bool = false,
    CLIENT_MULTI_RESULTS: bool = false,
    CLIENT_PS_MULTI_RESULTS: bool = false,
    CLIENT_PLUGIN_AUTH: bool = false,
    CLIENT_CONNECT_ATTRS: bool = false,
    CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: bool = false,
    CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS: bool = false,
    CLIENT_SESSION_TRACK: bool = false,
    CLIENT_DEPRECATE_EOF: bool = false,
    _padding: u7 = 0,

    pub fn toInt(this: Capabilities) u32 {
        return @bitCast(this);
    }

    pub fn fromInt(flags: u32) Capabilities {
        return @bitCast(flags);
    }

    pub fn getDefaultCapabilities() Capabilities {
        return .{
            .CLIENT_PROTOCOL_41 = true,
            .CLIENT_PLUGIN_AUTH = true,
            .CLIENT_SECURE_CONNECTION = true,
            .CLIENT_CONNECT_WITH_DB = true,
            .CLIENT_DEPRECATE_EOF = true,
            .CLIENT_TRANSACTIONS = true,
            .CLIENT_MULTI_STATEMENTS = true,
            .CLIENT_MULTI_RESULTS = true,
            .CLIENT_PS_MULTI_RESULTS = true,
            .CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = true,
        };
    }
};

// MySQL authentication methods
pub const AuthMethod = enum {
    mysql_native_password,
    caching_sha2_password,
    sha256_password,

    pub fn fromString(str: []const u8) ?AuthMethod {
        if (std.mem.eql(u8, str, "mysql_native_password")) {
            return .mysql_native_password;
        } else if (std.mem.eql(u8, str, "caching_sha2_password")) {
            return .caching_sha2_password;
        } else if (std.mem.eql(u8, str, "sha256_password")) {
            return .sha256_password;
        }
        return null;
    }
};

// MySQL connection status flags
pub const StatusFlags = packed struct {
    SERVER_STATUS_IN_TRANS: bool = false,
    SERVER_STATUS_AUTOCOMMIT: bool = false,
    SERVER_MORE_RESULTS_EXISTS: bool = false,
    SERVER_STATUS_NO_GOOD_INDEX_USED: bool = false,
    SERVER_STATUS_NO_INDEX_USED: bool = false,
    SERVER_STATUS_CURSOR_EXISTS: bool = false,
    SERVER_STATUS_LAST_ROW_SENT: bool = false,
    SERVER_STATUS_DB_DROPPED: bool = false,
    SERVER_STATUS_NO_BACKSLASH_ESCAPES: bool = false,
    SERVER_STATUS_METADATA_CHANGED: bool = false,
    SERVER_QUERY_WAS_SLOW: bool = false,
    SERVER_PS_OUT_PARAMS: bool = false,
    SERVER_STATUS_IN_TRANS_READONLY: bool = false,
    SERVER_SESSION_STATE_CHANGED: bool = false,
    _padding: u2 = 0,

    pub fn toInt(this: StatusFlags) u16 {
        return @bitCast(this);
    }

    pub fn fromInt(flags: u16) StatusFlags {
        return @bitCast(flags);
    }
};

// MySQL connection state
pub const ConnectionState = enum {
    disconnected,
    connecting,
    handshaking,
    authenticating,
    connected,
    failed,
};

// Add after the existing code:

const Socket = uws.AnySocket;
const PreparedStatementsMap = std.HashMapUnmanaged(u64, *MySQLStatement, bun.IdentityContext(u64), 80);
const SocketMonitor = @import("./SocketMonitor.zig");

pub const MySQLContext = struct {
    tcp: ?*uws.SocketContext = null,

    onQueryResolveFn: JSC.Strong = .{},
    onQueryRejectFn: JSC.Strong = .{},

    pub fn init(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        var ctx = &globalObject.bunVM().rareData().mysql_context;
        ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
        ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

        return .undefined;
    }

    comptime {
        if (!JSC.is_bindgen) {
            const js_init = JSC.toJSHostFunction(init);
            @export(js_init, .{ .name = "MySQLContext__init" });
        }
    }
};

pub const MySQLConnection = struct {
    socket: Socket,
    status: ConnectionState = .disconnected,
    ref_count: u32 = 1,

    write_buffer: bun.OffsetByteList = .{},
    read_buffer: bun.OffsetByteList = .{},
    last_message_start: u32 = 0,
    sequence_id: u8 = 0,

    requests: std.ArrayList(*MySQLQuery) = undefined,
    statements: PreparedStatementsMap = .{},

    poll_ref: bun.Async.KeepAlive = .{},
    globalObject: *JSC.JSGlobalObject,

    pending_activity_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    js_value: JSValue = JSValue.undefined,

    is_ready_for_query: bool = false,

    server_version: Data = .{ .empty = {} },
    connection_id: u32 = 0,
    capabilities: Capabilities = .{},
    character_set: u8 = 0,
    status_flags: StatusFlags = .{},

    auth_plugin: ?AuthMethod = null,
    auth_state: AuthState = .{ .pending = {} },

    tls_ctx: ?*uws.SocketContext = null,
    tls_config: JSC.API.ServerConfig.SSLConfig = .{},
    tls_status: TLSStatus = .none,
    ssl_mode: SSLMode = .disable,

    on_connect: JSC.Strong = .{},
    on_close: JSC.Strong = .{},

    database: []const u8 = "",
    user: []const u8 = "",
    password: []const u8 = "",

    pub const AuthState = union(enum) {
        pending: void,
        native_password: void,
        caching_sha2: CachingSha2,
        ok: void,

        pub const CachingSha2 = union(enum) {
            fast_auth,
            full_auth,
            waiting_key,
        };
    };

    pub usingnamespace JSC.Codegen.JSMySQLConnection;

    pub fn hasPendingActivity(this: *MySQLConnection) bool {
        @fence(.acquire);
        return this.pending_activity_count.load(.acquire) > 0;
    }

    fn updateHasPendingActivity(this: *MySQLConnection) void {
        @fence(.release);
        const a: u32 = if (this.requests.items.len > 0) 1 else 0;
        const b: u32 = if (this.status != .disconnected) 1 else 0;
        this.pending_activity_count.store(a + b, .release);
    }

    pub fn setStatus(this: *MySQLConnection, status: ConnectionState) void {
        defer this.updateHasPendingActivity();

        if (this.status == status) return;

        this.status = status;
        switch (status) {
            .connected => {
                const on_connect = this.on_connect.swap();
                if (on_connect == .zero) return;
                const js_value = this.js_value;
                js_value.ensureStillAlive();
                this.globalObject.queueMicrotask(on_connect, &[_]JSValue{ JSValue.jsNull(), js_value });
                this.poll_ref.unref(this.globalObject.bunVM());
                this.updateHasPendingActivity();
            },
            else => {},
        }
    }

    pub fn finalize(this: *MySQLConnection) void {
        debug("MySQLConnection finalize", .{});

        // Ensure we disconnect before finalizing
        if (this.status != .disconnected) {
            this.disconnect();
        }

        this.js_value = .zero;
        this.deref();
    }

    pub fn flushData(this: *MySQLConnection) void {
        const chunk = this.write_buffer.remaining();
        if (chunk.len == 0) return;
        const wrote = this.socket.write(chunk, false);
        if (wrote > 0) {
            SocketMonitor.write(chunk[0..@intCast(wrote)]);
            this.write_buffer.consume(@intCast(wrote));
        }
    }

    pub fn failWithJSValue(this: *MySQLConnection, value: JSValue) void {
        defer this.updateHasPendingActivity();
        if (this.status == .failed) return;

        this.status = .failed;
        if (!this.socket.isClosed()) this.socket.close();
        const on_close = this.on_close.swap();
        if (on_close == .zero) return;

        _ = on_close.call(
            this.globalObject,
            this.js_value,
            &[_]JSValue{value},
        ) catch |e| this.globalObject.reportActiveExceptionAsUnhandled(e);
    }

    pub fn fail(this: *MySQLConnection, message: []const u8, err: anyerror) void {
        debug("failed: {s}: {s}", .{ message, @errorName(err) });
        const instance = this.globalObject.createErrorInstance("{s}", .{message});
        instance.put(this.globalObject, JSC.ZigString.static("code"), String.init(@errorName(err)).toJS(this.globalObject));
        this.failWithJSValue(instance);
    }

    pub fn onClose(this: *MySQLConnection) void {
        var vm = this.globalObject.bunVM();
        defer vm.drainMicrotasks();
        this.fail("Connection closed", error.ConnectionClosed);
    }

    fn start(this: *MySQLConnection) void {
        this.sendHandshakeResponse();

        const event_loop = this.globalObject.bunVM().eventLoop();
        event_loop.enter();
        defer event_loop.exit();
        this.flushData();
    }

    pub fn ref(this: *@This()) void {
        bun.assert(this.ref_count > 0);
        this.ref_count += 1;
    }

    pub fn deref(this: *@This()) void {
        const ref_count = this.ref_count;
        this.ref_count -= 1;

        if (ref_count == 1) {
            this.disconnect();
            this.deinit();
        }
    }

    pub fn disconnect(this: *@This()) void {
        if (this.status == .connected) {
            this.status = .disconnected;
            this.poll_ref.disable();

            // Fail any pending requests
            while (this.requests.popOrNull()) |request| {
                request.onError(.{
                    .error_code = 2013, // CR_SERVER_LOST
                    .error_message = .{ .temporary = "Lost connection to MySQL server" },
                }, this.globalObject);
            }

            this.socket.close();
        }
    }

    pub fn deinit(this: *@This()) void {
        debug("MySQLConnection deinit", .{});

        bun.assert(this.ref_count == 0);

        // Clear any pending requests first
        while (this.requests.popOrNull()) |request| {
            request.onError(.{
                .error_code = 2013,
                .error_message = .{ .temporary = "Connection closed" },
            }, this.globalObject);
        }

        for (this.columns) |*column| {
            @constCast(column).deinit();
        }
        bun.default_allocator.free(this.columns);
        bun.default_allocator.free(this.params);
        this.cached_structure.deinit();
        this.error_response.deinit();
        this.signature.deinit();
        bun.default_allocator.destroy(this);
    }

    pub fn onOpen(this: *MySQLConnection, socket: Socket) void {
        this.socket = socket;

        this.poll_ref.ref(this.globalObject.bunVM());
        this.updateHasPendingActivity();

        if (this.tls_status == .message_sent or this.tls_status == .pending) {
            this.startTLS(socket);
            return;
        }

        this.start();
    }

    pub fn onHandshake(this: *MySQLConnection, success: i32, ssl_error: uws.us_bun_verify_error_t) void {
        debug("onHandshake: {d} {d}", .{ success, ssl_error.error_no });

        if (success != 1) {
            this.failWithJSValue(ssl_error.toJS(this.globalObject));
            return;
        }

        if (this.tls_config.reject_unauthorized == 1) {
            if (ssl_error.error_no != 0) {
                this.failWithJSValue(ssl_error.toJS(this.globalObject));
                return;
            }
            const ssl_ptr = @as(*BoringSSL.SSL, @ptrCast(this.socket.getNativeHandle()));
            if (BoringSSL.SSL_get_servername(ssl_ptr, 0)) |servername| {
                const hostname = servername[0..bun.len(servername)];
                if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                    this.failWithJSValue(ssl_error.toJS(this.globalObject));
                }
            }
        }
    }

    pub fn onData(this: *MySQLConnection, data: []const u8) void {
        this.ref();
        const vm = this.globalObject.bunVM();
        defer {
            if (this.status == .connected and this.requests.items.len == 0 and this.write_buffer.remaining().len == 0) {
                // Don't keep the process alive when there's nothing to do.
                this.poll_ref.unref(vm);
            } else if (this.status == .connected) {
                // Keep the process alive if there's something to do.
                this.poll_ref.ref(vm);
            }

            this.deref();
        }

        const event_loop = vm.eventLoop();
        event_loop.enter();
        defer event_loop.exit();
        SocketMonitor.read(data);

        if (this.read_buffer.remaining().len == 0) {
            var consumed: usize = 0;
            var offset: usize = 0;
            const reader = protocol.StackReader.init(data, &consumed, &offset);
            this.processPackets(protocol.StackReader, reader) catch |err| {
                if (err == error.ShortRead) {
                    if (comptime bun.Environment.allow_assert) {
                        debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                            offset,
                            consumed,
                            data.len,
                        });
                    }

                    this.read_buffer.head = 0;
                    this.last_message_start = 0;
                    this.read_buffer.byte_list.len = 0;
                    this.read_buffer.write(bun.default_allocator, data[offset..]) catch @panic("failed to write to read buffer");
                } else {
                    if (comptime bun.Environment.allow_assert) {
                        if (@errorReturnTrace()) |trace| {
                            debug("Error: {s}\n{}", .{ @errorName(err), trace });
                        }
                    }
                    this.fail("Failed to read data", err);
                }
            };
            return;
        }

        {
            this.read_buffer.head = this.last_message_start;
            this.read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
            this.processPackets(Reader, this.bufferedReader()) catch |err| {
                if (err != error.ShortRead) {
                    if (comptime bun.Environment.allow_assert) {
                        if (@errorReturnTrace()) |trace| {
                            debug("Error: {s}\n{}", .{ @errorName(err), trace });
                        }
                    }
                    this.fail("Failed to read data", err);
                    return;
                }

                if (comptime bun.Environment.allow_assert) {
                    debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                        this.last_message_start,
                        this.read_buffer.head,
                        this.read_buffer.byte_list.len,
                    });
                }

                return;
            };

            this.last_message_start = 0;
            this.read_buffer.head = 0;
        }
    }

    pub fn processPackets(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        while (true) {
            reader.markMessageStart();

            // Read packet header
            const header = protocol.PacketHeader.decode(reader.peek()) orelse break;
            try reader.skip(protocol.PACKET_HEADER_SIZE);

            // Update sequence id
            this.sequence_id = header.sequence_id +% 1;

            // Ensure we have the full packet
            if (!reader.ensureCapacity(header.length)) {
                try reader.skip(-@as(isize, @intCast(protocol.PACKET_HEADER_SIZE)));
                return error.ShortRead;
            }

            // Process packet based on connection state
            switch (this.status) {
                .handshaking => try this.handleHandshake(Context, reader),
                .authenticating => try this.handleAuth(Context, reader),
                .connected => try this.handleCommand(Context, reader),
                else => {
                    debug("Unexpected packet in state {s}", .{@tagName(this.status)});
                    return error.UnexpectedPacket;
                },
            }

            try reader.skip(header.length);
        }
    }

    pub fn handleHandshake(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        var handshake = protocol.HandshakeV10{};
        try handshake.decode(Context, reader);
        defer handshake.deinit();

        // Store server info
        this.server_version = try handshake.server_version.toOwned();
        this.connection_id = handshake.connection_id;
        this.capabilities = handshake.capability_flags;
        this.character_set = handshake.character_set;
        this.status_flags = handshake.status_flags;

        // Store auth data
        this.auth_data = try bun.default_allocator.alloc(u8, handshake.auth_plugin_data_part_1.len + handshake.auth_plugin_data_part_2.len);
        @memcpy(this.auth_data[0..8], &handshake.auth_plugin_data_part_1);
        @memcpy(this.auth_data[8..], handshake.auth_plugin_data_part_2);

        // Get auth plugin
        if (handshake.auth_plugin_name.slice().len > 0) {
            this.auth_plugin = mysql.AuthMethod.fromString(handshake.auth_plugin_name.slice()) orelse {
                this.fail("Unsupported auth plugin", error.UnsupportedAuthPlugin);
                return;
            };
        }

        // Update status
        this.status = .authenticating;

        // Send auth response
        try this.sendHandshakeResponse();
    }

    pub fn handleAuth(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        const first_byte = try reader.int(u8);
        try reader.skip(-1);

        switch (first_byte) {
            @intFromEnum(protocol.PacketType.OK) => {
                var ok = protocol.OKPacket{};
                try ok.decode(Context, reader);
                defer ok.deinit();

                this.status = .connected;
                this.status_flags = ok.status_flags;
                this.is_ready_for_query = true;
            },

            @intFromEnum(protocol.PacketType.ERROR) => {
                var err = protocol.ErrorPacket{};
                try err.decode(Context, reader);
                defer err.deinit();

                this.fail("Authentication failed", error.AuthenticationFailed);
            },

            @intFromEnum(protocol.PacketType.AUTH_SWITCH) => {
                var auth_switch = protocol.AuthSwitchRequest{};
                try auth_switch.decode(Context, reader);
                defer auth_switch.deinit();

                // Update auth plugin and data
                const auth_method = mysql.AuthMethod.fromString(auth_switch.plugin_name.slice()) orelse {
                    this.fail("Unsupported auth plugin", error.UnsupportedAuthPlugin);
                    return;
                };

                // Send new auth response
                try this.sendAuthSwitchResponse(auth_method, auth_switch.plugin_data.slice());
            },

            else => {
                debug("Unexpected auth packet: 0x{x:0>2}", .{first_byte});
                return error.UnexpectedPacket;
            },
        }
    }

    pub fn handleCommand(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        // Get the current request if any
        if (this.requests.items.len == 0) {
            debug("Received unexpected command response", .{});
            return error.UnexpectedPacket;
        }

        const request = this.requests.items[0];

        // Handle based on request type
        if (request.statement) |statement| {
            switch (statement.status) {
                .parsing => {
                    // We're waiting for prepare response
                    try this.handlePreparedStatement(Context, reader);
                },
                .prepared => {
                    // We're waiting for execute response
                    try this.handleResultSet(Context, reader);
                },
                .failed => {
                    // Statement failed, clean up
                    if (this.requests.popOrNull()) |req| {
                        req.onError(statement.error_response, this.globalObject);
                    }
                },
            }
            return;
        }

        // Regular query response
        try this.handleResultSet(Context, reader);
    }

    pub fn sendHandshakeResponse(this: *MySQLConnection) !void {
        var response = protocol.HandshakeResponse41{
            .capability_flags = this.capabilities,
            .character_set = this.character_set,
            .username = .{ .temporary = this.user },
            .database = .{ .temporary = this.database },
            .auth_plugin_name = .{
                .temporary = if (this.auth_plugin) |plugin|
                    switch (plugin) {
                        .mysql_native_password => "mysql_native_password",
                        .caching_sha2_password => "caching_sha2_password",
                        .sha256_password => "sha256_password",
                    }
                else
                    "",
            },
            .auth_response = .{ .empty = {} },
        };
        defer response.deinit();
        var scrambled_buf: [32]u8 = undefined;

        // Generate auth response based on plugin
        if (this.auth_plugin) |plugin| {
            switch (plugin) {
                .mysql_native_password => @memcpy(scrambled_buf[0..20], try protocol.Auth.mysql_native_password.scramble(this.password, this.auth_data)),
                .caching_sha2_password => @memcpy(scrambled_buf[0..32], try protocol.Auth.caching_sha2_password.scramble(this.password, this.auth_data)),
                .sha256_password => @memcpy(scrambled_buf[0..20], try protocol.Auth.mysql_native_password.scramble(this.password, this.auth_data)),
            }

            response.auth_response = .{
                .temporary = switch (plugin) {
                    .mysql_native_password => scrambled_buf[0..20],
                    .caching_sha2_password => scrambled_buf[0..32],
                    .sha256_password => scrambled_buf[0..20],
                },
            };
        }

        try response.write(Writer, this.writer());
        this.flushData();
    }

    pub fn sendAuthSwitchResponse(this: *MySQLConnection, auth_method: mysql.AuthMethod, plugin_data: []const u8) !void {
        var response = protocol.AuthSwitchResponse{};
        defer response.deinit();

        var scrambled_buf: [32]u8 = undefined;

        // Generate auth response based on plugin
        switch (auth_method) {
            .mysql_native_password => @memcpy(scrambled_buf[0..20], try protocol.Auth.mysql_native_password.scramble(this.password, plugin_data)),
            .caching_sha2_password => @memcpy(scrambled_buf[0..32], try protocol.Auth.caching_sha2_password.scramble(this.password, plugin_data)),
            .sha256_password => @memcpy(scrambled_buf[0..20], try protocol.Auth.mysql_native_password.scramble(this.password, plugin_data)),
        }

        response.auth_response = .{
            .temporary = switch (auth_method) {
                .mysql_native_password => scrambled_buf[0..20],
                .caching_sha2_password => scrambled_buf[0..32],
                .sha256_password => scrambled_buf[0..20],
            },
        };

        try response.write(Writer, this.writer());
        this.flushData();
    }

    pub const Writer = struct {
        connection: *MySQLConnection,

        pub fn write(this: Writer, data: []const u8) anyerror!void {
            var buffer = &this.connection.write_buffer;
            try buffer.write(bun.default_allocator, data);
        }

        pub fn pwrite(this: Writer, data: []const u8, index: usize) anyerror!void {
            @memcpy(this.connection.write_buffer.byte_list.slice()[index..][0..data.len], data);
        }

        pub fn offset(this: Writer) usize {
            return this.connection.write_buffer.len();
        }
    };

    pub fn writer(this: *MySQLConnection) protocol.NewWriter(Writer) {
        return .{
            .wrapped = .{
                .connection = this,
            },
        };
    }

    pub const Reader = struct {
        connection: *MySQLConnection,

        pub fn markMessageStart(this: Reader) void {
            this.connection.last_message_start = this.connection.read_buffer.head;
        }

        pub const ensureLength = ensureCapacity;

        pub fn peek(this: Reader) []const u8 {
            return this.connection.read_buffer.remaining();
        }

        pub fn skip(this: Reader, count: isize) void {
            if (count < 0) {
                const abs_count = @abs(count);
                if (abs_count > this.connection.read_buffer.head) {
                    this.connection.read_buffer.head = 0;
                    return;
                }
                this.connection.read_buffer.head -= @intCast(abs_count);
                return;
            }

            const ucount: usize = @intCast(count);
            if (this.connection.read_buffer.head + ucount > this.connection.read_buffer.byte_list.len) {
                this.connection.read_buffer.head = this.connection.read_buffer.byte_list.len;
                return;
            }

            this.connection.read_buffer.head += ucount;
        }

        pub fn ensureCapacity(this: Reader, count: usize) bool {
            return this.connection.read_buffer.remaining().len >= count;
        }

        pub fn read(this: Reader, count: usize) anyerror!Data {
            const remaining = this.peek();
            if (remaining.len < count) {
                return error.ShortRead;
            }

            this.skip(@intCast(count));
            return Data{
                .temporary = remaining[0..count],
            };
        }

        pub fn readZ(this: Reader) anyerror!Data {
            const remaining = this.peek();
            if (bun.strings.indexOfChar(remaining, 0)) |zero| {
                this.skip(@intCast(zero + 1));
                return Data{
                    .temporary = remaining[0..zero],
                };
            }

            return error.ShortRead;
        }
    };

    pub fn bufferedReader(this: *MySQLConnection) protocol.NewReader(Reader) {
        return .{
            .wrapped = .{
                .connection = this,
            },
        };
    }

    pub fn handlePreparedStatement(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        const first_byte = try reader.int(u8);
        try reader.skip(-1);

        switch (first_byte) {
            @intFromEnum(protocol.PacketType.OK) => {
                var ok = protocol.StmtPrepareOKPacket{};
                try ok.decode(Context, reader);

                // Get the current request
                const request = this.requests.items[0];
                if (request.statement) |statement| {
                    statement.statement_id = ok.statement_id;
                    statement.status = .prepared;

                    // Read parameter definitions if any
                    if (ok.num_params > 0) {
                        var params = try bun.default_allocator.alloc(types.FieldType, ok.num_params);
                        errdefer bun.default_allocator.free(params);

                        for (0..ok.num_params) |i| {
                            var column = protocol.ColumnDefinition41{};
                            try column.decode(Context, reader);
                            params[i] = column.column_type;
                            column.deinit();
                        }

                        statement.params = params;
                    }

                    // Read column definitions if any
                    if (ok.num_columns > 0) {
                        var columns = try bun.default_allocator.alloc(protocol.ColumnDefinition41, ok.num_columns);
                        errdefer {
                            for (columns) |*column| {
                                column.deinit();
                            }
                            bun.default_allocator.free(columns);
                        }

                        for (0..ok.num_columns) |i| {
                            try columns[i].decode(Context, reader);
                        }

                        statement.columns = columns;
                    }

                    // Statement is ready to execute
                    _ = this.requests.orderedRemove(0);
                    request.onSuccess(0, 0, this.globalObject);
                }
            },

            @intFromEnum(protocol.PacketType.ERROR) => {
                var err = protocol.ErrorPacket{};
                try err.decode(Context, reader);
                defer err.deinit();

                if (this.requests.popOrNull()) |request| {
                    if (request.statement) |statement| {
                        statement.status = .failed;
                        statement.error_response = err;
                    }
                    request.onError(err, this.globalObject);
                }
            },

            else => {
                debug("Unexpected prepared statement packet: 0x{x:0>2}", .{first_byte});
                return error.UnexpectedPacket;
            },
        }
    }

    pub fn handleResultSet(this: *MySQLConnection, comptime Context: type, reader: protocol.NewReader(Context)) !void {
        const first_byte = try reader.int(u8);
        try reader.skip(-1);

        switch (first_byte) {
            @intFromEnum(protocol.PacketType.OK) => {
                var ok = protocol.OKPacket{};
                try ok.decode(Context, reader);
                defer ok.deinit();

                if (this.requests.popOrNull()) |request| {
                    request.onSuccess(ok.affected_rows, ok.last_insert_id, this.globalObject);
                }

                this.status_flags = ok.status_flags;
                this.is_ready_for_query = true;
            },

            @intFromEnum(protocol.PacketType.ERROR) => {
                var err = protocol.ErrorPacket{};
                try err.decode(Context, reader);
                defer err.deinit();

                if (this.requests.popOrNull()) |request| {
                    request.onError(err, this.globalObject);
                }
            },

            else => {
                // This is likely a result set header
                var header = protocol.ResultSetHeader{};
                try header.decode(Context, reader);

                if (this.requests.items.len > 0) {
                    const request = this.requests.items[0];

                    // Read column definitions
                    var columns = try bun.default_allocator.alloc(protocol.ColumnDefinition41, header.field_count);
                    errdefer {
                        for (columns) |*column| {
                            column.deinit();
                        }
                        bun.default_allocator.free(columns);
                    }

                    for (0..header.field_count) |i| {
                        try columns[i].decode(Context, reader);
                    }

                    // Start reading rows
                    while (true) {
                        const row_first_byte = try reader.int(u8);
                        try reader.skip(-1);

                        switch (row_first_byte) {
                            @intFromEnum(protocol.PacketType.EOF) => {
                                var eof = protocol.EOFPacket{};
                                try eof.decode(Context, reader);

                                // Update status flags and finish
                                this.status_flags = eof.status_flags;
                                this.is_ready_for_query = true;

                                _ = this.requests.orderedRemove(0);
                                request.onSuccess(0, 0, this.globalObject);
                                break;
                            },

                            @intFromEnum(protocol.PacketType.ERROR) => {
                                var err = protocol.ErrorPacket{};
                                try err.decode(Context, reader);
                                defer err.deinit();

                                if (this.requests.popOrNull()) |req| {
                                    req.onError(err, this.globalObject);
                                }
                                break;
                            },

                            else => {
                                var stack_fallback = std.heap.stackFallback(4096, bun.default_allocator);
                                // Read row data
                                var row = protocol.ResultSet.Row{
                                    .columns = columns,
                                    .binary = request.binary,
                                };
                                try row.decodeInternal(stack_fallback.get(), Context, reader);
                                defer row.deinit();

                                // Process row data
                                // Note: You'll need to implement row processing logic
                                // based on your application's needs

                            },
                        }
                    }

                    // Clean up columns
                    for (columns) |*column| {
                        column.deinit();
                    }
                    bun.default_allocator.free(columns);
                }
            },
        }
    }

    pub fn executeStatement(this: *MySQLConnection, statement: *MySQLStatement, values: []const Data) !void {
        var execute = protocol.PreparedStatement.Execute{
            .statement_id = statement.statement_id,
            .params = values,
            .param_types = statement.params,
        };
        defer execute.deinit();

        try execute.write(Writer, this.writer());
        this.flushData();
    }

    pub fn closeStatement(this: *MySQLConnection, statement: *MySQLStatement) !void {
        var close = protocol.PreparedStatement.Close{
            .statement_id = statement.statement_id,
        };

        try close.write(Writer, this.writer());
        this.flushData();
    }

    pub fn resetStatement(this: *MySQLConnection, statement: *MySQLStatement) !void {
        var reset = protocol.PreparedStatement.Reset{
            .statement_id = statement.statement_id,
        };

        try reset.write(Writer, this.writer());
        this.flushData();
    }
};

pub const MySQLStatement = struct {
    cached_structure: JSC.Strong = .{},
    ref_count: u32 = 1,
    statement_id: u32,
    params: []const types.FieldType = &[_]types.FieldType{},
    columns: []const protocol.ColumnDefinition41 = &[_]protocol.ColumnDefinition41{},
    signature: Signature,
    status: Status = Status.parsing,
    error_response: protocol.ErrorPacket = .{ .error_code = 0 },

    pub const Status = enum {
        parsing,
        prepared,
        failed,
    };

    pub usingnamespace bun.NewRefCounted(@This(), deinit);

    pub fn deinit(this: *MySQLStatement) void {
        debug("MySQLStatement deinit", .{});

        bun.assert(this.ref_count == 0);

        for (this.columns) |*column| {
            @constCast(column).deinit();
        }
        bun.default_allocator.free(this.columns);
        bun.default_allocator.free(this.params);
        this.cached_structure.deinit();
        this.error_response.deinit();
        this.signature.deinit();
        bun.default_allocator.destroy(this);
    }

    pub fn structure(this: *MySQLStatement, owner: JSValue, globalObject: *JSC.JSGlobalObject) JSValue {
        return this.cached_structure.get() orelse {
            const names = bun.default_allocator.alloc(bun.String, this.columns.len) catch return .undefined;
            defer {
                for (names) |*name| {
                    name.deref();
                }
                bun.default_allocator.free(names);
            }
            for (this.columns, names) |*column, *name| {
                name.* = String.fromUTF8(column.name.slice());
            }
            const structure_ = JSC.JSObject.createStructure(
                globalObject,
                owner,
                @truncate(this.columns.len),
                names.ptr,
            );
            this.cached_structure.set(globalObject, structure_);
            return structure_;
        };
    }
};

pub const MySQLQuery = struct {
    statement: ?*MySQLStatement = null,
    query: bun.String = bun.String.empty,
    cursor_name: bun.String = bun.String.empty,
    thisValue: JSValue = .undefined,
    target: JSC.Strong = JSC.Strong.init(),
    status: Status = Status.pending,
    is_done: bool = false,
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
    binary: bool = false,
    pending_value: JSC.Strong = .{},

    pub usingnamespace JSC.Codegen.JSMySQLQuery;

    pub const Status = enum(u8) {
        pending,
        written,
        running,
        binding,
        success,
        fail,

        pub fn isRunning(this: Status) bool {
            return this == .running or this == .binding;
        }
    };

    pub fn hasPendingActivity(this: *@This()) bool {
        return this.ref_count.load(.monotonic) > 1;
    }

    pub fn deinit(this: *@This()) void {
        if (this.statement) |statement| {
            statement.deref();
        }
        this.query.deref();
        this.cursor_name.deref();
        this.target.deinit();
        this.pending_value.deinit();

        bun.default_allocator.destroy(this);
    }

    pub fn finalize(this: *@This()) void {
        debug("MySQLQuery finalize", .{});

        // Clean up any statement reference
        if (this.statement) |statement| {
            statement.deref();
            this.statement = null;
        }

        this.thisValue = .zero;
        this.deref();
    }

    pub usingnamespace bun.NewThreadSafeRefCounted(@This(), deinit);

    pub fn onNoData(this: *@This(), globalObject: *JSC.JSGlobalObject) void {
        this.status = .success;
        defer this.deref();

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().mysql_context.onQueryResolveFn.get().?;
        const event_loop = vm.eventLoop();
        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            this.pending_value.trySwap() orelse .undefined,
            JSValue.jsNumber(0),
            JSValue.jsNumber(0),
        });
    }

    pub fn onWriteFail(this: *@This(), err: anyerror, globalObject: *JSC.JSGlobalObject) void {
        this.status = .fail;
        this.pending_value.deinit();
        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        const instance = globalObject.createErrorInstance("Failed to bind query: {s}", .{@errorName(err)});

        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
        const event_loop = vm.eventLoop();
        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            instance,
        });
    }

    pub fn onError(this: *@This(), err: protocol.ErrorPacket, globalObject: *JSC.JSGlobalObject) void {
        this.status = .fail;
        defer {
            // Clean up statement reference on error
            if (this.statement) |statement| {
                statement.deref();
                this.statement = null;
            }
            this.deref();
        }

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        var vm = JSC.VirtualMachine.get();
        const function = vm.rareData().mysql_context.onQueryRejectFn.get().?;
        globalObject.queueMicrotask(function, &[_]JSValue{ targetValue, err.toJS(globalObject) });
    }

    pub fn onSuccess(this: *@This(), affected_rows: u64, last_insert_id: u64, globalObject: *JSC.JSGlobalObject) void {
        this.status = .success;
        defer this.deref();

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().mysql_context.onQueryResolveFn.get().?;
        const event_loop = vm.eventLoop();
        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            this.pending_value.trySwap() orelse .undefined,
            JSValue.jsNumber(@floatFromInt(affected_rows)),
            JSValue.jsNumber(@floatFromInt(last_insert_id)),
        });
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*MySQLQuery {
        _ = callframe;
        return globalThis.throw2("MySQLQuery cannot be constructed directly", .{});
    }

    pub fn estimatedSize(this: *MySQLQuery) usize {
        _ = this;
        return @sizeOf(MySQLQuery);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.arguments(4).slice();
        const query = arguments[0];
        const values = arguments[1];
        const columns = arguments[3];

        if (!query.isString()) {
            globalThis.throw("query must be a string", .{});
            return .zero;
        }

        if (values.jsType() != .Array) {
            globalThis.throw("values must be an array", .{});
            return .zero;
        }

        const pending_value = arguments[2];
        if (!pending_value.jsType().isArrayLike()) {
            globalThis.throwInvalidArgumentType("query", "pendingValue", "Array");
            return .zero;
        }

        var ptr = bun.default_allocator.create(MySQLQuery) catch |err| {
            globalThis.throwError(err, "failed to allocate query");
            return .zero;
        };

        const this_value = ptr.toJS(globalThis);
        this_value.ensureStillAlive();

        ptr.* = .{
            .query = query.toBunString(globalThis),
            .thisValue = this_value,
        };
        ptr.query.ref();

        MySQLQuery.bindingSetCached(this_value, globalThis, values);
        MySQLQuery.pendingValueSetCached(this_value, globalThis, pending_value);
        if (columns != .undefined) {
            MySQLQuery.columnsSetCached(this_value, globalThis, columns);
        }
        ptr.pending_value.set(globalThis, pending_value);

        return this_value;
    }

    comptime {
        if (!JSC.is_bindgen) {
            const jscall = JSC.toJSHostFunction(call);
            @export(jscall, .{ .name = "MySQLQuery__createInstance" });
        }
    }
};

pub const Signature = struct {
    fields: []const types.FieldType,
    name: []const u8,
    query: []const u8,

    pub fn deinit(this: *Signature) void {
        bun.default_allocator.free(this.fields);
        bun.default_allocator.free(this.name);
        bun.default_allocator.free(this.query);
    }

    pub fn hash(this: *const Signature) u64 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(this.name);
        hasher.update(std.mem.sliceAsBytes(this.fields));
        return hasher.final();
    }

    pub fn generate(globalObject: *JSC.JSGlobalObject, query: []const u8, array_value: JSValue, columns: JSValue) !Signature {
        var fields = std.ArrayList(types.FieldType).init(bun.default_allocator);
        var name = try std.ArrayList(u8).initCapacity(bun.default_allocator, query.len);

        name.appendSliceAssumeCapacity(query);

        errdefer {
            fields.deinit();
            name.deinit();
        }

        var iter = QueryBindingIterator.init(array_value, columns, globalObject);

        while (iter.next()) |value| {
            if (value.isEmptyOrUndefinedOrNull()) {
                // Allow MySQL to decide the type
                try fields.append(.MYSQL_TYPE_NULL);
                try name.appendSlice(".null");
                continue;
            }

            const tag = try types.FieldType.fromJS(globalObject, value);
            try name.appendSlice(@tagName(tag));
            try fields.append(tag);
        }

        if (iter.anyFailed()) {
            return error.InvalidQueryBinding;
        }

        return Signature{
            .name = name.items,
            .fields = fields.toOwnedSlice(),
            .query = try bun.default_allocator.dupe(u8, query),
        };
    }
};

pub const TLSStatus = enum {
    none,
    pending,
    message_sent,
    ssl_not_available,
    ssl_ok,
};
