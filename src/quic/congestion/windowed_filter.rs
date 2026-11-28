//! Kathleen Nichols' estimate of the maximum over a sliding window, in constant space.

/// In round trips.
const WINDOW: u32 = 10;
const EXTENSION: u32 = 3;

#[derive(Default, Clone, Copy)]
struct Sample {
    /// It wraps around.
    round: u32,
    value: u32,
}

impl Sample {
    fn age(self, round: u32) -> u32 {
        round.wrapping_sub(self.round)
    }
}

/// The best value, and those that take its place as it expires.
#[derive(Default)]
pub(super) struct WindowedMax([Sample; 3]);

impl WindowedMax {
    #[inline]
    pub(super) fn get(&self) -> u64 {
        let [best, ..] = self.0;
        best.value.into()
    }

    /// In place of an update, so that the first value after a gap is not the only one left.
    pub(super) fn extend(&mut self, round: u64) {
        let round = round as u32;
        for sample in &mut self.0 {
            sample.round = round.wrapping_sub(sample.age(round).min(WINDOW - EXTENSION));
        }
    }

    /// Likewise, once for each round. It only stops the clock.
    pub(super) fn hold(&mut self, round: u64) {
        for sample in &mut self.0 {
            let is_old = sample.age(round as u32) > WINDOW - EXTENSION;
            sample.round = sample.round.wrapping_add(is_old.into());
        }
    }

    /// `round` does not decrease.
    pub(super) fn update(&mut self, round: u64, value: u64) {
        let (round, value) = (round as u32, value.try_into().unwrap_or(u32::MAX));
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
        let age = best.age(round);
        if age > WINDOW {
            while best.age(round) > WINDOW {
                (*best, *second, *third) = (*second, *third, new);
            }
        } else if second.round == best.round && age > WINDOW / 4 {
            (*second, *third) = (new, new);
        } else if third.round == second.round && age > WINDOW / 2 {
            *third = new;
        }
    }
}
