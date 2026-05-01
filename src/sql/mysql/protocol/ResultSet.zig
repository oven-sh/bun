pub const Header = @import("./ResultSetHeader.zig");

pub const Row = struct {
    values: []SQLDataCell = &[_]SQLDataCell{},
    columns: []const ColumnDefinition41,
    binary: bool = false,
    raw: bool = false,
    bigint: bool = false,
    globalObject: *jsc.JSGlobalObject,

    pub fn toJS(this: *Row, globalObject: *jsc.JSGlobalObject, array: JSValue, structure: JSValue, flags: SQLDataCell.Flags, result_mode: SQLQueryResultMode, cached_structure: ?CachedStructure) !JSValue {
        var names: ?[*]jsc.JSObject.ExternColumnIdentifier = null;
        var names_count: u32 = 0;
        if (cached_structure) |c| {
            if (c.fields) |f| {
                names = f.ptr;
                names_count = @truncate(f.len);
            }
        }

        return SQLDataCell.constructObjectFromDataCell(
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

    pub fn decodeInternal(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) AnyMySQLError.Error!void {
        if (this.binary) {
            try this.decodeBinary(allocator, Context, reader);
        } else {
            try this.decodeText(allocator, Context, reader);
        }
    }

    fn parseValueAndSetCell(this: *Row, cell: *SQLDataCell, column: *const ColumnDefinition41, value: *const Data) void {
        debug("parseValueAndSetCell: {s} {s}", .{ @tagName(column.column_type), value.slice() });
        return switch (column.column_type) {
            .MYSQL_TYPE_FLOAT, .MYSQL_TYPE_DOUBLE => {
                const val: f64 = bun.parseDouble(value.slice()) catch std.math.nan(f64);
                cell.* = SQLDataCell{ .tag = .float8, .value = .{ .float8 = val } };
            },
            .MYSQL_TYPE_TINY, .MYSQL_TYPE_SHORT => {
                if (column.flags.UNSIGNED) {
                    const val: u16 = std.fmt.parseInt(u16, value.slice(), 10) catch 0;
                    cell.* = SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = val } };
                } else {
                    const val: i16 = std.fmt.parseInt(i16, value.slice(), 10) catch 0;
                    cell.* = SQLDataCell{ .tag = .int4, .value = .{ .int4 = val } };
                }
            },
            .MYSQL_TYPE_LONG => {
                if (column.flags.UNSIGNED) {
                    const val: u32 = std.fmt.parseInt(u32, value.slice(), 10) catch 0;
                    cell.* = SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = val } };
                } else {
                    const val: i32 = std.fmt.parseInt(i32, value.slice(), 10) catch std.math.minInt(i32);
                    cell.* = SQLDataCell{ .tag = .int4, .value = .{ .int4 = val } };
                }
            },
            .MYSQL_TYPE_INT24 => {
                if (column.flags.UNSIGNED) {
                    const val: u24 = std.fmt.parseInt(u24, value.slice(), 10) catch 0;
                    cell.* = SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = val } };
                } else {
                    const val: i24 = std.fmt.parseInt(i24, value.slice(), 10) catch std.math.minInt(i24);
                    cell.* = SQLDataCell{ .tag = .int4, .value = .{ .int4 = val } };
                }
            },
            .MYSQL_TYPE_LONGLONG => {
                if (column.flags.UNSIGNED) {
                    const val: u64 = std.fmt.parseInt(u64, value.slice(), 10) catch 0;
                    if (val <= std.math.maxInt(u32)) {
                        cell.* = SQLDataCell{ .tag = .uint4, .value = .{ .uint4 = @intCast(val) } };
                        return;
                    }
                    if (this.bigint) {
                        cell.* = SQLDataCell{ .tag = .uint8, .value = .{ .uint8 = val } };
                        return;
                    }
                } else {
                    const val: i64 = std.fmt.parseInt(i64, value.slice(), 10) catch 0;
                    if (val >= std.math.minInt(i32) and val <= std.math.maxInt(i32)) {
                        cell.* = SQLDataCell{ .tag = .int4, .value = .{ .int4 = @intCast(val) } };
                        return;
                    }
                    if (this.bigint) {
                        cell.* = SQLDataCell{ .tag = .int8, .value = .{ .int8 = val } };
                        return;
                    }
                }

                const slice = value.slice();
                cell.* = SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            },
            .MYSQL_TYPE_JSON => {
                const slice = value.slice();
                cell.* = SQLDataCell{ .tag = .json, .value = .{ .json = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            },

            .MYSQL_TYPE_TIME => {
                // lets handle TIME special case as string
                // -838:59:50 to 838:59:59 is valid
                const slice = value.slice();
                cell.* = SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
            },
            .MYSQL_TYPE_DATE, .MYSQL_TYPE_DATETIME, .MYSQL_TYPE_TIMESTAMP => {
                var str = bun.String.init(value.slice());
                defer str.deref();
                const date = brk: {
                    break :brk str.parseDate(this.globalObject) catch |err| {
                        _ = this.globalObject.takeException(err);
                        break :brk std.math.nan(f64);
                    };
                };
                cell.* = SQLDataCell{ .tag = .date, .value = .{ .date = date } };
            },
            .MYSQL_TYPE_BIT => {
                // BIT(1) is a special case, it's a boolean
                if (column.column_length == 1) {
                    const slice = value.slice();
                    cell.* = SQLDataCell{ .tag = .bool, .value = .{ .bool = if (slice.len > 0 and slice[0] == 1) 1 else 0 } };
                } else {
                    cell.* = SQLDataCell.raw(value);
                }
            },
            else => {
                // Only treat as binary if character_set indicates the binary pseudo-charset.
                // The BINARY flag alone is insufficient because VARCHAR/CHAR columns
                // with _bin collations (e.g., utf8mb4_bin) also have the BINARY flag set,
                // but should return strings, not buffers.
                if (column.flags.BINARY and column.character_set == DecodeBinaryValue.binary_charset) {
                    cell.* = SQLDataCell.raw(value);
                } else {
                    const slice = value.slice();
                    cell.* = SQLDataCell{ .tag = .string, .value = .{ .string = if (slice.len > 0) bun.String.cloneUTF8(slice).value.WTFStringImpl else null }, .free_value = 1 };
                }
            },
        };
    }

    fn decodeText(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) AnyMySQLError.Error!void {
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
                        this.parseValueAndSetCell(value, &column, &string_data);
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

    fn decodeBinary(this: *Row, allocator: std.mem.Allocator, comptime Context: type, reader: NewReader(Context)) AnyMySQLError.Error!void {
        // Header
        _ = try reader.int(u8);

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
            value.* = try decodeBinaryValue(this.globalObject, column.column_type, column.column_length, this.raw, this.bigint, column.flags.UNSIGNED, column.flags.BINARY, column.character_set, Context, reader);
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

const debug = bun.Output.scoped(.MySQLResultSet, .visible);

const AnyMySQLError = @import("./AnyMySQLError.zig");
const CachedStructure = @import("../../shared/CachedStructure.zig");
const ColumnDefinition41 = @import("./ColumnDefinition41.zig");
const bun = @import("bun");
const std = @import("std");
const Data = @import("../../shared/Data.zig").Data;
const SQLDataCell = @import("../../shared/SQLDataCell.zig").SQLDataCell;
const SQLQueryResultMode = @import("../../shared/SQLQueryResultMode.zig").SQLQueryResultMode;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;

const DecodeBinaryValue = @import("./DecodeBinaryValue.zig");
const decodeBinaryValue = DecodeBinaryValue.decodeBinaryValue;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
