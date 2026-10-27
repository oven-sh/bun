//! A hash table that keeps the last few positions of each hash.

use super::bucket_table::BucketTable;
use super::{
    BucketSearch, DictionaryCandidates, HasherImpl, HasherSearchResult, LongestMatchHasher,
    StaticDictionarySearch, find_longest_match_at_last_distances, hash_low_bytes, hash_u32,
    prepare_distance_cache, search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::params::HasherParams;
use crate::util::{Bug, Checked, SliceExt, load_u32_le, load_u64_le};
use bun_core::AllocError;
use core::hint::{Locality, prefetch_read};

/// Hashes 5 bytes if `LONG`, which is for large inputs and only comes with `1 << LONG_BUCKET_BITS` buckets, else 4.
pub(crate) struct HashLongestMatch<const LONG: bool> {
    table: BucketTable,
    bucket_bits: u32,
    num_last_distances_to_check: usize,
}

impl<const LONG: bool> HashLongestMatch<LONG> {
    const LONG_BUCKET_BITS: u32 = 15;

    pub(crate) fn new(params: HasherParams) -> Fallible<Self> {
        if LONG && params.bucket_bits != Self::LONG_BUCKET_BITS {
            return Err(Bug.into());
        }
        Ok(Self {
            table: BucketTable::new(params.bucket_bits, params.block_bits)?,
            bucket_bits: params.bucket_bits,
            num_last_distances_to_check: params.num_last_distances_to_check,
        })
    }

    #[inline(always)]
    fn hash_bytes(bucket_bits: u32, data: &[u8], pos: usize) -> Checked<usize> {
        Ok(if LONG {
            hash_low_bytes(load_u64_le(data, pos)?, 5, Self::LONG_BUCKET_BITS)
        } else {
            hash_u32(load_u32_le(data, pos)?, bucket_bits)
        })
    }
}

impl<const LONG: bool> HasherImpl for HashLongestMatch<LONG> {
    const HASH_TYPE_LENGTH: usize = if LONG { 8 } else { 4 };
    const STORE_LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    fn prepare(&mut self, _one_shot: bool, _input_size: usize, _data: &[u8]) -> Checked {
        if !self.table.take_is_clear() {
            self.table.clear();
        }
        Ok(())
    }

    fn reserve(&mut self, input_end: usize) -> Result<(), AllocError> {
        self.table.reserve(input_end)
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let key = Self::hash_bytes(self.bucket_bits, data, ix & mask)?;
        let (start, added) = self.table.add_to_bucket(key)?;
        let offset = start + (usize::from(added) & (self.table.block_size - 1));
        self.table.blocks.put(offset, ix as u32)
    }

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        let bucket_bits = self.bucket_bits;
        let mut ix = ix_start;
        loop {
            let mut buckets = self.table.buckets();
            let without_block = loop {
                if ix >= ix_end {
                    return Ok(());
                }
                let key = Self::hash_bytes(bucket_bits, data, ix & mask)?;
                let Some((start, added)) = buckets.add(key)? else {
                    break key;
                };
                let offset = start + (usize::from(added) & buckets.block_mask);
                buckets.blocks.put(offset, ix as u32)?;
                ix += 1;
            };
            self.table.give_block(without_block)?;
        }
    }
}

impl<const LONG: bool> LongestMatchHasher for HashLongestMatch<LONG> {
    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        prepare_distance_cache(distance_cache, self.num_last_distances_to_check);
    }

    #[inline(always)]
    fn find_longest_match(
        &mut self,
        dictionary: &mut StaticDictionarySearch<'_>,
        data: &[u8],
        mask: usize,
        distance_cache: &[i32; 16],
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        dictionary_distance: usize,
        max_distance: usize,
        out: &mut HasherSearchResult,
    ) -> Checked {
        let cur_ix_masked = cur_ix & mask;
        let current = data.sub(cur_ix_masked..)?;
        // A short copy from far away is not accepted.
        let min_score = out.score;
        let mut best_len = out.len;
        let key = Self::hash_bytes(self.bucket_bits, data, cur_ix_masked)?;
        let block_size = self.table.block_size;
        let (start, added) = self.table.add_to_bucket(key)?;
        let added = usize::from(added);
        let bucket = self.table.blocks.sub_mut(start..)?.sub_mut(..block_size)?;
        let block_mask = bucket.len().wrapping_sub(1);
        prefetch_read(bucket.as_ptr(), Locality::L1);
        if block_size > 16 {
            prefetch_read(bucket.as_ptr().wrapping_add(16), Locality::L1);
        }
        out.len = 0;
        out.len_code_delta = 0;

        find_longest_match_at_last_distances(
            data,
            mask,
            distance_cache,
            self.num_last_distances_to_check,
            cur_ix,
            max_length,
            max_backward,
            &mut best_len,
            out,
        )?;
        let down = added.saturating_sub(block_size);
        let search = BucketSearch::new(
            data,
            mask,
            cur_ix,
            max_length,
            max_backward,
            best_len,
            out.score,
        )?;
        if let Some(mut search) = search {
            for i in (down..added).rev() {
                let prev_ix = bucket.at(i & block_mask)? as usize;
                if search.try_position::<LONG>(prev_ix, out)?.is_break() {
                    break;
                }
            }
        }
        bucket.put(added & block_mask, cur_ix as u32)?;
        if min_score == out.score {
            search_in_static_dictionary(
                dictionary,
                current,
                max_length,
                dictionary_distance,
                max_distance,
                out,
                DictionaryCandidates::Both,
            )?;
        }
        Ok(())
    }
}
