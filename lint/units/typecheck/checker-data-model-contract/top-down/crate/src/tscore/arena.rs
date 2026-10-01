// core.Arena: records addressed by ids. Slot 0 is the nil record. No accessor can panic.
use crate::tscore::ids::Id;
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};

pub struct Arena<I, T> {
    items: Vec<T>,
    sink: T,
    marker: PhantomData<I>,
}

impl<I: Id, T: Default> Arena<I, T> {
    pub fn new() -> Self {
        Self {
            items: vec![T::default()],
            sink: T::default(),
            marker: PhantomData,
        }
    }
    // Number of allocated records, the nil slot excluded.
    pub fn count(&self) -> u32 {
        u32::try_from(self.items.len().saturating_sub(1)).unwrap_or(u32::MAX)
    }
    // Returns NIL when the id space below the open bit is exhausted.
    pub fn alloc(&mut self, value: T) -> I {
        match u32::try_from(self.items.len()) {
            Ok(index) if index < crate::tscore::ids::OPEN_BIT => {
                self.items.push(value);
                I::from_u32(index)
            }
            _ => I::from_u32(0),
        }
    }
    pub fn is_valid(&self, id: I) -> bool {
        let index = id.to_u32() as usize;
        index != 0 && index < self.items.len()
    }
    pub fn get(&self, id: I) -> &T {
        match self.items.get(id.to_u32() as usize) {
            Some(value) => value,
            None => self.items.first().unwrap_or(&self.sink),
        }
    }
    // A write through nil or through an unknown id lands in a scratch record.
    pub fn get_mut(&mut self, id: I) -> &mut T {
        let index = id.to_u32() as usize;
        match self.items.get_mut(index) {
            Some(value) if index != 0 => value,
            _ => {
                self.sink = T::default();
                &mut self.sink
            }
        }
    }
}

impl<I: Id, T: Default> Default for Arena<I, T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<I: Id, T: Default> Index<I> for Arena<I, T> {
    type Output = T;
    #[inline]
    fn index(&self, id: I) -> &T {
        self.get(id)
    }
}

impl<I: Id, T: Default> IndexMut<I> for Arena<I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        self.get_mut(id)
    }
}
