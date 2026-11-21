use std::collections::{BTreeMap, VecDeque};
use std::ops::Range;

use bun_qpack::{Decoder, Encoder, Error, Indexing};

/// RFC 9204 Appendix A.
#[rustfmt::skip]
const STATIC_TABLE: [(&str, &str); 99] = [
    (":authority", ""), (":path", "/"), ("age", "0"), ("content-disposition", ""),
    ("content-length", "0"), ("cookie", ""), ("date", ""), ("etag", ""), ("if-modified-since", ""),
    ("if-none-match", ""), ("last-modified", ""), ("link", ""), ("location", ""), ("referer", ""),
    ("set-cookie", ""), (":method", "CONNECT"), (":method", "DELETE"), (":method", "GET"),
    (":method", "HEAD"), (":method", "OPTIONS"), (":method", "POST"), (":method", "PUT"),
    (":scheme", "http"), (":scheme", "https"), (":status", "103"), (":status", "200"),
    (":status", "304"), (":status", "404"), (":status", "503"), ("accept", "*/*"),
    ("accept", "application/dns-message"), ("accept-encoding", "gzip, deflate, br"),
    ("accept-ranges", "bytes"), ("access-control-allow-headers", "cache-control"),
    ("access-control-allow-headers", "content-type"), ("access-control-allow-origin", "*"),
    ("cache-control", "max-age=0"), ("cache-control", "max-age=2592000"),
    ("cache-control", "max-age=604800"), ("cache-control", "no-cache"),
    ("cache-control", "no-store"), ("cache-control", "public, max-age=31536000"),
    ("content-encoding", "br"), ("content-encoding", "gzip"),
    ("content-type", "application/dns-message"), ("content-type", "application/javascript"),
    ("content-type", "application/json"), ("content-type", "application/x-www-form-urlencoded"),
    ("content-type", "image/gif"), ("content-type", "image/jpeg"), ("content-type", "image/png"),
    ("content-type", "text/css"), ("content-type", "text/html; charset=utf-8"),
    ("content-type", "text/plain"), ("content-type", "text/plain;charset=utf-8"),
    ("range", "bytes=0-"), ("strict-transport-security", "max-age=31536000"),
    ("strict-transport-security", "max-age=31536000; includesubdomains"),
    ("strict-transport-security", "max-age=31536000; includesubdomains; preload"),
    ("vary", "accept-encoding"), ("vary", "origin"), ("x-content-type-options", "nosniff"),
    ("x-xss-protection", "1; mode=block"), (":status", "100"), (":status", "204"),
    (":status", "206"), (":status", "302"), (":status", "400"), (":status", "403"),
    (":status", "421"), (":status", "425"), (":status", "500"), ("accept-language", ""),
    ("access-control-allow-credentials", "FALSE"), ("access-control-allow-credentials", "TRUE"),
    ("access-control-allow-headers", "*"), ("access-control-allow-methods", "get"),
    ("access-control-allow-methods", "get, post, options"),
    ("access-control-allow-methods", "options"),
    ("access-control-expose-headers", "content-length"),
    ("access-control-request-headers", "content-type"), ("access-control-request-method", "get"),
    ("access-control-request-method", "post"), ("alt-svc", "clear"), ("authorization", ""),
    ("content-security-policy", "script-src 'none'; object-src 'none'; base-uri 'none'"),
    ("early-data", "1"), ("expect-ct", ""), ("forwarded", ""), ("if-range", ""), ("origin", ""),
    ("purpose", "prefetch"), ("server", ""), ("timing-allow-origin", "*"),
    ("upgrade-insecure-requests", "1"), ("user-agent", ""), ("x-forwarded-for", ""),
    ("x-frame-options", "deny"), ("x-frame-options", "sameorigin"),
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

fn raw_with_prefix(pattern: u8, prefix_bits: u32, text: &[u8]) -> Vec<u8> {
    [&integer(pattern, prefix_bits, text.len()), text].concat()
}

fn raw(text: &[u8]) -> Vec<u8> {
    raw_with_prefix(0x00, 7, text)
}

/// The shorter form, which is what the encoder picks.
fn literal_with_prefix(pattern: u8, prefix_bits: u32, text: &[u8]) -> Vec<u8> {
    let mut written = vec![];
    bun_hpack::literal::write(text, &mut written);
    let mut bytes = &written[..];
    Model::integer(&mut bytes, 7).unwrap();
    raw_with_prefix(pattern | written[0] >> 7 << prefix_bits, prefix_bits, bytes)
}

fn literal(text: &[u8]) -> Vec<u8> {
    literal_with_prefix(0x00, 7, text)
}

/// Line feeds, which have one of the longest Huffman codes.
fn longest_codes(count: usize) -> Vec<u8> {
    let mut bits = [&[1; 28][..], &[0; 2]].concat().repeat(count);
    bits.resize(bits.len().next_multiple_of(8), 1);
    bits.chunks(8)
        .map(|byte| byte.iter().fold(0, |byte, bit| byte << 1 | bit))
        .collect()
}

/// For a table of `max_entries`.
fn prefix(required_insert_count: usize, base: usize, max_entries: usize) -> Vec<u8> {
    let encoded = match required_insert_count {
        0 => 0,
        count => count % (2 * max_entries) + 1,
    };
    let delta_base = match base.checked_sub(required_insert_count) {
        Some(delta) => integer(0x00, 7, delta),
        None => integer(0x80, 7, required_insert_count - base - 1),
    };
    [integer(0x00, 8, encoded), delta_base].concat()
}

#[derive(Clone, PartialEq, Eq)]
struct Field {
    name: Vec<u8>,
    value: Vec<u8>,
    never_index: bool,
}

impl Field {
    fn size(&self) -> usize {
        self.name.len() + self.value.len() + 32
    }
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

fn decode(
    decoder: &mut Decoder,
    stream_id: u64,
    section: &[u8],
) -> Result<Option<Vec<Field>>, Error> {
    let (mut buffer, mut all, mut kept) = (vec![], vec![], vec![]);
    let Some(mut fields) = decoder.decode(stream_id, section, &mut buffer)? else {
        return Ok(None);
    };
    while let Some(next) = fields.next()? {
        if let Some(index) = next.static_index {
            assert_eq!(static_table().nth(index.into()).unwrap().0, next.name());
        }
        all.push(field(next.name(), next.value()));
        let start = kept.len();
        kept.extend([next.name(), next.value()].concat());
        assert_eq!(next.keep(), start);
    }
    assert_eq!(buffer[..kept.len()], kept);
    Ok(Some(all))
}

/// `[a=b, c=d]`, `blocked` or `DecompressionFailed`
fn show_on(decoder: &mut Decoder, stream_id: u64, section: &str) -> String {
    match decode(decoder, stream_id, &hex(section)) {
        Ok(Some(fields)) => format!("{fields:?}"),
        Ok(None) => "blocked".into(),
        Err(error) => format!("{error:?}"),
    }
}

fn show(decoder: &mut Decoder, section: &str) -> String {
    show_on(decoder, 0, section)
}

fn feed(decoder: &mut Decoder, instructions: &[u8]) -> Result<(), Error> {
    decoder.read_encoder_stream(instructions, &mut vec![])
}

/// With the settings of Bun.
fn decoder_after(instructions: &str) -> Decoder {
    let mut decoder = Decoder::new(4096, 100);
    feed(&mut decoder, &hex(instructions)).unwrap();
    decoder
}

fn drain(instructions: &mut Vec<u8>) -> Vec<u8> {
    std::mem::take(instructions)
}

/// From the newest entry on.
fn dynamic_table(decoder: &mut Decoder, insert_count: usize, max_entries: usize) -> Vec<Field> {
    let counts = (1..=insert_count).rev().take(max_entries);
    let sections = counts.map(|count| [prefix(count, count, max_entries), vec![0x80]].concat());
    let entries = sections.map_while(|section| decode(decoder, 0, &section).ok()??.pop());
    entries.collect()
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

    fn fragments<'a>(&mut self, mut bytes: &'a [u8]) -> Vec<&'a [u8]> {
        let max_len = self.pick(&[1, 3, 50, 5000]);
        let mut fragments = vec![];
        while !bytes.is_empty() {
            let len = bytes.len().min(self.below(max_len + 1));
            fragments.push(bytes.split_off(..len).unwrap());
        }
        fragments
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Stop {
    Incomplete,
    Invalid,
}

#[derive(Debug, Default)]
struct Section {
    required_insert_count: usize,
    fields: Vec<Field>,
    /// Absolute indexes.
    references: Vec<usize>,
}

/// The decoder of RFC 9204, written for plainness.
struct Model {
    /// By absolute index.
    entries: Vec<Field>,
    dropped: usize,
    capacity: usize,
    max_capacity: usize,
    unread: Vec<u8>,
}

impl Model {
    fn new(max_capacity: usize) -> Self {
        Self {
            entries: vec![],
            dropped: 0,
            capacity: 0,
            max_capacity,
            unread: vec![],
        }
    }

    /// From the newest entry on.
    fn table(&self) -> Vec<Field> {
        self.entries[self.dropped..].iter().rev().cloned().collect()
    }

    fn evict(&mut self) {
        while self.table().iter().map(Field::size).sum::<usize>() > self.capacity {
            self.dropped += 1;
        }
    }

    fn integer(input: &mut &[u8], prefix_bits: u32) -> Result<usize, Stop> {
        let full = (1 << prefix_bits) - 1;
        let prefix = usize::from(*input.split_off_first().ok_or(Stop::Incomplete)?) & full;
        if prefix < full {
            return Ok(prefix);
        }
        let Some(last) = input.iter().take(9).position(|&byte| byte < 128) else {
            return Err(match input.len() {
                ..9 => Stop::Incomplete,
                _ => Stop::Invalid,
            });
        };
        let digits = input.split_off(..=last).unwrap().iter().rev();
        match full + digits.fold(0, |value, &byte| value * 128 + usize::from(byte % 128)) {
            value @ ..0x4000_0000_0000_0000 => Ok(value),
            _ => Err(Stop::Invalid),
        }
    }

    /// Whether the code is valid only shows once the whole instruction is there.
    fn string(input: &mut &[u8], prefix_bits: u32) -> Result<Option<Vec<u8>>, Stop> {
        let is_huffman = input.first().ok_or(Stop::Incomplete)? >> prefix_bits & 1 == 1;
        let len = Self::integer(input, prefix_bits)?;
        let bytes = input.split_off(..len).ok_or(Stop::Incomplete)?;
        if !is_huffman {
            return Ok(Some(bytes.to_vec()));
        }
        let mut text = vec![0; 2 * len + 8];
        let len = bun_hpack::huffman::decode(bytes, bytes, &mut text);
        Ok(len.ok().map(|len| text[..len].to_vec()))
    }

    fn name_and_value(input: &mut &[u8], prefix_bits: u32) -> Result<Field, Stop> {
        let (name, value) = (Self::string(input, prefix_bits)?, Self::string(input, 7)?);
        Ok(field(
            name.ok_or(Stop::Invalid)?,
            value.ok_or(Stop::Invalid)?,
        ))
    }

    fn with_value(entry: Field, input: &mut &[u8]) -> Result<Field, Stop> {
        Ok(field(
            entry.name,
            Self::string(input, 7)?.ok_or(Stop::Invalid)?,
        ))
    }

    fn static_entry(input: &mut &[u8], prefix_bits: u32) -> Result<Field, Stop> {
        let index = Self::integer(input, prefix_bits)?;
        let (name, value) = STATIC_TABLE.get(index).ok_or(Stop::Invalid)?;
        Ok(field(name, value))
    }

    fn entry(&self, index: Option<usize>) -> Result<Field, Stop> {
        let index = index.filter(|&index| index >= self.dropped);
        let entry = index.and_then(|index| self.entries.get(index));
        entry.cloned().ok_or(Stop::Invalid)
    }

    fn instruction(&mut self, input: &mut &[u8]) -> Result<(), Stop> {
        let first = *input.first().ok_or(Stop::Incomplete)?;
        let relative = |index: usize| self.entry(self.entries.len().checked_sub(index + 1));
        let entry = match first.leading_zeros() {
            0 if first & 0x40 != 0 => Self::with_value(Self::static_entry(input, 6)?, input)?,
            0 => Self::with_value(relative(Self::integer(input, 6)?)?, input)?,
            1 => Self::name_and_value(input, 5)?,
            2 => {
                self.capacity = Self::integer(input, 5)?;
                if self.capacity > self.max_capacity {
                    return Err(Stop::Invalid);
                }
                self.evict();
                return Ok(());
            }
            _ => relative(Self::integer(input, 5)?)?,
        };
        if entry.size() > self.capacity {
            return Err(Stop::Invalid);
        }
        self.entries.push(entry);
        self.evict();
        Ok(())
    }

    fn read_encoder_stream(&mut self, bytes: &[u8]) -> Result<(), Error> {
        let unread = [&self.unread, bytes].concat();
        let mut rest = &unread[..];
        loop {
            self.unread = rest.to_vec();
            match self.instruction(&mut rest) {
                Ok(()) => {}
                Err(Stop::Incomplete) if self.unread.len() < 4 * self.max_capacity + 10 => {
                    return Ok(());
                }
                Err(_) => return Err(Error::EncoderStream),
            }
        }
    }

    /// As in §4.5.1.1.
    fn required_insert_count(&self, encoded: usize) -> Option<usize> {
        let max_entries = self.max_capacity / 32;
        let full_range = 2 * max_entries;
        if encoded == 0 {
            return Some(0);
        }
        if encoded > full_range {
            return None;
        }
        let max_value = self.entries.len() + max_entries;
        let max_wrapped = max_value / full_range * full_range;
        let mut count = max_wrapped + encoded - 1;
        if count > max_value {
            if count <= full_range {
                return None;
            }
            count -= full_range;
        }
        (count != 0).then_some(count)
    }

    /// There are no fields if the section is blocked.
    fn section(&self, mut input: &[u8]) -> Result<Section, Stop> {
        let input = &mut input;
        let count = self.required_insert_count(Self::integer(input, 8)?);
        let count = count.ok_or(Stop::Invalid)?;
        let is_negative = *input.first().ok_or(Stop::Incomplete)? >= 0x80;
        let base = match Self::integer(input, 7)? {
            delta if is_negative => count.checked_sub(delta + 1).ok_or(Stop::Invalid)?,
            delta => count + delta,
        };
        let mut section = Section {
            required_insert_count: count,
            ..Section::default()
        };
        if count > self.entries.len() {
            return Ok(section);
        }
        while let Some(&first) = input.first() {
            let mut refer = |index: Option<usize>| {
                section.references.extend(index);
                self.entry(index.filter(|&index| index < count))
            };
            let (next, never_bit) = match first.leading_zeros() {
                0 if first & 0x40 != 0 => (Self::static_entry(input, 6)?, 0),
                0 => (refer(base.checked_sub(Self::integer(input, 6)? + 1))?, 0),
                1 => {
                    let entry = match first & 0x10 {
                        0 => refer(base.checked_sub(Self::integer(input, 4)? + 1))?,
                        _ => Self::static_entry(input, 4)?,
                    };
                    (Self::with_value(entry, input)?, 0x20)
                }
                2 => (Self::name_and_value(input, 3)?, 0x10),
                3 => (refer(Some(base + Self::integer(input, 4)?))?, 0),
                _ => {
                    let entry = refer(Some(base + Self::integer(input, 3)?))?;
                    (Self::with_value(entry, input)?, 0x08)
                }
            };
            section.fields.push(Field {
                never_index: first & never_bit != 0,
                ..next
            });
        }
        match section.references.iter().max() {
            newest if newest.map_or(0, |index| index + 1) == count => Ok(section),
            _ => Err(Stop::Invalid),
        }
    }
}

#[test]
fn error_codes() {
    assert_eq!(Error::DecompressionFailed as u64, 0x200);
    assert_eq!(Error::EncoderStream as u64, 0x201);
    assert_eq!(Error::DecoderStream as u64, 0x202);
}

#[test]
fn appendix_b() {
    let mut decoder = Decoder::new(220, 1);
    let section = "0000 510b 2f69 6e64 6578 2e68 746d 6c";
    assert_eq!(show_on(&mut decoder, 0, section), "[:path=/index.html]");
    assert_eq!(drain(decoder.instructions()), []);

    let instructions = "3fbd01 c00f 7777 772e 6578 616d 706c 652e 636f 6d
                        c10c 2f73 616d 706c 652f 7061 7468";
    feed(&mut decoder, &hex(instructions)).unwrap();
    assert_eq!(
        show_on(&mut decoder, 4, "0381 10 11"),
        "[:authority=www.example.com, :path=/sample/path]"
    );
    assert_eq!(drain(decoder.instructions()), hex("84"));

    let instructions = "4a63 7573 746f 6d2d 6b65 790c 6375 7374 6f6d 2d76 616c 7565";
    feed(&mut decoder, &hex(instructions)).unwrap();
    assert_eq!(drain(decoder.instructions()), hex("01"));

    assert_eq!(show_on(&mut decoder, 8, "0500 80 c1 81"), "blocked");
    decoder.cancel_stream(8);
    assert_eq!(drain(decoder.instructions()), hex("48"));
    feed(&mut decoder, &hex("02")).unwrap();
    assert_eq!(decoder.next_unblocked(), None);
    assert_eq!(
        show_on(&mut decoder, 12, "0500 80 c1 81"),
        "[:authority=www.example.com, :path=/, custom-key=custom-value]"
    );

    let instructions = "810d 6375 7374 6f6d 2d76 616c 7565 32";
    feed(&mut decoder, &hex(instructions)).unwrap();
    assert_eq!(
        format!("{:?}", dynamic_table(&mut decoder, 5, 6)),
        "[custom-key=custom-value2, :authority=www.example.com, custom-key=custom-value, \
         :path=/sample/path]"
    );
}

/// From <https://github.com/qpackers/qifs>. Stream 0 is the encoder stream.
#[test]
fn what_other_encoders_write() {
    const AGENT: &str = "bbd07f66a281b0dae053fae46aa43f8429a77a8102e0fb5391aa71afb53cb8d7da9677b8db
                         cb83fb531149d4ec0801000200a984d61653f961b79707";
    const ACCEPT: &str = "b0497ca589d34d1f43aeba0c41a4c7a98f33a69a3fdf9a68fa1d75d0620d263d4c79a68fb
                          ed00177febe58f9fbed00177b";
    const HOST: &str = "8bf1e3c2f51531a245cf64df";
    const LANGUAGE: &str = "8b2d4b70ddf45abefb4005db";
    const ENCODING: &str = "8a9bd9abfa5242cb40d25f";
    const CONNECTION: &str = "21eaa8a4498f57 88ea52d6b0e83772ff";
    const PRAGMA: &str = "aec1cd48ff 86a8eb10649cbf";
    const PATH: &str = "88626a0f18e85c8847";
    const STYLE: &str = "8e497ca582211f5f2c7cfdf6800b87";
    const REFERER: &str = "919d29aee30c78f1e17a8a98d122e7b2663f";

    let request = |path, accept, tail: &[(&str, &str)]| {
        let agent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:58.0) Gecko/20100101 Firefox/58.0";
        let head = [
            (":method", "GET"),
            (":scheme", "http"),
            (":authority", "www.netbsd.org"),
            (":path", path),
            ("user-agent", agent),
            ("accept", accept),
            ("accept-language", "en-US,en;q=0.5"),
            ("accept-encoding", "gzip, deflate"),
        ];
        let end = [("pragma", "no-cache"), ("cache-control", "no-cache")];
        let all = [&head, tail, &end].concat();
        Vec::from_iter(all.iter().map(|(name, value)| field(name, value)))
    };
    let connection = ("connection", "keep-alive");
    let expected = BTreeMap::from([
        (
            1,
            request(
                "/",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                &[connection, ("upgrade-insecure-requests", "1")],
            ),
        ),
        (
            2,
            request(
                "/global.css",
                "text/css,*/*;q=0.1",
                &[("referer", "http://www.netbsd.org/"), connection],
            ),
        ),
    ]);

    let rest = format!("ff09{LANGUAGE} df{ENCODING} 67{CONNECTION} 65{PRAGMA}");
    let indexed = "0886 d1d6 10 c1 1112131415 ff1f 16 e7";
    let all_indexed = "0b82 d1d6 86 10 85 11 8382 12 8180 e7";
    for (encoder, pieces) in [
        (
            "nghttp3",
            vec![
                (0, format!("c0{HOST} ff20{AGENT} dd{ACCEPT} {rest}")),
                (1, indexed.into()),
                (0, format!("dd{STYLE} cd{REFERER}")),
                (2, format!("0a81 d1d6 86 51{PATH} 85 10 8382 11 8180 e7")),
            ],
        ),
        (
            "proxygen",
            vec![
                (1, indexed.into()),
                (0, format!("3fe11f c0{HOST} ff20{AGENT} dd{ACCEPT} {rest}")),
                (2, all_indexed.into()),
                (0, format!("c1{PATH} dd{STYLE} cd{REFERER}")),
            ],
        ),
        (
            "f5",
            vec![
                (1, indexed.into()),
                (
                    0,
                    format!("68b83b5339ec327d7f{HOST} ff20{AGENT} de{ACCEPT} {rest}"),
                ),
                (2, all_indexed.into()),
                (0, format!("c1{PATH} de{STYLE} cd{REFERER}")),
            ],
        ),
        (
            "qthingey",
            vec![
                (0, format!("c0{HOST} ff20{AGENT} {rest}")),
                (
                    1,
                    format!("0785 d1d6 10 c1 11 5f0e{ACCEPT} 121314 ff1f 15 e7"),
                ),
                (0, format!("05 cd{REFERER}")),
                (
                    2,
                    format!("0981 d1d6 10 51{PATH} 84 5f0e{STYLE} 8382 11 8180 e7"),
                ),
            ],
        ),
        (
            "ls-qpack",
            vec![
                (
                    1,
                    format!(
                        "0000 d1d6 50{HOST} c1 5f50{AGENT} 5f0e{ACCEPT} 5f39{LANGUAGE}
                         5f10{ENCODING} 2f00{CONNECTION} ff1f 2d{PRAGMA} e7"
                    ),
                ),
                (0, format!("c0{HOST} ff20{AGENT} {rest}")),
                (
                    2,
                    format!("0785 d1d6 10 51{PATH} 11 5f0e{STYLE} 1213 5d{REFERER} 1415 e7"),
                ),
            ],
        ),
    ] {
        let mut decoder = decoder_after("3fe11f");
        let (mut decoded, mut blocked) = (BTreeMap::new(), BTreeMap::new());
        for (mut stream_id, bytes) in pieces {
            let mut bytes = hex(&bytes);
            if stream_id == 0 {
                feed(&mut decoder, &bytes).unwrap();
                let Some(unblocked) = decoder.next_unblocked() else {
                    continue;
                };
                (stream_id, bytes) = (unblocked, blocked.remove(&unblocked).unwrap());
            }
            match decode(&mut decoder, stream_id, &bytes).unwrap() {
                Some(fields) => drop(decoded.insert(stream_id, fields)),
                None => drop(blocked.insert(stream_id, bytes)),
            }
        }
        assert_eq!(decoded, expected, "{encoder}");
    }
}

mod field_sections {
    use super::*;

    const FAILED: &str = "DecompressionFailed";

    /// Absolute index 0 has been evicted.
    fn decoder_with_entries() -> Decoder {
        decoder_after("3f47 4161 0130 4162 0131 4163 0132 4164 0133")
    }

    #[test]
    fn static_entries() {
        for (index, (name, value)) in static_table().enumerate() {
            let insertion = [integer(0xc0, 6, index), raw(b"v")].concat();
            let mut decoder = decoder_after("3fe11f");
            feed(&mut decoder, &[insertion, hex("80 0177 01")].concat()).unwrap();
            for (section, value) in [
                ([hex("0000"), integer(0xc0, 6, index)].concat(), value),
                (
                    [hex("0000"), integer(0x50, 4, index), raw(b"l")].concat(),
                    b"l",
                ),
                (
                    [hex("0000"), integer(0x70, 4, index), raw(b"n")].concat(),
                    b"n",
                ),
                (hex("0200 80"), b"v"),
                (hex("0300 80"), b"w"),
                (hex("0400 80"), b"v"),
                (hex("0480 10"), b"v"),
                (hex("0400 40 0178"), b"x"),
                (hex("0480 00 0179"), b"y"),
            ] {
                let mut buffer = vec![];
                let fields = decoder.decode(0, &section, &mut buffer);
                let mut fields = fields.unwrap().unwrap();
                let next = fields.next().unwrap().unwrap();
                assert_eq!(
                    (next.name(), next.value(), next.static_index),
                    (name, value, Some(index as u8))
                );
                assert!(fields.next().unwrap().is_none());
            }
        }
        for section in ["0000 ff24", "0000 ff41", "0000 5f54 00", "0000 7f54 00"] {
            assert_eq!(show(&mut decoder_after(""), section), FAILED, "{section}");
        }
    }

    #[test]
    fn literal_names_have_no_static_index() {
        let mut decoder = decoder_after("3fe11f 44 64617465 00 00 80 00");
        let (section, mut buffer) = (hex("0400 80 81 82 40 00 24 64617465 00"), vec![]);
        let mut fields = decoder.decode(0, &section, &mut buffer).unwrap().unwrap();
        while let Some(next) = fields.next().unwrap() {
            assert_eq!((next.name(), next.static_index), (&b"date"[..], None));
        }
    }

    #[test]
    fn representations() {
        for (section, expected) in [
            ("0000", "[]"),
            ("0000 c1 d1", "[:path=/, :method=GET]"),
            ("0000 51 0161", "[:path=a]"),
            ("0000 71 0161", "[:path=a]"),
            ("0000 51 811f", "[:path=a]"),
            ("0000 51 00", "[:path=]"),
            ("0000 51 80", "[:path=]"),
            ("0000 21 61 0162", "[a=b]"),
            ("0000 31 61 0162", "[a=b]"),
            ("0000 29 1f 818f", "[a=b]"),
            ("0000 39 1f 0162", "[a=b]"),
            ("0000 21 61 00", "[a=]"),
            ("0000 22 4109 02 2000", "[A\\t= \\x00]"),
            ("0000 20 0161", "[=a]"),
            ("0000 28 0161", "[=a]"),
            ("0000 20 00", "[=]"),
            ("0000 29 00 0161", FAILED),
            ("0000 21 61 8100", FAILED),
            ("0000 51 82 1fff", FAILED),
            ("0000 51 84 ffffffff", FAILED),
            ("0500 80", "[d=3]"),
            ("0500 80 81 82", "[d=3, c=2, b=1]"),
            ("0500 82 80 80", "[b=1, d=3, d=3]"),
            ("0500 40 0178", "[d=x]"),
            ("0500 60 0178 42 00", "[d=x, b=]"),
            ("0580 10 80", "[d=3, c=2]"),
            ("0582 12 11 10", "[d=3, c=2, b=1]"),
            ("0582 02 0178 08 811f", "[d=x, b=a]"),
            ("0583 13", "[d=3]"),
            ("0505 85", "[d=3]"),
            ("0400 80 81", "[c=2, b=1]"),
            ("0401 81", "[c=2]"),
        ] {
            assert_eq!(show(&mut decoder_with_entries(), section), expected);
        }
    }

    #[test]
    fn references_out_of_reach() {
        for section in [
            // Evicted
            "0500 80 83",
            "0500 80 43 00",
            "0583 13 10",
            "0583 13 00 00",
            "0200 80",
            // Before the first entry
            "0500 80 84",
            "0583 13 80",
            // Not below the Required Insert Count
            "0500 80 10",
            "0500 80 00 00",
            "0501 81 80",
            "0400 80 10",
            "0401 81 80",
            "0401 81 40 00",
            "0302 82 80",
            "0381 11 12",
            "0000 80",
            "0000 10",
            "0004 80",
            "0004 40 00",
            "0001 10",
            // Far away
            "0500 80 bf c0ffffffffffffff3f",
            "0500 80 1f f0ffffffffffffff3f",
            "057f 80ffffffffffffff3f 80",
            "057f 80ffffffffffffff3f 1f f0ffffffffffffff3f",
        ] {
            assert_eq!(show(&mut decoder_with_entries(), section), FAILED);
        }
        let section = "057f 80ffffffffffffff3f bf c0ffffffffffffff3f";
        assert_eq!(show(&mut decoder_with_entries(), section), "[d=3]");
    }

    #[test]
    fn the_required_insert_count_is_no_larger_than_needed() {
        for section in ["0500", "0500 c1", "0500 81", "0582 11 10", "0500 41 00"] {
            assert_eq!(show(&mut decoder_with_entries(), section), FAILED);
        }
    }

    #[test]
    fn prefixes() {
        for (section, expected) in [
            ("", FAILED),
            ("00", FAILED),
            ("ff", FAILED),
            ("007f", FAILED),
            ("007f00 c1", "[:path=/]"),
            ("0080", FAILED),
            ("0081", FAILED),
            ("0584 14", FAILED),
            ("05ff 80ffffffffffffff3f", FAILED),
            ("0100", FAILED),
            ("8500", "blocked"),
            ("8600", FAILED),
            ("ff0100", FAILED),
            ("ff0200", FAILED),
            ("0685", FAILED),
            ("06", FAILED),
        ] {
            let actual = show(&mut decoder_with_entries(), section);
            assert_eq!(actual, expected, "{section}");
        }
    }

    #[test]
    fn required_insert_counts_wrap_around() {
        for max_capacity in [0, 31, 32, 33, 64, 100, 200, 4096] {
            let mut decoder = Decoder::new(max_capacity, u32::MAX);
            let mut model = Model::new(max_capacity as usize);
            let mut instruction = integer(0x20, 5, max_capacity as usize);
            for _ in 0..if max_capacity > 32 { 600 } else { 1 } {
                feed(&mut decoder, &instruction).unwrap();
                model.read_encoder_stream(&instruction).unwrap();
                instruction = hex("4161 00");
                for encoded in 0..=model.max_capacity / 16 + 1 {
                    let section = [integer(0x00, 8, encoded), hex("00 80")].concat();
                    let expected = match model.section(&section) {
                        Ok(section) => Ok(Some(section.fields).filter(|all| !all.is_empty())),
                        Err(_) => Err(Error::DecompressionFailed),
                    };
                    assert_eq!(decode(&mut decoder, 0, &section), expected);
                    decoder.cancel_stream(0);
                }
            }
        }
    }

    #[test]
    fn truncated_fields() {
        let (name, value) = ([b'n'; 200], [b'v'; 200]);
        for whole in [
            [raw_with_prefix(0x20, 3, &name), raw(&value)].concat(),
            [literal_with_prefix(0x30, 3, &name), literal(&value)].concat(),
            [hex("5f00"), raw(b"")].concat(),
            [hex("7f10"), literal(&value)].concat(),
            [hex("40"), raw(&value)].concat(),
            [hex("00"), raw(&value)].concat(),
            hex("ff00"),
        ] {
            let whole = [hex("0580 10"), whole].concat();
            assert!(decode(&mut decoder_with_entries(), 0, &whole).is_ok());
            for len in 4..whole.len() {
                let actual = decode(&mut decoder_with_entries(), 0, &whole[..len]);
                assert_eq!(actual, Err(Error::DecompressionFailed));
            }
        }
    }

    #[test]
    fn integers() {
        for (line, expected) in [
            ("ff 80 00", "[:status=100]"),
            ("ff 81 80 80 80 80 80 80 80 00", "[:status=204]"),
            ("ff 80 80 80 80 80 80 80 80 80 00", FAILED),
            ("5f 80 80 80 80 80 80 80 80 00 00", "[:method=]"),
            (
                "27 80 80 80 80 80 80 80 80 00 61616161616161 00",
                "[aaaaaaa=]",
            ),
            ("ff 80", FAILED),
            ("ff 80 80 80 80 80 80 80 80", FAILED),
            ("ff ff ff ff ff ff ff ff ff 7f", FAILED),
            ("ff c2 ff ff ff 0f", FAILED),
            ("5f f2 ff ff ff 0f 00", FAILED),
            ("27 fa ff ff ff 0f 61 00", FAILED),
            ("51 7f 82 ff ff ff 0f 61", FAILED),
            ("51 ff 80 ff ff ff ff ff ff ff 3f", FAILED),
            ("bf", FAILED),
            ("1f", FAILED),
            ("4f", FAILED),
            ("07", FAILED),
        ] {
            let actual = show(&mut decoder_after(""), &format!("0000 {line}"));
            assert_eq!(actual, expected, "{line}");
        }
        let section = "007f 80ffffffffffffff3f c1";
        assert_eq!(show(&mut decoder_after(""), section), "[:path=/]");
        let section = "007f 81ffffffffffffff3f c1";
        assert_eq!(show(&mut decoder_after(""), section), FAILED);
    }

    #[test]
    fn indexes_and_lengths_of_every_width() {
        let (count, max_entries) = (17_000, u32::MAX as usize / 32);
        let mut decoder = Decoder::new(u32::MAX, 0);
        feed(&mut decoder, &integer(0x20, 5, u32::MAX as usize)).unwrap();
        let add = |decoder: &mut Decoder, numbers: Range<usize>| {
            for text in numbers.map(|number| number.to_string().into_bytes()) {
                let instruction = [raw_with_prefix(0x40, 5, &text), raw(&text)];
                feed(decoder, &instruction.concat()).unwrap();
            }
        };
        add(&mut decoder, 0..count);
        for index in 0..count {
            let text = index.to_string();
            let lines = [
                integer(0x80, 6, count - 1 - index),
                integer(0x40, 4, count - 1 - index),
                hex("00 40 00"),
            ];
            let section = [prefix(count, count, max_entries), lines.concat()].concat();
            let expected = vec![field(&text, &text), field(&text, ""), field("16999", "")];
            assert_eq!(decode(&mut decoder, 0, &section), Ok(Some(expected)));
            for pattern in [0x00, 0x08] {
                let lines = [
                    integer(0x10, 4, index),
                    integer(pattern, 3, index),
                    raw(b""),
                ];
                let section = [prefix(index + 1, 0, max_entries), lines.concat()].concat();
                let expected = vec![field(&text, &text), field(&text, "")];
                assert_eq!(decode(&mut decoder, 0, &section), Ok(Some(expected)));
            }
        }
        let mut count = count;
        for index in [
            0, 30, 31, 62, 63, 158, 159, 190, 191, 16_414, 16_415, 16_446, 16_447,
        ] {
            let name = [integer(0x80, 6, index), raw(b"~")].concat();
            for (instruction, value) in [(name, "~"), (integer(0x00, 5, index), "0")] {
                add(&mut decoder, 0..index + 1);
                feed(&mut decoder, &instruction).unwrap();
                count += index + 2;
                let section = [prefix(count, count, max_entries), hex("80")].concat();
                let expected = vec![field("0", value)];
                assert_eq!(decode(&mut decoder, 0, &section), Ok(Some(expected)));
            }
        }

        for len in [
            6, 7, 8, 126, 127, 128, 134, 135, 254, 255, 16_510, 16_511, 200_000,
        ] {
            for text in [vec![b'~'; len], vec![b'0'; len]] {
                let name = literal_with_prefix(0x20, 3, &text);
                let section = [hex("0000"), name, literal(&text)].concat();
                let expected = vec![field(&text, &text)];
                assert_eq!(decode(&mut decoder, 0, &section), Ok(Some(expected)));
            }
        }
    }

    #[test]
    fn fields_that_are_not_kept_leave_no_gap() {
        let mut decoder = decoder_with_entries();
        let section = hex("0500 80 c1 51 811f 21 61 0162 41 0178");
        for mask in 0..32 {
            let (mut buffer, mut expected) = (vec![], vec![]);
            let mut fields = decoder.decode(0, &section, &mut buffer).unwrap().unwrap();
            for (at, text) in ["d3", ":path/", ":patha", "ab", "cx"].iter().enumerate() {
                let next = fields.next().unwrap().unwrap();
                assert_eq!([next.name(), next.value()].concat(), text.as_bytes());
                if mask >> at & 1 == 1 {
                    assert_eq!(next.keep(), expected.len());
                    expected.extend(text.as_bytes());
                }
            }
            assert_eq!(buffer[..expected.len()], expected);
        }
    }

    #[test]
    fn the_buffer_follows_what_is_kept() {
        let mut decoder = decoder_after("3fe11f");
        feed(&mut decoder, &[hex("4161"), raw(&[b'v'; 4000])].concat()).unwrap();
        let section = [hex("0200"), vec![0x80; 1000], hex("40 00").repeat(1000)].concat();
        for (to_keep, len) in [(0, 4001), (1, 8002), (2, 16_004), (3, 16_004)] {
            let mut buffer = vec![];
            let mut fields = decoder.decode(0, &section, &mut buffer).unwrap().unwrap();
            for _ in 0..to_keep {
                fields.next().unwrap().unwrap().keep();
            }
            while fields.next().unwrap().is_some() {}
            assert_eq!(buffer.len(), len);
        }
    }

    #[test]
    fn a_buffer_is_used_again() {
        let (mut decoder, mut buffer) = (decoder_after(""), vec![b'#'; 2000]);
        let (section, before) = (hex("0000 c1 c1"), buffer.as_ptr());
        let mut fields = decoder.decode(0, &section, &mut buffer).unwrap().unwrap();
        while let Some(next) = fields.next().unwrap() {
            next.keep();
        }
        assert_eq!(&buffer[..12], b":path/:path/");
        assert_eq!((buffer.as_ptr(), buffer.len()), (before, 2000));
    }
}

mod encoder_stream {
    use super::*;

    fn table_after(instructions: &str, insert_count: usize) -> String {
        let mut decoder = Decoder::new(4096, 0);
        match feed(&mut decoder, &hex(instructions)) {
            Ok(()) => {
                let increment = Some(insert_count as u8).filter(|&count| count != 0);
                assert_eq!(drain(decoder.instructions()), Vec::from_iter(increment));
                format!("{:?}", dynamic_table(&mut decoder, insert_count, 128))
            }
            Err(error) => format!("{error:?}"),
        }
    }

    #[test]
    fn instructions() {
        for (instructions, insert_count, expected) in [
            ("", 0, "[]"),
            ("4161 0162", 1, "[a=b]"),
            ("611f 818f", 1, "[a=b]"),
            ("4161 00", 1, "[a=]"),
            ("4161 80", 1, "[a=]"),
            ("c1 0161", 1, "[:path=a]"),
            ("c1 811f", 1, "[:path=a]"),
            ("ff23 00", 1, "[x-frame-options=]"),
            ("4161 0162 80 0163", 2, "[a=c, a=b]"),
            ("4161 0162 4163 0164 81 811f", 3, "[a=a, c=d, a=b]"),
            ("4161 0162 00", 2, "[a=b, a=b]"),
            ("4161 0162 4163 0164 01 01", 4, "[c=d, a=b, c=d, a=b]"),
            ("c1 0161 00 80 0162", 3, "[:path=b, :path=a, :path=a]"),
            ("40 0161", 1, "[=a]"),
            ("60 0161 80 00 00", 3, "[=, =, =a]"),
            ("6100 0161", 0, "EncoderStream"),
            ("4161 8100", 0, "EncoderStream"),
            ("c1 8100", 0, "EncoderStream"),
            ("ff24 00", 0, "EncoderStream"),
            ("ff24", 0, "EncoderStream"),
            ("80", 0, "EncoderStream"),
            ("00", 0, "EncoderStream"),
            ("4161 0162 81", 0, "EncoderStream"),
            ("4161 0162 01", 0, "EncoderStream"),
            ("1f e0ffffffffffffff3f", 0, "EncoderStream"),
            ("bf 808080808080808080", 0, "EncoderStream"),
            ("5f 808080808080808080", 0, "EncoderStream"),
            ("c1 7f 808080808080808080", 0, "EncoderStream"),
            ("3f 808080808080808080", 0, "EncoderStream"),
        ] {
            let actual = table_after(&format!("3fe11f {instructions}"), insert_count);
            assert_eq!(actual, expected, "{instructions}");
        }
    }

    #[test]
    fn capacity() {
        for (instructions, insert_count, expected) in [
            ("4161 0162", 0, "EncoderStream"),
            ("c1 00", 0, "EncoderStream"),
            ("20 20", 0, "[]"),
            ("3fe21f", 0, "EncoderStream"),
            ("3f e1ffffff0f", 0, "EncoderStream"),
            ("3f03 4161 0162", 1, "[a=b]"),
            ("3f02 4161 0162", 0, "EncoderStream"),
            ("3f02 611f 818f", 0, "EncoderStream"),
            ("3f04 c2 00", 1, "[age=]"),
            ("3f03 c2 00", 0, "EncoderStream"),
            ("3f25 4161 0162 4163 0164", 2, "[c=d, a=b]"),
            ("3f24 4161 0162 4163 0164", 2, "[c=d]"),
            ("3f24 4161 0162 4163 0164 01", 0, "EncoderStream"),
            ("3f24 4161 0162 4163 0164 81 00", 0, "EncoderStream"),
            ("3f03 4161 0162 80 0163", 2, "[a=c]"),
            ("3f03 4161 0162 80 026363", 0, "EncoderStream"),
            ("3f03 4161 0162 00 00", 3, "[a=b]"),
            ("3f25 4161 0162 4163 0164 01", 3, "[a=b, c=d]"),
            ("3f25 4161 0162 4163 0164 3f03", 2, "[c=d]"),
            ("3f25 4161 0162 4163 0164 3f03 3fe11f", 2, "[c=d]"),
            ("3f25 4161 0162 20 3f25 4163 0164", 2, "[c=d]"),
            ("3f25 4161 0162 20 00", 0, "EncoderStream"),
        ] {
            let actual = table_after(instructions, insert_count);
            assert_eq!(actual, expected, "{instructions}");
        }
        assert_eq!(feed(&mut Decoder::new(0, 0), &hex("20")), Ok(()));
        let result = feed(&mut Decoder::new(0, 0), &hex("21"));
        assert_eq!(result, Err(Error::EncoderStream));
    }

    #[test]
    fn largest_entries() {
        for text in *b"~0" {
            for name_len in [1, 2032, 4064] {
                for (excess, expected) in [(0, Ok(())), (1, Err(Error::EncoderStream))] {
                    let entry = field(vec![text; name_len], vec![text; 4064 + excess - name_len]);
                    let name = literal_with_prefix(0x40, 5, &entry.name);
                    let mut decoder = decoder_after("3fe11f");
                    let result = feed(&mut decoder, &[name, literal(&entry.value)].concat());
                    assert_eq!(result, expected);
                    if result.is_ok() {
                        feed(&mut decoder, &hex("00 00")).unwrap();
                        assert_eq!(dynamic_table(&mut decoder, 3, 128), [entry]);
                    }
                }
            }
        }
    }

    #[test]
    fn scratch_is_in_proportion_to_the_table() {
        for head in ["c1", "4161"] {
            let instruction = [hex(head), literal(&[b'0'; 100_000])].concat();
            let mut scratch = vec![];
            let result = decoder_after("3fe11f").read_encoder_stream(&instruction, &mut scratch);
            assert_eq!(result, Err(Error::EncoderStream));
            assert_eq!(scratch.len(), 4096);
        }
    }

    #[test]
    fn every_split() {
        let instructions = [
            hex("3f e1 9f 80 80 80 80 80 80 00"),
            literal_with_prefix(0x40, 5, &[b'n'; 70]),
            literal(&[b'v'; 300]),
            hex("ff20"),
            raw(&[b'~'; 130]),
            hex("81 00 02 c1 80"),
        ];
        let instructions = instructions.concat();
        let mut model = Model::new(4096);
        model.read_encoder_stream(&instructions).unwrap();
        assert_eq!(model.table().len(), 5);
        for first in 0..=instructions.len() {
            for second in [0, 1, 2, 40] {
                let (head, rest) = instructions.split_at(first);
                let (middle, tail) = rest.split_at(rest.len().min(second));
                let mut decoder = Decoder::new(4096, 0);
                for fragment in [head, middle, tail] {
                    feed(&mut decoder, fragment).unwrap();
                }
                assert_eq!(dynamic_table(&mut decoder, 5, 128), model.table());
            }
        }
    }

    #[test]
    fn longest_instructions() {
        for max_capacity in [33, 34, 100, 4096] {
            let padded = |pattern: u8, prefix_bits: u32, bytes: &[u8]| {
                let mut head = integer(pattern, prefix_bits, bytes.len());
                if head.len() > 1 {
                    *head.last_mut().unwrap() |= 0x80;
                    head.resize(9, 0x80);
                    head.push(0);
                }
                [&head, bytes].concat()
            };
            let name_len = (max_capacity - 32_usize).div_ceil(2);
            let value_len = max_capacity - 32 - name_len;
            let name = padded(0x60, 5, &longest_codes(name_len));
            let value = padded(0x80, 7, &longest_codes(value_len));
            let mut decoder = Decoder::new(max_capacity as u32, 0);
            for byte in [integer(0x20, 5, max_capacity), name, value].concat() {
                feed(&mut decoder, &[byte]).unwrap();
            }
            assert_eq!(
                dynamic_table(&mut decoder, 1, max_capacity / 32),
                [field(vec![b'\n'; name_len], vec![b'\n'; value_len])]
            );
        }
    }

    #[test]
    fn what_cannot_fit_is_not_waited_for() {
        for (max_capacity, max_len) in [(0, 10), (100, 410), (4096, 16_394)] {
            let mut instruction = integer(0x40, 5, 1 << 20);
            instruction.resize(max_len + 1000, 0);
            for (held, excess) in [(0, 0), (0, 1000), (1, 0), (1, 1000), (max_len - 1, 0)] {
                let mut decoder = Decoder::new(max_capacity, 0);
                assert_eq!(feed(&mut decoder, &instruction[..held]), Ok(()));
                let result = feed(&mut decoder, &instruction[held..max_len + excess]);
                assert_eq!(result, Err(Error::EncoderStream));
            }
        }
    }
}

mod blocking {
    use super::*;

    fn unblocked(decoder: &mut Decoder) -> Vec<u64> {
        std::iter::from_fn(|| decoder.next_unblocked()).collect()
    }

    #[test]
    fn streams_go_on_in_order() {
        let mut decoder = decoder_after("3fe11f");
        for (stream_id, section) in [(0, "0400"), (4, "0200"), (8, "0300"), (12, "0200")] {
            assert_eq!(show_on(&mut decoder, stream_id, section), "blocked");
        }
        assert_eq!(drain(decoder.instructions()), []);
        assert_eq!(unblocked(&mut decoder), []);
        feed(&mut decoder, &hex("4161")).unwrap();
        assert_eq!(unblocked(&mut decoder), []);
        feed(&mut decoder, &hex("00")).unwrap();
        assert_eq!(unblocked(&mut decoder), [4, 12]);
        feed(&mut decoder, &hex("00 00")).unwrap();
        assert_eq!(unblocked(&mut decoder), [8, 0]);
        assert_eq!(show_on(&mut decoder, 8, "0300 80"), "[a=]");
    }

    #[test]
    fn limit() {
        for limit in [0, 1, 100] {
            let mut decoder = Decoder::new(4096, limit);
            for stream_id in 0..limit.into() {
                assert_eq!(show_on(&mut decoder, stream_id, "0200"), "blocked");
                assert_eq!(show_on(&mut decoder, stream_id, "0200"), "blocked");
            }
            assert_eq!(show_on(&mut decoder, 1000, "0000 c1"), "[:path=/]");
            assert_eq!(show_on(&mut decoder, 1000, "0200"), "DecompressionFailed");
        }
    }

    #[test]
    fn streams_that_may_go_on_do_not_count() {
        let mut decoder = Decoder::new(4096, 2);
        assert_eq!(show_on(&mut decoder, 0, "0200"), "blocked");
        assert_eq!(show_on(&mut decoder, 4, "0400"), "blocked");
        feed(&mut decoder, &hex("3fe11f 4161 00")).unwrap();
        assert_eq!(show_on(&mut decoder, 8, "0300"), "blocked");
        decoder.cancel_stream(8);
        assert_eq!(show_on(&mut decoder, 0, "0200 80"), "[a=]");
        assert_eq!(show_on(&mut decoder, 0, "0300"), "blocked");
        assert_eq!(show_on(&mut decoder, 8, "0300"), "DecompressionFailed");
        assert_eq!(unblocked(&mut decoder), []);
        feed(&mut decoder, &hex("00 00")).unwrap();
        assert_eq!(unblocked(&mut decoder), [0, 4]);
    }

    #[test]
    fn cancelled_streams_do_not_count() {
        let mut decoder = Decoder::new(4096, 2);
        assert_eq!(show_on(&mut decoder, 0, "0200"), "blocked");
        assert_eq!(show_on(&mut decoder, 4, "0200"), "blocked");
        decoder.cancel_stream(0);
        assert_eq!(show_on(&mut decoder, 8, "0200"), "blocked");
        feed(&mut decoder, &hex("3fe11f 4161 00")).unwrap();
        assert_eq!(unblocked(&mut decoder), [4, 8]);
    }
}

mod decoder_instructions {
    use super::*;

    #[test]
    fn acknowledgments_stand_in_for_increments() {
        let mut decoder = decoder_after("3fe11f 4161 00 00 00 00");
        assert_eq!(show_on(&mut decoder, 4, "0300 80"), "[a=]");
        assert_eq!(show_on(&mut decoder, 8, "0000 c1"), "[:path=/]");
        assert_eq!(show_on(&mut decoder, 12, "0200 80"), "[a=]");
        assert_eq!(decoder.instructions(), &hex("84 8c 02"));
        assert_eq!(decoder.instructions(), &hex("84 8c 02"));
        decoder.instructions().drain(..2);
        assert_eq!(show_on(&mut decoder, 16, "0500 80"), "[a=]");
        feed(&mut decoder, &hex("00")).unwrap();
        assert_eq!(drain(decoder.instructions()), hex("02 90 01"));
    }

    #[test]
    fn a_section_is_acknowledged_however_much_of_it_is_read() {
        let mut decoder = decoder_after("3fe11f 4161 00");
        let result = decoder.decode(4, &hex("0200 80"), &mut vec![]).map(drop);
        assert_eq!(result, Ok(()));
        assert_eq!(drain(decoder.instructions()), hex("84"));
    }

    #[test]
    fn numbers_of_every_width() {
        let mut decoder = decoder_after("3fe11f 4161 00");
        for stream_id in [0, 62, 63, 126, 127, 254, 255, 1 << 32, (1 << 62) - 1] {
            assert_eq!(show_on(&mut decoder, stream_id, "0200 80"), "[a=]");
            decoder.cancel_stream(stream_id);
            let number = stream_id as usize;
            let expected = [integer(0x80, 7, number), integer(0x40, 6, number)];
            assert_eq!(drain(decoder.instructions()), expected.concat());
        }
        for increment in [62, 63, 190, 191, 20_000] {
            feed(&mut decoder, &vec![0; increment]).unwrap();
            assert_eq!(drain(decoder.instructions()), integer(0x00, 6, increment));
        }
    }

    #[test]
    fn nothing_is_due_without_a_table() {
        let mut decoder = Decoder::new(0, 0);
        decoder.cancel_stream(0);
        assert_eq!(drain(decoder.instructions()), []);
    }
}

#[test]
fn the_decoder_agrees_with_the_model() {
    fn string(random: &mut Random, pattern: u8, prefix_bits: u32, max_len: usize) -> Vec<u8> {
        let text = random.text(max_len);
        random.pick(&[raw_with_prefix, literal_with_prefix])(pattern, prefix_bits, &text)
    }

    let mut random = Random(1);
    let (mut decoded, mut refused) = (0, 0);
    for _ in 0..400 {
        let max_capacity = random.pick(&[0, 40, 100, 300, 4096, 10_000]);
        let max_entries = max_capacity / 32;
        let max_len = random.pick(&[3, 20, 300]);
        let mut decoder = Decoder::new(max_capacity as u32, u32::MAX);
        let mut model = Model::new(max_capacity);
        let mut instructions = integer(0x20, 5, max_capacity);
        'connection: for _ in 0..60 {
            if random.below(100) == 0 {
                let at = random.below(instructions.len());
                instructions[at] ^= 1 << random.below(8);
            }
            for fragment in random.fragments(&instructions) {
                let expected = model.read_encoder_stream(fragment);
                assert_eq!(feed(&mut decoder, fragment), expected);
                if expected.is_err() {
                    break 'connection;
                }
            }
            let (count, len) = (model.entries.len(), model.table().len());
            assert_eq!(
                dynamic_table(&mut decoder, count, max_entries),
                model.table()
            );

            for _ in 0..5 {
                let required = (count + 1).saturating_sub(random.below(4)).min(count * 2);
                let base = (required + 2).saturating_sub(random.below(6));
                let mut section = prefix(required, base, max_entries.max(1));
                if required != 0 && random.below(10) != 0 {
                    section.extend(match (required - 1).checked_sub(base) {
                        Some(index) => integer(0x10, 4, index),
                        None => integer(0x80, 6, base - required),
                    });
                }
                for _ in 0..random.below(4) {
                    let (near, never) = (random.below(len.min(4) + 1), random.below(2) as u8);
                    let (head, has_value) = match random.below(7) {
                        0 => (integer(0xc0, 6, random.below(100)), false),
                        1 => (integer(0x80, 6, near), false),
                        2 => (integer(0x10, 4, near), false),
                        3 => (integer(0x50 | never << 5, 4, random.below(100)), true),
                        4 => (integer(0x40 | never << 5, 4, near), true),
                        5 => (integer(never << 3, 3, near), true),
                        _ => (string(&mut random, 0x20 | never << 4, 3, max_len), true),
                    };
                    section.extend(head);
                    if has_value {
                        section.extend(string(&mut random, 0x00, 7, max_len));
                    }
                }
                if random.below(10) == 0 {
                    let at = random.below(section.len());
                    section[at] ^= 1 << random.below(8);
                }
                let expected = match model.section(&section) {
                    Ok(section) if section.required_insert_count > count => Ok(None),
                    Ok(section) => {
                        let fields = section.fields.iter();
                        Ok(Some(fields.map(|it| field(&it.name, &it.value)).collect()))
                    }
                    Err(_) => Err(Error::DecompressionFailed),
                };
                *if expected.is_ok() {
                    &mut decoded
                } else {
                    &mut refused
                } += 1;
                assert_eq!(
                    decode(&mut decoder, 0, &section),
                    expected,
                    "{section:02x?}"
                );
                decoder.cancel_stream(0);
            }

            let room = model.capacity.saturating_sub(64) / 2;
            let value = string(&mut random, 0x00, 7, max_len.min(room));
            instructions = match random.below(20) {
                0 => integer(0x20, 5, random.below(max_capacity + 1)),
                1 => integer(0x20, 5, max_capacity),
                2..6 if len != 0 => integer(0x00, 5, random.below(len)),
                6..10 if len != 0 => [integer(0x80, 6, random.below(len)), value].concat(),
                10..14 => [integer(0xc0, 6, random.below(99)), value].concat(),
                _ => {
                    let name = [&b"n"[..], &random.text(max_len.min(room))].concat();
                    [literal_with_prefix(0x40, 5, &name), value].concat()
                }
            };
        }
    }
    assert!(decoded > 10_000 && refused > 10_000, "{decoded} {refused}");
}

mod encoder {
    use super::*;
    use Indexing::{Allowed, Never, Without};

    type Line<'a> = (&'a [u8], &'a [u8], Indexing);

    /// Returns the instructions that are due and the section.
    fn encode_lines(
        encoder: &mut Encoder,
        stream_id: u64,
        credit: usize,
        lines: &[Line<'_>],
    ) -> (Vec<u8>, Vec<u8>) {
        let mut out = b"head".to_vec();
        let mut section = encoder.section(stream_id, &mut out, credit);
        for &(name, value, indexing) in lines {
            section.field(name, None, value, indexing);
        }
        let start = section.finish();
        assert!(start >= 4 && out.starts_with(b"head"));
        (drain(encoder.instructions()), out.split_off(start))
    }

    /// Takes `a=b !never=indexed ?not=indexed`.
    fn encode_with_credit(
        encoder: &mut Encoder,
        stream_id: u64,
        credit: usize,
        fields: &str,
    ) -> (Vec<u8>, Vec<u8>) {
        let lines = fields.split_whitespace().map(|text| {
            let (indexing, text) = match text.as_bytes() {
                [b'!', rest @ ..] => (Never, rest),
                [b'?', rest @ ..] => (Without, rest),
                all => (Allowed, all),
            };
            let name_len = text.iter().take_while(|&&byte| byte != b'=').count();
            (&text[..name_len], &text[name_len + 1..], indexing)
        });
        encode_lines(encoder, stream_id, credit, &Vec::from_iter(lines))
    }

    fn encode(encoder: &mut Encoder, stream_id: u64, fields: &str) -> (Vec<u8>, Vec<u8>) {
        encode_with_credit(encoder, stream_id, usize::MAX, fields)
    }

    fn encoder_with(max_capacity: u64, max_blocked_streams: u64) -> Encoder {
        let mut encoder = Encoder::new();
        encoder.use_dynamic_table(max_capacity, max_blocked_streams);
        encoder.instructions().clear();
        encoder
    }

    /// With four entries of 34 bytes, from sections on the streams 100 to 103.
    fn encoder_with_entries(max_capacity: u64, max_blocked_streams: u64) -> Encoder {
        let mut encoder = encoder_with(max_capacity, max_blocked_streams);
        for (stream_id, field) in (100..).zip(["~=~", "^=^", "$=$", "{={"]) {
            encode(&mut encoder, stream_id, field);
            encoder.read_decoder_stream(&hex("01")).unwrap();
        }
        encoder
    }

    /// Step `n` is on stream `n`: what the decoder has sent, the fields, the instructions and the section to expect.
    #[track_caller]
    fn check(mut encoder: Encoder, steps: &[(&str, &str, &str, &str)]) {
        for (stream_id, (received, fields, instructions, section)) in (0..).zip(steps) {
            encoder.read_decoder_stream(&hex(received)).unwrap();
            let actual = encode(&mut encoder, stream_id, fields);
            let expected = (hex(instructions), hex(section));
            assert!(actual == expected, "step {stream_id}: {actual:02x?}");
        }
    }

    #[test]
    fn static_entries() {
        for (index, (name, value)) in static_table().enumerate() {
            let first = static_table().position(|entry| entry.0 == name).unwrap();
            let never = [integer(0x70, 4, first), literal(value)].concat();
            let other = [integer(0x50, 4, first), raw(b"~")].concat();
            for (value, indexing, expected) in [
                (value, Allowed, integer(0xc0, 6, index)),
                (value, Without, integer(0xc0, 6, index)),
                (value, Never, never),
                (b"~", Allowed, other),
            ] {
                let expected = [hex("0000"), expected].concat();
                let lines = [(name, value, indexing)];
                let actual = encode_lines(&mut Encoder::new(), 0, usize::MAX, &lines);
                assert_eq!(actual, (vec![], expected.clone()));
                let hints = static_table().zip(0..).filter(|(entry, _)| entry.0 == name);
                for (_, hint) in hints {
                    let (mut encoder, mut out) = (Encoder::new(), vec![]);
                    let mut section = encoder.section(0, &mut out, 0);
                    section.field(b"", Some(hint), value, indexing);
                    let start = section.finish();
                    assert_eq!(out[start..], expected);
                }
            }

            let (mut encoder, mut out) = (encoder_with(4096, 1), vec![]);
            let mut section = encoder.section(0, &mut out, usize::MAX);
            section.field(b"", Some(index as u8), b"~", Allowed);
            section.field(name, None, b"~", Allowed);
            section.field(name, None, value, Allowed);
            let start = section.finish();
            let expected = [hex("0280 10 10"), integer(0xc0, 6, index)].concat();
            assert_eq!(out[start..], expected);
            let expected = [integer(0xc0, 6, first), raw(b"~")].concat();
            assert_eq!(drain(encoder.instructions()), expected);
        }
    }

    #[test]
    fn hints_out_of_range_are_ignored() {
        for hint in 99..=255 {
            let (mut encoder, mut out) = (Encoder::new(), vec![]);
            let mut section = encoder.section(0, &mut out, 0);
            section.field(b"age", Some(hint), b"0", Allowed);
            section.field(b"~", Some(hint), b"~", Allowed);
            let start = section.finish();
            assert_eq!(out[start..], hex("0000 c2 217e 017e"));
        }
    }

    #[test]
    fn names_that_resemble_static_ones() {
        for (name, value) in static_table() {
            let mut similar = vec![
                name[1..].to_vec(),
                name[..name.len() - 1].to_vec(),
                [name, b"\0"].concat(),
                [name, &[b'-'; 256 - 2], &name[name.len() - 2..]].concat(),
                name.to_ascii_uppercase(),
                vec![],
                vec![name[0]],
            ];
            for at in 0..name.len() {
                similar.push(name.to_vec());
                similar.last_mut().unwrap()[at] ^= 0x10;
            }
            for name in similar {
                for (indexing, pattern) in [(Allowed, 0x20), (Never, 0x30)] {
                    let lines = [(&name[..], value, indexing)];
                    let (_, section) = encode_lines(&mut Encoder::new(), 0, 0, &lines);
                    let name = literal_with_prefix(pattern, 3, &name);
                    assert_eq!(section, [hex("0000"), name, literal(value)].concat());
                }
            }
        }
    }

    #[test]
    fn values_that_resemble_static_ones() {
        for (name, value) in static_table() {
            let first = static_table().position(|entry| entry.0 == name).unwrap();
            let mut similar = vec![[value, b"\0"].concat(), vec![], b"*/".to_vec()];
            similar.extend(static_table().map(|entry| entry.1.to_vec()));
            for at in 0..value.len() {
                similar.push(value[..at].to_vec());
                similar.push(value.to_vec());
                similar.last_mut().unwrap()[at] ^= 0x20;
            }
            similar.retain(|value| !static_table().any(|entry| entry == (name, value)));
            for value in similar {
                let lines = [(name, &value[..], Allowed)];
                let (_, section) = encode_lines(&mut Encoder::new(), 0, 0, &lines);
                let expected = [hex("0000"), integer(0x50, 4, first), literal(&value)];
                assert_eq!(section, expected.concat());
            }
        }
    }

    #[test]
    fn lengths_of_every_width() {
        for len in (0..300).chain([16_390, 16_391, 16_414, 16_415, 16_510, 16_511, 200_000]) {
            for text in [vec![b'~'; len], vec![b'0'; len]] {
                let lines = [(&text[..], &text[..], Allowed)];
                let (_, section) = encode_lines(&mut Encoder::new(), 0, 0, &lines);
                let name = literal_with_prefix(0x20, 3, &text);
                let plain = [hex("0000"), name, literal(&text)].concat();
                assert_eq!(section, plain);

                let name = literal_with_prefix(0x40, 5, &text);
                let expected = match len {
                    ..=2032 => ([name, literal(&text)].concat(), hex("0280 10")),
                    _ => (vec![], plain),
                };
                let mut encoder = encoder_with(4096, 1);
                for _ in 0..if len > 4064 { 3 } else { 1 } {
                    assert_eq!(encode_lines(&mut encoder, 0, usize::MAX, &lines), expected);
                }
            }
        }
    }

    #[test]
    fn capacity() {
        for (max_capacity, expected) in [
            (0, ""),
            (31, ""),
            (32, "3f01"),
            (220, "3fbd01"),
            (4096, "3fe11f"),
            (4097, "3fe11f"),
            (1 << 32, "3fe11f"),
            ((1 << 62) - 1, "3fe11f"),
        ] {
            let mut encoder = Encoder::new();
            assert_eq!(
                encode(&mut encoder, 0, "~=~"),
                (vec![], hex("0000 217e 017e"))
            );
            encoder.use_dynamic_table(max_capacity, 100);
            assert_eq!(drain(encoder.instructions()), hex(expected));
        }
        let mut encoder = encoder_with(34, 1);
        encoder.use_dynamic_table(4096, 100);
        let fields = "~=~ ^=^";
        let expected = (hex("417e 017e"), hex("0280 10 215e 015e"));
        assert_eq!(encode(&mut encoder, 0, fields), expected);
        check(encoder_with(32, 9), &[("", "=", "40 00", "0280 10")]);
        check(encoder_with(33, 9), &[("", "~=~", "", "0000 217e 017e")]);
        check(encoder_with(34, 9), &[("", "~=~", "417e 017e", "0280 10")]);
    }

    #[test]
    fn inserts_new_names_and_repeated_fields() {
        check(
            encoder_with(4096, 100),
            &[
                ("", ":path=~ ~=~", "c1017e 417e017e", "0381 10 11"),
                ("", ":path=~ ~=~", "", "0300 81 80"),
                ("", ":path=^ ~=^", "", "0300 51015e 40015e"),
                ("", ":path=^ ~=^", "c1015e 81015e", "0581 10 11"),
                ("", ":path=~", "", "0203 83"),
                ("", "^=^ ^=~ ~=$", "415e015e", "0680 10 00017e 400124"),
                ("", "", "", "0000"),
            ],
        );
    }

    #[test]
    fn indexing() {
        check(
            encoder_with(4096, 100),
            &[
                ("", "!age=^ !age=^ ?age=^", "", "0000 72015e 72015e 52015e"),
                ("", "?age=^ ?age=0 !age=0", "", "0000 52015e c2 728107"),
                ("", "~=^ ~=$", "417e015e", "0280 10 000124"),
                ("", "!~=^ ?~=^ ~=^", "", "0200 317e015e 217e015e 80"),
                ("", "?$=^ ?$=^ ?$=", "", "0000 2124015e 2124015e 212400"),
                ("", "!{=^ !{=^ !{=", "", "0000 317b015e 317b015e 317b00"),
            ],
        );
    }

    #[test]
    fn waits_for_acknowledgments_if_it_may_not_block() {
        check(
            encoder_with(4096, 0),
            &[
                ("", "age=~", "", "0000 52017e"),
                ("", "age=~", "c2017e", "0000 52017e"),
                ("", "age=~", "", "0000 52017e"),
                ("01", "age=~", "", "0200 80"),
                ("", "~=^", "", "0000 217e 015e"),
                ("", "~=$", "417e00", "0000 217e 0124"),
                ("", "~={", "", "0000 217e 017b"),
                ("01", "~=}", "", "0300 40 017d"),
                ("", "~=}", "80017d", "0300 40 017d"),
                ("01", "~=}", "", "0400 80"),
            ],
        );
    }

    #[test]
    fn blocked_streams() {
        for (allowed, limit) in [(1, 1), (7, 7), (100, 100), (101, 100), ((1 << 62) - 1, 100)] {
            let mut encoder = encoder_with(4096, allowed);
            assert_eq!(encode(&mut encoder, 0, "~=~").1, hex("0280 10"));
            for stream_id in 1..limit {
                assert_eq!(encode(&mut encoder, stream_id, "~=~").1, hex("0200 80"));
            }
            assert_eq!(encode(&mut encoder, 200, "~=~").1, hex("0000 217e 017e"));
            encoder.read_decoder_stream(&hex("40")).unwrap();
            assert_eq!(encode(&mut encoder, 201, "~=~").1, hex("0200 80"));
            assert_eq!(encode(&mut encoder, 202, "~=~").1, hex("0000 217e 017e"));
            encoder.read_decoder_stream(&hex("01")).unwrap();
            assert_eq!(encode(&mut encoder, 203, "^=^").1, hex("0380 10"));
        }
    }

    #[test]
    fn unacknowledged_sections_are_limited() {
        let mut encoder = encoder_with(4096, 1);
        encode(&mut encoder, 0, "~=~");
        encoder.read_decoder_stream(&hex("01")).unwrap();
        for stream_id in 1..128 {
            assert_eq!(encode(&mut encoder, stream_id, "~=~").1, hex("0200 80"));
        }
        for stream_id in 128..130 {
            let expected = (vec![], hex("0000 217e 017e 215e 015e"));
            assert_eq!(encode(&mut encoder, stream_id, "~=~ ^=^"), expected);
        }
        encoder.read_decoder_stream(&hex("85")).unwrap();
        assert_eq!(encode(&mut encoder, 130, "~=~").1, hex("0200 80"));
    }

    #[test]
    fn credit() {
        let mut encoder = Encoder::new();
        encoder.use_dynamic_table(4096, 100);
        let expected = (hex("3fe11f"), hex("0000 217e 017e"));
        assert_eq!(encode_with_credit(&mut encoder, 0, 36, "~=~"), expected);
        let expected = (hex("415e 015e"), hex("0280 10 2124 0124"));
        assert_eq!(encode_with_credit(&mut encoder, 1, 37, "^=^ $=$"), expected);
        let expected = (vec![], hex("0200 80 40 017e"));
        assert_eq!(encode_with_credit(&mut encoder, 2, 0, "^=^ ^=~"), expected);
        let expected = (hex("417b 017b 417d 017d"), hex("0481 10 11"));
        assert_eq!(encode_with_credit(&mut encoder, 3, 38, "{={ }=}"), expected);

        let mut encoder = encoder_with_entries(170, 100);
        let expected = (vec![], hex("0203 83"));
        assert_eq!(encode_with_credit(&mut encoder, 1, 2, "~=~"), expected);
        let expected = (hex("03"), hex("0680 10"));
        assert_eq!(encode_with_credit(&mut encoder, 2, 3, "~=~"), expected);
    }

    #[test]
    fn evicts_only_what_the_decoder_is_done_with() {
        // Two entries fit.
        let fill = ("", "age=~ date=^^", "c2017e c6025e5e", "0381 10 11");
        let see = ("", "link={", "", "0000 5b017b");
        let add = |received| (received, "link={", "cb017b", "0480 10");
        let refuse = |received| (received, "link={", "", "0000 5b017b");
        check(encoder_with(100, 9), &[fill, see, add("80")]);
        check(encoder_with(100, 9), &[fill, see, refuse("02"), add("80")]);
        check(encoder_with(100, 9), &[fill, see, refuse("02"), add("40")]);
        check(encoder_with(100, 9), &[fill, see, refuse("40"), add("01")]);
        let refer = ("80", "age=~ link={", "01", "0480 10 5b017b");
        check(encoder_with(100, 9), &[fill, see, refer]);
        let refer = ("80", "date=^^ link={", "cb017b", "0480 80 10");
        check(encoder_with(100, 9), &[fill, see, refer]);

        // One does.
        let fill = ("", "~=~", "417e017e", "0280 10");
        let add = ("80", "age=^ age=^", "c2015e", "0380 52015e 10");
        check(encoder_with(68, 9), &[fill, add]);
        let refer = ("80", "~=~ age=^ age=^", "", "0200 80 52015e 52015e");
        check(encoder_with(68, 9), &[fill, refer]);
    }

    #[test]
    fn renews_draining_entries() {
        for (field, instructions, section) in [
            ("^=^", "", "0302 82"),
            ("~=~", "03", "0680 10"),
            ("~=$", "8300", "0680 00 0124"),
        ] {
            let steps = [("", field, instructions, section)];
            check(encoder_with_entries(204, 9), &steps);
        }
        check(
            encoder_with_entries(204, 9),
            &[
                ("", "~=~", "03", "0680 10"),
                ("", "~=~ ^=^", "", "0600 80 83"),
            ],
        );
        check(
            encoder_with_entries(204, 9),
            &[
                ("", "~=$", "8300", "0680 00 0124"),
                ("", "~=^", "", "0600 40 015e"),
                ("", "~=", "", "0600 80"),
            ],
        );
        let block = ("e4e5e6e7", "|=|", "417c017c", "0680 10");
        check(
            encoder_with_entries(170, 1),
            &[
                block,
                ("", "^=^", "03", "0303 83"),
                ("", "^=^", "", "0304 84"),
                ("02", "^=^", "", "0700 80"),
            ],
        );
        check(
            encoder_with_entries(170, 1),
            &[
                block,
                ("", "^=}", "8300", "0303 43017d"),
                ("", "^={", "", "0304 44017b"),
                ("02", "^=$", "", "0700 400124"),
            ],
        );
        let oldest = ("", "~=~ ~=}", "", "0204 84 44017d");
        check(encoder_with_entries(170, 1), &[block, oldest]);
    }

    /// A quarter of the table, or three times the latest addition.
    #[test]
    fn keeps_room_to_renew_entries() {
        for (max_capacity, count, is_draining) in [
            (237, 4, true),
            (238, 4, false),
            (497, 11, true),
            (498, 11, false),
            (100, 1, false),
        ] {
            let mut encoder = encoder_with(max_capacity, 9);
            let fields = (b'a'..)
                .take(count)
                .map(|name| format!("{}=~", char::from(name)));
            encode(&mut encoder, 0, &Vec::from_iter(fields).join(" "));
            let (instructions, _) = encode(&mut encoder, 4, "a=~");
            assert_eq!(!instructions.is_empty(), is_draining, "{max_capacity}");
        }
    }

    #[test]
    fn required_insert_counts_wrap_around() {
        for max_capacity in [40, 64, 100, 4096, 4097, 8192, 1 << 20, (1 << 62) - 1] {
            let (mut encoder, mut count) = (encoder_with(max_capacity, 1), 0);
            for number in 0..70_000 {
                let value = number.to_string();
                let lines = [(&b"age"[..], value.as_bytes(), Allowed); 2];
                let (instructions, section) = encode_lines(&mut encoder, 0, usize::MAX, &lines);
                // The odd value is mistaken for another.
                if instructions.is_empty() {
                    continue;
                }
                count += 1;
                let expected = prefix(count, count - 1, max_capacity as usize / 32);
                assert_eq!(section[..expected.len()], expected);
                assert_eq!(section.last(), Some(&0x10));
                encoder.read_decoder_stream(&hex("80")).unwrap();
            }
            assert!(count > 69_900, "{count}");
        }
    }

    #[test]
    fn an_unfinished_section_leaves_nothing_to_acknowledge() {
        let mut encoder = encoder_with(4096, 1);
        let mut out = vec![];
        encoder
            .section(0, &mut out, 99)
            .field(b"~", None, b"~", Allowed);
        let expected = (hex("417e 017e"), hex("0200 80"));
        assert_eq!(encode(&mut encoder, 4, "~=~"), expected);
        let result = encoder.read_decoder_stream(&hex("80"));
        assert_eq!(result, Err(Error::DecoderStream));
    }

    #[test]
    fn decoder_stream() {
        let last_stream = (1 << 62) - 1;
        for (instructions, is_valid) in [
            ("", true),
            ("80", true),
            ("84 84 80 88", true),
            ("ff 80ffffffffffffff3f", true),
            ("ff 80ffffffffffffff3f ff 80ffffffffffffff3f", false),
            ("ff 81ffffffffffffff3f", false),
            ("80 80", false),
            ("84 84 84", false),
            ("81", false),
            ("8c", false),
            ("ff 00", false),
            ("40 40 41 7f00 7f c0ffffffffffffff3f", true),
            ("7f c1ffffffffffffff3f", false),
            ("7f 808080808080808000", true),
            ("7f 808080808080808080", false),
            ("40 80", false),
            ("44 84", false),
            ("44 80 88", true),
            ("84 44 84", false),
            ("00", false),
            ("04", true),
            ("05", false),
            ("01 01 01 01", true),
            ("01 01 01 01 01", false),
            ("04 80 84 84 88", true),
            ("80 03", true),
            ("80 04", false),
            ("84 02", true),
            ("84 03", false),
            ("84 84 01", true),
            ("84 84 02", false),
            ("84 84 80 02", false),
            ("88 01", false),
            ("44 04", true),
            ("3f 00", false),
            ("3f c5ffffff0f", false),
        ] {
            let instructions = hex(instructions);
            for fragment_len in [1, 2, 3, 100] {
                let mut encoder = encoder_with(4096, 100);
                for (stream_id, fields) in [
                    (last_stream, "a=0"),
                    (4, "b=1"),
                    (0, "a=0"),
                    (4, "c=2"),
                    (8, "d=3"),
                    (12, "age=0"),
                ] {
                    encode(&mut encoder, stream_id, fields);
                }
                let mut fragments = instructions.chunks(fragment_len);
                let result = fragments.try_for_each(|bytes| encoder.read_decoder_stream(bytes));
                let expected = is_valid.then_some(()).ok_or(Error::DecoderStream);
                assert_eq!(result, expected, "{instructions:02x?}");
            }
        }
    }

    #[test]
    fn decoder_stream_without_a_table() {
        for (instructions, is_valid) in [
            ("40 7f00", true),
            ("7f", true),
            ("80", false),
            ("00", false),
            ("01", false),
            ("3f00", false),
        ] {
            let result = Encoder::new().read_decoder_stream(&hex(instructions));
            assert_eq!(result, is_valid.then_some(()).ok_or(Error::DecoderStream));
        }
    }

    #[test]
    fn repeated_requests_take_a_byte_per_field() {
        let mut encoder = encoder_with(4096, 100);
        let names = Vec::from_iter((0..60).map(|number| format!("x-{number}=value")));
        encode(&mut encoder, 0, &names.join(" "));
        let (instructions, section) = encode(&mut encoder, 4, &names.join(" "));
        assert_eq!((instructions.len(), section.len()), (0, 62));
    }

    #[test]
    fn many_entries_after_the_base() {
        let names = Vec::from_iter((0..100).map(|number| format!("{number}= {number}=~")));
        let (_, section) = encode(&mut encoder_with(4096, 1), 0, &names.join(" "));
        let lines = (0..100).map(|at| [integer(0x10, 4, at), integer(0x00, 3, at), raw(b"~")]);
        let lines = lines.flatten().flatten().collect();
        assert_eq!(section, [prefix(100, 0, 128), lines].concat());
    }

    #[test]
    fn remembers_as_many_fields_as_a_table_can_have() {
        for (others, is_remembered) in [(127, true), (128, false)] {
            let mut encoder = encoder_with(4096, 0);
            let others = Vec::from_iter((0..others).map(|number| format!("age=-{number}")));
            encode(&mut encoder, 0, &format!("age=~ {}", others.join(" ")));
            let (instructions, _) = encode(&mut encoder, 4, "age=~");
            assert_eq!(!instructions.is_empty(), is_remembered);
        }
    }

    /// Returns the bytes sent for each of 1000 requests. `a=9~5` is a field of 9 bytes that change every 5 requests.
    fn traffic(text: &str, capacity: u32, max_blocked: u32) -> Vec<usize> {
        let items = Vec::from_iter(text.split_whitespace().map(|item| {
            let mut numbers = BTreeMap::from([(b'~', 1000), (b'!', 999), (b'<', 1000)]);
            numbers.extend(b"*#/".map(|symbol| (symbol, 1)));
            numbers.extend(b"+>%".map(|symbol| (symbol, 0)));
            for part in item.as_bytes()[1..].chunk_by(|_, next| next.is_ascii_digit()) {
                let number = str::from_utf8(&part[1..]).unwrap().parse().unwrap();
                numbers.insert(part[0], number);
            }
            (item.as_bytes()[0], numbers)
        }));
        let (mut encoder, mut decoder) = (Encoder::new(), Decoder::new(capacity, max_blocked));
        encoder.use_dynamic_table(capacity.into(), max_blocked.into());
        feed(&mut decoder, &drain(encoder.instructions())).unwrap();
        let (mut under_way, mut unread, mut lens) = (VecDeque::<Vec<u8>>::new(), None, vec![]);
        for at in 0..1000 {
            let (mut fields, mut max_under_way) = (vec![], 0);
            let (mut credit, mut is_held) = (usize::MAX, false);
            for (kind, numbers) in &items {
                let [period, last_change, lines, names, more_name_len] =
                    b"~!*#%".map(|symbol| numbers[&symbol]);
                let [every, first, from, to] = b"/+><".map(|symbol| numbers[&symbol]);
                match kind {
                    _ if !(from..to).contains(&at) => {}
                    b'^' => max_under_way = numbers[&b'='],
                    b'$' => is_held = true,
                    b'-' => credit = 0,
                    _ => fields.extend((0..lines * names).filter_map(|line| {
                        let name = line % names;
                        let version = match period {
                            1 => 100 * at + line,
                            _ => at.min(last_change) / period,
                        };
                        let value = "~".repeat(numbers[&b'=']) + &version.to_string();
                        let value = &value[value.len() - numbers[&b'=']..];
                        let more = "~".repeat(more_name_len);
                        (at % every == (first + name) % every).then(|| match kind {
                            b'p' => field(":path", value),
                            _ => field(format!("x-{}{name}{more}", *kind as char), value),
                        })
                    })),
                }
            }
            for due in under_way.drain(..under_way.len().saturating_sub(max_under_way)) {
                encoder.read_decoder_stream(&due).unwrap();
            }
            let stream_id = at as u64;
            let lines = fields
                .iter()
                .map(|it| (&it.name[..], &it.value[..], Allowed));
            let (instructions, section) =
                encode_lines(&mut encoder, stream_id, credit, &Vec::from_iter(lines));
            lens.push(instructions.len() + section.len());
            feed(&mut decoder, &instructions).unwrap();
            let mut read = Vec::from_iter(unread.take_if(|_| !is_held));
            if is_held && unread.is_none() {
                unread = Some((stream_id, section, fields));
            } else {
                read.push((stream_id, section, fields));
            }
            for (stream_id, section, fields) in read {
                assert_eq!(decode(&mut decoder, stream_id, &section), Ok(Some(fields)));
            }
            under_way.push_back(drain(decoder.instructions()));
        }
        lens
    }

    #[test]
    fn makes_room_step_by_step() {
        #[rustfmt::skip]
        let cases: &[(&str, u32, u32, &[usize])] = &[
            // An entry is let go once twice as much has been missed as that takes.
            ("a=1 b=1<1 c=1<1 d=1<1 l=74>1 ^=1", 160, 9, &[30, 82, 82, 82, 82, 87, 84, 4, 4]),
            ("a=1 b=1<1 c=1<1 d=1<1 l=75>1 ^=1", 160, 9, &[30, 83, 83, 83, 88, 85, 4, 4, 4]),
            ("a=1 b=1<1 c=1<1 d=1<1 l=72>1 ^=2", 160, 9,
                &[30, 80, 80, 80, 80, 80, 85, 85, 82, 4, 4]),
            ("a=1 b=1<2 c=1<2 d=1<2 l=72>4 ^=1", 160, 0,
                &[26, 50, 8, 3, 80, 80, 80, 80, 80, 80, 85, 163, 85, 4, 4, 4]),
            ("a=1 b=1<2 c=1<2 d=1<2 l=72>4", 160, 0, &[26, 50, 3, 3, 80, 80, 80, 80, 163, 4, 4, 4]),
            // It is repeated without that if there is room, or if no section refers to it.
            ("a=1 l=40>3 ^=1", 160, 0, &[8, 14, 8, 48, 93, 49, 4, 4]),
            ("a=1 b=1<1 c=1<1 d=1<1 l=72>1", 160, 9, &[30, 81, 81, 5, 4, 4]),
            ("l=72>1 a=1 b=1<1 c=1<1 d=1<1", 160, 9, &[30, 81, 82, 4, 4, 4]),
            // What saves two thirds as much or less makes way, unless it may be used more often.
            ("a=1 b=1 c=1 d=1 l=60>1", 160, 9, &[30, 74, 71, 71, 87, 23, 22, 22]),
            ("a=1 b=1 c=1 d=1 l=60*2>1", 160, 9, &[30, 139, 137, 88, 24, 23]),
            ("a=28 b=28 l=60>1", 160, 9, &[70, 70, 69, 69, 69, 69, 102, 38]),
            ("a=29 b=29 l=60>1", 160, 9, &[72, 70, 69, 69, 69, 69, 69, 69]),
            ("a=1 b=1 c=1 d=1 l=60/3+1", 160, 9, &[30, 74, 6, 6, 71, 6, 6, 71, 6, 6, 71, 6]),
            // There is no use in letting go of what a section refers to that is long overdue.
            ("a=1 b=1<1 c=1<1 d=1<1 l=75>4 ^=2 $>2<999", 160, 9,
                &[30, 3, 3, 3, 83, 83, 83, 83, 83, 88, 88, 88]),
            ("a=1 b=1<1 c=1<1 d=1<1 l=75>5 ^=2 $>2<999", 160, 9,
                &[30, 3, 3, 3, 3, 83, 83, 83, 83, 83, 83, 83]),
            ("a=1<5 a=1>6 b=1<1 c=1<1 d=1<1 d=1>5<6 l=50>14 ^=2 $>5<999", 160, 9,
                &[30, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 58, 58, 58, 58, 58, 58, 58, 63, 63, 60, 4, 4]),
            ("a=40 b=1<1 c=1<1 d=1<1 l=80>1 ^=1 $>3<14", 200, 9,
                &[69, 88, 88, 88, 88, 132, 132, 132, 132, 132, 88, 88, 88, 88, 88, 88, 88, 88, 88, 88, 132, 90, 4, 4]),
        ];
        for &(text, capacity, max_blocked, expected) in cases {
            let lens = traffic(text, capacity, max_blocked);
            assert_eq!(lens[..expected.len()], *expected, "{text} {capacity}");
        }
    }

    /// With the most bytes for the average request and for one of the last 100, without and with blocked streams.
    #[test]
    fn follows_the_traffic() {
        #[rustfmt::skip]
        let cases = [
            // Values change while others stay.
            ("i=5~1 t=2000~100 e=1 ^=10", [(452, 472), (229, 251)]),
            ("i=5~1 t=3600~100 e=1 ^=8", [(753, 696), (328, 371)]),
            ("a=1300 b=700~500 c=200 d=1300 ^=2", [(50, 6), (22, 6)]),
            ("a=1000 b=3000~500", [(33, 4), (15, 4)]),
            ("a=700*2 b=3000~300!300 ^=2", [(66, 5), (30, 5)]),
            ("t=8~1*30 b=3000~300!300 c=800 ^=2", [(353, 314), (328, 314)]),
            ("s=50~100#30 ^=8", [(307, 317), (111, 118)]),
            ("s=50~100#40 ^=8", [(616, 550), (326, 355)]),
            ("a=107 b=634~26 c=296 d=559 e=530 ^=1", [(113, 110), (58, 59)]),
            // Values that do not last are not worth much.
            ("a=200~2 b=3600 c=1 ^=2", [(229, 210), (214, 210)]),
            ("a=200~3 b=3600 c=1 ^=2", [(247, 210), (243, 210)]),
            ("a=200~20 b=3600 c=1 ^=2", [(287, 370), (246, 254)]),
            ("a=200~3 b=3600/3", [(248, 245), (143, 140)]),
            ("a=200~3 b=3600/4 ^=1", [(258, 247), (194, 191)]),
            ("a=2000 b=2000 c=10>100 ^=1", [(34, 19), (22, 19)]),
            ("a=1000 b=2900 c=700>100<102", [(18, 4), (10, 4)]),
            ("c=700>100<102 a=1000 b=2900", [(18, 4), (10, 4)]),
            // Fields come and go.
            ("a=1300 b=700~500>498<528 c=200 d=1300 ^=2", [(42, 5), (33, 5)]),
            ("a=1300 b=700~500>498<560 c=200 d=1300 ^=2 ^=50>480 ^=0>560", [(64, 5), (51, 5)]),
            ("a=700>567<592 b=1000 c=3000", [(34, 4), (26, 4)]),
            ("a=50 b=3370>159<161 c=1544>341 ^=20", [(51, 4), (11, 4)]),
            ("y=700 z=1 s=50#40>20<24 r=50#3>40<45 ^=8", [(24, 4), (9, 4)]),
            ("a=700~2 p=3000>532 ^=2", [(927, 710), (720, 710)]),
            ("a=700 b=2000*3 c=2000<400 ^=4", [(555, 6), (451, 6)]),
            ("a=700 b=1000*5 c=2900<400 ^=4", [(2132, 8), (469, 8)]),
            ("b=4000<10 s=30#20>10", [(39, 22), (30, 22)]),
            ("x=600>500 a=1300 c=900 d=1300 e=300<10 ->480<520", [(319, 609), (311, 609)]),
            // Names are worth something too.
            ("s=40#10%20 u=8~1#10%20 d=80#18<50%20 n=8~1#10>100%20 ^=2", [(237, 220), (233, 220)]),
            ("b=700/3+2 c=5~2#3%1000 ^=8", [(292, 257), (28, 24)]),
            ("n=5~2#14%30 b=3000 ^=8", [(140, 101), (105, 101)]),
            ("n=1%4100 c=3000~100", [(4203, 4203), (4170, 4173)]),
            ("a=4100#2<100%1900 b=4100#2>100%1900", [(8470, 8210), (8523, 8210)]),
            // Not everything fits.
            ("a=1800 b=2800/2+1 ^=2", [(1415, 1405), (1407, 1405)]),
            ("b=2500 k=1600#8/8 c=1000~10", [(2864, 2866), (1818, 1816)]),
            ("s=30#90 ^=4", [(1122, 1107), (1110, 1107)]),
            ("s=30#24 b=3000>100 ^=2", [(337, 330), (320, 330)]),
            ("s=30#58 b=3000>100 ^=2", [(1458, 1558), (1431, 1558)]),
            ("s=30#9 b=1500 w=2200>100 ^=2", [(215, 180), (186, 180)]),
            ("s=30#24 b=3000/5", [(347, 330), (341, 330)]),
            ("a=2000#3/3 ^=2", [(684, 665), (676, 665)]),
            ("a=1000 b=1000 c=1000 m=1400>1 l=1400*8>1", [(2076, 2020), (2045, 2020)]),
            // There are several kinds of request.
            ("a=200~100!500 b=3600/2+1 ^=8", [(142, 4), (104, 4)]),
            ("a=2000#2/3 c=10~300/3+2 ^=2", [(20, 8), (12, 8)]),
            ("s=64#6 k=64#24/2 b=1500>100 l=100>400 ^=8", [(372, 297), (300, 258)]),
            ("s=64#6 k=64#24/3 b=1500>100 l=100>400 ^=8", [(264, 159), (244, 176)]),
            ("s=64#6 k=64#24/6 b=1500/3>100 l=100>400 ^=8", [(183, 95), (133, 84)]),
            ("s=64#6 k=64#24/8 b=1500/4>100 l=100>400 ^=10", [(127, 72), (93, 72)]),
            ("k=1000#3/3 b=1500>100 l=100>400 ^=2", [(336, 347), (321, 347)]),
            ("k=1300#3/3 b=600>100 l=60>400 ^=3", [(600, 669), (588, 669)]),
            ("s=100#14 a=700<300 b=700~150!150<300 c=390/5>300 d=320>300 e=250>300 ^=3", [(72, 19), (41, 19)]),
            ("a=1500/4 z=2000<50 b=2200>100 ^=8", [(58, 4), (43, 4)]),
            ("a=1/2 b=500~4/2 c=3000>100 ^=12", [(354, 257), (299, 257)]),
            ("a=1/4 b=700~8/3+1 c=3000>100 ^=30", [(529, 236), (328, 236)]),
            ("a=1#2/3 p=300~9/3 c=3500>100 ^=4", [(165, 108), (133, 245)]),
            ("s=64#6 k=64#24/3 b=1500/3>100 ^=2", [(143, 134), (130, 133)]),
            ("a=900 b=1220/5+3 c=830/5 d=36", [(14, 5), (9, 5)]),
            // The peer holds something back.
            ("u=120 a=450#2 p=12~3 ^=2 $>50<999", [(25, 19), (20, 19)]),
            ("a=1100 u=120 p=200~4 ^=2 $>50<999", [(216, 207), (204, 207)]),
            ("a=1100 u=120 p=200~4 $>50<999", [(209, 207), (201, 207)]),
            ("a=1100 u=120 p=200~4 ^=2 $>50<700", [(231, 281), (198, 185)]),
            ("a=1300 b=700~500 c=200 d=1300 ^=2 ->510", [(376, 709), (362, 709)]),
            ("a=1300 b=700~500 c=200 d=1300 ^=2 ->511<600", [(113, 6), (93, 6)]),
            ("a=1500 b=2000<50 c=2200>100 ^=1 $>102<999", [(2001, 2207), (1997, 2207)]),
        ];
        for (text, limits) in cases {
            for (max_blocked, limit) in [0, 100].into_iter().zip(limits) {
                let lens = traffic(text, 4096, max_blocked);
                let mean = |lens: &[usize]| lens.iter().sum::<usize>().div_ceil(lens.len());
                let actual = (mean(&lens), mean(&lens[900..]));
                let is_within = actual.0 <= limit.0 && actual.1 <= limit.1;
                assert!(is_within, "{text} {max_blocked}: {actual:?}");
            }
        }
    }

    #[test]
    fn busy_connections_settle() {
        let lens = traffic("i=5~1 t=2000~100 e=1 ^=10", 4096, 100);
        for period in lens.chunks(100) {
            assert!(period[30..].iter().all(|&len| len < 12), "{period:?}");
        }
    }

    /// What the encoder has to know of its peer.
    #[derive(Default)]
    struct Knowledge {
        received_count: usize,
        /// By stream.
        unacknowledged: BTreeMap<u64, VecDeque<Section>>,
    }

    #[test]
    fn keeps_its_obligations() {
        let mut random = Random(2);
        let (mut references, mut evictions) = (0, 0);
        for _ in 0..400 {
            let max_capacity = random.pick(&[32, 64, 100, 300, 1000, 4096, 100_000]);
            let max_blocked = random.pick(&[0, 1, 3, 100]);
            let (max_len, patience) = (random.pick(&[2, 30, 400]), random.pick(&[1, 5, 50, 1000]));
            let mut names = Vec::from_iter((0..random.pick(&[2, 20, 100])).map(|_| {
                let name = [&b"n"[..], &random.text(max_len / 2)].concat();
                let static_name = random.pick(&STATIC_TABLE).0.as_bytes();
                random.pick(&[&name, static_name]).to_vec()
            }));
            names.dedup();
            let mut values = vec![vec![]; random.pick(&[2, 30])];

            let mut encoder = Encoder::new();
            encoder.use_dynamic_table(max_capacity as u64, max_blocked as u64);
            let mut model = Model::new(max_capacity);
            model
                .read_encoder_stream(&drain(encoder.instructions()))
                .unwrap();
            assert_eq!(model.capacity, max_capacity.min(4096));
            let mut known = Knowledge::default();
            for _ in 0..200 {
                let at = random.below(values.len().max(10));
                if let Some(value) = values.get_mut(at) {
                    *value = random.text(max_len);
                }
                let lines = Vec::from_iter((0..random.below(12)).map(|_| -> Line<'_> {
                    let indexing = random.pick(&[Allowed, Without, Never]);
                    let indexing = random.pick(&[Allowed, Allowed, indexing]);
                    let name = &names[random.below(names.len())];
                    (name, &values[random.below(values.len())], indexing)
                }));
                let stream_id = random.below(300) as u64;
                let credit = random.pick(&[0, 100, 1000, usize::MAX, usize::MAX]);
                let (instructions, section) = encode_lines(&mut encoder, stream_id, credit, &lines);
                assert!(instructions.len() <= credit);

                let (count, dropped) = (model.entries.len(), model.dropped);
                model.read_encoder_stream(&instructions).unwrap();
                assert_eq!(model.unread, []);
                evictions += model.dropped - dropped;
                for entry in &model.entries[count..] {
                    assert!(lines.iter().any(|&(name, value, indexing)| {
                        (name, indexing == Allowed) == (&entry.name, true)
                            && (entry.value.is_empty() || value == entry.value)
                    }));
                }
                let section = model.section(&section).unwrap();
                let expected = lines.iter().map(|&(name, value, indexing)| Field {
                    never_index: indexing == Never,
                    ..field(name, value)
                });
                assert_eq!(section.fields, Vec::from_iter(expected));
                references += section.references.len();
                if section.required_insert_count != 0 {
                    let sections = known.unacknowledged.entry(stream_id).or_default();
                    sections.push_back(section);
                }

                assert!(model.dropped <= known.received_count);
                let sections = known.unacknowledged.values().flatten();
                let mut indexes = sections.flat_map(|section| &section.references);
                assert!(indexes.all(|&index| index >= model.dropped));
                let blocked = known.unacknowledged.values().filter(|sections| {
                    let mut counts = sections.iter().map(|section| section.required_insert_count);
                    counts.any(|count| count > known.received_count)
                });
                assert!(blocked.count() <= max_blocked);

                let mut feedback = vec![];
                while random.below(patience + 2) < 2 {
                    let streams = Vec::from_iter(known.unacknowledged.keys().copied());
                    let unknown = model.entries.len() - known.received_count;
                    match random.below(6) {
                        0 if unknown != 0 => {
                            let increment = 1 + random.below(unknown);
                            known.received_count += increment;
                            feedback.extend(integer(0x00, 6, increment));
                        }
                        1 => {
                            let stream_id = random.below(300) as u64;
                            known.unacknowledged.remove(&stream_id);
                            feedback.extend(integer(0x40, 6, stream_id as usize));
                        }
                        _ if streams.is_empty() => break,
                        _ => {
                            let stream_id = random.pick(&streams);
                            let sections = known.unacknowledged.get_mut(&stream_id).unwrap();
                            let count = sections.pop_front().unwrap().required_insert_count;
                            known.received_count = known.received_count.max(count);
                            known.unacknowledged.retain(|_, rest| !rest.is_empty());
                            feedback.extend(integer(0x80, 7, stream_id as usize));
                        }
                    }
                }
                for fragment in random.fragments(&feedback) {
                    encoder.read_decoder_stream(fragment).unwrap();
                }
            }
        }
        assert!(
            references > 50_000 && evictions > 4000,
            "{references} {evictions}"
        );
    }
}
