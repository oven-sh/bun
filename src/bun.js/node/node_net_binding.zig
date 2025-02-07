const std = @import("std");
const bun = @import("root").bun;
const ares = bun.c_ares;
const C = bun.C.translated;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

const socklen = ares.socklen_t;
const CallFrame = JSC.CallFrame;
const JSValue = JSC.JSValue;

//
//

pub var autoSelectFamilyDefault: bool = true;

pub fn getDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamily", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsBoolean(autoSelectFamilyDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamily", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            if (!arg.isBoolean()) {
                return globalThis.throwInvalidArguments("autoSelectFamilyDefault", .{});
            }
            const value = arg.toBoolean();
            autoSelectFamilyDefault = value;
            return JSC.jsBoolean(value);
        }
    }).setter, 1, .{});
}

//
//

pub var autoSelectFamilyAttemptTimeoutDefault: u32 = 250;

pub fn getDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsNumber(autoSelectFamilyAttemptTimeoutDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.arguments_old(1);
            if (arguments.len < 1) {
                return globalThis.throw("missing argument", .{});
            }
            const arg = arguments.slice()[0];
            if (!arg.isInt32AsAnyInt()) {
                return globalThis.throwInvalidArguments("autoSelectFamilyAttemptTimeoutDefault", .{});
            }
            const value: u32 = @max(10, arg.coerceToInt32(globalThis));
            autoSelectFamilyAttemptTimeoutDefault = value;
            return JSC.jsNumber(value);
        }
    }).setter, 1, .{});
}

pub const SocketAddressNew = struct {
    // NOTE: not std.net.Address b/c .un is huge and we don't use it.
    addr: C.sockaddr_in,

    const Options = struct {
        family: c_int = C.AF_INET,
        address: ?bun.String = null,
        port: u16 = 0,
        flowlabel: ?u32 = null,

        /// NOTE: assumes options object has been normalized and validated by JS code.
        pub fn fromJS(global: *JSC.JSGlobalObject, obj: JSValue) bun.JSError!Options {
            bun.assert(obj.isObject());

            const address_str = if (try obj.get(global, "address")) |a|
                bun.String.fromJS(a, global)
            else
                null;

            const _family: c_int = if (try obj.get(global, "family")) |fam| blk: {
                if (comptime bun.Environment.isDebug) bun.assert(fam.isString());
                const slice = fam.asString().toSlice(global, bun.default_allocator);
                if (bun.strings.eqlComptime(slice, "ipv4")) {
                    break :blk C.AF_INET;
                } else if (bun.strings.eqlComptime(slice, "ipv6")) {
                    break :blk C.AF_INET6;
                } else {
                    return global.throwInvalidArgumentValue("options.family", "ipv4 or ipv6", fam);
                }
            } else C.AF_INET;

            // required. Validated by `validatePort`.
            const _port: u16 = if (try obj.get(global, "port")) |p|
                @truncate(p.asUInt32(global) orelse unreachable)
            else
                unreachable;

            const _flowlabel = if (try obj.get(global, "flowlabel")) |fl|
                fl.asUInt32() orelse unreachable
            else
                null;

            return .{
                .family = _family,
                .address = if (address_str) |a| try bun.String.fromJS2(a) else null,
                .port = _port,
                .flowlabel = _flowlabel,
            };
        }
    };

    const @"127.0.0.1": SocketAddressNew = .{ .addr = .{
        .sin_family = C.AF_INET,
        .sin_port = C.htons(0),
        .sin_addr = .{ .s_addr = C.INADDR_LOOPBACK },
    } };
    pub usingnamespace JSC.Codegen.JSSocketAddressNew;
    pub usingnamespace bun.New(SocketAddressNew);

    /// `new SocketAddress([options])`
    ///
    /// ## Safety
    /// Constructor assumes that options object has already been sanitized and validated
    /// by JS wrapper.
    ///
    /// ## References
    /// - [Node docs](https://nodejs.org/api/net.html#new-netsocketaddressoptions)
    pub fn constructor(global: *JSC.JSGlobalObject, frame: *JSC.CallFrame) bun.JSError!*SocketAddressNew {
        const options_obj = frame.argument(0);
        if (options_obj.isUndefined()) {
            const sa = SocketAddressNew.new();
            sa.* = @"127.0.0.1";
            return sa;
        }
        if (!options_obj.isObject()) return global.throwInvalidArgumentTypeValue("options", "object", options_obj);
        const options = try Options.fromJS(global, options_obj);
        var addr: C.sockaddr_in = .{
            .sin_family = options.family,
            .sin_port = C.htons(options.port),
            .sin_addr = undefined,
            .sin_zero = undefined,
        };
        switch (options.family) {
            C.AF_INET => {
                addr.sin_zero = std.mem.zeroes(@TypeOf([8]u8));
                if (options.address) |address_str| {
                    defer address_str.deref();
                    // NOTE: should never allocate
                    var slice = address_str.toSlice(bun.default_allocator);
                    defer slice.deinit();
                    try pton(global, C.AF_INET, slice.slice(), &addr.sin_addr);
                }
            },
            C.AF_INET6 => {
                if (options.address) |address_str| {
                    defer address_str.deref();
                    var slice = address_str.toSlice(bun.default_allocator);
                    defer slice.deinit();
                    var sin6: *C.sockaddr_in6 = &@bitCast(addr);
                    sin6.sin6_flowinfo = options.flowlabel orelse 0;
                    sin6.sin6_scope_id = 0;
                    try pton(global, C.AF_INET6, slice.slice(), &addr.sin6_addr);
                }
            },
            else => unreachable //return global.throwInvalidArgumentValue("family", "ipv4 or ipv6", options_obj),
        }

        return SocketAddressNew.new(.{ .addr = addr });
    }

    fn pton(global: *JSC.JSGlobalObject, comptime af: c_int, addr: []const u8, dst: *anyopaque) bun.JSError!void {
        switch (ares.ares_inet_pton(af, addr, &dst)) {
            // 0 => return global.throw("address", "valid IPv4 address", options.address.toJS(global)),
            0 => {
                global.throw(global.createError(JSC.Node.ErrorCode.ERR_INVALID_ADDRESS, "Error", "Invalid socket address"));
            },
            -1 => {
                // TODO: figure out proper wayto convert a c errno into a js exception
                const err = bun.errnoToZigErr(bun.C.getErrno(-1));
                return global.throwError(err, "Invalid socket address");
            },
            1 => return,
            else => unreachable,
        }
    }

    pub fn parse(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = globalObject;
        _ = callframe;
        return JSC.JSValue.jsUndefined(); // TODO;
    }
    pub fn isSocketAddress(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = globalObject;
        _ = callframe;
        return JSC.JSValue.jsBoolean(false); // TODO;
    }

    pub fn getAddress(this: *SocketAddressNew, global: *JSC.JSGlobalObject) bun.JSError!JSC.JSValue {
        return this.address().toJS(global);
    }

    /// TODO: replace `addressToString` in `dns.zig` w this
    pub fn address(this: *const SocketAddressNew) bun.String {
        // switch (this.addr) {
        //     .in => |ipv4| {
        //         const bytes = @as(*const [4]u8, @ptrCast(&ipv4.sa.addr));
        //         return bun.String.createFormat("{}.{}.{}.{}", .{
        //             bytes[0],
        //             bytes[1],
        //             bytes[2],
        //             bytes[3],
        //         });
        //     },
        //     .in6 => |ipv6| {
        //         // TODO: add 1 for sentinel?
        //         var sockaddr: [AddressFamily.ipv6.addrlen()]u8 = undefined;
        //         // SAFETY: SocketAddress should only ever be created via
        //         // initializer or via parse(), both of which fail on invalid
        //         // addresses.
        //         const formatted = ares.ares_inet_ntop(AddressFamily.ipv6, &ipv6.sa.addr, &sockaddr, AddressFamily.ipv6.addrlen()) orelse {
        //             std.debug.panic("Invariant violation: SocketAddress created with invalid IPv6 address ({any})", .{this.addr});
        //         };
        //         if (comptime bun.Environment.isDebug) {
        //             bun.assertWithLocation(bun.strings.isAllASCII(formatted), @src());
        //         }
        //         // TODO: is passing a stack reference to BunString.createLatin1 safe?
        //         return bun.JSC.WebCore.Encoder.toBunStringComptime(formatted, .latin1);
        //     },
        //     else => unreachable,
        // }
        var buf: [C.INET6_ADDRSTRLEN]u8 = undefined;
        const af: c_int = switch (this.family()) {
            std.posix.AF.INET => C.AF_INET,
            std.posix.AF.INET6 => C.AF_INET6,
            else => unreachable,
        };
        const formatted = std.mem.span(ares.ares_inet_ntop(af, &this.addr.any.data, &buf, buf.len)) orelse {
            std.debug.panic("Invariant violation: SocketAddress created with invalid IPv6 address ({any})", .{this.addr});
        };
        if (comptime bun.Environment.isDebug) {
            bun.assertWithLocation(bun.strings.isAllASCII(formatted), @src());
        }
        return bun.JSC.WebCore.Encoder.toBunStringComptime(formatted, .latin1);
    }

    pub fn getFamily(this: *SocketAddressNew, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsNumber(this.family());
    }

    /// NOTE: zig std uses posix values only, while this returns whatever the
    /// system uses. Do not compare to `std.posix.AF`.
    pub fn family(this: *const SocketAddressNew) C.sa_family_t {
        return this.addr.sin_family;
    }

    pub fn getPort(this: *SocketAddressNew, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsNumber(this.port());
    }

    /// Get the port number in native byte order.
    pub fn port(this: *const SocketAddressNew) u16 {
        return C.ntohs(this.addr.sin_port);
    }

    pub fn getFlowLabel(this: *SocketAddressNew, _: *JSC.JSGlobalObject) JSValue {
        return if (this.flowLabel()) |flow_label|
            JSValue.jsNumber(flow_label)
        else
            JSValue.jsUndefined();
    }

    /// Returns `null` for non-IPv6 addresses.
    ///
    /// ## References
    /// - [RFC 6437](https://tools.ietf.org/html/rfc6437)
    pub fn flowLabel(this: *const SocketAddressNew) ?u32 {
        if (this.addr.sin_family == C.AF_INET6) {
            const in6: C.sockaddr_in6 = @bitCast(this.addr);
            return in6.sin6_flowinfo;
        } else {
            return null;
        }
    }

    pub fn socklen(this: *const SocketAddressNew) C.socklen_t {
        switch (this.addr.sin_family) {
            C.AF_INET => return @sizeOf(C.sockaddr_in),
            C.AF_INET6 => return @sizeOf(C.sockaddr_in6),
            else => std.debug.panic("Invalid address family: {}", .{this.addr.sin_family}),
        }
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
