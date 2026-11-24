//! Tables that tell what the next bits of a block stand for.

use bun_deflate::format::{
    END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MAX_CODEWORD_LEN, MAX_PRECODE_LEN,
    MIN_MATCH_LEN, OFFSET_SYMBOLS, length_slot, offset_slot, static_litlen_codeword,
    static_offset_codeword,
};

use crate::array::At;
use crate::format::{DISTANCE_SYMBOLS, LITERAL_LENGTH_SYMBOLS, reversed};

pub(super) const LITERAL_LENGTH_BITS: u32 = 11;
pub(super) const DISTANCE_BITS: u32 = 8;

/// The lowest 6 bits tell how many bits of the stream it stands for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Entry(pub(super) u32);

/// A special `Entry`, or something that has its lowest byte.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct DistanceEntry(pub(super) u64);

#[derive(Clone, Copy)]
pub(super) enum Special {
    Invalid,
    Subtable,
    LengthWithExtraBits,
    EndOfBlock,
}

impl Entry {
    const ONLY_LITERALS: u32 = 1 << 6;
    const MATCH: u32 = 1 << 7;
    /// Of the first literal, or of where the subtable starts.
    const FIRST_SHIFT: u32 = 8;
    /// Of the second literal, or of the length less 3.
    const SECOND_SHIFT: u32 = 16;
    const SMALL_SHIFT: u32 = 24;
    const KIND_SHIFT: u32 = 28;
    const LITERAL_COUNT_SHIFT: u32 = 30;
    const ONE_LITERAL: u32 = 1 << Self::LITERAL_COUNT_SHIFT;

    const fn special(kind: Special, bits: u32) -> Self {
        Self((kind as u32) << Self::KIND_SHIFT | bits)
    }

    const fn subtable(start: u32, index_bits: u32) -> Self {
        let special = Self::special(Special::Subtable, 0);
        Self(special.0 | index_bits << Self::SMALL_SHIFT | start << Self::FIRST_SHIFT)
    }

    const fn length(length: u32, bits: u32) -> Self {
        Self((length - MIN_MATCH_LEN as u32) << Self::SECOND_SHIFT | Self::MATCH | bits)
    }

    const fn literal(literal: u8, bits: u32) -> Self {
        let literal = Self::ONE_LITERAL | (literal as u32) << Self::FIRST_SHIFT;
        Self(literal | bits << Self::SMALL_SHIFT | Self::ONLY_LITERALS | bits)
    }

    const fn new(symbol: usize, bits: u32) -> Self {
        match symbol {
            0..END_OF_BLOCK => Self::literal(symbol as u8, bits),
            END_OF_BLOCK => Self::special(Special::EndOfBlock, bits),
            FIRST_LENGTH_SYMBOL..LITERAL_LENGTH_SYMBOLS => {
                let range = length_slot(symbol - FIRST_LENGTH_SYMBOL);
                if range.extra_bits == 0 {
                    return Self::length(range.base, bits);
                }
                let special = Self::special(Special::LengthWithExtraBits, bits);
                let base = (range.base - MIN_MATCH_LEN as u32) << Self::SECOND_SHIFT;
                Self(special.0 | range.extra_bits << Self::SMALL_SHIFT | base)
            }
            _ => Self::special(Special::Invalid, bits),
        }
    }

    /// What is added to the entry of a literal for it to stand for this one too, which is not special.
    const fn as_second(self) -> u32 {
        if self.0 & Self::MATCH != 0 {
            return self.0 - Self::ONLY_LITERALS;
        }
        Self::ONE_LITERAL | (self.first_literal() as u32) << Self::SECOND_SHIFT | self.bits()
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
        self.0 & Self::ONLY_LITERALS != 0
    }

    #[inline(always)]
    pub(super) const fn is_special(self) -> bool {
        self.0 & (Self::ONLY_LITERALS | Self::MATCH) == 0
    }

    /// Of a special one.
    #[inline(always)]
    pub(super) const fn kind(self) -> Special {
        match (self.0 >> Self::KIND_SHIFT) % 4 {
            0 => Special::Invalid,
            1 => Special::Subtable,
            2 => Special::LengthWithExtraBits,
            _ => Special::EndOfBlock,
        }
    }

    #[inline(always)]
    pub(super) const fn literal_count(self) -> usize {
        (self.0 >> Self::LITERAL_COUNT_SHIFT) as usize
    }

    /// The first `literal_count()` are.
    #[inline(always)]
    pub(super) const fn literals(self) -> [u8; 4] {
        self.0.rotate_right(Self::FIRST_SHIFT).to_le_bytes()
    }

    #[inline(always)]
    pub(super) const fn first_literal(self) -> u8 {
        (self.0 >> Self::FIRST_SHIFT) as u8
    }

    #[inline(always)]
    pub(super) const fn match_length(self) -> usize {
        (self.0 >> Self::SECOND_SHIFT) as u8 as usize + MIN_MATCH_LEN
    }

    /// How many bits there are in the first literal's code, behind a length's code, or in the index of the subtable.
    #[inline(always)]
    pub(super) const fn small(self) -> u32 {
        (self.0 >> Self::SMALL_SHIFT) % 16
    }

    /// The first `small()` bits.
    #[inline(always)]
    pub(super) const fn small_number(self, stream: u64) -> usize {
        (stream & ((1 << self.small()) - 1)) as usize
    }
}

impl DistanceEntry {
    const CODE_BITS_SHIFT: u32 = 8;
    const BASE_SHIFT: u32 = 16;
    const EXTRA_MASK_SHIFT: u32 = 32;

    const fn new(symbol: usize, bits: u32) -> Self {
        if symbol >= DISTANCE_SYMBOLS {
            return Self(Entry::special(Special::Invalid, bits).0 as u64);
        }
        let range = offset_slot(symbol);
        let lowest = Entry::MATCH | (bits + range.extra_bits);
        let lower = range.base << Self::BASE_SHIFT | bits << Self::CODE_BITS_SHIFT | lowest;
        Self(((1 << range.extra_bits) - 1) << Self::EXTRA_MASK_SHIFT | lower as u64)
    }

    /// Only `bits()` and `is_special()` make sense for one that is not special.
    #[inline(always)]
    pub(super) const fn entry(self) -> Entry {
        Entry(self.0 as u32)
    }

    /// `stream` starts with the bits that the entry stands for.
    #[inline(always)]
    pub(super) const fn distance(self, stream: u64) -> usize {
        let behind_code = stream.wrapping_shr(self.0 as u32 >> Self::CODE_BITS_SHIFT) as u32;
        let extra = behind_code & (self.0 >> Self::EXTRA_MASK_SHIFT) as u32;
        ((self.0 as u32 >> Self::BASE_SHIFT) + extra) as usize
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
    pub(super) distance: Table<DistanceEntry, { 1 << DISTANCE_BITS }, 192>,
    /// The bits that index the root of `literal_length`.
    pub(super) literal_length_mask: u64,
}

// mimalloc's next size is that of node:zlib's chunks, which are freed late, so that each stream would get cold memory.
const _: () = assert!(size_of::<Tables>() <= 14 * 1024);

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
pub(super) static FIXED: Tables = {
    let mut tables = Tables::EMPTY;
    tables.literal_length_mask = u64::MAX;
    let mut symbol = 0;
    while symbol < LITLEN_SYMBOLS {
        let code = static_litlen_codeword(symbol);
        let (entry, bits, mut index) = (Entry::new(symbol, code.len), code.len, code.bits as usize);
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
        let (symbol, others) = (index % OFFSET_SYMBOLS, index - index % OFFSET_SYMBOLS);
        let code = static_offset_codeword(symbol);
        tables.distance.root[others + code.bits as usize] = DistanceEntry::new(symbol, code.len);
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
struct Ends([u16; MAX_CODEWORD_LEN as usize + 1]);

impl Ends {
    #[inline(always)]
    fn of_length<'a, T>(&self, bits: u32, list: &'a [T]) -> &'a [T] {
        let [start, end] = [bits - 1, bits].map(|bits| usize::from(*self.0.at(bits as usize)));
        list.get(start..end).unwrap_or_default()
    }
}

/// The symbols in the order of their codes.
struct Sorted<'a> {
    symbols: &'a [u16],
    ends: Ends,
    min_bits: u32,
    max_bits: u32,
    is_complete: bool,
}

impl<'a> Sorted<'a> {
    /// `None` if there are more symbols than codes. `first` becomes symbol 0.
    #[inline(always)]
    fn new<const N: usize>(coded: &[Coded], first: u16, room: &'a mut [u16; N]) -> Option<Self> {
        let mut counts = [0u16; MAX_CODEWORD_LEN as usize + 1];
        for it in coded {
            *counts.at_mut(it.bits()) += 1;
        }
        let mut next = [0u16; MAX_CODEWORD_LEN as usize + 1];
        let (mut start, mut unused, mut lengths) = (0, 1i32, 0u32);
        for bits in 1..=MAX_CODEWORD_LEN as usize {
            let count = *counts.at(bits);
            *next.at_mut(bits) = start;
            start += count;
            // Once below zero it stays there.
            unused = 2 * unused - i32::from(count);
            lengths |= u32::from(count != 0) << bits;
        }
        if unused < 0 {
            return None;
        }
        for it in coded {
            let next = next.at_mut(it.bits());
            *room.at_mut(usize::from(*next)) = it.symbol() - first;
            *next += 1;
        }
        Some(Self {
            symbols: room,
            ends: Ends(next),
            min_bits: lengths.trailing_zeros(),
            max_bits: lengths.checked_ilog2().unwrap_or(0),
            is_complete: unused == 0,
        })
    }

    #[inline(always)]
    fn of_length(&self, bits: u32) -> &[u16] {
        self.ends.of_length(bits, self.symbols)
    }
}

impl<T: Copy + From<Entry>, const ROOT: usize, const SUBTABLES: usize> Table<T, ROOT, SUBTABLES> {
    const ROOT_BITS: u32 = ROOT.ilog2();

    #[inline(always)]
    pub(super) fn look_up(&self, stream: u64) -> T {
        *self.root.at(stream as usize % ROOT)
    }

    /// `stream` starts behind the index that `link` was found with.
    #[inline(always)]
    pub(super) fn follow(&self, link: Entry, stream: u64) -> T {
        let start = usize::from((link.0 >> Entry::FIRST_SHIFT) as u16);
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
    fn fill_root(
        &mut self,
        sorted: &Sorted<'_>,
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
    fn fill_subtables(
        &mut self,
        sorted: &Sorted<'_>,
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
                    *self.root.at_mut(prefix) = Entry::subtable(start as u32, index_bits).into();
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
    fn fill_incomplete(
        &mut self,
        sorted: &Sorted<'_>,
        entry_for: impl Fn(usize, u32) -> T,
    ) -> bool {
        self.root.fill(Entry::special(Special::Invalid, 1).into());
        if let &[symbol] = sorted.of_length(1) {
            let entry = entry_for(symbol.into(), 1);
            self.root.iter_mut().step_by(2).for_each(|it| *it = entry);
        }
        sorted.max_bits <= 1
    }
}

impl Tables {
    /// All zeros, which need not be copied from anywhere.
    pub(super) const EMPTY: Self = Self {
        literal_length: Table {
            root: [Entry(0); _],
            subtables: [Entry(0); _],
        },
        distance: Table {
            root: [DistanceEntry(0); _],
            subtables: [DistanceEntry(0); _],
        },
        literal_length_mask: 0,
    };

    /// The symbol is the first literal.
    #[inline(always)]
    pub(super) fn code_length(&self, stream: u64) -> Entry {
        self.literal_length.look_up(stream % (1 << MAX_PRECODE_LEN))
    }

    /// `false` if the lengths do not make a code.
    #[inline(never)]
    pub(super) fn build_code_length(&mut self, coded: &[Coded]) -> bool {
        let table = &mut self.literal_length;
        if coded.is_empty() {
            // As in zlib, which finds fault with the block once it has read a bit for each length.
            table.root.fill(Entry::literal(0, 1));
            return true;
        }
        let mut room = [0; 32];
        let Some(sorted) = Sorted::new(coded, 0, &mut room).filter(|it| it.is_complete) else {
            return false;
        };
        let entry_for = |symbol, bits| Entry::literal(symbol as u8, bits);
        table.fill_root(&sorted, MAX_PRECODE_LEN, entry_for);
        true
    }

    /// `first` is what `coded` calls the first distance symbol.
    #[inline(never)]
    pub(super) fn build_distance(&mut self, coded: &[Coded], first: u16) -> bool {
        let table = &mut self.distance;
        let mut room = [0; 32];
        let Some(sorted) = Sorted::new(coded, first, &mut room) else {
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
    #[inline(never)]
    pub(super) fn build_literal_length(&mut self, coded: &[Coded], combines: bool) -> bool {
        let mut room = [0; 512];
        let Some(sorted) = Sorted::new(coded, 0, &mut room) else {
            return false;
        };
        if !sorted.is_complete {
            self.literal_length_mask = 1;
            return self.literal_length.fill_incomplete(&sorted, Entry::new);
        }
        let code = if combines {
            self.literal_length_mask = u64::MAX;
            self.fill_combined_root(&sorted)
        } else {
            let root_bits = LITERAL_LENGTH_BITS.min(sorted.max_bits);
            self.literal_length_mask = (1 << root_bits) - 1;
            self.literal_length
                .fill_root(&sorted, root_bits, Entry::new)
        };
        self.literal_length
            .fill_subtables(&sorted, code, Entry::new);
        true
    }

    #[inline(never)]
    fn fill_combined_root(&mut self, sorted: &Sorted<'_>) -> u16 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fixed_tables_are_what_the_fixed_lengths_make() {
        let literal_lengths: [_; 288] = core::array::from_fn(|symbol| match symbol {
            144..256 => Coded::new(symbol as u16, 9),
            256..280 => Coded::new(symbol as u16, 7),
            _ => Coded::new(symbol as u16, 8),
        });
        let distances: [_; 32] = core::array::from_fn(|symbol| Coded::new(symbol as u16, 5));
        let mut built = Tables::EMPTY;
        assert!(built.build_literal_length(&literal_lengths, false));
        assert!(built.build_distance(&distances, 0));
        for (index, fixed) in (0..).zip(FIXED.literal_length.root) {
            let mut entry = built
                .literal_length
                .look_up(index & built.literal_length_mask);
            if entry.fits_with_extra_bits() {
                entry = entry.with_extra_bits(index >> entry.bits());
            }
            assert_eq!(fixed.0, entry.0, "{index}");
        }
        assert_eq!(
            FIXED.distance.root.map(|it| it.0),
            built.distance.root.map(|it| it.0)
        );
    }
}
