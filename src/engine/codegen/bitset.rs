//! Dense sets of small integers.

const BITS: usize = u64::BITS as usize;

#[inline]
pub(crate) fn words_for(bits: usize) -> usize {
    bits.div_ceil(BITS)
}

#[inline]
pub(crate) fn contains(words: &[u64], bit: usize) -> bool {
    words[bit / BITS] >> (bit % BITS) & 1 != 0
}

/// Returns whether the bit is new.
#[inline]
pub(crate) fn insert(words: &mut [u64], bit: usize) -> bool {
    let (word, mask) = (&mut words[bit / BITS], 1 << (bit % BITS));
    let is_new = *word & mask == 0;
    *word |= mask;
    is_new
}

#[inline]
pub(crate) fn remove(words: &mut [u64], bit: usize) {
    words[bit / BITS] &= !(1 << (bit % BITS));
}

#[inline]
pub(crate) fn iter(words: &[u64]) -> impl Iterator<Item = usize> {
    words.iter().enumerate().flat_map(|(index, &word)| {
        core::iter::successors((word != 0).then_some(word), |&rest| {
            Some(rest & (rest - 1)).filter(|&rest| rest != 0)
        })
        .map(move |rest| index * BITS + rest.trailing_zeros() as usize)
    })
}

#[derive(Clone, Default)]
pub struct BitSet {
    words: Vec<u64>,
}

impl BitSet {
    pub fn with_size(bits: usize) -> Self {
        Self {
            words: vec![0; words_for(bits)],
        }
    }

    /// Empties the set and keeps the allocation.
    pub fn reset(&mut self, bits: usize) {
        self.words.clear();
        self.words.resize(words_for(bits), 0);
    }

    #[inline]
    pub fn contains(&self, bit: usize) -> bool {
        contains(&self.words, bit)
    }

    /// Returns whether the bit is new.
    #[inline]
    pub fn insert(&mut self, bit: usize) -> bool {
        insert(&mut self.words, bit)
    }

    #[inline]
    pub fn remove(&mut self, bit: usize) {
        remove(&mut self.words, bit);
    }

    pub fn iter(&self) -> impl Iterator<Item = usize> {
        iter(&self.words)
    }
}
