//! `zstd_preSplit.c`: where to cut a block in two, before it is compressed.

use super::hist;
use crate::error::Result;
use crate::util::SliceExt;

const THRESHOLD_PENALTY_RATE: u64 = 16;
const THRESHOLD_BASE: i32 = THRESHOLD_PENALTY_RATE as i32 - 2;
const THRESHOLD_PENALTY: i32 = 3;

const HASHLENGTH: usize = 2;
const KNUTH: u32 = 0x9e37_79b9;

const CHUNKSIZE: usize = 8 << 10;
const SEGMENT_SIZE: usize = 512;

/// `Fingerprint`, with a table of `SIZE` events, which is `1 << hashLog`: the C code leaves the rest of its table at 0.
struct Fingerprint<const SIZE: usize> {
    events: [u32; SIZE],
    nb_events: usize,
}

impl<const SIZE: usize> Fingerprint<SIZE> {
    const fn new() -> Self {
        Self {
            events: [0; SIZE],
            nb_events: 0,
        }
    }

    /// `hash2`: a table of 256 takes the first byte as it is, a larger one a hash of the 2 bytes.
    #[inline(always)]
    const fn hash2(pair: [u8; HASHLENGTH]) -> usize {
        if SIZE == 256 {
            let [first, _] = pair;
            return first as usize;
        }
        ((u16::from_le_bytes(pair) as u32).wrapping_mul(KNUTH) >> (32 - SIZE.trailing_zeros()))
            as usize
    }

    /// `addEvents_generic`: `src` has at least 2 bytes.
    #[inline(always)]
    fn add_events<const SAMPLING_RATE: usize>(&mut self, src: &[u8]) {
        let limit = src.len().saturating_sub(HASHLENGTH - 1);
        let mut n = 0;
        while n < limit {
            if let Some(pair) = src.get(n..).and_then(<[u8]>::first_chunk)
                && let Some(event) = self.events.get_mut(Self::hash2(*pair) & (SIZE - 1))
            {
                *event += 1;
            }
            n += SAMPLING_RATE;
        }
        self.nb_events += limit / SAMPLING_RATE;
    }

    /// `recordFingerprint_generic`
    #[inline(always)]
    fn record<const SAMPLING_RATE: usize>(&mut self, src: &[u8]) {
        self.events.fill(0);
        self.nb_events = 0;
        self.add_events::<SAMPLING_RATE>(src);
    }

    /// `fpDistance`
    fn distance(&self, other: &Self) -> u64 {
        let nb_events1 = self.nb_events as i64;
        let nb_events2 = other.nb_events as i64;
        self.events
            .iter()
            .zip(&other.events)
            .map(|(&event1, &event2)| {
                (i64::from(event1) * nb_events2 - i64::from(event2) * nb_events1).unsigned_abs()
            })
            .sum()
    }

    /// `compareFingerprints`: whether `newfp` is too different from this one.
    fn differs_from(&self, newfp: &Self, penalty: i32) -> bool {
        let p50 = self.nb_events as u64 * newfp.nb_events as u64;
        let deviation = self.distance(newfp);
        let threshold = p50 * (THRESHOLD_BASE + penalty) as u64 / THRESHOLD_PENALTY_RATE;
        deviation >= threshold
    }

    /// `mergeEvents`
    fn merge(&mut self, newfp: &Self) {
        for (acc, &event) in self.events.iter_mut().zip(&newfp.events) {
            *acc += event;
        }
        self.nb_events += newfp.nb_events;
    }
}

/// `ZSTD_splitBlock_byChunks`: cuts before the first chunk that is too different from all there is before it.
#[inline(always)]
fn split_block_by_chunks<const SAMPLING_RATE: usize, const SIZE: usize>(block: &[u8]) -> usize {
    let mut past_events = Fingerprint::<SIZE>::new();
    let mut new_events = Fingerprint::<SIZE>::new();
    let mut penalty = THRESHOLD_PENALTY;
    let (chunks, _) = block.as_chunks::<CHUNKSIZE>();
    let Some((first, chunks)) = chunks.split_first() else {
        return block.len();
    };

    past_events.record::<SAMPLING_RATE>(first);
    let mut pos = CHUNKSIZE;
    for chunk in chunks {
        new_events.record::<SAMPLING_RATE>(chunk);
        if past_events.differs_from(&new_events, penalty) {
            return pos;
        }
        past_events.merge(&new_events);
        if penalty > 0 {
            penalty -= 1;
        }
        pos += CHUNKSIZE;
    }
    block.len()
}

fn split_block_by_chunks_43(block: &[u8]) -> usize {
    split_block_by_chunks::<43, { 1 << 8 }>(block)
}

fn split_block_by_chunks_11(block: &[u8]) -> usize {
    split_block_by_chunks::<11, { 1 << 9 }>(block)
}

fn split_block_by_chunks_5(block: &[u8]) -> usize {
    split_block_by_chunks::<5, { 1 << 10 }>(block)
}

fn split_block_by_chunks_1(block: &[u8]) -> usize {
    split_block_by_chunks::<1, { 1 << 10 }>(block)
}

/// `ZSTD_splitBlock_fromBorders`: cuts if the start and the end of the block are too different. In the middle, or at a
/// quarter from the border that the middle is clearly the most different from.
fn split_block_from_borders(block: &[u8]) -> Result<usize> {
    fn segment(block: &[u8], start: usize) -> Result<Fingerprint<256>> {
        let mut fingerprint = Fingerprint::new();
        hist::add(&mut fingerprint.events, block.span(start, SEGMENT_SIZE)?)?;
        fingerprint.nb_events = SEGMENT_SIZE;
        Ok(fingerprint)
    }

    let block_size = block.len();
    let past_events = segment(block, 0)?;
    let new_events = segment(block, block_size.wrapping_sub(SEGMENT_SIZE))?;
    if !past_events.differs_from(&new_events, 0) {
        return Ok(block_size);
    }

    let middle_events = segment(block, (block_size / 2).wrapping_sub(SEGMENT_SIZE / 2))?;
    let dist_from_begin = past_events.distance(&middle_events);
    let dist_from_end = new_events.distance(&middle_events);
    let min_distance = (SEGMENT_SIZE * SEGMENT_SIZE / 3) as u64;
    if dist_from_begin.abs_diff(dist_from_end) < min_distance {
        return Ok(64 << 10);
    }
    Ok(if dist_from_begin > dist_from_end {
        32 << 10
    } else {
        96 << 10
    })
}

/// `ZSTD_splitBlock`: `block` is 128 KB, and `level` is from 0 to 4: the higher, the more work is put in. Returns the
/// size of the first part, which is the whole if the block is better left in one piece.
pub(crate) fn split_block(block: &[u8], level: i32) -> Result<usize> {
    debug_assert!(block.len() == 128 << 10);
    Ok(match level {
        0 => split_block_from_borders(block)?,
        1 => split_block_by_chunks_43(block),
        2 => split_block_by_chunks_11(block),
        3 => split_block_by_chunks_5(block),
        _ => split_block_by_chunks_1(block),
    })
}
