//! A wrapper around a mutex, and a value protected by the mutex.

use core::cell::UnsafeCell;

use crate::Mutex;
use bun_safety::ThreadLock;

/// A wrapper around a mutex, and a value protected by the mutex.
/// This type uses `bun_threading::Mutex` internally.
///
/// Drop-in for `parking_lot::Mutex<T>`: `const fn new(T)`, `.lock()` returns
/// a guard with `Deref`/`DerefMut`, no poisoning.
pub type Guarded<Value> = GuardedBy<Value, Mutex>;

/// `parking_lot::MutexGuard<'a, T>` drop-in alias for the [`Guarded`] case.
/// Named here (not at crate root) to avoid colliding with the bare
/// [`crate::mutex::MutexGuard`] returned by `Mutex::lock_guard()`.
pub type MutexGuard<'a, Value> = GuardedLock<'a, Value, Mutex>;

/// Uses `bun_safety::ThreadLock`.
pub type Debug<Value> = GuardedBy<Value, ThreadLock>;

/// A wrapper around a mutex, and a value protected by the mutex.
/// `M` should have `lock` and `unlock` methods.
// TODO(port): `RawMutex` trait (lock/unlock) is assumed to live in bun_threading; verify in Phase B.
pub struct GuardedBy<Value, M: RawMutex> {
    /// The raw value. Don't use this if there might be concurrent accesses.
    // `UnsafeCell` is load-bearing: `lock(&self)` hands out `&mut Value` while other `&self`
    // borrows of `GuardedBy` exist (the mutex serializes the actual writers). Without the cell,
    // deriving `&mut Value` from `&self` is UB under Stacked Borrows regardless of the mutex.
    pub unsynchronized_value: UnsafeCell<Value>,
    mutex: M,
}

// SAFETY: access to `unsynchronized_value` is serialized by `mutex`; `M: RawMutex` provides the
// happens-before edge. `UnsafeCell<Value>` is `!Sync` by default, so re-assert `Sync` here under
// the same bounds a `std::sync::Mutex<Value>` would require.
unsafe impl<Value: Send, M: RawMutex + Sync> Sync for GuardedBy<Value, M> {}

impl<Value, M: RawMutex + Default> GuardedBy<Value, M> {
    /// Creates a guarded value with a default-initialized mutex.
    pub fn init(value: Value) -> Self {
        Self::init_with_mutex(value, M::default())
    }
}

impl<Value: Default, M: RawMutex + Default> Default for GuardedBy<Value, M> {
    fn default() -> Self {
        Self::init(Value::default())
    }
}

impl<Value> GuardedBy<Value, Mutex> {
    /// `const` constructor for `static` initializers (`Mutex::new()` is `const`;
    /// `M::default()` in [`init`](Self::init) is not).
    ///
    /// Parity with `parking_lot::Mutex::new` / `parking_lot::const_mutex`.
    pub const fn new(value: Value) -> Self {
        Self {
            unsynchronized_value: UnsafeCell::new(value),
            mutex: Mutex::new(),
        }
    }

    /// Attempts to acquire the mutex without blocking. Returns the guard on
    /// success, `None` if another thread holds the lock.
    ///
    /// Parity with `parking_lot::Mutex::try_lock`. Only provided for the real
    /// [`Mutex`] backend (not generic `M`) because [`RawMutex`] intentionally
    /// stays `lock`/`unlock`-only.
    #[inline]
    pub fn try_lock(&self) -> Option<GuardedLock<'_, Value, Mutex>> {
        if self.mutex.try_lock() {
            Some(GuardedLock { guarded: self })
        } else {
            None
        }
    }

    /// Borrow the underlying raw [`Mutex`]. Needed by callers that split
    /// `lock()`/`unlock()` across function boundaries (e.g. `Progress.rs`
    /// porting `lock_api::RawMutex`) or pair this `Guarded` with a bare
    /// [`Condition::wait`](crate::Condition::wait).
    #[inline]
    pub fn raw_mutex(&self) -> &Mutex {
        &self.mutex
    }
}

impl<Value, M: RawMutex> GuardedBy<Value, M> {
    /// Creates a guarded value with the given mutex.
    pub fn init_with_mutex(value: Value, mutex: M) -> Self {
        Self {
            unsynchronized_value: UnsafeCell::new(value),
            mutex,
        }
    }

    /// Locks the mutex and returns an RAII guard that dereferences to the protected value and
    /// releases the lock on drop.
    pub fn lock(&self) -> GuardedLock<'_, Value, M> {
        self.mutex.lock();
        GuardedLock { guarded: self }
    }

    /// Lock-free mutable access when the caller already has `&mut self`
    /// (exclusive borrow proves no other thread can be in the critical
    /// section). Parity with `parking_lot::Mutex::get_mut`.
    #[inline]
    pub fn get_mut(&mut self) -> &mut Value {
        self.unsynchronized_value.get_mut()
    }

    /// Returns the inner unprotected value.
    ///
    /// You must ensure that no other threads could be concurrently using `self`. This method
    /// invalidates `self`, so you must ensure `self` is not used on any thread after calling
    /// this method.
    pub fn into_unprotected(self) -> Value {
        // Zig: `bun.memory.deinit(&self.#mutex)` then return value, then `self.* = undefined`.
        // In Rust, moving out of `self` drops `self.mutex` automatically.
        self.unsynchronized_value.into_inner()
    }
}

// Zig `deinit` only calls `bun.memory.deinit` on both fields and writes `undefined`.
// Rust drops `Value` and `M` fields automatically — no explicit `Drop` impl needed.

/// RAII guard returned by [`GuardedBy::lock`]. Dereferences to the protected value and releases
/// the underlying mutex when dropped — the Rust-native replacement for Zig's split
/// `lock()`/`defer unlock()` pair.
pub struct GuardedLock<'a, Value, M: RawMutex> {
    guarded: &'a GuardedBy<Value, M>,
}

impl<'a, Value> GuardedLock<'a, Value, Mutex> {
    /// Borrow the raw [`Mutex`] this guard holds. Used by
    /// [`Condition::wait_guarded`](crate::Condition::wait_guarded) to unlock /
    /// re-lock around the OS wait without consuming the guard.
    ///
    /// The returned `&Mutex` has the guard's lifetime, not `'a`, so it cannot
    /// outlive the guard and be used to double-unlock.
    #[inline]
    pub fn mutex(&self) -> &Mutex {
        &self.guarded.mutex
    }
}

impl<'a, Value, M: RawMutex> core::ops::Deref for GuardedLock<'a, Value, M> {
    type Target = Value;
    #[inline]
    fn deref(&self) -> &Value {
        // SAFETY: the mutex is held for the lifetime of this guard; no other access to
        // `unsynchronized_value` can exist until `Drop` releases it. `UnsafeCell` provides the
        // interior-mutability provenance for this `&self → &Value` projection.
        unsafe { &*self.guarded.unsynchronized_value.get() }
    }
}

impl<'a, Value, M: RawMutex> core::ops::DerefMut for GuardedLock<'a, Value, M> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Value {
        // SAFETY: see `Deref::deref`.
        unsafe { &mut *self.guarded.unsynchronized_value.get() }
    }
}

impl<'a, Value, M: RawMutex> Drop for GuardedLock<'a, Value, M> {
    #[inline]
    fn drop(&mut self) {
        self.guarded.mutex.unlock();
    }
}

/// Trait for the `M` parameter of `GuardedBy`: a raw mutex with `lock`/`unlock`.
// TODO(port): move to bun_threading if not already there; both `bun_threading::Mutex`
// and `bun_safety::ThreadLock` must impl this.
pub trait RawMutex {
    fn lock(&self);
    fn unlock(&self);
}

impl RawMutex for Mutex {
    #[inline]
    fn lock(&self) {
        Mutex::lock(self)
    }
    #[inline]
    fn unlock(&self) {
        Mutex::unlock(self)
    }
}

// ported from: src/threading/guarded.zig
