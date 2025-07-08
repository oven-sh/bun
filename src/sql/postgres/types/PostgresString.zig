pub const to = 25;
pub const from = [_]short{1002};

pub fn toJSWithType(
    globalThis: *JSC.JSGlobalObject,
    comptime Type: type,
    value: Type,
) AnyPostgresError!JSValue {
    switch (comptime Type) {
        [:0]u8, []u8, []const u8, [:0]const u8 => {
            var str = bun.String.fromUTF8(value);
            defer str.deinit();
            return str.toJS(globalThis);
        },

        bun.String => {
            return value.toJS(globalThis);
        },

        *Data => {
            var str = bun.String.fromUTF8(value.slice());
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
    globalThis: *JSC.JSGlobalObject,
    value: anytype,
) !JSValue {
    var str = try toJSWithType(globalThis, @TypeOf(value), value);
    defer str.deinit();
    return str.toJS(globalThis);
}

// @sortImports

const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const bun = @import("bun");

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
