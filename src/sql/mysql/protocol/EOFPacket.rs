use super::super::status_flags::StatusFlags;
use super::any_mysql_error::Error as AnyMySQLError;
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
    ) -> Result<(), AnyMySQLError> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xfe {
            return Err(AnyMySQLError::InvalidEOFPacket);
        }

        self.warnings = reader.int::<u16>()?;
        self.status_flags = StatusFlags::from_int(reader.int::<u16>()?);
        Ok(())
    }
}
