//! A hash table with no more than a few candidates for each hash.

use super::{
    HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch, backward_reference_score,
    backward_reference_score_using_last_distance, search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::util::{Checked, SliceExt, load_u64_le, try_zeroed};

/// `1 << BUCKET_BITS` positions. A position whose first `HASH_LEN` bytes hash to `key` is in one of the
/// `1 << BUCKET_SWEEP_BITS` entries `key`, `key + 8`, `key + 16`...
pub(crate) struct HashLongestMatchQuickly<
    const BUCKET_BITS: u32,
    const BUCKET_SWEEP_BITS: u32,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> {
    buckets: Vec<u32>,
}

impl<
    const BUCKET_BITS: u32,
    const BUCKET_SWEEP_BITS: u32,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> HashLongestMatchQuickly<BUCKET_BITS, BUCKET_SWEEP_BITS, HASH_LEN, USE_DICTIONARY>
{
    const BUCKET_SIZE: usize = 1 << BUCKET_BITS;
    const BUCKET_MASK: usize = Self::BUCKET_SIZE - 1;
    const BUCKET_SWEEP: usize = 1 << BUCKET_SWEEP_BITS;
    const BUCKET_SWEEP_MASK: usize = (Self::BUCKET_SWEEP - 1) << 3;

    pub(crate) fn new() -> Fallible<Self> {
        Ok(Self {
            buckets: try_zeroed(Self::BUCKET_SIZE)?,
        })
    }

    #[inline(always)]
    fn hash_bytes(data: &[u8], pos: usize) -> Checked<usize> {
        let h = (load_u64_le(data, pos)? << (64 - 8 * HASH_LEN)).wrapping_mul(HASH_MUL_64);
        Ok((h >> (64 - BUCKET_BITS)) as usize)
    }
}

impl<
    const BUCKET_BITS: u32,
    const BUCKET_SWEEP_BITS: u32,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> HasherImpl for HashLongestMatchQuickly<BUCKET_BITS, BUCKET_SWEEP_BITS, HASH_LEN, USE_DICTIONARY>
{
    const HASH_TYPE_LENGTH: usize = 8;
    const STORE_LOOKAHEAD: usize = 8;

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = Self::BUCKET_SIZE >> 5;
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let key = Self::hash_bytes(data, i)?;
                for j in 0..Self::BUCKET_SWEEP {
                    self.buckets.put((key + (j << 3)) & Self::BUCKET_MASK, 0)?;
                }
            }
        } else {
            self.buckets.fill(0);
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let key = Self::hash_bytes(data, ix & mask)?;
        // Which of the entries is taken depends on the position.
        let off = ix & Self::BUCKET_SWEEP_MASK;
        self.buckets.put((key + off) & Self::BUCKET_MASK, ix as u32)
    }

    #[inline(always)]
    fn prepare_distance_cache(&self, _distance_cache: &mut [i32; 16]) {}

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
        let buckets = self.buckets.as_mut_slice();
        let best_len_in = out.len;
        let cur_ix_masked = cur_ix & ring_buffer_mask;
        let current = data.sub(cur_ix_masked..)?;
        let mut compare_char = current.at(best_len_in)?;
        let key = Self::hash_bytes(data, cur_ix_masked)?;
        let min_score = out.score;
        let mut best_score = out.score;
        let mut best_len = best_len_in;
        let cached_backward = distance_cache[0] as usize;
        let mut prev_ix = cur_ix.wrapping_sub(cached_backward);

        out.len_code_delta = 0;
        if prev_ix < cur_ix {
            prev_ix &= ring_buffer_mask as u32 as usize;
            if compare_char == data.at(prev_ix + best_len)? {
                let len = find_match_length_with_limit(data.sub(prev_ix..)?, current, max_length);
                if len >= 4 {
                    let score = backward_reference_score_using_last_distance(len);
                    if best_score < score {
                        out.len = len;
                        out.distance = cached_backward;
                        out.score = score;
                        if Self::BUCKET_SWEEP == 1 {
                            return buckets.put(key, cur_ix as u32);
                        }
                        best_len = len;
                        best_score = score;
                        compare_char = current.at(len)?;
                    }
                }
            }
        }
        if Self::BUCKET_SWEEP == 1 {
            // Only one to look at.
            let entry = buckets.at_mut(key)?;
            prev_ix = *entry as usize;
            *entry = cur_ix as u32;
            let backward = cur_ix.wrapping_sub(prev_ix);
            prev_ix &= ring_buffer_mask as u32 as usize;
            // The reference encoder does not get to the dictionary from here, and the output depends on it.
            if compare_char != data.at(prev_ix + best_len_in)? {
                return Ok(());
            }
            if backward == 0 || backward > max_backward {
                return Ok(());
            }
            let len = find_match_length_with_limit(data.sub(prev_ix..)?, current, max_length);
            if len >= 4 {
                let score = backward_reference_score(len, backward);
                if best_score < score {
                    out.len = len;
                    out.distance = backward;
                    out.score = score;
                    return Ok(());
                }
            }
        } else {
            for i in 0..Self::BUCKET_SWEEP {
                prev_ix = buckets.at((key + (i << 3)) & Self::BUCKET_MASK)? as usize;
                let backward = cur_ix.wrapping_sub(prev_ix);
                prev_ix &= ring_buffer_mask as u32 as usize;
                if compare_char != data.at(prev_ix + best_len)? {
                    continue;
                }
                if backward == 0 || backward > max_backward {
                    continue;
                }
                let len = find_match_length_with_limit(data.sub(prev_ix..)?, current, max_length);
                if len >= 4 {
                    let score = backward_reference_score(len, backward);
                    if best_score < score {
                        best_len = len;
                        out.len = len;
                        compare_char = current.at(len)?;
                        best_score = score;
                        out.score = score;
                        out.distance = backward;
                    }
                }
            }
        }
        if USE_DICTIONARY && min_score == out.score {
            search_in_static_dictionary(
                dictionary,
                current,
                max_length,
                dictionary_distance,
                max_distance,
                out,
                true,
            )?;
        }
        if Self::BUCKET_SWEEP != 1 {
            let key_out = (key + (cur_ix & Self::BUCKET_SWEEP_MASK)) & Self::BUCKET_MASK;
            buckets.put(key_out, cur_ix as u32)?;
        }
        Ok(())
    }
}
