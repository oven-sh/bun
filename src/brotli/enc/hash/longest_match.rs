//! A hash table that keeps the last few positions of each hash.

use super::bucket_table::BucketTable;
use super::{
    HASH_MUL_32, HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch,
    backward_reference_score, find_longest_match_at_last_distances, prepare_distance_cache,
    search_in_static_dictionary, window,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::enc::params::EncoderParams;
use crate::util::{Checked, Loads, OutOfMemory, SliceExt, load_u32_le, load_u64_le};
use core::hint::{Locality, prefetch_read};

/// Hashes 5 bytes if `LONG`, which is for large inputs, else 4.
pub(crate) struct HashLongestMatch<const LONG: bool> {
    table: BucketTable,
}

impl<const LONG: bool> HashLongestMatch<LONG> {
    pub(crate) fn new(params: &EncoderParams) -> Fallible<Self> {
        debug_assert!(!LONG || params.hasher.bucket_bits == 15);
        Ok(Self {
            table: BucketTable::new(&params.hasher)?,
        })
    }

    #[inline(always)]
    fn hash_bytes(&self, data: &[u8], pos: usize) -> Checked<usize> {
        Self::hash_bytes_with(self.table.hash_shift, data, pos)
    }

    #[inline(always)]
    fn hash_bytes_with(hash_shift: u32, data: &[u8], pos: usize) -> Checked<usize> {
        if LONG {
            let h = load_u64_le(data, pos)?.wrapping_mul(HASH_MUL_64 << (64 - 5 * 8));
            Ok((h >> (64 - 15)) as usize)
        } else {
            let h = load_u32_le(data, pos)?.wrapping_mul(HASH_MUL_32);
            Ok((h >> hash_shift) as usize)
        }
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

    fn reserve(&mut self, input_end: usize) -> Result<(), OutOfMemory> {
        self.table.reserve(input_end)
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let key = self.hash_bytes(data, ix & mask)?;
        let (start, num) = self.table.add_to_bucket(key)?;
        let offset = start + (usize::from(num) & (self.table.block_size - 1));
        self.table.blocks.put(offset, ix as u32)
    }

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        let hash_shift = self.table.hash_shift;
        let mut ix = ix_start;
        loop {
            let mut buckets = self.table.buckets();
            let without_block = loop {
                if ix >= ix_end {
                    return Ok(());
                }
                let key = Self::hash_bytes_with(hash_shift, data, ix & mask)?;
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

    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        prepare_distance_cache(distance_cache, self.table.num_last_distances_to_check);
    }

    #[inline(always)]
    fn find_longest_match(
        &mut self,
        dictionary: &mut StaticDictionarySearch<'_>,
        data: &[u8],
        ring_buffer_mask: usize,
        distance_cache: &[i32; 16],
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        dictionary_distance: usize,
        max_distance: usize,
        out: &mut HasherSearchResult,
    ) -> Checked {
        let cur_ix_masked = cur_ix & ring_buffer_mask;
        let current = data.sub(cur_ix_masked..)?;
        // A short copy from far away is not accepted.
        let min_score = out.score;
        let mut best_len = out.len;
        let key = self.hash_bytes(data, cur_ix_masked)?;
        let block_size = self.table.block_size;
        let (start, newest) = self.table.add_to_bucket(key)?;
        let newest = usize::from(newest);
        let bucket = self.table.blocks.sub_mut(start..)?.sub_mut(..block_size)?;
        let block_mask = bucket.len().wrapping_sub(1);
        prefetch_read(bucket.as_ptr(), Locality::L1);
        if block_size > 16 {
            prefetch_read(bucket.as_ptr().wrapping_add(16), Locality::L1);
        }
        let window = Loads::<4>::new(window(data, ring_buffer_mask))?;
        out.len = 0;
        out.len_code_delta = 0;

        find_longest_match_at_last_distances(
            data,
            ring_buffer_mask,
            distance_cache,
            self.table.num_last_distances_to_check,
            cur_ix,
            max_length,
            max_backward,
            &mut best_len,
            out,
        )?;
        let mut best_score = out.score;
        // Only matches of 4 bytes and more count from here on, so 4 bytes can be compared each time.
        if best_len < 3 {
            best_len = 3;
        }
        let down = newest.saturating_sub(block_size);
        'search: {
            // The 4 bytes up to the one that a longer match has to include. They have to be inside the window.
            let Some(mut wanted) = window.u32_le(cur_ix_masked + best_len - 3) else {
                break 'search;
            };
            for i in (down..newest).rev() {
                let mut prev_ix = bucket.at(i & block_mask)? as usize;
                let backward = cur_ix.wrapping_sub(prev_ix);
                if backward > max_backward {
                    break;
                }
                prev_ix &= ring_buffer_mask;
                if window.u32_le(prev_ix + best_len - 3) != Some(wanted) {
                    continue;
                }
                let len = if LONG {
                    if load_u32_le(current, 0)? != load_u32_le(data, prev_ix)? {
                        continue;
                    }
                    find_match_length_with_limit(
                        data.sub(prev_ix + 4..)?,
                        current.sub(4..)?,
                        max_length.wrapping_sub(4),
                    ) + 4
                } else {
                    find_match_length_with_limit(data.sub(prev_ix..)?, current, max_length)
                };
                if len >= 4 {
                    let score = backward_reference_score(len, backward);
                    if best_score < score {
                        best_score = score;
                        best_len = len;
                        out.len = best_len;
                        out.distance = backward;
                        out.score = best_score;
                        let Some(next) = window.u32_le(cur_ix_masked + best_len - 3) else {
                            break 'search;
                        };
                        wanted = next;
                    }
                }
            }
        }
        bucket.put(newest & block_mask, cur_ix as u32)?;
        if min_score == out.score {
            search_in_static_dictionary(
                dictionary,
                current,
                max_length,
                dictionary_distance,
                max_distance,
                out,
                false,
            )?;
        }
        Ok(())
    }
}
