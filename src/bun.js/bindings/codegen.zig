const JSC = bun.JSC;
const bun = @import("bun");

pub const CallbackGetterFn = fn (JSC.JSValue) callconv(.C) JSC.JSValue;
pub const CallbackSetterFn = fn (JSC.JSValue, JSC.JSValue) callconv(.C) void;

pub fn CallbackWrapper(comptime Getter: *const CallbackGetterFn, comptime Setter: *const CallbackSetterFn) type {
    return struct {
        const GetFn = Getter;
        const SetFn = Setter;
        container: JSC.JSValue,

        pub inline fn get(self: @This()) ?JSC.JSValue {
            const res = GetFn(self.container);
            if (res.isEmptyOrUndefinedOrNull())
                return null;

            return res;
        }

        pub inline fn set(self: @This(), value: JSC.JSValue) void {
            SetFn(self.container, value);
        }

        pub inline fn call(self: @This(), globalObject: *JSC.JSGlobalObject, args: []const JSC.JSValue) ?JSC.JSValue {
            if (self.get()) |callback| {
                return callback.call(globalObject, args);
            }

            return null;
        }
    };
}
