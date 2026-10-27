//! Finds the transformed words of the static dictionary that the input starts with.

use super::find_match_length::find_match_length_with_limit;
use super::static_dict_lut::{
    DictWord, StaticDictionaryLut, TRANSFORM_IDENTITY, TRANSFORM_UPPERCASE_FIRST, hash15,
};
use crate::common::dictionary::{DATA, OFFSETS_BY_LENGTH, SIZE_BITS_BY_LENGTH};
use crate::common::transform::CUT_OFF_TRANSFORMS;
use crate::util::{Checked, SliceExt};

pub(crate) const MAX_STATIC_DICTIONARY_MATCH_LEN: usize = 37;
pub(crate) const INVALID_MATCH: u32 = 0xFFF_FFFF;

type Matches = [u32; MAX_STATIC_DICTIONARY_MATCH_LEN + 1];

/// A word of the lookup table.
#[derive(Clone, Copy)]
struct Word {
    /// Its length before the transform.
    len: usize,
    /// Its index among the `count` words of that length.
    id: usize,
    count: usize,
    /// One of the `TRANSFORM_` constants.
    transform: u8,
}

impl Word {
    fn new(w: DictWord) -> Checked<Self> {
        let len = usize::from(w.len & 0x1F);
        Ok(Self {
            len,
            id: usize::from(w.idx),
            count: 1 << SIZE_BITS_BY_LENGTH.at(len)?,
            transform: w.transform,
        })
    }

    fn bytes(self) -> Checked<&'static [u8]> {
        DATA.sub(OFFSETS_BY_LENGTH.at(self.len)? as usize + self.len * self.id..)?
            .sub(..self.len)
    }

    /// Records that transform number `transform` of the word matches `len` bytes.
    #[inline(always)]
    fn add_match(self, transform: usize, len: usize, matches: &mut Matches) -> Checked {
        let value = (((self.id + transform * self.count) << 5) + self.len) as u32;
        let slot = matches.at_mut(len)?;
        *slot = (*slot).min(value);
        Ok(())
    }

    /// Whether `data`, of which `max_length` bytes count, starts with the word, in upper case if that is its transform.
    /// The lookup table only has ASCII words for those.
    #[inline(always)]
    fn is_match(self, data: &[u8], max_length: usize) -> Checked<bool> {
        if self.len > max_length {
            return Ok(false);
        }
        let dict = self.bytes()?;
        let data = data.sub(..self.len)?;
        Ok(if self.transform == TRANSFORM_IDENTITY {
            *dict == *data
        } else if self.transform == TRANSFORM_UPPERCASE_FIRST {
            let first = dict.at(0)?;
            first.is_ascii_lowercase()
                && first ^ 32 == data.at(0)?
                && *dict.sub(1..)? == *data.sub(1..)?
        } else {
            dict.iter()
                .zip(data)
                .all(|(d, b)| d.to_ascii_uppercase() == *b)
        })
    }
}

/// The words whose first 4 bytes, once transformed, may be those at `pos`.
#[inline(always)]
fn bucket<'a>(
    lut: &'a StaticDictionaryLut,
    data: &[u8],
    pos: usize,
) -> Checked<impl Iterator<Item = DictWord> + 'a> {
    let offset = usize::from(lut.buckets.at(hash15(data, pos)?)?);
    let mut end = offset == 0;
    Ok(lut
        .words
        .sub(offset..)?
        .iter()
        .copied()
        .take_while(move |w| !core::mem::replace(&mut end, w.len & 0x80 != 0)))
}

/// Sets `matches[l]` to the smallest `(distance << 5) + length code` of the dictionary references that match the first
/// `l` bytes of `data`, unless it is smaller already. `distance` is 0 for the first word of a length as it is. Only
/// lengths up to `max_length` are found, and not all of those below `min_length`. Returns whether there was any.
pub(crate) fn find_all_static_dictionary_matches(
    lut: &StaticDictionaryLut,
    data: &[u8],
    min_length: usize,
    max_length: usize,
    matches: &mut Matches,
) -> Checked<bool> {
    let mut has_found_match = false;

    for w in bucket(lut, data, 0)? {
        let w = Word::new(w)?;
        let l = w.len;
        if w.transform == TRANSFORM_IDENTITY {
            let matchlen = find_match_length_with_limit(w.bytes()?, data, l.min(max_length));
            if matchlen == l {
                w.add_match(0, l, matches)?;
                has_found_match = true;
            }
            // The last byte omitted, and "ing " in its place.
            if matchlen >= l - 1 {
                w.add_match(12, l - 1, matches)?;
                if l + 2 < max_length && *data.array_at::<4>(l - 1)? == *b"ing " {
                    w.add_match(49, l + 3, matches)?;
                }
                has_found_match = true;
            }
            // The last 2 to 9 bytes omitted.
            let minlen = if l > 9 {
                min_length.max(l - 9)
            } else {
                min_length
            };
            let maxlen = matchlen.min(l - 2);
            for len in minlen..=maxlen {
                w.add_match(usize::from(CUT_OFF_TRANSFORMS.at(l - len)?), len, matches)?;
                has_found_match = true;
            }
            if matchlen < l || l + 6 >= max_length {
                continue;
            }
            // A suffix.
            match *data.array_at::<7>(l)? {
                [b' ', s @ ..] => {
                    w.add_match(1, l + 1, matches)?;
                    match s {
                        [b'a', b' ', ..] => w.add_match(28, l + 3, matches)?,
                        [b'a', b's', b' ', ..] => w.add_match(46, l + 4, matches)?,
                        [b'a', b't', b' ', ..] => w.add_match(60, l + 4, matches)?,
                        [b'a', b'n', b'd', b' ', ..] => w.add_match(10, l + 5, matches)?,
                        [b'b', b'y', b' ', ..] => w.add_match(38, l + 4, matches)?,
                        [b'i', b'n', b' ', ..] => w.add_match(16, l + 4, matches)?,
                        [b'i', b's', b' ', ..] => w.add_match(47, l + 4, matches)?,
                        [b'f', b'o', b'r', b' ', ..] => w.add_match(25, l + 5, matches)?,
                        [b'f', b'r', b'o', b'm', b' ', ..] => w.add_match(37, l + 6, matches)?,
                        [b'o', b'f', b' ', ..] => w.add_match(8, l + 4, matches)?,
                        [b'o', b'n', b' ', ..] => w.add_match(45, l + 4, matches)?,
                        [b'n', b'o', b't', b' ', ..] => w.add_match(80, l + 5, matches)?,
                        [b't', b'h', b'e', b' ', ..] => w.add_match(5, l + 5, matches)?,
                        [b't', b'h', b'a', b't', b' ', ..] => w.add_match(29, l + 6, matches)?,
                        [b't', b'o', b' ', ..] => w.add_match(17, l + 4, matches)?,
                        [b'w', b'i', b't', b'h', b' ', ..] => w.add_match(35, l + 6, matches)?,
                        _ => {}
                    }
                }
                [b'"', s1, ..] => {
                    w.add_match(19, l + 1, matches)?;
                    if s1 == b'>' {
                        w.add_match(21, l + 2, matches)?;
                    }
                }
                [b'.', s @ ..] => {
                    w.add_match(20, l + 1, matches)?;
                    if s[0] == b' ' {
                        w.add_match(31, l + 2, matches)?;
                        match s {
                            [_, b'T', b'h', b'e', b' ', _] => w.add_match(43, l + 6, matches)?,
                            [_, b'T', b'h', b'i', b's', b' '] => w.add_match(75, l + 7, matches)?,
                            _ => {}
                        }
                    }
                }
                [b',', s1, ..] => {
                    w.add_match(76, l + 1, matches)?;
                    if s1 == b' ' {
                        w.add_match(14, l + 2, matches)?;
                    }
                }
                [b'\n', s1, ..] => {
                    w.add_match(22, l + 1, matches)?;
                    if s1 == b'\t' {
                        w.add_match(50, l + 2, matches)?;
                    }
                }
                [b']', ..] => w.add_match(24, l + 1, matches)?,
                [b'\'', ..] => w.add_match(36, l + 1, matches)?,
                [b':', ..] => w.add_match(51, l + 1, matches)?,
                [b'(', ..] => w.add_match(57, l + 1, matches)?,
                [b'=', b'"', ..] => w.add_match(70, l + 2, matches)?,
                [b'=', b'\'', ..] => w.add_match(86, l + 2, matches)?,
                [b'a', b'l', b' ', ..] => w.add_match(84, l + 3, matches)?,
                [b'e', b'd', b' ', ..] => w.add_match(53, l + 3, matches)?,
                [b'e', b'r', b' ', ..] => w.add_match(82, l + 3, matches)?,
                [b'e', b's', b't', b' ', ..] => w.add_match(95, l + 4, matches)?,
                [b'f', b'u', b'l', b' ', ..] => w.add_match(90, l + 4, matches)?,
                [b'i', b'v', b'e', b' ', ..] => w.add_match(92, l + 4, matches)?,
                [b'i', b'z', b'e', b' ', ..] => w.add_match(100, l + 4, matches)?,
                [b'l', b'e', b's', b's', b' ', ..] => w.add_match(93, l + 5, matches)?,
                [b'l', b'y', b' ', ..] => w.add_match(61, l + 3, matches)?,
                [b'o', b'u', b's', b' ', ..] => w.add_match(106, l + 4, matches)?,
                _ => {}
            }
        } else {
            let is_all_caps = w.transform != TRANSFORM_UPPERCASE_FIRST;
            let pick = |all: usize, first: usize| if is_all_caps { all } else { first };
            if !w.is_match(data, max_length)? {
                continue;
            }
            w.add_match(pick(44, 9), l, matches)?;
            has_found_match = true;
            if l + 1 >= max_length {
                continue;
            }
            // A suffix.
            match *data.array_at::<2>(l)? {
                [b' ', _] => w.add_match(pick(68, 4), l + 1, matches)?,
                [b'"', s1] => {
                    w.add_match(pick(87, 66), l + 1, matches)?;
                    if s1 == b'>' {
                        w.add_match(pick(97, 69), l + 2, matches)?;
                    }
                }
                [b'.', s1] => {
                    w.add_match(pick(101, 79), l + 1, matches)?;
                    if s1 == b' ' {
                        w.add_match(pick(114, 88), l + 2, matches)?;
                    }
                }
                [b',', s1] => {
                    w.add_match(pick(112, 99), l + 1, matches)?;
                    if s1 == b' ' {
                        w.add_match(pick(107, 58), l + 2, matches)?;
                    }
                }
                [b'\'', _] => w.add_match(pick(94, 74), l + 1, matches)?,
                [b'(', _] => w.add_match(pick(113, 78), l + 1, matches)?,
                [b'=', b'"'] => w.add_match(pick(105, 104), l + 2, matches)?,
                [b'=', b'\''] => w.add_match(pick(116, 108), l + 2, matches)?,
                _ => {}
            }
        }
    }

    // The prefixes " " and ".".
    if max_length >= 5 && matches!(data.at(0)?, b' ' | b'.') {
        let is_space = data.at(0)? == b' ';
        let tail = data.sub(1..)?;
        for w in bucket(lut, data, 1)? {
            let w = Word::new(w)?;
            let l = w.len;
            if w.transform == TRANSFORM_IDENTITY {
                let pick = |space: usize, dot: usize| if is_space { space } else { dot };
                if !w.is_match(tail, max_length - 1)? {
                    continue;
                }
                w.add_match(pick(6, 32), l + 1, matches)?;
                has_found_match = true;
                if l + 2 >= max_length {
                    continue;
                }
                // A suffix too.
                match *data.array_at::<2>(l + 1)? {
                    [b' ', _] => w.add_match(pick(2, 77), l + 2, matches)?,
                    [b'(', _] => w.add_match(pick(89, 67), l + 2, matches)?,
                    _ if !is_space => {}
                    [b',', s1] => {
                        w.add_match(103, l + 2, matches)?;
                        if s1 == b' ' {
                            w.add_match(33, l + 3, matches)?;
                        }
                    }
                    [b'.', s1] => {
                        w.add_match(71, l + 2, matches)?;
                        if s1 == b' ' {
                            w.add_match(52, l + 3, matches)?;
                        }
                    }
                    [b'=', b'"'] => w.add_match(81, l + 3, matches)?,
                    [b'=', b'\''] => w.add_match(98, l + 3, matches)?,
                    _ => {}
                }
            } else if is_space {
                let is_all_caps = w.transform != TRANSFORM_UPPERCASE_FIRST;
                let pick = |all: usize, first: usize| if is_all_caps { all } else { first };
                if !w.is_match(tail, max_length - 1)? {
                    continue;
                }
                w.add_match(pick(85, 30), l + 1, matches)?;
                has_found_match = true;
                if l + 2 >= max_length {
                    continue;
                }
                // A suffix too.
                match *data.array_at::<2>(l + 1)? {
                    [b' ', _] => w.add_match(pick(83, 15), l + 2, matches)?,
                    [b',', s1] => {
                        if !is_all_caps {
                            w.add_match(109, l + 2, matches)?;
                        }
                        if s1 == b' ' {
                            w.add_match(pick(111, 65), l + 3, matches)?;
                        }
                    }
                    [b'.', s1] => {
                        w.add_match(pick(115, 96), l + 2, matches)?;
                        if s1 == b' ' {
                            w.add_match(pick(117, 91), l + 3, matches)?;
                        }
                    }
                    [b'=', b'"'] => w.add_match(pick(110, 118), l + 3, matches)?,
                    [b'=', b'\''] => w.add_match(pick(119, 120), l + 3, matches)?,
                    _ => {}
                }
            }
        }
    }

    // The prefixes "e ", "s ", ", ", all of which come with the suffix " ", and "\u{A0}".
    if max_length >= 6 {
        let transform = match *data.array_at::<2>(0)? {
            [b'e', b' '] => Some(18),
            [b's', b' '] => Some(7),
            [b',', b' '] => Some(13),
            [0xC2, 0xA0] => Some(102),
            _ => None,
        };
        if let Some(transform) = transform {
            let tail = data.sub(2..)?;
            for w in bucket(lut, data, 2)? {
                let w = Word::new(w)?;
                let l = w.len;
                if w.transform == TRANSFORM_IDENTITY && w.is_match(tail, max_length - 2)? {
                    if transform == 102 {
                        w.add_match(transform, l + 2, matches)?;
                        has_found_match = true;
                    } else if l + 2 < max_length && data.at(l + 2)? == b' ' {
                        w.add_match(transform, l + 3, matches)?;
                        has_found_match = true;
                    }
                }
            }
        }
    }

    // The prefixes " the " and ".com/".
    if max_length >= 9 {
        let prefix = data.array_at::<5>(0)?;
        let is_the = prefix == b" the ";
        if is_the || prefix == b".com/" {
            let tail = data.sub(5..)?;
            for w in bucket(lut, data, 5)? {
                let w = Word::new(w)?;
                let l = w.len;
                if w.transform == TRANSFORM_IDENTITY && w.is_match(tail, max_length - 5)? {
                    w.add_match(if is_the { 41 } else { 72 }, l + 5, matches)?;
                    has_found_match = true;
                    if is_the && l + 8 < max_length && data.array_at::<4>(l + 5)? == b" of " {
                        w.add_match(62, l + 9, matches)?;
                        if l + 12 < max_length && data.array_at::<4>(l + 9)? == b"the " {
                            w.add_match(73, l + 13, matches)?;
                        }
                    }
                }
            }
        }
    }
    Ok(has_found_match)
}
