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
        // Fast path: decrement lock-free while there are other outstanding
        // tasks. We cannot unconditionally `fetch_sub(1)` and then lock/signal
        // for the last one: the moment `raw_count` reaches 0 a concurrent
        // `wait()` can observe it, return, and the caller drop the `WaitGroup`,
        // so any later `self.mutex`/`self.cond` access is a use-after-free.
        let mut old = self.raw_count.load(Ordering::Relaxed);
        while old > 1 {
            match self.raw_count.compare_exchange_weak(
                old,
                old - 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(cur) => old = cur,
            }
        }

        // We are (or a concurrent `add` may yet make us not) the last one.
        // Publish `raw_count == 0` only while holding the mutex so `wait()`,
        // which checks the count under the same mutex, cannot return until our
        // `unlock()` below. Broadcast before unlocking so every waiter's
        // reacquire serializes after every `self` access we make. `broadcast`
        // (not `signal`): when several threads share one `WaitGroup`
        // (`ThreadPool::wait_for_all` from concurrent bundler threads), the
        // 1→0 transition happens exactly once and must release all of them.
        // Multiple waiters require the `WaitGroup` to outlive every `wait()`.
        self.mutex.lock();
        let old_count = self.raw_count.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(old_count >= 1);
        self.cond.broadcast();
        self.mutex.unlock();
    }

    pub fn wait(&self) {
        self.mutex.lock();
        // crate::Mutex is a raw lock/unlock wrapper (no RAII guard), so unlock
        // is called explicitly at scope exit below.

        while self.raw_count.load(Ordering::Acquire) > 0 {
            self.cond.wait(&self.mutex);
        }

        self.mutex.unlock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // After `wait()` returns the caller may drop the `WaitGroup`; `finish()`
    // must therefore not touch `self` once it has published `raw_count == 0`.
    #[test]
    fn wait_returning_means_finish_is_done_with_self() {
        for _ in 0..10_000 {
            let wg = Box::into_raw(Box::new(WaitGroup::init_with_count(1)));
            struct SendPtr(*mut WaitGroup);
            // SAFETY: `WaitGroup` is `Sync`; the raw pointer is only ever
            // dereferenced while the pointee is live (joined below).
            unsafe impl Send for SendPtr {}
            let p = SendPtr(wg);
            let t = std::thread::spawn(move || {
                let p = p;
                // SAFETY: `wg` is live until `drop(Box::from_raw(..))` below,
                // which happens-before `join()`, so the pointee outlives this
                // deref iff `finish()` is done with `self` by the time
                // `wait()` returns — the property under test.
                unsafe { (*p.0).finish() };
            });
            // SAFETY: `wg` is the freshly-boxed allocation; sole owner here.
            unsafe {
                (*wg).wait();
                drop(Box::from_raw(wg));
            }
            t.join().unwrap();
        }
    }
}
