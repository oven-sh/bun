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
const CommonStrings = JSC.CommonStrings;
const URL = JSC.URL;
const WTF = JSC.WTF;
const JSString = JSC.JSString;
const JSObject = JSC.JSObject;
const JSValue = JSC.JSValue;
const GetterSetter = JSC.GetterSetter;
const CustomGetterSetter = JSC.CustomGetterSetter;

pub const JSUint8Array = opaque {
    pub const name = "Uint8Array_alias";
    pub fn ptr(this: *JSUint8Array) [*]u8 {
        return @as(*[*]u8, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector)).*;
    }

    pub fn len(this: *JSUint8Array) usize {
        return @as(*usize, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayLength)).*;
    }

    pub fn slice(this: *JSUint8Array) []u8 {
        return this.ptr()[0..this.len()];
    }

    extern fn JSUint8Array__fromDefaultAllocator(*JSC.JSGlobalObject, ptr: [*]u8, len: usize) JSC.JSValue;
    /// *bytes* must come from bun.default_allocator
    pub fn fromBytes(globalThis: *JSGlobalObject, bytes: []u8) JSC.JSValue {
        return JSUint8Array__fromDefaultAllocator(globalThis, bytes.ptr, bytes.len);
    }

    extern fn Bun__createUint8ArrayForCopy(*JSC.JSGlobalObject, ptr: ?*const anyopaque, len: usize, buffer: bool) JSValue;
    pub fn fromBytesCopy(globalThis: *JSGlobalObject, bytes: []const u8) JSValue {
        return Bun__createUint8ArrayForCopy(globalThis, bytes.ptr, bytes.len, false);
    }

    pub fn createEmpty(globalThis: *JSGlobalObject) JSValue {
        return Bun__createUint8ArrayForCopy(globalThis, null, 0, false);
    }
};
