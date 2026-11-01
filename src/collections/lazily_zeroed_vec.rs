use core::mem::MaybeUninit;
use core::ops::Range;

use bun_alloc::AllocError;

/// A `Vec<u8>` in the making that is written in any order. A block of it is filled with zeros when a byte of it is first
/// asked for. Until then nothing is written to the block, so it takes no memory.
pub struct LazilyZeroedVec {
    /// Empty, with room for `len` bytes.
    bytes: Vec<u8>,
    len: usize,
    /// A bit for each block.
    filled: Vec<u8>,
    /// Every block that starts before this is filled.
    filled_to: usize,
}

/// The least that a system hands out memory in, so a smaller one would save nothing.
const BLOCK: usize = 4096;

impl LazilyZeroedVec {
    #[inline]
    pub fn try_new(len: usize) -> Result<Self, AllocError> {
        let (mut bytes, mut filled) = (Vec::new(), Vec::new());
        bytes.try_reserve_exact(len).map_err(|_| AllocError)?;
        let filled_len = len.div_ceil(BLOCK).div_ceil(8);
        filled
            .try_reserve_exact(filled_len)
            .map_err(|_| AllocError)?;
        filled.resize(filled_len, 0);
        Ok(Self {
            bytes,
            len,
            filled,
            filled_to: 0,
        })
    }

    /// `None` if `range` is not within the length.
    #[inline]
    pub fn get_mut(&mut self, range: Range<usize>) -> Option<&mut [u8]> {
        if range.start > range.end || range.end > self.len {
            return None;
        }
        if range.end > self.filled_to {
            self.fill(&range);
        }
        // SAFETY: every block that has a byte of `range` is filled, because it starts before `filled_to` or by `fill()`,
        // and `&mut [u8]` cannot take the value from a byte again.
        Some(unsafe { self.bytes.spare_capacity_mut()[range].assume_init_mut() })
    }

    /// Fills the blocks that have a byte of `range`, which is within the length.
    // Cold, or it is made a part of `get_mut()`, which is then too long to become a part of its caller.
    #[cold]
    #[inline]
    fn fill(&mut self, range: &Range<usize>) {
        let bytes = &mut self.bytes.spare_capacity_mut()[..self.len];
        for block in range.start / BLOCK..range.end.div_ceil(BLOCK) {
            let (byte, bit) = (&mut self.filled[block / 8], 1 << (block % 8));
            if *byte & bit == 0 {
                let end = bytes.len().min((block + 1) * BLOCK);
                bytes[block * BLOCK..end].fill(MaybeUninit::new(0));
                *byte |= bit;
            }
        }
        while self.filled_to < self.len {
            let block = self.filled_to / BLOCK;
            if self.filled[block / 8] & (1 << (block % 8)) == 0 {
                break;
            }
            self.filled_to += BLOCK;
        }
    }

    /// Fills the blocks that were never asked for.
    #[inline]
    pub fn into_vec(mut self) -> Vec<u8> {
        self.get_mut(0..self.len);
        // SAFETY: every block is filled, and `try_new()` got room for `len` bytes.
        unsafe { self.bytes.set_len(self.len) };
        self.bytes
    }
}

#[cfg(test)]
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
    fn how_far_it_is_filled_without_a_gap() {
        let mut vec = new(5 * BLOCK);
        let mut filled_to = |start: usize| {
            assert_eq!(vec.get_mut(start..start + 2).unwrap(), [0; 2]);
            vec.filled_to
        };
        assert_eq!(filled_to(0), BLOCK);
        assert_eq!(filled_to(BLOCK - 2), BLOCK);
        // The third and the fourth block, with the second still to come.
        assert_eq!(filled_to(3 * BLOCK - 1), BLOCK);
        assert_eq!(filled_to(BLOCK), 4 * BLOCK);
        assert_eq!(filled_to(5 * BLOCK - 2), 5 * BLOCK);
        assert_eq!(vec.into_vec(), [0; 5 * BLOCK]);
    }

    #[test]
    fn once_every_block_is_filled() {
        let mut vec = new(2 * BLOCK + 1);
        for start in [2 * BLOCK, 0, BLOCK] {
            vec.get_mut(start..start + 1).unwrap()[0] = 7;
        }
        assert!(vec.filled_to >= vec.len);
        assert_eq!(vec.get_mut(BLOCK - 1..BLOCK + 2).unwrap(), [0, 7, 0]);
        assert!(vec.get_mut(0..2 * BLOCK + 2).is_none());
        vec.get_mut(1..2).unwrap()[0] = 8;
        let all = vec.into_vec();
        assert_eq!(all[..3], [7, 8, 0]);
        assert_eq!(all[2 * BLOCK - 1..], [0, 7]);
    }

    #[test]
    fn more_blocks_than_a_byte_has_bits() {
        let len = 19 * BLOCK;
        let mut vec = new(len);
        for block in [18, 0, 7, 8, 9, 3] {
            vec.get_mut(block * BLOCK..block * BLOCK + 1).unwrap()[0] = block as u8 + 1;
        }
        let all = vec.into_vec();
        for block in 0..19 {
            let written = [18, 0, 7, 8, 9, 3].contains(&block);
            assert_eq!(
                all[block * BLOCK],
                if written { block as u8 + 1 } else { 0 }
            );
            assert_eq!(all[block * BLOCK + 1..(block + 1) * BLOCK], [0; BLOCK - 1]);
        }
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
        assert_eq!(vec.into_vec(), [0; BLOCK + 10]);
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
