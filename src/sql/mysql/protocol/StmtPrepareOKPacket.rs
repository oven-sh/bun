use super::new_reader::{decoder_wrap, NewReader};

pub struct StmtPrepareOKPacket {
    pub status: u8,
    pub statement_id: u32,
    pub num_columns: u16,
    pub num_params: u16,
    pub warning_count: u16,
    // TODO(port): Zig type is u24; Rust has no native u24. Value is bounded to 24 bits.
    pub packet_length: u32,
}

impl Default for StmtPrepareOKPacket {
    fn default() -> Self {
        Self {
            status: 0,
            statement_id: 0,
            num_columns: 0,
            num_params: 0,
            warning_count: 0,
            // packet_length has no default in Zig; caller must set it before decode.
            packet_length: 0,
        }
    }
}

impl StmtPrepareOKPacket {
    // TODO(port): narrow error set
    pub fn decode_internal<Context>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        self.status = reader.int::<u8>()?;
        if self.status != 0 {
            return Err(bun_core::err!("InvalidPrepareOKPacket"));
        }

        self.statement_id = reader.int::<u32>()?;
        self.num_columns = reader.int::<u16>()?;
        self.num_params = reader.int::<u16>()?;
        let _ = reader.int::<u8>()?; // reserved_1
        if self.packet_length >= 12 {
            self.warning_count = reader.int::<u16>()?;
        }
        Ok(())
    }

    // TODO(port): `pub const decode = decoderWrap(StmtPrepareOKPacket, decodeInternal).decode;`
    // decoder_wrap is a comptime type-generator in Zig; Phase B should expose the wrapped
    // entry point once NewReader/decoder_wrap are ported.
    pub fn decode<Context>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        decoder_wrap::<StmtPrepareOKPacket, _>(Self::decode_internal)(self, reader)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/StmtPrepareOKPacket.zig (26 lines)
//   confidence: medium
//   todos:      3
//   notes:      u24 packet_length widened to u32; decoder_wrap shape guessed pending NewReader port
// ──────────────────────────────────────────────────────────────────────────
