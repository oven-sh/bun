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
//! Nothing here depends on the platform's `libm`: the only float operations are the IEEE-exact ones.

#![forbid(unsafe_code)]
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

/// What an empty histogram reports as its minimum.
const EMPTY_MIN: u64 = i64::MAX as u64;

/// The counts of 512 slots in a row: 4 KiB.
type Chunk = [u64; CHUNK_LEN];
const CHUNK_LEN: usize = 512;

#[derive(Clone)]
pub struct Histogram {
    highest_trackable_value: u64,
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
            highest_trackable_value: highest,
            unit_magnitude,
            sub_bucket_half_count_magnitude,
            chunks: Vec::new(),
            chunk_count: 0,
            count: 0,
            exceeds: 0,
            first: usize::MAX,
            last: 0,
        })
    }

    /// Whether `value` was counted. One above the highest trackable value adds to [`Self::exceeds`] instead.
    pub fn record(&mut self, value: u64) -> bool {
        self.record_n(value, 1)
    }

    fn record_n(&mut self, value: u64, n: u64) -> bool {
        if value <= self.highest_trackable_value
            && let Some(count) = self.count.checked_add(n)
        {
            let index = self.index_of(value);
            if !matches!(self.chunks.get(index / CHUNK_LEN), Some(Some(_))) {
                self.add_chunk(index / CHUNK_LEN);
            }
            if let Some(Some(chunk)) = self.chunks.get_mut(index / CHUNK_LEN)
                && let Some(slot) = chunk.get_mut(index % CHUNK_LEN)
            {
                *slot += n;
                self.count = count;
                self.first = self.first.min(index);
                self.last = self.last.max(index);
                return true;
            }
        }
        self.exceeds = self.exceeds.saturating_add(n);
        false
    }

    /// `index` is that of a chunk that does not exist.
    #[cold]
    fn add_chunk(&mut self, index: usize) {
        if self.chunks.is_empty() {
            let last_slot = self.index_of(self.highest_trackable_value);
            self.chunks = vec![None; last_slot / CHUNK_LEN + 1];
        }
        if let Some(chunk) = self.chunks.get_mut(index) {
            *chunk = Some(Box::new([0; CHUNK_LEN]));
            self.chunk_count += 1;
        }
    }

    /// Counts everything `other` counted, each value as the lowest of its slot in `other`. All of it is refused if the
    /// count could overflow: adding a part would change the shape of the distribution.
    ///
    /// Node.js: a value that does not fit here still adds to `count`, and not to `exceeds`.
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

    /// Moves the counts out, which leaves `self` as it was when it was created.
    pub fn take(&mut self) -> Self {
        let taken = Self {
            chunks: core::mem::take(&mut self.chunks),
            ..*self
        };
        self.reset();
        taken
    }

    pub fn reset(&mut self) {
        self.chunks = Vec::new();
        self.chunk_count = 0;
        self.count = 0;
        self.exceeds = 0;
        self.first = usize::MAX;
        self.last = 0;
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
    ///
    /// Node.js: the sum is an `i64` and overflows, so the mean of large values can be negative.
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

    /// The highest value of the slot at or below which `percentile` percent of the values are, or 0 if the histogram
    /// is empty. `percentile` is above 0 and at most 100.
    ///
    /// Node.js: the highest value of slot 0 if the histogram is empty, which is 511 with a `lowest` of 1000.
    pub fn value_at_percentile(&self, percentile: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        let count = self.count as f64;
        let rank = (percentile / 100.0) * count + 0.5;
        // `count` may have been rounded down, and 100 percent is every value.
        let rank = if rank >= count {
            self.count
        } else {
            (rank as u64).max(1)
        };
        self.slot(self.index_of_rank(rank)).highest()
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

    /// The bytes this histogram occupies. Recording a value can raise it.
    pub fn memory_size(&self) -> usize {
        size_of::<Self>()
            + self.chunks.capacity() * size_of::<Option<Box<Chunk>>>()
            + self.chunk_count * size_of::<Chunk>()
    }

    /// `value` is at most `highest_trackable_value`.
    fn index_of(&self, value: u64) -> usize {
        let magnitude = self.sub_bucket_half_count_magnitude;
        // The bit that a value has to reach to be past bucket 0.
        let bucket_0_bits = self.unit_magnitude + magnitude + 1;
        let bucket = (u64::BITS - value.leading_zeros()).saturating_sub(bucket_0_bits);
        // In the upper half of the sub-buckets, unless this is bucket 0.
        let sub_bucket = value >> (bucket + self.unit_magnitude);
        ((bucket as usize) << magnitude) + sub_bucket as usize
    }

    /// `index` is that of a slot that a value can reach.
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
