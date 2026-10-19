// OK Packet
use crate::mysql::StatusFlags;
use crate::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use crate::mysql::protocol::stack_reader::PacketReader;

#[derive(Default)]
pub struct OKPacket {
    pub header: u8,
    pub affected_rows: u64,
    pub last_insert_id: u64,
    pub status_flags: StatusFlags,
}

impl OKPacket {
    pub fn decode_internal(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        self.header = reader.int::<u8>()?;
        if self.header != 0x00 && self.header != 0xfe {
            return Err(AnyMySQLError::InvalidOKPacket);
        }

        // Affected rows (length encoded integer)
        self.affected_rows = reader.encoded_len_int()?;

        // Last insert ID (length encoded integer)
        self.last_insert_id = reader.encoded_len_int()?;

        // Status flags
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        // Warnings
        reader.int::<u16>()?;

        // Info (EOF-terminated string)
        reader.read(reader.peek().len())?;
        Ok(())
    }
}
