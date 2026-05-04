use crate::shared::Data;
use super::new_reader::{decoder_wrap, NewReader};

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

// Zig `deinit` only freed `error_message`; `Data: Drop` handles that automatically.

pub struct MySQLErrorOptions {
    // TODO(port): verify lifetime — Zig `[]const u8` field with no deinit; assuming static literal
    pub code: &'static [u8],
    pub errno: Option<u16>,
    pub sql_state: Option<[u8; 5]>,
}

// No `impl Default` — Zig `code: []const u8` has no default, so `.{}` is invalid there too.

// `createMySQLError` lives in bun_sql_jsc::mysql::protocol::error_packet_jsc — *_jsc alias deleted.

impl ErrorPacket {
    pub fn decode_internal<Context>(
        &mut self,
        reader: NewReader<Context>,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.header = reader.int::<u8>()?;
        if self.header != 0xff {
            return Err(bun_core::err!("InvalidErrorPacket"));
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

        // Read the error message (rest of packet)
        // PORT NOTE: reshaped for borrowck — capture peek().len() before mut call
        let remaining = reader.peek().len();
        self.error_message = reader.read(remaining)?;
        Ok(())
    }
}

// TODO(port): `decoderWrap(ErrorPacket, decodeInternal).decode` is a comptime
// fn-to-type wrapper. Approximated here as a thin delegating fn; revisit once
// `decoder_wrap` is ported in new_reader.rs.
pub fn decode<Context>(
    this: &mut ErrorPacket,
    reader: NewReader<Context>,
) -> Result<(), bun_core::Error> {
    decoder_wrap::<ErrorPacket, _>(this, ErrorPacket::decode_internal::<Context>, reader)
}

// `toJS` lives in bun_sql_jsc::mysql::protocol::error_packet_jsc — *_jsc alias deleted.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/ErrorPacket.zig (50 lines)
//   confidence: medium
//   todos:      3
//   notes:      decoderWrap shape guessed; MySQLErrorOptions.code lifetime needs verification
// ──────────────────────────────────────────────────────────────────────────
