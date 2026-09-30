// internal/collections/set.go. The empty set stands for upstream's nil set.
use std::collections::BTreeSet;

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Set<T> {
    pub m: BTreeSet<T>,
}

impl<T> Default for Set<T> {
    fn default() -> Self {
        Set { m: BTreeSet::new() }
    }
}

// NewSetWithSizeHint creates a new Set with a hint for the number of elements it will contain.
pub fn new_set_with_size_hint<T>(_hint: isize) -> Set<T> {
    Set::default()
}

impl<T: Ord> Set<T> {
    pub fn has(&self, key: &T) -> bool {
        self.m.contains(key)
    }

    pub fn add(&mut self, key: T) {
        self.m.insert(key);
    }

    pub fn delete(&mut self, key: &T) {
        self.m.remove(key);
    }

    pub fn len(&self) -> isize {
        self.m.len() as isize
    }

    // The keys in ascending order, where upstream's map has no order.
    pub fn keys(&self) -> &BTreeSet<T> {
        &self.m
    }

    pub fn clear(&mut self) {
        self.m.clear();
    }

    // Returns true if the key was not already present in the set.
    pub fn add_if_absent(&mut self, key: T) -> bool {
        if self.has(&key) {
            return false;
        }
        self.add(key);
        true
    }

    pub fn union(&mut self, other: &Set<T>)
    where
        T: Clone,
    {
        if self.len() == 0 && other.len() == 0 {
            return;
        }
        self.m.extend(other.m.iter().cloned());
    }

    pub fn unioned_with(&self, other: &Set<T>) -> Set<T>
    where
        T: Clone,
    {
        let mut result = self.clone();
        result.m.extend(other.m.iter().cloned());
        result
    }

    pub fn equals(&self, other: &Set<T>) -> bool {
        self.m == other.m
    }

    pub fn is_subset_of(&self, other: &Set<T>) -> bool {
        for key in &self.m {
            if !other.has(key) {
                return false;
            }
        }
        true
    }

    pub fn intersects(&self, other: &Set<T>) -> bool {
        for key in &self.m {
            if other.has(key) {
                return true;
            }
        }
        false
    }
}

pub fn new_set_from_items<T: Ord + Clone>(items: &[T]) -> Set<T> {
    let mut s = Set::default();
    for item in items {
        s.add(item.clone());
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_operations() {
        let mut s: Set<u32> = new_set_with_size_hint(8);
        assert!(!s.has(&1));
        assert_eq!(s.len(), 0);
        s.add(3);
        s.add(1);
        s.add(3);
        assert!(s.has(&1) && s.has(&3) && !s.has(&2));
        assert_eq!(s.len(), 2);
        assert!(s.add_if_absent(2));
        assert!(!s.add_if_absent(2));
        assert_eq!(
            s.keys().iter().copied().collect::<Vec<u32>>(),
            vec![1, 2, 3]
        );
        s.delete(&2);
        s.delete(&9);
        assert_eq!(s.len(), 2);

        let other = new_set_from_items(&[3, 4]);
        assert!(s.intersects(&other));
        assert!(!s.is_subset_of(&other));
        assert!(new_set_from_items(&[3]).is_subset_of(&other));
        assert!(Set::<u32>::default().is_subset_of(&other));
        assert!(!Set::<u32>::default().intersects(&other));
        let unioned = s.unioned_with(&other);
        assert!(unioned.equals(&new_set_from_items(&[1, 3, 4])));
        assert!(!unioned.equals(&s));
        s.union(&other);
        assert!(s.equals(&unioned));
        let clone = s.clone();
        s.clear();
        assert_eq!((s.len(), clone.len()), (0, 3));
    }
}
