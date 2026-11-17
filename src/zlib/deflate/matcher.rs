//! The search for the longest match.

use bun_deflate::format::MIN_MATCH_LEN;

use super::chains::{HASHED_LEN, Index, roll};
use super::window::{Scan, chunk, match_len, word};

const WORD: u32 = 8;

#[derive(Clone, Copy)]
pub(super) struct Match {
    pub(super) start: u32,
    pub(super) len: u32,
}

impl Match {
    /// One byte short of what counts as a match.
    pub(super) const NONE: Self = Self {
        start: 0,
        len: MIN_MATCH_LEN as u32 - 1,
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

impl Effort {
    #[inline(always)]
    fn steps(&self, best_len: u32) -> u32 {
        if best_len >= self.good_len {
            self.max_chain / 4
        } else {
            self.max_chain
        }
    }
}

/// Where a match is wanted.
#[derive(Clone, Copy)]
pub(super) struct Target<'a> {
    pub(super) position: u32,
    /// No match is longer.
    pub(super) lookahead: u32,
    pub(super) scan: &'a Scan,
}

impl Target<'_> {
    #[inline(always)]
    pub(super) fn hashed(&self) -> [u8; HASHED_LEN as usize] {
        chunk(self.scan, 0).copied().unwrap_or_default()
    }

    #[inline(always)]
    pub(super) fn first_word(&self) -> u64 {
        word(self.scan, 0).unwrap_or_default()
    }
}

/// What a candidate has to have to be longer than the best match so far.
struct Filter<'a> {
    /// The word that ends one byte behind the best match, or the first.
    last: u64,
    /// The window, and the same from where `last` is for position 0. Both are as long.
    firsts: &'a [u8],
    lasts: &'a [u8],
}

impl<'a> Filter<'a> {
    #[inline(always)]
    fn new(window: &'a [u8], scan: &Scan, best_len: u32) -> Self {
        let offset = (best_len + 1).saturating_sub(WORD) % 256;
        let lasts = window.get(offset as usize..).unwrap_or_default();
        Self {
            last: word(scan, offset).unwrap_or_default(),
            firsts: window.get(..lasts.len()).unwrap_or_default(),
            lasts,
        }
    }
}

/// The bytes of a word that count for a match to be longer than `best_len`.
#[inline(always)]
fn mask_for(best_len: u32) -> u64 {
    u64::MAX >> (8 * WORD.saturating_sub(best_len + 1))
}

pub(super) struct Matcher<'a> {
    pub(super) index: Index<'a>,
    pub(super) max_distance: u32,
    pub(super) effort: Effort,
}

macro_rules! follow_chain_or_return {
    ($links:ident, $candidate:ident, $steps:ident, $limit:ident, $best:ident) => {
        $steps -= 1;
        $candidate = $links.follow($candidate);
        if $steps == 0 || $candidate <= $limit {
            return $best;
        }
    };
}

impl<'a> Matcher<'a> {
    #[inline(always)]
    pub(super) fn target(&self, position: u32, lookahead: u32) -> Option<Target<'a>> {
        let scan = chunk(self.index.window, position);
        debug_assert!(scan.is_some());
        Some(Target {
            position,
            lookahead,
            scan: scan?,
        })
    }

    #[inline(always)]
    fn reaches(&self, position: u32, candidate: u32) -> bool {
        let distance = position.wrapping_sub(candidate);
        distance.wrapping_sub(1) < self.max_distance.min(position.wrapping_sub(1))
    }

    /// Inserts the position, and looks for a match from scratch.
    #[inline(always)]
    pub(super) fn insert_and_match<const ROLLING: bool>(&mut self, target: Target<'_>) -> Match {
        self.insert_and_beat::<ROLLING>(target, Match::NONE, false)
    }

    /// The same for one that is longer than `best`. Out of line, or too few registers are left for the other.
    #[inline(never)]
    pub(super) fn insert_and_improve<const ROLLING: bool>(
        &mut self,
        position: u32,
        lookahead: u32,
        best: Match,
        is_good_enough: bool,
    ) -> Match {
        match self.target(position, lookahead) {
            Some(target) => self.insert_and_beat::<ROLLING>(target, best, is_good_enough),
            None => best,
        }
    }

    #[inline(always)]
    fn insert_and_beat<const ROLLING: bool>(
        &mut self,
        target: Target<'_>,
        best: Match,
        is_good_enough: bool,
    ) -> Match {
        if target.lookahead < HASHED_LEN {
            return best;
        }
        let candidate = self
            .index
            .insert::<ROLLING>(target.position, target.hashed());
        if !self.reaches(target.position, candidate) || is_good_enough {
            return best;
        }
        self.longest_match::<ROLLING>(target, candidate, best)
    }

    /// The longest match that is longer than `best`, or that. `candidate` is within reach.
    #[inline(always)]
    fn longest_match<const ROLLING: bool>(
        &self,
        target: Target<'_>,
        candidate: u32,
        best: Match,
    ) -> Match {
        let found = if ROLLING {
            self.search_rolling(target, candidate, best)
        } else {
            self.search(target, candidate, best)
        };
        // Looking ahead inserts positions before their time.
        if found.start < target.position {
            found
        } else {
            Match::NONE
        }
    }

    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/match_tpl.h#L29
    #[inline(always)]
    fn search(&self, target: Target<'_>, mut candidate: u32, mut best: Match) -> Match {
        let mut steps = self.effort.steps(best.len);
        let enough = target.lookahead.min(self.effort.nice_len);
        if best.len >= WORD {
            return self.search_long(target.position, target.lookahead, candidate, best, steps);
        }
        let Some(links) = self.index.links() else {
            return best;
        };
        let limit = target.position.saturating_sub(self.max_distance);
        let (first, mut mask) = (target.first_word(), mask_for(best.len));
        while candidate < target.position {
            loop {
                let Some(other) = word(self.index.window, candidate) else {
                    return best;
                };
                if (other ^ first) & mask == 0 {
                    break;
                }
                follow_chain_or_return!(links, candidate, steps, limit, best);
            }
            let Some(bytes) = chunk(self.index.window, candidate) else {
                return best;
            };
            let len = match_len(target.scan, bytes);
            best = Match {
                start: candidate,
                len: len.min(target.lookahead),
            };
            if len >= enough {
                return best;
            }
            follow_chain_or_return!(links, candidate, steps, limit, best);
            if len >= WORD {
                return self.search_long(target.position, target.lookahead, candidate, best, steps);
            }
            mask = mask_for(len);
        }
        best
    }

    /// For a `best` of at least a word. Out of line, so that its loop has all registers to itself.
    #[inline(never)]
    fn search_long(
        &self,
        position: u32,
        lookahead: u32,
        mut candidate: u32,
        mut best: Match,
        mut steps: u32,
    ) -> Match {
        let (Some(target), Some(links)) = (self.target(position, lookahead), self.index.links())
        else {
            return best;
        };
        let limit = position.saturating_sub(self.max_distance);
        while candidate < position {
            let filter = Filter::new(self.index.window, target.scan, best.len);
            loop {
                let Some(last) = word(filter.lasts, candidate) else {
                    return best;
                };
                if last == filter.last
                    && word(filter.firsts, candidate) == Some(target.first_word())
                {
                    break;
                }
                follow_chain_or_return!(links, candidate, steps, limit, best);
            }
            let Some(bytes) = chunk(self.index.window, candidate) else {
                return best;
            };
            let len = match_len(target.scan, bytes);
            if len > best.len {
                best = Match {
                    start: candidate,
                    len: len.min(lookahead),
                };
                if len >= lookahead.min(self.effort.nice_len) {
                    return best;
                }
            } else if self.effort.gives_up_early {
                return best;
            }
            follow_chain_or_return!(links, candidate, steps, limit, best);
        }
        best
    }

    /// Spares a call if no candidate starts like the target.
    #[inline(always)]
    fn search_rolling(&self, target: Target<'_>, mut candidate: u32, best: Match) -> Match {
        let mut steps = self.effort.steps(best.len);
        if best.len < MIN_MATCH_LEN as u32
            && let Some(links) = self.index.links()
        {
            let limit = target.position.saturating_sub(self.max_distance);
            let (first, mask) = (target.first_word(), mask_for(best.len));
            while word(self.index.window, candidate)
                .is_some_and(|it| (it ^ first) & mask != 0 || candidate >= target.position)
            {
                follow_chain_or_return!(links, candidate, steps, limit, best);
            }
        }
        self.search_any_chain(target.position, target.lookahead, candidate, best, steps)
    }

    /// Follows the chain of that position in the best match that goes back the furthest. For the rolling hash.
    #[inline(never)]
    fn search_any_chain(
        &self,
        position: u32,
        lookahead: u32,
        mut candidate: u32,
        mut best: Match,
        mut steps: u32,
    ) -> Match {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/match_tpl.h#L84
        let (Some(target), Some(links)) = (self.target(position, lookahead), self.index.links())
        else {
            return best;
        };
        let (window, scan) = (self.index.window, target.scan);
        let base_limit = position.saturating_sub(self.max_distance);
        // How far into the match the position is whose chain `candidate` is on.
        let mut offset = 0;
        if best.len >= MIN_MATCH_LEN as u32 {
            let mut hash = roll(scan[1].into(), scan[2]);
            let newest = scan
                .get(MIN_MATCH_LEN..=best.len as usize)
                .unwrap_or_default();
            for (at, &byte) in (1..).zip(newest) {
                hash = roll(hash, byte);
                let head = self.index.head(hash);
                if head < candidate {
                    (offset, candidate) = (at, head);
                }
            }
            if candidate <= base_limit + offset {
                return best;
            }
        }
        let mut limit = base_limit + offset;

        let first = target.first_word();
        while candidate < position {
            let (filter, mask) = (Filter::new(window, scan, best.len), mask_for(best.len));
            let start = loop {
                let start = candidate - offset;
                let Some(last) = word(filter.lasts, start) else {
                    return best;
                };
                if (last ^ filter.last) & mask == 0
                    && word(filter.firsts, start).is_some_and(|it| (it ^ first) & mask == 0)
                    && start < position
                {
                    break start;
                }
                follow_chain_or_return!(links, candidate, steps, limit, best);
            };
            let Some(bytes) = chunk(window, start) else {
                return best;
            };
            let len = match_len(scan, bytes);
            if len > best.len {
                best = Match {
                    start,
                    len: len.min(lookahead),
                };
                if len >= lookahead.min(self.effort.nice_len) {
                    return best;
                }
                if len > MIN_MATCH_LEN as u32 && start + len < position {
                    (offset, candidate) = (0, start);
                    for at in 0..=len - MIN_MATCH_LEN as u32 {
                        let previous = links.follow(start + at);
                        if previous < candidate {
                            if previous <= base_limit + at {
                                return best;
                            }
                            (offset, candidate) = (at, previous);
                        }
                    }
                    let at = len - (MIN_MATCH_LEN as u32 + 1);
                    let bytes: [u8; MIN_MATCH_LEN] = chunk(scan, at).copied().unwrap_or_default();
                    let head = self.index.head(bytes.into_iter().fold(0, roll));
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
            follow_chain_or_return!(links, candidate, steps, limit, best);
        }
        best
    }
}
