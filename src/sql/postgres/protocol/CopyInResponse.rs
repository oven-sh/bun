use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

pub struct CopyInResponse;

impl CopyInResponse {
    pub fn decode_internal<Container>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), bun_core::Error> {
        let _ = reader;
        let _ = self;
        // Zig: bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(@This()))})
        bun_core::output::panic(format_args!("TODO: not implemented {}", "CopyInResponse"));
    }

    // Zig: pub const decode = DecoderWrap(CopyInResponse, decodeInternal).decode;
    // TODO(port): DecoderWrap is a Zig comptime type-generator that wraps decode_internal;
    // Phase B should express this as a trait impl or macro from super::decoder_wrap.
    pub const DECODE: DecoderWrap<CopyInResponse> = DecoderWrap::new(Self::decode_internal);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/CopyInResponse.zig (13 lines)
//   confidence: medium
//   todos:      1
//   notes:      DecoderWrap wrapping is a comptime type-fn; needs trait/macro shape in Phase B
// ──────────────────────────────────────────────────────────────────────────
