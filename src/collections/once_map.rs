use core::cell::UnsafeCell;

use bun_ptr::AliasableBox;

use crate::HashMap;

/// Boxed values, inserted through `&self` and removed through `&mut self`.
pub struct OnceMap<V> {
    /// Never borrowed while `V::drop` or the caller's code runs.
    map: UnsafeCell<HashMap<u32, AliasableBox<V>>>,
}

impl<V> Default for OnceMap<V> {
    fn default() -> Self {
        Self {
            map: UnsafeCell::default(),
        }
    }
}

impl<V> OnceMap<V> {
    pub fn len(&self) -> usize {
        // SAFETY: no other borrow of `map` is live between method calls.
        unsafe { &*self.map.get() }.len()
    }

    pub fn contains_key(&self, key: u32) -> bool {
        // SAFETY: as in `len`. Hashing a `u32` runs no code that could reach `map`.
        unsafe { &*self.map.get() }.contains_key(&key)
    }

    pub fn get(&self, key: u32) -> Option<&V> {
        // SAFETY: as in `contains_key`. The value does not move with its slot, and only
        // `&mut self` drops it.
        unsafe { (*self.map.get()).get(&key).map(|value| &*value.as_ptr()) }
    }

    /// Drops `value` if `key` is taken.
    pub fn get_or_insert(&self, key: u32, value: V) -> &V {
        // SAFETY: as in `contains_key`. What was handed out points into the boxes, not into `map`.
        let stored = match unsafe { &mut *self.map.get() }.try_insert(key, AliasableBox::new(value))
        {
            Ok(stored) => stored.as_ptr(),
            Err((stored, rejected)) => {
                let stored = stored.as_ptr();
                drop(rejected);
                stored
            }
        };
        // SAFETY: as in `get`.
        unsafe { &*stored }
    }

    /// The values that are in the map now.
    pub fn snapshot(&self) -> Vec<&V> {
        // SAFETY: as in `get`.
        unsafe {
            let values = (*self.map.get()).values();
            values.map(|value| &*value.as_ptr()).collect()
        }
    }

    /// Does not allocate, but skips or repeats values if the map grows during the walk.
    pub fn values(&self) -> impl Iterator<Item = &V> {
        // SAFETY: as in `len`.
        let capacity = unsafe { &*self.map.get() }.capacity();
        let values = (0..capacity).filter_map(|slot| {
            // SAFETY: as in `get`. Each step borrows `map` anew.
            unsafe {
                let value = (*self.map.get()).value_in_slot(slot)?;
                Some(&*value.as_ptr())
            }
        });
        values.take(self.len())
    }

    pub fn remove(&mut self, key: u32) {
        self.map.get_mut().remove(&key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;
    use std::rc::{Rc, Weak};

    #[test]
    fn values_stay_valid_while_the_map_grows() {
        let map = OnceMap::default();
        let first = map.get_or_insert(1, Cell::new(1));
        let before = map.snapshot();
        for key in 2..100 {
            map.get_or_insert(key, Cell::new(key));
            first.set(first.get() + 1);
        }
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].get(), 99);
        assert_eq!(map.get(1).map(Cell::get), Some(99));
        assert_eq!(map.len(), 99);
    }

    #[test]
    fn values_iterator_survives_inserts() {
        let map = OnceMap::default();
        for key in 0..6 {
            map.get_or_insert(key, key);
        }
        let in_order: Vec<&u32> = map.values().collect();
        assert_eq!(in_order, map.snapshot());
        let mut next = 6;
        for value in map.values() {
            for _ in 0..10 {
                map.get_or_insert(next, next);
                next += 1;
            }
            assert_eq!(map.get(*value), Some(value));
        }
    }

    struct InsertsOnDrop(Weak<OnceMap<InsertsOnDrop>>);

    impl Drop for InsertsOnDrop {
        fn drop(&mut self) {
            let Some(map) = self.0.upgrade() else { return };
            for key in 2..50 {
                map.get_or_insert(key, InsertsOnDrop(Weak::new()));
            }
        }
    }

    #[test]
    fn get_or_insert_keeps_the_existing_value() {
        let map = Rc::new(OnceMap::default());
        let first = map.get_or_insert(1, InsertsOnDrop(Weak::new()));
        let second = map.get_or_insert(1, InsertsOnDrop(Rc::downgrade(&map)));
        assert!(core::ptr::eq(first, second));
        assert_eq!(second.0.strong_count(), 0);
        assert_eq!(map.len(), 49);
    }

    #[test]
    fn remove_drops_the_value() {
        let value = Rc::new(());
        let mut map = OnceMap::default();
        map.get_or_insert(1, Rc::clone(&value));
        assert_eq!(Rc::strong_count(&value), 2);
        map.remove(1);
        assert_eq!(Rc::strong_count(&value), 1);
        assert!(!map.contains_key(1));
    }
}
