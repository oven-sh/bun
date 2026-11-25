use crate::postgres::AnyPostgresError;
use crate::postgres::pipeline::ErrorKind;
use crate::postgres::protocol::field_message::FieldMessage;
use crate::postgres::protocol::new_reader::NewReader;

#[derive(Default)]
pub struct ErrorResponse {
    pub messages: Vec<FieldMessage>,
}

impl ErrorResponse {
    pub fn decode_internal(reader: &NewReader<'_>) -> Result<Self, AnyPostgresError> {
        let remaining_bytes = reader.body_length()?;
        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list(reader, remaining_bytes)?,
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

    pub fn kind(&self) -> ErrorKind {
        if self.has_code(b"57014") {
            ErrorKind::Canceled
        } else if self.invalidates_prepared_statement() {
            ErrorKind::StaleStatement
        } else {
            ErrorKind::Other
        }
    }

    /// 26000: the server lost the statement. 0A000 from this routine: its result columns changed.
    fn invalidates_prepared_statement(&self) -> bool {
        self.has_code(b"26000")
            || (self.has_code(b"0A000")
                && self.messages.iter().any(|field| {
                    matches!(field, FieldMessage::Routine(routine)
                        if routine.eq_ascii(b"RevalidateCachedQuery"))
                }))
    }
}

// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.
