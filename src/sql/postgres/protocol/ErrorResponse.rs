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
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        // A length of exactly 4 is an empty message (no fields); `length()`
        // already rejected anything smaller.
        let remaining_bytes = reader.length()? - 4;
        if remaining_bytes == 0 {
            return Ok(Self::default());
        }
        // Read the entire declared body as one slice so the connection
        // reader advances by exactly the frame length. Parsing the field
        // list out of that slice then cannot under- or over-run into the
        // next message regardless of what the body contains.
        let body = reader.read(remaining_bytes as usize)?;
        Ok(Self {
            messages: FieldMessage::decode_list_from_slice(body.slice()),
        })
    }
}

// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.
