// internal/collections/ordered_set.go
use crate::collections::ordered_map::{OrderedMap, new_map_with_size_hint};

// OrderedSet an insertion ordered set.
#[derive(Clone, Debug)]
pub struct OrderedSet<T> {
    m: OrderedMap<T, ()>,
}

impl<T> Default for OrderedSet<T> {
    fn default() -> Self {
        OrderedSet {
            m: OrderedMap::default(),
        }
    }
}

// NewOrderedSetWithSizeHint creates a new OrderedSet with a hint for the number of elements it will contain.
pub fn new_ordered_set_with_size_hint<T>(hint: isize) -> OrderedSet<T> {
    OrderedSet {
        m: new_map_with_size_hint(hint),
    }
}

impl<T: Ord + Clone> OrderedSet<T> {
    // Add adds a value to the set.
    pub fn add(&mut self, value: T) {
        self.m.set(value, ());
    }

    // Has returns true if the set contains the value.
    pub fn has(&self, value: &T) -> bool {
        self.m.has(value)
    }

    // Delete removes a value from the set.
    pub fn delete(&mut self, value: &T) -> bool {
        self.m.delete(value).is_some()
    }

    // Values returns an iterator over the values in the set.
    pub fn values(&self) -> impl Iterator<Item = &T> {
        self.m.keys()
    }

    // The value at a position of the insertion order: a loop over positions sees the values that its body adds, as a loop over upstream's Values does.
    pub fn value_at(&self, position: usize) -> Option<T> {
        self.m
            .entry_at(isize::try_from(position).ok()?)
            .map(|entry| entry.0.clone())
    }

    // Clear removes all elements from the set. The space allocated for the set will be reused.
    pub fn clear(&mut self) {
        self.m.clear();
    }

    // Size returns the number of elements in the set.
    pub fn size(&self) -> isize {
        self.m.size()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // upstream's TestOrderedSet
    #[test]
    fn ordered_set() {
        let mut s: OrderedSet<i32> = OrderedSet::default();

        s.add(1);
        s.add(2);
        s.add(3);

        assert!(s.has(&1));
        assert!(s.has(&2));
        assert!(s.has(&3));

        assert!(s.delete(&2));
        assert!(!s.delete(&2));

        let values: Vec<i32> = s.values().copied().collect();
        assert_eq!(values.len(), 2);
        assert!(values.is_sorted());

        s.clear();

        assert_eq!(s.size(), 0);
        assert!(!s.has(&1));
        assert!(!s.has(&2));
        assert!(!s.has(&3));

        let s2 = s.clone();
        assert_eq!(s2.size(), 0);
    }

    #[test]
    fn a_loop_over_positions_sees_added_values() {
        let mut s: OrderedSet<u32> = new_ordered_set_with_size_hint(4);
        s.add(5);
        s.add(1);
        let mut seen = Vec::new();
        let mut position = 0;
        while let Some(value) = s.value_at(position) {
            seen.push(value);
            if value == 5 {
                s.add(9);
                s.add(1);
            }
            position += 1;
        }
        assert_eq!(seen, vec![5, 1, 9]);
        assert_eq!(s.size(), 3);
    }
}
