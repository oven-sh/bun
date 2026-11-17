//! Tables that tell what the next bits of a block stand for.

use crate::array::At;
use crate::format::{
    DISTANCE_SYMBOLS, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, FIXED_DISTANCE_BITS,
    FIXED_LITERAL_LENGTH_SYMBOLS, LITERAL_LENGTH_SYMBOLS, MAX_CODE_BITS, MAX_CODE_LENGTH_BITS,
    MIN_MATCH, distance_range, fixed_literal_length_bits, fixed_literal_length_code, length_range,
    reversed,
};

pub(super) const LITERAL_LENGTH_BITS: u32 = 11;
pub(super) const DISTANCE_BITS: u32 = 8;

/// From the lowest bit: how many bits of the stream it stands for (6 bits), `SPECIAL`, `MATCH`, a literal (8), another
/// or the length of the match less 3 (8), `small()` (4), a `Special` (2), how many literals (2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Entry(pub(super) u32);

/// From the lowest bit: an `Entry` if that is special, or else how many bits of the stream it stands for (8 bits), how
/// many of them are the code (8), the shortest distance (16), the mask for the other bits (32).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct DistanceEntry(pub(super) u64);

#[derive(Clone, Copy)]
pub(super) enum Special {
    Subtable,
    LengthWithExtraBits,
    EndOfBlock,
    Invalid,
}

impl Entry {
    const SPECIAL: u32 = 1 << 6;
    const MATCH: u32 = 1 << 7;
    const ONE_LITERAL: u32 = 1 << 30;

    const fn special(kind: Special, bits: u32) -> Self {
        Self((kind as u32) << 28 | Self::SPECIAL | bits)
    }

    const fn subtable(start: u32, index_bits: u32, root_bits: u32) -> Self {
        Self(Self::special(Special::Subtable, root_bits).0 | index_bits << 24 | start << 8)
    }

    const fn length(length: u32, bits: u32) -> Self {
        Self((length - MIN_MATCH as u32) << 16 | Self::MATCH | bits)
    }

    const fn literal(literal: u8, bits: u32) -> Self {
        Self(Self::ONE_LITERAL | bits << 24 | (literal as u32) << 8 | bits)
    }

    const fn new(symbol: usize, bits: u32) -> Self {
        match symbol {
            0..END_OF_BLOCK => Self::literal(symbol as u8, bits),
            END_OF_BLOCK => Self::special(Special::EndOfBlock, bits),
            FIRST_LENGTH_SYMBOL..LITERAL_LENGTH_SYMBOLS => {
                let range = length_range((symbol - FIRST_LENGTH_SYMBOL) as u32);
                if range.extra_bits == 0 {
                    return Self::length(range.base, bits);
                }
                let special = Self::special(Special::LengthWithExtraBits, bits);
                Self(special.0 | range.extra_bits << 24 | (range.base - MIN_MATCH as u32) << 16)
            }
            _ => Self::special(Special::Invalid, bits),
        }
    }

    /// What is added to the entry of a literal for it to stand for this one too, which is not special.
    const fn as_second(self) -> u32 {
        if self.0 & Self::MATCH != 0 {
            return self.0;
        }
        Self::ONE_LITERAL | (self.first_literal() as u32) << 16 | self.bits()
    }

    const fn fits_with_extra_bits(self) -> bool {
        self.is_special()
            && matches!(self.kind(), Special::LengthWithExtraBits)
            && self.bits() + self.small() <= LITERAL_LENGTH_BITS
    }

    /// For a `LengthWithExtraBits` whose code is followed by `stream`.
    const fn with_extra_bits(self, stream: u64) -> Self {
        let length = self.match_length() + self.small_number(stream);
        Self::length(length as u32, self.bits() + self.small())
    }

    #[inline(always)]
    pub(super) const fn bits(self) -> u32 {
        self.0 % u64::BITS
    }

    #[inline(always)]
    pub(super) const fn is_only_literals(self) -> bool {
        self.0 & (Self::SPECIAL | Self::MATCH) == 0
    }

    #[inline(always)]
    pub(super) const fn is_special(self) -> bool {
        self.0 & Self::SPECIAL != 0
    }

    /// Of a special one.
    #[inline(always)]
    pub(super) const fn kind(self) -> Special {
        match (self.0 >> 28) % 4 {
            0 => Special::Subtable,
            1 => Special::LengthWithExtraBits,
            2 => Special::EndOfBlock,
            _ => Special::Invalid,
        }
    }

    #[inline(always)]
    pub(super) const fn literal_count(self) -> usize {
        (self.0 >> 30) as usize
    }

    /// The first `literal_count()` are.
    #[inline(always)]
    pub(super) const fn literals(self) -> [u8; 2] {
        ((self.0 >> 8) as u16).to_le_bytes()
    }

    #[inline(always)]
    pub(super) const fn first_literal(self) -> u8 {
        (self.0 >> 8) as u8
    }

    #[inline(always)]
    pub(super) const fn match_length(self) -> usize {
        (self.0 >> 16) as u8 as usize + MIN_MATCH
    }

    /// How many bits there are in the first literal's code, behind a length's code, or in the index of the subtable.
    #[inline(always)]
    pub(super) const fn small(self) -> u32 {
        (self.0 >> 24) % 16
    }

    /// The first `small()` bits.
    #[inline(always)]
    pub(super) const fn small_number(self, stream: u64) -> usize {
        (stream & ((1 << self.small()) - 1)) as usize
    }
}

impl DistanceEntry {
    const fn new(symbol: usize, bits: u32) -> Self {
        if symbol >= DISTANCE_SYMBOLS {
            return Self(Entry::special(Special::Invalid, bits).0 as u64);
        }
        let range = distance_range(symbol as u32);
        let lower = range.base << 16 | bits << 8 | (bits + range.extra_bits);
        Self(((1 << range.extra_bits) - 1) << 32 | lower as u64)
    }

    /// Only `bits()` and `is_special()` make sense for one that is not special.
    #[inline(always)]
    pub(super) const fn entry(self) -> Entry {
        Entry(self.0 as u32)
    }

    /// `stream` starts with the bits that the entry stands for.
    #[inline(always)]
    pub(super) const fn distance(self, stream: u64) -> usize {
        let extra = stream.wrapping_shr(self.0 as u32 >> 8) as u32 & (self.0 >> 32) as u32;
        ((self.0 as u32 >> 16) + extra) as usize
    }
}

impl From<Entry> for DistanceEntry {
    fn from(special: Entry) -> Self {
        Self(special.0.into())
    }
}

/// A code that has more bits than an index of `root` goes on in a subtable.
pub(super) struct Table<T, const ROOT: usize, const SUBTABLES: usize> {
    root: [T; ROOT],
    subtables: [T; SUBTABLES],
}

/// zlib's examples/enough.c finds that 294 and 146 entries are enough for the subtables.
pub(super) struct Tables {
    /// Or for the code lengths, until all have been read.
    pub(super) literal_length: Table<Entry, { 1 << LITERAL_LENGTH_BITS }, 512>,
    pub(super) distance: Table<DistanceEntry, { 1 << DISTANCE_BITS }, 256>,
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
pub(super) static FIXED: Tables = {
    let mut tables = Tables::EMPTY;
    let mut symbol = 0;
    while symbol < FIXED_LITERAL_LENGTH_SYMBOLS {
        let bits = fixed_literal_length_bits(symbol);
        let entry = Entry::new(symbol, bits);
        let mut index = fixed_literal_length_code(symbol) as usize;
        while index < 1 << LITERAL_LENGTH_BITS {
            tables.literal_length.root[index] = if entry.fits_with_extra_bits() {
                entry.with_extra_bits(index as u64 >> bits)
            } else {
                entry
            };
            index += 1 << bits;
        }
        symbol += 1;
    }
    let mut index = 0;
    while index < 1 << DISTANCE_BITS {
        let code = index as u16 % (1 << FIXED_DISTANCE_BITS);
        let symbol = reversed(code, FIXED_DISTANCE_BITS) as usize;
        tables.distance.root[index] = DistanceEntry::new(symbol, FIXED_DISTANCE_BITS);
        index += 1;
    }
    tables
};

/// A symbol that has a code, and the length of that.
#[derive(Clone, Copy)]
pub(super) struct Coded(u16);

impl Coded {
    #[inline(always)]
    pub(super) fn new(symbol: u16, bits: u8) -> Self {
        Self(symbol << 4 | u16::from(bits))
    }

    #[inline(always)]
    pub(super) fn symbol(self) -> u16 {
        self.0 >> 4
    }

    #[inline(always)]
    pub(super) fn bits(self) -> usize {
        usize::from(self.0 % 16)
    }
}

/// For each length, where the longer codes start in a list that is sorted by length.
#[derive(Default)]
struct Ends([u16; MAX_CODE_BITS + 1]);

impl Ends {
    #[inline(always)]
    fn of_length<'a, T>(&self, bits: u32, list: &'a [T]) -> &'a [T] {
        let [start, end] = [bits - 1, bits].map(|bits| usize::from(*self.0.at(bits as usize)));
        list.get(start..end).unwrap_or_default()
    }
}

/// The symbols in the order of their codes. There is room for `N`.
struct Sorted<const N: usize> {
    symbols: [u16; N],
    ends: Ends,
    min_bits: u32,
    max_bits: u32,
    is_complete: bool,
}

impl<const N: usize> Sorted<N> {
    /// `None` if there are more symbols than codes. `first` becomes symbol 0.
    #[inline(always)]
    fn new(coded: &[Coded], first: u16) -> Option<Self> {
        let mut counts = [0u16; MAX_CODE_BITS + 1];
        for it in coded {
            *counts.at_mut(it.bits()) += 1;
        }
        let mut next = [0u16; MAX_CODE_BITS + 1];
        let (mut start, mut unused, mut lengths) = (0, 1i32, 0u32);
        for (bits, (&count, next)) in counts.iter().zip(&mut next).enumerate().skip(1) {
            *next = start;
            start += count;
            // Once below zero it stays there.
            unused = 2 * unused - i32::from(count);
            lengths |= u32::from(count != 0) << bits;
        }
        if unused < 0 {
            return None;
        }
        let mut symbols = [0; _];
        for it in coded {
            let next = next.at_mut(it.bits());
            *symbols.at_mut(usize::from(*next)) = it.symbol() - first;
            *next += 1;
        }
        Some(Self {
            symbols,
            ends: Ends(next),
            min_bits: lengths.trailing_zeros(),
            max_bits: lengths.checked_ilog2().unwrap_or(0),
            is_complete: unused == 0,
        })
    }

    #[inline(always)]
    fn of_length(&self, bits: u32) -> &[u16] {
        self.ends.of_length(bits, &self.symbols)
    }
}

impl<T: Copy + From<Entry>, const ROOT: usize, const SUBTABLES: usize> Table<T, ROOT, SUBTABLES> {
    const ROOT_BITS: u32 = ROOT.ilog2();

    #[inline(always)]
    pub(super) fn look_up(&self, stream: u64) -> T {
        *self.root.at(stream as usize % ROOT)
    }

    /// `stream` starts behind the bits of `link`.
    #[inline(always)]
    pub(super) fn follow(&self, link: Entry, stream: u64) -> T {
        let start = usize::from((link.0 >> 8) as u16);
        *self.subtables.at(start + link.small_number(stream))
    }

    /// From `bits` index bits to one more, which makes no difference.
    #[inline(always)]
    fn double(&mut self, bits: u32) {
        let len = 1 << bits.min(Self::ROOT_BITS - 1);
        self.root.copy_within(..len, len);
    }

    /// Returns the next code.
    #[inline(always)]
    fn put_codes(
        &mut self,
        symbols: &[u16],
        mut code: u16,
        bits: u32,
        mut entry_for: impl FnMut(usize, u16) -> T,
    ) -> u16 {
        for &symbol in symbols {
            let reversed = reversed(code, bits);
            *self.root.at_mut(reversed.into()) = entry_for(symbol.into(), reversed);
            code += 1;
        }
        code
    }

    /// With an index of `root_bits`. The code is complete. Returns the first longer code.
    #[inline(always)]
    fn fill_root<const N: usize>(
        &mut self,
        sorted: &Sorted<N>,
        root_bits: u32,
        entry_for: impl Fn(usize, u32) -> T,
    ) -> u16 {
        let mut code = 0;
        for bits in sorted.min_bits..=root_bits {
            let entry_for = |symbol, _| entry_for(symbol, bits);
            code = self.put_codes(sorted.of_length(bits), code, bits, entry_for) << 1;
            if bits < root_bits {
                self.double(bits);
            }
        }
        code
    }

    #[inline(always)]
    fn fill_subtables<const N: usize>(
        &mut self,
        sorted: &Sorted<N>,
        mut code: u16,
        entry_for: impl Fn(usize, u32) -> T,
    ) {
        let (mut prefix, mut start, mut end) = (usize::MAX, 0, 0);
        for bits in Self::ROOT_BITS + 1..=sorted.max_bits {
            let symbols = sorted.of_length(bits);
            let bits_in_subtable = bits - Self::ROOT_BITS;
            for (done, &symbol) in symbols.iter().enumerate() {
                let reversed = usize::from(reversed(code, bits));
                code += 1;
                if reversed % ROOT != prefix {
                    prefix = reversed % ROOT;
                    let (mut index_bits, mut used) = (bits_in_subtable, symbols.len() - done);
                    while used < 1 << index_bits && Self::ROOT_BITS + index_bits < sorted.max_bits {
                        index_bits += 1;
                        used = 2 * used + sorted.of_length(Self::ROOT_BITS + index_bits).len();
                    }
                    (start, end) = (end, end + (1 << index_bits));
                    *self.root.at_mut(prefix) =
                        Entry::subtable(start as u32, index_bits, Self::ROOT_BITS).into();
                }
                let entry = entry_for(symbol.into(), bits_in_subtable);
                for index in (start + reversed / ROOT..end).step_by(1 << bits_in_subtable) {
                    *self.subtables.at_mut(index) = entry;
                }
            }
            code <<= 1;
        }
    }

    /// Only no code at all, or just one of a single bit, is let through.
    #[cold]
    fn fill_incomplete<const N: usize>(
        &mut self,
        sorted: &Sorted<N>,
        entry_for: impl Fn(usize, u32) -> T,
    ) -> bool {
        self.root.fill(Entry::special(Special::Invalid, 1).into());
        if sorted.max_bits == 1 {
            let entry = entry_for((*sorted.symbols.at(0)).into(), 1);
            self.root.iter_mut().step_by(2).for_each(|it| *it = entry);
        }
        sorted.max_bits <= 1
    }
}

impl Tables {
    pub(super) const EMPTY: Self = Self {
        literal_length: Table {
            root: [Entry(0); _],
            subtables: [Entry(0); _],
        },
        distance: Table {
            root: [DistanceEntry(0); _],
            subtables: [DistanceEntry(0); _],
        },
    };

    /// The symbol is the first literal.
    #[inline(always)]
    pub(super) fn code_length(&self, stream: u64) -> Entry {
        self.literal_length
            .look_up(stream % (1 << MAX_CODE_LENGTH_BITS))
    }

    /// `false` if the lengths do not make a code.
    pub(super) fn build_code_length(&mut self, coded: &[Coded]) -> bool {
        let table = &mut self.literal_length;
        if coded.is_empty() {
            // As in zlib, which finds fault with the block once it has read a bit for each length.
            table.root.fill(Entry::literal(0, 1));
            return true;
        }
        let Some(sorted) = Sorted::<32>::new(coded, 0).filter(|it| it.is_complete) else {
            return false;
        };
        let entry_for = |symbol, bits| Entry::literal(symbol as u8, bits);
        table.fill_root(&sorted, MAX_CODE_LENGTH_BITS as u32, entry_for);
        true
    }

    /// `first` is what `coded` calls the first distance symbol.
    pub(super) fn build_distance(&mut self, coded: &[Coded], first: u16) -> bool {
        let table = &mut self.distance;
        let Some(sorted) = Sorted::<32>::new(coded, first) else {
            return false;
        };
        if !sorted.is_complete {
            return table.fill_incomplete(&sorted, DistanceEntry::new);
        }
        let code = table.fill_root(&sorted, DISTANCE_BITS, DistanceEntry::new);
        table.fill_subtables(&sorted, code, DistanceEntry::new);
        true
    }

    /// With `combines`, entries stand for as much as their index has room for, which takes time.
    pub(super) fn build_literal_length(&mut self, coded: &[Coded], combines: bool) -> bool {
        let Some(sorted) = Sorted::<512>::new(coded, 0) else {
            return false;
        };
        if !sorted.is_complete {
            return self.literal_length.fill_incomplete(&sorted, Entry::new);
        }
        let code = if combines {
            self.fill_combined_root(&sorted)
        } else {
            self.literal_length
                .fill_root(&sorted, LITERAL_LENGTH_BITS, Entry::new)
        };
        self.literal_length
            .fill_subtables(&sorted, code, Entry::new);
        true
    }

    #[inline(never)]
    fn fill_combined_root(&mut self, sorted: &Sorted<512>) -> u16 {
        let table = &mut self.literal_length;
        let mut literals = List::<{ END_OF_BLOCK + 1 }>::new();
        let mut followers = List::<{ LITERAL_LENGTH_SYMBOLS + 1 }>::new();
        let mut with_extra_bits = List::<32>::new();
        let mut code = 0;
        for bits in sorted.min_bits..=LITERAL_LENGTH_BITS {
            code = table.put_codes(sorted.of_length(bits), code, bits, |symbol, code| {
                let entry = Entry::new(symbol, bits);
                literals.push_if(entry.is_only_literals(), code, entry.0);
                followers.push_if(!entry.is_special(), code, entry.as_second());
                with_extra_bits.push_if(entry.fits_with_extra_bits(), code, entry.0);
                entry
            }) << 1;
            literals.end_length(bits);
            followers.end_length(bits);
            for first_bits in sorted.min_bits..=bits - sorted.min_bits {
                let followers = followers.of_length(bits - first_bits);
                for &[first_code, first] in literals.of_length(first_bits) {
                    for &[second_code, second] in followers {
                        let index = first_code | second_code << first_bits;
                        *table.root.at_mut(index as usize) = Entry(first + second);
                    }
                }
            }
            if bits < LITERAL_LENGTH_BITS {
                table.double(bits);
            }
        }
        for &[code, entry] in with_extra_bits.items.iter().take(with_extra_bits.len) {
            let entry = Entry(entry);
            let slots = table.root.iter_mut().skip(code as usize);
            for (stream, slot) in (0..).zip(slots.step_by(1 << entry.bits())) {
                *slot = entry.with_extra_bits(stream);
            }
        }
        code
    }
}

/// Codes in the order of their lengths, each with a number. There is room for one less than `N`.
struct List<const N: usize> {
    items: [[u32; 2]; N],
    len: usize,
    ends: Ends,
}

impl<const N: usize> List<N> {
    #[inline(always)]
    fn new() -> Self {
        Self {
            items: [[0; _]; _],
            len: 0,
            ends: Ends::default(),
        }
    }

    #[inline(always)]
    fn push_if(&mut self, condition: bool, code: u16, number: u32) {
        *self.items.at_mut(self.len) = [code.into(), number];
        self.len += usize::from(condition);
    }

    #[inline(always)]
    fn end_length(&mut self, bits: u32) {
        *self.ends.0.at_mut(bits as usize) = self.len as u16;
    }

    #[inline(always)]
    fn of_length(&self, bits: u32) -> &[[u32; 2]] {
        self.ends.of_length(bits, &self.items)
    }
}
