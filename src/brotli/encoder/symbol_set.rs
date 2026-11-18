use core::array::from_fn;

use crate::format::COMMAND_SYMBOLS;

pub(super) const GROUP: usize = 16;
const WORD: usize = 64;

/// Most of an alphabet is unused, so loops over the other symbols are short.
#[derive(Clone, Copy)]
pub(super) struct SymbolSet {
    words: [u64; COMMAND_SYMBOLS / WORD],
    word_count: usize,
}

/// A bit for each index below `count`, which is up to [`GROUP`].
#[inline(always)]
pub(super) fn group_where(count: usize, test: impl Fn(usize) -> bool) -> u64 {
    let mut bits = 0;
    for i in 0..count {
        bits |= u16::from(test(i)) << i;
    }
    u64::from(bits)
}

impl SymbolSet {
    #[inline(always)]
    pub(super) fn matching<T: Copy>(values: &[T], test: impl Fn(T) -> bool) -> Self {
        let mut words = [0; _];
        let (groups, rest) = values.as_chunks::<GROUP>();
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
            word_count: values.len().div_ceil(WORD),
        }
    }

    /// The symbols whose value passes `test` together with the next one.
    #[inline(always)]
    pub(super) fn matching_next<T: Copy>(values: &[T], test: impl Fn(T, T) -> bool) -> Self {
        let mut words = [0; _];
        let (next_groups, next_rest) = values[1..].as_chunks::<GROUP>();
        for (index, (group, next)) in values.as_chunks().0.iter().zip(next_groups).enumerate() {
            let (first, group): (_, &[T; GROUP]) = (index * GROUP, group);
            words[first / WORD] |=
                group_where(GROUP, |i| test(group[i], next[i])) << (first % WORD);
        }
        if !next_rest.is_empty() {
            let first = next_groups.len() * GROUP;
            let bits = group_where(next_rest.len(), |i| test(values[first + i], next_rest[i]));
            words[first / WORD] |= bits << (first % WORD);
        }
        Self {
            words,
            word_count: (values.len() - 1).div_ceil(WORD),
        }
    }

    /// After the last symbol.
    #[inline(always)]
    pub(super) fn end(&self) -> usize {
        let last = self.words.iter().rposition(|&word| word != 0);
        last.map_or(0, |i| i * WORD + self.words[i].ilog2() as usize + 1)
    }

    /// The symbols below [`end`](Self::end) but for runs of five zeros or seven other counts. `self` has the others.
    #[inline(always)]
    pub(super) fn outside_long_runs(&self, counts: &[u32]) -> Self {
        const MARGIN: usize = 8;
        let end = self.end();
        let whole_groups = &counts[..counts.len().min(end.next_multiple_of(GROUP) + 1)];
        let same_as_next = Self::matching_next(whole_groups, |count, next| count == next);
        let (mut words, word_count) = ([0; _], end.div_ceil(WORD));
        for (i, word) in words[..word_count].iter_mut().enumerate() {
            let around = |set: &Self| {
                let at = |i: usize| u128::from(set.words.get(i).copied().unwrap_or(0));
                (at(i.wrapping_sub(1)) >> (WORD - MARGIN))
                    | (at(i) << MARGIN)
                    | (at(i + 1) << (WORD + MARGIN))
            };
            // Where so many equal counts start.
            let two = around(&same_as_next);
            let three = two & (two >> 1);
            let five = three & (three >> 2);
            let seven = five & (three >> 4);
            let first = (five & !around(self)) | seven | (seven << 2);
            let first_two = first | (first << 1);
            *word = !((first_two | (first_two << 2) | (first << 4)) >> MARGIN) as u64;
        }
        words[word_count - 1] &= u64::MAX >> (end.wrapping_neg() % WORD);
        Self { words, word_count }
    }

    #[inline(always)]
    pub(super) fn union(&self, other: &Self) -> Self {
        Self {
            words: from_fn(|i| self.words[i] | other.words[i]),
            word_count: self.word_count.max(other.word_count),
        }
    }

    pub(super) fn words(&self) -> &[u64; COMMAND_SYMBOLS / WORD] {
        &self.words
    }

    /// Up to the last symbol: how many are missing alone or in twos, and how often more are missing in a row.
    #[inline(always)]
    pub(super) fn gaps(&self) -> [u32; 2] {
        let (mut after_missing, mut previous) = ([0; 3], u64::MAX);
        for &word in &self.words[..self.word_count] {
            let mut symbols = word;
            for (missing, count) in (1..).zip(&mut after_missing) {
                symbols &= !((word << missing) | (previous >> (u64::BITS - missing)));
                *count += symbols.count_ones();
            }
            previous = word;
        }
        let [one, two, three] = after_missing;
        [one + two - 2 * three, three]
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
