use super::super::status_flags::StatusFlags;
use super::new_reader::{decoder_wrap, NewReader};

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
    pub fn decode_internal<Context>(&mut self, reader: NewReader<Context>) -> Result<(), bun_core::Error> {
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
// TODO(port): decoder_wrap is a comptime type-generator in Zig; Phase B decides macro vs generic fn.
decoder_wrap!(EOFPacket, decode_internal);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/EOFPacket.zig (21 lines)
//   confidence: medium
//   todos:      2
//   notes:      decoder_wrap shape (macro vs generic) and NewReader<Context> trait bound resolved in Phase B
// ──────────────────────────────────────────────────────────────────────────
