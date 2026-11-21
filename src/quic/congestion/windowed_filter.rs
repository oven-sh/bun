//! Kathleen Nichols' estimate of the maximum over a sliding window, in constant space.

/// In round trips.
const WINDOW: u64 = 10;
const EXTENSION: u64 = 3;

#[derive(Default, Clone, Copy)]
struct Sample {
    round: u64,
    value: u64,
}

/// The best value, and those that take its place as it expires.
#[derive(Default)]
pub(super) struct WindowedMax([Sample; 3]);

impl WindowedMax {
    #[inline]
    pub(super) fn get(&self) -> u64 {
        let [best, ..] = self.0;
        best.value
    }

    /// In place of an update, so that the first value after a gap is not the only one left.
    pub(super) fn extend(&mut self, round: u64) {
        for sample in &mut self.0 {
            sample.round = (sample.round).max(round.saturating_sub(WINDOW - EXTENSION));
        }
    }

    /// `round` does not decrease.
    pub(super) fn update(&mut self, round: u64, value: u64) {
        let new = Sample { round, value };
        let [best, second, third] = &mut self.0;
        if value >= best.value {
            self.0 = [new; 3];
            return;
        }
        if value >= second.value {
            (*second, *third) = (new, new);
        } else if value >= third.value {
            *third = new;
        }
        let age = round - best.round;
        if age > WINDOW {
            while round - best.round > WINDOW {
                (*best, *second, *third) = (*second, *third, new);
            }
        } else if second.round == best.round && age > WINDOW / 4 {
            (*second, *third) = (new, new);
        } else if third.round == second.round && age > WINDOW / 2 {
            *third = new;
        }
    }
}
