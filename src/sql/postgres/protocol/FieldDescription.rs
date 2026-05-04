use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::postgres_types::{self as types, Int4, Short};
use bun_sql::postgres::protocol::decoder_wrap::DecoderWrap;
use bun_sql::postgres::protocol::new_reader::NewReader;
use bun_sql::shared::column_identifier::ColumnIdentifier;

pub struct FieldDescription {
    /// JavaScriptCore treats numeric property names differently than string property names.
    /// so we do the work to figure out if the property name is a number ahead of time.
    pub name_or_index: ColumnIdentifier,
    pub table_oid: Int4,
    pub column_index: Short,
    pub type_oid: Int4,
    pub binary: bool,
}

impl Default for FieldDescription {
    fn default() -> Self {
        Self {
            name_or_index: ColumnIdentifier::Name(Default::default()), // .{ .name = .{ .empty = {} } }
            table_oid: 0,
            column_index: 0,
            type_oid: 0,
            binary: false,
        }
    }
}

impl FieldDescription {
    pub fn type_tag(&self) -> types::Tag {
        // SAFETY: types::Tag is #[repr(Short)]; Zig does @enumFromInt on a truncated short.
        unsafe { core::mem::transmute::<Short, types::Tag>(self.type_oid as Short) }
    }

    // PORT NOTE: reshaped out-param constructor (`this.* = .{...}`) into a value-returning fn.
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let name = reader.read_z()?;
        // errdefer name.deinit() — deleted: `name` drops on `?` automatically.

        // Field name (null-terminated string)
        let field_name = ColumnIdentifier::init(name)?;
        // Table OID (4 bytes)
        // If the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
        let table_oid = reader.int4()?;

        // Column attribute number (2 bytes)
        // If the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
        let column_index = reader.short()?;

        // Data type OID (4 bytes)
        // The object ID of the field's data type. The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
        let type_oid = reader.int4()?;

        // Data type size (2 bytes) The data type size (see pg_type.typlen). Note that negative values denote variable-width types.
        // Type modifier (4 bytes) The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
        reader.skip(6)?;

        // Format code (2 bytes)
        // The format code being used for the field. Currently will be zero (text) or one (binary). In a RowDescription returned from the statement variant of Describe, the format code is not yet known and will always be zero.
        let binary = match reader.short()? {
            0 => false,
            1 => true,
            _ => return Err(AnyPostgresError::UnknownFormatCode),
        };
        Ok(Self {
            table_oid,
            column_index,
            type_oid,
            binary,
            name_or_index: field_name,
        })
    }
}

// Zig: `pub fn deinit` only deinits the owned `name_or_index` field.
// In Rust, `ColumnIdentifier` impls `Drop`, so field-drop is implicit — no explicit `Drop` needed.

// TODO(port): `pub const decode = DecoderWrap(FieldDescription, decodeInternal).decode;`
// DecoderWrap is a comptime type-generator; in Rust this is likely a trait impl
// (e.g. `impl Decode for FieldDescription`) provided by decoder_wrap. Phase B wires this.
pub use self::FieldDescription as _DecoderWrapTarget;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/FieldDescription.zig (69 lines)
//   confidence: medium
//   todos:      1
//   notes:      decode_internal reshaped to return Self; DecoderWrap alias needs trait impl in Phase B
// ──────────────────────────────────────────────────────────────────────────
