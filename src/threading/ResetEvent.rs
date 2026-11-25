//! A `ResetEvent` is a thread-safe bool that threads can block on until it
//! becomes "set". Statically initializable, at most `size_of::<u32>()` of
//! state.
//!
//! Only the multi-threaded `FutexImpl` is ported — Bun never builds
//! single-threaded.

use core::sync::atomic::{AtomicU32, Ordering};

use crate::Futex;

pub struct ResetEvent {
    state: AtomicU32,
}

impl Default for ResetEvent {
    fn default() -> Self {
        Self::new()
    }
}

const UNSET: u32 = 0;
const WAITING: u32 = 1;
const IS_SET: u32 = 2;

impl ResetEvent {
    /// Const-init in the unset state.
    pub(crate) const fn new() -> Self {
        Self {
            state: AtomicU32::new(UNSET),
        }
    }

    /// Returns whether [`set`](Self::set) has been called. Memory accesses
    /// before `set()` happen-before this returning `true`.
    #[inline]
    pub(crate) fn is_set(&self) -> bool {
        // Acquire barrier ensures memory accesses before set() happen before we return true.
        self.state.load(Ordering::Acquire) == IS_SET
    }

    /// Blocks the calling thread until [`set`](Self::set) is called.
    /// Effectively an efficient `while !is_set() {}`.
    pub fn wait(&self) {
        // Outline the slow path to allow is_set() to be inlined.
        if !self.is_set() {
            self.wait_until_set();
        }
    }

    #[cold]
    fn wait_until_set(&self) {
        // Try to set the state from `UNSET` to `WAITING` to indicate to set()
        // that threads are blocked. Avoid strict barriers until we know the
        // event is actually set.
        let mut state = self.state.load(Ordering::Acquire);
        if state == UNSET {
            state = match self.state.compare_exchange(
                state,
                WAITING,
                Ordering::Acquire,
                Ordering::Acquire,
            ) {
                Ok(_) => WAITING,
                Err(s) => s,
            };
        }

        // Wait until the ResetEvent is set since the state is WAITING.
        while state == WAITING {
            Futex::wait_forever(&self.state, WAITING);
            state = self.state.load(Ordering::Acquire);
        }

        debug_assert!(state == IS_SET);
    }

    /// Marks the event "set" and wakes all threads blocked in
    /// [`wait`](Self::wait).
    pub fn set(&self) {
        // Quick check if already set before the atomic swap below — set() may
        // be called often and multiple swap()s increase contention.
        if self.state.load(Ordering::Relaxed) == IS_SET {
            return;
        }

        // Mark set and unblock all waiters. Release barrier ensures memory
        // accesses before set() happen-before the event is observed as set.
        if self.state.swap(IS_SET, Ordering::Release) == WAITING {
            Futex::wake(&self.state, u32::MAX);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_returns_once_it_is_set() {
        let event = ResetEvent::new();
        std::thread::scope(|scope| {
            for _ in 0..3 {
                scope.spawn(|| {
                    event.wait();
                    assert!(event.is_set());
                });
            }
            while event.state.load(Ordering::Relaxed) != WAITING {
                std::thread::yield_now();
            }
            event.set();
        });
    }
}
