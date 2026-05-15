use crate::postgres::protocol::decoder_wrap::DecoderWrap;
use crate::postgres::protocol::new_reader::NewReader;
use crate::shared::Data;

pub struct CommandComplete {
    pub command_tag: Data,
}

impl Default for CommandComplete {
    fn default() -> Self {
        Self {
            command_tag: Data::Empty,
        }
    }
}

// `Data` owns its own `Drop`, so no explicit `Drop` impl is needed here.

impl CommandComplete {
    // PORT NOTE: out-param-constructor pattern, which PORTING.md normally
    // reshapes to `fn(...) -> Result<Self, E>`. Kept as `&mut self` to match
    // the DecoderWrap shape — see src/sql/postgres/protocol/DecoderWrap.rs
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

    // See src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}
