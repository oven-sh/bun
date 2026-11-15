use crate::{Int, Isa, Mask};

/// The indices at which a test holds, for as many as a vector has lanes.
#[derive(Clone, Copy)]
pub struct Matches {
    /// The lowest bit of each lane.
    bits: u64,
    log2_bits_per_lane: u32,
    start: usize,
}

impl Matches {
    #[inline(always)]
    pub(crate) fn new<T: Int<N>, const N: usize, I: Isa>(
        mask: Mask<T, N, I>,
        start: usize,
    ) -> Self {
        let (bits, bits_per_lane) = I::movemask(mask);
        Self {
            bits: bits & (u64::MAX / (u64::MAX >> (64 - bits_per_lane))),
            log2_bits_per_lane: bits_per_lane.ilog2(),
            start,
        }
    }

    #[inline(always)]
    pub(crate) fn from_bitmask(bits: u64) -> Self {
        Self {
            bits,
            log2_bits_per_lane: 0,
            start: 0,
        }
    }

    /// Without the first `count` lanes, which are not all of them. `None` if no match is left.
    #[inline(always)]
    pub(crate) fn skip_lanes(mut self, count: usize) -> Option<Self> {
        self.bits &= u64::MAX << (count << self.log2_bits_per_lane);
        (self.bits != 0).then_some(self)
    }

    /// Only the first `count` lanes, which are at least one. `None` if no match is left.
    #[inline(always)]
    pub(crate) fn take_lanes(mut self, count: usize) -> Option<Self> {
        self.bits &= u64::MAX >> (64 - (count << self.log2_bits_per_lane));
        (self.bits != 0).then_some(self)
    }

    #[inline(always)]
    fn index_of(self, bit: u32) -> usize {
        self.start + (bit >> self.log2_bits_per_lane) as usize
    }
}

impl Iterator for Matches {
    type Item = usize;

    #[inline(always)]
    fn next(&mut self) -> Option<usize> {
        let bit = self.bits.lowest_one()?;
        self.bits &= self.bits - 1;
        Some(self.index_of(bit))
    }
}

impl DoubleEndedIterator for Matches {
    #[inline(always)]
    fn next_back(&mut self) -> Option<usize> {
        let bit = self.bits.highest_one()?;
        self.bits ^= 1 << bit;
        Some(self.index_of(bit))
    }
}
