use crate::{Int, Isa, Mask, opaque};
use core::num::NonZero;

/// Up to 64 indices at which a test holds.
#[derive(Clone, Default)]
pub struct Matches {
    pub(crate) bits: u64,
    pub(crate) start: usize,
}

impl Matches {
    #[inline(always)]
    pub(crate) fn of<T: Int<N>, const N: usize, I: Isa>(
        masks: &[(Mask<T, N, I>, usize)],
        start: usize,
    ) -> Self {
        let bits = I::bitmask_of(masks);
        Self { bits, start }
    }

    /// The first index that was tested.
    #[inline(always)]
    pub fn start(&self) -> usize {
        self.start
    }

    /// Asks for each, from the first.
    #[inline(always)]
    pub fn retain(&mut self, mut keeps: impl FnMut(usize) -> bool) {
        let (mut rest, start) = (core::mem::take(&mut self.bits), self.start);
        while let Some(bit) = rest.lowest_one() {
            if keeps(start + bit as usize) {
                self.bits |= 1 << bit;
            }
            rest &= rest - 1;
        }
    }

    /// Keeps so many of the first or the last.
    #[inline(always)]
    pub fn truncate<const FORWARD: bool>(&mut self, count: usize) {
        let (all, mut last) = (self.bits.count_ones() as usize, self.bits);
        let kept = count.min(all);
        #[rustc_unroll(never)]
        for _ in 0..if FORWARD { kept } else { all - kept } {
            last &= last - 1;
        }
        self.bits = if FORWARD { self.bits ^ last } else { last };
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.bits == 0
    }
}

impl Iterator for Matches {
    type Item = usize;

    #[inline(always)]
    fn next(&mut self) -> Option<usize> {
        let bit = self.bits.lowest_one()?;
        self.bits &= self.bits - 1;
        Some(self.start + bit as usize)
    }

    #[inline(always)]
    fn count(self) -> usize {
        self.bits.count_ones() as usize
    }
}

impl DoubleEndedIterator for Matches {
    #[inline(always)]
    fn next_back(&mut self) -> Option<usize> {
        // `bsr` is slow before Zen 4, and waits for what it overwrites unless LLVM sets that.
        let zeros = opaque(NonZero::new(self.bits)?.get()).leading_zeros();
        let bit = 63 ^ opaque(zeros.into());
        self.bits = opaque(self.bits ^ 1 << bit);
        Some(self.start + bit as usize)
    }
}
