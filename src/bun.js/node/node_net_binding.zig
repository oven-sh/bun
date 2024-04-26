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
pub const _autoSelectFamilyDefault = MixinBool(@This(), "autoSelectFamilyDefault").access;

pub var autoSelectFamilyAttemptTimeoutDefault: u32 = 250;
pub const _autoSelectFamilyAttemptTimeoutDefault = MixinUInt(@This(), "autoSelectFamilyAttemptTimeoutDefault").access;

//
//

fn MixinBool(comptime Scope: type, comptime name: string) type {
    const S = struct {
        pub fn access(globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
            const object = JSC.JSValue.createEmptyObject(globalThis, 2);
            object.put(globalThis, ZigString.static("get"), JSC.JSFunction.create(globalThis, "get_" ++ name, getter, 0, .{}));
            object.put(globalThis, ZigString.static("set"), JSC.JSFunction.create(globalThis, "set_" ++ name, setter, 1, .{}));
            return object;
        }

        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsBoolean(@field(Scope, name));
        }

        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(1);
            if (arguments.len < 1) {
                globalThis.throw("missing argument", .{});
                return .undefined;
            }
            const arg = arguments.slice()[0];
            if (!arg.isBoolean()) {
                globalThis.throwInvalidArguments(name ++ " is a boolean", .{});
                return .undefined;
            }
            @field(Scope, name) = arg.toBoolean();
            return JSC.jsBoolean(@field(Scope, name));
        }
    };
    return S;
}

fn MixinUInt(comptime Scope: type, comptime name: string) type {
    const S = struct {
        pub fn access(globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
            const object = JSC.JSValue.createEmptyObject(globalThis, 2);
            object.put(globalThis, ZigString.static("get"), JSC.JSFunction.create(globalThis, "get_" ++ name, getter, 0, .{}));
            object.put(globalThis, ZigString.static("set"), JSC.JSFunction.create(globalThis, "set_" ++ name, setter, 1, .{}));
            return object;
        }

        fn getter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            return JSC.jsNumber(@field(Scope, name));
        }

        fn setter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(1);
            if (arguments.len < 1) {
                globalThis.throw("missing argument", .{});
                return .undefined;
            }
            const arg = arguments.slice()[0];
            if (!arg.isInt32()) {
                globalThis.throwInvalidArguments(name ++ " is a boolean", .{});
                return .undefined;
            }
            @field(Scope, name) = arg.toU32();
            return JSC.jsNumber(@field(Scope, name));
        }
    };
    return S;
}
