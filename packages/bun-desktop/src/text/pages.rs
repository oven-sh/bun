//! A value for each character of the first two planes.

#[derive(Default)]
pub struct Pages<T> {
    all: Vec<Option<Box<[T; 256]>>>,
    count: usize,
}

impl<T: Copy + Default> Pages<T> {
    #[inline(always)]
    pub fn get(&self, character: char) -> T {
        match self.all.get(character as usize >> 8) {
            Some(Some(page)) => page[character as usize & 255],
            _ => T::default(),
        }
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn set(&mut self, character: char, value: T) {
        let page = character as usize >> 8;
        if page < 0x200 {
            self.all.resize_with(self.all.len().max(page + 1), || None);
            self.count += usize::from(self.all[page].is_none());
            self.all[page].get_or_insert_with(|| Box::new([T::default(); 256]))
                [character as usize & 255] = value;
        }
    }
}
