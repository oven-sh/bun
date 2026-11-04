//! This is a copy-pasta of std.Thread.Mutex with some changes.
//! - No assert with unreachable
//! - uses bun.Futex instead of std.Thread.Futex
//!
//! Mutex is a synchronization primitive which enforces atomic access to a shared region of code known as the "critical section".
//! It does this by blocking ensuring only one thread is in the critical section at any given point in time by blocking the others.
//! Mutex can be statically initialized and is at most `size_of::<u64>()` large.
//! Use `lock()` or `try_lock()` to enter the critical section and `unlock()` to leave it.
//!
//! Example:
//! ```ignore
//! let m = Mutex::default();
//!
//! {
//!     m.lock();
//!     // ... critical section code
//!     m.unlock();
//! }
//!
//! if m.try_lock() {
//!     // ... critical section code
//!     m.unlock();
//! }
//! ```

#[cfg(not(any(windows, target_vendor = "apple")))]
use core::sync::atomic::AtomicU32;
#[cfg(debug_assertions)]
use core::sync::atomic::AtomicU64;
#[cfg(any(debug_assertions, not(any(windows, target_vendor = "apple"))))]
use core::sync::atomic::Ordering;

#[cfg(not(any(windows, target_vendor = "apple")))]
use crate::Futex;

#[derive(Default)]
pub struct Mutex {
    // `pub(crate)` so `Condition` can reach `srwlock` / `locking_thread` for
    // `SleepConditionVariableSRW`.
    pub(crate) impl_: Impl,
}

impl Mutex {
    /// Const-init an unlocked mutex. Required for `static` items.
    pub const fn new() -> Self {
        Self { impl_: Impl::new() }
    }

    /// Tries to acquire the mutex without blocking the caller's thread.
    /// Returns `false` if the calling thread would have to block to acquire it.
    /// Otherwise, returns `true` and the caller should `unlock()` the Mutex to release it.
    #[cfg(debug_assertions)]
    pub fn try_lock(&self) -> bool {
        self.impl_.try_lock()
    }

    /// Acquires the mutex, blocking the caller's thread until it can.
    /// It is undefined behavior if the mutex is already held by the caller's thread.
    /// Once acquired, call `unlock()` on the Mutex to release it.
    pub fn lock(&self) {
        self.impl_.lock()
    }

    /// Releases the mutex which was previously acquired with `lock()` or `try_lock()`.
    /// It is undefined behavior if the mutex is unlocked from a different thread that it was locked from.
    pub fn unlock(&self) {
        // SAFETY: held by this thread (fn contract) and live for the whole call.
        unsafe { Self::unlock_raw(self) }
    }

    /// [`unlock`](Self::unlock) for a release that lets another thread free the mutex
    /// (`WaitGroup::finish_raw`): the releasing store is the last access to `*this`.
    ///
    /// # Safety
    /// `this` must be held by this thread and stay live until the lock is released.
    pub(crate) unsafe fn unlock_raw(this: *const Self) {
        // SAFETY: the lock is still held, so `*this` is live (fn contract).
        unsafe { Impl::unlock_raw(&raw const (*this).impl_) }
    }

    /// Debug-only check that the calling thread already holds this mutex.
    /// Intended for `debug_assert!`-ing a "caller must hold the lock" contract
    /// (e.g. `Watcher::flush_evictions`). In release builds the locking-thread
    /// id is not tracked, so this just returns `true` to make the assert a
    /// no-op there.
    #[inline]
    pub fn is_held_by_current_thread(&self) -> bool {
        #[cfg(debug_assertions)]
        {
            self.impl_.locking_thread.load(Ordering::Relaxed) == current_thread_id()
        }
        #[cfg(not(debug_assertions))]
        {
            true
        }
    }

    /// Acquires the mutex and returns an RAII guard that releases it on `Drop`.
    ///
    /// Prefer this over a bare [`lock`]/[`unlock`] pair so the critical section
    /// is released on every return path (including `?`).
    ///
    /// The returned [`MutexGuard`] holds the mutex by raw pointer rather than a
    /// borrowed `&'a Mutex`, so holding the guard does **not** keep a borrow of
    /// the owning struct alive: the rest of `self` remains freely accessible
    /// while locked. Caller must ensure the `Mutex` outlives the guard (trivially
    /// true for `'static`/singleton mutexes and for guards that drop before the
    /// owning `self` does).
    #[inline]
    #[must_use = "the mutex unlocks immediately if the guard is dropped"]
    pub fn lock_guard(&self) -> MutexGuard {
        self.lock();
        MutexGuard {
            mutex: bun_ptr::BackRef::new(self),
            _not_send: core::marker::PhantomData,
        }
    }
}

/// RAII guard returned by [`Mutex::lock_guard`]. Unlocks on `Drop`.
///
/// Stores a [`BackRef<Mutex>`] (lifetime-erased `&Mutex`) so it does not hold
/// a borrow of the mutex's owner — see [`Mutex::lock_guard`] for the rationale.
/// The `BackRef` invariant (pointee outlives holder) is the caller contract on
/// `lock_guard()`: the mutex outlives this guard (always true when the guard
/// is a local that drops before the owning struct).
pub struct MutexGuard {
    mutex: bun_ptr::BackRef<Mutex>,
    // Preserve the previous `!Send`/`!Sync` auto-trait surface (the field was
    // `*const Mutex`): the Darwin `os_unfair_lock` / Windows `SRWLOCK` backends
    // require unlock on the locking thread.
    _not_send: core::marker::PhantomData<*const Mutex>,
}

impl Drop for MutexGuard {
    #[inline]
    fn drop(&mut self) {
        self.mutex.unlock()
    }
}

#[cfg(debug_assertions)]
type Impl = DebugImpl;
#[cfg(not(debug_assertions))]
type Impl = ReleaseImpl;

#[cfg(windows)]
pub type ReleaseImpl = WindowsImpl;
#[cfg(target_vendor = "apple")]
pub type ReleaseImpl = DarwinImpl;
#[cfg(not(any(windows, target_vendor = "apple")))]
pub type ReleaseImpl = FutexImpl;

#[cfg(debug_assertions)]
type ThreadId = u64;
#[cfg(debug_assertions)]
#[inline]
fn current_thread_id() -> ThreadId {
    crate::current_thread_id()
}

#[cfg(debug_assertions)]
#[derive(Default)]
pub(crate) struct DebugImpl {
    /// 0 means it's not locked.
    pub(crate) locking_thread: AtomicU64,
    pub(crate) impl_: ReleaseImpl,
}

#[cfg(debug_assertions)]
impl DebugImpl {
    const fn new() -> Self {
        Self {
            locking_thread: AtomicU64::new(0),
            impl_: ReleaseImpl::new(),
        }
    }

    #[inline]
    fn try_lock(&self) -> bool {
        let locking = self.impl_.try_lock();
        if locking {
            self.locking_thread
                .store(current_thread_id(), Ordering::Relaxed);
        }
        locking
    }

    #[inline]
    fn lock(&self) {
        let current_id = current_thread_id();
        if self.locking_thread.load(Ordering::Relaxed) == current_id && current_id != 0 {
            panic!("Deadlock detected");
        }
        self.impl_.lock();
        self.locking_thread.store(current_id, Ordering::Relaxed);
    }

    /// See [`Mutex::unlock_raw`] for the contract.
    #[inline]
    unsafe fn unlock_raw(this: *const Self) {
        // SAFETY: the lock is still held, so `*this` is live (fn contract).
        unsafe {
            debug_assert!((*this).locking_thread.load(Ordering::Relaxed) == current_thread_id());
            (*this).locking_thread.store(0, Ordering::Relaxed);
            ReleaseImpl::unlock_raw(&raw const (*this).impl_);
        }
    }
}

/// SRWLOCK on windows is almost always faster than Futex solution.
/// It also implements an efficient Condition with requeue support for us.
#[cfg(windows)]
#[derive(Default)]
pub struct WindowsImpl {
    pub(crate) srwlock: core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>,
}

#[cfg(windows)]
unsafe impl Sync for WindowsImpl {}
#[cfg(windows)]
unsafe impl Send for WindowsImpl {}

// `&UnsafeCell<SRWLOCK>` is ABI-identical to kernel32's `PSRWLOCK` (thin
// non-null pointer to a `#[repr(C)]` word; `UnsafeCell` is
// `#[repr(transparent)]`). The reference type encodes the only pointer-validity
// precondition; acquire on an unowned lock blocks (recursive acquire deadlocks
// — not UB), so `safe fn` discharges the link-time proof for the acquire pair.
// `ReleaseSRWLockExclusive` keeps the raw-pointer `bun_sys` extern: MSDN
// documents "results are undefined" when called without ownership (unlike
// `os_unfair_lock_unlock`, which aborts), so that one retains its block.
#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn AcquireSRWLockExclusive(lock: &core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>);
    // Returns BOOLEAN (u8), not BOOL — compare against 0, not the i32 `FALSE`.
    #[cfg(debug_assertions)]
    safe fn TryAcquireSRWLockExclusive(
        lock: &core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>,
    ) -> u8;
}

#[cfg(windows)]
impl WindowsImpl {
    const fn new() -> Self {
        Self {
            srwlock: core::cell::UnsafeCell::new(bun_sys::windows::SRWLOCK_INIT),
        }
    }

    #[cfg(debug_assertions)]
    fn try_lock(&self) -> bool {
        TryAcquireSRWLockExclusive(&self.srwlock) != 0
    }

    fn lock(&self) {
        AcquireSRWLockExclusive(&self.srwlock)
    }

    /// See [`Mutex::unlock_raw`] for the contract.
    unsafe fn unlock_raw(this: *const Self) {
        // SAFETY: held by this thread (fn contract), so `*this` is live until the release
        // inside the call; releasing without ownership is documented UB on Windows.
        unsafe {
            let srwlock = core::cell::UnsafeCell::raw_get(&raw const (*this).srwlock);
            bun_sys::windows::kernel32::ReleaseSRWLockExclusive(srwlock)
        }
    }
}

/// os_unfair_lock on darwin supports priority inheritance and is generally faster than Futex solutions.
#[cfg(target_vendor = "apple")]
#[derive(Default)]
pub struct DarwinImpl {
    oul: core::cell::UnsafeCell<OsUnfairLock>,
}

// SAFETY: `os_unfair_lock` is the kernel's cross-thread lock primitive; the
// `UnsafeCell` only exists to hand the FFI a mutable pointer from `&self`.
#[cfg(target_vendor = "apple")]
unsafe impl Sync for DarwinImpl {}

#[cfg(target_vendor = "apple")]
#[repr(C)]
#[derive(Default)]
pub(crate) struct OsUnfairLock {
    _opaque: u32,
}

// Darwin libc externs.
// `&UnsafeCell<OsUnfairLock>` is ABI-identical to `os_unfair_lock_t` (thin
// non-null pointer to a `#[repr(C)]` u32; `UnsafeCell` is `#[repr(transparent)]`).
// The type encodes the only pointer-validity precondition, and Apple's runtime
// detects misuse (recursive lock / unowned unlock) by aborting — which is safe
// — so `safe fn` discharges the link-time proof and callers need no `unsafe`.
// `os_unfair_lock_unlock` takes the address instead: see `Mutex::unlock_raw`.
#[cfg(target_vendor = "apple")]
unsafe extern "C" {
    #[cfg(debug_assertions)]
    safe fn os_unfair_lock_trylock(lock: &core::cell::UnsafeCell<OsUnfairLock>) -> bool;
    safe fn os_unfair_lock_lock(lock: &core::cell::UnsafeCell<OsUnfairLock>);
    fn os_unfair_lock_unlock(lock: *mut OsUnfairLock);
}

#[cfg(target_vendor = "apple")]
impl DarwinImpl {
    const fn new() -> Self {
        Self {
            oul: core::cell::UnsafeCell::new(OsUnfairLock { _opaque: 0 }),
        }
    }

    #[cfg(debug_assertions)]
    fn try_lock(&self) -> bool {
        os_unfair_lock_trylock(&self.oul)
    }

    fn lock(&self) {
        os_unfair_lock_lock(&self.oul)
    }

    /// See [`Mutex::unlock_raw`] for the contract.
    unsafe fn unlock_raw(this: *const Self) {
        // SAFETY: held by this thread (fn contract), so `*this` is live until the release
        // inside the call.
        unsafe { os_unfair_lock_unlock(core::cell::UnsafeCell::raw_get(&raw const (*this).oul)) }
    }
}

#[cfg(not(any(windows, target_vendor = "apple")))]
#[derive(Default)]
pub struct FutexImpl {
    state: AtomicU32,
}

#[cfg(not(any(windows, target_vendor = "apple")))]
impl FutexImpl {
    const fn new() -> Self {
        Self {
            state: AtomicU32::new(0),
        }
    }

    const UNLOCKED: u32 = 0b00;
    const LOCKED: u32 = 0b01;
    /// must contain the `LOCKED` bit for x86 optimization below
    const CONTENDED: u32 = 0b11;

    fn lock(&self) {
        if !self.try_lock() {
            self.lock_slow();
        }
    }

    fn try_lock(&self) -> bool {
        // On x86, use `lock bts` instead of `lock cmpxchg` as:
        // - they both seem to mark the cache-line as modified regardless: https://stackoverflow.com/a/63350048
        // - `lock bts` is smaller instruction-wise which makes it better for inlining
        #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
        {
            let locked_bit: u32 = Self::LOCKED.trailing_zeros();
            // PERF: a `lock bts` would be tighter; fetch_or is the closest stable Rust
            // atomic — profile if it shows up on a hot path and consider inline asm if needed.
            return (self.state.fetch_or(1 << locked_bit, Ordering::Acquire) & (1 << locked_bit))
                == 0;
        }

        // Acquire barrier ensures grabbing the lock happens before the critical section
        // and that the previous lock holder's critical section happens before we grab the lock.
        #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
        {
            self.state
                .compare_exchange_weak(
                    Self::UNLOCKED,
                    Self::LOCKED,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_ok()
        }
    }

    /// How many times `spin` looks at the state before it gives up, which takes a few microseconds. Most locks are held
    /// for less, and falling asleep in the kernel and being woken takes more. `std::sync::Mutex` uses the same number.
    const SPINS: u32 = 100;

    /// Waits a short while for the holder to let go. Returns the last state it saw.
    ///
    /// It only loads, so the holder keeps the cache line. It gives up at once if the state is `CONTENDED`: another thread
    /// has already waited this long and gone to sleep.
    fn spin(&self) -> u32 {
        let mut spins_left = Self::SPINS;
        loop {
            let state = self.state.load(Ordering::Relaxed);
            if state != Self::LOCKED || spins_left == 0 {
                return state;
            }
            core::hint::spin_loop();
            spins_left -= 1;
        }
    }

    #[cold]
    fn lock_slow(&self) {
        let mut state = self.spin();

        // This thread hasn't slept, so it may acquire with `locked`, and its unlock makes no system call.
        if state == Self::UNLOCKED {
            match self.state.compare_exchange(
                Self::UNLOCKED,
                Self::LOCKED,
                Ordering::Acquire,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(current) => state = current,
            }
        }

        loop {
            // Try to acquire the lock while also telling the existing lock holder that there are threads waiting.
            //
            // Once we sleep on the Futex, we must acquire the mutex using `contended` rather than `locked`.
            // If not, threads sleeping on the Futex wouldn't see the state change in unlock and potentially deadlock.
            // The downside is that the last mutex unlocker will see `contended` and do an unnecessary Futex wake
            // but this is better than having to wake all waiting threads on mutex unlock.
            //
            // Avoid doing the atomic swap if we already know the state is contended.
            // An atomic swap unconditionally stores which marks the cache-line as modified unnecessarily.
            //
            // Acquire barrier ensures grabbing the lock happens before the critical section
            // and that the previous lock holder's critical section happens before we grab the lock.
            if state != Self::CONTENDED
                && self.state.swap(Self::CONTENDED, Ordering::Acquire) == Self::UNLOCKED
            {
                return;
            }
            Futex::wait_forever(&self.state, Self::CONTENDED);
            // A thread that arrived while this one was waking up may have taken the lock. Sleeping again right away would
            // cost another wake for every such thread.
            state = self.spin();
        }
    }

    /// See [`Mutex::unlock_raw`] for the contract.
    unsafe fn unlock_raw(this: *const Self) {
        // Unlock the mutex and wake up a waiting thread if any.
        //
        // A waiting thread will acquire with `contended` instead of `locked`
        // which ensures that it wakes up another thread on the next unlock().
        //
        // Release barrier ensures the critical section happens before we let go of the lock
        // and that our critical section happens before the next lock holder grabs the lock.
        //
        // SAFETY: the lock is still held, so `*this` is live (fn contract).
        let state_ptr = unsafe { &raw const (*this).state };
        // SAFETY: as above; this swap is the release, and the last access to `*this`.
        let state = unsafe { (*state_ptr).swap(Self::UNLOCKED, Ordering::Release) };
        debug_assert!(state != Self::UNLOCKED);

        if state == Self::CONTENDED {
            Futex::wake_raw(state_ptr, 1);
        }
    }
}

// These have to be a size known to C.
#[unsafe(no_mangle)]
extern "C" fn Bun__lock(lock: &ReleaseImpl) {
    lock.lock()
}

// These have to be a size known to C.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__unlock(ptr: *mut ReleaseImpl) {
    // SAFETY: C caller passes a valid, initialized ReleaseImpl pointer that this thread locked.
    unsafe { ReleaseImpl::unlock_raw(ptr) }
}

#[unsafe(no_mangle)]
static Bun__lock__size: usize = core::mem::size_of::<ReleaseImpl>();

#[cfg(test)]
mod tests {
    use crate::Guarded;

    /// A wake that gets lost hangs the test. A lock that two threads hold at once loses an increment.
    #[test]
    fn no_wake_and_no_increment_is_lost_however_long_the_lock_is_held() {
        const THREADS: u64 = 8;
        // How long the lock is held, in `spin_loop` calls, and how often each thread takes it. Less than a waiting thread
        // spins, about as long, and so much longer that the waiting threads sleep.
        #[cfg(not(miri))]
        const CASES: [(u32, u64); 3] = [(0, 20_000), (50, 20_000), (2_000, 300)];
        #[cfg(miri)]
        const CASES: [(u32, u64); 3] = [(0, 30), (50, 30), (2_000, 5)];
        for (spins_while_held, rounds) in CASES {
            let counter = Guarded::new(0u64);
            std::thread::scope(|scope| {
                for _ in 0..THREADS {
                    scope.spawn(|| {
                        for _ in 0..rounds {
                            let mut value = counter.lock();
                            let before = *value;
                            for _ in 0..spins_while_held {
                                core::hint::spin_loop();
                            }
                            *value = before + 1;
                        }
                    });
                }
            });
            assert_eq!(*counter.lock(), THREADS * rounds);
        }
    }

    #[cfg(not(any(windows, target_vendor = "apple")))]
    mod futex {
        use super::super::FutexImpl;
        use crate::Futex;
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{Duration, Instant};

        #[test]
        fn thread_that_has_not_slept_leaves_no_wake_to_its_unlock() {
            let mutex = FutexImpl::new();
            // As when the holder lets go while this thread spins.
            mutex.lock_slow();
            assert_eq!(mutex.state.load(Ordering::Relaxed), FutexImpl::LOCKED);
            // SAFETY: this thread holds it.
            unsafe { FutexImpl::unlock_raw(&raw const mutex) };
            assert_eq!(mutex.state.load(Ordering::Relaxed), FutexImpl::UNLOCKED);
        }

        #[test]
        fn spin_ends_in_every_state() {
            let mutex = FutexImpl::new();
            for state in [FutexImpl::UNLOCKED, FutexImpl::LOCKED, FutexImpl::CONTENDED] {
                mutex.state.store(state, Ordering::Relaxed);
                assert_eq!(mutex.spin(), state);
            }
        }

        /// `FutexImpl::lock` as it was before `spin`.
        fn lock_without_spinning(mutex: &FutexImpl) {
            if mutex.try_lock() {
                return;
            }
            if mutex.state.load(Ordering::Relaxed) == FutexImpl::CONTENDED {
                Futex::wait_forever(&mutex.state, FutexImpl::CONTENDED);
            }
            while mutex.state.swap(FutexImpl::CONTENDED, Ordering::Acquire) != FutexImpl::UNLOCKED {
                Futex::wait_forever(&mutex.state, FutexImpl::CONTENDED);
            }
        }

        fn stay_busy_for(time: Duration) {
            let began = Instant::now();
            while began.elapsed() < time {
                core::hint::spin_loop();
            }
        }

        struct Case {
            threads: usize,
            /// How often each thread takes the lock.
            rounds: u32,
            held: Duration,
            /// What a thread does between letting go and asking again.
            between: Duration,
        }

        /// Returns the wall time, and how long all threads together waited for the lock.
        fn contend(lock: fn(&FutexImpl), case: &Case) -> (Duration, Duration) {
            let (mutex, waited) = (FutexImpl::new(), AtomicU64::new(0));
            let began = Instant::now();
            std::thread::scope(|scope| {
                for thread in 0..case.threads {
                    let (mutex, waited) = (&mutex, &waited);
                    scope.spawn(move || {
                        // So that the threads don't all ask at the same moment.
                        stay_busy_for(case.between * thread as u32 / case.threads as u32);
                        let mut waited_here = Duration::ZERO;
                        for _ in 0..case.rounds {
                            stay_busy_for(case.between);
                            let asked = Instant::now();
                            lock(mutex);
                            waited_here += asked.elapsed();
                            stay_busy_for(case.held);
                            // SAFETY: this thread holds it.
                            unsafe { FutexImpl::unlock_raw(core::ptr::from_ref(mutex)) };
                        }
                        waited.fetch_add(waited_here.as_nanos() as u64, Ordering::Relaxed);
                    });
                }
            });
            let waited = Duration::from_nanos(waited.load(Ordering::Relaxed));
            (began.elapsed(), waited)
        }

        /// The lock as it was against the lock as it is, in one run, on a machine that does nothing else:
        /// `cargo test -p bun_threading --release -- --ignored --nocapture locks_that_spin_against_locks_that_never_do`
        #[test]
        #[ignore = "a benchmark: it prints a table and asserts nothing"]
        fn locks_that_spin_against_locks_that_never_do() {
            let processors = std::thread::available_parallelism().map_or(1, |it| it.get());
            let case = |threads: usize, rounds: u32, held: Duration, between: Duration| Case {
                threads: threads.min(processors),
                rounds,
                held,
                between,
            };
            let (ns, us, ms) = (
                Duration::from_nanos,
                Duration::from_micros,
                Duration::from_millis,
            );
            let cases = [
                // A commit of `bun check` on 30,000 files: with every lookup under the lock, and with only the stores.
                case(64, 200, us(20), ms(5)),
                case(64, 200, us(3), ms(5)),
                // A shard of a hash table.
                case(64, 10_000, ns(200), us(100)),
                case(8, 200_000, ns(200), us(2)),
                // Nothing but the lock.
                case(2, 1_000_000, ns(0), ns(0)),
                case(1, 2_000_000, ns(0), ns(0)),
                // Held for so long that every spin is wasted.
                case(16, 20, ms(1), ms(1)),
            ];
            println!("{processors} processors");
            println!(
                "threads | held | between | never spins: wall, waited by all | spins: wall, waited by all"
            );
            for case in &cases {
                for _ in 0..2 {
                    let (old_wall, old_waited) = contend(lock_without_spinning, case);
                    let (new_wall, new_waited) = contend(FutexImpl::lock, case);
                    println!(
                        "{} | {:?} | {:?} | {:?}, {:?} | {:?}, {:?}",
                        case.threads,
                        case.held,
                        case.between,
                        old_wall,
                        old_waited,
                        new_wall,
                        new_waited,
                    );
                }
            }
        }
    }
}
