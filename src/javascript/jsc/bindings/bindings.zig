usingnamespace @import("./shared.zig");
usingnamespace @import("./headers.zig");
pub const Shimmer = @import("./shimmer.zig").Shimmer;
const hasRef = std.meta.trait.hasField("ref");

pub const JSObject = extern struct {
    pub const shim = Shimmer("JSC", "JSObject", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSObject.h>";
    pub const name = "JSC::JSObject";
    pub const namespace = "JSC";

    pub extern "c" fn putAtIndex(this: *JSObject, globalThis: *JSGlobalObject, property_name: *PropertyName, i: u32) bool;

    pub fn getArrayLength(this: *JSObject) usize {
        return cppFn("getArrayLength", .{
            this,
        });
    }

    pub fn getAtIndex(this: *JSObject, globalThis: *JSGlobalObject, property_name: *PropertyName, i: u32) JSValue {
        return cppFn("getAtIndex", .{
            this,
            property_name,
            i,
        });
    }

    pub const Extern = [_][]const u8{
        "getArrayLength",
        "getAtIndex",
        "putAtIndex",
    };
};

// pub const JSMap = extern struct {
//     pub const shim = Shimmer("JSC", "JSMap", @This());
//     bytes: shim.Bytes,
//     const cppFn = shim.cppFn;
//     pub const include = "<JavaScriptCore/JSMap.h>";
//     pub const name = "JSC::JSMap";
//     pub const namespace = "JSC";

//     pub const EntryIteratorCallback = fn (ctx: ?*c_void, container: JSValue, key: JSValue, value: JSValue) callconv(.C) bool;

//     pub fn get(this: *JSMap,globalThis: *JSGlobalObject) JSValue {
//         return cppFn("get", .{ this,globalThis });
//     }

//     pub fn set(this: *JSMap,globalThis: *JSGlobalObject, key: JSValue, value: JSValue) bool {
//         return cppFn("set", .{ this,globalThis, key, value });
//     }
//     pub fn clear(this: *JSMap,globalThis: *JSGlobalObject) void {
//         return cppFn("clear", .{
//             this,
//            globalThis,
//         });
//     }

//     // This is a JSValue so that we can use the same callback for iterating over different JSCell types.
//     pub fn forEach(this: JSValue,globalThis: *JSGlobalObject, ctx: ?*c_void, iterator: EntryIteratorCallback) void {
//         return cppFn("forEach", .{
//             this,
//            globalThis,
//             ctx,
//             iterator,
//         });
//     }
//     // pub fn iterator(this: *JSMap,globalThis: *JSGlobalObject) *JSMapIterator {}
//     pub fn delete(this: *JSMap,globalThis: *JSGlobalObject) bool {
//         return cppFn("delete", .{ this,globalThis });
//     }

//     pub fn has(this: *JSMap,globalThis: *JSGlobalObject) JSValue {
//         return cppFn("has", .{ this,globalThis });
//     }
//     pub fn size(this: *JSMap,globalThis: *JSGlobalObject) u32 {
//         return cppFn("size", .{ this,globalThis });
//     }

//     pub fn createglobalThis: *JSGlobalObject, size_hint: u32) *JSMap {
//         return cppFn("create", .{globalThis, size_hint });
//     }

//     pub fn clone(this: *JSMap,globalThis: *JSGlobalObject) *JSMap {
//         return cppFn("clone", .{ this,globalThis });
//     }

//     pub const Extern = [_][]const u8{ "get", "set", "clear", "delete", "has", "create", "size", "forEach", "clone" };
// };

pub const JSCell = extern struct {
    pub const shim = Shimmer("JSC", "JSCell", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSCell.h>";
    pub const name = "JSC::JSCell";
    pub const namespace = "JSC";

    const CellType = enum(u8) { _ };

    pub fn getObject(this: *JSCell) *JSObject {
        return shim.cppFn("getObject", .{this});
    }

    pub fn getString(this: *JSCell, globalObject: *JSGlobalObject) String {
        return shim.cppFn("getString", .{ this, globalObject });
    }

    pub fn getType(this: *JSCell) u8 {
        return shim.cppFn("getType", .{
            this,
        });
    }

    pub const Extern = [_][]const u8{ "getObject", "getString", "getType" };
};

pub const JSString = extern struct {
    pub const shim = Shimmer("JSC", "JSString", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSString.h>";
    pub const name = "JSC::JSString";
    pub const namespace = "JSC";

    pub fn toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject {
        return shim.cppFn("toObject", .{ this, global });
    }

    pub fn eql(this: *const JSString, global: *JSGlobalObject, other: *JSString) bool {
        return shim.cppFn("eql", .{ this, global, other });
    }

    pub extern fn value(ret_value: String, this: *JSString, globalObject: *JSGlobalObject) void;

    pub fn length(this: *const JSString) usize {
        return shim.cppFn("length", .{
            this,
        });
    }

    pub fn is8Bit(this: *const JSString) bool {
        return shim.cppFn("is8Bit", .{
            this,
        });
    }

    pub fn createFromOwnedString(vm: *VM, str: *const String) *JSString {
        return shim.cppFn("createFromOwnedString", .{
            vm, str,
        });
    }

    pub fn createFromString(vm: *VM, str: *const String) *JSString {
        return shim.cppFn("createFromString", .{
            vm, str,
        });
    }

    pub const Extern = [_][]const u8{ "toObject", "eql", "value", "length", "is8Bit", "createFromOwnedString", "createFromString" };
};

pub const JSPromiseRejectionOperation = enum(u32) {
    Reject = 0,
    Handle = 1,
};

pub const ScriptArguments = extern struct {
    pub const shim = Shimmer("Inspector", "ScriptArguments", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/ScriptArguments.h>";
    pub const name = "Inspector::ScriptArguments";
    pub const namespace = "Inspector";

    pub fn argumentAt(this: *const ScriptArguments, i: usize) JSValue {
        return cppFn("argumentAt", .{
            this,
            i,
        });
    }
    pub fn argumentCount(this: *const ScriptArguments) usize {
        return cppFn("argumentCount", .{
            this,
        });
    }
    pub fn getFirstArgumentAsString(this: *const ScriptArguments) String {
        return cppFn("getFirstArgumentAsString", .{
            this,
        });
    }

    pub fn isEqual(this: *const ScriptArguments, other: *const ScriptArguments) bool {
        return cppFn("isEqual", .{ this, other });
    }

    pub fn release(this: *ScriptArguments) void {
        return cppFn("release", .{this});
    }

    pub const Extern = [_][]const u8{
        "argumentAt",
        "argumentCount",
        "getFirstArgumentAsString",
        "isEqual",
        "release",
    };
};

pub fn NewGlobalObject(comptime Type: type) type {
    return struct {
        pub fn import(global: *JSGlobalObject, loader: *JSModuleLoader, specifier: *JSString, referrer: JSValue, origin: *const SourceOrigin) callconv(.C) *JSInternalPromise {
            if (comptime @hasDecl(Type, "import")) {
                return @call(.{ .modifier = .always_inline }, Interface.import, .{ global, loader, specifier, referrer, origin });
            }
            return JSInternalPromise.rejectedPromise(global, JSValue.jsUndefined());
        }
        const slice: []const u8 = "hello.js";
        pub fn resolve(global: *JSGlobalObject, loader: *JSModuleLoader, specifier: JSValue, value: JSValue, origin: *const SourceOrigin) callconv(.C) Identifier {
            if (comptime @hasDecl(Type, "resolve")) {
                return @call(.{ .modifier = .always_inline }, Interface.resolve, .{ global, loader, specifier, value, origin });
            }
            return Identifier.fromSlice(global.vm(), slice.ptr, slice.len);
        }
        pub fn fetch(global: *JSGlobalObject, loader: *JSModuleLoader, value1: JSValue, value2: JSValue, value3: JSValue) callconv(.C) *JSInternalPromise {
            if (comptime @hasDecl(Type, "fetch")) {
                return @call(.{ .modifier = .always_inline }, Interface.fetch, .{ global, loader, value1, value2, value3 });
            }
            return JSInternalPromise.rejectedPromise(global, JSValue.jsUndefined());
        }
        pub fn eval(global: *JSGlobalObject, loader: *JSModuleLoader, key: JSValue, moduleRecordValue: JSValue, scriptFetcher: JSValue, awaitedValue: JSValue, resumeMode: JSValue) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "eval")) {
                return @call(.{ .modifier = .always_inline }, Interface.eval, .{ global, loader, key, moduleRecordValue, scriptFetcher, awaitedValue, resumeMode });
            }
            return JSValue.jsUndefined();
        }
        pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "promiseRejectionTracker")) {
                return @call(.{ .modifier = .always_inline }, Interface.promiseRejectionTracker, .{ global, promise, rejection });
            }
            return JSValue.jsUndefined();
        }

        pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "reportUncaughtException")) {
                return @call(.{ .modifier = .always_inline }, Interface.reportUncaughtException, .{ global, exception });
            }
            return JSValue.jsUndefined();
        }

        pub fn createImportMetaProperties(global: *JSGlobalObject, loader: *JSModuleLoader, obj: JSValue, record: *JSModuleRecord, specifier: JSValue) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "createImportMetaProperties")) {
                return @call(.{ .modifier = .always_inline }, Interface.createImportMetaProperties, .{ global, loader, obj, record, specifier });
            }
            return JSValue.jsUndefined();
        }
    };
}

pub const JSModuleLoader = extern struct {
    pub const shim = Shimmer("JSC", "JSModuleLoader", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSModuleLoader.h>";
    pub const name = "JSC::JSModuleLoader";
    pub const namespace = "JSC";

    pub fn evaluate(globalObject: *JSGlobalObject, source_code: *const SourceCode, thisValue: JSValue, exception: *?*Exception) JSValue {
        return shim.cppFn("evaluate", .{
            globalObject,
            source_code,
            thisValue,
            exception,
        });
    }

    pub fn loadAndEvaluateModuleEntryPoint(globalObject: *JSGlobalObject, source_code: *const SourceCode) *JSInternalPromise {
        return shim.cppFn("loadAndEvaluateModuleEntryPoint", .{
            globalObject,
            source_code,
        });
    }

    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: *const String) *JSInternalPromise {
        return shim.cppFn("loadAndEvaluateModule", .{
            globalObject,
            module_name,
        });
    }

    pub fn importModule(globalObject: *JSGlobalObject, key: *const Identifier) *JSInternalPromise {
        return shim.cppFn("importModule", .{
            globalObject,
            key,
        });
    }

    pub fn linkAndEvaluateModule(globalObject: *JSGlobalObject, key: *const Identifier) JSValue {
        return shim.cppFn("linkAndEvaluateModule", .{
            globalObject,
            key,
        });
    }

    pub fn checkSyntax(globalObject: *JSGlobalObject, source_code: *const SourceCode, is_module: bool) bool {
        return shim.cppFn("checkSyntax", .{
            globalObject,
            source_code,
            is_module,
        });
    }

    // pub fn dependencyKeysIfEvaluated(this: *JSModuleLoader, globalObject: *JSGlobalObject, moduleRecord: *JSModuleRecord) *JSValue {
    //     return shim.cppFn("dependencyKeysIfEvaluated", .{ this, globalObject, moduleRecord });
    // }

    pub const Extern = [_][]const u8{
        // "dependencyKeysIfEvaluated",
        "evaluate",
        "loadAndEvaluateModuleEntryPoint",
        "loadAndEvaluateModule",
        "importModule",
        "linkAndEvaluateModule",
        "checkSyntax",
    };
};

pub const JSModuleRecord = extern struct {
    pub const shim = Shimmer("JSC", "JSModuleRecord", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSModuleRecord.h>";
    pub const name = "JSC::JSModuleRecord";
    pub const namespace = "JSC";

    pub fn sourceCode(this: *JSModuleRecord) SourceCode {
        return shim.cppFn("sourceCode", .{
            this,
        });
    }

    pub const Extern = [_][]const u8{
        "sourceCode",
    };
};

pub const JSPromise = extern struct {
    pub const shim = Shimmer("JSC", "JSPromise", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSPromise.h>";
    pub const name = "JSC::JSPromise";
    pub const namespace = "JSC";

    pub const Status = enum(u32) {
        Pending = 0, // Making this as 0, so that, we can change the status from Pending to others without masking.
        Fulfilled = 1,
        Rejected = 2,
    };

    pub fn status(this: *const JSPromise, vm: *VM) Status {
        return shim.cppFn("status", .{ this, vm });
    }
    pub fn result(this: *const JSPromise, vm: *VM) JSValue {
        return cppFn("result", .{ this, vm });
    }
    pub fn isHandled(this: *const JSPromise, vm: *VM) bool {
        return cppFn("isHandled", .{ this, vm });
    }

    pub fn rejectWithCaughtException(this: *JSPromise, globalObject: *JSGlobalObject, scope: ThrowScope) void {
        return cppFn("rejectWithCaughtException", .{ this, globalObject, scope });
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("resolvedPromise", .{ globalThis, value });
    }
    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("rejectedPromise", .{ globalThis, value });
    }

    pub fn resolve(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("resolve", .{ this, globalThis, value });
    }
    pub fn reject(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("reject", .{ this, globalThis, value });
    }
    pub fn rejectAsHandled(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("rejectAsHandled", .{ this, globalThis, value });
    }
    // pub fn rejectException(this: *JSPromise, globalThis: *JSGlobalObject, value: *Exception) void {
    //     cppFn("rejectException", .{ this, globalThis, value });
    // }
    pub fn rejectAsHandledException(this: *JSPromise, globalThis: *JSGlobalObject, value: *Exception) void {
        cppFn("rejectAsHandledException", .{ this, globalThis, value });
    }

    pub const Extern = [_][]const u8{
        "rejectWithCaughtException",
        "status",
        "result",
        "isHandled",
        "resolvedPromise",
        "rejectedPromise",
        "resolve",
        "reject",
        "rejectAsHandled",
        // "rejectException",
        "rejectAsHandledException",
    };
};

pub const JSInternalPromise = extern struct {
    pub const shim = Shimmer("JSC", "JSInternalPromise", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSInternalPromise.h>";
    pub const name = "JSC::JSInternalPromise";
    pub const namespace = "JSC";

    pub const Status = enum(u32) {
        Pending = 0, // Making this as 0, so that, we can change the status from Pending to others without masking.
        Fulfilled = 1,
        Rejected = 2,
    };

    pub fn status(this: *const JSInternalPromise, vm: *VM) Status {
        return shim.cppFn("status", .{ this, vm });
    }
    pub fn result(this: *const JSInternalPromise, vm: *VM) JSValue {
        return cppFn("result", .{ this, vm });
    }
    pub fn isHandled(this: *const JSInternalPromise, vm: *VM) bool {
        return cppFn("isHandled", .{ this, vm });
    }

    pub fn rejectWithCaughtException(this: *JSInternalPromise, globalObject: *JSGlobalObject, scope: ThrowScope) void {
        return cppFn("rejectWithCaughtException", .{ this, globalObject, scope });
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return cppFn("resolvedPromise", .{ globalThis, value });
    }
    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSInternalPromise {
        return cppFn("rejectedPromise", .{ globalThis, value });
    }

    pub fn resolve(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("resolve", .{ this, globalThis, value });
    }
    pub fn reject(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("reject", .{ this, globalThis, value });
    }
    pub fn rejectAsHandled(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        cppFn("rejectAsHandled", .{ this, globalThis, value });
    }
    // pub fn rejectException(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: *Exception) void {
    //     cppFn("rejectException", .{ this, globalThis, value });
    // }
    pub fn rejectAsHandledException(this: *JSInternalPromise, globalThis: *JSGlobalObject, value: *Exception) void {
        cppFn("rejectAsHandledException", .{ this, globalThis, value });
    }

    pub fn then(this: *JSInternalPromise, globalThis: *JSGlobalObject, resolvefunc: ?*JSFunction, rejectfunc: ?*JSFunction) *JSInternalPromise {
        return cppFn("then", .{ this, globalThis, resolvefunc, rejectfunc });
    }

    pub fn create(globalThis: *JSGlobalObject) *JSInternalPromise {
        return cppFn("create", .{globalThis});
    }

    pub const Extern = [_][]const u8{
        "create",
        "then",
        "rejectWithCaughtException",
        "status",
        "result",
        "isHandled",
        "resolvedPromise",
        "rejectedPromise",
        "resolve",
        "reject",
        "rejectAsHandled",
        // "rejectException",
        "rejectAsHandledException",
    };
};

// SourceProvider.h
pub const SourceType = enum(u8) {
    Program = 0,
    Module = 1,
    WebAssembly = 2,
};

pub const SourceOrigin = extern struct {
    pub const shim = Shimmer("JSC", "SourceOrigin", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/SourceOrigin.h>";
    pub const name = "JSC::SourceOrigin";
    pub const namespace = "JSC";

    pub fn fromURL(url: *const URL) SourceOrigin {
        return cppFn("fromURL", .{url});
    }

    pub const Extern = [_][]const u8{
        "fromURL",
    };
};

pub const SourceCode = extern struct {
    pub const shim = Shimmer("JSC", "SourceCode", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/SourceProvider.h>";
    pub const name = "JSC::SourceCode";
    pub const namespace = "JSC";

    pub fn fromString(result: *SourceCode, source: *const String, origin: ?*const SourceOrigin, filename: ?*String, source_type: SourceType) void {
        cppFn("fromString", .{ result, source, origin, filename, source_type });
    }

    pub const Extern = [_][]const u8{
        "fromString",
    };
};

pub const JSFunction = extern struct {
    pub const shim = Shimmer("JSC", "JSFunction", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSFunction.h>";
    pub const name = "JSC::JSFunction";
    pub const namespace = "JSC";

    pub const NativeFunctionCallback = fn (ctx: ?*c_void, global: *JSGlobalObject, call_frame: *CallFrame) callconv(.C) JSValue;

    pub fn createFromSourceCode(
        global: *JSGlobalObject,
        function_name: ?[*]const u8,
        function_name_len: u16,
        args: ?[*]JSValue,
        args_len: u16,
        source: *const SourceCode,
        origin: *SourceOrigin,
        exception: *?*JSObject,
    ) *JSFunction {
        return cppFn("createFromSourceCode", .{
            global,
            function_name,
            function_name_len,
            args,
            args_len,
            source,
            origin,
            exception,
        });
    }
    pub fn createFromNative(
        global: *JSGlobalObject,
        argument_count: u16,
        name_: ?*const String,
        ctx: ?*c_void,
        func: NativeFunctionCallback,
    ) *JSFunction {
        return cppFn("createFromNative", .{ global, argument_count, name_, ctx, func });
    }
    pub fn getName(this: *JSFunction, vm: *VM) String {
        return cppFn("getName", .{ this, vm });
    }
    pub fn displayName(this: *JSFunction, vm: *VM) String {
        return cppFn("displayName", .{ this, vm });
    }
    pub fn calculatedDisplayName(this: *JSFunction, vm: *VM) String {
        return cppFn("calculatedDisplayName", .{ this, vm });
    }
    pub fn toString(this: *JSFunction, globalThis: *JSGlobalObject) *const JSString {
        return cppFn("toString", .{ this, globalThis });
    }

    pub fn callWithArgumentsAndThis(
        function: JSValue,
        thisValue: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("callWithArgumentsAndThis", .{
            function,
            globalThis,
            thisValue,
            arguments_ptr,
            arguments_len,
            exception,
            error_message,
        });
    }

    pub fn callWithArguments(
        function: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("callWithArguments", .{ function, globalThis, arguments_ptr, arguments_len, exception, exception, error_message });
    }

    pub fn callWithThis(
        function: JSValue,
        globalThis: *JSGlobalObject,
        thisValue: JSValue,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("callWithArguments", .{
            function,
            globalThis,
            thisValue,
            exception,
            error_message,
        });
    }

    pub fn callWithoutAnyArgumentsOrThis(
        function: JSValue,
        globalThis: *JSGlobalObject,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("callWithoutAnyArgumentsOrThis", .{ function, globalThis, exception, exception, error_message });
    }

    pub fn constructWithArgumentsAndNewTarget(
        function: JSValue,
        newTarget: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("constructWithArgumentsAndNewTarget", .{
            function,
            globalThis,
            newTarget,
            arguments_ptr,
            arguments_len,
            exception,
            error_message,
        });
    }

    pub fn constructWithArguments(
        function: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("constructWithArguments", .{ function, globalThis, arguments_ptr, arguments_len, exception, exception, error_message });
    }

    pub fn constructWithNewTarget(
        function: JSValue,
        globalThis: *JSGlobalObject,
        newTarget: JSValue,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("constructWithArguments", .{
            function,
            globalThis,
            newTarget,
            exception,
            error_message,
        });
    }

    pub fn constructWithoutAnyArgumentsOrNewTarget(
        function: JSValue,
        globalThis: *JSGlobalObject,
        exception: *?*Exception,
        error_message: *const c_char,
    ) JSValue {
        return cppFn("constructWithoutAnyArgumentsOrNewTarget", .{ function, globalThis, exception, exception, error_message });
    }

    pub const Extern = [_][]const u8{
        "fromString",
        "createFromSourceCode",
        "createFromNative",
        "getName",
        "displayName",
        "calculatedDisplayName",
        "callWithArgumentsAndThis",
        "callWithArguments",
        "callWithThis",
        "callWithoutAnyArgumentsOrThis",
        "constructWithArgumentsAndNewTarget",
        "constructWithArguments",
        "constructWithNewTarget",
        "constructWithoutAnyArgumentsOrNewTarget",
    };
};

pub const JSGlobalObject = extern struct {
    pub const shim = Shimmer("JSC", "JSGlobalObject", @This());
    bytes: shim.Bytes,

    pub const include = "<JavaScriptCore/JSGlobalObject.h>";
    pub const name = "JSC::JSGlobalObject";
    pub const namespace = "JSC";

    pub const ErrorType = enum(u8) {
        Error = 0,
        EvalError = 1,
        RangeError = 2,
        ReferenceError = 3,
        SyntaxError = 4,
        TypeError = 5,
        URIError = 6,
        AggregateError = 7,
        OutOfMemoryError = 8,
    };

    // pub fn createError(globalObject: *JSGlobalObject, error_type: ErrorType, message: *String) *JSObject {
    //     return cppFn("createError", .{ globalObject, error_type, message });
    // }

    // pub fn throwError(
    //     globalObject: *JSGlobalObject,
    //     err: *JSObject,
    // ) *JSObject {
    //     return cppFn("throwError", .{
    //         globalObject,
    //         err,
    //     });
    // }

    const cppFn = shim.cppFn;

    pub fn objectPrototype(this: *JSGlobalObject) *ObjectPrototype {
        return cppFn("objectPrototype", .{this});
    }
    pub fn functionPrototype(this: *JSGlobalObject) *FunctionPrototype {
        return cppFn("functionPrototype", .{this});
    }
    pub fn arrayPrototype(this: *JSGlobalObject) *ArrayPrototype {
        return cppFn("arrayPrototype", .{this});
    }
    pub fn booleanPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("booleanPrototype", .{this});
    }
    pub fn stringPrototype(this: *JSGlobalObject) *StringPrototype {
        return cppFn("stringPrototype", .{this});
    }
    pub fn numberPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("numberPrototype", .{this});
    }
    pub fn bigIntPrototype(this: *JSGlobalObject) *BigIntPrototype {
        return cppFn("bigIntPrototype", .{this});
    }
    pub fn datePrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("datePrototype", .{this});
    }
    pub fn symbolPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("symbolPrototype", .{this});
    }
    pub fn regExpPrototype(this: *JSGlobalObject) *RegExpPrototype {
        return cppFn("regExpPrototype", .{this});
    }
    pub fn errorPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("errorPrototype", .{this});
    }
    pub fn iteratorPrototype(this: *JSGlobalObject) *IteratorPrototype {
        return cppFn("iteratorPrototype", .{this});
    }
    pub fn asyncIteratorPrototype(this: *JSGlobalObject) *AsyncIteratorPrototype {
        return cppFn("asyncIteratorPrototype", .{this});
    }
    pub fn generatorFunctionPrototype(this: *JSGlobalObject) *GeneratorFunctionPrototype {
        return cppFn("generatorFunctionPrototype", .{this});
    }
    pub fn generatorPrototype(this: *JSGlobalObject) *GeneratorPrototype {
        return cppFn("generatorPrototype", .{this});
    }
    pub fn asyncFunctionPrototype(this: *JSGlobalObject) *AsyncFunctionPrototype {
        return cppFn("asyncFunctionPrototype", .{this});
    }
    pub fn arrayIteratorPrototype(this: *JSGlobalObject) *ArrayIteratorPrototype {
        return cppFn("arrayIteratorPrototype", .{this});
    }
    pub fn mapIteratorPrototype(this: *JSGlobalObject) *MapIteratorPrototype {
        return cppFn("mapIteratorPrototype", .{this});
    }
    pub fn setIteratorPrototype(this: *JSGlobalObject) *SetIteratorPrototype {
        return cppFn("setIteratorPrototype", .{this});
    }
    pub fn mapPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("mapPrototype", .{this});
    }
    pub fn jsSetPrototype(this: *JSGlobalObject) *JSObject {
        return cppFn("jsSetPrototype", .{this});
    }
    pub fn promisePrototype(this: *JSGlobalObject) *JSPromisePrototype {
        return cppFn("promisePrototype", .{this});
    }
    pub fn asyncGeneratorPrototype(this: *JSGlobalObject) *AsyncGeneratorPrototype {
        return cppFn("asyncGeneratorPrototype", .{this});
    }
    pub fn asyncGeneratorFunctionPrototype(this: *JSGlobalObject) *AsyncGeneratorFunctionPrototype {
        return cppFn("asyncGeneratorFunctionPrototype", .{this});
    }

    pub fn vm(this: *JSGlobalObject) *VM {
        return cppFn("vm", .{this});
    }

    pub const Extern = [_][]const u8{
        "objectPrototype",
        "functionPrototype",
        "arrayPrototype",
        "booleanPrototype",
        "stringPrototype",
        "numberPrototype",
        "bigIntPrototype",
        "datePrototype",
        "symbolPrototype",
        "regExpPrototype",
        "errorPrototype",
        "iteratorPrototype",
        "asyncIteratorPrototype",
        "generatorFunctionPrototype",
        "generatorPrototype",
        "asyncFunctionPrototype",
        "arrayIteratorPrototype",
        "mapIteratorPrototype",
        "setIteratorPrototype",
        "mapPrototype",
        "jsSetPrototype",
        "promisePrototype",
        "asyncGeneratorPrototype",
        "asyncGeneratorFunctionPrototype",
        "vm",
        // "createError",
        // "throwError",
    };
};

fn _JSCellStub(comptime str: []const u8) type {
    if (is_bindgen) {
        return opaque {
            pub const name = "JSC::" ++ str ++ "";
        };
    } else {
        return opaque {};
    }
}

fn _Wundle(comptime str: []const u8) type {
    if (is_bindgen) {
        return opaque {
            pub const name = "Wundle::" ++ str ++ "";
        };
    } else {
        return opaque {};
    }
}

fn _WTF(comptime str: []const u8) type {
    if (is_bindgen) {
        return opaque {
            pub const name = "WTF::" ++ str ++ "";
        };
    } else {
        return opaque {};
    }
}

pub const URL = extern struct {
    pub const shim = Shimmer("WTF", "URL", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<wtf/URL.h>";
    pub const name = "WTF::URL";
    pub const namespace = "WTF";

    pub fn fromString(base: String, relative: String) URL {
        return cppFn("fromString", .{ base, relative });
    }

    pub fn fromFileSystemPath(result: *URL, file_system_path: StringView) void {
        cppFn("fromFileSystemPath", .{ result, file_system_path });
    }

    pub fn isEmpty(this: *const URL) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn isValid(this: *const URL) bool {
        return cppFn("isValid", .{this});
    }

    pub fn protocol(this: *URL) StringView {
        return cppFn("protocol", .{this});
    }
    pub fn encodedUser(this: *URL) StringView {
        return cppFn("encodedUser", .{this});
    }
    pub fn encodedPassword(this: *URL) StringView {
        return cppFn("encodedPassword", .{this});
    }
    pub fn host(this: *URL) StringView {
        return cppFn("host", .{this});
    }
    pub fn path(this: *URL) StringView {
        return cppFn("path", .{this});
    }
    pub fn lastPathComponent(this: *URL) StringView {
        return cppFn("lastPathComponent", .{this});
    }
    pub fn query(this: *URL) StringView {
        return cppFn("query", .{this});
    }
    pub fn fragmentIdentifier(this: *URL) StringView {
        return cppFn("fragmentIdentifier", .{this});
    }
    pub fn queryWithLeadingQuestionMark(this: *URL) StringView {
        return cppFn("queryWithLeadingQuestionMark", .{this});
    }
    pub fn fragmentIdentifierWithLeadingNumberSign(this: *URL) StringView {
        return cppFn("fragmentIdentifierWithLeadingNumberSign", .{this});
    }
    pub fn stringWithoutQueryOrFragmentIdentifier(this: *URL) StringView {
        return cppFn("stringWithoutQueryOrFragmentIdentifier", .{this});
    }
    pub fn stringWithoutFragmentIdentifier(this: *URL) String {
        return cppFn("stringWithoutFragmentIdentifier", .{this});
    }
    pub fn protocolHostAndPort(this: *URL) String {
        return cppFn("protocolHostAndPort", .{this});
    }
    pub fn hostAndPort(this: *URL) String {
        return cppFn("hostAndPort", .{this});
    }
    pub fn user(this: *URL) String {
        return cppFn("user", .{this});
    }
    pub fn password(this: *URL) String {
        return cppFn("password", .{this});
    }
    pub fn fileSystemPath(this: *URL) String {
        return cppFn("fileSystemPath", .{this});
    }

    pub fn setProtocol(this: *URL, protocol_value: StringView) void {
        return cppFn("setProtocol", .{ this, protocol_value });
    }
    pub fn setHost(this: *URL, host_value: StringView) void {
        return cppFn("setHost", .{ this, host_value });
    }
    pub fn setHostAndPort(this: *URL, host_and_port_value: StringView) void {
        return cppFn("setHostAndPort", .{ this, host_and_port_value });
    }
    pub fn setUser(this: *URL, user_value: StringView) void {
        return cppFn("setUser", .{ this, user_value });
    }
    pub fn setPassword(this: *URL, password_value: StringView) void {
        return cppFn("setPassword", .{ this, password_value });
    }
    pub fn setPath(this: *URL, path_value: StringView) void {
        return cppFn("setPath", .{ this, path_value });
    }
    pub fn setQuery(this: *URL, query_value: StringView) void {
        return cppFn("setQuery", .{ this, query_value });
    }

    pub fn truncatedForUseAsBase(
        this: *URL,
    ) URL {
        return cppFn("truncatedForUseAsBase", .{
            this,
        });
    }
    pub const Extern = [_][]const u8{ "fromFileSystemPath", "fromString", "isEmpty", "isValid", "protocol", "encodedUser", "encodedPassword", "host", "path", "lastPathComponent", "query", "fragmentIdentifier", "queryWithLeadingQuestionMark", "fragmentIdentifierWithLeadingNumberSign", "stringWithoutQueryOrFragmentIdentifier", "stringWithoutFragmentIdentifier", "protocolHostAndPort", "hostAndPort", "user", "password", "fileSystemPath", "setProtocol", "setHost", "setHostAndPort", "setUser", "setPassword", "setPath", "setQuery", "truncatedForUseAsBase" };
};

pub const String = extern struct {
    pub const shim = Shimmer("WTF", "String", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<wtf/text/WTFString.h>";
    pub const name = "WTF::String";
    pub const namespace = "WTF";

    pub fn createWithoutCopyingFromPtr(out: *String, str: [*c]const u8, len: usize) void {
        return cppFn("createWithoutCopyingFromPtr", .{ out, str, len });
    }

    pub fn createFromExternalString(str: ExternalStringImpl) String {
        return cppFn("createFromExternalString", .{
            str,
        });
    }

    pub fn createWithoutCopying(str: []const u8) String {
        var bytes = String{ .bytes = undefined };
        @call(.{ .modifier = .always_inline }, createWithoutCopyingFromPtr, .{ &bytes, str.ptr, str.len });
        return bytes;
    }

    pub fn is8Bit(this: *String) bool {
        return cppFn("is8Bit", .{this});
    }
    pub fn is16Bit(this: *String) bool {
        return cppFn("is16Bit", .{this});
    }
    pub fn isExternal(this: *String) bool {
        return cppFn("isExternal", .{this});
    }
    pub fn isStatic(this: *String) bool {
        return cppFn("isStatic", .{this});
    }
    pub fn isEmpty(this: *String) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn length(this: *String) usize {
        return cppFn("length", .{this});
    }
    pub fn characters8(this: *String) [*]const u8 {
        return cppFn("characters8", .{this});
    }
    pub fn characters16(this: *String) [*]const u16 {
        return cppFn("characters16", .{this});
    }

    pub fn eqlString(this: *String, other: *const String) bool {
        return cppFn("eqlString", .{ this, other });
    }

    pub fn eqlSlice(this: *String, other: [*]const u8, other_len: usize) bool {
        return cppFn("eqlSlice", .{ this, other, other_len });
    }

    pub fn impl(
        this: *String,
    ) *const StringImpl {
        return cppFn("impl", .{
            this,
        });
    }

    pub fn slice(this: *String) []const u8 {
        const len = this.length();
        return if (len > 0) this.characters8()[0..len] else "";
    }

    pub const Extern = [_][]const u8{
        "is8Bit",
        "is16Bit",
        "isExternal",
        "isStatic",
        "isEmpty",
        "length",
        "characters8",
        "characters16",
        "createWithoutCopyingFromPtr",
        "eqlString",
        "eqlSlice",
        "impl",
        "createFromExternalString",
    };
};

pub const JSValue = enum(i64) {
    _,

    pub const shim = Shimmer("JSC", "JSValue", @This());
    pub const is_pointer = false;
    pub const Type = i64;
    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/JSValue.h>";
    pub const name = "JSC::JSValue";
    pub const namespace = "JSC";

    pub fn jsNumber(number: anytype) JSValue {
        return switch (@TypeOf(number)) {
            f64 => @call(.{ .modifier = .always_inline }, jsNumberFromDouble, .{number}),
            u8 => @call(.{ .modifier = .always_inline }, jsNumberFromChar, .{number}),
            u16 => @call(.{ .modifier = .always_inline }, jsNumberFromU16, .{number}),
            i32 => @call(.{ .modifier = .always_inline }, jsNumberFromInt32, .{number}),
            i64 => @call(.{ .modifier = .always_inline }, jsNumberFromInt64, .{number}),
            u64 => @call(.{ .modifier = .always_inline }, jsNumberFromUint64, .{number}),
            else => @compileError("Type transformation missing for number of type: " ++ @typeName(@TypeOf(number))),
        };
    }

    pub fn jsNull() JSValue {
        return cppFn("jsNull", .{});
    }
    pub fn jsUndefined() JSValue {
        return cppFn("jsUndefined", .{});
    }
    pub fn jsTDZValue() JSValue {
        return cppFn("jsTDZValue", .{});
    }
    pub fn jsBoolean(i: bool) JSValue {
        return cppFn("jsBoolean", .{i});
    }
    pub fn jsDoubleNumber(i: f64) JSValue {
        return cppFn("jsDoubleNumber", .{i});
    }

    pub fn jsNumberFromDouble(i: f64) JSValue {
        return cppFn("jsNumberFromDouble", .{i});
    }
    pub fn jsNumberFromChar(i: u8) JSValue {
        return cppFn("jsNumberFromChar", .{i});
    }
    pub fn jsNumberFromU16(i: u16) JSValue {
        return cppFn("jsNumberFromU16", .{i});
    }
    pub fn jsNumberFromInt32(i: i32) JSValue {
        return cppFn("jsNumberFromInt32", .{i});
    }
    pub fn jsNumberFromInt64(i: i64) JSValue {
        return cppFn("jsNumberFromInt64", .{i});
    }
    pub fn jsNumberFromUint64(i: u64) JSValue {
        return cppFn("jsNumberFromUint64", .{i});
    }

    pub fn isUndefined(this: JSValue) bool {
        return cppFn("isUndefined", .{this});
    }
    pub fn isNull(this: JSValue) bool {
        return cppFn("isNull", .{this});
    }
    pub fn isUndefinedOrNull(this: JSValue) bool {
        return cppFn("isUndefinedOrNull", .{this});
    }
    pub fn isBoolean(this: JSValue) bool {
        return cppFn("isBoolean", .{this});
    }
    pub fn isAnyInt(this: JSValue) bool {
        return cppFn("isAnyInt", .{this});
    }
    pub fn isUInt32AsAnyInt(this: JSValue) bool {
        return cppFn("isUInt32AsAnyInt", .{this});
    }
    pub fn isInt32AsAnyInt(this: JSValue) bool {
        return cppFn("isInt32AsAnyInt", .{this});
    }
    pub fn isNumber(this: JSValue) bool {
        return cppFn("isNumber", .{this});
    }
    pub fn isError(this: JSValue) bool {
        return cppFn("isError", .{this});
    }
    pub fn isString(this: JSValue) bool {
        return cppFn("isString", .{this});
    }
    pub fn isBigInt(this: JSValue) bool {
        return cppFn("isBigInt", .{this});
    }
    pub fn isHeapBigInt(this: JSValue) bool {
        return cppFn("isHeapBigInt", .{this});
    }
    pub fn isBigInt32(this: JSValue) bool {
        return cppFn("isBigInt32", .{this});
    }
    pub fn isSymbol(this: JSValue) bool {
        return cppFn("isSymbol", .{this});
    }
    pub fn isPrimitive(this: JSValue) bool {
        return cppFn("isPrimitive", .{this});
    }
    pub fn isGetterSetter(this: JSValue) bool {
        return cppFn("isGetterSetter", .{this});
    }
    pub fn isCustomGetterSetter(this: JSValue) bool {
        return cppFn("isCustomGetterSetter", .{this});
    }
    pub fn isObject(this: JSValue) bool {
        return cppFn("isObject", .{this});
    }

    pub fn isCell(this: JSValue) bool {
        return cppFn("isCell", .{this});
    }

    pub fn asCell(this: JSValue) *JSCell {
        return cppFn("asCell", .{this});
    }

    pub fn isCallable(this: JSValue, vm: *VM) bool {
        return cppFn("isCallable", .{ this, vm });
    }

    // On exception, this returns the empty string.
    pub fn toString(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return cppFn("toString", .{ this, globalThis });
    }

    pub fn toWTFString(this: JSValue, globalThis: *JSGlobalObject) String {
        return cppFn("toWTFString", .{ this, globalThis });
    }

    // On exception, this returns null, to make exception checks faster.
    pub fn toStringOrNull(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return cppFn("toStringOrNull", .{ this, globalThis });
    }
    pub fn toPropertyKey(this: JSValue, globalThis: *JSGlobalObject) Identifier {
        return cppFn("toPropertyKey", .{ this, globalThis });
    }
    pub fn toPropertyKeyValue(this: JSValue, globalThis: *JSGlobalObject) JSValue {
        return cppFn("toPropertyKeyValue", .{ this, globalThis });
    }
    pub fn toObject(this: JSValue, globalThis: *JSGlobalObject) *JSObject {
        return cppFn("toObject", .{ this, globalThis });
    }

    pub fn getPrototype(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return cppFn("getPrototype", .{ this, globalObject });
    }

    pub fn eqlValue(this: JSValue, other: JSValue) bool {
        return cppFn("eqlValue", .{ this, other });
    }

    pub fn eqlCell(this: JSValue, other: *JSCell) bool {
        return cppFn("eqlCell", .{ this, other });
    }

    pub fn asString(this: JSValue) *JSString {
        return cppFn("asString", .{
            this,
        });
    }

    pub fn asObject(this: JSValue) JSObject {
        return cppFn("asObject", .{
            this,
        });
    }

    pub fn asNumber(this: JSValue) f64 {
        return cppFn("asNumber", .{
            this,
        });
    }

    pub const Extern = [_][]const u8{ "toWTFString", "hasProperty", "getPropertyNames", "getDirect", "putDirect", "get", "getIfExists", "asString", "asObject", "asNumber", "isError", "jsNull", "jsUndefined", "jsTDZValue", "jsBoolean", "jsDoubleNumber", "jsNumberFromDouble", "jsNumberFromChar", "jsNumberFromU16", "jsNumberFromInt32", "jsNumberFromInt64", "jsNumberFromUint64", "isUndefined", "isNull", "isUndefinedOrNull", "isBoolean", "isAnyInt", "isUInt32AsAnyInt", "isInt32AsAnyInt", "isNumber", "isString", "isBigInt", "isHeapBigInt", "isBigInt32", "isSymbol", "isPrimitive", "isGetterSetter", "isCustomGetterSetter", "isObject", "isCell", "asCell", "toString", "toStringOrNull", "toPropertyKey", "toPropertyKeyValue", "toObject", "toString", "getPrototype", "getPropertyByPropertyName", "eqlValue", "eqlCell", "isCallable" };
};

pub const PropertyName = extern struct {
    pub const shim = Shimmer("JSC", "PropertyName", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/PropertyName.h>";
    pub const name = "JSC::PropertyName";
    pub const namespace = "JSC";

    pub fn eqlToPropertyName(property_name: *PropertyName, other: *const PropertyName) bool {
        return cppFn("eqlToPropertyName", .{ property_name, other });
    }

    pub fn eqlToIdentifier(property_name: *PropertyName, other: *const Identifier) bool {
        return cppFn("eqlToIdentifier", .{ property_name, other });
    }

    pub fn publicName(property_name: *PropertyName) ?*const StringImpl {
        return cppFn("publicName", .{
            property_name,
        });
    }

    pub fn uid(property_name: *PropertyName) ?*const StringImpl {
        return cppFn("uid", .{
            property_name,
        });
    }

    pub const Extern = [_][]const u8{ "eqlToPropertyName", "eqlToIdentifier", "publicName", "uid" };
};

pub const Exception = extern struct {
    pub const shim = Shimmer("JSC", "Exception", @This());
    bytes: shim.Bytes,
    pub const Type = JSObject;
    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/Exception.h>";
    pub const name = "JSC::Exception";
    pub const namespace = "JSC";

    pub const StackCaptureAction = enum(u8) {
        CaptureStack = 0,
        DoNotCaptureStack = 1,
    };

    pub fn create(globalObject: *JSGlobalObject, object: *JSObject, stack_capture: StackCaptureAction) *Exception {
        return cppFn(
            "create",
            .{ globalObject, object, @enumToInt(stack_capture) },
        );
    }

    pub const Extern = [_][]const u8{
        "create",
    };
};

pub const JSLock = extern struct {
    pub const shim = Shimmer("JSC", "Exception", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/JSLock.h>";
    pub const name = "JSC::JSLock";
    pub const namespace = "JSC";

    pub fn lock(this: *JSLock) void {
        return cppFn("lock", .{this});
    }
    pub fn unlock(this: *JSLock) void {
        return cppFn("unlock", .{this});
    }

    pub const Extern = [_][]const u8{ "lock", "unlock" };
};

pub const VM = extern struct {
    pub const shim = Shimmer("JSC", "VM", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/VM.h>";
    pub const name = "JSC::VM";
    pub const namespace = "JSC";

    pub const HeapType = enum(u8) {
        SmallHeap = 0,
        LargeHeap = 1,
    };
    pub fn create(heap_type: HeapType) *VM {
        return cppFn("create", .{@enumToInt(heap_type)});
    }

    pub fn deinit(vm: *VM, global_object: *JSGlobalObject) void {
        return cppFn("deinit", .{ vm, global_object });
    }

    pub fn setExecutionForbidden(vm: *VM, forbidden: bool) void {
        cppFn("setExecutionForbidden", .{ vm, forbidden });
    }

    pub fn executionForbidden(vm: *VM) bool {
        return cppFn("executionForbidden", .{
            vm,
        });
    }

    pub fn isEntered(vm: *VM) bool {
        return cppFn("isEntered", .{
            vm,
        });
    }

    pub fn throwError(vm: *VM, global_object: *JSGlobalObject, scope: *ThrowScope, message: [*]const u8, len: usize) bool {
        return cppFn("throwError", .{
            vm,
            scope,
            global_object,

            message,
            len,
        });
    }

    pub fn apiLock(vm: *VM) *JSLock {
        return cppFn("apiLock", .{
            vm,
        });
    }

    pub fn drainMicrotasks(
        vm: *VM,
    ) void {
        return cppFn("drainMicrotasks", .{
            vm,
        });
    }

    pub const Extern = [_][]const u8{ "apiLock", "create", "deinit", "setExecutionForbidden", "executionForbidden", "isEntered", "throwError", "drainMicrotasks" };
};

pub const ThrowScope = extern struct {
    pub const shim = Shimmer("JSC", "ThrowScope", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/ThrowScope.h>";
    pub const name = "JSC::ThrowScope";
    pub const namespace = "JSC";

    pub fn declare(
        vm: *VM,
        function_name: [*]u8,
        file: [*]u8,
        line: usize,
    ) ThrowScope {
        return cppFn("declare", .{ vm, file, line });
    }

    pub fn release(this: *ThrowScope) void {
        return cppFn("release", .{this});
    }

    pub fn exception(this: *ThrowScope) ?*Exception {
        return cppFn("exception", .{this});
    }

    pub fn clearException(this: *ThrowScope) void {
        return cppFn("clearException", .{this});
    }

    pub const Extern = [_][]const u8{
        "declare",
        "release",
        "exception",
        "clearException",
    };
};

pub const CatchScope = extern struct {
    pub const shim = Shimmer("JSC", "CatchScope", @This());
    bytes: shim.Bytes,

    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/CatchScope.h>";
    pub const name = "JSC::CatchScope";
    pub const namespace = "JSC";

    pub fn declare(
        vm: *VM,
        function_name: [*]u8,
        file: [*]u8,
        line: usize,
    ) CatchScope {
        return cppFn("declare", .{ vm, file, line });
    }

    pub fn exception(this: *CatchScope) ?*Exception {
        return cppFn("exception", .{this});
    }

    pub fn clearException(this: *CatchScope) void {
        return cppFn("clearException", .{this});
    }

    pub const Extern = [_][]const u8{
        "declare",
        "exception",
        "clearException",
    };
};

pub const CallFrame = extern struct {
    pub const shim = Shimmer("JSC", "CallFrame", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/CallFrame.h>";
    pub const name = "JSC::CallFrame";
    pub const namespace = "JSC";

    pub inline fn argumentsCount(call_frame: *const CallFrame) usize {
        return cppFn("argumentsCount", .{
            call_frame,
        });
    }
    pub inline fn uncheckedArgument(call_frame: *const CallFrame, i: u16) JSValue {
        return cppFn("uncheckedArgument", .{ call_frame, i });
    }
    pub inline fn argument(call_frame: *const CallFrame, i: u16) JSValue {
        return cppFn("argument", .{
            call_frame,
        });
    }
    pub inline fn thisValue(call_frame: *const CallFrame) ?JSValue {
        return cppFn("thisValue", .{
            call_frame,
        });
    }

    pub inline fn setThisValue(call_frame: *CallFrame, new_this: JSValue) ?JSValue {
        return cppFn("setThisValue", .{
            call_frame,
            new_this,
        });
    }
    pub inline fn newTarget(call_frame: *const CallFrame) ?JSValue {
        return cppFn("newTarget", .{
            call_frame,
        });
    }

    pub inline fn setNewTarget(call_frame: *CallFrame, target: JSValue) ?JSValue {
        return cppFn("setNewTarget", .{
            call_frame,
            target,
        });
    }
    pub inline fn jsCallee(call_frame: *const CallFrame) *JSObject {
        return cppFn("jsCallee", .{
            call_frame,
        });
    }
    pub const Extern = [_][]const u8{ "argumentsCount", "uncheckedArgument", "argument", "thisValue", "newTarget", "jsCallee", "setNewTarget", "setThisValue" };
};

// pub const WellKnownSymbols = extern struct {
//     pub const shim = Shimmer("JSC", "CommonIdentifiers", @This());

//
//

//     pub const include = "<JavaScriptCore/CommonIdentifiers.h>";
//     pub const name = "JSC::CommonIdentifiers";
//     pub const namespace = "JSC";

//     pub var hasthis: *const Identifier = shim.cppConst(Identifier, "hasInstance");
//     pub var isConcatSpreadable: Identifier = shim.cppConst(Identifier, "isConcatSpreadable");
//     pub var asyncIterator: Identifier = shim.cppConst(Identifier, "asyncIterator");
//     pub var iterator: Identifier = shim.cppConst(Identifier, "iterator");
//     pub var match: Identifier = shim.cppConst(Identifier, "match");
//     pub var matchAll: Identifier = shim.cppConst(Identifier, "matchAll");
//     pub var replace: Identifier = shim.cppConst(Identifier, "replace");
//     pub var search: Identifier = shim.cppConst(Identifier, "search");
//     pub var species: Identifier = shim.cppConst(Identifier, "species");
//     pub var split: Identifier = shim.cppConst(Identifier, "split");
//     pub var toPrimitive: Identifier = shim.cppConst(Identifier, "toPrimitive");
//     pub var toStringTag: Identifier = shim.cppConst(Identifier, "toStringTag");
//     pub var unscopable: Identifier = shim.cppConst(Identifier, "unscopabl");

// };

pub const EncodedJSValue = enum(i64) {
    _,

    pub const shim = Shimmer("JSC", "EncodedJSValue", @This());

    pub const Type = u64;
    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/EncodedJSValue.h>";
    pub const name = "JSC::EncodedJSValue";
    pub const namespace = "JSC";
};

pub const Identifier = extern struct {
    pub const shim = Shimmer("JSC", "Identifier", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;

    pub const include = "<JavaScriptCore/Identifier.h>";
    pub const name = "JSC::Identifier";
    pub const namespace = "JSC";

    pub fn fromString(vm: *VM, other: *const String) Identifier {
        return cppFn("fromString", .{ vm, other });
    }

    pub fn fromSlice(vm: *VM, ptr: [*]const u8, len: usize) Identifier {
        return cppFn("fromSlice", .{ vm, ptr, len });
    }

    // pub fn fromUid(vm: *VM, other: *const StringImpl) Identifier {
    //     return cppFn("fromUid", .{ vm, other });
    // }

    pub fn deinit(this: *const Identifier) void {
        return cppFn("deinit", .{this});
    }

    pub fn toString(identifier: *const Identifier) String {
        return cppFn("toString", .{identifier});
    }

    pub fn length(identifier: *const Identifier) usize {
        return cppFn("length", .{identifier});
    }

    pub fn isNull(this: *const Identifier) bool {
        return cppFn("isNull", .{this});
    }
    pub fn isEmpty(this: *const Identifier) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn isSymbol(this: *const Identifier) bool {
        return cppFn("isSymbol", .{this});
    }
    pub fn isPrivateName(this: *const Identifier) bool {
        return cppFn("isPrivateName", .{this});
    }

    pub fn eqlIdent(this: *const Identifier, other: *const Identifier) bool {
        return cppFn("eqlIdent", .{ this, other });
    }

    pub fn neqlIdent(this: *const Identifier, other: *const Identifier) bool {
        return cppFn("neqlIdent", .{ this, other });
    }

    pub fn eqlStringImpl(this: *const Identifier, other: *const StringImpl) bool {
        return cppFn("eqlStringImpl", .{ this, other });
    }

    pub fn neqlStringImpl(this: *const Identifier, other: *const StringImpl) bool {
        return cppFn("neqlStringImpl", .{ this, other });
    }

    pub fn eqlUTF8(this: *const Identifier, other: [*]const u8, other_len: usize) bool {
        return cppFn("eqlUTF8", .{ this, other, other_len });
    }

    pub const Extern = [_][]const u8{
        "fromString",
        "fromSlice",
        // "fromUid",
        "deinit",
        "toString",
        "length",
        "isNull",
        "isEmpty",
        "isSymbol",
        "isPrivateName",
        "eqlIdent",
        "neqlIdent",
        "eqlStringImpl",
        "neqlStringImpl",
        "eqlUTF8",
    };
};

const DeinitFunction = fn (ctx: *c_void, buffer: [*]u8, len: usize) callconv(.C) void;

pub const StringImpl = extern struct {
    pub const shim = Shimmer("WTF", "StringImpl", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;

    pub const include = "<wtf/text/StringImpl.h>";
    pub const name = "WTF::StringImpl";
    pub const namespace = "WTF";

    pub fn is8Bit(this: *const StringImpl) bool {
        return cppFn("is8Bit", .{this});
    }
    pub fn is16Bit(this: *const StringImpl) bool {
        return cppFn("is16Bit", .{this});
    }
    pub fn isExternal(this: *const StringImpl) bool {
        return cppFn("isExternal", .{this});
    }
    pub fn isStatic(this: *const StringImpl) bool {
        return cppFn("isStatic", .{this});
    }
    pub fn isEmpty(this: *const StringImpl) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn length(this: *const StringImpl) usize {
        return cppFn("length", .{this});
    }
    pub fn characters8(this: *const StringImpl) [*]const u8 {
        return cppFn("characters8", .{this});
    }
    pub fn characters16(this: *const StringImpl) [*]const u16 {
        return cppFn("characters16", .{this});
    }

    pub const slice = SliceFn(@This());

    pub const Extern = [_][]const u8{
        "is8Bit",
        "is16Bit",
        "isExternal",
        "isStatic",
        "isEmpty",
        "length",
        "characters8",
        "characters16",
    };
};

pub const ExternalStringImpl = extern struct {
    pub const shim = Shimmer("WTF", "ExternalStringImpl", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;

    pub const include = "<wtf/text/ExternalStringImpl.h>";
    pub const name = "WTF::ExternalStringImpl";
    pub const namespace = "WTF";

    pub fn create(ptr: [*]const u8, len: usize, deinit: DeinitFunction) ExternalStringImpl {
        return cppFn("create", .{ ptr, len, deinit });
    }

    pub fn is8Bit(this: *const ExternalStringImpl) bool {
        return cppFn("is8Bit", .{this});
    }
    pub fn is16Bit(this: *const ExternalStringImpl) bool {
        return cppFn("is16Bit", .{this});
    }
    pub fn isEmpty(this: *const ExternalStringImpl) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn length(this: *const ExternalStringImpl) usize {
        return cppFn("length", .{this});
    }
    pub fn characters8(this: *const ExternalStringImpl) [*]const u8 {
        return cppFn("characters8", .{this});
    }
    pub fn characters16(this: *const ExternalStringImpl) [*]const u16 {
        return cppFn("characters16", .{this});
    }

    pub const Extern = [_][]const u8{
        "create",
        "is8Bit",
        "is16Bit",
        "isEmpty",
        "length",
        "characters8",
        "characters16",
    };
};

const _JSGlobalObject = _Wundle("JSGlobalObject");
const ObjectPrototype = _JSCellStub("ObjectPrototype");
const FunctionPrototype = _JSCellStub("FunctionPrototype");
const ArrayPrototype = _JSCellStub("ArrayPrototype");
const StringPrototype = _JSCellStub("StringPrototype");
const BigIntPrototype = _JSCellStub("BigIntPrototype");
const RegExpPrototype = _JSCellStub("RegExpPrototype");
const IteratorPrototype = _JSCellStub("IteratorPrototype");
const AsyncIteratorPrototype = _JSCellStub("AsyncIteratorPrototype");
const GeneratorFunctionPrototype = _JSCellStub("GeneratorFunctionPrototype");
const GeneratorPrototype = _JSCellStub("GeneratorPrototype");
const AsyncFunctionPrototype = _JSCellStub("AsyncFunctionPrototype");
const ArrayIteratorPrototype = _JSCellStub("ArrayIteratorPrototype");
const MapIteratorPrototype = _JSCellStub("MapIteratorPrototype");
const SetIteratorPrototype = _JSCellStub("SetIteratorPrototype");
const JSPromisePrototype = _JSCellStub("JSPromisePrototype");
const AsyncGeneratorPrototype = _JSCellStub("AsyncGeneratorPrototype");
const AsyncGeneratorFunctionPrototype = _JSCellStub("AsyncGeneratorFunctionPrototype");
pub fn SliceFn(comptime Type: type) type {
    const SliceStruct = struct {
        pub fn slice(this: *const Type) []const u8 {
            if (this.isEmpty()) {
                return "";
            }

            return this.characters8()[0..this.length()];
        }
    };

    return @TypeOf(SliceStruct.slice);
}

pub const StringView = extern struct {
    pub const shim = Shimmer("WTF", "StringView", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;

    pub const include = "<wtf/text/StringView.h>";
    pub const name = "WTF::StringView";
    pub const namespace = "WTF";

    pub fn from8Bit(view: *StringView, ptr: [*]const u8, len: usize) void {
        return cppFn("from8Bit", .{ view, ptr, len });
    }

    pub fn fromSlice(value: []const u8) StringView {
        var view = std.mem.zeroes(StringView);
        from8Bit(&view, value.ptr, value.len);
        return view;
    }

    pub fn is8Bit(this: *const StringView) bool {
        return cppFn("is8Bit", .{this});
    }
    pub fn is16Bit(this: *const StringView) bool {
        return cppFn("is16Bit", .{this});
    }
    pub fn isEmpty(this: *const StringView) bool {
        return cppFn("isEmpty", .{this});
    }
    pub fn length(this: *const StringView) usize {
        return cppFn("length", .{this});
    }
    pub fn characters8(this: *const StringView) [*]const u8 {
        return cppFn("characters8", .{this});
    }
    pub fn characters16(this: *const StringView) [*]const u16 {
        return cppFn("characters16", .{this});
    }

    pub const slice = SliceFn(@This());

    pub const Extern = [_][]const u8{
        "from8Bit",
        "is8Bit",
        "is16Bit",
        "isEmpty",
        "length",
        "characters8",
        "characters16",
    };
};

pub const Cpp = struct {
    pub const Function = fn (
        globalObject: *JSGlobalObject,
        callframe: CallFrame,
    ) callconv(.C) JSValue;
    pub const Getter = fn (
        ctx: ?*c_void,
        globalObject: *JSGlobalObject,
        this: EncodedJSValue,
        propertyName: PropertyName,
    ) callconv(.C) JSValue;
    pub const Setter = fn (
        ctx: ?*c_void,
        globalObject: *JSGlobalObject,
        this: JSValue,
        value: JSValue,
        propertyName: PropertyName,
    ) callconv(.C) bool;

    pub const Tag = enum {
        Callback,
        Constructor,
        Attribute,
        Static,
    };

    pub const Attribute = struct {
        getter: ?StaticExport = null,
        setter: ?StaticExport = null,
        read_only: bool = false,
        enumerable: bool = false,
    };

    pub const Static = union {
        String: []const u8,
        Number: u16,
    };

    pub const Callback = StaticExport;

    pub const LUTType = enum {
        Function,
        Accessor,
        CellProperty,
        ClassStructure,
        PropertyCallback,
    };

    pub const LUTFlag = enum {
        Enum,
        DontEnum,
        ReadOnly,
    };

    pub const Property = struct {
        name: []const u8,
        read_only: bool = false,
        enumerable: bool = false,
        value: Value,
        pub const Value = union(Tag) {
            Callback: StaticExport,
            Constructor: StaticExport,
            Attribute: Attribute,
            Static: Static,
        };
    };

    pub const Subclass = enum {
        JSNonFinalObject,
        JSObject,
    };

    pub const InitCallback = fn (*c_void, *VM, *JSGlobalObject) void;
    pub const ClassDefinition = struct {
        name: []const u8,
        subclass: Subclass,
        statics: []Property,
        init: StaticExport,
        free: StaticExport,
        Ctx: type,

        pub fn printer(h: std.fs.File.Writer, cpp: std.fs.File.Writer, comptime Type: type, comptime ZigType: type, comptime Prototype_: ?type, comptime Properties: []Property, comptime use_lut: bool) !void {
            var instanceName = comptime Type.name;
            instanceName[0] = comptime std.ascii.toLower(instanceName[0]);
            const fields = comptime .{
                .TypeName = Type.name,
                .instanceName = instanceName,
            };
            try h.print(
                \\#pragma once
                \\
                \\#include "root.h"
                \\#include "headers.h"
                \\
                \\namespace Zig {{
                \\
                \\  class {[TypeName][s]} : public JSC::JSNonFinalObject {{
                \\      using Base = JSC::JSNonFinalObject;
                \\      static {s}* create(JSC::Structure* structure, JSC::JSGlobalThis* globalObject)
                \\      {{
                \\          {[TypeName][s]}* ptr = new (NotNull, JSC::allocateCell<{s}>(globalObject->vm().heap)) {[TypeName][s]}(structure, *globalObject);
                \\          ptr->finishCreation(globalObject->vm());
                \\          return ptr;
                \\      }}
                \\
                \\      static {s}* create(JSC::Structure* structure, JSC::JSGlobalThis* globalObject, void* zigBase)
                \\      {{
                \\          {[TypeName][s]}* ptr = new (NotNull, JSC::allocateCell<{s}>(globalObject->vm().heap)) {[TypeName][s]}(structure, *globalObject);
                \\          ptr->finishCreation(globalObject->vm(), zigBase);
                \\          return ptr;
                \\      }}
            ,
                fields,
            );

            try cpp.print(
                \\#pragma once
                \\
                \\#include "root.h"
                \\#include "headers.h"
                \\#include {[TypeName][s]}.h
                \\
            , fields);

            inline for (Properties) |property| {
                switch (comptime property.value) {
                    .Callback => |Callback| {
                        try cpp.print("static JSC_DECLARE_HOST_FUNCTION({s});\n", .{Callback.wrappedName()});
                    },
                    .Constructor => |Constructor| {
                        try cpp.print("static JSC_DECLARE_HOST_FUNCTION({s});\n", .{Callback.wrappedName()});
                    },
                    .Attribute => |Attribute| {
                        try cpp.print("    ");
                        if (Attribute.getter) |getter| {
                            try cpp.print("static JSC_DECLARE_CUSTOM_GETTER({s});\n", .{Callback.wrappedName()});
                        }

                        if (comptime Attribute.setter) |setter| {
                            try cpp.print("static JSC_DECLARE_CUSTOM_SETTER({s});\n", .{Callback.wrappedName()});
                        }
                        try cpp.writeAll("    ");
                    },
                    .Static => |Static| {},
                }
            }

            if (comptime use_lut) {
                try cpp.print(
                    \\namespace Zig {
                    \\  #include {[TypeName][s]}.lut.h
                    \\}
                    \\
                    \\ /* Source for {[TypeName][s]}.lut.h */
                    \\   @begin {[instanceName][s]}Table
                ,
                    fields,
                );

                inline for (Properties) |property| {
                    try cpp.writeAll("  ");
                    try cpp.writeAll(comptime property.name);
                    try cpp.writeAll("  ");
                    switch (comptime property.value) {
                        .Callback => |Callback| {
                            try cpp.writeAll("    ");
                            try cpp.writeAll(comptime Callback.wrappedName());
                            try cpp.writeAll("    ");
                        },
                        .Constructor => |Constructor| {
                            try cpp.writeAll("    ");
                            try cpp.writeAll(comptime Constructor.wrappedName());
                            try cpp.writeAll("    ");
                        },
                        .Attribute => |Attribute| {
                            try cpp.writeAll("    ");
                            if (Attribute.getter) |getter| {
                                try cpp.writeAll(comptime getter.wrappedName());
                                try cpp.writeAll("    ");
                            }

                            if (comptime Attribute.setter) |setter| {
                                @compileError("Unsupported setter on " ++ Type.name);
                            }
                            try cpp.writeAll("    ");
                        },
                        .Static => |Static| {},
                    }
                    var needs_or = false;
                    if (!property.enumerable) {
                        try cpp.writeAll("DontEnum");
                        needs_or = true;
                    }

                    if (needs_or) {
                        try cpp.writeAll("|");
                    }

                    switch (comptime property.value) {
                        .Callback => |Callback| {
                            const Fn: std.builtin.TypeInfo.Fn = comptime @typeInfo(Callback.Type).Fn;
                            try cpp.writeAll("Function {d}", .{Fn.args.len});
                        },
                        .Constructor => |Constructor| {
                            const Fn: std.builtin.TypeInfo.Fn = comptime @typeInfo(Callback.Type).Fn;
                            try cpp.writeAll("Function {d}", .{Fn.args.len});
                        },
                        .Attribute => |Attribute| {
                            try cpp.writeAll("    ");
                            if (Attribute.getter) |_| {
                                try cpp.writeAll("Accessor");
                                try cpp.writeAll("    ");
                            }

                            if (comptime Attribute.setter) |_| {
                                @compileError("Unsupported setter on " ++ Type.name);
                            }
                            try cpp.writeAll("    ");
                        },
                        .Static => |Static| {},
                    }
                    try cpp.writeAll("\n");
                }

                try cpp.writeAll("   @end\n");
                try cpp.print(
                    \\namespace Zig {{
                    \\
                    \\  const ClassInfo {s}::s_info = {{ "{[TypeName][s]}", &Base::s_info, &{[instanceName][s]}Table, nullptr, CREATE_METHOD_TABLE({[TypeName][s]}) }};
                    \\
                    \\}}
                    \\
                ,
                    fields,
                );
            } else {
                try cpp.print(
                    \\namespace Zig {{
                    \\
                    \\  const ClassInfo {[TypeName][s]}::s_info = {{ "{[TypeName][s]}", &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE({[TypeName][s]}) }};
                    \\
                    \\}}
                    \\
                , fields);
            }

            cpp.print(
                \\
                \\namespace Zig {{
                \\
                \\
                \\
                \\  class {[TypeName][s]} final : public JSC::JSNonFinalObject {{
                \\      using Base = JSC::JSNonFinalObject;
                \\
                \\      void {[TypeName][s]}::finishCreation(JSGlobalObject* globalObject, VM& vm) {{
                \\          Base::finishCreation(vm);
                \\          m_zigBase = {[InitFunctionSymbol]}(globalObject, vm);
                \\          reifyStaticProperties(vm, {[TypeName][s]}::info(), &{[instanceName][s]}Table, *this);
                \\          JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
                \\      }}
                \\
                \\      void {[TypeName][s]}::finishCreation(JSGlobalObject* globalObject, VM& vm, void* zigBase) {{
                \\          Base::finishCreation(vm);
                \\          m_zigBase = zigBase;
                \\          reifyStaticProperties(vm, {[TypeName][s]}::info(), &{[instanceName][s]}Table, *this);
                \\          JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
                \\      }}
                \\
                \\
            ,
                fields,
            );

            inline for (Properties) |property| {
                switch (comptime property.value) {
                    .Callback => |Callback| {
                        try cpp.writeAll(
                            \\JSC_DEFINE_HOST_FUNCTION({[Wrapped][s]}, (JSGlobalObject* globalObject, CallFrame* callFrame))
                            \\{{
                            \\  VM& vm = globalObject->vm();
                            \\  auto scope = DECLARE_THROW_SCOPE(vm);
                            \\  auto* thisValue = JSC::jsDynamic<{[TypeName][s]}*>(callFrame->thisValue());
                            \\  if (UNLIKELY(!thisValue || !thisValue.m_zigBase)) {{
                            \\      return JSC::throwVMTypeError(globalObject, scope);
                            \\  }}
                            \\
                            \\  RELEASE_AND_RETURN(scope, {[Fn][s]}(thisValue.m__zigType, vm, this, globalObject, callFrame, scope));
                            \\}}
                            \\
                        , .{
                            .Wrapped = Callback.wrappedName(),
                            .Fn = Callback.symbol_name,
                            .TypeName = Type.name,
                        });
                    },
                    .Constructor => |Constructor| {
                        try cpp.writeAll(
                            \\JSC_DEFINE_HOST_FUNCTION({[Wrapped][s]}, (JSGlobalObject* globalObject, CallFrame* callFrame))
                            \\{{
                            \\  VM& vm = globalObject->vm();
                            \\  auto scope = DECLARE_THROW_SCOPE(vm);
                            \\  RELEASE_AND_RETURN(scope, {[Fn][s]}(globalObject, vm, callFrame, scope));
                            \\}}
                            \\
                        , .{
                            .Wrapped = Constructor.wrappedName(),
                            .Fn = Constructor.symbol_name,
                            .TypeName = Type.name,
                        });
                    },
                    .Attribute => |Attribute| {
                        try cpp.writeAll("    ");
                        if (Attribute.getter) |getter| {
                            try cpp.print(
                                \\JSC_DEFINE_CUSTOM_GETTER({s}, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName attributeName)
                                \\{{
                                \\    auto& vm = JSC::getVM(&lexicalGlobalObject);
                                \\    auto throwScope = DECLARE_THROW_SCOPE(vm);
                                \\}}
                            , .{Callback.wrappedName()});
                        }

                        if (comptime Attribute.setter) |setter| {
                            try cpp.print(
                                \\JSC_DEFINE_CUSTOM_SETTER({s}, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName attributeName)
                                \\{{
                                \\
                                \\}}
                            , .{Callback.wrappedName()});
                        }
                        try cpp.writeAll("    ");
                    },
                    .Static => |Static| {},
                }
            }

            if (Prototype_) |Prototype| {
                h.print(
                    \\
                    \\
                    \\
                    \\
                ,
                    fields,
                );
            } else {}

            h.print(
                \\      static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype) {{
                \\        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
                \\      }}
                \\
                \\      EXPORT_DECLARE_INFO;
                \\
                \\      template<typename, JSC::SubspaceAccess mode> static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
                \\      {{
                \\          if constexpr (mode == JSC::SubspaceAccess::Concurrently)
                \\              return nullptr;
                \\           return &vm.plainObjectSpace;
                \\      }}
                \\  private:
                \\      {[TypeName][s]}(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure) {{
                \\          m_zigBase = nullptr;
                \\      }}
                \\      void finishCreation(VM&);
                \\      void* m_zigBase;
                \\
                \\}}
                \\
                \\
                \\
            ,
                fields,
            );
        }

        //     pub fn generateShimType(comptime Parent: type, comptime _name: []const u8, comptime static_properties: anytype) type {
        //         const Base = struct {
        //             const BaseType = @This();

        //             bytes: shim.Bytes,
        //             const cppFn = shim.cppFn;

        //             pub const include = "Zig__" ++ _name;
        //             pub const name = "Zig::" ++ _name;
        //             pub const namespace = "Zig";

        //             pub const shim = comptime Shimmer(namespace, name, BaseType);

        //             pub fn create(global: *JSGlobalObject, parent: *Parent) JSValue {}

        //             pub fn getZigType(this: *BaseType, global: *JSGlobalObject) JSValue {}

        //             pub fn finalize(this: *BaseType, global: *JSGlobalObject) JSValue {}
        //         };
        //     }
    };
};

pub usingnamespace @import("exports.zig");

pub const Callback = struct {
    // zig: Value,
};
