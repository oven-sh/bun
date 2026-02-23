const MySQLConnection = @This();

#socket: Socket = .{ .SocketTCP = .{ .socket = .{ .detached = {} } } },
status: ConnectionState = .disconnected,

#write_buffer: bun.OffsetByteList = .{},
#read_buffer: bun.OffsetByteList = .{},
#last_message_start: u32 = 0,
#sequence_id: u8 = 0,

// TODO: move it to JSMySQLConnection
queue: MySQLRequestQueue = MySQLRequestQueue.init(),
// TODO: move it to JSMySQLConnection
statements: PreparedStatementsMap = .{},

#server_version: bun.ByteList = .{},
#connection_id: u32 = 0,
#capabilities: Capabilities = .{},
#character_set: CharacterSet = CharacterSet.default,
#status_flags: StatusFlags = .{},

#auth_plugin: ?AuthMethod = null,
#auth_state: AuthState = .{ .pending = {} },

#auth_data: std.array_list.Managed(u8) = std.array_list.Managed(u8).init(bun.default_allocator),
#database: []const u8 = "",
#user: []const u8 = "",
#password: []const u8 = "",
#options: []const u8 = "",
#options_buf: []const u8 = "",
#tls_ctx: ?*uws.SocketContext = null,
#tls_config: jsc.API.ServerConfig.SSLConfig = .{},
#tls_status: TLSStatus = .none,
#ssl_mode: SSLMode = .disable,
#flags: ConnectionFlags = .{},

pub fn init(
    database: []const u8,
    username: []const u8,
    password: []const u8,
    options: []const u8,
    options_buf: []const u8,
    tls_config: jsc.API.ServerConfig.SSLConfig,
    tls_ctx: ?*uws.SocketContext,
    ssl_mode: SSLMode,
) @This() {
    return .{
        .#database = database,
        .#user = username,
        .#password = password,
        .#options = options,
        .#options_buf = options_buf,
        .#socket = .{ .SocketTCP = .{ .socket = .{ .detached = {} } } },
        .queue = MySQLRequestQueue.init(),
        .statements = PreparedStatementsMap{},
        .#tls_config = tls_config,
        .#tls_ctx = tls_ctx,
        .#ssl_mode = ssl_mode,
        .#tls_status = if (ssl_mode != .disable) .pending else .none,
        .#character_set = CharacterSet.default,
    };
}

pub fn canPipeline(this: *@This()) bool {
    return this.queue.canPipeline(this.getJSConnection());
}
pub fn canPrepareQuery(this: *@This()) bool {
    return this.queue.canPrepareQuery(this.getJSConnection());
}
pub fn canExecuteQuery(this: *@This()) bool {
    return this.queue.canExecuteQuery(this.getJSConnection());
}

pub inline fn isAbleToWrite(this: *const @This()) bool {
    return this.status == .connected and
        !this.#flags.has_backpressure and
        this.#write_buffer.len() < MAX_PIPELINE_SIZE;
}

pub inline fn isProcessingData(this: *@This()) bool {
    return this.#flags.is_processing_data;
}
pub inline fn hasBackpressure(this: *const @This()) bool {
    return this.#flags.has_backpressure;
}
pub inline fn resetBackpressure(this: *@This()) void {
    this.#flags.has_backpressure = false;
}
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

pub inline fn canFlush(this: *const @This()) bool {
    return !this.#flags.has_backpressure and // if has backpressure we need to wait for onWritable event
        this.status == .connected and //and we need to be connected
        // we need data to send
        (this.#write_buffer.len() > 0 or
            if (this.queue.current()) |request| request.isPending() and !request.isBeingPrepared() else false);
}

pub inline fn isIdle(this: *const @This()) bool {
    return this.queue.current() == null and this.#write_buffer.len() == 0;
}

pub inline fn enqueueRequest(this: *@This(), request: *JSMySQLQuery) void {
    this.queue.add(request);
}

pub fn flushQueue(this: *@This()) error{AuthenticationFailed}!void {
    this.flushData();
    if (!this.#flags.has_backpressure) {
        if (this.#tls_status == .message_sent) {
            try this.upgradeToTLS();
        } else {
            // no backpressure yet so pipeline more if possible and flush again
            this.queue.advance(this.getJSConnection());
            this.flushData();
        }
    }
}

fn flushData(this: *@This()) void {
    // we know we still have backpressure so just return we will flush later
    if (this.#flags.has_backpressure) {
        debug("flushData: has backpressure", .{});
        return;
    }

    const chunk = this.#write_buffer.remaining();
    if (chunk.len == 0) {
        return;
    }

    const wrote = this.#socket.write(chunk);
    this.#flags.has_backpressure = wrote < chunk.len;
    debug("flushData: wrote {d}/{d} bytes", .{ wrote, chunk.len });
    if (wrote > 0) {
        SocketMonitor.write(chunk[0..@intCast(wrote)]);
        this.#write_buffer.consume(@intCast(wrote));
    }
}
pub fn close(this: *@This()) void {
    this.#socket.close();
    this.#write_buffer.clearAndFree(bun.default_allocator);
}
pub fn cleanQueueAndClose(this: *@This(), js_reason: ?jsc.JSValue, js_queries_array: JSValue) void {
    // cleanup requests
    this.queue.clean(
        js_reason,
        if (js_queries_array != .zero) js_queries_array else .js_undefined,
    );

    this.close();
}

pub fn cleanup(this: *MySQLConnection) void {
    var queue = this.queue;
    defer queue.deinit();
    this.queue = MySQLRequestQueue.init();
    var write_buffer = this.#write_buffer;
    var read_buffer = this.#read_buffer;
    var statements = this.statements;
    var tls_config = this.#tls_config;
    const options_buf = this.#options_buf;
    this.#write_buffer = .{};
    this.#read_buffer = .{};
    this.statements = PreparedStatementsMap{};
    this.#tls_config = .{};
    this.#options_buf = "";
    write_buffer.deinit(bun.default_allocator);

    read_buffer.deinit(bun.default_allocator);

    var iter = statements.valueIterator();
    while (iter.next()) |statement| {
        var stmt = statement.*;
        stmt.deref();
    }
    statements.deinit(bun.default_allocator);

    tls_config.deinit();
    this.#auth_data.deinit();
    if (this.#tls_ctx) |ctx| {
        this.#tls_ctx = null;
        ctx.deinit(true);
    }

    if (options_buf.len > 0) {
        bun.default_allocator.free(options_buf);
    }
}

pub fn upgradeToTLS(this: *MySQLConnection) !void {
    if (this.#socket == .SocketTCP) {
        const new_socket = this.#socket.SocketTCP.socket.connected.upgrade(this.#tls_ctx.?, this.#tls_config.server_name) orelse {
            return error.AuthenticationFailed;
        };
        this.#socket = .{
            .SocketTLS = .{
                .socket = .{
                    .connected = new_socket,
                },
            },
        };
    }
}

pub fn setSocket(this: *MySQLConnection, socket: uws.AnySocket) void {
    this.#socket = socket;
}
pub fn isActive(this: *MySQLConnection) bool {
    if (this.status == .disconnected or this.status == .failed) {
        return false;
    }

    // if is connected or connecting we keep alive until idle timeout is reached
    return true;
}
pub inline fn isConnected(this: *MySQLConnection) bool {
    return this.status == .connected;
}
pub fn doHandshake(this: *MySQLConnection, success: i32, ssl_error: uws.us_bun_verify_error_t) !bool {
    debug("onHandshake: {d} {d} {s}", .{ success, ssl_error.error_no, @tagName(this.#ssl_mode) });
    const handshake_success = if (success == 1) true else false;
    this.#sequence_id = this.#sequence_id +% 1;
    if (handshake_success) {
        this.#tls_status = .ssl_ok;
        if (this.#tls_config.reject_unauthorized != 0) {
            // follow the same rules as postgres
            // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
            // only reject the connection if reject_unauthorized == true
            switch (this.#ssl_mode) {
                .verify_ca, .verify_full => {
                    if (ssl_error.error_no != 0) {
                        this.#tls_status = .ssl_failed;
                        return false;
                    }

                    const ssl_ptr: *BoringSSL.c.SSL = @ptrCast(this.#socket.getNativeHandle());
                    if (BoringSSL.c.SSL_get_servername(ssl_ptr, 0)) |servername| {
                        const hostname = servername[0..bun.len(servername)];
                        if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                            this.#tls_status = .ssl_failed;
                            return false;
                        }
                    }
                },
                // require is the same as prefer
                .require, .prefer, .disable => {},
            }
        }
        try this.sendHandshakeResponse();
        return true;
    }
    this.#tls_status = .ssl_failed;
    // if we are here is because server rejected us, and the error_no is the cause of this
    // no matter if reject_unauthorized is false because we are disconnected by the server
    return false;
}

pub fn readAndProcessData(this: *MySQLConnection, data: []const u8) !void {
    this.#flags.is_processing_data = true;
    defer this.#flags.is_processing_data = false;
    // Clear the timeout.
    this.#socket.setTimeout(0);

    SocketMonitor.read(data);

    if (this.#read_buffer.remaining().len == 0) {
        var consumed: usize = 0;
        var offset: usize = 0;
        const reader = StackReader.init(data, &consumed, &offset);
        this.processPackets(StackReader, reader) catch |err| {
            debug("processPackets without buffer: {s}", .{@errorName(err)});
            if (err == error.ShortRead) {
                if (comptime bun.Environment.allow_assert) {
                    debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                        offset,
                        consumed,
                        data.len,
                    });
                }

                this.#read_buffer.head = 0;
                this.#last_message_start = 0;
                this.#read_buffer.byte_list.len = 0;
                this.#read_buffer.write(bun.default_allocator, data[offset..]) catch @panic("failed to write to read buffer");
            } else {
                if (comptime bun.Environment.allow_assert) {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                }
                return err;
            }
        };
        return;
    }

    {
        this.#read_buffer.head = this.#last_message_start;

        this.#read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
        this.processPackets(Reader, this.bufferedReader()) catch |err| {
            debug("processPackets with buffer: {s}", .{@errorName(err)});
            if (err != error.ShortRead) {
                if (comptime bun.Environment.allow_assert) {
                    if (@errorReturnTrace()) |trace| {
                        debug("Error: {s}\n{f}", .{ @errorName(err), trace });
                    }
                }
                return err;
            }

            if (comptime bun.Environment.allow_assert) {
                debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                    this.#last_message_start,
                    this.#read_buffer.head,
                    this.#read_buffer.byte_list.len,
                });
            }

            return;
        };

        this.#last_message_start = 0;
        this.#read_buffer.head = 0;
    }
}

pub fn processPackets(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) AnyMySQLError.Error!void {
    while (true) {
        reader.markMessageStart();

        // Read packet header
        const header = PacketHeader.decode(reader.peek()) orelse return AnyMySQLError.Error.ShortRead;
        const header_length = header.length;
        const packet_length: usize = header_length + PacketHeader.size;
        debug("sequence_id: {d} header: {d}", .{ this.#sequence_id, header_length });
        // Ensure we have the full packet
        reader.ensureCapacity(packet_length) catch return AnyMySQLError.Error.ShortRead;
        // always skip the full packet, we dont care about padding or unreaded bytes
        defer reader.setOffsetFromStart(packet_length);
        reader.skip(PacketHeader.size);

        // Update sequence id
        this.#sequence_id = header.sequence_id +% 1;

        // Process packet based on connection state
        switch (this.status) {
            .handshaking => try this.handleHandshake(Context, reader),
            .authenticating, .authentication_awaiting_pk => try this.handleAuth(Context, reader, header_length),
            .connected => try this.handleCommand(Context, reader, header_length),
            else => {
                debug("Unexpected packet in state {s}", .{@tagName(this.status)});
                return error.UnexpectedPacket;
            },
        }
    }
}

pub fn handleHandshake(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) AnyMySQLError.Error!void {
    var handshake = HandshakeV10{};
    try handshake.decode(reader);
    defer handshake.deinit();

    // Store server info
    this.#server_version = try handshake.server_version.toOwned();
    this.#connection_id = handshake.connection_id;
    // this.capabilities = handshake.capability_flags;
    this.#capabilities = Capabilities.getDefaultCapabilities(this.#ssl_mode != .disable, this.#database.len > 0);

    // Override with utf8mb4 instead of using server's default
    this.#character_set = CharacterSet.default;
    this.#status_flags = handshake.status_flags;

    debug(
        \\Handshake
        \\   Server Version: {s}
        \\   Connection ID:  {d}
        \\   Character Set:  {d} ({s})
        \\   Server Capabilities:   [ {f} ] 0x{x:0>8}
        \\   Status Flags:   [ {f} ]
        \\
    , .{
        this.#server_version.slice(),
        this.#connection_id,
        this.#character_set,
        this.#character_set.label(),
        this.#capabilities,
        this.#capabilities.toInt(),
        this.#status_flags,
    });

    this.#auth_data.clearAndFree();

    // Store auth data
    try this.#auth_data.ensureTotalCapacity(handshake.auth_plugin_data_part_1.len + handshake.auth_plugin_data_part_2.len);
    try this.#auth_data.appendSlice(handshake.auth_plugin_data_part_1[0..]);
    try this.#auth_data.appendSlice(handshake.auth_plugin_data_part_2[0..]);

    // Get auth plugin
    if (handshake.auth_plugin_name.slice().len > 0) {
        this.#auth_plugin = AuthMethod.fromString(handshake.auth_plugin_name.slice()) orelse {
            return error.UnsupportedAuthPlugin;
        };
    }

    // Update status
    this.setStatus(.authenticating);

    // https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
    if (this.#capabilities.CLIENT_SSL) {
        var response = SSLRequest{
            .capability_flags = this.#capabilities,
            .max_packet_size = 0, //16777216,
            .character_set = CharacterSet.default,
            // bun always send connection attributes
            .has_connection_attributes = true,
        };
        defer response.deinit();
        try response.write(this.writer());
        this.#capabilities = response.capability_flags;
        this.#tls_status = .message_sent;
        this.flushData();
        if (!this.#flags.has_backpressure) {
            try this.upgradeToTLS();
        }
        return;
    }
    if (this.#tls_status != .none) {
        this.#tls_status = .ssl_not_available;

        switch (this.#ssl_mode) {
            .verify_ca, .verify_full => {
                return error.AuthenticationFailed;
            },
            // require is the same as prefer
            .require, .prefer, .disable => {},
        }
    }
    // Send auth response
    try this.sendHandshakeResponse();
}

fn handleHandshakeDecodePublicKey(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context)) !void {
    var response = Auth.caching_sha2_password.PublicKeyResponse{};
    try response.decode(reader);
    defer response.deinit();
    // revert back to authenticating since we received the public key
    this.setStatus(.authenticating);

    var encrypted_password = Auth.caching_sha2_password.EncryptedPassword{
        .password = this.#password,
        .public_key = response.data.slice(),
        .nonce = this.#auth_data.items,
        .sequence_id = this.#sequence_id,
    };
    try encrypted_password.write(this.writer());
    this.flushData();
}

pub fn setStatus(this: *@This(), status: ConnectionState) void {
    if (this.status == status) return;

    this.status = status;

    switch (status) {
        .connected => {
            this.getJSConnection().onConnectionEstabilished();
        },
        else => {},
    }
}

pub fn handleAuth(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context), header_length: u24) !void {
    const first_byte = try reader.int(u8);
    reader.skip(-1);

    debug("Auth packet: 0x{x:0>2}", .{first_byte});

    switch (first_byte) {
        @intFromEnum(PacketType.OK) => {
            var ok = OKPacket{
                .packet_size = header_length,
            };
            try ok.decode(reader);
            defer ok.deinit();

            this.setStatus(.connected);

            this.#status_flags = ok.status_flags;
            this.#flags.is_ready_for_query = true;
            const connection = this.getJSConnection();
            this.queue.markAsReadyForQuery();
            this.queue.advance(connection);
        },

        @intFromEnum(PacketType.ERROR) => {
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();

            const connection = this.getJSConnection();
            connection.onErrorPacket(null, err);
            return error.AuthenticationFailed;
        },

        @intFromEnum(PacketType.MORE_DATA) => {
            // Handle various MORE_DATA cases
            if (this.#auth_plugin) |plugin| {
                switch (plugin) {
                    .sha256_password, .caching_sha2_password => {
                        reader.skip(1);

                        if (this.status == .authentication_awaiting_pk) {
                            return this.handleHandshakeDecodePublicKey(Context, reader);
                        }

                        var response = Auth.caching_sha2_password.Response{};
                        try response.decode(reader);
                        defer response.deinit();

                        switch (response.status) {
                            .success => {
                                debug("success auth", .{});
                                this.setStatus(.connected);

                                this.#flags.is_ready_for_query = true;
                                this.queue.markAsReadyForQuery();
                                this.queue.advance(this.getJSConnection());
                            },
                            .continue_auth => {
                                debug("continue auth", .{});

                                if (this.#ssl_mode == .disable) {
                                    // we are in plain TCP so we need to request the public key
                                    this.setStatus(.authentication_awaiting_pk);
                                    debug("awaiting public key", .{});
                                    var packet = try this.writer().start(this.#sequence_id);

                                    var request = Auth.caching_sha2_password.PublicKeyRequest{};
                                    try request.write(this.writer());
                                    try packet.end();
                                    this.flushData();
                                } else {
                                    debug("sending password TLS enabled", .{});
                                    // SSL mode is enabled, send password as is
                                    var packet = try this.writer().start(this.#sequence_id);
                                    try this.writer().writeZ(this.#password);
                                    try packet.end();
                                    this.flushData();
                                }
                            },
                            else => {
                                return error.AuthenticationFailed;
                            },
                        }
                    },
                    else => {
                        debug("Unexpected auth continuation for plugin: {s}", .{@tagName(plugin)});
                        return error.UnexpectedPacket;
                    },
                }
            } else if (first_byte == @intFromEnum(PacketType.LOCAL_INFILE)) {
                // Handle LOCAL INFILE request
                var infile = LocalInfileRequest{
                    .packet_size = header_length,
                };
                try infile.decode(reader);
                defer infile.deinit();

                // We don't support LOCAL INFILE for security reasons
                return error.LocalInfileNotSupported;
            } else {
                debug("Received auth continuation without plugin", .{});
                return error.UnexpectedPacket;
            }
        },

        PacketType.AUTH_SWITCH => {
            var auth_switch = AuthSwitchRequest{
                .packet_size = header_length,
            };
            try auth_switch.decode(reader);
            defer auth_switch.deinit();

            // Update auth plugin and data
            const auth_method = AuthMethod.fromString(auth_switch.plugin_name.slice()) orelse {
                return error.UnsupportedAuthPlugin;
            };
            const auth_data = auth_switch.plugin_data.slice();
            this.#auth_plugin = auth_method;
            this.#auth_data.clearRetainingCapacity();
            try this.#auth_data.appendSlice(auth_data);

            // Send new auth response
            try this.sendAuthSwitchResponse(auth_method, auth_data);
        },

        else => {
            debug("Unexpected auth packet: 0x{x:0>2}", .{first_byte});
            return error.UnexpectedPacket;
        },
    }
}

pub fn handleCommand(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context), header_length: u24) !void {
    // Get the current request if any
    const request = this.queue.current() orelse {
        debug("Received unexpected command response", .{});
        return error.UnexpectedPacket;
    };
    request.ref();
    defer request.deref();

    debug("handleCommand", .{});
    if (request.isSimple()) {
        // Regular query response
        return try this.handleResultSet(Context, reader, header_length);
    }

    // Handle based on request type
    if (request.getStatement()) |statement| {
        statement.ref();
        defer statement.deref();
        switch (statement.status) {
            .pending => {
                return error.UnexpectedPacket;
            },
            .parsing => {
                // We're waiting for prepare response
                try this.handlePreparedStatement(Context, reader, header_length);
            },
            .prepared => {
                // We're waiting for execute response
                try this.handleResultSet(Context, reader, header_length);
            },
            .failed => {
                const connection = this.getJSConnection();
                defer {
                    this.flushQueue() catch {};
                }
                this.#flags.is_ready_for_query = true;
                this.queue.markAsReadyForQuery();
                this.queue.markCurrentRequestAsFinished(request);
                connection.onErrorPacket(request, statement.error_response);
            },
        }
    }
}

pub fn sendHandshakeResponse(this: *MySQLConnection) AnyMySQLError.Error!void {
    debug("sendHandshakeResponse", .{});
    // Only require password for caching_sha2_password when connecting for the first time
    if (this.#auth_plugin) |plugin| {
        const requires_password = switch (plugin) {
            .caching_sha2_password => false, // Allow empty password, server will handle auth flow
            .sha256_password => true, // Always requires password
            .mysql_native_password => false, // Allows empty password
        };

        if (requires_password and this.#password.len == 0) {
            return error.PasswordRequired;
        }
    }

    var response = HandshakeResponse41{
        .capability_flags = this.#capabilities,
        .max_packet_size = 0, //16777216,
        .character_set = CharacterSet.default,
        .username = .{ .temporary = this.#user },
        .database = .{ .temporary = this.#database },
        .auth_plugin_name = .{
            .temporary = if (this.#auth_plugin) |plugin|
                switch (plugin) {
                    .mysql_native_password => "mysql_native_password",
                    .caching_sha2_password => "caching_sha2_password",
                    .sha256_password => "sha256_password",
                }
            else
                "",
        },
        .auth_response = .{ .empty = {} },
        .sequence_id = this.#sequence_id,
    };
    defer response.deinit();

    // Add some basic connect attributes like mysql2
    try response.connect_attrs.put(bun.default_allocator, try bun.default_allocator.dupe(u8, "_client_name"), try bun.default_allocator.dupe(u8, "Bun"));
    try response.connect_attrs.put(bun.default_allocator, try bun.default_allocator.dupe(u8, "_client_version"), try bun.default_allocator.dupe(u8, bun.Global.package_json_version_with_revision));

    // Generate auth response based on plugin
    var scrambled_buf: [32]u8 = undefined;
    if (this.#auth_plugin) |plugin| {
        if (this.#auth_data.items.len == 0) {
            return error.MissingAuthData;
        }

        response.auth_response = .{ .temporary = try plugin.scramble(this.#password, this.#auth_data.items, &scrambled_buf) };
    }
    response.capability_flags.reject();
    try response.write(this.writer());
    this.#capabilities = response.capability_flags;
    this.flushData();
}

pub fn sendAuthSwitchResponse(this: *MySQLConnection, auth_method: AuthMethod, plugin_data: []const u8) !void {
    var response = AuthSwitchResponse{};
    defer response.deinit();

    var scrambled_buf: [32]u8 = undefined;

    response.auth_response = .{
        .temporary = try auth_method.scramble(this.#password, plugin_data, &scrambled_buf),
    };

    var response_writer = this.writer();
    var packet = try response_writer.start(this.#sequence_id);
    try response.write(response_writer);
    try packet.end();
    this.flushData();
}

pub const Writer = struct {
    connection: *MySQLConnection,

    pub fn write(this: Writer, data: []const u8) AnyMySQLError.Error!void {
        var buffer = &this.connection.#write_buffer;
        try buffer.write(bun.default_allocator, data);
    }

    pub fn pwrite(this: Writer, data: []const u8, index: usize) AnyMySQLError.Error!void {
        @memcpy(this.connection.#write_buffer.byte_list.slice()[index..][0..data.len], data);
    }

    pub fn offset(this: Writer) usize {
        return this.connection.#write_buffer.len();
    }
};

pub fn writer(this: *MySQLConnection) NewWriter(Writer) {
    return .{
        .wrapped = .{
            .connection = this,
        },
    };
}

pub const Reader = struct {
    connection: *MySQLConnection,

    pub fn markMessageStart(this: Reader) void {
        this.connection.#last_message_start = this.connection.#read_buffer.head;
    }

    pub fn setOffsetFromStart(this: Reader, offset: usize) void {
        this.connection.#read_buffer.head = this.connection.#last_message_start + @as(u32, @truncate(offset));
    }

    pub const ensureLength = ensureCapacity;

    pub fn peek(this: Reader) []const u8 {
        return this.connection.#read_buffer.remaining();
    }

    pub fn skip(this: Reader, count: isize) void {
        if (count < 0) {
            const abs_count = @abs(count);
            if (abs_count > this.connection.#read_buffer.head) {
                this.connection.#read_buffer.head = 0;
                return;
            }
            this.connection.#read_buffer.head -= @intCast(abs_count);
            return;
        }

        const ucount: usize = @intCast(count);
        if (this.connection.#read_buffer.head + ucount > this.connection.#read_buffer.byte_list.len) {
            this.connection.#read_buffer.head = this.connection.#read_buffer.byte_list.len;
            return;
        }

        this.connection.#read_buffer.head += @intCast(ucount);
    }

    pub fn ensureCapacity(this: Reader, count: usize) bool {
        return this.connection.#read_buffer.remaining().len >= count;
    }

    pub fn read(this: Reader, count: usize) AnyMySQLError.Error!Data {
        const remaining = this.peek();
        if (remaining.len < count) {
            return AnyMySQLError.Error.ShortRead;
        }

        this.skip(@intCast(count));
        return Data{
            .temporary = remaining[0..count],
        };
    }

    pub fn readZ(this: Reader) AnyMySQLError.Error!Data {
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

pub fn bufferedReader(this: *MySQLConnection) NewReader(Reader) {
    return .{
        .wrapped = .{
            .connection = this,
        },
    };
}

fn checkIfPreparedStatementIsDone(this: *MySQLConnection, statement: *MySQLStatement) void {
    debug("checkIfPreparedStatementIsDone: {d} {d} {d} {d}", .{ statement.columns_received, statement.params_received, statement.columns.len, statement.params.len });
    if (statement.columns_received == statement.columns.len and statement.params_received == statement.params.len) {
        statement.status = .prepared;
        this.#flags.waiting_to_prepare = false;
        this.#flags.is_ready_for_query = true;
        this.queue.markAsReadyForQuery();
        this.queue.markAsPrepared();
        statement.reset();
        this.queue.advance(this.getJSConnection());
    }
}

pub fn handlePreparedStatement(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context), header_length: u24) !void {
    debug("handlePreparedStatement", .{});
    const first_byte = try reader.int(u8);
    reader.skip(-1);

    const request = this.queue.current() orelse {
        debug("Unexpected prepared statement packet missing request", .{});
        return error.UnexpectedPacket;
    };
    request.ref();
    defer request.deref();
    const statement = request.getStatement() orelse {
        debug("Unexpected prepared statement packet missing statement", .{});
        return error.UnexpectedPacket;
    };
    statement.ref();
    defer statement.deref();
    if (statement.statement_id > 0) {
        if (statement.params_received < statement.params.len) {
            var column = ColumnDefinition41{};
            defer column.deinit();
            try column.decode(reader);
            statement.params[statement.params_received] = .{
                .type = column.column_type,
                .flags = column.flags,
            };
            statement.params_received += 1;
        } else if (statement.columns_received < statement.columns.len) {
            try statement.columns[statement.columns_received].decode(reader);
            statement.columns_received += 1;
        }
        this.checkIfPreparedStatementIsDone(statement);
        return;
    }

    switch (@as(PacketType, @enumFromInt(first_byte))) {
        .OK => {
            var ok = StmtPrepareOKPacket{
                .packet_length = header_length,
            };
            try ok.decode(reader);

            // Get the current request

            statement.statement_id = ok.statement_id;

            // Read parameter definitions if any
            if (ok.num_params > 0) {
                statement.params = try bun.default_allocator.alloc(MySQLStatement.Param, ok.num_params);
                statement.params_received = 0;
            }

            // Read column definitions if any
            if (ok.num_columns > 0) {
                statement.columns = try bun.default_allocator.alloc(ColumnDefinition41, ok.num_columns);
                statement.columns_received = 0;
            }

            this.checkIfPreparedStatementIsDone(statement);
        },

        .ERROR => {
            debug("handlePreparedStatement ERROR", .{});
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();
            const connection = this.getJSConnection();
            defer {
                this.queue.advance(connection);
            }
            this.#flags.is_ready_for_query = true;
            statement.status = .failed;
            statement.error_response = err;
            this.queue.markAsReadyForQuery();
            this.queue.markCurrentRequestAsFinished(request);

            connection.onErrorPacket(request, err);
        },

        else => {
            debug("Unexpected prepared statement packet: 0x{x:0>2}", .{first_byte});
            return error.UnexpectedPacket;
        },
    }
}

fn handleResultSetOK(this: *MySQLConnection, request: *JSMySQLQuery, statement: *MySQLStatement, status_flags: StatusFlags, last_insert_id: u64, affected_rows: u64) void {
    this.#status_flags = status_flags;
    const is_last_result = !status_flags.has(.SERVER_MORE_RESULTS_EXISTS);
    const connection = this.getJSConnection();
    debug("handleResultSetOK: {d} {}", .{ status_flags.toInt(), is_last_result });
    defer {
        // Use flushQueue instead of just advance to ensure any data written
        // by queries added during onQueryResult is actually sent.
        // This fixes a race condition where the auto flusher may not be
        // registered if the queue's current item is completed (not pending).
        this.flushQueue() catch {};
    }
    this.#flags.is_ready_for_query = is_last_result;
    if (is_last_result) {
        this.queue.markAsReadyForQuery();
        this.queue.markCurrentRequestAsFinished(request);
    }

    connection.onQueryResult(request, .{
        .result_count = statement.result_count,
        .last_insert_id = last_insert_id,
        .affected_rows = affected_rows,
        .is_last_result = is_last_result,
    });

    statement.reset();
}

fn getJSConnection(this: *MySQLConnection) *JSMySQLConnection {
    return @fieldParentPtr("#connection", this);
}

fn handleResultSet(this: *MySQLConnection, comptime Context: type, reader: NewReader(Context), header_length: u24) !void {
    const first_byte = try reader.int(u8);
    debug("handleResultSet: {x:0>2}", .{first_byte});

    reader.skip(-1);

    var request = this.queue.current() orelse {
        debug("Unexpected result set packet", .{});
        return error.UnexpectedPacket;
    };
    request.ref();
    defer request.deref();
    var ok = OKPacket{
        .packet_size = header_length,
    };
    switch (@as(PacketType, @enumFromInt(first_byte))) {
        .ERROR => {
            const connection = this.getJSConnection();
            var err = ErrorPacket{};
            try err.decode(reader);
            defer err.deinit();
            defer {
                this.flushQueue() catch {};
            }
            if (request.getStatement()) |statement| {
                statement.reset();
            }

            this.#flags.is_ready_for_query = true;
            this.queue.markAsReadyForQuery();
            this.queue.markCurrentRequestAsFinished(request);

            connection.onErrorPacket(request, err);
        },

        else => |packet_type| {
            const statement = request.getStatement() orelse {
                debug("Unexpected result set packet", .{});
                return error.UnexpectedPacket;
            };
            statement.ref();
            defer statement.deref();
            if (!statement.execution_flags.header_received) {
                if (packet_type == .OK) {
                    // if packet type is OK it means the query is done and no results are returned
                    try ok.decode(reader);
                    defer ok.deinit();
                    this.handleResultSetOK(request, statement, ok.status_flags, ok.last_insert_id, ok.affected_rows);
                    return;
                }

                var header = ResultSetHeader{};
                try header.decode(reader);
                if (header.field_count == 0) {
                    // Can't be 0
                    return error.UnexpectedPacket;
                }
                if (statement.columns.len != header.field_count) {
                    debug("header field count mismatch: {d} != {d}", .{ statement.columns.len, header.field_count });
                    statement.cached_structure.deinit();
                    statement.cached_structure = .{};
                    if (statement.columns.len > 0) {
                        for (statement.columns) |*column| {
                            column.deinit();
                        }
                        bun.default_allocator.free(statement.columns);
                    }
                    statement.columns = try bun.default_allocator.alloc(ColumnDefinition41, header.field_count);
                    statement.columns_received = 0;
                }
                statement.execution_flags.needs_duplicate_check = true;
                statement.execution_flags.header_received = true;
                return;
            } else if (statement.columns_received < statement.columns.len) {
                try statement.columns[statement.columns_received].decode(reader);
                statement.columns_received += 1;
            } else {
                if (packet_type == .OK or packet_type == .EOF) {
                    if (request.isSimple() or packet_type == .EOF) {
                        // if we are using the text protocol for sure this is a OK packet otherwise will be OK packet with 0xFE code
                        // If is not simple and is EOF this is actually a OK packet but with the flag EOF
                        try ok.decode(reader);
                        defer ok.deinit();

                        this.handleResultSetOK(request, statement, ok.status_flags, ok.last_insert_id, ok.affected_rows);
                        return;
                    }
                }

                const connection = this.getJSConnection();

                try connection.onResultRow(request, statement, Context, reader);
            }
        },
    }
}

const PreparedStatementsMap = std.HashMapUnmanaged(u64, *MySQLStatement, bun.IdentityContext(u64), 80);
const debug = bun.Output.scoped(.MySQLConnection, .visible);

pub const ErrorPacket = @import("./protocol/ErrorPacket.zig");

const MAX_PIPELINE_SIZE = std.math.maxInt(u16); // about 64KB per connection
pub const PreparedStatementsMapGetOrPutResult = PreparedStatementsMap.GetOrPutResult;

const AnyMySQLError = @import("./protocol/AnyMySQLError.zig");
const Auth = @import("./protocol/Auth.zig");
const AuthSwitchRequest = @import("./protocol/AuthSwitchRequest.zig");
const AuthSwitchResponse = @import("./protocol/AuthSwitchResponse.zig");
const Capabilities = @import("./Capabilities.zig");
const ColumnDefinition41 = @import("./protocol/ColumnDefinition41.zig");
const HandshakeResponse41 = @import("./protocol/HandshakeResponse41.zig");
const HandshakeV10 = @import("./protocol/HandshakeV10.zig");
const JSMySQLConnection = @import("./js/JSMySQLConnection.zig");
const JSMySQLQuery = @import("./js/JSMySQLQuery.zig");
const LocalInfileRequest = @import("./protocol/LocalInfileRequest.zig");
const MySQLRequestQueue = @import("./MySQLRequestQueue.zig");
const MySQLStatement = @import("./MySQLStatement.zig");
const OKPacket = @import("./protocol/OKPacket.zig");
const PacketHeader = @import("./protocol/PacketHeader.zig");
const ResultSetHeader = @import("./protocol/ResultSetHeader.zig");
const SSLRequest = @import("./protocol/SSLRequest.zig");
const SocketMonitor = @import("../postgres/SocketMonitor.zig");
const StackReader = @import("./protocol/StackReader.zig");
const StmtPrepareOKPacket = @import("./protocol/StmtPrepareOKPacket.zig");
const std = @import("std");
const AuthMethod = @import("./AuthMethod.zig").AuthMethod;
const CharacterSet = @import("./protocol/CharacterSet.zig").CharacterSet;
const ConnectionFlags = @import("../shared/ConnectionFlags.zig").ConnectionFlags;
const ConnectionState = @import("./ConnectionState.zig").ConnectionState;
const Data = @import("../shared/Data.zig").Data;
const NewReader = @import("./protocol/NewReader.zig").NewReader;
const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
const PacketType = @import("./protocol/PacketType.zig").PacketType;
const SSLMode = @import("./SSLMode.zig").SSLMode;
const StatusFlags = @import("./StatusFlags.zig").StatusFlags;
const TLSStatus = @import("./TLSStatus.zig").TLSStatus;

const bun = @import("bun");
const BoringSSL = bun.BoringSSL;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;

const uws = bun.uws;
const Socket = uws.AnySocket;
