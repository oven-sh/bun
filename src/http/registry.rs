//! Boxes at an index that does not change, which the ext slot of a socket holds in place of a pointer.

use core::mem::ManuallyDrop;

pub(crate) struct Registry<T> {
    slots: Vec<Slot<T>>,
}

enum Slot<T> {
    Vacant,
    Taken,
    Occupied(Box<T>),
}

impl<T> Registry<T> {
    pub(crate) const fn new() -> Self {
        Self { slots: Vec::new() }
    }

    /// What the next `insert` returns.
    pub(crate) fn vacant_index(&self) -> u32 {
        let vacant = self.slots.iter().position(|s| matches!(s, Slot::Vacant));
        u32::try_from(vacant.unwrap_or(self.slots.len())).expect("int cast")
    }

    pub(crate) fn insert(&mut self, value: Box<T>) -> u32 {
        let index = self.vacant_index();
        match self.slots.get_mut(index as usize) {
            Some(slot) => *slot = Slot::Occupied(value),
            None => self.slots.push(Slot::Occupied(value)),
        }
        index
    }

    /// `index` stays reserved until `put_back` or `remove`.
    pub(crate) fn take(&mut self, index: u32) -> Option<Box<T>> {
        let slot = self.slots.get_mut(index as usize)?;
        match core::mem::replace(slot, Slot::Taken) {
            Slot::Occupied(value) => Some(value),
            empty => {
                *slot = empty;
                None
            }
        }
    }

    pub(crate) fn put_back(&mut self, index: u32, value: Box<T>) {
        let slot = &mut self.slots[index as usize];
        let taken = ManuallyDrop::new(core::mem::replace(slot, Slot::Occupied(value)));
        debug_assert!(matches!(*taken, Slot::Taken));
    }

    /// `None` if the value was taken.
    pub(crate) fn remove(&mut self, index: u32) -> Option<Box<T>> {
        let removed = core::mem::replace(&mut self.slots[index as usize], Slot::Vacant);
        while let Some(Slot::Vacant) = self.slots.last() {
            self.slots.pop();
        }
        match removed {
            Slot::Occupied(value) => Some(value),
            _ => None,
        }
    }

    pub(crate) fn get_mut(&mut self, index: u32) -> Option<&mut T> {
        match self.slots.get_mut(index as usize)? {
            Slot::Occupied(value) => Some(value),
            _ => None,
        }
    }

    /// Skips what is taken.
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = (u32, &mut T)> {
        (0..)
            .zip(&mut self.slots)
            .filter_map(|(index, slot)| match slot {
                Slot::Occupied(value) => Some((index, &mut **value)),
                _ => None,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::Registry;

    #[test]
    fn taken_index_stays_reserved() {
        let mut registry = Registry::new();
        assert_eq!(registry.insert(Box::new('a')), 0);
        assert_eq!(registry.insert(Box::new('b')), 1);

        let a = registry.take(0).unwrap();
        assert!(registry.take(0).is_none());
        assert!(registry.get_mut(0).is_none());
        assert!(registry.iter_mut().eq([(1, &mut 'b')]));
        assert_eq!(registry.vacant_index(), 2);

        registry.put_back(0, a);
        assert_eq!(registry.get_mut(0), Some(&mut 'a'));
    }

    #[test]
    fn removed_index_is_reused() {
        let mut registry = Registry::new();
        registry.insert(Box::new('a'));
        registry.insert(Box::new('b'));

        assert_eq!(registry.remove(0), Some(Box::new('a')));
        assert_eq!(registry.insert(Box::new('c')), 0);

        let _b = registry.take(1);
        assert_eq!(registry.remove(1), None);
        assert_eq!(registry.vacant_index(), 1);
    }
}
