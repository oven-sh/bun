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

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_for_clock_tick() {
        let started = Instant::now();
        while started.elapsed().is_zero() {
            core::hint::spin_loop();
        }
    }

    #[test]
    fn step_lasts_from_end_of_previous_step() {
        let mut times = StepTimes::new();
        wait_for_clock_tick();
        times.end_step(StatisticId::LinkMergeKeysNanoseconds);
        let after_first_step = times.started;
        wait_for_clock_tick();
        times.end_step(StatisticId::LinkMarkNanoseconds);
        let second_step = times.started.duration_since(after_first_step).as_nanos() as u64;
        let [(first_id, first_time), second] = *times.counters.counts() else {
            panic!("{:?}", times.counters.counts());
        };
        assert_eq!(first_id, StatisticId::LinkMergeKeysNanoseconds);
        assert!(first_time > 0);
        assert_eq!(second, (StatisticId::LinkMarkNanoseconds, second_step));
    }

    #[test]
    fn repeated_step_is_added_up() {
        let mut times = StepTimes::new();
        wait_for_clock_tick();
        times.end_step(StatisticId::LinkMarkNanoseconds);
        let first_time = times.counters.counts()[0].1;
        wait_for_clock_tick();
        times.end_step(StatisticId::LinkMarkNanoseconds);
        let [(id, time)] = *times.counters.counts() else {
            panic!("{:?}", times.counters.counts());
        };
        assert_eq!(id, StatisticId::LinkMarkNanoseconds);
        assert!(time > first_time);
    }
}
