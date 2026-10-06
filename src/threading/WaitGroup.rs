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

    pub(crate) fn add(&self, n: usize) {
        // Not Acquire because we don't need to synchronize with other tasks (each runs independently).
        // Not Release because there are no side effects that other threads depend on when they see
        // the *start* of a task (only finishing a task has such requirements).
        let _ = self.raw_count.fetch_add(n, Ordering::Relaxed);
    }

    pub fn add_one(&self) {
        self.add(1);
    }

    /// For a group kept alive past this call by something other than `wait()` returning (a
    /// `static`, say); otherwise use [`finish_raw`](Self::finish_raw).
    pub fn finish(&self) {
        // SAFETY: the group outlives this call (fn contract).
        unsafe { Self::finish_raw(self) }
    }

    /// [`finish`](Self::finish) for a group the owner may free as soon as `wait()` returns:
    /// the unlock's releasing store is this thread's last access to the group, which a
    /// `&self` argument would instead assert until the call returned.
    ///
    /// # Safety
    /// `this` must be live with this task counted; once this lets `wait()` return, the
    /// owner may free it.
    pub unsafe fn finish_raw(this: *const Self) {
        // Fast path: decrement lock-free while other tasks are outstanding. We cannot
        // unconditionally `fetch_sub(1)` and then lock/signal for the last one: the moment
        // `raw_count` reaches 0 a concurrent `wait()` can return and the owner free the group.
        //
        // SAFETY: live until some finisher publishes 0 (fn contract); this path leaves >= 1.
        unsafe {
            let mut old = (*this).raw_count.load(Ordering::Relaxed);
            while old > 1 {
                match (*this).raw_count.compare_exchange_weak(
                    old,
                    old - 1,
                    Ordering::AcqRel,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => return,
                    Err(cur) => old = cur,
                }
            }
        }

        // We are (or a concurrent `add` may yet make us not) the last one. Publish
        // `raw_count == 0` only while holding the mutex so `wait()`, which checks the count
        // under the same mutex, cannot return until the unlock below; signal before unlocking.
        //
        // SAFETY: hence live until that unlock (fn contract), whose store is the last access.
        unsafe {
            (*this).mutex.lock();
            let old_count = (*this).raw_count.fetch_sub(1, Ordering::AcqRel);
            debug_assert!(old_count >= 1);
            (*this).cond.signal();
            Mutex::unlock_raw(&raw const (*this).mutex);
        }
    }

    /// Once this returns every [`finish_raw`](Self::finish_raw) is done; the group may be freed.
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

    // Miri rejects the `Box` drop if the finisher still holds a reference into the group.
    #[test]
    fn wait_returning_means_finish_raw_is_done_with_the_group() {
        // ~30ms per iteration under Miri; the unfixed shape fails within 200 on every seed tried.
        #[cfg(miri)]
        const ITERATIONS: usize = 500;
        #[cfg(not(miri))]
        const ITERATIONS: usize = 10_000;

        for _ in 0..ITERATIONS {
            let wg = Box::into_raw(Box::new(WaitGroup::init_with_count(1)));
            struct SendPtr(*const WaitGroup);
            // SAFETY: `WaitGroup` is `Sync`; only dereferenced via `finish_raw` below.
            unsafe impl Send for SendPtr {}
            let p = SendPtr(wg);
            let t = std::thread::Builder::new()
                .spawn(move || {
                    let p = p;
                    // SAFETY: `wg` is live until `wait()` returns, which this call permits.
                    unsafe { WaitGroup::finish_raw(p.0) };
                })
                .unwrap();
            // SAFETY: sole owner of `wg`; `wait()` returning means `finish_raw` is done with it.
            unsafe {
                (*wg).wait();
                drop(Box::from_raw(wg));
            }
            t.join().unwrap();
        }
    }
}
