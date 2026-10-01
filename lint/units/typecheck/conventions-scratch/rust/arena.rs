// Arenas indexed by ids. Slot 0 is the nil object. No accessor can panic.
use crate::ids::Id;
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
    // Number of allocated objects, the nil slot excluded.
    pub fn count(&self) -> u32 {
        u32::try_from(self.items.len().saturating_sub(1)).unwrap_or(u32::MAX)
    }
    // Returns NIL when the id space is exhausted.
    pub fn alloc(&mut self, value: T) -> I {
        let Ok(index) = u32::try_from(self.items.len()) else {
            return I::from_u32(0);
        };
        self.items.push(value);
        I::from_u32(index)
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
    // A write through nil or through an unknown id lands in a scratch object.
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

// Ids 0..frozen.len() are the program's objects (read-only, shared). Ids above are owned by one checker.
pub struct Overlay<'p, I, T> {
    frozen: &'p [T],
    own: Vec<T>,
    nil: T,
    sink: T,
    pub writes_to_frozen: u32,
    marker: PhantomData<I>,
}

impl<'p, I: Id, T: Default> Overlay<'p, I, T> {
    pub fn new(frozen: &'p [T]) -> Self {
        let mut own = Vec::new();
        if frozen.is_empty() {
            own.push(T::default());
        }
        Self {
            frozen,
            own,
            nil: T::default(),
            sink: T::default(),
            writes_to_frozen: 0,
            marker: PhantomData,
        }
    }
    pub fn frozen_len(&self) -> usize {
        self.frozen.len()
    }
    pub fn is_frozen(&self, id: I) -> bool {
        (id.to_u32() as usize) < self.frozen.len()
    }
    pub fn alloc(&mut self, value: T) -> I {
        let Ok(index) = u32::try_from(self.frozen.len() + self.own.len()) else {
            return I::from_u32(0);
        };
        self.own.push(value);
        I::from_u32(index)
    }
    pub fn get(&self, id: I) -> &T {
        let index = id.to_u32() as usize;
        if let Some(value) = self.frozen.get(index) {
            return value;
        }
        self.own.get(index - self.frozen.len()).unwrap_or(&self.nil)
    }
    pub fn get_mut(&mut self, id: I) -> &mut T {
        let index = id.to_u32() as usize;
        let frozen_len = self.frozen.len();
        if index < frozen_len {
            if index != 0 {
                self.writes_to_frozen = self.writes_to_frozen.saturating_add(1);
            }
            self.sink = T::default();
            return &mut self.sink;
        }
        match self.own.get_mut(index - frozen_len) {
            Some(value) if index != 0 => value,
            _ => {
                self.sink = T::default();
                &mut self.sink
            }
        }
    }
}

impl<I: Id, T: Default> Index<I> for Overlay<'_, I, T> {
    type Output = T;
    #[inline]
    fn index(&self, id: I) -> &T {
        self.get(id)
    }
}

impl<I: Id, T: Default> IndexMut<I> for Overlay<'_, I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        self.get_mut(id)
    }
}
