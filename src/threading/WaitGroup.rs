// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync-zig
//
// That code contains the following license and copyright notice:
//   SPDX-License-Identifier: MIT
//   Copyright (c) 2015-2020 Zig Contributors
//   This file is part of [zig](https://ziglang.org/), which is MIT licensed.
//   The MIT license requires this copyright notice to be included in all copies
//   and substantial portions of the software.

use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{Condition, Mutex};

#[derive(Default)]
pub struct WaitGroup {
    raw_count: AtomicUsize,
    mutex: Mutex,
    cond: Condition,
}

impl WaitGroup {
    pub fn init() -> Self {
        Self::default()
    }

    pub fn init_with_count(count: usize) -> Self {
        Self {
            raw_count: AtomicUsize::new(count),
            ..Self::default()
        }
    }

    pub fn add_unsynchronized(&mut self, n: usize) {
        *self.raw_count.get_mut() += n;
    }

    pub fn add(&self, n: usize) {
        // Not Acquire because we don't need to synchronize with other tasks (each runs independently).
        // Not Release because there are no side effects that other threads depend on when they see
        // the *start* of a task (only finishing a task has such requirements).
        let _ = self.raw_count.fetch_add(n, Ordering::Relaxed);
    }

    pub fn add_one(&self) {
        self.add(1);
    }

    pub fn finish(&self) {
        let old_count = self.raw_count.fetch_sub(1, Ordering::AcqRel);
        if old_count > 1 {
            return;
        }

        // This is the last task, so we need to signal the condition. If we were to call `cond.signal`
        // right now, a concurrent call to `wait` which has read a non-zero count (from before we
        // decremented it above) but which has not yet called `cond.wait` will miss the signal and
        // end up blocking forever. A thread in this state (in between reading the count and calling
        // `cond.wait`) is necessarily holding the mutex, so by locking and unlocking the mutex here,
        // we ensure that it reaches the call to `cond.wait` before we call `cond.signal`.
        self.mutex.lock();
        self.mutex.unlock();
        self.cond.signal();
    }

    pub fn wait(&self) {
        self.mutex.lock();
        // PORT NOTE: Zig `defer self.mutex.unlock()`. crate::Mutex is a raw lock/unlock
        // wrapper (no RAII guard), so unlock is called explicitly at scope exit below.

        while self.raw_count.load(Ordering::Acquire) > 0 {
            self.cond.wait(&self.mutex);
        }

        self.mutex.unlock();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/WaitGroup.zig (67 lines)
//   confidence: high
//   todos:      0
//   notes:      assumes crate::Mutex/Condition expose lock()/unlock()/signal()/wait(&Mutex) and impl Default
// ──────────────────────────────────────────────────────────────────────────
