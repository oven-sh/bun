const std = @import("std");
const bun = @import("root").bun;
const ares = bun.c_ares;
const C = bun.C.translated;
const JSC = bun.JSC;

const socklen = ares.socklen_t;
/// see: https://man7.org/linux/man-pages/man0/netinet_in.h.0p.html
const AddressFamily = enum(c_int) {
    /// AF_INET
    ipv4 = C.AF_INET,
    /// AF_INET6
    ipv6 = C.AF_INET6,

    pub inline fn addrlen(self: AddressFamily) ares.socklen_t {
        return switch (self) {
            .ipv4 => @intCast(C.INET_ADDRSTRLEN),
            .ipv6 => @intCast(C.INET6_ADDRSTRLEN),
        };
    }
    // pub inline fn getSocklen(self: AddressFamily) ares.socklen_t {
    //     return switch (self) {
    //         .ipv4 => @sizeOf(std.posix.sockaddr.in),
    //         .ipv6 => @sizeOf(std.posix.sockaddr.in6),
    //     };
    // }
};

pub const SocketAddressNew = struct {
    addr: std.net.Address,

    pub fn parse(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = globalObject;
        _ = callframe;
        return JSC.JSValue.jsUndefined(); // TODO;
    }
    pub fn isSocketAddress(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = globalObject;
        _ = callframe;
        return JSC.JSValue.jsUndefined(); // TODO;
    }

    /// TODO: replace `addressToString` in `dns.zig` w this
    pub fn getAddress(this: *SocketAddressNew) bun.OOM!bun.String {
        switch (this.addr) {
            .in => |ipv4| {
                const bytes = @as(*const [4]u8, @ptrCast(&ipv4.sa.addr));
                return bun.String.createFormat("{}.{}.{}.{}", .{
                    bytes[0],
                    bytes[1],
                    bytes[2],
                    bytes[3],
                });
            },
            .in6 => |ipv6| {
                // TODO: add 1 for sentinel?
                var sockaddr: [AddressFamily.ipv6.addrlen()]u8 = undefined;
                // SAFETY: SocketAddress should only ever be created via
                // initializer or via parse(), both of which fail on invalid
                // addresses.
                const formatted = ares.ares_inet_ntop(AddressFamily.ipv6, &ipv6.sa.addr, &sockaddr, AddressFamily.ipv6.addrlen()) orelse {
                    std.debug.panic("Invariant violation: SocketAddress created with invalid IPv6 address ({any})", .{this.addr});
                };
                if (comptime bun.Environment.isDebug) {
                    bun.assertWithLocation(bun.strings.isAllASCII(formatted), @src());
                }
                // TODO: is passing a stack reference to BunString.createLatin1 safe?
                return bun.JSC.WebCore.Encoder.toBunStringComptime(formatted, .latin1);
            },
            else => unreachable,
        }
    }

    pub fn getFamily(this: *const SocketAddressNew) AddressFamily {
        const AF = std.os.linux.AF;
        return switch (this.addr) {
            .in => AddressFamily.ipv4,
            .in6 => AddressFamily.ipv6,
            // NOTE: We prolly shouldn't support .any
            .any => |sa| switch (sa.family) {
                AF.INET => AddressFamily.ipv4,
                AF.INET6 => AddressFamily.ipv6,
                else => @panic("SocketAddress family is not AF_INET or AF_INET6."),
            },
            .un => @panic("SocketAddress is a unix socket."),
        };
    }

    /// Get the port number in native byte order.
    pub fn getPort(this: *const SocketAddressNew) u16 {
        return this.addr.getPort();
    }

    /// See: [RFC 6437](https://tools.ietf.org/html/rfc6437)
    pub fn getFlowLabel(this: *const SocketAddressNew) ?u32 {
        return switch (this.addr) {
            .in6 => |ipv6| ipv6.sa.flowinfo,
            else => null,
        };
    }

    pub fn socklen(this: *const SocketAddressNew) C.socklen_t {
        return this.addr.getOsSockLen();
    }
};

const CommonAddresses = struct {
    @"127.0.0.1": bun.String = bun.String.createAtomASCII("127.0.0.1"),
    @"::1": bun.String = bun.String.createAtomASCII("::1"),
};
const common_addresses: CommonAddresses = .{};

// The same types are defined in a bunch of different places. We should probably unify them.
comptime {
    // const AF = std.os.linux.AF;
    // if (@intFromEnum(AddressFamily.ipv4) != AF.INET) @compileError(std.fmt.comptimePrint("AddressFamily.ipv4 ({d}) != AF.INET ({d})", .{ @intFromEnum(AddressFamily.ipv4), AF.INET }));
    // if (@intFromEnum(AddressFamily.ipv6) != AF.INET6) @compileError(std.fmt.comptimePrint("AddressFamily.ipv6 ({d}) != AF.INET6 ({d})", .{ @intFromEnum(AddressFamily.ipv6), AF.INET6 }));

    for (.{ std.posix.socklen_t, C.socklen_t }) |other_socklen| {
        if (@sizeOf(socklen) != @sizeOf(other_socklen)) @compileError("socklen_t size mismatch");
        if (@alignOf(socklen) != @alignOf(other_socklen)) @compileError("socklen_t alignment mismatch");
    }
}
