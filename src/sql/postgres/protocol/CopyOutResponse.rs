use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

pub struct CopyOutResponse;

impl CopyOutResponse {
    // TODO(port): narrow error set
    pub fn decode_internal<Container>(
        &mut self,
        reader: NewReader<Container>,
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
// comptime param to a type-generator. In Rust this is a trait (`Decode`) with a blanket
// impl that calls `decode_internal`. Phase B: wire the trait and delete this alias.
pub use DecoderWrap::<CopyOutResponse>::decode;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyOutResponse.zig (13 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap fn-as-comptime-param needs trait reshape in Phase B
// ──────────────────────────────────────────────────────────────────────────
