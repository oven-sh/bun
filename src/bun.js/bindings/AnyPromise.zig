const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSPromise = @import("JSPromise.zig").JSPromise;
const JSInternalPromise = @import("JSInternalPromise.zig").JSInternalPromise;
const VM = JSC.VM;

pub const AnyPromise = union(enum) {
    normal: *JSPromise,
    internal: *JSInternalPromise,

    pub fn unwrap(this: AnyPromise, vm: *VM, mode: JSPromise.UnwrapMode) JSPromise.Unwrapped {
        return switch (this) {
            inline else => |promise| promise.unwrap(vm, mode),
        };
    }
    pub fn status(this: AnyPromise, vm: *VM) JSPromise.Status {
        return switch (this) {
            inline else => |promise| promise.status(vm),
        };
    }
    pub fn result(this: AnyPromise, vm: *VM) JSValue {
        return switch (this) {
            inline else => |promise| promise.result(vm),
        };
    }
    pub fn isHandled(this: AnyPromise, vm: *VM) bool {
        return switch (this) {
            inline else => |promise| promise.isHandled(vm),
        };
    }
    pub fn setHandled(this: AnyPromise, vm: *VM) void {
        switch (this) {
            inline else => |promise| promise.setHandled(vm),
        }
    }

    pub fn resolve(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.resolve(globalThis, value),
        }
    }

    pub fn reject(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.reject(globalThis, value),
        }
    }

    pub fn rejectAsHandled(this: AnyPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        switch (this) {
            inline else => |promise| promise.rejectAsHandled(globalThis, value),
        }
    }

    pub fn asValue(this: AnyPromise) JSValue {
        return switch (this) {
            .normal => |promise| promise.toJS(),
            .internal => |promise| promise.asValue(),
        };
    }

    extern fn JSC__AnyPromise__wrap(*JSC.JSGlobalObject, JSValue, *anyopaque, *const fn (*anyopaque, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue) void;

    pub fn wrap(
        this: AnyPromise,
        globalObject: *JSGlobalObject,
        comptime Function: anytype,
        args: std.meta.ArgsTuple(@TypeOf(Function)),
    ) void {
        const Args = std.meta.ArgsTuple(@TypeOf(Function));
        const Fn = Function;
        const Wrapper = struct {
            args: Args,

            pub fn call(wrap_: *@This(), global: *JSC.JSGlobalObject) callconv(.c) JSC.JSValue {
                return JSC.toJSHostCall(global, @src(), Fn, wrap_.args);
            }
        };

        var scope: JSC.CatchScope = undefined;
        scope.init(globalObject, @src(), .enabled);
        defer scope.deinit();
        var ctx = Wrapper{ .args = args };
        JSC__AnyPromise__wrap(globalObject, this.asValue(), &ctx, @ptrCast(&Wrapper.call));
        bun.debugAssert(!scope.hasException()); // TODO: properly propagate exception upwards
    }
};
