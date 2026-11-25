//! All but the two fastest strategies weigh the matches against each other that tables for several lengths come up with.

use bun_highway::zstd_ladder::{self as kernel, Counts, Ladder, Parser, Work};
use bun_zstd_decoder::Result;
use bun_zstd_decoder::array::{At, allocate};
use bun_zstd_decoder::format::CodeKind::{LiteralLength, MatchLength, Offset};
use bun_zstd_decoder::format::{BLOCK_LEN_MAX, MAX_LITERAL_LENGTH_CODE, MAX_MATCH_LENGTH_CODE};

use super::Search;
use crate::bytes::{highest_bit, u64_at};
use crate::entropy::{Entropy, histogram};
use crate::parameters::{Strategy, Tuning};
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::vec;
use crate::window::History;

/// How many bytes are hashed, and how few positions. See [`Ladder::reset`].
type Rung = (u8, u8);

const SHORTEST: Rung = (3, 0);
const SHORTEST_LOG_MAX: u32 = 16;
/// Smaller tables would not make a difference next to the [`Work`].
const LOG_MIN: u32 = 14;
const HINTS_MAX: usize = 1024;

/// What is above the first rung for the optimal parsers, by the log of the search from 1 on.
#[rustfmt::skip]
static ABOVE_FIXED: &[&[Rung]] = &[
    &[(16, 2)],
    &[(8, 1)],
    &[(8, 1), (16, 2)],
    &[(6, 1), (9, 1), (16, 2)],
    &[(7, 0), (12, 1), (24, 2)],
    &[(8, 0), (11, 1), (16, 1), (32, 2)],
    &[(7, 0), (11, 0), (16, 1), (32, 2)],
    &[(7, 0), (11, 0), (16, 1), (22, 1), (32, 2), (48, 2), (64, 3), (96, 3)],
    &[(6, 0), (8, 0), (11, 0), (15, 1), (20, 1), (28, 2), (40, 2), (60, 2), (96, 3)],
];

/// For the others, which make the first rung longer as they see fit.
#[rustfmt::skip]
static ABOVE_VARYING: &[&[Rung]] = &[
    &[(40, 5)],
    &[(16, 4), (40, 5)],
    &[(16, 3), (40, 5)],
    &[(16, 3), (48, 4), (40, 5)],
    &[(10, 1), (24, 4), (40, 5)],
    &[(10, 1), (20, 2), (48, 4)],
    &[(9, 0), (14, 1), (24, 2), (48, 3)],
    &[(9, 0), (13, 1), (20, 1), (32, 2), (64, 3)],
];

/// Unless it is the shortest one.
#[rustfmt::skip]
static ABOVE_SHORTEST: &[&[Rung]] = &[
    &[],
    &[(6, 0)],
    &[(5, 0), (9, 1)],
    &[(5, 0), (8, 1), (16, 2)],
    &[(5, 0), (8, 0), (16, 1)],
    &[(4, 0), (6, 0), (10, 1), (20, 2)],
];

/// How often the first codes for literal lengths, match lengths and offsets tend to occur in binary data, and in text.
#[rustfmt::skip]
static USUAL_CODES: [[[u8; 14]; 3]; 2] = [
    [
        [64, 64, 24, 20, 16, 12, 10, 10,  6,  6,  4,  4,  1,  1],
        [64, 40, 32, 24, 16, 16, 12, 12,  8,  8,  8,  8,  1,  1],
        [48, 20,  8, 12, 28, 36, 44, 44, 32, 24, 16, 16, 16, 16],
    ],
    [
        [32, 16,  8,  8,  6,  5,  4,  4,  1,  1,  1,  1,  1,  1],
        [ 8, 16, 16, 12,  8,  8,  6,  6,  4,  4,  4,  4,  1,  1],
        [24,  8,  2,  2,  4,  8, 12, 16, 16, 16, 12,  8,  8,  8],
    ],
];

fn parser(strategy: Strategy, reach_log: u32) -> Parser {
    match (strategy, reach_log) {
        (Strategy::Greedy, _) => Parser::Linked,
        (Strategy::Lazy | Strategy::Lazy2, _) => Parser::LinkedWithRepeats,
        (Strategy::TreeLazy2, _) | (Strategy::Optimal, 12) | (_, ..=11) => Parser::LinkedExactly,
        (Strategy::Optimal, _) | (_, 12) => Parser::OptimalOfOne,
        (Strategy::Ultra, _) | (_, 13..=14) => Parser::OptimalOfTwo,
        _ => Parser::OptimalOfThree,
    }
}

/// If what is being compressed repeats its first few bytes, how many. That takes less time to find than to get ready for a search.
fn period(history: &History<'_>) -> Option<u32> {
    let head = history
        .prefix
        .first_chunk::<128>()
        .filter(|_| history.start == 0 && history.older.is_empty())?;
    let first = u64_at(head, 0);
    let period = (1..64).find(|&at| u64_at(head, at) == first)?;
    (period + history.match_len(period, 0) == history.end()).then_some(period)
}

pub(super) struct State {
    ladder: Ladder,
    rungs: [Rung; 16],
    rung_count: usize,
    parser: Parser,
    reach_log: u32,
    work: Work,
    counts: Counts,
    has_counts: bool,
    has_searched: bool,
    /// What the tables have room for.
    seen_log: u32,
    hints: Vec<[u32; 3]>,
    /// Added to an index of the window, makes it one of the tables, which does not depend on earlier frames.
    pub(super) bias: u32,
    /// How many bytes the tables have got.
    seen: usize,
}

impl State {
    pub(super) fn new() -> Result<Box<Self>> {
        allocate(|| Self {
            ladder: Ladder::default(),
            rungs: [SHORTEST; _],
            rung_count: 0,
            parser: Parser::Linked,
            reach_log: 1,
            work: Work::default(),
            counts: Counts {
                literals: [0; _],
                literal_lens: [0; _],
                match_lens: [0; _],
                offsets: [0; _],
            },
            has_counts: false,
            has_searched: false,
            seen_log: 0,
            hints: Vec::new(),
            bias: 0,
            seen: 0,
        })
    }

    /// `first_index` is that of the first byte.
    pub(super) fn reset(&mut self, tuning: &Tuning, reach_log: u32, first_index: u32) {
        (self.parser, self.reach_log) = (parser(tuning.strategy, reach_log), reach_log);
        let is_optimal = self.parser >= Parser::OptimalOfOne;
        let has_shortest = is_optimal && tuning.min_match == 3;
        let first = tuning.min_match.min(6) as u8 + u8::from(has_shortest);
        let above = match first {
            _ if is_optimal => ABOVE_FIXED,
            3 => ABOVE_SHORTEST,
            _ => ABOVE_VARYING,
        };
        let effort = tuning.search_log.min((tuning.window_log - 9).max(2));
        let above = above.iter().take(effort as usize).next_back();
        let above = above.into_iter().copied().flatten().copied();
        let all = core::iter::once((first, 0))
            .chain(above.filter(|&(len, _)| len > first))
            .chain(has_shortest.then_some(SHORTEST));
        self.rung_count = self
            .rungs
            .iter_mut()
            .zip(all)
            .map(|(to, it)| *to = it)
            .count();
        let room = if effort < 9 { 4 } else { 6 };
        let rungs = self.rungs.get(..self.rung_count).unwrap_or_default();
        self.ladder.reset(rungs, reach_log, room, 1);
        self.bias = 1u32.wrapping_sub(first_index);
        (self.has_counts, self.has_searched) = (false, false);
        (self.seen, self.seen_log) = (0, 0);
    }

    pub(super) fn copy_from(&mut self, dictionary: &Self) -> Result<()> {
        (self.bias, self.seen) = (dictionary.bias, dictionary.seen);
        (self.rungs, self.rung_count) = (dictionary.rungs, dictionary.rung_count);
        self.parser = dictionary.parser;
        Ok(self.ladder.copy_from(&dictionary.ladder)?)
    }

    /// Of the size of a table for when there are `1 << seen_log` bytes to refer to.
    fn log_of(rung: Rung, number: usize, tuning: &Tuning, seen_log: u32) -> u32 {
        match rung {
            _ if number == 0 => seen_log.min(tuning.hash_log.max(LOG_MIN)),
            SHORTEST => seen_log.min(SHORTEST_LOG_MAX),
            (_, spacing) => {
                (seen_log.min(tuning.chain_log.max(LOG_MIN))).saturating_sub(spacing.into())
            }
        }
    }

    fn final_len(&self, tuning: &Tuning) -> usize {
        let rungs = self.rungs.iter().take(self.rung_count).enumerate();
        let logs = rungs.map(|(number, &it)| Self::log_of(it, number, tuning, tuning.window_log));
        logs.map(|log| 1 << log).sum()
    }

    /// How many bytes the tables take, and how many of them are needed.
    pub(super) fn tables_len(&self, tuning: &Tuning) -> [usize; 2] {
        [self.ladder.capacity(), self.final_len(tuning)].map(|len| len * size_of::<u32>())
    }

    /// Makes room for `len` more bytes.
    pub(super) fn reserve(&mut self, tuning: &Tuning, len: usize) -> Result<()> {
        self.work.make_room()?;
        self.seen = self.seen.saturating_add(len);
        let mut seen_log = (self.seen.max(2) - 1).ilog2().min(self.reach_log - 1) + 1;
        if self.seen >= BLOCK_LEN_MAX {
            seen_log = seen_log.max(tuning.window_log);
        }
        if seen_log == self.seen_log {
            return Ok(());
        }
        let rungs = self.rungs;
        let log_of = |number| Self::log_of(*rungs.at(number), number, tuning, seen_log);
        self.ladder.make_room(log_of)?;
        self.seen_log = seen_log;
        Ok(())
    }

    pub(super) fn reserve_hints(&mut self) -> Result<()> {
        vec::clear_for(&mut self.hints, HINTS_MAX)
    }

    /// Only searches need it.
    pub(super) fn drop_work(&mut self) {
        self.work = Work::default();
    }

    pub(super) fn fill(&mut self, history: &History<'_>, is_abandoned: impl Fn() -> bool) {
        let index = history.prefix_index.wrapping_add(self.bias);
        let starts = (history.start as usize..history.prefix.len()).step_by(BLOCK_LEN_MAX);
        for start in starts.take_while(|_| !is_abandoned()) {
            let part = start..start + BLOCK_LEN_MAX;
            (self.ladder).fill(history.prefix, part, index, &mut self.work);
        }
    }

    fn guess_counts(&mut self, block: &[u8], dictionary: Option<&Entropy>) {
        self.has_counts = true;
        let counts = &mut self.counts;
        let codes = [
            counts.literal_lens.get_mut(..=MAX_LITERAL_LENGTH_CODE),
            counts.match_lens.get_mut(..=MAX_MATCH_LENGTH_CODE),
            counts.offsets.get_mut(..),
        ];
        let codes = codes.into_iter().flatten();
        if let Some(entropy) = dictionary
            && let Some(table) = entropy.literals.complete()
        {
            counts.literals = core::array::from_fn(|it| 1 << 13 >> table.code_len(it));
            for (counts, kind) in codes.zip([LiteralLength, MatchLength, Offset]) {
                for (code, count) in counts.iter_mut().enumerate() {
                    *count = (1u32 << 12).unbounded_shr(entropy.codes.max_bits(kind, code));
                }
            }
            return;
        }
        let sample = block.get(..2048).unwrap_or(block);
        let mut bytes = [0; _];
        histogram::add(&mut bytes, sample);
        let (len, shift) = (
            sample.len() as u32,
            highest_bit(sample.len() as u32 >> 7 | 1),
        );
        let kinds = bytes.iter().filter(|&&it| it != 0).count().clamp(2, 24) as u32;
        // Matches are going to take most of what is common.
        let most = 2 * len / kinds + 1;
        counts.literals = bytes.map(|it| (it.min(most) * 6 + (1 << shift) - 1) >> shift);
        let controls = (bytes.iter().take(9)).chain(bytes.iter().take(32).skip(14));
        let is_text = controls.sum::<u32>() <= len / 32 || kinds < 8;
        for (counts, usual) in codes.zip(USUAL_CODES.at(usize::from(is_text))) {
            counts.fill(1);
            (counts.iter_mut().zip(usual)).for_each(|(count, &it)| *count = it.into());
        }
    }

    pub(super) fn search(
        &mut self,
        tuning: &Tuning,
        max_distance: u32,
        search: &Search<'_>,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> u32 {
        let history = &search.history;
        let brief_below = match self.parser {
            _ if search.attached.is_some() => 12,
            Parser::Linked => 128,
            Parser::LinkedWithRepeats => 64,
            _ => 12,
        };
        let is_brief = history.block().len() < brief_below;
        // Only the tables of a dictionary will do, so it cannot wait.
        let has_tables = !core::mem::replace(&mut self.has_searched, true)
            && search.entropy.literals.complete().is_some();
        let period = period(history);
        if has_tables || !(self.has_counts || is_brief || period.is_some()) {
            self.guess_counts(history.block(), has_tables.then_some(search.entropy));
        }
        if let Some(period) = period {
            let (offset, len) = (OffsetValue::new(period), history.end() - history.start);
            sequences.push(period, offset, len - period);
            *repeats = repeats.after(offset, true);
            return history.end();
        }
        self.hints.clear();
        for hint in search.long_matches.iter().flat_map(|it| it.within(history)) {
            _ = self.hints.push_within_capacity(hint);
        }
        let attached = search.attached.and_then(|dictionary| {
            let state = dictionary.ladder.as_deref()?;
            Some((
                &state.ladder,
                dictionary.window.next.wrapping_add(state.bias),
            ))
        });
        let search = kernel::Search {
            prefix: history.prefix,
            start: history.start as usize,
            index: history.prefix_index.wrapping_add(self.bias),
            older: history.older,
            attached,
            hints: &self.hints,
            max_distance,
            nice_len: 4 * tuning.target_length,
            caution: tuning.target_length / 32,
            patience: match tuning.strategy {
                Strategy::TreeLazy2 => 16 << 10,
                _ => 1 << 10,
            },
            parser: if is_brief { Parser::Brief } else { self.parser },
        };
        let (work, counts) = (&mut self.work, &mut self.counts);
        (self.ladder).search(&search, work, counts, &mut repeats.0, &mut sequences.list) as u32
    }
}
