//! A semaphore on top of Bun's `Mutex` + `Condition`: an unsigned integer
//! that blocks the calling thread when it would go negative.
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
// SAFETY: `Mutex`, `Condition`, and `UnsafeCell<usize>` are all `Send`; the
// semaphore holds no thread-affine state.
unsafe impl Send for Semaphore {}

impl Default for Semaphore {
    fn default() -> Self {
        Self::new()
    }
}

impl Semaphore {
    /// Const-init with zero permits.
    pub const fn new() -> Self {
        Self::with_permits(0)
    }

    /// Const-init with `permits` available.
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
        scopeguard::defer! { self.mutex.unlock(); }

        // SAFETY: `mutex` is held for every access to `permits` below.
        while unsafe { *self.permits.get() } == 0 {
            self.cond.wait(&self.mutex);
        }

        // SAFETY: `mutex` is still held (released only by the scopeguard on return).
        unsafe { *self.permits.get() -= 1 };
        // SAFETY: `mutex` is still held; this is the sole accessor of `permits`.
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
