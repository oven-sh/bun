//! Takes a match only if none of the next positions has a better one.

use core::convert::Infallible;

use bun_highway::with_bmi2;

use super::chain::Chains;
use super::lazy_tree::LazyTree;
use super::rows::Rows;
use super::{Attached, Bounds, MatchState, Progress, Reach, SKIP_LOG};
use crate::bytes::{likely, u32_at};
use crate::parameters::Strategy;
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::window::{History, WORD_LEN};

const MIN_LEN: u32 = 4;

#[derive(Clone, Copy)]
pub(super) struct Match {
    pub(super) len: u32,
    pub(super) offset: OffsetValue,
}

impl Match {
    /// What to beat. The offset is about as costly as any.
    pub(super) const NONE: Self = Self {
        len: MIN_LEN - 1,
        offset: OffsetValue(999_999_999),
    };

    #[inline(always)]
    fn gain(self, per_byte: u32) -> i32 {
        (self.len * per_byte) as i32 - self.offset.code() as i32
    }
}

/// The longest of the matches for a position.
pub(super) struct Longest {
    at: u32,
    pub(super) best: Match,
    /// A longer match has these bytes, the last of which follows the best one.
    tail: u32,
}

impl Longest {
    #[inline(always)]
    pub(super) fn new(at: u32, word: u64) -> Self {
        Self {
            at,
            best: Match::NONE,
            tail: word as u32,
        }
    }

    #[inline(always)]
    fn note(&mut self, history: &History<'_>, len: u32, offset: u32) -> Option<()> {
        if len > self.best.len {
            let offset = OffsetValue::new(offset);
            self.best = Match { len, offset };
            self.tail = likely(u32_at(history.prefix, self.at + len - 3))?;
        }
        Some(())
    }

    /// `None` if the best match reaches the end, so that none can be longer.
    #[inline(always)]
    pub(super) fn consider_position(&mut self, history: &History<'_>, earlier: u32) -> Option<()> {
        let tail = likely(u32_at(
            history.prefix,
            earlier.wrapping_add(self.best.len - 3),
        ));
        if tail != Some(self.tail) {
            return Some(());
        }
        let len = history.match_len(self.at, earlier);
        self.note(history, len, self.at.wrapping_sub(earlier))
    }

    /// [`consider_position`](Self::consider_position) for one in the older run.
    #[inline(always)]
    pub(super) fn consider_older(&mut self, history: &History<'_>, earlier: u32) -> Option<()> {
        let tail = likely(u32_at(
            history.older,
            earlier.wrapping_add(self.best.len - 3),
        ));
        if tail.is_some_and(|tail| tail != self.tail) {
            return Some(());
        }
        let len = history.older_match_len(self.at, earlier);
        let offset = (self.at + history.older.len() as u32).wrapping_sub(earlier);
        self.note(history, len, offset)
    }

    #[inline(always)]
    pub(super) fn consider<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        index: u32,
    ) -> Option<()> {
        if REACH != Reach::Older || index >= history.prefix_index {
            self.consider_position(history, history.position(index))
        } else {
            self.consider_older(history, history.older_position(index))
        }
    }
}

pub(super) trait Finder {
    /// How far from the end the search stops.
    const MARGIN: u32;
    const GAINS_FROM_BMI2: bool = true;

    /// Arrays would keep the compiler from holding the other fields in registers.
    type Scratch: Default;

    /// Where the search is compiled.
    #[inline(always)]
    fn prepare(&mut self) -> Option<()> {
        Some(())
    }

    /// Indexes the positions up to `at`, unless `is_skipping`.
    fn catch_up(
        &mut self,
        history: &History<'_>,
        scratch: &mut Self::Scratch,
        at: u32,
        is_skipping: bool,
    ) -> Option<()>;

    /// Also indexes `at`. `None` ends the search.
    fn find<const REACH: Reach>(
        &mut self,
        history: &History<'_>,
        scratch: &mut Self::Scratch,
        at: u32,
        is_skipping: bool,
    ) -> Option<Match>;

    /// At the start, and after skipping.
    fn resume(&mut self, _history: &History<'_>, _scratch: &mut Self::Scratch) {}

    /// Returns from which index on the tables are not up to date.
    fn finish(self, history: &History<'_>) -> u32;
}

pub(super) fn search<const REACH: Reach>(
    state: &mut MatchState,
    history: &History<'_>,
    attached: &Attached<'_>,
    sequences: &mut Sequences,
    repeats: &mut Repeats,
) -> u32 {
    let bounds = state.bounds();
    let is_first = REACH != Reach::Attached && history.start == 0;
    let start = history.start + u32::from(is_first);
    let max_offset = match REACH {
        Reach::Prefix => history.index(start) - bounds.lowest_in_prefix(history.index(start)),
        _ => u32::MAX,
    };
    let parser = Parser {
        history: *history,
        bounds,
        start,
        depth: (state.tuning.strategy as u32 - Strategy::Greedy as u32).min(2),
    };
    let mut progress = Progress::new(sequences, history.start, *repeats, max_offset);

    let next_to_index = if state.tuning.strategy == Strategy::TreeLazy2 {
        let finder = LazyTree::new(state, attached);
        parser.run::<REACH, _>(finder, &mut progress)
    } else if !state.uses_rows {
        let finder = Chains::new(state, attached);
        parser.run::<REACH, _>(finder, &mut progress)
    } else {
        match state.tuning.row_log() {
            4 => parser.run::<REACH, _>(Rows::<16>::new(state, attached), &mut progress),
            5 => parser.run::<REACH, _>(Rows::<32>::new(state, attached), &mut progress),
            _ => parser.run::<REACH, _>(Rows::<64>::new(state, attached), &mut progress),
        }
    };
    state.next_to_index = next_to_index;
    progress.finish(repeats, max_offset)
}

struct Parser<'a> {
    history: History<'a>,
    bounds: Bounds,
    start: u32,
    /// How many positions in a row have to have nothing better.
    depth: u32,
}

impl Parser<'_> {
    /// Returns from which index on the tables are not up to date.
    #[inline(never)]
    fn run<const REACH: Reach, F: Finder>(self, finder: F, progress: &mut Progress<'_>) -> u32 {
        let run = #[inline(always)]
        move || {
            let (mut finder, history) = (finder, self.history);
            self.parse::<REACH, _>(&mut finder, progress);
            finder.finish(&history)
        };
        if F::GAINS_FROM_BMI2 {
            with_bmi2(run)
        } else {
            run()
        }
    }

    /// The length of the match that `offset` gives at `at`, if there is one.
    #[inline(always)]
    fn repeat_len<const REACH: Reach>(&self, at: u32, offset: u32) -> Option<u32> {
        let history = &self.history;
        let value = likely(u32_at(history.prefix, at))?;
        if REACH == Reach::Prefix {
            let earlier = at.wrapping_sub(offset);
            return (earlier < at && u32_at(history.prefix, earlier) == Some(value))
                .then(|| 4 + history.match_len(at + 4, earlier + 4));
        }
        let current = history.index(at);
        let earlier = current.wrapping_sub(offset);
        let repeats = match REACH {
            Reach::Older => {
                offset.wrapping_sub(1) < current - self.bounds.lowest(current)
                    && history.has_at(at.wrapping_sub(offset), value)
            }
            _ => history.u32_at_index(earlier) == Some(value) && offset != 0,
        };
        repeats.then(|| history.match_len_at_index(at, earlier, 4))
    }

    #[inline(always)]
    fn parse<const REACH: Reach, F: Finder>(
        mut self,
        finder: &mut F,
        progress: &mut Progress<'_>,
    ) -> Option<Infallible> {
        const SKIPS_INDEXING_FROM: u32 = 8;
        self.history = self.history.with_prefix_of::<WORD_LEN>()?;
        let history = &self.history;
        let limit = history.end().checked_sub(F::MARGIN)?;
        let mut at = self.start;
        let mut is_skipping = false;
        let mut scratch = F::Scratch::default();
        finder.prepare()?;
        finder.resume(history, &mut scratch);

        'block: while at < limit {
            let mut start = at + 1;
            let repeat_len = self.repeat_len::<REACH>(start, progress.recent);
            let mut best = Match {
                len: repeat_len.unwrap_or(0),
                offset: OffsetValue::FIRST_REPEAT,
            };

            let mut end = start + best.len;

            if self.depth > 0 || repeat_len.is_none() {
                finder.catch_up(history, &mut scratch, at, is_skipping)?;
                let found = finder.find::<REACH>(history, &mut scratch, at, is_skipping)?;
                if found.len > best.len {
                    (best, start) = (found, at);
                }
                if best.len < MIN_LEN {
                    let skipped = (at - progress.anchor) >> SKIP_LOG;
                    at += skipped + 1;
                    is_skipping = skipped + u32::from(REACH != Reach::Older) > SKIPS_INDEXING_FROM;
                    continue 'block;
                }

                // How many positions had nothing better.
                let mut misses = 0;
                while misses < self.depth && at < limit {
                    at += 1;
                    if let Some(len) = self.repeat_len::<REACH>(at, progress.recent)
                        && (len * (3 + misses)) as i32 > best.gain(3 + misses) + 1
                    {
                        let offset = OffsetValue::FIRST_REPEAT;
                        (best, start) = (Match { len, offset }, at);
                    }
                    let found = finder.find::<REACH>(history, &mut scratch, at, is_skipping)?;
                    if found.len >= MIN_LEN && found.gain(4) > best.gain(4) + 4 + 3 * misses as i32
                    {
                        (best, start, misses) = (found, at, 0);
                    } else {
                        misses += 1;
                    }
                }

                end = start + best.len;
                if let Some(offset) = best.offset.offset() {
                    let max = start - progress.anchor;
                    let before = if REACH == Reach::Prefix {
                        history.match_len_before(start, start.wrapping_sub(offset), max)
                    } else {
                        let earlier = history.index(start).wrapping_sub(offset);
                        history.match_len_before_index(start, earlier, max)
                    };
                    start -= before;
                    progress.note_offset(offset);
                }
            }

            progress.store(best.offset, start..end);
            at = progress.anchor;
            if is_skipping {
                finder.resume(history, &mut scratch);
                is_skipping = false;
            }

            while at <= limit
                && let Some(len) = self.repeat_len::<REACH>(at, progress.second)
            {
                progress.swap_offsets();
                progress.store(OffsetValue::FIRST_REPEAT, at..at + len);
                at = progress.anchor;
            }
        }
        None
    }
}
