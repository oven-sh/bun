use core::cell::UnsafeCell;

use bun_ptr::AliasableBox;

use crate::HashMap;

/// Boxed values by id. A shared borrow can add values and only an exclusive one can remove them,
/// so a `&V` stays valid while the map grows. The key is a `u32` because hashing it runs no code
/// that could reach the map.
pub struct AppendOnlyMap<V> {
    /// A method's borrow of this ends before it returns or runs code it was given.
    map: UnsafeCell<HashMap<u32, AliasableBox<V>>>,
}

impl<V> Default for AppendOnlyMap<V> {
    fn default() -> Self {
        Self {
            map: UnsafeCell::default(),
        }
    }
}

impl<V> AppendOnlyMap<V> {
    pub fn len(&self) -> usize {
        // SAFETY: no other borrow of `map` is live between method calls.
        unsafe { &*self.map.get() }.len()
    }

    pub fn contains_key(&self, id: u32) -> bool {
        // SAFETY: as in `len`.
        unsafe { &*self.map.get() }.contains_key(&id)
    }

    pub fn get(&self, id: u32) -> Option<&V> {
        // SAFETY: as in `len`. The box does not move with its slot, and only `&mut self` drops it.
        unsafe { (*self.map.get()).get(&id).map(|value| &*value.as_ptr()) }
    }

    /// Drops `value` if `id` is taken.
    pub fn get_or_insert(&self, id: u32, value: V) -> &V {
        // SAFETY: as in `get`. What was handed out points into the boxes, not into `map`.
        let (stored, rejected) = unsafe {
            let (stored, rejected) = (*self.map.get()).get_or_insert(id, AliasableBox::new(value));
            (&*stored.as_ptr(), rejected)
        };
        drop(rejected);
        stored
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
        let slots = unsafe { &*self.map.get() }.capacity();
        (0..slots).filter_map(|slot| {
            // SAFETY: as in `get`. Each step borrows `map` anew.
            unsafe {
                let value = (*self.map.get()).value_in_slot(slot)?;
                Some(&*value.as_ptr())
            }
        })
    }

    pub fn remove(&mut self, id: u32) {
        self.map.get_mut().remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::{Cell, RefCell};
    use std::rc::{Rc, Weak};

    #[test]
    fn values_stay_valid_while_the_map_grows() {
        let map = AppendOnlyMap::default();
        let first = map.get_or_insert(1, Cell::new(1));
        let before = map.snapshot();
        for id in 2..100 {
            map.get_or_insert(id, Cell::new(id));
            first.set(first.get() + 1);
        }
        assert_eq!(before.len(), 1);
        assert_eq!(before[0].get(), 99);
        assert_eq!(map.get(1).map(Cell::get), Some(99));
        assert_eq!(map.len(), 99);
    }

    #[test]
    fn a_walk_survives_growth() {
        let map = AppendOnlyMap::default();
        for id in 0..6 {
            map.get_or_insert(id, id);
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

    struct InsertsOnDrop(Weak<AppendOnlyMap<InsertsOnDrop>>);

    impl Drop for InsertsOnDrop {
        fn drop(&mut self) {
            let Some(map) = self.0.upgrade() else { return };
            for id in 2..50 {
                map.get_or_insert(id, InsertsOnDrop(Weak::new()));
            }
        }
    }

    #[test]
    fn a_taken_id_keeps_its_value() {
        let map = Rc::new(AppendOnlyMap::default());
        let first = map.get_or_insert(1, InsertsOnDrop(Weak::new()));
        let second = map.get_or_insert(1, InsertsOnDrop(Rc::downgrade(&map)));
        assert!(core::ptr::eq(first, second));
        assert_eq!(second.0.strong_count(), 0);
        assert_eq!(map.len(), 49);
    }

    #[test]
    fn removal_waits_for_the_last_borrow() {
        let alive = Rc::new(());
        let map = RefCell::new(AppendOnlyMap::default());
        let held = map.borrow();
        let value = held.get_or_insert(1, Rc::clone(&alive));
        assert!(map.try_borrow_mut().is_err());
        assert_eq!(Rc::strong_count(value), 2);
        drop(held);
        map.borrow_mut().remove(1);
        assert_eq!(Rc::strong_count(&alive), 1);
        assert!(!map.borrow().contains_key(1));
    }
}
