pub const CharacterSet = enum(u8) {
    big5_chinese_ci = 1,
    latin2_czech_cs = 2,
    dec8_swedish_ci = 3,
    cp850_general_ci = 4,
    latin1_german1_ci = 5,
    hp8_english_ci = 6,
    koi8r_general_ci = 7,
    latin1_swedish_ci = 8,
    latin2_general_ci = 9,
    swe7_swedish_ci = 10,
    ascii_general_ci = 11,
    ujis_japanese_ci = 12,
    sjis_japanese_ci = 13,
    cp1251_bulgarian_ci = 14,
    latin1_danish_ci = 15,
    hebrew_general_ci = 16,
    tis620_thai_ci = 18,
    euckr_korean_ci = 19,
    latin7_estonian_cs = 20,
    latin2_hungarian_ci = 21,
    koi8u_general_ci = 22,
    cp1251_ukrainian_ci = 23,
    gb2312_chinese_ci = 24,
    greek_general_ci = 25,
    cp1250_general_ci = 26,
    latin2_croatian_ci = 27,
    gbk_chinese_ci = 28,
    cp1257_lithuanian_ci = 29,
    latin5_turkish_ci = 30,
    latin1_german2_ci = 31,
    armscii8_general_ci = 32,
    utf8mb3_general_ci = 33,
    cp1250_czech_cs = 34,
    ucs2_general_ci = 35,
    cp866_general_ci = 36,
    keybcs2_general_ci = 37,
    macce_general_ci = 38,
    macroman_general_ci = 39,
    cp852_general_ci = 40,
    latin7_general_ci = 41,
    latin7_general_cs = 42,
    macce_bin = 43,
    cp1250_croatian_ci = 44,
    utf8mb4_general_ci = 45,
    utf8mb4_bin = 46,
    latin1_bin = 47,
    latin1_general_ci = 48,
    latin1_general_cs = 49,
    cp1251_bin = 50,
    cp1251_general_ci = 51,
    cp1251_general_cs = 52,
    macroman_bin = 53,
    utf16_general_ci = 54,
    utf16_bin = 55,
    utf16le_general_ci = 56,
    cp1256_general_ci = 57,
    cp1257_bin = 58,
    cp1257_general_ci = 59,
    utf32_general_ci = 60,
    utf32_bin = 61,
    utf16le_bin = 62,
    binary = 63,
    armscii8_bin = 64,
    ascii_bin = 65,
    cp1250_bin = 66,
    cp1256_bin = 67,
    cp866_bin = 68,
    dec8_bin = 69,
    greek_bin = 70,
    hebrew_bin = 71,
    hp8_bin = 72,
    keybcs2_bin = 73,
    koi8r_bin = 74,
    koi8u_bin = 75,
    utf8mb3_tolower_ci = 76,
    latin2_bin = 77,
    latin5_bin = 78,
    latin7_bin = 79,
    cp850_bin = 80,
    cp852_bin = 81,
    swe7_bin = 82,
    utf8mb3_bin = 83,
    big5_bin = 84,
    euckr_bin = 85,
    gb2312_bin = 86,
    gbk_bin = 87,
    sjis_bin = 88,
    tis620_bin = 89,
    ucs2_bin = 90,
    ujis_bin = 91,
    geostd8_general_ci = 92,
    geostd8_bin = 93,
    latin1_spanish_ci = 94,
    cp932_japanese_ci = 95,
    cp932_bin = 96,
    eucjpms_japanese_ci = 97,
    eucjpms_bin = 98,
    cp1250_polish_ci = 99,
    utf16_unicode_ci = 101,
    utf16_icelandic_ci = 102,
    utf16_latvian_ci = 103,
    utf16_romanian_ci = 104,
    utf16_slovenian_ci = 105,
    utf16_polish_ci = 106,
    utf16_estonian_ci = 107,
    utf16_spanish_ci = 108,
    utf16_swedish_ci = 109,
    utf16_turkish_ci = 110,
    utf16_czech_ci = 111,
    utf16_danish_ci = 112,
    utf16_lithuanian_ci = 113,
    utf16_slovak_ci = 114,
    utf16_spanish2_ci = 115,
    utf16_roman_ci = 116,
    utf16_persian_ci = 117,
    utf16_esperanto_ci = 118,
    utf16_hungarian_ci = 119,
    utf16_sinhala_ci = 120,
    utf16_german2_ci = 121,
    utf16_croatian_ci = 122,
    utf16_unicode_520_ci = 123,
    utf16_vietnamese_ci = 124,
    ucs2_unicode_ci = 128,
    ucs2_icelandic_ci = 129,
    ucs2_latvian_ci = 130,
    ucs2_romanian_ci = 131,
    ucs2_slovenian_ci = 132,
    ucs2_polish_ci = 133,
    ucs2_estonian_ci = 134,
    ucs2_spanish_ci = 135,
    ucs2_swedish_ci = 136,
    ucs2_turkish_ci = 137,
    ucs2_czech_ci = 138,
    ucs2_danish_ci = 139,
    ucs2_lithuanian_ci = 140,
    ucs2_slovak_ci = 141,
    ucs2_spanish2_ci = 142,
    ucs2_roman_ci = 143,
    ucs2_persian_ci = 144,
    ucs2_esperanto_ci = 145,
    ucs2_hungarian_ci = 146,
    ucs2_sinhala_ci = 147,
    ucs2_german2_ci = 148,
    ucs2_croatian_ci = 149,
    ucs2_unicode_520_ci = 150,
    ucs2_vietnamese_ci = 151,
    ucs2_general_mysql500_ci = 159,
    utf32_unicode_ci = 160,
    utf32_icelandic_ci = 161,
    utf32_latvian_ci = 162,
    utf32_romanian_ci = 163,
    utf32_slovenian_ci = 164,
    utf32_polish_ci = 165,
    utf32_estonian_ci = 166,
    utf32_spanish_ci = 167,
    utf32_swedish_ci = 168,
    utf32_turkish_ci = 169,
    utf32_czech_ci = 170,
    utf32_danish_ci = 171,
    utf32_lithuanian_ci = 172,
    utf32_slovak_ci = 173,
    utf32_spanish2_ci = 174,
    utf32_roman_ci = 175,
    utf32_persian_ci = 176,
    utf32_esperanto_ci = 177,
    utf32_hungarian_ci = 178,
    utf32_sinhala_ci = 179,
    utf32_german2_ci = 180,
    utf32_croatian_ci = 181,
    utf32_unicode_520_ci = 182,
    utf32_vietnamese_ci = 183,
    utf8mb3_unicode_ci = 192,
    utf8mb3_icelandic_ci = 193,
    utf8mb3_latvian_ci = 194,
    utf8mb3_romanian_ci = 195,
    utf8mb3_slovenian_ci = 196,
    utf8mb3_polish_ci = 197,
    utf8mb3_estonian_ci = 198,
    utf8mb3_spanish_ci = 199,
    utf8mb3_swedish_ci = 200,
    utf8mb3_turkish_ci = 201,
    utf8mb3_czech_ci = 202,
    utf8mb3_danish_ci = 203,
    utf8mb3_lithuanian_ci = 204,
    utf8mb3_slovak_ci = 205,
    utf8mb3_spanish2_ci = 206,
    utf8mb3_roman_ci = 207,
    utf8mb3_persian_ci = 208,
    utf8mb3_esperanto_ci = 209,
    utf8mb3_hungarian_ci = 210,
    utf8mb3_sinhala_ci = 211,
    utf8mb3_german2_ci = 212,
    utf8mb3_croatian_ci = 213,
    utf8mb3_unicode_520_ci = 214,
    utf8mb3_vietnamese_ci = 215,
    utf8mb3_general_mysql500_ci = 223,
    utf8mb4_unicode_ci = 224,
    utf8mb4_icelandic_ci = 225,
    utf8mb4_latvian_ci = 226,
    utf8mb4_romanian_ci = 227,
    utf8mb4_slovenian_ci = 228,
    utf8mb4_polish_ci = 229,
    utf8mb4_estonian_ci = 230,
    utf8mb4_spanish_ci = 231,
    utf8mb4_swedish_ci = 232,
    utf8mb4_turkish_ci = 233,
    utf8mb4_czech_ci = 234,
    utf8mb4_danish_ci = 235,
    utf8mb4_lithuanian_ci = 236,
    utf8mb4_slovak_ci = 237,
    utf8mb4_spanish2_ci = 238,
    utf8mb4_roman_ci = 239,
    utf8mb4_persian_ci = 240,
    utf8mb4_esperanto_ci = 241,
    utf8mb4_hungarian_ci = 242,
    utf8mb4_sinhala_ci = 243,
    utf8mb4_german2_ci = 244,
    utf8mb4_croatian_ci = 245,
    utf8mb4_unicode_520_ci = 246,
    utf8mb4_vietnamese_ci = 247,
    gb18030_chinese_ci = 248,
    gb18030_bin = 249,
    gb18030_unicode_520_ci = 250,
    _,

    pub const default = CharacterSet.utf8mb4_general_ci;

    pub fn label(this: CharacterSet) []const u8 {
        if (@intFromEnum(this) < 100 and @intFromEnum(this) > 0) {
            return @tagName(this);
        }

        return "(unknown)";
    }
};

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
    MYSQL_TYPE_INT24 = 0x09, // MEDIUMINT
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

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue, unsigned: *bool) bun.JSError!FieldType {
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

    pub fn isBinaryFormatSupported(this: FieldType) bool {
        return switch (this) {
            .MYSQL_TYPE_TINY,
            .MYSQL_TYPE_SHORT,
            .MYSQL_TYPE_LONG,
            .MYSQL_TYPE_LONGLONG,
            .MYSQL_TYPE_FLOAT,
            .MYSQL_TYPE_DOUBLE,
            .MYSQL_TYPE_TIME,
            .MYSQL_TYPE_DATE,
            .MYSQL_TYPE_DATETIME,
            .MYSQL_TYPE_TIMESTAMP,
            => true,
            else => false,
        };
    }
};

// Add this near the top of the file
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
    bytes: JSC.ZigString.Slice,
    bytes_data: Data,
    date: DateTime,
    time: Time,
    // decimal: Decimal,

    pub fn deinit(this: *Value, _: std.mem.Allocator) void {
        switch (this.*) {
            inline .string, .bytes => |*slice| slice.deinit(),
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
            .string, .bytes => |slice| return if (slice.len > 0) Data{ .temporary = slice.slice() } else Data{ .empty = {} },
        }

        return try Data.create(buffer[0..stream.pos], bun.default_allocator);
    }

    pub fn fromJS(value: JSC.JSValue, globalObject: *JSC.JSGlobalObject, field_type: FieldType, unsigned: bool) AnyMySQLError.Error!Value {
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
                if (value.asArrayBuffer(globalObject)) |array_buffer| {
                    return Value{ .bytes = JSC.ZigString.Slice.fromUTF8NeverFree(array_buffer.slice()) };
                }

                if (value.as(JSC.WebCore.Blob)) |blob| {
                    if (blob.needsToReadFile()) {
                        return globalObject.throwInvalidArguments("File blobs are not supported", .{});
                    }
                    return Value{ .bytes = JSC.ZigString.Slice.fromUTF8NeverFree(blob.sharedView()) };
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

pub const MySQLInt8 = int1;
pub const MySQLInt16 = int2;
pub const MySQLInt24 = int3;
pub const MySQLInt32 = int4;
pub const MySQLInt64 = int8;
pub const int1 = u8;
pub const int2 = u16;
pub const int3 = u24;
pub const int4 = u32;
pub const int8 = u64;

const AnyMySQLError = @import("./protocol/AnyMySQLError.zig");
const std = @import("std");
const Data = @import("../shared/Data.zig").Data;

const bun = @import("bun");
const String = bun.String;

const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
