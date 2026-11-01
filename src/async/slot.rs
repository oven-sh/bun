//! How a callback hands its result to the future that waits for it, when both
//! run on the loop's thread: a timer firing, a child exiting, a pipe reaching
//! EOF, a promise reaction.

use core::cell::Cell;
use core::task::{Context, Poll, Waker};

/// Room for one value, and the `Waker` of whoever is waiting for it. Embed it
/// in whatever the callback already gets a pointer to.
pub struct Slot<T> {
    value: Cell<Option<T>>,
    waker: Cell<Option<Waker>>,
}

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Slot<T> {
    pub const fn new() -> Self {
        Self {
            value: Cell::new(None),
            waker: Cell::new(None),
        }
    }

    /// The callback's side. Replaces a value nobody took.
    pub fn fill(&self, value: T) {
        self.value.set(Some(value));
        if let Some(waker) = self.waker.take() {
            waker.wake();
        }
    }

    /// The future's side.
    pub fn poll_take(&self, cx: &Context<'_>) -> Poll<T> {
        if let Some(value) = self.value.take() {
            self.waker.set(None);
            return Poll::Ready(value);
        }
        let waker = match self.waker.take() {
            Some(waker) if waker.will_wake(cx.waker()) => waker,
            _ => cx.waker().clone(),
        };
        self.waker.set(Some(waker));
        Poll::Pending
    }

    /// Nobody waits any more. With it goes the task's reference, so a task that
    /// waited for nothing else is dropped by its loop. Touches no other state:
    /// safe where a garbage collector's finalizer is.
    pub fn abandon(&self) {
        self.waker.set(None);
    }
}
