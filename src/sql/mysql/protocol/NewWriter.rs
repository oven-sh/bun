use super::any_mysql_error::Error as AnyMySQLError;
use super::encode_int::encode_length_int;
use super::packet_header::PacketHeader;
use crate::mysql::mysql_types::MySQLInt32;

bun_core::declare_scope!(NewWriter, hidden);

pub struct NewWriter<'a> {
    buffer: &'a mut Vec<u8>,
}

pub struct Packet {
    pub(crate) sequence_id: u8,
    pub(crate) offset: usize,
}

impl Packet {
    pub fn end(self, writer: &mut NewWriter<'_>) -> Result<(), AnyMySQLError> {
        const MAX: usize = PacketHeader::MAX_PAYLOAD_LENGTH;
        let new_offset = writer.buffer.len();
        // fix position for packet header
        let length = new_offset - self.offset - PacketHeader::SIZE;
        // A payload of MAX bytes or more continues in further packets; the last
        // one is shorter than MAX, empty if need be.
        let extra_packets = length / MAX;
        for _ in 0..extra_packets {
            writer.write(&[0u8; PacketHeader::SIZE])?;
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
                writer.buffer.copy_within(
                    payload + chunk.start..payload + chunk.end,
                    header_offset + PacketHeader::SIZE,
                );
            }
            bun_core::scoped_log!(NewWriter, "writing packet header: {}", header.length);
            writer.pwrite(&header.encode(), header_offset)?;
        }
        Ok(())
    }
}

impl<'a> NewWriter<'a> {
    #[inline]
    pub fn new(buffer: &'a mut Vec<u8>) -> Self {
        Self { buffer }
    }

    #[inline]
    pub(crate) fn write_length_encoded_int(&mut self, data: u64) -> Result<(), AnyMySQLError> {
        self.write(encode_length_int(data).slice())
    }

    #[inline]
    pub fn write_length_encoded_string(&mut self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.write_length_encoded_int(data.len() as u64)?;
        self.write(data)
    }

    #[inline]
    pub fn write(&mut self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.buffer.extend_from_slice(data);
        Ok(())
    }

    #[inline]
    pub fn start(&mut self, sequence_id: u8) -> Result<Packet, AnyMySQLError> {
        let o = self.buffer.len();
        bun_core::scoped_log!(NewWriter, "starting packet: {}", o);
        self.write(&[0u8; PacketHeader::SIZE])?;
        Ok(Packet {
            sequence_id,
            offset: o,
        })
    }

    pub(crate) fn pwrite(&mut self, data: &[u8], i: usize) -> Result<(), AnyMySQLError> {
        self.buffer[i..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    pub(crate) fn int4(&mut self, value: MySQLInt32) -> Result<(), AnyMySQLError> {
        self.write(&value.to_ne_bytes())
    }

    pub(crate) fn int1(&mut self, value: u8) -> Result<(), AnyMySQLError> {
        self.write(&[value])
    }

    pub(crate) fn write_z(&mut self, value: &[u8]) -> Result<(), AnyMySQLError> {
        self.write(value)?;
        if value.is_empty() || value[value.len() - 1] != 0 {
            self.write(&[0u8])?;
        }
        Ok(())
    }
}
