//! The storage of the hashers that keep the last few positions of each hash.

use crate::enc::params::HasherParams;
use crate::util::{Checked, OutOfMemory, SliceExt, try_with_capacity, try_zeroed};

pub(crate) struct BucketTable {
    /// The number of buckets.
    pub(crate) bucket_size: usize,
    /// How many positions a bucket holds. Older ones are forgotten.
    pub(crate) block_size: usize,
    pub(crate) block_mask: usize,
    block_bits: u32,
    /// What is left of a 32-bit hash after this shift is the bucket, and under it `extra_hash_bits` more bits.
    pub(crate) hash_shift: u32,
    pub(crate) num_last_distances_to_check: usize,
    /// For each bucket, in the low 16 bits how many positions were added to it, modulo 65536. In the high 16 bits which
    /// block of `blocks` is its own, counted from 1, or 0 if it has none yet.
    heads: Vec<u32>,
    /// Ring buffers of `block_size` positions. A bucket gets one with its first position, so that of the room for all
    /// of them, which can be 32 MiB, a short input only touches what it uses.
    pub(crate) blocks: Vec<u32>,
    /// `heads` is all 0 and `blocks` is empty.
    is_clear: bool,
}

impl BucketTable {
    pub(crate) fn new(hasher: &HasherParams, extra_hash_bits: u32) -> Result<Self, OutOfMemory> {
        let bucket_size = 1usize << hasher.bucket_bits;
        let block_size = 1usize << hasher.block_bits;
        Ok(Self {
            bucket_size,
            block_size,
            block_mask: block_size - 1,
            block_bits: hasher.block_bits as u32,
            hash_shift: (32 - hasher.bucket_bits) as u32 - extra_hash_bits,
            num_last_distances_to_check: hasher.num_last_distances_to_check as usize,
            heads: try_zeroed(bucket_size)?,
            blocks: try_with_capacity(bucket_size * block_size)?,
            is_clear: true,
        })
    }

    /// Whether the table was not used since it was made, and so has nothing to forget. It counts as used from now on.
    pub(crate) fn take_is_clear(&mut self) -> bool {
        core::mem::take(&mut self.is_clear)
    }

    /// Forgets the positions of bucket `key`.
    pub(crate) fn clear_bucket(&mut self, key: usize) -> Checked {
        *self.heads.at_mut(key)? &= !0xFFFF;
        Ok(())
    }

    /// Forgets all positions.
    pub(crate) fn clear(&mut self) {
        self.heads.fill(0);
        self.blocks.clear();
    }

    /// Where in `blocks` the block of bucket `key` starts, and how many positions were added to it so far, modulo
    /// 65536. Counts one more.
    #[inline(always)]
    pub(crate) fn add_to_bucket(&mut self, key: usize) -> Checked<(usize, u16)> {
        let head = self.heads.at_mut(key)?;
        if *head >> 16 == 0 {
            self.blocks.resize(self.blocks.len() + self.block_size, 0);
            *head |= ((self.blocks.len() >> self.block_bits) as u32) << 16;
        }
        let num = *head as u16;
        let start = ((*head >> 16) as usize - 1) << self.block_bits;
        *head = (*head & !0xFFFF) | u32::from(num.wrapping_add(1));
        Ok((start, num))
    }
}
