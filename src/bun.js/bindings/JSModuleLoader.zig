const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSInternalPromise = @import("JSInternalPromise.zig").JSInternalPromise;
const Shimmer = JSC.Shimmer;
const String = bun.String;

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
