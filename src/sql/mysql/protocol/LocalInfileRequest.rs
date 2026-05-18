use super::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

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
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        let header = reader.int::<u8>()?;
        if header != 0xFB {
            return Err(bun_core::err!("InvalidLocalInfileRequest"));
        }

        self.filename = reader.read((self.packet_size - 1) as usize)?;
        Ok(())
    }

    // Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/LocalInfileRequest.zig
