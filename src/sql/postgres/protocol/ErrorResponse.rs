use core::fmt;

use bun_sql::postgres::protocol::field_message::FieldMessage;
use bun_sql::postgres::protocol::new_reader::NewReader;

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
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
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

    pub fn decode<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(reader)
    }
    // TODO(port): DecoderWrap(ErrorResponse, decodeInternal).decode — Zig passes a
    // generic fn as a comptime value; Rust const generics cannot carry generic fn
    // items. Phase B: make DecoderWrap a trait (`impl Decode for ErrorResponse`)
    // whose blanket method calls `Self::decode_internal`. Thin wrapper above
    // preserves the `ErrorResponse::decode(reader)` call shape in the meantime.
}

// Zig `pub const toJS = @import("../../../sql_jsc/...").toJS;` alias deleted —
// `to_js` lives on an extension trait in the `bun_sql_jsc` crate.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/ErrorResponse.zig (38 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap fn-value pattern needs trait redesign in Phase B
// ──────────────────────────────────────────────────────────────────────────
