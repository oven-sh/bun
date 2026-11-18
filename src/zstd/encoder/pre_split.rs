//! Ends a block early where the input seems to change, before anything is known about matches.

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::bounded::Bounded;
use bun_zstd_decoder::format::BLOCK_LEN_MAX;

use crate::bytes::chunk_at;
use crate::entropy::histogram::{self, raise};
use crate::parameters::Strategy;

type Block = [u8; BLOCK_LEN_MAX];

/// `distance` is that of two samples with `first` and `second` events, divided by `second`.
fn is_far(distance: u32, first: u32, second: u32, penalty: u64) -> bool {
    let [distance, first, second] = [distance, first, second].map(u64::from);
    distance * second >= first * second * (14 + penalty) / 16
}

#[inline(always)]
fn sum_of_magnitudes(differences: impl Iterator<Item = u32>) -> u32 {
    let magnitudes = differences.map(|it| (it as i32).unsigned_abs());
    magnitudes.fold(0, u32::plus)
}

#[inline(never)]
fn split_by_borders(block: &Block) -> usize {
    const SAMPLE_LEN: u32 = 512;
    let sample = |start: usize| {
        let mut events = [0; 256];
        let bytes = block.get(start..start + SAMPLE_LEN as usize);
        histogram::add(&mut events, bytes.unwrap_or_default());
        events
    };
    let distance = |a: &[u32; 256], b: &[u32; 256]| {
        sum_of_magnitudes(a.iter().zip(b).map(|(a, b)| a.wrapping_sub(*b)))
    };
    let (first, last) = (sample(0), sample(block.len() - SAMPLE_LEN as usize));
    if !is_far(distance(&first, &last), SAMPLE_LEN, SAMPLE_LEN, 0) {
        return block.len();
    }
    let middle = sample((block.len() - SAMPLE_LEN as usize) / 2);
    let (from_first, from_last) = (distance(&first, &middle), distance(&last, &middle));
    if SAMPLE_LEN * from_first.abs_diff(from_last) < SAMPLE_LEN * SAMPLE_LEN / 3 {
        block.len() / 2
    } else if from_first > from_last {
        block.len() / 4
    } else {
        block.len() / 4 * 3
    }
}

/// Looks at one in `RATE` positions, and sorts them into `N` classes.
#[inline(never)]
fn split_by_chunks<const RATE: usize, const N: usize>(block: &Block) -> usize {
    const CHUNK_LEN: usize = 8 << 10;
    const COUNT_BITS: u32 = 13;
    const { assert!((CHUNK_LEN - 1).div_ceil(RATE) < 1 << COUNT_BITS) };
    const { assert!(BLOCK_LEN_MAX <= 1 << (32 - COUNT_BITS)) };
    let count = ((CHUNK_LEN - 1) / RATE) as u32;
    let mut past = [0u32; N];
    for (before, chunk) in (0u32..).zip(block.as_chunks::<CHUNK_LEN>().0) {
        // Above each count is its product with `before`: many `pmulld` after a `memcpy()` lower the clock of Cascade Lake by 13%.
        let mut events = [0; N];
        let mut at = 0;
        while let Some(&pair @ [first, _]) = chunk_at(chunk, at) {
            let class = if N == 256 {
                u32::from(first)
            } else {
                u32::from(u16::from_le_bytes(pair)).wrapping_mul(0x9E37_79B9) >> (32 - N.ilog2())
            };
            raise(events.at_mut(class as usize), before << COUNT_BITS | 1);
            at += RATE as u32;
        }
        let pairs = past.iter().zip(&events);
        let distance = sum_of_magnitudes(pairs.map(|(a, b)| a.wrapping_sub(b >> COUNT_BITS)));
        let penalty = 4u64.saturating_sub(before.into());
        if before != 0 && is_far(distance, before * count, count, penalty) {
            return before as usize * CHUNK_LEN;
        }
        for (past, new) in past.iter_mut().zip(&events) {
            raise(past, new % (1 << COUNT_BITS));
        }
    }
    block.len()
}

/// How much of `block` to compress as one.
pub(crate) fn block_len(block: &Block, strategy: Strategy) -> usize {
    match strategy {
        Strategy::Fast => split_by_borders(block),
        Strategy::DoubleFast => split_by_chunks::<43, 256>(block),
        Strategy::Greedy | Strategy::Lazy => split_by_chunks::<11, 512>(block),
        Strategy::Lazy2 | Strategy::TreeLazy2 => split_by_chunks::<5, 1024>(block),
        Strategy::Optimal | Strategy::Ultra | Strategy::Ultra2 => split_by_chunks::<1, 1024>(block),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_get_as_high_as_they_can() {
        let mut block = Box::new([0; BLOCK_LEN_MAX]);
        assert_eq!(split_by_chunks::<1, 1024>(&block), BLOCK_LEN_MAX);
        for byte in block.iter_mut().skip(BLOCK_LEN_MAX - (8 << 10)) {
            *byte = 1;
        }
        assert_eq!(split_by_chunks::<1, 1024>(&block), 120 << 10);
    }

    #[test]
    fn a_chunk_differs_by_just_enough() {
        for (similar_chunks, expected) in [(1, 4 << 13), (2, BLOCK_LEN_MAX)] {
            let mut block = [0; _];
            let changed = block.iter_mut().skip(4 << 13).take(3584);
            changed.for_each(|it| *it = 1);
            let starts = block.iter_mut().step_by(1 << 13);
            starts.take(similar_chunks).for_each(|it| *it = 1);
            assert_eq!(block_len(&block, Strategy::Optimal), expected);
        }
    }

    /// The hash is of what `ZSTD_splitBlock()` returns.
    #[test]
    fn blocks_end_where_those_of_zstd_do() {
        use Strategy::{DoubleFast, Fast, Greedy, Lazy2, Optimal};

        let mut state = 1u32;
        let mut block = Box::new([0u8; BLOCK_LEN_MAX]);
        let mut lens = Vec::new();
        for (changes_at, share) in (0..13).flat_map(|at| (0..24).map(move |share| (at, share))) {
            // From there on, so many of 32 bytes are others. The last ones go back, or change in the middle of a sample.
            let (start, end) = match changes_at {
                ..8 => ((1 + changes_at * changes_at / 3) << 13, BLOCK_LEN_MAX),
                8 => (300, BLOCK_LEN_MAX - 200),
                9 => (BLOCK_LEN_MAX / 2 - 100, BLOCK_LEN_MAX),
                10 => (BLOCK_LEN_MAX / 2 + 60, BLOCK_LEN_MAX),
                11 => (BLOCK_LEN_MAX - 400, BLOCK_LEN_MAX),
                _ => (0, 1 + 22 * share as usize),
            };
            let alphabet = if share % 2 == 0 { 5 } else { 12 };
            for (at, byte) in block.iter_mut().enumerate() {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                let is_other = (start..end).contains(&at) && state >> 27 < 8 + share;
                // One way to see which positions get looked at.
                let is_other = is_other && (changes_at % 2 == 0 || at % 5 < 4);
                *byte = (state >> 8) as u8 % alphabet + if is_other { 100 } else { 0 };
            }
            let strategies = [Fast, DoubleFast, Greedy, Lazy2, Optimal];
            lens.extend(strategies.map(|it| (block_len(&block, it) >> 13) as u8));
        }
        assert_eq!(bun_zstd_decoder::XxHash64::hash(&lens) as u32, 0x1B11_80AB);
    }
}
