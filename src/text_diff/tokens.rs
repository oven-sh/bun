//! The diff that the package `diff` (jsdiff) 9.0.0 gives.
//!
//! Of all shortest edit scripts its forward Myers search picks the one that, read from the end, takes an insertion
//! wherever that still leads to a shortest script, else a deletion, else a match. That depends only on which tokens
//! match, so whatever cannot change it is left out of the search: the common head, most of the common tail, and tokens
//! that only one side has.
//!
//! Lines are first searched as text (`follow`). Other tokens, and lines if that gives up, get a number each
//! ([`diff_ids`]). Past the limits on work the script can be longer than the shortest.

use bun_core::identifier::is_identifier_part;
use bun_core::slice_as_bytes;
use bun_core::strings::{CodeUnits, PathByte, byte_bits, count_char, is_js_whitespace};

use crate::bit_rows::{Matches, diff_short};
use crate::lines::{Followed, Lines, follow};
use crate::patch::trim;
use crate::{EMPTY, Elem, Hunk, Interner, MAX_LEN, diff_shared_tokens, search_bounded};

/// A code unit of a JS string: Latin-1 or UTF-16.
pub trait Unit: PathByte + Into<u32> {
    /// `text.toLowerCase()`
    fn push_lowercase(text: &[Self], out: &mut Vec<Self>);
}
impl Unit for u8 {
    fn push_lowercase(text: &[u8], out: &mut Vec<u8>) {
        let is_upper =
            |unit: u8| unit.is_ascii_uppercase() | matches!(unit, 0xC0..=0xD6 | 0xD8..=0xDE);
        out.extend(text.iter().map(|&it| it | u8::from(is_upper(it)) << 5));
    }
}
impl Unit for u16 {
    fn push_lowercase(text: &[u16], out: &mut Vec<u16>) {
        let start = out.len();
        let mut has_sigma = false;
        for point in char::decode_utf16(text.iter().copied()) {
            match point {
                Ok(point) if point.is_ascii() => out.push(point.to_ascii_lowercase() as u16),
                Ok(point) => {
                    has_sigma |= point == 'Σ';
                    for lower in point.to_lowercase() {
                        out.extend_from_slice(lower.encode_utf16(&mut [0; 2]));
                    }
                }
                Err(alone) => out.push(alone.unpaired_surrogate()),
            }
        }
        // At the end of a word it is `ς`, which only `str` knows. U+FFFD is as long as the surrogate that it replaces.
        if has_sigma {
            let lower = String::from_utf16_lossy(text).to_lowercase();
            for (unit, lower) in out[start..].iter_mut().zip(lower.encode_utf16()) {
                if lower == 'ς' as u16 {
                    *unit = lower;
                }
            }
        }
    }
}

#[inline]
pub(crate) fn is<T: Unit>(unit: Option<&T>, ascii: u8) -> bool {
    unit == Some(&T::from_u8(ascii))
}

/// What a token is.
#[derive(Clone, Copy)]
pub enum Split {
    /// A line with its `\n`.
    Lines,
    /// A word, a run of spaces, a line ending, or any other code point.
    Words,
    /// A code point.
    Chars,
}

fn is_high<T: Unit>(unit: T) -> bool {
    unit.into() & 0xFC00 == 0xD800
}

fn is_low<T: Unit>(unit: T) -> bool {
    unit.into() & 0xFC00 == 0xDC00
}

/// What a unit is to [`Split::Words`].
#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Word,
    /// Particles follow words of other scripts without a space.
    Hangul,
    Space,
    Return,
    Newline,
    HighSurrogate,
    LowSurrogate,
    Other,
}

impl Class {
    const fn of_latin1(unit: u32) -> Self {
        match unit {
            0x0A => Self::Newline,
            0x0D => Self::Return,
            0xD7 | 0xF7 => Self::Other,
            0x30..=0x39 | 0x41..=0x5A | 0x5F | 0x61..=0x7A => Self::Word,
            0xAA | 0xAD | 0xB5 | 0xBA | 0xC0..=0xFF => Self::Word,
            _ if is_js_whitespace(unit) => Self::Space,
            _ => Self::Other,
        }
    }

    /// Han, kana, Yi, Thai, Lao, Myanmar, Khmer and the Tai scripts have no spaces between words.
    const fn by_range(unit: u32) -> Option<Self> {
        Some(match unit {
            0x2C7 | 0x2D8..=0x2DD | 0x387 | 0x2190..=0x2BFF => Self::Other,
            0x100..=0x2FF | 0x400..=0x47F => Self::Word,
            0xE00..=0xEFF | 0x1000..=0x109F | 0x1780..=0x17FF | 0x1950..=0x19FF => Self::Other,
            0x1A20..=0x1AAF | 0xA9E0..=0xA9FF | 0xAA60..=0xAADF => Self::Other,
            0x1100..=0x11FF | 0x3130..=0x318F | 0xAC00..=0xD7FF => Self::Hangul,
            0x2E80..=0x2FFF | 0x3001..=0xA4CF | 0xE000..=0xFAFF | 0xFF61..=0xFF9F => Self::Other,
            0xD800..=0xDBFF => Self::HighSurrogate,
            0xDC00..=0xDFFF => Self::LowSurrogate,
            // These follow emoji and other symbols.
            0x20D0..=0x20FF | 0xFE00..=0xFE0F => Self::Other,
            _ => return None,
        })
    }

    /// And the class that the next unit needs to be in the same token.
    const fn with_next(self) -> (Self, Option<Self>) {
        let next = match self {
            Self::Word | Self::Hangul | Self::Space => Some(self),
            Self::Return => Some(Self::Newline),
            Self::HighSurrogate => Some(Self::LowSurrogate),
            Self::Newline | Self::LowSurrogate | Self::Other => None,
        };
        (self, next)
    }

    /// Inlined, it makes the loops over Latin-1 a call for each unit.
    #[inline(never)]
    fn look_up(unit: u32) -> (Self, Option<Self>) {
        let class = match Self::by_range(unit) {
            Some(class) => class,
            None if is_identifier_part(unit as i32) => Self::Word,
            None if is_js_whitespace(unit) => Self::Space,
            None => Self::Other,
        };
        class.with_next()
    }

    #[inline]
    fn of(unit: u32) -> (Self, Option<Self>) {
        static LATIN1: [(Class, Option<Class>); 256] = {
            let (mut table, mut unit) = ([Class::Other.with_next(); 256], 0);
            while unit < table.len() {
                table[unit] = Class::of_latin1(unit as u32).with_next();
                unit += 1;
            }
            table
        };
        /// For 64 units each, if they have the same class.
        static BLOCKS: [Option<(Class, Option<Class>)>; 1024] = {
            let (mut table, mut unit) = ([None; 1024], 0);
            while unit <= 0xFFFF {
                let block = &mut table[unit as usize / 64];
                match (Class::by_range(unit), *block) {
                    (Some(class), None) => *block = Some(class.with_next()),
                    (Some(class), Some((first, _))) if class as u8 == first as u8 => {}
                    _ => (*block, unit) = (None, unit | 63),
                }
                unit += 1;
            }
            table
        };
        match LATIN1.get(unit as usize) {
            Some(&known) => known,
            None => BLOCKS[unit as usize / 64 % 1024].unwrap_or_else(|| Self::look_up(unit)),
        }
    }
}

impl Split {
    /// For each unit, whether it is in the same token of [`Split::Words`] as the one before it.
    #[inline]
    fn joined<T: Unit>(text: &[T]) -> impl Iterator<Item = bool> {
        let mut expected = None;
        text.iter().map(move |&unit| {
            let (class, next) = Class::of(unit.into());
            core::mem::replace(&mut expected, next) == Some(class)
        })
    }

    /// The end of the token that `text[at]` is in.
    #[inline]
    pub(crate) fn end<T: Unit>(self, text: &[T], at: usize) -> usize {
        let rest = &text[at..];
        at + match self {
            Split::Lines => {
                T::index_of_unit(rest, T::from_u8(b'\n')).map_or(rest.len(), |at| at + 1)
            }
            Split::Chars => {
                1 + usize::from(is_high(rest[0]) && rest.get(1).is_some_and(|&low| is_low(low)))
            }
            Split::Words => 1 + Self::joined(rest).skip(1).take_while(|&it| it).count(),
        }
    }

    pub fn count<T: Unit>(self, text: &[T]) -> usize {
        let unterminated = usize::from(!text.is_empty() && !is(text.last(), b'\n'));
        match (self, T::units(text)) {
            (Split::Lines, _) => count_newlines(text) + unterminated,
            (Split::Chars, CodeUnits::U8(text)) => text.len(),
            (Split::Chars, CodeUnits::U16(text)) => {
                // A sum as wide as a unit fills the lanes of a vector.
                let pairs = |(these, next): (&[u16], &[u16])| {
                    let is_pair = |(&one, &next)| u16::from(is_high(one) & is_low(next));
                    usize::from(these.iter().zip(next).map(is_pair).sum::<u16>())
                };
                let next = text.get(1..).unwrap_or_default();
                let parts = text.chunks(1 << 15).zip(next.chunks(1 << 15));
                text.len() - parts.map(pairs).sum::<usize>()
            }
            (Split::Words, _) => Self::joined(text).filter(|joined| !joined).count(),
        }
    }

    fn is_boundary<T: Unit>(self, text: &[T], at: usize) -> bool {
        at == 0 || at == text.len() || self.end(&text[at - 1..=at], 0) == 1
    }

    /// The length of the tokens that both texts start with.
    pub(crate) fn common_head<T: Unit>(self, a: &[T], b: &[T]) -> usize {
        // `memcmp` is the fastest way through a long head.
        let blocks = a.as_chunks::<512>().0.iter().zip(b.as_chunks().0);
        let mut head = 512 * blocks.take_while(|(a, b)| a == b).count();
        head += u8::common_prefix(slice_as_bytes(&a[head..]), slice_as_bytes(&b[head..]))
            / size_of::<T>();
        if let Split::Lines = self
            && head < a.len().max(b.len())
        {
            return line_start(a, head);
        }
        while !(self.is_boundary(a, head) && self.is_boundary(b, head)) {
            head -= 1;
        }
        head
    }

    /// The length of the tokens that both texts, which start at a token, end with.
    #[inline(always)]
    fn common_tail<T: Unit>(self, a: &[T], b: &[T]) -> usize {
        let blocks = a.as_rchunks::<512>().1.iter().rev();
        let blocks = blocks.zip(b.as_rchunks().1.iter().rev());
        let mut tail = 512 * blocks.take_while(|(a, b)| a == b).count();
        let [rest_a, rest_b] = [a, b].map(|text| slice_as_bytes(&text[..text.len() - tail]));
        tail += u8::common_suffix(rest_a, rest_b) / size_of::<T>();
        if self.is_boundary(a, a.len() - tail) && self.is_boundary(b, b.len() - tail) {
            return tail;
        }
        a.len() - self.end(a, a.len() - tail)
    }

    /// `from`, and where each code point of `text[from..to]` ends.
    fn char_offsets<T: Unit>(text: &[T], from: usize, to: usize) -> Vec<u32> {
        let mut offsets = Vec::with_capacity(16);
        offsets.push(from as u32);
        let mut at = from;
        while at < to {
            at = Split::Chars.end(text, at);
            offsets.push(at as u32);
        }
        offsets
    }

    /// The same for the tokens of [`Split::Words`].
    fn word_offsets<T: Unit>(text: &[T], from: usize, to: usize) -> Vec<u32> {
        let (mut offsets, mut tokens) = (Vec::with_capacity((to - from).min(256) + 16), 0);
        let (mut expected, mut at) = (None, from as u32);
        for block in text[from..to].chunks(256) {
            offsets.resize(tokens + block.len(), 0);
            let (starts, mut count) = (&mut offsets[tokens..], 0);
            // Written whether or not a token starts here: no branch to predict.
            for &unit in block {
                let (class, next) = Class::of(unit.into());
                starts[count] = at;
                count += usize::from(expected != Some(class));
                (expected, at) = (next, at + 1);
            }
            tokens += count;
        }
        offsets.truncate(tokens);
        offsets.push(to as u32);
        offsets
    }
}

pub(crate) fn count_newlines<T: Unit>(text: &[T]) -> usize {
    match T::units(text) {
        CodeUnits::U8(text) => count_char(text, b'\n'),
        // A sum as wide as a unit fills the lanes of a vector.
        CodeUnits::U16(text) => text
            .chunks(usize::from(u16::MAX))
            .map(|part| {
                part.iter()
                    .map(|&unit| u16::from(unit == 0x0A))
                    .sum::<u16>()
            })
            .map(usize::from)
            .sum(),
    }
}

/// In units.
pub(crate) const LONG_LINE: usize = 256;

/// Calls `found` with the place after each `\n`. A search is the fastest way through a long line, and slow to start
/// for each of many short ones.
pub(crate) fn for_each_line_end<T: Unit>(text: &[T], mut found: impl FnMut(usize)) {
    let newline = T::from_u8(b'\n');
    let (mut from, mut bits, mut narrow) = (0, Vec::new(), Vec::new());
    while let Some(length) = T::index_of_unit(&text[from..], newline) {
        from += length + 1;
        found(from);
        if length >= LONG_LINE || text.len() - from < LONG_LINE {
            continue;
        }
        let block = &text[from..text.len().min(from + 4096)];
        let bytes = match T::units(block) {
            CodeUnits::U8(bytes) => bytes,
            // A unit above 0xFF becomes 0xFF, so U+010A is not a newline. The bytes of the units are not searched because
            // every letter of Gujarati and Punjabi has a 0x0A.
            CodeUnits::U16(units) => {
                narrow.clear();
                narrow.extend(units.iter().map(|&unit| unit.min(0xFF) as u8));
                &narrow
            }
        };
        byte_bits(bytes, b'\n', &mut bits);
        for (mut word, start) in bits.iter().copied().zip((from + 1..).step_by(64)) {
            while word != 0 {
                found(start + word.trailing_zeros() as usize);
                word &= word - 1;
            }
        }
        from += block.len();
    }
}

/// Just after the last `\n` before `at`.
pub(crate) fn line_start<T: Unit>(text: &[T], at: usize) -> usize {
    T::last_index_of_unit(&text[..at], T::from_u8(b'\n')).map_or(0, |at| at + 1)
}

/// One replacement, as code units of the texts and as indices of their tokens.
#[derive(Clone, Copy)]
pub struct Edit {
    pub units: Hunk,
    pub tokens: Hunk,
}

/// Numbers tokens in the order in which they first come.
struct Ids<'a> {
    /// By the low bits of a token that is one code point: the first such point and its number. Empty for lines.
    points: Vec<(u32, u32)>,
    hashed: Interner<'a>,
}

impl<'a> Ids<'a> {
    #[inline(always)]
    fn new(split: Split, tokens: usize, units: usize) -> Self {
        let (points, hashed) = match split {
            // Short lines are repeats.
            Split::Lines => (0, tokens.min(units / 4)),
            // Most are repeats.
            Split::Words | Split::Chars => (
                (tokens / 4).next_power_of_two().clamp(128, 1 << 16),
                tokens.min(1024),
            ),
        };
        Self {
            points: vec![(0, EMPTY); points],
            hashed: Interner::with_capacity(hashed),
        }
    }

    /// If `token` is one code point: a number that is unique to it, and its slot.
    #[inline]
    fn slot<T: Unit>(&mut self, token: &[T]) -> Option<(u32, &mut (u32, u32))> {
        let point = match *token {
            // First, so that a line takes one test.
            [_, _, _, ..] => return None,
            [unit] => unit.into(),
            [high, low] if is_high(high) => (high.into() << 10) + low.into(),
            _ => return None,
        };
        let mask = self.points.len().wrapping_sub(1);
        Some((point, self.points.get_mut(point as usize & mask)?))
    }

    #[inline]
    fn intern<T: Unit>(&mut self, token: &'a [T]) -> u32 {
        let next = self.hashed.lines.len() as u32;
        match self.slot(token) {
            Some((point, slot)) if slot.1 == EMPTY => {
                *slot = (point, next);
                self.hashed.push_new(slice_as_bytes(token))
            }
            Some((point, &mut (owner, id))) if owner == point => id,
            _ => self.hashed.intern(slice_as_bytes(token)),
        }
    }

    #[inline]
    fn find<T: Unit>(&mut self, token: &[T]) -> Option<u32> {
        match self.slot(token) {
            Some((_, &mut (_, EMPTY))) => None,
            Some((point, &mut (owner, id))) if owner == point => Some(id),
            _ => self.hashed.find(slice_as_bytes(token)),
        }
    }
}

/// `None`: it takes more than `max_edits` insertions and deletions. The texts are no longer than a JS string.
pub fn diff_text<T: Unit>(split: Split, a: &[T], b: &[T], max_edits: usize) -> Option<Vec<Edit>> {
    let head = split.common_head(a, b);
    if head == a.len() && head == b.len() {
        return Some(Vec::new());
    }
    let tail = split.common_tail(&a[head..], &b[head..]);
    let (end_a, end_b) = (a.len() - tail, b.len() - tail);
    let is_unit = |text: &[T]| split.count(text) == text.len();
    let before = || split.count(&a[..head]);
    // `None` if each token is one unit. A surrogate pair then has no number, so reading the tail stops at the first.
    let mut offsets = match split {
        Split::Lines => {
            let mut lines_a = Lines::new(a, head..end_a);
            let mut lines_b = Lines::new(b, head..end_b);
            match follow(&mut lines_a, &mut lines_b, max_edits) {
                Followed::Found(hunks) => {
                    let starts = [lines_a.starts(), lines_b.starts()];
                    return Some(edits(hunks, head, before(), Some(&starts)));
                }
                Followed::TooFar => return None,
                Followed::GaveUp => Some([lines_a.offsets(), lines_b.offsets()]),
            }
        }
        Split::Chars if is_unit(&a[head..end_a]) && is_unit(&b[head..end_b]) => None,
        Split::Chars => Some([
            Split::char_offsets(a, head, end_a),
            Split::char_offsets(b, head, end_b),
        ]),
        Split::Words => Some([
            Split::word_offsets(a, head, end_a),
            Split::word_offsets(b, head, end_b),
        ]),
    };

    let units = end_a + end_b - 2 * head;
    let tokens = match &offsets {
        Some([of_a, of_b]) => of_a.len() + of_b.len(),
        None => units,
    };
    let mut interner = Ids::new(split, tokens, units);
    let [mut ids_a, mut ids_b] = [(0, &a[..end_a]), (1, &b[..end_b])].map(|(side, text)| {
        // With room for the few tokens of the tail that most diffs add.
        let mut ids = Vec::new();
        if let Some(offsets) = &offsets {
            let token = |&[from, to]: &[u32; 2]| &text[from as usize..to as usize];
            ids.reserve_exact(offsets[side].len() + 8);
            ids.extend(
                offsets[side]
                    .array_windows()
                    .map(|it| interner.intern(token(it))),
            );
        } else {
            let (units, _) = text[head..].as_chunks::<1>();
            ids.reserve_exact(units.len() + 8);
            ids.extend(units.iter().map(|unit| interner.intern(unit)));
        }
        ids
    });

    let (mut at, mut part) = (end_a, part_of_tail(&ids_a, &ids_b, tokens));
    let hunks = loop {
        while at < a.len() && part > 0 {
            let end = split.end(a, at);
            let Some(id) = interner.find(&a[at..end]) else {
                break;
            };
            ids_a.push(id);
            ids_b.push(id);
            if let Some([of_a, of_b]) = &mut offsets {
                of_a.push(end as u32);
                of_b.push((end - end_a + end_b) as u32);
            }
            (at, part) = (end, part - 1);
        }
        let distinct = interner.hashed.lines.len();
        if part > 0 || at == a.len() {
            drop(interner);
            break diff_ids(&ids_a, &ids_b, distinct, max_edits)?;
        }
        let hunks = diff_ids(&ids_a, &ids_b, distinct, max_edits)?;
        if hunks.last().is_none_or(|last| last.a_hi < ids_a.len()) {
            break hunks;
        }
        part = usize::MAX;
    };
    Some(edits(hunks, head, before(), offsets.as_ref()))
}

/// An edit can move into the tail (`x a` → `a a` is `-x a +a`), but not past a token that nothing before it equals,
/// and not past one that the shortest script keeps when the texts are cut off after it. So this many tokens of the
/// tail are tried first, if that is within `ROW_WORK` and so is sure to give the shortest.
fn part_of_tail(ids_a: &[u32], ids_b: &[u32], tokens: usize) -> usize {
    let part = tokens + 1024;
    if (ids_a.len() + part) * (ids_b.len() + part).div_ceil(64) > ROW_WORK {
        return usize::MAX;
    }
    part
}

/// What tokens can differ in and still match.
#[derive(Clone, Copy)]
pub struct Ignore {
    pub case: bool,
    /// At both ends.
    pub whitespace: bool,
}

impl Ignore {
    fn trim<T: Unit>(self, token: &[T]) -> &[T] {
        if self.whitespace { trim(token) } else { token }
    }
}

/// As [`diff_text`]. What is between two edits can be longer on one side.
#[inline]
pub fn diff_text_ignoring<T: Unit>(
    split: Split,
    a: &[T],
    b: &[T],
    ignore: Ignore,
    max_edits: usize,
) -> Option<Vec<Edit>> {
    if !ignore.case && !ignore.whitespace {
        return diff_text(split, a, b, max_edits);
    }
    diff_keys(split, a, b, ignore, max_edits)
}

#[cold]
fn diff_keys<T: Unit>(
    split: Split,
    a: &[T],
    b: &[T],
    ignore: Ignore,
    max_edits: usize,
) -> Option<Vec<Edit>> {
    // In Latin-1 every token stays where it is.
    if !ignore.whitespace && size_of::<T>() == 1 {
        let [a, b] = [a, b].map(|text| lowercase(text, &[0, text.len() as u32]).0);
        return diff_text(split, &a, &b, max_edits);
    }
    let head = split.common_head(a, b);
    let tail = split.common_tail(&a[head..], &b[head..]);
    let (end_a, end_b) = (a.len() - tail, b.len() - tail);
    let mut offsets = [(a, end_a), (b, end_b)].map(|(text, end)| match split {
        Split::Lines => Lines::new(text, head..end).offsets(),
        Split::Words => Split::word_offsets(text, head, end),
        Split::Chars => Split::char_offsets(text, head, end),
    });
    let mut keys = [(a, &offsets[0]), (b, &offsets[1])];
    let lower = ignore
        .case
        .then(|| keys.map(|(text, offsets)| lowercase(text, offsets)));
    if let Some(lower) = &lower {
        keys = lower.each_ref().map(|(text, offsets)| (&text[..], offsets));
    }
    let [keys_a, keys_b] = keys.map(|(text, offsets)| {
        let key = |&[from, to]: &[u32; 2]| ignore.trim(&text[from as usize..to as usize]);
        offsets.array_windows().map(key)
    });
    // Of what is spelled differently, these many match at the start and at the end.
    let is_same = |(a, b): &(&[T], &[T])| a == b;
    let pairs = keys_a.clone().zip(keys_b.clone());
    let same_head = pairs.take_while(is_same).count();
    let (keys_a, keys_b) = (keys_a.skip(same_head), keys_b.skip(same_head));
    let pairs = keys_a.clone().rev().zip(keys_b.clone().rev());
    let same_tail = pairs.take_while(is_same).count();
    let mut same_keys = keys_a.clone().skip(keys_a.len() - same_tail);

    let tokens = keys_a.len() + keys_b.len() - 2 * same_tail + 2;
    let mut interner = Ids::new(split, tokens, end_a + end_b - 2 * head);
    let [mut ids_a, mut ids_b] = [keys_a, keys_b].map(|keys| {
        let count = keys.len() - same_tail;
        (keys.take(count).map(|key| interner.intern(key))).collect::<Vec<_>>()
    });
    let (mut at, mut part) = (end_a, part_of_tail(&ids_a, &ids_b, tokens));
    let (mut ends, mut lower) = (Vec::new(), Vec::new());
    let hunks = loop {
        while part > 0 {
            let key = match same_keys.next() {
                Some(key) => key,
                None if at == a.len() => break,
                None => {
                    let token = &a[at..split.end(a, at)];
                    at += token.len();
                    ends.push(at);
                    lower.clear();
                    if ignore.case {
                        T::push_lowercase(token, &mut lower);
                    }
                    ignore.trim(if ignore.case { &lower } else { token })
                }
            };
            let Some(id) = interner.find(key) else {
                break;
            };
            ids_a.push(id);
            ids_b.push(id);
            part -= 1;
        }
        let hunks = diff_ids(&ids_a, &ids_b, interner.hashed.lines.len(), max_edits)?;
        if part > 0 || hunks.last().is_none_or(|last| last.a_hi < ids_a.len()) {
            break hunks;
        }
        part = usize::MAX;
    };
    for (offsets, own_end) in offsets.iter_mut().zip([end_a, end_b]) {
        offsets.drain(..same_head);
        offsets.extend(ends.iter().map(|end| (end - end_a + own_end) as u32));
    }
    let before = split.count(&a[..head]) + same_head;
    Some(edits(hunks, head, before, Some(&offsets)))
}

/// Each token between `offsets` on its own, and where they are then. At most twice as long, so that fits too.
fn lowercase<T: Unit>(text: &[T], offsets: &[u32]) -> (Vec<T>, Vec<u32>) {
    let (mut lower, mut ends) = (
        Vec::with_capacity((offsets[offsets.len() - 1] - offsets[0]) as usize),
        Vec::with_capacity(offsets.len()),
    );
    ends.push(0);
    for &[from, to] in offsets.array_windows() {
        T::push_lowercase(&text[from as usize..to as usize], &mut lower);
        ends.push(lower.len() as u32);
    }
    (lower, ends)
}

/// `text.replaceAll("\r\n", "\n")`. `None` if there is no `\r`.
pub fn strip_trailing_cr<T: Unit>(text: &[T]) -> Option<Vec<T>> {
    T::index_of_unit(text, T::from_u8(b'\r'))?;
    let (mut out, mut from) = (Vec::with_capacity(text.len()), 0);
    for_each_line_end(text, |end| {
        if let [.., cr, _] = &text[from..end]
            && is(Some(cr), b'\r')
        {
            out.extend_from_slice(&text[from..end - 2]);
            from = end - 1;
        }
    });
    out.extend_from_slice(&text[from..]);
    Some(out)
}

/// `hunks` and `offsets` count from the token at the unit `head`, which has `before` tokens before it.
#[inline(always)]
fn edits(
    hunks: Vec<Hunk>,
    head: usize,
    before: usize,
    offsets: Option<&[Vec<u32>; 2]>,
) -> Vec<Edit> {
    let unit = |side: usize, token: usize| match offsets {
        Some(offsets) => offsets[side][token] as usize,
        None => head + token,
    };
    let edit = |h: Hunk| Edit {
        units: Hunk {
            a_lo: unit(0, h.a_lo),
            a_hi: unit(0, h.a_hi),
            b_lo: unit(1, h.b_lo),
            b_hi: unit(1, h.b_hi),
        },
        tokens: Hunk {
            a_lo: before + h.a_lo,
            a_hi: before + h.a_hi,
            b_lo: before + h.b_lo,
            b_hi: before + h.b_hi,
        },
    };
    hunks.into_iter().map(edit).collect()
}

/// As [`diff_text`], of tokens that are numbers below `distinct`, at most `i32::MAX` on each side.
pub fn diff_ids(a: &[u32], b: &[u32], distinct: usize, max_edits: usize) -> Option<Vec<Hunk>> {
    if a.len().abs_diff(b.len()) > max_edits {
        return None;
    }
    let hunks = match b.len().div_ceil(64) {
        _ if a.len() + distinct > SHORT => diff_long(a, b, distinct, max_edits),
        0..=1 => diff_short::<1>(a, b, distinct),
        2 => diff_short::<2>(a, b, distinct),
        3..=4 => diff_short::<4>(a, b, distinct),
        _ => diff_long(a, b, distinct, max_edits),
    };
    let edits: usize = hunks.iter().map(|h| h.deleted() + h.inserted()).sum();
    (edits <= max_edits).then_some(hunks)
}

/// The most rows and masks of [`diff_short`], of up to 32 bytes each.
const SHORT: usize = 1024;

fn diff_long(a: &[u32], b: &[u32], distinct: usize, max_edits: usize) -> Vec<Hunk> {
    diff_shared_tokens(
        a,
        b,
        distinct,
        &|shared_a, shared_b, changed_a, changed_b| {
            let unshared = (a.len() - shared_a.len()) + (b.len() - shared_b.len());
            let max_edits = max_edits.saturating_sub(unshared);
            mark(
                shared_a, shared_b, distinct, max_edits, changed_a, changed_b,
            );
        },
    )
}

/// Enough for 70,000 rows of 70,000 bits.
const ROW_WORK: usize = 80_000_000;
const ROW_WORK_PER_TOKEN: usize = 32;
/// Enough for 8,300 insertions and as many deletions.
const SEARCH_WORK: usize = 70_000_000;
const SEARCH_WORK_PER_TOKEN: usize = 16;
/// About what it takes to find out what else there is to try.
const FIRST_WORK_PER_TOKEN: usize = 8;

/// The search is fast if the sequences are close, which only running it tells. What rows of bits cost is known before.
fn mark(
    a: &[u32],
    b: &[u32],
    distinct: usize,
    max_edits: usize,
    changed_a: &mut [bool],
    changed_b: &mut [bool],
) {
    let tokens = a.len() + b.len();
    let first = FIRST_WORK_PER_TOKEN * tokens;
    let mut rows = None;
    let mut is_too_far = false;
    let mut more = || {
        let matches = Matches::new(b, distinct);
        let cost = matches.cost(a);
        let more = if cost <= ROW_WORK + ROW_WORK_PER_TOKEN * tokens {
            rows = Some((matches, cost));
            (cost / 3).saturating_sub(first)
        } else {
            SEARCH_WORK + SEARCH_WORK_PER_TOKEN * tokens - first
        };
        let reach = edits_within(a.len().abs_diff(b.len()), first + more).min(max_edits);
        if more > 0
            && let Some(read) = read_until_further_than(a, b, reach)
        {
            // Not tried if, at this rate, `a` is too short to show it.
            is_too_far = reach == max_edits
                || max_edits.saturating_mul(read) < reach * a.len()
                    && read_until_further_than(a, b, max_edits).is_some();
            return 0;
        }
        more
    };
    let work = Work {
        left: first as isize,
        more: Some(&mut more),
    };
    match (search(a, b, max_edits, work), rows) {
        (Search::Found(script), _) => script.mark(a, b, changed_a, changed_b),
        (Search::OutOfWork, Some((matches, cost))) if !is_too_far => {
            matches.mark(a, cost, changed_a, changed_b);
        }
        (Search::OutOfWork, None) if !is_too_far && a.len().max(b.len()) < MAX_LEN => {
            search_bounded(a, b, changed_a, changed_b);
        }
        (Search::OutOfWork | Search::TooFar, _) => {
            changed_a.fill(true);
            changed_b.fill(true);
        }
    }
}

struct Work<'a> {
    left: isize,
    /// Asked once, when none is left.
    more: Option<&'a mut dyn FnMut() -> usize>,
}

impl Work<'_> {
    /// False if that was too much.
    #[inline]
    fn spend(&mut self, steps: isize) -> bool {
        self.left -= steps;
        self.left >= 0 || self.refill()
    }

    #[cold]
    fn refill(&mut self) -> bool {
        self.left += self.more.take().map_or(0, |more| more()) as isize;
        self.left >= 0
    }
}

/// [`search`] finds no longer script in `work` steps: `pairs` rounds take `pairs` × (`difference` + `pairs`).
fn edits_within(difference: usize, work: usize) -> usize {
    let pairs = ((difference * difference + 4 * work).isqrt() - difference) / 2;
    difference + 2 * pairs
}

const GRAMS: [usize; 5] = [2, 4, 6, 8, 16];
const MAX_SLOTS: usize = 1 << 20;

/// The hashes of the last few tokens of a sequence.
struct Grams {
    /// Of all tokens up to each of the last places.
    prefixes: [u64; 32],
    end: usize,
}

impl Grams {
    const BASE: u64 = 0x9E37_79B9_7F4A_7C15;

    fn new() -> Self {
        let prefixes = [0; 32];
        Self { prefixes, end: 0 }
    }

    fn push(&mut self, token: u32) {
        let shifted = self.prefixes[self.end % 32].wrapping_mul(Self::BASE);
        self.end += 1;
        self.prefixes[self.end % 32] = shifted.wrapping_add(u64::from(token) + 1);
    }

    /// The top bits are the best. `shift` is `BASE` to the power of `length`.
    fn last(&self, length: usize, shift: u64) -> u64 {
        let before = self.prefixes[self.end.wrapping_sub(length) % 32];
        let gram = self.prefixes[self.end % 32].wrapping_sub(before.wrapping_mul(shift));
        gram.wrapping_mul(Self::BASE)
    }
}

/// How many tokens of `a` show that every script has more than `edits` edits, which are at least the difference of the
/// lengths.
///
/// Consecutive tokens of `a` that `b` does not have within `edits` of the same place have an edit among them
/// (Ukkonen, "Approximate string-matching with q-grams and maximal matches", 1992).
fn read_until_further_than(a: &[u32], b: &[u32], edits: usize) -> Option<usize> {
    if a.len() / GRAMS[0] <= edits {
        return None;
    }
    let max_deleted = (edits + a.len() - b.len()) / 2;
    let max_inserted = edits - max_deleted;
    let shifts = GRAMS.map(|length| Grams::BASE.wrapping_pow(length as u32));
    // By hash: the last place in `b` where such a gram ends. Sharing a slot only hides an edit.
    let slots = (4 * GRAMS.len() * (edits + 1))
        .next_power_of_two()
        .min(MAX_SLOTS);
    let slot = |hash: u64| (hash >> (64 - slots.trailing_zeros())) as usize;
    let mut last_end = vec![0u32; slots];
    let (mut in_a, mut in_b) = (Grams::new(), Grams::new());
    let (mut found, mut since_found) = (0, 0);
    for &token in a {
        in_a.push(token);
        since_found += 1;
        for &token in &b[in_b.end..b.len().min(in_a.end + max_inserted)] {
            in_b.push(token);
            for (length, shift) in GRAMS.into_iter().zip(shifts) {
                last_end[slot(in_b.last(length, shift))] = in_b.end as u32;
            }
        }
        let Some(longest) = GRAMS.iter().rposition(|&length| length <= since_found) else {
            continue;
        };
        let end = last_end[slot(in_a.last(GRAMS[longest], shifts[longest]))] as usize;
        if end == 0 || end + max_deleted < in_a.end {
            (found, since_found) = (found + 1, 0);
            if found > edits {
                return Some(in_a.end);
            }
        }
    }
    None
}

enum Search {
    Found(Script),
    TooFar,
    OutOfWork,
}

/// For each edit, last to first, whether it is an insertion. After each come all the matches there are.
struct Script(Vec<bool>);

impl Script {
    fn mark(&self, a: &[u32], b: &[u32], changed_a: &mut [bool], changed_b: &mut [bool]) {
        let (mut x, mut y) = (0, 0);
        for &is_insertion in self.0.iter().rev() {
            let matches = u32::common_prefix(&a[x..], &b[y..]);
            (x, y) = (x + matches, y + matches);
            if is_insertion {
                changed_b[y] = true;
                y += 1;
            } else {
                changed_a[x] = true;
                x += 1;
            }
        }
    }
}

/// A script has as many edits as the lengths differ by, and some pairs of an insertion and a deletion. Each round
/// allows one more pair (Wu, Manber, Myers and Miller, "An O(NP) sequence comparison algorithm", 1990) and moves from
/// both sides to the goal, the diagonal k = x - y that has the end. A path that reaches the end of `a` or `b` gets to
/// the end of both in the same round, so no step leaves the grid.
fn search(a: &[u32], b: &[u32], max_edits: usize, mut work: Work<'_>) -> Search {
    let difference = a.len().abs_diff(b.len());
    let Some(spare) = max_edits.checked_sub(difference) else {
        return Search::TooFar;
    };
    let head = u32::common_prefix(a, b);
    let (a, b) = (&a[head..], &b[head..]);
    let max_pairs = (spare / 2).min(a.len()).min(b.len());
    let goal = a.len() as isize - b.len() as isize;

    // By diagonal, from the outermost one of the round before to the goal: one more than the furthest x, so that 0
    // loses to every path.
    let [mut from_below, mut from_above] = [(a, b), (b, a)].map(|(one, other)| {
        let diagonals = one.len().saturating_sub(other.len());
        // Each round adds a diagonal. A long list has work for few rounds, so with room for 64 it seldom has to move.
        let mut furthest = vec![0u32; diagonals + 64];
        furthest.truncate(diagonals);
        furthest
    });
    let mut trace = Trace::default();
    for _ in 0..=max_pairs {
        let (deleted, inserted) = (from_below.len(), from_above.len());
        if !work.spend((deleted + inserted + 1) as isize) {
            return Search::OutOfWork;
        }
        let mut sweep = Sweep {
            a,
            b,
            work: &mut work,
            trace: &mut trace,
        };
        let end = sweep
            .run::<1>(&mut from_below, 0, -(inserted as isize))
            .and_then(|below| {
                let above = sweep.run::<-1>(&mut from_above, 0, deleted as isize)?;
                sweep.run::<1>(&mut [above], below, goal)
            });
        let Some(end) = end else {
            return Search::OutOfWork;
        };
        if end as usize > a.len() {
            return Search::Found(trace.backtrack(deleted, inserted));
        }
        from_below.push(end);
        from_above.push(end);
    }
    Search::TooFar
}

struct Sweep<'a, 'w> {
    a: &'a [u32],
    b: &'a [u32],
    work: &'a mut Work<'w>,
    trace: &'a mut Trace,
}

impl Sweep<'_, '_> {
    /// The matches from `x` and `y` on. Not rare, but cold and out of line, or the loop of [`Self::run`] runs out of
    /// registers.
    #[cold]
    #[inline(never)]
    fn slide(&mut self, x: usize, y: usize) -> Option<u32> {
        let matches = u32::common_prefix(&self.a[x..], &self.b[y..]);
        self.work.spend(matches as isize).then_some(matches as u32)
    }

    /// Steps the diagonals from `k` on in `DIRECTION`. Each reads from `furthest` what the round before found for the
    /// diagonal after it, and writes its own result there. `last` is the result of the diagonal before `k`. Returns that
    /// of the last one, or `None` if out of work.
    #[inline(never)]
    fn run<const DIRECTION: isize>(
        &mut self,
        furthest: &mut [u32],
        mut last: u32,
        mut k: isize,
    ) -> Option<u32> {
        let (a, b) = (self.a, self.b);
        for diagonals in furthest.chunks_mut(64) {
            let mut word = 0u64;
            for next in diagonals.iter_mut() {
                let (below, above) = if DIRECTION > 0 {
                    (last, *next)
                } else {
                    (*next, last)
                };
                last = above.max(below + 1);
                // Appends `last == above`. This form compiles to a subtraction with borrow.
                word = (word << 1 | 1) - u64::from(last != above);
                let x = last as usize - 1;
                let y = (x as isize - k) as usize;
                if let (Some(in_a), Some(in_b)) = (a.get(x), b.get(y))
                    && in_a == in_b
                {
                    last += self.slide(x, y)?;
                }
                *next = last;
                k += DIRECTION;
            }
            self.trace.push(word, diagonals.len());
        }
        Some(last)
    }
}

/// For each step of [`search`], whether it is an insertion.
#[derive(Default)]
struct Trace {
    /// From the highest bit of each.
    words: Vec<u64>,
    bits: usize,
}

impl Trace {
    /// The lowest `count` bits of `word`, 1 to 64.
    fn push(&mut self, word: u64, count: usize) {
        let (word, used) = (word << (64 - count), self.bits % 64);
        self.bits += count;
        match self.words.last_mut() {
            Some(last) if used > 0 => {
                *last |= word >> used;
                if used + count > 64 {
                    self.words.push(word << (64 - used));
                }
            }
            _ => self.words.push(word),
        }
    }

    /// From the end, which is the last step.
    fn backtrack(&self, deleted: usize, inserted: usize) -> Script {
        // How many diagonals the round has below and above the goal, and how far the path is from the goal.
        let (mut below, mut above, mut k) = (deleted as isize, inserted as isize, 0);
        let mut start = self.bits as isize - (below + above + 1);
        let step = |_| {
            let at = (start + below + if k < 0 { k } else { above - k }) as usize;
            let is_insertion = self.words[at / 64] << (at % 64) >> 63 == 1;
            if k != 0 && is_insertion == (k < 0) {
                (below, above) = (below - 1, above - 1);
                start -= below + above + 1;
            }
            k += if is_insertion { 1 } else { -1 };
            is_insertion
        };
        Script((0..deleted + inserted).map(step).collect())
    }
}
