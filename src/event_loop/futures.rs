//! `async`/`.await` on a thread whose loop is a [`MiniEventLoop`](crate::MiniEventLoop). See
//! `src/async/README.md`. (A JS thread's futures are its VM's: `bun_jsc::future`.)
//!
//! They belong to the thread, as the uSockets loop that every `MiniEventLoop` of a thread ticks does.

use core::cell::RefCell;
use core::future::Future;
use core::mem::ManuallyDrop;
use std::collections::VecDeque;

use bun_async::{Schedule, TaskId, Tasks};

struct ThreadFutures {
    tasks: Tasks<OnMiniLoop>,
    woken: RefCell<VecDeque<TaskId>>,
}

thread_local! {
    // Never dropped, as the thread's loop is not: what is still running when the thread ends is left as it is.
    static FUTURES: ManuallyDrop<ThreadFutures> = ManuallyDrop::new(ThreadFutures {
        tasks: Tasks::new(),
        woken: RefCell::new(VecDeque::new()),
    });
}

#[derive(Clone, Copy)]
pub struct OnMiniLoop;

impl Schedule for OnMiniLoop {
    type Output = ();

    fn with_tasks<R>(f: impl FnOnce(&Tasks<Self>) -> R) -> Option<R> {
        Some(FUTURES.with(|futures| f(&futures.tasks)))
    }

    fn schedule(self, id: TaskId) {
        FUTURES.with(|futures| futures.woken.borrow_mut().push_back(id));
    }
}

/// Start `future` now, on this thread: it runs up to its first `.await` before this returns. From
/// then on this thread's `MiniEventLoop` polls it, whenever it is ticked.
pub fn spawn(future: impl Future<Output = ()> + 'static) {
    FUTURES.with(|futures| {
        // Never closed, so this is `Refused::Full`.
        let id = futures.tasks.spawn(future, OnMiniLoop);
        futures
            .tasks
            .run(id.unwrap_or_else(|_| bun_core::out_of_memory()));
    });
}

pub(crate) fn any_woken() -> bool {
    FUTURES.with(|futures| !futures.woken.borrow().is_empty())
}

/// Poll what was woken before this call. What those polls wake is for the next call.
pub(crate) fn run_woken() {
    FUTURES.with(|futures| {
        let woken = futures.woken.borrow().len();
        for _ in 0..woken {
            let Some(id) = futures.woken.borrow_mut().pop_front() else {
                return;
            };
            futures.tasks.run(id);
        }
    });
}
