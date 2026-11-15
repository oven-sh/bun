use core::cell::UnsafeCell;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU64, Ordering};

use bun_core::asan;
use bun_ptr::OwnedPtr;

/// A [`HiveArray`](crate::HiveArray) of 64 slots that threads can share. `new` is all zero, so a `static` is in `.bss`.
pub struct AtomicHiveArray<T> {
    used: AtomicU64,
    buffer: UnsafeCell<[MaybeUninit<T>; u64::BITS as usize]>,
}

// SAFETY: a slot is only reached through the one `HiveBox` whose `claim` set its bit in `used`.
unsafe impl<T> Sync for AtomicHiveArray<T> {}

impl<T> AtomicHiveArray<T> {
    pub const fn new() -> Self {
        const { assert!(size_of::<T>() > 0) };
        Self {
            used: AtomicU64::new(0),
            buffer: UnsafeCell::new([const { MaybeUninit::uninit() }; u64::BITS as usize]),
        }
    }

    fn claim(&self) -> Option<NonNull<T>> {
        let before = self
            .used
            .try_update(Ordering::Acquire, Ordering::Relaxed, |used| {
                Some(used | used.checked_add(1)?)
            })
            .ok()?;
        let first = self.buffer.get().cast::<T>();
        let slot = first.wrapping_add(before.trailing_ones() as usize);
        asan::unpoison(slot.cast(), size_of::<T>());
        NonNull::new(slot)
    }
}

/// Names the `static` in which [`HiveBox`] stores values of this type.
pub trait HasStaticHive: Sized + 'static {
    const HIVE: &'static [AtomicHiveArray<Self>];
}

/// A `Box` that stores its value in `T::HIVE`, or on the heap if that is full.
pub struct HiveBox<T: HasStaticHive>(NonNull<T>);

// SAFETY: it owns a `T`, and `drop` releases the slot with an atomic operation.
unsafe impl<T: HasStaticHive + Send> Send for HiveBox<T> {}

impl<T: HasStaticHive> HiveBox<T> {
    pub fn new(value: T) -> Self {
        let slot = (T::HIVE.iter().find_map(AtomicHiveArray::claim))
            .unwrap_or_else(|| Box::into_non_null(Box::<T>::new_uninit()).cast());
        // SAFETY: a slot that was just claimed, or a new allocation, for a `T`.
        unsafe { slot.write(value) };
        Self(slot)
    }
}

impl<T: HasStaticHive> Deref for HiveBox<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: written in `new`, and `self` is the only owner.
        unsafe { self.0.as_ref() }
    }
}

impl<T: HasStaticHive> DerefMut for HiveBox<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as in `deref`.
        unsafe { self.0.as_mut() }
    }
}

impl<T: HasStaticHive> Drop for HiveBox<T> {
    fn drop(&mut self) {
        let slot = self.0.as_ptr();
        let offset = slot.addr().wrapping_sub(T::HIVE.as_ptr().addr());
        let Some(hive) = T::HIVE.get(offset / size_of::<AtomicHiveArray<T>>()) else {
            // SAFETY: not in `T::HIVE`, so it is the `Box` of `new`.
            return unsafe { bun_core::heap::destroy(slot) };
        };
        // SAFETY: written in `new`. Nobody claims the slot before its bit is cleared.
        unsafe { slot.drop_in_place() };
        asan::poison(slot.cast(), size_of::<T>());
        let index = (slot.addr() - hive.buffer.get().addr()) / size_of::<T>();
        hive.used.fetch_and(!(1 << index), Ordering::Release);
    }
}

// SAFETY: the slot stays claimed until the `HiveBox` that `from_raw` returns is dropped.
unsafe impl<T: HasStaticHive> OwnedPtr for HiveBox<T> {
    fn into_raw(this: Self) -> NonNull<T> {
        ManuallyDrop::new(this).0
    }

    unsafe fn from_raw(ptr: NonNull<T>) -> Self {
        Self(ptr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct Item {
        index: usize,
        _alive: Arc<()>,
    }
    static ITEMS: [AtomicHiveArray<Item>; 2] = [const { AtomicHiveArray::new() }; 2];
    impl HasStaticHive for Item {
        const HIVE: &'static [AtomicHiveArray<Self>] = &ITEMS;
    }

    #[test]
    fn hive_then_heap_dropped_on_another_thread() {
        let alive = Arc::new(());
        for _ in 0..2 {
            let items: Vec<_> = (0..130)
                .map(|index| {
                    let _alive = Arc::clone(&alive);
                    HiveBox::new(Item { index, _alive })
                })
                .collect();
            assert!(items.iter().enumerate().all(|(i, item)| item.index == i));
            assert!(ITEMS.iter().all(|b| b.used.load(Ordering::Relaxed) == !0));
            assert_eq!(Arc::strong_count(&alive), 131);
            std::thread::Builder::new()
                .spawn(move || drop(items))
                .unwrap()
                .join()
                .unwrap();
            assert!(ITEMS.iter().all(|b| b.used.load(Ordering::Relaxed) == 0));
            assert_eq!(Arc::strong_count(&alive), 1);
        }
    }
}
