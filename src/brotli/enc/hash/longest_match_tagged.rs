//! A hash table that keeps the last few positions of each hash, and 8 more bits of the hash of each of them, so that
//! most of the positions that do not match are skipped without looking at the input.

use super::{
    HASH_MUL_32, HASH_MUL_64, HasherImpl, HasherSearchResult, StaticDictionarySearch,
    backward_reference_score, find_longest_match_at_last_distances, for_each_position,
    prepare_distance_cache, search_in_static_dictionary,
};
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::util::{
    Checked, Loads, OutOfMemory, SliceExt, load_u32_le, load_u64_le, try_vec, try_with_capacity,
    try_zeroed,
};

const TAG_HASH_BITS: u32 = 8;
const NUM_LAST_DISTANCES_TO_CHECK: usize = 4;

/// The last `N` positions of a bucket. Aligned so that a vector of tags is in one cache line.
#[derive(Clone, Copy)]
#[repr(C, align(16))]
pub(crate) struct Block<const N: usize> {
    /// A ring buffer that is filled from its end.
    positions: [u32; N],
    /// The tag of each of `positions`.
    tags: [u8; N],
}

impl<const N: usize> Block<N> {
    const EMPTY: Self = Self {
        positions: [0; N],
        tags: [0; N],
    };

    /// Bit `i` tells whether the tag of position `i` is `tag`.
    ///
    /// On its own, this compiles to vector comparisons. As a part of a larger function it did not.
    #[inline(never)]
    fn matching_tags(&self, tag: u8) -> u64 {
        let mut matches = 0u64;
        for (i, chunk) in self.tags.as_chunks::<16>().0.iter().enumerate() {
            let mut equal_mask = 0u16;
            for (j, &candidate) in chunk.iter().enumerate() {
                equal_mask |= u16::from(candidate == tag) << j;
            }
            matches |= u64::from(equal_mask) << (16 * i);
        }
        matches
    }
}

/// `x`, of which the low `N` bits are used, rotated right by `n` bits.
#[inline(always)]
fn rotate_right<const N: usize>(x: u64, n: usize) -> u64 {
    match N {
        16 => u64::from((x as u16).rotate_right(n as u32)),
        32 => u64::from((x as u32).rotate_right(n as u32)),
        _ => x.rotate_right(n as u32),
    }
}

/// The buckets of a table.
pub(crate) trait Buckets<const N: usize>: Sized {
    /// `1 << bucket_bits` empty buckets.
    fn new(bucket_bits: u32) -> Result<Self, OutOfMemory>;

    /// How many positions were added to bucket `key`, modulo 65536, and the last of them.
    fn bucket_mut(&mut self, key: usize) -> Checked<(&mut u16, &mut Block<N>)>;

    /// Empties bucket `key`.
    fn clear_bucket(&mut self, key: usize) -> Checked;

    /// Empties all buckets.
    fn clear(&mut self);
}

/// A block for every bucket. Filling them with zeros takes as long as compressing some 10 KiB.
pub(crate) struct DenseBuckets<const N: usize> {
    added: Vec<u16>,
    blocks: Vec<Block<N>>,
}

impl<const N: usize> Buckets<N> for DenseBuckets<N> {
    fn new(bucket_bits: u32) -> Result<Self, OutOfMemory> {
        Ok(Self {
            added: try_zeroed(1 << bucket_bits)?,
            blocks: try_vec(Block::EMPTY, 1 << bucket_bits)?,
        })
    }

    #[inline(always)]
    fn bucket_mut(&mut self, key: usize) -> Checked<(&mut u16, &mut Block<N>)> {
        Ok((self.added.at_mut(key)?, self.blocks.at_mut(key)?))
    }

    fn clear_bucket(&mut self, key: usize) -> Checked {
        self.added.put(key, 0)
    }

    fn clear(&mut self) {
        self.added.fill(0);
    }
}

/// A block for every bucket that was used, so that a short input only touches what it uses. Finding the block of a bucket
/// makes this about a tenth slower.
pub(crate) struct SparseBuckets<const N: usize> {
    /// For each bucket, which of `blocks` is its own, counted from 1, or 0 if it has none yet. Then how many positions
    /// were added to it, modulo 65536.
    heads: Vec<[u16; 2]>,
    blocks: Vec<Block<N>>,
}

impl<const N: usize> SparseBuckets<N> {
    #[cold]
    #[inline(never)]
    fn give_block(&mut self, key: usize) -> Checked {
        self.blocks.push(Block::EMPTY);
        let [block, _] = self.heads.at_mut(key)?;
        *block = self.blocks.len() as u16;
        Ok(())
    }

    fn to_dense(&self) -> Result<DenseBuckets<N>, OutOfMemory> {
        let mut dense = DenseBuckets {
            added: try_zeroed(self.heads.len())?,
            blocks: try_vec(Block::EMPTY, self.heads.len())?,
        };
        let buckets = dense.added.iter_mut().zip(&mut dense.blocks);
        for (&[block, added], (dense_added, dense_block)) in self.heads.iter().zip(buckets) {
            if let Some(block) = self.blocks.get(usize::from(block).wrapping_sub(1)) {
                *dense_added = added;
                *dense_block = *block;
            }
        }
        Ok(dense)
    }
}

impl<const N: usize> Buckets<N> for SparseBuckets<N> {
    fn new(bucket_bits: u32) -> Result<Self, OutOfMemory> {
        Ok(Self {
            heads: try_zeroed(1 << bucket_bits)?,
            blocks: try_with_capacity(1 << bucket_bits)?,
        })
    }

    #[inline(always)]
    fn bucket_mut(&mut self, key: usize) -> Checked<(&mut u16, &mut Block<N>)> {
        if let [0, _] = self.heads.at(key)? {
            self.give_block(key)?;
        }
        let [block, added] = self.heads.at_mut(key)?;
        Ok((added, self.blocks.at_mut(usize::from(*block) - 1)?))
    }

    fn clear_bucket(&mut self, key: usize) -> Checked {
        let [_, added] = self.heads.at_mut(key)?;
        *added = 0;
        Ok(())
    }

    fn clear(&mut self) {
        self.heads.fill([0; 2]);
        self.blocks.clear();
    }
}

/// Hashes 5 bytes if `LONG`, which is for large inputs, else 4. A bucket holds `N` positions: 16, 32 or 64.
pub(crate) struct HashLongestMatchTagged<const LONG: bool, const N: usize, B> {
    buckets: B,
    /// Nothing was added to `buckets` since they were made.
    is_clear: bool,
}

impl<const LONG: bool, const N: usize, B: Buckets<N>> HashLongestMatchTagged<LONG, N, B> {
    const BUCKET_BITS: u32 = if LONG { 15 } else { 14 };

    pub(crate) fn new() -> Result<Self, OutOfMemory> {
        Ok(Self {
            buckets: B::new(Self::BUCKET_BITS)?,
            is_clear: true,
        })
    }

    /// The bucket and the tag of the bytes at `pos`.
    #[inline(always)]
    fn hash_bytes(data: &[u8], pos: usize) -> Checked<(usize, u8)> {
        Ok(if LONG {
            Self::hash(load_u64_le(data, pos)?)
        } else {
            Self::hash(u64::from(load_u32_le(data, pos)?))
        })
    }

    /// The bucket and the tag of the low 5 bytes of `bytes` if `LONG`, else of the low 4.
    #[inline(always)]
    fn hash(bytes: u64) -> (usize, u8) {
        let hash = if LONG {
            let h = bytes.wrapping_mul(HASH_MUL_64 << (64 - 5 * 8));
            (h >> (64 - Self::BUCKET_BITS - TAG_HASH_BITS)) as u32
        } else {
            let h = (bytes as u32).wrapping_mul(HASH_MUL_32);
            h >> (32 - Self::BUCKET_BITS - TAG_HASH_BITS)
        };
        ((hash >> TAG_HASH_BITS) as usize, hash as u8)
    }

    #[inline(always)]
    fn add(&mut self, key: usize, tag: u8, ix: usize) -> Checked {
        let (added, block) = self.buckets.bucket_mut(key)?;
        let slot = usize::from(!*added) & (N - 1);
        *added = added.wrapping_add(1);
        block.positions.put(slot, ix as u32)?;
        block.tags.put(slot, tag)
    }
}

impl<const LONG: bool, const N: usize> HashLongestMatchTagged<LONG, N, SparseBuckets<N>> {
    /// With more input than this, [`DenseBuckets`] pay off.
    pub(crate) const MAX_INPUT: usize = N << 10;

    pub(crate) fn to_dense(
        &self,
    ) -> Result<HashLongestMatchTagged<LONG, N, DenseBuckets<N>>, OutOfMemory> {
        Ok(HashLongestMatchTagged {
            buckets: self.buckets.to_dense()?,
            is_clear: self.is_clear,
        })
    }
}

impl<const LONG: bool, const N: usize, B: Buckets<N>> HasherImpl
    for HashLongestMatchTagged<LONG, N, B>
{
    const HASH_TYPE_LENGTH: usize = if LONG { 8 } else { 4 };
    const STORE_LOOKAHEAD: usize = if LONG { 8 } else { 4 };

    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        // Clearing an entry at a time is 100 times slower for each of them.
        let partial_prepare_threshold = (1usize << Self::BUCKET_BITS) >> 6;
        if core::mem::take(&mut self.is_clear) {
            return Ok(());
        }
        if one_shot && input_size <= partial_prepare_threshold {
            for i in 0..input_size {
                let (key, _) = Self::hash_bytes(data, i)?;
                self.buckets.clear_bucket(key)?;
            }
        } else {
            self.buckets.clear();
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let (key, tag) = Self::hash_bytes(data, ix & mask)?;
        self.add(key, tag, ix)
    }

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        if LONG {
            for_each_position(data, mask, ix_start, ix_end, |ix, bytes| {
                let (key, tag) = Self::hash(u64::from_le_bytes(*bytes));
                self.add(key, tag, ix)
            })
        } else {
            for_each_position(data, mask, ix_start, ix_end, |ix, bytes| {
                let (key, tag) = Self::hash(u64::from(u32::from_le_bytes(*bytes)));
                self.add(key, tag, ix)
            })
        }
    }

    #[inline(always)]
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]) {
        prepare_distance_cache(distance_cache, NUM_LAST_DISTANCES_TO_CHECK);
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
        let window = Loads::<4>::new(data.get(..=ring_buffer_mask).unwrap_or(data))?;
        // A short copy from far away is not accepted.
        let min_score = out.score;
        let mut best_len = out.len;
        let (key, tag) = Self::hash_bytes(data, cur_ix_masked)?;
        let (added, block) = self.buckets.bucket_mut(key)?;
        let added = core::mem::replace(added, added.wrapping_add(1));
        let slot = usize::from(!added) & (N - 1);
        // The newest position.
        let head = (slot + 1) & (N - 1);
        // The tags are looked at this early so that they are on their way from memory during what follows.
        // Bit `i` is for position `(head + i) % N`.
        let mut matches = rotate_right::<N>(block.matching_tags(tag), head);
        // The slots that were not filled yet do not count. After 65536 additions that is all of them again: the
        // reference encoder forgets the bucket, and the output depends on it.
        let block_has_unused_slots = u64::from(N > usize::from(added));
        matches &= (block_has_unused_slots << (added & (64 - 1))).wrapping_sub(1);
        out.len = 0;
        out.len_code_delta = 0;

        find_longest_match_at_last_distances(
            data,
            ring_buffer_mask,
            distance_cache,
            NUM_LAST_DISTANCES_TO_CHECK,
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
        'search: {
            // The 4 bytes up to the one that a longer match has to include. They have to be inside the window.
            let Ok(mut wanted) = window.u32_le(cur_ix_masked + best_len - 3) else {
                break 'search;
            };
            while matches > 0 {
                let rb_index = (head + matches.trailing_zeros() as usize) & (N - 1);
                matches &= matches - 1;
                let mut prev_ix = block.positions.at(rb_index)? as usize;
                let backward = cur_ix.wrapping_sub(prev_ix);
                if backward > max_backward {
                    break;
                }
                prev_ix &= ring_buffer_mask;
                if window.u32_le(prev_ix + best_len - 3) != Ok(wanted) {
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
                        let Ok(next) = window.u32_le(cur_ix_masked + best_len - 3) else {
                            break 'search;
                        };
                        wanted = next;
                    }
                }
            }
        }
        block.positions.put(slot, cur_ix as u32)?;
        block.tags.put(slot, tag)?;
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
