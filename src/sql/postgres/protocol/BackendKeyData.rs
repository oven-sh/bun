use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct BackendKeyData {
    pub process_id: u32,
    pub secret_key: u32,
}

impl BackendKeyData {
    // TODO(port): `pub const decode = DecoderWrap(BackendKeyData, decodeInternal).decode;`
    // DecoderWrap is a comptime type-generator wrapping `decode_internal` into a standard
    // `decode` entry point. Phase B: express as a trait impl or thin wrapper once
    // DecoderWrap's Rust shape is settled.
    pub fn decode<Container: super::new_reader::ReaderContext>(context: Container) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }

    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        if !reader.expect_int::<u32>(12)? {
            return Err(crate::postgres::AnyPostgresError::InvalidBackendKeyData.into());
        }

        Ok(Self {
            // @bitCast i32 -> u32: same-width signed→unsigned `as` cast preserves bits.
            process_id: reader.int4()? as u32,
            secret_key: reader.int4()? as u32,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/BackendKeyData.zig (20 lines)
//   confidence: medium
//   todos:      2
//   notes:      DecoderWrap comptime wrapper needs trait/shape from Phase B; out-param ctor reshaped to Result<Self>.
// ──────────────────────────────────────────────────────────────────────────
