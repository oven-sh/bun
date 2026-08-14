//! A wrapper around a mutex, and a value protected by the mutex.

use core::cell::UnsafeCell;

use crate::Mutex;

/// A wrapper around a mutex, and a value protected by the mutex.
/// This type uses `bun_threading::Mutex` internally.
///
/// Drop-in for `parking_lot::Mutex<T>`: `const fn new(T)`, `.lock()` returns
/// a guard with `Deref`/`DerefMut`, no poisoning.
pub type Guarded<Value> = GuardedBy<Value, Mutex>;

/// A wrapper around a mutex, and a value protected by the mutex.
/// `M` should have `lock` and `unlock` methods.
pub struct GuardedBy<Value, M: RawMutex> {
    /// The raw value. Don't use this if there might be concurrent accesses.
    // `UnsafeCell` is load-bearing: `lock(&self)` hands out `&mut Value` while other `&self`
    // borrows of `GuardedBy` exist (the mutex serializes the actual writers). Without the cell,
    // deriving `&mut Value` from `&self` is UB under Stacked Borrows regardless of the mutex.
    pub(crate) unsynchronized_value: UnsafeCell<Value>,
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

    /// Locks `*this`, runs `f` on the protected value and releases the lock,
    /// for a critical section whose release is what lets another thread free
    /// the `Guarded` (typically together with the struct holding it): the
    /// writer side of a one-shot handoff whose reader frees the slot as soon
    /// as it has taken the value (`SingleHTTPChannel` in bun_http).
    ///
    /// [`lock`](Self::lock) is not usable for that: the guard's `Drop` and
    /// [`Mutex::unlock`] hold references into the allocation until they
    /// return, which is after the release, and a reference argument asserts
    /// its memory live for the whole call (rustc marks it `dereferenceable`;
    /// under the aliasing models the reader's free is rejected). Here the
    /// store that releases the lock, inside [`Mutex::unlock_raw`], is the
    /// last access to `*this`.
    ///
    /// `f` runs with the lock held, so `*this` (and whatever contains it) is
    /// still live inside it; anything that has to happen before the reader
    /// may free the slot, such as signalling a condition variable, belongs in
    /// `f`. Nothing may touch `*this` once this returns.
    ///
    /// # Safety
    /// `this` must point to a live `Guarded` that stays live until this
    /// function releases the lock, and the calling thread must not hold it.
    pub unsafe fn with_lock_raw<R>(this: *const Self, f: impl FnOnce(&mut Value) -> R) -> R {
        // SAFETY: `*this` is live (fn contract); the reference only lives for
        // the `lock()` call.
        unsafe { (*this).mutex.lock() };
        // SAFETY: the lock taken above serializes this against every other
        // access to the value, and keeps `*this` live (fn contract) until the
        // release below; `f`'s `&mut Value` does not outlive `f`.
        let result =
            f(unsafe { &mut *UnsafeCell::raw_get(&raw const (*this).unsynchronized_value) });
        // SAFETY: this thread holds the lock (taken above), so `*this` is live
        // up to the releasing store inside the call, which is the last access
        // to it.
        unsafe { Mutex::unlock_raw(&raw const (*this).mutex) };
        result
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

/// RAII guard returned by [`GuardedBy::lock`]. Dereferences to the protected value and releases
/// the underlying mutex when dropped.
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
    pub(crate) fn mutex(&self) -> &Mutex {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Condition;

    /// The shape of `SingleHTTPChannel` (bun_http): the reader frees the
    /// channel as soon as it has taken the value, so the writer may not hold
    /// anything pointing into it once `with_lock_raw` has released the lock.
    struct Channel {
        slot: Guarded<Option<u32>>,
        cv: Condition,
        /// Plain (non-interior-mutable) field, like the channel's
        /// `response_buffer` pointer: the `&self` of a by-reference writer
        /// covers it too, so that shape is rejected at the reader's free even
        /// though every byte the writer touches is in an `UnsafeCell`.
        owner_data: usize,
    }

    struct SendPtr(*const Channel);
    // SAFETY: `Channel` is `Sync`; the pointer is only dereferenced while the
    // pointee is live (see the test).
    unsafe impl Send for SendPtr {}

    #[test]
    fn reader_may_free_the_channel_once_the_raw_release_has_landed() {
        // Under miri every iteration is a full interpreted thread spawn; the
        // `&self` + guard shape this replaces is rejected within the first few
        // dozen iterations on every seed tried.
        let iterations: u32 = if cfg!(miri) { 300 } else { 10_000 };
        for i in 0..iterations {
            let ch = Box::into_raw(Box::new(Channel {
                slot: Guarded::new(None),
                cv: Condition::new(),
                owner_data: i as usize,
            }));
            let p = SendPtr(ch);
            let writer = std::thread::spawn(move || {
                let p = p;
                // SAFETY: the reader can only take the value, and so free the
                // channel, after this releases the lock; up to that point the
                // channel is live, and after it nothing here refers to it (the
                // property under test). The signal is inside the closure
                // because it has to happen while the channel is still live.
                unsafe {
                    Guarded::with_lock_raw(&raw const (*p.0).slot, |slot| {
                        *slot = Some(i);
                        (*p.0).cv.notify_one();
                    });
                }
            });
            // SAFETY: `ch` is live until the `Box` drop below; the writer's
            // last access to it is its lock release, which `read` waits for.
            let (value, owner_data) = unsafe { ((*ch).read(), (*ch).owner_data) };
            assert_eq!(value, i);
            assert_eq!(owner_data, i as usize);
            // SAFETY: `ch` came from `Box::into_raw`; the writer is done with it
            // (it published the value we just took), so this is the sole owner.
            drop(unsafe { Box::from_raw(ch) });
            writer.join().unwrap();
        }
    }

    impl Channel {
        /// `SingleHTTPChannel::read_item`: the reader side takes `&self`
        /// because it is the owner, which frees the channel only after this
        /// returns.
        fn read(&self) -> u32 {
            let mut slot = self.slot.lock();
            loop {
                if let Some(value) = slot.take() {
                    return value;
                }
                self.cv.wait_guarded(&mut slot);
            }
        }
    }
}
