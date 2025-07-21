const SOCKSProxy = @This();
const RefCount = bun.ptr.RefCount(@This(), "ref_count", SOCKSProxy.deinit, .{});
pub const ref = SOCKSProxy.RefCount.ref;
pub const deref = SOCKSProxy.RefCount.deref;

state: SOCKSState = .init,
destination_host: []const u8 = "",
destination_port: u16 = 0,
proxy_url: URL,
allocator: std.mem.Allocator,
ref_count: RefCount,
write_buffer: std.ArrayList(u8),
write_offset: usize = 0,

const SOCKSState = enum {
    init,
    auth_handshake,
    auth_handshake_pending,
    auth_complete,
    connect_request,
    connect_request_pending,
    connected,
    failed,
};

const SOCKSVersion = enum(u8) {
    v5 = 0x05,
};

const SOCKSAuthMethod = enum(u8) {
    no_auth = 0x00,
    gssapi = 0x01,
    username_password = 0x02,
    no_acceptable = 0xFF,
};

const SOCKSCommand = enum(u8) {
    connect = 0x01,
    bind = 0x02,
    udp_associate = 0x03,
};

const SOCKSAddressType = enum(u8) {
    ipv4 = 0x01,
    domain_name = 0x03,
    ipv6 = 0x04,
};

const SOCKSReply = enum(u8) {
    succeeded = 0x00,
    general_failure = 0x01,
    connection_not_allowed = 0x02,
    network_unreachable = 0x03,
    host_unreachable = 0x04,
    connection_refused = 0x05,
    ttl_expired = 0x06,
    command_not_supported = 0x07,
    address_type_not_supported = 0x08,
};

pub fn create(allocator: std.mem.Allocator, proxy_url: URL, destination_host: []const u8, destination_port: u16) !*SOCKSProxy {
    // Clone the destination_host to ensure memory safety
    const cloned_host = try allocator.dupe(u8, destination_host);

    const socks_proxy = bun.new(SOCKSProxy, .{
        .ref_count = .init(),
        .proxy_url = proxy_url,
        .destination_host = cloned_host,
        .destination_port = destination_port,
        .allocator = allocator,
        .write_buffer = std.ArrayList(u8).init(allocator),
        .write_offset = 0,
    });

    return socks_proxy;
}

pub fn sendAuthHandshake(this: *SOCKSProxy, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    // SOCKS5 authentication handshake
    // +----+----------+----------+
    // |VER | NMETHODS | METHODS  |
    // +----+----------+----------+
    // | 1  |    1     | 1 to 255 |
    // +----+----------+----------+
    const auth_request = [_]u8{ @intFromEnum(SOCKSVersion.v5), 1, @intFromEnum(SOCKSAuthMethod.no_auth) };

    // Prepare write buffer
    this.write_buffer.clearRetainingCapacity();
    this.write_buffer.appendSlice(&auth_request) catch return;
    this.write_offset = 0;

    this.flushWriteBuffer(is_ssl, socket);
}

fn flushWriteBuffer(this: *SOCKSProxy, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    if (this.write_offset >= this.write_buffer.items.len) {
        // All data has been written
        this.completeWrite();
        return;
    }

    const remaining = this.write_buffer.items[this.write_offset..];
    const bytes_written = socket.write(remaining);

    if (bytes_written > 0) {
        this.write_offset += @intCast(bytes_written);

        if (this.write_offset >= this.write_buffer.items.len) {
            // All data has been written
            this.completeWrite();
        } else {
            // Still have data to write, mark as pending
            this.markWritePending();
        }
    } else {
        // No bytes written, mark as pending and wait for socket to be writable
        this.markWritePending();
    }
}

fn markWritePending(this: *SOCKSProxy) void {
    switch (this.state) {
        .auth_handshake => this.state = .auth_handshake_pending,
        .connect_request => this.state = .connect_request_pending,
        else => {},
    }
}

fn completeWrite(this: *SOCKSProxy) void {
    switch (this.state) {
        .auth_handshake, .auth_handshake_pending => this.state = .auth_handshake,
        .connect_request, .connect_request_pending => this.state = .connect_request,
        else => {},
    }
}

pub fn sendConnectRequest(this: *SOCKSProxy, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !void {
    // SOCKS5 connect request
    // +----+-----+-------+------+----------+----------+
    // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
    // +----+-----+-------+------+----------+----------+
    // | 1  |  1  | X'00' |  1   | Variable |    2     |
    // +----+-----+-------+------+----------+----------+

    // Clear and reuse the write buffer
    this.write_buffer.clearRetainingCapacity();

    // Version, Command, Reserved
    try this.write_buffer.appendSlice(&[_]u8{ @intFromEnum(SOCKSVersion.v5), @intFromEnum(SOCKSCommand.connect), 0x00 });

    // Address type and address
    if (strings.isIPAddress(this.destination_host)) {
        if (strings.indexOf(this.destination_host, ":")) |_| {
            // IPv6
            try this.write_buffer.append(@intFromEnum(SOCKSAddressType.ipv6));
            const parsed = std.net.Ip6Address.parse(this.destination_host, 0) catch {
                return error.InvalidIPv6Address;
            };
            try this.write_buffer.appendSlice(std.mem.asBytes(&parsed.sa.addr));
        } else {
            // IPv4
            try this.write_buffer.append(@intFromEnum(SOCKSAddressType.ipv4));
            const parsed = std.net.Ip4Address.parse(this.destination_host, 0) catch {
                return error.InvalidIPv4Address;
            };
            try this.write_buffer.appendSlice(std.mem.asBytes(&parsed.sa.addr));
        }
    } else {
        // Domain name
        try this.write_buffer.append(@intFromEnum(SOCKSAddressType.domain_name));
        if (this.destination_host.len > 255) {
            return error.DomainNameTooLong;
        }
        try this.write_buffer.append(@intCast(this.destination_host.len));
        try this.write_buffer.appendSlice(this.destination_host);
    }

    // Port (big-endian)
    const port_bytes = std.mem.toBytes(std.mem.nativeToBig(u16, this.destination_port));
    try this.write_buffer.appendSlice(&port_bytes);

    // Reset write offset and start writing
    this.write_offset = 0;
    this.state = .connect_request;
    this.flushWriteBuffer(is_ssl, socket);
}

pub fn onWritable(this: *SOCKSProxy, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) void {
    // Socket is writable again, try to continue any pending writes
    switch (this.state) {
        .auth_handshake_pending, .connect_request_pending => {
            this.flushWriteBuffer(is_ssl, socket);
        },
        else => {},
    }
}

pub fn handleData(this: *SOCKSProxy, client: *HTTPClient, data: []const u8, comptime is_ssl: bool, socket: NewHTTPContext(is_ssl).HTTPSocket) !bool {
    _ = client;
    switch (this.state) {
        .auth_handshake_pending => {
            // Still writing auth handshake, ignore incoming data for now
            return true;
        },
        .auth_handshake => {
            if (data.len < 2) {
                return error.IncompleteSOCKSResponse;
            }

            const version = data[0];
            const method = data[1];

            if (version != @intFromEnum(SOCKSVersion.v5)) {
                return error.UnsupportedSOCKSVersion;
            }

            if (method == @intFromEnum(SOCKSAuthMethod.no_acceptable)) {
                return error.SOCKSAuthenticationFailed;
            }

            if (method == @intFromEnum(SOCKSAuthMethod.no_auth)) {
                this.state = .auth_complete;
                try this.sendConnectRequest(is_ssl, socket);
            } else {
                return error.UnsupportedSOCKSAuthMethod;
            }

            return true; // Data was consumed by SOCKS handshake
        },
        .connect_request_pending => {
            // Still writing connect request, ignore incoming data for now
            return true;
        },
        .connect_request => {
            if (data.len < 4) {
                return error.IncompleteSOCKSResponse;
            }

            const version = data[0];
            const reply = data[1];
            // data[2] is reserved
            const atyp = data[3];

            if (version != @intFromEnum(SOCKSVersion.v5)) {
                return error.UnsupportedSOCKSVersion;
            }

            if (reply != @intFromEnum(SOCKSReply.succeeded)) {
                return error.SOCKSConnectionFailed;
            }

            // Parse the bound address (we don't need it, but need to skip it)
            var offset: usize = 4;
            switch (atyp) {
                @intFromEnum(SOCKSAddressType.ipv4) => offset += 4,
                @intFromEnum(SOCKSAddressType.ipv6) => offset += 16,
                @intFromEnum(SOCKSAddressType.domain_name) => {
                    if (data.len <= offset) return error.IncompleteSOCKSResponse;
                    offset += 1 + data[offset]; // domain length + domain
                },
                else => return error.UnsupportedSOCKSAddressType,
            }
            offset += 2; // port

            if (data.len < offset) {
                return error.IncompleteSOCKSResponse;
            }

            this.state = .connected;
            log("SOCKS proxy connected successfully", .{});

            // SOCKS handshake complete, HTTP traffic can now flow through the tunnel
            // Don't change proxy_tunneling flag - let the normal flow handle it

            // If there's any remaining data after the SOCKS response, process it as HTTP
            if (data.len > offset) {
                return false; // Let HTTP client process remaining data
            }

            return true; // Data was consumed by SOCKS handshake
        },
        .connected => {
            // Pass through data to the HTTP client
            return false; // Let HTTP client handle this data
        },
        else => {
            return error.UnexpectedSOCKSState;
        },
    }
}

pub fn close(this: *SOCKSProxy) void {
    this.state = .failed;
}

pub fn shutdown(this: *SOCKSProxy) void {
    this.close();
}

pub fn detachAndDeref(this: *SOCKSProxy) void {
    this.deref();
}

fn deinit(this: *SOCKSProxy) void {
    // Free cloned destination_host memory
    this.allocator.free(this.destination_host);
    // Clean up write buffer
    this.write_buffer.deinit();
    bun.destroy(this);
}

const bun = @import("bun");
const std = @import("std");
const strings = bun.strings;
const NewHTTPContext = bun.http.NewHTTPContext;
const HTTPClient = bun.http;
const URL = bun.URL;
const log = bun.Output.scoped(.http_socks_proxy, false);
