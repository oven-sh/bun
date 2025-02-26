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
pub const JSInternalPromise = @import("./JSInternalPromise.zig").JSInternalPromise;
pub const VM = @import("./VM.zig").VM;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const URL = @import("./URL.zig").URL;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;
pub const JSObject = @import("./JSObject.zig").JSObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;
pub const JSPromise = @import("./JSPromise.zig").JSPromise;

pub const JSModuleLoader = extern struct {
    pub const shim = Shimmer("JSC", "JSModuleLoader", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSModuleLoader.h";
    pub const name = "JSC::JSModuleLoader";
    pub const namespace = "JSC";

    pub fn evaluate(
        globalObject: *JSGlobalObject,
        sourceCodePtr: [*]const u8,
        sourceCodeLen: usize,
        originUrlPtr: [*]const u8,
        originUrlLen: usize,
        referrerUrlPtr: [*]const u8,
        referrerUrlLen: usize,
        thisValue: JSValue,
        exception: [*]JSValue,
    ) JSValue {
        return shim.cppFn("evaluate", .{
            globalObject,
            sourceCodePtr,
            sourceCodeLen,
            originUrlPtr,
            originUrlLen,
            referrerUrlPtr,
            referrerUrlLen,
            thisValue,
            exception,
        });
    }
    extern fn JSC__JSModuleLoader__loadAndEvaluateModule(arg0: *JSGlobalObject, arg1: ?*const String) *JSInternalPromise;
    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: ?*const bun.String) ?*JSInternalPromise {
        return JSC__JSModuleLoader__loadAndEvaluateModule(globalObject, module_name);
    }

    extern fn JSModuleLoader__import(*JSGlobalObject, *const bun.String) *JSInternalPromise;
    pub fn import(globalObject: *JSGlobalObject, module_name: *const bun.String) *JSInternalPromise {
        return JSModuleLoader__import(globalObject, module_name);
    }

    // pub fn dependencyKeysIfEvaluated(this: *JSModuleLoader, globalObject: *JSGlobalObject, moduleRecord: *JSModuleRecord) *JSValue {
    //     return shim.cppFn("dependencyKeysIfEvaluated", .{ this, globalObject, moduleRecord });
    // }

    pub const Extern = [_][]const u8{
        "evaluate",
        "loadAndEvaluateModule",
        "importModule",
        "checkSyntax",
    };
};
