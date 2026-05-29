//! Port of `std.Thread.ResetEvent` (Zig 0.14.1) on top of Bun's `Futex`.
//!
//! A `ResetEvent` is a thread-safe bool that threads can block on until it
//! becomes "set". Statically initializable, at most `size_of::<u32>()` of
//! state. Replaces the hand-rolled `Mutex<bool> + Condvar` shim in
//! `BundleThread.rs`.
//!
//! Only the multi-threaded `FutexImpl` is ported — Bun never builds
//! single-threaded.

use core::sync::atomic::{AtomicU32, Ordering};

use crate::Futex;
use crate::futex::TimeoutError;

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
    /// Const-init in the unset state (Zig: `.{}`).
    pub const fn new() -> Self {
        Self {
            state: AtomicU32::new(UNSET),
        }
    }

    /// Returns whether [`set`](Self::set) has been called (and not since
    /// [`reset`](Self::reset)). Memory accesses before `set()` happen-before
    /// this returning `true`.
    #[inline]
    pub fn is_set(&self) -> bool {
        // Acquire barrier ensures memory accesses before set() happen before we return true.
        self.state.load(Ordering::Acquire) == IS_SET
    }

    /// Blocks the calling thread until [`set`](Self::set) is called.
    /// Effectively an efficient `while !is_set() {}`.
    pub fn wait(&self) {
        match self.wait_inner(None) {
            Ok(()) => {}
            Err(TimeoutError::Timeout) => unreachable!(), // no timeout provided so we shouldn't have timed-out
        }
    }

    /// [`wait`](Self::wait) with a timeout in nanoseconds. Returns
    /// `Err(Timeout)` if the event was not set in time.
    pub fn timed_wait(&self, timeout_ns: u64) -> Result<(), TimeoutError> {
        self.wait_inner(Some(timeout_ns))
    }

    #[inline]
    fn wait_inner(&self, timeout: Option<u64>) -> Result<(), TimeoutError> {
        // Outline the slow path to allow is_set() to be inlined.
        if !self.is_set() {
            return self.wait_until_set(timeout);
        }
        Ok(())
    }

    #[cold]
    fn wait_until_set(&self, timeout: Option<u64>) -> Result<(), TimeoutError> {
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
        if state == WAITING {
            let mut futex_deadline = Futex::Deadline::init(timeout);
            loop {
                let wait_result = futex_deadline.wait(&self.state, WAITING);

                // Check if the ResetEvent was set before possibly reporting Timeout below.
                state = self.state.load(Ordering::Acquire);
                if state != WAITING {
                    break;
                }

                wait_result?;
            }
        }

        debug_assert!(state == IS_SET);
        Ok(())
    }

    /// Marks the event "set" and wakes all threads blocked in
    /// [`wait`](Self::wait) / [`timed_wait`](Self::timed_wait). Idempotent
    /// until [`reset`](Self::reset).
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

    /// Unmarks the event from its "set" state. Undefined behavior if called
    /// while threads are blocked in `wait()`/`timed_wait()`. Concurrent
    /// `set()`/`is_set()`/`reset()` calls are allowed.
    pub fn reset(&self) {
        self.state.store(UNSET, Ordering::Relaxed);
    }
}

// ported from: vendor/zig/lib/std/Thread/ResetEvent.zig (FutexImpl)
