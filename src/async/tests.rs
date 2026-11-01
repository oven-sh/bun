//! Run under Miri too (`bun run rust:miri -p bun_async`). Every test leaves its thread's loop empty.

use core::cell::{Cell, RefCell};
use core::future::poll_fn;
use core::task::{Poll, Waker};
use std::collections::VecDeque;
use std::rc::Rc;

use crate::{Either, Refused, Schedule, Slot, TaskId, Tasks, race};

/// The least a loop can be.
#[derive(Default)]
struct Loop {
    tasks: Tasks<OnLoop>,
    queue: RefCell<VecDeque<TaskId>>,
}

thread_local! {
    static LOOP: Loop = Loop::default();
}

#[derive(Clone, Copy, Default)]
struct OnLoop {
    scope: u32,
}

impl Schedule for OnLoop {
    type Output = u32;
    fn with_tasks<R>(f: impl FnOnce(&Tasks<Self>) -> R) -> Option<R> {
        LOOP.try_with(|event_loop| f(&event_loop.tasks)).ok()
    }
    fn schedule(self, id: TaskId) {
        LOOP.with(|event_loop| event_loop.queue.borrow_mut().push_back(id));
    }
}

fn spawn_in(scope: u32, future: impl Future<Output = u32> + 'static) -> TaskId {
    LOOP.with(|event_loop| event_loop.tasks.spawn(future, OnLoop { scope }))
        .expect("open")
}
fn spawn(future: impl Future<Output = u32> + 'static) -> TaskId {
    spawn_in(0, future)
}
fn run(id: TaskId) -> Option<u32> {
    LOOP.with(|event_loop| event_loop.tasks.run(id))
}
fn cancel(id: TaskId) -> bool {
    LOOP.with(|event_loop| event_loop.tasks.cancel(id))
}
fn running() -> Option<TaskId> {
    LOOP.with(|event_loop| event_loop.tasks.running())
}
fn alive() -> usize {
    LOOP.with(|event_loop| event_loop.tasks.len())
}
fn queued() -> usize {
    LOOP.with(|event_loop| event_loop.queue.borrow().len())
}
fn run_one() -> Option<u32> {
    let id = LOOP.with(|event_loop| event_loop.queue.borrow_mut().pop_front());
    run(id.expect("nothing queued"))
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

type WakerCell = Rc<Cell<Option<Waker>>>;

/// Suspends forever, handing its `Waker` out.
async fn park(waker: WakerCell) {
    poll_fn(|cx| {
        waker.set(Some(cx.waker().clone()));
        Poll::<()>::Pending
    })
    .await
}

/// A suspended task that holds a `Held`, and the `Waker` that keeps it.
fn parked(scope: u32, held: &Rc<Cell<usize>>) -> (TaskId, WakerCell) {
    let waker = WakerCell::default();
    let id = spawn_in(scope, {
        let (held, waker) = (Held::new(held), Rc::clone(&waker));
        async move {
            let _held = held;
            park(waker).await;
            0
        }
    });
    assert_eq!(run(id), None);
    (id, waker)
}

#[test]
fn finishes_in_the_first_poll() {
    let id = spawn(async { 7 });
    assert_eq!(alive(), 1);
    assert_eq!(run(id), Some(7));
    assert_eq!((alive(), queued()), (0, 0));
    assert_eq!(run(id), None, "its id names nothing now");
}

#[test]
fn a_filled_slot_queues_the_task_once() {
    let slots = Rc::new((Slot::new(), Slot::new()));
    let id = spawn({
        let slots = Rc::clone(&slots);
        async move {
            let a: u32 = poll_fn(|cx| slots.0.poll_take(cx)).await;
            let b: u32 = poll_fn(|cx| slots.1.poll_take(cx)).await;
            a + b
        }
    });
    assert_eq!(run(id), None);
    slots.1.fill(2);
    assert_eq!(queued(), 0, "nobody waits for it yet");
    slots.0.fill(40);
    slots.0.fill(40);
    assert_eq!(queued(), 1);
    assert_eq!(run_one(), Some(42));
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn what_another_thread_has_comes_through_the_loops_own_queue() {
    let (door, arrivals) = std::sync::mpsc::channel::<u32>();
    let slot = Rc::new(Slot::new());
    let id = spawn({
        let slot = Rc::clone(&slot);
        async move { poll_fn(|cx| slot.poll_take(cx)).await }
    });
    assert_eq!(run(id), None);
    let thread = on_another_thread(move || door.send(9).unwrap());
    slot.fill(arrivals.recv().unwrap());
    thread.join().unwrap();
    assert_eq!(run_one(), Some(9));
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn a_waker_on_another_thread_touches_nothing() {
    let held = Rc::new(Cell::new(0));
    let (id, waker) = parked(0, &held);
    let waker = waker.take().unwrap();
    let woke = on_another_thread(move || {
        drop(waker.clone());
        waker.wake();
    });
    assert!(woke.join().is_err(), "waking there is a bug, and says so");
    assert_eq!((held.get(), queued()), (1, 0));
    let _ = cancel(id);
    assert_eq!((held.get(), alive()), (0, 0));
}

#[test]
fn cancel_drops_a_suspended_future() {
    let held = Rc::new(Cell::new(0));
    let (id, waker) = parked(0, &held);
    let _ = cancel(id);
    assert_eq!((held.get(), alive()), (0, 0));
    let _ = cancel(id);
    waker.take().unwrap().wake();
    assert_eq!(queued(), 0, "its `Waker`s do nothing now");
}

#[test]
fn cancel_while_queued_leaves_an_entry_that_finds_nothing() {
    let held = Rc::new(Cell::new(0));
    let (id, waker) = parked(0, &held);
    waker.take().unwrap().wake();
    assert_eq!(queued(), 1);
    let _ = cancel(id);
    assert_eq!(held.get(), 0);
    assert_eq!(run_one(), None);
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn cancel_from_inside_its_own_poll_waits_for_the_poll() {
    let held = Rc::new(Cell::new(0));
    let own_id = Rc::new(Cell::new(None));
    let id = spawn({
        let (guard, held, own_id) = (Held::new(&held), Rc::clone(&held), Rc::clone(&own_id));
        async move {
            let _guard = guard;
            assert_eq!(running(), own_id.get());
            assert!(!cancel(own_id.get().unwrap()), "not yet");
            let all = LOOP.with(|event_loop| event_loop.tasks.cancel_where(|_| true));
            assert_eq!(
                all, 0,
                "whoever repeats this until nothing is dropped comes to an end"
            );
            assert_eq!(held.get(), 1);
            park(WakerCell::default()).await;
            unreachable!()
        }
    });
    own_id.set(Some(id));
    assert_eq!(run(id), None);
    assert_eq!((held.get(), alive(), queued()), (0, 0, 0));
}

#[test]
fn cancel_where_picks_by_scheduler() {
    let held = Rc::new(Cell::new(0));
    let _first = parked(1, &held);
    let (second, _waker) = parked(2, &held);
    let _third = parked(1, &held);
    let any = |scope| LOOP.with(|event_loop| event_loop.tasks.any(|on| on.scope == scope));
    assert!(any(1) && any(2) && !any(3));
    let dropped = LOOP.with(|event_loop| event_loop.tasks.cancel_where(|on| on.scope == 1));
    assert_eq!((dropped, held.get(), alive()), (2, 1, 1));
    assert!(!any(1) && any(2));
    let _ = cancel(second);
    assert_eq!((held.get(), alive()), (0, 0));
}

#[test]
fn a_closed_table_drops_what_it_has_and_what_it_is_given() {
    #[derive(Clone, Copy)]
    struct Nowhere;
    impl Schedule for Nowhere {
        type Output = ();
        fn with_tasks<R>(_: impl FnOnce(&Tasks<Self>) -> R) -> Option<R> {
            None
        }
        fn schedule(self, _: TaskId) {}
    }
    let held = Rc::new(Cell::new(0));
    let holds = |held: Held| async move {
        let _held = held;
        core::future::pending().await
    };
    let tasks = Tasks::new();
    tasks.spawn(holds(Held::new(&held)), Nowhere).unwrap();
    assert_eq!(held.get(), 1);
    tasks.close();
    assert_eq!((held.get(), tasks.len()), (0, 0));
    let refused = tasks.spawn(holds(Held::new(&held)), Nowhere);
    assert_eq!(refused, Err(Refused::Closed));
    assert_eq!(held.get(), 0);
}

#[test]
fn a_task_whose_last_waker_is_dropped_is_dropped_by_its_loop() {
    let held = Rc::new(Cell::new(0));
    let (_, waker) = parked(0, &held);
    let second = waker.take().unwrap();
    drop(second.clone());
    assert_eq!(queued(), 0);
    drop(second);
    assert_eq!((held.get(), queued()), (1, 1), "not beneath the drop");
    assert_eq!(run_one(), None);
    assert_eq!((held.get(), alive(), queued()), (0, 0, 0));
}

#[test]
fn a_task_that_suspends_with_no_waker_anywhere_is_dropped_at_once() {
    let held = Rc::new(Cell::new(0));
    let id = spawn({
        let held = Held::new(&held);
        async move {
            let _held = held;
            core::future::pending().await
        }
    });
    assert_eq!(run(id), None);
    assert_eq!((held.get(), alive(), queued()), (0, 0, 0));
}

#[test]
fn an_abandoned_slot_lets_go_of_the_task() {
    let held = Rc::new(Cell::new(0));
    let slot = Rc::new(Slot::<u32>::new());
    let id = spawn({
        let (held, slot) = (Held::new(&held), Rc::clone(&slot));
        async move {
            let _held = held;
            poll_fn(|cx| slot.poll_take(cx)).await
        }
    });
    assert_eq!(run(id), None);
    slot.abandon();
    assert_eq!(run_one(), None);
    assert_eq!((held.get(), alive()), (0, 0));
}

#[test]
fn a_wake_during_the_poll_queues_it_again() {
    let polls = Rc::new(Cell::new(0));
    let id = spawn({
        let polls = Rc::clone(&polls);
        async move {
            poll_fn(|cx| {
                polls.set(polls.get() + 1);
                if polls.get() == 3 {
                    return Poll::Ready(3);
                }
                cx.waker().wake_by_ref();
                cx.waker().wake_by_ref();
                Poll::Pending
            })
            .await
        }
    });
    assert_eq!(run(id), None);
    assert_eq!(queued(), 1);
    assert_eq!(run_one(), None);
    assert_eq!(run_one(), Some(3));
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn a_tick_of_the_loop_inside_the_poll_does_not_poll_it_twice() {
    let depth = Rc::new(Cell::new(0));
    let id = spawn({
        let depth = Rc::clone(&depth);
        async move {
            let mut polls = 0;
            poll_fn(|cx| {
                assert_eq!(depth.replace(1), 0, "polled inside its own poll");
                polls += 1;
                if polls == 1 {
                    cx.waker().wake_by_ref();
                    assert_eq!(run_one(), None);
                }
                depth.set(0);
                if polls == 2 {
                    Poll::Ready(polls)
                } else {
                    Poll::Pending
                }
            })
            .await
        }
    });
    assert_eq!(run(id), None);
    assert_eq!(queued(), 1, "the nested run is made up for");
    assert_eq!(run_one(), Some(2));
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn a_waker_does_not_reach_the_task_that_took_its_place() {
    let held = Rc::new(Cell::new(0));
    let (first, waker) = parked(0, &held);
    let stale = waker.take().unwrap();
    let _ = cancel(first);
    let (second, _waker) = parked(0, &held);
    assert_ne!(first, second);
    stale.wake_by_ref();
    drop(stale.clone());
    drop(stale);
    assert_eq!((held.get(), queued()), (1, 0));
    let _ = cancel(second);
    assert_eq!((held.get(), alive()), (0, 0));
}

#[test]
fn a_future_may_use_the_table_while_it_is_polled_and_while_it_is_dropped() {
    struct OnDrop<F: FnMut()>(F);
    impl<F: FnMut()> Drop for OnDrop<F> {
        fn drop(&mut self) {
            (self.0)();
        }
    }
    let held = Rc::new(Cell::new(0));
    let (other, other_waker) = parked(0, &held);
    let (third, _third_waker) = parked(0, &held);
    let id = spawn({
        let held = Rc::clone(&held);
        async move {
            // Grows the table under the poll.
            let spawned: Vec<_> = (0..64).map(|_| parked(0, &held)).collect();
            let _on_drop = OnDrop(move || {
                other_waker.take().unwrap().wake();
                let _ = cancel(third);
                spawned.iter().for_each(|(id, _)| _ = cancel(*id));
                assert_eq!(run(spawn(async { 1 })), Some(1));
            });
            core::future::pending().await
        }
    });
    assert_eq!(run(id), None, "nothing holds its `Waker`, so it is dropped");
    assert_eq!((held.get(), alive(), queued()), (1, 1, 1));
    let _ = cancel(other);
    assert_eq!(run_one(), None);
    assert_eq!((held.get(), alive(), queued()), (0, 0, 0));
}

#[test]
fn a_task_can_be_run_without_the_queue() {
    let slot = Rc::new(Slot::new());
    let id = spawn({
        let slot = Rc::clone(&slot);
        async move {
            let first: u32 = poll_fn(|cx| slot.poll_take(cx)).await;
            first + poll_fn(|cx| slot.poll_take(cx)).await
        }
    });
    assert_eq!(run(id), None);
    assert_eq!(running(), None);
    let waker = slot.fill_quietly(1).unwrap();
    assert_eq!(run(id), None);
    drop(waker);
    assert_eq!(
        queued(),
        0,
        "it waits for the slot again, so it is no orphan"
    );
    // Queued and run at once: the entry left behind finds nothing.
    slot.fill(2);
    assert_eq!(run(id), Some(3));
    assert_eq!(run_one(), None);
    assert_eq!((alive(), queued()), (0, 0));
}

#[test]
fn the_loser_of_a_race_is_dropped() {
    let held = Rc::new(Cell::new(0));
    let slot = Rc::new(Slot::new());
    let id = spawn({
        let (held, slot) = (Held::new(&held), Rc::clone(&slot));
        async move {
            let never = async move {
                let _held = held;
                core::future::pending::<u32>().await
            };
            match race(never, poll_fn(|cx| slot.poll_take(cx))).await {
                Either::Left(_) => unreachable!(),
                Either::Right(value) => value,
            }
        }
    });
    assert_eq!(run(id), None);
    slot.fill(3);
    assert_eq!(run_one(), Some(3));
    assert_eq!((held.get(), alive(), queued()), (0, 0, 0));
}
