//! `histogram_enc.c`: counts the symbols that backward references turn into, estimates what they cost, and groups
//! the tiles of an image into clusters that share their prefix codes.

use super::backward_references::{BackwardRefs, PixOrCopy};
use super::lossless::{
    BitEntropy, LOG_2_PRECISION_BITS, Streaks, add_vector_eq, bits_entropy_unrefined, div_round,
    extra_cost, get_combined_entropy_unrefined, get_entropy_unrefined, prefix_encode,
};
use crate::EncodeError;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec};
use crate::vp8l::format_constants::{
    CODE_LENGTH_CODES, NUM_DISTANCE_CODES, NUM_LENGTH_CODES, NUM_LITERAL_CODES, sub_sample_size,
};

/// Into how many ranges the cost of the literal, the red and the blue symbols each is split.
const NUM_PARTITIONS: usize = 4;
const BIN_SIZE: usize = NUM_PARTITIONS * NUM_PARTITIONS * NUM_PARTITIONS;
/// The most histograms that the greedy combining can be given.
const MAX_HISTO_GREEDY: i64 = 100;

/// How many kinds of symbols there are: literal, red, blue, alpha, distance.
const NUM_CHANNELS: usize = 5;

/// What `get_histo_image_symbols` knows about one kind of symbol of a histogram.
#[derive(Clone, Copy, Default)]
struct Channel {
    /// The only symbol that occurs.
    trivial_symbol: Option<u16>,
    cost: u64,
    /// Some symbol occurs.
    is_used: bool,
}

/// `VP8LHistogram`
pub(crate) struct Histogram {
    /// Green, then the prefix codes of lengths, then colour cache indices.
    pub(crate) literal: Vec<u32>,
    pub(crate) red: [u32; NUM_LITERAL_CODES],
    pub(crate) blue: [u32; NUM_LITERAL_CODES],
    pub(crate) alpha: [u32; NUM_LITERAL_CODES],
    /// The prefix codes of distances.
    pub(crate) distance: [u32; NUM_DISTANCE_CODES],
    channels: [Channel; NUM_CHANNELS],
    /// The sum of the costs of the channels.
    bit_cost: u64,
    bin_id: usize,
}

/// `VP8LHistogramNumCodes`
pub(crate) const fn histogram_num_codes(palette_code_bits: u32) -> usize {
    NUM_LITERAL_CODES
        + NUM_LENGTH_CODES
        + if palette_code_bits > 0 {
            1 << palette_code_bits
        } else {
            0
        }
}

impl Histogram {
    /// All counts are 0.
    pub(crate) fn new(palette_code_bits: u32) -> Result<Self, OutOfMemory> {
        Ok(Self {
            literal: try_vec(0, histogram_num_codes(palette_code_bits))?,
            red: [0; NUM_LITERAL_CODES],
            blue: [0; NUM_LITERAL_CODES],
            alpha: [0; NUM_LITERAL_CODES],
            distance: [0; NUM_DISTANCE_CODES],
            channels: [Channel::default(); NUM_CHANNELS],
            bit_cost: 0,
            bin_id: 0,
        })
    }

    /// `VP8LHistogramCreate`
    pub(crate) fn from_refs(
        refs: &BackwardRefs,
        palette_code_bits: u32,
    ) -> Result<Self, EncodeError> {
        let mut histo = Self::new(palette_code_bits)?;
        histo.store_refs(refs, |distance| distance)?;
        Ok(histo)
    }

    fn clear(&mut self) {
        self.populations_mut().into_iter().for_each(|p| p.fill(0));
        self.channels = [Channel::default(); NUM_CHANNELS];
        self.bit_cost = 0;
        self.bin_id = 0;
    }

    fn copy_from(&mut self, src: &Self) -> Checked {
        self.literal.write_at(0, &src.literal)?;
        self.red = src.red;
        self.blue = src.blue;
        self.alpha = src.alpha;
        self.distance = src.distance;
        self.channels = src.channels;
        self.bit_cost = src.bit_cost;
        self.bin_id = src.bin_id;
        Ok(())
    }

    fn populations(&self) -> [&[u32]; NUM_CHANNELS] {
        [
            &self.literal,
            &self.red,
            &self.blue,
            &self.alpha,
            &self.distance,
        ]
    }

    pub(crate) fn populations_mut(&mut self) -> [&mut [u32]; NUM_CHANNELS] {
        [
            &mut self.literal,
            &mut self.red,
            &mut self.blue,
            &mut self.alpha,
            &mut self.distance,
        ]
    }

    fn is_used(&self) -> bool {
        self.channels.iter().any(|channel| channel.is_used)
    }

    /// `HistogramAddSinglePixOrCopy`
    #[inline]
    fn add_single_pix_or_copy(
        &mut self,
        v: PixOrCopy,
        distance_modifier: impl Fn(u32) -> u32,
    ) -> Checked {
        match v {
            PixOrCopy::Literal(argb) => {
                let [b, g, r, a] = argb.to_le_bytes();
                *self.alpha.at_mut(a.into())? += 1;
                *self.red.at_mut(r.into())? += 1;
                *self.literal.at_mut(g.into())? += 1;
                *self.blue.at_mut(b.into())? += 1;
            }
            PixOrCopy::CacheIdx(idx) => {
                let literal_ix = NUM_LITERAL_CODES + NUM_LENGTH_CODES + idx as usize;
                *self.literal.at_mut(literal_ix)? += 1;
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
    pub(crate) fn store_refs(
        &mut self,
        refs: &BackwardRefs,
        distance_modifier: impl Fn(u32) -> u32,
    ) -> Checked {
        for &v in refs.iter() {
            self.add_single_pix_or_copy(v, &distance_modifier)?;
        }
        Ok(())
    }

    /// `VP8LHistogramEstimateBits`: the entropy, the prefix codes and the extra bits.
    pub(crate) fn estimate_bits(&self) -> Checked<u64> {
        let cost = add_costs(
            self.populations()
                .map(|population| population_cost(population).cost),
        );
        let lengths = self
            .literal
            .sub(NUM_LITERAL_CODES..)?
            .sub(..NUM_LENGTH_CODES)?;
        let extra = extra_cost(lengths) + extra_cost(&self.distance);
        Ok(cost.wrapping_add(u64::from(extra) << LOG_2_PRECISION_BITS))
    }

    /// `ComputeHistogramCost`. The extra bits are left out: they stay the same however histograms are combined.
    fn compute_cost(&mut self) {
        let channels = self.populations().map(population_cost);
        self.bit_cost = add_costs(channels.map(|channel| channel.cost));
        self.channels = channels;
    }

    fn update_cost(&mut self, bit_cost: u64, costs: &[u64; NUM_CHANNELS]) {
        self.bit_cost = bit_cost;
        for (channel, &cost) in self.channels.iter_mut().zip(costs) {
            channel.cost = cost;
        }
    }

    /// `HistogramAdd(h1, self, self)`
    fn add(&mut self, h1: &Self) -> Checked {
        let channels = self.channels;
        for ((pout, p1), (out, c1)) in self
            .populations_mut()
            .into_iter()
            .zip(h1.populations())
            .zip(channels.iter().zip(&h1.channels))
        {
            if c1.is_used {
                if out.is_used {
                    add_vector_eq(p1, pout);
                } else {
                    pout.write_at(0, p1)?;
                }
            }
        }
        self.channels = combined_channels(&h1.channels, &channels);
        Ok(())
    }

    /// `HistogramAdd(h1, h2, self)`
    fn set_to_sum(&mut self, h1: &Self, h2: &Self) -> Checked {
        for (((pout, p1), p2), (c1, c2)) in self
            .populations_mut()
            .into_iter()
            .zip(h1.populations())
            .zip(h2.populations())
            .zip(h1.channels.iter().zip(&h2.channels))
        {
            match (c1.is_used, c2.is_used) {
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
        self.channels = combined_channels(&h1.channels, &h2.channels);
        Ok(())
    }
}

/// The flags of the sum of two histograms. The costs are not set. A channel that is trivial in one and unused in the
/// other does not count as trivial.
fn combined_channels(
    c1: &[Channel; NUM_CHANNELS],
    c2: &[Channel; NUM_CHANNELS],
) -> [Channel; NUM_CHANNELS] {
    let mut out = [Channel::default(); NUM_CHANNELS];
    for ((out, c1), c2) in out.iter_mut().zip(c1).zip(c2) {
        out.trivial_symbol = c1
            .trivial_symbol
            .filter(|_| c1.trivial_symbol == c2.trivial_symbol);
        out.is_used = c1.is_used || c2.is_used;
    }
    out
}

// -----------------------------------------------------------------------------
// Entropy-related functions.

/// From some 259 million symbols of 8 bits of entropy on, which an image of noise of the largest size has, the mix is
/// too much for the signed division, and the result is a small negative number as a `u64`. libwebp goes on with that,
/// so costs are added with `add_costs` and `wrapping_add`.
fn bits_entropy_refine(entropy: &BitEntropy) -> u64 {
    let sum = u64::from(entropy.sum) << LOG_2_PRECISION_BITS;
    // A prefix code cannot do as well as the entropy says when there are few symbols. Mixing some of the entropy
    // into that limit makes for better clusters.
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

pub(crate) fn add_costs<const N: usize>(costs: [u64; N]) -> u64 {
    costs.into_iter().fold(0, u64::wrapping_add)
}

/// `VP8LBitsEntropy`
pub(crate) fn bits_entropy(array: &[u32]) -> u64 {
    bits_entropy_refine(&bits_entropy_unrefined(array))
}

/// What the code lengths of a prefix code take, less a bias of 9.1 bits because they seldom are written in full.
const INITIAL_HUFFMAN_COST: u64 = ((CODE_LENGTH_CODES as u64 * 3) << LOG_2_PRECISION_BITS)
    - div_round::<10>(91 << LOG_2_PRECISION_BITS) as u64;

fn final_huffman_cost(stats: &Streaks) -> u64 {
    let [[zero_short, zero_long], [nonzero_short, nonzero_long]] = stats.streaks;
    let [zero_count, nonzero_count] = stats.counts;
    // In 1/1024 of a bit.
    let extra = zero_count * 1600
        + 240 * zero_long
        + nonzero_count * 2640
        + 720 * nonzero_long
        + 1840 * zero_short
        + 3360 * nonzero_short;
    INITIAL_HUFFMAN_COST + (u64::from(extra) << (LOG_2_PRECISION_BITS - 10))
}

/// `PopulationCost`
fn population_cost(population: &[u32]) -> Channel {
    let (bit_entropy, stats) = get_entropy_unrefined(population);
    let [_, [nonzero_short, nonzero_long]] = stats.streaks;
    Channel {
        trivial_symbol: (bit_entropy.nonzeros == 1).then_some(bit_entropy.nonzero_code as u16),
        cost: bits_entropy_refine(&bit_entropy).wrapping_add(final_huffman_cost(&stats)),
        is_used: nonzero_short != 0 || nonzero_long != 0,
    }
}

/// The cost of one channel of the sum of two histograms.
#[inline]
fn get_combined_entropy(x: &[u32], c1: &Channel, y: &[u32], c2: &Channel) -> u64 {
    let is_trivial = c1.trivial_symbol.is_some() && c1.trivial_symbol == c2.trivial_symbol;
    if is_trivial || !c1.is_used || !c2.is_used {
        return if c1.is_used { c1.cost } else { c2.cost };
    }
    let (bit_entropy, stats) = get_combined_entropy_unrefined(x, y);
    bits_entropy_refine(&bit_entropy).wrapping_add(final_huffman_cost(&stats))
}

// -----------------------------------------------------------------------------
// Various histogram combine/cost-eval functions

/// `a + b`, or `i64::MAX` if that is less.
const fn saturate_add(a: u64, b: i64) -> i64 {
    if b < 0 || a as i64 <= i64::MAX - b {
        b.wrapping_add(a as i64)
    } else {
        i64::MAX
    }
}

/// The cost of `a + b` and of each of its channels, unless that is `cost_threshold` or more.
fn get_combined_histogram_entropy(
    a: &Histogram,
    b: &Histogram,
    cost_threshold: i64,
) -> Option<(u64, [u64; NUM_CHANNELS])> {
    if cost_threshold <= 0 {
        return None;
    }
    let mut cost = 0u64;
    let mut costs = [0; NUM_CHANNELS];
    for (((out, (x, c1)), y), c2) in costs
        .iter_mut()
        .zip(a.populations().into_iter().zip(&a.channels))
        .zip(b.populations())
        .zip(&b.channels)
    {
        *out = get_combined_entropy(x, c1, y, c2);
        cost = cost.wrapping_add(*out);
        if cost >= cost_threshold as u64 {
            return None;
        }
    }
    Some((cost, costs))
}

/// `C(a + b) - C(a)`, unless that is `cost_threshold` or more.
fn histogram_add_thresh(a: &Histogram, b: &Histogram, cost_threshold: i64) -> Option<i64> {
    let cost_threshold = saturate_add(a.bit_cost, cost_threshold);
    let (cost, _) = get_combined_histogram_entropy(a, b, cost_threshold)?;
    Some(cost as i64 - a.bit_cost as i64)
}

// -----------------------------------------------------------------------------

/// `VP8LHistogramSet`, where `VP8LGetHistoImageSymbols` combines histograms.
struct HistogramSet {
    histograms: Vec<Histogram>,
    /// Where in `histograms` each histogram of the set is. Removing one leaves the elements from `size` on as they
    /// are, and `histogram_combine_stochastic` still looks at the one at `size`.
    slots: Vec<usize>,
    size: usize,
    /// Where in `histograms` the one is that is not part of the set.
    spare: usize,
}

impl HistogramSet {
    fn new(max_size: usize, cache_bits: u32) -> Result<Self, OutOfMemory> {
        let mut histograms = Vec::new();
        let mut slots = Vec::new();
        histograms
            .try_reserve_exact(max_size + 1)
            .map_err(|_| OutOfMemory)?;
        slots.try_reserve_exact(max_size).map_err(|_| OutOfMemory)?;
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

    /// `HistogramAddEval`: makes the spare histogram the sum of `a` and `b`, if `C(a + b) - C(a) - C(b)` is less than
    /// `cost_threshold`.
    fn add_eval_to_spare(&mut self, a: usize, b: usize, cost_threshold: i64) -> Checked<bool> {
        let slots = [self.slots.at(a)?, self.slots.at(b)?, self.spare];
        let [a, b, out] = self.histograms.get_disjoint_mut(slots).map_err(|_| Bug)?;
        let cost_threshold = saturate_add(a.bit_cost.wrapping_add(b.bit_cost), cost_threshold);
        let Some((bit_cost, costs)) = get_combined_histogram_entropy(a, b, cost_threshold) else {
            return Ok(false);
        };
        out.set_to_sum(a, b)?;
        out.update_cost(bit_cost, &costs);
        Ok(true)
    }
}

fn get_bin_id_for_entropy(min: u64, max: u64, val: u64) -> usize {
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
    xsize: usize,
    histo_bits: u32,
    backward_refs: &BackwardRefs,
    histograms: &mut [Histogram],
) -> Checked {
    let histo_xsize = sub_sample_size(xsize, histo_bits);
    let (mut x, mut y) = (0, 0);
    for &v in backward_refs.iter() {
        let ix = (y >> histo_bits) * histo_xsize + (x >> histo_bits);
        histograms
            .at_mut(ix)?
            .add_single_pix_or_copy(v, |distance| distance)?;
        x += v.length();
        while x >= xsize {
            x -= xsize;
            y += 1;
        }
    }
    Ok(())
}

/// `HistogramCopyAndAnalyze`: computes the costs of the histograms and copies those that are not empty, as those of
/// tiles that a copy skips are.
fn histogram_copy_and_analyze(
    orig_histo: &mut [Histogram],
    image_histo: &mut HistogramSet,
) -> Checked {
    image_histo.size = 0;
    for histo in orig_histo {
        histo.compute_cost();
        if histo.is_used() {
            image_histo.get_mut(image_histo.size)?.copy_from(histo)?;
            image_histo.size += 1;
        }
    }
    Ok(())
}

/// `HistogramAnalyzeEntropyBin`: sorts the histograms into bins by the costs of their three dominant channels.
fn histogram_analyze_entropy_bin(image_histo: &mut HistogramSet) -> Checked {
    let mut min = [u64::MAX; 3];
    let mut max = [0u64; 3];
    for i in 0..image_histo.size {
        for ((min, max), channel) in min
            .iter_mut()
            .zip(&mut max)
            .zip(&image_histo.get(i)?.channels)
        {
            *min = (*min).min(channel.cost);
            *max = (*max).max(channel.cost);
        }
    }
    for i in 0..image_histo.size {
        let histo = image_histo.get_mut(i)?;
        histo.bin_id =
            min.iter()
                .zip(&max)
                .zip(&histo.channels)
                .fold(0, |bin_id, ((&min, &max), channel)| {
                    bin_id * NUM_PARTITIONS + get_bin_id_for_entropy(min, max, channel.cost)
                });
    }
    Ok(())
}

/// Red, blue and alpha each have a single value.
fn is_trivial_but_for_literal(histo: &Histogram) -> bool {
    let [_, red, blue, alpha, _] = &histo.channels;
    red.trivial_symbol.is_some() && blue.trivial_symbol.is_some() && alpha.trivial_symbol.is_some()
}

/// `HistogramCombineEntropyBin`: merges histograms of the same bin where that pays. `combine_cost_factor` is a
/// percentage.
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
        // Merging a histogram that is trivial into one that is not costs more than the estimate says. When that
        // holds back too many merges, the prefix codes of all those histograms cost even more.
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

/// A Lehmer random number generator: times 48271, modulo 2^31 - 1.
fn my_rand(seed: &mut u32) -> u32 {
    *seed = ((u64::from(*seed) * 48271) % 2_147_483_647) as u32;
    *seed
}

// -----------------------------------------------------------------------------
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
    costs: [u64; NUM_CHANNELS],
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
            get_combined_histogram_entropy(h1, h2, cost_threshold).map(|(cost_combo, costs)| {
                Self {
                    idx1,
                    idx2,
                    cost_diff: cost_combo as i64 - sum_cost as i64,
                    cost_combo,
                    costs,
                }
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
    fn new(max_size: usize) -> Result<Self, OutOfMemory> {
        let mut queue = Vec::new();
        queue.try_reserve_exact(max_size).map_err(|_| OutOfMemory)?;
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

    /// `HistoQueuePush`: adds the pair if there is room and merging it changes the cost by less than `threshold`, which
    /// is not positive. Returns that change, or else 0.
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

// -----------------------------------------------------------------------------

/// Merges the pair that saves the most, over and over.
fn histogram_combine_greedy(image_histo: &mut HistogramSet) -> Result<(), EncodeError> {
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

/// Merges the best of a few pairs picked at random, over and over. Returns whether there are few enough histograms
/// left for `histogram_combine_greedy`.
fn histogram_combine_stochastic(
    image_histo: &mut HistogramSet,
    min_cluster_size: usize,
) -> Result<bool, EncodeError> {
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
                let tmp = my_rand(&mut seed) % rand_range;
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

// -----------------------------------------------------------------------------
// Histogram refinement

/// `HistogramRemap`: finds the best cluster for each tile, then makes each cluster the sum of its tiles. Returns the
/// clusters.
fn histogram_remap(
    in_histo: &[Histogram],
    out: HistogramSet,
    symbols: &mut [u32],
) -> Checked<Vec<Histogram>> {
    let out_size = out.size;
    if out_size > 1 {
        let mut previous = 0;
        for (histo, symbol) in in_histo.iter().zip(symbols.iter_mut()) {
            // A tile without symbols takes the cluster of the one before it, which is cheap to write.
            if histo.is_used() {
                let mut best_bits = i64::MAX;
                previous = 0;
                for k in 0..out_size {
                    if let Some(cur_bits) = histogram_add_thresh(out.get(k)?, histo, best_bits) {
                        best_bits = cur_bits;
                        previous = k as u32;
                    }
                }
            }
            *symbol = previous;
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

fn get_combine_cost_factor(histo_size: usize, quality: i32) -> i64 {
    let mut combine_cost_factor = 16;
    if histo_size > 256 {
        combine_cost_factor /= 2;
    }
    if histo_size > 512 {
        combine_cost_factor /= 2;
    }
    if histo_size > 1024 {
        combine_cost_factor /= 2;
    }
    if quality <= 50 {
        combine_cost_factor /= 2;
    }
    combine_cost_factor
}

/// `VP8LGetHistoImageSymbols`: returns the histograms of the clusters, and in `histogram_symbols` the cluster of each
/// tile of `1 << histogram_bits` pixels squared.
pub(crate) fn get_histo_image_symbols(
    xsize: usize,
    refs: &BackwardRefs,
    quality: i32,
    histogram_bits: u32,
    cache_bits: u32,
    histogram_symbols: &mut [u32],
) -> Result<Vec<Histogram>, EncodeError> {
    let image_histo_raw_size = histogram_symbols.len();
    let mut orig_histo = Vec::new();
    orig_histo
        .try_reserve_exact(image_histo_raw_size)
        .map_err(|_| OutOfMemory)?;
    for _ in 0..image_histo_raw_size {
        orig_histo.push(Histogram::new(cache_bits)?);
    }
    let mut image_histo = HistogramSet::new(image_histo_raw_size, cache_bits)?;

    histogram_build(xsize, histogram_bits, refs, &mut orig_histo)?;
    histogram_copy_and_analyze(&mut orig_histo, &mut image_histo)?;

    // With few histograms the bins would be nearly empty.
    if image_histo.size > BIN_SIZE * 2 {
        let combine_cost_factor = get_combine_cost_factor(image_histo_raw_size, quality);
        histogram_analyze_entropy_bin(&mut image_histo)?;
        histogram_combine_entropy_bin(&mut image_histo, combine_cost_factor)?;
    }

    // A cubic ramp between 1 and MAX_HISTO_GREEDY.
    let quality = i64::from(quality);
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
