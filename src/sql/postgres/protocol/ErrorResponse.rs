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
    /// True when this error means the server-side prepared statement the
    /// client bound to is gone or stale and a fresh Parse under a new name
    /// will succeed:
    ///
    /// - SQLSTATE `26000` (`invalid_sql_statement_name`): the named statement
    ///   does not exist, e.g. after `DEALLOCATE ALL` / `DISCARD ALL` or a
    ///   pooler swapping the backend.
    /// - SQLSTATE `0A000` with routine `RevalidateCachedQuery`: "cached plan
    ///   must not change result type", emitted when DDL (e.g. `ALTER TABLE …
    ///   ADD COLUMN`) invalidates the cached plan's result descriptor. `0A000`
    ///   is the generic `feature_not_supported` class, so the routine narrows
    ///   it to the plancache case (matching pgjdbc's `willHealViaReparse`).
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
