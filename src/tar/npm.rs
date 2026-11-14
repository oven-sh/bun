//! Where npm's tar reader would take a package for something else than [`crate::Reader`] does.
// https://github.com/isaacs/node-tar/tree/v7.5.19/src

use crate::header::{
    self, Block, CHECKSUM, DEVMAJOR, DEVMINOR, GID, MODE, MTIME, PREFIX, SIZE, UID, USTAR_MAGIC,
    is_octal,
};
use crate::num::{parse_decimal, parse_field};
use bun_core::{slice_to_nul, strings};
use core::ops::Range;

/// npm ignores an extension header with a longer body.
pub(crate) const BODY_LIMIT: i64 = 1024 * 1024;

/// npm takes a block for a zero block whatever is in its checksum field, short of a number.
const EMPTY_SUM: i64 = 8 * b' ' as i64;
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
        _ => strings::index_of_any(field, b"01234567"),
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
        (_, b'1' | b'2' | b'x' | b'g', _) | (_, _, false) => Header::Plain,
        _ => Header::Ignored,
    }
}

#[derive(Default)]
pub(crate) struct Pax<'a> {
    pub(crate) path: Option<&'a [u8]>,
    pub(crate) size: Option<i64>,
    /// Other number fields of a header.
    pub(crate) replaces_numbers: bool,
}

/// npm takes each line for a record. `None` for a path or a size that there is no telling what it makes of.
pub(crate) fn read_pax(body: &[u8]) -> Option<Pax<'_>> {
    let mut pax = Pax::default();
    for line in strings::split(body, b"\n") {
        let decoded_len: usize = line
            .utf8_chunks()
            .map(|chunk| match chunk.invalid() {
                [] => chunk.valid().len(),
                _ => chunk.valid().len() + char::REPLACEMENT_CHARACTER.len_utf8(),
            })
            .sum();
        let expected = i64::try_from(decoded_len.saturating_add(1)).ok()?;
        if line.first().is_some_and(u8::is_ascii_digit) && parse_decimal(line) != expected {
            continue;
        }
        let mut buffer = itoa::Buffer::new();
        let length = buffer.format(expected).as_bytes();

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
            _ => continue,
        }
        if line.strip_prefix(length)?.first() != Some(&b' ') || value.is_empty() {
            return None;
        }
        if key == b"path" {
            if core::str::from_utf8(value).is_err() || strings::contains_char(value, 0) {
                return None;
            }
            pax.path = Some(value);
        } else {
            if !value.iter().all(u8::is_ascii_digit) {
                return None;
            }
            pax.size = Some(parse_decimal(value));
        }
    }
    Some(pax)
}
