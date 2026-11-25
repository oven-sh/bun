//! Blocks of symbols that share a type, and how to find them.

use bun_highway::brotli::find_switches;
use bun_highway::with_avx2;

use super::cluster::{self, Clusters, Counts, Items, Limit, Prices, cost_of};
use super::histogram::count_symbols;
use super::log2::fixed_point_log2;
use crate::format::COMMAND_SYMBOLS;
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

pub(super) struct Tuning {
    sample_length: usize,
    /// For the samples, if they were all there is. See [`Prices`].
    sample_description: u32,
    description: u32,
    switch_cost: u16,
}

impl Tuning {
    pub(super) const LITERALS: Self = Self {
        sample_length: 64,
        sample_description: 60,
        description: 115,
        switch_cost: 24 * BIT,
    };
    pub(super) const COMMANDS: Self = Self {
        sample_length: 128,
        sample_description: 50,
        description: 100,
        switch_cost: 27 * BIT / 2,
    };
    pub(super) const DISTANCES: Self = Self {
        sample_length: 128,
        sample_description: 50,
        description: 115,
        switch_cost: 17 * BIT,
    };
}

const LANES: usize = 16;
const MAX_TYPES: usize = 4 * LANES;
/// The bits after that of [`PathFinder::prior`].
const POINT: u32 = 20;
const BIT: u16 = 32;

pub(super) fn split(
    data: &[u16],
    size: usize,
    input_size: usize,
    tuning: &Tuning,
    items: &mut Items,
    clusters: &mut Clusters,
) -> Result<BlockSplit> {
    let most = data.len() / tuning.sample_length;
    let samples = most.min((most / 4).clamp(16, 64));
    if samples < 3 {
        return BlockSplit::single(data.len());
    }
    let is_small = input_size < 50000;
    let spacing = data.len() / samples;
    let length = (spacing / 4).clamp(tuning.sample_length, 128);
    let mut zeros: Counts = [0; _];
    items.clear();
    for i in 0..samples {
        // Among equals, the first ones found the clusters.
        items.push_symbols(&data[i * 7919 % samples * spacing..][..length], &mut zeros)?;
    }
    let description =
        (tuning.sample_description * length as u32 + spacing as u32 / 2) / spacing as u32;
    let usual = if is_small { 7 } else { LANES - 1 };
    clusters.begin(
        items,
        size,
        Limit {
            usual,
            surcharge: 4,
            max: MAX_TYPES,
        },
        description,
    )?;
    let mut histograms = merged(items, clusters, size)?;
    if clusters.count < MAX_TYPES && histograms.chunks_exact(size).any(has_few) {
        // For what the samples have missed.
        memory::try_reserve(&mut histograms, size)?;
        memory::resize(&mut histograms, (clusters.count + 1) * size, 1);
    } else if clusters.count == 1 {
        return BlockSplit::single(data.len());
    }
    let mut path = PathFinder::new(data, size, tuning.switch_cost);
    let mut blocks = Vec::new();
    for _ in 0..2 {
        blocks = path.assign(&histograms, 4)?;
        histograms.fill(0);
        for (block, symbols) in with_symbols(&blocks, data) {
            count_symbols(symbols, &mut histograms[usize::from(block.kind) * size..]);
        }
        let description = if is_small { 70 } else { 30 };
        let apart: i32 = histograms
            .chunks_exact(size)
            .map(|counts| cost_of(counts, description))
            .sum();
        if apart + blocks.len() as i32 * 12 * cluster::BIT
            > cost_of(&path.counts[..size], description)
        {
            return BlockSplit::single(data.len());
        }
    }
    items.clear();
    for (_, symbols) in with_symbols(&blocks, data) {
        items.push_symbols(symbols, &mut zeros)?;
    }
    let usual = (input_size / 2048).clamp(8, MAX_TYPES) - 1;
    let prices = Prices {
        description: tuning.description,
        first_description: tuning.description / 2,
        change: 12 * cluster::BIT,
        several: 60 * cluster::BIT,
    };
    clusters.find(
        items,
        size,
        Limit {
            usual,
            surcharge: 2,
            max: MAX_TYPES,
        },
        &prices,
    )?;
    if clusters.count == 1 {
        return BlockSplit::single(data.len());
    }
    let mut blocks = path.assign(&merged(items, clusters, size)?, 2)?;
    Ok(BlockSplit {
        type_count: renumber_kinds(&mut blocks),
        blocks,
    })
}

/// Another symbol would add a bit to a short code.
#[inline(always)]
fn has_few(histogram: &[u32]) -> bool {
    (2..=4).contains(
        &histogram
            .iter()
            .map(|&count| u32::from(count != 0))
            .sum::<u32>(),
    )
}

fn merged(items: &Items, clusters: &Clusters, size: usize) -> Result<Vec<u32>> {
    let mut histograms = memory::zeroed(clusters.count * size)?;
    for (item, &cluster) in clusters.of_item.iter().enumerate() {
        items.add_to(item, &mut histograms[cluster as usize * size..]);
    }
    Ok(histograms)
}

pub(super) fn with_symbols<'a>(
    blocks: &'a [Block],
    mut data: &'a [u16],
) -> impl ExactSizeIterator<Item = (&'a Block, &'a [u16])> {
    blocks.iter().map(move |block| {
        let symbols;
        (symbols, data) = data.split_at(block.length as usize);
        (block, symbols)
    })
}

struct PathFinder<'a> {
    data: &'a [u16],
    alphabet_size: usize,
    counts: [u32; COMMAND_SYMBOLS],
    /// Added to each histogram.
    prior: [u32; COMMAND_SYMBOLS],
    prior_total: u32,
    switch_cost: u16,
    costs: Vec<[u16; LANES]>,
    bits: Vec<[u16; 2]>,
}

impl<'a> PathFinder<'a> {
    fn new(data: &'a [u16], alphabet_size: usize, switch_cost: u16) -> Self {
        let mut counts = [0; COMMAND_SYMBOLS];
        count_symbols(data, &mut counts);
        // Between 24 and 48 in all.
        let scale = (data.len() * 4 / 3).leading_zeros() - 32;
        Self {
            data,
            alphabet_size,
            counts,
            prior: counts.map(|count| (count << scale >> (26 - POINT)) + 1),
            prior_total: (data.len() << scale >> 26) as u32,
            switch_cost,
            costs: Vec::new(),
            bits: Vec::new(),
        }
    }

    #[inline(always)]
    fn set_costs(&mut self, histograms: &[u32], groups: usize) {
        let mut column = [0; COMMAND_SYMBOLS];
        for (i, histogram) in histograms.chunks_exact(self.alphabet_size).enumerate() {
            let total = histogram.iter().sum::<u32>() + self.prior_total;
            let point = POINT.min(total.leading_zeros() - 1);
            let log2_total = fixed_point_log2((total << point) as f32) + (1 << 17);
            let absent = if has_few(histogram) {
                63 * BIT as i32
            } else {
                0
            };
            for ((cost, &count), prior) in column.iter_mut().zip(histogram).zip(&self.prior) {
                let bits = log2_total
                    - fixed_point_log2(
                        ((count << point) + (prior >> (POINT - point))) as i32 as f32,
                    );
                *cost = (bits >> 18)
                    .clamp(BIT as i32, 24 * BIT as i32)
                    .max(if count == 0 { absent } else { 0 });
            }
            for (costs, &cost) in self.costs.chunks_exact_mut(groups).zip(&column) {
                costs[i / LANES][i % LANES] = cost as u16;
            }
        }
    }

    /// Chooses a histogram for each `stride` symbols.
    #[inline(never)]
    fn assign(&mut self, histograms: &[u32], stride: usize) -> Result<Vec<Block>> {
        let groups = histograms.len().div_ceil(LANES * self.alphabet_size);
        let (mut end, mut rest) = (self.data.len() / stride, self.data.len() % stride);
        self.costs.clear();
        memory::try_reserve(&mut self.costs, self.alphabet_size * groups)?;
        memory::resize(
            &mut self.costs,
            self.alphabet_size * groups,
            [64 * BIT; LANES],
        );
        if self.bits.len() < end * groups {
            self.bits = memory::zeroed(end * groups)?;
        }
        with_avx2(
            #[inline(always)]
            || self.set_costs(histograms, groups),
        );
        find_switches(
            self.data,
            stride,
            &self.costs,
            groups,
            self.switch_cost,
            &mut self.bits,
        );
        let mut blocks = Vec::new();
        while end != 0 {
            let (before, last) = self.bits.split_at((end - 1) * groups);
            let group = last
                .iter()
                .position(|&[_, cheapest]| cheapest != 0)
                .unwrap_or_default();
            let lane = last[group][1].trailing_zeros();
            let start = (before.chunks_exact(groups))
                .rposition(|bits| bits[group][0] >> lane & 1 != 0)
                .map_or(0, |step| step + 1);
            memory::try_reserve(&mut blocks, 1)?;
            blocks.push(Block {
                kind: (group * LANES) as u8 + lane as u8,
                length: ((end - start) * stride + core::mem::take(&mut rest)) as u32,
            });
            end = start;
        }
        blocks.reverse();
        Ok(blocks)
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
