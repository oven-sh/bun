//! Ends a block early where the input seems to change, before anything is known about matches.

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::format::BLOCK_LEN_MAX;

use crate::bytes::chunk_at;
use crate::entropy::histogram;
use crate::parameters::Strategy;

type Block = [u8; BLOCK_LEN_MAX];

/// Products of two counts take no more than 30 bits.
struct Fingerprint<const N: usize> {
    events: [u32; N],
    count: u32,
}

impl<const N: usize> Fingerprint<N> {
    fn distance(&self, other: &Self) -> u32 {
        let pairs = self.events.iter().zip(&other.events);
        let scaled = pairs.map(|(a, b)| (a * other.count) as i32 - (b * self.count) as i32);
        scaled.map(i32::unsigned_abs).sum()
    }

    fn differs_from(&self, other: &Self, penalty: u64) -> bool {
        u64::from(self.distance(other)) >= u64::from(self.count * other.count) * (14 + penalty) / 16
    }
}

#[inline(never)]
fn split_by_borders(block: &Block) -> usize {
    const SAMPLE_LEN: usize = 512;
    let sample = |start: usize| {
        let mut events = [0; 256];
        let bytes = block.get(start..start + SAMPLE_LEN).unwrap_or_default();
        histogram::add(&mut events, bytes);
        Fingerprint {
            events,
            count: SAMPLE_LEN as u32,
        }
    };
    let (first, last) = (sample(0), sample(block.len() - SAMPLE_LEN));
    if !first.differs_from(&last, 0) {
        return block.len();
    }
    let middle = sample((block.len() - SAMPLE_LEN) / 2);
    let (from_first, from_last) = (first.distance(&middle), last.distance(&middle));
    if from_first.abs_diff(from_last) < (SAMPLE_LEN * SAMPLE_LEN / 3) as u32 {
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
    let fingerprint = |chunk: &[u8; CHUNK_LEN]| {
        let mut events = [0; N];
        let mut at = 0;
        while let Some(&pair @ [first, _]) = chunk_at(chunk, at) {
            let class = if N == 256 {
                u32::from(first)
            } else {
                u32::from(u16::from_le_bytes(pair)).wrapping_mul(0x9E37_79B9) >> (32 - N.ilog2())
            };
            *events.at_mut(class as usize) += 1;
            at += RATE as u32;
        }
        Fingerprint {
            events,
            count: ((CHUNK_LEN - 1) / RATE) as u32,
        }
    };

    let mut chunks = block.as_chunks().0.iter().map(fingerprint);
    let Some(mut past) = chunks.next() else {
        return block.len();
    };
    for (index, chunk) in chunks.enumerate() {
        if past.differs_from(&chunk, 3u64.saturating_sub(index as u64)) {
            return (index + 1) * CHUNK_LEN;
        }
        for (past, new) in past.events.iter_mut().zip(chunk.events) {
            *past += new;
        }
        past.count += chunk.count;
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
