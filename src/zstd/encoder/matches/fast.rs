//! One hash table, and the first match that comes up.

use core::cell::Cell;
use core::convert::Infallible;

use bun_highway::{out_of_line, with_bmi2};

use super::hash::{Hasher, Tagged, fill_gap, insert};
use super::near::{Entries, Near};
use super::{Attached, MatchState, Owner, Progress, Reach, SKIP_LOG, cells, prefetch};
use crate::bytes::{AtLeast, chunk_at, likely, u32_at, u64_at, word_in};
use crate::parameters::TAG_BITS;
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::window::{History, WORD_LEN};

/// Indexes the history up to its end.
pub(super) fn fill<const OWNER: Owner>(state: &mut MatchState, history: &History<'_>) {
    #[inline(always)]
    fn fill_from<const OWNER: Owner, const HAS_MANY_GAPS: bool>(
        table: &mut [u32],
        hasher: Hasher,
        history: History<'_>,
        position: &mut u32,
    ) -> Option<Infallible> {
        loop {
            let chunk = likely(chunk_at::<{ WORD_LEN + 2 }>(history.prefix, *position))?;
            let index = history.index(*position);
            insert::<OWNER>(table, hasher, word_in::<0, _>(chunk), index)?;
            if OWNER == Owner::Dictionary {
                fill_gap::<HAS_MANY_GAPS>(table, hasher, word_in::<1, _>(chunk), index + 1)?;
                fill_gap::<HAS_MANY_GAPS>(table, hasher, word_in::<2, _>(chunk), index + 2)?;
            }
            *position += 3;
        }
    }

    let hasher = Hasher::new(state.tuning.min_match, state.tuning.hash_log);
    let (history, mut position) = (*history, history.position(state.next_to_index));
    let table = state.tables.split_mut().hash;
    with_bmi2(
        #[inline(always)]
        move || {
            if OWNER == Owner::Dictionary {
                let first = history.part(0, position + table.len() as u32);
                fill_from::<OWNER, true>(table, hasher, first, &mut position);
            }
            fill_from::<OWNER, false>(table, hasher, history, &mut position)
        },
    );
}

pub(super) fn search<const REACH: Reach>(
    state: &mut MatchState,
    history: &History<'_>,
    attached: &Attached<'_>,
    sequences: &mut Sequences,
    repeats: &mut Repeats,
) -> u32 {
    let (tuning, bounds) = (state.tuning, state.bounds());
    let mut searcher = Searcher {
        history: *history,
        table: cells(state.tables.split_mut().hash),
        hasher: Hasher::new(tuning.min_match, tuning.hash_log),
        step: tuning.target_length.max(1),
    };

    if REACH == Reach::Attached {
        let mut progress = Progress::new(sequences, history.start, *repeats, u32::MAX);
        let progress_mut = &mut progress;
        with_bmi2(
            #[inline(always)]
            move || searcher.search_with_attached(attached, progress_mut),
        );
        return progress.finish(repeats, u32::MAX);
    }

    let lowest = bounds.lowest(history.index(history.end()));
    if REACH == Reach::Older && lowest < history.prefix_index {
        searcher.history = history.from_older(lowest);
        let max_offset = history.index(history.start) - lowest - 1;
        let mut progress = Progress::new(sequences, history.start, *repeats, max_offset);
        let progress_mut = &mut progress;
        searcher.run_on_long_input(
            #[inline(always)]
            move |searcher| searcher.search_with_older(progress_mut),
        );
        return progress.finish(repeats, max_offset);
    }

    Near::search(history, bounds, sequences, repeats, |near, progress| {
        searcher.search_prefix(near, progress, tuning.window_log)
    })
}

/// Two adjacent positions, each with a word to hash, and the margin that the search keeps.
const PAIR_LEN: usize = WORD_LEN + 2;

#[derive(Clone, Copy)]
struct Searcher<'a> {
    history: History<'a>,
    table: &'a [Cell<u32>],
    hasher: Hasher,
    step: u32,
}

impl<'a> Searcher<'a> {
    #[inline(always)]
    fn entry(&self, word: u64) -> Option<&'a Cell<u32>> {
        likely(self.table.get(self.hasher.hash(word)))
    }

    #[inline(always)]
    fn insert(&self, position: u32) -> Option<()> {
        self.entry(likely(u64_at(self.history.prefix, position))?)?
            .set(self.history.index(position));
        Some(())
    }

    fn search_prefix(
        self,
        near: &Near<'a>,
        progress: &mut Progress<'_>,
        window_log: u32,
    ) -> Option<u32> {
        let mut at = near.history.start;
        if !Near::has_repeats(progress, at) {
            at = self.start_prefix(near, progress)?;
        }
        if near.history.prefix_index == 0
            && let Some(end) = self.run_from_start(
                #[inline(always)]
                |it| it.scan_prefix::<{ Entries::Positions }, true>(near, at, progress),
            )
        {
            end
        } else if near.history.prefix_index != 0 && window_log >= 19 {
            self.run_on_long_input(
                #[inline(always)]
                move |it| it.scan_prefix::<{ Entries::MostlyNear }, true>(near, at, progress),
            )
        } else {
            with_bmi2(
                #[inline(always)]
                move || self.scan_prefix::<{ Entries::Any }, true>(near, at, progress),
            )
        }
    }

    #[inline(never)]
    fn start_prefix(self, near: &Near<'a>, progress: &mut Progress<'_>) -> Option<u32> {
        self.scan_prefix::<{ Entries::Any }, false>(near, near.history.start, progress)
    }

    fn table_log(&self) -> u32 {
        self.table.len().trailing_zeros()
    }

    /// With a table whose size the compiler knows, hashes need no checks.
    #[inline(always)]
    fn run_sized<const LOG: u32, R>(self, search: impl FnOnce(Self) -> Option<R>) -> Option<R> {
        out_of_line(
            #[inline(always)]
            move || {
                search(Self {
                    table: self.table.get(..1 << LOG)?,
                    hasher: self.hasher.with_bits(LOG),
                    ..self
                })
            },
        )
    }

    /// If the size is that of a level.
    #[inline(always)]
    fn run_from_start<R>(self, search: impl FnOnce(Self) -> Option<R>) -> Option<Option<R>> {
        Some(match self.table_log() {
            11 => self.run_sized::<11, _>(search),
            12 => self.run_sized::<12, _>(search),
            13 => self.run_sized::<13, _>(search),
            14 => self.run_sized::<14, _>(search),
            15 => self.run_sized::<15, _>(search),
            16 => self.run_sized::<16, _>(search),
            _ => return None,
        })
    }

    #[inline(always)]
    fn run_on_long_input<R>(self, search: impl FnOnce(Self) -> Option<R>) -> Option<R> {
        match self.table_log() {
            13 => self.run_sized::<13, _>(search),
            14 => self.run_sized::<14, _>(search),
            16 => self.run_sized::<16, _>(search),
            _ => with_bmi2(
                #[inline(always)]
                move || search(self),
            ),
        }
    }

    /// Unless it [`HAS_REPEATS`](Near::has_repeats) from the start, it returns where it does.
    #[inline(always)]
    fn scan_prefix<const ENTRIES: Entries, const HAS_REPEATS: bool>(
        mut self,
        near: &Near<'a>,
        start: u32,
        progress: &mut Progress<'_>,
    ) -> Option<u32> {
        const STEP_GROWS_AFTER: usize = 1 << (SKIP_LOG - 1);
        let chunks = AtLeast::<PAIR_LEN>::new(near.history.prefix)?;
        self.history = near.history_of::<ENTRIES, _>(chunks);
        let history = &self.history;
        let index = |at: usize| history.index(at as u32);
        let position = |entry: &Cell<u32>| history.position(entry.get()) as usize;
        let has_at = |at, value| {
            Near::matches_at::<ENTRIES, _>(history, chunks, at, |it| it as u32 == value)
        };
        let has_before =
            |at, offset, value| near.has_before::<HAS_REPEATS, _>(chunks, at, offset, value);
        let (mut at, mut recent) = (start as usize, progress.recent as usize);

        loop {
            let mut step = self.step as usize + 1;
            let mut next_step = at + STEP_GROWS_AFTER;
            let mut ahead = at + step;
            let pair = likely(chunks.chunk(at))?;
            let mut word = word_in::<0, _>(pair);
            let mut entry = self.entry(word)?;
            let mut next_entry = self.entry(word_in::<1, _>(pair))?;
            let mut candidate = position(entry);

            let (searched, repeats) = loop {
                let ahead_pair = likely(chunks.chunk(ahead))?;
                let ahead_word = word_in::<0, _>(ahead_pair);
                let repeats = has_before(ahead, recent, ahead_word as u32)?;

                entry.set(index(at));
                if repeats {
                    next_entry.set(index(at + 1));
                    break (at, true);
                }
                if has_at(candidate, word as u32) {
                    next_entry.set(index(at + 1));
                    break (at, false);
                }

                candidate = position(next_entry);
                entry = self.entry(ahead_word)?;
                next_entry.set(index(at + 1));
                if has_at(candidate, (word >> 8) as u32) {
                    // Only if the search is certain to go on after it.
                    if step <= 4 {
                        entry.set(index(ahead));
                    }
                    break (at + 1, false);
                }

                candidate = position(entry);
                next_entry = self.entry(word_in::<1, _>(ahead_pair))?;
                (at, word) = (ahead, ahead_word);
                ahead += step;
                if ahead >= next_step {
                    step += 1;
                    prefetch(chunks.bytes, at + 1 + 64);
                    prefetch(chunks.bytes, at + 1 + 128);
                    next_step += STEP_GROWS_AFTER;
                }
            };

            if repeats {
                let (found, offset) = (ahead as u32, recent as u32);
                let (all, at) = near.for_repeats::<HAS_REPEATS>(history, found);
                let before = all.match_len_before(at, at.wrapping_sub(offset), 1);
                let end = found + near.repeat_len::<HAS_REPEATS>(history, found, offset);
                progress.store(OffsetValue::FIRST_REPEAT, found - before..end);
            } else {
                let (found, earlier) = (searched as u32, candidate as u32);
                let max = earlier.min(found - progress.anchor);
                let before = history.match_len_before(found, earlier, max);
                let end = found + 4 + history.match_len(found + 4, earlier + 4);
                let offset = found.wrapping_sub(earlier);
                progress.note_offset(offset);
                progress.store(OffsetValue::new(offset), found - before..end);
                recent = offset as usize;
            }

            at = progress.anchor as usize;
            let mut word = likely(chunks.word(at))?;
            for inside in [searched + 2, at - 2] {
                self.entry(likely(chunks.word(inside))?)?.set(index(inside));
            }
            while progress.second != 0 && has_before(at, progress.second as usize, word as u32)? {
                let len = near.repeat_len::<HAS_REPEATS>(history, at as u32, progress.second);
                progress.swap_offsets();
                self.entry(word)?.set(index(at));
                progress.store(OffsetValue::FIRST_REPEAT, at as u32..at as u32 + len);
                (at, recent) = (progress.anchor as usize, progress.recent as usize);
                word = likely(chunks.word(at))?;
            }
            if !HAS_REPEATS && Near::has_repeats(progress, at as u32) {
                return Some(at as u32);
            }
        }
    }

    /// Indexes some of the match that was found at `searched`, and stores what repeats after it. Returns where to go on.
    #[inline(always)]
    fn follow_up(&self, searched: u32, end: u32, progress: &mut Progress<'_>) -> Option<u32> {
        let (history, mut at) = (&self.history, end);
        let mut word = likely(u64_at(history.prefix, at))?;
        self.insert(searched + 2)?;
        self.insert(at - 2)?;
        loop {
            let earlier = history.index(at).wrapping_sub(progress.second);
            if history.u32_at_index(earlier) != Some(word as u32) || progress.second == 0 {
                return Some(at);
            }
            let end = at + history.match_len_at_index(at, earlier, 4);
            progress.swap_offsets();
            self.entry(word)?.set(history.index(at));
            progress.store(OffsetValue::FIRST_REPEAT, at..end);
            at = end;
            word = likely(u64_at(history.prefix, at))?;
        }
    }

    #[inline(always)]
    fn search_with_older(mut self, progress: &mut Progress<'_>) -> Option<Infallible> {
        const STEP_GROWS_AFTER: usize = 1 << (SKIP_LOG - 1);
        let chunks = AtLeast::<PAIR_LEN>::new(self.history.prefix)?;
        self.history.prefix = chunks.bytes;
        let history = &self.history;
        let index = |at: usize| history.index(at as u32);
        let has_at_index = |index, value| history.u32_at_index(index) == Some(value);
        let mut at = history.start as usize;

        loop {
            let recent = progress.recent;
            let mut step = self.step as usize + 1;
            let mut next_step = at + STEP_GROWS_AFTER;
            let mut ahead = at + step;
            let pair = likely(chunks.chunk(at))?;
            let mut word = word_in::<0, _>(pair);
            let mut entry = self.entry(word)?;
            let mut next_entry = self.entry(word_in::<1, _>(pair))?;
            let mut candidate = entry.get();

            // Also the position that is hashed but not yet in the table.
            let (searched, repeats, pending, pending_entry) = loop {
                let ahead_pair = likely(chunks.chunk(ahead))?;
                let ahead_word = word_in::<0, _>(ahead_pair);
                let back = (ahead as u32).wrapping_sub(recent);

                entry.set(index(at));
                if history.has_at(back, ahead_word as u32) && recent != 0 && back != 0 {
                    break (at, true, at + 1, next_entry);
                }
                if has_at_index(candidate, word as u32) {
                    break (at, false, at + 1, next_entry);
                }

                candidate = next_entry.get();
                entry = self.entry(ahead_word)?;
                next_entry.set(index(at + 1));
                if has_at_index(candidate, (word >> 8) as u32) {
                    break (at + 1, false, ahead, entry);
                }

                candidate = entry.get();
                next_entry = self.entry(word_in::<1, _>(ahead_pair))?;
                (at, word) = (ahead, ahead_word);
                ahead += step;
                if ahead >= next_step {
                    step += 1;
                    prefetch(chunks.bytes, at + 1 + 64);
                    prefetch(chunks.bytes, at + 1 + 128);
                    next_step += STEP_GROWS_AFTER;
                }
            };

            let (found, earlier, offset, max_before);
            if repeats {
                found = ahead as u32;
                earlier = history.index(found.wrapping_sub(recent));
                (offset, max_before) = (OffsetValue::FIRST_REPEAT, 1);
            } else {
                (found, earlier) = (searched as u32, candidate);
                progress.note_offset(index(searched).wrapping_sub(candidate));
                offset = OffsetValue::new(progress.recent);
                max_before = found - progress.anchor;
            }
            let before = history.match_len_before_index(found, earlier, max_before);
            let end = found + history.match_len_at_index(found, earlier, 4);
            progress.store(offset, found - before..end);

            if pending < end as usize {
                pending_entry.set(index(pending));
            }
            at = self.follow_up(searched as u32, end, progress)? as usize;
        }
    }

    #[inline(always)]
    fn search_with_attached(
        mut self,
        attached: &Attached<'_>,
        progress: &mut Progress<'_>,
    ) -> Option<Infallible> {
        const STEP_GROWS_AFTER: u32 = 1 << SKIP_LOG;
        let words = AtLeast::<WORD_LEN>::new(self.history.prefix)?;
        self.history.prefix = words.bytes;
        let (history, bytes) = (&self.history, words.bytes);
        let attached_hasher = self.hasher.with_bits(attached.tuning.hash_log + TAG_BITS);
        let mut at = history.start;

        loop {
            let recent = progress.recent;
            let mut step = self.step;
            let mut next_step = at + STEP_GROWS_AFTER;
            let mut ahead = at + step;
            let mut ahead_word = likely(u64_at(bytes, ahead))?;
            let mut word = likely(u64_at(bytes, at))?;
            let mut entry = self.entry(word)?;
            let mut attached_candidate =
                Tagged::look_up(attached.hash, attached_hasher.hash(word))?;
            let mut candidate = entry.get();

            let (found, earlier, repeats) = loop {
                let current = history.index(at);
                let back = (at + 1).wrapping_sub(recent);
                let ahead_entry = self.entry(ahead_word)?;
                let ahead_hash = attached_hasher.hash(ahead_word);
                entry.set(current);

                if history.has_at(back, (word >> 8) as u32) {
                    break (at + 1, history.index(back), true);
                }
                if let Some(index) = attached_candidate.index()
                    && u32_at(history.older, Attached::position(index)) == Some(word as u32)
                    && candidate <= history.prefix_index
                {
                    break (at, index.wrapping_add(attached.delta), false);
                }
                if words.matches_at::<true>(history.position(candidate) as usize, |it| {
                    it as u32 == word as u32
                }) {
                    break (at, candidate, false);
                }

                attached_candidate = Tagged::look_up(attached.hash, ahead_hash)?;
                candidate = ahead_entry.get();
                if ahead >= next_step {
                    step += 1;
                    next_step += STEP_GROWS_AFTER;
                }
                (at, word, entry) = (ahead, ahead_word, ahead_entry);
                ahead += step;
                ahead_word = likely(u64_at(bytes, ahead))?;
            };

            let (offset, before) = if repeats {
                (OffsetValue::FIRST_REPEAT, 0)
            } else {
                progress.note_offset(history.index(found).wrapping_sub(earlier));
                let max = found - progress.anchor;
                let before = history.match_len_before_index(found, earlier, max);
                (OffsetValue::new(progress.recent), before)
            };
            let end = found + history.match_len_at_index(found, earlier, 4);
            progress.store(offset, found - before..end);
            at = self.follow_up(at, end, progress)?;
        }
    }
}
