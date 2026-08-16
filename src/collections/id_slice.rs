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
/// for the operations not forwarded here.
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
