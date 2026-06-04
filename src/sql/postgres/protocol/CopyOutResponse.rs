use super::new_reader::NewReader;
use crate::postgres::AnyPostgresError;

pub struct CopyOutResponse;

impl CopyOutResponse {
    // Zig source is the same unimplemented panic — COPY TO is not supported yet.
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        &mut self,
        reader: NewReader<Container>,
    ) -> Result<(), AnyPostgresError> {
        drop(reader);
        let _ = self;
        bun_core::output::panic(format_args!("TODO: not implemented {}", "CopyOutResponse",));
    }
}

// Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
impl CopyOutResponse {
    pub fn decode<Container: super::new_reader::ReaderContext>(
        &mut self,
        context: Container,
    ) -> Result<(), AnyPostgresError> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/CopyOutResponse.zig
