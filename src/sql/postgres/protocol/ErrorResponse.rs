use core::fmt;

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

// Zig `deinit` only frees owned fields (per-element `message.deinit()` then
// `messages.deinit(bun.default_allocator)`); Vec<FieldMessage> + FieldMessage's
// Drop handle both automatically, so no explicit Drop impl is needed.

impl ErrorResponse {
    // PORT NOTE: reshaped from `(this: *@This(), ...) !void` out-param constructor
    // to `-> Result<Self, E>`; the Zig `remaining_bytes == 0` branch left `this.*`
    // at its default-init state, so we return `Self::default()` there.
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        // TODO(port): narrow error set
        let mut remaining_bytes = reader.length()?;
        if remaining_bytes < 4 {
            return Err(bun_core::err!("InvalidMessageLength"));
        }
        remaining_bytes = remaining_bytes.saturating_sub(4);

        if remaining_bytes > 0 {
            return Ok(Self {
                messages: FieldMessage::decode_list::<Container>(reader)?,
            });
        }
        Ok(Self::default())
    }

    // Zig DecoderWrap takes a raw `context` and wraps it as `NewReader{.wrapped=context}`.
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }
    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
}

// Zig `pub const toJS = @import("../../../sql_jsc/...").toJS;` alias deleted —
// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.

// ported from: src/sql/postgres/protocol/ErrorResponse.zig
