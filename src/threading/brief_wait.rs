//! A wait for another thread that ends without a sleep, where the wake from a sleep would cost more than the wait.

use core::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// A sleep and its wake cost about as much, and a small task and the turn of the loop that awaits it fit in it.
const LENGTH: Duration = Duration::from_micros(20);

fn length() -> Duration {
    // Test suite only: a debug build takes longer than `LENGTH` for the other thread's turn.
    if cfg!(all(debug_assertions, not(miri)))
        && bun_core::env_var::feature_flag::BUN_DEBUG_TEST_LONG_BRIEF_WAIT.get() == Some(true)
    {
        return Duration::from_secs(10);
    }
    LENGTH
}

/// Calls `is_ready` until it returns true or `LENGTH` passes, and yields the processor in between: the other thread may need it.
pub fn wait_briefly(is_ready: impl FnMut() -> bool) -> bool {
    wait_for(length(), is_ready)
}

fn wait_for(length: Duration, mut is_ready: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    loop {
        if is_ready() {
            return true;
        }
        if start.elapsed() >= length {
            return false;
        }
        std::thread::yield_now();
    }
}

/// Whether the next brief wait is worth it: a miss skips the next 1, 2, 4, ... `MAX_SKIPS` waits, until one ends in time.
#[derive(Default)]
pub struct Patience {
    skips_left: AtomicU32,
    skips_of_last_miss: AtomicU32,
}

impl Patience {
    const MAX_SKIPS: u32 = 64;

    pub const fn new() -> Self {
        Patience {
            skips_left: AtomicU32::new(0),
            skips_of_last_miss: AtomicU32::new(0),
        }
    }

    /// Whether to wait now. A `false` uses up one skip.
    pub fn allows_wait(&self) -> bool {
        // Relaxed, here and in `record`: the counts are advice, and one that another thread overwrites changes nothing.
        let skips_left = self.skips_left.load(Ordering::Relaxed);
        if skips_left == 0 {
            return true;
        }
        self.skips_left.store(skips_left - 1, Ordering::Relaxed);
        false
    }

    /// What the wait that `allows_wait` allowed came to.
    pub fn record(&self, ended_in_time: bool) {
        let skips = if ended_in_time {
            0
        } else {
            (self.skips_of_last_miss.load(Ordering::Relaxed) * 2).clamp(1, Self::MAX_SKIPS)
        };
        self.skips_of_last_miss.store(skips, Ordering::Relaxed);
        self.skips_left.store(skips, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wait_ends_when_it_is_ready() {
        let mut calls = 0;
        assert!(wait_for(Duration::MAX, || {
            calls += 1;
            calls == 3
        }));
        assert_eq!(calls, 3);
    }

    #[test]
    fn a_wait_asks_once_before_its_length_counts() {
        assert!(wait_for(Duration::ZERO, || true));
        let mut calls = 0;
        assert!(!wait_for(Duration::ZERO, || {
            calls += 1;
            false
        }));
        assert_eq!(calls, 1);
    }

    #[test]
    fn a_wait_that_is_never_ready_ends() {
        assert!(!wait_briefly(|| false));
    }

    #[test]
    fn misses_skip_more_and_more_waits() {
        let patience = Patience::new();
        let mut skipped_after_each_miss = Vec::new();
        for _ in 0..8 {
            assert!(patience.allows_wait());
            patience.record(false);
            let mut skipped = 0;
            while !patience.allows_wait() {
                skipped += 1;
            }
            skipped_after_each_miss.push(skipped);
        }
        assert_eq!(skipped_after_each_miss, [1, 2, 4, 8, 16, 32, 64, 64]);
    }

    #[test]
    fn a_wait_that_ends_in_time_forgets_the_misses() {
        let patience = Patience::new();
        for _ in 0..5 {
            patience.record(false);
        }
        patience.record(true);
        assert!(patience.allows_wait());
        patience.record(false);
        assert!(!patience.allows_wait());
        assert!(patience.allows_wait());
    }
}
