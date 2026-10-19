use super::any_mysql_error::Error as AnyMySQLError;
use super::stack_reader::PacketReader;

pub struct ResultSetHeader {
    pub field_count: u64,
}

impl ResultSetHeader {
    #[inline]
    pub fn new() -> Self {
        Self { field_count: 0 }
    }
}

impl ResultSetHeader {
    pub fn decode_internal(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        // Field count (length encoded integer)
        self.field_count = reader.encoded_len_int()?;
        Ok(())
    }
}
