use crate::shared::Data;
use super::new_reader::{NewReader, decoder_wrap};

pub struct LocalInfileRequest {
    pub filename: Data,
    // TODO(port): Zig `u24` — Rust has no native u24; using u32. Verify wire-format
    // callers populate this from the 3-byte MySQL packet length correctly.
    pub packet_size: u32,
}

impl Default for LocalInfileRequest {
    fn default() -> Self {
        Self {
            filename: Data::Empty,
            // packet_size has no Zig default; caller must set before decode.
            packet_size: 0,
        }
    }
}

// Zig `deinit` only called `this.filename.deinit()`; `Data` owns its drop, so no
// explicit `impl Drop` is needed here.

impl LocalInfileRequest {
    // TODO(port): narrow error set
    pub fn decode_internal<Context>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        let header = reader.int::<u8>()?;
        if header != 0xFB {
            return Err(bun_core::err!("InvalidLocalInfileRequest"));
        }

        self.filename = reader.read(self.packet_size - 1)?;
        Ok(())
    }

    // Zig: `pub const decode = decoderWrap(LocalInfileRequest, decodeInternal).decode;`
    // TODO(port): `decoderWrap` is a comptime type-returning wrapper in NewReader.zig.
    // Phase B should express it as a trait/macro; for now forward through the helper.
    pub fn decode(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        decoder_wrap::<Self, _>(self, Self::decode_internal, bytes)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/LocalInfileRequest.zig (22 lines)
//   confidence: medium
//   todos:      3
//   notes:      u24 → u32; decoderWrap shape guessed — fix once NewReader.rs lands.
// ──────────────────────────────────────────────────────────────────────────
