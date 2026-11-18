//! How much time goes into painting what another process has sent.

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::sync::Mutex;

const MILLISECOND: u64 = 1_000_000;
const FREE_IN_PICTURE: u64 = 250 * MILLISECOND;
const MOST_OWED: u64 = 5000 * MILLISECOND;

thread_local! {
    static CHARGED: Cell<u64> = const { Cell::new(0) };
}

/// The time, and that which this process has used.
fn clocks() -> [u64; 2] {
    [libc::CLOCK_MONOTONIC, libc::CLOCK_PROCESS_CPUTIME_ID].map(|clock| {
        let mut time = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: it is written to.
        unsafe { libc::clock_gettime(clock, &mut time) };
        time.tv_sec as u64 * 1_000_000_000 + time.tv_nsec as u64
    })
}

pub struct Allowance {
    /// And when.
    owed: Mutex<[u64; 2]>,
    is_spent: AtomicBool,
    when_spent: Box<dyn Fn() + Send + Sync>,
}

impl Allowance {
    pub fn new(when_spent: impl Fn() + Send + Sync + 'static) -> Allowance {
        Allowance {
            owed: Mutex::default(),
            is_spent: AtomicBool::new(false),
            when_spent: Box::new(when_spent),
        }
    }

    pub fn is_spent(&self) -> bool {
        self.is_spent.load(Ordering::Relaxed)
    }

    fn charge(&self, nanoseconds: u64, now: u64) {
        let Some(excess) = nanoseconds.checked_sub(FREE_IN_PICTURE) else {
            return;
        };
        let [owed, since] = &mut *self.owed.lock();
        *owed = owed
            .saturating_sub(now.saturating_sub(std::mem::replace(since, now)) / 10)
            .saturating_add(excess);
        if *owed > MOST_OWED && !self.is_spent.swap(true, Ordering::Relaxed) {
            (self.when_spent)();
        }
    }

    pub fn meter(&self) -> Meter<'_> {
        Meter {
            allowance: self,
            start: clocks(),
            charged: CHARGED.get(),
        }
    }
}

pub struct Meter<'a> {
    allowance: &'a Allowance,
    start: [u64; 2],
    charged: u64,
}

impl Meter<'_> {
    /// `pixels` have yet to be composited. What others were charged for in the meantime is part of both.
    pub fn stop(self, pixels: u64) {
        let (end, start) = (clocks(), self.start);
        let all = (end[0] - start[0])
            .min(end[1] - start[1])
            .saturating_add(pixels);
        self.allowance.charge(
            all.saturating_sub(CHARGED.get().wrapping_sub(self.charged)),
            end[0],
        );
        CHARGED.set(self.charged.wrapping_add(all));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicU32;

    use super::*;

    #[test]
    fn ends_once_too_much_is_owed() {
        let ends = Arc::new(AtomicU32::new(0));
        let counted = ends.clone();
        let allowance = Allowance::new(move || _ = counted.fetch_add(1, Ordering::Relaxed));
        (0..1000).for_each(|_| allowance.charge(FREE_IN_PICTURE, 0));
        (1..1000).for_each(|it| allowance.charge(FREE_IN_PICTURE * 2, it * FREE_IN_PICTURE * 10));
        assert!(!allowance.is_spent());
        (0..30).for_each(|_| allowance.charge(FREE_IN_PICTURE * 2, 0));
        assert_eq!(ends.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn spares_what_is_around() {
        let [outer, inner] = [(); 2].map(|()| Allowance::new(|| {}));
        let around = outer.meter();
        inner.meter().stop(MOST_OWED * 2);
        around.stop(MOST_OWED * 2);
        assert_eq!([outer.is_spent(), inner.is_spent()], [false, true]);
    }
}
