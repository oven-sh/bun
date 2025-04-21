//! Bindings to JavaScriptCore and other JavaScript primatives such as
//! VirtualMachine, JSGlobalObject (Zig::GlobalObject), and the event loop.
//!
//! Web and runtime-specific APIs should go in `bun.webcore` and `bun.api`.
//!
//! TODO: Remove remaining aliases to `webcore` and `api`

/// The calling convention used for JavaScript functions <> Native
pub const conv = if (bun.Environment.isWindows and bun.Environment.isX64)
    std.builtin.CallingConvention.SysV
else
    std.builtin.CallingConvention.C;

/// Web Template Framework
pub const wtf = @import("bindings/WTF.zig").WTF;

/// Binding for JSCInitialize in ZigGlobalObject.cpp
pub fn initialize(eval_mode: bool) void {
    markBinding(@src());
    bun.analytics.Features.jsc += 1;
    JSCInitialize(std.os.environ.ptr, std.os.environ.len, onJSCInvalidEnvVar, eval_mode);
}

pub const JSValue = @import("bindings/JSValue.zig").JSValue;

// Host functions are the native function pointer type that can be used by a
// JSC::JSFunction to call native code from JavaScript. To allow usage of `try`
// for error handling, Bun provides toJSHostFn to wrap JSHostFnZig into JSHostFn.
pub const host_fn = @import("jsc/host_fn.zig");
pub const JSHostFn = host_fn.JSHostFn;
pub const JSHostFnZig = host_fn.JSHostFnZig;
pub const JSHostFnZigWithContext = host_fn.JSHostFnZigWithContext;
pub const JSHostFunctionTypeWithContext = host_fn.JSHostFunctionTypeWithContext;
pub const toJSHostFn = host_fn.toJSHostFn;
pub const toJSHostFnWithContext = host_fn.toJSHostFnWithContext;
pub const toJSHostValue = host_fn.toJSHostValue;
pub const createCallback = host_fn.createCallback;

// JSC Classes Bindings
pub const AnyPromise = @import("bindings/AnyPromise.zig").AnyPromise;
pub const array_buffer = @import("jsc/array_buffer.zig");
pub const ArrayBuffer = array_buffer.ArrayBuffer;
pub const MarkedArrayBuffer = array_buffer.MarkedArrayBuffer;
pub const CachedBytecode = @import("bindings/CachedBytecode.zig").CachedBytecode;
pub const CallFrame = @import("bindings/CallFrame.zig").CallFrame;
pub const CommonAbortReason = @import("bindings/CommonAbortReason.zig").CommonAbortReason;
pub const CommonStrings = @import("bindings/CommonStrings.zig").CommonStrings;
pub const CustomGetterSetter = @import("bindings/CustomGetterSetter.zig").CustomGetterSetter;
pub const DOMFormData = @import("bindings/DOMFormData.zig").DOMFormData;
pub const DOMURL = @import("bindings/DOMURL.zig").DOMURL;
pub const DeferredError = @import("bindings/DeferredError.zig").DeferredError;
pub const EncodedJSValue = @import("bindings/EncodedJSValue.zig").EncodedJSValue;
pub const GetterSetter = @import("bindings/GetterSetter.zig").GetterSetter;
pub const JSArray = @import("bindings/JSArray.zig").JSArray;
pub const JSArrayIterator = @import("bindings/JSArrayIterator.zig").JSArrayIterator;
pub const JSCell = @import("bindings/JSCell.zig").JSCell;
pub const JSFunction = @import("bindings/JSFunction.zig").JSFunction;
pub const JSGlobalObject = @import("bindings/JSGlobalObject.zig").JSGlobalObject;
pub const JSInternalPromise = @import("bindings/JSInternalPromise.zig").JSInternalPromise;
pub const JSMap = @import("bindings/JSMap.zig").JSMap;
pub const JSModuleLoader = @import("bindings/JSModuleLoader.zig").JSModuleLoader;
pub const JSObject = @import("bindings/JSObject.zig").JSObject;
pub const JSPromise = @import("bindings/JSPromise.zig").JSPromise;
pub const JSPromiseRejectionOperation = @import("bindings/JSPromiseRejectionOperation.zig").JSPromiseRejectionOperation;
pub const JSRef = @import("bindings/JSRef.zig").JSRef;
pub const JSString = @import("bindings/JSString.zig").JSString;
pub const JSUint8Array = @import("bindings/JSUint8Array.zig").JSUint8Array;
pub const RefString = @import("jsc/RefString.zig");
pub const ScriptExecutionStatus = @import("bindings/ScriptExecutionStatus.zig").ScriptExecutionStatus;
pub const SourceType = @import("bindings/SourceType.zig").SourceType;
pub const Strong = @import("Strong.zig");
pub const SystemError = @import("bindings/SystemError.zig").SystemError;
pub const URL = @import("bindings/URL.zig").URL;
pub const URLSearchParams = @import("bindings/URLSearchParams.zig").URLSearchParams;
pub const VM = @import("bindings/VM.zig").VM;
pub const Weak = @import("Weak.zig").Weak;
pub const WeakRefType = @import("Weak.zig").WeakRefType;
pub const Exception = @import("bindings/Exception.zig").Exception;
pub const SourceProvider = @import("bindings/SourceProvider.zig").SourceProvider;

// JavaScript-related
pub const Errorable = @import("bindings/Errorable.zig").Errorable;
pub const ResolvedSource = @import("bindings/ResolvedSource.zig").ResolvedSource;
pub const ErrorCode = @import("bindings/ErrorCode.zig").ErrorCode;
pub const JSErrorCode = @import("bindings/JSErrorCode.zig").JSErrorCode;
pub const ZigErrorType = @import("bindings/ZigErrorType.zig").ZigErrorType;
pub const Debugger = @import("Debugger.zig");
pub const SavedSourceMap = @import("SavedSourceMap.zig");
pub const VirtualMachine = @import("VirtualMachine.zig");
pub const ModuleLoader = @import("ModuleLoader.zig");
pub const RareData = @import("rare_data.zig");
pub const EventType = @import("bindings/EventType.zig").EventType;
pub const JSRuntimeType = @import("bindings/JSRuntimeType.zig").JSRuntimeType;
pub const ZigStackFrameCode = @import("bindings/ZigStackFrameCode.zig").ZigStackFrameCode;

pub const ErrorableResolvedSource = Errorable(ResolvedSource);
pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);
pub const ErrorableString = Errorable(bun.String);

pub const ZigStackTrace = @import("bindings/ZigStackTrace.zig").ZigStackTrace;
pub const ZigStackFrame = @import("bindings/ZigStackFrame.zig").ZigStackFrame;
pub const ZigStackFramePosition = @import("bindings/ZigStackFramePosition.zig").ZigStackFramePosition;
pub const ZigException = @import("bindings/ZigException.zig").ZigException;

pub const ConsoleObject = @import("ConsoleObject.zig");
pub const Formatter = ConsoleObject.Formatter;

pub const hot_reloader = @import("hot_reloader.zig");

// TODO: move into bun.api
pub const Jest = @import("test/jest.zig");
pub const TestScope = @import("test/jest.zig").TestScope;
pub const Expect = @import("test/expect.zig");
pub const Snapshot = @import("test/snapshot.zig");

pub const js_property_iterator = @import("bindings/JSPropertyIterator.zig");
pub const JSPropertyIterator = js_property_iterator.JSPropertyIterator;
pub const JSPropertyIteratorOptions = js_property_iterator.JSPropertyIteratorOptions;

const event_loop = @import("event_loop.zig");
pub const AbstractVM = event_loop.AbstractVM;
pub const AnyEventLoop = event_loop.AnyEventLoop;
pub const AnyTask = event_loop.AnyTask;
pub const AnyTaskWithExtraContext = event_loop.AnyTaskWithExtraContext;
pub const ConcurrentCppTask = event_loop.ConcurrentCppTask;
pub const ConcurrentPromiseTask = event_loop.ConcurrentPromiseTask;
pub const ConcurrentTask = event_loop.ConcurrentTask;
pub const CppTask = event_loop.CppTask;
pub const DeferredTaskQueue = event_loop.DeferredTaskQueue;
pub const EventLoop = event_loop.EventLoop;
pub const EventLoopHandle = event_loop.EventLoopHandle;
pub const EventLoopKind = event_loop.EventLoopKind;
pub const EventLoopTask = event_loop.EventLoopTask;
pub const EventLoopTaskPtr = event_loop.EventLoopTaskPtr;
pub const GarbageCollectionController = event_loop.GarbageCollectionController;
pub const JsVM = event_loop.JsVM;
pub const ManagedTask = event_loop.ManagedTask;
pub const MiniEventLoop = event_loop.MiniEventLoop;
pub const MiniVM = event_loop.MiniVM;
pub const PlatformEventLoop = if (bun.Environment.isPosix) bun.uws.Loop else bun.Async.Loop;
pub const PosixSignalHandle = event_loop.PosixSignalHandle;
pub const PosixSignalTask = event_loop.PosixSignalTask;
pub const Task = event_loop.Task;
pub const WorkPool = event_loop.WorkPool;
pub const WorkPoolTask = event_loop.WorkPoolTask;
pub const WorkTask = event_loop.WorkTask;

/// Deprecated: Use `bun.sys.Maybe`
pub const Maybe = bun.sys.Maybe;
/// Deprecated: Use the .fromAny() decl literal
pub const toJS = JSValue.fromAny;
/// Deprecated: Use the .jsBoolean() decl literal
pub const jsBoolean = JSValue.jsBoolean;
/// Deprecated: Use the .jsEmptyString() decl literal
pub const jsEmptyString = JSValue.jsEmptyString;
/// Deprecated: Use the .jsNumber() decl literal
pub const jsNumber = JSValue.jsNumber;
/// Deprecated: Avoid using this in new code.
pub const C = @import("javascript_core_c_api.zig");
/// Deprecated: Remove all of these please.
pub const Sizes = @import("bindings/sizes.zig");
/// Deprecated: Use `bun.String`
pub const ZigString = @import("bindings/ZigString.zig").ZigString;
/// Deprecated: Use `bun.webcore`
pub const WebCore = bun.webcore;
/// Deprecated: Use `bun.api`
pub const API = bun.api;
/// Deprecated: Use `bun.api.node`
pub const Node = bun.api.node;
/// Deprecated: use `bun.api.HTMLRewriter`
pub const Cloudflare = bun.api.HTMLRewriter;

const log = bun.Output.scoped(.JSC, true);
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
pub const GeneratedClassesList = @import("bindings/generated_classes_list.zig").Classes;

pub const RuntimeTranspilerCache = @import("RuntimeTranspilerCache.zig").RuntimeTranspilerCache;

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

pub const OpaqueCallback = *const fn (current: ?*anyopaque) callconv(.C) void;
pub fn OpaqueWrap(comptime Context: type, comptime Function: fn (this: *Context) void) OpaqueCallback {
    return struct {
        pub fn callback(ctx: ?*anyopaque) callconv(.C) void {
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

extern "c" fn JSCInitialize(env: [*]const [*:0]u8, count: usize, cb: *const fn ([*]const u8, len: usize) callconv(.C) void, eval_mode: bool) void;
fn onJSCInvalidEnvVar(name: [*]const u8, len: usize) callconv(.C) void {
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

const bun = @import("bun");
const std = @import("std");
