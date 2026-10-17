use super::any_mysql_error;
use super::command_type::CommandType;
use super::new_writer::{NewWriter, WriterContext};
use crate::mysql::mysql_types::FieldType;

bun_core::declare_scope!(PreparedStatement, hidden);

/// A bound parameter value. The concrete type (`bun_sql_jsc`'s `Value`) lives
/// in a higher-tier crate this crate cannot depend on.
pub trait ExecuteParam {
    fn field_type(&self) -> FieldType;
    fn is_unsigned(&self) -> bool;
    /// The value in the binary protocol's form for `field_type()`; nothing for `MYSQL_TYPE_NULL`.
    fn write<C: WriterContext>(&self, writer: NewWriter<C>) -> Result<(), any_mysql_error::Error>;
}

pub struct Execute<'a, P: ExecuteParam> {
    /// ID of the prepared statement to execute, returned from COM_STMT_PREPARE
    pub statement_id: u32,
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
        let Some(null_bitmap) = null_bitmap_buf.get_mut(..bitmap_bytes) else {
            return Err(any_mysql_error::Error::WrongNumberOfParametersProvided);
        };

        for (i, param) in self.params.iter().enumerate() {
            if param.field_type() == FieldType::MYSQL_TYPE_NULL {
                null_bitmap[i >> 3] |= 1u8 << ((i & 7) as u8);
            }
        }

        writer.write(null_bitmap)?;
        Ok(())
    }

    pub fn write<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
    ) -> Result<(), any_mysql_error::Error> {
        writer.int1(CommandType::COM_STMT_EXECUTE as u8)?;
        writer.int4(self.statement_id)?;
        writer.int1(0)?; // flags: no cursor
        writer.int4(1)?; // iteration count

        if !self.params.is_empty() {
            self.write_null_bitmap(writer)?;

            // new_params_bind_flag: the types belong to the execution, not to the statement
            writer.int1(1)?;
            for param in self.params {
                let field_type = param.field_type();
                let unsigned = param.is_unsigned();
                bun_core::scoped_log!(
                    PreparedStatement,
                    "param {} unsigned? {}",
                    <&'static str>::from(field_type),
                    unsigned
                );
                writer.int1(field_type as u8)?;
                writer.int1(if unsigned { 0x80 } else { 0 })?;
            }

            for param in self.params {
                param.write(writer)?;
            }
        }
        Ok(())
    }
}
