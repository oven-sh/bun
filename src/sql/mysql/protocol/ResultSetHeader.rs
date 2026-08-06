use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};

#[derive(Default)]
pub struct ResultSetHeader {
    pub field_count: u64,
}

impl ResultSetHeader {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        // Field count (length encoded integer)
        self.field_count = reader.encoded_len_int()?;
        Ok(())
    }
}
