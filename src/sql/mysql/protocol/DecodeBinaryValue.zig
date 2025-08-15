pub fn decodeBinaryValue(field_type: types.FieldType, unsigned: bool, comptime Context: type, reader: NewReader(Context)) !Value {
    return switch (field_type) {
        .MYSQL_TYPE_TINY => blk: {
            const val = try reader.byte();
            break :blk Value{ .bool = val != 0 };
        },
        .MYSQL_TYPE_SHORT => if (unsigned)
            Value{ .ushort = try reader.int(u16) }
        else
            Value{ .short = try reader.int(i16) },
        .MYSQL_TYPE_LONG => if (unsigned)
            Value{ .uint = try reader.int(u32) }
        else
            Value{ .int = try reader.int(i32) },
        .MYSQL_TYPE_LONGLONG => if (unsigned)
            Value{ .ulong = try reader.int(u64) }
        else
            Value{ .long = try reader.int(i64) },
        .MYSQL_TYPE_FLOAT => Value{ .float = @bitCast(try reader.int(u32)) },
        .MYSQL_TYPE_DOUBLE => Value{ .double = @bitCast(try reader.int(u64)) },
        .MYSQL_TYPE_TIME => switch (try reader.byte()) {
            0 => Value{ .null = {} },
            8, 12 => |l| Value{ .time = try Value.Time.fromData(&try reader.read(l)) },
            else => return error.InvalidBinaryValue,
        },
        .MYSQL_TYPE_DATE => switch (try reader.byte()) {
            0 => Value{ .null = {} },
            4 => Value{ .date = try Value.DateTime.fromData(&try reader.read(4)) },
            else => error.InvalidBinaryValue,
        },
        .MYSQL_TYPE_DATETIME => switch (try reader.byte()) {
            0 => Value{ .null = {} },
            11, 7, 4 => |l| Value{ .date = try Value.DateTime.fromData(&try reader.read(l)) },
            else => error.InvalidBinaryValue,
        },
        .MYSQL_TYPE_TIMESTAMP => switch (try reader.byte()) {
            0 => Value{ .null = {} },
            4, 7 => |l| Value{ .timestamp = try Value.Timestamp.fromData(&try reader.read(l)) },
            else => error.InvalidBinaryValue,
        },
        .MYSQL_TYPE_STRING, .MYSQL_TYPE_VARCHAR, .MYSQL_TYPE_VAR_STRING => blk: {
            if (decodeLengthInt(reader.peek())) |result| {
                reader.skip(result.bytes_read);
                const val = try reader.read(@intCast(result.value));
                break :blk .{ .string_data = val };
            } else return error.InvalidBinaryValue;
        },
        .MYSQL_TYPE_TINY_BLOB,
        .MYSQL_TYPE_MEDIUM_BLOB,
        .MYSQL_TYPE_LONG_BLOB,
        .MYSQL_TYPE_BLOB,
        .MYSQL_TYPE_JSON,
        => blk: {
            const val = try reader.encodeLenString();
            break :blk .{ .bytes_data = val };
        },
        else => return error.UnsupportedColumnType,
    };
}

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
const types = @import("../MySQLTypes.zig");
const Value = types.Value;
