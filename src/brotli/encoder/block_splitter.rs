//! Blocks of symbols that share a type, and the slow way to find them (qualities 10 and 11).

use core::array::from_fn;

use bun_highway::brotli::find_switches;

use super::cluster::{BATCH, Clusters, Combiner, max_at_once, renumber};
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
const TOO_MUCH: f64 = 1e99;

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

/// Returns what is left for the last pass. `counts` is room for a histogram.
fn cluster_in_batches(
    data: &[u16],
    blocks: &[Block],
    counts: &mut [u32],
    combiner: &mut Combiner,
) -> Result<Clusters> {
    let alphabet_size = counts.len();
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
        if clusters.len() > max_at_once(data.len()) {
            let mut kept = memory::collected(0..clusters.len() as u32)?;
            combiner.halve(&mut clusters, &mut kept)?;
            let all = core::mem::replace(&mut clusters, Clusters::new(alphabet_size));
            clusters.add_from(&all, &kept)?;
        }
    }
    Ok(clusters)
}

fn cluster_blocks(
    data: &[u16],
    blocks: &[Block],
    alphabet_size: usize,
    combiner: &mut Combiner,
) -> Result<BlockSplit> {
    let counts = &mut [0; COMMAND_SYMBOLS][..alphabet_size];
    let mut clusters = cluster_in_batches(data, blocks, counts, combiner)?;
    let mut live = memory::collected(0..clusters.len() as u32)?;
    let left = combiner.combine(&mut clusters, &mut live, 1..=MAX_BLOCK_TYPES)?;
    live.truncate(left);
    let mut previous = 0;
    let mut assignments = memory::collected(with_symbols(blocks, data).map(|(_, symbols)| {
        previous = combiner.closest(&indexed(symbols, counts), &clusters, &live, previous);
        previous
    }))?;
    let type_count = renumber(&mut assignments, clusters.len())?;
    BlockSplit::joined(type_count, &assignments, blocks)
}

#[cfg(test)]
mod tests {
    use bun_sema_standalone as _;

    use super::super::histogram::Estimator;
    use super::*;

    const LENGTH: u32 = 6;
    const BLOCK: Block = Block {
        kind: 0,
        length: LENGTH,
    };

    /// Kinds have no more than one symbol in common, so two of them take more bits together than apart.
    fn symbols_of(kind: usize) -> [u16; LENGTH as usize] {
        from_fn(|i| (i / 2 * 200 + (kind + i / 2 * (kind / 200)) % 200) as u16)
    }

    fn blocks_of<const COUNT: usize>(kind_of: impl Fn(usize) -> usize) -> Result<Vec<u16>> {
        let mut data = memory::empty(COUNT * LENGTH as usize)?;
        data.extend((0..COUNT).flat_map(|block| symbols_of(kind_of(block))));
        Ok(data)
    }

    #[test]
    fn combines_more_at_once_with_more_symbols() {
        let symbols = [0, 128 * 128, 129 * 129, 1023 * 1023, 1 << 20, 1 << 24];
        let expected = [1024, 1024, 1032, 8184, 8192, 8192];
        assert_eq!(symbols.map(max_at_once), expected);
    }

    #[test]
    fn halves_what_is_more_than_that() -> Result<()> {
        const COUNT: usize = 1664;
        let mut data = blocks_of::<COUNT>(|block| block % BATCH + block / 256 % 3 * BATCH)?;
        let (blocks, counts) = ([BLOCK; COUNT], &mut [0; COMMAND_SYMBOLS]);
        let combiner = &mut Combiner::new(Estimator::new(data.len())?);
        for (count, left) in [(1024, 1024), (1025, 513), (1536, 1024), (COUNT, 640)] {
            let clusters = cluster_in_batches(&data, &blocks[..count], counts, combiner)?;
            assert_eq!(clusters.len(), left, "of {count}");
        }
        memory::try_reserve_total(&mut data, 130 * 130)?;
        memory::resize(&mut data, 130 * 130, 0);
        for (count, left) in [(1040, 1040), (1041, 529)] {
            let clusters = cluster_in_batches(&data, &blocks[..count], counts, combiner)?;
            assert_eq!(clusters.len(), left, "of {count}");
        }
        Ok(())
    }

    #[test]
    fn many_blocks_get_the_type_of_their_kind() -> Result<()> {
        const COUNT: usize = 1280;
        // Some kinds are only at the start, or only right after the first large batch. The last batch has pairs.
        let kind_of = |block| match block / BATCH {
            ..8 => block % BATCH,
            16 => block % BATCH + 2 * BATCH,
            19 => block % BATCH / 2,
            _ => block % BATCH + BATCH,
        };
        let data = blocks_of::<COUNT>(kind_of)?;
        let combiner = &mut Combiner::new(Estimator::new(data.len())?);
        let split = cluster_blocks(&data, &[BLOCK; COUNT], COMMAND_SYMBOLS, combiner)?;
        assert_eq!(split.type_count, 3 * BATCH);
        assert_eq!(split.blocks.len(), COUNT - BATCH / 2);
        let mut at = 0;
        for block in &split.blocks {
            assert_eq!(usize::from(block.kind), kind_of(at), "of block {at}");
            at += (block.length / LENGTH) as usize;
        }
        assert_eq!(at, COUNT);
        Ok(())
    }

    #[test]
    fn many_kinds_make_do_with_the_types_there_are() -> Result<()> {
        const COUNT: usize = 1088;
        let data = blocks_of::<COUNT>(|block| block % 320)?;
        let combiner = &mut Combiner::new(Estimator::new(data.len())?);
        let split = cluster_blocks(&data, &[BLOCK; COUNT], COMMAND_SYMBOLS, combiner)?;
        assert_eq!(split.type_count, MAX_BLOCK_TYPES);
        Ok(())
    }
}
