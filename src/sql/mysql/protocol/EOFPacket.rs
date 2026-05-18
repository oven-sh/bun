use super::super::status_flags::StatusFlags;
use super::new_reader::{NewReader, ReaderContext};

pub struct EOFPacket {
    pub header: u8,
    pub warnings: u16,
    pub status_flags: StatusFlags,
}

impl Default for EOFPacket {
    fn default() -> Self {
        Self {
            header: 0xfe,
            warnings: 0,
            status_flags: StatusFlags::default(),
        }
    }
}

impl EOFPacket {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(bun_core::err!("InvalidEOFPacket"));
        }

        self.warnings = reader.int::<u16>()?;
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        Ok(())
    }
}

// Zig: pub const decode = decoderWrap(EOFPacket, decodeInternal).decode;
impl EOFPacket {
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), bun_core::Error> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/EOFPacket.zig
