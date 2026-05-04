use super::decoder_wrap::DecoderWrap;
use super::field_message::FieldMessage;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct NoticeResponse {
    pub messages: Vec<FieldMessage>,
}

// Zig `deinit` only freed owned fields (per-message deinit + list free).
// Vec<FieldMessage> drops each element (FieldMessage's Drop) and the buffer
// automatically, so no explicit Drop body is needed.

impl NoticeResponse {
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
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

    // Zig: pub const decode = DecoderWrap(NoticeResponse, decodeInternal).decode;
    // TODO(port): DecoderWrap is a comptime type-generator; Phase B should expose
    // this via a trait impl or macro in decoder_wrap.rs.
    pub fn decode<Container>(reader: NewReader<Container>) -> Result<Self, bun_core::Error> {
        DecoderWrap::decode::<Self, Container>(Self::decode_internal, reader)
    }
}

// Zig `toJS` re-export from sql_jsc deleted per PORTING.md — `to_js` lives as
// an extension-trait method in the bun_sql_jsc crate.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/NoticeResponse.zig (28 lines)
//   confidence: medium
//   todos:      2
//   notes:      decode_internal reshaped from out-param to Result<Self>; DecoderWrap call shape is a guess
// ──────────────────────────────────────────────────────────────────────────
