//! It takes longer to put a thread to sleep and to wake it than many a wait lasts.

use std::sync::LazyLock;

/// About what a sleep costs.
const SHORT_NS: u64 = 10_000;
/// Enough for another thread to wake up and answer. From then on neither has to sleep.
const LONG_NS: u64 = 50_000;
const BUSY_NS: u64 = 100_000;

#[derive(Copy, Clone)]
enum Next {
    Short,
    Long,
    ShortAfterLong,
    /// This many waits go without.
    Nothing(u8),
}

/// How long a thread looks for work before it goes to sleep, from how the last waits went.
#[derive(Copy, Clone)]
pub struct Spin {
    is_busy: bool,
    next: Next,
    rest: u8,
}

impl Spin {
    pub const fn new() -> Spin {
        Spin {
            is_busy: false,
            next: Next::Short,
            rest: 0,
        }
    }

    pub fn limit_ns(self) -> u64 {
        static HAS_OTHER_CPU: LazyLock<bool> = LazyLock::new(|| bun_sys::windows::cpu::count() > 1);
        match self.next {
            _ if !self.is_busy || !*HAS_OTHER_CPU => 0,
            Next::Short | Next::ShortAfterLong => SHORT_NS,
            Next::Long => LONG_NS,
            Next::Nothing(_) => 0,
        }
    }

    /// With the time asleep, if it came to that.
    pub fn waited(&mut self, ns: u64) {
        if !core::mem::replace(&mut self.is_busy, ns <= BUSY_NS) {
            return;
        }
        self.next = match self.next {
            _ if ns <= SHORT_NS => {
                self.rest /= 2;
                Next::Short
            }
            Next::Short | Next::Nothing(0) => Next::Long,
            Next::Long => Next::ShortAfterLong,
            Next::ShortAfterLong => {
                self.rest = (self.rest * 2 + 1).min(63);
                // Two threads that take turns would keep missing each other.
                Next::Nothing(self.rest + (ns / 128 % 4) as u8)
            }
            Next::Nothing(left) => Next::Nothing(left - 1),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time_awake(waits: impl Iterator<Item = u64>) -> u64 {
        let mut spin = Spin::new();
        let awake = |ns: u64| {
            let limit = spin.limit_ns();
            spin.waited(ns);
            limit.min(ns)
        };
        waits.map(awake).sum()
    }

    #[test]
    fn stays_awake_only_where_it_pays() {
        if bun_sys::windows::cpu::count() > 1 {
            assert_eq!(time_awake([5_000; 1001].into_iter()), 5_000_000);
        }
        assert!(time_awake([40_000; 1000].into_iter()) < 1_500_000);
        assert_eq!(time_awake([200_000; 1000].into_iter()), 0);
    }
}
