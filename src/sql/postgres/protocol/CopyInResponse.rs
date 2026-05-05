use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

pub struct CopyInResponse;

impl CopyInResponse {
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        mut reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        let _ = reader;
        let _ = self;
        // Zig: bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(@This()))})
        bun_core::output::panic(format_args!("TODO: not implemented {}", "CopyInResponse"));
    }

    // Zig: pub const decode = DecoderWrap(CopyInResponse, decodeInternal).decode;
    // Direct delegate; revisit as trait impl.
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyInResponse.zig (13 lines)
//   confidence: medium
//   todos:      1
//   notes:      DecoderWrap wrapping is a comptime type-fn; needs trait/macro shape in Phase B
// ──────────────────────────────────────────────────────────────────────────
