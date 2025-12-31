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
pub const wtf = @import("./jsc/interop/WTF.zig").WTF;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) void {
    markBinding(@src());
    bun.analytics.Features.jsc += 1;
    JSCInitialize(std.os.environ.ptr, std.os.environ.len, onJSCInvalidEnvVar, eval_mode);
}

pub const JSValue = @import("./jsc/types/JSValue.zig").JSValue;

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript. To allow usage of `try`
// for error handling, Bun provides toJSHostFn to wrap JSHostFnZig into JSHostFn.
pub const host_fn = @import("./jsc/interop/host_fn.zig");
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
pub const AnyPromise = @import("./jsc/types/AnyPromise.zig").AnyPromise;
pub const array_buffer = @import("./jsc/interop/array_buffer.zig");
pub const ArrayBuffer = array_buffer.ArrayBuffer;
pub const MarkedArrayBuffer = array_buffer.MarkedArrayBuffer;
pub const JSCArrayBuffer = array_buffer.JSCArrayBuffer;
pub const CachedBytecode = @import("./module/CachedBytecode.zig").CachedBytecode;
pub const CallFrame = @import("./jsc/types/CallFrame.zig").CallFrame;
pub const CommonAbortReason = @import("./web/events/CommonAbortReason.zig").CommonAbortReason;
pub const CommonStrings = @import("./jsc/types/CommonStrings.zig").CommonStrings;
pub const CustomGetterSetter = @import("./jsc/types/CustomGetterSetter.zig").CustomGetterSetter;
pub const DOMFormData = @import("./web/blob/DOMFormData.zig").DOMFormData;
pub const DOMURL = @import("./web/url/DOMURL.zig").DOMURL;
pub const DecodedJSValue = @import("./jsc/types/DecodedJSValue.zig").DecodedJSValue;
pub const DeferredError = @import("./api/error/DeferredError.zig").DeferredError;
pub const GetterSetter = @import("./jsc/types/GetterSetter.zig").GetterSetter;
pub const JSArray = @import("./jsc/types/JSArray.zig").JSArray;
pub const JSArrayIterator = @import("./jsc/types/JSArrayIterator.zig").JSArrayIterator;
pub const JSCell = @import("./jsc/types/JSCell.zig").JSCell;
pub const JSFunction = @import("./jsc/types/JSFunction.zig").JSFunction;
pub const JSGlobalObject = @import("./jsc/types/JSGlobalObject.zig").JSGlobalObject;
pub const JSInternalPromise = @import("./jsc/types/JSInternalPromise.zig").JSInternalPromise;
pub const JSMap = @import("./jsc/types/JSMap.zig").JSMap;
pub const JSModuleLoader = @import("./module/JSModuleLoader.zig").JSModuleLoader;
pub const JSObject = @import("./jsc/types/JSObject.zig").JSObject;
pub const JSPromise = @import("./jsc/types/JSPromise.zig").JSPromise;
pub const JSPromiseRejectionOperation = @import("./jsc/types/JSPromiseRejectionOperation.zig").JSPromiseRejectionOperation;
pub const JSRef = @import("./jsc/types/JSRef.zig").JSRef;
pub const JSString = @import("./jsc/types/JSString.zig").JSString;
pub const JSUint8Array = @import("./jsc/interop/JSUint8Array.zig").JSUint8Array;
pub const JSBigInt = @import("./jsc/types/JSBigInt.zig").JSBigInt;
pub const RefString = @import("./jsc/gc/RefString.zig");
pub const ScriptExecutionStatus = @import("./jsc/types/ScriptExecutionStatus.zig").ScriptExecutionStatus;
pub const SourceType = @import("./jsc/types/SourceType.zig").SourceType;
pub const Strong = @import("./jsc/gc/Strong.zig");
pub const SystemError = @import("./api/error/SystemError.zig").SystemError;
pub const URL = @import("./web/url/URL.zig").URL;
pub const URLSearchParams = @import("./web/url/URLSearchParams.zig").URLSearchParams;
pub const VM = @import("./jsc/types/VM.zig").VM;
pub const Weak = @import("./jsc/gc/Weak.zig").Weak;
pub const WeakRefType = @import("./jsc/gc/Weak.zig").WeakRefType;
pub const Exception = @import("./jsc/interop/Exception.zig").Exception;
pub const SourceProvider = @import("./jsc/types/SourceProvider.zig").SourceProvider;
pub const CatchScope = @import("./jsc/types/CatchScope.zig").CatchScope;
pub const ExceptionValidationScope = @import("./jsc/types/CatchScope.zig").ExceptionValidationScope;
pub const MarkedArgumentBuffer = @import("./jsc/types/MarkedArgumentBuffer.zig").MarkedArgumentBuffer;
pub const RegularExpression = @import("./core/RegularExpression.zig").RegularExpression;

// JavaScript-related
pub const Errorable = @import("./api/error/Errorable.zig").Errorable;
pub const ResolvedSource = @import("./jsc/types/ResolvedSource.zig").ResolvedSource;
pub const ErrorCode = @import("./api/error/ErrorCode.zig").ErrorCode;
pub const JSErrorCode = @import("./api/error/JSErrorCode.zig").JSErrorCode;
pub const ZigErrorType = @import("./api/error/ZigErrorType.zig").ZigErrorType;
pub const Debugger = @import("./api/inspector/Debugger.zig");
pub const SavedSourceMap = @import("./module/SavedSourceMap.zig");
pub const VirtualMachine = @import("./core/VirtualMachine.zig");
pub const ModuleLoader = @import("./module/ModuleLoader.zig");
pub const RareData = @import("./core/rare_data.zig");
pub const EventType = @import("./web/events/EventType.zig").EventType;
pub const JSRuntimeType = @import("./jsc/types/JSRuntimeType.zig").JSRuntimeType;
pub const ZigStackFrameCode = @import("./api/error/ZigStackFrameCode.zig").ZigStackFrameCode;

pub const ErrorableResolvedSource = Errorable(ResolvedSource);
pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);
pub const ErrorableString = Errorable(bun.String);

pub const ZigStackTrace = @import("./api/error/ZigStackTrace.zig").ZigStackTrace;
pub const ZigStackFrame = @import("./api/error/ZigStackFrame.zig").ZigStackFrame;
pub const ZigStackFramePosition = @import("./api/error/ZigStackFramePosition.zig").ZigStackFramePosition;
pub const ZigException = @import("./api/error/ZigException.zig").ZigException;

pub const ConsoleObject = @import("./api/console/ConsoleObject.zig");
pub const Formatter = ConsoleObject.Formatter;

pub const hot_reloader = @import("./core/hot_reloader.zig");

// Test runner (moved to src/test_runner/)
pub const Jest = @import("../test_runner/jest.zig");
pub const TestScope = @import("../test_runner/jest.zig").TestScope;
pub const Expect = @import("../test_runner/expect.zig");
pub const Snapshot = @import("../test_runner/snapshot.zig");

pub const js_property_iterator = @import("./jsc/types/JSPropertyIterator.zig");
pub const JSPropertyIterator = js_property_iterator.JSPropertyIterator;
pub const JSPropertyIteratorOptions = js_property_iterator.JSPropertyIteratorOptions;

pub const EventLoop = @import("./event_loop/event_loop.zig");
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
pub const C = @import("./jsc/interop/javascript_core_c_api.zig");
/// Deprecated: Remove all of these please.
pub const Sizes = @import("./jsc/interop/sizes.zig");
/// Deprecated: Use `bun.String`
pub const ZigString = @import("./jsc/interop/ZigString.zig").ZigString;
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
///  1. `bun src/buntime/scripts/generate-classes.ts`
///  2. Scan for **/*.classes.ts files in src/buntime/src
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
pub const GeneratedClassesList = @import("./jsc/generated/generated_classes_list.zig").Classes;

pub const RuntimeTranspilerCache = @import("./module/RuntimeTranspilerCache.zig").RuntimeTranspilerCache;

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
