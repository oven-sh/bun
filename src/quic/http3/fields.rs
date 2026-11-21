//! RFC 9114 §4.2 and §4.3.

use bun_core::strings::{self, ByteSet};
use bun_qpack::{Field, Indexing};

use super::Priority;
use super::message::{Fault, MALFORMED};
use crate::coding::MAX_VARINT;
use crate::config::Http3Config;

/// RFC 9114 §4.2.2.
const FIELD_OVERHEAD: usize = 32;
const MAX_POOLED: usize = 128;
const MAX_POOLED_LEN: usize = 8 * 1024;

/// RFC 9110 §5.6.2 `tchar`, but for the capital letters.
static NAME: ByteSet = ByteSet::new(&[
    b'!'..=b'!',
    b'#'..=b'\'',
    b'*'..=b'+',
    b'-'..=b'.',
    b'0'..=b'9',
    b'^'..=b'z',
    b'|'..=b'|',
    b'~'..=b'~',
]);
static VALUE: ByteSet = ByteSet::new(&[b'\t'..=b'\t', b' '..=b'~', 0x80..=0xff]);
static PATH: ByteSet = ByteSet::new(&[b'!'..=b'~', 0x80..=0xff]);
/// RFC 3986 §3.1.
static SCHEME: ByteSet = ByteSet::new(&[
    b'+'..=b'+',
    b'-'..=b'.',
    b'0'..=b'9',
    b'A'..=b'Z',
    b'a'..=b'z',
]);

/// To be sent.
#[derive(Clone, Copy)]
pub struct Header<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
    /// Of an entry that has this name (RFC 9204 Appendix A).
    pub static_index: Option<u8>,
    pub indexing: Indexing,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Section {
    #[default]
    Head,
    /// Of a response with a status of 1xx.
    Interim,
    Trailers,
}

#[derive(Clone, Copy)]
struct Entry {
    name: u32,
    name_len: u32,
    value: u32,
    value_len: u32,
}

/// What a HEADERS frame had.
#[derive(Default)]
pub struct Fields {
    bytes: Vec<u8>,
    entries: Vec<Entry>,
    pub section: Section,
    /// Some were left out because of the limits.
    pub is_incomplete: bool,
}

impl Fields {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Names, and values without whitespace around them.
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        (self.entries.iter()).map(|it| (self.get(it.name, it.name_len), self.value(it)))
    }

    #[inline]
    fn get(&self, start: u32, len: u32) -> &[u8] {
        let (start, len) = (start as usize, len as usize);
        self.bytes.get(start..start + len).unwrap_or_default()
    }

    #[inline]
    fn value(&self, entry: &Entry) -> &[u8] {
        self.get(entry.value, entry.value_len)
    }
}

#[derive(Default)]
pub(crate) struct Pool(Vec<Fields>);

impl Pool {
    pub(crate) fn put(&mut self, mut fields: Fields) {
        let len = fields.bytes.capacity() + fields.entries.capacity() * size_of::<Entry>();
        if self.0.len() < MAX_POOLED && len <= MAX_POOLED_LEN {
            fields.entries.clear();
            fields.is_incomplete = false;
            self.0.push(fields);
        }
    }

    pub(super) fn take(&mut self) -> Fields {
        self.0.pop().unwrap_or_default()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Expected {
    Request,
    Response,
    Trailers,
}

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    struct Seen: u16 {
        const METHOD = 1 << 0;
        const SCHEME = 1 << 1;
        const AUTHORITY = 1 << 2;
        const PATH = 1 << 3;
        const PROTOCOL = 1 << 4;
        const STATUS = 1 << 5;
        const HOST = 1 << 6;
        const REGULAR = 1 << 7;
    }
}

enum Name {
    Pseudo(Seen),
    ContentLength,
    Host,
    Priority,
    Te,
    Other,
}

impl Name {
    /// `None` if it is not allowed. The indices are those of RFC 9204 Appendix A.
    #[inline]
    fn of(field: &Field) -> Option<Self> {
        Some(match field.static_index {
            Some(0) => Self::Pseudo(Seen::AUTHORITY),
            Some(1) => Self::Pseudo(Seen::PATH),
            Some(4) => Self::ContentLength,
            Some(15..=21) => Self::Pseudo(Seen::METHOD),
            Some(22..=23) => Self::Pseudo(Seen::SCHEME),
            Some(24..=28 | 63..=71) => Self::Pseudo(Seen::STATUS),
            Some(_) => Self::Other,
            None => match field.name() {
                b":authority" => Self::Pseudo(Seen::AUTHORITY),
                b":method" => Self::Pseudo(Seen::METHOD),
                b":path" => Self::Pseudo(Seen::PATH),
                b":protocol" => Self::Pseudo(Seen::PROTOCOL),
                b":scheme" => Self::Pseudo(Seen::SCHEME),
                b":status" => Self::Pseudo(Seen::STATUS),
                b"content-length" => Self::ContentLength,
                b"host" => Self::Host,
                b"priority" => Self::Priority,
                b"te" => Self::Te,
                b"connection" | b"keep-alive" | b"proxy-connection" | b"transfer-encoding"
                | b"upgrade" => return None,
                name @ [_, ..] if is_in(&NAME, name) => Self::Other,
                _ => return None,
            },
        })
    }
}

/// What the fields of a section mean for the rest of the message.
#[derive(Default)]
pub(super) struct Summary {
    seen: Seen,
    is_options: bool,
    has_asterisk: bool,
    pub(super) is_connect: bool,
    pub(super) status: u16,
    pub(super) content_length: Option<u64>,
    pub(super) priority: Option<Priority>,
}

impl Summary {
    #[inline]
    fn add(&mut self, name: &Name, value: &[u8], expected: Expected) -> Option<()> {
        if let Name::Pseudo(bit) = *name {
            return self.add_pseudo(bit, value, expected);
        }
        is_in(&VALUE, value).then_some(())?;
        match *name {
            Name::ContentLength => {
                let len = parse_decimal(value).filter(|&len| len <= MAX_VARINT)?;
                let before = self.content_length.replace(len);
                before
                    .is_none_or(|it| it == len && expected == Expected::Response)
                    .then_some(())?;
            }
            Name::Host if expected == Expected::Request => {
                (!value.is_empty() && !self.seen.contains(Seen::HOST)).then_some(())?;
                self.seen |= Seen::HOST;
            }
            Name::Priority => self.priority.get_or_insert_default().update(value),
            Name::Te => (expected == Expected::Request && value.eq_ignore_ascii_case(b"trailers"))
                .then_some(())?,
            Name::Pseudo(_) | Name::Host | Name::Other => {}
        }
        self.seen |= Seen::REGULAR;
        Some(())
    }

    #[inline]
    fn add_pseudo(&mut self, bit: Seen, value: &[u8], expected: Expected) -> Option<()> {
        let is_allowed = match expected {
            Expected::Request => bit != Seen::STATUS,
            Expected::Response => bit == Seen::STATUS,
            Expected::Trailers => false,
        };
        (is_allowed && !self.seen.intersects(bit | Seen::REGULAR) && !value.is_empty())
            .then_some(())?;
        self.seen |= bit;
        let is_valid = match bit {
            Seen::PATH => {
                self.has_asterisk = value == b"*";
                (self.has_asterisk || value.starts_with(b"/")) && is_in(&PATH, value)
            }
            Seen::STATUS => {
                self.status = parse_decimal(value).filter(|_| value.len() == 3)? as u16;
                self.status >= 100 && self.status != 101
            }
            Seen::AUTHORITY => is_in(&VALUE, value),
            Seen::SCHEME => {
                value.first().is_some_and(u8::is_ascii_alphabetic) && is_in(&SCHEME, value)
            }
            _ => {
                if bit == Seen::METHOD {
                    (self.is_connect, self.is_options) = (value == b"CONNECT", value == b"OPTIONS");
                }
                (value.iter()).all(|&it| NAME.contains(it.to_ascii_lowercase()))
            }
        };
        is_valid.then_some(())
    }

    fn is_complete(&self, expected: Expected, allows_protocol: bool) -> bool {
        let pseudo = self.seen - (Seen::HOST | Seen::REGULAR);
        let has_protocol = pseudo.contains(Seen::PROTOCOL);
        match expected {
            Expected::Request if self.is_connect && !has_protocol => {
                pseudo == Seen::METHOD | Seen::AUTHORITY
            }
            Expected::Request => {
                pseudo.contains(Seen::METHOD | Seen::SCHEME | Seen::PATH)
                    && self.seen.intersects(Seen::AUTHORITY | Seen::HOST)
                    && (!has_protocol || self.is_connect && allows_protocol)
                    && (!self.has_asterisk || self.is_options)
            }
            Expected::Response => pseudo == Seen::STATUS,
            Expected::Trailers => true,
        }
    }
}

#[inline]
fn is_in(set: &ByteSet, bytes: &[u8]) -> bool {
    set.prefix_len(bytes) == bytes.len()
}

/// The one in `bun_core` also takes signs and underscores.
fn parse_decimal(digits: &[u8]) -> Option<u64> {
    let (first, rest) = digits.split_first()?;
    let digit = |byte: &u8| byte.is_ascii_digit().then(|| u64::from(byte - b'0'));
    (rest.iter()).try_fold(digit(first)?, |sum, it| {
        sum.checked_mul(10)?.checked_add(digit(it)?)
    })
}

/// `Ok(None)` if `section` refers to entries of the dynamic table that are yet to come.
pub(super) fn decode(
    decoder: &mut bun_qpack::Decoder,
    stream: u64,
    section: &[u8],
    expected: Expected,
    config: &Http3Config,
    out: &mut Fields,
) -> Result<Option<Summary>, Fault> {
    let Some(mut lines) = decoder.decode(stream, section, &mut out.bytes)? else {
        return Ok(None);
    };
    let mut summary = Summary::default();
    let (mut size, mut count, mut kept_size) = (0, 0, 0);
    let (mut authority, mut host) = (None, None);
    while let Some(field) = lines.next()? {
        let (name_len, untrimmed) = (field.name().len(), field.value());
        let len = name_len + untrimmed.len();
        (size, count) = (size + len + FIELD_OVERHEAD, count + 1);
        if size > config.tolerated_fields.size || count > config.tolerated_fields.count {
            return Err(MALFORMED);
        }
        let name = Name::of(&field).ok_or(MALFORMED)?;
        let (value, leading) = match name {
            Name::Pseudo(bit) if bit != Seen::AUTHORITY => (untrimmed, 0),
            _ => {
                let start = strings::trim_left(untrimmed, b" \t");
                let leading = untrimmed.len() - start.len();
                (strings::trim_right(start, b" \t"), leading)
            }
        };
        (summary.add(&name, value, expected)).ok_or(MALFORMED)?;
        if kept_size + len + config.field_overhead > config.kept_fields.size
            || out.entries.len() >= config.kept_fields.count
        {
            out.is_incomplete = true;
            continue;
        }
        kept_size += len + config.field_overhead;
        let value_len = value.len() as u32;
        let start = field.keep();
        let entry = Entry {
            name: start as u32,
            name_len: name_len as u32,
            value: (start + name_len + leading) as u32,
            value_len,
        };
        match name {
            Name::Pseudo(Seen::AUTHORITY) => authority = Some(entry),
            Name::Host => host = Some(entry),
            _ => {}
        }
        out.entries.push(entry);
    }
    let is_consistent = (authority.zip(host)).is_none_or(|(a, b)| out.value(&a) == out.value(&b));
    if !is_consistent || !summary.is_complete(expected, config.connect_protocol) {
        return Err(MALFORMED);
    }
    Ok(Some(summary))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_pooled_is_limited() {
        let entries = MAX_POOLED_LEN / size_of::<Entry>();
        for (bytes, entries, pooled) in [
            (MAX_POOLED_LEN, 0, MAX_POOLED),
            (MAX_POOLED_LEN + 1, 0, 0),
            (0, entries, MAX_POOLED),
            (0, entries + 1, 0),
        ] {
            let mut pool = Pool::default();
            for _ in 0..=MAX_POOLED {
                let mut fields = Fields::default();
                fields.bytes.reserve_exact(bytes);
                fields.entries.reserve_exact(entries);
                pool.put(fields);
            }
            assert_eq!(pool.0.len(), pooled);
        }
    }
}
