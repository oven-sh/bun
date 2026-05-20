use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

#[derive(Default)]
pub struct BackendKeyData {
    pub process_id: u32,
    pub secret_key: u32,
}

impl BackendKeyData {
    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
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

// ported from: src/sql/postgres/protocol/BackendKeyData.zig
