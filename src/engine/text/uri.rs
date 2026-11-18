//! Encode and Decode of ECMA-262, and `escape` and `unescape` of its Annex B.

use bun_alloc::AllocError;

use crate::block::{self, BLOCK, Not, Positions, Units};
use crate::{CodeUnit, Cursor, StringBuilder, StringRef, Text, hex, utf8, utf8_encode, with_text};

/// Whether the text is a whole URI, in which the reserved characters and `#` have a meaning.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UriSet {
    Uri,
    Component,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UriError {
    LoneSurrogate,
    MalformedEscape,
    OutOfMemory,
}

impl UriError {
    /// Of the URIError, for the first two.
    pub fn message(self) -> &'static str {
        match self {
            UriError::LoneSurrogate => "String contained an illegal UTF-16 sequence.",
            UriError::MalformedEscape => "URI error",
            UriError::OutOfMemory => "Out of memory",
        }
    }
}

impl From<AllocError> for UriError {
    fn from(_: AllocError) -> UriError {
        UriError::OutOfMemory
    }
}

const SCRATCH: usize = 2048;

#[inline(always)]
const fn within(unit: u16, first: u8, last: u8) -> bool {
    unit.wrapping_sub(first as u16) <= (last - first) as u16
}

#[inline(always)]
const fn is(unit: u16, ascii: u8) -> bool {
    unit == ascii as u16
}

/// The characters to write in the first three bytes, and their number in the last.
type Form = [u8; 4];

const fn percent_form(byte: u8) -> Form {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    [
        b'%',
        DIGITS[(byte >> 4) as usize],
        DIGITS[(byte & 15) as usize],
        3,
    ]
}

macro_rules! forms {
    ($is_kept:path) => {{
        let (mut forms, mut byte) = ([[0; 4]; 256], 0);
        while byte < forms.len() {
            forms[byte] = if $is_kept(byte as u16) {
                [byte as u8, 0, 0, 1]
            } else {
                percent_form(byte as u8)
            };
            byte += 1;
        }
        forms
    }};
}

trait Encoding {
    type Error: From<AllocError>;
    const FORMS: &[Form; 256];
    /// The highest unit that is written as its form.
    const LAST_BYTE: u16;
    /// The most characters for a unit.
    const LONGEST: usize;

    fn is_kept(unit: u16) -> bool;

    /// Writes the first character of `units`, which is above `LAST_BYTE`. Returns the number of its units.
    fn push_other<T: CodeUnit>(units: &[T], to: &mut Cursor<'_, u8>) -> Result<usize, Self::Error>;
}

#[inline(always)]
fn push_form(form: &Form, to: &mut Cursor<'_, u8>) {
    to.push_prefix(form, usize::from(form[3] & 3));
}

#[inline(always)]
const fn is_kept_in_uri(unit: u16) -> bool {
    within(unit, b'&', b';')
        | within(unit, b'?', b'Z')
        | within(unit, b'a', b'z')
        | within(unit, b'#', b'$')
        | is(unit, b'!')
        | is(unit, b'=')
        | is(unit, b'_')
        | is(unit, b'~')
}

#[inline(always)]
const fn is_kept_in_component(unit: u16) -> bool {
    within(unit | 0x20, b'a', b'z')
        | within(unit, b'0', b'9')
        | within(unit, b'\'', b'*')
        | within(unit, b'-', b'.')
        | is(unit, b'!')
        | is(unit, b'_')
        | is(unit, b'~')
}

#[inline(always)]
const fn is_kept_by_escape(unit: u16) -> bool {
    within(unit, b'-', b'9')
        | within(unit, b'@', b'Z')
        | within(unit, b'a', b'z')
        | within(unit, b'*', b'+')
        | is(unit, b'_')
}

struct PercentEncoding<const IS_URI: bool>;

impl<const IS_URI: bool> Encoding for PercentEncoding<IS_URI> {
    type Error = UriError;
    const FORMS: &[Form; 256] = &if IS_URI {
        forms!(is_kept_in_uri)
    } else {
        forms!(is_kept_in_component)
    };
    const LAST_BYTE: u16 = 0x7f;
    const LONGEST: usize = 9;

    #[inline(always)]
    fn is_kept(unit: u16) -> bool {
        if IS_URI {
            is_kept_in_uri(unit)
        } else {
            is_kept_in_component(unit)
        }
    }

    #[inline(always)]
    fn push_other<T: CodeUnit>(units: &[T], to: &mut Cursor<'_, u8>) -> Result<usize, UriError> {
        let (bytes, length, width) = utf8_encode::encode(units);
        if width == 1 && units[0].is_surrogate() {
            return Err(UriError::LoneSurrogate);
        }
        for &byte in &bytes[..length] {
            to.push_prefix(&Self::FORMS[usize::from(byte)], 3);
        }
        Ok(width)
    }
}

struct Escape;

impl Encoding for Escape {
    type Error = AllocError;
    const FORMS: &[Form; 256] = &forms!(is_kept_by_escape);
    const LAST_BYTE: u16 = 0xff;
    const LONGEST: usize = 6;

    #[inline(always)]
    fn is_kept(unit: u16) -> bool {
        is_kept_by_escape(unit)
    }

    #[inline(always)]
    fn push_other<T: CodeUnit>(units: &[T], to: &mut Cursor<'_, u8>) -> Result<usize, AllocError> {
        let [[_, a, b, _], [_, c, d, _]] = units[0].to_u16().to_be_bytes().map(percent_form);
        to.push_array([b'%', b'u', a, b, c, d]);
        Ok(1)
    }
}

/// Goes on up to the character that starts at `end` or later. Returns how many units it has read.
#[inline(always)]
fn encode_piece<T: CodeUnit, E: Encoding>(
    units: &[T],
    end: usize,
    to: &mut Cursor<'_, u8>,
) -> Result<usize, E::Error> {
    let mut read = 0;
    while read < end {
        if let Some(block) = units[read..].first_chunk::<BLOCK>()
            && to.push_mapped_unless(block, |it| it.to_u16() as u8, |it| !E::is_kept(it.to_u16()))
        {
            read += BLOCK;
            continue;
        }
        let stop = units.len().min(read + BLOCK);
        while read < stop {
            let unit = units[read].to_u16();
            if unit <= E::LAST_BYTE {
                push_form(&E::FORMS[usize::from(unit)], to);
                read += 1;
            } else {
                read += E::push_other(&units[read..], to)?;
            }
        }
    }
    Ok(read)
}

#[inline(never)]
fn encode<T: CodeUnit, E: Encoding>(units: &[T]) -> Result<Option<StringRef>, E::Error> {
    const PIECE: usize = 4 * BLOCK;
    let Some(kept) = block::first(Not(Units(units, |it: T| E::is_kept(it.to_u16())))) else {
        return Ok(None);
    };
    StringBuilder::on_stack::<SCRATCH, _>(|builder| {
        builder.grow_with_slack(units.len(), units.len() / 2);
        builder.push_units(&units[..kept]);
        let mut rest = &units[kept..];
        while !rest.is_empty() {
            let end = rest.len().min(PIECE);
            // The last block may go past `end`, its last character past the block, and its last form past that.
            let most = rest.len().min(end + BLOCK) * E::LONGEST + 1;
            let mut read = Err(AllocError.into());
            builder.write_latin1(most, |to| read = encode_piece::<T, E>(rest, end, to));
            rest = &rest[read?..];
        }
        Ok(Some(builder.take()?))
    })
}

trait Decoding {
    type Error: From<AllocError>;

    /// The character that the escape at the start of `units` stands for, and its length. A `%` that stays is an
    /// escape for itself.
    fn decode<T: CodeUnit>(units: &[T]) -> Result<(u32, usize), Self::Error>;
}

const PERCENT: (u32, usize) = (b'%' as u32, 1);

/// The value of the two hexadecimal digits at `at`.
#[inline(always)]
fn byte_at<T: CodeUnit>(units: &[T], at: usize) -> Option<u8> {
    let &[high, low] = units.get(at..)?.first_chunk()?;
    hex::decode_pair(high, low)
}

struct PercentDecoding<const IS_URI: bool>;

impl<const IS_URI: bool> Decoding for PercentDecoding<IS_URI> {
    type Error = UriError;

    #[inline(always)]
    fn decode<T: CodeUnit>(units: &[T]) -> Result<(u32, usize), UriError> {
        let first = byte_at(units, 1).ok_or(UriError::MalformedEscape)?;
        if first.is_ascii() {
            let unit = u16::from(first);
            if IS_URI && is_kept_in_uri(unit) && !is_kept_in_component(unit) {
                return Ok(PERCENT);
            }
            return Ok((u32::from(first), 3));
        }
        let mut bytes = [first, 0, 0, 0];
        for index in 1..(first.leading_ones() as usize).min(4) {
            bytes[index] = byte_at(units, 3 * index + 1)
                .filter(|_| units[3 * index].is(b'%'))
                .ok_or(UriError::MalformedEscape)?;
        }
        let (code_point, length) =
            utf8::decode_non_ascii(&bytes).ok_or(UriError::MalformedEscape)?;
        Ok((code_point, 3 * length))
    }
}

struct Unescape;

impl Decoding for Unescape {
    type Error = AllocError;

    #[inline(always)]
    fn decode<T: CodeUnit>(units: &[T]) -> Result<(u32, usize), AllocError> {
        if let Some(byte) = byte_at(units, 1) {
            return Ok((u32::from(byte), 3));
        }
        if let (Some(high), Some(low)) = (byte_at(units, 2), byte_at(units, 4))
            && units[1].is(b'u')
        {
            return Ok((u32::from(u16::from_be_bytes([high, low])), 6));
        }
        Ok(PERCENT)
    }
}

/// Stops at a character that does not fit in `Out`. Returns how many units it has read. There is room for as many
/// units as there are.
#[inline(always)]
fn decode_fitting<In: CodeUnit, Out: CodeUnit, D: Decoding>(
    units: &[In],
    to: &mut Cursor<'_, Out>,
) -> Result<usize, D::Error> {
    let stops = |unit: In| unit.is(b'%') | (Out::IS_LATIN1 & !unit.is_latin1());
    let convert = |unit: In| Out::from_u16_truncating(unit.to_u16());
    let mut rest = units;
    loop {
        let plain = match rest.first_chunk::<BLOCK>() {
            Some(block) => {
                let plain = (Units(block, stops).mask(0) | 1 << BLOCK).trailing_zeros() as usize;
                to.push_mapped_prefix(block, plain, convert);
                plain
            }
            None => {
                let plain = block::first(Units(rest, stops)).unwrap_or(rest.len());
                to.push_mapped(&rest[..plain], convert);
                plain
            }
        };
        rest = &rest[plain..];
        if plain == BLOCK {
            continue;
        }
        while rest.first().is_some_and(|unit| unit.is(b'%')) {
            let (code_point, length) = D::decode(rest)?;
            if Out::IS_LATIN1 && code_point > 0xff {
                return Ok(units.len() - rest.len());
            }
            to.push_code_point(code_point);
            rest = &rest[length..];
        }
        if rest.first().is_none_or(|&unit| stops(unit)) {
            return Ok(units.len() - rest.len());
        }
    }
}

#[inline(never)]
fn decode<T: CodeUnit, D: Decoding>(units: &[T]) -> Result<Option<StringRef>, D::Error> {
    let Some(plain) = crate::search::find_unit(units, T::from(b'%')) else {
        return Ok(None);
    };
    StringBuilder::on_stack::<SCRATCH, _>(|builder| {
        builder.reserve(units.len());
        builder.push_units(&units[..plain]);
        let mut rest = &units[plain..];
        if builder.is_latin1() {
            let mut read = Err(AllocError.into());
            builder.write_latin1(rest.len(), |to| read = decode_fitting::<T, u8, D>(rest, to));
            rest = &rest[read?..];
        }
        if !rest.is_empty() {
            let mut read = Err(AllocError.into());
            builder.write_utf16(rest.len(), |to| {
                read = decode_fitting::<T, u16, D>(rest, to)
            });
            read?;
        }
        if builder.len() == units.len() {
            return Ok(None);
        }
        Ok(Some(builder.take()?))
    })
}

impl Text<'_> {
    /// `encodeURI` or `encodeURIComponent`. `None` if nothing changes.
    #[inline(always)]
    pub fn encode_uri(self, set: UriSet) -> Result<Option<StringRef>, UriError> {
        with_text!(self, |units| match set {
            UriSet::Uri => encode::<_, PercentEncoding<true>>(units),
            UriSet::Component => encode::<_, PercentEncoding<false>>(units),
        })
    }

    /// `decodeURI` or `decodeURIComponent`. `None` if nothing changes.
    #[inline(always)]
    pub fn decode_uri(self, set: UriSet) -> Result<Option<StringRef>, UriError> {
        with_text!(self, |units| match set {
            UriSet::Uri => decode::<_, PercentDecoding<true>>(units),
            UriSet::Component => decode::<_, PercentDecoding<false>>(units),
        })
    }

    /// `None` if nothing changes.
    #[inline(always)]
    pub fn escape(self) -> Result<Option<StringRef>, AllocError> {
        with_text!(self, |units| encode::<_, Escape>(units))
    }

    /// `None` if nothing changes.
    #[inline(always)]
    pub fn unescape(self) -> Result<Option<StringRef>, AllocError> {
        with_text!(self, |units| decode::<_, Unescape>(units))
    }
}
