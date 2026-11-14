// Its user decodes images from anywhere, and a panic aborts the process.
#![deny(clippy::indexing_slicing)]

use core::mem::MaybeUninit;
use core::ops::Range;

use bun_alloc::AllocError;

use crate::DynamicBitSet;

/// A `Vec<u8>` in the making. A block of it is zeroed, and takes memory, only once a byte of it is asked for.
pub struct LazilyZeroedVec {
    bytes: Box<[MaybeUninit<u8>]>,
    /// Which blocks are zeroed.
    zeroed: DynamicBitSet,
    /// Every block that starts before this is zeroed.
    zeroed_to: usize,
}

/// The least that a system hands out memory in. Less for Miri, which takes its time over every byte.
const BLOCK: usize = if cfg!(miri) { 64 } else { 4096 };

impl LazilyZeroedVec {
    #[inline]
    pub fn try_new(len: usize) -> Result<Self, AllocError> {
        Ok(Self {
            bytes: Box::try_new_uninit_slice(len).map_err(|_| AllocError)?,
            zeroed: DynamicBitSet::init_empty(len.div_ceil(BLOCK))?,
            zeroed_to: 0,
        })
    }

    /// `None` if `range` is not within the length.
    #[inline]
    pub fn get_mut(&mut self, range: Range<usize>) -> Option<&mut [u8]> {
        self.bytes.get(range.start..range.end)?;
        if range.end > self.zeroed_to && !range.is_empty() {
            self.zero(range.start..range.end);
        }
        // SAFETY: each block that `range` reaches into starts before `zeroed_to` or was zeroed just now, and a
        // `&mut [u8]` cannot undo that.
        Some(unsafe { self.bytes.get_mut(range)?.assume_init_mut() })
    }

    // `#[cold]` keeps it out of `get_mut()`, which is inlined only while short. `#[inline]`: the caller's opt-level.
    #[cold]
    #[inline]
    fn zero(&mut self, range: Range<usize>) {
        let first = range.start / BLOCK;
        let blocks = self.bytes.chunks_mut(BLOCK).skip(first);
        for (index, block) in (first..range.end.div_ceil(BLOCK)).zip(blocks) {
            if !self.zeroed.is_set(index) {
                block.fill(MaybeUninit::new(0));
                self.zeroed.set(index);
            }
        }
        while self
            .zeroed
            .is_set_allow_out_of_bound(self.zeroed_to / BLOCK, false)
        {
            self.zeroed_to += BLOCK;
        }
    }

    /// Zeroes the blocks that were never asked for.
    #[inline]
    pub fn into_vec(mut self) -> Vec<u8> {
        self.zero(0..self.bytes.len());
        // SAFETY: every block is zeroed.
        unsafe { self.bytes.assume_init() }.into_vec()
    }
}

#[cfg(test)]
#[allow(clippy::indexing_slicing)]
mod tests {
    use super::*;

    /// In memory that was just given back, so that it is not zeros by chance.
    fn new(len: usize) -> LazilyZeroedVec {
        drop(core::hint::black_box(vec![0xaa_u8; len]));
        LazilyZeroedVec::try_new(len).unwrap()
    }

    #[test]
    fn what_is_written_ends_up_in_its_place_whatever_the_order() {
        // Three blocks and a part of a fourth.
        let len = 3 * BLOCK + 100;
        let ranges = [
            len - 7..len,
            0..5,
            // Over the end of a block.
            BLOCK - 3..BLOCK + 3,
            // The whole of a block, and no more.
            2 * BLOCK..3 * BLOCK,
        ];
        let mut vec = new(len);
        let mut expected = vec![0; len];
        for (value, range) in (1..).zip(ranges) {
            vec.get_mut(range.clone()).unwrap().fill(value);
            expected[range].fill(value);
        }
        assert_eq!(vec.into_vec(), expected);
    }

    #[test]
    fn bytes_are_zeros_the_first_time_and_keep_what_was_written_after_that() {
        let mut vec = new(2 * BLOCK);
        assert_eq!(vec.get_mut(BLOCK + 1..BLOCK + 4).unwrap(), [0; 3]);
        vec.get_mut(BLOCK + 1..BLOCK + 4).unwrap()[1] = 9;
        // The same block, then the other one, then both.
        assert_eq!(vec.get_mut(BLOCK..BLOCK + 4).unwrap(), [0, 0, 9, 0]);
        assert_eq!(vec.get_mut(0..2).unwrap(), [0; 2]);
        assert_eq!(vec.get_mut(BLOCK - 1..BLOCK + 3).unwrap(), [0, 0, 0, 9]);
        let all = vec.into_vec();
        assert_eq!(all.len(), 2 * BLOCK);
        assert_eq!(all.iter().map(|&byte| byte as usize).sum::<usize>(), 9);
        assert_eq!(all[BLOCK + 2], 9);
    }

    #[test]
    fn how_far_it_is_zeroed_without_a_gap() {
        let mut vec = new(5 * BLOCK);
        let mut zeroed_to = |start: usize| {
            assert_eq!(vec.get_mut(start..start + 2).unwrap(), [0; 2]);
            vec.zeroed_to
        };
        assert_eq!(zeroed_to(0), BLOCK);
        assert_eq!(zeroed_to(BLOCK - 2), BLOCK);
        // The third and the fourth block, with the second still to come.
        assert_eq!(zeroed_to(3 * BLOCK - 1), BLOCK);
        assert_eq!(zeroed_to(BLOCK), 4 * BLOCK);
        assert_eq!(zeroed_to(5 * BLOCK - 2), 5 * BLOCK);
        assert_eq!(vec.into_vec(), [0; 5 * BLOCK]);
    }

    #[test]
    fn once_every_block_is_zeroed() {
        let mut vec = new(2 * BLOCK + 1);
        for start in [2 * BLOCK, 0, BLOCK] {
            vec.get_mut(start..start + 1).unwrap()[0] = 7;
        }
        assert!(vec.zeroed_to >= vec.bytes.len());
        assert_eq!(vec.get_mut(BLOCK - 1..BLOCK + 2).unwrap(), [0, 7, 0]);
        assert!(vec.get_mut(0..2 * BLOCK + 2).is_none());
        vec.get_mut(1..2).unwrap()[0] = 8;
        let all = vec.into_vec();
        assert_eq!(all[..3], [7, 8, 0]);
        assert_eq!(all[2 * BLOCK - 1..], [0, 7]);
    }

    #[test]
    #[expect(clippy::reversed_empty_ranges)]
    fn there_is_nothing_behind_the_end() {
        let mut vec = new(BLOCK + 10);
        assert!(vec.get_mut(BLOCK..BLOCK + 10).is_some());
        assert!(vec.get_mut(BLOCK + 10..BLOCK + 10).is_some());
        // Still in the last block.
        assert!(vec.get_mut(BLOCK..BLOCK + 11).is_none());
        assert!(vec.get_mut(BLOCK + 11..BLOCK + 11).is_none());
        assert!(vec.get_mut(0..usize::MAX).is_none());
        assert!(vec.get_mut(usize::MAX..usize::MAX).is_none());
        assert!(vec.get_mut(5..4).is_none());
        // And asking for it zeroes nothing.
        let mut untouched = new(3 * BLOCK);
        assert!(untouched.get_mut(0..3 * BLOCK + 1).is_none());
        assert_eq!(untouched.zeroed_to, 0);
        assert_eq!(vec.into_vec(), [0; BLOCK + 10]);
    }

    #[test]
    fn no_byte_zeroes_no_block() {
        let mut vec = new(2 * BLOCK);
        assert_eq!(vec.get_mut(BLOCK + 1..BLOCK + 1).unwrap(), []);
        assert_eq!(vec.zeroed.count(), 0);
    }

    #[test]
    fn of_no_length() {
        let mut vec = new(0);
        assert_eq!(vec.get_mut(0..0).unwrap(), []);
        assert!(vec.get_mut(0..1).is_none());
        assert_eq!(vec.into_vec(), []);
    }

    #[test]
    fn more_than_there_can_be_is_refused() {
        assert!(LazilyZeroedVec::try_new(usize::MAX).is_err());
        assert!(LazilyZeroedVec::try_new(isize::MAX as usize + 1).is_err());
    }
}
