//! Merges histograms that are alike.

use core::ops::RangeInclusive;

use bun_highway::brotli::{PAIR_GROUP, remove_pairs};

use super::histogram::{Estimator, Histogram, Indexed, IndexedList};
use super::log2::fast_log2;
use crate::memory::{self, Result};

pub(super) const BATCH: usize = 64;
const LARGE_BATCH: usize = 1024;

/// How many clusters with so many symbols in all get combined at once.
pub(super) fn max_at_once(symbols: usize) -> usize {
    (8 * symbols.isqrt()).clamp(LARGE_BATCH, 8 * LARGE_BATCH)
}

#[derive(Clone, Copy)]
struct Summary {
    cost: f64,
    /// See [`weigh`].
    weight: f64,
    /// How many histograms went into the cluster.
    size: u32,
    is_empty: bool,
}

#[inline(always)]
fn weigh(size: u32) -> f64 {
    f64::from(size) * fast_log2(size as usize)
}

impl Summary {
    /// `together` only counts if neither is empty.
    #[inline(always)]
    fn cost_with(&self, other: &Self, together: f64) -> f64 {
        if self.is_empty {
            other.cost
        } else if other.is_empty {
            self.cost
        } else {
            together
        }
    }
}

pub(super) struct Clusters {
    sums: IndexedList,
    summaries: Vec<Summary>,
}

impl Clusters {
    pub(super) fn new(alphabet_size: usize) -> Self {
        Self {
            sums: IndexedList::new(alphabet_size),
            summaries: Vec::new(),
        }
    }

    pub(super) fn len(&self) -> usize {
        self.summaries.len()
    }

    pub(super) fn clear(&mut self) {
        self.sums.clear();
        self.summaries.clear();
    }

    pub(super) fn try_reserve(&mut self, additional: usize) -> Result<()> {
        self.sums.try_reserve(additional)?;
        memory::try_reserve(&mut self.summaries, additional)
    }

    /// To go through [`Combiner::combine_new`].
    pub(super) fn push_new(&mut self, histogram: &Indexed<'_>) {
        self.sums.push(histogram);
        self.summaries.push(Summary {
            cost: 0.0,
            weight: weigh(1),
            size: 1,
            is_empty: histogram.total == 0,
        });
    }

    pub(super) fn add_from(&mut self, other: &Self, ids: &[u32]) -> Result<()> {
        self.try_reserve(ids.len())?;
        for &id in ids {
            self.sums.push(&other.sums.get(id));
            self.summaries.push(other.summaries[id as usize]);
        }
        Ok(())
    }
}

/// The best one comes first.
#[derive(Default)]
#[cfg_attr(mordant, allow(parallel_vecs))] // `remove_pairs` loads SIMD vectors of each.
struct Pairs {
    cost_changes: Vec<f64>,
    /// In ascending order.
    clusters: Vec<[u32; 2]>,
    count: usize,
    max_count: usize,
}

impl Pairs {
    const NO_LIMIT: f64 = 1e99;

    fn start_over(&mut self, cluster_count: usize) -> Result<()> {
        self.count = 0;
        self.max_count = (BATCH * cluster_count).min((cluster_count / 2) * cluster_count);
        let size = self.max_count + PAIR_GROUP;
        if size > self.clusters.len() {
            self.cost_changes = memory::zeroed(size)?;
            self.clusters = memory::zeroed(size)?;
        }
        (self.cost_changes[0], self.clusters[0]) = (Self::NO_LIMIT, [0; 2]);
        Ok(())
    }

    /// The pairs of `id` and each of `others` that are worth it.
    #[inline(never)]
    fn add(&mut self, id: u32, others: &[u32], summaries: &[Summary], together: &[f64]) {
        let (cost_changes, clusters) = (&mut *self.cost_changes, &mut *self.clusters);
        let mut best = (cost_changes[0], clusters[0]);
        let mut count = self.count;
        let this = summaries[id as usize];
        for &other_id in others.iter().filter(|&&other_id| other_id != id) {
            let other = summaries[other_id as usize];
            let (first, second) = if id < other_id {
                (this.cost, other.cost)
            } else {
                (other.cost, this.cost)
            };
            let weight_change = this.weight + other.weight - weigh(this.size + other.size);
            let without_both = 0.5 * weight_change - first - second;
            let cost = this.cost_with(&other, together[other_id as usize]);
            if !this.is_empty && !other.is_empty && cost >= best.0.max(0.0) - without_both {
                continue;
            }
            let mut pair = (without_both + cost, [id.min(other_id), id.max(other_id)]);
            let apart = |[first, second]: [u32; 2]| second - first;
            if pair.0 <= best.0 && (pair.0 < best.0 || apart(pair.1) < apart(best.1)) {
                core::mem::swap(&mut best, &mut pair);
            }
            (cost_changes[count], clusters[count]) = pair;
            count += usize::from(count < self.max_count);
        }
        (cost_changes[0], clusters[0]) = best;
        self.count = count;
    }

    fn remove_with(&mut self, merged: [u32; 2]) {
        let padded = self.count.next_multiple_of(PAIR_GROUP);
        self.clusters[self.count..padded].fill(merged);
        let (cost_changes, clusters) = (&mut self.cost_changes, &mut self.clusters);
        self.count = remove_pairs(&mut cost_changes[..padded], &mut clusters[..padded], merged);
    }
}

pub(super) struct Combiner {
    estimator: Estimator,
    pairs: Pairs,
    /// What each cluster costs together with what it was compared with last.
    together: Vec<f64>,
    not_empty: Vec<u32>,
}

impl Combiner {
    pub(super) fn new(estimator: Estimator) -> Self {
        Self {
            estimator,
            pairs: Pairs::default(),
            together: Vec::new(),
            not_empty: Vec::new(),
        }
    }

    fn make_room(&mut self, cluster_count: usize) -> Result<()> {
        if cluster_count > self.together.len() {
            self.together = memory::zeroed(cluster_count)?;
            self.not_empty = memory::empty(cluster_count)?;
        }
        Ok(())
    }

    /// [`combine`](Self::combine) for the first time.
    pub(super) fn combine_new(
        &mut self,
        clusters: &mut Clusters,
        live: &mut [u32],
        max_clusters: usize,
    ) -> Result<usize> {
        self.make_room(clusters.len())?;
        let nothing = Indexed::empty(clusters.sums.alphabet_size);
        (self.estimator).set_costs(&nothing, &clusters.sums, live, &mut self.together);
        for &id in &*live {
            clusters.summaries[id as usize].cost = self.together[id as usize];
        }
        self.combine(clusters, live, 1..=max_clusters)
    }

    /// In batches first. Returns those that are left.
    fn combine_all_new(
        &mut self,
        clusters: &mut Clusters,
        symbols: usize,
        max_clusters: usize,
    ) -> Result<Vec<u32>> {
        let mut live = memory::empty(clusters.len())?;
        for first in (0..clusters.len()).step_by(BATCH) {
            let start = live.len();
            live.extend(first as u32..clusters.len().min(first + BATCH) as u32);
            let left = self.combine_new(clusters, &mut live[start..], max_clusters)?;
            live.truncate(start + left);
        }
        while live.len() > max_at_once(symbols) {
            self.halve(clusters, &mut live)?;
        }
        let left = self.combine(clusters, &mut live, 1..=max_clusters)?;
        live.truncate(left);
        Ok(live)
    }

    /// Leaves half of each full [`LARGE_BATCH`]. The first one stays.
    pub(super) fn halve(&mut self, clusters: &mut Clusters, live: &mut Vec<u32>) -> Result<()> {
        const HALF: usize = LARGE_BATCH / 2;
        let mut kept = 0;
        for start in (0..live.len()).step_by(LARGE_BATCH) {
            let end = live.len().min(start + LARGE_BATCH);
            let left = self.combine(clusters, &mut live[start..end], HALF..=HALF)?;
            live.copy_within(start..start + left, kept);
            kept += left;
        }
        live.truncate(kept);
        Ok(())
    }

    /// Merges while there are more than `wanted`, and within it while that saves bits. Returns how many are left at the start of `live`. The first one stays.
    pub(super) fn combine(
        &mut self,
        clusters: &mut Clusters,
        live: &mut [u32],
        wanted: RangeInclusive<usize>,
    ) -> Result<usize> {
        let mut count = live.len();
        self.make_room(clusters.len())?;
        self.pairs.start_over(count)?;
        let Self {
            estimator,
            pairs,
            together,
            not_empty,
        } = self;
        let Clusters { sums, summaries } = clusters;
        not_empty.clear();
        not_empty.extend(live.iter().filter(|&&id| !summaries[id as usize].is_empty));
        let mut later = &not_empty[..];
        for (i, &id) in live.iter().enumerate() {
            if let Some(rest) = later.strip_prefix(&[id]) {
                later = rest;
                estimator.set_costs(&sums.get(id), sums, later, together);
            }
            pairs.add(id, &live[i + 1..], summaries, together);
        }

        let mut threshold = 0.0;
        let mut min_clusters = *wanted.start();
        let mut compared = u32::MAX;
        while count > min_clusters {
            if pairs.cost_changes[0] >= threshold {
                threshold = Pairs::NO_LIMIT;
                min_clusters = *wanted.end();
                continue;
            }
            let [first, second] = pairs.clusters[0];
            let (kept, merged) = (summaries[first as usize], summaries[second as usize]);
            let is_known = compared == first || compared == second;
            let (other_id, other) = if compared == second {
                (first, kept)
            } else {
                (second, merged)
            };
            if !is_known && !kept.is_empty && !merged.is_empty {
                estimator.set_costs(&sums.get(first), sums, &[second], together);
            }
            let is_empty = kept.is_empty && merged.is_empty;
            summaries[first as usize] = Summary {
                cost: kept.cost_with(&merged, together[other_id as usize]),
                weight: weigh(kept.size + merged.size),
                size: kept.size + merged.size,
                is_empty,
            };
            sums.merge([first, second]);
            if let Some(at) = live[..count].iter().position(|&id| id == second) {
                live.copy_within(at + 1..count, at);
            }
            count -= 1;

            if !is_empty {
                not_empty.retain(|&id| id != first && id != second);
                if !is_known || !other.is_empty {
                    estimator.set_costs(&sums.get(first), sums, not_empty, together);
                }
                not_empty.push(first);
            }
            compared = first;
            pairs.remove_with([first, second]);
            pairs.add(first, &live[..count], summaries, together);
        }
        Ok(count)
    }

    /// The cluster that takes `histogram` for the fewest bits, and `preferred` among equals.
    pub(super) fn closest(
        &mut self,
        histogram: &Indexed<'_>,
        clusters: &Clusters,
        live: &[u32],
        preferred: u32,
    ) -> u32 {
        if histogram.total == 0 {
            return preferred;
        }
        (self.estimator).set_costs(histogram, &clusters.sums, live, &mut self.together);
        let added_cost =
            |id: u32| self.together[id as usize] - clusters.summaries[id as usize].cost;
        let mut best = (preferred, added_cost(preferred));
        for &id in live {
            if added_cost(id) < best.1 {
                best = (id, added_cost(id));
            }
        }
        best.0
    }
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
    combiner: &mut Combiner,
) -> Result<(Vec<Histogram<N>>, Vec<u32>)> {
    let indexed = || (histograms.iter()).map(|each| Indexed::new(&each.counts, each.total));
    let mut clusters = Clusters::new(N);
    clusters.try_reserve(histograms.len())?;
    indexed().for_each(|histogram| clusters.push_new(&histogram));
    let symbols = histograms.iter().map(|each| each.total).sum();
    let live = combiner.combine_all_new(&mut clusters, symbols, max_clusters)?;
    let mut previous = 0;
    let mut assignments = memory::collected(indexed().map(|histogram| {
        previous = combiner.closest(&histogram, &clusters, &live, previous);
        previous
    }))?;
    drop(clusters);
    let count = renumber(&mut assignments, histograms.len())?;
    let mut merged = memory::filled(Histogram::EMPTY, count)?;
    for (&assignment, histogram) in assignments.iter().zip(histograms) {
        merged[assignment as usize].merge(histogram);
    }
    Ok((merged, assignments))
}
