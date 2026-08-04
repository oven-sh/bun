use core::fmt;

use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::field_message::FieldMessage;
use crate::postgres::protocol::new_reader::NewReader;

#[derive(Default)]
pub struct ErrorResponse {
    pub messages: Vec<FieldMessage>,
}

impl fmt::Display for ErrorResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for message in &self.messages {
            writeln!(f, "{}", message)?;
        }
        Ok(())
    }
}

impl ErrorResponse {
    /// True when the server-side prepared statement is gone (SQLSTATE `26000`)
    /// or its cached plan is stale (SQLSTATE `0A000` from routine
    /// `RevalidateCachedQuery`; `0A000` alone is the generic
    /// feature_not_supported class). Mirrors pgjdbc `willHealViaReparse`.
    pub fn invalidates_prepared_statement(&self) -> bool {
        let mut code_26000 = false;
        let mut code_0a000 = false;
        let mut routine_revalidate = false;
        for m in &self.messages {
            match m {
                FieldMessage::Code(code) => {
                    code_26000 = code.eql_comptime(b"26000");
                    code_0a000 = code.eql_comptime(b"0A000");
                }
                FieldMessage::Routine(r) => {
                    routine_revalidate = r.eql_comptime(b"RevalidateCachedQuery");
                }
                _ => {}
            }
        }
        code_26000 || (code_0a000 && routine_revalidate)
    }

    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let remaining_bytes = reader.body_length()?;
        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list::<Container>(reader, remaining_bytes)?,
            });
        }
        Ok(Self::default())
    }
}

// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.
