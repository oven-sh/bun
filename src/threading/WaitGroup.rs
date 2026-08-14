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

    /// Counts one task as done. Only for a group that something other than
    /// [`wait`](Self::wait) keeps alive past this call (`ThreadPool` joins its
    /// workers before it is dropped; the install queue on Windows is a
    /// `static`): `&self` asserts the group's storage until this returns, and
    /// a `wait()` this call releases may return before then. When `wait()`
    /// returning is what lets the owner free the group, use
    /// [`finish_raw`](Self::finish_raw).
    pub fn finish(&self) {
        // SAFETY: the group outlives this call (fn contract).
        unsafe { Self::finish_raw(self) }
    }

    /// [`finish`](Self::finish) for a group whose owner may free it as soon as
    /// `wait()` returns (`LinkerContext`'s source-map groups: the waiter frees
    /// the tasks' storage on the line after `wait()`). `wait()` can return once
    /// the count is published as 0 and the mutex is released, so this thread's
    /// last access to the group is the store that releases the mutex; no frame
    /// between here and that store holds a reference into the group.
    ///
    /// # Safety
    /// `this` must point to a live `WaitGroup` whose count includes the task
    /// being finished. Once this lets a `wait()` return, the owner may free it.
    pub unsafe fn finish_raw(this: *const Self) {
        // Fast path: decrement lock-free while there are other outstanding
        // tasks. We cannot unconditionally `fetch_sub(1)` and then lock/signal
        // for the last one: the moment `raw_count` reaches 0 a concurrent
        // `wait()` can observe it, return, and the owner free the group, so any
        // later `mutex`/`cond` access would be a use-after-free.
        //
        // SAFETY: the group is live until a finisher publishes 0 (fn contract);
        // an exchange here leaves the count at >= 1, so that finisher is a later
        // call and this one is done with `*this` once the exchange lands.
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

        // We are (or a concurrent `add` may yet make us not) the last one.
        // Publish `raw_count == 0` only while holding the mutex so `wait()`,
        // which checks the count under the same mutex, cannot return until the
        // unlock below. Signal before unlocking so the waiter's reacquire
        // serializes after every access we make.
        //
        // SAFETY: `wait()` cannot return, so the group is live (fn contract),
        // until the unlock releases the mutex; `unlock_raw` makes that release
        // the last access to `*this`, where `(*this).mutex.unlock()` would hold
        // `&Mutex` past it.
        unsafe {
            (*this).mutex.lock();
            let old_count = (*this).raw_count.fetch_sub(1, Ordering::AcqRel);
            debug_assert!(old_count >= 1);
            (*this).cond.signal();
            Mutex::unlock_raw(&raw const (*this).mutex);
        }
    }

    /// Blocks until the count reaches 0. Once this returns, every
    /// [`finish_raw`](Self::finish_raw) that contributed to that is done with
    /// the group, so the caller may free it.
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

    // `wait()` returning lets the owner free the group (see `finish_raw`), so
    // `finish_raw()` must neither touch nor hold a reference into the group
    // once it has let `wait()` return. Under Miri (`bun run rust:miri`) the
    // `Box` drop is rejected whenever a frame of the finishing thread still
    // holds a reference into the group; natively it is a use-after-free race.
    #[test]
    fn wait_returning_means_finish_raw_is_done_with_the_group() {
        // Miri takes ~30ms per iteration and its scheduler produces the
        // offending interleaving about once per 60 iterations (12 seeds: worst
        // case 200), so 500 keeps the run short without losing the failure.
        #[cfg(miri)]
        const ITERATIONS: usize = 500;
        #[cfg(not(miri))]
        const ITERATIONS: usize = 10_000;

        for _ in 0..ITERATIONS {
            let wg = Box::into_raw(Box::new(WaitGroup::init_with_count(1)));
            struct SendPtr(*const WaitGroup);
            // SAFETY: `WaitGroup` is `Sync`; the pointer is only used under
            // `finish_raw`'s contract, which the `wait()` below upholds.
            unsafe impl Send for SendPtr {}
            let p = SendPtr(wg);
            let t = std::thread::Builder::new()
                .spawn(move || {
                    let p = p;
                    // SAFETY: `wg` stays live until `wait()` returns on the main
                    // thread, and this call is what lets it return (fn contract).
                    unsafe { WaitGroup::finish_raw(p.0) };
                })
                .unwrap();
            // SAFETY: `wg` is the freshly-boxed allocation and this is its sole
            // owner; `wait()` returning means `finish_raw` is done with it.
            unsafe {
                (*wg).wait();
                drop(Box::from_raw(wg));
            }
            t.join().unwrap();
        }
    }
}
