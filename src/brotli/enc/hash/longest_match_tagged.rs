//! A hash table that keeps the last few positions of each hash, and 8 more bits of the hash of each of them, so that
//! most of the positions that do not match are skipped without looking at the input.

use super::{
    HASH_MUL_32, HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch,
    backward_reference_score, find_longest_match_at_last_distances, prepare_distance_cache,
    search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::enc::params::EncoderParams;
use crate::util::{Checked, SliceExt, load_u32_le, load_u64_le, try_zeroed};

const TAG_HASH_BITS: u32 = 8;
const TAG_HASH_MASK: usize = (1 << TAG_HASH_BITS) - 1;

/// Bit `i` tells whether `tag_bucket[(head + i) % tag_bucket.len()]` is `tag`. There are 16, 32 or 64 tags.
#[inline(always)]
fn get_matching_tag_mask(tag: u8, tag_bucket: &[u8], head: usize) -> u64 {
    let mut matches = 0u64;
    for (i, chunk) in tag_bucket.as_chunks::<16>().0.iter().enumerate().take(4) {
        // Compilers turn this into a vector comparison.
        let mut equal_mask = 0u16;
        for (j, &candidate) in chunk.iter().enumerate() {
            equal_mask |= u16::from(candidate == tag) << j;
        }
        matches |= u64::from(equal_mask) << (16 * i);
    }
    match tag_bucket.len() {
        16 => u64::from((matches as u16).rotate_right(head as u32)),
        32 => u64::from((matches as u32).rotate_right(head as u32)),
        _ => matches.rotate_right(head as u32),
    }
}

/// Hashes 5 bytes if `LONG`, which is for large inputs, else 4.
pub(crate) struct HashLongestMatchTagged<const LONG: bool> {
    /// The number of buckets.
    bucket_size: usize,
    /// How many positions a bucket holds. Older ones are forgotten.
    block_size: usize,
    /// What is left of a 32-bit hash after this shift is the bucket and the tag.
    hash_shift: u32,
    block_mask: usize,
    block_bits: u32,
    num_last_distances_to_check: usize,
    /// 65535 less how many positions were added to each bucket, modulo 65536.
    num: Vec<u16>,
    /// The tag of each position in `buckets`.
    tags: Vec<u8>,
    /// The buckets, each a ring buffer of `block_size` positions that is filled from its end.
    buckets: Vec<u32>,
}

impl<const LONG: bool> HashLongestMatchTagged<LONG> {
    pub(crate) fn new(params: &EncoderParams) -> Fallible<Self> {
        let hasher = &params.hasher;
        debug_assert!(!LONG || hasher.bucket_bits == 15);
        debug_assert!((4..=6).contains(&hasher.block_bits));
        let bucket_size = 1usize << hasher.bucket_bits;
        let block_size = 1usize << hasher.block_bits;
        Ok(Self {
            bucket_size,
            block_size,
            hash_shift: (32 - hasher.bucket_bits) as u32 - TAG_HASH_BITS,
            block_mask: block_size - 1,
            block_bits: hasher.block_bits as u32,
            num_last_distances_to_check: hasher.num_last_distances_to_check as usize,
            num: try_zeroed(bucket_size)?,
            tags: try_zeroed(bucket_size * block_size)?,
            buckets: try_zeroed(bucket_size * block_size)?,
        })
    }

    /// The bucket, and under it the tag.
    #[inline(always)]
    fn hash_bytes(&self, data: &[u8], pos: usize) -> Checked<usize> {
        if LONG {
            let h = load_u64_le(data, pos)?.wrapping_mul(HASH_MUL_64 << (64 - 5 * 8));
            Ok((h >> (64 - 15 - TAG_HASH_BITS)) as usize)
        } else {
            let h = load_u32_le(data, pos)?.wrapping_mul(HASH_MUL_32);
            Ok((h >> self.hash_shift) as usize)
        }
    }
}

impl<const LONG: bool> HasherImpl for HashLongestMatchTagged<LONG> {
    const HASH_TYPE_LENGTH: usize = if LONG { 8 } else { 4 };
    const STORE_LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = self.bucket_size >> 6;
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let key = self.hash_bytes(data, i)? >> TAG_HASH_BITS;
                self.num.put(key, 65535)?;
            }
        } else {
            self.num.fill(65535);
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let hash = self.hash_bytes(data, ix & mask)?;
        let key = hash >> TAG_HASH_BITS;
        let tag = (hash & TAG_HASH_MASK) as u8;
        let num = self.num.at_mut(key)?;
        let minor_ix = usize::from(*num) & self.block_mask;
        let offset = minor_ix + (key << self.block_bits);
        *num = num.wrapping_sub(1);
        self.buckets.put(offset, ix as u32)?;
        self.tags.put(offset, tag)
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
        let hash = self.hash_bytes(data, cur_ix_masked)?;
        let key = hash >> TAG_HASH_BITS;
        let bucket = self
            .buckets
            .sub_mut(key << self.block_bits..)?
            .sub_mut(..self.block_size)?;
        let tag_bucket = self
            .tags
            .sub_mut(key << self.block_bits..)?
            .sub_mut(..self.block_size)?;
        let num = self.num.at_mut(key)?;
        // The tags are looked at this early so that they are on their way from memory during what follows.
        let tag = (hash & TAG_HASH_MASK) as u8;
        // The newest position.
        let head = (usize::from(*num) + 1) & self.block_mask;
        let mut matches = get_matching_tag_mask(tag, tag_bucket, head);
        // The slots that were not filled yet do not count. After 65536 additions that is all of them again: the
        // reference encoder forgets the bucket, and the output depends on it.
        let n = 65535 - *num;
        let block_has_unused_slots = u64::from(self.block_size > usize::from(n));
        matches &= (block_has_unused_slots << (n & (64 - 1))).wrapping_sub(1);
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
        while matches > 0 {
            let rb_index = (head + matches.trailing_zeros() as usize) & self.block_mask;
            matches &= matches - 1;
            let mut prev_ix = bucket.at(rb_index)? as usize;
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
        let slot = usize::from(*num) & self.block_mask;
        bucket.put(slot, cur_ix as u32)?;
        tag_bucket.put(slot, tag)?;
        *num = num.wrapping_sub(1);
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
