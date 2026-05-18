#[derive(Copy, Clone)]
pub struct PacketHeader {
    // TODO(port): Zig used u24; Rust has no u24, using u32 (value is always < 2^24)
    pub length: u32,
    pub sequence_id: u8,
}

impl PacketHeader {
    pub const SIZE: usize = 4;

    pub fn decode(bytes: &[u8]) -> Option<PacketHeader> {
        if bytes.len() < 4 {
            return None;
        }

        Some(PacketHeader {
            length: (bytes[0] as u32) | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16),
            sequence_id: bytes[3],
        })
    }

    pub fn encode(self) -> [u8; 4] {
        [
            u8::try_from(self.length & 0xff).expect("int cast"),
            u8::try_from((self.length >> 8) & 0xff).expect("int cast"),
            u8::try_from((self.length >> 16) & 0xff).expect("int cast"),
            self.sequence_id,
        ]
    }
}

// ported from: src/sql/mysql/protocol/PacketHeader.zig
