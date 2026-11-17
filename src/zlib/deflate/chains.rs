//! Earlier positions in the window by the hash of what starts there, and the search for matches among them.

use bun_core::ffi::try_boxed_zeroed;
use bun_highway::zlib::subtract_saturating;

use super::window::{SCAN_LEN, byte, chunk, long_match_len, word};
use crate::array::At;
use crate::error::Result;
use crate::format::MIN_MATCH;
use crate::vec;

/// So many bytes are hashed, but for the rolling hash. Only lazy matching takes shorter matches.
pub(super) const HASHED_LEN: u32 = 4;
const WORD: u32 = 8;
const MIN_LINKS: usize = 512;

type Heads = [u16; 1 << 16];

/// Position 0 stands for none.
pub(super) struct Chains {
    heads: Box<Heads>,
    /// From a position, modulo the length, to the one before it. As long as the power of two that it has had to be.
    links: Vec<u16>,
    rolling_hash: u32,
}

#[inline(always)]
fn roll(hash: u32, byte: u8) -> u32 {
    (hash << 5 ^ u32::from(byte)) % (1 << 15)
}

#[inline(always)]
fn hash(bytes: [u8; HASHED_LEN as usize]) -> u32 {
    u32::from_le_bytes(bytes).wrapping_mul(2654435761) >> 16
}

/// Returns the position that was inserted last with the same hash.
#[inline(always)]
fn insert(heads: &mut Heads, links: &mut [u16], hash: u32, position: u32) -> u32 {
    let head = heads.at_mut(hash as usize);
    let previous = *head;
    if u32::from(previous) != position {
        *head = position as u16;
        if let Some(link) = links.get_mut(position as usize & links.len().wrapping_sub(1)) {
            *link = previous;
        }
    }
    previous.into()
}

#[inline(always)]
fn link(links: &[u16], position: u32) -> u32 {
    let index = position as usize & links.len().wrapping_sub(1);
    links.get(index).copied().map_or(0, u32::from)
}

#[derive(Clone, Copy)]
pub(super) struct Match {
    pub(super) start: u32,
    pub(super) len: u32,
}

impl Match {
    /// One byte short of what counts as a match.
    pub(super) const NONE: Self = Self {
        start: 0,
        len: MIN_MATCH as u32 - 1,
    };

    /// From `position`, where it is used.
    #[inline(always)]
    pub(super) fn distance(self, window: &[u8], position: u32) -> u32 {
        let bytes = |at: u32| window.get(at as usize..(at + self.len) as usize);
        debug_assert!(self.start < position && bytes(self.start) == bytes(position));
        position - self.start
    }
}

/// How hard to look for a match.
#[derive(Clone, Copy)]
pub(super) struct Effort {
    /// A quarter of `max_chain` will do to improve on a match that is so long.
    pub(super) good_len: u32,
    /// A match that is so long ends the search.
    pub(super) nice_len: u32,
    pub(super) max_chain: u32,
    /// At the first candidate that looks good and is not.
    pub(super) gives_up_early: bool,
}

/// Where a match is wanted.
#[derive(Clone, Copy)]
pub(super) struct Search {
    pub(super) position: u32,
    pub(super) lookahead: u32,
    pub(super) max_distance: u32,
    pub(super) effort: Effort,
}

impl Search {
    #[inline(always)]
    pub(super) fn reaches(&self, candidate: u32) -> bool {
        let distance = self.position.wrapping_sub(candidate);
        candidate != 0 && distance.wrapping_sub(1) < self.max_distance
    }
}

/// What a candidate has to have to be longer than the best match so far.
#[derive(Clone, Copy)]
struct Filter {
    first: u64,
    /// The bytes of `first` that count.
    mask: u64,
    /// The word that ends one byte behind the best match, if that is not in `first`.
    last: u64,
    last_offset: u32,
}

impl Filter {
    #[inline(always)]
    fn new(scan: &[u8; SCAN_LEN], best_len: u32) -> Self {
        let last_offset = (best_len + 1).saturating_sub(WORD);
        Self {
            first: word(scan, 0).unwrap_or_default(),
            mask: u64::MAX >> (8 * WORD.saturating_sub(best_len + 1)),
            last: word(scan, last_offset).unwrap_or_default(),
            last_offset,
        }
    }
}

impl Chains {
    pub(super) fn new(window_size: u32) -> Result<Self> {
        let mut links = vec::with_room(window_size as usize)?;
        links.resize_with(MIN_LINKS, || 0);
        Ok(Self {
            heads: try_boxed_zeroed()?,
            links,
            rolling_hash: 0,
        })
    }

    pub(super) fn clear(&mut self) {
        self.heads.fill(0);
    }

    pub(super) fn reset(&mut self) {
        self.clear();
        self.rolling_hash = 0;
    }

    /// Before positions up to `end` are inserted.
    pub(super) fn grow(&mut self, end: u32) {
        let len = (end as usize)
            .next_power_of_two()
            .min(self.links.capacity());
        if self.links.len() < len {
            self.links.resize_with(len, || 0);
        }
    }

    pub(super) fn slide(&mut self, window_size: u32) {
        for positions in [self.heads.as_mut_slice(), &mut self.links] {
            subtract_saturating(positions.as_chunks_mut().0, window_size as u16);
        }
    }

    pub(super) fn restart_rolling_hash(&mut self, window: &[u8], position: u32) {
        self.rolling_hash = roll(byte(window, position).into(), byte(window, position + 1));
    }

    /// Returns the position that was inserted last with the same hash.
    #[inline(always)]
    pub(super) fn insert<const ROLLING: bool>(&mut self, window: &[u8], position: u32) -> u32 {
        let hash = if ROLLING {
            let newest = byte(window, position + MIN_MATCH as u32 - 1);
            self.rolling_hash = roll(self.rolling_hash, newest);
            self.rolling_hash
        } else {
            chunk(window, position).copied().map_or(0, hash)
        };
        insert(&mut self.heads, &mut self.links, hash, position)
    }

    #[inline(always)]
    pub(super) fn insert_all<const ROLLING: bool>(&mut self, window: &[u8], start: u32, len: u32) {
        let (heads, links) = (&mut *self.heads, self.links.as_mut_slice());
        let (first, end) = (start as usize, start as usize + len as usize);
        if ROLLING {
            let newest = window.get(first + MIN_MATCH - 1..end + MIN_MATCH - 1);
            let mut hash = self.rolling_hash;
            for (position, &byte) in (start..).zip(newest.unwrap_or_default()) {
                hash = roll(hash, byte);
                insert(heads, links, hash, position);
            }
            self.rolling_hash = hash;
        } else {
            let hashed = window.get(first..end + HASHED_LEN as usize - 1);
            for (position, &bytes) in (start..).zip(hashed.unwrap_or_default().array_windows()) {
                insert(heads, links, hash(bytes), position);
            }
        }
    }

    /// The longest match that is longer than `best`, or that. `candidate` is within reach.
    ///
    /// It can start at or behind the position if later ones have been inserted.
    #[inline(always)]
    pub(super) fn longest_match(
        &self,
        window: &[u8],
        search: Search,
        mut candidate: u32,
        mut best: Match,
    ) -> Match {
        let Some(scan) = chunk::<SCAN_LEN>(window, search.position) else {
            return best;
        };
        let links = self.links.as_slice();
        let limit = search.position.saturating_sub(search.max_distance);
        let mut steps = search.effort.max_chain;
        if best.len >= search.effort.good_len {
            steps /= 4;
        }
        macro_rules! follow_chain {
            () => {
                steps -= 1;
                candidate = link(links, candidate);
                if steps == 0 || candidate <= limit {
                    return best;
                }
            };
        }

        let mut filter = Filter::new(scan, best.len);
        while candidate < search.position {
            let mut difference = 0;
            if best.len < WORD {
                loop {
                    let Some(first) = word(window, candidate) else {
                        return best;
                    };
                    difference = first ^ filter.first;
                    if difference & filter.mask == 0 {
                        break;
                    }
                    follow_chain!();
                }
            } else {
                while word(window, candidate + filter.last_offset) != Some(filter.last)
                    || word(window, candidate) != Some(filter.first)
                {
                    follow_chain!();
                }
            }
            let len = if difference != 0 {
                difference.trailing_zeros() / 8
            } else if let Some(bytes) = chunk(window, candidate) {
                long_match_len(scan, bytes)
            } else {
                return best;
            };
            if len > best.len {
                best = Match {
                    start: candidate,
                    len: len.min(search.lookahead),
                };
                if len >= search.lookahead.min(search.effort.nice_len) {
                    return best;
                }
                filter = Filter::new(scan, len);
            } else if search.effort.gives_up_early {
                return best;
            }
            follow_chain!();
        }
        best
    }

    #[inline(always)]
    fn rolling_head(&self, bytes: [u8; MIN_MATCH]) -> u32 {
        let hash = bytes.into_iter().fold(0, roll);
        u32::from(*self.heads.at(hash as usize))
    }

    /// For the rolling hash. Of the chains of all the positions in the best match, it follows the one that goes back
    /// the furthest.
    // https://github.com/gildor2/fast_zlib
    #[inline(always)]
    pub(super) fn longest_match_on_any_chain(
        &self,
        window: &[u8],
        search: Search,
        mut candidate: u32,
        mut best: Match,
    ) -> Match {
        let Some(scan) = chunk::<SCAN_LEN>(window, search.position) else {
            return best;
        };
        let links = self.links.as_slice();
        let base_limit = search.position.saturating_sub(search.max_distance);
        let mut steps = search.effort.max_chain;
        if best.len >= search.effort.good_len {
            steps /= 4;
        }
        // How far into the match the position is whose chain `candidate` is on.
        let mut offset = 0;
        if best.len >= MIN_MATCH as u32 {
            let mut hash = roll(scan[1].into(), scan[2]);
            let newest = scan.get(MIN_MATCH..=best.len as usize).unwrap_or_default();
            for (at, &byte) in (1..).zip(newest) {
                hash = roll(hash, byte);
                let head = u32::from(*self.heads.at(hash as usize));
                if head < candidate {
                    (offset, candidate) = (at, head);
                }
            }
            if candidate <= base_limit + offset {
                return best;
            }
        }
        let mut limit = base_limit + offset;
        macro_rules! follow_chain {
            () => {
                steps -= 1;
                candidate = link(links, candidate);
                if steps == 0 || candidate <= limit {
                    return best;
                }
            };
        }

        let mut filter = Filter::new(scan, best.len);
        while candidate < search.position {
            let mut start;
            loop {
                start = candidate - offset;
                if word(window, start + filter.last_offset)
                    .is_some_and(|last| (last ^ filter.last) & filter.mask == 0)
                    && word(window, start)
                        .is_some_and(|first| (first ^ filter.first) & filter.mask == 0)
                    && start < search.position
                {
                    break;
                }
                follow_chain!();
            }
            let Some(bytes) = chunk::<SCAN_LEN>(window, start) else {
                return best;
            };
            let difference = word(bytes, 0).unwrap_or_default() ^ filter.first;
            let len = if difference != 0 {
                difference.trailing_zeros() / 8
            } else {
                long_match_len(scan, bytes)
            };
            if len > best.len {
                best = Match {
                    start,
                    len: len.min(search.lookahead),
                };
                if len >= search.lookahead.min(search.effort.nice_len) {
                    return best;
                }
                filter = Filter::new(scan, len);
                if len > MIN_MATCH as u32 && start + len < search.position {
                    (offset, candidate) = (0, start);
                    for at in 0..=len - MIN_MATCH as u32 {
                        let previous = link(links, start + at);
                        if previous < candidate {
                            if previous <= base_limit + at {
                                return best;
                            }
                            (offset, candidate) = (at, previous);
                        }
                    }
                    let at = len - (MIN_MATCH as u32 + 1);
                    let head = self.rolling_head(chunk(scan, at).copied().unwrap_or_default());
                    if head < candidate {
                        if head <= base_limit + at {
                            return best;
                        }
                        (offset, candidate) = (at, head);
                    }
                    limit = base_limit + offset;
                    continue;
                }
            }
            follow_chain!();
        }
        best
    }
}
