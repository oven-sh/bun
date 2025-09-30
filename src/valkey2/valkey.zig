///! Fully-featured Valkey/Redis client.
///!
///! Note that this is completely decoupled from JavaScript and adding
///! JavaScript-specific functionality is an anti-pattern.
pub const ValkeyClient = struct {
    // The client is implemented as a state machine, with each state
    // representing a different phase of the client's lifecycle.
    const Self = @This();

    /// Set of possible errors the ValkeyClient can encounter.
    pub const Error = error{
        InvalidState,
    };

    /// Underlying WebSocket connection to the Valkey server. Interacts with
    /// the client through `SocketHandler`.
    socket_io: SocketIO,

    state: ClientState,

    /// Queue of commands that are pending to be sent to the server.
    outbound_queue: std.fifo.LinearFifo(SerializedCommand, .Dynamic),

    /// Queue of commands that have been sent to the server and are awaiting a
    /// response.
    inflight_queue: std.fifo.LinearFifo(SerializedCommand, .Dynamic),

    /// Create a new Valkey client instance.
    pub fn init() Self {
        return Self{};
    }

    /// Estimate the total number of bytes used by this client.
    pub fn memoryUsage(self: *const Self) usize {
        _ = self;
        // TODO(markovejnovic): Implement this properly.
        return 0;
    }

    /// Initialize with a new Valkey client instance with a socket.
    pub fn initWithSocket(socket: bun.uws.AnySocket) Self {
        return Self{
            .socket = socket,
            .state = ClientState{},
        };
    }

    /// Deinitialize the Valkey client instance.
    pub fn deinit(self: *Self) void {
        _ = self;
    }

    /// Create a new copy of this client.
    pub fn duplicate() Self {}

    /// Attempt to connect to the Valkey server.
    ///
    /// Errors:
    ///   - `Error.InvalidState` if the client is already connected.
    pub fn connect(self: *Self) Error!void {
        if (!self.state.canCreateConnection()) {
            return error.InvalidState;
        }

        // TODO(markovejnovic): Implement connection logic.
    }

    /// Attempt to close the connection to the Valkey server.
    pub fn close(self: *Self) Error!void {
        _ = self;
    }

    /// Invoked whenever a packet is received from the server.
    pub fn onData(self: *Self, data: []const u8) void {
        self.state.onData(data);
    }

    /// Test whether the client is currently connected to a Valkey server or
    /// not.
    pub fn isConnected(self: *const Self) bool {
        return switch (self.state) {
            .linked => |l_state| switch (l_state.state) {
                .authenticating => false,
                else => true,
            },
            else => false,
        };
    }
};

/// Enum representing whether SSL/TLS is enabled or not.
///
/// Better than a flag because it commuicates intent more clearly.
const SSLMode = enum(bool) {
    with_ssl,
    without_ssl,

    pub fn sslEnabled(self: SSLMode) bool {
        return switch (self) {
            .with_ssl => true,
            .without_ssl => false,
        };
    }

    pub fn fromBool(enabled: bool) SSLMode {
        return switch (enabled) {
            true => .with_ssl,
            false => .without_ssl,
        };
    }
};

/// Structure which handles the WebSocket events for the Valkey client.
/// Encapsulates the socket and its context.
const SocketIO = struct {
    const Self = @This();

    _socket: bun.uws.AnySocket,
    _context: ?*bun.uws.SocketContext,

    /// Fetch the ValkeyClient which owns this SocketIO.
    fn parentClient(self: *Self) *ValkeyClient {
        return @alignCast(@fieldParentPtr("socket_io", self));
    }

    pub fn write(self: *Self, data: []const u8) usize {
        return self._socket.write(data);
    }

    /// Deinitialize the socket and its context.
    pub fn deinit(self: *Self) void {
        if (self._context) |ctx| {
            ctx.deinit(false);
        }
    }

    /// Check if the socket is using TLS.
    pub fn usingTls(self: *const Self) bool {
        return switch (self._socket) {
            .SocketTLS => true,
            .SocketTCP => false,
        };
    }

    /// Interactions between the socket and the Valkey client are handled here.
    fn SocketHandler(comptime ssl_mode: SSLMode) type {
        const SocketType = bun.uws.NewSocketHandler(ssl_mode.sslEnabled());

        return struct {
            // This is laid out in such a way that SocketIO patches its own
            // state and then lets the state machine handle the event.

            pub fn onOpen(self: *Self, socket: SocketType) void {
                Self.debug("{*}.onOpen()", .{self});
                self.patchSocket(socket);
                self.parentClient().onOpen();
            }

            pub fn onClose(
                self: *Self,
                socket: SocketType,
                _: i32,
                _: ?*anyopaque,
            ) void {
                Self.debug("{*}.onClose()", .{self});
                self.patchSocket(socket);
                self.parentClient().onClose();
            }

            pub fn onEnd(self: *Self, socket: SocketType) void {
                Self.debug("{*}.onEnd()", .{self});
                self.patchSocket(socket);
                self.parentClient().onEnd();
            }

            pub fn onConnectError(
                self: *Self,
                socket: SocketType,
                _: i32,
            ) void {
                Self.debug("{*}.onConnectError()", .{self});
                self.patchSocket(socket);
                self.parentClient().onConnectError();
            }

            pub fn onTimeout(self: *Self, socket: SocketType) void {
                Self.debug("{*}.onTimeout()", .{self});
                self.patchSocket(socket);
                self.parentClient().onTimeout();
            }

            /// Invoked whenever a packet is received from the server.
            pub fn onData(
                self: *Self,
                socket: SocketType,
                data: []const u8,
            ) void {
                Self.debug("{*}.onData(data={s})", .{ self, data });
                self.patchSocket(socket);
                self.parentClient().onData();
            }

            pub fn onWritable(self: *Self, socket: SocketType) void {
                Self.debug("{*}.onWritable(data={s})", .{self});
                self.patchSocket(socket);
                self.parentClient().onWritable();
            }

            /// Given a concrete socket, update the opaque socket of `self`.
            ///
            /// Necessary because the socket type can only be deduced at
            /// runtime.
            fn patchSocket(self: *Self, concrete_socket: anytype) void {
                self._socket = switch (ssl_mode) {
                    .with_ssl => bun.uws.AnySocket{
                        .SocketTLS = concrete_socket,
                    },
                    .without_ssl => bun.uws.AnySocket{
                        .SocketTCP = concrete_socket,
                    },
                };
            }
        };
    }

    const debug = bun.Output.scoped(.valkey_socket, .visible);
};

/// Encodes whether the addres is TCP-based or a Unix socket.
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
    pub fn location(self: ValkeyAddress) []u8 {
        return switch (self) {
            .tcp => |tcp| tcp.host,
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
        return switch (proto) {
            .standalone, .standalone_tls => .{
                .tcp = .{
                    .host = url.displayHostname(),
                    .port = url.getPort() orelse DEFAULT_VALKEY_PORT,
                },
            },
            .standalone_unix, .standalone_tls_unix => .{
                .unix = Self.parseUnixPath(url_mem) catch {
                    return error.MissingUnixLocation;
                },
            },
        };
    }

    /// Helper to grab the Unix socket path from a URL.
    fn parseUnixPath(url_mem: []const u8) ![]const u8 {
        const proto_idx = bun.strings.indexOf(url_mem, "://") orelse
            return error.MissingUnixProtocol;

        const sock_path = url_mem()[proto_idx + 3 ..];

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
};

/// Protocols used to connect to Valkey server.
const ValkeyProtocol = enum {
    standalone,
    standalone_unix,
    standalone_tls,
    standalone_tls_unix,

    const string_map = bun.ComptimeStringMap(ValkeyProtocol, .{
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

    pub fn isTLS(self: ValkeyProtocol) bool {
        return switch (self) {
            .standalone_tls, .standalone_tls_unix => true,
            else => false,
        };
    }

    pub fn isUnix(self: ValkeyProtocol) bool {
        return switch (self) {
            .standalone_unix, .standalone_tls_unix => true,
            else => false,
        };
    }

    /// Parse the protocol from a URL.
    /// Returns `standalone` if no protocol is specified.
    /// Errors out with `error.InvalidProtocol` if the protocol is not
    /// recognized.
    pub fn fromUrl(url: bun.URL) ValkeyProtocol {
        if (url.protocol.len == 0) {
            return .standalone;
        }

        return switch (string_map.get(url.protocol)) {
            null => return error.InvalidProtocol,
            else => |p| p,
        };
    }
};

/// Encodes various secondary options for the valkey client.
const ClientOptions = struct {
    idle_timeout_ms: u32 = 0,
    connection_timeout_ms: u32 = 10_000,
    enable_auto_reconnect: bool = true,
    max_retries: u32 = 20,
    enable_offline_queue: bool = true,
    enable_auto_pipelining: bool = true,
    enable_debug_logging: bool = false,

    // TODO(markovejnovic): Enable TLS
    //tls: TLS = .none,
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
    pub fn init(
        allocator: std.mem.Allocator,
        url_mem: []const u8,
        options: ClientOptions,
    ) !Self {
        const url = bun.URL.parse(url_mem);

        const proto = try ValkeyProtocol.fromUrl(url);

        var self = .{
            .username = "",
            .password = "",
            .database = 0,
            .protocol = proto,
            .address = undefined,
            .options = options,
            ._allocator = allocator,
            ._connection_str = null,
        };

        var owned_loc: []u8 = undefined;
        const address = try ValkeyAddress.fromUrlProto(url_mem, url, proto);
        const location = address.location();
        if (url.username.len > 0 or url.password.len > 0 or location.len > 0) {
            var builder = bun.StringBuilder{};
            builder.countMany(.{ url.username, url.password, location });

            try builder.allocate(self._allocator);
            defer builder.deinit(self._allocator);

            self.username, self.password, owned_loc = builder.appendMany(.{
                url.username,
                url.password,
                location,
            });

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
                .host = tcp.location,
                .port = tcp.port,
            } },
            .unix => ValkeyAddress{ .unix = owned_loc },
        };

        // Let's parse the database.
        if (url.pathname.len == 0) {
            return self;
        }

        const db_id = std.fmt.parseInt(u32, url.pathname[1..], 10) catch {
            return error.MalformedUrl;
        };

        self.database = db_id;

        return self;
    }

    /// Cleanup memory owned by this object, if necessary.
    pub fn deinit(self: *Self) void {
        if (self._connection_str) |str| {
            self._allocator.free(str);
        }
    }
};

/// State machine which encapsulates the current state of the Valkey client.
const ClientState = union(enum) {
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

        _allocator: std.mem.Allocator,

        /// The buffer used to accumulate outgoing data.
        _egress_buffer: bun.OffsetByteList = .{},

        /// The buffer used to accumulate incoming data.
        _ingress_buffer: bun.OffsetByteList = .{},

        /// Invoked whenever data is received from the server.
        pub fn onData(self: *@This(), packet: []const u8) void {
            // Path 1: Buffer already has data, append and process from buffer
            if (self._ingress_buffer.remaining().len > 0) {
                bun.handleOom(self._ingress_buffer.write(self.allocator, packet));
                self.drainIngressBuffer();
            }

            // Path 2: Buffer is empty, try processing directly from stack.
            self.parsePacket(packet);
        }

        pub fn onWritable(self: *@This()) void {
            self.sendNextCommand();
        }

        /// Flush out any data in the egress buffer to the socket.
        fn flushEgressBuffer(self: *Self) void {
            const chunk = self._egress_buffer.remaining();
            if (chunk.len == 0) {
                return;
            }

            // Note we only write here once? Why? Because uSockets will call
            // onWritable when it's ready to accept more data so we don't need
            // to block here.
            const written = self.parentClient().socket_io.write(chunk);
            if (written > 0) {
                self._egress_buffer.consume(@intCast(written));
            }
        }

        /// TODO(markovejnovic): This uses the legacy implementation.
        fn drainIngressBuffer(self: *@This()) void {
            while (true) {
                const remaining_buffer = self._ingress_buffer.remaining();
                if (remaining_buffer.len == 0) {
                    break;
                }

                var reader = protocol.ValkeyReader.init(remaining_buffer);
                const before_read_pos = reader.pos;

                var value = reader.readValue(self.allocator) catch |err| {
                    if (err == error.InvalidResponse) {
                        // Need more data in the buffer, wait for next onData
                        // call
                        return;
                    } else {
                        // TODO(markovejnovic): self.fail won't work,
                        // obviously.
                        self.fail("Failed to read data (buffer path)", err);
                        return;
                    }
                };
                defer value.deinit(self.allocator);

                const bytes_consumed = reader.pos - before_read_pos;
                if (bytes_consumed == 0 and remaining_buffer.len > 0) {
                    self.fail(
                        "Parser consumed 0 bytes unexpectedly (buffer path)",
                        error.InvalidResponse,
                    );
                    return;
                }

                self.read_buffer.consume(@truncate(bytes_consumed));

                var value_to_handle = value; // Use temp var for defer
                self.handleResponse(&value_to_handle) catch |err| {
                    self.fail("Failed to handle response (buffer path)", err);
                    return;
                };

                if (self.status == .disconnected or self.status == .failed) {
                    return;
                }
                self.sendNextCommand();
            }
        }

        /// TODO(markovejnovic): This uses the legacy implementation.
        fn parsePacket(self: *@This(), packet: []const u8) !protocol.ValkeyValue {
            var current_data_slice = packet;
            while (current_data_slice.len > 0) {
                var reader = protocol.ValkeyReader.init(current_data_slice);
                const before_read_pos = reader.pos;

                var value = reader.readValue(self.allocator) catch |err| {
                    if (err == error.InvalidResponse) {
                        // Partial message encountered on the stack-allocated path.
                        // Copy the *remaining* part of the stack data to the heap buffer
                        // and wait for more data.
                        if (comptime bun.Environment.allow_assert) {
                            Self.debug(
                                "read_buffer: partial message on stack ({d} bytes), switching to buffer",
                                .{current_data_slice.len - before_read_pos},
                            );
                        }
                        self.read_buffer.write(self.allocator, current_data_slice[before_read_pos..]) catch @panic("failed to write remaining stack data to buffer");
                        return; // Exit onData, next call will use the buffer path
                    } else {
                        // Any other error is fatal
                        self.fail("Failed to read data (stack path)", err);
                        return;
                    }
                };
                // Successfully read a full message from the stack data
                defer value.deinit(self.allocator);

                const bytes_consumed = reader.pos - before_read_pos;
                if (bytes_consumed == 0) {
                    // This case should ideally not happen if readValue succeeded and slice wasn't empty
                    self.fail("Parser consumed 0 bytes unexpectedly (stack path)", error.InvalidResponse);
                    return;
                }

                // Advance the view into the stack data slice for the next iteration
                current_data_slice = current_data_slice[bytes_consumed..];

                // Handle the successfully parsed response
                var value_to_handle = value; // Use temp var for defer
                self.handleResponse(&value_to_handle) catch |err| {
                    self.fail("Failed to handle response (stack path)", err);
                    return;
                };

                // Check connection status after handling
                if (self.status == .disconnected or self.status == .failed) {
                    return;
                }

                // After handling a response, try to send the next command
                self.sendNextCommand();

                // Loop continues with the remainder of current_data_slice
            }
        }
    },

    /// The user has closed the connection. This differs from the
    /// `disconnected` state in that we don't attempt to connect automatically.
    closed: struct {},

    /// Check if the client is in a state where a new connection can be
    /// initiated.
    pub fn canCreateConnection(self: *const Self) bool {
        return self.* == .disconnected or self.* == .closed;
    }

    pub fn onOpen(self: *Self) void {
        Self.debug("{*}.onOpen()", .{self});
        switch (self) {
            .opening => {
                // Great, we just opened the client. If we're using TLS, then
                // we transition to the handshake state.
                // Otherwise, we transition to the connecting state.
                self.transition(
                    if (self.parentClient().socket_io.usingTls())
                        .{ .handshake = {} }
                    else
                        .{ .connecting = {} },
                );
            },
            else => {
                Self.debug(
                    "Received an open event in {*} state. This is a " ++
                        "programming bug. We will drop the connection to " ++
                        "recover, but data is lost.",
                    .{self},
                );

                // TODO(markovejnovic): Throw some telemetry in here.

                self.transition(.{ .disconnected = {} });
            },
        }
    }

    pub fn onClose(self: *Self) void {
        Self.debug("{*}.onClose()", .{self});
        switch (self) {
            .disconnected => {},
            .connecting => {},
            .handshake => {},
        }
    }

    pub fn onData(self: *Self) void {
        Self.debug("{*}.onData()", .{self});
        switch (self) {
            .linked => |state| {
                if (state.ingress_buffer.len == 0) {
                    // This is a no-op. We received an empty packet.
                    return;
                }
            },
            .connecting => {},
            else => {
                Self.debug(
                    "Received data in {*} state. This is a programming " ++
                        "bug. We will drop the connection to recover, " ++
                        "but data is lost.",
                    .{self},
                );

                // TODO(markovejnovic): Throw some telemetry in here.

                self.transition(.{ .disconnected = {} });
            },
        }
    }

    /// Transition the state machine from one state to another.
    fn transition(self: *Self, new_state: Self) void {
        // TODO(markovejnovic): Obviously this is not implemented.
        self.* = new_state;
    }

    /// Fetch the ValkeyClient which owns this SocketIO.
    fn parentClient(self: *Self) *ValkeyClient {
        return @alignCast(@fieldParentPtr("state", self));
    }

    const debug = bun.Output.scoped(.valkey_state, .visible);
};

const SerializedCommand = struct {
    serialized_data: []u8,
    metadata: PacketMetadata,
};

const PacketMetadata = struct {};

const std = @import("std");
const bun = @import("bun");
const debug = bun.Output.scoped(.valkey, .visible);
const protocol = @import("protocol.zig");
