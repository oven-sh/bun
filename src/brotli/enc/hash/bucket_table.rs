//! The storage of the hasher that keeps the last few positions of each hash.

use crate::enc::params::HasherParams;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_zeroed};

/// Which block is the bucket's own, counted from 1, or 0 if it has none yet. Then how many positions were added to the
/// bucket, modulo 65536.
type Head = [u16; 2];

pub(crate) struct BucketTable {
    /// How many positions a bucket holds. Older ones are forgotten.
    pub(crate) block_size: usize,
    block_bits: u32,
    /// What is left of a 32-bit hash after this shift is the bucket.
    pub(crate) hash_shift: u32,
    pub(crate) num_last_distances_to_check: usize,
    heads: Vec<Head>,
    /// Ring buffers of `block_size` positions. A bucket gets one with its first position, so that a short input does
    /// not take the room for all of them, which can be 32 MiB.
    pub(crate) blocks: Vec<u32>,
    /// `heads` is all 0 and `blocks` is empty.
    is_clear: bool,
}

/// The table while no bucket gets a block, for loops: what is borrowed here can stay in registers.
pub(crate) struct Buckets<'a> {
    heads: &'a mut [Head],
    pub(crate) blocks: &'a mut [u32],
    block_bits: u32,
    pub(crate) block_mask: usize,
}

impl BucketTable {
    pub(crate) fn new(hasher: &HasherParams) -> Result<Self, OutOfMemory> {
        let bucket_size = 1usize << hasher.bucket_bits;
        let block_size = 1usize << hasher.block_bits;
        Ok(Self {
            block_size,
            block_bits: hasher.block_bits as u32,
            hash_shift: (32 - hasher.bucket_bits) as u32,
            num_last_distances_to_check: hasher.num_last_distances_to_check as usize,
            heads: try_zeroed(bucket_size)?,
            blocks: Vec::new(),
            is_clear: true,
        })
    }

    /// Whether the table was not used since it was made, and so has nothing to forget. It counts as used from now on.
    pub(crate) fn take_is_clear(&mut self) -> bool {
        core::mem::take(&mut self.is_clear)
    }

    /// Makes room for a block for each of `positions` positions.
    pub(crate) fn reserve(&mut self, positions: usize) -> Result<(), OutOfMemory> {
        let needed = positions.min(self.heads.len()) * self.block_size;
        self.blocks
            .try_reserve(needed.saturating_sub(self.blocks.len()))
            .map_err(|_| OutOfMemory)
    }

    /// Forgets all positions.
    pub(crate) fn clear(&mut self) {
        self.heads.fill([0; 2]);
        self.blocks.clear();
    }

    #[inline(always)]
    pub(crate) fn buckets(&mut self) -> Buckets<'_> {
        Buckets {
            heads: &mut self.heads,
            blocks: &mut self.blocks,
            block_bits: self.block_bits,
            block_mask: self.block_size - 1,
        }
    }

    /// [`Buckets::add`] for a bucket that may not have a block yet.
    #[inline(always)]
    pub(crate) fn add_to_bucket(&mut self, key: usize) -> Checked<(usize, u16)> {
        if let Some(added) = self.buckets().add(key)? {
            return Ok(added);
        }
        self.give_block(key)?;
        self.buckets().add(key)?.ok_or(Bug)
    }

    #[cold]
    #[inline(never)]
    pub(crate) fn give_block(&mut self, key: usize) -> Checked {
        let len = self.blocks.len() + self.block_size;
        if len > self.blocks.capacity() {
            return Err(Bug);
        }
        self.blocks.resize(len, 0);
        let [block, _] = self.heads.at_mut(key)?;
        *block = (self.blocks.len() >> self.block_bits) as u16;
        Ok(())
    }
}

impl Buckets<'_> {
    /// Where in `blocks` the block of bucket `key` starts, and how many positions were added to it so far, modulo
    /// 65536. Counts one more. `None`, and nothing is counted, if the bucket has no block.
    #[inline(always)]
    pub(crate) fn add(&mut self, key: usize) -> Checked<Option<(usize, u16)>> {
        let [block, added] = self.heads.at_mut(key)?;
        let Some(block) = block.checked_sub(1) else {
            return Ok(None);
        };
        let before = *added;
        *added = before.wrapping_add(1);
        Ok(Some((usize::from(block) << self.block_bits, before)))
    }
}
