//! Splits the literals, the commands and the distances of a meta-block into blocks, each of a type with its own
//! statistics.

use super::Fallible;
use super::bit_cost::population_cost;
use super::cluster::{HistogramPair, histogram_bit_cost_distance, histogram_combine};
use super::command::Command;
use super::fast_log::fast_log2;
use super::histogram::{Histogram, NUM_HISTOGRAM_DISTANCE_SYMBOLS};
use super::params::{EncoderParams, HQ_ZOPFLIFICATION_QUALITY};
use crate::common::constants::{
    MAX_NUMBER_OF_BLOCK_TYPES, NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS,
};
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_zeroed};
use bun_core::AllocError;

const MAX_LITERAL_HISTOGRAMS: usize = 100;
const MAX_COMMAND_HISTOGRAMS: usize = 50;
const LITERAL_BLOCK_SWITCH_COST: f64 = 28.1;
const COMMAND_BLOCK_SWITCH_COST: f64 = 13.5;
const DISTANCE_BLOCK_SWITCH_COST: f64 = 14.6;
const LITERAL_STRIDE_LENGTH: usize = 70;
const COMMAND_STRIDE_LENGTH: usize = 40;
const DISTANCE_STRIDE_LENGTH: usize = 40;
const SYMBOLS_PER_LITERAL_HISTOGRAM: usize = 544;
const SYMBOLS_PER_COMMAND_HISTOGRAM: usize = 530;
const SYMBOLS_PER_DISTANCE_HISTOGRAM: usize = 544;
const MIN_LENGTH_FOR_BLOCK_SPLITTING: usize = 128;
const ITER_MUL_FOR_REFINING: usize = 2;
const MIN_ITERS_FOR_REFINING: usize = 100;

const HISTOGRAMS_PER_BATCH: usize = 64;
const CLUSTERS_PER_BATCH: usize = 16;

#[derive(Default)]
pub(crate) struct BlockSplit {
    /// How many different types there are.
    pub(crate) num_types: usize,
    /// How many elements of `types` and `lengths` count. Both can be longer.
    pub(crate) num_blocks: usize,
    pub(crate) types: Vec<u8>,
    pub(crate) lengths: Vec<u32>,
}

impl BlockSplit {
    /// Makes room for `num_blocks` blocks.
    pub(crate) fn ensure_capacity(&mut self, num_blocks: usize) -> Result<(), AllocError> {
        if self.types.len() < num_blocks {
            self.types
                .try_reserve(num_blocks - self.types.len())
                .map_err(|_| AllocError)?;
            self.types.resize(num_blocks, 0);
        }
        if self.lengths.len() < num_blocks {
            self.lengths
                .try_reserve(num_blocks - self.lengths.len())
                .map_err(|_| AllocError)?;
            self.lengths.resize(num_blocks, 0);
        }
        Ok(())
    }

    /// Adds `length` symbols as a block of the only type.
    fn add_only_block(&mut self, length: usize) -> Fallible {
        self.ensure_capacity(self.num_blocks + 1)?;
        self.num_types = 1;
        self.types.put(self.num_blocks, 0)?;
        self.lengths.put(self.num_blocks, length as u32)?;
        self.num_blocks += 1;
        Ok(())
    }
}

fn count_literals(cmds: &[Command]) -> usize {
    cmds.iter().map(|cmd| cmd.insert_len as usize).sum()
}

/// Appends the literals of `cmds` to `literals`, which has room for them. `data` is a ring buffer of `mask + 1` bytes.
fn copy_literals_to_byte_array(
    cmds: &[Command],
    data: &[u8],
    offset: usize,
    mask: usize,
    literals: &mut Vec<u8>,
) -> Checked {
    let mut from_pos = offset & mask;
    for cmd in cmds {
        let mut insert_len = cmd.insert_len as usize;
        if from_pos + insert_len > mask {
            let head_size = mask + 1 - from_pos;
            literals.extend_from_slice(data.sub(from_pos..from_pos + head_size)?);
            from_pos = 0;
            insert_len -= head_size;
        }
        if insert_len > 0 {
            literals.extend_from_slice(data.sub(from_pos..from_pos + insert_len)?);
        }
        from_pos = (from_pos + insert_len + cmd.copy_len() as usize) & mask;
    }
    Ok(())
}

/// With a seed of 7 the numbers repeat after `1 << 29`.
#[inline(always)]
fn my_rand(seed: &mut u32) -> u32 {
    *seed = seed.wrapping_mul(16807);
    *seed
}

#[inline(always)]
fn bit_cost(count: usize) -> f64 {
    if count == 0 { -2.0 } else { fast_log2(count) }
}

/// Fills each histogram with a sample of `stride` symbols from its share of `data`.
fn initial_entropy_codes<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    stride: usize,
    histograms: &mut [Histogram<N>],
) -> Checked {
    let mut seed = 7u32;
    let length = data.len();
    let num_histograms = histograms.len();
    let block_length = length.checked_div(num_histograms).ok_or(Bug)?;
    for (i, histogram) in histograms.iter_mut().enumerate() {
        histogram.clear();
        let mut pos = length * i / num_histograms;
        if i != 0 {
            pos += (my_rand(&mut seed) as usize)
                .checked_rem(block_length)
                .ok_or(Bug)?;
        }
        if pos + stride >= length {
            pos = length.wrapping_sub(stride).wrapping_sub(1);
        }
        histogram.add_vector(data.sub(pos..pos.wrapping_add(stride))?)?;
    }
    Ok(())
}

/// Adds `stride` symbols from a random position of `data` to `sample`.
fn random_sample<T: Copy + Into<usize>, const N: usize>(
    seed: &mut u32,
    data: &[T],
    mut stride: usize,
    sample: &mut Histogram<N>,
) -> Checked {
    let length = data.len();
    let mut pos = 0;
    if stride >= length {
        stride = length;
    } else {
        pos = my_rand(seed) as usize % (length - stride + 1);
    }
    sample.add_vector(data.sub(pos..pos + stride)?)
}

/// Adds random samples of `data` to the histograms, in turns.
fn refine_entropy_codes<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    stride: usize,
    histograms: &mut [Histogram<N>],
) -> Checked {
    let num_histograms = histograms.len();
    let iters = (ITER_MUL_FOR_REFINING * data.len())
        .checked_div(stride)
        .ok_or(Bug)?
        + MIN_ITERS_FOR_REFINING;
    let rounds = (iters + num_histograms - 1)
        .checked_div(num_histograms)
        .ok_or(Bug)?;
    let mut seed = 7u32;
    for _ in 0..rounds {
        for histogram in histograms.iter_mut() {
            random_sample(&mut seed, data, stride, histogram)?;
        }
    }
    Ok(())
}

/// Takes `min_cost` off up to 8 costs and caps them at `block_switch_cost`. Returns a bit for each one that reached it.
#[inline(always)]
fn cap_costs(costs: &mut [f64], min_cost: f64, block_switch_cost: f64) -> u8 {
    let mut bits = 0u8;
    for (k, cost) in costs.iter_mut().enumerate() {
        let value = *cost - min_cost;
        let capped = value >= block_switch_cost;
        *cost = if capped { block_switch_cost } else { value };
        bits |= u8::from(capped) << k;
    }
    bits
}

/// Stores in `block_id` which of `histograms` to code each element of `data` with, and returns the number of blocks,
/// which is one more than the number of switches.
///
/// `insert_cost` is scratch space for `N` rows of a cost for each histogram, `cost` for one row, and `switch_signal`
/// for a bit for each histogram, rounded up to whole bytes, for each element of `data`.
fn find_blocks<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    block_switch_bitcost: f64,
    histograms: &[Histogram<N>],
    insert_cost: &mut [f64],
    cost: &mut [f64],
    switch_signal: &mut [u8],
    block_id: &mut [u8],
) -> Checked<usize> {
    const PROLOGUE_LENGTH: usize = 2000;
    const MULTIPLIER: f64 = 0.07 / 2000.0;
    let length = data.len();
    let num_histograms = histograms.len();
    let bitmap_len = (num_histograms + 7) >> 3;
    let mut num_blocks = 1usize;

    if num_histograms <= 1 {
        block_id.fill(0);
        return Ok(1);
    }

    // The cost of a symbol is -log2(count / total), or 2 + log2(total) if it does not occur. Row 0 holds log2(total)
    // until it is computed itself, as the last one.
    let insert_cost = insert_cost.sub_mut(..N * num_histograms)?;
    for (slot, histogram) in insert_cost.iter_mut().zip(histograms) {
        *slot = fast_log2(histogram.total_count as u32 as usize);
    }
    for i in (0..N).rev() {
        for (j, histogram) in histograms.iter().enumerate() {
            let value = insert_cost.at(j)? - bit_cost(histogram.data.at(i)? as usize);
            insert_cost.put(i * num_histograms + j, value)?;
        }
    }

    // After each step `cost[k]` is how much more it costs to get to the current position with histogram `k` in use than
    // in the cheapest way. It is capped at the cost of a switch, and where it reaches that, the way back from the end
    // switches.
    let cost = cost.sub_mut(..num_histograms)?;
    cost.fill(0.0);
    let switch_signal = switch_signal.sub_mut(..length * bitmap_len)?;
    for (((byte_ix, &symbol), signal), id) in data
        .iter()
        .enumerate()
        .zip(switch_signal.chunks_exact_mut(bitmap_len))
        .zip(block_id.iter_mut())
    {
        let insert_cost_ix = symbol.into() * num_histograms;
        let mut min_cost = 1e99;
        let mut block_switch_cost = block_switch_bitcost;
        let mut min_id = *id;
        for (k, (cost, &insert_cost)) in cost
            .iter_mut()
            .zip(insert_cost.sub(insert_cost_ix..insert_cost_ix + num_histograms)?)
            .enumerate()
        {
            *cost += insert_cost;
            if *cost < min_cost {
                min_cost = *cost;
                min_id = k as u8;
            }
        }
        *id = min_id;
        // More blocks at the beginning.
        if byte_ix < PROLOGUE_LENGTH {
            block_switch_cost *= 0.77 + MULTIPLIER * byte_ix as f64;
        }
        let (groups, rest) = cost.as_chunks_mut::<8>();
        let mut signal = signal.iter_mut();
        for (costs, signal) in groups.iter_mut().zip(&mut signal) {
            *signal = cap_costs(costs, min_cost, block_switch_cost);
        }
        if let Some(signal) = signal.next() {
            *signal = cap_costs(rest, min_cost, block_switch_cost);
        }
    }

    // Go back from the end and switch at the marked places.
    let mut byte_ix = length.checked_sub(1).ok_or(Bug)?;
    let mut ix = byte_ix * bitmap_len;
    let mut cur_id = block_id.at(byte_ix)?;
    while byte_ix > 0 {
        let mask = 1u8 << (cur_id & 7);
        byte_ix -= 1;
        ix -= bitmap_len;
        if switch_signal.at(ix + usize::from(cur_id >> 3))? & mask != 0 {
            let id = block_id.at(byte_ix)?;
            if cur_id != id {
                cur_id = id;
                num_blocks += 1;
            }
        }
        block_id.put(byte_ix, cur_id)?;
    }
    Ok(num_blocks)
}

/// Numbers the ids in use in the order of their first use, and returns how many there are.
fn remap_block_ids(block_ids: &mut [u8], new_id: &mut [u16]) -> Checked<usize> {
    const INVALID_ID: u16 = 256;
    let mut next_id = 0u16;
    new_id.fill(INVALID_ID);
    for &id in block_ids.iter() {
        let new_id = new_id.at_mut(usize::from(id))?;
        if *new_id == INVALID_ID {
            *new_id = next_id;
            next_id += 1;
        }
    }
    for id in block_ids {
        *id = new_id.at(usize::from(*id))? as u8;
    }
    Ok(usize::from(next_id))
}

fn build_block_histograms<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    block_ids: &[u8],
    histograms: &mut [Histogram<N>],
) -> Checked {
    for histogram in histograms.iter_mut() {
        histogram.clear();
    }
    for (&symbol, &id) in data.iter().zip(block_ids) {
        histograms.at_mut(usize::from(id))?.add(symbol.into())?;
    }
    Ok(())
}

/// Turns the `num_blocks` runs of equal `block_ids` into a split with a limited number of block types.
fn cluster_blocks<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    num_blocks: usize,
    block_ids: &[u8],
    split: &mut BlockSplit,
) -> Fallible {
    const INVALID_INDEX: u32 = u32::MAX;
    let mut histogram_symbols = try_zeroed::<u32>(num_blocks)?;
    let mut block_lengths = try_zeroed::<u32>(num_blocks)?;
    let mut sizes = [0u32; HISTOGRAMS_PER_BATCH];
    let mut new_clusters = [0u32; HISTOGRAMS_PER_BATCH];
    let mut symbols = [0u32; HISTOGRAMS_PER_BATCH];
    let mut remap = [0u32; HISTOGRAMS_PER_BATCH];
    let expected_num_clusters =
        CLUSTERS_PER_BATCH * (num_blocks + HISTOGRAMS_PER_BATCH - 1) / HISTOGRAMS_PER_BATCH;
    let mut all_histograms = Vec::<Histogram<N>>::new();
    all_histograms
        .try_reserve(expected_num_clusters)
        .map_err(|_| AllocError)?;
    let mut cluster_size = Vec::<u32>::new();
    cluster_size
        .try_reserve(expected_num_clusters)
        .map_err(|_| AllocError)?;
    let mut num_clusters = 0usize;
    let mut histograms = try_vec(Histogram::<N>::new(), num_blocks.min(HISTOGRAMS_PER_BATCH))?;
    let mut max_num_pairs = HISTOGRAMS_PER_BATCH * HISTOGRAMS_PER_BATCH / 2;
    let mut pairs = try_vec(HistogramPair::default(), max_num_pairs + 1)?;
    let mut tmp = try_box(Histogram::<N>::new())?;
    let mut tmp2 = try_box(Histogram::<N>::new())?;

    {
        let mut block_idx = 0usize;
        let mut next_ids = block_ids.iter().skip(1);
        for id in block_ids {
            *block_lengths.at_mut(block_idx)? += 1;
            if next_ids.next() != Some(id) {
                block_idx += 1;
            }
        }
        debug_assert!(block_idx == num_blocks);
    }

    // Cluster the blocks of each batch.
    let mut pos = 0usize;
    for i in (0..num_blocks).step_by(HISTOGRAMS_PER_BATCH) {
        let num_to_combine = (num_blocks - i).min(HISTOGRAMS_PER_BATCH);
        for j in 0..num_to_combine {
            let block_length = block_lengths.at(i + j)? as usize;
            let histogram = histograms.at_mut(j)?;
            histogram.clear();
            histogram.add_vector(data.sub(pos..pos + block_length)?)?;
            pos += block_length;
            histogram.bit_cost = population_cost(histogram)?;
            new_clusters.put(j, j as u32)?;
            symbols.put(j, j as u32)?;
            sizes.put(j, 1)?;
        }
        let num_new_clusters = histogram_combine(
            &mut histograms,
            &mut tmp,
            &mut sizes,
            &mut symbols,
            &mut new_clusters,
            &mut pairs,
            num_to_combine,
            num_to_combine,
            HISTOGRAMS_PER_BATCH,
            max_num_pairs,
        )?;
        all_histograms
            .try_reserve(num_new_clusters)
            .map_err(|_| AllocError)?;
        cluster_size
            .try_reserve(num_new_clusters)
            .map_err(|_| AllocError)?;
        for (j, &cluster) in new_clusters.sub(..num_new_clusters)?.iter().enumerate() {
            all_histograms.push(histograms.get(cluster as usize).ok_or(Bug)?.clone());
            cluster_size.push(sizes.at(cluster as usize)?);
            remap.put(cluster as usize, j as u32)?;
        }
        for (j, &symbol) in symbols.sub(..num_to_combine)?.iter().enumerate() {
            histogram_symbols.put(i + j, num_clusters as u32 + remap.at(symbol as usize)?)?;
        }
        num_clusters += num_new_clusters;
    }
    drop(histograms);

    // Cluster the clusters of all batches.
    max_num_pairs = (64 * num_clusters).min((num_clusters / 2) * num_clusters);
    if pairs.len() < max_num_pairs + 1 {
        drop(pairs);
        pairs = try_vec(HistogramPair::default(), max_num_pairs + 1)?;
    }
    let mut clusters = Vec::new();
    clusters
        .try_reserve_exact(num_clusters)
        .map_err(|_| AllocError)?;
    clusters.extend(0..num_clusters as u32);
    let num_final_clusters = histogram_combine(
        &mut all_histograms,
        &mut tmp,
        &mut cluster_size,
        &mut histogram_symbols,
        &mut clusters,
        &mut pairs,
        num_clusters,
        num_blocks,
        MAX_NUMBER_OF_BLOCK_TYPES,
        max_num_pairs,
    )?;
    drop(pairs);
    drop(cluster_size);

    // Find the best of the final clusters for each block. Of equally good ones, the one last used is preferred.
    let mut new_index = try_vec(INVALID_INDEX, num_clusters)?;
    let clusters = clusters.sub(..num_final_clusters)?;
    pos = 0;
    let mut next_index = 0u32;
    for i in 0..num_blocks {
        let block_length = block_lengths.at(i)? as usize;
        tmp.clear();
        tmp.add_vector(data.sub(pos..pos + block_length)?)?;
        pos += block_length;
        let mut best_out = histogram_symbols.at(i.saturating_sub(1))?;
        let mut best_bits = histogram_bit_cost_distance(
            &tmp,
            all_histograms.get(best_out as usize).ok_or(Bug)?,
            &mut tmp2,
        )?;
        for &cluster in clusters {
            let cur_bits = histogram_bit_cost_distance(
                &tmp,
                all_histograms.get(cluster as usize).ok_or(Bug)?,
                &mut tmp2,
            )?;
            if cur_bits < best_bits {
                best_bits = cur_bits;
                best_out = cluster;
            }
        }
        histogram_symbols.put(i, best_out)?;
        let index = new_index.at_mut(best_out as usize)?;
        if *index == INVALID_INDEX {
            *index = next_index;
            next_index += 1;
        }
    }
    drop(all_histograms);
    split.ensure_capacity(num_blocks)?;

    // Neighbors that ended up in the same cluster become one block.
    let mut cur_length = 0u32;
    let mut block_idx = 0usize;
    let mut max_type = 0u8;
    for i in 0..num_blocks {
        cur_length = cur_length.wrapping_add(block_lengths.at(i)?);
        let symbol = histogram_symbols.at(i)?;
        if i + 1 == num_blocks || symbol != histogram_symbols.at(i + 1)? {
            let id = new_index.at(symbol as usize)? as u8;
            split.types.put(block_idx, id)?;
            split.lengths.put(block_idx, cur_length)?;
            max_type = max_type.max(id);
            cur_length = 0;
            block_idx += 1;
        }
    }
    split.num_blocks = block_idx;
    split.num_types = usize::from(max_type) + 1;
    Ok(())
}

/// Splits `data` into blocks. `max_histograms` is less than the format allows, to leave some for the contexts, which
/// are not taken into account here.
fn split_byte_vector<T: Copy + Into<usize>, const N: usize>(
    data: &[T],
    symbols_per_histogram: usize,
    max_histograms: usize,
    sampling_stride_length: usize,
    block_switch_cost: f64,
    params: &EncoderParams,
    split: &mut BlockSplit,
) -> Fallible {
    let length = data.len();
    let mut num_histograms = (length / symbols_per_histogram + 1).min(max_histograms);

    if length == 0 {
        split.num_types = 1;
        return Ok(());
    }

    if length < MIN_LENGTH_FOR_BLOCK_SPLITTING {
        return split.add_only_block(length);
    }

    let mut histograms = try_vec(Histogram::<N>::new(), num_histograms)?;
    initial_entropy_codes(data, sampling_stride_length, &mut histograms)?;
    refine_entropy_codes(data, sampling_stride_length, &mut histograms)?;

    let mut block_ids = try_zeroed::<u8>(length)?;
    let mut num_blocks = 0usize;
    let bitmaplen = (num_histograms + 7) >> 3;
    let mut insert_cost = try_zeroed::<f64>(N * num_histograms)?;
    let mut cost = try_zeroed::<f64>(num_histograms)?;
    let mut switch_signal = try_zeroed::<u8>(length * bitmaplen)?;
    let mut new_id = try_zeroed::<u16>(num_histograms)?;
    let iters = if params.quality < HQ_ZOPFLIFICATION_QUALITY {
        3
    } else {
        10
    };
    for _ in 0..iters {
        num_blocks = find_blocks(
            data,
            block_switch_cost,
            histograms.sub(..num_histograms)?,
            &mut insert_cost,
            &mut cost,
            &mut switch_signal,
            &mut block_ids,
        )?;
        num_histograms = remap_block_ids(&mut block_ids, new_id.sub_mut(..num_histograms)?)?;
        build_block_histograms(data, &block_ids, histograms.sub_mut(..num_histograms)?)?;
    }
    drop(insert_cost);
    drop(cost);
    drop(switch_signal);
    drop(new_id);
    drop(histograms);
    cluster_blocks::<T, N>(data, num_blocks, &block_ids, split)
}

/// Splits the literals, the command symbols and the distance symbols of `cmds` into blocks. `data` is a ring buffer of
/// `mask + 1` bytes and the literals start at `offset`.
pub(crate) fn split_block(
    cmds: &[Command],
    data: &[u8],
    offset: usize,
    mask: usize,
    params: &EncoderParams,
    literal_split: &mut BlockSplit,
    insert_and_copy_split: &mut BlockSplit,
    dist_split: &mut BlockSplit,
) -> Fallible {
    {
        let mut literals = Vec::new();
        literals
            .try_reserve_exact(count_literals(cmds))
            .map_err(|_| AllocError)?;
        copy_literals_to_byte_array(cmds, data, offset, mask, &mut literals)?;
        split_byte_vector::<u8, NUM_LITERAL_SYMBOLS>(
            &literals,
            SYMBOLS_PER_LITERAL_HISTOGRAM,
            MAX_LITERAL_HISTOGRAMS,
            LITERAL_STRIDE_LENGTH,
            LITERAL_BLOCK_SWITCH_COST,
            params,
            literal_split,
        )?;
    }

    {
        let mut insert_and_copy_codes = Vec::new();
        insert_and_copy_codes
            .try_reserve_exact(cmds.len())
            .map_err(|_| AllocError)?;
        insert_and_copy_codes.extend(cmds.iter().map(|cmd| cmd.cmd_prefix));
        split_byte_vector::<u16, NUM_COMMAND_SYMBOLS>(
            &insert_and_copy_codes,
            SYMBOLS_PER_COMMAND_HISTOGRAM,
            MAX_COMMAND_HISTOGRAMS,
            COMMAND_STRIDE_LENGTH,
            COMMAND_BLOCK_SWITCH_COST,
            params,
            insert_and_copy_split,
        )?;
    }

    {
        let mut distance_prefixes = Vec::new();
        distance_prefixes
            .try_reserve_exact(cmds.len())
            .map_err(|_| AllocError)?;
        distance_prefixes.extend(
            cmds.iter()
                .filter(|cmd| cmd.has_distance_symbol())
                .map(|cmd| cmd.dist_prefix.symbol() as u16),
        );
        split_byte_vector::<u16, NUM_HISTOGRAM_DISTANCE_SYMBOLS>(
            &distance_prefixes,
            SYMBOLS_PER_DISTANCE_HISTOGRAM,
            MAX_COMMAND_HISTOGRAMS,
            DISTANCE_STRIDE_LENGTH,
            DISTANCE_BLOCK_SWITCH_COST,
            params,
            dist_split,
        )?;
    }
    Ok(())
}
