//! The positions with the same hash next to each other, for when there are many of them to look at.

use core::hint::select_unpredictable;
use core::ops::Range;

use super::hash::{self, HASHES};
use super::{
    Image, LONG_ENOUGH, Match, PREFETCH_DISTANCE, Target, common_len, differences, prefetch,
};
use crate::array::At;
use crate::error::Result;
use crate::lossless::Argb;
use crate::slice::{InBounds, known};
use crate::vec;

const POSITION_BITS: u32 = 24;
const COUNT_BITS: u32 = 6;
const MANY: u32 = (1 << COUNT_BITS) - 1;
const GROUP: usize = 16;
/// At least `Target::tries`.
const CANDIDATES: usize = 3 * GROUP;

/// For the pixel that follows what the hash covers. Above the bits of a position or a hash.
#[inline(always)]
const fn tag(pixel: Argb) -> u32 {
    tag_of(pixel.wrapping_mul(0x9e37_79b1))
}

#[inline(always)]
const fn tag_of(tagged: u32) -> u32 {
    tagged >> POSITION_BITS << POSITION_BITS
}

#[inline(always)]
fn tagged_with(tag: u32, entries: &[u32; GROUP]) -> u64 {
    let mut same = 0u16;
    for (i, &entry) in entries.iter().enumerate() {
        same |= u16::from(tag_of(entry ^ tag) == 0) << i;
    }
    same.into()
}

#[derive(Default)]
pub(super) struct Buckets {
    /// What the positions are counted from.
    start: usize,
    /// Tag and position, in each bucket from the last position to the first.
    entries: Vec<u32>,
    /// By position, the index after that of its entry and how many more entries of the bucket there are from there on,
    /// at most `MANY`.
    ranks: Vec<u32>,
    by_hash: Option<Box<[u32; HASHES]>>,
}

fn refill(vec: &mut Vec<u32>, value: u32, len: usize) -> Result<&mut [u32]> {
    vec.clear();
    vec.try_reserve_exact(len)?;
    vec.resize(len, value);
    Ok(vec)
}

impl Buckets {
    pub(super) fn fill(&mut self, pixels: &[Argb], positions: Range<usize>) -> Result<()> {
        const NO_HASH: u32 = u32::MAX;
        const HAS_ROOM: u32 = 1 << 31;
        self.start = positions.start;
        let pixels = pixels.part(positions.start..);
        let entries = refill(&mut self.entries, 0, positions.len() + CANDIDATES)?;
        let keys_then_ranks = refill(&mut self.ranks, NO_HASH, positions.len())?;
        let counts_then_ranks = match &mut self.by_hash {
            Some(used) => {
                used.fill(0);
                used
            }
            None => self.by_hash.insert(vec::array(0)?),
        };

        hash::for_each(pixels, positions.len(), |at, hash, next| {
            if let Some(key) = keys_then_ranks.get_mut(at) {
                *key = tag(next) | hash as u32;
                *counts_then_ranks.at_mut(hash) += 1;
            }
        });
        let mut end = 0;
        for (position, to) in (0..).zip(keys_then_ranks) {
            let key = core::mem::take(to);
            if key == NO_HASH {
                continue;
            }
            let last = counts_then_ranks.at_mut(key as usize % HASHES);
            let is_first = *last < HAS_ROOM;
            end += select_unpredictable(is_first, *last, 0);
            let next = last.wrapping_sub(1 << COUNT_BITS) + u32::from(*last & MANY != MANY);
            *last = select_unpredictable(is_first, HAS_ROOM | end << COUNT_BITS, next);
            *to = *last & !HAS_ROOM;
            entries.set((*to >> COUNT_BITS) as usize - 1, tag_of(key) | position);
        }
        Ok(())
    }

    /// For a target that is not within `LONG_ENOUGH` of the end of the image.
    #[inline(always)]
    pub(super) fn improve(&self, image: &Image, target: &Target, found: Match) -> Match {
        const HEAD: usize = 8;
        let index = target.at - self.start;
        if let Some(rank) = self.ranks.get(index.wrapping_sub(PREFETCH_DISTANCE)) {
            prefetch(&self.entries, (rank >> COUNT_BITS) as usize);
        }
        let rank = self.ranks.value(index);
        let count = target.tries.min((rank & MANY) as usize);
        let entries = (count > 0).then(|| self.entries.part((rank >> COUNT_BITS) as usize - 1..));
        let entries = entries.and_then(|it| known(it.first_chunk::<{ 1 + CANDIDATES }>()));
        let Some([own, candidates @ ..]) = entries else {
            return found;
        };
        let position = |entry: u32| self.start + (entry - tag_of(entry)) as usize;
        let hashed = match *target.pixels {
            [a, b, c, ..] if a == b && b == c => {
                1 + common_len(target.pixels, image.ahead(target.at + 1))
            }
            _ => 2,
        };

        // Only what has the same tag can match more than the hash covers.
        let (mut distance, mut len) = (found.distance(), found.len());
        if len >= hashed || hashed < LONG_ENOUGH {
            let same_from = |start| tagged_with(*own, &candidates.chunk(start)) << start;
            let mut same = same_from(0);
            if count > GROUP {
                same |= same_from(GROUP) | same_from(2 * GROUP);
            }
            same &= !(u64::MAX << count);
            let head = target.pixels.chunk::<HEAD>(0);
            let (mut best_from, mut best_len) = (target.at, len.max(hashed));
            while same != 0 {
                let from = position(*candidates.at(same.trailing_zeros() as usize));
                same &= same - 1;
                if from < target.earliest {
                    break;
                }
                let source = image.ahead(from);
                let mut new_len = differences(&head, &source.chunk(0)).trailing_zeros() as usize;
                if new_len == HEAD {
                    if source.at(best_len) != target.pixels.at(best_len) {
                        continue;
                    }
                    new_len = target.len_from(source);
                    if new_len > best_len && new_len >= LONG_ENOUGH {
                        return Match::new(target.at - from, new_len);
                    }
                }
                best_from = select_unpredictable(new_len > best_len, from, best_from);
                best_len = best_len.max(new_len);
            }
            if best_from != target.at {
                return Match::new(target.at - best_from, best_len);
            }
        }
        for &entry in candidates.iter().take(count) {
            let from = position(entry);
            if len >= hashed || from < target.earliest {
                break;
            }
            let new_len = target.len_from(image.ahead(from));
            if new_len > len {
                (distance, len) = (target.at - from, new_len);
                if len >= LONG_ENOUGH {
                    break;
                }
            }
        }
        Match::new(distance, len)
    }
}
