const FieldDescription = @This();

/// Column name exactly as sent by PostgreSQL in RowDescription. Unlike
/// `name_or_index`, this is never rewritten to `.duplicate` and is always
/// the original string, so it can be surfaced to JS in result `.columns`.
name: Data = .{ .empty = {} },
/// JavaScriptCore treats numeric property names differently than string property names.
/// so we do the work to figure out if the property name is a number ahead of time.
name_or_index: ColumnIdentifier = .{
    .name = .{ .empty = {} },
},
table_oid: int4 = 0,
column_index: short = 0,
type_oid: int4 = 0,
binary: bool = false,
pub fn typeTag(this: @This()) types.Tag {
    return @enumFromInt(@as(short, @truncate(this.type_oid)));
}

pub fn deinit(this: *@This()) void {
    this.name.deinit();
    this.name_or_index.deinit();
}

pub fn toJS(this: *const @This(), globalObject: *jsc.JSGlobalObject) bun.JSError!JSValue {
    const obj = JSValue.createEmptyObject(globalObject, 4);
    obj.put(globalObject, jsc.ZigString.static("name"), try bun.String.createUTF8ForJS(globalObject, this.name.slice()));
    obj.put(globalObject, jsc.ZigString.static("type"), JSValue.jsNumber(this.type_oid));
    obj.put(globalObject, jsc.ZigString.static("table"), JSValue.jsNumber(this.table_oid));
    obj.put(globalObject, jsc.ZigString.static("number"), JSValue.jsNumber(this.column_index));
    return obj;
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) AnyPostgresError!void {
    var name = try reader.readZ();
    errdefer {
        name.deinit();
    }

    // Field name (null-terminated string)
    var field_name = try ColumnIdentifier.init(name);
    errdefer field_name.deinit();
    // Table OID (4 bytes)
    // If the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
    const table_oid = try reader.int4();

    // Column attribute number (2 bytes)
    // If the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
    const column_index = try reader.short();

    // Data type OID (4 bytes)
    // The object ID of the field's data type. The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
    const type_oid = try reader.int4();

    // Data type size (2 bytes) The data type size (see pg_type.typlen). Note that negative values denote variable-width types.
    // Type modifier (4 bytes) The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
    try reader.skip(6);

    // Format code (2 bytes)
    // The format code being used for the field. Currently will be zero (text) or one (binary). In a RowDescription returned from the statement variant of Describe, the format code is not yet known and will always be zero.
    const binary = switch (try reader.short()) {
        0 => false,
        1 => true,
        else => return error.UnknownFormatCode,
    };
    this.* = .{
        .name = try Data.create(name.slice(), bun.default_allocator),
        .table_oid = table_oid,
        .column_index = column_index,
        .type_oid = type_oid,
        .binary = binary,
        .name_or_index = field_name,
    };
}

pub const decode = DecoderWrap(FieldDescription, decodeInternal).decode;

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const ColumnIdentifier = @import("../../shared/ColumnIdentifier.zig").ColumnIdentifier;
const Data = @import("../../shared/Data.zig").Data;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;

const types = @import("../PostgresTypes.zig");
const int4 = types.int4;
const short = types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
