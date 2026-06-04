use super::new_reader::{NewReader, ReaderContext};

#[derive(Default)]
pub struct StmtPrepareOKPacket {
    pub status: u8,
    pub statement_id: u32,
    pub num_columns: u16,
    pub num_params: u16,
    pub warning_count: u16,
    pub packet_length: u32,
}

impl StmtPrepareOKPacket {
    // TODO(port): narrow error set
    pub fn decode_internal<Context: ReaderContext>(
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

    // Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub fn decode<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(reader)
    }
}

// ported from: src/sql/mysql/protocol/StmtPrepareOKPacket.zig
