//! A wait for another thread that ends without a sleep, where the wake from a sleep would cost more than the wait.

use core::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

/// A sleep and its wake cost about as much, and a small task and the turn of the loop that awaits it fit in it.
pub const LENGTH: Duration = Duration::from_micros(20);

fn length() -> Duration {
    // Test suite only: a debug build takes longer than `LENGTH` for the other thread's turn.
    if cfg!(all(debug_assertions, not(miri)))
        && bun_core::env_var::feature_flag::BUN_DEBUG_TEST_LONG_BRIEF_WAIT.get() == Some(true)
    {
        return Duration::from_secs(10);
    }
    LENGTH
}

/// Brief waits for one kind of event. One in vain skips the next 1, 2, 4, ... `MAX_SKIPS` waits, and a late one `MAX_SKIPS`, until one ends in time.
#[derive(Default)]
pub struct Patience {
    skips_left: AtomicU32,
    skips_of_last_miss: AtomicU32,
}

impl Patience {
    const MAX_SKIPS: u32 = 64;
    /// A wait that took this many times its length lost its processor for a time slice of the scheduler: 0.75 ms or more on Linux.
    const LATE: u32 = 25;

    pub const fn new() -> Self {
        Patience {
            skips_left: AtomicU32::new(0),
            skips_of_last_miss: AtomicU32::new(0),
        }
    }

    /// Whether to wait now. A `false` uses up one skip.
    pub fn allows_wait(&self) -> bool {
        // Relaxed, here and in `wait_for`: the counts are advice, and one that another thread overwrites changes nothing.
        let skips_left = self.skips_left.load(Ordering::Relaxed);
        if skips_left == 0 {
            return true;
        }
        self.skips_left.store(skips_left - 1, Ordering::Relaxed);
        false
    }

    /// Calls `is_ready` until it returns true or `LENGTH` passes, and yields the processor in between: the other thread may need it.
    pub fn wait_briefly(&self, is_ready: impl FnMut() -> bool) -> bool {
        let start = Instant::now();
        self.wait_for(length(), || start.elapsed(), is_ready)
    }

    fn wait_for(
        &self,
        length: Duration,
        elapsed: impl Fn() -> Duration,
        mut is_ready: impl FnMut() -> bool,
    ) -> bool {
        let is_ready = loop {
            if is_ready() {
                break true;
            }
            if elapsed() >= length {
                break false;
            }
            std::thread::yield_now();
        };
        let skips = if elapsed() > length.saturating_mul(Self::LATE) {
            // Late, ready or not: a yield gave the processor to another program, and the next one would too.
            Self::MAX_SKIPS
        } else if is_ready {
            0
        } else {
            (self.skips_of_last_miss.load(Ordering::Relaxed) * 2).clamp(1, Self::MAX_SKIPS)
        };
        self.skips_of_last_miss.store(skips, Ordering::Relaxed);
        self.skips_left.store(skips, Ordering::Relaxed);
        is_ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    /// A wait of `LENGTH` on a clock that `is_ready` sets: it returns the time at which it is ready, if it is.
    fn wait(patience: &Patience, mut is_ready: impl FnMut() -> (Duration, bool)) -> bool {
        let now = Cell::new(Duration::ZERO);
        patience.wait_for(
            LENGTH,
            || now.get(),
            || {
                let (time, is_ready) = is_ready();
                now.set(time);
                is_ready
            },
        )
    }

    fn wait_in_vain(patience: &Patience) {
        assert!(!wait(patience, || (LENGTH, false)));
    }

    #[test]
    fn a_wait_ends_when_it_is_ready() {
        let mut calls = 0;
        assert!(wait(&Patience::new(), || {
            calls += 1;
            (Duration::ZERO, calls == 3)
        }));
        assert_eq!(calls, 3);
    }

    #[test]
    fn a_wait_ends_when_its_length_has_passed() {
        let mut calls = 0;
        assert!(!wait(&Patience::new(), || {
            calls += 1;
            (LENGTH / 4 * calls, false)
        }));
        assert_eq!(calls, 4);
    }

    #[test]
    fn a_wait_on_the_real_clock_ends() {
        assert!(!Patience::new().wait_briefly(|| false));
    }

    #[test]
    fn waits_in_vain_skip_more_and_more_waits() {
        let patience = Patience::new();
        let mut skipped_after_each_wait = Vec::new();
        for _ in 0..8 {
            assert!(patience.allows_wait());
            wait_in_vain(&patience);
            let mut skipped = 0;
            while !patience.allows_wait() {
                skipped += 1;
            }
            skipped_after_each_wait.push(skipped);
        }
        assert_eq!(skipped_after_each_wait, [1, 2, 4, 8, 16, 32, 64, 64]);
    }

    #[test]
    fn a_wait_that_ends_in_time_forgets_the_waits_in_vain() {
        let patience = Patience::new();
        for _ in 0..5 {
            wait_in_vain(&patience);
        }
        assert!(wait(&patience, || (LENGTH * Patience::LATE, true)));
        assert!(patience.allows_wait());
        wait_in_vain(&patience);
        assert!(!patience.allows_wait());
        assert!(patience.allows_wait());
    }

    #[test]
    fn a_wait_that_ends_late_skips_the_most_waits_at_once() {
        let late = LENGTH * Patience::LATE + Duration::from_nanos(1);
        for is_ready in [true, false] {
            let patience = Patience::new();
            assert_eq!(wait(&patience, || (late, is_ready)), is_ready);
            let mut skipped = 0;
            while !patience.allows_wait() {
                skipped += 1;
            }
            assert_eq!(skipped, Patience::MAX_SKIPS);
        }
    }
}
