use crate::shared::Data;
use super::decoder_wrap::DecoderWrap;
use super::new_reader::NewReader;

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
    pub fn decode_internal<Container>(
        reader: NewReader<Container>,
    ) -> Result<Self, bun_core::Error> {
        let length = reader.length()?;
        debug_assert!(length >= 4);

        Ok(Self {
            name: reader.read_z()?,
            value: reader.read_z()?,
        })
    }

    // Zig: `pub const decode = DecoderWrap(ParameterStatus, decodeInternal).decode;`
    // TODO(port): `DecoderWrap` is a comptime type-returning fn; Phase B should
    // expose this via whatever trait/wrapper `decoder_wrap` lands on.
    pub fn decode<Container>(reader: NewReader<Container>) -> Result<Self, bun_core::Error> {
        DecoderWrap::<ParameterStatus>::decode(reader)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/ParameterStatus.zig (26 lines)
//   confidence: medium
//   todos:      2
//   notes:      `decode` delegation depends on DecoderWrap's Rust shape; decode_internal reshaped to return Self
// ──────────────────────────────────────────────────────────────────────────
