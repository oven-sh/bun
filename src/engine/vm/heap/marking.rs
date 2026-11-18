//! Spreads marking over several threads.

use core::cell::{Cell, UnsafeCell};
use core::marker::ConstParamTy;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use core::time::Duration;
use std::sync::Arc;

use bun_engine_platform::clock;
use bun_threading::{Condition, Guarded};

use super::mark_stack::{MarkStack, REVISIT, Run, Share};
use super::marks::Marks;
use super::visitor::{Findings, Visitor};
use super::{Heap, HeapAnalyzer, Moment, Scope};
use crate::{FastHashSet, TimerQueue, options};

/// In visits. After each turn a marker looks at what the others need.
pub(super) const WORK_PER_TURN: usize = 128;
const MAX_TURNS_BETWEEN_SHARES: u32 = 64;
/// A share that lasts that long has been worth the trouble.
const TURNS_OF_GOOD_SHARE: u32 = 4;
/// How often a marker without work looks for some before it goes to sleep.
const SPINS: usize = 2048;

/// What is being checked does not wait until sharing pays.
fn patience(turns: u32) -> u32 {
    if options().verify_gc { 0 } else { turns }
}

/// A small collection is over before a helper has woken up, and how long that takes depends on what else the machine
/// has to do.
static TURNS_BEFORE_SHARING: AtomicU32 = AtomicU32::new(64);

#[derive(Clone, Copy)]
pub(super) struct Milestone {
    seconds: f64,
    turns: usize,
}

impl Milestone {
    fn of(visitor: &Visitor) -> Milestone {
        Milestone {
            seconds: clock::monotonic_seconds(),
            turns: visitor.findings.turn_count,
        }
    }

    fn turns_per_second_since(self, earlier: Milestone) -> f64 {
        (self.turns - earlier.turns) as f64 / (self.seconds - earlier.seconds)
    }
}

fn learn_whether_sharing_pays(start: Milestone, first_share: Milestone, end: Milestone) {
    const GAIN: f64 = 1.25;
    const FEWEST_TURNS: u32 = 32;
    if first_share.turns - start.turns < FEWEST_TURNS as usize {
        return;
    }
    let alone = first_share.turns_per_second_since(start);
    let turns = TURNS_BEFORE_SHARING.load(Ordering::Relaxed);
    let turns = match end.turns_per_second_since(first_share) > alone * GAIN {
        true => turns / 2,
        false => turns * 2,
    };
    TURNS_BEFORE_SHARING.store(turns.clamp(FEWEST_TURNS, 1024), Ordering::Relaxed);
}

/// Addresses outside the heap that marking has reached. They are added only while there is one marker.
#[derive(Default)]
pub(super) struct OpaqueRoots(UnsafeCell<FastHashSet<usize>>);

impl OpaqueRoots {
    #[inline]
    pub(super) fn contains(&self, root: usize) -> bool {
        // SAFETY: see `get_mut`.
        unsafe { &*self.0.get() }.contains(&root)
    }

    /// # Safety
    /// No other marker is at work. Nothing else is called until the borrow ends.
    #[expect(clippy::mut_from_ref, reason = "the caller is alone")]
    pub(super) unsafe fn get_mut(&self) -> &mut FastHashSet<usize> {
        // SAFETY: the caller's.
        unsafe { &mut *self.0.get() }
    }
}

/// What a marker has to reckon with.
#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(super) enum Company {
    Nobody,
    Markers,
    /// The thread of the heap, which runs scripts or may go back to that without notice.
    Mutator,
}

/// The state of one collection that all markers see.
pub(super) struct Marking {
    pub(super) epoch: u32,
    pub(super) scope: Scope,
    pub(super) moment: Moment,
    pub(super) marks: Marks,
    pub(super) analyzer: *mut HeapAnalyzer,
    /// They wait for the thread of the heap to come by.
    changed: Guarded<Vec<Run>>,
    has_changed: AtomicBool,
    opaque_roots: *const OpaqueRoots,
    /// In the whole process.
    helper_count: usize,
    wanted_helpers: AtomicUsize,
    /// The markers at work, and the shares that wait for one.
    unfinished: AtomicUsize,
    waiting_shares: AtomicUsize,
    is_collector_idle: AtomicBool,
    /// Changes under the lock of the pool.
    is_collector_asleep: AtomicBool,
    wake_collector: Condition,
    /// Grows while shares turn out small.
    turns_between_shares: AtomicU32,
    findings_of_helpers: Guarded<Findings>,
    may_mutator_run: AtomicBool,
    /// The helpers that count on it not to.
    helpers_without_mutator: AtomicUsize,
    is_collector_away: AtomicBool,
    is_abandoned: AtomicBool,
    /// For calling the thread of the heap when the helpers are done.
    timers: TimerQueue,
}

// SAFETY: what the pointers refer to is there while a marker is at work, and changes only while it is alone.
unsafe impl Send for Marking {}
// SAFETY: as above.
unsafe impl Sync for Marking {}

impl Marking {
    /// `opaque_roots` outlives the collection.
    pub(super) fn new(
        heap: &Heap,
        scope: Scope,
        moment: Moment,
        opaque_roots: &OpaqueRoots,
        is_verifying: bool,
    ) -> Arc<Marking> {
        let analyzer = heap.analyzer.get();
        let helper_count = match is_verifying || !analyzer.is_null() {
            true => 0,
            false => options().number_of_gc_markers as usize - 1,
        };
        Arc::new(Marking {
            epoch: heap.full_collection_count.get(),
            scope,
            moment,
            marks: heap.marks(),
            analyzer: if is_verifying { null_mut() } else { analyzer },
            changed: Guarded::default(),
            has_changed: AtomicBool::new(false),
            opaque_roots,
            helper_count,
            wanted_helpers: AtomicUsize::new(helper_count),
            unfinished: AtomicUsize::new(0),
            waiting_shares: AtomicUsize::new(0),
            is_collector_idle: AtomicBool::new(false),
            is_collector_asleep: AtomicBool::new(false),
            wake_collector: Condition::new(),
            turns_between_shares: AtomicU32::new(0),
            findings_of_helpers: Guarded::default(),
            may_mutator_run: AtomicBool::new(heap.may_let_scripts_run.get()),
            helpers_without_mutator: AtomicUsize::new(0),
            is_collector_away: AtomicBool::new(false),
            is_abandoned: AtomicBool::new(false),
            timers: heap.vm().timer_queue(),
        })
    }

    pub(super) fn opaque_roots(&self) -> &OpaqueRoots {
        // SAFETY: see `new`.
        unsafe { &*self.opaque_roots }
    }

    /// For the thread of the heap, which is all that can change that.
    pub(super) fn is_idle(&self) -> bool {
        self.unfinished.load(Ordering::Acquire) == 0
    }

    /// For the thread of the heap. Visits until nothing is left, and what the helpers found is in the findings of
    /// `visitor`. False if the deadline of the visitor came first: the helpers go on with what is left.
    pub(super) fn drain(&self, visitor: &mut Visitor) -> bool {
        if !core::mem::take(&mut visitor.is_counted) {
            self.unfinished.fetch_add(1, Ordering::Relaxed);
        }
        (visitor.turns_since_accepting, visitor.turns_since_sharing) = (u32::MAX, 0);
        visitor.must_stop = visitor.deadline == f64::NEG_INFINITY;
        self.look_around(visitor);
        let start = (visitor.company == Company::Nobody).then(|| {
            let turns = patience(TURNS_BEFORE_SHARING.load(Ordering::Relaxed));
            self.turns_between_shares.store(turns, Ordering::Relaxed);
            Milestone::of(visitor)
        });
        visitor.first_share = None;
        loop {
            self.work(visitor);
            self.take_changed(visitor);
            if !visitor.must_stop && !visitor.stack.is_empty() {
                continue;
            }
            while let Some(share) = visitor.stack.take_all() {
                self.post(share);
            }
            match self.wait_for_share(visitor.deadline) {
                Some(share) => visitor.accept(share),
                None => break,
            }
            self.look_around(visitor);
        }
        visitor.did_finish_draining();
        if !self.is_idle() {
            return false;
        }
        (visitor.findings).merge(&mut self.findings_of_helpers.lock());
        if let (Some(start), Some(first_share)) = (start, visitor.first_share) {
            learn_whether_sharing_pays(start, first_share, Milestone::of(visitor));
        }
        // SAFETY: nothing is unfinished.
        let opaque_roots = unsafe { self.opaque_roots().get_mut() };
        opaque_roots.extend(visitor.findings.opaque_roots.drain());
        visitor.company = Company::Nobody;
        true
    }

    /// Returns the memory of the stack.
    fn help(&self, share: Share, stack: MarkStack) -> MarkStack {
        let mut visitor = Visitor::for_helper(self, stack);
        visitor.accept(share);
        self.look_around(&mut visitor);
        self.work(&mut visitor);
        (self.findings_of_helpers.lock()).merge(&mut visitor.findings);
        if visitor.company != Company::Mutator {
            self.helpers_without_mutator.fetch_sub(1, Ordering::Release);
        }
        if self.unfinished.fetch_sub(1, Ordering::SeqCst) == 1 {
            let pool = pool::lock();
            self.wake_collector();
            drop(pool);
            if self.is_collector_away.load(Ordering::SeqCst) {
                self.call_mutator();
            }
        }
        core::mem::take(&mut visitor.stack)
    }

    fn call_mutator(&self) {
        (self.timers).start(Duration::ZERO, |vm| vm.heap.collect_if_necessary());
    }

    /// Until there is nothing on the stack and no share waits, or it must stop. The caller counts as unfinished.
    fn work(&self, visitor: &mut Visitor) {
        loop {
            while !visitor.stack.is_empty() && !visitor.must_stop {
                visitor.drain();
                self.look_around(visitor);
            }
            if visitor.must_stop {
                return;
            }
            if visitor.turns_since_accepting < TURNS_OF_GOOD_SHARE {
                let turns = self.turns_between_shares.load(Ordering::Relaxed);
                let turns = patience((turns * 2 + 1).min(MAX_TURNS_BETWEEN_SHARES));
                self.turns_between_shares.store(turns, Ordering::Relaxed);
            }
            if self.waiting_shares.load(Ordering::Relaxed) == 0 {
                return;
            }
            let Some(share) = pool::lock().take_share_of(self) else {
                return;
            };
            self.unfinished.fetch_sub(1, Ordering::Release);
            visitor.accept(share);
            self.look_around(visitor);
        }
    }

    /// For the thread of the heap, which has run out of work. `None` once all have, or at the deadline.
    fn wait_for_share(&self, deadline: f64) -> Option<Share> {
        if self.unfinished.fetch_sub(1, Ordering::AcqRel) == 1 {
            return None;
        }
        self.is_collector_idle.store(true, Ordering::Relaxed);
        // Otherwise a helper may be counting on being alone.
        let has_changed = || !self.is_pause_certain() && self.has_changed();
        let share = loop {
            let seconds = deadline - clock::monotonic_seconds();
            if seconds <= 0.0 {
                break None;
            }
            let has_news = spin_until(|| {
                self.waiting_shares.load(Ordering::Relaxed) != 0 || has_changed() || self.is_idle()
            });
            if has_changed() {
                self.unfinished.fetch_add(1, Ordering::Relaxed);
                break Some(Share::Runs(self.take_changed_runs()));
            }
            let mut pool = pool::lock();
            if let share @ Some(_) = pool.take_share_of(self) {
                break share;
            }
            if self.is_idle() {
                break None;
            }
            if !has_news {
                self.is_collector_asleep.store(true, Ordering::Relaxed);
                if seconds.is_finite() {
                    let nanoseconds = (seconds * 1e9) as u64;
                    let _ = (self.wake_collector).timed_wait_guarded(&mut pool, nanoseconds);
                } else {
                    self.wake_collector.wait_guarded(&mut pool);
                }
                self.is_collector_asleep.store(false, Ordering::Relaxed);
            }
        };
        self.is_collector_idle.store(false, Ordering::Relaxed);
        share
    }

    /// The lock of the pool is held.
    fn wake_collector(&self) {
        if self.is_collector_asleep.load(Ordering::Relaxed) {
            self.wake_collector.signal();
        }
    }

    /// By a marker at work, or the thread of the heap.
    pub(super) fn post(&self, share: Share) {
        self.unfinished.fetch_add(1, Ordering::Relaxed);
        // SAFETY: made in an `Arc`, which the heap holds until nothing is unfinished.
        let this = unsafe {
            Arc::increment_strong_count(self);
            Arc::from_raw(self)
        };
        pool::post(this, share);
    }

    /// By a marker that has more to do. Whether it has to look around before it goes on.
    pub(super) fn did_take_turn(&self, visitor: &mut Visitor) -> bool {
        const TURNS_BETWEEN_LOOKS_AT_CLOCK: usize = 4;
        visitor.findings.turn_count += 1;
        visitor.turns_since_sharing = visitor.turns_since_sharing.saturating_add(1);
        if visitor.deadline.is_finite() {
            self.take_changed(visitor);
            visitor.must_stop = (visitor.findings.turn_count)
                .is_multiple_of(TURNS_BETWEEN_LOOKS_AT_CLOCK)
                && clock::monotonic_seconds() >= visitor.deadline;
        }
        if visitor.turns_since_accepting <= TURNS_OF_GOOD_SHARE {
            visitor.turns_since_accepting += 1;
            if visitor.turns_since_accepting == TURNS_OF_GOOD_SHARE {
                self.turns_between_shares.store(0, Ordering::Relaxed);
            }
        }
        let idle = usize::from(self.is_collector_idle.load(Ordering::Relaxed));
        if (visitor.turns_since_sharing > self.turns_between_shares.load(Ordering::Relaxed)
            || visitor.stack.has_long_run())
            && pool::engaged() < self.wanted_helpers.load(Ordering::Relaxed) + idle
            && let Some(share) = visitor.stack.take_share()
        {
            if !visitor.is_helper && visitor.first_share.is_none() {
                visitor.first_share = Some(Milestone::of(visitor));
            }
            visitor.turns_since_sharing = 0;
            self.post(share);
        }
        visitor.must_stop
            || visitor.company != self.company_of(visitor)
            || self.is_abandoned.load(Ordering::Relaxed)
    }

    /// For the thread of the heap. Nothing that has been allocated is hidden.
    pub(super) fn take_changed(&self, visitor: &mut Visitor) {
        if self.has_changed() {
            let changed = self.take_changed_runs();
            visitor.stack.accept(Share::Runs(changed));
        }
    }

    fn take_changed_runs(&self) -> Vec<Run> {
        let mut changed = self.changed.lock();
        self.has_changed.store(false, Ordering::Relaxed);
        core::mem::take(&mut *changed)
    }

    /// For the thread of the heap.
    pub(super) fn is_pause_certain(&self) -> bool {
        !self.may_mutator_run.load(Ordering::Relaxed)
    }

    /// Besides those that the heap remembers. For the thread of the heap, while no helper is at work.
    #[cold]
    pub(super) fn cells_to_visit_again(&self, visitor: &mut Visitor) -> FastHashSet<usize> {
        (visitor.findings).merge(&mut self.findings_of_helpers.lock());
        let put_off = visitor
            .findings
            .put_off
            .iter()
            .map(|entry| entry & !REVISIT);
        let changed = self.changed.lock();
        // SAFETY: what they are made of.
        let changed = changed
            .iter()
            .flat_map(|run| unsafe { run.items::<usize>() });
        put_off.chain(changed.copied()).collect()
    }

    pub(super) fn add_changed(&self, run: Run) {
        let mut changed = self.changed.lock();
        changed.push(run);
        self.has_changed.store(true, Ordering::Relaxed);
    }

    pub(super) fn has_changed(&self) -> bool {
        self.has_changed.load(Ordering::Relaxed)
    }

    /// Of a marker at work. While no script runs, nobody gets work but from a marker that has some.
    #[inline]
    fn company_of(&self, visitor: &Visitor) -> Company {
        if visitor.is_helper && self.may_mutator_run.load(Ordering::SeqCst) {
            Company::Mutator
        } else if self.unfinished.load(Ordering::Acquire) == 1 {
            Company::Nobody
        } else {
            Company::Markers
        }
    }

    /// By a marker at work, between two visits.
    fn look_around(&self, visitor: &mut Visitor) {
        if self.is_abandoned.load(Ordering::Relaxed) {
            visitor.stack.clear();
        }
        let (old, new) = (visitor.company, self.company_of(visitor));
        visitor.company = new;
        if !visitor.is_helper || (old == Company::Mutator) == (new == Company::Mutator) {
            return;
        }
        if new != Company::Mutator {
            self.helpers_without_mutator.fetch_add(1, Ordering::SeqCst);
            visitor.company = self.company_of(visitor);
            if visitor.company != Company::Mutator {
                return;
            }
        }
        self.helpers_without_mutator.fetch_sub(1, Ordering::Release);
    }

    /// By the thread of the heap, whose visitor it is. It counts as a marker at work until its next `drain` ends.
    pub(super) fn did_stop_mutator(&self, visitor: &mut Visitor) {
        (visitor.company, visitor.is_counted) = (Company::Markers, true);
        self.unfinished.fetch_add(1, Ordering::SeqCst);
        self.is_collector_away.store(false, Ordering::Relaxed);
        self.hurry();
    }

    /// Until `will_resume_mutator`, which then has to wait for them. The caller counts, or nothing is unfinished.
    pub(super) fn let_helpers_count_on_pause(&self) {
        self.may_mutator_run.store(false, Ordering::SeqCst);
    }

    pub(super) fn hurry(&self) {
        (self.wanted_helpers).store(self.helper_count, Ordering::Relaxed);
    }

    pub(super) fn will_resume_mutator(&self) {
        /// The more they are, the more they get in the way of each other.
        const HELPERS_WITHOUT_HURRY: usize = 3;
        let helpers = self.helper_count.min(HELPERS_WITHOUT_HURRY);
        self.wanted_helpers.store(helpers, Ordering::Relaxed);
        self.may_mutator_run.store(true, Ordering::SeqCst);
        let all_know = || self.helpers_without_mutator.load(Ordering::SeqCst) == 0;
        while !spin_until(all_know) {
            std::thread::yield_now();
        }
        self.is_collector_away.store(true, Ordering::SeqCst);
        if self.unfinished.load(Ordering::SeqCst) == 0 {
            self.call_mutator();
        }
    }

    /// Returns once no helper has to do with the heap any more.
    pub(super) fn abandon(&self, visitor: &mut Visitor) {
        self.is_abandoned.store(true, Ordering::Relaxed);
        visitor.deadline = f64::INFINITY;
        self.drain(visitor);
    }
}

/// False if it has taken too long.
fn spin_until(condition: impl Fn() -> bool) -> bool {
    (0..SPINS).any(|_| {
        core::hint::spin_loop();
        condition()
    })
}

#[thread_local]
static IS_HELPER_THREAD: Cell<bool> = Cell::new(false);

pub fn is_helper_thread() -> bool {
    IS_HELPER_THREAD.get()
}

/// The helper threads of the process, which serve all heaps.
mod pool {
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use bun_threading::guarded::GuardedLock;
    use bun_threading::{Condition, Guarded, Mutex};

    use super::{MarkStack, Marking, Share, spin_until};

    pub(super) struct Pool {
        shares: Vec<(Arc<Marking>, Share)>,
        threads: usize,
        busy: usize,
        asleep: usize,
    }

    static POOL: Guarded<Pool> = Guarded::new(Pool {
        shares: Vec::new(),
        threads: 0,
        busy: 0,
        asleep: 0,
    });
    static SHARE_POSTED: Condition = Condition::new();
    static WAITING_SHARES: AtomicUsize = AtomicUsize::new(0);
    static ENGAGED: AtomicUsize = AtomicUsize::new(0);

    pub(super) fn lock() -> GuardedLock<'static, Pool, Mutex> {
        POOL.lock()
    }

    /// The helpers that are busy, and the shares that wait.
    #[inline]
    pub(super) fn engaged() -> usize {
        ENGAGED.load(Ordering::Relaxed)
    }

    impl Pool {
        fn update_hints(&self) {
            WAITING_SHARES.store(self.shares.len(), Ordering::Relaxed);
            ENGAGED.store(self.busy + self.shares.len(), Ordering::Relaxed);
        }

        fn take(&mut self, index: usize) -> (Arc<Marking>, Share) {
            let taken = self.shares.swap_remove(index);
            taken.0.waiting_shares.fetch_sub(1, Ordering::Relaxed);
            taken
        }

        pub(super) fn take_share_of(&mut self, marking: &Marking) -> Option<Share> {
            let index =
                (self.shares.iter()).position(|it| core::ptr::eq(&raw const *it.0, marking))?;
            let share = self.take(index).1;
            self.update_hints();
            Some(share)
        }
    }

    /// If no helper comes for it, a marker of the same collection takes it when it has nothing else to do.
    pub(super) fn post(marking: Arc<Marking>, share: Share) {
        const STACK_SIZE: usize = 1 << 20;
        let mut pool = POOL.lock();
        let helper_count = marking.helper_count;
        marking.waiting_shares.fetch_add(1, Ordering::Relaxed);
        marking.wake_collector();
        pool.shares.push((marking, share));
        pool.update_hints();
        if pool.shares.len() <= pool.threads - pool.busy - pool.asleep {
            return;
        }
        if pool.asleep != 0 {
            drop(pool);
            SHARE_POSTED.signal();
        } else if pool.threads < helper_count {
            pool.threads += 1;
            drop(pool);
            let thread = std::thread::Builder::new().name("HeapHelper".into());
            if thread.stack_size(STACK_SIZE).spawn(run).is_err() {
                POOL.lock().threads -= 1;
            }
        }
    }

    fn run() {
        const IDLE_NANOSECONDS: u64 = 10_000_000_000;
        super::IS_HELPER_THREAD.set(true);
        let mut stack = MarkStack::default();
        loop {
            let has_news = spin_until(|| WAITING_SHARES.load(Ordering::Relaxed) != 0);
            let mut pool = POOL.lock();
            if !has_news && pool.shares.is_empty() {
                stack.shrink();
                pool.asleep += 1;
                let result = SHARE_POSTED.timed_wait_guarded(&mut pool, IDLE_NANOSECONDS);
                pool.asleep -= 1;
                if result.is_err() && pool.shares.is_empty() {
                    pool.threads -= 1;
                    return;
                }
            }
            if pool.shares.is_empty() {
                continue;
            }
            let (marking, share) = pool.take(0);
            pool.busy += 1;
            pool.update_hints();
            drop(pool);
            stack = marking.help(share, stack);
            let mut pool = POOL.lock();
            pool.busy -= 1;
            pool.update_hints();
        }
    }
}
