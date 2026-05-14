use super::decoder_wrap::DecoderWrap;
use super::field_message::FieldMessage;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct NoticeResponse {
    pub messages: Vec<FieldMessage>,
}

// Cleanup only needs to free owned fields (per-message + list buffer).
// Vec<FieldMessage> drops each element (FieldMessage's Drop) and the buffer
// automatically, so no explicit Drop body is needed.

impl NoticeResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let mut remaining_bytes = reader.length()?;
        remaining_bytes = remaining_bytes.saturating_sub(4);

        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list::<Container>(reader)?,
            });
        }
        Ok(Self::default())
    }

    // Decoder helper — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// `toJS` re-export from sql_jsc deleted per PORTING.md — `to_js` lives as
// an extension-trait method in the bun_sql_jsc crate.
