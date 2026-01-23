pub const CallbackGetterFn = fn (jsc.JSValue) callconv(.c) jsc.JSValue;
pub const CallbackSetterFn = fn (jsc.JSValue, jsc.JSValue) callconv(.c) void;

pub fn CallbackWrapper(comptime Getter: *const CallbackGetterFn, comptime Setter: *const CallbackSetterFn) type {
    return struct {
        const GetFn = Getter;
        const SetFn = Setter;
        container: jsc.JSValue,

        pub inline fn get(self: @This()) ?jsc.JSValue {
            const res = GetFn(self.container);
            if (res.isEmptyOrUndefinedOrNull())
                return null;

            return res;
        }

        pub inline fn set(self: @This(), value: jsc.JSValue) void {
            SetFn(self.container, value);
        }

        pub inline fn call(self: @This(), globalObject: *jsc.JSGlobalObject, args: []const jsc.JSValue) ?jsc.JSValue {
            if (self.get()) |callback| {
                return callback.call(globalObject, args);
            }

            return null;
        }
    };
}

const bun = @import("bun");
const jsc = bun.jsc;
