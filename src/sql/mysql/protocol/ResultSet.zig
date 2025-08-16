const ResultSet = @This();
pub const Header = @import("./ResultSetHeader.zig");

pub const Row = struct {
    values: []SQLDataCell = &[_]SQLDataCell{},
    columns: []const ColumnDefinition41,
    binary: bool = false,
    raw: bool = false,
    bigint: bool = false,

    pub fn toJS(this: *Row, globalObject: *jsc.JSGlobalObject, array: JSValue, structure: JSValue, flags: SQLDataCell.Flags, result_mode: SQLQueryResultMode, cached_structure: ?CachedStructure) JSValue {
        var names: ?[*]jsc.JSObject.ExternColumnIdentifier = null;
        var names_count: u32 = 0;
        if (cached_structure) |c| {
            if (c.fields) |f| {
                names = f.ptr;
                names_count = @truncate(f.len);
            }
        }

        return SQLDataCell.JSC__constructObjectFromDataCell(
            globalObject,
            array,
            structure,
            this.values.ptr,
            @truncate(this.values.len),
            flags,
            @intFromEnum(result_mode),
            names,
            names_count,
        );
    }

    pub fn deinit(this: *Row, allocator: std.mem.Allocator) void {
        for (this.values) |*value| {
            value.deinit();
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
        const cells = try allocator.alloc(SQLDataCell, this.columns.len);
        @memset(cells, SQLDataCell{ .tag = .null, .value = .{ .null = 0 } });
        errdefer {
            for (cells) |*value| {
                value.deinit();
            }
            allocator.free(cells);
        }

        for (cells, 0..) |*value, index| {
            if (decodeLengthInt(reader.peek())) |result| {
                const column = this.columns[index];
                if (result.value == 0xfb) {
                    // NULL value
                    reader.skip(result.bytes_read);
                    // this dont matter if is raw because we will sent as null too like in postgres
                    value.* = SQLDataCell{ .tag = .null, .value = .{ .null = 0 } };
                } else {
                    if (this.raw) {
                        var data = try reader.rawEncodeLenData();
                        defer data.deinit();
                        value.* = SQLDataCell.raw(&data);
                    } else {
                        reader.skip(result.bytes_read);
                        var string_data = try reader.read(@intCast(result.value));
                        defer string_data.deinit();
                        const slice = string_data.slice();
                        // TODO: check to parse number date etc from this.columns info, you can check postgres to see more text parsing
                        value.* = SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
                    }
                }
                value.index = switch (column.name_or_index) {
                    // The indexed columns can be out of order.
                    .index => |i| i,

                    else => @intCast(index),
                };
                value.isIndexedColumn = switch (column.name_or_index) {
                    .duplicate => 2,
                    .index => 1,
                    .name => 0,
                };
            } else {
                return error.InvalidResultRow;
            }
        }

        this.values = cells;
    }

    fn decodeBinary(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) !void {
        // Header
        const header = try reader.int(u8);
        if (header != 0) return error.InvalidBinaryRow;

        // Null bitmap
        const bitmap_bytes = (this.columns.len + 7 + 2) / 8;
        var null_bitmap = try reader.read(bitmap_bytes);
        defer null_bitmap.deinit();

        const cells = try allocator.alloc(SQLDataCell, this.columns.len);
        @memset(cells, SQLDataCell{ .tag = .null, .value = .{ .null = 0 } });
        errdefer {
            for (cells) |*value| {
                value.deinit();
            }
            allocator.free(cells);
        }
        // Skip first 2 bits of null bitmap (reserved)
        const bitmap_offset: usize = 2;

        for (cells, 0..) |*value, i| {
            const byte_pos = (bitmap_offset + i) >> 3;
            const bit_pos = @as(u3, @truncate((bitmap_offset + i) & 7));
            const is_null = (null_bitmap.slice()[byte_pos] & (@as(u8, 1) << bit_pos)) != 0;

            if (is_null) {
                value.* = SQLDataCell{ .tag = .null, .value = .{ .null = 0 } };
                continue;
            }

            const column = this.columns[i];
            value.* = try decodeBinaryValue(column.column_type, this.raw, this.bigint, column.flags.UNSIGNED, Context, reader);
            value.index = switch (column.name_or_index) {
                // The indexed columns can be out of order.
                .index => |idx| idx,

                else => @intCast(i),
            };
            value.isIndexedColumn = switch (column.name_or_index) {
                .duplicate => 2,
                .index => 1,
                .name => 0,
            };
        }

        this.values = cells;
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
const SQLDataCell = @import("../../shared/SQLDataCell.zig").SQLDataCell;
const SQLQueryResultMode = @import("../../shared/SQLQueryResultMode.zig").SQLQueryResultMode;
const CachedStructure = @import("../../shared/CachedStructure.zig");
