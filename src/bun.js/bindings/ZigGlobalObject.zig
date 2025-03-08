const bun = @import("root").bun;
const JSC = bun.JSC;
const Shimmer = @import("./shimmer.zig").Shimmer;
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
pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *anyopaque;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(JSC.VirtualMachine);

    pub fn create(
        vm: *JSC.VirtualMachine,
        console: *anyopaque,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: ?*anyopaque,
    ) *JSGlobalObject {
        vm.eventLoop().ensureWaker();
        const global = shim.cppFn("create", .{ console, context_id, mini_mode, eval_mode, worker_ptr });

        // JSC might mess with the stack size.
        bun.StackCheck.configureThread();

        return global;
    }

    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return shim.cppFn("getModuleRegistryMap", .{global});
    }

    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return shim.cppFn("resetModuleRegistryMap", .{ global, map });
    }

    pub fn import(global: *JSGlobalObject, specifier: *bun.String, source: *bun.String) callconv(.C) ErrorableString {
        JSC.markBinding(@src());

        return @call(bun.callmod_inline, Interface.import, .{ global, specifier, source });
    }
    pub fn resolve(res: *ErrorableString, global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, query: *ZigString) callconv(.C) void {
        JSC.markBinding(@src());
        @call(bun.callmod_inline, Interface.resolve, .{ res, global, specifier, source, query });
    }

    pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, Interface.promiseRejectionTracker, .{ global, promise, rejection });
    }

    pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, Interface.reportUncaughtException, .{ global, exception });
    }

    pub fn onCrash() callconv(.C) void {
        JSC.markBinding(@src());
        return @call(bun.callmod_inline, Interface.onCrash, .{});
    }

    pub const Export = shim.exportFunctions(
        .{
            .import = import,
            .resolve = resolve,
            .promiseRejectionTracker = promiseRejectionTracker,
            .reportUncaughtException = reportUncaughtException,
            .onCrash = onCrash,
        },
    );

    pub const Extern = [_][]const u8{ "create", "getModuleRegistryMap", "resetModuleRegistryMap" };

    comptime {
        @export(&import, .{ .name = Export[0].symbol_name });
        @export(&resolve, .{ .name = Export[1].symbol_name });
        @export(&promiseRejectionTracker, .{ .name = Export[2].symbol_name });
        @export(&reportUncaughtException, .{ .name = Export[3].symbol_name });
        @export(&onCrash, .{ .name = Export[4].symbol_name });
    }
};
