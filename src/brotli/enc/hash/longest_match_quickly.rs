//! A hash table with no more than a few candidates for each hash.

use super::{
    HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch, backward_reference_score,
    backward_reference_score_using_last_distance, for_each_position, search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::util::{Bug, Checked, SliceExt, load_u64_le, try_zeroed};

/// `BUCKET_SIZE` positions, a power of 2. A position whose first `HASH_LEN` bytes hash to `key` is in one of the
/// `BUCKET_SWEEP` entries `key`, `key + 8`, `key + 16`...
pub(crate) struct HashLongestMatchQuickly<
    const BUCKET_SIZE: usize,
    const BUCKET_SWEEP: usize,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> {
    buckets: Box<[u32; BUCKET_SIZE]>,
    /// Nothing was written to `buckets` since they were made.
    is_clear: bool,
}

impl<
    const BUCKET_SIZE: usize,
    const BUCKET_SWEEP: usize,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> HashLongestMatchQuickly<BUCKET_SIZE, BUCKET_SWEEP, HASH_LEN, USE_DICTIONARY>
{
    const BUCKET_BITS: u32 = BUCKET_SIZE.trailing_zeros();
    const BUCKET_MASK: usize = BUCKET_SIZE - 1;
    const BUCKET_SWEEP_MASK: usize = (BUCKET_SWEEP - 1) << 3;

    pub(crate) fn new() -> Fallible<Self> {
        let buckets = try_zeroed(BUCKET_SIZE)?.into_boxed_slice();
        Ok(Self {
            buckets: buckets.try_into().map_err(|_| Bug)?,
            is_clear: true,
        })
    }

    #[inline(always)]
    fn hash_bytes(data: &[u8], pos: usize) -> Checked<usize> {
        Ok(Self::hash(load_u64_le(data, pos)?))
    }

    /// A hash of the low `HASH_LEN` bytes of `bytes`.
    #[inline(always)]
    fn hash(bytes: u64) -> usize {
        let h = (bytes << (64 - 8 * HASH_LEN)).wrapping_mul(HASH_MUL_64);
        (h >> (64 - Self::BUCKET_BITS)) as usize
    }
}

impl<
    const BUCKET_SIZE: usize,
    const BUCKET_SWEEP: usize,
    const HASH_LEN: u32,
    const USE_DICTIONARY: bool,
> HasherImpl for HashLongestMatchQuickly<BUCKET_SIZE, BUCKET_SWEEP, HASH_LEN, USE_DICTIONARY>
{
    const HASH_TYPE_LENGTH: usize = 8;
    const STORE_LOOKAHEAD: usize = 8;

    fn prepare(&mut self, _one_shot: bool, _input_size: usize, _data: &[u8]) -> Checked {
        if !core::mem::take(&mut self.is_clear) {
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
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        for_each_position(data, mask, ix_start, ix_end, |ix, bytes| {
            let key = Self::hash(u64::from_le_bytes(*bytes));
            let off = ix & Self::BUCKET_SWEEP_MASK;
            self.buckets.put((key + off) & Self::BUCKET_MASK, ix as u32)
        })
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
        let buckets = &mut *self.buckets;
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
                        if BUCKET_SWEEP == 1 {
                            return buckets.put(key, cur_ix as u32);
                        }
                        best_len = len;
                        best_score = score;
                        compare_char = current.at(len)?;
                    }
                }
            }
        }
        if BUCKET_SWEEP == 1 {
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
            let mut candidates = [0; BUCKET_SWEEP];
            for (i, candidate) in candidates.iter_mut().enumerate() {
                *candidate = buckets.at((key + (i << 3)) & Self::BUCKET_MASK)?;
            }
            for candidate in candidates {
                prev_ix = candidate as usize;
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
        if BUCKET_SWEEP != 1 {
            let key_out = (key + (cur_ix & Self::BUCKET_SWEEP_MASK)) & Self::BUCKET_MASK;
            buckets.put(key_out, cur_ix as u32)?;
        }
        Ok(())
    }
}
