//! `histogram_enc.c`: counts symbols, estimates their cost, and clusters the tiles that are to share Huffman codes.

use super::Quality;
use super::backward_references::{BackwardRefs, PixOrCopy};
use super::lossless::{
    BitEntropy, LOG_2_PRECISION_BITS, Streaks, add_vector_eq, bits_entropy_unrefined,
    combined_entropy_unrefined, div_round, entropy_unrefined, extra_cost, prefix_encode,
};
use crate::Result;
use crate::util::{Bug, ByteHistogram, Checked, SliceExt, increment, try_vec, try_with_capacity};
use crate::vp8l::common::{
    CODE_LENGTH_CODES, FIRST_CACHE_CODE, HUFFMAN_CODES_PER_META_CODE, NUM_DISTANCE_CODES,
    NUM_LENGTH_CODES, NUM_LITERAL_CODES, sub_sample_size,
};

/// Into how many ranges the cost of the literal, the red and the blue symbols each is split.
const NUM_PARTITIONS: usize = 4;
const BIN_SIZE: usize = NUM_PARTITIONS * NUM_PARTITIONS * NUM_PARTITIONS;
/// The most histograms that the greedy combining can be given.
const MAX_HISTO_GREEDY: i64 = 100;

/// What `histo_image_symbols` knows about one of the populations of a histogram.
#[derive(Clone, Copy, Default)]
struct PopulationStats {
    /// The only symbol that occurs.
    trivial_symbol: Option<u16>,
    cost: u64,
    /// Some symbol occurs.
    is_used: bool,
}

pub(super) struct Histogram {
    /// Green, then the prefix codes of lengths, then color cache indices.
    pub(super) literal: Vec<u32>,
    pub(super) red: ByteHistogram,
    pub(super) blue: ByteHistogram,
    pub(super) alpha: ByteHistogram,
    /// The prefix codes of distances.
    pub(super) distance: [u32; NUM_DISTANCE_CODES],
    stats: [PopulationStats; HUFFMAN_CODES_PER_META_CODE],
    /// The sum of the costs in `stats`.
    bit_cost: u64,
    bin_id: usize,
}

impl Histogram {
    /// `VP8LHistogramNumCodes`: the size of `literal`.
    pub(super) const fn num_codes(cache_bits: u32) -> usize {
        FIRST_CACHE_CODE + if cache_bits > 0 { 1 << cache_bits } else { 0 }
    }

    /// All counts are 0.
    pub(super) fn new(cache_bits: u32) -> Result<Self> {
        Ok(Self {
            literal: try_vec(0, Self::num_codes(cache_bits))?,
            red: [0; 256],
            blue: [0; 256],
            alpha: [0; 256],
            distance: [0; NUM_DISTANCE_CODES],
            stats: [PopulationStats::default(); HUFFMAN_CODES_PER_META_CODE],
            bit_cost: 0,
            bin_id: 0,
        })
    }

    /// `VP8LHistogramCreate`
    pub(super) fn from_refs(refs: &BackwardRefs, cache_bits: u32) -> Result<Self> {
        let mut histo = Self::new(cache_bits)?;
        histo.store_refs(refs, |distance| distance)?;
        Ok(histo)
    }

    fn clear(&mut self) {
        self.populations_mut().into_iter().for_each(|p| p.fill(0));
        self.stats = [PopulationStats::default(); HUFFMAN_CODES_PER_META_CODE];
        self.bit_cost = 0;
        self.bin_id = 0;
    }

    fn copy_from(&mut self, src: &Self) -> Checked {
        self.literal.write_at(0, &src.literal)?;
        self.red = src.red;
        self.blue = src.blue;
        self.alpha = src.alpha;
        self.distance = src.distance;
        self.stats = src.stats;
        self.bit_cost = src.bit_cost;
        self.bin_id = src.bin_id;
        Ok(())
    }

    fn populations(&self) -> [&[u32]; HUFFMAN_CODES_PER_META_CODE] {
        [
            &self.literal,
            &self.red,
            &self.blue,
            &self.alpha,
            &self.distance,
        ]
    }

    pub(super) fn populations_mut(&mut self) -> [&mut [u32]; HUFFMAN_CODES_PER_META_CODE] {
        [
            &mut self.literal,
            &mut self.red,
            &mut self.blue,
            &mut self.alpha,
            &mut self.distance,
        ]
    }

    fn is_used(&self) -> bool {
        self.stats.iter().any(|stats| stats.is_used)
    }

    #[inline]
    fn add_single_pix_or_copy(
        &mut self,
        v: PixOrCopy,
        distance_modifier: impl Fn(u32) -> u32,
    ) -> Checked {
        match v {
            PixOrCopy::Literal(argb) => {
                let [b, g, r, a] = argb.to_le_bytes();
                increment(&mut self.alpha, a);
                increment(&mut self.red, r);
                *self.literal.at_mut(g.into())? += 1;
                increment(&mut self.blue, b);
            }
            PixOrCopy::CacheIdx(idx) => {
                let literal_idx = FIRST_CACHE_CODE + idx as usize;
                *self.literal.at_mut(literal_idx)? += 1;
            }
            PixOrCopy::Copy { distance, len } => {
                let code = prefix_encode(len.into()).code;
                *self.literal.at_mut(NUM_LITERAL_CODES + code)? += 1;
                let code = prefix_encode(distance_modifier(distance)).code;
                *self.distance.at_mut(code)? += 1;
            }
        }
        Ok(())
    }

    /// `VP8LHistogramStoreRefs`: `distance_modifier` is applied to the distances before they are counted.
    pub(super) fn store_refs(
        &mut self,
        refs: &BackwardRefs,
        distance_modifier: impl Fn(u32) -> u32,
    ) -> Checked {
        for &v in refs.iter() {
            self.add_single_pix_or_copy(v, &distance_modifier)?;
        }
        Ok(())
    }

    /// `VP8LHistogramEstimateBits`: the entropy, the Huffman codes and the extra bits.
    pub(super) fn estimate_bits(&self) -> Checked<u64> {
        let cost = add_costs(
            self.populations()
                .map(|population| population_cost(population).cost),
        );
        let lengths = self
            .literal
            .sub(NUM_LITERAL_CODES..)?
            .sub(..NUM_LENGTH_CODES)?;
        let extra = extra_cost(lengths).wrapping_add(extra_cost(&self.distance));
        Ok(cost.wrapping_add(u64::from(extra) << LOG_2_PRECISION_BITS))
    }

    /// `ComputeHistogramCost`. The extra bits are left out: they stay the same however histograms are combined.
    fn compute_cost(&mut self) {
        let stats = self.populations().map(population_cost);
        self.bit_cost = add_costs(stats.map(|stats| stats.cost));
        self.stats = stats;
    }

    fn update_cost(&mut self, bit_cost: u64, costs: &[u64; HUFFMAN_CODES_PER_META_CODE]) {
        self.bit_cost = bit_cost;
        for (stats, &cost) in self.stats.iter_mut().zip(costs) {
            stats.cost = cost;
        }
    }

    /// `HistogramAdd(h1, self, self)`
    fn add(&mut self, h1: &Self) -> Checked {
        let stats = self.stats;
        for ((pout, p1), (out, s1)) in self
            .populations_mut()
            .into_iter()
            .zip(h1.populations())
            .zip(stats.iter().zip(&h1.stats))
        {
            if s1.is_used {
                if out.is_used {
                    add_vector_eq(p1, pout);
                } else {
                    pout.write_at(0, p1)?;
                }
            }
        }
        self.stats = combined_stats(&h1.stats, &stats);
        Ok(())
    }

    /// `HistogramAdd(h1, h2, self)`
    fn set_to_sum(&mut self, h1: &Self, h2: &Self) -> Checked {
        for (((pout, p1), p2), (s1, s2)) in self
            .populations_mut()
            .into_iter()
            .zip(h1.populations())
            .zip(h2.populations())
            .zip(h1.stats.iter().zip(&h2.stats))
        {
            match (s1.is_used, s2.is_used) {
                (true, true) => {
                    for ((out, a), b) in pout.iter_mut().zip(p1).zip(p2) {
                        *out = a + b;
                    }
                }
                (true, false) => pout.write_at(0, p1)?,
                (false, true) => pout.write_at(0, p2)?,
                (false, false) => pout.fill(0),
            }
        }
        self.stats = combined_stats(&h1.stats, &h2.stats);
        Ok(())
    }
}

/// The flags, not the costs, of the sum of two histograms. Trivial in one and unused in the other is not trivial.
fn combined_stats(
    s1: &[PopulationStats; HUFFMAN_CODES_PER_META_CODE],
    s2: &[PopulationStats; HUFFMAN_CODES_PER_META_CODE],
) -> [PopulationStats; HUFFMAN_CODES_PER_META_CODE] {
    let mut out = [PopulationStats::default(); HUFFMAN_CODES_PER_META_CODE];
    for ((out, s1), s2) in out.iter_mut().zip(s1).zip(s2) {
        out.trivial_symbol = s1
            .trivial_symbol
            .filter(|_| s1.trivial_symbol == s2.trivial_symbol);
        out.is_used = s1.is_used || s2.is_used;
    }
    out
}

/// Wraps below 0 from some 259 million symbols of noise on, as in libwebp: hence `add_costs` and `wrapping_add`.
fn bits_entropy_refine(entropy: &BitEntropy) -> u64 {
    let sum = u64::from(entropy.sum) << LOG_2_PRECISION_BITS;
    // A Huffman code cannot reach the entropy of few symbols. Mixing some entropy into that limit clusters better.
    let mix: u64 = match entropy.nonzeros {
        0 | 1 => return 0,
        2 => return div_round::<100>((99 * sum).wrapping_add(entropy.entropy) as i64) as u64,
        3 => 950,
        4 => 700,
        _ => 627,
    };
    let min_limit = 2 * sum - (u64::from(entropy.max_val) << LOG_2_PRECISION_BITS);
    let mixed = (mix * min_limit).wrapping_add((1000 - mix).wrapping_mul(entropy.entropy));
    entropy.entropy.max(div_round::<1000>(mixed as i64) as u64)
}

pub(super) fn add_costs<const N: usize>(costs: [u64; N]) -> u64 {
    costs.into_iter().fold(0, u64::wrapping_add)
}

pub(super) fn bits_entropy(array: &[u32]) -> u64 {
    bits_entropy_refine(&bits_entropy_unrefined(array))
}

/// What the code lengths of a Huffman code take, less a bias of 9.1 bits because they seldom are written in full.
const INITIAL_HUFFMAN_COST: u64 = ((CODE_LENGTH_CODES as u64 * 3) << LOG_2_PRECISION_BITS)
    - div_round::<10>(91 << LOG_2_PRECISION_BITS) as u64;

fn final_huffman_cost(streaks: &Streaks) -> u64 {
    let [[zero_short, zero_long], [nonzero_short, nonzero_long]] = streaks.streaks;
    let [zero_count, nonzero_count] = streaks.counts;
    // In 1/1024 of a bit.
    let extra = zero_count * 1600
        + 240 * zero_long
        + nonzero_count * 2640
        + 720 * nonzero_long
        + 1840 * zero_short
        + 3360 * nonzero_short;
    INITIAL_HUFFMAN_COST + (u64::from(extra) << (LOG_2_PRECISION_BITS - 10))
}

fn population_cost(population: &[u32]) -> PopulationStats {
    let (bit_entropy, streaks) = entropy_unrefined(population);
    let [_, [nonzero_short, nonzero_long]] = streaks.streaks;
    PopulationStats {
        trivial_symbol: (bit_entropy.nonzeros == 1).then_some(bit_entropy.nonzero_code as u16),
        cost: bits_entropy_refine(&bit_entropy).wrapping_add(final_huffman_cost(&streaks)),
        is_used: nonzero_short != 0 || nonzero_long != 0,
    }
}

/// The cost of one population of the sum of two histograms.
#[inline]
fn combined_entropy(x: &[u32], s1: &PopulationStats, y: &[u32], s2: &PopulationStats) -> u64 {
    let is_trivial = s1.trivial_symbol.is_some() && s1.trivial_symbol == s2.trivial_symbol;
    if is_trivial || !s1.is_used || !s2.is_used {
        return if s1.is_used { s1.cost } else { s2.cost };
    }
    let (bit_entropy, streaks) = combined_entropy_unrefined(x, y);
    bits_entropy_refine(&bit_entropy).wrapping_add(final_huffman_cost(&streaks))
}

/// `a + b`, or `i64::MAX` if that is less.
const fn saturate_add(a: u64, b: i64) -> i64 {
    if b < 0 || a as i64 <= i64::MAX - b {
        b.wrapping_add(a as i64)
    } else {
        i64::MAX
    }
}

/// The cost of `a + b` and of each of its populations, unless that is `cost_threshold` or more.
fn combined_histogram_entropy(
    a: &Histogram,
    b: &Histogram,
    cost_threshold: i64,
) -> Option<(u64, [u64; HUFFMAN_CODES_PER_META_CODE])> {
    if cost_threshold <= 0 {
        return None;
    }
    let mut cost = 0u64;
    let mut costs = [0; HUFFMAN_CODES_PER_META_CODE];
    for (((out, (x, s1)), y), s2) in costs
        .iter_mut()
        .zip(a.populations().into_iter().zip(&a.stats))
        .zip(b.populations())
        .zip(&b.stats)
    {
        *out = combined_entropy(x, s1, y, s2);
        cost = cost.wrapping_add(*out);
        if cost >= cost_threshold as u64 {
            return None;
        }
    }
    Some((cost, costs))
}

/// `HistogramAddThresh`: `C(a + b) - C(a)`, unless that is `cost_threshold` or more.
fn add_thresh(a: &Histogram, b: &Histogram, cost_threshold: i64) -> Option<i64> {
    let cost_threshold = saturate_add(a.bit_cost, cost_threshold);
    let (cost, _) = combined_histogram_entropy(a, b, cost_threshold)?;
    Some(cost as i64 - a.bit_cost as i64)
}

/// `VP8LHistogramSet`, where `VP8LGetHistoImageSymbols` combines histograms.
struct HistogramSet {
    histograms: Vec<Histogram>,
    /// Where each histogram is. What removal leaves at `size` stays: `histogram_combine_stochastic` still looks at it.
    slots: Vec<usize>,
    size: usize,
    /// Where in `histograms` the one is that is not part of the set.
    spare: usize,
}

impl HistogramSet {
    fn new(max_size: usize, cache_bits: u32) -> Result<Self> {
        let mut histograms = try_with_capacity(max_size + 1)?;
        let mut slots = try_with_capacity(max_size)?;
        for _ in 0..=max_size {
            histograms.push(Histogram::new(cache_bits)?);
        }
        slots.extend(0..max_size);
        Ok(Self {
            histograms,
            slots,
            size: 0,
            spare: max_size,
        })
    }

    #[inline]
    fn get(&self, i: usize) -> Checked<&Histogram> {
        self.histograms.at_ref(self.slots.at(i)?)
    }

    #[inline]
    fn get_mut(&mut self, i: usize) -> Checked<&mut Histogram> {
        self.histograms.at_mut(self.slots.at(i)?)
    }

    /// `HistogramSetRemoveHistogram`
    fn remove(&mut self, i: usize) -> Checked {
        self.size = self.size.checked_sub(1).ok_or(Bug)?;
        let last = self.slots.at(self.size)?;
        self.slots.put(i, last)
    }

    /// Adds histogram `pair.idx2` to `pair.idx1` and removes it.
    fn merge(&mut self, pair: &HistogramPair) -> Checked {
        let slots = [self.slots.at(pair.idx1)?, self.slots.at(pair.idx2)?];
        let [h1, h2] = self.histograms.get_disjoint_mut(slots).map_err(|_| Bug)?;
        h1.add(h2)?;
        h1.update_cost(pair.cost_combo, &pair.costs);
        self.remove(pair.idx2)
    }

    /// `HistogramAddEval`: the spare becomes `a + b` if `C(a + b) - C(a) - C(b)` is less than `cost_threshold`.
    fn add_eval_to_spare(&mut self, a: usize, b: usize, cost_threshold: i64) -> Checked<bool> {
        let slots = [self.slots.at(a)?, self.slots.at(b)?, self.spare];
        let [a, b, out] = self.histograms.get_disjoint_mut(slots).map_err(|_| Bug)?;
        let cost_threshold = saturate_add(a.bit_cost.wrapping_add(b.bit_cost), cost_threshold);
        let Some((bit_cost, costs)) = combined_histogram_entropy(a, b, cost_threshold) else {
            return Ok(false);
        };
        out.set_to_sum(a, b)?;
        out.update_cost(bit_cost, &costs);
        Ok(true)
    }
}

fn bin_id_for_entropy(min: u64, max: u64, val: u64) -> usize {
    let range = max - min;
    if range > 0 {
        let delta = val - min;
        ((NUM_PARTITIONS as f64 - 1e-6) * delta as f64 / range as f64) as usize
    } else {
        0
    }
}

/// `HistogramBuild`: one histogram for each tile of `1 << histo_bits` pixels squared.
fn histogram_build(
    width: usize,
    histo_bits: u32,
    backward_refs: &BackwardRefs,
    histograms: &mut [Histogram],
) -> Checked {
    let tiles_per_row = sub_sample_size(width, histo_bits);
    let (mut x, mut y) = (0, 0);
    for &v in backward_refs.iter() {
        let idx = (y >> histo_bits) * tiles_per_row + (x >> histo_bits);
        histograms
            .at_mut(idx)?
            .add_single_pix_or_copy(v, |distance| distance)?;
        x += v.length();
        while x >= width {
            x -= width;
            y += 1;
        }
    }
    Ok(())
}

/// `HistogramCopyAndAnalyze`: computes the costs and drops the empty histograms, those of tiles that a copy skips.
fn histogram_copy_and_analyze(
    orig_histo: &mut [Histogram],
    image_histo: &mut HistogramSet,
) -> Checked {
    for histo in orig_histo {
        histo.compute_cost();
        if histo.is_used() {
            image_histo.get_mut(image_histo.size)?.copy_from(histo)?;
            image_histo.size += 1;
        }
    }
    Ok(())
}

/// `HistogramAnalyzeEntropyBin`: sorts the histograms into bins by the costs of their first three populations.
fn histogram_analyze_entropy_bin(image_histo: &mut HistogramSet) -> Checked {
    let mut min = [u64::MAX; 3];
    let mut max = [0u64; 3];
    for i in 0..image_histo.size {
        for ((min, max), stats) in min.iter_mut().zip(&mut max).zip(&image_histo.get(i)?.stats) {
            *min = (*min).min(stats.cost);
            *max = (*max).max(stats.cost);
        }
    }
    for i in 0..image_histo.size {
        let histo = image_histo.get_mut(i)?;
        histo.bin_id =
            min.iter()
                .zip(&max)
                .zip(&histo.stats)
                .fold(0, |bin_id, ((&min, &max), stats)| {
                    bin_id * NUM_PARTITIONS + bin_id_for_entropy(min, max, stats.cost)
                });
    }
    Ok(())
}

/// Red, blue and alpha each have a single value.
fn is_trivial_but_for_literal(histo: &Histogram) -> bool {
    let [_, red, blue, alpha, _] = &histo.stats;
    red.trivial_symbol.is_some() && blue.trivial_symbol.is_some() && alpha.trivial_symbol.is_some()
}

/// `HistogramCombineEntropyBin`: merges histograms of a bin where that pays. `combine_cost_factor` is a percentage.
fn histogram_combine_entropy_bin(
    image_histo: &mut HistogramSet,
    combine_cost_factor: i64,
) -> Checked {
    #[derive(Clone, Copy, Default)]
    struct BinInfo {
        /// The histogram that takes in the others of the bin.
        first: Option<usize>,
        num_combine_failures: u32,
    }
    const MAX_COMBINE_FAILURES: u32 = 32;
    let mut bin_info = [BinInfo::default(); BIN_SIZE];

    let mut idx = 0;
    while idx < image_histo.size {
        let histo = image_histo.get(idx)?;
        let bin = bin_info.at_mut(histo.bin_id)?;
        let Some(first) = bin.first else {
            bin.first = Some(idx);
            idx += 1;
            continue;
        };
        let bit_cost_thresh = -div_round::<100>(histo.bit_cost as i64 * combine_cost_factor);
        if !image_histo.add_eval_to_spare(first, idx, bit_cost_thresh)? {
            idx += 1;
            continue;
        }
        // Merge if the sum is trivial or neither part is. After many refusals in a bin, merge anyway: codes cost too.
        let try_combine =
            is_trivial_but_for_literal(image_histo.histograms.at_ref(image_histo.spare)?)
                || (!is_trivial_but_for_literal(image_histo.get(idx)?)
                    && !is_trivial_but_for_literal(image_histo.get(first)?));
        if try_combine || bin.num_combine_failures >= MAX_COMBINE_FAILURES {
            core::mem::swap(image_histo.slots.at_mut(first)?, &mut image_histo.spare);
            image_histo.remove(idx)?;
        } else {
            bin.num_combine_failures += 1;
            idx += 1;
        }
    }
    Ok(())
}

/// `MyRand`: a Lehmer random number generator, times 48271, modulo 2^31 - 1.
fn lehmer_rand(seed: &mut u32) -> u32 {
    *seed = ((u64::from(*seed) * 48271) % 2_147_483_647) as u32;
    *seed
}

// Histogram pairs priority queue

/// Two histograms that it pays to merge.
#[derive(Clone, Copy)]
struct HistogramPair {
    idx1: usize,
    /// More than `idx1`.
    idx2: usize,
    /// What the merge saves, negated.
    cost_diff: i64,
    cost_combo: u64,
    costs: [u64; HUFFMAN_CODES_PER_META_CODE],
}

impl HistogramPair {
    /// `HistoQueueFixPair`: replaces `bad_id` by `good_id`.
    fn fix(&mut self, bad_id: usize, good_id: usize) {
        if self.idx1 == bad_id {
            self.idx1 = good_id;
        }
        if self.idx2 == bad_id {
            self.idx2 = good_id;
        }
        if self.idx1 > self.idx2 {
            core::mem::swap(&mut self.idx1, &mut self.idx2);
        }
    }

    /// `HistoQueueUpdatePair`: the pair, if merging it changes the cost by less than `cost_threshold`.
    fn new(
        histograms: &HistogramSet,
        idx1: usize,
        idx2: usize,
        cost_threshold: i64,
    ) -> Checked<Option<Self>> {
        let (h1, h2) = (histograms.get(idx1)?, histograms.get(idx2)?);
        let sum_cost = h1.bit_cost.wrapping_add(h2.bit_cost);
        let cost_threshold = saturate_add(sum_cost, cost_threshold);
        Ok(
            combined_histogram_entropy(h1, h2, cost_threshold).map(|(cost_combo, costs)| Self {
                idx1,
                idx2,
                cost_diff: cost_combo as i64 - sum_cost as i64,
                cost_combo,
                costs,
            }),
        )
    }
}

/// The best pair comes first. The others are in no particular order.
struct HistoQueue {
    queue: Vec<HistogramPair>,
    max_size: usize,
}

impl HistoQueue {
    fn new(max_size: usize) -> Result<Self> {
        let queue = try_with_capacity(max_size)?;
        Ok(Self { queue, max_size })
    }

    /// `HistoQueuePopPair`: the last pair takes the place of pair `i`.
    fn pop_pair(&mut self, i: usize) -> Checked {
        let last = self.queue.pop().ok_or(Bug)?;
        if i < self.queue.len() {
            self.queue.put(i, last)?;
        }
        Ok(())
    }

    /// `HistoQueueUpdateHead`: moves pair `i` to the front if it is the best.
    fn update_head(&mut self, i: usize) -> Checked {
        if self.queue.at_ref(i)?.cost_diff < self.queue.at_ref(0)?.cost_diff {
            self.queue.swap(0, i);
        }
        Ok(())
    }

    /// `HistoQueuePush`: adds the pair if there is room and its cost change is below `threshold`. Returns it, or 0.
    fn push(
        &mut self,
        histograms: &HistogramSet,
        idx1: usize,
        idx2: usize,
        threshold: i64,
    ) -> Checked<i64> {
        if self.queue.len() == self.max_size {
            return Ok(0);
        }
        let (idx1, idx2) = (idx1.min(idx2), idx1.max(idx2));
        let Some(pair) = HistogramPair::new(histograms, idx1, idx2, threshold)? else {
            return Ok(0);
        };
        self.queue.push(pair);
        self.update_head(self.queue.len() - 1)?;
        Ok(pair.cost_diff)
    }
}

/// Merges the pair that saves the most, over and over.
fn histogram_combine_greedy(image_histo: &mut HistogramSet) -> Result<()> {
    let image_histo_size = image_histo.size;
    // Each pair of the histograms there are now, and each that a merged histogram forms later.
    let mut histo_queue = HistoQueue::new(image_histo_size * image_histo_size)?;

    for i in 0..image_histo_size {
        for j in i + 1..image_histo_size {
            histo_queue.push(image_histo, i, j, 0)?;
        }
    }

    while let Some(&best) = histo_queue.queue.first() {
        let (idx1, idx2) = (best.idx1, best.idx2);
        image_histo.merge(&best)?;

        let mut i = 0;
        while let Some(p) = histo_queue.queue.get_mut(i) {
            if p.idx1 == idx1 || p.idx2 == idx1 || p.idx1 == idx2 || p.idx2 == idx2 {
                histo_queue.pop_pair(i)?;
            } else {
                p.fix(image_histo.size, idx2);
                histo_queue.update_head(i)?;
                i += 1;
            }
        }

        for i in 0..image_histo.size {
            if i != idx1 {
                histo_queue.push(image_histo, idx1, i, 0)?;
            }
        }
    }
    Ok(())
}

/// Merges the best of a few random pairs, over and over. Returns whether `histogram_combine_greedy` can take over.
fn histogram_combine_stochastic(
    image_histo: &mut HistogramSet,
    min_cluster_size: usize,
) -> Result<bool> {
    const HISTO_QUEUE_SIZE: usize = 9;
    let mut seed = 1u32;
    let mut tries_with_no_success = 0;
    let outer_iters = image_histo.size;
    let num_tries_no_success = outer_iters / 2;

    if image_histo.size < min_cluster_size {
        return Ok(true);
    }
    let mut histo_queue = HistoQueue::new(HISTO_QUEUE_SIZE)?;

    for _ in 0..outer_iters {
        if image_histo.size < min_cluster_size {
            break;
        }
        tries_with_no_success += 1;
        if tries_with_no_success >= num_tries_no_success {
            break;
        }
        let mut best_cost = histo_queue.queue.first().map_or(0, |pair| pair.cost_diff);
        let size = image_histo.size as u32;
        if size >= 2 {
            let rand_range = (size - 1) * size;
            for _ in 0..size / 2 {
                let tmp = lehmer_rand(&mut seed) % rand_range;
                let idx1 = tmp / (size - 1);
                let mut idx2 = tmp % (size - 1);
                if idx2 >= idx1 {
                    idx2 += 1;
                }
                let curr_cost =
                    histo_queue.push(image_histo, idx1 as usize, idx2 as usize, best_cost)?;
                if curr_cost < 0 {
                    best_cost = curr_cost;
                    if histo_queue.queue.len() == histo_queue.max_size {
                        break;
                    }
                }
            }
        }
        let Some(&best) = histo_queue.queue.first() else {
            continue;
        };

        let (best_idx1, best_idx2) = (best.idx1, best.idx2);
        image_histo.merge(&best)?;
        let mut j = 0;
        while let Some(p) = histo_queue.queue.get_mut(j) {
            let is_idx1_best = p.idx1 == best_idx1 || p.idx1 == best_idx2;
            let is_idx2_best = p.idx2 == best_idx1 || p.idx2 == best_idx2;
            // A random pick can be the same pair as the front one.
            if is_idx1_best && is_idx2_best {
                histo_queue.pop_pair(j)?;
                continue;
            }
            if is_idx1_best || is_idx2_best {
                p.fix(best_idx2, best_idx1);
                match HistogramPair::new(image_histo, p.idx1, p.idx2, 0)? {
                    Some(pair) => *p = pair,
                    None => {
                        histo_queue.pop_pair(j)?;
                        continue;
                    }
                }
            }
            p.fix(image_histo.size, best_idx2);
            histo_queue.update_head(j)?;
            j += 1;
        }
        tries_with_no_success = 0;
    }
    Ok(image_histo.size <= min_cluster_size)
}

/// `HistogramRemap`: finds the best cluster for each tile. Returns the clusters, each the sum of its tiles.
fn histogram_remap(
    in_histo: &[Histogram],
    out: HistogramSet,
    symbols: &mut [u32],
) -> Checked<Vec<Histogram>> {
    let out_size = out.size;
    if out_size > 1 {
        let mut cluster = 0;
        for (histo, symbol) in in_histo.iter().zip(symbols.iter_mut()) {
            // A tile without symbols takes the cluster of the one before it, which is cheap to write.
            if histo.is_used() {
                let mut best_bits = i64::MAX;
                cluster = 0;
                for k in 0..out_size {
                    if let Some(cur_bits) = add_thresh(out.get(k)?, histo, best_bits) {
                        best_bits = cur_bits;
                        cluster = k as u32;
                    }
                }
            }
            *symbol = cluster;
        }
    } else {
        symbols.fill(0);
    }

    let mut clusters = out.histograms;
    clusters.truncate(out_size);
    clusters.iter_mut().for_each(Histogram::clear);
    for (histo, &symbol) in in_histo.iter().zip(symbols.iter()) {
        if histo.is_used() {
            clusters.at_mut(symbol as usize)?.add(histo)?;
        }
    }
    Ok(clusters)
}

/// `GetCombineCostFactor`. From a quality of 90 on libwebp leaves it at 16, and at 100 the caller does not use bins.
fn combine_cost_factor(histo_size: usize, quality: Quality) -> i64 {
    let mut factor = 16;
    if histo_size > 256 {
        factor /= 2;
    }
    if histo_size > 512 {
        factor /= 2;
    }
    if histo_size > 1024 {
        factor /= 2;
    }
    match quality {
        Quality::Palette | Quality::AlphaPlane => factor / 2,
        Quality::Image => factor,
    }
}

/// `VP8LGetHistoImageSymbols`: returns the clusters' histograms, and each tile's cluster in `histogram_symbols`.
pub(super) fn histo_image_symbols(
    width: usize,
    refs: &BackwardRefs,
    quality: Quality,
    histogram_bits: u32,
    cache_bits: u32,
    histogram_symbols: &mut [u32],
) -> Result<Vec<Histogram>> {
    let image_histo_raw_size = histogram_symbols.len();
    let mut orig_histo = try_with_capacity(image_histo_raw_size)?;
    for _ in 0..image_histo_raw_size {
        orig_histo.push(Histogram::new(cache_bits)?);
    }
    let mut image_histo = HistogramSet::new(image_histo_raw_size, cache_bits)?;

    histogram_build(width, histogram_bits, refs, &mut orig_histo)?;
    histogram_copy_and_analyze(&mut orig_histo, &mut image_histo)?;

    // With few histograms the bins would be nearly empty.
    if image_histo.size > BIN_SIZE * 2 {
        histogram_analyze_entropy_bin(&mut image_histo)?;
        histogram_combine_entropy_bin(
            &mut image_histo,
            combine_cost_factor(image_histo_raw_size, quality),
        )?;
    }

    // A cubic ramp between 1 and MAX_HISTO_GREEDY.
    let quality = i64::from(quality as i32);
    let threshold_size =
        1 + div_round::<1_000_000>(quality * quality * quality * (MAX_HISTO_GREEDY - 1));
    if histogram_combine_stochastic(&mut image_histo, threshold_size as usize)? {
        histogram_combine_greedy(&mut image_histo)?;
    }

    Ok(histogram_remap(
        &orig_histo,
        image_histo,
        histogram_symbols,
    )?)
}
