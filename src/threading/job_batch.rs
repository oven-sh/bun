//! A boxed slice of jobs run once each on a [`ThreadPool`] and joined: the
//! scheduling thread gets the jobs (and whatever they produced) back after
//! [`JobBatch::wait`]. Every job runs against one shared, read-only context
//! borrowed from the scheduling thread's frame — the batch's `Drop` waits for
//! stragglers, so that borrow cannot dangle.

use core::cell::UnsafeCell;

use crate::WaitGroup;
use crate::thread_pool::{Batch, Node, Task};

/// One unit of work in a [`JobBatch`]: `run` executes once on a worker thread
/// with exclusive access to the job and shared access to the batch's context,
/// so the job must be `Send` and the context `Sync`.
pub trait BatchJob<C: Sync>: Send + Sized {
    fn run(&mut self, ctx: &C);
}

#[repr(C)]
struct Slot<'c, C, T> {
    /// First, so the pool's `*mut Task` is also the slot's address.
    task: Task,
    group: *const WaitGroup,
    ctx: &'c C,
    job: UnsafeCell<T>,
}

/// See the module doc.
pub struct JobBatch<'c, C: Sync, T: BatchJob<C>> {
    slots: Box<[Slot<'c, C, T>]>,
    /// Boxed so the slots can point at it while `self` moves.
    group: Box<WaitGroup>,
    scheduled: bool,
    waited: bool,
}

impl<'c, C: Sync, T: BatchJob<C>> JobBatch<'c, C, T> {
    pub fn new(ctx: &'c C, jobs: impl ExactSizeIterator<Item = T>) -> Self {
        let group = Box::new(WaitGroup::init_with_count(jobs.len()));
        let group_ptr: *const WaitGroup = &raw const *group;
        Self {
            slots: jobs
                .map(|job| Slot {
                    task: Task {
                        node: Node::default(),
                        callback: run_slot::<C, T>,
                    },
                    group: group_ptr,
                    ctx,
                    job: UnsafeCell::new(job),
                })
                .collect(),
            group,
            scheduled: false,
            waited: false,
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Every job, as one pool batch (not yet scheduled). Once only.
    pub fn as_batch(&mut self) -> Batch {
        assert!(!self.scheduled, "JobBatch scheduled twice");
        self.scheduled = true;
        let mut batch = Batch::default();
        for slot in self.slots.iter_mut() {
            let slot: *mut Slot<'c, C, T> = slot;
            // The whole-slot pointer (not a reborrow of `task`) so the
            // callback's cast back to `Slot` has provenance over `job`.
            batch.push(Batch::from(slot.cast::<Task>()));
        }
        batch
    }

    /// Block until every job has run (immediately, if never scheduled).
    pub fn wait(&mut self) {
        if self.scheduled && !self.waited {
            self.group.wait();
        }
        self.waited = true;
    }

    /// [`wait`](Self::wait), then the jobs.
    pub fn finish(mut self) -> impl ExactSizeIterator<Item = T> {
        self.wait();
        core::mem::take(&mut self.slots)
            .into_vec()
            .into_iter()
            .map(|slot| slot.job.into_inner())
    }
}

impl<C: Sync, T: BatchJob<C>> Drop for JobBatch<'_, C, T> {
    fn drop(&mut self) {
        // A scheduled job points into `slots`; wait it out rather than free it.
        self.wait();
    }
}

// SAFETY: `job` is only touched by the one worker that runs its slot (between
// `schedule` and the group completing) and by the owner otherwise; `T: Send`
// and `C: Sync` (the `BatchJob` bounds) vouch for the cross-thread run.
unsafe impl<C: Sync, T: BatchJob<C>> Send for JobBatch<'_, C, T> {}
// SAFETY: `&JobBatch` exposes nothing of the jobs.
unsafe impl<C: Sync, T: BatchJob<C>> Sync for JobBatch<'_, C, T> {}

unsafe fn run_slot<C: Sync, T: BatchJob<C>>(task: *mut Task) {
    // SAFETY: `task` is the address of a `#[repr(C)] Slot<C, T>` (see `as_batch`)
    // inside a `JobBatch` that `wait`/`Drop` keeps alive until the group
    // completes; the pool runs each slot once, so this `&mut` is exclusive.
    let (job, ctx, group) = unsafe {
        let slot = &*task.cast::<Slot<'_, C, T>>();
        (&mut *slot.job.get(), slot.ctx, slot.group)
    };
    job.run(ctx);
    // SAFETY: `group` is the batch's boxed `WaitGroup`, alive until `wait`
    // returns — which this may allow; `job` is not touched past this point.
    unsafe { WaitGroup::finish_raw(group) };
}
