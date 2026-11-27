//! Chooses between literals and matches by the cheapest path through a whole block, for levels 10 to 12.

use crate::binary_trees::{self, BinaryTrees};
use crate::block::{Frequencies, Lens, STATIC_LENS, Sequence, Stream};
use crate::block_splitter::{
    MIN_BLOCK_LEN, OBSERVATIONS_PER_CHECK, Observations, SOFT_MAX_BLOCK_LEN, literal_kind,
    match_kind, max_block_end, may_split, should_split,
};
use crate::format::{
    MAX_MATCH_LEN, MIN_MATCH_LEN, OFFSET_SYMBOLS, length_slot, length_slot_of, offset_slot,
    offset_slot_of,
};
use crate::match_cache::{MAX_MATCHES, MIN_LONG_LEN, Match, MatchCache, NO_SLOT, SHORT_LENS};
use crate::parser::{Effort, initial_min_match_len, min_match_len};
use crate::window::{Bytes, Window};
use crate::{Result, chunk_at, grow, wrapped, wrapped_mut};
use core::array::from_fn;
use core::ops::Range;

/// Costs are in fractions of a bit.
const BIT_COST: u32 = 16;
/// A block ends when this many entries are cached.
const MAX_CACHED: usize = 5 * SOFT_MAX_BLOCK_LEN;
const _: () = assert!(MAX_CACHED + MAX_MATCH_LEN <= MAX_MATCHES);

struct Settings {
    effort: Effort,
    max_passes: u32,
    /// In bits, what makes another pass, or going back to the one before, worth it.
    min_gain: u32,
    /// The longest block that gets a pass for the static code.
    max_static_len: usize,
}

#[derive(Default)]
pub(crate) struct Storage {
    trees: binary_trees::Storage,
    cache: MatchCache,
    choices: Vec<Choice>,
}

/// The length of a match, or 0 for a literal.
type Choice = u16;

#[derive(Clone, Copy, PartialEq)]
struct Costs {
    literal: [u32; 256],
    /// For each length less [`MIN_MATCH_LEN`].
    length: [u32; 256],
    offset_slot: [u32; OFFSET_SYMBOLS],
}

static EXTRA_LENGTH_COSTS: [u32; 256] =
    table!(|index| BIT_COST * length_slot(length_slot_of(index + MIN_MATCH_LEN)).extra_bits);
static EXTRA_OFFSET_COSTS: [u32; OFFSET_SYMBOLS] =
    table!(|symbol| BIT_COST * offset_slot(symbol).extra_bits);

impl Costs {
    /// Adds the extra bits to the costs of the symbols.
    #[inline(always)]
    fn new(
        literal: impl Fn(u8) -> u32,
        length: impl Fn(usize) -> u32,
        offset: impl Fn(usize) -> u32,
    ) -> Self {
        Self {
            literal: from_fn(|byte| literal(byte as u8)),
            length: from_fn(|index| {
                length(index + MIN_MATCH_LEN) + wrapped(&EXTRA_LENGTH_COSTS, index)
            }),
            offset_slot: from_fn(|slot| offset(slot) + wrapped(&EXTRA_OFFSET_COSTS, slot)),
        }
    }

    fn from_lens(lens: &Lens) -> Self {
        let cost =
            |len: u8, if_unused: u8| BIT_COST * u32::from(if len == 0 { if_unused } else { len });
        Self::new(
            |literal| cost(lens.of_literal(literal), 13),
            |len| cost(lens.of_length(len), 13),
            |slot| cost(*wrapped(&lens.offset, slot), 10),
        )
    }

    /// Moves these `eighths` of the way to `other`.
    fn approach(&mut self, other: &Self, eighths: u32) {
        let approach = |costs: &mut [u32], others: &[u32]| {
            for (cost, other) in costs.iter_mut().zip(others) {
                *cost = (eighths * other + (8 - eighths) * *cost) / 8;
            }
        };
        approach(&mut self.literal, &other.literal);
        approach(&mut self.length, &other.length);
        approach(&mut self.offset_slot, &other.offset_slot);
    }
}

/// The cost of a literal, rounded down, if `used` of them share a probability of `quarters / 4`.
const fn literal_cost(used: usize, quarters: u128) -> u8 {
    let divisor = quarters.pow(BIT_COST);
    (match used {
        ..2 => ((1 << (2 * BIT_COST)) / divisor).ilog2(),
        // The power of 256 would not fit.
        _ if used.is_multiple_of(2) => BIT_COST + literal_cost(used / 2, quarters) as u32,
        _ => 2 * BIT_COST + ((used as u128).pow(BIT_COST) / divisor).ilog2(),
    }) as u8
}

/// For few, some and many matches, by how many literals are used.
static LITERAL_COSTS: [[u8; 257]; 3] = [
    table!(|used| literal_cost(used, 3)),
    table!(|used| literal_cost(used, 2)),
    table!(|used| literal_cost(used, 1)),
];

/// What a greedy parser would have chosen.
struct Statistics {
    observations: Observations,
    match_lens: [u32; 512],
}

impl Statistics {
    const EMPTY: Self = Self {
        observations: [0; _],
        match_lens: [0; _],
    };

    /// Counts the symbols that start in `data[byte..]`. Returns where the last ends.
    fn observe(
        &mut self,
        data: &[u8],
        cache: &MatchCache,
        mut byte: usize,
        min_len: usize,
    ) -> usize {
        while let Some(&literal) = data.get(byte) {
            let len = cache.longest_len(byte);
            let kind;
            if len >= min_len {
                kind = match_kind(len);
                *wrapped_mut(&mut self.match_lens, len) += 1;
                byte += len;
            } else {
                kind = literal_kind(literal);
                byte += 1;
            }
            *wrapped_mut(&mut self.observations, kind) += 1;
        }
        byte
    }

    fn count(&self) -> usize {
        self.observations.iter().sum::<u32>() as usize
    }

    fn add(&mut self, other: &Self) {
        let add = |to: &mut [u32], from: &[u32]| to.iter_mut().zip(from).for_each(|(a, b)| *a += b);
        add(&mut self.observations, &other.observations);
        add(&mut self.match_lens, &other.match_lens);
    }

    fn default_costs(&self, literals: &[u32], block_len: usize, max_depth: usize) -> Costs {
        let cutoff = block_len as u32 >> 11;
        let used = literals.iter().filter(|&&frequency| frequency > cutoff);
        let used = used.count();

        let min_len = min_match_len(used, max_depth);
        let (mut matches, mut matched) = (0, 0);
        for (len, &count) in (0..).zip(&self.match_lens).skip(min_len) {
            matches += count;
            matched += len * count;
        }
        let literals = (block_len as u32).saturating_sub(matched);

        let cost = |table: &[u8]| u32::from(table.get(used).copied().unwrap_or_default());
        let [few, some, many] = &LITERAL_COSTS;
        // The 29 length symbols share the probability that the literals leave.
        let (literal, length) = if matches > literals {
            (cost(many), 84)
        } else if 4 * matches > literals {
            (cost(some), 93)
        } else {
            (cost(few), 109)
        };
        // log2(30), for as many offset symbols
        let offset = 4 * BIT_COST + 907 * BIT_COST / 1000;
        Costs::new(|_| literal, |_| length, |_| offset)
    }
}

/// How many eighths of the way to go from the costs of the previous block to the defaults.
fn eighths_toward_defaults(previous: &Observations, current: &Observations) -> u32 {
    let count = |observations: &Observations| u64::from(observations.iter().sum::<u32>());
    let (previous_count, current_count) = (count(previous), count(current));
    let difference: u64 = previous
        .iter()
        .zip(current)
        .map(|(&a, &b)| (u64::from(a) * current_count).abs_diff(u64::from(b) * previous_count))
        .sum();
    let cutoff = previous_count * current_count * 200 / 512;
    if difference > 3 * cutoff {
        8
    } else if 4 * difference > 9 * cutoff {
        6
    } else if 2 * difference > 3 * cutoff {
        5
    } else if 2 * difference > cutoff {
        4
    } else {
        2
    }
}

const LEN_BITS: u32 = 9;
const LANES: usize = 4;
/// How many bytes are done between two moves of the costs that are still needed.
const STRETCH: usize = 2048;
const LIVE: usize = MAX_MATCH_LEN + LANES;

/// Costs with a length in the low [`LEN_BITS`], so that the minimum tells both.
type Lanes = [u32; LANES];

#[inline(always)]
fn sum(a: Lanes, b: Lanes) -> Lanes {
    from_fn(|lane| wrapped(&a, lane).wrapping_add(*wrapped(&b, lane)))
}

#[inline(always)]
fn least_of_each(a: Lanes, b: Lanes) -> Lanes {
    from_fn(|lane| *wrapped(&a, lane).min(wrapped(&b, lane)))
}

#[inline(always)]
fn least_of_all([a, b, c, d]: Lanes) -> u32 {
    a.min(b).min(c).min(d)
}

#[inline(always)]
fn lanes_at(costs: &[u32], at: usize) -> Lanes {
    chunk_at(costs, at).copied().unwrap_or_default()
}

/// The cheapest path that starts with one of `matches` and at least [`MIN_LONG_LEN`] bytes.
#[inline(always)]
fn cheapest_long(
    matches: &[Match],
    offset_costs: &[u32; OFFSET_SYMBOLS],
    length_costs: &[u32; LIVE + 1],
    ahead: &[u32; LIVE + 1],
) -> u32 {
    static MASKS: [u32; 2 * LANES] = table!(|lane| if lane < LANES { 0 } else { u32::MAX });

    let (mut first, mut best) = (MIN_LONG_LEN, u32::MAX);
    for cached in matches {
        let last = usize::from(cached.len).min(MAX_MATCH_LEN);
        if last < first {
            continue;
        }
        let lanes = |len| sum(lanes_at(length_costs, len), lanes_at(ahead, len));
        let masks = lanes_at(&MASKS, (first + LANES - 1).wrapping_sub(last) % LANES);
        let mut least = lanes(first);
        if first + LANES > last {
            least = from_fn(|lane| wrapped(&least, lane) | wrapped(&masks, lane));
        } else {
            let mut len = last + 1 - LANES;
            while len > first {
                least = least_of_each(least, lanes(len));
                len -= LANES;
            }
        }
        let offset_cost = wrapped(offset_costs, offset_slot_of(cached.offset.into()));
        best = best.min(least_of_all(least) + (offset_cost << LEN_BITS));
        first = last + 1;
    }
    best
}

/// Fills `choices` with how the cheapest path from each byte to the end of the block starts. Returns its cost from the first.
#[inline(never)]
fn find_cheapest_path(
    costs: &Costs,
    data: &[u8],
    cache: &MatchCache,
    choices: &mut [Choice],
) -> u32 {
    /// More than [`MAX_MATCH_LEN`] literals cost.
    const MARGIN: u32 = 1 << 17;

    let mut length_costs = [0u32; LIVE + 1];
    let (_, of_matches) = length_costs.split_at_mut(MIN_MATCH_LEN);
    for (index, (to, cost)) in of_matches.iter_mut().zip(&costs.length).enumerate() {
        *to = (cost << LEN_BITS) | (MIN_MATCH_LEN + index) as u32;
    }
    let literal_costs = costs.literal.map(|cost| cost << LEN_BITS);
    let mut offset_costs = costs.offset_slot.map(|cost| cost << LEN_BITS);
    offset_costs[NO_SLOT] = 1 << 30;
    let pair_costs = offset_costs.map(|second| offset_costs.map(|first| [first, second]));
    let pair_costs: &[_; OFFSET_SYMBOLS * OFFSET_SYMBOLS] =
        chunk_at(pair_costs.as_flattened(), 0).unwrap_or(&[[0; 2]; _]);
    let short_costs: &[u32; SHORT_LENS] = chunk_at(&length_costs, MIN_MATCH_LEN).unwrap_or(&[0; _]);

    // Less `base`. No path leads past the end of the block.
    let mut to_end = [MARGIN << LEN_BITS; STRETCH + LIVE];
    to_end[STRETCH] = 0;
    let (mut base, mut best) = (0u32, 0u32);

    let summaries = cache.summaries().get(..data.len()).unwrap_or_default();
    let mut byte = data.len();
    let stretches = choices.rchunks_mut(STRETCH).zip(summaries.rchunks(STRETCH));
    for ((choices, summaries), data) in stretches.zip(data.rchunks(STRETCH)) {
        let mut at = STRETCH;
        let bytes = choices.iter_mut().zip(summaries).zip(data).enumerate();
        for (index, ((choice, &summary), &literal)) in bytes.rev() {
            (at, byte) = ((at - 1) % STRETCH, byte - 1);
            let mut least = best + wrapped(&literal_costs, literal.into());
            // The code below is right without matches too, so it is only skipped where they are rare and the branch predictable.
            let nearby = summaries.get(index.wrapping_sub(4)).copied();
            if !summary.neither_has_matches(nearby.unwrap_or(summary)) {
                let ahead: &[u32; LIVE + 1] = chunk_at(&to_end, at).unwrap_or(&[0; _]);
                let after_short: &[u32; SHORT_LENS] =
                    chunk_at(ahead, MIN_MATCH_LEN).unwrap_or(&[0; _]);
                let short: [u32; SHORT_LENS] = from_fn(|index| {
                    let offset_costs = wrapped(pair_costs, summary.slots(index / 2));
                    let cost = wrapped(offset_costs, index) + wrapped(short_costs, index);
                    cost + wrapped(after_short, index)
                });
                least = least.min(short.into_iter().fold(u32::MAX, u32::min));
                if summary.has_long() {
                    let matches = cache.matches_at(byte);
                    let long = cheapest_long(matches, &costs.offset_slot, &length_costs, ahead);
                    least = least.min(long);
                }
            }
            *choice = (least % (1 << LEN_BITS)) as Choice;
            best = least >> LEN_BITS << LEN_BITS;
            #[expect(clippy::indexing_slicing, reason = "it is less than STRETCH")]
            {
                to_end[at] = best;
            }
        }

        let excess = best.saturating_sub(MARGIN << LEN_BITS);
        let (done, live) = to_end.split_at_mut(STRETCH);
        for (to, from) in live.iter_mut().zip(done) {
            *to = from.wrapping_sub(excess);
        }
        base += excess >> LEN_BITS;
        best -= excess;
    }
    base + (best >> LEN_BITS)
}

struct Path<'a> {
    data: &'a [u8],
    cache: &'a MatchCache,
    choices: &'a mut [Choice],
    sequences: &'a mut Vec<Sequence>,
    frequencies: Frequencies,
    lens: Lens,
}

impl Path<'_> {
    /// Returns what it costs by `costs`.
    fn find(&mut self, costs: &Costs) -> u32 {
        let cost = find_cheapest_path(costs, self.data, self.cache, self.choices);
        self.frequencies = Frequencies::EMPTY;
        self.sequences.clear();
        let (mut at, mut after_match) = (0, 0);
        while let (Some(&len), Some(&literal)) = (self.choices.get(at), self.data.get(at)) {
            if len == 0 {
                self.frequencies.add_literal(literal);
                at += 1;
                continue;
            }
            let (len, offset) = (len.into(), self.cache.offset_for(at, len).into());
            let sequence = Sequence::new(at - after_match, len, offset, &mut self.frequencies);
            _ = self.sequences.push_within_capacity(sequence);
            at += len;
            after_match = at;
        }
        self.lens = self.frequencies.lens();
        cost
    }
}

struct Optimizer<'a> {
    settings: &'a Settings,
    choices: &'a mut Vec<Choice>,
    sequences: &'a mut Vec<Sequence>,
    /// What the previous block ended up with.
    previous: Option<(Costs, Observations)>,
}

impl Optimizer<'_> {
    /// Returns whether the block has only literals.
    fn write_block(
        &mut self,
        data: &[u8],
        cache: &MatchCache,
        statistics: &Statistics,
        is_final: bool,
        stream: &mut Stream<'_, '_>,
    ) -> Result<bool> {
        let settings = self.settings;
        let mut literals = Frequencies::EMPTY;
        data.iter().for_each(|&byte| literals.add_literal(byte));
        let literal_lens = literals.lens();
        let literals_cost = literals.dynamic_cost(&literal_lens);

        let choices = grow(self.choices, data.len())?;
        self.sequences.clear();
        self.sequences.try_reserve(data.len() / MIN_MATCH_LEN)?;
        let mut path = Path {
            data,
            cache,
            choices: choices.get_mut(..data.len()).unwrap_or_default(),
            sequences: self.sequences,
            frequencies: literals,
            lens: literal_lens,
        };

        let static_cost = match data.len() <= settings.max_static_len {
            true => path.find(&Costs::from_lens(&STATIC_LENS)) / BIT_COST + 7,
            false => u32::MAX,
        };

        let defaults =
            statistics.default_costs(literals.literals(), data.len(), settings.effort.max_depth);
        let mut costs = match self.previous {
            Some((mut costs, observations)) => {
                costs.approach(
                    &defaults,
                    eighths_toward_defaults(&observations, &statistics.observations),
                );
                costs
            }
            None => defaults,
        };

        // What symbols cost depends on the path, and the other way around.
        let (mut best_cost, mut best_costs) = (u32::MAX, costs);
        let mut cost = u32::MAX;
        for _ in 0..settings.max_passes {
            path.find(&costs);
            cost = path.frequencies.dynamic_cost(&path.lens);
            if cost + settings.min_gain > best_cost {
                break;
            }
            (best_cost, best_costs) = (cost, costs);
            costs = Costs::from_lens(&path.lens);
            if costs == best_costs {
                break;
            }
        }

        let has_only_literals = literals_cost < best_cost && literals_cost < static_cost;
        if has_only_literals {
            path.sequences.clear();
            (path.frequencies, path.lens) = (literals, literal_lens);
            costs = Costs::from_lens(&literal_lens);
        } else if static_cost < best_cost {
            costs = Costs::from_lens(&STATIC_LENS);
            path.find(&costs);
        } else if cost >= best_cost + settings.min_gain {
            path.find(&best_costs);
        }
        self.previous = Some((costs, statistics.observations));
        stream.write_block(
            data,
            path.sequences,
            &path.frequencies,
            &path.lens,
            is_final,
        )?;
        Ok(has_only_literals)
    }
}

/// Stops after the first of `nodes` that has a match of `nice_len`. Returns how many it did, and whether it stopped.
#[inline(never)]
fn find_matches(
    trees: &mut BinaryTrees<'_>,
    window: &Bytes,
    nodes: Range<usize>,
    input_end: usize,
    effort: Effort,
    cache: &mut MatchCache,
) -> (usize, bool) {
    let mut is_nice = false;
    let count = cache.add_bytes(
        nodes.len(),
        #[inline(always)]
        |index, matches| {
            let node = nodes.start + index;
            is_nice = trees.find_matches(
                window,
                node,
                input_end - node,
                effort.nice_len,
                effort.max_depth,
                #[inline(always)]
                |len, offset| matches.add(len, offset),
            );
            is_nice
        },
    );
    (count, is_nice)
}

pub(crate) fn compress(
    level: u8,
    mut window: Window<'_>,
    storage: &mut Storage,
    sequences: &mut Vec<Sequence>,
    stream: &mut Stream<'_, '_>,
) -> Result<()> {
    let input = window.input();
    let (max_depth, nice_len, max_passes, min_gain, max_static_len) = match level {
        10 => (35, 75, 2, 32, 0),
        11 => (100, 150, 4, 16, 1000),
        _ => (300, MAX_MATCH_LEN, 10, 1, 10000),
    };
    let settings = Settings {
        effort: Effort {
            max_depth,
            nice_len,
        },
        max_passes,
        min_gain,
        max_static_len,
    };
    let mut trees = BinaryTrees::new(&mut storage.trees, input.len())?;
    let cache = &mut storage.cache;
    let most_bytes = input
        .len()
        .min(SOFT_MAX_BLOCK_LEN + MIN_BLOCK_LEN + MAX_MATCH_LEN);
    let most_matches = MAX_CACHED.min(input.len().saturating_mul(MAX_MATCH_LEN));
    cache.reset(most_bytes, most_matches + MAX_MATCH_LEN)?;
    let mut optimizer = Optimizer {
        settings: &settings,
        choices: &mut storage.choices,
        sequences,
        previous: None,
    };

    let (mut old, mut new) = (Statistics::EMPTY, Statistics::EMPTY);
    let (mut start, mut position) = (0, 0);
    let mut had_only_literals = false;
    while position < input.len() {
        let max_end = max_block_end(start, input.len(), SOFT_MAX_BLOCK_LEN);
        let min_len = match had_only_literals {
            true => MAX_MATCH_LEN + 1,
            false => {
                initial_min_match_len(input.get(start..max_end).unwrap_or_default(), max_depth)
            }
        };
        let mut unobserved = position - start;
        let mut last_check = None;
        let mut has_changed = false;

        loop {
            let mut stop = window.advance(position, &mut trees).min(max_end);
            stop = stop.min(position + (MAX_CACHED - cache.len()).div_ceil(MAX_MATCH_LEN));
            if new.count() < OBSERVATIONS_PER_CHECK {
                stop = stop.min(position + OBSERVATIONS_PER_CHECK - new.count());
            } else if input.len() - position > MIN_BLOCK_LEN {
                stop = stop.min((start + MIN_BLOCK_LEN).max(position + 1));
            }
            let (bytes, input_end) = (window.bytes(), window.input_end());
            let nodes = window.node_at(position)..window.node_at(stop);
            let (count, is_nice) =
                find_matches(&mut trees, bytes, nodes, input_end, settings.effort, cache);
            position += count;
            let data = input.get(start..position).unwrap_or_default();
            unobserved = new.observe(data, cache, unobserved, min_len);

            // In data that repeats itself a lot there are too many matches, and it matters little which is taken.
            if is_nice {
                let len = cache.longest_len(position - start - 1);
                let offset = cache.offset_for(position - start - 1, len as u16).into();
                let rest = len - 1;
                let nodes = window.node_at(position)..window.node_at(position + rest);
                trees.skip(bytes, nodes, offset, input_end, nice_len, max_depth);
                position += cache.add_bytes(rest, |_, _| false);
                unobserved = unobserved.max(position - start);
            }

            if position >= max_end || cache.len() >= MAX_CACHED {
                break;
            }
            if new.count() >= OBSERVATIONS_PER_CHECK
                && may_split(position - start, input.len() - position)
            {
                if should_split(&old.observations, &new.observations, position - start) {
                    has_changed = true;
                    break;
                }
                old.add(&new);
                new = Statistics::EMPTY;
                last_check = Some(position);
            }
        }

        // What differs from the rest belongs to the next block.
        let end = match last_check {
            Some(last_check) if has_changed => last_check,
            _ => {
                old.add(&new);
                new = Statistics::EMPTY;
                position
            }
        };
        had_only_literals = optimizer.write_block(
            input.get(start..end).unwrap_or_default(),
            cache,
            &old,
            end == input.len(),
            stream,
        )?;
        cache.remove_bytes(end - start);
        old = Statistics::EMPTY;
        start = end;
    }
    Ok(())
}
