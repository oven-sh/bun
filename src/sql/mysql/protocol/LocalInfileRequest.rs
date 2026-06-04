use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct LocalInfileRequest {
    pub filename: Data,
    // Zig `u24`: callers populate this from `PacketHeader.length`, the 3-byte
    // MySQL packet length (always <= 0xFFFFFF), so `u32` holds it losslessly.
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
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        let header = reader.int::<u8>()?;
        if header != 0xFB {
            return Err(AnyMySQLError::InvalidLocalInfileRequest);
        }

        self.filename = reader.read((self.packet_size - 1) as usize)?;
        Ok(())
    }

    // Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/LocalInfileRequest.zig
