//! Bindings to JavaScriptCore and other JavaScript primatives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! TODO: Remove remaining aliases to `webcore` and `api`

/// The calling convention used for JavaScript functions <> Native
pub const conv: std.builtin.CallingConvention = if (bun.Environment.isWindows and bun.Environment.isX64)
    .{ .x86_64_sysv = .{} }
else
    .c;

/// Web Template Framework
pub const wtf = @import("./bindings/WTF.zig").WTF;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) void {
    markBinding(@src());
    bun.analytics.Features.jsc += 1;
    JSCInitialize(std.os.environ.ptr, std.os.environ.len, onJSCInvalidEnvVar, eval_mode);
}

pub const JSValue = @import("./bindings/JSValue.zig").JSValue;

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript. To allow usage of `try`
// for error handling, Bun provides toJSHostFn to wrap JSHostFnZig into JSHostFn.
pub const host_fn = @import("./jsc/host_fn.zig");
pub const JSHostFn = host_fn.JSHostFn;
pub const JSHostFnZig = host_fn.JSHostFnZig;
pub const JSHostFnZigWithContext = host_fn.JSHostFnZigWithContext;
pub const JSHostFunctionTypeWithContext = host_fn.JSHostFunctionTypeWithContext;
pub const toJSHostFn = host_fn.toJSHostFn;
pub const toJSHostFnResult = host_fn.toJSHostFnResult;
pub const toJSHostFnWithContext = host_fn.toJSHostFnWithContext;
pub const toJSHostCall = host_fn.toJSHostCall;
pub const fromJSHostCall = host_fn.fromJSHostCall;
pub const fromJSHostCallGeneric = host_fn.fromJSHostCallGeneric;

// JSC Classes Bindings
pub const AnyPromise = @import("./bindings/AnyPromise.zig").AnyPromise;
pub const array_buffer = @import("./jsc/array_buffer.zig");
pub const ArrayBuffer = array_buffer.ArrayBuffer;
pub const MarkedArrayBuffer = array_buffer.MarkedArrayBuffer;
pub const JSCArrayBuffer = array_buffer.JSCArrayBuffer;
pub const CachedBytecode = @import("./bindings/CachedBytecode.zig").CachedBytecode;
pub const CallFrame = @import("./bindings/CallFrame.zig").CallFrame;
pub const CommonAbortReason = @import("./bindings/CommonAbortReason.zig").CommonAbortReason;
pub const CommonStrings = @import("./bindings/CommonStrings.zig").CommonStrings;
pub const CustomGetterSetter = @import("./bindings/CustomGetterSetter.zig").CustomGetterSetter;
pub const DOMFormData = @import("./bindings/DOMFormData.zig").DOMFormData;
pub const DOMURL = @import("./bindings/DOMURL.zig").DOMURL;
pub const DecodedJSValue = @import("./bindings/DecodedJSValue.zig").DecodedJSValue;
pub const DeferredError = @import("./bindings/DeferredError.zig").DeferredError;
pub const GetterSetter = @import("./bindings/GetterSetter.zig").GetterSetter;
pub const JSArray = @import("./bindings/JSArray.zig").JSArray;
pub const JSArrayIterator = @import("./bindings/JSArrayIterator.zig").JSArrayIterator;
pub const JSCell = @import("./bindings/JSCell.zig").JSCell;
pub const JSFunction = @import("./bindings/JSFunction.zig").JSFunction;
pub const JSGlobalObject = @import("./bindings/JSGlobalObject.zig").JSGlobalObject;
pub const JSInternalPromise = @import("./bindings/JSInternalPromise.zig").JSInternalPromise;
pub const JSMap = @import("./bindings/JSMap.zig").JSMap;
pub const JSModuleLoader = @import("./bindings/JSModuleLoader.zig").JSModuleLoader;
pub const JSObject = @import("./bindings/JSObject.zig").JSObject;
pub const JSPromise = @import("./bindings/JSPromise.zig").JSPromise;
pub const JSPromiseRejectionOperation = @import("./bindings/JSPromiseRejectionOperation.zig").JSPromiseRejectionOperation;
pub const JSRef = @import("./bindings/JSRef.zig").JSRef;
pub const JSString = @import("./bindings/JSString.zig").JSString;
pub const JSUint8Array = @import("./bindings/JSUint8Array.zig").JSUint8Array;
pub const JSBigInt = @import("./bindings/JSBigInt.zig").JSBigInt;
pub const RefString = @import("./jsc/RefString.zig");
pub const ScriptExecutionStatus = @import("./bindings/ScriptExecutionStatus.zig").ScriptExecutionStatus;
pub const SourceType = @import("./bindings/SourceType.zig").SourceType;
pub const Strong = @import("./Strong.zig");
pub const SystemError = @import("./bindings/SystemError.zig").SystemError;
pub const URL = @import("./bindings/URL.zig").URL;
pub const URLSearchParams = @import("./bindings/URLSearchParams.zig").URLSearchParams;
pub const VM = @import("./bindings/VM.zig").VM;
pub const Weak = @import("./Weak.zig").Weak;
pub const WeakRefType = @import("./Weak.zig").WeakRefType;
pub const Exception = @import("./bindings/Exception.zig").Exception;
pub const SourceProvider = @import("./bindings/SourceProvider.zig").SourceProvider;
pub const TopExceptionScope = @import("./bindings/TopExceptionScope.zig").TopExceptionScope;
pub const ExceptionValidationScope = @import("./bindings/TopExceptionScope.zig").ExceptionValidationScope;
pub const MarkedArgumentBuffer = @import("./bindings/MarkedArgumentBuffer.zig").MarkedArgumentBuffer;
pub const RegularExpression = @import("./bindings/RegularExpression.zig").RegularExpression;

// JavaScript-related
pub const Errorable = @import("./bindings/Errorable.zig").Errorable;
pub const ResolvedSource = @import("./bindings/ResolvedSource.zig").ResolvedSource;
pub const ErrorCode = @import("./bindings/ErrorCode.zig").ErrorCode;
pub const JSErrorCode = @import("./bindings/JSErrorCode.zig").JSErrorCode;
pub const ZigErrorType = @import("./bindings/ZigErrorType.zig").ZigErrorType;
pub const Debugger = @import("./Debugger.zig");
pub const SavedSourceMap = @import("./SavedSourceMap.zig");
pub const VirtualMachine = @import("./VirtualMachine.zig");
pub const ModuleLoader = @import("./ModuleLoader.zig");
pub const RareData = @import("./rare_data.zig");
pub const EventType = @import("./bindings/EventType.zig").EventType;
pub const JSRuntimeType = @import("./bindings/JSRuntimeType.zig").JSRuntimeType;
pub const ZigStackFrameCode = @import("./bindings/ZigStackFrameCode.zig").ZigStackFrameCode;

pub const ErrorableResolvedSource = Errorable(ResolvedSource);
pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);
pub const ErrorableString = Errorable(bun.String);

pub const ZigStackTrace = @import("./bindings/ZigStackTrace.zig").ZigStackTrace;
pub const ZigStackFrame = @import("./bindings/ZigStackFrame.zig").ZigStackFrame;
pub const ZigStackFramePosition = @import("./bindings/ZigStackFramePosition.zig").ZigStackFramePosition;
pub const ZigException = @import("./bindings/ZigException.zig").ZigException;

pub const ConsoleObject = @import("./ConsoleObject.zig");
pub const Formatter = ConsoleObject.Formatter;

pub const hot_reloader = @import("./hot_reloader.zig");

// TODO: move into bun.api
pub const Jest = @import("./test/jest.zig");
pub const TestScope = @import("./test/jest.zig").TestScope;
pub const Expect = @import("./test/expect.zig");
pub const Snapshot = @import("./test/snapshot.zig");

pub const js_property_iterator = @import("./bindings/JSPropertyIterator.zig");
pub const JSPropertyIterator = js_property_iterator.JSPropertyIterator;
pub const JSPropertyIteratorOptions = js_property_iterator.JSPropertyIteratorOptions;

pub const EventLoop = @import("./event_loop.zig");
pub const AbstractVM = EventLoop.AbstractVM;
pub const AnyEventLoop = EventLoop.AnyEventLoop;
pub const AnyTask = EventLoop.AnyTask;
pub const AnyTaskWithExtraContext = EventLoop.AnyTaskWithExtraContext;
pub const ConcurrentCppTask = EventLoop.ConcurrentCppTask;
pub const ConcurrentPromiseTask = EventLoop.ConcurrentPromiseTask;
pub const ConcurrentTask = EventLoop.ConcurrentTask;
pub const CppTask = EventLoop.CppTask;
pub const DeferredTaskQueue = EventLoop.DeferredTaskQueue;
pub const EventLoopHandle = EventLoop.EventLoopHandle;
pub const EventLoopKind = EventLoop.EventLoopKind;
pub const EventLoopTask = EventLoop.EventLoopTask;
pub const EventLoopTaskPtr = EventLoop.EventLoopTaskPtr;
pub const GarbageCollectionController = EventLoop.GarbageCollectionController;
pub const JsVM = EventLoop.JsVM;
pub const ManagedTask = EventLoop.ManagedTask;
pub const MiniEventLoop = EventLoop.MiniEventLoop;
pub const MiniVM = EventLoop.MiniVM;
pub const PlatformEventLoop = if (bun.Environment.isPosix) bun.uws.Loop else bun.Async.Loop;
pub const PosixSignalHandle = EventLoop.PosixSignalHandle;
pub const PosixSignalTask = EventLoop.PosixSignalTask;
pub const Task = EventLoop.Task;
pub const WorkPool = EventLoop.WorkPool;
pub const WorkPoolTask = EventLoop.WorkPoolTask;
pub const WorkTask = EventLoop.WorkTask;

/// Deprecated: Avoid using this in new code.
pub const C = @import("./javascript_core_c_api.zig");
/// Deprecated: Remove all of these please.
pub const Sizes = @import("./bindings/sizes.zig");
/// Deprecated: Use `bun.String`
pub const ZigString = @import("./bindings/ZigString.zig").ZigString;
/// Deprecated: Use `bun.webcore`
pub const WebCore = bun.webcore;
/// Deprecated: Use `bun.api`
pub const API = bun.api;
/// Deprecated: Use `bun.api.node`
pub const Node = bun.api.node;

const log = bun.Output.scoped(.JSC, .hidden);
pub inline fn markBinding(src: std.builtin.SourceLocation) void {
    log("{s} ({s}:{d})", .{ src.fn_name, src.file, src.line });
}
pub inline fn markMemberBinding(comptime class: anytype, src: std.builtin.SourceLocation) void {
    if (!bun.Environment.enable_logs) return;
    const classname = switch (@typeInfo(@TypeOf(class))) {
        .pointer => class, // assumed to be a static string
        else => @typeName(class),
    };
    log("{s}.{s} ({s}:{d})", .{ classname, src.fn_name, src.file, src.line });
}

pub const Subprocess = bun.api.Subprocess;

/// This file is generated by:
///  1. `bun src/bun.js/scripts/generate-classes.ts`
///  2. Scan for **/*.classes.ts files in src/bun.js/src
///  3. Generate a JS wrapper for each class in:
///     - Zig: generated_classes.zig
///     - C++: ZigGeneratedClasses.h, ZigGeneratedClasses.cpp
///  4. For the Zig code to successfully compile:
///     - Add it to generated_classes_list.zig
///     - Expose the generated methods:
///       ```zig
///       pub const js = JSC.Codegen.JSMyClassName;
///       pub const toJS = js.toJS;
///       pub const fromJS = js.fromJS;
///       pub const fromJSDirect = js.fromJSDirect;
///       ```
///  5. `bun run build`
///
pub const Codegen = @import("ZigGeneratedClasses");
pub const GeneratedClassesList = @import("./bindings/generated_classes_list.zig").Classes;

pub const RuntimeTranspilerCache = @import("./RuntimeTranspilerCache.zig").RuntimeTranspilerCache;

/// Track whether an object should keep the event loop alive
pub const Ref = struct {
    has: bool = false,

    pub fn init() Ref {
        return .{};
    }

    pub fn unref(this: *Ref, vm: *VirtualMachine) void {
        if (!this.has)
            return;
        this.has = false;
        vm.active_tasks -= 1;
    }

    pub fn ref(this: *Ref, vm: *VirtualMachine) void {
        if (this.has)
            return;
        this.has = true;
        vm.active_tasks += 1;
    }
};

pub const OpaqueCallback = *const fn (current: ?*anyopaque) callconv(.c) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.c) void {
            const context: *Context = @as(*Context, @ptrCast(@alignCast(ctx.?)));
            Function(context);
        }
    }.callback;
}

pub const Error = @import("ErrorCode").Error;

/// According to https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date,
/// maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52).
pub const init_timestamp = std.math.maxInt(JSTimeType);
pub const JSTimeType = u52;
pub fn toJSTime(sec: isize, nsec: isize) JSTimeType {
    const millisec = @as(u64, @intCast(@divTrunc(nsec, std.time.ns_per_ms)));
    return @as(JSTimeType, @truncate(@as(u64, @intCast(sec * std.time.ms_per_s)) + millisec));
}

pub const MAX_SAFE_INTEGER = 9007199254740991;
pub const MIN_SAFE_INTEGER = -9007199254740991;

extern "c" fn JSCInitialize(env: [*]const [*:0]u8, count: usize, cb: *const fn ([*]const u8, len: usize) callconv(.c) void, eval_mode: bool) void;
fn onJSCInvalidEnvVar(name: [*]const u8, len: usize) callconv(.c) void {
    bun.Output.errGeneric(
        \\invalid JSC environment variable
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

pub const math = struct {
    extern "c" fn Bun__JSC__operationMathPow(f64, f64) f64;
    pub fn pow(x: f64, y: f64) f64 {
        return Bun__JSC__operationMathPow(x, y);
    }
};

pub const generated = @import("bindgen_generated");

const bun = @import("bun");
const std = @import("std");
