//! Blocks of symbols that share a type, and the slow way to find them (qualities 10 and 11).

use core::array::from_fn;

use super::cluster::{BATCH, Cluster, Combiner, closest, renumber};
use super::histogram::Histogram;
use super::log2::fast_log2;
use crate::format::MAX_BLOCK_TYPES;
use crate::memory::{self, Result};

#[derive(Clone, Copy)]
pub(super) struct Block {
    pub(super) kind: u8,
    pub(super) length: u32,
}

pub(super) struct BlockSplit {
    pub(super) type_count: usize,
    pub(super) blocks: Vec<Block>,
}

impl BlockSplit {
    fn single(length: usize) -> Result<Self> {
        let length = length as u32;
        Ok(Self {
            type_count: 1,
            blocks: memory::filled(Block { kind: 0, length }, 1)?,
        })
    }

    /// Neighbors of the same type become one block.
    fn joined(type_count: usize, types: &[u32], lengths: &[usize]) -> Result<Self> {
        let mut blocks: Vec<Block> = memory::empty(lengths.len())?;
        for (&kind, &length) in types.iter().zip(lengths) {
            let (kind, length) = (kind as u8, length as u32);
            match blocks.last_mut() {
                Some(last) if last.kind == kind => last.length += length,
                _ => blocks.push(Block { kind, length }),
            }
        }
        Ok(Self { type_count, blocks })
    }

    /// The type and the symbols of each block.
    pub(super) fn apply_to<'a, T>(
        &self,
        mut symbols: &'a mut [T],
    ) -> impl Iterator<Item = (usize, &'a mut [T])> {
        self.blocks.iter().map(move |block| {
            let length = symbols.len().min(block.length as usize);
            let (covered, rest) = core::mem::take(&mut symbols).split_at_mut(length);
            symbols = rest;
            (usize::from(block.kind), covered)
        })
    }
}

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/block_splitter.c#L24
pub(super) struct Tuning {
    symbols_per_histogram: usize,
    max_histograms: usize,
    sample_length: usize,
    switch_cost: f64,
}

pub(super) const LITERALS: Tuning = Tuning {
    symbols_per_histogram: 544,
    max_histograms: 100,
    sample_length: 70,
    switch_cost: 28.1,
};

pub(super) const COMMANDS: Tuning = Tuning {
    symbols_per_histogram: 530,
    max_histograms: 50,
    sample_length: 40,
    switch_cost: 13.5,
};

pub(super) const DISTANCES: Tuning = Tuning {
    symbols_per_histogram: 544,
    max_histograms: 50,
    sample_length: 40,
    switch_cost: 14.6,
};

pub(super) fn split<const N: usize>(
    data: &[u16],
    tuning: &Tuning,
    iterations: usize,
) -> Result<BlockSplit> {
    if data.len() < 128 {
        return BlockSplit::single(data.len());
    }
    let count = (data.len() / tuning.symbols_per_histogram + 1).min(tuning.max_histograms);
    let mut histograms = memory::filled(Histogram::<N>::EMPTY, count)?;
    sample(data, tuning.sample_length, &mut histograms);

    let mut ids = memory::zeroed(data.len())?;
    let mut path = PathFinder::new(data.len(), N, count)?;
    for _ in 0..iterations {
        if histograms.len() == 1 {
            ids.fill(0);
        } else {
            path.begin(&histograms);
            path.assign(data, tuning.switch_cost, &mut ids);
        }
        let used = renumber_ids(&mut ids);
        histograms.truncate(used);
        histograms.iter_mut().for_each(Histogram::clear);
        for (&symbol, &id) in data.iter().zip(&ids) {
            histograms[usize::from(id)].add(usize::from(symbol));
        }
    }
    drop((path, histograms));
    cluster_blocks::<N>(data, &run_lengths(&ids)?)
}

fn sample<const N: usize>(data: &[u16], length: usize, histograms: &mut [Histogram<N>]) {
    let random_numbers = || {
        let mut seed = 7u32;
        move || {
            seed = seed.wrapping_mul(16807);
            seed as usize
        }
    };
    let count = histograms.len();
    let mut random = random_numbers();
    for (i, histogram) in histograms.iter_mut().enumerate() {
        let mut start = data.len() * i / count;
        if i != 0 {
            start += random() % (data.len() / count);
        }
        histogram.add_all(&data[start.min(data.len() - length - 1)..][..length]);
    }
    let mut random = random_numbers();
    for i in 0..(2 * data.len() / length + 100).next_multiple_of(count) {
        let start = random() % (data.len() - length + 1);
        histograms[i % count].add_all(&data[start..][..length]);
    }
}

const LANES: usize = 8;
const TOO_MUCH: f64 = 1e99;

/// One for each of so many histograms.
type Costs = [f64; LANES];

struct PathFinder {
    symbol_costs: Vec<Costs>,
    costs: Vec<Costs>,
    /// A bit for each histogram: whether the cheapest path that ends in it switches here.
    switches: Vec<u8>,
}

#[inline(always)]
fn lanes_where(test: impl Fn(usize) -> bool) -> u8 {
    (0..LANES).fold(0, |bits, lane| bits | (u8::from(test(lane)) << lane))
}

impl PathFinder {
    fn new(length: usize, alphabet_size: usize, histograms: usize) -> Result<Self> {
        let groups = histograms.div_ceil(LANES);
        Ok(Self {
            symbol_costs: memory::empty(alphabet_size * groups)?,
            costs: memory::empty(groups)?,
            switches: memory::zeroed(length * groups)?,
        })
    }

    fn begin<const N: usize>(&mut self, histograms: &[Histogram<N>]) {
        let groups = histograms.len().div_ceil(LANES);
        self.costs.clear();
        self.costs.resize(groups, [0.0; LANES]);
        self.symbol_costs.clear();
        self.symbol_costs.resize(N * groups, [TOO_MUCH; LANES]);
        for (i, histogram) in histograms.iter().enumerate() {
            let log2_total = fast_log2(histogram.total);
            let targets = self.symbol_costs[i / LANES..].iter_mut().step_by(groups);
            for (costs, &count) in targets.zip(&histogram.counts) {
                costs[i % LANES] = log2_total
                    - match count {
                        0 => -2.0,
                        count => fast_log2(count as usize),
                    };
            }
        }
    }

    /// Chooses a histogram for each symbol.
    #[inline(never)]
    fn assign(&mut self, data: &[u16], switch_cost: f64, ids: &mut [u8]) {
        const PROLOGUE: usize = 2000;
        let groups = self.costs.len();

        // What limits the costs after a symbol is applied when the next one is added.
        let (mut min_cost, mut max_cost) = (0.0, TOO_MUCH);
        let rows = self.switches.chunks_exact_mut(groups);
        for (position, ((&symbol, id), switches)) in
            data.iter().zip(&mut *ids).zip(rows).enumerate()
        {
            let added = &self.symbol_costs[usize::from(symbol) * groups..][..groups];
            let mut min_costs = [TOO_MUCH; LANES];
            for ((costs, added), switches) in self.costs.iter_mut().zip(added).zip(switches) {
                let relative = costs.map(|cost| cost - min_cost);
                *switches = lanes_where(|lane| relative[lane] >= max_cost);
                let next = from_fn(|lane| smaller(relative[lane], max_cost) + added[lane]);
                min_costs = from_fn(|lane| smaller(next[lane], min_costs[lane]));
                *costs = next;
            }
            let [a, b, c, d] = from_fn(|lane| smaller(min_costs[lane], min_costs[lane + 4]));
            min_cost = smaller(smaller(a, c), smaller(b, d));
            for (group, costs) in self.costs.iter().enumerate() {
                let cheapest = lanes_where(|lane| costs[lane] == min_cost);
                if cheapest != 0 {
                    *id = (group * LANES) as u8 + cheapest.trailing_zeros() as u8;
                    break;
                }
            }
            max_cost = switch_cost;
            if position < PROLOGUE {
                max_cost *= 0.77 + (0.07 / PROLOGUE as f64) * position as f64;
            }
        }

        let Some((&mut mut current, earlier)) = ids.split_last_mut() else {
            return;
        };
        let rows = self.switches[groups..data.len() * groups].chunks_exact(groups);
        for (id, switches) in earlier.iter_mut().zip(rows).rev() {
            let [group, lane] = [current / LANES as u8, current % LANES as u8];
            if (switches[usize::from(group)] >> lane) & 1 != 0 {
                current = *id;
            }
            *id = current;
        }
    }
}

/// `f64::min` spends time on NaN.
#[inline(always)]
fn smaller(a: f64, b: f64) -> f64 {
    if a < b { a } else { b }
}

fn renumber_ids(ids: &mut [u8]) -> usize {
    let mut new_ids = [None; 256];
    let mut count = 0;
    for id in ids {
        *id = *new_ids[usize::from(*id)].get_or_insert_with(|| {
            count += 1;
            count - 1
        });
    }
    usize::from(count)
}

fn run_lengths(ids: &[u8]) -> Result<Vec<usize>> {
    let runs = || ids.chunk_by(|a, b| a == b);
    let mut lengths = memory::empty(runs().count())?;
    lengths.extend(runs().map(<[u8]>::len));
    Ok(lengths)
}

fn cluster_blocks<const N: usize>(data: &[u16], lengths: &[usize]) -> Result<BlockSplit> {
    let histograms_of_blocks = || {
        let mut rest = data;
        lengths.iter().map(move |&length| {
            let (block, after) = rest.split_at(length);
            rest = after;
            let mut histogram = Histogram::<N>::EMPTY;
            histogram.add_all(block);
            histogram
        })
    };

    let mut combiner = Combiner::default();
    let mut clusters = Vec::new();
    let mut batch = memory::empty(lengths.len().min(BATCH))?;
    let mut histograms = histograms_of_blocks();
    for _ in 0..lengths.len().div_ceil(BATCH) {
        batch.clear();
        batch.extend(histograms.by_ref().take(BATCH).map(|h| Cluster::new(&h)));
        let (mut live, count): ([u32; BATCH], _) = (from_fn(|i| i as u32), batch.len());
        let left = combiner.combine(&mut batch, &mut live[..count], BATCH)?;
        memory::try_reserve(&mut clusters, left)?;
        clusters.extend(live[..left].iter().map(|&id| batch[id as usize]));
    }
    drop(batch);

    let mut live = memory::collected(0..clusters.len() as u32)?;
    let left = combiner.combine(&mut clusters, &mut live, MAX_BLOCK_TYPES)?;
    live.truncate(left);
    let mut previous = 0;
    let mut assignments = memory::collected(histograms_of_blocks().map(|histogram| {
        previous = closest(&histogram, &clusters, &live, previous);
        previous
    }))?;
    let type_count = renumber(&mut assignments, clusters.len())?;
    BlockSplit::joined(type_count, &assignments, lengths)
}
