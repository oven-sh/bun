//! Containers that are changed through `&self`, for state that re-entrant code on one thread shares
//! (a callback that runs JavaScript can reach the event loop that called it).
//!
//! They are to `Vec`, `LinearFifo` and the hash maps what `Cell` is to an integer: a value goes in
//! or comes out whole, and no reference into the container is ever handed out. No method takes a
//! closure, clones or drops an element, and map keys are integers ([`IntKey`]), so the only foreign
//! code that runs while a method borrows the container is the global allocator, which cannot reach
//! it. That is what every `SAFETY` comment below means by "nothing here re-enters". `UnsafeCell`
//! makes every type here `!Sync`.

use core::cell::UnsafeCell;

use bun_alloc::AllocError;

use crate::array_hash_map::ArrayHashMap;
use crate::identity_context::{IdentityContext, IdentityHash};
use crate::linear_fifo::{DynamicBuffer, LinearFifo};
use crate::zig_hash_map::HashMap;

pub struct VecCell<T>(UnsafeCell<Vec<T>>);

impl<T> VecCell<T> {
    #[inline]
    pub const fn new() -> Self {
        Self(UnsafeCell::new(Vec::new()))
    }

    #[inline]
    pub fn push(&self, value: T) {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).push(value) }
    }

    #[inline]
    pub fn len(&self) -> usize {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).len() }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).capacity() }
    }

    /// Leaves an empty `Vec` with no allocation.
    #[inline]
    pub fn take(&self) -> Vec<T> {
        self.replace(Vec::new())
    }

    /// The caller drops what it gets back, with no borrow of the cell live.
    #[inline]
    pub fn replace(&self, value: Vec<T>) -> Vec<T> {
        // SAFETY: nothing here re-enters.
        unsafe { core::mem::replace(&mut *self.0.get(), value) }
    }

    /// Removes the element at `index` and puts the last one in its place.
    #[inline]
    pub fn swap_remove(&self, index: usize) -> T {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).swap_remove(index) }
    }
}

impl<T: Copy> VecCell<T> {
    #[inline]
    pub fn get(&self, index: usize) -> Option<T> {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).get(index).copied() }
    }

    #[inline]
    pub fn extend_from_slice(&self, values: &[T]) {
        // SAFETY: nothing here re-enters. `values` cannot be a borrow of this `Vec`: none exists.
        unsafe { (&mut *self.0.get()).extend_from_slice(values) }
    }
}

impl<T> Default for VecCell<T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

pub struct FifoCell<T: Copy>(UnsafeCell<LinearFifo<T, DynamicBuffer<T>>>);

impl<T: Copy> FifoCell<T> {
    #[inline]
    pub fn new() -> Self {
        Self(UnsafeCell::new(LinearFifo::<T, DynamicBuffer<T>>::init()))
    }

    #[inline]
    pub fn write_item(&self, item: T) -> Result<(), AllocError> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).write_item(item) }
    }

    #[inline]
    pub fn read_item(&self) -> Option<T> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).read_item() }
    }

    #[inline]
    pub fn readable_length(&self) -> usize {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).readable_length() }
    }

    #[inline]
    pub fn ensure_unused_capacity(&self, size: usize) -> Result<(), AllocError> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).ensure_unused_capacity(size) }
    }

    #[inline]
    pub fn reset_head_if_empty(&self) {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).reset_head_if_empty() }
    }

    /// Frees the buffer. The items are `Copy`, so nothing is dropped.
    #[inline]
    pub fn clear_and_free(&self) {
        // SAFETY: nothing here re-enters.
        unsafe { *self.0.get() = LinearFifo::<T, DynamicBuffer<T>>::init() }
    }
}

impl<T: Copy> Default for FifoCell<T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

mod sealed {
    pub trait Sealed {}
}

/// The integers: keys whose `Hash` and `Eq` are the standard library's. Sealed, because an
/// implementation written elsewhere could reach the map that is calling it.
pub trait IntKey: sealed::Sealed + Copy + Eq + core::hash::Hash + IdentityHash {}

macro_rules! int_key {
    ($($t:ty),*) => { $(
        impl sealed::Sealed for $t {}
        impl IntKey for $t {}
    )* };
}
int_key!(u32, u64, usize, i32, i64, isize);

pub struct ArrayHashMapCell<K: IntKey, V: Copy>(UnsafeCell<ArrayHashMap<K, V>>);

impl<K: IntKey, V: Copy> ArrayHashMapCell<K, V> {
    #[inline]
    pub fn count(&self) -> usize {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).count() }
    }

    #[inline]
    pub fn get(&self, key: K) -> Option<V> {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).get(&key).copied() }
    }

    /// The value at `index` in insertion order, which `swap_remove` disturbs.
    #[inline]
    pub fn value_at(&self, index: usize) -> Option<V> {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).values().get(index).copied() }
    }

    #[inline]
    pub fn put(&self, key: K, value: V) -> Result<(), AllocError> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).put(key, value) }
    }

    #[inline]
    pub fn swap_remove(&self, key: K) -> bool {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).swap_remove(&key) }
    }

    #[inline]
    pub fn clear_retaining_capacity(&self) {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).clear_retaining_capacity() }
    }

    /// Leaves an empty map with no allocation.
    #[inline]
    pub fn take(&self) -> ArrayHashMap<K, V> {
        // SAFETY: nothing here re-enters.
        unsafe { core::mem::take(&mut *self.0.get()) }
    }
}

impl<K: IntKey, V: Copy> Default for ArrayHashMapCell<K, V> {
    #[inline]
    fn default() -> Self {
        Self(UnsafeCell::new(ArrayHashMap::default()))
    }
}

/// Keyed by values that are hashes already.
pub struct IdentityHashMapCell<K: IntKey, V: Copy>(UnsafeCell<HashMap<K, V, IdentityContext<K>>>);

impl<K: IntKey, V: Copy> IdentityHashMapCell<K, V> {
    #[inline]
    pub fn get(&self, key: K) -> Option<V> {
        // SAFETY: nothing here re-enters.
        unsafe { (&*self.0.get()).get(&key).copied() }
    }

    #[inline]
    pub fn put(&self, key: K, value: V) -> Result<(), AllocError> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).put(key, value) }
    }

    #[inline]
    pub fn remove(&self, key: K) -> Option<V> {
        // SAFETY: nothing here re-enters.
        unsafe { (&mut *self.0.get()).remove(&key) }
    }
}

impl<K: IntKey, V: Copy> Default for IdentityHashMapCell<K, V> {
    #[inline]
    fn default() -> Self {
        Self(UnsafeCell::new(HashMap::default()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec_cell_is_changed_through_shared_references() {
        let cell = VecCell::new();
        let (a, b) = (&cell, &cell);
        a.push(1);
        b.push(2);
        a.extend_from_slice(&[3, 4]);
        assert_eq!(b.len(), 4);
        assert_eq!(a.get(3), Some(4));
        assert_eq!(a.get(4), None);
        assert_eq!(b.swap_remove(0), 1);
        assert_eq!(a.take(), vec![4, 2, 3]);
        assert!(b.is_empty());
        assert_eq!(a.capacity(), 0);
    }

    /// `drop` of an element reaches the cell it came out of.
    #[test]
    fn vec_cell_elements_are_dropped_outside_the_cell() {
        use std::rc::{Rc, Weak};
        struct PushesOnDrop(Weak<VecCell<Option<PushesOnDrop>>>);
        impl Drop for PushesOnDrop {
            fn drop(&mut self) {
                self.0.upgrade().unwrap().push(None);
            }
        }
        let cell = Rc::new(VecCell::new());
        cell.push(Some(PushesOnDrop(Rc::downgrade(&cell))));
        drop(cell.replace(Vec::new()));
        assert_eq!(cell.len(), 1);
        cell.push(Some(PushesOnDrop(Rc::downgrade(&cell))));
        drop(cell.swap_remove(1));
        assert_eq!(cell.len(), 2);
    }

    #[test]
    fn fifo_cell_keeps_order_across_growth() {
        let fifo = FifoCell::new();
        let (a, b) = (&fifo, &fifo);
        for i in 0..100u32 {
            a.write_item(i).unwrap();
            if i % 3 == 0 {
                b.write_item(1000 + i).unwrap();
            }
        }
        let mut last_low = None;
        let mut count = 0;
        while let Some(item) = b.read_item() {
            count += 1;
            if item < 1000 {
                assert!(last_low.is_none_or(|last| last < item));
                last_low = Some(item);
            }
        }
        assert_eq!(count, 134);
        assert_eq!(a.readable_length(), 0);
        a.reset_head_if_empty();
        a.ensure_unused_capacity(8).unwrap();
        a.clear_and_free();
        assert_eq!(a.read_item(), None);
    }

    #[test]
    fn map_cells_are_changed_through_shared_references() {
        let map = ArrayHashMapCell::<i32, u8>::default();
        let (a, b) = (&map, &map);
        for i in 0..100 {
            a.put(i, i as u8).unwrap();
        }
        assert_eq!(b.count(), 100);
        assert_eq!(b.get(42), Some(42));
        assert!(a.swap_remove(0));
        assert!(!a.swap_remove(0));
        assert_eq!(b.value_at(0), Some(99));
        assert_eq!(a.take().count(), 99);
        assert_eq!(b.count(), 0);

        let map = IdentityHashMapCell::<u32, u8>::default();
        let (a, b) = (&map, &map);
        for i in 0..100 {
            a.put(i, i as u8).unwrap();
        }
        assert_eq!(b.get(7), Some(7));
        assert_eq!(a.remove(7), Some(7));
        assert_eq!(b.get(7), None);
    }
}
