use super::new_reader::{decoder_wrap, NewReader};

#[derive(Default)]
pub struct ResultSetHeader {
    pub field_count: u64,
}

impl ResultSetHeader {
    pub fn decode_internal<Context>(&mut self, reader: NewReader<Context>) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Field count (length encoded integer)
        self.field_count = reader.encoded_len_int()?;
        Ok(())
    }

    // TODO(port): `decoderWrap(ResultSetHeader, decodeInternal).decode` is a Zig comptime
    // type-function that wraps `decode_internal` over an anyopaque-backed reader. Phase B
    // should replace this with the trait/impl that `new_reader::decoder_wrap` exposes.
    pub const DECODE: decoder_wrap::Decode<ResultSetHeader> =
        decoder_wrap::<ResultSetHeader>(Self::decode_internal).decode;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/ResultSetHeader.zig (12 lines)
//   confidence: medium
//   todos:      2
//   notes:      decoderWrap is comptime type-gen; Phase B must define the Rust shape in new_reader.rs
// ──────────────────────────────────────────────────────────────────────────
