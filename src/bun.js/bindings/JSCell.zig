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

pub const JSObject = @import("./JSObject.zig").JSObject;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;
pub const JSGlobalObject = @import("./JSGlobalObject.zig").JSGlobalObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const VM = @import("./VM.zig").VM;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const URL = @import("./URL.zig").URL;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;

pub const JSCell = extern struct {
    pub const shim = Shimmer("JSC", "JSCell", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSCell.h";
    pub const name = "JSC::JSCell";
    pub const namespace = "JSC";

    const CellType = enum(u8) { _ };

    pub fn getObject(this: *JSCell) *JSObject {
        return shim.cppFn("getObject", .{this});
    }

    pub fn getType(this: *JSCell) u8 {
        return shim.cppFn("getType", .{
            this,
        });
    }

    pub const Extern = [_][]const u8{ "getObject", "getType" };

    pub fn getGetterSetter(this: *JSCell) *GetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isGetterSetter());
        }
        return @as(*GetterSetter, @ptrCast(@alignCast(this)));
    }

    pub fn getCustomGetterSetter(this: *JSCell) *CustomGetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isCustomGetterSetter());
        }
        return @as(*CustomGetterSetter, @ptrCast(@alignCast(this)));
    }
};
