//! An IP socket address meant to be used by both native and JS code.
//!
//! JS getters are named `getFoo`, while native getters are named `foo`.
const SocketAddress = @This();

// NOTE: not std.net.Address b/c .un is huge and we don't use it.
// NOTE: not C.sockaddr_storage b/c it's _huge_. we need >= 28 bytes for sockaddr_in6,
// but sockaddr_storage is 128 bytes.
/// @internal
_addr: sockaddr,
/// Cached address in presentation format. Prevents repeated conversion between
/// strings and bytes.
///
/// @internal
_presentation: ?bun.String = null,

pub const Options = struct {
    family: AF = AF.INET,
    /// When `null`, default is determined by address family.
    /// - `127.0.0.1` for IPv4
    /// - `::1` for IPv6
    address: ?bun.String = null,
    port: u16 = 0,
    /// IPv6 flow label. JS getters for v4 addresses always return `0`.
    flowlabel: ?u32 = null,

    /// NOTE: assumes options object has been normalized and validated by JS code.
    pub fn fromJS(global: *JSC.JSGlobalObject, obj: JSValue) bun.JSError!Options {
        bun.assert(obj.isObject());

        const address_str: ?bun.String = if (try obj.get(global, "address")) |a|
            try bun.String.fromJS2(a, global)
        else
            null;

        const _family: AF = if (try obj.get(global, "family")) |fam| blk: {
            if (fam.isString()) {
                const slice = fam.asString().toSlice(global, bun.default_allocator);
                if (bun.strings.eqlComptime(slice.slice(), "ipv4")) {
                    break :blk AF.INET;
                } else if (bun.strings.eqlComptime(slice.slice(), "ipv6")) {
                    break :blk AF.INET6;
                } else {
                    return global.throwInvalidArgumentPropertyValue("options.family", "'ipv4' or 'ipv6'", fam);
                }
            } else if (fam.isUInt32AsAnyInt()) {
                break :blk switch (fam.toU32()) {
                    AF.INET.int() => AF.INET,
                    AF.INET6.int() => AF.INET6,
                    else => return global.throwInvalidArgumentPropertyValue("options.family", "AF_INET or AF_INET6", fam),
                };
            } else {
                return global.throwInvalidArgumentTypeValue("options.family", "a string or number", fam);
            }
        } else AF.INET;

        // required. Validated by `validatePort`.
        const _port: u16 = if (try obj.get(global, "port")) |p| blk: {
            if (!p.isUInt32AsAnyInt()) return global.throwInvalidArgumentTypeValue("options.port", "number", p);
            break :blk @truncate(p.toU32());
        } else 0;

        const _flowlabel = if (try obj.get(global, "flowlabel")) |fl| blk: {
            if (!fl.isUInt32AsAnyInt()) return global.throwInvalidArgumentTypeValue("options.flowlabel", "number", fl);
            break :blk fl.toU32();
        } else null;

        return .{
            .family = _family,
            .address = address_str,
            .port = _port,
            .flowlabel = _flowlabel,
        };
    }
};

pub usingnamespace JSC.Codegen.JSSocketAddress;
pub usingnamespace bun.New(SocketAddress);

// =============================================================================
// =============================== CONSTRUCTORS ================================
// =============================================================================

/// `new SocketAddress([options])`
///
/// ## Safety
/// Constructor assumes that options object has already been sanitized and validated
/// by JS wrapper.
///
/// ## References
/// - [Node docs](https://nodejs.org/api/net.html#new-netsocketaddressoptions)
pub fn constructor(global: *JSC.JSGlobalObject, frame: *JSC.CallFrame) bun.JSError!*SocketAddress {
    const options_obj = frame.argument(0);
    if (options_obj.isUndefined()) return SocketAddress.new(.{
        ._addr = sockaddr.@"127.0.0.1",
        ._presentation = WellKnownAddress.@"127.0.0.1",
    });
    options_obj.ensureStillAlive();

    if (!options_obj.isObject()) return global.throwInvalidArgumentTypeValue("options", "object", options_obj);
    const options = try Options.fromJS(global, options_obj);

    // fast path for { family: 'ipv6' }
    if (options.family == AF.INET6 and options.address == null and options.flowlabel == null and options.port == 0) {
        return SocketAddress.new(.{
            ._addr = sockaddr.@"::",
            ._presentation = WellKnownAddress.@"::",
        });
    }

    return SocketAddress.create(global, options);
}

/// Semi-structured JS api for creating a `SocketAddress`. If you have raw
/// socket address data, prefer `SocketAddress.new`.
/// 
/// ## Safety
/// - If provided, `options.address` must be ref-ed before being passed in. That
///   is, the ref gets moved.
pub fn create(global: *JSC.JSGlobalObject, options: Options) bun.JSError!*SocketAddress {
    const presentation: bun.String = options.address orelse switch (options.family) {
        AF.INET => WellKnownAddress.@"127.0.0.1",
        AF.INET6 => WellKnownAddress.@"::",
    };
    // We need a zero-terminated cstring for `ares_inet_pton`, which forces us to
    // copy the string.
    var stackfb = std.heap.stackFallback(64, bun.default_allocator);
    const alloc = stackfb.get();

    // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
    // Switch back to `htons(options.port)` when this issue gets resolved:
    // https://github.com/ziglang/zig/issues/22804
    const addr: sockaddr = switch (options.family) {
        AF.INET => v4: {
            var sin: sockaddr_in = .{
                .family = options.family.int(),
                .port = std.mem.nativeToBig(u16, options.port),
                .addr = undefined,
            };
            if (options.address) |address_str| {
                const slice = address_str.toOwnedSliceZ(alloc) catch bun.outOfMemory();
                defer alloc.free(slice);
                try pton(global, C.AF_INET, slice, &sin.addr);
            } else {
                sin.addr = sockaddr.@"127.0.0.1".sin.addr;
            }
            break :v4 .{ .sin = sin };
        },
        AF.INET6 => v6: {
            var sin6: sockaddr_in6 = .{
                .family = options.family.int(),
                .port = std.mem.nativeToBig(u16, options.port),
                .flowinfo = options.flowlabel orelse 0,
                .addr = undefined,
                .scope_id = 0,
            };
            if (options.address) |address_str| {
                const slice = address_str.toOwnedSliceZ(alloc) catch bun.outOfMemory();
                defer alloc.free(slice);
                try pton(global, C.AF_INET6, slice, &sin6.addr);
            } else {
                sin6.addr = @bitCast(C.in6addr_any);
            }
            break :v6 .{ .sin6 = sin6 };
        },
    };

    return SocketAddress.new(.{
        ._addr = addr,
        ._presentation = presentation,
    });
}

pub fn parse(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalObject;
    _ = callframe;
    return JSC.JSValue.jsUndefined(); // TODO;
}

/// Create an IPv4 socket address. `addr` is assumed to be valid. Port is in host byte order.
pub fn newIPv4(addr: [4]u8, port_: u16) SocketAddress {
    // TODO: make sure casting doesn't swap byte order on us.
    return .{ ._addr = sockaddr.v4(std.mem.nativeToBig(u16, port_), @bitCast(addr)) };
}

/// Create an IPv6 socket address. `addr` is assumed to be valid. Port is in
/// host byte order.
///
/// Use `0` for `flowinfo` and `scope_id` if you don't know or care about their
/// values.
pub fn newIPv6(addr: [16]u8, port_: u16, flowinfo: u32, scope_id: u32) SocketAddress {
    const addr_: C.struct_in6_addr = @bitCast(addr);
    return .{ ._addr = sockaddr.v6(
        std.mem.nativeToBig(u16, port_),
        addr_,
        flowinfo,
        scope_id,
    ) };
}

// =============================================================================
// ================================ DESTRUCTORS ================================
// =============================================================================

pub fn deinit(this: *SocketAddress) void {
    if (this._presentation) |p| p.deref();
}

pub fn finalize(this: *SocketAddress) void {
    this.deinit();
}

// =============================================================================

pub fn getAddress(this: *SocketAddress, global: *JSC.JSGlobalObject) JSC.JSValue {
    // TODO: check that this doesn't ref() again.
    return this.address().toJS(global);
}

/// Get the address in presentation format. Does not include the port.
///
/// You must `.unref()` the returned string when you're done with it.
///
/// ### TODO
/// - replace `addressToString` in `dns.zig` w this
/// - use this impl in server.zig
pub fn address(this: *SocketAddress) bun.String {
    if (this._presentation) |p| {
        p.ref();
        return p;
    }
    var buf: [INET6_ADDRSTRLEN]u8 = undefined;
    const addr_src: *const anyopaque = if (this.family() == AF.INET)
        @ptrCast(&this.asV4().addr)
    else
        @ptrCast(&this.asV6().addr);

    const formatted = std.mem.span(ares.ares_inet_ntop(this.family().int(), addr_src, &buf, buf.len) orelse {
        std.debug.panic("Invariant violation: SocketAddress created with invalid IPv6 address ({any})", .{this._addr});
    });
    if (comptime bun.Environment.isDebug) {
        bun.assertWithLocation(bun.strings.isAllASCII(formatted), @src());
    }
    var presentation = bun.JSC.WebCore.Encoder.toBunStringComptime(formatted, .latin1);
    presentation.ref();
    this._presentation = presentation;
    return presentation;
}

/// `sockaddr.family`
///
/// Returns a string representation of this address' family. Use `getAddrFamily`
/// for the numeric value.
///
/// NOTE: node's `net.SocketAddress` wants `"ipv4"` and `"ipv6"` while Bun's APIs
/// use `"IPv4"` and `"IPv6"`. This is annoying.
pub fn getFamily(this: *SocketAddress, global: *JSC.JSGlobalObject) JSValue {
    return switch (this.family()) {
        AF.INET => IPv4.toJS(global),
        AF.INET6 => IPv6.toJS(global),
    };
}

/// `sockaddr.addrfamily`
pub fn getAddrFamily(this: *SocketAddress, _: *JSC.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.family().int());
}

/// NOTE: zig std uses posix values only, while this returns whatever the
/// system uses. Do not compare to `std.posix.AF`.
pub fn family(this: *const SocketAddress) AF {
    // NOTE: sockaddr_in and sockaddr_in6 have the same layout for family.
    return @enumFromInt(this._addr.sin.family);
}

pub fn getPort(this: *SocketAddress, _: *JSC.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.port());
}

/// Get the port number in host byte order.
pub fn port(this: *const SocketAddress) u16 {
    // NOTE: sockaddr_in and sockaddr_in6 have the same layout for port.
    // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
    // Switch back to `ntohs` when this issue gets resolved: https://github.com/ziglang/zig/issues/22804
    return std.mem.bigToNative(u16, this._addr.sin.port);
}

pub fn getFlowLabel(this: *SocketAddress, _: *JSC.JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.flowLabel() orelse 0);
}

/// Returns `null` for non-IPv6 addresses.
///
/// ## References
/// - [RFC 6437](https://tools.ietf.org/html/rfc6437)
pub fn flowLabel(this: *const SocketAddress) ?u32 {
    if (this.family() == AF.INET6) {
        const in6: sockaddr_in6 = @bitCast(this._addr);
        return in6.flowinfo;
    } else {
        return null;
    }
}

pub fn socklen(this: *const SocketAddress) socklen_t {
    switch (this._addr.family) {
        AF.INET => return @sizeOf(sockaddr_in),
        AF.INET6 => return @sizeOf(sockaddr_in6),
    }
}

fn pton(global: *JSC.JSGlobalObject, comptime af: c_int, addr: [:0]const u8, dst: *anyopaque) bun.JSError!void {
    switch (ares.ares_inet_pton(af, addr.ptr, dst)) {
        0 => {
            return global.throwSysError(.{ .code = .ERR_INVALID_IP_ADDRESS }, "Invalid socket address", .{});
        },
        -1 => {
            // TODO: figure out proper wayto convert a c errno into a js exception
            return global.throwSysError(
                .{ .code = .ERR_INVALID_IP_ADDRESS, .errno = std.c._errno().* },
                "Invalid socket address",
                .{},
            );
        },
        1 => return,
        else => unreachable,
    }
}

inline fn asV4(this: *const SocketAddress) *const sockaddr_in {
    bun.debugAssert(this.family() == AF.INET);
    return &this._addr.sin;
}

inline fn asV6(this: *const SocketAddress) *const sockaddr_in6 {
    bun.debugAssert(this.family() == AF.INET6);
    return &this._addr.sin6;
}

// =============================================================================

const IPv6 = bun.String.static("IPv6");
const IPv4 = bun.String.static("IPv4");

// FIXME: c-headers-for-zig casts AF_* and PF_* to `c_int` when it should be `comptime_int`
pub const AF = enum(C.sa_family_t) {
    INET = @intCast(C.AF_INET),
    INET6 = @intCast(C.AF_INET6),
    pub inline fn int(this: AF) C.sa_family_t {
        return @intFromEnum(this);
    }
};

/// ## Notes
/// - Linux broke compat between `sockaddr_in` and `sockaddr_in6` in v2.4.
///   They're no longer the same size.
/// - This replaces `sockaddr_storage` because it's huge. This is 28 bytes,
///   while `sockaddr_storage` is 128 bytes.
const sockaddr = extern union {
    // sin: C.sockaddr_in,
    // sin6: C.sockaddr_in6,
    sin: sockaddr_in,
    sin6: sockaddr_in6,

    pub fn v4(port_: C.in_port_t, addr: u32) sockaddr {
        return .{ .sin = .{
            .family = AF.INET.int(),
            .port = port_,
            .addr = addr,
        } };
    }

    pub fn v6(
        port_: C.in_port_t,
        addr: C.struct_in6_addr,
        /// set to 0 if you don't care
        flowinfo: u32,
        /// set to 0 if you don't care
        scope_id: u32,
    ) sockaddr {
        return .{ .sin6 = .{
            .family = AF.INET6.int(),
            .port = port_,
            .flowinfo = flowinfo,
            .scope_id = scope_id,
            .addr = @bitCast(addr),
        } };
    }

    // I'd be money endianess is going to screw us here.
    pub const @"127.0.0.1": sockaddr = sockaddr.v4(0, @bitCast([_]u8{ 127, 0, 0, 1 }));
    pub const @"::1": sockaddr = sockaddr.v6(0, C.in6addr_loopback);
    // TODO: check that `::` is all zeroes on all platforms. Should correspond
    // to `IN6ADDR_ANY_INIT`.
    pub const @"::": sockaddr = sockaddr.v6(0, std.mem.zeroes(C.struct_in6_addr), 0, 0);
};

const WellKnownAddress = struct {
    const @"127.0.0.1": bun.String = bun.String.static("127.0.0.1");
    const @"::": bun.String = bun.String.static("::");
    const @"::1": bun.String = bun.String.static("::1");
};

// =============================================================================

// The same types are defined in a bunch of different places. We should probably unify them.
comptime {
    // Windows doesn't have c.socklen_t. because of course it doesn't.
    const other_socklens = if (@hasDecl(C, "socklen_t"))
        .{ std.posix.socklen_t, C.socklen_t }
    else
        .{std.posix.socklen_t};
    for (other_socklens) |other_socklen| {
        if (@sizeOf(socklen_t) != @sizeOf(other_socklen)) @compileError("socklen_t size mismatch");
        if (@alignOf(socklen_t) != @alignOf(other_socklen)) @compileError("socklen_t alignment mismatch");
    }
}

const std = @import("std");
const bun = @import("root").bun;
const ares = bun.c_ares;
const C = bun.C.translated;
const Environment = bun.Environment;
const string = bun.string;
const Output = bun.Output;

const JSC = bun.JSC;
const ZigString = JSC.ZigString;
const CallFrame = JSC.CallFrame;
const JSValue = JSC.JSValue;

const sockaddr_in = std.posix.sockaddr.in;
const sockaddr_in6 = std.posix.sockaddr.in6;
const socklen_t = ares.socklen_t;
const INET6_ADDRSTRLEN = if (bun.Environment.isWindows)
    std.os.windows.ws2_32.INET6_ADDRSTRLEN
else
    C.INET6_ADDRSTRLEN;
