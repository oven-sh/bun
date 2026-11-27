//! A hash table for matches of 8 bytes, which are preferred, and one for shorter ones.

use core::cell::Cell;
use core::convert::Infallible;

use bun_highway::{out_of_line, with_bmi2};

use bun_zstd_decoder::bounded::Bounded;

use super::hash::{Hasher, Tagged, fill_gap, insert};
use super::near::{Entries, Near};
use super::{
    Attached, CACHED_UP_TO, MatchState, Owner, Progress, Reach, SKIP_LOG, TablesMut, cells,
    prefetch,
};
use crate::bytes::{AtLeast, chunk_at, likely, u32_at, u64_at, word_in};
use crate::parameters::{TAG_BITS, Tuning};
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::window::{History, WORD_LEN};

/// Indexes the history up to its end.
pub(super) fn fill<const OWNER: Owner>(state: &mut MatchState, history: &History<'_>) {
    #[inline(always)]
    fn fill_from<const OWNER: Owner, const HAS_MANY_GAPS: bool>(
        TablesMut { hash, chain, .. }: &mut TablesMut<'_>,
        [long, short]: [Hasher; 2],
        history: History<'_>,
        position: &mut u32,
    ) -> Option<Infallible> {
        loop {
            let chunk = likely(chunk_at::<{ WORD_LEN + 2 }>(history.prefix, *position))?;
            let (index, word) = (history.index(*position), word_in::<0, _>(chunk));
            insert::<OWNER>(chain, short, word, index)?;
            insert::<OWNER>(hash, long, word, index)?;
            if OWNER == Owner::Dictionary {
                let [second, third] = [index.plus(1), index.plus(2)];
                fill_gap::<HAS_MANY_GAPS>(hash, long, word_in::<1, _>(chunk), second)?;
                fill_gap::<HAS_MANY_GAPS>(hash, long, word_in::<2, _>(chunk), third)?;
            }
            *position = position.plus(3);
        }
    }

    #[inline(always)]
    fn fill_all<const OWNER: Owner>(
        mut tables: TablesMut<'_>,
        hashers: [Hasher; 2],
        history: History<'_>,
        mut position: u32,
    ) -> Option<Infallible> {
        if OWNER == Owner::Dictionary {
            let first = history.part(0, position + tables.hash.len() as u32);
            fill_from::<OWNER, true>(&mut tables, hashers, first, &mut position);
        }
        fill_from::<OWNER, false>(&mut tables, hashers, history, &mut position)
    }

    let tuning = state.tuning;
    let short = Hasher::new(tuning.min_match, tuning.chain_log);
    let (history, position) = (*history, history.position(state.next_to_index));
    let mut tables = state.tables.split_mut();
    // Those of the default level for most dictionaries.
    if OWNER == Owner::Dictionary && (tuning.hash_log, tuning.chain_log) == (16, 15) {
        out_of_line(
            #[inline(always)]
            move || {
                tables.hash = tables.hash.get_mut(..1 << 16)?;
                tables.chain = tables.chain.get_mut(..1 << 15)?;
                let hashers = [Hasher::new(8, 16), short.with_bits(15)];
                fill_all::<OWNER>(tables, hashers, history, position)
            },
        );
    } else {
        let hashers = [Hasher::new(8, tuning.hash_log), short];
        with_bmi2(
            #[inline(always)]
            move || fill_all::<OWNER>(tables, hashers, history, position),
        );
    }
}

pub(super) fn search<const REACH: Reach>(
    state: &mut MatchState,
    history: &History<'_>,
    attached: &Attached<'_>,
    sequences: &mut Sequences,
    repeats: &mut Repeats,
) -> u32 {
    let (tuning, bounds) = (state.tuning, state.bounds());
    let tables = state.tables.split_mut();
    let mut searcher = Searcher {
        history: *history,
        long_table: cells(tables.hash),
        short_table: cells(tables.chain),
        long_hasher: Hasher::new(8, tuning.hash_log),
        short_hasher: Hasher::new(tuning.min_match, tuning.chain_log),
    };

    if REACH == Reach::Attached {
        let mut progress = Progress::new(sequences, history.start, *repeats, u32::MAX);
        let progress_mut = &mut progress;
        let logs = |tuning: Tuning| (tuning.hash_log, tuning.chain_log);
        if logs(tuning) == logs(attached.tuning) {
            with_bmi2(
                #[inline(always)]
                move || searcher.search_with_attached::<true>(attached, progress_mut),
            );
        } else {
            with_bmi2(
                #[inline(always)]
                move || searcher.search_with_attached::<false>(attached, progress_mut),
            );
        }
        return progress.finish(repeats, u32::MAX);
    }

    let lowest = bounds.lowest(history.index(history.end()));
    if REACH == Reach::Older && lowest < history.prefix_index {
        searcher.history = history.from_older(lowest);
        let mut progress = Progress::new(sequences, history.start, *repeats, u32::MAX);
        let progress_mut = &mut progress;
        searcher.run_on_long_input(
            #[inline(always)]
            move |searcher| searcher.search_with_older(progress_mut),
        );
        return progress.finish(repeats, u32::MAX);
    }

    Near::search(history, bounds, sequences, repeats, |near, progress| {
        searcher.search_prefix(near, progress)
    })
}

#[derive(Clone, Copy)]
struct Searcher<'a> {
    history: History<'a>,
    long_table: &'a [Cell<u32>],
    short_table: &'a [Cell<u32>],
    long_hasher: Hasher,
    short_hasher: Hasher,
}

impl<'a> Searcher<'a> {
    #[inline(always)]
    fn long_entry(&self, word: u64) -> Option<&'a Cell<u32>> {
        likely(self.long_table.get(self.long_hasher.hash(word)))
    }

    #[inline(always)]
    fn short_entry(&self, word: u64) -> Option<&'a Cell<u32>> {
        likely(self.short_table.get(self.short_hasher.hash(word)))
    }

    /// With such tables, the search mostly waits for memory.
    #[inline(always)]
    fn is_large(&self) -> bool {
        self.long_table.len() > CACHED_UP_TO
    }

    /// Looking gives the same result, but may have to wait for a line that is not needed otherwise.
    #[inline(always)]
    fn skips_looking_back(&self, max: u32) -> bool {
        max == 0 && self.is_large()
    }

    /// For where the search goes on, so that they are on their way while a match is stored.
    #[inline(always)]
    fn prefetch_entries(&self, at: u32) {
        if self.is_large()
            && let Some(word) = likely(u64_at(self.history.prefix, at))
        {
            prefetch(self.long_table, self.long_hasher.hash(word));
            prefetch(self.short_table, self.short_hasher.hash(word));
        }
    }

    /// Some positions of a match that was found at `searched` and ends at `end`.
    #[inline(always)]
    fn insert_match(&self, searched: u32, end: u32) -> Option<()> {
        let history = &self.history;
        let before_end = likely(chunk_at::<{ WORD_LEN + 2 }>(
            history.prefix,
            end.wrapping_sub(2),
        ))?;
        let inside = likely(u64_at(history.prefix, searched + 2))?;
        let (inside_index, end_index) = (history.index(searched + 2), history.index(end));
        self.long_entry(inside)?.set(inside_index);
        self.long_entry(word_in::<0, _>(before_end))?
            .set(end_index - 2);
        self.short_entry(inside)?.set(inside_index);
        self.short_entry(word_in::<1, _>(before_end))?
            .set(end_index - 1);
        Some(())
    }

    fn search_prefix(self, near: &Near<'a>, progress: &mut Progress<'_>) -> Option<u32> {
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
            return end;
        }
        self.run_on_long_input(
            #[inline(always)]
            move |it| it.scan_prefix::<{ Entries::Any }, true>(near, at, progress),
        )
    }

    #[inline(never)]
    fn start_prefix(self, near: &Near<'a>, progress: &mut Progress<'_>) -> Option<u32> {
        self.scan_prefix::<{ Entries::Any }, false>(near, near.history.start, progress)
    }

    fn table_logs(&self) -> (u32, u32) {
        let log = |table: &[Cell<u32>]| table.len().trailing_zeros();
        (log(self.long_table), log(self.short_table))
    }

    /// With tables whose sizes the compiler knows, hashes need no checks.
    #[inline(always)]
    fn run_sized<const LONG_LOG: u32, const SHORT_LOG: u32, R>(
        self,
        search: impl FnOnce(Self) -> Option<R>,
    ) -> Option<R> {
        out_of_line(
            #[inline(always)]
            move || {
                search(Self {
                    long_table: self.long_table.get(..1 << LONG_LOG)?,
                    short_table: self.short_table.get(..1 << SHORT_LOG)?,
                    long_hasher: Hasher::new(8, LONG_LOG),
                    short_hasher: self.short_hasher.with_bits(SHORT_LOG),
                    ..self
                })
            },
        )
    }

    /// If the sizes are those of a level.
    #[inline(always)]
    fn run_from_start<R>(self, search: impl FnOnce(Self) -> Option<R>) -> Option<Option<R>> {
        Some(match self.table_logs() {
            (11, 10) => self.run_sized::<11, 10, _>(search),
            (12, 11) => self.run_sized::<12, 11, _>(search),
            (13, 12) => self.run_sized::<13, 12, _>(search),
            (14, 13) => self.run_sized::<14, 13, _>(search),
            (14, 14) => self.run_sized::<14, 14, _>(search),
            (15, 14) => self.run_sized::<15, 14, _>(search),
            (16, 15) => self.run_sized::<16, 15, _>(search),
            (16, 16) => self.run_sized::<16, 16, _>(search),
            (17, 16) => self.run_sized::<17, 16, _>(search),
            (17, 17) => self.run_sized::<17, 17, _>(search),
            (18, 18) => self.run_sized::<18, 18, _>(search),
            _ => return None,
        })
    }

    #[inline(always)]
    fn run_on_long_input<R>(self, search: impl FnOnce(Self) -> Option<R>) -> Option<R> {
        match self.table_logs() {
            (16, 15) => self.run_sized::<16, 15, _>(search),
            (17, 16) => self.run_sized::<17, 16, _>(search),
            (18, 18) => self.run_sized::<18, 18, _>(search),
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
        const STEP_GROWS_AFTER: usize = 1 << SKIP_LOG;
        let chunks = AtLeast::<WORD_LEN>::new(near.history.prefix)?;
        self.history = near.history_of::<ENTRIES, _>(chunks);
        let history = &self.history;
        let index = |at: usize| history.index(at as u32);
        let position = |entry: &Cell<u32>| history.position(entry.get()) as usize;
        let match_len = #[inline(always)]
        |at: usize, earlier: usize, known: u32| {
            known + history.match_len(at as u32 + known, earlier as u32 + known)
        };
        let has_before =
            |at, offset, value| near.has_before::<HAS_REPEATS, _>(chunks, at, offset, value);
        let repeat_len = |at, offset| near.repeat_len::<HAS_REPEATS>(history, at, offset);
        let (mut at, mut recent) = (start as usize, progress.recent as usize);

        loop {
            let mut step = 1;
            let mut next_step = at + STEP_GROWS_AFTER;
            let mut ahead = at + step;
            let mut word = likely(chunks.word(at))?;
            let mut long_entry = self.long_entry(word)?;
            let mut long = position(long_entry);

            let end = 'stored: {
                let (found, earlier, len, ahead_entry) = loop {
                    let ahead_word = likely(chunks.word(ahead))?;
                    let short_entry = self.short_entry(word)?;
                    let short = position(short_entry);
                    long_entry.set(index(at));
                    short_entry.set(index(at));

                    if has_before(at + 1, recent, (word >> 8) as u32)? {
                        let found = at as u32 + 1;
                        let end = found + repeat_len(found, recent as u32);
                        progress.store(OffsetValue::FIRST_REPEAT, found..end);
                        break 'stored end;
                    }

                    let ahead_entry = self.long_entry(ahead_word)?;
                    if Near::matches_at::<ENTRIES, _>(history, chunks, long, |it| it == word) {
                        break (at, long, match_len(at, long, 8), ahead_entry);
                    }

                    let ahead_long = position(ahead_entry);
                    if Near::matches_at::<ENTRIES, _>(history, chunks, short, |it| {
                        it as u32 == word as u32
                    }) {
                        let len = match_len(at, short, 4);
                        if ahead_long != 0 && chunks.word(ahead_long) == Some(ahead_word) {
                            let ahead_len = match_len(ahead, ahead_long, 8);
                            if ahead_len > len {
                                break (ahead, ahead_long, ahead_len, ahead_entry);
                            }
                        }
                        break (at, short, len, ahead_entry);
                    }

                    if ahead >= next_step {
                        prefetch(chunks.bytes, ahead + 64);
                        prefetch(chunks.bytes, ahead + 128);
                        step += 1;
                        next_step += STEP_GROWS_AFTER;
                    }
                    (at, word, long_entry, long) = (ahead, ahead_word, ahead_entry, ahead_long);
                    ahead += step;
                    #[cfg(target_arch = "aarch64")]
                    prefetch(chunks.bytes, at + 256);
                };

                self.prefetch_entries(found as u32 + len);
                // Only if the search is certain to go on after it.
                if step < 4 {
                    ahead_entry.set(index(ahead));
                }
                let (found, earlier) = (found as u32, earlier as u32);
                let max = earlier.min(found - progress.anchor);
                let before = if self.skips_looking_back(max) {
                    0
                } else {
                    history.match_len_before(found, earlier, max)
                };
                let offset = found.wrapping_sub(earlier);
                progress.note_offset(offset);
                progress.store(OffsetValue::new(offset), found - before..found + len);
                recent = offset as usize;
                found + len
            };

            self.insert_match(at as u32, end)?;
            at = end as usize;
            loop {
                let word = likely(chunks.word(at))?;
                if progress.second == 0 || !has_before(at, progress.second as usize, word as u32)? {
                    break;
                }
                let len = repeat_len(at as u32, progress.second);
                progress.swap_offsets();
                recent = progress.recent as usize;
                self.short_entry(word)?.set(index(at));
                self.long_entry(word)?.set(index(at));
                progress.store(OffsetValue::FIRST_REPEAT, at as u32..at as u32 + len);
                at = progress.anchor as usize;
            }
            if !HAS_REPEATS && Near::has_repeats(progress, at as u32) {
                return Some(at as u32);
            }
        }
    }

    /// Stores a match that the search at `searched` found, and what repeats after it. Returns where to go on.
    #[inline(always)]
    fn take_match<const REACH: Reach>(
        &self,
        searched: u32,
        found: Match,
        progress: &mut Progress<'_>,
    ) -> Option<u32> {
        let history = &self.history;
        let match_end =
            #[inline(always)]
            || found.at + history.match_len_at_index(found.at, found.earlier, found.known);
        // With a dictionary, this order is slower.
        let early_end = (REACH == Reach::Older).then(match_end);
        if let Some(end) = early_end {
            self.prefetch_entries(end);
        }
        let (offset, before) = if found.repeats {
            (OffsetValue::FIRST_REPEAT, 0)
        } else {
            progress.note_offset(history.index(found.at).wrapping_sub(found.earlier));
            let max = found.at - progress.anchor;
            let before = if REACH == Reach::Older && self.skips_looking_back(max) {
                0
            } else {
                history.match_len_before_index(found.at, found.earlier, max)
            };
            (OffsetValue::new(progress.recent), before)
        };
        let end = early_end.unwrap_or_else(match_end);
        progress.store(offset, found.at - before..end);

        self.insert_match(searched, end)?;
        let mut at = end;
        loop {
            let word = likely(u64_at(history.prefix, at))?;
            let current = history.index(at);
            let earlier = current.wrapping_sub(progress.second);
            if history.u32_at_index(earlier) != Some(word as u32) || progress.second == 0 {
                return Some(at);
            }
            let end = at + history.match_len_at_index(at, earlier, 4);
            progress.swap_offsets();
            self.short_entry(word)?.set(current);
            self.long_entry(word)?.set(current);
            progress.store(OffsetValue::FIRST_REPEAT, at..end);
            at = end;
        }
    }

    #[inline(always)]
    fn search_with_older(mut self, progress: &mut Progress<'_>) -> Option<Infallible> {
        self.history = self.history.with_prefix_of::<WORD_LEN>()?;
        let history = &self.history;
        let (lowest, mut at) = (history.older_index(), history.start);
        loop {
            let [word, next_word] = adjacent_words(history.prefix, at)?;
            let (short_entry, long_entry) = (self.short_entry(word)?, self.long_entry(word)?);
            let current = history.index(at);
            let (short, long) = (short_entry.replace(current), long_entry.replace(current));
            let back = at.plus(1).wrapping_sub(progress.recent);

            let found = if history.has_at(back, (word >> 8) as u32) && progress.recent != 0 {
                Match::repeat(at + 1, history.index(back))
            } else if history.u64_at_index(long) == Some(word) && long != lowest {
                Match::new(at, long, 8)
            } else if history.u32_at_index(short) == Some(word as u32) && short != lowest {
                let long = self.long_entry(next_word)?.replace(current + 1);
                if history.u64_at_index(long) == Some(next_word) && long != lowest {
                    Match::new(at + 1, long, 8)
                } else {
                    Match::new(at, short, 4)
                }
            } else {
                at = at.plus((at.minus(progress.anchor) >> SKIP_LOG) + 1);
                continue;
            };
            at = self.take_match::<{ Reach::Older }>(at, found, progress)?;
        }
    }

    /// If those tables have the `SAME_SIZES` as its own, they share the hashes and their checks.
    #[inline(always)]
    fn search_with_attached<const SAME_SIZES: bool>(
        mut self,
        attached: &Attached<'_>,
        progress: &mut Progress<'_>,
    ) -> Option<Infallible> {
        let words = AtLeast::<WORD_LEN>::new(self.history.prefix)?;
        self.history.prefix = words.bytes;
        let (history, mut attached) = (&self.history, *attached);
        if SAME_SIZES {
            attached.hash = attached.hash.get(..self.long_table.len())?;
            attached.chain = attached.chain.get(..self.short_table.len())?;
        }
        let tuning = attached.tuning;
        let long_hasher = self.long_hasher.with_bits(tuning.hash_log + TAG_BITS);
        let short_hasher = self.short_hasher.with_bits(tuning.chain_log + TAG_BITS);
        let look_up_long = |word| Tagged::look_up(attached.hash, long_hasher.hash(word));
        let entry = |table: &'a [Cell<u32>], own: Hasher, with_tag: Hasher, word| {
            likely(table.get(if SAME_SIZES {
                with_tag.hash(word) >> TAG_BITS
            } else {
                own.hash(word)
            }))
        };
        let find_long = #[inline(always)]
        |candidate: u32, tagged: Tagged, word: u64| {
            let position = history.position(candidate) as usize;
            if words.matches_at::<true>(position, |it| it == word) {
                return Some(candidate);
            }
            let index = tagged.index()?;
            (u64_at(history.older, Attached::position(index)) == Some(word))
                .then(|| index.wrapping_add(attached.delta))
        };
        let find_short = #[inline(always)]
        |candidate: u32, tagged: Tagged, word: u64| {
            let position = history.position(candidate) as usize;
            if words.matches_at::<true>(position, |it| it as u32 == word as u32) && position != 0 {
                return Some(candidate);
            }
            let index = tagged.index()?;
            (candidate <= history.prefix_index
                && u32_at(history.older, Attached::position(index)) == Some(word as u32))
            .then(|| index.wrapping_add(attached.delta))
        };

        let mut at = history.start;
        loop {
            let [word, next_word] = adjacent_words(history.prefix, at)?;
            let short_entry = entry(self.short_table, self.short_hasher, short_hasher, word)?;
            let long_entry = entry(self.long_table, self.long_hasher, long_hasher, word)?;
            let attached_long = look_up_long(word)?;
            let attached_short = Tagged::look_up(attached.chain, short_hasher.hash(word))?;
            let current = history.index(at);
            let (short, long) = (short_entry.replace(current), long_entry.replace(current));
            let back = at.plus(1).wrapping_sub(progress.recent);

            let found = if history.has_at(back, next_word as u32) && progress.recent != 0 {
                Match::repeat(at + 1, history.index(back))
            } else if let Some(long) = find_long(long, attached_long, word) {
                Match::new(at, long, 8)
            } else if let Some(short) = find_short(short, attached_short, word) {
                let long = self.long_entry(next_word)?.replace(current + 1);
                match find_long(long, look_up_long(next_word)?, next_word) {
                    Some(long) => Match::new(at + 1, long, 8),
                    None => Match::new(at, short, 4),
                }
            } else {
                at = at.plus((at.minus(progress.anchor) >> SKIP_LOG) + 1);
                #[cfg(target_arch = "aarch64")]
                prefetch(history.prefix, at as usize + 256);
                continue;
            };
            at = self.take_match::<{ Reach::Attached }>(at, found, progress)?;
        }
    }
}

#[inline(always)]
fn adjacent_words(bytes: &[u8], at: u32) -> Option<[u64; 2]> {
    let chunk = likely(chunk_at::<{ WORD_LEN + 1 }>(bytes, at))?;
    Some([word_in::<0, _>(chunk), word_in::<1, _>(chunk)])
}

#[derive(Clone, Copy)]
struct Match {
    at: u32,
    earlier: u32,
    /// How many bytes were compared.
    known: u32,
    repeats: bool,
}

impl Match {
    #[inline(always)]
    fn new(at: u32, earlier: u32, known: u32) -> Self {
        Self {
            at,
            earlier,
            known,
            repeats: false,
        }
    }

    #[inline(always)]
    fn repeat(at: u32, earlier: u32) -> Self {
        Self {
            repeats: true,
            ..Self::new(at, earlier, 4)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parameters::Strategy;
    use crate::window::FIRST_INDEX;

    /// The tables of a dictionary take three positions at a time, and the gaps between them go in the long one.
    #[test]
    fn a_dictionary_is_found_at_every_position_of_it() -> crate::Result<()> {
        let dictionary: Vec<u8> = (0..300u32).map(|it| (it * it / 5 + it / 3) as u8).collect();
        let tuning = Tuning {
            window_log: 20,
            chain_log: 14,
            hash_log: 16,
            search_log: 1,
            min_match: 4,
            target_length: 0,
            strategy: Strategy::DoubleFast,
        };
        let mut state = MatchState::new(tuning);
        state.reset(tuning, false, Owner::Dictionary, dictionary.len())?;
        let history = History {
            prefix: &dictionary,
            prefix_index: FIRST_INDEX,
            older: &[],
            start: 0,
        };
        fill::<{ Owner::Dictionary }>(&mut state, &history);
        let tables = state.tables.split_mut();

        let wide = Hasher::new(8, tuning.hash_log + TAG_BITS);
        let words = dictionary.array_windows().map(|it| u64::from_le_bytes(*it));
        let hashes: Vec<_> = words.map(|it| wide.hash(it)).collect();
        let mut checked = 0;
        for (at, &hash) in (0..).zip(&hashes).take(hashes.len() - 2).skip(1) {
            // Two positions in one slot keep only one of themselves.
            let in_slot = hashes.iter().filter(|it| (**it ^ hash) >> TAG_BITS == 0);
            if in_slot.count() == 1 {
                let found = Tagged::look_up(tables.hash, hash).and_then(Tagged::index);
                assert_eq!(found, Some(history.index(at)), "position {at}");
                checked += 1;
            }
        }
        assert!(checked > 250, "{checked}");
        Ok(())
    }
}
