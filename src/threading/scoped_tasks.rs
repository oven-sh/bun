//! Thread pool tasks that borrow from the caller's stack, like [`std::thread::scope`].

use core::ops::{Index, IndexMut};
use core::ptr::NonNull;

use crate::thread_pool::{Batch, CountedTask, Task};
use crate::unbounded_queue::BatchIterator;
use crate::{Link, Linked, UnboundedQueue, WaitGroup};

pub trait TaskRunner<T>: Sync {
    /// Schedules `batch` on the thread pool.
    fn schedule(batch: Batch);

    /// Called on a pool thread.
    fn run(&self, task: &mut T);

    /// Called on the same thread after `run`, once the task is in the finished queue.
    fn on_finished(&self);
}

/// Never borrowed as a whole: a pool thread uses the other fields while `in_flight` is read.
#[repr(C)]
struct Slot<T> {
    counted: CountedTask,
    next: Link<Slot<T>>,
    /// `*const Scope<'_, T, _>`
    scope: *const (),
    in_flight: bool,
    task: T,
}

// SAFETY: always the same field.
unsafe impl<T> Linked for Slot<T> {
    unsafe fn link(item: *mut Self) -> *const Link<Self> {
        // SAFETY: fn contract.
        unsafe { &raw const (*item).next }
    }
}

struct Scope<'a, T, R> {
    runner: &'a R,
    finished: UnboundedQueue<Slot<T>>,
}

/// A task is in flight from `schedule` until `next_finished` returns it. Accessing it then panics.
pub struct ScopedTasks<'a, T> {
    slots: NonNull<[Slot<T>]>,
    schedule: fn(Batch),
    finished: &'a UnboundedQueue<Slot<T>>,
    finished_batch: BatchIterator<Slot<T>>,
    running: &'a WaitGroup,
}

/// Waits for every scheduled task before it returns.
pub fn scope<T: Send, R: TaskRunner<T>, U>(
    runner: &R,
    tasks: impl Iterator<Item = T>,
    f: impl FnOnce(ScopedTasks<'_, T>) -> U,
) -> U {
    unsafe fn run<T, R: TaskRunner<T>>(pool_task: *mut Task) {
        let slot = pool_task.cast::<Slot<T>>();
        // SAFETY: `schedule` passed the address of a slot, and nothing else uses its `task` until
        // `next_finished` returns it. `scope` keeps the slots and the `Scope` alive until `running`
        // reaches zero, which `CountedTask` only lets happen after this function has returned.
        unsafe {
            let scope = (*slot).scope.cast::<Scope<'_, T, R>>();
            (*scope).runner.run(&mut (*slot).task);
            (*scope).finished.push(NonNull::new_unchecked(slot));
            (*scope).runner.on_finished();
        }
    }

    let running = WaitGroup::init();
    let scope = Scope {
        runner,
        finished: UnboundedQueue::new(),
    };
    let mut slots: Box<[Slot<T>]> = tasks
        .map(|task| Slot {
            counted: CountedTask::new(run::<T, R>, &running),
            next: Link::new(),
            scope: (&raw const scope).cast(),
            in_flight: false,
            task,
        })
        .collect();
    scopeguard::defer! { running.wait(); }
    f(ScopedTasks {
        slots: NonNull::from(&mut *slots),
        schedule: R::schedule,
        finished: &scope.finished,
        finished_batch: scope.finished.pop_batch().iterator(),
        running: &running,
    })
}

impl<T> ScopedTasks<'_, T> {
    fn idle_slot(&self, index: usize) -> *mut Slot<T> {
        assert!(index < self.slots.len());
        // SAFETY: in bounds. Only `self` uses `in_flight`.
        unsafe {
            let slot = self.slots.as_ptr().cast::<Slot<T>>().add(index);
            assert!(!(*slot).in_flight);
            slot
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        (0..self.slots.len()).map(|index| &self[index])
    }

    pub fn schedule(&mut self, index: usize) {
        let slot = self.idle_slot(index);
        // SAFETY: as in `idle_slot`.
        unsafe { (*slot).in_flight = true };
        self.running.add_one();
        // The pool's `Task` is at offset 0, and it is not queued because the slot was idle.
        (self.schedule)(Batch::from(slot.cast::<Task>()));
    }

    /// Does nothing until `next_finished` has returned all of the previous batch.
    pub fn pop_finished_batch(&mut self) {
        if self.finished_batch.batch.count == 0 {
            self.finished_batch = self.finished.pop_batch().iterator();
        }
    }

    pub fn next_finished(&mut self) -> Option<&mut T> {
        let slot = NonNull::new(self.finished_batch.next())?.as_ptr();
        // SAFETY: `run` pushed the slot, once per `schedule`, and does not use it afterwards.
        unsafe {
            (*slot).in_flight = false;
            Some(&mut (*slot).task)
        }
    }

    /// Blocks until no task is queued or running.
    pub fn wait(&self) {
        self.running.wait();
    }
}

impl<T> Index<usize> for ScopedTasks<'_, T> {
    type Output = T;

    fn index(&self, index: usize) -> &T {
        // SAFETY: not in flight, and `schedule` takes `&mut self`.
        unsafe { &(*self.idle_slot(index)).task }
    }
}

impl<T> IndexMut<usize> for ScopedTasks<'_, T> {
    fn index_mut(&mut self, index: usize) -> &mut T {
        // SAFETY: as in `index`.
        unsafe { &mut (*self.idle_slot(index)).task }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Guarded;
    use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

    static THREADS: Guarded<Vec<std::thread::JoinHandle<()>>> = Guarded::new(Vec::new());

    fn join_threads() {
        for thread in THREADS.lock().drain(..) {
            thread.join().unwrap();
        }
    }

    struct Runner<'a>(&'a AtomicUsize);

    impl TaskRunner<(usize, Vec<usize>)> for Runner<'_> {
        fn schedule(batch: Batch) {
            let task = AtomicPtr::new(batch.head.unwrap().as_ptr());
            let thread = std::thread::Builder::new().spawn(move || {
                let task = task.into_inner();
                // SAFETY: a scheduled task, run once.
                unsafe { ((*task).callback)(task) }
            });
            THREADS.lock().push(thread.unwrap());
        }

        fn run(&self, (index, runs): &mut (usize, Vec<usize>)) {
            runs.push(*index);
        }

        fn on_finished(&self) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn finished_tasks_can_be_scheduled_again() {
        let finished = AtomicUsize::new(0);
        let tasks = (0..4).map(|index| (index, Vec::new()));
        scope(&Runner(&finished), tasks, |mut tasks| {
            (0..4).for_each(|index| tasks.schedule(index));
            let mut left = 4;
            while left > 0 {
                tasks.pop_finished_batch();
                while let Some((index, runs)) = tasks.next_finished() {
                    let index = *index;
                    if runs.len() < 3 {
                        tasks[index].1.reserve(1);
                        tasks.schedule(index);
                    } else {
                        left -= 1;
                    }
                }
                std::thread::yield_now();
            }
            assert!(tasks.iter().all(|(index, runs)| *runs == [*index; 3]));
            // Still in flight when the closure returns.
            tasks.schedule(0);
        });
        assert_eq!(finished.into_inner(), 13);
        join_threads();
    }

    #[test]
    #[should_panic = "in_flight"]
    fn index_panics_while_in_flight() {
        let finished = AtomicUsize::new(0);
        scope(
            &Runner(&finished),
            [(0, Vec::new())].into_iter(),
            |mut tasks| {
                tasks.schedule(0);
                join_threads();
                let _ = &tasks[0];
            },
        );
    }
}
