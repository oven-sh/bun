//! It takes longer to put a thread to sleep and to wake it than many a wait lasts.

use std::sync::LazyLock;

/// Enough for another thread to wake up and answer.
const AWAKE_NS: u64 = 50_000;
const BUSY_NS: u64 = 100_000;

/// How many waits a phase has.
const TRIAL: u16 = 8;
const MAX_AWAKE: u16 = 512;
const MAX_ASLEEP: u16 = 256;

/// Has a thread look for work before it goes to sleep, for as long as the work comes faster for it.
#[derive(Copy, Clone)]
pub struct Spin {
    is_awake: bool,
    /// The end of the first wait of this phase, which is still at the pace of the one before.
    began_at_ns: u64,
    waits: u16,
    len: u16,
    /// From one wait to the next, in the last phase asleep.
    pace_asleep_ns: u64,
    next_len_asleep: u16,
}

impl Spin {
    pub const fn new() -> Spin {
        Spin {
            is_awake: false,
            began_at_ns: 0,
            waits: 0,
            len: TRIAL,
            pace_asleep_ns: 0,
            next_len_asleep: TRIAL,
        }
    }

    pub fn limit_ns(&self) -> u64 {
        static HAS_OTHER_CPU: LazyLock<bool> = LazyLock::new(|| bun_sys::windows::cpu::count() > 1);
        if self.is_awake && *HAS_OTHER_CPU {
            AWAKE_NS
        } else {
            0
        }
    }

    /// With the time asleep, if it came to that.
    pub fn waited(&mut self, from_ns: u64, to_ns: u64) {
        let ns = to_ns.saturating_sub(from_ns);
        if ns > BUSY_NS {
            return self.begin(false, self.next_len_asleep);
        }
        if self.waits == 0 {
            self.began_at_ns = to_ns;
        }
        self.waits += 1;
        let is_missed = self.is_awake && ns > AWAKE_NS;
        if self.waits <= self.len && !is_missed {
            return;
        }
        let pace_ns = to_ns.saturating_sub(self.began_at_ns) / u64::from(self.len);
        if !self.is_awake {
            self.pace_asleep_ns = pace_ns;
            self.begin(true, TRIAL);
        } else if is_missed || pace_ns * 8 > self.pace_asleep_ns * 7 {
            self.begin(false, self.next_len_asleep);
            self.next_len_asleep = (self.len * 2).min(MAX_ASLEEP);
        } else if self.len < MAX_AWAKE {
            if self.len > TRIAL {
                self.next_len_asleep = TRIAL;
            }
            self.begin(true, self.len * 4);
        } else {
            self.begin(false, TRIAL);
        }
    }

    fn begin(&mut self, is_awake: bool, len: u16) {
        (self.is_awake, self.len, self.waits) = (is_awake, len, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAKE_NS: u64 = 20_000;

    /// The percentage of waits that start awake. `next` says when work comes for a wait that starts at a time.
    fn awake(next: impl Fn(u64) -> u64) -> u64 {
        let (mut spin, mut now, mut count) = (Spin::new(), 1, 0);
        for _ in 0..10_000 {
            let (from, comes) = (now + 5_000, next(now + 5_000));
            let is_caught = spin.is_awake && comes - from <= AWAKE_NS;
            count += u64::from(spin.is_awake);
            now = comes + if is_caught { 0 } else { WAKE_NS };
            spin.waited(from, now);
        }
        count / 100
    }

    #[test]
    fn stays_awake_only_where_it_pays() {
        for answer_ns in [2_000, 20_000, 45_000] {
            assert!(awake(|now| now + answer_ns) > 90);
        }
        for pace_ns in [30_000, 40_000, 80_000] {
            assert!(awake(|now| now.next_multiple_of(pace_ns)) < 6);
        }
        assert!(awake(|now| now + 60_000) < 2);
        assert_eq!(awake(|now| now + 200_000), 0);
    }
}
