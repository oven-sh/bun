use core::ops::Range;

use bun_core::strings::{self, PathByte};

/// A code unit of a JavaScript string: Latin-1 or UTF-16.
pub trait Unit: PathByte + Copy + Into<u32> {
    /// 0xFF for what does not fit, which no syntax gives a meaning.
    fn low(self) -> u8;
    fn chars(units: &[Self]) -> Chars<'_>;
    /// `low` of the eight units at `at`, the first in the lowest byte.
    fn word(units: &[Self], at: usize) -> Option<u64>;

    /// The index of the first `byte` at `from` or later, or the length.
    #[inline]
    fn find(units: &[Self], from: usize, byte: u8) -> usize {
        let mut at = from;
        // Most runs end before a call would have been set up.
        for _ in 0..2 {
            let Some(word) = Self::word(units, at) else {
                break;
            };
            let word = word ^ (ONES * u64::from(byte));
            let zero = word.wrapping_sub(ONES) & !word & (ONES << 7);
            if zero != 0 {
                return at + zero.trailing_zeros() as usize / 8;
            }
            at += 8;
        }
        strings::index_of_scalar(&units[at..], Self::from_u8(byte))
            .map_or(units.len(), |it| at + it)
    }
}

pub(crate) const ONES: u64 = u64::MAX / 0xff;

impl Unit for u8 {
    #[inline(always)]
    fn low(self) -> u8 {
        self
    }

    #[inline(always)]
    fn chars(units: &[u8]) -> Chars<'_> {
        Chars::Latin1(units)
    }

    #[inline(always)]
    fn word(units: &[u8], at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(*units.get(at..)?.first_chunk()?))
    }
}

impl Unit for u16 {
    #[inline(always)]
    fn low(self) -> u8 {
        self.min(0xff) as u8
    }

    #[inline(always)]
    fn chars(units: &[u16]) -> Chars<'_> {
        Chars::Utf16(units)
    }

    #[inline(always)]
    fn word(units: &[u16], at: usize) -> Option<u64> {
        Some(u64::from_le_bytes(
            units.get(at..)?.first_chunk::<8>()?.map(Unit::low),
        ))
    }
}

/// The code units of a string. `Utf16` can hold text that would fit Latin-1.
#[derive(Clone, Copy, Debug)]
pub enum Chars<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

/// Runs the same code for both widths.
#[macro_export]
macro_rules! with_units {
    ($chars:expr, $units:ident => $body:expr) => {
        match $chars {
            $crate::Chars::Latin1($units) => $body,
            $crate::Chars::Utf16($units) => $body,
        }
    };
}

impl<'a> Chars<'a> {
    pub const EMPTY: Chars<'static> = Chars::Latin1(&[]);

    #[inline]
    pub fn len(self) -> usize {
        with_units!(self, units => units.len())
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn at(self, index: usize) -> u16 {
        match self {
            Chars::Latin1(units) => units[index].into(),
            Chars::Utf16(units) => units[index],
        }
    }

    #[inline]
    pub fn get(self, index: usize) -> Option<u16> {
        (index < self.len()).then(|| self.at(index))
    }

    #[inline]
    pub fn slice(self, range: core::ops::Range<usize>) -> Chars<'a> {
        with_units!(self, units => Unit::chars(&units[range]))
    }

    #[inline]
    pub fn skip(self, count: usize) -> Chars<'a> {
        self.slice(count..self.len())
    }

    pub fn units(self) -> impl DoubleEndedIterator<Item = u16> + ExactSizeIterator + Clone + 'a {
        (0..self.len()).map(move |index| self.at(index))
    }

    /// An unpaired surrogate is itself.
    pub fn code_points(self) -> impl Iterator<Item = u32> + 'a {
        let mut at = 0;
        core::iter::from_fn(move || {
            let unit = u32::from(self.get(at)?);
            at += 1;
            if let (0xd800..0xdc00, Some(low @ 0xdc00..0xe000)) = (unit, self.get(at)) {
                at += 1;
                return Some(0x10000 + ((unit - 0xd800) << 10) + (u32::from(low) - 0xdc00));
            }
            Some(unit)
        })
    }

    pub fn find(self, from: usize, byte: u8) -> Option<usize> {
        let at = with_units!(self, units => Unit::find(units, from, byte));
        (at < self.len()).then_some(at)
    }

    pub fn contains(self, byte: u8) -> bool {
        self.find(0, byte).is_some()
    }

    pub fn contains_ascii(self, needle: &[u8]) -> bool {
        let Some(&first) = needle.first() else {
            return true;
        };
        let mut from = 0;
        while let Some(at) = self.find(from, first) {
            if self.skip(at).starts_with(needle) {
                return true;
            }
            from = at + 1;
        }
        false
    }

    #[inline]
    pub fn is(self, ascii: &[u8]) -> bool {
        self == Chars::Latin1(ascii)
    }

    pub fn starts_with(self, ascii: &[u8]) -> bool {
        self.len() >= ascii.len() && self.slice(0..ascii.len()).is(ascii)
    }

    pub fn ends_with(self, ascii: &[u8]) -> bool {
        self.len() >= ascii.len() && self.skip(self.len() - ascii.len()).is(ascii)
    }

    pub fn is_ignoring_case(self, lowercase: &[u8]) -> bool {
        self.len() == lowercase.len() && self.starts_with_ignoring_case(lowercase)
    }

    pub fn starts_with_ignoring_case(self, lowercase: &[u8]) -> bool {
        self.len() >= lowercase.len()
            && with_units!(self, units => units.iter().zip(lowercase).all(|(a, b)| a.low().to_ascii_lowercase() == *b))
    }

    /// How many units of ASCII whitespace it starts with.
    #[inline]
    pub fn leading_spaces(self) -> usize {
        with_units!(self, units => units.iter().take_while(|it| it.low().is_ascii_whitespace()).count())
    }

    #[inline]
    pub fn is_all_spaces(self) -> bool {
        self.leading_spaces() == self.len()
    }
}

impl PartialEq for Chars<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        match (*self, *other) {
            (Chars::Latin1(a), Chars::Latin1(b)) => a == b,
            (Chars::Utf16(a), Chars::Utf16(b)) => a == b,
            (Chars::Latin1(a), Chars::Utf16(b)) | (Chars::Utf16(b), Chars::Latin1(a)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| u16::from(*a) == *b)
            }
        }
    }
}
impl Eq for Chars<'_> {}

impl core::hash::Hash for Chars<'_> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.units().for_each(|it| state.write_u16(it));
    }
}

impl<'a> From<&'a str> for Chars<'a> {
    #[inline]
    fn from(ascii: &'a str) -> Chars<'a> {
        debug_assert!(ascii.is_ascii());
        Chars::Latin1(ascii.as_bytes())
    }
}

/// A string under construction, which stays narrow for as long as it can.
#[derive(Clone, Debug)]
pub enum Text {
    Latin1(Vec<u8>),
    Utf16(Vec<u16>),
}

/// What is copied in less time than a call takes.
const SHORT: usize = 32;

#[inline(always)]
fn push_short(units: &mut Vec<u8>, more: &[u8]) {
    #[inline(always)]
    fn copy_ends<const N: usize>(to: &mut [u8], from: &[u8]) -> Option<()> {
        *to.first_chunk_mut()? = *from.first_chunk::<N>()?;
        *to.last_chunk_mut()? = *from.last_chunk::<N>()?;
        Some(())
    }
    let (start, end) = (units.len(), units.len() + more.len());
    units.extend_from_slice(&[0; SHORT]);
    let to = &mut units[start..end];
    _ = match more.len() {
        16.. => copy_ends::<16>(to, more),
        8.. => copy_ends::<8>(to, more),
        4.. => copy_ends::<4>(to, more),
        2.. => copy_ends::<2>(to, more),
        _ => copy_ends::<1>(to, more),
    };
    units.truncate(end);
}

impl Default for Text {
    fn default() -> Text {
        Text::Latin1(Vec::new())
    }
}

impl Text {
    pub fn with_capacity(capacity: usize) -> Text {
        Text::Latin1(Vec::with_capacity(capacity))
    }

    #[inline]
    pub fn chars(&self) -> Chars<'_> {
        match self {
            Text::Latin1(units) => Chars::Latin1(units),
            Text::Utf16(units) => Chars::Utf16(units),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.chars().len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&mut self) {
        match self {
            Text::Latin1(units) => units.clear(),
            Text::Utf16(_) => *self = Text::default(),
        }
    }

    #[cold]
    fn widen(&mut self) -> &mut Vec<u16> {
        if let Text::Latin1(narrow) = self {
            let mut wide = Vec::with_capacity(narrow.capacity().max(narrow.len() + 16));
            wide.extend(narrow.iter().map(|it| u16::from(*it)));
            *self = Text::Utf16(wide);
        }
        match self {
            Text::Utf16(units) => units,
            Text::Latin1(_) => unreachable!(),
        }
    }

    #[inline(always)]
    pub fn push_latin1(&mut self, more: &[u8]) {
        match self {
            Text::Latin1(units) if more.len() <= SHORT => push_short(units, more),
            Text::Latin1(units) => units.extend_from_slice(more),
            Text::Utf16(units) => units.extend(more.iter().map(|it| u16::from(*it))),
        }
    }

    /// Once more what it has there.
    #[inline(always)]
    pub fn repeat(&mut self, range: Range<usize>) {
        match self {
            Text::Latin1(units) if range.len() <= SHORT => {
                let len = units.len();
                units.extend_from_slice(&[0; SHORT]);
                units.copy_within(range.start..range.start + SHORT, len);
                units.truncate(len + range.len());
            }
            Text::Latin1(units) => units.extend_from_within(range),
            Text::Utf16(units) => units.extend_from_within(range),
        }
    }

    #[inline(always)]
    pub fn push_str(&mut self, ascii: &str) {
        debug_assert!(ascii.is_ascii());
        self.push_latin1(ascii.as_bytes());
    }

    #[inline(always)]
    pub fn push_byte(&mut self, byte: u8) {
        match self {
            Text::Latin1(units) => units.push(byte),
            Text::Utf16(units) => units.push(byte.into()),
        }
    }

    #[inline(always)]
    pub fn push(&mut self, more: Chars<'_>) {
        match more {
            Chars::Latin1(more) => self.push_latin1(more),
            Chars::Utf16(more) => self.push_utf16(more),
        }
    }

    fn push_utf16(&mut self, more: &[u16]) {
        match self {
            Text::Latin1(units) if more.iter().fold(0, |all, it| all | it) <= 0xff => {
                units.extend(more.iter().map(|it| *it as u8));
            }
            Text::Latin1(_) => self.widen().extend_from_slice(more),
            Text::Utf16(units) => units.extend_from_slice(more),
        }
    }

    pub fn push_unit(&mut self, unit: u16) {
        match (u8::try_from(unit), &mut *self) {
            (Ok(byte), _) => self.push_byte(byte),
            (Err(_), Text::Utf16(units)) => units.push(unit),
            (Err(_), Text::Latin1(_)) => self.widen().push(unit),
        }
    }

    pub fn push_code_point(&mut self, code: u32) {
        match code.checked_sub(0x10000) {
            None => self.push_unit(code as u16),
            Some(rest) => {
                self.push_unit(0xd800 + (rest >> 10) as u16);
                self.push_unit(0xdc00 + (rest & 0x3ff) as u16);
            }
        }
    }

    /// Puts `front` before what is at `at`, in the place of what has been read if it fits, and returns where it starts.
    pub(crate) fn unread(&mut self, at: usize, front: Chars<'_>) -> usize {
        if matches!((&*self, front), (Text::Latin1(_), Chars::Utf16(_))) {
            self.widen();
        }
        let start = at.saturating_sub(front.len());
        match (self, front) {
            (Text::Latin1(units), Chars::Latin1(front)) => {
                drop(units.splice(start..at, front.iter().copied()))
            }
            (Text::Utf16(units), front) => drop(units.splice(start..at, front.units())),
            (Text::Latin1(_), Chars::Utf16(_)) => unreachable!(),
        }
        start
    }

    pub(crate) fn drop_front(&mut self, count: usize) {
        match self {
            Text::Latin1(units) => drop(units.drain(..count)),
            Text::Utf16(units) => drop(units.drain(..count)),
        }
    }
}

impl From<Chars<'_>> for Text {
    fn from(chars: Chars<'_>) -> Text {
        let mut text = Text::with_capacity(chars.len());
        text.push(chars);
        text
    }
}
