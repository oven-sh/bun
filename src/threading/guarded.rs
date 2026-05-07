//! A wrapper around a mutex, and a value protected by the mutex.

use core::cell::UnsafeCell;

use crate::Mutex;
use bun_safety::ThreadLock;

/// A wrapper around a mutex, and a value protected by the mutex.
/// This type uses `bun_threading::Mutex` internally.
pub type Guarded<Value> = GuardedBy<Value, Mutex>;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/guarded.zig (72 lines)
//   confidence: medium
//   todos:      2
//   notes:      RawMutex trait stubbed here; lock() returns an RAII GuardedLock (drop unlocks).
// ──────────────────────────────────────────────────────────────────────────
