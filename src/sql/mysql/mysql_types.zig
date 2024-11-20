const std = @import("std");
const bun = @import("root").bun;
const mysql = bun.JSC.MySQL;
const Data = mysql.Data;
const protocol = @This();
const MySQLInt32 = mysql.MySQLInt32;
const MySQLInt16 = mysql.MySQLInt16;
const String = bun.String;
const debug = mysql.debug;
const JSValue = bun.JSC.JSValue;
const JSC = bun.JSC;

// MySQL field types
// https://dev.mysql.com/doc/dev/mysql-server/latest/binary__log__types_8h.html#a8935f33b06a3a88ba403c63acd806920
pub const FieldType = enum(u8) {
    MYSQL_TYPE_DECIMAL = 0x00,
    MYSQL_TYPE_TINY = 0x01,
    MYSQL_TYPE_SHORT = 0x02,
    MYSQL_TYPE_LONG = 0x03,
    MYSQL_TYPE_FLOAT = 0x04,
    MYSQL_TYPE_DOUBLE = 0x05,
    MYSQL_TYPE_NULL = 0x06,
    MYSQL_TYPE_TIMESTAMP = 0x07,
    MYSQL_TYPE_LONGLONG = 0x08,
    MYSQL_TYPE_INT24 = 0x09,
    MYSQL_TYPE_DATE = 0x0a,
    MYSQL_TYPE_TIME = 0x0b,
    MYSQL_TYPE_DATETIME = 0x0c,
    MYSQL_TYPE_YEAR = 0x0d,
    MYSQL_TYPE_NEWDATE = 0x0e,
    MYSQL_TYPE_VARCHAR = 0x0f,
    MYSQL_TYPE_BIT = 0x10,
    MYSQL_TYPE_TIMESTAMP2 = 0x11,
    MYSQL_TYPE_DATETIME2 = 0x12,
    MYSQL_TYPE_TIME2 = 0x13,
    MYSQL_TYPE_JSON = 0xf5,
    MYSQL_TYPE_NEWDECIMAL = 0xf6,
    MYSQL_TYPE_ENUM = 0xf7,
    MYSQL_TYPE_SET = 0xf8,
    MYSQL_TYPE_TINY_BLOB = 0xf9,
    MYSQL_TYPE_MEDIUM_BLOB = 0xfa,
    MYSQL_TYPE_LONG_BLOB = 0xfb,
    MYSQL_TYPE_BLOB = 0xfc,
    MYSQL_TYPE_VAR_STRING = 0xfd,
    MYSQL_TYPE_STRING = 0xfe,
    MYSQL_TYPE_GEOMETRY = 0xff,
    _,

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue) bun.JSError!FieldType {
        if (value.isEmptyOrUndefinedOrNull()) {
            return .MYSQL_TYPE_NULL;
        }

        if (value.isCell()) {
            const tag = value.jsType();
            if (tag.isStringLike()) {
                return .MYSQL_TYPE_VARCHAR;
            }

            if (tag == .JSDate) {
                return .MYSQL_TYPE_DATETIME;
            }

            if (tag.isTypedArray()) {
                return .MYSQL_TYPE_BLOB;
            }

            if (tag == .HeapBigInt) {
                return .MYSQL_TYPE_LONGLONG;
            }

            if (tag.isArrayLike() and value.getLength(globalObject) > 0) {
                return FieldType.fromJS(globalObject, value.getIndex(globalObject, 0));
            }
            if (globalObject.hasException()) return error.JSError;

            // Ban these types:
            if (tag == .NumberObject) {
                return error.JSError;
            }

            if (tag == .BooleanObject) {
                return error.JSError;
            }

            // It's something internal
            if (!tag.isIndexable()) {
                return error.JSError;
            }

            // We will JSON.stringify anything else.
            if (tag.isObject()) {
                return .MYSQL_TYPE_JSON;
            }
        }

        if (value.isAnyInt()) {
            const int = value.toInt64();
            if (int >= std.math.minInt(u24) and int <= std.math.maxInt(u24)) {
                return .MYSQL_TYPE_INT24;
            }

            return .MYSQL_TYPE_LONGLONG;
        }

        if (value.isNumber()) {
            return .MYSQL_TYPE_DOUBLE;
        }

        if (value.isBoolean()) {
            return .MYSQL_TYPE_TINY;
        }

        return .numeric;
    }

    pub fn isBinaryFormatSupported(this: FieldType) bool {
        return switch (this) {
            .MYSQL_TYPE_TINY,
            .MYSQL_TYPE_SHORT,
            .MYSQL_TYPE_LONG,
            .MYSQL_TYPE_FLOAT,
            .MYSQL_TYPE_DOUBLE,
            .MYSQL_TYPE_LONGLONG,
            .MYSQL_TYPE_TIME,
            .MYSQL_TYPE_DATE,
            .MYSQL_TYPE_DATETIME,
            .MYSQL_TYPE_TIMESTAMP,
            .MYSQL_TYPE_TINY_BLOB,
            .MYSQL_TYPE_MEDIUM_BLOB,
            .MYSQL_TYPE_LONG_BLOB,
            .MYSQL_TYPE_BLOB,
            .MYSQL_TYPE_STRING,
            .MYSQL_TYPE_VARCHAR,
            .MYSQL_TYPE_VAR_STRING,
            .MYSQL_TYPE_JSON,
            => true,
            else => false,
        };
    }

    pub fn toJSType(this: FieldType) JSValue.JSType {
        return switch (this) {
            .MYSQL_TYPE_TINY,
            .MYSQL_TYPE_SHORT,
            .MYSQL_TYPE_LONG,
            .MYSQL_TYPE_INT24,
            .MYSQL_TYPE_YEAR,
            => .NumberObject,

            .MYSQL_TYPE_LONGLONG => .BigInt64Array,
            .MYSQL_TYPE_FLOAT,
            .MYSQL_TYPE_DOUBLE,
            .MYSQL_TYPE_DECIMAL,
            .MYSQL_TYPE_NEWDECIMAL,
            => .Float64Array,

            .MYSQL_TYPE_NULL => .Null,
            .MYSQL_TYPE_JSON => .Object,
            .MYSQL_TYPE_TIMESTAMP,
            .MYSQL_TYPE_DATETIME,
            .MYSQL_TYPE_DATE,
            .MYSQL_TYPE_TIME,
            => .JSDate,

            else => .String,
        };
    }
};

// Will continue implementing:
// - Value parsing functions for each type
// - Binary format encoding/decoding
// - Date/time handling
// - Decimal handling
// - JSON handling

pub const Value = union(enum) {
    null,
    bool: bool,
    short: i16,
    int: i32,
    long: i64,
    float: f32,
    double: f64,
    string: []const u8,
    bytes: []const u8,
    date: DateTime,
    time: Time,
    decimal: Decimal,

    pub const Timestamp = struct {
        seconds: u32,
        microseconds: u24,

        pub fn fromBinary(val: []const u8) Timestamp {
            return .{
                // Bytes 0-3: [seconds]  (32-bit little-endian unsigned integer)
                //    Number of seconds since Unix epoch
                .seconds = std.mem.readInt(u32, val[0..4], .little),
                // Bytes 4-6: [microseconds] (24-bit little-endian unsigned integer)
                .microseconds = if (val.len == 7) std.mem.readInt(u24, val[4..7], .little) else 0,
            };
        }

        pub fn toUnixTimestamp(this: Timestamp) f64 {
            return @as(f64, @floatFromInt(this.seconds)) + @as(f64, @floatFromInt(this.microseconds)) / 1_000_000;
        }

        pub fn toJS(this: Timestamp, globalObject: *JSC.JSGlobalObject) JSValue {
            return JSValue.fromDateNumber(globalObject, @floatFromInt(this.toUnixTimestamp() * 1000));
        }
    };

    pub const DateTime = struct {
        year: u16 = 0,
        month: u8 = 0,
        day: u8 = 0,
        hour: u8 = 0,
        minute: u8 = 0,
        second: u8 = 0,
        microsecond: u32 = 0,

        pub fn fromBinaryDate(val: []const u8) DateTime {
            return .{
                .year = std.mem.readInt(u16, val[0..2], .little),
                .month = val[2],
                .day = val[3],
            };
        }

        pub fn fromBinary(val: []const u8) DateTime {
            switch (val.len) {
                4 => {
                    // Byte 1: [year LSB]     (8 bits of year)
                    // Byte 2: [year MSB]     (8 bits of year)
                    // Byte 3: [month]        (8-bit unsigned integer, 1-12)
                    // Byte 4: [day]          (8-bit unsigned integer, 1-31)
                    return .{
                        .year = std.mem.readInt(u16, val[0..2], .little),
                        .month = val[2],
                        .day = val[3],
                    };
                },
                7 => {
                    //                     Byte 1: [year LSB]     (8 bits of year)
                    // Byte 2: [year MSB]     (8 bits of year)
                    // Byte 3: [month]        (8-bit unsigned integer, 1-12)
                    // Byte 4: [day]          (8-bit unsigned integer, 1-31)
                    // Byte 5: [hour]         (8-bit unsigned integer, 0-23)
                    // Byte 6: [minute]       (8-bit unsigned integer, 0-59)
                    // Byte 7: [second]       (8-bit unsigned integer, 0-59)
                    return .{
                        .year = std.mem.readInt(u16, val[0..2], .little),
                        .month = val[3],
                        .day = val[4],
                        .hour = val[5],
                        .minute = val[6],
                        .second = val[7],
                    };
                },
                11 => {
                    //                     Byte 1:    [year LSB]      (8 bits of year)
                    // Byte 2:    [year MSB]      (8 bits of year)
                    // Byte 3:    [month]         (8-bit unsigned integer, 1-12)
                    // Byte 4:    [day]           (8-bit unsigned integer, 1-31)
                    // Byte 5:    [hour]          (8-bit unsigned integer, 0-23)
                    // Byte 6:    [minute]        (8-bit unsigned integer, 0-59)
                    // Byte 7:    [second]        (8-bit unsigned integer, 0-59)
                    // Byte 8-11: [microseconds]  (32-bit little-endian unsigned integer
                    return .{
                        .year = std.mem.readInt(u16, val[0..2], .little),
                        .month = val[3],
                        .day = val[4],
                        .hour = val[5],
                        .minute = val[6],
                        .second = val[7],
                        .microsecond = std.mem.readInt(u32, val[8..12], .little),
                    };
                },
                else => bun.Output.panic("Invalid datetime length: {d}", .{val.len}),
            }
        }

        pub fn toUnixTimestamp(this: DateTime) i64 {
            // Convert to Unix timestamp (seconds since 1970-01-01)
            var ts: i64 = 0;
            const days = gregorianDays(this.year, this.month, this.day);
            ts += days * 86400;
            ts += @as(i64, this.hour) * 3600;
            ts += @as(i64, this.minute) * 60;
            ts += this.second;
            return ts;
        }

        pub fn fromUnixTimestamp(timestamp: i64) DateTime {
            var ts = timestamp;
            const days = @divFloor(ts, 86400);
            ts = @mod(ts, 86400);

            const hour = @divFloor(ts, 3600);
            ts = @mod(ts, 3600);

            const minute = @divFloor(ts, 60);
            const second = @mod(ts, 60);

            const date = gregorianDate(@intCast(days));
            return .{
                .year = date.year,
                .month = date.month,
                .day = date.day,
                .hour = @intCast(hour),
                .minute = @intCast(minute),
                .second = @intCast(second),
            };
        }

        pub fn toJS(this: DateTime, globalObject: *JSC.JSGlobalObject) JSValue {
            const ts = this.toUnixTimestamp();
            return JSValue.fromDateNumber(globalObject, @floatFromInt(ts * 1000));
        }

        pub fn fromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) DateTime {
            _ = globalObject; // autofix
            const ts = @divFloor(@as(i64, @intFromFloat(value.getUnixTimestamp())), 1000);
            return DateTime.fromUnixTimestamp(ts);
        }
    };

    pub const Time = struct {
        negative: bool = false,
        days: u32 = 0,
        hours: u8 = 0,
        minutes: u8 = 0,
        seconds: u8 = 0,
        microseconds: u32 = 0,

        pub fn fromBinary(val: []const u8) Time {
            if (val.len == 0) {
                return Time{};
            }

            var time = Time{};
            const length = val[0];

            if (length >= 8) {
                time.negative = val[1] != 0;
                time.days = std.mem.readInt(.little, val[2..6]);
                time.hours = val[6];
                time.minutes = val[7];
                time.seconds = val[8];
            }

            if (length > 8) {
                time.microseconds = std.mem.readInt(.little, val[9..13]);
            }

            return time;
        }

        pub fn toJS(this: Time, globalObject: *JSC.JSGlobalObject) JSValue {
            _ = globalObject; // autofix
            var total_ms: i64 = 0;
            total_ms += @as(i64, this.days) * 86400000;
            total_ms += @as(i64, this.hours) * 3600000;
            total_ms += @as(i64, this.minutes) * 60000;
            total_ms += @as(i64, this.seconds) * 1000;
            total_ms += @divFloor(this.microseconds, 1000);

            if (this.negative) {
                total_ms = -total_ms;
            }

            return JSValue.jsNumber(@floatFromInt(total_ms));
        }
    };

    pub const Decimal = struct {
        // MySQL DECIMAL is stored as a sequence of base-10 digits
        digits: []const u8,
        scale: u8,
        negative: bool,

        pub fn deinit(this: *Decimal, allocator: std.mem.Allocator) void {
            allocator.free(this.digits);
        }

        pub fn toJS(this: Decimal, globalObject: *JSC.JSGlobalObject) JSValue {
            var stack = std.heap.stackFallback(64, bun.default_allocator);
            var str = std.ArrayList(u8).init(stack.get());
            defer str.deinit();

            if (this.negative) {
                str.append('-') catch return JSValue.jsNumber(0);
            }

            const decimal_pos = this.digits.len - this.scale;
            for (this.digits, 0..) |digit, i| {
                if (i == decimal_pos and this.scale > 0) {
                    str.append('.') catch return JSValue.jsNumber(0);
                }
                str.append(digit + '0') catch return JSValue.jsNumber(0);
            }

            var js_str = bun.String.createUTF8(str.items);
            return js_str.transferToJS(globalObject);
        }
    };

    pub fn deinit(this: *Value, allocator: std.mem.Allocator) void {
        switch (this.*) {
            .string => |str| allocator.free(str),
            .bytes => |bytes| allocator.free(bytes),
            .decimal => |*decimal| decimal.deinit(allocator),
            else => {},
        }
    }

    pub fn toJS(this: Value, globalObject: *JSC.JSGlobalObject) JSValue {
        return switch (this) {
            .null => JSValue.jsNull(),
            .int => |i| JSValue.jsNumber(@floatFromInt(i)),
            .float => |f| JSValue.jsNumber(f),
            .double => |d| JSValue.jsNumber(d),
            .string => |str| JSC.ZigString.init(str).toJS(globalObject),
            .bytes => JSValue.createBuffer(globalObject, this.bytes, null),
            .date => |d| d.toJS(globalObject),
            .time => |t| t.toJS(globalObject),
            .decimal => |d| d.toJS(globalObject),
            .long => |l| JSValue.toInt64(@floatFromInt(l)),
            .short => |s| JSValue.jsNumber(@floatFromInt(s)),
        };
    }
};

// Helper functions for date calculations
fn isLeapYear(year: u16) bool {
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0;
}

fn daysInMonth(year: u16, month: u8) u8 {
    const days = [_]u8{ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    if (month == 2 and isLeapYear(year)) {
        return 29;
    }
    return days[month - 1];
}

fn gregorianDays(year: u16, month: u8, day: u8) i32 {
    // Calculate days since 1970-01-01
    const y = @as(i32, year) - 1970;
    var days: i32 = y * 365 + @divFloor(y, 4) - @divFloor(y, 100) + @divFloor(y, 400);

    var m = month;
    while (m > 1) : (m -= 1) {
        days += daysInMonth(year, m - 1);
    }

    return days + day - 1;
}

const Date = struct {
    year: u16,
    month: u8,
    day: u8,
};

fn gregorianDate(days: i32) Date {
    // Convert days since 1970-01-01 to year/month/day
    var d = days;
    var y: u16 = 1970;

    while (d >= 365 + @intFromBool(isLeapYear(y))) : (y += 1) {
        d -= 365 + @intFromBool(isLeapYear(y));
    }

    var m: u8 = 1;
    while (d >= daysInMonth(y, m)) : (m += 1) {
        d -= daysInMonth(y, m);
    }

    return .{
        .year = y,
        .month = m,
        .day = @intCast(d + 1),
    };
}
