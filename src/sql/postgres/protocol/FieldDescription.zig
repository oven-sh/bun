const FieldDescription = @This();

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
    this.name_or_index.deinit();
}

pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) AnyPostgresError!void {
    var name = try reader.readZ();
    errdefer {
        name.deinit();
    }

    // Field name (null-terminated string)
    const field_name = try ColumnIdentifier.init(name);
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
        .table_oid = table_oid,
        .column_index = column_index,
        .type_oid = type_oid,
        .binary = binary,
        .name_or_index = field_name,
    };
}

pub const decode = DecoderWrap(FieldDescription, decodeInternal).decode;

const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const ColumnIdentifier = @import("../../shared/ColumnIdentifier.zig").ColumnIdentifier;
const DecoderWrap = @import("./DecoderWrap.zig").DecoderWrap;
const NewReader = @import("./NewReader.zig").NewReader;

const types = @import("../PostgresTypes.zig");
const int4 = types.int4;
const short = types.short;
