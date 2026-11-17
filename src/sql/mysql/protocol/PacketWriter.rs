use super::encode_int::encode_length_int;
use super::packet_header::PacketHeader;
use crate::mysql::mysql_types::MySQLInt32;

/// Appends one packet to a buffer. It has no header until `end`.
#[must_use]
pub struct PacketWriter<'a> {
    buffer: &'a mut Vec<u8>,
    start: usize,
    sequence_id: u8,
}

impl<'a> PacketWriter<'a> {
    pub(crate) fn start(buffer: &'a mut Vec<u8>, sequence_id: u8) -> Self {
        let start = buffer.len();
        buffer.extend_from_slice(&[0; PacketHeader::SIZE]);
        Self {
            buffer,
            start,
            sequence_id,
        }
    }

    /// A payload of `MAX` bytes or more goes on in further packets, the last one shorter, empty if need be.
    pub(crate) fn end(self) {
        const MAX: usize = PacketHeader::MAX_PAYLOAD_LENGTH;
        let payload = self.start + PacketHeader::SIZE;
        let length = self.buffer.len() - payload;
        let extra_packets = length / MAX;
        self.buffer
            .resize(self.buffer.len() + extra_packets * PacketHeader::SIZE, 0);
        for index in (0..=extra_packets).rev() {
            let chunk = index * MAX..length.min((index + 1) * MAX);
            let header = PacketHeader {
                length: chunk.len() as u32,
                sequence_id: self.sequence_id.wrapping_add(index as u8),
            };
            let header_offset = self.start + index * (PacketHeader::SIZE + MAX);
            if index > 0 {
                self.buffer.copy_within(
                    payload + chunk.start..payload + chunk.end,
                    header_offset + PacketHeader::SIZE,
                );
            }
            self.buffer[header_offset..][..PacketHeader::SIZE].copy_from_slice(&header.encode());
        }
    }

    #[inline]
    pub fn write(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    #[inline]
    pub(crate) fn write_length_encoded_int(&mut self, data: u64) {
        self.write(encode_length_int(data).slice());
    }

    #[inline]
    pub fn write_length_encoded_string(&mut self, data: &[u8]) {
        self.write_length_encoded_int(data.len() as u64);
        self.write(data);
    }

    pub(crate) fn int4(&mut self, value: MySQLInt32) {
        self.write(&value.to_le_bytes());
    }

    pub(crate) fn int1(&mut self, value: u8) {
        self.buffer.push(value);
    }

    pub(crate) fn write_z(&mut self, value: &[u8]) {
        self.write(value);
        if value.last() != Some(&0) {
            self.int1(0);
        }
    }
}
