use super::any_mysql_error;
use super::column_definition41::ColumnFlags;
use super::command_type::CommandType;
use super::new_writer::{NewWriter, WriterContext};
use crate::mysql::mysql_param::Param;
use crate::mysql::mysql_types::FieldType;
use crate::shared::Data;

bun_core::declare_scope!(PreparedStatement, hidden);

/// A bound parameter value. The concrete type (`bun_sql_jsc`'s `Value`) lives
/// in a higher-tier crate this crate cannot depend on.
pub trait ExecuteParam {
    fn is_null(&self) -> bool;
    fn to_data(&self, field_type: FieldType) -> Result<Data, any_mysql_error::Error>;
}

pub struct Execute<'a, P: ExecuteParam> {
    /// ID of the prepared statement to execute, returned from COM_STMT_PREPARE
    pub statement_id: u32,
    /// Execution flags. Currently only CURSOR_TYPE_READ_ONLY (0x01) is supported
    pub flags: u8,
    /// Number of times to execute the statement (usually 1)
    pub iteration_count: u32,
    /// Types of each parameter in the prepared statement
    pub param_types: &'a [Param],
    /// Whether to send parameter types. Set to true for first execution, false for subsequent executions
    pub new_params_bind_flag: bool,
    /// One value per entry of `param_types`
    pub params: &'a [P],
}

impl<P: ExecuteParam> Execute<'_, P> {
    fn write_null_bitmap<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        const MYSQL_MAX_PARAMS: usize = (u16::MAX as usize / 8) + 1;

        let mut null_bitmap_buf = [0u8; MYSQL_MAX_PARAMS];
        let bitmap_bytes = self.params.len().div_ceil(8);
        let null_bitmap = &mut null_bitmap_buf[0..bitmap_bytes];

        for (i, param) in self.params.iter().enumerate() {
            if param.is_null() {
                null_bitmap[i >> 3] |= 1u8 << ((i & 7) as u8);
            }
        }

        writer.write(null_bitmap)?;
        Ok(())
    }

    pub(crate) fn write_internal<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        writer.int1(CommandType::COM_STMT_EXECUTE as u8)?;
        writer.int4(self.statement_id)?;
        writer.int1(self.flags)?;
        writer.int4(self.iteration_count)?;

        if !self.params.is_empty() {
            self.write_null_bitmap(writer)?;

            // Write new params bind flag
            writer.int1(self.new_params_bind_flag as u8)?;

            if self.new_params_bind_flag {
                // Write parameter types
                for param_type in self.param_types.iter() {
                    let unsigned = param_type.flags.contains(ColumnFlags::UNSIGNED);
                    bun_core::scoped_log!(
                        PreparedStatement,
                        "New params bind flag {} unsigned? {}",
                        <&'static str>::from(param_type.r#type),
                        unsigned
                    );
                    writer.int1(param_type.r#type as u8)?;
                    writer.int1(if unsigned { 0x80 } else { 0 })?;
                }
            }

            // Write parameter values
            debug_assert_eq!(self.params.len(), self.param_types.len());
            for (param, param_type) in self.params.iter().zip(self.param_types) {
                if param.is_null() || param_type.r#type == FieldType::MYSQL_TYPE_NULL {
                    continue;
                }

                let value = param.to_data(param_type.r#type)?;
                if param_type.r#type.is_binary_format_supported() {
                    writer.write(value.slice())?;
                } else {
                    writer.write_length_encoded_string(value.slice())?;
                }
            }
        }
        Ok(())
    }

    pub fn write<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        self.write_internal(writer)
    }
}
