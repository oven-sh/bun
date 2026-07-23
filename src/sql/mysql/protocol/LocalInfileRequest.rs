use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct LocalInfileRequest {
    pub filename: Data,
    // Callers populate this from `PacketHeader.length`, the 3-byte
    // MySQL packet length (always <= 0xFFFFFF), so `u32` holds it losslessly.
    pub packet_size: u32,
}

impl Default for LocalInfileRequest {
    fn default() -> Self {
        Self {
            filename: Data::Empty,
            // Caller must set packet_size before decode.
            packet_size: 0,
        }
    }
}

impl LocalInfileRequest {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        let header = reader.int::<u8>()?;
        if header != 0xFB {
            return Err(AnyMySQLError::InvalidLocalInfileRequest);
        }

        let Some(filename_len) = self.packet_size.checked_sub(1) else {
            return Err(AnyMySQLError::InvalidLocalInfileRequest);
        };
        self.filename = reader.read(filename_len as usize)?;
        Ok(())
    }
}
