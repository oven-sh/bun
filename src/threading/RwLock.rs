//! A lock that supports one writer or many readers.
//!
//! Built on top of Bun's `Mutex` + `Semaphore`, wrapped in a data-owning `RwLock<T>` with RAII
//! guards so it drops in for `parking_lot::RwLock<T>`:
//!
//! - `const fn new(T)` — usable in `static`.
//! - `.read()` / `.write()` return guards with `Deref` / `DerefMut`.
//! - No poisoning (matches `parking_lot`).
//!
//! Writer-preferring: a pending writer blocks new readers from acquiring on
//! the CAS fast path (they fall through to the mutex, which the writer holds).
//! Fairness beyond that is whatever the underlying `Mutex`/Futex provides.
//!
//! `pthread_rwlock_t` is intentionally not used — this algorithm is portable
//! across all Bun targets while keeping `const fn new` (which
//! `pthread_rwlock_t` cannot guarantee).

use core::cell::UnsafeCell;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{Mutex, Semaphore};

// ── raw state machine ──────────────────────────────────────────────────────

struct RawRwLock {
    state: AtomicUsize,
    mutex: Mutex,
    semaphore: Semaphore,
}

// Bit layout of `state`:
//
//   bit 0                : IS_WRITING — a writer holds the lock
//   bits 1..=COUNT_BITS  : pending-writer count (WRITER_MASK)
//   bits COUNT_BITS+1..  : active-reader  count (READER_MASK)
//
// `COUNT_BITS` = ⌊(usize::BITS − 1) / 2⌋ so both counts fit side-by-side
// alongside the IS_WRITING bit (31 each on 64-bit, 15 each on 32-bit).
const COUNT_BITS: u32 = (usize::BITS - 1) / 2;
const COUNT_MAX: usize = (1usize << COUNT_BITS) - 1;

const IS_WRITING: usize = 1;
const WRITER: usize = 1 << 1;
const READER: usize = 1 << (1 + COUNT_BITS);
const WRITER_MASK: usize = COUNT_MAX << WRITER.trailing_zeros();
const READER_MASK: usize = COUNT_MAX << READER.trailing_zeros();

impl RawRwLock {
    const fn new() -> Self {
        Self {
            state: AtomicUsize::new(0),
            mutex: Mutex::new(),
            semaphore: Semaphore::new(),
        }
    }

    fn lock(&self) {
        let _ = self.state.fetch_add(WRITER, Ordering::SeqCst);
        self.mutex.lock();

        // Wrapping sub so the single fetch_add both sets IS_WRITING and clears
        // the pending-writer reservation.
        let state = self
            .state
            .fetch_add(IS_WRITING.wrapping_sub(WRITER), Ordering::SeqCst);
        if state & READER_MASK != 0 {
            self.semaphore.wait();
        }
    }

    fn unlock(&self) {
        let _ = self.state.fetch_and(!IS_WRITING, Ordering::SeqCst);
        self.mutex.unlock();
    }

    fn lock_shared(&self) {
        let mut state = self.state.load(Ordering::SeqCst);
        while state & (IS_WRITING | WRITER_MASK) == 0 {
            match self.state.compare_exchange_weak(
                state,
                state + READER,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return,
                Err(s) => state = s,
            }
        }

        self.mutex.lock();
        let _ = self.state.fetch_add(READER, Ordering::SeqCst);
        self.mutex.unlock();
    }

    fn unlock_shared(&self) {
        let state = self.state.fetch_sub(READER, Ordering::SeqCst);

        if (state & READER_MASK == READER) && (state & IS_WRITING != 0) {
            self.semaphore.post();
        }
    }
}

// ── data-owning wrapper (parking_lot::RwLock<T> shape) ────────────────────

/// Reader-writer lock owning a `T`. See module docs for semantics.
pub struct RwLock<T> {
    raw: RawRwLock,
    value: UnsafeCell<T>,
}

// SAFETY: `value` is only accessed under `raw`'s read/write discipline, which
// guarantees either many shared `&T` or one exclusive `&mut T`. Same bounds
// `parking_lot::RwLock<T>` uses.
unsafe impl<T: Send> Send for RwLock<T> {}
// SAFETY: `&RwLock<T>` only exposes `value` through guards obtained from `raw`,
// yielding either shared `&T` (requires `T: Sync`) or, on a single thread, an
// exclusive `&mut T` (requires `T: Send`). `raw` itself is built from atomics.
unsafe impl<T: Send + Sync> Sync for RwLock<T> {}

impl<T: Default> Default for RwLock<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> RwLock<T> {
    /// Const-init. Parity with `parking_lot::RwLock::new` /
    /// `parking_lot::const_rwlock`.
    pub const fn new(value: T) -> Self {
        Self {
            raw: RawRwLock::new(),
            value: UnsafeCell::new(value),
        }
    }

    /// Acquire a shared read lock, blocking if a writer holds (or is waiting
    /// for) the lock.
    #[inline]
    pub fn read(&self) -> RwLockReadGuard<'_, T> {
        self.raw.lock_shared();
        RwLockReadGuard {
            lock: self,
            _not_send: PhantomData,
        }
    }

    /// Acquire an exclusive write lock, blocking until all readers and any
    /// other writer have released.
    #[inline]
    pub fn write(&self) -> RwLockWriteGuard<'_, T> {
        self.raw.lock();
        RwLockWriteGuard {
            lock: self,
            _not_send: PhantomData,
        }
    }
}

/// RAII shared-read guard. `Deref<Target = T>` only.
///
/// `!Send` to match `parking_lot` and because the write-side guard must be
/// `!Send` (Darwin `os_unfair_lock` requires unlock on the locking thread);
/// keeping both guards `!Send` avoids surprising asymmetry.
pub struct RwLockReadGuard<'a, T> {
    lock: &'a RwLock<T>,
    _not_send: PhantomData<*const ()>,
}

impl<'a, T> Deref for RwLockReadGuard<'a, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: shared lock held; only `&T` is handed out under it.
        unsafe { &*self.lock.value.get() }
    }
}

impl<'a, T> Drop for RwLockReadGuard<'a, T> {
    #[inline]
    fn drop(&mut self) {
        self.lock.raw.unlock_shared();
    }
}

/// RAII exclusive-write guard. `Deref` + `DerefMut`.
///
/// `!Send`: dropping on another thread would call `Mutex::unlock()` off the
/// locking thread, which Darwin `os_unfair_lock` / Windows `SRWLOCK` forbid.
pub struct RwLockWriteGuard<'a, T> {
    lock: &'a RwLock<T>,
    _not_send: PhantomData<*const ()>,
}

impl<'a, T> Deref for RwLockWriteGuard<'a, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: exclusive lock held.
        unsafe { &*self.lock.value.get() }
    }
}

impl<'a, T> DerefMut for RwLockWriteGuard<'a, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: exclusive lock held; this is the only live reference.
        unsafe { &mut *self.lock.value.get() }
    }
}

impl<'a, T> Drop for RwLockWriteGuard<'a, T> {
    #[inline]
    fn drop(&mut self) {
        self.lock.raw.unlock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        let rwl = RwLock::new(0u32);

        {
            let mut w = rwl.write();
            *w = 1;
        }

        {
            let r1 = rwl.read();
            let r2 = rwl.read();
            assert_eq!(*r1, 1);
            assert_eq!(*r2, 1);
        }

        let _w = rwl.write();
    }

    #[test]
    fn raw_internal_state() {
        // Regression test: the WRITER flag must be cleared (not subtracted) by lock().
        let raw = RawRwLock::new();
        raw.lock();
        raw.unlock();
        assert_eq!(raw.state.load(Ordering::SeqCst), 0);
    }
}
