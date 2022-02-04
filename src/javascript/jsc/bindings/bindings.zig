pub const Shimmer = @import("./shimmer.zig").Shimmer;
const std = @import("std");
const _global = @import("../../../global.zig");
const string = _global.string;
const Output = _global.Output;
const hasRef = std.meta.trait.hasField("ref");
const C_API = @import("../../../jsc.zig").C;
const StringPointer = @import("../../../api/schema.zig").Api.StringPointer;
const Exports = @import("./exports.zig");
const strings = _global.strings;
const ErrorableZigString = Exports.ErrorableZigString;
const ErrorableResolvedSource = Exports.ErrorableResolvedSource;
const ZigException = Exports.ZigException;
const ZigStackTrace = Exports.ZigStackTrace;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const ArrayBuffer = @import("../base.zig").ArrayBuffer;
pub const JSObject = extern struct {
    pub const shim = Shimmer("JSC", "JSObject", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSObject.h>";
    pub const name = "JSC::JSObject";
    pub const namespace = "JSC";

    pub fn getArrayLength(this: *JSObject) usize {
        return cppFn("getArrayLength", .{
            this,
        });
    }

    const InitializeCallback = fn (ctx: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void;
    pub fn create(global_object: *JSGlobalObject, length: usize, ctx: *anyopaque, initializer: InitializeCallback) JSValue {
        return cppFn("create", .{
            global_object,
            length,
            ctx,
            initializer,
        });
    }

    pub fn Initializer(comptime Ctx: type, comptime func: fn (*Ctx, obj: *JSObject, global: *JSGlobalObject) void) type {
        return struct {
            pub fn call(this: ?*anyopaque, obj: [*c]JSObject, global: [*c]JSGlobalObject) callconv(.C) void {
                @call(.{ .modifier = .always_inline }, func, .{ @ptrCast(*Ctx, @alignCast(@alignOf(*Ctx), this.?)), obj.?, global.? });
            }
        };
    }

    pub fn createWithInitializer(comptime Ctx: type, creator: *Ctx, global: *JSGlobalObject, length: usize) JSValue {
        const Type = Initializer(Ctx, Ctx.create);
        return create(global, length, creator, Type.call);
    }

    pub fn getIndex(this: JSValue, globalThis: *JSGlobalObject, i: u32) JSValue {
        return cppFn("getIndex", .{
            this,
            globalThis,
            i,
        });
    }

    pub fn putRecord(this: *JSObject, global: *JSGlobalObject, key: *ZigString, values: [*]ZigString, values_len: usize) void {
        return cppFn("putRecord", .{ this, global, key, values, values_len });
    }

    pub fn getDirect(this: *JSObject, globalThis: *JSGlobalObject, str: *const ZigString) JSValue {
        return cppFn("getDirect", .{
            this,
            globalThis,
            str,
        });
    }

    pub const Extern = [_][]const u8{
        "putRecord",
        "create",
        "getArrayLength",
        "getIndex",
        "putAtIndex",
        "getDirect",
    };
};

pub const ZigString = extern struct {
    // TODO: align this to align(2)
    // That would improve perf a bit
    ptr: [*]const u8,
    len: usize,

    pub const shim = Shimmer("", "ZigString", @This());

    pub const Slice = struct {
        allocator: std.mem.Allocator,
        ptr: [*]const u8,
        len: u32,
        allocated: bool = false,

        pub const empty = Slice{ .allocator = _global.default_allocator, .ptr = undefined, .len = 0, .allocated = false };

        pub fn slice(this: Slice) []const u8 {
            return this.ptr[0..this.len];
        }

        pub fn deinit(this: *Slice) void {
            if (!this.allocated) {
                return;
            }

            this.allocator.free(this.slice());
        }
    };

    pub const name = "ZigString";
    pub const namespace = "";

    pub inline fn is16Bit(this: *const ZigString) bool {
        return (@ptrToInt(this.ptr) & (1 << 63)) != 0;
    }

    pub inline fn utf16Slice(this: *const ZigString) []align(1) const u16 {
        return @ptrCast([*]align(1) const u16, untagged(this.ptr))[0..this.len];
    }

    pub inline fn isEmpty(this: *const ZigString) bool {
        return this.len == 0;
    }

    pub fn fromStringPointer(ptr: StringPointer, buf: string, to: *ZigString) void {
        to.* = ZigString{
            .len = ptr.length,
            .ptr = buf[ptr.offset..][0..ptr.length].ptr,
        };
    }

    pub fn sortDesc(slice_: []ZigString) void {
        std.sort.sort(ZigString, slice_, {}, cmpDesc);
    }

    pub fn cmpDesc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsDesc(void{}, a.slice(), b.slice());
    }

    pub fn sortAsc(slice_: []ZigString) void {
        std.sort.sort(ZigString, slice_, {}, cmpAsc);
    }

    pub fn cmpAsc(_: void, a: ZigString, b: ZigString) bool {
        return strings.cmpStringsAsc(void{}, a.slice(), b.slice());
    }

    pub fn init(slice_: []const u8) ZigString {
        return ZigString{ .ptr = slice_.ptr, .len = slice_.len };
    }

    pub fn detectEncoding(this: *ZigString) void {
        for (this.slice()) |char| {
            if (char > 127) {
                this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 63));
                return;
            }
        }
    }

    pub fn markUTF8(this: *ZigString) void {
        this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 61));
    }

    pub fn setOutputEncoding(this: *ZigString) void {
        if (!this.is16Bit()) this.detectEncoding();
        if (this.is16Bit()) this.markUTF8();
    }

    pub inline fn isGloballyAllocated(this: ZigString) bool {
        return (@ptrToInt(this.ptr) & (1 << 62)) != 0;
    }

    pub inline fn deinitGlobal(this: ZigString) void {
        _global.default_allocator.free(this.slice());
    }

    pub inline fn mark(this: *ZigString) void {
        this.ptr = @intToPtr([*]const u8, @ptrToInt(this.ptr) | (1 << 62));
    }

    pub fn format(self: ZigString, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (self.is16Bit()) {
            try strings.formatUTF16(self.utf16Slice(), writer);
            return;
        }

        try writer.writeAll(self.slice());
    }

    pub inline fn toRef(slice_: []const u8, global: *JSGlobalObject) C_API.JSValueRef {
        return init(slice_).toValue(global).asRef();
    }

    pub const Empty = ZigString{ .ptr = "", .len = 0 };

    inline fn untagged(ptr: [*]const u8) [*]const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        @setRuntimeSafety(false);
        return @intToPtr([*]const u8, @truncate(u53, @ptrToInt(ptr)));
    }

    pub fn slice(this: *const ZigString) []const u8 {
        return untagged(this.ptr)[0..@minimum(this.len, std.math.maxInt(u32))];
    }

    pub fn toSlice(this: ZigString, allocator: std.mem.Allocator) Slice {
        if (is16Bit(&this)) {
            var buffer = std.fmt.allocPrint(allocator, "{}", .{this}) catch unreachable;
            return Slice{
                .ptr = buffer.ptr,
                .len = @truncate(u32, buffer.len),
                .allocated = true,
                .allocator = allocator,
            };
        }

        return Slice{
            .ptr = untagged(this.ptr),
            .len = @truncate(u32, this.len),
            .allocated = false,
            .allocator = allocator,
        };
    }

    pub fn sliceZBuf(this: ZigString, buf: *[std.fs.MAX_PATH_BYTES]u8) ![:0]const u8 {
        return try std.fmt.bufPrintZ(buf, "{}", .{this});
    }

    pub inline fn full(this: *const ZigString) []const u8 {
        return untagged(this.ptr)[0..this.len];
    }

    pub fn trimmedSlice(this: *const ZigString) []const u8 {
        return std.mem.trim(u8, this.ptr[0..@minimum(this.len, std.math.maxInt(u32))], " \r\n");
    }

    pub fn toValueAuto(this: *const ZigString, global: *JSGlobalObject) JSValue {
        if (!this.is16Bit()) {
            return this.toValue(global);
        } else {
            return this.to16BitValue(global);
        }
    }

    pub fn toValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toValue", .{ this, global });
    }

    pub fn to16BitValue(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("to16BitValue", .{ this, global });
    }

    pub fn toValueGC(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toValueGC", .{ this, global });
    }

    pub fn withEncoding(this: *const ZigString) ZigString {
        var out = this.*;
        out.setOutputEncoding();
        return out;
    }

    pub fn toJSStringRef(this: *const ZigString) C_API.JSStringRef {
        if (comptime @hasDecl(@import("root"), "bindgen")) {
            return undefined;
        }

        return if (this.is16Bit())
            C_API.JSStringCreateWithCharactersNoCopy(@ptrCast([*]const u16, @alignCast(@alignOf([*]const u16), this.ptr)), this.len)
        else
            C_API.JSStringCreateStatic(this.ptr, this.len);
    }

    pub fn toErrorInstance(this: *const ZigString, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toErrorInstance", .{ this, global });
    }

    pub const Extern = [_][]const u8{
        "toValue",
        "to16BitValue",
        "toValueGC",
        "toErrorInstance",
    };
};

pub const SystemError = extern struct {
    errno: c_int = 0,
    /// label for errno
    code: ZigString = ZigString.init(""),
    message: ZigString = ZigString.init(""),
    path: ZigString = ZigString.init(""),
    syscall: ZigString = ZigString.init(""),

    pub const shim = Shimmer("", "SystemError", @This());

    pub const name = "SystemError";
    pub const namespace = "";

    pub fn toErrorInstance(this: *const SystemError, global: *JSGlobalObject) JSValue {
        return shim.cppFn("toErrorInstance", .{ this, global });
    }

    pub const Extern = [_][]const u8{
        "toErrorInstance",
    };
};

pub const ReturnableException = *?*Exception;

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

    pub fn value(this: *JSString, globalObject: *JSGlobalObject) String {
        return shim.cppFn("value", .{ this, globalObject });
    }

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

    pub fn argumentAt(this: *ScriptArguments, i: usize) JSValue {
        return cppFn("argumentAt", .{
            this,
            i,
        });
    }
    pub fn argumentCount(this: *ScriptArguments) usize {
        return cppFn("argumentCount", .{
            this,
        });
    }
    pub fn getFirstArgumentAsString(this: *ScriptArguments) String {
        return cppFn("getFirstArgumentAsString", .{
            this,
        });
    }

    pub fn isEqual(this: *ScriptArguments, other: *ScriptArguments) bool {
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
        const importNotImpl = "Import not implemented";
        const resolveNotImpl = "resolve not implemented";
        const moduleNotImpl = "Module fetch not implemented";
        pub fn import(global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) ErrorableZigString {
            if (comptime @hasDecl(Type, "import")) {
                return @call(.{ .modifier = .always_inline }, Type.import, .{ global, specifier.*, source.* });
            }
            return ErrorableZigString.err(error.ImportFailed, ZigString.init(importNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
            if (comptime @hasDecl(Type, "resolve")) {
                @call(.{ .modifier = .always_inline }, Type.resolve, .{ res, global, specifier.*, source.* });
                return;
            }
            res.* = ErrorableZigString.err(error.ResolveFailed, ZigString.init(resolveNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
            if (comptime @hasDecl(Type, "fetch")) {
                @call(.{ .modifier = .always_inline }, Type.fetch, .{ ret, global, specifier.*, source.* });
                return;
            }
            ret.* = ErrorableResolvedSource.err(error.FetchFailed, ZigString.init(moduleNotImpl).toErrorInstance(global).asVoid());
        }
        pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "promiseRejectionTracker")) {
                return @call(.{ .modifier = .always_inline }, Type.promiseRejectionTracker, .{ global, promise, rejection });
            }
            return JSValue.jsUndefined();
        }

        pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "reportUncaughtException")) {
                return @call(.{ .modifier = .always_inline }, Type.reportUncaughtException, .{ global, exception });
            }
            return JSValue.jsUndefined();
        }

        pub fn createImportMetaProperties(global: *JSGlobalObject, loader: *JSModuleLoader, obj: JSValue, record: *JSModuleRecord, specifier: JSValue) callconv(.C) JSValue {
            if (comptime @hasDecl(Type, "createImportMetaProperties")) {
                return @call(.{ .modifier = .always_inline }, Type.createImportMetaProperties, .{ global, loader, obj, record, specifier });
            }
            return JSValue.jsUndefined();
        }

        pub fn queueMicrotaskToEventLoop(global: *JSGlobalObject, microtask: *Microtask) callconv(.C) void {
            if (comptime @hasDecl(Type, "queueMicrotaskToEventLoop")) {
                @call(.{ .modifier = .always_inline }, Type.queueMicrotaskToEventLoop, .{ global, microtask });
            }
        }

        pub fn onCrash() callconv(.C) void {
            if (comptime @hasDecl(Type, "onCrash")) {
                return @call(.{ .modifier = .always_inline }, Type.onCrash, .{});
            }

            Output.flush();
            const Reporter = @import("../../../report.zig");
            Reporter.fatal(null, "A C++ exception occurred");
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

    pub fn evaluate(
        globalObject: *JSGlobalObject,
        sourceCodePtr: [*]const u8,
        sourceCodeLen: usize,
        originUrlPtr: [*]const u8,
        originUrlLen: usize,
        thisValue: JSValue,
        exception: [*]JSValue,
    ) JSValue {
        return shim.cppFn("evaluate", .{
            globalObject,
            sourceCodePtr,
            sourceCodeLen,
            originUrlPtr,
            originUrlLen,
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

    pub fn loadAndEvaluateModule(globalObject: *JSGlobalObject, module_name: *const ZigString) *JSInternalPromise {
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

    pub fn resolvedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return cppFn("resolvedPromiseValue", .{ globalThis, value });
    }

    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return cppFn("rejectedPromise", .{ globalThis, value });
    }

    pub fn rejectedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return cppFn("rejectedPromiseValue", .{ globalThis, value });
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
        "rejectedPromiseValue",
        "resolvedPromiseValue",
    };
};

pub const JSInternalPromise = extern struct {
    pub const shim = Shimmer("JSC", "JSInternalPromise", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "<JavaScriptCore/JSInternalPromise.h>";
    pub const name = "JSC::JSInternalPromise";
    pub const namespace = "JSC";

    pub fn status(this: *const JSInternalPromise, vm: *VM) JSPromise.Status {
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
        cppFn("fromString", .{ result, source, origin, filename, @enumToInt(source_type) });
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

    pub const NativeFunctionCallback = fn (ctx: ?*anyopaque, global: [*c]JSGlobalObject, call_frame: [*c]CallFrame) callconv(.C) JSValue;

    // pub fn createFromSourceCode(
    //     global: *JSGlobalObject,
    //     function_name: ?[*]const u8,
    //     function_name_len: u16,
    //     args: ?[*]JSValue,
    //     args_len: u16,
    //     source: *const SourceCode,
    //     origin: *SourceOrigin,
    //     exception: *?*JSObject,
    // ) *JSFunction {
    //     return cppFn("createFromSourceCode", .{
    //         global,
    //         function_name,
    //         function_name_len,
    //         args,
    //         args_len,
    //         source,
    //         origin,
    //         exception,
    //     });
    // }
    pub fn createFromNative(
        global: *JSGlobalObject,
        argument_count: u16,
        name_: ?*const String,
        ctx: ?*anyopaque,
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
    // pub fn toString(this: *JSFunction, globalThis: *JSGlobalObject) *const JSString {
    //     return cppFn("toString", .{ this, globalThis });
    // }

    pub fn callWithArgumentsAndThis(
        function: JSValue,
        thisValue: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("callWithArgumentsAndThis", .{
            function,
            thisValue,
            globalThis,
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
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("callWithArguments", .{
            function,
            globalThis,
            arguments_ptr,
            arguments_len,
            exception,
            error_message,
        });
    }

    pub fn callWithThis(
        function: JSValue,
        globalThis: *JSGlobalObject,
        thisValue: JSValue,
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("callWithThis", .{
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
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("callWithoutAnyArgumentsOrThis", .{ function, globalThis, exception, error_message });
    }

    pub fn constructWithArgumentsAndNewTarget(
        function: JSValue,
        newTarget: JSValue,
        globalThis: *JSGlobalObject,
        arguments_ptr: [*]JSValue,
        arguments_len: usize,
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("constructWithArgumentsAndNewTarget", .{
            function,
            newTarget,
            globalThis,
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
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("constructWithArguments", .{
            function,
            globalThis,
            arguments_ptr,
            arguments_len,
            exception,
            error_message,
        });
    }

    pub fn constructWithNewTarget(
        function: JSValue,
        globalThis: *JSGlobalObject,
        newTarget: JSValue,
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("constructWithNewTarget", .{
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
        exception: ReturnableException,
        error_message: [*c]const u8,
    ) JSValue {
        return cppFn("constructWithoutAnyArgumentsOrNewTarget", .{
            function,
            globalThis,
            exception,
            error_message,
        });
    }

    pub const Extern = [_][]const u8{
        "fromString",
        // "createFromSourceCode",
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

    pub fn ref(this: *JSGlobalObject) C_API.JSContextRef {
        return @ptrCast(C_API.JSContextRef, this);
    }
    pub const ctx = ref;

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

    pub fn createAggregateError(globalObject: *JSGlobalObject, errors: [*]*anyopaque, errors_len: u16, message: *const ZigString) JSValue {
        return cppFn("createAggregateError", .{ globalObject, errors, errors_len, message });
    }

    pub fn generateHeapSnapshot(this: *JSGlobalObject) JSValue {
        return cppFn("generateHeapSnapshot", .{this});
    }

    pub fn vm(this: *JSGlobalObject) *VM {
        return cppFn("vm", .{this});
    }

    pub fn deleteModuleRegistryEntry(this: *JSGlobalObject, name_: *ZigString) void {
        return cppFn("deleteModuleRegistryEntry", .{ this, name_ });
    }

    pub const Extern = [_][]const u8{
        "createAggregateError",
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
        "deleteModuleRegistryEntry",
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
        "generateHeapSnapshot",
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

fn _Bun(comptime str: []const u8) type {
    if (is_bindgen) {
        return opaque {
            pub const name = "Bun::" ++ str ++ "";
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

pub const JSArrayIterator = struct {
    i: u32 = 0,
    len: u32 = 0,
    array: JSValue,
    global: *JSGlobalObject,

    pub fn init(value: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return .{
            .array = value,
            .global = global,
            .len = value.getLengthOfArray(global),
        };
    }

    pub fn next(this: *JSArrayIterator) ?JSValue {
        if (!(this.i < this.len)) {
            return null;
        }
        const i = this.i;
        this.i += 1;
        return JSObject.getIndex(this.array, this.global, i);
    }
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
    pub const JSType = enum(u8) {
        // The Cell value must come before any JS that is a JSCell.
        Cell,
        String,
        HeapBigInt,
        Symbol,

        GetterSetter,
        CustomGetterSetter,
        APIValueWrapper,

        NativeExecutable,

        ProgramExecutable,
        ModuleProgramExecutable,
        EvalExecutable,
        FunctionExecutable,

        UnlinkedFunctionExecutable,

        UnlinkedProgramCodeBlock,
        UnlinkedModuleProgramCodeBlock,
        UnlinkedEvalCodeBlock,
        UnlinkedFunctionCodeBlock,

        CodeBlock,

        JSImmutableButterfly,
        JSSourceCode,
        JSScriptFetcher,
        JSScriptFetchParameters,

        // The Object value must come before any JS that is a subclass of JSObject.
        Object,
        FinalObject,
        JSCallee,
        JSFunction,
        InternalFunction,
        NullSetterFunction,
        BooleanObject,
        NumberObject,
        ErrorInstance,
        PureForwardingProxy,
        DirectArguments,
        ScopedArguments,
        ClonedArguments,

        // Start JSArray types.
        Array,
        DerivedArray,
        // End JSArray types.

        ArrayBuffer,

        // Start JSArrayBufferView types. Keep in sync with the order of FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW.
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
        DataView,
        // End JSArrayBufferView types.

        // JSScope <- JSWithScope
        //         <- StrictEvalActivation
        //         <- JSSymbolTableObject  <- JSLexicalEnvironment      <- JSModuleEnvironment
        //                                 <- JSSegmentedVariableObject <- JSGlobalLexicalEnvironment
        //                                                              <- JSGlobalObject
        // Start JSScope types.
        // Start environment record types.
        GlobalObject,
        GlobalLexicalEnvironment,
        LexicalEnvironment,
        ModuleEnvironment,
        StrictEvalActivation,
        // End environment record types.
        WithScope,
        // End JSScope types.

        ModuleNamespaceObject,
        RegExpObject,
        JSDate,
        ProxyObject,
        JSGenerator,
        JSAsyncGenerator,
        JSArrayIterator,
        JSMapIterator,
        JSSetIterator,
        JSStringIterator,
        JSPromise,
        JSMap,
        JSSet,
        JSWeakMap,
        JSWeakSet,
        WebAssemblyModule,
        // Start StringObject types.
        StringObject,
        DerivedStringObject,
        // End StringObject types.

        MaxJS = 0b11111111,
        _,

        pub fn isObject(this: JSType) bool {
            return switch (this) {
                .Object, .FinalObject => true,
                else => false,
            };
        }

        pub fn toC(this: JSType) C_API.JSTypedArrayType {
            return switch (this) {
                .Int8Array => .kJSTypedArrayTypeInt8Array,
                .Int16Array => .kJSTypedArrayTypeInt16Array,
                .Int32Array => .kJSTypedArrayTypeInt32Array,
                .Uint8Array => .kJSTypedArrayTypeUint8Array,
                .Uint8ClampedArray => .kJSTypedArrayTypeUint8ClampedArray,
                .Uint16Array => .kJSTypedArrayTypeUint16Array,
                .Uint32Array => .kJSTypedArrayTypeUint32Array,
                .Float32Array => .kJSTypedArrayTypeFloat32Array,
                .Float64Array => .kJSTypedArrayTypeFloat64Array,
                .ArrayBuffer => .kJSTypedArrayTypeArrayBuffer,
                else => .kJSTypedArrayTypeNone,
            };
        }

        pub fn isHidden(this: JSType) bool {
            return switch (this) {
                .APIValueWrapper,
                .NativeExecutable,
                .ProgramExecutable,
                .ModuleProgramExecutable,
                .EvalExecutable,
                .FunctionExecutable,
                .UnlinkedFunctionExecutable,
                .UnlinkedProgramCodeBlock,
                .UnlinkedModuleProgramCodeBlock,
                .UnlinkedEvalCodeBlock,
                .UnlinkedFunctionCodeBlock,
                .CodeBlock,
                .JSImmutableButterfly,
                .JSSourceCode,
                .JSScriptFetcher,
                .InternalFunction,
                .JSScriptFetchParameters,
                => true,
                else => false,
            };
        }

        pub const LastMaybeFalsyCellPrimitive = JSType.HeapBigInt;
        pub const LastJSCObject = JSType.DerivedStringObject; // This is the last "JSC" Object type. After this, we have embedder's (e.g., WebCore) extended object types.

        pub inline fn isStringLike(this: JSType) bool {
            return switch (this) {
                .String, .StringObject, .DerivedStringObject => true,
                else => false,
            };
        }

        pub inline fn isArray(this: JSType) bool {
            return switch (this) {
                .Array, .DerivedArray => true,
                else => false,
            };
        }
    };

    pub inline fn cast(ptr: anytype) JSValue {
        return @intToEnum(JSValue, @intCast(i64, @ptrToInt(ptr)));
    }

    pub const Formatter = struct {
        value: JSValue,
        global: *JSGlobalObject,

        pub fn format(formatter: Formatter, comptime fmt: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
            const self = formatter.value;
            const kind: JSType = jsType(self);
            if (kind.isStringLike()) {
                var zig_str = self.getZigString();
                return try zig_str.format(fmt, opts, writer);
            }

            if (kind) {}
        }
    };

    pub fn to(this: JSValue, comptime T: type) T {
        return switch (comptime T) {
            u32 => toU32(this),
            u16 => toU16(this),
            c_uint => @intCast(c_uint, toU32(this)),
            c_int => @intCast(c_int, toInt32(this)),
            ?*JSInternalPromise => asInternalPromise(this),

            // TODO: BigUint64?
            u64 => @as(u64, toU32(this)),

            u8 => @truncate(u8, toU32(this)),
            i16 => @truncate(i16, toInt32(this)),
            i8 => @truncate(i8, toInt32(this)),
            i32 => @truncate(i32, toInt32(this)),

            // TODO: BigInt64
            i64 => @as(i64, toInt32(this)),
            else => @compileError("Not implemented yet"),
        };
    }

    pub fn jsType(
        this: JSValue,
    ) JSType {
        return cppFn("jsType", .{this});
    }

    pub fn createEmptyObject(global: *JSGlobalObject, len: usize) JSValue {
        return cppFn("createEmptyObject", .{ global, len });
    }

    pub fn putRecord(value: JSValue, global: *JSGlobalObject, key: *ZigString, values: [*]ZigString, values_len: usize) void {
        return cppFn("putRecord", .{ value, global, key, values, values_len });
    }

    /// Create an object with exactly two properties
    pub fn createObject2(global: *JSGlobalObject, key1: *const ZigString, key2: *const ZigString, value1: JSValue, value2: JSValue) JSValue {
        return cppFn("createObject2", .{ global, key1, key2, value1, value2 });
    }

    pub fn getErrorsProperty(this: JSValue, globalObject: *JSGlobalObject) JSValue {
        return cppFn("getErrorsProperty", .{ this, globalObject });
    }

    pub fn jsNumberWithType(comptime Number: type, number: Type) JSValue {
        return switch (Number) {
            f64 => @call(.{ .modifier = .always_inline }, jsNumberFromDouble, .{number}),
            u8 => @call(.{ .modifier = .always_inline }, jsNumberFromChar, .{number}),
            u16 => @call(.{ .modifier = .always_inline }, jsNumberFromU16, .{number}),
            i32 => @call(.{ .modifier = .always_inline }, jsNumberFromInt32, .{@truncate(i32, number)}),
            c_int, i64 => if (number > std.math.maxInt(i32))
                jsNumberFromInt64(@truncate(i64, number))
            else
                jsNumberFromInt32(@intCast(i32, number)),

            c_uint, u32 => if (number < std.math.maxInt(i32))
                jsNumberFromInt32(@intCast(i32, number))
            else
                jsNumberFromUint64(@as(u64, number)),

            else => @compileError("Type transformation missing for number of type: " ++ @typeName(Number)),
        };
    }

    pub fn createInternalPromise(globalObject: *JSGlobalObject) JSValue {
        return cppFn("createInternalPromise", .{globalObject});
    }

    pub fn asInternalPromise(
        value: JSValue,
    ) ?*JSInternalPromise {
        return cppFn("asInternalPromise", .{
            value,
        });
    }

    pub fn jsNumber(number: anytype) JSValue {
        return jsNumberWithType(@TypeOf(number), number);
    }

    pub fn getReadableStreamState(value: JSValue, vm: *VM) ?*Exports.NodeReadableStream {
        return cppFn("getReadableStreamState", .{ value, vm });
    }

    pub fn getWritableStreamState(value: JSValue, vm: *VM) ?*Exports.NodeWritableStream {
        return cppFn("getWritableStreamState", .{ value, vm });
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

    pub fn createStringArray(globalThis: *JSGlobalObject, str: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("createStringArray", .{
            globalThis,
            str,
            strings_count,
            clone,
        });
    }

    pub fn fromEntries(globalThis: *JSGlobalObject, keys: [*c]ZigString, values: [*c]ZigString, strings_count: usize, clone: bool) JSValue {
        return cppFn("fromEntries", .{
            globalThis,
            keys,
            values,
            strings_count,
            clone,
        });
    }

    pub inline fn arrayIterator(this: JSValue, global: *JSGlobalObject) JSArrayIterator {
        return JSArrayIterator.init(this, global);
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
    pub fn isInt32(this: JSValue) bool {
        return cppFn("isInt32", .{this});
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

    pub fn isClass(this: JSValue, global: *JSGlobalObject) bool {
        return cppFn("isClass", .{ this, global });
    }

    pub fn getNameProperty(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        cppFn("getNameProperty", .{ this, global, ret });
    }

    pub fn getClassName(this: JSValue, global: *JSGlobalObject, ret: *ZigString) void {
        cppFn("getClassName", .{ this, global, ret });
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

    pub fn isException(this: JSValue, vm: *VM) bool {
        return cppFn("isException", .{ this, vm });
    }

    pub fn isTerminationException(this: JSValue, vm: *VM) bool {
        return cppFn("isTerminationException", .{ this, vm });
    }

    pub fn toZigException(this: JSValue, global: *JSGlobalObject, exception: *ZigException) void {
        return cppFn("toZigException", .{ this, global, exception });
    }

    pub fn toZigString(this: JSValue, out: *ZigString, global: *JSGlobalObject) void {
        return cppFn("toZigString", .{ this, out, global });
    }

    pub fn asArrayBuffer_(this: JSValue, global: *JSGlobalObject, out: *ArrayBuffer) bool {
        return cppFn("asArrayBuffer_", .{ this, global, out });
    }

    pub fn asArrayBuffer(this: JSValue, global: *JSGlobalObject) ?ArrayBuffer {
        var out: ArrayBuffer = undefined;
        if (this.asArrayBuffer_(global, &out)) return out;
        return null;
    }

    pub inline fn getZigString(this: JSValue, global: *JSGlobalObject) ZigString {
        var str = ZigString.init("");
        this.toZigString(&str, global);
        return str;
    }

    pub inline fn toSlice(this: JSValue, global: *JSGlobalObject, allocator: std.mem.Allocator) ZigString.Slice {
        return getZigString(this, global).toSlice(allocator);
    }

    // On exception, this returns the empty string.
    pub fn toString(this: JSValue, globalThis: *JSGlobalObject) *JSString {
        return cppFn("toString", .{ this, globalThis });
    }

    pub fn toWTFString(this: JSValue, globalThis: *JSGlobalObject) String {
        return cppFn("toWTFString", .{ this, globalThis });
    }

    pub fn jsonStringify(this: JSValue, globalThis: *JSGlobalObject, indent: u32, out: *ZigString) void {
        return cppFn("jsonStringify", .{ this, globalThis, indent, out });
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

    // intended to be more lightweight than ZigString
    pub fn getIfPropertyExistsImpl(this: JSValue, global: *JSGlobalObject, ptr: [*]const u8, len: u32) JSValue {
        return cppFn("getIfPropertyExistsImpl", .{ this, global, ptr, len });
    }

    pub fn get(this: JSValue, global: *JSGlobalObject, property: []const u8) ?JSValue {
        const value = getIfPropertyExistsImpl(this, global, property.ptr, @intCast(u32, property.len));
        return if (@enumToInt(value) != 0) value else return null;
    }

    /// Alias for getIfPropertyExists
    pub const getIfPropertyExists = get;

    pub fn createTypeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createTypeError", .{ message, code, global });
    }

    pub fn createRangeError(message: *const ZigString, code: *const ZigString, global: *JSGlobalObject) JSValue {
        return cppFn("createRangeError", .{ message, code, global });
    }

    /// Object.is()
    /// This algorithm differs from the IsStrictlyEqual Algorithm by treating all NaN values as equivalent and by differentiating +0𝔽 from -0𝔽.
    /// https://tc39.es/ecma262/#sec-samevalue
    pub fn isSameValue(this: JSValue, other: JSValue, global: *JSGlobalObject) bool {
        return cppFn("isSameValue", .{ this, other, global });
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

    pub fn toBoolean(this: JSValue) bool {
        return cppFn("toBoolean", .{
            this,
        });
    }

    pub fn toInt32(this: JSValue) i32 {
        return cppFn("toInt32", .{
            this,
        });
    }

    pub inline fn toU16(this: JSValue) u16 {
        return @intCast(u16, this.toInt32());
    }

    pub inline fn toU32(this: JSValue) u32 {
        return @intCast(u32, @maximum(this.toInt32(), 0));
    }

    pub fn getLengthOfArray(this: JSValue, globalThis: *JSGlobalObject) u32 {
        return cppFn("getLengthOfArray", .{
            this,
            globalThis,
        });
    }

    pub fn isAggregateError(this: JSValue, globalObject: *JSGlobalObject) bool {
        return cppFn("isAggregateError", .{ this, globalObject });
    }

    pub fn forEach(this: JSValue, globalObject: *JSGlobalObject, callback: fn (vm: [*c]VM, globalObject: [*c]JSGlobalObject, nextValue: JSValue) callconv(.C) void) void {
        return cppFn("forEach", .{ this, globalObject, callback });
    }

    pub fn isIterable(this: JSValue, globalObject: *JSGlobalObject) bool {
        return cppFn("isIterable", .{
            this,
            globalObject,
        });
    }

    pub inline fn asRef(this: JSValue) C_API.JSValueRef {
        return @intToPtr(C_API.JSValueRef, @bitCast(usize, @enumToInt(this)));
    }

    pub inline fn fromRef(this: C_API.JSValueRef) JSValue {
        return @intToEnum(JSValue, @bitCast(i64, @ptrToInt(this)));
    }

    pub inline fn asObjectRef(this: JSValue) C_API.JSObjectRef {
        return @ptrCast(C_API.JSObjectRef, this.asVoid());
    }

    pub inline fn asVoid(this: JSValue) *anyopaque {
        return @intToPtr(*anyopaque, @bitCast(u64, @enumToInt(this)));
    }

    pub const Extern = [_][]const u8{ "createInternalPromise", "asInternalPromise", "asArrayBuffer_", "getReadableStreamState", "getWritableStreamState", "fromEntries", "createTypeError", "createRangeError", "createObject2", "getIfPropertyExistsImpl", "jsType", "jsonStringify", "kind_", "isTerminationException", "isSameValue", "getLengthOfArray", "toZigString", "createStringArray", "createEmptyObject", "putRecord", "asPromise", "isClass", "getNameProperty", "getClassName", "getErrorsProperty", "toInt32", "toBoolean", "isInt32", "isIterable", "forEach", "isAggregateError", "toZigException", "isException", "toWTFString", "hasProperty", "getPropertyNames", "getDirect", "putDirect", "getIfExists", "asString", "asObject", "asNumber", "isError", "jsNull", "jsUndefined", "jsTDZValue", "jsBoolean", "jsDoubleNumber", "jsNumberFromDouble", "jsNumberFromChar", "jsNumberFromU16", "jsNumberFromInt32", "jsNumberFromInt64", "jsNumberFromUint64", "isUndefined", "isNull", "isUndefinedOrNull", "isBoolean", "isAnyInt", "isUInt32AsAnyInt", "isInt32AsAnyInt", "isNumber", "isString", "isBigInt", "isHeapBigInt", "isBigInt32", "isSymbol", "isPrimitive", "isGetterSetter", "isCustomGetterSetter", "isObject", "isCell", "asCell", "toString", "toStringOrNull", "toPropertyKey", "toPropertyKeyValue", "toObject", "toString", "getPrototype", "getPropertyByPropertyName", "eqlValue", "eqlCell", "isCallable" };
};

extern "c" fn Microtask__run(*Microtask, *JSGlobalObject) void;

pub const Microtask = opaque {
    pub const name = "Zig::JSMicrotaskCallback";
    pub const namespace = "Zig";

    pub fn run(this: *Microtask, global_object: *JSGlobalObject) void {
        if (comptime is_bindgen) {
            return;
        }

        return Microtask__run(this, global_object);
    }
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

    pub fn value(this: *Exception) JSValue {
        return cppFn(
            "value",
            .{this},
        );
    }

    pub fn getStackTrace(this: *Exception, trace: *ZigStackTrace) void {
        return cppFn(
            "getStackTrace",
            .{ this, trace },
        );
    }

    pub const Extern = [_][]const u8{ "create", "value", "getStackTrace" };
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

    pub fn isJITEnabled() bool {
        return cppFn("isJITEnabled", .{});
    }

    pub fn holdAPILock(this: *VM, ctx: ?*anyopaque, callback: fn (ctx: ?*anyopaque) callconv(.C) void) void {
        cppFn("holdAPILock", .{ this, ctx, callback });
    }

    pub fn deleteAllCode(
        vm: *VM,
        global_object: *JSGlobalObject,
    ) void {
        return cppFn("deleteAllCode", .{ vm, global_object });
    }

    pub fn whenIdle(
        vm: *VM,
        callback: fn (...) callconv(.C) void,
    ) void {
        return cppFn("whenIdle", .{ vm, callback });
    }

    pub fn shrinkFootprint(
        vm: *VM,
    ) void {
        return cppFn("shrinkFootprint", .{
            vm,
        });
    }

    pub fn runGC(vm: *VM, sync: bool) JSValue {
        return cppFn("runGC", .{
            vm,
            sync,
        });
    }

    pub fn setExecutionForbidden(vm: *VM, forbidden: bool) void {
        cppFn("setExecutionForbidden", .{ vm, forbidden });
    }

    pub fn setExecutionTimeLimit(vm: *VM, timeout: f64) void {
        return cppFn("setExecutionTimeLimit", .{ vm, timeout });
    }

    pub fn clearExecutionTimeLimit(vm: *VM) void {
        return cppFn("clearExecutionTimeLimit", .{vm});
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

            global_object,
            scope,

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

    pub const Extern = [_][]const u8{ "holdAPILock", "runGC", "generateHeapSnapshot", "isJITEnabled", "deleteAllCode", "apiLock", "create", "deinit", "setExecutionForbidden", "executionForbidden", "isEntered", "throwError", "drainMicrotasks", "whenIdle", "shrinkFootprint", "setExecutionTimeLimit", "clearExecutionTimeLimit" };
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
        _: [*]u8,
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
        return cppFn("declare", .{ vm, function_name, file, line });
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
            i,
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

const DeinitFunction = fn (ctx: *anyopaque, buffer: [*]u8, len: usize) callconv(.C) void;

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

pub const ObjectPrototype = _JSCellStub("ObjectPrototype");
pub const FunctionPrototype = _JSCellStub("FunctionPrototype");
pub const ArrayPrototype = _JSCellStub("ArrayPrototype");
pub const StringPrototype = _JSCellStub("StringPrototype");
pub const BigIntPrototype = _JSCellStub("BigIntPrototype");
pub const RegExpPrototype = _JSCellStub("RegExpPrototype");
pub const IteratorPrototype = _JSCellStub("IteratorPrototype");
pub const AsyncIteratorPrototype = _JSCellStub("AsyncIteratorPrototype");
pub const GeneratorFunctionPrototype = _JSCellStub("GeneratorFunctionPrototype");
pub const GeneratorPrototype = _JSCellStub("GeneratorPrototype");
pub const AsyncFunctionPrototype = _JSCellStub("AsyncFunctionPrototype");
pub const ArrayIteratorPrototype = _JSCellStub("ArrayIteratorPrototype");
pub const MapIteratorPrototype = _JSCellStub("MapIteratorPrototype");
pub const SetIteratorPrototype = _JSCellStub("SetIteratorPrototype");
pub const JSPromisePrototype = _JSCellStub("JSPromisePrototype");
pub const AsyncGeneratorPrototype = _JSCellStub("AsyncGeneratorPrototype");
pub const AsyncGeneratorFunctionPrototype = _JSCellStub("AsyncGeneratorFunctionPrototype");
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
    bytes: u64,
    bytesA: u64,
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

pub const Callback = struct {
    // zig: Value,
};
