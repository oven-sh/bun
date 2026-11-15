//! A wrapper around a mutex, and a value protected by the mutex.

use core::cell::UnsafeCell;
use core::mem::ManuallyDrop;

use crate::{Mutex, MutexGuard};

/// A wrapper around a mutex, and a value protected by the mutex.
/// This type uses `bun_threading::Mutex` internally.
///
/// Drop-in for `parking_lot::Mutex<T>`: `const fn new(T)`, `.lock()` returns
/// a guard with `Deref`/`DerefMut`, no poisoning.
#[derive(Default)]
pub struct Guarded<Value> {
    // `UnsafeCell` is load-bearing: `lock(&self)` hands out `&mut Value` while other `&self`
    // borrows of `Guarded` exist (the mutex serializes the actual writers). Without the cell,
    // deriving `&mut Value` from `&self` is UB under Stacked Borrows regardless of the mutex.
    unsynchronized_value: UnsafeCell<Value>,
    mutex: Mutex,
}

// SAFETY: access to `unsynchronized_value` is serialized by `mutex`, which provides the
// happens-before edge. `UnsafeCell<Value>` is `!Sync` by default, so re-assert `Sync` here under
// the same bounds a `std::sync::Mutex<Value>` would require.
unsafe impl<Value: Send> Sync for Guarded<Value> {}

impl<Value> Guarded<Value> {
    /// Parity with `parking_lot::Mutex::new` / `parking_lot::const_mutex`.
    pub const fn new(value: Value) -> Self {
        Self {
            unsynchronized_value: UnsafeCell::new(value),
            mutex: Mutex::new(),
        }
    }

    /// Runs `f` under the lock, for a critical section that lets another thread free `*this`.
    ///
    /// # Safety
    /// `this` stays live until the unlock after `f` returns.
    pub unsafe fn with_lock_raw<R>(
        this: *const Self,
        f: impl FnOnce(&mut GuardedLock<'_, Value>) -> R,
    ) -> R {
        // SAFETY: fn contract.
        let mut guard = ManuallyDrop::new(unsafe { &*this }.lock());
        let result = f(&mut guard);
        // SAFETY: the guard holds this mutex on this thread, and is not used again.
        unsafe { Mutex::unlock_raw(guard.mutex_guard.mutex()) };
        result
    }

    /// Locks the mutex and returns an RAII guard that dereferences to the protected value and
    /// releases the lock on drop.
    pub fn lock(&self) -> GuardedLock<'_, Value> {
        GuardedLock {
            value: &self.unsynchronized_value,
            mutex_guard: self.mutex.lock_guard(),
        }
    }

    /// Lock-free mutable access when the caller already has `&mut self`
    /// (exclusive borrow proves no other thread can be in the critical
    /// section). Parity with `parking_lot::Mutex::get_mut`.
    #[inline]
    pub fn get_mut(&mut self) -> &mut Value {
        self.unsynchronized_value.get_mut()
    }
}

/// RAII guard returned by [`Guarded::lock`]. Dereferences to the protected value and releases
/// the underlying mutex when dropped.
pub struct GuardedLock<'a, Value> {
    value: &'a UnsafeCell<Value>,
    pub(crate) mutex_guard: MutexGuard<'a>,
}

impl<Value> core::ops::Deref for GuardedLock<'_, Value> {
    type Target = Value;
    #[inline]
    fn deref(&self) -> &Value {
        // SAFETY: the mutex is held for the lifetime of this guard; no other access to
        // `unsynchronized_value` can exist until `Drop` releases it. `UnsafeCell` provides the
        // interior-mutability provenance for this `&self → &Value` projection.
        unsafe { &*self.value.get() }
    }
}

impl<Value> core::ops::DerefMut for GuardedLock<'_, Value> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Value {
        // SAFETY: see `Deref::deref`.
        unsafe { &mut *self.value.get() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::AtomicPtr;
    use std::sync::Arc;

    // Miri rejects the free if the other thread still holds a reference into the allocation.
    #[test]
    fn the_unlock_of_with_lock_raw_is_the_last_access() {
        #[cfg(miri)]
        const ITERATIONS: usize = 300;
        #[cfg(not(miri))]
        const ITERATIONS: usize = 10_000;

        for _ in 0..ITERATIONS {
            let done = Arc::new(Guarded::new(false));
            let address = AtomicPtr::new(Arc::as_ptr(&done).cast_mut());
            let thread = std::thread::Builder::new()
                .spawn(move || {
                    // SAFETY: `done` is dropped only once it reads `true`.
                    unsafe { Guarded::with_lock_raw(address.into_inner(), |value| **value = true) };
                })
                .unwrap();
            while !*done.lock() {
                std::thread::yield_now();
            }
            drop(done);
            thread.join().unwrap();
        }
    }
}
