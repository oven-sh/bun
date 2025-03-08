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
const napi = @import("../../napi/napi.zig");

pub extern const JSC__JSObject__maxInlineCapacity: c_uint;

pub const JSObject = @import("./JSObject.zig").JSObject;
pub const CachedBytecode = @import("./CachedBytecode.zig").CachedBytecode;
pub const DOMURL = @import("./DOMURL.zig").DOMURL;
pub const DOMFormData = @import("./DOMFormData.zig").DOMFormData;
pub const FetchHeaders = @import("./FetchHeaders.zig").FetchHeaders;
pub const ZigString = @import("./ZigString.zig").ZigString;
pub const SystemError = @import("./SystemError.zig").SystemError;
pub const JSUint8Array = @import("./JSUint8Array.zig").JSUint8Array;
pub const JSCell = @import("./JSCell.zig").JSCell;
pub const JSString = @import("./JSString.zig").JSString;
pub const GetterSetter = @import("./GetterSetter.zig").GetterSetter;
pub const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;
pub const JSPromiseRejectionOperation = @import("./JSPromiseRejectionOperation.zig").JSPromiseRejectionOperation;
pub const CommonAbortReason = @import("./CommonAbortReason.zig").CommonAbortReason;
pub const SourceType = @import("./SourceType.zig").SourceType;
pub const AbortSignal = @import("./AbortSignal.zig").AbortSignal;
pub const JSPromise = @import("./JSPromise.zig").JSPromise;
pub const JSInternalPromise = @import("./JSInternalPromise.zig").JSInternalPromise;
pub const AnyPromise = @import("./AnyPromise.zig").AnyPromise;
pub const JSModuleLoader = @import("./JSModuleLoader.zig").JSModuleLoader;
pub const JSFunction = @import("./JSFunction.zig").JSFunction;
pub const JSGlobalObject = @import("./JSGlobalObject.zig").JSGlobalObject;
pub const CommonStrings = @import("./CommonStrings.zig").CommonStrings;
pub const JSArrayIterator = @import("./JSArrayIterator.zig").JSArrayIterator;
pub const JSMap = @import("./JSMap.zig").JSMap;
pub const JSValue = @import("./JSValue.zig").JSValue;
pub const VM = @import("./VM.zig").VM;
pub const CallFrame = @import("./CallFrame.zig").CallFrame;
pub const EncodedJSValue = @import("./EncodedJSValue.zig").EncodedJSValue;
pub const JSArray = @import("./JSArray.zig").JSArray;
pub const URL = @import("./URL.zig").URL;
pub const URLSearchParams = @import("./URLSearchParams.zig").URLSearchParams;
pub const WTF = @import("./WTF.zig").WTF;
pub const ScriptExecutionStatus = @import("./ScriptExecutionStatus.zig").ScriptExecutionStatus;
pub const DeferredError = @import("./DeferredError.zig").DeferredError;
pub const Sizes = @import("./sizes.zig");

// TODO(@paperdave): delete and inline these functions
pub fn NewGlobalObject(comptime Type: type) type {
    return struct {
        const importNotImpl = "Import not implemented";
        const resolveNotImpl = "resolve not implemented";
        const moduleNotImpl = "Module fetch not implemented";
        pub fn import(global: *JSGlobalObject, specifier: *String, source: *String) callconv(.C) ErrorableString {
            if (comptime @hasDecl(Type, "import")) {
                return @call(bun.callmod_inline, Type.import, .{ global, specifier.*, source.* });
            }
            return ErrorableString.err(error.ImportFailed, String.init(importNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn resolve(
            res: *ErrorableString,
            global: *JSGlobalObject,
            specifier: *String,
            source: *String,
            query_string: *ZigString,
        ) callconv(.C) void {
            if (comptime @hasDecl(Type, "resolve")) {
                @call(bun.callmod_inline, Type.resolve, .{ res, global, specifier.*, source.*, query_string, true });
                return;
            }
            res.* = ErrorableString.err(error.ResolveFailed, String.init(resolveNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *String, source: *String) callconv(.C) void {
            if (comptime @hasDecl(Type, "fetch")) {
                @call(bun.callmod_inline, Type.fetch, .{ ret, global, specifier.*, source.* });
                return;
            }
            ret.* = ErrorableResolvedSource.err(error.FetchFailed, String.init(moduleNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "promiseRejectionTracker")) {
                return @call(bun.callmod_inline, Type.promiseRejectionTracker, .{ global, promise, rejection });
            }
            return JSValue.jsUndefined();
        }

        pub fn reportUncaughtException(global: *JSGlobalObject, exception: *JSC.Exception) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "reportUncaughtException")) {
                return @call(bun.callmod_inline, Type.reportUncaughtException, .{ global, exception });
            }
            return JSValue.jsUndefined();
        }

        pub fn onCrash() callconv(.C) void {
            if (comptime @hasDecl(Type, "onCrash")) {
                return @call(bun.callmod_inline, Type.onCrash, .{});
            }

            Output.flush();

            @panic("A C++ exception occurred");
        }
    };
}

pub fn PromiseCallback(comptime Type: type, comptime CallbackFunction: fn (*Type, *JSGlobalObject, []const JSValue) anyerror!JSValue) type {
    return struct {
        pub fn callback(
            ctx: ?*anyopaque,
            globalThis: *JSGlobalObject,
            arguments: [*]const JSValue,
            arguments_len: usize,
        ) callconv(.C) JSValue {
            return CallbackFunction(@as(*Type, @ptrCast(@alignCast(ctx.?))), globalThis, arguments[0..arguments_len]) catch |err| brk: {
                break :brk ZigString.init(bun.asByteSlice(@errorName(err))).toErrorInstance(globalThis);
            };
        }
    }.callback;
}

pub const JSNativeFn = JSHostZigFunction;

pub const JSValueReprInt = i64;

pub const JSHostFunctionType = fn (*JSGlobalObject, *CallFrame) callconv(JSC.conv) JSValue;
pub const JSHostFunctionTypeWithCCallConvForAssertions = fn (*JSGlobalObject, *CallFrame) callconv(.C) JSValue;
pub const JSHostFunctionPtr = *const JSHostFunctionType;
pub const JSHostZigFunction = fn (*JSGlobalObject, *CallFrame) bun.JSError!JSValue;
pub fn JSHostZigFunctionWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSGlobalObject, *CallFrame) bun.JSError!JSValue;
}
pub fn JSHostFunctionTypeWithContext(comptime ContextType: type) type {
    return fn (*ContextType, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue;
}

pub fn toJSHostFunction(comptime Function: JSHostZigFunction) JSC.JSHostFunctionType {
    return struct {
        pub fn function(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            if (bun.Environment.allow_assert and bun.Environment.is_canary) {
                const value = Function(globalThis, callframe) catch |err| switch (err) {
                    error.JSError => .zero,
                    error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
                };
                if (comptime bun.Environment.isDebug) {
                    if (value != .zero) {
                        if (globalThis.hasException()) {
                            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
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
                            Output.flush();
                        }
                    }
                }
                bun.assert((value == .zero) == globalThis.hasException());
                return value;
            }
            return @call(.always_inline, Function, .{ globalThis, callframe }) catch |err| switch (err) {
                error.JSError => .zero,
                error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
            };
        }
    }.function;
}
pub fn toJSHostFunctionWithContext(comptime ContextType: type, comptime Function: JSHostZigFunctionWithContext(ContextType)) JSHostFunctionTypeWithContext(ContextType) {
    return struct {
        pub fn function(ctx: *ContextType, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
            if (bun.Environment.allow_assert and bun.Environment.is_canary) {
                const value = Function(ctx, globalThis, callframe) catch |err| switch (err) {
                    error.JSError => .zero,
                    error.OutOfMemory => globalThis.throwOutOfMemoryValue(),
                };
                if (comptime bun.Environment.isDebug) {
                    if (value != .zero) {
                        if (globalThis.hasException()) {
                            var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
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
                            Output.flush();
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
        function: JSHostFunctionPtr,
        strong: bool,
        data: *anyopaque,
    ) JSValue;
    pub extern fn Bun__CreateFFIFunction(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: JSHostFunctionPtr,
        strong: bool,
    ) *anyopaque;

    pub extern fn Bun__CreateFFIFunctionValue(
        globalObject: *JSGlobalObject,
        symbolName: ?*const ZigString,
        argCount: u32,
        functionPointer: JSHostFunctionPtr,
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
    comptime functionPointer: anytype,
    strong: bool,
) JSValue {
    if (@TypeOf(functionPointer) == JSC.JSHostFunctionType) {
        return NewRuntimeFunction(globalObject, symbolName, argCount, functionPointer, strong, false, null);
    }
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFunction(functionPointer), strong, false, null);
}

pub fn createCallback(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime functionPointer: anytype,
) JSValue {
    if (@TypeOf(functionPointer) == JSC.JSHostFunctionType) {
        return NewRuntimeFunction(globalObject, symbolName, argCount, functionPointer, false, false);
    }
    return NewRuntimeFunction(globalObject, symbolName, argCount, toJSHostFunction(functionPointer), false, false, null);
}

pub fn NewRuntimeFunction(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    functionPointer: JSHostFunctionPtr,
    strong: bool,
    add_ptr_property: bool,
    inputFunctionPtr: ?*anyopaque,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionValue(globalObject, symbolName, argCount, functionPointer, strong, add_ptr_property, inputFunctionPtr);
}

pub fn getFunctionData(function: JSValue) ?*anyopaque {
    JSC.markBinding(@src());
    return private.Bun__FFIFunction_getDataPtr(function);
}

pub fn setFunctionData(function: JSValue, value: ?*anyopaque) void {
    JSC.markBinding(@src());
    return private.Bun__FFIFunction_setDataPtr(function, value);
}

pub fn NewFunctionWithData(
    globalObject: *JSGlobalObject,
    symbolName: ?*const ZigString,
    argCount: u32,
    comptime functionPointer: JSC.JSHostZigFunction,
    strong: bool,
    data: *anyopaque,
) JSValue {
    JSC.markBinding(@src());
    return private.Bun__CreateFFIFunctionWithDataValue(
        globalObject,
        symbolName,
        argCount,
        toJSHostFunction(functionPointer),
        strong,
        data,
    );
}

pub fn untrackFunction(
    globalObject: *JSGlobalObject,
    value: JSValue,
) bool {
    JSC.markBinding(@src());
    return private.Bun__untrackFFIFunction(globalObject, value);
}

pub usingnamespace @import("./JSPropertyIterator.zig");

// DOMCall Fields
const Bun = JSC.API.Bun;
pub const __DOMCall_ptr = Bun.FFIObject.dom_call;
pub const __DOMCall__reader_u8 = Bun.FFIObject.Reader.DOMCalls.u8;
pub const __DOMCall__reader_u16 = Bun.FFIObject.Reader.DOMCalls.u16;
pub const __DOMCall__reader_u32 = Bun.FFIObject.Reader.DOMCalls.u32;
pub const __DOMCall__reader_ptr = Bun.FFIObject.Reader.DOMCalls.ptr;
pub const __DOMCall__reader_i8 = Bun.FFIObject.Reader.DOMCalls.i8;
pub const __DOMCall__reader_i16 = Bun.FFIObject.Reader.DOMCalls.i16;
pub const __DOMCall__reader_i32 = Bun.FFIObject.Reader.DOMCalls.i32;
pub const __DOMCall__reader_f32 = Bun.FFIObject.Reader.DOMCalls.f32;
pub const __DOMCall__reader_f64 = Bun.FFIObject.Reader.DOMCalls.f64;
pub const __DOMCall__reader_i64 = Bun.FFIObject.Reader.DOMCalls.i64;
pub const __DOMCall__reader_u64 = Bun.FFIObject.Reader.DOMCalls.u64;
pub const __DOMCall__reader_intptr = Bun.FFIObject.Reader.DOMCalls.intptr;
pub const DOMCalls = &.{
    .{ .ptr = Bun.FFIObject.dom_call },
    Bun.FFIObject.Reader.DOMCalls,
};

extern "c" fn JSCInitialize(env: [*]const [*:0]u8, count: usize, cb: *const fn ([*]const u8, len: usize) callconv(.C) void, eval_mode: bool) void;
pub fn initialize(eval_mode: bool) void {
    JSC.markBinding(@src());
    bun.analytics.Features.jsc += 1;
    JSCInitialize(
        std.os.environ.ptr,
        std.os.environ.len,
        struct {
            pub fn callback(name: [*]const u8, len: usize) callconv(.C) void {
                Output.prettyErrorln(
                    \\<r><red>error<r><d>:<r> invalid JSC environment variable
                    \\
                    \\    <b>{s}<r>
                    \\
                    \\For a list of options, see this file:
                    \\
                    \\    https://github.com/oven-sh/webkit/blob/main/Source/JavaScriptCore/runtime/OptionsList.h
                    \\
                    \\Environment variables must be prefixed with "BUN_JSC_". This code runs before .env files are loaded, so those won't work here.
                    \\
                    \\Warning: options change between releases of Bun and WebKit without notice. This is not a stable API, you should not rely on it beyond debugging something, and it may be removed entirely in a future version of Bun.
                ,
                    .{name[0..len]},
                );
                bun.Global.exit(1);
            }
        }.callback,
        eval_mode,
    );
}

comptime {
    // this file is gennerated, but cant be placed in the build/debug/codegen folder
    // because zig will complain about outside-of-module stuff
    _ = @import("./GeneratedJS2Native.zig");
}
