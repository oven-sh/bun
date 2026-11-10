use crate::postgres::AnyPostgresError;
use crate::postgres::protocol::field_message::FieldMessage;
use crate::postgres::protocol::new_reader::NewReader;

#[derive(Default)]
pub struct ErrorResponse {
    pub messages: Vec<FieldMessage>,
}

impl ErrorResponse {
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

    fn has_code(&self, sqlstate: &[u8]) -> bool {
        self.messages
            .iter()
            .any(|field| matches!(field, FieldMessage::Code(code) if code.eq_ascii(sqlstate)))
    }

    pub fn is_fatal(&self) -> bool {
        self.messages.iter().any(|field| {
            matches!(field, FieldMessage::Severity(severity)
                if severity.eq_ascii(b"FATAL") || severity.eq_ascii(b"PANIC"))
        })
    }

    pub fn is_query_canceled(&self) -> bool {
        self.has_code(b"57014")
    }

    /// 26000: the server lost the statement. 0A000 from this routine: its result columns changed.
    pub fn invalidates_prepared_statement(&self) -> bool {
        self.has_code(b"26000")
            || (self.has_code(b"0A000")
                && self.messages.iter().any(|field| {
                    matches!(field, FieldMessage::Routine(routine)
                        if routine.eq_ascii(b"RevalidateCachedQuery"))
                }))
    }
}

// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.
