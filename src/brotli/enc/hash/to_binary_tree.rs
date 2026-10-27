//! A hash table in which each bucket is a binary tree of the sequences whose first 4 bytes have the same hash.
//!
//! A sequence is `MAX_TREE_COMP_LENGTH` bytes long and is identified by its position. A tree is sorted by the
//! lexicographic order of the sequences, and is a max-heap with respect to their positions.

use super::{BackwardMatch, HASH_MUL_32};
use crate::common::constants::WINDOW_GAP;
use crate::enc::Fallible;
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::enc::params::EncoderParams;
use crate::enc::quality::HQ_ZOPFLIFICATION_QUALITY;
use crate::enc::static_dict::{
    INVALID_MATCH, MAX_STATIC_DICTIONARY_MATCH_LEN, find_all_static_dictionary_matches,
};
use crate::enc::static_dict_lut::{StaticDictionaryLut, static_dictionary_lut};
use crate::util::{Checked, SliceExt, load_u32_le, try_zeroed};

const BUCKET_BITS: u32 = 17;
const BUCKET_SIZE: usize = 1 << BUCKET_BITS;
const MAX_TREE_SEARCH_DEPTH: usize = 64;
const MAX_TREE_COMP_LENGTH: usize = 128;

/// How many matches [`H10::find_all_matches`] can find: 64 and `MAX_TREE_SEARCH_DEPTH`.
pub(crate) const MAX_NUM_MATCHES_H10: usize = 128;

pub(crate) struct H10 {
    /// The size of the window less 1.
    window_mask: usize,
    /// The root of the tree of each hash, which is the last position with that hash.
    buckets: Vec<u32>,
    /// Stands for "no sequence": the root of an empty tree, or a missing child.
    invalid_pos: u32,
    /// The children of the sequence at `pos` are at `2 * pos` (left) and `2 * pos + 1` (right).
    forest: Vec<u32>,
    static_dictionary: &'static StaticDictionaryLut,
}

#[inline(always)]
fn hash_bytes(data: &[u8], pos: usize) -> Checked<usize> {
    let h = load_u32_le(data, pos)?.wrapping_mul(HASH_MUL_32);
    Ok((h >> (32 - BUCKET_BITS)) as usize)
}

impl H10 {
    const HASH_TYPE_LENGTH: usize = 4;

    pub(super) fn new(params: &EncoderParams, one_shot: bool, input_size: usize) -> Fallible<Self> {
        let mut num_nodes = 1usize << params.lgwin;
        if one_shot && input_size < num_nodes {
            num_nodes = input_size;
        }
        let window_mask = (1u32 << params.lgwin).wrapping_sub(1) as usize;
        Ok(Self {
            window_mask,
            buckets: try_zeroed(BUCKET_SIZE)?,
            invalid_pos: 0usize.wrapping_sub(window_mask) as u32,
            forest: try_zeroed(2 * num_nodes)?,
            static_dictionary: static_dictionary_lut()?,
        })
    }

    pub(super) fn prepare(&mut self, _one_shot: bool, _input_size: usize, _data: &[u8]) -> Checked {
        self.buckets.fill(self.invalid_pos);
        Ok(())
    }

    #[inline(always)]
    fn left_child_index(&self, pos: usize) -> usize {
        2 * (pos & self.window_mask)
    }

    #[inline(always)]
    fn right_child_index(&self, pos: usize) -> usize {
        2 * (pos & self.window_mask) + 1
    }

    /// Goes down the tree of the sequence at `cur_ix` once, which finds matches and makes that sequence the root.
    ///
    /// With less than `MAX_TREE_COMP_LENGTH` bytes available the tree is only searched, since it is not known yet where
    /// the sequence sorts. To be called with increasing positions.
    ///
    /// If `FIND`, the matches longer than `best_len` are written to `matches` from `num_matches` on. Returns the new
    /// number of matches.
    #[inline(always)]
    fn store_and_find_matches<const FIND: bool>(
        &mut self,
        data: &[u8],
        cur_ix: usize,
        ring_buffer_mask: usize,
        max_length: usize,
        max_backward: usize,
        best_len: &mut usize,
        matches: &mut [BackwardMatch],
        mut num_matches: usize,
    ) -> Checked<usize> {
        let cur_ix_masked = cur_ix & ring_buffer_mask;
        let max_comp_len = max_length.min(MAX_TREE_COMP_LENGTH);
        let should_reroot_tree = max_length >= MAX_TREE_COMP_LENGTH;
        let key = hash_bytes(data, cur_ix_masked)?;
        let mut prev_ix = self.buckets.at(key)? as usize;
        // The rightmost node of the left subtree of the new root, and the leftmost node of its right subtree, as
        // indices in the forest.
        let mut node_left = self.left_child_index(cur_ix);
        let mut node_right = self.right_child_index(cur_ix);
        // How long those two match.
        let mut best_len_left = 0usize;
        let mut best_len_right = 0usize;
        if should_reroot_tree {
            self.buckets.put(key, cur_ix as u32)?;
        }
        let mut depth_remaining = MAX_TREE_SEARCH_DEPTH;
        loop {
            let backward = cur_ix.wrapping_sub(prev_ix);
            let prev_ix_masked = prev_ix & ring_buffer_mask;
            if backward == 0 || backward > max_backward || depth_remaining == 0 {
                if should_reroot_tree {
                    self.forest.put(node_left, self.invalid_pos)?;
                    self.forest.put(node_right, self.invalid_pos)?;
                }
                break;
            }
            let cur_len = best_len_left.min(best_len_right);
            debug_assert!(cur_len <= MAX_TREE_COMP_LENGTH);
            let len = cur_len
                + find_match_length_with_limit(
                    data.sub(cur_ix_masked + cur_len..)?,
                    data.sub(prev_ix_masked + cur_len..)?,
                    max_length - cur_len,
                );
            if FIND && len > *best_len {
                *best_len = len;
                matches.put(num_matches, BackwardMatch::init(backward, len))?;
                num_matches += 1;
            }
            if len >= max_comp_len {
                if should_reroot_tree {
                    let left = self.forest.at(self.left_child_index(prev_ix))?;
                    self.forest.put(node_left, left)?;
                    let right = self.forest.at(self.right_child_index(prev_ix))?;
                    self.forest.put(node_right, right)?;
                }
                break;
            }
            if data.at(cur_ix_masked + len)? > data.at(prev_ix_masked + len)? {
                best_len_left = len;
                if should_reroot_tree {
                    self.forest.put(node_left, prev_ix as u32)?;
                }
                node_left = self.right_child_index(prev_ix);
                prev_ix = self.forest.at(node_left)? as usize;
            } else {
                best_len_right = len;
                if should_reroot_tree {
                    self.forest.put(node_right, prev_ix as u32)?;
                }
                node_right = self.left_child_index(prev_ix);
                prev_ix = self.forest.at(node_right)? as usize;
            }
            depth_remaining -= 1;
        }
        Ok(num_matches)
    }

    /// Finds the matches for the bytes at `cur_ix`, no longer than `max_length` and no further back than
    /// `max_backward`, and adds the position `cur_ix`. Words of the static dictionary are at distances over
    /// `dictionary_distance`.
    ///
    /// Returns how many were written to `matches`, which has room for [`MAX_NUM_MATCHES_H10`]. Their lengths increase,
    /// and their distances do not decrease.
    #[inline(always)]
    pub(crate) fn find_all_matches(
        &mut self,
        data: &[u8],
        ring_buffer_mask: usize,
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        dictionary_distance: usize,
        params: &EncoderParams,
        matches: &mut [BackwardMatch],
    ) -> Checked<usize> {
        let mut num_matches = 0usize;
        let cur_ix_masked = cur_ix & ring_buffer_mask;
        let mut best_len = 1usize;
        let short_match_max_backward = if params.quality != HQ_ZOPFLIFICATION_QUALITY {
            16
        } else {
            64
        };
        let stop = cur_ix.saturating_sub(short_match_max_backward);
        let mut i = cur_ix.wrapping_sub(1);
        while i > stop && best_len <= 2 {
            let mut prev_ix = i;
            let backward = cur_ix.wrapping_sub(prev_ix);
            if backward > max_backward {
                break;
            }
            prev_ix &= ring_buffer_mask;
            i = i.wrapping_sub(1);
            if data.at(cur_ix_masked)? != data.at(prev_ix)?
                || data.at(cur_ix_masked + 1)? != data.at(prev_ix + 1)?
            {
                continue;
            }
            let len = find_match_length_with_limit(
                data.sub(prev_ix..)?,
                data.sub(cur_ix_masked..)?,
                max_length,
            );
            if len > best_len {
                best_len = len;
                matches.put(num_matches, BackwardMatch::init(backward, len))?;
                num_matches += 1;
            }
        }
        if best_len < max_length {
            num_matches = self.store_and_find_matches::<true>(
                data,
                cur_ix,
                ring_buffer_mask,
                max_length,
                max_backward,
                &mut best_len,
                matches,
                num_matches,
            )?;
        }
        let mut dict_matches = [INVALID_MATCH; MAX_STATIC_DICTIONARY_MATCH_LEN + 1];
        let minlen = (best_len + 1).max(4);
        if find_all_static_dictionary_matches(
            self.static_dictionary,
            data.sub(cur_ix_masked..)?,
            minlen,
            max_length,
            &mut dict_matches,
        )? {
            let maxlen = MAX_STATIC_DICTIONARY_MATCH_LEN.min(max_length);
            for l in minlen..=maxlen {
                let dict_id = dict_matches.at(l)?;
                if dict_id < INVALID_MATCH {
                    let distance = dictionary_distance + (dict_id >> 5) as usize + 1;
                    if distance <= params.dist.max_distance {
                        matches.put(
                            num_matches,
                            BackwardMatch::init_dictionary(distance, l, (dict_id & 31) as usize),
                        )?;
                        num_matches += 1;
                    }
                }
            }
        }
        Ok(num_matches)
    }

    /// Adds the position `ix`, after which there are at least `MAX_TREE_COMP_LENGTH` bytes in the current block.
    #[inline(always)]
    pub(crate) fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked {
        let max_backward = self.window_mask - WINDOW_GAP + 1;
        self.store_and_find_matches::<false>(
            data,
            ix,
            mask,
            MAX_TREE_COMP_LENGTH,
            max_backward,
            &mut 0,
            &mut [],
            0,
        )?;
        Ok(())
    }

    /// Adds the last 63 positions of the range, and every 8th of the others if there are enough of them.
    #[inline(always)]
    pub(crate) fn store_range(
        &mut self,
        data: &[u8],
        mask: usize,
        ix_start: usize,
        ix_end: usize,
    ) -> Checked {
        let mut i = ix_start;
        if ix_start + 63 <= ix_end {
            i = ix_end - 63;
        }
        if ix_start + 512 <= i {
            for j in (ix_start..i).step_by(8) {
                self.store(data, mask, j)?;
            }
        }
        for i in i..ix_end {
            self.store(data, mask, i)?;
        }
        Ok(())
    }

    /// Adds the last `MAX_TREE_COMP_LENGTH - 1` positions of the previous block, whose sequences were not complete
    /// without the `num_bytes` that were written at `position` since.
    pub(super) fn stitch_to_previous_block(
        &mut self,
        num_bytes: usize,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
    ) -> Checked {
        if num_bytes >= Self::HASH_TYPE_LENGTH - 1 && position >= MAX_TREE_COMP_LENGTH {
            let i_start = position - MAX_TREE_COMP_LENGTH + 1;
            let i_end = position.min(i_start + num_bytes);
            for i in i_start..i_end {
                // No further back from the start of the next block than the window, where the ring buffer may have been
                // overwritten.
                let max_backward = self.window_mask - (WINDOW_GAP - 1).max(position - i);
                // `i + MAX_TREE_COMP_LENGTH` is within the current block.
                self.store_and_find_matches::<false>(
                    ringbuffer,
                    i,
                    ringbuffer_mask,
                    MAX_TREE_COMP_LENGTH,
                    max_backward,
                    &mut 0,
                    &mut [],
                    0,
                )?;
            }
        }
        Ok(())
    }
}
