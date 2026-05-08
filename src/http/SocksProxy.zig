const SocksProxy = @This();

pub const Kind = enum {
    none,
    http,
    https,
    socks5,
    socks5h,
    unsupported,

    pub fn fromURL(url: URL) Kind {
        if (url.protocol.len == 0 or strings.eqlComptime(url.protocol, "http")) return .http;
        if (strings.eqlComptime(url.protocol, "https")) return .https;
        if (strings.eqlComptime(url.protocol, "socks5")) return .socks5;
        if (strings.eqlComptime(url.protocol, "socks5h")) return .socks5h;
        return .unsupported;
    }

    pub fn fromInt(value: u8) Kind {
        return switch (value) {
            1 => .http,
            2 => .https,
            3 => .socks5,
            4 => .socks5h,
            else => .none,
        };
    }

    pub fn isSocks(this: Kind) bool {
        return this == .socks5 or this == .socks5h;
    }
};

pub const State = enum {
    idle,
    method_response,
    auth_response,
    connect_response,
    connected,
    failed,
};

pub const ReceiveResult = enum {
    pending,
    connected,
    needs_dns_resolve,
};

allocator: std.mem.Allocator,
kind: Kind,
state: State = .idle,
read_buffer: bun.io.StreamBuffer = .{},
write_buffer: bun.io.StreamBuffer = .{},
username: []u8 = "",
password: []u8 = "",

pub fn init(allocator: std.mem.Allocator, proxy: URL) !SocksProxy {
    var this = SocksProxy{
        .allocator = allocator,
        .kind = Kind.fromURL(proxy),
    };

    if (proxy.username.len > 0) {
        this.username = try PercentEncoding.decodeAlloc(allocator, proxy.username);
        errdefer allocator.free(this.username);
        if (this.username.len > 255) return error.SocksCredentialsTooLong;

        if (proxy.password.len > 0) {
            this.password = try PercentEncoding.decodeAlloc(allocator, proxy.password);
            errdefer allocator.free(this.password);
            if (this.password.len > 255) return error.SocksCredentialsTooLong;
        }
    }

    return this;
}

pub fn initWithCredentials(allocator: std.mem.Allocator, kind: Kind, username: []const u8, password: []const u8) !SocksProxy {
    var this = SocksProxy{
        .allocator = allocator,
        .kind = kind,
    };
    if (username.len > 0) {
        this.username = try allocator.dupe(u8, username);
        errdefer allocator.free(this.username);
        if (this.username.len > 255) return error.SocksCredentialsTooLong;
        if (password.len > 0) {
            this.password = try allocator.dupe(u8, password);
            errdefer allocator.free(this.password);
            if (this.password.len > 255) return error.SocksCredentialsTooLong;
        }
    }
    return this;
}

pub fn deinit(this: *SocksProxy) void {
    this.read_buffer.deinit();
    this.write_buffer.deinit();
    if (this.username.len > 0) {
        this.allocator.free(this.username);
        this.username = "";
    }
    if (this.password.len > 0) {
        this.allocator.free(this.password);
        this.password = "";
    }
}

pub fn defaultPort(kind: Kind) u16 {
    return switch (kind) {
        .https => 443,
        .socks5, .socks5h => 1080,
        else => 80,
    };
}

pub fn begin(this: *SocksProxy) !void {
    this.write_buffer.reset();
    if (this.username.len > 0) {
        try this.write_buffer.write(&.{ 0x05, 0x02, 0x00, 0x02 });
    } else {
        try this.write_buffer.write(&.{ 0x05, 0x01, 0x00 });
    }
    this.state = .method_response;
}

pub fn hasPendingWrite(this: *const SocksProxy) bool {
    return this.write_buffer.isNotEmpty();
}

pub fn flush(this: *SocksProxy, socket: anytype) !void {
    const data = this.write_buffer.slice();
    if (data.len == 0) return;
    const written = socket.write(data);
    if (written < 0) return error.WriteFailed;
    const amount: usize = @intCast(written);
    this.write_buffer.cursor += amount;
    if (this.write_buffer.isEmpty()) {
        this.write_buffer.reset();
    }
}

pub fn receive(this: *SocksProxy, data: []const u8, target_host: []const u8, target_port: u16) !ReceiveResult {
    if (data.len > 0) {
        try this.read_buffer.write(data);
    }

    while (true) {
        switch (this.state) {
            .method_response => {
                const buf = this.read_buffer.slice();
                if (buf.len < 2) return .pending;
                if (buf[0] != 0x05) return error.SocksInvalidResponse;
                const method = buf[1];
                this.consume(2);
                switch (method) {
                    0x00 => {
                        const connect_result = try this.writeConnect(target_host, target_port);
                        if (connect_result == .needs_dns_resolve) return .needs_dns_resolve;
                    },
                    0x02 => try this.writeAuth(),
                    0xff => return error.SocksNoAcceptableAuthMethod,
                    else => return error.SocksNoAcceptableAuthMethod,
                }
                return .pending;
            },
            .auth_response => {
                const buf = this.read_buffer.slice();
                if (buf.len < 2) return .pending;
                if (buf[0] != 0x01) return error.SocksInvalidResponse;
                const status = buf[1];
                this.consume(2);
                if (status != 0x00) return error.SocksAuthenticationFailed;
                const connect_result = try this.writeConnect(target_host, target_port);
                if (connect_result == .needs_dns_resolve) return .needs_dns_resolve;
                return .pending;
            },
            .connect_response => {
                const buf = this.read_buffer.slice();
                if (buf.len < 5) return .pending;
                if (buf[0] != 0x05 or buf[2] != 0x00) return error.SocksInvalidResponse;
                if (buf[1] != 0x00) return replyError(buf[1]);
                const address_len: usize = switch (buf[3]) {
                    0x01 => 4,
                    0x03 => buf[4],
                    0x04 => 16,
                    else => return error.SocksInvalidResponse,
                };
                const header_len: usize = if (buf[3] == 0x03) 5 else 4;
                const response_len = header_len + address_len + 2;
                if (buf.len < response_len) return .pending;
                this.consume(response_len);
                this.state = .connected;
                return .connected;
            },
            .connected => return .connected,
            .idle, .failed => return .pending,
        }
    }
}

fn consume(this: *SocksProxy, amount: usize) void {
    this.read_buffer.cursor += amount;
    if (this.read_buffer.isEmpty()) {
        this.read_buffer.reset();
    }
}

fn writeAuth(this: *SocksProxy) !void {
    if (this.username.len > 255 or this.password.len > 255) return error.SocksCredentialsTooLong;
    try this.write_buffer.ensureUnusedCapacity(3 + this.username.len + this.password.len);
    this.write_buffer.writeAssumeCapacity(&.{ 0x01, @intCast(this.username.len) });
    this.write_buffer.writeAssumeCapacity(this.username);
    this.write_buffer.writeAssumeCapacity(&.{@intCast(this.password.len)});
    this.write_buffer.writeAssumeCapacity(this.password);
    this.state = .auth_response;
}

const ConnectWriteResult = enum { written, needs_dns_resolve };

fn writeConnect(this: *SocksProxy, target_host: []const u8, target_port: u16) !ConnectWriteResult {
    // socks5h: always send domain name to proxy for remote DNS
    if (this.kind == .socks5h) {
        try this.write_buffer.write(&.{ 0x05, 0x01, 0x00 });
        if (target_host.len > 255) return error.SocksDomainTooLong;
        try this.write_buffer.write(&.{ 0x03, @intCast(target_host.len) });
        try this.write_buffer.write(target_host);
        try writePort(&this.write_buffer, target_port);
        this.state = .connect_response;
        return .written;
    }

    // socks5: try parse as IP literal first
    if (std.net.Address.parseIp(target_host, target_port)) |address| {
        try this.write_buffer.write(&.{ 0x05, 0x01, 0x00 });
        try this.writeAddress(address, target_port);
        this.state = .connect_response;
        return .written;
    } else |_| {}

    // socks5 + hostname: caller must resolve DNS asynchronously
    return .needs_dns_resolve;
}

/// Called by owner after async DNS resolves for socks5:// hostnames.
/// Writes SOCKS5 CONNECT request using the pre-resolved address.
pub fn writeConnectResolved(this: *SocksProxy, address: std.net.Address, target_port: u16) !void {
    try this.write_buffer.write(&.{ 0x05, 0x01, 0x00 });
    try this.writeAddress(address, target_port);
    this.state = .connect_response;
}

fn writeAddress(this: *SocksProxy, address: std.net.Address, target_port: u16) !void {
    switch (address.any.family) {
        std.posix.AF.INET => {
            try this.write_buffer.write(&.{0x01});
            const addr = address.in.sa.addr;
            try this.write_buffer.write(std.mem.asBytes(&addr));
        },
        std.posix.AF.INET6 => {
            try this.write_buffer.write(&.{0x04});
            try this.write_buffer.write(&address.in6.sa.addr);
        },
        else => return error.SocksAddressTypeNotSupported,
    }
    try writePort(&this.write_buffer, target_port);
}

fn writePort(buffer: *bun.io.StreamBuffer, port: u16) !void {
    try buffer.write(&.{ @intCast((port >> 8) & 0xff), @intCast(port & 0xff) });
}

fn replyError(code: u8) anyerror {
    return switch (code) {
        0x01 => error.SocksGeneralFailure,
        0x02 => error.SocksConnectionNotAllowed,
        0x03 => error.SocksNetworkUnreachable,
        0x04 => error.SocksHostUnreachable,
        0x05 => error.SocksConnectionRefused,
        0x06 => error.SocksTTLExpired,
        0x07 => error.SocksCommandNotSupported,
        0x08 => error.SocksAddressTypeNotSupported,
        else => error.SocksInvalidResponse,
    };
}

const std = @import("std");
const URL = @import("../url/url.zig").URL;
const PercentEncoding = @import("../url/url.zig").PercentEncoding;
const bun = @import("bun");
const strings = bun.strings;
