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
pub const VM = @import("./VM.zig").VM;
pub const JSPromise = @import("./JSPromise.zig").JSPromise;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const URL = @import("./URL.zig").URL;
pub const WTF = @import("./WTF.zig").WTF;
pub const JSString = @import("./JSString.zig").JSString;
pub const JSObject = @import("./JSObject.zig").JSObject;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;

pub const JSInternalPromise = opaque {
    extern fn JSC__JSInternalPromise__create(arg0: *JSGlobalObject) *JSInternalPromise;
    extern fn JSC__JSInternalPromise__isHandled(arg0: *const JSInternalPromise, arg1: *VM) bool;
    extern fn JSC__JSInternalPromise__reject(arg0: *JSInternalPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSInternalPromise__rejectAsHandled(arg0: *JSInternalPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSInternalPromise__rejectAsHandledException(arg0: *JSInternalPromise, arg1: *JSGlobalObject, arg2: *JSC.Exception) void;
    extern fn JSC__JSInternalPromise__rejectedPromise(arg0: *JSGlobalObject, JSValue1: JSValue) *JSInternalPromise;
    extern fn JSC__JSInternalPromise__resolve(arg0: *JSInternalPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSInternalPromise__resolvedPromise(arg0: *JSGlobalObject, JSValue1: JSValue) *JSInternalPromise;
    extern fn JSC__JSInternalPromise__result(arg0: *const JSInternalPromise, arg1: *VM) JSValue;
    extern fn JSC__JSInternalPromise__setHandled(arg0: *JSInternalPromise, arg1: *VM) void;
    extern fn JSC__JSInternalPromise__status(arg0: *const JSInternalPromise, arg1: *VM) JSPromise.Status;

    pub fn status(this: *const JSInternalPromise, vm: *VM) JSPromise.Status {
        return JSC__JSInternalPromise__status(this, vm);
    }
    pub fn result(this: *const JSInternalPromise, vm: *VM) JSValue {
        return JSC__JSInternalPromise__result(this, vm);
    }
    pub fn isHandled(this: *const JSInternalPromise, vm: *VM) bool {
        return JSC__JSInternalPromise__isHandled(this, vm);
    }
    pub fn setHandled(this: *JSInternalPromise, vm: *VM) void {
        JSC__JSInternalPromise__setHandled(this, vm);
    }

    pub fn unwrap(promise: *JSInternalPromise, vm: *VM, mode: JSPromise.UnwrapMode) JSPromise.Unwrapped {
        return switch (promise.status(vm)) {
            .pending => .pending,
            .fulfilled => .{ .fulfilled = promise.result(vm) },
            .rejected => {
                if (mode == .mark_handled) promise.setHandled(vm);
                return .{ .rejected = promise.result(vm) };
            },
        };
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return JSC__JSInternalPromise__resolvedPromise(globalThis, value);
    }
    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return JSC__JSInternalPromise__rejectedPromise(globalThis, value);
    }

    pub fn resolve(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        JSC__JSInternalPromise__resolve(this, globalThis, value);
    }
    pub fn reject(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        JSC__JSInternalPromise__reject(this, globalThis, value);
    }
    pub fn rejectAsHandled(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        JSC__JSInternalPromise__rejectAsHandled(this, globalThis, value);
    }

    pub fn create(globalThis: *JSGlobalObject) *JSInternalPromise {
        return JSC__JSInternalPromise__create(globalThis);
    }

    pub fn asValue(this: *JSInternalPromise) JSValue {
        return JSValue.fromCell(this);
    }
};
