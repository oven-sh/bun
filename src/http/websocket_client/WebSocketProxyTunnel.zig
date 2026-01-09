/// WebSocketProxyTunnel handles TLS inside an HTTP CONNECT tunnel for wss:// through HTTP proxy.
///
/// This is used when connecting to a wss:// WebSocket server through an HTTP proxy.
/// The flow is:
/// 1. HTTP CONNECT request to proxy (handled by WebSocketUpgradeClient)
/// 2. Proxy responds with 200 Connection Established
/// 3. TLS handshake inside the tunnel (handled by this module using SSLWrapper)
/// 4. WebSocket upgrade request through the TLS tunnel
/// 5. WebSocket 101 response
/// 6. Hand off to WebSocket client
const WebSocketProxyTunnel = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

/// Union type for upgrade client to maintain type safety.
/// The upgrade client can be either HTTP or HTTPS depending on the proxy connection.
pub const UpgradeClientUnion = union(enum) {
    http: *NewHTTPUpgradeClient(false),
    https: *NewHTTPUpgradeClient(true),
    none: void,

    pub fn handleDecryptedData(self: UpgradeClientUnion, data: []const u8) void {
        switch (self) {
            .http => |client| client.handleDecryptedData(data),
            .https => |client| client.handleDecryptedData(data),
            .none => {},
        }
    }

    pub fn terminate(self: UpgradeClientUnion, code: ErrorCode) void {
        switch (self) {
            .http => |client| client.terminate(code),
            .https => |client| client.terminate(code),
            .none => {},
        }
    }

    pub fn onProxyTLSHandshakeComplete(self: UpgradeClientUnion) void {
        switch (self) {
            .http => |client| client.onProxyTLSHandshakeComplete(),
            .https => |client| client.onProxyTLSHandshakeComplete(),
            .none => {},
        }
    }

    pub fn isNone(self: UpgradeClientUnion) bool {
        return self == .none;
    }
};

const WebSocketClient = @import("../websocket_client.zig").NewWebSocketClient(false);

ref_count: RefCount,
/// Reference to the upgrade client (WebSocketUpgradeClient) - used during handshake phase
#upgrade_client: UpgradeClientUnion = .{ .none = {} },
/// Reference to the connected WebSocket client - used after successful upgrade
#connected_websocket: ?*WebSocketClient = null,
/// SSL wrapper for TLS inside tunnel
#wrapper: ?SSLWrapperType = null,
/// Socket reference (the proxy connection)
#socket: SocketUnion = .{ .none = {} },
/// Write buffer for encrypted data (maintains TLS record ordering)
#write_buffer: bun.io.StreamBuffer = .{},
/// Hostname for SNI (Server Name Indication)
#sni_hostname: ?[]const u8 = null,
/// Whether to reject unauthorized certificates
#reject_unauthorized: bool = true,

const SocketUnion = union(enum) {
    tcp: uws.NewSocketHandler(false),
    ssl: uws.NewSocketHandler(true),
    none: void,

    pub fn write(self: SocketUnion, data: []const u8) c_int {
        return switch (self) {
            .tcp => |s| s.write(data),
            .ssl => |s| s.write(data),
            .none => 0,
        };
    }

    pub fn isClosed(self: SocketUnion) bool {
        return switch (self) {
            .tcp => |s| s.isClosed(),
            .ssl => |s| s.isClosed(),
            .none => true,
        };
    }
};

const SSLWrapperType = SSLWrapper(*WebSocketProxyTunnel);

/// Initialize a new proxy tunnel with all required parameters
pub fn init(
    comptime ssl: bool,
    upgrade_client: *NewHTTPUpgradeClient(ssl),
    socket: uws.NewSocketHandler(ssl),
    sni_hostname: []const u8,
    reject_unauthorized: bool,
) !*WebSocketProxyTunnel {
    return bun.new(WebSocketProxyTunnel, .{
        .ref_count = .init(),
        .#upgrade_client = if (comptime ssl) .{ .https = upgrade_client } else .{ .http = upgrade_client },
        .#socket = if (comptime ssl) .{ .ssl = socket } else .{ .tcp = socket },
        .#sni_hostname = try bun.default_allocator.dupe(u8, sni_hostname),
        .#reject_unauthorized = reject_unauthorized,
    });
}

fn deinit(this: *WebSocketProxyTunnel) void {
    if (this.#wrapper) |*wrapper| {
        wrapper.deinit();
        this.#wrapper = null;
    }
    this.#write_buffer.deinit();
    if (this.#sni_hostname) |hostname| {
        bun.default_allocator.free(hostname);
        this.#sni_hostname = null;
    }
    bun.destroy(this);
}

/// Start TLS handshake inside the tunnel
/// The ssl_options should contain all TLS configuration including CA certificates.
pub fn start(this: *WebSocketProxyTunnel, ssl_options: SSLConfig, initial_data: []const u8) !void {
    // Allow handshake to complete so we can access peer certificate for manual
    // hostname verification in onHandshake(). The actual reject_unauthorized
    // check uses this.#reject_unauthorized field.
    const options = ssl_options.forClientVerification();

    this.#wrapper = try SSLWrapperType.init(options, true, .{
        .ctx = this,
        .onOpen = onOpen,
        .onData = onData,
        .onHandshake = onHandshake,
        .onClose = onClose,
        .write = writeEncrypted,
    });

    if (initial_data.len > 0) {
        this.#wrapper.?.startWithPayload(initial_data);
    } else {
        this.#wrapper.?.start();
    }
}

/// SSLWrapper callback: Called before TLS handshake starts
fn onOpen(this: *WebSocketProxyTunnel) void {
    this.ref();
    defer this.deref();

    log("onOpen", .{});
    // Configure SNI with hostname
    if (this.#wrapper) |*wrapper| {
        if (wrapper.ssl) |ssl_ptr| {
            if (this.#sni_hostname) |hostname| {
                if (!bun.strings.isIPAddress(hostname)) {
                    // Set SNI hostname
                    const hostname_z = bun.default_allocator.dupeZ(u8, hostname) catch return;
                    defer bun.default_allocator.free(hostname_z);
                    ssl_ptr.configureHTTPClient(hostname_z);
                }
            }
        }
    }
}

/// SSLWrapper callback: Called with decrypted data from the network
fn onData(this: *WebSocketProxyTunnel, decrypted_data: []const u8) void {
    this.ref();
    defer this.deref();

    log("onData: {} bytes", .{decrypted_data.len});
    if (decrypted_data.len == 0) return;

    // If we have a connected WebSocket client, forward data to it
    if (this.#connected_websocket) |ws| {
        ws.handleTunnelData(decrypted_data);
        return;
    }

    // Otherwise, forward to the upgrade client for WebSocket response processing
    this.#upgrade_client.handleDecryptedData(decrypted_data);
}

/// SSLWrapper callback: Called after TLS handshake completes
fn onHandshake(this: *WebSocketProxyTunnel, success: bool, ssl_error: uws.us_bun_verify_error_t) void {
    this.ref();
    defer this.deref();

    log("onHandshake: success={}", .{success});

    if (this.#upgrade_client.isNone()) return;

    if (!success) {
        this.#upgrade_client.terminate(ErrorCode.tls_handshake_failed);
        return;
    }

    // Check for SSL errors if we need to reject unauthorized
    if (this.#reject_unauthorized) {
        if (ssl_error.error_no != 0) {
            this.#upgrade_client.terminate(ErrorCode.tls_handshake_failed);
            return;
        }

        // Verify server identity
        if (this.#wrapper) |*wrapper| {
            if (wrapper.ssl) |ssl_ptr| {
                if (this.#sni_hostname) |hostname| {
                    if (!BoringSSL.checkServerIdentity(ssl_ptr, hostname)) {
                        this.#upgrade_client.terminate(ErrorCode.tls_handshake_failed);
                        return;
                    }
                }
            }
        }
    }

    // TLS handshake successful - notify client to send WebSocket upgrade
    this.#upgrade_client.onProxyTLSHandshakeComplete();
}

/// SSLWrapper callback: Called when connection is closing
fn onClose(this: *WebSocketProxyTunnel) void {
    this.ref();
    defer this.deref();

    log("onClose", .{});

    // If we have a connected WebSocket client, notify it of the close
    if (this.#connected_websocket) |ws| {
        ws.fail(ErrorCode.ended);
        return;
    }

    // Check if upgrade client is already cleaned up (prevents re-entrancy during cleanup)
    if (this.#upgrade_client.isNone()) return;

    // Otherwise notify the upgrade client
    this.#upgrade_client.terminate(ErrorCode.ended);
}

/// Set the connected WebSocket client. Called after successful WebSocket upgrade.
/// This transitions the tunnel from upgrade phase to connected phase.
/// After calling this, decrypted data will be forwarded to the WebSocket client.
pub fn setConnectedWebSocket(this: *WebSocketProxyTunnel, ws: *WebSocketClient) void {
    log("setConnectedWebSocket", .{});
    this.#connected_websocket = ws;
    // Clear the upgrade client reference since we're now in connected phase
    this.#upgrade_client = .{ .none = {} };
}

/// SSLWrapper callback: Called with encrypted data to send to network
fn writeEncrypted(this: *WebSocketProxyTunnel, encrypted_data: []const u8) void {
    log("writeEncrypted: {} bytes", .{encrypted_data.len});

    // If data is already buffered, queue this to maintain TLS record ordering
    if (this.#write_buffer.isNotEmpty()) {
        bun.handleOom(this.#write_buffer.write(encrypted_data));
        return;
    }

    // Try direct write to socket
    const written = this.#socket.write(encrypted_data);
    if (written < 0) {
        // Write failed - buffer data for retry when socket becomes writable
        bun.handleOom(this.#write_buffer.write(encrypted_data));
        return;
    }

    // Buffer remaining data
    const written_usize: usize = @intCast(written);
    if (written_usize < encrypted_data.len) {
        bun.handleOom(this.#write_buffer.write(encrypted_data[written_usize..]));
    }
}

/// Called when the socket becomes writable - flush buffered encrypted data
pub fn onWritable(this: *WebSocketProxyTunnel) void {
    this.ref();
    defer this.deref();

    // Flush the SSL state machine
    if (this.#wrapper) |*wrapper| {
        _ = wrapper.flush();
    }

    // Send buffered encrypted data
    const to_send = this.#write_buffer.slice();
    if (to_send.len == 0) return;

    const written = this.#socket.write(to_send);
    if (written < 0) return;

    const written_usize: usize = @intCast(written);
    if (written_usize == to_send.len) {
        this.#write_buffer.reset();
    } else {
        this.#write_buffer.cursor += written_usize;
    }
}

/// Feed encrypted data from the network to the SSL wrapper for decryption
pub fn receive(this: *WebSocketProxyTunnel, data: []const u8) void {
    this.ref();
    defer this.deref();

    if (this.#wrapper) |*wrapper| {
        wrapper.receiveData(data);
    }
}

/// Write application data through the tunnel (will be encrypted)
pub fn write(this: *WebSocketProxyTunnel, data: []const u8) !usize {
    if (this.#wrapper) |*wrapper| {
        return try wrapper.writeData(data);
    }
    return error.ConnectionClosed;
}

/// Gracefully shutdown the TLS connection
pub fn shutdown(this: *WebSocketProxyTunnel) void {
    if (this.#wrapper) |*wrapper| {
        _ = wrapper.shutdown(true); // Fast shutdown
    }
}

/// Check if the tunnel has backpressure
pub fn hasBackpressure(this: *const WebSocketProxyTunnel) bool {
    return this.#write_buffer.isNotEmpty();
}

/// C export for setting the connected WebSocket client from C++
pub export fn WebSocketProxyTunnel__setConnectedWebSocket(tunnel: *WebSocketProxyTunnel, ws: *WebSocketClient) void {
    tunnel.setConnectedWebSocket(ws);
}

const log = bun.Output.scoped(.WebSocketProxyTunnel, .visible);

const ErrorCode = @import("../websocket_client.zig").ErrorCode;
const NewHTTPUpgradeClient = @import("./WebSocketUpgradeClient.zig").NewHTTPUpgradeClient;
const SSLWrapper = @import("../../bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;

const bun = @import("bun");
const BoringSSL = bun.BoringSSL;
const jsc = bun.jsc;
const uws = bun.uws;
const SSLConfig = jsc.API.ServerConfig.SSLConfig;
