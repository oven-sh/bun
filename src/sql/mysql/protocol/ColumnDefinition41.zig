const ColumnDefinition41 = @This();
catalog: Data = .{ .empty = {} },
schema: Data = .{ .empty = {} },
table: Data = .{ .empty = {} },
org_table: Data = .{ .empty = {} },
name: Data = .{ .empty = {} },
org_name: Data = .{ .empty = {} },
fixed_length_fields_length: u64 = 0,
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

fn readEncodeLenString(comptime Context: type, reader: NewReader(Context)) !Data {
    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        return try reader.read(@intCast(result.value));
    }
    return error.InvalidColumnDefinition;
}

fn readEncodeLenInt(comptime Context: type, reader: NewReader(Context)) !u64 {
    if (decodeLengthInt(reader.peek())) |result| {
        reader.skip(result.bytes_read);
        return result.value;
    }
    return error.InvalidColumnDefinition;
}

pub fn decodeInternal(this: *ColumnDefinition41, comptime Context: type, reader: NewReader(Context)) !void {
    // Length encoded strings
    this.catalog = try readEncodeLenString(Context, reader);
    debug("catalog: {s}", .{this.catalog.slice()});

    this.schema = try readEncodeLenString(Context, reader);
    debug("schema: {s}", .{this.schema.slice()});

    this.table = try readEncodeLenString(Context, reader);
    debug("table: {s}", .{this.table.slice()});

    this.org_table = try readEncodeLenString(Context, reader);
    debug("org_table: {s}", .{this.org_table.slice()});

    this.name = try readEncodeLenString(Context, reader);
    debug("name: {s}", .{this.name.slice()});

    this.org_name = try readEncodeLenString(Context, reader);
    debug("org_name: {s}", .{this.org_name.slice()});

    this.fixed_length_fields_length = try readEncodeLenInt(Context, reader);
    this.character_set = try reader.int(u16);
    this.column_length = try reader.int(u32);
    this.column_type = @enumFromInt(try reader.int(u8));
    this.flags = ColumnFlags.fromInt(try reader.int(u16));
    this.decimals = try reader.int(u8);

    // https://mariadb.com/kb/en/result-set-packets/#column-definition-packet
    // According to mariadb, there seem to be extra 2 bytes at the end that is not being used
    reader.skip(2);
}

pub const decode = decoderWrap(ColumnDefinition41, decodeInternal).decode;

const std = @import("std");
const bun = @import("bun");
const debug = bun.Output.scoped(.ColumnDefinition41, false);
const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
const Data = @import("../../shared/Data.zig").Data;
const types = @import("../MySQLTypes.zig");
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
