/// Common strings from `BunCommonStrings.h`.
///
/// All getters return a `JSC::JSString`;
pub const CommonStrings = struct {
    globalObject: *JSC.JSGlobalObject,

    pub inline fn IPv4(this: CommonStrings) JSValue {
        return this.getString("IPv4");
    }
    pub inline fn IPv6(this: CommonStrings) JSValue {
        return this.getString("IPv6");
    }
    pub inline fn @"127.0.0.1"(this: CommonStrings) JSValue {
        return this.getString("IN4Loopback");
    }
    pub inline fn @"::"(this: CommonStrings) JSValue {
        return this.getString("IN6Any");
    }

    inline fn getString(this: CommonStrings, comptime name: anytype) JSValue {
        JSC.markMemberBinding("CommonStrings", @src());
        const str: JSC.JSValue = @call(
            .auto,
            @field(CommonStrings, "JSC__JSGlobalObject__commonStrings__get" ++ name),
            .{this.globalObject},
        );
        bun.assert(str != .zero);
        if (comptime bun.Environment.isDebug) {
            bun.assertWithLocation(str != .zero, @src());
            bun.assertWithLocation(str.isStringLiteral(), @src());
        }
        return str;
    }

    extern "C" fn JSC__JSGlobalObject__commonStrings__getIPv4(global: *JSC.JSGlobalObject) JSC.JSValue;
    extern "C" fn JSC__JSGlobalObject__commonStrings__getIPv6(global: *JSC.JSGlobalObject) JSC.JSValue;
    extern "C" fn JSC__JSGlobalObject__commonStrings__getIN4Loopback(global: *JSC.JSGlobalObject) JSC.JSValue;
    extern "C" fn JSC__JSGlobalObject__commonStrings__getIN6Any(global: *JSC.JSGlobalObject) JSC.JSValue;
};

const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VM = JSC.VM;
