use super::any_mysql_error::Error as AnyMySQLError;
use super::packet_reader::PacketReader;

#[derive(Default)]
pub(crate) struct StmtPrepareOKPacket {
    pub(crate) status: u8,
    pub(crate) statement_id: u32,
    pub(crate) num_columns: u16,
    pub(crate) num_params: u16,
}

impl StmtPrepareOKPacket {
    pub(crate) fn decode(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        self.status = reader.int::<u8>()?;
        if self.status != 0 {
            return Err(AnyMySQLError::InvalidPrepareOKPacket);
        }

        self.statement_id = reader.int::<u32>()?;
        // No server issues it.
        if self.statement_id == 0 {
            return Err(AnyMySQLError::InvalidPrepareOKPacket);
        }
        self.num_columns = reader.int::<u16>()?;
        self.num_params = reader.int::<u16>()?;
        let _ = reader.int::<u8>()?; // reserved_1
        if reader.peek().len() >= 2 {
            reader.int::<u16>()?; // warning_count
        }
        Ok(())
    }
}
