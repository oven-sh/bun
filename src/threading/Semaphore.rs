//! Port of `std.Thread.Semaphore` (Zig 0.14.1) on top of Bun's `Mutex` +
//! `Condition`. A semaphore is an unsigned integer that blocks the calling
//! thread when it would go negative.
//!
//! Supports `const fn new()` static initialization and needs no `deinit`.
//! Only the subset Bun uses is ported (`wait`/`post`); `timedWait` is omitted
//! because no Rust caller needs it and it would pull in a monotonic timer.

use core::cell::UnsafeCell;

use crate::{Condition, Mutex};

pub struct Semaphore {
    mutex: Mutex,
    cond: Condition,
    /// Guarded by `mutex`. `UnsafeCell` because `wait`/`post` take `&self`.
    permits: UnsafeCell<usize>,
}

// SAFETY: `permits` is only read/written while `mutex` is held; `Mutex` and
// `Condition` are themselves `Sync`/`Send`.
unsafe impl Sync for Semaphore {}
unsafe impl Send for Semaphore {}

impl Default for Semaphore {
    fn default() -> Self {
        Self::new()
    }
}

impl Semaphore {
    /// Const-init with zero permits (Zig: `.{}`).
    pub const fn new() -> Self {
        Self::with_permits(0)
    }

    /// Const-init with `permits` available (Zig: `.{ .permits = n }`).
    pub const fn with_permits(permits: usize) -> Self {
        Self {
            mutex: Mutex::new(),
            cond: Condition::new(),
            permits: UnsafeCell::new(permits),
        }
    }

    /// Blocks until a permit is available, then consumes one.
    pub fn wait(&self) {
        self.mutex.lock();
        // Zig: `defer sem.mutex.unlock()`
        scopeguard::defer! { self.mutex.unlock(); }

        // SAFETY: `mutex` is held for every access to `permits` below.
        while unsafe { *self.permits.get() } == 0 {
            self.cond.wait(&self.mutex);
        }

        unsafe { *self.permits.get() -= 1 };
        if unsafe { *self.permits.get() } > 0 {
            self.cond.signal();
        }
    }

    /// Adds one permit and wakes one waiter.
    pub fn post(&self) {
        self.mutex.lock();
        scopeguard::defer! { self.mutex.unlock(); }

        // SAFETY: `mutex` is held.
        unsafe { *self.permits.get() += 1 };
        self.cond.signal();
    }
}

// ported from: vendor/zig/lib/std/Thread/Semaphore.zig
