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
    this.name_or_index.deinit();
}

pub fn toJS(this: *const @This(), globalObject: *jsc.JSGlobalObject) bun.JSError!JSValue {
    const obj = JSValue.createEmptyObject(globalObject, 5);
    obj.put(globalObject, jsc.ZigString.static("name"), try bun.String.createUTF8ForJS(globalObject, this.name.slice()));
    obj.put(globalObject, jsc.ZigString.static("type"), JSValue.jsNumber(@as(u32, @intFromEnum(this.column_type))));
    obj.put(globalObject, jsc.ZigString.static("table"), try bun.String.createUTF8ForJS(globalObject, this.table.slice()));
    obj.put(globalObject, jsc.ZigString.static("length"), JSValue.jsNumber(this.column_length));
    obj.put(globalObject, jsc.ZigString.static("flags"), JSValue.jsNumber(this.flags.toInt()));
    return obj;
}

pub fn decodeInternal(this: *ColumnDefinition41, comptime Context: type, reader: NewReader(Context)) !void {
    // Length encoded strings
    this.catalog = try reader.encodeLenString();
    debug("catalog: {s}", .{this.catalog.slice()});

    this.schema = try reader.encodeLenString();
    debug("schema: {s}", .{this.schema.slice()});

    // `name` and `table` are surfaced to JS via toJS() when the query's final
    // OK/EOF packet arrives, which may be many onData() calls after decode.
    // The reader returns `Data{ .temporary = ... }` slices into the socket
    // read buffer which will have been overwritten or realloc'd by then, so
    // own a copy now. The other string fields are never read post-decode.
    // deinit() first: decodeInternal runs on already-populated slots when a
    // prepared statement is re-executed (reset() zeroes columns_received but
    // leaves columns[] intact, and handleResultSet skips realloc when the
    // column count is unchanged).
    const table = try reader.encodeLenString();
    this.table.deinit();
    this.table = try Data.create(table.slice(), bun.default_allocator);
    debug("table: {s}", .{this.table.slice()});

    this.org_table = try reader.encodeLenString();
    debug("org_table: {s}", .{this.org_table.slice()});

    const name = try reader.encodeLenString();
    this.name.deinit();
    this.name = try Data.create(name.slice(), bun.default_allocator);
    debug("name: {s}", .{this.name.slice()});

    this.org_name = try reader.encodeLenString();
    debug("org_name: {s}", .{this.org_name.slice()});

    this.fixed_length_fields_length = try reader.encodedLenInt();
    this.character_set = try reader.int(u16);
    this.column_length = try reader.int(u32);
    this.column_type = @enumFromInt(try reader.int(u8));
    this.flags = ColumnFlags.fromInt(try reader.int(u16));
    this.decimals = try reader.int(u8);

    this.name_or_index.deinit();
    // Pass the .temporary `name` (not `this.name`): Data.toOwned() on .owned
    // returns the same ByteList without duplicating, which would alias
    // `this.name` and double-free in deinit().
    this.name_or_index = try ColumnIdentifier.init(name);

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

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
