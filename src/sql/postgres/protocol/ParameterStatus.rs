use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;
use crate::shared::Data;

#[derive(Default)]
pub struct ParameterStatus {
    pub name: Data,
    pub value: Data,
}

// Zig `deinit` only forwards to `name.deinit()` / `value.deinit()`; in Rust those
// fields drop automatically, so no explicit `impl Drop` is needed.

impl ParameterStatus {
    // PORT NOTE: reshaped from out-param `fn(this: *@This(), ...) !void` to
    // value-returning constructor per PORTING.md.
    // TODO(port): narrow error set
    pub fn decode_internal<Container: super::new_reader::ReaderContext>(
        mut reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        Ok(Self {
            name: reader.read_z()?,
            value: reader.read_z()?,
        })
    }

    // Zig `DecoderWrap(@This(), ...)` — see src/sql/postgres/protocol/DecoderWrap.rs
    pub fn decode<Container: super::new_reader::ReaderContext>(
        context: Container,
    ) -> Result<Self, bun_core::Error> {
        Self::decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/postgres/protocol/ParameterStatus.zig
