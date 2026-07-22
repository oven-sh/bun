use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::decode_length_int;
use crate::shared::data::Data;

/// Structural interface a reader context must provide for protocol decoding.
pub trait ReaderContext: Copy {
    fn mark_message_start(self);
    // `&self` (not `self`) so the returned borrow can be tied to the context's
    // buffer lifetime; `Self: Copy` keeps the by-value call sites working.
    fn peek(&self) -> &[u8];
    fn skip(self, count: isize);
    fn ensure_capacity(self, count: usize) -> bool;
    fn read(self, count: usize) -> Result<Data, AnyMySQLError>;
    fn read_z(self) -> Result<Data, AnyMySQLError>;
    fn set_offset_from_start(self, offset: usize);
    /// Bytes from the current offset to the end of the framed packet body, or
    /// `usize::MAX` when no packet is framed (header decoding).
    fn packet_remaining(&self) -> usize;
    fn set_packet_limit_from_start(self, packet_length: usize);
    fn clear_packet_limit(self);
}

#[derive(Clone, Copy)]
pub struct NewReader<C: ReaderContext> {
    pub wrapped: C,
}

impl<C: ReaderContext> NewReader<C> {
    pub fn mark_message_start(self) {
        self.wrapped.mark_message_start();
    }

    pub fn set_offset_from_start(self, offset: usize) {
        self.wrapped.set_offset_from_start(offset);
    }

    pub fn set_packet_limit_from_start(self, packet_length: usize) {
        self.wrapped.set_packet_limit_from_start(packet_length);
    }

    pub fn clear_packet_limit(self) {
        self.wrapped.clear_packet_limit();
    }

    /// Every MySQL packet's body is bounded by the Int<3> payload_length in its
    /// header. The dispatch loop buffers the whole packet before decoding it,
    /// so a body read that still comes up short has overrun the packet, and the
    /// bytes it would return belong to the next packet's framing: that is a
    /// malformed packet, never "wait for more socket data".
    pub fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        if count > self.wrapped.packet_remaining() {
            return Err(AnyMySQLError::MalformedPacket);
        }
        self.wrapped.read(count)
    }

    pub fn skip(self, count: impl TryInto<isize>) {
        self.wrapped
            .skip(count.try_into().ok().expect("skip count fits in isize"));
    }

    pub fn peek(&self) -> &[u8] {
        let limit = self.wrapped.packet_remaining();
        let full = self.wrapped.peek();
        &full[..full.len().min(limit)]
    }

    pub fn read_z(self) -> Result<Data, AnyMySQLError> {
        if bun_core::strings::index_of_char(self.peek(), 0).is_none() {
            return Err(if self.wrapped.packet_remaining() == usize::MAX {
                AnyMySQLError::ShortRead
            } else {
                AnyMySQLError::MalformedPacket
            });
        }
        self.wrapped.read_z()
    }

    pub fn byte(self) -> Result<u8, AnyMySQLError> {
        let data = self.read(1)?;
        Ok(data.slice()[0])
    }

    pub fn ensure_capacity(self, count: usize) -> Result<(), AnyMySQLError> {
        if !self.wrapped.ensure_capacity(count) {
            return Err(AnyMySQLError::ShortRead);
        }
        Ok(())
    }

    pub fn int<I: ReadableInt>(self) -> Result<I, AnyMySQLError> {
        let data = self.read(I::SIZE)?;
        // `defer data.deinit()` → Drop on scope exit
        if I::SIZE == 1 {
            return Ok(I::from_ne_slice(&data.slice()[..1]));
        }
        // Native-endian byte reinterpretation.
        Ok(I::from_ne_slice(&data.slice()[..I::SIZE]))
    }

    /// MySQL's binary result-row protocol transmits `MYSQL_TYPE_INT24` as a
    /// fixed 4-byte field; consume all 4 bytes and decode the low 3.
    /// Consuming only 3 leaves the cursor 1 byte behind and corrupts every
    /// subsequent column.
    pub fn int_u24(self) -> Result<u32, AnyMySQLError> {
        let data = self.read(4)?;
        let s = data.slice();
        Ok(u32::from_le_bytes([s[0], s[1], s[2], 0]))
    }

    /// Consume 4 bytes (see [`Self::int_u24`]), decode the low 3
    /// little-endian bytes and sign-extend to i32.
    pub fn int_i24(self) -> Result<i32, AnyMySQLError> {
        let data = self.read(4)?;
        let s = data.slice();
        let u = u32::from_le_bytes([s[0], s[1], s[2], 0]);
        // sign-extend 24 -> 32
        Ok(((u as i32) << 8) >> 8)
    }

    pub fn encode_len_string(self) -> Result<Data, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return self.read(usize::try_from(result.value).expect("int cast"));
        }
        Err(AnyMySQLError::InvalidEncodedLength)
    }

    pub fn encoded_len_int(self) -> Result<u64, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            return Ok(result.value);
        }
        Err(AnyMySQLError::InvalidEncodedInteger)
    }

    pub fn encoded_len_int_with_size(self, size: &mut usize) -> Result<u64, AnyMySQLError> {
        if let Some(result) = decode_length_int(self.peek()) {
            self.skip(result.bytes_read);
            *size += result.bytes_read;
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
