pub const to = 25;
pub const from = [_]short{1002};

pub fn toJSWithType(
    globalThis: *jsc.JSGlobalObject,
    comptime Type: type,
    value: Type,
) AnyPostgresError!JSValue {
    switch (comptime Type) {
        [:0]u8, []u8, []const u8, [:0]const u8 => {
            var str = bun.String.borrowUTF8(value);
            defer str.deinit();
            return str.toJS(globalThis);
        },

        bun.String => {
            return value.toJS(globalThis);
        },

        *Data => {
            var str = bun.String.borrowUTF8(value.slice());
            defer str.deinit();
            defer value.deinit();
            return str.toJS(globalThis);
        },

        else => {
            @compileError("unsupported type " ++ @typeName(Type));
        },
    }
}

pub fn toJS(
    globalThis: *jsc.JSGlobalObject,
    value: anytype,
) !JSValue {
    var str = try toJSWithType(globalThis, @TypeOf(value), value);
    defer str.deinit();
    return str.toJS(globalThis);
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
