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
///!  - afterStateTransition(self: *Self, old_state: ValkeyClient.State,                                             new_state: ValkeyClient.State)
///!
///!
pub fn ValkeyClient(comptime ValkeyListener: type) type {
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
        _outbound_queue: std.fifo.LinearFifo(SerializedCommand, .Dynamic),

        /// Queue of commands that have been sent to the server and are awaiting a response.
        ///
        /// TODO(markovejnovic): Does this need to live in the base state?
        _inflight_queue: std.fifo.LinearFifo(SerializedCommand, .Dynamic),

        /// The connection parameters used to connect to the Valkey server.
        _connection_params: ConnParams,

        /// Set of user-provided callbacks into the client.
        _callbacks: *ValkeyListener,

        /// Create a new Valkey client instance.
        ///
        /// Arguments:
        ///   - `url_str`: The connection string to use.
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
                ._outbound_queue = std.fifo.LinearFifo(SerializedCommand, .Dynamic).init(allocator),
                ._inflight_queue = std.fifo.LinearFifo(SerializedCommand, .Dynamic).init(allocator),
                ._connection_params = cparams,
            };
        }

        /// Estimate the total number of bytes used by this client. This includes @sizeof(Self).
        pub fn memoryUsage(self: *const Self) usize {
            return ((self._outbound_queue.buf.len * @sizeOf(SerializedCommand)) +
                (self._inflight_queue.buf.len * @sizeOf(SerializedCommand)) +
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

        /// Invoked whenever a packet is received from the server.
        pub fn onData(self: *Self, data: []const u8) void {
            self._state.onData(data);
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

        fn runBeforeStateTransitionCallback(
            self: *Self,
            from_state: *State,
            to_state: *State,
        ) void {
            if (comptime std.meta.hasFn(
                ValkeyListener,
                "beforeStateTransition",
            )) {
                self._callbacks.beforeStateTransition(from_state, to_state);
            }
        }

        fn runAfterStateTransitionCallback(
            self: *Self,
            from_state: *State,
            to_state: *State,
        ) void {
            if (comptime std.meta.hasFn(
                ValkeyListener,
                "afterStateTransition",
            )) {
                self._callbacks.afterStateTransition(from_state, to_state);
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

            var hello_cmd = Command().initWithArgs(
                "HELLO",
                .{ .raw = hello_args },
            );

            // Ship out the HELLO command. This can go straight to the egress
            // buffer.
            hello_cmd.write(self.egressWriter()) catch |e| {
                Self.debug("{*} Failed to write HELLO command: {any}", .{
                    self,
                    e,
                });
                return e;
            };

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
            //    var select_cmd = Command().initWithArgs(
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
        }

        /// Zig std.io.Writer-compatible interface for writing to the egress
        /// buffer. Note that this can only be called while the socket is in
        /// the `.linked` state. See `_outbound_queue` for details.
        fn egressWriter(self: *Self) std.io.Writer(
            *Self,
            protocol.RedisError,
            egressWrite,
        ) {
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
                        "{*}.egressWrite invoked while in state {} which " ++
                            "does not support direct egress writing. Data " ++
                            "will be lost, and the connection may be broken.",
                        .{ self, self._state },
                    );

                    // TODO(markovejnovic): Actually go and fix this issue.
                    // TODO(markovejnovic): Definitely wrong error code.
                    return protocol.RedisError.InvalidArgument;
                },
            }
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

/// Structure which handles the WebSocket events for the Valkey client.
/// Encapsulates the socket and its context.
pub fn SocketIO(ValkeyClientType: type) type {
    return struct {
        const Self = @This();

        _socket: bun.uws.AnySocket,
        _context: *bun.uws.SocketContext,

        /// Attempt to create a new SocketIO instance.
        ///
        /// Errors:
        ///   - `error.FailedToCreateContext` if the underlying uWS context could
        ///     not be created. No further details are provided.
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
        /// - `error.FailedToCreateContext` if the context could not be created. No
        ///   further details are provided.
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

        pub fn write(self: *Self, data: []const u8) usize {
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

                pub fn onConnectError(
                    self: *Self,
                    socket: SocketHandlerType,
                    err_code: i32,
                ) void {
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
                pub fn onData(
                    self: *Self,
                    socket: SocketHandlerType,
                    data: []const u8,
                ) void {
                    Self.debug("{*}.onData(data={s})", .{ self, data });
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
                .with_ssl => bun.uws.AnySocket{
                    .SocketTLS = concrete_socket,
                },
                .without_ssl => bun.uws.AnySocket{
                    .SocketTCP = concrete_socket,
                },
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
                    Self.debug(
                        "Failed to parse UNIX socket path from URL: {s}",
                        .{url_mem},
                    );
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

            /// Invoked whenever data is received from the server.
            pub fn onData(self: *@This(), packet: []const u8) void {
                // Path 1: Buffer already has data, append and process from buffer
                if (self._ingress_buffer.remaining().len > 0) {
                    bun.handleOom(self._ingress_buffer.write(
                        self.allocator,
                        packet,
                    ));
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
                const written = self.parentClient()._socket_io.write(chunk);
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
            fn parsePacket(
                self: *@This(),
                packet: []const u8,
            ) !protocol.ValkeyValue {
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

            fn memoryUsage(self: *const @This()) usize {
                return self._egress_buffer.memoryCost() +
                    self._ingress_buffer.memoryCost();
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

        pub fn onClose(self: *Self) void {
            Self.debug("{*}.onClose()", .{self});
            switch (self) {
                .disconnected => {},
                .opening => {},
                .handshake => {},
            }
        }

        pub fn onData(self: *Self, data: []const u8) void {
            Self.debug("{*}.onData()", .{self});
            _ = data;
            switch (self.*) {
                .linked => |*state| {
                    // TODO(markovejnovic): Lol implemnet.
                    _ = state;
                },
                .opening => {},
                else => {
                    self.warnIllegalState("onData");
                    self.recoverFromIllegalState();
                },
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
            Self.debug(
                "Recovering from illegal state by transitioning to disconnected.",
                .{},
            );

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

            Self.debug("{*} MUTATING STATE: old={s} new={s} @{*}", .{
                self,
                @tagName(old_state),
                @tagName(new_state),
                &self.*,
            });
            self.* = new_state;
            Self.debug("{*} STATE MUTATED: now={s} @{*}", .{
                self,
                @tagName(self.*),
                &self.*,
            });
            self.parentClient().onStateTransition(
                &old_state,
                self,
            ) catch |err| {
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

const SerializedCommand = struct {
    serialized_data: []u8,
    metadata: PacketMetadata,
};

const PacketMetadata = struct {};

const std = @import("std");
const bun = @import("bun");
const protocol = @import("protocol.zig");
const Command = @import("command.zig").Command;
