use bun_collections::BoundedArray;

pub struct DecodedLengthInt {
    pub value: u64,
    pub bytes_read: usize,
}

// Length-encoded integer encoding/decoding
pub fn encode_length_int(value: u64) -> BoundedArray<u8, 9> {
    let mut array: BoundedArray<u8, 9> = BoundedArray::default();
    if value < 0xfb {
        array.len = 1;
        array.buffer[0] = u8::try_from(value).unwrap();
    } else if value < 0xffff {
        array.len = 3;
        array.buffer[0] = 0xfc;
        array.buffer[1] = u8::try_from(value & 0xff).unwrap();
        array.buffer[2] = u8::try_from((value >> 8) & 0xff).unwrap();
    } else if value < 0xffffff {
        array.len = 4;
        array.buffer[0] = 0xfd;
        array.buffer[1] = u8::try_from(value & 0xff).unwrap();
        array.buffer[2] = u8::try_from((value >> 8) & 0xff).unwrap();
        array.buffer[3] = u8::try_from((value >> 16) & 0xff).unwrap();
    } else {
        array.len = 9;
        array.buffer[0] = 0xfe;
        array.buffer[1] = u8::try_from(value & 0xff).unwrap();
        array.buffer[2] = u8::try_from((value >> 8) & 0xff).unwrap();
        array.buffer[3] = u8::try_from((value >> 16) & 0xff).unwrap();
        array.buffer[4] = u8::try_from((value >> 24) & 0xff).unwrap();
        array.buffer[5] = u8::try_from((value >> 32) & 0xff).unwrap();
        array.buffer[6] = u8::try_from((value >> 40) & 0xff).unwrap();
        array.buffer[7] = u8::try_from((value >> 48) & 0xff).unwrap();
        array.buffer[8] = u8::try_from((value >> 56) & 0xff).unwrap();
    }
    array
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/EncodeInt.zig (73 lines)
//   confidence: high
//   todos:      0
//   notes:      BoundedArray field access (.len/.buffer) assumed; anon return struct named DecodedLengthInt; @intCast narrowings mapped to u8::try_from(..).unwrap()
// ──────────────────────────────────────────────────────────────────────────
