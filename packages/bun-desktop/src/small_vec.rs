use std::mem::MaybeUninit;
use std::ops::{Deref, DerefMut};

/// Does not allocate for up to `N` items.
pub enum SmallVec<T, const N: usize> {
    /// The first so many are initialized.
    Inline(usize, [MaybeUninit<T>; N]),
    Heap(Vec<T>),
}

impl<T, const N: usize> SmallVec<T, N> {
    pub const fn new() -> Self {
        SmallVec::Inline(0, [const { MaybeUninit::uninit() }; N])
    }

    pub fn push(&mut self, item: T) {
        match self {
            SmallVec::Inline(len, items) if *len < N => {
                items[*len].write(item);
                *len += 1;
            }
            SmallVec::Inline(..) => {
                let mut all = Vec::with_capacity(N * 2 + 1);
                all.extend(std::mem::take(self));
                all.push(item);
                *self = SmallVec::Heap(all);
            }
            SmallVec::Heap(items) => items.push(item),
        }
    }

    pub fn pop(&mut self) -> Option<T> {
        match self {
            SmallVec::Inline(len, items) => {
                *len = len.checked_sub(1)?;
                // SAFETY: it was among the initialized ones, and is not any more.
                Some(unsafe { items[*len].assume_init_read() })
            }
            SmallVec::Heap(items) => items.pop(),
        }
    }

    pub fn truncate(&mut self, len: usize) {
        while self.len() > len {
            self.pop();
        }
    }

    pub fn clear(&mut self) {
        self.truncate(0);
    }

    pub fn insert(&mut self, index: usize, item: T) {
        self.push(item);
        self[index..].rotate_right(1);
    }

    pub fn remove(&mut self, index: usize) -> T {
        self[index..].rotate_left(1);
        self.pop().expect("it has the item")
    }

    pub fn retain(&mut self, mut keeps: impl FnMut(&mut T) -> bool) {
        let mut kept = 0;
        for index in 0..self.len() {
            if keeps(&mut self[index]) {
                self.swap(kept, index);
                kept += 1;
            }
        }
        self.truncate(kept);
    }
}

impl<T, const N: usize> Drop for SmallVec<T, N> {
    fn drop(&mut self) {
        if let SmallVec::Inline(len, items) = self {
            // SAFETY: those are initialized.
            unsafe { items[..*len].assume_init_drop() };
        }
    }
}

impl<T, const N: usize> Deref for SmallVec<T, N> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        match self {
            // SAFETY: those are initialized.
            SmallVec::Inline(len, items) => unsafe { items[..*len].assume_init_ref() },
            SmallVec::Heap(items) => items,
        }
    }
}

impl<T, const N: usize> DerefMut for SmallVec<T, N> {
    fn deref_mut(&mut self) -> &mut [T] {
        match self {
            // SAFETY: those are initialized.
            SmallVec::Inline(len, items) => unsafe { items[..*len].assume_init_mut() },
            SmallVec::Heap(items) => items,
        }
    }
}

impl<T, const N: usize> Default for SmallVec<T, N> {
    fn default() -> Self {
        SmallVec::new()
    }
}

impl<T: Clone, const N: usize> Clone for SmallVec<T, N> {
    fn clone(&self) -> Self {
        self.iter().cloned().collect()
    }
}

impl<T: PartialEq, const N: usize> PartialEq for SmallVec<T, N> {
    fn eq(&self, other: &Self) -> bool {
        **self == **other
    }
}

impl<T, const N: usize> Extend<T> for SmallVec<T, N> {
    fn extend<I: IntoIterator<Item = T>>(&mut self, items: I) {
        items.into_iter().for_each(|it| self.push(it));
    }
}

impl<T, const N: usize> FromIterator<T> for SmallVec<T, N> {
    fn from_iter<I: IntoIterator<Item = T>>(items: I) -> Self {
        let mut all = SmallVec::new();
        all.extend(items);
        all
    }
}

/// With the items in reverse.
pub struct IntoIter<T, const N: usize>(SmallVec<T, N>);

impl<T, const N: usize> Iterator for IntoIter<T, N> {
    type Item = T;

    fn next(&mut self) -> Option<T> {
        self.0.pop()
    }
}

impl<T, const N: usize> IntoIterator for SmallVec<T, N> {
    type Item = T;
    type IntoIter = IntoIter<T, N>;

    fn into_iter(mut self) -> IntoIter<T, N> {
        self.reverse();
        IntoIter(self)
    }
}

impl<'a, T, const N: usize> IntoIterator for &'a SmallVec<T, N> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

impl<'a, T, const N: usize> IntoIterator for &'a mut SmallVec<T, N> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}
