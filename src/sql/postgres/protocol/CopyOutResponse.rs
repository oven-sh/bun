use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

pub struct CopyOutResponse;

impl CopyOutResponse {
    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        mut reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        let _ = reader;
        let _ = self;
        bun_core::output::panic(format_args!("TODO: not implemented {}", "CopyOutResponse",));
    }
}

// Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
impl CopyOutResponse {
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/CopyOutResponse.zig
