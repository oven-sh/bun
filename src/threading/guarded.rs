//! A wrapper around a mutex, and a value protected by the mutex.

use bun_threading::Mutex;
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
    pub unsynchronized_value: Value,
    mutex: M,
}

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
            unsynchronized_value: value,
            mutex,
        }
    }

    /// Locks the mutex and returns a pointer to the value. Remember to call `unlock`!
    // PORT NOTE: reshaped for borrowck — the returned &mut borrows self, so callers
    // must drop the reference before calling `unlock`. Phase B may want an RAII guard
    // (`lock(&self) -> Guard<'_, Value>`) instead of split lock/unlock.
    pub fn lock(&mut self) -> &mut Value {
        self.mutex.lock();
        &mut self.unsynchronized_value
    }

    /// Unlocks the mutex. Don't use any pointers returned by `lock` after calling this method!
    pub fn unlock(&mut self) {
        self.mutex.unlock();
    }

    /// Returns the inner unprotected value.
    ///
    /// You must ensure that no other threads could be concurrently using `self`. This method
    /// invalidates `self`, so you must ensure `self` is not used on any thread after calling
    /// this method.
    pub fn into_unprotected(self) -> Value {
        // Zig: `bun.memory.deinit(&self.#mutex)` then return value, then `self.* = undefined`.
        // In Rust, moving out of `self` drops `self.mutex` automatically.
        self.unsynchronized_value
    }
}

// Zig `deinit` only calls `bun.memory.deinit` on both fields and writes `undefined`.
// Rust drops `Value` and `M` fields automatically — no explicit `Drop` impl needed.

/// Trait for the `M` parameter of `GuardedBy`: a raw mutex with `lock`/`unlock`.
// TODO(port): move to bun_threading if not already there; both `bun_threading::Mutex`
// and `bun_safety::ThreadLock` must impl this.
pub trait RawMutex {
    fn lock(&mut self);
    fn unlock(&mut self);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/guarded.zig (72 lines)
//   confidence: medium
//   todos:      2
//   notes:      RawMutex trait stubbed here; lock/unlock split may need RAII guard in Phase B for borrowck ergonomics.
// ──────────────────────────────────────────────────────────────────────────
