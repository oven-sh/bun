use core::ops::Range;

use bun_highway::brotli::Place;

use super::hash::{Candidate, Match, score, score_of_recent};
use super::matching::{HASH_MULTIPLIER_64, load32, match_length};
use super::ring_buffer::SLACK;
use crate::memory::{self, Result};

const BUCKET_LIMIT: u8 = 32;
/// So many buckets have fewer than 2^16 entries.
const GROUP_SIZE: usize = 1024;

/// What came before the stream, and a hash table over it.
pub(super) struct PreparedDictionary {
    padded: Vec<u8>,
    bucket_bits: u32,
    buckets: Buckets,
    offsets: Vec<u32>,
}

struct Buckets {
    /// The low bits of where each one starts, and of where the last one ends.
    starts: Vec<u16>,
    group_starts: Vec<u32>,
}

impl Buckets {
    /// And the sum of `sizes`.
    fn new(sizes: &[u8]) -> Result<(Self, usize)> {
        let mut starts = memory::empty(sizes.len() + 1)?;
        let mut group_starts = memory::empty(sizes.len() / GROUP_SIZE)?;
        let mut total = 0;
        starts.push(0);
        for group in sizes.as_chunks::<GROUP_SIZE>().0 {
            group_starts.push(total);
            starts.extend(group.iter().map(|&size| {
                total += u32::from(size);
                total as u16
            }));
        }
        let buckets = Self {
            starts,
            group_starts,
        };
        Ok((buckets, total as usize))
    }

    #[inline(always)]
    fn range(&self, key: usize) -> Range<usize> {
        let base = self.group_starts[key / GROUP_SIZE];
        let at = |i: usize| base as usize + usize::from(self.starts[i].wrapping_sub(base as u16));
        at(key)..at(key + 1)
    }
}

#[inline(always)]
fn hash(eight_bytes: u64, bucket_bits: u32) -> usize {
    ((eight_bytes & 0xFF_FFFF_FFFF).wrapping_mul(HASH_MULTIPLIER_64) >> (64 - bucket_bits)) as usize
}

impl PreparedDictionary {
    /// The most that [`find_all`](Self::find_all) adds.
    pub(super) const MAX_CANDIDATES: usize = BUCKET_LIMIT as usize;

    pub(super) fn new(bytes: &[u8]) -> Result<Self> {
        let mut padded = memory::empty(bytes.len() + SLACK)?;
        padded.extend_from_slice(bytes);
        padded.extend([0; SLACK]);
        let mut bucket_bits = 17;
        while 16 << bucket_bits < bytes.len() && bucket_bits < 22 {
            bucket_bits += 1;
        }
        let keys = || {
            let all = padded[..bytes.len()].array_windows().enumerate();
            all.map(|(i, &eight)| (i, hash(u64::from_le_bytes(eight), bucket_bits)))
        };
        let mut room = memory::zeroed::<u8>(1 << bucket_bits)?;
        for (_, key) in keys() {
            room[key] = (room[key] + 1).min(BUCKET_LIMIT);
        }
        let (buckets, total) = Buckets::new(&room)?;
        let mut offsets = memory::zeroed(total)?;
        for (offset, key) in keys().rev() {
            if room[key] != 0 {
                offsets[buckets.range(key).end - usize::from(room[key])] = offset as u32;
                room[key] -= 1;
            }
        }
        Ok(Self {
            padded,
            bucket_bits,
            buckets,
            offsets,
        })
    }

    pub(super) fn bytes(&self) -> &[u8] {
        &self.padded[..self.padded.len().saturating_sub(SLACK)]
    }

    /// The latest first.
    fn offsets_for(&self, eight_bytes: u64) -> impl Iterator<Item = usize> {
        let key = hash(eight_bytes, self.bucket_bits);
        let bucket = &self.offsets[self.buckets.range(key)];
        bucket.iter().map(|&offset| offset as usize)
    }

    /// The bytes that `distance` refers to, if the last byte of the dictionary is at `end_distance + 1`.
    pub(super) fn at_distance(&self, distance: usize, end_distance: usize) -> Option<&[u8]> {
        let length = distance.checked_sub(end_distance)?;
        Some(&self.bytes()[self.bytes().len().checked_sub(length)?..])
    }

    /// `pair` is `offset` bytes into a match, if one can be so long. See [`Self::at_distance`].
    #[inline(always)]
    pub(super) fn place(
        &self,
        end_distance: usize,
        offset: usize,
        pair: [u8; 2],
    ) -> Option<Place<'_>> {
        (offset + pair.len() <= self.bytes().len()).then(|| Place {
            ring: &self.padded[offset..],
            ring_mask: u32::MAX,
            position: (self.bytes().len() + end_distance) as u32,
            pair,
        })
    }

    #[inline(never)]
    pub(super) fn improve(&self, query: &Query<'_>, recent: [i32; 4], mut best: Match) -> Match {
        let mut best_length = best.length;
        for (i, distance) in recent.into_iter().enumerate() {
            let distance = distance as usize;
            let Some(source) = self.at_distance(distance, query.end_distance) else {
                continue;
            };
            let length = match_length(source, query.data);
            let score = score_of_recent(length, i);
            if length >= 2 && best.score < score {
                best_length = best_length.max(length);
                best = Match::new(length, distance, score);
            }
        }
        best_length = best_length.max(3);
        for offset in self.offsets_for(query.eight_bytes) {
            let Some((distance, source)) = self.worth_comparing(query, offset, best_length) else {
                continue;
            };
            if load32(query.data, best_length - 3) != load32(source, best_length - 3) {
                continue;
            }
            let length = match_length(source, query.data);
            let score = score(length, distance);
            if length >= 4 && best.score < score {
                best_length = length;
                best = Match::new(length, distance, score);
            }
        }
        best
    }

    /// Matches of four bytes or more, each longer than the one before. `found` has room for them.
    pub(super) fn find_all(&self, query: &Query<'_>, found: &mut Vec<Candidate>) {
        let mut best_length = 3;
        for offset in self.offsets_for(query.eight_bytes) {
            let Some((distance, source)) = self.worth_comparing(query, offset, best_length) else {
                continue;
            };
            if query.data[best_length] != source[best_length] {
                continue;
            }
            let length = match_length(source, query.data);
            if length > best_length {
                best_length = length;
                found.push(Candidate::new(distance, length));
            }
        }
    }

    fn worth_comparing(
        &self,
        query: &Query<'_>,
        offset: usize,
        best_length: usize,
    ) -> Option<(usize, &[u8])> {
        let source = &self.bytes()[offset..];
        let distance = query.end_distance + source.len();
        (distance <= query.max_distance
            && best_length <= query.before_ring_end
            && best_length < source.len().min(query.data.len()))
        .then_some((distance, source))
    }
}

pub(super) struct Query<'a> {
    pub(super) data: &'a [u8],
    /// The start of `data`, and what follows it if it is short.
    pub(super) eight_bytes: u64,
    pub(super) before_ring_end: usize,
    /// One less than the distance of the last byte of the dictionary.
    pub(super) end_distance: usize,
    pub(super) max_distance: usize,
}
