use super::super::status_flags::StatusFlags;
use super::any_mysql_error::Error as AnyMySQLError;
use super::stack_reader::PacketReader;

pub struct EOFPacket {
    pub(crate) header: u8,
    pub status_flags: StatusFlags,
}

impl Default for EOFPacket {
    fn default() -> Self {
        Self {
            header: 0xfe,
            status_flags: StatusFlags::default(),
        }
    }
}

impl EOFPacket {
    pub fn decode_internal(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(AnyMySQLError::InvalidEOFPacket);
        }

        reader.int::<u16>()?; // warnings
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        Ok(())
    }
}
