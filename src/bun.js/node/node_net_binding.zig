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

// The same types are defined in a bunch of different places. We should probably unify them.
comptime {
    for (.{ std.posix.socklen_t, C.socklen_t }) |other_socklen| {
        if (@sizeOf(socklen) != @sizeOf(other_socklen)) @compileError("socklen_t size mismatch");
        if (@alignOf(socklen) != @alignOf(other_socklen)) @compileError("socklen_t alignment mismatch");
    }
}

pub fn createBinding(global: *JSC.JSGlobalObject) JSC.JSValue {
    const SocketAddress = bun.JSC.GeneratedClassesList.SocketAddress;
    const net = JSC.JSValue.createEmptyObjectWithNullPrototype(global);

    net.put(global, "SocketAddressNative", SocketAddress.getConstructor(global));
    net.put(global, "AF_INET", JSC.jsNumber(@intFromEnum(SocketAddress.AF.INET)));
    net.put(global, "AF_INET6", JSC.jsNumber(@intFromEnum(SocketAddress.AF.INET6)));

    return net;
}
