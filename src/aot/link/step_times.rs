use crate::statistics::{Counters, StatisticId};
use std::time::Instant;

pub(super) struct StepTimes {
    pub counters: Counters,
    started: Instant,
}

impl StepTimes {
    pub(super) fn new() -> StepTimes {
        StepTimes {
            counters: Counters::default(),
            started: Instant::now(),
        }
    }

    pub(super) fn end_step(&mut self, step: StatisticId) {
        let now = Instant::now();
        let nanoseconds = now.duration_since(self.started).as_nanos();
        self.counters
            .count(step, u64::try_from(nanoseconds).unwrap_or(u64::MAX));
        self.started = now;
    }
}
