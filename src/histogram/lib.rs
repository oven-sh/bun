//! A histogram of integers that keeps a fixed number of significant decimal digits over its whole range. It backs
//! `createHistogram()` and `monitorEventLoopDelay()` of `node:perf_hooks`.
//!
//! The layout and the results are those of HdrHistogram, which Node.js uses:
//! - https://github.com/HdrHistogram/HdrHistogram_c (Michael Barker, CC0 1.0 or BSD 2-Clause)
//!
//! They differ on purpose where the library or Node.js overflows or contradicts itself. Each such place says
//! "Node.js:", and `test/js/bun/perf_hooks/histogram.test.ts` marks its test `notInNode`.
//!
//! Values are counted in buckets. Bucket 0 has `sub_bucket_count` slots, each `1 << unit_magnitude` wide. Every later
//! bucket covers twice the range of the one before it with slots twice as wide, and only its upper half is stored:
//! the lower half is what the earlier buckets cover. So a value is known to within one slot, and every result
//! is an edge or the middle of a slot.
//!
//! The counts, the moments and the percentiles do not depend on the platform's `libm`: their only float operations are
//! the IEEE-exact ones. The tests, the confidence intervals and the density estimate do.

#![feature(float_erf, float_gamma)]
#![forbid(unsafe_code)]
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

mod buckets;
mod cbor;
mod distributions;
mod qrde;
mod sliding_window;
mod statistics;

pub use qrde::{Dequantize, Qrde, RecordedSlots};
pub use sliding_window::{Rotation, SlidingWindow};
pub use statistics::{Interval, MannWhitney, Welch};

/// What an empty histogram reports as its minimum.
const EMPTY_MIN: u64 = i64::MAX as u64;

/// The counts of 512 slots in a row: 4 KiB.
type Chunk = [u64; CHUNK_LEN];
const CHUNK_LEN: usize = 512;

#[derive(Clone)]
pub struct Histogram {
    lowest_discernible_value: u64,
    highest_trackable_value: u64,
    significant_figures: u32,
    unit_magnitude: u32,
    sub_bucket_half_count_magnitude: u32,
    /// One for every `CHUNK_LEN` slots that a value can reach, or none at all while the histogram is empty. A chunk
    /// exists once one of its slots is used, so the memory depends on how many different values were recorded and
    /// not on how large they are: all the slots would take 360 KB with 3 figures, and 38 MB with 5.
    chunks: Vec<Option<Box<Chunk>>>,
    /// How many of `chunks` exist.
    chunk_count: usize,
    /// The sum of the counts, so no slot and no partial sum overflows.
    count: u64,
    exceeds: u64,
    /// The first and the last slot that is not zero. `first > last` while the histogram is empty.
    first: usize,
    last: usize,
    /// How far HdrHistogram would have the counts rotated: the count of a slot is this many places before it. Only
    /// [`Self::import`] sets it, and only [`Self::export`] and [`Self::diff`] look at it.
    normalizing_index_offset: usize,
    /// How many times values were removed.
    reset_count: u64,
    ewma: Ewma,
}

/// Averages that weigh each value `1 - alpha` times as much as the one after it.
#[derive(Clone, Copy, Default)]
struct Ewma {
    /// 0 if there are none.
    alpha: f64,
    mean: f64,
    variance: f64,
    /// Of whether a value is above `threshold`.
    error_rate: f64,
    /// 0 if there is none.
    threshold: u64,
    /// Whether a value was recorded.
    initialized: bool,
}

impl Ewma {
    fn update(&mut self, value: u64) {
        if self.alpha <= 0.0 {
            return;
        }
        let value = value as f64;
        let exceeded = if value > self.threshold as f64 {
            1.0
        } else {
            0.0
        };
        if !self.initialized {
            self.initialized = true;
            self.mean = value;
            self.variance = 0.0;
            if self.threshold > 0 {
                self.error_rate = exceeded;
            }
            return;
        }
        let difference = value - self.mean;
        self.mean += self.alpha * difference;
        self.variance = (1.0 - self.alpha) * (self.variance + self.alpha * difference * difference);
        if self.threshold > 0 {
            self.error_rate += self.alpha * (exceeded - self.error_rate);
        }
    }

    fn reset(&mut self) {
        *self = Self {
            alpha: self.alpha,
            threshold: self.threshold,
            ..Self::default()
        };
    }
}

/// Why there is no [`Histogram::diff`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffError {
    /// The two do not have the same range and precision.
    Incompatible,
    /// Values were removed from one and not from the other.
    Reset,
    /// The other one has values that this one does not.
    NotEarlier,
}

/// The values that one slot stands for.
#[derive(Clone, Copy)]
struct Slot {
    lowest: u64,
    /// A power of two. `lowest + width` is at most `1 << 63`.
    width: u64,
}

impl Slot {
    fn highest(self) -> u64 {
        self.lowest + (self.width - 1)
    }

    fn median(self) -> u64 {
        self.lowest + (self.width >> 1)
    }
}

impl Histogram {
    /// Counts the values up to `highest`, telling apart any two that differ by `lowest` or more and in their first
    /// `figures` decimal digits. `None` unless `1 <= lowest`, `2 * lowest <= highest <= i64::MAX`, `1 <= figures <= 5`
    /// and a bucket of slots as wide as `lowest` fits in 62 bits.
    pub fn new(lowest: u64, highest: u64, figures: u32) -> Option<Self> {
        if lowest < 1 || highest > EMPTY_MIN || lowest > highest / 2 || !(1..=5).contains(&figures)
        {
            return None;
        }
        let sub_bucket_count = (2 * 10u64.pow(figures)).next_power_of_two();
        let sub_bucket_half_count_magnitude = sub_bucket_count.ilog2() - 1;
        let unit_magnitude = lowest.ilog2();
        if unit_magnitude + sub_bucket_half_count_magnitude > 61 {
            return None;
        }
        Some(Self {
            lowest_discernible_value: lowest,
            highest_trackable_value: highest,
            significant_figures: figures,
            unit_magnitude,
            sub_bucket_half_count_magnitude,
            chunks: Vec::new(),
            chunk_count: 0,
            count: 0,
            exceeds: 0,
            first: usize::MAX,
            last: 0,
            normalizing_index_offset: 0,
            reset_count: 0,
            ewma: Ewma::default(),
        })
    }

    /// Also keeps averages in which a value weighs half as much once `half_life` more were recorded, if that is above 0,
    /// and with them the rate of the values above `threshold`, if that is above 0.
    pub fn with_ewma(mut self, half_life: f64, threshold: u64) -> Self {
        if half_life > 0.0 {
            self.ewma.alpha = 1.0 - (-(2.0f64.ln()) / half_life).exp();
        }
        self.ewma.threshold = threshold;
        self
    }

    /// An empty histogram of the same range and precision.
    fn same_layout(&self) -> Self {
        Self {
            chunks: Vec::new(),
            chunk_count: 0,
            count: 0,
            exceeds: 0,
            first: usize::MAX,
            last: 0,
            reset_count: 0,
            ewma: Ewma::default(),
            ..*self
        }
    }

    /// Whether `value` was counted. One above the highest trackable value adds to [`Self::exceeds`] instead.
    pub fn record(&mut self, value: u64) -> bool {
        let recorded = self.record_n(value, 1);
        if recorded {
            self.ewma.update(value);
        }
        recorded
    }

    /// Records `value`, and what would have been measured every `expected_interval` while it was being measured:
    /// `value - expected_interval`, `value - 2 * expected_interval` and so on, down to `expected_interval`.
    ///
    /// Node.js: one at a time, which takes forever for a large value and a small interval.
    pub fn record_corrected(&mut self, value: u64, expected_interval: u64) -> bool {
        if !self.record_n(value, 1) {
            return false;
        }
        let mut missing = value.checked_sub(expected_interval);
        while let Some(highest) = missing
            && expected_interval > 0
            && highest >= expected_interval
        {
            let lowest = self
                .slot(self.index_of(highest))
                .lowest
                .max(expected_interval);
            let in_this_slot = (highest - lowest) / expected_interval + 1;
            if !self.record_n(highest, in_this_slot) {
                return false;
            }
            missing = highest.checked_sub(in_this_slot * expected_interval);
        }
        self.ewma.update(value);
        true
    }

    fn record_n(&mut self, value: u64, n: u64) -> bool {
        if value <= self.highest_trackable_value
            && let Some(count) = self.count.checked_add(n)
            && self.add_at(self.index_of(value), n)
        {
            self.count = count;
            return true;
        }
        self.exceeds = self.exceeds.saturating_add(n);
        false
    }

    /// Adds `n`, which is not 0, to the slot at `index` and not to `count`. Whether there is such a slot.
    fn add_at(&mut self, index: usize, n: u64) -> bool {
        if !matches!(self.chunks.get(index / CHUNK_LEN), Some(Some(_))) {
            self.add_chunk(index / CHUNK_LEN);
        }
        if let Some(Some(chunk)) = self.chunks.get_mut(index / CHUNK_LEN)
            && let Some(slot) = chunk.get_mut(index % CHUNK_LEN)
        {
            *slot += n;
            self.first = self.first.min(index);
            self.last = self.last.max(index);
            return true;
        }
        false
    }

    /// `index` is that of a chunk that does not exist.
    #[cold]
    fn add_chunk(&mut self, index: usize) {
        if self.chunks.is_empty() {
            self.chunks = vec![None; self.slot_count().div_ceil(CHUNK_LEN)];
        }
        if let Some(chunk) = self.chunks.get_mut(index) {
            *chunk = Some(Box::new([0; CHUNK_LEN]));
            self.chunk_count += 1;
        }
    }

    /// Counts everything `other` counted, each value as the lowest of its slot in `other`. All of it is refused if the
    /// count could overflow: adding a part would change the shape of the distribution.
    ///
    /// Node.js: a value that does not fit here is dropped without adding to `exceeds`.
    pub fn add(&mut self, other: &Self) {
        self.exceeds = self.exceeds.saturating_add(other.exceeds);
        if self.count.checked_add(other.count).is_none() {
            self.exceeds = self.exceeds.saturating_add(other.count);
            return;
        }
        for (slot, n) in other.slots() {
            self.record_n(slot.lowest, n);
        }
    }

    /// Takes away what `other` counted, each value as the lowest of its slot in `other`, as far as it is here.
    ///
    /// Node.js: slot by slot, whatever values the slots of the two stand for.
    pub fn subtract(&mut self, other: &Self) {
        for (slot, n) in other.slots() {
            let index = self.index_of(slot.lowest);
            if let Some(Some(chunk)) = self.chunks.get_mut(index / CHUNK_LEN)
                && let Some(count) = chunk.get_mut(index % CHUNK_LEN)
            {
                *count = count.saturating_sub(n);
            }
        }
        self.exceeds = self.exceeds.saturating_sub(other.exceeds);
        self.reset_count += 1;
        self.recount();
    }

    /// Sets what is derived from the counts of the slots, whose sum does not overflow.
    fn recount(&mut self) {
        self.first = 0;
        self.last = (self.chunks.len() * CHUNK_LEN).saturating_sub(1);
        let in_use = || {
            let counts = self
                .existing_chunks()
                .flat_map(|(index, chunk)| chunk.iter().zip(index..));
            counts.filter(|&(&n, _)| n != 0)
        };
        let first = in_use().next().map_or(usize::MAX, |(_, index)| index);
        let last = in_use().last().map_or(0, |(_, index)| index);
        let count = in_use().map(|(&n, _)| n).sum();
        (self.first, self.last, self.count) = (first, last, count);
    }

    /// What was recorded here since `other`, which is an earlier copy of this histogram, was made.
    pub fn diff(&self, other: &Self) -> Result<Self, DiffError> {
        if !self.is_compatible(other)
            || self.normalizing_index_offset != other.normalizing_index_offset
        {
            return Err(DiffError::Incompatible);
        }
        if self.reset_count != other.reset_count {
            return Err(DiffError::Reset);
        }
        let mut diff = Self {
            chunks: self.chunks.clone(),
            chunk_count: self.chunk_count,
            ..self.same_layout()
        };
        diff.exceeds = self
            .exceeds
            .checked_sub(other.exceeds)
            .ok_or(DiffError::NotEarlier)?;
        for (index, chunk) in other.existing_chunks() {
            for (&n, index) in chunk.iter().zip(index..).filter(|&(&n, _)| n != 0) {
                let count = match diff.chunks.get_mut(index / CHUNK_LEN) {
                    Some(Some(chunk)) => chunk.get_mut(index % CHUNK_LEN),
                    _ => None,
                };
                let count = count.ok_or(DiffError::NotEarlier)?;
                *count = count.checked_sub(n).ok_or(DiffError::NotEarlier)?;
            }
        }
        diff.recount();
        Ok(diff)
    }

    /// Whether the two have the same range and precision.
    pub fn is_compatible(&self, other: &Self) -> bool {
        self.lowest_discernible_value == other.lowest_discernible_value
            && self.highest_trackable_value == other.highest_trackable_value
            && self.significant_figures == other.significant_figures
    }

    /// Moves everything out, which leaves `self` as it was when it was created.
    pub fn take(&mut self) -> Self {
        let empty = Self {
            ewma: Ewma {
                alpha: self.ewma.alpha,
                threshold: self.ewma.threshold,
                ..Ewma::default()
            },
            ..self.same_layout()
        };
        core::mem::replace(self, empty)
    }

    pub fn reset(&mut self) {
        self.chunks = Vec::new();
        self.chunk_count = 0;
        self.count = 0;
        self.exceeds = 0;
        self.first = usize::MAX;
        self.last = 0;
        self.reset_count += 1;
        self.ewma.reset();
    }

    /// How many times values were removed: by [`Self::reset`] and by [`Self::subtract`].
    pub fn reset_count(&self) -> u64 {
        self.reset_count
    }

    /// 0 until a value is recorded, and without [`Self::with_ewma`].
    pub fn ewma_mean(&self) -> f64 {
        self.ewma.mean
    }

    pub fn ewma_stddev(&self) -> f64 {
        self.ewma.variance.sqrt()
    }

    pub fn ewma_error_rate(&self) -> f64 {
        self.ewma.error_rate
    }

    /// How many values were counted.
    pub fn count(&self) -> u64 {
        self.count
    }

    /// How many values were not counted.
    pub fn exceeds(&self) -> u64 {
        self.exceeds
    }

    /// The lowest value of the first slot in use, or `i64::MAX` if there is none.
    pub fn min(&self) -> u64 {
        if self.count == 0 {
            return EMPTY_MIN;
        }
        self.slot(self.first).lowest
    }

    /// The highest value of the last slot in use, or 0 if there is none.
    pub fn max(&self) -> u64 {
        if self.count == 0 {
            return 0;
        }
        self.slot(self.last).highest()
    }

    /// NaN if the histogram is empty.
    pub fn mean(&self) -> f64 {
        // At most `count * (1 << 63)`.
        let sum: u128 = self
            .slots()
            .map(|(slot, n)| u128::from(slot.median()) * u128::from(n))
            .sum();
        sum as f64 / self.count as f64
    }

    /// NaN if the histogram is empty.
    pub fn stddev(&self) -> f64 {
        let mean = self.mean();
        let sum = self.slots().fold(0.0, |sum, (slot, n)| {
            let deviation = slot.median() as f64 - mean;
            sum + deviation * deviation * n as f64
        });
        (sum / self.count as f64).sqrt()
    }

    /// The sums of the second and of the `power`th powers of the distances to the mean, over the count.
    fn central_moments(&self, power: i32) -> (f64, f64) {
        let mean = self.mean();
        let (second, other) = self.slots().fold((0.0, 0.0), |(second, other), (slot, n)| {
            let deviation = slot.median() as f64 - mean;
            let squared = deviation * deviation;
            let weighted = n as f64 * squared;
            let factor = if power == 3 { deviation } else { squared };
            (second + weighted, other + weighted * factor)
        });
        (second / self.count as f64, other / self.count as f64)
    }

    /// How much longer the upper tail is than the lower one. 0 with fewer than 3 values, or if all are the same.
    pub fn skewness(&self) -> f64 {
        if self.count < 3 {
            return 0.0;
        }
        let (variance, third) = self.central_moments(3);
        if variance == 0.0 {
            return 0.0;
        }
        third / (variance * variance.sqrt())
    }

    /// How much heavier the tails are than those of a normal distribution. 0 with fewer than 4 values, or if all are the
    /// same.
    pub fn kurtosis(&self) -> f64 {
        if self.count < 4 {
            return 0.0;
        }
        let (variance, fourth) = self.central_moments(4);
        if variance == 0.0 {
            return 0.0;
        }
        fourth / (variance * variance) - 3.0
    }

    /// The share of the values in the slot of `value` and in those below it. 0 if the histogram is empty.
    ///
    /// Node.js: a negative value is in the first slot.
    pub fn cdf(&self, value: i64) -> f64 {
        let Ok(value) = u64::try_from(value) else {
            return 0.0;
        };
        if self.count == 0 {
            return 0.0;
        }
        let up_to = self.index_of(value);
        let below: u64 = self
            .existing_chunks()
            .flat_map(|(index, chunk)| chunk.iter().zip(index..))
            .take_while(|&(_, index)| index <= up_to)
            .map(|(&n, _)| n)
            .sum();
        below as f64 / self.count as f64
    }

    /// How many values are in the slot of `value`.
    pub fn count_at(&self, value: i64) -> u64 {
        match u64::try_from(value) {
            Ok(value) => self.count_at_index(self.index_of(value)),
            Err(_) => 0,
        }
    }

    fn count_at_index(&self, index: usize) -> u64 {
        match self.chunks.get(index / CHUNK_LEN) {
            Some(Some(chunk)) => chunk.get(index % CHUNK_LEN).copied().unwrap_or(0),
            _ => 0,
        }
    }

    /// The highest value of the slot at or below which `percentile` percent of the values are, or 0 if the histogram
    /// is empty. `percentile` is at most 100, and the value at 0 is the minimum.
    ///
    /// Node.js: the highest value of slot 0 if the histogram is empty, which is 511 with a `lowest` of 1000.
    pub fn value_at_percentile(&self, percentile: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        let slot = self.slot(self.index_of_rank(self.rank_at_percentile(percentile)));
        if percentile == 0.0 {
            return slot.lowest;
        }
        slot.highest()
    }

    /// From 1 to `count`, which is not 0.
    fn rank_at_percentile(&self, percentile: f64) -> u64 {
        let count = self.count as f64;
        let rank = (percentile / 100.0) * count + 0.5;
        // `count` may have been rounded down, and 100 percent is every value.
        if rank >= count {
            self.count
        } else {
            (rank as u64).max(1)
        }
    }

    /// [`Self::value_at_percentile`] of each of `percentiles`, which are in ascending order.
    ///
    /// Node.js: 1 for each if the histogram is empty.
    pub fn values_at_percentiles(&self, percentiles: &[f64]) -> Vec<u64> {
        let mut values = Vec::with_capacity(percentiles.len());
        if self.count > 0 {
            let mut ranks = percentiles
                .iter()
                .map(|&p| self.rank_at_percentile(p))
                .peekable();
            let mut seen = 0;
            for (slot, n) in self.slots() {
                seen += n;
                while ranks.next_if(|&rank| rank <= seen).is_some() {
                    values.push(slot.highest());
                }
            }
        }
        values.resize(percentiles.len(), 0);
        values
    }

    /// The slot of the `rank`th lowest value, counting from 1. `rank` is at most `count`.
    fn index_of_rank(&self, rank: u64) -> usize {
        const BLOCK: usize = 16;
        let mut seen = 0;
        for (mut index, chunk) in self.existing_chunks() {
            for block in chunk.chunks(BLOCK) {
                let in_block: u64 = block.iter().sum();
                if seen + in_block < rank {
                    seen += in_block;
                    index += block.len();
                    continue;
                }
                for &n in block {
                    seen += n;
                    if seen >= rank {
                        return index;
                    }
                    index += 1;
                }
            }
        }
        self.last
    }

    /// The values at 0, 50, 75, 87.5 percent and so on, halving the distance to 100 until the last slot in use is
    /// reached, and then the value at 100. The value at 0 is the minimum, and the others are as
    /// [`Self::value_at_percentile`] rounds them.
    ///
    /// Node.js: the lowest value of each slot, so its value at 100 can be below a recorded value and below `max`.
    pub fn percentiles(&self) -> Vec<(f64, u64)> {
        let mut percentiles = Vec::new();
        let mut target = 0.0;
        let mut step = 50.0;
        let mut seen = 0;
        for (slot, n) in self.slots() {
            seen += n;
            let reached = 100.0 * seen as f64 / self.count as f64;
            // `target` is rounded up to 100 after 53 steps.
            while target <= reached && target < 100.0 {
                let value = if target == 0.0 {
                    slot.lowest
                } else {
                    slot.highest()
                };
                percentiles.push((target, value));
                target += step;
                step /= 2.0;
                if seen == self.count {
                    break;
                }
            }
        }
        percentiles.push((100.0, self.max()));
        percentiles
    }

    /// The slots in use, for [`RecordedSlots::qrde`].
    pub fn recorded_slots(&self) -> RecordedSlots {
        let mut cumulative_count = 0;
        let slots = self.slots().map(|(slot, count)| {
            cumulative_count += count;
            qrde::RecordedSlot {
                value: slot.median() as f64,
                width: slot.width as f64,
                count,
                cumulative_count,
            }
        });
        RecordedSlots {
            slots: slots.collect(),
            count: self.count,
        }
    }

    /// The bytes this histogram occupies. Recording a value can raise it.
    pub fn memory_size(&self) -> usize {
        size_of::<Self>()
            + self.chunks.capacity() * size_of::<Option<Box<Chunk>>>()
            + self.chunk_count * size_of::<Chunk>()
    }

    /// How many slots HdrHistogram has for this range and precision. The last ones are past the highest trackable value.
    fn slot_count(&self) -> usize {
        let magnitude = self.sub_bucket_half_count_magnitude;
        let mut smallest_untrackable = 2u64 << (magnitude + self.unit_magnitude);
        let mut buckets = 1;
        while smallest_untrackable <= self.highest_trackable_value {
            smallest_untrackable <<= 1;
            buckets += 1;
        }
        (buckets + 1) << magnitude
    }

    /// `value` is at most `i64::MAX`.
    fn index_of(&self, value: u64) -> usize {
        let magnitude = self.sub_bucket_half_count_magnitude;
        // The bit that a value has to reach to be past bucket 0.
        let bucket_0_bits = self.unit_magnitude + magnitude + 1;
        let bucket = (u64::BITS - value.leading_zeros()).saturating_sub(bucket_0_bits);
        // In the upper half of the sub-buckets, unless this is bucket 0.
        let sub_bucket = value >> (bucket + self.unit_magnitude);
        ((bucket as usize) << magnitude) + sub_bucket as usize
    }

    /// `index` is below [`Self::slot_count`].
    fn slot(&self, index: usize) -> Slot {
        let magnitude = self.sub_bucket_half_count_magnitude;
        let half_count = 1 << magnitude;
        let (bucket, sub_bucket) = match index >> magnitude {
            0 => (0, index),
            n => (n - 1, (index & (half_count - 1)) + half_count),
        };
        let shift = bucket as u32 + self.unit_magnitude;
        Slot {
            lowest: (sub_bucket as u64) << shift,
            width: 1 << shift,
        }
    }

    /// The slots in use and their counts, from the lowest.
    fn slots(&self) -> impl Iterator<Item = (Slot, u64)> {
        self.existing_chunks()
            .flat_map(|(index, chunk)| chunk.iter().zip(index..))
            .filter(|&(&n, _)| n != 0)
            .map(|(&n, index)| (self.slot(index), n))
    }

    /// Each with the index of its first slot, from the lowest.
    fn existing_chunks(&self) -> impl Iterator<Item = (usize, &Chunk)> {
        let first = self.first / CHUNK_LEN;
        let occupied = self.chunks.get(first..=self.last / CHUNK_LEN);
        occupied
            .unwrap_or_default()
            .iter()
            .zip((first * CHUNK_LEN..).step_by(CHUNK_LEN))
            .filter_map(|(chunk, index)| Some((index, chunk.as_deref()?)))
    }
}
