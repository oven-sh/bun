//! Merges histograms that are alike.

use super::histogram::Histogram;
use super::log2::fast_log2;
use super::symbol_set::SymbolSet;
use crate::memory::{self, Result};

pub(super) const BATCH: usize = 64;

#[derive(Clone, Copy)]
pub(super) struct Cluster<const N: usize> {
    histogram: Histogram<N>,
    used: SymbolSet,
    cost: f64,
    /// How many histograms went into it.
    size: u32,
}

impl<const N: usize> Cluster<N> {
    pub(super) fn new(histogram: &Histogram<N>) -> Self {
        Self {
            histogram: *histogram,
            used: histogram.used(),
            cost: histogram.cost(),
            size: 1,
        }
    }
}

/// From the high bits: the change in cost (64 bits that sort like it), `second - first` (32 bits), and `first`.
#[derive(Clone, Copy)]
struct Pair(u128);

impl Pair {
    const SIGN: u64 = 1 << 63;

    fn new(first: u32, second: u32, cost_change: f64) -> Self {
        // Adding zero takes the sign off a negative zero.
        let bits = (cost_change + 0.0).to_bits();
        let sorted = if bits >= Self::SIGN {
            !bits
        } else {
            bits | Self::SIGN
        };
        let clusters = (u64::from(second - first) << 32) | u64::from(first);
        Self((u128::from(sorted) << 64) | u128::from(clusters))
    }

    #[inline(always)]
    fn clusters(self) -> [u32; 2] {
        [self.0 as u32, self.0 as u32 + (self.0 >> 32) as u32]
    }

    fn cost_change(self) -> f64 {
        let sorted = (self.0 >> 64) as u64;
        f64::from_bits(if sorted >= Self::SIGN {
            sorted ^ Self::SIGN
        } else {
            !sorted
        })
    }

    #[inline(always)]
    fn is_worse_than(self, other: Self) -> bool {
        self.0 & !u128::from(u32::MAX) > other.0
    }
}

fn combined_cost<const N: usize>(a: &Cluster<N>, b: &Cluster<N>) -> f64 {
    if a.histogram.total == 0 {
        b.cost
    } else if b.histogram.total == 0 {
        a.cost
    } else {
        a.histogram.cost_with(&b.histogram, &a.used.union(&b.used))
    }
}

#[derive(Default)]
pub(super) struct Combiner {
    /// The best one comes first.
    pairs: Vec<Pair>,
    max_pairs: usize,
}

impl Combiner {
    fn consider<const N: usize>(&mut self, clusters: &[Cluster<N>], a: u32, b: u32) {
        if a == b {
            return;
        }
        let (first, second) = (a.min(b), a.max(b));
        let (a, b) = (&clusters[first as usize], &clusters[second as usize]);
        let weigh = |size: u32| f64::from(size) * fast_log2(size as usize);
        let cost_change =
            0.5 * (weigh(a.size) + weigh(b.size) - weigh(a.size + b.size)) - a.cost - b.cost;
        let cost = combined_cost(a, b);
        if a.histogram.total != 0 && b.histogram.total != 0 {
            let best = self.pairs.first();
            let threshold = best.map_or(1e99, |best| best.cost_change().max(0.0));
            if cost >= threshold - cost_change {
                return;
            }
        }
        let mut pair = Pair::new(first, second, cost_change + cost);
        if let Some(best) = self.pairs.first_mut()
            && best.is_worse_than(pair)
        {
            core::mem::swap(best, &mut pair);
        }
        if self.pairs.len() < self.max_pairs {
            self.pairs.push(pair);
        }
    }

    /// Merges while that saves bits or there are too many. Returns how many are left at the start of `live`.
    pub(super) fn combine<const N: usize>(
        &mut self,
        clusters: &mut [Cluster<N>],
        assignments: &mut [u32],
        live: &mut [u32],
        max_clusters: usize,
    ) -> Result<usize> {
        let mut count = live.len();
        self.max_pairs = (BATCH * count).min((count / 2) * count);
        self.pairs.clear();
        memory::try_reserve(&mut self.pairs, self.max_pairs)?;
        for (i, &a) in live.iter().enumerate() {
            for &b in &live[i + 1..] {
                self.consider(clusters, a, b);
            }
        }

        let mut threshold = 0.0;
        let mut min_clusters = 1;
        while count > min_clusters {
            if self.pairs[0].cost_change() >= threshold {
                threshold = 1e99;
                min_clusters = max_clusters;
                continue;
            }
            let [first, second] = self.pairs[0].clusters();
            let (head, tail) = clusters.split_at_mut(second as usize);
            let (kept, merged) = (&mut head[first as usize], &tail[0]);
            kept.cost = combined_cost(kept, merged);
            kept.histogram.merge(&merged.histogram);
            kept.used = kept.used.union(&merged.used);
            kept.size += merged.size;
            // An unconditional store becomes vector instructions.
            for assignment in assignments.iter_mut() {
                *assignment = if *assignment == second {
                    first
                } else {
                    *assignment
                };
            }
            if let Some(at) = live[..count].iter().position(|&id| id == second) {
                live.copy_within(at + 1..count, at);
            }
            count -= 1;

            self.remove_pairs_with(first, second);
            for &other in &live[..count] {
                self.consider(clusters, first, other);
            }
        }
        Ok(count)
    }

    fn remove_pairs_with(&mut self, a: u32, b: u32) {
        let pairs = &mut *self.pairs;
        let mut best = Pair(u128::MAX);
        let mut kept = 0;
        for i in 0..pairs.len() {
            let pair = pairs[i];
            let [first, second] = pair.clusters();
            let keep = (first != a) & (first != b) & (second != a) & (second != b);
            pairs[kept] = pair;
            if best.is_worse_than(pair) {
                core::hint::cold_path();
                if keep {
                    pairs[kept] = core::mem::replace(&mut best, pair);
                }
            }
            kept += usize::from(keep);
        }
        pairs[0] = best;
        self.pairs.truncate(kept);
    }
}

/// The cluster that takes `histogram` for the fewest bits, and `preferred` among equals.
pub(super) fn closest<const N: usize>(
    histogram: &Histogram<N>,
    clusters: &[Cluster<N>],
    live: &[u32],
    preferred: u32,
) -> u32 {
    if histogram.total == 0 {
        return preferred;
    }
    let used = histogram.used();
    let added_cost = |id: u32| {
        let cluster = &clusters[id as usize];
        histogram.cost_with(&cluster.histogram, &used.union(&cluster.used)) - cluster.cost
    };
    let mut best = (preferred, added_cost(preferred));
    for &id in live.iter().filter(|&&id| id != preferred) {
        let cost = added_cost(id);
        if cost < best.1 {
            best = (id, cost);
        }
    }
    best.0
}

/// Numbers the values of `assignments`, which are below `limit`, in the order they appear. Returns how many there are.
pub(super) fn renumber(assignments: &mut [u32], limit: usize) -> Result<usize> {
    let mut new_ids = memory::filled(u32::MAX, limit)?;
    let mut count = 0;
    for assignment in assignments {
        let id = &mut new_ids[*assignment as usize];
        if *id == u32::MAX {
            *id = count;
            count += 1;
        }
        *assignment = *id;
    }
    Ok(count as usize)
}

/// Returns up to `max_clusters` histograms, and which of them each of `histograms` went into.
pub(super) fn cluster_histograms<const N: usize>(
    histograms: &[Histogram<N>],
    max_clusters: usize,
) -> Result<(Vec<Histogram<N>>, Vec<u32>)> {
    let mut clusters = memory::collected(histograms.iter().map(Cluster::new))?;
    let mut assignments = memory::collected(0..histograms.len() as u32)?;
    let mut live = memory::empty(histograms.len())?;
    let mut combiner = Combiner::default();
    for (batch, assignments) in assignments.chunks_mut(BATCH).enumerate() {
        let start = live.len();
        let first = (batch * BATCH) as u32;
        live.extend(first..first + assignments.len() as u32);
        let left =
            combiner.combine(&mut clusters, assignments, &mut live[start..], max_clusters)?;
        live.truncate(start + left);
    }
    let left = combiner.combine(&mut clusters, &mut assignments, &mut live, max_clusters)?;
    live.truncate(left);

    let mut previous = assignments[0];
    for (assignment, histogram) in assignments.iter_mut().zip(histograms) {
        previous = closest(histogram, &clusters, &live, previous);
        *assignment = previous;
    }
    drop(clusters);
    let count = renumber(&mut assignments, histograms.len())?;
    let mut merged = memory::filled(Histogram::EMPTY, count)?;
    for (&assignment, histogram) in assignments.iter().zip(histograms) {
        merged[assignment as usize].merge(histogram);
    }
    Ok((merged, assignments))
}
