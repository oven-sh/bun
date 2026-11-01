//! What the glue costs next to the least a hand-written task can be: a boxed struct and a function
//! pointer in the same kind of queue. `cargo bench -p bun_async`
#![allow(clippy::disallowed_macros)]

use core::cell::RefCell;
use core::future::poll_fn;
use core::hint::black_box;
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Instant;

use bun_async::Slot;
use bun_async::task::{self, Runnable, Schedule};

fn main() {
    thread_local! {
        static QUEUE: RefCell<VecDeque<Runnable<OnThread>>> = const { RefCell::new(VecDeque::new()) };
    }
    struct OnThread;
    // SAFETY: the queue is the waking thread's own, and this test has one thread.
    unsafe impl Schedule for OnThread {
        type Output = u32;
        fn schedule(task: Runnable<Self>) {
            QUEUE.with_borrow_mut(|queue| queue.push_back(task));
        }
    }
    fn run_one() -> Option<u32> {
        let task = QUEUE.with_borrow_mut(|queue| queue.pop_front()).unwrap();
        // SAFETY: the spawning thread.
        unsafe { task.run() }
    }

    struct ByHand {
        run: fn(Box<ByHand>) -> u32,
        a: u32,
        b: u32,
    }

    const ROUNDS: u32 = 2_000_000;
    let per_round = |name: &str, mut round: Box<dyn FnMut(u32) -> u32>| {
        for i in 0..ROUNDS / 10 {
            black_box(round(i));
        }
        let start = Instant::now();
        let mut sum = 0u32;
        for i in 0..ROUNDS {
            sum = sum.wrapping_add(round(i));
        }
        let ns = start.elapsed().as_nanos() as f64 / f64::from(ROUNDS);
        println!("{name:<58} {ns:>7.1} ns   ({})", black_box(sum));
    };

    let mut queue: VecDeque<Box<ByHand>> = VecDeque::new();
    per_round(
        "by hand: box, queue, run, free",
        Box::new(move |i| {
            queue.push_back(Box::new(ByHand {
                run: |this| this.a.wrapping_add(this.b),
                a: i,
                b: 1,
            }));
            let task = queue.pop_front().unwrap();
            (task.run)(task)
        }),
    );
    per_round(
        "future: spawn, finish in the first poll, free",
        Box::new(|i| {
            let task = task::spawn(async move { black_box(i).wrapping_add(1) }, OnThread);
            // SAFETY: the spawning thread.
            unsafe { task.run() }.unwrap()
        }),
    );
    per_round(
        "future: spawn, suspend, wake, queue, resume, free",
        Box::new(|i| {
            let slot = Rc::new(Slot::<u32>::new());
            let task = task::spawn(
                {
                    let slot = Rc::clone(&slot);
                    async move { poll_fn(|cx| slot.poll_take(cx)).await.wrapping_add(1) }
                },
                OnThread,
            );
            // SAFETY: the spawning thread.
            assert!(unsafe { task.run() }.is_none());
            slot.fill(i);
            run_one().unwrap()
        }),
    );
    let slot = Rc::new(Slot::<u32>::new());
    let task = task::spawn(
        {
            let slot = Rc::clone(&slot);
            async move {
                loop {
                    black_box(poll_fn(|cx| slot.poll_take(cx)).await);
                }
            }
        },
        OnThread,
    );
    let scheduler = task.scheduler_ptr();
    // SAFETY: the spawning thread.
    assert!(unsafe { task.run() }.is_none());
    per_round(
        "future: each further suspend, wake, queue, resume",
        Box::new(move |i| {
            slot.fill(i);
            assert!(run_one().is_none());
            i
        }),
    );
    // SAFETY: its `Slot` holds a `Waker`, so it is allocated; the spawning thread.
    unsafe { task::cancel(scheduler) };
}
