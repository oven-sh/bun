const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSInternalPromise = @import("JSInternalPromise.zig").JSInternalPromise;
const String = bun.String;

pub const JSModuleLoader = opaque {
    extern fn JSC__JSModuleLoader__evaluate(
        globalObject: *JSGlobalObject,
        sourceCodePtr: [*]const u8,
        sourceCodeLen: usize,
        originUrlPtr: [*]const u8,
        originUrlLen: usize,
        referrerUrlPtr: [*]const u8,
        referrerUrlLen: usize,
        thisValue: JSValue,
        exception: [*]JSValue,
    ) JSValue;

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
        return JSC__JSModuleLoader__evaluate(
            globalObject,
            sourceCodePtr,
            sourceCodeLen,
            originUrlPtr,
            originUrlLen,
            referrerUrlPtr,
            referrerUrlLen,
            thisValue,
            exception,
        );
    }
    extern fn JSC__JSModuleLoader__loadAndEvaluateModule(arg0: *JSGlobalObject, arg1: ?*const String) *JSInternalPromise;
    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: ?*const bun.String) ?*JSInternalPromise {
        return JSC__JSModuleLoader__loadAndEvaluateModule(globalObject, module_name);
    }

    extern fn JSModuleLoader__import(*JSGlobalObject, *const bun.String) *JSInternalPromise;
    pub fn import(globalObject: *JSGlobalObject, module_name: *const bun.String) *JSInternalPromise {
        return JSModuleLoader__import(globalObject, module_name);
    }
};
