//! The counts in buckets of other widths than the slots.

use crate::{Histogram, Slot};

const MAX: u64 = i64::MAX as u64;

impl Histogram {
    /// The count of each bucket, with the lowest value of the slot that the bucket ends in. `ends_in` is asked of every
    /// slot in turn whether a bucket does. The last bucket is the one with the highest value.
    ///
    /// Node.js: where several buckets end in one slot, the count is that of the last one, which is 0.
    fn rebucket(&self, mut ends_in: impl FnMut(Slot) -> bool) -> Vec<(u64, u64)> {
        let mut buckets = Vec::new();
        if self.count == 0 {
            return buckets;
        }
        let mut count = 0;
        let mut lowest = 0;
        for index in 0..self.slot_count() {
            let slot = self.slot(index);
            lowest = slot.lowest;
            count += self.count_at_index(index);
            // The ends that are out of range are all `i64::MAX`.
            if ends_in(slot) || slot.highest() >= MAX {
                buckets.push((lowest, count));
                count = 0;
                if index >= self.last {
                    return buckets;
                }
            }
        }
        buckets.push((lowest, count));
        buckets
    }

    /// Buckets that end at `step`, `2 * step` and so on. `step` is not 0.
    pub fn linear_buckets(&self, step: u64) -> Vec<(u64, u64)> {
        self.rebucket(|slot| {
            let end = slot.lowest.max(1).div_ceil(step).checked_mul(step);
            end.is_some_and(|end| end <= slot.highest())
        })
    }

    /// Buckets that end at `first`, `first * base`, `first * base * base` and so on. `base` is above 1.
    ///
    /// Node.js: `base` is rounded down, and one below 2 makes the second bucket the last one.
    pub fn log_buckets(&self, first: u64, base: f64) -> Vec<(u64, u64)> {
        if base.fract() == 0.0 && base < MAX as f64 {
            let mut end = first;
            return self.rebucket(|slot| {
                while end < slot.lowest {
                    end = end.saturating_mul(base as u64);
                }
                end <= slot.highest()
            });
        }
        let mut end = first as f64;
        self.rebucket(|slot| {
            let lowest = slot.lowest as f64;
            if end < lowest {
                // All but the last few steps at once: there is no limit to how many there are.
                end *= base
                    .powf(((lowest / end).ln() / base.ln()).floor() - 1.0)
                    .max(1.0);
            }
            while end < lowest {
                end *= base;
            }
            // `as` rounds down, and saturates.
            end as u64 <= slot.highest()
        })
    }
}
