//! A semaphore on top of Bun's `Mutex` + `Condition`: an unsigned integer
//! that blocks the calling thread when it would go negative.
//!
//! Supports `const fn new()` static initialization and needs no `deinit`.
//! Only the subset Bun uses is ported (`wait`/`post`); `timedWait` is omitted
//! because no Rust caller needs it and it would pull in a monotonic timer.

use crate::{Condition, Guarded};

pub struct Semaphore {
    cond: Condition,
    permits: Guarded<usize>,
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
            cond: Condition::new(),
            permits: Guarded::new(0),
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    /// How long a thread that must wake may take. Only a failing run waits this long.
    const DEADLINE: Duration = Duration::from_secs(60);

    fn permits(semaphore: &Semaphore) -> usize {
        *semaphore.permits.lock()
    }

    #[test]
    fn post_adds_a_permit_and_wait_takes_one() {
        let semaphore = Semaphore::new();
        semaphore.post();
        semaphore.post();
        assert_eq!(permits(&semaphore), 2);
        semaphore.wait();
        assert_eq!(permits(&semaphore), 1);
        semaphore.wait();
        assert_eq!(permits(&semaphore), 0);
    }

    // The threads are not scoped: one that a lost wake-up leaves blocked must not keep the test from failing.
    #[test]
    fn each_post_lets_one_waiter_return() {
        const WAITERS: usize = 8;
        static SEMAPHORE: Semaphore = Semaphore::new();
        static STARTED: AtomicUsize = AtomicUsize::new(0);

        let (returned, returns) = mpsc::channel();
        let waiters: Vec<_> = (0..WAITERS)
            .map(|_| {
                let returned = returned.clone();
                thread::Builder::new()
                    .spawn(move || {
                        STARTED.fetch_add(1, Ordering::SeqCst);
                        SEMAPHORE.wait();
                        returned.send(()).unwrap();
                    })
                    .unwrap()
            })
            .collect();
        while STARTED.load(Ordering::SeqCst) < WAITERS {
            thread::yield_now();
        }
        assert!(
            returns.try_recv().is_err(),
            "a waiter returned with no permit"
        );

        for post in 1..=WAITERS {
            SEMAPHORE.post();
            assert!(
                returns.recv_timeout(DEADLINE).is_ok(),
                "post {post} of {WAITERS} woke no waiter"
            );
            assert!(
                returns.try_recv().is_err(),
                "more waiters returned than permits were posted"
            );
        }
        for waiter in waiters {
            waiter.join().unwrap();
        }
        assert_eq!(permits(&SEMAPHORE), 0);
    }

    #[test]
    fn one_permit_admits_one_thread_at_a_time() {
        const THREADS: usize = 4;
        const ROUNDS: usize = if cfg!(miri) { 25 } else { 2_000 };
        static SEMAPHORE: Semaphore = Semaphore::new();
        static INSIDE: AtomicUsize = AtomicUsize::new(0);
        static MOST_INSIDE: AtomicUsize = AtomicUsize::new(0);

        struct Permit;
        impl Drop for Permit {
            fn drop(&mut self) {
                SEMAPHORE.post();
            }
        }

        SEMAPHORE.post();
        let (finished, finishes) = mpsc::channel();
        let threads: Vec<_> = (0..THREADS)
            .map(|_| {
                let finished = finished.clone();
                thread::Builder::new()
                    .spawn(move || {
                        for _ in 0..ROUNDS {
                            SEMAPHORE.wait();
                            let _permit = Permit;
                            let inside = INSIDE.fetch_add(1, Ordering::SeqCst) + 1;
                            MOST_INSIDE.fetch_max(inside, Ordering::SeqCst);
                            INSIDE.fetch_sub(1, Ordering::SeqCst);
                        }
                        finished.send(()).unwrap();
                    })
                    .unwrap()
            })
            .collect();
        for _ in 0..THREADS {
            assert!(
                finishes.recv_timeout(DEADLINE).is_ok(),
                "a thread waits for a permit that was posted"
            );
        }
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(MOST_INSIDE.load(Ordering::SeqCst), 1);
        assert_eq!(permits(&SEMAPHORE), 1);
    }
}
