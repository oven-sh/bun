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
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        mut reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        let tag = reader.read_z()?;
        *self = Self { command_tag: tag };
        Ok(())
    }

    // TODO(port): DecoderWrap(CommandComplete, decodeInternal).decode — direct delegate.
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CommandComplete.zig (24 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap fn-const wrapping needs Phase B trait/macro shape
// ──────────────────────────────────────────────────────────────────────────
