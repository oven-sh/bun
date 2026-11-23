#[derive(Copy, Clone)]
pub(crate) struct PacketHeader {
    pub(crate) length: u32,
    pub(crate) sequence_id: u8,
}

impl PacketHeader {
    pub(crate) const SIZE: usize = 4;

    /// The header's length field is 24 bits. A single packet's payload must be
    /// strictly smaller than this; a length of exactly 0xFFFFFF signals a
    /// multi-packet continuation.
    pub(crate) const MAX_PAYLOAD_LENGTH: usize = 0xFF_FF_FF;

    /// With the bytes behind it.
    pub(crate) fn decode(bytes: &[u8]) -> Option<(PacketHeader, &[u8])> {
        let (&[a, b, c, sequence_id], rest) = bytes.split_first_chunk()?;
        let header = PacketHeader {
            length: u32::from_le_bytes([a, b, c, 0]),
            sequence_id,
        };
        Some((header, rest))
    }

    pub(crate) fn encode(self) -> [u8; 4] {
        [
            u8::try_from(self.length & 0xff).expect("int cast"),
            u8::try_from((self.length >> 8) & 0xff).expect("int cast"),
            u8::try_from((self.length >> 16) & 0xff).expect("int cast"),
            self.sequence_id,
        ]
    }
}
