//! A wrapper around a mutex, and a value protected by the mutex.

use core::cell::UnsafeCell;

use crate::Mutex;
use bun_safety::ThreadLock;

pub type Guarded<Value> = GuardedBy<Value, Mutex>;

/// `parking_lot::MutexGuard<'a, T>` drop-in alias for the [`Guarded`] case.
/// Named here (not at crate root) to avoid colliding with the bare
/// [`crate::mutex::MutexGuard`] returned by `Mutex::lock_guard()`.
pub type MutexGuard<'a, Value> = GuardedLock<'a, Value, Mutex>;

/// Uses `bun_safety::ThreadLock`.
pub type Debug<Value> = GuardedBy<Value, ThreadLock>;

/// A wrapper around a mutex, and a value protected by the mutex.
/// `M` should have `lock` and `unlock` methods.
pub struct GuardedBy<Value, M: RawMutex> {
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
        Self {
            unsynchronized_value: UnsafeCell::new(value),
            mutex: M::default(),
        }
    }
}

impl<Value: Default, M: RawMutex + Default> Default for GuardedBy<Value, M> {
    fn default() -> Self {
        Self::init(Value::default())
    }
}

impl<Value> GuardedBy<Value, Mutex> {
    pub const fn new(value: Value) -> Self {
        Self {
            unsynchronized_value: UnsafeCell::new(value),
            mutex: Mutex::new(),
        }
    }

    #[inline]
    pub fn try_lock(&self) -> Option<GuardedLock<'_, Value, Mutex>> {
        if self.mutex.try_lock() {
            Some(GuardedLock { guarded: self })
        } else {
            None
        }
    }

    #[inline]
    pub fn raw_mutex(&self) -> &Mutex {
        &self.mutex
    }
}

impl<Value, M: RawMutex> GuardedBy<Value, M> {
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
