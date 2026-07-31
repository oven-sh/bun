use super::any_mysql_error::Error as AnyMySQLError;
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
    pub(crate) fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        self.status = reader.int::<u8>()?;
        if self.status != 0 {
            return Err(AnyMySQLError::InvalidPrepareOKPacket);
        }

        self.statement_id = reader.int::<u32>()?;
        // The server never issues statement_id 0, and the client keys its own
        // "prepared" state on statement_id > 0 (see handle_prepared_statement
        // and bind_and_execute), so a 0 here is a protocol violation.
        if self.statement_id == 0 {
            return Err(AnyMySQLError::InvalidPrepareOKPacket);
        }
        self.num_columns = reader.int::<u16>()?;
        self.num_params = reader.int::<u16>()?;
        let _ = reader.int::<u8>()?; // reserved_1
        if self.packet_length >= 12 {
            self.warning_count = reader.int::<u16>()?;
        }
        Ok(())
    }

    pub fn decode<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(reader)
    }
}
