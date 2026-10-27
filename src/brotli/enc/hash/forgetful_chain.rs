//! A hash table of chains of positions. The nodes of a group of chains come from a "bank", where a new node replaces
//! the oldest one once the bank is full, so chains can end up sharing a tail.

use super::{
    BucketSearch, DictionaryCandidates, HasherImpl, HasherSearchResult, LongestMatchHasher,
    StaticDictionarySearch, backward_reference_penalty_using_last_distance,
    backward_reference_score_using_last_distance, hash_u32, prepare_distance_cache,
    search_in_static_dictionary,
};
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::enc::params::EncoderParams;
use crate::util::{Bug, Checked, SliceExt, load_u32_le, try_zeroed};

/// A node of a chain: how far before its position the next one is, or 0xFFFF if that is too far, and the slot of the
/// next one.
type Slot = [u16; 2];

pub(crate) struct HashForgetfulChain<
    const BUCKET_BITS: u32,
    const NUM_BANKS: usize,
    const BANK_BITS: u32,
    const NUM_LAST_DISTANCES_TO_CHECK: usize,
> {
    /// How many slots of each bank were taken, modulo 65536.
    free_slot_idx: Box<[u16; NUM_BANKS]>,
    /// How many nodes of a chain are looked at.
    max_hops: usize,
    /// The newest position of each bucket.
    addr: Vec<u32>,
    /// The slot of the newest position of each bucket.
    head: Vec<u16>,
    /// 8 bits of the hash of the last 65536 positions, to quickly reject distances from the cache.
    tiny_hash: Vec<u8>,
    /// `NUM_BANKS` times `1 << BANK_BITS` slots.
    banks: Vec<Slot>,
}

impl<
    const BUCKET_BITS: u32,
    const NUM_BANKS: usize,
    const BANK_BITS: u32,
    const NUM_LAST_DISTANCES_TO_CHECK: usize,
> HashForgetfulChain<BUCKET_BITS, NUM_BANKS, BANK_BITS, NUM_LAST_DISTANCES_TO_CHECK>
{
    const BANK_SIZE: usize = 1 << BANK_BITS;
    const NUM_BUCKETS: usize = 1 << BUCKET_BITS;

    pub(crate) fn new(params: &EncoderParams) -> Fallible<Self> {
        let free_slot_idx = try_zeroed(NUM_BANKS)?.into_boxed_slice();
        Ok(Self {
            free_slot_idx: free_slot_idx.try_into().map_err(|_| Bug)?,
            max_hops: (if params.quality > 6 { 7 } else { 8 }) << (params.quality - 4),
            addr: try_zeroed(Self::NUM_BUCKETS)?,
            head: try_zeroed(Self::NUM_BUCKETS)?,
            tiny_hash: try_zeroed(65536)?,
            banks: try_zeroed(NUM_BANKS * Self::BANK_SIZE)?,
        })
    }

    #[inline(always)]
    fn hash_bytes(data: &[u8], pos: usize) -> Checked<usize> {
        Ok(hash_u32(load_u32_le(data, pos)?, BUCKET_BITS))
    }
}

impl<
    const BUCKET_BITS: u32,
    const NUM_BANKS: usize,
    const BANK_BITS: u32,
    const NUM_LAST_DISTANCES_TO_CHECK: usize,
> HasherImpl
    for HashForgetfulChain<BUCKET_BITS, NUM_BANKS, BANK_BITS, NUM_LAST_DISTANCES_TO_CHECK>
{
    const HASH_TYPE_LENGTH: usize = 4;
    const STORE_LOOKAHEAD: usize = 4;

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        // No position gets as high as 0xCCCCCCCC, since they wrap around before 3 GiB + 64 MiB. So a new chain ends
        // after its first node.
        //
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = Self::NUM_BUCKETS >> 6;
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let bucket = Self::hash_bytes(data, i)?;
                self.addr.put(bucket, 0xCCCC_CCCC)?;
                self.head.put(bucket, 0xCCCC)?;
            }
        } else {
            self.addr.fill(0xCCCC_CCCC);
            self.head.fill(0);
        }
        self.tiny_hash.fill(0);
        self.free_slot_idx.fill(0);
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let key = Self::hash_bytes(data, ix & mask)?;
        let bank = key & (NUM_BANKS - 1);
        let free_slot_idx = self.free_slot_idx.at_mut(bank)?;
        let idx = usize::from(*free_slot_idx) & (Self::BANK_SIZE - 1);
        *free_slot_idx = free_slot_idx.wrapping_add(1);
        let addr = self.addr.at_mut(key)?;
        let head = self.head.at_mut(key)?;
        let delta = ix.wrapping_sub(*addr as usize).min(0xFFFF);
        self.tiny_hash.put(usize::from(ix as u16), key as u8)?;
        self.banks
            .put((bank << BANK_BITS) + idx, [delta as u16, *head])?;
        *addr = ix as u32;
        *head = idx as u16;
        Ok(())
    }
}

impl<
    const BUCKET_BITS: u32,
    const NUM_BANKS: usize,
    const BANK_BITS: u32,
    const NUM_LAST_DISTANCES_TO_CHECK: usize,
> LongestMatchHasher
    for HashForgetfulChain<BUCKET_BITS, NUM_BANKS, BANK_BITS, NUM_LAST_DISTANCES_TO_CHECK>
{
    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        prepare_distance_cache(distance_cache, NUM_LAST_DISTANCES_TO_CHECK);
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
        let mut best_score = out.score;
        let mut best_len = out.len;
        let key = Self::hash_bytes(data, cur_ix_masked)?;
        let tiny_hash = key as u8;
        out.len = 0;
        out.len_code_delta = 0;

        for (i, &distance) in distance_cache
            .iter()
            .enumerate()
            .take(NUM_LAST_DISTANCES_TO_CHECK)
        {
            let backward = distance as usize;
            let mut prev_ix = cur_ix.wrapping_sub(backward);
            // The last distance is also good for matches of 2 bytes.
            if i > 0 && self.tiny_hash.at(usize::from(prev_ix as u16))? != tiny_hash {
                continue;
            }
            if prev_ix >= cur_ix || backward > max_backward {
                continue;
            }
            prev_ix &= mask;
            let len = find_match_length_with_limit(data.sub(prev_ix..)?, current, max_length);
            if len >= 2 {
                let mut score = backward_reference_score_using_last_distance(len);
                if best_score < score {
                    if i != 0 {
                        score -= backward_reference_penalty_using_last_distance(i);
                    }
                    if best_score < score {
                        best_score = score;
                        best_len = len;
                        out.len = best_len;
                        out.distance = backward;
                        out.score = best_score;
                    }
                }
            }
        }
        let search = BucketSearch::new(
            data,
            mask,
            cur_ix,
            max_length,
            max_backward,
            best_len,
            best_score,
        )?;
        if let Some(mut search) = search {
            let bank = key & (NUM_BANKS - 1);
            let mut backward = 0usize;
            let mut delta = cur_ix.wrapping_sub(self.addr.at(key)? as usize);
            let mut slot = usize::from(self.head.at(key)?);
            for _ in 0..self.max_hops {
                backward = backward.wrapping_add(delta);
                if backward > max_backward {
                    break;
                }
                let [node_delta, node_next] = self.banks.at((bank << BANK_BITS) + slot)?;
                slot = usize::from(node_next);
                delta = usize::from(node_delta);
                let prev_ix = cur_ix.wrapping_sub(backward);
                if search.try_position::<false>(prev_ix, out)?.is_break() {
                    break;
                }
            }
        }
        self.store(data, mask, cur_ix)?;
        if out.score == min_score {
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
