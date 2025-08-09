const ColumnDefinition41 = @This();
catalog: Data = .{ .empty = {} },
schema: Data = .{ .empty = {} },
table: Data = .{ .empty = {} },
org_table: Data = .{ .empty = {} },
name: Data = .{ .empty = {} },
org_name: Data = .{ .empty = {} },
character_set: u16 = 0,
column_length: u32 = 0,
column_type: types.FieldType = .MYSQL_TYPE_NULL,
flags: ColumnFlags = .{},
decimals: u8 = 0,

pub const ColumnFlags = packed struct {
    NOT_NULL: bool = false,
    PRI_KEY: bool = false,
    UNIQUE_KEY: bool = false,
    MULTIPLE_KEY: bool = false,
    BLOB: bool = false,
    UNSIGNED: bool = false,
    ZEROFILL: bool = false,
    BINARY: bool = false,
    ENUM: bool = false,
    AUTO_INCREMENT: bool = false,
    TIMESTAMP: bool = false,
    SET: bool = false,
    NO_DEFAULT_VALUE: bool = false,
    ON_UPDATE_NOW: bool = false,
    _padding: u2 = 0,

    pub fn toInt(this: ColumnFlags) u16 {
        return @bitCast(this);
    }

    pub fn fromInt(flags: u16) ColumnFlags {
        return @bitCast(flags);
    }
};

pub fn deinit(this: *ColumnDefinition41) void {
    this.catalog.deinit();
    this.schema.deinit();
    this.table.deinit();
    this.org_table.deinit();
    this.name.deinit();
    this.org_name.deinit();
}

pub fn decodeInternal(this: *ColumnDefinition41, comptime Context: type, reader: NewReader(Context)) !void {
    // Length encoded strings
    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.catalog = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.schema = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.table = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.org_table = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.name = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        this.org_name = try reader.read(@intCast(result.value));
    } else return error.InvalidColumnDefinition;

    // Fixed length fields
    const next_length = try reader.int(u8);
    if (next_length != 0x0c) return error.InvalidColumnDefinition;

    this.character_set = try reader.int(u16);
    this.column_length = try reader.int(u32);
    this.column_type = @enumFromInt(try reader.int(u8));
    this.flags = ColumnFlags.fromInt(try reader.int(u16));
    this.decimals = try reader.int(u8);

    // Skip filler
    reader.skip(2);
}

pub const decode = decoderWrap(ColumnDefinition41, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const Data = @import("./Data.zig").Data;
const types = @import("../MySQLTypes.zig");
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
