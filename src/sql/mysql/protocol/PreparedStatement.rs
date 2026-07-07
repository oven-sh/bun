use super::any_mysql_error;
use super::column_definition41::ColumnFlags;
use super::command_type::CommandType;
use super::new_reader::{NewReader, ReaderContext};
use super::new_writer::{NewWriter, WriterContext};
use crate::mysql::mysql_param::Param;
use crate::mysql::mysql_types::FieldType;

bun_core::declare_scope!(PreparedStatement, hidden);

#[derive(Default)]
pub struct PrepareOK {
    pub status: u8,
    pub statement_id: u32,
    pub num_columns: u16,
    pub num_params: u16,
    pub warning_count: u16,
}

impl PrepareOK {
    pub fn decode_internal<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), any_mysql_error::Error> {
        self.status = reader.int::<u8>()?;
        if self.status != 0 {
            return Err(any_mysql_error::Error::InvalidPrepareOKPacket);
        }

        self.statement_id = reader.int::<u32>()?;
        self.num_columns = reader.int::<u16>()?;
        self.num_params = reader.int::<u16>()?;
        let _ = reader.int::<u8>()?; // reserved_1
        self.warning_count = reader.int::<u16>()?;
        Ok(())
    }

    pub fn decode<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), any_mysql_error::Error> {
        self.decode_internal(reader)
    }
}

pub struct Execute<'a, P: ParamSource + ?Sized> {
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
    // `params: []Value` — see [`ParamSource`].
    pub params: &'a P,
}

/// Per-parameter accessor for [`Execute`]. The concrete parameter values
/// (`bun_runtime::sql_jsc`'s `Value`) live above this crate, so the protocol
/// encodes through this trait instead of naming the type. Implemented for
/// `[Value]` in `bun_runtime::sql_jsc::mysql::my_sql_value`.
pub trait ParamSource {
    fn count(&self) -> usize;
    /// `param == .null`
    fn is_null(&self, i: usize) -> bool;
    /// `param.toData(field_type)`
    fn to_data(
        &self,
        i: usize,
        field_type: FieldType,
    ) -> Result<crate::shared::Data, any_mysql_error::Error>;
}

impl<'a, P: ParamSource + ?Sized> Execute<'a, P> {
    fn write_null_bitmap<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        const MYSQL_MAX_PARAMS: usize = (u16::MAX as usize / 8) + 1;

        let mut null_bitmap_buf = [0u8; MYSQL_MAX_PARAMS];
        let bitmap_bytes = self.params.count().div_ceil(8);
        let null_bitmap = &mut null_bitmap_buf[0..bitmap_bytes];
        null_bitmap.fill(0);

        for i in 0..self.params.count() {
            if self.params.is_null(i) {
                null_bitmap[i >> 3] |= 1u8 << ((i & 7) as u8);
            }
        }

        writer.write(null_bitmap)?;
        Ok(())
    }

    pub fn write_internal<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        writer.int1(CommandType::COM_STMT_EXECUTE as u8)?;
        writer.int4(self.statement_id)?;
        writer.int1(self.flags)?;
        writer.int4(self.iteration_count)?;

        if self.params.count() > 0 {
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
            debug_assert_eq!(self.params.count(), self.param_types.len());
            for (i, param_type) in self.param_types.iter().enumerate() {
                if self.params.is_null(i) || param_type.r#type == FieldType::MYSQL_TYPE_NULL {
                    continue;
                }

                let value = self.params.to_data(i, param_type.r#type)?;
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
