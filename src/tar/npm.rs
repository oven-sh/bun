//! Where npm's tar reader would take a package for something else than [`crate::Reader`] does.
// https://github.com/isaacs/node-tar/tree/v7.5.19/src

use crate::gzip;
use crate::header::{
    self, BLOCK_SIZE, Block, CHECKSUM, DEVMAJOR, DEVMINOR, GID, MODE, MTIME, PREFIX, SIZE, UID,
    USTAR_MAGIC, is_octal,
};
use crate::num::{parse_decimal, parse_field};
use bun_core::{slice_to_nul, strings};
use core::ops::Range;

/// npm ignores an extension header with a longer body.
pub(crate) const BODY_LIMIT: i64 = 1024 * 1024;
/// `Z_DEFAULT_CHUNK` of `node:zlib`.
pub(crate) const INFLATED_AT_ONCE: usize = 16 * 1024;

/// npm takes a block for a zero block whatever is in its checksum field, short of a number.
const EMPTY_SUM: i64 = 8 * b' ' as i64;
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];
const OCTAL_DIGITS: &[u8] = b"01234567";
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
/// With a NUL here the prefix is over, and two times follow.
const SHORT_PREFIX_END: usize = PREFIX.start + 130;
const ATIME: Range<usize> = 476..488;
const CTIME: Range<usize> = 488..500;

/// npm drops a header that has a base-256 number it cannot hold.
fn number_parses(field: &[u8]) -> bool {
    match field.first() {
        Some(0x80 | 0xff) => parse_field(field).unsigned_abs() <= MAX_SAFE_INTEGER,
        Some(first) => first & 0x80 == 0,
        None => true,
    }
}

/// npm removes `/\0.*/`, which stops at the end of a line.
pub(crate) fn ends_at_nul(text: &[u8]) -> bool {
    let rest = text.get(slice_to_nul(text).len()..).unwrap_or_default();
    strings::index_of_any(rest, b"\n\r").is_none()
        && !strings::contains(rest, "\u{2028}".as_bytes())
        && !strings::contains(rest, "\u{2029}".as_bytes())
}

/// By what npm tells that a package is compressed.
pub(crate) fn looks_compressed(first: &Block) -> bool {
    gzip::starts_with_id(first) || first.starts_with(&ZSTD_MAGIC)
}

/// npm may skip a file that an extension header gives such a link target.
pub(crate) fn may_point_outside(target: &[u8]) -> bool {
    strings::contains(target, b"..")
}

/// The types that an extension header applies to.
pub(crate) fn takes_extensions(typeflag: u8) -> bool {
    matches!(typeflag, 0 | b'0'..=b'7' | b'D')
}

/// Whether npm is sure to pass over a block whose checksum [`header::checksum_ok`] has refused.
pub(crate) fn ignores_damaged(h: &Block) -> bool {
    // npm reads on into the type and the link name.
    let field = &h[CHECKSUM.start..CHECKSUM.end + 4];
    let number = match field.first() {
        Some(0x80) => Some(0),
        _ => strings::index_of_any(field, OCTAL_DIGITS),
    };
    let sum = header::unsigned_sum(h);
    sum != EMPTY_SUM
        && number.is_none_or(|at| parse_field(field.get(at..).unwrap_or_default()) != sum)
}

pub(crate) enum Header {
    Plain,
    /// npm passes over it, and looks for the next header in its body.
    Ignored,
    /// As [`Header::Ignored`], for want of a target. Go writes this for one with no ASCII in it.
    LinkWithoutTarget,
    /// Has a link name, as tar-stream writes in front of a link. [`Header::Ignored`] to npm 10.9.2 and older.
    PaxOfLink,
    Ambiguous,
}

/// `named`: an extension header has given the path.
pub(crate) fn classify(h: &Block, named: bool) -> Header {
    let typeflag = header::typeflag(h);
    let (size, checksum) = (&h[SIZE], &h[CHECKSUM]);
    let ustar = header::magic(h) == USTAR_MAGIC;
    let short_prefix = h[SHORT_PREFIX_END] == 0;
    let prefix = match (ustar, short_prefix) {
        (false, _) => &[][..],
        (true, true) => &h[PREFIX.start..SHORT_PREFIX_END],
        (true, false) => &h[PREFIX],
    };
    let [has_name, has_link, has_prefix] =
        [header::name(h), header::linkname(h), prefix].map(|text| !slice_to_nul(text).is_empty());

    let reads_alike = typeflag != b'N'
        && matches!(checksum.last(), Some(b' ' | 0))
        && is_octal(checksum)
        && strings::index_of_any(checksum, OCTAL_DIGITS).is_some()
        && (is_octal(size) || (size.first() == Some(&0x80) && number_parses(size)))
        && [header::name(h), header::linkname(h), prefix]
            .into_iter()
            .all(ends_at_nul)
        && if has_prefix {
            has_name || typeflag == b'5'
        } else {
            short_prefix || !ustar
        };
    if !reads_alike {
        return Header::Ambiguous;
    }

    let parses = |fields: &[Range<usize>]| {
        let field = |range: &Range<usize>| h.get(range.clone()).unwrap_or_default();
        fields.iter().map(field).all(number_parses)
    };
    let accepted = parse_field(checksum) == header::unsigned_sum(h)
        && parses(&[MODE, UID, GID, MTIME])
        && (!ustar || parses(&[DEVMAJOR, DEVMINOR]))
        && (!ustar || !short_prefix || parses(&[ATIME, CTIME]))
        && (has_name || has_prefix || (named && takes_extensions(typeflag)));
    match (accepted, typeflag, has_link) {
        (false, ..) => Header::Ignored,
        (_, b'1' | b'2', false) => Header::LinkWithoutTarget,
        (_, b'1' | b'2', _) | (_, _, false) => Header::Plain,
        (_, b'x', _) => Header::PaxOfLink,
        (_, b'g', _) => Header::Ambiguous,
        _ => Header::Ignored,
    }
}

#[derive(Default)]
pub(crate) struct Pax<'a> {
    pub(crate) path: Option<&'a [u8]>,
    pub(crate) size: Option<i64>,
    /// Other number fields of a header.
    pub(crate) replaces_numbers: bool,
    /// See [`may_point_outside`].
    pub(crate) link_may_point_outside: bool,
}

/// `buffer.toString()`, in pieces.
pub(crate) fn decode(text: &[u8]) -> impl Iterator<Item = &str> {
    text.utf8_chunks().flat_map(|chunk| match chunk.invalid() {
        [] => [chunk.valid(), ""],
        _ => [chunk.valid(), "\u{fffd}"],
    })
}

/// npm decodes a body in the pieces it arrives in. Only the first block is sure to be one piece.
fn may_be_cut(text: &[u8], offset: usize) -> bool {
    let whole = BLOCK_SIZE.saturating_sub(offset);
    text.get(whole..).is_some_and(|rest| !rest.is_ascii())
}

/// Whether a piece ends within a character of `text`, which is at `position` in an archive that npm has all of.
pub(crate) fn is_cut(text: &[u8], position: u64) -> bool {
    let to_next = position.wrapping_neg() % INFLATED_AT_ONCE as u64;
    (to_next as usize..text.len())
        .step_by(INFLATED_AT_ONCE)
        // A character starts at most three bytes before its last one.
        .filter_map(|at| text.get(at.saturating_sub(3)..=at)?.utf8_chunks().last())
        .any(|last| match last.invalid() {
            [] => !last.valid().ends_with(|c: char| c.is_ascii()),
            invalid => invalid.len() > 1,
        })
}

/// `parseInt(line, 10)`, if that is a length.
fn parse_int(line: &[u8]) -> Option<i64> {
    let is_space = |c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}';
    let text = line
        .utf8_chunks()
        .next()?
        .valid()
        .trim_start_matches(is_space);
    let digits = text.strip_prefix('+').unwrap_or(text).as_bytes();
    digits
        .first()?
        .is_ascii_digit()
        .then(|| parse_decimal(digits))
}

/// npm takes each line for a record. `None` for a path or a size that there is no telling what it makes of.
pub(crate) fn read_pax(body: &[u8], position: u64) -> Option<Pax<'_>> {
    let mut pax = Pax::default();
    let mut offset = 0usize;
    for line in strings::split(body, b"\n") {
        let may_be_cut = may_be_cut(line, offset);
        let is_cut = may_be_cut && is_cut(line, position.saturating_add(offset as u64));
        offset = offset.saturating_add(line.len()).saturating_add(1);

        let decoded_len: usize = decode(line).map(str::len).sum();
        let whole = i64::try_from(decoded_len.saturating_add(1)).ok()?;
        let Some(claimed) = parse_int(line) else {
            continue;
        };
        // A character that is cut takes more bytes.
        if claimed < whole || (claimed > whole && !may_be_cut) {
            continue;
        }
        let mut buffer = itoa::Buffer::new();
        let length = buffer.format(claimed).as_bytes();

        // The key starts as many characters in as the length and a space take, whatever they are.
        let mut record = line;
        for _ in 0..=length.len() {
            let Some(chunk) = record.utf8_chunks().next() else {
                break;
            };
            let first = chunk.valid().chars().next();
            let skip = first.map_or_else(|| chunk.invalid().len(), char::len_utf8);
            record = record.get(skip..).unwrap_or_default();
        }
        let (key, value) = strings::split_once_char(record, b'=').unwrap_or((record, b""));
        match key {
            b"path" | b"size" => {}
            b"uid" | b"gid" | b"mtime" | b"atime" | b"ctime" => {
                pax.replaces_numbers = true;
                continue;
            }
            b"linkpath" => {
                pax.link_may_point_outside |= may_point_outside(value);
                continue;
            }
            _ => continue,
        }
        if claimed > whole
            || is_cut
            || line.strip_prefix(length)?.first() != Some(&b' ')
            || value.is_empty()
        {
            return None;
        }
        let is_number = value.iter().all(u8::is_ascii_digit);
        if key == b"size" {
            pax.size = Some(is_number.then(|| parse_decimal(value))?);
        } else if is_number
            || core::str::from_utf8(value).is_err()
            || strings::contains_char(value, 0)
        {
            return None;
        } else {
            pax.path = Some(value);
        }
    }
    Some(pax)
}
