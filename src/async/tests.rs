//! Run under Miri too (`bun run rust:miri -p bun_async`): every test ends with
//! nothing allocated, so a lost or doubled reference is a reported leak or
//! use-after-free.

use core::cell::{Cell, RefCell};
use core::future::{Future, poll_fn};
use core::pin::pin;
use core::sync::atomic::{AtomicUsize, Ordering};
use core::task::{Poll, Waker};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;

use bun_threading::{Condvar, Guarded};

use crate::task::{self, Runnable, Schedule};
use crate::{Blocking, Either, Slot, race};

thread_local! {
    static POOL: RefCell<Vec<std::thread::JoinHandle<()>>> = const { RefCell::new(Vec::new()) };
}

fn join_pool() {
    for thread in POOL.take() {
        thread.join().unwrap();
    }
}

/// A pool of one thread per task, for [`join_pool`] to end.
fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Blocking<T> {
    struct Submitted(*mut bun_threading::work_pool::Task);
    // SAFETY: a pool task is made to be run by another thread.
    unsafe impl Send for Submitted {}
    impl Submitted {
        fn run(self) {
            // SAFETY: what a pool does with a task it was given, once.
            unsafe { ((*self.0).callback)(self.0) }
        }
    }
    crate::blocking(
        |task| {
            let task = Submitted(task);
            POOL.with_borrow_mut(|pool| pool.push(on_another_thread(move || task.run())));
        },
        (),
        work,
    )
}

/// The least a loop can be: a queue another thread may push to.
#[derive(Default)]
struct Loop {
    queue: Guarded<VecDeque<Runnable<OnLoop>>>,
    pushed: Condvar,
    finished: AtomicUsize,
}

struct OnLoop(Arc<Loop>);

// SAFETY: queued tasks are only taken by `Loop`'s methods, which the tests call on the spawning thread.
unsafe impl Schedule for OnLoop {
    type Output = u32;
    fn schedule(task: Runnable<Self>) {
        let event_loop = Arc::clone(&task.scheduler().0);
        event_loop.queue.lock().push_back(task);
        event_loop.pushed.notify_all();
    }
    fn finished(&self) {
        self.0.finished.fetch_add(1, Ordering::Relaxed);
    }
}

impl Loop {
    fn spawn(self: &Arc<Self>, future: impl Future<Output = u32> + 'static) -> Runnable<OnLoop> {
        task::spawn(future, OnLoop(Arc::clone(self)))
    }

    fn queued(&self) -> usize {
        self.queue.lock().len()
    }

    fn run_one(&self) -> Option<u32> {
        let task = self.queue.lock().pop_front().expect("nothing queued");
        // SAFETY: the spawning thread.
        unsafe { task.run() }
    }

    /// Sleeps until something is queued, as a loop does in `epoll_wait`.
    fn run_until_finished(&self) -> u32 {
        loop {
            let task = {
                let mut queue = self.queue.lock();
                loop {
                    if let Some(task) = queue.pop_front() {
                        break task;
                    }
                    self.pushed.wait_guarded(&mut queue);
                }
            };
            // SAFETY: the spawning thread.
            if let Some(output) = unsafe { task.run() } {
                return output;
            }
        }
    }

    fn finished(&self) -> usize {
        self.finished.load(Ordering::Relaxed)
    }
}

/// Counts itself out when the future that holds it is dropped.
struct Held(Rc<Cell<usize>>);
impl Held {
    fn new(count: &Rc<Cell<usize>>) -> Self {
        count.set(count.get() + 1);
        Self(Rc::clone(count))
    }
}
impl Drop for Held {
    fn drop(&mut self) {
        self.0.set(self.0.get() - 1);
    }
}

fn on_another_thread(f: impl FnOnce() + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::Builder::new().spawn(f).expect("spawn")
}

/// Suspends forever, handing its `Waker` out.
async fn park(waker: Rc<Cell<Option<Waker>>>) {
    poll_fn(|cx| {
        waker.set(Some(cx.waker().clone()));
        Poll::<()>::Pending
    })
    .await
}

#[test]
fn finishes_in_the_first_poll() {
    let event_loop = Arc::new(Loop::default());
    let task = event_loop.spawn(async { 7 });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, Some(7));
    assert_eq!(event_loop.queued(), 0);
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn a_filled_slot_queues_the_task_once() {
    let event_loop = Arc::new(Loop::default());
    let slots = Rc::new((Slot::new(), Slot::new()));
    let task = event_loop.spawn({
        let slots = Rc::clone(&slots);
        async move {
            let a: u32 = poll_fn(|cx| slots.0.poll_take(cx)).await;
            let b: u32 = poll_fn(|cx| slots.1.poll_take(cx)).await;
            a + b
        }
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(event_loop.queued(), 0);
    slots.1.fill(2);
    assert_eq!(event_loop.queued(), 0, "nobody waits for it yet");
    slots.0.fill(40);
    slots.0.fill(40);
    assert_eq!(event_loop.queued(), 1);
    assert_eq!(event_loop.run_one(), Some(42));
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn a_wake_from_another_thread_reaches_the_loop() {
    let event_loop = Arc::new(Loop::default());
    let task = event_loop.spawn(async {
        let mut thread = None;
        poll_fn(|cx| {
            if thread.is_some() {
                return Poll::Ready(());
            }
            let waker = cx.waker().clone();
            thread = Some(on_another_thread(move || waker.wake()));
            Poll::Pending
        })
        .await;
        thread.unwrap().join().expect("join");
        1
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(event_loop.run_until_finished(), 1);
}

#[test]
fn many_threads_wake_one_task() {
    let event_loop = Arc::new(Loop::default());
    let hits = Arc::new(AtomicUsize::new(0));
    const THREADS: usize = 4;
    let task = event_loop.spawn({
        let hits = Arc::clone(&hits);
        async move {
            let mut threads = Vec::new();
            poll_fn(|cx| {
                if threads.is_empty() {
                    for _ in 0..THREADS {
                        let (waker, hits) = (cx.waker().clone(), Arc::clone(&hits));
                        threads.push(on_another_thread(move || {
                            hits.fetch_add(1, Ordering::Release);
                            waker.wake_by_ref();
                        }));
                    }
                }
                match hits.load(Ordering::Acquire) {
                    THREADS => Poll::Ready(()),
                    _ => Poll::Pending,
                }
            })
            .await;
            for thread in threads {
                thread.join().expect("join");
            }
            5
        }
    });
    // SAFETY: the spawning thread.
    if unsafe { task.run() }.is_none() {
        assert_eq!(event_loop.run_until_finished(), 5);
    }
    while event_loop.queued() > 0 {
        assert_eq!(event_loop.run_one(), None);
    }
}

#[test]
fn cancelling_a_suspended_task_drops_its_future_at_once() {
    let event_loop = Arc::new(Loop::default());
    let (held, waker) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(None)));
    let task = event_loop.spawn({
        let (guard, waker) = (Held::new(&held), Rc::clone(&waker));
        async move {
            park(waker).await;
            drop(guard);
            0
        }
    });
    let scheduler = task.scheduler_ptr();
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(held.get(), 1);
    // SAFETY: `waker` keeps the task allocated; the spawning thread.
    unsafe { task::cancel(scheduler) };
    assert_eq!(held.get(), 0);
    assert_eq!(event_loop.finished(), 1);
    // SAFETY: as above.
    unsafe { task::cancel(scheduler) };
    assert_eq!(event_loop.finished(), 1);
    waker.take().unwrap().wake();
    assert_eq!(event_loop.queued(), 0, "there is nothing left to run");
}

#[test]
fn cancelling_a_queued_task_leaves_a_stale_entry() {
    let event_loop = Arc::new(Loop::default());
    let (held, waker) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(None)));
    let task = event_loop.spawn({
        let (guard, waker) = (Held::new(&held), Rc::clone(&waker));
        async move {
            park(waker).await;
            drop(guard);
            0
        }
    });
    let scheduler = task.scheduler_ptr();
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    waker.take().unwrap().wake();
    assert_eq!(event_loop.queued(), 1);
    // SAFETY: the queue keeps the task allocated; the spawning thread.
    unsafe { task::cancel(scheduler) };
    assert_eq!(held.get(), 0);
    assert_eq!(event_loop.run_one(), None);
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn a_loop_that_is_going_away_cancels_what_is_queued() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let guard = Held::new(&held);
    let task = event_loop.spawn(async move {
        drop(guard);
        0
    });
    // SAFETY: the spawning thread.
    unsafe { task.cancel() };
    assert_eq!(held.get(), 0);
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn a_task_that_cancels_itself_is_dropped_after_the_poll() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let scheduler = Rc::new(Cell::new(None));
    let task = event_loop.spawn({
        let (guard, scheduler, held) = (Held::new(&held), Rc::clone(&scheduler), Rc::clone(&held));
        async move {
            poll_fn(|cx| {
                // SAFETY: the task is running, on the spawning thread.
                unsafe { task::cancel::<OnLoop>(scheduler.get().unwrap()) };
                assert_eq!(held.get(), 1, "not while it is being polled");
                cx.waker().wake_by_ref();
                Poll::<()>::Pending
            })
            .await;
            drop(guard);
            0
        }
    });
    scheduler.set(Some(task.scheduler_ptr()));
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(held.get(), 0);
    assert_eq!(event_loop.finished(), 1);
    assert_eq!(event_loop.run_one(), None);
}

#[test]
fn a_task_nothing_can_wake_is_dropped_by_its_loop() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let guard = Held::new(&held);
    let task = event_loop.spawn(async move {
        poll_fn(|_| Poll::<()>::Pending).await;
        drop(guard);
        0
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(held.get(), 1);
    assert_eq!(event_loop.run_one(), None);
    assert_eq!(held.get(), 0);
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn the_last_waker_dropped_on_another_thread_sends_the_task_home() {
    let event_loop = Arc::new(Loop::default());
    let (held, waker) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(None)));
    let task = event_loop.spawn({
        let (guard, waker) = (Held::new(&held), Rc::clone(&waker));
        async move {
            park(waker).await;
            drop(guard);
            0
        }
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    let waker = waker.take().unwrap();
    on_another_thread(move || drop(waker)).join().expect("join");
    assert_eq!(held.get(), 1, "its future is this thread's to drop");
    assert_eq!(event_loop.run_one(), None);
    assert_eq!(held.get(), 0);
}

#[test]
fn abandoning_a_slot_orphans_the_task() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let slot = Rc::new(Slot::<u32>::new());
    let task = event_loop.spawn({
        let (guard, slot) = (Held::new(&held), Rc::clone(&slot));
        async move {
            let value = poll_fn(|cx| slot.poll_take(cx)).await;
            drop(guard);
            value
        }
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    slot.abandon();
    assert_eq!(held.get(), 1);
    assert_eq!(event_loop.run_one(), None);
    assert_eq!(held.get(), 0);
}

#[test]
fn a_loop_ticked_from_inside_a_poll_does_not_poll_again() {
    let event_loop = Arc::new(Loop::default());
    let polls = Rc::new(Cell::new(0));
    let task = event_loop.spawn({
        let (event_loop, polls) = (Arc::clone(&event_loop), Rc::clone(&polls));
        async move {
            poll_fn(|cx| {
                polls.set(polls.get() + 1);
                if polls.get() == 2 {
                    return Poll::Ready(());
                }
                cx.waker().wake_by_ref();
                assert_eq!(event_loop.run_one(), None);
                assert_eq!(polls.get(), 1);
                Poll::Pending
            })
            .await;
            9
        }
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    assert_eq!(event_loop.run_one(), Some(9));
}

#[test]
fn the_loser_of_a_race_is_dropped() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let slot = Rc::new(Slot::<u32>::new());
    let task = event_loop.spawn({
        let (guard, slot, held) = (Held::new(&held), Rc::clone(&slot), Rc::clone(&held));
        async move {
            let never = async move {
                poll_fn(|_| Poll::<()>::Pending).await;
                drop(guard);
            };
            match race(never, poll_fn(|cx| slot.poll_take(cx))).await {
                Either::Left(()) => unreachable!(),
                Either::Right(value) => {
                    assert_eq!(held.get(), 0);
                    value
                }
            }
        }
    });
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    slot.fill(3);
    assert_eq!(event_loop.run_one(), Some(3));
}

#[test]
fn blocking_work_comes_back() {
    let event_loop = Arc::new(Loop::default());
    let task = event_loop.spawn(async {
        let input = vec![1u32, 2, 3];
        let started: Vec<_> = (0..3)
            .map(|i| {
                let input = input.clone();
                blocking(move || input[i] * 10)
            })
            .collect();
        let mut sum = 0;
        for work in started {
            sum += work.await;
        }
        sum
    });
    // SAFETY: the spawning thread.
    let output = unsafe { task.run() };
    assert_eq!(
        output.unwrap_or_else(|| event_loop.run_until_finished()),
        60
    );
    join_pool();
    while event_loop.queued() > 0 {
        assert_eq!(event_loop.run_one(), None);
    }
}

#[test]
fn abandoned_blocking_work_frees_itself() {
    let dropped = Arc::new(AtomicUsize::new(0));
    struct Result_(Arc<AtomicUsize>);
    impl Drop for Result_ {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::Release);
        }
    }
    let result = Result_(Arc::clone(&dropped));
    drop(blocking(move || result));
    join_pool();
    assert_eq!(dropped.load(Ordering::Acquire), 1);
}

#[test]
fn blocking_work_polled_with_a_new_waker_wakes_that_one() {
    let event_loop = Arc::new(Loop::default());
    let gate = Arc::new(AtomicUsize::new(0));
    let task = event_loop.spawn({
        let gate = Arc::clone(&gate);
        async move {
            let mut work = pin!(blocking({
                let gate = Arc::clone(&gate);
                move || {
                    while gate.load(Ordering::Acquire) == 0 {
                        std::thread::yield_now();
                    }
                    4
                }
            }));
            // Registers a waker that goes nowhere, then the task's own.
            assert!(
                work.as_mut()
                    .poll(&mut core::task::Context::from_waker(Waker::noop()))
                    .is_pending()
            );
            let polled = poll_fn(|cx| Poll::Ready(work.as_mut().poll(cx))).await;
            assert!(polled.is_pending());
            gate.store(1, Ordering::Release);
            work.await
        }
    });
    // SAFETY: the spawning thread.
    let output = unsafe { task.run() };
    assert_eq!(output.unwrap_or_else(|| event_loop.run_until_finished()), 4);
    join_pool();
}

#[test]
fn cancel_races_with_the_last_waker_dropped_on_another_thread() {
    let event_loop = Arc::new(Loop::default());
    let held = Rc::new(Cell::new(0));
    let waker = Rc::new(Cell::new(None));
    let task = event_loop.spawn({
        let (held, waker) = (Held::new(&held), Rc::clone(&waker));
        async move {
            let _held = held;
            park(waker).await;
            0
        }
    });
    let scheduler = task.scheduler_ptr();
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    let waker = waker.take().unwrap();
    let thread = on_another_thread(move || drop(waker));
    // SAFETY: it has not finished, so it is allocated; the spawning thread.
    unsafe { task::cancel(scheduler) };
    thread.join().unwrap();
    assert_eq!(held.get(), 0);
    while event_loop.queued() > 0 {
        assert_eq!(event_loop.run_one(), None);
    }
    assert_eq!(event_loop.finished(), 1);
}

#[test]
fn a_loop_that_refuses_an_orphan_is_asked_once() {
    struct Refuses(Arc<AtomicUsize>);
    // SAFETY: it drops every `Runnable`.
    unsafe impl Schedule for Refuses {
        type Output = u32;
        fn schedule(task: Runnable<Self>) {
            task.scheduler().0.fetch_add(1, Ordering::Relaxed);
        }
    }
    let asked = Arc::new(AtomicUsize::new(0));
    let held = Rc::new(Cell::new(0));
    let waker = Rc::new(Cell::new(None));
    let task = task::spawn(
        {
            let (held, waker) = (Held::new(&held), Rc::clone(&waker));
            async move {
                let _held = held;
                park(waker).await;
                0
            }
        },
        Refuses(Arc::clone(&asked)),
    );
    let scheduler = task.scheduler_ptr();
    // SAFETY: the spawning thread.
    assert_eq!(unsafe { task.run() }, None);
    drop(waker.take());
    assert_eq!(asked.load(Ordering::Relaxed), 1);
    assert_eq!(held.get(), 1);
    // SAFETY: it has not finished, so it is allocated; the spawning thread.
    unsafe { task::cancel(scheduler) };
    assert_eq!(held.get(), 0);
}
