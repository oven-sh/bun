//! `backward_references_cost_enc.c`: with the symbol costs of a first LZ77, finds the cheapest way to each pixel.

use super::backward_references::{
    BackwardRefs, HashChain, MAX_LENGTH, PixOrCopy, distance_to_plane_code,
};
use super::histogram::Histogram;
use super::lossless::{LOG_2_PRECISION_BITS, div_round, fast_log2, prefix_encode};
use crate::Result;
use crate::util::{Bug, Checked, SliceExt, try_vec, try_with_capacity};
use crate::vp8l::color_cache::ColorCache;
use crate::vp8l::common::{FIRST_CACHE_CODE, NUM_DISTANCE_CODES, NUM_LITERAL_CODES};

/// What each symbol costs.
struct CostModel {
    alpha: [u32; NUM_LITERAL_CODES],
    red: [u32; NUM_LITERAL_CODES],
    blue: [u32; NUM_LITERAL_CODES],
    distance: [u32; NUM_DISTANCE_CODES],
    literal: Vec<u32>,
}

fn convert_population_count_table_to_bit_estimates(population_counts: &[u32], output: &mut [u32]) {
    let sum: u32 = population_counts.iter().sum();
    let nonzeros = population_counts.iter().filter(|&&count| count > 0).count();
    if nonzeros <= 1 {
        output.fill(0);
    } else {
        let logsum = fast_log2(sum);
        for (output, &count) in output.iter_mut().zip(population_counts) {
            *output = logsum - fast_log2(count);
        }
    }
}

impl CostModel {
    /// `CostModelBuild`
    fn new(width: usize, cache_bits: u32, refs: &BackwardRefs) -> Result<Self> {
        let mut histo = Histogram::new(cache_bits)?;
        histo.store_refs(refs, |distance| distance_to_plane_code(width, distance))?;
        let mut m = Self {
            alpha: [0; NUM_LITERAL_CODES],
            red: [0; NUM_LITERAL_CODES],
            blue: [0; NUM_LITERAL_CODES],
            distance: [0; NUM_DISTANCE_CODES],
            literal: try_vec(0, Histogram::num_codes(cache_bits))?,
        };
        convert_population_count_table_to_bit_estimates(&histo.literal, &mut m.literal);
        convert_population_count_table_to_bit_estimates(&histo.red, &mut m.red);
        convert_population_count_table_to_bit_estimates(&histo.blue, &mut m.blue);
        convert_population_count_table_to_bit_estimates(&histo.alpha, &mut m.alpha);
        convert_population_count_table_to_bit_estimates(&histo.distance, &mut m.distance);
        Ok(m)
    }

    #[inline]
    fn literal_cost(&self, v: u32) -> Checked<i64> {
        let [b, g, r, a] = v.to_le_bytes().map(usize::from);
        Ok(i64::from(self.alpha.at(a)?)
            + i64::from(self.red.at(r)?)
            + i64::from(self.literal.at(g)?)
            + i64::from(self.blue.at(b)?))
    }

    #[inline]
    fn cache_cost(&self, idx: u32) -> Checked<i64> {
        let literal_idx = FIRST_CACHE_CODE + idx as usize;
        Ok(self.literal.at(literal_idx)?.into())
    }

    fn length_cost(&self, length: u32) -> Checked<i64> {
        let prefix = prefix_encode(length);
        Ok(i64::from(self.literal.at(NUM_LITERAL_CODES + prefix.code)?)
            + (i64::from(prefix.extra_bits) << LOG_2_PRECISION_BITS))
    }

    fn distance_cost(&self, distance: u32) -> Checked<i64> {
        let prefix = prefix_encode(distance);
        Ok(i64::from(self.distance.at(prefix.code)?)
            + (i64::from(prefix.extra_bits) << LOG_2_PRECISION_BITS))
    }
}

/// The most intervals to keep. What does not fit goes into the costs at once.
const COST_CACHE_INTERVAL_SIZE_MAX: usize = 500;

/// A copy from `position` reaches `start..end` at `cost`, the least known. Sorted by `start`, without overlap.
#[derive(Clone, Copy, Default)]
struct CostInterval {
    cost: i64,
    start: usize,
    end: usize,
    position: usize,
    previous: Option<usize>,
    next: Option<usize>,
}

/// The lengths from `start` to `end` (exclusive) all cost `cost`.
#[derive(Clone, Copy)]
struct CostCacheInterval {
    cost: i64,
    start: usize,
    end: usize,
}

/// A copy reaches up to `MAX_LENGTH` pixels. Lengths fall into few ranges of equal cost: one interval for each range.
struct CostManager<'a> {
    head: Option<usize>,
    cache_intervals: Vec<CostCacheInterval>,
    /// What a copy of `k + 1` pixels is taken to cost: `length_cost(k)`, which is one length off.
    cost_cache: Vec<i64>,
    /// The lowest cost known of reaching each pixel.
    costs: Vec<i64>,
    /// `dist_array`: the length of the step that reaches each pixel at that cost.
    step_lengths: &'a mut [u16],
    /// `previous` and `next` are positions in here.
    intervals: Vec<CostInterval>,
    /// The elements of `intervals` that are not in the list.
    free_intervals: Vec<usize>,
}

impl<'a> CostManager<'a> {
    fn new(step_lengths: &'a mut [u16], cost_model: &CostModel) -> Result<Self> {
        let pix_count = step_lengths.len();
        let cost_cache_size = pix_count.min(MAX_LENGTH);

        let mut cost_cache = try_vec(0, cost_cache_size)?;
        for (cost, length) in cost_cache.iter_mut().zip(0..) {
            *cost = cost_model.length_cost(length)?;
        }
        let mut cache_intervals = try_with_capacity(cost_cache.chunk_by(|a, b| a == b).count())?;
        let mut start = 0;
        for run in cost_cache.chunk_by(|a, b| a == b) {
            let end = start + run.len();
            cache_intervals.push(CostCacheInterval {
                cost: run.first().copied().ok_or(Bug)?,
                start,
                end,
            });
            start = end;
        }

        let mut free_intervals = try_with_capacity(COST_CACHE_INTERVAL_SIZE_MAX)?;
        free_intervals.extend(0..COST_CACHE_INTERVAL_SIZE_MAX);
        Ok(Self {
            head: None,
            cache_intervals,
            cost_cache,
            costs: try_vec(i64::MAX, pix_count)?,
            step_lengths,
            intervals: try_vec(CostInterval::default(), COST_CACHE_INTERVAL_SIZE_MAX)?,
            free_intervals,
        })
    }

    /// Pixel `i` can be reached from `position` at `cost`.
    #[inline]
    fn update_cost(&mut self, i: usize, position: usize, cost: i64) -> Checked {
        let best = self.costs.at_mut(i)?;
        if *best > cost {
            *best = cost;
            self.step_lengths.put(i, (i - position + 1) as u16)?;
        }
        Ok(())
    }

    fn update_cost_per_interval(
        &mut self,
        start: usize,
        end: usize,
        position: usize,
        cost: i64,
    ) -> Checked {
        for i in start..end {
            self.update_cost(i, position, cost)?;
        }
        Ok(())
    }

    /// Makes `next` follow `prev`.
    fn connect_intervals(&mut self, prev: Option<usize>, next: Option<usize>) -> Checked {
        match prev {
            Some(prev) => self.intervals.at_mut(prev)?.next = next,
            None => self.head = next,
        }
        if let Some(next) = next {
            self.intervals.at_mut(next)?.previous = prev;
        }
        Ok(())
    }

    fn pop_interval(&mut self, interval: usize) -> Checked {
        let CostInterval { previous, next, .. } = self.intervals.at(interval)?;
        self.connect_intervals(previous, next)?;
        self.free_intervals.push(interval);
        Ok(())
    }

    /// Takes the intervals that pixel `i` is in into its cost. `do_clean_intervals` drops those that end before it.
    fn update_cost_at_index(&mut self, i: usize, do_clean_intervals: bool) -> Checked {
        let mut current = self.head;
        while let Some(index) = current {
            let interval = self.intervals.at(index)?;
            if interval.start > i {
                break;
            }
            if interval.end <= i {
                if do_clean_intervals {
                    self.pop_interval(index)?;
                }
            } else {
                self.update_cost(i, interval.position, interval.cost)?;
            }
            current = interval.next;
        }
        Ok(())
    }

    /// Puts `current`, which is not in the list, where its `start` says. The search begins at `previous`.
    fn position_orphan_interval(&mut self, current: usize, previous: Option<usize>) -> Checked {
        let start = self.intervals.at(current)?.start;
        let mut previous = previous.or(self.head);
        while let Some(index) = previous {
            let interval = self.intervals.at(index)?;
            if start >= interval.start {
                break;
            }
            previous = interval.previous;
        }
        while let Some(index) = previous {
            match self.intervals.at(index)?.next {
                Some(next) if self.intervals.at(next)?.start < start => previous = Some(next),
                _ => break,
            }
        }
        let next = match previous {
            Some(index) => self.intervals.at(index)?.next,
            None => self.head,
        };
        self.connect_intervals(Some(current), next)?;
        self.connect_intervals(previous, Some(current))
    }

    /// Adds an interval to the list. `interval_in` is one that is near its place.
    fn insert_interval(
        &mut self,
        interval_in: Option<usize>,
        cost: i64,
        position: usize,
        start: usize,
        end: usize,
    ) -> Checked {
        if start >= end {
            return Ok(());
        }
        let Some(interval_new) = self.free_intervals.pop() else {
            return self.update_cost_per_interval(start, end, position, cost);
        };
        self.intervals.put(
            interval_new,
            CostInterval {
                cost,
                start,
                end,
                position,
                previous: None,
                next: None,
            },
        )?;
        self.position_orphan_interval(interval_new, interval_in)
    }

    /// A copy of `len` pixels from `position` on costs `distance_cost` plus the cost of the length made use of.
    fn push_interval(&mut self, distance_cost: i64, position: usize, len: usize) -> Checked {
        // Not worth the trouble with the intervals.
        const SKIP_DISTANCE: usize = 10;
        if len < SKIP_DISTANCE {
            for k in 0..len {
                let cost = distance_cost + self.cost_cache.at(k)?;
                self.update_cost(position + k, position, cost)?;
            }
            return Ok(());
        }

        let mut interval = self.head;
        for i in 0..self.cache_intervals.len() {
            let cache_interval = self.cache_intervals.at(i)?;
            if cache_interval.start >= len {
                break;
            }
            // What is left to place of this range of lengths.
            let mut start = position + cache_interval.start;
            let end = position + cache_interval.end.min(len);
            let cost = distance_cost + cache_interval.cost;

            while let Some(index) = interval {
                let old = self.intervals.at(index)?;
                if old.start >= end {
                    break;
                }
                if start >= old.end {
                    interval = old.next;
                    continue;
                }
                if cost >= old.cost {
                    // The old one stays. The new one keeps what comes before it and goes on after it.
                    self.insert_interval(interval, cost, position, start, old.start)?;
                    start = old.end;
                    if start >= end {
                        break;
                    }
                } else if start <= old.start {
                    if old.end <= end {
                        self.pop_interval(index)?;
                    } else {
                        self.intervals.at_mut(index)?.start = end;
                        break;
                    }
                } else {
                    self.intervals.at_mut(index)?.end = start;
                    if end < old.end {
                        // The new one splits the old one.
                        self.insert_interval(interval, old.cost, old.position, end, old.end)?;
                        interval = self.intervals.at(index)?.next;
                        break;
                    }
                }
                interval = old.next;
            }
            self.insert_interval(interval, cost, position, start, end)?;
        }
        Ok(())
    }
}

/// `AddSingleLiteralWithCostModel`: pixel `i` can be reached from the one before, which costs `prev_cost`.
#[inline]
fn add_single_literal_with_cost_model(
    color: u32,
    color_cache: Option<&mut ColorCache>,
    cost_model: &CostModel,
    i: usize,
    prev_cost: i64,
    manager: &mut CostManager<'_>,
) -> Checked {
    let cache_idx = match color_cache {
        Some(color_cache) => color_cache.hit_or_insert(color)?,
        None => None,
    };
    let cost = match cache_idx {
        Some(idx) => div_round::<100>(cost_model.cache_cost(idx)? * 68),
        None => div_round::<100>(cost_model.literal_cost(color)? * 82),
    };
    manager.update_cost(i, i, prev_cost + cost)
}

/// Sets `step_lengths` to the length of the last step of the cheapest way to each pixel.
fn backward_references_hash_chain_distance_only(
    width: usize,
    argb: &[u32],
    cache_bits: u32,
    hash_chain: &HashChain,
    refs: &BackwardRefs,
    step_lengths: &mut [u16],
) -> Result<()> {
    let pix_count = argb.len();
    let cost_model = CostModel::new(width, cache_bits, refs)?;
    let mut color_cache = match cache_bits {
        0 => None,
        _ => Some(ColorCache::new(cache_bits)?),
    };
    let mut cost_manager = CostManager::new(step_lengths, &cost_model)?;
    let mut distance_prev = None;
    let mut len_prev = 0;
    let mut distance_cost = 0;
    let mut first_distance_is_constant = false;
    let mut reach = 0;

    add_single_literal_with_cost_model(
        argb.at(0)?,
        color_cache.as_mut(),
        &cost_model,
        0,
        0,
        &mut cost_manager,
    )?;

    for i in 1..pix_count {
        let prev_cost = cost_manager.costs.at(i - 1)?;
        let (distance, len) = hash_chain.copy_at(i)?;

        add_single_literal_with_cost_model(
            argb.at(i)?,
            color_cache.as_mut(),
            &cost_model,
            i,
            prev_cost,
            &mut cost_manager,
        )?;

        if len >= 2 {
            if Some(distance) != distance_prev {
                let code = distance_to_plane_code(width, distance as u32);
                distance_cost = cost_model.distance_cost(code)?;
                first_distance_is_constant = true;
                cost_manager.push_interval(prev_cost + distance_cost, i, len)?;
            } else {
                // All copy from the same distance, as in a flat area: each interval is the last one moved by one.
                if first_distance_is_constant {
                    reach = (i + len_prev).checked_sub(2).ok_or(Bug)?;
                    first_distance_is_constant = false;
                }

                if i + len - 1 > reach {
                    // Only the last pixel up to `reach + 1` with this distance gets further.
                    let mut j = i;
                    let mut len_j = 0;
                    while j <= reach {
                        let (distance_j, len_next) = hash_chain.copy_at(j + 1)?;
                        len_j = len_next;
                        if distance_j != distance {
                            len_j = hash_chain.length(j)?;
                            break;
                        }
                        j += 1;
                    }
                    cost_manager.update_cost_at_index(j - 1, false)?;
                    cost_manager.update_cost_at_index(j, false)?;

                    let cost = cost_manager.costs.at(j - 1)? + distance_cost;
                    cost_manager.push_interval(cost, j, len_j)?;
                    reach = (j + len_j).checked_sub(1).ok_or(Bug)?;
                }
            }
        }

        cost_manager.update_cost_at_index(i, true)?;
        distance_prev = Some(distance);
        len_prev = len;
    }
    Ok(())
}

/// Follows the steps back from the last pixel and packs them at the end of `step_lengths`. Returns where they start.
fn trace_backwards(step_lengths: &mut [u16]) -> Checked<usize> {
    let mut path = step_lengths.len();
    // One more than the pixel that the path has got back to.
    let mut cur = step_lengths.len();
    while cur > 0 {
        let k = step_lengths.at(cur - 1)?;
        if k == 0 {
            return Err(Bug);
        }
        path -= 1;
        step_lengths.put(path, k)?;
        cur = cur.checked_sub(k.into()).ok_or(Bug)?;
    }
    Ok(path)
}

fn backward_references_hash_chain_follow_chosen_path(
    argb: &[u32],
    cache_bits: u32,
    chosen_path: &[u16],
    hash_chain: &HashChain,
    refs: &mut BackwardRefs,
) -> Result<()> {
    let mut color_cache = match cache_bits {
        0 => None,
        _ => Some(ColorCache::new(cache_bits)?),
    };
    refs.clear();
    let mut i = 0;
    for &len in chosen_path {
        let len = usize::from(len);
        if len != 1 {
            refs.push_copy(hash_chain.distance(i)?, len)?;
            if let Some(color_cache) = &mut color_cache {
                for &pixel in argb.sub(i..i + len)? {
                    color_cache.insert(pixel)?;
                }
            }
        } else {
            let pixel = argb.at(i)?;
            let cache_idx = match &mut color_cache {
                Some(color_cache) => color_cache.hit_or_insert(pixel)?,
                None => None,
            };
            refs.push(match cache_idx {
                Some(idx) => PixOrCopy::CacheIdx(idx),
                None => PixOrCopy::Literal(pixel),
            })?;
        }
        i += len;
    }
    Ok(())
}

/// `VP8LBackwardReferencesTraceBackwards`: `refs_src` says how frequent the symbols are.
pub(super) fn backward_references_trace_backwards(
    width: usize,
    argb: &[u32],
    cache_bits: u32,
    hash_chain: &HashChain,
    refs_src: &BackwardRefs,
    refs_dst: &mut BackwardRefs,
) -> Result<()> {
    let mut step_lengths = try_vec(0u16, argb.len())?;
    backward_references_hash_chain_distance_only(
        width,
        argb,
        cache_bits,
        hash_chain,
        refs_src,
        &mut step_lengths,
    )?;
    let path = trace_backwards(&mut step_lengths)?;
    backward_references_hash_chain_follow_chosen_path(
        argb,
        cache_bits,
        step_lengths.sub(path..)?,
        hash_chain,
        refs_dst,
    )
}
