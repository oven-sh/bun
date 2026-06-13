use crate::mysql::mysql_param::Param;
use crate::mysql::mysql_types::FieldType;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::column_definition41::ColumnFlags;
use crate::mysql::protocol::command_type::CommandType;
use crate::mysql::protocol::new_writer::{NewWriter, WriterContext};
use crate::shared::data::Data;

bun_core::declare_scope!(MySQLQuery, visible);

// Execute is a transient builder that borrows query/params/param_types
// from the caller for the duration of a single write() call. Most protocol
// message structs avoid lifetime params; this one carries an explicit `'a`
// because none of Box / &'static / raw fit a borrow-only message builder.
pub struct Execute<'a> {
    pub query: &'a [u8],
    /// Parameter values to bind to the prepared statement
    pub params: &'a mut [Data],
    /// Types of each parameter in the prepared statement
    pub param_types: &'a [Param],
}

// `Data` owns its resources via `Drop`, and `Execute` only borrows the
// slice, so the slice owner is responsible for cleanup (each `Data`'s `Drop`
// runs when the owning slice is dropped after `write`).

impl<'a> Execute<'a> {
    pub fn write_internal<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), AnyMySQLError> {
        let mut packet = writer.start(0)?;
        writer.int1(CommandType::COM_QUERY as u8)?;
        writer.write(self.query)?;

        if !self.params.is_empty() {
            writer.write_null_bitmap(self.params)?;

            // Always 1. Malformed packet error if not 1
            writer.int1(1)?;
            // if 22 chars = u64 + 2 for :p and this should be more than enough
            let mut param_name_buf = [0u8; 22];
            // Write parameter types
            for (param_type, i) in self.param_types.iter().zip(1usize..) {
                let unsigned = param_type.flags.contains(ColumnFlags::UNSIGNED);
                bun_core::scoped_log!(
                    MySQLQuery,
                    "New params bind flag {} unsigned? {}",
                    <&'static str>::from(param_type.r#type),
                    unsigned,
                );
                writer.int1(param_type.r#type as u8)?;
                writer.int1(if unsigned { 0x80 } else { 0 })?;
                let param_name = {
                    use std::io::Write;
                    let mut cursor = std::io::Cursor::new(&mut param_name_buf[..]);
                    write!(&mut cursor, ":p{}", i).map_err(|_| AnyMySQLError::TooManyParameters)?;
                    let len = usize::try_from(cursor.position()).expect("int cast");
                    &param_name_buf[..len]
                };
                writer.write_length_encoded_string(param_name)?;
            }

            // Write parameter values
            debug_assert_eq!(self.params.len(), self.param_types.len());
            for (param, param_type) in self.params.iter().zip(self.param_types.iter()) {
                if matches!(param, Data::Empty) || param_type.r#type == FieldType::MYSQL_TYPE_NULL {
                    continue;
                }

                let value = param.slice();
                bun_core::scoped_log!(
                    MySQLQuery,
                    "Write param type {} len {} hex {:02x?}",
                    <&'static str>::from(param_type.r#type),
                    value.len(),
                    value,
                );
                if param_type.r#type.is_binary_format_supported() {
                    writer.write(value)?;
                } else {
                    writer.write_length_encoded_string(value)?;
                }
            }
        }
        packet.end()?;
        Ok(())
    }

    // `writer` is already wrapped, so forward directly.
    pub fn write<C: WriterContext>(&self, writer: NewWriter<C>) -> Result<(), AnyMySQLError> {
        self.write_internal(writer)
    }
}

pub fn execute<C: WriterContext>(query: &[u8], writer: NewWriter<C>) -> Result<(), AnyMySQLError> {
    let mut packet = writer.start(0)?;
    writer.int1(CommandType::COM_QUERY as u8)?;
    writer.write(query)?;
    packet.end()?;
    Ok(())
}
