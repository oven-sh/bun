use core::array::from_fn;

use crate::format::COMMAND_SYMBOLS;

const GROUP: usize = 16;
const WORD: usize = 64;

/// Most of an alphabet is unused, so loops over the other symbols are short.
#[derive(Clone, Copy)]
pub(super) struct SymbolSet {
    words: [u64; COMMAND_SYMBOLS / WORD],
    word_count: usize,
}

#[inline(always)]
fn group_where(count: usize, test: impl Fn(usize) -> bool) -> u64 {
    let mut bits = 0;
    for i in 0..count {
        bits |= u16::from(test(i)) << i;
    }
    u64::from(bits)
}

impl SymbolSet {
    #[inline(always)]
    pub(super) fn matching(counts: &[u32], test: impl Fn(u32) -> bool) -> Self {
        let mut words = [0; _];
        let (groups, rest) = counts.as_chunks::<GROUP>();
        for (index, group) in groups.iter().enumerate() {
            let first = index * GROUP;
            words[first / WORD] |= group_where(GROUP, |i| test(group[i])) << (first % WORD);
        }
        if !rest.is_empty() {
            let first = groups.len() * GROUP;
            words[first / WORD] |= group_where(rest.len(), |i| test(rest[i])) << (first % WORD);
        }
        Self {
            words,
            word_count: counts.len().div_ceil(WORD),
        }
    }

    /// The symbols whose value differs from the next one, in the whole groups before the last value.
    #[inline(always)]
    pub(super) fn run_ends(values: &[u8]) -> Self {
        let mut words = [0; _];
        let (groups, next_groups) = (values.as_chunks::<GROUP>().0, values[1..].as_chunks().0);
        for (index, (group, next)) in groups.iter().zip(next_groups).enumerate() {
            let (first, next): (_, &[u8; GROUP]) = (index * GROUP, next);
            words[first / WORD] |= group_where(GROUP, |i| group[i] != next[i]) << (first % WORD);
        }
        Self {
            words,
            word_count: (values.len() - 1).div_ceil(WORD),
        }
    }

    #[inline(always)]
    pub(super) fn union(&self, other: &Self) -> Self {
        Self {
            words: from_fn(|i| self.words[i] | other.words[i]),
            ..*self
        }
    }

    #[inline(always)]
    pub(super) fn len(&self) -> usize {
        let words = self.words[..self.word_count].iter();
        words.map(|word| word.count_ones() as usize).sum()
    }
}

impl<'a> IntoIterator for &'a SymbolSet {
    type Item = usize;
    type IntoIter = Symbols<'a>;

    #[inline(always)]
    fn into_iter(self) -> Symbols<'a> {
        Symbols {
            rest: &self.words[..self.word_count],
            bits: 0,
            next_base: 0,
        }
    }
}

/// In ascending order.
pub(super) struct Symbols<'a> {
    rest: &'a [u64],
    bits: u64,
    next_base: usize,
}

impl Iterator for Symbols<'_> {
    type Item = usize;

    #[inline(always)]
    fn next(&mut self) -> Option<usize> {
        while self.bits == 0 {
            self.bits = *self.rest.split_off_first()?;
            self.next_base += WORD;
        }
        let symbol = self.next_base - WORD + self.bits.trailing_zeros() as usize;
        self.bits &= self.bits - 1;
        Some(symbol)
    }
}
