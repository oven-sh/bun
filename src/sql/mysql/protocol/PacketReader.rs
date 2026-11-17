use core::cell::Cell;

use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::decode_length_int;
use crate::shared::stack_reader::{ShortRead, StackReader};

/// Fields are only read from a whole packet, so a short field is malformed.
impl ShortRead for AnyMySQLError {
    const SHORT_READ: Self = AnyMySQLError::MalformedPacket;
}

#[derive(Clone, Copy)]
pub struct PacketReader<'a> {
    wrapped: StackReader<'a>,
}

impl<'a> PacketReader<'a> {
    pub(crate) fn new(payload: &'a [u8], offset: &'a Cell<usize>) -> Self {
        Self {
            wrapped: StackReader {
                buffer: payload,
                offset,
                // Nothing here reads it: the one message starts where the buffer does.
                message_start: offset,
            },
        }
    }

    pub fn peek(&self) -> &'a [u8] {
        self.wrapped.peek()
    }

    pub fn read(self, count: usize) -> Result<&'a [u8], AnyMySQLError> {
        self.wrapped.read(count)
    }

    pub fn skip(self, count: impl TryInto<isize>) {
        self.wrapped
            .skip(count.try_into().ok().expect("skip count fits in isize"));
    }

    pub(crate) fn read_z(self) -> Result<&'a [u8], AnyMySQLError> {
        self.wrapped.read_z()
    }

    pub fn byte(self) -> Result<u8, AnyMySQLError> {
        let data = self.read(1)?;
        Ok(data[0])
    }

    pub fn int<I: ReadableInt>(self) -> Result<I, AnyMySQLError> {
        let data = self.read(I::SIZE)?;
        Ok(I::from_ne_slice(data))
    }

    /// MySQL's binary result-row protocol transmits `MYSQL_TYPE_INT24` as a
    /// fixed 4-byte field; consume all 4 bytes and decode the low 3.
    /// Consuming only 3 leaves the cursor 1 byte behind and corrupts every
    /// subsequent column.
    pub fn int_u24(self) -> Result<u32, AnyMySQLError> {
        let s = self.read(4)?;
        Ok(u32::from_le_bytes([s[0], s[1], s[2], 0]))
    }

    /// Consume 4 bytes (see [`Self::int_u24`]), decode the low 3
    /// little-endian bytes and sign-extend to i32.
    pub fn int_i24(self) -> Result<i32, AnyMySQLError> {
        let s = self.read(4)?;
        let u = u32::from_le_bytes([s[0], s[1], s[2], 0]);
        // sign-extend 24 -> 32
        Ok(((u as i32) << 8) >> 8)
    }

    pub fn encode_len_string(self) -> Result<&'a [u8], AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return self.read(usize::try_from(result.value).expect("int cast"));
        }
        Err(AnyMySQLError::InvalidEncodedLength)
    }

    pub(crate) fn encoded_len_int(self) -> Result<u64, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return Ok(result.value);
        }
        Err(AnyMySQLError::InvalidEncodedInteger)
    }
}

/// The canonical native-endian int codec lives in `bun_core`; re-exported here
/// under the protocol-local name so callers (`int<I: ReadableInt>()` and
/// `bun_sql::ReadableInt`) keep their paths.
/// MySQL's u24/i24 are NOT routed through this trait — see `int_u24`/`int_i24`.
pub use bun_core::NativeEndianInt as ReadableInt;
