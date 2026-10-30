//! A rolling hash over long chunks, to find long matches at long distances. It keeps one position for each hash.

use super::{
    HasherImpl, HasherSearchResult, LongestMatchHasher, StaticDictionarySearch,
    backward_reference_score,
};
use crate::enc::find_match_length::find_match_length_with_limit;
use crate::util::{Checked, SliceExt, try_vec};
use bun_core::AllocError;

const FACTOR: u32 = 69069;
const INVALID_POS: u32 = 0xFFFF_FFFF;

/// How many bytes are hashed.
const CHUNKLEN: usize = 32;
const NUM_BUCKETS: usize = 16_777_216;
/// `NUM_BUCKETS / (MASK + 1)` of the hashes are stored and looked up.
const MASK: u32 = (NUM_BUCKETS as u32 * 64) - 1;

/// What a byte adds to the hash.
#[inline(always)]
fn hash_byte(byte: u8) -> u32 {
    u32::from(byte) + 1
}

#[inline(always)]
fn hash_rolling_function_initial(state: u32, add: u8) -> u32 {
    FACTOR.wrapping_mul(state).wrapping_add(hash_byte(add))
}

/// Only looks at every `JUMP`th byte, and only at positions that are a multiple of `JUMP`, for speed.
pub(crate) struct HashRolling<const JUMP: usize> {
    /// The hash of the chunk at `next_ix`.
    state: u32,
    table: Vec<u32>,
    next_ix: usize,
}

impl<const JUMP: usize> HashRolling<JUMP> {
    /// What the oldest byte of a chunk was multiplied by.
    const FACTOR_REMOVE: u32 = FACTOR.wrapping_pow(CHUNKLEN.div_ceil(JUMP) as u32);

    pub(crate) fn new() -> Result<Self, AllocError> {
        Ok(Self {
            state: 0,
            table: try_vec(INVALID_POS, NUM_BUCKETS)?,
            next_ix: 0,
        })
    }

    #[inline(always)]
    fn hash_rolling_function(state: u32, add: u8, rem: u8) -> u32 {
        hash_rolling_function_initial(state, add)
            .wrapping_sub(Self::FACTOR_REMOVE.wrapping_mul(hash_byte(rem)))
    }
}

impl<const JUMP: usize> HasherImpl for HashRolling<JUMP> {
    // More bytes than this are needed. That is checked at each lookup instead, because a higher value would hold back
    // the hasher that this one is combined with.
    const HASH_TYPE_LENGTH: usize = 4;
    const STORE_LOOKAHEAD: usize = 4;

    /// The table keeps what it has.
    fn prepare(&mut self, _one_shot: bool, input_size: usize, data: &[u8]) -> Checked {
        if input_size < CHUNKLEN {
            return Ok(());
        }
        self.state = 0;
        for &byte in data.sub(..CHUNKLEN)?.iter().step_by(JUMP) {
            self.state = hash_rolling_function_initial(self.state, byte);
        }
        Ok(())
    }

    #[inline(always)]
    fn store(&mut self, _data: &[u8], _mask: usize, _ix: usize) -> Checked {
        Ok(())
    }

    #[inline(always)]
    fn store_range(
        &mut self,
        _data: &[u8],
        _mask: usize,
        _ix_start: usize,
        _ix_end: usize,
    ) -> Checked {
        Ok(())
    }

    /// Starts from scratch at `position`.
    fn stitch_to_previous_block(
        &mut self,
        num_bytes: usize,
        mut position: usize,
        data: &[u8],
        mask: usize,
    ) -> Checked {
        let mut available = num_bytes;
        if position & (JUMP - 1) != 0 {
            let diff = JUMP - (position & (JUMP - 1));
            available = available.saturating_sub(diff);
            position += diff;
        }
        let position_masked = position & mask;
        // A chunk that wraps around the ring buffer is not handled.
        if available > mask - position_masked {
            available = mask - position_masked;
        }

        self.prepare(false, available, data.sub(position_masked..)?)?;
        self.next_ix = position;
        Ok(())
    }
}

impl<const JUMP: usize> LongestMatchHasher for HashRolling<JUMP> {
    #[inline(always)]
    fn prepare_distance_cache(&self, _distance_cache: &mut [i32; 16]) {}

    /// Does not look in the static dictionary: the hasher that this one is combined with does.
    #[inline(always)]
    fn find_longest_match(
        &mut self,
        _dictionary: &mut StaticDictionarySearch<'_>,
        data: &[u8],
        mask: usize,
        _distance_cache: &[i32; 16],
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        _dictionary_distance: usize,
        _max_distance: usize,
        out: &mut HasherSearchResult,
    ) -> Checked {
        let cur_ix_masked = cur_ix & mask;

        if cur_ix & (JUMP - 1) != 0 {
            return Ok(());
        }

        // Not enough lookahead.
        if max_length < CHUNKLEN {
            return Ok(());
        }

        let mut pos = self.next_ix;
        while pos <= cur_ix {
            let code = self.state & MASK;

            let rem = data.at(pos & mask)?;
            let add = data.at((pos + CHUNKLEN) & mask)?;

            self.state = Self::hash_rolling_function(self.state, add, rem);

            if (code as usize) < NUM_BUCKETS {
                let entry = self.table.at_mut(code as usize)?;
                let found_ix = *entry;
                *entry = pos as u32;
                if pos == cur_ix && found_ix != INVALID_POS {
                    // In 32 bits, so that distances up to 4 GiB work whatever `cur_ix` is.
                    let backward = (cur_ix as u32).wrapping_sub(found_ix) as usize;
                    // Positions repeat every 2 GiB and the table is never cleared, so this can be `cur_ix` of the lap
                    // before. The reference encoder takes that for a match at distance 0.
                    if backward != 0 && backward <= max_backward {
                        let found_ix_masked = found_ix as usize & mask;
                        let len = find_match_length_with_limit(
                            data.sub(found_ix_masked..)?,
                            data.sub(cur_ix_masked..)?,
                            max_length,
                        );
                        if len >= 4 && len > out.len {
                            let score = backward_reference_score(len, backward);
                            if score > out.score {
                                out.len = len;
                                out.distance = backward;
                                out.score = score;
                                out.len_code_delta = 0;
                            }
                        }
                    }
                }
            }
            pos += JUMP;
        }

        self.next_ix = cur_ix + JUMP;
        Ok(())
    }
}
