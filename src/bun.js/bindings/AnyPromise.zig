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

    extern fn JSC__AnyPromise__wrap(*jsc.JSGlobalObject, JSValue, *anyopaque, *const fn (*anyopaque, *jsc.JSGlobalObject) callconv(.C) jsc.JSValue) void;

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

            pub fn call(wrap_: *@This(), global: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
                return jsc.toJSHostCall(global, @src(), Fn, wrap_.args);
            }
        };

        var scope: jsc.CatchScope = undefined;
        scope.init(globalObject, @src());
        defer scope.deinit();
        var ctx = Wrapper{ .args = args };
        JSC__AnyPromise__wrap(globalObject, this.asValue(), &ctx, @ptrCast(&Wrapper.call));
        bun.debugAssert(!scope.hasException()); // TODO: properly propagate exception upwards
    }
};

const bun = @import("bun");
const std = @import("std");
const JSInternalPromise = @import("./JSInternalPromise.zig").JSInternalPromise;
const JSPromise = @import("./JSPromise.zig").JSPromise;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VM = jsc.VM;
