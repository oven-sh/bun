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

// FIXME: c-headers-for-zig casts AF_* and PF_* to `c_int` when it should be `comptime_int`
const AF = struct {
    pub const INET: C.sa_family_t = @intCast(C.AF_INET);
    pub const INET6: C.sa_family_t = @intCast(C.AF_INET6);
};

/// ## Notes
/// - Linux broke compat between `sockaddr_in` and `sockaddr_in6` in v2.4.
///   They're no longer the same size.
/// - This replaces `sockaddr_storage` because it's huge. This is 28 bytes,
///   while `sockaddr_storage` is 128 bytes.
const sockaddr_in = extern union {
    sin: C.sockaddr_in,
    sin6: C.sockaddr_in6,

    pub const @"127.0.0.1": sockaddr_in = .{
        .sin = .{
            .sin_family = AF.INET,
            .sin_port = 0,
            .sin_addr = .{ .s_addr = C.INADDR_LOOPBACK },
        },
    };
    pub const @"::1": sockaddr_in = .{ .sin6 = .{
        .sin6_family = AF.INET6,
        .sin6_port = 0,
        .sin6_flowinfo = 0,
        .sin6_addr = C.inaddr6_loopback,
    } };
};

// TODO: replace JSSocketAddress with this. May need to move native portion elsewhere.
pub const SocketAddressNew = struct {
    // NOTE: not std.net.Address b/c .un is huge and we don't use it.
    // NOTE: not C.sockaddr_storage b/c it's _huge_. we need >= 28 bytes for sockaddr_in6,
    // but sockaddr_storage is 128 bytes.
    addr: sockaddr_in,

    const Options = struct {
        family: C.sa_family_t = AF.INET,
        address: ?bun.String = null,
        port: u16 = 0,
        flowlabel: ?u32 = null,

        /// NOTE: assumes options object has been normalized and validated by JS code.
        pub fn fromJS(global: *JSC.JSGlobalObject, obj: JSValue) bun.JSError!Options {
            bun.assert(obj.isObject());

            const address_str: ?bun.String = if (try obj.get(global, "address")) |a|
                try bun.String.fromJS2(a, global)
            else
                null;

            const _family: C.sa_family_t = if (try obj.get(global, "family")) |fam| blk: {
                if (comptime bun.Environment.isDebug) bun.assert(fam.isString());
                const slice = fam.asString().toSlice(global, bun.default_allocator);
                if (bun.strings.eqlComptime(slice.slice(), "ipv4")) {
                    break :blk AF.INET;
                } else if (bun.strings.eqlComptime(slice.slice(), "ipv6")) {
                    break :blk AF.INET6;
                } else {
                    return global.throwInvalidArgumentTypeValue("options.family", "ipv4 or ipv6", fam);
                }
            } else AF.INET;

            // required. Validated by `validatePort`.
            const _port: u16 = if (try obj.get(global, "port")) |p| blk: {
                if (!p.isUInt32AsAnyInt()) return global.throwInvalidArgumentTypeValue("options.port", "number", p);
                break :blk @truncate(p.toU32());
            } else return global.throwMissingArgumentsValue(&.{"options.port"});

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
            return SocketAddressNew.new(.{ .addr = sockaddr_in.@"127.0.0.1" });
        }

        if (!options_obj.isObject()) return global.throwInvalidArgumentTypeValue("options", "object", options_obj);
        const options = try Options.fromJS(global, options_obj);

        // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
        // Switch back to `htons(options.port)` when this issue gets resolved:
        // https://github.com/ziglang/zig/issues/22804
        const addr: sockaddr_in = switch (options.family) {
            AF.INET => v4: {
                var sin: C.sockaddr_in = .{
                    .sin_family = options.family,
                    .sin_port = std.mem.nativeToBig(u16, options.port),
                    .sin_addr = undefined,
                };
                if (options.address) |address_str| {
                    defer address_str.deref();
                    // NOTE: should never allocate
                    var slice = address_str.toSlice(bun.default_allocator);
                    defer slice.deinit();
                    try pton(global, C.AF_INET, slice.slice(), &sin.sin_addr);
                } else {
                    sin.sin_addr = .{ .s_addr = C.INADDR_LOOPBACK };
                }
                break :v4 .{ .sin = sin };
            },
            AF.INET6 => v6: {
                var sin6: C.sockaddr_in6 = .{
                    .sin6_family = options.family,
                    .sin6_port = std.mem.nativeToBig(u16, options.port),
                    .sin6_flowinfo = options.flowlabel orelse 0,
                    .sin6_addr = undefined,
                };
                if (options.address) |address_str| {
                    defer address_str.deref();
                    var slice = address_str.toSlice(bun.default_allocator);
                    defer slice.deinit();
                    try pton(global, C.AF_INET6, slice.slice(), &sin6.sin6_addr);
                } else {
                    sin6.sin6_addr = C.in6addr_loopback;
                }
                break :v6 .{ .sin6 = sin6 };
            },
            else => unreachable, //return global.throwInvalidArgumentValue("family", "ipv4 or ipv6", options_obj),
        };

        return SocketAddressNew.new(.{ .addr = addr });
    }

    fn pton(global: *JSC.JSGlobalObject, comptime af: c_int, addr: []const u8, dst: *anyopaque) bun.JSError!void {
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

    pub fn getAddress(this: *SocketAddressNew, global: *JSC.JSGlobalObject) JSC.JSValue {
        return this.address().toJS(global);
    }

    /// TODO: replace `addressToString` in `dns.zig` w this
    pub fn address(this: *const SocketAddressNew) bun.String {
        var buf: [C.INET6_ADDRSTRLEN]u8 = undefined;
        const addr_src: *const anyopaque = if (this.family() == AF.INET)
            @ptrCast(&this.asV4().sin_addr)
        else
            @ptrCast(&this.asV6().sin6_addr);

        const formatted = std.mem.span(ares.ares_inet_ntop(this.family(), addr_src, &buf, buf.len) orelse {
            std.debug.panic("Invariant violation: SocketAddress created with invalid IPv6 address ({any})", .{this.addr});
        });
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
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for family.
        return this.addr.sin.sin_family;
    }

    pub fn getPort(this: *SocketAddressNew, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsNumber(this.port());
    }

    /// Get the port number in host byte order.
    pub fn port(this: *const SocketAddressNew) u16 {
        // NOTE: sockaddr_in and sockaddr_in6 have the same layout for port.
        // NOTE: `zig translate-c` creates semantically invalid code for `C.ntohs`.
        // Switch back to `ntohs` when this issue gets resolved: https://github.com/ziglang/zig/issues/22804
        return std.mem.bigToNative(u16, this.addr.sin.sin_port);
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
        if (this.family() == C.AF_INET6) {
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

    inline fn asV4(this: *const SocketAddressNew) *const C.sockaddr_in {
        bun.debugAssert(this.addr.sin.sin_family == C.AF_INET);
        return &this.addr.sin;
    }

    inline fn asV6(this: *const SocketAddressNew) *const C.sockaddr_in6 {
        bun.debugAssert(this.addr.sin6.sin6_family == C.AF_INET6);
        return &this.addr.sin6;
    }
};

// The same types are defined in a bunch of different places. We should probably unify them.
comptime {
    for (.{ std.posix.socklen_t, C.socklen_t }) |other_socklen| {
        if (@sizeOf(socklen) != @sizeOf(other_socklen)) @compileError("socklen_t size mismatch");
        if (@alignOf(socklen) != @alignOf(other_socklen)) @compileError("socklen_t alignment mismatch");
    }
}

pub fn createBinding(global: *JSC.JSGlobalObject) JSC.JSValue {
    const net = JSC.JSValue.createEmptyObjectWithNullPrototype(global);
    net.put(global, "SocketAddress", bun.JSC.GeneratedClassesList.SocketAddress.getConstructor(global));

    return net;
}
