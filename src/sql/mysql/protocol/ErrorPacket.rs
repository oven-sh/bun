use super::any_mysql_error::Error as AnyMySQLError;
use super::packet_reader::PacketReader;

pub struct ErrorPacket<'a> {
    pub header: u8,
    pub error_code: u16,
    pub sql_state: Option<[u8; 5]>,
    pub error_message: &'a [u8],
}

impl Default for ErrorPacket<'_> {
    fn default() -> Self {
        Self {
            header: 0xff,
            error_code: 0,
            sql_state: None,
            error_message: b"",
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

impl<'a> ErrorPacket<'a> {
    pub fn decode_internal(&mut self, reader: PacketReader<'a>) -> Result<(), AnyMySQLError> {
        self.header = reader.int::<u8>()?;
        if self.header != 0xff {
            return Err(AnyMySQLError::InvalidErrorPacket);
        }

        self.error_code = reader.int::<u16>()?;

        // Check if we have a SQL state marker
        let next_byte = reader.int::<u8>()?;
        if next_byte == b'#' {
            let sql_state_data = reader.read(5)?;
            self.sql_state = Some(sql_state_data[0..5].try_into().expect("unreachable"));
        } else {
            // No SQL state, rewind one byte
            reader.skip(-1);
        }

        self.error_message = reader.read(reader.peek().len())?;
        Ok(())
    }

    /// ER_NET_PACKET_TOO_LARGE: the server hangs up behind it.
    pub fn ends_session(&self) -> bool {
        self.error_code == 1153
    }
}

// `toJS` lives in bun_sql_jsc::mysql::protocol::error_packet_jsc — *_jsc alias deleted.
