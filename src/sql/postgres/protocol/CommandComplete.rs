use crate::postgres::protocol::decoder_wrap::DecoderWrap;
use crate::postgres::protocol::new_reader::NewReader;
use crate::shared::Data;

pub struct CommandComplete {
    pub command_tag: Data,
}

impl Default for CommandComplete {
    fn default() -> Self {
        Self { command_tag: Data::Empty }
    }
}

// Zig `deinit` only called `this.command_tag.deinit()`; `Data` owns its own
// `Drop`, so no explicit `Drop` impl is needed here.

impl CommandComplete {
    // PORT NOTE: Zig body is the out-param-constructor pattern (`this.* = .{...}`),
    // which PORTING.md normally reshapes to `fn(...) -> Result<Self, E>`. Kept as
    // `&mut self` here because the `DecoderWrap` trait's `decode_fn` currently
    // requires `&mut self` — revisit if Phase B reshapes DecoderWrap.
    // TODO(port): narrow error set
    pub fn decode_internal<Container>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        let tag = reader.read_z()?;
        *self = Self { command_tag: tag };
        Ok(())
    }

    pub const DECODE: DecoderWrap<CommandComplete, { Self::decode_internal }> =
        DecoderWrap::DECODE;
    // TODO(port): DecoderWrap(CommandComplete, decodeInternal).decode — Phase B
    // should expose this as a trait impl or `pub fn decode` once DecoderWrap's
    // Rust shape is settled.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CommandComplete.zig (24 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap fn-const wrapping needs Phase B trait/macro shape
// ──────────────────────────────────────────────────────────────────────────
