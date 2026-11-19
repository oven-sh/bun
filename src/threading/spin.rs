//! It takes longer to put a thread to sleep and to wake it than many a wait lasts.

use std::sync::LazyLock;

/// Enough for another thread to wake up and answer.
const AWAKE_NS: u64 = 50_000;
const BUSY_NS: u64 = 100_000;
/// What follows can be work of another kind.
const IDLE_NS: u64 = 1_000_000;

/// How many waits a phase has.
const TRIAL: u16 = 8;
const MAX_AWAKE: u16 = 512;
const MAX_ASLEEP: u16 = 256;

/// Temporary: `BUN_TMP_TUNE=0=1,3=4096` replaces defaults, to measure variants.
pub fn tune(index: usize, default: u64) -> u64 {
    static VALUES: LazyLock<[Option<u64>; 16]> = LazyLock::new(|| {
        let mut values = [None; 16];
        let text = bun_core::getenv_z(bun_core::zstr!("BUN_TMP_TUNE")).unwrap_or_default();
        for pair in bun_core::strings::split(text, b",") {
            if let Some((key, value)) = bun_core::strings::split_once_char(pair, b'=')
                && let Ok(key) = bun_core::fmt::parse_int::<usize>(key, 10)
            {
                values[key] = bun_core::fmt::parse_int(value, 10).ok();
            }
        }
        values
    });
    if cfg!(any(test, debug_assertions)) {
        return default;
    }
    VALUES[index].unwrap_or(default)
}

pub fn has_other_cpu() -> bool {
    static ANSWER: LazyLock<bool> =
        LazyLock::new(|| std::thread::available_parallelism().is_ok_and(|count| count.get() > 1));
    *ANSWER
}

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
        if self.is_awake && has_other_cpu() {
            tune(1, AWAKE_NS)
        } else {
            0
        }
    }

    /// With the time asleep, if it came to that.
    pub fn waited(&mut self, from_ns: u64, to_ns: u64) {
        let ns = to_ns.saturating_sub(from_ns);
        if ns > IDLE_NS {
            self.next_len_asleep = (self.next_len_asleep / 2).max(TRIAL);
        }
        if ns > tune(2, BUSY_NS) {
            return self.begin(false, self.next_len_asleep);
        }
        if self.waits == 0 {
            self.began_at_ns = to_ns;
        }
        self.waits += 1;
        if self.waits <= self.len {
            return;
        }
        let pace_ns = to_ns.saturating_sub(self.began_at_ns) / u64::from(self.len);
        if !self.is_awake {
            self.pace_asleep_ns = pace_ns;
            self.begin(true, TRIAL);
        } else if pace_ns * tune(3, 8) > self.pace_asleep_ns * (tune(3, 8) - 1) {
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

    /// The percentage of waits that start awake. `next` says when work comes, from the number and the start of a wait.
    fn awake(spin: &mut Spin, next: impl Fn(u64, u64) -> u64) -> u64 {
        let (mut now, mut count) = (1, 0);
        for index in 0..10_000 {
            let (from, comes) = (now + 5_000, next(index, now + 5_000));
            let is_caught = comes - from <= spin.limit_ns();
            count += u64::from(spin.limit_ns() > 0);
            now = comes + if is_caught { 0 } else { WAKE_NS };
            spin.waited(from, now);
        }
        count / 100
    }

    #[test]
    fn stays_awake_only_where_it_pays() {
        if !has_other_cpu() {
            return;
        }
        let spin = &mut Spin::new();
        for answer_ns in [2_000, 20_000, 45_000] {
            assert!(awake(spin, |_, now| now + answer_ns) > 90);
        }
        assert!(awake(spin, |index, now| now + [9_000, 60_000][index as usize % 2]) > 90);
        for pace_ns in [30_000, 40_000, 80_000] {
            assert!(awake(spin, |_, now| now.next_multiple_of(pace_ns)) < 8);
        }
        assert!(awake(spin, |_, now| now + 60_000) < 6);
        assert_eq!(awake(spin, |_, now| now + 200_000), 0);
        let pause = |index| if index % 100 == 0 { 5_000_000 } else { 9_000 };
        assert!(awake(spin, |index, now| now + pause(index)) > 80);
    }
}
