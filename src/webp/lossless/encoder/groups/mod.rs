//! Which tiles of an image share their five prefix codes.

mod cluster;
mod tiles;

use self::cluster::{Cluster, Counts};
pub(super) use self::tiles::TileHistograms;
use self::tiles::{Tile, cost};
use super::Quality;
use super::entropy::{Cost, div_round};
use super::histogram::{Alphabet, Histogram};
use crate::array::At;
use crate::error::{Error, Result};
use crate::slice::{InBounds, known};
use crate::vec;

/// Two clusters that cost less as one.
#[derive(Clone, Copy)]
struct Pair {
    low: usize,
    high: usize,
    /// Below zero.
    change: i64,
}

impl Pair {
    fn has(&self, index: usize) -> bool {
        self.low == index || self.high == index
    }

    fn replace(&mut self, old: usize, new: usize) {
        let [a, b] = [self.low, self.high].map(|index| if index == old { new } else { index });
        (self.low, self.high) = (a.min(b), a.max(b));
    }
}

/// The best pair is first.
struct Queue(Vec<Pair>);

impl Queue {
    fn promote(&mut self, index: usize) {
        if let Ok([first, pair]) = self.0.get_disjoint_mut([0, index])
            && pair.change < first.change
        {
            core::mem::swap(first, pair);
        }
    }

    fn push(&mut self, pair: Pair) {
        self.0.push(pair);
        self.promote(self.0.len() - 1);
    }

    /// The last pair takes the place of one that is not kept.
    fn retain(&mut self, mut keep: impl FnMut(&mut Pair) -> bool) {
        let mut index = 0;
        while let Some(pair) = self.0.get_mut(index) {
            if keep(pair) {
                self.promote(index);
                index += 1;
            } else {
                self.0.swap_remove(index);
            }
        }
    }
}

/// For each two ids, whether the clusters are known to cost no less as one.
#[derive(Default)]
struct StayApart {
    ids: usize,
    is_known: Vec<bool>,
}

impl StayApart {
    fn from(&self, id: usize) -> &[bool] {
        let row = self.is_known.get(id * self.ids..(id + 1) * self.ids);
        row.unwrap_or_default()
    }

    fn set(&mut self, a: usize, b: usize, is_known: bool) {
        for index in [a * self.ids + b, b * self.ids + a] {
            self.is_known.set(index, is_known);
        }
    }
}

struct Clusters {
    alphabets: [Alphabet; 5],
    clusters: Vec<Cluster>,
    /// The id of each cluster that is gone, and that of the one it went into.
    merged: Vec<(usize, usize)>,
    stay_apart: StayApart,
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L32
const LEVELS: usize = 4;
const BINS: usize = LEVELS * LEVELS * LEVELS;

/// More clusters than this are a sign of tiles that have little in common, and too many for the CPU's cache.
const MANY: usize = 128;

impl Clusters {
    /// Adds the tiles. Sets the `ids` of their clusters.
    fn fill(&mut self, tiles: &TileHistograms, ids: &mut [u16]) -> Result<()> {
        let mut counts = Counts::empty(&self.alphabets)?;
        let all = tiles.tiles.iter().zip(ids);
        for (tile, id) in all.filter(|(tile, _)| tile.is_used()) {
            *id = self.clusters.len() as u16;
            counts.fill(tile, tiles.entries(tile));
            Cluster::push(&mut self.clusters, &counts, &self.alphabets)?;
            counts.clear(tiles.entries(tile));
        }
        Ok(())
    }

    /// Also merges those whose green, red and blue cost about the same.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L693
    fn fill_by_cost(
        &mut self,
        tiles: &TileHistograms,
        quality: Quality,
        ids: &mut [u16],
    ) -> Result<()> {
        const MAX_REFUSALS: u32 = 32;
        #[derive(Clone, Copy)]
        struct Bin {
            cluster: usize,
            shared_by_literals: Option<[u16; 3]>,
            refusals: u32,
        }

        let all = tiles.tiles.iter().zip(ids);
        let mut used = all.filter(|(tile, _)| tile.is_used());
        let (mut min, mut max) = ([Cost::MAX; 3], [0; 3]);
        for tile in tiles.tiles.iter().filter(|tile| tile.is_used()) {
            for ((min, max), part) in min.iter_mut().zip(&mut max).zip(&tile.parts) {
                (*min, *max) = (part.cost.min(*min), part.cost.max(*max));
            }
        }
        let bin_of = |tile: &Tile| {
            let ranges = min.iter().zip(max).zip(&tile.parts);
            ranges.fold(0, |bin, ((min, max), part)| {
                let level =
                    (LEVELS as f64 - 1e-6) * (part.cost - min) as f64 / (max - min).max(1) as f64;
                bin * LEVELS + level as usize
            })
        };
        // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L1125
        let halved = [256, 512, 1024].map(|many| u32::from(tiles.len() > many));
        let halved = halved.iter().sum::<u32>() + u32::from(quality as u32 <= 50);
        let percent_to_save = 16 >> halved;

        let mut bins: [Option<Bin>; BINS] = [None; BINS];
        let mut candidate = Counts::empty(&self.alphabets)?;
        let mut next = used.next();
        while let Some((tile, id)) = next {
            candidate.fill(tile, tiles.entries(tile));
            *id = self.clusters.len() as u16;
            let shared_by_literals = tile.shared_by_literals;
            let bin = bins.at_mut(bin_of(tile));
            let mut is_merged = false;
            if let Some(bin) = bin
                && let Some(cluster) = known(self.clusters.get_mut(bin.cluster))
            {
                let alone = cost(&tile.parts);
                let to_save = div_round(alone as u64 * percent_to_save, 100) as i64;
                let limit = cost(&cluster.counts.parts) + alone - to_save;
                if bin.shared_by_literals == shared_by_literals || bin.refusals >= MAX_REFUSALS {
                    is_merged = cluster.add(&candidate, &self.alphabets, limit);
                } else {
                    let cost = cluster.cost_with(&candidate, &self.alphabets, limit, false);
                    bin.refusals += u32::from(cost.is_some());
                }
                if is_merged {
                    *id = cluster.id as u16;
                }
            } else {
                *bin = Some(Bin {
                    cluster: self.clusters.len(),
                    shared_by_literals,
                    refusals: 0,
                });
            }
            // The last tile takes the place of one that was merged.
            next = if is_merged {
                used.next_back()
            } else {
                Cluster::push(&mut self.clusters, &candidate, &self.alphabets)?;
                used.next()
            };
            candidate.clear(tiles.entries(tile));
        }
        Ok(())
    }

    /// If merging them changes the total by less than `limit`.
    fn pair(&self, a: usize, b: usize, limit: i64) -> Option<Pair> {
        let (low, high) = (a.min(b), a.max(b));
        let (a, b) = known(self.clusters.get(low).zip(self.clusters.get(high)))?;
        let (a, b) = if a.symbols() > b.symbols() {
            (a, b)
        } else {
            (b, a)
        };
        let apart = cost(&a.counts.parts) + cost(&b.counts.parts);
        let are_many = self.clusters.len() > MANY;
        let change = a.cost_with(&b.counts, &self.alphabets, apart + limit, are_many)? - apart;
        Some(Pair { low, high, change })
    }

    /// Into the first of the two.
    fn merge(&mut self, pair: Pair) {
        let clusters = self.clusters.get_disjoint_mut([pair.low, pair.high]);
        let Some([low, high]) = known(clusters.ok()) else {
            return;
        };
        low.add(&high.counts, &self.alphabets, i64::MAX);
        self.merged.push((high.id, low.id));
        for other in 0..self.stay_apart.ids {
            self.stay_apart.set(low.id, other, false);
        }
    }

    /// The last cluster takes its place.
    fn remove(&mut self, index: usize) {
        known(self.clusters.get(index));
        if let Some(last) = self.clusters.pop()
            && let Some(gone) = self.clusters.get_mut(index)
        {
            *gone = last;
        }
    }

    /// Until there are fewer than `goal`, or it seems to lead nowhere.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L970
    fn merge_random_pairs(&mut self, goal: usize) -> Result<()> {
        const QUEUE_LEN: usize = 9;
        let mut queue = Queue(vec::with_room(QUEUE_LEN)?);
        let mut seed = 1u64;
        let (rounds, mut fruitless_rounds) = (self.clusters.len(), 0);
        self.stay_apart = StayApart {
            ids: rounds,
            is_known: vec::filled(false, rounds * rounds)?,
        };
        for _ in 0..rounds {
            let len = self.clusters.len();
            fruitless_rounds += 1;
            if len < goal || fruitless_rounds >= rounds / 2 {
                break;
            }
            let others = (len - 1).max(1);
            let mut limit = queue.0.first().map_or(0, |best| best.change);
            for _ in 0..len / 2 {
                seed = seed * 48271 % 2_147_483_647;
                let pick = seed as usize % (others * len).max(1);
                let (a, b) = (pick / others, pick % others);
                let b = b + usize::from(b >= a);
                let [id_a, id_b] = [a, b].map(|it| self.clusters.get(it).map_or(0, |it| it.id));
                if self.stay_apart.from(id_a).get(id_b) == Some(&true) {
                    continue;
                }
                if let Some(pair) = self.pair(a, b, limit) {
                    limit = pair.change;
                    queue.push(pair);
                    if queue.0.len() == QUEUE_LEN {
                        break;
                    }
                } else if limit == 0 {
                    self.stay_apart.set(id_a, id_b, true);
                }
            }
            let Some(&best) = queue.0.first() else {
                continue;
            };
            self.merge(best);
            queue.retain(|pair| {
                if pair.has(best.low) && pair.has(best.high) {
                    return false;
                }
                if pair.has(best.low) || pair.has(best.high) {
                    pair.replace(best.high, best.low);
                    let Some(updated) = self.pair(pair.low, pair.high, 0) else {
                        return false;
                    };
                    *pair = updated;
                }
                pair.replace(len - 1, best.high);
                true
            });
            self.remove(best.high);
            fruitless_rounds = 0;
        }
        Ok(())
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L904
    fn merge_best_pairs(&mut self) -> Result<()> {
        let len = self.clusters.len();
        let mut queue = Queue(vec::with_room(len * len)?);
        for a in 0..len {
            let pairs = (a + 1..len).filter_map(|b| self.pair(a, b, 0));
            pairs.for_each(|pair| queue.push(pair));
        }
        while let Some(&best) = queue.0.first() {
            self.merge(best);
            self.remove(best.high);
            let len = self.clusters.len();
            queue.retain(|pair| {
                let is_current = !pair.has(best.low) && !pair.has(best.high);
                pair.replace(len, best.high);
                is_current
            });
            let others = (0..len).filter(|&other| other != best.low);
            let pairs = others.filter_map(|other| self.pair(best.low, other, 0));
            pairs.for_each(|pair| queue.push(pair));
        }
        Ok(())
    }

    /// By id, the index of the cluster or of the one that it has become a part of.
    fn indices(&self) -> Result<Vec<usize>> {
        let mut indices = vec::filled(0, self.clusters.len() + self.merged.len())?;
        for (index, cluster) in self.clusters.iter().enumerate() {
            indices.set(cluster.id, index);
        }
        for &(gone, into) in self.merged.iter().rev() {
            let index = indices.value(into);
            indices.set(gone, index);
        }
        Ok(indices)
    }

    /// Replaces the id of the cluster that each tile went into by the index of the first of those that it adds the least to.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L1078
    fn assign(&self, tiles: &TileHistograms, ids_then_indices: &mut [u16]) -> Result<()> {
        struct Search<'a> {
            counts: Counts,
            /// `None` for a tile that is not used.
            best: Option<usize>,
            least: i64,
            /// By id.
            is_ruled_out: &'a [bool],
        }
        // A cluster serves several tiles while it is in the cache.
        let at_once = self.clusters.len().div_ceil(MANY).max(1);
        let look_at = |search: &mut Search, index: usize, cluster: &Cluster| {
            let alone = cost(&cluster.counts.parts);
            let limit = alone + search.least + i64::from(Some(index) < search.best);
            let cost = cluster.cost_with(&search.counts, &self.alphabets, limit, at_once > 1);
            if let Some(cost) = cost {
                (search.best, search.least) = (Some(index), cost - alone);
            }
        };
        let mut searches = vec::with_room(at_once)?;
        for _ in 0..at_once {
            searches.push(Search {
                counts: Counts::empty(&self.alphabets)?,
                best: None,
                least: 0,
                is_ruled_out: &[],
            });
        }
        let indices = self.indices()?;
        let mut last = 0;
        let batches = tiles.tiles.chunks(at_once);
        for (batch, ids_then_indices) in batches.zip(ids_then_indices.chunks_mut(at_once)) {
            let all = batch.iter().zip(&*ids_then_indices).zip(&mut searches);
            for ((tile, &id), search) in all.filter(|((tile, _), _)| tile.is_used()) {
                // With a good guess, the others are out sooner.
                let guess = indices.value(id.into());
                let cluster = self.clusters.get(guess).ok_or(Error::Internal)?;
                search.counts.fill(tile, tiles.entries(tile));
                search.least = i64::MAX / 2;
                look_at(search, guess, cluster);
                // What stays apart from a cluster of nothing but this tile would get all its cost added.
                let ([own, ..], [all, ..]) = (&tile.parts, &cluster.counts.parts);
                let is_alone = own.population.sum == all.population.sum;
                search.is_ruled_out = if is_alone && search.least < cost(&tile.parts) {
                    self.stay_apart.from(cluster.id)
                } else {
                    &[]
                };
            }
            for (index, cluster) in self.clusters.iter().enumerate() {
                for search in &mut searches {
                    if search.best.is_some_and(|best| best != index)
                        && search.is_ruled_out.get(cluster.id) != Some(&true)
                    {
                        look_at(search, index, cluster);
                    }
                }
            }
            for ((tile, index), search) in batch.iter().zip(ids_then_indices).zip(&mut searches) {
                search.counts.clear(tiles.entries(tile));
                last = search.best.take().unwrap_or(last);
                *index = last as u16;
            }
        }
        Ok(())
    }
}

pub(super) struct Groups {
    /// For each tile an index into `histograms`.
    pub(super) of_tiles: Vec<u16>,
    pub(super) histograms: Vec<Histogram>,
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L1136
pub(super) fn find(tiles: &TileHistograms, quality: Quality) -> Result<Groups> {
    const MAX_FOR_BEST_PAIRS: u64 = 100;
    let mut clusters = Clusters {
        alphabets: tiles.alphabets,
        clusters: vec::with_room(tiles.len())?,
        merged: vec::with_room(tiles.len())?,
        stay_apart: StayApart::default(),
    };
    let mut ids_then_groups = vec::filled(0, tiles.len())?;
    let used = tiles.tiles.iter().filter(|tile| tile.is_used());
    if used.count() > 2 * BINS {
        clusters.fill_by_cost(tiles, quality, &mut ids_then_groups)?;
    } else {
        clusters.fill(tiles, &mut ids_then_groups)?;
    }
    let goal = (quality as u64).pow(3) * (MAX_FOR_BEST_PAIRS - 1);
    let goal = 1 + div_round(goal, 100 * 100 * 100) as usize;
    clusters.merge_random_pairs(goal)?;
    if clusters.clusters.len() <= goal {
        clusters.merge_best_pairs()?;
    }

    if clusters.clusters.len() > 1 {
        clusters.assign(tiles, &mut ids_then_groups)?;
    } else {
        ids_then_groups.fill(0);
    }
    let of_tiles = ids_then_groups;
    drop(clusters);

    let len = of_tiles.iter().max().map_or(0, |&max| usize::from(max) + 1);
    let mut histograms = vec::filled(Histogram::EMPTY, len)?;
    for (tile, &group) in tiles.tiles.iter().zip(&of_tiles) {
        histograms.update(group.into(), |histogram| {
            for entry in tiles.entries(tile) {
                *histogram.counts.at_mut(entry.symbol()) += entry.count();
            }
        });
    }
    Ok(Groups {
        of_tiles,
        histograms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slice::checked;

    #[test]
    fn nothing_comes_of_clusters_that_are_not_there() -> Result<()> {
        let mut tiles = TileHistograms::new(1, 0)?;
        let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
        histogram.add_copy(2, 1);
        tiles.push(histogram)?;
        let mut clusters = Clusters {
            alphabets: tiles.alphabets,
            clusters: Vec::new(),
            merged: Vec::new(),
            stay_apart: StayApart::default(),
        };
        let pair = checked(|| Ok(clusters.pair(0, 1, 0).is_some()));
        assert_eq!(pair, Err(Error::Internal));
        let merged = checked(|| {
            clusters.merge(Pair {
                low: 0,
                high: 1,
                change: -1,
            });
            clusters.remove(1);
            Ok(())
        });
        assert_eq!(merged, Err(Error::Internal));
        assert_eq!(clusters.assign(&tiles, &mut [0]), Err(Error::Internal));
        Ok(())
    }

    #[test]
    fn tiles_share_a_group_if_they_are_alike() -> Result<()> {
        const KINDS: u32 = 300;
        let mut tiles = TileHistograms::new(320, 0)?;
        let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
        for tile in 0..320 {
            (0..1000).for_each(|_| histogram.add_literal((tile % KINDS) << 8));
            tiles.push(histogram)?;
        }
        let groups = find(&tiles, Quality::Picture)?.of_tiles;
        for (a, group_a) in (0..).zip(&groups) {
            for (b, group_b) in (0..).zip(&groups) {
                assert_eq!(group_a == group_b, a % KINDS == b % KINDS);
            }
        }
        Ok(())
    }
}
