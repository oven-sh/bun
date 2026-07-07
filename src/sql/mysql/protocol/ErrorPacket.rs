use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::{NewReader, ReaderContext};
use crate::shared::Data;

pub struct ErrorPacket {
    pub header: u8,
    pub error_code: u16,
    pub sql_state_marker: Option<u8>,
    pub sql_state: Option<[u8; 5]>,
    pub error_message: Data,
}

impl Default for ErrorPacket {
    fn default() -> Self {
        Self {
            header: 0xff,
            error_code: 0,
            sql_state_marker: None,
            sql_state: None,
            error_message: Data::empty(),
        }
    }
}

pub struct MySQLErrorOptions {
    // Every constructor (error_packet_jsc.rs, any_mysql_error_jsc.rs) passes a
    // `b"ERR_..."` literal, so `'static` holds.
    pub code: &'static [u8],
    pub errno: Option<u16>,
    pub sql_state: Option<[u8; 5]>,
}

// `createMySQLError` lives in bun_sql_jsc::mysql::protocol::error_packet_jsc — *_jsc alias deleted.

impl ErrorPacket {
    pub fn decode_internal<Context: ReaderContext>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), AnyMySQLError> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xff {
            return Err(AnyMySQLError::InvalidErrorPacket);
        }

        self.error_code = reader.int::<u16>()?;

        // Check if we have a SQL state marker
        let next_byte = reader.int::<u8>()?;
        if next_byte == b'#' {
            self.sql_state_marker = Some(b'#');
            let sql_state_data = reader.read(5)?;
            // `defer sql_state_data.deinit()` — Drop handles it.
            self.sql_state = Some(
                sql_state_data.slice()[0..5]
                    .try_into()
                    .expect("unreachable"),
            );
        } else {
            // No SQL state, rewind one byte
            reader.skip(-1);
        }

        // Read the error message (rest of packet).
        // Reshaped for borrowck — capture peek().len() before the mut call.
        let remaining = reader.peek().len();
        self.error_message = reader.read(remaining)?;
        Ok(())
    }
}

pub fn decode<Context: ReaderContext>(
    this: &mut ErrorPacket,
    reader: NewReader<Context>,
) -> Result<(), AnyMySQLError> {
    this.decode_internal(reader)
}

// `toJS` lives in bun_sql_jsc::mysql::protocol::error_packet_jsc — *_jsc alias deleted.
