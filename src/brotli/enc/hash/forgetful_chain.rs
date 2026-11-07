//! A hash table of chains of positions. The nodes of a group of chains come from a "bank", where a new node replaces
//! the oldest one once the bank is full, so chains can end up sharing a tail.

use super::{
    BucketSearch, DictionaryCandidates, HasherImpl, HasherSearchResult, LongestMatchHasher,
    StaticDictionarySearch, backward_reference_penalty_using_last_distance,
    backward_reference_score_using_last_distance, for_each_position, hash_u32,
    prepare_distance_cache, search_in_static_dictionary,
};
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::util::{Bug, Checked, SliceExt, try_boxed_zeroed};
use bun_core::AllocError;

const BUCKET_BITS: u32 = 15;
const NUM_BUCKETS: usize = 1 << BUCKET_BITS;

/// A node of a chain: how far before its position the next one is, or 0xFFFF if that is too far, and the slot of the
/// next one.
type Slot = [u16; 2];

/// The tables are arrays, so that an index which is a hash, or was masked, needs no check.
pub(crate) struct HashForgetfulChain<
    const NUM_BANKS: usize,
    const BANK_SIZE: usize,
    const NUM_LAST_DISTANCES_TO_CHECK: usize,
> {
    /// How many slots of each bank were taken, modulo 65536.
    free_slot_idx: Box<[u16; NUM_BANKS]>,
    /// How many nodes of a chain are looked at.
    max_hops: usize,
    /// The newest position of each bucket.
    addr: Box<[u32; NUM_BUCKETS]>,
    /// The slot of the newest position of each bucket.
    head: Box<[u16; NUM_BUCKETS]>,
    /// 8 bits of the hash of the last 65536 positions, to quickly reject distances from the cache.
    tiny_hash: Box<[u8; 1 << 16]>,
    banks: Box<[[Slot; BANK_SIZE]; NUM_BANKS]>,
    /// Nothing was written to the tables since they were made.
    is_clear: bool,
}

impl<const NUM_BANKS: usize, const BANK_SIZE: usize, const NUM_LAST_DISTANCES_TO_CHECK: usize>
    HashForgetfulChain<NUM_BANKS, BANK_SIZE, NUM_LAST_DISTANCES_TO_CHECK>
{
    pub(crate) fn new(quality: i32) -> Result<Self, AllocError> {
        const { assert!(NUM_BANKS.is_power_of_two() && BANK_SIZE.is_power_of_two()) };
        const { assert!(BANK_SIZE <= 1 << 16 && NUM_LAST_DISTANCES_TO_CHECK <= 16) };
        Ok(Self {
            free_slot_idx: try_boxed_zeroed()?,
            max_hops: (if quality > 6 { 7 } else { 8 }) << (quality - 4),
            addr: try_boxed_zeroed()?,
            head: try_boxed_zeroed()?,
            tiny_hash: try_boxed_zeroed()?,
            banks: try_boxed_zeroed()?,
            is_clear: true,
        })
    }

    #[inline(always)]
    fn hash(bytes: [u8; 4]) -> usize {
        hash_u32(u32::from_le_bytes(bytes), BUCKET_BITS)
    }

    /// Adds the position `ix` to the bucket `key`.
    #[inline(always)]
    fn store_key(&mut self, key: usize, ix: usize) -> Checked {
        let bank = key & (NUM_BANKS - 1);
        let free_slot_idx = self.free_slot_idx.at_mut(bank)?;
        let idx = usize::from(*free_slot_idx) & (BANK_SIZE - 1);
        *free_slot_idx = free_slot_idx.wrapping_add(1);
        let addr = self.addr.at_mut(key)?;
        let head = self.head.at_mut(key)?;
        let delta = ix.wrapping_sub(*addr as usize).min(0xFFFF);
        self.tiny_hash.put(usize::from(ix as u16), key as u8)?;
        self.banks.at_mut(bank)?.put(idx, [delta as u16, *head])?;
        *addr = ix as u32;
        *head = idx as u16;
        Ok(())
    }
}

impl<const NUM_BANKS: usize, const BANK_SIZE: usize, const NUM_LAST_DISTANCES_TO_CHECK: usize>
    HasherImpl for HashForgetfulChain<NUM_BANKS, BANK_SIZE, NUM_LAST_DISTANCES_TO_CHECK>
{
    const HASH_TYPE_LENGTH: usize = 4;
    const STORE_LOOKAHEAD: usize = 4;

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        if !core::mem::take(&mut self.is_clear) {
            self.head.fill(0);
            self.tiny_hash.fill(0);
            self.free_slot_idx.fill(0);
        }
        // No position gets as high as 0xCCCCCCCC, since they wrap around before 3 GiB + 64 MiB. So a new chain ends
        // after its first node.
        //
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = NUM_BUCKETS >> 6;
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let bucket = Self::hash(*data.array_at(i)?);
                self.addr.put(bucket, 0xCCCC_CCCC)?;
            }
        } else {
            self.addr.fill(0xCCCC_CCCC);
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        self.store_key(Self::hash(*data.array_at(ix & mask)?), ix)
    }

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        for_each_position(data, mask, ix_start, ix_end, |ix, bytes| {
            self.store_key(Self::hash(*bytes), ix)
        })
    }
}

impl<const NUM_BANKS: usize, const BANK_SIZE: usize, const NUM_LAST_DISTANCES_TO_CHECK: usize>
    LongestMatchHasher for HashForgetfulChain<NUM_BANKS, BANK_SIZE, NUM_LAST_DISTANCES_TO_CHECK>
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
        let key = Self::hash(*current.array_at(0)?);
        let tiny_hash = key as u8;
        out.len = 0;
        out.len_code_delta = 0;

        let last_distances: &[i32; NUM_LAST_DISTANCES_TO_CHECK] = distance_cache.array_at(0)?;
        for (i, &distance) in last_distances.iter().enumerate() {
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
            // Not `at`, which would copy the bank.
            let bank = self.banks.get(key & (NUM_BANKS - 1)).ok_or(Bug)?;
            let mut backward = 0usize;
            let mut delta = cur_ix.wrapping_sub(self.addr.at(key)? as usize);
            let mut slot = usize::from(self.head.at(key)?);
            for _ in 0..self.max_hops {
                backward = backward.wrapping_add(delta);
                if backward > max_backward {
                    break;
                }
                let [node_delta, node_next] = bank.at(slot & (BANK_SIZE - 1))?;
                slot = usize::from(node_next);
                delta = usize::from(node_delta);
                let prev_ix = cur_ix.wrapping_sub(backward);
                if search.try_position::<false>(prev_ix, out)?.is_break() {
                    break;
                }
            }
        }
        self.store_key(key, cur_ix)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::enc::Fallible;
    use crate::enc::hash::{H40, H42};

    fn data() -> Vec<u8> {
        (0..2000u32).map(|i| ((i * i) >> 3) as u8).collect()
    }

    /// An encoder only gets there after 3 GiB.
    #[test]
    fn a_second_prepare_empties_the_tables() -> Fallible {
        let data = data();
        let mut hasher = H42::new(9)?;
        for _ in 0..2 {
            hasher.prepare(false, data.len(), &data)?;
            assert!(hasher.addr.iter().all(|&addr| addr == 0xCCCC_CCCC));
            assert!(hasher.head.iter().all(|&slot| slot == 0));
            assert!(hasher.tiny_hash.iter().all(|&hash| hash == 0));
            assert!(hasher.free_slot_idx.iter().all(|&idx| idx == 0));

            hasher.store_range(&data, 4095, 0, data.len() - 3)?;
            assert!(hasher.head.iter().any(|&slot| slot != 0));
            assert!(hasher.tiny_hash.iter().any(|&hash| hash != 0));
            assert!(hasher.free_slot_idx.iter().any(|&idx| idx != 0));
        }
        Ok(())
    }

    #[test]
    fn a_short_input_empties_its_own_buckets() -> Fallible {
        let data = data();
        let mut hasher = H40::new(5)?;
        hasher.prepare(true, 100, &data)?;
        let emptied = |hasher: &H40| {
            hasher
                .addr
                .iter()
                .filter(|&&addr| addr == 0xCCCC_CCCC)
                .count()
        };
        assert!((1..=100).contains(&emptied(&hasher)));
        hasher.store_range(&data, 4095, 0, 100)?;
        assert_eq!(emptied(&hasher), 0);
        let [bank] = &*hasher.banks;
        let mut last_in_bucket = vec![None; NUM_BUCKETS];
        for (ix, (&[delta, _], bytes)) in
            bank.iter().zip(data.array_windows()).enumerate().take(100)
        {
            let before = last_in_bucket.at_mut(H40::hash(*bytes))?.replace(ix);
            assert_eq!(
                usize::from(delta),
                before.map_or(0xFFFF, |before| ix - before),
                "at {ix}"
            );
        }
        Ok(())
    }
}
