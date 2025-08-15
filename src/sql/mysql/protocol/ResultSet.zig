const ResultSet = @This();
pub const Header = @import("./ResultSetHeader.zig");

pub const Row = struct {
    values: []Value = &[_]Value{},
    columns: []const ColumnDefinition41,
    binary: bool = false,

    extern fn MySQL__toJSFromRow(*jsc.JSGlobalObject, jsc.JSValue, jsc.JSValue, *anyopaque, usize) jsc.JSValue;
    pub fn toJS(this: *Row, structure_value: JSValue, array_value: JSValue, globalObject: *jsc.JSGlobalObject) JSValue {
        return MySQL__toJSFromRow(globalObject, structure_value, array_value, this.values.ptr, this.columns.len);
    }

    pub fn deinit(this: *Row, allocator: std.mem.Allocator) void {
        for (this.values) |*value| {
            value.deinit(allocator);
        }
        allocator.free(this.values);

        // this.columns is intentionally left out.
    }

    pub fn decodeInternal(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) !void {
        if (this.binary) {
            try this.decodeBinary(allocator, Context, reader);
        } else {
            try this.decodeText(allocator, Context, reader);
        }
    }

    fn decodeText(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) !void {
        const values = try allocator.alloc(Value, this.columns.len);
        errdefer {
            for (values) |*value| {
                value.deinit(allocator);
            }
            allocator.free(values);
        }

        for (values) |*value| {
            if (decodeLengthInt(reader.peek())) |result| {
                reader.skip(result.bytes_read);
                if (result.value == 0xfb) { // NULL value
                    value.* = .{ .null = {} };
                } else {
                    // TODO: check to parse number date etc from this.columns info, you can check postgres to see more text parsing
                    value.* = .{
                        .string_data = try reader.read(@intCast(result.value)),
                    };
                }
            } else {
                return error.InvalidResultRow;
            }
        }

        this.values = values;
    }

    fn decodeBinary(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) !void {
        // Header
        const header = try reader.int(u8);
        if (header != 0) return error.InvalidBinaryRow;

        // Null bitmap
        const bitmap_bytes = (this.columns.len + 7 + 2) / 8;
        var null_bitmap = try reader.read(bitmap_bytes);
        defer null_bitmap.deinit();

        const values = try allocator.alloc(Value, this.columns.len);
        errdefer {
            for (values) |*value| {
                value.deinit(allocator);
            }
            allocator.free(values);
        }

        // Skip first 2 bits of null bitmap (reserved)
        const bitmap_offset: usize = 2;

        for (values, 0..) |*value, i| {
            const byte_pos = (bitmap_offset + i) >> 3;
            const bit_pos = @as(u3, @truncate((bitmap_offset + i) & 7));
            const is_null = (null_bitmap.slice()[byte_pos] & (@as(u8, 1) << bit_pos)) != 0;

            if (is_null) {
                value.* = .{ .null = {} };
                continue;
            }

            const column = this.columns[i];
            value.* = try decodeBinaryValue(column.column_type, column.flags.UNSIGNED, Context, reader);
        }

        this.values = values;
    }

    pub const decode = decoderWrap(Row, decodeInternal).decodeAllocator;
};

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
const ColumnDefinition41 = @import("./ColumnDefinition41.zig");
const decodeBinaryValue = @import("./DecodeBinaryValue.zig").decodeBinaryValue;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const Value = @import("../MySQLTypes.zig").Value;
