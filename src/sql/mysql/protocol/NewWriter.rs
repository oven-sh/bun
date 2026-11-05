use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::encode_length_int;
use super::packet_header::PacketHeader;
use crate::mysql::mysql_types::MySQLInt32;

bun_core::declare_scope!(NewWriter, hidden);

/// Structural interface a writer context must provide for protocol encoding.
pub trait WriterContext: Copy {
    fn offset(self) -> usize;
    fn write(self, bytes: &[u8]) -> Result<(), AnyMySQLError>;
    fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyMySQLError>;
    /// Discard everything written at or after `offset` (a value previously
    /// returned by `offset()`). Used to roll a partially-serialized packet
    /// back out of the write buffer when it cannot be framed.
    fn truncate(self, offset: usize);
    /// `slice::copy_within` on the written bytes; offsets as returned by `offset()`.
    fn copy_within(self, src: core::ops::Range<usize>, dest: usize);
}

#[derive(Clone, Copy)]
pub struct NewWriterWrap<C: WriterContext> {
    pub wrapped: C,
}

pub struct Packet<C: WriterContext> {
    pub(crate) sequence_id: u8,
    pub(crate) offset: usize,
    pub(crate) ctx: NewWriterWrap<C>,
}

impl<C: WriterContext> Packet<C> {
    pub fn end(&mut self) -> Result<(), AnyMySQLError> {
        const MAX: usize = PacketHeader::MAX_PAYLOAD_LENGTH;
        let new_offset = self.ctx.wrapped.offset();
        // fix position for packet header
        let length = new_offset - self.offset - PacketHeader::SIZE;
        // A payload of MAX bytes or more continues in further packets; the last
        // one is shorter than MAX, empty if need be.
        let extra_packets = length / MAX;
        for _ in 0..extra_packets {
            if let Err(err) = self.ctx.write(&[0u8; PacketHeader::SIZE]) {
                self.ctx.wrapped.truncate(self.offset);
                return Err(err);
            }
        }
        for index in (0..=extra_packets).rev() {
            let chunk = index * MAX..length.min((index + 1) * MAX);
            let header = PacketHeader {
                length: chunk.len() as u32,
                sequence_id: self.sequence_id.wrapping_add(index as u8),
            };
            let header_offset = self.offset + index * (PacketHeader::SIZE + MAX);
            if index > 0 {
                let payload = self.offset + PacketHeader::SIZE;
                self.ctx.wrapped.copy_within(
                    payload + chunk.start..payload + chunk.end,
                    header_offset + PacketHeader::SIZE,
                );
            }
            bun_core::scoped_log!(NewWriter, "writing packet header: {}", header.length);
            self.ctx.pwrite(&header.encode(), header_offset)?;
        }
        Ok(())
    }
}

impl<C: WriterContext> NewWriterWrap<C> {
    #[inline]
    pub(crate) fn write_length_encoded_int(self, data: u64) -> Result<(), AnyMySQLError> {
        self.wrapped.write(encode_length_int(data).slice())
    }

    #[inline]
    pub fn write_length_encoded_string(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.write_length_encoded_int(data.len() as u64)?;
        self.wrapped.write(data)
    }

    pub fn write(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.wrapped.write(data)
    }

    pub fn start(self, sequence_id: u8) -> Result<Packet<C>, AnyMySQLError> {
        let o = self.wrapped.offset();
        bun_core::scoped_log!(NewWriter, "starting packet: {}", o);
        self.write(&[0u8; PacketHeader::SIZE])?;
        Ok(Packet {
            sequence_id,
            offset: o,
            ctx: self,
        })
    }

    pub(crate) fn pwrite(self, data: &[u8], i: usize) -> Result<(), AnyMySQLError> {
        self.wrapped.pwrite(data, i)
    }

    pub(crate) fn int4(self, value: MySQLInt32) -> Result<(), AnyMySQLError> {
        self.write(&value.to_ne_bytes())
    }

    pub(crate) fn int1(self, value: u8) -> Result<(), AnyMySQLError> {
        self.write(&[value])
    }

    pub(crate) fn write_z(self, value: &[u8]) -> Result<(), AnyMySQLError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }
}

/// Callers that already hold a `NewWriterWrap<C>` should use it directly; this
/// alias covers the wrapping case.
// TODO(refactor): ensure no caller double-wraps; if needed, model via a
// `MySQLWriter` trait with a blanket impl for `NewWriterWrap<C>`.
pub type NewWriter<C> = NewWriterWrap<C>;
