use super::field_message::FieldMessage;
use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

#[derive(Default)]
pub struct NoticeResponse {
    pub messages: Vec<FieldMessage>,
}

// Vec<FieldMessage> drops each element (FieldMessage's Drop) and the buffer
// automatically, so no explicit Drop body is needed.

impl NoticeResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, AnyPostgresError> {
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);

        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list::<Container>(reader)?,
            });
        }
        Ok(Self::default())
    }

    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, AnyPostgresError> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// `to_js` lives as an extension-trait method in the bun_sql_jsc crate.
