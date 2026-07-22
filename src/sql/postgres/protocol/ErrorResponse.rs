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
    /// SQLSTATE codes whose ErrorResponse means the server no longer holds (or
    /// no longer accepts) the prepared statement this query was bound to. The
    /// client-side cache entry for that statement must be dropped so the next
    /// execution re-prepares instead of failing forever.
    ///
    /// - 26000 invalid_sql_statement_name: statement was deallocated
    ///   (DEALLOCATE / DISCARD ALL, or a pooler recycled the backend).
    /// - 0A000 feature_not_supported: "cached plan must not change result
    ///   type" after DDL altered a referenced table.
    pub fn is_prepared_statement_invalid(&self) -> bool {
        for msg in &self.messages {
            if let FieldMessage::Code(code) = msg {
                return code.eql_comptime(b"26000") || code.eql_comptime(b"0A000");
            }
        }
        false
    }

    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        // A length of exactly 4 is an empty message (no fields); `length()`
        // already rejected anything smaller.
        let remaining_bytes = reader.length()? - 4;
        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list::<Container>(reader)?,
            });
        }
        Ok(Self::default())
    }
}

// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.
