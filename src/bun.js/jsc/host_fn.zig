/// A host function is the native function pointer type that can be used by a
/// JSC::JSFunction to call native code from JavaScript.
pub const JSHostFn = fn (*JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
/// To allow usage of `try` for error handling, Bun provides `toJSHostFn` to
/// wrap this type into a JSHostFn.
pub const JSHostFnZig = fn (*JSGlobalObject, *CallFrame) bun.JSError!JSValue;

pub fn JSHostZigFunctionWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSGlobalObject, *CallFrame) bun.JSError!JSValue;
}

pub fn JSHostFunctionTypeWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSGlobalObject, *CallFrame) callconv(jsc.conv) JSValue;
}

pub fn toJSHostFn(comptime functionToWrap: JSHostFnZig) JSHostFn {
    return struct {
        pub fn function(globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(jsc.conv) JSValue {
            if (bun.Environment.allow_assert and bun.Environment.is_canary) {
                const value = functionToWrap(globalThis, callframe) catch |err| switch (err) {
                    error.JSError => .zero,
                    error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
                };
                if (comptime bun.Environment.isDebug) {
                    if (value != .zero) {
                        if (globalThis.hasException()) {
                            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                            defer formatter.deinit();
                            bun.Output.err("Assertion failed",
                                \\Native function returned a non-zero JSValue while an exception is pending
                                \\
                                \\    fn: {s}
                                \\ value: {}
                                \\
                            , .{
                                &functionToWrap, // use `(lldb) image lookup --address 0x1ec4` to discover what function failed
                                value.toFmt(&formatter),
                            });
                            bun.Output.flush();
                        }
                    }
                }
                bun.assert((value == .zero) == globalThis.hasException());
                return value;
            }
            return @call(.always_inline, functionToWrap, .{ globalThis, callframe }) catch |err| switch (err) {
                error.JSError => .zero,
                error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
            };
        }
    }.function;
}

pub fn toJSHostFunctionWithContext(comptime ContextType: type, comptime Function: JSHostZigFunctionWithContext(ContextType)) JSHostFunctionTypeWithContext(ContextType) {
    return struct {
        pub fn function(ctx: *ContextType, globalThis: *JSGlobalObject, callframe: *CallFrame) callconv(jsc.conv) JSValue {
            if (bun.Environment.allow_assert and bun.Environment.is_canary) {
                const value = Function(ctx, globalThis, callframe) catch |err| switch (err) {
                    error.JSError => .zero,
                    error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
                };
                if (comptime bun.Environment.isDebug) {
                    if (value != .zero) {
                        if (globalThis.hasException()) {
                            var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
                            defer formatter.deinit();
                            bun.Output.err("Assertion failed",
                                \\Native function returned a non-zero JSValue while an exception is pending
                                \\
                                \\    fn: {s}
                                \\ value: {}
                                \\
                            , .{
                                &Function, // use `(lldb) image lookup --address 0x1ec4` to discover what function failed
                                value.toFmt(&formatter),
                            });
                            bun.Output.flush();
                        }
                    }
                }
                bun.assert((value == .zero) == globalThis.hasException());
                return value;
            }
            return @call(.always_inline, Function, .{ ctx, globalThis, callframe }) catch |err| switch (err) {
                error.JSError => .zero,
                error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
            };
        }
    }.function;
}

pub fn toJSHostValue(globalThis: *JSGlobalObject, value: error{ OutOfMemory, JSError }!JSValue) JSValue {
    if (bun.Environment.allow_assert and bun.Environment.is_canary) {
        const normal = value catch |err| switch (err) {
            error.JSError => .zero,
            error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
        };
        bun.assert((normal == .zero) == globalThis.hasException());
        return normal;
    }
    return value catch |err| switch (err) {
        error.JSError => .zero,
        error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
    };
}

const ParsedHostFunctionErrorSet = struct {
    OutOfMemory: bool = false,
    JSError: bool = false,
};

inline fn parseErrorSet(T: type, errors: []const std.builtin.Type.Error) ParsedHostFunctionErrorSet {
    return comptime brk: {
        var errs: ParsedHostFunctionErrorSet = .{};
        for (errors) |err| {
            if (!@hasField(ParsedHostFunctionErrorSet, err.name)) {
                @compileError("Return value from host function '" ++ @typeInfo(T) ++ "' can not contain error '" ++ err.name ++ "'");
            }
            @field(errs, err.name) = true;
        }
        break :brk errs;
    };
}

const DeinitFunction = *const fn (ctx: *anyopaque, buffer: [*]u8, len: usize) callconv(.C) void;

const private = struct {
    pub extern fn Bun__CreateFFIFunctionWithDataValue(
        *JSGlobalObject,
        ?*const ZigString,
        argCount: u32,
        function: *const JSHostFn,
        strong: bool,
        data: *anyopaque,
    ) JSValue;
    pub extern fn Bun__CreateFFIFunction(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        function: *const JSHostFn,
        strong: bool,
    ) *anyopaque;

    pub extern fn Bun__CreateFFIFunctionValue(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        function: *const JSHostFn,
        strong: bool,
        add_ptr_field: bool,
        inputFunctionPtr: ?*anyopaque,
    ) JSValue;

    pub extern fn Bun__untrackFFIFunction(
        globalObject: *JSGlobalObject,
        function: JSValue,
    ) bool;

    pub extern fn Bun__FFIFunction_getDataPtr(JSValue) ?*anyopaque;
    pub extern fn Bun__FFIFunction_setDataPtr(JSValue, ?*anyopaque) void;
};

pub fn NewFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime function: anytype,
    strong: bool,
) JSValue {
    if (@TypeOf(function) == JSHostFn) {
        return NewRuntimeFunction(globalObject, symbolName, argCount, function, strong, false, null);
    }
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFn(function), strong, false, null);
}

pub fn createCallback(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime function: anytype,
) JSValue {
    if (@TypeOf(function) == JSHostFn) {
        return NewRuntimeFunction(globalObject, symbolName, argCount, function, false, false, null);
    }
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFn(function), false, false, null);
}

pub fn NewRuntimeFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    functionPointer: *const JSHostFn,
    strong: bool,
    add_ptr_property: bool,
    inputFunctionPtr: ?*anyopaque,
) JSValue {
    jsc.markBinding(@src());
    return private.Bun__CreateFFIFunctionValue(globalObject, symbolName, argCount, functionPointer, strong, add_ptr_property, inputFunctionPtr);
}

pub fn getFunctionData(function: JSValue) ?*anyopaque {
    jsc.markBinding(@src());
    return private.Bun__FFIFunction_getDataPtr(function);
}

pub fn setFunctionData(function: JSValue, value: ?*anyopaque) void {
    jsc.markBinding(@src());
    return private.Bun__FFIFunction_setDataPtr(function, value);
}

pub fn NewFunctionWithData(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime function: JSHostFnZig,
    strong: bool,
    data: *anyopaque,
) JSValue {
    jsc.markBinding(@src());
    return private.Bun__CreateFFIFunctionWithDataValue(
        globalObject,
        symbolName,
        argCount,
        toJSHostFn(function),
        strong,
        data,
    );
}

pub fn untrackFunction(
    globalObject: *JSGlobalObject,
    value: JSValue,
) bool {
    jsc.markBinding(@src());
    return private.Bun__untrackFFIFunction(globalObject, value);
}

const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;
const CallFrame = jsc.CallFrame;
const ZigString = jsc.ZigString;
const std = @import("std");

comptime {
    // this file is gennerated, but cant be placed in the build/debug/codegen folder
    // because zig will complain about outside-of-module stuff
    _ = @import("./GeneratedJS2Native.zig");
}
