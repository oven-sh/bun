//! Blocks of symbols that share a type, and the slow way to find them (qualities 10 and 11).

use core::array::from_fn;

use bun_simd_kernels::brotli::{TOO_MUCH, find_switches};

use super::cluster::{BATCH, Clusters, Combiner, renumber};
use super::histogram::{DISTANCE_SYMBOLS, Indexed, count_symbols};
use super::log2::fast_log2;
use crate::format::{COMMAND_SYMBOLS, LITERAL_SYMBOLS, MAX_BLOCK_TYPES};
use crate::memory::{self, Result};

#[derive(Clone, Copy, PartialEq, Eq)]
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
    fn joined(type_count: usize, types: &[u32], untyped: &[Block]) -> Result<Self> {
        let mut blocks: Vec<Block> = memory::empty(untyped.len())?;
        for (&kind, &Block { length, .. }) in types.iter().zip(untyped) {
            let kind = kind as u8;
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
    alphabet_size: usize,
    symbols_per_histogram: usize,
    max_histograms: usize,
    sample_length: usize,
    switch_cost: f64,
}

pub(super) const LITERALS: Tuning = Tuning {
    alphabet_size: LITERAL_SYMBOLS,
    symbols_per_histogram: 544,
    max_histograms: 100,
    sample_length: 70,
    switch_cost: 28.1,
};

pub(super) const COMMANDS: Tuning = Tuning {
    alphabet_size: COMMAND_SYMBOLS,
    symbols_per_histogram: 530,
    max_histograms: 50,
    sample_length: 40,
    switch_cost: 13.5,
};

pub(super) const DISTANCES: Tuning = Tuning {
    alphabet_size: DISTANCE_SYMBOLS,
    symbols_per_histogram: 544,
    max_histograms: 50,
    sample_length: 40,
    switch_cost: 14.6,
};

pub(super) fn split(
    data: &[u16],
    tuning: &Tuning,
    iterations: usize,
    combiner: &mut Combiner,
) -> Result<BlockSplit> {
    if data.len() < 128 {
        return BlockSplit::single(data.len());
    }
    let count = (data.len() / tuning.symbols_per_histogram + 1).min(tuning.max_histograms);
    let size = tuning.alphabet_size;
    let mut histograms = memory::zeroed(count * size)?;
    sample(data, tuning, &mut histograms);

    let mut path = PathFinder::new(data.len(), size, count)?;
    let (mut blocks, mut previous) = (Vec::new(), Vec::new());
    for _ in 0..iterations {
        if histograms.len() == size {
            return BlockSplit::single(data.len());
        }
        path.begin(&histograms, size);
        path.assign(data, tuning.switch_cost, &mut blocks)?;
        // The same blocks lead to the same histograms.
        if blocks == previous {
            break;
        }
        histograms.truncate(renumber_kinds(&mut blocks) * size);
        histograms.fill(0);
        for (block, symbols) in with_symbols(&blocks, data) {
            count_symbols(symbols, &mut histograms[usize::from(block.kind) * size..]);
        }
        core::mem::swap(&mut blocks, &mut previous);
    }
    drop((path, histograms));
    cluster_blocks(data, &previous, size, combiner)
}

fn with_symbols<'a>(
    blocks: &'a [Block],
    mut data: &'a [u16],
) -> impl ExactSizeIterator<Item = (&'a Block, &'a [u16])> {
    blocks.iter().map(move |block| {
        let symbols;
        (symbols, data) = data.split_at(block.length as usize);
        (block, symbols)
    })
}

fn sample(data: &[u16], tuning: &Tuning, histograms: &mut [u32]) {
    let random_numbers = || {
        let mut seed = 7u32;
        move || {
            seed = seed.wrapping_mul(16807);
            seed as usize
        }
    };
    let (size, length) = (tuning.alphabet_size, tuning.sample_length);
    let count = histograms.len() / size;
    let mut random = random_numbers();
    for (i, histogram) in histograms.chunks_exact_mut(size).enumerate() {
        let mut start = data.len() * i / count;
        if i != 0 {
            start += random() % (data.len() / count);
        }
        start = start.min(data.len() - length - 1);
        count_symbols(&data[start..][..length], histogram);
    }
    let mut random = random_numbers();
    for i in 0..(2 * data.len() / length + 100).next_multiple_of(count) {
        let start = random() % (data.len() - length + 1);
        count_symbols(
            &data[start..][..length],
            &mut histograms[i % count * size..],
        );
    }
}

const LANES: usize = 8;

/// One for each of so many histograms.
type Costs = [f64; LANES];

struct PathFinder {
    symbol_costs: Vec<Costs>,
    costs: Vec<Costs>,
    /// A bit for each histogram: whether the cheapest path that ends in it switches before this symbol.
    switches: Vec<u8>,
    cheapest: Vec<u8>,
}

impl PathFinder {
    fn new(length: usize, alphabet_size: usize, histograms: usize) -> Result<Self> {
        let groups = histograms.div_ceil(LANES);
        Ok(Self {
            symbol_costs: memory::empty(alphabet_size * groups)?,
            costs: memory::empty(groups)?,
            switches: memory::zeroed(length * groups)?,
            cheapest: memory::zeroed(length)?,
        })
    }

    fn begin(&mut self, histograms: &[u32], alphabet_size: usize) {
        let groups = (histograms.len() / alphabet_size).div_ceil(LANES);
        self.costs.clear();
        memory::resize(&mut self.costs, groups, [0.0; LANES]);
        self.symbol_costs.clear();
        memory::resize(
            &mut self.symbol_costs,
            alphabet_size * groups,
            [TOO_MUCH; LANES],
        );
        for (i, histogram) in histograms.chunks_exact(alphabet_size).enumerate() {
            let log2_total = fast_log2(histogram.iter().sum::<u32>() as usize);
            let targets = self.symbol_costs[i / LANES..].iter_mut().step_by(groups);
            for (costs, &count) in targets.zip(histogram) {
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
    fn assign(&mut self, data: &[u16], switch_cost: f64, blocks: &mut Vec<Block>) -> Result<()> {
        let groups = self.costs.len();
        find_switches(
            data,
            &self.symbol_costs,
            switch_cost,
            &mut self.costs,
            &mut self.switches,
            &mut self.cheapest,
        );
        blocks.clear();
        let mut end = data.len();
        while end != 0 {
            let kind = self.cheapest[end - 1];
            let (group, bit) = (usize::from(kind) / LANES, 1 << (usize::from(kind) % LANES));
            let mut column = self.switches[group..end * groups].iter().step_by(groups);
            let start = column
                .rposition(|switches| switches & bit != 0)
                .unwrap_or(0);
            memory::try_reserve(blocks, 1)?;
            blocks.push(Block {
                kind,
                length: (end - start) as u32,
            });
            end = start;
        }
        blocks.reverse();
        Ok(())
    }
}

/// In the order they appear. Returns how many there are.
fn renumber_kinds(blocks: &mut [Block]) -> usize {
    let mut new_kinds = [None; 256];
    let mut count = 0;
    for block in blocks {
        block.kind = *new_kinds[usize::from(block.kind)].get_or_insert_with(|| {
            count += 1;
            count - 1
        });
    }
    usize::from(count)
}

fn indexed<'a>(symbols: &[u16], counts: &'a mut [u32]) -> Indexed<'a> {
    counts.fill(0);
    count_symbols(symbols, counts);
    Indexed::new(counts, symbols.len())
}

fn cluster_blocks(
    data: &[u16],
    blocks: &[Block],
    alphabet_size: usize,
    combiner: &mut Combiner,
) -> Result<BlockSplit> {
    let counts = &mut [0; COMMAND_SYMBOLS][..alphabet_size];
    let (mut clusters, mut batch) = (Clusters::new(alphabet_size), Clusters::new(alphabet_size));
    batch.try_reserve(blocks.len().min(BATCH))?;
    let mut waiting = with_symbols(blocks, data);
    while waiting.len() != 0 {
        batch.clear();
        for (_, symbols) in waiting.by_ref().take(BATCH) {
            batch.push_new(&indexed(symbols, counts));
        }
        let live = &mut from_fn::<_, BATCH, _>(|i| i as u32)[..batch.len()];
        let left = combiner.combine_new(&mut batch, live, BATCH)?;
        clusters.add_from(&batch, &live[..left])?;
    }
    drop(batch);

    let mut live = memory::collected(0..clusters.len() as u32)?;
    let left = combiner.combine(&mut clusters, &mut live, MAX_BLOCK_TYPES)?;
    live.truncate(left);
    let mut previous = 0;
    let mut assignments = memory::collected(with_symbols(blocks, data).map(|(_, symbols)| {
        previous = combiner.closest(&indexed(symbols, counts), &clusters, &live, previous);
        previous
    }))?;
    let type_count = renumber(&mut assignments, clusters.len())?;
    BlockSplit::joined(type_count, &assignments, blocks)
}
