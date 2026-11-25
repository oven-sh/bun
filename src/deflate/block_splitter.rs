//! Ends a block where the kinds of symbols that make up the data change.

use crate::block::Frequencies;
use crate::format::{FIRST_LENGTH_SYMBOL, length_slot_of};

/// The last block may be shorter.
pub(crate) const MIN_BLOCK_LEN: usize = 5000;
pub(crate) const SOFT_MAX_BLOCK_LEN: usize = 300_000;
pub(crate) const OBSERVATIONS_PER_CHECK: usize = 512;

const LITERAL_KINDS: usize = 8;
const MAX_SHORT_LEN: usize = 8;
/// Counts of literals by their two high bits and their low bit, of short matches, and of longer ones. Then zeros.
pub(crate) type Observations = [u32; 16];

#[inline(always)]
pub(crate) fn literal_kind(literal: u8) -> usize {
    usize::from(((literal >> 5) & 6) | (literal & 1))
}

#[inline(always)]
pub(crate) fn match_kind(len: usize) -> usize {
    LITERAL_KINDS + usize::from(len > MAX_SHORT_LEN)
}

pub(crate) fn observations(frequencies: &Frequencies) -> Observations {
    let mut observations = Observations::default();
    let (literal_kinds, _) = observations.as_chunks_mut::<2>();
    let (quarters, _) = frequencies.literals().as_chunks::<64>();
    for (kinds, quarter) in literal_kinds.iter_mut().zip(quarters) {
        for &[even, odd] in quarter.as_chunks().0 {
            *kinds = [kinds[0] + even, kinds[1] + odd];
        }
    }
    let (short, long) = frequencies
        .litlen
        .split_at(FIRST_LENGTH_SYMBOL)
        .1
        .split_at(const { length_slot_of(MAX_SHORT_LEN) + 1 });
    observations[LITERAL_KINDS] = short.iter().sum();
    observations[LITERAL_KINDS + 1] = long.iter().sum();
    observations
}

/// Does not leave too little for a block of its own.
pub(crate) fn max_block_end(start: usize, input_len: usize, soft_max_len: usize) -> usize {
    match input_len - start < soft_max_len + MIN_BLOCK_LEN {
        true => input_len,
        false => start + soft_max_len,
    }
}

#[inline(always)]
pub(crate) fn may_split(block_len: usize, remaining: usize) -> bool {
    block_len >= MIN_BLOCK_LEN && remaining >= MIN_BLOCK_LEN
}

/// Whether what is `new` in a block differs enough from what is `old`.
pub(crate) fn should_split(old: &Observations, new: &Observations, block_len: usize) -> bool {
    let (old_count, new_count): (u32, u32) = (old.iter().sum(), new.iter().sum());
    if old_count == 0 {
        return false;
    }
    // Probabilities, times both counts.
    let difference = old.iter().zip(new).fold(0u32, |sum, (&old, &new)| {
        let (expected, actual) = (old.wrapping_mul(new_count), new.wrapping_mul(old_count));
        sum.wrapping_add(expected.abs_diff(actual))
    });
    let mut cutoff = (new_count * 200 / 512).wrapping_mul(old_count);
    let count = old_count + new_count;
    if block_len < 10000 && count < 8192 {
        cutoff += (u64::from(cutoff) * u64::from(8192 - count) / 8192) as u32;
    }
    difference.wrapping_add((block_len as u32 / 4096).wrapping_mul(old_count)) >= cutoff
}
