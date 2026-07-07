// OK Packet
use crate::mysql::StatusFlags;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct OKPacket {
    pub header: u8,
    pub affected_rows: u64,
    pub last_insert_id: u64,
    pub status_flags: StatusFlags,
    pub warnings: u16,
    pub info: Data,
    pub session_state_changes: Data,
    pub packet_size: u32,
}

// `packet_size` must be supplied by the caller, so no `Default` impl —
// consider adding `OKPacket::new(packet_size)`.

impl OKPacket {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        let mut read_size: usize = 5; // header + status flags + warnings
        self.header = reader.int::<u8>()?;
        if self.header != 0x00 && self.header != 0xfe {
            return Err(AnyMySQLError::InvalidOKPacket);
        }

        // Affected rows (length encoded integer)
        self.affected_rows = reader.encoded_len_int_with_size(&mut read_size)?;

        // Last insert ID (length encoded integer)
        self.last_insert_id = reader.encoded_len_int_with_size(&mut read_size)?;

        // Status flags
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        // Warnings
        self.warnings = reader.int::<u16>()?;

        // Info (EOF-terminated string)
        if !reader.peek().is_empty() && (self.packet_size as usize) > read_size {
            let remaining = (self.packet_size as usize) - read_size;
            self.info = reader.read(remaining as _)?;
        }
        Ok(())
    }
}
