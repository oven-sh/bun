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
name_or_index: ColumnIdentifier = .{
    .name = .{ .empty = {} },
},

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
    this.catalog = try reader.encodeLenString();
    debug("catalog: {s}", .{this.catalog.slice()});

    this.schema = try reader.encodeLenString();
    debug("schema: {s}", .{this.schema.slice()});

    this.table = try reader.encodeLenString();
    debug("table: {s}", .{this.table.slice()});

    this.org_table = try reader.encodeLenString();
    debug("org_table: {s}", .{this.org_table.slice()});

    this.name = try reader.encodeLenString();
    debug("name: {s}", .{this.name.slice()});

    this.org_name = try reader.encodeLenString();
    debug("org_name: {s}", .{this.org_name.slice()});

    this.fixed_length_fields_length = try reader.encodedLenInt();
    this.character_set = try reader.int(u16);
    this.column_length = try reader.int(u32);
    this.column_type = @enumFromInt(try reader.int(u8));
    this.flags = ColumnFlags.fromInt(try reader.int(u16));
    this.decimals = try reader.int(u8);

    this.name_or_index = try ColumnIdentifier.init(this.name);

    // https://mariadb.com/kb/en/result-set-packets/#column-definition-packet
    // According to mariadb, there seem to be extra 2 bytes at the end that is not being used
    reader.skip(2);
}

pub const decode = decoderWrap(ColumnDefinition41, decodeInternal).decode;

const debug = bun.Output.scoped(.ColumnDefinition41, .hidden);

const bun = @import("bun");
const types = @import("../MySQLTypes.zig");
const ColumnIdentifier = @import("../../shared/ColumnIdentifier.zig").ColumnIdentifier;
const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
