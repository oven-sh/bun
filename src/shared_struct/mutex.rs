//! `Atomics.Mutex` and `Atomics.Condition` primitives.
//!
//! Waits never block for longer than [`SLICE`] without polling the caller's [`Abort`], so a
//! worker blocked here still notices termination and can return control to the VM.

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
        let deadline = timeout.map(|t| Instant::now() + t);
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

    pub fn is_locked(&self) -> bool {
        *self.state.lock().unwrap()
    }
}

/// A condition variable. Waiting releases a [`Mutex`] and takes it again before returning.
#[derive(Debug)]
pub struct Condition {
    /// Count of notifications handed out; a waiter sleeps until it changes.
    seq: StdMutex<Waiters>,
    wake: Condvar,
}

#[derive(Debug)]
struct Waiters {
    /// Waiters currently asleep.
    waiting: u64,
    /// Wakeups still available to waiters.
    permits: u64,
}

impl Condition {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            seq: StdMutex::new(Waiters {
                waiting: 0,
                permits: 0,
            }),
            wake: Condvar::new(),
        })
    }

    /// Releases `mutex`, waits for a notification, and relocks `mutex`.
    /// The caller must hold `mutex`. The relock happens even when the wait times out or is aborted.
    pub fn wait(&self, mutex: &Mutex, timeout: Option<Duration>, abort: &dyn Abort) -> WaitOutcome {
        let deadline = timeout.map(|t| Instant::now() + t);
        let mut w = self.seq.lock().unwrap();
        w.waiting += 1;
        // Release only after registering, so a notify between the two cannot be lost.
        mutex.unlock();
        let outcome = loop {
            if w.permits > 0 {
                w.permits -= 1;
                break WaitOutcome::Notified;
            }
            if abort.aborted() {
                break WaitOutcome::Aborted;
            }
            let wait = match deadline {
                Some(d) => {
                    let now = Instant::now();
                    if now >= d {
                        break WaitOutcome::TimedOut;
                    }
                    SLICE.min(d - now)
                }
                None => SLICE,
            };
            w = self.wake.wait_timeout(w, wait).unwrap().0;
        };
        w.waiting -= 1;
        drop(w);
        // Reacquire even if aborted: the caller expects to hold the lock on return.
        let _ = mutex.lock(None, &Never);
        outcome
    }

    /// Wakes up to `count` waiters (all of them for `None`). Returns how many were woken.
    pub fn notify(&self, count: Option<u64>) -> u64 {
        let mut w = self.seq.lock().unwrap();
        let available = w.waiting.saturating_sub(w.permits);
        let n = count.map_or(available, |c| c.min(available));
        w.permits += n;
        drop(w);
        if n > 0 {
            self.wake.notify_all();
        }
        n
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
        while c.seq.lock().unwrap().waiting < 4 {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(c.notify(None), 4);
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(woken.load(Ordering::SeqCst), 4);
    }
}
