const date = @This();

pub const to = 1184;
pub const from = [_]short{ 1082, 1114, 1184 };

// Postgres stores timestamp and timestampz as microseconds since 2000-01-01
// This is a signed 64-bit integer.
const POSTGRES_EPOCH_DATE = 946684800000;

pub fn fromBinary(bytes: []const u8) f64 {
    const microseconds = std.mem.readInt(i64, bytes[0..8], .big);
    const double_microseconds: f64 = @floatFromInt(microseconds);
    return (double_microseconds / std.time.us_per_ms) + POSTGRES_EPOCH_DATE;
}

pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue) i64 {
    const double_value = if (value.isDate())
        value.getUnixTimestamp()
    else if (value.isNumber())
        value.asNumber()
    else if (value.isString()) brk: {
        var str = value.toBunString(globalObject) catch @panic("unreachable");
        defer str.deref();
        break :brk str.parseDate(globalObject);
    } else return 0;

    const unix_timestamp: i64 = @intFromFloat(double_value);
    return (unix_timestamp - POSTGRES_EPOCH_DATE) * std.time.us_per_ms;
}

pub fn toJS(
    globalObject: *JSC.JSGlobalObject,
    value: anytype,
) JSValue {
    switch (@TypeOf(value)) {
        i64 => {
            // Convert from Postgres timestamp (μs since 2000-01-01) to Unix timestamp (ms)
            const ms = @divFloor(value, std.time.us_per_ms) + POSTGRES_EPOCH_DATE;
            return JSValue.fromDateNumber(globalObject, @floatFromInt(ms));
        },
        *Data => {
            defer value.deinit();
            return JSValue.fromDateString(globalObject, value.sliceZ().ptr);
        },
        else => @compileError("unsupported type " ++ @typeName(@TypeOf(value))),
    }
}

// @sortImports
const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const int_types = @import("./int_types.zig");
const short = int_types.short;
const Data = @import("../Data.zig").Data;
