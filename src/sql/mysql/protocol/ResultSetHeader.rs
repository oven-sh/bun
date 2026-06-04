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

    // Zig `decoderWrap(@This(), ...)` — see Decode trait in src/sql/mysql/protocol/NewReader.rs
    pub fn decode<Context: ReaderContext>(
        &mut self,
        context: Context,
    ) -> Result<(), AnyMySQLError> {
        self.decode_internal(NewReader { wrapped: context })
    }
}

// ported from: src/sql/mysql/protocol/ResultSetHeader.zig
