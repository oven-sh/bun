use core::cell::{Cell, RefCell};

use bun_engine_platform::clock::monotonic_seconds;

struct Run {
    start: f64,
    elapsed_before: f64,
}

/// Counts the seconds in which scripts were not paused.
pub(crate) struct Stopwatch {
    runs: RefCell<Vec<Run>>,
    /// Of the last run. Infinite while it goes on.
    end: Cell<f64>,
}

impl Stopwatch {
    pub(crate) fn started() -> Stopwatch {
        let first = Run {
            start: monotonic_seconds(),
            elapsed_before: 0.0,
        };
        Stopwatch {
            runs: RefCell::new(vec![first]),
            end: Cell::new(f64::INFINITY),
        }
    }

    pub(crate) fn elapsed(&self) -> f64 {
        self.elapsed_at(monotonic_seconds())
    }

    /// What it showed at that time, as far as it remembers.
    pub(crate) fn elapsed_at(&self, time: f64) -> f64 {
        let runs = self.runs.borrow();
        let next = runs.partition_point(|it| it.start <= time).max(1);
        let run = &runs[next - 1];
        let elapsed = run.elapsed_before + (time.min(self.end.get()) - run.start).max(0.0);
        (runs.get(next)).map_or(elapsed, |it| elapsed.min(it.elapsed_before))
    }

    pub(crate) fn stop(&self) {
        self.end.set(monotonic_seconds());
    }

    pub(crate) fn resume(&self, remembers: bool) {
        let elapsed_before = self.elapsed();
        let mut runs = self.runs.borrow_mut();
        if !remembers {
            runs.clear();
        }
        runs.push(Run {
            start: monotonic_seconds(),
            elapsed_before,
        });
        self.end.set(f64::INFINITY);
    }
}
