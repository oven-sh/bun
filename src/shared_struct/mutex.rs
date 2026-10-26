//! `Atomics.Mutex` and `Atomics.Condition` primitives.
//!
//! Waits never block for longer than [`SLICE`] without polling the caller's [`Abort`], so a
//! worker blocked here still notices termination and can return control to the VM.
//!
//! The locks here are `std`'s, not `bun_threading`'s: a wait that polls an abort callback needs a
//! timed condition wait, and `bun_threading::Condition::timed_wait` is private to that crate.
#![allow(
    clippy::disallowed_types,
    reason = "needs std::sync::Condvar::wait_timeout, which bun_threading::Condition does not expose"
)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use std::time::{Duration, Instant};

/// Longest uninterrupted sleep before the abort callback is polled again.
const SLICE: Duration = Duration::from_millis(10);

/// Polled while a wait is blocked. Return `true` to give up, for example because the
/// worker was asked to terminate.
pub trait Abort {
    fn aborted(&self) -> bool;
}

impl<F: Fn() -> bool> Abort for F {
    fn aborted(&self) -> bool {
        self()
    }
}

/// An `Abort` that never fires.
pub struct Never;

impl Abort for Never {
    fn aborted(&self) -> bool {
        false
    }
}

/// The wait a script asks for with a number of milliseconds: `None` is forever (`undefined`,
/// `NaN` and `Infinity`), and a negative number is no wait at all.
pub fn timeout_from_millis(ms: f64) -> Option<Duration> {
    if ms.is_nan() {
        return None;
    }
    if ms <= 0.0 {
        return Some(Duration::ZERO);
    }
    // Too long to represent is forever too.
    Duration::try_from_secs_f64(ms / 1000.0).ok()
}

/// The moment `timeout` from now. A timeout so long that the clock cannot represent the moment is never reached, so it is `None`,
/// which waits for ever.
fn deadline_after(timeout: Option<Duration>) -> Option<Instant> {
    timeout.and_then(|t| Instant::now().checked_add(t))
}

/// How many waiters a script asks to wake: `None` is all of them (`undefined`, `Infinity`).
pub fn notify_count(count: Option<f64>) -> Option<u64> {
    let count = count?;
    if count == f64::INFINITY {
        return None;
    }
    // NaN and anything below one wake nobody; a huge count saturates.
    Some(if count >= 1.0 { count as u64 } else { 0 })
}

#[derive(Debug, PartialEq, Eq)]
pub enum LockError {
    /// The timeout elapsed first.
    TimedOut,
    /// The abort callback fired first.
    Aborted,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WaitOutcome {
    Notified,
    TimedOut,
    Aborted,
}

/// A non-recursive lock that other agents can hold a reference to.
#[derive(Debug)]
pub struct Mutex {
    /// Id of the owning thread, or 0 when unlocked. Ids are never 0.
    owner: AtomicU64,
    state: StdMutex<bool>,
    released: Condvar,
}

fn thread_id() -> u64 {
    use std::sync::atomic::AtomicU64;
    static NEXT: AtomicU64 = AtomicU64::new(1);
    thread_local! {
        static ID: u64 = NEXT.fetch_add(1, Ordering::Relaxed);
    }
    ID.with(|id| *id)
}

impl Mutex {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            owner: AtomicU64::new(0),
            state: StdMutex::new(false),
            released: Condvar::new(),
        })
    }

    /// Locks, waiting at most `timeout` (forever if `None`). Locking a mutex this thread
    /// already holds would deadlock, so it is reported as `Err(TimedOut)` after the timeout
    /// like any other contention; callers that want an error instead check [`Mutex::is_owned`].
    pub fn lock(&self, timeout: Option<Duration>, abort: &dyn Abort) -> Result<(), LockError> {
        let deadline = deadline_after(timeout);
        let mut locked = self.state.lock().unwrap();
        while *locked {
            if abort.aborted() {
                return Err(LockError::Aborted);
            }
            let wait = match deadline {
                Some(d) => {
                    let now = Instant::now();
                    if now >= d {
                        return Err(LockError::TimedOut);
                    }
                    SLICE.min(d - now)
                }
                None => SLICE,
            };
            locked = self.released.wait_timeout(locked, wait).unwrap().0;
        }
        *locked = true;
        self.owner.store(thread_id(), Ordering::Relaxed);
        Ok(())
    }

    /// Locks only if that needs no waiting.
    #[cfg(test)]
    pub fn try_lock(&self) -> bool {
        let mut locked = self.state.lock().unwrap();
        if *locked {
            return false;
        }
        *locked = true;
        self.owner.store(thread_id(), Ordering::Relaxed);
        true
    }

    /// Unlocks. Returns `false` if the mutex was not locked.
    pub fn unlock(&self) -> bool {
        let mut locked = self.state.lock().unwrap();
        if !*locked {
            return false;
        }
        *locked = false;
        self.owner.store(0, Ordering::Relaxed);
        drop(locked);
        self.released.notify_one();
        true
    }

    /// Whether the calling thread holds the lock.
    pub fn is_owned(&self) -> bool {
        self.owner.load(Ordering::Relaxed) == thread_id()
    }
}

/// A condition variable. Waiting releases a [`Mutex`] and takes it again before returning.
///
/// Waiters queue in the order they arrive and a notification wakes the ones that are queued at that moment, oldest first: a waiter
/// that arrives later cannot take a wakeup that was meant for an earlier one.
#[derive(Debug)]
pub struct Condition {
    seq: StdMutex<Waiters>,
    wake: Condvar,
}

#[derive(Debug)]
struct Waiters {
    /// The ticket the next waiter gets.
    next: u64,
    /// Tickets of the waiters that have not been notified, oldest first.
    waiting: VecDeque<u64>,
    /// Tickets of waiters that were notified and have not yet noticed.
    woken: Vec<u64>,
}

impl Condition {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            seq: StdMutex::new(Waiters {
                next: 0,
                waiting: VecDeque::new(),
                woken: Vec::new(),
            }),
            wake: Condvar::new(),
        })
    }

    /// Releases `mutex`, waits for a notification, and relocks `mutex`.
    /// The caller must hold `mutex`. The relock happens even when the wait times out; an abort during the relock gives up on it too.
    pub fn wait(&self, mutex: &Mutex, timeout: Option<Duration>, abort: &dyn Abort) -> WaitOutcome {
        let deadline = deadline_after(timeout);
        let mut w = self.seq.lock().unwrap();
        let ticket = w.next;
        w.next += 1;
        w.waiting.push_back(ticket);
        // Release only after queueing, so a notify between the two cannot be lost.
        mutex.unlock();
        let mut outcome = loop {
            if let Some(i) = w.woken.iter().position(|&t| t == ticket) {
                w.woken.swap_remove(i);
                break WaitOutcome::Notified;
            }
            let ended = if abort.aborted() {
                Some(WaitOutcome::Aborted)
            } else {
                None
            };
            let wait = match (ended, deadline) {
                (Some(outcome), _) => {
                    w.waiting.retain(|&t| t != ticket);
                    break outcome;
                }
                (None, Some(d)) => {
                    let now = Instant::now();
                    if now >= d {
                        w.waiting.retain(|&t| t != ticket);
                        break WaitOutcome::TimedOut;
                    }
                    SLICE.min(d - now)
                }
                (None, None) => SLICE,
            };
            w = self.wake.wait_timeout(w, wait).unwrap().0;
        };
        drop(w);
        // The caller expects to hold the lock on return, so take it again, polling the abort while waiting for it.
        if mutex.lock(None, abort).is_err() {
            outcome = WaitOutcome::Aborted;
        }
        outcome
    }

    /// Wakes up to `count` waiters (all of them for `None`), those that are waiting now, oldest first. Returns how many were woken.
    pub fn notify(&self, count: Option<u64>) -> u64 {
        let mut w = self.seq.lock().unwrap();
        let queued = w.waiting.len();
        let n = count.map_or(queued, |c| {
            usize::try_from(c).map_or(queued, |c| c.min(queued))
        });
        for _ in 0..n {
            let ticket = w
                .waiting
                .pop_front()
                .expect("n is at most the queue length");
            w.woken.push(ticket);
        }
        drop(w);
        if n > 0 {
            self.wake.notify_all();
        }
        n as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_excludes_and_times_out() {
        let m = Mutex::new();
        m.lock(None, &Never).unwrap();
        assert!(m.is_owned());
        let m2 = m.clone();
        let r = std::thread::spawn(move || {
            assert!(!m2.is_owned());
            m2.lock(Some(Duration::from_millis(30)), &Never)
        })
        .join()
        .unwrap();
        assert_eq!(r, Err(LockError::TimedOut));
        assert!(m.unlock());
        assert!(!m.unlock());
        assert!(m.try_lock());
    }

    #[test]
    fn script_arguments_become_timeouts_and_counts() {
        assert_eq!(timeout_from_millis(f64::NAN), None);
        assert_eq!(timeout_from_millis(f64::INFINITY), None);
        assert_eq!(timeout_from_millis(1e300), None);
        assert_eq!(timeout_from_millis(-5.0), Some(Duration::ZERO));
        assert_eq!(
            timeout_from_millis(1500.0),
            Some(Duration::from_millis(1500))
        );
        assert_eq!(notify_count(None), None);
        assert_eq!(notify_count(Some(f64::INFINITY)), None);
        assert_eq!(notify_count(Some(f64::NAN)), Some(0));
        assert_eq!(notify_count(Some(-1.0)), Some(0));
        assert_eq!(notify_count(Some(2.9)), Some(2));
    }

    #[test]
    fn lock_can_be_aborted() {
        let m = Mutex::new();
        m.lock(None, &Never).unwrap();
        let m2 = m.clone();
        let r = std::thread::spawn(move || m2.lock(None, &|| true))
            .join()
            .unwrap();
        assert_eq!(r, Err(LockError::Aborted));
    }

    #[test]
    fn mutex_protects_a_counter() {
        let m = Mutex::new();
        let counter = Arc::new(AtomicU64::new(0));
        let threads: Vec<_> = (0..6)
            .map(|_| {
                let (m, counter) = (m.clone(), counter.clone());
                std::thread::spawn(move || {
                    for _ in 0..500 {
                        m.lock(None, &Never).unwrap();
                        let v = counter.load(Ordering::Relaxed);
                        counter.store(v + 1, Ordering::Relaxed);
                        m.unlock();
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(counter.load(Ordering::Relaxed), 3000);
    }

    #[test]
    fn condition_wakes_waiter_and_relocks() {
        let m = Mutex::new();
        let c = Condition::new();
        let flag = Arc::new(AtomicU64::new(0));
        let waiter = {
            let (m, c, flag) = (m.clone(), c.clone(), flag.clone());
            std::thread::spawn(move || {
                m.lock(None, &Never).unwrap();
                while flag.load(Ordering::SeqCst) == 0 {
                    assert_eq!(c.wait(&m, None, &Never), WaitOutcome::Notified);
                }
                assert!(m.is_owned());
                m.unlock();
            })
        };
        std::thread::sleep(Duration::from_millis(30));
        m.lock(None, &Never).unwrap();
        flag.store(1, Ordering::SeqCst);
        assert_eq!(c.notify(Some(1)), 1);
        m.unlock();
        waiter.join().unwrap();
    }

    #[test]
    fn condition_times_out_and_still_holds_the_lock() {
        let m = Mutex::new();
        let c = Condition::new();
        m.lock(None, &Never).unwrap();
        assert_eq!(
            c.wait(&m, Some(Duration::from_millis(20)), &Never),
            WaitOutcome::TimedOut
        );
        assert!(m.is_owned());
        m.unlock();
        assert_eq!(c.notify(None), 0);
    }

    #[test]
    fn a_timeout_too_long_for_the_clock_waits_for_ever_instead_of_panicking() {
        let m = Mutex::new();
        assert_eq!(m.lock(Some(Duration::MAX), &Never), Ok(()));
        assert!(m.unlock());
        assert!(timeout_from_millis(1e22).is_some());
        assert_eq!(m.lock(timeout_from_millis(1e22), &Never), Ok(()));
        let c = Condition::new();
        let aborted = AtomicU64::new(0);
        let abort = || aborted.fetch_add(1, Ordering::Relaxed) > 2;
        assert_eq!(
            c.wait(&m, Some(Duration::MAX), &abort),
            WaitOutcome::Aborted
        );
        assert!(m.is_owned());
    }

    #[test]
    fn a_waiter_that_arrives_after_a_notify_does_not_take_its_wakeup() {
        let m = Mutex::new();
        let c = Condition::new();
        let first = {
            let (m, c) = (m.clone(), c.clone());
            std::thread::spawn(move || {
                m.lock(None, &Never).unwrap();
                let outcome = c.wait(&m, Some(Duration::from_secs(5)), &Never);
                m.unlock();
                outcome
            })
        };
        while c.seq.lock().unwrap().waiting.is_empty() {
            std::thread::sleep(Duration::from_millis(2));
        }
        m.lock(None, &Never).unwrap();
        assert_eq!(c.notify(Some(1)), 1);
        // The second waiter queues after the notification and must wait out its own timeout.
        let outcome = c.wait(&m, Some(Duration::from_millis(60)), &Never);
        m.unlock();
        assert_eq!(outcome, WaitOutcome::TimedOut);
        assert_eq!(first.join().unwrap(), WaitOutcome::Notified);
    }

    #[test]
    fn notify_wakes_the_oldest_waiters_first() {
        let m = Mutex::new();
        let c = Condition::new();
        let order = Arc::new(StdMutex::new(Vec::new()));
        let mut threads = Vec::new();
        for id in 0..3u64 {
            let (waiter_m, waiter_c, waiter_order) = (m.clone(), c.clone(), order.clone());
            threads.push(std::thread::spawn(move || {
                waiter_m.lock(None, &Never).unwrap();
                let outcome = waiter_c.wait(&waiter_m, Some(Duration::from_secs(2)), &Never);
                if outcome == WaitOutcome::Notified {
                    waiter_order.lock().unwrap().push(id);
                }
                waiter_m.unlock();
            }));
            while c.seq.lock().unwrap().waiting.len() < usize::try_from(id).unwrap() + 1 {
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        assert_eq!(c.notify(Some(1)), 1);
        while order.lock().unwrap().is_empty() {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(*order.lock().unwrap(), vec![0]);
        assert_eq!(c.notify(None), 2);
        for t in threads {
            t.join().unwrap();
        }
    }

    #[test]
    fn notify_all_wakes_every_waiter() {
        let m = Mutex::new();
        let c = Condition::new();
        let woken = Arc::new(AtomicU64::new(0));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let (m, c, woken) = (m.clone(), c.clone(), woken.clone());
                std::thread::spawn(move || {
                    m.lock(None, &Never).unwrap();
                    if c.wait(&m, Some(Duration::from_secs(5)), &Never) == WaitOutcome::Notified {
                        woken.fetch_add(1, Ordering::SeqCst);
                    }
                    m.unlock();
                })
            })
            .collect();
        while c.seq.lock().unwrap().waiting.len() < 4 {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(c.notify(None), 4);
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(woken.load(Ordering::SeqCst), 4);
    }
}
