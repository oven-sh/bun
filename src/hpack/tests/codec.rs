use std::collections::BTreeMap;
use std::sync::LazyLock;

use bun_hpack::{Decoder, Encoder, Error, Indexing, MAX_FIELD_LEN};
use bun_wyhash::Wyhash;

/// RFC 7541 Appendix B.
#[rustfmt::skip]
const CODES: [(u32, u32); 257] = [
    (0x1ff8, 13), (0x7fffd8, 23), (0xfffffe2, 28), (0xfffffe3, 28), (0xfffffe4, 28), (0xfffffe5, 28),
    (0xfffffe6, 28), (0xfffffe7, 28), (0xfffffe8, 28), (0xffffea, 24), (0x3ffffffc, 30), (0xfffffe9, 28),
    (0xfffffea, 28), (0x3ffffffd, 30), (0xfffffeb, 28), (0xfffffec, 28), (0xfffffed, 28), (0xfffffee, 28),
    (0xfffffef, 28), (0xffffff0, 28), (0xffffff1, 28), (0xffffff2, 28), (0x3ffffffe, 30), (0xffffff3, 28),
    (0xffffff4, 28), (0xffffff5, 28), (0xffffff6, 28), (0xffffff7, 28), (0xffffff8, 28), (0xffffff9, 28),
    (0xffffffa, 28), (0xffffffb, 28), (0x14, 6), (0x3f8, 10), (0x3f9, 10), (0xffa, 12),
    (0x1ff9, 13), (0x15, 6), (0xf8, 8), (0x7fa, 11), (0x3fa, 10), (0x3fb, 10),
    (0xf9, 8), (0x7fb, 11), (0xfa, 8), (0x16, 6), (0x17, 6), (0x18, 6),
    (0x0, 5), (0x1, 5), (0x2, 5), (0x19, 6), (0x1a, 6), (0x1b, 6),
    (0x1c, 6), (0x1d, 6), (0x1e, 6), (0x1f, 6), (0x5c, 7), (0xfb, 8),
    (0x7ffc, 15), (0x20, 6), (0xffb, 12), (0x3fc, 10), (0x1ffa, 13), (0x21, 6),
    (0x5d, 7), (0x5e, 7), (0x5f, 7), (0x60, 7), (0x61, 7), (0x62, 7),
    (0x63, 7), (0x64, 7), (0x65, 7), (0x66, 7), (0x67, 7), (0x68, 7),
    (0x69, 7), (0x6a, 7), (0x6b, 7), (0x6c, 7), (0x6d, 7), (0x6e, 7),
    (0x6f, 7), (0x70, 7), (0x71, 7), (0x72, 7), (0xfc, 8), (0x73, 7),
    (0xfd, 8), (0x1ffb, 13), (0x7fff0, 19), (0x1ffc, 13), (0x3ffc, 14), (0x22, 6),
    (0x7ffd, 15), (0x3, 5), (0x23, 6), (0x4, 5), (0x24, 6), (0x5, 5),
    (0x25, 6), (0x26, 6), (0x27, 6), (0x6, 5), (0x74, 7), (0x75, 7),
    (0x28, 6), (0x29, 6), (0x2a, 6), (0x7, 5), (0x2b, 6), (0x76, 7),
    (0x2c, 6), (0x8, 5), (0x9, 5), (0x2d, 6), (0x77, 7), (0x78, 7),
    (0x79, 7), (0x7a, 7), (0x7b, 7), (0x7ffe, 15), (0x7fc, 11), (0x3ffd, 14),
    (0x1ffd, 13), (0xffffffc, 28), (0xfffe6, 20), (0x3fffd2, 22), (0xfffe7, 20), (0xfffe8, 20),
    (0x3fffd3, 22), (0x3fffd4, 22), (0x3fffd5, 22), (0x7fffd9, 23), (0x3fffd6, 22), (0x7fffda, 23),
    (0x7fffdb, 23), (0x7fffdc, 23), (0x7fffdd, 23), (0x7fffde, 23), (0xffffeb, 24), (0x7fffdf, 23),
    (0xffffec, 24), (0xffffed, 24), (0x3fffd7, 22), (0x7fffe0, 23), (0xffffee, 24), (0x7fffe1, 23),
    (0x7fffe2, 23), (0x7fffe3, 23), (0x7fffe4, 23), (0x1fffdc, 21), (0x3fffd8, 22), (0x7fffe5, 23),
    (0x3fffd9, 22), (0x7fffe6, 23), (0x7fffe7, 23), (0xffffef, 24), (0x3fffda, 22), (0x1fffdd, 21),
    (0xfffe9, 20), (0x3fffdb, 22), (0x3fffdc, 22), (0x7fffe8, 23), (0x7fffe9, 23), (0x1fffde, 21),
    (0x7fffea, 23), (0x3fffdd, 22), (0x3fffde, 22), (0xfffff0, 24), (0x1fffdf, 21), (0x3fffdf, 22),
    (0x7fffeb, 23), (0x7fffec, 23), (0x1fffe0, 21), (0x1fffe1, 21), (0x3fffe0, 22), (0x1fffe2, 21),
    (0x7fffed, 23), (0x3fffe1, 22), (0x7fffee, 23), (0x7fffef, 23), (0xfffea, 20), (0x3fffe2, 22),
    (0x3fffe3, 22), (0x3fffe4, 22), (0x7ffff0, 23), (0x3fffe5, 22), (0x3fffe6, 22), (0x7ffff1, 23),
    (0x3ffffe0, 26), (0x3ffffe1, 26), (0xfffeb, 20), (0x7fff1, 19), (0x3fffe7, 22), (0x7ffff2, 23),
    (0x3fffe8, 22), (0x1ffffec, 25), (0x3ffffe2, 26), (0x3ffffe3, 26), (0x3ffffe4, 26), (0x7ffffde, 27),
    (0x7ffffdf, 27), (0x3ffffe5, 26), (0xfffff1, 24), (0x1ffffed, 25), (0x7fff2, 19), (0x1fffe3, 21),
    (0x3ffffe6, 26), (0x7ffffe0, 27), (0x7ffffe1, 27), (0x3ffffe7, 26), (0x7ffffe2, 27), (0xfffff2, 24),
    (0x1fffe4, 21), (0x1fffe5, 21), (0x3ffffe8, 26), (0x3ffffe9, 26), (0xffffffd, 28), (0x7ffffe3, 27),
    (0x7ffffe4, 27), (0x7ffffe5, 27), (0xfffec, 20), (0xfffff3, 24), (0xfffed, 20), (0x1fffe6, 21),
    (0x3fffe9, 22), (0x1fffe7, 21), (0x1fffe8, 21), (0x7ffff3, 23), (0x3fffea, 22), (0x3fffeb, 22),
    (0x1ffffee, 25), (0x1ffffef, 25), (0xfffff4, 24), (0xfffff5, 24), (0x3ffffea, 26), (0x7ffff4, 23),
    (0x3ffffeb, 26), (0x7ffffe6, 27), (0x3ffffec, 26), (0x3ffffed, 26), (0x7ffffe7, 27), (0x7ffffe8, 27),
    (0x7ffffe9, 27), (0x7ffffea, 27), (0x7ffffeb, 27), (0xffffffe, 28), (0x7ffffec, 27), (0x7ffffed, 27),
    (0x7ffffee, 27), (0x7ffffef, 27), (0x7fffff0, 27), (0x3ffffee, 26), (0x3fffffff, 30),
];

/// By length and code.
static SYMBOLS: LazyLock<BTreeMap<(u32, u32), usize>> = LazyLock::new(|| {
    let codes = CODES.iter().map(|&(code, len)| (len, code));
    codes.zip(0..).collect()
});

/// RFC 7541 Appendix A.
#[rustfmt::skip]
const STATIC_TABLE: [(&str, &str); 61] = [
    (":authority", ""), (":method", "GET"), (":method", "POST"), (":path", "/"),
    (":path", "/index.html"), (":scheme", "http"), (":scheme", "https"), (":status", "200"),
    (":status", "204"), (":status", "206"), (":status", "304"), (":status", "400"),
    (":status", "404"), (":status", "500"), ("accept-charset", ""),
    ("accept-encoding", "gzip, deflate"), ("accept-language", ""), ("accept-ranges", ""),
    ("accept", ""), ("access-control-allow-origin", ""), ("age", ""), ("allow", ""),
    ("authorization", ""), ("cache-control", ""), ("content-disposition", ""),
    ("content-encoding", ""), ("content-language", ""), ("content-length", ""),
    ("content-location", ""), ("content-range", ""), ("content-type", ""), ("cookie", ""),
    ("date", ""), ("etag", ""), ("expect", ""), ("expires", ""), ("from", ""), ("host", ""),
    ("if-match", ""), ("if-modified-since", ""), ("if-none-match", ""), ("if-range", ""),
    ("if-unmodified-since", ""), ("last-modified", ""), ("link", ""), ("location", ""),
    ("max-forwards", ""), ("proxy-authenticate", ""), ("proxy-authorization", ""), ("range", ""),
    ("referer", ""), ("refresh", ""), ("retry-after", ""), ("server", ""), ("set-cookie", ""),
    ("strict-transport-security", ""), ("transfer-encoding", ""), ("user-agent", ""), ("vary", ""),
    ("via", ""), ("www-authenticate", ""),
];

fn static_table() -> impl Iterator<Item = (&'static [u8], &'static [u8])> {
    let entries = STATIC_TABLE.iter();
    entries.map(|(name, value)| (name.as_bytes(), value.as_bytes()))
}

fn hex(text: &str) -> Vec<u8> {
    let digits: Vec<u8> = text
        .chars()
        .filter_map(|digit| Some(digit.to_digit(16)? as u8))
        .collect();
    digits
        .chunks(2)
        .map(|pair| pair[0] << 4 | pair[1])
        .collect()
}

fn integer(pattern: u8, prefix_bits: u32, value: usize) -> Vec<u8> {
    let full = (1 << prefix_bits) - 1;
    if value < full {
        return vec![pattern | value as u8];
    }
    let (mut bytes, mut rest) = (vec![pattern | full as u8], value - full);
    while rest >= 128 {
        bytes.push(rest as u8 | 128);
        rest /= 128;
    }
    bytes.push(rest as u8);
    bytes
}

fn raw(text: &[u8]) -> Vec<u8> {
    [&integer(0x00, 7, text.len()), text].concat()
}

fn with_huffman_prefix(encoded: &[u8]) -> Vec<u8> {
    [&integer(0x80, 7, encoded.len()), encoded].concat()
}

fn huffman_encode(text: &[u8]) -> Vec<u8> {
    let mut bits: Vec<u8> = text
        .iter()
        .map(|&symbol| CODES[usize::from(symbol)])
        .flat_map(|(code, len)| (0..len).rev().map(move |at| (code >> at & 1) as u8))
        .collect();
    bits.resize(bits.len().next_multiple_of(8), 1);
    bits.chunks(8)
        .map(|byte| byte.iter().fold(0, |byte, bit| byte << 1 | bit))
        .collect()
}

fn huffman_decode(encoded: &[u8]) -> Option<Vec<u8>> {
    let (mut text, mut code, mut len) = (vec![], 0, 0);
    for bit in encoded
        .iter()
        .flat_map(|byte| (0..8).rev().map(move |at| byte >> at & 1))
    {
        (code, len) = (code << 1 | u32::from(bit), len + 1);
        if let Some(&symbol) = SYMBOLS.get(&(len, code)) {
            text.push(u8::try_from(symbol).ok()?);
            (code, len) = (0, 0);
        }
    }
    (len < 8 && code == (1 << len) - 1).then_some(text)
}

/// The shorter form, which is what the encoder picks.
fn literal(text: &[u8]) -> Vec<u8> {
    match huffman_encode(text) {
        encoded if (1..=text.len()).contains(&encoded.len()) => with_huffman_prefix(&encoded),
        _ => raw(text),
    }
}

#[derive(Clone, PartialEq, Eq)]
struct Field {
    name: Vec<u8>,
    value: Vec<u8>,
    never_index: bool,
}

impl std::fmt::Debug for Field {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mark = if self.never_index { "!" } else { "" };
        let (name, value) = (self.name.escape_ascii(), self.value.escape_ascii());
        write!(f, "{mark}{name}={value}")
    }
}

fn field(name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) -> Field {
    Field {
        name: name.as_ref().to_vec(),
        value: value.as_ref().to_vec(),
        never_index: false,
    }
}

fn decode(decoder: &mut Decoder, block: &[u8]) -> Result<Vec<Field>, Error> {
    let (mut scratch, mut all) = (vec![], vec![]);
    let mut fields = decoder.decode(block, &mut scratch);
    while let Some(next) = fields.next()? {
        assert!(!next.name.is_empty());
        if let Some(position) = usize::from(next.static_index).checked_sub(1) {
            assert_eq!(static_table().nth(position).unwrap().0, next.name);
            assert_eq!(bun_hpack::static_name(next.static_index), next.name);
        }
        all.push(Field {
            never_index: next.never_index,
            ..field(next.name, next.value)
        });
    }
    Ok(all)
}

/// `[a=b, !never=indexed]` or `Malformed`
fn show(decoder: &mut Decoder, block: &str) -> String {
    match decode(decoder, &hex(block)) {
        Ok(fields) => format!("{fields:?}"),
        Err(error) => format!("{error:?}"),
    }
}

fn show_fresh(block: &str) -> String {
    show(&mut Decoder::new(), block)
}

fn decoder_with_table_size(size: u32) -> Decoder {
    let mut decoder = Decoder::new();
    decoder.set_max_table_size(size);
    decoder
}

/// From the newest entry on.
fn dynamic_table(decoder: &mut Decoder) -> Vec<Field> {
    (62..)
        .map_while(|index| decode(decoder, &integer(0x80, 7, index)).ok()?.pop())
        .collect()
}

fn encode_as(
    encoder: &mut Encoder,
    name: impl AsRef<[u8]>,
    value: impl AsRef<[u8]>,
    indexing: Indexing,
) -> Vec<u8> {
    let mut out = vec![];
    let mut block = encoder.block(&mut out);
    block.field(name.as_ref(), value.as_ref(), indexing);
    out
}

fn encode(encoder: &mut Encoder, name: impl AsRef<[u8]>, value: impl AsRef<[u8]>) -> Vec<u8> {
    encode_as(encoder, name, value, Indexing::Allowed)
}

fn empty_block(encoder: &mut Encoder) -> Vec<u8> {
    let mut out = vec![];
    encoder.block(&mut out);
    out
}

struct Random(u64);

impl Random {
    fn below(&mut self, end: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 16) as usize % end
    }

    fn pick<T: Copy>(&mut self, from: &[T]) -> T {
        from[self.below(from.len())]
    }

    fn text(&mut self, max_len: usize) -> Vec<u8> {
        let (first, count) = self.pick(&[(b'a', 26), (b'0', 3), (b' ', 95), (0, 256)]);
        let len = self.below(max_len + 1);
        (0..len).map(|_| first + self.below(count) as u8).collect()
    }
}

/// RFC 7541, written for plainness.
struct Model {
    table: Vec<Field>,
    max_size: usize,
    size_limit: usize,
}

impl Model {
    fn new() -> Self {
        Self {
            table: vec![],
            max_size: 4096,
            size_limit: 4096,
        }
    }

    fn set_max_table_size(&mut self, size: usize) {
        (self.max_size, self.size_limit) = (size, size);
        self.evict();
    }

    fn evict(&mut self) {
        let mut size = 0;
        self.table.retain(|entry| {
            size += entry.name.len() + entry.value.len() + 32;
            size <= self.max_size
        });
    }

    fn entry(&self, index: usize) -> Option<Field> {
        static_table()
            .map(|(name, value)| field(name, value))
            .chain(self.table.iter().cloned())
            .nth(index.checked_sub(1)?)
    }

    fn integer(block: &mut &[u8], prefix_bits: u32) -> Option<usize> {
        let full = (1 << prefix_bits) - 1;
        let prefix = usize::from(*block.split_off_first()?) & full;
        if prefix < full {
            return Some(prefix);
        }
        let last = block.iter().take(5).position(|&byte| byte < 128)?;
        let digits = block.split_off(..=last)?.iter().rev();
        Some(full + digits.fold(0, |value, &byte| value * 128 + usize::from(byte % 128)))
    }

    fn string(block: &mut &[u8]) -> Option<Vec<u8>> {
        let is_huffman = *block.first()? >= 128;
        let len = Self::integer(block, 7)?;
        let bytes = block.split_off(..len)?;
        if is_huffman {
            huffman_decode(bytes)
        } else {
            Some(bytes.to_vec())
        }
    }

    fn decode(&mut self, mut block: &[u8]) -> Option<Vec<Field>> {
        let mut fields = vec![];
        while let Some(&first) = block.first() {
            if first >= 0x80 {
                fields.push(self.entry(Self::integer(&mut block, 7)?)?);
            } else if (0x20..0x40).contains(&first) {
                let size = Self::integer(&mut block, 5)?;
                (fields.is_empty() && size <= self.size_limit).then_some(())?;
                self.max_size = size;
                self.evict();
            } else {
                let prefix_bits = if first >= 0x40 { 6 } else { 4 };
                let name = match Self::integer(&mut block, prefix_bits)? {
                    0 => Self::string(&mut block).filter(|name| !name.is_empty())?,
                    index => self.entry(index)?.name,
                };
                let next = field(name, Self::string(&mut block)?);
                if first >= 0x40 {
                    self.table.insert(0, next.clone());
                    self.evict();
                }
                fields.push(Field {
                    never_index: (0x10..0x20).contains(&first),
                    ..next
                });
            }
        }
        Some(fields)
    }
}

mod appendix_c {
    use super::*;

    type Fields = &'static [(&'static str, &'static str)];

    const REQUESTS: [Fields; 3] = [
        &[
            (":method", "GET"),
            (":scheme", "http"),
            (":path", "/"),
            (":authority", "www.example.com"),
        ],
        &[
            (":method", "GET"),
            (":scheme", "http"),
            (":path", "/"),
            (":authority", "www.example.com"),
            ("cache-control", "no-cache"),
        ],
        &[
            (":method", "GET"),
            (":scheme", "https"),
            (":path", "/index.html"),
            (":authority", "www.example.com"),
            ("custom-key", "custom-value"),
        ],
    ];

    const RESPONSES: [Fields; 3] = [
        &[
            (":status", "302"),
            ("cache-control", "private"),
            ("date", "Mon, 21 Oct 2013 20:13:21 GMT"),
            ("location", "https://www.example.com"),
        ],
        &[
            (":status", "307"),
            ("cache-control", "private"),
            ("date", "Mon, 21 Oct 2013 20:13:21 GMT"),
            ("location", "https://www.example.com"),
        ],
        &[
            (":status", "200"),
            ("cache-control", "private"),
            ("date", "Mon, 21 Oct 2013 20:13:22 GMT"),
            ("location", "https://www.example.com"),
            ("content-encoding", "gzip"),
            (
                "set-cookie",
                "foo=ASDJKHQKBZXOQWEOPIUAXQWEOIU; max-age=3600; version=1",
            ),
        ],
    ];

    const C_3: [&str; 3] = [
        "8286 8441 0f77 7777 2e65 7861 6d70 6c65 2e63 6f6d",
        "8286 84be 5808 6e6f 2d63 6163 6865",
        "8287 85bf 400a 6375 7374 6f6d 2d6b 6579 0c63 7573 746f 6d2d 7661 6c75 65",
    ];

    const C_4: [&str; 3] = [
        "8286 8441 8cf1 e3c2 e5f2 3a6b a0ab 90f4 ff",
        "8286 84be 5886 a8eb 1064 9cbf",
        "8287 85bf 4088 25a8 49e9 5ba9 7d7f 8925 a849 e95b b8e8 b4bf",
    ];

    const C_5: [&str; 3] = [
        "4803 3330 3258 0770 7269 7661 7465 611d 4d6f 6e2c 2032 3120 4f63 7420 3230 3133
         2032 303a 3133 3a32 3120 474d 546e 1768 7474 7073 3a2f 2f77 7777 2e65 7861 6d70
         6c65 2e63 6f6d",
        "4803 3330 37c1 c0bf",
        "88c1 611d 4d6f 6e2c 2032 3120 4f63 7420 3230 3133 2032 303a 3133 3a32 3220 474d
         54c0 5a04 677a 6970 7738 666f 6f3d 4153 444a 4b48 514b 425a 584f 5157 454f 5049
         5541 5851 5745 4f49 553b 206d 6178 2d61 6765 3d33 3630 303b 2076 6572 7369 6f6e
         3d31",
    ];

    const C_6: [&str; 3] = [
        "4882 6402 5885 aec3 771a 4b61 96d0 7abe 9410 54d4 44a8 2005 9504 0b81 66e0 82a6
         2d1b ff6e 919d 29ad 1718 63c7 8f0b 97c8 e9ae 82ae 43d3",
        "4883 640e ffc1 c0bf",
        "88c1 6196 d07a be94 1054 d444 a820 0595 040b 8166 e084 a62d 1bff c05a 839b d9ab
         77ad 94e7 821d d7f2 e6c7 b335 dfdf cd5b 3960 d5af 2708 7f36 72c1 ab27 0fb5 291f
         9587 3160 65c0 03ed 4ee5 b106 3d50 07",
    ];

    #[test]
    fn single_fields() {
        for (block, fields, table) in [
            (
                "400a 6375 7374 6f6d 2d6b 6579 0d63 7573 746f 6d2d 6865 6164 6572",
                "[custom-key=custom-header]",
                "[custom-key=custom-header]",
            ),
            (
                "040c 2f73 616d 706c 652f 7061 7468",
                "[:path=/sample/path]",
                "[]",
            ),
            (
                "1008 7061 7373 776f 7264 0673 6563 7265 74",
                "[!password=secret]",
                "[]",
            ),
            ("82", "[:method=GET]", "[]"),
        ] {
            let mut decoder = Decoder::new();
            assert_eq!(show(&mut decoder, block), fields);
            assert_eq!(format!("{:?}", dynamic_table(&mut decoder)), table);
        }
    }

    #[test]
    fn decodes() {
        for (table_size, blocks, lists, entries) in [
            (4096, C_3, REQUESTS, [1, 2, 3]),
            (4096, C_4, REQUESTS, [1, 2, 3]),
            (256, C_5, RESPONSES, [4, 4, 3]),
            (256, C_6, RESPONSES, [4, 4, 3]),
        ] {
            let mut decoder = decoder_with_table_size(table_size);
            for ((block, list), entries) in blocks.into_iter().zip(lists).zip(entries) {
                let list = list.iter().map(|(name, value)| field(name, value));
                assert_eq!(decode(&mut decoder, &hex(block)), Ok(list.collect()));
                assert_eq!(dynamic_table(&mut decoder).len(), entries);
            }
        }
    }

    #[test]
    fn encodes() {
        for (table_size, update, blocks, lists) in [
            (4096, "3fe11f", C_4, REQUESTS),
            (256, "3fe101", C_6, RESPONSES),
        ] {
            let mut encoder = Encoder::new();
            encoder.set_max_table_size(table_size);
            assert_eq!(empty_block(&mut encoder), hex(update));
            for (expected, list) in blocks.into_iter().zip(lists) {
                let mut out = vec![];
                let mut block = encoder.block(&mut out);
                for (name, value) in list {
                    block.field(name.as_bytes(), value.as_bytes(), Indexing::Allowed);
                }
                assert_eq!(out, hex(expected));
            }
        }
    }
}

mod decoder {
    use super::*;

    #[test]
    fn static_entries() {
        for (index, (name, value)) in (1..).zip(static_table()) {
            let mut decoder = Decoder::new();
            for (block, value) in [
                (integer(0x80, 7, index), value),
                ([integer(0x00, 4, index), raw(b"v")].concat(), b"v"),
                ([integer(0x10, 4, index), raw(b"v")].concat(), b"v"),
                ([integer(0x40, 6, index), raw(b"v")].concat(), b"v"),
                (hex("be"), b"v"),
                (hex("0f2f 0177"), b"w"),
            ] {
                let mut scratch = vec![];
                let mut fields = decoder.decode(&block, &mut scratch);
                let next = fields.next().unwrap().unwrap();
                assert_eq!(
                    (next.name, next.value, usize::from(next.static_index)),
                    (name, value, index)
                );
                assert!(fields.next().unwrap().is_none());
            }
        }
    }

    #[test]
    fn literal_names_have_no_static_index() {
        let mut decoder = Decoder::new();
        let block = [hex("40"), raw(b"host"), raw(b"a"), hex("be 7e00")].concat();
        let mut scratch = vec![];
        let mut fields = decoder.decode(&block, &mut scratch);
        while let Some(next) = fields.next().unwrap() {
            assert_eq!((next.name, next.static_index), (&b"host"[..], 0));
        }
    }

    #[test]
    fn representations() {
        for (block, expected) in [
            ("", "[]"),
            ("00 0161 0162", "[a=b]"),
            ("10 0161 0162", "[!a=b]"),
            ("40 0161 0162 be", "[a=b, a=b]"),
            ("40 0161 0162 0f2f 0163 be", "[a=b, a=c, a=b]"),
            ("40 0161 0162 1f2f 0163 be", "[a=b, !a=c, a=b]"),
            ("40 0161 0162 7e 0163 be bf", "[a=b, a=c, a=c, a=b]"),
            ("00 0161 00", "[a=]"),
            ("00 0161 80", "[a=]"),
            ("00 811f 818f", "[a=b]"),
            ("00 02 4109 02 2000", "[A\\t= \\x00]"),
            ("00 0161 0162 be", "Malformed"),
            ("10 0161 0162 be", "Malformed"),
            ("80", "Malformed"),
            ("80 0161 0162", "Malformed"),
            ("be", "Malformed"),
            ("40 0161 0162 bf", "Malformed"),
            ("7e 0161", "Malformed"),
            ("0f2f 0161", "Malformed"),
            ("00 00 0161", "Malformed"),
            ("40 80 0161", "Malformed"),
            ("00 8100 0161", "Malformed"),
        ] {
            assert_eq!(show_fresh(block), expected, "{block}");
        }
    }

    #[test]
    fn truncated_fields() {
        let (name, value) = ([b'n'; 200], [b'v'; 200]);
        for whole in [
            [hex("00"), raw(&name), raw(&value)].concat(),
            [hex("10"), literal(&name), literal(&value)].concat(),
            [hex("40"), raw(b"a"), raw(b"")].concat(),
            [hex("41"), raw(b"")].concat(),
            [hex("0f00"), raw(b"")].concat(),
            [hex("1f10"), literal(&value)].concat(),
        ] {
            assert!(decode(&mut Decoder::new(), &whole).is_ok());
            for len in 1..whole.len() {
                let mut decoder = Decoder::new();
                assert_eq!(decode(&mut decoder, &whole[..len]), Err(Error::Malformed));
                assert_eq!(dynamic_table(&mut decoder), []);
            }
        }
    }

    #[test]
    fn integers() {
        for (block, expected) in [
            ("0f 80 00 00", "[accept-charset=]"),
            ("0f 81 80 80 80 00 00", "[accept-encoding=]"),
            ("0f 80 80 80 80 80 00 00", "Malformed"),
            ("0f", "Malformed"),
            ("1f 80", "Malformed"),
            ("3f", "Malformed"),
            ("7f", "Malformed"),
            ("ff", "Malformed"),
            ("ff 80", "Malformed"),
            ("ff 00", "Malformed"),
            ("ff ff ff ff ff 7f", "Malformed"),
            ("ff ff ff ff ff ff ff ff ff ff ff 01", "Malformed"),
            ("ff 83 ff ff ff 0f", "Malformed"),
            ("0f f3 ff ff ff 0f 00", "Malformed"),
            ("00 7f 82 ff ff ff 0f 61 00", "Malformed"),
            ("00 0161 7f 82 ff ff ff 0f 61", "Malformed"),
            ("00 0161 ff ff ff ff ff 7f", "Malformed"),
            ("3f e1 ff ff ff 0f 82", "Malformed"),
        ] {
            assert_eq!(show_fresh(block), expected, "{block}");
        }
    }

    #[test]
    fn indexes_and_lengths_of_every_width() {
        let mut decoder = decoder_with_table_size(u32::MAX);
        let count = 17_000;
        for number in 0..count {
            let block = [hex("40"), raw(b"n"), raw(number.to_string().as_bytes())].concat();
            decode(&mut decoder, &block).unwrap();
        }
        for age in 0..count {
            let expected = field("n", (count - 1 - age).to_string());
            let block = integer(0x80, 7, 62 + age);
            assert_eq!(decode(&mut decoder, &block), Ok(vec![expected]));
        }
        let block = integer(0x80, 7, 62 + count);
        assert_eq!(decode(&mut decoder, &block), Err(Error::Malformed));

        for len in [126, 127, 128, 254, 255, 16_510, 16_511] {
            let text = vec![b'~'; len];
            let block = [hex("00"), raw(&text), raw(&text)].concat();
            let expected = vec![field(&text, &text)];
            assert_eq!(decode(&mut Decoder::new(), &block), Ok(expected));
        }
    }

    #[test]
    fn size_updates() {
        for (block, expected, entries) in [
            ("3fe11f be", "[a=b]", 1),
            ("3f03 be", "[a=b]", 1),
            ("3f02 82", "[:method=GET]", 0),
            ("20", "[]", 0),
            ("3fe11f 3fe11f 3fe11f", "[]", 1),
            ("20 3fe11f 82", "[:method=GET]", 0),
            ("20 40 0163 0164", "[c=d]", 0),
            ("20 3f03 40 0163 0164", "[c=d]", 1),
            ("3f03 20 3f03 3fe11f", "[]", 0),
            ("3fe11f 3f03 40 0163 0164", "[c=d]", 1),
            ("3f 80 80 80 80 00", "[]", 0),
            ("3fe21f", "Malformed", 1),
            ("3fe21f 20", "Malformed", 1),
            ("20 3fe21f", "Malformed", 0),
            ("3f", "Malformed", 1),
            ("3f e1", "Malformed", 1),
            ("82 20", "Malformed", 1),
            ("82 20 82", "Malformed", 1),
            ("00 0163 0164 3fe11f 82", "Malformed", 1),
            ("be 7e 0163 3f00 0164", "Malformed", 2),
        ] {
            let mut decoder = Decoder::new();
            assert_eq!(show(&mut decoder, "40 0161 0162"), "[a=b]");
            assert_eq!(show(&mut decoder, block), expected, "{block}");
            assert_eq!(dynamic_table(&mut decoder).len(), entries, "{block}");
        }
    }

    #[test]
    fn setting_limits_size_updates() {
        let mut decoder = Decoder::new();
        show(&mut decoder, "40 0161 0162 40 0163 0164");
        decoder.set_max_table_size(67);
        assert_eq!(dynamic_table(&mut decoder), [field("c", "d")]);
        assert_eq!(show(&mut decoder, "3f24"), "[]");
        assert_eq!(show(&mut decoder, "3f25"), "Malformed");
        decoder.set_max_table_size(u32::MAX);
        assert_eq!(show(&mut decoder, "3fe0ffffff0f be"), "[c=d]");
        assert_eq!(show(&mut decoder, "3fe1ffffff0f"), "Malformed");
        decoder.set_max_table_size(0);
        assert_eq!(show(&mut decoder, "20 40 0161 0162"), "[a=b]");
        assert_eq!(show(&mut decoder, "21"), "Malformed");
        assert_eq!(dynamic_table(&mut decoder), []);
    }

    #[test]
    fn eviction() {
        for (size, block, table) in [
            (68, "40 0161 0162 40 0163 0164", "[c=d, a=b]"),
            (67, "40 0161 0162 40 0163 0164", "[c=d]"),
            (34, "40 0161 0162", "[a=b]"),
            (33, "40 0161 0162", "[]"),
            (34, "40 0161 0162 40 0161 026262", "[]"),
            (34, "40 0161 0162 7e 0163", "[a=c]"),
            (34, "40 0161 0162 7e 026363", "[]"),
            (34, "40 0161 0162 00 0161 026262", "[a=b]"),
            (35, "55 00", "[age=]"),
            (34, "55 00", "[]"),
            (70, "55 00 55 00 7e 00", "[age=, age=]"),
            (102, "40 0161 0162 be be be 40 0163 0164", "[c=d, a=b]"),
        ] {
            let mut decoder = decoder_with_table_size(size);
            assert!(decode(&mut decoder, &hex(block)).is_ok());
            assert_eq!(format!("{:?}", dynamic_table(&mut decoder)), table);
        }
    }

    #[test]
    fn longest_field() {
        assert_eq!(MAX_FIELD_LEN, 65_536);
        for string in [raw, literal] {
            for (first, name) in [(0x00, &b"a"[..]), (0x40, &[b'n'; 40_000])] {
                let block = |len: usize| {
                    let value = vec![b'0'; len - name.len()];
                    [vec![first], string(name), string(&value)].concat()
                };
                let fields = decode(&mut Decoder::new(), &block(MAX_FIELD_LEN)).unwrap();
                assert_eq!(fields[0].name.len() + fields[0].value.len(), MAX_FIELD_LEN);
                for excess in [1, 7, 8, 9, 100, 200_000] {
                    let result = decode(&mut Decoder::new(), &block(MAX_FIELD_LEN + excess));
                    assert_eq!(result, Err(Error::FieldTooLong));
                }
            }
            let block = |len: usize| [hex("55"), string(&vec![b'0'; len - 3])].concat();
            assert!(decode(&mut Decoder::new(), &block(MAX_FIELD_LEN)).is_ok());
            let result = decode(&mut Decoder::new(), &block(MAX_FIELD_LEN + 1));
            assert_eq!(result, Err(Error::FieldTooLong));

            for len in [MAX_FIELD_LEN + 1, 200_000] {
                let block = [hex("00"), string(&vec![b'0'; len]), raw(b"")].concat();
                let result = decode(&mut Decoder::new(), &block);
                assert_eq!(result, Err(Error::FieldTooLong));
            }
        }
    }

    #[test]
    fn longest_field_of_long_codes() {
        let block = |len: usize| {
            let value = huffman_encode(&vec![0xc3; len - 1]);
            [hex("00 0161"), with_huffman_prefix(&value)].concat()
        };
        assert!(decode(&mut Decoder::new(), &block(MAX_FIELD_LEN)).is_ok());
        for excess in [1, 200_000] {
            let result = decode(&mut Decoder::new(), &block(MAX_FIELD_LEN + excess));
            assert_eq!(result, Err(Error::FieldTooLong));
        }
    }

    #[test]
    fn longest_field_with_the_name_of_an_entry() {
        let mut decoder = decoder_with_table_size(100_000);
        let block = [hex("40"), raw(&[b'n'; MAX_FIELD_LEN - 1]), raw(b"")].concat();
        decode(&mut decoder, &block).unwrap();
        for first in ["7e", "0f2f", "1f2f"] {
            let block = |value: &[u8]| [hex(first), raw(value)].concat();
            assert!(decode(&mut decoder, &block(b"v")).is_ok());
            let result = decode(&mut decoder, &block(b"vv"));
            assert_eq!(result, Err(Error::FieldTooLong));
        }
    }

    #[test]
    fn entries_outlast_a_long_field() {
        let mut decoder = Decoder::new();
        show(&mut decoder, "40 0161 0162 40 0163 0164 41 0165");
        let table = dynamic_table(&mut decoder);
        let block = [hex("0f30"), raw(&[b'v'; 60_000]), hex("be")].concat();
        let expected = vec![field("c", [b'v'; 60_000]), field(":authority", "e")];
        assert_eq!(decode(&mut decoder, &block), Ok(expected));
        assert_eq!(dynamic_table(&mut decoder), table);
        assert_eq!(show(&mut decoder, "7f01 0166 be"), "[a=f, a=f]");
    }

    #[test]
    fn allowed_size_takes_an_update() {
        let mut decoder = Decoder::new();
        assert_eq!(show(&mut decoder, "20"), "[]");
        decoder.allow_table_size(8192);
        decoder.allow_table_size(100);
        assert_eq!(show(&mut decoder, "40 0161 0162 be"), "Malformed");
        assert_eq!(show(&mut decoder, "3fe23f"), "Malformed");
        assert_eq!(show(&mut decoder, "3fe13f 40 0161 0162 be"), "[a=b, a=b]");
    }

    #[test]
    fn scratch_is_for_compressed_strings() {
        let compressed = |len| with_huffman_prefix(&vec![0; len]);
        for (block, len) in [
            ([hex("40"), raw(b"a"), raw(&[0; 1000])].concat(), 0),
            ([hex("41"), raw(&[0; 1000])].concat(), 0),
            ([hex("01"), compressed(0)].concat(), 256),
            ([hex("01"), compressed(155)].concat(), 256),
            ([hex("01"), compressed(160)].concat(), 264),
            ([hex("00"), compressed(160), raw(b"")].concat(), 264),
            ([hex("00"), compressed(160), compressed(5)].concat(), 280),
            ([hex("01"), compressed(200_000)].concat(), 65_544),
        ] {
            let mut scratch = vec![];
            let _ = Decoder::new().decode(&block, &mut scratch).next();
            assert_eq!(scratch.len(), len);

            let mut scratch = vec![0xff; 65_544];
            let before = scratch.as_ptr();
            let _ = Decoder::new().decode(&block, &mut scratch).next();
            assert_eq!(scratch.as_ptr(), before);
        }

        let mut scratch = vec![];
        for (len, expected) in [
            (200, 328),
            (201, 656),
            (900, 1448),
            (30_000, 48_008),
            (30_001, 65_544),
        ] {
            let block = [hex("01"), compressed(len)].concat();
            let _ = Decoder::new().decode(&block, &mut scratch).next();
            assert_eq!(scratch.len(), expected);
        }
    }

    #[test]
    fn scratch_with_spare_capacity() {
        let block = [hex("01"), literal(&[b'0'; 300])].concat();
        let (mut decoder, mut scratch) = (Decoder::new(), Vec::with_capacity(1000));
        let mut fields = decoder.decode(&block, &mut scratch);
        assert_eq!(fields.next().unwrap().unwrap().value, [b'0'; 300]);
    }

    #[test]
    fn names_of_entries_on_their_way_out() {
        let mut random = Random(2);
        for (size, max_len) in [
            (200, 60),
            (1000, 200),
            (4096, 300),
            (4096, 1500),
            (9000, 4000),
            (20_000, 12_000),
        ] {
            let (mut decoder, mut model) = (decoder_with_table_size(size), Model::new());
            model.set_max_table_size(size as usize);
            for _ in 0..1500 {
                let name = match (model.table.len(), random.below(4)) {
                    (0, _) | (_, 0) => {
                        [hex("40"), raw(&[&b"x"[..], &random.text(max_len)].concat())].concat()
                    }
                    (len, 1) => integer(0x40, 6, 62 + random.below(len)),
                    (len, _) => integer(0x40, 6, 61 + len),
                };
                let block = [name, raw(&random.text(max_len))].concat();
                assert_eq!(decode(&mut decoder, &block).ok(), model.decode(&block));
                assert_eq!(dynamic_table(&mut decoder), model.table);
            }
        }
    }

    fn random_string(random: &mut Random) -> Vec<u8> {
        let max_len = match random.below(100) {
            0 => 30_000,
            _ => random.pick(&[1, 8, 30, 30, 300]),
        };
        let text = random.text(max_len);
        if random.below(2) == 0 {
            raw(&text)
        } else {
            with_huffman_prefix(&huffman_encode(&text))
        }
    }

    #[test]
    fn agrees_with_the_model() {
        let mut random = Random(1);
        for _ in 0..400 {
            let (mut decoder, mut model) = (Decoder::new(), Model::new());
            for _ in 0..50 {
                if random.below(20) == 0 {
                    let size = random.pick(&[0, 40, 200, 1000, 4096, 10_000, 100_000]);
                    decoder.set_max_table_size(size as u32);
                    model.set_max_table_size(size);
                }
                let mut block = vec![];
                if random.below(10) == 0 {
                    block.extend(integer(0x20, 5, random.below(model.size_limit + 1)));
                }
                for _ in 0..random.below(8) {
                    let index = 1 + random.below(61 + model.table.len() / 2);
                    let (pattern, prefix_bits) =
                        random.pick(&[(0x80, 7), (0x40, 6), (0x40, 6), (0x10, 4), (0x00, 4)]);
                    if pattern != 0x80 && random.below(3) == 0 {
                        block.push(pattern);
                        block.extend(random_string(&mut random));
                    } else {
                        block.extend(integer(pattern, prefix_bits, index));
                    }
                    if pattern != 0x80 {
                        block.extend(random_string(&mut random));
                    }
                }
                if !block.is_empty() && random.below(30) == 0 {
                    let at = random.below(block.len());
                    block[at] ^= 1 << random.below(8);
                }
                let expected = model.decode(&block).ok_or(Error::Malformed);
                assert_eq!(decode(&mut decoder, &block), expected, "{block:02x?}");
                assert_eq!(dynamic_table(&mut decoder), model.table);
            }
        }
    }
}

mod huffman {
    use super::*;

    #[track_caller]
    fn check(encoded: &[u8]) {
        let string = with_huffman_prefix(encoded);
        let expected = huffman_decode(encoded);
        let block = [&hex("00 0178"), &string[..]].concat();
        let as_value = expected.as_ref().map(|text| vec![field("x", text)]);
        assert_eq!(
            decode(&mut Decoder::new(), &block),
            as_value.ok_or(Error::Malformed),
            "{encoded:02x?}"
        );
        let block = [&hex("82 00 04ffff0000"), &string[..], &hex("82")].concat();
        let get = || field(":method", "GET");
        let inside = expected.map(|text| vec![get(), field([0xff, 0xff, 0, 0], text), get()]);
        assert_eq!(
            decode(&mut Decoder::new(), &block),
            inside.ok_or(Error::Malformed),
            "{encoded:02x?}"
        );
    }

    #[test]
    fn every_short_string() {
        check(&[]);
        for first in 0..=255 {
            check(&[first]);
        }
        for bytes in 0..=u16::MAX {
            check(&bytes.to_be_bytes());
        }
    }

    #[test]
    fn every_symbol_at_every_position() {
        for symbol in 0..=255 {
            for before in 0..24 {
                for after in [0, 1, 20] {
                    let text = [vec![b'0'; before], vec![symbol], vec![b'a'; after]].concat();
                    check(&huffman_encode(&text));
                    let expected = [hex("00 0158"), literal(&text)].concat();
                    let actual = encode_as(&mut Encoder::new(), "X", &text, Indexing::Without);
                    assert_eq!(actual[3..], expected[3..]);
                }
            }
        }
    }

    #[test]
    fn every_pair_of_symbols() {
        for pair in 0..=u16::MAX {
            let text = [&pair.to_be_bytes()[..], &[b'0'; 12]].concat();
            let block = encode_as(&mut Encoder::new(), ":path", &text, Indexing::Without);
            assert_eq!(block, [hex("04"), literal(&text)].concat());
            let expected = vec![field(":path", &text)];
            assert_eq!(decode(&mut Decoder::new(), &block), Ok(expected));
        }
    }

    #[test]
    fn endings() {
        let mut random = Random(2);
        for _ in 0..3000 {
            let encoded = huffman_encode(&random.text(40));
            for ending in [
                "",
                "00",
                "fe",
                "ff",
                "ffff",
                "fffffffc",
                "ffffffff",
                "ffffffff1f",
            ] {
                check(&[&encoded[..], &hex(ending)].concat());
            }
            for len in encoded.len().saturating_sub(4)..encoded.len() {
                check(&encoded[..len]);
            }
            if let Some((last, rest)) = encoded.split_last() {
                for bit in 0..8 {
                    check(&[rest, &[last ^ 1 << bit]].concat());
                }
            }
        }
    }

    #[test]
    fn end_of_string_symbol_within_a_string() {
        for before in 0..24 {
            let mut encoded = huffman_encode(&vec![b'0'; before]);
            encoded.extend([0xff; 4]);
            encoded.extend([0; 20]);
            assert_eq!(huffman_decode(&encoded), None);
            check(&encoded);
        }
    }

    #[test]
    fn full_lookups_after_the_longest_code() {
        for before in 0..16 {
            let text = [&vec![b'#'; before][..], b"\n##dddddddddddddddd"].concat();
            check(&huffman_encode(&text));
        }
    }

    #[test]
    fn densest_strings() {
        for len in 0..1200 {
            check(&huffman_encode(&vec![b'0'; len]));
            check(&vec![0; len]);
        }
    }

    #[test]
    fn random_strings() {
        let mut random = Random(3);
        for _ in 0..20_000 {
            let len = random.below(24);
            let or = random.pick(&[0x00, 0x00, 0xf0, 0xfc]);
            let bytes: Vec<u8> = (0..len).map(|_| random.below(256) as u8 | or).collect();
            check(&bytes);
        }
    }
}

mod encoder {
    use super::*;

    #[test]
    fn static_entries() {
        for (index, (name, value)) in (1..).zip(static_table()) {
            let first = 1 + static_table().position(|entry| entry.0 == name).unwrap();
            let mut encoder = Encoder::new();
            assert_eq!(encode(&mut encoder, name, value), integer(0x80, 7, index));
            let block = encode_as(&mut encoder, name, value, Indexing::Without);
            assert_eq!(block, integer(0x80, 7, index));
            let block = encode_as(&mut encoder, name, value, Indexing::Never);
            assert_eq!(block, [integer(0x10, 4, first), literal(value)].concat());
            let block = encode(&mut encoder, name, "~");
            assert_eq!(block, [integer(0x40, 6, first), raw(b"~")].concat());
            assert_eq!(encode(&mut encoder, name, "~"), hex("be"));
        }
    }

    #[test]
    fn names_that_resemble_static_ones() {
        for (name, value) in static_table() {
            let mut similar = vec![
                name[1..].to_vec(),
                name[..name.len() - 1].to_vec(),
                [name, b"\0"].concat(),
                [name, &[b'-'; 256 - 1], &name[name.len() - 1..]].concat(),
                name.to_ascii_uppercase(),
            ];
            for at in 0..name.len() {
                similar.push(name.to_vec());
                similar.last_mut().unwrap()[at] ^= 0x10;
            }
            for name in similar {
                let expected = [hex("40"), literal(&name), literal(value)].concat();
                assert_eq!(encode(&mut Encoder::new(), &name, value), expected);
            }
        }
        for name in ["", "a"] {
            let mut encoder = Encoder::new();
            let expected = [hex("40"), literal(name.as_bytes()), raw(b"")].concat();
            assert_eq!(encode(&mut encoder, name, ""), expected);
            assert_eq!(encode(&mut encoder, name, ""), hex("be"));
            assert_eq!(encode(&mut encoder, name, "~"), hex("7e 017e"));
        }
    }

    #[test]
    fn values_that_resemble_static_ones() {
        for (first, name, value) in [
            ("42", ":method", "get"),
            ("42", ":method", "GE"),
            ("42", ":method", "GETS"),
            ("42", ":method", ""),
            ("42", ":method", "/"),
            ("48", ":status", "201"),
            ("50", "accept-encoding", "gzip,deflate"),
        ] {
            let expected = [hex(first), literal(value.as_bytes())].concat();
            assert_eq!(encode(&mut Encoder::new(), name, value), expected);
        }
    }

    #[test]
    fn indexing() {
        use Indexing::*;
        let mut encoder = Encoder::new();
        for (value, indexing, expected) in [
            ("1", Without, "00 017e 810f"),
            ("1", Never, "10 017e 810f"),
            ("1", Allowed, "40 017e 810f"),
            ("1", Allowed, "be"),
            ("1", Without, "be"),
            ("1", Never, "1f2f 810f"),
            ("2", Without, "0f2f 8117"),
            ("2", Never, "1f2f 8117"),
            ("2", Allowed, "7e 8117"),
            ("1", Allowed, "bf"),
            ("2", Allowed, "be"),
        ] {
            assert_eq!(encode_as(&mut encoder, "~", value, indexing), hex(expected));
        }
    }

    #[test]
    fn name_and_value_are_told_apart() {
        let mut encoder = Encoder::new();
        assert_eq!(encode(&mut encoder, "~~", "~"), hex("40 027e7e 017e"));
        assert_eq!(encode(&mut encoder, "~", "~~"), hex("40 017e 027e7e"));
        assert_eq!(encode(&mut encoder, "age", "~"), hex("55 017e"));
        assert_eq!(encode(&mut encoder, "via", "~"), hex("7c 017e"));
        assert_eq!(encode(&mut encoder, "", "~"), hex("40 00 017e"));
    }

    /// Two texts that the encoder files under the same hash.
    fn with_equal_hashes(seed: u64) -> [String; 2] {
        let mut seen = BTreeMap::new();
        let mut texts = (0..).map(|number| format!("~{number:08}"));
        texts
            .find_map(|text| {
                let hash = Wyhash::hash(seed, text.as_bytes()) as u32;
                Some([seen.insert(hash, text.clone())?, text])
            })
            .unwrap()
    }

    #[test]
    fn equal_hashes_do_not_make_equal_fields() {
        let [first, second] = with_equal_hashes(60);
        let mut encoder = Encoder::new();
        for value in [&first, &second] {
            let expected = [hex("7c"), literal(value.as_bytes())].concat();
            assert_eq!(encode(&mut encoder, "via", value), expected);
        }
        assert_eq!(encode(&mut encoder, "via", first), hex("bf"));
        assert_eq!(encode(&mut encoder, "via", second), hex("be"));

        let [first, second] = with_equal_hashes(0);
        let mut encoder = Encoder::new();
        for name in [&first, &second] {
            let expected = [hex("40"), literal(name.as_bytes()), raw(b"~")].concat();
            assert_eq!(encode(&mut encoder, name, "~"), expected);
        }
        assert_eq!(encode(&mut encoder, &first, "~"), hex("bf"));
        assert_eq!(encode(&mut encoder, &first, "~~"), hex("7f00 027e7e"));
        assert_eq!(encode(&mut encoder, &second, "~~"), hex("7f00 027e7e"));

        let value = "2361700";
        let hash = |index| Wyhash::hash(index, value.as_bytes()) as u32;
        assert_eq!(hash(38), hash(47));
        let mut encoder = Encoder::new();
        assert_eq!(encode(&mut encoder, "host", value)[0], 0x40 | 38);
        assert_eq!(encode(&mut encoder, "max-forwards", value)[0], 0x40 | 47);
    }

    #[test]
    fn appends() {
        let (mut encoder, mut out) = (Encoder::new(), b"before".to_vec());
        encoder.set_max_table_size(0);
        let mut block = encoder.block(&mut out);
        block.field(b"a", b"b", Indexing::Allowed);
        block.field(b"~", b"~", Indexing::Allowed);
        let expected = [&b"before"[..], &hex("20 00 811f 818f 00 017e 017e")].concat();
        assert_eq!(out, expected);
    }

    #[test]
    fn strings_of_every_length() {
        let edges = [16_510, 22_013, 22_016, 26_416, 70_000].map(|len| len - 2..len + 3);
        let lens = (0..400).chain(edges.into_iter().flatten());
        for len in lens {
            for symbol in [b'0', b'/', b'A', b'X', b'!', 0xff] {
                let text = vec![symbol; len];
                let block = encode_as(&mut Encoder::new(), "~", &text, Indexing::Without);
                assert_eq!(block, [hex("00 017e"), literal(&text)].concat());
            }
        }
    }

    #[test]
    fn short_codes_make_up_for_long_ones() {
        for symbol in [b'$', b'{', b'\\', 0xff, b'\n'] {
            for (long, short) in (1..20).flat_map(|long| (0..160).map(move |short| (long, short))) {
                let text = [vec![symbol; long], vec![b'0'; short]].concat();
                let block = encode_as(&mut Encoder::new(), "via", &text, Indexing::Never);
                assert_eq!(block, [hex("1f2d"), literal(&text)].concat());
            }
        }
    }

    #[test]
    fn very_long_string() {
        let text = vec![b'~'; 3 << 20];
        let expected = [hex("00"), raw(&text), raw(&text)].concat();
        assert!(encode(&mut Encoder::new(), &text, &text) == expected);
    }

    #[test]
    fn size_updates() {
        for (sizes, expected) in [
            (&[][..], ""),
            (&[4096], "3fe11f"),
            (&[4097], "3fe11f"),
            (&[u32::MAX], "3fe11f"),
            (&[0], "20"),
            (&[30], "3e"),
            (&[31], "3f00"),
            (&[4095], "3fe01f"),
            (&[100, 100], "3f45"),
            (&[200, 100], "3f45"),
            (&[100, 200], "3f45 3fa901"),
            (&[200, 100, 300, 200], "3f45 3fa901"),
            (&[0, 10], "20 2a"),
            (&[0, 4096], "20 3fe11f"),
            (&[0, 65_536], "20 3fe11f"),
        ] {
            for mut encoder in [Encoder::new(), Encoder::with_history()] {
                for &size in sizes {
                    encoder.set_max_table_size(size);
                }
                assert_eq!(empty_block(&mut encoder), hex(expected), "{sizes:?}");
                assert_eq!(empty_block(&mut encoder), []);
            }
        }
    }

    #[test]
    fn size_update_after_a_raise() {
        let mut encoder = Encoder::new();
        encoder.set_max_table_size(100);
        empty_block(&mut encoder);
        encoder.set_max_table_size(200);
        assert_eq!(empty_block(&mut encoder), hex("3fa901"));
    }

    #[test]
    fn eviction() {
        let mut encoder = Encoder::new();
        encode(&mut encoder, "~", "1");
        encode(&mut encoder, "~", "2");
        encoder.set_max_table_size(67);
        assert_eq!(encode(&mut encoder, "~", "2"), hex("3f24 be"));
        assert_eq!(encode(&mut encoder, "~", "1"), hex("7e 810f"));
        assert_eq!(encode(&mut encoder, "^", "1"), hex("40 015e 810f"));
        assert_eq!(encode(&mut encoder, "~", "1"), hex("40 017e 810f"));
        encoder.set_max_table_size(0);
        encoder.set_max_table_size(4096);
        assert_eq!(
            encode(&mut encoder, "~", "1"),
            hex("20 3fe11f 40 017e 810f")
        );
    }

    #[test]
    fn fields_larger_than_the_table_stay_out_of_it() {
        for (name, first, size) in [("~", "0f2f", 35), ("age", "0f06", 37)] {
            let mut encoder = Encoder::new();
            encoder.set_max_table_size(size);
            encode(&mut encoder, name, "~~");
            let expected = [hex(first), raw(b"~~~")].concat();
            assert_eq!(encode(&mut encoder, name, "~~~"), expected);
            assert_eq!(encode(&mut encoder, name, "~~"), hex("be"));
        }
    }

    #[test]
    fn finds_every_entry() {
        let mut encoder = Encoder::new();
        let name = |number: usize| format!("{:02x}", number % 256);
        for number in 0..140_000 {
            let value = [(number / 256 % 256) as u8];
            assert_eq!(encode(&mut encoder, name(number), value)[0], 0x40);
            if number % 1000 == 199 {
                for age in 0..4096 / 35 {
                    let (number, index) = (number - age, 62 + age);
                    let value = [(number / 256 % 256) as u8];
                    let block = encode(&mut encoder, name(number), value);
                    assert_eq!(block, integer(0x80, 7, index));
                    let block = encode_as(&mut encoder, name(number), "", Indexing::Never);
                    assert_eq!(block, [integer(0x10, 4, index), raw(b"")].concat());
                }
            }
        }
    }

    #[test]
    fn evicted_entries_stay_lost() {
        let mut encoder = Encoder::new();
        encode(&mut encoder, "~", "");
        for number in 0..140_000 {
            encode(&mut encoder, "age", number.to_string());
            if number > 200 {
                for (name, expected) in [("~", "00 017e 00"), ("^", "00 015e 00")] {
                    let block = encode_as(&mut encoder, name, "", Indexing::Without);
                    assert_eq!(block, hex(expected));
                }
            }
        }
    }

    #[test]
    fn finds_entries_while_their_numbers_wrap() {
        let mut encoder = Encoder::new();
        for number in 0..70_000 {
            encode(&mut encoder, "age", number.to_string());
            assert_eq!(encode(&mut encoder, "age", number.to_string()), hex("be"));
        }
    }

    #[test]
    fn link_that_has_come_to_lead_to_a_newer_entry_ends_the_search() {
        let mut encoder = Encoder::new();
        encode(&mut encoder, "x-a", "0");
        for number in 0..65_534 {
            encode(&mut encoder, "age", number.to_string());
        }
        encode(&mut encoder, "x-a", "1");
        encode(&mut encoder, "x-a", "2");
        for number in 0..1000 {
            let block = encode_as(&mut encoder, format!("y-{number}"), "", Indexing::Never);
            assert_eq!(block[0], 0x10);
        }
    }

    /// Whether a new field goes into the table.
    fn indexes(encoder: &mut Encoder, value: impl std::fmt::Display) -> bool {
        empty_block(encoder);
        match encode(encoder, "age", value.to_string())[0] {
            0x55 => true,
            0x0f => false,
            other => panic!("{other:02x}"),
        }
    }

    fn with_full_history() -> Encoder {
        let mut encoder = Encoder::with_history();
        for _ in 0..42 {
            encode(&mut encoder, ":status", "200");
        }
        encoder
    }

    #[test]
    fn history_length_follows_the_table_size() {
        for (size, len) in [(4096, 42), (4095, 42), (1024, 10), (192, 2), (96, 1)] {
            let mut encoder = with_full_history();
            encoder.set_max_table_size(2048);
            encoder.set_max_table_size(size);
            let count = (0..100).take_while(|number| indexes(&mut encoder, number));
            assert_eq!(count.count(), len - 1);
        }
    }

    #[test]
    fn history_outlasts_a_setting_that_changes_nothing() {
        let mut encoder = with_full_history();
        encoder.set_max_table_size(65_536);
        assert!(!indexes(&mut encoder, "new"));
    }

    #[test]
    fn no_history_for_a_tiny_table() {
        let mut encoder = with_full_history();
        encoder.set_max_table_size(95);
        assert!((0..100).all(|number| indexes(&mut encoder, number)));
    }

    #[test]
    fn history_holds_the_latest_fields() {
        for (between, is_remembered) in [(0, true), (41, true), (42, false)] {
            let mut encoder = with_full_history();
            assert!(!indexes(&mut encoder, "new"));
            assert!((0..between).all(|number| !indexes(&mut encoder, number)));
            assert_eq!(indexes(&mut encoder, "new"), is_remembered);
        }
    }

    #[test]
    fn history_counts_indexed_fields() {
        let mut encoder = with_full_history();
        assert!(!indexes(&mut encoder, "a"));
        assert!(indexes(&mut encoder, "a"));
        assert!(!indexes(&mut encoder, "b"));
        for _ in 0..42 {
            assert_eq!(encode(&mut encoder, "age", "a"), hex("be"));
        }
        assert!(!indexes(&mut encoder, "b"));
    }

    #[test]
    fn history_remembers_indexed_fields() {
        let mut encoder = with_full_history();
        assert!(!indexes(&mut encoder, "a"));
        assert!(indexes(&mut encoder, "a"));
        for _ in 0..42 {
            encode(&mut encoder, ":status", "200");
        }
        assert_eq!(encode(&mut encoder, "age", "a"), hex("be"));
        let long = "b".repeat(4050);
        assert!(!indexes(&mut encoder, &long));
        assert!(indexes(&mut encoder, &long));
        assert!(indexes(&mut encoder, "a"));
    }

    #[test]
    fn history_tells_names_apart() {
        let mut encoder = with_full_history();
        for name in ["x-a", "x-b", "via", "vary", ":authority", ":method"] {
            assert!(encode(&mut encoder, name, "v")[0] < 0x10, "{name}");
        }
    }

    #[test]
    fn history_follows_indexing() {
        let mut encoder = with_full_history();
        for _ in 0..2 {
            let block = encode_as(&mut encoder, "age", "a", Indexing::Without);
            assert_eq!(block, hex("0f06 811f"));
            let block = encode_as(&mut encoder, "age", "b", Indexing::Never);
            assert_eq!(block, hex("1f06 818f"));
        }
        assert!(indexes(&mut encoder, "a"));
        assert!(!indexes(&mut encoder, "b"));
    }

    #[test]
    fn model_decodes_the_result() {
        let mut random = Random(4);
        for round in 0..200 {
            let mut encoder = [Encoder::new, Encoder::with_history][round % 2]();
            let (mut decoder, mut model) = (Decoder::new(), Model::new());
            let mut names: Vec<_> = static_table().map(|entry| entry.0.to_vec()).collect();
            names.extend((0..40).map(|_| [&b"x"[..], &random.text(20)].concat()));
            let values: Vec<_> = (0..random.pick(&[3, 50]))
                .map(|_| {
                    let max_len = random.pick(&[3, 30, 30, 600]);
                    random.text(max_len)
                })
                .collect();
            for _ in 0..60 {
                while random.below(15) == 0 {
                    let size = random.pick(&[0, 50, 100, 500, 4096, 8192]);
                    encoder.set_max_table_size(size as u32);
                    model.size_limit = size;
                }
                let (mut out, mut expected) = (vec![], vec![]);
                let mut block = encoder.block(&mut out);
                for _ in 0..random.below(12) {
                    let name = &names[random.below(names.len())];
                    let value = &values[random.below(values.len())];
                    let indexing = random.pick(&[
                        Indexing::Allowed,
                        Indexing::Allowed,
                        Indexing::Without,
                        Indexing::Never,
                    ]);
                    block.field(name, value, indexing);
                    expected.push(Field {
                        never_index: indexing == Indexing::Never,
                        ..field(name, value)
                    });
                }
                assert_eq!(model.decode(&out).as_ref(), Some(&expected));
                assert!(model.max_size <= model.size_limit);
                assert_eq!(decode(&mut decoder, &out), Ok(expected));
            }
        }
    }
}

#[test]
fn error_messages() {
    assert_eq!(Error::Malformed.to_string(), "Malformed header block");
    assert_eq!(Error::FieldTooLong.to_string(), "Header field too long");
}
