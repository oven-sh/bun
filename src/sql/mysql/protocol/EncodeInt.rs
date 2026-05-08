use bun_collections::BoundedArray;

pub struct DecodedLengthInt {
    pub value: u64,
    pub bytes_read: usize,
}

// Length-encoded integer encoding/decoding
pub fn encode_length_int(value: u64) -> BoundedArray<u8, 9> {
    // BoundedArray's storage is private; build into a stack buffer then copy in.
    let mut buf = [0u8; 9];
    let len: usize = if value < 0xfb {
        buf[0] = u8::try_from(value).expect("int cast");
        1
    } else if value < 0xffff {
        buf[0] = 0xfc;
        buf[1] = u8::try_from(value & 0xff).expect("int cast");
        buf[2] = u8::try_from((value >> 8) & 0xff).expect("int cast");
        3
    } else if value < 0xffffff {
        buf[0] = 0xfd;
        buf[1] = u8::try_from(value & 0xff).expect("int cast");
        buf[2] = u8::try_from((value >> 8) & 0xff).expect("int cast");
        buf[3] = u8::try_from((value >> 16) & 0xff).expect("int cast");
        4
    } else {
        buf[0] = 0xfe;
        buf[1] = u8::try_from(value & 0xff).expect("int cast");
        buf[2] = u8::try_from((value >> 8) & 0xff).expect("int cast");
        buf[3] = u8::try_from((value >> 16) & 0xff).expect("int cast");
        buf[4] = u8::try_from((value >> 24) & 0xff).expect("int cast");
        buf[5] = u8::try_from((value >> 32) & 0xff).expect("int cast");
        buf[6] = u8::try_from((value >> 40) & 0xff).expect("int cast");
        buf[7] = u8::try_from((value >> 48) & 0xff).expect("int cast");
        buf[8] = u8::try_from((value >> 56) & 0xff).expect("int cast");
        9
    };
    BoundedArray::from_slice(&buf[..len]).expect("len <= 9")
}

pub fn decode_length_int(bytes: &[u8]) -> Option<DecodedLengthInt> {
    if bytes.is_empty() {
        return None;
    }

    let first_byte = bytes[0];

    match first_byte {
        0xfc => {
            if bytes.len() < 3 {
                return None;
            }
            Some(DecodedLengthInt {
                value: u64::from(bytes[1]) | (u64::from(bytes[2]) << 8),
                bytes_read: 3,
            })
        }
        0xfd => {
            if bytes.len() < 4 {
                return None;
            }
            Some(DecodedLengthInt {
                value: u64::from(bytes[1])
                    | (u64::from(bytes[2]) << 8)
                    | (u64::from(bytes[3]) << 16),
                bytes_read: 4,
            })
        }
        0xfe => {
            if bytes.len() < 9 {
                return None;
            }
            Some(DecodedLengthInt {
                value: u64::from(bytes[1])
                    | (u64::from(bytes[2]) << 8)
                    | (u64::from(bytes[3]) << 16)
                    | (u64::from(bytes[4]) << 24)
                    | (u64::from(bytes[5]) << 32)
                    | (u64::from(bytes[6]) << 40)
                    | (u64::from(bytes[7]) << 48)
                    | (u64::from(bytes[8]) << 56),
                bytes_read: 9,
            })
        }
        _ => Some(DecodedLengthInt {
            value: u64::from(first_byte.swap_bytes()),
            bytes_read: 1,
        }),
    }
}

// ported from: src/sql/mysql/protocol/EncodeInt.zig
