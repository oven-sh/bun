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
    /// - 0A000 feature_not_supported with routine RevalidateCachedQuery:
    ///   "cached plan must not change result type" after DDL altered a
    ///   referenced table. 0A000 alone is the generic feature_not_supported
    ///   class and does not mean the plan is invalid; the routine check is
    ///   what pgjdbc uses (`willHealViaReparse`).
    pub fn is_prepared_statement_invalid(&self) -> bool {
        let mut is_26000 = false;
        let mut is_0a000 = false;
        let mut is_revalidate_cached_query = false;
        for msg in &self.messages {
            match msg {
                FieldMessage::Code(code) => {
                    is_26000 = code.eql_comptime(b"26000");
                    is_0a000 = code.eql_comptime(b"0A000");
                    if !is_26000 && !is_0a000 {
                        return false;
                    }
                }
                FieldMessage::Routine(r) => {
                    is_revalidate_cached_query = r.eql_comptime(b"RevalidateCachedQuery");
                }
                _ => {}
            }
        }
        is_26000 || (is_0a000 && is_revalidate_cached_query)
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
