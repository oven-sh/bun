// Records addressed by ids, owned by one checker. Slot 0 is the nil record. No accessor can panic.
use crate::tscore::ids::Id;
use std::cell::Cell;
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};

pub struct Records<I, T> {
    items: Vec<T>,
    sink: T,
    // Reads and writes through nil or through an id that names nothing: Go panics there.
    nil_reads: Cell<u32>,
    nil_writes: u32,
    marker: PhantomData<I>,
}

impl<I: Id, T: Default> Default for Records<I, T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<I: Id, T: Default> Records<I, T> {
    pub fn new() -> Self {
        Self {
            items: vec![T::default()],
            sink: T::default(),
            nil_reads: Cell::new(0),
            nil_writes: 0,
            marker: PhantomData,
        }
    }
    // Number of records, the nil record excluded.
    pub fn count(&self) -> u32 {
        u32::try_from(self.items.len().saturating_sub(1)).unwrap_or(u32::MAX)
    }
    // Returns NIL when the id space is exhausted.
    pub fn alloc(&mut self, value: T) -> I {
        let Ok(index) = u32::try_from(self.items.len()) else {
            return I::from_u32(0);
        };
        if index >= crate::tscore::ids::OPEN_BIT {
            return I::from_u32(0);
        }
        self.items.push(value);
        I::from_u32(index)
    }
    pub fn is_valid(&self, id: I) -> bool {
        let index = id.to_u32() as usize;
        index != 0 && index < self.items.len()
    }
    pub fn get(&self, id: I) -> &T {
        let index = id.to_u32() as usize;
        match self.items.get(index) {
            Some(value) if index != 0 => value,
            _ => {
                self.nil_reads.set(self.nil_reads.get().saturating_add(1));
                self.items.first().unwrap_or(&self.sink)
            }
        }
    }
    // A write through nil or through an unknown id lands in a scratch record and is counted.
    pub fn get_mut(&mut self, id: I) -> &mut T {
        let index = id.to_u32() as usize;
        match self.items.get_mut(index) {
            Some(value) if index != 0 => value,
            _ => {
                self.nil_writes = self.nil_writes.saturating_add(1);
                self.sink = T::default();
                &mut self.sink
            }
        }
    }
    // Forgets every record and keeps the storage.
    pub fn clear(&mut self) {
        self.items.truncate(1);
    }
    pub fn nil_reads(&self) -> u32 {
        self.nil_reads.get()
    }
    pub fn nil_writes(&self) -> u32 {
        self.nil_writes
    }
    pub fn nil_accesses(&self) -> u32 {
        self.nil_reads.get().saturating_add(self.nil_writes)
    }
}

impl<I: Id, T: Default> Index<I> for Records<I, T> {
    type Output = T;
    #[inline]
    fn index(&self, id: I) -> &T {
        self.get(id)
    }
}

impl<I: Id, T: Default> IndexMut<I> for Records<I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        self.get_mut(id)
    }
}
