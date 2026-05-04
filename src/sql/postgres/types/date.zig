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

pub fn fromJS(globalObject: *jsc.JSGlobalObject, value: JSValue) AnyPostgresError!i64 {
    const double_value = if (value.isDate())
        value.getUnixTimestamp()
    else if (value.isNumber())
        value.asNumber()
    else if (value.isString()) brk: {
        var str = value.toBunString(globalObject) catch @panic("unreachable");
        defer str.deref();
        break :brk try str.parseDate(globalObject);
    } else return 0;

    // `@intFromFloat` on a non-finite value is Illegal Behavior. Invalid
    // `Date` objects (e.g. `new Date("bad")` / `new Date(NaN)`) are real
    // `DateInstance`s whose internal value is NaN, so `getUnixTimestamp()`
    // — and likewise `parseDate` on a bad string or `asNumber` on `NaN` —
    // can return NaN / ±Infinity here. The text path (`toISOString`) already
    // rejects these via `std::isfinite`; mirror that for the binary path.
    if (!std.math.isFinite(double_value)) return error.InvalidQueryBinding;

    const unix_timestamp: i64 = @intFromFloat(double_value);
    return (unix_timestamp - POSTGRES_EPOCH_DATE) * std.time.us_per_ms;
}

pub fn toJS(
    globalObject: *jsc.JSGlobalObject,
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

const bun = @import("bun");
const std = @import("std");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
