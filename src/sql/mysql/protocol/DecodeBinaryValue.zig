pub fn decodeBinaryValue(globalObject: *jsc.JSGlobalObject, field_type: types.FieldType, raw: bool, bigint: bool, unsigned: bool, comptime Context: type, reader: NewReader(Context)) !SQLDataCell {
    debug("decodeBinaryValue: {s}", .{@tagName(field_type)});
    return switch (field_type) {
        .MYSQL_TYPE_TINY => {
            if (raw) {
                var data = try reader.read(1);
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            const val = try reader.byte();
            return SQLDataCell{ .tag = .bool, .value = .{ .bool = val } };
        },
        .MYSQL_TYPE_SHORT => {
            if (raw) {
                var data = try reader.read(2);
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            if (unsigned) {
                return SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = try reader.int(u16) } };
            }
            return SQLDataCell{ .tag = .int4, .value = .{ .int4 = try reader.int(i16) } };
        },
        .MYSQL_TYPE_LONG => {
            if (raw) {
                var data = try reader.read(4);
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            if (unsigned) {
                return SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = try reader.int(u32) } };
            }
            return SQLDataCell{ .tag = .int4, .value = .{ .int4 = try reader.int(i32) } };
        },
        .MYSQL_TYPE_LONGLONG => {
            if (raw) {
                return SQLDataCell.raw(&try reader.read(8));
            }
            if (unsigned) {
                const val = try reader.int(u64);
                if (val <= std.math.maxInt(u32)) {
                    return SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = @intCast(val) } };
                }
                if (bigint) {
                    return SQLDataCell{ .tag = .uint8, .value = .{ .uint8 = val } };
                }
                var buffer: [22]u8 = undefined;
                const slice = std.fmt.bufPrint(&buffer, "{d}", .{val}) catch unreachable;
                return SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            }
            const val = try reader.int(i64);
            if (val >= std.math.minInt(i32) and val <= std.math.maxInt(i32)) {
                return SQLDataCell{ .tag = .int4, .value = .{ .int4 = @intCast(val) } };
            }
            if (bigint) {
                return SQLDataCell{ .tag = .int8, .value = .{ .int8 = val } };
            }
            var buffer: [22]u8 = undefined;
            const slice = std.fmt.bufPrint(&buffer, "{d}", .{val}) catch unreachable;
            return SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
        },
        .MYSQL_TYPE_FLOAT => {
            if (raw) {
                var data = try reader.read(4);
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            return SQLDataCell{ .tag = .float8, .value = .{ .float8 = @as(f32, @bitCast(try reader.int(u32))) } };
        },
        .MYSQL_TYPE_DOUBLE => {
            if (raw) {
                var data = try reader.read(8);
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            return SQLDataCell{ .tag = .float8, .value = .{ .float8 = @bitCast(try reader.int(u64)) } };
        },
        .MYSQL_TYPE_TIME => {
            return switch (try reader.byte()) {
                0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
                8, 12 => |l| {
                    var data = try reader.read(l);
                    defer data.deinit();
                    const time = try Time.fromData(&data);
                    return SQLDataCell{ .tag = .date, .value = .{ .date = time.toJSTimestamp() } };
                },
                else => return error.InvalidBinaryValue,
            };
        },
        .MYSQL_TYPE_DATE, .MYSQL_TYPE_TIMESTAMP, .MYSQL_TYPE_DATETIME => switch (try reader.byte()) {
            0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
            11, 7, 4 => |l| {
                var data = try reader.read(l);
                defer data.deinit();
                const time = try DateTime.fromData(&data);
                return SQLDataCell{ .tag = .date, .value = .{ .date = try time.toJSTimestamp(globalObject) } };
            },
            else => error.InvalidBinaryValue,
        },

        .MYSQL_TYPE_ENUM,
        .MYSQL_TYPE_SET,
        .MYSQL_TYPE_GEOMETRY,
        .MYSQL_TYPE_NEWDECIMAL,
        .MYSQL_TYPE_STRING,
        .MYSQL_TYPE_VARCHAR,
        .MYSQL_TYPE_VAR_STRING,
        // We could return Buffer here BUT TEXT, LONGTEXT, MEDIUMTEXT, TINYTEXT, etc. are BLOB and the user expects a string
        .MYSQL_TYPE_TINY_BLOB,
        .MYSQL_TYPE_MEDIUM_BLOB,
        .MYSQL_TYPE_LONG_BLOB,
        .MYSQL_TYPE_BLOB,
        => {
            if (raw) {
                var data = try reader.rawEncodeLenData();
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            var string_data = try reader.encodeLenString();
            defer string_data.deinit();

            const slice = string_data.slice();
            return SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
        },

        .MYSQL_TYPE_JSON => {
            if (raw) {
                var data = try reader.rawEncodeLenData();
                defer data.deinit();
                return SQLDataCell.raw(&data);
            }
            var string_data = try reader.encodeLenString();
            defer string_data.deinit();
            const slice = string_data.slice();
            return SQLDataCell{ .tag = .json, .value = .{ .json = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
        },
        else => return error.UnsupportedColumnType,
    };
}

const debug = bun.Output.scoped(.MySQLDecodeBinaryValue, .visible);

const std = @import("std");
const types = @import("../MySQLTypes.zig");
const NewReader = @import("./NewReader.zig").NewReader;
const SQLDataCell = @import("../../shared/SQLDataCell.zig").SQLDataCell;

const Value = @import("../MySQLTypes.zig").Value;
const DateTime = Value.DateTime;
const Time = Value.Time;

const bun = @import("bun");
const jsc = bun.jsc;
