//! Finds a cheap sequence of commands in one pass, at the prices that the commands so far suggest.

mod finder;
mod model;

use core::cmp::Reverse;
use core::hint::select_unpredictable;

use bun_highway::brotli::{
    MATCH_RING, Matches, all_above, least_sum, lower, push_front, replace_matches, short_code_for,
    spread_matches,
};
use bun_highway::with_avx2;

use super::cluster::{self, cost_of};
use super::command::{
    Command, Commands, DISTANCE_CODE_OFFSET, copy_length_code, insert_length_code,
};
use super::histogram::count_bytes;
use super::input_block::InputBlock;
use super::matching::{array_at, array_at_mut, match_length};
use super::prepared_dictionary::PreparedDictionary;
use super::ring_buffer::SPAN;
use super::utf8::is_mostly_utf8;
use super::words::{BATCH, Words, find_prefixes, find_words};
use crate::context::{ContextLut, ContextMode};
use crate::format::{SHORT_CODE_BASES, SHORT_CODE_DELTAS};
use crate::memory::{self, Result};
use finder::{Finder, Starts};
use model::{
    BIT, CODES, Cost, DISTANCE_SYMBOLS, FREE_BITS, LANES, Model, NO_SYMBOL, ROWS, RUNS, TABULATED,
};

const UNREACHED: Cost = 1 << 30;
/// Longer copies are taken at once.
const LONG: usize = 320;
/// After so many bytes, the path ends where no copy passes by. After twice as many, it is less choosy.
const STRETCH: usize = 704;
const SPOTS: usize = 4096;
/// How far ahead of a batch a copy can end.
const REACH: usize = 2 * LONG + 2 * SPAN + BATCH;
const MAX_STEPS: usize = 1 << FREE_BITS;
const MAX_WORDS: usize = 63;
const MAX_STEPS_FROM_ONE: usize = 256;
const STEP: Cost = MAX_STEPS as Cost - 1;
/// Between two copies with the same distance.
const MAX_GAP: u32 = 4;

/// Literals after the step whose number is in the low bits of the cost.
#[derive(Clone, Copy)]
struct Run {
    cost: Cost,
    length: u32,
}

/// A command, but for the length of its copy.
#[derive(Clone, Copy)]
#[repr(C, align(32))]
struct Step {
    /// After it.
    last_distances: [i32; 4],
    run: Run,
    copy_start: u32,
    /// The address, and in the low 5 bits the length. Zero for none.
    word: u32,
}

/// From the start of a stretch of the input to each offset.
#[derive(Copy)]
struct Paths {
    steps: [Step; MAX_STEPS],
    starts: Starts,
    matches: [Matches; BATCH],
    tried: Matches,
    /// Of the cheapest way to each offset that ends with a copy.
    costs: [Cost; SPOTS + 2 * LANES],
    literal_costs: [Cost; BATCH],
    summaries: [u32; BATCH],
    /// In bits, if it were all literals.
    batch_cost: u32,
    best: [Run; BATCH],
    words: Words,
    /// By position, with the context above them.
    literals: [u16; SPOTS],
    model: Model,
    step_count: usize,
    /// The position of offset zero.
    base: usize,
    origin: usize,
    /// The end of a copy, and of what resumes one.
    far: usize,
    furthest: usize,
    /// Its end and cost.
    long: (usize, Reverse<Cost>),
    searched: usize,
    long_ends: [usize; 4],
    /// The more steps there were lately, the larger.
    extra_margin: Cost,
    /// How many paths in a row gave way to literals. If the model does not learn from that, neither will the prefix codes.
    lessons: u32,
}

#[allow(clippy::large_unopt_stack_frames)] // Not called.
impl Clone for Paths {
    fn clone(&self) -> Self {
        *self
    }
}

pub(super) struct Optimal {
    finder: Finder,
    paths: Vec<Paths>,
    is_text: bool,
}

struct Input<'a> {
    block: InputBlock<'a>,
    end: usize,
    lut: &'static ContextLut,
    /// Nothing starts at an offset unless it is cheaper than the next ones by so much.
    margin: Cost,
    /// The length of a match that spares the search for words.
    enough: i32,
    /// After more literals than this, it takes a word or a match that replaces 16 bits to start something.
    patience: u32,
}

#[inline(always)]
fn row_and_symbol(insert_code: usize, short_code: usize) -> (usize, usize) {
    let is_implied = (short_code == 0) & (insert_code < ROWS - CODES);
    select_unpredictable(
        is_implied,
        (CODES + insert_code, NO_SYMBOL),
        (insert_code, short_code),
    )
}

/// And what the extra bits cost.
#[inline(always)]
fn symbol_for(distance: usize) -> (usize, Cost) {
    let bits = ((distance as u32 + 3) | 4).ilog2() - 1;
    (
        (12 + 2 * bits + ((distance as u32 + 3) >> bits)) as usize,
        bits as Cost * BIT,
    )
}

/// All but the middle third.
static BARRED: [Cost; 48] = {
    let (mut all, mut i) = ([0; _], 0);
    while i < 48 {
        all[i] = if i / 16 == 1 { 0 } else { i32::MAX };
        i += 1;
    }
    all
};

impl Paths {
    #[inline(always)]
    fn command_cost(&self, row: usize, length: usize) -> Cost {
        self.model.by_length[row % ROWS][length.min(TABULATED)]
    }

    /// Returns the cost of `run` with the number of the step.
    #[inline(always)]
    fn add_step(
        &mut self,
        run: Run,
        offset: usize,
        (distance, is_new): (usize, bool),
        word: usize,
    ) -> Cost {
        let index = self.step_count % MAX_STEPS;
        self.step_count += 1;
        let mut last_distances = [0; 4];
        let before = &self.steps[(run.cost & STEP) as usize].last_distances;
        push_front(before, distance as i32, is_new, &mut last_distances);
        self.steps[index] = Step {
            last_distances,
            run,
            copy_start: offset as u32,
            word: word as u32,
        };
        run.cost & !STEP | index as Cost
    }

    #[inline(always)]
    fn reach(&mut self, end: usize) {
        (self.far, self.furthest) = (self.far.max(end), self.furthest.max(end));
    }

    /// `base` has all but the cost of the symbols.
    #[inline(always)]
    fn try_copy(
        &mut self,
        input: &Input<'_>,
        base: Cost,
        [row, symbol]: [usize; 2],
        [start, end]: [usize; 2],
        distance: usize,
    ) {
        let length = end - start;
        if length >= TABULATED {
            return self.try_long_copy(input, base, [row, symbol], [start, end], distance);
        }
        let by_context = &self.model.distances[symbol % DISTANCE_SYMBOLS];
        let skipped = length.saturating_sub(2 * LANES + 1);
        lower(
            array_at_mut(&mut self.costs, (start + skipped + 2) % SPOTS),
            array_at(&self.model.by_length[row % ROWS], skipped + 2),
            array_at(&BARRED, (33 + skipped - length) % 32),
            by_context,
            base,
            (skipped as i32 - 1) >> 31,
        );
        self.reach(end);
        let same = self.same_after(input, end, distance);
        if same & same >> 1 & ((2 << MAX_GAP) - 2) != 0 {
            let cost = self.model.by_length[row % ROWS][length]
                + self.model.distances[symbol % DISTANCE_SYMBOLS][(length - 2).min(3)];
            self.resume(input, base + cost, end, distance, same);
        }
    }

    #[inline(always)]
    fn same_after(&self, input: &Input<'_>, end: usize, distance: usize) -> u32 {
        !input
            .block
            .window
            .differences(self.base.wrapping_add(end), distance)
    }

    #[inline(never)]
    fn try_long_copy(
        &mut self,
        input: &Input<'_>,
        base: Cost,
        [row, symbol]: [usize; 2],
        [start, end]: [usize; 2],
        distance: usize,
    ) {
        let (window, position) = (input.block.window, self.base.wrapping_add(start));
        let length = window.match_length(position, distance, end - start, input.end - position);
        let cost = base
            + self.model.by_code[row][copy_length_code(length)]
            + self.model.distances[symbol][3];
        if length > LONG {
            self.long = self.long.max((start + length, Reverse(cost)));
            return;
        }
        for old in &mut self.costs[end + 1 - 2 * LANES..=end] {
            *old = cost.min(*old);
        }
        self.reach(end);
        self.resume(
            input,
            cost,
            end,
            distance,
            self.same_after(input, end, distance),
        );
    }

    /// With the same distance after a few literals.
    #[inline(never)]
    fn resume(
        &mut self,
        input: &Input<'_>,
        mut cost: Cost,
        mut end: usize,
        distance: usize,
        mut same: u32,
    ) {
        with_avx2(
            #[inline(always)]
            || {
                let (window, limit) = (input.block.window, end + LONG);
                for _ in 0..4 {
                    let gap = (same & same >> 1).trailing_zeros();
                    if gap.wrapping_sub(1) >= MAX_GAP {
                        return;
                    }
                    let (start, position) = (end + gap as usize, self.base.wrapping_add(end));
                    let left = (input.end - position)
                        .min(limit - end)
                        .saturating_sub(gap as usize);
                    let mut length = ((same >> gap).trailing_ones() as usize).min(left);
                    if length + gap as usize == SPAN {
                        length =
                            window.match_length(position + gap as usize, distance, length, left);
                    }
                    if length < 2 {
                        return;
                    }
                    let bytes: [u8; MAX_GAP as usize + 2] = window.bytes_at(position - 2);
                    let (mut tagged, mut costs) = ([0; MAX_GAP as usize], [0; _]);
                    for (tagged, &[second_last, last, byte]) in
                        tagged.iter_mut().zip(bytes.array_windows())
                    {
                        *tagged =
                            u16::from_le_bytes([byte, input.lut.context(last, second_last) as u8]);
                    }
                    self.model.literal_costs(&tagged, &mut costs);
                    for (i, literal) in (0..).zip(costs) {
                        cost += if i < gap { literal } else { 0 };
                    }
                    cost += self.command_cost(CODES + gap as usize, length);
                    end = start + length;
                    let old = self.costs[end % SPOTS];
                    let is_known =
                        self.steps[(old & STEP) as usize].last_distances[0] == distance as i32;
                    if cost | STEP >= old + if is_known { 0 } else { 6 * BIT } {
                        return;
                    }
                    cost = self.add_step(Run { cost, length: gap }, start, (0, false), 0);
                    self.costs[end % SPOTS] = cost.min(old);
                    self.furthest = self.furthest.max(end);
                    same = self.same_after(input, end, distance);
                }
            },
        );
    }

    /// For the batch that has `position`.
    #[inline(never)]
    fn prepare(&mut self, input: &Input<'_>, position: usize, finder: &mut Finder) {
        with_avx2(
            #[inline(always)]
            || {
                let (window, first) = (input.block.window, position / BATCH * BATCH);
                if first + BATCH + SPAN > self.searched && self.searched < input.end {
                    self.searched =
                        finder.search(&input.block, self.searched, position, &mut self.starts);
                }
                let starts = array_at_mut(&mut self.starts, first % MATCH_RING);
                let in_block = first.wrapping_sub(input.block.position) as i32;
                let wanted = spread_matches(
                    starts,
                    &mut self.matches,
                    in_block,
                    input.enough,
                    &mut self.summaries,
                );
                let bytes = window.array_at(first);
                find_prefixes(bytes, wanted, &mut self.words);
                let literals = array_at_mut(&mut self.literals, first % SPOTS);
                let [second_last, last] = first
                    .checked_sub(2)
                    .map_or([0; 2], |before| window.bytes_at(before));
                let (mut context, [_, mut next]) = (
                    input.lut.context(last, second_last) as u8,
                    input.lut.parts(last),
                );
                for (tagged, &byte) in literals.iter_mut().zip(bytes) {
                    *tagged = u16::from_le_bytes([byte, context]);
                    let parts = input.lut.parts(byte);
                    (context, next) = (parts[0] | next, parts[1]);
                }
                self.model.literal_costs(literals, &mut self.literal_costs);
                self.batch_cost = self.literal_costs.iter().sum::<Cost>() as u32 / BIT as u32;
            },
        );
    }

    /// Returns the longest length.
    #[cold]
    #[inline(never)]
    fn try_dictionary(
        &mut self,
        input: &Input<'_>,
        dictionary: &PreparedDictionary,
        offset: usize,
        run: Run,
        mut longest: usize,
    ) -> usize {
        let query = input.block.query_at(self.base.wrapping_add(offset));
        let last_distances = self.steps[(run.cost & STEP) as usize].last_distances;
        let mut try_copy = |distance: usize, (symbol, extra_bits): (usize, Cost), length: usize| {
            let base = self.add_step(run, offset, (distance, symbol != 0), 0) + extra_bits;
            let (row, symbol) = row_and_symbol(insert_length_code(run.length as usize), symbol);
            let (by_code, by_context) = (&self.model.by_code[row], &self.model.distances[symbol]);
            let cost = |length: usize| {
                base + by_code[copy_length_code(length)] + by_context[(length - 2).min(3)]
            };
            if length > LONG {
                self.long = self.long.max((offset + length, Reverse(cost(length))));
                return;
            }
            for length in 2..=length {
                self.costs[offset + length] = self.costs[offset + length].min(cost(length));
            }
            self.reach(offset + length);
        };
        let mut tried = 1;
        for (code, (base, delta)) in SHORT_CODE_BASES
            .into_iter()
            .zip(SHORT_CODE_DELTAS)
            .enumerate()
        {
            let distance = (last_distances[usize::from(base)] + i32::from(delta)) as usize;
            let source = dictionary.at_distance(distance, query.end_distance);
            let length = match_length(source.unwrap_or_default(), query.data);
            if length > tried {
                try_copy(distance, (code, 0), length);
                tried = length;
            }
        }
        dictionary.find_all(&query, |distance, length| {
            if length > longest {
                try_copy(distance, symbol_for(distance), length);
                longest = length;
            }
        });
        longest
    }

    /// Without what it is likely to cost that there are so many literals.
    #[inline(always)]
    fn best_at(&self, offset: usize) -> Run {
        let Run { cost, length } = self.best[offset % BATCH];
        Run {
            cost: cost - self.model.runs[(length as usize).min(RUNS - 1)],
            length,
        }
    }

    #[inline(always)]
    fn try_short_codes(&mut self, input: &Input<'_>, offset: usize, mut codes: u32) {
        let (window, position) = (input.block.window, self.base.wrapping_add(offset));
        let best = self.best_at(offset);
        let last_distances = self.steps[(best.cost & STEP) as usize].last_distances;
        let insert_code = insert_length_code(best.length as usize);
        let mut tried = 1;
        while codes != 0 {
            let code = codes.trailing_zeros() as usize % 16;
            codes &= codes - 1;
            let base = last_distances[usize::from(SHORT_CODE_BASES[code]) % 4];
            let distance = (base + i32::from(SHORT_CODE_DELTAS[code])) as usize;
            if distance.wrapping_sub(1) >= input.block.max_backward(position) {
                continue;
            }
            let length =
                window.match_length(position, distance, 0, (input.end - position).min(LONG + 1));
            if length > tried {
                let base = self.add_step(best, offset, (distance, code != 0), 0);
                self.try_copy(
                    input,
                    base,
                    row_and_symbol(insert_code, code).into(),
                    [offset, offset + length],
                    distance,
                );
                tried = length;
            }
        }
    }

    /// From where it starts, or after a copy that ends a little before `offset`.
    #[inline(always)]
    fn try_match(&mut self, input: &Input<'_>, offset: usize, found: i64) {
        let end = ((found >> 39) as usize + 1 + input.block.position).wrapping_sub(self.base);
        let distance = (found >> 9).wrapping_neg() as usize % (1 << 30);
        let earliest = end
            .saturating_sub(found as usize % 512)
            .max(self.origin.max(offset - SPAN));
        let cheapest = least_sum(
            array_at(&self.costs, (offset - (LANES - 1)) % SPOTS),
            array_at(
                &self.model.after_copy,
                TABULATED.saturating_sub(end - offset),
            ),
            array_at(&BARRED, 9 + (offset - earliest).min(LANES - 1)),
        );
        let cut = offset - (LANES - 1) + cheapest as usize % LANES;
        let run = self.best_at(earliest);
        let row = insert_length_code(run.length as usize);
        let (run, row, start) = select_unpredictable(
            cheapest < run.cost + self.command_cost(row, end - earliest),
            (
                Run {
                    cost: self.costs[cut % SPOTS],
                    length: 0,
                },
                0,
                cut,
            ),
            (run, row, earliest),
        );
        let (symbol, extra_bits) = symbol_for(distance);
        let base = self.add_step(run, start, (distance, true), 0) + extra_bits;
        self.try_copy(input, base, [row, symbol], [start, end], distance);
    }

    #[inline(always)]
    fn try_words(&mut self, input: &Input<'_>, offset: usize, longest: usize) {
        let (window, position) = (input.block.window, self.base.wrapping_add(offset));
        let first_distance = input.block.max_copy_distance(position) + 1;
        let max_distance = input.block.params.distance.max_distance;
        let best = self.best_at(offset);
        let row = insert_length_code(best.length as usize);
        let mut found = [[0; 2]; MAX_WORDS + 1];
        let mut count = 0;
        find_words(
            window.array_at(position),
            &self.words,
            offset,
            #[inline(always)]
            |address, length, word_length, is_valid| {
                found[count.min(MAX_WORDS)] = [(address << 5 | word_length) as u32, length as u32];
                count += usize::from(is_valid & (length > longest));
            },
        );
        for &[word, length] in &found[..count.min(MAX_WORDS)] {
            let (distance, length, word_length) = (
                first_distance + word as usize / 32,
                length as usize,
                word as usize % 32,
            );
            if distance > max_distance || length > input.end - position {
                continue;
            }
            let (symbol, extra_bits) = symbol_for(distance);
            let cost = self.add_step(best, offset, (0, false), word as usize)
                + extra_bits
                + self.model.by_length[row % ROWS][word_length]
                + self.model.distances[symbol % DISTANCE_SYMBOLS][2 + usize::from(word_length > 4)];
            let old = &mut self.costs[(offset + length) % SPOTS];
            *old = cost.min(*old);
            self.reach(offset + length);
        }
    }

    #[inline(always)]
    fn visit(&mut self, input: &Input<'_>, offset: usize) {
        let (window, position) = (input.block.window, self.base.wrapping_add(offset));
        let last_distances =
            &self.steps[(self.best[offset % BATCH].cost & STEP) as usize].last_distances;
        let codes = window.short_codes(position, last_distances);
        let summary = self.summaries[offset % BATCH];
        let mut news =
            (summary % 256) & !replace_matches(&mut self.tried, &self.matches[offset % BATCH]);
        while news != 0 {
            let found = self.matches[offset % BATCH][news.trailing_zeros() as usize / 2 % 4];
            news &= news - 1;
            self.try_match(input, offset, found);
        }
        if codes != 0 {
            self.try_short_codes(input, offset, codes);
        }
        let mut longest = summary as usize / 256;
        if let Some(dictionary) = input.block.dictionary {
            longest = self.try_dictionary(input, dictionary, offset, self.best_at(offset), longest);
        }
        if self.words.prefixes[offset % BATCH] != 0 {
            self.try_words(input, offset, longest.max(3));
        }
    }

    #[inline(always)]
    fn is_promising(&self, input: &Input<'_>, offset: usize) -> bool {
        let at = offset % BATCH;
        self.best[at].length <= input.patience
            || (self.summaries[at] / 256 * self.batch_cost > 16 * BATCH as u32)
                | (self.words.prefixes[at] != 0)
    }

    /// Returns where it ends, and how.
    #[inline(always)]
    fn find(
        &mut self,
        input: &Input<'_>,
        start: usize,
        commands: &Commands,
        finder: &mut Finder,
    ) -> (usize, Run) {
        let mut offset = BATCH + start % BATCH;
        (self.base, self.origin, self.far, self.furthest) =
            (start.wrapping_sub(offset), offset, offset, offset);
        self.costs[..2 * BATCH + REACH].fill(UNREACHED);
        (self.step_count, self.tried, self.long) = (1, [0; 4], (0, Reverse(0)));
        self.steps[0].last_distances = commands.last_distances;
        let length = commands.pending_literals;
        let mut run = Run {
            cost: self.model.runs[length.min(RUNS - 1)],
            length: length as u32,
        };
        let stretch = (8 * self.model.commands_due).min(STRETCH);
        let mut stop = offset + stretch.min(input.end - start);
        let (mut deadline, mut pause) = (stop + stretch, stop.min(2 * BATCH));
        let (one, margin) = (self.model.runs[1], input.margin + self.extra_margin);
        loop {
            let (far, far_cost) = (self.far, self.costs[self.far % SPOTS]);
            let (mut cost, mut is_passed_by);
            macro_rules! advance {
                () => {
                    let longer =
                        run.cost + self.model.longer_runs[(run.length as usize).min(RUNS - 1)];
                    run.length = select_unpredictable(cost + one <= longer, 0, run.length) + 1;
                    run.cost = longer.min(cost + one) + self.literal_costs[offset % BATCH];
                    offset += 1;
                };
            }
            loop {
                cost = self.costs[offset % SPOTS];
                let best = select_unpredictable(cost <= run.cost, Run { cost, length: 0 }, run);
                self.best[offset % BATCH] = best;
                let limit = best.cost + margin;
                is_passed_by = !all_above(array_at(&self.costs, offset % SPOTS + 1), limit)
                    | (far_cost <= limit) & (offset < far);
                if !is_passed_by | (offset >= pause) {
                    break;
                }
                advance!();
            }
            if offset >= pause {
                if offset.is_multiple_of(BATCH) && self.base.wrapping_add(offset) < input.end {
                    self.costs[offset + REACH..][..BATCH].fill(UNREACHED);
                    self.prepare(input, self.base.wrapping_add(offset), finder);
                }
                if offset >= stop
                    && (offset >= self.furthest || (offset >= deadline && !is_passed_by))
                {
                    return (offset, self.best_at(offset));
                }
                let next_chance = if offset < stop {
                    stop
                } else {
                    self.furthest.min(deadline)
                };
                pause = next_chance.min((offset | (BATCH - 1)) + 1);
            }
            if !is_passed_by && self.is_promising(input, offset) {
                self.visit(input, offset);
                if self.long.0 != 0 {
                    self.skip(input, offset, finder);
                    return (
                        self.long.0,
                        Run {
                            cost: self.long.1.0,
                            length: 0,
                        },
                    );
                }
                if self.step_count > MAX_STEPS - MAX_STEPS_FROM_ONE {
                    (stop, deadline, pause) = (0, 0, 0);
                }
            }
            advance!();
        }
    }

    #[cold]
    #[inline(never)]
    fn skip(&mut self, input: &Input<'_>, offset: usize, finder: &mut Finder) {
        let next = self.base.wrapping_add(self.long.0);
        for passed in (self.base.wrapping_add(offset) | (BATCH - 1)) + 1
            ..self.searched.min(next / BATCH * BATCH)
        {
            let starts = core::mem::take(&mut self.starts[passed % MATCH_RING]);
            for (latest, start) in self.matches[BATCH - 1].iter_mut().zip(starts) {
                *latest = start.max(*latest);
            }
        }
        if next > self.searched {
            let [distance, ..] = self.steps[(self.long.1.0 & STEP) as usize].last_distances;
            finder.catch_up(&input.block, next, Some(distance), &mut self.starts);
            self.searched = next;
        }
        // What repeats within a repetition takes up the tables.
        for distance in self.long_ends.map(|end| next.wrapping_sub(end)) {
            if distance.wrapping_sub(1) < input.block.max_backward(next) {
                let length = input.block.window.match_length(
                    next,
                    distance,
                    0,
                    (input.end - next).min(LONG + SPAN),
                );
                let found =
                    ((next + length - input.block.position) << 39) - (distance << 9) + length;
                let [.., farthest] = &mut self.starts[next % MATCH_RING];
                *farthest = (found as i64).max(*farthest);
            }
        }
        self.long_ends.rotate_right(1);
        self.long_ends[0] = next;
        self.prepare(input, next, finder);
    }

    #[inline(always)]
    fn count_literals(&mut self, start: usize, end: usize) {
        self.model.new_literals += end - start;
        for offset in start..end {
            self.model
                .add_literal(self.literals[self.base.wrapping_add(offset) % SPOTS]);
        }
    }

    #[inline(always)]
    fn commit(
        &mut self,
        input: &Input<'_>,
        end: usize,
        last: Run,
        commands: &mut Commands,
    ) -> Result<()> {
        // Each step gets the run after it, and where that ends.
        let (mut next, mut run, mut run_end, mut count) = (0, last, end, 0);
        while run.cost & STEP != 0 {
            let step = &mut self.steps[(run.cost & STEP) as usize];
            let after = Run {
                cost: next,
                length: (run_end - run.length as usize) as u32,
            };
            (next, run_end, count) = (run.cost & STEP, step.copy_start as usize, count + 1);
            run = core::mem::replace(&mut step.run, after);
        }
        commands.try_reserve(count + 1)?;
        self.model.new_commands += count;
        let mut insert_start = self.origin;
        while next != 0 {
            let step = self.steps[(next & STEP) as usize];
            let (copy_start, copy_end) = (step.copy_start as usize, step.run.length as usize);
            self.count_literals(insert_start, copy_start);
            let mut inserted =
                copy_start - insert_start + core::mem::take(&mut commands.pending_literals);
            let (is_word, mut copied) = (step.word != 0, copy_end - copy_start);
            let position = self.base.wrapping_add(copy_start);
            if copied > LONG {
                let more = matching_before(
                    &input.block,
                    position,
                    step.last_distances[0] as usize,
                    inserted,
                );
                (inserted, copied) = (inserted - more, copied + more);
            }
            let address = input.block.max_copy_distance(position) + 1 + step.word as usize / 32;
            let (distance, coded) = select_unpredictable(
                is_word,
                (address, step.word as usize % 32),
                (step.last_distances[0] as usize, copied),
            );
            let before = commands.last_distances;
            let short = short_code_for(distance as i32, &before) as usize;
            let (code, symbol) = select_unpredictable(
                (short < 16) & !is_word,
                (short, short),
                (distance + DISTANCE_CODE_OFFSET, symbol_for(distance).0),
            );
            push_front(
                &before,
                distance as i32,
                (code != 0) & !is_word,
                &mut commands.last_distances,
            );
            let command = Command::new(&input.block.params.distance, inserted, copied, coded, code);
            self.model.add_command(&command, symbol);
            commands.list.push(command);
            commands.literal_count += inserted;
            (next, insert_start) = (step.run.cost, copy_end);
        }
        self.count_literals(insert_start, end);
        commands.pending_literals += end - insert_start;
        Ok(())
    }

    #[inline(always)]
    fn set_prices(&mut self, block: &InputBlock<'_>, position: usize) {
        let model = &mut self.model;
        if model.new_literals >= model.literals_due {
            let data = block.data_from(position);
            let ahead = if model.literals_due < 128 { 512 } else { 0 };
            model.set_literal_costs(&count_bytes(&data[..data.len().min(ahead)]));
        }
        model.set_totals();
        if model.new_commands >= model.commands_due {
            let symbol = |position| symbol_for(block.max_backward(position)).0;
            let growth = (block.end() - position) as f32 / (position + 64) as f32
                + if block.is_last { 0.0 } else { 100.0 };
            let symbols = symbol_for(block.max_copy_distance(block.end()) + (1 << 18)).0 + 1;
            model.set_command_costs(symbols, [symbol(position) - 2, symbol(block.end())], growth);
        }
    }
}

/// Up to `max` bytes. A copy of what was a long copy itself is found late.
#[cold]
fn matching_before(block: &InputBlock<'_>, position: usize, distance: usize, max: usize) -> usize {
    let is_match = |&at: &usize| {
        distance <= block.max_backward(at)
            && block.window.byte(at) == block.window.byte(at - distance)
    };
    (block.position..position)
        .rev()
        .take(max)
        .take_while(is_match)
        .count()
}

/// Whether `data` is better off without the copies that bring it down to `cost`.
fn prefers_literals(data: &[u8], cost: Cost) -> bool {
    cost & STEP != 0
        && (cost / BIT) as usize > data.len()
        && cost_of(&count_bytes(data), 50) / cluster::BIT + 8 < cost / BIT * 23 / 25
}

impl Optimal {
    pub(super) fn new() -> Result<Self> {
        const RUN: Run = Run { cost: 0, length: 0 };
        static EMPTY: Paths = Paths {
            steps: [Step {
                last_distances: [0; _],
                run: RUN,
                copy_start: 0,
                word: 0,
            }; _],
            starts: [[0; _]; _],
            matches: [[0; _]; _],
            tried: [0; _],
            costs: [0; _],
            literal_costs: [0; _],
            summaries: [0; _],
            batch_cost: 0,
            best: [RUN; _],
            words: Words::NONE,
            literals: [0; _],
            model: Model::EMPTY,
            step_count: 0,
            base: 0,
            origin: 0,
            far: 0,
            furthest: 0,
            long: (0, Reverse(0)),
            searched: 0,
            long_ends: [0; _],
            extra_margin: 0,
            lessons: 0,
        };
        Ok(Self {
            finder: Finder::new()?,
            paths: memory::copied(core::slice::from_ref(&EMPTY))?,
            is_text: true,
        })
    }

    /// For another stream. Keeps less than 700 KB.
    pub(super) fn reset(mut self) -> Self {
        let paths = &mut self.paths[0];
        paths.starts[..MATCH_RING.min(paths.searched)]
            .as_flattened_mut()
            .fill(0);
        paths.model.reset();
        (paths.long_ends, paths.extra_margin, self.is_text) = ([0; _], 0, true);
        paths.lessons = 0;
        self.finder.reset();
        self
    }

    pub(super) fn add_commands(
        &mut self,
        block: &InputBlock<'_>,
        covered: usize,
        positions_wrapped: bool,
        commands: &mut Commands,
    ) -> Result<()> {
        let (finder, paths) = (&mut self.finder, &mut self.paths[0]);
        if positions_wrapped {
            finder.restart_at(block.position);
        }
        let is_text = is_mostly_utf8([block.data_from(block.position), &[]]);
        if core::mem::replace(&mut self.is_text, is_text) != is_text {
            paths.model.forget_contexts();
        }
        paths.model.guess(is_text);
        let mut position = block.position + covered;
        finder.make_room(block, position, is_text)?;
        let is_quick = block.params.quality == 10;
        let input = &Input {
            block: *block,
            end: block.end(),
            patience: block.dictionary.map_or(12, |_| u32::MAX),
            enough: if is_quick { 8 } else { 12 },
            lut: match (block.params.disable_literal_context_modeling, is_text) {
                (true, _) => &ContextLut::ZEROS,
                (_, true) => ContextMode::Utf8.lut(),
                _ => ContextMode::Signed.lut(),
            },
            margin: if is_quick { 6 * BIT } else { BIT },
        };
        finder.catch_up(block, block.position, None, &mut paths.starts);
        finder.catch_up(
            block,
            position,
            Some(commands.last_distances[0]),
            &mut paths.starts,
        );
        (paths.searched, paths.matches[BATCH - 1]) = (position, [0; 4]);
        let mut is_first = true;
        while position < input.end {
            with_avx2(
                #[inline(always)]
                || paths.set_prices(block, position),
            );
            if core::mem::take(&mut is_first) {
                paths.prepare(input, position, finder);
            } else {
                paths.model.literal_costs(
                    array_at(&paths.literals, position / BATCH * BATCH % SPOTS),
                    &mut paths.literal_costs,
                );
            }
            let (end, mut last) = with_avx2(
                #[inline(always)]
                || paths.find(input, position, commands, finder),
            );
            paths.extra_margin += (paths.step_count * BIT as usize / (end - paths.origin)) as Cost
                - paths.extra_margin / 4;
            // What a long copy covers was not prepared.
            if paths.long.0 != 0
                || !prefers_literals(&block.data_from(position)[..end - paths.origin], last.cost)
            {
                paths.lessons = 0;
            } else if paths.lessons < 16 {
                (paths.lessons, last.cost) = (paths.lessons + 1, 0);
            }
            with_avx2(
                #[inline(always)]
                || paths.commit(input, end, last, commands),
            )?;
            position = paths.base.wrapping_add(end);
        }
        commands.try_reserve(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::command::DistancePrefix;
    use crate::format::DistanceParams;

    #[test]
    fn symbols_are_those_of_the_format() {
        let params = DistanceParams::new(0, 0, true);
        for distance in (1..3000).chain((12..31).flat_map(|bits| (1 << bits) - 5..1 << bits)) {
            let prefix = DistancePrefix::new(distance + DISTANCE_CODE_OFFSET, &params);
            let expected = (prefix.symbol(), prefix.extra_bits() as Cost * BIT);
            assert_eq!(symbol_for(distance), expected);
        }
    }
}
