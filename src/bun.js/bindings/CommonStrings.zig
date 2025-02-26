const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const C_API = bun.JSC.C;
const StringPointer = @import("../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = bun.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const FFI = @import("./FFI.zig");
const NullableAllocator = bun.NullableAllocator;
const MutableString = bun.MutableString;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;
const String = bun.String;
const ErrorableString = JSC.ErrorableString;
const JSError = bun.JSError;
const OOM = bun.OOM;

const Api = @import("../../api/schema.zig").Api;

const Bun = JSC.API.Bun;

const JSGlobalObject = JSC.JSGlobalObject;
const VM = JSC.VM;
const ZigString = JSC.ZigString;
const URL = JSC.URL;
const WTF = JSC.WTF;
const JSString = JSC.JSString;
const JSObject = JSC.JSObject;
const JSValue = JSC.JSValue;
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
