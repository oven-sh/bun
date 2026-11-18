use core::marker::PhantomData;
use core::ops::Range;

use crate::hash::hash_narrowed;
use crate::{CodeUnit, ascii, hash_latin1};

/// Borrowed characters of either width.
#[derive(Clone, Copy)]
pub enum Text<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

/// Runs an expression over the units of a [`Text`] as a slice, once for each width.
#[macro_export]
macro_rules! with_text {
    ($text:expr, |$units:ident| $body:expr) => {
        match $text {
            $crate::Text::Latin1($units) => $body,
            $crate::Text::Utf16($units) => $body,
        }
    };
}

/// A [`Text`] in two words, for where it is stored or handed on in registers.
#[derive(Clone, Copy)]
pub struct PackedText<'a> {
    units: *const u8,
    /// Shifted left by one, with a bit for Latin-1.
    length_and_width: usize,
    text: PhantomData<Text<'a>>,
}

impl<'a> PackedText<'a> {
    #[inline(always)]
    pub fn unpack(self) -> Text<'a> {
        let length = self.length_and_width >> 1;
        // SAFETY: what `pack` has taken apart.
        unsafe {
            if self.length_and_width & 1 != 0 {
                Text::Latin1(core::slice::from_raw_parts(self.units, length))
            } else {
                Text::Utf16(core::slice::from_raw_parts(self.units.cast(), length))
            }
        }
    }
}

impl<'a> Text<'a> {
    #[inline(always)]
    pub fn pack(self) -> PackedText<'a> {
        PackedText {
            units: with_text!(self, |units| units.as_ptr().cast()),
            length_and_width: self.len() << 1 | usize::from(self.is_latin1()),
            text: PhantomData,
        }
    }

    pub const EMPTY: Text<'static> = Text::Latin1(&[]);

    /// `ascii` has no byte above 0x7f.
    #[inline]
    pub const fn from_ascii(ascii: &'a str) -> Text<'a> {
        debug_assert!(ascii.is_ascii());
        Text::Latin1(ascii.as_bytes())
    }

    #[inline(always)]
    pub const fn len(self) -> usize {
        with_text!(self, |units| units.len())
    }

    #[inline(always)]
    pub const fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline(always)]
    pub const fn is_latin1(self) -> bool {
        matches!(self, Text::Latin1(_))
    }

    /// Panics past the end.
    #[inline(always)]
    pub fn at(self, index: usize) -> u16 {
        with_text!(self, |units| units[index].to_u16())
    }

    #[inline(always)]
    pub fn get(self, index: usize) -> Option<u16> {
        with_text!(self, |units| units.get(index).map(|unit| unit.to_u16()))
    }

    /// CodePointAt of ECMA-262: a lone surrogate is itself. Panics past the end.
    #[inline]
    pub fn code_point_at(self, index: usize) -> u32 {
        match self {
            Text::Latin1(characters) => u32::from(characters[index]),
            Text::Utf16(units) => code_point_at(units, index),
        }
    }

    /// Panics if the range is not inside the text.
    #[inline(always)]
    pub fn slice(self, range: Range<usize>) -> Text<'a> {
        with_text!(self, |units| CodeUnit::text(&units[range]))
    }

    #[inline(always)]
    pub fn slice_from(self, start: usize) -> Text<'a> {
        with_text!(self, |units| CodeUnit::text(&units[start..]))
    }

    #[inline]
    pub fn code_units(self) -> CodeUnits<'a> {
        CodeUnits {
            text: self,
            range: 0..self.len(),
        }
    }

    #[inline]
    pub fn code_points(self) -> CodePoints<'a> {
        CodePoints { text: self, at: 0 }
    }

    #[inline]
    pub fn hash(self) -> u32 {
        match self {
            Text::Latin1(characters) => hash_latin1(characters),
            Text::Utf16(units) => hash_utf16(units),
        }
    }

    /// Tells long texts apart, whichever width stores them.
    pub fn fingerprint(self) -> u64 {
        const BLOCK: usize = 1 << 14;
        let of_bytes = |bytes: &[u8]| bytes.chunks(BLOCK).fold(0, bun_highway::xxhash3_64);
        match self {
            Text::Latin1(characters) => of_bytes(characters),
            Text::Utf16(units) if ascii::fits_latin1(units) => {
                let mut narrowed = [0; BLOCK];
                units.chunks(BLOCK).fold(0, |seed, units| {
                    (narrowed.iter_mut().zip(units)).for_each(|(byte, &unit)| *byte = unit as u8);
                    bun_highway::xxhash3_64(seed, &narrowed[..units.len()])
                })
            }
            Text::Utf16(units) => of_bytes(bun_pod::slice_as_bytes(units)),
        }
    }
}

pub fn hash_utf16(units: &[u16]) -> u32 {
    if ascii::fits_latin1(units) {
        hash_narrowed(units)
    } else {
        hash_latin1(bun_pod::slice_as_bytes(units))
    }
}

#[inline]
fn code_point_at(units: &[u16], index: usize) -> u32 {
    let first = units[index];
    if first & 0xfc00 == 0xd800
        && let Some(&second) = units.get(index + 1)
        && second & 0xfc00 == 0xdc00
    {
        return 0x10000 + ((u32::from(first) - 0xd800) << 10) + (u32::from(second) - 0xdc00);
    }
    u32::from(first)
}

impl core::fmt::Display for Text<'_> {
    /// A lone surrogate is written as U+FFFD.
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        use core::fmt::Write;
        self.code_points().try_for_each(|code_point| {
            formatter.write_char(char::from_u32(code_point).unwrap_or(char::REPLACEMENT_CHARACTER))
        })
    }
}

impl core::fmt::Debug for Text<'_> {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(formatter, "\"{self}\"")
    }
}

#[derive(Clone)]
pub struct CodeUnits<'a> {
    text: Text<'a>,
    range: Range<usize>,
}

impl Iterator for CodeUnits<'_> {
    type Item = u16;

    #[inline]
    fn next(&mut self) -> Option<u16> {
        self.range.next().map(|index| self.text.at(index))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.range.size_hint()
    }
}

impl DoubleEndedIterator for CodeUnits<'_> {
    #[inline]
    fn next_back(&mut self) -> Option<u16> {
        self.range.next_back().map(|index| self.text.at(index))
    }
}

impl ExactSizeIterator for CodeUnits<'_> {}

#[derive(Clone)]
pub struct CodePoints<'a> {
    text: Text<'a>,
    at: usize,
}

impl Iterator for CodePoints<'_> {
    type Item = u32;

    #[inline]
    fn next(&mut self) -> Option<u32> {
        if self.at >= self.text.len() {
            return None;
        }
        let code_point = self.text.code_point_at(self.at);
        self.at += if code_point > 0xffff { 2 } else { 1 };
        Some(code_point)
    }
}
