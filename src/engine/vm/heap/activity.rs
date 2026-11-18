//! Collects a heap that is not allocated from quickly enough to reach its limit, within a share of the processor's time
//! that grows with what there is to reclaim.

use core::cell::{Cell, RefCell};
use core::time::Duration;

use bun_engine_platform::clock;

use super::{Heap, Scope};
use crate::{Timer, Vm, options};

/// At most one timer at a time.
#[derive(Default)]
pub(super) struct HeapTimer(RefCell<Option<Timer>>);

impl HeapTimer {
    pub(super) fn start(&self, vm: &Vm, seconds: f64, callback: fn(&Vm)) {
        self.cancel();
        let delay = Duration::try_from_secs_f64(seconds.max(0.0)).unwrap_or(Duration::MAX);
        self.0
            .replace(Some(vm.timer_queue().start(delay, callback)));
    }

    pub(super) fn cancel(&self) {
        if let Some(timer) = self.0.take() {
            timer.cancel();
        }
    }
}

struct PacedCollection {
    timer: HeapTimer,
    /// From `origin` on.
    delay: Cell<f64>,
    origin: Cell<f64>,
    last_duration: Cell<f64>,
}

impl Default for PacedCollection {
    fn default() -> PacedCollection {
        PacedCollection {
            timer: HeapTimer::default(),
            delay: Cell::new(f64::INFINITY),
            origin: Cell::new(0.0),
            last_duration: Cell::new(0.01),
        }
    }
}

fn death_rate(size_before: usize, size_after: usize) -> f64 {
    if size_before == 0 {
        return 1.0;
    }
    size_before.saturating_sub(size_after) as f64 / size_before as f64
}

impl PacedCollection {
    fn schedule(&self, vm: &Vm, reclaimable: f64, share_per_megabyte: f64, collect: fn(&Vm)) {
        const SLOP: f64 = 2.0;
        let share = (reclaimable / f64::from(1 << 20) * share_per_megabyte)
            .min(options().collection_timer_max_share);
        let delay = self.last_duration.get() / share;
        if delay.is_nan() || delay * SLOP >= self.delay.get() {
            return;
        }
        let now = clock::monotonic_seconds();
        if self.delay.replace(delay) == f64::INFINITY {
            self.origin.set(now);
        }
        self.timer
            .start(vm, self.origin.get() + delay - now, collect);
    }

    fn cancel(&self) {
        self.delay.set(f64::INFINITY);
        self.timer.cancel();
    }
}

#[derive(Default)]
pub(super) struct Activity {
    eden: PacedCollection,
    full: PacedCollection,
    abandoned_bytes: Cell<usize>,
    is_suspended: Cell<bool>,
}

impl Activity {
    pub(super) fn suspend_until_next_collection(&self) {
        self.is_suspended.set(true);
        self.eden.cancel();
        self.full.cancel();
    }

    pub(super) fn will_collect(&self, scope: Scope) {
        self.eden.cancel();
        if scope == Scope::Full {
            self.full.cancel();
            self.abandoned_bytes.set(0);
        }
    }

    fn paced(&self, scope: Scope) -> &PacedCollection {
        match scope {
            Scope::Eden => &self.eden,
            Scope::Full => &self.full,
        }
    }

    pub(super) fn did_collect(&self, scope: Scope, seconds: f64) {
        self.is_suspended.set(false);
        self.paced(scope).last_duration.set(seconds);
    }

    pub(super) fn last_duration(&self, scope: Scope) -> f64 {
        self.paced(scope).last_duration.get()
    }
}

impl Heap {
    pub(super) fn schedule_eden_collection(&self) {
        let (activity, sizes) = (&self.activity, self.sizes());
        if activity.is_suspended.get() {
            return;
        }
        let bytes = (self.policy.allocated()).saturating_add(activity.abandoned_bytes.get());
        let rate = death_rate(sizes.before_last_eden, sizes.after_last_eden);
        let share = options().eden_timer_share_per_megabyte;
        (activity.eden).schedule(self.vm(), bytes.max(1) as f64 * rate, share, |vm| {
            vm.heap.activity.eden.cancel();
            vm.heap.begin_collection(Some(Scope::Eden));
        });
    }

    /// `bytes` have been added to what the last collection has left.
    pub(super) fn schedule_full_collection(&self, bytes: usize) {
        let (activity, sizes) = (&self.activity, self.sizes());
        if activity.is_suspended.get() {
            return;
        }
        let bytes = (sizes.after_last.saturating_sub(sizes.after_last_full)).saturating_add(bytes);
        let rate = death_rate(sizes.before_last_full, sizes.after_last_full);
        let share = options().full_timer_share_per_megabyte;
        (activity.full).schedule(self.vm(), bytes.max(1) as f64 * rate, share, |vm| {
            vm.heap.activity.full.cancel();
            vm.heap.begin_collection(Some(Scope::Full));
        });
    }

    /// The embedder has let go of much, and does not know how much.
    pub fn report_abandoned_object_graph(&self) {
        let abandoned = &self.activity.abandoned_bytes;
        abandoned.update(|bytes| bytes.saturating_add(self.capacity() / 10));
        self.schedule_full_collection(self.policy.allocated().saturating_add(abandoned.get()));
    }
}
