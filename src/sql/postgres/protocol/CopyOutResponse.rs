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
        bun_core::output::panic(format_args!(
            "TODO: not implemented {}",
            "CopyOutResponse",
        ));
    }
}

// TODO(port): `DecoderWrap(CopyOutResponse, decodeInternal).decode` passes a fn as a
// comptime param to a type-generator. Direct delegate; revisit as trait impl.
impl CopyOutResponse {
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyOutResponse.zig (13 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap fn-as-comptime-param needs trait reshape in Phase B
// ──────────────────────────────────────────────────────────────────────────
