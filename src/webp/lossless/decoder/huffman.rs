//! Prefix codes as lookup tables, indexed by the bits that come next.

use core::hint::cold_path;
use core::ops::Range;

use super::bit_reader::BitReader;
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, DEFAULT_CODE_LENGTH, MAX_CODE_LENGTH,
};
use crate::slice::{InBounds, known};
use crate::vec;

pub(super) const ROOT_BITS: u32 = 8;

/// A symbol and the length of its code. In a root table a length above `ROOT_BITS` is that of the longest code
/// that starts with these bits, and the value is where their table starts among those of the group.
///
/// From the lowest bit: 4 for the length, the upper 4 of the value, its lower 8.
#[derive(Clone, Copy, Default)]
pub(super) struct Entry(u16);

impl Entry {
    /// Both the alphabets and the room that the second tables of a group take are smaller.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dec/vp8l_dec.c#L89
    const VALUES: usize = 1 << 12;

    const fn new(value: usize, len: u32) -> Self {
        Self((value as u16) << 8 | (value as u16) >> 8 << 4 | len as u16)
    }

    #[inline(always)]
    pub(super) const fn value(self) -> usize {
        (self.0 >> 8 | (self.0 & 0xf0) << 4) as usize
    }

    #[inline(always)]
    pub(super) const fn len(self) -> u32 {
        (self.0 & 15) as u32
    }

    /// The entry that one in a root table refers to.
    #[inline(always)]
    fn long(self, second_tables: &[Self], reader: &BitReader) -> Self {
        cold_path();
        let index = (reader.peek() & ((1 << self.len()) - 1)) >> ROOT_BITS;
        let entry = second_tables.get(self.value() + index);
        entry.copied().unwrap_or_default()
    }
}

pub(super) struct Code {
    root: [Entry; 1 << ROOT_BITS],
    /// Of the longest code. 0: there is one symbol.
    pub(super) max_len: u32,
}

impl Code {
    pub(super) const EMPTY: Self = Self {
        root: [Entry(0); 1 << ROOT_BITS],
        max_len: 0,
    };

    /// For bits that start with a code of up to `ROOT_BITS`.
    #[inline(always)]
    pub(super) fn short(&self, bits: usize) -> Entry {
        *self.root.at(bits % self.root.len())
    }

    /// `reader` has `MAX_CODE_LENGTH` bits, of which the first `ROOT_BITS` have been `peeked`.
    #[inline(always)]
    pub(super) fn read(
        &self,
        peeked: usize,
        second_tables: &[Entry],
        reader: &mut BitReader,
    ) -> usize {
        let mut entry = self.short(peeked);
        let [len, value] = entry.0.to_le_bytes();
        if u32::from(len) <= ROOT_BITS {
            reader.skip(len.into());
            return value.into();
        }
        if entry.len() > ROOT_BITS {
            entry = entry.long(second_tables, reader);
        }
        reader.skip(entry.len());
        entry.value()
    }

    /// For an alphabet of up to 256 symbols. `reader` has `MAX_CODE_LENGTH` bits.
    #[inline(always)]
    pub(super) fn read_byte(&self, second_tables: &[Entry], reader: &mut BitReader) -> u32 {
        let mut entry = self.short(reader.peek());
        if u32::from(entry.0 as u8) > ROOT_BITS {
            entry = entry.long(second_tables, reader);
        }
        let [len, value] = entry.0.to_le_bytes();
        reader.skip(len.into());
        value.into()
    }
}

/// The symbols of an alphabet that have a code, and how long it is.
pub(super) struct CodeLengths {
    /// In ascending order.
    symbols: Vec<Entry>,
    /// How many have a code of each length.
    counts: [u16; MAX_CODE_LENGTH + 1],
    /// For `build()`: `symbols` by the length of their codes.
    sorted: Vec<Entry>,
}

impl CodeLengths {
    pub(super) fn new(max_alphabet_len: usize) -> Result<Self> {
        Ok(Self {
            symbols: vec::with_room(max_alphabet_len)?,
            counts: [0; MAX_CODE_LENGTH + 1],
            sorted: vec::with_room(max_alphabet_len)?,
        })
    }

    /// Fails unless they make a prefix code, which the zeros behind the end of the data do not.
    pub(super) fn read(&mut self, reader: &mut BitReader, alphabet_len: usize) -> Result<()> {
        if reader.read_flag() {
            self.read_simple(reader, alphabet_len);
        } else {
            self.read_normal(reader, alphabet_len)?;
        }
        self.check()
    }

    fn clear(&mut self) {
        self.symbols.clear();
        self.counts.fill(0);
    }

    fn push(&mut self, symbols: Range<usize>, len: u32) {
        if len != 0 {
            *self.counts.at_mut(len as usize) += symbols.len() as u16;
            self.symbols
                .extend(symbols.map(|symbol| Entry::new(symbol, len)));
        }
    }

    fn read_simple(&mut self, reader: &mut BitReader, alphabet_len: usize) {
        let has_two = reader.read_flag();
        let first_bits = if reader.read_flag() { 8 } else { 1 };
        let first = reader.read(first_bits) as usize;
        let second = if has_two {
            reader.read(8) as usize
        } else {
            first
        };
        let (low, high) = (first.min(second), first.max(second));
        self.clear();
        // One that is not in the alphabet does not count.
        for symbol in [low, high].into_iter().skip(usize::from(low == high)) {
            self.push(symbol..alphabet_len.min(symbol + 1), 1);
        }
    }

    fn read_normal(&mut self, reader: &mut BitReader, alphabet_len: usize) -> Result<()> {
        let stored = reader.read(4) as usize + 4;
        let mut lengths = [0; CODE_LENGTH_CODES];
        for &symbol in CODE_LENGTH_CODE_ORDER.iter().take(stored) {
            *lengths.at_mut(symbol.into()) = reader.read(3);
        }
        self.clear();
        for (symbol, len) in lengths.into_iter().enumerate() {
            self.push(symbol..symbol + 1, len);
        }
        self.check()?;
        let mut code = Code::EMPTY;
        self.build_root(&mut code);

        let mut codes_left = alphabet_len;
        if reader.read_flag() {
            let bits = 2 + 2 * reader.read(3);
            codes_left = 2 + reader.read(bits) as usize;
            if codes_left > alphabet_len {
                return Err(Error::InvalidLosslessBitstream);
            }
        }
        self.clear();
        let mut symbol = 0;
        let mut previous = DEFAULT_CODE_LENGTH.into();
        while codes_left > 0 && symbol < alphabet_len {
            codes_left -= 1;
            reader.ensure(7 + 7);
            let (len, repeat) = match code.read_byte(&[], reader) {
                16 => (previous, 3 + reader.take(2)),
                17 => (0, 3 + reader.take(3)),
                18 => (0, 11 + reader.take(7)),
                len => (len, 1),
            };
            let end = symbol + repeat as usize;
            if end > alphabet_len {
                return Err(Error::InvalidLosslessBitstream);
            }
            self.push(symbol..end, len);
            symbol = end;
            previous = if len == 0 { previous } else { len };
        }
        Ok(())
    }

    fn check(&self) -> Result<()> {
        // In units of what a code of the greatest length takes.
        let counts = self.counts.iter();
        let space_taken = counts.fold(0, |sum, &count| 2 * sum + u32::from(count));
        if space_taken == 1 << MAX_CODE_LENGTH || self.symbols.len() == 1 {
            Ok(())
        } else {
            Err(Error::InvalidLosslessBitstream)
        }
    }

    /// `code` is `Code::EMPTY`. The tables of its group start at `first` in `second_tables`.
    pub(super) fn build(
        &mut self,
        code: &mut Code,
        second_tables: &mut Vec<Entry>,
        first: usize,
    ) -> Result<()> {
        let mut unplaced = self.counts;
        let (mut key, long) = self.build_root(code);
        let mut root_key = usize::MAX;
        let mut table = first;
        for &symbol in long {
            let len = symbol.len();
            if key % code.root.len() != root_key {
                root_key = key % code.root.len();
                table = second_tables.len();
                if table - first >= Entry::VALUES {
                    return Err(Error::Internal);
                }
                let longest = longest_with_same_root(&unplaced, len);
                *code.root.at_mut(root_key) = Entry::new(table - first, longest);
                second_tables.try_reserve(1 << (longest - ROOT_BITS))?;
                second_tables.resize(table + (1 << (longest - ROOT_BITS)), Entry::default());
            }
            second_tables
                .iter_mut()
                .skip(table + (key >> ROOT_BITS))
                .step_by(1 << (len - ROOT_BITS))
                .for_each(|it| *it = symbol);
            key = next_key(key, len);
            code.max_len = len;
            *unplaced.at_mut(len as usize) -= 1;
        }
        Ok(())
    }

    /// Only for the codes of up to `ROOT_BITS`. Returns the bits of the next code in the order they are read, the first
    /// one lowest, and the symbols that are left.
    fn build_root(&mut self, code: &mut Code) -> (usize, &[Entry]) {
        if let [only] = *self.symbols {
            code.root.fill(Entry::new(only.value(), 0));
            return (0, &[]);
        }

        let mut start = 0;
        let mut next = self.counts.map(|count| {
            start += count;
            start - count
        });
        self.sorted.resize(self.symbols.len(), Entry::default());
        for &symbol in &self.symbols {
            let next = next.at_mut(symbol.len() as usize);
            self.sorted.set((*next).into(), symbol);
            *next += 1;
        }

        let mut sorted = self.sorted.iter();
        let mut key = 0;
        for len in 1..=ROOT_BITS {
            // A table for codes one bit longer is the table so far twice over.
            let halves = code.root.split_at_mut_checked(1 << (len - 1));
            let (low, high) = known(halves).unwrap_or_default();
            high.iter_mut().zip(low).for_each(|(to, from)| *to = *from);
            for &symbol in sorted.by_ref().take((*self.counts.at(len as usize)).into()) {
                *code.root.at_mut(key) = symbol;
                key = next_key(key, len);
                code.max_len = len;
            }
        }
        (key, sorted.as_slice())
    }
}

/// Adds one to the `len` bits of `key` written backwards.
fn next_key(key: usize, len: u32) -> usize {
    let zeros = !key & ((1 << len) - 1);
    match zeros.checked_ilog2() {
        Some(highest) => key & ((1 << highest) - 1) | 1 << highest,
        None => key,
    }
}

/// `counts` are of the codes that are left. The next of them has `len` bits, and is the first with its root.
fn longest_with_same_root(counts: &[u16; MAX_CODE_LENGTH + 1], mut len: u32) -> u32 {
    let mut room = 1i32 << (len - ROOT_BITS);
    while len < MAX_CODE_LENGTH as u32 {
        room -= i32::from(*counts.at(len as usize));
        if room <= 0 {
            break;
        }
        room *= 2;
        len += 1;
    }
    len
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_can_say_where_its_table_starts() -> Result<()> {
        let mut lengths = CodeLengths::new(10)?;
        for len in 1..=ROOT_BITS {
            lengths.push(0..1, len);
        }
        lengths.push(0..2, ROOT_BITS + 1);
        let mut build = |first, start| {
            let mut tables = vec::filled(Entry::default(), first + start)?;
            lengths.build(&mut { Code::EMPTY }, &mut tables, first)
        };
        assert_eq!(build(0, Entry::VALUES - 1), Ok(()));
        assert_eq!(build(0, Entry::VALUES), Err(Error::Internal));
        assert_eq!(build(Entry::VALUES, 0), Ok(()));
        let last = Entry::new(Entry::VALUES - 1, MAX_CODE_LENGTH as u32);
        assert_eq!(
            (last.value(), last.len()),
            (Entry::VALUES - 1, MAX_CODE_LENGTH as u32)
        );
        Ok(())
    }
}
