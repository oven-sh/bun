//! A hash table that keeps the last few positions of each hash.

use super::{
    HASH_MUL_32, HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch,
    backward_reference_score, find_longest_match_at_last_distances, prepare_distance_cache,
    search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::enc::params::EncoderParams;
use crate::util::{Checked, SliceExt, load_u32_le, load_u64_le, try_zeroed};

/// Hashes 5 bytes if `LONG`, which is for large inputs, else 4.
pub(crate) struct HashLongestMatch<const LONG: bool> {
    /// The number of buckets.
    bucket_size: usize,
    /// How many positions a bucket holds. Older ones are forgotten.
    block_size: usize,
    /// What is left of a 32-bit hash after this shift is the bucket.
    hash_shift: u32,
    block_mask: usize,
    block_bits: u32,
    num_last_distances_to_check: usize,
    /// How many positions were added to each bucket, modulo 65536.
    num: Vec<u16>,
    /// The buckets, each a ring buffer of `block_size` positions.
    buckets: Vec<u32>,
}

impl<const LONG: bool> HashLongestMatch<LONG> {
    pub(crate) fn new(params: &EncoderParams) -> Fallible<Self> {
        let hasher = &params.hasher;
        debug_assert!(!LONG || hasher.bucket_bits == 15);
        let bucket_size = 1usize << hasher.bucket_bits;
        let block_size = 1usize << hasher.block_bits;
        Ok(Self {
            bucket_size,
            block_size,
            hash_shift: (32 - hasher.bucket_bits) as u32,
            block_mask: block_size - 1,
            block_bits: hasher.block_bits as u32,
            num_last_distances_to_check: hasher.num_last_distances_to_check as usize,
            num: try_zeroed(bucket_size)?,
            buckets: try_zeroed(bucket_size * block_size)?,
        })
    }

    #[inline(always)]
    fn hash_bytes(&self, data: &[u8], pos: usize) -> Checked<usize> {
        if LONG {
            let h = load_u64_le(data, pos)?.wrapping_mul(HASH_MUL_64 << (64 - 5 * 8));
            Ok((h >> (64 - 15)) as usize)
        } else {
            let h = load_u32_le(data, pos)?.wrapping_mul(HASH_MUL_32);
            Ok((h >> self.hash_shift) as usize)
        }
    }
}

impl<const LONG: bool> HasherImpl for HashLongestMatch<LONG> {
    const HASH_TYPE_LENGTH: usize = if LONG { 8 } else { 4 };
    const STORE_LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = self.bucket_size >> 6;
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let key = self.hash_bytes(data, i)?;
                self.num.put(key, 0)?;
            }
        } else {
            self.num.fill(0);
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let key = self.hash_bytes(data, ix & mask)?;
        let num = self.num.at_mut(key)?;
        let minor_ix = usize::from(*num) & self.block_mask;
        let offset = minor_ix + (key << self.block_bits);
        *num = num.wrapping_add(1);
        self.buckets.put(offset, ix as u32)
    }

    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        prepare_distance_cache(distance_cache, self.num_last_distances_to_check);
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
        let bucket = self
            .buckets
            .sub_mut(key << self.block_bits..)?
            .sub_mut(..self.block_size)?;
        let num = self.num.at_mut(key)?;
        out.len = 0;
        out.len_code_delta = 0;

        find_longest_match_at_last_distances(
            data,
            ring_buffer_mask,
            distance_cache,
            self.num_last_distances_to_check,
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
        let newest = usize::from(*num);
        let down = newest.saturating_sub(self.block_size);
        for i in (down..newest).rev() {
            let mut prev_ix = bucket.at(i & self.block_mask)? as usize;
            let backward = cur_ix.wrapping_sub(prev_ix);
            if backward > max_backward {
                break;
            }
            prev_ix &= ring_buffer_mask;
            if cur_ix_masked + best_len > ring_buffer_mask {
                break;
            }
            // The 4 bytes up to the one that a longer match has to include.
            if prev_ix + best_len > ring_buffer_mask
                || load_u32_le(current, best_len - 3)? != load_u32_le(data, prev_ix + best_len - 3)?
            {
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
                }
            }
        }
        bucket.put(newest & self.block_mask, cur_ix as u32)?;
        *num = num.wrapping_add(1);
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
