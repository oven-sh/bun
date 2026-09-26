//! Work on bun's thread pool that reports back to the thread of the loop: what `Bun.write`, the
//! bundler and `bun install` do with their work.

use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_event_loop::MiniEventLoop::MiniEventLoop;
use bun_threading::work_pool::{Task, WorkPool};

use crate::Loop;
use crate::json::Report;

const JOBS: u64 = 16;
const NUMBERS: u64 = 200_000;

/// What the thread of the loop and the threads of the pool share.
struct Shared {
    event_loop: *mut MiniEventLoop,
    loop_thread: std::thread::ThreadId,
    ran_on_the_loop_thread: AtomicU64,
}

struct Job {
    task: Task,
    shared: *const Shared,
    number: u64,
    sum: u64,
    /// Set by the thread of the loop, which is where the results are counted.
    results: *mut Results,
}

#[derive(Default)]
struct Results {
    reported: u64,
    sum: u64,
    reported_off_the_loop_thread: u64,
}

bun_threading::owned_task!(Job, task);

impl Job {
    /// On a thread of the pool.
    fn run_owned(mut self: Box<Self>) {
        // SAFETY: `step` keeps the `Shared` until every job has reported.
        let shared = unsafe { &*self.shared };
        if std::thread::current().id() == shared.loop_thread {
            shared.ran_on_the_loop_thread.fetch_add(1, Ordering::SeqCst);
        }
        // An allocation and a sum: work that needs the allocator and nothing of the loop.
        let numbers: Vec<u64> = (0..NUMBERS).map(|index| index ^ self.number).collect();
        self.sum = numbers.iter().copied().sum();
        let event_loop = shared.event_loop;
        let job = Box::into_raw(self);
        let task = AnyTaskWithExtraContext::from_callback_auto_deinit(job, Job::report);
        // SAFETY: the queue of the loop takes tasks from every thread, and wakes the loop.
        unsafe { (*event_loop).enqueue_task_concurrent(NonNull::new_unchecked(task)) };
    }

    /// On the thread of the loop.
    fn report(job: *mut Job, _: *mut c_void) {
        // SAFETY: the job was a `Box` until `run_owned` gave it to the loop.
        let job = unsafe { Box::from_raw(job) };
        // SAFETY: as in `run_owned`, and the results are the loop thread's alone.
        let (shared, results) = unsafe { (&*job.shared, &mut *job.results) };
        if std::thread::current().id() != shared.loop_thread {
            results.reported_off_the_loop_thread += 1;
        }
        results.reported += 1;
        results.sum = results.sum.wrapping_add(job.sum);
    }
}

pub(crate) fn step(report: &mut Report, event_loop: &Loop) -> bool {
    let shared = Shared {
        event_loop: event_loop.mini,
        loop_thread: std::thread::current().id(),
        ran_on_the_loop_thread: AtomicU64::new(0),
    };
    let mut results = Results::default();
    let results_pointer = &raw mut results;
    for number in 0..JOBS {
        WorkPool::schedule_owned(Box::new(Job {
            task: Task::default(),
            shared: &raw const shared,
            number,
            sum: 0,
            results: results_pointer,
        }));
    }
    // SAFETY: the callbacks that write the results run inside of `run_until`, on this thread.
    event_loop.run_until(|| unsafe { (*results_pointer).reported } == JOBS);

    let expected: u64 = (0..JOBS)
        .map(|number| (0..NUMBERS).map(|index| index ^ number).sum::<u64>())
        .fold(0, u64::wrapping_add);
    let ran_on_the_loop_thread = shared.ran_on_the_loop_thread.load(Ordering::SeqCst);
    report.begin("thread pool");
    report.number("jobs", JOBS as i64);
    report.number("reported", results.reported as i64);
    report.boolean("sum_as_expected", results.sum == expected);
    report.number("ran_on_the_loop_thread", ran_on_the_loop_thread as i64);
    report.number(
        "reported_off_the_loop_thread",
        results.reported_off_the_loop_thread as i64,
    );
    report.end_ok();
    results.reported == JOBS
        && results.sum == expected
        && ran_on_the_loop_thread == 0
        && results.reported_off_the_loop_thread == 0
}
