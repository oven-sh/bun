//! An IP socket address meant to be used by both native and JS code.
//!
//! JS getters are named `getFoo`, while native getters are named `foo`.
//!
//! TODO: add a inspect method (under `Symbol.for("nodejs.util.inspect.custom")`).
//! Requires updating bindgen.
const SocketAddress = @This();

// NOTE: not std.net.Address b/c .un is huge and we don't use it.
// NOTE: not C.sockaddr_storage b/c it's _huge_. we need >= 28 bytes for sockaddr_in6,
// but sockaddr_storage is 128 bytes.
/// @internal
_addr: sockaddr,
/// Cached address in presentation format. Prevents repeated conversion between
/// strings and bytes.
///
/// - `.Dead` is used as an alternative to `null`
/// - `.Empty` is used for default ipv4 and ipv6 addresses (`127.0.0.1` and `::`, respectively).
///
/// @internal
_presentation: bun.String = .dead,

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
        if (!obj.isObject()) return global.throwInvalidArgumentTypeValue("options", "object", obj);

        const address_str: ?bun.String = if (try obj.get(global, "address")) |a| addr: {
            if (!a.isString()) return global.throwInvalidArgumentTypeValue("options.address", "string", a);
            break :addr try bun.String.fromJS2(a, global);
        } else null;

        const _family: AF = if (try obj.get(global, "family")) |fam| blk: {
            // "ipv4" or "ipv6", ignoring case
            if (fam.isString()) {
                const fam_str = try bun.String.fromJS2(fam, global);
                defer fam_str.deref();
                if (fam_str.length() != 4)
                    return throwBadFamilyIP(global, fam);

                if (fam_str.is8Bit()) {
                    const slice = fam_str.latin1();
                    if (std.ascii.eqlIgnoreCase(slice[0..4], "ipv4")) {
                        break :blk AF.INET;
                    } else if (std.ascii.eqlIgnoreCase(slice[0..4], "ipv6")) {
                        break :blk AF.INET6;
                    } else return throwBadFamilyIP(global, fam);
                } else {
                    // not full ignore-case since that would require converting
                    // utf16 -> latin1 and the allocation isn't worth it.
                    if (fam_str.eqlComptime("ipv4") or fam_str.eqlComptime("IPv4")) {
                        break :blk AF.INET;
                    } else if (fam_str.eqlComptime("ipv6") or fam_str.eqlComptime("IPv6")) {
                        break :blk AF.INET6;
                    } else {
                        return throwBadFamilyIP(global, fam);
                    }
                }
            } else if (fam.isUInt32AsAnyInt()) {
                break :blk switch (fam.toU32()) {
                    AF.INET.int() => AF.INET,
                    AF.INET6.int() => AF.INET6,
                    else => return global.throwInvalidArgumentPropertyValue("options.family", "AF_INET or AF_INET6", fam),
                };
            } else {
                return global.throwInvalidArgumentPropertyValue("options.family", "a string or number", fam);
            }
        } else AF.INET;

        // required. Validated by `validatePort`.
        const _port: u16 = if (try obj.get(global, "port")) |p| blk: {
            if (!p.isFinite()) return throwBadPort(global, p);
            const port32 = p.toInt32();
            if (port32 < 0 or port32 > std.math.maxInt(u16)) {
                return throwBadPort(global, p);
            }
            break :blk @intCast(port32);
        } else 0;

        const _flowlabel = if (try obj.get(global, "flowlabel")) |fl| blk: {
            if (!fl.isNumber()) return global.throwInvalidArgumentTypeValue("options.flowlabel", "number", fl);
            if (!fl.isUInt32AsAnyInt()) return global.throwRangeError(fl.asNumber(), .{
                .field_name = "options.flowlabel",
                .min = 0,
                .max = std.math.maxInt(u32),
            });
            break :blk fl.toU32();
        } else null;

        return .{
            .family = _family,
            .address = address_str,
            .port = _port,
            .flowlabel = _flowlabel,
        };
    }

    inline fn throwBadFamilyIP(global: *JSC.JSGlobalObject, family_: JSC.JSValue) bun.JSError {
        return global.throwInvalidArgumentPropertyValue("options.family", "'ipv4' or 'ipv6'", family_);
    }
    inline fn throwBadPort(global: *JSC.JSGlobalObject, port_: JSC.JSValue) bun.JSError {
        const ty = global.determineSpecificType(port_) catch {
            return global.ERR_SOCKET_BAD_PORT("The \"options.port\" argument must be a valid IP port number.", .{}).throw();
        };
        return global.ERR_SOCKET_BAD_PORT("The \"options.port\" argument must be a valid IP port number. Got {s}.", .{ty}).throw();
    }
};

pub usingnamespace JSC.Codegen.JSSocketAddress;
pub usingnamespace bun.New(SocketAddress);

// =============================================================================
// ============================== STATIC METHODS ===============================
// =============================================================================

/// ### `SocketAddress.parse(input: string): SocketAddress | undefined`
/// Parse an address string (with an optional `:port`) into a `SocketAddress`.
/// Returns `undefined` if the input is invalid.
pub fn parse(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const input = blk: {
        const input_arg = callframe.argument(0);
        if (!input_arg.isString()) return global.throwInvalidArgumentTypeValue("input", "string", input_arg);
        break :blk try bun.String.fromJS2(input_arg, global);
    };
    var stackfb = std.heap.stackFallback(256, bun.default_allocator);
    const alloc = stackfb.get();

    const url_str = bun.String.createFromConcat(
        alloc,
        &[_]bun.String{ bun.String.static("http://"), input },
    ) catch return global.throwOutOfMemory();
    defer url_str.deref();

    const url = JSC.URL.fromString(url_str) orelse return JSValue.jsUndefined();
    defer url.deinit();
    const host = url.host();
    const port_: u16 = blk: {
        const port32 = url.port();
        break :blk if (port32 > std.math.maxInt(u16)) 0 else @intCast(port32);
    };
    bun.assert(host.tag != .Dead);
    bun.debugAssert(host.length() >= 2);

    // NOTE: parsed host cannot be used as presentation string. e.g.
    // - "[::1]" -> "::1"
    // - "0x.0x.0" -> "0.0.0.0"
    const paddr = host.latin1(); // presentation address
    const addr = if (paddr[0] == '[' and paddr[paddr.len - 1] == ']') v6: {
        const v6 = net.Ip6Address.parse(paddr[1 .. paddr.len - 1], port_) catch return JSValue.jsUndefined();
        break :v6 SocketAddress{ ._addr = .{ .sin6 = v6.sa } };
    } else v4: {
        const v4 = net.Ip4Address.parse(paddr, port_) catch return JSValue.jsUndefined();
        break :v4 SocketAddress{ ._addr = .{ .sin = v4.sa } };
    };

    return SocketAddress.new(addr).toJS(global);
}

/// ### `SocketAddress.isSocketAddress(value: unknown): value is SocketAddress`
/// Returns `true` if `value` is a `SocketAddress`. Subclasses and similarly-shaped
/// objects are not considered `SocketAddress`s.
pub fn isSocketAddress(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const value = callframe.argument(0);
    return JSValue.jsBoolean(value.isCell() and SocketAddress.fromJSDirect(value) != null);
}

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
        ._presentation = .empty,
        // ._presentation = WellKnownAddress.@"127.0.0.1"(),
        // ._presentation = bun.String.fromJS2(global.commonStrings().@"127.0.0.1"()) catch unreachable,
    });
    options_obj.ensureStillAlive();

    const options = try Options.fromJS(global, options_obj);

    // fast path for { family: 'ipv6' }
    if (options.family == AF.INET6 and options.address == null and options.flowlabel == null and options.port == 0) {
        return SocketAddress.new(.{
            ._addr = sockaddr.@"::",
            ._presentation = .empty,
            // ._presentation = WellKnownAddress.@"::"(),
        });
    }

    return SocketAddress.create(global, options);
}

/// Semi-structured JS api for creating a `SocketAddress`. If you have raw
/// socket address data, prefer `SocketAddress.new`.
///
/// ## Safety
/// - `options.address` gets moved, much like `adoptRef`. Do not `deref` it
///   after passing it in.
pub fn create(global: *JSC.JSGlobalObject, options: Options) bun.JSError!*SocketAddress {
    var presentation: bun.String = .empty;

    // We need a zero-terminated cstring for `ares_inet_pton`, which forces us to
    // copy the string.
    var stackfb = std.heap.stackFallback(64, bun.default_allocator);
    const alloc = stackfb.get();

    // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
    // Switch back to `htons(options.port)` when this issue gets resolved:
    // https://github.com/ziglang/zig/issues/22804
    const addr: sockaddr = switch (options.family) {
        AF.INET => v4: {
            var sin: inet.sockaddr_in = .{
                .family = options.family.int(),
                .port = std.mem.nativeToBig(u16, options.port),
                .addr = undefined,
            };
            if (options.address) |address_str| {
                presentation = address_str;
                const slice = address_str.toOwnedSliceZ(alloc) catch bun.outOfMemory();
                defer alloc.free(slice);
                try pton(global, inet.AF_INET, slice, &sin.addr);
            } else {
                sin.addr = sockaddr.@"127.0.0.1".sin.addr;
            }
            break :v4 .{ .sin = sin };
        },
        AF.INET6 => v6: {
            var sin6: inet.sockaddr_in6 = .{
                .family = options.family.int(),
                .port = std.mem.nativeToBig(u16, options.port),
                .flowinfo = options.flowlabel orelse 0,
                .addr = undefined,
                .scope_id = 0,
            };
            if (options.address) |address_str| {
                presentation = address_str;
                const slice = address_str.toOwnedSliceZ(alloc) catch bun.outOfMemory();
                defer alloc.free(slice);
                try pton(global, inet.AF_INET6, slice, &sin6.addr);
            } else {
                sin6.addr = inet.IN6ADDR_ANY_INIT;
            }
            break :v6 .{ .sin6 = sin6 };
        },
    };

    return SocketAddress.new(.{
        ._addr = addr,
        ._presentation = presentation,
    });
}

pub const AddressError = error{
    /// Too long or short to be an IPv4 or IPv6 address.
    InvalidLength,
};

/// Create a new IP socket address. `addr` is assumed to be a valid ipv4 or ipv6
/// address. Port is in host byte order.
///
/// ## Errors
/// - If `addr` is not 4 or 16 bytes long.
pub fn init(addr: []const u8, port_: u16) AddressError!SocketAddress {
    return switch (addr.len) {
        4 => initIPv4(addr[0..4].*, port_),
        16 => initIPv6(addr[0..16].*, port_, 0, 0),
        else => AddressError.InvalidLength,
    };
}

/// Create an IPv4 socket address. `addr` is assumed to be valid. Port is in host byte order.
pub fn initIPv4(addr: [4]u8, port_: u16) SocketAddress {
    // TODO: make sure casting doesn't swap byte order on us.
    return .{ ._addr = sockaddr.v4(std.mem.nativeToBig(u16, port_), @bitCast(addr)) };
}

/// Create an IPv6 socket address. `addr` is assumed to be valid. Port is in
/// host byte order.
///
/// Use `0` for `flowinfo` and `scope_id` if you don't know or care about their
/// values.
pub fn initIPv6(addr: [16]u8, port_: u16, flowinfo: u32, scope_id: u32) SocketAddress {
    return .{ ._addr = sockaddr.v6(
        std.mem.nativeToBig(u16, port_),
        addr,
        flowinfo,
        scope_id,
    ) };
}

// =============================================================================
// ================================ DESTRUCTORS ================================
// =============================================================================

pub fn deinit(this: *SocketAddress) void {
    // .deref() on dead strings is a no-op.
    this._presentation.deref();
}

pub fn finalize(this: *SocketAddress) void {
    JSC.markBinding(@src());
    this.deinit();
    this.destroy();
}

// =============================================================================

/// Turn this address into a DTO. `this` is consumed and undefined after this call.
///
/// This is similar to `.toJS`, but differs in the following ways:
/// - `this` is consumed
/// - result object is not an instance of `SocketAddress`, so
///   `SocketAddress.isSocketAddress(dto) === false`
/// - address, port, etc. are put directly onto the object instead of being
///   accessed via getters on the prototype.
///
/// This method is slightly faster if you are creating a lot of socket addresses
/// that will not be around for very long. `createDTO` is even faster, but
/// requires callers to already have a presentation-formatted address.
pub fn intoDTO(this: *SocketAddress, global: *JSC.JSGlobalObject) JSC.JSValue {
    var addr_str = this.address();
    defer this._presentation = .dead;
    defer this.* = undefined; // removed in release builds, so setting _presentation to dead is still needed.
    return JSSocketAddressDTO__create(global, addr_str.transferToJS(global), this.port(), this.family() == AF.INET6);
}

/// Directly create a socket address DTO. This is a POJO with address, port, and family properties.
/// Used for hot paths that provide existing, pre-formatted/validated address
/// data to JS.
///
/// - The address string is assumed to be ASCII and a valid IP address (either v4 or v6).
/// - Port is a valid `in_port_t` (between 0 and 2^16) in host byte order.
pub fn createDTO(globalObject: *JSC.JSGlobalObject, addr_: []const u8, port_: i32, is_ipv6: bool) JSC.JSValue {
    if (comptime bun.Environment.isDebug) {
        bun.assertWithLocation(port_ >= 0 and port_ <= std.math.maxInt(i32), @src());
        bun.assertWithLocation(addr_.len > 0, @src());
    }

    return JSSocketAddressDTO__create(
        globalObject,
        bun.String.createUTF8ForJS(globalObject, addr_),
        port_,
        is_ipv6,
    );
}

extern "c" fn JSSocketAddressDTO__create(globalObject: *JSC.JSGlobalObject, address_: JSC.JSValue, port_: c_int, is_ipv6: bool) JSC.JSValue;

// =============================================================================

pub fn getAddress(this: *SocketAddress, global: *JSC.JSGlobalObject) JSC.JSValue {
    // toJS increments ref count
    const addr_ = this.address();
    return switch (addr_.tag) {
        .Dead => unreachable,
        .Empty => switch (this.family()) {
            AF.INET => global.commonStrings().@"127.0.0.1"(),
            AF.INET6 => global.commonStrings().@"::"(),
        },
        else => addr_.toJS(global),
    };
}

/// Get the address in presentation format. Does not include the port.
///
/// Returns an `.Empty` string for default ipv4 and ipv6 addresses (`127.0.0.1`
/// and `::`, respectively).
///
/// ### TODO
/// - replace `addressToString` in `dns.zig` w this
/// - use this impl in server.zig
pub fn address(this: *SocketAddress) bun.String {
    if (this._presentation.tag != .Dead) return this._presentation;

    var buf: [inet.INET6_ADDRSTRLEN]u8 = undefined;
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
    const presentation = bun.JSC.WebCore.Encoder.toBunStringComptime(formatted, .latin1);
    bun.debugAssert(presentation.tag != .Dead);
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
    // NOTE: cannot use global.commonStrings().IPv[4,6]() b/c this needs to be
    // lower case.
    return switch (this.family()) {
        AF.INET => bun.String.static("ipv4").toJS(global),
        AF.INET6 => bun.String.static("ipv6").toJS(global),
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
        const in6: inet.sockaddr_in6 = @bitCast(this._addr);
        return in6.flowinfo;
    } else {
        return null;
    }
}

pub fn socklen(this: *const SocketAddress) inet.socklen_t {
    switch (this._addr.family) {
        AF.INET => return @sizeOf(inet.sockaddr_in),
        AF.INET6 => return @sizeOf(inet.sockaddr_in6),
    }
}

pub fn estimatedSize(this: *SocketAddress) usize {
    return @sizeOf(SocketAddress) + this._presentation.estimatedSize();
}

pub fn toJSON(this: *SocketAddress, global: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return JSC.JSObject.create(.{
        .address = this.getAddress(global),
        .family = this.getFamily(global),
        .port = this.port(),
        .flowlabel = this.flowLabel() orelse 0,
    }, global).toJS();
}

fn pton(global: *JSC.JSGlobalObject, comptime af: c_int, addr: [:0]const u8, dst: *anyopaque) bun.JSError!void {
    return switch (ares.ares_inet_pton(af, addr.ptr, dst)) {
        0 => global.throwSysError(.{ .code = .ERR_INVALID_IP_ADDRESS }, "Invalid socket address", .{}),

        // TODO: figure out proper wayto convert a c errno into a js exception
        -1 => global.throwSysError(
            .{ .code = .ERR_INVALID_IP_ADDRESS, .errno = std.c._errno().* },
            "Invalid socket address",
            .{},
        ),
        1 => {},
        else => unreachable,
    };
}

inline fn asV4(this: *const SocketAddress) *const inet.sockaddr_in {
    bun.debugAssert(this.family() == AF.INET);
    return &this._addr.sin;
}

inline fn asV6(this: *const SocketAddress) *const inet.sockaddr_in6 {
    bun.debugAssert(this.family() == AF.INET6);
    return &this._addr.sin6;
}

// =============================================================================

// WTF::StringImpl and  WTF::StaticStringImpl have the same shape
// (StringImplShape) so this is fine. We should probably add StaticStringImpl
// bindings though.
const StaticStringImpl = bun.WTF.StringImpl;
extern "c" const IPv4: StaticStringImpl;
extern "c" const IPv6: StaticStringImpl;
const ipv4: bun.String = .{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = IPv4 } };
const ipv6: bun.String = .{ .tag = .WTFStringImpl, .value = .{ .WTFStringImpl = IPv6 } };

// FIXME: c-headers-for-zig casts AF_* and PF_* to `c_int` when it should be `comptime_int`
pub const AF = enum(inet.sa_family_t) {
    INET = @intCast(inet.AF_INET),
    INET6 = @intCast(inet.AF_INET6),
    pub inline fn int(this: AF) inet.sa_family_t {
        return @intFromEnum(this);
    }
};

/// ## Notes
/// - Linux broke compat between `sockaddr_in` and `sockaddr_in6` in v2.4.
///   They're no longer the same size.
/// - This replaces `sockaddr_storage` because it's huge. This is 28 bytes,
///   while `sockaddr_storage` is 128 bytes.
const sockaddr = extern union {
    sin: inet.sockaddr_in,
    sin6: inet.sockaddr_in6,

    pub fn v4(port_: inet.in_port_t, addr: u32) sockaddr {
        return .{ .sin = .{
            .family = AF.INET.int(),
            .port = port_,
            .addr = addr,
        } };
    }

    pub fn v6(
        port_: inet.in_port_t,
        addr: [16]u8,
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
            .addr = addr,
        } };
    }

    // I'd be money endianess is going to screw us here.
    pub const @"127.0.0.1": sockaddr = sockaddr.v4(0, @bitCast([_]u8{ 127, 0, 0, 1 }));
    // TODO: check that `::` is all zeroes on all platforms. Should correspond
    // to `IN6ADDR_ANY_INIT`.
    pub const @"::": sockaddr = sockaddr.v6(0, inet.IN6ADDR_ANY_INIT, 0, 0);
};

const WellKnownAddress = struct {
    extern "c" const INET_LOOPBACK: StaticStringImpl;
    extern "c" const INET6_ANY: StaticStringImpl;
    inline fn @"127.0.0.1"() bun.String {
        return .{
            .tag = .WTFStringImpl,
            .value = .{ .WTFStringImpl = INET_LOOPBACK },
        };
    }
    inline fn @"::"() bun.String {
        return .{
            .tag = .WTFStringImpl,
            .value = .{ .WTFStringImpl = INET6_ANY },
        };
    }
};

// =============================================================================

// The same types are defined in a bunch of different places. We should probably unify them.
comptime {
    // Windows doesn't have c.socklen_t. because of course it doesn't.
    const other_socklens = if (@hasDecl(bun.C.translated, "socklen_t"))
        .{ std.posix.socklen_t, bun.C.translated.socklen_t }
    else
        .{std.posix.socklen_t};
    for (other_socklens) |other_socklen| {
        if (@sizeOf(inet.socklen_t) != @sizeOf(other_socklen)) @compileError("socklen_t size mismatch");
        if (@alignOf(inet.socklen_t) != @alignOf(other_socklen)) @compileError("socklen_t alignment mismatch");
    }
    std.debug.assert(AF.INET.int() == ares.AF.INET);
    std.debug.assert(AF.INET6.int() == ares.AF.INET6);
}

const std = @import("std");
const bun = @import("root").bun;
const ares = bun.c_ares;
const net = std.net;
const Environment = bun.Environment;
const string = bun.string;
const Output = bun.Output;

const JSC = bun.JSC;
const ZigString = JSC.ZigString;
const CallFrame = JSC.CallFrame;
const JSValue = JSC.JSValue;

const isDebug = bun.Environment.isDebug;
const allow_assert = bun.Environment.allow_assert;

const inet = if (bun.Environment.isWindows)
win: {
    const ws2 = std.os.windows.ws2_32;
    break :win struct {
        pub const IN4ADDR_LOOPBACK: u32 = ws2.IN4ADDR_LOOPBACK;
        pub const INET6_ADDRSTRLEN = ws2.INET6_ADDRSTRLEN;
        pub const IN6ADDR_ANY_INIT: [16]u8 = .{0} ** 16;
        pub const AF_INET = ws2.AF.INET;
        pub const AF_INET6 = ws2.AF.INET6;
        pub const sa_family_t = ws2.ADDRESS_FAMILY;
        pub const in_port_t = std.os.windows.USHORT;
        pub const socklen_t = ares.socklen_t;
        pub const sockaddr_in = std.posix.sockaddr.in;
        pub const sockaddr_in6 = std.posix.sockaddr.in6;
    };
} else posix: {
    const C = bun.C.translated;
    break :posix struct {
        pub const IN4ADDR_LOOPBACK = C.IN4ADDR_LOOPBACK;
        pub const INET6_ADDRSTRLEN = C.INET6_ADDRSTRLEN;
        // Make sure this is in line with IN6ADDR_ANY_INIT in `netinet/in.h` on all platforms.
        pub const IN6ADDR_ANY_INIT: [16]u8 = .{0} ** 16;
        pub const AF_INET = C.AF_INET;
        pub const AF_INET6 = C.AF_INET6;
        pub const sa_family_t = C.sa_family_t;
        pub const in_port_t = C.in_port_t;
        pub const socklen_t = ares.socklen_t;
        pub const sockaddr_in = std.posix.sockaddr.in;
        pub const sockaddr_in6 = std.posix.sockaddr.in6;
    };
};
