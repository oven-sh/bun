//! Copy of std.Thread.Condition, but uses Bun's Mutex and Futex.
//! Synchronized with std as of Zig 0.14.1.
//!
//! Condition variables are used with a Mutex to efficiently wait for an arbitrary condition to occur.
//! It does this by atomically unlocking the mutex, blocking the thread until notified, and finally re-locking the mutex.
//! Condition can be statically initialized and is at most `size_of::<u64>()` large.
//!
//! Example:
//! ```ignore
//! static M: Mutex = Mutex::new();
//! static C: Condition = Condition::new();
//! static PREDICATE: AtomicBool = AtomicBool::new(false);
//!
//! fn consumer() {
//!     M.lock();
//!     // (unlock on scope exit)
//!
//!     while !PREDICATE.load(Relaxed) {
//!         C.wait(&M);
//!     }
//!     M.unlock();
//! }
//!
//! fn producer() {
//!     {
//!         M.lock();
//!         PREDICATE.store(true, Relaxed);
//!         M.unlock();
//!     }
//!     C.signal();
//! }
//!
//! let thread = std::thread::spawn(producer);
//! consumer();
//! thread.join();
//! ```
//!
//! Note that condition variables can only reliably unblock threads that are sequenced before them using the same Mutex.
//! This means that the following is allowed to deadlock:
//! ```text
//! thread-1: mutex.lock()
//! thread-1: condition.wait(&mutex)
//!
//! thread-2: // mutex.lock() (without this, the following signal may not see the waiting thread-1)
//! thread-2: // mutex.unlock() (this is optional for correctness once locked above, as signal can be called while holding the mutex)
//! thread-2: condition.signal()
//! ```

#[cfg(not(windows))]
use core::sync::atomic::AtomicU32;
use core::sync::atomic::Ordering;

#[cfg(not(windows))]
use crate::Futex;
use crate::Mutex;
use crate::guarded::GuardedLock;

#[derive(Default)]
pub struct Condition {
    // PORT NOTE: Zig field name `impl` is a Rust keyword; renamed to `impl_`.
    impl_: Impl,
}

/// `parking_lot::Condvar` drop-in alias. Same type, different spelling so
/// migrated call sites can keep `Condvar::new()` / `notify_one()` / `notify_all()`.
pub type Condvar = Condition;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeoutError {
    #[error("Timeout")]
    Timeout,
}

impl From<TimeoutError> for bun_core::Error {
    fn from(_: TimeoutError) -> Self {
        bun_core::err!("Timeout")
    }
}

impl Condition {
    /// Const-init an empty condition variable (Zig: `.{}`). Required for
    /// `static` items — this is the `parking_lot::Condvar::new()` parity that
    /// `std::sync::Condvar` lacks.
    pub const fn new() -> Self {
        Self { impl_: Impl::new() }
    }

    /// Atomically releases the Mutex, blocks the caller thread, then re-acquires the Mutex on return.
    /// "Atomically" here refers to accesses done on the Condition after acquiring the Mutex.
    ///
    /// The Mutex must be locked by the caller's thread when this function is called.
    /// A Mutex can have multiple Conditions waiting with it concurrently, but not the opposite.
    /// It is undefined behavior for multiple threads to wait ith different mutexes using the same Condition concurrently.
    /// Once threads have finished waiting with one Mutex, the Condition can be used to wait with another Mutex.
    ///
    /// A blocking call to wait() is unblocked from one of the following conditions:
    /// - a spurious ("at random") wake up occurs
    /// - a future call to `signal()` or `broadcast()` which has acquired the Mutex and is sequenced after this `wait()`.
    ///
    /// Given wait() can be interrupted spuriously, the blocking condition should be checked continuously
    /// irrespective of any notifications from `signal()` or `broadcast()`.
    pub fn wait(&self, mutex: &Mutex) {
        match self.impl_.wait(mutex, None) {
            Ok(()) => {}
            Err(TimeoutError::Timeout) => unreachable!(), // no timeout provided so we shouldn't have timed-out
        }
    }

    /// Atomically releases the Mutex, blocks the caller thread, then re-acquires the Mutex on return.
    /// "Atomically" here refers to accesses done on the Condition after acquiring the Mutex.
    ///
    /// The Mutex must be locked by the caller's thread when this function is called.
    /// A Mutex can have multiple Conditions waiting with it concurrently, but not the opposite.
    /// It is undefined behavior for multiple threads to wait ith different mutexes using the same Condition concurrently.
    /// Once threads have finished waiting with one Mutex, the Condition can be used to wait with another Mutex.
    ///
    /// A blocking call to `timed_wait()` is unblocked from one of the following conditions:
    /// - a spurious ("at random") wake occurs
    /// - the caller was blocked for around `timeout_ns` nanoseconds, in which `TimeoutError::Timeout` is returned.
    /// - a future call to `signal()` or `broadcast()` which has acquired the Mutex and is sequenced after this `timed_wait()`.
    ///
    /// Given `timed_wait()` can be interrupted spuriously, the blocking condition should be checked continuously
    /// irrespective of any notifications from `signal()` or `broadcast()`.
    pub fn timed_wait(&self, mutex: &Mutex, timeout_ns: u64) -> Result<(), TimeoutError> {
        self.impl_.wait(mutex, Some(timeout_ns))
    }

    /// Unblocks at least one thread blocked in a call to `wait()` or `timed_wait()` with a given Mutex.
    /// The blocked thread must be sequenced before this call with respect to acquiring the same Mutex in order to be observable for unblocking.
    /// `signal()` can be called with or without the relevant Mutex being acquired and have no "effect" if there's no observable blocked threads.
    pub fn signal(&self) {
        self.impl_.wake(Notify::One);
    }

    /// Unblocks all threads currently blocked in a call to `wait()` or `timed_wait()` with a given Mutex.
    /// The blocked threads must be sequenced before this call with respect to acquiring the same Mutex in order to be observable for unblocking.
    /// `broadcast()` can be called with or without the relevant Mutex being acquired and have no "effect" if there's no observable blocked threads.
    pub fn broadcast(&self) {
        self.impl_.wake(Notify::All);
    }

    // ── parking_lot::Condvar parity (guard-style API) ─────────────────────
    //
    // Zig's `Condition.wait` takes a bare `*Mutex` (the caller writes
    // `mutex.lock(); defer mutex.unlock(); cond.wait(&mutex)`). Rust callers
    // hold a `GuardedLock<'_, T>` instead, so these overloads peel the inner
    // `&Mutex` out of the guard and forward. The mutex is unlocked for the
    // duration of the OS wait and re-locked before return, so the guard's
    // `Drop` (which unlocks once) remains balanced.
    //
    // `guard` is `&mut` so the protected `T` cannot be observed while the
    // mutex is released inside the wait — same contract as
    // `parking_lot::Condvar::wait(&mut MutexGuard<T>)`.

    /// [`wait`](Self::wait) for callers holding a [`GuardedLock`].
    pub fn wait_guarded<T>(&self, guard: &mut GuardedLock<'_, T, Mutex>) {
        self.wait(guard.mutex())
    }

    /// [`timed_wait`](Self::timed_wait) for callers holding a [`GuardedLock`].
    pub fn timed_wait_guarded<T>(
        &self,
        guard: &mut GuardedLock<'_, T, Mutex>,
        timeout_ns: u64,
    ) -> Result<(), TimeoutError> {
        self.timed_wait(guard.mutex(), timeout_ns)
    }

    /// Alias for [`signal`](Self::signal) — `parking_lot::Condvar` spelling.
    #[inline]
    pub fn notify_one(&self) {
        self.signal()
    }

    /// Alias for [`broadcast`](Self::broadcast) — `parking_lot::Condvar` spelling.
    #[inline]
    pub fn notify_all(&self) {
        self.broadcast()
    }
}

#[cfg(windows)]
type Impl = WindowsImpl;
#[cfg(not(windows))]
type Impl = FutexImpl;

// PORT NOTE: Zig passed `comptime notify: Notify`. Stable Rust forbids enum
// const-generic params (`adt_const_params`), so `wake()` takes it at runtime;
// the two-variant match optimizes equivalently.
#[derive(PartialEq, Eq, Clone, Copy)]
enum Notify {
    One, // wake up only one thread
    All, // wake up all threads
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use bun_sys::windows;
    use bun_sys::windows::kernel32;

    use bun_core::time::NS_PER_MS;

    // `&UnsafeCell<CONDITION_VARIABLE>` is ABI-identical to kernel32's
    // `PCONDITION_VARIABLE` (thin non-null pointer; `UnsafeCell` is
    // `#[repr(transparent)]`). Waking with no waiters is a documented no-op —
    // no state precondition — so `safe fn` discharges the link-time proof for
    // the wake pair. `SleepConditionVariableSRW` retains its raw-pointer
    // `kernel32::` form: it requires the SRW lock be held by the caller.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn WakeConditionVariable(cv: &core::cell::UnsafeCell<windows::CONDITION_VARIABLE>);
        safe fn WakeAllConditionVariable(cv: &core::cell::UnsafeCell<windows::CONDITION_VARIABLE>);
    }

    pub(super) struct WindowsImpl {
        condition: core::cell::UnsafeCell<windows::CONDITION_VARIABLE>,
    }

    // SAFETY: CONDITION_VARIABLE is an OS-managed sync primitive designed for
    // concurrent access from multiple threads; all access goes through kernel32
    // calls which provide their own synchronization.
    unsafe impl Sync for WindowsImpl {}
    unsafe impl Send for WindowsImpl {}

    impl Default for WindowsImpl {
        fn default() -> Self {
            Self::new()
        }
    }

    impl WindowsImpl {
        pub(super) const fn new() -> Self {
            Self {
                condition: core::cell::UnsafeCell::new(windows::CONDITION_VARIABLE_INIT),
            }
        }

        pub(super) fn wait(&self, mutex: &Mutex, timeout: Option<u64>) -> Result<(), TimeoutError> {
            let mut timeout_overflowed = false;
            let mut timeout_ms: windows::DWORD = windows::INFINITE;

            if let Some(timeout_ns) = timeout {
                // Round the nanoseconds to the nearest millisecond,
                // then saturating cast it to windows DWORD for use in kernel32 call.
                let ms = timeout_ns.saturating_add(NS_PER_MS / 2) / NS_PER_MS;
                timeout_ms = windows::DWORD::try_from(ms).unwrap_or(windows::DWORD::MAX);

                // Track if the timeout overflowed into INFINITE and make sure not to wait forever.
                if timeout_ms == windows::INFINITE {
                    timeout_overflowed = true;
                    timeout_ms -= 1;
                }
            }

            #[cfg(debug_assertions)]
            {
                // The internal state of the DebugMutex needs to be handled here as well.
                // TODO(port): Mutex internals — Zig: mutex.impl.locking_thread.store(0, .unordered)
                mutex.impl_.locking_thread.store(0, Ordering::Relaxed);
            }
            // SAFETY: `condition` and `srwlock` are UnsafeCell-wrapped OS sync primitives;
            // kernel32 mutates them internally and provides its own synchronization. The
            // mutex is locked by the caller per this function's contract.
            let rc = unsafe {
                kernel32::SleepConditionVariableSRW(
                    self.condition.get(),
                    // TODO(port): Mutex internals — debug build wraps an inner impl with `srwlock`.
                    #[cfg(debug_assertions)]
                    {
                        mutex.impl_.impl_.srwlock.get()
                    },
                    #[cfg(not(debug_assertions))]
                    {
                        mutex.impl_.srwlock.get()
                    },
                    timeout_ms,
                    0, // the srwlock was assumed to acquired in exclusive mode not shared
                )
            };
            #[cfg(debug_assertions)]
            {
                // The internal state of the DebugMutex needs to be handled here as well.
                // TODO(port): std.Thread.getCurrentId() equivalent in bun_threading.
                mutex
                    .impl_
                    .locking_thread
                    .store(crate::current_thread_id(), Ordering::Relaxed);
            }

            // Return TimeoutError::Timeout if we know the timeout elapsed correctly.
            if rc == windows::FALSE {
                // GetLastError returns DWORD; `Win32Error` is a u16 newtype — compare raw.
                debug_assert!(windows::GetLastError() == windows::Win32Error::TIMEOUT.0 as u32);
                if !timeout_overflowed {
                    return Err(TimeoutError::Timeout);
                }
            }
            Ok(())
        }

        pub(super) fn wake(&self, notify: Notify) {
            match notify {
                Notify::One => WakeConditionVariable(&self.condition),
                Notify::All => WakeAllConditionVariable(&self.condition),
            }
        }
    }
}
#[cfg(windows)]
use windows_impl::WindowsImpl;

#[cfg(not(windows))]
#[derive(Default)]
struct FutexImpl {
    state: AtomicU32,
    epoch: AtomicU32,
}

#[cfg(not(windows))]
impl FutexImpl {
    const fn new() -> Self {
        Self {
            state: AtomicU32::new(0),
            epoch: AtomicU32::new(0),
        }
    }

    const ONE_WAITER: u32 = 1;
    const WAITER_MASK: u32 = 0xffff;

    const ONE_SIGNAL: u32 = 1 << 16;
    const SIGNAL_MASK: u32 = 0xffff << 16;

    fn wait(&self, mutex: &Mutex, timeout: Option<u64>) -> Result<(), TimeoutError> {
        // Observe the epoch, then check the state again to see if we should wake up.
        // The epoch must be observed before we check the state or we could potentially miss a wake() and deadlock:
        //
        // - T1: s = LOAD(&state)
        // - T2: UPDATE(&s, signal)
        // - T2: UPDATE(&epoch, 1) + FUTEX_WAKE(&epoch)
        // - T1: e = LOAD(&epoch) (was reordered after the state load)
        // - T1: s & signals == 0 -> FUTEX_WAIT(&epoch, e) (missed the state update + the epoch change)
        //
        // Acquire barrier to ensure the epoch load happens before the state load.
        let mut epoch = self.epoch.load(Ordering::Acquire);
        let mut state = self.state.fetch_add(Self::ONE_WAITER, Ordering::Relaxed);
        debug_assert!(state & Self::WAITER_MASK != Self::WAITER_MASK);
        state += Self::ONE_WAITER;

        mutex.unlock();
        // PORT NOTE: Zig `defer mutex.lock()` — re-acquire on every exit path (Ok and Err).
        // Condvar wait semantics (unlock, block, re-lock) are the inverse of MutexGuard,
        // so the re-lock is expressed as a one-off defer rather than an RAII guard type.
        scopeguard::defer! { mutex.lock(); }

        let mut futex_deadline = Futex::Deadline::init(timeout);

        loop {
            match futex_deadline.wait(&self.epoch, epoch) {
                Ok(()) => {}
                // On timeout, we must decrement the waiter we added above.
                Err(crate::futex::TimeoutError::Timeout) => {
                    loop {
                        // If there's a signal when we're timing out, consume it and report being woken up instead.
                        // Acquire barrier ensures code before the wake() which added the signal happens before we decrement it and return.
                        while state & Self::SIGNAL_MASK != 0 {
                            let new_state = state - Self::ONE_WAITER - Self::ONE_SIGNAL;
                            state = match self.state.compare_exchange_weak(
                                state,
                                new_state,
                                Ordering::Acquire,
                                Ordering::Relaxed,
                            ) {
                                Ok(_) => return Ok(()),
                                Err(s) => s,
                            };
                        }

                        // Remove the waiter we added and officially return timed out.
                        let new_state = state - Self::ONE_WAITER;
                        state = match self.state.compare_exchange_weak(
                            state,
                            new_state,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        ) {
                            Ok(_) => return Err(TimeoutError::Timeout),
                            Err(s) => s,
                        };
                    }
                }
            }

            epoch = self.epoch.load(Ordering::Acquire);
            state = self.state.load(Ordering::Relaxed);

            // Try to wake up by consuming a signal and decremented the waiter we added previously.
            // Acquire barrier ensures code before the wake() which added the signal happens before we decrement it and return.
            while state & Self::SIGNAL_MASK != 0 {
                let new_state = state - Self::ONE_WAITER - Self::ONE_SIGNAL;
                state = match self.state.compare_exchange_weak(
                    state,
                    new_state,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => return Ok(()),
                    Err(s) => s,
                };
            }
        }
    }

    fn wake(&self, notify: Notify) {
        let mut state = self.state.load(Ordering::Relaxed);
        loop {
            let waiters = (state & Self::WAITER_MASK) / Self::ONE_WAITER;
            let signals = (state & Self::SIGNAL_MASK) / Self::ONE_SIGNAL;

            // Reserves which waiters to wake up by incrementing the signals count.
            // Therefore, the signals count is always less than or equal to the waiters count.
            // We don't need to Futex.wake if there's nothing to wake up or if other wake() threads have reserved to wake up the current waiters.
            let wakeable = waiters - signals;
            if wakeable == 0 {
                return;
            }

            let to_wake = match notify {
                Notify::One => 1,
                Notify::All => wakeable,
            };

            // Reserve the amount of waiters to wake by incrementing the signals count.
            // Release barrier ensures code before the wake() happens before the signal it posted and consumed by the wait() threads.
            let new_state = state + (Self::ONE_SIGNAL * to_wake);
            state = match self.state.compare_exchange_weak(
                state,
                new_state,
                Ordering::Release,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    // Wake up the waiting threads we reserved above by changing the epoch value.
                    // NOTE: a waiting thread could miss a wake up if *exactly* ((1<<32)-1) wake()s happen between it observing the epoch and sleeping on it.
                    // This is very unlikely due to how many precise amount of Futex.wake() calls that would be between the waiting thread's potential preemption.
                    //
                    // Release barrier ensures the signal being added to the state happens before the epoch is changed.
                    // If not, the waiting thread could potentially deadlock from missing both the state and epoch change:
                    //
                    // - T2: UPDATE(&epoch, 1) (reordered before the state change)
                    // - T1: e = LOAD(&epoch)
                    // - T1: s = LOAD(&state)
                    // - T2: UPDATE(&state, signal) + FUTEX_WAKE(&epoch)
                    // - T1: s & signals == 0 -> FUTEX_WAIT(&epoch, e) (missed both epoch change and state change)
                    let _ = self.epoch.fetch_add(1, Ordering::Release);
                    Futex::wake(&self.epoch, to_wake);
                    return;
                }
                Err(s) => s,
            };
        }
    }
}

// ported from: src/threading/Condition.zig
