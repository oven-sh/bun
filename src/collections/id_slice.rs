//! Slices and vectors whose positions are an id newtype rather than `usize`.
//!
//! [`IdSlice<I, T>`] is a `[T]` that is subscripted with an `I`, so a buffer
//! indexed by one kind of id rejects the other kind at compile time. It derefs
//! to the plain slice for everything that is not subscripting (`len`, `iter`,
//! passing to a `&[T]` parameter, byte views). Subscripting does not fall
//! through the deref: once a type has an `Index` impl of its own, `s[0]` and
//! `s[a..b]` are type errors rather than slice indexing, so raw positions have
//! to be spelled out with [`raw`](IdSlice::raw) / [`raw_mut`](IdSlice::raw_mut).
//! The wrapper is `#[repr(transparent)]` over the slice, so converting between
//! the two views is free. [`IdVec<I, T>`] is the owning counterpart.

use core::fmt;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut, Index, IndexMut};

/// An id newtype that addresses an [`IdSlice`].
pub trait Idx: Copy {
    fn from_index(index: usize) -> Self;
    fn index(self) -> usize;
}

/// A `[T]` whose positions are `I`s. See the module docs.
#[repr(transparent)]
pub struct IdSlice<I, T> {
    _id: PhantomData<fn(I) -> I>,
    raw: [T],
}

impl<I: Idx, T> IdSlice<I, T> {
    #[inline]
    pub fn from_raw(raw: &[T]) -> &Self {
        // SAFETY: `#[repr(transparent)]` over `[T]`, so the two pointee types
        // have the same layout and the same (length) metadata.
        unsafe { &*(core::ptr::from_ref::<[T]>(raw) as *const Self) }
    }

    #[inline]
    pub fn from_raw_mut(raw: &mut [T]) -> &mut Self {
        // SAFETY: as in `from_raw`; `&mut` exclusivity carries over unchanged.
        unsafe { &mut *(core::ptr::from_mut::<[T]>(raw) as *mut Self) }
    }

    /// The `usize`-indexed view: sub-ranges, sorting helpers, byte casts.
    /// Plain slice methods are reachable through `Deref` without this.
    #[inline]
    pub fn raw(&self) -> &[T] {
        &self.raw
    }

    #[inline]
    pub fn raw_mut(&mut self) -> &mut [T] {
        &mut self.raw
    }

    #[inline]
    pub fn get(&self, id: I) -> Option<&T> {
        self.raw.get(id.index())
    }

    /// Is `id` a position in this slice?
    #[inline]
    pub fn has(&self, id: I) -> bool {
        id.index() < self.raw.len()
    }

    /// The id of every position, in order.
    #[inline]
    pub fn ids(&self) -> impl DoubleEndedIterator<Item = I> + ExactSizeIterator + use<I, T> {
        (0..self.raw.len()).map(I::from_index)
    }

    #[inline]
    pub fn iter_enumerated(&self) -> impl DoubleEndedIterator<Item = (I, &T)> + ExactSizeIterator {
        self.raw
            .iter()
            .enumerate()
            .map(|(index, item)| (I::from_index(index), item))
    }
}

impl<I, T> Deref for IdSlice<I, T> {
    type Target = [T];

    #[inline]
    fn deref(&self) -> &[T] {
        &self.raw
    }
}

impl<I, T> DerefMut for IdSlice<I, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.raw
    }
}

impl<I: Idx, T> Index<I> for IdSlice<I, T> {
    type Output = T;

    #[inline]
    fn index(&self, id: I) -> &T {
        &self.raw[id.index()]
    }
}

impl<I: Idx, T> IndexMut<I> for IdSlice<I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        &mut self.raw[id.index()]
    }
}

impl<'a, I, T> IntoIterator for &'a IdSlice<I, T> {
    type Item = &'a T;
    type IntoIter = core::slice::Iter<'a, T>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.raw.iter()
    }
}

impl<'a, I, T> IntoIterator for &'a mut IdSlice<I, T> {
    type Item = &'a mut T;
    type IntoIter = core::slice::IterMut<'a, T>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        self.raw.iter_mut()
    }
}

impl<I, T: fmt::Debug> fmt::Debug for IdSlice<I, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.raw, f)
    }
}

/// A `Vec<T>` whose positions are `I`s; derefs to [`IdSlice`]. The `Vec`
/// itself is reachable through [`raw`](IdVec::raw) / [`raw_mut`](IdVec::raw_mut)
/// for the operations not forwarded here. Anything not forwarded resolves to
/// the *slice* through `Deref`; that matters for `as_ptr` / `as_mut_ptr`,
/// whose slice versions only cover the initialized `len` elements, so code
/// that fills reserved capacity must take the pointer from `raw_mut()`.
#[repr(transparent)]
pub struct IdVec<I, T> {
    raw: Vec<T>,
    _id: PhantomData<fn(I) -> I>,
}

impl<I: Idx, T> IdVec<I, T> {
    #[inline]
    pub const fn new() -> Self {
        Self::from_raw(Vec::new())
    }

    #[inline]
    pub fn with_capacity(capacity: usize) -> Self {
        Self::from_raw(Vec::with_capacity(capacity))
    }

    #[inline]
    pub const fn from_raw(raw: Vec<T>) -> Self {
        Self {
            raw,
            _id: PhantomData,
        }
    }

    #[inline]
    pub fn raw(&self) -> &Vec<T> {
        &self.raw
    }

    #[inline]
    pub fn raw_mut(&mut self) -> &mut Vec<T> {
        &mut self.raw
    }

    #[inline]
    pub fn as_slice(&self) -> &IdSlice<I, T> {
        IdSlice::from_raw(&self.raw)
    }

    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut IdSlice<I, T> {
        IdSlice::from_raw_mut(&mut self.raw)
    }

    #[inline]
    pub fn push(&mut self, value: T) {
        self.raw.push(value);
    }

    #[inline]
    pub fn truncate(&mut self, len: usize) {
        self.raw.truncate(len);
    }

    #[inline]
    pub fn reserve(&mut self, additional: usize) {
        self.raw.reserve(additional);
    }

    #[inline]
    pub fn reserve_exact(&mut self, additional: usize) {
        self.raw.reserve_exact(additional);
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.raw.capacity()
    }

    #[inline]
    pub fn resize(&mut self, new_len: usize, value: T)
    where
        T: Clone,
    {
        self.raw.resize(new_len, value);
    }

    /// Moves every element of `other` onto the end, leaving it empty.
    #[inline]
    pub fn append(&mut self, other: &mut Vec<T>) {
        self.raw.append(other);
    }
}

impl<I: Idx, T> Default for IdVec<I, T> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<I: Idx, T: Clone> Clone for IdVec<I, T> {
    #[inline]
    fn clone(&self) -> Self {
        Self::from_raw(self.raw.clone())
    }
}

impl<I: Idx, T> From<Vec<T>> for IdVec<I, T> {
    #[inline]
    fn from(raw: Vec<T>) -> Self {
        Self::from_raw(raw)
    }
}

impl<I: Idx, T> Deref for IdVec<I, T> {
    type Target = IdSlice<I, T>;

    #[inline]
    fn deref(&self) -> &IdSlice<I, T> {
        self.as_slice()
    }
}

impl<I: Idx, T> DerefMut for IdVec<I, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut IdSlice<I, T> {
        self.as_mut_slice()
    }
}

impl<I: Idx, T> Index<I> for IdVec<I, T> {
    type Output = T;

    #[inline]
    fn index(&self, id: I) -> &T {
        &self.raw[id.index()]
    }
}

impl<I: Idx, T> IndexMut<I> for IdVec<I, T> {
    #[inline]
    fn index_mut(&mut self, id: I) -> &mut T {
        &mut self.raw[id.index()]
    }
}

impl<I: Idx, T> FromIterator<T> for IdVec<I, T> {
    #[inline]
    fn from_iter<Iter: IntoIterator<Item = T>>(iter: Iter) -> Self {
        Self::from_raw(Vec::from_iter(iter))
    }
}

impl<I, T: fmt::Debug> fmt::Debug for IdVec<I, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.raw, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    struct Id(u32);

    impl Idx for Id {
        fn from_index(index: usize) -> Self {
            Self(index as u32)
        }

        fn index(self) -> usize {
            self.0 as usize
        }
    }

    #[test]
    fn slice_view_reads_through_ids() {
        let raw = [10u8, 20, 30];
        let view = IdSlice::<Id, u8>::from_raw(&raw);
        assert_eq!(view.len(), 3);
        assert_eq!(view[Id(1)], 20);
        assert_eq!(view.get(Id(2)), Some(&30));
        assert_eq!(view.get(Id(3)), None);
        assert!(view.has(Id(2)));
        assert!(!view.has(Id(3)));
        assert_eq!(view.ids().collect::<Vec<_>>(), [Id(0), Id(1), Id(2)]);
        assert_eq!(view.ids().next_back(), Some(Id(2)));
        assert_eq!(
            view.iter_enumerated().collect::<Vec<_>>(),
            [(Id(0), &10), (Id(1), &20), (Id(2), &30)]
        );
        assert_eq!(view.iter().copied().sum::<u8>(), 60);
        assert_eq!(view.raw(), &raw);
        assert_eq!(format!("{view:?}"), "[10, 20, 30]");
    }

    #[test]
    fn slice_view_writes_through_to_the_slice() {
        let mut raw = [1u32, 2, 3, 4];
        let view = IdSlice::<Id, u32>::from_raw_mut(&mut raw);
        view[Id(0)] = 10;
        for item in view.iter_mut() {
            *item += 1;
        }
        for item in &mut *view {
            *item *= 2;
        }
        view.raw_mut()[2..].reverse();
        assert_eq!(raw, [22, 6, 10, 8]);
    }

    #[test]
    fn empty_slice_view() {
        let view = IdSlice::<Id, u64>::from_raw(&[]);
        assert!(view.is_empty());
        assert_eq!(view.get(Id(0)), None);
        assert!(!view.has(Id(0)));
        assert_eq!(view.ids().len(), 0);
        assert_eq!(view.iter_enumerated().len(), 0);

        let mut empty: [u64; 0] = [];
        assert!(IdSlice::<Id, u64>::from_raw_mut(&mut empty).is_empty());
    }

    #[test]
    fn vec_is_addressed_like_its_slice() {
        let mut names: IdVec<Id, &str> = IdVec::new();
        names.push("a");
        names.push("b");
        names.append(&mut vec!["c", "d"]);
        assert_eq!(names.len(), 4);
        assert_eq!(names[Id(3)], "d");
        names[Id(0)] = "z";
        names.as_mut_slice()[Id(1)] = "y";
        assert_eq!(names.as_slice().raw(), ["z", "y", "c", "d"]);
        assert_eq!(
            names.ids().collect::<Vec<_>>(),
            [Id(0), Id(1), Id(2), Id(3)]
        );
        assert_eq!(names.get(Id(4)), None);

        names.truncate(2);
        assert_eq!(*names.raw(), ["z", "y"]);
        names.raw_mut().insert(0, "x");
        assert_eq!(
            names.iter_enumerated().collect::<Vec<_>>(),
            [(Id(0), &"x"), (Id(1), &"z"), (Id(2), &"y")]
        );
        assert_eq!(format!("{names:?}"), r#"["x", "z", "y"]"#);
    }

    #[test]
    fn vec_constructors() {
        let mut sized: IdVec<Id, u32> = IdVec::with_capacity(8);
        assert!(sized.capacity() >= 8);
        sized.resize(3, 7);
        sized.reserve(1);
        sized.reserve_exact(1);
        assert_eq!(sized.as_slice().raw(), [7, 7, 7]);

        let collected: IdVec<Id, u32> = (1..=3).collect();
        assert_eq!(collected[Id(2)], 3);

        let converted: IdVec<Id, u32> = vec![4, 5].into();
        assert_eq!(converted.clone().raw(), converted.raw());
        assert_eq!(IdVec::<Id, u32>::from_raw(Vec::new()).len(), 0);
        assert!(IdVec::<Id, u32>::default().is_empty());
    }
}
