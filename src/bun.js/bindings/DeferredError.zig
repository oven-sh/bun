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

pub const JSGlobalObject = @import("./JSGlobalObject.zig").JSGlobalObject;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const VM = @import("./VM.zig").VM;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const URL = @import("./URL.zig").URL;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;
pub const JSObject = @import("./JSObject.zig").JSObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;

pub const DeferredError = struct {
    kind: Kind,
    code: JSC.Node.ErrorCode,
    msg: bun.String,

    pub const Kind = enum { plainerror, typeerror, rangeerror };

    pub fn from(kind: Kind, code: JSC.Node.ErrorCode, comptime fmt: [:0]const u8, args: anytype) DeferredError {
        return .{
            .kind = kind,
            .code = code,
            .msg = bun.String.createFormat(fmt, args) catch bun.outOfMemory(),
        };
    }

    pub fn toError(this: *const DeferredError, globalThis: *JSGlobalObject) JSValue {
        const err = switch (this.kind) {
            .plainerror => this.msg.toErrorInstance(globalThis),
            .typeerror => this.msg.toTypeErrorInstance(globalThis),
            .rangeerror => this.msg.toRangeErrorInstance(globalThis),
        };
        err.put(globalThis, ZigString.static("code"), ZigString.init(@tagName(this.code)).toJS(globalThis));
        return err;
    }
};
