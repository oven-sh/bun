//! Boxes at an index that does not change, for what refers to them from outside their owner.

use core::mem::ManuallyDrop;

pub(crate) struct Registry<T> {
    slots: Vec<Slot<T>>,
}

struct Slot<T> {
    reserved: bool,
    value: Option<Box<T>>,
}

impl<T> Registry<T> {
    pub(crate) const fn new() -> Self {
        Self { slots: Vec::new() }
    }

    /// The index is the caller's until `release`.
    pub(crate) fn reserve(&mut self) -> u32 {
        let vacant = self.slots.iter().position(|slot| !slot.reserved);
        let index = vacant.unwrap_or(self.slots.len());
        match self.slots.get_mut(index) {
            Some(slot) => slot.reserved = true,
            None => self.slots.push(Slot {
                reserved: true,
                value: None,
            }),
        }
        u32::try_from(index).expect("int cast")
    }

    /// Leaks the value that is there, if any.
    pub(crate) fn put(&mut self, index: u32, value: Box<T>) {
        let old = ManuallyDrop::new(self.slots[index as usize].value.replace(value));
        debug_assert!(old.is_none());
    }

    /// The index stays reserved.
    pub(crate) fn take(&mut self, index: u32) -> Option<Box<T>> {
        self.slots.get_mut(index as usize)?.value.take()
    }

    /// Looks at `from` and above. The index stays reserved.
    pub(crate) fn take_first(
        &mut self,
        from: u32,
        mut predicate: impl FnMut(&T) -> bool,
    ) -> Option<Box<T>> {
        let mut slots = self.slots.get_mut(from as usize..)?.iter_mut();
        let slot = slots.find(|slot| slot.value.as_deref().is_some_and(&mut predicate))?;
        slot.value.take()
    }

    /// Leaks the value that is there, if any.
    pub(crate) fn release(&mut self, index: u32) {
        self.slots[index as usize].reserved = false;
        while let Some(vacant) = self.slots.pop_if(|slot| !slot.reserved) {
            let value = ManuallyDrop::new(vacant.value);
            debug_assert!(value.is_none());
        }
    }

    pub(crate) fn remove(&mut self, index: u32) -> Option<Box<T>> {
        let removed = self.take(index);
        self.release(index);
        removed
    }

    pub(crate) fn get_mut(&mut self, index: u32) -> Option<&mut T> {
        self.slots.get_mut(index as usize)?.value.as_deref_mut()
    }

    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = &mut T> {
        (self.slots.iter_mut()).filter_map(|slot| slot.value.as_deref_mut())
    }
}

#[cfg(test)]
mod tests {
    use super::Registry;

    #[test]
    fn only_a_removed_index_is_reused() {
        let mut registry = Registry::new();
        assert_eq!((registry.reserve(), registry.reserve()), (0, 1));
        registry.put(0, Box::new('a'));
        registry.put(1, Box::new('b'));

        assert_eq!(registry.take(0), Some(Box::new('a')));
        assert_eq!(registry.get_mut(0), None);
        assert!(registry.iter_mut().eq([&mut 'b']));
        assert_eq!(registry.reserve(), 2);

        registry.release(0);
        assert_eq!(registry.reserve(), 0);
        assert_eq!(registry.take_first(0, |&c| c == 'a'), None);
        assert_eq!(registry.take_first(2, |&c| c == 'b'), None);
        assert_eq!(registry.take_first(9, |&c| c == 'b'), None);
        assert_eq!(registry.take_first(1, |&c| c == 'b'), Some(Box::new('b')));
        assert_eq!(registry.reserve(), 3);
    }
}
