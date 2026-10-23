//! A semaphore on top of Bun's `Mutex` + `Condition`: an unsigned integer
//! that blocks the calling thread when it would go negative.
//!
//! Supports `const fn new()` static initialization and needs no `deinit`.
//! Only the subset Bun uses is ported (`wait`/`post`); `timedWait` is omitted
//! because no Rust caller needs it and it would pull in a monotonic timer.

use crate::{Condition, Guarded};

pub struct Semaphore {
    permits: Guarded<usize>,
    cond: Condition,
}

impl Default for Semaphore {
    fn default() -> Self {
        Self::new()
    }
}

impl Semaphore {
    /// Const-init with zero permits.
    pub(crate) const fn new() -> Self {
        Self {
            permits: Guarded::new(0),
            cond: Condition::new(),
        }
    }

    /// Blocks until a permit is available, then consumes one.
    pub fn wait(&self) {
        let mut permits = self.permits.lock();

        while *permits == 0 {
            self.cond.wait_guarded(&mut permits);
        }

        *permits -= 1;
        if *permits > 0 {
            self.cond.signal();
        }
    }

    /// Adds one permit and wakes one waiter.
    pub fn post(&self) {
        let mut permits = self.permits.lock();

        *permits += 1;
        self.cond.signal();
    }
}
