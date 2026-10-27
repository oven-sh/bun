//! Merging similar histograms, so that fewer prefix codes have to be stored.

use super::Fallible;
use super::bit_cost::population_cost;
use super::fast_log::fast_log2;
use super::histogram::Histogram;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_box, try_vec, try_zeroed};

/// Two clusters that could be merged.
#[derive(Clone, Copy, Default)]
pub(crate) struct HistogramPair {
    idx1: u32,
    idx2: u32,
    /// The cost of the merged histogram.
    cost_combo: f64,
    /// How many bits merging costs. The lower, the better.
    cost_diff: f64,
}

/// Whether `p2` is the better pair to merge.
#[inline(always)]
fn histogram_pair_is_less(p1: &HistogramPair, p2: &HistogramPair) -> bool {
    if p1.cost_diff != p2.cost_diff {
        return p1.cost_diff > p2.cost_diff;
    }
    p1.idx2.wrapping_sub(p1.idx1) > p2.idx2.wrapping_sub(p2.idx1)
}

/// How much the entropy of the context map goes down when two clusters are merged.
#[inline(always)]
fn cluster_cost_diff(size_a: usize, size_b: usize) -> f64 {
    let size_c = size_a + size_b;
    size_a as f64 * fast_log2(size_a) + size_b as f64 * fast_log2(size_b)
        - size_c as f64 * fast_log2(size_c)
}

/// `*dst = *src`, without a copy on the stack.
#[inline(always)]
pub(crate) fn copy_histogram<const N: usize>(dst: &mut Histogram<N>, src: &Histogram<N>) {
    dst.data = src.data;
    dst.total_count = src.total_count;
    dst.bit_cost = src.bit_cost;
}

/// Puts the pair `(idx1, idx2)` in the queue `pairs` if merging `out[idx1]` and `out[idx2]` is cheap enough. The best
/// pair of the queue is its first, the others are in no particular order.
fn compare_and_push_to_queue<const N: usize>(
    out: &[Histogram<N>],
    tmp: &mut Histogram<N>,
    cluster_size: &[u32],
    mut idx1: u32,
    mut idx2: u32,
    max_num_pairs: usize,
    pairs: &mut [HistogramPair],
    num_pairs: &mut usize,
) -> Checked {
    if idx1 == idx2 {
        return Ok(());
    }
    if idx2 < idx1 {
        core::mem::swap(&mut idx1, &mut idx2);
    }
    let out1 = out.get(idx1 as usize).ok_or(Bug)?;
    let out2 = out.get(idx2 as usize).ok_or(Bug)?;
    let mut p = HistogramPair {
        idx1,
        idx2,
        cost_combo: 0.0,
        cost_diff: 0.0,
    };
    p.cost_diff = 0.5
        * cluster_cost_diff(
            cluster_size.at(idx1 as usize)? as usize,
            cluster_size.at(idx2 as usize)? as usize,
        );
    p.cost_diff -= out1.bit_cost;
    p.cost_diff -= out2.bit_cost;

    let mut is_good_pair = false;
    if out1.total_count == 0 {
        p.cost_combo = out2.bit_cost;
        is_good_pair = true;
    } else if out2.total_count == 0 {
        p.cost_combo = out1.bit_cost;
        is_good_pair = true;
    } else {
        let threshold = if *num_pairs == 0 {
            1e99
        } else {
            let best = pairs.at(0)?.cost_diff;
            if 0.0 > best { 0.0 } else { best }
        };
        copy_histogram(tmp, out1);
        tmp.add_histogram(out2);
        let cost_combo = population_cost(tmp)?;
        if cost_combo < threshold - p.cost_diff {
            p.cost_combo = cost_combo;
            is_good_pair = true;
        }
    }
    if !is_good_pair {
        return Ok(());
    }

    p.cost_diff += p.cost_combo;
    if *num_pairs > 0 && histogram_pair_is_less(&pairs.at(0)?, &p) {
        // The new pair is the best one. When the queue is full, the one that was is forgotten.
        if *num_pairs < max_num_pairs {
            pairs.put(*num_pairs, pairs.at(0)?)?;
            *num_pairs += 1;
        }
        pairs.put(0, p)?;
    } else if *num_pairs < max_num_pairs {
        pairs.put(*num_pairs, p)?;
        *num_pairs += 1;
    }
    Ok(())
}

/// Merges the clusters `clusters[..num_clusters]`, which are indexes into `out` and `cluster_size`, for as long as that
/// saves bits, and then until there are no more than `max_clusters`. Returns how many are left at the start of
/// `clusters`, and updates the indexes in `symbols[..symbols_size]`. `pairs` has room for `max_num_pairs + 1`.
pub(crate) fn histogram_combine<const N: usize>(
    out: &mut [Histogram<N>],
    tmp: &mut Histogram<N>,
    cluster_size: &mut [u32],
    symbols: &mut [u32],
    clusters: &mut [u32],
    pairs: &mut [HistogramPair],
    mut num_clusters: usize,
    symbols_size: usize,
    max_clusters: usize,
    max_num_pairs: usize,
) -> Checked<usize> {
    let mut cost_diff_threshold = 0.0;
    let mut min_cluster_size = 1usize;
    let mut num_pairs = 0usize;

    for idx1 in 0..num_clusters {
        for idx2 in idx1 + 1..num_clusters {
            compare_and_push_to_queue(
                out,
                tmp,
                cluster_size,
                clusters.at(idx1)?,
                clusters.at(idx2)?,
                max_num_pairs,
                pairs,
                &mut num_pairs,
            )?;
        }
    }

    while num_clusters > min_cluster_size {
        let best = pairs.at(0)?;
        if best.cost_diff >= cost_diff_threshold {
            cost_diff_threshold = 1e99;
            min_cluster_size = max_clusters;
            continue;
        }
        let best_idx1 = best.idx1;
        let best_idx2 = best.idx2;
        {
            // `idx1 < idx2` in every pair.
            let (head, tail) = out.split_at_mut_checked(best_idx2 as usize).ok_or(Bug)?;
            let out1 = head.at_mut(best_idx1 as usize)?;
            out1.add_histogram(tail.first().ok_or(Bug)?);
            out1.bit_cost = best.cost_combo;
        }
        let size2 = cluster_size.at(best_idx2 as usize)?;
        let size1 = cluster_size.at_mut(best_idx1 as usize)?;
        *size1 = size1.wrapping_add(size2);
        for symbol in symbols.sub_mut(..symbols_size)? {
            if *symbol == best_idx2 {
                *symbol = best_idx1;
            }
        }
        if let Some(i) = clusters
            .sub(..num_clusters)?
            .iter()
            .position(|&cluster| cluster == best_idx2)
        {
            clusters.move_within(i + 1, i, num_clusters - i - 1)?;
        }
        num_clusters -= 1;

        // Drop the pairs with either of the two clusters.
        let mut copy_to_idx = 0usize;
        for i in 0..num_pairs {
            let p = pairs.at(i)?;
            if p.idx1 == best_idx1
                || p.idx2 == best_idx1
                || p.idx1 == best_idx2
                || p.idx2 == best_idx2
            {
                continue;
            }
            let front = pairs.at(0)?;
            if histogram_pair_is_less(&front, &p) {
                pairs.put(0, p)?;
                pairs.put(copy_to_idx, front)?;
            } else {
                pairs.put(copy_to_idx, p)?;
            }
            copy_to_idx += 1;
        }
        num_pairs = copy_to_idx;

        // Add the pairs with the merged cluster.
        for i in 0..num_clusters {
            compare_and_push_to_queue(
                out,
                tmp,
                cluster_size,
                best_idx1,
                clusters.at(i)?,
                max_num_pairs,
                pairs,
                &mut num_pairs,
            )?;
        }
    }
    Ok(num_clusters)
}

/// How many bits it costs to add `histogram` to the cluster `candidate`.
pub(crate) fn histogram_bit_cost_distance<const N: usize>(
    histogram: &Histogram<N>,
    candidate: &Histogram<N>,
    tmp: &mut Histogram<N>,
) -> Checked<f64> {
    if histogram.total_count == 0 {
        return Ok(0.0);
    }
    copy_histogram(tmp, histogram);
    tmp.add_histogram(candidate);
    Ok(population_cost(tmp)? - candidate.bit_cost)
}

/// Stores in `symbols` the best of the clusters `clusters`, which are indexes into `out`, for each histogram of
/// `input`, and computes those clusters anew. Their `bit_cost` has to be up to date, and is not afterwards.
fn histogram_remap<const N: usize>(
    input: &[Histogram<N>],
    clusters: &[u32],
    out: &mut [Histogram<N>],
    tmp: &mut Histogram<N>,
    symbols: &mut [u32],
) -> Checked {
    for (i, histogram) in input.iter().enumerate() {
        let mut best_out = symbols.at(i.saturating_sub(1))?;
        let mut best_bits =
            histogram_bit_cost_distance(histogram, out.get(best_out as usize).ok_or(Bug)?, tmp)?;
        for &cluster in clusters {
            let cur_bits =
                histogram_bit_cost_distance(histogram, out.get(cluster as usize).ok_or(Bug)?, tmp)?;
            if cur_bits < best_bits {
                best_bits = cur_bits;
                best_out = cluster;
            }
        }
        symbols.put(i, best_out)?;
    }

    for &cluster in clusters {
        out.at_mut(cluster as usize)?.clear();
    }
    for (histogram, &symbol) in input.iter().zip(symbols.iter()) {
        out.at_mut(symbol as usize)?.add_histogram(histogram);
    }
    Ok(())
}

/// Numbers the histograms of `out` that `symbols` refers to in the order of their first use, moves them to the start of
/// `out` in that order, and returns how many there are. `out` is at least as long as `symbols`.
fn histogram_reindex<const N: usize>(
    out: &mut [Histogram<N>],
    symbols: &mut [u32],
) -> Fallible<usize> {
    const INVALID_INDEX: u32 = u32::MAX;
    let mut new_index = try_vec(INVALID_INDEX, symbols.len())?;
    let mut next_index = 0u32;
    for &symbol in symbols.iter() {
        let index = new_index.at_mut(symbol as usize)?;
        if *index == INVALID_INDEX {
            *index = next_index;
            next_index += 1;
        }
    }
    let mut tmp = Vec::new();
    tmp.try_reserve_exact(next_index as usize)
        .map_err(|_| OutOfMemory)?;
    for symbol in symbols.iter_mut() {
        let index = new_index.at(*symbol as usize)?;
        if index as usize == tmp.len() {
            tmp.push(out.get(*symbol as usize).ok_or(Bug)?.clone());
        }
        *symbol = index;
    }
    for (to, from) in out.iter_mut().zip(&tmp) {
        copy_histogram(to, from);
    }
    Ok(tmp.len())
}

/// Clusters the histograms of `input` into at most `max_histograms`, which it returns. Stores the index of the cluster
/// of `input[i]` in `histogram_symbols[i]`.
pub(crate) fn cluster_histograms<const N: usize>(
    input: &[Histogram<N>],
    max_histograms: usize,
    histogram_symbols: &mut [u32],
) -> Fallible<Vec<Histogram<N>>> {
    const MAX_INPUT_HISTOGRAMS: usize = 64;
    let in_size = input.len();
    let histogram_symbols = histogram_symbols.sub_mut(..in_size)?;
    let mut cluster_size = try_vec(1u32, in_size)?;
    let mut clusters = try_zeroed::<u32>(in_size)?;
    let mut num_clusters = 0usize;
    // In the first pass all pairs are allowed.
    let pairs_capacity = MAX_INPUT_HISTOGRAMS * MAX_INPUT_HISTOGRAMS / 2;
    let mut pairs = try_vec(HistogramPair::default(), pairs_capacity + 1)?;
    let mut tmp = try_box(Histogram::new())?;

    let mut out = Vec::new();
    out.try_reserve_exact(in_size).map_err(|_| OutOfMemory)?;
    out.extend_from_slice(input);
    for (i, (histogram, symbol)) in out.iter_mut().zip(histogram_symbols.iter_mut()).enumerate() {
        histogram.bit_cost = population_cost(histogram)?;
        *symbol = i as u32;
    }

    for i in (0..in_size).step_by(MAX_INPUT_HISTOGRAMS) {
        let num_to_combine = (in_size - i).min(MAX_INPUT_HISTOGRAMS);
        let new_clusters = clusters.sub_mut(num_clusters..)?;
        for (j, cluster) in new_clusters.iter_mut().take(num_to_combine).enumerate() {
            *cluster = (i + j) as u32;
        }
        num_clusters += histogram_combine(
            &mut out,
            &mut tmp,
            &mut cluster_size,
            histogram_symbols.sub_mut(i..)?,
            new_clusters,
            &mut pairs,
            num_to_combine,
            num_to_combine,
            max_histograms,
            pairs_capacity,
        )?;
    }

    // In the second pass the number of pairs is limited. Once it is reached, only the best pair is kept up to date.
    let max_num_pairs = (64 * num_clusters).min((num_clusters / 2) * num_clusters);
    if pairs.len() < max_num_pairs + 1 {
        pairs
            .try_reserve_exact(max_num_pairs + 1 - pairs.len())
            .map_err(|_| OutOfMemory)?;
        pairs.resize(max_num_pairs + 1, HistogramPair::default());
    }
    num_clusters = histogram_combine(
        &mut out,
        &mut tmp,
        &mut cluster_size,
        histogram_symbols,
        &mut clusters,
        &mut pairs,
        num_clusters,
        in_size,
        max_histograms,
        max_num_pairs,
    )?;
    drop(pairs);
    drop(cluster_size);
    histogram_remap(
        input,
        clusters.sub(..num_clusters)?,
        &mut out,
        &mut tmp,
        histogram_symbols,
    )?;
    drop(clusters);
    let out_size = histogram_reindex(&mut out, histogram_symbols)?;
    out.truncate(out_size);
    Ok(out)
}
