const bun = @import("root").bun;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const String = bun.String;
const JSValue = JSC.JSValue;
const JSPromise = JSC.JSPromise;
const JSPromiseRejectionOperation = JSC.JSPromiseRejectionOperation;
const Exception = JSC.Exception;
const ErrorableString = JSC.ErrorableString;
const NewGlobalObject = JSC.NewGlobalObject;

/// Global object for Zig JavaScript environment
pub const ZigGlobalObject = opaque {
    const interface = NewGlobalObject(JSC.VirtualMachine);
    pub fn create(
        vm: *JSC.VirtualMachine,
        console: *anyopaque,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: ?*anyopaque,
    ) *JSGlobalObject {
        vm.eventLoop().ensureWaker();
        const global = Zig__GlobalObject__create(console, context_id, mini_mode, eval_mode, worker_ptr);

        // JSC might mess with the stack size.
        bun.StackCheck.configureThread();

        return global;
    }

    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return Zig__GlobalObject__getModuleRegistryMap(global);
    }

    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return Zig__GlobalObject__resetModuleRegistryMap(global, map);
    }

    extern fn Zig__GlobalObject__create(
        console: *anyopaque,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: ?*anyopaque,
    ) *JSGlobalObject;

    extern fn Zig__GlobalObject__getModuleRegistryMap(global: *JSGlobalObject) *anyopaque;
    extern fn Zig__GlobalObject__resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool;

    pub fn import(global: *JSGlobalObject, specifier: *bun.String, source: *bun.String) callconv(.C) ErrorableString {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, interface.import, .{ global, specifier, source });
    }

    pub fn resolve(res: *ErrorableString, global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, query: *ZigString) callconv(.C) void {
        JSC.markBinding(@src());
        @call(bun.callmod_inline, interface.resolve, .{ res, global, specifier, source, query });
    }

    pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, interface.promiseRejectionTracker, .{ global, promise, rejection });
    }

    pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, interface.reportUncaughtException, .{ global, exception });
    }

    pub fn onCrash() callconv(.C) void {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, interface.onCrash, .{});
    }

    comptime {
        @export(&import, .{ .name = "Zig__GlobalObject__import" });
        @export(&resolve, .{ .name = "Zig__GlobalObject__resolve" });
        @export(&promiseRejectionTracker, .{ .name = "Zig__GlobalObject__promiseRejectionTracker" });
        @export(&reportUncaughtException, .{ .name = "Zig__GlobalObject__reportUncaughtException" });
        @export(&onCrash, .{ .name = "Zig__GlobalObject__onCrash" });
    }
};
