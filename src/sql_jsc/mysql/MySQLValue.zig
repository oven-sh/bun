//! `Value` union + JSC bridges for MySQL type encoding. Split from
//! `sql/mysql/MySQLTypes.zig` so the protocol layer keeps the pure
//! `CharacterSet`/`FieldType` enums without `JSValue` references.

pub const fieldTypeFromJS = struct {
    pub fn call(globalObject: *JSC.JSGlobalObject, value: JSValue, unsigned: *bool) bun.JSError!FieldType {
        if (value.isEmptyOrUndefinedOrNull()) {
            return .MYSQL_TYPE_NULL;
        }

        if (value.isCell()) {
            const tag = value.jsType();
            if (tag.isStringLike()) {
                return .MYSQL_TYPE_STRING;
            }

            if (tag == .JSDate) {
                return .MYSQL_TYPE_DATETIME;
            }

            if (tag.isTypedArrayOrArrayBuffer()) {
                return .MYSQL_TYPE_BLOB;
            }

            if (tag == .HeapBigInt) {
                if (value.isBigIntInInt64Range(std.math.minInt(i64), std.math.maxInt(i64))) {
                    return .MYSQL_TYPE_LONGLONG;
                }
                if (value.isBigIntInUInt64Range(0, std.math.maxInt(u64))) {
                    unsigned.* = true;
                    return .MYSQL_TYPE_LONGLONG;
                }
                return globalObject.ERR(.OUT_OF_RANGE, "The value is out of range. It must be >= {d} and <= {d}.", .{ std.math.minInt(i64), std.math.maxInt(u64) }).throw();
            }

            if (globalObject.hasException()) return error.JSError;

            // Ban these types:
            if (tag == .NumberObject) {
                return globalObject.throwInvalidArguments("Cannot bind NumberObject to query parameter. Use a primitive number instead.", .{});
            }

            if (tag == .BooleanObject) {
                return globalObject.throwInvalidArguments("Cannot bind BooleanObject to query parameter. Use a primitive boolean instead.", .{});
            }

            // It's something internal
            if (!tag.isIndexable()) {
                return globalObject.throwInvalidArguments("Cannot bind this type to query parameter", .{});
            }

            // We will JSON.stringify anything else.
            if (tag.isObject()) {
                return .MYSQL_TYPE_JSON;
            }
        }

        if (value.isAnyInt()) {
            const int = value.toInt64();

            if (int >= 0) {
                if (int <= std.math.maxInt(i32)) {
                    return .MYSQL_TYPE_LONG;
                }
                if (int <= std.math.maxInt(u32)) {
                    unsigned.* = true;
                    return .MYSQL_TYPE_LONG;
                }
                if (int >= std.math.maxInt(i64)) {
                    unsigned.* = true;
                    return .MYSQL_TYPE_LONGLONG;
                }
                return .MYSQL_TYPE_LONGLONG;
            }
            if (int >= std.math.minInt(i32)) {
                return .MYSQL_TYPE_LONG;
            }
            return .MYSQL_TYPE_LONGLONG;
        }

        if (value.isNumber()) {
            return .MYSQL_TYPE_DOUBLE;
        }

        if (value.isBoolean()) {
            return .MYSQL_TYPE_TINY;
        }

        return .MYSQL_TYPE_VARCHAR;
    }
}.call;

pub const Value = union(enum) {
    null,
    bool: bool,
    short: i16,
    ushort: u16,
    int: i32,
    uint: u32,
    long: i64,
    ulong: u64,
    float: f32,
    double: f64,

    string: JSC.ZigString.Slice,
    string_data: Data,
    bytes: Bytes,
    bytes_data: Data,
    date: DateTime,
    time: Time,
    // decimal: Decimal,

    /// BLOB parameter bytes. `MySQLQuery.bind()` fills every `Value` before
    /// `execute.write()` reads any of them, and converting later parameters
    /// can run user JS (array index getters, toJSON, toString coercion). That
    /// JS could `transfer()`/detach an earlier ArrayBuffer, or drop the last
    /// JS reference to it and force GC, while we still hold a borrowed slice
    /// into it. Pinning the backing `ArrayBuffer` makes it non-detachable for
    /// the duration (`transfer()` then hands the user a copy), and the
    /// caller's stack-scoped `MarkedArgumentBuffer` roots the wrapper so GC
    /// can't sweep the cell whose `RefPtr<ArrayBuffer>` keeps the storage
    /// alive — `params` is on the malloc heap and isn't scanned. `deinit()`
    /// unpins.
    pub const Bytes = struct {
        slice: JSC.ZigString.Slice = .empty,
        /// JS ArrayBuffer/view to `unpinArrayBuffer` in `deinit()`. `.zero`
        /// when the slice is owned (FastTypedArray dupe), borrowed from a
        /// Blob store (nothing to unpin), or empty. GC rooting of this value
        /// is the caller's responsibility via the `MarkedArgumentBuffer`
        /// passed to `fromJS`.
        pinned: JSC.JSValue = .zero,

        pub fn deinit(this: *Bytes) void {
            if (this.pinned != .zero) JSC__JSValue__unpinArrayBuffer(this.pinned);
            this.slice.deinit();
        }
    };

    pub fn deinit(this: *Value, _: std.mem.Allocator) void {
        switch (this.*) {
            .string => |*slice| slice.deinit(),
            .bytes => |*b| b.deinit(),
            inline .string_data, .bytes_data => |*data| data.deinit(),
            // .decimal => |*decimal| decimal.deinit(allocator),
            else => {},
        }
    }

    pub fn toData(
        this: *const Value,
        field_type: FieldType,
    ) AnyMySQLError.Error!Data {
        var buffer: [15]u8 = undefined; // Large enough for all fixed-size types
        var stream = std.io.fixedBufferStream(&buffer);
        var writer = stream.writer();
        switch (this.*) {
            .null => return Data{ .empty = {} },
            .bool => |b| writer.writeByte(if (b) 1 else 0) catch undefined,
            .short => |s| writer.writeInt(i16, s, .little) catch undefined,
            .ushort => |s| writer.writeInt(u16, s, .little) catch undefined,
            .int => |i| writer.writeInt(i32, i, .little) catch undefined,
            .uint => |i| writer.writeInt(u32, i, .little) catch undefined,
            .long => |l| writer.writeInt(i64, l, .little) catch undefined,
            .ulong => |l| writer.writeInt(u64, l, .little) catch undefined,
            .float => |f| writer.writeInt(u32, @bitCast(f), .little) catch undefined,
            .double => |d| writer.writeInt(u64, @bitCast(d), .little) catch undefined,
            inline .date, .time => |d| {
                stream.pos = d.toBinary(field_type, &buffer);
            },
            // .decimal => |dec| return try dec.toBinary(field_type),
            .string_data, .bytes_data => |data| return data,
            .string => |slice| return if (slice.len > 0) Data{ .temporary = slice.slice() } else Data{ .empty = {} },
            .bytes => |b| return if (b.slice.len > 0) Data{ .temporary = b.slice.slice() } else Data{ .empty = {} },
        }

        return try Data.create(buffer[0..stream.pos], bun.default_allocator);
    }

    pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject, field_type: FieldType, unsigned: bool, roots: *JSC.MarkedArgumentBuffer) AnyMySQLError.Error!Value {
        if (value.isEmptyOrUndefinedOrNull()) {
            return Value{ .null = {} };
        }
        return switch (field_type) {
            .MYSQL_TYPE_TINY => Value{ .bool = value.toBoolean() },
            .MYSQL_TYPE_SHORT => {
                if (unsigned) {
                    return Value{ .ushort = try globalObject.validateIntegerRange(value, u16, 0, .{ .min = std.math.minInt(u16), .max = std.math.maxInt(u16), .field_name = "u16" }) };
                }
                return Value{ .short = try globalObject.validateIntegerRange(value, i16, 0, .{ .min = std.math.minInt(i16), .max = std.math.maxInt(i16), .field_name = "i16" }) };
            },
            .MYSQL_TYPE_LONG => {
                if (unsigned) {
                    return Value{ .uint = try globalObject.validateIntegerRange(value, u32, 0, .{ .min = std.math.minInt(u32), .max = std.math.maxInt(u32), .field_name = "u32" }) };
                }
                return Value{ .int = try globalObject.validateIntegerRange(value, i32, 0, .{ .min = std.math.minInt(i32), .max = std.math.maxInt(i32), .field_name = "i32" }) };
            },
            .MYSQL_TYPE_LONGLONG => {
                if (unsigned) {
                    return Value{ .ulong = try globalObject.validateBigIntRange(value, u64, 0, .{ .field_name = "u64", .min = 0, .max = std.math.maxInt(u64) }) };
                }
                return Value{ .long = try globalObject.validateBigIntRange(value, i64, 0, .{ .min = std.math.minInt(i64), .max = std.math.maxInt(i64), .field_name = "i64" }) };
            },

            .MYSQL_TYPE_FLOAT => Value{ .float = @floatCast(try value.coerce(f64, globalObject)) },
            .MYSQL_TYPE_DOUBLE => Value{ .double = try value.coerce(f64, globalObject) },
            .MYSQL_TYPE_TIME => Value{ .time = try Time.fromJS(value, globalObject) },
            .MYSQL_TYPE_DATE, .MYSQL_TYPE_TIMESTAMP, .MYSQL_TYPE_DATETIME => Value{ .date = try DateTime.fromJS(value, globalObject) },
            .MYSQL_TYPE_TINY_BLOB, .MYSQL_TYPE_MEDIUM_BLOB, .MYSQL_TYPE_LONG_BLOB, .MYSQL_TYPE_BLOB => {
                if (value.jsType().isArrayBufferLike()) {
                    // Later parameters in the same bind loop may run user
                    // JS (toString/toJSON/getters) that can transfer() or
                    // detach this buffer before execute.write() reads it.
                    // Pin the backing ArrayBuffer so it stays non-detachable
                    // until Value.deinit() unpins it; borrowing the slice is
                    // then safe without a copy. See `Value.Bytes`.
                    var ptr: [*]const u8 = undefined;
                    var len: usize = 0;
                    return switch (JSC__JSValue__borrowBytesForOffThread(value, &ptr, &len)) {
                        // detached / null
                        0 => Value{ .bytes = .{} },
                        // FastTypedArray — tiny, GC-movable vector; dupe.
                        1 => Value{ .bytes = .{ .slice = try JSC.ZigString.Slice.initDupe(bun.default_allocator, ptr[0..len]) } },
                        // Oversize/Wasteful/DataView/JSArrayBuffer — pinned
                        // by the helper. Root the wrapper so GC can't
                        // collect it (and free the backing store despite
                        // the pin) if user JS drops the last reference from
                        // a later parameter.
                        2 => blk: {
                            roots.append(value);
                            break :blk Value{ .bytes = .{ .slice = JSC.ZigString.Slice.fromUTF8NeverFree(ptr[0..len]), .pinned = value } };
                        },
                        else => unreachable,
                    };
                }

                if (value.as(JSC.WebCore.Blob)) |blob| {
                    if (blob.needsToReadFile()) {
                        return globalObject.throwInvalidArguments("File blobs are not supported", .{});
                    }
                    // Blob byte stores are immutable from JS (no detach),
                    // but user JS running for a later parameter could drop
                    // the last reference and force GC. Root the wrapper so
                    // the store survives until execute.write() has read it.
                    roots.append(value);
                    return Value{ .bytes = .{ .slice = JSC.ZigString.Slice.fromUTF8NeverFree(blob.sharedView()) } };
                }

                if (value.isString()) {
                    const str = try bun.String.fromJS(value, globalObject);
                    defer str.deref();
                    return Value{ .string = str.toUTF8(bun.default_allocator) };
                }

                return globalObject.throwInvalidArguments("Expected a string, blob, or array buffer", .{});
            },

            .MYSQL_TYPE_JSON => {
                var str: bun.String = bun.String.empty;
                // Use jsonStringifyFast for SIMD-optimized serialization
                try value.jsonStringifyFast(globalObject, &str);
                defer str.deref();
                return Value{ .string = str.toUTF8(bun.default_allocator) };
            },

            //   .MYSQL_TYPE_VARCHAR, .MYSQL_TYPE_VAR_STRING, .MYSQL_TYPE_STRING => {
            else => {
                const str = try bun.String.fromJS(value, globalObject);
                defer str.deref();
                return Value{ .string = str.toUTF8(bun.default_allocator) };
            },
        };
    }

    pub const DateTime = struct {
        year: u16 = 0,
        month: u8 = 0,
        day: u8 = 0,
        hour: u8 = 0,
        minute: u8 = 0,
        second: u8 = 0,
        microsecond: u32 = 0,

        pub fn fromData(data: *const Data) !DateTime {
            return fromBinary(data.slice());
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
                        .month = val[2],
                        .day = val[3],
                        .hour = val[4],
                        .minute = val[5],
                        .second = val[6],
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
                        .month = val[2],
                        .day = val[3],
                        .hour = val[4],
                        .minute = val[5],
                        .second = val[6],
                        .microsecond = std.mem.readInt(u32, val[7..11], .little),
                    };
                },
                else => bun.Output.panic("Invalid datetime length: {d}", .{val.len}),
            }
        }

        pub fn toBinary(this: *const DateTime, field_type: FieldType, buffer: []u8) u8 {
            switch (field_type) {
                .MYSQL_TYPE_YEAR => {
                    buffer[0] = 2;
                    std.mem.writeInt(u16, buffer[1..3], this.year, .little);
                    return 3;
                },
                .MYSQL_TYPE_DATE => {
                    buffer[0] = 4;
                    std.mem.writeInt(u16, buffer[1..3], this.year, .little);
                    buffer[3] = this.month;
                    buffer[4] = this.day;
                    return 5;
                },
                .MYSQL_TYPE_DATETIME => {
                    buffer[0] = if (this.microsecond == 0) 7 else 11;
                    std.mem.writeInt(u16, buffer[1..3], this.year, .little);
                    buffer[3] = this.month;
                    buffer[4] = this.day;
                    buffer[5] = this.hour;
                    buffer[6] = this.minute;
                    buffer[7] = this.second;
                    if (this.microsecond == 0) {
                        return 8;
                    } else {
                        std.mem.writeInt(u32, buffer[8..12], this.microsecond, .little);
                        return 12;
                    }
                },
                else => return 0,
            }
        }

        pub fn toJSTimestamp(this: *const DateTime, globalObject: *JSC.JSGlobalObject) bun.JSError!f64 {
            return globalObject.gregorianDateTimeToMS(
                this.year,
                this.month,
                this.day,
                this.hour,
                this.minute,
                this.second,
                if (this.microsecond > 0) @intCast(@divFloor(this.microsecond, 1000)) else 0,
            );
        }

        pub fn fromUnixTimestamp(timestamp: i64, microseconds: u32) DateTime {
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
                .microsecond = microseconds,
            };
        }

        pub fn toJS(this: DateTime, globalObject: *JSC.JSGlobalObject) JSValue {
            return JSValue.fromDateNumber(globalObject, this.toJSTimestamp());
        }

        pub fn fromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) !DateTime {
            if (value.isDate()) {
                // this is actually ms not seconds
                const total_ms = value.getUnixTimestamp();
                const ts: i64 = @intFromFloat(@divFloor(total_ms, 1000));
                const ms: u32 = @intFromFloat(total_ms - (@as(f64, @floatFromInt(ts)) * 1000));
                return DateTime.fromUnixTimestamp(ts, ms * 1000);
            }

            if (value.isNumber()) {
                const total_ms = value.asNumber();
                const ts: i64 = @intFromFloat(@divFloor(total_ms, 1000));
                const ms: u32 = @intFromFloat(total_ms - (@as(f64, @floatFromInt(ts)) * 1000));
                return DateTime.fromUnixTimestamp(ts, ms * 1000);
            }

            return globalObject.throwInvalidArguments("Expected a date or number", .{});
        }
    };

    pub const Time = struct {
        negative: bool = false,
        days: u32 = 0,
        hours: u8 = 0,
        minutes: u8 = 0,
        seconds: u8 = 0,
        microseconds: u32 = 0,

        pub fn fromJS(value: JSValue, globalObject: *JSC.JSGlobalObject) !Time {
            if (value.isDate()) {
                const total_ms = value.getUnixTimestamp();
                const ts: i64 = @intFromFloat(@divFloor(total_ms, 1000));
                const ms: u32 = @intFromFloat(total_ms - (@as(f64, @floatFromInt(ts)) * 1000));
                return Time.fromUnixTimestamp(ts, ms * 1000);
            } else if (value.isNumber()) {
                const total_ms = value.asNumber();
                const ts: i64 = @intFromFloat(@divFloor(total_ms, 1000));
                const ms: u32 = @intFromFloat(total_ms - (@as(f64, @floatFromInt(ts)) * 1000));
                return Time.fromUnixTimestamp(ts, ms * 1000);
            } else {
                return globalObject.throwInvalidArguments("Expected a date or number", .{});
            }
        }

        pub fn fromUnixTimestamp(timestamp: i64, microseconds: u32) Time {
            const days = @divFloor(timestamp, 86400);
            const hours = @divFloor(@mod(timestamp, 86400), 3600);
            const minutes = @divFloor(@mod(timestamp, 3600), 60);
            const seconds = @mod(timestamp, 60);
            return .{
                .negative = timestamp < 0,
                .days = @intCast(days),
                .hours = @intCast(hours),
                .minutes = @intCast(minutes),
                .seconds = @intCast(seconds),
                .microseconds = microseconds,
            };
        }

        pub fn toUnixTimestamp(this: *const Time) i64 {
            var total_ms: i64 = 0;
            total_ms +|= @as(i64, this.days) *| 86400000;
            total_ms +|= @as(i64, this.hours) *| 3600000;
            total_ms +|= @as(i64, this.minutes) *| 60000;
            total_ms +|= @as(i64, this.seconds) *| 1000;
            return total_ms;
        }

        pub fn fromData(data: *const Data) !Time {
            return fromBinary(data.slice());
        }

        pub fn fromBinary(val: []const u8) Time {
            if (val.len == 0) {
                return Time{};
            }

            var time = Time{};
            if (val.len >= 8) {
                time.negative = val[0] != 0;
                time.days = std.mem.readInt(u32, val[1..5], .little);
                time.hours = val[5];
                time.minutes = val[6];
                time.seconds = val[7];
            }

            if (val.len > 8) {
                time.microseconds = std.mem.readInt(u32, val[8..12], .little);
            }

            return time;
        }
        pub fn toJSTimestamp(this: *const Time) f64 {
            var total_ms: i64 = 0;
            total_ms +|= @as(i64, this.days) * 86400000;
            total_ms +|= @as(i64, this.hours) * 3600000;
            total_ms +|= @as(i64, this.minutes) * 60000;
            total_ms +|= @as(i64, this.seconds) * 1000;
            total_ms +|= @divFloor(this.microseconds, 1000);

            if (this.negative) {
                total_ms = -total_ms;
            }

            return @as(f64, @floatFromInt(total_ms));
        }
        pub fn toJS(this: Time, _: *JSC.JSGlobalObject) JSValue {
            return JSValue.jsDoubleNumber(this.toJSTimestamp());
        }

        pub fn toBinary(this: *const Time, field_type: FieldType, buffer: []u8) u8 {
            switch (field_type) {
                .MYSQL_TYPE_TIME, .MYSQL_TYPE_TIME2 => {
                    buffer[1] = if (this.negative) 1 else 0;
                    std.mem.writeInt(u32, buffer[2..6], this.days, .little);
                    buffer[6] = this.hours;
                    buffer[7] = this.minutes;
                    buffer[8] = this.seconds;
                    if (this.microseconds == 0) {
                        buffer[0] = 8; // length
                        return 9;
                    } else {
                        buffer[0] = 12; // length
                        std.mem.writeInt(u32, buffer[9..][0..4], this.microseconds, .little);
                        return 12;
                    }
                },
                else => unreachable,
            }
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
            var str = std.array_list.Managed(u8).init(stack.get());
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

            return bun.String.createUTF8ForJS(globalObject, str.items) catch .zero;
        }

        pub fn toBinary(_: Decimal, _: FieldType) !Data {
            bun.todoPanic(@src(), "Decimal.toBinary not implemented", .{});
        }

        // pub fn fromData(data: *const Data) !Decimal {
        //     return fromBinary(data.slice());
        // }

        // pub fn fromBinary(_: []const u8) Decimal {
        //     bun.todoPanic(@src(), "Decimal.toBinary not implemented", .{});
        // }
    };
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

const Date = struct {
    year: u16,
    month: u8,
    day: u8,
};

fn gregorianDate(days: i32) Date {
    // Convert days since 1970-01-01 to year/month/day
    var d = days;
    var y: u16 = 1970;

    while (d >= 365 + @as(u16, @intFromBool(isLeapYear(y)))) : (y += 1) {
        d -= 365 + @as(u16, @intFromBool(isLeapYear(y)));
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

extern fn JSC__JSValue__unpinArrayBuffer(v: JSC.JSValue) void;
/// 0 = detached/null, 1 = FastTypedArray (GC-movable — caller should dupe;
/// no unpin needed), 2 = pinned ArrayBuffer (caller must `unpinArrayBuffer`).
extern fn JSC__JSValue__borrowBytesForOffThread(v: JSC.JSValue, out_ptr: *[*]const u8, out_len: *usize) i32;

const AnyMySQLError = @import("../../sql/mysql/protocol/AnyMySQLError.zig");
const std = @import("std");
const Data = @import("../../sql/shared/Data.zig").Data;

const types = @import("../../sql/mysql/MySQLTypes.zig");
const FieldType = types.FieldType;

const bun = @import("bun");
const String = bun.String;

const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
