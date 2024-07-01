const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

//
//

pub var autoSelectFamilyDefault: bool = true;

pub fn getDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "getDefaultAutoSelectFamily", (struct {
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsBoolean(autoSelectFamilyDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamily(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamily", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(1);
            if (arguments.len < 1) {
                globalThis.throw("missing argument", .{});
                return .undefined;
            }
            const arg = arguments.slice()[0];
            if (!arg.isBoolean()) {
                globalThis.throwInvalidArguments("autoSelectFamilyDefault", .{});
                return .undefined;
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
        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsNumber(autoSelectFamilyAttemptTimeoutDefault);
        }
    }).getter, 0, .{});
}

pub fn setDefaultAutoSelectFamilyAttemptTimeout(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSFunction.create(global, "setDefaultAutoSelectFamilyAttemptTimeout", (struct {
        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            const arguments = callframe.arguments(1);
            if (arguments.len < 1) {
                globalThis.throw("missing argument", .{});
                return .undefined;
            }
            const arg = arguments.slice()[0];
            if (!arg.isInt32AsAnyInt()) {
                globalThis.throwInvalidArguments("autoSelectFamilyAttemptTimeoutDefault", .{});
                return .undefined;
            }
            const value: u32 = @max(10, arg.coerceToInt32(globalThis));
            autoSelectFamilyAttemptTimeoutDefault = value;
            return JSC.jsNumber(value);
        }
    }).setter, 1, .{});
}
