use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::postgres_types::{self as types, Int4, Short};
use crate::postgres::protocol::new_reader::NewReader;
use crate::shared::column_identifier::ColumnIdentifier;

pub struct FieldDescription {
    /// JavaScriptCore treats numeric property names differently than string property names.
    /// so we do the work to figure out if the property name is a number ahead of time.
    pub name_or_index: ColumnIdentifier,
    pub type_oid: Int4,
    pub binary: bool,
}

impl Default for FieldDescription {
    fn default() -> Self {
        Self {
            name_or_index: ColumnIdentifier::Name(Default::default()),
            type_oid: 0,
            binary: false,
        }
    }
}

impl FieldDescription {
    pub fn type_tag(&self) -> types::Tag {
        // `types::Tag` is a `#[repr(transparent)] struct(Short)` newtype over
        // the OID, so wrap the truncated value directly.
        types::Tag(self.type_oid as Short)
    }

    pub(crate) fn decode_internal<Container: super::new_reader::ReaderContext>(
        reader: &mut NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let name = reader.read_z()?;

        // Field name (null-terminated string)
        let field_name = ColumnIdentifier::init(name).map_err(|_| AnyPostgresError::OutOfMemory)?;
        // Table OID (4 bytes)
        // If the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
        reader.int4()?;

        // Column attribute number (2 bytes)
        // If the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
        reader.short()?;

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
            type_oid,
            binary,
            name_or_index: field_name,
        })
    }
}
