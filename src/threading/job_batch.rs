//! A boxed slice of jobs run once each on a [`ThreadPool`] and joined: the
//! scheduling thread gets the jobs (and whatever they produced) back after
//! [`JobBatch::wait`]. Every job runs against one shared, read-only context
//! borrowed from the scheduling thread's frame — the batch's `Drop` waits for
//! stragglers, so that borrow cannot dangle.

use core::cell::UnsafeCell;
use core::ptr::NonNull;

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
    /// Both leaked boxes, freed in `Drop`/`finish` after `wait()`: the pool
    /// holds pointers to the slots, and the slots to the group, while `self`
    /// is free to move.
    slots: NonNull<[Slot<'c, C, T>]>,
    group: NonNull<WaitGroup>,
    scheduled: bool,
    waited: bool,
}

impl<'c, C: Sync, T: BatchJob<C>> JobBatch<'c, C, T> {
    pub fn new(ctx: &'c C, jobs: impl ExactSizeIterator<Item = T>) -> Self {
        let group = NonNull::from(Box::leak(Box::new(WaitGroup::init_with_count(jobs.len()))));
        let group_ptr: *const WaitGroup = group.as_ptr();
        let slots: Box<[Slot<'c, C, T>]> = jobs
            .map(|job| Slot {
                task: Task {
                    node: Node::default(),
                    callback: run_slot::<C, T>,
                },
                group: group_ptr,
                ctx,
                job: UnsafeCell::new(job),
            })
            .collect();
        Self {
            slots: NonNull::from(Box::leak(slots)),
            group,
            scheduled: false,
            waited: false,
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Every job, as one pool batch (not yet scheduled). Once only.
    pub fn as_batch(&mut self) -> Batch {
        assert!(!self.scheduled, "JobBatch scheduled twice");
        self.scheduled = true;
        let mut batch = Batch::default();
        let base: *mut Slot<'c, C, T> = self.slots.as_ptr().cast();
        for i in 0..self.len() {
            // The whole-slot pointer, derived from the leaked allocation (not
            // from a reborrow), so the callback's cast back to `Slot` keeps
            // provenance over `job` for as long as the allocation lives.
            // SAFETY: `i < len`.
            batch.push(Batch::from(unsafe { base.add(i) }.cast::<Task>()));
        }
        batch
    }

    /// Block until every job has run (immediately, if never scheduled).
    pub fn wait(&mut self) {
        if self.scheduled && !self.waited {
            // SAFETY: leaked in `new`, freed only in `Drop`.
            unsafe { self.group.as_ref() }.wait();
        }
        self.waited = true;
    }

    /// [`wait`](Self::wait), then the jobs.
    pub fn finish(mut self) -> impl ExactSizeIterator<Item = T> {
        self.wait();
        let empty: Box<[Slot<'c, C, T>]> = Box::new([]);
        let slots = core::mem::replace(&mut self.slots, NonNull::from(Box::leak(empty)));
        // SAFETY: from `Box::leak` in `new`; every job has finished with it
        // (`wait` above). `self` keeps an empty leaked slice for its `Drop`.
        unsafe { Box::from_raw(slots.as_ptr()) }
            .into_vec()
            .into_iter()
            .map(|slot| slot.job.into_inner())
    }
}

impl<C: Sync, T: BatchJob<C>> Drop for JobBatch<'_, C, T> {
    fn drop(&mut self) {
        // A scheduled job points into `slots`; wait it out rather than free it.
        self.wait();
        // SAFETY: both from `Box::leak` (`new`/`finish`); every job has
        // finished with them.
        unsafe {
            drop(Box::from_raw(self.slots.as_ptr()));
            drop(Box::from_raw(self.group.as_ptr()));
        }
    }
}

// SAFETY: `job` is only touched by the one worker that runs its slot (between
// `as_batch` being scheduled and the group completing) and by the owner otherwise; `T: Send`
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

#[cfg(test)]
mod tests {
    use super::*;

    struct Doubler(u32);
    impl BatchJob<u32> for Doubler {
        fn run(&mut self, k: &u32) {
            self.0 *= *k;
        }
    }

    struct SendBatch(Batch);
    // SAFETY: what a thread pool does with a batch: run its tasks elsewhere.
    unsafe impl Send for SendBatch {}

    /// Hand the pool the slots, *move the `JobBatch`* (into a struct, like
    /// `SourceMapJobs`), run the slots on another thread, then collect. Under
    /// Miri this fails if the slots or the wait group were reached through a
    /// `Box` that the move retagged.
    #[test]
    fn jobs_run_elsewhere_while_the_batch_moves() {
        let k = 3u32;
        let mut jobs = JobBatch::new(&k, (1..5u32).map(Doubler));
        let batch = SendBatch(jobs.as_batch());
        struct Holder<'c>(Option<JobBatch<'c, u32, Doubler>>);
        let holder = Holder(Some(jobs)); // the move
        let t = std::thread::spawn(move || {
            let mut batch = batch;
            while let Some(task) = batch.0.pop() {
                // SAFETY: how the pool runs a task.
                unsafe { ((*task.as_ptr()).callback)(task.as_ptr()) };
            }
        });
        let out: Vec<u32> = holder.0.unwrap().finish().map(|d| d.0).collect();
        t.join().unwrap();
        assert_eq!(out, vec![3, 6, 9, 12]);
    }

    #[test]
    fn unscheduled_batch_drops_without_waiting() {
        let k = 1u32;
        let jobs = JobBatch::new(&k, (0..2u32).map(Doubler));
        drop(jobs);
    }
}
