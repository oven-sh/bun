pub fn decodeBinaryValue(field_type: types.FieldType, bigint: bool, unsigned: bool, comptime Context: type, reader: NewReader(Context)) !SQLDataCell {
    return switch (field_type) {
        .MYSQL_TYPE_TINY => blk: {
            const val = try reader.byte();
            break :blk SQLDataCell{ .tag = .bool, .value = .{ .bool = val } };
        },
        .MYSQL_TYPE_SHORT => if (unsigned)
            SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = try reader.int(u16) } }
        else
            SQLDataCell{ .tag = .int4, .value = .{ .int4 = try reader.int(i16) } },
        .MYSQL_TYPE_LONG => if (unsigned)
            SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = try reader.int(u32) } }
        else
            SQLDataCell{ .tag = .int4, .value = .{ .int4 = try reader.int(i32) } },
        .MYSQL_TYPE_LONGLONG => {
            if (unsigned) {
                const val = try reader.int(u64);
                if (bigint) {
                    if (val < std.math.maxInt(i64)) {
                        return SQLDataCell{ .tag = .int8, .value = .{ .int8 = @intCast(val) } };
                    }
                }
                var buffer: [21]u8 = undefined;
                const slice = try std.fmt.bufPrint(&buffer, "{}", .{val});
                return SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            } else {
                const val = try reader.int(i64);
                if (bigint) {
                    return SQLDataCell{ .tag = .int8, .value = .{ .int8 = val } };
                }
                var buffer: [21]u8 = undefined;
                const slice = try std.fmt.bufPrint(&buffer, "{}", .{val});
                return SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            }
        },
        .MYSQL_TYPE_FLOAT => SQLDataCell{ .tag = .float8, .value = .{ .float8 = @as(f32, @bitCast(try reader.int(u32))) } },
        .MYSQL_TYPE_DOUBLE => SQLDataCell{ .tag = .float8, .value = .{ .float8 = @bitCast(try reader.int(u64)) } },
        // .MYSQL_TYPE_TIME => switch (try reader.byte()) {
        //     0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
        //     8, 12 => |l| SQLDataCell{ .tag = .date, .value = .{ .time = try Value.Time.fromData(&try reader.read(l)) } },
        //     else => return error.InvalidBinaryValue,
        // },
        // .MYSQL_TYPE_DATE => switch (try reader.byte()) {
        //     0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
        //     4 => SQLDataCell{ .tag = .date, .value = .{ .date = try Value.DateTime.fromData(&try reader.read(4)) } },
        //     else => error.InvalidBinaryValue,
        // },
        // .MYSQL_TYPE_DATETIME => switch (try reader.byte()) {
        //     0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
        //     11, 7, 4 => |l| SQLDataCell{ .tag = .date, .value = .{ .date = try Value.DateTime.fromData(&try reader.read(l)) } },
        //     else => error.InvalidBinaryValue,
        // },
        // .MYSQL_TYPE_TIMESTAMP => switch (try reader.byte()) {
        //     0 => SQLDataCell{ .tag = .null, .value = .{ .null = 0 } },
        //     4, 7 => |l| SQLDataCell{ .tag = .date, .value = .{ .date = try Value.DateTime.fromData(&try reader.read(l)) } },
        //     else => error.InvalidBinaryValue,
        // },
        .MYSQL_TYPE_STRING, .MYSQL_TYPE_VARCHAR, .MYSQL_TYPE_VAR_STRING => blk: {
            var string_data = try reader.encodeLenString();
            defer string_data.deinit();
            const slice = string_data.slice();
            break :blk SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
        },
        .MYSQL_TYPE_TINY_BLOB,
        .MYSQL_TYPE_MEDIUM_BLOB,
        .MYSQL_TYPE_LONG_BLOB,
        .MYSQL_TYPE_BLOB,
        .MYSQL_TYPE_JSON,
        => blk: {
            var val = try reader.encodeLenString();
            break :blk SQLDataCell.raw(&val);
        },
        else => return error.UnsupportedColumnType,
    };
}

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
const types = @import("../MySQLTypes.zig");
const SQLDataCell = @import("../../shared/SQLDataCell.zig").SQLDataCell;
